# Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation

**Seri:** `learn-java-build-gradle-maven-engineering`  
**File:** `13-resource-processing-filtering-profiles-properties-environment-separation.md`  
**Target pembaca:** Java engineer yang ingin naik level dari “bisa build” menjadi mampu mendesain build yang aman, reproducible, maintainable, dan enterprise-grade.  
**Rentang Java:** Java 8 sampai Java 25.  
**Fokus:** Maven dan Gradle.

---

## 0. Kenapa Bagian Ini Penting?

Banyak engineer menganggap resource, profile, dan properties sebagai bagian kecil dari build:

```text
src/main/resources/application.properties
-Denv=dev
mvn -Puat package
gradle -Pprofile=prod build
```

Padahal di sistem enterprise, area ini sering menjadi sumber masalah besar:

- artifact berbeda antar environment;
- secret ikut ter-package ke JAR/WAR;
- config dev masuk ke production;
- build lokal berhasil tetapi CI gagal;
- profile aktif diam-diam karena environment variable;
- Docker image yang sama ternyata punya behavior berbeda;
- resource filtering merusak binary file;
- placeholder `${...}` bentrok dengan Spring, Jakarta, atau template engine;
- release tidak reproducible karena timestamp, hostname, user, path, atau Git state dimasukkan ke artifact;
- deployment tidak bisa diaudit karena artifact production bukan artifact yang dites di QA.

Pada level dasar, resource processing adalah “copy file ke `target/classes` atau `build/resources/main`”. Pada level top engineer, resource processing adalah **boundary antara build-time reality dan runtime reality**.

Mental model utama bagian ini:

```text
Source Code + Resources + Build Logic + Build Inputs
        |
        v
Build-Time Transformation
        |
        v
Artifact
        |
        v
Runtime Configuration Injection
        |
        v
Running System
```

Kesalahan paling umum adalah mencampur dua dunia:

```text
Build-time concern  : versi artifact, generated metadata, static resource, compile-time feature
Runtime concern     : database URL, credentials, endpoint prod, API token, pod identity, region
Deployment concern  : replica, memory, ingress, secret mount, config map, JVM flags
```

Top 1% engineer tidak hanya bertanya:

> “Bagaimana cara bikin profile dev/prod?”

Tetapi bertanya:

> “Apakah artifact yang saya build harus berbeda antara dev, UAT, dan prod? Kalau iya, kenapa? Apa risikonya? Apa yang harus masuk artifact, dan apa yang harus diinjeksi saat runtime?”

---

## 1. Resource dalam Build Java

Dalam Java build, resource adalah file non-`.java` yang ikut masuk ke classpath runtime.

Contoh umum:

```text
src/main/resources/
  application.properties
  application.yml
  logback.xml
  META-INF/services/com.example.Plugin
  db/migration/V1__init.sql
  templates/email/welcome.html
  static/logo.png
  i18n/messages_en.properties
```

Saat build:

- Maven biasanya menyalin resource ke `target/classes` lewat fase `process-resources`.
- Gradle Java plugin biasanya menyalin resource ke `build/resources/main` lewat task `processResources`.

Lalu saat packaging:

```text
target/classes/...             -> masuk ke JAR/WAR
build/resources/main/...       -> masuk ke JAR/WAR bersama compiled classes
```

Resource pada akhirnya bisa dibaca melalui classpath:

```java
try (InputStream in = getClass().getResourceAsStream("/application.properties")) {
    // read resource
}
```

Atau:

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
try (InputStream in = cl.getResourceAsStream("db/migration/V1__init.sql")) {
    // read resource
}
```

### 1.1 Resource Bukan Sekadar File

Resource adalah bagian dari kontrak runtime artifact.

Kalau sebuah file masuk ke JAR:

```text
BOOT-INF/classes/application.yml
META-INF/services/...
db/migration/...
```

maka file itu ikut dibawa ke semua environment yang memakai artifact tersebut.

Implikasinya:

- resource harus aman untuk dipublish;
- resource tidak boleh mengandung secret production;
- resource yang berbeda per environment akan membuat artifact berbeda;
- resource yang ter-package sulit diganti tanpa rebuild, kecuali framework mendukung external override;
- resource bisa memengaruhi behavior runtime meskipun source code sama.

---

## 2. Resource Processing vs Resource Filtering

Ada dua operasi yang sering dicampur:

```text
Resource processing : menyalin resource dari source directory ke output directory.
Resource filtering  : menyalin resource sambil mengganti placeholder dengan nilai tertentu.
```

Contoh resource processing tanpa filtering:

```text
src/main/resources/logback.xml
        -> target/classes/logback.xml
```

Contoh resource filtering:

```properties
app.name=${project.artifactId}
app.version=${project.version}
app.build.time=${build.timestamp}
```

menjadi:

```properties
app.name=order-service
app.version=1.4.2
app.build.time=2026-06-17T10:20:00Z
```

Resource filtering berguna, tetapi berbahaya kalau digunakan tanpa boundary.

### 2.1 Kapan Filtering Masuk Akal?

Filtering cocok untuk metadata build yang memang berasal dari build:

```text
artifact id
artifact version
Git commit id
build number
schema version
static generated banner
OpenAPI generated version
implementation title
implementation vendor
```

Contoh sehat:

```properties
build.artifact=${project.artifactId}
build.version=${project.version}
build.commit=${git.commit.id.abbrev}
```

Kenapa sehat?

Karena nilai-nilai tersebut bagian dari identitas artifact, bukan konfigurasi environment.

### 2.2 Kapan Filtering Tidak Sehat?

Filtering berbahaya untuk runtime config:

```properties
spring.datasource.url=${prod.database.url}
spring.datasource.password=${prod.database.password}
external.payment.api-key=${payment.api.key}
```

Masalahnya:

- secret masuk ke artifact;
- artifact dev/UAT/prod berbeda;
- artifact yang dites QA bukan artifact yang jalan di prod;
- rotasi credential butuh rebuild;
- artifact repository menjadi tempat penyimpanan secret;
- forensic/audit sulit karena build profile menentukan behavior production.

Prinsip yang lebih sehat:

```text
Build artifact once.
Promote the same artifact.
Inject environment-specific configuration at runtime.
```

---

## 3. Maven Resource Processing Mental Model

Maven Resources Plugin menyalin resources dari elemen `project.build.resources` ke output directory. Goal `resources:resources` terikat secara default ke fase `process-resources` pada lifecycle Maven. Plugin ini juga mendukung filtering variable seperti `${...}` atau `@...@` yang nilainya dapat berasal dari project properties, system properties, filter files, atau command line.

Mental model Maven:

```text
pom.xml
  |
  +-- properties
  +-- build.resources
  +-- filters
  +-- profiles
  +-- plugin configuration
        |
        v
process-resources phase
        |
        v
target/classes
        |
        v
package phase
        |
        v
JAR/WAR/EAR
```

### 3.1 Default Maven Layout

Default:

```text
src/main/resources       -> target/classes
src/test/resources       -> target/test-classes
```

Biasanya Anda tidak perlu mendefinisikan ini eksplisit kecuali ingin menambah directory atau mengaktifkan filtering.

### 3.2 Maven Resource Filtering Sederhana

Contoh `pom.xml`:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>order-service</artifactId>
  <version>1.4.2</version>

  <build>
    <resources>
      <resource>
        <directory>src/main/resources</directory>
        <filtering>true</filtering>
      </resource>
    </resources>
  </build>
</project>
```

Resource:

```properties
app.name=${project.artifactId}
app.version=${project.version}
```

Output:

```properties
app.name=order-service
app.version=1.4.2
```

Ini terlihat mudah, tetapi terlalu global. Semua file di `src/main/resources` akan difilter. Itu bisa merusak file binary atau file yang kebetulan punya placeholder.

### 3.3 Pattern Lebih Aman: Pisahkan Filtered dan Non-Filtered Resources

Struktur:

```text
src/main/resources/
  logback.xml
  db/migration/V1__init.sql
  static/logo.png

src/main/filtered-resources/
  build-info.properties
```

POM:

```xml
<build>
  <resources>
    <resource>
      <directory>src/main/resources</directory>
      <filtering>false</filtering>
    </resource>

    <resource>
      <directory>src/main/filtered-resources</directory>
      <filtering>true</filtering>
    </resource>
  </resources>
</build>
```

Resource:

```properties
build.artifact=${project.artifactId}
build.version=${project.version}
```

Keuntungan:

- filtering hanya terjadi pada file yang memang didesain untuk filtering;
- binary resource aman;
- SQL/template tidak rusak;
- review lebih mudah;
- boundary build metadata jelas.

### 3.4 Maven Filters File

Maven bisa memakai file filter:

```text
src/main/filters/build.properties
```

Isi:

```properties
company.name=Example Corp
build.channel=internal
```

POM:

```xml
<build>
  <filters>
    <filter>src/main/filters/build.properties</filter>
  </filters>

  <resources>
    <resource>
      <directory>src/main/filtered-resources</directory>
      <filtering>true</filtering>
    </resource>
  </resources>
</build>
```

Resource:

```properties
vendor=${company.name}
channel=${build.channel}
```

Namun hati-hati: filter file sering disalahgunakan untuk menyimpan environment config atau secret.

Rule:

```text
Filter file boleh menyimpan metadata build non-secret.
Filter file tidak boleh menyimpan password, token, database URL production, private key, atau tenant secret.
```

---

## 4. Gradle Resource Processing Mental Model

Pada Gradle Java plugin, resource untuk source set utama diproses oleh task `processResources`. Output-nya biasanya ke:

```text
build/resources/main
```

Mental model Gradle:

```text
settings.gradle(.kts)
build.gradle(.kts)
gradle.properties
sourceSets
processResources task
        |
        v
build/resources/main
        |
        v
jar/war/bootJar task
```

Gradle memperlakukan resource processing sebagai task graph. Ini berarti task punya input/output, bisa incremental, bisa cacheable jika dikonfigurasi benar, dan bisa menjadi sumber masalah bila input-nya tidak dideklarasikan.

### 4.1 Gradle Resource Filtering Sederhana

Kotlin DSL:

```kotlin
plugins {
    java
}

tasks.processResources {
    expand(
        mapOf(
            "artifactId" to project.name,
            "version" to project.version
        )
    )
}
```

Resource:

```properties
app.name=${artifactId}
app.version=${version}
```

Namun `expand` memakai template expansion berbasis Groovy. Placeholder `${...}` dapat bentrok dengan framework lain yang juga memakai format tersebut.

### 4.2 Pattern Lebih Aman: Filter File Tertentu Saja

```kotlin
tasks.processResources {
    filesMatching("build-info.properties") {
        expand(
            mapOf(
                "artifactId" to project.name,
                "version" to project.version
            )
        )
    }
}
```

Dengan ini, hanya file tertentu yang difilter.

### 4.3 Declare Inputs untuk Reproducibility dan Cacheability

Kalau nilai filtering berasal dari property, deklarasikan input:

```kotlin
val buildCommit = providers.gradleProperty("buildCommit").orElse("unknown")

tasks.processResources {
    inputs.property("buildCommit", buildCommit)

    filesMatching("build-info.properties") {
        expand("buildCommit" to buildCommit.get())
    }
}
```

Kenapa penting?

Karena Gradle harus tahu bahwa output `processResources` bergantung pada `buildCommit`. Kalau tidak, Gradle bisa mengira task up-to-date padahal input logis berubah.

Lebih aman lagi hindari `.get()` terlalu awal jika ingin menjaga lazy configuration. Untuk kasus sederhana dalam action `filesMatching`, `.get()` terjadi saat task dijalankan, bukan saat build script dievaluasi, tetapi dalam plugin kompleks gunakan Provider API secara disiplin.

---

## 5. Properties: Sumber Nilai dalam Build

Properties bisa datang dari banyak tempat.

### 5.1 Maven Property Sources

Dalam Maven, nilai bisa berasal dari:

```text
POM properties
project model properties
system properties
user properties via -D
settings.xml profiles
environment variables via env.X
filter files
plugin configuration
parent POM
active profile
```

Contoh:

```bash
mvn package -DbuildCommit=abc123
```

POM/resource bisa membaca:

```properties
build.commit=${buildCommit}
```

Environment variable biasanya diakses sebagai:

```xml
${env.JAVA_HOME}
${env.PATH}
```

Masalahnya bukan property-nya, tetapi **precedence dan visibility**. Banyak property bisa saling menimpa, dan active profile bisa mengubah nilai secara implisit.

### 5.2 Gradle Property Sources

Gradle mengenal beberapa kategori besar:

```text
Gradle properties        : mengatur Gradle behavior, misalnya daemon, JVM args, cache
Project properties       : input untuk build logic, bisa dari -P atau gradle.properties
System properties        : JVM system properties, biasanya -D
Environment variables    : dari OS/CI
Provider API             : akses lazy ke property/env
```

Contoh project property:

```bash
gradle build -PbuildCommit=abc123
```

Kotlin DSL:

```kotlin
val buildCommit = providers.gradleProperty("buildCommit").orElse("unknown")
```

Environment variable:

```kotlin
val ci = providers.environmentVariable("CI").orElse("false")
```

Prinsip penting:

```text
Gunakan Provider API untuk membaca nilai eksternal secara lazy dan deklaratif.
Hindari System.getenv() atau System.getProperty() tersebar di build script/plugin.
```

Kenapa?

Karena build graph, configuration cache, dan task cache butuh input yang terlihat oleh Gradle.

---

## 6. Profile: Mekanisme Variasi Build

Profile adalah cara mengubah build berdasarkan kondisi atau pilihan.

Namun profile sering menjadi jebakan karena mudah mengubah terlalu banyak hal.

### 6.1 Maven Profile

Maven profile bisa mengubah:

```text
properties
dependencies
repositories
plugin configuration
resources
build settings
```

Contoh:

```xml
<profiles>
  <profile>
    <id>dev</id>
    <properties>
      <build.channel>dev</build.channel>
    </properties>
  </profile>

  <profile>
    <id>release</id>
    <properties>
      <build.channel>release</build.channel>
    </properties>
  </profile>
</profiles>
```

Aktivasi eksplisit:

```bash
mvn package -Pdev
mvn package -Prelease
```

Maven juga mendukung implicit profile activation berdasarkan kondisi environment seperti JDK, OS, property, atau file. Fitur ini berguna, tetapi berisiko karena build bisa berubah tanpa terlihat dari command utama.

### 6.2 Gradle Tidak Punya Profile Bawaan seperti Maven

Gradle biasanya memakai:

```text
project properties
system properties
environment variables
separate tasks
convention plugins
source sets
conditional configuration
```

Contoh:

```kotlin
val buildChannel = providers.gradleProperty("buildChannel").orElse("dev")

tasks.processResources {
    inputs.property("buildChannel", buildChannel)
    filesMatching("build-info.properties") {
        expand("buildChannel" to buildChannel.get())
    }
}
```

Command:

```bash
gradle build -PbuildChannel=release
```

### 6.3 Profile Sehat vs Profile Berbahaya

Profile sehat:

```text
- enable integration tests
- enable signing only for release
- choose publishing repository snapshot/release
- attach source/javadoc JAR
- set build metadata channel
- choose Java toolchain for compatibility test
- include optional quality gate
```

Profile berbahaya:

```text
- inject database password into artifact
- replace application-prod.yml into JAR
- compile different business logic for prod
- switch dependency implementation silently
- enable/disable security code by environment
- activate profile based on developer machine path
```

Rule praktis:

```text
Profile boleh mengubah build behavior.
Profile sebaiknya tidak mengubah runtime identity secara environment-specific.
```

---

## 7. Environment Separation: Build-Time vs Runtime vs Deployment-Time

Ini bagian paling penting.

### 7.1 Tiga Jenis Konfigurasi

```text
Build-time configuration
  Nilai yang diperlukan untuk menghasilkan artifact.

Runtime configuration
  Nilai yang diperlukan aplikasi saat berjalan.

Deployment-time configuration
  Nilai yang diperlukan platform deployment untuk menjalankan aplikasi.
```

Contoh:

| Jenis | Contoh | Boleh Masuk Artifact? |
|---|---|---|
| Build-time | artifact version | Ya |
| Build-time | Git commit | Ya |
| Build-time | generated OpenAPI client version | Ya |
| Runtime | DB URL | Umumnya tidak |
| Runtime | API key | Tidak |
| Runtime | feature flag dynamic | Tidak |
| Deployment-time | CPU/memory limit | Tidak |
| Deployment-time | Kubernetes namespace | Tidak |
| Deployment-time | replica count | Tidak |

### 7.2 Immutable Artifact Principle

Prinsip:

```text
Build once, deploy many.
```

Alur sehat:

```text
Commit
  -> CI build
  -> test artifact
  -> publish artifact
  -> deploy same artifact to DEV
  -> promote same artifact to UAT
  -> promote same artifact to PROD
```

Alur berbahaya:

```text
Commit
  -> build DEV artifact
  -> build UAT artifact
  -> build PROD artifact
```

Masalah alur kedua:

- tiap environment punya artifact berbeda;
- hasil test DEV/UAT tidak membuktikan artifact PROD;
- risiko profile salah;
- risiko secret bocor;
- sulit audit;
- rollback tidak jelas;
- reproducibility melemah.

### 7.3 Externalized Configuration

Aplikasi modern sebaiknya mengambil runtime config dari luar artifact:

```text
Environment variable
System property
Config file mounted outside artifact
Kubernetes ConfigMap/Secret
AWS SSM Parameter Store
AWS Secrets Manager
Vault
Spring Cloud Config
JNDI/server config legacy
command line argument
```

Contoh Spring Boot runtime override:

```bash
java -jar app.jar \
  --spring.datasource.url=jdbc:postgresql://db/prod \
  --spring.datasource.username=app_user
```

Atau:

```bash
SPRING_DATASOURCE_URL=jdbc:postgresql://db/prod \
SPRING_DATASOURCE_USERNAME=app_user \
java -jar app.jar
```

Build tidak perlu tahu nilai production DB.

---

## 8. Secret Handling dalam Build

Rule utama:

```text
Build system boleh memakai secret untuk mengakses dependency repository atau signing.
Build artifact tidak boleh mengandung secret runtime.
```

### 8.1 Secret yang Mungkin Diperlukan saat Build

Contoh secret build-time yang valid:

```text
Maven repository credential
Gradle publishing credential
GPG signing key
Docker registry credential
Sonar token
private Git token untuk checkout dependency internal
```

Namun secret ini harus:

- disediakan oleh CI secret manager;
- tidak dicetak ke log;
- tidak dimasukkan ke resource;
- tidak masuk generated file;
- tidak masuk JAR/WAR;
- scope-nya minimal;
- rotatable;
- tidak disimpan di `pom.xml`, `build.gradle`, atau committed `gradle.properties`.

### 8.2 Secret Anti-Pattern

Anti-pattern:

```properties
# src/main/resources/application-prod.properties
spring.datasource.password=SuperSecret123
```

Anti-pattern:

```xml
<properties>
  <prod.password>SuperSecret123</prod.password>
</properties>
```

Anti-pattern:

```kotlin
tasks.processResources {
    expand("dbPassword" to System.getenv("PROD_DB_PASSWORD"))
}
```

Kenapa buruk?

Karena output resource akan berisi password dan ikut dipackage.

### 8.3 Secret Scanning untuk Artifact

Build pipeline enterprise sebaiknya punya gate:

```text
scan source
scan generated resources
scan packaged artifact
scan Docker image layer
scan build logs
```

Minimal checklist:

```bash
jar tf app.jar | grep -i "application-prod"
jar xf app.jar
 grep -R "password\|secret\|token\|AKIA\|PRIVATE KEY" .
```

Untuk real pipeline, gunakan secret scanner yang proper, tetapi konsep manual ini membantu debugging.

---

## 9. Placeholder Collision

Placeholder collision terjadi ketika beberapa sistem memakai sintaks yang sama.

Contoh file Spring:

```properties
service.url=${SERVICE_URL:http://localhost:8080}
```

Jika Maven filtering aktif global, Maven bisa mencoba mengganti `${SERVICE_URL:http://localhost:8080}` sebagai Maven property, lalu hasilnya rusak.

Contoh lain:

```yaml
message: "Hello ${user.name}"
```

Maven/Gradle bisa menganggap ini placeholder build, padahal maksudnya placeholder runtime/template.

### 9.1 Solusi Maven: Gunakan Delimiter Berbeda

Maven Resource Plugin mendukung delimiter seperti `@...@`.

Resource:

```properties
build.version=@project.version@
runtime.url=${SERVICE_URL:http://localhost:8080}
```

Konfigurasi filtering bisa diarahkan agar memakai delimiter yang lebih aman.

### 9.2 Solusi Gradle: Filter File Spesifik dan Placeholder Spesifik

Hindari filtering seluruh resource directory.

```kotlin
tasks.processResources {
    filesMatching("build-info.properties") {
        expand("version" to project.version)
    }
}
```

Jangan filter `application.yml` kecuali benar-benar paham risiko collision.

---

## 10. Binary Resource Corruption

Resource filtering membaca file sebagai text lalu mengganti token. Jika filtering diterapkan ke binary file, file bisa rusak.

Contoh binary resource:

```text
.png
.jpg
.pdf
.p12
.jks
.class
.ttf
.xlsx
.docx
```

Anti-pattern Maven:

```xml
<resource>
  <directory>src/main/resources</directory>
  <filtering>true</filtering>
</resource>
```

Kalau folder tersebut berisi binary, risiko korup.

Pattern aman:

```xml
<resource>
  <directory>src/main/resources</directory>
  <filtering>false</filtering>
</resource>
<resource>
  <directory>src/main/filtered-resources</directory>
  <filtering>true</filtering>
</resource>
```

Atau exclude binary extension.

---

## 11. Build Metadata: Apa yang Layak Masuk Artifact?

Build metadata adalah informasi untuk observability dan traceability artifact.

Contoh sehat:

```properties
build.group=com.example
build.artifact=order-service
build.version=1.4.2
build.commit=abc1234
build.branch=main
build.java.version=21
build.time=2026-06-17T00:00:00Z
```

Namun ada trade-off reproducibility.

### 11.1 Build Time vs Reproducibility

Jika setiap build memasukkan waktu saat ini:

```properties
build.time=2026-06-17T10:20:15Z
```

maka artifact tidak bit-by-bit reproducible kecuali timestamp dikontrol.

Pilihan:

1. Tidak memasukkan build time.
2. Memasukkan source date epoch yang deterministic.
3. Memasukkan CI build timestamp yang memang bagian dari release identity.
4. Memisahkan metadata deployment dari artifact.

Untuk release reproducible, hindari `Instant.now()` di build.

### 11.2 Git Dirty State

Metadata seperti:

```properties
git.dirty=true
```

berguna untuk build lokal, tetapi release build harus menolak dirty state.

Policy:

```text
Local build boleh dirty.
CI release build harus clean.
```

---

## 12. Maven Profiles: Advanced Mental Model

Maven profile bukan hanya “env switch”. Ia mengubah effective POM.

```text
pom.xml + parent POM + active profiles + settings.xml
        |
        v
effective POM
        |
        v
lifecycle execution
```

Artinya, untuk memahami build Maven, Anda harus tahu profile mana yang aktif.

Command penting:

```bash
mvn help:active-profiles
mvn help:effective-pom
mvn help:effective-settings
```

### 12.1 Explicit Profile Lebih Mudah Diaudit

Lebih baik:

```bash
mvn clean verify -Prelease
```

Daripada profile otomatis berdasarkan file lokal:

```xml
<activation>
  <file>
    <exists>/Users/fajar/dev.flag</exists>
  </file>
</activation>
```

Profile otomatis bisa berguna, tetapi di enterprise build harus dibatasi.

### 12.2 Jangan Gunakan Profile untuk Mengganti Source Code

Anti-pattern:

```xml
<profile>
  <id>prod</id>
  <build>
    <sourceDirectory>src/prod/java</sourceDirectory>
  </build>
</profile>
```

Ini membuat artifact prod bisa memiliki source berbeda dari artifact test.

Kalau memang ada variasi behavior:

- gunakan feature flag runtime;
- gunakan strategy/plugin architecture;
- gunakan dependency injection;
- gunakan build variant hanya jika benar-benar library distribution membutuhkan variant eksplisit.

---

## 13. Gradle Properties: Advanced Mental Model

Gradle build sebaiknya memodelkan external input secara eksplisit.

Buruk:

```kotlin
val env = System.getenv("ENV") ?: "dev"
```

Lebih baik:

```kotlin
val environmentName = providers.gradleProperty("environmentName").orElse("dev")
```

Kalau memang environment variable dari CI:

```kotlin
val ciBuildNumber = providers.environmentVariable("BUILD_NUMBER").orElse("local")
```

Kemudian deklarasikan input task:

```kotlin
tasks.processResources {
    inputs.property("ciBuildNumber", ciBuildNumber)
}
```

### 13.1 `gradle.properties` Lokasi

Gradle properties bisa berasal dari beberapa lokasi:

```text
GRADLE_USER_HOME/gradle.properties
project root gradle.properties
installation gradle.properties
command line -P
```

Praktik sehat:

```text
Committed project gradle.properties:
  - non-secret default
  - JVM args build jika aman
  - org.gradle.caching=true jika policy mengizinkan

User home gradle.properties:
  - credential lokal developer
  - local signing config
  - local performance tweak

CI secret/env:
  - token
  - password
  - signing key
```

Jangan commit credential ke project `gradle.properties`.

---

## 14. Environment-Specific Resource Files

Banyak project memiliki struktur seperti ini:

```text
src/main/resources/application-dev.yml
src/main/resources/application-uat.yml
src/main/resources/application-prod.yml
```

Ini tidak selalu salah. Masalahnya tergantung isi.

### 14.1 Kapan Masih Dapat Diterima?

Dapat diterima jika file hanya berisi default non-secret dan tidak membuat artifact berbeda.

Contoh:

```yaml
# application-dev.yml
logging:
  level:
    com.example: DEBUG
```

Tapi bahkan ini perlu dipertimbangkan, karena artifact production akan membawa file dev.

### 14.2 Kapan Berbahaya?

Berbahaya jika berisi:

```text
password
token
private key
prod hostname sensitif
internal endpoint sensitif
tenant secret
credential cloud
```

Atau jika build memilih salah satu file untuk dimasukkan ke artifact:

```text
mvn package -Pprod -> memasukkan application-prod.yml
mvn package -Puat  -> memasukkan application-uat.yml
```

Ini melanggar immutable artifact.

### 14.3 Pattern Alternatif

Artifact hanya membawa default:

```text
application.yml
```

Isi:

```yaml
server:
  port: ${SERVER_PORT:8080}

spring:
  datasource:
    url: ${DB_URL:}
    username: ${DB_USERNAME:}
    password: ${DB_PASSWORD:}
```

Runtime environment menyediakan:

```text
DB_URL
DB_USERNAME
DB_PASSWORD
```

Untuk Kubernetes:

```text
ConfigMap -> non-secret config
Secret    -> secret config
```

Untuk AWS:

```text
SSM Parameter Store / Secrets Manager -> synced/injected at runtime
```

---

## 15. Case Study 1: Build Metadata Tanpa Merusak Runtime Config

### Problem

Tim ingin endpoint `/actuator/info` atau `/version` menampilkan:

```text
artifact
version
commit
build channel
```

Tapi tidak ingin resource filtering menyentuh `application.yml`.

### Maven Solution

Struktur:

```text
src/main/resources/application.yml
src/main/filtered-resources/build-info.properties
```

`build-info.properties`:

```properties
build.artifact=@project.artifactId@
build.version=@project.version@
build.commit=@git.commit@
```

POM:

```xml
<properties>
  <git.commit>unknown</git.commit>
</properties>

<build>
  <resources>
    <resource>
      <directory>src/main/resources</directory>
      <filtering>false</filtering>
    </resource>
    <resource>
      <directory>src/main/filtered-resources</directory>
      <filtering>true</filtering>
    </resource>
  </resources>
</build>
```

CI:

```bash
mvn clean verify -Dgit.commit="$GIT_COMMIT"
```

### Gradle Solution

`src/main/resources/build-info.properties`:

```properties
build.artifact=${artifact}
build.version=${version}
build.commit=${commit}
```

`build.gradle.kts`:

```kotlin
val gitCommit = providers.gradleProperty("gitCommit").orElse("unknown")

tasks.processResources {
    inputs.property("gitCommit", gitCommit)
    inputs.property("artifact", project.name)
    inputs.property("version", project.version.toString())

    filesMatching("build-info.properties") {
        expand(
            "artifact" to project.name,
            "version" to project.version,
            "commit" to gitCommit.get()
        )
    }
}
```

CI:

```bash
gradle clean build -PgitCommit="$GIT_COMMIT"
```

Key point:

```text
Filter hanya build-info.properties.
Runtime config tetap runtime config.
```

---

## 16. Case Study 2: Profile Dev/UAT/Prod yang Salah Desain

### Kondisi Awal

POM:

```xml
<profiles>
  <profile>
    <id>dev</id>
    <properties>
      <db.url>jdbc:oracle:thin:@dev-db:1521/APP</db.url>
    </properties>
  </profile>
  <profile>
    <id>prod</id>
    <properties>
      <db.url>jdbc:oracle:thin:@prod-db:1521/APP</db.url>
    </properties>
  </profile>
</profiles>
```

Resource:

```properties
spring.datasource.url=${db.url}
```

Build:

```bash
mvn package -Pprod
```

### Masalah

```text
Artifact prod berbeda dari artifact dev.
Database URL masuk ke JAR.
Release ulang diperlukan jika endpoint berubah.
Salah profile bisa menghasilkan artifact salah.
QA tidak mengetes artifact yang sama dengan prod.
```

### Desain Lebih Baik

Resource:

```properties
spring.datasource.url=${DB_URL:}
```

Build:

```bash
mvn clean verify
```

Runtime:

```bash
DB_URL=jdbc:oracle:thin:@prod-db:1521/APP java -jar app.jar
```

Atau Kubernetes:

```yaml
env:
  - name: DB_URL
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: db-url
```

Artifact sama; config diinjeksi saat runtime.

---

## 17. Case Study 3: Gradle Up-To-Date Salah Karena Input Tidak Dideklarasikan

### Problem

Build script:

```kotlin
tasks.processResources {
    filesMatching("build-info.properties") {
        expand("commit" to System.getenv("GIT_COMMIT"))
    }
}
```

Kadang output tidak berubah ketika `GIT_COMMIT` berubah.

### Root Cause

Gradle tidak otomatis tahu bahwa environment variable tersebut adalah input task, terutama jika tidak dimodelkan dengan Provider API dan `inputs.property`.

### Fix

```kotlin
val gitCommit = providers.environmentVariable("GIT_COMMIT").orElse("unknown")

tasks.processResources {
    inputs.property("gitCommit", gitCommit)

    filesMatching("build-info.properties") {
        expand("commit" to gitCommit.get())
    }
}
```

Mental model:

```text
Jika output task bergantung pada nilai X, maka X harus menjadi input task.
```

---

## 18. Case Study 4: Resource Filtering Merusak SQL Migration

### Problem

`src/main/resources/db/migration/V1__init.sql`:

```sql
CREATE TABLE message_template (
  body VARCHAR(4000) DEFAULT 'Hello ${name}'
);
```

Maven filtering global aktif:

```xml
<resource>
  <directory>src/main/resources</directory>
  <filtering>true</filtering>
</resource>
```

Build menghasilkan SQL yang berubah/rusak.

### Fix

Pisahkan resource:

```xml
<resources>
  <resource>
    <directory>src/main/resources</directory>
    <filtering>false</filtering>
  </resource>
  <resource>
    <directory>src/main/filtered-resources</directory>
    <filtering>true</filtering>
  </resource>
</resources>
```

Atau filter hanya include tertentu:

```xml
<resource>
  <directory>src/main/resources</directory>
  <filtering>true</filtering>
  <includes>
    <include>build-info.properties</include>
  </includes>
</resource>
<resource>
  <directory>src/main/resources</directory>
  <filtering>false</filtering>
  <excludes>
    <exclude>build-info.properties</exclude>
  </excludes>
</resource>
```

---

## 19. Configuration Matrix: Local, CI, Release, Runtime

Engineer perlu membedakan empat mode:

```text
Local developer build
CI verification build
Release build
Runtime execution
```

### 19.1 Local Developer Build

Tujuan:

```text
cepat
mudah debug
boleh memakai local defaults
boleh skip sebagian expensive task jika eksplisit
```

Namun local build tetap tidak boleh butuh secret production.

### 19.2 CI Verification Build

Tujuan:

```text
clean environment
repeatable
full verification
no hidden local profile
no dependency from developer machine
```

Command ideal:

```bash
mvn clean verify
./gradlew clean build
```

Dengan explicit flags untuk hal yang benar-benar perlu:

```bash
-Drevision=1.4.2
-PgitCommit=abc123
```

### 19.3 Release Build

Tujuan:

```text
artifact identity final
version fixed
source clean
dependency locked/pinned
signing/publishing enabled
secret minimal
```

### 19.4 Runtime Execution

Tujuan:

```text
artifact yang sama dapat jalan di environment berbeda
config runtime diinjeksi oleh platform
secret tidak berasal dari artifact
```

---

## 20. Multi-Module Resource Strategy

Pada multi-module project, resource config sering menjadi kacau.

Anti-pattern:

```text
common/src/main/resources/application.yml
service-a/src/main/resources/application.yml
service-b/src/main/resources/application.yml
```

Jika `common` adalah library, jangan taruh `application.yml` framework-level di dalamnya kecuali sangat sengaja. Library yang membawa `application.yml` bisa memengaruhi aplikasi consumer.

### 20.1 Library Module Resource Rule

Library boleh membawa:

```text
META-INF/services/...
default template non-secret
i18n bundle
schema file
static metadata
```

Library sebaiknya tidak membawa:

```text
application.yml
logback.xml
production config
datasource config
server port
security realm config
```

### 20.2 Application Module Resource Rule

Application module boleh membawa:

```text
application.yml default
logback.xml jika memang app-specific
db migration milik app
static assets
runtime template
```

Namun environment-specific value tetap external.

---

## 21. Resource Collision di Classpath

Jika dua JAR punya resource path sama:

```text
application.properties
logback.xml
META-INF/services/com.example.Plugin
```

Maka behavior bergantung pada classpath order dan framework.

Contoh:

```text
library-a.jar!/logback.xml
application.jar!/logback.xml
```

Ini buruk. Library tidak boleh membawa `logback.xml` default yang mengontrol aplikasi.

Untuk service provider:

```text
META-INF/services/...
```

collision bisa valid karena Java SPI menggabungkan entries dari classpath. Tapi untuk file config tunggal, collision sering menjadi bug.

Checklist:

```bash
jar tf dependency.jar | grep -E 'application\.yml|application\.properties|logback\.xml'
```

---

## 22. Runtime Override Semantics

Build engineer perlu tahu framework runtime config resolution.

Contoh umum pada modern Java app:

```text
command line args
system properties
environment variables
external config file
classpath application.yml
framework defaults
```

Urutannya berbeda antar framework. Ini bukan hanya urusan runtime team karena build menentukan config apa yang ada di classpath.

Prinsip:

```text
Classpath resource should provide safe defaults.
External runtime config should provide environment-specific values.
```

---

## 23. Maven Template: Safe Resource Filtering

Contoh lengkap minimal:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>order-service</artifactId>
  <version>1.4.2</version>

  <properties>
    <git.commit>unknown</git.commit>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <build>
    <resources>
      <resource>
        <directory>src/main/resources</directory>
        <filtering>false</filtering>
      </resource>

      <resource>
        <directory>src/main/filtered-resources</directory>
        <filtering>true</filtering>
      </resource>
    </resources>

    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-resources-plugin</artifactId>
        <version>3.5.0</version>
        <configuration>
          <encoding>UTF-8</encoding>
          <useDefaultDelimiters>false</useDefaultDelimiters>
          <delimiters>
            <delimiter>@</delimiter>
          </delimiters>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

`src/main/filtered-resources/build-info.properties`:

```properties
build.artifact=@project.artifactId@
build.version=@project.version@
build.commit=@git.commit@
```

Command:

```bash
mvn clean verify -Dgit.commit=$(git rev-parse --short HEAD)
```

---

## 24. Gradle Template: Safe Resource Filtering

`build.gradle.kts`:

```kotlin
plugins {
    java
}

group = "com.example"
version = "1.4.2"

val gitCommit = providers.gradleProperty("gitCommit").orElse("unknown")

tasks.processResources {
    inputs.property("artifact", project.name)
    inputs.property("version", project.version.toString())
    inputs.property("gitCommit", gitCommit)

    filesMatching("build-info.properties") {
        expand(
            mapOf(
                "artifact" to project.name,
                "version" to project.version.toString(),
                "commit" to gitCommit.get()
            )
        )
    }
}
```

`src/main/resources/build-info.properties`:

```properties
build.artifact=${artifact}
build.version=${version}
build.commit=${commit}
```

Command:

```bash
./gradlew clean build -PgitCommit=$(git rev-parse --short HEAD)
```

Catatan: jika `${...}` bentrok dengan runtime placeholder, gunakan file khusus atau delimiter lain via filtering mechanism yang lebih spesifik.

---

## 25. Profiles untuk Testing, Bukan Environment Artifact

Profile/build property sangat cocok untuk mengaktifkan test suite.

### Maven Integration Test Profile

```xml
<profiles>
  <profile>
    <id>integration-test</id>
    <build>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-failsafe-plugin</artifactId>
          <version>3.5.4</version>
          <executions>
            <execution>
              <goals>
                <goal>integration-test</goal>
                <goal>verify</goal>
              </goals>
            </execution>
          </executions>
        </plugin>
      </plugins>
    </build>
  </profile>
</profiles>
```

Command:

```bash
mvn verify -Pintegration-test
```

Ini sehat karena profile mengubah verification depth, bukan runtime config production.

### Gradle Integration Test Property

Lebih baik gunakan task terpisah:

```bash
./gradlew test integrationTest
```

Daripada:

```bash
./gradlew build -Penv=prod
```

---

## 26. Runtime Config Validation

Kalau runtime config external, aplikasi harus memvalidasi config saat startup.

Jangan biarkan aplikasi gagal jauh di tengah request karena config kosong.

Contoh prinsip:

```text
At startup:
  - DB_URL must exist
  - DB_USERNAME must exist
  - DB_PASSWORD must exist
  - EXTERNAL_API_BASE_URL must be valid URL
  - timeout must be positive
  - feature flags must have valid enum value
```

Dalam Spring Boot, bisa memakai configuration properties + validation. Dalam Jakarta/MicroProfile, bisa memakai config API dan validation layer. Ini bukan bahasan detail framework, tetapi build strategy perlu mempertimbangkan bahwa runtime config external harus divalidasi.

---

## 27. Resource Filtering dan Reproducible Build

Resource filtering bisa membuat build non-reproducible jika memasukkan nilai volatile:

```text
current timestamp
absolute path
username
hostname
random UUID
local timezone
non-normalized Git metadata
CI run id yang berubah
```

Contoh buruk:

```properties
build.user=${user.name}
build.path=${project.basedir}
build.time=${maven.build.timestamp}
```

Jika tujuan Anda reproducible release, hindari nilai ini atau jadikan nilai explicit, stable, dan documented.

### 27.1 Stable Input Principle

```text
Output artifact should be a function of declared stable inputs.
```

Stabil:

```text
source commit
project version
locked dependencies
fixed build tool version
fixed JDK/toolchain
normalized timestamp
```

Tidak stabil:

```text
current clock
local username
workspace path
machine hostname
ambient environment variable
unlocked dependency version
```

---

## 28. Build-Time Feature Flag vs Runtime Feature Flag

Kadang tim ingin:

```text
compile feature X hanya untuk customer A
compile feature Y hanya untuk customer B
```

Ini build-time variant. Bisa valid untuk product distribution, tetapi mahal.

Konsekuensi:

- test matrix bertambah;
- artifact count bertambah;
- vulnerability scanning bertambah;
- release coordination bertambah;
- support complexity bertambah;
- reproducibility lebih sulit;
- dependency graph bisa berbeda.

Alternatif:

```text
runtime feature flag
license-based activation
tenant config
dynamic policy engine
module/plugin loading
```

Rule:

```text
Gunakan build-time variant hanya jika perbedaan harus terjadi sebelum runtime:
  - native image variant
  - platform-specific artifact
  - customer-specific legal distribution
  - library classifier
  - optional module packaging
```

Untuk behavior bisnis biasa, runtime flag sering lebih sehat.

---

## 29. Checklist Desain Resource dan Profile

Gunakan checklist ini saat review PR build.

### 29.1 Resource Checklist

```text
[ ] Apakah resource yang masuk artifact memang aman?
[ ] Apakah ada secret dalam src/main/resources?
[ ] Apakah filtering hanya diterapkan ke file yang perlu?
[ ] Apakah binary file tidak difilter?
[ ] Apakah placeholder build tidak bentrok dengan placeholder runtime?
[ ] Apakah library module tidak membawa application.yml/logback.xml yang mengontrol app?
[ ] Apakah resource collision sudah dicek?
[ ] Apakah generated resource deterministic?
[ ] Apakah artifact bisa dipromosikan antar environment tanpa rebuild?
```

### 29.2 Profile Checklist

```text
[ ] Apakah profile diaktifkan eksplisit?
[ ] Apakah profile tidak memasukkan secret/runtime config ke artifact?
[ ] Apakah profile tidak mengganti source code production?
[ ] Apakah profile tidak mengganti dependency secara diam-diam?
[ ] Apakah active profile bisa diaudit di CI log?
[ ] Apakah effective POM dicek untuk Maven build kritikal?
[ ] Apakah Gradle property dideklarasikan sebagai task input jika memengaruhi output?
```

### 29.3 Environment Checklist

```text
[ ] Apakah runtime config diinjeksi oleh platform?
[ ] Apakah config non-secret dan secret dipisahkan?
[ ] Apakah startup validation ada?
[ ] Apakah default config aman?
[ ] Apakah prod config bisa dirotasi tanpa rebuild?
[ ] Apakah artifact yang sama bisa jalan di DEV/UAT/PROD?
```

---

## 30. Failure Taxonomy

Ketika terjadi bug terkait resource/profile, klasifikasikan dulu.

```text
1. Missing resource
   File tidak masuk artifact atau path salah.

2. Wrong resource
   File yang masuk bukan versi yang diharapkan.

3. Corrupted resource
   Filtering merusak isi file.

4. Placeholder unresolved
   Placeholder tidak terganti atau terganti di waktu yang salah.

5. Profile not active
   Build mengira profile aktif, ternyata tidak.

6. Unexpected profile active
   Profile aktif karena implicit activation.

7. Secret leakage
   Secret masuk source, output, artifact, image, atau log.

8. Environment drift
   Local/CI/prod memakai config berbeda tanpa kontrak jelas.

9. Non-reproducible resource
   Output berubah karena timestamp/env/path/randomness.

10. Classpath resource collision
    Resource dari dependency menimpa/mengganggu resource aplikasi.
```

---

## 31. Debugging Workflow Maven

Saat resource Maven bermasalah:

```bash
mvn help:active-profiles
mvn help:effective-pom
mvn help:effective-settings
mvn -X process-resources
```

Cek output:

```bash
find target/classes -type f | sort
cat target/classes/build-info.properties
jar tf target/*.jar | sort | grep build-info
```

Cek profile:

```bash
mvn help:active-profiles -Pdev
mvn help:effective-pom -Pdev > effective-dev.xml
mvn help:effective-pom -Pprod > effective-prod.xml
diff effective-dev.xml effective-prod.xml
```

Cek secret:

```bash
grep -R "password\|secret\|token" target/classes || true
jar xf target/app.jar
grep -R "password\|secret\|token" . || true
```

---

## 32. Debugging Workflow Gradle

Saat resource Gradle bermasalah:

```bash
./gradlew processResources --info
./gradlew processResources --debug
./gradlew properties
./gradlew tasks
```

Cek output:

```bash
find build/resources/main -type f | sort
cat build/resources/main/build-info.properties
jar tf build/libs/*.jar | sort | grep build-info
```

Cek up-to-date behavior:

```bash
./gradlew processResources --rerun-tasks
./gradlew processResources --info
```

Cek dependency/task relation:

```bash
./gradlew processResources --dry-run
```

Jika memakai configuration cache:

```bash
./gradlew build --configuration-cache
```

Perhatikan warning terkait environment access atau undeclared input.

---

## 33. Enterprise Policy Template

Contoh policy yang bisa dipakai untuk tim enterprise:

```text
Resource and Configuration Policy

1. Artifact must be environment-neutral.
2. The same artifact must be promotable from CI to DEV, UAT, and PROD.
3. Runtime secrets must not be stored in source code, build files, resource files, generated files, artifact repository, or build logs.
4. Resource filtering is allowed only for build metadata files explicitly listed in build configuration.
5. Global filtering of src/main/resources is prohibited unless reviewed and justified.
6. Maven profiles and Gradle properties must not inject environment-specific secrets into packaged resources.
7. Profiles may be used for verification depth, release signing, publication target, and optional build tasks.
8. Production runtime configuration must be injected by deployment platform or secret/config service.
9. Build output must declare volatile inputs explicitly or avoid them for reproducibility.
10. CI release pipeline must archive active profile/property summary and artifact checksums.
```

---

## 34. Top 1% Heuristics

### 34.1 Treat Resource as Runtime Contract

Jangan review resource sebagai file biasa. Tanyakan:

```text
Siapa yang membaca file ini?
Kapan file ini dibaca?
Apakah file ini aman untuk semua environment?
Apakah file ini boleh masuk artifact?
Apakah file ini mengandung environment-specific value?
```

### 34.2 Prefer Runtime Injection over Build-Time Mutation

Kalau value berbeda per environment, default jawabannya:

```text
runtime injection
```

bukan:

```text
build profile
```

### 34.3 Filter Narrowly

Filtering harus sempit:

```text
Filter one file intentionally.
Do not filter whole resource tree casually.
```

### 34.4 Make Build Inputs Visible

Di Gradle:

```text
If it changes output, declare it as input.
```

Di Maven:

```text
If it changes effective POM or resource output, make it explicit in command/profile/log.
```

### 34.5 Avoid Hidden Environment Coupling

Build tidak boleh diam-diam bergantung pada:

```text
local file path
machine hostname
user home config
ambient env var
installed tool outside wrapper/toolchain
uncommitted filter file
```

### 34.6 Separate Identity, Configuration, and Secret

```text
Artifact identity : group, artifact, version, commit
Runtime config    : endpoint, timeout, feature flag
Secret            : password, token, key
```

Jangan campur ketiganya.

---

## 35. Ringkasan

Bagian ini membangun mental model bahwa resource processing, filtering, profiles, dan properties bukan sekadar fitur kecil Maven/Gradle. Mereka adalah mekanisme yang menentukan apakah artifact Anda:

- aman;
- reproducible;
- environment-neutral;
- bisa dipromosikan;
- bisa diaudit;
- tidak membocorkan secret;
- tidak bergantung pada local machine;
- tidak berubah diam-diam karena profile/property tersembunyi.

Inti prinsipnya:

```text
Build metadata may be baked into artifact.
Runtime configuration should be injected at runtime.
Secrets must never be baked into artifact.
Profiles should alter build behavior, not secretly define production reality.
Resource filtering should be explicit, narrow, and deterministic.
```

Jika Anda menguasai ini, Anda tidak hanya bisa menulis `pom.xml` atau `build.gradle`. Anda bisa mendesain build pipeline yang layak untuk sistem enterprise, compliance-sensitive, dan production-critical.

---

## 36. Referensi Resmi

- Apache Maven Resources Plugin — Filtering: https://maven.apache.org/plugins/maven-resources-plugin/examples/filter.html
- Apache Maven Resources Plugin — Goals Overview: https://maven.apache.org/plugins/maven-resources-plugin/
- Apache Maven Resources Plugin — `resources:resources`: https://maven.apache.org/plugins/maven-resources-plugin/resources-mojo.html
- Apache Maven — Introduction to Build Profiles: https://maven.apache.org/guides/introduction/introduction-to-profiles.html
- Gradle User Manual — Build Environment Configuration: https://docs.gradle.org/current/userguide/build_environment.html
- Gradle User Manual — Java Plugin: https://docs.gradle.org/current/userguide/java_plugin.html
- Gradle DSL — `ProcessResources`: https://docs.gradle.org/current/dsl/org.gradle.language.jvm.tasks.ProcessResources.html
- Gradle User Manual — Working With Files: https://docs.gradle.org/current/userguide/working_with_files.html

---

## 37. Status Seri

```text
[x] Part 0  — Build Engineering Mental Model
[x] Part 1  — Java Version Strategy: Java 8–25
[x] Part 2  — Maven Core Mental Model
[x] Part 3  — Gradle Core Mental Model
[x] Part 4  — Maven vs Gradle Decision Framework
[x] Part 5  — Project Layout Engineering
[x] Part 6  — Dependency Graph Fundamentals
[x] Part 7  — Dependency Version Management
[x] Part 8  — Repository Engineering
[x] Part 9  — Build Reproducibility
[x] Part 10 — Compiler Engineering
[x] Part 11 — Testing Build Pipeline
[x] Part 12 — Packaging Engineering
[x] Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
[ ] Part 14 — Plugin System Deep Dive: Maven Plugin Anatomy dan Gradle Plugin Anatomy
...
[ ] Part 34 — Top 1% Build Engineer Playbook
```

Seri belum selesai. Bagian berikutnya adalah:

```text
Part 14 — Plugin System Deep Dive: Maven Plugin Anatomy dan Gradle Plugin Anatomy
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 12 — Packaging Engineering: JAR, Fat JAR, Thin JAR, WAR, EAR, Modular JAR, Native Image](./12-packaging-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — Plugin System Deep Dive: Maven Plugin Anatomy dan Gradle Plugin Anatomy](./14-plugin-system-deep-dive.md)

</div>