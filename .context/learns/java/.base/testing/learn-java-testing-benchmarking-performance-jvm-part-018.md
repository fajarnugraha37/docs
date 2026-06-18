# learn-java-testing-benchmarking-performance-jvm-part-018

# JMH Deep Dive II: Benchmark Pitfalls dan Benchmark Design Patterns

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `018`  
> Topik: JMH pitfalls, benchmark design patterns, representativeness, workload modelling, allocation benchmarking, branch profile, state isolation, dan interpretasi hasil benchmark  
> Target Java: 8 hingga 25

---

## 0. Tujuan Part Ini

Pada part sebelumnya, kita sudah membahas struktur dasar JMH:

- `@Benchmark`
- `@State`
- `@Setup`
- `@TearDown`
- `@Param`
- warmup
- measurement
- fork
- thread
- benchmark mode
- output interpretation

Part ini lebih penting daripada sekadar API JMH.

Di sini kita membahas **kenapa benchmark bisa salah walaupun menggunakan JMH**.

JMH membantu menghindari banyak jebakan klasik JVM benchmarking. Tetapi JMH tidak bisa secara otomatis membuat benchmark menjadi representatif. Tool bisa mengatur harness, warmup, fork, measurement, dan konsumsi result. Namun tool tidak tahu apakah workload yang kita ukur benar-benar menyerupai real system.

Mental model utama part ini:

```text
JMH prevents many measurement mistakes.
JMH does not prevent bad benchmark questions.
```

Atau dalam bahasa engineering:

```text
Benchmark yang valid bukan benchmark yang "berjalan".
Benchmark yang valid adalah benchmark yang menjawab pertanyaan performa yang benar,
dengan workload yang cukup representatif,
dan dengan measurement yang tidak dirusak oleh optimisasi JVM, noise, atau asumsi palsu.
```

Setelah part ini, Anda harus mampu:

1. mengenali benchmark yang misleading;
2. mendesain benchmark yang lebih sahih;
3. membedakan microbenchmark, component benchmark, dan macrobenchmark;
4. menghindari dead-code elimination, constant folding, loop error, allocation trap, dan false sharing;
5. membaca angka JMH dengan skeptis tetapi produktif;
6. memutuskan kapan hasil benchmark boleh dipakai sebagai dasar keputusan teknis;
7. membuat benchmark yang berguna untuk regression guard, bukan hanya demo angka cepat.

---

## 1. Benchmark Bukan Perlombaan Angka

Banyak engineer menulis benchmark seperti ini:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    service.doSomething(input);
}
long end = System.nanoTime();
System.out.println(end - start);
```

Masalahnya bukan hanya karena tidak memakai JMH. Masalah lebih dalamnya:

- tidak ada warmup;
- tidak ada fork;
- tidak jelas apakah result dipakai;
- input mungkin constant;
- branch profile mungkin palsu;
- loop berada di tempat salah;
- GC tidak diamati;
- allocation tidak diukur;
- hasil hanya satu angka;
- tidak ada variance;
- tidak ada confidence;
- tidak ada hypothesis;
- tidak ada hubungan dengan production workload.

JMH memperbaiki sebagian dari hal di atas, tetapi tetap bisa salah jika pertanyaan benchmark salah.

Contoh pertanyaan benchmark yang buruk:

```text
Mana yang lebih cepat: stream atau for-loop?
```

Pertanyaan ini terlalu umum. Jawaban realistisnya: tergantung.

Lebih baik:

```text
Untuk list berukuran 10, 100, 10_000, dan 1_000_000,
dengan operasi filter sederhana dan mapping non-allocating,
pada Java 17 dan 21,
apakah implementasi stream menambah latency atau allocation signifikan dibanding for-loop
di path permission evaluation yang dipanggil 50k kali/detik?
```

Pertanyaan kedua memiliki:

- konteks;
- ukuran input;
- jenis operasi;
- versi Java;
- metric;
- toleransi risiko;
- hubungan dengan production path.

Itulah benchmark engineering.

---

## 2. Evidence Ladder untuk Benchmark

Jangan jadikan benchmark sebagai satu-satunya bukti.

Gunakan ladder berikut:

```text
1. Correctness test
   Membuktikan hasil benar.

2. Microbenchmark
   Mengukur cost isolated operation.

3. Allocation profile
   Mengukur object churn.

4. CPU profile
   Membuktikan hot path.

5. Component benchmark
   Mengukur kombinasi beberapa komponen internal.

6. Load test
   Mengukur behavior service di bawah workload realistis.

7. Production telemetry
   Membuktikan behavior real-world.
```

JMH paling kuat di langkah 2 dan sebagian langkah 3.

JMH tidak menggantikan:

- profiling production;
- load testing;
- thread dump analysis;
- GC log analysis;
- DB query plan;
- network latency measurement;
- container CPU throttling analysis.

Rule of thumb:

```text
Gunakan JMH untuk menjawab: "Apakah operasi kecil ini punya cost signifikan?"
Jangan gunakan JMH untuk menjawab: "Apakah service production saya scalable?"
```

---

## 3. Pitfall #1 — Dead Code Elimination

Dead-code elimination terjadi ketika JVM menghapus computation karena hasilnya tidak dipakai.

Contoh benchmark salah:

```java
@Benchmark
public void wrong() {
    calculator.compute(42);
}
```

Jika `compute(42)` pure, tidak punya side effect, dan result tidak dipakai, JIT bisa menyimpulkan bahwa computation tidak mempengaruhi observable behavior. Akibatnya computation bisa dihapus atau dioptimalkan terlalu agresif.

Benchmark terlihat sangat cepat, tetapi yang diukur bukan operasi sebenarnya.

Solusi 1: return result.

```java
@Benchmark
public int correctByReturn() {
    return calculator.compute(42);
}
```

JMH akan mengonsumsi return value sehingga JVM tidak bisa menghapus computation secara bebas.

Solusi 2: gunakan `Blackhole`.

```java
@Benchmark
public void correctByBlackhole(Blackhole blackhole) {
    int result = calculator.compute(42);
    blackhole.consume(result);
}
```

Kapan return lebih baik?

Jika hanya ada satu result sederhana.

Kapan `Blackhole` lebih baik?

Jika:

- ada beberapa result;
- method void tetapi menghasilkan observable internal state;
- ingin mengonsumsi intermediate value;
- ingin menghindari return object yang tidak mewakili semua computation.

Namun jangan memakai `Blackhole` secara sembarangan. `Blackhole` bukan mantra. Ia hanya memastikan value dikonsumsi oleh harness.

Anti-pattern:

```java
@Benchmark
public void fakeSafe(Blackhole bh) {
    // Input constant, branch selalu sama, output predictable.
    bh.consume(service.calculate("FIXED"));
}
```

Ini aman dari DCE, tetapi belum tentu representatif.

---

## 4. Pitfall #2 — Constant Folding

Constant folding terjadi ketika JVM menghitung expression constant lebih awal.

Contoh salah:

```java
@Benchmark
public int wrong() {
    return Integer.parseInt("12345");
}
```

Input selalu sama. JVM bisa mengoptimalkan berdasarkan fakta bahwa string tidak pernah berubah.

Lebih baik:

```java
@State(Scope.Thread)
public class ParseState {
    @Param({"12345", "67890", "99999"})
    String value;
}

@Benchmark
public int parse(ParseState state) {
    return Integer.parseInt(state.value);
}
```

Lebih representatif lagi jika production input bervariasi:

```java
@State(Scope.Thread)
public class ParseState {
    private String[] values;
    private int index;

    @Setup
    public void setup() {
        values = new String[] {"12345", "67890", "99999", "10001"};
    }

    String next() {
        String value = values[index];
        index = (index + 1) & 3;
        return value;
    }
}

@Benchmark
public int parse(ParseState state) {
    return Integer.parseInt(state.next());
}
```

Tetapi hati-hati: `next()` sendiri punya cost. Jika operasi yang diukur sangat kecil, cost input selection bisa mendominasi.

Better pattern:

```text
Jika operation sangat kecil:
  - ukur baseline input-selection cost;
  - bandingkan benchmark operation dengan baseline;
  - jangan klaim angka absolut tanpa subtract/interpret baseline.
```

Contoh baseline:

```java
@Benchmark
public String baselineNext(ParseState state) {
    return state.next();
}

@Benchmark
public int parse(ParseState state) {
    return Integer.parseInt(state.next());
}
```

Interpretasi:

```text
parse cost ≈ parse benchmark - baselineNext benchmark
```

Namun subtraction juga berbahaya jika variance besar. Lebih aman menyebut baseline sebagai konteks, bukan angka matematis absolut.

---

## 5. Pitfall #3 — Loop di Dalam Benchmark Method

Contoh umum:

```java
@Benchmark
public int wrongLoop() {
    int sum = 0;
    for (int i = 0; i < 1_000_000; i++) {
        sum += compute(i);
    }
    return sum;
}
```

Kadang ini sah, tetapi sering salah.

Masalahnya:

- JMH sudah mengulang benchmark method;
- loop internal bisa mengubah optimization profile;
- JIT bisa mengoptimalkan loop secara berbeda dari production;
- branch predictor menjadi terlalu stabil;
- memory access pattern menjadi terlalu synthetic;
- cost per operation sulit dibaca;
- safepoint dan GC behavior bisa berubah;
- loop overhead bercampur dengan operation cost.

Lebih baik untuk microbenchmark sederhana:

```java
@Benchmark
public int singleOperation(StateData state) {
    return compute(state.next());
}
```

Kapan loop internal boleh?

Loop internal boleh jika yang ingin diukur memang batch operation.

Contoh sah:

```java
@Benchmark
public int batchPermissionEvaluation(PermissionBatchState state) {
    int allowed = 0;
    for (PermissionRequest request : state.requests) {
        if (state.evaluator.isAllowed(request)) {
            allowed++;
        }
    }
    return allowed;
}
```

Karena production memang mengevaluasi batch permission.

Checklist loop internal:

```text
Apakah production juga melakukan loop serupa?
Apakah ukuran batch realistis?
Apakah data distribution realistis?
Apakah branch outcome realistis?
Apakah loop body punya side effect?
Apakah result loop dikonsumsi?
Apakah cost setup tidak ikut terukur?
Apakah benchmark mode sesuai?
```

---

## 6. Pitfall #4 — Setup Cost Ikut Terukur

Contoh salah:

```java
@Benchmark
public String wrong() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    CasePayload payload = new CasePayload("CASE-001", "SUBMITTED");
    return mapper.writeValueAsString(payload);
}
```

Apa yang diukur?

- object mapper creation;
- payload creation;
- serialization.

Jika production memakai singleton `ObjectMapper`, benchmark ini salah.

Lebih baik:

```java
@State(Scope.Thread)
public class JsonState {
    ObjectMapper mapper;
    CasePayload payload;

    @Setup(Level.Trial)
    public void setup() {
        mapper = new ObjectMapper();
        payload = new CasePayload("CASE-001", "SUBMITTED");
    }
}

@Benchmark
public String serialize(JsonState state) throws Exception {
    return state.mapper.writeValueAsString(state.payload);
}
```

Tetapi jika production membuat payload baru setiap request, payload allocation mungkin memang harus terukur.

Jadi desain benchmark bergantung pada pertanyaan:

```text
Apakah saya ingin mengukur serialization only?
Atau request handling end-to-end termasuk DTO creation?
```

Pattern:

```text
Pisahkan benchmark:
1. serialization only
2. payload creation only
3. creation + serialization
```

Dengan begitu kita tahu kontribusi masing-masing cost.

---

## 7. Pitfall #5 — Salah Memilih Scope State

JMH menyediakan beberapa scope penting:

- `Scope.Thread`
- `Scope.Benchmark`
- `Scope.Group`

Kesalahan scope dapat membuat benchmark tidak realistis.

### 7.1 `Scope.Thread`

Setiap worker thread punya state sendiri.

Cocok untuk:

- pure computation;
- per-thread buffer;
- object yang tidak shared di production;
- menghindari contention palsu.

```java
@State(Scope.Thread)
public class ThreadLocalState {
    PermissionEvaluator evaluator;
    PermissionRequest request;
}
```

### 7.2 `Scope.Benchmark`

Semua thread berbagi state yang sama.

Cocok untuk mengukur:

- contention;
- shared cache;
- shared map;
- shared counter;
- lock;
- connection pool simulation;
- shared rate limiter.

```java
@State(Scope.Benchmark)
public class SharedState {
    ConcurrentHashMap<String, PermissionDecision> cache;
}
```

### 7.3 Kesalahan umum

Benchmark cache dengan `Scope.Thread`:

```java
@State(Scope.Thread)
public class WrongCacheState {
    ConcurrentHashMap<String, String> cache;
}
```

Jika production cache shared across threads, benchmark ini terlalu optimis karena contention hilang.

Benchmark pure computation dengan `Scope.Benchmark`:

```java
@State(Scope.Benchmark)
public class WrongPureState {
    MutableInput input;
}
```

Jika input mutable dan shared, benchmark bisa mengukur contention palsu.

Rule:

```text
State scope harus mengikuti sharing semantics production.
```

---

## 8. Pitfall #6 — Unrealistic Branch Profile

JVM melakukan profile-guided optimization. Artinya, branch probability dan receiver type yang muncul saat warmup dapat mempengaruhi compiled code.

Contoh salah:

```java
@Benchmark
public boolean wrongBranch() {
    return service.isAllowed(new User("ADMIN"));
}
```

Jika input selalu admin, branch authorization selalu true.

Production mungkin:

```text
ADMIN       5%
SUPERVISOR 20%
OFFICER    60%
GUEST      15%
```

Benchmark dengan 100% admin membentuk branch profile yang palsu.

Lebih baik:

```java
@State(Scope.Thread)
public class AuthState {
    PermissionRequest[] requests;
    int index;

    @Setup
    public void setup() {
        requests = buildWeightedRequests();
    }

    PermissionRequest next() {
        PermissionRequest r = requests[index];
        index++;
        if (index == requests.length) {
            index = 0;
        }
        return r;
    }
}

@Benchmark
public boolean isAllowed(AuthState state) {
    return state.service.isAllowed(state.next());
}
```

Namun weighted cyclic array juga punya pattern yang bisa dipelajari CPU branch predictor. Jika perlu, gunakan shuffled dataset besar.

```java
@Setup
public void setup() {
    requests = buildWeightedRequests();
    Collections.shuffle(Arrays.asList(requests), new Random(12345));
}
```

Seed fixed penting untuk reproducibility.

Design pattern:

```text
Use representative input distribution.
Use deterministic seed.
Avoid fully random per invocation if random generation cost pollutes measurement.
Pre-generate data in setup.
Measure baseline input access if operation is tiny.
```

---

## 9. Pitfall #7 — Receiver Type Profile Palsu

JVM mengoptimalkan virtual dispatch berdasarkan tipe konkret yang terlihat saat runtime.

Contoh:

```java
interface PolicyRule {
    boolean allows(Request request);
}
```

Production punya beberapa implementasi:

```text
RoleRule
StatusRule
OwnershipRule
TimeWindowRule
DelegationRule
```

Benchmark salah:

```java
@Benchmark
public boolean wrong() {
    PolicyRule rule = new RoleRule();
    return rule.allows(request);
}
```

JIT melihat hanya satu receiver type: `RoleRule`. Dispatch bisa di-inline sangat agresif.

Production mungkin polymorphic atau megamorphic.

Benchmark lebih representatif:

```java
@State(Scope.Thread)
public class RuleState {
    PolicyRule[] rules;
    Request request;
    int index;

    @Setup
    public void setup() {
        rules = new PolicyRule[] {
            new RoleRule(),
            new StatusRule(),
            new OwnershipRule(),
            new TimeWindowRule(),
            new DelegationRule()
        };
        request = Request.sample();
    }

    PolicyRule nextRule() {
        PolicyRule rule = rules[index];
        index = (index + 1) % rules.length;
        return rule;
    }
}

@Benchmark
public boolean evaluateRule(RuleState state) {
    return state.nextRule().allows(state.request);
}
```

Tetapi ini mengukur dispatch + rule. Jika ingin mengukur rule logic only, buat benchmark terpisah per rule.

Decision matrix:

| Pertanyaan | Desain benchmark |
|---|---|
| Seberapa cepat satu rule tertentu? | One concrete type |
| Seberapa cepat policy engine production? | Representative polymorphic mix |
| Apakah polymorphism mahal? | Compare monomorphic vs polymorphic vs megamorphic |
| Apakah sealed class/pattern matching membantu? | Compare implementation variants dengan workload sama |

---

## 10. Pitfall #8 — Allocation Benchmark yang Tidak Jelas

Banyak benchmark hanya melihat `ns/op`, padahal problem sebenarnya allocation.

Contoh:

```java
@Benchmark
public Decision evaluate() {
    return evaluator.evaluate(request);
}
```

Output:

```text
Benchmark        Mode  Cnt   Score   Error  Units
evaluate         avgt   15  85.123 ± 2.100  ns/op
```

Angka ini tidak menunjukkan allocation.

Tambahkan GC profiler:

```bash
java -jar target/benchmarks.jar -prof gc
```

Output bisa menampilkan:

```text
evaluate:·gc.alloc.rate.norm    192.000 B/op
```

Interpretasi:

```text
Setiap operasi mengalokasikan sekitar 192 byte.
Jika endpoint memanggil operasi ini 50 kali per request,
dan traffic 5k request/detik,
allocation rate ≈ 192 * 50 * 5000 = 48 MB/s.
```

Allocation rate bisa lebih penting daripada latency kecil.

Masalah allocation benchmark:

- escape analysis bisa menghapus allocation;
- object bisa scalar replaced;
- benchmark isolated lebih optimis daripada production;
- return object bisa mencegah elimination tetapi juga mengubah escape behavior;
- `Blackhole.consume()` bisa mempengaruhi escape.

Jadi interpretasi allocation harus hati-hati.

Pattern:

```text
1. Jalankan JMH dengan -prof gc.
2. Bandingkan B/op antar implementasi.
3. Validasi dengan JFR allocation profile di scenario lebih realistis.
4. Jangan langsung optimize allocation jika tidak muncul di production telemetry.
```

---

## 11. Pitfall #9 — Benchmark IO, DB, dan Network dengan JMH secara Naif

JMH bisa menjalankan benchmark IO, tetapi microbenchmark IO sering misleading.

Contoh:

```java
@Benchmark
public User findUser() {
    return repository.findById("U001");
}
```

Jika ini benar-benar query DB:

- hasil dipengaruhi DB cache;
- network latency;
- connection pool;
- transaction isolation;
- disk state;
- database plan;
- noisy neighbors;
- container network;
- server load;
- prepared statement cache;
- driver behavior.

JMH bukan tool utama untuk DB performance test.

Kapan JMH boleh untuk DB-related code?

- mengukur SQL builder;
- mengukur row mapper pure Java;
- mengukur parameter binding object creation;
- mengukur JSON conversion sebelum persist;
- mengukur in-memory query predicate;
- mengukur batching logic tanpa DB.

Untuk DB actual performance, gunakan:

- integration benchmark;
- database-specific load test;
- query plan analysis;
- realistic dataset;
- repeated cold/warm cache comparison;
- connection pool metrics;
- DB wait event;
- production telemetry.

Pattern:

```text
JMH untuk CPU-bound Java-side cost.
Load/integration test untuk IO-bound system behavior.
```

---

## 12. Pitfall #10 — Measuring Logging secara Salah

Logging benchmark sering salah karena logging punya banyak mode:

- disabled log statement;
- enabled log statement;
- parameterized logging;
- string concatenation;
- async appender;
- sync appender;
- JSON encoder;
- MDC;
- exception stack trace;
- file IO;
- stdout in container.

Benchmark salah:

```java
@Benchmark
public void wrong() {
    log.debug("Case " + caseId + " status " + status);
}
```

Jika debug disabled, string concatenation tetap terjadi.

Lebih baik bandingkan:

```java
@Benchmark
public void concatDisabled(LogState s) {
    s.logger.debug("Case " + s.caseId + " status " + s.status);
}

@Benchmark
public void parameterizedDisabled(LogState s) {
    s.logger.debug("Case {} status {}", s.caseId, s.status);
}
```

Tapi jangan klaim ini sebagai full logging performance jika appender tidak realistis.

Untuk logging production, ukur:

- allocation;
- JSON encoding cost;
- async queue saturation;
- dropped events;
- disk/stdout throughput;
- MDC cost;
- exception stack trace cost.

Logging performance decision:

```text
Disabled debug log: JMH cocok.
JSON logging under high throughput: component/load test lebih cocok.
```

---

## 13. Pitfall #11 — Benchmark Exception secara Tidak Realistis

Exception performance sangat bergantung pada stack trace capture.

Contoh:

```java
@Benchmark
public void throwException() {
    try {
        throw new IllegalArgumentException("invalid");
    } catch (IllegalArgumentException ignored) {
    }
}
```

Ini mengukur cost membuat exception baru dan menangkapnya.

Tetapi production mungkin:

- membuat exception untuk validation failure;
- membuat exception dengan cause;
- logging stack trace;
- mapping exception ke API response;
- tidak mengisi stack trace untuk domain error;
- memakai result object instead of exception.

Benchmark yang lebih berguna:

```java
@Benchmark
public ErrorResponse exceptionPath(ExceptionState s) {
    try {
        s.validator.validate(s.invalidCommand);
        throw new AssertionError("unreachable");
    } catch (ValidationException e) {
        return s.mapper.toResponse(e);
    }
}
```

Tetapi ini masih micro.

Guideline:

```text
Jangan gunakan exception untuk normal hot path control flow.
Jika exception terjadi jarang, benchmark exception mungkin tidak penting.
Jika exception terjadi sering karena validation, ukur cost end-to-end error mapping.
Jika stack trace di-log, ukur logging cost juga.
```

---

## 14. Pitfall #12 — False Sharing dalam Benchmark Multithread

False sharing terjadi ketika beberapa thread menulis ke variable berbeda tetapi berada di cache line yang sama.

Contoh benchmark counter salah:

```java
@State(Scope.Benchmark)
public class CounterState {
    long[] counters = new long[8];
}

@Benchmark
@Threads(8)
public void increment(CounterState state, ThreadParams params) {
    state.counters[params.getThreadIndex()]++;
}
```

Masing-masing thread menulis index berbeda, tetapi elemen array berdekatan di memory. Ini bisa menyebabkan cache line bouncing.

Jika production memang punya false sharing, benchmark bagus untuk membuktikan problem. Jika tidak, benchmark ini bisa membuat conclusion salah.

Solusi jika ingin menghindari false sharing:

- gunakan padding;
- gunakan `@Contended` dengan JVM flag yang sesuai;
- gunakan per-thread state;
- gunakan LongAdder untuk shared counter scenario.

Contoh `Scope.Thread`:

```java
@State(Scope.Thread)
public class PerThreadCounter {
    long value;
}

@Benchmark
@Threads(8)
public long increment(PerThreadCounter state) {
    return ++state.value;
}
```

Tetapi benchmark ini bukan shared counter.

Design question:

```text
Apakah saya mengukur local per-thread counter,
shared counter,
atau false-sharing-sensitive layout?
```

---

## 15. Pitfall #13 — Benchmark Thread Pool dan Virtual Thread secara Salah

Java 21 membawa virtual threads sebagai fitur final. Java 25 tetap relevan untuk workload modern berbasis virtual thread. Tetapi benchmark virtual thread sering salah.

Contoh salah:

```java
@Benchmark
public void wrongVirtualThread() throws Exception {
    Thread.startVirtualThread(() -> doNothing()).join();
}
```

Ini mengukur create + schedule + join untuk satu virtual thread. Mungkin bukan workload production.

Virtual thread berguna terutama untuk blocking IO concurrency, bukan untuk mempercepat CPU-bound computation.

Benchmark yang lebih bermakna:

1. startup cost virtual thread;
2. blocking simulation cost;
3. throughput request handler dengan blocking dependency simulated;
4. pinning scenario;
5. comparison platform thread pool vs virtual threads untuk blocking workload.

Contoh simulated blocking yang masih hati-hati:

```java
@Benchmark
public void manyBlockingTasks(ExecutorState state) throws Exception {
    List<Future<Integer>> futures = new ArrayList<>();
    for (int i = 0; i < state.taskCount; i++) {
        futures.add(state.executor.submit(() -> {
            state.blocker.block();
            return 1;
        }));
    }
    int sum = 0;
    for (Future<Integer> future : futures) {
        sum += future.get();
    }
    state.blackhole.consume(sum);
}
```

Namun benchmark semacam ini sudah mendekati component benchmark. JMH bisa menjalankannya, tetapi interpretasi harus dikaitkan dengan:

- task count;
- blocking duration;
- executor lifecycle;
- carrier thread availability;
- OS scheduling;
- container CPU;
- memory;
- pinning.

Rule:

```text
Jangan benchmark virtual thread seperti CPU primitive.
Virtual thread adalah concurrency model, bukan arithmetic operation.
```

---

## 16. Pitfall #14 — Benchmark Collections dengan Dataset Tidak Representatif

Contoh pertanyaan buruk:

```text
ArrayList vs LinkedList mana lebih cepat?
```

Pertanyaan ini terlalu umum.

Pertanyaan lebih baik:

```text
Untuk daftar 20 sampai 200 permission rule,
yang diiterasi penuh per request tanpa random insert/delete,
apakah ArrayList memberi latency dan allocation lebih baik daripada LinkedList?
```

Benchmark collection harus memperhatikan:

- ukuran dataset;
- access pattern;
- mutation pattern;
- key distribution;
- hash collision;
- load factor;
- iteration order;
- memory locality;
- concurrency;
- resize cost;
- pre-sizing;
- duplicate ratio.

Contoh HashMap benchmark yang salah:

```java
@Benchmark
public Object wrong() {
    Map<String, Object> map = new HashMap<>();
    map.put("a", 1);
    map.put("b", 2);
    return map.get("a");
}
```

Ini mengukur map allocation + put + get, bukan lookup.

Pisahkan:

```java
@State(Scope.Thread)
public class MapState {
    Map<String, Object> map;
    String[] keys;
    int index;

    @Setup
    public void setup() {
        map = new HashMap<>(1024);
        keys = new String[1000];
        for (int i = 0; i < 1000; i++) {
            String key = "KEY-" + i;
            keys[i] = key;
            map.put(key, i);
        }
    }

    String nextKey() {
        String key = keys[index];
        index = (index + 1) % keys.length;
        return key;
    }
}

@Benchmark
public Object lookup(MapState state) {
    return state.map.get(state.nextKey());
}
```

Jika ingin mengukur map building:

```java
@Benchmark
public Map<String, Object> buildMap(MapBuildState state) {
    Map<String, Object> map = new HashMap<>(state.size * 2);
    for (EntryData entry : state.entries) {
        map.put(entry.key(), entry.value());
    }
    return map;
}
```

Jangan campur lookup dan construction kecuali production memang melakukan keduanya di hot path.

---

## 17. Pitfall #15 — Benchmark Stream vs Loop secara Dangkal

Stream vs loop adalah benchmark yang sering viral tetapi sering tidak berguna.

Benchmark buruk:

```java
@Benchmark
public int stream() {
    return List.of(1, 2, 3).stream()
        .filter(x -> x > 1)
        .mapToInt(x -> x * 2)
        .sum();
}
```

Masalah:

- list sangat kecil;
- data constant;
- result predictable;
- tidak mewakili production;
- Java version matters;
- operation terlalu trivial;
- allocation tidak dilihat;
- branch distribution tidak ada.

Benchmark yang lebih berguna:

```java
@Param({"10", "100", "1000", "10000"})
int size;

@Param({"0.1", "0.5", "0.9"})
double matchRatio;
```

Bandingkan:

- loop imperative;
- stream sequential;
- stream with primitive specialization;
- parallel stream jika benar-benar relevan;
- preallocated result list jika collecting.

Metrics:

- ns/op;
- B/op;
- GC alloc rate;
- variance.

Conclusion harus contextual:

```text
Untuk size <= 100 dan hot path 100k ops/s, loop mengurangi allocation dan latency.
Untuk size besar dan operasi berat, overhead stream tidak signifikan.
Parallel stream tidak cocok di request path karena common pool contention.
```

---

## 18. Pitfall #16 — Benchmark Serialization tanpa Payload Matrix

Serialization cost sangat tergantung pada payload.

Payload dimension:

- small vs medium vs large;
- flat vs nested;
- null-heavy vs full;
- list size;
- BigDecimal;
- date/time;
- enum;
- polymorphic type;
- unknown property;
- pretty print;
- custom serializer;
- afterburner/blackbird/module optimization;
- byte array vs string;
- input encoding.

Benchmark salah:

```java
@Benchmark
public String serializeOnePayload() throws Exception {
    return mapper.writeValueAsString(SamplePayload.small());
}
```

Benchmark lebih baik:

```java
@Param({"SMALL", "MEDIUM", "LARGE", "NESTED", "NULL_HEAVY"})
String payloadKind;
```

Pisahkan:

- serialization to `String`;
- serialization to `byte[]`;
- deserialization from `String`;
- deserialization from `byte[]`;
- object creation;
- validation after deserialization.

Jika production API menggunakan Jackson singleton, jangan create mapper per invocation.

Jika production membuat mapper per request, itu bug desain yang benchmark bisa tunjukkan.

---

## 19. Pitfall #17 — Benchmark Regex dengan Pattern Compile Ikut Terukur

Contoh salah:

```java
@Benchmark
public boolean wrongRegex() {
    return Pattern.compile("[A-Z]{3}-\\d{6}")
        .matcher("ABC-123456")
        .matches();
}
```

Ini mengukur compile + match.

Jika production pattern precompiled:

```java
@State(Scope.Thread)
public class RegexState {
    Pattern pattern;
    String value;

    @Setup
    public void setup() {
        pattern = Pattern.compile("[A-Z]{3}-\\d{6}");
        value = "ABC-123456";
    }
}

@Benchmark
public boolean match(RegexState state) {
    return state.pattern.matcher(state.value).matches();
}
```

Jika production memang compile dynamic regex, benchmark compile separately.

Also measure invalid cases:

```text
valid input
invalid prefix
invalid length
invalid suffix
long adversarial input
```

Regex performance bisa berubah drastis pada adversarial input karena backtracking.

---

## 20. Pitfall #18 — Benchmark Cache tanpa Hit/Miss Ratio

Cache performance sangat bergantung pada:

- hit ratio;
- miss cost;
- eviction;
- key distribution;
- value size;
- concurrency;
- TTL;
- loader behavior;
- stampede protection;
- serialization;
- memory pressure.

Benchmark salah:

```java
@Benchmark
public Object cacheGet(CacheState state) {
    return state.cache.get("always-hit");
}
```

Ini hanya mengukur best-case hit.

Benchmark lebih realistis:

```java
@Param({"0.50", "0.90", "0.99"})
double hitRatio;

@Param({"UNIFORM", "ZIPFIAN"})
String distribution;
```

Tetapi JMH tidak selalu cocok untuk cache system dengan remote dependency.

Untuk local cache CPU cost, JMH cocok.

Untuk Redis/memcached/network cache, gunakan component/load test.

Cache benchmark checklist:

```text
Apakah hit/miss ratio realistis?
Apakah key distribution realistis?
Apakah value size realistis?
Apakah concurrency realistis?
Apakah miss loader ikut diukur?
Apakah eviction terjadi?
Apakah memory pressure diamati?
Apakah B/op dan GC diukur?
```

---

## 21. Pitfall #19 — Benchmark Locking tanpa Contention Model

Lock benchmark harus menjawab:

- uncontended lock cost;
- contended lock cost;
- read-heavy vs write-heavy;
- critical section size;
- fairness;
- number of threads;
- state sharing;
- lock hold time.

Benchmark salah:

```java
@Benchmark
public int wrongLock() {
    synchronized (this) {
        return counter++;
    }
}
```

Jika benchmark state per thread, lock tidak contended.

Benchmark contended:

```java
@State(Scope.Benchmark)
public class LockState {
    final Object lock = new Object();
    int counter;
}

@Benchmark
@Threads(8)
public int contended(LockState state) {
    synchronized (state.lock) {
        return ++state.counter;
    }
}
```

Benchmark uncontended:

```java
@State(Scope.Thread)
public class LocalLockState {
    final Object lock = new Object();
    int counter;
}

@Benchmark
@Threads(8)
public int uncontended(LocalLockState state) {
    synchronized (state.lock) {
        return ++state.counter;
    }
}
```

Both are valid for different questions.

Also compare:

- `synchronized`;
- `ReentrantLock`;
- `StampedLock`;
- `ReadWriteLock`;
- `AtomicLong`;
- `LongAdder`.

But do not pick winner blindly. `LongAdder` is good for high-write counters but not for exact immediate read semantics.

---

## 22. Pitfall #20 — Benchmark Atomic/CAS tanpa Failure Rate

CAS performance depends on contention and failure rate.

Benchmark single-thread CAS:

```java
@Benchmark
public int singleThreadCas(AtomicState state) {
    return state.atomic.incrementAndGet();
}
```

This measures mostly uncontended atomic increment.

Contended CAS:

```java
@Benchmark
@Threads(8)
public int contendedCas(SharedAtomicState state) {
    return state.atomic.incrementAndGet();
}
```

CAS loop benchmark:

```java
public int update() {
    while (true) {
        int current = value.get();
        int next = transform(current);
        if (value.compareAndSet(current, next)) {
            return next;
        }
    }
}
```

Under contention, failure retries matter.

Track:

- throughput;
- latency variance;
- CPU usage;
- failed CAS counter if instrumented;
- scalability by thread count.

Design pattern:

```text
Benchmark atomics across thread counts:
1, 2, 4, 8, 16, 32
```

Then observe scaling curve.

---

## 23. Pitfall #21 — Benchmark Optional, Record, Lambda, Method Reference secara Ideologis

Modern Java introduces constructs that trigger emotional performance debates:

- `Optional`
- lambda
- method reference
- stream
- record
- sealed class
- pattern matching
- varhandle
- method handle

Benchmark harus menjawab actual risk, bukan ideologi.

Contoh `Optional` benchmark yang lebih baik:

```text
Apakah Optional allocation muncul di hot path permission evaluation pada Java 17/21/25?
Apakah escape analysis menghapus allocation?
Apakah B/op berbeda dari null-check approach?
Apakah readability tradeoff worth it?
```

Run with:

```bash
java -jar target/benchmarks.jar OptionalBenchmark -prof gc
```

Jika `B/op = 0`, maka allocation mungkin eliminated pada benchmark tersebut. Tetapi validate di production-like profile.

Conclusion yang baik:

```text
Dalam benchmark isolated ini, Optional tidak mengalokasikan pada Java 21 karena escape analysis.
Namun pada path yang melewati interface boundary / collection / field storage, allocation bisa muncul.
Jadi Optional aman untuk local return-flow yang tidak berada di ultra-hot path,
tetapi jangan gunakan Optional sebagai field atau collection element tanpa alasan kuat.
```

---

## 24. Pitfall #22 — Benchmark Date/Time tanpa Zone dan Formatter Model

Date/time performance tergantung pada:

- `Instant` vs `LocalDateTime` vs `ZonedDateTime`;
- timezone;
- formatter creation;
- parsing vs formatting;
- locale;
- strictness;
- string length;
- invalid input;
- legacy `Date`/`Calendar` interop.

Benchmark salah:

```java
@Benchmark
public String wrong() {
    return DateTimeFormatter.ISO_INSTANT.format(Instant.now());
}
```

Ini mengukur time retrieval + format.

Jika ingin format fixed instant:

```java
@State(Scope.Thread)
public class TimeState {
    Instant instant = Instant.parse("2026-06-16T00:00:00Z");
    DateTimeFormatter formatter = DateTimeFormatter.ISO_INSTANT;
}

@Benchmark
public String format(TimeState state) {
    return state.formatter.format(state.instant);
}
```

Jika production uses current time, measure separately:

```java
@Benchmark
public Instant now() {
    return clock.instant();
}
```

Do not create formatter per invocation unless production does.

---

## 25. Pitfall #23 — Benchmark BigDecimal tanpa Precision/Scale Realism

BigDecimal cost depends on:

- number of digits;
- scale;
- MathContext;
- rounding;
- string construction;
- double constructor mistake;
- operation type;
- normalization;
- comparison by value vs equals.

Benchmark wrong:

```java
@Benchmark
public BigDecimal wrong() {
    return new BigDecimal("1.23").multiply(new BigDecimal("4.56"));
}
```

This measures parsing + multiplication.

Better:

```java
@State(Scope.Thread)
public class MoneyState {
    BigDecimal amount;
    BigDecimal rate;
    MathContext mc;

    @Setup
    public void setup() {
        amount = new BigDecimal("123456789.1234");
        rate = new BigDecimal("0.075");
        mc = new MathContext(20, RoundingMode.HALF_UP);
    }
}

@Benchmark
public BigDecimal multiply(MoneyState state) {
    return state.amount.multiply(state.rate, state.mc);
}
```

For regulatory/financial/case-fee systems, correctness is more important than raw speed. Benchmark cannot justify unsafe numeric shortcuts.

---

## 26. Pitfall #24 — Benchmark Security/Crypto secara Berbahaya

Crypto benchmark can mislead or encourage unsafe choices.

Do not benchmark crypto to justify weak algorithm.

Safe benchmark questions:

- cost of PBKDF2/bcrypt/scrypt/Argon2 parameter under target latency;
- TLS handshake cost in macro scenario;
- signature verification throughput;
- JWT validation cost with realistic key and claim set;
- secure random generation cost in proper context.

Unsafe questions:

```text
MD5 vs SHA-256 mana lebih cepat untuk password?
```

Wrong framing. MD5 is not acceptable for password hashing.

Performance is subordinate to security requirement.

Benchmark pattern:

```text
Security constraint first.
Then benchmark acceptable configurations.
```

Example:

```text
Given approved algorithms A/B/C,
which configuration meets security policy and p95 login latency budget?
```

---

## 27. Benchmark Design Pattern #1 — Baseline Benchmark

Baseline benchmark measures overhead not belonging to target operation.

Example:

```java
@Benchmark
public PermissionRequest baselineNext(RequestState state) {
    return state.next();
}

@Benchmark
public boolean evaluate(RequestState state) {
    return state.evaluator.isAllowed(state.next());
}
```

Use baseline to understand input selection cost.

But be careful:

```text
Do not mechanically subtract noisy benchmark results.
Use baseline as context.
```

Good report:

```text
Input selection baseline: ~5 ns/op.
Evaluator benchmark: ~80 ns/op.
Input access is small relative to operation.
```

Bad report:

```text
Evaluator exact cost is 75 ns/op.
```

Because exact subtraction may be statistically invalid.

---

## 28. Benchmark Design Pattern #2 — Parameter Matrix

Use `@Param` to test multiple dimensions.

Example:

```java
@Param({"10", "100", "1000", "10000"})
int size;

@Param({"0.1", "0.5", "0.9"})
double matchRatio;
```

Good for:

- collection size;
- payload size;
- hit ratio;
- thread count;
- rule count;
- validation complexity;
- string length;
- JSON depth.

But beware combinatorial explosion.

If you have:

```text
5 sizes * 4 ratios * 3 implementations * 5 forks * 10 iterations
```

Benchmark suite becomes expensive.

Pattern:

```text
Use broad matrix locally.
Use reduced representative matrix in CI.
Use full matrix nightly or manually.
```

---

## 29. Benchmark Design Pattern #3 — Implementation Shootout with Shared Workload

When comparing implementations, everything except implementation must be identical.

Bad:

```java
@Benchmark
public Result oldImpl() {
    return oldService.evaluate(Request.small());
}

@Benchmark
public Result newImpl() {
    return newService.evaluate(Request.large());
}
```

Good:

```java
@State(Scope.Thread)
public class WorkloadState {
    Request[] requests;
    OldEvaluator oldEvaluator;
    NewEvaluator newEvaluator;
    int index;

    @Setup
    public void setup() {
        requests = RequestDataset.realistic();
        oldEvaluator = new OldEvaluator();
        newEvaluator = new NewEvaluator();
    }

    Request next() {
        Request request = requests[index];
        index = (index + 1) % requests.length;
        return request;
    }
}

@Benchmark
public Decision oldImpl(WorkloadState state) {
    return state.oldEvaluator.evaluate(state.next());
}

@Benchmark
public Decision newImpl(WorkloadState state) {
    return state.newEvaluator.evaluate(state.next());
}
```

Even better: verify correctness equivalence separately.

```java
@Test
void oldAndNewEvaluatorShouldProduceSameDecisionForDataset() {
    for (Request request : RequestDataset.realistic()) {
        assertThat(newEvaluator.evaluate(request))
            .isEqualTo(oldEvaluator.evaluate(request));
    }
}
```

Benchmark without correctness equivalence is dangerous.

---

## 30. Benchmark Design Pattern #4 — Allocation Guard

Use JMH with GC profiler to detect allocation regression.

Example command:

```bash
java -jar target/benchmarks.jar PermissionBenchmark -prof gc -rf json -rff results.json
```

Track:

- `gc.alloc.rate.norm` / B/op;
- `gc.alloc.rate` / MB/sec;
- `gc.count`;
- `gc.time`.

Useful for:

- mapper regression;
- stream/collector change;
- string building;
- JSON transformation;
- validation result object creation;
- logging path;
- authorization matrix evaluation.

But remember:

```text
0 B/op in JMH does not guarantee 0 allocation in production.
JIT context and escape behavior may differ.
```

Use JFR allocation profile for validation.

---

## 31. Benchmark Design Pattern #5 — Scalability Curve

For concurrent algorithms, single number is not enough.

Run across threads:

```text
1, 2, 4, 8, 16, 32
```

Metrics:

- throughput;
- average latency;
- tail latency if available;
- CPU;
- allocation;
- lock contention;
- failed CAS;
- GC.

Example JMH options:

```java
@Threads(1)
@Benchmark
public void oneThread() {}
```

But better use CLI:

```bash
java -jar target/benchmarks.jar CounterBenchmark -t 1
java -jar target/benchmarks.jar CounterBenchmark -t 2
java -jar target/benchmarks.jar CounterBenchmark -t 4
java -jar target/benchmarks.jar CounterBenchmark -t 8
```

Interpretation:

```text
Good concurrent implementation often shows increasing throughput until saturation.
Bad implementation may collapse under contention.
```

Do not choose implementation based only on single-thread performance if production is concurrent.

---

## 32. Benchmark Design Pattern #6 — Representative Dataset Builder

A serious benchmark should have explicit dataset construction.

Example:

```java
final class PermissionWorkloadFactory {
    static PermissionRequest[] create(long seed, int size, double adminRatio, double deniedRatio) {
        Random random = new Random(seed);
        PermissionRequest[] requests = new PermissionRequest[size];

        for (int i = 0; i < size; i++) {
            requests[i] = createOne(random, adminRatio, deniedRatio);
        }

        return requests;
    }
}
```

Good workload factory properties:

- deterministic seed;
- documented distribution;
- realistic dimensions;
- easy parameterization;
- no random generation inside benchmark invocation;
- can be reused by correctness tests;
- can generate edge-case dataset.

Document workload:

```text
Dataset:
- 10,000 permission requests
- 5% admin
- 25% supervisor
- 55% officer
- 15% guest
- 20% denied
- 10% cross-division
- 2% expired delegation
Seed: 20260616
```

This makes benchmark reviewable.

---

## 33. Benchmark Design Pattern #7 — Correctness Oracle Before Benchmark

Benchmark must not compare wrong implementation.

Before benchmarking optimized implementation:

```java
@Test
void optimizedEvaluatorShouldMatchReferenceEvaluator() {
    PermissionRequest[] requests = PermissionWorkloadFactory.create(
        20260616L,
        10_000,
        0.05,
        0.20
    );

    for (PermissionRequest request : requests) {
        assertThat(optimized.evaluate(request))
            .as("request %s", request.id())
            .isEqualTo(reference.evaluate(request));
    }
}
```

Pattern:

```text
Reference implementation:
  simple, readable, obviously correct, maybe slower.
Optimized implementation:
  faster, more complex.
Correctness oracle:
  both produce same output across representative dataset.
Benchmark:
  only after equivalence test passes.
```

This is especially important for:

- authorization;
- workflow transition;
- fee calculation;
- SLA calculation;
- validation;
- deduplication;
- sorting;
- search ranking.

---

## 34. Benchmark Design Pattern #8 — Regression Benchmark

A benchmark used for design exploration is different from benchmark used for regression guard.

Exploration benchmark:

- broad matrix;
- many implementations;
- manually inspected;
- exploratory profiling;
- loose threshold.

Regression benchmark:

- stable workload;
- stable environment;
- selected critical scenarios;
- historical baseline;
- controlled threshold;
- stored result artifact.

Regression benchmark should answer:

```text
Did this change make known hot path meaningfully worse?
```

Not:

```text
What is the fastest possible implementation ever?
```

Regression threshold should include tolerance.

Example:

```text
Fail if p95 score regresses by > 10% over baseline
and allocation regresses by > 32 B/op
for two consecutive benchmark runs.
```

Do not fail CI on tiny ns differences in noisy environment.

---

## 35. Benchmark Design Pattern #9 — Profiling-Aware Benchmark

Benchmark tells you **what** changed. Profiler helps explain **why**.

Run JMH with profilers:

```bash
java -jar target/benchmarks.jar MyBenchmark -prof gc
```

Common profiler integrations include:

- `gc`;
- `stack`;
- async-profiler integration depending on setup;
- perfasm on suitable Linux environments.

Use profiling when:

- benchmark result surprising;
- optimization seems too good;
- allocation unexpected;
- variance high;
- CPU hot path unclear;
- inlining behavior suspected;
- branch profile suspected.

Benchmark without profiling can lead to cargo-cult optimization.

---

## 36. Benchmark Design Pattern #10 — Benchmark Report Template

A top-tier benchmark should be reported with context.

Template:

```md
# Benchmark Report: Permission Evaluator Rule Dispatch

## Question
Does replacing reflection-based rule dispatch with precompiled strategy objects reduce latency and allocation in permission evaluation?

## Context
This path is called during every case view and case action authorization check.
Production traffic estimates 5k-20k evaluations/sec during peak.

## Environment
- Java: 21.0.x
- JVM: HotSpot
- OS: Linux x86_64
- CPU: ...
- Memory: ...
- Container: yes/no
- JMH: ...

## Workload
- 10,000 pre-generated requests
- seed: 20260616
- 5 rule implementations
- role distribution: ...
- denied ratio: ...

## Benchmarks
- referenceReflection
- strategyDispatch
- precomputedDecisionTable

## Metrics
- ns/op
- B/op
- variance
- GC allocation rate

## Result Summary
...

## Interpretation
...

## Limitations
...

## Decision
...

## Follow-up Validation
- JFR in staging load test
- endpoint-level load test
- production canary metric
```

This is how benchmark becomes engineering evidence.

---

## 37. Case Study: Permission Evaluation Benchmark

Suppose we have a regulatory case system with permission checks.

Every API request may call:

```java
PermissionDecision evaluate(User user, CaseRecord caseRecord, Action action)
```

Old implementation:

- uses list of rules;
- some reflection-based checks;
- creates intermediate objects;
- logs debug message;
- uses stream pipeline.

New implementation:

- precompiled rules;
- avoids reflection;
- uses loop;
- caches role-action mapping;
- returns enum-based decision.

### 37.1 Correctness test first

```java
@Test
void optimizedEvaluatorShouldMatchReferenceEvaluator() {
    PermissionRequest[] requests = PermissionWorkloadFactory.create(
        20260616L,
        50_000,
        0.05,
        0.20
    );

    for (PermissionRequest request : requests) {
        assertThat(optimized.evaluate(request))
            .as("request=%s", request.id())
            .isEqualTo(reference.evaluate(request));
    }
}
```

### 37.2 Benchmark state

```java
@State(Scope.Thread)
public class PermissionBenchmarkState {
    @Param({"100", "10000", "50000"})
    int datasetSize;

    PermissionRequest[] requests;
    int index;

    ReferencePermissionEvaluator reference;
    OptimizedPermissionEvaluator optimized;

    @Setup(Level.Trial)
    public void setup() {
        requests = PermissionWorkloadFactory.create(
            20260616L,
            datasetSize,
            0.05,
            0.20
        );
        reference = new ReferencePermissionEvaluator();
        optimized = new OptimizedPermissionEvaluator();
    }

    PermissionRequest next() {
        PermissionRequest request = requests[index];
        index++;
        if (index == requests.length) {
            index = 0;
        }
        return request;
    }
}
```

### 37.3 Benchmark methods

```java
@Benchmark
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
public PermissionDecision reference(PermissionBenchmarkState state) {
    return state.reference.evaluate(state.next());
}

@Benchmark
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
public PermissionDecision optimized(PermissionBenchmarkState state) {
    return state.optimized.evaluate(state.next());
}
```

### 37.4 Run with allocation profile

```bash
java -jar target/benchmarks.jar PermissionEvaluatorBenchmark \
  -wi 10 -i 10 -f 3 \
  -prof gc \
  -rf json \
  -rff permission-benchmark.json
```

### 37.5 Good interpretation

Good:

```text
Optimized evaluator reduced average time by ~35% on the representative dataset
and reduced normalized allocation from 240 B/op to 48 B/op.
This is relevant because permission evaluation appears in JFR allocation profile
and is called multiple times per request.
Next step: validate under endpoint-level load test.
```

Bad:

```text
Loop is always better than stream.
Reflection is always slow.
We should rewrite all code.
```

Engineering discipline means narrow conclusion.

---

## 38. Java 8 hingga 25 Compatibility Notes

### 38.1 Java 8

Relevant characteristics:

- older JIT behavior compared with modern JDKs;
- different default GC landscape;
- no records;
- no varhandle;
- no virtual threads;
- older stream optimizations;
- older compact string behavior absent before Java 9;
- older container awareness limitations;
- many enterprise systems still run Java 8.

Benchmark implication:

```text
Do not assume Java 17/21 benchmark result applies to Java 8.
```

### 38.2 Java 11

Relevant characteristics:

- common migration baseline;
- G1 default;
- compact strings from Java 9 era;
- better container support than Java 8;
- different TLS/string/collection/runtime performance.

### 38.3 Java 17

Relevant characteristics:

- major LTS baseline;
- records and sealed classes available;
- stronger modern JIT/runtime baseline;
- many modern libraries target Java 17.

### 38.4 Java 21

Relevant characteristics:

- virtual threads final;
- generational ZGC available;
- modern performance baseline;
- common next-generation enterprise runtime.

### 38.5 Java 25

Relevant characteristics:

- current modern documentation baseline for this series;
- use official JDK 25 docs/release notes for flags and runtime behavior;
- library compatibility may require Java 17+ or newer.

Compatibility strategy:

```text
If supporting Java 8 and 17+:
  benchmark both if performance decision affects shared library.

If deploying Java 21/25 only:
  optimize based on modern JVM behavior, not Java 8 folklore.

If upgrading JVM:
  rerun critical JMH benchmarks and load tests.
```

---

## 39. How to Reject a Benchmark Result

Reject or distrust benchmark result if:

1. no warmup/fork;
2. no result consumption;
3. constant input;
4. no dataset distribution;
5. no Java/JVM version;
6. no hardware/container information;
7. only one run;
8. huge variance ignored;
9. GC/allocation ignored for allocation-sensitive path;
10. benchmark mixes setup and operation accidentally;
11. branch profile unrealistic;
12. receiver type profile unrealistic;
13. correctness equivalence not proven;
14. measurement target not tied to production bottleneck;
15. conclusion broader than evidence.

A benchmark result is not wrong just because imperfect. But the decision must be proportional to evidence quality.

```text
Weak benchmark → maybe useful as signal.
Strong benchmark → useful as local evidence.
Strong benchmark + profile + load test → useful as decision evidence.
```

---

## 40. Benchmark Review Checklist

Use this checklist in code review.

### 40.1 Question

```text
[ ] What question does this benchmark answer?
[ ] Why does this operation matter?
[ ] Is this path hot in production or expected to become hot?
[ ] What decision will be made from this result?
```

### 40.2 Correctness

```text
[ ] Is there a correctness test for benchmarked implementations?
[ ] Are old and new implementation outputs equivalent?
[ ] Are edge cases included?
```

### 40.3 Workload

```text
[ ] Is input representative?
[ ] Is dataset size realistic?
[ ] Is branch distribution realistic?
[ ] Is receiver type distribution realistic?
[ ] Is random seed fixed?
[ ] Is input generation outside measured invocation?
```

### 40.4 JMH Setup

```text
[ ] Uses @State correctly?
[ ] Uses correct Scope?
[ ] Uses @Setup level correctly?
[ ] Uses fork?
[ ] Uses warmup?
[ ] Uses measurement iteration?
[ ] Uses suitable benchmark mode?
[ ] Uses suitable time unit?
```

### 40.5 Measurement Integrity

```text
[ ] Result returned or consumed?
[ ] DCE avoided?
[ ] Constant folding avoided?
[ ] Loop placement intentional?
[ ] Setup cost excluded unless intended?
[ ] Allocation measured if relevant?
[ ] Variance inspected?
```

### 40.6 Interpretation

```text
[ ] Does conclusion match scope of benchmark?
[ ] Are limitations documented?
[ ] Is follow-up validation needed?
[ ] Is result compared across relevant Java versions?
[ ] Is raw result artifact stored?
```

---

## 41. Common Anti-Patterns

### 41.1 “JMH Says X, Therefore Always X”

Wrong:

```text
JMH says loop is faster, therefore never use streams.
```

Better:

```text
In this hot path, with this dataset and Java version, loop reduces allocation and latency enough to justify less declarative code.
```

### 41.2 Benchmarking Before Profiling

Wrong:

```text
Let's benchmark random suspected methods.
```

Better:

```text
Use JFR/async-profiler/load test to identify hot path, then benchmark alternative implementation.
```

### 41.3 Benchmarking Without Correctness

Wrong:

```text
New version is faster.
```

Missing question:

```text
Is it still correct?
```

### 41.4 Ignoring Allocation

Wrong:

```text
Only 20 ns slower, no problem.
```

But if allocation goes from 0 B/op to 512 B/op in high-QPS path, it may matter.

### 41.5 Ignoring Tail Behavior

JMH average time does not automatically show production tail latency.

If operation affects request path under concurrency, validate with load test.

### 41.6 Benchmarking Remote Dependencies with Microbenchmark Mentality

Wrong:

```text
Redis GET is 0.3 ms in my JMH benchmark.
```

Remote dependency latency must be tested with realistic network, pool, concurrency, and failure conditions.

### 41.7 Optimizing Non-Hot Code

Wrong:

```text
This admin export runs once per day but stream is slower; rewrite it.
```

Performance engineering is resource allocation. Optimize where it matters.

---

## 42. Practical Decision Framework

Before accepting benchmark-driven optimization, ask:

```text
1. Is the code on a hot path?
2. Is the benchmark workload representative?
3. Is the result stable enough?
4. Is the improvement practically significant?
5. Is correctness preserved?
6. Does readability/maintainability cost increase?
7. Does the change affect security/regulatory behavior?
8. Does profiling support the same conclusion?
9. Does load test support the same conclusion?
10. Is rollback easy?
```

Optimization should not be accepted just because benchmark improves.

Example tradeoff:

```text
A custom parser is 15% faster than Jackson for one payload,
but it is harder to maintain and more likely to mishandle compatibility.
If JSON parsing is not top bottleneck, reject optimization.
```

Another example:

```text
A precomputed authorization matrix is 4x faster and reduces allocation 90%,
while preserving correctness through oracle tests.
Permission check is in every request.
Accept optimization, but add benchmark regression and authorization invariant tests.
```

---

## 43. Mini-Lab: Fix Broken Benchmarks

### 43.1 Broken benchmark 1

```java
@Benchmark
public void test() {
    new ObjectMapper().writeValueAsString(payload);
}
```

Problems:

- result unused;
- mapper creation included;
- checked exception omitted in snippet;
- payload source unclear;
- no state;
- possible DCE or exception behavior issue.

Fixed:

```java
@State(Scope.Thread)
public class JsonState {
    ObjectMapper mapper;
    CasePayload payload;

    @Setup(Level.Trial)
    public void setup() {
        mapper = new ObjectMapper();
        payload = CasePayload.medium();
    }
}

@Benchmark
public String serialize(JsonState state) throws Exception {
    return state.mapper.writeValueAsString(state.payload);
}
```

### 43.2 Broken benchmark 2

```java
@Benchmark
public boolean auth() {
    return evaluator.isAllowed(adminUser, action);
}
```

Problems:

- branch always admin;
- no role distribution;
- no case status distribution;
- no denial scenario;
- not representative.

Fixed:

```java
@Benchmark
public boolean auth(AuthState state) {
    PermissionRequest request = state.next();
    return state.evaluator.isAllowed(request.user(), request.caseRecord(), request.action());
}
```

With dataset distribution documented.

### 43.3 Broken benchmark 3

```java
@Benchmark
public void cache() {
    cache.get("same-key");
}
```

Problems:

- same key always hit;
- no hit/miss ratio;
- no key distribution;
- result unused;
- no concurrency model.

Fixed:

```java
@Benchmark
public Object cacheGet(CacheState state) {
    return state.cache.get(state.nextKey());
}
```

With `@Param` for hit ratio and distribution.

---

## 44. Final Mental Model

A good benchmark has four layers:

```text
Question layer:
  What decision are we trying to make?

Workload layer:
  Does this input resemble the real workload enough?

Measurement layer:
  Is the measurement protected from JVM and harness pitfalls?

Interpretation layer:
  Does the conclusion stay within the evidence boundary?
```

Most bad benchmarks fail in question layer or workload layer, not in JMH syntax.

The top-tier Java engineer does not ask:

```text
How do I make this benchmark show my code is faster?
```

They ask:

```text
What evidence would convince a skeptical reviewer that this change improves the real system without breaking correctness, maintainability, or operability?
```

---

## 45. Summary

Pada part ini kita membahas:

- dead-code elimination;
- constant folding;
- loop placement;
- setup cost;
- state scope;
- branch profile;
- receiver type profile;
- allocation benchmarking;
- IO/DB/network benchmarking limitation;
- logging benchmark;
- exception benchmark;
- false sharing;
- virtual thread benchmark;
- collection benchmark;
- stream vs loop benchmark;
- serialization benchmark;
- regex benchmark;
- cache benchmark;
- locking benchmark;
- atomic benchmark;
- Optional/lambda/record benchmark;
- date/time benchmark;
- BigDecimal benchmark;
- security/crypto benchmark safety;
- baseline pattern;
- parameter matrix;
- implementation shootout;
- allocation guard;
- scalability curve;
- representative dataset;
- correctness oracle;
- regression benchmark;
- profiling-aware benchmark;
- benchmark report template.

Key takeaway:

```text
JMH is necessary for serious JVM microbenchmarking,
but not sufficient for serious performance engineering.
```

Benchmark yang kuat harus menggabungkan:

- pertanyaan yang jelas;
- workload realistis;
- measurement sahih;
- correctness proof;
- profiler evidence;
- interpretation yang tidak berlebihan;
- follow-up validation di level system.

---

## 46. Status Seri

Seri: `learn-java-testing-benchmarking-performance-jvm`  
Part selesai: `018` dari `031`  
Status: **belum selesai**

Part berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-019.md
```

Topik berikutnya:

```text
Macrobenchmark, Load Test, Stress Test, Soak Test, dan Capacity Test
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-testing-benchmarking-performance-jvm-part-017.md">⬅️ JMH Deep Dive I: Harness, State, Scope, Mode, Warmup, Measurement</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-testing-benchmarking-performance-jvm-part-019.md">Macrobenchmark, Load Test, Stress Test, Soak Test, dan Capacity Test ➡️</a>
</div>
