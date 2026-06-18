# learn-java-testing-benchmarking-performance-jvm-part-002

# JUnit Evolution: JUnit 4, JUnit 5, JUnit 6, dan Kompatibilitas Java 8–25

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `002`  
> Topik: JUnit architecture, lifecycle, migration, engine, extension, compatibility, build integration  
> Target pembaca: Java engineer yang sudah paham Java dasar, OOP, collection, concurrency, JDBC, Jakarta/JAX-RS, dan ingin naik ke level test engineering yang lebih matang.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas **test taxonomy dan test strategy**: jenis test apa saja yang tersedia, risiko apa yang ditangani oleh masing-masing jenis test, dan bagaimana menyusun test portfolio untuk sistem enterprise Java.

Part ini masuk ke fondasi eksekusi test Java paling umum: **JUnit**.

Namun tujuan part ini bukan sekadar menghafal annotation seperti `@Test`, `@BeforeEach`, atau `@AfterEach`. Tujuan sebenarnya adalah memahami:

1. **JUnit sebagai runtime test platform**, bukan hanya library assertion.
2. **Perbedaan generasi JUnit 4, 5, dan 6**.
3. **Bagaimana test ditemukan, dijalankan, difilter, diparalelkan, dan diintegrasikan dengan Maven/Gradle/IDE/CI**.
4. **Bagaimana menjaga kompatibilitas Java 8 sampai Java 25**.
5. **Bagaimana melakukan migrasi tanpa merusak ribuan test legacy**.
6. **Bagaimana menghindari desain test suite yang rapuh, lambat, dan sulit dipercaya**.

JUnit adalah salah satu bagian kecil dari testing, tetapi dampaknya sangat besar karena hampir semua test Java modern berakhir dijalankan melalui JUnit Platform, baik langsung maupun tidak langsung.

---

## 1. Mental Model: JUnit Bukan Sekadar `@Test`

Banyak engineer melihat JUnit seperti ini:

```java
@Test
void shouldCalculateTotal() {
    assertEquals(100, calculator.total());
}
```

Itu benar, tetapi terlalu sempit.

Mental model yang lebih kuat:

```text
JUnit = test execution infrastructure
      + programming model
      + discovery mechanism
      + lifecycle orchestration
      + extension point
      + filtering/tagging model
      + reporting integration
      + build/IDE/CI bridge
```

Dengan kata lain, JUnit menjawab pertanyaan:

```text
Test mana yang harus dijalankan?
Bagaimana test ditemukan?
Dalam urutan apa test dijalankan?
Fixture dibuat kapan?
Extension dipanggil kapan?
Exception dianggap gagal atau sukses?
Test mana yang di-skip?
Tag mana yang aktif?
Berapa thread yang dipakai?
Bagaimana hasil test dilaporkan ke build tool?
Bagaimana test legacy tetap jalan?
```

Jika kita hanya tahu annotation, kita bisa menulis test.  
Jika kita paham runtime model, kita bisa **mengelola test suite besar**.

Itu perbedaan antara developer yang bisa membuat test dan engineer yang bisa membangun testing platform yang scalable.

---

## 2. Evolusi JUnit secara Singkat

Secara praktis, dalam project Java enterprise kita akan sering bertemu tiga generasi:

| Generasi | Status Praktis | Baseline Umum | Kegunaan Utama |
|---|---:|---:|---|
| JUnit 4 | Legacy tetapi masih banyak | Java 5+ historis, umum di Java 8 legacy | Test lama, rules, runners, Spring legacy |
| JUnit 5 | Modern baseline Java 8+ | Java 8+ | JUnit Platform, Jupiter, Vintage, extension model |
| JUnit 6 | Modern terbaru | Java 17+ | Unified versioning, modern platform, JFR integration, baseline Java 17 |

Perubahan terbesar bukan dari JUnit 5 ke 6. Perubahan terbesar adalah dari JUnit 4 ke JUnit 5, karena JUnit 5 memecah JUnit menjadi tiga konsep besar:

```text
JUnit Platform
JUnit Jupiter
JUnit Vintage
```

### 2.1 JUnit 4

JUnit 4 adalah generasi klasik. Ciri utamanya:

- `@Test` dari package `org.junit.Test`.
- Assertion dari `org.junit.Assert`.
- Lifecycle:
  - `@Before`
  - `@After`
  - `@BeforeClass`
  - `@AfterClass`
- Runner model:
  - `@RunWith(...)`
- Rule model:
  - `@Rule`
  - `@ClassRule`
- Category:
  - `@Category(...)`
- Parameterized runner:
  - `@RunWith(Parameterized.class)`

Contoh JUnit 4:

```java
import org.junit.Before;
import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class PriceCalculatorTest {

    private PriceCalculator calculator;

    @Before
    public void setUp() {
        calculator = new PriceCalculator();
    }

    @Test
    public void shouldCalculateTotalPrice() {
        Money total = calculator.total(Money.of(100), Money.of(25));

        assertEquals(Money.of(125), total);
    }
}
```

JUnit 4 masih banyak ditemukan di:

- aplikasi Java 8 lama,
- project Spring lama,
- library yang belum migrasi,
- test suite yang memakai custom runner,
- test suite yang bergantung pada `@Rule` atau `@ClassRule`,
- project dengan ribuan test lama yang belum layak dimigrasikan sekaligus.

### 2.2 JUnit 5

JUnit 5 bukan satu artifact tunggal. Ia adalah kombinasi dari tiga sub-project besar:

```text
JUnit 5 = JUnit Platform + JUnit Jupiter + JUnit Vintage
```

#### JUnit Platform

JUnit Platform adalah foundation untuk menjalankan testing framework di JVM.

Fungsinya:

- test discovery,
- test execution,
- launcher API,
- engine API,
- reporting bridge,
- integration dengan build tool dan IDE.

JUnit Platform tidak hanya bisa menjalankan Jupiter. Ia bisa menjalankan engine lain, misalnya:

- Jupiter engine,
- Vintage engine,
- custom engine,
- engine dari framework lain jika tersedia.

#### JUnit Jupiter

JUnit Jupiter adalah programming model modern untuk menulis test JUnit 5.

Ia menyediakan:

- `@Test`,
- `@BeforeEach`,
- `@AfterEach`,
- `@BeforeAll`,
- `@AfterAll`,
- `@Nested`,
- `@DisplayName`,
- `@ParameterizedTest`,
- `@TestFactory`,
- extension model,
- conditional execution,
- repeated tests,
- dynamic tests.

Contoh JUnit Jupiter:

```java
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PriceCalculatorTest {

    private PriceCalculator calculator;

    @BeforeEach
    void setUp() {
        calculator = new PriceCalculator();
    }

    @Test
    void shouldCalculateTotalPrice() {
        Money total = calculator.total(Money.of(100), Money.of(25));

        assertEquals(Money.of(125), total);
    }
}
```

#### JUnit Vintage

JUnit Vintage adalah engine untuk menjalankan test JUnit 3 dan JUnit 4 di atas JUnit Platform.

Ini penting saat migrasi:

```text
Legacy JUnit 4 tests
        ↓
JUnit Vintage Engine
        ↓
JUnit Platform
        ↓
Maven/Gradle/IDE/CI
```

Tanpa Vintage, banyak organisasi akan dipaksa melakukan big-bang migration. Dengan Vintage, kita bisa menjalankan test lama dan test baru berdampingan.

### 2.3 JUnit 6

JUnit 6 adalah generasi terbaru. Hal penting untuk engineer Java 8–25:

- JUnit 6 membutuhkan Java 17+.
- JUnit 6 memakai satu version number untuk Platform, Jupiter, dan Vintage.
- JUnit 6 modernizes platform baseline.
- JUnit 6 menghapus beberapa komponen lama seperti `junit-platform-runner`.
- JUnit 6 membawa integrasi modern seperti JFR-related functionality dalam launcher.

Implikasinya:

```text
Java 8 / Java 11 project  → tidak bisa menjadikan JUnit 6 sebagai test runtime utama.
Java 17+ project          → bisa mempertimbangkan JUnit 6.
Java 21 / Java 25 project → JUnit 6 adalah pilihan natural untuk new codebase.
```

Namun bukan berarti semua project Java 17+ harus langsung migrasi. Untuk enterprise, keputusan migrasi tetap harus mempertimbangkan:

- plugin build tool,
- Spring Boot/Jakarta version,
- dependency BOM,
- IDE support,
- CI image,
- test extension compatibility,
- third-party testing library compatibility,
- cost migrasi.

---

## 3. Compatibility Matrix Java 8–25

Untuk seri ini, kita anggap rentang Java 8 sampai Java 25 sebagai realitas enterprise.

| Java Version | Real-World Context | JUnit Strategy |
|---:|---|---|
| Java 8 | Legacy enterprise, masih umum di sistem lama | JUnit 4 atau JUnit 5.x; tidak JUnit 6 |
| Java 11 | Banyak migrasi pasca Java 8 | JUnit 5.x sangat cocok; JUnit 6 tidak cocok |
| Java 17 | Baseline modern enterprise | JUnit 5.x atau JUnit 6 |
| Java 21 | Modern LTS, virtual threads | JUnit 5.x atau JUnit 6; test concurrency perlu perhatian |
| Java 25 | Modern/latest enterprise baseline | JUnit 6 natural; tetap evaluasi ecosystem support |

Rule of thumb:

```text
Jika production masih Java 8/11:
    gunakan JUnit 5.x untuk modernisasi bertahap,
    gunakan Vintage jika masih ada JUnit 4.

Jika production Java 17+:
    JUnit 6 layak dipakai untuk project baru,
    JUnit 5.x masih sah jika dependency ecosystem belum siap.

Jika library harus support Java 8:
    jangan pakai JUnit 6 sebagai baseline test runtime yang memaksa compile/test Java 17-only.
```

Catatan penting: test code boleh memakai versi Java yang berbeda dari production code dalam beberapa setup, tetapi ini harus dilakukan hati-hati. Jika production artifact harus kompatibel Java 8, test code yang memakai Java 17 feature bisa menyembunyikan masalah kompatibilitas build, bytecode, atau API.

Untuk library yang benar-benar support Java 8, gunakan matrix CI:

```text
compile target: Java 8
run tests on: Java 8, 11, 17, 21, 25
```

Untuk aplikasi enterprise internal:

```text
production runtime = test runtime baseline utama
```

Jangan menguji aplikasi Java 8 hanya di Java 21 lalu menganggap aman untuk Java 8 runtime.

---

## 4. Package dan Annotation: Jangan Campur Sembarangan

Salah satu sumber bug migrasi JUnit paling umum adalah import yang salah.

### 4.1 JUnit 4 Imports

```java
import org.junit.Test;
import org.junit.Before;
import org.junit.After;
import org.junit.BeforeClass;
import org.junit.AfterClass;
import org.junit.Ignore;
import org.junit.Assert;
```

### 4.2 JUnit Jupiter Imports

```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Assertions;
```

### 4.3 Anti-Pattern: Mixed Import dalam Satu Class

Contoh berbahaya:

```java
import org.junit.Test; // JUnit 4
import org.junit.jupiter.api.BeforeEach; // JUnit Jupiter

class BrokenTest {

    @BeforeEach
    void setUp() {
        // Mungkin tidak dipanggil jika test dieksekusi sebagai JUnit 4 test.
    }

    @Test
    public void shouldWork() {
        // org.junit.Test dari JUnit 4
    }
}
```

Masalahnya bukan sekadar style. Masalahnya adalah lifecycle bisa tidak berjalan sesuai ekspektasi.

Rule:

```text
Dalam satu test class, jangan campur annotation JUnit 4 dan Jupiter.
```

Kalau sedang migrasi, migrasikan per class atau per package secara disiplin.

---

## 5. Lifecycle Model

Lifecycle adalah urutan JUnit membuat instance test, menjalankan setup, menjalankan test, menjalankan teardown, dan mengelola resource.

### 5.1 JUnit 4 Lifecycle

JUnit 4 default-nya membuat instance baru untuk setiap test method.

```java
public class LifecycleTest {

    @BeforeClass
    public static void beforeAll() {
        System.out.println("before class");
    }

    @Before
    public void beforeEach() {
        System.out.println("before each");
    }

    @Test
    public void testA() {
        System.out.println("test A");
    }

    @Test
    public void testB() {
        System.out.println("test B");
    }

    @After
    public void afterEach() {
        System.out.println("after each");
    }

    @AfterClass
    public static void afterAll() {
        System.out.println("after class");
    }
}
```

Urutan mental model:

```text
before class once
    new instance
    before each
    test A
    after each
    discard instance

    new instance
    before each
    test B
    after each
    discard instance
after class once
```

### 5.2 JUnit Jupiter Lifecycle

JUnit Jupiter juga default-nya membuat instance baru per test method.

```java
class LifecycleTest {

    @BeforeAll
    static void beforeAll() {
        System.out.println("before all");
    }

    @BeforeEach
    void beforeEach() {
        System.out.println("before each");
    }

    @Test
    void testA() {
        System.out.println("test A");
    }

    @Test
    void testB() {
        System.out.println("test B");
    }

    @AfterEach
    void afterEach() {
        System.out.println("after each");
    }

    @AfterAll
    static void afterAll() {
        System.out.println("after all");
    }
}
```

### 5.3 `@TestInstance`

JUnit Jupiter memungkinkan mengubah lifecycle instance:

```java
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ExpensiveFixtureTest {

    private ExpensiveClient client;

    @BeforeAll
    void beforeAll() {
        client = new ExpensiveClient();
    }

    @Test
    void testA() {
        // uses client
    }

    @Test
    void testB() {
        // uses same client
    }
}
```

Dengan `PER_CLASS`, `@BeforeAll` tidak harus static.

Tetapi hati-hati:

```text
PER_CLASS memperbesar risiko shared mutable state antar test method.
```

Gunakan hanya bila:

- resource setup mahal,
- state tidak mutable atau selalu di-reset,
- parallel execution dipahami,
- test order tidak menjadi dependency tersembunyi.

### 5.4 Lifecycle Anti-Pattern

#### Anti-pattern 1: Hidden mutable fixture

```java
class BadTest {

    private final List<String> events = new ArrayList<>();

    @Test
    void testA() {
        events.add("A");
        assertEquals(1, events.size());
    }

    @Test
    void testB() {
        events.add("B");
        assertEquals(1, events.size());
    }
}
```

Jika instance lifecycle berubah atau test diparalelkan, test bisa menjadi rapuh.

#### Anti-pattern 2: Global static state

```java
class BadGlobalStateTest {

    private static final Map<String, String> CACHE = new HashMap<>();

    @Test
    void testA() {
        CACHE.put("x", "1");
    }

    @Test
    void testB() {
        assertFalse(CACHE.containsKey("x"));
    }
}
```

Ini adalah sumber flakiness.

Rule:

```text
Setiap test harus bisa dijalankan sendirian, bersama test lain, dalam urutan berbeda, dan idealnya secara paralel.
```

---

## 6. Test Discovery: Bagaimana JUnit Menemukan Test

Test discovery adalah proses mencari test candidate sebelum menjalankan test.

Discovery dipengaruhi oleh:

- engine yang tersedia,
- classpath/module path,
- naming convention build tool,
- annotation,
- visibility,
- selector,
- filter,
- tag/category,
- include/exclude pattern.

### 6.1 Maven Naming Convention

Maven Surefire secara umum menjalankan unit test dengan pola seperti:

```text
**/Test*.java
**/*Test.java
**/*Tests.java
**/*TestCase.java
```

Maven Failsafe sering dipakai untuk integration test dengan pola seperti:

```text
**/IT*.java
**/*IT.java
**/*ITCase.java
```

Praktik enterprise yang jelas:

```text
Unit test:        *Test
Integration test: *IT
Contract test:    *ContractTest
E2E test:         *E2ETest
Benchmark:        *Benchmark, tidak dijalankan oleh surefire biasa
```

### 6.2 Gradle Test Discovery

Gradle menjalankan test melalui `Test` task. Untuk JUnit Platform perlu:

```groovy
test {
    useJUnitPlatform()
}
```

Contoh Kotlin DSL:

```kotlin
tasks.test {
    useJUnitPlatform()
}
```

Tanpa konfigurasi yang benar, test Jupiter bisa tidak dijalankan.

### 6.3 Class Visibility

JUnit 4 biasanya membutuhkan test class/method public.

JUnit Jupiter lebih fleksibel:

```java
class PackagePrivateTest {

    @Test
    void packagePrivateTestMethod() {
        // valid in Jupiter
    }
}
```

Praktik modern:

```text
JUnit Jupiter test class dan method tidak perlu public.
```

Ini mengurangi noise.

---

## 7. Assertion di JUnit: Built-in vs AssertJ

JUnit menyediakan assertion bawaan.

Contoh:

```java
assertEquals(expected, actual);
assertTrue(condition);
assertThrows(IllegalArgumentException.class, () -> service.validate(input));
```

Namun pada test suite besar, built-in assertion sering kurang ekspresif.

Compare:

```java
assertTrue(errors.contains("EMAIL_REQUIRED"));
```

versus:

```java
assertThat(errors)
    .contains("EMAIL_REQUIRED")
    .doesNotContain("SYSTEM_ERROR");
```

JUnit tetap runtime test. AssertJ sering menjadi assertion layer.

Rule praktis:

```text
Gunakan JUnit untuk lifecycle dan execution.
Gunakan AssertJ untuk assertion yang kaya.
Gunakan custom assertion untuk domain behavior penting.
```

Kita akan bahas assertion engineering lebih detail di part 004.

---

## 8. Assumptions dan Conditional Execution

Tidak semua test harus selalu berjalan di semua environment.

Contoh alasan skip:

- hanya jalan di Linux,
- hanya jalan di Java 21+,
- hanya jalan jika Docker tersedia,
- hanya jalan jika environment variable diset,
- hanya jalan di CI nightly,
- hanya jalan untuk integration profile.

### 8.1 JUnit Jupiter Assumptions

```java
@Test
void shouldRunOnlyWhenDockerAvailable() {
    assumeTrue(isDockerAvailable());

    // test continues only if assumption is true
}
```

Jika assumption gagal, test dianggap aborted, bukan failed.

### 8.2 Conditional Annotation

```java
@Test
@EnabledOnOs(OS.LINUX)
void shouldUseLinuxSpecificBehavior() {
}

@Test
@EnabledOnJre(JRE.JAVA_21)
void shouldRunOnJava21() {
}

@Test
@EnabledIfEnvironmentVariable(named = "RUN_SLOW_TESTS", matches = "true")
void slowTest() {
}
```

Gunakan conditional execution untuk environment-specific test, tetapi jangan dipakai untuk menyembunyikan test yang flaky.

Bad smell:

```java
@Disabled("flaky sometimes")
```

Lebih baik:

```text
1. Tandai sebagai flaky.
2. Isolasi root cause.
3. Perbaiki deterministic behavior.
4. Jika perlu quarantine sementara dengan owner dan expiry date.
```

---

## 9. Disabled Test: Kapan Sah, Kapan Berbahaya

JUnit Jupiter:

```java
@Disabled("waiting for external API contract update")
@Test
void shouldHandleNewProviderResponse() {
}
```

JUnit 4:

```java
@Ignore("waiting for external API contract update")
@Test
public void shouldHandleNewProviderResponse() {
}
```

Disabled test sah jika:

- ada alasan jelas,
- ada ticket/issue reference,
- ada owner,
- ada target enable kembali,
- tidak menutupi bug production-critical.

Disabled test berbahaya jika:

- alasannya generik,
- dibiarkan berbulan-bulan,
- tidak terlihat di report,
- menjadi tempat membuang test gagal.

Policy yang sehat:

```text
Disabled test count harus dimonitor.
Disabled test baru harus direview.
Disabled test harus punya expiry.
```

---

## 10. Nested Tests: Struktur Behavior yang Lebih Jelas

JUnit Jupiter mendukung `@Nested`.

Contoh:

```java
class CaseTransitionServiceTest {

    private CaseTransitionService service;

    @BeforeEach
    void setUp() {
        service = new CaseTransitionService();
    }

    @Nested
    class WhenCaseIsDraft {

        @Test
        void shouldAllowSubmit() {
            CaseRecord record = CaseRecord.draft();

            TransitionResult result = service.submit(record);

            assertThat(result.newStatus()).isEqualTo(CaseStatus.SUBMITTED);
        }

        @Test
        void shouldRejectApprove() {
            CaseRecord record = CaseRecord.draft();

            assertThatThrownBy(() -> service.approve(record))
                .isInstanceOf(InvalidTransitionException.class);
        }
    }

    @Nested
    class WhenCaseIsSubmitted {

        @Test
        void shouldAllowStartReview() {
            CaseRecord record = CaseRecord.submitted();

            TransitionResult result = service.startReview(record);

            assertThat(result.newStatus()).isEqualTo(CaseStatus.UNDER_REVIEW);
        }
    }
}
```

Kelebihan `@Nested`:

- behavior lebih terstruktur,
- context terlihat,
- setup bisa berlapis,
- cocok untuk state machine dan workflow.

Bahaya `@Nested`:

- terlalu dalam,
- setup tersembunyi,
- test sulit dibaca jika context bertingkat 4–5 level.

Rule:

```text
Gunakan nested test untuk context behavior, bukan untuk membuat hierarki rumit.
```

Maksimal praktis: 2 level nested dalam kebanyakan codebase.

---

## 11. Display Name: Dokumentasi atau Noise?

JUnit Jupiter mendukung `@DisplayName`.

```java
@Test
@DisplayName("Submit draft case changes status to SUBMITTED and records audit event")
void submitDraftCase() {
}
```

Display name berguna jika:

- test report dibaca oleh non-developer,
- behavior kompleks,
- nama method terlalu terbatas,
- test menjadi executable documentation.

Namun jangan jadikan display name sebagai pengganti nama method yang baik.

Bad:

```java
@Test
@DisplayName("Should calculate total correctly")
void test1() {
}
```

Good:

```java
@Test
@DisplayName("Draft case can be submitted by assigned officer")
void shouldSubmitDraftCaseWhenActorIsAssignedOfficer() {
}
```

Untuk regulatory/workflow systems, display name bisa membantu test report menjadi evidence.

---

## 12. Parameterized Tests

Parameterized test berguna untuk menguji behavior sama dengan banyak input.

### 12.1 Simple Values

```java
@ParameterizedTest
@ValueSource(strings = {"", " ", "\t", "\n"})
void shouldRejectBlankReferenceNumber(String referenceNumber) {
    assertThatThrownBy(() -> ReferenceNumber.of(referenceNumber))
        .isInstanceOf(InvalidReferenceNumberException.class);
}
```

### 12.2 Enum Source

```java
@ParameterizedTest
@EnumSource(value = CaseStatus.class, names = {"APPROVED", "REJECTED", "CLOSED"})
void shouldNotAllowSubmitFromTerminalStatus(CaseStatus status) {
    CaseRecord record = CaseRecord.withStatus(status);

    assertThatThrownBy(() -> transitionService.submit(record))
        .isInstanceOf(InvalidTransitionException.class);
}
```

### 12.3 CSV Source

```java
@ParameterizedTest
@CsvSource({
    "DRAFT, SUBMIT, SUBMITTED",
    "SUBMITTED, START_REVIEW, UNDER_REVIEW",
    "UNDER_REVIEW, APPROVE, APPROVED",
    "UNDER_REVIEW, REJECT, REJECTED"
})
void shouldApplyValidTransition(
        CaseStatus current,
        CaseAction action,
        CaseStatus expected
) {
    CaseRecord record = CaseRecord.withStatus(current);

    CaseRecord updated = transitionService.apply(record, action);

    assertThat(updated.status()).isEqualTo(expected);
}
```

### 12.4 Method Source

```java
@ParameterizedTest
@MethodSource("invalidTransitions")
void shouldRejectInvalidTransition(CaseStatus current, CaseAction action) {
    CaseRecord record = CaseRecord.withStatus(current);

    assertThatThrownBy(() -> transitionService.apply(record, action))
        .isInstanceOf(InvalidTransitionException.class);
}

static Stream<Arguments> invalidTransitions() {
    return Stream.of(
        Arguments.of(CaseStatus.DRAFT, CaseAction.APPROVE),
        Arguments.of(CaseStatus.APPROVED, CaseAction.SUBMIT),
        Arguments.of(CaseStatus.REJECTED, CaseAction.START_REVIEW)
    );
}
```

### 12.5 Kapan Parameterized Test Cocok?

Cocok untuk:

- validation matrix,
- state transition matrix,
- role/permission matrix,
- boundary value,
- enum behavior,
- parser behavior,
- mapping behavior,
- compatibility matrix.

Kurang cocok jika:

- setiap case punya setup sangat berbeda,
- assertion tiap case berbeda jauh,
- test menjadi tabel besar yang sulit dibaca,
- failure message tidak cukup jelas.

Rule:

```text
Parameterized test bagus ketika variasi input jelas dan expected behavior seragam.
```

Jika behavior bercabang-cabang, tulis test eksplisit.

---

## 13. Dynamic Tests

JUnit Jupiter mendukung dynamic tests melalui `@TestFactory`.

```java
@TestFactory
Stream<DynamicTest> dynamicTransitionTests() {
    return validTransitions().stream()
        .map(rule -> dynamicTest(
            rule.current() + " + " + rule.action() + " -> " + rule.expected(),
            () -> {
                CaseRecord record = CaseRecord.withStatus(rule.current());

                CaseRecord updated = transitionService.apply(record, rule.action());

                assertThat(updated.status()).isEqualTo(rule.expected());
            }
        ));
}
```

Dynamic tests berguna jika test case dibuat dari:

- configuration,
- external data,
- generated scenario,
- state machine graph,
- compatibility matrix,
- contract file.

Namun dynamic tests juga bisa membuat test discovery/reporting lebih sulit dibanding parameterized tests.

Rule:

```text
Gunakan @ParameterizedTest untuk kasus tabel statis.
Gunakan @TestFactory jika test case memang perlu dibangun secara dinamis.
```

---

## 14. Repeated Tests

Repeated test menjalankan test yang sama berkali-kali.

```java
@RepeatedTest(10)
void shouldGenerateUniqueReferenceNumber() {
    ReferenceNumber first = generator.next();
    ReferenceNumber second = generator.next();

    assertThat(first).isNotEqualTo(second);
}
```

Kegunaan:

- smoke detection untuk random behavior,
- probabilistic bug kecil,
- race yang sangat sederhana,
- flaky reproduction sementara.

Namun repeated test bukan pengganti concurrency test yang benar.

Untuk concurrency correctness, gunakan tool khusus seperti `jcstress` pada part concurrency.

---

## 15. Tags dan Categories

### 15.1 JUnit 4 Categories

```java
public interface SlowTest {}

@Category(SlowTest.class)
public class ReportGenerationIT {
    @Test
    public void shouldGenerateLargeReport() {
    }
}
```

### 15.2 JUnit Jupiter Tags

```java
@Tag("integration")
class CaseRepositoryIT {

    @Test
    void shouldPersistCaseRecord() {
    }
}
```

Tag yang umum:

```text
unit
integration
contract
e2e
slow
database
messaging
container
performance
flaky
```

Namun terlalu banyak tag bisa membuat test strategy kacau.

Lebih baik tag berdasarkan execution policy:

```text
fast      → every commit
integration → pull request / CI
slow      → nightly
performance → dedicated pipeline
flaky     → quarantine only
```

### 15.3 Maven Example

```xml
<configuration>
    <groups>unit</groups>
</configuration>
```

Atau exclude:

```xml
<configuration>
    <excludedGroups>slow,flaky</excludedGroups>
</configuration>
```

### 15.4 Gradle Example

```kotlin
tasks.test {
    useJUnitPlatform {
        excludeTags("slow", "flaky")
    }
}
```

Integration test task:

```kotlin
tasks.register<Test>("integrationTest") {
    useJUnitPlatform {
        includeTags("integration")
    }
    shouldRunAfter(tasks.test)
}
```

---

## 16. JUnit Extension Model

JUnit 4 memakai Runner dan Rule.

JUnit Jupiter memakai Extension model.

### 16.1 JUnit 4 Runner Problem

JUnit 4 hanya bisa memakai satu runner:

```java
@RunWith(SpringRunner.class)
public class MyTest {
}
```

Jika kita butuh runner lain, mulai muncul konflik.

### 16.2 JUnit 4 Rule

```java
public class TemporaryFolderTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    @Test
    public void shouldWriteFile() throws IOException {
        File file = temp.newFile("data.txt");
    }
}
```

Rule berguna, tetapi modelnya terbatas dan kadang sulit dikombinasikan.

### 16.3 JUnit Jupiter Extension

JUnit Jupiter extension lebih composable.

Extension point meliputi:

- `BeforeAllCallback`
- `BeforeEachCallback`
- `AfterEachCallback`
- `AfterAllCallback`
- `ParameterResolver`
- `ExecutionCondition`
- `TestExecutionExceptionHandler`
- `TestInstancePostProcessor`
- `BeforeTestExecutionCallback`
- `AfterTestExecutionCallback`

Contoh extension sederhana:

```java
public class CorrelationIdExtension implements BeforeEachCallback, AfterEachCallback {

    @Override
    public void beforeEach(ExtensionContext context) {
        CorrelationIdHolder.set("test-" + UUID.randomUUID());
    }

    @Override
    public void afterEach(ExtensionContext context) {
        CorrelationIdHolder.clear();
    }
}
```

Pemakaian:

```java
@ExtendWith(CorrelationIdExtension.class)
class AuditServiceTest {

    @Test
    void shouldRecordCorrelationId() {
        auditService.record("CASE_SUBMITTED");

        assertThat(auditRepository.latest().correlationId())
            .startsWith("test-");
    }
}
```

### 16.4 ParameterResolver

```java
public class FixedClockExtension implements ParameterResolver {

    private static final Clock FIXED_CLOCK = Clock.fixed(
        Instant.parse("2026-01-01T00:00:00Z"),
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
        return FIXED_CLOCK;
    }
}
```

Pemakaian:

```java
@ExtendWith(FixedClockExtension.class)
class SlaCalculatorTest {

    @Test
    void shouldCalculateDueDate(Clock clock) {
        SlaCalculator calculator = new SlaCalculator(clock);

        LocalDate dueDate = calculator.calculateDueDate(5);

        assertThat(dueDate).isEqualTo(LocalDate.of(2026, 1, 6));
    }
}
```

### 16.5 Kapan Membuat Extension?

Extension cocok untuk cross-cutting test concern:

- fixed clock,
- correlation ID,
- security context,
- tenant context,
- locale/timezone,
- temporary directory,
- database cleanup,
- test container lifecycle,
- leak detection,
- system property isolation,
- thread-local cleanup,
- log capture.

Jangan membuat extension untuk hal yang lebih jelas ditulis langsung di test.

Rule:

```text
Extension harus mengurangi accidental complexity, bukan menyembunyikan behavior penting.
```

---

## 17. Parallel Execution

JUnit Jupiter mendukung parallel execution, tetapi default-nya perlu dikonfigurasi.

Parallel test bisa mempercepat CI, tetapi juga membuka bug tersembunyi.

### 17.1 Syarat Test Bisa Diparalelkan

Test lebih aman diparalelkan jika:

- tidak memakai global mutable state,
- tidak bergantung pada urutan,
- tidak memakai fixed port yang sama,
- tidak menulis file path yang sama,
- tidak berbagi database rows tanpa isolasi,
- tidak mengubah system properties global tanpa restore,
- tidak mengubah timezone/default locale global tanpa restore,
- tidak memakai singleton cache yang bocor antar test.

### 17.2 JUnit Platform Properties

Contoh `junit-platform.properties`:

```properties
junit.jupiter.execution.parallel.enabled = true
junit.jupiter.execution.parallel.mode.default = concurrent
junit.jupiter.execution.parallel.mode.classes.default = concurrent
junit.jupiter.execution.parallel.config.strategy = dynamic
```

Atau fixed:

```properties
junit.jupiter.execution.parallel.enabled = true
junit.jupiter.execution.parallel.config.strategy = fixed
junit.jupiter.execution.parallel.config.fixed.parallelism = 4
```

### 17.3 Resource Lock

Jika test harus berbagi resource, JUnit menyediakan resource lock.

```java
@ResourceLock("system-properties")
class SystemPropertyTest {

    @Test
    void shouldReadFeatureFlag() {
        System.setProperty("feature.x.enabled", "true");
        try {
            assertThat(config.isFeatureXEnabled()).isTrue();
        } finally {
            System.clearProperty("feature.x.enabled");
        }
    }
}
```

Tapi resource lock bukan alasan untuk membiarkan desain test buruk. Ia safety net.

### 17.4 Parallel Execution Strategy

Untuk enterprise codebase:

```text
Step 1: parallelize pure unit tests.
Step 2: isolate integration tests by schema/container.
Step 3: quarantine global-state tests.
Step 4: remove shared mutable fixtures.
Step 5: enable class-level parallelism before method-level parallelism.
```

Jangan langsung parallelize semua test suite besar tanpa observability. Itu hanya akan menciptakan flaky storm.

---

## 18. Test Ordering: Kapan Perlu, Kapan Salah

JUnit Jupiter mendukung ordering:

```java
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class OrderedTest {

    @Test
    @Order(1)
    void first() {
    }

    @Test
    @Order(2)
    void second() {
    }
}
```

Namun test order biasanya smell.

Valid use case terbatas:

- integration test yang mahal dan benar-benar scenario-based,
- migration verification sequence,
- educational test,
- generated scenario suite.

Untuk unit test, order dependency hampir selalu buruk.

Bad:

```text
testCreateUser must run before testUpdateUser
```

Good:

```text
each test creates its own user fixture
```

Jika ingin menguji workflow urutan panjang, biasanya lebih baik satu test scenario eksplisit:

```java
@Test
void shouldCompleteCaseLifecycle() {
    CaseRecord draft = caseService.createDraft(...);
    CaseRecord submitted = caseService.submit(draft.id());
    CaseRecord reviewed = caseService.startReview(submitted.id());
    CaseRecord approved = caseService.approve(reviewed.id());

    assertThat(approved.status()).isEqualTo(CaseStatus.APPROVED);
}
```

Bukan memecah satu workflow ke banyak test method yang saling bergantung.

---

## 19. Migration JUnit 4 ke JUnit Jupiter

Migrasi JUnit 4 ke Jupiter sebaiknya incremental.

### 19.1 Mapping Annotation

| JUnit 4 | JUnit Jupiter |
|---|---|
| `org.junit.Test` | `org.junit.jupiter.api.Test` |
| `@Before` | `@BeforeEach` |
| `@After` | `@AfterEach` |
| `@BeforeClass` | `@BeforeAll` |
| `@AfterClass` | `@AfterAll` |
| `@Ignore` | `@Disabled` |
| `@Category` | `@Tag` |
| `@RunWith` | `@ExtendWith` or framework-specific support |
| `@Rule` | extension or built-in Jupiter feature |
| `@ClassRule` | extension / `@BeforeAll` / framework support |

### 19.2 Assertion Mapping

JUnit 4:

```java
import static org.junit.Assert.assertEquals;
```

Jupiter:

```java
import static org.junit.jupiter.api.Assertions.assertEquals;
```

Namun jika codebase memakai AssertJ, migration assertion bisa minimal.

### 19.3 Exception Test Migration

JUnit 4 old style:

```java
@Test(expected = InvalidTransitionException.class)
public void shouldRejectInvalidTransition() {
    service.approve(CaseRecord.draft());
}
```

Masalah: test hanya memastikan exception type, bukan message atau detail.

JUnit Jupiter:

```java
@Test
void shouldRejectInvalidTransition() {
    InvalidTransitionException exception = assertThrows(
        InvalidTransitionException.class,
        () -> service.approve(CaseRecord.draft())
    );

    assertThat(exception.getCode()).isEqualTo("INVALID_TRANSITION");
}
```

Dengan AssertJ:

```java
@Test
void shouldRejectInvalidTransition() {
    assertThatThrownBy(() -> service.approve(CaseRecord.draft()))
        .isInstanceOf(InvalidTransitionException.class)
        .hasMessageContaining("DRAFT")
        .extracting("code")
        .isEqualTo("INVALID_TRANSITION");
}
```

### 19.4 TemporaryFolder Rule Migration

JUnit 4:

```java
@Rule
public TemporaryFolder folder = new TemporaryFolder();
```

Jupiter:

```java
@Test
void shouldWriteFile(@TempDir Path tempDir) throws IOException {
    Path file = tempDir.resolve("data.txt");

    Files.writeString(file, "hello");

    assertThat(Files.readString(file)).isEqualTo("hello");
}
```

### 19.5 ExpectedException Rule Migration

JUnit 4:

```java
@Rule
public ExpectedException thrown = ExpectedException.none();

@Test
public void shouldReject() {
    thrown.expect(InvalidTransitionException.class);
    thrown.expectMessage("DRAFT");

    service.approve(CaseRecord.draft());
}
```

Jupiter:

```java
@Test
void shouldReject() {
    assertThatThrownBy(() -> service.approve(CaseRecord.draft()))
        .isInstanceOf(InvalidTransitionException.class)
        .hasMessageContaining("DRAFT");
}
```

### 19.6 Migration Strategy

Practical strategy:

```text
1. Add JUnit Platform support.
2. Add Vintage engine so JUnit 4 tests still run.
3. Ensure CI reports still show all tests.
4. Migrate new tests to Jupiter only.
5. Migrate old tests per package/module, not randomly.
6. Replace Rules/Runners carefully.
7. Remove Vintage only when no JUnit 4 tests remain.
8. Enforce import rule with static analysis if possible.
```

Do not do this:

```text
Convert all imports mechanically without understanding runners/rules.
```

Because many JUnit 4 features are behavioral, not syntactic.

---

## 20. Build Tool Integration

### 20.1 Maven: JUnit Jupiter Basic Setup

Example for Java 17+ with JUnit 6 style dependency management:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.junit</groupId>
            <artifactId>junit-bom</artifactId>
            <version>6.0.0</version>
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
</dependencies>
```

Surefire:

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-surefire-plugin</artifactId>
            <version>3.6.0</version>
        </plugin>
    </plugins>
</build>
```

For Java 8/11, use JUnit 5.x instead of JUnit 6.

### 20.2 Maven: Mixed JUnit 4 and Jupiter

```xml
<dependencies>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.junit.vintage</groupId>
        <artifactId>junit-vintage-engine</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>junit</groupId>
        <artifactId>junit</artifactId>
        <version>4.13.2</version>
        <scope>test</scope>
    </dependency>
</dependencies>
```

### 20.3 Maven Surefire vs Failsafe

Recommended split:

```text
maven-surefire-plugin → unit tests
maven-failsafe-plugin → integration tests
```

Convention:

```text
*Test.java → surefire
*IT.java   → failsafe
```

Failsafe lifecycle:

```text
pre-integration-test
integration-test
post-integration-test
verify
```

Why this matters:

```text
Integration tests often need external resources.
Failsafe is designed to ensure cleanup still happens around integration lifecycle.
```

### 20.4 Gradle Setup

Groovy DSL:

```groovy
dependencies {
    testImplementation platform('org.junit:junit-bom:6.0.0')
    testImplementation 'org.junit.jupiter:junit-jupiter'
}

test {
    useJUnitPlatform()
}
```

Kotlin DSL:

```kotlin
dependencies {
    testImplementation(platform("org.junit:junit-bom:6.0.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

tasks.test {
    useJUnitPlatform()
}
```

For Java 8/11, use JUnit 5.x BOM.

---

## 21. IDE dan CI Reality

Test yang jalan di IDE tetapi gagal di CI adalah masalah umum.

Penyebab:

- IDE memakai JUnit runner berbeda,
- working directory berbeda,
- timezone berbeda,
- locale berbeda,
- Java version berbeda,
- environment variable berbeda,
- test order berbeda,
- parallelism berbeda,
- missing resource file,
- classpath/module path berbeda.

Rule untuk top-tier engineer:

```text
CI adalah source of truth.
IDE convenience tidak boleh menjadi definisi kebenaran.
```

Namun developer experience tetap penting. Maka:

```text
1. Samakan Java version via toolchain.
2. Samakan JUnit Platform config.
3. Commit junit-platform.properties.
4. Jangan bergantung pada local env tersembunyi.
5. Buat test bisa dijalankan dari command line.
```

Command baseline:

```bash
./mvnw test
./mvnw verify
./gradlew test
./gradlew integrationTest
```

Jika test hanya bisa dijalankan dari IDE, test suite belum production-grade.

---

## 22. Module Path dan Java 9+ Considerations

Jika project memakai Java Platform Module System, test runtime bisa menjadi lebih kompleks.

Masalah umum:

- reflective access blocked,
- package not exported,
- module not opened,
- split package,
- test code perlu akses package-private,
- mocking framework butuh deep reflection.

Contoh module:

```java
module com.example.caseapp {
    requires java.sql;
    exports com.example.caseapp.api;
}
```

Test mungkin butuh:

```text
--add-opens
--add-exports
```

Namun jangan asal menambahkan banyak `--add-opens` hingga menyembunyikan desain module yang buruk.

Rule:

```text
Jika test butuh membuka terlalu banyak internal package, evaluasi apakah boundary modul terlalu sempit, test terlalu white-box, atau framework memang butuh reflection.
```

Untuk enterprise app non-library, banyak project tetap menggunakan classpath. Itu valid. Tetapi jika memakai module path, test setup harus dianggap bagian dari architecture.

---

## 23. JUnit dengan Spring, Jakarta, dan Enterprise Framework

Karena seri sebelumnya sudah membahas Jakarta/JAX-RS, di sini kita tidak mengulang framework detail. Fokusnya adalah JUnit interaction.

### 23.1 JUnit 4 Spring

```java
@RunWith(SpringRunner.class)
@SpringBootTest
public class CaseServiceIT {
}
```

### 23.2 Jupiter Spring

```java
@SpringBootTest
class CaseServiceIT {
}
```

Spring extension biasanya sudah terintegrasi dengan Jupiter melalui extension model.

Mental model:

```text
Framework test annotation sering mendaftarkan JUnit extension di belakang layar.
```

### 23.3 Caution: Context Startup Cost

`@SpringBootTest` mahal.

Jangan pakai full application context untuk semua test.

Better strategy:

```text
Domain unit test      → no Spring
Application service   → minimal collaborators/fakes
Repository test       → DB integration test
API slice             → web slice if framework supports it
Full stack test       → limited number, critical flows only
```

JUnit memberi runtime. Framework annotation menentukan seberapa mahal runtime itu.

---

## 24. Test Instance State dan ThreadLocal Cleanup

Banyak enterprise app memakai context global:

- security context,
- tenant context,
- correlation ID,
- request context,
- locale context,
- MDC logging context.

Test harus membersihkan context ini.

Bad:

```java
@Test
void shouldUseAdminUser() {
    SecurityContext.set(User.admin());

    service.approve(caseId);
}
```

Jika tidak clear, test berikutnya bisa tercemar.

Better:

```java
@AfterEach
void tearDown() {
    SecurityContext.clear();
    TenantContext.clear();
    MDC.clear();
}
```

Even better: extension.

```java
public class ContextCleanupExtension implements AfterEachCallback {

    @Override
    public void afterEach(ExtensionContext context) {
        SecurityContext.clear();
        TenantContext.clear();
        MDC.clear();
    }
}
```

Pemakaian:

```java
@ExtendWith(ContextCleanupExtension.class)
class ApprovalServiceTest {
}
```

For top-tier reliability, treat context cleanup as invariant:

```text
No test may leak ThreadLocal/global context to another test.
```

---

## 25. JUnit dan Time

Time adalah sumber flakiness besar.

Bad:

```java
@Test
void shouldExpireAfterOneHour() throws InterruptedException {
    Token token = service.createToken();

    Thread.sleep(Duration.ofHours(1).toMillis());

    assertThat(service.isExpired(token)).isTrue();
}
```

Good:

```java
@Test
void shouldExpireAfterOneHour() {
    MutableClock clock = MutableClock.startingAt("2026-01-01T00:00:00Z");
    TokenService service = new TokenService(clock);

    Token token = service.createToken();

    clock.advance(Duration.ofHours(1).plusMillis(1));

    assertThat(service.isExpired(token)).isTrue();
}
```

JUnit lifecycle bisa menyediakan clock fixture, tetapi desain production code harus injectable.

Rule:

```text
JUnit tidak memperbaiki code yang tidak testable. JUnit hanya mengeksekusi test.
```

Jika production code memanggil `Instant.now()` langsung di mana-mana, test akan sulit deterministic.

---

## 26. Exception Semantics di JUnit

Testing exception bukan hanya type.

Weak:

```java
assertThrows(RuntimeException.class, () -> service.submit(caseId));
```

Better:

```java
InvalidTransitionException exception = assertThrows(
    InvalidTransitionException.class,
    () -> service.submit(caseId)
);

assertThat(exception.getCode()).isEqualTo("INVALID_TRANSITION");
assertThat(exception.getCurrentStatus()).isEqualTo(CaseStatus.CLOSED);
assertThat(exception.getRequestedAction()).isEqualTo(CaseAction.SUBMIT);
```

Dalam enterprise/regulatory system, exception sering menjadi part of contract.

Test minimal harus memverifikasi:

```text
exception type
error code
message/domain detail
non-retryable/retryable classification
HTTP mapping if applicable
audit/log side effect if required
```

---

## 27. JUnit dan Test Reporting sebagai Evidence

JUnit XML report sering dipakai CI/CD.

Namun report test enterprise harus bisa menjawab:

```text
Apa yang diuji?
Berapa yang lulus/gagal/skip?
Test mana yang disabled?
Test mana yang flaky?
Berapa durasi test?
Apakah integration test benar-benar berjalan?
Apakah JUnit 4 legacy test masih ikut jalan?
Apakah tag tertentu tidak sengaja ter-exclude?
```

Untuk regulatory/case-management platform, test report bisa menjadi evidence tambahan saat release.

Praktik baik:

- gunakan nama test behavior-oriented,
- gunakan display name untuk business-critical tests,
- jangan hide failure dengan disabled,
- pisahkan report unit/integration/contract,
- archive test report di CI,
- track test count over time,
- fail build jika test count tiba-tiba turun drastis.

Test count drop adalah sinyal serius.

Contoh:

```text
Yesterday: 8,240 tests
Today:    5,112 tests
Build:    green
```

Ini bukan good news. Ini mungkin discovery/configuration failure.

---

## 28. JUnit Platform Configuration File

JUnit Platform bisa dikonfigurasi melalui:

```text
src/test/resources/junit-platform.properties
```

Contoh:

```properties
junit.jupiter.testinstance.lifecycle.default = per_method
junit.jupiter.execution.parallel.enabled = false
junit.jupiter.conditions.deactivate =
junit.jupiter.displayname.generator.default = org.junit.jupiter.api.DisplayNameGenerator$ReplaceUnderscores
```

Untuk parallel:

```properties
junit.jupiter.execution.parallel.enabled = true
junit.jupiter.execution.parallel.mode.default = same_thread
junit.jupiter.execution.parallel.mode.classes.default = concurrent
```

Ini contoh strategi aman: class parallel, method within class same thread.

Kenapa ini lebih aman?

```text
Banyak test class punya fixture per class yang belum tentu method-level thread-safe.
Class-level parallelism memberi speedup dengan risiko lebih rendah.
```

---

## 29. Naming Convention yang Konsisten

Recommended naming:

```text
Class under test: CaseTransitionService
Unit test:        CaseTransitionServiceTest
Integration test: CaseTransitionServiceIT
Contract test:    CaseTransitionContractTest
E2E test:         CaseApprovalE2ETest
```

Method naming options:

### Option A: should-style

```java
void shouldSubmitDraftCaseWhenActorIsAssignedOfficer()
```

### Option B: given-when-then style

```java
void givenDraftCaseAndAssignedOfficer_whenSubmit_thenCaseBecomesSubmitted()
```

### Option C: readable underscore style

```java
void draft_case_can_be_submitted_by_assigned_officer()
```

Choose one convention per codebase.

For Java, I prefer:

```text
shouldXWhenY
```

for most teams because it is readable, compact, and works well with IDE.

But for domain-heavy workflow tests, underscore style can be very readable if team accepts it.

---

## 30. JUnit Anti-Patterns

### 30.1 Test Method Named `test1`

Bad:

```java
@Test
void test1() {
}
```

Good:

```java
@Test
void shouldRejectApprovalWhenCaseIsDraft() {
}
```

### 30.2 Testing Multiple Unrelated Behaviors

Bad:

```java
@Test
void shouldHandleCase() {
    // create
    // submit
    // approve
    // reject
    // delete
    // export
}
```

Good:

```java
@Test
void shouldSubmitDraftCase() {
}

@Test
void shouldApproveCaseUnderReview() {
}

@Test
void shouldRejectDeleteForApprovedCase() {
}
```

Long scenario tests are allowed only when scenario itself is the behavior under test.

### 30.3 Order-Dependent Tests

Bad:

```java
@Test
@Order(1)
void createUser() {}

@Test
@Order(2)
void updateUser() {}
```

Good:

```java
@Test
void shouldUpdateExistingUser() {
    User user = userRepository.save(UserFixture.validUser());

    userService.update(user.id(), updateRequest);

    assertThat(userRepository.findById(user.id())).hasValueSatisfying(...);
}
```

### 30.4 Overuse of `@SpringBootTest`

Bad:

```java
@SpringBootTest
class MoneyTest {
    @Test
    void shouldAddMoney() {}
}
```

Money value object does not need Spring context.

Good:

```java
class MoneyTest {
    @Test
    void shouldAddMoney() {}
}
```

### 30.5 Sleeping in Tests

Bad:

```java
Thread.sleep(1000);
```

Better:

- fake clock,
- Awaitility for async condition,
- deterministic synchronization,
- explicit callback/latch with timeout.

### 30.6 Assertion-Free Test

Bad:

```java
@Test
void shouldProcess() {
    service.process(command);
}
```

This only verifies no exception, maybe intentionally, but usually weak.

Better:

```java
@Test
void shouldPersistAuditEventWhenCommandProcessed() {
    service.process(command);

    assertThat(auditRepository.findLatest())
        .hasValueSatisfying(event -> {
            assertThat(event.action()).isEqualTo("COMMAND_PROCESSED");
            assertThat(event.actorId()).isEqualTo(command.actorId());
        });
}
```

If the intended assertion is “does not throw”, be explicit:

```java
assertDoesNotThrow(() -> service.process(command));
```

### 30.7 Catching Exception Manually

Bad:

```java
@Test
void shouldReject() {
    try {
        service.reject(input);
    } catch (InvalidInputException e) {
        return;
    }
}
```

This passes even if no exception? Actually if no assertion after try, it may pass incorrectly depending on structure.

Good:

```java
assertThrows(InvalidInputException.class, () -> service.reject(input));
```

### 30.8 Too Much Logic in Test

Bad:

```java
@Test
void shouldCalculate() {
    BigDecimal expected = BigDecimal.ZERO;
    for (Item item : items) {
        expected = expected.add(item.price().multiply(BigDecimal.valueOf(item.qty())));
    }

    assertThat(service.total(items)).isEqualByComparingTo(expected);
}
```

If expected calculation duplicates production algorithm, the test may share the same bug.

Better:

```java
@Test
void shouldCalculateTotalForMultipleItems() {
    List<Item> items = List.of(
        item("A", "10.00", 2),
        item("B", "5.50", 3)
    );

    Money total = service.total(items);

    assertThat(total).isEqualTo(Money.of("36.50"));
}
```

---

## 31. Practical Migration Example: Legacy JUnit 4 to Jupiter

### 31.1 Before: JUnit 4

```java
@RunWith(MockitoJUnitRunner.class)
public class CaseApprovalServiceTest {

    @Mock
    private CaseRepository caseRepository;

    @Mock
    private AuditService auditService;

    @InjectMocks
    private CaseApprovalService service;

    @Test(expected = InvalidTransitionException.class)
    public void approveShouldRejectDraftCase() {
        CaseRecord draft = CaseRecord.draft("CASE-001");
        when(caseRepository.findById("CASE-001")).thenReturn(Optional.of(draft));

        service.approve("CASE-001", User.officer("u1"));
    }
}
```

Weakness:

- expected exception only verifies type,
- no verification that audit was not recorded,
- no explicit error code,
- JUnit 4 runner locks class into Mockito runner.

### 31.2 After: Jupiter

```java
@ExtendWith(MockitoExtension.class)
class CaseApprovalServiceTest {

    @Mock
    private CaseRepository caseRepository;

    @Mock
    private AuditService auditService;

    @InjectMocks
    private CaseApprovalService service;

    @Test
    void shouldRejectApprovalWhenCaseIsDraft() {
        CaseRecord draft = CaseRecord.draft("CASE-001");
        when(caseRepository.findById("CASE-001")).thenReturn(Optional.of(draft));

        InvalidTransitionException exception = assertThrows(
            InvalidTransitionException.class,
            () -> service.approve("CASE-001", User.officer("u1"))
        );

        assertThat(exception.getCode()).isEqualTo("INVALID_TRANSITION");
        assertThat(exception.getCurrentStatus()).isEqualTo(CaseStatus.DRAFT);
        verify(auditService, never()).recordApproval(any());
    }
}
```

Better:

- Jupiter extension model,
- richer exception assertion,
- side-effect verified,
- behavior name clearer.

---

## 32. JUnit Version Decision Framework

Use this decision tree:

```text
Is production runtime Java 17+?
    No:
        Use JUnit 5.x if possible.
        Keep JUnit 4 only for legacy tests.
        Use Vintage during migration.
        Do not use JUnit 6.

    Yes:
        Is this a new project?
            Yes:
                Use JUnit 6 unless ecosystem constraint blocks it.
            No:
                Are current JUnit 5 tests stable?
                    Yes:
                        Upgrade deliberately, not casually.
                    No:
                        Fix test suite quality before major framework migration.
```

Enterprise principle:

```text
Do not migrate testing framework just to feel modern.
Migrate when it improves maintainability, compatibility, observability, or ecosystem alignment.
```

---

## 33. Recommended Baselines

### 33.1 Java 8 Legacy App

```text
JUnit: 5.x
Vintage: yes, if legacy JUnit 4 exists
JUnit 6: no
Mockito: compatible version
AssertJ: compatible version
Build: Surefire/Failsafe supporting JUnit Platform
```

### 33.2 Java 11 App

```text
JUnit: 5.x
Vintage: only during migration
JUnit 6: no
Focus: remove JUnit 4 gradually
```

### 33.3 Java 17 App

```text
JUnit: 5.x or 6.x
JUnit 6: viable
Vintage: avoid for new tests
Focus: extension model, parallel execution, better reporting
```

### 33.4 Java 21 App

```text
JUnit: 6.x for new app, 5.x acceptable for existing app
Focus: virtual-thread-aware tests, concurrency hygiene, modern build tooling
```

### 33.5 Java 25 App

```text
JUnit: 6.x natural baseline
Focus: modern JDK toolchain, JFR-integrated test diagnostics, strict CI matrix if needed
```

---

## 34. Checklist: JUnit Suite yang Sehat

Gunakan checklist ini untuk audit codebase.

### 34.1 Discovery

```text
[ ] Semua test yang diharapkan benar-benar ter-discover.
[ ] Test count stabil dan tidak turun tanpa alasan.
[ ] Naming convention jelas.
[ ] Unit dan integration test dipisah.
[ ] Benchmark tidak dijalankan sebagai unit test biasa.
```

### 34.2 Compatibility

```text
[ ] Versi JUnit cocok dengan Java runtime.
[ ] Tidak memakai JUnit 6 untuk Java 8/11 runtime.
[ ] Vintage engine hanya dipakai jika masih ada JUnit 4.
[ ] Import JUnit 4 dan Jupiter tidak tercampur dalam satu class.
```

### 34.3 Lifecycle

```text
[ ] Test tidak bergantung pada urutan.
[ ] Shared mutable fixture diminimalkan.
[ ] ThreadLocal/global context dibersihkan.
[ ] System properties/timezone/locale yang diubah selalu di-restore.
```

### 34.4 Quality

```text
[ ] Nama test menjelaskan behavior.
[ ] Assertion kuat dan spesifik.
[ ] Exception test memverifikasi semantic detail.
[ ] Disabled test punya alasan, owner, dan expiry.
[ ] Tidak ada test kosong atau assertion-free tanpa alasan.
```

### 34.5 Execution

```text
[ ] Test bisa dijalankan dari command line.
[ ] CI adalah source of truth.
[ ] Parallel execution hanya diaktifkan setelah isolation siap.
[ ] Slow/integration/flaky test punya policy jelas.
```

---

## 35. Diagnostic Playbook: Ketika Test Tidak Jalan

Jika test tidak dijalankan padahal seharusnya:

```text
1. Cek nama class sesuai pattern build tool.
2. Cek annotation import: org.junit vs org.junit.jupiter.
3. Cek apakah JUnit Platform aktif.
4. Cek dependency engine: Jupiter/Vintage.
5. Cek Surefire/Gradle config.
6. Cek tag include/exclude.
7. Cek module path/classpath.
8. Cek apakah test class/method visibility cocok.
9. Cek CI command yang dipakai.
10. Cek report test count.
```

Jika setup method tidak terpanggil:

```text
1. Cek campuran @BeforeEach dengan org.junit.Test.
2. Cek lifecycle annotation static/non-static.
3. Cek extension conflict.
4. Cek nested class lifecycle.
```

Jika test flaky setelah parallel:

```text
1. Cari global mutable state.
2. Cari static cache.
3. Cari ThreadLocal leak.
4. Cari fixed port.
5. Cari shared database row.
6. Cari system property mutation.
7. Cari clock/time dependency.
8. Cari test order dependency.
```

---

## 36. Top 1% Engineer Notes

### 36.1 JUnit adalah Platform Boundary

Engineer biasa bertanya:

```text
Annotation apa yang harus dipakai?
```

Engineer senior bertanya:

```text
Bagaimana test ditemukan, diisolasi, diklasifikasi, dijalankan, dan dipercaya di CI?
```

### 36.2 Migration Bukan Find-Replace

Migrasi JUnit 4 ke Jupiter bukan sekadar:

```text
@Before → @BeforeEach
```

Yang benar:

```text
Runner model → extension model
Rule model → extension/resource model
expected exception → semantic exception assertion
category → tag strategy
legacy discovery → platform discovery
```

### 36.3 Test Runtime Adalah Production System Kecil

Test suite besar punya masalah seperti production system:

- resource leak,
- concurrency issue,
- timeout,
- flaky dependency,
- observability gap,
- slow feedback loop,
- environment drift,
- configuration mismatch.

Maka test suite harus di-engineer, bukan hanya ditambahkan.

### 36.4 Jangan Mengejar Modernitas Kosmetik

JUnit 6 bagus untuk Java 17+ modern codebase. Tetapi kalau project Java 8/11 masih besar, memaksa JUnit 6 adalah keputusan salah.

Modern engineering bukan memakai versi terbaru. Modern engineering adalah memilih tool yang cocok dengan constraint sistem.

### 36.5 Test yang Tidak Ter-discover Lebih Berbahaya daripada Test yang Gagal

Test gagal memberi sinyal.  
Test yang diam-diam tidak dijalankan memberi ilusi aman.

Maka test count dan discovery report harus diperhatikan.

---

## 37. Practical Exercise

Untuk codebase Java apa pun, lakukan audit berikut.

### Exercise 1: Import Audit

Cari semua import:

```text
org.junit.Test
org.junit.jupiter.api.Test
org.junit.Before
org.junit.jupiter.api.BeforeEach
```

Temukan class yang mencampur JUnit 4 dan Jupiter.

### Exercise 2: Test Count Baseline

Catat test count lokal dan CI:

```bash
./mvnw test
./mvnw verify
```

atau:

```bash
./gradlew test
```

Bandingkan:

```text
local test count
CI test count
unit test count
integration test count
disabled test count
```

### Exercise 3: Disabled Test Review

Cari:

```text
@Disabled
@Ignore
```

Untuk setiap disabled test, jawab:

```text
Kenapa disabled?
Siapa owner?
Kapan di-enable lagi?
Apakah ada ticket?
Apakah ini menutup risiko critical?
```

### Exercise 4: Lifecycle Leak Review

Cari penggunaan:

```text
static mutable field
ThreadLocal
System.setProperty
TimeZone.setDefault
Locale.setDefault
MDC.put
SecurityContext set
TenantContext set
```

Pastikan cleanup ada.

### Exercise 5: Build Split

Pisahkan:

```text
*Test.java
*IT.java
*ContractTest.java
*E2ETest.java
*Benchmark.java
```

Pastikan benchmark tidak berjalan dalam normal unit test pipeline.

---

## 38. Summary

Part ini membahas JUnit sebagai **test execution platform**, bukan hanya library annotation.

Poin utama:

1. JUnit 4 masih relevan untuk legacy, tetapi model runner/rule-nya punya limitasi.
2. JUnit 5 membawa arsitektur besar: Platform, Jupiter, Vintage.
3. JUnit 6 adalah generasi modern dengan baseline Java 17+, sehingga tidak cocok untuk Java 8/11 runtime.
4. Untuk Java 8–25, strategi JUnit harus disesuaikan dengan runtime, build tool, CI, dan ecosystem.
5. Jangan campur annotation JUnit 4 dan Jupiter dalam satu class.
6. Lifecycle test harus dipahami agar tidak muncul shared-state bug.
7. Parameterized, nested, dynamic, repeated, tag, dan extension adalah alat desain test, bukan dekorasi.
8. Migration JUnit 4 ke Jupiter harus incremental dan behavior-aware.
9. Parallel execution bisa mempercepat CI, tetapi hanya aman jika test isolation kuat.
10. Test report dan discovery count adalah bagian dari evidence engineering.

JUnit yang digunakan dengan benar membuat test suite menjadi sistem bukti yang bisa dipercaya. JUnit yang digunakan asal-asalan hanya menghasilkan rasa aman palsu.

---

## 39. Referensi

- JUnit official site and JUnit 6 overview: https://junit.org/
- JUnit 6 User Guide and release notes: https://docs.junit.org/6.1.0/
- JUnit 4 official documentation and API: https://junit.org/junit4/
- Maven Surefire Plugin JUnit Platform documentation: https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html
- Maven Surefire JUnit provider selection documentation: https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit.html
- Gradle Java testing documentation: https://docs.gradle.org/current/userguide/java_testing.html

---

## 40. Status Seri

```text
Series: learn-java-testing-benchmarking-performance-jvm
Part selesai: 002 dari 031
Status: belum selesai
```

Part berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-003.md
Topik: Test Design: Arrange-Act-Assert, Given-When-Then, dan Behavioral Clarity
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-testing-benchmarking-performance-jvm-part-001.md">⬅️ Test Taxonomy dan Test Strategy untuk Sistem Enterprise Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-testing-benchmarking-performance-jvm-part-003.md">Test Design: Arrange-Act-Assert, Given-When-Then, dan Behavioral Clarity ➡️</a>
</div>
