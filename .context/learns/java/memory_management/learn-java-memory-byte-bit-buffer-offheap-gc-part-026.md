# learn-java-memory-byte-bit-buffer-offheap-gc-part-026.md

# Part 026 — Heap Dump Analysis and Leak Investigation

> Seri: **Java Memory Management, Byte & Bit, Buffer, Off-Heap, dan Garbage Collection**  
> Range versi: **Java 8 sampai Java 25**  
> Fokus bagian ini: **menganalisis heap dump, memahami shallow size/retained size/dominator tree/GC roots, menemukan leak, dan memvalidasi perbaikannya secara production-safe.**

---

## 0. Posisi Bagian Ini dalam Seri

Di bagian sebelumnya kita sudah membahas:

- bagaimana object dialokasikan;
- bagaimana object hidup, mati, dan dipromosikan;
- bagaimana reference graph menentukan reachability;
- bagaimana GC melakukan tracing;
- bagaimana G1, ZGC, dan Shenandoah bekerja;
- bagaimana membaca GC/log/observability signal.

Bagian ini menjawab pertanyaan praktis:

> “Heap saya membesar. GC makin sering. Old generation tidak turun. Apa yang sebenarnya menahan memory?”

Heap dump adalah snapshot object graph pada satu titik waktu. Ia bukan sekadar file besar berisi object. Ia adalah bukti struktural tentang:

- class apa yang memakai memory;
- object mana yang menahan object lain;
- reference path apa yang membuat object tetap reachable;
- bagian graph mana yang menjadi dominator;
- apakah object besar benar-benar leak atau memang live state valid;
- apakah masalah ada di heap, atau justru di native/off-heap/RSS.

Mental model penting:

```text
GC log menjawab: “kapan GC terjadi dan berapa efeknya?”
Metrics menjawab: “trend memory seperti apa?”
Heap dump menjawab: “siapa yang menahan memory?”
Thread dump menjawab: “siapa yang sedang melakukan apa?”
JFR menjawab: “peristiwa runtime apa yang terjadi sepanjang waktu?”
```

Heap dump paling kuat jika digunakan sebagai bagian dari investigasi, bukan sebagai langkah pertama yang membabi buta.

---

## 1. Apa Itu Heap Dump?

Heap dump adalah representasi snapshot dari object-object yang berada di Java heap pada saat dump dibuat.

Secara praktis, heap dump dapat berisi:

- object instance;
- class metadata tertentu yang diperlukan untuk interpretasi dump;
- primitive array;
- object array;
- field values;
- reference antar-object;
- GC roots;
- thread-related roots;
- classloader-related roots;
- static fields;
- JNI/local/global roots;
- informasi shallow size dan graph yang bisa dihitung analyzer.

Format umum yang sering ditemui adalah **HPROF binary heap dump**.

Yang perlu ditekankan:

> Heap dump tidak selalu merepresentasikan seluruh memory process. Heap dump merepresentasikan Java heap, bukan seluruh RSS.

Jadi, heap dump tidak cukup untuk masalah seperti:

- direct buffer leak;
- JNI/native allocation leak;
- metaspace growth;
- thread stack explosion;
- code cache pressure;
- malloc fragmentation;
- page cache/mmap effect;
- container RSS meningkat tetapi Java heap stabil.

Untuk kasus itu, gunakan Native Memory Tracking, OS tools, cgroup metrics, dan JFR/native diagnostics. Itu akan dibahas lebih kuat di part 027.

---

## 2. Kapan Heap Dump Berguna?

Heap dump berguna saat indikasi masalah berada di **Java heap object graph**.

Contoh signal yang cocok:

```text
Old generation setelah full/concurrent GC terus naik.
Live set meningkat antar-waktu.
GC makin sering tetapi heap tidak kembali turun.
Allocation rate normal tetapi retained heap naik.
OutOfMemoryError: Java heap space.
Cache/map/list tumbuh tidak terkendali.
Jumlah object class tertentu naik terus.
```

Heap dump kurang cocok sebagai alat utama jika signal-nya:

```text
RSS naik tetapi heap used stabil.
Pod OOMKilled tanpa Java heap OOM.
Direct buffer memory error.
Metaspace OOM.
Unable to create native thread.
Memory mapped file pressure.
JNI malloc leak.
```

Untuk kasus tersebut, heap dump masih bisa memberi petunjuk tidak langsung, misalnya banyak `DirectByteBuffer` wrapper di heap, tetapi root cause memory-nya berada di native memory.

---

## 3. Leak vs High Memory Usage: Jangan Salah Diagnosis

Tidak semua heap besar adalah leak.

### 3.1 Leak

Leak berarti object yang seharusnya tidak lagi diperlukan masih reachable dari GC roots.

Contoh:

```java
static final Map<String, byte[]> CACHE = new ConcurrentHashMap<>();

void handle(String requestId, byte[] payload) {
    CACHE.put(requestId, payload); // tidak ada eviction
}
```

Jika `requestId` terus unik, map tumbuh terus. GC tidak bisa membersihkan karena map static masih reachable.

### 3.2 High Live Set yang Valid

Heap besar bisa valid jika sistem memang sedang menahan state aktif.

Contoh:

- in-memory cache dengan size limit valid;
- batch job memuat working set besar;
- index/search structure;
- session store;
- precomputed lookup table;
- queue internal dengan backlog nyata;
- file parsed into object graph karena requirement bisnis.

Ini bukan leak, tetapi tetap bisa menjadi masalah sizing/design.

### 3.3 Temporary Allocation Pressure

Heap juga bisa terlihat sibuk karena allocation rate tinggi, tetapi object cepat mati.

Contoh:

```text
Eden naik cepat → young GC sering → old gen stabil
```

Ini biasanya bukan leak. Solusinya mungkin mengurangi allocation churn, bukan heap dump analysis mendalam.

### 3.4 Retained Garbage

Retained garbage adalah object yang secara teknis reachable, tetapi secara domain sudah tidak diperlukan.

Contoh:

```text
Completed workflow retained in active map
Closed session retained by ThreadLocal
Old tenant config retained after reload
Listener retained after module undeploy
```

Retained garbage adalah bentuk leak yang paling sering di production, karena GC tidak punya pengetahuan domain.

---

## 4. Konsep Kunci Heap Dump Analysis

Heap dump analysis tidak bisa efektif tanpa memahami beberapa istilah.

---

## 4.1 Shallow Size

**Shallow size** adalah ukuran memory object itu sendiri, tanpa object lain yang direferensikan.

Contoh konseptual:

```java
class User {
    String id;
    String name;
    byte[] avatar;
}
```

Shallow size `User` hanya mencakup:

- object header;
- reference field `id`;
- reference field `name`;
- reference field `avatar`;
- padding/alignment.

Shallow size tidak mencakup isi `String` dan `byte[]`.

Mental model:

```text
Shallow size = ukuran node.
Bukan ukuran subgraph.
```

Kesalahan umum:

> “Object ini shallow size-nya kecil, berarti tidak penting.”

Salah. Object kecil bisa menjadi root dominator yang menahan jutaan object lain.

---

## 4.2 Retained Size

**Retained size** adalah jumlah memory yang akan bisa dibebaskan jika object tersebut tidak lagi reachable, termasuk object lain yang hanya dapat dicapai melalui object itu.

Mental model:

```text
Retained size = ukuran subgraph yang dikuasai object.
```

Contoh:

```java
class Cache {
    Map<String, byte[]> entries;
}
```

`Cache` shallow size kecil, tetapi retained size bisa puluhan GB jika ia satu-satunya jalur menuju seluruh entries.

Retained size adalah salah satu konsep paling penting dalam leak analysis.

Namun retained size harus dibaca hati-hati:

- jika object juga direferensikan dari tempat lain, retained size-nya bisa lebih kecil dari dugaan;
- shared object tidak otomatis dihitung penuh ke satu owner;
- retained size bergantung pada graph dominator;
- unreachable object bisa muncul tergantung timing dump dan opsi analyzer.

---

## 4.3 GC Roots

GC roots adalah titik awal tracing reachability oleh GC/analyzer.

Contoh umum GC roots:

- thread stack local variables;
- active thread object;
- static fields;
- class objects;
- classloader;
- JNI global references;
- JNI local references;
- monitor/lock-related references;
- system classloader/application classloader;
- JVM internal references.

Object dianggap live jika dapat dicapai dari GC roots melalui rantai reference.

Mental model:

```text
Object live bukan karena “dipakai secara bisnis”.
Object live karena ada path dari GC root.
```

Leak investigation berarti mencari path yang tidak seharusnya ada.

---

## 4.4 Path to GC Root

**Path to GC Root** menunjukkan rantai reference dari object tertentu kembali ke GC root.

Contoh hasil konseptual:

```text
byte[10485760]
  <- value field of LargePayload
  <- payload field of RequestContext
  <- value of ThreadLocalMap.Entry
  <- threadLocals of Thread "http-nio-8080-exec-42"
  <- GC Root: Java Thread
```

Interpretasi:

```text
Payload besar masih hidup karena ThreadLocal pada worker thread masih menahannya.
```

Ini jauh lebih actionable daripada sekadar tahu bahwa ada banyak `byte[]`.

---

## 4.5 Dominator Tree

Dalam object graph, object A mendominasi object B jika semua path dari GC roots ke B harus melewati A.

Jika A hilang, B menjadi unreachable.

Dominator tree mengubah graph reference kompleks menjadi tree yang memudahkan analisis “siapa menahan memory terbesar”.

Mental model:

```text
Object graph = jaringan reference rumit.
Dominator tree = struktur kepemilikan efektif berdasarkan reachability.
```

Dominator tree membantu menemukan:

- cache besar;
- map/list dominan;
- classloader leak;
- session registry;
- executor queue;
- ThreadLocal retention;
- framework context yang menahan graph besar;
- object aggregator yang tidak pernah dilepas.

Namun dominator bukan selalu “bug”. Ia hanya menjawab “siapa yang menguasai memory”. Keputusan bug/valid harus memakai konteks domain.

---

## 4.6 Class Histogram

Class histogram menunjukkan jumlah instance dan total shallow bytes per class.

Contoh konseptual:

```text
 num     #instances         #bytes  class name
------------------------------------------------
   1       2,100,000    850,000,000  byte[]
   2       1,800,000    280,000,000  java.lang.String
   3         900,000    115,200,000  java.util.HashMap$Node
   4         600,000     67,200,000  com.example.RequestContext
```

Class histogram bagus untuk:

- quick triage;
- melihat class dominan;
- membandingkan dua snapshot;
- melihat jumlah instance abnormal;
- melihat object churn bila diambil berkala.

Tapi histogram terbatas karena hanya shallow aggregation.

Jika `byte[]` tinggi, belum tentu bug di `byte[]`. Bisa jadi ditahan oleh:

- `String`;
- JSON payload;
- cache;
- image/document blob;
- serialized form;
- direct buffer wrapper;
- compression buffer;
- DB result materialization.

Pertanyaan lanjutannya harus:

```text
byte[] ini milik siapa?
Path to root-nya apa?
Dominator-nya apa?
```

---

## 5. Cara Mengambil Heap Dump

Ada beberapa cara. Untuk Java modern, preferensi umum adalah `jcmd`.

Oracle documentation merekomendasikan `jcmd` sebagai utility diagnostik modern dibanding tool lama seperti `jmap`, walaupun `jmap` masih sering dipakai di Java 8 dan legacy environment.

---

## 5.1 Menggunakan `jcmd` — Java Modern

Cari PID:

```bash
jcmd
```

Contoh output:

```text
12345 com.example.Application
67890 jdk.jcmd/sun.tools.jcmd.JCmd
```

Ambil class histogram:

```bash
jcmd 12345 GC.class_histogram
```

Ambil heap dump:

```bash
jcmd 12345 GC.heap_dump filename=/tmp/app-heap-001.hprof
```

Pada beberapa versi/sintaks, bentuk berikut juga umum:

```bash
jcmd 12345 GC.heap_dump /tmp/app-heap-001.hprof
```

Selalu cek command tersedia:

```bash
jcmd 12345 help GC.heap_dump
jcmd 12345 help GC.class_histogram
```

Karena diagnostic command dapat memiliki opsi yang berbeda antar versi/vendor.

---

## 5.2 Menggunakan `jmap` — Java 8/Legacy

Class histogram:

```bash
jmap -histo <pid>
```

Live histogram:

```bash
jmap -histo:live <pid>
```

Heap dump:

```bash
jmap -dump:format=b,file=/tmp/app.hprof <pid>
```

Live heap dump:

```bash
jmap -dump:live,format=b,file=/tmp/app-live.hprof <pid>
```

Catatan penting:

```text
live dump biasanya memicu full GC terlebih dahulu.
Itu dapat mengganggu latency dan mengubah kondisi sebelum dump.
```

Gunakan `live` jika memang ingin melihat object reachable setelah GC. Jangan gunakan di production latency-sensitive tanpa memahami dampaknya.

---

## 5.3 Automatic Dump on OOM

Flag umum:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdumps
```

Contoh:

```bash
java \
  -Xms2g \
  -Xmx2g \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/var/log/app/heapdumps \
  -jar app.jar
```

Kelebihan:

- dump diambil saat failure aktual;
- tidak perlu operator manual;
- bukti sangat dekat dengan root cause.

Risiko:

- file sangat besar;
- disk penuh;
- mengandung PII/secret;
- proses sudah dalam kondisi kritis;
- dump mungkin gagal jika disk tidak cukup;
- dump di container ephemeral bisa hilang jika tidak dipersist.

Production checklist:

```text
Pastikan path writable.
Pastikan disk cukup.
Pastikan ada retention policy.
Pastikan dump tidak masuk log shipping sembarangan.
Pastikan akses dump dibatasi.
Pastikan data sensitif ditangani sesuai policy.
```

---

## 5.4 Heap Dump di Kubernetes

Contoh pendekatan umum:

```bash
kubectl exec -it <pod> -- jcmd 1 GC.heap_dump filename=/tmp/app.hprof
kubectl cp <namespace>/<pod>:/tmp/app.hprof ./app.hprof
```

Jika container tidak punya full JDK tools:

- gunakan image yang menyertakan JDK tools untuk environment tertentu;
- gunakan ephemeral debug container jika policy mengizinkan;
- expose diagnostic endpoint internal yang aman;
- gunakan sidecar/debug workflow;
- enable OOM heap dump ke mounted volume.

Hindari mengandalkan container minimal JRE jika production operability membutuhkan `jcmd`, `jfr`, atau diagnostics.

---

## 6. Production-Safe Heap Dump Strategy

Heap dump bukan operasi gratis.

Efek potensial:

- stop-the-world atau pause signifikan tergantung command/collector/version;
- CPU spike;
- disk I/O besar;
- memory pressure tambahan;
- latency spike;
- file dump sangat besar;
- data sensitif terekspos;
- risiko node/pod makin tidak stabil.

Strategi aman:

### 6.1 Jangan Ambil Dump Tanpa Signal

Sebelum heap dump, ambil signal ringan:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_info
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jcmd <pid> Thread.print
```

Lihat metrics:

```text
heap used after GC
old gen used after GC
allocation rate
promotion rate
GC pause
GC frequency
RSS
container memory usage
thread count
class count
```

### 6.2 Ambil Dua atau Tiga Snapshot Jika Bisa

Satu heap dump memberi snapshot. Leak adalah trend.

Lebih kuat:

```text
T0: baseline dump saat memory normal
T1: dump saat memory mulai naik
T2: dump saat dekat failure
```

Bandingkan:

- class count delta;
- retained size delta;
- dominator delta;
- path-to-root yang sama berulang;
- cache/key growth;
- queue backlog.

### 6.3 Jangan Dump Langsung di Peak Traffic Jika Bisa

Jika ada replica:

```text
remove instance from load balancer
wait in-flight request selesai
ambil heap dump
restart/return if needed
```

Namun hati-hati: jika leak hanya terjadi saat traffic aktif, drain terlalu lama bisa mengubah bukti. Pilih trade-off berdasarkan severity.

### 6.4 Enkripsi dan Kontrol Akses

Heap dump bisa berisi:

- token;
- password;
- session ID;
- authorization header;
- PII;
- payload request;
- business confidential data;
- database result;
- cryptographic material;
- raw document content.

Perlakukan heap dump seperti production database extract.

Aturan minimal:

```text
Do not upload to public tools.
Do not attach casually to ticket.
Restrict access.
Encrypt at rest.
Delete after investigation.
Redact if sharing externally.
Follow security/privacy policy.
```

---

## 7. Workflow Analisis Heap Dump dengan MAT

Eclipse Memory Analyzer Tool, sering disebut MAT, adalah tool populer untuk menganalisis heap dump besar.

Workflow umum:

```text
1. Open heap dump.
2. Run leak suspects report.
3. Inspect dominator tree.
4. Sort by retained heap.
5. Inspect top dominators.
6. Follow outgoing references.
7. Follow path to GC roots.
8. Check class histogram.
9. Group by package/classloader/thread.
10. Validate with domain knowledge.
11. Compare with second dump if available.
```

---

## 8. Step-by-Step Investigation Framework

Gunakan framework berikut agar investigasi tidak acak.

---

## Step 1 — Tentukan Jenis Memory Problem

Pertanyaan pertama:

```text
Apakah masalahnya Java heap atau process/native memory?
```

Signal Java heap problem:

```text
Heap used after GC naik.
Old gen naik.
Java heap OOM.
GC log menunjukkan live set naik.
Heap dump besar karena object graph.
```

Signal native/off-heap problem:

```text
RSS naik tetapi heap stabil.
Direct buffer OOM.
Metaspace OOM.
Thread count naik.
Pod OOMKilled tanpa Java OOM.
NMT menunjukkan NIO/Internal/Thread/GC naik.
```

Jika bukan heap problem, jangan buang waktu terlalu lama di heap dump.

---

## Step 2 — Ambil Class Histogram

Sebelum full heap dump, gunakan histogram.

```bash
jcmd <pid> GC.class_histogram > histo-001.txt
```

Beberapa menit kemudian:

```bash
jcmd <pid> GC.class_histogram > histo-002.txt
```

Bandingkan:

```text
Class apa yang jumlahnya naik?
Class apa yang bytes-nya naik?
Apakah byte[]/String/HashMap$Node naik?
Apakah domain object tertentu naik?
Apakah queue/list/map node naik?
```

Contoh indikasi:

```text
java.util.HashMap$Node naik → map tumbuh.
java.util.concurrent.ConcurrentHashMap$Node naik → concurrent map/cache registry tumbuh.
byte[] naik → payload/binary/string/serialization buffer.
java.lang.String naik → text IDs/log payload/JSON/metadata.
Object[] naik → array-backed collection.
CompletableFuture naik → async chain retained.
ThreadLocalMap$Entry naik → ThreadLocal leak possibility.
```

Histogram tidak membuktikan root cause, tapi mengarahkan pertanyaan.

---

## Step 3 — Ambil Heap Dump

Gunakan:

```bash
jcmd <pid> GC.heap_dump filename=/safe/path/app-001.hprof
```

Untuk OOM otomatis:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/safe/path
```

Simpan metadata bersamaan:

```text
timestamp
service name
version/build sha
environment
pod/node
JDK version
JVM flags
heap size
GC collector
traffic level
recent deployment/change
symptom observed
```

Tanpa metadata, heap dump sering sulit dikaitkan dengan kejadian.

---

## Step 4 — Buka Leak Suspects Report

MAT leak suspects berguna sebagai triage awal.

Namun jangan langsung percaya 100%.

Leak suspects bisa salah jika:

- cache besar memang expected;
- batch job memang memegang working set;
- heap dump diambil saat request besar sedang aktif;
- object besar baru saja dialokasikan dan belum sempat GC;
- dump non-live berisi object yang sebenarnya collectible;
- analyzer salah menginterpretasi ownership domain.

Gunakan report sebagai “suspect generator”, bukan verdict.

---

## Step 5 — Inspect Dominator Tree

Urutkan berdasarkan retained heap.

Pertanyaan:

```text
Top dominator-nya apa?
Apakah class domain sendiri?
Apakah collection/framework object?
Apakah classloader?
Apakah thread?
Apakah cache manager?
Apakah queue?
Apakah byte array besar?
```

Jika top dominator adalah collection:

```text
Lihat size collection.
Lihat key type.
Lihat value type.
Lihat owner field.
Lihat path to GC root.
```

Jika top dominator adalah classloader:

```text
Mungkin classloader leak.
Lihat static fields.
Lihat thread context classloader.
Lihat executor thread.
Lihat JDBC driver/timer/listener/global registry.
```

Jika top dominator adalah thread:

```text
Lihat ThreadLocal.
Lihat stack local variable.
Lihat in-flight request.
Lihat executor queue.
```

---

## Step 6 — Path to GC Roots

Untuk object yang dicurigai, cari path to GC roots.

Gunakan opsi exclude weak/soft references jika perlu, supaya path yang muncul adalah strong path yang benar-benar menahan object.

Pola umum path:

### Static Map Leak

```text
com.example.UserSession
 <- value of ConcurrentHashMap$Node
 <- table of ConcurrentHashMap
 <- sessions field of SessionRegistry
 <- static field INSTANCE of GlobalRegistry
 <- GC Root: System Class
```

Interpretasi:

```text
Session object ditahan static singleton registry.
```

### ThreadLocal Leak

```text
byte[]
 <- payload field of RequestContext
 <- value of ThreadLocalMap$Entry
 <- table of ThreadLocalMap
 <- threadLocals of Thread
 <- GC Root: Java Thread
```

Interpretasi:

```text
RequestContext tidak di-remove dari ThreadLocal.
```

### Executor Queue Retention

```text
LargeCommand
 <- callable field of FutureTask
 <- item of LinkedBlockingQueue$Node
 <- workQueue of ThreadPoolExecutor
 <- executor field of Service
 <- Spring bean singleton
 <- GC Root
```

Interpretasi:

```text
Task backlog menahan payload besar.
```

### ClassLoader Leak

```text
com.oldapp.SomeClass
 <- static field cache
 <- Class object
 <- classes of WebAppClassLoader
 <- contextClassLoader of Thread
 <- GC Root: Java Thread
```

Interpretasi:

```text
Old classloader masih ditahan thread/static/global reference.
```

### Listener Leak

```text
FeatureViewModel
 <- listener field
 <- elementData of ArrayList
 <- listeners field of EventBus
 <- static field GLOBAL_EVENT_BUS
 <- GC Root
```

Interpretasi:

```text
Listener tidak di-unregister.
```

---

## Step 7 — Validate dengan Domain Semantics

Heap dump hanya tahu reference, bukan business lifecycle.

Pertanyaan domain:

```text
Object ini seharusnya hidup berapa lama?
Siapa owner lifecycle-nya?
Kapan release/evict/remove harus terjadi?
Apakah key-nya bounded?
Apakah collection punya TTL/size limit?
Apakah ada tenant/user/request yang sudah selesai?
Apakah backlog valid atau stuck?
Apakah ini hasil deploy/reload?
```

Leak valid jika:

```text
Object masih reachable padahal lifecycle domain-nya sudah selesai.
```

---

## Step 8 — Bandingkan Snapshot

Jika punya dua dump, cari delta.

Yang perlu dibandingkan:

- instance count per class;
- retained heap per dominator;
- top maps/lists/queues;
- key cardinality;
- classloader count;
- thread count;
- String/byte[] growth;
- domain aggregate growth.

Contoh:

```text
Dump T0: SessionRegistry retains 300 MB, 50k sessions
Dump T1: SessionRegistry retains 900 MB, 150k sessions
Traffic normal, session TTL 30 menit, active users 20k
```

Kesimpulan sementara:

```text
Registry tidak menghapus expired sessions atau cleanup tidak berjalan.
```

---

## Step 9 — Reproduce Secara Lokal/Lower Environment

Heap dump production menunjukkan bukti. Reproduction menunjukkan sebab.

Strategi:

- buat load kecil yang mensimulasikan lifecycle;
- ambil heap histogram periodik;
- jalankan test berkali-kali;
- cek object count setelah forced GC di test/lab;
- gunakan MAT untuk dump kecil;
- tambahkan instrumentation sementara;
- gunakan unit/integration test untuk lifecycle cleanup.

Contoh pseudo-test:

```java
@Test
void requestContextMustNotBeRetainedAfterRequest() throws Exception {
    for (int i = 0; i < 10_000; i++) {
        service.handle(new Request("id-" + i, largePayload()));
    }

    forceGcInTestOnly();

    assertThat(registry.activeContexts()).isLessThan(100);
}
```

Jangan mengandalkan `System.gc()` sebagai mekanisme production. Di test, ia bisa dipakai secara hati-hati untuk validasi indikatif.

---

## 9. Pola Leak Umum di Java Production

---

## 9.1 Static Collection Leak

```java
public final class GlobalStore {
    private static final Map<String, Object> STORE = new ConcurrentHashMap<>();

    public static void put(String key, Object value) {
        STORE.put(key, value);
    }
}
```

Masalah:

- key unbounded;
- no TTL;
- no eviction;
- static lifetime sama dengan aplikasi;
- value bisa menahan graph besar.

Heap dump signal:

```text
ConcurrentHashMap dominates large retained heap.
Path to root via static field.
Key cardinality tinggi.
```

Solusi:

- explicit lifecycle;
- TTL;
- max size;
- eviction policy;
- weak/soft reference hanya jika benar-benar paham konsekuensi;
- metrics cache size;
- cleanup on domain event.

---

## 9.2 Cache Tanpa Bound

Anti-pattern:

```java
Map<Query, Result> cache = new ConcurrentHashMap<>();
```

Jika `Query` mengandung timestamp/user-specific filter, cardinality bisa tidak terbatas.

Perbaikan:

- gunakan cache library dengan maximum size/weight;
- TTL/expire-after-access;
- weight berdasarkan byte/domain cost;
- normalize key;
- reject high-cardinality key;
- expose metrics hit/miss/size/eviction.

Heap dump clue:

```text
Cache implementation dominates heap.
Keys terlihat unik dan terus bertambah.
Value menahan DTO/list/string/byte[].
```

---

## 9.3 ThreadLocal Leak

Anti-pattern:

```java
private static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();

void handle(Request request) {
    CTX.set(new RequestContext(request));
    process(request);
    // lupa remove
}
```

Worker thread di pool hidup lama. Jika value tidak dihapus, context request lama bisa tertahan.

Perbaikan:

```java
void handle(Request request) {
    CTX.set(new RequestContext(request));
    try {
        process(request);
    } finally {
        CTX.remove();
    }
}
```

Heap dump clue:

```text
Thread -> threadLocals -> ThreadLocalMap.Entry -> value -> RequestContext
```

Catatan:

- ThreadLocal key bisa weak, tetapi value tetap bisa tertahan sampai map dibersihkan;
- framework MDC/logging context juga sering jadi sumber retention jika tidak clear;
- virtual thread mengubah beberapa trade-off, tetapi tidak menghapus kewajiban lifecycle yang benar.

---

## 9.4 Listener / Subscriber Leak

Anti-pattern:

```java
class ScreenController {
    ScreenController(EventBus bus) {
        bus.register(this);
    }
}
```

Jika tidak unregister, event bus menahan subscriber.

Heap dump clue:

```text
EventBus -> listeners collection -> subscriber -> large object graph
```

Perbaikan:

- unregister on close/destroy;
- lifecycle ownership jelas;
- weak listener jika cocok;
- scope event bus per module/request jika memungkinkan;
- test lifecycle.

---

## 9.5 Executor Queue Retention

Anti-pattern:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);

void submit(LargeRequest req) {
    executor.submit(() -> process(req));
}
```

`Executors.newFixedThreadPool` menggunakan unbounded queue. Jika producer lebih cepat dari consumer, queue tumbuh dan task menahan payload.

Heap dump clue:

```text
ThreadPoolExecutor -> workQueue -> FutureTask -> lambda/callable -> LargeRequest
```

Perbaikan:

- bounded queue;
- rejection policy;
- backpressure;
- reduce captured object;
- persist task reference compact, bukan payload besar;
- monitoring queue depth.

---

## 9.6 CompletableFuture Chain Retention

Anti-pattern:

```java
CompletableFuture<Result> f = callRemote(req)
    .thenApply(r -> enrich(r, req))
    .thenApply(r -> transform(r, largeContext));
```

Lambda capture bisa menahan `req` atau `largeContext` lebih lama dari yang disadari.

Heap dump clue:

```text
CompletableFuture -> completion stack -> lambda -> captured field -> large context
```

Perbaikan:

- capture only needed fields;
- avoid capturing whole request/context;
- clear references after completion;
- bounded async pipeline;
- timeouts/cancellation;
- inspect incomplete futures.

---

## 9.7 ClassLoader Leak

Umum di app server/plugin system/hot reload.

Penyebab:

- static fields;
- non-daemon threads created by app;
- ThreadLocal from old classloader;
- JDBC driver not deregistered;
- logging framework/global registry;
- timer tasks;
- shutdown hooks;
- MBean registration;
- service loader/global singleton.

Heap dump clue:

```text
Multiple old WebAppClassLoader instances retained.
Old application classes still reachable.
Path via Thread.contextClassLoader/static registry/MBean/JDBC driver.
```

Perbaikan:

- shutdown lifecycle proper;
- stop threads;
- clear ThreadLocal;
- deregister drivers/MBeans/listeners;
- avoid static caches across redeploy boundary;
- prefer process restart for clean deployment if system design allows.

---

## 9.8 ORM / Persistence Context Retention

Anti-pattern:

```text
Long transaction/session loads many entities.
Persistence context keeps all managed entities.
Batch job never clears EntityManager/Session.
```

Heap dump clue:

```text
EntityManager/Session -> persistence context -> entity entries -> domain objects
```

Perbaikan:

- process in pages;
- flush/clear periodically;
- stream carefully;
- avoid loading huge graph;
- use projection DTO for read-heavy path;
- avoid first-level cache growth in batch.

---

## 9.9 Result Materialization Leak

Anti-pattern:

```java
List<RowDto> all = repository.findAllHugeData();
return all.stream().map(...).toList();
```

Masalah:

- seluruh result set dimaterialisasi;
- DTO/string/array graph besar;
- response buffering besar;
- temporary object jadi middle-lived karena pipeline lama.

Heap dump clue:

```text
ArrayList/Object[] -> many DTO -> String/byte[]
```

Perbaikan:

- pagination;
- streaming with bounds;
- cursor-based processing;
- chunked write;
- backpressure;
- avoid storing all rows.

---

## 9.10 Logging / Audit Payload Retention

Sistem enterprise sering menahan payload besar via log/audit context.

Anti-pattern:

```java
MDC.put("payload", requestBody);
```

atau:

```java
AuditContext.current().setSerializedRequest(largeJson);
```

Jika MDC/ThreadLocal tidak clear, payload tertahan.

Heap dump clue:

```text
ThreadLocalMap -> MDC map -> String/byte[] large payload
```

Perbaikan:

- jangan taruh payload besar di MDC;
- clear MDC in finally;
- store correlation ID, bukan full payload;
- cap audit payload size;
- stream audit to durable sink;
- redact sensitive fields.

---

## 9.11 DirectByteBuffer Wrapper Retention

Direct memory berada di native memory, tetapi wrapper `DirectByteBuffer` berada di heap.

Heap dump clue:

```text
java.nio.DirectByteBuffer instances retained
Path via pool/cache/list/thread local
```

Interpretasi:

- heap dump menunjukkan wrapper;
- native memory bisa jauh lebih besar;
- cek `capacity` buffer;
- cek NMT/NIO category;
- cek pooling/release lifecycle.

Perbaikan:

- explicit buffer ownership;
- release/return to pool;
- avoid unbounded pool;
- cap direct memory;
- monitor direct buffer count/capacity;
- prefer FFM Arena for explicit lifetime when appropriate.

---

## 10. Membaca Hasil MAT dengan Disiplin

---

## 10.1 Jangan Terjebak Top Class

Jika top class adalah `byte[]`, `char[]`, atau `String`, itu normal.

Pertanyaan yang benar:

```text
Siapa owner byte[] ini?
Apakah byte[] ini milik String, payload, cache, buffer, image, document, serialization?
Path to root apa?
Dominator siapa?
```

---

## 10.2 Jangan Terjebak Shallow Size

Collection object shallow size kecil. Tetapi backing array/node/value bisa besar.

Contoh:

```text
ConcurrentHashMap shallow kecil
retained heap besar
```

Fokus pada retained heap dan outgoing references.

---

## 10.3 Jangan Menganggap Semua Static Field Salah

Static field valid untuk:

- singleton stateless service;
- immutable lookup table;
- constants;
- bounded registry;
- class metadata.

Static field bermasalah jika:

- menahan mutable unbounded state;
- lifecycle-nya lebih panjang dari data;
- tidak punya cleanup;
- key cardinality tidak terbatas.

---

## 10.4 Jangan Menganggap Weak/Soft Reference Selalu Aman

Weak/soft reference bisa membantu pola tertentu, tetapi bukan pengganti lifecycle design.

Masalah:

- SoftReference clearing policy bergantung memory pressure;
- cache berbasis SoftReference sering unpredictable;
- WeakHashMap key behavior sering disalahpahami;
- value bisa menahan key secara tidak langsung;
- ReferenceQueue perlu diproses jika punya cleanup logic.

---

## 10.5 Jangan Abaikan In-Flight Request

Heap dump bisa diambil ketika request besar sedang diproses.

Path mungkin:

```text
Thread stack -> local variable -> request payload
```

Itu belum tentu leak. Cek:

- apakah thread sedang aktif;
- apakah request stuck;
- apakah banyak thread menahan payload serupa;
- apakah dump diambil saat traffic spike;
- apakah object tetap ada di dump berikutnya.

---

## 11. Pattern: Dari Symptom ke Root Cause

---

## 11.1 Symptom: Old Gen Naik Perlahan

Kemungkinan:

- cache unbounded;
- session leak;
- static registry;
- classloader leak;
- long-lived queue;
- ThreadLocal retention;
- listener leak.

Investigation:

```text
1. Lihat old gen after GC trend.
2. Ambil histogram T0/T1.
3. Cari class count naik.
4. Ambil heap dump.
5. Dominator tree.
6. Path to GC root.
7. Validasi lifecycle.
```

---

## 11.2 Symptom: Heap OOM Tiba-Tiba

Kemungkinan:

- request sangat besar;
- batch materialization;
- query tanpa limit;
- response buffering;
- file upload/download buffering;
- accidental `readAllBytes()`;
- data explosion due to join/cardinality.

Investigation:

```text
1. OOM heap dump.
2. Top retained dominator.
3. Thread stack/thread dump near OOM jika ada.
4. Cari giant array/list/map.
5. Cari request/job identifier.
6. Validasi input size dan query size.
```

---

## 11.3 Symptom: Frequent Full GC

Kemungkinan:

- old gen nearly full;
- humongous allocation pressure;
- promotion failure;
- heap undersized;
- live set terlalu besar;
- leak;
- fragmentation collector-specific.

Investigation:

```text
1. GC log dulu.
2. Cek live set after GC.
3. Cek allocation/promotion rate.
4. Heap dump jika live set naik/tidak wajar.
5. Dominator retained heap.
```

---

## 11.4 Symptom: RSS Naik, Heap Stabil

Kemungkinan:

- direct buffer;
- mmap;
- native allocation;
- thread stack;
- metaspace;
- code cache;
- malloc fragmentation;
- GC native structure;
- page cache/cgroup accounting.

Heap dump role:

```text
Cari wrapper/reference Java yang menahan native resource.
Contoh: DirectByteBuffer, MemorySegment owner, mapped buffer owner.
```

Tetapi root investigation harus lanjut ke NMT/OS/container. Ini part 027.

---

## 12. Heap Dump dan Java 8–25: Perbedaan Praktis

---

## 12.1 Java 8

Umum:

- `jmap` masih sering dipakai;
- CMS/Parallel/G1 environment legacy;
- PermGen sudah tidak ada sejak Java 8, diganti Metaspace;
- GC logging format lama;
- banyak app server/classloader leak legacy;
- `jhat` historically ada tetapi tidak direkomendasikan untuk dump besar modern.

Praktik:

```bash
jmap -histo <pid>
jmap -dump:format=b,file=app.hprof <pid>
```

---

## 12.2 Java 9+

- module system memperkenalkan `jdk.jcmd` module;
- unified logging mulai menggantikan format lama;
- G1 menjadi default untuk server configuration sejak Java 9;
- `jcmd` semakin menjadi tool utama.

---

## 12.3 Java 11/17/21 LTS

Umum di production modern.

Praktik:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump filename=app.hprof
jcmd <pid> JFR.start ...
```

Dengan JFR, memory investigation bisa dikombinasikan dengan allocation profiling dan old object sampling.

---

## 12.4 Java 22–25

Relevansi:

- FFM API finalized di Java 22;
- off-heap object lifecycle bisa lebih explicit via Arena/MemorySegment;
- ZGC generational menjadi default lalu non-generational mode dihapus;
- Shenandoah generational product feature di Java 25;
- Unsafe memory access makin diarahkan untuk migration.

Heap dump tetap penting, tetapi semakin perlu dibaca bersama native/off-heap observability karena aplikasi modern lebih sering memakai:

- direct buffers;
- mapped files;
- FFM segments;
- native libraries;
- high-throughput networking;
- container limits.

---

## 13. Case Study 1 — Cache Tanpa Eviction

### Symptom

```text
Heap used after GC naik dari 2 GB ke 7 GB dalam 6 jam.
GC makin sering.
Tidak ada traffic spike besar.
```

### Histogram

```text
ConcurrentHashMap$Node naik terus.
String dan byte[] ikut naik.
Domain class: DocumentSearchResult naik.
```

### Dominator

```text
SearchCache retains 5.2 GB
  ConcurrentHashMap
    Node[]
      QueryKey
      List<DocumentSearchResult>
```

### Path to Root

```text
DocumentSearchResult
 <- ArrayList.elementData
 <- value of ConcurrentHashMap$Node
 <- table of ConcurrentHashMap
 <- cache field of SearchCache
 <- static field INSTANCE
 <- GC Root
```

### Root Cause

Cache key mengandung timestamp sampai millisecond.

```java
record QueryKey(String keyword, Instant requestedAt, String userId) {}
```

Setiap request hampir pasti unique. Cache tidak pernah hit efektif, tetapi terus menyimpan result.

### Fix

```text
Remove timestamp from key.
Set maximum size.
Set TTL.
Add cache metrics.
Add test for key normalization.
```

---

## 14. Case Study 2 — ThreadLocal Request Context Leak

### Symptom

```text
Old gen naik perlahan.
Tidak ada cache besar.
Banyak request payload lama masih hidup.
```

### Dominator

```text
Thread http-worker-* retain RequestContext objects.
```

### Path

```text
RequestContext
 <- value of ThreadLocalMap$Entry
 <- threadLocals of Thread
 <- GC Root: Java Thread
```

### Root Cause

```java
REQUEST_CONTEXT.set(ctx);
process();
// exception path skip cleanup
```

### Fix

```java
REQUEST_CONTEXT.set(ctx);
try {
    process();
} finally {
    REQUEST_CONTEXT.remove();
}
```

Tambahkan filter/interceptor global untuk cleanup MDC/security/request context.

---

## 15. Case Study 3 — Executor Queue Menahan Payload

### Symptom

```text
Heap melonjak saat downstream lambat.
Thread pool tetap 20 thread.
Latency naik.
OOM setelah backlog panjang.
```

### Heap Dump

```text
LinkedBlockingQueue retains 3 GB.
FutureTask retains lambda.
Lambda captures LargeRequest.
```

### Root Cause

Unbounded queue.

```java
Executors.newFixedThreadPool(20)
```

### Fix

```java
new ThreadPoolExecutor(
    20,
    20,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(1000),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Namun fix sebenarnya harus mempertimbangkan:

- backpressure;
- timeout;
- retry budget;
- circuit breaker;
- payload compaction;
- rejection handling.

---

## 16. Case Study 4 — ClassLoader Leak Setelah Redeploy

### Symptom

```text
Setelah beberapa redeploy, metaspace naik.
Heap juga naik.
Old application classes masih ada.
```

### Heap Dump

```text
Multiple WebAppClassLoader retained.
Path through Thread.contextClassLoader.
Another path through static registry.
```

### Root Cause

Application membuat scheduler thread sendiri dan tidak mematikannya saat undeploy.

### Fix

```text
Stop scheduler on shutdown.
Clear ThreadLocal.
Deregister listener/MBean/JDBC driver.
Avoid custom static singleton crossing deployment boundary.
```

---

## 17. Case Study 5 — In-Flight Request Disangka Leak

### Symptom

```text
Heap dump menunjukkan 800 MB byte[] dari upload request.
```

### Path

```text
byte[]
 <- local variable in UploadController.handle
 <- Java Thread
```

### Thread Dump

```text
Thread sedang aktif memproses upload besar.
```

### Kesimpulan

Bukan leak permanen, tetapi desain buffering berisiko.

### Fix Design

```text
Stream upload.
Limit request size.
Use temp file/object storage.
Avoid readAllBytes.
Use backpressure.
```

---

## 18. Teknik Query di MAT yang Sering Berguna

### 18.1 Group by Class

Untuk melihat class dominan.

### 18.2 Group by Package

Untuk memisahkan:

```text
java.*
javax/jakarta.*
org.springframework.*
com.fasterxml.*
com.yourcompany.*
```

Jika package domain sendiri dominan, lebih mudah menelusuri ownership.

### 18.3 Dominator Tree

Urutkan retained heap. Mulai dari top dominator, bukan dari ribuan object kecil.

### 18.4 Path to GC Roots

Gunakan untuk membuktikan kenapa object masih hidup.

### 18.5 Merge Shortest Paths to GC Roots

Berguna jika banyak object sejenis punya root path yang sama.

### 18.6 Duplicate Strings

Berguna untuk text-heavy application.

Tapi jangan langsung aktifkan String dedup sebagai obat. Pertama pahami kenapa duplicate strings banyak:

- parsing JSON;
- repeated code labels;
- tenant metadata;
- enum-like string from DB;
- logging/audit payload;
- lack of normalization.

### 18.7 Collections Query

Cari collection besar:

```text
HashMap
ConcurrentHashMap
ArrayList
LinkedList
LinkedBlockingQueue
ConcurrentLinkedQueue
```

Pertanyaan:

```text
Collection size berapa?
Owner-nya siapa?
Key/value type apa?
Bounded atau tidak?
```

---

## 19. Validasi Fix

Jangan berhenti saat sudah menemukan suspect. Validasi fix harus menunjukkan memory behavior berubah.

Checklist:

```text
Reproduce leak before fix.
Apply fix.
Run same workload.
Compare histograms.
Compare retained heap.
Compare old gen after GC.
Compare GC frequency.
Compare cache/queue metrics.
Ensure no regression in correctness.
```

Contoh target validasi:

```text
Before: RequestContext count grows linearly with requests.
After: RequestContext count returns near active request count after GC.

Before: Cache entries grow unbounded.
After: Cache entries capped at 100k with eviction metrics.

Before: Executor queue reaches millions.
After: Queue bounded, rejection/backpressure visible.
```

---

## 20. Designing Code agar Heap Dump Mudah Dianalisis

Top engineer tidak hanya bisa membaca heap dump; mereka mendesain sistem agar diagnosable.

### 20.1 Nama Class Harus Bermakna

Daripada:

```java
class Holder { Object value; }
```

Lebih baik:

```java
class ActiveSessionRegistry { ... }
class PendingNotificationQueue { ... }
class TenantConfigurationCache { ... }
```

Heap dump akan jauh lebih mudah dibaca.

### 20.2 Jangan Sembunyikan Ownership

Jika object punya owner lifecycle, strukturkan field dengan jelas.

```java
class SessionRegistry {
    private final Cache<SessionId, SessionState> activeSessions;
}
```

Lebih mudah dianalisis daripada nested generic opaque utility.

### 20.3 Expose Size Metrics

Untuk struktur yang bisa tumbuh:

```text
cache.size
cache.weight
cache.eviction.count
queue.depth
registry.entries
active.sessions
inflight.requests
pending.jobs
```

Heap dump tanpa metrics membuat root cause lebih lambat.

### 20.4 Gunakan Bounded Structure by Default

Unbounded collection harus dianggap berbahaya sampai terbukti aman.

```text
Unbounded cache: suspect.
Unbounded queue: suspect.
Unbounded static map: suspect.
Unbounded per-tenant registry: suspect.
```

### 20.5 Pisahkan Payload Besar dari Metadata

Jangan biarkan object kecil yang long-lived menahan payload besar.

Anti-pattern:

```java
class AuditRecord {
    String id;
    String summary;
    String fullPayload; // huge, retained long-term
}
```

Lebih baik:

```java
class AuditRecord {
    String id;
    String summary;
    PayloadRef payloadRef;
}
```

Payload besar bisa disimpan di storage eksternal atau lifecycle berbeda.

---

## 21. Red Flags Saat Membaca Heap Dump

```text
ConcurrentHashMap retained heap besar tanpa max size.
ArrayList besar di singleton service.
LinkedBlockingQueue sangat besar.
ThreadLocalMap menahan domain object.
Multiple classloader lama masih hidup.
Huge byte[] reachable dari static field.
MDC/log context menahan payload.
CompletableFuture incomplete sangat banyak.
Executor FutureTask menahan request object.
String duplicate sangat banyak dari field terbatas.
HashMap$Node sangat banyak dengan key high-cardinality.
Object[] besar sebagai backing collection.
DirectByteBuffer wrapper banyak dan retained.
```

---

## 22. Anti-Patterns dalam Heap Dump Investigation

### 22.1 Langsung Menambah Heap

Menambah heap bisa memberi waktu, tetapi tidak menyelesaikan leak.

Jika live set terus naik, heap lebih besar hanya menunda OOM.

### 22.2 Langsung Mengganti GC

Jika object graph bocor, G1/ZGC/Shenandoah tidak akan membuat object unreachable.

Collector berbeda hanya mengubah cara mengelola live object, bukan lifecycle domain.

### 22.3 Menghapus Reference Secara Acak

Setting field ke `null` tidak otomatis desain bagus.

Tanya:

```text
Siapa owner lifecycle?
Kapan object harus dilepas?
Apakah ada invariant cleanup?
Apakah cleanup terjadi di semua path including exception?
```

### 22.4 Menggunakan WeakReference untuk Menutupi Lifecycle Buruk

WeakReference bukan pengganti ownership.

Jika data harus dilepas pada event domain, lakukan explicit remove.

### 22.5 Menyimpulkan dari Satu Snapshot Tanpa Konteks

Satu dump bisa misleading.

Gabungkan dengan:

- metrics;
- GC log;
- thread dump;
- traffic pattern;
- deployment timeline;
- second dump;
- domain lifecycle.

---

## 23. Minimal Runbook Production

Saat terjadi suspected heap leak:

```text
1. Confirm symptom:
   - heap after GC naik?
   - old gen naik?
   - Java heap OOM?

2. Capture lightweight data:
   - jcmd <pid> VM.command_line
   - jcmd <pid> VM.flags
   - jcmd <pid> GC.heap_info
   - jcmd <pid> GC.class_histogram
   - thread dump
   - recent GC log/JFR if available

3. Decide dump safety:
   - disk available?
   - data sensitivity?
   - replica can be drained?
   - business impact acceptable?

4. Capture heap dump:
   - jcmd <pid> GC.heap_dump filename=/safe/path/app-T1.hprof

5. Analyze:
   - leak suspects
   - dominator tree
   - path to GC roots
   - class histogram
   - collection sizes

6. Validate root cause:
   - match with domain lifecycle
   - reproduce if possible
   - compare second snapshot

7. Fix:
   - bound structure
   - cleanup lifecycle
   - reduce retention
   - stream instead of materialize
   - clear ThreadLocal/MDC
   - stop threads/unregister listeners

8. Prove fix:
   - same workload
   - histogram delta fixed
   - old gen stable
   - GC frequency stable
   - no new correctness issue
```

---

## 24. Decision Matrix

| Symptom | Best First Tool | Heap Dump Role |
|---|---|---|
| Old gen after GC naik | GC log + heap dump | Primary evidence |
| Java heap OOM | OOM heap dump | Primary evidence |
| RSS naik, heap stabil | NMT/OS/cgroup | Secondary clue |
| Direct buffer OOM | NMT + heap dump | Find wrappers/owners |
| Metaspace OOM | classloader stats/NMT | Find classloader leak |
| Frequent young GC | GC log/JFR allocation | Usually not heap dump first |
| Full GC often | GC log + heap dump | If live set high |
| Pod OOMKilled | cgroup/RSS/NMT | Only if heap contributes |
| Cache suspected | metrics + heap dump | Primary evidence |
| ThreadLocal suspected | heap dump + thread dump | Primary evidence |
| Queue backlog | metrics + heap dump | Confirms retained payload |

---

## 25. Checklist Pemahaman

Setelah bagian ini, kamu seharusnya bisa menjawab:

1. Apa beda shallow size dan retained size?
2. Kenapa object kecil bisa menahan heap besar?
3. Apa itu GC root?
4. Kenapa path to GC root lebih penting daripada class histogram?
5. Kapan heap dump berguna dan kapan tidak?
6. Apa bedanya leak, high live set valid, dan temporary allocation pressure?
7. Bagaimana membaca dominator tree?
8. Bagaimana membedakan static registry valid vs leak?
9. Bagaimana ThreadLocal leak muncul di heap dump?
10. Bagaimana executor queue bisa menahan payload besar?
11. Kenapa `byte[]` tinggi belum cukup untuk root cause?
12. Kenapa heap dump harus diperlakukan seperti data sensitif?
13. Bagaimana memvalidasi fix leak?
14. Kenapa mengganti GC bukan solusi leak?
15. Bagaimana membuat code lebih mudah dianalisis dari heap dump?

---

## 26. Ringkasan Mental Model

Heap dump analysis adalah reverse engineering terhadap object graph.

Gunakan urutan berpikir berikut:

```text
1. Apakah ini benar Java heap problem?
2. Class apa yang banyak?
3. Object/collection mana yang dominan secara retained size?
4. Siapa yang menahan object itu dari GC root?
5. Apakah retention itu valid menurut domain lifecycle?
6. Apakah growth terlihat antar snapshot?
7. Fix lifecycle/ownership/bounds.
8. Validasi dengan workload dan metrics yang sama.
```

Kalimat paling penting:

> GC hanya bisa membersihkan object yang unreachable. Leak terjadi ketika sistem masih punya reference ke object yang secara bisnis sudah mati.

Dan:

> Heap dump tidak mengatakan “ini bug”; heap dump mengatakan “ini path reference-nya”. Engineer yang harus menghubungkannya dengan lifecycle domain.

---

## 27. Referensi

- Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools, `jcmd`, heap dump, class histogram.
- Oracle Java SE 25 Tools Reference — `jcmd` command.
- Oracle Java SE 8 Troubleshooting Guide — `jmap`, heap histogram, heap dump usage.
- Eclipse Memory Analyzer — official project documentation.
- Eclipse MAT Help — Leak Suspects Report, Dominator Tree, retained heap analysis.
- OpenJDK Serviceability Tools overview.

---

## 28. Status Seri

```text
Part 026 selesai.
Seri belum selesai.
Masih lanjut ke part 027 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-027.md
```

Topik berikutnya:

```text
Native Memory Leak and Off-Heap Investigation
```
