# learn-java-testing-benchmarking-performance-jvm-part-016

# Part 016 — Benchmarking Fundamentals: Latency, Throughput, Percentile, Warmup, dan Noise

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: fondasi benchmark yang benar sebelum masuk JMH deep dive

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi testing:

- test taxonomy,
- test strategy,
- JUnit,
- assertion engineering,
- test data,
- mocking,
- domain workflow test,
- error-path testing,
- persistence/API/messaging testing,
- property-based testing,
- mutation testing,
- concurrency testing,
- test runtime architecture.

Sekarang kita masuk ke wilayah baru: **benchmarking dan performance evidence**.

Testing menjawab:

```text
Apakah behavior ini benar?
```

Benchmarking menjawab:

```text
Berapa biaya behavior ini dalam kondisi yang dikontrol?
```

Performance engineering menjawab:

```text
Apakah sistem ini memenuhi target kinerja dalam kondisi nyata,
dan apa penyebabnya jika tidak?
```

Jangan campur tiga hal itu.

Unit test yang hijau tidak membuktikan cepat.  
Benchmark yang cepat tidak membuktikan sistem production sehat.  
Load test yang bagus tidak membuktikan satu implementasi method adalah optimal.  
Profiler yang menunjukkan hot method tidak otomatis berarti method itu harus diubah.

Part ini adalah fondasi untuk membedakan semua itu.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. Membedakan benchmark, profiling, load test, stress test, dan production telemetry.
2. Memahami metrik penting:
   - throughput,
   - latency,
   - service time,
   - response time,
   - percentiles,
   - allocation rate,
   - CPU time,
   - wall-clock time.
3. Mengetahui kenapa JVM sulit di-benchmark secara naif:
   - warmup,
   - JIT,
   - tiered compilation,
   - dead code elimination,
   - constant folding,
   - escape analysis,
   - GC,
   - OS noise,
   - CPU frequency scaling,
   - container noise.
4. Mendesain benchmark hypothesis yang jelas.
5. Membaca hasil benchmark dengan skeptis, bukan percaya angka mentah.
6. Mengetahui kapan microbenchmark berguna dan kapan menyesatkan.
7. Menyiapkan mental model sebelum masuk JMH di Part 017 dan Part 018.

---

## 2. Benchmarking Bukan Sekadar “Mengukur Waktu”

Banyak engineer memulai benchmark seperti ini:

```java
long start = System.nanoTime();
doSomething();
long end = System.nanoTime();
System.out.println(end - start);
```

Untuk eksperimen sederhana, ini tidak selalu salah. Tetapi untuk mengambil keputusan engineering, ini sangat sering menyesatkan.

Masalahnya bukan `System.nanoTime()` saja. Masalah utamanya adalah:

1. JVM berubah selama program berjalan.
2. CPU berubah selama program berjalan.
3. OS scheduler berubah selama program berjalan.
4. GC bisa muncul di tengah pengukuran.
5. branch predictor, cache, dan memory locality berubah.
6. input benchmark sering tidak representatif.
7. compiler bisa menghapus pekerjaan yang menurutmu sedang diukur.
8. hasil single run hampir tidak pernah cukup.

Benchmark yang buruk bukan hanya tidak berguna. Benchmark buruk lebih berbahaya daripada tidak benchmark, karena memberi rasa percaya diri palsu.

---

## 3. Mental Model: Benchmark sebagai Eksperimen Terkontrol

Benchmark harus diperlakukan seperti eksperimen ilmiah kecil.

Strukturnya:

```text
Hypothesis
  -> workload model
  -> measurement design
  -> controlled environment
  -> repeated observation
  -> statistical interpretation
  -> decision with uncertainty
```

Bukan:

```text
run code once
  -> print millis
  -> choose smaller number
```

Benchmark yang baik harus punya:

| Elemen | Pertanyaan |
|---|---|
| Hypothesis | Apa yang mau dibuktikan? |
| Workload | Operasi apa yang diwakili? |
| Input distribution | Data seperti apa yang dipakai? |
| Metric | Apa yang diukur? |
| Environment | Di mana dijalankan? |
| Isolation | Apa yang dikontrol? |
| Repetition | Berapa kali diulang? |
| Warmup | Apakah JVM sudah stabil? |
| Noise model | Gangguan apa yang mungkin terjadi? |
| Decision rule | Kapan hasil dianggap cukup kuat? |

Contoh hypothesis lemah:

```text
Stream lebih lambat daripada for loop.
```

Contoh hypothesis lebih baik:

```text
Untuk transformasi list berisi 10.000 object sederhana pada Java 21,
loop imperative menghasilkan allocation rate lebih rendah dan throughput lebih tinggi
daripada Stream pipeline non-parallel, ketika fungsi transformasi trivial dan data sudah berada di memory.
```

Hypothesis kedua lebih baik karena menyebut:

- ukuran data,
- versi Java,
- workload,
- metric,
- konteks memory,
- batas generalisasi.

---

## 4. Benchmark, Profiling, Load Test, dan Telemetry: Jangan Ditukar

### 4.1 Microbenchmark

Microbenchmark mengukur potongan kecil kode:

- method,
- loop,
- parser,
- mapper,
- serializer,
- collection operation,
- lock primitive,
- allocation pattern.

Contoh:

```text
Berapa biaya convert DTO ke domain object?
Berapa throughput parser custom dibanding Jackson untuk payload kecil?
Berapa allocation rate dari StringBuilder vs string concatenation pada Java 8 dan Java 21?
```

Microbenchmark cocok untuk menjawab:

```text
Dalam kondisi terkontrol, operasi kecil ini relatif mahal atau murah?
```

Microbenchmark tidak cocok untuk menjawab:

```text
Apakah service production akan lebih cepat?
```

Karena production melibatkan:

- network,
- DB,
- queue,
- GC interaction,
- thread pool,
- CPU contention,
- lock contention,
- request distribution,
- cache state,
- error/retry behavior.

JMH adalah harness standar de facto untuk microbenchmark JVM. Ia dibuat untuk membangun, menjalankan, dan menganalisis benchmark nano/micro/milli/macro pada bahasa yang menargetkan JVM.

### 4.2 Macrobenchmark

Macrobenchmark mengukur bagian sistem yang lebih besar:

- satu endpoint API,
- satu use case,
- satu pipeline processing,
- satu batch job,
- satu consumer flow,
- satu scheduler job.

Contoh:

```text
Berapa waktu proses submit application sampai audit/event/outbox selesai?
Berapa throughput consumer saat menerima 1000 event per detik?
Berapa latency search API pada dataset 10 juta row?
```

Macrobenchmark lebih dekat ke production, tetapi lebih sulit dikontrol.

### 4.3 Load Test

Load test mengukur sistem pada beban tertentu.

Pertanyaannya:

```text
Pada 200 RPS dengan 95% read dan 5% write,
apakah p95 latency tetap di bawah 300 ms dan error rate di bawah 0.1%?
```

Load test biasanya melibatkan:

- HTTP traffic,
- database,
- cache,
- message broker,
- autoscaling,
- network,
- observability.

### 4.4 Stress Test

Stress test mencari titik pecah.

Pertanyaannya:

```text
Pada beban berapa sistem mulai collapse?
Apakah collapse graceful atau chaotic?
Apa bottleneck pertama?
```

Stress test bukan untuk membuktikan normal behavior. Ia untuk memahami failure mode.

### 4.5 Soak Test

Soak test berjalan lama.

Pertanyaannya:

```text
Apakah service tetap stabil setelah 8 jam / 24 jam / 72 jam?
Apakah memory retention naik?
Apakah thread leak muncul?
Apakah connection pool bocor?
Apakah GC makin sering?
```

### 4.6 Profiling

Profiling menjawab:

```text
Waktu/CPU/allocation/lock wait dihabiskan di mana?
```

Profiling bukan benchmark. Profiling adalah diagnosis.

Benchmark memberi gejala terukur.  
Profiler membantu menjelaskan penyebab.

### 4.7 Production Telemetry

Telemetry production menjawab:

```text
Apa yang benar-benar dialami user dan sistem nyata?
```

Telemetry mencakup:

- latency percentile,
- error rate,
- throughput,
- CPU,
- memory,
- GC,
- DB wait,
- queue depth,
- retry rate,
- timeout,
- saturation,
- logs,
- traces,
- profiling sample.

Production telemetry adalah evidence paling realistis, tetapi paling sulit dikontrol.

---

## 5. Evidence Ladder untuk Performance

Gunakan ladder berikut:

```text
1. Code reasoning
2. Unit/performance-sensitive test
3. Microbenchmark
4. Profiling in isolated workload
5. Macrobenchmark
6. Load/stress/soak test
7. Staging telemetry
8. Canary production telemetry
9. Full production telemetry
```

Semakin ke bawah:

- realism naik,
- cost naik,
- noise naik,
- control turun.

Semakin ke atas:

- control naik,
- cost turun,
- realism turun.

Engineer kuat tidak bertanya:

```text
Mana evidence terbaik?
```

Tetapi:

```text
Evidence minimum apa yang cukup untuk keputusan ini?
```

Contoh:

| Keputusan | Evidence minimum |
|---|---|
| Mengganti loop kecil di mapper | microbenchmark + allocation profile |
| Mengubah serializer API critical | benchmark + integration correctness + load smoke |
| Mengubah JVM GC production | GC log + JFR + load test/canary |
| Mengubah JDBC pool size | telemetry + load test + DB metrics |
| Mengganti architecture queue | macrobenchmark + failure-mode test + production-like load test |

---

## 6. Metrik Dasar: Throughput, Latency, dan Service Time

### 6.1 Throughput

Throughput adalah jumlah pekerjaan selesai per satuan waktu.

Contoh:

```text
requests/second
operations/second
messages/second
rows/second
MB/second
```

Formula sederhana:

```text
throughput = completed_work / elapsed_time
```

Throughput tinggi tidak otomatis berarti user experience baik.

Sistem bisa punya throughput tinggi tetapi p99 latency buruk.

Contoh:

```text
Service memproses 10.000 request/second,
tetapi 1% request butuh 10 detik.
```

Untuk batch job, throughput sering penting.  
Untuk user-facing API, latency dan tail latency sering lebih penting.

### 6.2 Latency

Latency adalah waktu yang diperlukan untuk menyelesaikan satu operasi dari sudut pandang tertentu.

Tapi hati-hati: “latency” sering ambigu.

Bisa berarti:

- client-observed latency,
- server processing time,
- queue waiting time,
- DB query latency,
- network round-trip,
- end-to-end business latency.

Selalu definisikan boundary.

Contoh buruk:

```text
Latency submit application 500 ms.
```

Contoh lebih baik:

```text
Client-observed HTTP latency dari request diterima oleh API gateway
sampai response body selesai diterima client adalah p95 <= 500 ms
pada 100 RPS sustained selama 30 menit.
```

### 6.3 Service Time

Service time adalah waktu aktual resource mengerjakan request.

Response time biasanya:

```text
response_time = queue_wait_time + service_time + network_time + client_wait_time
```

Misalnya request HTTP butuh 800 ms:

```text
queue wait in thread pool: 300 ms
application processing: 100 ms
DB wait: 350 ms
network/serialization: 50 ms
```

Kalau hanya melihat total latency, kita tidak tahu bottleneck.

### 6.4 CPU Time vs Wall-Clock Time

CPU time:

```text
berapa lama CPU benar-benar menjalankan thread
```

Wall-clock time:

```text
berapa lama waktu kalender berlalu
```

Contoh:

```java
Thread.sleep(1000);
```

Wall-clock time sekitar 1 detik.  
CPU time hampir nol.

Contoh lain:

```java
while (System.nanoTime() < deadline) {
    // busy spin
}
```

Wall-clock time 1 detik.  
CPU time juga hampir 1 detik.

Dalam performance diagnosis:

- CPU profiler menjawab CPU hot path.
- wall-clock profiler bisa menunjukkan blocking/waiting.
- latency measurement menunjukkan user-visible wait.

Jangan salah membaca CPU profile sebagai latency profile.

---

## 7. Percentile: Kenapa Average Sering Menipu

### 7.1 Mean/Average

Average:

```text
sum(latencies) / count
```

Masalahnya: average menyembunyikan tail.

Contoh 10 request:

```text
10 ms
10 ms
11 ms
10 ms
9 ms
10 ms
10 ms
12 ms
10 ms
1000 ms
```

Average:

```text
109.2 ms
```

Tapi 9 dari 10 request sekitar 10 ms. Satu request 1000 ms.

Average tidak menjelaskan distribusi.

### 7.2 Median / p50

p50 berarti 50% request lebih cepat atau sama dengan nilai ini.

p50 bagus untuk typical case, tetapi tidak cukup untuk service production.

### 7.3 p90, p95, p99, p999

- p90: 90% request lebih cepat atau sama dengan nilai ini.
- p95: 95% request lebih cepat atau sama dengan nilai ini.
- p99: 99% request lebih cepat atau sama dengan nilai ini.
- p999: 99.9% request lebih cepat atau sama dengan nilai ini.

Tail latency penting karena user dan sistem tidak merasakan average saja.

Jika satu halaman memanggil 20 API, probabilitas salah satu API terkena tail meningkat.

Jika masing-masing API punya 1% request lambat, maka probabilitas setidaknya satu dari 20 call lambat kira-kira:

```text
1 - 0.99^20 = 18.2%
```

Artinya p99 di satu dependency bisa menjadi pengalaman buruk yang jauh lebih sering di workflow gabungan.

### 7.4 Percentile Butuh Sample Size

p99 butuh sample cukup besar.

Jika hanya punya 100 sample, p99 kira-kira hanya 1 sample paling lambat. Itu sangat noisy.

Rule praktis:

| Percentile | Minimal sample agar mulai masuk akal |
|---|---:|
| p50 | puluhan |
| p90 | ratusan |
| p95 | ratusan sampai ribuan |
| p99 | ribuan sampai puluhan ribu |
| p999 | ratusan ribu atau lebih |

Jangan bangga dengan p99 dari 50 request.

---

## 8. Tail Latency dan Amplification

Tail latency sering muncul dari kombinasi:

- GC pause,
- lock contention,
- DB slow query,
- connection pool wait,
- CPU throttling,
- cold cache,
- page fault,
- retry,
- timeout,
- queue buildup,
- noisy neighbor,
- network jitter,
- class loading,
- JIT compilation,
- safepoint.

Tail latency bisa teramplifikasi dalam distributed system.

Contoh workflow:

```text
API Gateway
  -> Service A
      -> Service B
      -> Service C
      -> DB
      -> Redis
      -> Message broker
```

Walaupun masing-masing dependency tampak “cukup cepat”, total latency bisa buruk karena:

- serial dependency,
- fan-out,
- retry,
- queue,
- shared resource saturation.

Mental model:

```text
Tail latency is often a queueing and saturation symptom,
not merely a slow-method symptom.
```

---

## 9. Coordinated Omission: Ketika Load Test Berbohong

Coordinated omission terjadi ketika measurement tool berhenti atau melambat mengirim request saat sistem lambat, sehingga latency buruk tidak tercatat secara benar.

Contoh:

```text
Tool mengirim request berikutnya hanya setelah response sebelumnya selesai.
```

Jika server freeze 5 detik, tool tidak mengirim request selama freeze. Akibatnya, report bisa tampak lebih baik daripada realitas, karena request yang seharusnya antre selama freeze tidak dihitung.

Ini sering terjadi pada closed-loop load generator.

### 9.1 Closed Model

Closed model:

```text
N users melakukan request,
setiap user menunggu response,
lalu berpikir sebentar,
lalu request lagi.
```

Cocok untuk memodelkan jumlah user tetap.

Tapi kalau sistem melambat, request rate turun. Ini bisa menyembunyikan overload.

### 9.2 Open Model

Open model:

```text
request datang dengan arrival rate tertentu,
terlepas dari response sebelumnya.
```

Cocok untuk memodelkan traffic eksternal seperti request publik, event, atau job arrival.

Jika sistem melambat, queue bertambah. Ini lebih jujur untuk overload scenario.

### 9.3 Dampak pada Percentile

Jika benchmark/load test tidak mengoreksi coordinated omission, p99 bisa terlihat “aman” padahal user nyata mengalami delay jauh lebih parah.

Dalam seri ini, coordinated omission akan dibahas lagi di Part 019 saat load testing.

---

## 10. JVM Membuat Benchmark Sulit

JVM bukan interpreter statis sederhana. JVM adalah runtime adaptif.

Selama program berjalan, JVM bisa:

- menginterpretasi bytecode,
- mengumpulkan profiling data,
- melakukan JIT compilation,
- mengganti compiled code,
- melakukan inlining,
- melakukan speculative optimization,
- melakukan deoptimization,
- mengeliminasi allocation,
- menghapus computation yang tidak terlihat efeknya,
- menjalankan GC,
- memindahkan object,
- mengubah layout internal runtime state.

Artinya operasi yang sama bisa punya cost berbeda pada:

```text
iteration 1
iteration 100
iteration 10.000
iteration 1.000.000
setelah GC
setelah deoptimization
setelah class loading
setelah CPU thermal throttling
```

Benchmark Java harus memperlakukan JVM sebagai sistem dinamis.

---

## 11. Warmup: Kenapa Run Pertama Hampir Tidak Pernah Valid

Warmup adalah fase awal ketika JVM belum mencapai perilaku runtime yang relatif stabil.

Selama warmup:

- class loading terjadi,
- bytecode diverifikasi,
- interpreter menjalankan kode,
- profiling counter dikumpulkan,
- C1/C2 compiler mulai bekerja,
- method di-inline,
- branch profile terbentuk,
- cache CPU mulai terisi,
- TLAB behavior terbentuk,
- GC mulai menyesuaikan heap occupancy,
- code cache mulai terisi.

### 11.1 Contoh Naif

```java
public class NaiveBenchmark {
    public static void main(String[] args) {
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            work(i);
        }
        long end = System.nanoTime();
        System.out.println(end - start);
    }

    static int work(int x) {
        return x * 31 + 7;
    }
}
```

Masalah:

- hasil `work` tidak dipakai,
- JVM bisa menghapus computation,
- tidak ada warmup terpisah,
- tidak ada multiple forks,
- tidak ada variance,
- tidak ada memory/allocation metric,
- loop overhead bercampur dengan operation cost,
- hasil bisa sangat berbeda antar run.

### 11.2 Warmup Bukan Magic

Banyak orang berpikir:

```text
Tambahkan warmup 10 detik, selesai.
```

Tidak selalu.

Beberapa benchmark tidak pernah mencapai steady state. Beberapa mencapai steady state yang bukan peak. Beberapa berubah setelah deoptimization atau GC pattern tertentu.

Riset tentang warmup VM menunjukkan bahwa asumsi “program selalu masuk steady state peak setelah warmup” sering tidak valid pada runtime modern.

### 11.3 Practical Rule

Untuk benchmark penting:

1. Jalankan beberapa fork.
2. Gunakan warmup iteration yang cukup.
3. Lihat grafik/series jika memungkinkan, bukan hanya final number.
4. Perhatikan variance.
5. Curigai benchmark yang terlalu cepat, terlalu stabil, atau terlalu spektakuler.
6. Validasi dengan profiler.
7. Bandingkan dengan macro behavior jika keputusan berdampak sistem.

---

## 12. JIT, Tiered Compilation, dan Speculative Optimization

HotSpot JVM menggunakan dynamic compilation.

Secara sederhana:

```text
bytecode
  -> interpreter
  -> profiling data
  -> C1 compiler
  -> more profiling / optimized code
  -> C2 compiler
  -> highly optimized native code
```

Tiered compilation membuat JVM bisa cepat startup sekaligus menghasilkan peak performance lebih baik setelah kode cukup panas.

### 12.1 Kenapa Ini Penting untuk Benchmark

Benchmark bisa membentuk profile yang tidak sama dengan production.

Contoh:

```java
interface PriceCalculator {
    BigDecimal calculate(Order order);
}
```

Di benchmark, kamu hanya memakai satu implementasi:

```text
DefaultPriceCalculator
```

JVM melihat call site monomorphic dan melakukan aggressive inlining.

Di production, call site mungkin polymorphic:

```text
DefaultPriceCalculator
DiscountedPriceCalculator
AgencySpecificPriceCalculator
LegacyPriceCalculator
```

Maka hasil benchmark bisa terlalu optimistis.

### 12.2 Branch Profile

Benchmark input bisa membuat branch profile tidak realistis.

Contoh:

```java
if (caseStatus == APPROVED) {
    fastPath();
} else {
    slowPath();
}
```

Jika benchmark selalu memakai `APPROVED`, JVM bisa mengoptimalkan path itu. Di production, status bisa bervariasi.

Benchmark menjadi misleading karena mengukur branch profile palsu.

### 12.3 Deoptimization

JVM bisa mengoptimalkan berdasarkan asumsi. Jika asumsi runtuh, JVM melakukan deoptimization.

Contoh asumsi:

- hanya satu implementasi interface,
- class tertentu belum di-load,
- branch tertentu hampir selalu true,
- null jarang terjadi,
- exception path jarang terjadi.

Jika production melanggar asumsi, performance bisa berubah drastis.

---

## 13. Dead Code Elimination

Dead code elimination berarti JVM menghapus computation yang hasilnya tidak berdampak observable.

Contoh:

```java
@Benchmark
public void badBenchmark() {
    int x = compute();
}
```

Jika `x` tidak dipakai dan `compute()` tidak punya side effect yang terlihat, JVM boleh menghapusnya.

Maka benchmark mungkin mengukur hampir nothing.

### 13.1 Cara Menghindari

Di JMH, biasanya gunakan:

```java
@Benchmark
public int returnValue() {
    return compute();
}
```

atau:

```java
@Benchmark
public void consume(Blackhole blackhole) {
    blackhole.consume(compute());
}
```

JMH punya `Blackhole` untuk mencegah JVM menghapus hasil computation secara tidak realistis.

Tapi jangan memakai `Blackhole` sebagai ritual. Pahami kenapa dipakai.

### 13.2 Observable Side Effect

Observable side effect bisa berupa:

- return value,
- write ke volatile field,
- write ke object yang escape,
- IO,
- synchronization,
- exception.

Namun membuat side effect palsu bisa mengubah benchmark.

Contoh buruk:

```java
static List<Integer> sink = new ArrayList<>();

@Benchmark
public void bad() {
    sink.add(compute());
}
```

Sekarang benchmark mengukur:

- computation,
- ArrayList growth,
- memory write,
- possible GC,
- cache effect,
- maybe synchronization if sink changed.

Bukan computation murni.

---

## 14. Constant Folding

Constant folding terjadi ketika compiler menghitung ekspresi konstan lebih awal.

Contoh:

```java
@Benchmark
public int bad() {
    return 123 * 456;
}
```

Compiler bisa mengganti ini menjadi:

```java
return 56088;
```

Benchmark tidak lagi mengukur multiplication.

Contoh lain:

```java
private static final int VALUE = 42;

@Benchmark
public int bad() {
    return expensive(VALUE);
}
```

Jika input final dan predictable, compiler mungkin mengoptimalkan lebih agresif daripada production.

Praktik JMH umum:

- input berasal dari `@State`,
- field tidak `final`,
- gunakan `@Param` untuk variasi,
- hindari constant-only benchmark.

---

## 15. Escape Analysis dan Allocation Elimination

Escape analysis menentukan apakah object keluar dari scope method/thread.

Jika object tidak escape, JVM bisa:

- mengalokasikannya di stack-like manner,
- menghapus allocation,
- melakukan scalar replacement.

Contoh:

```java
static class Point {
    int x;
    int y;
}

@Benchmark
public int maybeNoAllocation() {
    Point p = new Point();
    p.x = 10;
    p.y = 20;
    return p.x + p.y;
}
```

JVM mungkin menghapus object `Point` sepenuhnya.

Jika tujuanmu mengukur allocation cost object, benchmark ini salah.

Tapi jika production object juga tidak escape, ini mungkin representatif.

Jadi pertanyaannya bukan:

```text
Bagaimana mematikan escape analysis?
```

Pertanyaannya:

```text
Apakah escape behavior benchmark sama dengan production?
```

---

## 16. Loop Trap dalam Microbenchmark

Banyak benchmark manual membuat loop besar di dalam method benchmark.

Contoh:

```java
@Benchmark
public int badLoop() {
    int sum = 0;
    for (int i = 0; i < 1_000_000; i++) {
        sum += operation(i);
    }
    return sum;
}
```

Ini tidak selalu salah, tapi berbahaya.

Masalah:

- loop overhead bercampur dengan operation cost,
- compiler bisa mengoptimasi loop secara agresif,
- branch predictor jadi terlalu stabil,
- cache locality jadi tidak realistis,
- operation jadi tidak independen,
- satu invocation benchmark terlalu panjang,
- latency distribution hilang.

JMH sudah punya internal loop. Biasanya lebih baik satu benchmark invocation merepresentasikan satu operasi logis, kecuali memang workload production adalah batch loop.

---

## 17. Allocation Rate: Metrik yang Sering Lebih Penting daripada Waktu

Dalam Java, banyak performance problem berasal dari allocation pressure.

Allocation tinggi bisa menyebabkan:

- GC lebih sering,
- young generation pressure,
- promotion ke old generation,
- cache pollution,
- memory bandwidth pressure,
- p99 latency naik.

Dua implementasi bisa punya throughput mirip, tetapi allocation rate berbeda jauh.

Contoh:

| Implementasi | Throughput | Allocation |
|---|---:|---:|
| A | 1.1M ops/s | 10 B/op |
| B | 1.2M ops/s | 800 B/op |

Implementasi B tampak 9% lebih cepat di microbenchmark, tetapi bisa lebih buruk di service karena GC pressure.

Saat membaca benchmark Java, selalu tanya:

```text
Berapa allocation per operation?
Apakah object escape?
Apakah GC terjadi selama measurement?
Apakah allocation representatif terhadap production?
```

JMH bisa memakai profiler seperti:

```text
-prof gc
```

untuk melihat allocation rate dan GC behavior.

---

## 18. CPU Cache, Branch Predictor, dan Memory Locality

JVM performance tidak hanya soal bytecode.

CPU modern punya:

- L1/L2/L3 cache,
- branch predictor,
- instruction pipeline,
- memory prefetcher,
- TLB,
- NUMA topology.

Benchmark kecil sering seluruh datanya muat di cache. Production tidak selalu begitu.

Contoh:

```text
Benchmark HashMap dengan 1.000 key
vs production HashMap/cache dengan 5 juta key.
```

Hasil benchmark kecil bisa sangat optimistis.

### 18.1 Branch Predictor

Jika benchmark input selalu sama, branch predictor belajar pola sempurna.

Production input lebih acak.

Contoh:

```java
if (user.hasPermission(permission)) {
    allow();
} else {
    deny();
}
```

Benchmark yang selalu allow tidak mengukur real permission matrix.

### 18.2 Data Distribution

Data distribution harus disebut eksplisit:

```text
90% valid, 10% invalid
70% small payload, 25% medium, 5% large
95% cache hit, 5% cache miss
80% approved status, 20% other statuses
```

Tanpa distribution, benchmark hanya mengukur cerita palsu.

---

## 19. OS Noise dan Hardware Noise

Benchmark bisa terganggu oleh:

- process lain,
- OS scheduler,
- interrupt,
- background service,
- antivirus,
- filesystem cache,
- network stack,
- CPU frequency scaling,
- turbo boost,
- thermal throttling,
- power saving mode,
- NUMA migration,
- hyper-thread sibling activity.

### 19.1 Laptop Benchmark Trap

Benchmark di laptop sering noisy karena:

- thermal throttling,
- battery mode,
- browser/IDE aktif,
- background indexing,
- CPU governor berubah,
- fan curve berubah,
- OS update/antivirus.

Laptop benchmark boleh untuk eksplorasi awal, bukan final evidence.

### 19.2 Cloud VM Trap

Cloud VM juga noisy:

- noisy neighbor,
- CPU steal,
- burst credit,
- hypervisor scheduling,
- network variability,
- storage variability.

Untuk benchmark serius:

- gunakan instance dedicated/consistent,
- pin environment,
- jalankan repeated fork,
- bandingkan baseline dan candidate di environment sama,
- simpan raw result.

### 19.3 Container Trap

Dalam container/Kubernetes:

- CPU quota bisa menyebabkan throttling,
- memory limit bisa memicu OOMKill,
- cgroup metrics bisa berbeda dari host,
- sidecar bisa memakai CPU/memory,
- node noisy neighbor mempengaruhi hasil,
- request/limit mempengaruhi scheduling.

Benchmark dalam container bisa valid jika memang production berjalan di container. Tetapi konfigurasi container harus sama/representatif.

---

## 20. Benchmark Environment Checklist

Sebelum mempercayai hasil, catat:

```text
Java version:
JVM distribution:
JVM flags:
OS:
Kernel:
CPU model:
CPU cores:
Hyper-threading:
Memory:
Container or bare metal:
CPU quota:
Memory limit:
GC collector:
Heap size:
Benchmark tool:
Benchmark version:
Warmup:
Measurement:
Fork count:
Thread count:
Input data:
Dataset size:
Background load:
Date/time:
Git commit:
```

Tanpa metadata, benchmark sulit direproduksi.

Benchmark result tanpa environment metadata adalah angka yatim.

---

## 21. Java 8–25 Compatibility Notes untuk Benchmark

Benchmark lintas versi Java harus hati-hati.

Perbedaan Java 8 sampai Java 25 bisa memengaruhi hasil karena:

- default GC berubah,
- JIT optimization berubah,
- String implementation berubah,
- compact strings ada sejak Java 9,
- module system mempengaruhi reflective access,
- biased locking berubah lalu dihapus,
- G1 menjadi default sejak Java 9,
- ZGC/Shenandoah tersedia pada versi modern,
- virtual threads hadir sejak Java 21,
- class data sharing dan startup behavior berubah,
- container awareness membaik dibanding Java 8 lama,
- TLS/security provider berubah,
- intrinsics dan vectorization berubah.

### 21.1 Jangan Bandingkan Java Version Tanpa Menyamakan Konteks

Contoh salah:

```text
Java 21 lebih lambat daripada Java 8 karena benchmark X di laptop saya.
```

Harus cek:

- GC sama atau tidak?
- heap sama atau tidak?
- warmup sama atau tidak?
- flags sama atau tidak?
- dependency sama atau tidak?
- CPU mode sama atau tidak?
- container awareness berubah atau tidak?
- illegal reflective access menyebabkan fallback atau tidak?

### 21.2 Benchmark untuk Migration

Saat migration Java 8 → 17/21/25, benchmark yang berguna:

- startup time,
- warmup time,
- steady-state throughput,
- p95/p99 latency under load,
- allocation rate,
- GC pause,
- memory footprint,
- native memory,
- CPU under representative workload,
- reflection-heavy path,
- serialization-heavy path,
- regex/string-heavy path,
- TLS/HTTP client path,
- JDBC path,
- virtual thread candidate path.

Jangan hanya microbenchmark method kecil lalu menyimpulkan migrasi aman.

---

## 22. Statistical Thinking: Variance, Confidence, dan Practical Significance

### 22.1 Variance

Jika hasil run:

```text
100 ns/op
103 ns/op
99 ns/op
101 ns/op
```

maka benchmark cukup stabil.

Jika hasil run:

```text
100 ns/op
180 ns/op
95 ns/op
260 ns/op
```

maka ada noise atau workload tidak stabil.

Jangan ambil angka terbaik. Angka terbaik sering hanya noise terbaik.

### 22.2 Confidence Interval

Confidence interval memberikan rentang estimasi.

Contoh:

```text
A: 100 ± 3 ns/op
B: 104 ± 3 ns/op
```

Perbedaan kecil. Mungkin tidak practical.

Contoh:

```text
A: 100 ± 3 ns/op
B: 160 ± 4 ns/op
```

Perbedaan kuat.

### 22.3 Practical Significance

Tidak semua perbedaan statistik penting secara engineering.

Contoh:

```text
Parser A 2 ns lebih cepat dari Parser B.
```

Jika parser dipanggil 100 kali per menit, tidak penting.

Jika dipanggil 10 juta kali per detik di hot loop, mungkin penting.

Tanya:

```text
Berapa total contribution operasi ini terhadap latency/CPU/allocation production?
```

Jika operasi hanya 0.1% dari CPU, improvement 50% pada operasi itu hanya menghemat sekitar 0.05% total CPU.

---

## 23. Amdahl’s Law untuk Performance Decision

Amdahl’s Law secara praktis:

```text
Perbaikan besar pada bagian kecil sistem menghasilkan dampak total kecil.
```

Jika suatu method memakai 5% CPU total, dan kamu membuatnya 2x lebih cepat:

```text
improvement total = sekitar 2.56%
```

Jika suatu path memakai 60% CPU total, improvement 20% bisa sangat berarti.

Maka sebelum micro-optimization:

1. ukur kontribusi bottleneck,
2. profil aplikasi,
3. estimasi dampak maksimum,
4. baru optimasi.

---

## 24. Benchmark Hypothesis Template

Gunakan template ini sebelum menulis benchmark:

```md
## Benchmark Hypothesis

### Question
Apa pertanyaan performance yang ingin dijawab?

### Candidate Implementations
- A:
- B:
- C:

### Workload
Operasi apa yang diwakili?

### Input Distribution
Ukuran, variasi, valid/invalid ratio, cache hit/miss ratio.

### Metrics
- throughput:
- latency:
- allocation:
- GC:
- CPU:

### Runtime
- Java version:
- JVM flags:
- GC:
- heap:
- OS/hardware/container:

### Expected Result
Apa dugaan awal dan kenapa?

### Decision Rule
Kapan kita memilih A/B/C?

### Validation Beyond Microbenchmark
Apakah perlu profiler, macrobenchmark, load test, atau canary?
```

---

## 25. Contoh: Benchmark Hypothesis yang Buruk vs Baik

### 25.1 Buruk

```text
Mau tes mana yang cepat: stream atau loop.
```

Masalah:

- data size tidak jelas,
- Java version tidak jelas,
- operation tidak jelas,
- metric tidak jelas,
- allocation tidak disebut,
- representasi production tidak jelas.

### 25.2 Baik

```text
Untuk endpoint application listing, terdapat transformasi 500–2000 entity ringan
menjadi DTO. Kita ingin membandingkan imperative loop dan Stream sequential pada Java 17 dan Java 21.
Metric utama adalah allocation per operation dan throughput.
Input distribution: 80% 500 rows, 15% 1000 rows, 5% 2000 rows.
Keputusan: pilih implementasi yang mengurangi allocation minimal 20% tanpa membuat readability turun signifikan,
dan validasi di macrobenchmark endpoint listing.
```

Ini jauh lebih bisa dipertanggungjawabkan.

---

## 26. Benchmarking Latency vs Throughput

JMH mode bisa mengukur throughput atau average time. Tetapi konsepnya harus dipahami dulu.

### 26.1 Throughput-Oriented Benchmark

Cocok untuk:

- parser hot path,
- mapper,
- hashing,
- compression,
- serialization,
- collection operation,
- CPU-bound computation.

Pertanyaan:

```text
Berapa banyak operasi selesai per detik?
```

### 26.2 Latency-Oriented Benchmark

Cocok untuk:

- request handling,
- operation dengan blocking,
- IO-like behavior,
- lock wait,
- queue wait,
- mixed workload.

Pertanyaan:

```text
Berapa lama satu operasi butuh waktu?
Bagaimana distribusinya?
```

### 26.3 Jangan Salah Mode

Jika operation sangat kecil, average time bisa noisy.

Jika operation sangat besar, throughput bisa menyembunyikan tail.

Jika operation blocking, microbenchmark sering tidak representatif.

---

## 27. Benchmarking Blocking Operation

Benchmark blocking operation seperti DB, HTTP, file IO, Redis, message broker dengan JMH sering bermasalah.

Kenapa?

- external system noise tinggi,
- network variability,
- connection pool behavior,
- server-side cache,
- DB query plan,
- lock/wait,
- rate limit,
- coordinated omission,
- benchmark harness overhead bukan masalah utama.

Untuk blocking operation, sering lebih cocok:

- integration performance test,
- macrobenchmark,
- load test,
- production-like environment,
- tracing/profiling.

JMH masih bisa dipakai untuk client-side code kecil, misalnya:

- serialization sebelum kirim HTTP,
- SQL string builder,
- mapper row → object,
- retry policy calculation,
- cache key generation.

Tapi jangan gunakan JMH untuk menyimpulkan:

```text
Database query production cepat.
```

---

## 28. Benchmarking Concurrent Code

Concurrent benchmark lebih sulit karena melibatkan:

- contention,
- false sharing,
- synchronization,
- memory barriers,
- CPU topology,
- scheduler,
- thread count,
- workload distribution,
- critical section duration.

Contoh:

```text
ConcurrentHashMap vs synchronized HashMap
```

Tidak cukup mengukur single-thread.

Harus definisikan:

- read/write ratio,
- key distribution,
- contention level,
- thread count,
- CPU core count,
- value size,
- operation type,
- mutation pattern.

Contoh workload:

```text
95% get, 5% put, 32 threads, 10.000 keys, Zipfian key distribution.
```

Ini jauh lebih realistis daripada:

```text
multi-thread map benchmark
```

### 28.1 Correctness Dulu, Benchmark Kemudian

Untuk concurrent code, jangan benchmark sebelum correctness diuji.

Pipeline:

```text
unit/concurrency test
  -> jcstress jika perlu
  -> microbenchmark contention
  -> macro/load test
```

Fast data race tetap bug.

---

## 29. Benchmarking Virtual Threads

Virtual threads sejak Java 21 mengubah model concurrency untuk blocking workloads.

Benchmark virtual threads harus hati-hati.

Virtual threads biasanya membantu ketika:

- workload mostly blocking,
- high concurrency,
- thread-per-request model ingin disederhanakan,
- blocking IO memakai JDK APIs yang mendukung unmounting.

Virtual threads biasanya tidak membantu CPU-bound workload.

Benchmark yang salah:

```text
Membuat 1 juta virtual thread yang hanya sleep,
lalu menyimpulkan service production akan cepat.
```

Pertanyaan yang benar:

```text
Pada workload API yang 80% waktunya menunggu DB/HTTP,
apakah virtual-thread-per-request mengurangi thread pool starvation
dan memperbaiki latency under concurrency dibanding fixed platform thread pool?
```

Harus lihat:

- carrier thread utilization,
- pinning,
- synchronized block,
- native call,
- blocking library compatibility,
- DB connection pool limit,
- downstream saturation.

Virtual thread tidak menghapus bottleneck DB pool.

---

## 30. Benchmarking Memory-Sensitive Code

Untuk kode memory-sensitive, ukur:

- allocation per operation,
- retained memory,
- allocation rate,
- GC frequency,
- object lifetime,
- peak memory,
- direct memory,
- native memory if relevant.

Contoh memory-sensitive code:

- JSON serialization,
- CSV import,
- large file processing,
- report generation,
- audit trail processing,
- batch job,
- compression,
- image/PDF processing,
- large collection transformation.

### 30.1 Allocation vs Retention

Allocation:

```text
object dibuat
```

Retention:

```text
object tetap hidup dan tidak bisa di-GC
```

High allocation tidak selalu leak.  
Low allocation tidak selalu memory safe.

Benchmark allocation harus dilengkapi heap analysis jika masalah production adalah memory retention.

---

## 31. Benchmarking Startup dan Warmup

Tidak semua sistem peduli hanya steady-state throughput.

Cloud-native service, serverless, batch job pendek, CLI, dan autoscaled service juga peduli:

- startup time,
- time to first request,
- time to steady state,
- warmup latency,
- class loading,
- JIT compilation cost,
- CDS/AppCDS,
- framework startup,
- dependency initialization.

Benchmark startup berbeda dari benchmark steady-state.

Contoh target:

```text
Container must become ready under 20 seconds.
First request p95 after readiness must be under 500 ms.
Warmup should not cause p99 spike above 2 seconds during first 5 minutes.
```

Untuk service Kubernetes, startup benchmark harus mempertimbangkan:

- readiness probe,
- liveness probe,
- DB connection initialization,
- cache warmup,
- class loading,
- JIT warmup,
- traffic ramp.

---

## 32. Benchmark Result Interpretation Framework

Saat melihat hasil benchmark, jangan langsung pilih angka tercepat.

Gunakan pertanyaan ini:

### 32.1 Validity

```text
Apakah benchmark mengukur hal yang benar?
Apakah work tidak dieliminasi JVM?
Apakah input realistis?
Apakah warmup cukup?
Apakah fork cukup?
Apakah variance kecil?
Apakah allocation diukur?
Apakah GC terjadi?
```

### 32.2 Relevance

```text
Apakah workload mirip production?
Apakah data size mirip production?
Apakah branch profile mirip production?
Apakah dependency behavior mirip production?
Apakah Java/JVM flags sama?
```

### 32.3 Impact

```text
Apakah path ini hot di production?
Berapa kontribusi terhadap CPU/latency/allocation?
Apakah improvement signifikan secara user/system?
Apakah readability/maintainability turun?
```

### 32.4 Risk

```text
Apakah implementasi baru lebih kompleks?
Apakah ada correctness risk?
Apakah ada concurrency risk?
Apakah ada memory risk?
Apakah behavior berubah pada edge case?
```

### 32.5 Validation

```text
Apakah perlu profiler?
Apakah perlu macrobenchmark?
Apakah perlu load test?
Apakah perlu canary?
```

---

## 33. Benchmark Anti-Patterns

### 33.1 Stopwatch Benchmark di Main Method

```java
public static void main(String[] args) {
    long start = System.nanoTime();
    operation();
    System.out.println(System.nanoTime() - start);
}
```

Boleh untuk curiosity, bukan decision.

### 33.2 Mengambil Run Terbaik

```text
Run terbaik 10 ms, berarti cepat.
```

Run terbaik sering hanya noise.

### 33.3 Tidak Ada Warmup

Mengukur startup/interpreter/class loading padahal mengira mengukur steady state.

### 33.4 Work Tidak Dipakai

Computation bisa dieliminasi.

### 33.5 Input Konstan

Constant folding atau branch profile palsu.

### 33.6 Dataset Terlalu Kecil

Data semua masuk cache, production tidak.

### 33.7 Benchmark IO dengan Microbenchmark

Menggunakan JMH untuk DB/HTTP lalu menyimpulkan production performance.

### 33.8 Tidak Mengukur Allocation

Memilih implementasi yang sedikit lebih cepat tetapi menghasilkan GC pressure besar.

### 33.9 Tidak Mencatat Environment

Angka tidak bisa direproduksi.

### 33.10 Membandingkan Java Version dengan Flag Berbeda

Menganggap Java version penyebab padahal GC/heap/container setting berbeda.

### 33.11 Optimasi Tanpa Profiling

Mengoptimasi method yang bukan bottleneck.

### 33.12 Microbenchmark Menjadi Design Driver Utama

Kode menjadi rumit demi improvement kecil yang tidak berdampak production.

---

## 34. Practical Benchmarking Workflow

Gunakan workflow berikut:

```text
1. Observe symptom or question
2. Define performance hypothesis
3. Identify workload boundary
4. Choose metric
5. Choose benchmark type
6. Design realistic input distribution
7. Control environment
8. Run warmup and repeated measurement
9. Capture allocation/GC if Java
10. Inspect variance
11. Validate with profiler if surprising
12. Compare against baseline
13. Estimate production impact
14. Decide: adopt, reject, investigate more
15. Store result and metadata
```

### 34.1 Example Workflow

Problem:

```text
DTO mapping suspected slow in listing endpoint.
```

Bad response:

```text
Rewrite all mapper using manual loop.
```

Good response:

```text
1. Use profiler/load trace to confirm mapper contribution.
2. If mapper is hot, write JMH benchmark for representative DTO sizes.
3. Compare MapStruct/manual/Stream/reflection mapper.
4. Measure throughput and allocation.
5. Validate one endpoint macrobenchmark.
6. Decide based on impact and maintainability.
```

---

## 35. Example: Manual Timing Trap

### 35.1 Naive Code

```java
import java.util.ArrayList;
import java.util.List;

public class NaiveTimingTrap {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>();
        for (int i = 0; i < 1_000_000; i++) {
            numbers.add(i);
        }

        long start = System.nanoTime();

        long sum = 0;
        for (Integer number : numbers) {
            sum += number * 31L;
        }

        long end = System.nanoTime();

        System.out.println("sum = " + sum);
        System.out.println("elapsed ns = " + (end - start));
    }
}
```

Ini lebih baik daripada tidak memakai hasil, tetapi tetap belum cukup untuk decision:

- satu run,
- tidak ada warmup,
- tidak ada fork,
- tidak ada variance,
- tidak ada allocation metric,
- benchmark bercampur dengan data layout tertentu,
- CPU/OS noise tidak dikontrol.

### 35.2 Better Direction

Gunakan JMH:

```java
import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.annotations.Fork;
import org.openjdk.jmh.annotations.Measurement;
import org.openjdk.jmh.annotations.Param;
import org.openjdk.jmh.annotations.Scope;
import org.openjdk.jmh.annotations.Setup;
import org.openjdk.jmh.annotations.State;
import org.openjdk.jmh.annotations.Warmup;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

@State(Scope.Thread)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(3)
public class SumBenchmark {

    @Param({"100", "10000", "1000000"})
    public int size;

    private List<Integer> numbers;

    @Setup
    public void setup() {
        numbers = new ArrayList<>(size);
        for (int i = 0; i < size; i++) {
            numbers.add(i);
        }
    }

    @Benchmark
    public long loop() {
        long sum = 0;
        for (Integer number : numbers) {
            sum += number * 31L;
        }
        return sum;
    }

    @Benchmark
    public long stream() {
        return numbers.stream()
                .mapToLong(number -> number * 31L)
                .sum();
    }
}
```

Tetapi bahkan ini belum final. Kita masih harus bertanya:

- apakah `List<Integer>` representatif?
- apakah boxing memang ada di production?
- apakah data size distribution benar?
- apakah branch/mapper logic nyata lebih kompleks?
- apakah allocation diukur?
- apakah endpoint macrobenchmark mendukung hasil?

---

## 36. Example: Benchmark Result yang Perlu Ditolak

Misalnya ada hasil:

```text
Benchmark                 Mode  Cnt   Score   Error  Units
MapperBenchmark.stream   thrpt   10  10.000 ± 0.100 ops/ms
MapperBenchmark.loop     thrpt   10  11.000 ± 0.100 ops/ms
```

Loop 10% lebih cepat.

Apakah langsung rewrite?

Belum.

Tanya:

1. Apakah mapper muncul di profiler production?
2. Apakah 10% pada mapper berdampak ke endpoint?
3. Apakah allocation berbeda?
4. Apakah loop lebih sulit dipelihara?
5. Apakah benchmark memakai data realistic?
6. Apakah benchmark lintas Java version?
7. Apakah result stabil di fork lain?
8. Apakah ada macrobenchmark endpoint?

Jika mapper hanya 2% CPU endpoint, improvement maksimum kecil.

```text
2% * 10% = 0.2% total improvement
```

Mungkin tidak worth it.

---

## 37. Example: Benchmark Result yang Layak Ditindaklanjuti

Hasil:

```text
Current reflection mapper:
- 300k ops/s
- 2.5 KB/op allocation

Generated mapper:
- 1.8M ops/s
- 120 B/op allocation
```

Profiler production menunjukkan mapper path menyumbang:

```text
18% CPU
25% allocation rate
```

Endpoint macrobenchmark menunjukkan:

```text
p95 turun 14%
GC young frequency turun 30%
CPU turun 10%
```

Ini layak ditindaklanjuti, karena evidence lintas level konsisten:

```text
microbenchmark
  -> profiler
  -> macrobenchmark
  -> system metrics
```

---

## 38. Performance Budget dan Benchmark Threshold

Benchmark lebih berguna jika terkait budget.

Contoh budget:

```text
DTO mapper must allocate < 512 B/op for typical listing item.
Permission check must complete < 2 us p95 in memory.
Postal code normalization must support > 5M ops/s on baseline runner.
JSON serialization for audit event must allocate < 4 KB/event.
```

Budget harus:

- terkait risiko nyata,
- bisa diukur,
- punya baseline,
- tidak terlalu ketat tanpa alasan,
- bisa berubah berdasarkan telemetry.

Performance budget bukan vanity metric.

---

## 39. Benchmarking dalam CI: Hati-Hati

CI environment sering noisy.

Benchmark di CI cocok untuk:

- smoke performance regression,
- allocation regression besar,
- obvious slowdown,
- comparing against baseline on same runner.

CI kurang cocok untuk:

- angka final absolute,
- micro-difference 1–3%,
- p99 sensitive measurement,
- hardware-sensitive benchmark.

Strategi:

```text
PR CI:
  - unit test
  - integration test
  - selected fast benchmark smoke if needed

Nightly:
  - JMH benchmark suite
  - macrobenchmark
  - compare baseline

Pre-release:
  - load test
  - JFR/GC log capture
  - capacity validation
```

---

## 40. Decision Matrix: Kapan Benchmark?

| Situasi | Perlu benchmark? | Evidence tambahan |
|---|---:|---|
| Refactor readability tanpa hot path | Tidak selalu | test correctness |
| Mengganti mapper di endpoint high traffic | Ya | profiler + macrobenchmark |
| Memilih collection untuk hot path | Ya | JMH + allocation |
| Mengubah DB query | Tidak cukup JMH | explain plan + integration/load |
| Mengubah JVM GC | Bukan microbenchmark | GC log + JFR + load test |
| Mengubah thread pool | Macro/load | telemetry + queue metrics |
| Mengubah serializer event besar | Ya | JMH + memory + integration |
| Mengadopsi virtual threads | Macro/load | pinning, pool, downstream metrics |
| Mengoptimasi method yang tidak muncul di profiler | Biasanya tidak | profiling dulu |

---

## 41. Benchmark Review Checklist

Gunakan checklist ini saat review PR/performance report.

### 41.1 Question

```text
[ ] Apa pertanyaan benchmark jelas?
[ ] Apa hypothesis eksplisit?
[ ] Apa decision yang akan diambil dari hasil ini?
```

### 41.2 Workload

```text
[ ] Workload representatif?
[ ] Input size realistic?
[ ] Input distribution realistic?
[ ] Branch profile realistic?
[ ] Cache hit/miss realistic?
```

### 41.3 JVM Correctness

```text
[ ] Ada warmup?
[ ] Ada multiple measurement iteration?
[ ] Ada multiple fork?
[ ] Dead code elimination dicegah?
[ ] Constant folding dicegah?
[ ] Escape behavior dipahami?
[ ] Allocation diukur?
```

### 41.4 Environment

```text
[ ] Java version dicatat?
[ ] JVM flags dicatat?
[ ] GC dicatat?
[ ] Hardware/container dicatat?
[ ] Background noise dikontrol?
```

### 41.5 Result

```text
[ ] Variance masuk akal?
[ ] Error/confidence interval dibaca?
[ ] Tidak mengambil run terbaik saja?
[ ] Improvement practical, bukan cuma statistical?
[ ] Ada baseline?
```

### 41.6 Decision

```text
[ ] Impact production diestimasi?
[ ] Maintainability dipertimbangkan?
[ ] Correctness tetap dijaga?
[ ] Perlu profiler/macro/load test?
[ ] Raw result disimpan?
```

---

## 42. Top 1% Engineer Notes

Engineer rata-rata bertanya:

```text
Mana yang lebih cepat?
```

Engineer kuat bertanya:

```text
Lebih cepat dalam workload apa,
di runtime mana,
dengan input distribution apa,
dengan variance berapa,
dan berdampak berapa terhadap sistem nyata?
```

Engineer rata-rata melihat benchmark sebagai kompetisi angka.

Engineer kuat melihat benchmark sebagai **instrument untuk mengurangi ketidakpastian keputusan**.

Engineer rata-rata melakukan tuning karena ada flag menarik.

Engineer kuat melakukan tuning setelah punya:

```text
symptom
  -> measurement
  -> hypothesis
  -> controlled experiment
  -> validation
  -> rollback plan
```

Engineer rata-rata percaya benchmark jika hasilnya sesuai opini.

Engineer kuat paling curiga pada benchmark yang terlalu cocok dengan opini awal.

---

## 43. Ringkasan Mental Model

Benchmark yang baik harus memenuhi lima prinsip:

```text
1. Measures the right thing
2. Represents the relevant workload
3. Controls the runtime enough
4. Reports uncertainty
5. Connects result to decision
```

Untuk JVM, tambahkan prinsip khusus:

```text
6. Respect warmup, JIT, GC, and runtime adaptivity
7. Measure allocation, not only time
8. Avoid fake profiles that production will never have
```

Jangan gunakan benchmark sebagai alat pembenaran. Gunakan benchmark sebagai alat investigasi.

---

## 44. Latihan Mandiri

### Latihan 1 — Benchmark Hypothesis

Ambil satu hot path dari aplikasi Java yang pernah kamu kerjakan, misalnya:

- DTO mapper,
- permission check,
- audit serialization,
- case status transition validation,
- query result transformation,
- postal code normalization,
- cache key generation.

Tulis:

```text
Question:
Candidate implementations:
Workload:
Input distribution:
Metrics:
Runtime:
Decision rule:
Validation beyond microbenchmark:
```

### Latihan 2 — Reject Bad Benchmark

Review benchmark manual berikut:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    new Object().toString();
}
System.out.println(System.nanoTime() - start);
```

Identifikasi minimal 8 masalah.

### Latihan 3 — Percentile Reasoning

Sebuah endpoint memiliki:

```text
p50 = 80 ms
p95 = 300 ms
p99 = 2.5 s
average = 140 ms
```

Jawab:

1. Apakah endpoint sehat?
2. Metrik mana yang paling mengkhawatirkan?
3. Dugaan root cause apa saja?
4. Evidence apa yang perlu dikumpulkan?

### Latihan 4 — Java Version Comparison

Kamu menjalankan benchmark di Java 8 dan Java 21. Java 21 terlihat lebih lambat 8%.

Buat checklist investigasi sebelum menyimpulkan Java 21 lebih lambat.

---

## 45. Referensi

- OpenJDK JMH project: Java Microbenchmark Harness.
- Oracle: Avoiding Benchmarking Pitfalls on the JVM.
- Oracle Java HotSpot VM performance enhancements.
- JMH samples, khususnya dead code elimination dan constant folding examples.
- Gil Tene / HdrHistogram ecosystem: coordinated omission and latency measurement concepts.
- Research: VM warmup, steady state, and misleading JVM microbenchmarks.

---

## 46. Status Seri

Progress saat ini:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 selesai
Part 008 selesai
Part 009 selesai
Part 010 selesai
Part 011 selesai
Part 012 selesai
Part 013 selesai
Part 014 selesai
Part 015 selesai
Part 016 selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 017 — JMH Deep Dive I: Harness, State, Scope, Mode, Warmup, Measurement
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-015](./learn-java-testing-benchmarking-performance-jvm-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-017](./learn-java-testing-benchmarking-performance-jvm-part-017.md)

</div>