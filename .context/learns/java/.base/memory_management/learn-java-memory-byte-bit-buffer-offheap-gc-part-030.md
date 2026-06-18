# learn-java-memory-byte-bit-buffer-offheap-gc-part-030.md

# Part 030 — Final Integration: Production Playbook, Case Studies, and Decision Matrix

> Seri: **Java Memory Management, Byte & Bit, Buffer, Off-Heap, dan Garbage Collection**  
> Target Java: **Java 8 sampai Java 25**  
> Level: **Advanced / production engineering / top-tier software engineer**  
> Status: **Bagian terakhir seri ini**

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya sudah membahas layer demi layer:

- bit, byte, primitive, object layout;
- reference graph dan compressed pointers;
- heap, stack, metaspace, code cache, native memory;
- allocation mechanics, TLAB, escape analysis;
- object lifetime, references, strings;
- `ByteBuffer`, direct buffer, mapped buffer, FFM API, `Unsafe`, `VarHandle`;
- CPU cache, locality, false sharing;
- Java Memory Model;
- GC fundamentals;
- Serial, Parallel, CMS, G1, ZGC, Shenandoah;
- GC observability, heap dump, native leak, container memory;
- memory-aware API/system design.

Bagian ini mengintegrasikan semuanya menjadi **production playbook**.

Tujuan akhirnya bukan sekadar tahu istilah, tapi mampu menjawab pertanyaan produksi seperti:

```text
Aplikasi kena OOMKilled, tapi heap tidak penuh. Mulai dari mana?

GC pause p99 naik, tapi CPU masih ada. Apakah harus ganti collector?

Direct buffer memory OOM, tapi tidak ada heap leak. Apa yang salah?

RSS terus naik, heap stabil. Apakah ini leak, fragmentation, page cache, atau native allocation?

Service latency spike saat traffic burst. Apakah masalah allocation rate, promotion, CPU cache, atau backpressure?

Haruskah pakai G1, ZGC, Shenandoah, Parallel, atau Serial?

Haruskah pakai byte[], heap ByteBuffer, direct ByteBuffer, MappedByteBuffer, atau MemorySegment?
```

Bagian ini sengaja dibuat sebagai **operational decision framework**.

---

## 1. Mental Model Akhir: JVM Memory Bukan Satu Kotak

Kesalahan besar dalam debugging Java memory adalah menganggap JVM memory sama dengan heap.

Model yang lebih benar:

```text
Process RSS / container memory
│
├── Java heap
│   ├── young generation / young regions
│   ├── survivor / aging area
│   ├── old generation / old regions
│   └── humongous / large object regions, depending collector
│
├── JVM native memory
│   ├── metaspace / class metadata
│   ├── code cache
│   ├── GC internal structures
│   ├── compiler memory
│   ├── symbol/string/class metadata support
│   ├── thread stacks
│   └── JVM internal arenas
│
├── Application native/off-heap memory
│   ├── direct ByteBuffer
│   ├── MappedByteBuffer mapping structures
│   ├── FFM MemorySegment native allocation
│   ├── JNI/native library allocation
│   └── framework-specific native allocator, e.g. network/storage libraries
│
├── OS/kernel visible memory effects
│   ├── page cache
│   ├── memory-mapped pages
│   ├── committed virtual memory
│   ├── resident pages
│   └── cgroup accounting
│
└── CPU/cache-level behavior
    ├── cache locality
    ├── false sharing
    ├── pointer chasing
    └── memory bandwidth pressure
```

Jadi ketika seseorang berkata:

```text
Memory Java tinggi.
```

Pertanyaan pertama seharusnya:

```text
Memory yang mana?

Heap?
Old-gen after GC?
RSS?
Direct memory?
Metaspace?
Thread stacks?
Mapped pages?
Native malloc?
Page cache?
Container working set?
```

Tanpa pemisahan ini, diagnosis akan acak.

---

## 2. Golden Rule: Pisahkan Symptom, Measurement, Cause, dan Fix

Banyak engineer langsung lompat dari symptom ke fix.

Contoh buruk:

```text
Symptom: GC pause tinggi.
Fix: Naikkan heap.
```

Padahal kemungkinan cause bisa sangat berbeda:

- allocation rate terlalu tinggi;
- live set terlalu besar;
- old-gen occupancy naik karena cache tidak bounded;
- humongous allocation pada G1;
- remembered set overhead tinggi;
- CPU throttling container;
- heap terlalu kecil;
- heap terlalu besar sehingga mixed collection mahal;
- object graph terlalu dalam;
- finalizer/reference processing terlalu berat;
- swap atau memory pressure host;
- direct memory pressure memicu Full GC untuk cleaner-based reclamation.

Framework yang lebih benar:

```text
1. Symptom
   Apa yang terlihat oleh user/system?

2. Measurement
   Data apa yang membuktikan symptom?

3. Classification
   Ini heap, native, GC, CPU, I/O, container, atau design issue?

4. Causal hypothesis
   Apa penyebab paling mungkin?

5. Validation
   Data apa yang bisa membantah atau menguatkan hipotesis?

6. Fix
   Ubah code, config, collector, heap sizing, limit, atau architecture?

7. Regression guard
   Metric/test apa yang memastikan masalah tidak kembali?
```

Top engineer tidak hanya tahu flag JVM. Top engineer membangun rantai bukti.

---

## 3. First-Response Production Checklist

Saat ada incident memory/GC, kumpulkan minimal data ini sebelum mengubah apapun.

### 3.1 Identitas Runtime

```bash
java -version
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
```

Yang ingin diketahui:

- Java version: 8, 11, 17, 21, 25;
- vendor/distribution;
- collector aktif;
- heap flags;
- direct memory flags;
- container awareness;
- NMT enabled atau tidak;
- explicit GC behavior;
- compressed oops status;
- metaspace/code cache settings.

### 3.2 Snapshot Heap dan GC

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> Thread.print
```

Untuk Java modern, `jcmd` adalah tool utama. Pada Java 8 legacy, `jmap`, `jstat`, dan GC log format lama masih sering diperlukan.

### 3.3 Native Memory

Jika NMT enabled:

```bash
jcmd <pid> VM.native_memory summary scale=MB
jcmd <pid> VM.native_memory detail scale=MB
```

NMT perlu diaktifkan saat startup:

```bash
-XX:NativeMemoryTracking=summary
# atau
-XX:NativeMemoryTracking=detail
```

NMT membantu melihat kategori internal JVM seperti Java heap, class, thread, code, GC, compiler, internal, symbol, native memory tracking, dan arena chunks. Namun NMT tidak selalu menangkap semua alokasi third-party native code.

### 3.4 Container/Kubernetes

```bash
kubectl describe pod <pod>
kubectl top pod <pod>
kubectl logs <pod> --previous
```

Cek:

- exit code 137;
- reason `OOMKilled`;
- memory request/limit;
- container restart count;
- CPU throttling;
- node memory pressure;
- liveness/readiness restart loops.

### 3.5 OS-Level View

Di Linux container/host:

```bash
cat /proc/<pid>/status
cat /proc/<pid>/smaps_rollup
pmap -x <pid>
```

Cek:

- `VmRSS`;
- `VmSize`;
- thread count;
- mapped file regions;
- anonymous RSS;
- shared/private pages.

### 3.6 JFR

Untuk Java 11+ dan terutama Java 17/21/25:

```bash
jcmd <pid> JFR.start name=mem settings=profile duration=5m filename=/tmp/mem.jfr
```

Cari:

- allocation hotspots;
- object allocation in new TLAB/outside TLAB;
- GC pause events;
- heap summary;
- CPU samples;
- thread allocation;
- file/socket pressure;
- lock/contention side effects.

---

## 4. Decision Tree: High Heap Usage

Symptom:

```text
Heap usage tinggi.
Old generation naik.
GC makin sering.
```

Jangan langsung sebut leak.

### 4.1 Pertanyaan Pertama

```text
Apakah old-gen after GC terus naik dari waktu ke waktu?
```

Yang penting bukan heap before GC, tapi **heap after GC**, khususnya old/live data setelah collection.

Jika pola:

```text
After GC baseline naik terus
```

kemungkinan:

- true leak;
- unbounded cache;
- queue backlog;
- session accumulation;
- classloader leak;
- ThreadLocal retention;
- long-running transaction retaining graph;
- framework context retaining request object;
- metrics label cardinality explosion.

Jika pola:

```text
Heap naik turun normal, after GC stabil
```

kemungkinan:

- allocation burst normal;
- heap terlalu kecil untuk burst;
- young generation kurang cocok;
- GC target terlalu agresif;
- traffic burst;
- materialization sementara.

### 4.2 Validasi

Gunakan:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /path/heap.hprof
```

Analisis:

- top classes by bytes;
- retained size;
- dominator tree;
- path to GC roots;
- queue/cache/session/static root;
- thread-local root;
- classloader root.

### 4.3 Fix Pattern

Jika cache leak:

```text
Unbounded Map -> bounded cache with size/weight/time eviction
```

Jika queue backlog:

```text
Unbounded queue -> bounded queue + backpressure + rejection/degradation policy
```

Jika ThreadLocal leak:

```text
try/finally remove() atau hindari ThreadLocal untuk pooled thread
```

Jika request materialization:

```text
Load all -> stream/page/chunk/process incrementally
```

Jika classloader leak:

```text
Stop retaining app classes from parent/static/global threads
```

---

## 5. Decision Tree: High RSS, Heap Stable

Symptom:

```text
Heap stabil.
GC normal.
Tetapi RSS/container memory naik.
```

Ini hampir pasti bukan heap leak biasa.

### 5.1 Kandidat Penyebab

```text
RSS high + heap stable
│
├── Direct ByteBuffer growth
├── MappedByteBuffer mapped pages/page cache
├── FFM MemorySegment/native allocation leak
├── JNI/native library malloc leak
├── Thread stack growth/thread count naik
├── Metaspace/classloader leak
├── Code cache/JIT growth
├── GC internal native overhead
├── libc allocator fragmentation
├── page cache/accounting effect
└── container memory limit terlalu sempit
```

### 5.2 Data yang Harus Dikumpulkan

```bash
jcmd <pid> VM.native_memory summary scale=MB
jcmd <pid> Thread.print | grep -c 'java.lang.Thread.State'
cat /proc/<pid>/smaps_rollup
pmap -x <pid> | sort -k3 -n | tail
```

Jika NMT tidak aktif, restart dengan:

```bash
-XX:NativeMemoryTracking=summary
```

Untuk production, `summary` sering lebih aman daripada `detail` karena overhead lebih rendah.

### 5.3 Interpretasi Cepat

| Data | Kemungkinan |
|---|---|
| NMT `Thread` besar | thread terlalu banyak atau `-Xss` terlalu besar |
| NMT `Class`/Metaspace naik | classloader leak, dynamic class generation |
| NMT `Code` besar | code cache/JIT activity |
| NMT `GC` besar | collector metadata overhead, heap/region/card/remset structures |
| Direct buffer OOM | direct memory allocation/reclamation issue |
| RSS tinggi tapi NMT tidak menjelaskan | JNI/native library, malloc fragmentation, mapped pages, page cache |

### 5.4 Fix Pattern

- Direct buffer: pool/bound allocation, set `MaxDirectMemorySize`, audit cleaner lifecycle.
- Mapped buffer: bound mapping window, explicit lifecycle via newer APIs where possible, avoid mapping unbounded segments.
- Native library: expose allocator metrics, use leak detector, upgrade library.
- Thread: reduce pool size, use virtual threads where suitable, tune `-Xss` carefully.
- Metaspace: investigate classloader retention, dynamic proxy generation, redeploy leak.
- Container: leave native headroom; do not set `Xmx` equal to pod limit.

---

## 6. Decision Tree: High GC Pause

Symptom:

```text
Latency spike aligns with GC pauses.
```

### 6.1 First Classification

```text
High GC pause
│
├── Young GC pause high
├── Mixed/old GC pause high
├── Full GC occurs
├── Reference processing high
├── Humongous allocation issue
├── Evacuation/promotion failure
├── Allocation stall
└── CPU throttling makes GC slower
```

### 6.2 Young GC Pause High

Likely causes:

- allocation rate too high;
- young generation too large;
- object graph scan cost high;
- remembered set scan high;
- too many live young objects;
- CPU constrained.

Fix options:

- reduce allocation;
- avoid materialization;
- reuse bounded buffers carefully;
- reduce temporary wrapper/DTO explosion;
- tune young size only after profiling;
- increase CPU or reduce throttling;
- consider ZGC/Shenandoah if pause SLO is strict.

### 6.3 Old/Mixed GC Pause High

Likely causes:

- live set too large;
- old-gen occupancy high;
- G1 mixed collection doing too much work;
- remembered set/card table overhead;
- humongous fragmentation;
- heap sizing mismatch.

Fix options:

- reduce live set;
- bound cache;
- split large arrays/strings;
- avoid humongous allocation pattern;
- tune G1 pause target realistically;
- consider ZGC for low-latency requirement.

### 6.4 Full GC

Full GC is a signal, not a normal steady-state event for many modern services.

Potential causes:

- heap exhausted;
- metaspace pressure;
- explicit `System.gc()`;
- promotion failure;
- evacuation failure;
- humongous allocation failure;
- direct buffer cleaner pressure;
- class unloading pressure.

Fix:

```text
Identify why Full GC happened before changing collector.
```

### 6.5 Allocation Stall

Common in concurrent collectors when allocation outruns collector progress.

Especially relevant to ZGC/Shenandoah:

```text
Application keeps allocating while collector is working.
If heap headroom is insufficient, mutator may stall.
```

Fix options:

- increase heap/headroom;
- reduce allocation rate;
- increase GC CPU threads carefully;
- reduce live set;
- improve backpressure;
- avoid burst materialization.

---

## 7. Decision Tree: Direct Memory OOM

Symptom:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

This means heap can look normal while direct memory is exhausted.

### 7.1 Typical Causes

- allocating direct buffers per request;
- no pooling;
- pooling but unbounded;
- slices retaining large parent buffer;
- delayed cleaner reclamation;
- direct memory limit too small;
- framework native buffer leak;
- retaining `ByteBuffer` references in queues/cache;
- async pipeline not releasing buffers.

### 7.2 Debug Questions

```text
Who allocates direct buffers?
Are buffers pooled?
Is the pool bounded?
Are slices retaining larger parent buffers?
Does the framework require explicit release?
Is MaxDirectMemorySize set?
Is direct memory visible in NMT?
Does heap dump show DirectByteBuffer objects retained?
```

### 7.3 Useful Commands

```bash
jcmd <pid> GC.class_histogram | grep -E 'DirectByteBuffer|MappedByteBuffer|ByteBuffer'
jcmd <pid> VM.native_memory summary scale=MB
```

Heap dump can still help because direct memory is native, but Java wrapper objects often reveal who retains it.

### 7.4 Fix Pattern

Bad:

```java
ByteBuffer buf = ByteBuffer.allocateDirect(size); // per request
```

Better:

```text
Use bounded direct buffer pool.
Define ownership.
Release/return exactly once.
Avoid retaining slices longer than parent budget.
Use heap buffer unless native I/O benefit is proven.
```

For modern off-heap code, consider FFM `Arena` + `MemorySegment` when explicit lifetime and bounds safety are more important than `ByteBuffer` compatibility.

---

## 8. Decision Tree: Metaspace OOM

Symptom:

```text
java.lang.OutOfMemoryError: Metaspace
```

### 8.1 Candidate Causes

- classloader leak;
- repeated redeploy without unloading;
- dynamic proxies generated endlessly;
- bytecode generation library misuse;
- scripting/template engine creating classes;
- excessive reflection/codegen cache;
- application server/plugin architecture retaining classloaders.

### 8.2 Debug Data

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_stats   # if available in specific runtime/options
jcmd <pid> VM.native_memory summary scale=MB
jcmd <pid> GC.class_histogram
```

### 8.3 Fix Pattern

- ensure classloader can be GCed;
- stop global static references to app classes;
- stop long-lived threads created by old classloader;
- bound dynamic class generation;
- reuse generated classes;
- upgrade libraries with known classloader leaks;
- set `MaxMetaspaceSize` as guardrail, not as real fix.

---

## 9. Decision Tree: Container OOMKilled

Symptom:

```text
Pod restarted.
Exit code 137.
Reason: OOMKilled.
Java did not throw OutOfMemoryError.
```

This means Linux/cgroup killed the process. JVM may not get a chance to report Java OOM.

### 9.1 Root Model

```text
Pod memory limit
│
├── Java heap Xmx
├── metaspace
├── direct memory
├── thread stacks
├── code cache
├── GC native structures
├── JIT/compiler/native internals
├── mapped pages/page cache accounting
├── native libraries
└── OS/process overhead
```

If:

```text
Xmx = pod memory limit
```

then the JVM has no native headroom.

### 9.2 Sizing Formula

A safer model:

```text
pod_limit
  >= Xmx
   + max_direct_memory
   + metaspace_budget
   + thread_count * Xss
   + code_cache
   + GC_native_overhead
   + native_libraries
   + mapped_memory_budget
   + safety_headroom
```

Typical mistake:

```text
Pod limit: 2 GiB
-Xmx: 2 GiB
```

Better direction:

```text
Pod limit: 2 GiB
-Xmx: 1.2–1.5 GiB, depending native/direct/thread profile
```

The exact number depends on workload, not fixed magic percentage.

### 9.3 Fix Pattern

- set explicit `Xmx` or `MaxRAMPercentage` with native headroom;
- set `MaxDirectMemorySize` if direct buffer use matters;
- cap thread pools;
- reduce `-Xss` only after validating stack depth;
- enable NMT in staging/load test;
- alert on RSS/container memory, not only heap;
- avoid liveness probes that amplify restart loops during GC/memory pressure.

---

## 10. GC Collector Decision Matrix

This matrix is not a replacement for measurement, but it gives a rational default.

| Workload | Java 8 | Java 11/17 | Java 21/25 | Starting Recommendation |
|---|---:|---:|---:|---|
| Small CLI/tool | Serial/Parallel | Serial/Parallel | Serial/Parallel | Keep simple; startup/footprint matter |
| Batch throughput | Parallel | Parallel/G1 | Parallel/G1 | Parallel if throughput dominates and pauses acceptable |
| General REST API | G1/CMS legacy | G1 | G1 | Start with G1, measure pause/allocation/live set |
| Latency-sensitive API | CMS/G1 with care | G1/ZGC | ZGC/G1 | Use ZGC if pause SLO strict and CPU/headroom available |
| Large heap service | G1 | G1/ZGC | ZGC/G1 | ZGC if pause independent of heap size matters |
| Memory-tight container | G1/Parallel | G1 | G1 | G1 often easier on RSS/headroom; verify |
| Experimental ultra-low pause | N/A | Shenandoah/ZGC depending distro | ZGC/Shenandoah | Requires operational maturity |
| Legacy Java 8 app | CMS/Parallel/G1 | migrate | migrate | Avoid over-tuning CMS; plan migration |

### 10.1 G1 When

Use G1 when:

- you need balanced throughput and latency;
- workload is general-purpose server-side;
- memory headroom is moderate;
- you want stable default behavior;
- you are on Java 9+ and do not have strict sub-millisecond pause SLO;
- you want good operational familiarity.

Watch for:

- humongous allocations;
- mixed GC tuning complexity;
- remembered set overhead;
- old-gen growth;
- evacuation failure;
- pause target treated as hard promise.

### 10.2 ZGC When

Use ZGC when:

- low pause is more important than max throughput;
- heap is large or latency SLO is strict;
- you can provide CPU and heap headroom;
- service is modern Java 17/21/25+;
- allocation stalls are monitored.

Watch for:

- insufficient headroom;
- allocation rate exceeding concurrent collection;
- CPU cost;
- container memory sizing;
- assuming low pause means no memory discipline needed.

In Java 25, ZGC is generational; non-generational ZGC mode was removed in JDK 24.

### 10.3 Shenandoah When

Use Shenandoah when:

- your distribution supports it well;
- low pause matters;
- you understand its modes and diagnostics;
- you are willing to validate workload fit.

Java 25 makes Generational Shenandoah a product feature, but it is not the default Shenandoah mode.

### 10.4 Parallel GC When

Use Parallel GC when:

- throughput is the primary goal;
- pause time is acceptable;
- batch processing dominates;
- simple tuning is preferred.

Avoid when:

- p99 latency matters;
- heap is large and stop-the-world pauses hurt;
- interactive service cannot tolerate long pauses.

### 10.5 Serial GC When

Use Serial GC when:

- tiny service/tool;
- low memory footprint;
- single CPU or very small container;
- startup simplicity.

Avoid for large server workloads.

---

## 11. Buffer / Memory Access Decision Matrix

| Need | Prefer | Avoid |
|---|---|---|
| Normal in-heap data | `byte[]` | direct buffer unless needed |
| API needs NIO compatibility | heap/direct `ByteBuffer` | custom pointer abstraction |
| Native I/O large long-lived buffer | direct `ByteBuffer` | per-request direct allocation |
| Large file random/sequential access | `MappedByteBuffer` or FFM mapping | loading entire file into heap |
| Explicit native memory lifetime | FFM `MemorySegment` + `Arena` | `Unsafe.allocateMemory` |
| Binary protocol parsing | `byte[]`, `ByteBuffer`, `MemorySegment` | object-per-field parsing |
| Shared mutable view | carefully sliced/duplicated buffer | passing buffer with mutable position across layers |
| Performance-critical packed data | primitive arrays / FFM layout | boxed objects / object graph explosion |

### 11.1 `byte[]`

Use when:

- simple heap-backed bytes;
- GC lifecycle is acceptable;
- data is request-scoped;
- copying cost is not bottleneck;
- code simplicity matters.

Risk:

- large arrays can pressure heap;
- large temporary arrays can create GC spikes;
- copying across native I/O boundary.

### 11.2 Heap `ByteBuffer`

Use when:

- API expects `ByteBuffer`;
- heap memory lifecycle is desired;
- direct native I/O benefit is not proven;
- you need buffer state machine semantics.

Risk:

- position/limit bugs;
- accidental sharing;
- less efficient for some native I/O paths.

### 11.3 Direct `ByteBuffer`

Use when:

- native I/O benefit is measurable;
- buffers are large and long-lived;
- pooling is bounded;
- ownership is explicit.

Risk:

- native memory leak;
- delayed cleaner reclamation;
- RSS growth;
- direct memory OOM;
- slices retaining parent.

### 11.4 `MappedByteBuffer`

Use when:

- working with large files;
- random access or OS page cache benefit matters;
- file-backed virtual memory is acceptable.

Risk:

- unmap lifecycle historically awkward;
- page fault latency;
- file truncation hazards;
- crash consistency misunderstood;
- RSS/page cache interpretation confusion.

### 11.5 FFM `MemorySegment`

Use when:

- explicit lifetime matters;
- native memory safety matters;
- you need bounds-checked off-heap access;
- native interop is required;
- modern Java baseline is available.

Risk:

- Java 22+ final API requirement for stable final form;
- different programming model;
- ecosystem compatibility may still require `ByteBuffer`.

---

## 12. Case Study 1: REST Service with High Allocation Rate

### 12.1 Symptom

```text
p99 latency spikes under load.
GC logs show frequent young GC.
Old-gen after GC stable.
CPU moderately high.
No leak.
```

### 12.2 Bad Diagnosis

```text
Heap leak.
Increase Xmx.
```

### 12.3 Better Diagnosis

If old-gen after GC is stable, the service may not leak. It may simply allocate too much temporary garbage.

Likely causes:

- DTO explosion;
- JSON parse into full object graph;
- repeated string concatenation/log formatting;
- collecting streams into lists unnecessarily;
- intermediate `Map<String,Object>` representation;
- per-request `byte[]`/buffer allocation;
- unnecessary boxing;
- repeated charset encode/decode.

### 12.4 Evidence

Use JFR:

```text
Object Allocation in New TLAB
Object Allocation Outside TLAB
Allocation by class
Allocation by stack trace
```

Use GC logs:

```text
allocation rate
young GC frequency
pause duration
heap after GC stable or not
```

### 12.5 Fix

- stream instead of materialize;
- reduce intermediate object graph;
- replace `List` accumulation with chunked processing;
- avoid boxing in hot path;
- reuse encoder/decoder carefully if safe;
- use bounded buffers;
- reduce logging allocation;
- consider faster/less allocating serialization only after proving hotspot.

### 12.6 Validation

Before/after:

```text
allocation MB/s decreases
young GC frequency decreases
p99 improves
old-gen after GC remains stable
CPU reduces or stays acceptable
```

---

## 13. Case Study 2: Direct Buffer Leak

### 13.1 Symptom

```text
java.lang.OutOfMemoryError: Direct buffer memory
Heap usage normal.
GC logs not alarming.
RSS high.
```

### 13.2 Root Cause Example

A networking layer allocates direct buffers per request and stores slices in async callbacks. Parent buffers remain retained longer than expected.

```text
DirectByteBuffer parent 16 MiB
│
└── slice 2 KiB retained by async callback

Result: tiny logical retention keeps large native allocation alive.
```

### 13.3 Evidence

```bash
jcmd <pid> GC.class_histogram | grep DirectByteBuffer
jcmd <pid> VM.native_memory summary scale=MB
```

Heap dump:

```text
Find DirectByteBuffer wrappers
Check retained path
Find queues/callbacks/futures retaining slices/parents
```

### 13.4 Fix

- define buffer ownership;
- release/return once;
- use bounded pool;
- copy small long-lived slice to heap if it must outlive parent;
- avoid retaining parent-sized allocation for tiny view;
- set direct memory budget;
- enable framework leak detector if available.

### 13.5 Lesson

Off-heap memory still needs lifecycle management. GC may collect wrapper objects, but it does not make ownership design disappear.

---

## 14. Case Study 3: G1 Humongous Allocation

### 14.1 Symptom

```text
G1 service has intermittent long pauses.
Logs mention humongous regions/allocations.
Heap has enough total free space but allocation fails or triggers expensive cycles.
```

### 14.2 Root Cause Example

Large arrays/strings/byte buffers exceed G1 humongous threshold relative to region size. They are allocated specially and can fragment the heap.

Examples:

- huge JSON payload as single `String`;
- large `byte[]` for file upload;
- `StringBuilder` grows into giant backing array;
- batch response materialized fully;
- compressed/uncompressed payload kept simultaneously.

### 14.3 Evidence

GC logs:

```text
Humongous regions
Humongous allocation
Concurrent cycle triggered by humongous allocation
```

Heap dump:

```text
large byte[]
large char[] / byte[] backing String
large Object[]
large collections
```

### 14.4 Fix

- stream large payloads;
- chunk file processing;
- avoid full materialization;
- compress/decompress streaming;
- impose request size limits;
- split large arrays if design allows;
- tune G1 region size only after design fixes are considered.

### 14.5 Lesson

A heap can have enough free memory but still behave badly because allocation shape and region layout matter.

---

## 15. Case Study 4: OOMKilled with Stable Heap

### 15.1 Symptom

```text
Kubernetes pod killed with OOMKilled.
No Java OutOfMemoryError.
Heap graphs look normal.
```

### 15.2 Root Cause Example

Pod limit: 1 GiB.

```text
-Xmx700m
Direct memory: 128m+
Metaspace: 100m
Thread stacks: 200 threads * 1m = 200m reserved/partially committed
Code cache + GC + native overhead: 100m+
```

RSS crosses pod limit.
Kernel kills process.

### 15.3 Evidence

```bash
kubectl describe pod
kubectl logs --previous
jcmd <pid> VM.native_memory summary scale=MB
```

Historical metrics:

```text
container_memory_working_set_bytes
jvm_memory_used_bytes{area="heap"}
jvm_memory_used_bytes{area="nonheap"}
jvm_threads_live_threads
process_resident_memory_bytes
```

### 15.4 Fix

- reduce `Xmx` to leave headroom;
- cap direct memory;
- reduce thread pools;
- use virtual threads where appropriate but still monitor carrier/platform thread usage;
- tune metaspace only as guardrail;
- set memory request/limit realistically;
- alert before cgroup kill.

### 15.5 Lesson

Container memory cares about process RSS/cgroup accounting, not just Java heap.

---

## 16. Case Study 5: Cache Causing Old-Gen Retention

### 16.1 Symptom

```text
Old-gen after GC rises slowly.
Full GC eventually occurs.
Heap dump shows large Map/Cache entries.
```

### 16.2 Root Cause Example

A cache keyed by user/filter/request parameters has no max size. High-cardinality keys accumulate over days.

Common variants:

- `Map<String, Object>` static cache;
- per-tenant cache with no tenant budget;
- metrics labels with unbounded cardinality;
- soft-reference cache relying on GC pressure;
- HTTP/session cache never expired;
- lookup cache invalidation missing.

### 16.3 Evidence

Heap dump dominator tree:

```text
Cache object dominates large retained heap.
Keys show high cardinality.
Values retain large graphs.
Path to GC root points to singleton/static/application context.
```

### 16.4 Fix

- define max entries or max weight;
- TTL/idle expiration;
- per-tenant budget;
- normalize keys;
- avoid caching negative/high-cardinality results blindly;
- expose cache metrics;
- test with cardinality burst.

### 16.5 Lesson

A cache is a controlled memory leak unless it has explicit bounds and eviction semantics.

---

## 17. Case Study 6: `ThreadLocal` Leak in Pooled Threads

### 17.1 Symptom

```text
Heap grows slowly.
Leak path shows Thread -> ThreadLocalMap -> value.
```

### 17.2 Root Cause

Thread pool threads live much longer than request objects. If request state is stored in `ThreadLocal` and not removed, it lives as long as the thread.

Bad:

```java
REQUEST_CONTEXT.set(context);
handler.handle();
```

Better:

```java
REQUEST_CONTEXT.set(context);
try {
    handler.handle();
} finally {
    REQUEST_CONTEXT.remove();
}
```

### 17.3 Complication

In app servers or plugin systems, `ThreadLocal` values can retain classloaders, causing metaspace/classloader leaks.

### 17.4 Lesson

ThreadLocal lifecycle must be shorter than the thread, not accidentally equal to it.

---

## 18. Case Study 7: Binary Protocol Corruption Due to Byte/Endian Mistake

### 18.1 Symptom

```text
Intermittent wrong IDs/lengths in binary protocol.
Only fails for values above 127 or for large payloads.
```

### 18.2 Root Cause

Signed byte widening or endian mismatch.

Bad:

```java
int value = bytes[0] << 24
          | bytes[1] << 16
          | bytes[2] << 8
          | bytes[3];
```

Better:

```java
int value = (bytes[0] & 0xFF) << 24
          | (bytes[1] & 0xFF) << 16
          | (bytes[2] & 0xFF) << 8
          | (bytes[3] & 0xFF);
```

Or use `ByteBuffer` with explicit byte order:

```java
int value = ByteBuffer.wrap(bytes)
        .order(ByteOrder.BIG_ENDIAN)
        .getInt();
```

### 18.3 Lesson

Memory correctness starts at bits. GC cannot save you from representation bugs.

---

## 19. Case Study 8: Object Graph Too Deep for Cache Locality

### 19.1 Symptom

```text
CPU high.
GC not terrible.
Allocation moderate.
But throughput poor.
Profiler shows time in traversal and getters.
```

### 19.2 Root Cause

Deep object graph:

```text
List<Order>
  -> Order
    -> Customer
    -> Address
    -> List<Item>
      -> Item
        -> Product
          -> Category
```

Every arrow is a reference chase. CPU cache misses dominate.

### 19.3 Fix Options

- flatten hot-path read model;
- use primitive arrays for numeric hot data;
- separate hot and cold fields;
- avoid object-per-cell representation;
- precompute compact projection;
- reduce polymorphic indirection;
- use data-oriented layout for hot loops.

### 19.4 Lesson

Memory performance is not only “how much memory”. It is also “how memory is arranged and traversed”.

---

## 20. Production Metrics: What to Put on Dashboard

A memory dashboard should not only show heap used.

### 20.1 JVM Heap

- heap used;
- heap committed;
- heap max;
- old-gen/old-region used after GC;
- young generation usage;
- allocation rate;
- promotion rate;
- live set estimate.

### 20.2 GC

- pause count;
- pause p50/p95/p99/max;
- GC CPU time percentage;
- Full GC count;
- concurrent cycle count;
- allocation stalls;
- evacuation/promotion failure;
- humongous allocation count if using G1.

### 20.3 Native/Process

- process RSS;
- container memory working set;
- direct buffer pool usage if exposed;
- metaspace used/committed;
- code cache;
- thread count;
- NMT category snapshots in staging/load tests.

### 20.4 Application Memory Drivers

- request payload size;
- response payload size;
- queue depth;
- cache size/weight;
- cache hit/miss/eviction;
- active sessions;
- in-flight requests;
- batch size;
- tenant cardinality;
- metrics label cardinality.

### 20.5 Alerts

Good alerts:

```text
Old-gen after GC rising for N minutes
Full GC count > 0 in service workload
GC pause p99 above SLO
Container memory > 85% limit
Direct memory usage > budget
Metaspace growing unexpectedly
Cache eviction absent while size grows
Queue depth grows with memory
```

Bad alerts:

```text
Heap used > 80%
```

Heap usage alone is often normal sawtooth behavior.

---

## 21. Production GC Log Review Checklist

When reading GC logs, ask:

```text
1. Which collector?
2. What caused the GC?
3. Was it young, mixed, full, concurrent, degenerated, or allocation stall?
4. Heap before/after?
5. Old/live set after GC?
6. Pause duration?
7. User/sys/real time?
8. Promotion amount?
9. Humongous objects?
10. Reference processing time?
11. Evacuation failure?
12. CPU throttling or real time much greater than CPU time?
13. Concurrent cycle finishing in time?
14. Does the event align with user-visible latency?
```

Interpretation examples:

```text
Young GC frequent + old stable
=> allocation rate issue or young sizing issue.

Old after GC rising
=> retention/leak/cache/queue/session.

Full GC after humongous allocation
=> allocation shape problem.

Allocation stall in ZGC
=> insufficient headroom or collector cannot keep up.

GC real time much higher than expected
=> CPU throttling, host pressure, safepoint delay, OS scheduling.
```

---

## 22. Java 8 to 25 Migration Memory Checklist

### 22.1 Java 8

Memory topics to watch:

- CMS still exists;
- G1 available but older than modern G1;
- PermGen already gone, metaspace exists;
- Java 8 GC logs use old flags;
- NMT exists but tool maturity differs;
- no stable FFM API;
- `Unsafe` widely used by libraries;
- compact strings not yet available;
- many frameworks may rely on reflection/Unsafe internals.

### 22.2 Java 11

Watch:

- G1 default;
- ZGC available as experimental/product depending exact version path;
- unified logging available;
- better container awareness than Java 8;
- Flight Recorder open sourced in OpenJDK path;
- compact strings available.

### 22.3 Java 17

Watch:

- strong encapsulation affects reflective/Unsafe-heavy libraries;
- ZGC/Shenandoah maturity improved;
- modern GC/logging/JFR baseline better;
- useful LTS migration target.

### 22.4 Java 21

Watch:

- virtual threads can reduce platform thread pressure for blocking workloads;
- Generational ZGC introduced;
- modern server baseline for many systems;
- still validate native/thread/direct memory budget.

### 22.5 Java 25

Watch:

- LTS release for many vendors;
- ZGC is generational, non-generational mode removed earlier in JDK 24 path;
- Generational Shenandoah is product feature but not default mode;
- FFM API is stable since Java 22;
- Unsafe memory-access methods are on deprecation/removal warning path;
- modern observability features improve JFR/JVM diagnostics.

---

## 23. Anti-Patterns and Better Alternatives

### 23.1 “Just Increase Heap”

Bad when:

- leak exists;
- cache unbounded;
- old live set grows;
- container native headroom disappears;
- bigger heap worsens pause.

Better:

```text
Understand live set, allocation rate, native headroom, and pause SLO.
```

### 23.2 “Use Direct Buffer Everywhere”

Bad when:

- buffers are small and short-lived;
- lifecycle unclear;
- no native I/O benefit;
- no pool/budget;
- debugging maturity is low.

Better:

```text
Use heap memory by default. Use direct/off-heap when there is measurable reason and ownership is explicit.
```

### 23.3 “Object Pool Everything”

Bad when:

- object allocation is cheap;
- pool creates contention;
- pool causes stale state bugs;
- pool retains too much memory;
- GC would handle short-lived objects better.

Better:

```text
Pool expensive native/direct resources, not ordinary short-lived Java objects by default.
```

### 23.4 “SoftReference Cache”

Bad because:

- eviction policy is GC-pressure-driven;
- latency becomes unpredictable;
- memory behavior is hard to reason about;
- cache hit rate depends on collector/memory pressure.

Better:

```text
Use explicit bounded cache with size/weight/TTL and metrics.
```

### 23.5 “GC Tuning Before Profiling”

Bad because:

- flags can hide design issues;
- collector behavior differs by Java version;
- incorrect tuning can worsen pause or throughput.

Better:

```text
Measure allocation rate, live set, pause distribution, RSS, native memory, and workload shape first.
```

### 23.6 “Heap Metrics Only”

Bad because:

- direct/native/metaspace/thread/code cache can kill container;
- mapped memory and page cache confuse RSS;
- Java OOM and OOMKilled are different.

Better:

```text
Observe heap + nonheap + direct + process RSS + container memory + thread count + GC.
```

---

## 24. Final Memory Engineering Workflow

Use this workflow for any memory/performance issue.

```text
Step 1: Classify the symptom
  - OOM?
  - OOMKilled?
  - high GC pause?
  - high RSS?
  - high allocation?
  - latency spike?
  - throughput drop?

Step 2: Identify the memory domain
  - heap
  - native
  - direct
  - metaspace
  - thread stack
  - mapped memory
  - container limit
  - CPU cache/locality

Step 3: Quantify
  - how much?
  - how fast growing?
  - correlated with traffic?
  - correlated with GC?
  - correlated with deployment?
  - correlated with data/cardinality?

Step 4: Establish timeline
  - sudden spike
  - slow leak
  - periodic burst
  - after release
  - after traffic pattern change
  - after config change

Step 5: Form hypotheses
  - allocation burst
  - retention leak
  - native leak
  - direct buffer lifecycle
  - classloader leak
  - cache/queue/session growth
  - collector mismatch
  - container sizing issue

Step 6: Validate with evidence
  - GC logs
  - JFR
  - heap dump
  - class histogram
  - NMT
  - OS/container metrics
  - application metrics

Step 7: Fix at correct layer
  - code
  - API design
  - buffer lifecycle
  - cache bound
  - queue backpressure
  - heap/native sizing
  - collector choice
  - container request/limit

Step 8: Add guardrails
  - dashboard
  - alert
  - load test
  - regression test
  - memory budget
  - leak detector
```

---

## 25. Memory Budget Template for Services

For a production service, define budget explicitly:

```yaml
memory_budget:
  pod_limit: 4096Mi
  java_heap_xmx: 2304Mi
  direct_memory_max: 384Mi
  metaspace_budget: 256Mi
  thread_stack_budget: 256Mi
  code_cache_budget: 128Mi
  gc_native_overhead_budget: 256Mi
  mapped_memory_budget: 0-256Mi
  native_library_budget: 128Mi
  safety_headroom: 384Mi
```

Also define application budgets:

```yaml
application_memory_budget:
  max_in_flight_requests: 200
  max_request_payload: 5Mi
  max_response_payload: 10Mi
  max_queue_depth: 1000
  cache_max_weight: 512Mi
  per_tenant_cache_limit: 64Mi
  direct_buffer_pool_limit: 256Mi
```

The point is not the exact numbers. The point is that memory becomes an explicit design constraint.

---

## 26. Final Decision Matrix: Symptom to Action

| Symptom | First Evidence | Likely Domain | First Good Action |
|---|---|---|---|
| Old-gen after GC rising | GC logs, heap dump | heap retention | dominator tree/path-to-root |
| Young GC too frequent | GC logs, JFR allocation | allocation rate | profile allocation stack traces |
| Full GC appears | GC logs | heap/metaspace/direct | identify cause before tuning |
| RSS high, heap stable | NMT, smaps | native/off-heap | classify native category |
| Direct buffer OOM | exception, histogram, NMT | direct memory | audit buffer ownership/pool |
| Metaspace OOM | NMT/classloader stats | class metadata | find classloader retention |
| OOMKilled | kube events, RSS | container memory | recalc heap/native headroom |
| Latency spike not GC | JFR/CPU profiler | CPU/cache/I/O/lock | profile wall-clock and CPU |
| G1 humongous issue | GC logs, heap dump | allocation shape | stream/chunk/split large objects |
| ZGC allocation stall | GC logs/JFR | headroom/allocation | increase headroom or reduce allocation |
| Cache memory growth | heap dump/app metrics | application design | bounded cache/eviction/budget |
| Queue memory growth | queue metrics/heap dump | backpressure | bound queue/degrade/reject |

---

## 27. What “Top 1%” Looks Like in Java Memory Engineering

A strong Java memory engineer does not merely know:

```text
-Xmx
-Xms
-XX:+UseG1GC
-XX:+UseZGC
```

They can reason across layers:

```text
Java object layout
→ reference graph
→ allocation path
→ object lifetime
→ GC root reachability
→ collector algorithm
→ native/direct memory
→ OS virtual memory
→ container cgroup
→ CPU cache locality
→ production observability
→ system design constraints
```

They can say:

```text
This is not a GC problem; it is an unbounded retention problem.

This is not a heap problem; it is native memory or direct buffer lifecycle.

This is not a collector mismatch; allocation shape is wrong.

This heap size reduces OOM but increases tail pause.

This off-heap optimization removes GC pressure but adds lifecycle risk.

This object-oriented model is semantically clean but physically cache-hostile.

This Kubernetes limit is too close to Xmx.
```

That is the level this series aimed to build.

---

## 28. Final Practical Checklist

Before shipping a memory-sensitive Java service, answer:

```text
1. What is max heap?
2. What is expected live set?
3. What is allocation rate under normal and peak load?
4. What is p99 GC pause target?
5. Which collector and why?
6. How much native headroom exists?
7. Is direct memory used? Where is it bounded?
8. Is mapped memory used? How is lifecycle controlled?
9. Is FFM/native memory used? Who owns Arena/lifetime?
10. How many threads can exist?
11. What is -Xss and thread stack budget?
12. What is metaspace risk?
13. Are caches bounded by size/weight/tenant?
14. Are queues bounded?
15. Can payloads be streamed instead of materialized?
16. Are large arrays/strings controlled?
17. Are heap dumps safe with respect to PII?
18. Is NMT enabled in at least staging/load test?
19. Are GC logs enabled and retained?
20. Is JFR available during incident?
21. Are RSS/container metrics monitored?
22. Are OOMKilled events alerted?
23. Is old-gen-after-GC tracked?
24. Is allocation rate tracked?
25. Is direct memory tracked if used?
```

If most of these have no answer, memory behavior is accidental.

---

## 29. Closing Summary

The core lesson of this full series:

```text
Java memory management is not only garbage collection.
```

It is a layered system:

```text
bits and bytes
→ primitive representation
→ object layout
→ reference graph
→ allocation mechanics
→ object lifetime
→ heap and native memory
→ buffers and off-heap lifecycle
→ CPU cache locality
→ Java Memory Model
→ garbage collector algorithms
→ production observability
→ container memory
→ system design
```

Garbage collection is only one part of the system. It can reclaim unreachable heap objects, but it cannot automatically fix:

- bad object lifetime design;
- unbounded caches;
- unbounded queues;
- excessive allocation;
- direct memory lifecycle bugs;
- native library leaks;
- classloader leaks;
- container sizing mistakes;
- binary representation bugs;
- poor data locality;
- missing backpressure;
- wrong memory budget.

The engineer’s job is to design memory behavior intentionally.

---

## 30. Series Completion Status

```text
Part 000 selesai: Mental Model Besar Java Memory
Part 001 selesai: Bits, Bytes, Words, Alignment, Endianness
Part 002 selesai: Java Primitive Memory Semantics
Part 003 selesai: Object Layout in HotSpot
Part 004 selesai: References, Pointers, OOPs, CompressedOops, Object Graph
Part 005 selesai: Stack, Heap, Metaspace, Code Cache, Thread Memory
Part 006 selesai: Allocation Mechanics, TLAB, Escape Analysis
Part 007 selesai: Object Lifetime Engineering
Part 008 selesai: Strong, Soft, Weak, Phantom References, Cleaner
Part 009 selesai: Arrays, Strings, Compact Strings, Charsets
Part 010 selesai: Bit Manipulation Patterns
Part 011 selesai: ByteBuffer Deep Dive
Part 012 selesai: Direct Buffer and Native Memory
Part 013 selesai: Memory-Mapped Files
Part 014 selesai: Foreign Function & Memory API
Part 015 selesai: Unsafe, VarHandle, Migration Strategy
Part 016 selesai: CPU Cache, Cache Lines, False Sharing, Locality
Part 017 selesai: Java Memory Model vs JVM Memory Management
Part 018 selesai: Garbage Collection Fundamentals
Part 019 selesai: Generational GC Internals
Part 020 selesai: Serial, Parallel, CMS
Part 021 selesai: G1 GC Deep Dive
Part 022 selesai: ZGC Deep Dive
Part 023 selesai: Shenandoah GC Deep Dive
Part 024 selesai: GC Selection Strategy
Part 025 selesai: GC Logging, JFR, JMX, NMT, Observability
Part 026 selesai: Heap Dump Analysis and Leak Investigation
Part 027 selesai: Native Memory Leak and Off-Heap Investigation
Part 028 selesai: Memory Tuning in Containers and Kubernetes
Part 029 selesai: Memory-Aware API and System Design Patterns
Part 030 selesai: Final Integration, Production Playbook, Case Studies, Decision Matrix
```

```text
Status akhir: SERI SELESAI.
```

---

## 31. References

Primary references used across this final integration:

- Oracle Java SE 25 Garbage Collection Tuning Guide  
  https://docs.oracle.com/en/java/javase/25/gctuning/

- Oracle Java SE 25 Available Collectors  
  https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html

- Oracle Java SE 25 G1 Garbage Collector  
  https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html

- Oracle Java SE 25 Z Garbage Collector  
  https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html

- Oracle Java SE Troubleshooting Guide / Diagnostic Tools  
  https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html

- Oracle Native Memory Tracking documentation  
  https://docs.oracle.com/en/java/javase/17/vm/native-memory-tracking.html

- OpenJDK JEP 248: Make G1 the Default Garbage Collector  
  https://openjdk.org/jeps/248

- OpenJDK JEP 363: Remove the Concurrent Mark Sweep GC  
  https://openjdk.org/jeps/363

- OpenJDK JEP 377: ZGC: A Scalable Low-Latency Garbage Collector  
  https://openjdk.org/jeps/377

- OpenJDK JEP 439: Generational ZGC  
  https://openjdk.org/jeps/439

- OpenJDK JEP 474: ZGC: Generational Mode by Default  
  https://openjdk.org/jeps/474

- OpenJDK JEP 490: ZGC: Remove the Non-Generational Mode  
  https://openjdk.org/jeps/490

- OpenJDK JEP 521: Generational Shenandoah  
  https://openjdk.org/jeps/521

- OpenJDK JEP 454: Foreign Function & Memory API  
  https://openjdk.org/jeps/454

- Java SE 25 API: `ByteBuffer`, `MappedByteBuffer`, `MemorySegment`, `Arena`, `Cleaner`, `VarHandle`  
  https://docs.oracle.com/en/java/javase/25/docs/api/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-029.md">⬅️ Part 029 — Memory-Aware API and System Design Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
