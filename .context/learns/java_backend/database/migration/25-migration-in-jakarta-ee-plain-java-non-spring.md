# Part 25 — Migration in Jakarta EE, Plain Java, and Non-Spring Systems

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `25-migration-in-jakarta-ee-plain-java-non-spring.md`  
> Scope: Java 8–25, Jakarta EE / Java EE legacy, plain Java, app server runtime, CLI, container, Kubernetes, Flyway, Liquibase  
> Prasyarat: Part 0–24, terutama Flyway/Liquibase mental model, baseline/repair, migration testing, zero-downtime, locking, dan Spring Boot migration lifecycle.

---

## 1. Tujuan Bagian Ini

Di Spring Boot, banyak hal terasa “otomatis”: cukup tambah dependency Flyway/Liquibase, taruh migration file, aplikasi start, migration berjalan sebelum JPA/Hibernate dipakai. Tetapi tidak semua sistem Java berjalan di Spring Boot.

Banyak sistem enterprise berjalan di:

- Jakarta EE / Java EE application server.
- WAR/EAR deployment.
- Servlet container murni.
- Plain Java daemon.
- Batch Java application.
- Legacy Java 8 service.
- Modular Java 17/21/25 service tanpa Spring.
- Kubernetes Job atau init container.
- Pipeline migration step sebelum aplikasi dideploy.
- Shared database yang dipakai beberapa aplikasi.

Bagian ini menjawab pertanyaan utama:

> Kalau tidak memakai Spring Boot auto-configuration, di mana migration seharusnya dijalankan, siapa yang bertanggung jawab, dan bagaimana memastikan aplikasi tidak memakai schema yang belum siap?

Target setelah menyelesaikan bagian ini:

1. Bisa membedakan migration yang dijalankan di dalam aplikasi vs di luar aplikasi.
2. Bisa mendesain startup sequence yang aman untuk Jakarta EE/plain Java.
3. Bisa memakai Flyway/Liquibase dengan JNDI datasource, JDBC datasource manual, CLI, Maven/Gradle, container, atau Kubernetes Job.
4. Bisa menghindari anti-pattern seperti setiap node app server menjalankan migration bersamaan tanpa kontrol.
5. Bisa menentukan apakah migration lifecycle dimiliki oleh application runtime, release pipeline, DBA operation, atau deployment platform.
6. Bisa membuat runbook migration non-Spring yang production-grade.

---

## 2. Core Mental Model: Migration Is a Deployment Responsibility, Not Merely a Framework Feature

Spring Boot membuat migration terlihat seperti fitur aplikasi. Padahal secara arsitektural, migration adalah bagian dari **deployment choreography**.

Aplikasi butuh database contract tertentu. Migration mengubah database supaya contract itu tersedia. Maka urutan logisnya:

```text
migration succeeds
        ↓
database contract becomes available
        ↓
new application version starts safely
```

Masalah di non-Spring system adalah tidak ada satu framework yang otomatis mengatur semua urutan itu. Engineer harus eksplisit menentukan:

- Kapan migration dijalankan?
- Dari process mana migration dijalankan?
- Dengan credential apa?
- Dengan connection apa?
- Apakah migration berjalan sekali atau per node?
- Apa yang terjadi jika migration gagal?
- Apakah aplikasi boleh tetap start?
- Bagaimana jika app server retry deploy?
- Bagaimana jika beberapa instance start bersamaan?
- Bagaimana jika schema sudah berubah tapi app deployment gagal?

Top-tier mental model:

> Migration bukan “kode startup”. Migration adalah state transition database yang harus disinkronkan dengan state transition aplikasi.

---

## 3. Runtime Categories

Untuk non-Spring Java, kita akan bahas beberapa kategori.

### 3.1 Jakarta EE / Java EE Full Application Server

Contoh:

- WildFly / JBoss EAP.
- Payara / GlassFish.
- Open Liberty / WebSphere Liberty.
- WebLogic.
- WebSphere traditional.

Karakteristik:

- Deployment biasanya WAR/EAR.
- Datasource sering disediakan app server via JNDI.
- Transaction manager dikelola container.
- Classloader bisa kompleks.
- Banyak aplikasi bisa berbagi server.
- Startup order kadang tidak sesederhana `main()`.
- Database credential sering tidak berada di aplikasi.

### 3.2 Servlet Container Murni

Contoh:

- Tomcat.
- Jetty.
- Undertow embedded/non-embedded.

Karakteristik:

- Tidak selalu ada full Jakarta EE services.
- Bisa memakai `ServletContextListener` untuk startup hook.
- Datasource bisa JNDI atau dibuat sendiri.
- Transaction management biasanya manual atau library-specific.

### 3.3 Plain Java Application

Contoh:

- `public static void main`.
- Java daemon.
- CLI tool.
- Worker service.
- Scheduled batch.
- Lightweight HTTP service.

Karakteristik:

- Engineer mengontrol startup sepenuhnya.
- DataSource dibuat manual.
- Cocok untuk explicit migration runner.
- Lebih mudah dibuat deterministic.

### 3.4 External Migration Process

Contoh:

- Flyway CLI.
- Liquibase CLI.
- Maven plugin.
- Gradle task.
- Docker container command.
- Kubernetes Job.
- CI/CD pipeline stage.

Karakteristik:

- Migration dipisah dari application runtime.
- Biasanya lebih aman untuk production.
- Bisa memakai dedicated migration credential.
- Bisa diberi approval gate, logging, backup, dan runbook.

---

## 4. Decision Axis: In-App Migration vs External Migration

Ini keputusan paling penting.

### 4.1 In-App Migration

Migration dijalankan oleh aplikasi ketika aplikasi start.

```text
app process starts
        ↓
app runs migration
        ↓
app initializes business components
        ↓
app serves traffic
```

Keunggulan:

- Simple untuk local development.
- Tidak perlu pipeline step tambahan.
- Database selalu diperbarui saat aplikasi baru start.
- Cocok untuk single-instance internal tool.
- Cocok untuk small service yang deploy-nya sederhana.

Kelemahan:

- Banyak instance bisa mencoba migration bersamaan.
- App startup menjadi bergantung pada DDL lock / long migration.
- Migration failure bisa membuat semua pod/app gagal start.
- Credential aplikasi mungkin harus punya DDL privilege.
- Sulit memberi approval gate production.
- Sulit memisahkan tanggung jawab DBA/platform/app.
- Risiko restart loop di Kubernetes.

### 4.2 External Migration

Migration dijalankan sebelum aplikasi start oleh process khusus.

```text
pipeline/job runs migration
        ↓
migration succeeds
        ↓
app deployment starts
        ↓
app serves traffic
```

Keunggulan:

- Migration berjalan sekali dan eksplisit.
- Bisa memakai dedicated migration user.
- Bisa diberi pre-check, backup, approval, audit, dan rollback plan.
- App runtime tidak perlu DDL privilege.
- Cocok untuk production dan regulated systems.
- Cocok untuk multi-instance deployment.
- Cocok untuk app server dengan banyak node.

Kelemahan:

- Pipeline lebih kompleks.
- Local dev perlu mekanisme tambahan.
- Harus menjaga artifact migration selaras dengan artifact aplikasi.
- Perlu prosedur jika migration berhasil tapi app deployment gagal.

### 4.3 Practical Recommendation

Untuk sistem serius:

```text
Local dev / integration test:
  in-app migration boleh dan praktis.

Production / UAT / staging penting:
  external migration job lebih defensible.
```

Untuk enterprise/regulatory system:

```text
Migration should usually be a controlled deployment step,
not an accidental side effect of application startup.
```

---

## 5. Non-Spring Execution Patterns

Ada beberapa pola eksekusi yang umum.

---

# Pattern A — Plain Java Migration Runner

## 5.1 Kapan Dipakai

Gunakan ketika:

- Aplikasi punya `main()` sendiri.
- Service bukan Spring Boot.
- Deployment ingin memakai Java class sebagai migration command.
- Ingin shared code untuk Flyway/Liquibase config.
- Ingin local dev command yang konsisten.
- Ingin migration dijalankan sebagai container command.

## 5.2 Flyway Plain Java Example

Contoh minimal:

```java
import org.flywaydb.core.Flyway;

public final class DatabaseMigrator {
    public static void main(String[] args) {
        String url = requireEnv("DB_URL");
        String user = requireEnv("DB_MIGRATION_USER");
        String password = requireEnv("DB_MIGRATION_PASSWORD");

        Flyway flyway = Flyway.configure()
                .dataSource(url, user, password)
                .locations("classpath:db/migration")
                .baselineOnMigrate(false)
                .cleanDisabled(true)
                .load();

        flyway.validate();
        flyway.migrate();
    }

    private static String requireEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required env var: " + key);
        }
        return value;
    }
}
```

Untuk Java 8, `String.isBlank()` belum ada. Gunakan helper:

```java
private static boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
}
```

Versi Java 8-compatible:

```java
private static String requireEnv(String key) {
    String value = System.getenv(key);
    if (value == null || value.trim().isEmpty()) {
        throw new IllegalStateException("Missing required env var: " + key);
    }
    return value;
}
```

## 5.3 Liquibase Plain Java Example

Liquibase dapat dijalankan via Java API. Bentuk API bisa berubah antar versi, tetapi mental model-nya:

1. Buat JDBC connection.
2. Wrap connection sebagai Liquibase database.
3. Load changelog.
4. Jalankan update dengan context/label yang sesuai.

Contoh konseptual:

```java
import java.sql.Connection;
import java.sql.DriverManager;

import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;

public final class LiquibaseMigrator {
    public static void main(String[] args) throws Exception {
        String url = requireEnv("DB_URL");
        String user = requireEnv("DB_MIGRATION_USER");
        String password = requireEnv("DB_MIGRATION_PASSWORD");

        try (Connection connection = DriverManager.getConnection(url, user, password)) {
            Database database = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));

            try (Liquibase liquibase = new Liquibase(
                    "db/changelog/db.changelog-master.yaml",
                    new ClassLoaderResourceAccessor(),
                    database
            )) {
                liquibase.update(new Contexts("prod"), new LabelExpression("release-2026-06"));
            }
        }
    }

    private static String requireEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalStateException("Missing required env var: " + key);
        }
        return value;
    }
}
```

## 5.4 Key Design Rule

Plain Java migrator sebaiknya menjadi **dedicated command**, bukan tercampur dalam business application startup.

Struktur yang baik:

```text
src/main/java/com/acme/app/MainApplication.java
src/main/java/com/acme/db/DatabaseMigrator.java
src/main/resources/db/migration/...
```

Container dapat menjalankan command berbeda:

```bash
java -cp app.jar com.acme.db.DatabaseMigrator
java -jar app.jar
```

Atau dengan fat jar yang mendukung subcommand:

```bash
java -jar app.jar migrate
java -jar app.jar server
```

## 5.5 Avoid This

Jangan membuat startup seperti ini tanpa kontrol:

```java
public static void main(String[] args) {
    migrateDatabase();
    startHttpServer();
}
```

Itu terlihat rapi, tetapi di production multi-instance bisa berbahaya jika:

- Semua instance start bersamaan.
- Migration lama menahan lock.
- One pod crash, orchestrator restart, migration retry tanpa runbook.
- App user harus punya DDL privilege.

Lebih aman:

```text
Pipeline/Kubernetes Job:
  java -jar app.jar migrate

Application deployment:
  java -jar app.jar server
```

---

# Pattern B — ServletContextListener Migration

## 6.1 Kapan Dipakai

Gunakan jika:

- Aplikasi berupa WAR di servlet container.
- Tidak ada Spring Boot.
- Ingin migration sebelum servlet menerima traffic.
- Runtime sederhana/single-instance.
- Environment bukan high-risk production.

## 6.2 Servlet Listener Example

```java
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;
import org.flywaydb.core.Flyway;

@WebListener
public class MigrationListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        String url = System.getenv("DB_URL");
        String user = System.getenv("DB_MIGRATION_USER");
        String password = System.getenv("DB_MIGRATION_PASSWORD");

        Flyway flyway = Flyway.configure()
                .dataSource(url, user, password)
                .locations("classpath:db/migration")
                .cleanDisabled(true)
                .load();

        flyway.migrate();
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        // no-op
    }
}
```

Untuk Java EE 8 / Servlet 4, package masih `javax.servlet`:

```java
import javax.servlet.ServletContextEvent;
import javax.servlet.ServletContextListener;
import javax.servlet.annotation.WebListener;
```

Untuk Jakarta EE 9+, package berubah menjadi `jakarta.servlet`.

## 6.3 Lifecycle Risk

`ServletContextListener` berjalan saat webapp initialized. Jika migration gagal, deployment biasanya gagal.

Itu bisa bagus karena fail-fast, tetapi juga bisa buruk:

- App server bisa retry deploy.
- Semua cluster node bisa menjalankan listener.
- Tidak ada approval gate.
- Sulit memisahkan privilege migration dan runtime app.

## 6.4 Safer Usage

Jika tetap memakai listener, tambahkan guard:

```java
String migrationEnabled = System.getenv("APP_RUN_MIGRATION_ON_STARTUP");
if (!"true".equalsIgnoreCase(migrationEnabled)) {
    return;
}
```

Namun jangan jadikan ini default production.

Rekomendasi:

```text
local/dev:
  APP_RUN_MIGRATION_ON_STARTUP=true

prod:
  APP_RUN_MIGRATION_ON_STARTUP=false
  migration dijalankan oleh pipeline/job
```

---

# Pattern C — CDI Startup Observer

## 7.1 Kapan Dipakai

Gunakan jika:

- Aplikasi Jakarta EE memakai CDI.
- Ingin hook pada lifecycle container.
- DataSource di-inject via CDI/JNDI.
- Runtime mendukung CDI events.

## 7.2 CDI Startup Concept

Di Jakarta EE, CDI memiliki lifecycle event seperti initialization application scope. Contoh konseptual:

```java
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;

@ApplicationScoped
public class DatabaseMigrationStartup {

    @Inject
    private DataSource dataSource;

    @PostConstruct
    public void migrate() {
        if (!isMigrationEnabled()) {
            return;
        }

        Flyway flyway = Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .cleanDisabled(true)
                .load();

        flyway.migrate();
    }

    private boolean isMigrationEnabled() {
        return "true".equalsIgnoreCase(System.getenv("APP_RUN_MIGRATION_ON_STARTUP"));
    }
}
```

## 7.3 CDI Caveat

CDI bean initialization ordering bisa tidak selalu cocok untuk migration jika bean lain juga mengakses database saat startup.

Problem:

```text
Bean A initializes and queries table X
Migration bean has not run yet
Table X does not exist / old schema
Startup fails unpredictably
```

Karena itu, CDI startup migration cocok hanya jika lifecycle ordering benar-benar dikontrol.

Untuk sistem production serius, external job lebih jelas.

---

# Pattern D — EJB Singleton Startup

## 8.1 Kapan Dipakai

Gunakan di Java EE / Jakarta EE app server yang memakai EJB dan butuh startup component.

EJB menyediakan pattern:

```java
@Singleton
@Startup
public class MigrationStartupBean { ... }
```

## 8.2 Example

```java
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Resource;
import jakarta.ejb.Singleton;
import jakarta.ejb.Startup;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;

@Singleton
@Startup
public class MigrationStartupBean {

    @Resource(lookup = "java:/jdbc/AppDataSource")
    private DataSource dataSource;

    @PostConstruct
    public void migrate() {
        if (!"true".equalsIgnoreCase(System.getenv("APP_RUN_MIGRATION_ON_STARTUP"))) {
            return;
        }

        Flyway flyway = Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .cleanDisabled(true)
                .load();

        flyway.migrate();
    }
}
```

Untuk Java EE 8, imports biasanya:

```java
import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import javax.ejb.Singleton;
import javax.ejb.Startup;
```

## 8.3 EJB Transaction Caveat

EJB method sering berada dalam container-managed transaction secara default. DDL migration tidak selalu cocok berada di container transaction.

Tambahkan explicit transaction attribute jika perlu:

```java
import jakarta.ejb.TransactionAttribute;
import jakarta.ejb.TransactionAttributeType;

@TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
@PostConstruct
public void migrate() {
    // run migration outside container-managed business transaction
}
```

Kenapa?

- Flyway/Liquibase mengatur transaksi migration sendiri.
- Beberapa DB tidak mendukung transactional DDL.
- Container-managed transaction bisa membuat behavior sulit diprediksi.
- Long DDL di global transaction adalah red flag.

---

# Pattern E — JNDI DataSource Migration

## 9.1 Problem yang Sering Muncul

Di app server, aplikasi sering tidak memiliki JDBC URL/user/password langsung. Yang ada adalah JNDI datasource:

```text
java:/jdbc/AppDataSource
java:comp/env/jdbc/AppDataSource
jdbc/AppDataSource
```

Flyway/Liquibase perlu `DataSource` atau `Connection`. Maka migrator harus lookup JNDI.

## 9.2 JNDI Lookup Example

```java
import javax.naming.InitialContext;
import javax.sql.DataSource;

public final class JndiDataSources {
    public static DataSource lookup(String name) {
        try {
            InitialContext context = new InitialContext();
            return (DataSource) context.lookup(name);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to lookup DataSource: " + name, e);
        }
    }
}
```

Flyway:

```java
DataSource dataSource = JndiDataSources.lookup("java:/jdbc/AppDataSource");

Flyway flyway = Flyway.configure()
        .dataSource(dataSource)
        .locations("classpath:db/migration")
        .cleanDisabled(true)
        .load();

flyway.migrate();
```

## 9.3 Important Caveat: Migration User vs App User

JNDI datasource biasanya adalah application datasource. Jika dipakai untuk migration, berarti app datasource punya DDL privilege.

Untuk production, sebaiknya ada dua datasource:

```text
java:/jdbc/AppRuntimeDataSource
  - SELECT/INSERT/UPDATE/DELETE sesuai kebutuhan runtime
  - no broad DDL privilege

java:/jdbc/AppMigrationDataSource
  - DDL privilege terbatas untuk migration
  - dipakai hanya oleh migration process
```

Jika app server tidak mendukung dua datasource dengan baik, external CLI/container job dengan dedicated secret sering lebih bersih.

---

# Pattern F — Maven/Gradle Migration Task

## 10.1 Kapan Dipakai

Gunakan ketika:

- Migration dijalankan dari CI/CD pipeline.
- Build tool sudah menjadi release orchestrator.
- Environment kecil/menengah.
- Tidak ingin membuat custom Java migrator.

## 10.2 Maven Flyway Pattern

Contoh command:

```bash
mvn -Dflyway.url="$DB_URL" \
    -Dflyway.user="$DB_MIGRATION_USER" \
    -Dflyway.password="$DB_MIGRATION_PASSWORD" \
    flyway:validate flyway:migrate
```

Cocok untuk:

- CI validation.
- Dev migration.
- Controlled deployment step.

Tidak ideal jika:

- Production runtime tidak memiliki Maven.
- Build artifact dan migration execution ingin dipisahkan ketat.
- Perlu immutable containerized migration artifact.

## 10.3 Gradle Flyway Pattern

Contoh command:

```bash
./gradlew flywayValidate flywayMigrate \
  -Dflyway.url="$DB_URL" \
  -Dflyway.user="$DB_MIGRATION_USER" \
  -Dflyway.password="$DB_MIGRATION_PASSWORD"
```

## 10.4 Liquibase Maven/Gradle Pattern

Liquibase juga bisa dijalankan via Maven/Gradle plugin.

Command konseptual Maven:

```bash
mvn liquibase:update \
  -Dliquibase.url="$DB_URL" \
  -Dliquibase.username="$DB_MIGRATION_USER" \
  -Dliquibase.password="$DB_MIGRATION_PASSWORD" \
  -Dliquibase.changeLogFile="db/changelog/db.changelog-master.yaml"
```

## 10.5 Production Warning

Build tool migration di production harus dikontrol ketat:

- Jangan rebuild artifact saat deploy production.
- Jangan mengambil source branch dinamis.
- Jangan menjalankan migration dari working directory yang bisa berubah.
- Gunakan artifact yang sama dengan yang sudah diuji.
- Catat versi artifact, git commit, checksum, operator, timestamp.

---

# Pattern G — Flyway/Liquibase CLI

## 11.1 Kapan Dipakai

CLI cocok ketika migration diperlakukan sebagai operational command.

Contoh:

```bash
flyway -url="$DB_URL" \
       -user="$DB_MIGRATION_USER" \
       -password="$DB_MIGRATION_PASSWORD" \
       -locations="filesystem:./db/migration" \
       validate migrate
```

Liquibase:

```bash
liquibase \
  --url="$DB_URL" \
  --username="$DB_MIGRATION_USER" \
  --password="$DB_MIGRATION_PASSWORD" \
  --changelog-file="db/changelog/db.changelog-master.yaml" \
  update
```

## 11.2 CLI Strengths

- Tooling jelas.
- Tidak perlu embed library ke app.
- Cocok untuk DBA/platform workflow.
- Bisa dijalankan di pipeline container.
- Bisa menghasilkan SQL preview.
- Bisa dipisah dari app runtime.

## 11.3 CLI Weaknesses

- Perlu packaging migration files.
- Versi CLI harus dikunci.
- Driver harus tersedia.
- Config/secrets harus aman.
- Local dev harus dibuat nyaman.

## 11.4 Recommended CLI Artifact Layout

```text
migration-artifact/
  flyway.conf
  drivers/
    postgresql.jar
    ojdbc.jar
  sql/
    V202606170900__create_case_table.sql
    V202606171000__add_case_status.sql
  checksums.txt
  manifest.json
```

Atau untuk Liquibase:

```text
migration-artifact/
  liquibase.properties
  drivers/
    postgresql.jar
    ojdbc.jar
  changelog/
    db.changelog-master.yaml
    releases/
      2026-06.yaml
  manifest.json
```

`manifest.json` dapat berisi:

```json
{
  "application": "case-management-service",
  "release": "2026.06.17",
  "gitCommit": "abc1234",
  "tool": "flyway",
  "toolVersion": "12.x",
  "database": "postgresql",
  "generatedAt": "2026-06-17T09:00:00Z"
}
```

---

# Pattern H — Kubernetes Job Migration

## 12.1 Kapan Dipakai

Gunakan jika aplikasi berjalan di Kubernetes dan production deploy butuh migration step yang eksplisit.

Flow:

```text
CI builds app image
CI builds/publishes migration artifact/image
CD creates Kubernetes Job for migration
Job succeeds
Deployment rollout starts
```

## 12.2 Simple Kubernetes Job Example

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: case-service-db-migrate-20260617
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: registry.example.com/case-service:2026.06.17
          command: ["java", "-jar", "/app/case-service.jar", "migrate"]
          env:
            - name: DB_URL
              valueFrom:
                secretKeyRef:
                  name: case-service-db-migration
                  key: url
            - name: DB_MIGRATION_USER
              valueFrom:
                secretKeyRef:
                  name: case-service-db-migration
                  key: username
            - name: DB_MIGRATION_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: case-service-db-migration
                  key: password
```

## 12.3 Important Job Settings

```yaml
backoffLimit: 0
restartPolicy: Never
```

Kenapa?

- Migration failure harus diperiksa, bukan retry membabi buta.
- Beberapa failure perlu manual diagnosis.
- Retry otomatis bisa memperburuk lock/contention.

Untuk idempotent migration tertentu, retry bisa aman. Tetapi default production posture sebaiknya conservative.

## 12.4 Separate Migration Image

Kadang lebih baik membuat image khusus:

```text
case-service-runtime:2026.06.17
case-service-migration:2026.06.17
```

Keunggulan:

- Runtime image tidak membawa CLI/tool tambahan.
- Migration image bisa membawa driver dan tool.
- Security scanning lebih jelas.
- Entrypoint lebih sederhana.

Kelemahan:

- Harus menjaga dua artifact selaras.

## 12.5 Init Container: Usually Not Recommended for Production Migration

Pola init container:

```text
pod init container runs migration
then app container starts
```

Terlihat menarik, tetapi untuk deployment multi-replica:

- Setiap pod punya init container.
- Banyak pod bisa menjalankan migration bersamaan.
- Locking tool memang membantu, tetapi operational control buruk.
- Jika migration lama, rollout tertahan per pod.
- Failure menyebabkan pod stuck/restart.

Rekomendasi:

```text
Use Kubernetes Job before Deployment rollout,
not per-pod init container for production DDL migration.
```

Init container masih bisa dipakai untuk:

- Local/dev environment.
- Ephemeral test namespace.
- Lightweight validation.
- Waiting for database availability, bukan migration besar.

---

# Pattern I — App Server Deployment Pipeline Migration

## 13.1 App Server Cluster Problem

Pada traditional app server cluster:

```text
node-1 deploys WAR
node-2 deploys WAR
node-3 deploys WAR
```

Jika migration ada di WAR startup hook:

```text
node-1 runs migration
node-2 also tries migration
node-3 also tries migration
```

Flyway/Liquibase punya locking mechanism, tetapi bukan berarti ini desain terbaik.

Kenapa?

- Startup time tiap node bisa terhambat.
- Failure signal tersebar di app server log.
- Operator sulit tahu apakah migration adalah deployment step atau side effect.
- App server retry bisa memicu attempt tambahan.
- Credential DDL berada di aplikasi.

## 13.2 Better Flow

```text
1. Stop/disable traffic to old deployment if needed.
2. Run database migration once via pipeline/CLI/job.
3. Verify schema history/changelog status.
4. Deploy WAR/EAR to app server nodes.
5. Re-enable traffic gradually.
```

## 13.3 Blue/Green with App Server

```text
old app cluster -> serves traffic
migration expand phase -> backward-compatible
new app cluster deploys -> compatible with expanded schema
traffic shifts to new cluster
contract migration later -> remove old objects
```

Migration harus compatible dengan old cluster selama traffic belum dipindahkan penuh.

---

## 14. Classloader Concerns in App Server

App server classloader bisa membuat Flyway/Liquibase integration bermasalah.

### 14.1 Common Issues

- JDBC driver ada di server module, bukan app classpath.
- Flyway/Liquibase ada di WAR, tetapi driver tidak terlihat.
- Migration resources tidak ditemukan.
- Multiple versions library conflict.
- Parent-first vs child-first classloading.
- EAR berisi banyak WAR/JAR yang masing-masing membawa dependency.

### 14.2 Practical Rules

Rule 1: Pastikan migration library dan migration resources berada di classloader yang sama.

```text
WAR:
  WEB-INF/lib/flyway-core.jar
  WEB-INF/classes/db/migration/...
```

Rule 2: Jika driver dikelola app server, gunakan JNDI DataSource daripada DriverManager.

Rule 3: Untuk external migration, hindari app server classloader sepenuhnya.

```text
CLI/job process owns its classpath.
```

Rule 4: Jangan biarkan beberapa module EAR membawa migration runner masing-masing untuk schema yang sama.

---

## 15. Transaction Manager Concerns

Jakarta EE memiliki transaction manager. Flyway/Liquibase juga punya transaction behavior. Campuran ini perlu hati-hati.

### 15.1 Avoid Global Transaction for Migration

DDL migration sebaiknya tidak dibungkus JTA transaction container.

Alasan:

- Banyak database auto-commit DDL.
- DDL bisa implicit commit.
- Long-running migration di global transaction buruk.
- Lock bisa tertahan terlalu lama.
- Recovery menjadi ambigu.

### 15.2 Use Non-Transactional Startup Hook

Untuk EJB:

```java
@TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
```

Untuk CDI/Servlet:

- Jangan panggil migration dari business method transactional.
- Jangan gunakan `@Transactional` di migration startup bean.

### 15.3 Dedicated Connection

Migration runner idealnya memakai dedicated connection/dataSource yang tidak ikut request transaction.

---

## 16. Jakarta Persistence Schema Generation Conflict

Jika memakai JPA di Jakarta EE, pastikan schema generation tidak bertabrakan dengan Flyway/Liquibase.

Dangerous config:

```xml
<property name="jakarta.persistence.schema-generation.database.action" value="drop-and-create"/>
```

Atau legacy:

```xml
<property name="javax.persistence.schema-generation.database.action" value="drop-and-create"/>
```

Untuk production, biasanya:

```xml
<property name="jakarta.persistence.schema-generation.database.action" value="none"/>
```

Atau property provider-specific Hibernate:

```xml
<property name="hibernate.hbm2ddl.auto" value="none"/>
```

Prinsip:

```text
Flyway/Liquibase owns schema evolution.
JPA validates or consumes schema, not mutates production schema.
```

Di development, boleh memakai auto-DDL untuk eksperimen lokal, tetapi jangan campur dengan migration history yang dianggap canonical.

---

## 17. Multiple Datasources and Multiple Schemas

Non-Spring systems sering punya lebih dari satu datasource:

```text
java:/jdbc/CoreDS
java:/jdbc/AuditDS
java:/jdbc/ReportingDS
```

Atau satu database dengan banyak schema:

```text
app_core
app_audit
app_reporting
```

### 17.1 Strategy Options

Option A: One migration runner per datasource/schema.

```text
migrate-core
migrate-audit
migrate-reporting
```

Option B: One orchestration runner that executes multiple migration configs in order.

```java
migrate("core", coreDataSource, "classpath:db/core");
migrate("audit", auditDataSource, "classpath:db/audit");
migrate("reporting", reportingDataSource, "classpath:db/reporting");
```

Option C: Separate pipelines per bounded context.

### 17.2 Ordering Problem

Jika schema saling bergantung:

```text
audit references core table
reporting view depends on core table
```

Maka migration order harus eksplisit.

```text
1. core expand
2. audit adapt
3. reporting adapt
4. app deploy
5. contract later
```

### 17.3 Avoid Cross-Schema Chaos

Jika setiap module bebas mengubah schema lain, migration ownership rusak.

Gunakan ownership matrix:

| Schema | Owner | Migration location | Runtime user | Migration user |
|---|---|---|---|---|
| `core` | Core team | `db/core` | `core_app` | `core_migrator` |
| `audit` | Platform team | `db/audit` | `audit_app` | `audit_migrator` |
| `reporting` | BI team | `db/reporting` | `report_app` | `report_migrator` |

---

## 18. Startup Safety Gates

Jika migration tidak dijalankan oleh aplikasi, bagaimana aplikasi tahu database sudah siap?

Tambahkan startup validation ringan.

### 18.1 Flyway Validate on Startup Without Migrate

Aplikasi runtime bisa melakukan validate saja:

```java
Flyway flyway = Flyway.configure()
        .dataSource(runtimeDataSource)
        .locations("classpath:db/migration")
        .cleanDisabled(true)
        .load();

flyway.validate();
```

Namun hati-hati: runtime user butuh akses baca ke schema history table.

Alternatif: query own application compatibility table.

### 18.2 Application Compatibility Table

Buat table kecil:

```sql
CREATE TABLE app_schema_contract (
    app_name VARCHAR(100) PRIMARY KEY,
    contract_version VARCHAR(50) NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Migration mengupdate:

```sql
MERGE INTO app_schema_contract t
USING (SELECT 'case-service' AS app_name, '2026.06.17' AS contract_version FROM dual) s
ON (t.app_name = s.app_name)
WHEN MATCHED THEN
  UPDATE SET contract_version = s.contract_version, updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN
  INSERT (app_name, contract_version, updated_at)
  VALUES (s.app_name, s.contract_version, CURRENT_TIMESTAMP);
```

Aplikasi start dengan check:

```text
required contract version = 2026.06.17
actual contract version >= 2026.06.17
```

### 18.3 Why Not Just Check Table Exists?

Karena contract aplikasi bukan hanya “table exists”. Contract bisa mencakup:

- Column exists.
- Column type compatible.
- Constraint exists.
- Seed permission exists.
- View/procedure version correct.
- Required index exists.
- Backfill phase completed.

Untuk sistem besar, contract version table lebih eksplisit.

---

## 19. Failure Handling in Non-Spring Migration

### 19.1 Failure Case: Migration Fails Before App Deployment

External job flow:

```text
migration job fails
        ↓
application deployment must not continue
        ↓
operator investigates
```

Runbook:

1. Capture logs.
2. Check schema history/changelog table.
3. Identify failed migration id.
4. Check whether DDL partially applied.
5. Check lock/session state.
6. Decide retry/repair/roll-forward/restore.
7. Do not deploy app unless contract is valid.

### 19.2 Failure Case: Migration Succeeds, App Deployment Fails

This is common and dangerous.

If migration was backward-compatible:

```text
old app can still run against expanded schema
```

Then recovery is easier:

```text
keep old app running
fix deployment
redeploy new app later
```

If migration was breaking:

```text
old app may fail
```

Then you have outage pressure.

This is why expand/contract is a deployment survival pattern.

### 19.3 Failure Case: App Starts Before Migration

Possible causes:

- Pipeline ordering bug.
- Manual deployment.
- App server auto-redeploy.
- Kubernetes rollout not blocked on job.
- Wrong environment config.

Mitigation:

- Startup compatibility check.
- Readiness probe fails if contract not met.
- Deployment pipeline dependency.
- Release gate.

### 19.4 Failure Case: Multiple App Nodes Run Migration

Flyway/Liquibase locks help, but:

- One node blocks others.
- Logs are scattered.
- Startup time increases.
- Failure diagnostics harder.

Mitigation:

- External single migration job.
- Disable startup migration in prod.
- Use explicit config flag.

---

## 20. Readiness and Health Checks

Non-Spring systems still need health/readiness checks.

### 20.1 Liveness vs Readiness

Liveness:

```text
Is the process alive?
```

Readiness:

```text
Can this process safely receive traffic?
```

Database contract belongs to readiness, not liveness.

### 20.2 Readiness Should Check Contract

Pseudo-code:

```java
public boolean isReady() {
    return databaseReachable()
        && schemaContractSatisfied()
        && essentialDependenciesAvailable();
}
```

### 20.3 Avoid Heavy Migration Validate on Every Health Check

Do not run full Flyway/Liquibase validate on every readiness probe.

Bad:

```text
every 10 seconds -> scan migration history/checksums
```

Better:

- Check once at startup and cache result.
- Check lightweight contract table.
- Recheck periodically with low frequency.
- Expose migration status endpoint if needed.

---

## 21. Packaging Migration Files

### 21.1 Package with Application Artifact

```text
app.jar
  /db/migration/V1__init.sql
```

Keunggulan:

- Migration version tied to app version.
- Local dev simple.
- No separate artifact management.

Kelemahan:

- External DBA review may require extracting files.
- Runtime artifact carries migration files.
- If app artifact deployed but migration not run, files are present but state not changed.

### 21.2 Separate Migration Artifact

```text
case-service-app.jar
case-service-migrations.zip
```

Keunggulan:

- Clear deployment step.
- Migration artifact immutable and reviewable.
- Bisa diberi checksum/signature.
- Cocok untuk regulated environment.

Kelemahan:

- Need version alignment.
- More pipeline complexity.

### 21.3 Recommended Metadata

Setiap migration artifact sebaiknya punya manifest:

```json
{
  "service": "case-service",
  "release": "2026.06.17",
  "schemaContract": "case-service-db-contract-2026.06.17",
  "gitCommit": "abc1234",
  "javaVersionTarget": "17",
  "tool": "liquibase",
  "toolVersion": "5.0.x",
  "createdByPipeline": "build-9182"
}
```

---

## 22. Java 8 to 25 Compatibility Concerns

### 22.1 Java 8 Legacy

Concerns:

- Older Flyway/Liquibase versions may be required.
- `javax.*` namespace for Java EE.
- No records, no `var`, no text blocks, no `String.isBlank()`.
- TLS/JDBC driver compatibility may be older.
- App server may pin old dependency versions.

Guideline:

```text
For Java 8 systems, pin tool versions explicitly and test with the exact runtime JVM/app server.
```

### 22.2 Java 11

Concerns:

- Common baseline for legacy-modern transition.
- Still many enterprise systems.
- Some modern tool versions may start dropping support.

Guideline:

```text
Do not assume latest Flyway/Liquibase supports old Java baselines.
Use compatibility matrix and lock versions.
```

### 22.3 Java 17

Concerns:

- Strong modern LTS baseline.
- Jakarta EE 10+ ecosystem more comfortable.
- Liquibase 5.x minimum Java 17.
- More suitable for modern pipeline tools.

### 22.4 Java 21

Concerns:

- Modern LTS baseline.
- Good target for new enterprise Java.
- Works well for dedicated migration command code.
- Virtual threads are generally irrelevant for DDL migration but can help custom data migration tooling if used carefully.

### 22.5 Java 25

Concerns:

- Very modern runtime.
- Some app servers/libraries may lag.
- Migration tools may support it, but verify exact support.
- For production, support matrix matters more than language novelty.

Rule:

```text
Database migration should be boring, deterministic, and supportable.
Do not use bleeding-edge Java features in migration runner unless operationally justified.
```

---

## 23. Flyway Non-Spring Configuration Blueprint

Example `flyway.conf`:

```properties
flyway.locations=filesystem:sql
flyway.cleanDisabled=true
flyway.baselineOnMigrate=false
flyway.validateOnMigrate=true
flyway.table=flyway_schema_history
flyway.connectRetries=3
```

Do not put secrets in committed config:

```properties
# Do not commit this:
flyway.password=super-secret
```

Pass secrets at runtime:

```bash
flyway \
  -configFiles=flyway.conf \
  -url="$DB_URL" \
  -user="$DB_MIGRATION_USER" \
  -password="$DB_MIGRATION_PASSWORD" \
  migrate
```

Production default:

```properties
flyway.cleanDisabled=true
```

---

## 24. Liquibase Non-Spring Configuration Blueprint

Example `liquibase.properties`:

```properties
changeLogFile=db/changelog/db.changelog-master.yaml
logLevel=info
liquibase.command.defaultSchemaName=app_schema
```

Runtime command:

```bash
liquibase \
  --defaults-file=liquibase.properties \
  --url="$DB_URL" \
  --username="$DB_MIGRATION_USER" \
  --password="$DB_MIGRATION_PASSWORD" \
  update
```

With contexts/labels:

```bash
liquibase \
  --defaults-file=liquibase.properties \
  --url="$DB_URL" \
  --username="$DB_MIGRATION_USER" \
  --password="$DB_MIGRATION_PASSWORD" \
  --contexts=prod \
  --labels=release-2026-06 \
  update
```

---

## 25. Operational Ownership Model

A mature team defines who owns each part.

| Concern | Owner | Notes |
|---|---|---|
| Migration script correctness | App team | Knows domain contract |
| SQL performance review | App team + DBA | Especially large DDL/backfill |
| Migration execution pipeline | Platform/DevOps | Job, secrets, logs, approvals |
| DB privilege model | DBA/security/platform | Separate runtime/migration user |
| Production approval | Release manager/change manager | Depends organization |
| Rollback decision | Joint app/platform/DBA | Must know app and DB state |
| Migration runbook | App team + operations | Should be ready before prod |

Top-tier engineer tidak hanya menulis migration. Ia memastikan migration bisa:

- direview,
- dijalankan,
- diamati,
- dihentikan,
- dipulihkan,
- diaudit,
- dipertanggungjawabkan.

---

## 26. Local Development Workflow

Local dev perlu mudah, kalau tidak developer akan bypass migration.

### 26.1 Option A: Make Command

```makefile
migrate:
	java -jar build/libs/app.jar migrate

run:
	java -jar build/libs/app.jar server

reset-db:
	docker compose down -v
	docker compose up -d db
	java -jar build/libs/app.jar migrate
```

### 26.2 Option B: Docker Compose

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app

  migrate:
    image: case-service:local
    command: ["java", "-jar", "/app/app.jar", "migrate"]
    depends_on:
      - db
    environment:
      DB_URL: jdbc:postgresql://db:5432/app
      DB_MIGRATION_USER: app
      DB_MIGRATION_PASSWORD: app

  app:
    image: case-service:local
    command: ["java", "-jar", "/app/app.jar", "server"]
    depends_on:
      migrate:
        condition: service_completed_successfully
```

Note: Compose `depends_on` behavior depends on version/features. For robust local workflow, add database readiness wait/retry.

### 26.3 Local Convenience vs Production Safety

Local:

```text
one command should bootstrap DB
```

Production:

```text
explicit migration step with approval and logs
```

Jangan memaksa production safety pattern terlalu berat untuk local, tapi jangan membawa local shortcut ke production.

---

## 27. CI/CD Workflow for Non-Spring Migration

Recommended pipeline:

```text
1. Build application artifact
2. Build migration artifact/image
3. Run migration tests against real DB container
4. Validate Flyway/Liquibase metadata
5. Generate dry-run SQL if applicable
6. Publish immutable artifacts
7. Deploy migration job to environment
8. Wait for success
9. Verify schema contract
10. Deploy application
11. Run smoke test
12. Mark release successful
```

### 27.1 Pipeline Gate Example

```bash
set -euo pipefail

./run-migration.sh
./verify-schema-contract.sh case-service 2026.06.17
./deploy-application.sh
./run-smoke-test.sh
```

### 27.2 Important Rule

Never do this:

```text
Deploy app first and hope app startup migrates DB.
```

Unless explicitly accepted as a low-risk environment pattern.

---

## 28. Security Model

### 28.1 Separate Users

```text
Runtime user:
  SELECT, INSERT, UPDATE, DELETE, EXECUTE as needed

Migration user:
  CREATE, ALTER, DROP, CREATE INDEX, etc. as needed
```

Migration user should not be used by app runtime.

### 28.2 Secret Handling

Avoid:

- Secrets in `flyway.conf` committed to Git.
- Secrets in Docker image layers.
- Secrets in CLI history.
- Printing DB URL with password in logs.
- Sharing DBA password across teams.

Prefer:

- Environment-injected secrets.
- Kubernetes Secret / external secret manager.
- CI/CD secret store.
- Short-lived credentials where possible.
- Audit of who triggered migration.

### 28.3 App Server Credential Trap

In app server, datasource credential is often hidden from app. That is good. But if app-level startup migration uses the same datasource, runtime user likely needs migration privileges.

Better:

```text
Do not migrate from WAR startup in production.
Run external migration with dedicated migration identity.
```

---

## 29. Audit and Evidence

For enterprise production, keep evidence:

- Migration artifact version.
- Git commit.
- Operator or pipeline run ID.
- Environment.
- Start/end timestamp.
- Tool version.
- Database target.
- Migration list applied.
- Checksum/status.
- Dry-run SQL if required.
- Approval ticket/change request.
- Verification result.

Example deployment log summary:

```text
Application: case-service
Release: 2026.06.17
Migration Tool: Flyway 12.x
Database: prod-core-db
Started: 2026-06-17T10:00:00+07:00
Completed: 2026-06-17T10:01:12+07:00
Applied:
  V202606170900__add_case_priority.sql
  V202606170930__seed_case_priority_lookup.sql
Result: SUCCESS
Pipeline Run: deploy-9182
Change Ticket: CHG-2026-0617-001
```

---

## 30. Common Anti-Patterns

## 30.1 Running Migration from Every App Instance

Bad:

```text
10 pods start -> 10 pods attempt migration
```

Even if locking prevents corruption, it is operationally noisy.

Better:

```text
one migration job -> then app rollout
```

## 30.2 Giving Runtime App User Full DDL Privilege

Bad:

```text
app_user can CREATE, ALTER, DROP everything
```

Better:

```text
app_user minimal runtime privilege
migration_user controlled DDL privilege
```

## 30.3 Hiding Migration Failure in Startup Logs

Bad:

```text
app server failed deploy; migration failure buried in 5000 lines log
```

Better:

```text
migration job has dedicated logs and status
```

## 30.4 Mixing JPA Auto-DDL with Flyway/Liquibase

Bad:

```text
Hibernate changes schema
Flyway thinks schema at version X
Reality differs
```

Better:

```text
Migration tool owns schema.
JPA validates or uses schema.
```

## 30.5 Making Migration Environment-Conditional Inside App Startup

Bad:

```java
if (env.equals("prod")) {
    skipDangerousMigration();
} else {
    runDifferentMigration();
}
```

Better:

- Same artifact.
- Explicit contexts/labels/placeholders.
- Reviewable environment policy.

## 30.6 Using Init Container for Heavy Production Migration

Bad:

```text
every pod migration init container
```

Better:

```text
single migration job before rollout
```

## 30.7 Treating App Server Deployment as Migration Orchestration

Bad:

```text
WAR deployment order accidentally determines database state
```

Better:

```text
release pipeline determines database state explicitly
```

---

## 31. Production-Grade Non-Spring Migration Blueprint

A robust blueprint:

```text
Repository:
  src/main/resources/db/migration
  src/main/java/com/acme/db/DatabaseMigrator.java
  src/main/java/com/acme/app/ApplicationMain.java

Build:
  produce app artifact/image
  produce migration artifact/image or same image with migrate command

CI:
  run migration test on real DB container
  validate migration history/changelog
  generate dry-run SQL when needed

CD:
  run pre-flight checks
  run migration job once
  verify schema contract
  deploy application
  run smoke test

Runtime:
  app uses runtime DB user
  app does not mutate schema
  readiness verifies database contract lightly

Operations:
  logs retained
  applied migrations recorded
  failure runbook available
```

---

## 32. Example: Plain Java Service with Flyway Migration Command

## 32.1 Project Structure

```text
case-service/
  build.gradle
  src/main/java/com/acme/caseapp/ApplicationMain.java
  src/main/java/com/acme/caseapp/CommandMain.java
  src/main/java/com/acme/caseapp/db/MigrateCommand.java
  src/main/resources/db/migration/
    V202606170900__create_case_priority.sql
    V202606170930__seed_case_priority.sql
```

## 32.2 Command Router

```java
package com.acme.caseapp;

import com.acme.caseapp.db.MigrateCommand;

public final class CommandMain {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            throw new IllegalArgumentException("Expected command: migrate | server");
        }

        String command = args[0];
        if ("migrate".equals(command)) {
            MigrateCommand.run();
            return;
        }

        if ("server".equals(command)) {
            ApplicationMain.run();
            return;
        }

        throw new IllegalArgumentException("Unknown command: " + command);
    }
}
```

## 32.3 Migration Command

```java
package com.acme.caseapp.db;

import org.flywaydb.core.Flyway;

public final class MigrateCommand {
    private MigrateCommand() {}

    public static void run() {
        Flyway flyway = Flyway.configure()
                .dataSource(
                        requireEnv("DB_URL"),
                        requireEnv("DB_MIGRATION_USER"),
                        requireEnv("DB_MIGRATION_PASSWORD")
                )
                .locations("classpath:db/migration")
                .cleanDisabled(true)
                .validateOnMigrate(true)
                .baselineOnMigrate(false)
                .load();

        flyway.migrate();
    }

    private static String requireEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalStateException("Missing env var: " + key);
        }
        return value;
    }
}
```

## 32.4 Deployment Commands

Migration:

```bash
java -cp case-service.jar com.acme.caseapp.CommandMain migrate
```

App:

```bash
java -cp case-service.jar com.acme.caseapp.CommandMain server
```

---

## 33. Example: Jakarta EE WAR with External Migration

## 33.1 Recommended Flow

```text
1. Build WAR
2. Extract/copy migration folder into migration artifact
3. Run Flyway/Liquibase CLI against target DB
4. Deploy WAR to app server
```

## 33.2 WAR Does Not Run Migration

In production:

```text
APP_RUN_MIGRATION_ON_STARTUP=false
```

WAR startup only validates lightweight contract:

```java
public class SchemaContractChecker {
    public void assertCompatible(DataSource dataSource) {
        String actual = queryContractVersion(dataSource, "case-web");
        if (!isCompatible(actual, "2026.06.17")) {
            throw new IllegalStateException(
                    "Database schema contract not satisfied. Required=2026.06.17 actual=" + actual
            );
        }
    }
}
```

## 33.3 Deployment Pipeline

```bash
./flyway-migrate-prod.sh
./verify-contract.sh case-web 2026.06.17
./deploy-war-to-appserver.sh case-web.war
./smoke-test.sh
```

---

## 34. Decision Matrix

| Situation | Recommended Pattern |
|---|---|
| Local dev plain Java | In-app or command-based migration |
| Local dev WAR | Servlet listener acceptable with flag |
| Production single-instance internal app | In-app possible but still external preferred |
| Production multi-pod Kubernetes | Kubernetes Job before rollout |
| Production app server cluster | External CLI/pipeline before WAR/EAR deploy |
| Regulated environment | External migration artifact + approval + audit |
| Shared database | Centralized migration ownership and explicit ordering |
| Legacy Java 8 app server | External CLI often simpler than classloader fight |
| Multi-schema system | Separate migration configs per schema with orchestrated order |
| Large backfill | Dedicated batch/job, not startup migration |

---

## 35. Checklist: Non-Spring Migration Readiness

Before production:

- [ ] Migration execution mode chosen explicitly.
- [ ] Startup migration disabled in production unless justified.
- [ ] Migration user separated from runtime user.
- [ ] Flyway/Liquibase version pinned.
- [ ] JDBC driver version pinned.
- [ ] Java runtime compatibility verified.
- [ ] Migration files packaged immutably.
- [ ] Migration tested against real database engine.
- [ ] Existing database upgrade tested.
- [ ] App startup contract check exists.
- [ ] JPA auto-DDL disabled in production.
- [ ] Migration logs retained.
- [ ] Failure runbook prepared.
- [ ] Roll-forward/rollback decision documented.
- [ ] Multi-instance concurrency considered.
- [ ] App server classloader tested if in-app.
- [ ] JNDI datasource privilege reviewed.
- [ ] Kubernetes Job/pipeline waits for migration success.
- [ ] Smoke test validates app + DB compatibility.

---

## 36. Key Takeaways

1. Di non-Spring Java, migration lifecycle harus didesain eksplisit.
2. App startup migration nyaman untuk dev, tetapi sering bukan pilihan terbaik untuk production.
3. Untuk production multi-instance, external migration job/pipeline biasanya lebih aman.
4. Jakarta EE/app server membawa isu tambahan: JNDI datasource, classloader, JTA transaction, deployment ordering, dan cluster startup.
5. Runtime app user sebaiknya tidak punya DDL privilege luas.
6. JPA schema generation harus dimatikan atau dibatasi agar tidak bertabrakan dengan Flyway/Liquibase.
7. Kubernetes init container bukan default yang baik untuk heavy production migration; gunakan Job sebelum rollout.
8. Aplikasi tetap perlu startup/readiness compatibility check agar tidak menerima traffic dengan schema yang salah.
9. Migration harus menjadi bagian dari release choreography, bukan efek samping tersembunyi dari deploy aplikasi.
10. Top-tier engineer mendesain migration agar bisa dijalankan, diamati, dipulihkan, dan diaudit.

---

## 37. Hubungan dengan Part Berikutnya

Bagian ini menjelaskan cara menjalankan migration di luar Spring Boot. Part berikutnya akan naik satu level ke pipeline:

```text
26-cicd-pipeline-database-migration.md
```

Di sana kita akan membahas bagaimana migration masuk ke CI/CD secara production-grade:

- linting,
- validate stage,
- dry-run SQL,
- approval gate,
- environment promotion,
- pre-deploy backup,
- lock check,
- deployment ordering,
- blue/green,
- canary,
- rollback/roll-forward pipeline.

