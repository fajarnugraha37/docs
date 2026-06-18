# Part 12 — Liquibase Setup in Java 8–25 Projects

> Series: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `12-liquibase-setup-java-8-to-25.md`  
> Scope: Java 8 sampai Java 25, Liquibase 4.x sampai 5.x, Maven, Gradle, CLI, Spring Boot, plain Java, Jakarta EE, container, dan CI/CD setup.

---

## 1. Tujuan Bagian Ini

Bagian sebelumnya membahas **mental model Liquibase**: changelog, changeset, identity, checksum, lock table, contexts, labels, preconditions, dan rollback.

Bagian ini masuk ke setup praktis.

Namun setup Liquibase tidak boleh dipahami sebagai “tambahkan dependency lalu jalan”. Dalam sistem production-grade, setup Liquibase menentukan:

1. apakah migration berjalan di runtime aplikasi atau pipeline,
2. apakah changelog dikemas bersama artifact aplikasi atau dipisahkan,
3. apakah migration user punya privilege yang tepat,
4. apakah Java runtime kompatibel dengan versi Liquibase,
5. apakah local/dev/test/prod menjalankan mekanisme yang sama,
6. apakah migration bisa diaudit dan direproduksi,
7. apakah deployment gagal cepat saat database tidak kompatibel,
8. apakah rollback/roll-forward bisa dilakukan secara terkontrol.

Dengan kata lain:

> Setup Liquibase adalah desain control plane untuk perubahan database.

---

## 2. Posisi Part Ini dalam Seri

Kita sudah melewati:

- Part 0: database change engineering,
- Part 1: taxonomy perubahan database,
- Part 2: invariants dan failure model,
- Part 3: database versioning,
- Part 4–10: Flyway,
- Part 11: Liquibase mental model.

Part 12 menjawab pertanyaan:

> “Bagaimana saya memasang Liquibase di project Java dari versi legacy sampai modern tanpa membuat setup yang rapuh?”

Yang **tidak** akan diulang:

- dasar JDBC,
- dasar JPA/Hibernate,
- dasar SQL,
- dasar Spring Boot,
- dasar Maven/Gradle.

Yang akan dibahas:

- compatibility matrix,
- dependency strategy,
- Spring Boot setup,
- plain Java setup,
- Jakarta EE setup,
- CLI setup,
- Maven/Gradle plugin setup,
- changelog layout,
- configuration model,
- environment handling,
- secrets handling,
- container/Kubernetes setup,
- CI/CD execution model,
- production guardrails.

---

## 3. Big Mental Model: Three Ways to Run Liquibase

Liquibase dapat dijalankan dengan tiga model utama.

```text
                 +----------------------+
                 |   Database Change    |
                 +----------+-----------+
                            |
          +-----------------+-----------------+
          |                 |                 |
          v                 v                 v
+----------------+ +----------------+ +----------------+
| App Startup    | | Build Tool     | | External CLI / |
| Integration    | | Plugin         | | Pipeline Job   |
+----------------+ +----------------+ +----------------+
| Spring Boot    | | Maven/Gradle   | | CLI, Docker,   |
| Plain Java     | | update, diff   | | K8s Job, CI/CD |
+----------------+ +----------------+ +----------------+
```

Ketiganya valid, tetapi cocok untuk konteks berbeda.

### 3.1 Application Startup Model

Liquibase berjalan saat aplikasi start.

Contoh:

- Spring Boot dengan `spring-boot-starter-liquibase`,
- plain Java memanggil Liquibase API saat bootstrap,
- Jakarta EE startup listener.

Kelebihan:

- sederhana,
- developer experience bagus,
- migration selalu dekat dengan aplikasi,
- cocok untuk service kecil/menengah,
- cocok untuk local development.

Risiko:

- beberapa pod/instance bisa start bersamaan,
- startup aplikasi bisa lama,
- deployment rollback aplikasi tidak otomatis rollback database,
- butuh permission migration di runtime environment,
- app user sering tergoda diberi DDL privilege,
- failure migration berarti aplikasi gagal start.

Cocok untuk:

- local dev,
- test environment,
- single-service app,
- internal apps,
- aplikasi dengan migration kecil dan cepat,
- organisasi yang belum punya pipeline DB terpisah.

Tidak ideal untuk:

- regulated production,
- migration besar,
- multi-service shared database,
- zero-downtime rollout kompleks,
- lingkungan dengan pemisahan DBA/app team ketat.

---

### 3.2 Build Tool Plugin Model

Liquibase dijalankan via Maven atau Gradle task.

Contoh:

```bash
mvn liquibase:update
```

atau:

```bash
gradle update
```

Kelebihan:

- mudah diintegrasikan dengan developer workflow,
- bagus untuk generate SQL, diff, validate,
- bisa dipakai di CI,
- tidak perlu aplikasi start.

Risiko:

- konfigurasi plugin bisa berbeda dari runtime aplikasi,
- classpath driver harus benar,
- credential handling sering tersebar,
- developer bisa menjalankan update ke target yang salah bila guardrail lemah.

Cocok untuk:

- local migration validation,
- CI dry-run,
- generate changelog/diff,
- release pipeline sederhana.

---

### 3.3 External CLI / Pipeline Job Model

Liquibase dijalankan sebagai proses terpisah.

Contoh:

```bash
liquibase update
```

atau container:

```bash
docker run --rm \
  -v "$PWD/db:/liquibase/changelog" \
  liquibase/liquibase update
```

atau Kubernetes Job:

```text
Deployment pipeline
        |
        v
+------------------+
| Liquibase Job    |
| migration user   |
+--------+---------+
         |
         v
+------------------+
| Database         |
+------------------+
         |
         v
+------------------+
| Application pods |
+------------------+
```

Kelebihan:

- migration dipisah dari app startup,
- privilege bisa dipisah,
- pipeline bisa punya approval gate,
- bagus untuk audit/compliance,
- cocok untuk production besar.

Risiko:

- butuh desain pipeline matang,
- butuh artifact migration yang immutable,
- butuh orchestration ordering,
- developer experience bisa lebih berat.

Cocok untuk:

- production regulated,
- enterprise deployment,
- multi-service architecture,
- migration besar,
- Kubernetes environment,
- organisasi dengan DBA/release manager.

---

## 4. Java Compatibility Strategy: Java 8 sampai Java 25

Ini bagian penting karena seri ini menargetkan Java 8–25.

Liquibase bukan hanya library Java; Liquibase juga sebuah tool yang berjalan di atas JVM. Maka compatibility harus dilihat dari dua sisi:

1. Java version aplikasi,
2. Java version Liquibase process.

Keduanya tidak harus selalu sama.

---

## 5. Liquibase 4.x vs 5.x: Practical Compatibility

Secara praktis:

```text
+-------------------+----------------------------+-----------------------------+
| Target Runtime    | Practical Liquibase Choice | Notes                       |
+-------------------+----------------------------+-----------------------------+
| Java 8            | Liquibase 4.x              | Liquibase 5.x needs Java 17+|
| Java 11           | Liquibase 4.x              | Good legacy choice          |
| Java 17           | Liquibase 4.x or 5.x       | Transition point            |
| Java 21           | Liquibase 4.x or 5.x       | Modern LTS                  |
| Java 25           | Prefer Liquibase 5.x       | Run tool on modern JVM      |
+-------------------+----------------------------+-----------------------------+
```

Important rule:

> Untuk aplikasi Java 8/11, jangan asal upgrade ke Liquibase 5.x di embedded runtime karena Liquibase 5.x membutuhkan Java 17+.

Tetapi:

> Aplikasi Java 8 masih bisa menggunakan migration yang dijalankan oleh external Liquibase CLI di Java 17+, selama changelog dan SQL kompatibel dengan database.

Ini membuka strategi hybrid.

---

## 6. Compatibility Scenarios

### 6.1 Legacy Java 8 Application with Embedded Liquibase

```text
Java app:       Java 8
Liquibase mode: embedded
Recommended:    Liquibase 4.x
```

Cocok bila:

- aplikasi legacy belum bisa naik Java,
- migration kecil,
- startup migration masih diterima,
- tidak ada pipeline DB khusus.

Risiko:

- dependency modern terbatas,
- security patch tool harus dipantau,
- upgrade path ke Liquibase 5.x butuh Java runtime upgrade.

---

### 6.2 Legacy Java 8 Application with External Liquibase

```text
Java app:       Java 8
Liquibase mode: external CLI/container
Liquibase JVM:  Java 17/21+
Recommended:    Liquibase 5.x possible
```

Ini sangat berguna untuk organisasi yang aplikasinya legacy tetapi ingin migration tooling modern.

```text
+-------------------+           +------------------+
| Java 8 App        |           | Liquibase CLI    |
| no embedded LB    |           | Java 17/21       |
+---------+---------+           +---------+--------+
          |                               |
          | uses DB                       | migrates DB
          v                               v
        +-----------------------------------+
        | Database                          |
        +-----------------------------------+
```

Kelebihan:

- aplikasi tidak perlu membawa dependency Liquibase,
- migration user bisa dipisah,
- bisa menjalankan Liquibase modern,
- cocok untuk production.

Trade-off:

- pipeline lebih kompleks,
- local workflow perlu disepakati,
- app startup tidak otomatis migrate.

---

### 6.3 Java 17/21/25 Modern Application

```text
Java app:       Java 17/21/25
Liquibase mode: embedded or external
Recommended:    Liquibase 5.x or latest compatible 4.x if needed
```

Cocok untuk:

- Spring Boot 3/4,
- Jakarta EE modern,
- containerized app,
- CI/CD matang.

Decision point:

- embedded untuk simplicity,
- external job untuk production governance.

---

## 7. Recommended Setup Matrix

```text
+---------------------------+-----------------------+---------------------------+
| Context                   | Recommended Setup     | Reason                    |
+---------------------------+-----------------------+---------------------------+
| Local dev simple app      | Spring Boot embedded  | Fast feedback             |
| Local dev enterprise app  | CLI or Gradle/Maven   | Similar to pipeline       |
| Unit/integration test     | Embedded or test task | Disposable DB             |
| CI validate               | Maven/Gradle/CLI      | Fail fast                 |
| CI dry-run SQL            | CLI/Maven/Gradle      | Review artifact           |
| Dev/SIT environment       | Pipeline or startup   | Depends maturity          |
| UAT/Staging               | Pipeline job          | Better audit              |
| Production regulated      | External job          | Privilege + approval      |
| Multi-service DB          | External orchestrated | Avoid startup race        |
| Multi-tenant migration    | Dedicated runner      | Tenant control            |
+---------------------------+-----------------------+---------------------------+
```

---

## 8. Core Liquibase Artifacts

Sebuah setup Liquibase biasanya punya artifact berikut:

```text
project-root/
  src/
    main/
      resources/
        db/
          changelog/
            db.changelog-master.yaml
            releases/
              2026-06-17-release-001.yaml
            sql/
              001-create-user-table.sql
  pom.xml / build.gradle
```

Atau untuk external migration repository:

```text
database-migrations/
  changelog/
    db.changelog-master.yaml
    modules/
      identity/
      billing/
      compliance/
    releases/
      2026-q2/
  config/
    liquibase.dev.properties
    liquibase.uat.properties
    liquibase.prod.template.properties
  scripts/
    validate.sh
    update-sql.sh
    update.sh
```

Artifact penting:

1. master changelog,
2. included changelog,
3. SQL files bila SQL-first,
4. property file,
5. driver dependency,
6. pipeline scripts,
7. generated SQL output,
8. audit logs.

---

## 9. Changelog Location Convention

Default convention yang umum di Spring Boot:

```text
classpath:/db/changelog/db.changelog-master.yaml
```

Struktur minimal:

```text
src/main/resources/db/changelog/db.changelog-master.yaml
```

Contoh:

```yaml
databaseChangeLog:
  - changeSet:
      id: 001-create-app-user
      author: fajar
      changes:
        - createTable:
            tableName: app_user
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: username
                  type: varchar(100)
                  constraints:
                    nullable: false
```

Namun untuk seri advance, kita tidak akan berhenti di struktur minimal.

Untuk project besar, lebih baik:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  releases/
    2026-06-17/
      001-identity.yaml
      002-permission-seed.yaml
      003-case-indexes.yaml
  modules/
    identity/
    case-management/
    audit/
  sql/
    identity/
    case-management/
```

Prinsip:

> Master changelog harus menjadi daftar orkestrasi, bukan tempat menumpuk semua perubahan.

---

## 10. Setup with Spring Boot

Spring Boot adalah integration path paling umum.

### 10.1 Maven Dependency

Untuk Spring Boot:

```xml
<dependency>
    <groupId>org.liquibase</groupId>
    <artifactId>liquibase-core</artifactId>
</dependency>
```

Jika memakai Spring Boot starter:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-liquibase</artifactId>
</dependency>
```

Dan database driver:

```xml
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
```

Atau Oracle:

```xml
<dependency>
    <groupId>com.oracle.database.jdbc</groupId>
    <artifactId>ojdbc11</artifactId>
    <scope>runtime</scope>
</dependency>
```

Catatan:

- gunakan driver sesuai Java runtime,
- `ojdbc8` untuk banyak kasus Java 8/11,
- `ojdbc11` untuk Java 11+ modern,
- jangan memasukkan semua driver database kalau aplikasi hanya memakai satu engine.

---

### 10.2 Gradle Dependency

Groovy DSL:

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-liquibase'
    runtimeOnly 'org.postgresql:postgresql'
}
```

Kotlin DSL:

```kotlin
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-liquibase")
    runtimeOnly("org.postgresql:postgresql")
}
```

---

### 10.3 Spring Boot Configuration

`application.yml`:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/appdb
    username: app_user
    password: app_password

  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml
    default-schema: public
    contexts: local
```

Untuk production:

```yaml
spring:
  liquibase:
    enabled: false
```

Lalu migration dijalankan oleh pipeline external.

Prinsip penting:

> Jangan merasa semua environment harus menjalankan Liquibase dengan cara yang sama di dalam aplikasi. Yang harus sama adalah changelog artifact dan urutan change. Execution model boleh berbeda berdasarkan risiko environment.

---

### 10.4 Spring Boot Startup Ordering

Saat Liquibase enabled, migration berjalan saat aplikasi bootstrap sebelum aplikasi dianggap siap.

Secara mental:

```text
Application starts
   |
   v
Create DataSource
   |
   v
Run Liquibase
   |
   +--> success --> continue app initialization
   |
   +--> failure --> fail startup
```

Ini bagus karena aplikasi tidak berjalan di atas schema lama.

Namun di Kubernetes:

```text
ReplicaSet starts 5 pods
   |
   +--> Pod A tries Liquibase
   +--> Pod B tries Liquibase
   +--> Pod C tries Liquibase
   +--> Pod D tries Liquibase
   +--> Pod E tries Liquibase
```

Liquibase memakai lock table, sehingga hanya satu yang akan menjalankan migration. Tetapi tetap ada risiko:

- pod lain menunggu,
- startup timeout,
- readiness delay,
- crash loop bila migration lama,
- resource contention saat rollout.

Untuk production dengan banyak replica, external migration job sering lebih bersih.

---

## 11. Do Not Mix `ddl-auto`, `schema.sql`, `data.sql`, and Liquibase Carelessly

Dalam project serius:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
```

atau:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: none
```

Hindari:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: update
```

untuk production.

Kenapa?

`ddl-auto=update` membuat Hibernate mengubah schema berdasarkan entity model. Ini berbahaya karena:

- tidak punya reviewable migration file,
- tidak cocok untuk multi-environment audit,
- tidak eksplisit soal data migration,
- tidak mengelola index/constraint kompleks secara mature,
- tidak cocok untuk rollback/roll-forward governance,
- bisa menghasilkan drift antara environment.

Hindari juga mencampur:

```text
schema.sql
 data.sql
 Liquibase changelog
```

sebagai mekanisme schema/data utama yang berjalan bersamaan.

Pattern yang lebih bersih:

```text
Schema lifecycle      -> Liquibase
Reference seed        -> Liquibase, carefully versioned
Test fixture          -> test-only fixture mechanism
JPA ddl-auto          -> validate/none
schema.sql/data.sql   -> disabled or test-only
```

---

## 12. Spring Boot Multi-Profile Setup

Contoh profile-based config:

```yaml
# application-local.yml
spring:
  liquibase:
    enabled: true
    contexts: local
```

```yaml
# application-test.yml
spring:
  liquibase:
    enabled: true
    contexts: test
```

```yaml
# application-prod.yml
spring:
  liquibase:
    enabled: false
```

Interpretasi:

- local: aplikasi menjalankan Liquibase agar developer cepat,
- test: integration test memakai Liquibase agar schema realistis,
- prod: pipeline job menjalankan Liquibase sebelum deployment aplikasi.

Namun hati-hati:

> Jika production memakai external Liquibase, CI harus membuktikan bahwa changelog yang sama kompatibel dengan artifact aplikasi.

Jangan membuat local migration berbeda dari production migration.

---

## 13. Using Liquibase with Multiple DataSources in Spring Boot

Dalam aplikasi enterprise, sering ada lebih dari satu datasource:

```text
Application
  |-- primary datasource      -> app schema
  |-- audit datasource        -> audit schema
  |-- reporting datasource    -> reporting schema
```

Spring Boot auto-configuration mudah untuk satu datasource. Untuk multiple datasource, biasanya perlu mendefinisikan `SpringLiquibase` bean manual.

Contoh konseptual:

```java
@Bean
public SpringLiquibase appLiquibase(@Qualifier("appDataSource") DataSource dataSource) {
    SpringLiquibase liquibase = new SpringLiquibase();
    liquibase.setDataSource(dataSource);
    liquibase.setChangeLog("classpath:/db/changelog/app/db.changelog-master.yaml");
    liquibase.setContexts("local,app");
    liquibase.setDefaultSchema("app_schema");
    return liquibase;
}

@Bean
public SpringLiquibase auditLiquibase(@Qualifier("auditDataSource") DataSource dataSource) {
    SpringLiquibase liquibase = new SpringLiquibase();
    liquibase.setDataSource(dataSource);
    liquibase.setChangeLog("classpath:/db/changelog/audit/db.changelog-master.yaml");
    liquibase.setContexts("local,audit");
    liquibase.setDefaultSchema("audit_schema");
    return liquibase;
}
```

Risk model:

- satu datasource berhasil migrate, yang lain gagal,
- aplikasi start partial tidak boleh terjadi,
- ordering antar datasource harus jelas,
- rollback lebih kompleks.

Untuk production, multiple datasource migration sering lebih aman dijalankan sebagai pipeline steps eksplisit.

---

## 14. Plain Java Setup

Tidak semua sistem Java memakai Spring Boot.

Plain Java setup berguna untuk:

- CLI internal,
- migration runner khusus,
- legacy Java app,
- batch application,
- embedded server,
- test harness.

Contoh conceptual Java API:

```java
import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;

import java.sql.Connection;
import java.sql.DriverManager;

public final class LiquibaseRunner {

    public static void main(String[] args) throws Exception {
        String url = System.getenv("DB_URL");
        String username = System.getenv("DB_USERNAME");
        String password = System.getenv("DB_PASSWORD");

        try (Connection connection = DriverManager.getConnection(url, username, password)) {
            Database database = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));

            try (Liquibase liquibase = new Liquibase(
                    "db/changelog/db.changelog-master.yaml",
                    new ClassLoaderResourceAccessor(),
                    database
            )) {
                liquibase.update(new Contexts("prod"), new LabelExpression());
            }
        }
    }
}
```

Catatan:

- detail API bisa berubah antar versi,
- selalu pin dependency Liquibase,
- jangan membuat runner yang diam-diam memilih environment,
- log target database sebelum update,
- minta explicit confirmation untuk production jika runner manual.

---

## 15. Plain Java Runner Guardrails

Migration runner internal harus memiliki guardrails:

```text
Startup
  |
  v
Read config
  |
  v
Validate target environment
  |
  v
Print database identity
  |
  v
Validate changelog
  |
  v
Optionally generate update SQL
  |
  v
Require explicit approval for prod
  |
  v
Run update
  |
  v
Print applied changesets
```

Minimal guardrail:

```java
private static void assertNotAccidentalProduction(String env, String url) {
    if ("prod".equalsIgnoreCase(env)) {
        String approval = System.getenv("APPROVE_PROD_MIGRATION");
        if (!"YES_I_UNDERSTAND".equals(approval)) {
            throw new IllegalStateException("Production migration approval is missing");
        }
    }

    if (url == null || url.contains("localhost")) {
        return;
    }

    System.out.println("Target DB URL: " + mask(url));
}
```

Prinsip:

> Migration runner harus sulit disalahgunakan, bukan hanya mudah digunakan.

---

## 16. Jakarta EE Setup

Pada Jakarta EE, setup Liquibase bisa dilakukan dengan beberapa pendekatan.

### 16.1 External Migration Before Deployment

Ini paling bersih untuk production.

```text
Pipeline
  |
  v
Liquibase update
  |
  v
Deploy WAR/EAR
```

Kelebihan:

- tidak tergantung app server lifecycle,
- classloader lebih sederhana,
- migration user bisa dipisah,
- mudah diaudit.

Direkomendasikan untuk production.

---

### 16.2 ServletContextListener

```java
public class LiquibaseStartupListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        // Run Liquibase here
    }
}
```

Risiko:

- migration terjadi saat web app init,
- bisa timeout,
- multiple node race,
- sulit dipisahkan dari app deployment,
- classloader issues.

Cocok untuk:

- dev/test,
- small internal app,
- legacy app tanpa pipeline.

---

### 16.3 CDI Startup Observer

```java
@ApplicationScoped
public class MigrationBootstrap {

    public void onStart(@Observes @Initialized(ApplicationScoped.class) Object event) {
        // Run Liquibase
    }
}
```

Catatan:

- pastikan datasource tersedia,
- pastikan tidak berjalan di setiap module tanpa kontrol,
- pastikan failure membuat deployment gagal jelas.

---

### 16.4 EJB Singleton Startup

```java
@Singleton
@Startup
public class MigrationStartupBean {

    @PostConstruct
    public void migrate() {
        // Run Liquibase
    }
}
```

Risk model mirip:

- app server lifecycle dependent,
- clustered deployment harus hati-hati,
- lock table membantu tetapi bukan solusi semua rollout problem.

---

## 17. CDI Module Support Caveat

Pada Liquibase versi modern tertentu, beberapa integration module lama dapat berubah status atau dihapus. Karena itu, untuk Jakarta EE modern, jangan terlalu bergantung pada integration module spesifik bila tidak diperlukan.

Lebih stabil:

```text
Option A: external CLI/pipeline
Option B: custom plain Java runner with datasource
Option C: app startup hook carefully controlled
```

Prinsip:

> Untuk production Jakarta EE, treat Liquibase sebagai release step, bukan magic component app server.

---

## 18. Maven Plugin Setup

Maven plugin berguna untuk:

- update local database,
- validate changelog,
- generate update SQL,
- generate rollback SQL,
- diff,
- CI task.

Contoh minimal:

```xml
<plugin>
    <groupId>org.liquibase</groupId>
    <artifactId>liquibase-maven-plugin</artifactId>
    <version>${liquibase.version}</version>
    <configuration>
        <changeLogFile>src/main/resources/db/changelog/db.changelog-master.yaml</changeLogFile>
        <url>${db.url}</url>
        <username>${db.username}</username>
        <password>${db.password}</password>
        <driver>org.postgresql.Driver</driver>
    </configuration>
    <dependencies>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <version>${postgresql.version}</version>
        </dependency>
    </dependencies>
</plugin>
```

Run:

```bash
mvn liquibase:validate
mvn liquibase:updateSQL
mvn liquibase:update
```

Important:

> Jangan hardcode production password di `pom.xml`.

Gunakan:

- environment variable,
- Maven settings encrypted server credentials,
- CI secret manager,
- external properties file yang tidak masuk Git,
- cloud secret injection.

---

## 19. Maven Profile Pattern

Contoh profile:

```xml
<profiles>
    <profile>
        <id>local</id>
        <properties>
            <db.url>jdbc:postgresql://localhost:5432/appdb</db.url>
            <db.username>app_user</db.username>
            <db.password>app_password</db.password>
        </properties>
    </profile>
</profiles>
```

Run:

```bash
mvn -Plocal liquibase:update
```

Untuk production, jangan menyimpan password di profile repository.

Lebih baik:

```bash
mvn liquibase:update \
  -Ddb.url="$DB_URL" \
  -Ddb.username="$DB_USERNAME" \
  -Ddb.password="$DB_PASSWORD"
```

Tetapi hati-hati: command-line arguments bisa muncul di process list atau CI logs.

Lebih aman:

- secret file mounted with restricted permission,
- CI masked variables,
- cloud IAM-based authentication bila database mendukung,
- temporary credentials.

---

## 20. Gradle Plugin Setup

Gradle setup biasanya memakai plugin Liquibase.

Groovy DSL conceptual example:

```groovy
plugins {
    id 'org.liquibase.gradle' version '3.0.2'
}

dependencies {
    liquibaseRuntime 'org.liquibase:liquibase-core:4.31.1'
    liquibaseRuntime 'org.postgresql:postgresql:42.7.4'
    liquibaseRuntime 'info.picocli:picocli:4.7.6'
}

liquibase {
    activities {
        local {
            changelogFile 'src/main/resources/db/changelog/db.changelog-master.yaml'
            url 'jdbc:postgresql://localhost:5432/appdb'
            username 'app_user'
            password 'app_password'
        }
    }
    runList = 'local'
}
```

Run:

```bash
gradle validate
gradle updateSQL
gradle update
```

Catatan:

- plugin version dan Liquibase runtime version tidak selalu sama,
- pin dependency secara eksplisit,
- cek compatibility plugin dengan Liquibase version,
- hindari config production credentials di `build.gradle`.

---

## 21. CLI Setup

CLI setup cocok untuk:

- production pipeline,
- local explicit migration,
- database admin workflow,
- containerized migration,
- emergency repair.

File `liquibase.properties`:

```properties
changeLogFile=changelog/db.changelog-master.yaml
url=jdbc:postgresql://localhost:5432/appdb
username=app_user
password=app_password
driver=org.postgresql.Driver
classpath=lib/postgresql.jar
logLevel=info
```

Run:

```bash
liquibase validate
liquibase status
liquibase update-sql
liquibase update
```

Untuk production, pisahkan:

```text
liquibase.properties.template  -> committed
liquibase.prod.properties      -> generated/injected, not committed
```

Template:

```properties
changeLogFile=changelog/db.changelog-master.yaml
url=${DB_URL}
username=${DB_USERNAME}
password=${DB_PASSWORD}
```

---

## 22. CLI Directory Layout

Recommended layout untuk migration repository:

```text
liquibase-runner/
  changelog/
    db.changelog-master.yaml
    releases/
      2026-06-17.yaml
  sql/
    2026-06-17/
      001-create-table.sql
      002-seed-role.sql
  drivers/
    postgresql.jar
  config/
    liquibase.local.properties
    liquibase.uat.properties.template
    liquibase.prod.properties.template
  output/
    update-prod-2026-06-17.sql
  scripts/
    validate.sh
    update-sql.sh
    update.sh
```

Prinsip:

- committed: changelog, sql, template config, scripts,
- not committed: passwords, generated environment-specific properties,
- archived: generated SQL for release evidence,
- immutable: release tag artifact.

---

## 23. SQL-First Liquibase Setup

Liquibase tidak memaksa XML/YAML declarative style. Untuk banyak team Java enterprise, SQL-first lebih readable.

Master changelog:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-06-17.yaml
```

Release changelog:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-17-001-create-case-table
      author: fajar
      changes:
        - sqlFile:
            path: db/changelog/sql/2026-06-17/001-create-case-table.sql
            relativeToChangelogFile: false
            splitStatements: true
            stripComments: false
```

SQL file:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL,
    case_no VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT pk_case_record PRIMARY KEY (id),
    CONSTRAINT uk_case_record_case_no UNIQUE (case_no)
);
```

Kelebihan SQL-first:

- mudah direview DBA,
- vendor-specific feature lebih natural,
- migration artifact jelas,
- cocok untuk Oracle/PostgreSQL/SQL Server heavy systems.

Trade-off:

- portability lebih rendah,
- rollback harus manual,
- precondition tetap perlu di changelog.

---

## 24. Declarative Changelog Setup

Declarative style:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-17-001-create-case-record
      author: fajar
      changes:
        - createTable:
            tableName: case_record
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: case_no
                  type: varchar(50)
                  constraints:
                    nullable: false
                    unique: true
              - column:
                  name: status
                  type: varchar(30)
                  constraints:
                    nullable: false
```

Kelebihan:

- Liquibase bisa generate SQL per DBMS,
- beberapa rollback bisa auto-generated,
- readable untuk simple DDL,
- easier for cross-database products.

Trade-off:

- vendor-specific feature bisa awkward,
- generated SQL harus tetap direview,
- abstraction bisa memberi rasa aman palsu.

Rule:

> Gunakan declarative changelog untuk perubahan standar; gunakan SQL file untuk perubahan vendor-specific, performance-sensitive, atau DBA-reviewed.

---

## 25. XML vs YAML vs JSON vs SQL

```text
+---------+----------------------------+-----------------------------+
| Format  | Strength                   | Weakness                    |
+---------+----------------------------+-----------------------------+
| XML     | Mature, explicit schema    | Verbose                     |
| YAML    | Readable, common in Boot   | Indentation-sensitive       |
| JSON    | Tool-friendly              | Less pleasant manually      |
| SQL     | DBA-friendly, direct       | Less portable               |
+---------+----------------------------+-----------------------------+
```

Recommendation:

```text
Spring Boot app, team-owned DB       -> YAML + SQL files
DBA-heavy enterprise                 -> SQL files wrapped by YAML/XML
Cross-DB product                     -> XML/YAML declarative
Generated diff workflow              -> XML/YAML, then curated
Regulated production                 -> SQL output archived regardless of source format
```

---

## 26. Configuration Model

Liquibase config can come from:

- CLI arguments,
- properties file,
- environment variables,
- Maven/Gradle plugin config,
- Spring Boot properties,
- programmatic API.

The dangerous part is not “how to configure”; it is **configuration precedence and drift**.

Bad setup:

```text
local uses application.yml
CI uses Maven plugin properties
prod uses shell script args
all three point to different changelog path subtly
```

Better setup:

```text
Single changelog path convention
Single env variable naming convention
Single secret injection pattern
Single release artifact
Environment only changes URL, credential, context/label
```

---

## 27. Environment Configuration Pattern

Recommended env variables:

```bash
DB_URL=jdbc:postgresql://host:5432/appdb
DB_USERNAME=migration_user
DB_PASSWORD=...
LIQUIBASE_CONTEXTS=prod
LIQUIBASE_LABEL_FILTER=release-2026-06-17
LIQUIBASE_CHANGELOG=changelog/db.changelog-master.yaml
```

Wrapper script:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${DB_URL:?DB_URL is required}"
: "${DB_USERNAME:?DB_USERNAME is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${LIQUIBASE_CHANGELOG:?LIQUIBASE_CHANGELOG is required}"

liquibase \
  --changeLogFile="$LIQUIBASE_CHANGELOG" \
  --url="$DB_URL" \
  --username="$DB_USERNAME" \
  --password="$DB_PASSWORD" \
  --contexts="${LIQUIBASE_CONTEXTS:-}" \
  --label-filter="${LIQUIBASE_LABEL_FILTER:-}" \
  validate
```

Then update:

```bash
liquibase \
  --changeLogFile="$LIQUIBASE_CHANGELOG" \
  --url="$DB_URL" \
  --username="$DB_USERNAME" \
  --password="$DB_PASSWORD" \
  --contexts="${LIQUIBASE_CONTEXTS:-}" \
  --label-filter="${LIQUIBASE_LABEL_FILTER:-}" \
  update
```

Guardrail:

- fail if required env missing,
- print masked target DB,
- never echo password,
- archive logs,
- archive update SQL before update.

---

## 28. Secrets Handling

Bad:

```yaml
spring:
  datasource:
    username: prod_migration_user
    password: SuperSecret123
```

Bad:

```xml
<password>SuperSecret123</password>
```

Better:

```yaml
spring:
  datasource:
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
```

For production:

- AWS Secrets Manager,
- AWS SSM Parameter Store,
- Kubernetes Secret,
- HashiCorp Vault,
- Azure Key Vault,
- GCP Secret Manager,
- CI protected secret variables,
- short-lived IAM database auth where possible.

Principle:

> Changelog is code. Credentials are runtime secrets. Never mix them.

---

## 29. Migration User vs Application User

Top-tier setup separates users.

```text
+-------------------+-----------------------+
| User              | Privileges            |
+-------------------+-----------------------+
| application_user  | SELECT/INSERT/UPDATE  |
| migration_user    | DDL + controlled DML  |
| readonly_user     | SELECT only           |
| admin/dba_user    | emergency only        |
+-------------------+-----------------------+
```

Application user should usually not have:

- `CREATE TABLE`,
- `DROP TABLE`,
- `ALTER TABLE`,
- broad `CREATE ANY`,
- broad `DROP ANY`,
- unrestricted DBA role.

Migration user may have DDL privilege, but should be:

- restricted to target schema,
- used only in migration job,
- audited,
- rotated,
- not used by normal application runtime.

---

## 30. Containerized Liquibase

Container execution pattern:

```bash
docker run --rm \
  -v "$PWD/changelog:/liquibase/changelog" \
  -v "$PWD/drivers:/liquibase/lib" \
  liquibase/liquibase \
  --changeLogFile=changelog/db.changelog-master.yaml \
  --url="$DB_URL" \
  --username="$DB_USERNAME" \
  --password="$DB_PASSWORD" \
  update
```

Kelebihan:

- tool version pinned by image tag,
- no need install Liquibase on runner,
- easier reproducibility,
- good for CI/CD.

Risiko:

- driver availability,
- network access to DB,
- secret injection,
- image version drift,
- volume path confusion.

Recommendation:

- pin image tag,
- include JDBC driver intentionally,
- scan image,
- avoid `latest`,
- archive output.

---

## 31. Kubernetes Job Pattern

Production pattern:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: app-db-migration-20260617
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: liquibase
          image: your-registry/app-liquibase-migration:2026.06.17
          envFrom:
            - secretRef:
                name: app-db-migration-secret
          command: ["/bin/sh", "-c"]
          args:
            - |
              liquibase \
                --changeLogFile=changelog/db.changelog-master.yaml \
                --url="$DB_URL" \
                --username="$DB_USERNAME" \
                --password="$DB_PASSWORD" \
                --contexts=prod \
                update
```

Important settings:

- `restartPolicy: Never`,
- `backoffLimit: 0` or controlled retry,
- migration image immutable,
- secret from secret manager,
- logs collected,
- job must complete before app rollout,
- timeout controlled at pipeline level.

Do not blindly retry destructive migrations.

---

## 32. Init Container Pattern: Usually Avoid for Production

Tempting pattern:

```text
App Pod
  |-- initContainer: liquibase update
  |-- mainContainer: app
```

Problem:

- every pod rollout includes migration attempt,
- startup becomes migration orchestration,
- difficult release approval,
- scaling pods may trigger lock contention,
- not ideal for long migration.

Acceptable for:

- local Kubernetes,
- dev environments,
- ephemeral review apps,
- small internal services.

Better for production:

```text
Pipeline migration Job -> app Deployment rollout
```

---

## 33. CI/CD Pipeline Setup

Minimal pipeline:

```text
Commit
  |
  v
Build app
  |
  v
Validate changelog
  |
  v
Run migration on disposable DB
  |
  v
Run app integration tests
  |
  v
Generate update SQL
  |
  v
Approval
  |
  v
Run Liquibase update
  |
  v
Deploy app
  |
  v
Post-deploy verification
```

Strong pipeline:

```text
PR Stage:
  - changelog lint
  - duplicate changeset id check
  - validate
  - migrate fresh DB
  - migrate previous-release DB
  - run tests
  - generate update SQL for review

Release Stage:
  - package migration artifact
  - sign/checksum artifact
  - approval gate
  - backup/snapshot checkpoint
  - run update-sql
  - run update
  - verify DATABASECHANGELOG
  - deploy application
  - smoke test
  - archive evidence
```

---

## 34. Disposable Database Testing Setup

Using Testcontainers conceptually:

```java
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("appdb")
        .withUsername("test")
        .withPassword("test");
```

Test flow:

```text
Start real DB container
  |
  v
Run Liquibase changelog
  |
  v
Start application context
  |
  v
Run repository/service tests
```

Why real DB matters:

- H2 does not behave like Oracle/PostgreSQL/MySQL/SQL Server,
- DDL behavior differs,
- indexes differ,
- constraints differ,
- timestamp/timezone differs,
- transaction DDL differs,
- SQL dialect differs.

Rule:

> Unit tests may use fake/in-memory database. Migration tests should use the real database engine or a close production-compatible container.

---

## 35. Changelog Packaging Strategy

Two common options:

### 35.1 Changelog Packaged Inside Application

```text
app.jar
  BOOT-INF/classes/db/changelog/...
```

Good for:

- embedded startup migration,
- simple deployment,
- app-owned schema.

Risk:

- DB migration tied to app artifact,
- hard to run migration separately unless artifact is available,
- app rollback artifact may contain old changelog.

---

### 35.2 Changelog Packaged as Separate Migration Artifact

```text
app-migration-2026.06.17.tar.gz
  changelog/
  sql/
  scripts/
  manifest.json
```

Good for:

- enterprise release,
- external Liquibase job,
- DBA approval,
- immutable migration artifact,
- multi-app orchestration.

Risk:

- more pipeline complexity,
- version alignment must be enforced.

Recommended manifest:

```json
{
  "application": "case-management-service",
  "appVersion": "2026.06.17.1",
  "migrationVersion": "2026.06.17.1",
  "changelog": "changelog/db.changelog-master.yaml",
  "database": "postgresql",
  "requiredJavaForLiquibase": "17",
  "createdAt": "2026-06-17T10:00:00Z"
}
```

---

## 36. Contexts and Labels at Setup Time

Contexts and labels should not become random switches.

Bad:

```yaml
contexts: local,dev,prod,uat,special,temporary,my-machine
```

Better:

```text
Contexts: environment/runtime purpose
  - local
  - test
  - dev
  - uat
  - prod

Labels: release or feature selection
  - release-2026-06-17
  - feature-case-sla
  - module-identity
```

Setup rule:

```text
Environment selects context.
Release pipeline selects label.
Changelog remains deterministic.
```

Example:

```bash
liquibase \
  --contexts=prod \
  --label-filter=release-2026-06-17 \
  update
```

---

## 37. Setup for Existing Database

If database already exists before Liquibase adoption, do not simply point Liquibase and run.

Adoption flow:

```text
Inspect existing schema
  |
  v
Create baseline changelog or baseline marker
  |
  v
Tag existing state
  |
  v
Start new changesets after baseline
  |
  v
Validate environment drift
```

Options:

1. snapshot existing schema as baseline changelog,
2. mark current database as baseline without replaying old DDL,
3. create curated baseline manually,
4. separate historical documentation from executable future changelog.

For a legacy production database, prefer curated baseline.

Why?

Generated baseline often contains:

- noisy object ordering,
- vendor artifacts,
- unwanted grants,
- storage clauses,
- environment-specific names,
- generated constraint names.

---

## 38. Setup for Multiple Schemas

Example:

```text
Database
  |-- app_schema
  |-- audit_schema
  |-- ref_schema
```

Liquibase config options:

```properties
defaultSchemaName=app_schema
liquibaseSchemaName=app_schema
```

Concepts:

- `defaultSchemaName`: where changes apply by default,
- `liquibaseSchemaName`: where Liquibase tracking tables live.

Strategy choices:

### One Tracking Table Per Schema

```text
app_schema.DATABASECHANGELOG
audit_schema.DATABASECHANGELOG
ref_schema.DATABASECHANGELOG
```

Good when schemas are independently owned.

### Central Tracking Schema

```text
migration_meta.DATABASECHANGELOG
migration_meta.DATABASECHANGELOGLOCK
```

Good when one migration control plane owns multiple schemas.

Trade-off:

- central tracking easier to audit,
- per-schema tracking easier to isolate.

---

## 39. Setup for Multiple Databases

Example:

```text
Service
  |-- operational DB
  |-- reporting DB
  |-- audit DB
```

Do not hide this in one opaque startup hook.

Better pipeline:

```text
Step 1: migrate operational DB
Step 2: migrate audit DB
Step 3: migrate reporting DB
Step 4: deploy app
```

Each step has:

- changelog,
- credentials,
- lock,
- logs,
- verification.

Failure strategy must be explicit:

```text
If operational succeeds but audit fails:
  - do not deploy app
  - assess whether roll-forward audit migration is possible
  - do not automatically rollback operational unless rollback tested
```

---

## 40. Setup for Local Development

Local dev should be easy but not misleading.

Recommended local commands:

```bash
./scripts/db-reset-local.sh
./scripts/liquibase-update-local.sh
./scripts/run-tests.sh
```

Local DB setup:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: app_password
    ports:
      - "5432:5432"
```

Local reset:

```bash
docker compose down -v
docker compose up -d postgres
./scripts/liquibase-update-local.sh
```

Warning:

> Local reset is not a production rollback model.

Local can use destructive reset. Production cannot.

---

## 41. Setup for Integration Tests

Integration test pattern:

```text
Before tests:
  - create database/schema
  - run Liquibase
  - seed required reference data
  - run tests
After tests:
  - destroy database/schema
```

Avoid:

- using production changelog plus hidden test-only schema.sql,
- mutating changelog only for test,
- relying on H2 if production is Oracle/PostgreSQL/MySQL/SQL Server,
- making tests pass with schema not matching production.

Recommended:

```text
Production schema changes -> same Liquibase changelog
Test fixture data         -> separate test fixture loader
Reference seed            -> Liquibase if production-required
```

---

## 42. Setup for Rollback SQL Generation

Even if team prefers roll-forward, rollback evidence can be valuable.

Commands:

```bash
liquibase rollback-sql --tag=before-release-2026-06-17
```

or:

```bash
liquibase future-rollback-sql
```

Setup practice:

```text
Before prod update:
  - tag database state
  - generate update SQL
  - generate rollback SQL if supported
  - archive both
```

But remember:

> Generated rollback SQL is not proof that business rollback is safe.

Dropping a column can be syntactically reversible but data may be gone.

---

## 43. Setup for Tags

Tagging strategy:

```bash
liquibase tag release-2026-06-17-before
liquibase update
liquibase tag release-2026-06-17-after
```

Tags are useful for:

- rollback target,
- audit,
- release evidence,
- environment comparison.

But tags must be consistently applied.

Bad:

```text
Only prod has tags, UAT does not.
```

Better:

```text
Every controlled environment gets release tags.
```

---

## 44. Setup for Logging

Minimum log requirements:

- target database masked URL,
- changelog path,
- Liquibase version,
- Java version running Liquibase,
- contexts,
- labels,
- executed changesets,
- duration,
- failure stack trace,
- lock wait/failure.

Example wrapper:

```bash
echo "Liquibase version: $(liquibase --version)"
echo "Java version: $(java -version 2>&1 | head -n 1)"
echo "Changelog: $LIQUIBASE_CHANGELOG"
echo "Contexts: ${LIQUIBASE_CONTEXTS:-none}"
echo "Labels: ${LIQUIBASE_LABEL_FILTER:-none}"
```

Do not log:

- password,
- full secret connection strings,
- token,
- PII from data migration.

---

## 45. Setup for Observability

For app-startup Liquibase:

- expose startup failure logs,
- configure readiness probe correctly,
- monitor startup duration,
- use actuator endpoint if available,
- alert on repeated migration failure.

For external job:

- collect job logs,
- emit deployment event,
- record migration duration,
- record changeset count,
- archive SQL output,
- dashboard successful/failed migration per environment.

Operational state table:

```sql
SELECT id, author, filename, dateexecuted, orderexecuted, exectype, md5sum
FROM databasechangelog
ORDER BY orderexecuted DESC;
```

This table is not just internal metadata. It is operational evidence.

---

## 46. Setup for Lock Handling

Liquibase uses a lock table to prevent concurrent changelog execution.

Operational concern:

- stale lock after killed process,
- long-running migration holding lock,
- concurrent deployment waiting,
- manual unlock misuse.

Runbook:

```text
If Liquibase reports lock:
  1. Check if another migration process is still running.
  2. Check deployment pipeline/job status.
  3. Check database session/activity.
  4. Do not unlock blindly.
  5. If process is dead and no DB work active, release lock using approved command.
  6. Re-run validate before update.
```

Manual unlock should be controlled.

---

## 47. Setup for `clearCheckSums`

`clearCheckSums` should not be casual.

It can be useful after:

- intentional algorithm/version changes,
- controlled checksum recalculation,
- migration normalization.

But dangerous when used to hide:

- edited old changesets,
- production drift,
- accidental file mutation,
- unauthorized change.

Policy:

```text
clearCheckSums requires:
  - reason
  - approver
  - affected changesets
  - before/after checksum evidence
  - environment list
```

---

## 48. Setup for `dropAll` and Destructive Commands

Commands like `dropAll` can be useful locally.

They must be blocked in production.

Wrapper guard:

```bash
if [[ "${ENVIRONMENT}" == "prod" ]]; then
  if [[ "$*" == *"dropAll"* ]]; then
    echo "dropAll is forbidden in production"
    exit 1
  fi
fi
```

Better:

- do not install destructive scripts in prod runner,
- restrict credentials,
- policy-as-code,
- manual approval with break-glass only.

---

## 49. Production Setup Checklist

Before first production use:

```text
[ ] Liquibase version pinned
[ ] Java version for Liquibase runner known
[ ] JDBC driver version pinned
[ ] Changelog path stable
[ ] Migration user separate from app user
[ ] Secrets injected securely
[ ] update-sql generated and reviewed
[ ] validate run in CI
[ ] migration tested on production-like DB
[ ] previous-release upgrade tested
[ ] lock handling runbook exists
[ ] rollback/roll-forward decision documented
[ ] logs archived
[ ] DATABASECHANGELOG query verified
[ ] destructive commands blocked
[ ] production approval gate exists
```

---

## 50. Common Setup Anti-Patterns

### 50.1 Embedding Production DDL Privilege in App User

Bad:

```text
application_user can alter/drop/create anything
```

Why bad:

- runtime compromise becomes schema compromise,
- accidental code path can mutate DB,
- audit separation weak.

---

### 50.2 Different Changelog Path per Environment

Bad:

```text
local: db/changelog/local-master.yaml
uat: db/changelog/uat-master.yaml
prod: db/changelog/prod-master.yaml
```

This creates environment-specific reality.

Better:

```text
same master changelog
context/labels only when justified
```

---

### 50.3 Treating Liquibase as ORM Schema Generator

Liquibase is not there to blindly mirror entity classes.

Generated diff can help, but must be curated.

Bad flow:

```text
Change entity
Generate diff
Commit generated changelog without review
Deploy
```

Better flow:

```text
Design schema change
Write migration intentionally
Review SQL
Test migration
Then align entity
```

---

### 50.4 Running Migration from Every Pod in Production

Startup migration can work, but for high-risk production:

```text
N replicas all try migration
```

is inferior to:

```text
one controlled migration job before rollout
```

---

### 50.5 Storing Secrets in Changelog

Bad:

```yaml
- insert:
    tableName: integration_config
    columns:
      - column:
          name: api_secret
          value: real-production-secret
```

Seed config keys, not secrets.

Use secret manager for values.

---

### 50.6 Editing Old Changesets After Production

Bad:

```text
V1/changset-001 was deployed to prod
Developer edits it to fix typo
Checksum mismatch appears
Developer runs clearCheckSums
```

Correct:

```text
Create new changeset that corrects the issue
```

---

## 51. Reference Setup: Spring Boot Local + Pipeline Production

This is a strong default for many teams.

### Local

```yaml
spring:
  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml
    contexts: local
```

### Test

```yaml
spring:
  liquibase:
    enabled: true
    contexts: test
```

### Production App

```yaml
spring:
  liquibase:
    enabled: false
```

### Production Pipeline

```bash
./scripts/liquibase-validate.sh
./scripts/liquibase-update-sql.sh > update.sql
# approval gate
./scripts/liquibase-update.sh
# deploy app
```

Mental model:

```text
Developer convenience does not dictate production control.
```

---

## 52. Reference Setup: External Migration Repository

For enterprise/multi-service:

```text
repo: case-management-service
  src/main/java/...
  src/main/resources/...

repo: case-management-db-migrations
  changelog/
  sql/
  scripts/
  pipeline/
```

Benefits:

- DBA/release team can review separately,
- migration artifact independent,
- shared database changes easier to govern.

Risks:

- app/migration version alignment,
- PR coordination,
- release train overhead.

Mitigation:

- manifest file,
- app build references migration version,
- CI checks app expected schema version,
- release bundle includes both artifacts.

---

## 53. Reference Setup: Monorepo Multi-Module

```text
platform/
  services/
    identity-service/
    case-service/
  db/
    changelog/
      db.changelog-master.yaml
      modules/
        identity/
        case/
```

Master changelog:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/modules/identity/identity-master.yaml
  - include:
      file: db/changelog/modules/case/case-master.yaml
```

Risk:

- module ordering,
- cross-module dependency,
- ownership ambiguity.

Rule:

> If module A needs table from module B, that dependency should be explicit in changelog ordering and architecture documentation.

---

## 54. Minimum Viable Liquibase Setup

For a serious but small Java service:

```text
src/main/resources/db/changelog/db.changelog-master.yaml
src/main/resources/db/changelog/releases/2026-06-17.yaml
src/main/resources/db/changelog/sql/2026-06-17/*.sql
```

Spring Boot config:

```yaml
spring:
  liquibase:
    enabled: true
    change-log: classpath:/db/changelog/db.changelog-master.yaml
```

CI:

```text
- run validate
- run migration on disposable DB
- run tests
```

Production:

```text
- either app startup for low-risk app
- or external job for controlled deployment
```

---

## 55. Production-Grade Liquibase Setup

For enterprise/regulatory-grade system:

```text
Migration artifact:
  - changelog
  - SQL files
  - manifest
  - generated update SQL
  - generated rollback SQL if applicable
  - checksum/signature

Execution:
  - external Liquibase job
  - migration user
  - approval gate
  - preflight validation
  - backup/snapshot marker
  - update
  - verification query
  - logs archived

Application:
  - no DDL privilege
  - Liquibase disabled at startup in prod
  - schema compatibility check optionally enabled
```

---

## 56. Decision Framework

Ask these questions before choosing setup:

```text
1. Is the application Java 8/11 or Java 17+?
2. Is Liquibase embedded or external?
3. Does production allow app startup DDL?
4. How many replicas start concurrently?
5. Are migration scripts reviewed by DBA/security?
6. Is database shared by multiple services?
7. Are migrations small or potentially long-running?
8. Is rollback expected or roll-forward preferred?
9. Are secrets centrally managed?
10. Is audit evidence required?
```

Decision examples:

```text
Small internal Spring Boot app:
  embedded Liquibase is acceptable.

Java 8 legacy regulated app:
  external Liquibase runner is safer.

Kubernetes multi-replica service:
  external Job before rollout is preferred.

Multi-service shared DB:
  centralized migration orchestration is preferred.

Cross-database product:
  declarative changelog style may help.

Oracle-heavy enterprise schema:
  SQL-first Liquibase is often clearer.
```

---

## 57. Learning Check

You should now be able to explain:

1. why Liquibase setup is a control-plane decision,
2. why Java app version and Liquibase runner Java version can differ,
3. when to use Liquibase 4.x vs 5.x,
4. when embedded startup migration is acceptable,
5. when external CLI/job migration is preferable,
6. why production app user should not normally have DDL privilege,
7. how to structure changelog directories,
8. how Spring Boot Liquibase integration works conceptually,
9. why `ddl-auto=update` is dangerous in serious systems,
10. how Maven/Gradle/CLI setups differ,
11. why containerized migration is useful,
12. how to setup Kubernetes migration job,
13. how contexts and labels should be used,
14. what production guardrails are mandatory.

---

## 58. Practical Exercise

Design a Liquibase setup for this system:

```text
Application:
  Java 21 Spring Boot service
Database:
  PostgreSQL
Deployment:
  Kubernetes, 4 replicas
Environment:
  local, dev, uat, prod
Compliance:
  production changes require approval and evidence
```

Expected answer:

```text
Local:
  - embedded Liquibase enabled
  - context local
  - Docker Compose PostgreSQL

Test:
  - Testcontainers PostgreSQL
  - Liquibase runs before tests

CI:
  - liquibase validate
  - migrate fresh DB
  - migrate previous-release DB
  - generate update SQL

Prod:
  - Spring Boot Liquibase disabled
  - external Kubernetes Job
  - migration_user from secret manager
  - update SQL archived
  - approval gate before update
  - application rollout only after migration job success
```

---

## 59. Key Takeaways

1. Liquibase setup is not just dependency management; it is database change governance.
2. Java 8/11 projects usually need Liquibase 4.x for embedded mode, but can use external Liquibase 5.x if the runner uses Java 17+.
3. Embedded Spring Boot Liquibase is convenient, but external pipeline/job execution is often better for regulated production.
4. Do not mix Hibernate `ddl-auto=update`, `schema.sql`, `data.sql`, and Liquibase as competing schema owners.
5. Migration user and application user should be separated.
6. Changelog artifact must be deterministic, reviewable, and reproducible.
7. Containerized Liquibase is a strong pattern for CI/CD.
8. Kubernetes init containers are convenient but usually inferior to explicit migration Jobs for production.
9. Contexts and labels are powerful, but can create chaos if used as arbitrary branching logic.
10. A production-grade setup includes validation, generated SQL review, approval, controlled execution, verification, logs, and audit evidence.

---

## 60. References

- Liquibase 5.x release notes and Java 17 minimum requirement.
- Liquibase system requirements for modern versions.
- Liquibase 4.x system requirements for Java 8+ compatibility.
- Liquibase Spring Boot integration documentation.
- Spring Boot database initialization documentation.
- Spring Boot Actuator Liquibase endpoint documentation.
- Liquibase Gradle plugin documentation/release notes.

---

## 61. What Comes Next

Next part:

```text
13-liquibase-changelog-design.md
```

Part 13 akan membahas desain changelog secara mendalam:

- master changelog,
- release changelog,
- module changelog,
- feature changelog,
- include vs includeAll,
- logical file path,
- changeset naming,
- author convention,
- SQL-first vs declarative style,
- ownership,
- reviewability,
- dan bagaimana mencegah changelog berubah menjadi “migration spaghetti”.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 11 — Liquibase Mental Model](./11-liquibase-mental-model.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 13 — Liquibase Changelog Design](./13-liquibase-changelog-design.md)

</div>