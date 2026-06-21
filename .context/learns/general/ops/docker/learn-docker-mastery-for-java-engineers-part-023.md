# learn-docker-mastery-for-java-engineers-part-023.md

# Part 023 — Docker for Automated Testing: Integration Test, Testcontainers, Ephemeral Infra

> Target pembaca: Java software engineer yang sudah nyaman dengan unit test, integration test, Spring Boot, Maven/Gradle, dan service dependency seperti database, broker, cache, object storage, atau external HTTP service.
>
> Fokus part ini: memakai Docker sebagai **test dependency provisioner** yang disposable, reproducible, dan dekat dengan production behavior, tanpa menjadikan Docker sebagai tujuan akhir. Kita tidak akan mengulang internal PostgreSQL, MySQL, Redis, Kafka, RabbitMQ, Elasticsearch, atau database lain; yang dibahas adalah **cara mengelola dependency tersebut sebagai bagian dari automated testing**.

---

## 1. Posisi Part Ini dalam Seri Docker

Sampai part sebelumnya, kita sudah membangun fondasi:

- container sebagai proses dengan boundary;
- image sebagai artifact immutable;
- Dockerfile dan build cache;
- Compose sebagai model sistem lokal;
- healthcheck, config, secrets, security, supply chain, performance, logging, dan debugging.

Sekarang kita masuk ke pertanyaan yang sangat praktis untuk Java engineer:

> Bagaimana Docker membantu test menjadi lebih realistis tanpa membuat test lambat, flaky, mahal, dan sulit di-maintain?

Ini penting karena banyak tim backend jatuh ke dua ekstrem:

1. **Terlalu banyak mock** sehingga test cepat tetapi tidak menangkap bug integrasi nyata.
2. **Terlalu banyak environment shared** sehingga test realistis tetapi lambat, stateful, flaky, dan sering gagal karena masalah eksternal.

Docker membuka jalur tengah:

> Dependency nyata dijalankan sebagai container ephemeral yang dibuat untuk test, dikonfigurasi secara eksplisit, lalu dihancurkan setelah test selesai.

Di Java, pola ini paling sering diwujudkan lewat:

- Docker Compose untuk test environment yang mirip local topology;
- Testcontainers untuk dependency per test suite atau per test class;
- Spring Boot Testcontainers integration untuk wiring property otomatis;
- CI pipeline yang menjalankan Docker daemon dan test secara isolated.

Dokumentasi Testcontainers for Java menjelaskan Testcontainers sebagai library Java untuk JUnit tests yang menyediakan lightweight, throwaway instances dari database, browser Selenium, atau apa pun yang bisa berjalan di Docker container. Ini tepat menggambarkan perannya: bukan mock framework, tetapi **ephemeral real dependency framework**.

---

## 2. Masalah yang Ingin Diselesaikan

Sebelum memakai Docker untuk testing, pahami dulu masalah aslinya.

Dalam aplikasi Java modern, unit bisnis jarang berdiri sendiri. Service biasanya berbicara dengan:

- relational database;
- key-value store;
- message broker;
- search engine;
- object storage;
- identity provider;
- external REST/gRPC service;
- scheduler;
- migration tool;
- cache;
- filesystem;
- TLS endpoint;
- feature flag service.

Unit test bisa menguji logika lokal, tetapi bug produksi sering muncul di batas antar komponen:

- SQL migration salah urutan;
- transaction isolation tidak sesuai asumsi;
- schema index hilang;
- Redis TTL berbeda dari asumsi;
- Kafka topic belum dibuat;
- RabbitMQ exchange binding salah;
- Elasticsearch mapping tidak cocok;
- object storage path encoding salah;
- service dependency belum ready saat app start;
- time zone container berbeda dari laptop;
- TLS truststore tidak memuat CA;
- env var tidak ter-wire ke Spring config;
- app bind ke `localhost` bukan `0.0.0.0`;
- readiness endpoint false-positive.

Mock sering tidak menangkap ini karena mock menguji **kontrak yang kita bayangkan**, bukan **perilaku sistem nyata**.

Docker-based integration test membantu karena dependency yang digunakan lebih dekat dengan real runtime:

- database benar-benar menerima SQL;
- broker benar-benar punya topic/queue/exchange;
- cache benar-benar punya TTL dan eviction behavior;
- object storage benar-benar punya API compatibility;
- network benar-benar memakai port dan DNS;
- app benar-benar membaca env/config seperti container runtime.

Namun Docker juga membawa risiko:

- test jadi lambat karena pull image dan startup;
- test flaky karena readiness salah;
- state bocor antar test;
- port collision;
- Docker daemon tidak tersedia di CI;
- image tag berubah;
- arsitektur amd64/arm64 mismatch;
- cleanup gagal;
- parallel test berebut resource;
- test menjadi mini production environment yang sulit dipahami.

Maka tujuan part ini bukan “pakai Docker untuk semua test”, tetapi:

> Menempatkan Docker pada lapisan test yang tepat, dengan lifecycle, isolation, readiness, dan failure model yang benar.

---

## 3. Taxonomy Test untuk Java Backend

Sebelum menentukan alat, pisahkan jenis test.

### 3.1 Unit Test

Unit test menguji logika kecil tanpa dependency eksternal nyata.

Contoh:

- pricing calculation;
- validation rule;
- state transition;
- mapper pure function;
- domain invariant;
- retry decision policy;
- permission decision logic.

Karakteristik:

- sangat cepat;
- deterministic;
- tidak butuh Docker;
- tidak butuh database;
- mudah dijalankan ribuan kali.

Docker tidak cocok untuk unit test. Jika unit test butuh Docker, biasanya boundary-nya terlalu besar.

### 3.2 Slice Test

Slice test menguji sebagian layer framework.

Contoh Spring Boot:

- `@WebMvcTest` untuk controller layer;
- `@DataJpaTest` untuk repository layer;
- `@JsonTest` untuk serialization;
- custom slice untuk messaging adapter.

Slice test kadang bisa memakai embedded dependency, mock, atau Testcontainers tergantung tujuan.

Misalnya:

- repository dengan H2 cepat, tetapi bisa berbeda dari PostgreSQL;
- repository dengan PostgreSQL Testcontainer lebih realistis;
- controller test tidak perlu database nyata.

### 3.3 Integration Test

Integration test menguji beberapa komponen aplikasi dengan dependency nyata.

Contoh:

- service + repository + PostgreSQL;
- service + Redis;
- publisher + broker;
- consumer + database;
- migration + schema validation;
- app startup + config validation;
- transaction + constraint behavior.

Docker sangat cocok untuk level ini.

### 3.4 Contract Test

Contract test memastikan producer dan consumer sepakat pada format dan semantics.

Contoh:

- REST consumer contract;
- event schema compatibility;
- message payload backward compatibility;
- OpenAPI expectation;
- Avro/JSON schema evolution.

Docker bisa membantu menjalankan provider/consumer dependency, tetapi kontrak itu sendiri bukan masalah Docker.

### 3.5 End-to-End Test

E2E test menjalankan sistem lengkap atau hampir lengkap.

Contoh:

- API gateway → service A → database → broker → service B;
- UI → backend → external fake service;
- full business workflow.

Docker Compose bisa membantu local E2E, tetapi E2E cenderung mahal dan flaky jika tidak dibatasi.

### 3.6 Smoke Test / Startup Test

Smoke test memastikan aplikasi bisa boot dengan konfigurasi tertentu.

Contoh:

- Spring context loads;
- database migration sukses;
- health endpoint healthy;
- required env var ada;
- TLS config valid.

Docker berguna untuk memastikan image/container benar-benar bisa berjalan, bukan hanya JAR bisa dibuild.

---

## 4. Prinsip: Docker Testing Bukan Mengganti Test Pyramid

Docker tidak menghapus kebutuhan unit test.

Model yang sehat:

```text
many       unit tests                 pure, fast, deterministic
some       slice tests                framework boundary
some       integration tests          real dependency via Docker/Testcontainers
few        contract/e2e tests          cross-service behavior
few        image/container tests       packaging and runtime validation
```

Anti-pattern yang sering terjadi:

```text
unit test sedikit
integration test banyak
semua test start database/broker sendiri
test suite lambat
CI flaky
engineer mulai skip test
kualitas turun
```

Docker harus digunakan untuk test yang memang membutuhkan real dependency.

Pertanyaan sebelum memakai Docker dalam test:

1. Apakah behavior yang diuji berasal dari dependency nyata?
2. Apakah mock akan menyembunyikan bug penting?
3. Apakah test ini harus berjalan di setiap PR?
4. Apakah startup cost sebanding dengan confidence yang didapat?
5. Apakah state bisa dibuat isolated dan repeatable?
6. Apakah failure test akan mudah didiagnosis?

Jika jawabannya tidak jelas, jangan langsung pakai container.

---

## 5. Docker Compose vs Testcontainers

Dua pendekatan utama:

1. Docker Compose
2. Testcontainers

Keduanya sah, tetapi punya mental model berbeda.

---

## 6. Docker Compose untuk Testing

Compose cocok ketika kita ingin mendeskripsikan topology multi-service secara deklaratif.

Contoh:

```yaml
services:
  app:
    build: .
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/app
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Compose berguna untuk:

- local full-stack test;
- demo environment;
- smoke test image;
- running app plus dependencies;
- manual exploratory testing;
- CI job yang ingin menjalankan topology tetap.

Docker Compose documentation menjelaskan bahwa Compose dapat mengatur startup/shutdown order dengan `depends_on`, dan Compose dapat menunggu dependency dengan condition `service_healthy` bila healthcheck tersedia. Ini penting karena “container started” tidak sama dengan “dependency ready”.

### 6.1 Kelebihan Compose

Compose unggul dalam readability topology.

Kita bisa melihat:

- service apa saja;
- network apa saja;
- volume apa saja;
- env apa saja;
- dependency order;
- healthcheck;
- port yang dipublish;
- profile opsional.

Compose sangat baik sebagai **executable system sketch**.

### 6.2 Kekurangan Compose untuk Automated Test

Compose kurang ideal untuk test granular karena:

- port sering statis;
- state volume bisa tertinggal;
- lifecycle test harus dikelola manual;
- sulit membuat dependency per test class;
- parallelization lebih sulit;
- wiring dynamic property ke test framework lebih manual;
- cleanup harus disiplin.

Compose cocok untuk:

- environment-level test;
- smoke test;
- local developer orchestration;
- integration test besar yang memang topology-nya tetap.

Compose kurang cocok untuk:

- banyak repository test paralel;
- dependency dinamis per test;
- test yang ingin random port;
- test suite yang perlu isolation ketat;
- library/module integration test.

---

## 7. Testcontainers untuk Java

Testcontainers adalah library Java yang mengontrol Docker dari test code.

Contoh sederhana:

```java
@Testcontainers
class UserRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("app")
            .withUsername("app")
            .withPassword("app");

    @Test
    void shouldPersistUser() {
        // test repository behavior against real PostgreSQL
    }
}
```

Kekuatan Testcontainers:

- container lifecycle terikat dengan test lifecycle;
- port random untuk menghindari collision;
- property bisa diambil dari container object;
- container disposable;
- banyak module siap pakai;
- wait strategy bisa dikonfigurasi;
- cocok untuk CI;
- cocok untuk parallel test jika dirancang benar.

Dokumentasi Testcontainers menyebut bahwa Testcontainers for Java mendukung JUnit tests dan menyediakan throwaway instances untuk common databases, Selenium browser, atau apa saja yang dapat berjalan di Docker container.

---

## 8. Mental Model Testcontainers

Testcontainers bukan “embedded database”.

Testcontainers adalah orchestrator kecil di dalam test process:

```text
JUnit test process
   |
   | asks Docker daemon to start container
   v
Docker daemon
   |
   | pulls image if needed
   | creates network/volume/container
   | starts container
   | maps random host port
   v
real dependency process
   |
   | test connects using mapped port/property
   v
assertion
   |
   | cleanup container/network/volume
```

Ini berarti test bergantung pada:

- Docker daemon availability;
- image availability;
- host resource;
- network;
- container startup time;
- proper cleanup;
- wait strategy;
- image architecture compatibility.

Karena itu Testcontainers memberi real confidence, tetapi bukan gratis.

---

## 9. The Core Testing Problem: Readiness

Masalah paling umum dalam Docker-based test:

> Container sudah running, tetapi service di dalamnya belum siap menerima request.

Contoh:

- PostgreSQL process started tetapi belum menerima connection;
- Kafka port terbuka tetapi broker belum siap membuat topic;
- Elasticsearch HTTP endpoint terbuka tetapi cluster status belum acceptable;
- app process started tetapi migration belum selesai;
- mock server started tetapi stub belum registered.

Dokumentasi Testcontainers menjelaskan bahwa default wait behavior biasanya menunggu sampai mapped network port pertama mulai listening, dengan timeout default tertentu. Ini cukup untuk beberapa service, tetapi sering tidak cukup untuk dependency kompleks.

Maka kita perlu wait strategy yang sesuai.

---

## 10. Wait Strategy

Wait strategy menjawab:

> Kapan test boleh mulai berinteraksi dengan container?

Jenis readiness signal:

1. port listening;
2. HTTP endpoint returns expected status;
3. log message muncul;
4. command di dalam container sukses;
5. healthcheck Docker healthy;
6. protocol-specific readiness;
7. custom application-level readiness.

Contoh HTTP wait:

```java
GenericContainer<?> mockService = new GenericContainer<>("wiremock/wiremock:3.5.4")
        .withExposedPorts(8080)
        .waitingFor(Wait.forHttp("/__admin").forStatusCode(200));
```

Contoh log wait:

```java
GenericContainer<?> app = new GenericContainer<>("my-app:test")
        .withExposedPorts(8080)
        .waitingFor(Wait.forLogMessage(".*Started Application.*", 1));
```

Contoh healthcheck wait:

```java
GenericContainer<?> service = new GenericContainer<>("some/service:1.0")
        .withExposedPorts(8080)
        .waitingFor(Wait.forHealthcheck());
```

Rule penting:

> Jangan menunggu “port terbuka” jika yang dibutuhkan test adalah “service siap secara semantic”.

Untuk Java/Spring Boot app, readiness yang lebih benar biasanya:

```text
GET /actuator/health/readiness -> UP
```

bukan sekadar port 8080 listening.

---

## 11. Startup Timeout

Beberapa dependency lambat saat cold start:

- Kafka;
- Elasticsearch;
- LocalStack;
- Oracle;
- SQL Server;
- image besar;
- mesin CI lambat;
- runner pertama kali pull image;
- emulation amd64 di arm64.

Timeout terlalu pendek menyebabkan flaky test.

Timeout terlalu panjang menyembunyikan masalah real.

Gunakan timeout eksplisit untuk dependency lambat:

```java
GenericContainer<?> elasticsearch = new GenericContainer<>("docker.elastic.co/elasticsearch/elasticsearch:8.13.4")
        .withExposedPorts(9200)
        .waitingFor(Wait.forHttp("/").forStatusCode(200)
                .withStartupTimeout(Duration.ofMinutes(2)));
```

Mental model:

```text
startup timeout is not performance target
startup timeout is maximum tolerated readiness delay
```

Tetap ukur startup time aktual di CI.

---

## 12. Dynamic Ports: Hindari Port Collision

Dalam Testcontainers, container port biasanya dimap ke random host port.

Container melihat port internal:

```text
postgres:5432 inside container
```

Host/test process melihat mapped port:

```java
postgres.getMappedPort(5432)
```

Jangan hardcode port host di test.

Salah:

```java
String url = "jdbc:postgresql://localhost:5432/app";
```

Benar:

```java
String url = postgres.getJdbcUrl();
```

Atau:

```java
String host = postgres.getHost();
Integer port = postgres.getMappedPort(5432);
```

Kenapa ini penting?

- CI bisa menjalankan test paralel;
- developer mungkin sudah punya PostgreSQL lokal;
- beberapa test class bisa start container sejenis;
- port statis menyebabkan flaky failure.

Docker Compose lebih sering memakai port statis, sehingga Compose lebih rentan port collision bila dipakai untuk test paralel.

---

## 13. State Isolation

Test yang baik harus deterministic.

Dependency container harus mulai dari state yang diketahui.

Strategi state isolation:

1. container baru per test class;
2. database schema reset per test;
3. transaction rollback per test;
4. truncate tables per test;
5. unique database per test;
6. unique topic/queue per test;
7. unique bucket/prefix per test;
8. no named volume unless intentional;
9. no dependency on execution order.

### 13.1 Container per Test Method

Paling isolated, tetapi paling lambat.

Cocok untuk:

- test stateful sangat sensitif;
- destructive behavior;
- verifying migration from empty state;
- testing startup behavior.

### 13.2 Container per Test Class

Umum dan cukup efisien.

Cocok untuk:

- repository test;
- service integration test;
- app context integration test.

Butuh reset state antar method.

### 13.3 Singleton Container per Test Suite

Paling cepat, tetapi risiko state leakage lebih tinggi.

Cocok bila:

- suite besar;
- startup dependency mahal;
- reset strategy matang;
- test tidak parallel destructive;
- data namespace dibuat unik.

Testcontainers memiliki guide lifecycle management untuk JUnit 5 dan membahas pola singleton container. Tetapi singleton harus dipakai hati-hati karena lifecycle annotation yang salah bisa menyebabkan container berhenti saat masih dibutuhkan oleh test lain.

---

## 14. Data Initialization

Ada beberapa cara menginisialisasi data.

### 14.1 Init Script Image/Container

Untuk PostgreSQL official image, script di `/docker-entrypoint-initdb.d` bisa dipakai saat database pertama kali dibuat.

Cocok untuk Compose local environment.

Kelemahan:

- hanya jalan saat data directory baru;
- jika volume persistent, script tidak rerun;
- bisa membingungkan untuk test yang perlu reset.

### 14.2 Migration Tool

Gunakan Flyway/Liquibase seperti production.

Ini sangat direkomendasikan untuk integration test database:

```text
start postgres container
start app/test context
run migration
run test
```

Keuntungan:

- schema test sama dengan production path;
- migration failure tertangkap lebih awal;
- tidak ada schema bayangan.

### 14.3 Test Fixture SQL

Masukkan data test setelah migration.

Contoh:

- `@Sql` Spring;
- repository helper;
- fixture builder;
- factory method;
- truncate + insert.

Pastikan fixture jelas dan minimal.

### 14.4 Programmatic Fixture

Untuk domain kompleks, fixture lebih baik dibuat lewat service/repository agar invariant domain dijaga.

Contoh:

```java
User user = userFixture.activeCustomer()
        .withVerifiedEmail()
        .withBalance(BigDecimal.TEN)
        .persist();
```

Kelemahan: fixture builder bisa menjadi framework internal yang rumit.

---

## 15. Spring Boot + Testcontainers

Spring Boot memiliki integrasi Testcontainers untuk test.

Pola klasik:

```java
@Testcontainers
@SpringBootTest
class UserServiceIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
}
```

Pola modern dengan Spring Boot service connection:

```java
@Testcontainers
@SpringBootTest
class UserServiceIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Test
    void shouldCreateUser() {
        // Spring Boot wires datasource connection details
    }
}
```

Dokumentasi Spring Boot menjelaskan bahwa Testcontainers library dapat mengelola service yang berjalan dalam Docker container dan terintegrasi dengan JUnit, sehingga test class dapat memulai container sebelum test berjalan. Spring Boot juga menyediakan support untuk development-time services seperti Docker Compose dan Testcontainers.

### 15.1 Kapan Pakai `@SpringBootTest`

Pakai `@SpringBootTest` saat ingin menguji:

- wiring app luas;
- transaction boundary;
- real configuration;
- controller sampai repository;
- app startup;
- actuator health;
- security filter chain;
- messaging consumer/publisher wiring.

Jangan pakai `@SpringBootTest` untuk semua test karena context startup mahal.

### 15.2 Kapan Pakai Slice Test + Testcontainers

Untuk repository:

```java
@DataJpaTest
@Testcontainers
class UserRepositoryIT {
    // PostgreSQL container + repository assertions
}
```

Ini lebih ringan daripada full application context.

### 15.3 Context Caching

Spring test context caching bisa mempercepat test, tetapi mudah rusak jika dynamic property berbeda antar class.

Jika setiap test class membuat container dengan URL berbeda, Spring mungkin membuat banyak context.

Trade-off:

```text
more isolation -> more context startups -> slower suite
shared context -> faster suite -> greater need for state discipline
```

---

## 16. Compose vs Testcontainers: Decision Matrix

| Kebutuhan | Lebih Cocok |
|---|---|
| Local full-stack dev | Compose |
| Manual exploratory testing | Compose |
| Demo environment | Compose |
| CI smoke test image | Compose atau Docker CLI |
| Repository integration test | Testcontainers |
| Dynamic per-test dependency | Testcontainers |
| Parallel test suite | Testcontainers |
| Random port mapping | Testcontainers |
| Test dengan topology banyak service statis | Compose atau Testcontainers Compose module |
| App container + dependency container E2E lokal | Compose |
| Fine-grained lifecycle dari Java test | Testcontainers |

General rule:

```text
Compose describes an environment.
Testcontainers describes test-owned dependencies.
```

---

## 17. Testcontainers Compose Module

Testcontainers juga bisa menjalankan Docker Compose file.

Cocok saat:

- topology sudah ada dalam Compose;
- ingin reuse Compose untuk test;
- service banyak dan saling terkait;
- tidak ingin mendefinisikan semua container di Java code.

Namun hati-hati:

- debug lebih kompleks;
- startup lebih lambat;
- mapping service/port harus jelas;
- Compose file untuk dev belum tentu cocok untuk test;
- state leakage tetap harus dikelola.

Dokumentasi Testcontainers Docker Compose module menjelaskan bahwa wait strategy dan startup timeout dapat dikonfigurasi untuk exposed service. Ini penting karena Compose topology tetap membutuhkan readiness semantics yang benar.

---

## 18. Testing the Docker Image Itself

Ada dua hal berbeda:

1. Test aplikasi dari source/JAR.
2. Test image container final.

Integration test biasa sering menjalankan aplikasi dari JVM test process:

```text
JUnit process starts Spring Boot app in-process
PostgreSQL runs in container
```

Tetapi production menjalankan app sebagai container:

```text
Docker image starts java process
config injected via env
network/port exposed
health endpoint checked
```

Karena itu perlu juga image-level smoke test.

### 18.1 Image Smoke Test

Tujuan:

- image bisa start;
- `ENTRYPOINT` benar;
- env config terbaca;
- port bind benar;
- health endpoint healthy;
- SIGTERM graceful;
- non-root user tidak merusak write path;
- CA/timezone/config tersedia.

Contoh dengan Docker CLI:

```bash
docker build -t my-service:test .
docker run --rm -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=test \
  my-service:test
```

Contoh dengan Testcontainers `GenericContainer`:

```java
GenericContainer<?> app = new GenericContainer<>(DockerImageName.parse("my-service:test"))
        .withExposedPorts(8080)
        .withEnv("SPRING_PROFILES_ACTIVE", "test")
        .waitingFor(Wait.forHttp("/actuator/health/readiness").forStatusCode(200));
```

### 18.2 Apa yang Harus Diuji di Image Level

Minimal:

- app process starts;
- health readiness UP;
- logs keluar ke stdout/stderr;
- app dapat connect ke dependency;
- container stop dengan SIGTERM;
- tidak butuh root untuk normal operation.

Tidak perlu semua business test diulang di image-level test.

Gunakan image test sebagai packaging/runtime validation.

---

## 19. CI Pipeline Design

Docker-based test di CI harus dirancang eksplisit.

### 19.1 Prasyarat CI

CI runner harus punya:

- Docker daemon atau compatible runtime;
- permission untuk menjalankan container;
- network access ke registry;
- disk space cukup;
- memory/CPU cukup;
- image cache strategy;
- cleanup policy.

Testcontainers melakukan startup checks untuk memastikan environment dikonfigurasi dengan benar, termasuk Docker version, file mountability, dan akses port container. Ini membantu mendeteksi environment CI yang tidak valid lebih awal.

### 19.2 CI Job Pattern

Pola umum:

```text
checkout
setup JDK
login registry if needed
restore build cache
run unit tests
run integration tests with Testcontainers
build image
run image smoke test
scan image
publish image
```

Atau:

```text
checkout
build image
compose up dependencies + app
run black-box smoke tests
compose down -v
```

### 19.3 Jangan Campur Semua dalam Satu Job Besar

Lebih baik pisahkan:

- unit test cepat;
- integration test;
- image build;
- image smoke test;
- scan/publish.

Agar failure mudah dibaca.

Jika semua digabung, engineer sulit tahu apakah gagal karena:

- compile error;
- unit failure;
- Docker daemon unavailable;
- dependency not ready;
- image build failure;
- smoke test failure;
- registry push failure.

---

## 20. Parallel Test

Parallel test mempercepat CI, tetapi Docker dependency membuatnya lebih rumit.

Risiko:

- resource exhaustion;
- many containers start at once;
- disk IO bottleneck;
- port collision bila hardcoded;
- shared singleton state;
- Docker pull storm;
- flaky readiness;
- test order dependency.

Strategi:

1. Gunakan random mapped ports.
2. Hindari named volume shared.
3. Gunakan unique database/schema/topic per test group.
4. Batasi parallelism untuk integration test.
5. Pisahkan unit parallel luas, integration parallel terbatas.
6. Pre-pull image bila perlu.
7. Gunakan reuse/singleton hanya jika state reset matang.

Contoh naming unik:

```java
String topic = "orders-" + UUID.randomUUID();
String schema = "test_" + UUID.randomUUID().toString().replace("-", "_");
String bucket = "it-" + UUID.randomUUID();
```

Jangan bergantung pada nama tetap seperti:

```text
orders-test
app_test
my-bucket
```

jika test berjalan paralel.

---

## 21. Image Pinning untuk Test

Jangan gunakan tag ambigu untuk dependency test kritis.

Kurang baik:

```java
new PostgreSQLContainer<>("postgres:latest")
```

Lebih baik:

```java
new PostgreSQLContainer<>("postgres:16.3")
```

Lebih ketat lagi untuk reproducibility:

```text
postgres:16.3@sha256:...
```

Trade-off:

- pin versi membantu deterministic test;
- terlalu lama tidak upgrade membuat test tertinggal dari patch security;
- perlu dependabot/renovate atau proses upgrade image berkala.

Untuk test, tag versi minor/patch sering cukup.

Untuk production image promotion, digest lebih kuat.

---

## 22. Architecture Mismatch: amd64 vs arm64

Masalah umum sejak banyak developer memakai Apple Silicon:

```text
dev laptop: linux/arm64
CI/prod: linux/amd64
some image: only amd64
```

Gejala:

- `exec format error`;
- image berjalan via emulation dan lambat;
- native library gagal load;
- CI pass tapi local fail;
- local pass tapi prod fail.

Strategi:

1. Pilih image multi-arch.
2. Hindari native dependency yang tidak jelas support-nya.
3. Jalankan integration test di arsitektur yang sama dengan production untuk critical path.
4. Explicit platform hanya bila perlu.
5. Jangan menyembunyikan architecture problem dengan emulation tanpa sadar.

Contoh Compose:

```yaml
services:
  legacy-db:
    image: some/vendor-db:1.0
    platform: linux/amd64
```

Ini bisa membantu local dev, tetapi memperlambat startup di arm64 karena emulation.

---

## 23. Cleanup

Container test harus disposable.

Hal yang perlu dibersihkan:

- container;
- network;
- volume;
- temporary file;
- image khusus test bila dibuat dinamis;
- dangling build cache bila CI sempit disk.

Testcontainers biasanya mengelola cleanup menggunakan lifecycle dan resource reaper.

Compose perlu manual:

```bash
docker compose down -v --remove-orphans
```

Tanpa `-v`, named volume bisa bertahan dan menyebabkan state leakage.

Tanpa `--remove-orphans`, service lama bisa tertinggal dari Compose file sebelumnya.

CI cleanup penting karena error klasik:

```text
no space left on device
```

Penyebab:

- image layer menumpuk;
- build cache besar;
- log container besar;
- volume tidak dibersihkan;
- failed job tidak menjalankan teardown.

Gunakan teardown yang tetap berjalan walaupun test gagal.

---

## 24. Docker-Based Test Failure Mode Catalogue

### 24.1 Docker Daemon Tidak Tersedia

Gejala:

```text
Cannot connect to the Docker daemon
```

Kemungkinan:

- Docker Desktop belum jalan;
- CI service Docker belum tersedia;
- user tidak punya permission;
- DOCKER_HOST salah;
- remote Docker context salah.

Diagnosis:

```bash
docker version
docker info
docker context ls
```

### 24.2 Image Pull Gagal

Gejala:

```text
pull access denied
manifest unknown
too many requests
```

Kemungkinan:

- image private belum login;
- tag salah;
- registry rate limit;
- network/proxy;
- platform unsupported.

Mitigasi:

- login registry di CI;
- pin versi valid;
- cache image;
- mirror registry;
- gunakan image multi-arch.

### 24.3 Container Running tetapi Test Gagal Connect

Kemungkinan:

- memakai port container bukan mapped port;
- hardcode localhost:5432;
- service belum ready;
- bind address salah;
- network host/container confusion;
- TLS config salah.

Diagnosis:

- inspect mapped port;
- lihat logs;
- cek wait strategy;
- gunakan `getHost()` dan `getMappedPort()`;
- cek health endpoint.

### 24.4 Test Flaky Karena Readiness

Gejala:

- pass local, fail CI;
- fail random;
- retry pass;
- connection refused sesekali.

Root cause umum:

- wait for port, bukan readiness;
- timeout terlalu pendek;
- dependency cold start lambat;
- CI resource constrained;
- container log readiness pattern tidak stabil.

Solusi:

- wait strategy lebih semantic;
- healthcheck;
- startup timeout realistis;
- kurangi parallelism;
- pre-pull image.

### 24.5 State Leakage

Gejala:

- test pass sendiri, fail saat suite penuh;
- duplicate key;
- expected empty table but found rows;
- old schema masih ada;
- event dari test lain kebaca.

Root cause:

- shared container tanpa reset;
- named volume persistent;
- static topic/queue/bucket;
- test order dependency.

Solusi:

- truncate/reset;
- unique namespace;
- avoid shared mutable state;
- recreate container;
- `docker compose down -v`.

### 24.6 Disk Penuh di CI

Gejala:

```text
no space left on device
```

Root cause:

- image cache terlalu besar;
- dangling images;
- logs;
- volumes;
- build cache.

Solusi:

- cleanup policy;
- CI runner disk monitoring;
- prune terkontrol;
- batasi log;
- jangan build image raksasa.

### 24.7 Architecture Mismatch

Gejala:

```text
exec format error
```

Root cause:

- image platform tidak cocok;
- native binary amd64 di arm64;
- vendor image hanya satu architecture.

Solusi:

- pakai multi-platform image;
- explicit platform sementara;
- buildx multi-arch;
- jalankan critical CI di arch production.

---

## 25. Design Pattern: Repository Integration Test with PostgreSQL

Tujuan:

- validasi query;
- validasi constraint;
- validasi migration;
- validasi transaction behavior;
- validasi mapping JPA/JDBC.

Skeleton:

```java
@Testcontainers
@DataJpaTest
class AccountRepositoryIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.3");

    @Autowired
    AccountRepository repository;

    @Test
    void shouldRejectDuplicateExternalId() {
        repository.save(new Account("ext-1"));

        assertThatThrownBy(() -> repository.saveAndFlush(new Account("ext-1")))
                .hasRootCauseInstanceOf(SQLException.class);
    }
}
```

Hal yang diuji di sini bukan “PostgreSQL bekerja”, tetapi:

- schema constraint benar;
- mapping repository benar;
- app menangani violation sesuai expectation.

Jangan mock constraint database jika constraint adalah bagian dari correctness.

---

## 26. Design Pattern: App Integration Test with Real Dependency

Tujuan:

- menguji wiring Spring context;
- menguji API sampai DB;
- menguji config property;
- menguji serialization + transaction + persistence.

Skeleton:

```java
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UserApiIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.3");

    @Autowired
    TestRestTemplate rest;

    @Test
    void shouldCreateUser() {
        ResponseEntity<CreateUserResponse> response = rest.postForEntity(
                "/users",
                new CreateUserRequest("alice@example.com"),
                CreateUserResponse.class
        );

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody().id()).isNotNull();
    }
}
```

Ini lebih mahal daripada repository test. Gunakan untuk flow penting, bukan semua kombinasi validation.

---

## 27. Design Pattern: Message Broker Integration Test

Untuk broker, masalah utama bukan sekadar broker start, tetapi:

- topic/queue/exchange setup;
- consumer readiness;
- asynchronous assertion;
- idempotency;
- ordering;
- retry/dead-letter behavior;
- cleanup event antar test.

Testing async butuh assertion dengan timeout yang rasional.

Pseudo-pattern:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(() -> {
        assertThat(repository.findByOrderId(orderId)).isPresent();
    });
```

Hindari:

```java
Thread.sleep(5000);
```

Karena sleep tetap bisa:

- terlalu pendek di CI;
- terlalu panjang di local;
- menyembunyikan readiness problem;
- memperlambat suite.

Gunakan await/polling assertion.

---

## 28. Design Pattern: External HTTP Dependency with Mock Server Container

Kadang dependency real tidak boleh dipakai dalam test:

- payment provider;
- government API;
- email service;
- SMS service;
- identity provider production;
- third-party API berbayar.

Gunakan mock server container seperti WireMock.

Tujuan:

- tetap test network/config/serialization;
- tidak bergantung third-party;
- bisa set response deterministik;
- bisa assert request yang dikirim app.

Pola:

```text
start mock server container
register stubs
inject base URL into app
run test
verify outbound request
```

Ini lebih kuat daripada Java mock biasa untuk adapter HTTP karena tetap melewati HTTP stack nyata.

---

## 29. Test Data and Time

Docker tidak menyelesaikan masalah waktu.

Test tetap bisa flaky karena:

- timezone berbeda;
- clock sekarang berubah;
- TTL expiration;
- scheduled job;
- retry backoff;
- token expiry;
- database timestamp precision.

Strategi:

- inject `Clock` di Java app;
- gunakan fixed clock untuk domain logic;
- hindari assert timestamp exact jika DB precision berbeda;
- set timezone container bila perlu;
- gunakan tolerance untuk time-based assertion;
- jangan mengandalkan local machine timezone.

Dalam Docker, timezone image bisa berbeda dari host. Untuk test yang sensitif timezone, buat eksplisit.

---

## 30. Test Network Model

Testcontainers biasanya mengekspos dependency ke host test process melalui mapped port.

```text
JUnit JVM on host -> localhost/random-port -> container:internal-port
```

Jika app juga berjalan di host JVM, ini sederhana.

Tetapi jika app berjalan sebagai container, network model berubah:

```text
app container -> dependency container via Docker network alias
JUnit JVM -> app container via mapped port
```

Pahami dua arah:

1. test process mengakses container;
2. container mengakses container lain.

Untuk app container, jangan inject `localhost` sebagai database host karena dari dalam app container `localhost` berarti app container sendiri.

Gunakan network alias:

```java
Network network = Network.newNetwork();

PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.3")
        .withNetwork(network)
        .withNetworkAliases("db");

GenericContainer<?> app = new GenericContainer<>("my-service:test")
        .withNetwork(network)
        .withEnv("SPRING_DATASOURCE_URL", "jdbc:postgresql://db:5432/app")
        .dependsOn(postgres);
```

---

## 31. Testing Graceful Shutdown

Docker-based image tests bisa menangkap bug shutdown yang unit test tidak lihat.

Yang ingin diuji:

- app menerima SIGTERM;
- request in-flight diberi waktu selesai;
- consumer berhenti mengambil message baru;
- connection pool close;
- app exit dalam timeout;
- tidak perlu SIGKILL.

Pola:

```text
start app container
wait readiness
send request or start long-running operation
stop container with timeout
assert behavior/log/exit
```

Ini lebih advanced dan tidak perlu di semua service, tetapi penting untuk service yang memproses transaksi, message, atau workflow regulatory/enforcement yang tidak boleh berhenti di tengah tanpa kompensasi.

---

## 32. Testing Migration

Migration harus diuji sebagai first-class behavior.

Jenis test:

1. migrate empty database;
2. migrate existing schema version N ke N+1;
3. rollback/forward compatibility jika didukung;
4. app versi lama dan baru compatibility selama rolling deploy;
5. destructive migration detection.

Docker membantu karena database bisa dibuat fresh per test.

Pola sederhana:

```text
start database container
run migration tool
assert schema exists
run application/repository assertion
```

Untuk migration dari data lama:

```text
start database
apply baseline schema/data fixture
run new migration
assert data preserved/transformed
```

Jangan hanya mengandalkan “Spring context loads” untuk migration kompleks.

---

## 33. Testing Against Production-Like Versions

Dependency test harus cukup dekat dengan production.

Jika production PostgreSQL 16, jangan test utama dengan H2 lalu berharap sama.

H2 berguna untuk beberapa fast test, tetapi berbeda dalam:

- SQL dialect;
- transaction behavior;
- locking;
- constraints;
- JSON support;
- index behavior;
- timestamp precision;
- isolation;
- query planner.

Prinsip:

```text
Use fake/embedded only when difference is irrelevant to the behavior under test.
Use real container when dependency semantics are part of correctness.
```

---

## 34. Performance Strategy for Docker-Based Tests

Testcontainers bisa lambat jika dipakai naif.

Optimization yang aman:

1. Pin image agar cache efektif.
2. Pre-pull heavy images di CI.
3. Gunakan container per class, bukan per method, bila state bisa direset.
4. Gunakan Spring context caching.
5. Batasi full `@SpringBootTest`.
6. Gunakan slice test untuk repository.
7. Reuse expensive dependency hanya dengan reset state kuat.
8. Hindari membangun image di setiap test class.
9. Split unit dan integration test task.
10. Jalankan integration test hanya saat relevan bila pipeline besar.

Optimization yang berbahaya:

- shared global database tanpa isolation;
- disabling wait strategy;
- hardcoded sleep kecil;
- pakai `latest` agar “selalu baru”;
- skip cleanup;
- mount source directory besar ke container test;
- menjalankan semua test full app context.

---

## 35. Maven/Gradle Separation

Pisahkan unit dan integration test.

### 35.1 Maven Pattern

Konvensi:

```text
*Test.java      -> unit/slice fast test
*IT.java        -> integration test
```

Umum:

- Surefire untuk unit test;
- Failsafe untuk integration test.

Pipeline:

```bash
mvn test
mvn verify
```

Atau profile:

```bash
mvn verify -Pintegration-test
```

### 35.2 Gradle Pattern

Buat source set atau task terpisah:

```groovy
tasks.register('integrationTest', Test) {
    useJUnitPlatform()
    shouldRunAfter test
}
```

Tujuannya bukan sekadar naming, tetapi execution control:

- local fast loop;
- CI full validation;
- easier failure classification;
- selective parallelism;
- separate reports.

---

## 36. Local Developer Workflow

Developer harus bisa memilih level confidence.

Contoh workflow:

```bash
./gradlew test
./gradlew integrationTest
./gradlew bootTestRun
./gradlew buildImage
./gradlew imageSmokeTest
```

Atau Maven:

```bash
mvn test
mvn verify -Pintegration
mvn spring-boot:build-image
```

Dokumentasikan dependency:

- Docker harus running;
- image yang dipakai;
- approximate startup time;
- cara melihat logs;
- cara cleanup;
- common failure.

Jangan membuat engineer menebak kenapa integration test gagal.

---

## 37. Practical Checklist: Good Docker-Based Integration Test

Sebuah Docker-based integration test yang baik memiliki karakteristik:

- dependency nyata memang diperlukan;
- image version dipin;
- port host tidak di-hardcode;
- readiness strategy semantic;
- state reset jelas;
- lifecycle jelas;
- logs mudah diakses saat gagal;
- timeout realistis;
- cleanup otomatis;
- tidak bergantung test order;
- bisa berjalan di CI;
- failure message membantu;
- tidak mengulang semua unit test;
- tidak memakai production secret;
- tidak memakai shared external environment;
- parallelism dipikirkan;
- architecture compatibility jelas.

---

## 38. Anti-Pattern Catalogue

### Anti-Pattern 1 — Semua Test Pakai Docker

Masalah:

- suite lambat;
- feedback loop buruk;
- CI mahal;
- engineer malas menjalankan test.

Solusi:

- pertahankan unit test dominan;
- pakai Docker hanya untuk boundary nyata.

### Anti-Pattern 2 — Mock Semua Dependency

Masalah:

- query SQL tidak pernah diuji;
- migration rusak tidak tertangkap;
- broker behavior hanya asumsi;
- config error baru terlihat production.

Solusi:

- gunakan Testcontainers untuk dependency semantics penting.

### Anti-Pattern 3 — Hardcoded Port

Masalah:

- port collision;
- parallel test gagal;
- local environment bentrok.

Solusi:

- gunakan mapped port dynamic;
- inject property dari container.

### Anti-Pattern 4 — Wait with Sleep

Masalah:

- flaky;
- lambat;
- tidak semantic.

Solusi:

- gunakan wait strategy;
- gunakan await assertion untuk async behavior.

### Anti-Pattern 5 — Shared Mutable Test Database

Masalah:

- state leakage;
- test order dependency;
- debugging sulit.

Solusi:

- disposable container;
- truncate;
- unique schema;
- transaction rollback.

### Anti-Pattern 6 — `latest` in Test Dependency

Masalah:

- test tiba-tiba gagal tanpa perubahan code;
- sulit reproduce failure;
- CI dan local berbeda.

Solusi:

- pin version;
- upgrade dependency secara eksplisit.

### Anti-Pattern 7 — Compose Dev File Dipakai Mentah untuk CI

Masalah:

- port statis;
- volume persistent;
- debug service ikut jalan;
- env local bocor;
- startup terlalu berat.

Solusi:

- Compose override khusus test;
- profile test;
- no persistent state unless intentional.

### Anti-Pattern 8 — Image Smoke Test Mengulang Semua Business Test

Masalah:

- lambat;
- duplikasi;
- sulit maintain.

Solusi:

- image smoke test hanya untuk packaging/runtime contract.

---

## 39. Example: Layered Test Strategy untuk Java Service

Misalkan service Java:

- Spring Boot REST API;
- PostgreSQL;
- Redis;
- Kafka;
- external payment HTTP API;
- Docker image production.

Strategi test yang sehat:

### Unit Test

- pricing;
- validation;
- state transition;
- retry policy;
- idempotency key logic.

No Docker.

### Repository Integration Test

- PostgreSQL Testcontainer;
- Flyway migration;
- repository query;
- constraint behavior.

### Cache Integration Test

- Redis Testcontainer;
- TTL behavior;
- serialization;
- cache invalidation.

### Messaging Integration Test

- Kafka Testcontainer;
- publisher/consumer behavior;
- idempotent consumer;
- retry/dead-letter if applicable.

### External HTTP Adapter Test

- WireMock container;
- request/response mapping;
- error mapping;
- timeout behavior.

### Application Flow Integration Test

- Spring Boot full context;
- PostgreSQL + Redis maybe real;
- mock external HTTP;
- selected critical flows only.

### Image Smoke Test

- run built image;
- inject env;
- dependency container network;
- readiness endpoint;
- stdout logs;
- graceful stop.

### E2E Test

- small number;
- critical path only;
- maybe Compose.

Ini memberi confidence luas tanpa menjadikan semua test mahal.

---

## 40. Failure Diagnosis Flow

Saat Docker-based test gagal, jangan langsung rerun tanpa membaca signal.

Gunakan urutan:

```text
1. Apakah Docker daemon tersedia?
2. Apakah image berhasil dipull?
3. Apakah container berhasil dibuat?
4. Apakah container masih running?
5. Apakah dependency ready atau hanya started?
6. Apakah test memakai host/port yang benar?
7. Apakah state dari test sebelumnya bocor?
8. Apakah timeout realistis untuk CI?
9. Apakah architecture image cocok?
10. Apakah failure berasal dari app behavior yang valid?
```

Evidence yang perlu dikumpulkan:

- container logs;
- mapped ports;
- inspect output;
- test failure stacktrace;
- image tag/digest;
- Docker daemon info;
- CI runner resource;
- timing startup;
- wait strategy result;
- cleanup result.

---

## 41. Senior Engineer View: What Good Looks Like

Engineer yang mature dengan Docker testing tidak sekadar “bisa menulis Testcontainers”.

Mereka bisa menjelaskan:

- kenapa test tertentu butuh dependency real;
- kenapa test lain cukup mock;
- bagaimana state direset;
- bagaimana readiness ditentukan;
- bagaimana test berjalan paralel;
- bagaimana failure didiagnosis;
- bagaimana CI runner dikonfigurasi;
- bagaimana image dependency di-upgrade;
- bagaimana menghindari flaky test;
- bagaimana Docker testing masuk ke release confidence model.

Tujuan akhirnya:

```text
fast feedback for simple logic
realistic feedback for integration boundaries
runtime feedback for container packaging
minimal flakiness
clear failure classification
```

---

## 42. Ringkasan Mental Model

Docker untuk automated testing bukan berarti semua test harus menjalankan container.

Gunakan model ini:

```text
Unit test:
  logic correctness without Docker

Slice test:
  framework boundary, optionally real dependency

Integration test:
  real dependency via Testcontainers

Compose test:
  environment/topology-level validation

Image smoke test:
  packaging/runtime contract validation

E2E test:
  selected cross-service business path
```

Compose dan Testcontainers memiliki peran berbeda:

```text
Compose = describe environment topology
Testcontainers = test-owned disposable dependency lifecycle
```

Readiness adalah sumber utama flakiness:

```text
running != ready
port open != semantic readiness
sleep != wait strategy
```

State isolation adalah sumber utama determinism:

```text
shared mutable state -> order dependency -> flaky suite
```

Java-specific point:

```text
Spring context startup, migration, connection property wiring, and async messaging all interact with Docker lifecycle.
```

---

## 43. Latihan Praktis

### Latihan 1 — Repository Test dengan PostgreSQL

Buat test repository yang:

- menjalankan PostgreSQL dengan Testcontainers;
- menjalankan migration;
- menguji unique constraint;
- menguji query custom;
- tidak memakai H2.

Evaluasi:

- apakah test bisa jalan di CI?
- apakah port tidak hardcoded?
- apakah schema dibuat dari migration production?

### Latihan 2 — Redis TTL Test

Buat test yang:

- menjalankan Redis container;
- menyimpan key dengan TTL;
- assert expiration dengan polling;
- tidak memakai sleep fixed panjang.

Evaluasi:

- apakah test deterministic?
- apakah timeout realistis?

### Latihan 3 — App Image Smoke Test

Build image aplikasi Java.

Lalu test:

- container start;
- env config terbaca;
- readiness endpoint UP;
- logs muncul di stdout;
- container stop dengan exit normal.

Evaluasi:

- apakah bug `ENTRYPOINT` akan tertangkap?
- apakah app bind ke `0.0.0.0`?
- apakah non-root user punya permission yang cukup?

### Latihan 4 — Compose Test Profile

Buat `compose.yml` dengan profiles:

- default minimal;
- `test` untuk dependency integration;
- `debug` untuk tooling opsional.

Evaluasi:

- apakah service test tidak membuat volume persistent tidak sengaja?
- apakah `depends_on.condition: service_healthy` dipakai dengan benar?

### Latihan 5 — Flaky Test Diagnosis

Ambil satu test yang kadang gagal.

Klasifikasikan apakah root cause-nya:

- readiness;
- state leakage;
- timeout;
- resource exhaustion;
- port collision;
- image pull;
- architecture mismatch;
- app bug real.

---

## 44. Checklist Review untuk Pull Request

Saat review PR yang menambah Docker-based test, tanyakan:

- Apakah Docker memang diperlukan untuk behavior ini?
- Apakah image version dipin?
- Apakah readiness strategy semantic?
- Apakah state test isolated?
- Apakah test bisa parallel?
- Apakah timeout masuk akal?
- Apakah logs mudah dibaca saat gagal?
- Apakah test menambah terlalu banyak startup cost?
- Apakah property injection aman dan jelas?
- Apakah cleanup reliable?
- Apakah CI runner mendukung kebutuhan resource-nya?
- Apakah test ini overlap dengan unit test yang lebih murah?

---

## 45. Penutup

Docker membuat integration testing Java jauh lebih realistis, tetapi realistis bukan berarti otomatis baik.

Kualitas test tetap bergantung pada desain:

- boundary yang diuji;
- dependency yang dipilih;
- lifecycle yang dikontrol;
- readiness yang benar;
- state isolation;
- cleanup;
- CI ergonomics;
- failure diagnosis.

Testcontainers adalah alat yang sangat kuat untuk Java karena ia membawa Docker lifecycle langsung ke dalam test code. Compose tetap penting untuk topology lokal dan environment-level validation. Keduanya saling melengkapi, bukan saling menggantikan.

Prinsip akhirnya:

```text
Use the cheapest test that can catch the class of bug you care about.
Use Docker when real runtime/dependency semantics are the thing under test.
```

Pada part berikutnya kita akan masuk ke CI/CD dengan Docker: bagaimana membangun image sekali, memakai cache dengan benar, memberi tag secara aman, melakukan promotion by digest, dan menghindari pipeline yang non-reproducible.

---

# Status Seri

Selesai: Part 023 dari 031.

Seri belum selesai.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-024.md
```

Topik berikutnya:

```text
CI/CD with Docker: Build Once, Cache Correctly, Promote Safely
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Debugging Running Containers: `exec`, Inspect, Events, Minimal Images</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-024.md">Part 024 — CI/CD with Docker: Build Once, Cache Correctly, Promote Safely ➡️</a>
</div>
