# learn-java-testing-benchmarking-performance-jvm-part-017

# JMH Deep Dive I: Harness, State, Scope, Mode, Warmup, Measurement

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `017`  
> Topik: Java Microbenchmark Harness dasar sampai operasional yang benar  
> Target Java: 8 sampai 25  
> Status seri: belum selesai

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membangun fondasi benchmarking: latency, throughput, percentile, warmup, JVM noise, JIT, dead code elimination, coordinated omission, dan kenapa angka benchmark mudah menipu.

Part ini masuk ke alat utama untuk microbenchmark Java/JVM: **JMH — Java Microbenchmark Harness**.

Tujuan part ini bukan sekadar tahu annotation seperti `@Benchmark` atau `@Warmup`. Tujuan sebenarnya adalah memahami:

1. bagaimana JMH menjalankan benchmark,
2. kenapa benchmark harus dijalankan dalam fork JVM tersendiri,
3. bagaimana `@State` dan `Scope` menentukan sharing data,
4. bagaimana memilih mode measurement,
5. bagaimana warmup, measurement, iteration, fork, dan thread saling berinteraksi,
6. bagaimana membaca output JMH secara kritis,
7. bagaimana membedakan benchmark yang cukup sahih dari benchmark yang hanya terlihat profesional.

JMH adalah harness untuk membangun, menjalankan, dan menganalisis benchmark nano/micro/milli/macro pada Java dan bahasa lain yang menargetkan JVM. Tetapi JMH bukan jaminan bahwa benchmark pasti valid. JMH mengurangi banyak jebakan teknis, namun desain benchmark tetap tanggung jawab engineer.

---

## 1. Mental Model: JMH Bukan Stopwatch, Tapi Runtime Experiment Harness

Cara paling salah memahami benchmark adalah:

```java
long start = System.nanoTime();
methodUnderTest();
long elapsed = System.nanoTime() - start;
```

Masalahnya bukan karena `System.nanoTime()` buruk. Masalahnya adalah **JVM bukan mesin statis**.

Saat kode berjalan, JVM dapat melakukan:

- interpretasi bytecode,
- profiling runtime,
- C1 compilation,
- C2 compilation,
- tiered compilation,
- inlining,
- escape analysis,
- scalar replacement,
- constant folding,
- dead code elimination,
- deoptimization,
- GC,
- safepoint,
- biased/fast locking behavior pada versi tertentu,
- OS scheduling,
- CPU frequency adjustment,
- container throttling.

JMH menyediakan struktur eksperimen agar pengukuran tidak hanya mengukur satu eksekusi acak, tetapi menjalankan benchmark melalui fase yang lebih masuk akal:

```text
Benchmark discovery
  -> benchmark code generation via annotation processor
  -> fork JVM process
  -> warmup iterations
  -> measurement iterations
  -> result aggregation
  -> optional profiler output
```

Jadi mental modelnya:

```text
JMH = harness untuk mengontrol eksperimen JVM
bukan = stopwatch otomatis yang membuat semua hasil benar
```

---

## 2. Kapan JMH Dipakai dan Kapan Tidak

JMH cocok ketika pertanyaan yang diajukan berbentuk:

```text
Untuk operasi kecil/terisolasi ini, dalam kondisi input dan environment tertentu,
berapa cost relatif dari beberapa implementasi?
```

Contoh pertanyaan yang cocok:

- Apakah parsing manual lebih murah daripada regex untuk format tertentu?
- Apakah `HashMap` pre-sizing mengurangi allocation dan runtime pada ukuran data tertentu?
- Apakah custom serializer lebih cepat daripada Jackson untuk DTO tertentu?
- Apakah `StringBuilder` masih menang dibanding `+` pada pola loop tertentu?
- Berapa allocation rate dari mapper ini?
- Apakah penggunaan `Optional` di hot path tertentu measurable atau tidak?
- Apakah `ConcurrentHashMap.computeIfAbsent` lebih baik daripada double-check pattern tertentu?
- Bagaimana cost `BigDecimal` pada perhitungan tertentu?

JMH kurang cocok atau perlu sangat hati-hati untuk:

- query database,
- HTTP endpoint end-to-end,
- request latency service,
- Kafka/RabbitMQ throughput nyata,
- connection pool behavior,
- workload dengan network,
- workload yang bottleneck-nya external system,
- aplikasi penuh dengan cache, DB, thread pool, retry, GC, dan backpressure.

Untuk kasus tersebut, gunakan:

- macrobenchmark,
- load test,
- profiler,
- JFR,
- async-profiler,
- observability production,
- controlled performance test environment.

JMH bisa tetap berguna untuk mengukur komponen kecil di dalam sistem tersebut, tetapi tidak boleh dijadikan representasi total performance sistem.

---

## 3. Struktur Minimum Project JMH

### 3.1 Rekomendasi: project benchmark terpisah

Rekomendasi umum JMH adalah menjalankan benchmark sebagai project mandiri atau source set khusus, bukan sebagai unit test biasa. Alasannya:

1. benchmark perlu annotation processing,
2. benchmark perlu fork JVM,
3. benchmark perlu classpath yang bersih,
4. benchmark perlu packaging yang repeatable,
5. benchmark tidak boleh tercampur dengan lifecycle unit test,
6. benchmark biasanya lambat dan tidak cocok dijalankan setiap PR seperti unit test.

Struktur yang umum:

```text
my-app/
  app-core/
  app-service/
  benchmarks/
    pom.xml
    src/main/java/
      com/example/benchmarks/
        CaseStatusBenchmark.java
```

Atau dengan Gradle:

```text
my-app/
  src/main/java/
  src/test/java/
  src/jmh/java/
```

Untuk organisasi besar, lebih baik benchmark dipisah jelas:

```text
performance/
  microbenchmarks/
  macrobenchmarks/
  load-tests/
  reports/
```

---

## 4. Maven Setup Dasar

Contoh `pom.xml` benchmark standalone:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>java-performance-benchmarks</artifactId>
    <version>1.0.0-SNAPSHOT</version>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <jmh.version>1.37</jmh.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.openjdk.jmh</groupId>
            <artifactId>jmh-core</artifactId>
            <version>${jmh.version}</version>
        </dependency>
        <dependency>
            <groupId>org.openjdk.jmh</groupId>
            <artifactId>jmh-generator-annprocess</artifactId>
            <version>${jmh.version}</version>
            <scope>provided</scope>
        </dependency>

        <!-- Dependency aplikasi yang ingin dibenchmark -->
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>app-core</artifactId>
            <version>1.0.0-SNAPSHOT</version>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.13.0</version>
                <configuration>
                    <annotationProcessorPaths>
                        <path>
                            <groupId>org.openjdk.jmh</groupId>
                            <artifactId>jmh-generator-annprocess</artifactId>
                            <version>${jmh.version}</version>
                        </path>
                    </annotationProcessorPaths>
                </configuration>
            </plugin>

            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-shade-plugin</artifactId>
                <version>3.6.0</version>
                <executions>
                    <execution>
                        <phase>package</phase>
                        <goals>
                            <goal>shade</goal>
                        </goals>
                        <configuration>
                            <finalName>benchmarks</finalName>
                            <transformers>
                                <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                                    <mainClass>org.openjdk.jmh.Main</mainClass>
                                </transformer>
                            </transformers>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>
```

Build:

```bash
mvn clean package
```

Run:

```bash
java -jar target/benchmarks.jar
```

Run benchmark tertentu:

```bash
java -jar target/benchmarks.jar CaseStatusBenchmark
```

Run dengan output JSON:

```bash
java -jar target/benchmarks.jar CaseStatusBenchmark \
  -rf json \
  -rff target/jmh-result.json
```

---

## 5. Gradle Setup Dasar

Dengan Gradle, biasanya memakai plugin JMH community seperti `me.champeau.jmh`.

Contoh konseptual `build.gradle`:

```groovy
plugins {
    id 'java'
    id 'me.champeau.jmh' version '0.7.2'
}

repositories {
    mavenCentral()
}

dependencies {
    implementation project(':app-core')

    jmh 'org.openjdk.jmh:jmh-core:1.37'
    jmhAnnotationProcessor 'org.openjdk.jmh:jmh-generator-annprocess:1.37'
}

jmh {
    warmupIterations = 5
    iterations = 10
    fork = 3
    benchmarkMode = ['avgt']
    timeUnit = 'ns'
    resultFormat = 'JSON'
    resultsFile = project.file("build/reports/jmh/results.json")
}
```

Struktur source:

```text
src/jmh/java/com/example/benchmarks/CaseStatusBenchmark.java
```

Run:

```bash
./gradlew jmh
```

Catatan penting: konfigurasi plugin bisa berubah antar versi. Prinsip yang harus tetap dijaga adalah benchmark dipisah dari test biasa, annotation processor berjalan, dan hasil disimpan sebagai artifact.

---

## 6. Benchmark Class Minimum

Contoh benchmark paling sederhana:

```java
package com.example.benchmarks;

import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.annotations.BenchmarkMode;
import org.openjdk.jmh.annotations.Fork;
import org.openjdk.jmh.annotations.Measurement;
import org.openjdk.jmh.annotations.Mode;
import org.openjdk.jmh.annotations.OutputTimeUnit;
import org.openjdk.jmh.annotations.Warmup;

import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(3)
public class SimpleStringBenchmark {

    @Benchmark
    public String concatWithPlus() {
        return "case" + ":" + "submitted";
    }

    @Benchmark
    public String concatWithBuilder() {
        return new StringBuilder()
                .append("case")
                .append(':')
                .append("submitted")
                .toString();
    }
}
```

Secara teknis ini benchmark valid dari sisi JMH, tetapi belum tentu berguna. JVM dapat melakukan constant folding karena semua input literal. Benchmark ini lebih mengukur kemampuan compiler mengoptimasi konstanta daripada workload nyata.

Versi lebih baik perlu state dan input bervariasi.

---

## 7. `@Benchmark`: Unit Eksperimen, Bukan Unit Test

Method dengan `@Benchmark` adalah operasi yang diukur JMH.

```java
@Benchmark
public int parseCaseId(BenchmarkState state) {
    return Integer.parseInt(state.caseIdText);
}
```

Aturan penting:

1. Method benchmark harus public.
2. Jangan memasukkan setup mahal ke dalam benchmark method jika setup itu bukan bagian yang ingin diukur.
3. Jangan melakukan loop manual tanpa alasan kuat.
4. Jangan mencampur beberapa operasi berbeda dalam satu benchmark jika ingin tahu cost masing-masing.
5. Jangan melakukan assertion berat di benchmark method.
6. Jangan mengandalkan side effect tersembunyi yang bisa dieliminasi compiler.

Benchmark method idealnya menjawab satu pertanyaan:

```text
Berapa cost operasi X dengan input Y pada kondisi Z?
```

Bukan:

```text
Berapa cepat seluruh proses bisnis ini kalau saya jalankan sedikit-sedikit di laptop?
```

---

## 8. Return Value vs Blackhole

JMH bisa mengonsumsi return value benchmark agar tidak dihapus compiler.

```java
@Benchmark
public int parse() {
    return Integer.parseInt("12345");
}
```

Jika method mengembalikan value, JMH akan memperlakukan return value sebagai sesuatu yang digunakan.

Untuk beberapa output atau side-effect yang perlu dikonsumsi eksplisit, gunakan `Blackhole`:

```java
import org.openjdk.jmh.infra.Blackhole;

@Benchmark
public void parseMany(BenchmarkState state, Blackhole blackhole) {
    blackhole.consume(Integer.parseInt(state.caseIdText));
    blackhole.consume(state.caseIdText.length());
}
```

Gunakan return value jika satu hasil cukup jelas. Gunakan `Blackhole` jika:

- ada banyak hasil,
- benchmark method harus `void`,
- operasi menghasilkan object yang perlu dipertahankan dari dead code elimination,
- ingin menghindari optimizer menganggap hasil tidak digunakan.

Namun hati-hati: `Blackhole` bukan obat untuk benchmark buruk. Kalau input tidak realistis, branching tidak realistis, atau setup salah, `Blackhole` tidak menyelamatkan validitas benchmark.

---

## 9. `@State`: Tempat Data Benchmark Hidup

JMH menggunakan `@State` untuk menyimpan data yang dipakai benchmark.

Contoh:

```java
import org.openjdk.jmh.annotations.Scope;
import org.openjdk.jmh.annotations.State;

@State(Scope.Thread)
public class BenchmarkState {
    public String caseIdText = "12345";
}
```

Lalu dipakai:

```java
@Benchmark
public int parse(BenchmarkState state) {
    return Integer.parseInt(state.caseIdText);
}
```

`@State` penting karena:

1. memisahkan setup dari measurement,
2. membuat input benchmark eksplisit,
3. mengontrol sharing antar thread,
4. membantu JMH membuat lifecycle benchmark yang benar,
5. menghindari static global state yang sulit dikontrol.

---

## 10. Scope: Thread, Benchmark, Group

### 10.1 `Scope.Thread`

Setiap worker thread mendapat instance state sendiri.

```java
@State(Scope.Thread)
public static class ThreadState {
    List<String> values;
}
```

Cocok untuk benchmark yang tidak ingin mengukur contention.

Contoh:

```java
@Benchmark
public int localListIteration(ThreadState state) {
    int sum = 0;
    for (String value : state.values) {
        sum += value.length();
    }
    return sum;
}
```

Mental model:

```text
Scope.Thread = each thread owns its own state
```

Gunakan untuk:

- parsing,
- mapping,
- serialization,
- collection local operation,
- algorithmic comparison,
- allocation cost,
- CPU local work.

Jangan gunakan jika tujuan benchmark adalah contention pada shared object.

---

### 10.2 `Scope.Benchmark`

Semua worker thread berbagi satu instance state.

```java
@State(Scope.Benchmark)
public static class SharedState {
    ConcurrentHashMap<String, String> cache;
}
```

Cocok untuk mengukur shared resource:

- lock,
- synchronized block,
- `ConcurrentHashMap`,
- cache shared,
- atomic counter,
- queue shared,
- ring buffer,
- rate limiter.

Contoh:

```java
@Benchmark
public String readSharedCache(SharedState state) {
    return state.cache.get("CASE-001");
}
```

Mental model:

```text
Scope.Benchmark = all benchmark threads fight over / share same state
```

Risiko:

- hasil sangat tergantung thread count,
- bisa mengukur contention, bukan cost operasi murni,
- perlu hati-hati dengan false sharing,
- perlu hati-hati dengan state yang berubah antar iteration.

---

### 10.3 `Scope.Group`

State dibagi dalam group thread tertentu.

Biasanya digunakan dengan `@Group` untuk benchmark producer/consumer atau reader/writer.

```java
@State(Scope.Group)
public static class QueueState {
    ArrayBlockingQueue<Integer> queue = new ArrayBlockingQueue<>(1024);
}
```

Contoh:

```java
import org.openjdk.jmh.annotations.Group;
import org.openjdk.jmh.annotations.GroupThreads;

@Benchmark
@Group("queue")
@GroupThreads(1)
public void producer(QueueState state) throws InterruptedException {
    state.queue.put(1);
}

@Benchmark
@Group("queue")
@GroupThreads(1)
public int consumer(QueueState state) throws InterruptedException {
    return state.queue.take();
}
```

Gunakan ketika ingin mengukur interaksi antar role:

- producer/consumer,
- reader/writer,
- cache loader/cache reader,
- enqueue/dequeue,
- acquire/release.

---

## 11. `@Setup` dan `@TearDown`

Setup menentukan kapan data disiapkan. TearDown menentukan kapan resource dibersihkan.

```java
import org.openjdk.jmh.annotations.Level;
import org.openjdk.jmh.annotations.Setup;
import org.openjdk.jmh.annotations.TearDown;

@State(Scope.Thread)
public static class MyState {
    List<String> values;

    @Setup(Level.Trial)
    public void setupTrial() {
        values = generateValues(10_000);
    }

    @TearDown(Level.Trial)
    public void tearDownTrial() {
        values = null;
    }
}
```

Level setup:

| Level | Kapan dijalankan | Cocok untuk |
|---|---:|---|
| `Trial` | sekali per fork/trial | dataset besar, parser, mapper, object immutable |
| `Iteration` | sebelum setiap iteration | reset state yang berubah per iteration |
| `Invocation` | sebelum setiap benchmark invocation | sangat jarang; overhead tinggi; hati-hati |

### 11.1 `Level.Trial`

Gunakan untuk setup yang tidak ingin diukur dan tidak berubah:

```java
@Setup(Level.Trial)
public void setup() {
    objectMapper = new ObjectMapper();
    payload = loadJsonPayload();
}
```

### 11.2 `Level.Iteration`

Gunakan jika state berubah dan perlu reset per iteration:

```java
@Setup(Level.Iteration)
public void reset() {
    queue.clear();
    queue.addAll(initialValues);
}
```

### 11.3 `Level.Invocation`

Gunakan hanya jika benar-benar perlu state fresh untuk setiap invocation.

```java
@Setup(Level.Invocation)
public void setupInvocation() {
    mutableObject = new MutableObject();
}
```

Bahaya `Level.Invocation`:

- overhead setup bisa mendominasi,
- hasil benchmark bisa lebih mengukur setup daripada operasi,
- JMH sendiri memperingatkan penggunaan invocation-level setup harus sangat hati-hati.

---

## 12. `@Param`: Input Matrix

`@Param` membuat benchmark menjalankan kombinasi input.

```java
@State(Scope.Thread)
public static class Params {
    @Param({"10", "100", "1000", "10000"})
    public int size;

    List<String> values;

    @Setup(Level.Trial)
    public void setup() {
        values = generateValues(size);
    }
}
```

Benchmark:

```java
@Benchmark
public int sumLength(Params params) {
    int sum = 0;
    for (String value : params.values) {
        sum += value.length();
    }
    return sum;
}
```

Output akan berisi result per `size`.

Gunakan `@Param` untuk:

- input size,
- payload complexity,
- distribution type,
- cache hit ratio,
- algorithm variant,
- format variant,
- concurrency level,
- branch probability.

Contoh:

```java
@Param({"ALL_VALID", "MOSTLY_VALID", "MOSTLY_INVALID", "RANDOM"})
public String distribution;
```

Jangan hanya benchmark satu ukuran input. Banyak algoritma punya profil berbeda:

```text
size 10     -> overhead fixed mendominasi
size 1_000  -> algorithmic cost mulai terlihat
size 1_000_000 -> memory/cache/GC mendominasi
```

---

## 13. Benchmark Mode

JMH memiliki beberapa mode utama.

### 13.1 `Mode.Throughput`

Mengukur operasi per waktu.

```java
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
```

Output misalnya:

```text
ops/s
```

Cocok untuk pertanyaan:

```text
Berapa banyak operasi yang bisa dilakukan per detik?
```

Gunakan untuk:

- parser throughput,
- serializer throughput,
- mapper throughput,
- hash computation,
- cache read throughput,
- algorithm batch operation.

Hati-hati: throughput tinggi tidak selalu berarti latency tail rendah.

---

### 13.2 `Mode.AverageTime`

Mengukur rata-rata waktu per operasi.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
```

Output misalnya:

```text
ns/op
```

Cocok untuk pertanyaan:

```text
Rata-rata satu operasi butuh waktu berapa?
```

Bagus untuk operasi kecil, tetapi jangan terlalu percaya jika variance besar.

---

### 13.3 `Mode.SampleTime`

Mengambil sample waktu operasi.

```java
@BenchmarkMode(Mode.SampleTime)
@OutputTimeUnit(TimeUnit.MICROSECONDS)
```

Output biasanya menyertakan distribusi sample.

Cocok ketika ingin melihat sebaran, bukan hanya rata-rata.

Namun untuk tail latency service nyata, load test dan tracing tetap lebih relevan.

---

### 13.4 `Mode.SingleShotTime`

Mengukur waktu satu invocation.

```java
@BenchmarkMode(Mode.SingleShotTime)
```

Cocok untuk:

- cold-ish operation,
- startup-like operation,
- batch single operation,
- initialization cost.

Biasanya dipakai dengan warmup/measurement khusus.

---

### 13.5 `Mode.All`

Menjalankan semua mode.

```java
@BenchmarkMode(Mode.All)
```

Ini jarang ideal untuk benchmark serius karena output terlalu banyak dan interpretasi bisa kabur. Lebih baik pilih mode sesuai pertanyaan.

---

## 14. Memilih Mode Berdasarkan Pertanyaan

| Pertanyaan | Mode yang cocok | Unit umum |
|---|---|---|
| Operasi kecil ini rata-rata berapa lama? | `AverageTime` | ns/op, us/op |
| Berapa operasi per detik? | `Throughput` | ops/s |
| Bagaimana distribusi waktu operasi? | `SampleTime` | percentile/sample |
| Berapa cost satu operasi cold-ish? | `SingleShotTime` | ms/op |
| Saya belum tahu mau apa | jangan langsung benchmark | rumuskan hipotesis dulu |

Contoh hipotesis bagus:

```text
Untuk payload JSON ukuran 2 KB dengan 30 field, custom lightweight parser
akan mengurangi allocation minimal 30% dibanding ObjectMapper tree model,
tanpa memperburuk average time lebih dari 10%.
```

Mode:

- `AverageTime` untuk cost rata-rata,
- `Throughput` untuk kapasitas,
- profiler `gc` untuk allocation,
- mungkin `SampleTime` untuk variance.

---

## 15. Warmup

Warmup adalah fase yang hasilnya dibuang. Tujuannya memberi JVM kesempatan untuk:

- load class,
- initialize code path,
- collect profiling data,
- compile hot method,
- inline method,
- stabilize allocation path,
- settle GC behavior awal.

Contoh:

```java
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
```

Artinya:

```text
5 warmup iterations
masing-masing 1 detik
hasil tidak dimasukkan ke score final
```

Warmup terlalu sedikit:

- hasil mencampur interpreted/C1/C2 phase,
- angka tidak stabil,
- benchmark seolah lambat,
- antar fork variance besar.

Warmup terlalu banyak:

- waktu CI boros,
- tetap belum tentu valid jika benchmark tidak pernah steady state,
- bisa membuat profile terlalu ideal dibanding aplikasi nyata.

Rule praktis:

```text
Mulai dengan 5-10 warmup iterations.
Jika variance besar, inspeksi output dan profiler.
Jangan hanya menambah warmup secara membabi buta.
```

---

## 16. Measurement

Measurement adalah fase yang hasilnya dihitung.

```java
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
```

Artinya:

```text
10 measurement iterations
masing-masing 1 detik
hasil dipakai untuk score final
```

Measurement harus cukup panjang agar:

- noise berkurang,
- sample cukup,
- GC/JIT incidental tidak mendominasi,
- hasil antar iteration terlihat.

Tetapi measurement terlalu panjang juga tidak selalu lebih baik. Jika benchmark memiliki leak, changing state, cache warming tidak realistis, atau thermal throttling, durasi terlalu panjang dapat mengubah karakter workload.

---

## 17. Fork

Fork menjalankan benchmark di JVM process terpisah.

```java
@Fork(3)
```

Artinya JMH menjalankan benchmark dalam 3 JVM process berbeda.

Kenapa fork penting?

1. Mengisolasi benchmark dari benchmark lain.
2. Menghindari profile pollution.
3. Menghindari classloader/JIT state dari run sebelumnya.
4. Mengurangi efek JVM state yang sudah terkontaminasi.
5. Membantu melihat variance antar JVM process.

Jika fork = 1, hasil bisa lebih cepat diperoleh tetapi lebih rentan misleading. Jika fork = 0, benchmark berjalan di JVM yang sama dengan runner. Ini biasanya hanya untuk debugging, bukan hasil final.

Rule praktis:

```text
Debugging: fork 0 atau 1 boleh.
Eksperimen lokal awal: fork 1-2.
Hasil yang mau dipercaya: fork minimal 3.
Benchmark penting/release gate: fork 5+ bila waktu memungkinkan.
```

Contoh fork dengan JVM args:

```java
@Fork(value = 3, jvmArgsAppend = {
        "-Xms2g",
        "-Xmx2g",
        "-XX:+UseG1GC"
})
```

Gunakan `jvmArgsAppend` untuk memastikan benchmark berjalan dengan konfigurasi yang ingin diuji.

---

## 18. Iteration, Invocation, Operation

Tiga istilah ini sering tercampur.

```text
Invocation = satu pemanggilan benchmark method
Iteration  = window waktu berisi banyak invocation
Fork       = JVM process yang menjalankan beberapa warmup + measurement iteration
```

Contoh:

```java
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
@Fork(3)
```

Maka secara kasar:

```text
3 JVM forks
  setiap fork:
    5 warmup windows
    10 measurement windows
      tiap window menjalankan benchmark method sebanyak mungkin
```

JMH bukan memanggil method sekali lalu mengukur. Ia menjalankan loop internal yang dikontrol harness.

---

## 19. Threads

`@Threads` menentukan jumlah worker thread yang menjalankan benchmark.

```java
@Threads(1)
```

atau:

```java
@Threads(Threads.MAX)
```

Contoh:

```java
@Benchmark
@Threads(4)
public String readSharedCache(SharedCacheState state) {
    return state.cache.get("CASE-001");
}
```

Gunakan threads > 1 hanya jika pertanyaan benchmark memang tentang concurrency/throughput under contention.

Kesalahan umum:

```text
Saya set @Threads(16) karena production punya banyak request.
```

Itu belum tentu benar. Production punya:

- request arrival pattern,
- network,
- DB,
- pool,
- lock,
- CPU quota,
- GC,
- logging,
- serialization,
- scheduler,
- noisy neighbor,
- kernel/network stack.

`@Threads(16)` di JMH hanya berarti 16 worker thread menjalankan method benchmark. Itu bukan simulasi production service.

---

## 20. Output Time Unit

Gunakan unit yang sesuai.

```java
@OutputTimeUnit(TimeUnit.NANOSECONDS)
```

Untuk operasi sangat kecil:

```java
TimeUnit.NANOSECONDS
```

Untuk serializer/parsing sedang:

```java
TimeUnit.MICROSECONDS
```

Untuk operasi besar/batch:

```java
TimeUnit.MILLISECONDS
```

Jangan biarkan unit membuat hasil terlihat dramatis. `10 ns/op` dan `0.000010 ms/op` adalah angka yang sama, tetapi persepsi manusia berbeda.

---

## 21. Contoh Lengkap: Benchmark Mapper Domain

Misalkan ada domain object:

```java
public final class CaseRecord {
    private final String id;
    private final String status;
    private final String assignedOfficer;
    private final long submittedAtEpochMillis;

    public CaseRecord(String id, String status, String assignedOfficer, long submittedAtEpochMillis) {
        this.id = id;
        this.status = status;
        this.assignedOfficer = assignedOfficer;
        this.submittedAtEpochMillis = submittedAtEpochMillis;
    }

    public String getId() {
        return id;
    }

    public String getStatus() {
        return status;
    }

    public String getAssignedOfficer() {
        return assignedOfficer;
    }

    public long getSubmittedAtEpochMillis() {
        return submittedAtEpochMillis;
    }
}
```

DTO:

```java
public final class CaseRecordDto {
    public String id;
    public String status;
    public String assignedOfficer;
    public long submittedAtEpochMillis;
}
```

Mapper manual:

```java
public final class ManualCaseMapper {
    public CaseRecordDto toDto(CaseRecord record) {
        CaseRecordDto dto = new CaseRecordDto();
        dto.id = record.getId();
        dto.status = record.getStatus();
        dto.assignedOfficer = record.getAssignedOfficer();
        dto.submittedAtEpochMillis = record.getSubmittedAtEpochMillis();
        return dto;
    }
}
```

Benchmark:

```java
package com.example.benchmarks;

import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.annotations.BenchmarkMode;
import org.openjdk.jmh.annotations.Fork;
import org.openjdk.jmh.annotations.Level;
import org.openjdk.jmh.annotations.Measurement;
import org.openjdk.jmh.annotations.Mode;
import org.openjdk.jmh.annotations.OutputTimeUnit;
import org.openjdk.jmh.annotations.Param;
import org.openjdk.jmh.annotations.Scope;
import org.openjdk.jmh.annotations.Setup;
import org.openjdk.jmh.annotations.State;
import org.openjdk.jmh.annotations.Warmup;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(3)
public class CaseMapperBenchmark {

    @State(Scope.Thread)
    public static class BenchmarkState {
        @Param({"1", "10", "100", "1000"})
        public int size;

        public List<CaseRecord> records;
        public ManualCaseMapper mapper;

        @Setup(Level.Trial)
        public void setup() {
            mapper = new ManualCaseMapper();
            records = new ArrayList<>(size);
            for (int i = 0; i < size; i++) {
                records.add(new CaseRecord(
                        "CASE-" + i,
                        i % 2 == 0 ? "SUBMITTED" : "UNDER_REVIEW",
                        "officer-" + (i % 10),
                        1_700_000_000_000L + i
                ));
            }
        }
    }

    @Benchmark
    public CaseRecordDto mapFirst(BenchmarkState state) {
        return state.mapper.toDto(state.records.get(0));
    }

    @Benchmark
    public int mapAll(BenchmarkState state) {
        int checksum = 0;
        for (CaseRecord record : state.records) {
            CaseRecordDto dto = state.mapper.toDto(record);
            checksum += dto.id.length();
        }
        return checksum;
    }
}
```

Perhatikan beberapa hal:

1. `mapFirst` mengukur single mapping.
2. `mapAll` mengukur batch mapping dan loop cost.
3. `checksum` digunakan agar hasil mapping tidak sepenuhnya dianggap tidak berguna.
4. Input size divariasikan.
5. State per thread, sehingga tidak ada contention.

Namun masih ada interpretasi penting:

- `mapAll` mengukur mapper + loop + allocation DTO.
- Jika ingin allocation, tambahkan profiler GC.
- Jika production mapper memakai reflection/MapStruct/Jackson, buat variant benchmark yang setara.
- Jika mapper production dipanggil pada object dengan null/enum/date kompleks, input benchmark harus mencerminkan itu.

---

## 22. Contoh: Benchmark Dengan Distribution Realistis

Benchmark yang terlalu ideal sering gagal karena semua input sama.

Buruk:

```java
@Benchmark
public boolean validate() {
    return validator.isValid("123456");
}
```

Lebih baik:

```java
@State(Scope.Thread)
public static class PostalCodeState {
    @Param({"ALL_VALID", "MOSTLY_VALID", "MIXED", "MOSTLY_INVALID"})
    public String distribution;

    public String[] values;
    private int index;

    @Setup(Level.Trial)
    public void setup() {
        values = switch (distribution) {
            case "ALL_VALID" -> new String[] {"123456", "654321", "111222", "999000"};
            case "MOSTLY_VALID" -> new String[] {"123456", "654321", "111222", "ABCDEF"};
            case "MIXED" -> new String[] {"123456", "ABCDEF", "", "12345", "999000"};
            case "MOSTLY_INVALID" -> new String[] {"ABCDEF", "", "12345", "12-345", "123456"};
            default -> throw new IllegalArgumentException(distribution);
        };
    }

    public String next() {
        String value = values[index];
        index = (index + 1) % values.length;
        return value;
    }
}
```

Benchmark:

```java
@Benchmark
public boolean validatePostalCode(PostalCodeState state) {
    return PostalCodeValidator.isValid(state.next());
}
```

Catatan Java 8: `switch` expression tidak tersedia. Gunakan `switch` statement biasa jika target Java 8.

Kenapa distribution penting?

Karena branch predictor dan JIT profile bisa menjadi terlalu ideal jika semua input sama. Production jarang selalu valid atau selalu invalid. Jika benchmark mengumpulkan profile yang tidak realistis, JVM bisa mengoptimasi jalur yang jarang terjadi di production.

---

## 23. Contoh Java 8 Compatible Version

Jika benchmark harus compile di Java 8, hindari:

- `var`,
- switch expression,
- records,
- text blocks,
- pattern matching,
- `List.of`,
- `Map.of`.

Contoh Java 8 friendly:

```java
@State(Scope.Thread)
public static class Java8State {
    @Param({"10", "100", "1000"})
    public int size;

    public List<String> values;

    @Setup(Level.Trial)
    public void setup() {
        values = new ArrayList<String>(size);
        for (int i = 0; i < size; i++) {
            values.add("CASE-" + i);
        }
    }
}
```

Benchmark:

```java
@Benchmark
public int sumLength(Java8State state) {
    int total = 0;
    for (String value : state.values) {
        total += value.length();
    }
    return total;
}
```

Jika organisasi punya library yang harus support Java 8, benchmark juga sebaiknya dijalankan pada Java 8 dan Java modern agar tahu apakah optimization profile berubah.

---

## 24. Java 8 sampai Java 25: Compatibility dan Interpretasi

Benchmark yang sama bisa menghasilkan performa berbeda antar versi JDK karena:

- compiler berubah,
- GC berubah,
- default GC berubah,
- string concatenation strategy berubah,
- compact strings diperkenalkan sejak Java 9,
- G1 menjadi default sejak Java 9,
- biased locking berubah dan kemudian dihapus,
- ZGC/Shenandoah berkembang,
- virtual threads tersedia sejak Java 21,
- implementation library berubah,
- intrinsics bertambah,
- vectorization berubah,
- container ergonomics membaik.

Strategi benchmark Java 8–25:

```text
1. Tentukan target runtime production.
2. Jalankan benchmark pada target tersebut.
3. Jika sedang migration, jalankan pada old dan new JDK.
4. Jangan generalisasi hasil Java 21 ke Java 8.
5. Jangan generalisasi hasil laptop ke container production.
```

Contoh matrix:

| Scenario | JDK benchmark |
|---|---|
| Legacy app masih Java 8 | Java 8 wajib |
| App migrasi 8 -> 17 | Java 8 dan 17 |
| Service modern Java 21 | Java 21 wajib |
| Evaluasi upgrade 21 -> 25 | Java 21 dan 25 |
| Library publik | lowest supported + latest LTS/current |

---

## 25. Menjalankan Benchmark Dengan Command Line Options

JMH annotation bagus untuk default, tetapi command line memberi fleksibilitas.

Lihat benchmark:

```bash
java -jar target/benchmarks.jar -l
```

Run benchmark berdasarkan regex:

```bash
java -jar target/benchmarks.jar '.*CaseMapper.*'
```

Set warmup:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -wi 5 \
  -w 1s
```

Set measurement:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -i 10 \
  -r 1s
```

Set fork:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -f 3
```

Set threads:

```bash
java -jar target/benchmarks.jar SharedCacheBenchmark \
  -t 8
```

Set mode:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -bm avgt
```

Set output unit:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -tu ns
```

Output JSON:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -rf json \
  -rff target/jmh-results.json
```

Print GC profiler:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -prof gc
```

Tambahkan JVM args:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark \
  -jvmArgsAppend "-Xms2g -Xmx2g -XX:+UseG1GC"
```

---

## 26. Membaca Output JMH

Contoh output:

```text
Benchmark                         (size)  Mode  Cnt     Score    Error  Units
CaseMapperBenchmark.mapFirst           1  avgt   30    12.345 ±  0.210  ns/op
CaseMapperBenchmark.mapAll            10  avgt   30   105.678 ±  2.100  ns/op
CaseMapperBenchmark.mapAll           100  avgt   30  980.456 ± 15.300  ns/op
```

Kolom:

| Kolom | Arti |
|---|---|
| Benchmark | nama benchmark method |
| Param | nilai `@Param` |
| Mode | mode measurement |
| Cnt | jumlah measurement sample/iteration aggregate |
| Score | hasil utama |
| Error | error/confidence interval estimate |
| Units | unit hasil |

Interpretasi:

```text
mapFirst size=1 rata-rata sekitar 12.345 ns/op dengan error ±0.210 ns/op.
```

Tapi jangan berhenti di situ. Tanyakan:

1. Apakah benchmark mencapai steady behavior?
2. Apakah variance kecil?
3. Apakah allocation terlihat?
4. Apakah hasil antar fork stabil?
5. Apakah input representatif?
6. Apakah JVM args sama dengan target production?
7. Apakah benchmark terlalu kecil sehingga noise dominan?
8. Apakah perbedaan praktis signifikan?

---

## 27. Score vs Error: Jangan Overclaim

Misalnya:

```text
A: 10.00 ± 1.50 ns/op
B: 10.80 ± 1.40 ns/op
```

Jangan langsung bilang A lebih cepat. Error overlap besar.

Bandingkan dengan:

```text
A: 10.00 ± 0.20 ns/op
B: 14.00 ± 0.30 ns/op
```

Di sini perbedaan lebih meyakinkan.

Tetapi tetap perlu tanya:

```text
Apakah 4 ns/op penting untuk workload ini?
```

Jika method dipanggil 100 kali per request dan service 100 RPS, mungkin tidak penting.
Jika method dipanggil 10 juta kali per detik pada hot loop, mungkin penting.

Top-tier engineer tidak hanya bertanya:

```text
Mana lebih cepat?
```

Tapi:

```text
Apakah perbedaan ini reliable, meaningful, dan worth the complexity?
```

---

## 28. Benchmarking Allocation Dengan `-prof gc`

JMH dapat memakai profiler bawaan GC:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark -prof gc
```

Output bisa mencakup:

```text
·gc.alloc.rate
·gc.alloc.rate.norm
·gc.count
·gc.time
```

Yang sangat berguna:

```text
gc.alloc.rate.norm = bytes/op
```

Contoh interpretasi:

```text
Implementation A: 120 B/op
Implementation B: 24 B/op
```

Ini sering lebih penting daripada `ns/op`, karena allocation tinggi dapat:

- meningkatkan GC pressure,
- memperburuk p99 latency,
- menaikkan memory bandwidth,
- memperbesar CPU cost,
- memperburuk container memory behavior.

Namun allocation benchmark juga perlu hati-hati:

- escape analysis bisa menghapus allocation,
- object bisa scalar replaced,
- benchmark terlalu kecil bisa tidak mencerminkan production escape behavior,
- return value/Blackhole bisa mengubah escape.

---

## 29. Benchmark Dengan JVM Args

Benchmark tanpa JVM args sering menjawab:

```text
Bagaimana hasil pada ergonomics JVM default di mesin ini?
```

Itu kadang berguna, tetapi sering bukan pertanyaan production.

Untuk service production, jalankan dengan konfigurasi mirip production:

```bash
java -jar target/benchmarks.jar JsonBenchmark \
  -f 3 \
  -wi 5 -i 10 \
  -jvmArgsAppend "-Xms2g -Xmx2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
```

Untuk membandingkan GC:

```bash
java -jar target/benchmarks.jar AllocationHeavyBenchmark \
  -jvmArgsAppend "-Xms2g -Xmx2g -XX:+UseG1GC"
```

```bash
java -jar target/benchmarks.jar AllocationHeavyBenchmark \
  -jvmArgsAppend "-Xms2g -Xmx2g -XX:+UseZGC"
```

Catatan: GC comparison dengan microbenchmark sering tricky. GC selection lebih baik divalidasi dengan application-level load test. JMH berguna untuk melihat allocation pressure dan micro cost, bukan memilih collector production secara tunggal.

---

## 30. Benchmark Dalam Container

Jika production berjalan di Kubernetes/container, benchmark laptop bare-metal bisa misleading.

Perbedaan yang mungkin terjadi:

- CPU quota,
- CPU throttling,
- memory limit,
- cgroups v1/v2,
- CPU architecture,
- NUMA,
- noisy neighbor,
- container memory ergonomics,
- thread scheduling,
- available processors yang dilihat JVM.

Contoh menjalankan benchmark dalam Docker:

```bash
docker run --rm \
  --cpus=2 \
  --memory=2g \
  -v "$PWD/target:/benchmarks" \
  eclipse-temurin:21 \
  java -jar /benchmarks/benchmarks.jar CaseMapperBenchmark \
    -f 3 -wi 5 -i 10 \
    -jvmArgsAppend "-Xms1g -Xmx1g"
```

Jika mengevaluasi production behavior, catat:

```text
JDK version:
Container image:
CPU limit:
Memory limit:
Host CPU:
OS/kernel:
JVM args:
Benchmark commit:
```

Benchmark tanpa environment metadata hampir tidak bisa dibandingkan ulang.

---

## 31. Jangan Jalankan JMH Sebagai Unit Test Biasa

Kadang engineer membuat test seperti ini:

```java
@Test
void benchmark() throws Exception {
    Options options = new OptionsBuilder()
            .include(CaseMapperBenchmark.class.getSimpleName())
            .forks(1)
            .build();

    new Runner(options).run();
}
```

Ini bisa dipakai untuk eksperimen lokal, tetapi tidak ideal sebagai unit test.

Masalah:

- unit test lifecycle tidak cocok untuk benchmark,
- IDE/test runner bisa mempengaruhi JVM state,
- benchmark menjadi lambat,
- CI unit test menjadi tidak stabil,
- hasil benchmark bukan pass/fail sederhana,
- performance threshold mudah flaky.

Lebih baik:

```text
unit test -> correctness
JMH -> benchmark job/profile khusus
load test -> system performance
```

Jika ingin performance regression gate, jalankan JMH sebagai CI job terpisah dengan runner dedicated dan baseline comparison yang matang. Ini akan dibahas lebih detail di Part 030.

---

## 32. Benchmark Configuration Template

Untuk eksperimen lokal awal:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 3, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(1)
public class LocalExplorationBenchmark {
}
```

Untuk hasil yang mulai bisa didiskusikan:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(3)
public class ReviewableBenchmark {
}
```

Untuk benchmark penting:

```java
@BenchmarkMode({Mode.AverageTime, Mode.Throughput})
@OutputTimeUnit(TimeUnit.MICROSECONDS)
@Warmup(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 15, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(value = 5, jvmArgsAppend = {
        "-Xms2g",
        "-Xmx2g",
        "-XX:+UseG1GC"
})
public class ImportantBenchmark {
}
```

Tetapi jangan copy-paste angka ini tanpa berpikir. Konfigurasi harus mengikuti:

- durasi operasi,
- variance,
- kebutuhan akurasi,
- waktu CI,
- jenis workload,
- environment.

---

## 33. Contoh Programmatic Runner

Kadang ingin membuat runner khusus:

```java
package com.example.benchmarks;

import org.openjdk.jmh.runner.Runner;
import org.openjdk.jmh.runner.RunnerException;
import org.openjdk.jmh.runner.options.Options;
import org.openjdk.jmh.runner.options.OptionsBuilder;
import org.openjdk.jmh.results.format.ResultFormatType;

import java.util.concurrent.TimeUnit;

public final class BenchmarkRunner {
    private BenchmarkRunner() {
    }

    public static void main(String[] args) throws RunnerException {
        Options options = new OptionsBuilder()
                .include(".*CaseMapperBenchmark.*")
                .mode(org.openjdk.jmh.annotations.Mode.AverageTime)
                .timeUnit(TimeUnit.NANOSECONDS)
                .warmupIterations(5)
                .measurementIterations(10)
                .forks(3)
                .resultFormat(ResultFormatType.JSON)
                .result("target/jmh-results.json")
                .jvmArgsAppend("-Xms2g", "-Xmx2g", "-XX:+UseG1GC")
                .build();

        new Runner(options).run();
    }
}
```

Gunakan runner seperti ini jika:

- ingin benchmark suite curated,
- ingin output standar,
- ingin JVM args konsisten,
- ingin integrasi CI sederhana.

Tetap hindari menjadikannya unit test.

---

## 34. Benchmark Naming

Nama benchmark harus menjelaskan apa yang dibandingkan.

Buruk:

```java
@Benchmark
public Object test1() { ... }
```

Lebih baik:

```java
@Benchmark
public CaseDto manualMapper_singleRecord() { ... }

@Benchmark
public CaseDto reflectionMapper_singleRecord() { ... }

@Benchmark
public int manualMapper_batchRecords() { ... }
```

Lebih baik lagi jika class benchmark mengandung konteks:

```java
CaseRecordMappingBenchmark
PostalCodeValidationBenchmark
AuditTrailSerializationBenchmark
PermissionMatrixLookupBenchmark
WorkflowTransitionGuardBenchmark
```

Benchmark adalah artifact engineering. Nama buruk membuat hasil sulit dibahas.

---

## 35. Benchmark Documentation Block

Setiap benchmark penting sebaiknya punya komentar di atas class:

```java
/**
 * Measures mapping cost from CaseRecord domain object to CaseRecordDto.
 *
 * Question:
 *   Is the manual mapper materially cheaper than reflection-based mapper
 *   for API listing payloads?
 *
 * Workload:
 *   - sizes: 1, 10, 100, 1000 records
 *   - no database access
 *   - no JSON serialization
 *   - records are pre-created in @Setup(Level.Trial)
 *
 * What this benchmark does NOT prove:
 *   - API endpoint latency
 *   - DB query performance
 *   - Jackson serialization cost
 *   - production p99 latency
 */
```

Ini penting karena benchmark sering disalahgunakan beberapa bulan kemudian.

Engineer yang matang menulis batas interpretasi, bukan hanya angka.

---

## 36. Common Mistake: Setup Tercampur Dengan Measurement

Buruk:

```java
@Benchmark
public int parseAll() {
    List<String> values = generateValues(1000);
    int total = 0;
    for (String value : values) {
        total += Integer.parseInt(value);
    }
    return total;
}
```

Benchmark ini mengukur:

- generate list,
- allocate strings/list,
- parse int,
- loop.

Jika yang ingin diukur parsing, ini salah.

Lebih baik:

```java
@State(Scope.Thread)
public static class ParseState {
    List<String> values;

    @Setup(Level.Trial)
    public void setup() {
        values = generateValues(1000);
    }
}

@Benchmark
public int parseAll(ParseState state) {
    int total = 0;
    for (String value : state.values) {
        total += Integer.parseInt(value);
    }
    return total;
}
```

Namun jika production memang generate + parse dalam satu flow, benchmark gabungan bisa sah. Kuncinya: nyatakan apa yang diukur.

---

## 37. Common Mistake: Manual Loop Di Dalam Benchmark

Kadang engineer menulis:

```java
@Benchmark
public int benchmark() {
    int sum = 0;
    for (int i = 0; i < 1_000_000; i++) {
        sum += method(i);
    }
    return sum;
}
```

Ini tidak selalu salah, tetapi harus dipahami.

JMH sendiri sudah melakukan loop invocation. Manual loop mengubah unit measurement menjadi:

```text
satu operasi benchmark = 1.000.000 operasi method
```

Ini bisa berguna jika operasi terlalu kecil dan perlu amortisasi overhead. Tetapi risiko:

- branch profile terlalu ideal,
- CPU cache behavior berbeda,
- loop optimization mendominasi,
- operation cost per item tidak jelas,
- production tidak melakukan batch seperti itu.

Lebih baik mulai tanpa manual loop, kecuali ada alasan eksplisit.

Jika memakai loop, gunakan nama yang jelas:

```java
@Benchmark
public int parseBatchOfOneThousand() { ... }
```

Bukan:

```java
public int parse() { ... }
```

---

## 38. Common Mistake: Mengukur Constant Folding

Buruk:

```java
@Benchmark
public int add() {
    return 1 + 2;
}
```

Compiler dapat mengubahnya menjadi `3`.

Buruk:

```java
@Benchmark
public boolean regex() {
    return Pattern.matches("\\d+", "123456");
}
```

Ini juga tidak representatif karena input konstan.

Lebih baik:

```java
@State(Scope.Thread)
public static class RegexState {
    Pattern pattern;
    String[] values;
    int index;

    @Setup(Level.Trial)
    public void setup() {
        pattern = Pattern.compile("\\d+");
        values = new String[] {"123456", "ABC", "987654", "12-34"};
    }

    String next() {
        String value = values[index];
        index = (index + 1) % values.length;
        return value;
    }
}

@Benchmark
public boolean regex(RegexState state) {
    return state.pattern.matcher(state.next()).matches();
}
```

---

## 39. Common Mistake: Benchmark Mengubah State Tanpa Reset

Buruk:

```java
@State(Scope.Benchmark)
public static class ListState {
    List<String> values = new ArrayList<>();
}

@Benchmark
public void add(ListState state) {
    state.values.add("x");
}
```

Masalah:

- list makin besar sepanjang benchmark,
- resize behavior berubah,
- memory pressure berubah,
- benchmark tidak steady,
- hasil iteration awal dan akhir beda.

Jika memang ingin mengukur append pada growing list, nyatakan itu. Jika tidak, reset:

```java
@Setup(Level.Iteration)
public void reset() {
    values = new ArrayList<>(capacity);
}
```

Atau ukur operasi yang tidak mengubah state.

---

## 40. Common Mistake: Mengabaikan Allocation

Dua implementasi:

```text
A: 50 ns/op, 0 B/op
B: 45 ns/op, 800 B/op
```

Apakah B lebih baik? Belum tentu.

Jika operasi dipanggil jutaan kali, B bisa membuat GC pressure besar dan memperburuk p99 latency.

Karena itu untuk benchmark Java, biasakan menjalankan:

```bash
-prof gc
```

Terutama untuk:

- mapper,
- serializer,
- parser,
- string operation,
- collection operation,
- stream pipeline,
- regex,
- date/time formatting,
- error construction,
- logging message construction.

---

## 41. Common Mistake: Benchmark Terlalu Kecil Untuk Dipercaya

Jika hasil:

```text
0.300 ns/op
```

Kemungkinan besar benchmark tidak mengukur operasi nyata, atau operasi sudah dioptimasi habis.

CPU modern tidak bisa melakukan arbitrary Java semantic operation meaningful dalam 0.3 ns secara umum. Angka seperti itu harus dicurigai.

Tanyakan:

- apakah hasil di-return atau dikonsumsi?
- apakah input constant?
- apakah method di-inline dan dieliminasi?
- apakah operasi sebenarnya tidak terjadi?
- apakah benchmark mengukur loop kosong?

---

## 42. Common Mistake: Menggeneralisasi Microbenchmark Ke Production

Contoh:

```text
JMH menunjukkan library JSON A 20% lebih cepat dari B.
Maka API kita pasti 20% lebih cepat jika pindah ke A.
```

Ini lemah.

API latency mungkin terdiri dari:

```text
DB query        70 ms
business logic   5 ms
serialization    3 ms
network          5 ms
security         2 ms
logging          1 ms
```

Jika serialization 20% lebih cepat:

```text
3 ms -> 2.4 ms
Total 86 ms -> 85.4 ms
```

Impact hanya 0.7%.

JMH menjawab cost lokal. Production improvement butuh system-level measurement.

---

## 43. Practical Workflow Membuat Benchmark JMH

Gunakan workflow ini:

```text
1. Rumuskan pertanyaan.
2. Tentukan metric utama.
3. Tentukan input distribution.
4. Tentukan baseline implementation.
5. Buat benchmark state.
6. Pisahkan setup dari measurement.
7. Pilih mode.
8. Pilih warmup/measurement/fork.
9. Jalankan lokal cepat.
10. Perbaiki benchmark smell.
11. Jalankan dengan profiler GC.
12. Jalankan dengan JVM target.
13. Jalankan beberapa fork.
14. Simpan result JSON.
15. Interpretasikan dengan batasan.
16. Validasi dengan profiler/load test jika keputusan besar.
```

---

## 44. Benchmark Review Checklist

Sebelum mempercayai hasil JMH, review:

```text
[ ] Pertanyaan benchmark jelas.
[ ] Benchmark membandingkan minimal baseline vs candidate.
[ ] Input tidak semua constant/literal ideal.
[ ] Input size divariasikan.
[ ] Distribution realistis atau sengaja dijelaskan.
[ ] Setup tidak tercampur dengan measurement.
[ ] State scope sesuai pertanyaan.
[ ] Fork minimal 3 untuk hasil reviewable.
[ ] Warmup cukup dan tidak asal.
[ ] Measurement cukup.
[ ] Output unit sesuai.
[ ] Return value/Blackhole mencegah dead code elimination.
[ ] Allocation diukur jika relevan.
[ ] JVM version dicatat.
[ ] JVM args dicatat.
[ ] Hardware/container environment dicatat.
[ ] Error/variance diperhatikan.
[ ] Hasil tidak dioverclaim sebagai production latency.
[ ] Benchmark source dan result disimpan.
```

---

## 45. Domain-Oriented Benchmark Examples

### 45.1 Permission Matrix Lookup

Pertanyaan:

```text
Apakah precomputed permission map lebih murah daripada evaluasi rule list per request?
```

Benchmark variant:

- rule-list evaluator,
- precomputed map,
- bitset-based permission,
- cached decision.

Metric:

- average time,
- throughput,
- allocation.

Input distribution:

- common role,
- rare role,
- denied role,
- multiple module,
- mixed read/write/approve action.

---

### 45.2 Workflow Guard Evaluation

Pertanyaan:

```text
Apakah guard transition workflow cukup murah untuk dievaluasi di listing page massal?
```

Benchmark variant:

- imperative if/else,
- rule object chain,
- expression engine,
- precomputed transition table.

Metric:

- ns/op atau us/op,
- allocation,
- variance.

Input distribution:

- submitted,
- under review,
- approved,
- rejected,
- appealed,
- withdrawn,
- mixed.

---

### 45.3 Audit Trail Serialization

Pertanyaan:

```text
Berapa cost serialisasi audit metadata untuk command penting?
```

Benchmark variant:

- Jackson POJO,
- Jackson tree,
- manual JSON,
- binary format jika relevan.

Metric:

- average time,
- bytes/op,
- output size.

Batas interpretasi:

- tidak mengukur DB CLOB insert,
- tidak mengukur network,
- tidak mengukur transaction commit,
- hanya mengukur serialization lokal.

---

### 45.4 Idempotency Key Hashing

Pertanyaan:

```text
Apakah format idempotency key tertentu mahal di hot path?
```

Benchmark variant:

- string concatenation,
- `StringBuilder`,
- SHA-256,
- Murmur/xxHash jika dependency ada,
- structured key object.

Metric:

- average time,
- allocation,
- collision behavior tidak cukup dengan JMH.

---

## 46. JMH dan Profiling

JMH bisa digabung dengan profiler:

```bash
java -jar target/benchmarks.jar CaseMapperBenchmark -prof gc
```

Beberapa profiler umum:

```text
gc        -> allocation/GC stats
stack     -> stack sampling sederhana
perfasm   -> assembly/perf integration, Linux-specific dan butuh setup
```

Untuk investigasi lebih dalam, biasanya gunakan:

- async-profiler,
- JFR,
- perf,
- JITWatch,
- GC logs.

JMH profiler membantu menjawab:

```text
Kenapa hasil ini begitu?
```

Bukan hanya:

```text
Berapa score-nya?
```

---

## 47. Recommended Result Artifact

Setiap benchmark serius sebaiknya menghasilkan folder seperti:

```text
benchmark-results/
  2026-06-16_case-mapper_jdk21_g1/
    result.json
    command.txt
    environment.txt
    git.txt
    gc-profiler.txt
    notes.md
```

`environment.txt`:

```text
JDK: Eclipse Temurin 21.0.x
OS: Linux x86_64
CPU: AMD EPYC ...
Memory: 16 GB
Container: no / yes
CPU limit: 2
Memory limit: 2g
JVM args: -Xms2g -Xmx2g -XX:+UseG1GC
```

`notes.md`:

```md
# Benchmark Notes

Question:

Result summary:

Interpretation:

Limitations:

Decision:

Follow-up:
```

Benchmark tanpa artifact discipline sulit dipakai sebagai evidence engineering.

---

## 48. Performance Decision Framework

Setelah hasil keluar, jangan langsung optimize. Gunakan framework:

```text
1. Is the result reliable?
2. Is the difference statistically visible?
3. Is the difference practically meaningful?
4. Is the workload representative?
5. Does the faster implementation increase complexity?
6. Does it reduce maintainability?
7. Does it affect correctness/security/regulatory behavior?
8. Does it improve production bottleneck?
9. Do we have profiler/load-test evidence?
10. Is rollback easy?
```

Contoh:

```text
Candidate mapper 15% faster but adds reflection cache complexity.
Endpoint spends only 2% time in mapping.
Decision: reject optimization for now.
```

Contoh lain:

```text
Permission lookup is 8x faster and reduces allocation from 600 B/op to 32 B/op.
This code runs for every API request and appears in flame graph.
Decision: proceed, with correctness/property tests and benchmark regression guard.
```

---

## 49. Anti-Pattern Besar JMH

### 49.1 “JMH says faster, so we ship”

Benchmark adalah satu evidence, bukan keputusan final.

### 49.2 Benchmark tanpa baseline

Score tunggal tidak berarti banyak. Perlu baseline.

### 49.3 Benchmark tanpa allocation metric

Di JVM, allocation sering sama pentingnya dengan CPU.

### 49.4 Benchmark tanpa environment metadata

Tidak reproducible.

### 49.5 Benchmark terlalu ideal

Semua input valid, semua branch sama, semua cache warm.

### 49.6 Benchmark dipakai untuk membuktikan opini

Benchmark harus menguji hipotesis, bukan mencari pembenaran.

### 49.7 Benchmark dijalankan di laptop sambil browser/video call aktif

Noise tinggi.

### 49.8 Benchmark JDK berbeda dari production

Hasil bisa berubah drastis.

### 49.9 Benchmark mengukur hal yang bukan bottleneck

Optimization tanpa impact.

### 49.10 Benchmark tidak pernah dihapus/diperbarui

Benchmark bisa membusuk seperti test.

---

## 50. Mini Capstone: Dari Pertanyaan ke JMH Benchmark

### 50.1 Problem

Tim melihat p99 latency listing case naik. Flame graph menunjukkan sebagian waktu berada di authorization decision untuk setiap row.

Pertanyaan microbenchmark:

```text
Apakah permission decision berbasis rule list lebih mahal dibanding precomputed permission table?
```

Batas:

```text
Benchmark ini tidak membuktikan endpoint latency.
Benchmark ini hanya mengukur local permission decision cost.
```

### 50.2 Benchmark Skeleton

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(value = 3, jvmArgsAppend = {"-Xms1g", "-Xmx1g", "-XX:+UseG1GC"})
public class PermissionDecisionBenchmark {

    @State(Scope.Thread)
    public static class DecisionState {
        @Param({"COMMON_ALLOW", "COMMON_DENY", "RARE_ROLE", "MIXED"})
        public String distribution;

        PermissionRuleListEvaluator ruleListEvaluator;
        PrecomputedPermissionEvaluator precomputedEvaluator;
        DecisionInput[] inputs;
        int index;

        @Setup(Level.Trial)
        public void setup() {
            ruleListEvaluator = PermissionFixtures.ruleListEvaluator();
            precomputedEvaluator = PermissionFixtures.precomputedEvaluator();
            inputs = PermissionFixtures.inputs(distribution);
        }

        DecisionInput next() {
            DecisionInput input = inputs[index];
            index = (index + 1) % inputs.length;
            return input;
        }
    }

    @Benchmark
    public boolean ruleList(DecisionState state) {
        DecisionInput input = state.next();
        return state.ruleListEvaluator.isAllowed(input.user(), input.module(), input.action());
    }

    @Benchmark
    public boolean precomputed(DecisionState state) {
        DecisionInput input = state.next();
        return state.precomputedEvaluator.isAllowed(input.user(), input.module(), input.action());
    }
}
```

Java 8 version would avoid `record`, `switch` expression, and newer APIs.

### 50.3 Run

```bash
java -jar target/benchmarks.jar PermissionDecisionBenchmark \
  -f 3 \
  -wi 5 -i 10 \
  -prof gc \
  -rf json \
  -rff target/permission-decision-jmh.json
```

### 50.4 Interpretasi

Misalnya:

```text
ruleList:    450 ns/op, 320 B/op
precomputed:  55 ns/op,  24 B/op
```

Interpretasi yang benar:

```text
Precomputed evaluator materially cheaper in this isolated benchmark.
Because permission decision appears in production flame graph and is called per listing row,
this optimization is likely worth validating in an endpoint-level performance test.
```

Bukan:

```text
Endpoint pasti 8x lebih cepat.
```

---

## 51. Ringkasan Mental Model

JMH membantu membuat eksperimen microbenchmark JVM yang lebih sahih dibanding stopwatch manual.

Namun JMH hanya sekuat desain benchmark-nya.

Hal yang harus selalu dijaga:

```text
Question -> Workload -> State -> Mode -> Warmup -> Measurement -> Fork -> Profiler -> Interpretation
```

Jika pertanyaan tidak jelas, benchmark tidak akan berguna.
Jika workload tidak representatif, hasil bisa menipu.
Jika state salah, measurement salah.
Jika fork/warmup kurang, hasil noise.
Jika allocation tidak dilihat, performance story setengah buta.
Jika hasil dioverclaim ke production, keputusan bisa salah.

Top-tier Java engineer memakai JMH untuk membangun evidence lokal, lalu menghubungkannya dengan profiler dan system-level measurement.

---

## 52. Checklist Praktis Untuk Part Ini

Setelah mempelajari part ini, pastikan Anda bisa:

```text
[ ] Menjelaskan kenapa JMH lebih baik dari stopwatch manual.
[ ] Membuat project JMH standalone.
[ ] Menulis benchmark method dengan @Benchmark.
[ ] Menggunakan @State dengan Scope.Thread.
[ ] Menggunakan Scope.Benchmark untuk shared state.
[ ] Menggunakan Scope.Group untuk producer/consumer style benchmark.
[ ] Menggunakan @Setup(Level.Trial) dan @Setup(Level.Iteration).
[ ] Menggunakan @Param untuk input matrix.
[ ] Memilih Mode.AverageTime vs Throughput vs SampleTime vs SingleShotTime.
[ ] Mengatur warmup, measurement, fork, threads.
[ ] Membaca Score, Error, Units, dan Cnt.
[ ] Menggunakan -prof gc untuk melihat allocation.
[ ] Menjalankan benchmark dengan JVM args target.
[ ] Membedakan local benchmark result dari production performance claim.
[ ] Menulis benchmark limitation statement.
```

---

## 53. Latihan Mandiri

### Latihan 1: Mapper Benchmark

Buat benchmark untuk membandingkan:

- manual mapper,
- reflection-based mapper,
- MapStruct mapper jika digunakan.

Input:

- 1 record,
- 10 records,
- 100 records,
- 1000 records.

Metric:

- average time,
- allocation.

### Latihan 2: Validation Benchmark

Buat benchmark postal code validator:

- regex,
- manual char check,
- precompiled pattern.

Distribution:

- all valid,
- mixed,
- mostly invalid.

### Latihan 3: Authorization Lookup

Bandingkan:

- list of rules,
- map lookup,
- enum-map lookup,
- bitset permission.

Gunakan `@Param` untuk role distribution.

### Latihan 4: Java Version Matrix

Jalankan benchmark yang sama pada:

- Java 8,
- Java 17,
- Java 21,
- Java 25 jika tersedia di environment.

Catat perbedaan dan jangan langsung menyimpulkan tanpa melihat JVM args dan environment.

---

## 54. Referensi

- OpenJDK JMH Project: https://openjdk.org/projects/code-tools/jmh/
- OpenJDK JMH GitHub Repository: https://github.com/openjdk/jmh
- JMH Samples: https://github.com/openjdk/jmh/tree/master/jmh-samples/src/main/java/org/openjdk/jmh/samples
- Oracle: Avoiding Benchmarking Pitfalls on the JVM: https://www.oracle.com/technical-resources/articles/java/architect-benchmarking.html
- Maven Central JMH Artifacts: https://central.sonatype.com/namespace/org.openjdk.jmh
- JMH Gradle Plugin: https://github.com/melix/jmh-gradle-plugin
- Misleading Microbenchmarks on the Java Virtual Machines, 2026: https://arxiv.org/abs/2605.23570
- Towards Effective Assessment of Steady State Performance in Java Software, 2022: https://arxiv.org/abs/2209.15369

---

## 55. Penutup

Part ini membangun fondasi praktis JMH: project setup, benchmark method, state, scope, setup lifecycle, params, mode, warmup, measurement, fork, threads, output, profiler GC, dan interpretasi.

Bagian berikutnya akan masuk ke **JMH Deep Dive II: Benchmark Pitfalls dan Benchmark Design Patterns**. Di sana kita akan membahas lebih tajam jebakan seperti dead code elimination, constant folding, loop benchmark, unrealistic branch profile, escape analysis, benchmarking IO, benchmarking DB, benchmarking virtual threads, benchmarking locks, dan cara mendesain benchmark yang lebih representatif.

Status seri: **belum selesai**.  
Progress: **Part 017 dari 031 selesai**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-016](./learn-java-testing-benchmarking-performance-jvm-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-018](./learn-java-testing-benchmarking-performance-jvm-part-018.md)
