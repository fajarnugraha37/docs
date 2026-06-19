# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-004

# Part 004 — Dev Mode, Continuous Testing, Dev UI, Dev Services: Feedback Loop Engineering

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Bagian: `004 / 035`  
> Status: **belum bagian terakhir**  
> Fokus: memahami Quarkus bukan hanya sebagai runtime production, tetapi juga sebagai **feedback-loop engineering platform** untuk mempercepat development tanpa mengorbankan production discipline.

---

## 0. Kenapa Part Ini Penting?

Pada banyak framework Java enterprise klasik, developer feedback loop biasanya seperti ini:

```text
ubah kode
  -> compile
  -> package ulang
  -> restart server / redeploy WAR
  -> tunggu application context naik
  -> buka endpoint / jalankan test
  -> ulangi
```

Di sistem kecil, ini hanya terasa sedikit lambat. Di sistem besar, ini menjadi hambatan arsitektural:

- developer malas menjalankan test karena mahal;
- local environment sulit disiapkan;
- bug integrasi baru terlihat di CI atau UAT;
- developer menulis kode dengan confidence rendah;
- perubahan kecil terasa mahal;
- refactoring menjadi menakutkan;
- design feedback datang terlambat.

Quarkus mencoba memecahkan masalah ini dengan kumpulan fitur yang saling melengkapi:

1. **Dev Mode** — aplikasi berjalan dalam mode development dengan live reload.
2. **Continuous Testing** — test dijalankan otomatis ketika kode berubah.
3. **Dev UI** — introspection UI untuk melihat endpoint, config, Dev Services, test, build metrics, extension, dan state development.
4. **Dev Services** — provisioning otomatis dependency eksternal seperti database, Kafka, Redis, Keycloak, RabbitMQ, dan service lain dalam mode dev/test.

Materi ini bukan sekadar “cara pakai fitur”. Tujuan sebenarnya adalah memahami:

> bagaimana Quarkus mengubah feedback loop dari aktivitas manual menjadi sistem yang otomatis, dekat dengan runtime, dan bisa dipakai untuk membentuk desain yang lebih cepat tervalidasi.

Namun ada jebakan besar:

> fitur development yang terlalu nyaman bisa membuat developer lupa membedakan local convenience dari production truth.

Karena itu part ini akan membahas dua sisi sekaligus:

- bagaimana memaksimalkan velocity;
- bagaimana menjaga disiplin production.

---

## 1. Mental Model: Feedback Loop sebagai Bagian dari Architecture

### 1.1 Feedback loop bukan hanya tooling

Banyak engineer melihat dev mode, hot reload, test otomatis, atau container otomatis sebagai “developer convenience”. Itu benar, tapi belum lengkap.

Feedback loop memengaruhi kualitas arsitektur.

Kenapa?

Karena kualitas desain sangat bergantung pada seberapa cepat asumsi bisa diuji.

Misalnya kamu mengubah:

- mapping DTO;
- validation rule;
- authorization guard;
- SQL query;
- transaction boundary;
- Kafka consumer behavior;
- OIDC config;
- database migration;
- REST error mapper;
- startup lifecycle;
- health check;
- config profile.

Kalau setiap perubahan butuh restart manual, setup manual, dan test manual, maka secara psikologis developer akan cenderung:

- membuat perubahan lebih besar sekaligus;
- menunda test;
- menghindari refactoring;
- tidak sering mengecek behavior;
- menormalisasi “nanti dicek di UAT”.

Itu buruk.

Quarkus mencoba membuat loop seperti ini:

```text
ubah kode / config / test
  -> Quarkus detect perubahan
  -> reload bagian relevan
  -> test terdampak berjalan
  -> dependency eksternal tersedia otomatis
  -> hasil bisa dilihat di console / Dev UI
  -> developer mendapat feedback cepat
```

Mental modelnya:

> Quarkus dev experience adalah mini-runtime lab yang dibuat untuk memperpendek jarak antara perubahan kode dan bukti perilaku.

### 1.2 Feedback loop yang baik punya 5 properti

Sebuah feedback loop development yang matang punya lima properti:

| Properti | Maksud | Dampak |
|---|---|---|
| Cepat | feedback muncul dalam detik, bukan menit | developer sering mencoba dan memperbaiki |
| Lokal | bisa jalan di laptop tanpa environment shared yang rapuh | tidak saling mengganggu antar developer |
| Reproducible | state dan dependency bisa diulang | bug lebih mudah ditelusuri |
| Representative | cukup mirip production untuk validasi perilaku penting | mengurangi “works on my machine” |
| Terkontrol | perbedaan dev/prod eksplisit | mencegah ilusi keamanan |

Quarkus membantu pada empat properti pertama, tapi properti kelima tetap tanggung jawab engineer.

---

## 2. Komponen Utama Development Experience Quarkus

Secara ringkas:

```text
┌────────────────────────────────────────────────────────────┐
│                    Quarkus Development Loop                 │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Source change                                              │
│      │                                                     │
│      ▼                                                     │
│  Dev Mode reload                                            │
│      │                                                     │
│      ├── re-run augmentation where needed                   │
│      ├── restart/reload application parts                   │
│      ├── expose Dev UI state                                │
│      └── trigger continuous testing                         │
│                                                            │
│  Dev Services                                               │
│      ├── database                                           │
│      ├── message broker                                     │
│      ├── cache                                              │
│      ├── identity provider                                  │
│      └── other external dependencies                        │
│                                                            │
│  Continuous Testing                                         │
│      ├── impacted tests                                     │
│      ├── full test suite on demand                          │
│      ├── failure feedback                                   │
│      └── test control from console / Dev UI                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

Fitur-fitur ini tidak berdiri sendiri. Mereka saling menguatkan.

Dev Mode tanpa Dev Services masih bisa cepat, tapi integration dependency tetap menyulitkan.

Dev Services tanpa continuous testing hanya membuat environment mudah, tapi tidak otomatis memvalidasi behavior.

Dev UI tanpa disiplin hanya menjadi dashboard cantik, bukan engineering instrument.

---

## 3. Dev Mode: Runtime Khusus untuk Development

### 3.1 Apa itu Dev Mode?

Dev Mode adalah mode menjalankan aplikasi Quarkus untuk development. Biasanya dijalankan dengan:

```bash
./mvnw quarkus:dev
```

atau:

```bash
./gradlew quarkusDev
```

atau dengan Quarkus CLI:

```bash
quarkus dev
```

Dalam mode ini, Quarkus akan:

- menjalankan aplikasi;
- memantau perubahan source/resource/config;
- melakukan reload ketika ada perubahan;
- menyediakan Dev UI;
- dapat menjalankan continuous testing;
- dapat memulai Dev Services;
- membuka console interaktif.

Poin terpenting:

> Dev Mode bukan production mode yang diberi hot reload. Dev Mode adalah runtime development yang sengaja berbeda dari production.

Quarkus sendiri menekankan bahwa dev mode sangat membantu development tetapi tidak boleh dipakai di production.

### 3.2 Dev Mode sebagai “controlled illusion”

Dev Mode membuat aplikasi terasa sangat fleksibel:

- perubahan cepat terlihat;
- config mudah diganti;
- database bisa otomatis jalan;
- endpoint bisa dilihat;
- test bisa otomatis jalan;
- extension menyediakan tool tambahan.

Tapi ini adalah ilusi yang dikontrol.

Ilusi ini berguna karena mempercepat eksplorasi. Namun kalau developer lupa bahwa production berbeda, muncul risiko:

- startup production lebih lambat/berbeda;
- dependency production tidak sama dengan Dev Services;
- secret production berbeda;
- network latency tidak sama;
- container resource limit tidak sama;
- native image behavior tidak sama;
- database production punya data volume dan index berbeda;
- broker production punya partition/consumer group/security berbeda.

Jadi prinsipnya:

```text
Dev Mode = fast learning environment
Production Mode = truth environment
CI/Test = bridge between both
```

### 3.3 Apa yang terjadi ketika kode berubah?

Secara konseptual:

```text
Developer edits source
        │
        ▼
Quarkus detects changed files
        │
        ▼
Determine whether reload/reaugmentation needed
        │
        ▼
Rebuild affected development runtime state
        │
        ▼
Application becomes available again
        │
        ▼
Continuous testing may run affected tests
```

Tidak semua perubahan sama.

| Jenis perubahan | Dampak umum |
|---|---|
| Perubahan method body | reload ringan |
| Perubahan resource class | routing/endpoint metadata bisa berubah |
| Perubahan entity | ORM metadata/schema behavior bisa berubah |
| Perubahan config runtime | bisa reload dengan efek lokal |
| Perubahan build-time config | bisa butuh restart/reaugmentation lebih besar |
| Perubahan dependency | biasanya butuh restart dev mode atau rebuild |
| Perubahan extension | bisa butuh rebuild lebih signifikan |

Hal yang perlu kamu biasakan:

> Dalam Quarkus, sebagian keputusan terjadi di build-time. Jadi tidak semua config/change bisa diperlakukan sebagai runtime dynamic change.

Ini sudah kita bahas di Part 003 tentang augmentation. Dev Mode terasa dinamis, tetapi tetap hidup dalam model build-time optimization.

---

## 4. Dev Mode Command dan Workflow Dasar

### 4.1 Maven

```bash
./mvnw quarkus:dev
```

Contoh dengan profile:

```bash
./mvnw quarkus:dev -Dquarkus.profile=local
```

Contoh skip test biasa saat start tapi tetap bisa continuous testing:

```bash
./mvnw quarkus:dev -DskipTests
```

Catatan: detail command bisa berbeda tergantung versi plugin dan project setup.

### 4.2 Gradle

```bash
./gradlew quarkusDev
```

Dengan system property:

```bash
./gradlew quarkusDev -Dquarkus.profile=local
```

### 4.3 Quarkus CLI

```bash
quarkus dev
```

CLI berguna untuk:

- membuat project;
- menambah extension;
- menjalankan dev mode;
- menjalankan build;
- melihat tooling berbasis Quarkus tanpa mengingat semua Maven/Gradle command.

Namun untuk enterprise repository, biasanya Maven/Gradle wrapper tetap menjadi sumber kebenaran agar build reproducible.

### 4.4 Recommended project scripts

Untuk project tim, jangan biarkan setiap developer mengarang command sendiri.

Buat script standar:

```bash
./scripts/dev.sh
./scripts/test.sh
./scripts/build.sh
./scripts/native-build.sh
```

Untuk Windows:

```powershell
./scripts/dev.ps1
./scripts/test.ps1
./scripts/build.ps1
./scripts/native-build.ps1
```

Contoh `dev.ps1`:

```powershell
$ErrorActionPreference = "Stop"

./mvnw quarkus:dev `
  -Dquarkus.profile=dev `
  -Ddebug=false
```

Contoh `dev.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

./mvnw quarkus:dev \
  -Dquarkus.profile=dev \
  -Ddebug=false
```

Prinsip:

> Developer experience harus distandardisasi seperti production deployment distandardisasi.

Kalau tidak, local behavior setiap orang akan berbeda.

---

## 5. Live Reload: Cepat, Tapi Jangan Disalahpahami

### 5.1 Live reload bukan hot swap penuh

Java punya beberapa konsep yang sering tercampur:

| Istilah | Maksud |
|---|---|
| JVM HotSwap | mengganti bytecode method terbatas saat debug |
| Hot reload framework | framework reload class/context sebagian |
| Live reload Quarkus | dev mode mendeteksi perubahan dan me-reload aplikasi sesuai model Quarkus |
| Production rolling restart | mengganti pod/instance production secara terkendali |

Quarkus live reload bukan berarti semua state aman dipertahankan.

Contoh yang perlu diperhatikan:

- singleton state bisa reset;
- in-memory cache bisa hilang;
- connection bisa dibuat ulang;
- Dev Service mungkin tetap reuse container;
- test state bisa berubah;
- classloader bisa berganti;
- static field tidak boleh dianggap stabil.

### 5.2 Design implication

Kalau kode kamu hanya benar ketika static variable tertentu bertahan di Dev Mode, desainnya rapuh.

Contoh buruk:

```java
@ApplicationScoped
public class TemporaryStateHolder {
    private final Map<String, Object> state = new ConcurrentHashMap<>();
}
```

Ini mungkin terlihat jalan di local, tetapi tidak aman untuk:

- reload;
- multi-pod;
- crash restart;
- Kubernetes rolling update;
- native image lifecycle;
- horizontal scaling.

Gunakan Dev Mode sebagai alat untuk menemukan state yang salah tempat.

Pertanyaan top-tier:

> Kalau aplikasi di-reload, pod di-restart, atau container dipindahkan, state mana yang boleh hilang dan state mana yang harus durable?

---

## 6. Continuous Testing: Test sebagai Feedback Otomatis

### 6.1 Apa itu continuous testing?

Continuous testing di Quarkus menjalankan test secara otomatis ketika kode berubah. Quarkus mendeteksi perubahan dan menjalankan test yang relevan, sehingga developer mendapat feedback cepat.

Ini mengubah test dari aktivitas manual menjadi bagian dari loop development.

```text
edit code
  -> save
  -> affected tests run
  -> result visible
  -> fix immediately
```

### 6.2 Kenapa continuous testing penting untuk engineer senior?

Continuous testing bukan hanya “nyaman”. Ini mengubah gaya kerja.

Tanpa continuous testing:

```text
Developer menulis banyak perubahan
  -> lupa menjalankan test
  -> push
  -> CI gagal
  -> context switching
  -> debugging lebih mahal
```

Dengan continuous testing:

```text
Developer membuat perubahan kecil
  -> test langsung memberi feedback
  -> bug dikoreksi saat context masih segar
  -> refactoring lebih aman
```

Ini mendukung engineering habit:

- small steps;
- reversible changes;
- test-first atau test-near development;
- refactoring confidence;
- fast failure;
- design feedback.

### 6.3 Command continuous testing

Continuous testing biasanya tersedia di Dev Mode. Ada juga mode test khusus:

Maven:

```bash
./mvnw quarkus:test
```

Gradle:

```bash
./gradlew quarkusTest
```

Mode ini berguna kalau kamu ingin menjalankan continuous testing tanpa menjalankan aplikasi dev mode penuh.

### 6.4 Impacted test execution

Quarkus berusaha menjalankan test yang relevan terhadap perubahan. Secara mental:

```text
Changed class/resource/config
        │
        ▼
Determine impacted test set
        │
        ▼
Run affected tests first
        │
        ▼
Show failures fast
```

Namun jangan salah paham:

> Impacted test selection adalah optimisasi feedback, bukan pengganti full test suite.

CI tetap harus menjalankan:

- unit tests;
- integration tests;
- contract tests;
- migration tests;
- security tests;
- native tests bila native image digunakan;
- performance smoke tests bila relevan.

### 6.5 Continuous testing sebagai design sensor

Kalau continuous testing sering lambat, flaky, atau terlalu sering gagal karena environment, itu bukan hanya masalah test.

Itu gejala desain:

| Gejala | Kemungkinan masalah desain |
|---|---|
| Test butuh database untuk semua kasus | business logic terlalu melekat ke persistence |
| Test sering flaky karena timing | concurrency/eventual consistency tidak terkendali |
| Test lambat karena startup mahal | terlalu banyak dependency di bootstrap |
| Test perlu shared environment | local dependency tidak isolated |
| Test sulit dimock | boundary abstraction buruk |
| Test sulit dipahami | domain behavior tidak eksplisit |

Continuous testing mempercepat feedback atas kualitas desain.

### 6.6 Test taxonomy untuk Quarkus project

Gunakan layer seperti ini:

```text
Fast unit tests
  - pure Java logic
  - no Quarkus runtime if not needed
  - milliseconds

Quarkus component tests
  - CDI/config/resource behavior
  - @QuarkusTest or related test support
  - seconds

Integration tests
  - HTTP + database/broker/cache
  - Dev Services/Testcontainers
  - slower but realistic

Native/integration artifact tests
  - run packaged app/native binary
  - validate deployable artifact
```

Top-tier rule:

> Jangan memakai `@QuarkusTest` untuk semua test hanya karena bisa. Gunakan runtime Quarkus hanya ketika behavior yang diuji memang membutuhkan Quarkus.

Contoh:

```java
class PriceCalculatorTest {
    @Test
    void shouldApplyProgressiveDiscount() {
        var calculator = new PriceCalculator();

        var result = calculator.calculate(new Money("100.00"), CustomerTier.GOLD);

        assertEquals(new Money("90.00"), result);
    }
}
```

Tidak perlu Quarkus.

Sedangkan ini mungkin perlu Quarkus:

```java
@QuarkusTest
class CaseResourceTest {
    @Test
    void shouldRejectTransitionWhenUserHasNoPermission() {
        given()
            .auth().oauth2(testTokenWithoutPermission())
            .contentType("application/json")
            .body("{\"targetState\":\"APPROVED\"}")
        .when()
            .post("/cases/CASE-001/transition")
        .then()
            .statusCode(403);
    }
}
```

Karena yang diuji adalah integration behavior: HTTP routing, security, validation, resource, exception mapping.

---

## 7. Dev UI: Introspection untuk Development Runtime

### 7.1 Apa itu Dev UI?

Dev UI adalah UI development Quarkus yang biasanya tersedia ketika aplikasi berjalan di Dev Mode. Dari sana developer bisa melihat berbagai informasi, tergantung extension yang dipakai:

- endpoint HTTP;
- routes;
- config;
- beans;
- scheduled methods;
- continuous testing;
- Dev Services;
- build metrics;
- OpenAPI/Swagger UI;
- GraphQL UI;
- cache;
- messaging;
- datasource;
- extension-specific pages.

Dev UI bukan sekadar dashboard. Ia adalah alat introspection.

### 7.2 Kenapa introspection penting?

Dalam aplikasi enterprise, banyak behavior tidak terlihat langsung dari kode tunggal:

- endpoint dibentuk oleh annotation;
- security policy berasal dari config + annotation + identity mapping;
- beans dipilih oleh qualifier;
- config berasal dari banyak source;
- route bisa berasal dari extension;
- Dev Service bisa otomatis menjalankan container;
- health check dikontribusi oleh extension;
- OpenAPI schema bisa dihasilkan otomatis.

Dev UI membantu menjawab:

```text
Apa yang sebenarnya sedang dilihat Quarkus?
Apa yang sebenarnya terdaftar?
Apa yang sebenarnya aktif?
Apa dependency yang sebenarnya jalan?
```

### 7.3 Dev UI sebagai debugging surface

Contoh pertanyaan yang bisa dibantu oleh Dev UI:

- Endpoint `/cases/{id}` benar-benar terdaftar atau tidak?
- Apakah method security aktif?
- Apakah datasource dev memakai PostgreSQL container atau H2?
- Dev Service apa yang sedang berjalan?
- Continuous testing sedang aktif atau berhenti?
- Config value mana yang dibaca?
- Extension apa saja yang aktif?
- Build/reload terakhir lambat di mana?

### 7.4 Batasan Dev UI

Dev UI sangat berguna, tapi jangan disalahgunakan.

Dev UI bukan:

- production monitoring tool;
- security console production;
- replacement untuk observability stack;
- replacement untuk runbook;
- bukti bahwa production behavior sama;
- tempat menyimpan operational decision.

Dev UI adalah alat development.

Di production, kamu butuh:

- logs;
- metrics;
- traces;
- health checks;
- dashboards;
- alerts;
- audit trail;
- runbooks;
- deployment metadata.

### 7.5 Dev UI dan security

Karena Dev UI menampilkan banyak informasi internal, prinsipnya:

> Dev UI tidak boleh terekspos ke production/public network.

Untuk enterprise environment:

- pastikan Dev Mode tidak pernah dipakai di image production;
- pastikan route Dev UI tidak tersedia di production;
- pastikan reverse proxy tidak mengekspos endpoint dev;
- pastikan build pipeline memisahkan dev artifact dan prod artifact;
- pastikan scanning/security gate mengecek profile dan config.

---

## 8. Dev Services: Provisioning Dependency Otomatis

### 8.1 Apa itu Dev Services?

Dev Services adalah kemampuan Quarkus untuk menjalankan dependency eksternal secara otomatis dalam mode development dan test ketika extension terkait ada dan belum dikonfigurasi secara eksplisit.

Contoh:

- kamu menambahkan PostgreSQL extension;
- kamu tidak mengatur JDBC URL;
- Docker tersedia;
- Quarkus dapat menjalankan PostgreSQL container otomatis;
- aplikasi otomatis dikonfigurasi untuk memakai container itu.

Konseptual:

```text
Application extension detected
        │
        ▼
No explicit external service config found
        │
        ▼
Dev Services enabled?
        │
        ▼
Start service container / in-process service
        │
        ▼
Inject connection config into app
```

### 8.2 Dev Services mengurangi setup friction

Tanpa Dev Services:

```text
Install PostgreSQL
Create database
Create user
Set port
Run migration
Install Kafka
Create topic
Install Redis
Run Keycloak
Import realm
Configure env var
Run app
```

Dengan Dev Services:

```text
Add extensions
Run quarkus dev
```

Ini luar biasa untuk:

- onboarding developer baru;
- membuat demo reproducible;
- integration test lokal;
- prototyping service;
- avoiding shared dev environment bottleneck;
- menjalankan test di CI dengan dependency ephemeral.

### 8.3 Dependency yang umum didukung

Tergantung extension dan versi Quarkus, Dev Services tersedia untuk banyak dependency, misalnya:

- database:
  - PostgreSQL;
  - MySQL/MariaDB;
  - SQL Server;
  - DB2;
  - H2;
- Kafka;
- RabbitMQ;
- AMQP;
- Redis;
- Infinispan;
- Elasticsearch/OpenSearch-related use cases tergantung extension;
- Keycloak/OIDC;
- Kubernetes-related local/dev workflows;
- Compose Dev Services untuk dependency berbasis Docker Compose.

Selalu cek dokumentasi extension yang dipakai karena detail support bisa berubah.

### 8.4 Dev Services bukan production dependency manager

Ini penting.

Dev Services bukan replacement untuk:

- Terraform;
- Helm chart;
- Kubernetes manifest;
- AWS RDS provisioning;
- MSK/Kafka cluster provisioning;
- RabbitMQ production cluster;
- Keycloak realm production management;
- secret management;
- database migration strategy;
- capacity planning.

Dev Services adalah **development/test provisioning mechanism**.

### 8.5 Shared vs isolated Dev Services

Beberapa Dev Services bisa di-share antar aplikasi development. Ini berguna untuk microservice local development.

Namun ada trade-off:

| Mode | Kelebihan | Risiko |
|---|---|---|
| Isolated per app/test | reproducible, tidak saling ganggu | lebih banyak container/resource |
| Shared service | hemat resource, cocok multi-service local | state leakage, port conflict, test interference |

Untuk test automated, default terbaik biasanya isolated.

Untuk local multi-service development, shared bisa berguna.

Prinsip:

> Test harus deterministic. Local demo boleh convenience-oriented.

### 8.6 Compose Dev Services

Compose Dev Services memungkinkan Quarkus memakai file Docker Compose untuk menjalankan supporting services dalam dev/test.

Ini berguna ketika dependency tidak cukup satu container sederhana, misalnya:

```text
app
 ├── PostgreSQL
 ├── Redis
 ├── RabbitMQ
 └── LocalStack / mock external service
```

Namun hati-hati:

- compose file bisa menjadi mini-production yang tidak dirawat;
- config bisa drift dari Kubernetes manifest;
- test bisa lambat;
- container startup order bisa menipu readiness;
- volume persistence bisa membuat test tidak bersih.

Gunakan Compose Dev Services untuk dependency topology yang memang perlu, bukan sebagai tempat menaruh semua hal.

---

## 9. Dev Services untuk Database

### 9.1 Basic flow

Misalnya aplikasi memakai PostgreSQL.

Dependency extension kira-kira:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-jdbc-postgresql</artifactId>
</dependency>
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-hibernate-orm</artifactId>
</dependency>
```

Jika `quarkus.datasource.jdbc.url` tidak dikonfigurasi di dev/test dan Dev Services aktif, Quarkus dapat menjalankan PostgreSQL container otomatis.

Contoh config eksplisit untuk menonaktifkan:

```properties
quarkus.datasource.devservices.enabled=false
```

Contoh config image:

```properties
quarkus.datasource.devservices.image-name=postgres:16
```

Nama property bisa bervariasi tergantung extension/datasource; cek dokumentasi versi yang dipakai.

### 9.2 Database schema strategy

Dengan Dev Services, database bisa otomatis tersedia. Tapi schema tetap harus dikelola.

Pilihan:

1. Hibernate schema generation.
2. Flyway migration.
3. Liquibase migration.
4. SQL import script.
5. Test fixture manual.

Untuk production-grade habit:

```properties
%dev.quarkus.hibernate-orm.database.generation=drop-and-create
%test.quarkus.hibernate-orm.database.generation=drop-and-create
%prod.quarkus.hibernate-orm.database.generation=none
```

Namun untuk aplikasi serius, lebih baik:

```properties
%dev.quarkus.flyway.migrate-at-start=true
%test.quarkus.flyway.migrate-at-start=true
%prod.quarkus.flyway.migrate-at-start=false
```

Kenapa production `migrate-at-start=false` sering lebih aman?

Karena migration production biasanya harus dikontrol pipeline:

- approval;
- backup;
- lock impact;
- rollback plan;
- release ordering;
- long-running migration risk;
- blue-green/canary compatibility.

### 9.3 Trap: H2 vs PostgreSQL mismatch

Dev Services membuat mudah memakai real database container. Ini lebih baik daripada default H2 untuk aplikasi yang production-nya PostgreSQL/Oracle/MySQL.

Kenapa?

Karena H2 sering berbeda dalam:

- SQL dialect;
- locking;
- transaction isolation;
- timestamp behavior;
- JSON column behavior;
- sequence/identity behavior;
- constraint enforcement;
- index behavior;
- pagination;
- case sensitivity;
- schema support.

Top-tier rule:

> Untuk integration test persistence, gunakan database yang sama jenisnya dengan production semampu mungkin.

Jika production Oracle tapi Dev Services tidak menyediakan Oracle karena licensing/resource constraints, minimal buat compatibility test di CI/staging dengan Oracle.

### 9.4 Database state discipline

Dev Services bisa membuat database ephemeral atau reused.

Untuk test:

- state harus bersih;
- migration harus deterministic;
- fixture harus eksplisit;
- test tidak boleh bergantung urutan;
- test tidak boleh bergantung data sisa.

Contoh anti-pattern:

```java
@Test
void shouldFindCreatedCase() {
    // assumes CASE-001 already exists from another test
    given()
        .get("/cases/CASE-001")
    .then()
        .statusCode(200);
}
```

Lebih baik:

```java
@Test
void shouldFindCreatedCase() {
    createCase("CASE-001");

    given()
        .get("/cases/CASE-001")
    .then()
        .statusCode(200);
}
```

Atau gunakan transaction rollback/test resource setup sesuai kebutuhan.

---

## 10. Dev Services untuk Kafka/RabbitMQ/Messaging

### 10.1 Messaging dependency sulit jika manual

Messaging system sulit karena butuh:

- broker running;
- topic/queue/exchange;
- consumer group;
- offset management;
- serialization;
- retry/DLQ;
- ordering;
- concurrency;
- ack/nack;
- poison message behavior.

Dev Services bisa membantu menjalankan broker lokal otomatis.

Namun messaging test tetap harus didesain hati-hati.

### 10.2 Local broker tidak sama dengan production broker

Misalnya Kafka local satu broker tidak mewakili:

- multi-broker cluster;
- replication factor;
- partition count production;
- ACL/security;
- TLS/SASL;
- network latency;
- broker restart;
- retention policy;
- compaction;
- consumer rebalance;
- high throughput.

RabbitMQ local satu container tidak mewakili:

- clustered queue behavior;
- quorum queue;
- mirrored queue legacy;
- exchange topology production;
- connection limit;
- flow control;
- disk alarm;
- network partition.

Jadi Dev Services bagus untuk functional integration, bukan capacity validation.

### 10.3 Messaging test design

Good messaging test harus menjawab:

- pesan apa dikirim?
- channel mana?
- serialization format apa?
- consumer mana yang memproses?
- ack terjadi kapan?
- duplicate message aman atau tidak?
- error masuk DLQ atau retry?
- ordering penting atau tidak?
- idempotency key apa?

Contoh mental model:

```text
HTTP command
   -> DB transaction
   -> outbox row
   -> publisher emits event
   -> broker receives message
   -> consumer processes
   -> state changes / side effect occurs
```

Jangan hanya mengetes “message terkirim”. Test semantic effect.

---

## 11. Dev Services untuk Keycloak/OIDC

### 11.1 Kenapa OIDC local sering menyakitkan

OIDC/Keycloak local setup biasanya butuh:

- menjalankan Keycloak;
- membuat realm;
- membuat client;
- membuat user;
- mengatur redirect URI;
- mengatur roles;
- mengatur issuer URL;
- mengambil token;
- memastikan JWKS valid;
- sinkronisasi config aplikasi.

Dev Services untuk OIDC/Keycloak membantu mengurangi beban ini.

### 11.2 Namun security tidak boleh jadi main-main

Dev OIDC setup sering dibuat terlalu permisif:

- token fake tanpa expiry;
- role hardcoded;
- issuer tidak divalidasi;
- audience tidak dicek;
- test hanya happy path;
- authorization tidak dites per resource.

Top-tier approach:

Buat minimal matrix:

| Scenario | Expected |
|---|---|
| no token | 401 |
| invalid token | 401 |
| expired token | 401 |
| valid token no role | 403 |
| valid token wrong audience | 401/403 sesuai policy |
| valid token correct role but wrong ownership | 403 |
| valid token correct permission | 200/201 |

Dev Services membantu menjalankan IdP, tapi authorization correctness tetap harus didesain.

---

## 12. Profile Engineering: `%dev`, `%test`, `%prod`, dan Custom Profile

### 12.1 Profile dasar

Quarkus mendukung profile configuration. Umumnya:

```properties
%dev.some.property=value-for-dev
%test.some.property=value-for-test
%prod.some.property=value-for-prod
```

Gunakan profile untuk membedakan environment behavior.

Namun jangan terlalu banyak profile.

Anti-pattern:

```properties
%dev-a.quarkus.datasource.jdbc.url=...
%dev-b.quarkus.datasource.jdbc.url=...
%local-fajar.quarkus.datasource.jdbc.url=...
%local-iwan.quarkus.datasource.jdbc.url=...
%uat-1.quarkus.datasource.jdbc.url=...
%uat-2.quarkus.datasource.jdbc.url=...
```

Ini membuat config sulit dipahami.

Lebih baik:

```properties
%dev.quarkus.datasource.devservices.enabled=true
%test.quarkus.datasource.devservices.enabled=true
%prod.quarkus.datasource.devservices.enabled=false
```

Dan environment-specific value diberikan dari deployment platform:

- env var;
- Kubernetes Secret;
- ConfigMap;
- AWS SSM;
- Vault;
- CI/CD variables.

### 12.2 Dev profile harus convenience-oriented tapi aman

Contoh dev config:

```properties
%dev.quarkus.log.level=INFO
%dev.quarkus.log.category."com.example".level=DEBUG
%dev.quarkus.hibernate-orm.log.sql=true
%dev.quarkus.datasource.devservices.enabled=true
```

Test config:

```properties
%test.quarkus.log.level=WARN
%test.quarkus.datasource.devservices.enabled=true
%test.quarkus.hibernate-orm.log.sql=false
```

Prod config:

```properties
%prod.quarkus.datasource.devservices.enabled=false
%prod.quarkus.hibernate-orm.database.generation=none
%prod.quarkus.log.console.json=true
```

### 12.3 Explicit production guard

Tambahkan guard di startup untuk mencegah config dev masuk production.

Contoh:

```java
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class ProductionSafetyGuard {

    @ConfigProperty(name = "app.environment")
    String environment;

    @ConfigProperty(name = "quarkus.datasource.devservices.enabled", defaultValue = "false")
    boolean datasourceDevServicesEnabled;

    void onStart(@Observes StartupEvent event) {
        if ("prod".equalsIgnoreCase(environment) && datasourceDevServicesEnabled) {
            throw new IllegalStateException("Dev Services must not be enabled in production");
        }
    }
}
```

Ini contoh sederhana. Di production nyata, guard bisa lebih komprehensif:

- secret default tidak boleh dipakai;
- debug endpoint tidak boleh aktif;
- mock external service tidak boleh aktif;
- schema generation tidak boleh drop-and-create;
- insecure TLS tidak boleh aktif;
- test users tidak boleh ada;
- log sensitive tidak boleh aktif.

---

## 13. Local Productivity vs Production Parity

### 13.1 Dilema utama

Ada dua ekstrem buruk.

Ekstrem pertama:

```text
Local harus 100% sama dengan production.
```

Ini sering tidak realistis. Laptop developer tidak bisa selalu menjalankan seluruh topology production.

Ekstrem kedua:

```text
Local yang penting jalan cepat, production nanti urusan lain.
```

Ini menghasilkan bug environment dan integrasi.

Yang benar:

> Local environment harus cukup cepat untuk daily development dan cukup representatif untuk menangkap failure penting sedini mungkin.

### 13.2 Layer environment yang sehat

```text
Local Dev
  - fastest loop
  - Dev Mode
  - Dev Services
  - fake/sandbox external services

Local Integration
  - Docker Compose / Dev Services
  - real database/broker type
  - API-level tests

CI Integration
  - clean ephemeral dependencies
  - full test suite
  - migration validation
  - contract validation

Staging/UAT
  - production-like topology
  - real managed services
  - realistic IAM/network/security

Production
  - actual scale, data, latency, governance
```

Setiap layer punya tujuan berbeda.

Jangan menuntut local menjadi production penuh. Tapi jangan juga membiarkan local terlalu palsu.

### 13.3 Representative dimensions

Saat menilai local/dev setup, cek dimensi berikut:

| Dimensi | Pertanyaan |
|---|---|
| Database | Apakah dialect sama dengan production? |
| Migration | Apakah migration dijalankan seperti production? |
| Security | Apakah token/roles cukup realistis? |
| Messaging | Apakah serialization dan topic/queue sama? |
| Config | Apakah property critical sama namanya? |
| Network | Apakah timeout/retry diuji? |
| Data | Apakah ada fixture untuk edge case? |
| Observability | Apakah log/trace/metrics behavior terlihat? |
| Resource | Apakah ada test untuk memory/startup minimal? |
| Native | Apakah native compatibility diuji jika target native? |

---

## 14. Onboarding Workflow dengan Quarkus Dev Features

### 14.1 Target onboarding ideal

Developer baru harus bisa menjalankan aplikasi dengan langkah minimal:

```bash
git clone <repo>
cd <repo>
./scripts/dev.sh
```

Atau Windows:

```powershell
git clone <repo>
cd <repo>
./scripts/dev.ps1
```

Lalu aplikasi:

- compile;
- Dev Services start;
- migration run;
- sample data loaded;
- Dev UI accessible;
- test bisa jalan;
- endpoint bisa dicoba;
- dokumentasi local jelas.

### 14.2 README local dev checklist

README harus menjawab:

```markdown
## Local Development

### Prerequisites
- JDK 21
- Docker Desktop / compatible container runtime
- Maven Wrapper included

### Run
./scripts/dev.sh

### Dev UI
http://localhost:8080/q/dev-ui

### Continuous Testing
In dev console press `r` to resume/rerun tests, depending on Quarkus version/console command.

### Database
Dev Services starts PostgreSQL automatically in dev/test when no JDBC URL is configured.

### Profiles
- dev: local development
- test: automated test
- prod: production artifact/runtime

### Common Issues
- Docker not running
- port already used
- stale container volume
- wrong JDK version
- proxy issue downloading dependencies
```

### 14.3 Make onboarding deterministic

Jangan hanya mengandalkan “di laptop saya jalan”.

Pastikan:

- wrapper digunakan (`mvnw`/`gradlew`);
- JDK version jelas;
- Docker requirement jelas;
- port bisa dikonfigurasi;
- Dev Services bisa dimatikan bila perlu;
- seed data jelas;
- test command jelas;
- cleanup command jelas.

Contoh cleanup:

```bash
docker ps --filter "label=quarkus-dev-service" 
```

Atau dokumentasikan cara membersihkan container/volume terkait project.

---

## 15. Dev Mode untuk Multi-Service System

### 15.1 Masalah microservice local development

Dalam sistem microservice, local development sulit karena satu service tergantung pada banyak service lain.

Contoh:

```text
case-service
  -> identity-service / Keycloak
  -> profile-service
  -> document-service
  -> notification-service
  -> PostgreSQL
  -> Redis
  -> RabbitMQ
  -> object storage
```

Kalau semua harus jalan lokal, berat.

### 15.2 Strategi dependency local

Ada beberapa pilihan:

| Strategi | Cocok untuk | Risiko |
|---|---|---|
| Run all services locally | integration-heavy debugging | berat, lambat, port conflict |
| Run only service under development + Dev Services | feature development | external service behavior perlu mock/stub |
| Use sandbox shared env for dependencies | realistic integration | network dependency, shared state |
| Use contract stubs | API contract validation | stub drift dari provider |
| Use Compose Dev Services | small topology | bisa menjadi mini-production kompleks |

Top-tier approach biasanya hybrid.

Untuk daily coding:

```text
service under development + real DB/broker/cache + stub external HTTP services
```

Untuk integration validation:

```text
selected service group + real broker + real DB + contract tests
```

Untuk release:

```text
CI/staging with production-like managed services
```

### 15.3 Stub boundary harus eksplisit

Jangan membuat stub yang terlalu pintar tanpa dokumentasi.

Contoh buruk:

```text
profile-service-stub always returns valid user with all permissions
```

Ini membuat authorization bug tidak terlihat.

Lebih baik stub punya scenario:

```text
/users/active-admin
/users/active-normal
/users/suspended
/users/not-found
/users/missing-attributes
/users/slow-response
/users/error-500
```

Kemudian test outbound client terhadap scenario tersebut.

---

## 16. Debugging di Dev Mode

### 16.1 Remote debug

Quarkus dev mode bisa dijalankan dengan debug. Biasanya port debug default tersedia tergantung command/config.

Contoh umum Maven:

```bash
./mvnw quarkus:dev -Ddebug=5005
```

Atau disable debug:

```bash
./mvnw quarkus:dev -Ddebug=false
```

Pastikan dokumentasi project menyebutkan:

- debug port;
- cara attach IDE;
- apakah suspend saat startup;
- bagaimana debug test;
- bagaimana debug native image bila diperlukan.

### 16.2 Debugging reactive code

Reactive code lebih sulit didebug karena call stack tidak linear.

Contoh pipeline:

```java
return userClient.findUser(userId)
    .onItem().ifNull().failWith(() -> new NotFoundException("User not found"))
    .onItem().transformToUni(user -> permissionService.check(user, action))
    .onItem().transform(allowed -> Response.ok(allowed).build())
    .onFailure().recoverWithItem(this::toErrorResponse);
```

Bug bisa terjadi di:

- upstream client;
- null item;
- transform chain;
- async boundary;
- timeout;
- context propagation;
- failure recovery.

Gunakan:

- logs dengan correlation ID;
- explicit stage naming melalui method kecil;
- test per stage;
- avoid giant reactive chains;
- timeouts yang terlihat;
- failure mapping yang jelas.

### 16.3 Debugging config

Config bug umum:

- property salah nama;
- env var tidak sesuai mapping;
- profile salah;
- default value tidak sengaja aktif;
- build-time config diubah saat runtime;
- secret tidak tersedia;
- config dev terbawa ke prod.

Gunakan Dev UI/config introspection dan startup guard.

Tambahkan structured startup log untuk config non-sensitive:

```java
@ApplicationScoped
public class StartupConfigLogger {

    void onStart(@Observes StartupEvent event) {
        // log only non-sensitive operational config
    }
}
```

Jangan log secret.

---

## 17. Build Metrics dan Reload Performance

### 17.1 Reload time sebagai signal

Kalau reload dev mode lambat, jangan hanya menyalahkan laptop.

Reload lambat bisa menandakan:

- terlalu banyak extension;
- dependency berat;
- startup logic melakukan IO;
- `@PostConstruct` berat;
- migration berjalan setiap reload;
- seed data terlalu besar;
- test terlalu banyak runtime dependency;
- build-time augmentation mahal;
- annotation scanning/indexing besar;
- generated code terlalu banyak.

### 17.2 Startup logic anti-pattern

Contoh buruk:

```java
@ApplicationScoped
public class StartupLoader {

    void onStart(@Observes StartupEvent event) {
        loadLargeReferenceDataFromRemoteService();
        warmUpAllCaches();
        validateEveryCustomerRecord();
    }
}
```

Ini membuat dev mode, test, dan production startup berat.

Lebih baik:

- lazy load;
- async warmup dengan readiness awareness;
- job terpisah;
- cache warmup terbatas;
- startup health state eksplisit;
- fail-fast hanya untuk dependency critical.

### 17.3 Reload budget

Buat target internal:

| Loop | Target kasar |
|---|---|
| Pure unit test | < 1 detik per small set |
| Quarkus reload small change | beberapa detik |
| Component test small set | beberapa detik |
| Full integration local | puluhan detik sampai beberapa menit |
| Native build | menit, bukan loop harian utama |

Angka pasti tergantung project. Yang penting: punya budget.

Top-tier engineer tidak hanya bertanya “bisa jalan?” tetapi:

> berapa biaya feedback loop ini, dan apakah biaya itu membuat tim menghindari validasi?

---

## 18. Common Failure Modes

### 18.1 Docker tidak berjalan

Gejala:

- Dev Services gagal start;
- database tidak tersedia;
- Kafka/RabbitMQ gagal;
- test integration gagal.

Mitigasi:

- README prerequisite jelas;
- error message documented;
- fallback config manual;
- CI menggunakan container runtime yang stabil.

### 18.2 Port conflict

Gejala:

- app gagal bind `8080`;
- PostgreSQL/Kafka/Redis container gagal;
- shared Dev Service bentrok.

Mitigasi:

```properties
%dev.quarkus.http.port=8081
```

Atau dokumentasikan dynamic port / service labels.

### 18.3 Stale container state

Gejala:

- test gagal karena data lama;
- migration already applied;
- schema mismatch;
- credentials lama;
- topic/queue lama.

Mitigasi:

- gunakan isolated test services;
- cleanup container/volume;
- explicit migration reset;
- jangan bergantung state manual.

### 18.4 Config dev/test/prod bocor

Gejala:

- production memakai mock service;
- schema drop-and-create aktif;
- debug log aktif;
- Dev Services enabled;
- insecure TLS aktif.

Mitigasi:

- production guard;
- config review;
- CI config scan;
- environment-specific deployment validation.

### 18.5 Continuous tests flaky

Gejala:

- test kadang merah kadang hijau;
- developer ignore result;
- CI tidak dipercaya.

Mitigasi:

- eliminate timing assumptions;
- deterministic fixture;
- await with bounded timeout;
- isolate external state;
- avoid shared mutable static;
- mark slow tests separately;
- do not normalize flaky tests.

### 18.6 Dev Mode behavior berbeda dari packaged jar/native

Gejala:

- jalan di dev mode tapi gagal setelah build;
- native image gagal karena reflection/resource;
- packaged jar config berbeda.

Mitigasi:

- jalankan packaged integration test;
- gunakan `@QuarkusIntegrationTest`;
- native test untuk native target;
- jangan hanya percaya dev mode.

---

## 19. Development Workflow yang Disarankan

### 19.1 Daily feature workflow

```text
1. Pull latest main
2. Run ./scripts/dev.sh
3. Confirm Dev Services started
4. Write/adjust focused test
5. Change code in small steps
6. Let continuous testing provide feedback
7. Check Dev UI for endpoint/config/dev service state
8. Run local integration test subset
9. Run full test before push
10. Push and let CI validate packaged artifact
```

### 19.2 Bugfix workflow

```text
1. Reproduce bug as test first
2. Run continuous testing until failing test is stable
3. Fix smallest code path
4. Add regression case for edge condition
5. Check logs/error contract
6. Run affected integration tests
7. Update documentation/runbook if operational behavior changed
```

### 19.3 Refactoring workflow

```text
1. Ensure relevant tests exist
2. Start continuous testing
3. Refactor one boundary at a time
4. Watch impacted tests
5. Avoid mixing behavior change and structural change
6. Run full suite after completion
7. Check startup/reload time did not regress badly
```

---

## 20. Case Study: Case Management Service dengan Quarkus Dev Loop

Bayangkan service:

```text
case-service
  - REST API untuk lifecycle case
  - PostgreSQL untuk state
  - RabbitMQ untuk event
  - Redis untuk cache permission/reference data
  - Keycloak untuk auth
  - external document service
```

### 20.1 Local dev target

Kita ingin developer bisa menjalankan:

```bash
./scripts/dev.sh
```

Dan otomatis tersedia:

- PostgreSQL via Dev Services;
- RabbitMQ via Dev Services;
- Redis via Dev Services;
- Keycloak/OIDC dev setup;
- document-service stub;
- migration at start;
- seed users/cases;
- Dev UI;
- continuous testing.

### 20.2 Test focus

Test yang harus cepat:

```text
CaseStateMachineTest
  - transition invariants
  - invalid transition
  - role-independent domain rules
```

Tidak perlu Quarkus.

Test dengan Quarkus:

```text
CaseResourceSecurityTest
  - no token -> 401
  - wrong role -> 403
  - valid permission -> 200
```

Integration messaging:

```text
CaseApprovedEventTest
  - approve case
  - verify outbox row
  - publisher emits event
  - event has stable schema/version
```

### 20.3 Config design

```properties
# common
app.name=case-service

# dev
%dev.quarkus.datasource.devservices.enabled=true
%dev.quarkus.rabbitmq.devservices.enabled=true
%dev.quarkus.redis.devservices.enabled=true
%dev.app.document-service.mode=stub

# test
%test.quarkus.datasource.devservices.enabled=true
%test.quarkus.rabbitmq.devservices.enabled=true
%test.app.document-service.mode=stub

# prod
%prod.quarkus.datasource.devservices.enabled=false
%prod.quarkus.rabbitmq.devservices.enabled=false
%prod.quarkus.redis.devservices.enabled=false
%prod.app.document-service.mode=real
```

Startup guard:

```java
if (isProd() && "stub".equals(documentServiceMode)) {
    throw new IllegalStateException("Document service stub must not be used in production");
}
```

### 20.4 Failure scenario test

Jangan hanya happy path.

Tambahkan scenario:

- document service timeout;
- Redis unavailable;
- RabbitMQ unavailable;
- DB constraint violation;
- duplicate approve command;
- invalid state transition;
- stale user role;
- event publish failure;
- idempotent retry.

Dev Services membantu menjalankan dependency. Tapi failure behavior tetap harus kamu bentuk.

---

## 21. Anti-Pattern dalam Quarkus Dev Experience

### Anti-pattern 1 — Semua test memakai `@QuarkusTest`

Masalah:

- test lambat;
- logic murni terikat runtime;
- feedback loop mahal;
- refactoring domain lambat.

Solusi:

- pure unit test untuk logic murni;
- Quarkus test untuk integration with Quarkus runtime.

### Anti-pattern 2 — Dev Services dianggap production parity

Masalah:

- developer percaya local broker/database sama dengan production;
- scaling/security/failure tidak tervalidasi.

Solusi:

- definisikan tujuan Dev Services;
- staging tetap production-like;
- CI punya layer integration yang jelas.

### Anti-pattern 3 — Profile terlalu banyak

Masalah:

- config tidak bisa dipahami;
- behavior environment sulit diprediksi;
- bug karena profile salah.

Solusi:

- gunakan `%dev`, `%test`, `%prod` sebagai default;
- environment value dari deployment system;
- custom profile hanya jika punya alasan kuat.

### Anti-pattern 4 — Mock terlalu baik hati

Masalah:

- failure eksternal tidak pernah terlihat;
- authorization selalu lolos;
- API contract drift.

Solusi:

- scenario-based stub;
- contract test;
- negative path test.

### Anti-pattern 5 — Dev UI menjadi pengganti observability

Masalah:

- production tidak punya visibility;
- incident sulit ditangani;
- dashboard local dianggap cukup.

Solusi:

- observability production tetap wajib;
- Dev UI hanya development introspection.

### Anti-pattern 6 — Continuous testing diabaikan karena flaky

Masalah:

- developer kehilangan trust pada test;
- CI failure dinormalisasi;
- bug masuk release.

Solusi:

- treat flaky test as production defect;
- fix determinism;
- isolate state;
- remove timing assumption.

### Anti-pattern 7 — Startup logic berat

Masalah:

- dev reload lambat;
- test lambat;
- autoscaling lambat;
- readiness tidak akurat.

Solusi:

- fail-fast hanya untuk dependency critical;
- lazy/warmup terkontrol;
- startup budget;
- readiness semantics jelas.

---

## 22. Production Discipline Checklist

Sebelum tim memakai Quarkus Dev Mode/Dev Services secara luas, pastikan ini jelas:

### Dev Mode

- [ ] Dev Mode hanya untuk local development.
- [ ] Tidak ada image production yang menjalankan `quarkus:dev`.
- [ ] Dev UI tidak terekspos production.
- [ ] Debug port tidak aktif production.
- [ ] Startup guard mencegah config dev di prod.

### Continuous Testing

- [ ] Test taxonomy jelas.
- [ ] Tidak semua test memakai runtime Quarkus.
- [ ] Flaky test tidak dinormalisasi.
- [ ] Full suite tetap berjalan di CI.
- [ ] Native/package tests ada bila relevant.

### Dev Services

- [ ] Dev Services aktif hanya dev/test.
- [ ] Production dependency dikelola infra/deployment system.
- [ ] Database dev/test sedekat mungkin dengan production dialect.
- [ ] Test state deterministic.
- [ ] Container reuse/shared mode dipahami.

### Dev UI

- [ ] Dipakai untuk introspection development.
- [ ] Tidak dipakai sebagai production observability.
- [ ] Informasi internal tidak bocor ke public network.

### Config

- [ ] `%dev`, `%test`, `%prod` jelas.
- [ ] Secret tidak ada di repo.
- [ ] Build-time vs runtime config dipahami.
- [ ] Prod unsafe config punya guard.

---

## 23. Latihan Top 1% Engineer

### Latihan 1 — Design local dev workflow

Ambil satu service nyata atau hipotetis:

```text
order-service / case-service / payment-service / document-service
```

Buat rancangan:

- dependency apa yang dijalankan Dev Services;
- dependency apa yang distub;
- dependency apa yang harus real;
- test mana yang pure unit;
- test mana yang Quarkus integration;
- test mana yang hanya CI/staging;
- production guard apa yang diperlukan.

Output:

```markdown
# Local Development Design

## Service under development

## Dependencies

## Dev Services

## Stubs

## Profiles

## Test layers

## Production guards

## Known non-parity with production
```

### Latihan 2 — Analyze feedback loop cost

Ukur:

- waktu start Dev Mode;
- waktu reload setelah perubahan kecil;
- waktu impacted test;
- waktu full unit test;
- waktu full integration test;
- waktu packaged build;
- waktu native build jika ada.

Lalu jawab:

- mana loop yang terlalu mahal?
- apa penyebabnya?
- apakah startup logic terlalu berat?
- apakah test terlalu integration-heavy?
- apakah Dev Services startup bisa dioptimalkan?

### Latihan 3 — Build failure matrix

Untuk service dengan DB + broker + OIDC, buat matrix:

| Failure | Local Dev | Test | CI | Staging | Production |
|---|---|---|---|---|---|
| DB unavailable | ? | ? | ? | ? | ? |
| Broker unavailable | ? | ? | ? | ? | ? |
| OIDC invalid token | ? | ? | ? | ? | ? |
| External API timeout | ? | ? | ? | ? | ? |
| Duplicate message | ? | ? | ? | ? | ? |
| Migration failure | ? | ? | ? | ? | ? |

Tujuannya bukan semua failure diuji di local, tetapi tahu di layer mana failure divalidasi.

---

## 24. Ringkasan Invariants

Pegang invariants berikut:

1. **Dev Mode adalah learning runtime, bukan production runtime.**
2. **Live reload mempercepat eksperimen, bukan membuktikan packaged artifact benar.**
3. **Continuous testing adalah design sensor, bukan sekadar test runner otomatis.**
4. **Dev UI adalah introspection surface, bukan production observability.**
5. **Dev Services mengurangi setup friction, bukan menggantikan infrastructure management.**
6. **Local development harus cepat dan cukup representatif, bukan harus identik dengan production.**
7. **Test harus deterministic; shared state dalam test adalah sumber kebohongan.**
8. **Profile harus sedikit, jelas, dan punya guard untuk production.**
9. **Mock/stub harus punya failure scenarios, bukan hanya happy path.**
10. **Feedback loop cost adalah arsitektur signal. Kalau terlalu mahal, desain atau tooling perlu diperbaiki.**

---

## 25. Referensi Resmi dan Bacaan Lanjutan

Gunakan dokumentasi resmi sesuai versi Quarkus yang dipakai project:

- Quarkus Dev Mode differences: `https://quarkus.io/guides/dev-mode-differences`
- Quarkus Continuous Testing: `https://quarkus.io/guides/continuous-testing`
- Quarkus Dev UI: `https://quarkus.io/guides/dev-ui`
- Quarkus Dev Services Overview: `https://quarkus.io/guides/dev-services`
- Quarkus Dev Services for Databases: `https://quarkus.io/guides/databases-dev-services`
- Quarkus Dev Services for RabbitMQ: `https://quarkus.io/guides/rabbitmq-dev-services`
- Quarkus Compose Dev Services: `https://quarkus.io/guides/compose-dev-services`
- Quarkus Testing Guide: `https://quarkus.io/guides/getting-started-testing`
- Quarkus CLI Tooling: `https://quarkus.io/guides/cli-tooling`

---

# Penutup Part 004

Di part ini kita membahas Quarkus dari sisi feedback loop engineering:

- Dev Mode;
- live reload;
- Continuous Testing;
- Dev UI;
- Dev Services;
- profile discipline;
- local vs production parity;
- onboarding workflow;
- multi-service development;
- common failure modes;
- production checklist.

Inti part ini:

> Quarkus memberi developer loop yang sangat cepat, tetapi engineer senior harus menjaga agar kecepatan itu tidak berubah menjadi ilusi production-readiness.

Part berikutnya akan masuk ke:

# Part 005 — Project Structure, Maven/Gradle, Platform BOM, Extension Governance

Kita akan membahas bagaimana menjaga project Quarkus tetap sehat di level dependency, build, multi-module, platform BOM, extension governance, upgrade strategy, dan enterprise repository structure.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-003.md">⬅️ Part 003 — Quarkus Internal Architecture: Build Steps, Augmentation, Jandex, Arc, dan Extension Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-005.md">Part 005 — Project Structure, Maven/Gradle, Platform BOM, Extension Governance ➡️</a>
</div>
