# learn-java-testing-benchmarking-performance-jvm-part-020

# Part 020 — JVM Execution Model: Interpreter, JIT, Tiered Compilation, Code Cache, Deoptimization

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Rentang versi: Java 8 sampai Java 25  
> Fokus: memahami bagaimana JVM mengeksekusi program Java, mengapa performa berubah selama runtime, bagaimana JIT mengambil keputusan, dan bagaimana insight ini dipakai untuk benchmark, profiling, tuning, serta review kode production.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah masuk ke benchmarking, JMH, dan macrobenchmark. Sekarang kita mundur satu lapis lebih dalam: **apa yang sebenarnya terjadi di JVM ketika bytecode Java berjalan**.

Banyak engineer bisa menjalankan JMH, membaca throughput, atau mengubah `-Xmx`, tetapi gagal memahami pertanyaan yang lebih fundamental:

- Kenapa benchmark Java butuh warmup?
- Kenapa method yang sama bisa lambat di awal lalu cepat setelah beberapa detik?
- Kenapa performance bisa turun setelah deploy walaupun tidak ada perubahan query/database?
- Kenapa kode yang terlihat lebih “simple” bisa lebih lambat?
- Kenapa polymorphism, reflection, lambda, exception, logging, dan allocation bisa memengaruhi JIT?
- Kenapa service yang baru start sering belum mencapai peak throughput?
- Kenapa p99 latency bisa spike saat code cache penuh, deoptimization, GC, atau compilation backlog?
- Kenapa hasil benchmark kecil tidak selalu mewakili aplikasi nyata?

Part ini membangun mental model bahwa HotSpot JVM bukan sekadar “menjalankan bytecode”. JVM modern adalah runtime adaptif yang melakukan observasi, interpretasi, profiling, kompilasi, optimisasi spekulatif, invalidasi, deoptimisasi, dan manajemen native code secara terus-menerus.

Tujuan praktis setelah menyelesaikan part ini:

1. Mampu menjelaskan pipeline eksekusi JVM dari `.java` sampai native machine code.
2. Mampu memahami peran interpreter, C1 compiler, C2 compiler, tiered compilation, profiling, dan code cache.
3. Mampu membaca gejala awal dari JIT-related performance issue.
4. Mampu membedakan masalah warmup, GC, allocation, lock contention, IO, database, dan JIT.
5. Mampu mendesain benchmark yang tidak tertipu oleh JIT optimization.
6. Mampu memakai diagnostic flag seperti `-XX:+PrintCompilation`, `-Xlog:jit+compilation`, `jcmd Compiler.*`, dan JITWatch secara aman.
7. Mampu memahami implikasi Java 8–25 terhadap runtime behavior.

---

## 2. Mental Model Besar: JVM sebagai Runtime Adaptif

Model naïf:

```text
Java source code -> bytecode -> JVM executes bytecode
```

Model yang lebih benar:

```text
.java source
  -> javac compiles to .class bytecode
  -> JVM loads classes
  -> verifier checks safety
  -> interpreter starts execution
  -> JVM collects runtime profile
  -> hot methods / hot loops detected
  -> JIT compiler compiles hot code to native code
  -> JVM speculatively optimizes based on observed profile
  -> compiled code stored in code cache
  -> assumptions may later break
  -> JVM deoptimizes and falls back / recompiles
```

JVM HotSpot adalah **adaptive optimizing VM**. Artinya, JVM tidak mengoptimalkan semua kode sejak awal. JVM mengamati program saat berjalan, mencari bagian yang sering dieksekusi, lalu menghabiskan biaya kompilasi hanya untuk bagian yang dianggap layak.

Ini sangat masuk akal secara ekonomi runtime:

```text
Tidak semua method penting.
Tidak semua branch sering dilewati.
Tidak semua type receiver muncul di runtime.
Tidak semua object benar-benar perlu dialokasi di heap.
Tidak semua lock mengalami contention.
Tidak semua call perlu tetap virtual selamanya.
```

JIT mencoba menjawab:

```text
Bagian mana yang cukup panas sehingga biaya kompilasi layak dibayar?
Optimisasi apa yang aman berdasarkan profile saat ini?
Asumsi apa yang bisa dibuat, dan bagaimana rollback jika asumsi itu salah?
```

Konsekuensinya, performance Java bersifat **runtime-shaped**, bukan hanya source-code-shaped.

---

## 3. Dari Source Code ke Bytecode ke Execution

### 3.1 `javac` Menghasilkan Bytecode, Bukan Native Code

Ketika kita menulis:

```java
public final class PriceCalculator {
    public long total(long unitPrice, int quantity) {
        return unitPrice * quantity;
    }
}
```

`javac` menghasilkan `.class` berisi bytecode. Bytecode ini platform-independent.

Secara kasar bytecode-nya bisa seperti:

```text
0: lload_1
1: iload_3
2: i2l
3: lmul
4: lreturn
```

Bytecode bukan machine code CPU. Bytecode adalah instruksi untuk JVM.

### 3.2 Class Loading

Saat class dibutuhkan, JVM melakukan:

```text
loading
  -> linking
      -> verification
      -> preparation
      -> resolution
  -> initialization
```

Secara performance, class loading dapat memengaruhi:

- startup time,
- first request latency,
- memory/metaspace,
- framework-heavy aplikasi seperti Spring/Jakarta,
- reflection-heavy code,
- dynamic proxy,
- annotation scanning,
- generated classes,
- classloader leak.

Part ini fokus pada execution model, tetapi penting diingat: sebelum JIT mengoptimalkan method, class harus dimuat, diverifikasi, dan tersedia.

---

## 4. Interpreter: Titik Masuk Eksekusi

### 4.1 Apa Itu Interpreter?

Interpreter menjalankan bytecode langsung. Ia membaca instruksi bytecode dan mengeksekusinya satu per satu.

Model sederhana:

```text
for each bytecode instruction:
    decode instruction
    execute instruction
    move to next instruction
```

Interpreter memiliki kelebihan:

- startup cepat,
- tidak perlu menunggu kompilasi,
- cocok untuk kode yang hanya dieksekusi sedikit,
- dapat mengumpulkan profiling information untuk JIT.

Tetapi interpreter lebih lambat daripada native compiled code karena setiap instruksi bytecode perlu melalui overhead interpretasi.

### 4.2 Kenapa Tidak Semua Code Langsung Dikompilasi?

Karena kompilasi itu mahal.

Jika aplikasi punya ribuan method, tetapi hanya sebagian kecil yang sering dipakai, mengompilasi semuanya di awal akan membuang CPU dan memperlambat startup.

JVM memilih strategi adaptif:

```text
Cold code  -> interpreted
Warm code  -> compiled with lighter optimization
Hot code   -> compiled with aggressive optimization
```

### 4.3 Implikasi untuk Aplikasi Production

Pada startup service:

```text
first few requests:
  class loading + interpretation + profiling + early compilation

steady state:
  hot path already compiled and optimized
```

Karena itu first-request latency sering berbeda dari steady-state latency.

Untuk service latency-sensitive, ini penting untuk:

- readiness probe,
- warmup endpoint,
- canary rollout,
- load balancer traffic ramp-up,
- benchmark warmup,
- autoscaling cold start,
- serverless/container restart behavior.

---

## 5. HotSpot, Hot Code, dan Profiling

HotSpot mendapatkan namanya dari prinsip: **optimalkan hot spots**.

Hot code bisa berupa:

- method yang sering dipanggil,
- loop yang sangat sering berputar,
- allocation site yang sering muncul,
- virtual call site yang receiver type-nya stabil,
- branch yang sangat bias ke satu arah.

JVM mengumpulkan runtime profile seperti:

- invocation count,
- backedge count untuk loop,
- branch frequency,
- type profile di virtual/interface call,
- null check behavior,
- exception behavior,
- lock behavior,
- allocation pattern.

Profiling ini dipakai oleh JIT untuk membuat keputusan.

Contoh:

```java
interface FeePolicy {
    long calculate(long amount);
}

final class FixedFeePolicy implements FeePolicy {
    public long calculate(long amount) {
        return amount + 1000;
    }
}

final class PercentageFeePolicy implements FeePolicy {
    public long calculate(long amount) {
        return amount + amount / 100;
    }
}
```

Secara source code:

```java
long result = policy.calculate(amount);
```

Itu interface call.

Tetapi jika runtime profile menunjukkan bahwa 99.9% receiver adalah `FixedFeePolicy`, JIT bisa membuat optimized path berdasarkan asumsi itu.

Secara mental:

```text
Observed receiver type mostly FixedFeePolicy
  -> inline FixedFeePolicy.calculate
  -> remove virtual dispatch on hot path
  -> optimize arithmetic
  -> add guard if receiver changes
```

Jika kemudian receiver type berubah drastis, asumsi bisa gagal dan JVM perlu deoptimize/recompile.

---

## 6. JIT Compiler: C1 dan C2

HotSpot historically memiliki dua JIT compiler utama:

```text
C1 -> client compiler / lower optimization / faster compile
C2 -> server compiler / higher optimization / slower compile
```

### 6.1 C1 Compiler

C1 berfokus pada:

- compile cepat,
- startup lebih baik,
- cukup optimisasi untuk code yang mulai hangat,
- profiling support untuk tahap berikutnya.

C1 biasanya tidak melakukan optimisasi sedalam C2.

### 6.2 C2 Compiler

C2 berfokus pada:

- peak throughput,
- aggressive optimization,
- inlining,
- escape analysis,
- scalar replacement,
- loop optimization,
- speculative optimization,
- advanced register allocation.

C2 lebih mahal dari sisi CPU compile time, tetapi menghasilkan machine code yang lebih optimal.

### 6.3 Kenapa Ini Penting?

Jika aplikasi:

- short-lived,
- serverless,
- CLI cepat,
- batch pendek,
- test suite,
- command-line tool,

mungkin tidak sempat menikmati C2 peak optimization.

Jika aplikasi:

- long-running API service,
- worker service,
- high-throughput stream processor,
- latency-sensitive platform,

C2 optimization sangat penting untuk steady-state performance.

---

## 7. Tiered Compilation

Tiered compilation menggabungkan kelebihan interpreter, C1, dan C2.

Model sederhana:

```text
Level 0: Interpreter
Level 1: C1 simple compilation
Level 2: C1 limited profiling
Level 3: C1 full profiling
Level 4: C2 optimized compilation
```

Tidak semua detail level selalu penting dalam operasi harian, tetapi mental model-nya penting:

```text
JVM does not jump directly from bytecode to best native code.
It moves through tiers as code becomes hotter and profile becomes richer.
```

### 7.1 Kenapa Tiered Compilation Dibutuhkan?

Tanpa tiering:

- interpretasi terlalu lambat untuk hot code,
- kompilasi agresif semua code terlalu mahal,
- compiler butuh profile untuk membuat optimisasi yang tepat.

Dengan tiering:

```text
early execution:
  start fast with interpreter

warm execution:
  C1 compiles quickly and gathers profile

hot execution:
  C2 uses profile to produce optimized native code
```

### 7.2 Implikasi terhadap Benchmark

Benchmark yang terlalu pendek bisa hanya mengukur:

- interpreter,
- C1 compiled code,
- compilation overhead,
- class loading,
- profile building,

bukan steady-state C2-optimized code.

Karena itu JMH punya konsep:

- warmup iterations,
- measurement iterations,
- fork,
- profiler,
- result distribution.

### 7.3 Implikasi terhadap Production

Service yang baru deploy mungkin mengalami:

```text
startup
  -> cold path interpreted
  -> compilation activity rises
  -> CPU partially used by compiler threads
  -> latency unstable
  -> eventually reaches steady state
```

Jika traffic langsung penuh setelah rollout, service dapat mengalami degraded p99 sebelum warmup selesai.

Mitigasi umum:

- readiness delay yang realistis,
- warmup traffic,
- canary ramp-up,
- avoid restarting all pods simultaneously,
- avoid autoscaling oscillation,
- preserve traffic ramp discipline.

---

## 8. Compilation Threshold dan Hotness

JVM memutuskan kapan method atau loop cukup hot untuk dikompilasi.

Sumber sinyal:

- method invocation count,
- loop backedge count,
- profiling data maturity,
- compilation queue pressure,
- tiered policy,
- JVM flags,
- CPU/compiler thread availability.

Contoh loop:

```java
long sum = 0;
for (int i = 0; i < values.length; i++) {
    sum += values[i];
}
```

Loop seperti ini dapat menjadi hot walaupun method-nya tidak terlalu sering dipanggil, karena backedge count tinggi.

### 8.1 Kenapa Tidak Perlu Sembarangan Mengubah Threshold?

Flag compilation threshold sering menggoda:

```text
-XX:CompileThreshold=...
```

Tetapi mengubah threshold tanpa diagnosis bisa menyebabkan:

- compile terlalu dini dengan profile miskin,
- compile terlalu banyak method yang tidak penting,
- code cache pressure,
- CPU compile overhead,
- peak performance turun,
- latency spike.

Default JVM modern biasanya lebih baik daripada tuning spekulatif.

---

## 9. Inlining: Optimisasi Paling Penting

Inlining adalah proses mengganti method call dengan body method yang dipanggil.

Dari:

```java
long total(Order order) {
    return calculateSubtotal(order) + calculateTax(order);
}
```

Menjadi mental model:

```java
long total(Order order) {
    // body calculateSubtotal inline here
    // body calculateTax inline here
}
```

### 9.1 Kenapa Inlining Sangat Penting?

Inlining bukan hanya menghilangkan call overhead. Yang lebih penting: inlining membuka pintu untuk optimisasi lanjutan.

Setelah method di-inline, JIT dapat melakukan:

- constant propagation,
- dead code elimination,
- bounds check elimination,
- escape analysis,
- scalar replacement,
- lock elision,
- branch simplification,
- loop optimization.

Inlining adalah “gateway optimization”.

### 9.2 Contoh

```java
final class Money {
    private final long cents;

    Money(long cents) {
        this.cents = cents;
    }

    long cents() {
        return cents;
    }
}

long plus(Money a, Money b) {
    return a.cents() + b.cents();
}
```

Jika `cents()` di-inline, JIT dapat melihat field access langsung.

### 9.3 Batas Inlining

JIT tidak bisa meng-inline semuanya. Ada batas:

- method terlalu besar,
- call site terlalu polymorphic/megamorphic,
- bytecode size terlalu besar,
- recursion,
- insufficient profile,
- class not loaded/resolved,
- uncommon trap risk,
- code cache pressure.

### 9.4 Engineering Implication

Jangan membuat method besar dan bercabang kompleks di hot path jika bisa dipisah secara sehat. Tetapi jangan juga micro-method berlebihan tanpa alasan. JVM modern sangat baik meng-inline method kecil, terutama `final`, private, static, dan monomorphic call.

Prinsip:

```text
Write clear code first.
Measure hot path.
Only reshape code after evidence.
```

---

## 10. Virtual Call, Interface Call, dan Type Profile

Java banyak memakai dynamic dispatch:

```java
PaymentHandler handler = resolveHandler(type);
handler.handle(command);
```

Dari sisi source, ini fleksibel. Dari sisi JIT, performanya tergantung type profile.

### 10.1 Monomorphic Call Site

Satu receiver type dominan:

```text
handler.handle always sees BankTransferHandler
```

JIT bisa meng-inline dengan mudah.

### 10.2 Bimorphic Call Site

Dua receiver type dominan:

```text
BankTransferHandler
CreditCardHandler
```

JIT masih bisa membuat optimized dispatch untuk dua tipe.

### 10.3 Megamorphic Call Site

Banyak receiver type:

```text
HandlerA, HandlerB, HandlerC, HandlerD, HandlerE, ...
```

JIT sulit meng-inline. Call site menjadi lebih mahal dan optimisasi lanjutan berkurang.

### 10.4 Relevance untuk Enterprise Java

Banyak framework membuat dynamic dispatch:

- Spring proxy,
- CDI proxy,
- JAX-RS resource dispatch,
- Hibernate proxy,
- dynamic mapper,
- strategy registry,
- reflection adapter,
- event listener list,
- authorization evaluator chain.

Ini bukan berarti framework buruk. Tetapi hot path yang terlalu proxy-heavy dan megamorphic bisa sulit dioptimalkan.

### 10.5 Pattern yang Lebih JIT-Friendly

Untuk hot path yang sangat sering:

- hindari registry lookup berulang jika bisa cache resolved strategy,
- hindari chain terlalu panjang untuk common path,
- pisahkan cold validation/error path dari hot path,
- gunakan stable receiver type untuk critical loop,
- hindari membuat setiap request menghasilkan anonymous/lambda shape yang berbeda secara tidak perlu.

Tetapi tetap ukur dulu.

---

## 11. Speculative Optimization

JIT sering mengoptimalkan berdasarkan asumsi runtime.

Contoh asumsi:

```text
This call site has only one receiver type.
This branch almost always true.
This null check almost never fails.
This class hierarchy has no new subtype loaded yet.
This allocation does not escape.
This lock is uncontended.
```

Optimisasi spekulatif aman karena JVM punya mekanisme rollback: **deoptimization**.

### 11.1 Kenapa Spekulasi Penting?

Tanpa spekulasi, JVM harus selalu membuat code yang aman untuk semua kemungkinan. Itu lambat.

Dengan spekulasi:

```text
Common case fast.
Rare case guarded.
If assumption breaks, deoptimize.
```

### 11.2 Contoh Branch Bias

```java
if (user.isActive()) {
    process(user);
} else {
    reject(user);
}
```

Jika 99.99% user active, JIT bisa optimize common path.

Tapi jika saat load test data berubah menjadi 50/50, branch profile berubah dan performance bisa berbeda.

Ini salah satu alasan benchmark harus memakai distribusi data realistis.

---

## 12. Deoptimization

Deoptimization terjadi ketika compiled code tidak lagi valid atau tidak lagi ideal karena asumsi JIT gagal.

Contoh penyebab:

- class baru dimuat yang mengubah class hierarchy,
- receiver type profile berubah,
- uncommon branch tiba-tiba sering terjadi,
- exception path menjadi common,
- method invalidated,
- dependency assumption broken,
- debugging/instrumentation tertentu,
- OSR transition,
- uncommon trap.

### 12.1 Mental Model

```text
Compiled optimized code
  -> guard detects assumption violation
  -> JVM transfers execution back to interpreter or less optimized code
  -> runtime collects new profile
  -> method may be recompiled with updated assumptions
```

### 12.2 Kenapa Ini Bisa Muncul di Production?

Misal aplikasi authorization service punya 20 policy type, tetapi selama warmup hanya 1 policy type muncul. JIT mengoptimalkan call site sebagai monomorphic.

Lalu saat production traffic penuh, policy type lain mulai muncul. Call site menjadi polymorphic atau megamorphic. JVM perlu deoptimize/recompile.

Gejala bisa berupa:

- CPU spike sesaat,
- latency spike,
- throughput drop sementara,
- compilation activity meningkat,
- code cache pressure,
- p99 tidak stabil setelah traffic pattern berubah.

### 12.3 Benchmark Implication

Benchmark dengan satu jenis input bisa menghasilkan optimized path yang tidak ada di production.

Contoh benchmark buruk:

```java
@Benchmark
public long calculate() {
    return policy.calculate(1000);
}
```

Jika `policy` selalu satu concrete class, benchmark mengukur monomorphic path.

Production mungkin punya 12 policy classes.

Benchmark lebih realistis:

```java
@State(Scope.Thread)
public class PolicyState {
    @Param({"FIXED", "PERCENTAGE", "TIERED"})
    String type;

    FeePolicy policy;

    @Setup
    public void setup() {
        policy = switch (type) {
            case "FIXED" -> new FixedFeePolicy();
            case "PERCENTAGE" -> new PercentageFeePolicy();
            case "TIERED" -> new TieredFeePolicy();
            default -> throw new IllegalArgumentException(type);
        };
    }
}
```

Untuk polymorphic workload, perlu benchmark yang memang memvariasikan receiver type dalam satu call site, bukan hanya parameter per fork.

---

## 13. On-Stack Replacement / OSR

OSR memungkinkan JVM mengganti eksekusi loop yang sedang berjalan dari interpreter ke compiled code.

Contoh:

```java
for (long i = 0; i < 10_000_000_000L; i++) {
    work(i);
}
```

JVM tidak harus menunggu method selesai. Jika loop sangat hot, JVM bisa compile loop dan masuk ke compiled version saat method masih berjalan.

### 13.1 Kenapa OSR Penting?

Tanpa OSR, long-running loop bisa selamanya interpreted sampai method selesai. Dengan OSR, loop panjang bisa dipercepat di tengah eksekusi.

### 13.2 Benchmark Implication

Benchmark yang menaruh loop besar di dalam `@Benchmark` method dapat mencampur:

- loop body cost,
- OSR compilation,
- iteration structure,
- branch profile,
- dead code elimination risk,
- unrealistic hotness.

Itu salah satu alasan JMH biasanya menyarankan tidak membuat loop manual besar di dalam method benchmark kecuali benar-benar paham konsekuensinya.

---

## 14. Code Cache

JIT-compiled native code disimpan di **code cache**.

Code cache bukan Java heap. Ini native memory region untuk compiled code dan runtime stubs.

### 14.1 Kenapa Code Cache Penting?

Jika code cache penuh atau terfragmentasi, JVM bisa gagal mengompilasi method baru.

Gejala:

- warning code cache full,
- compilation disabled,
- throughput turun,
- CPU profile berubah,
- hot method tetap interpreted/C1,
- latency meningkat setelah aplikasi berjalan lama,
- framework-heavy aplikasi menghasilkan banyak compiled methods.

### 14.2 Segmented Code Cache

Modern HotSpot membagi code cache ke beberapa segment untuk jenis code berbeda, misalnya:

- non-method code,
- profiled code,
- non-profiled code.

Tujuannya mengurangi fragmentasi dan mengelola compiled code dengan karakteristik berbeda.

### 14.3 Flag Penting

Contoh flag:

```text
-XX:ReservedCodeCacheSize=256m
-XX:InitialCodeCacheSize=...
```

Tetapi jangan tuning sebelum diagnosis.

Cek dengan:

```bash
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.queue
jcmd <pid> VM.flags
```

Contoh output mental:

```text
CodeHeap 'profiled nmethods': used=...
CodeHeap 'non-profiled nmethods': used=...
CodeHeap 'non-nmethods': used=...
compilation: enabled
```

### 14.4 Code Cache dan Container

Code cache memakai native memory. Jika container memory limit terlalu ketat, masalah memory bukan hanya heap.

Budget memory production perlu memasukkan:

```text
container memory limit
  = heap
  + metaspace
  + code cache
  + thread stacks
  + direct buffers
  + GC/native structures
  + libc/native allocations
  + agents/profilers
  + margin
```

---

## 15. Escape Analysis dan Scalar Replacement

Escape analysis membantu JIT menentukan apakah object benar-benar perlu dialokasi di heap.

Contoh:

```java
record Point(int x, int y) {}

int compute(int a, int b) {
    Point p = new Point(a, b);
    return p.x() + p.y();
}
```

Secara source, ada object `Point`.

Tetapi jika object tidak keluar dari method dan bisa dianalisis, JIT dapat menghilangkan alokasi object dan mengganti field dengan scalar variable.

Mental model:

```text
new Point(a, b)
  -> does not escape
  -> no heap allocation needed
  -> use scalar values directly
```

### 15.1 Bentuk Escape

Object bisa:

```text
No escape      -> only used locally
Arg escape     -> passed to method but not stored globally
Global escape  -> stored in field/static/returned/published
```

Semakin object escape, semakin sulit dieliminasi.

### 15.2 Kenapa Ini Penting?

Kode yang terlihat banyak membuat small object belum tentu buruk jika JIT bisa menghilangkan allocation.

Tetapi allocation elimination bisa gagal jika:

- object disimpan ke field,
- object dikembalikan,
- object masuk collection,
- object dipakai via reflection,
- call tidak bisa di-inline,
- method terlalu besar,
- polymorphism terlalu tinggi,
- profile kurang stabil,
- object crosses synchronization boundary.

### 15.3 Benchmark Trap

Microbenchmark sering menunjukkan allocation nol karena escape analysis, padahal production object escape melalui collection, serialization, logging, atau framework.

Contoh benchmark menipu:

```java
@Benchmark
public int localObject() {
    Money money = new Money(100);
    return money.cents();
}
```

JIT bisa menghilangkan object.

Production:

```java
order.addLine(new Money(100));
repository.save(order);
objectMapper.writeValueAsString(order);
```

Object jelas escape.

---

## 16. Lock Optimization

JIT dan runtime dapat mengoptimalkan synchronization dalam kondisi tertentu.

Contoh:

```java
synchronized (lock) {
    counter++;
}
```

Jika lock tidak contention atau object tidak escape, JVM bisa mengoptimalkan sebagian biaya.

Optimisasi terkait:

- lock elision,
- lock coarsening,
- fast-path locking,
- biased locking di era lama,
- lightweight locking changes di JVM modern.

### 16.1 Jangan Menarik Kesimpulan Lama untuk JVM Baru

Java 8, 11, 17, 21, dan 25 punya perbedaan internal locking dan runtime behavior. Misalnya biased locking yang dulu penting di Java 8 sudah tidak menjadi asumsi yang sama pada versi modern.

Karena itu benchmark lock harus menyebut:

```text
JDK version
VM vendor
flags
CPU
OS
container limit
benchmark mode
contention level
thread count
```

### 16.2 Virtual Threads

Dengan Java 21+, virtual threads mengubah model concurrency application-level, tetapi tidak menghapus kebutuhan memahami:

- blocking vs CPU-bound,
- monitor pinning,
- synchronized hot path,
- carrier thread,
- thread dump interpretation,
- contention.

Virtual thread benchmark harus hati-hati karena membuat jutaan task bukan berarti workload representatif.

---

## 17. Intrinsics

Intrinsic adalah implementasi khusus di JVM untuk method tertentu agar lebih cepat daripada implementasi Java biasa.

Contoh umum:

- `System.arraycopy`,
- beberapa operasi `Math`,
- checksum/crypto tertentu,
- string operations tertentu,
- VarHandle/Unsafe-related operations tertentu.

JVM dapat mengganti call tertentu dengan instruksi CPU atau runtime stub yang sangat optimized.

### 17.1 Engineering Implication

Kadang library JDK lebih cepat dari custom implementation karena JVM mengenali pattern/method tersebut.

Contoh:

```java
System.arraycopy(src, 0, dst, 0, len);
```

biasanya sangat optimized dibanding loop manual untuk copy array.

Prinsip:

```text
Prefer clear JDK primitives unless measurement proves otherwise.
```

---

## 18. Bounds Check Elimination

Java melakukan bounds check untuk array access:

```java
int x = arr[i];
```

Harus dipastikan `i` valid.

Dalam loop tertentu, JIT bisa membuktikan bahwa index selalu dalam range dan menghilangkan check berulang.

Contoh friendly:

```java
int sum(int[] arr) {
    int s = 0;
    for (int i = 0; i < arr.length; i++) {
        s += arr[i];
    }
    return s;
}
```

Contoh kurang friendly:

```java
int sum(int[] arr, int[] indexes) {
    int s = 0;
    for (int i = 0; i < indexes.length; i++) {
        s += arr[indexes[i]];
    }
    return s;
}
```

Yang kedua sulit karena index berasal dari data lain.

### 18.1 Jangan Premature Micro-Optimize

Jangan menulis kode aneh hanya demi bounds check elimination kecuali hot path sudah terbukti. Kode yang jelas sering cukup bagi JIT.

---

## 19. Loop Optimization

JIT dapat melakukan banyak optimisasi loop:

- loop unrolling,
- range check elimination,
- invariant code motion,
- vectorization tertentu,
- strength reduction,
- counted loop optimization,
- unswitching.

Contoh invariant:

```java
for (int i = 0; i < items.length; i++) {
    int taxRate = config.taxRate();
    total += items[i].price() * taxRate;
}
```

Jika `config.taxRate()` bisa dibuktikan stabil dan side-effect-free setelah inline, JIT mungkin memindahkan sebagian kerja keluar loop.

Tetapi jika call tidak bisa di-inline atau punya side effect, JIT tidak bisa sembarangan.

---

## 20. Dead Code Elimination

Dead code elimination menghapus computation yang hasilnya tidak dipakai.

Contoh microbenchmark salah:

```java
@Benchmark
public void wrong() {
    long x = expensiveCalculation();
}
```

Jika `x` tidak digunakan dan calculation bisa dibuktikan tidak punya side effect, JIT bisa menghapusnya.

Benar:

```java
@Benchmark
public long better() {
    return expensiveCalculation();
}
```

atau:

```java
@Benchmark
public void better(Blackhole blackhole) {
    blackhole.consume(expensiveCalculation());
}
```

Ini alasan JMH penting.

---

## 21. Constant Folding dan Constant Propagation

JIT dapat menghitung ekspresi konstan lebih awal.

Contoh benchmark salah:

```java
@Benchmark
public int wrong() {
    return parse("12345");
}
```

Jika terlalu stabil dan predictable, benchmark bisa tidak merepresentasikan input runtime.

Lebih baik gunakan `@Param` atau state yang realistis:

```java
@State(Scope.Thread)
public class ParseState {
    @Param({"12345", "99999", "00001"})
    String input;
}

@Benchmark
public int parseBenchmark(ParseState state) {
    return Integer.parseInt(state.input);
}
```

Tetapi `@Param` pun harus dipakai dengan paham: jika setiap fork hanya satu param, branch profile bisa terlalu bersih dibanding production mix.

---

## 22. Exceptions dan JIT

Exception path biasanya dianggap uncommon path.

Jika exception benar-benar rare, JVM dapat mengoptimalkan common path.

Tetapi jika exception dipakai untuk control flow di hot path, performance bisa buruk.

Contoh buruk:

```java
int parseOrDefault(String value) {
    try {
        return Integer.parseInt(value);
    } catch (NumberFormatException e) {
        return 0;
    }
}
```

Jika mayoritas input invalid, exception menjadi common. Ini mahal karena:

- object exception,
- stack trace,
- uncommon trap profile berubah,
- branch prediction buruk,
- JIT assumptions terganggu.

Lebih baik untuk hot path:

```java
int parseOrDefault(String value) {
    if (!isInteger(value)) {
        return 0;
    }
    return Integer.parseInt(value);
}
```

Tentu validasi manual juga punya biaya. Measure sesuai distribusi data nyata.

---

## 23. Reflection, MethodHandle, Lambda, dan invokedynamic

### 23.1 Reflection

Reflection sering lebih sulit dioptimalkan dibanding direct call karena metadata lookup, access checks, boxing, dan dynamic invocation.

Framework modern banyak mengurangi overhead dengan:

- caching reflective metadata,
- generated bytecode,
- method handles,
- ahead-of-time metadata,
- annotation processing,
- build-time enhancement.

### 23.2 MethodHandle

`MethodHandle` bisa lebih optimizable daripada reflection dalam beberapa kondisi, terutama jika call site stabil.

### 23.3 Lambda dan invokedynamic

Lambda Java memakai `invokedynamic`. Biasanya performanya baik setelah warmup, tetapi behavior tergantung capture, allocation, call site stability, dan inlining.

Contoh allocation-sensitive:

```java
items.stream()
     .map(item -> item.toDto(context))
     .toList();
```

Lambda yang capture `context` dapat membuat object atau call structure tertentu, tergantung optimisasi.

### 23.4 Engineering Advice

Jangan anti-reflection secara dogmatis. Gunakan reflection di boundary/framework/cold path. Hindari reflection di tight hot loop jika direct access atau generated mapper realistis.

---

## 24. Streams vs Loops dari Sudut JIT

Stream API bukan otomatis lambat. Loop bukan otomatis cepat. Performa tergantung:

- workload size,
- allocation,
- lambda capture,
- inlining,
- polymorphism,
- primitive stream vs boxed stream,
- intermediate operation,
- short-circuit,
- parallel stream,
- GC pressure,
- readability requirement.

Contoh potentially expensive:

```java
List<Long> ids = users.stream()
    .map(User::id)
    .filter(Objects::nonNull)
    .collect(Collectors.toList());
```

Untuk small/medium request-level data, readability bisa lebih penting. Untuk huge hot loop, allocation dan boxing bisa matters.

JIT dapat meng-inline banyak stream pipeline, tetapi tidak semua allocation/dispatch hilang.

Benchmark harus representatif:

- ukuran list realistis,
- object shape realistis,
- branch distribution realistis,
- result consumed,
- allocation measured.

---

## 25. Startup, Warmup, dan Steady State

### 25.1 Startup

Startup dipengaruhi oleh:

- class loading,
- class verification,
- framework initialization,
- dependency injection,
- reflection scanning,
- configuration parsing,
- connection pool initialization,
- TLS/client initialization,
- first compilation.

### 25.2 Warmup

Warmup adalah periode saat JVM:

- mengumpulkan profile,
- mengompilasi hot methods,
- melakukan OSR,
- menstabilkan branch/type profile,
- mengisi caches aplikasi,
- menginisialisasi lazy structures.

### 25.3 Steady State

Steady state adalah kondisi ketika:

- hot path sudah optimized,
- compilation activity stabil/rendah,
- caches berada di kondisi realistis,
- GC behavior stabil,
- traffic distribution stabil,
- dependency latency stabil.

### 25.4 Tetapi Steady State Bisa Berubah

Steady state bukan permanen. Bisa berubah karena:

- traffic pattern berubah,
- feature flag aktif,
- class baru dimuat,
- cache invalidation,
- deployment baru,
- dependency behavior berubah,
- data distribution berubah,
- code cache pressure,
- GC regime berubah.

---

## 26. AOT, CDS, dan Java 25 Direction

Selain JIT tradisional, JVM modern juga mengembangkan startup/warmup optimization.

Topik terkait:

- Class Data Sharing / CDS,
- AppCDS,
- AOT class loading/linking,
- AOT cache ergonomics di JDK modern,
- framework AOT seperti Spring AOT,
- GraalVM Native Image sebagai model berbeda.

### 26.1 Jangan Campuradukkan JIT dan Native Image

HotSpot JVM dengan JIT:

```text
runtime observes behavior and optimizes dynamically
```

GraalVM Native Image:

```text
closed-world analysis and ahead-of-time native binary generation
```

Trade-off berbeda:

| Model | Kekuatan | Biaya |
|---|---|---|
| HotSpot JIT | peak throughput adaptif, runtime profile | startup/warmup, memory runtime |
| Native Image | startup cepat, memory lebih kecil | build complexity, dynamic feature constraints, different peak behavior |

Seri ini fokus pada HotSpot JVM Java 8–25, tetapi konsep AOT akan muncul saat membahas JVM configuration dan production profile.

---

## 27. Diagnostic Tools untuk JIT dan Execution Model

### 27.1 `-XX:+PrintCompilation`

Flag klasik untuk melihat compilation activity.

Contoh:

```bash
java -XX:+PrintCompilation -jar app.jar
```

Output bisa berisi method yang dikompilasi, level, dan status.

Untuk Java modern, unified logging juga relevan:

```bash
java -Xlog:jit+compilation=debug -jar app.jar
```

Catatan: tag/logging detail bisa berbeda antar versi/vendor. Selalu validasi di JDK target.

### 27.2 `jcmd`

Command penting:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.queue
jcmd <pid> Compiler.perfmap
```

Tidak semua command tersedia/identik di semua versi. Gunakan:

```bash
jcmd <pid> help
```

### 27.3 JITWatch

JITWatch membantu membaca compilation log dan memahami:

- hot methods,
- inlining decision,
- bytecode,
- assembly view jika tersedia,
- failed inlining reason,
- optimization path.

Typical usage:

```bash
java \
  -XX:+UnlockDiagnosticVMOptions \
  -XX:+LogCompilation \
  -XX:+TraceClassLoading \
  -jar app.jar
```

Lalu buka log di JITWatch.

Flag dapat berbeda antar versi; gunakan hati-hati di production karena log bisa besar.

### 27.4 JFR

Java Flight Recorder dapat memperlihatkan:

- compilation events,
- code cache events,
- method profiling,
- allocation,
- GC,
- safepoints,
- thread states,
- lock contention.

JFR lebih production-friendly daripada compiler log verbose.

---

## 28. Membaca `PrintCompilation` Secara Praktis

Contoh output simplified:

```text
  123   45       3       com.example.FeePolicy::calculate (24 bytes)
  124   46       4       com.example.FeePolicy::calculate (24 bytes)
  125   45       3       com.example.FeePolicy::calculate (24 bytes)   made not entrant
```

Interpretasi kasar:

```text
method compiled at level 3
then compiled at level 4
older compiled version made not entrant
```

`made not entrant` berarti compiled code lama tidak lagi dipakai untuk entry baru, biasanya karena versi lebih baru atau invalidation.

Jangan panik melihat `made not entrant`. Itu normal dalam adaptive VM. Yang mencurigakan adalah churn ekstrem, deoptimization berulang, atau compilation disabled.

---

## 29. JIT-Related Production Symptoms

JIT jarang menjadi root cause pertama yang harus dicurigai. Biasanya cek dulu:

1. error rate,
2. latency percentile,
3. CPU saturation,
4. GC,
5. DB/query,
6. connection pool,
7. thread pool,
8. external dependency,
9. lock contention,
10. allocation profile.

Namun JIT bisa relevan jika terlihat:

- latency buruk hanya setelah cold start,
- p99 spike setelah rollout walau dependency normal,
- CPU tinggi di compiler threads,
- code cache nearly full,
- compilation disabled,
- repeated deoptimization,
- benchmark tidak konsisten antar fork,
- first 5–10 minutes jauh lebih lambat,
- performance berubah saat traffic mix berubah,
- instrumentation/agent baru membuat slowdown.

### 29.1 JIT-Related Investigation Flow

```text
Symptom: latency spike after deploy
  -> Check deployment/startup time correlation
  -> Check CPU and compiler activity
  -> Check JFR compilation/code cache events
  -> Check GC and allocation rate
  -> Check code cache usage with jcmd
  -> Check if traffic warmup/ramp changed
  -> Check new dynamic proxies/reflection/generated classes
  -> Check new polymorphic hot path
  -> Validate with load test + JFR
```

---

## 30. Java 8–25 Compatibility Notes

### 30.1 Java 8

Important characteristics:

- still common in legacy enterprise,
- JIT flags/logging style older,
- GC logging pre-unified logging,
- biased locking historically relevant,
- PermGen already replaced by Metaspace since Java 8,
- JMH still supports older baselines depending version,
- many production systems still on JUnit 4/JUnit 5 compatible setup.

Diagnostics often use:

```text
-XX:+PrintCompilation
-XX:+UnlockDiagnosticVMOptions
-XX:+LogCompilation
-XX:+PrintInlining
```

### 30.2 Java 11

Important as migration baseline:

- unified logging already available,
- G1 default from Java 9 era,
- better container awareness than Java 8 older updates,
- JFR open-sourced in OpenJDK builds from Java 11 era.

### 30.3 Java 17

Important modern LTS baseline:

- strong ecosystem baseline,
- many frameworks target 17+,
- JUnit 6 requires Java 17+,
- improved JIT/runtime/GC over 8/11,
- good production default for many enterprise systems.

### 30.4 Java 21

Important because:

- virtual threads finalized,
- structured concurrency/scoped values in preview/incubator progression depending release,
- generational ZGC introduced in this era,
- new concurrency workload shapes affect profiling and benchmarking.

### 30.5 Java 25

Important because:

- current target in this series,
- JDK 25 reached GA in September 2025,
- additional runtime/performance improvements,
- AOT cache ergonomics and startup/warmup direction matter,
- JVM flags and defaults must be checked against Java 25 docs, not copied from old Java 8 tuning posts.

### 30.6 Practical Rule

Never write performance notes without version stamp:

```text
JDK vendor:
JDK version:
OS:
CPU:
Container limit:
GC:
JVM flags:
Workload:
Warmup:
Measurement duration:
```

Without this, performance conclusion is weak evidence.

---

## 31. Common Anti-Patterns

### 31.1 Measuring Cold Code and Calling It Runtime Performance

Bad:

```text
Run method once.
Measure time.
Conclude implementation A is faster.
```

Why wrong:

- class loading,
- interpretation,
- JIT compilation,
- cache initialization,
- branch profile immature.

### 31.2 Tuning JVM Flags Before Profiling

Bad:

```text
Latency high -> change -XX flags
```

Better:

```text
Latency high
  -> observe p50/p95/p99
  -> check CPU/GC/allocation/thread/DB/pool
  -> profile
  -> identify bottleneck
  -> tune only relevant layer
```

### 31.3 Assuming Source-Level Simplicity Equals Runtime Simplicity

Simple-looking code can hide:

- virtual dispatch,
- boxing,
- allocation,
- reflection,
- lambda capture,
- stream pipeline,
- proxy calls,
- exception path,
- synchronization.

### 31.4 Assuming Native Code Always Faster

JNI/native calls can add overhead:

- boundary crossing,
- copying,
- pinning,
- memory safety risk,
- observability loss.

JDK intrinsics and optimized Java code are often enough.

### 31.5 Benchmarking Unrealistic Type Profile

Bad:

```text
Benchmark one concrete strategy.
Production uses many strategies.
```

This creates unrealistic monomorphic call site.

### 31.6 Treating `made not entrant` as Always Bad

Adaptive recompilation is normal. Investigate only when churn is excessive or correlated with performance issue.

### 31.7 Oversizing Code Cache Blindly

Increasing code cache may hide symptom but not root cause if issue is:

- too many generated classes,
- classloader leak,
- excessive proxy generation,
- instrumentation explosion,
- benchmark framework misuse.

---

## 32. Engineering Patterns

### 32.1 Warmup-Aware Service Rollout

For latency-sensitive services:

```text
Start pod
  -> initialize application
  -> readiness remains false
  -> run internal warmup path
  -> establish connections
  -> optionally exercise common endpoints
  -> readiness true
  -> ramp traffic gradually
```

Caution: warmup must not mutate production state incorrectly.

Use safe warmup:

- read-only endpoint,
- dry-run computation,
- synthetic internal request,
- cache priming if safe,
- no external side-effect,
- no audit pollution unless clearly marked.

### 32.2 Benchmark Realistic Runtime Profile

For strategy/policy code:

```text
Benchmark monomorphic case
Benchmark bimorphic case
Benchmark megamorphic case
Benchmark realistic distribution
Benchmark worst-case distribution
```

This reveals if performance depends on type profile.

### 32.3 Separate Hot Path and Cold Path

Example:

```java
Decision decide(Request request) {
    ValidationResult validation = validate(request);
    if (!validation.ok()) {
        return reject(validation);
    }
    return decideValidated(request);
}
```

Hot path can be `decideValidated` if most requests valid.

Do not overdo this prematurely, but it can help critical services.

### 32.4 Avoid Exception for Expected Invalid Input in Hot Path

Expected invalid data should be modeled as data/control result, not exception, if it is common.

### 32.5 Keep Benchmark Artifacts

For serious benchmark:

```text
jmh-result.json
jvm-version.txt
flags.txt
cpu-info.txt
gc-log.txt
jfr-recording.jfr
flamegraph.html
README.md with workload description
```

Performance result without reproducibility is weak evidence.

---

## 33. Step-by-Step: Investigating Warmup Problem

Scenario:

```text
After deployment, p99 latency is high for 3 minutes.
Then service becomes normal.
No DB issue.
No external dependency issue.
```

Investigation:

### Step 1 — Confirm Time Correlation

Check latency by pod age.

```text
pod_age < 1 min  -> p99 high
pod_age 1-3 min  -> p99 improving
pod_age > 5 min  -> stable
```

### Step 2 — Check CPU and Compilation

Look for compiler activity:

```bash
jcmd <pid> Compiler.queue
jcmd <pid> Compiler.codecache
```

Capture JFR during startup.

### Step 3 — Separate Class Loading vs JIT

If latency occurs only first request per endpoint, class loading/lazy init may dominate.

If latency gradually improves over repeated traffic, JIT warmup likely contributes.

### Step 4 — Load Test With Ramp

Compare:

```text
Scenario A: instant full load
Scenario B: gradual ramp
Scenario C: pre-warm then full load
```

### Step 5 — Decide Mitigation

Possible mitigations:

- traffic ramp-up,
- startup warmup,
- readiness delay,
- avoid cold autoscaling for p99-sensitive route,
- reduce framework lazy initialization,
- evaluate CDS/AOT options,
- avoid restarting all instances simultaneously.

### Step 6 — Validate

Do not claim fixed until p99 improves in controlled test and production rollout.

---

## 34. Step-by-Step: Investigating Code Cache Problem

Scenario:

```text
After several hours, throughput drops.
Logs show code cache warnings.
CPU profile shows more interpreted frames.
```

### Step 1 — Check Code Cache

```bash
jcmd <pid> Compiler.codecache
jcmd <pid> VM.flags | grep CodeCache
```

### Step 2 — Check Compilation Status

```bash
jcmd <pid> Compiler.queue
```

Check logs for:

```text
CodeCache is full
Compiler has been disabled
```

### Step 3 — Identify Cause

Possible causes:

- huge app with many hot methods,
- many generated proxies/classes,
- dynamic class generation leak,
- instrumentation/agent,
- excessive frameworks,
- aggressive compile threshold changes,
- too small `ReservedCodeCacheSize`.

### Step 4 — Capture Evidence

Use JFR and class histogram.

Check:

- class count,
- loaded/unloaded classes,
- metaspace,
- code cache segments,
- deployment changes.

### Step 5 — Fix

Possible fixes:

- increase code cache if justified,
- remove accidental class generation leak,
- reduce instrumentation,
- update JVM if bug/known issue,
- restore default compilation flags,
- split huge service if architectural cause.

---

## 35. Step-by-Step: Benchmarking Polymorphic Dispatch

Goal: compare strategy dispatch cost under different receiver profiles.

### 35.1 Define Interface

```java
public interface DecisionRule {
    boolean allows(Context context);
}
```

### 35.2 Implement Multiple Rules

```java
public final class RoleRule implements DecisionRule {
    public boolean allows(Context context) {
        return context.roles().contains("APPROVER");
    }
}

public final class AmountRule implements DecisionRule {
    public boolean allows(Context context) {
        return context.amount() <= 10_000;
    }
}

public final class RegionRule implements DecisionRule {
    public boolean allows(Context context) {
        return "SG".equals(context.region());
    }
}
```

### 35.3 Benchmark Different Profiles

```java
@State(Scope.Thread)
public class DispatchState {
    @Param({"mono", "bi", "mega"})
    String profile;

    DecisionRule[] rules;
    Context context;
    int index;

    @Setup
    public void setup() {
        context = new Context(Set.of("APPROVER"), 5_000, "SG");

        rules = switch (profile) {
            case "mono" -> new DecisionRule[] {
                new RoleRule(), new RoleRule(), new RoleRule(), new RoleRule()
            };
            case "bi" -> new DecisionRule[] {
                new RoleRule(), new AmountRule(), new RoleRule(), new AmountRule()
            };
            case "mega" -> new DecisionRule[] {
                new RoleRule(), new AmountRule(), new RegionRule(), new CustomRuleA(), new CustomRuleB()
            };
            default -> throw new IllegalArgumentException(profile);
        };
    }

    DecisionRule nextRule() {
        DecisionRule rule = rules[index++ % rules.length];
        return rule;
    }
}

@Benchmark
public boolean dispatch(DispatchState state) {
    return state.nextRule().allows(state.context);
}
```

### 35.4 Interpret

If mono much faster than mega, production strategy registry may need review only if this path is truly hot.

Potential improvements:

- precompute decision where possible,
- group rules by common case,
- reduce receiver diversity in inner loop,
- avoid dynamic rule lookup per item,
- cache compiled decision plan.

But do not sacrifice domain clarity unless evidence proves this matters.

---

## 36. Practical JVM Flags for This Part

### 36.1 Observe Compilation

```bash
java -XX:+PrintCompilation -jar app.jar
```

### 36.2 Observe Inlining

```bash
java \
  -XX:+UnlockDiagnosticVMOptions \
  -XX:+PrintInlining \
  -jar app.jar
```

Usually too noisy for normal production.

### 36.3 Generate Compilation Log for JITWatch

```bash
java \
  -XX:+UnlockDiagnosticVMOptions \
  -XX:+LogCompilation \
  -jar app.jar
```

### 36.4 Check Code Cache

```bash
jcmd <pid> Compiler.codecache
```

### 36.5 Check JVM Flags

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
```

### 36.6 JFR Recording

```bash
jcmd <pid> JFR.start name=profile settings=profile duration=120s filename=recording.jfr
```

---

## 37. Review Checklist untuk Performance Investigation

Gunakan checklist ini sebelum menyimpulkan bahwa masalah ada di JIT/JVM execution model.

```text
[ ] Apakah versi JDK dan vendor diketahui?
[ ] Apakah JVM flags diketahui?
[ ] Apakah masalah terjadi cold start atau steady state?
[ ] Apakah warmup cukup?
[ ] Apakah benchmark memakai JMH dengan fork/warmup yang benar?
[ ] Apakah workload data distribution realistis?
[ ] Apakah type profile realistis?
[ ] Apakah branch distribution realistis?
[ ] Apakah allocation diukur?
[ ] Apakah GC sudah dikesampingkan?
[ ] Apakah DB/external dependency sudah dikesampingkan?
[ ] Apakah thread pool/connection pool sudah dikesampingkan?
[ ] Apakah code cache usage normal?
[ ] Apakah compiler queue normal?
[ ] Apakah JFR menunjukkan compilation/deoptimization spike?
[ ] Apakah instrumentation/agent berubah?
[ ] Apakah ada dynamic class/proxy generation baru?
[ ] Apakah result reproducible di beberapa fork/run?
```

---

## 38. Top 1% Engineer Notes

Engineer biasa bertanya:

```text
Flag JVM apa yang harus saya pakai supaya cepat?
```

Engineer kuat bertanya:

```text
Apa workload-nya?
Apa hot path-nya?
Apakah kita cold atau steady state?
Apa runtime profile-nya?
Apakah call site monomorphic atau megamorphic?
Apakah allocation benar-benar terjadi atau dieliminasi JIT?
Apakah p99 spike karena GC, lock, IO, JIT, atau dependency?
Apa evidence yang membedakan hipotesis tersebut?
```

Engineer top-tier tidak menghafal semua flag. Mereka memahami sistem adaptifnya.

Prinsip penting:

1. **JIT optimizes observed reality, not your intention.**  
   JVM mengoptimalkan berdasarkan runtime profile, bukan berdasarkan apa yang kamu pikir akan terjadi.

2. **Benchmark must model runtime profile.**  
   Kalau benchmark input/type/branch/allocation tidak seperti production, hasilnya hanya berlaku untuk benchmark itu sendiri.

3. **Warmup is not ceremony.**  
   Warmup adalah proses JVM membangun profile dan native code.

4. **Inlining unlocks optimization.**  
   Banyak optimisasi penting baru muncul setelah call boundary hilang.

5. **Deoptimization is normal, churn is suspicious.**  
   Jangan panik melihat deoptimization, tetapi investigasi jika berulang dan berkorelasi dengan latency.

6. **Code cache is native memory.**  
   Jangan sizing container hanya berdasarkan heap.

7. **Clear code first, evidence-based optimization later.**  
   JVM modern sangat baik mengoptimalkan kode Java yang jelas. Kode aneh tanpa evidence sering memperburuk maintainability tanpa benefit nyata.

---

## 39. Mini Case Study: API Latency Naik Setelah Deploy

### 39.1 Symptom

```text
After deployment:
- p50 normal after 1 minute
- p99 high for 5 minutes
- CPU around 65%
- DB normal
- GC normal
- no external dependency spike
```

### 39.2 Bad Conclusion

```text
Increase heap.
Change GC.
Increase replicas.
```

Ini bisa membantu sebagian, tetapi belum tentu root cause.

### 39.3 Better Hypothesis Tree

```text
p99 high after deploy
  ├── cold class loading?
  ├── lazy framework initialization?
  ├── JIT warmup?
  ├── cache cold?
  ├── connection pool cold?
  ├── TLS/client cold?
  ├── compilation queue?
  ├── code cache issue?
  └── traffic ramp too aggressive?
```

### 39.4 Evidence Collection

```bash
jcmd <pid> VM.command_line
jcmd <pid> Compiler.queue
jcmd <pid> Compiler.codecache
jcmd <pid> JFR.start name=startup settings=profile duration=300s filename=startup.jfr
```

Also check:

- app logs for lazy initialization,
- class loading if enabled in lower env,
- first-hit endpoint latency,
- cache metrics,
- connection pool metrics,
- pod age vs latency.

### 39.5 Likely Fix

If evidence confirms warmup and lazy init:

- add safe warmup phase,
- adjust readiness,
- gradual traffic ramp,
- pre-initialize critical components,
- avoid scale-to-zero for critical low-latency service,
- evaluate CDS/AOT options later.

---

## 40. Summary

Di part ini kita membangun fondasi JVM execution model.

Poin terpenting:

- JVM tidak langsung menjalankan Java sebagai native code optimal.
- Eksekusi dimulai dari interpreter.
- JVM mengumpulkan runtime profile.
- Hot code dikompilasi oleh JIT.
- Tiered compilation menggabungkan startup cepat dan peak throughput.
- C1 compile lebih cepat, C2 lebih agresif.
- Inlining adalah gateway untuk banyak optimisasi.
- JIT melakukan speculative optimization berdasarkan runtime profile.
- Jika asumsi gagal, JVM bisa deoptimize dan recompile.
- Compiled native code disimpan di code cache.
- Code cache adalah native memory dan bisa menjadi bottleneck.
- Escape analysis bisa menghilangkan allocation yang terlihat di source code.
- Benchmark harus merepresentasikan runtime profile production.
- Warmup adalah bagian fundamental dari performance Java.
- JVM flags harus dipakai berdasarkan evidence, bukan copy-paste.

Mental model akhir:

```text
Java performance = source code
                 + bytecode shape
                 + runtime profile
                 + JIT decisions
                 + GC behavior
                 + memory layout
                 + OS/container behavior
                 + workload distribution
                 + production traffic reality
```

---

## 41. Referensi

- Oracle Java SE 25 Documentation — `java` command options and JVM flags.
- Oracle JDK 25 Release Notes and significant changes.
- OpenJDK HotSpot Runtime Overview.
- OpenJDK JEP 197 — Segmented Code Cache.
- OpenJDK JMH project and samples.
- AdoptOpenJDK JITWatch project.
- Oracle technical article: Understanding Java JIT Compilation with JITWatch.
- Microsoft Java Engineering Blog: How Tiered Compilation Works in OpenJDK.
- Red Hat Developers: Runtime profiling in OpenJDK HotSpot JVM.
- JDK Mission Control / Java Flight Recorder documentation.

---

## 42. Status Seri

Part ini adalah **Part 020 dari 031**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 021 — Memory Model for Performance: Heap, Stack, Metaspace, Direct Memory, Native Memory
```
