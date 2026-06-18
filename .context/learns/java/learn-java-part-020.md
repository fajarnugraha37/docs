# learn-java-part-020.md

# Bagian 20 — Advanced Performance Engineering di Java

> Target pembaca: software engineer yang sudah memahami Java language, JVM, GC, concurrency, I/O, observability, dan cloud deployment dasar.
>
> Target hasil: kamu mampu menganalisis, mengukur, menjelaskan, memperbaiki, dan menjaga performa Java system secara ilmiah: bukan berdasarkan feeling, bukan berdasarkan benchmark palsu, dan bukan sekadar “pakai struktur data yang katanya cepat”.

---

## Daftar Isi

1. [Orientasi: Performance Engineering Bukan Sekadar Optimasi Kode](#1-orientasi-performance-engineering-bukan-sekadar-optimasi-kode)
2. [Mental Model Besar: Work, Resource, Queue, dan Constraint](#2-mental-model-besar-work-resource-queue-dan-constraint)
3. [Bahasa Dasar Performance: Latency, Throughput, Tail, Utilization](#3-bahasa-dasar-performance-latency-throughput-tail-utilization)
4. [Queueing Theory untuk Engineer Java](#4-queueing-theory-untuk-engineer-java)
5. [JVM Performance Model](#5-jvm-performance-model)
6. [Warmup, JIT, Profiling Feedback, dan Deoptimization](#6-warmup-jit-profiling-feedback-dan-deoptimization)
7. [Allocation Performance](#7-allocation-performance)
8. [Boxing, Primitive, Object Churn, dan Data-Oriented Thinking](#8-boxing-primitive-object-churn-dan-data-oriented-thinking)
9. [CPU Performance: Cache, Branch, Instruction, dan Memory Access](#9-cpu-performance-cache-branch-instruction-dan-memory-access)
10. [False Sharing dan Contention](#10-false-sharing-dan-contention)
11. [Locking, Synchronization, dan Coordination Cost](#11-locking-synchronization-dan-coordination-cost)
12. [I/O Performance: Blocking, Async, Streaming, dan Backpressure](#12-io-performance-blocking-async-streaming-dan-backpressure)
13. [Virtual Threads dan Performance](#13-virtual-threads-dan-performance)
14. [GC dan Performance](#14-gc-dan-performance)
15. [Benchmarking dengan JMH](#15-benchmarking-dengan-jmh)
16. [Macrobenchmark, Load Test, dan Capacity Test](#16-macrobenchmark-load-test-dan-capacity-test)
17. [Profiling: CPU, Allocation, Wall-Clock, Lock, I/O](#17-profiling-cpu-allocation-wall-clock-lock-io)
18. [Java Flight Recorder dan JDK Mission Control untuk Performance](#18-java-flight-recorder-dan-jdk-mission-control-untuk-performance)
19. [Vector API dan SIMD di Java 25](#19-vector-api-dan-simd-di-java-25)
20. [Performance Design Patterns](#20-performance-design-patterns)
21. [Performance Anti-Patterns](#21-performance-anti-patterns)
22. [Performance Review Checklist](#22-performance-review-checklist)
23. [Incident Playbook: Dari Symptom ke Root Cause](#23-incident-playbook-dari-symptom-ke-root-cause)
24. [Latihan Bertahap](#24-latihan-bertahap)
25. [Mini Project: Java Performance Lab](#25-mini-project-java-performance-lab)
26. [Referensi Resmi dan Lanjutan](#26-referensi-resmi-dan-lanjutan)

---

# 1. Orientasi: Performance Engineering Bukan Sekadar Optimasi Kode

Banyak engineer memulai performance dari pertanyaan yang salah:

```text
Kode mana yang bisa dibuat lebih cepat?
```

Pertanyaan yang lebih benar:

```text
Apa bottleneck sistem?
Apa resource yang habis?
Apa constraint bisnis/SLO?
Apa evidence-nya?
Apa perubahan terkecil yang memperbaiki constraint tanpa merusak correctness?
```

Performance engineering bukan sekadar:

- mengganti `for` dengan `stream`;
- mengganti `List` dengan `Set`;
- menambah thread pool;
- mengganti GC;
- menaikkan heap;
- menambah pod;
- memakai cache;
- memakai async;
- memakai virtual thread;
- memakai native image;
- memakai Vector API.

Semua itu bisa membantu, tetapi juga bisa memperburuk kalau bottleneck-nya salah dipahami.

## 1.1 Performance adalah property sistem

Performance Java service ditentukan oleh gabungan:

```text
algorithm
+ data structure
+ allocation behavior
+ CPU/cache behavior
+ JIT optimization
+ GC behavior
+ thread scheduling
+ lock/coordination
+ I/O latency
+ downstream capacity
+ database query
+ serialization
+ network
+ container CPU/memory
+ autoscaling
+ observability
+ traffic shape
```

Karena itu, performance bug sering bukan bug satu method. Ia bisa muncul dari interaksi:

```text
endpoint lambat
  karena DB pool penuh
    karena HPA menambah pod
      karena tiap pod punya maxPoolSize terlalu besar
        karena query lambat
          karena index salah
            karena pagination tidak bounded
```

Atau:

```text
latency spike
  karena CPU throttling
    karena CPU limit rendah
      karena JIT + GC + app thread berebut quota
        karena load meningkat
          karena autoscaler terlambat
```

## 1.2 Goal performance harus eksplisit

Sebelum optimasi, jawab:

1. Optimasi untuk apa?
2. Metric apa yang membuktikan berhasil?
3. Workload representative-nya apa?
4. Berapa batas correctness yang tidak boleh dilanggar?
5. Apa trade-off yang diterima?

Contoh goal buruk:

```text
Bikin service lebih cepat.
```

Contoh goal baik:

```text
Untuk endpoint POST /cases/{id}/escalate,
p95 latency harus turun dari 420 ms ke < 200 ms
pada 300 RPS steady-state,
error rate < 0.1%,
tanpa menaikkan DB CPU di atas 70%,
dan tanpa mengubah semantics idempotency.
```

## 1.3 Performance engineering adalah loop

Loop yang benar:

```text
define target
  ↓
measure baseline
  ↓
identify bottleneck
  ↓
form hypothesis
  ↓
change one thing
  ↓
measure again
  ↓
compare
  ↓
keep/revert
  ↓
document
```

Anti-pattern:

```text
ubah 7 hal sekaligus
  ↓
hasil membaik
  ↓
tidak tahu mana penyebabnya
```

Atau lebih buruk:

```text
ubah 7 hal sekaligus
  ↓
hasil memburuk
  ↓
tidak tahu mana yang merusak
```

---

# 2. Mental Model Besar: Work, Resource, Queue, dan Constraint

Semua sistem performa bisa dimodelkan dengan empat unsur:

```text
Work      = pekerjaan yang harus diproses
Resource  = CPU, memory, disk, network, DB, lock, thread, connection
Queue     = antrian saat work datang lebih cepat daripada resource bisa memproses
Constraint = target atau batas yang tidak boleh dilanggar
```

Contoh Java REST service:

```text
Work:
  HTTP requests

Resources:
  CPU
  heap
  GC
  request threads / virtual threads
  DB connections
  DB CPU
  Redis
  Kafka
  downstream HTTP service

Queues:
  TCP accept queue
  server request queue
  executor queue
  DB pool wait queue
  Kafka producer buffer
  downstream queue
  retry queue

Constraints:
  p95 < 200 ms
  p99 < 1 s
  error rate < 0.1%
  memory < 1 GiB
  DB connections <= 100
  cost <= budget
```

## 2.1 Performance bottleneck adalah resource constraint

Jika CPU 95% dan semua request CPU-bound, bottleneck mungkin CPU.

Jika CPU 20% tapi latency tinggi, bottleneck kemungkinan:

- waiting DB;
- waiting network;
- thread pool starvation;
- lock contention;
- queueing;
- GC pause;
- DNS/TLS handshake;
- rate limit downstream.

Jangan menyimpulkan hanya dari satu metric.

## 2.2 Queue adalah tanda overload

Queue tidak selalu buruk. Queue menyerap burst. Tapi queue tak terbatas adalah bom waktu.

Queue besar menyebabkan:

- latency naik;
- memory naik;
- timeout;
- retry storm;
- stale work;
- shutdown lambat;
- OOM;
- incident sulit dikendalikan.

Prinsip:

```text
Every queue must have:
  bound
  metric
  timeout
  rejection behavior
  owner
  reason to exist
```

## 2.3 Coordination sering lebih mahal daripada kerja

Dalam Java production, bottleneck sering bukan “komputasi murni” tetapi koordinasi:

- lock;
- synchronized map;
- single shared queue;
- global cache;
- transaction lock;
- database row lock;
- atomic counter hot spot;
- logging synchronous;
- connection pool wait;
- thread handoff;
- serialization/deserialization boundary.

Performance engineering yang kuat sering mengurangi koordinasi, bukan hanya mempercepat method.

---

# 3. Bahasa Dasar Performance: Latency, Throughput, Tail, Utilization

## 3.1 Latency

Latency adalah waktu yang dibutuhkan satu unit work dari awal sampai selesai.

Contoh:

```text
request received at t0
response sent at t1
latency = t1 - t0
```

Jenis latency:

| Jenis | Makna |
|---|---|
| client-observed latency | dilihat user/client |
| server latency | waktu di service |
| DB latency | waktu query |
| queue wait latency | waktu menunggu resource |
| service time | waktu benar-benar diproses |
| end-to-end latency | total lintas sistem |

Engineer sering keliru mencampur:

```text
latency = service time + queue time + network + retries + downstream
```

Jika kamu hanya mengukur method execution, kamu mungkin melewatkan queue time.

## 3.2 Throughput

Throughput adalah jumlah work selesai per unit waktu.

Contoh:

```text
requests per second
messages per second
rows processed per second
bytes per second
```

Throughput tinggi tidak selalu berarti latency bagus.

Sistem bisa punya throughput tinggi tetapi p99 buruk karena queue besar.

## 3.3 Percentile

Rata-rata sering menipu.

Contoh:

```text
99 request selesai 10 ms
1 request selesai 10_000 ms
average = sekitar 109.9 ms
```

Average terlihat “lumayan”, tetapi satu user menunggu 10 detik.

Gunakan:

- p50: median;
- p90;
- p95;
- p99;
- p99.9;
- max, dengan hati-hati.

Tail latency penting karena:

- user experience;
- timeout;
- retry;
- cascading failure;
- SLA/SLO;
- resource holding time.

## 3.4 Utilization

Utilization adalah seberapa sibuk resource.

Contoh:

```text
CPU utilization = waktu CPU aktif / total waktu
DB connection utilization = active / max
thread pool utilization = active / max
```

Utilization tinggi mendekati 100% biasanya membuat queueing naik tajam.

Rule:

> Resource yang berjalan di utilization terlalu tinggi akan menghasilkan tail latency buruk, walaupun throughput terlihat baik.

## 3.5 Saturation

Saturation adalah keadaan resource punya work lebih banyak daripada kapasitasnya.

Sinyal saturation:

- queue length naik;
- wait time naik;
- timeout naik;
- retry naik;
- CPU throttling;
- GC frequency naik;
- DB active connection penuh;
- Kafka lag naik;
- thread pool queue penuh.

## 3.6 Error rate

Performance tidak boleh dilihat terpisah dari error.

Sistem yang cepat karena fail fast semua request bukan sistem performa baik.

Selalu lihat:

```text
latency + throughput + error + saturation
```

---

# 4. Queueing Theory untuk Engineer Java

Kamu tidak perlu menjadi matematikawan untuk memakai queueing theory. Yang penting adalah mental model.

## 4.1 Little's Law

Formula:

```text
L = λ × W
```

Di mana:

- `L` = rata-rata jumlah work dalam sistem;
- `λ` = arrival/completion rate;
- `W` = rata-rata waktu dalam sistem.

Contoh:

```text
throughput = 100 requests/s
average latency = 200 ms = 0.2 s

L = 100 * 0.2 = 20 requests in system
```

Artinya rata-rata ada 20 request sedang berada di sistem.

Kalau latency naik menjadi 2 detik pada throughput sama:

```text
L = 100 * 2 = 200 requests in system
```

Di mana 200 request itu berada?

- request threads;
- virtual threads;
- server queue;
- DB pool queue;
- downstream wait;
- retry wait.

## 4.2 Utilization dan queue explosion

Saat utilization naik mendekati 100%, waktu tunggu naik non-linear.

Konsekuensi praktis:

- CPU 80% mungkin sehat;
- CPU 95% pada service latency-sensitive bisa buruk;
- DB connection 100% active berarti request lain menunggu;
- thread pool queue mulai naik adalah warning;
- autoscaling reaktif bisa terlambat karena queue sudah terbentuk.

## 4.3 Burst vs steady-state

Sistem harus dibedakan:

| Kondisi | Makna |
|---|---|
| steady-state | arrival rate stabil |
| burst | traffic spike pendek |
| ramp-up | traffic naik bertahap |
| overload | traffic > capacity |
| recovery | sistem kembali normal setelah overload |

Queue boleh menyerap burst pendek. Tetapi jika arrival rate steady-state lebih besar dari capacity, queue akan tumbuh terus.

## 4.4 Backpressure

Backpressure adalah mekanisme memberi sinyal bahwa downstream/resource tidak mampu menerima work lebih banyak.

Bentuk backpressure:

- bounded queue;
- reject with 429/503;
- slow producer;
- semaphore;
- rate limit;
- pause Kafka consumer;
- reduce max in-flight;
- circuit breaker;
- adaptive concurrency.

Tanpa backpressure, overload menyebar.

## 4.5 Retry amplification

Retry dapat mengubah beban.

Jika traffic normal:

```text
100 RPS
```

dan 20% request retry 3 kali:

```text
extra load = 100 * 0.2 * 3 = 60 RPS
total = 160 RPS
```

Saat dependency sedang lemah, retry bisa memperburuk dependency.

Retry harus:

- bounded;
- exponential backoff;
- jitter;
- timeout;
- idempotent;
- observe retry count;
- respect server response;
- stop saat circuit open.

---

# 5. JVM Performance Model

JVM bukan interpreter sederhana. JVM modern:

```text
loads bytecode
interprets initially
profiles runtime behavior
JIT compiles hot methods
optimizes speculatively
deoptimizes if assumptions break
manages heap with GC
coordinates threads and safepoints
interacts with OS scheduler
```

## 5.1 Java performance unik karena runtime adaptif

C/C++ binary biasanya compile ahead-of-time. Java HotSpot bisa mengoptimasi berdasarkan data runtime:

- method mana hot;
- branch mana sering;
- tipe receiver apa yang sering;
- allocation escape atau tidak;
- lock contended atau tidak;
- loop shape;
- call site monomorphic/polymorphic/megamorphic.

Kelebihan:

- optimasi bisa sesuai workload nyata;
- inlining dynamic dispatch bisa kuat;
- escape analysis bisa menghapus object allocation.

Risiko:

- warmup;
- benchmark bisa misleading;
- latency awal berbeda;
- profile berubah → deoptimization;
- code cache;
- uncommon trap.

## 5.2 Hot path dan cold path

Tidak semua code perlu dioptimasi sama.

Hot path:

- dieksekusi sangat sering;
- memengaruhi throughput/latency;
- allocation tinggi;
- berada dalam loop;
- dipanggil pada setiap request/message.

Cold path:

- error path;
- admin endpoint;
- startup;
- rare migration;
- fallback jarang.

Prinsip:

> Optimasi hot path secara disiplin. Jaga cold path tetap jelas dan benar.

Jangan membuat seluruh codebase unreadable demi micro-optimization di cold path.

## 5.3 Cost model dasar di JVM

Biaya relatif:

| Operation | Biaya umum |
|---|---|
| local primitive arithmetic | sangat murah |
| array access | murah, tapi bounds check/cache penting |
| object allocation kecil | murah jika TLAB, tapi tetap GC pressure |
| virtual call | sering murah jika inlineable |
| interface call | bisa murah jika monomorphic, mahal jika megamorphic |
| reflection | lebih mahal, bisa menghambat optimasi |
| synchronization uncontended | bisa relatif murah |
| contended lock | mahal |
| volatile access | memory barrier cost |
| CAS loop | bisa mahal saat contention |
| allocation besar | mahal |
| exception with stack trace | mahal |
| I/O/network | sangat mahal dibanding CPU |
| DB query | sering dominan |
| logging sync | bisa dominan di hot path |

Cost model ini tidak absolut. Ukur workload nyata.

---

# 6. Warmup, JIT, Profiling Feedback, dan Deoptimization

## 6.1 Warmup

Warmup adalah fase saat JVM mengumpulkan profile dan mengompilasi hot code.

Gejala:

- request awal lebih lambat;
- CPU naik karena JIT compile;
- latency stabil setelah beberapa waktu;
- benchmark awal misleading.

Untuk service:

```text
deployment selesai ≠ performance steady-state
```

## 6.2 Tiered compilation

HotSpot memakai tiered compilation:

- interpreter;
- C1 compiler;
- profiling;
- C2 compiler;
- optimized native code.

Tujuan:

- startup cukup cepat;
- steady-state cepat.

## 6.3 Inlining

Inlining menghapus overhead method call dan membuka optimasi lain.

Contoh:

```java
int priceWithTax(int price) {
    return addTax(price);
}

int addTax(int price) {
    return price + (price / 10);
}
```

JIT mungkin inline `addTax`.

Inlining penting karena membuka:

- constant folding;
- escape analysis;
- dead code elimination;
- loop optimization;
- devirtualization.

## 6.4 Devirtualization

Java punya dynamic dispatch. JIT bisa mengoptimalkan jika call site mostly satu tipe.

Contoh:

```java
interface Rule {
    boolean matches(Case c);
}
```

Jika runtime selalu `SeverityRule`, JIT bisa menganggap call site monomorphic dan inline.

Tapi jika terlalu banyak implementation masuk ke call site, call site menjadi megamorphic dan lebih sulit di-inline.

## 6.5 Deoptimization

JIT membuat asumsi. Jika asumsi salah, JVM bisa deoptimize kembali ke interpreter/less optimized code.

Contoh asumsi:

- class tertentu belum diload;
- call site monomorphic;
- branch jarang diambil;
- type profile stabil.

Jika runtime berubah, optimasi batal.

Implikasi:

- benchmark yang hanya memakai satu implementation bisa lebih cepat dari production yang punya banyak implementation;
- warmup profile harus representatif;
- plugin architecture/dynamic class loading bisa memengaruhi performance.

## 6.6 Uncommon trap

JIT bisa mengoptimalkan hot path dan memperlakukan branch langka sebagai uncommon.

Contoh:

```java
if (rareError) {
    throw new IllegalStateException();
}
```

Jika error path tiba-tiba sering, deoptimization/slow path bisa muncul.

## 6.7 Code cache

JIT compiled code disimpan di code cache. Jika code cache penuh, JVM bisa berhenti mengompilasi method baru.

Monitor:

- code cache usage;
- compilation activity;
- JFR compiler events.

---

# 7. Allocation Performance

## 7.1 Allocation di Java sering murah, tetapi bukan gratis

Small object allocation di TLAB bisa sangat cepat, hampir pointer bump.

Mental model:

```text
current TLAB pointer += object size
```

Tetapi biaya muncul di:

- memory bandwidth;
- cache pollution;
- GC scanning;
- promotion;
- fragmentation;
- tail latency saat GC;
- allocation rate tinggi.

## 7.2 Allocation rate lebih penting daripada heap used sesaat

Heap used 300 MB tidak otomatis buruk.

Yang penting:

```text
berapa MB/s dialokasikan?
berapa cepat object mati?
berapa banyak yang survive?
berapa banyak yang promoted?
```

Service dengan heap 512 MB bisa sehat jika allocation rate rendah/stabil. Service dengan heap 4 GB bisa bermasalah jika allocation rate sangat tinggi dan banyak object survive.

## 7.3 Object lifetime

Kategori object:

| Lifetime | Contoh |
|---|---|
| very short-lived | temporary DTO, iterator, lambda capture |
| request-scoped | command context |
| cache-lived | cached object |
| application-lived | singleton/config |
| leak | object tidak dibutuhkan tapi masih reachable |

GC generational bagus untuk object short-lived. Masalah muncul saat object hidup cukup lama untuk promoted tetapi tidak benar-benar long-lived.

## 7.4 Escape analysis

Jika object tidak escape dari method/thread, JIT bisa:

- scalar replace;
- eliminate allocation;
- eliminate lock.

Contoh:

```java
record Point(int x, int y) {}

int sum(int a, int b) {
    Point p = new Point(a, b);
    return p.x() + p.y();
}
```

JIT mungkin tidak benar-benar mengalokasikan `Point`.

Tapi jangan bergantung buta. Escape analysis bisa gagal karena:

- object disimpan ke field;
- object dikirim ke method yang tidak inlineable;
- reflection;
- virtual/megamorphic call;
- synchronization;
- native boundary;
- complex control flow.

## 7.5 Allocation anti-pattern

### 7.5.1 Temporary collection di hot path

```java
List<String> values = new ArrayList<>();
values.add(a);
values.add(b);
return values.stream().collect(joining(","));
```

Jika hot path, pertimbangkan langsung membangun hasil.

### 7.5.2 Boxing di loop

```java
List<Integer> ids = new ArrayList<>();
for (int i = 0; i < n; i++) {
    ids.add(i);
}
```

Membuat banyak `Integer`.

### 7.5.3 Regex compile berulang

```java
boolean ok = Pattern.matches("[A-Z]+", input);
```

`Pattern.matches` compile pattern setiap kali.

Lebih baik:

```java
private static final Pattern CODE = Pattern.compile("[A-Z]+");
```

### 7.5.4 Exception untuk control flow

```java
try {
    return Integer.parseInt(s);
} catch (NumberFormatException e) {
    return 0;
}
```

Jika input invalid sering, exception stack trace cost bisa besar.

### 7.5.5 Logging string dibangun walau disabled

```java
log.debug("Payload: " + expensiveSerialize(payload));
```

Gunakan parameterized logging atau guard.

## 7.6 Object pooling: hati-hati

Dulu object allocation mahal. Di JVM modern, pooling object kecil sering merusak:

- code complexity;
- object lifetime jadi lebih panjang;
- GC generational benefit hilang;
- thread safety;
- stale state bug;
- memory leak.

Pooling cocok untuk:

- expensive resource seperti connection;
- direct buffer tertentu;
- large reusable buffer dengan disiplin ketat;
- object native.

Tidak cocok untuk:

- DTO kecil;
- `StringBuilder` global shared;
- arbitrary business object.

---

# 8. Boxing, Primitive, Object Churn, dan Data-Oriented Thinking

## 8.1 Boxing cost

Boxing mengubah primitive menjadi object wrapper.

```java
int x = 42;
Integer y = x; // boxing
```

Biaya:

- allocation atau cache hit untuk small integer;
- pointer indirection;
- null possibility;
- GC pressure;
- cache locality buruk.

## 8.2 Collections dan primitive

Java standard collection generik memakai reference type:

```java
List<Integer>
Map<Long, Case>
```

Untuk data besar, overhead wrapper signifikan.

Alternatif:

- primitive array;
- specialized library;
- `IntStream`/`LongStream`;
- custom compact structure;
- off-heap/FFM untuk kasus ekstrem;
- database/query pushdown;
- columnar representation.

## 8.3 Array of objects vs object of arrays

Object-oriented style:

```java
class Point {
    double x;
    double y;
}

Point[] points;
```

Data-oriented style:

```java
double[] xs;
double[] ys;
```

Data-oriented bisa lebih cepat untuk numeric processing karena:

- cache locality;
- fewer pointer dereference;
- vectorization potential;
- lower object overhead.

Trade-off:

- readability;
- encapsulation;
- invariants;
- API complexity.

## 8.4 Records tidak otomatis gratis

`record` membuat data carrier immutable-ish, tetapi tetap object.

```java
record Money(long cents, String currency) {}
```

Record bagus untuk modeling, tetapi jika dibuat jutaan kali per detik di hot path, tetap allocation jika tidak dieliminasi JIT.

## 8.5 String churn

String churn sering muncul dari:

- concatenation dalam loop;
- JSON serialization;
- logging;
- parsing;
- substring/split;
- regex;
- `String.format`;
- UUID/toString di hot path.

Tips:

- avoid `String.format` di hot path;
- gunakan `StringBuilder` lokal;
- hindari `split` regex jika parser sederhana cukup;
- stream bytes/chars jika data besar;
- jangan log payload besar di hot path;
- cache canonical strings hanya jika bounded.

---

# 9. CPU Performance: Cache, Branch, Instruction, dan Memory Access

## 9.1 CPU jauh lebih cepat daripada memory

Modern CPU punya hierarchy:

```text
register
L1 cache
L2 cache
L3 cache
RAM
disk/network
```

Access RAM jauh lebih lambat daripada cache.

Java object graph dengan banyak pointer bisa buruk untuk cache:

```text
List<Node> -> Node -> child -> metadata -> string
```

Setiap pointer dereference bisa cache miss.

## 9.2 Cache locality

`ArrayList` biasanya lebih cache-friendly daripada `LinkedList` karena backing array contiguous.

`LinkedList` punya banyak node object terpisah:

```text
Node(value, prev, next)
```

Traversal membuat pointer chasing.

Karena itu `LinkedList` jarang unggul di real workload walaupun Big-O insert/delete teoritis terlihat menarik.

## 9.3 Branch prediction

CPU menebak branch.

Branch predictable:

```java
if (status == ACTIVE) { ... } // 99% ACTIVE
```

Branch unpredictable:

```java
if (random.nextBoolean()) { ... }
```

Unpredictable branch menyebabkan pipeline flush.

Dalam Java business code, efek branch sering kalah oleh I/O/DB. Tapi di numeric/parser/hot loop, penting.

## 9.4 Bounds check

Java array access punya bounds check.

JIT bisa menghilangkan bounds check pada loop yang terbukti aman.

Contoh yang mudah dioptimasi:

```java
for (int i = 0; i < array.length; i++) {
    sum += array[i];
}
```

Loop rumit bisa menghambat elimination.

## 9.5 Method call overhead dan inlining

Method kecil tidak selalu mahal karena JIT bisa inline.

Jangan membuat method raksasa hanya karena takut call overhead.

Better:

- tulis code jelas;
- ukur;
- lihat apakah hot method inlineable;
- hindari megamorphic call di hot path jika terbukti bottleneck.

## 9.6 Reflection dan method handle

Reflection lebih sulit dioptimasi daripada direct call.

Framework sering menggunakan reflection saat startup, lalu cache metadata/accessor.

Jika reflection ada di hot path, pertimbangkan:

- generated code;
- method handle;
- cached lookup;
- direct mapper;
- compile-time annotation processor;
- avoid repeated scanning.

---

# 10. False Sharing dan Contention

## 10.1 False sharing

False sharing terjadi ketika beberapa thread menulis variable berbeda tetapi berada di cache line yang sama.

Contoh konseptual:

```java
class Counters {
    volatile long a;
    volatile long b;
}
```

Thread 1 update `a`, thread 2 update `b`.

Walau field berbeda, jika berada di cache line sama, CPU core saling invalidate cache line.

Gejala:

- CPU tinggi;
- throughput buruk;
- tidak terlihat sebagai Java lock contention;
- sering muncul pada counter/statistic high-frequency.

## 10.2 Solusi false sharing

- gunakan `LongAdder` untuk counter contention tinggi;
- shard counter per thread/core;
- reduce frequency update;
- batch metric;
- padding/`@Contended` untuk low-level code.

`@Contended` adalah internal/advanced feature dan membutuhkan flag tertentu untuk non-JDK classes. Jangan pakai tanpa alasan kuat.

## 10.3 True contention

True contention terjadi saat banyak thread berebut resource yang sama:

- lock;
- atomic variable;
- queue;
- connection pool;
- synchronized logger;
- database row;
- shared cache entry.

Solusi bukan selalu “pakai lock-free”. Solusi sering:

- reduce sharing;
- shard state;
- use immutable snapshots;
- use actor/owner thread;
- batch update;
- move coordination to DB/Kafka if appropriate;
- change data model.

## 10.4 Hot atomic counter

```java
AtomicLong total = new AtomicLong();

void increment() {
    total.incrementAndGet();
}
```

Jika dipanggil jutaan kali/detik oleh banyak thread, CAS contention tinggi.

`LongAdder` sering lebih baik untuk counter statistik:

```java
LongAdder total = new LongAdder();

void increment() {
    total.increment();
}
```

Trade-off:

- `LongAdder.sum()` bukan atomic snapshot sempurna terhadap concurrent update;
- cocok untuk metrics/statistics;
- tidak cocok untuk strict sequence number.

---

# 11. Locking, Synchronization, dan Coordination Cost

## 11.1 Lock bukan selalu buruk

Lock buruk jika:

- contended;
- di hot path;
- critical section panjang;
- melakukan I/O di dalam lock;
- lock order berisiko deadlock;
- memblokir banyak thread;
- menyebabkan priority inversion.

Lock yang uncontended dan pendek bisa acceptable.

## 11.2 Critical section harus kecil

Buruk:

```java
synchronized (lock) {
    validate(command);
    repository.save(entity);
    httpClient.send(request);
    cache.put(key, value);
}
```

Baik:

```java
ValidatedCommand validated = validate(command);

synchronized (lock) {
    updateInMemoryState(validated);
}

repository.save(...);
httpClient.send(...);
```

Tetapi hati-hati correctness. Jangan mengecilkan lock kalau invariant butuh atomicity lebih besar.

## 11.3 Lock striping

Daripada satu global lock:

```java
synchronized (globalLock) { ... }
```

Gunakan lock per shard/key:

```java
Lock lock = locks[Math.floorMod(key.hashCode(), locks.length)];
```

Trade-off:

- lebih kompleks;
- risiko hash skew;
- deadlock jika perlu multi-key lock;
- butuh ordering.

## 11.4 ReadWriteLock

`ReadWriteLock` berguna jika:

- read jauh lebih banyak dari write;
- read critical section cukup panjang;
- write tidak terlalu sering.

Jika critical section sangat pendek, overhead bisa lebih mahal.

## 11.5 StampedLock

`StampedLock` mendukung optimistic read. Berguna untuk struktur data tertentu, tetapi API lebih rawan salah.

Jangan pakai hanya karena terdengar advanced.

## 11.6 Lock-free bukan gratis

CAS/lock-free bisa:

- spin;
- burn CPU;
- starvation;
- ABA problem;
- complexity tinggi;
- sulit dibuktikan benar.

Gunakan lock-free jika:

- contention tinggi;
- lock terbukti bottleneck;
- correctness bisa dibuktikan;
- ada test/stress;
- code reviewer paham.

---

# 12. I/O Performance: Blocking, Async, Streaming, dan Backpressure

## 12.1 I/O biasanya dominan di backend

Dalam enterprise Java:

```text
CPU method time sering kecil
DB/network time sering dominan
```

Optimasi CPU 20% tidak berarti jika 90% waktu request menunggu DB.

Gunakan tracing untuk melihat waktu:

```text
HTTP handler
  validation 2 ms
  DB query 180 ms
  downstream call 300 ms
  serialization 12 ms
```

## 12.2 Blocking I/O

Blocking I/O mudah dipahami:

```text
thread menunggu sampai I/O selesai
```

Dengan platform thread, blocking I/O butuh thread. Terlalu banyak blocking thread bisa mahal.

Dengan virtual thread, blocking I/O menjadi lebih scalable untuk banyak concurrent waits, tetapi downstream capacity tetap batas nyata.

## 12.3 Async I/O

Async/non-blocking I/O menghindari blocking thread, tetapi menambah:

- callback complexity;
- context propagation complexity;
- error propagation complexity;
- debugging difficulty;
- backpressure requirement;
- event loop blocking risk.

Async bukan otomatis cepat. Async membantu saat bottleneck adalah thread blocking, bukan saat bottleneck DB CPU atau query buruk.

## 12.4 Streaming

Untuk payload besar:

Buruk:

```java
byte[] all = inputStream.readAllBytes();
process(all);
```

Baik:

```java
byte[] buffer = new byte[8192];
int n;
while ((n = input.read(buffer)) != -1) {
    process(buffer, 0, n);
}
```

Streaming mengurangi:

- peak memory;
- GC pressure;
- latency first-byte;
- OOM risk.

## 12.5 Backpressure di I/O

Jika membaca dari network lebih cepat daripada menulis ke disk/downstream, buffer tumbuh.

Desain perlu:

- bounded buffer;
- pause/resume;
- reactive streams demand;
- chunk limit;
- timeout;
- cancellation;
- spill to disk;
- rate limit.

## 12.6 Serialization performance

JSON mudah, tetapi mahal untuk volume tinggi.

Bottleneck:

- reflection;
- string allocation;
- UTF-8 encode/decode;
- field name repetition;
- large object graph;
- polymorphic serialization;
- date/time formatting.

Alternatif:

- Jackson tuning;
- generated serializers;
- binary format: Protobuf/Avro/CBOR;
- avoid unnecessary serialization;
- avoid converting bytes → string → bytes;
- stream encode/decode.

---

# 13. Virtual Threads dan Performance

## 13.1 Virtual thread bukan accelerator CPU

Virtual thread tidak membuat CPU-bound computation lebih cepat.

Virtual thread membantu workload dengan banyak blocking waits:

- HTTP calls;
- DB calls;
- file I/O;
- queue waits;
- sleep/timeouts.

Jika bottleneck CPU, virtual thread justru bisa menambah scheduling overhead bila concurrency tidak dibatasi.

## 13.2 Throughput vs concurrency

Virtual threads memungkinkan concurrency besar, tetapi throughput tetap dibatasi:

- CPU;
- DB connections;
- downstream rate limit;
- memory;
- network;
- locks;
- broker partitions.

Contoh buruk:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Command c : commands) {
        executor.submit(() -> process(c)); // unbounded submit
    }
}
```

Jika `commands` jutaan, ini bisa membanjiri memory/downstream.

Gunakan semaphore/bulkhead:

```java
Semaphore dbBulkhead = new Semaphore(50);

void process(Command command) throws Exception {
    if (!dbBulkhead.tryAcquire(500, TimeUnit.MILLISECONDS)) {
        throw new RejectedExecutionException("DB bulkhead full");
    }
    try {
        repository.save(command);
    } finally {
        dbBulkhead.release();
    }
}
```

## 13.3 Pinning

Virtual thread bisa “pinned” dalam kondisi tertentu, misalnya blocking saat memegang monitor `synchronized` pada kasus tertentu/versi tertentu.

Java modern sudah banyak memperbaiki area ini, tetapi rule tetap:

- jangan lakukan blocking I/O panjang di dalam `synchronized`;
- pakai `ReentrantLock` jika perlu lock yang lebih cocok;
- ukur dengan JFR virtual thread events.

## 13.4 ThreadLocal dengan virtual thread

Virtual thread banyak berarti `ThreadLocal` bisa membengkak jika digunakan sembarangan.

Gunakan:

- scoped values untuk context immutable;
- explicit context parameter;
- clean up ThreadLocal;
- avoid large per-thread object.

## 13.5 Virtual thread performance checklist

- [ ] Apakah workload blocking I/O, bukan CPU-bound?
- [ ] Apakah downstream concurrency dibatasi?
- [ ] Apakah DB pool tidak terlalu besar?
- [ ] Apakah ThreadLocal aman?
- [ ] Apakah blocking di synchronized dihindari?
- [ ] Apakah metrics thread/queue/backpressure tersedia?
- [ ] Apakah timeout/cancellation benar?

---

# 14. GC dan Performance

## 14.1 GC tuning dimulai dari allocation

Sebelum mengganti GC, tanya:

```text
Mengapa allocation rate tinggi?
Mengapa object survive?
Apakah heap terlalu kecil?
Apakah memory leak?
Apakah pause target realistis?
Apakah CPU cukup?
```

## 14.2 Throughput vs latency

GC trade-off:

| Goal | Collector/tuning concern |
|---|---|
| max throughput | Parallel/G1, fewer interruptions |
| low pause | ZGC/Shenandoah/G1 tuned |
| small memory | careful heap/native sizing |
| predictable tail | low allocation, low contention, low GC pause |
| startup | CDS/AOT/native image/framework AOT |

## 14.3 Allocation rate and GC frequency

Jika allocation rate 500 MB/s dan young gen efektif 1 GB, young GC bisa terjadi kira-kira setiap 2 detik.

Jika banyak object survive, pressure pindah ke old gen.

## 14.4 Heap terlalu kecil

Gejala:

- GC sering;
- CPU GC tinggi;
- allocation stalls;
- promotion failure;
- p99 spike;
- throughput turun.

## 14.5 Heap terlalu besar

Gejala:

- memory cost tinggi;
- pause tertentu bisa lebih panjang;
- container pressure;
- slow heap dump;
- leak lebih lambat terlihat;
- node bin packing buruk.

## 14.6 GC log harus dibaca sebagai timeline

Jangan hanya lihat satu pause.

Lihat:

- frequency;
- pause duration;
- before/after heap;
- allocation rate;
- promotion;
- concurrent cycle;
- humongous allocation;
- evacuation failure;
- CPU time;
- safepoint.

## 14.7 Low-latency collector bukan silver bullet

ZGC/Shenandoah bisa menurunkan pause, tetapi:

- butuh CPU untuk concurrent work;
- memory headroom;
- workload-specific;
- throughput trade-off;
- operational familiarity.

Jika bottleneck DB query, mengganti GC tidak membantu.

---

# 15. Benchmarking dengan JMH

## 15.1 Kenapa JMH

Benchmark Java sulit karena:

- JIT warmup;
- dead-code elimination;
- constant folding;
- inlining;
- branch prediction;
- escape analysis;
- GC;
- OS scheduling;
- CPU frequency scaling;
- benchmark harness overhead.

JMH dibuat untuk benchmark JVM dengan benar.

## 15.2 Setup Maven

Contoh dependency/plugin bisa berbeda sesuai versi JMH terbaru. Struktur umum:

```xml
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
</dependencies>
```

## 15.3 Benchmark dasar

```java
import org.openjdk.jmh.annotations.*;

import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
@Fork(3)
@State(Scope.Thread)
public class StringBuildBenchmark {

    @Param({"10", "100", "1000"})
    int size;

    @Benchmark
    public String plusConcat() {
        String s = "";
        for (int i = 0; i < size; i++) {
            s += i;
        }
        return s;
    }

    @Benchmark
    public String stringBuilder() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < size; i++) {
            sb.append(i);
        }
        return sb.toString();
    }
}
```

## 15.4 Blackhole

Jika result tidak digunakan, JIT bisa menghapus computation.

```java
@Benchmark
public void compute(Blackhole bh) {
    int result = expensive();
    bh.consume(result);
}
```

## 15.5 State scope

| Scope | Makna |
|---|---|
| `Scope.Thread` | state per benchmark thread |
| `Scope.Benchmark` | state shared antar thread |
| `Scope.Group` | state per group |

Pilih sesuai behavior yang ingin diuji.

## 15.6 Setup/teardown

```java
@Setup(Level.Trial)
public void setupTrial() {}

@Setup(Level.Invocation)
public void setupInvocation() {}
```

Hati-hati `Level.Invocation` bisa menambah overhead besar dan mengubah benchmark.

## 15.7 Benchmark mode

| Mode | Makna |
|---|---|
| Throughput | ops/time |
| AverageTime | time/op average |
| SampleTime | distribution sample |
| SingleShotTime | cold/single invocation |
| All | semua |

## 15.8 Fork penting

Jangan benchmark semua dalam satu JVM tanpa fork. Profile satu benchmark bisa memengaruhi benchmark lain.

Gunakan:

```java
@Fork(3)
```

## 15.9 Common JMH traps

| Trap | Dampak |
|---|---|
| tidak pakai warmup | hasil cold misleading |
| tidak pakai fork | benchmark saling contaminate |
| tidak consume result | computation dieliminasi |
| input constant | constant folding |
| dataset tidak representatif | production berbeda |
| benchmark terlalu kecil | overhead dominan |
| benchmark isolate hot path terlalu steril | profile tidak mirip production |
| tidak cek GC/allocation | throughput bagus tapi allocation buruk |
| menjalankan di laptop noisy | hasil fluktuatif |
| membandingkan tanpa confidence interval | kesimpulan palsu |

## 15.10 Microbenchmark bukan bukti akhir

Microbenchmark menjawab:

```text
Dalam kondisi kecil dan terkontrol ini, mana yang lebih cepat?
```

Ia tidak otomatis menjawab:

```text
Apakah service production lebih cepat?
```

Selalu validasi dengan macrobenchmark/load test.

---

# 16. Macrobenchmark, Load Test, dan Capacity Test

## 16.1 Micro vs macro

| Jenis | Mengukur |
|---|---|
| microbenchmark | method/operation kecil |
| component benchmark | modul/service internal |
| load test | service under realistic traffic |
| stress test | batas maksimum |
| soak test | stabilitas jangka panjang |
| chaos/failure test | behavior saat dependency gagal |
| capacity test | kapasitas sebelum SLO dilanggar |

## 16.2 Workload representative

Workload harus mencakup:

- request mix;
- payload size;
- user/tenant distribution;
- hot/cold data;
- cache hit ratio;
- error cases;
- DB size;
- downstream latency;
- concurrency;
- ramp-up;
- burst.

Benchmark dengan 1 user dan DB kosong hampir tidak berarti untuk production.

## 16.3 Load test metric

Collect:

- RPS;
- p50/p95/p99 latency;
- error rate;
- CPU;
- memory;
- GC;
- heap allocation;
- thread count;
- DB active/pending;
- HTTP pool;
- Kafka lag;
- downstream latency;
- container throttling;
- network;
- logs error.

## 16.4 Saturation curve

Load test bertahap:

```text
50 RPS
100 RPS
200 RPS
300 RPS
400 RPS
...
```

Plot:

- throughput;
- p95/p99;
- error;
- CPU;
- DB pool wait;
- GC.

Cari titik:

```text
latency mulai naik tajam
error mulai muncul
queue mulai tumbuh
```

Itu practical capacity.

## 16.5 Soak test

Soak test berjalan lama:

```text
4 jam
12 jam
24 jam
72 jam
```

Tujuan:

- memory leak;
- connection leak;
- slow cache growth;
- log disk pressure;
- token refresh issue;
- DNS stale;
- thread leak;
- classloader leak.

---

# 17. Profiling: CPU, Allocation, Wall-Clock, Lock, I/O

## 17.1 Profiling menjawab “waktu/memory habis di mana?”

Jenis profiling:

| Jenis | Menjawab |
|---|---|
| CPU profiling | method mana memakai CPU |
| allocation profiling | object apa dialokasikan |
| wall-clock profiling | waktu elapsed termasuk wait |
| lock profiling | lock mana contended |
| I/O profiling | waktu di socket/file |
| GC profiling | pause/allocation/live set |
| thread profiling | thread state/blocked/waiting |
| database profiling | query/index/lock |

## 17.2 CPU profile vs wall-clock profile

CPU profile:

```text
bagian code yang benar-benar memakai CPU
```

Wall-clock:

```text
bagian code tempat waktu berlalu, termasuk menunggu
```

Jika service lambat karena DB, CPU profile mungkin tidak menunjukkan method DB sebagai CPU hot. Wall-clock/profile trace lebih berguna.

## 17.3 Allocation profile

Allocation profile sering lebih actionable daripada heap dump untuk latency.

Heap dump menunjukkan object hidup. Allocation profile menunjukkan object dibuat.

Jika banyak object short-lived, heap dump mungkin tidak menunjukkan mereka karena sudah mati.

## 17.4 Flame graph

Flame graph:

- lebar = waktu/sample;
- stack atas = method leaf;
- stack bawah = caller;
- warna biasanya tidak bermakna kecuali tool spesifik.

Interpretasi:

- cari block lebar;
- lihat apakah CPU atau wall-clock;
- hati-hati inlining;
- lihat native/kernel frames;
- bandingkan before/after.

## 17.5 Sampling vs instrumentation

Sampling:

- overhead rendah;
- periodik ambil stack;
- bagus untuk production-ish.

Instrumentation:

- memasukkan hook ke method;
- bisa lebih detail;
- overhead lebih tinggi;
- bisa mengubah behavior.

Java 25 JFR Method Timing & Tracing memakai instrumentation untuk target method tertentu. Gunakan hati-hati dan terarah.

---

# 18. Java Flight Recorder dan JDK Mission Control untuk Performance

## 18.1 Kenapa JFR

JFR built into JVM dan dirancang low overhead untuk observability/profiling.

JFR bisa merekam:

- CPU sampling;
- allocation;
- GC;
- safepoint;
- lock;
- thread park;
- socket/file I/O;
- exceptions;
- class loading;
- compiler;
- virtual threads;
- custom events.

## 18.2 Start recording

Command:

```bash
jcmd <pid> JFR.start name=perf settings=profile filename=/tmp/perf.jfr duration=120s
```

Stop/dump:

```bash
jcmd <pid> JFR.dump name=perf filename=/tmp/perf.jfr
jcmd <pid> JFR.stop name=perf
```

Startup:

```bash
java -XX:StartFlightRecording=filename=app.jfr,settings=profile,duration=120s -jar app.jar
```

## 18.3 JFR event yang penting

| Event | Untuk |
|---|---|
| Execution Sample | CPU hot path |
| Allocation in new TLAB/outside TLAB | allocation pressure |
| Garbage Collection | GC behavior |
| Thread Park | blocking/waiting |
| Java Monitor Blocked | lock contention |
| Socket Read/Write | network wait |
| File Read/Write | disk I/O |
| Exception Statistics | exception storm |
| Class Load | classloading |
| Compiler events | JIT activity |
| Safepoint | STW cause |
| VirtualThread events | virtual thread behavior |

## 18.4 JDK 25 JFR additions

Java 25 menambahkan/meningkatkan area JFR penting:

- CPU-Time Profiling;
- Cooperative Sampling;
- Method Timing & Tracing.

Makna praktis:

- profiling lebih kaya;
- sampling lebih stabil;
- method target tertentu bisa diukur lebih detail.

Tetapi tetap:

```text
profiling data harus dikaitkan dengan workload dan timeline incident
```

## 18.5 JMC workflow

1. Ambil recording pada window yang representatif.
2. Buka di JDK Mission Control.
3. Lihat automated analysis.
4. Cek CPU hot methods.
5. Cek allocation.
6. Cek GC pause.
7. Cek lock contention.
8. Cek socket/file I/O.
9. Cek thread state.
10. Buat hipotesis.
11. Validasi dengan perubahan kecil.

## 18.6 Custom JFR events

Untuk domain/regulatory system, custom event dapat sangat berguna.

Contoh:

```java
import jdk.jfr.Event;
import jdk.jfr.Label;
import jdk.jfr.Category;

@Category({"Case", "Command"})
@Label("Case Command")
public class CaseCommandEvent extends Event {
    @Label("Command Type")
    String commandType;

    @Label("Case ID")
    String caseId;

    @Label("Outcome")
    String outcome;
}
```

Usage:

```java
CaseCommandEvent event = new CaseCommandEvent();
event.commandType = "ESCALATE";
event.caseId = caseId;
event.begin();
try {
    service.escalate(command);
    event.outcome = "SUCCESS";
} catch (RuntimeException e) {
    event.outcome = "FAILED";
    throw e;
} finally {
    event.commit();
}
```

Hati-hati PII/security.

---

# 19. Vector API dan SIMD di Java 25

## 19.1 SIMD mental model

SIMD:

```text
Single Instruction, Multiple Data
```

Daripada:

```text
a[0] + b[0]
a[1] + b[1]
a[2] + b[2]
...
```

CPU bisa memproses beberapa elemen sekaligus dalam vector register.

## 19.2 Vector API Java 25

Java 25 membawa Vector API sebagai incubator ke-10. Artinya:

- API belum final/stabil permanen;
- butuh module incubator;
- cocok untuk eksperimen/performance-critical library;
- jangan asal dipakai untuk business code umum.

Tujuan Vector API adalah mengekspresikan komputasi vector yang bisa dikompilasi runtime ke instruksi vector optimal pada CPU yang didukung.

## 19.3 Use case cocok

- numeric processing;
- image/audio/video processing;
- compression;
- cryptographic-like primitive tertentu;
- parsing/scanning byte;
- ML/data processing;
- vectorized validation;
- checksum;
- columnar analytics.

Tidak cocok untuk:

- business workflow biasa;
- DB-bound endpoint;
- small arrays;
- code yang jarang dieksekusi;
- branch-heavy logic;
- object-heavy data structure.

## 19.4 Contoh konseptual

Scalar:

```java
void add(float[] a, float[] b, float[] out) {
    for (int i = 0; i < a.length; i++) {
        out[i] = a[i] + b[i];
    }
}
```

Vector API style konseptual:

```java
static final VectorSpecies<Float> SPECIES = FloatVector.SPECIES_PREFERRED;

void add(float[] a, float[] b, float[] out) {
    int i = 0;
    int upperBound = SPECIES.loopBound(a.length);

    for (; i < upperBound; i += SPECIES.length()) {
        FloatVector va = FloatVector.fromArray(SPECIES, a, i);
        FloatVector vb = FloatVector.fromArray(SPECIES, b, i);
        va.add(vb).intoArray(out, i);
    }

    for (; i < a.length; i++) {
        out[i] = a[i] + b[i];
    }
}
```

## 19.5 Vector API trade-off

Kelebihan:

- SIMD eksplisit;
- portable abstraction;
- CPU-specific optimization by JVM;
- lebih aman daripada JNI intrinsic manual.

Risiko:

- incubator API;
- code lebih kompleks;
- benefit workload-specific;
- small input bisa kalah overhead;
- branch-heavy code tidak cocok;
- butuh benchmark serius;
- deployment harus menambahkan incubator module.

## 19.6 Decision checklist

Gunakan Vector API hanya jika:

- [ ] operasi numeric/byte-array hot path;
- [ ] data layout contiguous;
- [ ] workload besar cukup;
- [ ] bottleneck CPU terbukti;
- [ ] scalar baseline sudah optimal;
- [ ] JMH benchmark menunjukkan benefit;
- [ ] macrobenchmark menunjukkan benefit end-to-end;
- [ ] tim siap memelihara code lebih kompleks;
- [ ] incubator dependency diterima oleh policy.

---

# 20. Performance Design Patterns

## 20.1 Bounded concurrency

Gunakan semaphore/bulkhead untuk membatasi resource:

```java
class BoundedClient {
    private final Semaphore permits = new Semaphore(50);

    Response call(Request request) throws Exception {
        if (!permits.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            throw new RejectedExecutionException("too many concurrent calls");
        }
        try {
            return doCall(request);
        } finally {
            permits.release();
        }
    }
}
```

## 20.2 Batching

Batching mengurangi overhead per item.

Contoh:

- insert batch DB;
- Kafka batch;
- log batch;
- file write buffer;
- API bulk endpoint.

Trade-off:

- latency per item bisa naik;
- batch failure semantics;
- partial success;
- memory buffer;
- retry complexity.

## 20.3 Caching

Cache membantu jika:

- read-heavy;
- data reuse tinggi;
- stale tolerance jelas;
- invalidation jelas;
- memory bounded;
- metric tersedia.

Cache buruk jika:

- invalidation tidak jelas;
- memory tak terbatas;
- key cardinality tinggi;
- cache stampede;
- data sensitif;
- correctness bergantung pada stale data.

## 20.4 Precomputation

Hitung di awal jika:

- computation mahal;
- input berubah jarang;
- read sering;
- memory acceptable;
- invalidation sederhana.

## 20.5 Lazy loading

Lazy loading menunda biaya.

Risiko:

- latency spike pada request pertama;
- hidden I/O;
- N+1 query;
- surprise exception di layer luar;
- concurrency initialization bug.

## 20.6 Pooling expensive resources

Pool:

- DB connection;
- HTTP connection;
- thread/platform thread;
- buffer besar tertentu;
- parser/encoder tertentu jika thread-safe atau properly confined.

Jangan pool object kecil sembarangan.

## 20.7 Sharding

Sharding mengurangi contention:

- per-tenant lock;
- per-case actor;
- partitioned queue;
- per-core counter;
- Kafka partition key.

Risiko:

- skew;
- rebalancing;
- cross-shard transaction;
- hot key.

## 20.8 Idempotency for performance recovery

Idempotency bukan hanya correctness. Ia membantu performance recovery karena memungkinkan retry aman.

Tanpa idempotency, retry harus dikurangi/ditakuti, sehingga availability turun.

---

# 21. Performance Anti-Patterns

## 21.1 Optimizing without measurement

Gejala:

```text
Saya rasa ini lambat karena stream.
```

Perbaikan:

```text
Profile dulu.
```

## 21.2 Infinite queue

```java
Executors.newFixedThreadPool(10)
```

Default fixed thread pool memakai unbounded queue.

Risiko:

- latency collapse;
- OOM;
- shutdown lama;
- no backpressure.

Gunakan `ThreadPoolExecutor` dengan bounded queue dan rejection policy.

## 21.3 Oversized thread pool

Thread pool besar tidak selalu cepat.

Risiko:

- context switching;
- memory stack;
- lock contention;
- downstream overload.

## 21.4 Excessive logging

Hot path logging bisa dominan:

- string allocation;
- JSON serialization;
- disk/network log pipeline;
- lock contention;
- PII risk.

## 21.5 Chatty database

N+1 query:

```text
1 query list
N query detail
```

Perbaiki dengan:

- fetch join;
- projection;
- batch query;
- pagination;
- aggregate read model.

## 21.6 Cache everything

Cache tanpa bound/invalidation = memory leak + stale bug.

## 21.7 Premature async

Async menambah kompleksitas. Jika bottleneck DB query lambat, async tidak mempercepat query.

## 21.8 Retry storm

Retry tanpa backoff/jitter/circuit breaker memperparah outage.

## 21.9 Misleading benchmark

Benchmark input kecil, constant, tidak warmup, tanpa fork, tanpa blackhole, lalu dipakai untuk arsitektur production.

## 21.10 Tuning GC before fixing allocation

Jika allocation rate buruk karena code churn, mengganti GC hanya mengobati gejala.

---

# 22. Performance Review Checklist

## 22.1 Requirement

- [ ] Ada target p95/p99?
- [ ] Ada throughput target?
- [ ] Ada workload representative?
- [ ] Ada error budget?
- [ ] Ada resource/cost limit?
- [ ] Ada correctness invariant?

## 22.2 Code hot path

- [ ] Tidak ada allocation besar tidak perlu?
- [ ] Tidak ada regex compile berulang?
- [ ] Tidak ada exception sebagai control flow?
- [ ] Tidak ada logging mahal?
- [ ] Tidak ada boxing di loop besar?
- [ ] Data structure sesuai access pattern?
- [ ] String handling efisien?
- [ ] Serialization tidak berlebihan?

## 22.3 Concurrency

- [ ] Queue bounded?
- [ ] Thread pool bounded?
- [ ] Rejection behavior jelas?
- [ ] Timeout jelas?
- [ ] Cancellation jelas?
- [ ] Lock critical section kecil?
- [ ] Tidak ada blocking dalam event loop?
- [ ] Backpressure ada?

## 22.4 I/O

- [ ] Semua outbound call punya timeout?
- [ ] Connection pool size masuk akal?
- [ ] DB pool dikaitkan dengan jumlah replica?
- [ ] Payload besar streaming?
- [ ] Retry bounded + jitter?
- [ ] Circuit breaker/bulkhead ada jika perlu?

## 22.5 JVM/runtime

- [ ] Heap/native sizing benar?
- [ ] GC logs/JFR tersedia?
- [ ] CPU throttling dimonitor?
- [ ] Thread count dimonitor?
- [ ] Allocation rate dimonitor?
- [ ] Startup/warmup dipertimbangkan?

## 22.6 Benchmark/profiling

- [ ] Baseline ada?
- [ ] Perubahan satu per satu?
- [ ] JMH benar untuk microbenchmark?
- [ ] Macrobenchmark/load test ada?
- [ ] Before/after dibandingkan?
- [ ] Result reproducible?
- [ ] Dokumentasi keputusan ada?

---

# 23. Incident Playbook: Dari Symptom ke Root Cause

## 23.1 Symptom: p99 latency naik, CPU normal

Kemungkinan:

- DB wait;
- downstream HTTP wait;
- thread pool queue;
- lock contention;
- GC pause kecil tapi sering;
- DNS/TLS;
- connection pool wait;
- retry.

Cek:

- trace waterfall;
- DB pool pending;
- thread dump;
- JFR wall-clock/socket;
- logs timeout;
- downstream metrics.

## 23.2 Symptom: CPU tinggi, throughput turun

Kemungkinan:

- CPU-bound hot loop;
- serialization/deserialization;
- regex catastrophic backtracking;
- GC CPU;
- lock/CAS spin;
- compression/encryption;
- logging;
- thread context switch.

Cek:

- CPU profile/JFR;
- GC CPU;
- flame graph;
- allocation profile;
- thread state.

## 23.3 Symptom: memory naik perlahan

Kemungkinan:

- heap leak;
- cache unbounded;
- ThreadLocal leak;
- classloader leak;
- connection/session leak;
- direct buffer leak;
- metric cardinality explosion.

Cek:

- heap dump diff;
- class histogram;
- NMT;
- cache metrics;
- thread count;
- direct buffer metrics.

## 23.4 Symptom: DB pool penuh

Kemungkinan:

- slow query;
- transaction terlalu panjang;
- pool terlalu kecil;
- replicas terlalu banyak;
- connection leak;
- downstream call dalam transaction;
- lock di DB.

Cek:

- active/pending connection;
- query time;
- DB locks;
- transaction duration;
- Hikari leak detection;
- trace spans.

## 23.5 Symptom: Kafka lag naik

Kemungkinan:

- consumer processing lambat;
- partition kurang;
- consumer rebalance;
- downstream bottleneck;
- commit issue;
- poison message;
- CPU throttling;
- DB pool penuh.

Cek:

- lag by partition;
- consumer assignment;
- processing latency;
- DLQ;
- retry count;
- DB/downstream metrics.

## 23.6 Symptom: latency spike saat deployment

Kemungkinan:

- cold JIT;
- readiness terlalu cepat;
- cache cold;
- DB migration;
- connection pool warmup;
- service mesh warmup;
- HPA scale-up pod cold.

Cek:

- latency by pod age;
- startup timeline;
- JFR startup;
- readiness logs;
- deployment events.

---

# 24. Latihan Bertahap

## Latihan 1 — JMH basic

Buat benchmark:

- string concat vs StringBuilder;
- `ArrayList` traversal vs `LinkedList`;
- regex compile per call vs cached Pattern;
- exception control flow vs validation branch.

Untuk setiap benchmark:

- warmup;
- measurement;
- fork;
- param input size;
- allocation profiler jika tersedia.

## Latihan 2 — Allocation profiling

Buat endpoint yang:

- parsing JSON besar;
- mapping DTO ke domain;
- logging payload;
- membuat banyak temporary object.

Ambil JFR dan identifikasi top allocation.

## Latihan 3 — Queue saturation

Buat service dengan bounded dan unbounded executor.

Load test:

- 100 RPS;
- 500 RPS;
- 1000 RPS.

Amati:

- latency;
- memory;
- queue size;
- error rate.

## Latihan 4 — DB pool multiplication

Simulasikan:

```text
replicas = 10
pool = 30
```

Lalu ubah:

```text
replicas = 30
pool = 30
```

Hitung total connection dan efek ke DB.

## Latihan 5 — Lock contention

Buat shared synchronized counter dan bandingkan dengan `LongAdder`.

Amati:

- throughput;
- CPU;
- JFR monitor/park events.

## Latihan 6 — Virtual thread with bulkhead

Buat 10.000 virtual-thread tasks yang memanggil fake downstream 100 ms.

Bandingkan:

- tanpa limit;
- dengan semaphore 100;
- dengan timeout 50 ms;
- dengan retry.

## Latihan 7 — GC behavior

Buat workload:

- high allocation short-lived;
- high allocation with surviving objects;
- large object allocation;
- cache leak.

Amati:

- GC log;
- heap used;
- allocation rate;
- pause;
- OOM behavior.

## Latihan 8 — Vector API experiment

Buat scalar vs vector benchmark untuk operasi array float/int besar.

Bandingkan:

- input kecil;
- input sedang;
- input besar;
- CPU berbeda jika tersedia.

Catat bahwa Vector API Java 25 masih incubator.

---

# 25. Mini Project: Java Performance Lab

## 25.1 Tujuan

Bangun project khusus untuk melatih performance engineering Java:

```text
java-performance-lab/
  README.md
  benchmarks/
  service/
  load-test/
  profiles/
  docs/
```

## 25.2 Modul benchmark

Buat JMH benchmark untuk:

1. collection traversal;
2. map lookup;
3. string parsing;
4. JSON serialization;
5. allocation patterns;
6. regex;
7. atomic vs LongAdder;
8. lock contention;
9. stream vs loop;
10. vector API.

## 25.3 Modul service

Spring Boot service:

Endpoint:

```text
POST /cases
GET /cases/{id}
POST /cases/{id}/escalate
GET /reports/summary
```

Tambahkan mode:

```text
mode=normal
mode=allocation-heavy
mode=db-slow
mode=lock-contention
mode=cpu-heavy
mode=io-wait
```

## 25.4 Observability

Expose:

- JVM metrics;
- endpoint latency;
- DB pool metrics;
- queue size;
- custom business metrics;
- JFR recording script;
- GC logs.

## 25.5 Load test

Buat skenario:

1. steady 100 RPS;
2. ramp 50 → 1000 RPS;
3. burst;
4. soak 2 jam;
5. dependency slow;
6. DB pool exhaustion;
7. deployment/cold pod.

## 25.6 Deliverables

- baseline report;
- bottleneck analysis;
- before/after comparison;
- JFR screenshots/notes;
- flame graph if available;
- tuning decision log;
- production checklist.

## 25.7 Pertanyaan review

1. Apa bottleneck pertama?
2. Apa evidence-nya?
3. Apa perubahan terkecil yang dicoba?
4. Apa metric yang membaik?
5. Apa metric yang memburuk?
6. Apakah improvement terlihat di micro dan macro benchmark?
7. Apakah correctness berubah?
8. Apakah cost berubah?
9. Apakah tail latency membaik?
10. Apa yang harus dimonitor agar regression terlihat?

---

# 26. Referensi Resmi dan Lanjutan

Referensi utama yang relevan untuk bagian ini:

1. OpenJDK JMH — Java Microbenchmark Harness.
2. JEP 508 — Vector API (Tenth Incubator), JDK 25.
3. Oracle Java SE 25 documentation — `java` command, JFR, troubleshooting, HotSpot, GC.
4. Oracle Java SE 25 Troubleshooting Guide — performance analysis with JFR.
5. JDK Mission Control documentation — profiling and troubleshooting.
6. Inside Java — performance improvements in JDK 25.
7. Java Language Specification dan JVM Specification untuk semantics/JVM behavior.
8. OpenJDK JEPs terkait JIT/runtime/GC/JFR/Vector.
9. Brendan Gregg materials on flame graphs dan systems performance.
10. Martin Thompson / mechanical sympathy materials untuk low-level concurrency/cache thinking.
11. OpenTelemetry documentation untuk metrics/tracing observability.
12. Kubernetes documentation untuk resource, CPU throttling, autoscaling, probes, dan pod lifecycle.

---

# Penutup

Advanced performance engineering di Java bukan tentang menghafal trik. Ini tentang berpikir seperti investigator:

```text
Apa workload-nya?
Apa targetnya?
Apa bottleneck-nya?
Apa evidence-nya?
Apa trade-off-nya?
Apa efek sampingnya?
Apa yang berubah setelah perbaikan?
```

Java modern sangat kuat karena JVM bisa melakukan optimasi runtime yang dalam: JIT, escape analysis, scalar replacement, GC adaptif, profiling, JFR, dan bahkan SIMD melalui Vector API. Tetapi kekuatan ini juga berarti benchmark dan intuisi mudah menipu.

Engineer top-tier tidak sekadar menulis kode yang terlihat cepat. Ia membangun sistem yang:

- benar;
- terukur;
- dapat dijelaskan;
- stabil pada tail latency;
- punya backpressure;
- resource-aware;
- bisa di-debug saat incident;
- dan setiap keputusan performanya punya bukti.

Performance yang baik bukan hasil “micro-optimization acak”. Performance yang baik adalah hasil desain, pengukuran, dan disiplin engineering.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-part-019.md](./learn-java-part-019.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: learn-java-part-021.md](./learn-java-part-021.md)
