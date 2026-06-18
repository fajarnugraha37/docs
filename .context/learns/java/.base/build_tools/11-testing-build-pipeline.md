# Part 11 — Testing Build Pipeline: Unit, Integration, Functional, Contract, Mutation, Benchmark

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `11-testing-build-pipeline.md`  
> Target: Java 8–25, Maven, Gradle, enterprise build engineering  
> Level: advanced / top 1% software engineer track

---

## 0. Tujuan Bagian Ini

Testing di build system bukan sekadar menaruh file di `src/test/java` lalu menjalankan `mvn test` atau `gradle test`.

Di level engineer biasa, testing pipeline sering dipahami sebagai:

```text
compile -> test -> package
```

Di level build/platform engineer senior, testing pipeline dipahami sebagai **risk-filtering architecture**:

```text
source change
  -> compile-time correctness
  -> unit correctness
  -> component correctness
  -> integration correctness
  -> contract correctness
  -> behavioral/regression correctness
  -> performance sanity
  -> packaging/runtime correctness
  -> release confidence
```

Artinya, build pipeline harus menjawab pertanyaan berikut:

1. **Apa jenis risiko yang ingin ditangkap?**
2. **Di fase mana risiko itu paling murah ditangkap?**
3. **Apa environment minimum yang dibutuhkan?**
4. **Apakah test ini deterministic?**
5. **Apakah test ini boleh paralel?**
6. **Apakah failure-nya actionable?**
7. **Apakah test ini cocok dijalankan di local, PR CI, nightly, release, atau pre-production?**

Bagian ini akan membangun mental model testing build pipeline yang matang untuk Maven dan Gradle.

---

## 1. Mental Model: Test Bukan Satu Jenis Aktivitas

Kata “test” terlalu umum. Dalam build engineering, test harus diklasifikasikan berdasarkan **scope**, **cost**, **determinism**, **dependency**, dan **signal**.

### 1.1 Dimensi Klasifikasi Test

| Dimensi | Pertanyaan | Contoh |
|---|---|---|
| Scope | Berapa banyak komponen yang disentuh? | method, class, module, service, system |
| Dependency | Butuh external resource? | DB, queue, HTTP service, browser |
| Speed | Berapa lama? | ms, detik, menit, jam |
| Determinism | Hasil stabil? | pure unit test vs timing-sensitive test |
| Isolation | Bisa jalan sendiri? | isolated test vs shared DB state |
| Signal | Failure menunjukkan apa? | bug logic, config salah, kontrak berubah |
| Cost | Mahal dijalankan? | mutation/performance/browser tests |
| Placement | Cocok di mana? | local, PR, nightly, release |

Mental model penting:

```text
Semakin luas scope test,
semakin tinggi confidence,
tetapi biasanya semakin mahal, lambat, dan flaky.
```

Maka pipeline yang sehat tidak menjalankan semua test di semua tempat. Pipeline sehat mengatur test berdasarkan risk/cost trade-off.

---

## 2. Taxonomy Testing dalam Build Pipeline

### 2.1 Unit Test

Unit test menguji unit kecil: method, class, small service object, pure function, domain rule.

Karakter:

```text
Cepat
Deterministic
Tidak butuh network
Tidak butuh real database
Tidak butuh container
Tidak butuh wall-clock nyata
```

Contoh cocok:

- validation rule;
- state transition rule;
- pricing/tax calculation;
- mapping sederhana;
- domain service tanpa IO;
- parser/formatter;
- policy decision function.

Contoh tidak cocok disebut unit test:

- test yang connect ke PostgreSQL/Oracle;
- test yang start Spring context penuh;
- test yang call HTTP server;
- test yang membaca file besar dari network share;
- test yang bergantung urutan execution.

Prinsip:

```text
Unit test adalah test untuk logic, bukan test untuk infrastructure wiring.
```

### 2.2 Component Test

Component test menguji satu module/component dengan sebagian dependency diganti fake/stub.

Contoh:

```text
CaseService + fake repository + fake event publisher
```

Tujuan:

- menguji behavior component secara lebih besar dari unit;
- menjaga test tetap cepat;
- menghindari full system dependency.

### 2.3 Integration Test

Integration test menguji integrasi antar component atau dengan resource nyata.

Contoh:

- service + real database;
- repository + JPA provider + database;
- message publisher + broker;
- HTTP client + mock server;
- module + real file system;
- Spring Boot app + Testcontainers.

Integration test menjawab:

```text
Apakah wiring, configuration, serialization, database schema, transaction, dan external contract bekerja bersama?
```

Integration test bukan pengganti unit test. Integration test menangkap kelas bug yang tidak terlihat di unit test.

### 2.4 Functional Test

Functional test menguji fitur dari sudut pandang use case.

Contoh:

```text
Given user submits renewal application
When application is complete and fee is paid
Then case enters Pending Review state
And audit trail is created
And notification is sent
```

Functional test bisa berada di level:

- API;
- service;
- UI;
- end-to-end.

Fokus functional test adalah **behavior bisnis**, bukan class/method.

### 2.5 Contract Test

Contract test menguji kesepakatan antar service.

Contoh:

- consumer expects field `statusCode` as string;
- provider must support endpoint `GET /cases/{id}`;
- event payload must contain `caseId`, `eventType`, `occurredAt`;
- backward compatibility JSON schema.

Contract test penting untuk microservices dan distributed system karena integration test full environment sering terlalu mahal.

Ada dua sudut:

```text
Consumer-driven contract:
  consumer mendefinisikan expectation
  provider diverifikasi memenuhi expectation

Provider contract/schema test:
  provider mendefinisikan schema
  consumer memvalidasi kompatibilitas
```

### 2.6 End-to-End Test

E2E test menguji sistem dari entrypoint sampai dependency nyata/semu.

Contoh:

```text
Browser -> frontend -> API gateway -> backend -> database -> queue -> notification service
```

E2E test memberi confidence tinggi tetapi mahal dan flaky.

Prinsip senior:

```text
E2E test harus sedikit, kritikal, dan dipilih berdasarkan user journey bernilai tinggi.
```

Bukan semua scenario harus E2E.

### 2.7 Mutation Test

Mutation test mengubah code secara otomatis untuk mengecek apakah test suite mampu menangkap perubahan logic.

Contoh mutation:

```java
// original
return age >= 18;

// mutant
return age > 18;
```

Kalau test tetap pass, berarti test tidak cukup sensitif.

Mutation testing menjawab:

```text
Apakah test benar-benar menguji behavior, atau hanya menjalankan code?
```

Coverage line 90% bisa tetap buruk jika assertion lemah. Mutation testing membantu melihat kualitas assertion.

### 2.8 Benchmark / Performance Test

Benchmark mengukur karakteristik performance.

Contoh:

- latency method parser;
- throughput serializer;
- allocation rate;
- lock contention;
- cache hit/miss effect;
- query performance;
- startup time.

Untuk JVM, microbenchmark harus hati-hati karena JIT, warmup, dead-code elimination, escape analysis, GC, tiered compilation, CPU frequency scaling, dan noise OS bisa membuat hasil menyesatkan.

Prinsip:

```text
Benchmark bukan unit test.
Benchmark adalah measurement experiment.
```

---

## 3. Test Pyramid, Trophy, dan Reality Enterprise

### 3.1 Test Pyramid

Model klasik:

```text
        E2E
      Integration
    Component/API
  Unit
```

Interpretasi:

- unit test banyak;
- integration sedang;
- E2E sedikit.

Namun pyramid sering disalahpahami sebagai “unit test harus selalu dominan”. Yang benar:

```text
Test distribution harus mengikuti risk distribution dan architecture.
```

Sistem dengan domain logic berat butuh banyak unit test.
Sistem CRUD tipis dengan banyak integration boundary mungkin butuh lebih banyak integration/API test.

### 3.2 Test Trophy

Model alternatif:

```text
       E2E
    Integration
       Unit
      Static
```

Static checks seperti compiler, type system, lint, architecture test, dependency check, dan API compatibility bisa menangkap banyak error sebelum test runtime.

Build engineer senior menganggap compiler dan static analysis sebagai bagian dari testing pipeline.

### 3.3 Enterprise Reality

Dalam enterprise Java, risiko besar sering berasal dari:

- database schema mismatch;
- transaction boundary salah;
- lazy loading bug;
- serialization mismatch;
- message contract drift;
- security config salah;
- timezone/date bug;
- external API version mismatch;
- environment-specific config;
- classpath conflict;
- dependency version drift.

Maka pipeline harus punya test untuk risiko-risiko ini, bukan sekadar line coverage.

---

## 4. Maven Testing Mental Model

Maven memiliki lifecycle standar. Testing biasanya tersebar di beberapa phase.

Simplified default lifecycle:

```text
validate
compile
test
package
verify
install
deploy
```

Untuk testing:

```text
test       -> unit test umumnya dijalankan oleh Surefire
integration-test -> integration test dijalankan oleh Failsafe
verify     -> Failsafe mengecek hasil integration test
```

### 4.1 Surefire Plugin

Maven Surefire Plugin biasanya menjalankan unit test pada phase `test`.

Default pattern historis umumnya mencakup nama seperti:

```text
**/Test*.java
**/*Test.java
**/*Tests.java
**/*TestCase.java
```

Contoh konfigurasi:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <version>${maven-surefire-plugin.version}</version>
  <configuration>
    <useModulePath>false</useModulePath>
    <includes>
      <include>**/*Test.java</include>
      <include>**/*Tests.java</include>
    </includes>
  </configuration>
</plugin>
```

Mental model:

```text
Surefire = fast test gate sebelum packaging.
```

Kalau unit test gagal, artifact tidak perlu dibuat.

### 4.2 Failsafe Plugin

Maven Failsafe Plugin digunakan untuk integration test. Pola umum:

```text
**/IT*.java
**/*IT.java
**/*ITCase.java
```

Contoh konfigurasi:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-failsafe-plugin</artifactId>
  <version>${maven-failsafe-plugin.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>integration-test</goal>
        <goal>verify</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Kenapa Failsafe punya dua goal?

```text
integration-test -> menjalankan integration tests
verify           -> mengevaluasi hasil dan menggagalkan build bila test gagal
```

Alasannya historis dan praktis: phase `post-integration-test` harus tetap bisa berjalan untuk cleanup environment, bahkan jika integration test gagal. Kalau test runner langsung menghentikan build terlalu cepat, cleanup bisa terlewat.

### 4.3 Kenapa Surefire dan Failsafe Dipisah?

Karena unit test dan integration test punya karakter berbeda.

| Aspek | Surefire / Unit | Failsafe / Integration |
|---|---|---|
| Phase | `test` | `integration-test` + `verify` |
| Cost | rendah | sedang/tinggi |
| Environment | pure JVM | DB/container/server |
| Naming | `*Test` | `*IT` |
| Failure meaning | logic bug | integration/config/runtime bug |
| Local frequency | sering | selektif |

Anti-pattern:

```text
Semua test dinamai *Test tetapi sebagian start container, DB, server, browser.
```

Dampaknya:

- local build lambat;
- developer malas menjalankan test;
- CI feedback lambat;
- unit test signal tercampur integration failure;
- troubleshooting lebih susah.

### 4.4 Maven Source Layout untuk Integration Test

Maven default hanya mengenal:

```text
src/main/java
src/main/resources
src/test/java
src/test/resources
```

Untuk integration test, ada beberapa strategi.

#### Strategi A — Naming Convention dalam `src/test/java`

```text
src/test/java/.../UserServiceTest.java
src/test/java/.../UserRepositoryIT.java
```

Kelebihan:

- sederhana;
- tidak perlu source set tambahan;
- mudah dipahami.

Kekurangan:

- dependency unit/integration bercampur;
- resource bercampur;
- IDE kadang tidak membedakan jelas.

#### Strategi B — Source Directory Terpisah

```text
src/test/java
src/integrationTest/java
src/integrationTest/resources
```

Maven butuh plugin tambahan seperti `build-helper-maven-plugin` untuk menambahkan test source directory.

Contoh:

```xml
<plugin>
  <groupId>org.codehaus.mojo</groupId>
  <artifactId>build-helper-maven-plugin</artifactId>
  <version>${build-helper-maven-plugin.version}</version>
  <executions>
    <execution>
      <id>add-integration-test-sources</id>
      <phase>generate-test-sources</phase>
      <goals>
        <goal>add-test-source</goal>
        <goal>add-test-resource</goal>
      </goals>
      <configuration>
        <sources>
          <source>src/integrationTest/java</source>
        </sources>
        <resources>
          <resource>
            <directory>src/integrationTest/resources</directory>
          </resource>
        </resources>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Kelebihan:

- boundary lebih jelas;
- dependency/resource bisa lebih rapi;
- lebih cocok untuk project besar.

Kekurangan:

- konfigurasi Maven lebih kompleks;
- harus disiplin dengan IDE dan CI.

### 4.5 Maven Skip Test Semantics

Ada beberapa opsi yang sering membingungkan.

```bash
mvn test
mvn package -DskipTests
mvn package -Dmaven.test.skip=true
```

Perbedaan umum:

```text
-DskipTests
  Compile test source, tetapi tidak menjalankan tests.

-Dmaven.test.skip=true
  Skip compile test source dan skip menjalankan tests.
```

Untuk build release, penggunaan skip harus eksplisit dan dibatasi.

Prinsip governance:

```text
Release build tidak boleh skip tests kecuali ada emergency exception tertulis.
```

---

## 5. Gradle Testing Mental Model

Gradle memodelkan test sebagai task. Default Java plugin membuat task:

```text
test
```

Task `test` adalah instance dari `Test` task type.

Contoh dasar:

```kotlin
plugins {
    java
}

tasks.test {
    useJUnitPlatform()
}
```

Mental model:

```text
Gradle testing = task graph + source sets + configurations + reports.
```

### 5.1 Default Test Task

Default layout:

```text
src/main/java
src/main/resources
src/test/java
src/test/resources
```

Default task:

```bash
./gradlew test
```

Contoh konfigurasi:

```kotlin
tasks.test {
    useJUnitPlatform()
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
```

### 5.2 Gradle Source Set untuk Integration Test

Sebelum JVM Test Suite plugin populer, pola umum adalah membuat source set manual.

```kotlin
sourceSets {
    create("integrationTest") {
        java.srcDir("src/integrationTest/java")
        resources.srcDir("src/integrationTest/resources")
        compileClasspath += sourceSets.main.get().output + configurations.testRuntimeClasspath.get()
        runtimeClasspath += output + compileClasspath
    }
}

val integrationTestImplementation by configurations.getting {
    extendsFrom(configurations.testImplementation.get())
}

val integrationTestRuntimeOnly by configurations.getting {
    extendsFrom(configurations.testRuntimeOnly.get())
}

tasks.register<Test>("integrationTest") {
    description = "Runs integration tests."
    group = "verification"
    testClassesDirs = sourceSets["integrationTest"].output.classesDirs
    classpath = sourceSets["integrationTest"].runtimeClasspath
    shouldRunAfter(tasks.test)
    useJUnitPlatform()
}

tasks.check {
    dependsOn("integrationTest")
}
```

### 5.3 Gradle JVM Test Suite Plugin

Gradle menyediakan JVM Test Suite plugin untuk memodelkan banyak grup test.

Contoh konseptual:

```kotlin
plugins {
    java
    `jvm-test-suite`
}

testing {
    suites {
        val test by getting(JvmTestSuite::class) {
            useJUnitJupiter()
        }

        val integrationTest by registering(JvmTestSuite::class) {
            useJUnitJupiter()

            dependencies {
                implementation(project())
            }

            targets {
                all {
                    testTask.configure {
                        shouldRunAfter(test)
                    }
                }
            }
        }
    }
}

tasks.check {
    dependsOn(testing.suites.named("integrationTest"))
}
```

Mental model:

```text
JVM Test Suite = first-class grouping untuk test berdasarkan purpose.
```

Ini lebih ekspresif dibanding hanya satu task `test`.

### 5.4 Gradle Test Filtering

Menjalankan satu test:

```bash
./gradlew test --tests com.example.UserServiceTest
./gradlew test --tests '*UserServiceTest.shouldCreateUser'
```

Menjalankan integration test:

```bash
./gradlew integrationTest
```

Menjalankan semua verification:

```bash
./gradlew check
```

Prinsip:

```text
Local developer workflow harus punya task kecil dan cepat.
CI workflow harus punya task lengkap dan deterministic.
```

---

## 6. JUnit 4, JUnit 5, TestNG, dan Platform

### 6.1 JUnit 5 Architecture

JUnit 5 bukan satu artifact tunggal. Ia terdiri dari:

```text
JUnit Platform  -> launcher/foundation
JUnit Jupiter   -> programming model + engine untuk JUnit 5
JUnit Vintage   -> engine untuk menjalankan JUnit 3/4 tests
```

Maven contoh:

```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <version>${junit.jupiter.version}</version>
  <scope>test</scope>
</dependency>
```

Gradle contoh:

```kotlin
dependencies {
    testImplementation(platform("org.junit:junit-bom:${junitVersion}"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

tasks.test {
    useJUnitPlatform()
}
```

### 6.2 JUnit 4 Legacy

Banyak Java 8 legacy project masih memakai JUnit 4.

Pola migrasi sehat:

```text
1. Tambahkan JUnit Platform.
2. Jalankan JUnit 4 via Vintage engine bila perlu.
3. Migrasikan test baru ke Jupiter.
4. Hindari campur runner/extension yang membuat behavior tidak jelas.
5. Hapus Vintage setelah semua test lama selesai dimigrasi.
```

### 6.3 TestNG

TestNG masih ditemukan di enterprise legacy dan beberapa test suite yang butuh grouping/parallelism tertentu.

Gradle:

```kotlin
tasks.test {
    useTestNG()
}
```

Maven Surefire juga mendukung TestNG.

Prinsip:

```text
Framework test harus dipilih berdasarkan ecosystem dan maintainability, bukan hanya fitur.
```

---

## 7. Designing Test Stages

Pipeline yang sehat membagi test menjadi stage.

Contoh untuk service Java enterprise:

```text
Stage 1: compile + static checks
Stage 2: unit tests
Stage 3: component tests
Stage 4: integration tests with DB/container
Stage 5: contract tests
Stage 6: packaging smoke tests
Stage 7: mutation/performance/nightly tests
Stage 8: release verification
```

### 7.1 Local Developer Pipeline

Tujuan: feedback cepat.

```bash
mvn test
./gradlew test
```

Atau:

```bash
./gradlew compileJava test --tests '*UserServiceTest'
```

Local pipeline tidak harus menjalankan semua test berat setiap saat.

### 7.2 Pull Request Pipeline

Tujuan: menangkap regression sebelum merge.

Minimal:

```text
compile
unit test
component/API test
static analysis
coverage report
selected integration tests
```

Untuk project besar, integration tests bisa dipilih berdasarkan affected module.

### 7.3 Main Branch Pipeline

Tujuan: menjaga baseline stabil.

```text
full unit
full integration
contract verification
packaging
container build
security scan
```

### 7.4 Nightly Pipeline

Tujuan: expensive confidence.

```text
mutation test
full E2E
performance regression
cross-JDK matrix
long-running test
chaos-ish environment tests
```

### 7.5 Release Pipeline

Tujuan: artifact layak dipromosikan.

```text
clean build
no dependency SNAPSHOT
unit + integration + contract
SBOM
signing
artifact checksum
packaging smoke
publish to staging repository
promotion gate
```

---

## 8. Naming Convention dan Segregation Strategy

Nama test bukan kosmetik. Nama test menentukan lifecycle behavior.

### 8.1 Maven Naming Convention

```text
Unit:
  UserServiceTest.java
  UserServiceTests.java

Integration:
  UserRepositoryIT.java
  UserRepositoryITCase.java
```

### 8.2 Gradle Naming Convention

Gradle tidak memaksakan naming pattern seketat Maven, tetapi tetap baik untuk konsistensi.

```text
src/test/java/.../*Test.java
src/integrationTest/java/.../*IT.java
src/contractTest/java/.../*ContractTest.java
src/functionalTest/java/.../*FunctionalTest.java
```

### 8.3 Naming Based on Risk

Lebih baik test dinamai berdasarkan behavior:

```java
class RenewalEligibilityPolicyTest {
    @Test
    void rejectsRenewalWhenLicenseAlreadyExpiredBeyondGracePeriod() {}
}
```

daripada:

```java
class RenewalTest {
    @Test
    void test1() {}
}
```

Build failure harus readable dari log.

---

## 9. Test Dependency Hygiene

Testing dependency sering menjadi sumber classpath conflict.

### 9.1 Maven Test Scope

```xml
<dependency>
  <groupId>org.assertj</groupId>
  <artifactId>assertj-core</artifactId>
  <version>${assertj.version}</version>
  <scope>test</scope>
</dependency>
```

Test dependency tidak boleh bocor ke runtime artifact.

Cek:

```bash
mvn dependency:tree -Dscope=runtime
mvn dependency:tree -Dscope=test
```

### 9.2 Gradle Test Configurations

```kotlin
dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.assertj:assertj-core")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
```

Perbedaan:

```text
testImplementation
  Dibutuhkan compile dan runtime test.

testRuntimeOnly
  Hanya runtime test.
```

### 9.3 Jangan Pakai Production Dependency untuk Testing Kalau Ada Test-Specific Tool

Contoh:

- gunakan WireMock/MockWebServer untuk HTTP fake;
- gunakan Testcontainers untuk DB/broker nyata;
- gunakan AssertJ/Hamcrest untuk assertion readability;
- gunakan Awaitility untuk async wait daripada `Thread.sleep`.

Anti-pattern:

```java
Thread.sleep(5000);
```

Lebih baik:

```java
await().atMost(Duration.ofSeconds(5))
       .untilAsserted(() -> assertThat(repository.findById(id)).isPresent());
```

---

## 10. Test Fixtures dan Shared Test Code

Project besar sering butuh shared test utility.

### 10.1 Anti-Pattern: `test-utils` sebagai God Module

```text
test-utils
  contains everything:
    fake user
    fake case
    DB helper
    JSON helper
    Spring helper
    Kafka helper
    random date helper
```

Dampak:

- test antar module saling coupling;
- dependency test melebar;
- perubahan helper merusak banyak module;
- test data menjadi tidak jelas.

### 10.2 Pola Lebih Baik

Pisahkan fixture berdasarkan domain/module:

```text
case-domain-test-fixtures
application-test-fixtures
messaging-test-fixtures
database-test-fixtures
```

Atau di Gradle gunakan `java-test-fixtures` plugin:

```kotlin
plugins {
    `java-library`
    `java-test-fixtures`
}

dependencies {
    testFixturesImplementation("org.assertj:assertj-core:${assertjVersion}")
}
```

Consumer:

```kotlin
dependencies {
    testImplementation(testFixtures(project(":case-domain")))
}
```

Maven tidak punya fitur built-in setara yang sebersih Gradle test fixtures, tetapi bisa menggunakan classifier test-jar.

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-jar-plugin</artifactId>
  <executions>
    <execution>
      <goals>
        <goal>test-jar</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Dependency ke test jar:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>case-domain</artifactId>
  <version>${project.version}</version>
  <type>test-jar</type>
  <scope>test</scope>
</dependency>
```

Gunakan hati-hati karena bisa meningkatkan coupling antar module.

---

## 11. Integration Test dengan Database

Database integration test penting untuk Java enterprise.

Risiko yang ditangkap:

- SQL syntax salah;
- schema mismatch;
- migration gagal;
- transaction boundary salah;
- lazy loading exception;
- unique constraint;
- optimistic lock;
- timezone conversion;
- data type mismatch;
- Oracle/PostgreSQL/MySQL behavior difference.

### 11.1 H2 Is Not Your Production Database

H2 berguna untuk test cepat, tetapi bukan pengganti DB production.

Masalah umum:

- SQL dialect berbeda;
- transaction behavior berbeda;
- locking berbeda;
- date/time semantics berbeda;
- sequence/identity behavior berbeda;
- JSON/LOB behavior berbeda;
- constraint behavior berbeda.

Prinsip:

```text
H2 bagus untuk repository smoke test cepat,
tetapi critical database behavior harus diuji pada engine yang sama dengan production.
```

### 11.2 Testcontainers

Testcontainers memungkinkan test menjalankan dependency nyata dalam container.

Contoh JUnit 5:

```java
@Testcontainers
class UserRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test");

    @Test
    void savesUser() {
        // use postgres.getJdbcUrl()
    }
}
```

Untuk Spring Boot:

```java
@Testcontainers
@SpringBootTest
class UserRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
}
```

### 11.3 Database State Management

Ada beberapa strategi.

#### Strategy A — Transaction Rollback per Test

```text
Start transaction
Run test
Rollback transaction
```

Kelebihan:

- cepat;
- state bersih.

Kekurangan:

- tidak menguji commit behavior;
- async consumer tidak melihat uncommitted data;
- berbeda dari real flow.

#### Strategy B — Truncate Before Each Test

```text
TRUNCATE tables
Run test
```

Kelebihan:

- state bersih;
- commit nyata.

Kekurangan:

- lebih lambat;
- foreign key order harus diatur;
- sequence reset perlu diperhatikan.

#### Strategy C — Container per Test Class

Kelebihan:

- isolation kuat.

Kekurangan:

- lambat.

#### Strategy D — Schema per Test Worker

Cocok untuk parallel integration test.

```text
worker-1 -> schema_test_1
worker-2 -> schema_test_2
worker-3 -> schema_test_3
```

Lebih kompleks, tetapi scalable.

---

## 12. Integration Test dengan Messaging

Untuk RabbitMQ/Kafka/JMS, test harus menangkap risiko:

- serialization mismatch;
- topic/queue name salah;
- routing key salah;
- ack/nack behavior;
- retry/DLQ;
- idempotency;
- ordering assumption;
- duplicate message;
- transaction/outbox behavior.

### 12.1 Jangan Hanya Mock Publisher

Mock publisher bisa memastikan method `publish()` dipanggil, tetapi tidak menguji:

- payload valid;
- header benar;
- routing benar;
- consumer bisa deserialize;
- retry behavior benar.

Pola sehat:

```text
Unit test:
  verify decision to publish event

Integration test:
  verify event payload and broker behavior

Contract test:
  verify schema compatibility with consumers
```

### 12.2 Async Test

Jangan pakai sleep fixed.

Anti-pattern:

```java
Thread.sleep(3000);
assertThat(repository.find(...)).isPresent();
```

Pola lebih baik:

```java
await().atMost(Duration.ofSeconds(10))
       .pollInterval(Duration.ofMillis(200))
       .untilAsserted(() -> {
           assertThat(repository.find(...)).isPresent();
       });
```

### 12.3 Idempotency Test

Untuk consumer:

```text
Given same message delivered twice
When consumer processes message
Then side effect happens once
```

Ini penting untuk at-least-once delivery.

---

## 13. HTTP/API Integration Test

### 13.1 Mock Server vs Real Provider

HTTP client integration test bisa memakai:

- WireMock;
- MockWebServer;
- embedded server;
- provider sandbox;
- Testcontainers service.

Mock server cocok untuk consumer behavior:

```text
when provider returns 401 -> client refreshes token
when provider returns 429 -> client backs off
when provider returns malformed payload -> client fails safely
```

Real provider cocok untuk compatibility, tetapi mahal/flaky.

### 13.2 API Test Scope

API test bisa menguji:

- HTTP status;
- headers;
- auth;
- validation error;
- JSON schema;
- pagination;
- idempotency key;
- optimistic lock;
- error contract;
- backward compatibility.

Contoh API-level assertion:

```java
mockMvc.perform(post("/applications")
        .contentType(MediaType.APPLICATION_JSON)
        .content(payload))
    .andExpect(status().isCreated())
    .andExpect(jsonPath("$.id").exists())
    .andExpect(jsonPath("$.status").value("DRAFT"));
```

---

## 14. Contract Testing

Contract testing mengurangi kebutuhan full E2E semua service.

### 14.1 Problem yang Dipecahkan

Dalam distributed system:

```text
Consumer A expects field X
Provider B renames field X to Y
Provider tests pass
Consumer breaks in production
```

Contract testing membuat expectation eksplisit.

### 14.2 Consumer-Driven Contract

Flow:

```text
Consumer defines contract
Provider verifies contract
Contract published to broker/repository
CI checks compatibility
```

### 14.3 Schema Compatibility

Untuk event-driven system:

- JSON Schema;
- Avro schema;
- Protobuf schema;
- AsyncAPI;
- OpenAPI;
- custom schema validation.

Compatibility rules:

```text
Backward compatible:
  old consumer can read new provider output

Forward compatible:
  new consumer can read old provider output

Full compatible:
  both directions acceptable
```

### 14.4 Contract Test Placement

```text
Consumer PR:
  generate/validate expected contract

Provider PR:
  verify provider satisfies published contracts

Release:
  verify compatibility against supported consumer versions
```

---

## 15. Mutation Testing

### 15.1 Why Coverage Is Not Enough

Line coverage only asks:

```text
Did test execute this line?
```

Mutation testing asks:

```text
Would test fail if behavior changed?
```

Contoh:

```java
boolean isEligible(int age) {
    return age >= 18;
}
```

Weak test:

```java
@Test
void eligibility() {
    assertThat(isEligible(20)).isTrue();
}
```

Mutant:

```java
return age > 18;
```

Test masih pass. Boundary age 18 tidak diuji.

Strong test:

```java
@Test
void acceptsExactly18() {
    assertThat(isEligible(18)).isTrue();
}

@Test
void rejects17() {
    assertThat(isEligible(17)).isFalse();
}
```

### 15.2 PIT Mutation Testing

PIT umum digunakan untuk Java mutation testing.

Maven contoh konseptual:

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>${pitest.version}</version>
  <configuration>
    <targetClasses>
      <param>com.example.domain.*</param>
    </targetClasses>
    <targetTests>
      <param>com.example.domain.*Test</param>
    </targetTests>
  </configuration>
</plugin>
```

Gradle biasanya memakai plugin PIT pihak ketiga.

### 15.3 Kapan Mutation Test Dijalankan?

Mutation testing mahal. Jangan selalu jalankan di setiap local build.

Placement sehat:

```text
Local selective:
  module/domain tertentu

PR selective:
  changed critical module

Nightly:
  broader mutation suite

Release:
  critical domain package only
```

### 15.4 Mutation Testing Target

Mutation testing paling bernilai untuk:

- domain rules;
- authorization decisions;
- pricing/fee calculation;
- state machine;
- validation policy;
- escalation logic;
- regulatory decision rules.

Kurang bernilai untuk:

- DTO getter/setter;
- generated code;
- framework wiring;
- trivial adapters.

---

## 16. Code Coverage Engineering

### 16.1 Coverage sebagai Signal, Bukan Tujuan

Coverage bukan bukti correctness.

```text
High coverage can still have weak assertions.
Low coverage can hide untested risk.
```

Coverage berguna untuk:

- melihat area belum disentuh test;
- mencegah regression test discipline;
- membantu review risk;
- quality gate minimum.

Coverage buruk jika dipakai sebagai vanity metric.

### 16.2 JaCoCo Maven

Contoh:

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>${jacoco.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>
    <execution>
      <id>report</id>
      <phase>verify</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>
    <execution>
      <id>check</id>
      <goals>
        <goal>check</goal>
      </goals>
      <configuration>
        <rules>
          <rule>
            <element>BUNDLE</element>
            <limits>
              <limit>
                <counter>LINE</counter>
                <value>COVEREDRATIO</value>
                <minimum>0.80</minimum>
              </limit>
            </limits>
          </rule>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 16.3 JaCoCo Gradle

```kotlin
plugins {
    java
    jacoco
}

tasks.test {
    useJUnitPlatform()
    finalizedBy(tasks.jacocoTestReport)
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

tasks.jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                counter = "LINE"
                value = "COVEREDRATIO"
                minimum = "0.80".toBigDecimal()
            }
        }
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestCoverageVerification)
}
```

### 16.4 Coverage Gate yang Realistis

Buruk:

```text
All modules must be 90% coverage immediately.
```

Lebih baik:

```text
Critical domain module: 85–95%
Infrastructure adapter: 60–80%
Generated code: excluded
Legacy module: baseline + no decrease
New code: higher threshold
```

### 16.5 Exclusion Policy

Boleh exclude:

- generated code;
- DTO murni;
- config bootstrap tertentu;
- framework entrypoint trivial;
- migration classes tertentu.

Tidak boleh exclude:

- domain policy;
- security rule;
- state transition;
- fee calculation;
- regulatory decision logic.

---

## 17. Benchmarking dengan JMH

### 17.1 Kenapa JMH?

JVM performance tidak bisa diukur dengan loop manual sederhana.

Anti-pattern:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    service.calculate(input);
}
System.out.println(System.nanoTime() - start);
```

Masalah:

- JIT warmup tidak dikontrol;
- dead-code elimination;
- constant folding;
- GC noise;
- CPU frequency scaling;
- branch prediction;
- unrealistic workload;
- no statistical rigor.

JMH membantu mengatur warmup, measurement iteration, fork, blackhole, mode, dan reporting.

### 17.2 Contoh JMH

```java
@State(Scope.Thread)
public class FeeCalculatorBenchmark {

    private FeeCalculator calculator;
    private Application application;

    @Setup
    public void setup() {
        calculator = new FeeCalculator();
        application = TestApplications.validRenewal();
    }

    @Benchmark
    public BigDecimal calculateFee() {
        return calculator.calculate(application);
    }
}
```

### 17.3 Benchmark Placement

Jangan jalankan benchmark sebagai unit test.

Pola:

```text
src/jmh/java
benchmark task terpisah
nightly/performance pipeline
manual investigation pipeline
```

### 17.4 Interpreting Benchmark

Jangan hanya lihat average.

Lihat:

- throughput;
- average time;
- p95/p99 bila relevant;
- allocation rate;
- GC count;
- confidence interval;
- variance;
- fork consistency;
- realistic input distribution.

Prinsip:

```text
Benchmark result yang tidak bisa dijelaskan tidak boleh dijadikan dasar keputusan arsitektur.
```

---

## 18. Parallel Test Execution

Parallelism bisa mempercepat build, tetapi bisa membuka bug isolation.

### 18.1 Maven Parallel Build vs Parallel Test

Maven parallel module build:

```bash
mvn -T 1C verify
```

Ini menjalankan module secara paralel jika dependency order memungkinkan.

Surefire/Failsafe juga punya konfigurasi parallel test, tetapi harus hati-hati.

### 18.2 Gradle Parallelism

Gradle parallel project execution:

```bash
./gradlew test --parallel
```

Test fork parallel:

```kotlin
tasks.test {
    maxParallelForks = Runtime.getRuntime().availableProcessors().coerceAtMost(4)
}
```

### 18.3 Preconditions untuk Parallel Test

Test aman paralel jika:

- tidak memakai shared mutable static state;
- tidak memakai fixed port sama;
- tidak menulis file path sama;
- tidak memakai database schema sama tanpa isolation;
- tidak bergantung urutan;
- tidak mengubah global timezone/locale tanpa reset;
- tidak mengubah system property global sembarangan.

### 18.4 Common Parallel Test Failures

```text
BindException: Address already in use
Unique constraint violation from reused test data
Flaky assertion due to async timing
Static mock leaks to other tests
System property changed by another test
Temp file collision
Docker container resource exhaustion
```

---

## 19. Flaky Tests

Flaky test adalah test yang kadang pass, kadang fail, tanpa perubahan code relevan.

### 19.1 Penyebab Umum

| Penyebab | Contoh |
|---|---|
| Time | assert exact timestamp |
| Async | event belum diproses |
| Order | test bergantung urutan |
| Shared state | static map tidak dibersihkan |
| External service | network/API sandbox tidak stabil |
| Randomness | random input tanpa seed |
| Resource | port/file/db collision |
| Concurrency | race condition |
| Environment | timezone/locale beda |
| Performance | timeout terlalu ketat |

### 19.2 Flaky Test Policy

Anti-pattern:

```text
Retry all tests 3 times and ignore instability.
```

Lebih baik:

```text
1. Detect flaky tests.
2. Quarantine jika menghambat pipeline.
3. Buat ticket dengan owner dan deadline.
4. Jalankan quarantined suite terpisah.
5. Jangan hitung quarantined test sebagai release confidence.
```

### 19.3 Retry dengan Hati-Hati

Retry boleh untuk mengurangi noise, tetapi harus tetap terlihat.

Rule:

```text
Retried-pass != clean-pass.
```

CI harus mencatat retry count dan trend.

---

## 20. Test Data Engineering

Test data adalah salah satu sumber kompleksitas terbesar.

### 20.1 Principles

```text
Test data must be explicit.
Test data must be minimal.
Test data must express intent.
Test data must avoid accidental coupling.
```

Buruk:

```java
Application app = TestDataFactory.createApplication1();
```

Lebih baik:

```java
Application app = RenewalApplicationBuilder.valid()
    .withExpiredLicenseDate(LocalDate.of(2024, 1, 1))
    .withGracePeriodExceeded()
    .build();
```

### 20.2 Builder Pattern untuk Test Data

```java
public final class RenewalApplicationBuilder {
    private LocalDate expiryDate = LocalDate.now().plusDays(30);
    private boolean feePaid = true;

    public static RenewalApplicationBuilder valid() {
        return new RenewalApplicationBuilder();
    }

    public RenewalApplicationBuilder withExpiredLicenseDate(LocalDate date) {
        this.expiryDate = date;
        return this;
    }

    public RenewalApplicationBuilder withUnpaidFee() {
        this.feePaid = false;
        return this;
    }

    public RenewalApplication build() {
        return new RenewalApplication(expiryDate, feePaid);
    }
}
```

### 20.3 Golden Master / Snapshot Test

Snapshot test berguna untuk output besar seperti JSON/report/template.

Risiko:

- snapshot di-update tanpa review;
- test hanya mendeteksi change, bukan correctness;
- fragile terhadap ordering/timestamp.

Gunakan untuk:

- report format;
- generated API docs;
- serialization compatibility;
- email template rendering.

Normalisasi dynamic field:

```text
timestamp -> <TIMESTAMP>
id        -> <ID>
random    -> <RANDOM>
```

---

## 21. Time, Randomness, Locale, Timezone

Banyak test enterprise flaky karena waktu.

### 21.1 Inject Clock

Buruk:

```java
LocalDate.now()
Instant.now()
```

Lebih baik:

```java
class RenewalPolicy {
    private final Clock clock;

    RenewalPolicy(Clock clock) {
        this.clock = clock;
    }

    boolean isExpired(LocalDate expiryDate) {
        return expiryDate.isBefore(LocalDate.now(clock));
    }
}
```

Test:

```java
Clock fixedClock = Clock.fixed(
    Instant.parse("2026-06-17T00:00:00Z"),
    ZoneOffset.UTC
);
```

### 21.2 Fix Timezone in Build

Maven:

```xml
<configuration>
  <argLine>-Duser.timezone=UTC -Duser.language=en -Duser.country=US</argLine>
</configuration>
```

Gradle:

```kotlin
tasks.withType<Test>().configureEach {
    systemProperty("user.timezone", "UTC")
    systemProperty("user.language", "en")
    systemProperty("user.country", "US")
}
```

### 21.3 Random Seed

Property-based testing atau random data harus mencetak seed saat gagal.

```text
Failed with seed: 83920123
```

Tanpa seed, failure sulit direproduksi.

---

## 22. Packaging Smoke Test

Banyak build pass tetapi artifact tidak bisa dijalankan.

Penyebab:

- missing runtime dependency;
- wrong main class;
- broken fat JAR;
- config file tidak masuk artifact;
- duplicate service loader file;
- module path issue;
- native library missing;
- Docker image tidak punya JRE cocok.

Packaging smoke test menjawab:

```text
Artifact yang diproduksi build benar-benar bisa start/run minimal?
```

Contoh:

```text
Build JAR
Run java -jar app.jar --version
Run health endpoint with test profile
Verify process exits/start successfully
```

Maven bisa memakai plugin seperti failsafe + exec/docker plugin, atau CI script.
Gradle bisa membuat task custom yang depend on `bootJar`/`jar`.

---

## 23. Multi-Module Testing Strategy

### 23.1 Maven Reactor

Dalam Maven multi-module:

```bash
mvn verify
```

Maven menjalankan module sesuai reactor order.

Menjalankan module tertentu dan dependencies:

```bash
mvn -pl application-service -am test
```

Menjalankan module tertentu dan dependents:

```bash
mvn -pl domain-core -amd test
```

### 23.2 Gradle Multi-Project

```bash
./gradlew :application-service:test
./gradlew :application-service:integrationTest
./gradlew test
```

Gradle dapat menjalankan task di semua project yang punya task tersebut.

### 23.3 Affected Module Testing

Untuk repo besar:

```text
changed files
  -> affected module
  -> dependent modules
  -> selected test tasks
```

Risiko:

- dependency graph tidak lengkap;
- generated code dependency tidak terdeteksi;
- test fixture dependency terlewat;
- runtime-only coupling tidak terlihat.

Affected testing harus konservatif.

---

## 24. CI Cache dan Test Performance

### 24.1 Cache Dependency

CI harus cache Maven/Gradle dependencies, tetapi jangan sampai cache poisoning.

Maven:

```text
~/.m2/repository
```

Gradle:

```text
~/.gradle/caches
~/.gradle/wrapper
```

### 24.2 Cache Test Outputs?

Gradle build cache bisa reuse task output jika input sama. Untuk test, ini harus hati-hati.

Test cache aman jika:

- test deterministic;
- semua input dideklarasikan;
- tidak bergantung external state;
- environment property relevan masuk input;
- tidak membaca file random di luar input.

Kalau test membaca database shared, network, current time, atau env var tanpa deklarasi, caching bisa menyesatkan.

### 24.3 Split Slow Tests

Strategi:

```text
fast unit tests < 1 min
integration tests < 5–10 min
E2E separate
mutation nightly
benchmark manual/nightly
```

Jika unit test > 5 menit, biasanya ada masalah:

- terlalu banyak Spring context;
- test sebenarnya integration;
- startup container di unit phase;
- no parallelism;
- slow IO;
- excessive mocking framework overhead;
- test data terlalu berat.

---

## 25. Spring/Jakarta Enterprise Testing Placement

### 25.1 Spring Boot Test Cost

`@SpringBootTest` mahal karena start application context penuh.

Gunakan jika perlu:

- full wiring;
- configuration integration;
- embedded server;
- real security chain;
- database + transaction + context.

Untuk slice:

- `@WebMvcTest`;
- `@DataJpaTest`;
- `@JsonTest`;
- custom slice.

Prinsip:

```text
Jangan pakai full application context untuk logic yang bisa diuji sebagai plain Java object.
```

### 25.2 Jakarta EE / Container Testing

Untuk Jakarta EE, testing bisa mencakup:

- unit test POJO;
- integration test CDI bean;
- container-managed transaction test;
- JPA provider test;
- servlet/JAX-RS endpoint test;
- deployment packaging test.

Legacy tools bisa termasuk Arquillian, embedded container, atau integration environment.

### 25.3 Keycloak SPI / Plugin Testing

Untuk plugin/SPI:

```text
Unit test:
  mapper/policy logic

Integration test:
  plugin loads in runtime/container

Packaging smoke:
  JAR has correct service descriptor

Compatibility test:
  run against target Keycloak/Java version
```

Build harus memastikan `META-INF/services` dan dependencies benar.

---

## 26. Security Testing in Build Pipeline

Testing pipeline juga harus menangkap security regression.

Jenis:

- dependency vulnerability scan;
- secret scan;
- SAST;
- authorization rule test;
- authentication flow test;
- input validation test;
- deserialization safety test;
- SSRF/path traversal test;
- dependency license check;
- SBOM generation.

Security tests yang sebaiknya ditulis seperti normal behavior test:

```text
Given user has role OFFICER
When accessing supervisor-only endpoint
Then request is rejected with 403
```

Untuk authorization, test harus mencakup:

- allowed path;
- denied path;
- boundary role;
- ownership rule;
- tenant/agency boundary;
- object-level permission;
- workflow state permission.

---

## 27. Failure Taxonomy: Membaca Test Failure dengan Cepat

### 27.1 Compile Test Failure

```text
cannot find symbol
package does not exist
method not applicable
```

Kemungkinan:

- dependency test missing;
- generated test source belum dibuat;
- Java version mismatch;
- annotation processor test missing;
- module dependency salah.

### 27.2 Test Discovery Failure

```text
No tests found
TestEngine with ID 'junit-jupiter' failed
Cannot create Launcher
```

Kemungkinan:

- JUnit engine missing;
- `useJUnitPlatform()` belum diset;
- Surefire/Failsafe version terlalu lama;
- test naming pattern tidak match;
- module path issue.

### 27.3 Runtime Classpath Failure

```text
NoClassDefFoundError
ClassNotFoundException
NoSuchMethodError
AbstractMethodError
```

Kemungkinan:

- dependency version conflict;
- test runtime dependency missing;
- binary incompatible version;
- Maven mediation salah;
- Gradle conflict resolution tidak sesuai expectation;
- shaded dependency.

### 27.4 Environment Failure

```text
Connection refused
Timeout waiting for container
Access denied
Port already in use
```

Kemungkinan:

- Docker unavailable;
- fixed port collision;
- external service down;
- CI resource limit;
- missing credential;
- firewall/proxy.

### 27.5 Flaky/Timing Failure

```text
Expected event but not found
Timeout after 1 second
Intermittent assertion failure
```

Kemungkinan:

- async wait buruk;
- timeout terlalu ketat;
- race condition;
- shared state;
- test order dependency.

---

## 28. Maven Templates

### 28.1 Maven Unit + Integration + JaCoCo Template

```xml
<properties>
  <maven-surefire-plugin.version>3.5.3</maven-surefire-plugin.version>
  <maven-failsafe-plugin.version>3.5.3</maven-failsafe-plugin.version>
  <jacoco.version>0.8.12</jacoco.version>
  <junit.jupiter.version>5.11.4</junit.jupiter.version>
</properties>

<dependencies>
  <dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter</artifactId>
    <version>${junit.jupiter.version}</version>
    <scope>test</scope>
  </dependency>
  <dependency>
    <groupId>org.assertj</groupId>
    <artifactId>assertj-core</artifactId>
    <version>${assertj.version}</version>
    <scope>test</scope>
  </dependency>
</dependencies>

<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>${maven-surefire-plugin.version}</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-failsafe-plugin</artifactId>
        <version>${maven-failsafe-plugin.version}</version>
      </plugin>
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>${jacoco.version}</version>
      </plugin>
    </plugins>
  </pluginManagement>

  <plugins>
    <plugin>
      <groupId>org.jacoco</groupId>
      <artifactId>jacoco-maven-plugin</artifactId>
      <executions>
        <execution>
          <goals>
            <goal>prepare-agent</goal>
          </goals>
        </execution>
        <execution>
          <id>report</id>
          <phase>verify</phase>
          <goals>
            <goal>report</goal>
          </goals>
        </execution>
      </executions>
    </plugin>

    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-surefire-plugin</artifactId>
      <configuration>
        <useModulePath>false</useModulePath>
      </configuration>
    </plugin>

    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-failsafe-plugin</artifactId>
      <executions>
        <execution>
          <goals>
            <goal>integration-test</goal>
            <goal>verify</goal>
          </goals>
        </execution>
      </executions>
      <configuration>
        <useModulePath>false</useModulePath>
      </configuration>
    </plugin>
  </plugins>
</build>
```

### 28.2 Maven Commands

```bash
# unit tests
mvn test

# full verification including integration tests
mvn verify

# specific test
mvn -Dtest=UserServiceTest test

# specific integration test
mvn -Dit.test=UserRepositoryIT verify

# module + dependencies
mvn -pl application-service -am verify

# parallel reactor
mvn -T 1C verify
```

---

## 29. Gradle Templates

### 29.1 Gradle Kotlin DSL Unit + Integration + JaCoCo

```kotlin
plugins {
    java
    jacoco
    `jvm-test-suite`
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.assertj:assertj-core:3.27.3")
}

tasks.test {
    useJUnitPlatform()
    systemProperty("user.timezone", "UTC")
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
    finalizedBy(tasks.jacocoTestReport)
}

testing {
    suites {
        val integrationTest by registering(JvmTestSuite::class) {
            useJUnitJupiter()

            dependencies {
                implementation(project())
                implementation("org.assertj:assertj-core:3.27.3")
            }

            targets {
                all {
                    testTask.configure {
                        shouldRunAfter(tasks.test)
                        systemProperty("user.timezone", "UTC")
                    }
                }
            }
        }
    }
}

tasks.check {
    dependsOn(testing.suites.named("integrationTest"))
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}
```

### 29.2 Gradle Commands

```bash
# unit tests
./gradlew test

# integration tests
./gradlew integrationTest

# all verification
./gradlew check

# specific test
./gradlew test --tests '*UserServiceTest'

# specific method
./gradlew test --tests '*UserServiceTest.rejectsInvalidApplication'

# continue after failure to collect all failures
./gradlew check --continue

# inspect slow build
./gradlew test --scan
```

---

## 30. Testing Java 8–25

### 30.1 JDK Matrix

Untuk library yang mendukung Java 8–25:

```text
Compile target: Java 8
Test matrix:
  JDK 8
  JDK 11
  JDK 17
  JDK 21
  JDK 25
```

Untuk application modern:

```text
Compile/runtime baseline: Java 21 or 25
Test matrix:
  baseline JDK
  target runtime container JDK
```

### 30.2 Why Test Across JDKs?

Karena:

- behavior JDK library bisa berubah;
- illegal reflective access bisa gagal;
- security defaults berubah;
- TLS/cert behavior berubah;
- GC/performance berubah;
- bytecode/tooling compatibility berubah;
- annotation processors bisa tidak compatible.

### 30.3 Maven Toolchains

Maven dapat memakai Toolchains untuk memilih JDK compile/test tertentu.

Konsep:

```text
JDK that runs Maven != JDK used by compiler/tests
```

### 30.4 Gradle Toolchains

Gradle Java Toolchains bisa mengatur compiler/test launcher.

Contoh:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.test {
    javaLauncher.set(
        javaToolchains.launcherFor {
            languageVersion.set(JavaLanguageVersion.of(25))
        }
    )
}
```

---

## 31. Anti-Patterns Testing Build Pipeline

### 31.1 All Tests in One Bucket

```text
mvn test runs unit + Spring + DB + Docker + browser tests
```

Dampak:

- feedback lambat;
- failure signal kabur;
- local development buruk.

### 31.2 Test Depends on External Shared Environment

```text
Integration test calls shared DEV API/database.
```

Dampak:

- flaky;
- data pollution;
- security risk;
- tidak reproducible.

### 31.3 Coverage Theater

```text
80% coverage achieved by testing getters and generated mappers,
while authorization policy has no boundary test.
```

### 31.4 Sleeps Everywhere

```text
Thread.sleep(10000)
```

Dampak:

- slow;
- flaky;
- hides async design issues.

### 31.5 Unpinned Test Tool Versions

```text
JUnit/Surefire/Failsafe/Testcontainers versions float or inherited invisibly.
```

Dampak:

- CI suddenly breaks;
- test discovery changes;
- container behavior changes.

### 31.6 Integration Test Without Cleanup

Dampak:

- test order dependency;
- local DB polluted;
- CI random failure.

### 31.7 Full Application Context for Every Test

Dampak:

- unit suite becomes integration suite;
- slow feedback;
- context cache invalidation;
- hard-to-debug config failures.

---

## 32. Top 1% Heuristics

### 32.1 Test Placement Heuristic

```text
If logic can be tested without framework, test without framework.
If integration risk is real, test with real integration boundary.
If full E2E is expensive, use contract/API tests for most cases.
If behavior is critical, add boundary and mutation-sensitive tests.
```

### 32.2 Failure Signal Heuristic

A good test failure should answer:

```text
What behavior broke?
Where likely broke?
What input caused it?
What expected output?
What actual output?
```

Bad failure:

```text
expected true but was false
```

Better:

```text
Expected renewal to be rejected because license expired beyond 90-day grace period,
but policy returned eligible=true for expiryDate=2025-01-01 and evaluationDate=2026-06-17.
```

### 32.3 Build Stage Heuristic

```text
Cheap deterministic checks early.
Expensive broad checks later.
Flaky external checks isolated.
Release checks clean and reproducible.
```

### 32.4 Coverage Heuristic

```text
Do not ask: “What coverage do we have?”
Ask: “Which high-risk behavior can still change without a test failing?”
```

### 32.5 Integration Heuristic

```text
Mock what you own only if the risk is decision logic.
Use real dependency or realistic fake when risk is protocol/config/serialization/transaction.
```

### 32.6 CI Heuristic

```text
A test suite that developers avoid running locally is already a design smell.
```

---

## 33. Review Checklist

### 33.1 Pipeline Structure

- [ ] Unit tests and integration tests are separated.
- [ ] Maven Surefire/Failsafe or Gradle tasks/suites are configured intentionally.
- [ ] `check`/`verify` runs the right verification gates.
- [ ] Expensive tests are placed in appropriate CI stages.
- [ ] Release build does not skip tests silently.

### 33.2 Test Quality

- [ ] Test names describe behavior.
- [ ] Assertions are meaningful.
- [ ] Boundary cases are covered.
- [ ] Critical domain/security/state rules have strong tests.
- [ ] Mutation testing is considered for critical logic.

### 33.3 Determinism

- [ ] Time is injected or fixed.
- [ ] Timezone/locale are controlled.
- [ ] Random seed is reproducible.
- [ ] Test data is isolated.
- [ ] Async tests use polling/awaiting, not fixed sleeps.

### 33.4 Dependency Hygiene

- [ ] Test dependencies use test scope/configuration.
- [ ] Test dependencies do not leak into runtime artifact.
- [ ] JUnit engine/platform versions are compatible.
- [ ] Testcontainers/WireMock/etc. versions are pinned.

### 33.5 Integration Environment

- [ ] DB tests use realistic engine for critical behavior.
- [ ] Broker tests cover serialization/routing/retry/DLQ/idempotency.
- [ ] HTTP client tests cover error/timeout/rate-limit behavior.
- [ ] External shared environments are not required for normal PR builds.

### 33.6 Observability

- [ ] Test reports are published in CI.
- [ ] Coverage XML/HTML reports are generated.
- [ ] Flaky tests are tracked.
- [ ] Slowest tests are visible.
- [ ] Retry counts are visible.

---

## 34. Mini Case Study: Enterprise Case Management Service

Bayangkan service Java untuk regulatory case management.

Risiko utama:

- case state transition salah;
- unauthorized officer bisa approve case;
- audit trail tidak tercatat;
- notification event tidak terkirim;
- transaction rollback tidak benar;
- database constraint tidak sesuai;
- API contract berubah;
- performance listing case lambat.

Testing strategy:

```text
Unit test:
  state transition policy
  authorization decision
  validation rules
  fee/escalation calculation

Component test:
  case service with fake repository/event publisher

Integration test:
  repository + real DB
  transaction rollback/commit
  outbox/event persistence

Messaging integration:
  event payload published to broker
  consumer idempotency

API test:
  create/update/approve endpoints
  validation error contract
  security 401/403 behavior

Contract test:
  case event schema consumed by reporting/notification service

Mutation test:
  critical state machine and authorization package

Benchmark:
  case listing query mapper/parser
  search/filter logic if CPU-heavy

Packaging smoke:
  app starts with test profile
  health endpoint returns UP
```

Pipeline:

```text
Local:
  unit + selected component

PR:
  compile + unit + component + selected integration + coverage

Main:
  full integration + contract + package smoke + security scan

Nightly:
  mutation + E2E + benchmark + cross-JDK matrix

Release:
  clean verify + SBOM + artifact signing + deployment smoke
```

This is how testing becomes part of engineering risk control, not just checklist compliance.

---

## 35. Kesimpulan

Testing build pipeline adalah sistem filtering risiko.

Maven memberi struktur lifecycle yang kuat:

```text
Surefire for unit tests
Failsafe for integration tests
verify for final gate
```

Gradle memberi fleksibilitas task graph:

```text
Test tasks
source sets
JVM test suites
custom verification lifecycle
```

Engineer top-tier tidak hanya bertanya:

```text
Apakah test pass?
```

Tetapi bertanya:

```text
Risiko apa yang test ini tangkap?
Apakah test ini ditempatkan di stage yang benar?
Apakah failure-nya actionable?
Apakah test ini deterministic?
Apakah pipeline memberi confidence sebanding dengan cost-nya?
```

Jika jawaban untuk pertanyaan-pertanyaan itu jelas, testing pipeline berubah dari ritual CI menjadi mekanisme engineering governance.

---

## 36. Referensi Resmi dan Lanjutan

- Maven Surefire Plugin Documentation
- Maven Failsafe Plugin Documentation
- Maven Lifecycle Reference
- Gradle Testing in Java Projects
- Gradle JVM Test Suite Plugin
- Gradle JaCoCo Plugin
- JUnit 5 User Guide
- JaCoCo Documentation
- OpenJDK JMH
- Testcontainers Documentation
- PIT Mutation Testing Documentation

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — Compiler Engineering: `javac`, Annotation Processing, Incremental Compilation, Generated Sources](./10-compiler-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 12 — Packaging Engineering: JAR, Fat JAR, Thin JAR, WAR, EAR, Modular JAR, Native Image](./12-packaging-engineering.md)
