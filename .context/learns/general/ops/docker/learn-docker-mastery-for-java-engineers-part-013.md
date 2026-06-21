# learn-docker-mastery-for-java-engineers-part-013.md

# Part 013 — Docker Compose as Local System Model

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `013`  
> Topik: Docker Compose sebagai model sistem lokal, bukan sekadar shortcut command  
> Target pembaca: Java software engineer yang ingin memahami containerized multi-service environment secara arsitektural dan operasional

---

## 0. Posisi Part Ini Dalam Seri

Sampai titik ini kita sudah membangun beberapa fondasi penting:

1. Docker bukan VM kecil, melainkan mekanisme packaging dan runtime boundary untuk proses.
2. Container adalah proses yang diberi boundary namespace, cgroup, filesystem, dan network.
3. Docker Engine memiliki komponen seperti client, daemon, containerd, runc, image store, network driver, dan volume driver.
4. Image adalah artifact immutable berbasis layer, tag, digest, manifest, dan platform.
5. Container memiliki lifecycle eksplisit: create, start, stop, restart, remove.
6. Docker CLI adalah alat inspeksi runtime.
7. Dockerfile adalah mekanisme derivasi filesystem, bukan sekadar script install.
8. Java image membutuhkan perhatian khusus terhadap multi-stage build, layer, JVM memory, signal, PID 1, dan filesystem state.
9. Docker networking mengajarkan bahwa service reachability ditentukan oleh namespace, bridge, DNS, bind address, dan port publishing.

Part ini menjawab pertanyaan berikut:

> Kalau satu container hanya satu process boundary, bagaimana kita memodelkan satu sistem lokal yang terdiri dari Java service, database, broker, cache, mock server, migration runner, dan dependency lain?

Jawaban praktisnya adalah **Docker Compose**.

Tetapi Compose harus dipahami secara benar.

Compose bukan sekadar:

```bash
 docker compose up
```

Compose adalah **model deklaratif untuk menjalankan multi-container application pada satu Docker environment**.

Ia memberi kita cara untuk mendeskripsikan:

- service apa saja yang membentuk sistem,
- image apa yang digunakan,
- container mana yang dibuild lokal,
- environment variable apa yang dipakai,
- network apa yang menghubungkan service,
- volume apa yang menyimpan state,
- port mana yang diekspos ke host,
- dependency startup seperti apa,
- healthcheck apa yang menentukan service dianggap siap,
- profile apa yang mengaktifkan subset environment tertentu,
- dan lifecycle lokal seperti start, stop, recreate, reset, remove.

Untuk Java engineer, Compose adalah salah satu alat paling penting untuk mengubah dependency eksternal menjadi **executable local architecture**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menjelaskan Compose sebagai model sistem lokal, bukan orchestrator production penuh.
2. Membedakan service, container, image, project, network, dan volume dalam Compose.
3. Mendesain `compose.yaml` yang eksplisit, stabil, dan mudah didiagnosis.
4. Memahami default network dan service discovery by service name.
5. Menggunakan `depends_on` secara benar tanpa salah menganggapnya sebagai readiness guarantee universal.
6. Menggunakan healthcheck untuk membuat dependency startup lebih masuk akal.
7. Menggunakan named volume dan bind mount secara tepat.
8. Menggunakan `.env`, `env_file`, dan environment variable tanpa mencampur build-time dan runtime concern.
9. Menggunakan Compose profiles untuk membangun beberapa mode environment lokal.
10. Menghindari anti-pattern Compose yang menyebabkan local environment tidak deterministic.
11. Membaca Compose sebagai graph topology, bukan sebagai kumpulan container acak.
12. Melakukan debugging saat sistem Compose “up” tetapi aplikasi tidak bekerja.

---

## 2. Sumber Rujukan Utama

Materi ini disusun dengan mengacu pada dokumentasi resmi Docker berikut:

- Docker Compose overview: <https://docs.docker.com/compose/>
- Compose file reference: <https://docs.docker.com/reference/compose-file/>
- Compose services reference: <https://docs.docker.com/reference/compose-file/services/>
- Compose networks reference: <https://docs.docker.com/reference/compose-file/networks/>
- Compose volumes reference: <https://docs.docker.com/reference/compose-file/volumes/>
- Compose environment variables: <https://docs.docker.com/compose/environment-variables/>
- Compose profiles: <https://docs.docker.com/compose/profiles/>
- Compose startup order: <https://docs.docker.com/compose/how-tos/startup-order/>
- Compose CLI reference: <https://docs.docker.com/reference/cli/docker/compose/>

Catatan penting: detail implementasi Compose dapat berkembang. Tetapi mental model service, network, volume, project, lifecycle, dan dependency graph adalah fondasi yang relatif stabil.

---

## 3. Core Mental Model: Compose Adalah Model Topology Lokal

Bayangkan kamu punya Java service seperti ini:

```text
Order Service
  ├── PostgreSQL
  ├── Redis
  ├── Kafka
  ├── Schema Registry
  ├── Mail mock
  └── External payment mock
```

Tanpa Compose, engineer baru harus tahu manual:

```bash
docker network create app-net

docker volume create postgres-data

docker run ... postgres

docker run ... redis

docker run ... kafka

docker run ... schema-registry

docker run ... mailpit

docker run ... payment-mock

docker build ... order-service

docker run ... order-service
```

Masalahnya:

1. Urutan command sulit diingat.
2. Nama network bisa berbeda antar developer.
3. Nama container bisa bentrok.
4. Volume lama bisa menyebabkan state stale.
5. Environment variable tersebar.
6. Port host bisa konflik.
7. Dependency startup tidak jelas.
8. Dokumentasi setup sering tidak sinkron dengan kenyataan.
9. Debugging jadi berbasis tribal knowledge.

Compose mengubah command procedural menjadi declarative topology:

```yaml
services:
  app:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
      SPRING_DATA_REDIS_HOST: redis

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7

volumes:
  postgres-data:
```

Ini bukan hanya lebih pendek. Ini lebih penting karena topology menjadi **artifact yang bisa direview, dijalankan, dan diperdebatkan**.

Compose file adalah bentuk lokal dari pertanyaan arsitektural:

> Sistem ini butuh dependency apa, dihubungkan lewat network apa, menyimpan state di mana, dan bagaimana app tahu dependency-nya?

---

## 4. Compose Bukan Kubernetes

Ini perlu ditegaskan sejak awal.

Compose sangat berguna untuk:

- local development,
- integration testing sederhana,
- demo environment,
- workshop,
- small single-host setup,
- dependency provisioning,
- reproducible onboarding,
- menjalankan topology multi-container pada satu Docker host.

Compose bukan pengganti langsung untuk Kubernetes dalam hal:

- scheduling multi-node,
- rolling update kompleks,
- self-healing across nodes,
- autoscaling,
- node affinity,
- service mesh,
- advanced secret rotation,
- cluster-level policy,
- workload identity,
- pod disruption management,
- multi-zone resilience,
- declarative reconciliation loop yang kuat.

Compose memiliki model deklaratif, tetapi tidak boleh dipahami sebagai orchestrator cluster production.

Mental model yang lebih tepat:

```text
Dockerfile  = model image untuk satu aplikasi/container
Compose     = model topology multi-container pada satu environment Docker
Kubernetes  = model orchestration multi-node dengan declarative control loop
```

Compose berada di tengah: lebih tinggi dari `docker run`, lebih rendah dari orchestrator cluster.

---

## 5. Terminologi Inti Compose

Sebelum membuat file, kita harus mengunci istilah.

### 5.1 Project

Compose menjalankan service dalam konteks **project**.

Project adalah namespace logis untuk resource Compose:

- container,
- network,
- volume,
- config,
- secret,
- service name.

Biasanya nama project diturunkan dari nama direktori. Bisa dioverride dengan:

```bash
docker compose -p order-platform up
```

atau environment variable:

```bash
COMPOSE_PROJECT_NAME=order-platform docker compose up
```

Kenapa project penting?

Karena Compose akan memberi prefix resource:

```text
<project>_<service>_<index>
<project>_<network>
<project>_<volume>
```

Contoh:

```text
order-platform-app-1
order-platform-postgres-1
order-platform_default
order-platform_postgres-data
```

Jika dua repo memakai service `postgres`, project name mencegah collision.

#### Failure Mode

Engineer A menjalankan repo dari folder `backend`, Engineer B dari folder `order-service`. Resource yang terbentuk berbeda karena project name berbeda. Dokumentasi yang mengasumsikan nama container tetap bisa gagal.

Gunakan command berbasis service, bukan nama container hardcoded:

```bash
docker compose exec postgres psql -U app -d appdb
```

bukan:

```bash
docker exec -it backend-postgres-1 psql -U app -d appdb
```

---

### 5.2 Service

Service adalah definisi deklaratif untuk satu jenis workload.

Contoh:

```yaml
services:
  app:
    image: my-company/order-service:dev
```

`app` adalah service name.

Sebuah service dapat menghasilkan satu atau lebih container instance.

Dalam local development, umumnya satu service menjadi satu container:

```text
service app -> container app-1
```

Tetapi secara konsep service bukan container. Service adalah definisi; container adalah instance runtime.

Kenapa ini penting?

Karena DNS Compose memakai service name, bukan container ID.

Jika service `postgres` ada di network yang sama, service lain dapat mengaksesnya dengan hostname:

```text
postgres
```

bukan:

```text
localhost
```

---

### 5.3 Container

Container adalah instance runtime dari service.

Compose membuat container berdasarkan service definition.

Untuk melihat container:

```bash
docker compose ps
```

atau:

```bash
docker ps
```

Tetapi `docker compose ps` lebih kontekstual karena hanya menampilkan resource project Compose saat ini.

---

### 5.4 Image

Service dapat memakai image yang sudah ada:

```yaml
services:
  redis:
    image: redis:7
```

Atau build image lokal:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
```

Atau keduanya:

```yaml
services:
  app:
    build: .
    image: order-service:local
```

Dengan pola ini, Compose membuild image dari source lokal dan memberi tag `order-service:local`.

Perhatikan perbedaan concern:

```text
build -> bagaimana image dibuat
image -> image apa yang dijalankan / tag apa yang diberikan
```

---

### 5.5 Network

Network adalah boundary komunikasi antar container.

Jika tidak mendefinisikan network eksplisit, Compose membuat default network untuk project.

Semua service dalam default network yang sama dapat saling resolve via service name.

Contoh:

```yaml
services:
  app:
    image: order-service:local
  postgres:
    image: postgres:16
```

`app` dapat mengakses:

```text
postgres:5432
```

karena keduanya berada pada Compose default network.

---

### 5.6 Volume

Volume adalah mekanisme untuk menyimpan state di luar writable layer container.

Contoh:

```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

Volume ini akan tetap ada meski container dihapus, sampai volume dihapus eksplisit.

Ini membuat state database survive:

```bash
docker compose down
```

Tetapi akan hilang jika:

```bash
docker compose down -v
```

---

## 6. Compose File Minimal

Compose file modern biasanya bernama:

```text
compose.yaml
```

atau:

```text
docker-compose.yml
```

Dokumentasi Docker modern cenderung memakai `compose.yaml`.

Contoh minimal:

```yaml
services:
  hello:
    image: hello-world
```

Jalankan:

```bash
docker compose up
```

Ini membuat satu service bernama `hello`.

Tetapi untuk Java engineer, contoh lebih realistis adalah service Java + PostgreSQL.

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres-data:
```

Dengan file ini:

- Compose membuild Java app dari Dockerfile.
- Compose menjalankan PostgreSQL dari image registry.
- App dapat menghubungi PostgreSQL melalui hostname `postgres`.
- Port app dipublish ke host di `localhost:8080`.
- Port PostgreSQL dipublish ke host di `localhost:5432` untuk tool lokal seperti DBeaver atau psql.
- PostgreSQL menyimpan data di named volume `postgres-data`.
- App menunggu PostgreSQL healthy sebelum start.

---

## 7. Service Discovery: Nama Service Adalah DNS Name

Salah satu fitur paling penting Compose adalah embedded DNS.

Di dalam Compose network, service dapat saling resolve berdasarkan service name.

Jika ada service:

```yaml
services:
  postgres:
    image: postgres:16
```

maka service lain dapat memakai hostname:

```text
postgres
```

Contoh JDBC URL:

```text
jdbc:postgresql://postgres:5432/appdb
```

Bukan:

```text
jdbc:postgresql://localhost:5432/appdb
```

Kenapa?

Karena dari dalam container `app`, `localhost` berarti container `app` itu sendiri, bukan host, dan bukan container `postgres`.

Ini adalah salah satu penyebab bug lokal paling umum.

### 7.1 Perspektif Host vs Perspektif Container

Dari laptop host:

```text
localhost:5432 -> published port di host -> postgres container
```

Dari container app:

```text
postgres:5432 -> Docker DNS -> postgres container IP
```

Jika app dalam container memakai `localhost:5432`, ia akan mencari PostgreSQL di container app sendiri.

Biasanya hasilnya:

```text
Connection refused
```

atau timeout.

### 7.2 Rule Praktis

Gunakan ini:

```text
Inside Compose network: service-name:container-port
From host machine: localhost:published-host-port
```

Contoh:

```text
Java container -> PostgreSQL: postgres:5432
Host DBeaver  -> PostgreSQL: localhost:5432
Browser host  -> Java app: localhost:8080
Other container -> Java app: app:8080
```

---

## 8. Ports: Published Port Bukan Service Discovery Antar Container

Di Compose:

```yaml
ports:
  - "8080:8080"
```

Format umumnya:

```text
HOST_PORT:CONTAINER_PORT
```

Artinya port container `8080` dipublish ke port host `8080`.

Ini berguna untuk akses dari host:

```text
http://localhost:8080
```

Tetapi antar container tidak perlu published port.

Jika service `app` expose port 8080 secara internal, service lain di network yang sama bisa akses:

```text
http://app:8080
```

Tanpa perlu:

```yaml
ports:
  - "8080:8080"
```

`ports` adalah untuk host-to-container access.

Container-to-container access memakai Docker network.

### 8.1 `expose` vs `ports`

Compose juga punya `expose`:

```yaml
services:
  app:
    expose:
      - "8080"
```

`expose` mendokumentasikan atau membuka port ke service lain dalam network, tetapi tidak publish ke host.

Namun dalam user-defined bridge network, container lain tetap bisa mengakses container port jika app bind ke interface yang benar. Jadi `expose` sering lebih bersifat dokumentatif dalam banyak workflow Compose.

Rule praktis:

- Gunakan `ports` jika butuh akses dari host.
- Tidak perlu `ports` untuk dependency internal.
- Jangan publish semua dependency kalau tidak perlu.

Contoh local dev:

```yaml
services:
  app:
    ports:
      - "8080:8080"

  postgres:
    ports:
      - "5432:5432" # hanya jika tool host perlu akses DB

  redis:
    # tidak dipublish jika hanya app yang pakai
```

---

## 9. Bind Address: Jangan Publish ke Semua Interface Jika Tidak Perlu

Default:

```yaml
ports:
  - "8080:8080"
```

sering berarti service dipublish ke semua interface host.

Untuk local dev yang lebih aman, kamu bisa bind ke loopback:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

Artinya hanya host lokal yang bisa mengakses.

Untuk database lokal:

```yaml
ports:
  - "127.0.0.1:5432:5432"
```

Ini lebih aman daripada membiarkan database dev terbuka ke network kantor/kafe/VPN tanpa sengaja.

### 9.1 Decision Rule

Gunakan:

```yaml
"127.0.0.1:HOST_PORT:CONTAINER_PORT"
```

untuk service yang hanya perlu diakses dari laptop sendiri.

Gunakan:

```yaml
"HOST_PORT:CONTAINER_PORT"
```

hanya jika memang perlu diakses dari interface lain.

---

## 10. `depends_on`: Startup Order Bukan Selalu Readiness

Banyak engineer salah memahami `depends_on`.

Contoh:

```yaml
services:
  app:
    depends_on:
      - postgres
```

Ini memastikan Compose membuat/start `postgres` sebelum `app`.

Tetapi “container PostgreSQL sudah started” tidak sama dengan “database sudah siap menerima koneksi”.

Database bisa butuh waktu untuk:

- initialize data directory,
- run startup script,
- recover WAL,
- apply migration,
- open TCP socket,
- accept authentication,
- become ready for queries.

Jika app start terlalu cepat, app bisa gagal dengan:

```text
Connection refused
```

atau:

```text
the database system is starting up
```

### 10.1 Healthcheck-Aware `depends_on`

Compose mendukung bentuk condition:

```yaml
services:
  app:
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 20
```

Dengan ini, `app` menunggu `postgres` healthy, bukan hanya started.

### 10.2 Tetapi Healthcheck Bukan Pengganti Resilience

Walaupun Compose bisa menunggu dependency healthy saat startup, aplikasi tetap harus tahan terhadap dependency failure saat runtime.

Kenapa?

Karena dependency bisa mati setelah app started.

Misalnya:

1. PostgreSQL healthy saat app start.
2. App berhasil connect.
3. PostgreSQL restart.
4. App harus reconnect, retry, atau degrade gracefully.

Compose `depends_on` tidak menjamin dependency terus healthy selamanya.

Application resilience tetap tanggung jawab aplikasi.

### 10.3 Rule Praktis

- Gunakan `depends_on.condition: service_healthy` untuk mengurangi startup race lokal.
- Tetap implement retry/backoff di aplikasi Java.
- Jangan jadikan Compose startup order sebagai satu-satunya reliability mechanism.

---

## 11. Healthcheck Dalam Compose

Healthcheck dapat didefinisikan pada service:

```yaml
services:
  app:
    image: order-service:local
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 30s
```

Tetapi ada masalah: tidak semua image punya `curl`.

Untuk image minimal, command ini bisa gagal bukan karena app unhealthy, tetapi karena binary `curl` tidak ada.

Alternatif:

1. Gunakan binary yang ada di image.
2. Tambahkan healthcheck di image yang memang punya tooling.
3. Gunakan Java-based healthcheck jar kecil hanya jika benar-benar perlu.
4. Untuk local Compose, kadang healthcheck dependency lebih penting daripada healthcheck app.

### 11.1 Healthcheck PostgreSQL

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
  interval: 5s
  timeout: 3s
  retries: 20
```

### 11.2 Healthcheck Redis

```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 5s
  timeout: 3s
  retries: 20
```

### 11.3 Healthcheck HTTP Service

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://localhost:8080/actuator/health | grep UP"]
  interval: 10s
  timeout: 3s
  retries: 12
  start_period: 30s
```

Tetapi ini hanya valid jika `wget` ada.

### 11.4 Healthcheck Design Principle

Healthcheck yang baik harus:

- murah,
- cepat,
- deterministic,
- tidak membuat side effect,
- tidak membutuhkan dependency eksternal yang tidak perlu,
- tidak terlalu agresif,
- tidak memberi false positive,
- tidak memberi false negative berlebihan.

Untuk Compose lokal, healthcheck biasanya dipakai untuk readiness dependency, bukan untuk high-availability healing.

---

## 12. Environment Variable di Compose

Ada beberapa cara memasukkan environment variable.

### 12.1 Inline `environment`

```yaml
services:
  app:
    environment:
      SPRING_PROFILES_ACTIVE: docker
      SERVER_PORT: 8080
```

atau:

```yaml
services:
  app:
    environment:
      - SPRING_PROFILES_ACTIVE=docker
      - SERVER_PORT=8080
```

Map style lebih mudah direview:

```yaml
environment:
  SPRING_PROFILES_ACTIVE: docker
  SERVER_PORT: 8080
```

### 12.2 `env_file`

```yaml
services:
  app:
    env_file:
      - .env.app
```

Isi `.env.app`:

```env
SPRING_PROFILES_ACTIVE=docker
SERVER_PORT=8080
```

### 12.3 `.env` Untuk Variable Substitution Compose

File `.env` di direktori Compose sering digunakan untuk substitusi variable di Compose file:

```env
APP_PORT=8080
POSTGRES_PORT=5432
```

Lalu:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:${APP_PORT}:8080"

  postgres:
    ports:
      - "127.0.0.1:${POSTGRES_PORT}:5432"
```

Penting:

- `.env` untuk Compose interpolation bukan selalu sama dengan env yang masuk ke container.
- `env_file` memasukkan variable ke container.
- `environment` memasukkan variable ke container dan dapat override.

### 12.4 Java/Spring Boot Mapping

Spring Boot dapat membaca environment variable seperti:

```env
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/appdb
SPRING_DATASOURCE_USERNAME=app
SPRING_DATASOURCE_PASSWORD=app
```

atau:

```env
SPRING_DATA_REDIS_HOST=redis
SPRING_DATA_REDIS_PORT=6379
```

Compose membantu membuat konfigurasi runtime eksplisit.

### 12.5 Anti-Pattern: Hardcode Hostname Lokal di Application Config

Jangan membuat config default seperti:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/appdb
```

lalu menjalankan app di container.

Lebih baik:

```properties
spring.datasource.url=${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/appdb}
```

Lalu Compose menginject:

```yaml
environment:
  SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
```

Dengan begitu:

- running local tanpa container masih bisa pakai localhost,
- running dalam Compose pakai service name.

---

## 13. Build di Compose

Compose dapat menjalankan image yang sudah ada atau build image dari source.

### 13.1 Simple Build

```yaml
services:
  app:
    build: .
```

Sama dengan:

```yaml
services:
  app:
    build:
      context: .
```

### 13.2 Explicit Dockerfile

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
```

### 13.3 Build Args

```yaml
services:
  app:
    build:
      context: .
      args:
        JAR_FILE: build/libs/app.jar
```

Ingat:

```text
ARG = build-time
ENV = runtime
```

Jangan pakai `ARG` untuk secret.

### 13.4 Image Tag dari Build

```yaml
services:
  app:
    build: .
    image: order-service:local
```

Ini useful karena hasil build punya tag eksplisit.

### 13.5 Rebuild Behavior

Command umum:

```bash
docker compose build
```

```bash
docker compose up --build
```

```bash
docker compose up --build --force-recreate
```

Perbedaan penting:

- `build` hanya membuild image.
- `up --build` membuild lalu menjalankan.
- `--force-recreate` membuat container baru walaupun config terlihat tidak berubah.

### 13.6 Failure Mode Java

Kamu mengubah source Java, tetapi container masih menjalankan versi lama.

Kemungkinan:

1. Image belum dibuild ulang.
2. Dockerfile cache tidak invalidated.
3. Compose memakai image tag lama.
4. Volume/bind mount menutupi file dalam image.
5. Spring Boot devtools/live reload tidak dikonfigurasi.
6. Kamu menjalankan container dari project Compose lain.

Diagnosis:

```bash
docker compose build --no-cache app

docker compose up --force-recreate app

docker compose images

docker compose ps

docker inspect <container>
```

---

## 14. Volumes Dalam Compose

Ada dua tipe utama yang sering dipakai:

1. Named volume.
2. Bind mount.

### 14.1 Named Volume

```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

Cocok untuk state managed by Docker:

- database data directory,
- cache dependency,
- tool state,
- local persistent state.

Kelebihan:

- dikelola Docker,
- lebih portable antar OS,
- tidak tergantung host path spesifik,
- umumnya lebih baik untuk DB dibanding bind mount di Docker Desktop.

Kekurangan:

- lokasi fisik tidak langsung jelas,
- perlu command Docker untuk inspect/remove,
- bisa menjadi stale state jika lupa reset.

### 14.2 Bind Mount

```yaml
services:
  app:
    volumes:
      - ./src:/workspace/src
```

Cocok untuk:

- source code development,
- config lokal,
- test fixture,
- mounting file tunggal.

Kelebihan:

- langsung terlihat di host,
- cocok untuk edit source live,
- mudah dikontrol dengan Git.

Kekurangan:

- permission mismatch,
- path OS-specific,
- performa buruk di Docker Desktop untuk banyak file,
- bisa menutupi file yang sudah ada di image,
- bisa membuat environment lokal berbeda dari CI.

### 14.3 Bind Mount Menutupi File Image

Misalnya Dockerfile membuat:

```text
/app/app.jar
```

Compose:

```yaml
services:
  app:
    volumes:
      - .:/app
```

Jika host directory `.` tidak punya `app.jar`, maka `/app/app.jar` dari image tertutup oleh bind mount.

Akibatnya container gagal:

```text
Unable to access jarfile /app/app.jar
```

Ini bukan bug Java. Ini mount semantics.

### 14.4 Reset Volume

```bash
docker compose down -v
```

Menghapus container, network, dan named volume project.

Gunakan hati-hati karena data hilang.

Untuk reset dependency lokal, ini sering intentional:

```bash
docker compose down -v

docker compose up --build
```

### 14.5 Rule Praktis

- Database local: named volume.
- Source code hot reload: bind mount.
- Config file lokal: bind mount file spesifik.
- Secret file dev: bind mount file spesifik dengan permission benar.
- Jangan mount project root ke runtime image production-like kecuali benar-benar paham efeknya.

---

## 15. Compose Networks

Jika tidak ada network didefinisikan:

```yaml
services:
  app:
    image: app
  postgres:
    image: postgres:16
```

Compose membuat default network.

Untuk banyak kasus lokal, ini cukup.

Tetapi network eksplisit berguna untuk:

- memisahkan dependency internal dan edge service,
- mengontrol service mana yang bisa saling bicara,
- membuat topology lebih jelas,
- memberi nama network predictable,
- menghubungkan ke external network.

### 15.1 Network Eksplisit

```yaml
services:
  app:
    image: order-service:local
    networks:
      - backend
      - edge

  postgres:
    image: postgres:16
    networks:
      - backend

  reverse-proxy:
    image: nginx:alpine
    networks:
      - edge

networks:
  backend:
  edge:
```

Artinya:

- `app` bisa bicara ke `postgres` via `backend`.
- `reverse-proxy` bisa bicara ke `app` via `edge`.
- `reverse-proxy` tidak langsung berada di network `backend`.

Ini adalah model segmentation sederhana.

### 15.2 External Network

Kadang beberapa Compose project perlu share network.

```yaml
networks:
  shared-dev:
    external: true
```

Lalu buat network manual:

```bash
docker network create shared-dev
```

Gunakan dengan hati-hati. External network dapat membuat coupling antar project.

### 15.3 Anti-Pattern: Semua Service di Semua Network

```yaml
services:
  app:
    networks: [default, backend, edge, monitoring, shared]
```

Kalau semua service ada di semua network, network segmentation menjadi meaningless.

Rule:

> Service seharusnya hanya join network yang benar-benar dibutuhkan.

---

## 16. Compose Profiles

Profiles memungkinkan service tertentu hanya aktif saat profile dipilih.

Contoh:

```yaml
services:
  app:
    build: .
    ports:
      - "127.0.0.1:8080:8080"

  postgres:
    image: postgres:16

  redis:
    image: redis:7

  mailpit:
    image: axllent/mailpit
    profiles:
      - tools
    ports:
      - "127.0.0.1:8025:8025"

  adminer:
    image: adminer
    profiles:
      - tools
    ports:
      - "127.0.0.1:8081:8080"
```

Default:

```bash
docker compose up
```

menjalankan:

- app,
- postgres,
- redis.

Dengan tools:

```bash
docker compose --profile tools up
```

menjalankan juga:

- mailpit,
- adminer.

### 16.1 Profile Untuk Mode Lokal

Contoh profile:

```text
default       -> app + core dependencies
tools         -> admin UI, mail viewer, debug tool
observability -> prometheus, grafana, jaeger
mock          -> external service mocks
full          -> semua dependency berat
```

### 16.2 Kenapa Profiles Penting

Tanpa profiles, Compose file sering menjadi berat:

- semua dependency naik walau tidak dibutuhkan,
- startup lambat,
- laptop berat,
- port conflict lebih sering,
- debug noise tinggi.

Profiles memberi kemampuan membuat environment modular.

### 16.3 Anti-Pattern Profile

Jangan membuat profile terlalu banyak sampai engineer bingung kombinasi mana valid.

Buruk:

```text
postgres
postgres-admin
redis
redis-admin
kafka
kafka-ui
mail
mock-a
mock-b
mock-c
payment
observability
local
local2
fullish
ciish
```

Lebih baik sedikit tapi bermakna:

```text
tools
mocks
observability
full
```

---

## 17. Multiple Compose Files

Compose dapat merge beberapa file.

Contoh:

```bash
docker compose -f compose.yaml -f compose.override.yaml up
```

Default behavior juga sering membaca `compose.override.yaml` jika ada.

### 17.1 Base + Override

`compose.yaml`:

```yaml
services:
  app:
    image: order-service:local
    environment:
      SPRING_PROFILES_ACTIVE: docker

  postgres:
    image: postgres:16
```

`compose.override.yaml`:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./config/local:/app/config

  postgres:
    ports:
      - "127.0.0.1:5432:5432"
```

Base file mendeskripsikan topology utama. Override file mendeskripsikan kebutuhan lokal developer.

### 17.2 CI Override

`compose.ci.yaml`:

```yaml
services:
  app:
    environment:
      SPRING_PROFILES_ACTIVE: ci

  postgres:
    tmpfs:
      - /var/lib/postgresql/data
```

Run:

```bash
docker compose -f compose.yaml -f compose.ci.yaml up --abort-on-container-exit
```

### 17.3 Risk Merge

Merge Compose file bisa membingungkan jika terlalu banyak layer.

Failure mode:

- port muncul dari override yang lupa,
- env berubah diam-diam,
- volume override menutupi image,
- service aktif karena profile/file lain,
- CI memakai file berbeda dari local.

Rule:

> Multiple Compose files berguna, tetapi jangan sampai topology efektif tidak bisa lagi dibaca manusia.

Gunakan command berikut untuk melihat hasil final merge:

```bash
docker compose config
```

Ini salah satu command paling penting.

---

## 18. `docker compose config`: Source of Truth Efektif

Compose file bisa memakai:

- variable interpolation,
- default value,
- env file,
- override file,
- profiles,
- extension fields,
- anchors.

Yang kamu tulis bukan selalu yang dijalankan.

Gunakan:

```bash
docker compose config
```

untuk melihat konfigurasi efektif setelah Compose memproses file.

Contoh:

```bash
docker compose --profile tools config
```

Ini membantu menjawab:

- env apa yang benar-benar masuk?
- port apa yang benar-benar dipublish?
- service apa yang aktif?
- volume apa yang dimount?
- network apa yang terbentuk?
- image/build config apa yang dipakai?

Untuk debugging Compose, command ini setara dengan `docker inspect` untuk container.

---

## 19. Lifecycle Command Compose

### 19.1 `up`

```bash
docker compose up
```

Membuat dan menjalankan service.

Dengan detached mode:

```bash
docker compose up -d
```

Dengan build:

```bash
docker compose up --build
```

Dengan recreate:

```bash
docker compose up --force-recreate
```

### 19.2 `down`

```bash
docker compose down
```

Menghapus container dan network project.

Volume tidak dihapus secara default.

Dengan volume:

```bash
docker compose down -v
```

### 19.3 `stop` dan `start`

```bash
docker compose stop
```

Menghentikan container tanpa menghapus.

```bash
docker compose start
```

Menjalankan container yang sudah ada.

### 19.4 `restart`

```bash
docker compose restart app
```

Restart service tertentu.

### 19.5 `logs`

```bash
docker compose logs -f app
```

Atau semua service:

```bash
docker compose logs -f
```

Dengan timestamp:

```bash
docker compose logs -f --timestamps
```

### 19.6 `exec`

Masuk ke running container:

```bash
docker compose exec app sh
```

atau:

```bash
docker compose exec postgres psql -U app -d appdb
```

### 19.7 `run`

Menjalankan one-off command:

```bash
docker compose run --rm app ./gradlew test
```

atau migration:

```bash
docker compose run --rm app ./gradlew flywayMigrate
```

Bedakan:

```text
exec -> command di container service yang sudah running
run  -> membuat container baru untuk one-off command
```

### 19.8 `ps`

```bash
docker compose ps
```

Melihat status service/container project.

### 19.9 `pull`

```bash
docker compose pull
```

Menarik image dependency terbaru sesuai tag.

### 19.10 `build`

```bash
docker compose build
```

Build image service yang punya `build`.

---

## 20. One-Off Task: Migration, Seed, Test Runner

Compose sering dipakai bukan hanya untuk long-running services, tetapi juga task singkat.

Contoh migration runner:

```yaml
services:
  app:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app

  migrate:
    build: .
    command: ["java", "-jar", "app.jar", "--spring.profiles.active=migration"]
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app
    profiles:
      - tools

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 20
```

Run:

```bash
docker compose run --rm migrate
```

Tetapi hati-hati: migration as separate service bisa membuat lifecycle ambigu. Dalam banyak Spring Boot app, migration biasanya dijalankan oleh app startup melalui Flyway/Liquibase.

Decision:

- App startup migration: simple local dev.
- Separate migration runner: lebih eksplisit, mendekati deployment pipeline.
- Manual migration: riskan untuk team besar.

---

## 21. Compose untuk Java Service: Baseline Pattern

Berikut contoh baseline yang cukup realistis.

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: order-service:local
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: docker
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/orderdb
      SPRING_DATASOURCE_USERNAME: order
      SPRING_DATASOURCE_PASSWORD: order
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PORT: 6379
      SERVER_SHUTDOWN: graceful
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - backend

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: orderdb
      POSTGRES_USER: order
      POSTGRES_PASSWORD: order
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U order -d orderdb"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks:
      - backend

  redis:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks:
      - backend

  mailpit:
    image: axllent/mailpit
    profiles:
      - tools
    ports:
      - "127.0.0.1:8025:8025"
    networks:
      - backend

networks:
  backend:

volumes:
  postgres-data:
```

Yang bagus dari contoh ini:

1. Service name dipakai sebagai hostname internal.
2. Port host bind ke `127.0.0.1`.
3. Database memakai named volume.
4. Dependency utama punya healthcheck.
5. Tools tambahan ada di profile.
6. Network eksplisit.
7. App config runtime masuk lewat environment.
8. Image app diberi tag lokal eksplisit.

Yang masih belum production-grade:

1. Password dev masih hardcoded.
2. Belum ada secret management.
3. Belum ada resource limit.
4. Belum ada observability stack.
5. Belum ada migration model eksplisit.
6. Belum ada CI-specific override.

Untuk local development, baseline ini cukup kuat.

---

## 22. Startup Race: Studi Kasus

Masalah:

```text
App gagal start karena database belum siap.
```

Compose file:

```yaml
services:
  app:
    depends_on:
      - postgres

  postgres:
    image: postgres:16
```

Log app:

```text
org.postgresql.util.PSQLException: Connection to postgres:5432 refused
```

Engineer junior sering berpikir:

> Tapi sudah ada `depends_on`, kenapa masih gagal?

Karena `depends_on` bentuk list hanya mengatur startup order, bukan readiness database.

Perbaikan:

```yaml
services:
  app:
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 20
```

Tetapi aplikasi tetap harus punya retry.

Spring Boot datasource/HikariCP dapat dikonfigurasi agar startup tidak terlalu rapuh, tetapi detail Spring bukan fokus utama part ini.

Mental model:

```text
Compose healthcheck reduces startup race.
Application resilience handles runtime dependency volatility.
```

---

## 23. Stale Volume: Studi Kasus

Masalah:

```text
App migration gagal karena schema sudah ada / versi DB lama / data corrupt.
```

Compose:

```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

Engineer mengubah:

```yaml
POSTGRES_DB: newdb
POSTGRES_USER: newuser
```

Tetapi database tetap memakai state lama.

Kenapa?

Karena environment variable PostgreSQL initialization hanya berlaku saat data directory pertama kali dibuat. Jika volume sudah punya data, init tidak dijalankan ulang.

Solusi reset:

```bash
docker compose down -v

docker compose up
```

Atau hapus volume spesifik:

```bash
docker volume ls

docker volume rm <project>_postgres-data
```

Rule:

> Jika perubahan environment seharusnya mempengaruhi initialization dependency stateful, cek apakah volume lama masih dipakai.

---

## 24. Port Collision: Studi Kasus

Masalah:

```text
Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:5432
```

Kemungkinan:

1. PostgreSQL lokal sudah jalan di host.
2. Compose project lain sudah publish 5432.
3. Container lama masih hidup.
4. Port dipakai service sistem.

Diagnosis:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

```bash
docker compose ps
```

Linux/macOS:

```bash
lsof -i :5432
```

Solusi:

```yaml
ports:
  - "127.0.0.1:15432:5432"
```

Kemudian dari host:

```text
localhost:15432
```

Tetapi dari app container tetap:

```text
postgres:5432
```

Jangan mengubah JDBC URL container menjadi `postgres:15432`. Published host port tidak relevan untuk komunikasi container-to-container.

---

## 25. `localhost` Trap: Studi Kasus

Masalah:

```text
App dalam container tidak bisa connect ke Redis.
```

Environment:

```yaml
environment:
  SPRING_DATA_REDIS_HOST: localhost
```

Compose:

```yaml
services:
  app:
    image: app
  redis:
    image: redis:7
```

Dari dalam app container:

```text
localhost = app container itself
```

Solusi:

```yaml
environment:
  SPRING_DATA_REDIS_HOST: redis
```

Rule:

```text
Inside Compose: use service name.
From host: use localhost + published port.
```

---

## 26. App Bind Trap: Studi Kasus

Masalah:

```text
Container running, port published, tetapi browser host tidak bisa akses app.
```

Compose:

```yaml
services:
  app:
    ports:
      - "8080:8080"
```

App log:

```text
Started server on 127.0.0.1:8080
```

Jika app bind ke `127.0.0.1` di dalam container, ia hanya listen di loopback container. Docker port publishing tidak bisa forward ke app yang hanya bind loopback container dengan cara yang diharapkan untuk external access.

Solusi:

App harus bind ke all interfaces:

```text
0.0.0.0:8080
```

Spring Boot default biasanya bind ke semua interface jika tidak diubah. Tetapi custom server config bisa mengubahnya.

Cek config:

```properties
server.address=0.0.0.0
```

atau hapus konfigurasi yang memaksa:

```properties
server.address=127.0.0.1
```

---

## 27. Compose as Executable Documentation

Compose file adalah dokumentasi yang bisa dijalankan.

Dokumentasi biasa berkata:

```text
Install PostgreSQL 16, create database orderdb, create user order, run Redis, configure app env.
```

Compose berkata:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: orderdb
      POSTGRES_USER: order
      POSTGRES_PASSWORD: order

  redis:
    image: redis:7

  app:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/orderdb
      SPRING_DATA_REDIS_HOST: redis
```

Perbedaannya besar.

Dokumentasi biasa bisa basi.

Compose file akan langsung gagal jika salah.

Itulah mengapa Compose file sebaiknya direview seperti code.

Pertanyaan review:

1. Apakah service name stabil dan bermakna?
2. Apakah port yang dipublish memang perlu?
3. Apakah dependency stateful memakai volume yang jelas?
4. Apakah healthcheck benar-benar valid untuk image tersebut?
5. Apakah config app memakai service name, bukan localhost?
6. Apakah secret dev tidak accidentally menyerupai secret production?
7. Apakah profile membuat environment modular?
8. Apakah command reset jelas?
9. Apakah Compose file bisa dipakai engineer baru tanpa tribal knowledge?
10. Apakah `docker compose config` mudah dibaca?

---

## 28. Compose File Quality Heuristics

Compose file yang baik memiliki sifat berikut.

### 28.1 Explicit

Buruk:

```yaml
services:
  app:
    build: .
    network_mode: host
```

Tanpa alasan, ini menghapus banyak boundary networking.

Lebih baik:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "127.0.0.1:8080:8080"
    networks:
      - backend
```

### 28.2 Minimal

Jangan menjalankan semua dependency jika tidak perlu.

Gunakan profile.

### 28.3 Deterministic

Hindari dependency pada state host yang tidak jelas.

Buruk:

```yaml
volumes:
  - ~/some/random/path:/data
```

Lebih baik:

```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data
```

### 28.4 Diagnosable

Service harus punya nama jelas:

```yaml
services:
  postgres:
  redis:
  mailpit:
  payment-mock:
```

Bukan:

```yaml
services:
  db:
  cache:
  service1:
  thing:
```

Kecuali konteksnya memang kecil.

### 28.5 Secure Enough for Local

Local bukan berarti bebas careless.

Minimal:

- bind port sensitif ke `127.0.0.1`,
- jangan commit secret asli,
- jangan publish DB ke semua interface,
- jangan mount Docker socket kecuali sangat sadar risikonya,
- jangan pakai privileged container tanpa alasan.

---

## 29. Anti-Pattern Compose

### 29.1 Menganggap Compose sebagai Production Orchestrator Penuh

Compose bisa dipakai untuk single-host production sederhana, tetapi jangan menganggap ia otomatis memberi:

- multi-node failover,
- rolling deployment aman,
- autoscaling,
- secret rotation,
- policy enforcement.

### 29.2 Menggunakan `localhost` Antar Service

Buruk:

```yaml
environment:
  SPRING_DATASOURCE_URL: jdbc:postgresql://localhost:5432/appdb
```

Baik:

```yaml
environment:
  SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
```

### 29.3 Publish Semua Port

Buruk:

```yaml
postgres:
  ports:
    - "5432:5432"
redis:
  ports:
    - "6379:6379"
kafka:
  ports:
    - "9092:9092"
elasticsearch:
  ports:
    - "9200:9200"
```

Kalau hanya app yang butuh Redis, jangan publish Redis.

### 29.4 Tidak Ada Healthcheck Dependency

Buruk:

```yaml
app:
  depends_on:
    - postgres
```

Lebih baik:

```yaml
app:
  depends_on:
    postgres:
      condition: service_healthy
```

### 29.5 Volume Lama Tidak Pernah Direset

Gejala:

- schema mismatch,
- migration gagal,
- data lama muncul,
- user/password tidak berubah,
- init script tidak rerun.

Solusi:

```bash
docker compose down -v
```

### 29.6 Bind Mount Project Root Tanpa Sadar

Buruk untuk runtime image production-like:

```yaml
volumes:
  - .:/app
```

Ini bisa menutupi artifact yang dibuild dalam image.

### 29.7 Hardcode Container Name

```yaml
container_name: postgres
```

Ini terlihat nyaman, tetapi sering menyebabkan collision antar project dan merusak scaling semantics.

Lebih baik gunakan service name dan project name.

Gunakan `container_name` hanya jika ada alasan kuat.

### 29.8 Terlalu Banyak Magic Override

Jika environment efektif hanya bisa dipahami dengan membaca 5 Compose file, 3 `.env`, dan shell wrapper, sistem lokal sudah terlalu kompleks.

Gunakan:

```bash
docker compose config
```

sebagai sanity check.

---

## 30. Compose Debugging Playbook

Saat sistem Compose bermasalah, jangan langsung tebak. Ikuti urutan ini.

### 30.1 Lihat Service Status

```bash
docker compose ps
```

Perhatikan:

- service running atau exited,
- health status,
- port mapping,
- container name.

### 30.2 Lihat Logs

```bash
docker compose logs -f
```

Service spesifik:

```bash
docker compose logs -f app
```

### 30.3 Lihat Config Efektif

```bash
docker compose config
```

Cari:

- env salah,
- port salah,
- volume mount salah,
- profile tidak aktif,
- network tidak sesuai.

### 30.4 Inspect Container

```bash
docker compose ps -q app
```

```bash
docker inspect $(docker compose ps -q app)
```

### 30.5 Test DNS dari Dalam Container

```bash
docker compose exec app sh
```

Lalu:

```sh
getent hosts postgres
```

Jika image tidak punya tools, pakai debug container di network yang sama.

### 30.6 Test TCP Connectivity

Dari app container:

```sh
nc -vz postgres 5432
```

atau jika tidak ada `nc`, gunakan tool yang tersedia.

### 30.7 Cek App Binding

Di container app:

```sh
ss -ltnp
```

atau:

```sh
netstat -ltnp
```

Jika tidak ada tool, gunakan logs app atau debug image.

Cari apakah app listen di:

```text
0.0.0.0:8080
```

bukan hanya:

```text
127.0.0.1:8080
```

### 30.8 Cek Volume

```bash
docker volume ls
```

```bash
docker volume inspect <volume>
```

Reset jika perlu:

```bash
docker compose down -v
```

### 30.9 Recreate Clean

```bash
docker compose down -v --remove-orphans

docker compose build --no-cache app

docker compose up
```

Gunakan `--no-cache` hanya saat diagnosis atau clean rebuild, bukan default harian.

---

## 31. Compose Command Patterns Untuk Team Java

Untuk team, sebaiknya ada command yang konsisten, misalnya via README atau wrapper.

Contoh command manual:

```bash
# Start core stack
docker compose up -d

# Start with tools
docker compose --profile tools up -d

# See logs
docker compose logs -f app

# Rebuild app
docker compose up --build app

# Reset all local state
docker compose down -v --remove-orphans

# Run tests in container
docker compose run --rm app ./gradlew test

# Open DB shell
docker compose exec postgres psql -U order -d orderdb

# See effective config
docker compose config
```

Poin penting: command ini sebaiknya menjadi bagian dari onboarding.

Engineer baru tidak seharusnya menebak:

- service apa yang perlu dijalankan,
- profile apa yang harus aktif,
- port apa yang dipakai,
- cara reset state,
- cara lihat logs,
- cara masuk DB.

Compose menjadi kontrak workflow team.

---

## 32. Compose dan CI

Compose bisa dipakai di CI untuk integration test, tetapi perlu disiplin.

Contoh pattern:

```bash
docker compose -f compose.yaml -f compose.ci.yaml up -d postgres redis

./gradlew integrationTest

docker compose -f compose.yaml -f compose.ci.yaml down -v
```

Atau:

```bash
docker compose -f compose.yaml -f compose.ci.yaml up --build --abort-on-container-exit --exit-code-from app-test
```

Service test:

```yaml
services:
  app-test:
    build: .
    command: ["./gradlew", "integrationTest"]
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/testdb
```

### 32.1 CI Risks

- Port collision dengan service lain di runner.
- Volume state tidak bersih.
- Image pull lambat.
- Network cleanup gagal.
- Architecture mismatch.
- Secret leakage in logs.
- Test flakiness karena readiness buruk.

### 32.2 CI Rule

Untuk CI, lebih baik:

- minimize published ports,
- rely on internal service DNS,
- use unique project name,
- always cleanup with `down -v`,
- use healthchecks,
- avoid host-specific bind mounts,
- avoid reusing dirty volumes.

Contoh project name unik:

```bash
COMPOSE_PROJECT_NAME=order_${CI_PIPELINE_ID} docker compose up -d
```

---

## 33. Compose vs Testcontainers

Sebagai Java engineer, kamu kemungkinan akan bertemu Compose dan Testcontainers.

Keduanya berguna, tetapi berbeda.

### 33.1 Compose Cocok Untuk

- local development full stack,
- onboarding,
- manual exploration,
- demo environment,
- menjalankan app plus dependency,
- environment yang ingin dilihat manusia.

### 33.2 Testcontainers Cocok Untuk

- automated integration test,
- dependency ephemeral per test suite,
- dynamic ports,
- isolation kuat,
- test parallelization,
- programmatic lifecycle.

### 33.3 Decision Matrix

| Kebutuhan | Compose | Testcontainers |
|---|---:|---:|
| Developer menjalankan stack lokal | Sangat cocok | Bisa, tapi bukan utama |
| Integration test di JUnit | Bisa | Sangat cocok |
| Dynamic isolated dependency per test | Kurang ideal | Sangat cocok |
| Visual topology untuk team | Sangat cocok | Kurang |
| Full system demo | Sangat cocok | Kurang |
| CI deterministic test dependency | Bisa | Sangat cocok |
| Debug manual dependency | Sangat cocok | Bisa tapi lebih programmatic |

Keduanya bisa hidup bersama:

- Compose untuk local platform.
- Testcontainers untuk automated integration tests.

Part Testcontainers akan dibahas lebih spesifik di Part 023.

---

## 34. Compose Design Review: Pertanyaan Senior Engineer

Saat mereview `compose.yaml`, tanyakan:

### Service

1. Apakah nama service mencerminkan perannya?
2. Apakah service terlalu banyak concern?
3. Apakah ada service yang harusnya profile-only?
4. Apakah ada service yang sebenarnya one-off task?

### Image / Build

1. Apakah image tag terlalu floating?
2. Apakah build context terlalu besar?
3. Apakah Dockerfile yang dipakai jelas?
4. Apakah app image diberi tag lokal eksplisit?

### Network

1. Apakah antar service memakai service name?
2. Apakah app masih memakai `localhost` untuk dependency?
3. Apakah network segmentation diperlukan?
4. Apakah ada external network yang menciptakan hidden coupling?

### Ports

1. Apakah port yang dipublish benar-benar perlu?
2. Apakah port sensitif dibind ke `127.0.0.1`?
3. Apakah host port konflik dengan service lokal umum?
4. Apakah container-to-container config salah memakai host port?

### Volumes

1. Apakah stateful dependency memakai named volume?
2. Apakah bind mount menutupi artifact image?
3. Apakah reset strategy jelas?
4. Apakah volume lama bisa mempengaruhi hasil test?

### Health

1. Apakah dependency stateful punya healthcheck?
2. Apakah healthcheck command tersedia dalam image?
3. Apakah retry/start_period realistis?
4. Apakah app tetap resilient setelah startup?

### Config

1. Apakah runtime env jelas?
2. Apakah secret asli tidak masuk file?
3. Apakah `.env` dan `env_file` tidak membingungkan?
4. Apakah Spring profile eksplisit?

### Operability

1. Apakah `docker compose logs -f` cukup berguna?
2. Apakah service bisa di-exec untuk diagnosis?
3. Apakah minimal image membuat debugging terlalu sulit?
4. Apakah command onboarding jelas?

---

## 35. Practical Compose Template Untuk Java Service

Berikut template yang bisa dijadikan starting point.

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: my-java-service:local
    ports:
      - "127.0.0.1:${APP_PORT:-8080}:8080"
    environment:
      SPRING_PROFILES_ACTIVE: docker
      SERVER_PORT: 8080
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/${POSTGRES_DB:-appdb}
      SPRING_DATASOURCE_USERNAME: ${POSTGRES_USER:-app}
      SPRING_DATASOURCE_PASSWORD: ${POSTGRES_PASSWORD:-app}
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PORT: 6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - backend

  postgres:
    image: postgres:16
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-appdb}
      POSTGRES_USER: ${POSTGRES_USER:-app}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-app}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-appdb}"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks:
      - backend

  redis:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks:
      - backend

  mailpit:
    image: axllent/mailpit
    profiles:
      - tools
    ports:
      - "127.0.0.1:${MAILPIT_PORT:-8025}:8025"
    networks:
      - backend

networks:
  backend:

volumes:
  postgres-data:
```

Dengan `.env.example`:

```env
APP_PORT=8080
POSTGRES_PORT=5432
POSTGRES_DB=appdb
POSTGRES_USER=app
POSTGRES_PASSWORD=app
MAILPIT_PORT=8025
```

README command:

```bash
cp .env.example .env

docker compose up --build

docker compose --profile tools up -d

docker compose logs -f app

docker compose down -v --remove-orphans
```

---

## 36. Common Mistakes Checklist

Gunakan checklist ini saat Compose environment terasa aneh.

### App Tidak Bisa Connect DB

Cek:

- JDBC URL memakai `postgres`, bukan `localhost`.
- `postgres` service berada di network yang sama.
- PostgreSQL healthy.
- Credential sesuai.
- Volume lama tidak menyimpan user/db lama.
- App start setelah DB ready.

### Browser Tidak Bisa Akses App

Cek:

- `ports` benar.
- App listen di `0.0.0.0`, bukan `127.0.0.1` container.
- Container running.
- App tidak crash setelah start.
- Host port tidak konflik.

### Perubahan Code Tidak Masuk

Cek:

- Image sudah rebuild.
- Dockerfile cache tidak menyimpan artifact lama.
- Compose memakai image/service yang benar.
- Bind mount tidak menutupi artifact.
- Project name tidak salah.

### DB State Tidak Reset

Cek:

- `docker compose down -v` sudah dilakukan.
- Volume project yang benar dihapus.
- External volume tidak masih dipakai.
- Init script hanya jalan pada data directory kosong.

### Service Tidak Muncul

Cek:

- Service berada di profile tertentu.
- Jalankan dengan `--profile`.
- Cek `docker compose config`.

### Env Tidak Sesuai

Cek:

- `.env` interpolation.
- `env_file`.
- `environment` override.
- shell environment host.
- output `docker compose config`.
- output `docker compose exec app env`.

---

## 37. Mental Model Summary

Compose harus dipahami sebagai:

```text
A declarative local system model for multiple containers.
```

Bukan sekadar:

```text
A shorter way to run docker commands.
```

Model inti:

```text
Project
  ├── Services
  │     ├── Image or build definition
  │     ├── Runtime command/config
  │     ├── Environment
  │     ├── Ports
  │     ├── Volumes
  │     ├── Networks
  │     ├── Healthcheck
  │     └── Dependency relation
  ├── Networks
  └── Volumes
```

Service discovery:

```text
container-to-container -> service-name:container-port
host-to-container      -> localhost:published-host-port
```

Startup:

```text
depends_on controls order
healthcheck improves readiness
application resilience still required
```

State:

```text
container is disposable
volume persists
stale volume can explain stale behavior
```

Debugging:

```text
docker compose ps
docker compose logs -f
docker compose config
docker compose exec
docker inspect
```

---

## 38. What Good Looks Like

Compose setup yang matang untuk team Java biasanya punya:

1. `compose.yaml` yang jelas dan minimal.
2. `.env.example` untuk port dan credential dev.
3. Service name yang menjadi hostname internal.
4. Named volume untuk dependency stateful.
5. Healthcheck untuk dependency penting.
6. `depends_on.condition: service_healthy` untuk mengurangi startup race.
7. Ports sensitif bind ke `127.0.0.1`.
8. Profiles untuk tools/mocks/observability.
9. Command reset yang terdokumentasi.
10. Tidak ada secret production.
11. Tidak ada `localhost` antar service.
12. Tidak ada `container_name` tanpa alasan kuat.
13. Bisa divalidasi dengan `docker compose config`.
14. Bisa dijalankan engineer baru dengan sedikit instruksi.
15. Bisa dipakai untuk diagnosis dan bukan hanya happy path.

---

## 39. Latihan Praktis

### Latihan 1 — Minimal Java + PostgreSQL

Buat `compose.yaml` untuk service:

- `app`
- `postgres`

Syarat:

- app build dari Dockerfile lokal,
- app publish `8080` ke host loopback,
- postgres publish `5432` ke host loopback,
- app connect ke `postgres:5432`,
- postgres pakai named volume,
- postgres punya healthcheck,
- app depends on postgres healthy.

Validasi:

```bash
docker compose config

docker compose up --build

docker compose ps

docker compose logs -f app
```

### Latihan 2 — Tambahkan Redis Tanpa Publish Port

Tambahkan service `redis`.

Syarat:

- app connect ke hostname `redis`,
- Redis tidak dipublish ke host,
- Redis punya healthcheck,
- app depends on Redis healthy.

Validasi dari app container:

```bash
docker compose exec app env | grep REDIS
```

### Latihan 3 — Tambahkan Tools Profile

Tambahkan:

- mailpit,
- adminer.

Syarat:

- keduanya hanya aktif dengan profile `tools`,
- port bind ke `127.0.0.1`,
- default `docker compose up` tidak menjalankan tools.

Validasi:

```bash
docker compose ps

docker compose --profile tools up -d

docker compose ps
```

### Latihan 4 — Simulasi Stale Volume

1. Jalankan PostgreSQL dengan `POSTGRES_DB=appdb`.
2. Ubah menjadi `POSTGRES_DB=newdb`.
3. Jalankan ulang tanpa `down -v`.
4. Amati behavior.
5. Reset dengan `down -v`.
6. Jalankan ulang.

Tujuan: memahami bahwa volume stateful bisa mengalahkan ekspektasi dari environment initialization.

### Latihan 5 — Debug `localhost` Trap

Set app env salah:

```yaml
SPRING_DATASOURCE_URL: jdbc:postgresql://localhost:5432/appdb
```

Jalankan dan amati error.

Perbaiki menjadi:

```yaml
SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
```

Tujuan: membedakan perspektif host dan container.

---

## 40. Interview-Level Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

1. Apa perbedaan service dan container dalam Compose?
2. Kenapa `localhost` dari dalam container app bukan host machine?
3. Kapan container perlu `ports`, dan kapan tidak?
4. Apa bedanya `ports` dan `expose`?
5. Kenapa `depends_on` tidak selalu cukup untuk database readiness?
6. Bagaimana `condition: service_healthy` membantu startup?
7. Kenapa app tetap harus implement retry walaupun Compose punya healthcheck?
8. Apa efek `docker compose down -v`?
9. Kenapa named volume bisa menyebabkan config PostgreSQL terlihat tidak berubah?
10. Kenapa `container_name` sering buruk untuk Compose project?
11. Bagaimana melihat Compose config efektif setelah interpolation dan override?
12. Kapan menggunakan profiles?
13. Apa risiko publish database port ke semua interface host?
14. Bagaimana mendesain Compose agar cocok untuk onboarding team?
15. Apa batas Compose dibanding Kubernetes?
16. Kapan Compose lebih cocok daripada Testcontainers?
17. Kapan Testcontainers lebih cocok daripada Compose?
18. Bagaimana mendiagnosis app running tapi tidak reachable dari browser?
19. Bagaimana mendiagnosis app tidak bisa connect ke dependency?
20. Bagaimana memastikan CI Compose environment bersih dan tidak collision?

---

## 41. Ringkasan Akhir

Docker Compose adalah alat yang sangat kuat jika dipahami sebagai **local system model**.

Ia membuat multi-container environment menjadi:

- eksplisit,
- reproducible,
- reviewable,
- executable,
- diagnosable,
- cocok untuk onboarding,
- dan cukup dekat dengan real topology untuk development serta integration testing.

Tetapi Compose juga bisa menjadi sumber kebingungan jika dipakai tanpa mental model:

- `localhost` salah konteks,
- port publishing disalahartikan,
- `depends_on` dianggap readiness guarantee penuh,
- volume stale tidak disadari,
- profile lupa diaktifkan,
- override file membuat config efektif tidak jelas,
- container name di-hardcode,
- semua dependency dipublish tanpa alasan.

Untuk Java engineer, Compose yang baik adalah jembatan antara aplikasi dan dependency eksternal. Ia bukan pengganti production orchestration, tetapi ia adalah cara paling praktis untuk membuat local development environment yang bisa dipercaya.

Prinsip akhirnya:

```text
Compose should make the system topology obvious, not hide it behind magic.
```

---

## 42. Status Seri

Part ini selesai.

Progress seri:

```text
[x] Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
[x] Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
[x] Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc
[x] Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform
[x] Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove
[x] Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector
[x] Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes
[x] Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit
[x] Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
[x] Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals
[x] Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1
[x] Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State
[x] Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing
[x] Part 013 — Docker Compose as Local System Model
[ ] Part 014 — Compose for Java Development: Databases, Brokers, Mock Services
[ ] Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics
[ ] Part 016 — Configuration and Secrets: Env, Files, Build Args, Runtime Injection
[ ] Part 017 — Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor
[ ] Part 018 — Image Supply Chain: Registry, Tags, Digests, SBOM, Signing, Scanning
[ ] Part 019 — Base Image Strategy for Java: JDK, JRE, Alpine, Distroless, Slim
[ ] Part 020 — Performance and Resource Management: CPU, Memory, IO, Startup, Image Size
[ ] Part 021 — Logging and Diagnostics: stdout, stderr, Drivers, Crash Forensics
[ ] Part 022 — Debugging Running Containers: exec, nsenter, Inspect, Events, Minimal Images
[ ] Part 023 — Docker for Automated Testing: Integration Test, Testcontainers, Ephemeral Infra
[ ] Part 024 — CI/CD with Docker: Build Once, Cache Correctly, Promote Safely
[ ] Part 025 — Multi-Platform Images: amd64, arm64, Buildx, Manifest Lists
[ ] Part 026 — Docker Desktop vs Linux Server: Development Convenience vs Runtime Reality
[ ] Part 027 — Local Developer Platform: Docker as Team Workflow Contract
[ ] Part 028 — Production Readiness Without Kubernetes: Docker on VM, Systemd, Restart, Backup
[ ] Part 029 — Failure Mode Catalogue: Docker Problems Senior Engineers Must Recognize
[ ] Part 030 — Design Patterns and Anti-Patterns for Java Services in Docker
[ ] Part 031 — Capstone: Build a Production-Grade Dockerized Java Service
```

Seri belum selesai. Lanjut ke Part 014.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-014.md">Part 014 — Compose for Java Development: Databases, Brokers, Mock Services ➡️</a>
</div>
