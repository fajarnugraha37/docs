# Learn Java Part 017 — Testing di Java

> Target: Java hingga versi 25.  
> Audience: software engineer yang ingin bukan hanya “bisa menulis unit test”, tetapi mampu mendesain strategi testing yang membuktikan correctness, menjaga evolusi sistem, mendeteksi regresi, dan mengurangi risiko production.

---

## 0. Posisi Bagian Ini dalam Kurikulum

Sampai bagian sebelumnya, kita sudah membangun fondasi:

1. Java sebagai language + platform + runtime.
2. Syntax dan semantics.
3. Object model.
4. Type system dan generics.
5. Modern Java language features.
6. Functional programming.
7. Collections dan data structures.
8. Error handling dan reliability.
9. Java Memory Model dan concurrency.
10. I/O, NIO, networking, serialization, FFM.
11. Text, Unicode, locale, date-time.
12. JVM internal.
13. Memory management dan GC.
14. Observability, profiling, troubleshooting.
15. Security dan cryptography.
16. Modules, packaging, runtime image.

Bagian 17 membahas **testing**.

Testing bukan aktivitas setelah coding selesai. Testing adalah cara kita mengubah asumsi menjadi executable evidence.

Engineer Java yang kuat tidak melihat test sebagai:

```text
code coverage percentage
```

melainkan sebagai:

```text
risk model + behavioral specification + regression safety net + executable design feedback
```

Dengan kata lain, test yang baik tidak hanya menjawab:

> “Apakah kode ini jalan?”

Tetapi juga:

> “Behavior apa yang dijanjikan sistem?”  
> “Invarian apa yang harus selalu benar?”  
> “Failure mode mana yang sudah kita kendalikan?”  
> “Apa yang akan rusak jika desain berubah?”  
> “Apakah test ini membuktikan hal penting, atau hanya mengeksekusi baris kode?”

---

## 1. Mental Model Testing

### 1.1 Testing adalah executable specification

Dokumentasi natural language sering basi. Komentar bisa salah. Wiki bisa tertinggal. Test punya karakter berbeda: ia ikut dikompilasi dan dieksekusi.

Test yang baik berfungsi sebagai:

1. **Specification** — menjelaskan behavior yang diharapkan.
2. **Regression guard** — mendeteksi perubahan behavior yang tidak disengaja.
3. **Design feedback** — memberi sinyal apakah kode mudah dipakai, mudah dipahami, dan mudah diisolasi.
4. **Debugging accelerator** — mempersempit ruang pencarian ketika bug muncul.
5. **Refactoring safety net** — membuat perubahan internal lebih aman.
6. **Operational risk reduction** — menguji timeout, retry, idempotency, concurrency, serialization, transaction, dan failure boundary.

Contoh test yang buruk:

```java
@Test
void test1() {
    service.process(input);
    assertTrue(true);
}
```

Ini bukan test. Ini hanya mengeksekusi kode.

Contoh test yang lebih baik:

```java
@Test
void submit_shouldRejectCase_whenApplicantHasActiveSuspension() {
    Applicant applicant = applicantWithActiveSuspension();
    CaseDraft draft = validCaseDraftFor(applicant);

    CaseSubmissionResult result = service.submit(draft);

    assertThat(result).isInstanceOf(CaseSubmissionResult.Rejected.class);
    assertThat(((CaseSubmissionResult.Rejected) result).reason())
            .isEqualTo(RejectReason.APPLICANT_SUSPENDED);
}
```

Test ini menjelaskan:

- kondisi awal;
- operasi yang diuji;
- behavior domain yang diharapkan;
- alasan bisnis yang harus stabil.

### 1.2 Test adalah model risiko

Tidak semua bagian sistem punya risiko sama.

Kode berikut biasanya butuh testing lebih kuat:

- state transition;
- authorization;
- pricing/calculation;
- regulatory deadline;
- payment;
- audit trail;
- event ordering;
- idempotency;
- retry behavior;
- concurrency;
- serialization/deserialization;
- migration;
- cryptography;
- time-zone logic;
- data archival;
- external integration boundary.

Kode berikut mungkin tidak perlu test terlalu berat:

- getter/setter trivial;
- simple DTO tanpa invariant;
- framework wiring yang sudah diuji framework;
- generated code;
- mapper yang sangat sederhana, kecuali mapper itu audit-critical.

Top-tier engineer tidak menyebar test secara merata. Ia menempatkan test di lokasi risiko tertinggi.

### 1.3 Test bukan bukti absolut

Testing dapat menunjukkan adanya bug, tetapi tidak membuktikan tidak ada bug secara absolut.

Maka tujuan praktis testing adalah:

```text
menurunkan probabilitas defect penting sampai level yang dapat diterima
```

Itu berarti testing harus dilihat bersama:

- code review;
- static analysis;
- type system;
- contract design;
- runtime validation;
- observability;
- canary release;
- rollback plan;
- incident learning.

### 1.4 Test memberi sinyal desain

Jika kode sulit dites, kemungkinan ada salah satu masalah berikut:

- terlalu banyak dependency tersembunyi;
- terlalu banyak static global state;
- business logic bercampur dengan I/O;
- waktu diambil langsung dari `Instant.now()`;
- random number tidak bisa dikontrol;
- thread/executor dibuat langsung di method;
- transaksi terlalu besar;
- domain logic terkunci di framework;
- class punya terlalu banyak tanggung jawab;
- object tidak punya boundary yang jelas.

Kode yang mudah dites biasanya punya desain lebih baik:

- dependency eksplisit;
- pure function untuk logic murni;
- domain model tidak bergantung framework;
- waktu/random/external I/O diinjeksi;
- side effect dipisahkan;
- boundary jelas.

---

## 2. Taxonomy Testing di Java

Testing bukan satu jenis. Tiap jenis menjawab pertanyaan berbeda.

### 2.1 Unit test

Unit test menguji unit kecil secara cepat dan deterministik.

Unit bisa berupa:

- method;
- class;
- domain service;
- policy;
- validator;
- state transition;
- mapper;
- algorithm;
- small component tanpa external dependency nyata.

Tujuan unit test:

- membuktikan logic lokal;
- cepat dijalankan;
- mudah memberi feedback;
- tidak butuh network/database/container;
- deterministic.

Contoh cocok untuk unit test:

```java
sealed interface CaseState permits Draft, Submitted, Approved, Rejected {}

record Draft() implements CaseState {}
record Submitted() implements CaseState {}
record Approved() implements CaseState {}
record Rejected(String reason) implements CaseState {}

final class CaseTransitionPolicy {
    CaseState submit(CaseState current) {
        return switch (current) {
            case Draft ignored -> new Submitted();
            case Submitted ignored -> throw new IllegalStateException("Already submitted");
            case Approved ignored -> throw new IllegalStateException("Already approved");
            case Rejected ignored -> throw new IllegalStateException("Rejected case cannot be submitted");
        };
    }
}
```

Unit test:

```java
@Test
void submit_shouldMoveDraftToSubmitted() {
    CaseTransitionPolicy policy = new CaseTransitionPolicy();

    CaseState next = policy.submit(new Draft());

    assertThat(next).isInstanceOf(Submitted.class);
}
```

### 2.2 Integration test

Integration test menguji interaksi dengan dependency nyata atau mendekati nyata:

- database;
- message broker;
- file system;
- HTTP server;
- container;
- transaction manager;
- serialization framework;
- framework runtime.

Tujuannya bukan membuktikan seluruh business logic, tetapi membuktikan bahwa boundary teknis bekerja:

- SQL benar;
- schema cocok;
- transaction benar;
- serialization cocok;
- container bootable;
- migration valid;
- repository mapping benar;
- message topic/headers benar.

Contoh integration risk:

```text
Unit test repository mock pass,
tetapi query SQL salah di production.
```

Integration test harus menangkap risiko semacam itu.

### 2.3 Component test

Component test menguji satu service/module secara lebih besar, tetapi dependency eksternal bisa diganti test double atau container.

Contoh:

```text
Case service + real PostgreSQL container + fake notification server + fake clock
```

Tujuannya:

- memastikan flow internal service benar;
- menguji beberapa layer sekaligus;
- masih cukup cepat untuk CI reguler.

### 2.4 Contract test

Contract test menguji kesepakatan antara provider dan consumer.

Pertanyaan yang dijawab:

```text
Apakah API/event yang disediakan provider masih memenuhi ekspektasi consumer?
```

Contract test penting untuk:

- microservices;
- event-driven architecture;
- API versioning;
- backward compatibility;
- schema evolution;
- consumer-driven contract.

Contoh contract:

```json
{
  "caseId": "CASE-001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-11T10:00:00Z"
}
```

Jika provider mengganti `submittedAt` menjadi `submissionTime`, consumer bisa rusak. Contract test harus mendeteksi itu sebelum release.

### 2.5 End-to-end test

E2E test menguji sistem dari perspektif user atau external actor.

Contoh:

```text
User login → submit case → officer review → approve → applicant receives status
```

Kelebihan:

- mendekati real user journey;
- menangkap masalah wiring lintas sistem.

Kekurangan:

- lambat;
- flaky;
- sulit debug;
- mahal dipelihara;
- sering gagal karena environment, bukan logic.

Gunakan E2E untuk flow paling kritis, bukan semua variasi logic.

### 2.6 Property-based test

Property-based testing menguji property/invariant dengan banyak input yang dihasilkan otomatis.

Contoh property:

```text
Untuk semua case transition yang valid, version harus naik tepat 1.
```

Bukan hanya:

```text
Draft → Submitted untuk CASE-001 berhasil.
```

Tetapi:

```text
Untuk berbagai caseId, timestamp, actor, dan metadata valid,
transition tetap menjaga invariant.
```

Di Java, salah satu library yang populer untuk ini adalah **jqwik**, yang berjalan sebagai test engine di JUnit Platform.

### 2.7 Mutation test

Mutation testing menguji kualitas test suite, bukan production code secara langsung.

Ide dasarnya:

1. Tool mengubah kode kecil-kecilan.
2. Test suite dijalankan.
3. Jika test gagal, mutant “killed”.
4. Jika test tetap pass, mutant “survived”.

Contoh production code:

```java
boolean isEligible(int age) {
    return age >= 18;
}
```

Mutation:

```java
boolean isEligible(int age) {
    return age > 18;
}
```

Jika test tidak gagal, berarti test belum membuktikan boundary `18`.

Di Java, tool umum untuk mutation testing adalah PIT/Pitest.

### 2.8 Performance test

Performance test menjawab:

- berapa latency;
- berapa throughput;
- berapa allocation rate;
- berapa CPU cost;
- apakah ada regression;
- apakah warmup sudah stabil;
- apakah P99 memburuk;
- apakah GC pattern berubah.

Untuk microbenchmark Java, gunakan JMH, bukan `System.nanoTime()` manual sembarangan.

### 2.9 Concurrency test

Concurrency test menguji:

- race condition;
- memory visibility;
- ordering;
- atomicity;
- deadlock;
- lost update;
- publication bug;
- interruption;
- cancellation;
- executor starvation.

JUnit biasa tidak cukup untuk membuktikan behavior concurrency low-level. Untuk stress test concurrency, gunakan tool seperti jcstress.

### 2.10 Regression test

Regression test dibuat dari bug nyata.

Aturan kuat:

```text
Setiap bug penting yang diperbaiki harus meninggalkan test yang gagal sebelum fix dan pass setelah fix.
```

Tanpa regression test, bug lama mudah hidup kembali.

---

## 3. Test Pyramid, Test Trophy, dan Reality Check

### 3.1 Test pyramid klasik

Model klasik:

```text
        E2E
      Integration
    Unit Tests
```

Artinya:

- unit test paling banyak;
- integration test sedang;
- E2E test sedikit.

Ini berguna, tetapi bisa terlalu simplistik.

### 3.2 Test trophy

Model modern sering menekankan integration/component test lebih banyak, karena banyak bug nyata muncul di boundary:

```text
         E2E
      Integration
    Unit + Static
```

Untuk backend Java enterprise, kombinasi realistis:

```text
Static analysis + type system + unit test + integration test + contract test + targeted E2E
```

### 3.3 Strategi praktis

Untuk service Java biasa:

| Layer | Jumlah | Kecepatan | Tujuan |
|---|---:|---:|---|
| Unit | banyak | sangat cepat | domain logic, policy, algorithm |
| Integration | sedang | sedang | DB, broker, framework, serialization |
| Contract | sedang | sedang | API/event compatibility |
| E2E | sedikit | lambat | user journey kritis |
| Mutation | periodik | lambat | kualitas test suite |
| Performance | periodik/CI khusus | bervariasi | regression performa |
| Concurrency stress | targeted | lambat | JMM/correctness concurrency |

### 3.4 Jangan mengejar coverage buta

Coverage menjawab:

```text
baris/branch mana yang dieksekusi?
```

Coverage tidak menjawab:

```text
apakah assertion-nya kuat?
apakah invariant penting diuji?
apakah test akan gagal jika logic salah?
```

Contoh high coverage, low value:

```java
@Test
void submit() {
    service.submit(validDraft());
}
```

Line coverage naik. Behavior tidak dibuktikan.

Better:

```java
@Test
void submit_shouldPersistSubmittedState_andEmitCaseSubmittedEvent() {
    CaseDraft draft = validDraft();

    CaseId id = service.submit(draft);

    CaseRecord saved = repository.get(id);
    assertThat(saved.status()).isEqualTo(CaseStatus.SUBMITTED);
    assertThat(outbox.eventsFor(id))
            .extracting(OutboxEvent::type)
            .containsExactly("CASE_SUBMITTED");
}
```

---

## 4. JUnit Modern: Platform, Jupiter, Vintage

### 4.1 Current ecosystem note: JUnit 6 vs JUnit 5

Per 2026, dokumentasi resmi JUnit menyatakan **JUnit 6** sebagai current generation. JUnit 6 tetap terdiri dari konsep besar:

```text
JUnit Platform + JUnit Jupiter + JUnit Vintage
```

JUnit Platform adalah foundation untuk menjalankan testing framework di JVM. JUnit Jupiter adalah programming model + extension model untuk menulis test modern. JUnit Vintage menyediakan engine untuk menjalankan test JUnit 3/4, tetapi statusnya deprecated dan sebaiknya hanya dipakai sementara saat migrasi.

Banyak engineer masih berkata “JUnit 5” untuk merujuk style Jupiter modern, karena konsep Platform/Jupiter/Vintage diperkenalkan di era JUnit 5. Dalam materi ini, istilah **JUnit modern** berarti gaya Platform/Jupiter modern yang relevan untuk Java 25.

### 4.2 Mental model JUnit

JUnit bukan hanya annotation `@Test`.

JUnit modern terdiri dari:

```text
Build Tool / IDE / Console Launcher
            ↓
      JUnit Platform
            ↓
       Test Engine
            ↓
   Jupiter / Vintage / jqwik / other engines
            ↓
      Test classes and methods
```

Konsekuensinya:

- JUnit Platform bisa menjalankan lebih dari satu engine.
- jqwik bisa hidup berdampingan dengan Jupiter.
- Vintage bisa menjalankan test legacy JUnit 4 saat migrasi.
- Build tool seperti Maven/Gradle berbicara dengan Platform.
- Extension model memungkinkan Mockito, Spring, Testcontainers, temporary directory, parameter resolver, dan lain-lain.

### 4.3 Minimal JUnit test

```java
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CalculatorTest {

    @Test
    void add_shouldReturnSum() {
        Calculator calculator = new Calculator();

        int result = calculator.add(2, 3);

        assertEquals(5, result);
    }
}
```

Struktur dasar:

```text
Arrange → Act → Assert
```

Atau:

```text
Given → When → Then
```

### 4.4 Naming test

Nama test harus menjelaskan behavior.

Buruk:

```java
@Test
void testSubmit() {}
```

Lebih baik:

```java
@Test
void submit_shouldCreateSubmittedCase_whenDraftIsValid() {}
```

Format yang sering efektif:

```text
method_shouldExpectedBehavior_whenCondition
```

Contoh:

```java
@Test
void approve_shouldFail_whenCaseIsStillDraft() {}

@Test
void calculateDeadline_shouldSkipWeekend_whenSubmissionFallsOnFriday() {}

@Test
void deserialize_shouldRejectUnknownStatus_whenPayloadContainsUnsupportedEnum() {}
```

### 4.5 Lifecycle annotations

```java
class LifecycleTest {

    @BeforeAll
    static void beforeAll() {
        // once per class
    }

    @BeforeEach
    void beforeEach() {
        // before every test
    }

    @Test
    void testA() {}

    @AfterEach
    void afterEach() {
        // after every test
    }

    @AfterAll
    static void afterAll() {
        // once per class
    }
}
```

Rules penting:

- `@BeforeEach` harus menjaga test isolation.
- Jangan pakai mutable shared state tanpa alasan kuat.
- `@BeforeAll` cocok untuk expensive immutable setup.
- Static shared state bisa menyebabkan flaky test.

### 4.6 Assertions

JUnit assertions:

```java
assertEquals(expected, actual);
assertTrue(condition);
assertFalse(condition);
assertNull(value);
assertNotNull(value);
assertThrows(ExceptionType.class, executable);
assertAll(...);
```

Contoh exception:

```java
@Test
void approve_shouldThrow_whenUserIsUnauthorized() {
    CaseService service = new CaseService(...);

    UnauthorizedException ex = assertThrows(
            UnauthorizedException.class,
            () -> service.approve(caseId, unauthorizedOfficer())
    );

    assertEquals("OFFICER_NOT_ASSIGNED", ex.errorCode());
}
```

### 4.7 AssertJ untuk readability

Walaupun JUnit punya assertion bawaan, banyak proyek Java memakai AssertJ karena fluent dan expressive.

```java
assertThat(result.status()).isEqualTo(CaseStatus.SUBMITTED);
assertThat(result.events())
        .extracting(DomainEvent::type)
        .containsExactly("CASE_SUBMITTED", "NOTIFICATION_REQUESTED");
```

Kelebihan:

- pesan error biasanya lebih jelas;
- chaining mudah dibaca;
- bagus untuk collection/object graph.

### 4.8 Assumptions

Assumption dipakai ketika test hanya valid pada kondisi tertentu.

```java
@Test
void testOnlyOnLinux() {
    assumeTrue(System.getProperty("os.name").toLowerCase().contains("linux"));

    // test linux-specific behavior
}
```

Gunakan assumption untuk environment-specific test. Jangan pakai assumption untuk menyembunyikan test yang seharusnya diperbaiki.

### 4.9 Disabled test

```java
@Disabled("Waiting for external sandbox to be stabilized")
@Test
void externalSandboxIntegration() {}
```

Aturan:

- selalu beri alasan;
- jangan biarkan disabled test tanpa tiket/context;
- disabled test lama sering menjadi dead test.

### 4.10 Tags

```java
@Tag("integration")
@Test
void repository_shouldPersistCase() {}
```

Gradle:

```groovy
test {
    useJUnitPlatform {
        excludeTags 'slow'
    }
}
```

Maven Surefire/Failsafe bisa dikonfigurasi untuk memisahkan:

```text
unit tests     → fast feedback
integration   → slower CI stage
e2e           → release gate/nightly
```

### 4.11 Nested tests

Nested tests membantu mengelompokkan context.

```java
class CaseTransitionPolicyTest {

    private final CaseTransitionPolicy policy = new CaseTransitionPolicy();

    @Nested
    class Submit {

        @Test
        void shouldMoveDraftToSubmitted() {}

        @Test
        void shouldRejectAlreadySubmittedCase() {}
    }

    @Nested
    class Approve {

        @Test
        void shouldApproveSubmittedCase() {}

        @Test
        void shouldRejectDraftCase() {}
    }
}
```

Gunakan nested test untuk readability, bukan untuk membuat hierarchy terlalu dalam.

### 4.12 Parameterized tests

Ketika behavior sama diuji dengan banyak input, gunakan parameterized test.

```java
@ParameterizedTest
@CsvSource({
        "DRAFT, false",
        "SUBMITTED, true",
        "APPROVED, false",
        "REJECTED, false"
})
void approveAllowed_shouldDependOnState(CaseStatus status, boolean expected) {
    CaseApprovalPolicy policy = new CaseApprovalPolicy();

    boolean result = policy.canApprove(status);

    assertThat(result).isEqualTo(expected);
}
```

Sumber parameter:

- `@ValueSource`;
- `@CsvSource`;
- `@EnumSource`;
- `@MethodSource`;
- custom arguments provider.

### 4.13 Dynamic tests

Dynamic test dibuat runtime.

```java
@TestFactory
Stream<DynamicTest> transitionRules_shouldHold() {
    return TransitionFixture.allValidTransitions().stream()
            .map(rule -> dynamicTest(
                    rule.name(),
                    () -> assertThat(rule.apply()).isEqualTo(rule.expected())
            ));
}
```

Gunakan dynamic test ketika daftar skenario berasal dari data atau rule table.

### 4.14 Timeout

```java
@Test
@Timeout(2)
void submit_shouldCompleteQuickly() {
    service.submit(validDraft());
}
```

Hati-hati:

- timeout terlalu ketat membuat flaky test;
- timeout bukan pengganti performance test;
- untuk async/concurrency, lebih baik gunakan Awaitility atau explicit cancellation model.

### 4.15 Temporary directory

```java
@Test
void export_shouldWriteCsv(@TempDir Path tempDir) throws IOException {
    Path output = tempDir.resolve("cases.csv");

    exporter.export(output);

    assertThat(Files.readString(output)).contains("caseId,status");
}
```

Jangan menulis test file ke working directory sembarangan.

### 4.16 Extension model

JUnit extension memungkinkan:

- dependency injection parameter;
- lifecycle callback;
- conditional execution;
- exception handling;
- invocation interception;
- temporary resources;
- integration dengan Mockito/Spring/Testcontainers.

Contoh custom extension sederhana:

```java
class FixedClockExtension implements BeforeEachCallback, ParameterResolver {

    private final Clock fixedClock = Clock.fixed(
            Instant.parse("2026-06-11T10:00:00Z"),
            ZoneOffset.UTC
    );

    @Override
    public boolean supportsParameter(
            ParameterContext parameterContext,
            ExtensionContext extensionContext
    ) {
        return parameterContext.getParameter().getType().equals(Clock.class);
    }

    @Override
    public Object resolveParameter(
            ParameterContext parameterContext,
            ExtensionContext extensionContext
    ) {
        return fixedClock;
    }

    @Override
    public void beforeEach(ExtensionContext context) {
        // optional setup
    }
}
```

Usage:

```java
@ExtendWith(FixedClockExtension.class)
class DeadlinePolicyTest {

    @Test
    void deadline_shouldBeDeterministic(Clock clock) {
        DeadlinePolicy policy = new DeadlinePolicy(clock);

        assertThat(policy.calculate()).isEqualTo(LocalDate.parse("2026-06-18"));
    }
}
```

---

## 5. Build Configuration untuk Testing

### 5.1 Maven modern setup

Contoh minimal JUnit modern dengan Maven:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <properties>
    <maven.compiler.release>25</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.junit</groupId>
        <artifactId>junit-bom</artifactId>
        <version>${junit.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
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
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>${surefire.version}</version>
        <configuration>
          <useModulePath>false</useModulePath>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

Catatan:

- gunakan BOM untuk konsistensi versi;
- pisahkan unit test dan integration test jika project besar;
- Surefire biasanya untuk unit test;
- Failsafe biasanya untuk integration test.

### 5.2 Maven Surefire vs Failsafe

Convention umum:

```text
Surefire: *Test, *Tests, *TestCase
Failsafe: *IT, *ITCase
```

Lifecycle:

```text
mvn test        → unit tests
mvn verify      → unit + integration tests
```

Integration test dengan Failsafe:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-failsafe-plugin</artifactId>
  <version>${failsafe.version}</version>
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

### 5.3 Gradle modern setup

```groovy
plugins {
    id 'java'
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation platform("org.junit:junit-bom:${junitVersion}")
    testImplementation "org.junit.jupiter:junit-jupiter"
    testImplementation "org.assertj:assertj-core:${assertjVersion}"
}

test {
    useJUnitPlatform()
}
```

### 5.4 Pisahkan source set integration test di Gradle

```groovy
sourceSets {
    integrationTest {
        java.srcDir file('src/integrationTest/java')
        resources.srcDir file('src/integrationTest/resources')
        compileClasspath += sourceSets.main.output + configurations.testRuntimeClasspath
        runtimeClasspath += output + compileClasspath
    }
}

configurations {
    integrationTestImplementation.extendsFrom testImplementation
    integrationTestRuntimeOnly.extendsFrom testRuntimeOnly
}

tasks.register('integrationTest', Test) {
    description = 'Runs integration tests.'
    group = 'verification'
    testClassesDirs = sourceSets.integrationTest.output.classesDirs
    classpath = sourceSets.integrationTest.runtimeClasspath
    useJUnitPlatform()
    shouldRunAfter test
}

check.dependsOn integrationTest
```

### 5.5 Naming convention direktori

```text
src/main/java
src/main/resources
src/test/java
src/test/resources
src/integrationTest/java
src/integrationTest/resources
src/jmh/java
```

Pisahkan test berdasarkan intent, bukan hanya berdasarkan framework.

---

## 6. Unit Testing Design

### 6.1 Arrange-Act-Assert

Pattern dasar:

```java
@Test
void submit_shouldCreateSubmittedCase_whenDraftIsValid() {
    // Arrange
    CaseDraft draft = validDraft();
    CaseRepository repository = new InMemoryCaseRepository();
    CaseService service = new CaseService(repository, fixedClock());

    // Act
    CaseId id = service.submit(draft);

    // Assert
    CaseRecord saved = repository.get(id).orElseThrow();
    assertThat(saved.status()).isEqualTo(CaseStatus.SUBMITTED);
}
```

Hindari campur aduk banyak Act dalam satu test kecuali test itu memang menguji scenario flow.

### 6.2 One behavior per test

Buruk:

```java
@Test
void submitTest() {
    // test valid submit
    // test invalid submit
    // test duplicate submit
    // test audit event
}
```

Lebih baik:

```java
@Test
void submit_shouldPersistSubmittedCase_whenDraftIsValid() {}

@Test
void submit_shouldRejectDuplicateIdempotencyKey_whenKeyWasAlreadyUsed() {}

@Test
void submit_shouldEmitAuditEvent_whenSubmissionSucceeds() {}
```

### 6.3 Test public behavior, bukan private method

Private method adalah implementation detail.

Jika private method sulit dites lewat public API, mungkin:

- logic terlalu kompleks;
- perlu diekstrak menjadi class policy/domain service;
- class punya terlalu banyak tanggung jawab.

Jangan gunakan reflection untuk mengetes private method kecuali ada alasan migrasi legacy yang sangat kuat.

### 6.4 Test data builder

Object domain sering punya banyak field.

Buruk:

```java
CaseDraft draft = new CaseDraft(
    "CASE-001",
    "APP-001",
    "John",
    "A1234567",
    LocalDate.of(2026, 6, 11),
    List.of(...),
    Map.of(...),
    true,
    false
);
```

Lebih baik:

```java
CaseDraft draft = CaseDraftBuilder.valid()
        .withApplicantId("APP-001")
        .withSubmissionDate(LocalDate.of(2026, 6, 11))
        .build();
```

Builder test membuat test fokus ke field yang penting.

Contoh builder:

```java
final class CaseDraftBuilder {
    private String applicantId = "APP-001";
    private LocalDate submissionDate = LocalDate.parse("2026-06-11");
    private List<Document> documents = List.of(Document.validPassport());

    static CaseDraftBuilder valid() {
        return new CaseDraftBuilder();
    }

    CaseDraftBuilder withApplicantId(String applicantId) {
        this.applicantId = applicantId;
        return this;
    }

    CaseDraftBuilder withoutDocuments() {
        this.documents = List.of();
        return this;
    }

    CaseDraft build() {
        return new CaseDraft(applicantId, submissionDate, documents);
    }
}
```

### 6.5 Object mother vs builder

Object Mother:

```java
CaseDraft validDraft = TestCases.validDraft();
```

Builder:

```java
CaseDraft draft = CaseDraftBuilder.valid().withoutDocuments().build();
```

Object Mother bagus untuk fixture sederhana. Builder lebih baik untuk variasi test.

### 6.6 Avoid brittle assertions

Buruk:

```java
assertThat(result.toString()).isEqualTo("CaseRecord[id=CASE-1,status=SUBMITTED]");
```

Lebih baik:

```java
assertThat(result.id()).isEqualTo(new CaseId("CASE-1"));
assertThat(result.status()).isEqualTo(CaseStatus.SUBMITTED);
```

Jangan assert detail yang tidak termasuk kontrak behavior.

### 6.7 Test invariant, bukan semua implementation detail

Jika class menjanjikan invariant:

```text
Approved case must always have approvedBy and approvedAt.
```

Test harus fokus ke invariant:

```java
@Test
void approve_shouldSetApproverAndApprovalTime() {
    CaseRecord submitted = submittedCase();
    Officer officer = assignedOfficer();
    Clock clock = fixedClock("2026-06-11T10:00:00Z");

    CaseRecord approved = submitted.approve(officer, clock);

    assertThat(approved.status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(approved.approvedBy()).contains(officer.id());
    assertThat(approved.approvedAt()).contains(Instant.parse("2026-06-11T10:00:00Z"));
}
```

### 6.8 Time must be injectable

Buruk:

```java
Instant now = Instant.now();
```

Sulit dites.

Better:

```java
final class DeadlinePolicy {
    private final Clock clock;

    DeadlinePolicy(Clock clock) {
        this.clock = clock;
    }

    Instant now() {
        return Instant.now(clock);
    }
}
```

Test:

```java
Clock fixed = Clock.fixed(
        Instant.parse("2026-06-11T10:00:00Z"),
        ZoneOffset.UTC
);
```

### 6.9 Randomness must be controllable

Buruk:

```java
UUID id = UUID.randomUUID();
```

Di domain logic, lebih baik:

```java
interface IdGenerator {
    CaseId nextCaseId();
}
```

Test:

```java
class FixedIdGenerator implements IdGenerator {
    public CaseId nextCaseId() {
        return new CaseId("CASE-001");
    }
}
```

### 6.10 Avoid sleeping in tests

Buruk:

```java
Thread.sleep(5000);
assertThat(job.isDone()).isTrue();
```

Masalah:

- lambat;
- flaky;
- tidak deterministic;
- gagal di CI under load.

Better:

```java
await().atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(job.isDone()).isTrue());
```

---

## 7. Mockito dan Test Doubles

### 7.1 Test double taxonomy

Sebelum Mockito, pahami jenis test double:

| Jenis | Deskripsi |
|---|---|
| Dummy | object dikirim hanya untuk memenuhi parameter, tidak dipakai |
| Fake | implementasi sederhana tapi bekerja, misalnya in-memory repository |
| Stub | memberi jawaban terkontrol |
| Spy | mencatat interaksi pada object nyata/partial |
| Mock | object yang memverifikasi interaksi/expectation |

Tidak semua dependency perlu mock.

Sering kali fake lebih baik daripada mock.

### 7.2 Kapan pakai mock

Mock cocok untuk:

- external gateway;
- email sender;
- payment client;
- audit publisher;
- side-effect boundary;
- dependency mahal/lambat;
- dependency tidak deterministic;
- behavior interaksi penting.

Mock kurang cocok untuk:

- value object;
- domain entity;
- collection;
- DTO;
- pure function;
- repository jika integration dengan DB justru risiko utama.

### 7.3 Basic Mockito

```java
@ExtendWith(MockitoExtension.class)
class CaseServiceTest {

    @Mock
    CaseRepository repository;

    @Mock
    AuditPublisher auditPublisher;

    @InjectMocks
    CaseService service;

    @Test
    void submit_shouldPublishAuditEvent() {
        CaseDraft draft = validDraft();
        when(repository.save(any())).thenReturn(new CaseId("CASE-001"));

        service.submit(draft);

        verify(auditPublisher).publish(argThat(event ->
                event.type().equals("CASE_SUBMITTED")
        ));
    }
}
```

### 7.4 Stubbing

```java
when(repository.findById(caseId)).thenReturn(Optional.of(caseRecord));
when(policy.canApprove(any())).thenReturn(true);
```

Untuk exception:

```java
when(client.send(any())).thenThrow(new TimeoutException("gateway timeout"));
```

Untuk void method:

```java
doThrow(new RuntimeException("failed"))
        .when(publisher)
        .publish(any());
```

### 7.5 Verification

```java
verify(repository).save(any(CaseRecord.class));
verify(auditPublisher).publish(any(AuditEvent.class));
verifyNoMoreInteractions(auditPublisher);
verify(notificationClient, never()).send(any());
```

Gunakan verification untuk side effect penting, bukan untuk seluruh implementation sequence.

Buruk:

```java
verify(repository).findById(id);
verify(policy).canApprove(record);
verify(repository).save(record);
verify(audit).publish(event);
verify(notification).send(message);
```

Ini membuat test terlalu terikat implementation.

Lebih baik:

- assert output/state akhir;
- verify hanya side effect yang merupakan kontrak.

### 7.6 ArgumentCaptor

```java
@Captor
ArgumentCaptor<AuditEvent> eventCaptor;

@Test
void submit_shouldPublishExpectedAuditPayload() {
    service.submit(validDraft());

    verify(auditPublisher).publish(eventCaptor.capture());
    AuditEvent event = eventCaptor.getValue();

    assertThat(event.type()).isEqualTo("CASE_SUBMITTED");
    assertThat(event.actorId()).isEqualTo("USER-001");
}
```

Gunakan captor ketika payload penting dan kompleks.

### 7.7 Spy

Spy membungkus object nyata.

```java
List<String> list = spy(new ArrayList<>());

list.add("a");

verify(list).add("a");
assertThat(list).contains("a");
```

Spy rawan karena partial mocking bisa menyembunyikan desain buruk.

Gunakan spy jarang.

### 7.8 Strict stubbing

Mockito modern cenderung mendorong strict stubbing: stub yang tidak dipakai akan dianggap smell.

Contoh smell:

```java
when(repository.findById(id)).thenReturn(Optional.of(record));

service.create(newDraft()); // tidak pernah memanggil findById
```

Ini menandakan:

- setup terlalu umum;
- test tidak fokus;
- behavior berubah tapi test tidak dibersihkan.

### 7.9 Static mocking

Mockito mendukung static mocking pada setup tertentu, tetapi gunakan sebagai escape hatch.

Jika production code banyak perlu static mock, desain mungkin bermasalah.

Lebih baik injeksikan dependency:

```java
Clock clock;
IdGenerator idGenerator;
TokenVerifier tokenVerifier;
```

bukan:

```java
Instant.now();
UUID.randomUUID();
StaticSecurityContext.currentUser();
```

### 7.10 Anti-pattern Mockito

#### Mocking value object

Buruk:

```java
CaseId caseId = mock(CaseId.class);
```

Better:

```java
CaseId caseId = new CaseId("CASE-001");
```

#### Over-mocking

Jika semua class dimock, test tidak membuktikan business behavior, hanya implementation choreography.

#### Mock returning mock returning mock

```java
when(a.getB().getC().getValue()).thenReturn("x");
```

Ini smell Law of Demeter dan desain terlalu nested.

#### Verifying internal sequence tanpa kebutuhan

Jangan assert urutan call kecuali urutan itu kontrak bisnis/teknis.

---

## 8. Integration Testing dengan Testcontainers

### 8.1 Kenapa Testcontainers penting

Mock database tidak menangkap:

- SQL syntax;
- transaction isolation;
- constraint;
- index behavior;
- timezone behavior;
- migration compatibility;
- JSON column behavior;
- deadlock/lock wait;
- database-specific behavior.

Testcontainers memungkinkan test menjalankan dependency nyata dalam container:

- PostgreSQL;
- MySQL;
- Kafka;
- RabbitMQ;
- Redis;
- Elasticsearch;
- LocalStack;
- WireMock;
- custom Docker image.

### 8.2 JUnit integration

Testcontainers menyediakan JUnit Jupiter extension dengan `@Testcontainers` dan `@Container`.

```java
@Testcontainers
class CaseRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("case_db")
            .withUsername("test")
            .withPassword("test");

    @Test
    void saveAndFind_shouldRoundTrip() {
        DataSource dataSource = createDataSource(
                postgres.getJdbcUrl(),
                postgres.getUsername(),
                postgres.getPassword()
        );

        CaseRepository repository = new JdbcCaseRepository(dataSource);

        repository.save(submittedCase("CASE-001"));

        assertThat(repository.findById(new CaseId("CASE-001")))
                .isPresent()
                .get()
                .extracting(CaseRecord::status)
                .isEqualTo(CaseStatus.SUBMITTED);
    }
}
```

### 8.3 Static vs instance container

Static container:

```java
@Container
static PostgreSQLContainer<?> postgres = ...;
```

Started once per test class.

Instance container:

```java
@Container
PostgreSQLContainer<?> postgres = ...;
```

Started per test method.

Trade-off:

| Mode | Pros | Cons |
|---|---|---|
| Per method | isolation kuat | lambat |
| Per class | lebih cepat | perlu cleanup data |
| Singleton per suite | sangat cepat | risiko state leakage |

### 8.4 Data cleanup strategy

Jika container shared, bersihkan data.

Opsi:

1. transaction rollback per test;
2. truncate tables after each test;
3. unique tenant/caseId per test;
4. recreate schema per class;
5. one container per method.

Contoh cleanup:

```java
@AfterEach
void cleanDatabase() {
    jdbcTemplate.update("TRUNCATE TABLE case_record, outbox_event RESTART IDENTITY CASCADE");
}
```

### 8.5 Migration testing

Integration test harus menjalankan migration tool yang sama dengan production:

- Flyway;
- Liquibase;
- custom migration script.

Test minimal:

```java
@Test
void migration_shouldApplyCleanlyOnEmptyDatabase() {
    Flyway flyway = Flyway.configure()
            .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
            .locations("classpath:db/migration")
            .load();

    MigrateResult result = flyway.migrate();

    assertThat(result.success).isTrue();
}
```

### 8.6 Testing repository constraints

```java
@Test
void save_shouldFail_whenCaseIdDuplicated() {
    repository.save(submittedCase("CASE-001"));

    assertThatThrownBy(() -> repository.save(submittedCase("CASE-001")))
            .isInstanceOf(DataIntegrityViolationException.class);
}
```

Test seperti ini tidak bisa digantikan unit test mock.

### 8.7 Kafka integration test

Untuk event-driven Java service:

- gunakan Kafka container;
- publish event;
- consume result;
- assert key/header/value;
- assert ordering jika relevan;
- assert idempotency.

Pseudo-code:

```java
@Testcontainers
class CaseEventPublisherIT {

    @Container
    static KafkaContainer kafka = new KafkaContainer(...);

    @Test
    void publish_shouldUseCaseIdAsKey() {
        CaseEventPublisher publisher = new CaseEventPublisher(kafkaBootstrapServers());

        publisher.publish(new CaseSubmitted(new CaseId("CASE-001")));

        ConsumerRecord<String, String> record = consumeOne("case.events");
        assertThat(record.key()).isEqualTo("CASE-001");
        assertThat(record.value()).contains("CASE_SUBMITTED");
    }
}
```

### 8.8 Testcontainers pitfalls

- Docker tidak tersedia di CI.
- Image pull lambat.
- Parallel test bisa bentrok port/data.
- Shared container menyebabkan data leakage.
- Test terlalu banyak integration sehingga CI lambat.
- Menggunakan latest image tag bisa menyebabkan flaky build.
- Perbedaan architecture ARM/x86.

Best practices:

- pin image version;
- gunakan reusable setup secara hati-hati;
- cleanup state;
- batasi integration test ke boundary penting;
- cache Docker image di CI;
- pisahkan stage integration.

---

## 9. Contract Testing

### 9.1 Masalah yang diselesaikan

Dalam microservices, unit test provider pass dan unit test consumer pass belum berarti integrasi aman.

Contoh:

Consumer mengharapkan:

```json
{
  "caseId": "CASE-001",
  "status": "SUBMITTED"
}
```

Provider berubah menjadi:

```json
{
  "id": "CASE-001",
  "caseStatus": "SUBMITTED"
}
```

Provider test mungkin pass. Consumer test mungkin pass dengan stub lama. Production rusak.

Contract testing menutup celah ini.

### 9.2 Consumer-driven contract

Alur:

1. Consumer mendefinisikan ekspektasi terhadap provider.
2. Contract disimpan/publish.
3. Provider menjalankan contract test.
4. Provider tidak boleh release jika melanggar contract consumer.

### 9.3 API contract yang perlu diuji

- path;
- method;
- status code;
- request header;
- response header;
- schema;
- required field;
- enum value;
- error response;
- pagination;
- idempotency behavior;
- backward compatibility.

### 9.4 Event contract

Untuk event-driven system:

- topic name;
- key semantics;
- schema;
- required fields;
- nullable fields;
- enum evolution;
- timestamp format;
- version field;
- correlation id;
- causation id;
- idempotency key;
- ordering guarantee.

Contoh invariant event:

```text
Every CaseSubmitted event must have:
- eventId
- caseId
- occurredAt in UTC ISO-8601
- actorId
- version
```

### 9.5 Schema compatibility

Rule sederhana:

- Menambah optional field biasanya backward compatible.
- Menghapus required field biasanya breaking.
- Mengubah type field biasanya breaking.
- Rename field adalah breaking bagi JSON consumer.
- Menambah enum value bisa breaking bagi consumer yang exhaustive.

Untuk Java sealed switch, enum addition/pattern addition bisa memicu compile-time issue jika source dikompilasi ulang, tetapi runtime distributed consumer tetap perlu compatibility strategy.

---

## 10. Property-Based Testing dengan jqwik

### 10.1 Example-based vs property-based

Example-based:

```java
@Test
void reverse_shouldReverseList() {
    assertThat(reverse(List.of(1, 2, 3))).containsExactly(3, 2, 1);
}
```

Property-based:

```text
Untuk semua list xs:
reverse(reverse(xs)) == xs
```

### 10.2 Kenapa property-based testing kuat

Ia bagus untuk:

- parser;
- serializer/deserializer;
- date/time rules;
- calculation;
- state machine;
- collection transformation;
- validation;
- normalization;
- idempotency;
- commutativity/associativity;
- ordering invariant;
- boundary exploration.

### 10.3 jqwik basic

```java
import net.jqwik.api.*;

class StringProperties {

    @Property
    boolean reverseTwice_shouldReturnOriginal(@ForAll String value) {
        return reverse(reverse(value)).equals(value);
    }

    private String reverse(String value) {
        return new StringBuilder(value).reverse().toString();
    }
}
```

jqwik adalah alternative test engine untuk JUnit Platform, sehingga bisa digabung dengan Jupiter.

### 10.4 Arbitraries

```java
@Property
void normalize_shouldBeIdempotent(@ForAll("caseIds") String caseId) {
    String once = normalizeCaseId(caseId);
    String twice = normalizeCaseId(once);

    assertThat(twice).isEqualTo(once);
}

@Provide
Arbitrary<String> caseIds() {
    return Arbitraries.strings()
            .withCharRange('A', 'Z')
            .ofMinLength(1)
            .ofMaxLength(20)
            .map(s -> " CASE-" + s + " ");
}
```

### 10.5 Property untuk state machine

Contoh domain:

```text
Draft → Submitted → Approved
Draft → Submitted → Rejected
```

Property:

```text
Approved case cannot transition back to Draft.
Rejected case cannot be Approved without Reopen.
Every successful transition increments version by 1.
Invalid transition must not mutate record.
```

Test:

```java
@Property
void successfulTransition_shouldIncrementVersionByOne(
        @ForAll("validTransitions") TransitionFixture fixture
) {
    CaseRecord before = fixture.before();

    CaseRecord after = fixture.transition().apply(before);

    assertThat(after.version()).isEqualTo(before.version() + 1);
}
```

### 10.6 Shrinking

Property-based tools biasanya melakukan shrinking: ketika menemukan failing input besar, tool mencoba mengecilkan input menjadi contoh minimal.

Contoh bug:

```text
input: huge complicated string
shrunk to: "İ"
```

Ini sangat berguna untuk Unicode, locale, parser, dan boundary.

### 10.7 Pitfalls property-based testing

- property terlalu lemah;
- generator tidak mencakup edge case;
- property hanya mengulang implementation;
- terlalu lambat;
- flaky karena time/random/external dependency;
- sulit dipahami jika property tidak diberi nama jelas.

Bad property:

```java
@Property
void result_shouldEqualImplementation(@ForAll int x) {
    assertThat(service.calculate(x)).isEqualTo(service.calculate(x));
}
```

Ini tautological.

Better:

```java
@Property
void discount_shouldNeverMakePriceNegative(@ForAll @Positive BigDecimal price) {
    BigDecimal discounted = discount.apply(price);

    assertThat(discounted).isGreaterThanOrEqualTo(BigDecimal.ZERO);
}
```

---

## 11. Mutation Testing dengan PIT

### 11.1 Coverage vs mutation score

Coverage:

```text
Apakah baris dieksekusi?
```

Mutation score:

```text
Apakah test gagal ketika logic diubah secara kecil tapi bermakna?
```

Mutation testing lebih dekat ke kualitas assertion.

### 11.2 Contoh mutation survivor

Production:

```java
boolean canApprove(CaseStatus status) {
    return status == CaseStatus.SUBMITTED;
}
```

Mutant:

```java
boolean canApprove(CaseStatus status) {
    return status != CaseStatus.SUBMITTED;
}
```

Jika test masih pass, test suite buruk.

### 11.3 Maven PIT setup

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>${pitest.version}</version>
  <configuration>
    <targetClasses>
      <param>com.example.caseapp.*</param>
    </targetClasses>
    <targetTests>
      <param>com.example.caseapp.*Test</param>
    </targetTests>
  </configuration>
</plugin>
```

Run:

```bash
mvn test-compile org.pitest:pitest-maven:mutationCoverage
```

### 11.4 Kapan jalankan mutation test

Karena lambat, jalankan:

- nightly;
- pre-release;
- pada module domain-critical;
- saat refactor besar;
- saat mengevaluasi kualitas test suite.

Tidak semua module perlu mutation test setiap PR.

### 11.5 Interpretasi mutant

Survived mutant bisa berarti:

- test kurang kuat;
- mutant equivalent;
- code tidak reachable;
- assertion terlalu umum;
- logic terlalu kompleks;
- test data tidak mencakup boundary.

Jangan memperlakukan mutation score sebagai angka absolut tanpa membaca report.

### 11.6 Mutation testing untuk regulatory system

Target yang cocok:

- eligibility rule;
- deadline calculation;
- penalty computation;
- state transition guard;
- authorization decision;
- idempotency behavior;
- escalation logic.

Mutation testing di area ini memberi value besar karena bug kecil bisa berdampak besar.

---

## 12. Performance Testing dan JMH

### 12.1 Kenapa microbenchmark Java sulit

JVM punya:

- interpreter;
- tiered compilation;
- JIT warmup;
- escape analysis;
- dead-code elimination;
- constant folding;
- branch prediction;
- GC;
- CPU frequency scaling;
- OS scheduling;
- profile-guided optimization.

Maka benchmark manual seperti ini sering salah:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    method();
}
long elapsed = System.nanoTime() - start;
```

### 12.2 JMH mental model

JMH adalah harness dari OpenJDK untuk membangun, menjalankan, dan menganalisis benchmark JVM.

JMH membantu menangani:

- warmup;
- measurement iteration;
- fork;
- blackhole;
- benchmark mode;
- state scope;
- JVM isolation.

Tetapi JMH tidak membuat benchmark otomatis benar. Benchmark tetap harus direview.

### 12.3 Basic JMH benchmark

```java
@State(Scope.Thread)
public class CaseIdParserBenchmark {

    private String raw;

    @Setup
    public void setup() {
        raw = "CASE-2026-000001";
    }

    @Benchmark
    public CaseId parse() {
        return CaseId.parse(raw);
    }
}
```

### 12.4 Benchmark modes

Common modes:

- `Throughput` — operations per time;
- `AverageTime` — average time per operation;
- `SampleTime` — distribution sample;
- `SingleShotTime` — cold-ish single invocation scenario.

### 12.5 State scope

```java
@State(Scope.Thread)
```

Setiap thread punya state sendiri.

```java
@State(Scope.Benchmark)
```

State shared antar thread.

Untuk concurrency benchmark, scope penting.

### 12.6 Blackhole

Jika result tidak dipakai, JIT bisa menghapus computation.

```java
@Benchmark
public void parse(Blackhole bh) {
    bh.consume(CaseId.parse(raw));
}
```

### 12.7 Performance regression testing

JMH cocok untuk:

- membandingkan algorithm;
- mengecek allocation rate;
- menguji hot method;
- menjaga regression performa di library/domain algorithm.

JMH kurang cocok untuk:

- end-to-end latency production;
- DB-heavy scenario;
- network-heavy scenario;
- distributed system behavior.

Untuk itu gunakan load test/integration performance test.

### 12.8 Common benchmark mistakes

- benchmark dead code;
- input terlalu kecil;
- tidak fork;
- warmup kurang;
- mengukur debug build;
- menjalankan di laptop noisy;
- membandingkan angka tanpa confidence interval;
- tidak memprofil allocation;
- benchmark isolated tidak representatif terhadap production.

### 12.9 Performance test di CI

Jangan jadikan microbenchmark sangat ketat di setiap PR jika environment CI noisy.

Lebih baik:

- jalankan nightly;
- simpan historical trend;
- alert jika regression besar;
- gunakan dedicated runner jika perlu;
- kombinasikan dengan JFR/allocation profile.

---

## 13. Concurrency Testing

### 13.1 Kenapa concurrency test susah

Concurrency bug sering:

- tidak deterministic;
- hanya muncul under load;
- tergantung CPU architecture;
- tergantung scheduling;
- tergantung JIT;
- hilang saat debugging;
- tidak muncul di laptop developer.

### 13.2 Unit test biasa tidak cukup

Test ini lemah:

```java
@Test
void counter_shouldIncrement() throws Exception {
    Counter counter = new Counter();

    Thread t1 = new Thread(counter::increment);
    Thread t2 = new Thread(counter::increment);
    t1.start();
    t2.start();
    t1.join();
    t2.join();

    assertThat(counter.value()).isEqualTo(2);
}
```

Mungkin pass 1000 kali, lalu gagal di production.

### 13.3 Use deterministic design first

Sebelum stress test, desain concurrency harus jelas:

- ownership state;
- immutability;
- confinement;
- atomic operation;
- lock ordering;
- timeout;
- cancellation;
- safe publication;
- executor boundary;
- backpressure.

Test tidak bisa menyelamatkan desain concurrency yang tidak punya invariant.

### 13.4 Awaitility untuk async system

Awaitility membantu menunggu kondisi tanpa `Thread.sleep` manual.

```java
await()
    .atMost(Duration.ofSeconds(5))
    .pollInterval(Duration.ofMillis(100))
    .untilAsserted(() ->
            assertThat(repository.findById(caseId))
                    .isPresent()
                    .get()
                    .extracting(CaseRecord::status)
                    .isEqualTo(CaseStatus.PROCESSED)
    );
```

Gunakan untuk:

- async event handler;
- background job;
- eventually consistent read model;
- message consumer;
- scheduler.

### 13.5 Testing interruption

Jika method blocking harus respect interruption:

```java
@Test
void worker_shouldStop_whenInterrupted() throws Exception {
    Worker worker = new Worker();
    Thread thread = new Thread(worker::run);

    thread.start();
    thread.interrupt();

    thread.join(1000);
    assertThat(thread.isAlive()).isFalse();
}
```

Tetapi untuk reliable test, sering lebih baik expose lifecycle API:

```java
worker.start();
worker.stop();
assertThat(worker.awaitStopped(Duration.ofSeconds(1))).isTrue();
```

### 13.6 jcstress

jcstress adalah harness OpenJDK untuk concurrency stress tests terkait correctness JVM, class libraries, dan hardware.

Contoh konsep:

```java
@JCStressTest
@Outcome(id = "1, 1", expect = Expect.ACCEPTABLE)
@Outcome(id = "0, 1", expect = Expect.ACCEPTABLE)
@Outcome(id = "1, 0", expect = Expect.ACCEPTABLE)
@Outcome(id = "0, 0", expect = Expect.FORBIDDEN)
@State
public class ReorderingTest {
    int x;
    int y;

    @Actor
    public void actor1(II_Result r) {
        x = 1;
        r.r1 = y;
    }

    @Actor
    public void actor2(II_Result r) {
        y = 1;
        r.r2 = x;
    }
}
```

Ini bukan test harian biasa. Gunakan untuk:

- lock-free algorithm;
- custom concurrent data structure;
- atomic publication;
- volatile/CAS semantics;
- JMM edge case.

### 13.7 Testing virtual threads

Virtual threads membuat blocking style lebih scalable, tetapi test tetap harus membuktikan:

- no thread-local leakage;
- timeout respected;
- cancellation propagated;
- resource bounded;
- no synchronized pinning hot path;
- executor lifecycle closed;
- DB pool tidak overload.

Contoh:

```java
@Test
void batchProcessing_shouldCancelRemainingTasks_whenOneFails() {
    CaseBatchProcessor processor = new CaseBatchProcessor(...);

    assertThatThrownBy(() -> processor.process(List.of(validCase(), failingCase(), validCase())))
            .isInstanceOf(BatchProcessingException.class);

    assertThat(auditRepository.events())
            .extracting(AuditEvent::type)
            .contains("BATCH_CANCELLED");
}
```

---

## 14. Testing Error Handling dan Reliability

### 14.1 Test success path tidak cukup

Banyak production incident berasal dari failure path yang tidak diuji.

Uji:

- timeout;
- retry exhausted;
- duplicate request;
- duplicate event;
- partial failure;
- transaction rollback;
- poison message;
- dead-letter behavior;
- invalid payload;
- unauthorized access;
- downstream unavailable;
- serialization failure;
- clock skew;
- network partition simulation jika relevan.

### 14.2 Retry test

```java
@Test
void submit_shouldRetryTransientGatewayFailure_thenSucceed() {
    when(gateway.send(any()))
            .thenThrow(new TransientGatewayException("timeout"))
            .thenReturn(GatewayResponse.ok());

    service.submit(validDraft());

    verify(gateway, times(2)).send(any());
}
```

Jangan hanya verify retry count. Assert final state juga.

```java
assertThat(repository.get(caseId).status()).isEqualTo(CaseStatus.SUBMITTED);
```

### 14.3 Idempotency test

```java
@Test
void submit_shouldReturnSameResult_whenIdempotencyKeyRepeated() {
    IdempotencyKey key = new IdempotencyKey("REQ-001");

    CaseId first = service.submit(validDraft(), key);
    CaseId second = service.submit(validDraft(), key);

    assertThat(second).isEqualTo(first);
    assertThat(repository.count()).isEqualTo(1);
    assertThat(outbox.countEventsOfType("CASE_SUBMITTED")).isEqualTo(1);
}
```

### 14.4 Transaction rollback test

```java
@Test
void submit_shouldRollbackCaseInsert_whenOutboxInsertFails() {
    outbox.failNextInsert();

    assertThatThrownBy(() -> service.submit(validDraft()))
            .isInstanceOf(OutboxException.class);

    assertThat(caseRepository.findAll()).isEmpty();
    assertThat(outbox.findAll()).isEmpty();
}
```

Jika outbox dalam DB transaction yang sama, ini penting.

### 14.5 Poison message test

```java
@Test
void consume_shouldSendToDlq_whenPayloadIsInvalid() {
    consumer.consume(invalidPayloadMessage());

    assertThat(dlq.messages())
            .singleElement()
            .satisfies(message -> {
                assertThat(message.reason()).isEqualTo("INVALID_SCHEMA");
                assertThat(message.originalPayload()).isNotBlank();
            });
}
```

---

## 15. Testing Persistence

### 15.1 Repository test scope

Repository test harus membuktikan:

- mapping benar;
- query benar;
- constraint benar;
- transaction behavior benar;
- optimistic lock benar;
- pagination/sorting benar;
- timezone mapping benar;
- JSON/LOB behavior benar;
- index-sensitive query tidak rusak.

### 15.2 Jangan mock query penting

Buruk:

```java
when(repository.findEligibleCases()).thenReturn(List.of(case1, case2));
```

Jika risiko utama adalah query eligibility, mock tidak berguna.

Gunakan real DB integration test.

### 15.3 Test optimistic locking

```java
@Test
void update_shouldFail_whenVersionIsStale() {
    CaseRecord original = repository.save(submittedCase());

    CaseRecord copy1 = repository.findById(original.id()).orElseThrow();
    CaseRecord copy2 = repository.findById(original.id()).orElseThrow();

    repository.update(copy1.approve(officerA));

    assertThatThrownBy(() -> repository.update(copy2.reject("late")))
            .isInstanceOf(OptimisticLockException.class);
}
```

### 15.4 Test pagination determinism

Pagination tanpa deterministic order berbahaya.

```java
@Test
void search_shouldReturnStablePageOrder() {
    insertCasesWithSameSubmissionDate();

    Page<CaseSummary> page1 = repository.search(criteria, PageRequest.of(0, 10));
    Page<CaseSummary> page2 = repository.search(criteria, PageRequest.of(0, 10));

    assertThat(page2.items()).isEqualTo(page1.items());
}
```

Query harus punya tie-breaker, misalnya:

```sql
ORDER BY submitted_at DESC, case_id ASC
```

### 15.5 Test timezone persistence

```java
@Test
void submittedAt_shouldPersistAsInstantUtc() {
    Instant submittedAt = Instant.parse("2026-06-11T10:00:00Z");

    repository.save(caseWithSubmittedAt(submittedAt));

    CaseRecord loaded = repository.findById(caseId).orElseThrow();
    assertThat(loaded.submittedAt()).isEqualTo(submittedAt);
}
```

---

## 16. Testing Serialization dan API

### 16.1 JSON serialization test

```java
@Test
void serializeCaseSubmitted_shouldMatchContract() throws Exception {
    CaseSubmitted event = new CaseSubmitted(
            "EVT-001",
            "CASE-001",
            Instant.parse("2026-06-11T10:00:00Z")
    );

    String json = objectMapper.writeValueAsString(event);

    assertThatJson(json).isEqualTo("""
        {
          "eventId": "EVT-001",
          "caseId": "CASE-001",
          "occurredAt": "2026-06-11T10:00:00Z"
        }
        """);
}
```

### 16.2 Deserialization strictness

Test behavior unknown field:

```java
@Test
void deserialize_shouldRejectUnknownFields_forCommandPayload() {
    String json = """
        {
          "caseId": "CASE-001",
          "unknownField": "x"
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, SubmitCaseCommand.class))
            .isInstanceOf(UnrecognizedPropertyException.class);
}
```

Tentukan policy:

- command input sebaiknya strict;
- event consumer mungkin perlu lebih tolerant tergantung compatibility strategy.

### 16.3 Snapshot/golden file test

Untuk payload besar, gunakan golden file.

```text
src/test/resources/contracts/case-submitted-v1.json
```

Test:

```java
String expected = Files.readString(Path.of("src/test/resources/contracts/case-submitted-v1.json"));
assertThatJson(actual).isEqualTo(expected);
```

Golden file harus direview seperti code.

### 16.4 API error response test

Pastikan error response stabil:

```json
{
  "code": "CASE_NOT_FOUND",
  "message": "Case not found",
  "correlationId": "..."
}
```

Test:

```java
mockMvc.perform(get("/cases/CASE-404"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CASE_NOT_FOUND"))
        .andExpect(jsonPath("$.correlationId").exists());
```

---

## 17. Testing Security

### 17.1 Security test categories

- authentication;
- authorization;
- input validation;
- output encoding;
- SQL injection prevention;
- SSRF prevention;
- path traversal prevention;
- deserialization filtering;
- cryptographic parameter validation;
- secret redaction;
- audit log.

### 17.2 Authorization matrix test

Authorization sering lebih baik diuji sebagai matrix.

```java
@ParameterizedTest
@MethodSource("accessMatrix")
void access_shouldFollowAuthorizationMatrix(Role role, CaseStatus status, boolean allowed) {
    AccessDecision decision = policy.canView(role, status);

    assertThat(decision.allowed()).isEqualTo(allowed);
}

static Stream<Arguments> accessMatrix() {
    return Stream.of(
            arguments(Role.APPLICANT, CaseStatus.DRAFT, true),
            arguments(Role.APPLICANT, CaseStatus.INTERNAL_REVIEW, false),
            arguments(Role.OFFICER, CaseStatus.INTERNAL_REVIEW, true),
            arguments(Role.AUDITOR, CaseStatus.INTERNAL_REVIEW, true)
    );
}
```

### 17.3 Secret redaction test

```java
@Test
void log_shouldRedactAccessToken() {
    String log = formatter.format(Map.of(
            "accessToken", "secret-token",
            "caseId", "CASE-001"
    ));

    assertThat(log).contains("CASE-001");
    assertThat(log).doesNotContain("secret-token");
    assertThat(log).contains("accessToken=***");
}
```

### 17.4 Path traversal test

```java
@Test
void download_shouldRejectPathTraversal() {
    assertThatThrownBy(() -> documentService.download("../../etc/passwd"))
            .isInstanceOf(InvalidPathException.class);
}
```

---

## 18. Testing Observability

### 18.1 Test logs only when logs are contract

Jangan terlalu sering assert log, karena brittle.

Tetapi audit/security logs kadang kontrak.

Contoh:

```java
@Test
void approve_shouldWriteAuditEvent() {
    service.approve(caseId, officer);

    assertThat(auditRepository.eventsFor(caseId))
            .anySatisfy(event -> {
                assertThat(event.action()).isEqualTo("CASE_APPROVED");
                assertThat(event.actorId()).isEqualTo(officer.id());
                assertThat(event.occurredAt()).isNotNull();
            });
}
```

Lebih baik test audit event terstruktur daripada plain log string.

### 18.2 Metrics test

Jika metrics penting:

```java
@Test
void submit_shouldIncrementRejectedCounter_whenValidationFails() {
    service.submit(invalidDraft());

    assertThat(meterRegistry.counter("case.submit.rejected").count())
            .isEqualTo(1.0);
}
```

Jangan assert semua metrics internal. Pilih SLO/alert-critical metrics.

### 18.3 Trace/correlation test

```java
@Test
void event_shouldCarryCorrelationId() {
    CorrelationId correlationId = new CorrelationId("CORR-001");

    service.submit(validDraft(), correlationId);

    assertThat(outbox.lastEvent().correlationId()).isEqualTo(correlationId);
}
```

---

## 19. Test Data Management

### 19.1 Deterministic fixture

Test harus deterministic:

- fixed clock;
- fixed UUID;
- fixed locale;
- fixed timezone;
- known seed untuk randomness;
- stable ordering;
- no external network unless explicitly integration.

### 19.2 Locale/timezone isolation

CI bisa jalan dengan timezone berbeda.

Untuk test waktu:

```java
TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
Locale.setDefault(Locale.ROOT);
```

Lebih baik jangan bergantung default sama sekali.

Inject `Clock`, gunakan explicit `ZoneId`, gunakan `Locale.ROOT` atau locale spesifik.

### 19.3 Avoid production-like giant fixture

Fixture terlalu besar membuat test sulit dibaca.

Better:

```java
validCase()
    .withStatus(SUBMITTED)
    .withAssignedOfficer(officer)
```

Daripada file JSON 500 baris untuk setiap unit test.

### 19.4 Fixture lifecycle

Untuk integration DB test:

- setup data minimal;
- cleanup jelas;
- hindari dependency antar test;
- jangan mengandalkan order test;
- gunakan unique ID per test.

### 19.5 Test fixture sebagai DSL

Untuk domain kompleks, buat DSL:

```java
CaseScenario.given()
        .draftCase("CASE-001")
        .submittedBy("USER-001")
        .assignedTo("OFFICER-001")
        .whenApprove()
        .thenStatusIs(APPROVED)
        .thenAuditContains("CASE_APPROVED");
```

DSL bagus jika:

- domain flow kompleks;
- banyak scenario;
- readability penting;
- DSL tidak menyembunyikan assertion penting.

---

## 20. Test Architecture untuk Java Project Besar

### 20.1 Package test mengikuti package production

Production:

```text
src/main/java/com/example/caseapp/domain/CaseRecord.java
```

Test:

```text
src/test/java/com/example/caseapp/domain/CaseRecordTest.java
```

Ini memudahkan navigasi.

### 20.2 Shared test utilities

Struktur:

```text
src/test/java/com/example/caseapp/testsupport/
  CaseDraftBuilder.java
  FixedClock.java
  InMemoryCaseRepository.java
  JsonAssertions.java
  DatabaseCleaner.java
```

Aturan:

- testsupport tidak boleh menjadi framework internal terlalu kompleks;
- utility test harus lebih sederhana daripada production code;
- jangan membuat abstraction test yang menyembunyikan behavior.

### 20.3 Test module untuk multi-module project

Dalam multi-module Maven/Gradle:

```text
case-domain
case-application
case-adapter-postgres
case-adapter-kafka
case-api
case-test-support
```

`case-test-support` boleh berisi:

- test fixture;
- fake repository;
- contract model;
- builders;
- custom assertions.

Hati-hati agar production tidak bergantung ke test module.

### 20.4 Custom assertions

Daripada mengulang assertion kompleks:

```java
assertThatCase(record)
        .hasStatus(APPROVED)
        .hasVersion(3)
        .wasApprovedBy(officer.id());
```

Implementasi:

```java
final class CaseRecordAssert extends AbstractAssert<CaseRecordAssert, CaseRecord> {

    CaseRecordAssert(CaseRecord actual) {
        super(actual, CaseRecordAssert.class);
    }

    static CaseRecordAssert assertThatCase(CaseRecord actual) {
        return new CaseRecordAssert(actual);
    }

    CaseRecordAssert hasStatus(CaseStatus expected) {
        isNotNull();
        if (!Objects.equals(actual.status(), expected)) {
            failWithMessage("Expected status <%s> but was <%s>", expected, actual.status());
        }
        return this;
    }
}
```

Custom assertion meningkatkan readability jika domain sering diuji.

---

## 21. Flaky Tests

### 21.1 Definisi flaky test

Flaky test adalah test yang bisa pass/fail tanpa perubahan code.

Ini sangat berbahaya karena:

- menurunkan trust pada CI;
- membuat engineer mengabaikan failure;
- memperlambat delivery;
- menyembunyikan bug nyata.

### 21.2 Penyebab umum

- time dependency;
- random data;
- shared mutable state;
- test order dependency;
- external network;
- real clock;
- `Thread.sleep`;
- race condition;
- port collision;
- database leftover state;
- environment-specific locale/timezone;
- filesystem path assumption;
- parallel execution tanpa isolation.

### 21.3 Anti-flaky checklist

- Inject `Clock`.
- Gunakan unique ID per test.
- Jangan bergantung order test.
- Cleanup state.
- Hindari sleep.
- Pin Docker image.
- Gunakan explicit locale/timezone.
- Jangan pakai real external service di unit/CI test.
- Pisahkan slow/flaky quarantine, tetapi tetap perbaiki akar masalah.

### 21.4 Flaky test policy

Policy yang sehat:

```text
Flaky test adalah defect.
```

Bukan:

```text
rerun sampai hijau.
```

Rerun boleh untuk mitigasi sementara, bukan solusi.

---

## 22. CI/CD Testing Strategy

### 22.1 Stage umum

```text
1. Compile
2. Static analysis
3. Unit tests
4. Integration tests
5. Contract tests
6. Security/dependency scan
7. Mutation/performance targeted
8. Package artifact
9. Deploy to test env
10. Smoke/E2E
```

### 22.2 Fast feedback

PR harus cepat.

Rekomendasi:

- unit test dan static analysis wajib di PR;
- integration test penting dijalankan di PR atau pre-merge tergantung durasi;
- E2E bisa targeted;
- mutation/performance bisa nightly atau per module kritis.

### 22.3 Quality gates

Quality gate yang lebih bermakna:

- semua test pass;
- no flaky test known;
- branch coverage untuk domain-critical module;
- mutation score minimal untuk critical logic;
- no high/critical vulnerability;
- contract compatible;
- migration test pass;
- performance regression tidak melewati threshold;
- no known test quarantine tanpa owner/tiket.

### 22.4 Coverage threshold dengan bijak

Threshold contoh:

```text
Domain core: branch coverage tinggi
Generated DTO: excluded
Configuration class: lower requirement
Critical policy: mutation score required
```

Jangan memakai satu threshold global buta untuk semua module.

### 22.5 Test report

CI harus menghasilkan:

- JUnit XML report;
- coverage report;
- mutation report;
- integration test logs;
- container logs on failure;
- screenshots untuk UI/E2E jika ada;
- performance trend.

---

## 23. Testing Legacy Java Code

### 23.1 Legacy code problem

Legacy code sering:

- static everywhere;
- constructor besar;
- hidden dependency;
- private method kompleks;
- no interface boundary;
- real DB call di business logic;
- time/random langsung;
- framework-coupled domain;
- no tests.

### 23.2 Characterization test

Sebelum refactor legacy, tulis characterization test:

```text
Test yang menangkap behavior saat ini, bahkan jika behavior-nya belum ideal.
```

Tujuan:

- memahami behavior aktual;
- membuat safety net;
- refactor tanpa mengubah behavior tak sengaja.

### 23.3 Seam

Seam adalah titik di mana behavior bisa diganti saat test.

Contoh seam:

- interface;
- constructor parameter;
- factory;
- protected method override untuk legacy;
- adapter boundary;
- dependency injection;
- wrapper untuk static API.

### 23.4 Sprout method/class

Jika method legacy terlalu besar, jangan langsung rewrite total.

Tambahkan method/class baru yang testable:

```text
legacy method → extract pure policy → test policy → gradually redirect logic
```

### 23.5 Golden master

Untuk behavior kompleks, golden master bisa membantu:

1. generate output dari existing system;
2. simpan sebagai expected;
3. refactor;
4. pastikan output tetap sama.

Hati-hati: golden master mengunci bug lama juga. Gunakan untuk refactor, bukan validasi kebenaran domain.

---

## 24. Testing with Modules / JPMS

### 24.1 Module visibility problem

Jika production module tidak export package internal, test mungkin tidak bisa mengakses class package-private.

Pilihan:

1. test only public API;
2. buat test module;
3. gunakan `--add-opens` untuk framework/reflection;
4. desain package boundary ulang;
5. tempatkan test di package sama jika build mendukung patch module.

### 24.2 Maven/Gradle JPMS testing

Testing modular Java sering butuh konfigurasi:

- module path;
- patch module;
- add reads;
- add opens;
- test runtime access.

Framework reflection-heavy seperti Mockito/Jackson/Spring bisa perlu `opens` atau `--add-opens`.

### 24.3 Prinsip

Jangan membuka module hanya karena test ingin mengakses implementation detail.

Tanya dulu:

```text
Apakah behavior ini seharusnya public contract?
Apakah class internal ini terlalu kompleks sehingga perlu diekstrak?
Apakah package-private test cukup?
Apakah module boundary sudah tepat?
```

---

## 25. Testing Java Modern Features

### 25.1 Records

Record cocok untuk value/data carrier.

Test compact constructor invariant:

```java
record CaseId(String value) {
    CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case id must not be blank");
        }
    }
}
```

Test:

```java
@Test
void constructor_shouldRejectBlankValue() {
    assertThatThrownBy(() -> new CaseId(" "))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must not be blank");
}
```

### 25.2 Sealed hierarchy

Sealed type cocok untuk exhaustive state/error/result.

Test behavior per subtype:

```java
@ParameterizedTest
@MethodSource("terminalStates")
void reopen_shouldBeAllowedOnlyForTerminalRejectedState(CaseState state, boolean allowed) {
    assertThat(policy.canReopen(state)).isEqualTo(allowed);
}
```

### 25.3 Pattern matching switch

Test exhaustiveness indirectly:

```java
String label(CaseResult result) {
    return switch (result) {
        case CaseResult.Accepted accepted -> "accepted";
        case CaseResult.Rejected rejected -> "rejected";
    };
}
```

Jika hierarchy berubah, compiler membantu. Tetapi runtime compatibility tetap perlu diperhatikan di distributed system.

### 25.4 Virtual threads

Test tidak boleh berasumsi nama thread/platform thread.

Fokus ke behavior:

- completion;
- cancellation;
- timeout;
- resource cap;
- context propagation.

### 25.5 Scoped values

Test scoped context:

```java
@Test
void audit_shouldReadActorFromScopedContext() {
    ScopedValue.where(ACTOR_ID, new ActorId("USER-001"))
            .run(() -> {
                service.submit(validDraft());
                assertThat(audit.last().actorId()).isEqualTo(new ActorId("USER-001"));
            });
}
```

---

## 26. Anti-Patterns Testing di Java

### 26.1 Test yang hanya mirror implementation

```java
assertThat(service.calculate(x)).isEqualTo(repository.find(x).map(policy::calculate).orElse(...));
```

Jika expected dihitung dengan logic yang sama, test tidak membuktikan apa-apa.

### 26.2 Test terlalu banyak mock

Test pass meskipun integrated behavior rusak.

### 26.3 Assertion terlalu lemah

```java
assertNotNull(result);
```

Ini jarang cukup.

### 26.4 Testing framework, bukan code kita

Jangan menulis test untuk membuktikan `HashMap.put` bekerja.

### 26.5 One giant test

Sulit debug, sulit maintain.

### 26.6 Test order dependency

```java
@TestMethodOrder(OrderAnnotation.class)
```

Gunakan hanya untuk scenario test khusus. Unit/integration test normal harus independent.

### 26.7 Sleep-based async test

Lambat dan flaky.

### 26.8 Hidden external dependency

Unit test yang diam-diam call real HTTP/database adalah integration test buruk.

### 26.9 Snapshot abuse

Snapshot besar mudah di-approve tanpa memahami perubahan.

### 26.10 Ignoring failing tests

Jika test sering gagal dan diabaikan, test suite kehilangan nilai sosialnya.

---

## 27. Decision Framework: Test Apa yang Harus Dibuat?

### 27.1 Pertanyaan inti

Sebelum menulis test, tanyakan:

1. Behavior apa yang ingin dibuktikan?
2. Risiko apa yang dikurangi?
3. Boundary mana yang relevan?
4. Apakah dependency nyata dibutuhkan?
5. Apakah test harus cepat atau realistis?
6. Apakah assertion membuktikan invariant penting?
7. Apakah test deterministic?
8. Apakah failure test mudah didiagnosis?

### 27.2 Decision table

| Situasi | Test yang cocok |
|---|---|
| Pure domain rule | Unit test |
| State transition complex | Unit + property + mutation |
| SQL/query/constraint | Integration test dengan DB nyata |
| Kafka event schema | Integration + contract test |
| API compatibility | Contract/API test |
| User journey critical | Targeted E2E |
| Async/eventual consistency | Integration + Awaitility |
| Lock-free/concurrency primitive | jcstress |
| Algorithm hot path | JMH |
| Security authorization matrix | Parameterized unit/component test |
| Bug production | Regression test |

### 27.3 Testing strategy untuk new feature

Untuk fitur baru:

1. Tulis domain unit tests untuk rules.
2. Tulis integration test untuk persistence/message/API boundary.
3. Tulis contract test jika ada consumer/provider.
4. Tulis failure-path tests.
5. Tambahkan observability/audit assertions jika critical.
6. Tambahkan property/mutation/performance jika risk tinggi.

---

## 28. Mini Project — Case Lifecycle Test Suite

### 28.1 Goal

Bangun test suite untuk mini domain:

```text
Case lifecycle:
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED
DRAFT → SUBMITTED → UNDER_REVIEW → REJECTED
REJECTED → REOPENED → UNDER_REVIEW
```

### 28.2 Domain requirements

1. Case hanya bisa submitted dari DRAFT.
2. Case submitted harus punya applicantId dan minimal satu document.
3. UNDER_REVIEW harus punya assigned officer.
4. APPROVED harus punya approvedBy dan approvedAt.
5. REJECTED harus punya rejection reason.
6. Transition sukses menaikkan version tepat 1.
7. Invalid transition tidak boleh mutate state.
8. Duplicate command dengan idempotency key sama tidak boleh membuat event ganda.
9. Setiap transition sukses menghasilkan audit event.
10. Event harus punya eventId, caseId, version, occurredAt, correlationId.

### 28.3 Test suite yang harus dibuat

#### Unit tests

- `CaseRecordTest`
- `CaseTransitionPolicyTest`
- `CaseValidationPolicyTest`
- `CaseDeadlinePolicyTest`
- `CaseAuthorizationPolicyTest`

#### Parameterized tests

- valid transition matrix;
- invalid transition matrix;
- authorization matrix;
- deadline weekend/holiday matrix.

#### Property-based tests

- successful transition increments version by one;
- invalid transition leaves case unchanged;
- normalized case ID is idempotent;
- serialized/deserialized event preserves identity fields.

#### Integration tests

- repository save/find;
- unique constraint caseId;
- optimistic lock;
- outbox transaction;
- migration applies cleanly.

#### Contract tests

- `CaseSubmitted` event v1 schema;
- error response format;
- status enum compatibility.

#### Reliability tests

- duplicate idempotency key;
- downstream timeout retry;
- poison event to DLQ;
- transaction rollback.

#### Mutation testing

Run PIT on:

- transition policy;
- validation policy;
- authorization policy;
- deadline policy.

#### Performance tests

Use JMH for:

- case ID parser;
- validation batch;
- event serialization if hot path.

### 28.4 Suggested package structure

```text
case-lifecycle/
  src/main/java/com/example/caseapp/
    domain/
      CaseRecord.java
      CaseStatus.java
      CaseTransitionPolicy.java
      CaseValidationPolicy.java
    application/
      CaseCommandService.java
      IdempotencyService.java
    infrastructure/
      JdbcCaseRepository.java
      OutboxRepository.java

  src/test/java/com/example/caseapp/
    domain/
      CaseRecordTest.java
      CaseTransitionPolicyTest.java
      CaseTransitionProperties.java
    application/
      CaseCommandServiceTest.java
    testsupport/
      CaseBuilder.java
      FixedClock.java
      InMemoryCaseRepository.java
      CaseAssertions.java

  src/integrationTest/java/com/example/caseapp/
    infrastructure/
      CaseRepositoryIT.java
      OutboxTransactionIT.java
      MigrationIT.java
```

### 28.5 Success criteria

Test suite dianggap baik jika:

- unit tests cepat;
- integration tests deterministic;
- failure message jelas;
- mutation score tinggi pada policy critical;
- tidak ada flaky test;
- bug injection kecil dapat ditangkap;
- test bisa dibaca sebagai dokumentasi lifecycle.

---

## 29. Production-Grade Testing Checklist

### 29.1 Unit test checklist

- [ ] Nama test menjelaskan behavior.
- [ ] Arrange/Act/Assert jelas.
- [ ] Assertion kuat.
- [ ] Tidak bergantung waktu nyata.
- [ ] Tidak bergantung random nyata.
- [ ] Tidak call external dependency.
- [ ] Tidak over-mock.
- [ ] Test independent.
- [ ] Fixture minimal.
- [ ] Failure message membantu.

### 29.2 Integration test checklist

- [ ] Dependency nyata atau realistis.
- [ ] Data cleanup jelas.
- [ ] Image/version dipin.
- [ ] Migration dijalankan.
- [ ] Constraint diuji.
- [ ] Transaction diuji.
- [ ] Timeout masuk akal.
- [ ] Logs/container logs tersedia saat gagal.

### 29.3 Contract test checklist

- [ ] Required fields diuji.
- [ ] Optional field compatibility jelas.
- [ ] Enum evolution dipertimbangkan.
- [ ] Error response diuji.
- [ ] Event key/header/schema diuji.
- [ ] Provider menjalankan contract consumer.

### 29.4 Async/concurrency checklist

- [ ] Tidak pakai sleep buta.
- [ ] Timeout jelas.
- [ ] Cancellation diuji.
- [ ] Interruption diuji jika relevan.
- [ ] Executor lifecycle ditutup.
- [ ] Shared state aman.
- [ ] Eventual consistency pakai Awaitility.

### 29.5 Security/reliability checklist

- [ ] Authorization matrix diuji.
- [ ] Input invalid diuji.
- [ ] Secret redaction diuji.
- [ ] Duplicate request diuji.
- [ ] Retry exhausted diuji.
- [ ] DLQ diuji.
- [ ] Rollback diuji.
- [ ] Audit event diuji.

---

## 30. Ringkasan Mental Model

Testing di Java bukan sekadar JUnit syntax.

Model yang harus dipegang:

```text
Correctness tidak muncul dari banyak test,
tetapi dari test yang tepat pada risiko yang tepat.
```

JUnit memberi test platform. Mockito memberi test double. Testcontainers memberi dependency nyata. jqwik memberi eksplorasi input. PIT menguji kualitas test. JMH menguji performa secara lebih benar. jcstress menguji concurrency edge. Awaitility membantu async test lebih deterministic.

Tetapi tool hanyalah alat. Nilai testing berasal dari kemampuan engineer menjawab:

```text
Behavior apa yang harus tetap benar?
Apa invariant-nya?
Apa failure mode-nya?
Apa boundary yang realistis?
Apa bukti yang cukup sebelum release?
```

Top-tier Java engineer tidak hanya mengejar test green. Ia membangun test suite yang:

- cepat memberi feedback;
- sulit menipu diri sendiri;
- menjaga domain invariant;
- menangkap integration risk;
- mengurangi flakiness;
- mendukung refactoring;
- menjadi dokumentasi behavior;
- meningkatkan confidence release.

---

## 31. Latihan Bertahap

### Latihan 1 — JUnit basic

Buat class `CaseId` dengan invariant:

- tidak boleh null;
- tidak boleh blank;
- harus diawali `CASE-`;
- normalized ke uppercase.

Tulis test untuk valid dan invalid input.

### Latihan 2 — Parameterized test

Buat authorization matrix untuk role:

- applicant;
- officer;
- supervisor;
- auditor.

Status:

- draft;
- submitted;
- under review;
- approved;
- rejected.

Tulis parameterized test.

### Latihan 3 — Test data builder

Buat `CaseDraftBuilder` untuk mengurangi fixture noise.

### Latihan 4 — Mockito

Buat `CaseCommandService` yang memakai:

- repository;
- audit publisher;
- id generator;
- clock.

Mock side-effect boundary dan assert audit event.

### Latihan 5 — Integration test DB

Gunakan Testcontainers PostgreSQL untuk menguji:

- insert case;
- find by ID;
- duplicate key;
- optimistic locking.

### Latihan 6 — Property-based test

Dengan jqwik, uji:

```text
normalize(normalize(caseId)) == normalize(caseId)
```

### Latihan 7 — Mutation testing

Jalankan PIT pada `CaseTransitionPolicy`. Tambahkan test sampai mutant penting terbunuh.

### Latihan 8 — Async test

Buat background processor yang memproses event ke read model. Uji dengan Awaitility tanpa `Thread.sleep`.

### Latihan 9 — JMH

Benchmark dua implementasi parser `CaseId.parse`.

### Latihan 10 — jcstress

Buat counter non-thread-safe dan counter atomic. Bandingkan behavior dengan stress test sederhana.

---

## 32. Referensi Utama

1. JUnit User Guide 6.1.0 — https://docs.junit.org/6.1.0/overview.html
2. JUnit main site — https://junit.org/
3. Testcontainers Java JUnit Jupiter integration — https://java.testcontainers.org/test_framework_integration/junit_5/
4. Testcontainers lifecycle guide — https://testcontainers.com/guides/testcontainers-container-lifecycle/
5. Mockito site — https://site.mockito.org/
6. Mockito JUnit Jupiter extension Javadoc — https://javadoc.io/doc/org.mockito/mockito-junit-jupiter/latest/org.mockito.junit.jupiter/org/mockito/junit/jupiter/MockitoExtension.html
7. jqwik User Guide — https://jqwik.net/docs/current/user-guide.html
8. PIT Maven Quickstart — https://pitest.org/quickstart/maven/
9. OpenJDK JMH project — https://openjdk.org/projects/code-tools/jmh/
10. OpenJDK JMH GitHub — https://github.com/openjdk/jmh
11. OpenJDK jcstress project — https://openjdk.org/projects/code-tools/jcstress/
12. Awaitility — https://www.awaitility.org/
13. Java SE 25 Documentation — https://docs.oracle.com/en/java/javase/25/
14. Java SE 25 API Documentation — https://docs.oracle.com/en/java/javase/25/docs/api/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java Part 016 — Modules, Packaging, dan Runtime Images](./learn-java-part-016.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: learn-java-part-018 — Enterprise Java dan Backend Engineering](./learn-java-part-018.md)
