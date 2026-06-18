# Learn Java Part 014 — Observability, Profiling, dan Troubleshooting di Java hingga Java 25

> Target pembaca: software engineer yang ingin naik dari level “bisa membaca log dan restart service” menjadi engineer yang mampu **mendiagnosis perilaku runtime Java secara ilmiah**, membedakan gejala vs akar masalah, memilih tool yang tepat, dan menghasilkan bukti teknis yang defensible untuk production incident.

---

## 0. Posisi Bagian Ini dalam Kurikulum

Pada bagian sebelumnya kita sudah membahas:

- bagaimana Java source menjadi bytecode;
- bagaimana JVM mengeksekusi bytecode;
- bagaimana class loading, JIT, heap, allocation, dan GC bekerja;
- bagaimana concurrency, I/O, text, dan memory management bisa menciptakan failure mode.

Bagian ini menjawab pertanyaan berikut:

> Ketika sistem Java sudah berjalan di production dan terjadi latency spike, CPU tinggi, memory naik, GC storm, thread pool starvation, deadlock, leak, atau throughput drop, bagaimana kita membuktikan penyebabnya?

Observability bukan sekadar menambahkan log. Profiling bukan sekadar membuka flame graph. Troubleshooting bukan sekadar mencoba-coba flag JVM.

Observability Java yang kuat adalah kemampuan untuk menghubungkan:

```text
user symptom
  -> service-level signal
  -> JVM-level signal
  -> OS/container-level signal
  -> code path
  -> data/input pattern
  -> root cause
  -> fix
  -> regression guard
```

Di Java, kemampuan ini sangat kuat karena platform menyediakan banyak fasilitas bawaan:

- JVM diagnostic tools;
- Java Flight Recorder;
- Java Management Extensions;
- thread dump;
- heap dump;
- GC log;
- Native Memory Tracking;
- JFR custom events;
- JDK Mission Control;
- `jcmd`, `jfr`, `jstack`, `jmap`, `jstat`, `jps`, `jconsole`, `jdb`;
- integration dengan profiler eksternal seperti async-profiler;
- integration dengan observability stack seperti OpenTelemetry, Prometheus, Grafana, Loki, Elastic, Datadog, New Relic, dan sejenisnya.

Bagian ini akan membangun mental model dari bawah ke atas.

---

## 1. Mental Model Observability

### 1.1 Observability vs monitoring

Monitoring menjawab:

> Apakah sistem sedang sehat?

Observability menjawab:

> Mengapa sistem berperilaku seperti ini?

Monitoring biasanya berbasis dashboard dan alert yang sudah didefinisikan sebelumnya.

Observability memungkinkan investigasi terhadap kondisi yang belum pernah diprediksi.

Contoh monitoring:

```text
CPU > 85% selama 5 menit
p95 latency > 2 detik
error rate > 5%
heap used > 90%
Kafka consumer lag > 100k
```

Contoh observability:

```text
p99 endpoint /cases/{id}/transition naik hanya untuk state ESCALATED,
terjadi saat payload mengandung 500+ attachments,
CPU mostly habis di JSON serialization,
dan allocation rate naik karena membuat temporary DTO graph besar.
```

Monitoring melihat alarm.

Observability menemukan cerita kausal.

---

### 1.2 Gejala, sinyal, hipotesis, bukti

Engineer Java yang kuat tidak langsung memperbaiki gejala. Ia membuat hipotesis dan mengumpulkan bukti.

```text
Symptom:
  User melaporkan case approval lambat.

Signal:
  p95 latency endpoint approve naik dari 300 ms ke 4 s.

Initial hypotheses:
  1. DB query lambat.
  2. Thread pool penuh.
  3. GC pause.
  4. Downstream service lambat.
  5. Lock contention.
  6. CPU saturation karena serialization.

Evidence:
  - DB query duration normal.
  - GC pause rendah.
  - CPU tinggi.
  - JFR menunjukkan hotspot di ObjectMapper serialization.
  - Allocation profile menunjukkan DTO list besar.
  - Endpoint trace menunjukkan response body terlalu besar.

Conclusion:
  Bottleneck bukan DB, tetapi response construction + serialization.
```

Troubleshooting yang baik selalu punya bentuk:

```text
Saya melihat X.
Saya menduga Y.
Saya mengumpulkan Z.
Z menguatkan/melemahkan Y.
Saya melakukan action A.
Saya memverifikasi hasilnya dengan B.
```

---

### 1.3 Empat lapis observability Java

Sistem Java production biasanya harus dilihat dari empat lapis.

```text
Application layer
  log, metric, trace, business event, domain audit

JVM layer
  heap, GC, thread, lock, class loading, JIT, safepoint, JFR event

OS/container layer
  CPU, memory RSS, file descriptor, network, disk I/O, cgroup throttling

Dependency layer
  database, cache, queue, object storage, downstream API, DNS, TLS
```

Kesalahan umum adalah membaca hanya satu lapis.

Contoh:

- Heap normal, tetapi container OOMKilled karena direct buffer/native memory.
- CPU Java normal, tetapi process throttled karena Kubernetes CPU limit.
- DB normal, tetapi connection pool exhausted karena connection leak.
- GC pause rendah, tetapi latency tinggi karena thread blocked menunggu lock.
- Error rate rendah, tetapi business SLA gagal karena queue lag naik.

---

## 2. Signal Utama: Metric, Log, Trace, Profile, Dump, Event

### 2.1 Metric

Metric adalah angka time-series.

Contoh:

```text
http.server.requests.count
http.server.requests.p95
jvm.memory.used
jvm.gc.pause
jvm.threads.live
process.cpu.usage
hikaricp.connections.active
kafka.consumer.records-lag-max
```

Metric bagus untuk:

- alert;
- trend;
- capacity planning;
- SLO/SLA tracking;
- regression detection;
- correlation antar sinyal.

Metric buruk untuk:

- detail stack trace;
- memahami urutan request individual;
- menemukan exact code path;
- payload-specific debugging.

Metric harus punya dimensi yang terkendali.

Buruk:

```text
http.request.duration{userId="123456789", caseId="CASE-999"}
```

Ini high-cardinality dan bisa merusak backend metric.

Lebih baik:

```text
http.request.duration{method="POST", route="/cases/{id}/transition", status="200"}
```

Untuk domain metric:

```text
case.transition.count{from="SUBMITTED", to="APPROVED"}
case.transition.rejected.count{reason="INVALID_STATE"}
case.escalation.count{policy="AUTO_TIMEOUT"}
```

Prinsip:

> Metric adalah sinyal agregat. Jangan memaksa metric menjadi log.

---

### 2.2 Log

Log adalah catatan discrete event dalam bentuk teks/struktur.

Log bagus untuk:

- event kronologis;
- error detail;
- request correlation;
- audit ringan;
- debugging rare path;
- informasi manusiawi.

Log buruk untuk:

- agregasi statistik besar;
- profiling CPU;
- tracing dependency complex;
- menyimpan payload sensitif.

Log modern sebaiknya structured.

Contoh buruk:

```text
Failed to approve case 123 because invalid state
```

Contoh lebih baik:

```json
{
  "level": "WARN",
  "event": "case.transition.rejected",
  "caseId": "CASE-123",
  "fromState": "CLOSED",
  "requestedTransition": "APPROVE",
  "reason": "INVALID_STATE",
  "correlationId": "7f3d...",
  "actorType": "OFFICER"
}
```

Log yang baik punya:

- timestamp;
- level;
- event name;
- correlation id;
- request id;
- trace id/span id;
- domain id bila aman;
- reason code;
- exception class;
- short message;
- stack trace hanya pada boundary yang tepat.

Anti-pattern log:

```java
try {
    service.approve(command);
} catch (Exception e) {
    log.error("Error", e);
    throw e;
}
```

Jika setiap layer melakukan ini, satu failure menghasilkan banyak log duplicate. Lebih baik log pada boundary yang memiliki konteks paling cukup.

---

### 2.3 Trace

Trace merepresentasikan perjalanan satu request atau workflow melewati beberapa komponen.

Trace menjawab:

```text
Request ini menghabiskan waktu di mana?
```

Contoh trace:

```text
POST /cases/{id}/approve                    1820 ms
  Auth filter                                12 ms
  Load case from DB                          80 ms
  Validate transition                         4 ms
  Call document service                    1300 ms
  Persist transition                         90 ms
  Publish event                              20 ms
  Serialize response                        180 ms
```

Trace bagus untuk:

- latency decomposition;
- dependency call;
- distributed request flow;
- retry visibility;
- queue boundary jika instrumented;
- root cause across microservices.

Trace buruk untuk:

- CPU hotspot detail;
- heap object graph;
- GC pause analysis;
- thread contention detail.

Trace perlu propagation:

- HTTP headers;
- messaging headers;
- scheduled job context;
- async execution context;
- virtual thread / scoped context design.

---

### 2.4 Profile

Profile menunjukkan konsumsi resource oleh code path.

Jenis profile:

- CPU profile;
- wall-clock profile;
- allocation profile;
- lock contention profile;
- I/O wait profile;
- method timing/tracing;
- native memory profile.

Profile menjawab:

```text
Resource habis di code path mana?
```

Contoh:

```text
CPU hotspot:
  38% com.fasterxml.jackson.databind.ser.BeanSerializer.serialize
  17% java.util.HashMap.resize
  11% java.lang.StringLatin1.inflate
```

Allocation hotspot:

```text
Allocated bytes:
  42% CaseResponseMapper.toDto
  21% ArrayList.grow
  15% String.substring
```

Prinsip:

> Jangan optimasi tanpa profile. Jangan percaya profile tanpa memahami jenis profilenya.

CPU-time profile berbeda dari wall-clock profile.

- CPU-time profile menunjukkan waktu aktif menggunakan CPU.
- Wall-clock profile menunjukkan elapsed time, termasuk waiting/blocking.

Jika service lambat karena menunggu DB, CPU profile mungkin terlihat “dingin”. Wall-clock/trace lebih berguna.

Jika service CPU-bound karena serialization, CPU profile sangat berguna.

---

### 2.5 Dump

Dump adalah snapshot state.

Jenis dump:

- thread dump;
- heap dump;
- core dump;
- JFR dump;
- class histogram;
- native memory summary.

Dump bagus untuk:

- deadlock;
- blocked threads;
- object retention;
- memory leak;
- thread explosion;
- post-incident analysis.

Dump buruk untuk:

- trend jangka panjang;
- latency decomposition request individual;
- lightweight continuous monitoring.

Thread dump adalah snapshot thread state. Ambil beberapa kali, bukan sekali saja.

Heap dump bisa besar, sensitif, dan mahal. Jangan sembarang ambil di production tanpa memperhatikan dampak storage, pause, dan data privacy.

---

### 2.6 Event

Event adalah unit observability yang lebih semantik daripada metric/log mentah.

JFR sendiri berbasis event. Event punya timestamp, duration, thread, stack trace, dan payload.

Domain system juga bisa punya business event:

```text
CaseSubmitted
CaseAssigned
CaseEscalated
CaseApproved
CaseRejected
CaseClosed
```

Untuk troubleshooting, event sangat kuat jika dikaitkan dengan trace/log/JFR.

Contoh custom JFR event:

```java
import jdk.jfr.Category;
import jdk.jfr.Event;
import jdk.jfr.Label;

@Category({"Application", "Case"})
@Label("Case Transition")
public class CaseTransitionEvent extends Event {
    @Label("From State")
    String fromState;

    @Label("To State")
    String toState;

    @Label("Result")
    String result;
}
```

Dengan custom JFR event, kita bisa melihat business operation di timeline JVM yang sama dengan GC, allocation, thread, socket, lock, dan CPU sample.

---

## 3. JVM Diagnostic Tools: Peta Besar

JDK membawa banyak tool. Top-tier Java engineer tidak harus hafal semua opsi, tetapi harus tahu **tool mana untuk pertanyaan apa**.

| Pertanyaan | Tool utama | Output |
|---|---|---|
| Process Java apa yang berjalan? | `jps`, `jcmd -l` | PID dan main class/JAR |
| JVM flags apa yang aktif? | `jcmd VM.flags`, `jcmd VM.command_line` | startup/runtime flags |
| System properties apa? | `jcmd VM.system_properties` | properties |
| Thread sedang apa? | `jcmd Thread.print`, `jstack` | thread dump |
| Heap summary? | `jcmd GC.heap_info` | heap info |
| Object class histogram? | `jcmd GC.class_histogram` | jumlah object per class |
| Heap dump? | `jcmd GC.heap_dump` atau `jmap` | `.hprof` |
| GC utilization? | `jstat` / GC log / JFR | time-series GC |
| JFR recording? | `jcmd JFR.start/dump/stop`, `jfr` | `.jfr` |
| Native memory? | `jcmd VM.native_memory` | native memory breakdown |
| Module/classloader info? | `jcmd VM.classloader_stats` | classloader stats |
| Safepoint/JIT? | JFR, logs | timeline/diagnostic |

JDK 25 documentation untuk module `jdk.jcmd` menyatakan module ini mendefinisikan tools diagnostics/troubleshooting JVM seperti `jcmd`, `jps`, dan `jstat`. Dalam praktik modern, `jcmd` sering menjadi pintu masuk utama karena banyak command JVM tersedia lewat satu tool.

---

## 4. `jps`: Menemukan Proses Java

`jps` menampilkan instrumented Java processes.

Contoh:

```bash
jps -l
```

Output:

```text
12345 com.example.CaseServiceApplication
22210 jdk.jcmd/sun.tools.jps.Jps
```

Gunakan `jps` untuk menemukan PID cepat.

Namun di container, `jps` bisa terbatas jika:

- tool tidak ada di image runtime minimal;
- process berjalan sebagai user berbeda;
- attach mechanism dibatasi;
- container memakai distroless image.

Alternatif:

```bash
ps aux | grep java
jcmd -l
```

Prinsip production:

> Pastikan image runtime production punya strategi diagnostics. Image terlalu minimal memang aman/kecil, tetapi bisa menyulitkan incident response.

Solusi umum:

- sediakan debug image;
- gunakan ephemeral container di Kubernetes;
- mount JDK tools hanya saat debugging;
- aktifkan JFR continuous recording sejak startup;
- expose metrics/traces/logs cukup kuat sehingga attach jarang diperlukan.

---

## 5. `jcmd`: Swiss Army Knife JVM Diagnostics

`jcmd` adalah tool command-line untuk mengirim diagnostic command ke JVM.

Pola umum:

```bash
jcmd <pid> <command> [arguments]
```

Lihat proses:

```bash
jcmd -l
```

Lihat command tersedia:

```bash
jcmd <pid> help
```

Lihat help command tertentu:

```bash
jcmd <pid> help Thread.print
```

---

### 5.1 Command penting `jcmd`

#### JVM startup dan configuration

```bash
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.version
jcmd <pid> VM.uptime
```

Gunakan saat ingin membuktikan:

- JVM benar-benar memakai JDK versi berapa;
- `-Xmx` benar-benar berapa;
- GC mana yang aktif;
- system property profile aktif;
- argumen aplikasi benar;
- container env sudah terbaca.

#### Thread

```bash
jcmd <pid> Thread.print
jcmd <pid> Thread.print -l
```

`-l` biasanya membantu menampilkan lock info lebih detail.

Gunakan untuk:

- deadlock;
- thread pool starvation;
- blocking I/O;
- lock contention;
- request stuck;
- terlalu banyak thread;
- virtual thread investigation.

#### Heap dan object

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Gunakan untuk:

- memory leak;
- object explosion;
- cache tumbuh;
- string/list/map menumpuk;
- classloader leak;
- melihat komposisi heap sebelum heap dump penuh.

#### Native memory

Native Memory Tracking perlu diaktifkan saat startup:

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

Lalu:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
```

Gunakan saat:

- RSS container naik tetapi heap normal;
- direct buffer dicurigai;
- thread stack terlalu banyak;
- metaspace/code cache/native allocations naik;
- process OOMKilled oleh cgroup.

#### JFR

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=5m filename=/tmp/incident.jfr
jcmd <pid> JFR.dump name=incident filename=/tmp/incident-dump.jfr
jcmd <pid> JFR.stop name=incident filename=/tmp/incident-final.jfr
jcmd <pid> JFR.check
```

Gunakan JFR sebagai default profiling/troubleshooting tool bawaan JDK.

---

### 5.2 Risiko memakai diagnostic command

Tidak semua command murah.

Relatif aman:

```text
VM.version
VM.flags
VM.command_line
VM.uptime
JFR.check
```

Perlu hati-hati:

```text
Thread.print
GC.class_histogram
JFR.dump
```

Bisa mahal/berisiko:

```text
GC.heap_dump
System.gc
large JFR with high-frequency events
NativeMemoryTracking=detail overhead
```

Rule:

> Di production, ambil data seminimal mungkin yang cukup untuk membuktikan hipotesis.

---

## 6. `jstack` dan Thread Dump Analysis

Thread dump adalah snapshot semua thread Java dan state-nya.

Command:

```bash
jstack <pid> > threads.txt
```

atau modern:

```bash
jcmd <pid> Thread.print > threads.txt
```

Ambil beberapa dump:

```bash
for i in 1 2 3 4 5; do
  jcmd <pid> Thread.print > threads-$i.txt
  sleep 5
done
```

Mengapa beberapa kali?

Karena satu snapshot bisa menipu. Thread yang terlihat blocked sekali mungkin normal. Thread yang blocked di stack sama selama 5 snapshot lebih mencurigakan.

---

### 6.1 Thread state

Common Java thread states:

| State | Makna praktis |
|---|---|
| `RUNNABLE` | sedang running atau siap running; bisa juga native/socket I/O tergantung stack |
| `BLOCKED` | menunggu monitor lock |
| `WAITING` | menunggu tanpa timeout, misalnya `Object.wait`, `LockSupport.park`, `Thread.join` |
| `TIMED_WAITING` | menunggu dengan timeout, misalnya `sleep`, `parkNanos`, socket wait |
| `NEW` | belum start |
| `TERMINATED` | selesai |

Kesalahan umum:

> Menganggap semua `RUNNABLE` berarti sedang memakai CPU.

Dalam thread dump, thread bisa `RUNNABLE` saat berada di native I/O. Untuk CPU, butuh profile atau OS thread CPU correlation.

---

### 6.2 Pola deadlock

Deadlock biasanya terlihat seperti:

```text
Found one Java-level deadlock:
"Thread-A": waiting to lock monitor X, which is held by "Thread-B"
"Thread-B": waiting to lock monitor Y, which is held by "Thread-A"
```

Contoh penyebab:

```java
synchronized (accountA) {
    synchronized (accountB) {
        transfer(accountA, accountB);
    }
}
```

Thread lain:

```java
synchronized (accountB) {
    synchronized (accountA) {
        transfer(accountB, accountA);
    }
}
```

Fix:

- lock ordering deterministik;
- avoid nested locks;
- gunakan higher-level concurrency utility;
- gunakan transaction/database locking dengan ordering jelas;
- gunakan actor/queue model untuk shared mutable state;
- timeout lock jika cocok.

---

### 6.3 Thread pool starvation

Thread pool starvation terjadi saat semua worker sibuk/blocking, sehingga task baru tidak bisa jalan.

Gejala:

```text
HTTP request pending naik
queue size naik
thread pool active == max
CPU mungkin rendah
thread dump menunjukkan semua worker WAITING ke DB/socket/future
```

Contoh buruk:

```java
ExecutorService pool = Executors.newFixedThreadPool(10);

Future<A> a = pool.submit(this::loadA);
Future<B> b = pool.submit(this::loadB);

// Jika kode ini sendiri berjalan di pool yang sama,
// dan semua worker melakukan get() menunggu task yang juga butuh worker,
// pool bisa starvation.
A resultA = a.get();
B resultB = b.get();
```

Fix:

- jangan block worker yang sama untuk menunggu task di pool yang sama;
- pisahkan executor untuk blocking I/O vs CPU;
- gunakan structured concurrency/virtual threads untuk request-style concurrency;
- limit concurrency dengan semaphore/bulkhead;
- pakai timeout;
- ukur queue depth dan active count.

---

### 6.4 Lock contention

Gejala:

```text
Banyak thread BLOCKED pada monitor yang sama
CPU bisa rendah atau tinggi
latency naik
throughput tidak naik walau thread ditambah
```

Penyebab:

- synchronized global cache;
- map biasa dibungkus lock besar;
- logging appender blocking;
- shared formatter yang synchronized;
- serializing critical section terlalu besar;
- DB connection pool lock contention;
- class initialization lock.

Diagnosis:

- thread dump;
- JFR lock events;
- flame graph wall-clock;
- metrics queue/lock wait jika tersedia.

Fix:

- kecilkan critical section;
- pakai concurrent data structure;
- shard/stripe lock;
- remove shared mutable state;
- move I/O out of lock;
- avoid synchronized hot path.

---

### 6.5 Virtual thread dump

Virtual threads mengubah cara membaca thread dump.

Dengan virtual threads, jumlah thread bisa sangat banyak. Jangan panik melihat ribuan virtual threads. Yang penting:

- apakah mereka parked normal?
- apakah mereka pinned?
- apakah carrier/platform threads blocked?
- apakah ada bottleneck external resource seperti DB pool?
- apakah semaphore/bulkhead benar?

Virtual thread tidak menghilangkan bottleneck dependency. Jika DB pool hanya 20 connection, 10.000 virtual thread tetap akan antre.

Observability virtual thread harus fokus ke:

```text
request concurrency
blocking dependency
pool size
carrier utilization
pinning
structured cancellation
timeout
```

---

## 7. `jmap`, Heap Dump, dan Class Histogram

Heap dump adalah snapshot heap. Biasanya `.hprof`.

Command:

```bash
jcmd <pid> GC.heap_dump /tmp/app.hprof
```

atau:

```bash
jmap -dump:format=b,file=/tmp/app.hprof <pid>
```

Class histogram:

```bash
jcmd <pid> GC.class_histogram > histo.txt
```

Histogram lebih ringan daripada heap dump penuh.

---

### 7.1 Kapan ambil heap dump?

Ambil heap dump jika:

- heap used naik terus dan tidak turun setelah full GC;
- OOM `Java heap space`;
- cache dicurigai tumbuh tanpa batas;
- object tertentu jumlahnya abnormal;
- leak perlu dominator analysis.

Jangan langsung ambil heap dump jika:

- memory issue kemungkinan native/RSS bukan heap;
- storage tidak cukup;
- data sensitif tidak boleh keluar;
- system sangat latency-sensitive dan dump bisa mengganggu;
- cukup dengan class histogram/JFR allocation dulu.

---

### 7.2 Shallow size vs retained size

Shallow size:

> ukuran object itu sendiri.

Retained size:

> memory yang bisa dibebaskan jika object itu tidak lagi reachable.

Dalam leak analysis, retained size lebih penting.

Contoh:

```text
HashMap object shallow size kecil,
tetapi retained size besar karena menahan jutaan entry dan value object.
```

---

### 7.3 Dominator tree

Dominator adalah object yang menjadi jalur dominan menuju object lain.

Jika object A mendominasi B, maka B hanya reachable melalui A.

Tool seperti Eclipse MAT sangat berguna untuk dominator analysis.

Pola umum leak:

```text
static Map
  -> cache entries
    -> domain objects
      -> large byte[]/String/List
```

```text
ThreadLocalMap
  -> value
    -> request context
      -> user/session/object graph
```

```text
ClassLoader
  -> static fields
    -> application classes
      -> caches/listeners
```

---

### 7.4 Memory leak vs high memory usage

Tidak semua high memory adalah leak.

High memory normal:

- warm cache;
- batch processing;
- high traffic;
- large live set;
- higher heap after scaling;
- JIT/code cache/native memory growth.

Leak:

- object retained setelah tidak lagi needed;
- live set naik monoton;
- GC tidak mampu reclaim;
- memory naik seiring request count, bukan active workload;
- heap dump menunjukkan retention path tidak valid.

Pattern analysis:

```text
Heap after GC naik dari 1 GB -> 2 GB -> 3 GB -> 4 GB
traffic relatif sama
object count domain tertentu naik terus
retention path melalui static cache
```

Itu lebih leak-like.

---

## 8. `jstat` dan JVM Time-Series Ringan

`jstat` memberi statistik JVM periodik.

Contoh:

```bash
jstat -gc <pid> 1000 10
```

Artinya tampilkan GC stats setiap 1 detik sebanyak 10 kali.

`jstat` berguna saat ingin quick look:

- young GC frequency;
- old usage;
- GC time;
- class loading;
- compiler activity.

Namun untuk analisis serius, GC log dan JFR lebih kaya.

Gunakan `jstat` sebagai “thermometer”, bukan MRI.

---

## 9. Java Flight Recorder: Mental Model

Java Flight Recorder adalah fasilitas profiling dan monitoring bawaan JDK. Ia merekam event dari JVM dan aplikasi dengan overhead rendah.

JFR event bisa mencakup:

- CPU sample;
- allocation;
- GC;
- class loading;
- thread start/end;
- lock;
- socket read/write;
- file read/write;
- exception;
- method profiling;
- custom application event.

API `jdk.jfr` di Java SE 25 menyediakan kelas untuk membuat event dan mengontrol Flight Recorder. Dokumentasi resminya menjelaskan bahwa Flight Recorder mengumpulkan data sebagai event; event memiliki timestamp, duration, dan biasanya payload yang berguna untuk diagnosis aplikasi berjalan sampai failure/crash.

---

### 9.1 Mengapa JFR sangat penting?

Karena JFR berada di dalam JVM.

Ia bisa melihat:

- GC timeline;
- safepoint;
- allocation;
- thread park/block;
- monitor enter;
- socket/file I/O;
- class loading;
- exceptions;
- method samples;
- CPU sample;
- JVM internal state.

Observability eksternal tidak selalu bisa melihat hal ini.

Trace bisa mengatakan:

```text
request lambat 2 detik
```

JFR bisa mengatakan:

```text
1.2 detik request berada di socketRead downstream,
300 ms blocked pada monitor cache,
200 ms serialisasi JSON,
50 MB allocation terjadi di mapper,
dan tidak ada GC pause signifikan.
```

---

### 9.2 Starting JFR at JVM startup

Contoh:

```bash
java \
  -XX:StartFlightRecording=name=baseline,settings=default,disk=true,maxage=1h,maxsize=512m,filename=/var/log/app/baseline.jfr \
  -jar app.jar
```

Untuk profiling lebih detail:

```bash
java \
  -XX:StartFlightRecording=name=profile,settings=profile,duration=5m,filename=profile.jfr \
  -jar app.jar
```

Parameter umum:

| Parameter | Fungsi |
|---|---|
| `name` | nama recording |
| `settings` | konfigurasi event, misalnya `default` atau `profile` |
| `duration` | durasi recording |
| `filename` | file output |
| `disk` | apakah disimpan ke disk |
| `maxage` | batas umur data |
| `maxsize` | batas ukuran data |
| `delay` | delay sebelum mulai |

---

### 9.3 Starting JFR pada process yang sudah berjalan

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=5m filename=/tmp/incident.jfr
```

Cek:

```bash
jcmd <pid> JFR.check
```

Dump:

```bash
jcmd <pid> JFR.dump name=incident filename=/tmp/incident-dump.jfr
```

Stop:

```bash
jcmd <pid> JFR.stop name=incident filename=/tmp/incident-final.jfr
```

Pola production:

```text
1. Ada alert latency/CPU/memory.
2. Start JFR profile 3-10 menit.
3. Dump file.
4. Analisis dengan jfr CLI/JDK Mission Control.
5. Korelasikan dengan log/metric/trace.
```

---

### 9.4 `jfr` command

Tool `jfr` dapat membaca file `.jfr`.

Contoh:

```bash
jfr summary recording.jfr
jfr metadata recording.jfr
jfr print recording.jfr
jfr print --events jdk.ExceptionThrow recording.jfr
jfr view gc-pauses recording.jfr
jfr view hot-methods recording.jfr
```

JDK 25 memperluas kemampuan JFR dengan event dan view baru, terutama terkait CPU-time profiling, cooperative sampling, dan method timing/tracing.

---

## 10. JFR di Java 25: JEP 509, 518, 520

JDK 25 membawa tiga enhancement penting untuk JFR:

- JEP 509 — JFR CPU-Time Profiling, experimental;
- JEP 518 — JFR Cooperative Sampling;
- JEP 520 — JFR Method Timing & Tracing.

Ketiganya penting karena profiling Java tradisional sering punya masalah akurasi, safepoint bias, atau butuh agent eksternal.

---

### 10.1 JEP 509 — JFR CPU-Time Profiling

JEP 509 meningkatkan JFR agar dapat menangkap informasi CPU-time profiling yang lebih akurat di Linux. Fitur ini experimental di JDK 25.

Perbedaan penting:

```text
Execution-time sampling:
  sampling berdasarkan elapsed/wall-clock time.

CPU-time sampling:
  sampling berdasarkan CPU time yang benar-benar dikonsumsi thread.
```

Kenapa ini penting?

Misal dua method sama-sama makan 100 ms wall-clock:

```text
method A:
  95 ms menunggu network
  5 ms CPU

method B:
  100 ms CPU aktif
```

Wall-clock profile bisa membuat keduanya terlihat sama berat.

CPU-time profile menunjukkan method B yang benar-benar membakar CPU.

Enable saat startup:

```bash
java -XX:StartFlightRecording=jdk.CPUTimeSample#enabled=true,filename=profile.jfr -jar app.jar
```

Atur throttle:

```bash
jfr configure --input profile.jfc --output /tmp/cpu_profile.jfc \
  jdk.CPUTimeSample#enabled=true \
  jdk.CPUTimeSample#throttle=20ms

jcmd <pid> JFR.start settings=/tmp/cpu_profile.jfc duration=4m filename=/tmp/cpu.jfr
```

Kapan pakai CPU-time profile:

- CPU tinggi;
- throughput mentok;
- latency naik saat CPU saturated;
- ingin tahu code mana yang boros CPU;
- workload banyak native call tapi ingin attribution ke Java method;
- server Linux production.

Jangan pakai CPU-time profile untuk membuktikan waiting dependency. Untuk itu trace/wall-clock/JFR socket/file events lebih cocok.

---

### 10.2 JEP 518 — JFR Cooperative Sampling

Sampling stack thread secara asynchronous bisa berisiko karena JVM stack metadata aman dibaca pada lokasi tertentu yang disebut safepoint. JEP 518 meredesain mekanisme sampling JFR agar lebih stabil dengan melakukan stack walking pada safepoint, sambil meminimalkan safepoint bias.

Mental model:

```text
Old risky path:
  sampler thread mencoba membaca stack target thread di lokasi arbitrary.

Cooperative path:
  sampler thread membuat sample request,
  target thread berjalan sampai safepoint berikutnya,
  stack direkonstruksi dengan mekanisme lebih aman.
```

Dampak praktis:

- JFR sampling lebih stabil;
- mengurangi risiko crash karena stack parsing heuristics;
- mendukung enhancement seperti CPU-time profiling;
- meningkatkan kepercayaan memakai JFR di production.

Namun tetap perlu ingat:

- sampling tetap statistical;
- bisa ada bias;
- hasil profile perlu durasi cukup;
- jangan mengambil kesimpulan dari sample terlalu sedikit.

---

### 10.3 JEP 520 — JFR Method Timing & Tracing

JEP 520 menambahkan fasilitas method timing dan tracing via bytecode instrumentation.

Tujuannya:

- merekam statistik exact untuk invocation method tertentu;
- merekam execution time dan stack trace method tertentu;
- tidak perlu modifikasi source code;
- bisa dikonfigurasi via command line, config file, `jcmd`, atau JMX.

Contoh trace method tertentu:

```bash
java '-XX:StartFlightRecording:jdk.MethodTrace#filter=java.util.HashMap::resize,filename=recording.jfr' \
  -jar app.jar

jfr print --events jdk.MethodTrace --stack-depth 20 recording.jfr
```

Contoh timing static initializer:

```bash
java '-XX:StartFlightRecording:method-timing=::<clinit>,filename=clinit.jfr' \
  -jar app.jar

jfr view method-timing clinit.jfr
```

Contoh via `jcmd` untuk annotation:

```bash
jcmd <pid> JFR.start method-timing=@jakarta.ws.rs.GET duration=5m filename=/tmp/endpoints.jfr
```

Gunakan method timing/tracing saat:

- startup lambat dan ingin melihat `<clinit>` mahal;
- method spesifik dicurigai bottleneck;
- resource leak ingin dilacak dari constructor/close;
- third-party library ingin diobservasi tanpa source modification;
- butuh exact invocation count dan duration untuk method terbatas.

Jangan gunakan untuk terlalu banyak method sekaligus. JEP 520 sendiri menekankan bahwa bukan goal untuk time/trace banyak method secara simultan karena bisa menurunkan performance signifikan. Untuk area luas, gunakan sampling profiler.

---

## 11. JDK Mission Control

JDK Mission Control atau JMC adalah tool GUI untuk menganalisis JFR.

Gunakan JMC untuk:

- timeline view;
- GC pauses;
- allocation hot spots;
- method profiling;
- thread activity;
- lock instances;
- I/O events;
- exceptions;
- custom event analysis;
- flame graph/view tertentu tergantung versi/plugin.

Workflow:

```text
record .jfr
  -> buka di JMC
  -> lihat automated analysis
  -> cek event timeline
  -> korelasi spikes
  -> drill down stack trace
  -> ekspor temuan
```

JMC sangat kuat untuk visual analysis. CLI `jfr` kuat untuk automation/headless environment.

---

## 12. GC Observability

GC observability menjawab:

```text
Apakah latency/throughput/memory problem disebabkan GC?
```

Sinyal utama:

- pause time;
- pause frequency;
- allocation rate;
- promotion rate;
- old generation occupancy;
- humongous allocation;
- concurrent cycle duration;
- full GC;
- evacuation failure;
- remembered set cost;
- heap after GC trend.

---

### 12.1 GC log

Aktifkan GC log modern:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

Untuk detail lebih banyak:

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

Yang dicari:

```text
Pause Young
Pause Full
Concurrent Mark Cycle
Humongous Allocation
Evacuation Failure
To-space exhausted
Metaspace
Allocation Stall
```

---

### 12.2 JFR untuk GC

JFR bisa menunjukkan:

- GC pause events;
- heap summary;
- allocation in new TLAB/outside TLAB;
- object allocation sample;
- old object sample;
- GC configuration;
- heap statistics;
- safepoint events.

JFR sering lebih mudah dikorelasikan dengan thread/CPU/I/O dibanding GC log mentah.

---

### 12.3 Diagnosis cepat GC

#### Kasus A: Latency spike karena GC pause

Evidence:

```text
p99 latency spike timestamp 10:15:03
JFR menunjukkan GC pause 2.4s pada 10:15:03
GC log menunjukkan Full GC / evacuation failure
```

Action:

- cek heap sizing;
- cek allocation rate;
- cek humongous object;
- cek live set;
- cek collector cocok atau tidak;
- profile allocation.

#### Kasus B: Memory naik tetapi GC pause rendah

Evidence:

```text
heap normal
RSS naik
container OOMKilled
NMT menunjukkan Direct buffer / Thread / Arena naik
```

Action:

- cek direct buffer;
- cek Netty/NIO/native library;
- cek thread count;
- cek metaspace/classloader;
- cek container memory limit.

#### Kasus C: CPU tinggi karena GC

Evidence:

```text
process CPU tinggi
JFR/GC log menunjukkan GC frequency sangat tinggi
application throughput turun
allocation rate tinggi
```

Action:

- allocation profiling;
- reduce object churn;
- increase heap jika live set valid;
- fix leak jika old occupancy naik;
- tune young gen/collector setelah bukti.

---

## 13. CPU Profiling

CPU profiling menjawab:

```text
Saat CPU digunakan, method mana yang menggunakannya?
```

Tools:

- JFR execution sample;
- JFR CPU-time sample Java 25 Linux experimental;
- async-profiler;
- Java Mission Control;
- OS tools seperti `top`, `pidstat`, `perf`.

---

### 13.1 CPU tinggi: workflow

```text
1. Konfirmasi CPU process tinggi.
2. Cek apakah CPU Java app atau GC.
3. Cek thread count dan runnable threads.
4. Ambil JFR CPU profile 3-10 menit.
5. Lihat hot methods.
6. Korelasi dengan endpoint/trace/log.
7. Bedakan CPU hot path valid vs bug.
```

Command:

```bash
jcmd <pid> JFR.start name=cpu settings=profile duration=5m filename=/tmp/cpu.jfr
```

Jika Linux dan ingin CPU-time profiling Java 25:

```bash
jcmd <pid> JFR.start name=cpu settings=/tmp/cpu_profile.jfc duration=5m filename=/tmp/cpu-time.jfr
```

---

### 13.2 Interpreting CPU hot methods

Misal hot methods:

```text
com.fasterxml.jackson.databind.ser.BeanSerializer.serialize
java.lang.StringLatin1.newString
java.util.HashMap.resize
com.example.CaseMapper.toResponse
```

Kemungkinan:

- response terlalu besar;
- DTO mapping berlebihan;
- object graph terlalu dalam;
- HashMap initial capacity terlalu kecil;
- data shape berubah;
- endpoint perlu pagination/projection.

Misal hot methods:

```text
java.util.regex.Pattern$Loop.match
java.util.regex.Pattern$Branch.match
```

Kemungkinan:

- regex catastrophic backtracking;
- input panjang/berbahaya;
- pattern perlu diperbaiki;
- perlu timeout/limit input.

Misal hot methods:

```text
java.math.BigDecimal.divide
java.text.DecimalFormat.format
```

Kemungkinan:

- numeric formatting di hot path;
- repeated calculation;
- locale formatter dibuat berulang;
- caching/precomputation mungkin perlu.

---

## 14. Allocation Profiling

Allocation profiling menjawab:

```text
Object baru dibuat di mana?
```

Ini berbeda dari heap dump.

- Heap dump menunjukkan object yang masih hidup.
- Allocation profile menunjukkan object yang dibuat, walau cepat mati.

Allocation rate tinggi bisa membuat GC sibuk walau heap tidak leak.

---

### 14.1 Allocation failure pattern

Contoh code:

```java
public List<CaseDto> map(List<Case> cases) {
    return cases.stream()
        .map(c -> new CaseDto(
            c.id().toString(),
            c.status().name(),
            c.events().stream().map(this::mapEvent).toList()
        ))
        .toList();
}
```

Jika dipanggil untuk 50.000 case, allocation besar.

Optimasi bukan selalu “hindari object”. Pertanyaannya:

- apakah data sebesar itu perlu dikirim?
- apakah perlu pagination?
- apakah projection cukup?
- apakah mapping bisa streaming?
- apakah response perlu aggregate only?
- apakah cache justified?

---

### 14.2 TLAB vs outside TLAB

JFR membedakan allocation inside TLAB dan outside TLAB.

- TLAB allocation adalah fast path normal.
- Outside TLAB sering untuk object besar atau saat TLAB tidak cukup.

Jika outside TLAB tinggi, cek:

- large arrays;
- large byte buffers;
- large strings;
- image/document payload;
- humongous object pada G1;
- batch size terlalu besar.

---

## 15. Wall-Clock Profiling

CPU profile tidak cukup jika problem adalah waiting.

Wall-clock profile menjawab:

```text
Elapsed time hilang di mana, termasuk waiting/blocking?
```

Contoh:

```text
Thread wall-clock:
  70% socketRead
  15% connection pool wait
  10% monitor enter
  5% CPU
```

Jika latency tinggi tetapi CPU rendah, curigai:

- downstream latency;
- DB slow query;
- connection pool exhaustion;
- thread pool starvation;
- lock contention;
- queue backlog;
- file/network I/O;
- rate limiting.

JFR event penting:

- socket read/write;
- file read/write;
- thread park;
- monitor enter;
- Java monitor wait;
- executor events jika tersedia dari framework/custom instrumentation;
- custom application events.

---

## 16. Exception Observability

Exception bisa menjadi gejala normal atau masalah besar.

Pertanyaan:

```text
Exception apa yang paling sering terjadi?
Apakah exception terjadi di hot path?
Apakah stack trace generation menyebabkan overhead?
Apakah exception merupakan business rejection atau technical failure?
Apakah exception ditelan?
```

JFR memiliki event exception throw/error tertentu. Logging juga menangkap exception.

Anti-pattern:

```java
try {
    parse(input);
} catch (Exception ignored) {
    return Optional.empty();
}
```

Masalah:

- failure disembunyikan;
- observability hilang;
- data quality issue tidak terlihat;
- CPU bisa terbuang jika exception dipakai untuk control flow.

Better:

```java
ParseResult result = parser.tryParse(input);
if (result.isInvalid()) {
    metrics.counter("case.parse.invalid", "reason", result.reason()).increment();
    log.debug("Invalid input: reason={}", result.reason());
}
```

---

## 17. Logging Strategy di Java Production

### 17.1 Level log

| Level | Gunakan untuk |
|---|---|
| `TRACE` | detail sangat granular, biasanya off |
| `DEBUG` | debugging development/non-prod |
| `INFO` | lifecycle/business event penting |
| `WARN` | abnormal tapi masih recoverable |
| `ERROR` | failure yang butuh perhatian/action |

Jangan pakai `ERROR` untuk business rejection normal.

Contoh:

```text
Invalid transition CLOSED -> APPROVED
```

Jika ini input user yang valid sebagai rejection domain, mungkin `INFO`/`WARN`, bukan `ERROR`.

Jika ini invariant breach karena bug, baru `ERROR`.

---

### 17.2 Structured logging

Gunakan key-value.

Logback/SLF4J 2 mendukung fluent API:

```java
logger.atWarn()
    .setMessage("Case transition rejected")
    .addKeyValue("caseId", command.caseId())
    .addKeyValue("fromState", currentState)
    .addKeyValue("requestedAction", command.action())
    .addKeyValue("reason", reason.code())
    .log();
```

Output JSON tergantung encoder/appender.

Field yang berguna:

```text
timestamp
level
logger
thread
message
event
traceId
spanId
correlationId
actorId/hash
tenantId
caseId
commandId
idempotencyKey
state
reason
exception.class
exception.message
```

---

### 17.3 Correlation ID dan trace ID

Correlation ID menghubungkan log dalam workflow bisnis.

Trace ID menghubungkan span distributed tracing.

Idealnya:

```text
correlationId: business/request correlation
traceId: tracing system id
spanId: current operation id
caseId: domain id
commandId: idempotency/business command id
```

Jangan hanya mengandalkan thread name, terutama dengan async/virtual threads.

---

### 17.4 Logging anti-pattern

#### Log payload sensitif

Buruk:

```java
log.info("Request body: {}", requestBody);
```

Risiko:

- PII leak;
- credential leak;
- regulatory breach;
- log storage explosion.

#### Double logging exception

Buruk:

```java
catch (Exception e) {
    log.error("Repository failed", e);
    throw new ServiceException("Failed", e);
}
```

Lalu controller juga log error. Jadinya noisy.

#### Log tanpa actionability

Buruk:

```text
Something went wrong
```

Lebih baik:

```text
case.transition.persist.failed caseId=... commandId=... dbErrorCode=... retryable=true
```

#### Log di hot loop

Buruk:

```java
for (Item item : millionItems) {
    log.info("Processing {}", item.id());
}
```

Gunakan sampling/progress metric.

---

## 18. Metrics Strategy untuk Java Service

### 18.1 RED dan USE

RED untuk request/service:

- Rate;
- Errors;
- Duration.

USE untuk resource:

- Utilization;
- Saturation;
- Errors.

Untuk Java service:

```text
RED:
  http request rate
  http error rate
  http duration p50/p95/p99

USE:
  CPU usage/throttling
  heap usage
  GC pause
  thread pool active/queue
  DB pool active/pending
  Kafka consumer lag
  disk/network I/O
```

---

### 18.2 JVM metrics minimal

Minimal metrics:

```text
jvm.memory.used/max by area
jvm.gc.pause count/duration
jvm.gc.memory.allocated
jvm.gc.memory.promoted
jvm.threads.live/daemon/peak
jvm.classes.loaded/unloaded
process.cpu.usage
system.cpu.usage
process.files.open/max
executor.active/queued/completed
hikaricp.connections.active/idle/pending
http.server.requests
```

Untuk production service, metric executor dan connection pool sering lebih actionable daripada heap percentage saja.

---

### 18.3 Percentile dan histogram

Average latency sering menipu.

```text
Requests:
  990 request = 100 ms
  10 request = 10_000 ms

Average ≈ 199 ms
p99 ≈ 10_000 ms
```

Gunakan histogram untuk p95/p99/p999.

Namun histogram perlu bucket yang tepat. Bucket terlalu kasar membuat data tidak berguna.

---

### 18.4 Cardinality discipline

High-cardinality label bisa menghancurkan metrics backend.

Buruk:

```text
case.transition.duration{caseId="CASE-123456"}
```

Lebih baik:

```text
case.transition.duration{from="SUBMITTED", to="APPROVED", result="SUCCESS"}
```

Domain label harus bounded:

- state;
- action;
- reason code;
- channel;
- service name;
- dependency name;
- result.

Jangan label:

- user ID;
- case ID;
- free-text reason;
- raw exception message;
- URL full path dengan ID.

---

## 19. Distributed Tracing untuk Java

### 19.1 Span design

Span yang baik merepresentasikan operation meaningful.

Contoh:

```text
HTTP POST /cases/{id}/approve
  validate command
  load case
  acquire lock
  apply transition
  persist case
  publish CaseApproved event
  call document service
```

Jangan membuat span terlalu granular untuk setiap method kecil.

Span harus membantu menjawab:

```text
Latency hilang di operation mana?
```

---

### 19.2 Trace propagation

HTTP propagation biasanya lewat headers.

Messaging propagation lewat message headers.

Async execution perlu context propagation.

Problem klasik Java:

- `ThreadLocal` tidak otomatis berpindah thread;
- `CompletableFuture` bisa jalan di executor berbeda;
- Reactor/WebFlux punya context sendiri;
- virtual threads mengubah cost model, tetapi bukan magic context propagation;
- Scoped Values di Java 25 memberikan model context immutable yang lebih cocok untuk structured concurrent code, tetapi ecosystem integration tetap perlu diperhatikan.

---

### 19.3 Sampling

Tidak semua trace disimpan.

Sampling strategy:

- head-based sampling;
- tail-based sampling;
- error-biased sampling;
- latency-biased sampling;
- route-specific sampling.

Untuk incident, sering perlu menaikkan sampling sementara.

Hati-hati:

- terlalu banyak trace mahal;
- terlalu sedikit trace kehilangan bukti;
- PII dalam span attribute harus dihindari.

---

## 20. JMX dan Management

Java Management Extensions menyediakan cara standar expose management/monitoring resource.

MBean bisa digunakan untuk:

- runtime config;
- metrics;
- operation administrative;
- JFR control via MXBean;
- thread/memory/classloading/GC info.

Tools:

- `jconsole`;
- JMC;
- custom JMX client;
- Prometheus JMX exporter.

Risiko:

- expose JMX remote tanpa security adalah bahaya besar;
- management operation bisa destructive;
- akses production harus diaudit.

Gunakan JMX dengan:

- authentication;
- TLS;
- network restriction;
- least privilege;
- audit.

---

## 21. Native Memory Tracking

Heap bukan seluruh memory process.

JVM process memory kira-kira:

```text
RSS = heap committed
    + metaspace
    + code cache
    + thread stacks
    + direct buffers
    + GC native structures
    + JIT/compiler memory
    + JNI/native library allocations
    + libc/native overhead
```

Native Memory Tracking:

```bash
-XX:NativeMemoryTracking=summary
```

Query:

```bash
jcmd <pid> VM.native_memory summary
```

Untuk baseline/diff:

```bash
jcmd <pid> VM.native_memory baseline
# tunggu
jcmd <pid> VM.native_memory summary.diff
```

Gunakan saat:

```text
heap used 1 GB
-Xmx 2 GB
container limit 3 GB
RSS 3 GB
pod OOMKilled
```

Ini sering bukan Java heap leak, tetapi native memory pressure.

---

## 22. Container dan Kubernetes Troubleshooting Java

Java di Kubernetes punya failure mode tambahan.

### 22.1 CPU throttling

Gejala:

```text
latency naik
CPU usage tidak selalu 100%
GC/JIT lambat
thread runnable tapi progress rendah
container_cpu_cfs_throttled_periods_total naik
```

CPU limit bisa menyebabkan throttling. Java service yang latency-sensitive sering lebih stabil dengan request/limit yang dirancang hati-hati.

Investigation:

- cek container CPU throttling metrics;
- cek process CPU;
- cek GC pause correlation;
- cek p99 latency;
- cek thread runnable;
- cek executor queue.

---

### 22.2 Memory limit dan OOMKilled

Pod OOMKilled berbeda dari Java `OutOfMemoryError`.

```text
Java heap OOM:
  JVM melempar OutOfMemoryError, bisa ada heap dump.

Container OOMKilled:
  kernel/cgroup membunuh process, JVM mungkin tidak sempat menulis dump/log.
```

Untuk container Java:

- jangan set `-Xmx` sama dengan memory limit;
- sisakan ruang native memory;
- perhatikan direct buffer, metaspace, thread stack, code cache;
- enable heap dump on OOM jika aman;
- gunakan NMT untuk diagnosis.

Contoh kasar:

```text
container memory limit: 2 GiB
heap max: 60-70% jika app biasa
native/headroom: 30-40%
```

Angka final harus berdasarkan measurement.

---

### 22.3 Liveness/readiness/startup probe

Probe buruk bisa memperparah incident.

Anti-pattern:

```text
liveness probe gagal karena downstream DB lambat,
Kubernetes restart pod,
restart memperburuk traffic storm,
semua pod cycling.
```

Guideline:

- liveness: apakah process dead/hung dan perlu restart;
- readiness: apakah instance siap menerima traffic;
- startup: beri waktu bootstrap lambat.

Health check jangan terlalu mahal.

Jangan membuat liveness bergantung pada semua downstream dependency kecuali benar-benar ingin restart saat dependency gagal.

---

## 23. Incident Playbooks

### 23.1 High CPU

Gejala:

```text
CPU usage tinggi
latency naik
throughput turun atau mentok
```

Langkah:

```text
1. Konfirmasi CPU process Java, bukan sidecar/node lain.
2. Cek GC: apakah CPU habis untuk GC?
3. Ambil JFR profile 3-10 menit.
4. Jika Linux/JDK 25, pertimbangkan CPU-time profiling.
5. Cek hot methods.
6. Korelasi dengan endpoint/traffic/data shape.
7. Cek thread dump jika suspicious lock/spin.
8. Buat fix berdasarkan hotspot nyata.
```

Command:

```bash
jcmd <pid> VM.uptime
jcmd <pid> Thread.print > threads.txt
jcmd <pid> JFR.start name=highcpu settings=profile duration=5m filename=/tmp/highcpu.jfr
```

Kemungkinan root cause:

- serialization/mapping;
- regex;
- compression/encryption;
- tight loop;
- excessive logging;
- GC churn;
- cache stampede;
- busy wait;
- inefficient algorithm;
- dependency client retry storm.

---

### 23.2 High memory / OOM

Langkah:

```text
1. Bedakan Java heap OOM vs container OOMKilled.
2. Cek heap usage, RSS, GC behavior.
3. Cek GC log/JFR.
4. Ambil class histogram.
5. Jika perlu dan aman, ambil heap dump.
6. Jika heap normal tapi RSS tinggi, gunakan NMT.
7. Analisis retained size/dominator.
8. Cari retention path.
```

Command:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram > histo.txt
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_dump /tmp/app.hprof
```

Kemungkinan root cause:

- unbounded cache;
- `ThreadLocal` leak;
- listener not removed;
- classloader leak;
- large batch;
- direct buffer leak;
- too many threads;
- large response buffering;
- message backlog in memory.

---

### 23.3 Latency spike

Langkah:

```text
1. Cek p50/p95/p99: semua lambat atau tail saja?
2. Cek route mana.
3. Cek trace decomposition.
4. Cek GC pause timeline.
5. Cek downstream latency.
6. Cek DB pool/HTTP pool/executor queue.
7. Ambil JFR wall-clock/thread/lock/I/O events.
8. Ambil thread dump saat spike.
```

Kemungkinan:

- downstream slow;
- DB query/lock;
- connection pool wait;
- thread starvation;
- GC pause;
- lock contention;
- CPU saturation;
- request payload besar;
- retry amplification.

---

### 23.4 Throughput drop

Throughput drop tidak selalu CPU tinggi.

Kemungkinan:

- backpressure;
- queue full;
- DB pool bottleneck;
- Kafka rebalance;
- downstream rate limit;
- lock serialization;
- GC overhead;
- CPU throttling;
- autoscaling warmup;
- connection leak.

Langkah:

```text
1. Cek request rate, duration, error.
2. Cek worker/executor queue.
3. Cek connection pool.
4. Cek CPU/throttling.
5. Cek GC.
6. Cek dependency metrics.
7. Cek JFR thread/lock/socket events.
```

---

### 23.5 Deadlock / stuck request

Langkah:

```text
1. Ambil 3-5 thread dump.
2. Cari Java deadlock report.
3. Cari thread stuck stack sama.
4. Cari BLOCKED pada monitor sama.
5. Cari WAITING future/get/latch/semaphore.
6. Korelasi dengan request log/trace.
```

Command:

```bash
for i in 1 2 3 4 5; do
  jcmd <pid> Thread.print -l > /tmp/threads-$i.txt
  sleep 5
done
```

---

### 23.6 Connection pool exhaustion

Gejala:

```text
HTTP request pending
DB pool active=max
pending acquisition naik
CPU rendah
thread dump WAITING/TIMED_WAITING di pool acquire
```

Penyebab:

- slow query;
- transaction terlalu panjang;
- connection leak;
- pool terlalu kecil;
- traffic spike;
- N+1 query;
- blocking downstream di dalam transaction;
- deadlock DB.

Evidence:

- Hikari metrics;
- thread dump;
- DB slow query;
- transaction logs;
- JFR socket/block events;
- trace span DB.

Fix:

- close resource;
- reduce transaction scope;
- optimize query;
- increase pool hanya jika DB mampu;
- bulkhead;
- timeout;
- backpressure.

---

## 24. Profiling Methodology: Cara Tidak Tertipu Data

### 24.1 Jangan profiling workload palsu

Profile harus merepresentasikan workload nyata.

Buruk:

```text
profile endpoint dengan 10 rows,
padahal production 10.000 rows.
```

Buruk:

```text
benchmark local tanpa TLS/network,
padahal production bottleneck ada di TLS handshaking.
```

Bagus:

```text
replay sample traffic shape,
include payload size,
include concurrency,
include dependency latency,
measure warm JVM.
```

---

### 24.2 Warmup

JVM butuh warmup:

- class loading;
- JIT compilation;
- profile data collection;
- code cache;
- framework initialization;
- connection pool warmup;
- cache warmup.

Profile terlalu awal bisa dominan startup, bukan steady state.

Namun startup profiling juga valid jika problemnya startup.

Pisahkan:

```text
startup profile
warmup profile
steady-state profile
incident profile
```

---

### 24.3 Correlation beats single metric

Single metric bisa menipu.

Contoh:

```text
CPU tinggi
```

Belum tentu root cause. Bisa karena:

- business traffic naik;
- GC churn;
- retry storm;
- logging storm;
- crypto/compression;
- hot loop bug;
- CPU throttling membuat observed behavior aneh.

Butuh correlation:

```text
CPU + request rate + latency + GC + allocation + trace + log + deployment event
```

---

### 24.4 Optimization discipline

Urutan:

```text
1. Define problem.
2. Measure baseline.
3. Form hypothesis.
4. Collect evidence.
5. Change one variable.
6. Measure again.
7. Validate side effects.
8. Add regression guard.
```

Jangan tuning JVM flag acak.

Jangan mengganti GC tanpa memahami allocation/live-set/latency goal.

Jangan rewrite code sebelum tahu hot path.

---

## 25. Custom JFR Events untuk Domain Observability

Custom JFR event cocok untuk high-value internal event yang ingin dikorelasikan dengan JVM timeline.

Contoh:

```java
import jdk.jfr.Category;
import jdk.jfr.Event;
import jdk.jfr.Label;

@Category({"ACEAS", "Case"})
@Label("Case Command")
public class CaseCommandEvent extends Event {
    @Label("Command Type")
    String commandType;

    @Label("Result")
    String result;

    @Label("Reason")
    String reason;

    @Label("State Before")
    String stateBefore;

    @Label("State After")
    String stateAfter;
}
```

Usage:

```java
CaseCommandEvent event = new CaseCommandEvent();
event.commandType = command.type();
event.stateBefore = currentState.name();

event.begin();
try {
    TransitionResult result = transition(command);
    event.result = result.status().name();
    event.reason = result.reasonCode();
    event.stateAfter = result.stateAfter().name();
} finally {
    event.end();
    if (event.shouldCommit()) {
        event.commit();
    }
}
```

Gunakan `shouldCommit()` untuk menghindari kerja mahal jika event tidak aktif.

Custom JFR event berguna untuk:

- command lifecycle;
- state transition;
- validation phase;
- policy evaluation;
- escalation logic;
- batch processing;
- retry decision;
- idempotency conflict;
- external integration call dengan domain context.

Jangan masukkan PII/payload besar.

---

## 26. Security dan Privacy dalam Observability

Observability bisa menjadi sumber kebocoran data.

Data yang harus hati-hati:

- password;
- token;
- session id;
- API key;
- PII;
- alamat;
- nomor identitas;
- dokumen;
- payload case sensitif;
- cryptographic material;
- database connection string;
- internal network topology;
- stack trace yang mengekspos path/sensitive class.

Guideline:

```text
1. Redact secrets.
2. Jangan log raw request/response by default.
3. Hash atau tokenize identifier jika perlu.
4. Batasi retention.
5. Batasi akses dashboard/log.
6. Enkripsi storage observability.
7. Audit akses incident artifacts seperti heap dump/JFR.
8. Treat heap dump as sensitive data.
```

Heap dump bisa mengandung seluruh object graph termasuk secrets. JFR juga bisa mengandung command line, env-ish info, paths, stack traces, event payload.

---

## 27. Observability Design untuk Case Management / Regulatory System

Untuk domain enforcement/case management, observability harus mendukung:

- auditability;
- explainability;
- regulatory defensibility;
- state transition traceability;
- escalation reasoning;
- SLA tracking;
- operator action accountability;
- integration failure traceability.

### 27.1 Domain metrics

```text
case.created.count{channel}
case.transition.count{from,to,result}
case.transition.duration{from,to,result}
case.escalation.count{policy,result}
case.assignment.count{team,method}
case.reopen.count{reason}
case.sla.breach.count{caseType,severity}
case.integration.failure.count{system,reason,retryable}
```

### 27.2 Domain logs

```json
{
  "event": "case.transition.applied",
  "caseId": "CASE-123",
  "commandId": "CMD-999",
  "fromState": "SUBMITTED",
  "toState": "UNDER_REVIEW",
  "actorRole": "OFFICER",
  "policyVersion": "2026-06-01",
  "correlationId": "...",
  "traceId": "..."
}
```

### 27.3 Domain trace spans

```text
case.transition
  load-case
  validate-transition-policy
  evaluate-escalation
  persist-transition
  append-audit-log
  publish-domain-event
  send-notification
```

### 27.4 Domain JFR event

Use custom JFR event for hot production diagnosis:

```text
CaseTransitionEvent duration overlaps with:
  DB query event
  socket write event
  GC pause event
  allocation spike
  lock contention
```

Ini memberi kemampuan menjawab:

> Apakah transisi case lambat karena policy evaluation, DB, notification, serialization, atau JVM runtime event?

---

## 28. Dashboard Minimal untuk Java Service

### 28.1 Service dashboard

Panel:

```text
Request rate by route
Error rate by route/status
Latency p50/p95/p99 by route
Top slow routes
Dependency latency
```

### 28.2 JVM dashboard

Panel:

```text
Heap used/max
Non-heap memory
GC pause count/duration
Allocation rate
Thread count
Class loaded
CPU process/system
File descriptors
```

### 28.3 Resource dashboard

Panel:

```text
Container CPU usage
CPU throttling
RSS memory
Network I/O
Disk I/O
Pod restarts
OOMKilled count
```

### 28.4 Dependency dashboard

Panel:

```text
DB pool active/idle/pending
DB query latency
Kafka consumer lag
Kafka producer latency/error
Redis latency/error
Downstream HTTP latency/error
```

### 28.5 Business dashboard

Panel:

```text
Cases created
Cases transitioned
Cases pending by state
SLA breaches
Escalation count
Failed integrations
Retry queue size
DLQ count
```

---

## 29. Alerting Principles

Bad alert:

```text
Heap > 80%
```

Why bad:

- JVM heap naturally uses memory;
- GC may reclaim;
- no user impact;
- noisy.

Better:

```text
Old-gen after-GC usage increasing for 30 min
AND GC pause p99 > threshold
AND available heap < threshold
```

Bad alert:

```text
CPU > 80%
```

Maybe valid for capacity, but not necessarily urgent.

Better:

```text
CPU > 85%
AND p95 latency > SLO
AND request rate not abnormally low
```

Alert should be:

- actionable;
- low noise;
- tied to user impact or imminent risk;
- include runbook link;
- include suspected subsystem;
- include dashboard/JFR instructions if relevant.

---

## 30. Anti-Pattern Observability

### 30.1 Logging as only observability

Logs are not enough.

Without metrics, you cannot see trend.

Without traces, you cannot see cross-service latency.

Without profiles, you cannot see CPU/allocation hot path.

Without dumps, you cannot inspect retained object graph.

---

### 30.2 Dashboard without hypothesis

Dashboard banyak bukan berarti observable.

Pertanyaan yang harus dijawab dashboard:

```text
Apakah user impact terjadi?
Subsystem mana yang abnormal?
Apakah issue resource, dependency, runtime, atau domain?
Apa drill-down berikutnya?
```

Jika dashboard hanya penuh grafik tanpa decision path, itu dekorasi.

---

### 30.3 High cardinality everywhere

Metric label dengan `userId`, `caseId`, atau raw URL dapat menyebabkan cardinality explosion.

Solusi:

- bounded labels;
- exemplars untuk trace correlation;
- logs/traces untuk entity-specific investigation;
- domain dashboards untuk aggregate.

---

### 30.4 Profiling too late

Jika JFR tidak bisa diaktifkan atau image tidak punya tool saat incident, evidence hilang.

Mitigasi:

- continuous JFR ring buffer;
- production-ready debug access;
- standard runbook;
- safe artifact export;
- alert-to-record automation bila sesuai.

---

### 30.5 Tuning without baseline

Buruk:

```text
Latency naik -> ganti GC -> deploy -> latency turun sedikit -> declare success
```

Mungkin latency turun karena traffic turun.

Harus ada:

- baseline;
- controlled comparison;
- same workload;
- before/after profile;
- rollback criteria.

---

## 31. Practical Labs

### Lab 1 — Thread dump reading

Buat program:

- satu deadlock;
- satu thread pool starvation;
- satu thread sleep;
- satu blocking queue wait.

Ambil thread dump:

```bash
jcmd <pid> Thread.print -l
```

Tugas:

- identifikasi state setiap thread;
- cari lock owner;
- cari waiting chain;
- tulis diagnosis.

---

### Lab 2 — Heap leak simulation

Buat static cache:

```java
static final Map<String, byte[]> CACHE = new ConcurrentHashMap<>();
```

Tambahkan 1 MB setiap request.

Observasi:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /tmp/leak.hprof
```

Tugas:

- lihat `byte[]` count;
- analisis dominator tree;
- temukan retention path;
- fix dengan bounded cache.

---

### Lab 3 — Allocation churn

Buat endpoint yang melakukan mapping besar berulang.

Record JFR:

```bash
jcmd <pid> JFR.start name=alloc settings=profile duration=3m filename=/tmp/alloc.jfr
```

Tugas:

- cari allocation hotspot;
- bedakan allocation churn vs leak;
- optimasi batch/projection;
- ukur ulang.

---

### Lab 4 — CPU hot path

Buat regex buruk:

```java
Pattern.compile("(a+)+b").matcher(input).matches();
```

Input panjang tanpa `b`.

Record CPU profile.

Tugas:

- temukan regex hot path;
- fix pattern;
- tambah input limit;
- ukur ulang.

---

### Lab 5 — Custom JFR event

Tambahkan custom event pada command handler.

Tugas:

- record event;
- lihat event di JMC/`jfr print`;
- korelasikan dengan socket/DB/GC event;
- pastikan payload aman.

---

## 32. Mini Project — Java Incident Lab

Bangun service kecil:

```text
incident-lab/
  src/main/java/
    app/
      IncidentLabApplication.java
      CpuController.java
      MemoryController.java
      ThreadController.java
      IoController.java
      CaseController.java
      jfr/CaseTransitionEvent.java
```

Endpoint:

```text
/cpu/regex
/cpu/serialization
/memory/leak
/memory/churn
/thread/deadlock
/thread/starvation
/io/slow
/case/transition
```

Requirement:

1. Semua endpoint punya metric, log, dan trace.
2. Case transition punya custom JFR event.
3. Sediakan script:

```text
scripts/start-jfr.sh
scripts/dump-threads.sh
scripts/heap-histo.sh
scripts/heap-dump.sh
scripts/nmt-summary.sh
```

4. Sediakan runbook:

```text
runbooks/high-cpu.md
runbooks/high-memory.md
runbooks/latency-spike.md
runbooks/deadlock.md
runbooks/thread-starvation.md
```

5. Untuk setiap incident, tulis laporan:

```text
symptom
hypothesis
evidence
diagnosis
fix
verification
regression guard
```

Tujuan mini project:

> Melatih muscle memory diagnosis, bukan hanya membaca teori.

---

## 33. Checklist Engineer Java Top-Tier untuk Observability

### 33.1 Saat membuat fitur baru

- Apakah request punya metric rate/error/duration?
- Apakah error punya reason code?
- Apakah log punya correlation ID?
- Apakah trace span cukup meaningful?
- Apakah dependency call punya timeout?
- Apakah retry terukur?
- Apakah business transition punya audit?
- Apakah high-cardinality label dihindari?
- Apakah payload sensitif tidak masuk log?
- Apakah slow path bisa didiagnosis?

### 33.2 Saat review code

- Apakah exception ditelan?
- Apakah log duplicate?
- Apakah log terlalu noisy?
- Apakah metric label bounded?
- Apakah thread pool punya metrics?
- Apakah queue punya size/lag metric?
- Apakah cache punya size/hit/miss/eviction metric?
- Apakah batch punya progress/error metric?
- Apakah resource close terlihat?
- Apakah timeout/cancellation jelas?

### 33.3 Saat production incident

- Jangan langsung restart kecuali perlu mitigasi.
- Ambil evidence sebelum hilang.
- Catat timestamp absolut.
- Korelasi dengan deploy/config/traffic.
- Ambil JFR jika runtime problem tidak jelas.
- Ambil thread dump jika stuck/starvation/deadlock.
- Ambil histogram sebelum heap dump jika memory issue.
- Bedakan heap OOM vs container OOMKilled.
- Hindari command mahal tanpa alasan.
- Tulis diagnosis berbasis bukti.

---

## 34. Decision Framework Cepat

```text
Symptom: high CPU
  -> JFR CPU profile
  -> GC correlation
  -> hot method analysis

Symptom: high latency, CPU low
  -> trace
  -> thread dump
  -> JFR socket/lock/thread park events
  -> pool metrics

Symptom: memory grows
  -> heap vs RSS
  -> GC heap info
  -> class histogram
  -> heap dump/NMT

Symptom: pod OOMKilled
  -> container memory metrics
  -> heap max vs RSS
  -> NMT if possible
  -> direct buffer/thread/metaspace

Symptom: stuck requests
  -> repeated thread dumps
  -> trace incomplete span
  -> executor/pool metrics

Symptom: GC pauses
  -> GC log + JFR
  -> allocation rate
  -> live set
  -> humongous/full GC

Symptom: startup slow
  -> JFR startup recording
  -> method timing <clinit>
  -> class loading/JIT/dependency init
```

---

## 35. Sumber Resmi dan Bacaan Lanjutan

- Oracle Java SE 25 Documentation: <https://docs.oracle.com/en/java/javase/25/>
- Oracle Java SE 25 Troubleshooting Guide: <https://docs.oracle.com/en/java/javase/25/troubleshoot/>
- Oracle Java SE 25 `jcmd` command: <https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html>
- Oracle Java SE 25 `jfr` command: <https://docs.oracle.com/en/java/javase/25/docs/specs/man/jfr.html>
- Java SE 25 API `jdk.jfr`: <https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/jdk/jfr/package-summary.html>
- Java SE 25 API `jdk.jfr.consumer`: <https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/jdk/jfr/consumer/package-summary.html>
- OpenJDK JDK 25 Project: <https://openjdk.org/projects/jdk/25/>
- JEP 509 — JFR CPU-Time Profiling: <https://openjdk.org/jeps/509>
- JEP 518 — JFR Cooperative Sampling: <https://openjdk.org/jeps/518>
- JEP 520 — JFR Method Timing & Tracing: <https://openjdk.org/jeps/520>
- Java Flight Recorder API Programmer's Guide: <https://docs.oracle.com/en/java/javase/25/jfapi/>
- JDK Mission Control: <https://www.oracle.com/java/technologies/jdk-mission-control.html>

---

## 36. Ringkasan Inti

Observability Java yang matang bukan sekadar “punya log”.

Kamu perlu memahami:

```text
metrics -> trend dan alert
logs    -> event detail
traces  -> request/dependency flow
profiles-> resource hot path
dumps   -> snapshot state
events  -> JVM/domain timeline
```

JVM memberi tool yang sangat kuat:

```text
jcmd
jfr
jstack
jmap
jstat
JFR API
JMC
NMT
GC log
```

Java 25 memperkuat area ini lewat:

```text
JFR CPU-Time Profiling
JFR Cooperative Sampling
JFR Method Timing & Tracing
```

Engineer Java yang kuat tidak menebak. Ia mengumpulkan bukti, membuat hipotesis, membuktikan atau membantahnya, lalu memperbaiki root cause dengan guard agar tidak regresi.

Itulah perbedaan antara “operator yang restart service” dan “engineer yang memahami sistem”.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-013.md">⬅️ Learn Java Part 013 — Memory Management dan Garbage Collection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../index.md">🏠 Home</a>
<a href="./learn-java-part-015.md">Learn Java Part 015 — Security, Cryptography, dan Integrity di Java hingga Java 25 ➡️</a>
</div>
