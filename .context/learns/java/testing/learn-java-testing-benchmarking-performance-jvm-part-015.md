# learn-java-testing-benchmarking-performance-jvm-part-015

# Test Runtime Architecture: Build Tool, Parallel Test, Flakiness, dan CI Optimization

## Status Seri

- Seri: `learn-java-testing-benchmarking-performance-jvm`
- Part: `015`
- Topik: Test Runtime Architecture
- Rentang Java: Java 8 sampai Java 25
- Status seri setelah part ini: **belum selesai**
- Progress: **Part 015 dari 031**

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas banyak hal tentang desain test: taxonomy, JUnit, assertion, fixture, mock, domain invariant, error path, persistence, HTTP API, messaging, property-based testing, mutation testing, dan concurrency testing.

Part ini naik satu level: **bagaimana seluruh test suite dijalankan sebagai sistem runtime yang reliable, cepat, dan bisa dipercaya di developer machine maupun CI/CD pipeline.**

Masalah yang dibahas di sini bukan lagi sekadar:

```text
Apakah test ini benar?
```

Tetapi:

```text
Apakah test suite ini bisa dijalankan secara konsisten, cepat, terisolasi, repeatable,
dan memberi signal yang cukup kuat untuk mengambil keputusan engineering?
```

Setelah menyelesaikan part ini, kamu harus mampu:

1. Mendesain struktur test suite yang scalable.
2. Memisahkan unit, integration, contract, slow, flaky, dan benchmark test secara eksplisit.
3. Memahami perbedaan test framework parallelism, build tool parallelism, dan forked JVM parallelism.
4. Mengatur Maven Surefire/Failsafe dan Gradle Test task secara defensible.
5. Mengoptimalkan test runtime tanpa membuat test flaky.
6. Mendiagnosis flaky test berdasarkan root cause, bukan sekadar rerun.
7. Menentukan test mana yang jalan di PR, merge, nightly, release candidate, dan production verification.
8. Menjalankan test matrix lintas Java 8, 11, 17, 21, dan 25.
9. Menentukan kapan test harus cepat, kapan harus realistis, dan kapan harus dikarantina.
10. Membangun CI feedback loop yang dipercaya oleh engineer.

---

## 2. Mental Model: Test Suite sebagai Distributed Runtime Kecil

Banyak engineer memperlakukan test suite sebagai kumpulan file test. Itu terlalu sederhana.

Dalam sistem enterprise, test suite lebih tepat dipandang sebagai **runtime system kecil** dengan resource, dependency, isolation boundary, scheduling, failure mode, dan feedback loop.

Test suite punya:

| Elemen Runtime | Di Aplikasi Production | Di Test Suite |
|---|---|---|
| Process | JVM service | forked test JVM |
| Thread | request worker, scheduler, consumer | test runner thread, parallel test worker |
| Memory | heap, metaspace, native memory | test fixture, container client, mock state |
| External dependency | DB, broker, HTTP service | Testcontainers, WireMock, fake server |
| Scheduling | executor, queue, cron | build lifecycle, parallel fork, test order |
| Failure | timeout, deadlock, OOM, race | flaky test, stuck test, order-dependence |
| Observability | logs, metrics, traces | test report, failure dump, CI artifact |
| Capacity | CPU, memory, network, disk | runner cores, Docker daemon, DB container |

Jadi test suite juga bisa mengalami:

- resource starvation,
- CPU contention,
- memory leak,
- port collision,
- filesystem collision,
- static state leakage,
- test order dependence,
- data race,
- deadlock,
- external dependency instability,
- nondeterministic timing,
- false positive failure,
- false negative pass.

Top-tier engineer tidak hanya menulis test. Mereka juga mendesain **test runtime architecture**.

---

## 3. Core Principle: Test yang Tidak Dipercaya Lebih Berbahaya daripada Tidak Ada Test

Test suite yang buruk menciptakan dua jenis kerusakan.

Pertama, **false confidence**:

```text
Test pass, tetapi behavior production tetap rusak.
```

Kedua, **trust erosion**:

```text
Test gagal, tetapi engineer menganggap “ah paling flaky”.
```

Yang kedua sering lebih berbahaya. Begitu tim terbiasa mengabaikan failure, test suite kehilangan fungsi utama: menjadi signal pengambilan keputusan.

CI test suite yang sehat harus punya sifat berikut:

1. **High signal** — failure biasanya berarti ada masalah nyata.
2. **Fast enough** — feedback cukup cepat untuk memengaruhi perilaku developer.
3. **Deterministic** — input sama harus menghasilkan outcome sama.
4. **Isolated** — satu test tidak mencemari test lain.
5. **Observable** — saat gagal, root cause bisa dilacak.
6. **Layered** — tidak semua test harus jalan di setiap event.
7. **Version-aware** — sadar Java version, dependency version, dan runtime mode.
8. **Resource-aware** — tidak menganggap CI runner punya resource tak terbatas.

---

## 4. Test Runtime Layers

Ada beberapa layer yang sering tercampur:

```text
Developer command
  → build tool
    → test plugin/task
      → test platform
        → test engine
          → test class/method
            → application fixture
              → external test dependency
```

Contoh Maven + JUnit Jupiter:

```text
mvn test
  → Maven lifecycle
    → maven-surefire-plugin
      → forked JVM
        → JUnit Platform Launcher
          → JUnit Jupiter Engine
            → @Test method
```

Contoh Gradle + JUnit Jupiter:

```text
./gradlew test
  → Gradle task graph
    → Test task
      → test worker JVM(s)
        → JUnit Platform
          → Jupiter Engine
            → @Test method
```

Contoh integration test:

```text
mvn verify
  → pre-integration-test
    → start containers
  → integration-test
    → maven-failsafe-plugin
      → JUnit Platform
  → post-integration-test
    → stop containers
  → verify
    → fail build if IT failed
```

Kamu harus tahu di layer mana konfigurasi dilakukan. Banyak masalah muncul karena engineer mengira mengatur satu layer padahal masalahnya ada di layer lain.

Contoh:

```text
JUnit parallelism enabled,
tetapi Maven forkCount tetap 1 dan DB container hanya satu.
```

Atau:

```text
Gradle maxParallelForks tinggi,
tetapi test memakai static mutable singleton sehingga hasil flaky.
```

---

## 5. Test Suite Classification yang Operasional

Taxonomy di Part 001 harus diterjemahkan menjadi runtime grouping.

Minimal, test suite enterprise Java perlu dibagi menjadi:

```text
unit
integration
contract
component
slow
concurrency
mutation
benchmark
smoke
flaky/quarantine
```

Tetapi pembagian paling penting bukan nama, melainkan **runtime property**.

| Kategori | Runtime Property | Jalan di PR? | Jalan di Nightly? | Catatan |
|---|---:|---:|---:|---|
| Unit | cepat, isolated, no IO | Ya | Ya | parallelizable tinggi |
| Sociable unit | cepat, sedikit fixture | Ya | Ya | masih aman di PR |
| Persistence integration | butuh DB nyata | Selektif | Ya | Testcontainers/shared DB strategy |
| Messaging integration | butuh broker | Selektif | Ya | rawan timing/flaky jika salah |
| Contract | medium | Ya/selektif | Ya | penting untuk API/event compatibility |
| E2E | lambat, fragile | Tidak semua | Ya | jangan jadi gate utama PR |
| Concurrency | nondeterminism by design | Selektif | Ya | timeout harus ketat |
| Mutation | mahal | Tidak penuh | Ya/weekly | subset kritikal di PR |
| Benchmark | sensitif noise | Tidak umum | dedicated runner | jangan dicampur test biasa |
| Soak/load | sangat mahal | Tidak | scheduled | environment khusus |
| Flaky quarantine | tidak trusted | Tidak sebagai blocker | tracked | harus ada SLA perbaikan |

Prinsipnya:

```text
Semua test penting,
tetapi tidak semua test harus jalan di semua pipeline stage.
```

---

## 6. Naming Convention untuk Test Runtime

Naming convention membantu build tool memilih test.

Rekomendasi umum:

```text
src/test/java/.../*Test.java               -> unit/sociable unit
src/test/java/.../*Tests.java              -> unit/sociable unit, Spring style
src/integrationTest/java/.../*IT.java      -> integration test
src/contractTest/java/.../*ContractTest.java
src/e2eTest/java/.../*E2ETest.java
src/jmh/java/.../*Benchmark.java           -> JMH benchmark
src/jcstress/java/.../*JCStressTest.java   -> jcstress
```

Untuk Maven tradisional:

```text
*Test.java       -> Surefire
*Tests.java      -> Surefire
*TestCase.java   -> Surefire
*IT.java         -> Failsafe
*ITCase.java     -> Failsafe
```

Namun jangan hanya bergantung pada naming. Tambahkan tagging.

JUnit tags:

```java
@Tag("unit")
@Tag("integration")
@Tag("contract")
@Tag("slow")
@Tag("flaky")
@Tag("database")
@Tag("messaging")
```

Custom meta-annotation lebih bagus daripada mengulang string tag:

```java
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Tag("integration")
@Test
public @interface IntegrationTest {
}
```

Untuk annotation class-level:

```java
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Tag("database")
public @interface DatabaseTest {
}
```

Untuk test biasa, jangan semua diberi `@Tag("unit")` jika default-nya sudah unit. Tag paling berguna untuk **exclude** kelompok mahal/berisiko.

---

## 7. Maven Surefire vs Failsafe

Di Maven, dua plugin utama untuk test runtime adalah:

```text
maven-surefire-plugin  -> unit test phase: test
maven-failsafe-plugin  -> integration test phase: integration-test + verify
```

Perbedaan konseptual:

| Plugin | Phase | Tujuan |
|---|---|---|
| Surefire | `test` | test cepat yang harus fail fast |
| Failsafe | `integration-test`, `verify` | test yang butuh setup/teardown environment |

Kenapa Failsafe ada? Karena integration test sering membutuhkan lifecycle:

```text
pre-integration-test  -> start dependency
integration-test      -> run test
post-integration-test -> stop dependency
verify                -> evaluate result
```

Kalau integration test langsung dijalankan di Surefire, cleanup bisa gagal dilakukan saat test error/timeout tertentu.

### 7.1 Maven Surefire Baseline untuk JUnit Platform

Contoh konfigurasi modern:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-surefire-plugin</artifactId>
      <version>3.5.4</version>
      <configuration>
        <useModulePath>false</useModulePath>
        <includes>
          <include>**/*Test.java</include>
          <include>**/*Tests.java</include>
        </includes>
        <excludedGroups>integration,slow,flaky,benchmark</excludedGroups>
        <forkCount>1</forkCount>
        <reuseForks>true</reuseForks>
        <argLine>
          -Xms256m -Xmx1024m
          -XX:+HeapDumpOnOutOfMemoryError
          -Dfile.encoding=UTF-8
          -Duser.timezone=UTC
        </argLine>
      </configuration>
    </plugin>
  </plugins>
</build>
```

Catatan:

- `excludedGroups` bisa dipakai untuk JUnit tags melalui JUnit Platform provider.
- `forkCount=1` dan `reuseForks=true` adalah baseline konservatif.
- Tambahkan `-Duser.timezone=UTC` agar test waktu tidak tergantung timezone mesin.
- Tambahkan `-Dfile.encoding=UTF-8` agar test encoding konsisten.

### 7.2 Maven Failsafe Baseline

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-failsafe-plugin</artifactId>
  <version>3.5.4</version>
  <configuration>
    <includes>
      <include>**/*IT.java</include>
      <include>**/*ITCase.java</include>
    </includes>
    <groups>integration</groups>
    <excludedGroups>flaky,benchmark</excludedGroups>
    <forkCount>1</forkCount>
    <reuseForks>true</reuseForks>
    <argLine>
      -Xms512m -Xmx1536m
      -XX:+HeapDumpOnOutOfMemoryError
      -Dfile.encoding=UTF-8
      -Duser.timezone=UTC
    </argLine>
  </configuration>
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

Integration tests biasanya lebih boros memory karena:

- Spring/Jakarta context,
- Hibernate metadata,
- Testcontainers client,
- database connection pool,
- embedded server,
- JSON fixture besar.

Jangan samakan heap unit test dan integration test secara membabi buta.

### 7.3 Fork Count vs Thread Parallelism

Ini salah satu titik paling sering disalahpahami.

```text
forkCount      -> berapa JVM process test dibuat
parallelism    -> berapa test/class/method berjalan paralel di dalam JVM
Maven -T       -> berapa module Maven dibangun paralel
```

Jika semua diaktifkan sekaligus:

```text
mvn -T 4 test
Surefire forkCount=2
JUnit parallelism=4
```

Maka theoretical concurrency bisa menjadi:

```text
4 Maven modules × 2 forked JVM × 4 JUnit workers = 32 concurrent test executions
```

Kalau tiap test membuka DB connection, container, port, atau file, hasilnya bisa chaotic.

Prinsip:

```text
Parallelism is multiplicative unless explicitly bounded.
```

---

## 8. Gradle Test Runtime Architecture

Gradle punya model task yang lebih fleksibel. Test task menjalankan test dalam satu atau lebih forked JVM.

### 8.1 Baseline Gradle Kotlin DSL

```kotlin
plugins {
    java
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:6.0.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform {
        excludeTags("integration", "slow", "flaky", "benchmark")
    }

    maxParallelForks = 1

    minHeapSize = "256m"
    maxHeapSize = "1024m"

    systemProperty("file.encoding", "UTF-8")
    systemProperty("user.timezone", "UTC")

    jvmArgs(
        "-XX:+HeapDumpOnOutOfMemoryError"
    )

    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
```

### 8.2 Separate Integration Test Source Set

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

    useJUnitPlatform {
        includeTags("integration")
        excludeTags("flaky", "benchmark")
    }

    shouldRunAfter(tasks.test)

    maxParallelForks = 1
    minHeapSize = "512m"
    maxHeapSize = "1536m"

    systemProperty("file.encoding", "UTF-8")
    systemProperty("user.timezone", "UTC")
}

tasks.check {
    dependsOn("integrationTest")
}
```

### 8.3 Gradle Parallelism Layers

Gradle punya beberapa bentuk parallelism:

1. Task parallelism.
2. Worker API parallelism.
3. Test task `maxParallelForks`.
4. JUnit Platform parallelism di dalam fork.
5. Multi-project build parallelism.

Jangan mengaktifkan semuanya tanpa menghitung resource.

---

## 9. JUnit Platform Parallel Execution

JUnit Jupiter mendukung parallel execution. Tetapi default-nya biasanya konservatif. Parallel execution harus dianggap sebagai **optimization yang membutuhkan test isolation discipline**.

Contoh `junit-platform.properties`:

```properties
junit.jupiter.execution.parallel.enabled = true
junit.jupiter.execution.parallel.mode.default = concurrent
junit.jupiter.execution.parallel.mode.classes.default = concurrent
junit.jupiter.execution.parallel.config.strategy = fixed
junit.jupiter.execution.parallel.config.fixed.parallelism = 4
```

Mode penting:

```text
same_thread  -> jalan di thread yang sama
concurrent   -> boleh dijalankan paralel
```

Untuk class tertentu yang tidak aman:

```java
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;

@Execution(ExecutionMode.SAME_THREAD)
class UsesGlobalClockTest {
    // tests here are not parallel-safe
}
```

Untuk resource sharing:

```java
import org.junit.jupiter.api.parallel.ResourceLock;

@ResourceLock("database")
class AccountRepositoryIT {
}
```

Namun hati-hati: `ResourceLock` membantu serialisasi test yang berbagi resource, tetapi terlalu banyak lock akan menghilangkan manfaat parallelism.

### 9.1 Parallel-Safe Test Checklist

Test aman untuk parallel jika:

- tidak menggunakan static mutable state,
- tidak mengubah system properties global tanpa restore,
- tidak mengubah default timezone/locale global,
- tidak memakai fixed port,
- tidak menulis file ke path yang sama,
- tidak memakai shared database schema tanpa isolation,
- tidak bergantung pada test order,
- tidak memakai singleton mutable global,
- tidak memakai mock static/global yang overlap,
- tidak memakai embedded server dengan port fixed,
- tidak bergantung pada real clock timing sempit,
- tidak mengandalkan `Thread.sleep`.

Jika satu poin dilanggar, jangan langsung matikan parallelism global. Isolasi atau tag test tersebut.

---

## 10. Forked JVM: Kenapa Penting?

Test bisa berjalan di JVM yang sama dengan build tool atau forked JVM terpisah. Modern Maven/Gradle biasanya menjalankan test di forked process untuk isolation dan kontrol JVM args.

Forked JVM memberi manfaat:

- isolasi heap,
- isolasi system property sebagian,
- isolasi classloader,
- kemampuan mengatur `-Xmx`, GC, timezone, encoding,
- ability recover dari beberapa jenis crash,
- mengurangi kontaminasi build daemon.

Tetapi forked JVM juga punya cost:

- startup overhead,
- warmup overhead,
- memory lebih banyak,
- lebih banyak process,
- lebih banyak pressure ke CI runner.

### 10.1 Reuse Forks

`reuseForks=true`:

- lebih cepat,
- satu JVM dipakai untuk banyak test class,
- risiko leakage antar test lebih tinggi.

`reuseForks=false`:

- isolation lebih kuat,
- lebih lambat,
- berguna untuk test yang merusak global state atau native library.

Rule praktis:

```text
Default reuseForks=true.
Gunakan reuseForks=false hanya untuk suite kecil yang memang tidak bisa diisolasi dengan cara lain.
```

---

## 11. Test JVM Arguments

Test JVM juga perlu konfigurasi. Jangan hanya production JVM yang diurus.

Baseline test JVM args:

```text
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-XX:+HeapDumpOnOutOfMemoryError
```

Opsional untuk diagnosis:

```text
-XX:HeapDumpPath=build/heap-dumps
-Xlog:gc*:file=build/logs/test-gc.log:time,uptime,level,tags
```

Untuk Java 8 GC log:

```text
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:target/test-gc.log
```

Untuk illegal reflective access di Java 9+ legacy libs:

```text
--add-opens java.base/java.lang=ALL-UNNAMED
```

Namun `--add-opens` harus diperlakukan sebagai compatibility workaround, bukan kebiasaan permanen. Setiap `--add-opens` harus punya alasan.

### 11.1 Heap Sizing untuk Test

Jangan terlalu kecil:

```text
-Xmx256m untuk integration test Spring + Testcontainers sering terlalu kecil.
```

Jangan terlalu besar:

```text
-Xmx4g untuk semua fork bisa membuat CI runner swap/OOM.
```

Estimasi sederhana:

```text
memory_needed ≈ maxParallelForks × Xmx + Docker containers + build daemon + OS overhead
```

Contoh:

```text
Runner memory: 8 GB
Gradle daemon/build overhead: 1 GB
Docker DB + broker: 2 GB
Available for test fork: 5 GB
maxParallelForks=4
Max safe Xmx per fork ≈ 1 GB, mungkin kurang karena native/metaspace
```

Jangan lupa `Xmx` hanya heap. Ada non-heap:

- metaspace,
- code cache,
- thread stack,
- direct buffer,
- native library,
- JIT compiler memory.

---

## 12. Test Isolation Dimensions

Test isolation bukan satu hal. Ada banyak dimensi.

| Dimension | Contoh Leakage | Mitigasi |
|---|---|---|
| Object state | shared mutable fixture | new fixture per test |
| Static state | singleton cache | reset hook / avoid static |
| System property | timezone berubah | restore in `@AfterEach` |
| Environment | env var implicit | explicit config |
| File system | same temp path | `@TempDir` |
| Network | fixed port | random port |
| Database | row/schema shared | transaction/schema/container isolation |
| Broker | queue reused | unique topic/queue per test |
| Clock | real time | injected `Clock` |
| Randomness | random failures | seed logged |
| Thread | executor leak | shutdown/await termination |
| Classloader | static config | forked JVM/classloader isolation |

Top-tier test suite membuat isolation policy eksplisit.

---

## 13. Database Isolation Strategies

Database integration test sering menjadi sumber flakiness.

Ada beberapa strategi.

### 13.1 Transaction Rollback Per Test

```text
Start transaction before test
Run test
Rollback after test
```

Pros:

- cepat,
- data bersih,
- cocok untuk repository test.

Cons:

- tidak menguji commit behavior,
- tidak cocok untuk async consumer/scheduler yang butuh committed data,
- bisa menyembunyikan transaction boundary bug.

### 13.2 Truncate Tables Per Test/Class

Pros:

- behavior lebih realistis,
- data committed.

Cons:

- lambat,
- harus urus FK order,
- parallel test sulit.

### 13.3 Schema Per Test Class

Pros:

- parallel-friendly,
- isolation kuat.

Cons:

- setup lebih kompleks,
- migration per schema mahal.

### 13.4 Container Per Suite

Pros:

- realistis,
- startup cost amortized.

Cons:

- test harus menjaga data isolation.

### 13.5 Container Per Test Class

Pros:

- isolation sangat kuat.

Cons:

- mahal,
- CI lambat,
- Docker pressure tinggi.

Rekomendasi praktis:

```text
Repository correctness          -> rollback or truncate
Workflow integration           -> committed data + cleanup
Async/message integration      -> committed data + unique keys/topics
Migration test                 -> fresh schema/container
Parallel DB integration        -> schema-per-worker or unique namespace
```

---

## 14. Port, File, dan Resource Collision

Flaky test sering disebabkan resource collision.

Buruk:

```java
int port = 8080;
```

Lebih baik:

```java
ServerSocket socket = new ServerSocket(0);
int port = socket.getLocalPort();
socket.close();
```

Namun pattern di atas masih punya race antara close dan bind ulang. Lebih baik biarkan framework bind ke port random:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CaseApiIT {
}
```

Untuk file:

```java
import org.junit.jupiter.api.io.TempDir;

class ExportServiceTest {

    @TempDir
    Path tempDir;
}
```

Jangan pakai:

```text
/tmp/test-output.csv
C:\temp\test-output.csv
src/test/resources/output.json
```

Resource hasil test tidak boleh ditulis ke source tree kecuali memang golden-file update workflow yang eksplisit.

---

## 15. Flaky Test: Definisi dan Dampak

Flaky test adalah test yang bisa pass dan fail pada kode dan input yang sama.

Contoh:

```text
Run 1: pass
Run 2: fail
Run 3: pass
Commit sama, environment kira-kira sama
```

Dampak flaky test:

- developer kehilangan waktu investigasi,
- pipeline rerun meningkat,
- release tertunda,
- failure nyata diabaikan,
- CI cost naik,
- trust terhadap test suite turun,
- engineer mulai merge dengan “rerun sampai hijau”.

Rule keras:

```text
A flaky test is a production incident in your engineering process.
```

Bukan semua flaky test sama parah, tetapi semua flaky test harus dilacak.

---

## 16. Taxonomy Flakiness

| Category | Symptom | Root Cause Umum |
|---|---|---|
| Time-based | kadang timeout | real clock, sleep, CI slow |
| Async | assertion terlalu cepat | no await condition |
| Order-dependent | pass sendiri, fail suite | shared state |
| Resource collision | port/file conflict | fixed port/path |
| Network | transient failure | external dependency nyata |
| Database | duplicate/dirty data | shared DB |
| Concurrency | nondeterministic race | thread interleaving |
| Randomness | data kadang invalid | seed tidak dikontrol |
| Environment | beda OS/timezone/locale | implicit environment |
| Container | startup belum ready | readiness salah |
| Performance-sensitive | fail saat CPU busy | timeout terlalu ketat |
| Test pollution | test A merusak test B | static/global state |

Root cause harus ditulis, bukan hanya label “flaky”.

---

## 17. Anti-Pattern: `Thread.sleep` sebagai Synchronization

Buruk:

```java
service.submitJob(job);
Thread.sleep(1000);
assertThat(repository.find(job.id()).status()).isEqualTo(COMPLETED);
```

Masalah:

- terlalu pendek di CI lambat,
- terlalu panjang di machine cepat,
- memperlambat suite,
- tidak menjelaskan condition yang ditunggu.

Lebih baik dengan Awaitility:

```java
await()
    .atMost(Duration.ofSeconds(5))
    .pollInterval(Duration.ofMillis(100))
    .untilAsserted(() ->
        assertThat(repository.find(job.id()).status()).isEqualTo(COMPLETED)
    );
```

Prinsip:

```text
Wait for condition, not for time.
```

Namun jangan overuse Awaitility. Jika code bisa dibuat synchronous via `runOnce()` atau fake executor, itu lebih deterministik.

---

## 18. Flaky Test Detection Workflow

Saat test flaky, jangan hanya rerun manual. Gunakan workflow.

```text
1. Confirm reproducibility class
2. Run test alone
3. Run test with related package
4. Run test suite shuffled/reordered
5. Run repeated N times
6. Run with parallelism disabled
7. Run with fixed timezone/locale
8. Run with slow CPU simulation / lower timeout
9. Inspect logs/artifacts
10. Classify root cause
11. Fix or quarantine with owner + expiry
```

JUnit repeated test untuk diagnosis:

```java
@RepeatedTest(100)
void should_not_fail_under_repeated_execution() {
    // diagnostic only, not always permanent
}
```

Gradle repeated run bisa dilakukan dengan custom task atau CI loop.

Maven example:

```bash
for i in $(seq 1 100); do
  mvn -q -Dtest=CaseSubmissionServiceTest test || break
done
```

Untuk order dependence, jalankan suite dengan random order jika framework mendukung, atau buat script shuffle class.

---

## 19. Quarantine Policy

Quarantine bukan tempat sampah permanen. Quarantine adalah safety valve sementara.

Test boleh dikarantina jika:

- failure menghambat pipeline,
- root cause belum bisa diperbaiki cepat,
- ada issue/ticket owner,
- ada expiry date,
- failure tetap dimonitor,
- test tidak lagi menjadi release gate.

JUnit tag:

```java
@Tag("flaky")
class CaseNotificationIT {
}
```

CI PR:

```text
excludeTags("flaky")
```

Nightly quarantine job:

```text
includeTags("flaky")
continue-on-error but report
```

Policy:

```text
No flaky test may stay quarantined without owner and expiry.
```

Lebih tegas:

```text
Fix, delete, or downgrade its claim.
```

Jika test terlalu fragile karena mencoba membuktikan terlalu banyak hal, pecah menjadi test yang lebih kecil.

---

## 20. Test Ordering dan Shared State

Test harus order-independent.

JUnit memang punya `@TestMethodOrder`, tetapi gunakan sangat selektif.

Buruk:

```java
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AccountLifecycleTest {
    static UUID accountId;

    @Test @Order(1)
    void create() { ... }

    @Test @Order(2)
    void approve() { ... }
}
```

Masalah:

- test tidak bisa dijalankan sendiri,
- failure cascade,
- state tersembunyi,
- parallel execution sulit.

Lebih baik:

```java
@Test
void approve_submitted_account() {
    Account account = givenSubmittedAccount();

    service.approve(account.id(), reviewer);

    assertThat(repository.find(account.id()).status()).isEqualTo(APPROVED);
}
```

Jika ingin menguji lifecycle penuh, jadikan satu scenario test eksplisit:

```java
@Test
void full_account_lifecycle() {
    UUID id = createDraft();
    submit(id);
    approve(id);
    assertApproved(id);
}
```

Tapi jangan memecah scenario menjadi test method yang saling tergantung.

---

## 21. Test Impact Analysis dan Selective Test Execution

Untuk codebase besar, menjalankan semua test setiap perubahan bisa terlalu mahal.

Strategi:

1. PR menjalankan fast test.
2. PR menjalankan impacted integration/contract test jika mapping tersedia.
3. Merge-to-main menjalankan full test.
4. Nightly menjalankan slow/mutation/benchmark/load subset.
5. Release candidate menjalankan full confidence suite.

Test impact analysis membutuhkan mapping:

```text
changed files -> affected modules -> affected test suites -> risk level
```

Contoh kasar:

```text
Change in domain module       -> unit + domain property + mutation subset
Change in repository SQL      -> unit + DB integration + migration check
Change in API DTO             -> API contract + serialization + compatibility
Change in event schema        -> producer/consumer contract + migration
Change in auth logic          -> authorization matrix + security regression
Change in scheduler           -> scheduler + idempotency + concurrency
Change in JVM config          -> smoke + load/perf canary
```

Jangan gunakan selective test execution sebagai alasan untuk tidak pernah menjalankan full suite. Ia hanya mempercepat feedback awal.

---

## 22. CI Pipeline Architecture

Contoh pipeline enterprise Java:

```text
Stage 1: Static checks
  - format
  - compile
  - dependency check
  - basic static analysis

Stage 2: Fast unit tests
  - no Docker
  - high parallelism
  - fail fast

Stage 3: Integration tests
  - DB/broker containers
  - controlled parallelism
  - artifact logs

Stage 4: Contract tests
  - provider/consumer verification
  - schema compatibility

Stage 5: Package image
  - build artifact/container

Stage 6: Smoke tests
  - run app with production-like config

Stage 7: Nightly/deep confidence
  - slow tests
  - mutation subset/full
  - benchmark regression
  - load smoke
  - flakiness detection

Stage 8: Release candidate
  - full integration
  - migration test
  - performance gate
  - security regression
```

PR pipeline harus menjawab:

```text
Apakah perubahan ini jelas-jelas merusak sesuatu?
```

Release pipeline harus menjawab:

```text
Apakah kita punya bukti cukup untuk deploy?
```

Nightly pipeline harus menjawab:

```text
Apakah ada risiko yang terlalu mahal untuk dicek di PR?
```

---

## 23. CI Artifact Design

Saat test gagal di CI, engineer harus bisa mendiagnosis tanpa reproduce lokal dulu.

Artifact yang berguna:

- test report XML/HTML,
- stdout/stderr per test,
- application log,
- container log,
- DB migration log,
- WireMock request journal,
- broker topic/queue diagnostic,
- screenshot/video untuk UI test,
- thread dump on timeout,
- heap dump on OOM,
- GC log jika memory issue,
- JFR untuk performance/stuck diagnosis,
- random seed,
- test order,
- Java version,
- OS/kernel/container info,
- JVM args,
- dependency versions.

Minimal failure header:

```text
Test: CaseSubmissionWorkerIT.should_process_submitted_case_once
Java: 21.0.x
OS: linux x86_64
Timezone: UTC
Seed: 823481
Fork: 2
Parallelism: 4
Container: postgres:16
Started at: 2026-06-16T03:21:00Z
```

Failure tanpa context memperlambat debugging.

---

## 24. Test Timeout Strategy

Timeout diperlukan agar suite tidak hang. Tetapi timeout yang salah membuat flaky.

JUnit timeout:

```java
import org.junit.jupiter.api.Timeout;

@Timeout(5)
@Test
void should_finish_quickly() {
}
```

Untuk async assertion:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(...);
```

Jangan pasang timeout terlalu sempit pada CI.

Buruk:

```java
@Timeout(100, TimeUnit.MILLISECONDS)
```

Kecuali itu micro-level deterministic test tanpa IO, ini rawan false failure.

Timeout layering:

```text
Per assertion timeout       -> Awaitility atMost
Per test timeout            -> JUnit @Timeout
Per test process timeout    -> Surefire/Gradle fork timeout
Per job timeout             -> CI job timeout
```

Pastikan inner timeout lebih kecil dari outer timeout agar diagnostic keluar dari level yang paling informatif.

Contoh:

```text
Awaitility: 10 seconds
JUnit test timeout: 30 seconds
Surefire fork timeout: 2 minutes
CI job timeout: 20 minutes
```

---

## 25. Running Tests Across Java 8–25

Karena seri ini mencakup Java 8 sampai 25, test runtime harus sadar compatibility.

### 25.1 Key Compatibility Points

| Area | Java 8 | Java 11 | Java 17 | Java 21 | Java 25 |
|---|---|---|---|---|---|
| JUnit 4 | umum | jalan | legacy | legacy | legacy |
| JUnit 5 | support Java 8 untuk banyak versi | baik | baik | baik | tergantung versi JUnit |
| JUnit 6 | tidak | tidak | ya | ya | ya |
| JPMS | tidak | ya | ya | ya | ya |
| Strong encapsulation | tidak | sebagian | lebih ketat | ketat | ketat |
| Virtual threads | tidak | tidak | tidak | ya | ya |
| GC logging unified | tidak | ya | ya | ya | ya |
| Removed flags impact | rendah | medium | tinggi | tinggi | tinggi |

### 25.2 CI Matrix Example

Untuk library yang harus support Java 8 sampai 25:

```yaml
strategy:
  matrix:
    java: [8, 11, 17, 21, 25]
```

Tapi tidak semua test harus jalan di semua versi.

Contoh policy:

```text
Java 8   -> compile + unit + critical integration
Java 11  -> compile + unit
Java 17  -> full unit + integration + contract
Java 21  -> virtual-thread tests + full integration
Java 25  -> compatibility smoke + selected integration
```

Untuk application bukan library, matrix bisa lebih sempit:

```text
Current production Java -> full suite
Next target Java        -> compatibility suite
Old Java                -> only if still supported
```

### 25.3 Toolchain Management

Gradle Java toolchain:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

Maven toolchains bisa dipakai untuk multi-JDK build.

Jangan mengandalkan `JAVA_HOME` manual di developer machine untuk semua hal. Itu membuat hasil test berbeda antar engineer.

---

## 26. Test Caching dan Build Cache

Build cache bisa mempercepat, tetapi test caching harus hati-hati.

Test task boleh cacheable hanya jika:

- input lengkap dideklarasikan,
- environment tidak implicit,
- output deterministik,
- tidak bergantung pada waktu nyata,
- tidak bergantung pada external service,
- tidak membaca state tersembunyi,
- tidak menulis ke lokasi global.

Untuk unit test murni, caching lebih aman.

Untuk integration test dengan Docker/database, caching sering berbahaya.

Rule:

```text
Never trade correctness signal for fake speed.
```

Jika test tidak deterministik, cache hanya menyembunyikan masalah.

---

## 27. Test Report dan Metrics

Test suite harus diukur.

Metrics penting:

| Metric | Makna |
|---|---|
| Total duration | feedback loop |
| Duration per suite | bottleneck pipeline |
| Slowest tests | optimization target |
| Failure rate | suite health |
| Flake rate | trust erosion |
| Retry count | hidden cost |
| Quarantine count | technical debt |
| Test count by layer | strategy balance |
| Coverage | execution evidence, bukan quality final |
| Mutation score | test strength evidence |
| Average PR wait time | developer productivity |
| CI queue time | infra bottleneck |

Slowest test report harus rutin dibaca.

Contoh tindakan:

```text
Top 10 slow tests consume 40% runtime
→ inspect whether they are E2E disguised as unit test
→ reduce context startup
→ share container safely
→ split suite
→ move to nightly if not PR-critical
```

---

## 28. Spring/Jakarta Context Startup Optimization

Banyak Java enterprise test lambat karena context startup.

Anti-pattern:

```java
@SpringBootTest
class SimpleMapperTest {
}
```

Jika hanya test mapper, jangan start full app.

Layering:

```text
Plain unit test                 -> no Spring/Jakarta context
Slice test                      -> only web/repository/etc
Full context integration test   -> only when needed
End-to-end test                 -> app + dependencies
```

Context caching penting. Tetapi context cache rusak jika setiap test punya config berbeda.

Hindari terlalu banyak variasi:

```java
@SpringBootTest(properties = "feature.x=true")
```

Jika setiap class punya property unik, framework harus membuat context baru terus.

Prinsip:

```text
Minimize number of unique application contexts.
```

Untuk Jakarta/JAX-RS:

- test resource class secara isolated jika memungkinkan,
- gunakan in-memory server untuk resource integration,
- gunakan full container hanya untuk behavior yang memang container-specific.

---

## 29. Testcontainers Runtime Optimization

Testcontainers bagus untuk realism, tetapi bisa membuat CI lambat jika salah.

Prinsip:

1. Reuse container per suite jika isolation bisa dijaga.
2. Jangan start container per test method kecuali benar-benar perlu.
3. Gunakan readiness/wait strategy yang benar.
4. Gunakan image version eksplisit.
5. Ambil container logs saat gagal.
6. Jangan parallel start terlalu banyak heavy containers.
7. Gunakan unique database/schema/topic/queue untuk isolation.
8. Hindari fixed exposed port.

Buruk:

```java
@BeforeEach
void startPostgres() {
    postgres.start();
}
```

Lebih baik:

```java
@Testcontainers
class CaseRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");
}
```

Namun static container harus dibarengi data cleanup yang benar.

Untuk CI, Docker daemon sendiri bisa menjadi bottleneck:

- image pull lambat,
- disk penuh,
- container network lambat,
- memory pressure,
- Ryuk/container cleanup issue,
- rate limit registry.

CI optimization sering butuh caching image atau pre-pulled image di runner.

---

## 30. Parallelism Decision Framework

Jangan mulai dari “berapa besar parallelism?”. Mulai dari “apa yang aman diparalelkan?”.

### 30.1 Unit Test

Biasanya aman:

```text
High JUnit method/class parallelism
or high Gradle maxParallelForks
```

Jika benar-benar isolated.

### 30.2 Persistence Integration Test

Lebih hati-hati:

```text
Parallel by class if schema isolated
Sequential if shared schema
```

### 30.3 Messaging Integration Test

Parallel hanya jika:

- topic/queue unique,
- consumer group unique,
- idempotency key unique,
- broker capacity cukup.

### 30.4 E2E Test

Biasanya rendah parallelism karena:

- environment shared,
- browser/resource heavy,
- data dependency,
- network timing.

### 30.5 Mutation/Benchmark

Jangan dicampur dengan parallel CI umum.

Benchmark khususnya harus isolated dari noisy workloads.

---

## 31. Practical Pipeline Profiles

### 31.1 Local Developer Fast Loop

Tujuan: feedback cepat saat coding.

```bash
./gradlew test --tests '*CaseSubmissionServiceTest'
```

Atau Maven:

```bash
mvn -Dtest=CaseSubmissionServiceTest test
```

Profile:

```text
unit only
no Docker
parallel allowed
fail fast
```

### 31.2 Local Confidence Before Push

```bash
./gradlew test integrationTest
```

Atau:

```bash
mvn verify
```

Profile:

```text
unit + selected integration
Docker allowed
moderate parallelism
```

### 31.3 PR Pipeline

```text
compile
unit
critical integration
contract
static analysis
```

Hard gate.

### 31.4 Merge/Main Pipeline

```text
full unit
full integration
contract
packaging
migration smoke
```

Hard gate.

### 31.5 Nightly Pipeline

```text
slow integration
mutation testing
flakiness repeated runs
benchmark regression
load smoke
```

Not always hard gate, but must alert.

### 31.6 Release Candidate Pipeline

```text
full confidence suite
migration up/down where relevant
performance acceptance
security regression
smoke in prod-like env
```

Hard gate unless risk accepted explicitly.

---

## 32. Example Maven Multi-Profile Setup

```xml
<profiles>
  <profile>
    <id>unit</id>
    <properties>
      <excludedGroups>integration,slow,flaky,benchmark</excludedGroups>
    </properties>
  </profile>

  <profile>
    <id>integration</id>
    <properties>
      <groups>integration</groups>
      <excludedGroups>flaky,benchmark</excludedGroups>
    </properties>
  </profile>

  <profile>
    <id>ci</id>
    <properties>
      <excludedGroups>flaky,benchmark</excludedGroups>
    </properties>
  </profile>

  <profile>
    <id>flaky</id>
    <properties>
      <groups>flaky</groups>
    </properties>
  </profile>
</profiles>
```

Surefire:

```xml
<configuration>
  <groups>${groups}</groups>
  <excludedGroups>${excludedGroups}</excludedGroups>
</configuration>
```

Hati-hati: property kosong kadang perlu default agar plugin tidak error tergantung versi/config.

---

## 33. Example Gradle Multi-Task Setup

```kotlin
abstract class TaggedTest : Test()

tasks.register<Test>("unitTest") {
    useJUnitPlatform {
        excludeTags("integration", "slow", "flaky", "benchmark")
    }
    maxParallelForks = Runtime.getRuntime().availableProcessors().coerceAtMost(4)
}

tasks.register<Test>("slowTest") {
    useJUnitPlatform {
        includeTags("slow")
        excludeTags("flaky", "benchmark")
    }
    maxParallelForks = 1
    shouldRunAfter("unitTest")
}

tasks.register<Test>("flakyTest") {
    useJUnitPlatform {
        includeTags("flaky")
    }
    maxParallelForks = 1
    ignoreFailures = true
}
```

`ignoreFailures = true` hanya boleh untuk quarantine/nightly diagnostic job, bukan PR gate.

---

## 34. Fail Fast vs Full Failure Collection

Fail fast berguna untuk local dan PR feedback cepat.

Tetapi full failure collection berguna untuk nightly atau large refactor.

Policy:

```text
Local targeted run     -> fail fast
PR unit stage          -> fail fast acceptable
PR integration stage   -> maybe fail fast
Nightly full suite     -> collect as many failures as possible
Release candidate      -> collect full report unless infra burning
```

Gradle:

```kotlin
tasks.test {
    failFast = true
}
```

Maven Surefire punya parameter fail-fast/fail-at-end behavior melalui Maven sendiri dan plugin behavior, tetapi dalam multi-module build kamu juga perlu paham:

```bash
mvn --fail-fast test
mvn --fail-at-end test
mvn --fail-never test
```

Jangan gunakan `--fail-never` untuk gate.

---

## 35. Test Suite Smells

### 35.1 Test Suite Terlalu Lambat

Kemungkinan penyebab:

- terlalu banyak full context test,
- Testcontainers start per method,
- `Thread.sleep`,
- E2E masuk PR gate,
- no parallelism untuk unit test,
- huge fixture,
- slow external dependency,
- mutation/full benchmark masuk PR.

### 35.2 Test Suite Flaky

Kemungkinan penyebab:

- shared state,
- timing assertion,
- fixed port,
- dirty database,
- race,
- low timeout,
- parallelism unsafe,
- external dependency nyata.

### 35.3 Test Suite Pass tetapi Bug Production Banyak

Kemungkinan penyebab:

- terlalu banyak mock,
- tidak ada contract test,
- tidak ada persistence real DB test,
- tidak ada error-path test,
- tidak ada authorization matrix,
- coverage tinggi tapi assertion lemah,
- no mutation testing.

### 35.4 Test Suite Mahal tetapi Signal Rendah

Kemungkinan penyebab:

- E2E dominan,
- test overlap,
- assertion lemah,
- fixture terlalu umum,
- hidden dependency,
- no ownership,
- quarantined test menumpuk.

---

## 36. Top 1% Engineer Checklist

Sebelum menyebut test suite “production-grade”, jawab ini:

```text
[ ] Apakah test suite punya layer yang jelas?
[ ] Apakah unit test bisa jalan cepat tanpa Docker/external dependency?
[ ] Apakah integration test memakai dependency realistis?
[ ] Apakah slow/flaky/benchmark test dipisah dari PR gate?
[ ] Apakah parallelism dihitung, bukan ditebak?
[ ] Apakah setiap shared resource punya isolation strategy?
[ ] Apakah timezone, locale, encoding, random seed dikontrol?
[ ] Apakah test report cukup untuk diagnosis CI?
[ ] Apakah timeout layering masuk akal?
[ ] Apakah flaky test punya owner dan expiry?
[ ] Apakah test matrix Java 8–25 sesuai support policy?
[ ] Apakah context startup/framework startup dioptimalkan?
[ ] Apakah Testcontainers digunakan secara realistis tapi tidak boros?
[ ] Apakah benchmark/mutation/load test punya pipeline tersendiri?
[ ] Apakah pipeline PR, main, nightly, release punya tujuan berbeda?
```

---

## 37. Practical Design Template: Test Runtime Architecture Document

Untuk project besar, buat dokumen pendek seperti ini.

```md
# Test Runtime Architecture

## Supported Java Versions
- Production Java: 21
- Compatibility Java: 17, 25
- Legacy Java: none / 8 / 11

## Test Layers
| Layer | Naming | Tag | Tool | Runs On |
|---|---|---|---|---|
| Unit | *Test | default | Surefire/Gradle test | PR |
| Integration | *IT | integration | Failsafe/integrationTest | PR selective + main |
| Contract | *ContractTest | contract | Pact/OpenAPI | PR/main |
| Slow | *SlowTest | slow | nightly | nightly |
| Mutation | n/a | n/a | PIT | nightly/weekly |
| Benchmark | *Benchmark | n/a | JMH | dedicated |

## Isolation Policy
- Database: schema per integration suite / cleanup per test
- Broker: unique topic/queue per test class
- Files: JUnit @TempDir only
- Ports: random ports only
- Time: injected Clock, UTC
- Random: explicit seed when randomized

## Parallelism Policy
- Unit: parallel class/method enabled, max N
- Integration: max 1-2 forks
- E2E: sequential
- Benchmark: isolated runner

## Flaky Policy
- Tag: flaky
- PR: excluded
- Nightly: included, non-blocking but reported
- Owner: mandatory
- Expiry: max 14 days

## CI Artifacts
- test reports
- app logs
- container logs
- heap dump on OOM
- thread dump on timeout
- random seed
- JVM args
```

Dokumen seperti ini mencegah knowledge hanya ada di kepala satu engineer.

---

## 38. Latihan Mandiri

### Latihan 1 — Audit Test Suite

Ambil satu project Java. Kategorikan semua test:

```text
unit
integration
contract
slow
flaky
unknown
```

Jika banyak `unknown`, berarti test suite belum punya runtime architecture.

### Latihan 2 — Hitung Parallelism Efektif

Cari konfigurasi:

- Maven `-T`,
- Surefire/Failsafe `forkCount`,
- Gradle `maxParallelForks`,
- JUnit parallelism,
- CI job matrix.

Hitung worst-case concurrent test execution.

### Latihan 3 — Flaky Root Cause

Pilih satu flaky test. Jangan langsung rerun. Tulis:

```text
Symptom:
Run alone:
Run in suite:
Run repeated:
Parallel disabled:
Suspected root cause:
Fix:
Prevention:
```

### Latihan 4 — PR vs Nightly Split

Desain pipeline:

```text
PR gate: max 10 minutes
Main gate: max 30 minutes
Nightly: max 2 hours
Release: max 4 hours
```

Tentukan test mana masuk stage mana.

---

## 39. Ringkasan

Test runtime architecture adalah discipline untuk memastikan test suite tidak hanya benar secara individual, tetapi juga reliable sebagai sistem.

Poin terpenting:

1. Test suite adalah runtime system dengan resource, isolation, scheduling, dan failure mode.
2. Build tool parallelism, forked JVM, dan JUnit parallelism bisa saling mengalikan concurrency.
3. Maven Surefire cocok untuk unit test; Failsafe cocok untuk integration test lifecycle.
4. Gradle Test task memberi fleksibilitas tinggi, tetapi perlu isolation discipline.
5. Parallel test hanya aman jika resource dan global state terkontrol.
6. Flaky test adalah masalah engineering process, bukan gangguan kecil.
7. Quarantine harus sementara, punya owner, dan punya expiry.
8. CI pipeline harus berlapis: PR, main, nightly, release candidate.
9. Artifact failure harus cukup untuk diagnosis tanpa menebak.
10. Java 8–25 compatibility harus diperlakukan sebagai matrix runtime, bukan asumsi.

Mental model akhir:

```text
A good test suite is not the one that runs the most tests.
A good test suite is the one that gives the right evidence,
at the right time,
with the right cost,
and with failure signals that engineers trust.
```

---

## 40. Referensi

- JUnit User Guide: https://docs.junit.org/6.0.3/overview.html
- JUnit official site: https://junit.org/
- Maven Surefire Plugin — Fork Options and Parallel Test Execution: https://maven.apache.org/surefire/maven-surefire-plugin/examples/fork-options-and-parallel-execution.html
- Maven Failsafe Plugin — Fork Options and Parallel Test Execution: https://maven.apache.org/surefire/maven-failsafe-plugin/examples/fork-options-and-parallel-execution.html
- Gradle User Manual — Testing in Java & JVM projects: https://docs.gradle.org/current/userguide/java_testing.html
- Gradle Test task DSL: https://docs.gradle.org/current/dsl/org.gradle.api.tasks.testing.Test.html
- Gradle Performance Guide — Parallel tests: https://docs.gradle.org/current/userguide/performance.html
- Google Testing Blog — Flaky Tests at Google and How We Mitigate Them: https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- Test Flakiness' Causes, Detection, Impact and Responses: A Multivocal Review: https://arxiv.org/abs/2212.00908
- The Importance of Discerning Flaky from Fault-triggering Test Failures: A Case Study on the Chromium CI: https://arxiv.org/abs/2302.10594
- Testcontainers documentation: https://testcontainers.com/
- Awaitility documentation: https://www.awaitility.org/

