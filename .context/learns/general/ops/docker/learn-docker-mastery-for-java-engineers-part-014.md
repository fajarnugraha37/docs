# learn-docker-mastery-for-java-engineers-part-014.md

# Part 014 — Compose for Java Development: Databases, Brokers, Mock Services

> Seri: `learn-docker-mastery-for-java-engineers`  
> Bagian: `014 / 031`  
> Fokus: menggunakan Docker Compose sebagai kontrak environment development Java yang reproducible, resettable, eksplisit, dan tidak bergantung pada setup manual per laptop.

---

## 0. Posisi Part Ini dalam Seri

Di Part 013, kita sudah membahas Docker Compose sebagai **local system model**: cara mendeskripsikan services, networks, volumes, dependency order, environment, dan lifecycle lokal.

Part ini melanjutkan satu level lebih konkret:

> Bagaimana Java engineer memakai Compose untuk membangun environment development yang realistis tanpa menjadikan laptop sebagai “snowflake server”.

Yang akan dibahas:

- menjalankan database, broker, cache, object storage, mock service, mail catcher, dan admin UI secara konsisten;
- menyusun Compose file agar mudah dipakai tim;
- membedakan environment untuk local development, integration test, demo, dan production-like rehearsal;
- mengelola readiness, reset data, volume, init script, port, credential, dan service discovery;
- mencegah jebakan umum seperti stale volume, port collision, implicit dependency, dan config drift.

Yang **tidak** akan dibahas ulang secara mendalam:

- internal PostgreSQL/MySQL;
- Redis data structure;
- Kafka/RabbitMQ architecture;
- Elasticsearch internals;
- HTTP/Nginx theory;
- Bash/Makefile mastery;
- Kubernetes.

Semua itu sudah atau akan punya seri sendiri. Di sini fokusnya adalah **containerized local runtime contract**.

---

## 1. Core Mental Model: Compose as Local Dependency Runtime

Untuk Java backend, aplikasi jarang hidup sendirian. Biasanya service bergantung pada:

- database transaksional;
- cache;
- message broker;
- search engine;
- object storage;
- identity provider;
- mock external API;
- email sink;
- observability tools;
- migration runner;
- admin console.

Tanpa Compose, dependensi ini sering muncul sebagai instruksi manual:

```text
Install PostgreSQL 16
Create database appdb
Create user appuser
Run Redis locally
Install Kafka
Start Elasticsearch
Make sure port 5432, 6379, 9092 are free
Run migration manually
Ask senior dev for sample .env
```

Masalahnya bukan hanya melelahkan. Masalah utamanya adalah **tidak ada kontrak eksplisit**.

Setiap developer bisa punya:

- versi database berbeda;
- user/password berbeda;
- schema lama;
- broker topic sisa eksperimen;
- port bentrok;
- timezone berbeda;
- extension database belum di-enable;
- search index stale;
- seed data tidak sama;
- mock API tidak sinkron;
- certificate lokal berbeda.

Compose mengubah setup manual menjadi file deklaratif:

```yaml
services:
  postgres:
    image: postgres:16
  redis:
    image: redis:7
  app:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
```

Tetapi jangan salah memahami:

> Compose bukan membuat environment “production-grade” otomatis. Compose membuat dependency topology lokal menjadi eksplisit, reproducible, dan mudah direset.

Itu nilainya.

---

## 2. Compose Bukan Pengganti Pemahaman Sistem

Compose sering membuat developer merasa semua dependency “sudah solved”. Ini berbahaya.

Compose hanya membantu pada level:

- container lifecycle;
- network lokal;
- volume lokal;
- environment injection;
- service startup order;
- command override;
- local dependency wiring.

Compose tidak otomatis menyelesaikan:

- schema migration strategy;
- data compatibility;
- broker partitioning;
- transaction isolation;
- cache invalidation;
- idempotency;
- external API contract;
- observability;
- resilience;
- production rollout;
- security posture;
- secret rotation.

Jadi mental model yang benar:

```text
Compose = executable local environment contract
Compose != distributed systems correctness
Compose != production orchestrator
Compose != database design
Compose != message delivery guarantee
```

Untuk Java engineer senior, Compose harus dipakai untuk mempercepat feedback loop, bukan untuk menyembunyikan kompleksitas sistem.

---

## 3. Apa yang Harus Dimiliki Local Compose Environment yang Baik?

Environment development yang baik memiliki beberapa properti.

### 3.1 Reproducible

Developer baru bisa menjalankan:

```bash
docker compose up -d
```

dan mendapatkan dependency set yang sama secara logis.

Bukan harus byte-identical untuk semua hal, tetapi harus sama dalam:

- service names;
- ports;
- database name;
- user/password dev;
- enabled feature;
- startup contract;
- data initialization;
- healthcheck;
- reset procedure.

### 3.2 Disposable

Environment lokal harus bisa dihancurkan dan dibuat ulang.

```bash
docker compose down -v
docker compose up -d
```

Ini penting karena local dependency state sering rusak oleh eksperimen.

Prinsipnya:

> Local infrastructure must be cheaper to recreate than to repair manually.

### 3.3 Explicit

Compose file harus menjelaskan dependency topology.

Buruk:

```text
Run local postgres somehow.
App expects DB_HOST=localhost.
Ask someone for Redis config.
```

Lebih baik:

```yaml
services:
  app:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
      SPRING_DATA_REDIS_HOST: redis
```

### 3.4 Isolated

Project yang berbeda tidak boleh saling mengotori.

Compose membantu dengan project name dan network per project.

```bash
docker compose -p enforcement-dev up -d
```

Tanpa isolasi, dua project bisa berbagi:

- volume;
- network;
- container name;
- port;
- database instance;
- broker topic;
- Redis keyspace.

### 3.5 Observable

Developer harus mudah menjawab:

- service mana yang mati?
- dependency mana belum ready?
- log error ada di mana?
- port mana yang dipublish?
- volume mana yang dipakai?
- config runtime efektif apa?

Compose environment yang baik menyediakan command sederhana:

```bash
docker compose ps
docker compose logs -f postgres
docker compose logs -f app
docker compose exec postgres psql -U appuser -d appdb
docker compose config
```

### 3.6 Resettable with Intent

Reset harus jelas levelnya.

| Reset Level | Efek |
|---|---|
| restart container | proses restart, data tetap |
| recreate container | container baru, volume tetap |
| remove volume | data hilang |
| remove image | image perlu pull/build ulang |
| prune global | berisiko menghapus resource project lain |

Perintah reset harus eksplisit.

```bash
# reset container only
docker compose up -d --force-recreate

# reset data too
docker compose down -v
```

Jangan menyamakan semua reset.

---

## 4. Service Discovery dalam Compose: Jangan Pakai localhost Antar Container

Dalam Compose user-defined network, service bisa saling menemukan lewat **service name**.

Contoh:

```yaml
services:
  app:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
      SPRING_DATA_REDIS_HOST: redis

  postgres:
    image: postgres:16

  redis:
    image: redis:7
```

Dari container `app`, host database adalah:

```text
postgres
```

bukan:

```text
localhost
```

Karena `localhost` dari dalam container berarti container itu sendiri.

Mental model:

```text
Inside app container:
  localhost = app container itself
  postgres  = postgres service container via Compose DNS
  redis     = redis service container via Compose DNS

From host laptop:
  localhost:5432 = published host port to postgres container, if configured
```

Kesalahan umum:

```yaml
app:
  environment:
    SPRING_DATASOURCE_URL: jdbc:postgresql://localhost:5432/appdb
```

Ini hanya benar kalau aplikasi Java berjalan langsung di host laptop, bukan di container.

Untuk mendukung dua mode, pisahkan config:

```text
Mode A: app runs on host, dependencies in Compose
  DB host = localhost

Mode B: app runs in Compose too
  DB host = postgres
```

Jangan campur tanpa sadar.

---

## 5. Dua Mode Umum Development Java

Ada dua pola besar.

### 5.1 Mode 1 — App Berjalan di Host, Dependencies di Compose

Ini paling umum untuk Java developer.

```text
Host laptop:
  ./mvnw spring-boot:run

Compose:
  postgres
  redis
  kafka
  mailpit
  wiremock
```

Kelebihan:

- hot reload lebih mudah;
- IDE debugging natural;
- tidak perlu rebuild image app terus;
- Java tooling lokal tetap nyaman;
- cocok untuk inner development loop.

Kekurangan:

- environment app tidak sama dengan container production;
- host Java version bisa drift;
- env var lokal bisa berbeda;
- path dan filesystem berbeda;
- `localhost` config berbeda dari container mode.

Contoh Compose:

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: apppass
```

Spring config untuk host-run app:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/appdb
spring.datasource.username=appuser
spring.datasource.password=apppass
```

### 5.2 Mode 2 — App dan Dependencies Berjalan di Compose

Ini cocok untuk:

- smoke test lokal;
- demo;
- onboarding;
- production-like packaging check;
- verifying Dockerfile;
- testing signal handling;
- checking container config.

```text
Compose:
  app
  postgres
  redis
  mailpit
```

Kelebihan:

- image app benar-benar diuji;
- network service-name sesuai container runtime;
- env var runtime terlihat jelas;
- closer to deployment model.

Kekurangan:

- feedback loop lebih lambat kalau rebuild terus;
- remote debugging perlu setup;
- file mount bisa lambat di Docker Desktop;
- IDE integration lebih kompleks.

Contoh:

```yaml
services:
  app:
    build:
      context: .
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/appdb
      SPRING_DATASOURCE_USERNAME: appuser
      SPRING_DATASOURCE_PASSWORD: apppass
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: apppass
```

### 5.3 Rekomendasi Praktis

Untuk tim Java, biasanya kombinasi terbaik:

| Use Case | Mode |
|---|---|
| coding harian | app di host, dependencies di Compose |
| onboarding cepat | semua di Compose |
| debugging business logic | app di host |
| debugging Dockerfile | app di Compose |
| testing config runtime | app di Compose |
| integration test otomatis | Testcontainers atau Compose test profile |
| demo lokal | app di Compose |

Jangan fanatik pada satu mode.

Gunakan mode yang sesuai dengan feedback loop yang dibutuhkan.

---

## 6. Struktur Compose File yang Sehat untuk Java Project

Struktur minimal yang biasanya nyaman:

```text
project-root/
  compose.yaml
  compose.override.yaml
  compose.dev.yaml
  compose.test.yaml
  .env.example
  .dockerignore
  Dockerfile
  src/
```

Tetapi jangan terlalu banyak file sejak awal.

Mulai dari:

```text
compose.yaml
.env.example
```

Lalu tambah override jika kompleksitas nyata muncul.

### 6.1 `compose.yaml` sebagai Baseline

`compose.yaml` harus berisi dependency umum yang stabil.

```yaml
name: enforcement-local

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: enforcement
      POSTGRES_USER: enforcement
      POSTGRES_PASSWORD: enforcement
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U enforcement -d enforcement"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres_data:
```

### 6.2 `compose.override.yaml`

Compose secara default membaca `compose.yaml` dan `compose.override.yaml` jika ada.

Gunakan override untuk local-only behavior, misalnya:

```yaml
services:
  postgres:
    ports:
      - "5432:5432"
```

Dalam baseline yang dipakai CI, mungkin port tidak perlu dipublish.

### 6.3 Named Project

Gunakan top-level `name` atau `-p` agar resource predictable:

```yaml
name: enforcement-local
```

Tanpa ini, Compose project name biasanya berasal dari directory name. Itu bisa bikin resource berubah saat repo di-clone ke folder berbeda.

---

## 7. PostgreSQL dalam Compose untuk Java Development

PostgreSQL adalah dependency paling umum untuk Spring Boot atau service Java enterprise.

Contoh dasar:

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: apppass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres_data:
```

Spring Boot config saat app berjalan di host:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/appdb
spring.datasource.username=appuser
spring.datasource.password=apppass
```

Spring Boot config saat app berjalan di Compose:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/appdb
spring.datasource.username=appuser
spring.datasource.password=apppass
```

### 7.1 Init Script

Official PostgreSQL image menjalankan init scripts di `/docker-entrypoint-initdb.d` hanya saat database directory pertama kali diinisialisasi.

Contoh:

```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
```

Directory:

```text
docker/postgres/init/
  001-create-extensions.sql
  002-create-schema.sql
```

Contoh SQL:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS enforcement;
```

### 7.2 Jebakan Init Script

Banyak developer heran kenapa perubahan init script tidak jalan.

Penyebab:

> Init script hanya jalan saat volume data masih kosong.

Kalau volume sudah ada, script tidak di-run ulang.

Solusi reset:

```bash
docker compose down -v
docker compose up -d postgres
```

Atau gunakan migration tool seperti Flyway/Liquibase untuk perubahan schema berulang.

### 7.3 Migration Runner Pattern

Untuk development yang lebih eksplisit:

```yaml
services:
  migrate:
    image: flyway/flyway:10
    command: -url=jdbc:postgresql://postgres:5432/appdb -user=appuser -password=apppass migrate
    volumes:
      - ./src/main/resources/db/migration:/flyway/sql:ro
    depends_on:
      postgres:
        condition: service_healthy
```

Pattern ini membuat migration menjadi service lifecycle sendiri.

Namun untuk Spring Boot, sering kali migration otomatis oleh app cukup untuk local development.

Prinsipnya:

```text
init script = bootstrap database kosong
migration tool = evolusi schema berulang
seed script = data awal untuk local scenario
```

Jangan campur semuanya tanpa boundary.

---

## 8. MySQL dalam Compose untuk Java Development

Contoh:

```yaml
services:
  mysql:
    image: mysql:8.4
    ports:
      - "3306:3306"
    environment:
      MYSQL_DATABASE: appdb
      MYSQL_USER: appuser
      MYSQL_PASSWORD: apppass
      MYSQL_ROOT_PASSWORD: rootpass
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -uroot -prootpass"]
      interval: 5s
      timeout: 3s
      retries: 30

volumes:
  mysql_data:
```

JDBC URL untuk app di host:

```properties
spring.datasource.url=jdbc:mysql://localhost:3306/appdb
```

JDBC URL untuk app di Compose:

```properties
spring.datasource.url=jdbc:mysql://mysql:3306/appdb
```

Catatan penting:

- MySQL startup bisa lebih lama dari container process start.
- Gunakan healthcheck.
- Jangan mengandalkan `depends_on` tanpa readiness.
- Pastikan charset/timezone sesuai kebutuhan app.

Contoh parameter JDBC:

```properties
spring.datasource.url=jdbc:mysql://localhost:3306/appdb?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC
```

---

## 9. Redis dalam Compose untuk Java Development

Contoh:

```yaml
services:
  redis:
    image: redis:7
    ports:
      - "6379:6379"
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  redis_data:
```

Spring Boot host mode:

```properties
spring.data.redis.host=localhost
spring.data.redis.port=6379
```

Compose app mode:

```properties
spring.data.redis.host=redis
spring.data.redis.port=6379
```

### 9.1 Persistent vs Ephemeral Redis

Untuk cache, sering kali Redis lokal sebaiknya ephemeral.

```yaml
services:
  redis:
    image: redis:7
```

Tanpa volume, data hilang saat container dihapus.

Untuk mensimulasikan queue/session/cache yang perlu bertahan antar restart, gunakan volume.

Prinsip:

```text
If Redis is only cache, prefer easy reset.
If Redis models durable local behavior, persist intentionally.
```

---

## 10. Kafka dalam Compose untuk Java Development

Kafka lokal berguna untuk aplikasi event-driven. Tetapi Kafka Compose sering menjadi sumber friksi karena listener configuration.

Kita tidak akan membahas Kafka internals. Fokusnya hanya local wiring.

Contoh modern dengan single-node Kafka mode bisa berbeda tergantung image yang dipakai. Banyak tim menggunakan Bitnami, Confluent, atau Redpanda untuk local development.

### 10.1 Redpanda sebagai Local Kafka-Compatible Broker

Untuk development lokal, Redpanda sering lebih ringan.

```yaml
services:
  redpanda:
    image: docker.redpanda.com/redpandadata/redpanda:v24.3.1
    command:
      - redpanda
      - start
      - --overprovisioned
      - --smp=1
      - --memory=1G
      - --reserve-memory=0M
      - --node-id=0
      - --check=false
      - --kafka-addr=internal://0.0.0.0:9092,external://0.0.0.0:19092
      - --advertise-kafka-addr=internal://redpanda:9092,external://localhost:19092
    ports:
      - "19092:19092"
      - "9644:9644"
```

App di host:

```properties
spring.kafka.bootstrap-servers=localhost:19092
```

App di Compose:

```properties
spring.kafka.bootstrap-servers=redpanda:9092
```

### 10.2 Kenapa Ada Internal dan External Listener?

Karena ada dua network perspective:

```text
Host laptop -> broker via localhost:19092
Container app -> broker via redpanda:9092
```

Kalau advertised listener salah, gejalanya:

- app bisa connect awal, lalu gagal metadata;
- producer timeout;
- consumer tidak join group;
- error menunjuk host/port yang tidak reachable dari perspective client.

Mental model:

```text
Kafka client tidak hanya connect ke bootstrap server.
Client juga menerima metadata berisi broker address.
Broker address itu harus reachable dari client perspective.
```

Ini salah satu jebakan terbesar Kafka in Compose.

---

## 11. RabbitMQ dalam Compose untuk Java Development

RabbitMQ lebih sederhana untuk local Compose.

```yaml
services:
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: appuser
      RABBITMQ_DEFAULT_PASS: apppass
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 5s
      timeout: 5s
      retries: 30

volumes:
  rabbitmq_data:
```

Spring Boot host mode:

```properties
spring.rabbitmq.host=localhost
spring.rabbitmq.port=5672
spring.rabbitmq.username=appuser
spring.rabbitmq.password=apppass
```

Management UI:

```text
http://localhost:15672
```

### 11.1 Durable Local State

RabbitMQ volume bisa menyimpan:

- queues;
- exchanges;
- bindings;
- users;
- messages.

Untuk local dev, pertimbangkan apakah state harus persistent.

Jika sering debugging topology declaration, persistent volume kadang malah mengganggu karena queue/exchange lama tetap ada.

Reset:

```bash
docker compose down -v
docker compose up -d rabbitmq
```

---

## 12. Elasticsearch / OpenSearch dalam Compose

Search engine lokal berguna untuk aplikasi dengan indexing/search.

Namun image search engine biasanya berat.

Contoh OpenSearch local single-node:

```yaml
services:
  opensearch:
    image: opensearchproject/opensearch:2
    environment:
      discovery.type: single-node
      OPENSEARCH_INITIAL_ADMIN_PASSWORD: admin123!Admin
      DISABLE_SECURITY_PLUGIN: "true"
      OPENSEARCH_JAVA_OPTS: "-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - opensearch_data:/usr/share/opensearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:9200 >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 30

volumes:
  opensearch_data:
```

### 12.1 Resource Budget

Search engine containers butuh memory besar. Jangan memasukkan semua dependency berat dalam default profile.

Gunakan profile:

```yaml
services:
  opensearch:
    profiles: ["search"]
    image: opensearchproject/opensearch:2
```

Jalankan hanya saat perlu:

```bash
docker compose --profile search up -d
```

Prinsip:

```text
Default local environment should be useful, not maximal.
Heavy services should be opt-in.
```

---

## 13. MinIO untuk Object Storage Lokal

Aplikasi Java sering bergantung pada S3-compatible object storage. Untuk local dev, MinIO umum dipakai.

```yaml
services:
  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  minio_data:
```

App config:

```properties
app.storage.s3.endpoint=http://localhost:9000
app.storage.s3.access-key=minioadmin
app.storage.s3.secret-key=minioadmin
app.storage.s3.region=us-east-1
app.storage.s3.path-style-access=true
```

Jika app berjalan dalam Compose:

```properties
app.storage.s3.endpoint=http://minio:9000
```

### 13.1 Bucket Bootstrap

MinIO biasanya butuh bucket dibuat.

Tambahkan service init:

```yaml
services:
  minio-init:
    image: minio/mc
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb -p local/app-bucket || true
      "
```

Pattern init service ini berguna untuk dependency yang butuh provisioning ringan.

---

## 14. WireMock untuk Mock External HTTP API

WireMock berguna saat aplikasi Java tergantung external API.

```yaml
services:
  wiremock:
    image: wiremock/wiremock:3.9.1
    ports:
      - "8089:8080"
    volumes:
      - ./docker/wiremock/mappings:/home/wiremock/mappings:ro
      - ./docker/wiremock/__files:/home/wiremock/__files:ro
```

Struktur:

```text
docker/wiremock/
  mappings/
    get-customer.json
  __files/
    customer-123.json
```

Mapping contoh:

```json
{
  "request": {
    "method": "GET",
    "url": "/customers/123"
  },
  "response": {
    "status": 200,
    "headers": {
      "Content-Type": "application/json"
    },
    "bodyFileName": "customer-123.json"
  }
}
```

App config host mode:

```properties
external.customer-api.base-url=http://localhost:8089
```

App config Compose mode:

```properties
external.customer-api.base-url=http://wiremock:8080
```

### 14.1 Mock Service sebagai Contract, Bukan Kebohongan

Mock service buruk jika hanya mengembalikan happy path.

Mock service bagus menyediakan skenario:

- success;
- 400 validation failure;
- 401 unauthorized;
- 403 forbidden;
- 404 not found;
- 409 conflict;
- 429 rate limit;
- 500 internal error;
- timeout;
- malformed response;
- slow response.

Untuk local development, skenario ini penting agar developer bisa melihat failure behavior tanpa menunggu external system benar-benar gagal.

---

## 15. Mailpit / MailHog untuk Email Sink Lokal

Jangan kirim email sungguhan saat development.

Gunakan email sink.

Contoh Mailpit:

```yaml
services:
  mailpit:
    image: axllent/mailpit:v1.21
    ports:
      - "1025:1025"
      - "8025:8025"
```

Spring Boot host mode:

```properties
spring.mail.host=localhost
spring.mail.port=1025
spring.mail.username=
spring.mail.password=
```

UI:

```text
http://localhost:8025
```

Compose app mode:

```properties
spring.mail.host=mailpit
spring.mail.port=1025
```

Value-nya besar untuk flow seperti:

- registration email;
- password reset;
- notification;
- case escalation alert;
- regulatory notice dispatch simulation.

---

## 16. Admin UI Containers: Useful but Should Stay Optional

Admin UI membantu debugging, tetapi jangan jadikan dependency inti.

Contoh tools:

- pgAdmin;
- Adminer;
- RedisInsight;
- RabbitMQ management UI;
- Kafka UI;
- OpenSearch Dashboards;
- MinIO Console;
- Mailpit UI.

Gunakan profiles:

```yaml
services:
  adminer:
    image: adminer:4
    profiles: ["tools"]
    ports:
      - "8081:8080"
```

Jalankan:

```bash
docker compose --profile tools up -d
```

Kenapa optional?

- mengurangi resource default;
- mempercepat startup;
- mengurangi port collision;
- menjaga Compose baseline tetap fokus.

---

## 17. Compose Profiles untuk Dependency Set yang Berbeda

Compose profiles memungkinkan service tertentu hanya aktif saat diminta.

Contoh:

```yaml
services:
  postgres:
    image: postgres:16

  redis:
    image: redis:7

  redpanda:
    image: docker.redpanda.com/redpandadata/redpanda:v24.3.1
    profiles: ["events"]

  opensearch:
    image: opensearchproject/opensearch:2
    profiles: ["search"]

  adminer:
    image: adminer:4
    profiles: ["tools"]
```

Default:

```bash
docker compose up -d
```

Dengan event broker:

```bash
docker compose --profile events up -d
```

Dengan semua optional tools:

```bash
docker compose --profile events --profile search --profile tools up -d
```

### 17.1 Profile Design yang Baik

Gunakan profile berdasarkan capability:

```text
events
search
observability
tools
mock
full
```

Hindari profile berdasarkan nama orang:

```text
alice
bob
frontend-team
```

Itu membuat environment tidak menjadi kontrak tim.

---

## 18. Environment Variable Strategy

Ada beberapa sumber konfigurasi:

- `.env` untuk interpolation Compose;
- `env_file` untuk container environment;
- `environment` langsung di service;
- shell environment;
- command-line override.

Jangan campur tanpa aturan.

### 18.1 `.env.example`

Simpan contoh config:

```dotenv
COMPOSE_PROJECT_NAME=enforcement-local
POSTGRES_PORT=5432
POSTGRES_DB=enforcement
POSTGRES_USER=enforcement
POSTGRES_PASSWORD=enforcement
REDIS_PORT=6379
APP_PORT=8080
```

Developer copy:

```bash
cp .env.example .env
```

Compose:

```yaml
services:
  postgres:
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-enforcement}
      POSTGRES_USER: ${POSTGRES_USER:-enforcement}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-enforcement}
```

### 18.2 Jangan Commit Secret Real

Untuk local development, password seperti `appuser/apppass` acceptable jika jelas hanya lokal.

Tetapi jangan commit:

- production password;
- staging credential;
- cloud access key;
- OAuth client secret nyata;
- private key;
- database dump berisi data sensitif.

### 18.3 Config Contract untuk Java App

Buat convention jelas.

Contoh Spring Boot:

```yaml
services:
  app:
    environment:
      SPRING_PROFILES_ACTIVE: docker
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/enforcement
      SPRING_DATASOURCE_USERNAME: enforcement
      SPRING_DATASOURCE_PASSWORD: enforcement
      SPRING_DATA_REDIS_HOST: redis
      EXTERNAL_CUSTOMER_API_BASE_URL: http://wiremock:8080
```

Lalu di `application-docker.properties`:

```properties
spring.datasource.url=${SPRING_DATASOURCE_URL}
spring.datasource.username=${SPRING_DATASOURCE_USERNAME}
spring.datasource.password=${SPRING_DATASOURCE_PASSWORD}
spring.data.redis.host=${SPRING_DATA_REDIS_HOST}
external.customer-api.base-url=${EXTERNAL_CUSTOMER_API_BASE_URL}
```

Prinsip:

```text
Compose owns local wiring.
Application owns config validation.
```

---

## 19. Healthcheck Strategy untuk Local Dependencies

`depends_on` tanpa readiness sering menipu. Container bisa “started” tetapi service belum siap menerima koneksi.

Contoh PostgreSQL:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
  interval: 5s
  timeout: 3s
  retries: 20
```

Contoh Redis:

```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 5s
  timeout: 3s
  retries: 20
```

Contoh app dependency:

```yaml
app:
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
```

Docker Compose mendukung pengaturan startup/shutdown order melalui `depends_on`, dan dependency dapat ditentukan lewat `depends_on`, `links`, `volumes_from`, atau `network_mode: service:...`. Compose juga dapat menggunakan condition seperti `service_healthy` untuk menunggu healthcheck dependency sebelum dependent service dimulai.  
Source: Docker Compose startup order documentation.

### 19.1 Healthcheck Lokal Tidak Harus Sama dengan Production

Healthcheck untuk local dependency boleh praktis.

Tetapi untuk app sendiri, hati-hati.

Buruk:

```yaml
healthcheck:
  test: ["CMD", "curl", "http://localhost:8080/actuator/health"]
```

Jika image app tidak punya `curl`, healthcheck gagal.

Alternatif:

- include minimal health probe tool;
- pakai Java-based health probe;
- jangan healthcheck app di image distroless local;
- gunakan actuator dari luar dalam test.

---

## 20. Init Service Pattern

Beberapa dependency butuh provisioning setelah ready.

Contoh:

- buat bucket MinIO;
- buat Kafka topic;
- buat RabbitMQ exchange/queue;
- seed database;
- register mock data;
- create OpenSearch index template.

Pattern:

```yaml
services:
  dependency:
    image: some-service
    healthcheck: ...

  dependency-init:
    image: some-cli
    depends_on:
      dependency:
        condition: service_healthy
    command: run-init-command
```

Contoh Kafka topic dengan Redpanda:

```yaml
services:
  redpanda-init:
    image: docker.redpanda.com/redpandadata/redpanda:v24.3.1
    depends_on:
      redpanda:
        condition: service_started
    entrypoint: ["/bin/sh", "-c"]
    command: >
      "rpk topic create enforcement.case-events --brokers redpanda:9092 || true"
```

### 20.1 Idempotency Wajib

Init service harus aman dijalankan berkali-kali.

Gunakan pola:

```bash
create-resource || true
```

atau command idempotent seperti:

```sql
CREATE SCHEMA IF NOT EXISTS enforcement;
```

Kenapa?

Compose local sering di-restart. Init yang tidak idempotent menyebabkan startup gagal karena resource sudah ada.

---

## 21. Volume Strategy: Persistent, Ephemeral, Seeded

Tidak semua dependency perlu volume.

### 21.1 Persistent Volume

Cocok untuk:

- database local utama;
- MinIO file upload scenario;
- RabbitMQ message durability test;
- search index yang mahal rebuild.

```yaml
volumes:
  postgres_data:
```

### 21.2 Ephemeral State

Cocok untuk:

- cache;
- short-lived integration test;
- broker untuk smoke test;
- mock API;
- mail sink.

Tanpa volume:

```yaml
services:
  redis:
    image: redis:7
```

### 21.3 Seeded State

Untuk demo atau onboarding, kamu mungkin ingin data awal.

Pattern:

```text
migration -> seed -> app
```

Contoh seed service:

```yaml
services:
  seed-db:
    image: postgres:16
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./docker/postgres/seed:/seed:ro
    entrypoint: ["/bin/sh", "-c"]
    command: >
      "psql postgresql://appuser:apppass@postgres:5432/appdb -f /seed/dev-data.sql"
```

### 21.4 Jangan Jadikan Dump Production sebagai Seed

Risiko:

- data pribadi bocor;
- ukuran besar;
- schema drift;
- developer tergantung data acak;
- test tidak deterministik;
- compliance issue.

Seed data harus curated dan synthetic.

---

## 22. Port Strategy: Stable Enough, Not Globally Assumed

Compose service port internal boleh tetap standar:

```text
postgres:5432
redis:6379
rabbitmq:5672
```

Host port bisa bentrok.

Gunakan variable:

```yaml
ports:
  - "${POSTGRES_PORT:-5432}:5432"
```

Developer yang port 5432 sudah dipakai bisa pakai:

```dotenv
POSTGRES_PORT=15432
```

App host config ikut berubah:

```properties
spring.datasource.url=jdbc:postgresql://localhost:${POSTGRES_PORT:5432}/appdb
```

### 22.1 Hindari `container_name`

Banyak tutorial menambahkan:

```yaml
container_name: postgres
```

Ini sering buruk untuk project tim.

Kenapa?

- nama container jadi global;
- dua clone repo tidak bisa jalan bersamaan;
- Compose scaling terganggu;
- project isolation melemah.

Lebih baik gunakan service name dan project name.

```yaml
services:
  postgres:
    image: postgres:16
```

Compose akan membuat nama container berbasis project.

---

## 23. Full Example: Compose untuk Java Service dengan Dependency Umum

Contoh ini cukup lengkap tetapi masih masuk akal.

```yaml
name: enforcement-local

services:
  postgres:
    image: postgres:16
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-enforcement}
      POSTGRES_USER: ${POSTGRES_USER:-enforcement}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-enforcement}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-enforcement} -d ${POSTGRES_DB:-enforcement}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7
    ports:
      - "${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  mailpit:
    image: axllent/mailpit:v1.21
    ports:
      - "${MAILPIT_SMTP_PORT:-1025}:1025"
      - "${MAILPIT_UI_PORT:-8025}:8025"

  wiremock:
    image: wiremock/wiremock:3.9.1
    ports:
      - "${WIREMOCK_PORT:-8089}:8080"
    volumes:
      - ./docker/wiremock/mappings:/home/wiremock/mappings:ro
      - ./docker/wiremock/__files:/home/wiremock/__files:ro

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    command: server /data --console-address ":9001"
    profiles: ["storage"]
    ports:
      - "${MINIO_API_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    volumes:
      - minio_data:/data

  adminer:
    image: adminer:4
    profiles: ["tools"]
    ports:
      - "${ADMINER_PORT:-8081}:8080"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
  minio_data:
```

`.env.example`:

```dotenv
COMPOSE_PROJECT_NAME=enforcement-local

POSTGRES_PORT=5432
POSTGRES_DB=enforcement
POSTGRES_USER=enforcement
POSTGRES_PASSWORD=enforcement

REDIS_PORT=6379

MAILPIT_SMTP_PORT=1025
MAILPIT_UI_PORT=8025

WIREMOCK_PORT=8089

MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

ADMINER_PORT=8081
```

Common commands:

```bash
# start minimal dependencies
docker compose up -d

# start with storage
docker compose --profile storage up -d

# start admin tools
docker compose --profile tools up -d

# see status
docker compose ps

# follow all logs
docker compose logs -f

# reset containers but keep DB data
docker compose up -d --force-recreate

# destroy data too
docker compose down -v
```

---

## 24. App-in-Compose Example

Tambahkan service app:

```yaml
services:
  app:
    build:
      context: .
    ports:
      - "${APP_PORT:-8080}:8080"
    environment:
      SPRING_PROFILES_ACTIVE: docker
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/${POSTGRES_DB:-enforcement}
      SPRING_DATASOURCE_USERNAME: ${POSTGRES_USER:-enforcement}
      SPRING_DATASOURCE_PASSWORD: ${POSTGRES_PASSWORD:-enforcement}
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PORT: 6379
      SPRING_MAIL_HOST: mailpit
      SPRING_MAIL_PORT: 1025
      EXTERNAL_CUSTOMER_API_BASE_URL: http://wiremock:8080
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      mailpit:
        condition: service_started
      wiremock:
        condition: service_started
```

Ini menguji:

- Dockerfile app;
- runtime env;
- service discovery;
- dependency readiness;
- container logs;
- signal handling saat `docker compose stop`.

Tetapi untuk daily coding, app-in-Compose mungkin terlalu lambat jika setiap perubahan perlu rebuild.

---

## 25. Compose Watch dan Hot Reload: Gunakan dengan Ekspektasi Realistis

Docker Compose modern punya fitur development seperti watch/sync/rebuild. Ini dapat membantu, tetapi jangan menganggapnya selalu lebih baik dari IDE local run.

Untuk Java, hot reload bisa melibatkan:

- Spring Boot DevTools;
- JRebel;
- Gradle continuous build;
- Maven compile loop;
- mounted classes;
- container rebuild;
- IDE run config.

Trade-off:

| Approach | Feedback | Fidelity to container | Complexity |
|---|---:|---:|---:|
| app run on host | cepat | sedang | rendah |
| app in Compose with rebuild | lambat | tinggi | rendah-sedang |
| app in Compose with sync/watch | sedang | tinggi | sedang-tinggi |
| remote debug in container | sedang | tinggi | tinggi |

Rekomendasi:

- gunakan host-run untuk inner loop;
- gunakan app-in-Compose untuk packaging/runtime verification;
- jangan paksa semua developer memakai containerized Java loop kalau memperlambat flow tanpa manfaat nyata.

---

## 26. Integration Test: Compose vs Testcontainers

Compose bisa dipakai untuk integration test, tetapi Java ecosystem punya Testcontainers yang sering lebih cocok.

Spring Boot documentation menjelaskan Testcontainers sebagai library untuk mengelola service yang berjalan di Docker containers, terintegrasi dengan JUnit, dan berguna untuk integration test yang berbicara dengan real backend service seperti MySQL, MongoDB, Cassandra, dan lainnya.

### 26.1 Compose Cocok untuk

- local manual environment;
- demo;
- multi-service smoke test;
- developer onboarding;
- reproduksi bug manual;
- running app stack end-to-end.

### 26.2 Testcontainers Cocok untuk

- automated integration test;
- per-test/per-suite isolated dependency;
- dynamic ports;
- parallel test;
- CI reproducibility;
- database lifecycle tied to test lifecycle.

### 26.3 Jangan Pakai Compose sebagai Test Harness Kalau Butuh Isolation Ketat

Masalah Compose untuk automated test:

- shared state antar test;
- stale volume;
- port collision;
- sulit parallel;
- readiness custom;
- cleanup discipline manual.

Testcontainers lebih natural karena test code mengontrol lifecycle dependency.

Tetapi Compose tetap baik untuk menjalankan semua dependency secara manual saat development.

---

## 27. Failure Mode yang Sering Terjadi

### 27.1 App Tidak Bisa Connect ke Database

Gejala:

```text
Connection refused
No route to host
Unknown host postgres
password authentication failed
```

Diagnosis:

```bash
docker compose ps
docker compose logs postgres
docker compose exec postgres pg_isready -U appuser -d appdb
docker compose config
```

Pertanyaan:

- app berjalan di host atau container?
- JDBC host `localhost` atau `postgres`?
- port dipublish ke host?
- database sudah healthy?
- username/password sama?
- volume lama masih membawa credential lama?

Volume lama dengan credential lama adalah jebakan besar. Jika PostgreSQL volume sudah dibuat dengan password lama, mengubah `POSTGRES_PASSWORD` di Compose tidak otomatis mengganti password database existing.

Reset jika memang boleh:

```bash
docker compose down -v
```

### 27.2 Port Sudah Dipakai

Gejala:

```text
Bind for 0.0.0.0:5432 failed: port is already allocated
```

Solusi:

```dotenv
POSTGRES_PORT=15432
```

atau stop service lokal yang memakai port.

Diagnosis:

```bash
docker compose ps
docker ps
```

### 27.3 Service Started Tapi Belum Ready

Gejala:

- app crash saat startup;
- retry connection gagal;
- migration gagal;
- broker timeout.

Solusi:

- tambahkan healthcheck;
- gunakan `depends_on.condition: service_healthy`;
- app tetap harus punya retry/backoff karena readiness lokal tidak menggantikan resilience app.

### 27.4 Stale Volume

Gejala:

- schema tidak sesuai;
- init script tidak jalan;
- password tidak berubah;
- old data muncul lagi;
- queue/exchange lama masih ada.

Diagnosis:

```bash
docker volume ls
docker compose down -v
```

Prinsip:

```text
When in doubt, know whether your state lives in a named volume.
```

### 27.5 Wrong Perspective URL

Contoh salah:

```properties
external.customer-api.base-url=http://localhost:8089
```

Saat app berjalan di container, `localhost` adalah app container. Harus:

```properties
external.customer-api.base-url=http://wiremock:8080
```

### 27.6 Kafka Advertised Listener Salah

Gejala:

- bootstrap connect berhasil;
- producer/consumer lalu timeout;
- error metadata broker unreachable.

Perbaikan:

- pastikan advertised address untuk host berbeda dari container network;
- host client pakai `localhost:externalPort`;
- container client pakai `serviceName:internalPort`.

### 27.7 `.env` Tidak Bekerja Seperti Dikira

Ada perbedaan antara:

- `.env` untuk Compose interpolation;
- `env_file` untuk environment dalam container;
- `environment` untuk env langsung;
- shell env override.

Jika bingung, lihat rendered config:

```bash
docker compose config
```

Ini salah satu command paling penting untuk debugging Compose.

---

## 28. Compose Command Playbook untuk Java Developer

### 28.1 Start Minimal Dependencies

```bash
docker compose up -d
```

### 28.2 Start Specific Service

```bash
docker compose up -d postgres redis
```

### 28.3 Start With Profile

```bash
docker compose --profile tools up -d
```

### 28.4 Check Status

```bash
docker compose ps
```

### 28.5 Follow Logs

```bash
docker compose logs -f postgres
```

### 28.6 Exec into Service

```bash
docker compose exec postgres psql -U appuser -d appdb
```

```bash
docker compose exec redis redis-cli
```

### 28.7 Render Effective Config

```bash
docker compose config
```

### 28.8 Recreate Without Removing Data

```bash
docker compose up -d --force-recreate
```

### 28.9 Stop

```bash
docker compose stop
```

### 28.10 Stop and Remove Containers, Keep Volumes

```bash
docker compose down
```

### 28.11 Stop and Remove Data

```bash
docker compose down -v
```

### 28.12 Pull New Images

```bash
docker compose pull
```

### 28.13 Rebuild App Image

```bash
docker compose build app
```

### 28.14 Restart One Dependency

```bash
docker compose restart redis
```

---

## 29. Developer Experience Contract

A mature Java team should document a small set of commands.

Example `README.md` section:

```markdown
## Local Development

Copy environment file:

```bash
cp .env.example .env
```

Start dependencies:

```bash
docker compose up -d
```

Run app from host:

```bash
./mvnw spring-boot:run
```

Open tools:

- Mailpit: http://localhost:8025
- WireMock: http://localhost:8089
- PostgreSQL: localhost:5432, database `enforcement`

Reset local data:

```bash
docker compose down -v
docker compose up -d
```
```

Hal yang perlu dijelaskan:

- mode default app host atau app container;
- port yang dipakai;
- credential local;
- cara reset data;
- cara menjalankan optional profile;
- cara troubleshooting umum;
- mana file yang boleh diedit developer;
- mana secret yang tidak boleh commit.

---

## 30. Anti-Pattern Catalogue

### 30.1 One Huge Compose File with Everything Always On

Buruk:

```text
postgres + redis + kafka + rabbitmq + elasticsearch + minio + jaeger + prometheus + grafana + keycloak + selenium always on
```

Efek:

- laptop berat;
- startup lambat;
- banyak port collision;
- developer malas menjalankan environment;
- failure noise tinggi.

Gunakan profiles.

### 30.2 `container_name` Everywhere

Melemahkan isolation dan membuat multiple project sulit.

### 30.3 Hardcoding Host Ports Without Escape Hatch

Gunakan variable dengan default.

```yaml
ports:
  - "${POSTGRES_PORT:-5432}:5432"
```

### 30.4 No Healthchecks

Menyebabkan race startup.

### 30.5 Relying on Init Scripts for Schema Evolution

Init scripts hanya untuk database kosong. Gunakan migration tool untuk evolusi schema.

### 30.6 Production Secrets in Local Compose

Jangan pernah.

### 30.7 Local Compose Pretends to Be Production

Compose lokal tidak punya:

- production scheduling;
- secret management;
- rolling update;
- autoscaling;
- cross-node failure recovery;
- production-grade network policy.

Gunakan Compose untuk local fidelity, bukan production illusion.

### 30.8 No Reset Procedure

Jika developer tidak tahu cara reset, mereka akan memperbaiki state manual dan environment menjadi snowflake.

### 30.9 App Config Tidak Membedakan Host Mode dan Compose Mode

Akibatnya `localhost` bug muncul terus.

### 30.10 Mock API Only Covers Happy Path

Mock yang terlalu manis membuat failure handling tidak pernah diuji.

---

## 31. Compose Design Checklist untuk Java Service

Gunakan checklist ini saat review Compose file.

### 31.1 Service Naming

- Apakah service name stabil dan meaningful?
- Apakah app config memakai service name saat berjalan di Compose?
- Apakah tidak ada `container_name` yang tidak perlu?

### 31.2 Image Versioning

- Apakah image dependency dipin ke major/minor yang jelas?
- Apakah tidak semua memakai `latest`?
- Apakah image berat dibuat optional?

### 31.3 Ports

- Apakah host ports bisa dioverride lewat `.env`?
- Apakah port hanya dipublish jika host perlu akses?
- Apakah internal container communication memakai service port?

### 31.4 Volumes

- Apakah persistent volume hanya untuk state yang memang perlu?
- Apakah reset data terdokumentasi?
- Apakah init script behavior dipahami?

### 31.5 Healthchecks

- Apakah database/broker punya healthcheck?
- Apakah `depends_on` memakai condition bila perlu?
- Apakah app tetap punya retry/backoff?

### 31.6 Environment

- Apakah `.env.example` tersedia?
- Apakah secret nyata tidak di-commit?
- Apakah host mode dan Compose mode dibedakan?
- Apakah `docker compose config` menghasilkan config yang masuk akal?

### 31.7 Profiles

- Apakah tools berat optional?
- Apakah search/event/observability dependency bisa dinyalakan sesuai kebutuhan?
- Apakah default environment cukup ringan?

### 31.8 Developer UX

- Apakah onboarding cukup dengan 2–3 command?
- Apakah reset jelas?
- Apakah logs mudah diakses?
- Apakah admin UI URL terdokumentasi?

---

## 32. Case Study: Regulatory Case Management Service

Misalkan kamu membangun service untuk enforcement lifecycle:

```text
case-service
  - PostgreSQL: case state, decision record, audit trail
  - Redis: short-lived workflow cache
  - RabbitMQ/Kafka: case event publication
  - MinIO: evidence document storage
  - WireMock: external identity/licensing API
  - Mailpit: notification preview
```

Compose topology:

```text
case-service
  -> postgres
  -> redis
  -> rabbitmq/redpanda
  -> minio
  -> wiremock
  -> mailpit
```

Important design:

- PostgreSQL persistent karena schema/data case perlu dipakai selama dev session.
- Redis mungkin ephemeral karena cache dapat di-recreate.
- Broker optional profile jika tidak semua flow memerlukan async event.
- MinIO optional storage profile jika tidak semua task menyentuh evidence upload.
- WireMock default karena external API sebaiknya tidak dipanggil langsung saat dev.
- Mailpit default jika notification flow sering diuji.

Example profile grouping:

```text
default:
  postgres
  redis
  wiremock
  mailpit

profile events:
  redpanda or rabbitmq

profile storage:
  minio

profile tools:
  adminer
  kafka-ui
```

Ini membuat default environment ringan tetapi tetap meaningful.

---

## 33. How to Think Like a Top-Tier Engineer Here

Engineer biasa bertanya:

```text
Docker Compose command-nya apa?
```

Engineer kuat bertanya:

```text
Apa dependency contract aplikasi ini?
State mana yang harus persistent?
State mana yang harus disposable?
Service mana yang perlu readiness?
App berjalan dari host atau container?
Apakah URL config benar dari perspective runtime?
Bagaimana reset environment dilakukan?
Bagaimana developer baru tahu setup benar?
Bagaimana failure external API disimulasikan?
Bagaimana CI/test lifecycle berbeda dari local dev?
```

Compose mastery bukan hafalan YAML. Compose mastery adalah kemampuan membuat environment lokal yang:

- cukup mirip dengan sistem nyata untuk menangkap bug wiring;
- cukup ringan untuk dipakai setiap hari;
- cukup eksplisit untuk dipahami tim;
- cukup disposable untuk tidak menjadi beban;
- cukup configurable untuk laptop berbeda;
- cukup terisolasi agar project tidak saling mengganggu.

---

## 34. Summary

Di part ini, kita membahas Docker Compose sebagai alat utama untuk local development Java yang memiliki dependency eksternal.

Poin utama:

- Compose adalah **local dependency runtime contract**, bukan mini production orchestrator.
- Untuk Java, ada dua mode besar: app berjalan di host atau app berjalan di Compose.
- Gunakan service name untuk komunikasi antar container; gunakan `localhost` hanya dari host perspective.
- Database, Redis, broker, mock API, object storage, dan mail sink punya lifecycle dan state strategy berbeda.
- Healthcheck penting untuk menghindari startup race.
- Init script hanya jalan pada empty volume; migration tool berbeda dari init script.
- Profiles membantu menjaga default environment tetap ringan.
- `.env.example` dan documented reset command adalah bagian dari developer experience.
- Hindari `container_name`, `latest`, production secret, no-healthcheck, dan Compose file raksasa yang selalu menyalakan semuanya.
- Untuk automated integration test, Testcontainers sering lebih baik daripada Compose karena lifecycle dependency bisa dikontrol oleh test.

---

## 35. Latihan Praktis

### Latihan 1 — Minimal Dependency Stack

Buat `compose.yaml` berisi:

- PostgreSQL;
- Redis;
- Mailpit;
- WireMock.

Pastikan:

- PostgreSQL punya named volume;
- Redis ephemeral;
- Mailpit UI bisa dibuka;
- WireMock membaca mapping dari host;
- host ports bisa dioverride lewat `.env`.

### Latihan 2 — Host Mode vs Compose Mode

Jalankan app Spring Boot dari host dan pastikan config memakai:

```text
localhost
```

Lalu jalankan app sebagai service Compose dan pastikan config memakai:

```text
postgres
redis
wiremock
mailpit
```

Catat perbedaannya.

### Latihan 3 — Stale Volume Simulation

1. Jalankan PostgreSQL dengan password `apppass`.
2. Stop Compose.
3. Ubah password di `.env` menjadi `newpass`.
4. Jalankan lagi.
5. Amati kenapa login bisa gagal.
6. Reset dengan `docker compose down -v`.

Tujuan: memahami bahwa env init database tidak otomatis mengubah existing volume.

### Latihan 4 — Profile Design

Tambahkan profile:

- `events` untuk broker;
- `storage` untuk MinIO;
- `tools` untuk Adminer.

Pastikan default environment tetap ringan.

### Latihan 5 — Failure Scenario Mocking

Tambahkan WireMock mappings untuk:

- success;
- 404;
- 409;
- 429;
- 500;
- delayed response.

Pastikan aplikasi Java punya behavior yang jelas untuk masing-masing case.

---

## 36. Referensi

- Docker Docs — Compose file services reference: https://docs.docker.com/reference/compose-file/services/
- Docker Docs — Control startup and shutdown order in Compose: https://docs.docker.com/compose/how-tos/startup-order/
- Docker Docs — Environment variables precedence in Docker Compose: https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/
- Docker Docs — Set environment variables within containers in Compose: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/
- Docker Docs — Variable interpolation and `.env` in Compose: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Docker Docs — Testcontainers overview: https://docs.docker.com/testcontainers/
- Spring Boot Docs — Testcontainers: https://docs.spring.io/spring-boot/reference/testing/testcontainers.html
- Testcontainers Java — Docker Compose module: https://java.testcontainers.org/modules/docker_compose/

---

## 37. Status Seri

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
- Part 013 — Docker Compose as Local System Model
- Part 014 — Compose for Java Development: Databases, Brokers, Mock Services

Belum selesai. Berikutnya:

- Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Docker Compose as Local System Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-015.md">Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics ➡️</a>
</div>
