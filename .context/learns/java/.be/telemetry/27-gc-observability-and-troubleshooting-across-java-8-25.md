# Part 27 — GC Observability and Troubleshooting Across Java 8–25

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Previous: Part 26 — Heap Dump and Memory Troubleshooting  
Next: Part 28 — Database and External Dependency Troubleshooting with Logs, Metrics, Traces

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **GC observability** dan **GC troubleshooting** untuk Java 8 sampai Java 25.

Kita tidak akan mengulang teori dasar garbage collection secara penuh. Seri sebelumnya sudah membahas memory, heap, GC, off-heap, buffer, dan JVM. Di sini fokusnya lebih praktis dan forensic:

> Bagaimana membaca sinyal GC untuk menjawab: apakah GC benar-benar penyebab incident, atau hanya gejala dari masalah lain?

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membaca GC log Java 8 dan Java 9+ Unified Logging.
2. Membedakan GC sebagai **root cause**, **amplifier**, dan **symptom**.
3. Menganalisis latency spike yang tampak seperti GC pause.
4. Menghubungkan GC log dengan metrics, traces, JFR, heap dump, thread dump, dan profiler.
5. Mendiagnosis allocation rate, promotion pressure, humongous allocation, old-gen pressure, metaspace pressure, direct memory pressure, dan container memory pressure.
6. Menentukan apakah problem lebih cocok diselesaikan dengan code change, memory sizing, GC tuning, pool tuning, cache policy, atau workload shaping.
7. Membuat production-ready GC logging standard untuk Java 8 sampai Java 25.

---

## 1. Mental Model: GC Is Memory Traffic Control

Garbage collector bukan sekadar “pembersih memory”. Dalam sistem produksi, GC adalah **traffic controller** untuk object lifecycle.

Aplikasi Java memproduksi object. Object bergerak melalui siklus:

```text
allocation -> temporary use -> reachable/unreachable -> collection/retention -> possible promotion -> eventual reclamation
```

GC bertugas menjaga agar heap tetap bisa menerima object baru tanpa melanggar latency target secara berlebihan.

Masalah muncul ketika salah satu dari ini terjadi:

1. **Allocation rate terlalu tinggi**
   Aplikasi membuat object terlalu cepat.

2. **Object lifetime lebih panjang dari desain**
   Object yang seharusnya short-lived menjadi retained.

3. **Live set terlalu besar**
   Terlalu banyak object yang benar-benar masih reachable.

4. **Heap terlalu kecil untuk workload**
   GC sering bekerja karena ruang terlalu sempit.

5. **Heap terlalu besar untuk latency target tertentu**
   Beberapa collector dan phase tertentu bisa memiliki cost proporsional terhadap live set/heap layout.

6. **Memory pressure bukan di heap**
   Direct buffer, metaspace, thread stack, native library, mmap, JIT code cache, dan container RSS bisa menjadi penyebab.

7. **Collector tidak cocok dengan workload**
   Misalnya latency-sensitive service memakai konfigurasi yang menghasilkan pause panjang.

8. **GC dituduh karena terlihat di waktu yang sama**
   Padahal root cause bisa DB lock, CPU throttling, network stall, logging storm, thread pool exhaustion, atau dependency timeout.

Mental model penting:

> GC log menjelaskan apa yang JVM lakukan terhadap memory. GC log tidak otomatis menjelaskan kenapa application behavior menghasilkan memory pressure.

GC log adalah evidence, bukan verdict.

---

## 2. GC as Root Cause, Amplifier, or Symptom

Saat incident, jangan langsung menyimpulkan “GC problem”. Klasifikasikan dahulu.

### 2.1 GC sebagai Root Cause

GC adalah root cause bila perubahan GC behavior langsung menyebabkan impact.

Contoh:

- Full GC panjang membuat request timeout.
- ZGC allocation stall karena heap terlalu kecil.
- G1 evacuation failure menyebabkan pause besar.
- Metaspace OOM membuat service tidak bisa load class.
- Humongous allocation memicu old-gen pressure dan repeated concurrent cycle.

### 2.2 GC sebagai Amplifier

GC memperparah problem yang root cause-nya ada di tempat lain.

Contoh:

- DB lambat membuat request hidup lebih lama.
- Request hidup lebih lama membuat object graph request tertahan.
- Heap occupancy naik.
- GC makin sering.
- Latency makin buruk.

Dalam kasus ini, tuning GC saja tidak cukup. Root cause tetap DB/dependency latency.

### 2.3 GC sebagai Symptom

GC terlihat abnormal karena aplikasi menciptakan memory behavior abnormal.

Contoh:

- cache tidak dibatasi,
- retry storm,
- log storm,
- response body besar,
- batch load terlalu besar,
- `ThreadLocal` leak,
- duplicate request storm,
- queue backlog membuat banyak message tertahan.

GC hanya memberi alarm bahwa object lifecycle tidak sehat.

---

## 3. Evidence Model untuk GC Troubleshooting

GC diagnosis harus menggabungkan beberapa evidence.

```text
Symptom
  |
  +-- Metrics
  |     +-- heap used
  |     +-- GC pause
  |     +-- GC count
  |     +-- allocation rate
  |     +-- CPU
  |     +-- RSS/container memory
  |
  +-- GC logs
  |     +-- cause
  |     +-- before/after heap
  |     +-- region movement
  |     +-- pause phases
  |     +-- concurrent phases
  |
  +-- JFR
  |     +-- allocation in new TLAB/outside TLAB
  |     +-- GC events
  |     +-- object allocation sample
  |     +-- execution sample
  |     +-- socket/file/lock events
  |
  +-- Heap dump / histogram
  |     +-- retained objects
  |     +-- top classes
  |     +-- GC roots
  |
  +-- Thread dump
  |     +-- request pile-up
  |     +-- blocked threads
  |     +-- pool exhaustion
  |
  +-- Traces/logs
        +-- endpoint/workflow impact
        +-- dependency latency
        +-- error bursts
        +-- request identity
```

GC log alone answers:

- when GC happened,
- what kind of GC happened,
- how long it took,
- what heap changed,
- what phase dominated.

GC log alone usually does **not** answer:

- which endpoint allocated most,
- which tenant caused pressure,
- which object retained memory,
- whether DB caused request pile-up,
- whether CPU throttling made GC slower,
- whether memory pressure was direct/native, not heap.

---

## 4. Important Terms

### 4.1 Allocation Rate

Amount of new memory allocated per unit time.

```text
allocation_rate = bytes_allocated / second
```

High allocation rate is not always bad. It becomes bad when it exceeds what collector and CPU budget can handle.

Examples of high allocation sources:

- JSON serialization/deserialization,
- DTO mapping,
- regex,
- logging with string concatenation,
- exception-heavy control flow,
- large result sets,
- batch processing,
- repeated copying of byte arrays,
- unbounded stream collection,
- inefficient template rendering.

### 4.2 Live Set

Objects still reachable after GC.

If live set grows, GC cannot reclaim enough memory.

```text
before GC: 6 GB used
 after GC: 5.8 GB used
```

This means most memory is live or retained, not garbage.

### 4.3 Garbage Ratio

How much memory becomes reclaimable.

```text
reclaimed = before_used - after_used
```

If GC is frequent and reclaimed memory is small, suspect retention/live-set pressure.

### 4.4 Pause Time

Time where application threads are stopped or delayed due to GC phase.

Not all GC work is stop-the-world. Modern collectors move much work concurrently, but still have pauses.

### 4.5 Concurrent Cycle

GC work that runs while application threads continue.

Concurrent cycle still consumes CPU and memory bandwidth. It can degrade throughput even if pause time is low.

### 4.6 Promotion

Object moves from young generation to old generation after surviving collections.

Promotion pressure means too many objects survive young GC.

### 4.7 Humongous Allocation

In G1, very large objects are allocated as humongous regions. These can create fragmentation and trigger concurrent cycles.

Common sources:

- large byte arrays,
- large JSON/XML payload,
- file read into memory,
- report generation,
- huge `String`,
- large `ArrayList`,
- large PDF/template rendering.

### 4.8 Allocation Stall

Application thread cannot allocate because heap/region availability is insufficient and must wait for GC progress.

This is especially important in low-latency concurrent collectors.

### 4.9 Safepoint

A point where JVM can safely stop Java threads for certain VM operations including some GC phases.

Latency spike may be safepoint-related, not purely GC-related.

---

## 5. Java Version Timeline: Java 8 to Java 25

### 5.1 Java 8 World

Typical collectors:

- Serial GC,
- Parallel GC,
- CMS,
- G1 available and increasingly used.

Logging style:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-Xloggc:/path/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=10
-XX:GCLogFileSize=100M
```

Java 8 GC logs are collector-specific and less uniform.

### 5.2 Java 9+ World

Java 9 introduced Unified JVM Logging.

GC logging uses `-Xlog`, for example:

```bash
-Xlog:gc*:file=/path/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Unified logging makes GC log configuration more consistent across JVM components.

### 5.3 Java 11

Common production LTS baseline.

Typical collector choices:

- G1 default,
- ZGC available but earlier maturity level depending on release,
- Parallel GC for throughput-heavy jobs,
- Serial GC for tiny apps.

### 5.4 Java 17

Strong LTS baseline.

G1 is mature. ZGC is production-grade low-latency collector. Container awareness is much better than old Java baselines.

### 5.5 Java 21

Virtual threads and Generational ZGC become major considerations. Generational ZGC was delivered in JDK 21 through JEP 439.

### 5.6 Java 25

Java 25 continues the modern JVM direction: stronger observability tooling, mature JFR/JMC ecosystem, modern GC choices, and virtual-thread-aware diagnostics.

---

## 6. Production GC Logging Standard

### 6.1 Java 8 Baseline

For Java 8:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-XX:+PrintTenuringDistribution
-XX:+PrintGCApplicationStoppedTime
-Xloggc:/var/log/app/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=10
-XX:GCLogFileSize=100M
```

Optional for deeper analysis:

```bash
-XX:+PrintAdaptiveSizePolicy
-XX:+PrintReferenceGC
-XX:+PrintSafepointStatistics
```

Be careful: some diagnostic flags may increase log volume significantly.

### 6.2 Java 11+ Baseline

For Java 11+:

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

More detailed during investigation:

```bash
-Xlog:gc*,gc+heap=debug,gc+age=trace,safepoint:file=/var/log/app/gc-debug.log:time,uptime,level,tags:filecount=10,filesize=100M
```

For container stdout style:

```bash
-Xlog:gc*,safepoint:stdout:time,uptime,level,tags
```

But in Kubernetes, consider log volume and collector cost.

### 6.3 What Must Be Included

Production GC logs should include:

- wall-clock timestamp,
- uptime,
- log level,
- tags,
- GC cause,
- heap before/after,
- pause duration,
- relevant phase breakdown,
- rotation policy.

### 6.4 What Not To Do

Avoid:

```bash
# no timestamps
-Xlog:gc

# no rotation on VM/file based deployments
-Xlog:gc*:file=/var/log/app/gc.log

# legacy Java 8 flags on Java 11+
-XX:+PrintGCDetails -Xloggc:/tmp/gc.log
```

On Java 9+, many old GC logging flags were removed or replaced by Unified Logging.

---

## 7. Reading GC Logs: Universal Method

Do not read GC logs line by line randomly. Use a structured method.

### Step 1 — Establish Time Window

Ask:

- When did user impact start?
- Which instance/pod was affected?
- Is the time in UTC, local time, or JVM uptime?
- Is clock synchronized?

### Step 2 — Identify Collector

Find JVM flags:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
```

Look for:

```text
-XX:+UseG1GC
-XX:+UseZGC
-XX:+UseParallelGC
-XX:+UseSerialGC
```

### Step 3 — Identify GC Pattern

Look for:

- frequent young GC,
- full GC,
- long pauses,
- concurrent cycle frequency,
- allocation failure,
- evacuation failure,
- humongous allocation,
- metadata GC threshold,
- allocation stall,
- to-space exhausted,
- promotion failure.

### Step 4 — Measure Before/After

For each important event:

```text
before heap -> after heap (capacity), duration
```

Interpretation:

```text
large before, small after       => lots of garbage reclaimed
large before, still large after => live set/retention pressure
small before, frequent GC       => young gen too small or allocation rate high
```

### Step 5 — Correlate with Impact

A GC event matters only if it aligns with impact:

- request latency,
- timeout,
- error spike,
- throughput drop,
- CPU spike,
- container restart,
- queue backlog.

### Step 6 — Compare Healthy vs Unhealthy Instance

Do not overfit one instance.

Compare:

- GC count,
- pause p95/p99,
- allocation rate,
- heap after full/concurrent cycle,
- CPU,
- RSS,
- request mix,
- deployment version,
- traffic share.

---

## 8. Core GC Metrics You Need

Minimum JVM GC metrics:

| Metric | Why It Matters |
|---|---|
| Heap used | Current Java heap pressure |
| Heap committed/max | Sizing and container relation |
| Non-heap used | Metaspace/code cache pressure |
| GC pause count | Frequency of pause events |
| GC pause duration | User-visible latency risk |
| GC CPU/overhead | Throughput impact |
| Allocation rate | Object creation pressure |
| Promotion rate | Survivor/old-gen pressure |
| Old gen occupancy | Long-lived object pressure |
| Young gen occupancy | Short-lived allocation pressure |
| Metaspace usage | Classloader/class generation issue |
| Direct buffer usage | Off-heap memory pressure |
| Process RSS | Container OOM risk |
| CPU throttling | Can make GC and app slower |

Important derived metrics:

```text
allocation_rate = increase(bytes_allocated_total) / window

gc_pause_ratio = sum(gc_pause_seconds) / window_seconds

post_gc_old_occupancy_trend = old_gen_used_after_gc over time

memory_headroom = container_limit - process_rss
```

---

## 9. Common GC Incident Patterns

### 9.1 High Allocation Rate, Low Retention

Symptoms:

- frequent young GC,
- heap after GC drops significantly,
- old gen stable,
- CPU high,
- latency sometimes elevated.

Interpretation:

Application creates many temporary objects.

Likely causes:

- JSON serialization hot path,
- log message construction,
- DTO copying,
- stream/lambda allocation-heavy code,
- regex,
- large temporary collections,
- per-request object graph too large.

Evidence:

- JFR allocation events,
- async-profiler allocation profile,
- high young GC count,
- stable heap after GC.

Fix direction:

- reduce object churn,
- reuse buffers carefully,
- avoid unnecessary mappings,
- optimize serialization,
- reduce logging allocation,
- tune young generation only after code/workload analysis.

### 9.2 Growing Old Generation / Live Set

Symptoms:

- after-GC heap slowly increases,
- old gen occupancy trends upward,
- GC becomes more frequent,
- eventually full GC/OOM.

Likely causes:

- unbounded cache,
- retained request/session data,
- static collection,
- listener/subscriber leak,
- ThreadLocal leak,
- classloader leak,
- queue backlog retaining messages,
- long-lived batch aggregation.

Evidence:

- class histogram over time,
- heap dump dominator tree,
- JFR object count after GC if available,
- logs showing backlog/request pile-up.

Fix direction:

- bound cache,
- remove retention path,
- clear ThreadLocal/MDC,
- limit batch chunk size,
- drain/backpressure queues,
- fix lifecycle cleanup.

### 9.3 Full GC Storm

Symptoms:

- repeated Full GC,
- low reclaimed memory,
- latency/timeouts,
- CPU high or throughput collapse.

Interpretation:

Full GC storm usually means JVM is trying to recover memory but live set is too high or fragmentation/collector failure occurred.

Likely causes:

- heap too small,
- memory leak,
- old gen pressure,
- humongous allocation fragmentation,
- metaspace pressure,
- explicit `System.gc()`.

Evidence:

- Full GC cause,
- heap before/after,
- class histogram,
- heap dump,
- JFR GC events.

Fix direction:

- capture dump before restart if safe,
- increase heap only as mitigation,
- remove leak/retention,
- disable explicit GC if relevant,
- tune collector after root cause.

### 9.4 G1 Humongous Allocation Pressure

Symptoms:

- GC logs mention humongous regions/allocations,
- old gen pressure increases,
- concurrent cycles frequent,
- latency spikes during large payload/report operations.

Likely causes:

- large arrays,
- large strings,
- large JSON/XML body,
- file read all bytes,
- report generation in memory,
- base64 conversion,
- large PDF generation.

Evidence:

- JFR allocation sample,
- heap histogram top `byte[]`, `char[]`, `String`, JSON nodes,
- endpoint traces with large response/request,
- GC logs showing humongous allocation.

Fix direction:

- stream processing,
- pagination,
- chunking,
- avoid full in-memory aggregation,
- tune G1 region size only if appropriate,
- payload size limits.

### 9.5 Metaspace Pressure

Symptoms:

- GC cause `Metadata GC Threshold`,
- metaspace usage grows,
- class count grows,
- possible `OutOfMemoryError: Metaspace`.

Likely causes:

- classloader leak,
- dynamic proxy/code generation leak,
- repeated app reload,
- template/script engine generating classes,
- bytecode instrumentation issue.

Evidence:

- classloader count,
- heap dump classloader dominator,
- `jcmd VM.classloader_stats` if available,
- NMT metaspace category,
- deployment/redeploy history.

Fix direction:

- fix classloader lifecycle,
- cache generated classes properly,
- cap metaspace only with understanding,
- investigate agent/framework dynamic generation.

### 9.6 Direct Memory / Native Memory Pressure Mistaken as GC

Symptoms:

- heap looks fine,
- GC logs normal,
- container OOMKilled,
- RSS high,
- direct buffer usage high,
- `OutOfMemoryError: Direct buffer memory` or native OOM.

Likely causes:

- Netty/direct buffer leak,
- NIO buffers,
- mmap,
- compression/native library,
- too many threads,
- metaspace/code cache,
- large JFR/heap dump file memory map,
- container limit too tight.

Evidence:

- NMT,
- process RSS,
- direct buffer metrics,
- container memory metrics,
- `jcmd VM.native_memory summary`.

Fix direction:

- set `MaxDirectMemorySize` if needed,
- tune Netty allocator,
- reduce thread stack/count,
- increase container limit/headroom,
- investigate native leak.

### 9.7 CPU Throttling Makes GC Look Bad

Symptoms:

- GC pauses/concurrent phases take longer,
- CPU limit is low,
- Kubernetes throttling high,
- latency spikes under load,
- no obvious heap leak.

Interpretation:

GC needs CPU. If container is throttled, both application and GC progress slow down.

Evidence:

- cgroup CPU throttling metrics,
- pod CPU limit,
- GC concurrent phase duration,
- node saturation,
- profiler/JFR showing CPU starvation.

Fix direction:

- adjust CPU requests/limits,
- reduce allocation rate,
- scale horizontally,
- avoid too strict CPU limits for latency-sensitive JVM.

---

## 10. Collector-Specific Observability

## 10.1 G1 GC

G1 is common default in modern HotSpot.

Key concepts:

- heap divided into regions,
- young collections,
- mixed collections,
- concurrent marking,
- remembered sets,
- humongous regions,
- evacuation.

Important G1 signals:

| Signal | Meaning |
|---|---|
| Young GC frequency | Allocation pressure / young sizing |
| Mixed GC frequency | Old region reclamation |
| Concurrent mark duration | Old-gen/live-set pressure |
| Humongous regions | Large object pressure |
| Evacuation failure | Severe pressure/fragmentation |
| To-space exhausted | Not enough region space for evacuation |
| Remark/Cleanup pause | Marking lifecycle overhead |
| IHOP changes | Adaptive trigger for marking |

Useful logging:

```bash
-Xlog:gc*,gc+heap=debug,gc+age=trace,safepoint:file=gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

G1 diagnosis questions:

1. Is young GC too frequent?
2. Is old occupancy trending upward?
3. Are humongous allocations frequent?
4. Are mixed collections reclaiming enough?
5. Are there evacuation failures?
6. Is pause target unrealistic for workload/heap?
7. Is CPU throttling making concurrent work slow?

Common G1 tuning knobs:

```bash
-XX:MaxGCPauseMillis=200
-XX:InitiatingHeapOccupancyPercent=45
-XX:G1HeapRegionSize=16m
-XX:ParallelGCThreads=<n>
-XX:ConcGCThreads=<n>
```

Caution:

> G1 tuning should usually come after workload/object lifecycle analysis. Do not randomly lower `MaxGCPauseMillis` expecting magic latency reduction.

## 10.2 ZGC

ZGC is designed for scalable low-latency collection. It performs expensive work concurrently and aims to keep pauses very short.

Important ZGC signals:

| Signal | Meaning |
|---|---|
| Allocation stall | Heap/concurrent cycle cannot keep up |
| Concurrent cycle frequency | Allocation/live-set pressure |
| Relocation set | Amount of data being moved |
| Mark/relocate duration | Concurrent CPU/memory bandwidth cost |
| Uncommit behavior | Heap memory returned to OS |
| Soft max heap | Memory budget guidance |

Useful logging:

```bash
-Xlog:gc*,gc+heap=debug,gc+reloc=debug,gc+marking=debug:file=gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

ZGC diagnosis questions:

1. Are there allocation stalls?
2. Is heap too small for live set + allocation burst?
3. Is CPU sufficient for concurrent collection?
4. Is RSS expected under container limit?
5. Is application allocation rate too high?
6. Is Generational ZGC enabled/available for the JDK version and config?

For JDK 21+, Generational ZGC is an important default consideration for many low-latency workloads, but sizing/headroom still matters.

## 10.3 Parallel GC

Parallel GC prioritizes throughput over pause latency.

Good fit:

- batch jobs,
- throughput-heavy offline processing,
- latency-insensitive tasks.

Bad fit:

- low-latency APIs,
- user-facing interactive systems with strict p99.

Signals:

- long young/full pauses,
- high throughput when memory is healthy,
- full GC can be very disruptive.

## 10.4 Serial GC

Serial GC is simple and useful for tiny heaps/small CLI tools.

Generally not suitable for large production backend services.

## 10.5 Shenandoah Note

Shenandoah is another low-pause collector in some OpenJDK distributions. Its availability depends on JDK/distribution/vendor. If your runtime uses Shenandoah, apply the same evidence method: allocation, live set, pause, concurrent phase, CPU, and container headroom.

---

## 11. Java 8 vs Java 11+ GC Log Examples

### 11.1 Java 8 Style Example

Example shape:

```text
2026-06-18T10:15:23.123+0700: 12345.678: [GC (Allocation Failure)
[PSYoungGen: 328192K->23443K(382464K)]
328192K->23459K(1256448K), 0.0268406 secs]
[Times: user=0.04 sys=0.01, real=0.03 secs]
```

Read it as:

```text
Cause: Allocation Failure
Young before -> after: 328192K -> 23443K
Total heap before -> after: 328192K -> 23459K
Pause: 26.8 ms
CPU user/sys/real: 40 ms / 10 ms / 30 ms
```

Important:

- `Allocation Failure` for young GC is often normal.
- Look at frequency and duration, not one line.
- If after-heap grows over time, investigate retention.

### 11.2 Java 11+ Unified Logging Example Shape

Example shape:

```text
[2026-06-18T10:15:23.123+0700][12345.678s][info][gc,start] GC(42) Pause Young (Normal) (G1 Evacuation Pause)
[2026-06-18T10:15:23.145+0700][12345.700s][info][gc,heap ] GC(42) Eden regions: 512->0(480)
[2026-06-18T10:15:23.145+0700][12345.700s][info][gc,heap ] GC(42) Survivor regions: 20->24(64)
[2026-06-18T10:15:23.145+0700][12345.700s][info][gc,heap ] GC(42) Old regions: 100->105
[2026-06-18T10:15:23.145+0700][12345.700s][info][gc     ] GC(42) Pause Young (Normal) (G1 Evacuation Pause) 2500M->650M(4096M) 22.123ms
```

Read it as:

```text
GC id: 42
Type: Young pause
Collector behavior: G1 evacuation pause
Heap before -> after: 2500M -> 650M
Heap capacity: 4096M
Duration: 22.123ms
Old regions increased: objects promoted/survived
```

---

## 12. GC Diagnosis by Symptom

## 12.1 Symptom: Latency Spike

Do this:

1. Check trace p95/p99 and affected endpoints.
2. Check GC pause timeline.
3. Check safepoint logs.
4. Check CPU throttling.
5. Check DB/dependency latency.
6. Check thread pool queues.
7. Use JFR for allocation/socket/lock events.

Interpretation matrix:

| Evidence | Likely Meaning |
|---|---|
| Long GC pause aligns exactly with latency | GC likely direct cause |
| Latency rises before GC pressure | dependency/request pile-up may be root cause |
| GC concurrent phase long + CPU throttling | CPU limit/starvation |
| Heap stable, latency high | likely not GC |
| Allocation spike after new release | code change/object churn |

## 12.2 Symptom: High CPU

GC can consume CPU, but not all CPU spikes are GC.

Check:

- GC CPU time,
- concurrent GC phases,
- allocation rate,
- async-profiler CPU flame graph,
- JFR execution samples,
- logging/serialization hotspots.

If profiler shows application code dominates, GC is not primary.

## 12.3 Symptom: Throughput Drop

Possible GC-related reasons:

- too much time in GC,
- allocation stalls,
- CPU stolen by concurrent GC,
- full GC storm.

Non-GC reasons:

- DB pool exhaustion,
- thread pool saturation,
- rate limit,
- external API slowdown,
- lock contention.

## 12.4 Symptom: Container OOMKilled

Do not assume Java heap OOM.

Check:

```bash
kubectl describe pod <pod>
kubectl top pod <pod>
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_info
```

Compare:

```text
Xmx + metaspace + direct memory + thread stacks + code cache + native libs + JVM overhead <= container limit
```

If RSS exceeds limit while heap is below Xmx, investigate native/direct/metaspace/thread memory.

## 12.5 Symptom: Frequent Full GC

Ask:

1. What is the Full GC cause?
2. How much memory is reclaimed?
3. Is old gen after Full GC still high?
4. Is metaspace high?
5. Is explicit GC involved?
6. Did traffic/deployment change?
7. Is heap dump safe to capture?

---

## 13. GC and Application Design

GC issues often expose application design problems.

### 13.1 Logging Can Cause GC Pressure

Bad:

```java
log.debug("payload=" + expensiveJson(payload));
```

Even if DEBUG is disabled, `expensiveJson(payload)` can run before logger call depending on expression construction.

Better:

```java
log.debug("payloadId={} size={}", payload.id(), payload.size());
```

With SLF4J 2.x supplier/fluent style:

```java
log.atDebug()
   .setMessage("payload.summary")
   .addKeyValue("payload.id", payload::id)
   .addKeyValue("payload.size", payload::size)
   .log();
```

### 13.2 DTO Mapping Can Cause Allocation Pressure

Mapping layers are useful, but repeated full graph transformation can allocate heavily.

Watch for:

- entity -> DTO -> response DTO -> audit DTO -> event DTO,
- deep copy of large collections,
- temporary `Map<String,Object>` everywhere,
- JSON tree model instead of streaming model.

### 13.3 Batch Processing Can Inflate Live Set

Bad:

```java
List<Record> all = repository.findAllLargeDataset();
process(all);
```

Better:

```java
repository.streamByChunk(1000, chunk -> {
    process(chunk);
    chunk.clear();
});
```

### 13.4 Async Queues Can Hide Retention

A queue is also a retention root.

If consumers are slow, messages accumulate and retain payloads.

Observe:

- queue depth,
- consumer lag,
- memory usage,
- object histogram,
- message payload size.

### 13.5 Request Timeout Can Retain Object Graphs Longer

If downstream is slow, request objects live longer.

This can convert short-lived objects into old-gen survivors.

---

## 14. Correlating GC with OpenTelemetry

GC metrics alone are not enough. Correlate with request and business impact.

Useful correlation fields:

```text
service.name
service.instance.id
host.name
k8s.pod.name
deployment.environment
service.version
```

For incident investigation:

1. Find time range of latency/error spike.
2. Check affected service instances.
3. Overlay:
   - GC pause duration,
   - heap used,
   - allocation rate,
   - CPU throttling,
   - request latency,
   - DB latency,
   - queue depth,
   - error rate.
4. Drill into traces around high latency.
5. Use logs for specific state transitions/errors.
6. Use JFR/profiler for allocation and CPU attribution.

Example investigation question:

```text
Did GC pause happen before user-visible timeout, or did request backlog happen before GC pressure?
```

That ordering matters.

---

## 15. JFR for GC Diagnosis

JFR is especially useful because it connects GC events with allocation, thread, CPU, socket, and lock events.

Useful JFR views/events:

- Garbage Collection,
- GC Pause,
- Allocation in new TLAB,
- Allocation outside TLAB,
- Object Allocation Sample,
- Old Object Sample,
- Thread allocation statistics,
- Execution sample,
- Socket read/write,
- Java monitor blocked,
- Thread park,
- Native memory if enabled/available.

JFR questions:

1. Which classes allocate most?
2. Which threads allocate most?
3. Which endpoint/workflow aligns with allocation spike?
4. Is GC pause or socket wait causing latency?
5. Are locks causing object retention/request pile-up?
6. Is allocation outside TLAB frequent due to large objects?

Startup continuous recording example:

```bash
-XX:StartFlightRecording=name=continuous,settings=profile,disk=true,maxage=1h,maxsize=512m,path=/var/log/app/recording.jfr
```

On-demand dump:

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/incident.jfr
```

---

## 16. Heap Dump vs GC Log vs JFR vs Profiler

| Tool | Best For | Weakness |
|---|---|---|
| GC log | GC timeline and collector behavior | Weak attribution to application code |
| Metrics | Trend, alerting, dashboard | Aggregated, low detail |
| JFR | JVM event correlation | Needs interpretation and setup |
| Heap dump | Retained object graph | Heavy, sensitive, point-in-time |
| Class histogram | Quick top class count/size | No retention path |
| async-profiler alloc | Allocation hotspot | Not retained object graph |
| Thread dump | Blocking/pile-up | Not memory ownership |
| Trace | Request path latency | Sampling and instrumentation gaps |

Use the right tool for the question.

---

## 17. GC Tuning: Order of Operations

Do not tune first. Diagnose first.

Correct order:

```text
1. Define symptom and impact
2. Establish time window
3. Collect metrics + GC logs
4. Determine collector and JVM flags
5. Identify GC pattern
6. Correlate with app/dependency signals
7. Attribute allocation/retention if needed
8. Apply mitigation
9. Apply permanent fix
10. Validate under realistic load
```

### 17.1 Mitigation vs Permanent Fix

| Situation | Mitigation | Permanent Fix |
|---|---|---|
| Heap too small | Increase Xmx/container memory | Sizing model/load test |
| Allocation burst | Scale out/increase CPU | Reduce object churn |
| Memory leak | Restart/increase heap | Fix retention path |
| Humongous allocation | Increase heap/region size cautiously | Stream/chunk large payload |
| CPU throttling | Increase CPU limit/request | Capacity model + allocation reduction |
| Full GC storm | Restart/capture dump | Leak/live-set fix |
| Direct memory OOM | Increase container/direct cap | Fix buffer lifecycle |

---

## 18. Practical GC Troubleshooting Playbooks

## 18.1 Playbook: Latency Spike Suspected GC

1. Find impacted time window.
2. Get request p95/p99 and error spike.
3. Check GC pause timeline.
4. If long GC pause aligns with spike:
   - inspect GC cause,
   - inspect heap before/after,
   - inspect collector phase.
5. If no alignment:
   - check DB/dependency traces,
   - check thread pool,
   - check CPU throttling,
   - check logging storm.
6. Capture JFR around incident if reproducible.
7. Use profiler if CPU/allocation suspected.
8. Produce conclusion:
   - GC direct cause,
   - GC amplifier,
   - GC unrelated.

## 18.2 Playbook: OOM / Restart Loop

1. Check container termination reason.
2. Check JVM OOM logs.
3. Check heap vs RSS.
4. If Java heap OOM:
   - capture heap dump if configured,
   - inspect top dominators,
   - compare class histogram.
5. If container OOMKilled:
   - inspect RSS,
   - NMT,
   - direct buffer,
   - thread count,
   - metaspace.
6. Check recent deployment/traffic.
7. Mitigate with memory/headroom/restart.
8. Fix retention/native source.

## 18.3 Playbook: High GC CPU

1. Measure GC pause ratio and CPU usage.
2. Check allocation rate.
3. Run JFR or allocation profiler.
4. Identify top allocation sites.
5. Check if allocation is caused by:
   - serialization,
   - logging,
   - mapping,
   - retry storm,
   - batch size,
   - inefficient collection use.
6. Optimize code/workload.
7. Re-test under load.

## 18.4 Playbook: G1 Humongous Allocation

1. Enable/inspect G1 heap debug logs.
2. Find humongous allocation frequency.
3. Use JFR allocation outside TLAB/object sample.
4. Check large `byte[]`, `char[]`, `String`, JSON nodes.
5. Map to endpoint/job/report.
6. Add payload limits or streaming/chunking.
7. Consider G1 region tuning only after design fixes.

## 18.5 Playbook: ZGC Allocation Stall

1. Look for allocation stall events.
2. Check heap occupancy and live set.
3. Check allocation rate.
4. Check CPU throttling and concurrent phase duration.
5. Increase heap/headroom as mitigation.
6. Reduce allocation/live set as permanent fix.
7. Evaluate generational mode if applicable.

---

## 19. Alerting Strategy

Bad GC alerts:

```text
GC happened
Heap > 70%
One pause > 100ms
```

Better alerts:

```text
p99 GC pause over 5m > latency budget fraction
GC pause ratio over 5m > threshold
Old-gen after-GC occupancy increasing for N windows
Allocation rate doubled after deployment
Container RSS > 90% and heap < 70%
Full GC count increased and reclaimed memory < threshold
ZGC allocation stalls > 0
```

Alert should answer:

- Is user impact likely?
- Is action needed?
- Which runbook should be used?

---

## 20. Dashboard Design

A production GC dashboard should show:

### Service-level

- request rate,
- error rate,
- latency p50/p95/p99,
- instance count,
- deployment version.

### JVM memory

- heap used/committed/max,
- old/young if available,
- non-heap,
- metaspace,
- direct buffer,
- process RSS,
- container memory limit.

### GC

- pause duration percentile,
- pause count,
- pause ratio,
- collection cause/type,
- allocation rate,
- promotion rate,
- full GC count,
- concurrent cycle duration.

### Runtime saturation

- CPU usage,
- CPU throttling,
- thread count,
- blocked threads,
- DB pool active/pending,
- queue depth.

### Correlation

- deploy markers,
- traffic spikes,
- dependency latency,
- error bursts.

---

## 21. Production JVM Flag Templates

### 21.1 Java 17/21/25 G1 Service

```bash
-XX:+UseG1GC
-Xms2g
-Xmx2g
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

Optional container-aware sizing instead of fixed Xmx:

```bash
-XX:MaxRAMPercentage=70
-XX:InitialRAMPercentage=70
```

Use carefully with known container limit and native headroom.

### 21.2 Java 21/25 ZGC Low-Latency Service

```bash
-XX:+UseZGC
-Xms4g
-Xmx4g
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

Depending on JDK and desired behavior, evaluate generational ZGC options according to the runtime version.

### 21.3 Java 8 Legacy Service

```bash
-XX:+UseG1GC
-Xms2g
-Xmx2g
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-XX:+PrintGCApplicationStoppedTime
-Xloggc:/var/log/app/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=10
-XX:GCLogFileSize=100M
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

---

## 22. Common Anti-Patterns

### Anti-Pattern 1 — “GC Happened, Therefore GC Caused the Incident”

GC happens all the time. Correlation is not causation.

### Anti-Pattern 2 — Tuning Before Evidence

Changing GC flags without understanding allocation/live-set behavior can mask root cause.

### Anti-Pattern 3 — Only Watching Heap Percent

Heap percent alone is misleading. Need after-GC occupancy, allocation rate, pause, RSS, and container limit.

### Anti-Pattern 4 — Ignoring Native Memory

Modern Java services often use off-heap memory via networking, compression, TLS, direct buffers, agents, and native libraries.

### Anti-Pattern 5 — No GC Log Rotation

GC logs can fill disk and cause a different incident.

### Anti-Pattern 6 — Capturing Heap Dump Without Data Policy

Heap dumps can contain secrets, PII, tokens, request payloads, and business data.

### Anti-Pattern 7 — Overfitting to One Pod

One unhealthy pod may have different traffic, bad node, throttling, or stuck dependency.

### Anti-Pattern 8 — Ignoring Deployment Markers

Allocation behavior often changes after release.

---

## 23. Mini Case Study: “GC Pause” That Was Actually DB Pool Exhaustion

### Situation

Production service shows p99 latency spike from 400 ms to 12 seconds. Dashboard shows GC pause increase at the same time.

Initial conclusion from team:

```text
GC problem. Increase heap.
```

### Evidence

Metrics:

```text
HTTP p99: 12s
Error rate: timeout spike
GC pause p99: 180ms
Heap after GC: stable
DB pool pending threads: rising
DB active connections: maxed
DB query latency: rising
Old gen after GC: stable
CPU: moderate
```

Thread dump:

```text
many request threads waiting for Hikari connection
```

Traces:

```text
request spends 8-10s waiting before DB query executes
```

GC logs:

```text
frequent young GC, each 50-180ms, memory reclaimed successfully
```

### Correct Diagnosis

GC was an amplifier, not root cause.

Root cause:

```text
DB connection pool exhaustion due to slow query / DB lock.
```

Why GC increased:

```text
Requests lived longer while waiting for DB connection.
More request object graphs survived young GC.
Allocation pressure and survivor pressure increased.
```

### Fix

Mitigation:

- kill/block offending query,
- increase DB pool only if DB can handle it,
- shed load or reduce timeout,
- scale read path if safe.

Permanent fix:

- query/index fix,
- transaction boundary fix,
- pool sizing review,
- timeout budget,
- dashboard correlation between DB pool and GC.

Lesson:

> If GC pause is 180 ms but request latency is 12 seconds, GC is unlikely to be the primary explanation.

---

## 24. Practical Lab 1 — Build GC Evidence from Logs

Create a small Java service that allocates temporary objects:

```java
import java.util.*;

public class AllocationPressureDemo {
    public static void main(String[] args) throws Exception {
        List<byte[]> sink = new ArrayList<>();
        long i = 0;

        while (true) {
            byte[] data = new byte[1024 * 100]; // 100 KB

            if (i % 100 == 0) {
                sink.add(data); // retain some objects
            }

            if (sink.size() > 1000) {
                sink.subList(0, 500).clear();
            }

            i++;
            Thread.sleep(5);
        }
    }
}
```

Run with Java 17+:

```bash
java \
  -Xms256m -Xmx256m \
  -XX:+UseG1GC \
  -Xlog:gc*,gc+heap=debug,safepoint:file=gc.log:time,uptime,level,tags:filecount=5,filesize=20M \
  AllocationPressureDemo
```

Analyze:

1. How often young GC happens.
2. Whether old regions grow.
3. Whether after-GC heap trends upward.
4. Whether pause time increases with retained set.

---

## 25. Practical Lab 2 — Compare GC Log with JFR

Run:

```bash
java \
  -Xms512m -Xmx512m \
  -XX:+UseG1GC \
  -XX:StartFlightRecording=name=lab,settings=profile,disk=true,filename=lab.jfr \
  -Xlog:gc*:file=gc.log:time,uptime,level,tags \
  YourApp
```

In JDK Mission Control:

1. Open `lab.jfr`.
2. Check GC pause events.
3. Check allocation by class.
4. Check allocation by thread.
5. Compare with GC log timeline.

Questions:

- Which classes allocate most?
- Are large allocations outside TLAB?
- Does allocation spike align with specific operation?
- Does GC pause align with user latency?

---

## 26. Practical Lab 3 — Container Memory Headroom

Run JVM in a container with limited memory:

```bash
docker run --rm -m 512m openjdk:21 java \
  -XX:MaxRAMPercentage=80 \
  -Xlog:gc*:stdout:time,uptime,level,tags \
  -version
```

Reason about:

```text
Container memory = 512 MB
Max heap maybe around 80% = ~409 MB
Remaining memory = ~103 MB
Need to fit metaspace, code cache, thread stacks, direct memory, JVM native structures, libc, agents
```

Question:

> Is 80% safe for a real Spring Boot service with many threads, TLS, Netty/Tomcat, OpenTelemetry agent, and JFR?

Often, no. You need native headroom.

---

## 27. Review Checklist

Before calling an incident “GC problem”, verify:

- [ ] GC pause aligns with user impact.
- [ ] Pause duration can explain observed latency.
- [ ] Heap before/after suggests pressure pattern.
- [ ] After-GC old occupancy trend is known.
- [ ] Allocation rate is measured.
- [ ] RSS/container memory is checked.
- [ ] CPU throttling is checked.
- [ ] DB/dependency latency is checked.
- [ ] Thread pool and connection pool metrics are checked.
- [ ] JFR/profiler/heap evidence exists for allocation or retention.
- [ ] Healthy vs unhealthy instances are compared.
- [ ] Recent deployment/config/traffic change is known.
- [ ] Mitigation and permanent fix are separated.

---

## 28. Production Standard: GC Observability Requirements

Every serious Java service should have:

1. GC logging enabled with timestamps and rotation.
2. JVM metrics exported:
   - heap,
   - non-heap,
   - GC pause,
   - allocation if available,
   - direct buffer,
   - thread count,
   - process RSS.
3. JFR capture capability.
4. Heap dump policy with secure storage.
5. Native Memory Tracking option for selected services or incident mode.
6. Dashboards that correlate GC with:
   - request latency,
   - errors,
   - CPU,
   - DB pool,
   - dependency latency,
   - queue depth,
   - deployment markers.
7. Runbooks for:
   - latency spike,
   - OOM,
   - Full GC storm,
   - container OOMKilled,
   - allocation pressure,
   - native memory growth.
8. Clear data handling rules for `.hprof`, `.jfr`, and GC logs.

---

## 29. Key Takeaways

1. GC is not automatically the root cause of latency.
2. GC evidence must be correlated with request, dependency, CPU, container, and memory signals.
3. Allocation rate and live-set trend are more useful than heap percent alone.
4. Java 8 and Java 9+ use different GC logging systems.
5. G1 troubleshooting often centers on young GC frequency, old occupancy, humongous allocations, mixed GC, and evacuation failures.
6. ZGC troubleshooting often centers on allocation stalls, heap headroom, CPU for concurrent work, and live-set/allocation pressure.
7. Container OOMKilled often involves RSS/native memory, not just Java heap.
8. JFR is one of the best bridges between GC behavior and application behavior.
9. Heap dump answers retention; allocation profiler answers allocation; GC log answers collector behavior.
10. Top-tier troubleshooting separates mitigation from permanent fix.

---

## 30. What Comes Next

Next part:

# Part 28 — Database and External Dependency Troubleshooting with Logs, Metrics, Traces

We will move from JVM-internal behavior to external dependency behavior:

- JDBC instrumentation,
- HikariCP metrics,
- DB pool exhaustion,
- slow query evidence,
- transaction boundaries,
- lock wait/deadlock,
- HTTP client timeout taxonomy,
- retry/circuit breaker observability,
- dependency latency as memory/GC amplifier.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./26-heap-dump-and-memory-troubleshooting-leak-retention-allocation-native-memory.md">⬅️ Part 26 — Heap Dump and Memory Troubleshooting: Leak, Retention, Allocation, Native Memory</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./28-database-and-external-dependency-troubleshooting-with-logs-metrics-traces.md">Part 28 — Database and External Dependency Troubleshooting with Logs, Metrics, Traces ➡️</a>
</div>
