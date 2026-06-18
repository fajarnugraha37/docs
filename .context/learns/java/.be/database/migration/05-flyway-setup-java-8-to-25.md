# Part 5 — Flyway Setup in Java 8–25 Projects

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `05-flyway-setup-java-8-to-25.md`  
> Fokus: Setup Flyway untuk proyek Java legacy dan modern, dari Java 8 sampai Java 25, dengan Maven, Gradle, CLI, Spring Boot, plain Java, Jakarta EE, container, dan CI/CD.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun mental model Flyway: migration adalah **ordered, checksum-validated, stateful database change execution**. Sekarang kita masuk ke setup nyata.

Namun setup Flyway tidak boleh dipahami sebagai sekadar menambahkan dependency:

```xml
<dependency>
  <groupId>org.flywaydb</groupId>
  <artifactId>flyway-core</artifactId>
</dependency>
```

Setup Flyway adalah keputusan arsitektural:

- apakah migration dijalankan oleh aplikasi saat startup?
- apakah migration dijalankan sebagai step CI/CD terpisah?
- apakah migration runner memakai credential sama dengan aplikasi?
- apakah semua service boleh menjalankan migration?
- bagaimana dengan Java 8 legacy?
- bagaimana dengan Java 21/25 modern runtime?
- bagaimana dengan Spring Boot auto-configuration?
- bagaimana dengan multi datasource?
- bagaimana migration di Kubernetes?
- bagaimana menjaga agar local/dev/UAT/prod konsisten?

Part ini akan menjawab itu secara sistematis.

---

## 2. Mental Model: Flyway Has Three Execution Modes

Secara praktis, Flyway dapat dijalankan melalui tiga mode besar:

```text
+-------------------------------+
|  1. Build Tool / Plugin        |
|  Maven / Gradle                |
+-------------------------------+
             |
             v
+-------------------------------+
|  2. Application Runtime        |
|  Spring Boot / Plain Java      |
+-------------------------------+
             |
             v
+-------------------------------+
|  3. External Runner            |
|  CLI / Docker / K8s Job / CI   |
+-------------------------------+
```

Masing-masing punya trade-off.

| Mode | Cocok Untuk | Kelebihan | Risiko |
|---|---|---|---|
| Maven/Gradle plugin | local dev, CI validation, controlled deployment | dekat dengan build lifecycle | build tool butuh DB access |
| Application startup | simple service, small team, local dev | sangat mudah | startup app bisa gagal karena DB migration |
| External runner | production, regulated systems, Kubernetes, multi-service | separation of duties, credential terpisah | perlu pipeline lebih matang |

Rule of thumb:

```text
Local/dev      : app startup atau Maven/Gradle boleh.
CI validation  : Maven/Gradle/CLI.
Production     : external runner lebih defensible.
Small system   : app startup acceptable.
Critical system: migration sebagai deployment step eksplisit.
```

---

## 3. Java 8–25 Compatibility Strategy

Karena target seri ini adalah Java 8 sampai Java 25, kita harus memisahkan antara:

1. **Java version aplikasi**
2. **Java version yang dipakai Flyway runtime**
3. **Flyway version**
4. **Spring Boot version**
5. **JDBC driver version**

Ini penting karena project legacy Java 8 tidak selalu bisa memakai Flyway terbaru di dalam aplikasi.

### 3.1 Compatibility Is Not One-Dimensional

Contoh masalah:

```text
Aplikasi     : Java 8
Spring Boot  : 2.7.x
Database     : PostgreSQL 13
Flyway latest: mungkin butuh Java lebih baru
```

Solusinya tidak harus downgrade seluruh platform. Ada beberapa opsi:

```text
Option A: Pakai Flyway versi lama sebagai dependency aplikasi.
Option B: Jalankan Flyway CLI/container dengan Java modern di luar aplikasi.
Option C: Pisahkan migration repository dan migration runner.
Option D: Upgrade runtime aplikasi jika feasible.
```

### 3.2 Recommended Strategy by Java Generation

| Java Runtime | Karakter Project | Strategi Setup Flyway |
|---|---|---|
| Java 8 | legacy, Spring Boot 2.x, app server lama | gunakan Flyway version compatible atau external runner |
| Java 11 | transitional enterprise | app startup masih mungkin, external runner disarankan untuk prod |
| Java 17 | modern baseline | Spring Boot 3.x/Flyway modern lebih natural |
| Java 21 | current LTS modern | cocok untuk app startup maupun external runner |
| Java 25 | latest/forward-looking | gunakan dependency terbaru yang explicit tested di pipeline |

### 3.3 Jangan Campur Runtime Compatibility Secara Buta

Kesalahan umum:

```text
“Project saya Java 8, berarti Flyway juga harus dijalankan di Java 8.”
```

Tidak selalu.

Kalau migration dijalankan sebagai external job, job itu boleh memakai Java 17/21 selama:

- SQL migration kompatibel dengan database target.
- JDBC driver kompatibel.
- Pipeline mengontrol version Flyway.
- Tidak ada Java-based migration yang bergantung pada class aplikasi Java 8.

Ini pattern penting untuk enterprise legacy:

```text
Legacy application runtime: Java 8
Migration runner runtime  : Java 17/21 container
Migration artifact        : SQL files
Database target           : same production DB
```

Dengan model ini, aplikasi tidak perlu membawa Flyway terbaru sebagai dependency runtime.

---

## 4. Repository Layout

Struktur default Flyway sangat sederhana:

```text
src/main/resources/db/migration/
  V1__init.sql
  V2__create_customer_table.sql
  V3__add_customer_email.sql
```

Tetapi untuk seri advance, kita perlu layout yang scalable.

### 4.1 Simple Spring Boot Layout

```text
my-service/
  pom.xml
  src/main/java/...
  src/main/resources/
    application.yml
    db/
      migration/
        V2026.001.001__create_customer_table.sql
        V2026.001.002__add_customer_email.sql
        R__customer_search_view.sql
```

Cocok untuk:

- satu service
- satu database/schema
- migration sederhana
- tim kecil-menengah

### 4.2 Multi Module Layout

```text
my-platform/
  build.gradle
  modules/
    customer-service/
      src/main/resources/db/migration/customer/
    billing-service/
      src/main/resources/db/migration/billing/
    case-service/
      src/main/resources/db/migration/case/
```

Dengan konfigurasi lokasi:

```properties
flyway.locations=classpath:db/migration/customer
```

Atau untuk beberapa lokasi:

```properties
flyway.locations=classpath:db/migration/common,classpath:db/migration/customer
```

Risiko multi-location:

- ordering bisa membingungkan
- ownership bisa kabur
- migration common bisa menjadi dumping ground
- version collision antar module

### 4.3 Separate Migration Repository

```text
database-migrations/
  README.md
  flyway.conf
  environments/
    dev.conf
    uat.conf
    prod.conf
  migrations/
    aceas/
      V2026.001.001__create_case_tables.sql
      V2026.001.002__seed_case_status.sql
    cpds/
      V2026.001.001__create_profile_tables.sql
```

Cocok untuk:

- regulated environments
- DBA review-heavy process
- multiple applications sharing DB
- migration run sebagai pipeline terpisah
- production approval terpisah dari app deploy

Trade-off:

- developer harus menjaga sinkronisasi code dan migration
- PR linting dan release discipline harus kuat
- lebih banyak pipeline work

---

## 5. Migration Naming Convention untuk Setup Awal

Part khusus naming sudah dibahas di Part 3, tetapi untuk setup kita butuh convention praktis.

### 5.1 Default Flyway Naming

```text
V<version>__<description>.sql
R__<description>.sql
```

Contoh:

```text
V1__init.sql
V2__create_user_table.sql
R__user_summary_view.sql
```

### 5.2 Recommended Enterprise Naming

```text
VYYYY.RR.NNN__verb_object_reason.sql
```

Contoh:

```text
V2026.01.001__create_customer_table.sql
V2026.01.002__add_customer_email_column.sql
V2026.01.003__seed_customer_status_reference_data.sql
```

Makna:

| Segment | Arti |
|---|---|
| `YYYY` | tahun release/migration |
| `RR` | release/wave/sprint train |
| `NNN` | sequence dalam release |
| description | maksud perubahan |

Kelebihan:

- mudah dibaca di audit
- merge conflict lebih rendah daripada `V1`, `V2`, `V3`
- cocok untuk release train
- tetap linear

### 5.3 Avoid

Hindari:

```text
V1__update.sql
V2__fix.sql
V3__new_table.sql
V4__change.sql
```

Karena 6 bulan kemudian tidak ada yang tahu maksudnya.

Migration filename adalah **production document**.

---

## 6. Setup with Maven

Ada dua cara umum memakai Flyway dengan Maven:

1. sebagai dependency aplikasi
2. sebagai Maven plugin

Keduanya berbeda.

---

### 6.1 Flyway as Application Dependency

Dipakai ketika aplikasi menjalankan migration saat startup, misalnya Spring Boot.

```xml
<dependencies>
  <dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
  </dependency>

  <dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
  </dependency>
</dependencies>
```

Untuk database tertentu, Flyway versi modern memisahkan beberapa database support ke artifact khusus. Contoh umum:

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

Catatan penting:

- selalu cek dokumentasi versi Flyway yang dipakai
- artifact database support bisa berubah antar major version
- jangan copy dependency dari blog lama tanpa validasi

---

### 6.2 Flyway Maven Plugin

Dipakai untuk menjalankan command Flyway via Maven:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.flywaydb</groupId>
      <artifactId>flyway-maven-plugin</artifactId>
      <version>${flyway.version}</version>
      <configuration>
        <url>${db.url}</url>
        <user>${db.user}</user>
        <password>${db.password}</password>
        <locations>
          <location>filesystem:src/main/resources/db/migration</location>
        </locations>
      </configuration>
      <dependencies>
        <dependency>
          <groupId>org.postgresql</groupId>
          <artifactId>postgresql</artifactId>
          <version>${postgresql.version}</version>
        </dependency>
      </dependencies>
    </plugin>
  </plugins>
</build>
```

Run:

```bash
mvn flyway:info
mvn flyway:validate
mvn flyway:migrate
mvn flyway:repair
```

### 6.3 Do Not Hardcode Production Password in `pom.xml`

Buruk:

```xml
<password>ProdPassword123!</password>
```

Lebih baik:

```xml
<password>${env.DB_PASSWORD}</password>
```

Atau:

```bash
mvn flyway:migrate \
  -Ddb.url=jdbc:postgresql://localhost:5432/app \
  -Ddb.user=app_migration \
  -Ddb.password="$DB_PASSWORD"
```

### 6.4 Maven Profiles

```xml
<profiles>
  <profile>
    <id>local</id>
    <properties>
      <db.url>jdbc:postgresql://localhost:5432/app</db.url>
      <db.user>app_migration</db.user>
    </properties>
  </profile>

  <profile>
    <id>dev</id>
    <properties>
      <db.url>${env.DEV_DB_URL}</db.url>
      <db.user>${env.DEV_DB_USER}</db.user>
    </properties>
  </profile>
</profiles>
```

Run:

```bash
mvn -Pdev flyway:info
```

### 6.5 Maven Plugin Pros and Cons

| Aspect | Evaluation |
|---|---|
| Local dev | good |
| CI validation | good |
| Production migration | acceptable if pipeline-controlled |
| Secret handling | must be careful |
| Runtime dependency | not needed |
| Java 8 legacy app | useful because Flyway can run outside app |

---

## 7. Setup with Gradle

Gradle setup juga bisa dalam dua bentuk:

1. dependency aplikasi
2. Flyway Gradle plugin

---

### 7.1 Gradle Application Dependency

Groovy DSL:

```groovy
dependencies {
    implementation 'org.flywaydb:flyway-core'
    runtimeOnly 'org.postgresql:postgresql'
}
```

Kotlin DSL:

```kotlin
dependencies {
    implementation("org.flywaydb:flyway-core")
    runtimeOnly("org.postgresql:postgresql")
}
```

---

### 7.2 Gradle Plugin

Groovy DSL:

```groovy
plugins {
    id 'org.flywaydb.flyway' version flywayVersion
}

flyway {
    url = System.getenv('DB_URL') ?: 'jdbc:postgresql://localhost:5432/app'
    user = System.getenv('DB_USER') ?: 'app_migration'
    password = System.getenv('DB_PASSWORD') ?: ''
    locations = ['filesystem:src/main/resources/db/migration']
}
```

Run:

```bash
./gradlew flywayInfo
./gradlew flywayValidate
./gradlew flywayMigrate
./gradlew flywayRepair
```

Kotlin DSL:

```kotlin
plugins {
    id("org.flywaydb.flyway") version flywayVersion
}

flyway {
    url = System.getenv("DB_URL") ?: "jdbc:postgresql://localhost:5432/app"
    user = System.getenv("DB_USER") ?: "app_migration"
    password = System.getenv("DB_PASSWORD") ?: ""
    locations = arrayOf("filesystem:src/main/resources/db/migration")
}
```

### 7.3 Gradle Multi-Module Setup

```text
platform/
  settings.gradle
  build.gradle
  customer-service/
    build.gradle
    src/main/resources/db/migration
  billing-service/
    build.gradle
    src/main/resources/db/migration
```

Root `build.gradle`:

```groovy
subprojects {
    apply plugin: 'org.flywaydb.flyway'

    flyway {
        url = System.getenv('DB_URL')
        user = System.getenv('DB_USER')
        password = System.getenv('DB_PASSWORD')
    }
}
```

Service-specific:

```groovy
flyway {
    locations = ['filesystem:src/main/resources/db/migration/customer']
}
```

Caution:

```text
Jangan membuat semua module otomatis migrate ke database yang sama tanpa dependency ordering eksplisit.
```

Kalau tidak, migration antar service bisa race.

---

## 8. Setup with Flyway CLI

CLI cocok untuk:

- local debugging
- CI/CD
- production deployment step
- Kubernetes Job
- non-Java applications juga
- Java 8 legacy application yang tidak mau membawa Flyway dependency

### 8.1 Basic `flyway.conf`

```properties
flyway.url=jdbc:postgresql://localhost:5432/app
flyway.user=app_migration
flyway.password=${DB_PASSWORD}
flyway.locations=filesystem:./migrations
flyway.schemas=public
flyway.table=flyway_schema_history
```

Run:

```bash
flyway -configFiles=flyway.conf info
flyway -configFiles=flyway.conf validate
flyway -configFiles=flyway.conf migrate
```

### 8.2 Environment-Specific Config

```text
conf/
  base.conf
  local.conf
  dev.conf
  uat.conf
  prod.conf
migrations/
  V2026.01.001__create_customer_table.sql
```

`base.conf`:

```properties
flyway.locations=filesystem:./migrations
flyway.table=flyway_schema_history
flyway.validateMigrationNaming=true
flyway.outOfOrder=false
```

`dev.conf`:

```properties
flyway.url=${DEV_DB_URL}
flyway.user=${DEV_DB_USER}
flyway.password=${DEV_DB_PASSWORD}
```

Run:

```bash
flyway -configFiles=conf/base.conf,conf/dev.conf info
```

### 8.3 CLI Pros and Cons

| Aspect | Evaluation |
|---|---|
| Runtime isolation | strong |
| Production control | strong |
| Java app version independence | strong |
| Local simplicity | medium |
| CI/CD integration | strong |
| Developer convenience | lower than app startup |

---

## 9. Setup with Docker / Container

Containerized Flyway is excellent for consistent execution.

```bash
docker run --rm \
  -v "$PWD/migrations:/flyway/sql" \
  flyway/flyway \
  -url="jdbc:postgresql://host.docker.internal:5432/app" \
  -user="app_migration" \
  -password="$DB_PASSWORD" \
  migrate
```

For CI:

```bash
docker run --rm \
  -v "$CI_PROJECT_DIR/migrations:/flyway/sql" \
  -e FLYWAY_URL="$DB_URL" \
  -e FLYWAY_USER="$DB_USER" \
  -e FLYWAY_PASSWORD="$DB_PASSWORD" \
  flyway/flyway migrate
```

### 9.1 Why Container Helps

Container solves:

- different developer OS
- different local Java version
- dependency mismatch
- missing CLI installation
- CI agent inconsistency

But it introduces:

- network access concern
- secret injection concern
- volume mount path concern
- image version pinning requirement

Always pin image version for production:

```bash
flyway/flyway:12.x.x
```

Avoid:

```bash
flyway/flyway:latest
```

Because `latest` makes deployment non-reproducible.

---

## 10. Spring Boot Integration

Spring Boot has first-class Flyway integration. If Flyway is on the classpath and database is configured, Boot can call migration automatically during startup.

Typical dependency:

```xml
<dependency>
  <groupId>org.flywaydb</groupId>
  <artifactId>flyway-core</artifactId>
</dependency>
```

Configuration:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/app
    username: app_user
    password: ${DB_PASSWORD}

  flyway:
    enabled: true
    locations: classpath:db/migration
    table: flyway_schema_history
    baseline-on-migrate: false
    out-of-order: false
    validate-on-migrate: true
```

### 10.1 Startup Ordering

Spring Boot runs Flyway before components that depend on initialized schema, including JPA initialization in the common setup.

Conceptually:

```text
Application starts
   |
   v
Create DataSource
   |
   v
Run Flyway migration
   |
   v
Initialize JPA / repositories / beans
   |
   v
Application ready
```

This is why startup migration feels convenient.

But in production, it can be risky.

### 10.2 App Startup Migration Risk

Imagine Kubernetes Deployment with 5 replicas:

```text
pod-1 starts -> tries Flyway migration
pod-2 starts -> tries Flyway migration
pod-3 starts -> tries Flyway migration
pod-4 starts -> tries Flyway migration
pod-5 starts -> tries Flyway migration
```

Flyway uses locking/history mechanisms, but the deployment model is still noisy:

- many pods attempt migration
- startup may block
- failed migration can crash all pods
- deployment becomes harder to reason about
- app credential may need DDL permission

For production-grade systems, prefer:

```text
Kubernetes Job / CI migration step runs first
then application deployment starts with Flyway disabled or validate-only pattern
```

### 10.3 Spring Boot Production Patterns

#### Pattern A — Simple App Startup Migration

```yaml
spring:
  flyway:
    enabled: true
```

Good for:

- small app
- internal tool
- non-critical system
- local/dev

Risky for:

- large cluster
- strict production control
- multi-service shared DB
- regulated environments

#### Pattern B — External Migration, App Does Not Run Flyway

```yaml
spring:
  flyway:
    enabled: false
```

Migration runs in CI/CD before deploy.

Good for:

- production
- Kubernetes
- regulated systems
- separate DB credential

But app no longer automatically validates DB state unless you add your own check.

#### Pattern C — External Migration + App Validation

Boot does not provide a universal “validate only then continue” switch as the default migration behavior, but you can implement controlled validation using a custom startup check or direct Flyway bean strategy.

Example conceptual approach:

```java
@Bean
ApplicationRunner validateDatabase(Flyway flyway) {
    return args -> flyway.validate();
}
```

But be careful: if Boot auto-migration is enabled, `migrate()` may already have run. For validation-only, you need explicit configuration and bean control.

### 10.4 Avoid Mixing `schema.sql`, `data.sql`, Hibernate DDL, and Flyway

Bad setup:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: update
  sql:
    init:
      mode: always
  flyway:
    enabled: true
```

This creates multiple schema owners:

```text
Hibernate auto-DDL changes schema
Spring SQL init inserts/creates data
Flyway changes schema
```

That destroys migration determinism.

Recommended serious setup:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
  sql:
    init:
      mode: never
  flyway:
    enabled: true
```

Or in production external migration mode:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
  sql:
    init:
      mode: never
  flyway:
    enabled: false
```

---

## 11. Plain Java Setup

Flyway can be run directly from Java code.

```java
import org.flywaydb.core.Flyway;

public class DatabaseMigrator {
    public static void main(String[] args) {
        Flyway flyway = Flyway.configure()
                .dataSource(
                        System.getenv("DB_URL"),
                        System.getenv("DB_USER"),
                        System.getenv("DB_PASSWORD")
                )
                .locations("classpath:db/migration")
                .table("flyway_schema_history")
                .validateMigrationNaming(true)
                .load();

        flyway.migrate();
    }
}
```

### 11.1 When Plain Java Runner Is Useful

Useful when:

- you do not use Spring
- you want a custom migration command
- you want migration inside deployment tooling
- you need custom logging/security bootstrap
- you want a reusable internal migration launcher

### 11.2 Be Careful with Classpath

If using classpath migration:

```java
.locations("classpath:db/migration")
```

Then migration files must be packaged into the artifact.

If using filesystem migration:

```java
.locations("filesystem:/opt/app/migrations")
```

Then deployment must mount/copy migration files to that path.

### 11.3 Plain Java Runner Pattern

```text
migration-runner.jar
  contains:
    - Flyway dependency
    - JDBC driver
    - migration scripts
    - small main method
```

Run:

```bash
java -jar migration-runner.jar migrate
```

This is a useful enterprise pattern:

```text
app.jar              -> runs business app
migration-runner.jar -> runs DB migration
```

Both built from same commit, but executed separately.

---

## 12. Jakarta EE / App Server Setup

For Jakarta EE, avoid letting every application server node run migration casually.

Possible approaches:

### 12.1 External CLI Before Deployment

```text
1. Run Flyway CLI against target DB
2. Validate success
3. Deploy WAR/EAR to application server
```

This is usually best.

### 12.2 ServletContextListener

```java
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;
import org.flywaydb.core.Flyway;

@WebListener
public class FlywayMigrationListener implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        Flyway flyway = Flyway.configure()
                .dataSource(
                        System.getenv("DB_URL"),
                        System.getenv("DB_USER"),
                        System.getenv("DB_PASSWORD")
                )
                .locations("classpath:db/migration")
                .load();

        flyway.migrate();
    }
}
```

This is simple but risky in clustered app servers.

### 12.3 CDI Startup Observer

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.spi.AfterDeploymentValidation;
import org.flywaydb.core.Flyway;

@ApplicationScoped
public class MigrationBootstrap {
    public void migrate(@Observes AfterDeploymentValidation event) {
        Flyway flyway = Flyway.configure()
                .dataSource(
                        System.getenv("DB_URL"),
                        System.getenv("DB_USER"),
                        System.getenv("DB_PASSWORD")
                )
                .load();

        flyway.migrate();
    }
}
```

Again: acceptable for dev/simple deployment, risky for production clusters.

### 12.4 JNDI Datasource Concern

In app servers, datasource often comes from JNDI:

```text
java:comp/env/jdbc/AppDataSource
```

You can pass a `DataSource` object to Flyway:

```java
Flyway flyway = Flyway.configure()
        .dataSource(appDataSource)
        .locations("classpath:db/migration")
        .load();
```

But ask:

```text
Does this datasource user have DDL permission?
Should it?
```

In strict environments, app datasource should not have DDL permission.

---

## 13. Multi Datasource Setup

Many enterprise Java applications have multiple datasources:

```text
main datasource
reporting datasource
audit datasource
integration datasource
```

Flyway must be configured per datasource.

### 13.1 Spring Boot Multi Datasource Concept

```text
DataSource mainDataSource  -> Flyway mainFlyway  -> db/migration/main
DataSource auditDataSource -> Flyway auditFlyway -> db/migration/audit
```

Pseudo-code:

```java
@Bean
Flyway mainFlyway(@Qualifier("mainDataSource") DataSource ds) {
    return Flyway.configure()
            .dataSource(ds)
            .locations("classpath:db/migration/main")
            .table("flyway_schema_history")
            .load();
}

@Bean
Flyway auditFlyway(@Qualifier("auditDataSource") DataSource ds) {
    return Flyway.configure()
            .dataSource(ds)
            .locations("classpath:db/migration/audit")
            .table("flyway_schema_history")
            .load();
}
```

Execution must be explicit:

```java
@Bean
ApplicationRunner migrateDatabases(Flyway mainFlyway, Flyway auditFlyway) {
    return args -> {
        mainFlyway.migrate();
        auditFlyway.migrate();
    };
}
```

### 13.2 Ordering Between Datasources

If datasource B depends on datasource A:

```text
main schema must exist before audit triggers reference it
```

Then migration order matters.

Document it:

```text
1. main
2. audit
3. reporting
```

Do not rely on bean initialization order accidentally.

---

## 14. Multi Schema Setup

Some databases use multiple schemas in one database:

```text
app_core
app_audit
app_reporting
```

Flyway has schema-related settings:

```properties
flyway.schemas=app_core,app_audit,app_reporting
flyway.defaultSchema=app_core
```

Important distinction:

```text
schemas       : schemas managed/created by Flyway depending on config
defaultSchema : default schema used for history table and unqualified objects
```

### 14.1 One History Table or Many?

Option A: one history table for all schemas.

```text
app_core.flyway_schema_history
```

Pros:

- one migration sequence
- easy audit
- simple ordering

Cons:

- all schema changes coupled

Option B: one history table per schema.

```text
app_core.flyway_schema_history
app_audit.flyway_schema_history
app_reporting.flyway_schema_history
```

Pros:

- independent schema ownership

Cons:

- ordering across schemas harder
- more operational complexity

Rule:

```text
If schemas are deployed together as one application contract, one history table is simpler.
If schemas are owned by different services/teams, separate histories may be justified.
```

---

## 15. Secrets Handling

Flyway needs credentials. Credentials are not a detail; they define your security model.

### 15.1 Separate App User and Migration User

Recommended:

```text
app_user:
  SELECT, INSERT, UPDATE, DELETE on runtime tables
  no DDL

migration_user:
  CREATE, ALTER, DROP, INDEX, CONSTRAINT, etc.
  used only during deployment
```

Why?

If application runtime is compromised, attacker cannot casually alter schema.

### 15.2 Local Secrets

Local `.env`:

```bash
DB_URL=jdbc:postgresql://localhost:5432/app
DB_USER=app_migration
DB_PASSWORD=localpass
```

Do not commit `.env`.

### 15.3 CI Secrets

Use CI secret store:

```text
GitHub Actions Secrets
GitLab CI Variables
Jenkins Credentials
Azure DevOps Variable Group
AWS Secrets Manager
AWS SSM Parameter Store
Vault
```

Inject at runtime:

```bash
flyway \
  -url="$DB_URL" \
  -user="$DB_USER" \
  -password="$DB_PASSWORD" \
  migrate
```

### 15.4 Kubernetes Secrets

Kubernetes Job example:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: app-db-migration
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: flyway
          image: flyway/flyway:12.6.1
          args: ["migrate"]
          env:
            - name: FLYWAY_URL
              valueFrom:
                secretKeyRef:
                  name: app-db-migration-secret
                  key: url
            - name: FLYWAY_USER
              valueFrom:
                secretKeyRef:
                  name: app-db-migration-secret
                  key: username
            - name: FLYWAY_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: app-db-migration-secret
                  key: password
          volumeMounts:
            - name: migrations
              mountPath: /flyway/sql
      volumes:
        - name: migrations
          configMap:
            name: app-db-migrations
```

In real production, migration files are often baked into an immutable image rather than ConfigMap.

Better:

```text
migration image = flyway base + migration SQL copied in
```

---

## 16. Migration Artifact Strategy

A common maturity jump:

```text
Beginner: migration files are just resources in app jar.
Advanced: migration files are release artifact.
```

### 16.1 App Jar Contains Migration

```text
app.jar
  BOOT-INF/classes/db/migration/V1__init.sql
```

Pros:

- easy
- code and migration stay together

Cons:

- app artifact also becomes migration artifact
- production migration tied to app startup or classpath extraction

### 16.2 Separate Migration Artifact

```text
app-service-1.8.0.jar
app-service-db-migration-1.8.0.zip
```

Or:

```text
registry.example.com/app-service:1.8.0
registry.example.com/app-service-db-migration:1.8.0
```

Pros:

- clear operational separation
- migration can run before app deploy
- DDL credential only available to migration runner
- easier approval evidence

Cons:

- more pipeline complexity

### 16.3 Recommended for Enterprise

```text
Build once:
  - app image
  - migration image

Deploy sequence:
  1. run migration image as job
  2. validate migration success
  3. deploy app image
```

---

## 17. Local Development Workflow

Local workflow should be easy, or developers will bypass it.

### 17.1 Docker Compose Example

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app_migration
      POSTGRES_PASSWORD: localpass
    ports:
      - "5432:5432"
```

Run:

```bash
docker compose up -d
./gradlew flywayMigrate
./gradlew bootRun
```

### 17.2 Makefile

```makefile
DB_URL=jdbc:postgresql://localhost:5432/app
DB_USER=app_migration
DB_PASSWORD=localpass

.PHONY: db-up migrate info clean-db

db-up:
	docker compose up -d postgres

migrate:
	DB_URL=$(DB_URL) DB_USER=$(DB_USER) DB_PASSWORD=$(DB_PASSWORD) ./gradlew flywayMigrate

info:
	DB_URL=$(DB_URL) DB_USER=$(DB_USER) DB_PASSWORD=$(DB_PASSWORD) ./gradlew flywayInfo
```

### 17.3 Developer Rules

A healthy local workflow:

```text
1. Pull latest main.
2. Start local DB.
3. Run migration.
4. Start app.
5. Create new migration for DB changes.
6. Never manually mutate local DB without migration unless experimenting.
7. Before PR, rebuild from empty DB and migrate successfully.
```

---

## 18. CI Validation Workflow

Minimum CI should run:

```text
1. Validate migration naming.
2. Start real database container.
3. Run Flyway migrate from empty database.
4. Run application tests.
5. Optional: migrate from previous release snapshot.
```

### 18.1 Example CI Flow

```yaml
steps:
  - checkout
  - setup-java
  - start-postgres
  - run: ./gradlew flywayValidate
  - run: ./gradlew flywayMigrate
  - run: ./gradlew test
```

### 18.2 Empty DB Test Is Not Enough

This catches:

- SQL syntax errors
- ordering errors
- missing object errors in clean database

But it does not catch:

- upgrade from production-like previous schema
- data migration failures
- lock problems
- large table performance issues
- production drift

Advanced CI adds:

```text
restore previous release schema/data sample
run new migrations
run validation queries
run app compatibility tests
```

---

## 19. Production Deployment Topologies

### 19.1 Topology A — App Startup Migration

```text
Deploy app
  -> app starts
  -> Flyway migrate
  -> app ready
```

Use for:

- small internal systems
- dev/test
- low-risk services

Avoid for:

- high availability cluster
- heavy DDL
- regulated production
- multi-service DB

### 19.2 Topology B — Pipeline Migration Before App Deploy

```text
CI/CD pipeline
  -> run Flyway migrate
  -> verify schema version
  -> deploy app
```

This is the most common production-grade pattern.

### 19.3 Topology C — Kubernetes Migration Job

```text
helm upgrade / deploy pipeline
  -> create migration job
  -> wait for success
  -> rollout deployment
```

Good for Kubernetes.

Caution:

- migration job must be idempotent at orchestration level
- job should not run uncontrolled on every pod restart
- credentials must be scoped
- image version must be pinned

### 19.4 Topology D — DBA-Controlled Execution

```text
Dev team produces migration SQL
DBA reviews
DBA/Flyway runner executes
App deploy follows
```

Common in government/finance/regulated systems.

Risk:

- manual editing by DBA can cause checksum mismatch
- executed SQL may differ from repository
- approval process can drift from actual artifact

Mitigation:

```text
DBA executes the same immutable artifact, not copied SQL from email.
```

---

## 20. Configuration Properties You Should Decide Early

### 20.1 `locations`

```properties
flyway.locations=classpath:db/migration
```

or:

```properties
flyway.locations=filesystem:/opt/migrations
```

Decision:

```text
classpath = migration packaged with app/runner
filesystem = migration mounted/copied externally
```

### 20.2 `table`

```properties
flyway.table=flyway_schema_history
```

Usually keep default unless:

- multiple Flyway histories in one schema
- organization naming standard
- legacy history table exists

### 20.3 `schemas` and `defaultSchema`

```properties
flyway.schemas=app_core,app_audit
flyway.defaultSchema=app_core
```

Important for multi-schema DB.

### 20.4 `baselineOnMigrate`

```properties
flyway.baselineOnMigrate=false
```

Keep false by default.

Only enable intentionally for existing database onboarding.

Danger:

```text
If accidentally pointed to wrong non-empty database, Flyway may baseline instead of failing.
```

### 20.5 `outOfOrder`

```properties
flyway.outOfOrder=false
```

Keep false by default.

Enable only with strong branch/release governance.

### 20.6 `validateOnMigrate`

```properties
flyway.validateOnMigrate=true
```

Keep true.

This protects against checksum drift and missing migrations.

### 20.7 `cleanDisabled`

```properties
flyway.cleanDisabled=true
```

In production, `clean` must be disabled.

For local dev, you may allow clean only explicitly.

---

## 21. Database Driver Management

Flyway needs JDBC driver.

Application dependency mode:

```text
app has JDBC driver
Flyway uses app classpath
```

Plugin/CLI mode:

```text
runner must have JDBC driver
```

### 21.1 Maven Plugin Driver

```xml
<dependencies>
  <dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <version>${postgresql.version}</version>
  </dependency>
</dependencies>
```

### 21.2 Oracle Driver Concern

For Oracle:

```text
ojdbc8  -> common for Java 8/11 era
ojdbc11 -> common for newer Java versions
```

Check driver/database compatibility. Do not assume latest driver is valid for all app server policies.

### 21.3 H2 Trap

Bad CI strategy:

```text
Production DB: PostgreSQL/Oracle
Migration test DB: H2
```

This misses vendor-specific DDL behavior.

Better:

```text
Use Testcontainers or real database engine image.
```

---

## 22. Java-Based Migration Setup Concern

If you use Java-based migrations:

```text
V2026_01_001__BackfillCustomerNormalizedName.java
```

Then runtime compatibility matters more.

A SQL-only migration can run from external Java 21 runner even if app is Java 8.

But Java-based migration may depend on:

- application classes
- compiled bytecode target
- domain logic
- serialization classes
- encryption library
- old DTOs/entities

This can create a time bomb.

### 22.1 Recommended Rule

```text
Prefer SQL migration for schema/reference data.
Use Java migration only for complex deterministic data transformation.
Keep Java migration self-contained.
Do not depend on mutable application service logic.
```

Bad:

```java
customerService.recalculateAllStatuses();
```

Better:

```java
try (PreparedStatement ps = connection.prepareStatement(...)) {
    // deterministic backfill logic here
}
```

---

## 23. Environment Configuration Model

### 23.1 What Should Differ by Environment?

Allowed to differ:

```text
DB URL
username
password
schema name sometimes
timeout sometimes
placeholder values for environment-specific integration IDs, with caution
```

Should not differ:

```text
migration files
migration ordering
core schema definitions
production reference data semantics
constraint definitions
```

### 23.2 Environment-Specific Migration Anti-Pattern

Bad:

```text
db/migration/dev/V1__init.sql
db/migration/uat/V1__init.sql
db/migration/prod/V1__init.sql
```

This means dev, UAT, and prod are not proving the same artifact.

Better:

```text
db/migration/V2026.01.001__create_tables.sql
```

Use placeholders only where truly necessary:

```sql
insert into app_config(config_key, config_value)
values ('external_base_url', '${externalBaseUrl}');
```

But be careful: placeholder-driven seed data can hide environment drift.

---

## 24. Setup Checklist

Before adopting Flyway, answer these questions.

### 24.1 Architecture Checklist

```text
[ ] Will Flyway run inside application or externally?
[ ] Who owns migration files?
[ ] Is there one schema or multiple schemas?
[ ] Is database shared by multiple services?
[ ] Is production migration allowed from app startup?
[ ] Does app user have DDL permission? Should it?
[ ] Do we need DBA approval?
[ ] Do we need rollback or roll-forward policy?
```

### 24.2 Technical Checklist

```text
[ ] Java version identified.
[ ] Flyway version pinned.
[ ] JDBC driver version pinned.
[ ] Migration location decided.
[ ] Naming convention decided.
[ ] History table name decided.
[ ] baselineOnMigrate disabled by default.
[ ] clean disabled in production.
[ ] validateOnMigrate enabled.
[ ] outOfOrder disabled unless explicitly needed.
```

### 24.3 Pipeline Checklist

```text
[ ] Migration validation runs in CI.
[ ] Empty DB migration test exists.
[ ] Previous-release upgrade test planned.
[ ] Migration artifact is immutable.
[ ] Secrets come from secret manager/CI variables.
[ ] Production migration logs are retained.
[ ] Deployment can stop if migration fails.
```

---

## 25. Recommended Setup Patterns by Scenario

### 25.1 Small Spring Boot Service

```text
Use:
  - Flyway dependency in app
  - classpath:db/migration
  - app startup migration
  - ddl-auto=validate

Avoid:
  - schema.sql/data.sql
  - Hibernate ddl-auto=update
```

### 25.2 Enterprise Spring Boot Service on Kubernetes

```text
Use:
  - separate migration image/job
  - Flyway disabled in app production profile
  - app uses ddl-auto=validate or custom DB compatibility check
  - migration user separate from app user
  - migration job runs before rollout
```

### 25.3 Java 8 Legacy App

```text
Use:
  - external Flyway CLI/container if latest Flyway cannot run inside app
  - SQL-only migrations when possible
  - migration artifact independent from app runtime
  - careful baseline of existing DB
```

### 25.4 Jakarta EE Cluster

```text
Use:
  - external migration before WAR/EAR deployment
  - no migration from every app server node
  - app datasource without DDL permission
```

### 25.5 Multi-Service Shared Database

```text
Use:
  - central migration ownership or strict per-schema ownership
  - backward-compatible migrations
  - expand/contract pattern
  - avoid service startup migrations racing against same DB
```

---

## 26. Common Setup Mistakes

### Mistake 1 — Letting Hibernate and Flyway Both Own Schema

```yaml
spring.jpa.hibernate.ddl-auto: update
spring.flyway.enabled: true
```

This creates hidden schema changes outside Flyway history.

Use:

```yaml
spring.jpa.hibernate.ddl-auto: validate
```

### Mistake 2 — Running Migration from Every Replica

Works until it does not.

Use a migration job for production clusters.

### Mistake 3 — Using App User for DDL

App user should usually not be able to alter/drop schema.

### Mistake 4 — Not Pinning Flyway Version

Bad:

```text
flyway/flyway:latest
```

Good:

```text
flyway/flyway:12.6.1
```

### Mistake 5 — Environment-Specific Migration Files

If dev and prod run different migration files, dev is not a rehearsal for prod.

### Mistake 6 — No Empty DB Test

If a new developer cannot build DB from scratch, migration history is already broken.

### Mistake 7 — No Upgrade Test

If CI only tests fresh DB, you do not know whether production can upgrade.

### Mistake 8 — Java Migration Depends on Current App Logic

Migration must remain executable in the future. Current service logic changes over time.

---

## 27. A Reference Production-Grade Setup

Here is a strong baseline architecture.

```text
repository
  app/
    src/main/java/...
  db-migration/
    Dockerfile
    conf/
      base.conf
    sql/
      V2026.01.001__create_customer_table.sql
      V2026.01.002__add_customer_status.sql
```

Migration Dockerfile:

```dockerfile
FROM flyway/flyway:12.6.1
COPY conf /flyway/conf
COPY sql /flyway/sql
```

Pipeline:

```text
1. Build app image: app:1.8.0
2. Build migration image: app-db-migration:1.8.0
3. Run migration image against staging DB
4. Run app integration tests
5. Approve production
6. Run migration image against production DB
7. Deploy app image
8. Verify app health and schema version
```

Production app config:

```yaml
spring:
  flyway:
    enabled: false
  jpa:
    hibernate:
      ddl-auto: validate
```

Migration job has:

```text
migration_user with DDL permission
```

App has:

```text
app_user without DDL permission
```

This separation is one of the clearest signs of mature migration engineering.

---

## 28. Minimal Local Example

### 28.1 Migration File

`src/main/resources/db/migration/V2026.01.001__create_customer_table.sql`

```sql
create table customer (
    id bigint generated always as identity primary key,
    customer_no varchar(64) not null,
    full_name varchar(255) not null,
    email varchar(255),
    status varchar(32) not null,
    created_at timestamp not null,
    updated_at timestamp not null,
    constraint uq_customer_customer_no unique (customer_no)
);
```

### 28.2 Spring Boot Config

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/app
    username: app_migration
    password: localpass

  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
    out-of-order: false
    baseline-on-migrate: false

  jpa:
    hibernate:
      ddl-auto: validate
```

### 28.3 Expected Startup

```text
Application starts
Flyway checks flyway_schema_history
Flyway sees V2026.01.001 pending
Flyway executes migration
Flyway records success and checksum
JPA validates entities against schema
Application starts serving traffic
```

---

## 29. Decision Tree

Use this decision tree.

```text
Is this production critical or regulated?
  yes -> external runner/job
  no  -> app startup acceptable

Is app Java 8 legacy?
  yes -> consider external Flyway runner
  no  -> app or external both possible

Is app deployed with multiple replicas?
  yes -> external migration job preferred
  no  -> startup migration possible

Does app user have DDL permission?
  yes -> reconsider security model
  no  -> external migration required

Is DB shared by multiple services?
  yes -> central/per-schema migration governance
  no  -> service-owned migration acceptable

Do you need DBA approval?
  yes -> immutable migration artifact + review workflow
  no  -> CI/CD-controlled migration sufficient
```

---

## 30. Summary

Flyway setup is not only dependency setup. It is a deployment architecture decision.

Key takeaways:

1. Flyway can run through Maven/Gradle, application runtime, CLI, Docker, or CI/CD.
2. Java 8–25 compatibility should be handled by separating app runtime from migration runner when needed.
3. Spring Boot startup migration is convenient, but production clusters often need external migration jobs.
4. Do not let Hibernate auto-DDL, `schema.sql`, `data.sql`, and Flyway all mutate schema.
5. Pin Flyway, JDBC driver, and container versions.
6. Use separate migration user and application user in serious systems.
7. Migration files should be immutable, reviewable, and environment-independent.
8. CI should test both fresh database creation and upgrade from previous release.
9. Production migration should be observable, auditable, and stoppable.
10. The more critical the system, the more migration should be treated as a first-class deployment artifact.

---

## 31. Practical Exercise

Design a Flyway setup for three scenarios:

### Scenario A

```text
Spring Boot 3.4
Java 21
PostgreSQL
single service
internal admin app
2 replicas
```

Questions:

```text
- app startup or external runner?
- classpath or filesystem migrations?
- app user or migration user?
- what should ddl-auto be?
```

### Scenario B

```text
Java 8 legacy WAR
Jakarta/Java EE app server
Oracle database
clustered deployment
DBA approval required
```

Questions:

```text
- should Flyway run inside WAR?
- how to handle Java compatibility?
- where should migration files live?
- who executes migration?
```

### Scenario C

```text
Microservices platform
Java 17/21
Kubernetes
shared PostgreSQL database
multiple schemas
regulated audit requirement
```

Questions:

```text
- one migration job or per-service jobs?
- one history table or multiple?
- how to avoid service race?
- how to prove migration artifact integrity?
```

---

## 32. References

- Redgate Flyway documentation and release notes. Flyway 12.x remains active with 2026 releases and supports CLI, Java, Maven, Gradle, Docker, and database migration workflows.
- Spring Boot Database Initialization documentation. Spring Boot can call `Flyway.migrate()` automatically and warns against mixing multiple initialization mechanisms in serious setups.
- Spring Boot Actuator Flyway endpoint documentation. Actuator can expose migration information for observability.
- Flyway GitHub repository. Flyway supports Java, Docker, Maven, and Gradle usage patterns.

---

## 33. What Comes Next

Part berikutnya:

```text
06-flyway-sql-migration-design.md
```

Kita akan membahas cara menulis SQL migration yang aman, readable, reviewable, dan production-grade: naming, atomicity, transactional DDL, delimiter, idempotency, vendor-specific SQL, placeholder, precondition manual pattern, dan style guide.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 4 — Flyway Mental Model](./04-flyway-mental-model.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 6 — Flyway SQL Migration Design](./06-flyway-sql-migration-design.md)

</div>