# Part 26 — Heap Dump and Memory Troubleshooting: Leak, Retention, Allocation, Native Memory

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Fokus: memahami, mengambil, membaca, dan mengorelasikan evidence memory runtime: heap dump, class histogram, allocation profile, GC log/JFR, Native Memory Tracking, container RSS/cgroup, dan error `OutOfMemoryError`.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Membedakan **heap growth**, **memory leak**, **allocation pressure**, **native memory growth**, dan **container memory limit pressure**.
2. Menentukan artifact yang tepat untuk setiap gejala memory: heap dump, class histogram, JFR, allocation profile, GC log, NMT, thread dump, atau OS/container metrics.
3. Membaca heap dump dengan model: **object graph**, **GC roots**, **shallow size**, **retained size**, **dominator tree**, dan **paths to GC roots**.
4. Mengenali pola leak Java nyata: cache leak, collection accumulation, `ThreadLocal` leak, classloader leak, listener leak, executor queue leak, direct buffer leak, JDBC/resource leak, request-context leak, logging/MDC leak.
5. Menangani OOM secara defensible: mengumpulkan evidence sebelum restart, membedakan mitigasi vs permanent fix, dan membuat postmortem yang bisa dipertanggungjawabkan.
6. Memahami perubahan Java 8 sampai Java 25: metaspace, compressed oops, direct buffer, container awareness, virtual threads, JFR, NMT, dan diagnostic commands.

---

## 1. Mental Model: Memory Problem Bukan Selalu “Heap Leak”

Ketika aplikasi Java “memory naik”, engineer sering langsung menyimpulkan:

> Ada memory leak di heap.

Itu terlalu cepat.

Memory incident di Java minimal punya beberapa lapisan:

```text
Process Memory / RSS
├── Java Heap
│   ├── Live objects
│   ├── Garbage not yet collected
│   ├── Fragmentation / region usage
│   └── Humongous / large objects
│
├── Non-Heap JVM Memory
│   ├── Metaspace
│   ├── Code cache
│   ├── Compressed class space
│   └── Internal JVM structures
│
├── Native Memory
│   ├── Thread stacks
│   ├── Direct buffers
│   ├── Mapped byte buffers
│   ├── JNI/native libraries
│   ├── TLS/crypto/native compression buffers
│   └── Allocator overhead / fragmentation
│
├── GC/JIT Runtime Overhead
│   ├── GC metadata
│   ├── remembered sets / card tables
│   ├── compiler memory
│   └── safepoint/runtime structures
│
└── Container / OS View
    ├── RSS
    ├── cgroup memory usage
    ├── page cache
    ├── swap
    └── OOM killer decision
```

Top-tier troubleshooting tidak dimulai dari “ambil heap dump saja”, tetapi dari pertanyaan:

> Memory mana yang naik? Heap, non-heap, direct/native, thread stack, atau container RSS?

---

## 2. Symptom Taxonomy

### 2.1 Heap leak

Ciri:

- after GC heap tetap naik;
- old generation terus bertambah;
- full GC tidak mengembalikan memory secara signifikan;
- heap dump menunjukkan object graph besar yang masih reachable;
- dominator tree menunjukkan accumulation point jelas.

Contoh:

- `Map` global tidak pernah dibersihkan;
- cache tanpa eviction;
- `List` history/event terus bertambah;
- `ThreadLocal` value tidak pernah `remove()`;
- listener/subscriber tidak di-unregister.

### 2.2 Allocation pressure

Ciri:

- banyak object dibuat cepat, tetapi tidak selalu leak;
- GC frequency tinggi;
- CPU naik karena GC;
- latency naik karena allocation rate;
- heap setelah GC relatif turun lagi;
- allocation profiler menunjukkan hot allocation sites.

Contoh:

- JSON serialization berulang;
- logging membuat banyak string/stacktrace;
- DTO mapping berlebihan;
- regex/formatter dibuat per request;
- stream pipeline membuat banyak temporary object.

### 2.3 Retention spike

Ciri:

- memory naik selama operasi besar;
- turun setelah operasi selesai;
- bukan leak permanen, tetapi peak memory terlalu tinggi;
- sering terjadi di batch/export/import/reporting.

Contoh:

- load seluruh result set ke memory;
- generate file besar dalam `byte[]`;
- kumpulkan semua response sebelum streaming;
- batch chunk terlalu besar.

### 2.4 Native/direct memory growth

Ciri:

- heap normal, tetapi RSS/container memory naik;
- `OutOfMemoryError: Direct buffer memory` mungkin muncul;
- NMT menunjukkan kategori `Internal`, `Thread`, `Arena`, `NIO`, atau native area besar;
- container OOMKilled padahal heap metrics tampak aman.

Contoh:

- `ByteBuffer.allocateDirect()` tidak terkendali;
- Netty direct buffer/pool;
- memory mapped file;
- native compression/crypto;
- JNI library leak;
- terlalu banyak thread platform.

### 2.5 Metaspace/classloader leak

Ciri:

- metaspace naik setelah redeploy/reload;
- class count naik;
- heap dump menunjukkan classloader lama masih reachable;
- sering terjadi di app server, plugin runtime, scripting engine, hot reload, dynamic proxy/codegen.

Contoh:

- static reference dari parent classloader ke object child classloader;
- thread tidak berhenti saat undeploy;
- JDBC driver tidak deregister;
- logging framework/listener menahan classloader.

### 2.6 Native thread exhaustion

Ciri:

- `OutOfMemoryError: unable to create native thread`;
- heap bisa masih aman;
- thread count tinggi;
- process limit / cgroup / OS limit tercapai;
- thread dump menunjukkan pool leak atau unbounded thread creation.

Contoh:

- `new Thread()` per request;
- executor tidak di-shutdown;
- scheduler membuat worker baru terus;
- blocking call membuat thread pool terus diperbesar.

---

## 3. OOM Taxonomy di Java

### 3.1 `java.lang.OutOfMemoryError: Java heap space`

Artinya JVM tidak bisa mengalokasikan object di Java heap.

Kemungkinan:

- heap leak;
- allocation spike;
- heap terlalu kecil;
- GC tidak bisa reclaim cukup cepat;
- large object allocation gagal.

Evidence utama:

- heap dump;
- GC log;
- class histogram;
- JFR allocation/heap statistics;
- metrics heap after GC.

### 3.2 `GC overhead limit exceeded`

JVM terlalu banyak waktu untuk GC tetapi reclaim memory terlalu sedikit.

Biasanya:

- heap hampir penuh;
- live set terlalu besar;
- allocation rate tinggi;
- heap undersized atau leak.

Evidence:

- GC log;
- heap dump;
- allocation profile;
- object histogram.

### 3.3 `Metaspace`

Metaspace penuh.

Kemungkinan:

- dynamic class generation berlebihan;
- classloader leak;
- terlalu banyak proxies/classes;
- `MaxMetaspaceSize` terlalu rendah.

Evidence:

- class histogram;
- heap dump classloader analysis;
- JFR class loading events;
- NMT;
- JVM flags.

### 3.4 `Direct buffer memory`

Direct memory limit tercapai.

Kemungkinan:

- direct buffer allocation tinggi;
- Netty/NIO buffer leak;
- memory mapped file;
- delayed cleaner/free;
- `MaxDirectMemorySize` terlalu rendah.

Evidence:

- NMT;
- JFR allocation/native events jika tersedia;
- direct buffer pool metrics;
- async-profiler native allocation;
- heap dump untuk `DirectByteBuffer` wrapper.

### 3.5 `unable to create native thread`

JVM gagal membuat platform thread.

Kemungkinan:

- terlalu banyak thread;
- OS limit;
- container PID/memory limit;
- thread stack terlalu besar;
- executor/thread leak.

Evidence:

- thread dump;
- OS thread count;
- `ulimit`/container limit;
- NMT `Thread` category;
- metrics thread count.

### 3.6 Container `OOMKilled`

Linux/container membunuh process karena melewati cgroup memory limit.

Penting:

- tidak selalu muncul Java `OutOfMemoryError`;
- heap dump otomatis bisa tidak sempat dibuat;
- heap metrics bisa tampak normal;
- penyebab bisa native/direct/thread/page cache.

Evidence:

- Kubernetes event: `OOMKilled`;
- container memory RSS/cgroup usage;
- JVM heap/non-heap/direct metrics;
- NMT jika sempat;
- pod logs sebelum mati;
- node/container runtime metrics.

---

## 4. Evidence Selection Matrix

| Gejala | Evidence pertama | Evidence kedua | Catatan |
|---|---|---|---|
| Heap after GC terus naik | GC log/metrics | Heap dump | Cari live set dan dominator |
| Latency naik + GC sering | GC log/JFR | Allocation profile | Bisa allocation pressure, bukan leak |
| RSS naik, heap stabil | NMT | async-profiler native alloc | Curiga direct/native/thread |
| OOMKilled tanpa Java OOM | Container metrics | NMT/JFR sebelum mati | Process mati di luar JVM |
| `unable to create native thread` | Thread dump/count | NMT Thread | Periksa executor/thread leak |
| Metaspace OOM | Class loading metrics | Heap dump classloader | Cari classloader retention |
| Memory naik hanya saat batch | JFR/allocation | Heap histogram saat batch | Bisa retention spike |
| Leak setelah redeploy | Heap dump | classloader analysis | App server/plugin/hot reload |
| Banyak `byte[]` / `char[]` | Heap dump dominator | allocation profile | Bisa payload/log/serialization |
| Cache besar | Heap dump | cache metrics | Periksa eviction/cardinality |

---

## 5. Heap Dump Mental Model

Heap dump adalah snapshot object graph Java heap pada satu waktu.

Heap dump menjawab:

- object apa yang hidup;
- class apa yang paling banyak memakai heap;
- object mana yang menahan object lain;
- jalur referensi dari GC roots ke object;
- dominator mana yang jika dilepas akan membebaskan banyak memory.

Heap dump tidak selalu menjawab:

- siapa yang mengalokasikan object tersebut;
- kapan object dibuat;
- kenapa object bertambah;
- apakah object leak atau memang legitimate live set;
- native memory usage;
- direct memory native bytes secara penuh.

Untuk “siapa yang mengalokasikan”, gunakan allocation profiling/JFR. Untuk “kenapa masih hidup”, gunakan heap dump.

---

## 6. Core Concept: GC Roots

Object Java bisa hidup jika reachable dari GC roots.

Contoh GC roots:

- local variables di stack thread;
- static fields;
- JNI references;
- system classloader;
- active thread objects;
- monitor locks;
- references dari JVM internals.

Model:

```text
GC Root
  └── Static field SomeRegistry.INSTANCE
        └── ConcurrentHashMap handlers
              └── Handler object
                    └── Big cache/list/session/context
```

Pertanyaan utama saat membaca heap dump:

> Object ini hidup karena memang masih dibutuhkan, atau karena ada reference path yang tidak sengaja menahannya?

---

## 7. Shallow Size vs Retained Size

### 7.1 Shallow size

Memory object itu sendiri.

Contoh:

```java
class UserSession {
    String id;
    Map<String, Object> attributes;
}
```

Shallow size `UserSession` hanya ukuran object header + reference fields, bukan seluruh `String` dan `Map` yang direferensikan.

### 7.2 Retained size

Memory yang akan bebas jika object tersebut tidak lagi reachable.

Retained size lebih penting untuk leak analysis karena menunjukkan impact.

Contoh:

```text
SessionRegistry
  retained size = 2.4 GB
```

Artinya jika registry itu dilepas atau entries dibersihkan, sekitar 2.4 GB object graph bisa menjadi reclaimable.

---

## 8. Dominator Tree

Object A mendominasi object B jika semua path dari GC roots ke B melewati A.

Dominator tree membantu menemukan accumulation point.

Contoh:

```text
com.acme.CacheManager @ 0x123
retained heap: 1.8 GB
└── ConcurrentHashMap @ 0x456
    ├── Node[] @ 0x789
    └── values: List<CaseSnapshot>
```

Interpretasi:

- bukan berarti `CacheManager` bug;
- berarti `CacheManager` adalah pengendali retensi besar;
- lanjutkan dengan memeriksa key cardinality, eviction policy, TTL, entry age, tenant/module distribution.

Top-tier membaca dominator tree dengan domain knowledge, bukan hanya “largest retained heap = root cause”.

---

## 9. Paths to GC Roots

Jika ada object besar, tanyakan:

> Siapa yang menahannya tetap hidup?

Path example:

```text
GC Root: Thread "http-nio-8080-exec-42"
  └── ThreadLocalMap
      └── Entry
          └── RequestContext
              └── UserProfile
              └── CaseDocument
              └── byte[] documentContent
```

Interpretasi:

- Thread pool reuse membuat `ThreadLocal` value tetap hidup;
- request selesai tapi context tidak `remove()`;
- memory leak muncul perlahan sesuai request traffic.

---

## 10. Mengambil Heap Dump

### 10.1 Dengan `jcmd`

Modern recommendation:

```bash
jcmd <pid> GC.heap_dump /tmp/app-heap-$(date +%Y%m%d-%H%M%S).hprof
```

Live-only style pada beberapa tool/opsi dapat mengurangi noise, tetapi hati-hati: triggering full GC bisa memengaruhi aplikasi.

### 10.2 Dengan `jmap`

```bash
jmap -dump:format=b,file=/tmp/app.hprof <pid>
```

Untuk live objects:

```bash
jmap -dump:live,format=b,file=/tmp/app-live.hprof <pid>
```

### 10.3 Otomatis saat OOM

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdumps
```

Tambahkan command tambahan bila perlu:

```bash
-XX:OnOutOfMemoryError="jcmd %p Thread.print > /var/log/app/thread-on-oom.txt"
```

Namun jangan bergantung penuh pada OOM hook. Pada container `OOMKilled`, JVM bisa mati tanpa sempat menulis heap dump.

### 10.4 Kubernetes

```bash
kubectl exec -it <pod> -- jcmd 1 GC.heap_dump /tmp/app.hprof
kubectl cp <namespace>/<pod>:/tmp/app.hprof ./app.hprof
```

Perhatikan:

- file `.hprof` bisa sangat besar;
- pod ephemeral storage bisa penuh;
- heap dump dapat mengandung PII/secrets;
- copy file bisa lambat;
- proses bisa pause.

---

## 11. Heap Dump Safety Rules

Heap dump berisi data memory mentah aplikasi.

Kemungkinan terkandung:

- password/token/API key;
- request/response payload;
- PII;
- session/cookie;
- business data;
- database credentials;
- document contents.

Rules:

1. Jangan upload heap dump ke tool publik.
2. Enkripsi saat transfer.
3. Batasi akses.
4. Hapus setelah selesai sesuai retention policy.
5. Masking sulit dilakukan setelah dump dibuat; prevention lebih baik.
6. Buat incident artifact register: siapa mengambil, kapan, dari env mana, ukuran, lokasi, kapan dihapus.

---

## 12. Object Histogram

Sebelum heap dump besar, gunakan class histogram.

```bash
jcmd <pid> GC.class_histogram
```

Atau output ke file:

```bash
jcmd <pid> GC.class_histogram > class-histo.txt
```

Contoh:

```text
 num     #instances         #bytes  class name
------------------------------------------------
   1:      8500000      680000000  byte[]
   2:      4300000      344000000  java.lang.String
   3:      1200000      192000000  java.util.HashMap$Node
   4:       900000      144000000  com.acme.case.CaseSnapshot
```

Interpretasi awal:

- banyak `byte[]`: payload, buffers, serialized data, strings, files;
- banyak `String`: identifiers, JSON/XML, cache keys, logs, parsing;
- banyak `HashMap$Node`: maps besar/banyak;
- banyak domain object: accumulation domain-specific.

Histogram tidak menunjukkan siapa yang menahan object. Untuk itu perlu heap dump.

---

## 13. Eclipse MAT Workflow

Basic workflow:

1. Open `.hprof`.
2. Jalankan Leak Suspects Report.
3. Buka Dominator Tree.
4. Sort by retained heap.
5. Identifikasi top dominators.
6. Expand object graph.
7. Jalankan Paths to GC Roots pada suspect.
8. Exclude weak/soft/phantom references jika perlu.
9. Periksa collection size, map keys, object fields.
10. Hubungkan dengan domain: tenant, module, request type, batch job, cache policy.

MAT membantu menjawab:

- siapa accumulation point;
- path retention;
- retained heap terbesar;
- duplicate strings;
- classloader leak suspects;
- collection fill ratio.

---

## 14. Leak Pattern Catalog

### 14.1 Unbounded cache

```java
private final Map<String, CaseDetails> cache = new ConcurrentHashMap<>();

public CaseDetails get(String id) {
    return cache.computeIfAbsent(id, this::loadCaseDetails);
}
```

Masalah:

- tidak ada TTL;
- tidak ada max size;
- key cardinality tidak dibatasi;
- cache global untuk tenant/module berbeda;
- cache value terlalu berat.

Fix direction:

- gunakan bounded cache;
- TTL/TTI;
- max weight, bukan hanya max entries;
- metrics hit/miss/eviction/size;
- avoid caching request-specific/permission-specific data tanpa key lengkap.

### 14.2 Collection accumulation

```java
private final List<Event> processedEvents = new ArrayList<>();

void process(Event e) {
    processedEvents.add(e);
}
```

Masalah:

- list menjadi audit/history in-memory;
- tidak ada cleanup;
- production traffic membuat growth linear.

Fix direction:

- persist ke DB/log/event store;
- ring buffer bounded;
- sampling;
- retention policy.

### 14.3 ThreadLocal leak

```java
static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();

void handle(Request request) {
    CTX.set(buildContext(request));
    service.process(request);
    // missing CTX.remove()
}
```

Fix:

```java
void handle(Request request) {
    CTX.set(buildContext(request));
    try {
        service.process(request);
    } finally {
        CTX.remove();
    }
}
```

Dengan thread pool, leak bisa bertahan selama thread hidup.

### 14.4 MDC leak

```java
MDC.put("case.id", caseId);
service.process();
// no MDC.clear/remove
```

Efek:

- wrong log context;
- data request A muncul di request B;
- object/string retained oleh thread pool;
- security/privacy issue.

Fix:

```java
try {
    MDC.put("case.id", caseId);
    service.process();
} finally {
    MDC.remove("case.id");
}
```

Lebih aman: scope object `AutoCloseable`.

### 14.5 Listener/subscriber leak

```java
publisher.register(listener);
```

Masalah:

- listener tidak unregister;
- listener mereferensikan service/controller/session;
- lifecycle object tidak benar.

Fix:

- unregister on close/destroy;
- weak listener jika cocok;
- lifecycle ownership jelas.

### 14.6 Executor queue leak

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
```

Default queue untuk beberapa executor bisa unbounded tergantung construction.

Masalah:

- producers lebih cepat dari consumers;
- queue menyimpan request/job besar;
- memory naik, latency naik, akhirnya OOM.

Fix:

- bounded queue;
- rejection policy;
- backpressure;
- shed load;
- metrics queue depth.

### 14.7 CompletableFuture retention

```java
List<CompletableFuture<Result>> futures = items.stream()
    .map(item -> CompletableFuture.supplyAsync(() -> process(item), executor))
    .toList();

return futures.stream().map(CompletableFuture::join).toList();
```

Masalah:

- semua future dan result ditahan sampai selesai;
- failure path bisa menahan exception + context;
- large fan-out membuat retention spike.

Fix:

- bounded concurrency;
- streaming result;
- timeout/cancellation;
- avoid retaining entire input/output graph.

### 14.8 Classloader leak

Common roots:

- static fields;
- active threads;
- ThreadLocal values;
- JDBC drivers;
- logging appenders;
- timers/schedulers;
- MBeans;
- caches in parent classloader.

Heap dump clue:

```text
WebAppClassLoader @ old deployment
retained by ThreadLocal / static registry / running thread
```

### 14.9 DirectByteBuffer leak

Heap dump may show many `java.nio.DirectByteBuffer` wrappers.

But native bytes live outside heap.

Evidence:

- heap dump: wrapper references;
- NMT: native memory category;
- direct buffer pool metrics;
- async-profiler native allocation;
- Netty leak detector if Netty used.

### 14.10 Logging-induced memory pressure

Pattern:

- huge exception storm;
- async logger queue fills;
- stack traces retained in queue;
- JSON encoder allocates large strings;
- log aggregation slow;
- memory grows due to queued events.

Evidence:

- heap dump: logging event objects;
- thread dump: appender/encoder blocking;
- metrics: log queue depth/dropped events;
- CPU: serialization/compression.

---

## 15. Allocation Profiling vs Heap Dump

Heap dump:

```text
What is alive now?
Who retains it?
```

Allocation profiling:

```text
Who creates objects?
How fast?
How much allocation rate?
```

A class can allocate heavily but not appear in heap dump because objects die young.

Example:

```text
High allocation: JSON parsing creates many temporary char[]
Heap dump: normal
GC: frequent young GC
Latency: high
```

Correct tool:

- async-profiler `alloc`;
- JFR allocation events;
- GC allocation rate metrics.

---

## 16. Native Memory Tracking

NMT tracks HotSpot VM native memory categories and is accessed with `jcmd`.

Enable:

```bash
-XX:NativeMemoryTracking=summary
```

or detailed:

```bash
-XX:NativeMemoryTracking=detail
```

Baseline:

```bash
jcmd <pid> VM.native_memory baseline
```

Summary:

```bash
jcmd <pid> VM.native_memory summary
```

Diff:

```bash
jcmd <pid> VM.native_memory summary.diff
```

Shutdown final report:

```bash
-XX:+UnlockDiagnosticVMOptions -XX:+PrintNMTStatistics
```

Important categories:

- Java Heap;
- Class;
- Thread;
- Code;
- GC;
- Compiler;
- Internal;
- Symbol;
- Native Memory Tracking;
- Arena Chunk.

Interpretation:

```text
Thread category high
→ many platform threads or large stack size

Class category high
→ metaspace/classloader/codegen issue

Internal/Arena high
→ JVM internal/native allocation; need deeper evidence

Java Heap committed normal but RSS high
→ look at Thread, Direct/NIO, mmap, native libs, allocator overhead
```

Limitasi: NMT tidak selalu melacak semua third-party native allocation secara penuh.

---

## 17. Direct Memory and Buffer Pools

Direct memory dipakai oleh:

- NIO;
- Netty;
- HTTP clients;
- database drivers;
- compression;
- TLS;
- file/channel operations;
- memory mapped files.

Metrics yang berguna:

- `java.nio:type=BufferPool,name=direct`;
- count;
- memory used;
- total capacity;
- mapped buffer pool.

JMX example:

```java
ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)
    .forEach(pool -> {
        System.out.println(pool.getName());
        System.out.println(pool.getCount());
        System.out.println(pool.getMemoryUsed());
        System.out.println(pool.getTotalCapacity());
    });
```

Troubleshooting:

1. Bandingkan heap vs RSS.
2. Periksa direct buffer pool metrics.
3. Periksa `MaxDirectMemorySize`.
4. Gunakan NMT.
5. Gunakan async-profiler native allocation jika perlu.
6. Periksa library pooling/leak detector.

---

## 18. Memory Troubleshooting by Scenario

### 18.1 Scenario: Heap naik perlahan selama hari kerja

Steps:

1. Lihat heap after GC trend.
2. Lihat old gen occupancy.
3. Ambil class histogram beberapa kali.
4. Jika growth jelas, ambil heap dump saat rendah dan tinggi.
5. Compare dominator.
6. Cari accumulation point.
7. Paths to GC roots.
8. Hubungkan dengan traffic/domain operation.
9. Fix retention owner.

Common root cause:

- cache unbounded;
- map/list accumulation;
- session/context leak;
- event listener leak.

### 18.2 Scenario: Latency naik, GC sering, heap tidak bocor

Steps:

1. Lihat allocation rate.
2. JFR allocation profile.
3. async-profiler alloc.
4. Identify hot allocation sites.
5. Periksa request path dengan traces.
6. Kurangi temporary objects atau batch allocation.

Common root cause:

- JSON/XML mapping;
- logging stack trace storm;
- DTO transformations;
- inefficient string operations.

### 18.3 Scenario: Pod OOMKilled, heap max hanya 60%

Steps:

1. Confirm Kubernetes `OOMKilled`.
2. Compare cgroup memory vs JVM heap/non-heap.
3. Periksa direct buffer metrics.
4. Periksa thread count.
5. Enable/use NMT.
6. Cek native libraries.
7. Cek memory-mapped files/page cache pattern.

Common root cause:

- direct/native memory;
- too many threads;
- container memory sizing salah;
- `-Xmx` terlalu dekat dengan container limit tanpa headroom.

### 18.4 Scenario: Metaspace OOM setelah beberapa redeploy

Steps:

1. Periksa class count trend.
2. Ambil heap dump.
3. Cari old classloader instances.
4. Paths to GC roots.
5. Periksa static refs, threads, ThreadLocal, MBeans, JDBC drivers.
6. Fix lifecycle cleanup.

### 18.5 Scenario: Batch export OOM

Steps:

1. Periksa batch input size.
2. Ambil JFR/allocation profile saat export.
3. Periksa heap histogram.
4. Cari `byte[]`, `char[]`, DTO list, workbook/document model.
5. Ubah ke streaming/chunking.
6. Tambah guardrail: max export size, pagination, temp file, backpressure.

---

## 19. Java 8 sampai Java 25 Considerations

### Java 8

- Metaspace menggantikan PermGen.
- NMT tersedia tetapi perlu enable di startup.
- GC log syntax masih legacy.
- JFR awalnya punya kondisi lisensi historis pada Oracle JDK; pada JDK modern JFR open dan built-in.
- Container awareness lebih terbatas tergantung update level.

### Java 11

- JFR lebih mainstream dan production-friendly.
- Unified logging tersedia.
- Container support jauh lebih baik dibanding Java 8 awal.
- Banyak aplikasi LTS enterprise berada di baseline ini.

### Java 17

- LTS umum untuk enterprise modern.
- JFR/JMC/NMT workflow stabil.
- Strong encapsulation bisa memengaruhi beberapa tool/library lama.

### Java 21

- Virtual threads finalized.
- Thread count bisa melonjak secara logical tanpa platform thread sebanyak itu.
- Memory analysis perlu membedakan virtual thread object/continuation vs platform thread stack.
- JSON virtual thread dump tersedia via `jcmd Thread.dump_to_file` pada generasi modern.

### Java 25

- Perlu memperhatikan fitur modern seperti Scoped Values dan structured concurrency ecosystem.
- Diagnostic tooling terus berkembang.
- Untuk materi ini, prinsip evidence tetap sama: tentukan memory region, ambil artifact tepat, interpretasi berdasarkan reachability/allocation/native usage.

---

## 20. Production JVM Flags for Memory Evidence

Baseline yang umum:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdumps
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Untuk NMT:

```bash
-XX:NativeMemoryTracking=summary
```

Untuk Java 8 GC log legacy, format berbeda:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=10
-XX:GCLogFileSize=100M
```

Container sizing example:

```bash
-XX:MaxRAMPercentage=70
-XX:InitialRAMPercentage=50
```

Catatan: jangan set heap sampai 95% container limit. Sisakan headroom untuk metaspace, code cache, thread stack, direct buffers, native memory, profiler/agent overhead, dan OS/runtime overhead.

---

## 21. Memory Sizing Mental Model in Containers

Jika container limit 4 GiB:

```text
Container memory limit: 4096 MiB
├── Java heap:             2500 MiB
├── Metaspace/class/code:   300 MiB
├── Direct/native buffers:  300 MiB
├── Thread stacks:          200 MiB
├── GC/JIT/internal:        300 MiB
├── Agent/profiler/libs:    100 MiB
└── Safety margin:          396 MiB
```

Salah satu anti-pattern:

```text
Container limit = 4096 MiB
-Xmx = 4096 MiB
```

Ini hampir pasti riskan karena heap bukan satu-satunya memory process.

---

## 22. Code-Level Prevention Patterns

### 22.1 Bounded cache

```java
Cache<String, CaseDetails> cache = Caffeine.newBuilder()
    .maximumWeight(500_000_000)
    .weigher((String key, CaseDetails value) -> estimateWeight(value))
    .expireAfterWrite(Duration.ofMinutes(30))
    .recordStats()
    .build(this::loadCaseDetails);
```

Principle:

- always bounded;
- expose metrics;
- eviction must be expected behavior;
- weight often better than entry count.

### 22.2 Streaming instead of buffering

Bad:

```java
List<Row> rows = repository.findAllRows();
byte[] file = reportService.generate(rows);
return ResponseEntity.ok(file);
```

Better:

```java
public void export(OutputStream out, Query query) {
    repository.streamRows(query, row -> reportWriter.write(out, row));
}
```

### 22.3 Safe ThreadLocal scope

```java
public final class ContextScope implements AutoCloseable {
    private final String previous;

    public ContextScope(String requestId) {
        this.previous = REQUEST_ID.get();
        REQUEST_ID.set(requestId);
    }

    @Override
    public void close() {
        if (previous == null) {
            REQUEST_ID.remove();
        } else {
            REQUEST_ID.set(previous);
        }
    }
}
```

Usage:

```java
try (ContextScope ignored = new ContextScope(requestId)) {
    service.handle();
}
```

### 22.4 Bounded executor queue

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    8,
    8,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(1_000),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Principle:

- queue is memory;
- unbounded queue is hidden memory risk;
- rejection policy is part of architecture.

### 22.5 Avoid retaining request payload

Bad:

```java
logContext.put("requestBody", body);
auditBuffer.add(body);
exception.addSuppressed(new PayloadException(body));
```

Better:

```java
logContext.put("request.size", body.length());
logContext.put("request.sha256", sha256(body));
```

---

## 23. Memory Incident Runbook

### Step 1 — Stabilize

- reduce traffic if needed;
- disable non-critical batch/export;
- increase replicas if leak is slow and restart-safe;
- temporarily raise memory only if safe and understood;
- avoid blind restart before evidence if possible.

### Step 2 — Identify memory region

Collect:

```bash
jcmd <pid> VM.flags
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> Thread.print
jcmd <pid> VM.native_memory summary   # if NMT enabled
```

Also collect:

- heap/non-heap/direct metrics;
- container memory RSS;
- GC log/JFR;
- recent deployment/config changes;
- traffic/request mix;
- batch/scheduler activity.

### Step 3 — Capture expensive artifact if justified

- heap dump if heap leak suspected;
- JFR if allocation/GC/thread evidence needed;
- async-profiler if allocation/native evidence needed;
- NMT diff if native growth suspected.

### Step 4 — Analyze

- top retained heap;
- path to GC roots;
- allocation hot spots;
- native categories;
- thread count/stack memory;
- business dimension: tenant, case, module, job, request type.

### Step 5 — Decide mitigation

Examples:

- restart leaking pod;
- reduce batch chunk size;
- disable problematic feature flag;
- lower concurrency;
- increase cache eviction;
- reduce logging level;
- raise container memory with headroom;
- disable direct buffer pooling only if understood.

### Step 6 — Permanent fix

- correct ownership/lifecycle;
- add bounds;
- add eviction;
- streaming/chunking;
- cleanup hooks;
- context cleanup;
- metrics and alerts;
- regression test.

---

## 24. Common False Conclusions

### “Heap dump shows many `String`, so String is the bug”

Usually false. `String` is a value type used everywhere. Find who retains the strings.

### “GC is the root cause because GC CPU is high”

Maybe false. GC can be victim of allocation pressure or leak.

### “Heap is only 60%, so memory is fine”

False in containers. RSS includes native/direct/thread/metaspace.

### “Increasing `-Xmx` fixes OOM”

Sometimes mitigation, often delays failure. It can worsen container OOM if native headroom disappears.

### “Heap dump after restart is enough”

Usually false. Restart destroys evidence.

### “Largest object is always root cause”

False. It may be legitimate cache/data. Need ownership and expected size.

---

## 25. Mini Case Study: OOMKilled but Heap Looks Fine

### Symptom

- Kubernetes pod restarts every few hours.
- Reason: `OOMKilled`.
- JVM heap dashboard shows max 55%.
- No Java `OutOfMemoryError` in logs.

### Initial bad conclusion

> Heap dashboard says memory fine. Kubernetes must be wrong.

### Evidence

```text
Container limit: 2 GiB
-Xmx: 1536 MiB
Heap used: 850 MiB
Non-heap: 180 MiB
Thread count: 900
Direct buffer pool: 320 MiB
RSS before death: ~2 GiB
```

NMT summary:

```text
Thread reserved/committed high
Internal/NIO/direct memory high
```

Thread dump:

```text
Hundreds of scheduler/executor worker threads retained
```

### Actual cause

A scheduled integration client created a new executor per partner sync and did not shut it down. Each executor retained platform threads and request buffers. Heap was not the main issue; native thread stacks + direct buffers pushed RSS over cgroup limit.

### Fix

- shared bounded executor;
- shutdown lifecycle;
- bounded queue;
- direct buffer metrics;
- alert on thread count and RSS/heap gap;
- reduce `-Xmx` to leave native headroom;
- add load test for repeated scheduler runs.

---

## 26. Mini Case Study: Heap Leak in Workflow State Cache

### Symptom

- Heap after GC increases linearly during business hours.
- Full GC does not reclaim enough.
- OOM after 12–18 hours.

### Evidence

Class histogram:

```text
com.acme.workflow.WorkflowSnapshot: 1,800,000 instances
java.util.concurrent.ConcurrentHashMap$Node: high
byte[] serializedPayload: high
```

Dominator tree:

```text
WorkflowSnapshotCache
  retained heap: 2.1 GB
```

Path to GC roots:

```text
GC Root: static WorkflowRegistry.INSTANCE
  -> WorkflowSnapshotCache.cache
  -> ConcurrentHashMap
  -> WorkflowSnapshot
  -> serialized state payload
```

### Root cause

Cache key included `workflowInstanceId` but no eviction existed. Completed workflows stayed in memory forever.

### Fix

- max weight cache;
- expire after completion;
- persist snapshot to DB/object storage;
- metrics: cache size, weight, eviction count;
- state transition cleanup hook;
- regression test with 100k completed workflows.

---

## 27. Practical Lab

### Lab 1 — Create and analyze collection leak

Implement:

```java
@RestController
class LeakController {
    private final List<byte[]> leak = new ArrayList<>();

    @PostMapping("/leak")
    public String leak() {
        leak.add(new byte[1024 * 1024]);
        return "size=" + leak.size();
    }
}
```

Run:

```bash
for i in {1..200}; do curl -X POST localhost:8080/leak; done
jcmd <pid> GC.class_histogram > histo.txt
jcmd <pid> GC.heap_dump /tmp/leak.hprof
```

Analyze with MAT:

- dominator tree;
- retained size;
- path to GC roots.

### Lab 2 — ThreadLocal leak

Create filter with missing cleanup. Send many requests on a fixed thread pool. Observe retained `RequestContext` through thread roots.

### Lab 3 — Direct buffer pressure

Allocate direct buffers and compare:

- heap metrics;
- RSS;
- direct buffer pool MXBean;
- NMT.

### Lab 4 — Allocation pressure without leak

Create endpoint that serializes/parses large JSON repeatedly. Compare heap dump vs allocation profile.

---

## 28. Production Checklist

### JVM flags

- [ ] `HeapDumpOnOutOfMemoryError` enabled where storage allows.
- [ ] `HeapDumpPath` points to writable secure volume.
- [ ] GC logs enabled with rotation.
- [ ] NMT enabled at least in staging/canary, or production if overhead acceptable.
- [ ] Container heap percentage leaves native headroom.

### Metrics

- [ ] Heap used/committed/max.
- [ ] Heap after GC / old gen occupancy.
- [ ] Non-heap/metaspace/code cache.
- [ ] Direct/mapped buffer pool.
- [ ] Thread count.
- [ ] GC pause/count/allocation rate.
- [ ] Container RSS/cgroup memory.
- [ ] RSS minus heap approximation.
- [ ] Cache sizes/evictions.
- [ ] Executor queue sizes.

### Code design

- [ ] All caches bounded.
- [ ] ThreadLocal/MDC cleaned in `finally`.
- [ ] Executors bounded and lifecycle-managed.
- [ ] Batch/export uses streaming/chunking.
- [ ] Request payload not retained unnecessarily.
- [ ] Listeners/subscribers unregistered.
- [ ] Direct/native resource lifecycle explicit.

### Incident readiness

- [ ] Runbook for heap dump and NMT collection.
- [ ] Secure artifact handling process.
- [ ] Tooling available in image or debug image.
- [ ] Enough ephemeral/storage strategy for dumps.
- [ ] Postmortem template includes memory region classification.

---

## 29. Summary

Memory troubleshooting di Java bukan sekadar “ambil heap dump lalu cari object terbesar”. Pendekatan yang benar:

1. Tentukan memory region yang bermasalah.
2. Bedakan leak, pressure, retention spike, native growth, thread exhaustion, dan container OOM.
3. Ambil artifact yang sesuai.
4. Baca heap dump sebagai object graph berbasis reachability.
5. Gunakan allocation profiling untuk object creation rate.
6. Gunakan NMT/direct buffer metrics untuk native/RSS gap.
7. Hubungkan evidence teknis dengan domain operation dan lifecycle ownership.
8. Buat fix yang membatasi growth, memperjelas ownership, dan menambahkan observability guardrail.

Engineer top-tier tidak hanya memperbaiki OOM. Ia membuat sistem berikutnya lebih sulit mengalami OOM diam-diam.

---

## 30. Referensi

- Oracle Java SE 25 Troubleshooting Guide — Troubleshoot Memory Leaks.
- Oracle Java SE Diagnostic Tools — `jcmd`, heap dump, and related diagnostic commands.
- Oracle Native Memory Tracking documentation for HotSpot JVM.
- Eclipse Memory Analyzer documentation — Dominator Tree, Paths to GC Roots, Leak Suspects.
- OpenJDK / Oracle documentation for JFR, JVM diagnostics, and runtime tooling.

---

## Status Series

Selesai sampai: **Part 26 — Heap Dump and Memory Troubleshooting: Leak, Retention, Allocation, Native Memory**.

Belum selesai. Berikutnya:

**Part 27 — GC Observability and Troubleshooting Across Java 8–25**.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 25 — Thread Dump Analysis: Deadlock, Blocking, Starvation, Pool Exhaustion](./25-thread-dump-analysis-deadlock-blocking-starvation-pool-exhaustion.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 27 — GC Observability and Troubleshooting Across Java 8–25](./27-gc-observability-and-troubleshooting-across-java-8-25.md)
