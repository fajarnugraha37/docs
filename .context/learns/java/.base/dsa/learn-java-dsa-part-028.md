# Learn Java DSA — Part 028

# Performance Engineering: Benchmarking DSA in Java

> Seri: `learn-java-dsa`  
> Part: `028`  
> Topik: Performance Engineering, Benchmarking, Profiling, JMH, JOL, GC Pressure, Allocation Rate, Throughput, Latency, dan Production Decision-Making  
> Target pembaca: Java engineer yang ingin memilih dan menguji data structure/algorithm secara realistis, bukan berdasarkan intuisi mentah atau Big-O saja.

---

## 0. Posisi Part Ini dalam Seri

Sampai titik ini kita sudah membahas banyak struktur data dan algoritma:

- array, list, linked structure,
- stack, queue, deque, ring buffer,
- hash table, map, set,
- ordering, binary search, tree,
- heap, graph,
- string algorithm,
- recursion/backtracking,
- dynamic programming,
- greedy,
- sliding window,
- bitset,
- DSU,
- cache,
- concurrent data structure,
- immutable/snapshot structure,
- workflow/state-machine algorithm design.

Bagian ini menjawab pertanyaan yang sering muncul setelah seseorang tahu banyak pilihan DSA:

> “Bagaimana saya tahu pilihan struktur data saya benar-benar lebih cepat, lebih hemat memori, dan lebih stabil di Java?”

Jawaban pendeknya:

> Jangan hanya menebak dari Big-O. Ukur dengan benar, pahami biaya JVM, dan validasi terhadap workload yang menyerupai realita.

Jawaban panjangnya adalah seluruh part ini.

---

## 1. Kenapa Benchmarking DSA di Java Itu Sulit

Di bahasa yang sangat dekat dengan mesin, seperti C, benchmark sederhana kadang masih bisa memberi sinyal cukup langsung: operasi A butuh instruksi sekian, operasi B butuh instruksi sekian.

Di Java, ceritanya lebih kompleks.

Kode Java berjalan di atas JVM. JVM bukan sekadar interpreter. JVM modern memiliki:

1. JIT compiler.
2. Tiered compilation.
3. Profiling runtime.
4. Escape analysis.
5. Inlining.
6. Dead-code elimination.
7. Lock elimination.
8. Scalar replacement.
9. Garbage collector.
10. Object allocation optimization.
11. Safepoint.
12. Class loading.
13. Dynamic dispatch optimization.
14. Speculative optimization dan deoptimization.

Artinya, kode yang terlihat sama di source code bisa dieksekusi dengan karakteristik yang sangat berbeda tergantung:

- sudah warmup atau belum,
- input data seperti apa,
- branch pattern seperti apa,
- object allocation escape atau tidak,
- method bisa di-inline atau tidak,
- polymorphism monomorphic/bimorphic/megamorphic,
- GC sedang aktif atau tidak,
- CPU cache sedang cocok atau tidak,
- benchmark-nya realistis atau terlalu steril.

Karena itu, microbenchmark Java yang ditulis sembarangan sering menghasilkan kesimpulan palsu.

Contoh kesimpulan palsu:

```text
ArrayList selalu lebih cepat daripada LinkedList.
HashMap selalu O(1), jadi pasti lebih cepat daripada TreeMap.
String concatenation dengan + selalu buruk.
Stream pasti lambat.
Parallel stream pasti cepat.
BitSet selalu lebih baik daripada HashSet.
Primitive array selalu menang.
PriorityQueue selalu cocok untuk scheduler.
```

Beberapa statement di atas sering benar pada konteks tertentu, tetapi berbahaya jika dianggap hukum absolut.

Performance engineering bukan mencari jawaban universal. Performance engineering mencari jawaban yang benar untuk:

1. workload tertentu,
2. data distribution tertentu,
3. operation mix tertentu,
4. memory budget tertentu,
5. latency budget tertentu,
6. concurrency level tertentu,
7. failure tolerance tertentu.

---

## 2. Mental Model: Benchmark Bukan Kompetisi, Tapi Instrumentasi Keputusan

Benchmark yang baik tidak bertanya:

> “Mana yang paling cepat?”

Benchmark yang baik bertanya:

> “Untuk workload ini, struktur mana yang memenuhi correctness invariant, latency budget, memory budget, dan operational risk paling baik?”

Contoh:

Kita ingin memilih struktur untuk lookup rule configuration by effective date.

Pilihan:

1. `ArrayList<Rule>` sorted by effective date + binary search.
2. `TreeMap<LocalDate, Rule>`.
3. `HashMap<LocalDate, Rule>`.
4. `NavigableMap<LocalDate, Rule>` wrapper dengan immutable snapshot.

Pertanyaan benchmark bukan hanya:

```text
Mana lookup paling cepat?
```

Tetapi:

```text
Berapa lookup per second?
Berapa p99 latency?
Berapa allocation per lookup?
Berapa memory per 10_000 rules?
Berapa cost rebuild snapshot?
Berapa cost update per rule?
Apakah ordering deterministik?
Apakah range query dibutuhkan?
Apakah key exact atau floor/ceiling lookup?
Apakah update frequent atau rare?
Apakah lookup concurrent?
```

Jika rule jarang berubah dan lookup sangat sering, sorted array + binary search bisa unggul karena locality bagus dan allocation rendah.

Jika range query dan frequent update dibutuhkan, `TreeMap` mungkin lebih tepat.

Jika exact lookup saja, `HashMap` bisa lebih tepat.

Jika harus safe untuk banyak thread dan update dilakukan dengan publish snapshot, immutable sorted array atau immutable map bisa lebih mudah dipertahankan.

Benchmark yang baik membantu memilih berdasarkan trade-off, bukan ego algoritmik.

---

## 3. Big-O Tetap Penting, Tapi Tidak Cukup

Big-O memberi batas pertumbuhan biaya saat input membesar.

Contoh:

| Operation | Struktur | Complexity |
|---|---:|---:|
| random access | array / `ArrayList` | `O(1)` |
| search unsorted | array / list | `O(n)` |
| lookup average | `HashMap` | `O(1)` average |
| lookup ordered | `TreeMap` | `O(log n)` |
| heap insert/poll | `PriorityQueue` | `O(log n)` |
| binary search | sorted array | `O(log n)` |
| sort | array/list | `O(n log n)` |

Namun Big-O tidak menunjukkan:

1. object allocation,
2. reference indirection,
3. CPU cache locality,
4. branch prediction,
5. boxing/unboxing,
6. comparator cost,
7. hash computation cost,
8. resize spike,
9. GC pressure,
10. synchronization/atomic contention,
11. iterator allocation,
12. lambda capture allocation,
13. memory footprint,
14. p99 latency.

Contoh ekstrem:

```java
int[] dense = new int[1_000_000];
List<Integer> boxed = new ArrayList<>();
```

Keduanya bisa dianggap menyimpan sequence angka. Tetapi memory dan locality-nya sangat berbeda.

`int[]` menyimpan nilai primitive secara compact.

`ArrayList<Integer>` menyimpan array reference ke object `Integer`. Jika nilainya tidak berasal dari cache integer kecil atau sudah ter-box, ada object tambahan untuk setiap elemen.

Untuk workload scanning besar, `int[]` biasanya jauh lebih cache-friendly dan allocation-friendly.

Namun `ArrayList<Integer>` punya API fleksibel, bisa tumbuh dinamis, dan cocok jika integrasi dengan Collections API lebih penting daripada performa mentah.

Jadi Big-O adalah filter pertama, bukan bukti akhir.

---

## 4. Tiga Level Pengukuran: Micro, Meso, Macro

Benchmark DSA di Java sebaiknya dibagi menjadi tiga level.

### 4.1 Microbenchmark

Microbenchmark mengukur unit kecil:

- `HashMap.get()` vs `TreeMap.get()`.
- `ArrayList.contains()` vs `HashSet.contains()`.
- binary search vs linear scan.
- `PriorityQueue.poll()` cost.
- `BitSet.get()` vs `boolean[]` vs `HashSet<Integer>`.

Microbenchmark berguna untuk memahami cost dasar.

Namun microbenchmark sering tidak mewakili real application karena terlalu steril.

### 4.2 Meso-benchmark

Meso-benchmark mengukur satu komponen atau use case kecil:

- rule lookup engine,
- escalation scheduler,
- validation pipeline,
- duplicate detection module,
- in-memory index,
- cache eviction policy,
- graph dependency resolver.

Ini lebih berguna untuk engineering decision karena operation mix lebih realistis.

Contoh meso-benchmark:

```text
Load 100_000 cases.
Build index by state, due date, officer, and party id.
Run 1_000_000 mixed operations:
- 80% read by id
- 10% range query by due date
- 5% update state
- 5% dependency impact traversal
Measure throughput, p95, p99, allocation, GC.
```

### 4.3 Macro-benchmark

Macro-benchmark mengukur service/application secara utuh:

- endpoint latency,
- database + cache + app logic,
- queue processing throughput,
- memory under load,
- GC under real traffic,
- CPU saturation,
- tail latency.

Macro-benchmark menjawab apakah perubahan DSA benar-benar berdampak pada sistem.

Kadang microbenchmark menunjukkan improvement 5x, tetapi macro-benchmark tidak berubah karena bottleneck sebenarnya ada di database, network, serialization, atau lock contention lain.

---

## 5. Benchmark Decision Ladder

Gunakan urutan berpikir berikut.

```text
1. Correctness invariant dulu.
2. Complexity sanity check.
3. Memory model sanity check.
4. Microbenchmark untuk biaya operasi inti.
5. Meso-benchmark untuk operation mix.
6. Profiling untuk bottleneck aktual.
7. Production telemetry untuk validasi realita.
8. Baru putuskan optimasi.
```

Jangan membalik urutan menjadi:

```text
1. Lihat benchmark random di internet.
2. Pilih struktur yang katanya cepat.
3. Pakai di production.
4. Baru sadar correctness invariant tidak cocok.
```

Itu bukan performance engineering. Itu gambling.

---

## 6. JMH: Tool Utama untuk Microbenchmark Java

Untuk microbenchmark Java, gunakan JMH, bukan `System.nanoTime()` manual dalam loop sembarangan.

JMH dibuat untuk menangani banyak jebakan microbenchmark JVM:

- warmup,
- measurement iteration,
- forked JVM,
- dead-code elimination,
- constant folding,
- benchmark state,
- blackhole,
- benchmark modes,
- parameterization,
- result reporting.

### 6.1 Kenapa `System.nanoTime()` Sembarangan Berbahaya

Contoh benchmark buruk:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    map.get(i);
}
long end = System.nanoTime();
System.out.println(end - start);
```

Masalah:

1. Tidak ada warmup terkontrol.
2. JIT mungkin belum optimize.
3. JIT bisa menghapus pekerjaan jika hasil tidak dipakai.
4. Input terlalu predictable.
5. Tidak ada fork isolation.
6. Tidak ada statistical confidence.
7. Tidak ada allocation measurement.
8. Tidak memisahkan setup cost dari operation cost.
9. Garbage collection bisa mengganggu tanpa terlihat.
10. Data bisa selalu berada di CPU cache.

`nanoTime()` bukan salah. Yang salah adalah menganggap loop sederhana otomatis valid sebagai benchmark JVM.

---

## 7. Struktur Dasar JMH Benchmark

Contoh Maven dependency:

```xml
<dependencies>
    <dependency>
        <groupId>org.openjdk.jmh</groupId>
        <artifactId>jmh-core</artifactId>
        <version>1.37</version>
    </dependency>
    <dependency>
        <groupId>org.openjdk.jmh</groupId>
        <artifactId>jmh-generator-annprocess</artifactId>
        <version>1.37</version>
        <scope>provided</scope>
    </dependency>
</dependencies>
```

Contoh benchmark sederhana:

```java
package benchmark;

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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
@Fork(3)
public class ContainsBenchmark {

    @State(Scope.Thread)
    public static class Data {
        @Param({"10", "100", "1000", "10000"})
        int size;

        List<Integer> list;
        Set<Integer> set;
        int present;
        int absent;

        @Setup(Level.Trial)
        public void setup() {
            list = new ArrayList<>(size);
            set = new HashSet<>(size * 2);

            for (int i = 0; i < size; i++) {
                list.add(i);
                set.add(i);
            }

            present = size / 2;
            absent = -1;
        }
    }

    @Benchmark
    public boolean listContainsPresent(Data data) {
        return data.list.contains(data.present);
    }

    @Benchmark
    public boolean setContainsPresent(Data data) {
        return data.set.contains(data.present);
    }

    @Benchmark
    public boolean listContainsAbsent(Data data) {
        return data.list.contains(data.absent);
    }

    @Benchmark
    public boolean setContainsAbsent(Data data) {
        return data.set.contains(data.absent);
    }
}
```

Benchmark ini membandingkan `List.contains()` dan `Set.contains()` untuk ukuran berbeda dan dua kondisi:

1. key ada,
2. key tidak ada.

Kondisi present/absent penting karena linear scan punya cost berbeda tergantung posisi elemen.

---

## 8. Benchmark Mode: Apa yang Sebenarnya Diukur?

JMH menyediakan beberapa mode umum.

### 8.1 `Mode.Throughput`

Mengukur operasi per unit waktu.

Cocok untuk:

- cache lookup throughput,
- parser throughput,
- index lookup throughput,
- queue operation throughput.

Contoh interpretasi:

```text
10_000_000 ops/s
```

Artinya benchmark mampu melakukan sekitar 10 juta operasi per detik dalam kondisi pengujian.

### 8.2 `Mode.AverageTime`

Mengukur rata-rata waktu per operasi.

Cocok untuk operasi kecil yang ingin dibandingkan secara langsung.

Contoh:

```text
25 ns/op
```

Namun rata-rata bisa menipu jika distribusi latency memiliki outlier besar.

### 8.3 `Mode.SampleTime`

Mengambil sample waktu operasi dan bisa memberi distribusi.

Cocok saat ingin melihat latency distribution.

### 8.4 `Mode.SingleShotTime`

Mengukur waktu satu invocation.

Cocok untuk cold start, initialization, build index, load snapshot, atau operation besar.

### 8.5 Rekomendasi Praktis

Untuk DSA:

| Kebutuhan | Mode |
|---|---|
| operasi kecil sangat sering | `Throughput` atau `AverageTime` |
| tail latency operation | `SampleTime` |
| build index / initialize structure | `SingleShotTime` |
| batch algorithm | `AverageTime` atau `SingleShotTime` |

---

## 9. Warmup: Kenapa Iterasi Awal Tidak Bisa Langsung Dipercaya

JVM mengoptimalkan kode berdasarkan runtime profiling.

Pada awal execution:

1. bytecode mungkin interpreted,
2. method belum dianggap hot,
3. JIT belum compile,
4. profiling branch belum stabil,
5. inline decision belum matang,
6. class loading mungkin masih terjadi.

Setelah warmup:

1. hot methods dikompilasi,
2. branch prediction lebih stabil,
3. inline chain terbentuk,
4. allocation tertentu bisa dieliminasi,
5. virtual call bisa menjadi direct call jika profile mendukung.

Karena itu benchmark tanpa warmup sering mengukur startup behavior, bukan steady-state performance.

Namun ada catatan penting:

> Tidak semua workload mencapai steady state yang bersih.

Beberapa benchmark tetap fluktuatif karena GC, deoptimization, CPU scheduling, thermal throttling, atau profile yang tidak representatif.

Maka warmup bukan ritual formal. Warmup adalah cara mengurangi noise, bukan jaminan kebenaran.

---

## 10. Dead-Code Elimination: Benchmark yang Mengukur Ketiadaan

JIT compiler bisa menghapus code yang tidak berdampak pada observable behavior.

Benchmark buruk:

```java
@Benchmark
public void badBenchmark(Data data) {
    data.map.get(data.key);
}
```

Jika hasil `get()` tidak dipakai, JVM mungkin menganggap operasi itu tidak berdampak dan mengoptimalkan sebagian atau seluruhnya.

Lebih baik:

```java
@Benchmark
public Object goodBenchmark(Data data) {
    return data.map.get(data.key);
}
```

Atau gunakan `Blackhole`:

```java
@Benchmark
public void goodBenchmarkWithBlackhole(Data data, org.openjdk.jmh.infra.Blackhole blackhole) {
    blackhole.consume(data.map.get(data.key));
}
```

Rule:

> Hasil dari operasi yang diukur harus dikonsumsi atau dikembalikan.

Kalau tidak, Anda bisa saja sedang membandingkan “kode yang dihapus” dengan “kode yang tidak dihapus”.

---

## 11. Constant Folding: Benchmark yang Terlalu Mudah Ditebak

Benchmark buruk:

```java
@Benchmark
public int bad() {
    return 1 + 2;
}
```

JVM bisa mengganti ini menjadi konstanta `3`.

Contoh DSA yang juga bisa terlalu predictable:

```java
@Benchmark
public boolean contains() {
    return list.contains(42);
}
```

Jika list dan key selalu sama dan terlalu sederhana, benchmark bisa tidak merepresentasikan real lookup.

Gunakan state dan variasi input.

```java
@State(Scope.Thread)
public static class Data {
    List<Integer> list;
    int[] keys;
    int index;

    @Setup
    public void setup() {
        list = new ArrayList<>();
        for (int i = 0; i < 10_000; i++) {
            list.add(i);
        }
        keys = new int[10_000];
        for (int i = 0; i < keys.length; i++) {
            keys[i] = (i * 31) % 10_000;
        }
    }

    int nextKey() {
        int key = keys[index];
        index = (index + 1) % keys.length;
        return key;
    }
}
```

Dengan variasi key, benchmark lebih dekat ke real workload.

---

## 12. Benchmark State: Memisahkan Setup dari Operation

Kesalahan umum:

```java
@Benchmark
public boolean bad() {
    List<Integer> list = new ArrayList<>();
    for (int i = 0; i < 1000; i++) {
        list.add(i);
    }
    return list.contains(500);
}
```

Benchmark ini tidak hanya mengukur `contains()`. Ia mengukur:

1. allocation `ArrayList`,
2. allocation/boxing `Integer`,
3. population list,
4. contains.

Jika tujuan memang mengukur end-to-end build + query, itu sah.

Tetapi jika ingin mengukur `contains()`, setup harus dipindahkan ke `@Setup`.

```java
@State(Scope.Thread)
public static class Data {
    List<Integer> list;

    @Setup(Level.Trial)
    public void setup() {
        list = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            list.add(i);
        }
    }
}

@Benchmark
public boolean good(Data data) {
    return data.list.contains(500);
}
```

### 12.1 Setup Level

JMH punya beberapa setup level.

| Level | Makna |
|---|---|
| `Trial` | sekali per benchmark trial/fork |
| `Iteration` | sebelum setiap measurement iteration |
| `Invocation` | sebelum setiap benchmark invocation |

Gunakan `Invocation` dengan sangat hati-hati karena overhead setup bisa mengganggu measurement.

---

## 13. Fork: Menghindari Kontaminasi Antar-Benchmark

JMH `@Fork` menjalankan benchmark di JVM terpisah.

Contoh:

```java
@Fork(3)
```

Kenapa penting?

Karena JIT profile dari benchmark A bisa memengaruhi benchmark B jika berjalan di JVM yang sama.

Fork membantu:

1. mengisolasi classloading,
2. mengisolasi JIT profile,
3. mengurangi cross-benchmark contamination,
4. melihat variasi antar proses.

Untuk benchmark serius, hindari `@Fork(0)` kecuali saat debugging cepat.

---

## 14. Parameterization: Jangan Benchmark Satu Ukuran Saja

Struktur data sering berubah karakteristik tergantung ukuran.

Contoh:

- `ArrayList.contains()` bisa lebih cepat dari `HashSet.contains()` untuk ukuran sangat kecil karena overhead hash lebih besar daripada linear scan pendek.
- `TreeMap` bisa cukup kompetitif untuk ukuran kecil.
- `BitSet` bisa unggul untuk dense integer domain besar.
- `HashMap` bisa boros memory untuk data kecil.

Gunakan `@Param`.

```java
@Param({"8", "32", "128", "1024", "100000"})
int size;
```

Hasil benchmark satu ukuran tidak boleh digeneralisasi.

---

## 15. Data Distribution: Benchmark Harus Mewakili Pola Data

Data distribution sering lebih menentukan daripada struktur data.

### 15.1 Uniform Distribution

Setiap key punya peluang sama.

Cocok untuk:

- synthetic baseline,
- random lookup,
- evenly accessed ID.

### 15.2 Zipfian/Skewed Distribution

Beberapa key sangat sering diakses.

Cocok untuk:

- cache,
- product catalog,
- user session,
- lookup config populer,
- hot entity.

Skewed distribution bisa membuat cache terlihat sangat efektif.

### 15.3 Sorted/Almost Sorted Input

Cocok untuk:

- sorting benchmark,
- TimSort behavior,
- time-ordered events.

Sorting algorithm bisa sangat dipengaruhi input order.

### 15.4 Adversarial Input

Input yang sengaja buruk:

- banyak hash collision,
- comparator mahal,
- graph dengan cycle,
- tree sangat dalam,
- regex/pathological string,
- queue burst.

Production system harus diuji terhadap input buruk, bukan hanya happy path.

---

## 16. Operation Mix: Struktur Data Tidak Bisa Dinilai dari Satu Operasi

Contoh memilih antara sorted array dan `TreeMap`.

Sorted array:

- lookup binary search: `O(log n)`, sangat cache-friendly,
- insert/update: mahal karena rebuild/shift,
- range scan: bagus jika index sudah ditemukan.

`TreeMap`:

- lookup: `O(log n)`, pointer chasing,
- insert/update: `O(log n)`,
- range query: bagus,
- memory lebih besar.

Jika workload:

```text
99.9% read
0.1% rebuild all
```

sorted immutable array bisa sangat bagus.

Jika workload:

```text
70% read
30% incremental update
```

`TreeMap` mungkin lebih cocok.

Benchmark harus mengikuti operation mix.

Contoh JMH operation mix sederhana:

```java
@Benchmark
public int mixedWorkload(Data data) {
    int r = data.nextRandom();

    if ((r & 1023) < 900) { // ~88% exact lookup
        return data.lookupById(r);
    }

    if ((r & 1023) < 1000) { // ~10% range lookup
        return data.lookupByDeadline(r);
    }

    data.update(r); // ~2% update
    return 0;
}
```

Lebih baik lagi, gunakan trace realistis dari telemetry production yang sudah dianonimkan.

---

## 17. Allocation Rate: Sering Lebih Penting daripada Nanosecond per Operation

Banyak benchmark hanya melihat waktu.

Padahal di Java, allocation rate sering menjadi sinyal lebih penting.

Dua implementasi bisa punya average time mirip, tetapi allocation rate berbeda jauh.

Contoh:

```text
Implementation A: 80 ns/op, 0 B/op
Implementation B: 70 ns/op, 128 B/op
```

Dalam microbenchmark, B terlihat lebih cepat.

Dalam service production, B bisa memicu GC lebih sering, menyebabkan p99 latency lebih buruk.

### 17.1 Mengukur Allocation dengan JMH Profiler

JMH bisa dijalankan dengan profiler:

```bash
java -jar target/benchmarks.jar -prof gc
```

Output biasanya mencakup:

- allocation rate,
- allocation per operation,
- GC count,
- GC time.

Perhatikan metric seperti:

```text
·gc.alloc.rate.norm    64.000 B/op
```

Artinya setiap operasi mengalokasikan sekitar 64 byte.

Untuk DSA hot path, `B/op` sering harus sangat rendah, idealnya `0 B/op` untuk lookup yang sangat sering.

---

## 18. GC Pressure: DSA yang Cepat Bisa Membuat Tail Latency Buruk

Garbage collector modern sangat canggih, tetapi allocation tetap bukan gratis.

DSA yang banyak membuat object kecil bisa menyebabkan:

1. allocation rate tinggi,
2. young GC lebih sering,
3. remembered set/card marking cost,
4. promotion ke old generation,
5. fragmentation/compaction pressure,
6. p99 latency spike,
7. CPU overhead tambahan.

Contoh struktur yang bisa menghasilkan banyak object:

- `List<Integer>` untuk angka besar,
- `Map<RecordKey, Value>` dengan key object dibuat per lookup,
- stream pipeline yang membuat object intermediate,
- recursive algorithm dengan banyak temporary list,
- graph traversal yang membuat `new NodeState` per edge,
- string parsing dengan banyak `substring`,
- cache key yang dibangun dari concatenated string per request.

### 18.1 Hot Path Rule

Untuk hot path:

```text
Jangan hanya tanya “berapa cepat?”
Tanya juga “berapa banyak object baru per operasi?”
```

Jika lookup cache membuat key baru setiap request:

```java
String key = agency + ":" + module + ":" + status;
return cache.get(key);
```

Mungkin terlihat sederhana, tetapi bisa menciptakan allocation besar pada traffic tinggi.

Alternatif:

- gunakan structured key yang reusable jika aman,
- precompute key saat build config,
- gunakan enum/index mapping,
- gunakan nested map jika key cardinality rendah,
- gunakan primitive index jika domain dense.

---

## 19. JOL: Mengukur Object Layout dan Footprint

JOL membantu memahami ukuran object, alignment, reference, dan footprint graph.

Gunakan JOL saat ingin menjawab:

- Berapa ukuran satu node linked list?
- Berapa footprint `HashMap` berisi 100_000 entry?
- Berapa perbedaan `int[]` dan `ArrayList<Integer>`?
- Berapa overhead wrapper object?
- Berapa retained footprint structure tertentu?

Contoh penggunaan:

```java
import org.openjdk.jol.info.GraphLayout;
import org.openjdk.jol.info.ClassLayout;

import java.util.ArrayList;
import java.util.List;

public class JolExample {
    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            list.add(i);
        }

        System.out.println(ClassLayout.parseInstance(list).toPrintable());
        System.out.println(GraphLayout.parseInstance(list).toFootprint());
    }
}
```

### 19.1 Shallow Size vs Retained/Graph Footprint

`ClassLayout.parseInstance(list)` menunjukkan layout object `ArrayList` itu sendiri.

Tetapi `ArrayList` punya reference ke backing array, dan backing array punya reference ke elemen.

Untuk total graph, gunakan `GraphLayout`.

Mental model:

```text
shallow size = ukuran object itu sendiri
retained/graph footprint = object + object lain yang direferensikan dalam graph
```

### 19.2 Kenapa JOL Penting untuk DSA

Tanpa JOL, banyak engineer under-estimate memory overhead.

Contoh:

```java
record Edge(int from, int to, int weight) {}
List<Edge> edges = new ArrayList<>();
```

Secara konseptual, satu edge hanya tiga `int` = 12 byte.

Di Java object representation, `Edge` adalah object dengan header, alignment, dan reference dari list backing array.

Untuk jutaan edge, overhead object bisa dominan.

Alternatif:

```java
int[] from;
int[] to;
int[] weight;
```

Atau:

```java
long[] packedEdges;
```

Lebih rumit, tetapi footprint dan locality bisa jauh lebih baik.

---

## 20. CPU Cache Locality: Kenapa Array Sering Menang

CPU modern jauh lebih cepat daripada memory access acak.

Array punya locality bagus karena elemen berdekatan di memory.

Node-based structure seperti linked list/tree sering melakukan pointer chasing:

```text
node -> next -> next -> next
```

Setiap dereference bisa membawa cache miss.

Contoh:

- `ArrayList` scan linear bisa sangat cepat karena sequential memory access.
- `LinkedList` traversal bisa lambat meskipun insert/delete teorinya `O(1)` jika node sudah diketahui.
- `TreeMap` lookup `O(log n)` tetapi tiap step lompat ke object node berbeda.
- `HashMap` lookup average `O(1)` tetapi melibatkan hash, bucket array, node/object dereference, equality check.

### 20.1 Cache-Friendly Alternative

Untuk read-heavy sorted data:

```java
record Rule(LocalDate effectiveDate, String value) {}
Rule[] rules; // sorted by effectiveDate
```

Lookup:

```java
int index = binarySearchFloor(rules, date);
```

Walau `O(log n)`, array binary search bisa sangat efisien untuk data immutable.

Untuk dense integer state:

```java
int[] countsByStateOrdinal;
```

Lebih murah daripada:

```java
Map<State, Integer> countsByState;
```

Namun trade-off-nya adalah fleksibilitas dan readability.

---

## 21. Branch Prediction: Data Pattern Bisa Mengubah Performa

CPU mencoba menebak arah branch.

Kode seperti ini:

```java
if (value > threshold) {
    count++;
}
```

Jika kondisi sangat predictable, branch predictor bekerja baik.

Jika random, branch misprediction bisa mahal.

Dalam DSA, branch pattern muncul di:

- binary search,
- tree traversal,
- comparator,
- hash bucket equality chain,
- parsing,
- DP condition,
- graph traversal visited check,
- heap sift up/down.

Benchmark dengan data terlalu terurut bisa lebih baik daripada real random workload.

Benchmark dengan random workload bisa lebih buruk daripada real workload yang skewed.

Karena itu data distribution harus disengaja.

---

## 22. Boxing dan Primitive Specialization

Java Collections Framework bekerja dengan object, bukan primitive.

`List<Integer>` bukan `int[]`.

Masalah boxing:

1. object allocation,
2. reference indirection,
3. cache locality buruk,
4. memory footprint besar,
5. GC pressure,
6. equality/hash overhead.

Contoh hot path buruk:

```java
Map<Integer, Integer> frequency = new HashMap<>();
for (int value : values) {
    frequency.merge(value, 1, Integer::sum);
}
```

Ini expressive, tetapi bisa mahal untuk jutaan primitive values.

Alternatif jika domain dense:

```java
int[] frequency = new int[maxValue + 1];
for (int value : values) {
    frequency[value]++;
}
```

Alternatif jika domain sparse tetapi performance critical:

- primitive collection library,
- custom open-addressing int-to-int map,
- coordinate compression + array.

Dalam seri ini kita tetap fokus Java standard library, tetapi engineer top-tier harus tahu kapan standard collection tidak cukup.

---

## 23. Comparator Cost: `O(log n)` Bisa Mahal Jika Comparator Mahal

`TreeMap`, `TreeSet`, sorting, binary search dengan comparator semua bergantung pada comparison.

Jika comparator sederhana:

```java
Comparator.comparingInt(Rule::priority)
```

Biaya relatif kecil.

Jika comparator melakukan:

- string normalization,
- locale collation,
- date parsing,
- database lookup,
- regex,
- object allocation,
- chain panjang,

maka struktur data yang terlihat `O(log n)` atau sort `O(n log n)` bisa menjadi sangat mahal.

Contoh buruk:

```java
Comparator<Rule> badComparator = (a, b) -> {
    LocalDate da = LocalDate.parse(a.effectiveDateText());
    LocalDate db = LocalDate.parse(b.effectiveDateText());
    return da.compareTo(db);
};
```

Parsing dilakukan berkali-kali selama sort.

Lebih baik:

```java
record Rule(String id, LocalDate effectiveDate, int priority) {}
```

Precompute normalized comparable field saat ingestion.

Rule:

```text
Comparator harus murah, pure, deterministic, dan konsisten.
```

---

## 24. Hash Cost: `HashMap` Tidak Gratis

`HashMap.get(key)` membutuhkan:

1. hitung hash,
2. spread hash,
3. akses bucket,
4. cek key equality,
5. mungkin traverse chain/tree bin,
6. return value.

Jika key sederhana seperti `Integer`, murah.

Jika key adalah record kompleks:

```java
record CompositeKey(String agency, String module, String status, LocalDate date) {}
```

Maka `hashCode()` bisa menghitung hash beberapa field.

Jika key dibuat baru setiap lookup:

```java
cache.get(new CompositeKey(agency, module, status, date));
```

maka ada allocation per lookup.

Untuk hot path, pertimbangkan:

1. precomputed hash,
2. nested map,
3. enum ordinal mapping,
4. packed primitive key,
5. canonicalized key,
6. cache key object reuse jika aman,
7. avoid lookup key allocation.

Contoh packed key:

```java
static long pack(int agencyId, int moduleId, int statusId) {
    return ((long) agencyId << 32)
         | ((long) moduleId << 16)
         | (statusId & 0xFFFFL);
}
```

Namun packed key menambah complexity dan harus diuji dengan ketat.

---

## 25. Latency: Average Time Tidak Cukup

Production system jarang gagal karena average latency.

Seringnya gagal karena tail latency:

- p95,
- p99,
- p99.9,
- max.

Contoh:

```text
Implementation A:
  average 1 ms
  p99 2 ms

Implementation B:
  average 0.7 ms
  p99 80 ms
```

B terlihat lebih cepat secara rata-rata, tetapi lebih buruk untuk user/system SLA.

DSA bisa menyebabkan tail spike karena:

1. hash map resize,
2. cache eviction scan,
3. heap cleanup lazy deletion,
4. GC akibat allocation tinggi,
5. tree rebalance,
6. lock contention,
7. queue burst,
8. unbounded list growth,
9. sorting batch besar,
10. graph traversal pada komponen besar.

Jika sistem punya SLA, benchmark harus melihat distribution, bukan hanya average.

---

## 26. Resize Spike: Amortized `O(1)` Bukan Worst-Case `O(1)`

`ArrayList.add()` amortized `O(1)`, tetapi saat resize terjadi, backing array harus diperbesar dan elemen disalin.

`HashMap.put()` average `O(1)`, tetapi saat resize terjadi, internal table diperbesar dan entries dipindahkan/diatur ulang.

Dalam batch/offline process, spike mungkin tidak masalah.

Dalam low-latency request path, spike bisa terlihat di p99.

Mitigasi:

1. pre-size collection,
2. use bounded structure,
3. build off-thread lalu publish snapshot,
4. avoid growth di hot request path,
5. split large structure,
6. batch rebuild di maintenance window.

Contoh pre-size:

```java
int expectedSize = 100_000;
Map<String, Rule> byId = new HashMap<>((int) (expectedSize / 0.75f) + 1);
```

Tapi jangan over-size secara brutal karena memory juga mahal.

---

## 27. Profiling: Jangan Optimasi Berdasarkan Tebakan

Benchmark menjawab pertanyaan terkontrol.

Profiling menjawab:

> “Waktu dan memory sebenarnya habis di mana?”

Tool umum:

1. Java Flight Recorder/JDK Mission Control.
2. async-profiler.
3. Java Mission Control.
4. VisualVM untuk kasus sederhana.
5. YourKit/JProfiler untuk commercial profiler.
6. `jcmd` untuk diagnostic.
7. GC logs.
8. Micrometer/application metrics.

### 27.1 Profiling CPU

CPU profile membantu menemukan:

- method hot,
- comparator mahal,
- hashing mahal,
- parsing mahal,
- serialization mahal,
- lock contention,
- excessive copying,
- repeated sorting.

### 27.2 Profiling Allocation

Allocation profile membantu menemukan:

- object dibuat per request,
- temporary collection,
- boxing,
- string concatenation,
- stream/lambda allocations,
- regex object,
- iterator/object churn,
- cache key churn.

### 27.3 Profiling Lock/Thread

Relevant untuk concurrent data structure:

- blocked threads,
- lock contention,
- queue contention,
- executor saturation,
- synchronized hot path,
- concurrent map contention on hot key.

---

## 28. JFR untuk Validasi Runtime

Java Flight Recorder relevan karena bisa mengumpulkan data runtime JVM/application dengan overhead rendah jika dikonfigurasi dengan benar.

Untuk DSA performance, JFR dapat membantu melihat:

1. allocation hotspots,
2. GC pauses,
3. CPU hotspots,
4. lock contention,
5. thread states,
6. file/socket activity,
7. exception rate,
8. object allocation in new TLAB/outside TLAB,
9. method profiling sample.

Contoh menjalankan aplikasi dengan recording:

```bash
java \
  -XX:StartFlightRecording=filename=app.jfr,duration=120s,settings=profile \
  -jar app.jar
```

Atau menggunakan `jcmd` pada process berjalan:

```bash
jcmd <pid> JFR.start name=profile settings=profile duration=120s filename=app.jfr
```

Lalu analisis dengan JDK Mission Control.

### 28.1 Kapan JFR Lebih Berguna daripada JMH?

Gunakan JMH untuk pertanyaan kecil:

```text
Apakah `BitSet` lebih murah daripada `HashSet<Integer>` untuk membership dense domain?
```

Gunakan JFR untuk pertanyaan production-like:

```text
Kenapa endpoint eligibility-check p99 naik setelah rule index diganti?
```

JMH memberi insight controlled.

JFR memberi insight aktual.

Keduanya saling melengkapi.

---

## 29. Designing a DSA Benchmark: Template Kerja

Setiap kali membuat benchmark DSA, isi template ini.

```text
1. Decision yang ingin dibuat:
   - Struktur/algoritma apa yang dibandingkan?

2. Correctness invariant:
   - Apakah semua kandidat memenuhi semantics yang sama?

3. Operation mix:
   - read %, write %, range query %, rebuild %, delete %, scan %.

4. Data size:
   - small, medium, large, worst-case.

5. Data distribution:
   - uniform, skewed, sorted, random, adversarial.

6. Key/value model:
   - primitive, object, composite, mutable/immutable.

7. Metrics:
   - throughput, avg time, p99, allocation B/op, GC, memory footprint.

8. Setup vs measured path:
   - apa yang termasuk diukur?

9. Warmup/fork:
   - cukup atau tidak?

10. Production relevance:
   - benchmark ini mirip real workload atau hanya synthetic sanity check?

11. Decision rule:
   - kapan kandidat A dianggap menang?
```

Tanpa decision rule, benchmark bisa berubah menjadi angka tanpa arah.

---

## 30. Example 1: `ArrayList.contains` vs `HashSet.contains`

### 30.1 Premis Naif

Banyak orang langsung berkata:

```text
HashSet pasti lebih cepat karena O(1), ArrayList O(n).
```

Itu sering benar untuk ukuran besar.

Tapi untuk ukuran kecil, overhead hash bisa lebih besar daripada linear scan pendek.

### 30.2 Benchmark Design

Ukuran:

```text
8, 32, 128, 1024, 100000
```

Kasus:

1. present near beginning,
2. present middle,
3. present near end,
4. absent,
5. random mixed.

Metric:

1. ns/op,
2. allocation B/op,
3. memory footprint.

### 30.3 Engineering Interpretation

Jika collection berisi kurang dari 16 elemen dan sering discan, `ArrayList` mungkin cukup.

Jika membership check sangat sering dan ukuran ratusan/ribuan, `HashSet` biasanya lebih tepat.

Jika ordering dibutuhkan, mungkin butuh kombinasi:

```java
List<Item> orderedItems;
Set<ItemId> membershipIndex;
```

Atau gunakan satu source of truth + derived index.

---

## 31. Example 2: `TreeMap` vs Sorted Array for Effective-Date Lookup

### 31.1 Problem

Kita punya rule berdasarkan tanggal efektif.

Operation:

```text
lookup rule yang berlaku pada tanggal X
```

Ini bukan exact lookup. Ini floor lookup.

### 31.2 Kandidat

#### Kandidat A: `TreeMap<LocalDate, Rule>`

```java
Rule rule = rules.floorEntry(date).getValue();
```

Kelebihan:

- API langsung,
- update incremental mudah,
- range operation tersedia.

Kekurangan:

- node object,
- pointer chasing,
- memory overhead.

#### Kandidat B: sorted array + binary search

```java
int idx = floorIndex(effectiveDates, date);
Rule rule = rules[idx];
```

Kelebihan:

- compact,
- cache-friendly,
- immutable snapshot mudah.

Kekurangan:

- update incremental mahal,
- implementasi manual,
- perlu hati-hati boundary.

### 31.3 Benchmark Harus Memisahkan

1. lookup cost,
2. build cost,
3. update cost,
4. memory footprint,
5. concurrency/publish snapshot cost.

Jika rule config rebuild hanya setiap deployment atau refresh periodik, sorted array bisa sangat menarik.

Jika rule sering berubah per request/admin action, `TreeMap` bisa lebih realistis.

---

## 32. Example 3: Graph Representation Benchmark

### 32.1 Problem

Kita ingin melakukan impact analysis pada dependency graph antar entity.

Kandidat:

1. `Map<EntityId, List<EntityId>>`.
2. `Map<String, List<String>>`.
3. integer ID compression + `int[][]` adjacency.
4. integer ID compression + compressed adjacency arrays.

### 32.2 Operation

- build graph,
- BFS from changed entity,
- cycle detection,
- connected component,
- repeated reachability query.

### 32.3 Yang Harus Diukur

1. memory footprint,
2. BFS throughput,
3. allocation per traversal,
4. build time,
5. cost converting external ID to dense index,
6. readability/maintainability.

### 32.4 Interpretasi

Untuk graph kecil/medium, object representation mungkin cukup dan lebih maintainable.

Untuk graph besar dan hot traversal, dense integer representation bisa jauh lebih cepat dan hemat memory.

Namun dense representation butuh index mapping, lifecycle, dan debug tooling.

---

## 33. Example 4: Cache Benchmark Bukan Hanya Hit Rate

Cache benchmark harus mengukur:

1. hit latency,
2. miss latency,
3. key creation allocation,
4. eviction cost,
5. expiration cost,
6. stampede behavior,
7. concurrent access,
8. memory footprint,
9. p99 under burst.

Benchmark yang hanya mengukur:

```java
cache.get(existingKey)
```

tidak cukup.

Cache production lebih banyak gagal karena:

- unbounded growth,
- stampede,
- stale data,
- hot key contention,
- eviction storm,
- expensive loader,
- wrong key semantics,
- hidden allocation.

---

## 34. Example 5: Parser/String Algorithm Benchmark

String algorithm benchmark harus berhati-hati pada:

1. input length,
2. charset/code point,
3. match position,
4. no match case,
5. repeated pattern,
6. adversarial input,
7. regex compilation,
8. substring allocation,
9. `StringBuilder` reuse,
10. compact string representation.

Contoh benchmark buruk:

```java
@Benchmark
public boolean bad() {
    return "abc:def:ghi".contains(":");
}
```

Input terlalu kecil dan konstanta.

Benchmark lebih baik:

- generate input bervariasi,
- ukur short/medium/long string,
- pisahkan compile regex dari match,
- ukur allocation,
- test no-match dan match-at-end.

---

## 35. Benchmarking Concurrent Data Structures

Concurrent DSA lebih sulit karena hasil dipengaruhi:

1. jumlah thread,
2. read/write ratio,
3. key distribution,
4. hot key contention,
5. CPU core count,
6. false sharing,
7. scheduler OS,
8. GC,
9. memory barrier,
10. blocking vs non-blocking behavior.

### 35.1 Contoh Kesalahan

Benchmark `ConcurrentHashMap` dengan key random uniform bisa terlihat sangat baik.

Production workload mungkin punya hot key:

```text
90% traffic ke 1% key
```

Ini bisa menyebabkan contention di path tertentu, loader stampede, atau atomic update bottleneck.

### 35.2 Read/Write Ratio

Benchmark minimal harus punya variasi:

```text
100% read
95% read / 5% write
80% read / 20% write
50% read / 50% write
hot key update
```

### 35.3 False Sharing dan Counter

Untuk counter per bucket/partition, hindari beberapa hot counters berada di cache line yang sama jika update sangat tinggi.

Java menyediakan beberapa utility seperti `LongAdder` untuk high-contention counters, tetapi struktur data tetap harus dirancang berdasarkan contention model.

---

## 36. Measurement Environment: Stabilkan Sebelum Percaya Angka

Benchmark sensitif terhadap environment.

Perhatikan:

1. CPU governor/power mode.
2. Background process.
3. Thermal throttling.
4. Container CPU quota.
5. NUMA effect.
6. JVM version.
7. GC algorithm.
8. Heap size.
9. OS.
10. Hardware.
11. Cloud noisy neighbor.

Untuk benchmark serius, catat environment:

```text
JDK: 25.0.x
OS: Linux x86_64
CPU: ...
Memory: ...
GC: G1/ZGC/...
Heap: -Xms4g -Xmx4g
JMH: 1.37
Fork: 3
Warmup: 5 x 1s
Measurement: 10 x 1s
```

Tanpa metadata, hasil benchmark sulit direproduksi.

---

## 37. JVM Options untuk Benchmark

Jangan sembarangan menambahkan JVM flags hanya untuk “membuat cepat”.

Tetapi untuk reproducibility, sering berguna mengatur heap:

```bash
-Xms4g -Xmx4g
```

Kenapa?

Jika heap bisa tumbuh dinamis, benchmark bisa mengukur efek resize heap.

Untuk allocation-heavy benchmark, heap terlalu kecil bisa membuat GC mendominasi.

Untuk low-allocation benchmark, heap besar bisa mengurangi noise GC.

Namun jika production heap kecil, benchmark dengan heap besar bisa misleading.

Rule:

```text
Benchmark environment harus sesuai pertanyaan.
```

Jika ingin mengukur raw algorithm cost, stabilkan heap.

Jika ingin mengukur production behavior, gunakan setting production-like.

---

## 38. Reading Benchmark Results

Contoh hasil:

```text
Benchmark                         (size)  Mode  Cnt     Score    Error   Units
listContainsPresent                   32  avgt   30    18.200 ±  0.500   ns/op
setContainsPresent                    32  avgt   30    22.700 ±  0.800   ns/op
listContainsPresent                10000  avgt   30  3300.000 ± 40.000   ns/op
setContainsPresent                 10000  avgt   30    28.500 ±  1.100   ns/op
```

Interpretasi:

- untuk size 32, list bisa lebih cepat,
- untuk size 10_000, set jauh lebih cepat,
- error menunjukkan variasi measurement,
- jangan ambil angka tunggal tanpa melihat confidence/error.

### 38.1 Perhatikan Satuan

JMH bisa memakai:

- ns/op,
- us/op,
- ms/op,
- ops/s.

Jangan membandingkan tanpa memperhatikan unit.

### 38.2 Perhatikan Error

Jika hasil:

```text
A: 10.0 ± 3.0 ns/op
B: 11.0 ± 3.0 ns/op
```

Jangan klaim A pasti lebih cepat. Variasi terlalu overlap.

Jika hasil:

```text
A: 10.0 ± 0.2 ns/op
B: 30.0 ± 0.5 ns/op
```

Lebih kuat.

---

## 39. Memory Footprint Decision

Kecepatan bukan satu-satunya faktor.

Misal:

| Struktur | Lookup | Memory | Update | Notes |
|---|---:|---:|---:|---|
| `HashMap` | cepat | tinggi | cepat | exact lookup |
| `TreeMap` | sedang | tinggi | sedang | ordered/range |
| sorted array | cepat untuk read | rendah | mahal | read-mostly snapshot |
| primitive arrays | sangat cepat | rendah | manual | domain dense |
| object graph | sedang | tinggi | fleksibel | maintainable |

Jika sistem punya 1 juta entity, memory bisa lebih penting daripada nanosecond.

Memory tinggi dapat menyebabkan:

1. heap lebih besar,
2. GC lebih berat,
3. cache miss lebih banyak,
4. container memory pressure,
5. OOM risk,
6. deployment cost lebih tinggi.

---

## 40. Decision Matrix: Memilih Berdasarkan Bukti

Contoh matrix untuk memilih struktur index by deadline.

| Criteria | `PriorityQueue` | `TreeMap<Instant, List<Task>>` | Sorted Array Snapshot |
|---|---:|---:|---:|
| Next due task | sangat bagus | bagus | bagus |
| Remove arbitrary task | sulit | sedang | sulit |
| Update due date | lazy deletion/manual | lebih mudah | rebuild |
| Range query | buruk | bagus | bagus |
| Memory | sedang | tinggi | rendah-sedang |
| Read-mostly | bagus | bagus | sangat bagus |
| Frequent updates | sedang | bagus | buruk |
| Deterministic iteration | heap tidak sorted | sorted | sorted |

Benchmark harus mengisi angka pada matrix, tetapi keputusan tetap mempertimbangkan semantics.

---

## 41. Jangan Benchmark Implementasi yang Tidak Equivalent

Kesalahan besar: membandingkan dua struktur yang tidak punya semantics sama.

Contoh:

```text
HashMap vs TreeMap
```

Jika requirement membutuhkan floor lookup, `HashMap` bukan kandidat equivalent.

Contoh lain:

```text
ArrayList vs LinkedHashSet
```

Jika requirement butuh uniqueness, `ArrayList` bukan kandidat equivalent kecuali ditambah duplicate handling.

Rule:

```text
Correctness equivalence dulu, performance comparison kemudian.
```

Jika semantics berbeda, benchmark bisa tetap dilakukan, tetapi harus jujur bahwa yang dibandingkan adalah desain berbeda, bukan drop-in replacement.

---

## 42. Benchmarking Build Cost vs Query Cost

Banyak DSA punya dua biaya:

1. biaya membangun struktur,
2. biaya menggunakan struktur.

Contoh:

- sort dulu, lalu binary search,
- build trie, lalu prefix query,
- build graph adjacency, lalu BFS,
- build index map, lalu lookup,
- build DP table, lalu answer query,
- build cache snapshot, lalu serve read.

Jika hanya satu query, build index mungkin tidak worth it.

Jika jutaan query, build index sangat worth it.

Formula sederhana:

```text
Total cost = build cost + query count × query cost
```

Misal:

```text
Linear scan:
  build = 0 ms
  query = 1 ms

Indexed:
  build = 500 ms
  query = 0.01 ms
```

Break-even:

```text
500 + 0.01q < 1q
500 < 0.99q
q > 505
```

Jika query lebih dari 505 kali, index menang.

Ini mental model penting untuk deciding precomputation.

---

## 43. Benchmarking Precomputation

Precomputation sering mengubah runtime cost.

Contoh:

- precompute lowercased string,
- precompute hash,
- precompute normalized key,
- precompute adjacency list,
- precompute sorted rule arrays,
- precompute enum ordinal mapping,
- precompute bit masks.

Benchmark harus memasukkan dua mode:

1. full cost including precomputation,
2. steady-state query cost after precomputation.

Jangan menyembunyikan build cost jika build terjadi sering.

---

## 44. Production Telemetry: Benchmark Terbaik Adalah yang Terkoneksi dengan Realita

Benchmark synthetic berguna, tapi production telemetry memberi konteks.

Data yang sebaiknya dikumpulkan:

1. collection sizes,
2. operation frequency,
3. key distribution,
4. query range size,
5. hit/miss rate,
6. update rate,
7. p95/p99 latency,
8. allocation rate,
9. GC pause,
10. queue depth,
11. cache eviction count,
12. retry count,
13. timeout count,
14. payload size.

Contoh metric:

```text
rule_index.size
rule_index.lookup.count
rule_index.lookup.duration
rule_index.rebuild.duration
rule_index.cache.hit
rule_index.cache.miss
case_graph.traversal.nodes_visited
case_graph.traversal.duration
escalation_queue.depth
```

Tanpa telemetry, benchmark hanya asumsi.

---

## 45. Regression Benchmarking

Setelah memilih DSA, benchmark bisa dijadikan guardrail.

Contoh regression guard:

```text
Rule index lookup p95 tidak boleh naik >20%.
Allocation per lookup harus tetap 0 B/op.
Build snapshot untuk 100_000 rules harus <500 ms.
Memory footprint tidak boleh naik >15%.
```

Namun hati-hati memasukkan microbenchmark ke CI biasa karena hasil bisa flaky di shared runners.

Strategi:

1. benchmark nightly di dedicated runner,
2. simpan trend,
3. bandingkan secara statistik,
4. jangan fail build karena noise kecil,
5. fail hanya untuk regresi besar.

---

## 46. Testing Correctness Sebelum Benchmark

Benchmark cepat tapi salah tidak berguna.

Sebelum benchmark, buat correctness test:

1. compare against simple reference implementation,
2. randomized test,
3. boundary test,
4. adversarial test,
5. mutation test jika relevan,
6. invariant assertion.

Contoh:

```java
@Test
void sortedArrayFloorMatchesTreeMap() {
    NavigableMap<LocalDate, String> reference = new TreeMap<>();
    reference.put(LocalDate.parse("2024-01-01"), "A");
    reference.put(LocalDate.parse("2024-06-01"), "B");

    EffectiveDateIndex index = EffectiveDateIndex.from(reference);

    for (LocalDate date = LocalDate.parse("2023-12-01");
         date.isBefore(LocalDate.parse("2025-01-01"));
         date = date.plusDays(1)) {

        var expected = reference.floorEntry(date);
        var actual = index.lookup(date);

        assertEquals(expected == null ? null : expected.getValue(), actual);
    }
}
```

Reference implementation boleh lambat. Tugasnya memastikan correctness.

---

## 47. Common Benchmarking Anti-Patterns

### 47.1 Benchmark tanpa Warmup

Mengukur interpreted/cold behavior padahal target steady-state.

### 47.2 Benchmark Hasil Tidak Dipakai

JIT menghapus pekerjaan.

### 47.3 Benchmark Input Konstan

JIT melakukan constant folding atau profile terlalu sempit.

### 47.4 Benchmark Satu Ukuran

Menggeneralisasi dari `n=1000` ke semua ukuran.

### 47.5 Benchmark Tanpa Allocation Metric

Mengabaikan GC pressure.

### 47.6 Benchmark Tanpa Correctness Equivalence

Membandingkan struktur yang semantics-nya berbeda.

### 47.7 Benchmark Terlalu Synthetic

Input tidak mirip production.

### 47.8 Benchmark di Laptop Sibuk

Hasil dipengaruhi background process, thermal throttling, browser, IDE.

### 47.9 Benchmark Micro Langsung Dianggap Production Truth

Microbenchmark hanya satu sinyal.

### 47.10 Optimasi DSA Sebelum Profiling

Mengoptimasi bagian yang bukan bottleneck.

---

## 48. DSA Optimization Playbook

Saat performa bermasalah, gunakan urutan ini.

### Step 1 — Define Symptom

```text
Apa yang buruk?
- average latency?
- p99 latency?
- CPU?
- memory?
- GC?
- throughput?
- timeout?
- queue backlog?
```

### Step 2 — Profile

Cari bottleneck aktual.

### Step 3 — Identify Data Structure Hotspot

Contoh:

- repeated list scan,
- map key allocation,
- sort per request,
- graph rebuild per request,
- cache stampede,
- linked node traversal,
- string parsing repeated,
- recursive allocation.

### Step 4 — Define Candidate Alternatives

Misal:

- list scan -> map index,
- repeated sort -> pre-sorted snapshot,
- object key -> primitive packed key,
- recursive traversal -> iterative stack,
- `HashSet<Integer>` -> `BitSet`,
- `TreeMap` -> sorted array snapshot,
- unbounded cache -> Caffeine/bounded cache.

### Step 5 — Prove Correctness

Buat test against reference.

### Step 6 — Benchmark

Micro + meso.

### Step 7 — Validate in Staging/Production-Like Load

JFR, metrics, load test.

### Step 8 — Roll Out Safely

Feature flag, canary, metric comparison.

---

## 49. Practical Heuristics untuk Engineer

### 49.1 Jangan Optimasi Struktur Data yang Ukurannya Kecil dan Tidak Hot

Jika list berisi 5 item dan dipanggil 10 kali per menit, readability menang.

### 49.2 Optimasi Hot Path yang Dipanggil Jutaan Kali

Jika allocation 64 B/op pada 100_000 ops/s:

```text
64 × 100_000 = 6.4 MB/s allocation
```

Dalam satu menit:

```text
384 MB allocation
```

Dalam satu jam:

```text
23 GB allocation
```

Itu bisa signifikan.

### 49.3 Precompute Jika Read-Mostly

Read-heavy system sering cocok dengan immutable snapshot dan derived indexes.

### 49.4 Jangan Gunakan Struktur Lebih Kompleks Tanpa Bukti

Segment tree, trie, packed array, custom hash map bisa berguna, tetapi juga meningkatkan maintenance cost.

### 49.5 Ukur Memory, Bukan Hanya CPU

Memory footprint sering menjadi bottleneck tersembunyi di Java.

### 49.6 Tail Latency Lebih Penting untuk User-Facing System

Average improvement tidak cukup jika p99 memburuk.

### 49.7 Benchmark Harus Mengikuti Decision

Jika decision-nya production cache, benchmark hit-only tidak cukup.

---

## 50. Mini Capstone: Benchmark Rule Lookup Engine

### 50.1 Problem

Kita punya rule engine sederhana.

Rule punya:

```java
record Rule(
    String id,
    String agency,
    String module,
    String status,
    LocalDate effectiveDate,
    int priority
) {}
```

Query:

```text
Cari rule tertinggi untuk agency/module/status pada tanggal tertentu.
```

### 50.2 Kandidat Desain

#### Design A — Linear Scan

```java
List<Rule> rules;
```

Query scan semua rule dan filter.

Kelebihan:

- sederhana,
- mudah benar,
- build cost nol.

Kekurangan:

- `O(n)` per query,
- buruk untuk rule banyak dan query sering.

#### Design B — HashMap Composite Key to Sorted Rules

```java
Map<Key, Rule[]> byKey;
```

`Rule[]` sorted by effectiveDate/priority.

Kelebihan:

- lookup key cepat,
- binary search per group,
- read-mostly bagus.

Kekurangan:

- build cost,
- key design penting,
- update incremental lebih sulit.

#### Design C — Nested Map

```java
Map<String, Map<String, Map<String, Rule[]>>> index;
```

Kelebihan:

- menghindari composite key allocation saat lookup jika careful,
- bisa cocok untuk bounded dimensions.

Kekurangan:

- verbose,
- memory overhead nested maps,
- traversal rumit.

#### Design D — Enum/Integer Compressed Index

Jika agency/module/status bisa dikompresi ke integer:

```java
Rule[][][] index;
```

atau packed long key.

Kelebihan:

- sangat cepat,
- compact jika dense.

Kekurangan:

- hanya cocok jika domain terkendali,
- lebih sulit maintain/debug.

### 50.3 Benchmark Workload

```text
Rule count: 1_000, 10_000, 100_000
Query count: 1_000_000
Distribution: 80% hot key, 20% random key
Date distribution: mostly current date, some historical dates
Update frequency: none for steady-state benchmark
Metrics:
- throughput
- avg ns/op
- p99 if sampled
- allocation B/op
- build time
- memory footprint
```

### 50.4 Decision Example

Jika hasil:

```text
Linear scan:
  lookup 50 us/op
  allocation 0 B/op
  build 0 ms
  memory low

HashMap + sorted array:
  lookup 80 ns/op
  allocation 0 B/op
  build 200 ms
  memory medium

Nested map:
  lookup 65 ns/op
  allocation 0 B/op
  build 250 ms
  memory high

Compressed index:
  lookup 15 ns/op
  allocation 0 B/op
  build 300 ms
  memory low if dense
```

Keputusan tidak otomatis memilih compressed index.

Jika domain berubah sering dan maintainability penting, HashMap + sorted array bisa menjadi sweet spot.

Jika latency super critical dan domain benar-benar bounded, compressed index layak.

Jika rule count kecil, linear scan bisa cukup.

---

## 51. Checklist Sebelum Mengganti Struktur Data

Sebelum mengganti DSA di production code, jawab:

```text
1. Bottleneck sudah terbukti dari profiling?
2. Struktur baru memenuhi semantics yang sama?
3. Ada correctness test against reference?
4. Ada benchmark dengan data size realistis?
5. Ada benchmark dengan distribution realistis?
6. Ada allocation measurement?
7. Ada memory footprint measurement?
8. Ada p95/p99 consideration?
9. Ada failure mode analysis?
10. Ada fallback/rollback strategy?
11. Kompleksitas kode masih bisa dipelihara?
12. Tim memahami invariants struktur baru?
```

Jika banyak jawaban “belum”, optimasi masih prematur.

---

## 52. Red Flags dalam Review Kode DSA Performance

Waspadai hal berikut:

```java
list.contains(x) di dalam loop besar
```

```java
stream().filter(...).findFirst() dipanggil per request pada list besar
```

```java
new CompositeKey(...) setiap lookup hot path
```

```java
Collections.sort(...) per request
```

```java
Pattern.compile(...) per invocation
```

```java
new ArrayList<>() untuk temporary result kecil di hot path
```

```java
Map<String, Object> sebagai struktur internal performance-critical
```

```java
LinkedList untuk queue biasa
```

```java
unbounded HashMap sebagai cache
```

```java
recursive traversal pada graph/tree dari input eksternal
```

```java
PriorityQueue dengan element priority yang dimutasi setelah masuk queue
```

```java
TreeMap comparator melakukan parsing/string normalization
```

```java
HashMap key mutable
```

Semua ini bukan otomatis salah, tetapi harus memicu pertanyaan performance/correctness.

---

## 53. Performance Engineering Mindset

Engineer biasa bertanya:

```text
Struktur data mana yang paling cepat?
```

Engineer kuat bertanya:

```text
Untuk invariant ini, operation mix ini, data distribution ini, latency budget ini, memory budget ini, dan update pattern ini, struktur mana yang paling tepat?
```

Engineer biasa melihat Big-O.

Engineer kuat melihat:

```text
Big-O + constant factor + allocation + memory + locality + GC + p99 + maintainability.
```

Engineer biasa membuat benchmark kecil lalu percaya penuh.

Engineer kuat membuat:

1. correctness reference,
2. microbenchmark,
3. meso-benchmark,
4. profiling,
5. production telemetry,
6. regression guard.

---

## 54. Ringkasan Utama

1. Big-O penting, tetapi tidak cukup untuk Java performance.
2. JVM melakukan banyak optimasi dinamis, sehingga benchmark manual mudah salah.
3. Gunakan JMH untuk microbenchmark.
4. Gunakan JOL untuk object layout dan footprint.
5. Gunakan JFR/profiler untuk runtime behavior aktual.
6. Ukur allocation rate, bukan hanya waktu.
7. Perhatikan p95/p99 latency, bukan hanya average.
8. Data distribution dan operation mix harus realistis.
9. Correctness equivalence harus dipastikan sebelum performance comparison.
10. Struktur data terbaik tergantung workload, bukan nama struktur.
11. Optimasi yang meningkatkan average tetapi memperburuk tail latency bisa salah.
12. Performance decision harus berbasis bukti, bukan mitos.

---

## 55. Latihan

### Latihan 1 — Benchmark Membership

Buat JMH benchmark untuk membandingkan:

1. `ArrayList<Integer>.contains`,
2. `HashSet<Integer>.contains`,
3. `BitSet.get`,
4. `boolean[]`.

Gunakan ukuran:

```text
32, 1024, 1000000
```

Ukur:

1. present key,
2. absent key,
3. random mixed key,
4. allocation B/op.

Analisis kapan masing-masing menang.

### Latihan 2 — Effective-Date Lookup

Implementasikan dua index:

1. `TreeMap<LocalDate, Rule>`.
2. sorted array + binary search floor.

Benchmark:

1. build time,
2. lookup time,
3. memory footprint,
4. update cost.

Tulis decision matrix.

### Latihan 3 — Composite Key Allocation

Bandingkan:

1. `Map<CompositeKey, Value>` dengan `new CompositeKey` per lookup.
2. nested map.
3. packed long key jika domain integer.

Ukur allocation B/op dan throughput.

### Latihan 4 — Graph Representation

Bandingkan BFS pada:

1. `Map<String, List<String>>`,
2. `Map<Integer, int[]>`,
3. compressed adjacency array.

Gunakan graph dengan:

1. 1_000 nodes,
2. 100_000 nodes,
3. sparse edges,
4. skewed high-degree nodes.

### Latihan 5 — Cache Benchmark

Buat benchmark cache sederhana:

1. unbounded map,
2. `LinkedHashMap` LRU,
3. cache dengan TTL passive expiration.

Ukur:

1. hit latency,
2. miss latency,
3. eviction cost,
4. memory growth,
5. allocation.

---

## 56. Practical Checklist untuk Part Berikutnya

Part berikutnya akan membahas DSA anti-patterns dan failure modes. Agar siap, pegang checklist ini:

```text
Saat melihat kode yang lambat:
1. Cari nested scan.
2. Cari repeated sorting.
3. Cari per-request allocation.
4. Cari unbounded collection.
5. Cari wrong collection semantics.
6. Cari mutable key/comparator bug.
7. Cari cache tanpa eviction.
8. Cari recursive traversal tanpa depth guard.
9. Cari hot map dengan expensive key.
10. Cari benchmark/profiling evidence sebelum rewrite.
```

---

## 57. Referensi

- Oracle Java Collections Framework Overview: unified architecture untuk collection interfaces, implementations, dan algorithms.
- Java SE `java.util` API: `ArrayList`, `HashMap`, `TreeMap`, `PriorityQueue`, `ArrayDeque`, `BitSet`, `Collections`, `Arrays`.
- OpenJDK JMH: Java Microbenchmark Harness untuk benchmark JVM.
- Oracle article: Avoiding Benchmarking Pitfalls on the JVM.
- OpenJDK JOL: Java Object Layout untuk object layout dan footprint.
- Java Flight Recorder / JDK Mission Control documentation.
- Research literature on JVM warmup and misleading microbenchmarks.

---

## 58. Status Seri

Part ini adalah **Part 028 dari 030**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-dsa-part-029.md
```

Judul:

```text
DSA Anti-Patterns and Failure Modes in Java Systems
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java DSA — Part 027](./learn-java-dsa-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 029 — DSA Anti-Patterns and Failure Modes in Java Systems](./learn-java-dsa-part-029.md)
