# learn-java-eclipse-glassfish-runtime-server-engineering-part-023  
# Part 23 — Memory, GC, Native Memory, Class Metadata, dan Leak Diagnosis

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 23 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **memory engineering dan leak diagnosis pada GlassFish**: heap, metaspace, classloader, direct memory, native memory, thread stack, GC logs, heap dump, classloader leak, session/cache bloat, dan safe production evidence collection

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. membedakan jenis memory di JVM/GlassFish:
   - Java heap;
   - metaspace;
   - code cache;
   - direct memory;
   - native memory;
   - thread stack;
   - memory-mapped file;
   - OS/container RSS;
2. membaca gejala memory issue berdasarkan error:
   - `Java heap space`;
   - `GC overhead limit exceeded`;
   - `Metaspace`;
   - `Direct buffer memory`;
   - `unable to create native thread`;
   - container `OOMKilled`;
3. memahami kenapa GlassFish application server rawan classloader leak saat redeploy;
4. memahami memory impact dari session, EJB stateful cache, CDI/JPA proxy, logging buffer, JMS backlog, dan resource adapter;
5. menggunakan GC log, heap dump, thread dump, class histogram, Native Memory Tracking, dan JFR secara tepat;
6. membuat playbook diagnosis memory leak produksi;
7. membedakan memory leak, memory bloat, memory pressure, dan legitimate high memory usage;
8. menyusun preventive checklist untuk aplikasi GlassFish enterprise;
9. membuat evidence collection yang aman dan tidak memperparah incident;
10. memahami perubahan perilaku Java 8 hingga Java 25 terkait memory/GC.

Part ini melanjutkan Part 22 tentang tuning. Jika Part 22 menjawab **bagaimana mengatur kapasitas**, Part 23 menjawab **bagaimana mendiagnosis ketika memory runtime tidak sehat**.

---

## 1. Mental Model: “Memory JVM” Bukan Hanya Heap

Kesalahan umum:

```text
Aplikasi pakai Java.
Memory issue berarti heap kurang.
Solusi: naikkan -Xmx.
```

Ini sering salah.

Dalam GlassFish/JVM, memory process terbagi:

```text
Process RSS / Container Memory
  |
  |-- Java Heap
  |     |-- young generation
  |     |-- old generation
  |     |-- humongous/large objects depending GC
  |
  |-- Metaspace
  |     |-- class metadata
  |     |-- generated proxy/enhancement classes
  |
  |-- Code Cache
  |     |-- JIT compiled code
  |
  |-- Thread Stacks
  |     |-- one stack per platform thread
  |
  |-- Direct / Native Buffers
  |     |-- NIO, Grizzly, DB drivers, compression, libraries
  |
  |-- GC Native Structures
  |
  |-- Memory-Mapped Files
  |
  |-- Native Libraries / malloc
  |
  |-- Agent/APM/JFR overhead
```

Container/OS melihat total process memory, bukan hanya heap.

Jadi:

```text
Heap used 2 GB
Container limit 4 GB
```

belum tentu aman jika native/metaspace/thread/direct menggunakan 2.5 GB.

---

## 2. GlassFish Memory Boundary

GlassFish process berisi:

```text
GlassFish server runtime
  |
  |-- Grizzly HTTP/network runtime
  |-- HK2 services
  |-- CDI/Weld runtime
  |-- EJB container
  |-- Servlet container
  |-- JPA provider/EclipseLink/Hibernate
  |-- JMS/OpenMQ integration
  |-- JCA/resource adapter
  |-- application classloaders
  |-- application objects
  |-- deployment generated artifacts
  |-- logging/monitoring/APM
```

Satu JVM sering menjalankan beberapa aplikasi/module.

Memory issue bisa berasal dari:

- GlassFish internal runtime;
- application code;
- third-party library;
- JPA provider;
- CDI proxy;
- session state;
- resource adapter;
- JDBC driver;
- JMS backlog;
- APM agent;
- repeated redeploy leak;
- logging configuration.

Top 1% engineer tidak langsung menuduh “GlassFish leak” atau “app leak”. Ia memisahkan boundary.

---

## 3. Jenis Masalah Memory

### 3.1 True Leak

Object tidak lagi dibutuhkan, tetapi masih reachable.

Contoh:

```text
static Map grows forever
ThreadLocal not cleared
listener not deregistered
classloader retained after redeploy
```

### 3.2 Bloat

Object memang reachable dan “valid”, tapi terlalu besar.

Contoh:

```text
HTTP session menyimpan object graph 20 MB/user
cache tidak bounded
report materializes 1 million rows in memory
```

### 3.3 Pressure

Memory cukup, tapi allocation rate tinggi sehingga GC sering.

Contoh:

```text
JSON/XML transformation allocates huge temporary objects
large string concatenation
per-request object churn
```

### 3.4 Fragmentation / Native Pressure

Heap terlihat normal, tetapi process memory tinggi.

Contoh:

```text
direct buffers
thread stacks
native library allocation
metaspace
code cache
mmap
```

### 3.5 Container Limit Mismatch

JVM merasa punya ruang, container membunuh proses.

```text
Heap + native + overhead > cgroup limit
```

Gejala:

```text
No Java OOME.
Pod/container suddenly OOMKilled.
```

---

## 4. Error Taxonomy

### 4.1 `OutOfMemoryError: Java heap space`

Heap tidak cukup untuk object Java.

Kemungkinan:

- heap leak;
- cache/session bloat;
- request terlalu besar;
- batch/report memory heavy;
- object churn lebih cepat dari GC;
- max heap terlalu kecil.

Evidence:

- heap dump;
- GC log;
- histogram;
- allocation profile.

---

### 4.2 `OutOfMemoryError: GC overhead limit exceeded`

GC menghabiskan terlalu banyak waktu dan reclaim sangat sedikit.

Kemungkinan:

- heap hampir penuh;
- live set terlalu besar;
- leak/bloat;
- heap terlalu kecil;
- allocation pressure ekstrem.

Solusi bukan selalu disable GC overhead limit. Cari kenapa heap tidak bisa turun.

---

### 4.3 `OutOfMemoryError: Metaspace`

Class metadata penuh.

Kemungkinan:

- terlalu banyak class;
- repeated redeploy classloader leak;
- generated classes/proxies meningkat;
- dynamic code generation;
- framework scanning/proxy;
- metaspace limit terlalu kecil.

Evidence:

- class count;
- metaspace usage;
- heap dump classloader analysis;
- jcmd VM.classloader_stats if available;
- compare before/after redeploy.

---

### 4.4 `OutOfMemoryError: Direct buffer memory`

Direct buffer memory habis.

Kemungkinan:

- NIO/direct buffer leak;
- large file/network IO;
- Grizzly/network buffer pressure;
- DB driver/direct buffer;
- library allocates direct memory;
- `MaxDirectMemorySize` terlalu kecil.

Evidence:

- Native Memory Tracking;
- JFR allocation/native events if available;
- direct buffer pool MBeans;
- code review for `ByteBuffer.allocateDirect`.

---

### 4.5 `OutOfMemoryError: unable to create native thread`

JVM gagal membuat thread baru.

Kemungkinan:

- terlalu banyak threads;
- thread leak;
- OS ulimit;
- container PID/thread limit;
- insufficient native memory for stacks;
- `-Xss` terlalu besar;
- many pools configured too high.

Evidence:

- thread dump;
- thread count trend;
- OS `ulimit -u`;
- `ps -eLf`;
- NMT thread memory;
- pool configs.

---

### 4.6 Container `OOMKilled`

Process dibunuh oleh container/OS.

Kemungkinan:

- total RSS melebihi limit;
- heap terlalu dekat container limit;
- native memory/direct/metaspace/thread overhead;
- no Java heap OOME because OS killed first.

Evidence:

- Kubernetes event;
- container memory metrics;
- JVM heap metrics;
- NMT if available;
- GC log stops abruptly;
- no heap dump maybe.

---

## 5. GC Logs: Evidence Pertama

GC log menjawab:

```text
Apakah heap penuh?
Apakah GC sering?
Apakah pause lama?
Apakah heap after GC terus naik?
Apakah full GC terjadi?
Apakah allocation rate tinggi?
```

Modern Java:

```bash
-Xlog:gc*,safepoint:file=/var/log/glassfish/gc.log:time,uptime,level,tags:filecount=10,filesize=50M
```

Java 8:

```bash
-Xloggc:/var/log/glassfish/gc.log
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=10
-XX:GCLogFileSize=50M
```

Yang dicari:

```text
heap after GC trend
old gen occupancy
promotion failure
humongous allocation
full GC frequency
pause duration
allocation rate
concurrent cycle frequency
to-space exhausted
```

---

## 6. Membaca Pola Heap dari GC Log

### 6.1 Healthy Sawtooth

```text
Heap naik
GC turun
Heap naik
GC turun
```

After-GC baseline stabil.

Ini normal.

---

### 6.2 Leak/Bloat Pattern

```text
After-GC heap baseline naik terus
```

Contoh:

```text
after GC:
1.2 GB
1.4 GB
1.7 GB
2.1 GB
2.6 GB
3.2 GB
```

Kemungkinan leak/bloat.

---

### 6.3 Allocation Pressure

```text
GC sangat sering
after-GC heap masih cukup turun
```

Kemungkinan object churn tinggi. Solusi mungkin mengurangi allocation, bukan menaikkan heap saja.

---

### 6.4 Full GC Repeated

```text
Full GC
Full GC
Full GC
little memory reclaimed
```

Indikasi serius:

- live set terlalu besar;
- leak;
- heap terlalu kecil;
- metaspace/class unloading issue depending logs.

---

## 7. Heap Dump

Heap dump adalah snapshot object Java heap.

Cara mengambil:

```bash
jcmd <pid> GC.heap_dump /path/to/heap.hprof
```

Atau:

```bash
jmap -dump:live,format=b,file=/path/to/heap.hprof <pid>
```

Catatan penting:

- heap dump bisa sangat besar;
- proses bisa pause;
- butuh disk space;
- berisi data sensitif;
- jangan ambil sembarangan di prod peak;
- lindungi file dump;
- hapus/archive sesuai policy.

---

## 8. Heap Dump Security

Heap dump bisa mengandung:

- password;
- token;
- session data;
- PII;
- request payload;
- DB result;
- JWT;
- private business data.

Treat heap dump as sensitive artifact.

Baseline:

```text
- simpan di secure directory
- chmod 600
- transfer terenkripsi
- akses terbatas
- jangan upload ke tool eksternal tanpa approval
- hapus setelah analisis sesuai policy
```

---

## 9. Heap Dump Analysis dengan MAT

Eclipse Memory Analyzer Tool/MAT berguna untuk:

- dominator tree;
- retained heap;
- leak suspects;
- histogram;
- paths to GC roots;
- classloader analysis;
- duplicate strings;
- collection size.

Concepts:

### 9.1 Shallow Heap

Memory object itu sendiri.

### 9.2 Retained Heap

Memory yang akan bebas jika object itu tidak reachable.

Retained heap lebih penting untuk leak diagnosis.

### 9.3 GC Root

Object yang menjadi akar reachability:

- thread stack;
- static fields;
- JNI references;
- system classloader;
- local variables;
- monitor/lock;
- JMX/static registries.

Leak diagnosis mencari:

```text
Why is this object still reachable?
```

---

## 10. Class Histogram

Class histogram lebih ringan dari full heap dump.

Command:

```bash
jcmd <pid> GC.class_histogram
```

Atau:

```bash
jmap -histo:live <pid>
```

Output:

```text
num     #instances         #bytes  class name
1:        2000000      160000000  java.lang.String
2:         500000       80000000  byte[]
...
```

Gunakan untuk:

- quick view object types;
- compare before/after load;
- detect obvious growth;
- avoid full dump if too risky.

Limitasi:

- tidak menunjukkan ownership/retained heap;
- tidak cukup untuk root cause;
- live histogram bisa trigger GC/pause.

---

## 11. Native Memory Tracking / NMT

NMT membantu melihat native memory kategori JVM.

Enable:

```bash
-XX:NativeMemoryTracking=summary
```

Atau lebih detail:

```bash
-XX:NativeMemoryTracking=detail
```

Perlu restart JVM.

Command:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
```

Kategori:

```text
Java Heap
Class
Thread
Code
GC
Compiler
Internal
Symbol
Native Memory Tracking
Arena Chunk
```

Gunakan saat:

- container RSS tinggi tapi heap normal;
- suspect thread stack;
- metaspace/class memory;
- direct/native allocation;
- GC native overhead.

Overhead NMT ada, terutama detail mode. Gunakan sesuai kebutuhan.

---

## 12. Thread Memory

Thread memory = jumlah thread × stack size + native overhead.

Jika:

```text
-Xss1m
1000 platform threads
```

stack budget bisa besar.

GlassFish bisa memiliki thread dari:

- HTTP pools;
- admin;
- EJB;
- JMS consumers;
- connector work manager;
- managed executor;
- timer service;
- application-created executors;
- DB driver threads;
- APM agent;
- logging async appenders.

Command:

```bash
jcmd <pid> Thread.print
jstack <pid>
ps -eLf | grep java | wc -l
```

Diagnose:

```text
thread count trend over time
thread names
pool configs
threads stuck waiting
unmanaged thread creation
```

---

## 13. Direct Buffer Memory

Direct buffers can be inspected via BufferPoolMXBean.

Tools:

```text
JConsole / JMX
jcmd VM.native_memory
JFR
```

Metrics:

```text
java.nio:type=BufferPool,name=direct
  Count
  MemoryUsed
  TotalCapacity
```

Common sources:

- NIO/network;
- Grizzly;
- file channels;
- DB drivers;
- compression/encryption;
- libraries using Netty/ByteBuffer;
- manual `ByteBuffer.allocateDirect`.

Symptoms:

```text
heap fine
RSS high
Direct buffer OOME
network/file heavy workload
```

---

## 14. Metaspace dan Classloader

Metaspace stores class metadata. In GlassFish, classloaders are central.

Each deployed app/module may have classloader(s):

```text
server classloader
  |
  |-- application classloader
      |
      |-- web module classloader
      |-- EJB module classloader
```

On undeploy/redeploy, old app classloader should become unreachable. If something still references it, all its classes and static fields remain.

This is **classloader leak**.

---

## 15. Classloader Leak: Why GlassFish Apps Are Vulnerable

Application servers support redeploy. That means:

```text
App v1 classloader
  deploy
  serve traffic
  undeploy
  should be GC'ed

App v2 classloader
  deploy
```

Leak if:

```text
Server/static/global object -> references App v1 class/object/thread
```

Then:

```text
App v1 classloader retained
  -> classes retained
  -> static fields retained
  -> caches retained
  -> metaspace retained
  -> heap retained
```

Repeated redeploy:

```text
v1 retained
v2 retained
v3 retained
...
Metaspace OOME
```

---

## 16. Common Classloader Leak Sources

### 16.1 Static Fields

```java
public static final Map<String, Object> CACHE = new ConcurrentHashMap<>();
```

If cache references app objects and classloader is retained, leak persists.

Static fields alone are not always leak if classloader unloads. The issue is external root retains classloader or static object.

---

### 16.2 ThreadLocal

```java
private static final ThreadLocal<MyContext> CTX = new ThreadLocal<>();
```

If not cleared on container threads:

```text
GlassFish thread -> ThreadLocalMap -> app object -> app classloader
```

Always clear:

```java
try {
    CTX.set(value);
    ...
} finally {
    CTX.remove();
}
```

---

### 16.3 Unmanaged Threads

```java
new Thread(() -> ...).start();
```

If thread continues after undeploy:

```text
Thread context classloader -> app classloader
```

Use managed executor and shutdown resources.

---

### 16.4 JDBC Driver Registration

Old JDBC drivers registered with `DriverManager` can retain classloader if not deregistered.

Modern containers often handle drivers, but apps bundling drivers can cause leaks.

Prefer server-managed JDBC drivers/resources.

---

### 16.5 Logging Framework

Logback/Log4j async appenders, shutdown hooks, or static logger context can retain classloader if not stopped.

Ensure logging framework lifecycle is compatible with app server.

---

### 16.6 Timer/Executor/Scheduler

```text
ScheduledExecutorService
Timer
Quartz scheduler
custom worker
```

If not shutdown, leaks thread/classloader.

---

### 16.7 MBeans Not Unregistered

Application registers MBean but doesn't unregister on undeploy.

```text
MBeanServer -> app MBean -> app classloader
```

---

### 16.8 Shutdown Hooks

App registers shutdown hook:

```java
Runtime.getRuntime().addShutdownHook(...)
```

In app server, this is dangerous. Hook can retain app classloader until JVM exit.

---

### 16.9 Third-Party Library Caches

Examples:

- Introspector caches;
- XML parsers;
- BeanUtils;
- scripting engines;
- serialization frameworks;
- reflection metadata caches;
- JPA provider caches if mis-scoped.

---

## 17. Detecting Classloader Leak

Signals:

```text
metaspace grows after every redeploy
class count increases after redeploy
old app version classes remain in heap dump
threads named from old app remain
MBeans from old app remain
static caches from old version remain
```

Commands:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> VM.classloader_stats
jcmd <pid> Thread.print
```

Heap dump analysis:

```text
Search for old application class names.
Find path to GC root.
Look for WebappClassLoader/ApplicationClassLoader retained.
```

---

## 18. Session Memory Bloat

HTTP session can destroy heap.

Bad:

```java
session.setAttribute("caseSearchResult", listOf10000Cases);
session.setAttribute("fullUserProfile", hugeObjectGraph);
session.setAttribute("uploadedFileBytes", fileBytes);
```

Problems:

- per-user memory multiplies;
- session replication multiplies across cluster;
- serialization overhead;
- stale data;
- logout/session expiry delayed;
- OOME during traffic spike.

Estimate:

```text
session size 2 MB
active sessions 2,000

heap required ≈ 4 GB just for sessions
```

Best practices:

- keep session small;
- store IDs, not full objects;
- use paging;
- avoid file bytes in session;
- clear after use;
- set sane timeout;
- externalize session only with full understanding.

---

## 19. Stateful EJB Cache / Passivation

Stateful session beans can retain state.

Risks:

- large conversational state;
- passivation serialization cost;
- cache memory pressure;
- stale sessions;
- failover replication overhead;
- serialization errors.

Monitor:

```text
stateful cache size
passivation count
activation count
memory usage
session count
```

Design:

```text
Prefer stateless services for scalable web workloads.
Keep state small if stateful required.
```

---

## 20. Cache Memory

Application caches are common memory sources.

Questions:

```text
Is cache bounded?
What is max size?
What is TTL?
What is eviction policy?
Is value object large?
Is key cardinality bounded?
Is cache per instance or cluster-wide?
Can stale data cause security/business issue?
```

Bad:

```java
Map<String, Object> cache = new ConcurrentHashMap<>();
```

Better:

```text
bounded cache with max size + TTL + metrics
```

Monitor:

```text
cache size
hit rate
eviction count
load time
memory estimate
```

---

## 21. JMS Backlog and Memory

JMS backlog can cause memory pressure:

- messages in broker memory;
- messages delivered but unacked;
- consumer prefetch;
- large payload;
- redelivery loops;
- MDB transaction rollback retaining work.

GlassFish app memory can be affected if:

- consumer loads many messages into memory;
- batches too large;
- message payload parsed into huge object graph;
- failed messages retried with retained state.

---

## 22. Large Request / Response Memory

Sources:

- file upload;
- multipart parsing;
- large JSON/XML body;
- SOAP envelope;
- report export;
- PDF generation;
- Excel generation;
- base64 content;
- buffering response.

Anti-pattern:

```text
read entire input stream into byte[]
build entire report in memory
serialize huge list at once
```

Better:

- stream input;
- set upload limits;
- use temp file carefully;
- paginate;
- async export;
- stream response;
- compress carefully;
- bound payload size.

---

## 23. XML/JSON Object Graph Bloat

Enterprise GlassFish apps often process XML/SOAP.

DOM parsing loads whole document.

```text
XML size 50 MB
DOM memory can be many times larger
```

Use streaming parser when possible:

- StAX;
- SAX;
- streaming JSON parser;
- chunk processing.

Avoid logging full payload.

---

## 24. JPA Persistence Context Memory

JPA can retain many entities in persistence context.

Bad batch:

```java
for (...) {
    em.persist(entity);
}
```

without flush/clear.

Memory grows because persistence context tracks all managed entities.

Better:

```java
for (int i = 0; i < items.size(); i++) {
    em.persist(items.get(i));
    if (i % 1000 == 0) {
        em.flush();
        em.clear();
    }
}
```

But batch size depends workload and transaction design.

Also watch:

- eager fetch huge graph;
- N+1 causing many objects;
- second-level cache;
- query result materialization;
- unbounded list.

---

## 25. Logging Memory Pressure

Logging can consume memory via:

- async appender queue;
- huge message strings;
- exception stack traces;
- buffering;
- MDC values too large;
- logging full payloads;
- duplicate appenders.

If central logging unavailable, async queues can grow or block.

Configure:

- bounded queue;
- drop/block policy known;
- no huge payload;
- rotation;
- backpressure.

---

## 26. APM / Agent Memory

Agents can add:

- bytecode instrumentation;
- metadata caches;
- trace buffers;
- span queues;
- network buffers;
- thread pools;
- native memory.

Symptoms:

```text
memory higher after agent enabled
metaspace increase
CPU allocation increase
class count increase
```

Always load-test with agent enabled if production uses it.

---

## 27. GlassFish Redeploy Strategy

Hot redeploy is useful but risky for long-lived production JVMs if apps/libraries leak classloaders.

Production options:

```text
Option A: hot redeploy
  faster, but classloader leak risk

Option B: rolling instance restart with new deployment
  slower, cleaner memory

Option C: immutable container image
  new pod/process per release
  clean runtime state
```

For regulated/high-availability systems, rolling restart/immutable deployment is often safer.

---

## 28. Production Evidence Collection

When memory incident occurs, collect in this order if possible:

```text
1. timestamp and symptom
2. container/OS memory metrics
3. JVM heap/metaspace/thread metrics
4. GC log
5. jcmd VM.native_memory summary if enabled
6. class histogram
7. thread dump
8. heap dump if needed and safe
9. application logs around growth
10. recent deployment/config changes
```

Do not immediately restart without evidence unless service restoration requires it. If restart is needed, collect at least lightweight evidence first if safe.

---

## 29. Safe Commands

Find PID:

```bash
jcmd
ps -ef | grep glassfish
```

Thread dump:

```bash
jcmd <pid> Thread.print > thread-$(date +%Y%m%d-%H%M%S).txt
```

Class histogram:

```bash
jcmd <pid> GC.class_histogram > histo-$(date +%Y%m%d-%H%M%S).txt
```

Heap dump:

```bash
jcmd <pid> GC.heap_dump /secure/heap-$(date +%Y%m%d-%H%M%S).hprof
```

Native memory:

```bash
jcmd <pid> VM.native_memory summary > nmt-$(date +%Y%m%d-%H%M%S).txt
```

JVM flags:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
```

Caution:

- `VM.system_properties` can expose sensitive values;
- heap dump can expose sensitive values;
- commands may pause process;
- ensure disk space.

---

## 30. Heap Dump Timing

Best moments:

```text
near high memory before OOME
after suspected leak growth
after load test steady state
before and after redeploy
before restart if safe
```

Compare dumps:

```text
baseline dump
after load dump
after GC dump
after redeploy dump
```

One dump can show large objects. Two dumps show growth.

---

## 31. When Not to Take Heap Dump

Avoid or delay if:

```text
disk nearly full
service is at extreme peak and dump pause would cause bigger outage
heap contains highly sensitive data and no secure handling path
dump would violate policy
process is already being killed repeatedly
```

Alternative:

- class histogram;
- GC log;
- JFR;
- NMT summary;
- metrics;
- restart with flags for next occurrence.

---

## 32. JFR for Memory Diagnosis

Java Flight Recorder can capture:

- allocation hotspots;
- GC events;
- object allocation in new TLAB/outside TLAB;
- thread activity;
- lock contention;
- socket/file IO;
- exceptions;
- method profiling.

Start recording:

```bash
jcmd <pid> JFR.start name=memdiag settings=profile duration=5m filename=/secure/memdiag.jfr
```

Or dump running recording:

```bash
jcmd <pid> JFR.dump name=memdiag filename=/secure/memdiag.jfr
```

Benefits:

- lower overhead than many profilers;
- temporal evidence;
- useful for allocation pressure.

---

## 33. Allocation Rate vs Retained Heap

Important distinction:

```text
High allocation rate:
  many temporary objects created and collected

High retained heap:
  objects stay reachable
```

Allocation pressure causes frequent GC, but not necessarily leak.

Heap dump shows retained objects at one time. JFR allocation profile shows allocation hot paths over time.

Use both when needed.

---

## 34. Memory Leak Playbook

Symptom:

```text
Heap after GC increases over hours/days.
Eventually OOME.
```

Steps:

```text
1. Confirm with GC log/metrics.
2. Check recent deployment/config/traffic changes.
3. Capture class histogram at low/high memory.
4. Capture heap dump if safe.
5. Analyze dominator tree.
6. Identify largest retained objects.
7. Find path to GC root.
8. Map root to subsystem:
   - session
   - cache
   - ThreadLocal
   - static field
   - classloader
   - JPA context
   - JMS
   - third-party lib
9. Reproduce in load/soak test.
10. Fix, retest, compare after-GC baseline.
```

---

## 35. Metaspace/Classloader Leak Playbook

Symptom:

```text
Metaspace grows after each redeploy.
Class count increases.
Old app version remains.
```

Steps:

```text
1. Record metaspace before deploy.
2. Deploy/redeploy.
3. Force safe GC in test environment if needed.
4. Record metaspace/class count.
5. Run VM.classloader_stats.
6. Capture heap dump.
7. Search old app classloader/classes.
8. Find GC root.
9. Check ThreadLocal, unmanaged threads, MBeans, JDBC drivers, logging, shutdown hooks.
10. Fix lifecycle cleanup or change deployment strategy.
```

Production mitigation:

```text
rolling restart instead of repeated hot redeploy
```

---

## 36. Direct Memory Playbook

Symptom:

```text
Direct buffer memory OOME or RSS high while heap normal.
```

Steps:

```text
1. Check direct BufferPoolMXBean.
2. Check MaxDirectMemorySize.
3. Check NMT summary/detail.
4. Check workload: upload/download/network/file.
5. Check libraries using direct buffers.
6. Check Grizzly/network buffer pressure.
7. Check for unreleased buffers.
8. Test with bounded direct memory and JFR.
9. Fix leak or adjust direct memory budget.
```

---

## 37. Native Thread Playbook

Symptom:

```text
unable to create native thread
```

Steps:

```text
1. Count JVM threads.
2. Capture thread dump.
3. Group threads by name/pool.
4. Check GlassFish pool configs.
5. Check app-created executors.
6. Check JMS/connector/adapter threads.
7. Check OS user process/thread limits.
8. Check container PID limit.
9. Check -Xss size.
10. Reduce leaks/pools or increase native budget/limits.
```

---

## 38. Container OOMKilled Playbook

Symptom:

```text
Kubernetes reports OOMKilled.
No Java OOME.
```

Steps:

```text
1. Check container memory limit.
2. Check max RSS before kill.
3. Check JVM heap max.
4. Check heap used before kill.
5. Check non-heap/metaspace/direct/thread metrics.
6. Check NMT if enabled.
7. Check pod events.
8. Check recent traffic/deployment.
9. Reduce Xmx or increase container limit.
10. Budget native memory explicitly.
```

Formula:

```text
container limit >
  Xmx
  + metaspace
  + direct memory
  + thread stacks
  + code cache
  + GC/native overhead
  + agent/logging overhead
  + safety margin
```

---

## 39. Java 8 to 25 Memory Considerations

### Java 8

- Metaspace replaces PermGen;
- older GC logging flags;
- container awareness less robust in older updates;
- many Java EE legacy apps;
- classloader leaks common in hot redeploy.

### Java 11

- unified logging;
- G1 default;
- improved container awareness;
- removed some bundled Java EE modules;
- stronger TLS/security defaults.

### Java 17

- mature G1/ZGC;
- strong encapsulation can affect old libs;
- JFR available and useful;
- good enterprise baseline.

### Java 21

- generational ZGC available;
- virtual threads exist, but platform threads still matter in app server internals;
- better diagnostics;
- common modern baseline for GlassFish 8.

### Java 25

- validate with server/dependencies;
- older agents/adapters may break;
- diagnostic tooling improves, but compatibility must be tested;
- don't assume old GC tuning flags still valid.

---

## 40. Preventive Coding Guidelines

```text
- Keep HTTP session small.
- Use bounded caches.
- Clear ThreadLocal.
- Use managed executor, not raw thread.
- Close resources.
- Avoid holding JPA persistence context across huge batches.
- Use streaming for large files/XML/JSON.
- Do not store large payloads in memory unnecessarily.
- Avoid shutdown hooks in web apps.
- Unregister MBeans/listeners.
- Stop schedulers/logging contexts on undeploy.
- Avoid bundling duplicate server API jars.
- Load test with realistic data.
```

---

## 41. Preventive Runtime Guidelines

```text
- Enable GC logs with rotation.
- Monitor heap after GC.
- Monitor metaspace.
- Monitor thread count.
- Monitor direct buffer pool.
- Monitor container RSS.
- Keep heap below container limit with native headroom.
- Prefer rolling restart/immutable deployment for prod.
- Avoid repeated hot redeploy in long-lived JVM if leaks suspected.
- Set max pool sizes intentionally.
- Monitor sessions/cache sizes.
```

---

## 42. Memory Dashboard

Minimum panels:

```text
1. Heap used/max
2. Heap after GC
3. GC pause p95/p99
4. GC count/time by collector
5. Metaspace used
6. Class loaded count
7. Thread count
8. Direct buffer memory
9. Container RSS / memory limit
10. CPU + GC CPU if available
11. Old gen occupancy if available
12. Pod/process restart/OOMKilled
```

Add app panels:

```text
session count
cache size
JMS backlog
batch in-memory queue size
upload/export activity
```

---

## 43. Memory Incident Report Template

```text
Incident:
  Memory growth / OOME / OOMKilled

Timeline:
  first detection
  growth pattern
  user impact
  mitigation time

Runtime:
  GlassFish version
  JDK version
  heap settings
  container/host memory
  GC type
  app version

Evidence:
  GC log
  heap metrics
  NMT
  histogram
  heap dump
  thread dump
  recent deploy/config change

Root cause:
  object/path to GC root
  subsystem responsible
  why not reclaimed

Fix:
  code/config/runtime change

Prevention:
  monitor/alert
  test
  code review rule
  deployment strategy
```

---

## 44. Example Diagnosis: Session Bloat

Symptom:

```text
Heap grows during business hours.
Drops after session timeout at night.
GC after-GC baseline correlates with active session count.
```

Evidence:

```text
heap dump dominator:
  StandardSession / session map retains large ArrayList<CaseDto>
```

Root cause:

```text
Search results stored in session for pagination.
Each user stores thousands of DTOs.
```

Fix:

```text
Store query criteria and page cursor, not full results.
Use DB pagination/cache with bounded size.
Reduce session timeout if business allows.
```

---

## 45. Example Diagnosis: ThreadLocal Leak

Symptom:

```text
Heap contains old user/security context objects.
Thread dump shows HTTP worker threads.
Path to GC root:
  Thread -> ThreadLocalMap -> AppContext -> app classloader
```

Root cause:

```text
Correlation/security context stored in ThreadLocal but not cleared on exception path.
```

Fix:

```java
try {
    Context.set(value);
    chain.doFilter(req, res);
} finally {
    Context.clear();
}
```

---

## 46. Example Diagnosis: Metaspace Leak After Redeploy

Symptom:

```text
Metaspace increases after every redeploy.
Old app classes visible in heap dump.
```

Path:

```text
MBeanServer -> custom MBean -> app class -> app classloader
```

Root cause:

```text
Application registers MBean on startup but does not unregister on shutdown.
```

Fix:

```text
Unregister MBean in @PreDestroy / ServletContextListener contextDestroyed.
```

Mitigation:

```text
rolling JVM restart after deployment until fix shipped
```

---

## 47. Example Diagnosis: Direct Buffer OOME

Symptom:

```text
Heap 50% used.
RSS near container limit.
OOME: Direct buffer memory.
```

Evidence:

```text
BufferPoolMXBean direct memory high.
NMT shows Internal/NIO high.
Upload endpoint active.
```

Root cause:

```text
Large file upload path allocates direct buffers and retains them until request completion.
Concurrent uploads exceed direct memory budget.
```

Fix:

```text
Limit upload size/concurrency.
Stream to temp storage.
Set MaxDirectMemorySize with headroom.
Tune Grizzly/upload config.
```

---

## 48. Top 1% Takeaways

1. **JVM memory is not just heap.**
2. **Container OOMKilled can happen with heap looking normal.**
3. **Heap after GC trend is more important than raw heap used.**
4. **Classloader leak is a key application server failure mode.**
5. **ThreadLocal, unmanaged threads, MBeans, JDBC drivers, and logging frameworks commonly retain app classloaders.**
6. **Heap dump is powerful but sensitive and operationally heavy.**
7. **Class histogram and GC log are lightweight first evidence.**
8. **Direct/native memory needs NMT/JMX/OS metrics, not heap dump alone.**
9. **Session/cache bloat is not always a leak, but can be equally fatal.**
10. **Memory diagnosis must identify the GC root/path, not just the largest class.**

---

## 49. Mini Exercise

Diagnose this scenario:

```text
GlassFish 8 on Java 21.
Container limit: 6 GB.
-Xmx: 5 GB.
After deployment, app runs fine for 2 hours.
Then pod is OOMKilled.
No Java heap OOME.
Heap used before kill: 3.2 GB.
Thread count: 900.
Metaspace: 600 MB.
Direct buffer: 700 MB.
```

Answer:

1. Why can pod be OOMKilled if heap is only 3.2 GB?
2. What memory categories must be added?
3. What evidence do you collect next?
4. Which config is suspicious?
5. How would you adjust Xmx/container budget?
6. How do you investigate 900 threads?
7. What dashboard alerts should have caught this earlier?

---

## 50. Referensi

Referensi utama:

- Eclipse GlassFish Performance Tuning Guide, Release 8  
  https://glassfish.org/docs/latest/performance-tuning-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Java `jcmd` Tool Documentation  
  https://docs.oracle.com/en/java/javase/

- Java Garbage Collection Documentation  
  https://docs.oracle.com/en/java/javase/

- Java Flight Recorder / JDK Mission Control Documentation  
  https://docs.oracle.com/javacomponents/jmc-5-5/jfr-runtime-guide/about.htm

- Eclipse Memory Analyzer Tool  
  https://eclipse.dev/mat/

---

## 51. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 24 — Troubleshooting Runtime Failures: Thread Dump, Heap Dump, Stuck Request, Deadlock, Timeout
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-022.md">⬅️ Part 22 — Performance Tuning: JVM, GC, Thread, Pool, HTTP, DB, dan Deployment</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-024.md">Part 24 — Troubleshooting Runtime Failures: Thread Dump, Heap Dump, Stuck Request, Deadlock, Timeout ➡️</a>
</div>
