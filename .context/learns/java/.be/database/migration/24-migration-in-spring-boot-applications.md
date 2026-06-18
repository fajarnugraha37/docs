# Part 24 — Migration in Spring Boot Applications

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `24-migration-in-spring-boot-applications.md`  
**Scope:** Java 8–25, Spring Boot applications, Flyway, Liquibase, production database migration lifecycle  
**Prerequisite:** Part 0–23, especially Flyway/Liquibase fundamentals, seeding, backfill, locking, vendor-specific behaviour, and migration testing

---

## 1. Tujuan Part Ini

Di bagian sebelumnya kita sudah membahas migration sebagai disiplin engineering, Flyway, Liquibase, seeding, backfill, zero-downtime, locking, vendor-specific behaviour, dan testing. Sekarang kita masuk ke konteks yang sangat umum di ekosistem Java modern: **Spring Boot application**.

Pertanyaan inti bagian ini:

> Bagaimana menjalankan database migration di aplikasi Spring Boot secara aman, deterministik, production-grade, dan tidak bentrok dengan lifecycle application startup, JPA/Hibernate, multi-datasource, profile configuration, pipeline, dan Kubernetes deployment?

Bagian ini bukan tutorial “tambahkan dependency Flyway lalu selesai”. Itu level dasar. Yang ingin kita bangun adalah mental model:

```text
Spring Boot app startup
    -> load configuration
    -> create DataSource
    -> run database migration tool, if enabled
    -> initialize JPA/Hibernate, if present
    -> create repositories/services/controllers
    -> expose traffic
```

Jika urutan ini salah, aplikasi bisa:

- start dengan schema lama,
- Hibernate validate gagal,
- migration berjalan paralel dari banyak pod,
- schema berubah tetapi app rollback tidak kompatibel,
- seed data tertimpa,
- local dev terlihat aman tetapi UAT/production gagal,
- database terkunci saat deployment,
- startup time terlalu lama karena backfill besar,
- atau deployment Kubernetes restart-loop karena migration gagal.

Target setelah bagian ini:

- Memahami posisi Flyway/Liquibase dalam lifecycle Spring Boot.
- Tahu kapan migration boleh dijalankan saat application startup.
- Tahu kapan migration harus dipisah menjadi external job/pipeline step.
- Bisa menghindari konflik dengan Hibernate `ddl-auto`, `schema.sql`, dan `data.sql`.
- Bisa mendesain konfigurasi multi-environment dan multi-datasource.
- Bisa membuat deployment model yang aman untuk Docker/Kubernetes.
- Bisa melakukan observability dan troubleshooting migration di Spring Boot.

---

## 2. Mental Model: Spring Boot Bukan Migration Tool, Tetapi Orchestrator

Spring Boot menyediakan auto-configuration untuk Flyway dan Liquibase. Namun penting untuk tidak salah memahami:

> Spring Boot bukan pengganti Flyway/Liquibase. Spring Boot hanya mengorkestrasi kapan tool itu dijalankan dalam lifecycle aplikasi.

Artinya:

- Flyway tetap menyimpan state di `flyway_schema_history`.
- Liquibase tetap menyimpan state di `DATABASECHANGELOG` dan lock di `DATABASECHANGELOGLOCK`.
- Spring Boot hanya mendeteksi dependency, membaca property, membuat bean, dan menjalankan migration pada fase startup.

Secara konseptual:

```text
Spring Boot
  |
  |-- DataSource auto-configuration
  |
  |-- FlywayAutoConfiguration / LiquibaseAutoConfiguration
  |       |
  |       |-- connect to DB
  |       |-- check migration metadata table
  |       |-- validate pending/applied changes
  |       |-- execute pending migrations
  |
  |-- Hibernate/JPA initialization
  |
  |-- Application beans
  |
  |-- Embedded server starts accepting requests
```

Ini membuat migration mudah digunakan, tetapi juga berbahaya jika dipakai tanpa desain. Kenapa?

Karena application startup sekarang punya side effect permanen ke database.

Sebelum Flyway/Liquibase aktif:

```text
Starting app = starting process only
```

Setelah migration aktif saat startup:

```text
Starting app = maybe changing production database
```

Itu perubahan mental model besar.

---

## 3. Spring Boot Startup Lifecycle dan Migration Ordering

Spring Boot perlu membuat `DataSource` lebih dulu sebelum migration bisa berjalan. Setelah itu migration dijalankan sebelum JPA/Hibernate menggunakan schema tersebut.

Urutan ideal:

```text
1. Read configuration
2. Create DataSource
3. Run Flyway/Liquibase
4. Initialize EntityManagerFactory / Hibernate
5. Validate JPA mappings against migrated schema
6. Start web server / message listener / scheduler
```

Mengapa migration harus sebelum JPA?

Karena JPA/Hibernate memiliki schema expectation berdasarkan entity mapping. Misalnya entity baru:

```java
@Entity
@Table(name = "customer")
public class Customer {
    @Id
    private Long id;

    @Column(name = "risk_score")
    private Integer riskScore;
}
```

Jika kolom `risk_score` belum ada, Hibernate validate akan gagal.

Migration yang benar:

```sql
ALTER TABLE customer ADD risk_score INTEGER;
```

Urutan benar:

```text
Flyway adds column risk_score
Hibernate validates entity Customer.riskScore
App starts
```

Urutan salah:

```text
Hibernate validates before migration
Column not found
App fails
```

Spring Boot secara default mencoba mengatur ordering ini. Tetapi masalah muncul jika:

- custom `DataSource` dibuat manual,
- ada multiple datasource,
- Flyway/Liquibase bean dikustomisasi,
- JPA disabled/enabled berdasarkan profile,
- migration dijalankan external tapi Spring Boot migration masih aktif,
- atau Hibernate `ddl-auto` masih mengubah schema.

---

## 4. Dependency Setup: Flyway di Spring Boot

### 4.1 Maven Basic Setup

Untuk Spring Boot modern:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>

<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>

<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
```

Untuk beberapa database tertentu pada Flyway versi baru, Flyway memecah dukungan database ke module tambahan. Contoh konseptual:

```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-database-postgresql</artifactId>
</dependency>
```

Atau untuk MySQL:

```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-mysql</artifactId>
</dependency>
```

Prinsipnya:

> Jangan hanya copy dependency lama. Cek module support Flyway sesuai versi dan database engine.

### 4.2 Gradle Basic Setup

```gradle
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.4.1'
    id 'io.spring.dependency-management' version '1.1.7'
}

repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-jdbc'
    implementation 'org.flywaydb:flyway-core'
    runtimeOnly 'org.postgresql:postgresql'
}
```

### 4.3 Default Migration Location

Spring Boot + Flyway default location:

```text
classpath:db/migration
```

Typical structure:

```text
src/main/resources/
  db/
    migration/
      V1__create_customer_table.sql
      V2__add_customer_risk_score.sql
      V3__create_case_table.sql
```

---

## 5. Dependency Setup: Liquibase di Spring Boot

### 5.1 Maven Basic Setup

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>

<dependency>
    <groupId>org.liquibase</groupId>
    <artifactId>liquibase-core</artifactId>
</dependency>

<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
```

### 5.2 Gradle Basic Setup

```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-jdbc'
    implementation 'org.liquibase:liquibase-core'
    runtimeOnly 'org.postgresql:postgresql'
}
```

### 5.3 Default Changelog Location

Spring Boot Liquibase default commonly points to:

```text
classpath:/db/changelog/db.changelog-master.yaml
```

Example structure:

```text
src/main/resources/
  db/
    changelog/
      db.changelog-master.yaml
      releases/
        2026-06-01.yaml
        2026-06-15.yaml
```

Example master changelog:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-06-01.yaml
  - include:
      file: db/changelog/releases/2026-06-15.yaml
```

---

## 6. Basic Configuration: Flyway Properties

Minimal `application.yml`:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/appdb
    username: app_migration
    password: local_password

  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: false
    validate-on-migrate: true
```

Important properties:

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    table: flyway_schema_history
    schemas: app
    default-schema: app
    baseline-on-migrate: false
    validate-on-migrate: true
    out-of-order: false
    clean-disabled: true
```

Production-grade baseline:

```yaml
spring:
  flyway:
    clean-disabled: true
    validate-on-migrate: true
    out-of-order: false
    baseline-on-migrate: false
```

Penjelasan:

| Property | Rekomendasi | Alasan |
|---|---:|---|
| `enabled` | profile-dependent | Kadang migration dijalankan external job |
| `locations` | explicit | Hindari surprise dari default |
| `table` | explicit untuk enterprise | Metadata table jelas dan konsisten |
| `schemas` | explicit jika multi-schema | Hindari migrate schema salah |
| `baseline-on-migrate` | `false` by default | Berbahaya jika accidentally baseline DB salah |
| `validate-on-migrate` | `true` | Tangkap checksum/history mismatch |
| `out-of-order` | `false` | Hindari migration urutan kacau |
| `clean-disabled` | `true` | Jangan izinkan drop semua object di env penting |

---

## 7. Basic Configuration: Liquibase Properties

Minimal `application.yml`:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/appdb
    username: app_migration
    password: local_password

  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml
```

Production-aware example:

```yaml
spring:
  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml
    database-change-log-table: DATABASECHANGELOG
    database-change-log-lock-table: DATABASECHANGELOGLOCK
    default-schema: app
    liquibase-schema: app_meta
    contexts: prod
    label-filter: release-2026-06
    test-rollback-on-update: false
```

Penjelasan:

| Property | Fungsi |
|---|---|
| `enabled` | Mengaktifkan/mematikan Liquibase auto-run |
| `change-log` | Lokasi master changelog |
| `contexts` | Filter environment atau use-case |
| `label-filter` | Filter release/feature label |
| `default-schema` | Schema target object |
| `liquibase-schema` | Schema metadata Liquibase |
| `database-change-log-table` | Nama table history |
| `database-change-log-lock-table` | Nama lock table |

---

## 8. Jangan Campur Banyak Mekanisme Schema Initialization

Spring Boot punya beberapa cara inisialisasi database:

1. Hibernate `ddl-auto`.
2. `schema.sql`.
3. `data.sql`.
4. Flyway.
5. Liquibase.
6. Manual script di pipeline.
7. Testcontainers init script.

Masalah muncul jika beberapa mekanisme aktif bersamaan.

Contoh buruk:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: update
  flyway:
    enabled: true
```

Artinya:

```text
Flyway modifies schema
Hibernate may also modify schema
```

Ini merusak source of truth.

### 8.1 Production Rule

Untuk production-grade application:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
  flyway:
    enabled: true
```

Atau:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: none
  liquibase:
    enabled: true
```

Rekomendasi:

| Environment | `ddl-auto` | Migration Tool |
|---|---|---|
| local quick prototype | `create-drop` boleh sementara | optional |
| local serious dev | `validate` atau `none` | Flyway/Liquibase |
| CI | `validate` | Flyway/Liquibase |
| UAT | `validate` atau `none` | Flyway/Liquibase |
| production | `validate` atau `none` | Flyway/Liquibase/external job |

### 8.2 Kenapa `ddl-auto=update` Berbahaya?

Karena Hibernate `update`:

- menghasilkan perubahan implicit,
- tidak selalu aman,
- tidak selalu portable,
- tidak memberi migration review trail yang baik,
- tidak menyelesaikan data migration,
- tidak cocok untuk expand/contract,
- tidak memberi artifact versioning yang jelas,
- dan dapat berbeda antar Hibernate version.

Hibernate entity mapping adalah contract. Migration script adalah mekanisme perubahan contract.

```text
Entity mapping tells what app expects.
Migration tells how DB moves there safely.
```

Jangan membaliknya menjadi:

```text
Hibernate guesses schema changes from entity classes.
```

Itu bukan production database engineering.

---

## 9. `schema.sql` dan `data.sql`: Kapan Boleh?

Spring Boot dapat menjalankan `schema.sql` dan `data.sql`. Ini berguna untuk demo atau test sederhana. Namun untuk aplikasi serius, penggunaannya harus dibatasi.

### 9.1 Masalah `schema.sql`

Jika `schema.sql` membuat table yang sama dengan Flyway migration:

```text
schema.sql creates customer
Flyway V1 creates customer
Conflict
```

Atau lebih buruk:

```text
local has schema.sql
prod only has Flyway
local and prod drift
```

### 9.2 Masalah `data.sql`

`data.sql` sering dipakai untuk seed:

```sql
INSERT INTO role(id, code, name) VALUES (1, 'ADMIN', 'Administrator');
```

Masalah:

- tidak versioned dengan jelas,
- bisa bentrok dengan migration seed,
- ordering dengan JPA/migration dapat membingungkan,
- tidak cocok untuk controlled production seed,
- sering environment-specific tanpa governance.

### 9.3 Rule yang Lebih Aman

Untuk seri ini, rule-nya:

```text
Use Flyway/Liquibase for schema and controlled seed.
Use test fixtures only inside tests.
Avoid schema.sql/data.sql for production-grade app initialization.
```

Exception:

- very small sample app,
- test-only in-memory database,
- throwaway prototype,
- local demo environment yang eksplisit bukan production model.

---

## 10. Migration Saat Startup vs External Job

Ini keputusan penting dalam Spring Boot.

Ada dua model besar:

```text
Model A: App-startup migration
Model B: External migration job before app deployment
```

### 10.1 Model A — Migration Saat App Startup

Aplikasi Spring Boot start, lalu Flyway/Liquibase otomatis migrate.

```text
Pod starts
  -> Spring Boot starts
  -> DataSource created
  -> Flyway/Liquibase runs
  -> App starts serving traffic
```

Kelebihan:

- sederhana,
- bagus untuk local dev,
- bagus untuk small service,
- migration selalu dekat dengan artifact aplikasi,
- tidak butuh pipeline tambahan.

Kekurangan:

- setiap instance berpotensi mencoba migrate,
- startup time dapat panjang,
- migration failure menjadi app startup failure,
- sulit kontrol approval production,
- kurang cocok untuk backfill besar,
- berisiko dalam autoscaling/restart storm,
- rollback deployment bisa membingungkan jika DB sudah berubah.

Cocok untuk:

- small app,
- internal tool,
- migration ringan,
- low traffic,
- single instance,
- early-stage system,
- non-critical environment.

Tidak cocok untuk:

- migration berat,
- zero-downtime complex release,
- regulated production,
- large table DDL,
- multi-pod production tanpa guardrail,
- backfill jutaan row,
- deployment dengan strict approval.

### 10.2 Model B — External Migration Job

Migration dijalankan sebagai step terpisah sebelum aplikasi baru dirollout.

```text
CI/CD pipeline
  -> build app artifact
  -> run migration job
  -> verify migration
  -> deploy app
```

Atau Kubernetes:

```text
Kubernetes Job runs Flyway/Liquibase
  -> Job completes successfully
  -> Deployment rollout starts
```

Kelebihan:

- kontrol lebih kuat,
- audit lebih jelas,
- failure migration tidak membuat app pod restart-loop,
- cocok untuk approval gate,
- bisa diberi resource/timeouts khusus,
- cocok untuk production.

Kekurangan:

- pipeline lebih kompleks,
- perlu memastikan app migration auto-run disabled,
- perlu artifact migration yang konsisten,
- perlu ordering deployment yang disiplin.

Cocok untuk:

- production regulated environment,
- multi-pod service,
- large database,
- migration dengan pre/post checks,
- zero-downtime deployment,
- multi-service release train.

### 10.3 Rule of Thumb

```text
Local/dev/test: startup migration is acceptable.
Production: prefer external migration job for serious systems.
```

Namun bukan dogma. Pilihan bergantung pada risiko:

| Faktor | Startup Migration | External Job |
|---|---:|---:|
| Local dev simplicity | Excellent | Medium |
| Production control | Medium/Low | High |
| Approval/audit | Medium | High |
| Multi-pod safety | Tool-dependent | Better |
| Long migration | Poor | Better |
| Zero-downtime choreography | Limited | Better |
| Operational visibility | Basic | Stronger |

---

## 11. Multi-Pod Problem di Kubernetes

Dalam Kubernetes, Spring Boot app biasanya berjalan beberapa replica:

```text
Deployment: app-service
replicas: 4
```

Saat rollout:

```text
pod-1 starts -> runs migration
pod-2 starts -> also checks migration
pod-3 starts -> also checks migration
pod-4 starts -> also checks migration
```

Flyway dan Liquibase punya locking/history mechanism. Jadi mereka tidak asal menjalankan migration yang sama bersamaan. Tetapi tetap ada risiko operasional:

- semua pod menunggu lock,
- startup timeout,
- readiness probe gagal,
- pod restart,
- deployment stuck,
- migration berat mengganggu rollout,
- app container resource digunakan untuk migration berat.

### 11.1 Startup Migration di Kubernetes: Minimal Guardrail

Jika tetap menjalankan migration saat startup:

```yaml
spring:
  flyway:
    enabled: true
```

Tambahkan guardrail:

- readiness probe jangan terlalu agresif,
- startup probe cukup longgar,
- migration harus ringan,
- migration harus backward-compatible,
- jangan menjalankan backfill besar di startup,
- observability log harus jelas,
- app user/migration user privileges dipikirkan,
- deployment strategy harus memperhitungkan schema compatibility.

### 11.2 External Kubernetes Job Pattern

Pattern yang lebih production-grade:

```text
1. Build app image containing migrations
2. Run Kubernetes Job using same image or migration-specific image
3. Job runs Flyway/Liquibase
4. Job exits 0
5. App Deployment rollout proceeds
6. App pods start with migration disabled
```

Spring Boot app production config:

```yaml
spring:
  flyway:
    enabled: false
```

Migration Job command:

```bash
java -jar app.jar --spring.profiles.active=migration
```

Migration profile:

```yaml
spring:
  main:
    web-application-type: none
  flyway:
    enabled: true
  jpa:
    hibernate:
      ddl-auto: none
```

Alternative: use Flyway CLI/Liquibase CLI image.

---

## 12. Migration-Only Spring Boot Profile

Salah satu pattern yang bagus adalah membuat profile khusus migration.

### 12.1 Application Runtime Profile

`application-prod.yml`:

```yaml
spring:
  flyway:
    enabled: false
  liquibase:
    enabled: false

  jpa:
    hibernate:
      ddl-auto: validate
```

### 12.2 Migration Profile

`application-migration.yml`:

```yaml
spring:
  main:
    web-application-type: none

  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
    clean-disabled: true

  liquibase:
    enabled: false

  jpa:
    hibernate:
      ddl-auto: none
```

Run:

```bash
java -jar app.jar --spring.profiles.active=prod,migration
```

Untuk Liquibase:

```yaml
spring:
  main:
    web-application-type: none

  flyway:
    enabled: false

  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml

  jpa:
    hibernate:
      ddl-auto: none
```

### 12.3 Kenapa `web-application-type: none`?

Karena migration job tidak perlu membuka HTTP server.

Tanpa ini:

```text
Migration job starts embedded Tomcat/Jetty/Netty
Potentially exposes app endpoints
Unnecessary startup cost
Confusing health checks
```

Dengan ini:

```text
Migration process starts
Runs migration
Exits
```

---

## 13. Preventing Business Beans From Running During Migration Job

Masalah umum: saat migration profile menjalankan Spring Boot app, bean lain ikut start.

Contoh:

```java
@Component
public class CaseScheduler {
    @Scheduled(fixedDelay = 60000)
    public void syncCases() {
        // calls external system
    }
}
```

Jika migration job menjalankan full app context, scheduler bisa ikut aktif. Itu berbahaya.

### 13.1 Disable Scheduling in Migration Profile

```yaml
spring:
  task:
    scheduling:
      enabled: false
```

Atau gunakan conditional property:

```java
@Configuration
@EnableScheduling
@ConditionalOnProperty(
    name = "app.scheduling.enabled",
    havingValue = "true",
    matchIfMissing = true
)
public class SchedulingConfig {
}
```

Migration profile:

```yaml
app:
  scheduling:
    enabled: false
```

### 13.2 Disable Message Consumers

Jika app memakai Kafka/RabbitMQ listener:

```yaml
app:
  messaging:
    consumers:
      enabled: false
```

Configuration:

```java
@Configuration
@ConditionalOnProperty(
    name = "app.messaging.consumers.enabled",
    havingValue = "true",
    matchIfMissing = true
)
public class MessagingConsumerConfig {
}
```

### 13.3 Disable Web Layer

```yaml
spring:
  main:
    web-application-type: none
```

### 13.4 Best Practice

Migration job should initialize only:

```text
configuration
DataSource
Flyway/Liquibase
minimal logging/metrics
```

Not:

```text
HTTP server
schedulers
message consumers
external sync jobs
business workflow processors
batch workers
```

---

## 14. Flyway Customization in Spring Boot

Spring Boot auto-configures Flyway, but kita bisa customize.

### 14.1 `FlywayConfigurationCustomizer`

```java
import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlywayConfig {

    @Bean
    public FlywayConfigurationCustomizer flywayCustomizer() {
        return (FluentConfiguration configuration) -> {
            configuration
                .baselineOnMigrate(false)
                .validateOnMigrate(true)
                .cleanDisabled(true);
        };
    }
}
```

Gunakan customizer untuk setting yang tidak nyaman diletakkan di YAML atau perlu logic ringan.

Namun hindari customizer yang terlalu pintar:

```java
if (env.equals("prod")) {
    // do one thing
} else if (env.equals("uat")) {
    // do another thing
}
```

Jika terlalu banyak branch, migration behaviour menjadi sulit diaudit.

### 14.2 Multiple Locations by Profile

```yaml
spring:
  flyway:
    locations:
      - classpath:db/migration/common
      - classpath:db/migration/postgresql
```

Untuk profile Oracle:

```yaml
spring:
  flyway:
    locations:
      - classpath:db/migration/common
      - classpath:db/migration/oracle
```

Careful:

```text
Different locations across env can create different migration histories.
```

Gunakan hanya jika benar-benar multi-DB product.

---

## 15. Liquibase Customization in Spring Boot

Liquibase bisa dikustomisasi lewat property dan bean.

### 15.1 Property-Based Customization

```yaml
spring:
  liquibase:
    change-log: classpath:/db/changelog/db.changelog-master.yaml
    contexts: prod
    label-filter: release-2026-06
    default-schema: app
```

### 15.2 Custom `SpringLiquibase` Bean

Kadang perlu custom bean, misalnya multiple datasource.

```java
import liquibase.integration.spring.SpringLiquibase;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

@Configuration
public class LiquibaseConfig {

    @Bean
    public SpringLiquibase appLiquibase(
            @Qualifier("appDataSource") DataSource dataSource) {
        SpringLiquibase liquibase = new SpringLiquibase();
        liquibase.setDataSource(dataSource);
        liquibase.setChangeLog("classpath:/db/changelog/db.changelog-master.yaml");
        liquibase.setContexts("prod");
        liquibase.setShouldRun(true);
        return liquibase;
    }
}
```

Caution:

> Jika membuat custom `SpringLiquibase`, pastikan auto-configuration tidak menjalankan Liquibase kedua kali.

---

## 16. Multi-Datasource Migration

Banyak enterprise Spring Boot app punya lebih dari satu database:

```text
primary datasource: application transactional DB
reporting datasource: read/report DB
audit datasource: audit DB
integration datasource: external staging DB
```

Spring Boot default hanya auto-run migration untuk primary datasource, kecuali dikonfigurasi khusus.

### 16.1 Flyway Multi-Datasource Pattern

Disable default Flyway:

```yaml
spring:
  flyway:
    enabled: false
```

Define manually:

```java
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

@Configuration
public class MultiFlywayConfig {

    @Bean
    public ApplicationRunner migratePrimary(
            @Qualifier("primaryDataSource") DataSource primaryDataSource) {
        return args -> Flyway.configure()
            .dataSource(primaryDataSource)
            .locations("classpath:db/migration/primary")
            .table("flyway_schema_history")
            .load()
            .migrate();
    }

    @Bean
    public ApplicationRunner migrateAudit(
            @Qualifier("auditDataSource") DataSource auditDataSource) {
        return args -> Flyway.configure()
            .dataSource(auditDataSource)
            .locations("classpath:db/migration/audit")
            .table("flyway_schema_history")
            .load()
            .migrate();
    }
}
```

Namun `ApplicationRunner` runs later than Flyway auto-config normally. Jika JPA depends on primary DB, jangan biarkan JPA initialize sebelum migration. Untuk multi-datasource production, lebih aman external job.

Better pattern:

```text
Run separate migration job for each datasource before app starts.
```

### 16.2 Liquibase Multi-Datasource Pattern

```java
@Bean
public SpringLiquibase primaryLiquibase(
        @Qualifier("primaryDataSource") DataSource ds) {
    SpringLiquibase lb = new SpringLiquibase();
    lb.setDataSource(ds);
    lb.setChangeLog("classpath:/db/changelog/primary/master.yaml");
    return lb;
}

@Bean
public SpringLiquibase auditLiquibase(
        @Qualifier("auditDataSource") DataSource ds) {
    SpringLiquibase lb = new SpringLiquibase();
    lb.setDataSource(ds);
    lb.setChangeLog("classpath:/db/changelog/audit/master.yaml");
    return lb;
}
```

Pastikan ordering jelas jika satu datasource tergantung yang lain.

---

## 17. Multi-Schema Migration

Multi-schema berbeda dari multi-datasource.

```text
Same database connection
Different schemas:
  app
  audit
  reference
  workflow
```

### 17.1 Flyway Multi-Schema

```yaml
spring:
  flyway:
    schemas:
      - app
      - audit
    default-schema: app
    table: flyway_schema_history
```

Questions to answer:

- Metadata table diletakkan di schema mana?
- Migration user punya privilege ke semua schema?
- Apakah schema dibuat oleh Flyway atau pre-existing?
- Apakah object cross-schema references stabil?

Example:

```sql
CREATE TABLE app.customer (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200) NOT NULL
);

CREATE TABLE audit.customer_audit (
    id BIGINT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    event_type VARCHAR(50) NOT NULL
);
```

### 17.2 Liquibase Multi-Schema

```yaml
spring:
  liquibase:
    default-schema: app
    liquibase-schema: app_meta
```

Changeset:

```yaml
databaseChangeLog:
  - changeSet:
      id: 001-create-customer
      author: team-app
      changes:
        - createTable:
            schemaName: app
            tableName: customer
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
              - column:
                  name: name
                  type: varchar(200)
                  constraints:
                    nullable: false
```

Rule:

```text
Be explicit with schema in enterprise systems.
```

Implicit schema works until:

- user default schema changes,
- search path changes,
- migration runs under different user,
- CI uses different database defaults,
- or DBA creates synonyms/aliases.

---

## 18. Migration User vs Application User

Production-grade systems should consider separate DB users:

```text
app_user:
  SELECT, INSERT, UPDATE, DELETE on runtime tables
  EXECUTE on required procedures

migration_user:
  CREATE, ALTER, DROP, INDEX, CONSTRAINT changes
  DML for controlled seed/backfill
```

### 18.1 Spring Boot Startup Migration Problem

If migration runs inside app startup, app must have migration privileges.

```text
App pod credential = can ALTER production schema
```

That is not always acceptable.

External job allows:

```text
Migration job uses migration_user
Runtime app uses app_user
```

This is much better for least privilege.

### 18.2 Config Split

Runtime:

```yaml
spring:
  datasource:
    username: app_user
    password: ${APP_DB_PASSWORD}
  flyway:
    enabled: false
```

Migration job:

```yaml
spring:
  datasource:
    username: migration_user
    password: ${MIGRATION_DB_PASSWORD}
  flyway:
    enabled: true
```

This is one of the strongest reasons to separate migration job from runtime app in regulated systems.

---

## 19. Spring Profiles and Environment Drift

Spring profiles are powerful but can cause migration drift.

Example:

```yaml
# application-dev.yml
spring:
  flyway:
    locations: classpath:db/migration/dev
```

```yaml
# application-prod.yml
spring:
  flyway:
    locations: classpath:db/migration/prod
```

This can create two different schema histories.

### 19.1 Good Use of Profiles

Profiles boleh berbeda untuk:

- datasource URL,
- credentials,
- migration enabled/disabled,
- timeout setting,
- context/label filter when intentionally governed,
- logging verbosity.

Profiles sebaiknya tidak berbeda untuk:

- core migration path,
- version ordering,
- production schema semantics,
- mandatory seed data,
- table/column definitions.

### 19.2 Better Pattern

Same migration artifact everywhere:

```text
local -> CI -> dev -> SIT -> UAT -> staging -> prod
```

Different runtime config only:

```text
DB URL
credential
enabled/disabled
schema name if unavoidable
```

The core schema evolution should not fork by environment.

---

## 20. Actuator Integration

Spring Boot Actuator can expose Flyway/Liquibase information if configured.

Typical endpoints:

```text
/actuator/flyway
/actuator/liquibase
```

These can show applied migrations/changesets.

### 20.1 Useful For

- verifying deployed schema version,
- debugging environment mismatch,
- checking whether migration ran,
- comparing instances,
- operational visibility.

### 20.2 Security Warning

Do not expose these publicly.

Migration metadata can reveal:

- table names,
- feature names,
- release timeline,
- internal module names,
- operational structure.

Secure actuator:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
```

For internal environment only:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,flyway,liquibase
```

Add proper authentication/authorization/network restrictions.

---

## 21. Health Check and Readiness Considerations

A common Kubernetes issue:

```text
migration takes 90 seconds
readiness/liveness probe starts too early
pod killed
migration retried
deployment unstable
```

### 21.1 Startup Probe

Use startup probe for slow initialization:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

This gives app time to start.

But this does not solve long migration risk. It only hides symptoms.

### 21.2 Better Rule

```text
If migration can exceed normal startup budget, do not run it during app startup.
```

Use external job.

---

## 22. Application Startup Failure Semantics

If migration fails during startup:

```text
Spring Boot fails to start
Process exits non-zero
Container restarts
```

This is good because app does not run with wrong schema.

But it can cause:

- CrashLoopBackOff,
- repeated migration attempts,
- noisy logs,
- lock contention,
- partial repair confusion,
- operational pressure.

### 22.1 Failure Example

Flyway migration:

```sql
ALTER TABLE customer ADD CONSTRAINT uq_customer_email UNIQUE (email);
```

Fails because duplicate emails exist.

App startup fails.

Naive reaction:

```text
Restart pod
```

But restart does not fix duplicate data.

Correct reaction:

```text
1. Stop rollout
2. Inspect failed migration
3. Inspect database state/history table
4. Fix data or create corrective migration
5. Re-run migration under controlled process
6. Resume deployment
```

The migration failure is not an app availability bug. It is a database change incident.

---

## 23. JPA `ddl-auto` Strategy With Flyway/Liquibase

### 23.1 Recommended Settings

For production:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
```

Or:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: none
```

`validate` checks whether schema matches mapping. This can catch missing columns/tables early.

`none` avoids Hibernate schema check, useful if:

- schema uses features Hibernate cannot model well,
- startup performance matters,
- validation is handled by tests/pipeline,
- there are many legacy tables not mapped cleanly.

### 23.2 Avoid in Serious Environments

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: update
```

Avoid also:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: create
```

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: create-drop
```

Except for ephemeral test/demo environments.

---

## 24. Entity Changes and Migration Changes Must Be Designed Together

A common mistake:

```text
Developer modifies entity
Developer writes migration afterward mechanically
```

Better:

```text
Developer designs schema change + app compatibility together
```

Example: adding nullable column.

Entity:

```java
@Column(name = "risk_score")
private Integer riskScore;
```

Migration:

```sql
ALTER TABLE customer ADD risk_score INTEGER;
```

This is usually safe.

Example: adding non-null column.

Bad migration:

```sql
ALTER TABLE customer ADD risk_level VARCHAR(20) NOT NULL;
```

This fails if table has existing rows.

Better expand/backfill/contract:

```sql
ALTER TABLE customer ADD risk_level VARCHAR(20);
```

Backfill:

```sql
UPDATE customer
SET risk_level = 'UNKNOWN'
WHERE risk_level IS NULL;
```

Later:

```sql
ALTER TABLE customer ALTER COLUMN risk_level SET NOT NULL;
```

For PostgreSQL syntax. Oracle/MySQL/SQL Server differ.

Application logic also needs transition handling:

```java
public RiskLevel getRiskLevelOrDefault() {
    return riskLevel == null ? RiskLevel.UNKNOWN : riskLevel;
}
```

The real unit of design is not entity or migration. It is:

```text
application code + migration + deployment order + rollback behaviour
```

---

## 25. Spring Boot With Flyway and JPA: Example Project Layout

```text
src/main/java/com/example/caseapp/
  CaseApplication.java
  customer/
    Customer.java
    CustomerRepository.java
    CustomerService.java
  config/
    PersistenceConfig.java

src/main/resources/
  application.yml
  application-local.yml
  application-prod.yml
  application-migration.yml
  db/
    migration/
      V202606170900__create_customer.sql
      V202606171000__add_customer_risk_score.sql
      V202606171100__seed_customer_status.sql
```

`application.yml`:

```yaml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}

  jpa:
    hibernate:
      ddl-auto: validate
    properties:
      hibernate:
        format_sql: false

  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
    clean-disabled: true
```

`application-prod.yml` if external job is used:

```yaml
spring:
  flyway:
    enabled: false
```

`application-migration.yml`:

```yaml
spring:
  main:
    web-application-type: none

  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
    clean-disabled: true

  jpa:
    hibernate:
      ddl-auto: none
```

---

## 26. Spring Boot With Liquibase and JPA: Example Project Layout

```text
src/main/resources/
  db/
    changelog/
      db.changelog-master.yaml
      releases/
        2026-06-17-customer.yaml
        2026-06-18-case.yaml
      seeds/
        reference-status.yaml
```

`db.changelog-master.yaml`:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-06-17-customer.yaml
  - include:
      file: db/changelog/seeds/reference-status.yaml
```

`application.yml`:

```yaml
spring:
  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml

  jpa:
    hibernate:
      ddl-auto: validate
```

`application-prod.yml` with external job:

```yaml
spring:
  liquibase:
    enabled: false
```

`application-migration.yml`:

```yaml
spring:
  main:
    web-application-type: none

  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml

  jpa:
    hibernate:
      ddl-auto: none
```

---

## 27. Migration With Spring Boot Tests

Testing migration in Spring Boot needs discipline.

### 27.1 Common Bad Test Setup

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:testdb
  jpa:
    hibernate:
      ddl-auto: create-drop
  flyway:
    enabled: false
```

Problem:

```text
Tests do not test real migrations.
```

Your app can pass tests and fail in production migration.

### 27.2 Better Test Setup

Use real migration tool in test:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
  flyway:
    enabled: true
```

Or Liquibase:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
  liquibase:
    enabled: true
```

### 27.3 Best Test Setup With Testcontainers

For PostgreSQL:

```java
@Testcontainers
@SpringBootTest
class MigrationIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("appdb")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
    }

    @Test
    void applicationStartsWithMigratedSchema() {
        // If context starts, migration + Hibernate validation passed.
    }
}
```

This catches:

- SQL syntax incompatible with real DB,
- missing migration,
- Hibernate mapping mismatch,
- checksum/history issue in some scenarios,
- vendor-specific assumptions.

### 27.4 Migration-Only Test

You can test only migration without full app:

```java
@SpringBootTest(
    properties = {
        "spring.main.web-application-type=none",
        "spring.flyway.enabled=true",
        "spring.jpa.hibernate.ddl-auto=none"
    }
)
class FlywayMigrationOnlyTest {

    @Autowired
    DataSource dataSource;

    @Test
    void expectedTableExists() throws Exception {
        try (Connection c = dataSource.getConnection();
             ResultSet rs = c.getMetaData().getTables(null, null, "customer", null)) {
            assertThat(rs.next()).isTrue();
        }
    }
}
```

---

## 28. Avoid H2 Trap in Spring Boot Migration Tests

H2 is convenient but dangerous as a migration test substitute.

Example:

```sql
CREATE INDEX CONCURRENTLY idx_customer_email ON customer(email);
```

Valid in PostgreSQL, invalid in H2.

Oracle example:

```sql
CREATE INDEX idx_customer_email ON customer(email) ONLINE;
```

Valid in Oracle Enterprise contexts, not portable.

H2 may also accept syntax that production DB rejects, or reject syntax production DB accepts.

Rule:

```text
Use H2 for fast unit tests if needed.
Use real DB engine for migration tests.
```

---

## 29. Handling Seed Data in Spring Boot

Do not casually use `data.sql` for production seed if Flyway/Liquibase is your migration tool.

### 29.1 Flyway Seed

```text
db/migration/
  V202606170900__create_role_table.sql
  V202606170910__seed_roles.sql
```

Seed example:

```sql
INSERT INTO role (code, name)
SELECT 'ADMIN', 'Administrator'
WHERE NOT EXISTS (
    SELECT 1 FROM role WHERE code = 'ADMIN'
);
```

Vendor-specific upsert may be better:

PostgreSQL:

```sql
INSERT INTO role (code, name)
VALUES ('ADMIN', 'Administrator')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name;
```

### 29.2 Liquibase Seed

```yaml
databaseChangeLog:
  - changeSet:
      id: seed-role-admin
      author: platform-team
      changes:
        - insert:
            tableName: role
            columns:
              - column:
                  name: code
                  value: ADMIN
              - column:
                  name: name
                  value: Administrator
```

For idempotent update semantics, use SQL changeset:

```yaml
databaseChangeLog:
  - changeSet:
      id: upsert-role-admin
      author: platform-team
      changes:
        - sql:
            dbms: postgresql
            sql: |
              INSERT INTO role (code, name)
              VALUES ('ADMIN', 'Administrator')
              ON CONFLICT (code) DO UPDATE
              SET name = EXCLUDED.name;
```

### 29.3 Local Demo Data

Separate production seed from local demo/test data.

```text
production seed:
  roles, statuses, permission codes, reference values

local demo data:
  fake users, sample orders, dummy cases
```

Do not put fake users in production migration path.

Possible structure:

```text
src/main/resources/db/migration
  V1__schema.sql
  V2__reference_seed.sql

src/test/resources/db/testdata
  T1__insert_demo_customers.sql
```

---

## 30. Dealing With Existing Production Database

If adopting Flyway/Liquibase into an existing Spring Boot app, do not blindly enable auto migration.

Dangerous:

```yaml
spring:
  flyway:
    enabled: true
    baseline-on-migrate: true
```

This may baseline the wrong database if config points wrongly.

Safer process:

```text
1. Inventory existing schema.
2. Create initial baseline script or baseline version.
3. Validate local copy of production schema.
4. Configure metadata table explicitly.
5. Run baseline manually in controlled environment.
6. Disable baseline-on-migrate after adoption.
7. Start future migrations from next version.
```

Example:

```yaml
spring:
  flyway:
    baseline-version: 1000
    baseline-description: existing-production-baseline
    baseline-on-migrate: false
```

Then perform baseline through explicit command/process.

---

## 31. Spring Boot Dev Workflow

A good local developer workflow:

```text
1. Pull latest main branch.
2. Start local DB container.
3. Run app with local profile.
4. Flyway/Liquibase applies migrations.
5. Hibernate validate checks mapping.
6. Developer adds entity/schema change.
7. Developer writes migration.
8. Developer resets local DB only when needed.
9. Developer runs migration integration tests.
10. PR includes app code + migration script.
```

### 31.1 Local Reset

For local only:

```bash
docker compose down -v
docker compose up -d
./gradlew bootRun
```

Avoid teaching developers to edit old migration files once merged.

Local reset is okay before merge. After merge, migration history must be immutable.

---

## 32. Pull Request Review Checklist for Spring Boot Migration

For every PR with entity/database change:

```text
[ ] Does entity change have matching migration?
[ ] Is Hibernate ddl-auto not responsible for production schema change?
[ ] Is migration backward-compatible with previous app version?
[ ] Is migration safe for existing data?
[ ] Is non-null/unique constraint introduced safely?
[ ] Is seed data deterministic and idempotent if needed?
[ ] Is migration tested against real DB engine?
[ ] Does migration avoid long locks?
[ ] Does migration avoid large backfill in startup path?
[ ] Does migration work with production schema/search path?
[ ] Is rollback/roll-forward story understood?
[ ] Are Spring profiles not causing migration drift?
[ ] If external job is used, is app auto-migration disabled in prod?
```

---

## 33. External Job Example: Docker/Kubernetes

### 33.1 Docker Command

Using the same Spring Boot jar:

```bash
java -jar app.jar \
  --spring.profiles.active=prod,migration \
  --spring.flyway.enabled=true \
  --spring.main.web-application-type=none
```

### 33.2 Kubernetes Job Example

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: case-app-db-migration-20260617
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: registry.example.com/case-app:2026.06.17
          command: ["java"]
          args:
            - "-jar"
            - "/app/app.jar"
            - "--spring.profiles.active=prod,migration"
            - "--spring.main.web-application-type=none"
          env:
            - name: DB_URL
              valueFrom:
                secretKeyRef:
                  name: case-app-db
                  key: migration-url
            - name: DB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: case-app-db
                  key: migration-username
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: case-app-db
                  key: migration-password
```

Runtime deployment:

```yaml
env:
  - name: SPRING_FLYWAY_ENABLED
    value: "false"
```

Or:

```yaml
env:
  - name: SPRING_LIQUIBASE_ENABLED
    value: "false"
```

### 33.3 Job Naming

Use unique job names per release:

```text
case-app-db-migration-20260617-001
```

Avoid reusing same Kubernetes Job name unless your deployment tool handles replacement.

---

## 34. Pipeline Pattern With Spring Boot Artifact

```text
Build Stage
  -> compile Java
  -> run unit tests
  -> package jar/image

Migration Validation Stage
  -> start real DB container
  -> run Flyway/Liquibase migration
  -> run Hibernate validation
  -> run migration tests

Deploy to Dev/SIT/UAT
  -> run migration job
  -> deploy app with migration disabled
  -> smoke test

Production
  -> backup/snapshot if needed
  -> preflight lock/session check
  -> run migration job
  -> verify history table
  -> deploy app
  -> post-deploy verification
```

The important principle:

```text
The migration artifact must be the same artifact that was tested.
```

Avoid:

```text
CI tests migration from branch
Prod runs migration copied manually from someone laptop
```

---

## 35. Handling Rollback With Spring Boot Deployments

Suppose deployment version `2.4.0` includes:

```text
App code expects column customer.risk_score
Migration adds customer.risk_score
```

Deployment fails after migration succeeds.

Can you rollback app to `2.3.0`?

If column addition is backward-compatible, yes.

```text
Old app ignores extra column
Rollback app safe
```

But if migration dropped a column old app needs:

```text
Migration drops customer.status
Old app still reads customer.status
Rollback app fails
```

Therefore:

```text
Spring Boot rollback safety depends on schema compatibility, not only app artifact rollback.
```

Production deployment should prefer:

- additive schema changes first,
- app rollout second,
- destructive contract later,
- never combine breaking schema drop and app change in same risky step.

---

## 36. Common Spring Boot Migration Anti-Patterns

### 36.1 `ddl-auto=update` in Production

```yaml
spring.jpa.hibernate.ddl-auto: update
```

Problem:

```text
Hibernate becomes uncontrolled migration engine.
```

### 36.2 Flyway and Liquibase Both Enabled

```yaml
spring:
  flyway:
    enabled: true
  liquibase:
    enabled: true
```

Usually bad unless extremely intentional for separate schemas. Choose one primary migration tool per schema.

### 36.3 Backfill Millions of Rows During Startup

```sql
UPDATE huge_table SET new_col = expensive_function(old_col);
```

Problem:

```text
App startup waits
Locks may block traffic
Pod may timeout
Rollback is unclear
```

Use external job/batch backfill.

### 36.4 Editing Old Migration After Merge

Bad:

```text
V12 merged and applied in dev/UAT
Developer edits V12
Checksum mismatch
```

Correct:

```text
Create V13 corrective migration
```

### 36.5 Environment-Specific Migration Files

Bad:

```text
V1__create_table_dev.sql
V1__create_table_prod.sql
```

Better:

```text
Same migration file
Different config only where safe
```

### 36.6 App Runtime User Has DDL Privileges Forever

Bad in regulated systems:

```text
app_user can ALTER/DROP/CREATE in production
```

Better:

```text
migration_user for migration job
app_user for runtime
```

### 36.7 Migration Hidden Inside Business Startup Logic

Bad:

```java
@PostConstruct
void fixData() {
    jdbcTemplate.update("update ...");
}
```

Problem:

- not versioned,
- not audited,
- runs unpredictably,
- hard to test,
- may run on every pod,
- no schema history.

Use migration tool or explicit batch/backfill job.

---

## 37. Troubleshooting Guide

### 37.1 App Fails: Flyway Validate Failed

Symptoms:

```text
Validate failed: Migration checksum mismatch
```

Likely causes:

- old migration edited,
- line ending changed,
- placeholder changed,
- migration file differs across artifact,
- manual repair done incorrectly.

Response:

```text
1. Do not blindly run repair.
2. Check which migration checksum differs.
3. Determine whether migration was edited after applied.
4. If already applied in shared env, create corrective migration.
5. Use repair only when metadata correction is truly justified.
```

### 37.2 App Fails: Liquibase Lock Held

Symptoms:

```text
Could not acquire change log lock
```

Likely causes:

- previous Liquibase run crashed,
- long-running migration still active,
- stale lock row,
- multiple deployment jobs.

Response:

```text
1. Check whether another migration is still running.
2. Inspect database sessions.
3. If stale lock confirmed, release lock using official process/tooling.
4. Re-run migration.
```

Never delete lock blindly while migration is actually running.

### 37.3 Hibernate Validation Fails After Migration

Symptoms:

```text
Schema-validation: missing column [risk_score]
```

Likely causes:

- migration disabled,
- wrong datasource,
- wrong schema/search path,
- migration location not included,
- app version and migration artifact mismatch,
- migration failed earlier.

Response:

```text
1. Check migration history table.
2. Check active Spring profile.
3. Check datasource URL.
4. Check schema/search path.
5. Check app artifact version.
```

### 37.4 Migration Works Locally But Fails in UAT

Likely causes:

- H2/local DB differs from UAT engine,
- existing UAT data violates new constraint,
- privilege difference,
- schema name difference,
- case sensitivity difference,
- object already exists due to manual change,
- migration order drift.

Response:

```text
1. Reproduce against same DB engine.
2. Export anonymized shape/sample if allowed.
3. Add precondition/validation query.
4. Add corrective migration.
5. Improve migration test fixture.
```

---

## 38. Production Readiness Checklist

Before enabling Spring Boot migration in production:

```text
[ ] Is Flyway or Liquibase the only schema migration mechanism?
[ ] Is Hibernate ddl-auto set to validate/none, not update/create?
[ ] Are schema.sql/data.sql disabled or test-only?
[ ] Is migration user separated from app runtime user where required?
[ ] Is migration enabled/disabled per environment intentionally?
[ ] Is production migration startup model chosen deliberately?
[ ] If multiple pods, is concurrency/lock/startup behaviour understood?
[ ] If Kubernetes, are probes compatible with expected startup behaviour?
[ ] Are long-running migrations moved to external job/batch?
[ ] Are migration logs observable?
[ ] Are actuator endpoints secured if enabled?
[ ] Is schema compatibility with rollback understood?
[ ] Is the migration tested against the real DB engine?
[ ] Is the same migration artifact promoted across environments?
[ ] Is there a runbook for validate/checksum/lock failure?
```

---

## 39. Decision Matrix: How Should Spring Boot Run Migration?

| Situation | Recommended Model |
|---|---|
| Local development | Startup migration |
| Unit test with no DB concern | Migration disabled, mock/repository slice |
| Integration test | Startup migration against Testcontainers |
| Small internal app | Startup migration acceptable |
| Multi-pod production | Prefer external job |
| Regulated/audited system | External job |
| Large backfill | External batch/job, not startup |
| Additive small DDL | Startup possible, external safer |
| Destructive schema change | Expand/contract, external orchestration |
| Multi-datasource | External jobs or carefully ordered custom config |
| Separate migration/app DB users | External job |

---

## 40. The Deep Mental Model

A Spring Boot application with Flyway/Liquibase has three contracts:

```text
1. Code contract
   What the application expects.

2. Database contract
   What the schema and data actually provide.

3. Deployment contract
   In what order code and database evolve.
```

Most migration incidents happen because engineers only think about contract 1 and 2:

```text
Entity has field -> database has column
```

Top-tier engineers also think about contract 3:

```text
Old app + old DB
Old app + new DB
New app + old DB
New app + new DB
```

For every change, ask:

```text
Can old app still run after this migration?
Can new app start before this migration?
Can migration be retried?
Can deployment be paused after migration?
Can app rollback after migration?
Can seed run twice?
Can multiple pods start safely?
Can production data violate this assumption?
```

That is the real Spring Boot database migration discipline.

---

## 41. Summary

Spring Boot makes Flyway and Liquibase easy to start, but easy startup is not the same as production-grade migration engineering.

Key conclusions:

1. Spring Boot orchestrates migration; Flyway/Liquibase remain the source of migration truth.
2. Migration generally runs after `DataSource` creation and before JPA/Hibernate initialization.
3. Do not mix Flyway/Liquibase with Hibernate `ddl-auto=update`, `schema.sql`, or uncontrolled `data.sql` in serious systems.
4. Startup migration is convenient but risky for production multi-pod or regulated systems.
5. External migration job gives stronger control, auditability, privilege separation, and operational safety.
6. Migration profile should disable web server, schedulers, message consumers, and unrelated business jobs.
7. Multi-datasource and multi-schema migration require explicit configuration and ordering.
8. Use real database engine tests, preferably Testcontainers, not only H2.
9. Rollback safety depends on schema compatibility, not just application artifact rollback.
10. The real unit of design is application code + migration + deployment choreography.

---

## 42. What Comes Next

Next part:

```text
25-migration-in-jakarta-ee-plain-java-non-spring.md
```

Kita akan membahas bagaimana menjalankan Flyway/Liquibase di luar Spring Boot:

- Jakarta EE,
- Servlet listener,
- CDI startup observer,
- EJB singleton startup,
- plain Java main,
- Maven/Gradle release phase,
- external CLI,
- app server datasource/JNDI,
- classloader issue,
- transaction manager issue,
- dan operational ownership di enterprise runtime non-Spring.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: 23 — Migration Testing Strategy](./23-migration-testing-strategy.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 25 — Migration in Jakarta EE, Plain Java, and Non-Spring Systems](./25-migration-in-jakarta-ee-plain-java-non-spring.md)
