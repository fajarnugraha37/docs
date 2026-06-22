# Part 20 — JFR Deep Dive I: Java Flight Recorder Mental Model

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> File: `20-jfr-deep-dive-java-flight-recorder-mental-model.md`  
> Scope: Java 8 sampai Java 25  
> Fokus: JFR sebagai runtime evidence, production profiler, diagnostic recorder, dan JVM observability substrate.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membangun fondasi:

1. logging sebagai runtime evidence,
2. SLF4J, Logback, Log4j2,
3. structured logging,
4. context propagation,
5. correlation ID dan trace identity,
6. OpenTelemetry,
7. metrics engineering,
8. secure logging,
9. exception/error taxonomy.

Sekarang kita masuk ke lapisan yang lebih dekat ke JVM: **Java Flight Recorder**, atau JFR.

JFR bukan sekadar profiler GUI. JFR adalah mekanisme JVM untuk merekam event runtime secara efisien: allocation, thread, lock, GC, compilation, socket, file I/O, exception, method sampling, safepoint, class loading, container information, dan event lain yang datang dari JVM, JDK, OS, atau aplikasi.

Mental model yang benar:

```text
Logs       = cerita aplikasi yang sengaja ditulis oleh engineer
Metrics    = agregasi numerik perilaku runtime
Traces     = graph eksekusi request/workflow lintas boundary
Profiles   = distribusi waktu/alokasi/lock berdasarkan stack
Dumps      = snapshot state pada titik waktu tertentu
JFR        = event recorder JVM yang menyimpan banyak evidence runtime dalam timeline
```

JFR berada di antara profiler, event log, dan JVM black box recorder.

---

## 1. Apa Itu JFR?

**Java Flight Recorder** adalah framework observability, monitoring, profiling, dan diagnostics yang built-in di HotSpot JVM.

Secara konsep, JFR merekam **event**. Event dapat berasal dari:

1. JVM,
2. JDK libraries,
3. operating system,
4. application custom events.

Satu event biasanya memiliki:

1. timestamp,
2. duration, jika event berdurasi,
3. thread,
4. stack trace, jika dikonfigurasi,
5. event-specific payload.

Contoh event:

```text
jdk.GarbageCollection
jdk.CPULoad
jdk.JavaMonitorEnter
jdk.ThreadPark
jdk.SocketRead
jdk.SocketWrite
jdk.FileRead
jdk.FileWrite
jdk.ExecutionSample
jdk.ObjectAllocationInNewTLAB
jdk.ObjectAllocationOutsideTLAB
jdk.ExceptionThrown
jdk.ClassLoad
jdk.ThreadStart
jdk.ThreadEnd
```

Cara berpikirnya:

```text
JFR = timeline event JVM + sampling profile + diagnostic metadata
```

Bukan:

```text
JFR = pengganti logging
JFR = hanya untuk local profiling
JFR = hanya dipakai setelah aplikasi mati
```

JFR sangat cocok untuk pertanyaan seperti:

1. Kenapa latency naik?
2. Thread banyak park/block di mana?
3. Allocation rate tinggi dari method mana?
4. GC cycle terjadi kapan dan berapa lama?
5. Lock contention terjadi di object/class apa?
6. Socket read/write lambat ke dependency mana?
7. File I/O terjadi dari stack mana?
8. Exception thrown terlalu banyak dari path mana?
9. CPU dihabiskan oleh business logic, framework, GC, JIT, crypto, serialization, logging, atau driver?
10. Apakah problem terjadi sebelum atau setelah deploy/config change?

---

## 2. Kenapa JFR Penting Untuk Engineer Level Tinggi?

Top-tier engineer tidak hanya menebak dari log.

Mereka tahu bahwa log punya kelemahan:

1. log hanya mencatat hal yang sengaja ditulis,
2. log bisa terlalu noisy,
3. log bisa tidak cukup granular,
4. log bisa hilang karena async queue/drop/rotation,
5. log bisa tidak mengandung stack runtime,
6. log sering tidak menjelaskan CPU/allocation/lock/GC.

JFR mengisi blind spot ini.

Contoh:

```text
Symptom:
  API /submit-case latency naik dari p95 400ms menjadi p95 8s.

Logs:
  request started
  request completed
  dependency timeout

Metrics:
  latency up
  Hikari active connections high
  GC pause slightly up

Trace:
  DB span slow

JFR:
  many threads blocked in oracle.jdbc driver
  high allocation in JSON serialization
  monitor contention in custom mapper cache
  socket read waits align with DB span
  GC pauses are consequence, not root cause
```

JFR membantu membedakan:

```text
Root cause vs symptom
CPU-bound vs IO-bound
Heap pressure vs allocation burst
Thread starvation vs lock contention
DB slowness vs connection pool starvation
GC cause vs GC consequence
```

---

## 3. JFR vs Logs vs Metrics vs Traces vs Profilers

### 3.1 JFR vs Logs

Log adalah event aplikasi eksplisit.

JFR adalah event runtime yang bisa muncul tanpa kita menulis log.

```text
Log:
  "case submitted" outcome=success case.id=123

JFR:
  Thread parked 180ms
  Socket read 3.2s
  Object allocation 12MB/s
  GC pause 42ms
  Monitor enter blocked 900ms
```

Log menjelaskan niat aplikasi. JFR menjelaskan perilaku runtime.

### 3.2 JFR vs Metrics

Metrics adalah agregasi.

JFR adalah timeline event dengan detail.

```text
Metric:
  jvm.gc.pause p95 = 220ms

JFR:
  GC pause at 10:22:05.123 duration=218ms cause=G1 Evacuation Pause
  allocation pressure mostly from com.example.mapper.JsonMapper
```

Metric memberi alarm. JFR memberi bukti diagnosis.

### 3.3 JFR vs Traces

Trace menjelaskan execution graph request/workflow.

JFR menjelaskan JVM-level behavior selama request itu berjalan.

```text
Trace:
  HTTP SERVER span 8s
  DB CLIENT span 7.2s

JFR:
  socket read 7.1s
  thread parked waiting for pool
  lock contention in retry limiter
```

Trace memberi causality lintas service. JFR memberi local runtime physics.

### 3.4 JFR vs async-profiler

Async-profiler sangat kuat untuk profiling CPU/allocation/lock/native.

JFR lebih luas sebagai event timeline JVM.

```text
async-profiler:
  best for flame graph, CPU hotspot, allocation hotspot, lock profiling

JFR:
  best for timeline, JVM events, GC, threads, IO, exceptions, compilation, custom events
```

Keduanya bukan musuh. Keduanya saling melengkapi.

Praktik kuat:

```text
Use metrics to detect.
Use traces to localize.
Use logs to understand semantic context.
Use JFR to inspect JVM runtime timeline.
Use async-profiler to deep dive hotspots.
Use dumps when state snapshot is needed.
```

---

## 4. Evolusi JFR Dari Java 8 Sampai Java 25

### 4.1 Java 8

Pada Java 8 Oracle JDK lama, JFR historisnya terkait fitur komersial Oracle. Namun distribusi modern seperti Red Hat build of OpenJDK 8 menyediakan JFR support tersendiri.

Di Java 8 environment enterprise, jangan berasumsi JFR selalu tersedia. Verifikasi:

```bash
java -version
jcmd <pid> help | grep JFR
```

Atau:

```bash
jcmd <pid> JFR.check
```

Jika command JFR tidak tersedia, pilihan lain:

1. upgrade runtime,
2. pakai vendor JDK yang menyediakan JFR,
3. gunakan async-profiler,
4. gunakan JMX/metrics/logging fallback.

### 4.2 Java 11+

JFR menjadi bagian OpenJDK sejak JDK 11 melalui JEP 328. Ini mengubah JFR menjadi tool standar yang bisa dipakai luas di produksi.

JDK 11+ adalah baseline nyaman untuk JFR production practice.

### 4.3 Java 17

Java 17 banyak dipakai sebagai LTS enterprise. JFR stabil dan sangat berguna untuk observability produksi.

Common use:

```bash
jcmd <pid> JFR.start name=profile settings=profile duration=120s filename=/tmp/app.jfr
```

### 4.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Ini membuat thread observability berubah.

JFR menjadi sangat penting karena:

1. jumlah virtual threads bisa jauh lebih besar dari platform threads,
2. thread dump tradisional bisa terlalu besar/noisy,
3. event seperti virtual thread start/end/park/pin menjadi relevan,
4. blocking behavior harus dibaca dengan model baru.

### 4.5 Java 25

Java 25 melanjutkan arah modern runtime observability. Module `jdk.jfr` mendefinisikan API untuk membuat event dan mengontrol Flight Recorder, termasuk package `jdk.jfr` dan `jdk.jfr.consumer`.

Untuk seri ini, target kompetensi adalah:

```text
Java 8  : tahu keterbatasan dan fallback
Java 11 : mampu menjalankan JFR standar
Java 17 : mampu production troubleshooting dengan JFR
Java 21 : mampu membaca virtual-thread related runtime behavior
Java 25 : mampu memahami JFR sebagai API/event framework modern
```

---

## 5. Mental Model: JFR Sebagai Black Box Recorder JVM

Analoginya seperti flight recorder pesawat.

Saat incident terjadi, kita tidak ingin hanya bertanya:

```text
"Ada log error apa?"
```

Kita ingin bertanya:

```text
"Apa yang JVM alami 5 menit sebelum, selama, dan setelah incident?"
```

JFR membantu menjawab:

1. CPU load naik dulu atau latency naik dulu?
2. GC pressure naik sebelum error atau sesudah error?
3. thread blocking terjadi di pool, lock, socket, atau file I/O?
4. exception storm terjadi sebelum request timeout?
5. JIT compilation terjadi saat warmup traffic?
6. allocation burst terjadi dari serializer, mapper, regex, logging, ORM, atau cache?
7. apakah problem hanya satu instance atau semua instance?

### 5.1 Timeline Thinking

JFR harus dibaca sebagai timeline.

```text
10:00:00 deploy version 1.8.3
10:03:10 traffic rises
10:03:30 allocation rate doubles
10:03:40 GC concurrent cycle starts more often
10:04:00 DB socket read duration rises
10:04:05 Hikari wait rises
10:04:08 request latency p95 spikes
10:04:12 error logs appear
```

Tanpa timeline, engineer mudah salah menyimpulkan.

Contoh kesalahan:

```text
ERROR logs muncul setelah GC pause.
Maka GC dianggap root cause.
```

Padahal bisa saja:

```text
DB latency naik -> thread menunggu -> request menumpuk -> allocation naik -> GC naik -> error muncul.
```

JFR membantu menyusun urutan evidence.

---

## 6. Event Model JFR

### 6.1 Event Adalah Fakta Runtime

Event JFR bukan log string.

Event punya struktur.

Contoh konseptual:

```text
Event: jdk.SocketRead
Start Time: 2026-06-18T10:15:21.123
Duration: 3.42s
Thread: http-nio-8080-exec-42
Host: db.example.internal
Port: 1521
Bytes Read: 8192
Stack Trace:
  oracle.jdbc.driver.T4CMAREngineNIO.readNBytes(...)
  oracle.jdbc.driver.T4CMAREngine.unmarshalUB1(...)
  ...
```

Ini jauh lebih kuat daripada log:

```text
WARN db slow
```

### 6.2 Event Punya Biaya

Tidak semua event murah.

Event yang sangat murah bisa aktif sering. Event yang lebih mahal biasanya punya threshold atau sampling.

Cost tergantung:

1. frekuensi event,
2. apakah stack trace direkam,
3. threshold durasi,
4. jumlah thread,
5. volume allocation,
6. apakah event custom terlalu sering,
7. konfigurasi recording.

Mental model:

```text
JFR overhead rendah bukan berarti semua event bisa dinyalakan tanpa batas.
```

### 6.3 Event Categories

Secara praktis, event JFR bisa dikelompokkan:

```text
Execution:
  jdk.ExecutionSample
  jdk.NativeMethodSample

Memory:
  jdk.ObjectAllocationInNewTLAB
  jdk.ObjectAllocationOutsideTLAB
  jdk.OldObjectSample
  jdk.GCHeapSummary

GC:
  jdk.GarbageCollection
  jdk.GCPhasePause
  jdk.PromotionFailed
  jdk.EvacuationFailed

Threading:
  jdk.ThreadStart
  jdk.ThreadEnd
  jdk.ThreadSleep
  jdk.ThreadPark
  jdk.JavaMonitorEnter
  jdk.JavaMonitorWait

IO:
  jdk.SocketRead
  jdk.SocketWrite
  jdk.FileRead
  jdk.FileWrite

Exceptions:
  jdk.ExceptionThrown
  jdk.ErrorThrown

Class loading:
  jdk.ClassLoad
  jdk.ClassUnload

Compilation:
  jdk.Compilation
  jdk.CompilerPhase

Safepoint:
  jdk.SafepointBegin
  jdk.SafepointEnd

System:
  jdk.CPULoad
  jdk.ThreadCPULoad
  jdk.PhysicalMemory
  jdk.ContainerConfiguration
```

Nama event bisa berbeda/bertambah antar versi JDK. Karena itu selalu validasi di runtime target.

---

## 7. Recording: Apa Yang Direkam dan Bagaimana

JFR recording adalah sesi perekaman.

Satu JVM bisa punya lebih dari satu recording.

Recording bisa:

1. dimulai saat JVM startup,
2. dimulai saat JVM sudah berjalan menggunakan `jcmd`,
3. dikontrol lewat JMX,
4. dikelola lewat platform seperti Cryostat,
5. dikonfigurasi untuk continuous ring buffer,
6. didump saat incident.

### 7.1 Start Recording Saat Startup

Contoh basic:

```bash
java \
  -XX:StartFlightRecording=name=app-startup,duration=120s,filename=/tmp/startup.jfr \
  -jar app.jar
```

Contoh untuk continuous recording:

```bash
java \
  -XX:StartFlightRecording=name=continuous,settings=default,dumponexit=true,filename=/tmp/app.jfr,maxage=30m,maxsize=512m \
  -jar app.jar
```

Catatan:

1. `duration` cocok untuk profiling window pendek.
2. `maxage` cocok untuk rolling window.
3. `maxsize` mencegah file/buffer tumbuh tanpa batas.
4. `dumponexit` membantu saat proses shutdown normal.
5. untuk crash tertentu, konfigurasi tambahan/error handling tetap dibutuhkan.

### 7.2 Start Recording Pada JVM Yang Sudah Berjalan

Cari PID:

```bash
jcmd
```

Start recording:

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
```

Check recording:

```bash
jcmd <pid> JFR.check
```

Dump recording:

```bash
jcmd <pid> JFR.dump name=incident filename=/tmp/incident-dump.jfr
```

Stop recording:

```bash
jcmd <pid> JFR.stop name=incident filename=/tmp/incident-final.jfr
```

### 7.3 Default vs Profile Settings

Biasanya ada dua template umum:

```text
default = overhead lebih rendah, cocok continuous/basic diagnosis
profile = lebih detail, cocok short-window profiling
```

Prinsip:

```text
Continuous recording: default, bounded, low overhead.
Incident deep dive: profile, limited duration, explicit window.
```

### 7.4 Recording Window

JFR paling berguna jika window-nya tepat.

Bad:

```bash
jcmd <pid> JFR.start duration=10s
```

Padahal incident intermittent setiap 5 menit.

Better:

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=10m filename=/tmp/incident.jfr
```

Atau continuous:

```bash
jcmd <pid> JFR.start name=continuous settings=default maxage=30m maxsize=512m
# saat incident
jcmd <pid> JFR.dump name=continuous filename=/tmp/incident-$(date +%Y%m%d-%H%M%S).jfr
```

---

## 8. JFR Operational Modes

### 8.1 On-Demand Diagnostic Recording

Dipakai saat incident sedang terjadi.

Workflow:

```text
1. Alert muncul.
2. Identify unhealthy pod/JVM.
3. Start JFR profile 2–5 menit.
4. Dump file.
5. Copy keluar host/pod.
6. Analyze dengan JMC/jfr tool.
7. Korelasikan dengan metrics/logs/traces.
```

Kelebihan:

1. overhead hanya saat dibutuhkan,
2. detail bisa tinggi,
3. cocok untuk incident aktif.

Kelemahan:

1. bisa terlambat,
2. incident bisa hilang sebelum recording dimulai,
3. butuh akses attach ke process.

### 8.2 Always-On Continuous Recording

Dipakai sebagai black box recorder.

Workflow:

```text
1. JVM selalu menjalankan recording default bounded.
2. Recording memakai maxage/maxsize.
3. Saat alert/incident, dump window terakhir.
4. Analisis periode sebelum incident.
```

Kelebihan:

1. menangkap pre-incident evidence,
2. cocok untuk intermittent issue,
3. cocok untuk production support matang.

Kelemahan:

1. butuh governance storage/security,
2. harus hati-hati event settings,
3. file berisi data sensitif runtime.

### 8.3 Startup Profiling

Dipakai untuk:

1. cold start lambat,
2. classloading berat,
3. dependency initialization lambat,
4. Spring Boot startup analysis,
5. JIT warmup behavior.

Contoh:

```bash
java \
  -XX:StartFlightRecording=name=startup,settings=profile,duration=180s,filename=/tmp/startup.jfr \
  -jar app.jar
```

### 8.4 Load Test Recording

Dipakai saat performance test.

Workflow:

```text
1. Warm up aplikasi.
2. Start JFR.
3. Run load test fixed scenario.
4. Stop JFR.
5. Compare dengan baseline.
```

Jangan mulai analisis dari run yang belum warmup kecuali memang ingin mempelajari warmup.

---

## 9. Tools Untuk Membaca JFR

### 9.1 JDK Mission Control

JDK Mission Control, atau JMC, adalah tool GUI untuk membuka dan menganalisis file `.jfr`.

JMC cocok untuk:

1. hotspot CPU,
2. allocation analysis,
3. memory pressure,
4. thread analysis,
5. lock contention,
6. GC pause,
7. IO latency,
8. exception storm,
9. event timeline.

Mental model:

```text
JFR file = raw evidence
JMC      = forensic workbench
```

### 9.2 `jfr` Command-Line Tool

JDK modern menyediakan command `jfr` untuk bekerja dengan file JFR.

Contoh:

```bash
jfr summary app.jfr
```

```bash
jfr print app.jfr
```

```bash
jfr print --events jdk.GarbageCollection app.jfr
```

```bash
jfr print --events jdk.SocketRead,jdk.SocketWrite app.jfr
```

```bash
jfr view hot-methods app.jfr
```

Command exact bisa berbeda antar versi JDK. Gunakan:

```bash
jfr help
```

### 9.3 Programmatic Consumer API

Package `jdk.jfr.consumer` memungkinkan membaca file JFR dari program Java.

Use case:

1. automated JFR analysis,
2. CI performance regression gate,
3. custom incident analyzer,
4. extraction event tertentu,
5. generating summary report.

Contoh sederhana:

```java
import jdk.jfr.consumer.RecordedEvent;
import jdk.jfr.consumer.RecordingFile;

import java.nio.file.Path;

public final class JfrExceptionCounter {
    public static void main(String[] args) throws Exception {
        Path file = Path.of(args[0]);
        long exceptions = 0;

        try (RecordingFile recording = new RecordingFile(file)) {
            while (recording.hasMoreEvents()) {
                RecordedEvent event = recording.readEvent();
                if (event.getEventType().getName().equals("jdk.ExceptionThrown")) {
                    exceptions++;
                }
            }
        }

        System.out.println("exceptions=" + exceptions);
    }
}
```

Catatan:

1. `jdk.jfr.consumer` tersedia di module `jdk.jfr`.
2. Untuk Java 9+, module awareness perlu diperhatikan.
3. Untuk Java 8, API availability tergantung distribusi/vendor.

---

## 10. Apa Yang Harus Dicari Di JFR?

Engineer sering membuka JFR lalu bingung.

Jangan mulai dari semua tab sekaligus. Mulai dari pertanyaan.

### 10.1 Jika Symptom High CPU

Cari:

1. hot methods,
2. execution samples,
3. thread CPU load,
4. GC CPU,
5. compilation activity,
6. exception storm,
7. logging/serialization hotspot,
8. regex/crypto/compression hotspot,
9. busy loop.

Pertanyaan:

```text
Apakah CPU di application code, framework, GC, JIT, native, logging, atau driver?
```

### 10.2 Jika Symptom Latency Spike

Cari:

1. socket read/write duration,
2. file read/write duration,
3. Java monitor blocked time,
4. thread park duration,
5. GC pause timeline,
6. allocation burst,
7. exception burst,
8. safepoint pauses,
9. DB/client driver stack.

Pertanyaan:

```text
Latency disebabkan CPU, IO wait, lock, pool wait, GC, atau external dependency?
```

### 10.3 Jika Symptom Memory Pressure

Cari:

1. allocation hotspots,
2. allocation rate,
3. allocation outside TLAB,
4. heap summary,
5. GC frequency,
6. old generation occupancy,
7. direct buffer events jika tersedia,
8. class loading/metaspace,
9. thread count/native thread pressure.

Pertanyaan:

```text
Apakah memory naik karena leak, burst allocation, cache growth, large payload, classloader, direct memory, atau native memory?
```

### 10.4 Jika Symptom Thread Pool Exhaustion

Cari:

1. thread park,
2. monitor enter,
3. socket read,
4. blocked threads,
5. thread count,
6. executor worker names,
7. DB driver stack,
8. queue wait via custom event/log correlation.

Pertanyaan:

```text
Thread habis karena blocking IO, lock contention, pool wait, slow downstream, atau deadlock?
```

### 10.5 Jika Symptom Error Rate Spike

Cari:

1. exception thrown count,
2. error thrown count,
3. stack trace exception dominan,
4. dependency socket issues,
5. GC/safepoint alignment,
6. CPU saturation alignment,
7. custom event/log correlation.

Pertanyaan:

```text
Error rate naik karena actual failure atau exception storm yang expected tapi terlalu mahal?
```

---

## 11. Reading JFR Dengan Causal Discipline

JFR berisi banyak event. Banyak event bukan berarti semua relevan.

Gunakan urutan ini:

```text
1. Define symptom.
2. Define time window.
3. Locate runtime phase.
4. Identify dominant resource dimension.
5. Inspect correlated events.
6. Compare with healthy baseline.
7. Form hypothesis.
8. Validate with another signal.
```

### 11.1 Define Symptom

Contoh symptom buruk:

```text
Aplikasi lambat.
```

Contoh symptom baik:

```text
POST /cases/{id}/submit p95 naik dari 600ms ke 9s pada 10:03–10:18 WIB hanya pada pod aceas-case-7d9c.
```

### 11.2 Define Time Window

Jangan analisis seluruh file tanpa window.

```text
Pre-incident : 10:00–10:03
Incident     : 10:03–10:18
Recovery     : 10:18–10:25
```

### 11.3 Identify Dominant Resource Dimension

Tanya:

```text
CPU?
Memory/allocation?
GC?
Lock?
Thread?
IO?
Exception?
JIT/classloading?
```

### 11.4 Validate With Other Signal

JFR evidence harus dikorelasikan.

```text
JFR SocketRead 7s
+ Trace DB span 7s
+ Hikari metric active=max
+ Logs show dependency timeout
= Strong dependency/pool hypothesis
```

Jika hanya satu signal:

```text
JFR menunjukkan GC pause 100ms
```

Belum cukup untuk menyimpulkan root cause latency 8s.

---

## 12. Common JFR Event Interpretations

### 12.1 Execution Sample

Execution sample menunjukkan stack yang sedang berjalan saat sample diambil.

Jika method muncul besar di hot methods:

```text
It does not always mean method is bad.
It means many samples observed there.
```

Interpretasi harus mempertimbangkan:

1. CPU time vs wall time,
2. sampling interval,
3. inlining,
4. JIT compilation,
5. native frames,
6. framework wrapper.

### 12.2 Object Allocation In New TLAB

TLAB adalah Thread Local Allocation Buffer.

Allocation in new TLAB biasanya fast path allocation.

Jika tinggi:

```text
Aplikasi banyak membuat object kecil/medium.
```

Bukan otomatis leak.

High allocation bisa menyebabkan GC pressure walaupun heap tidak leak.

### 12.3 Object Allocation Outside TLAB

Biasanya allocation lebih besar atau tidak muat di TLAB.

Perhatikan:

1. large byte arrays,
2. char arrays/string,
3. JSON/XML buffers,
4. compression buffers,
5. result set materialization,
6. file upload/download buffers.

### 12.4 Java Monitor Enter

Menunjukkan thread menunggu masuk synchronized monitor.

Jika tinggi:

```text
Potential lock contention.
```

Cari:

1. monitor class,
2. blocked duration,
3. stack trace,
4. owner thread jika tersedia,
5. apakah synchronized ada di hot path.

### 12.5 Thread Park

Thread parking bisa normal.

Contoh normal:

1. thread pool idle,
2. queue consumer waiting,
3. scheduled executor waiting,
4. ForkJoin worker waiting.

Contoh mencurigakan:

1. banyak request thread park menunggu connection pool,
2. CompletableFuture join/get blocking,
3. lock implementation park,
4. rate limiter park,
5. reactive pipeline accidentally blocking.

### 12.6 Socket Read/Write

Socket read panjang bisa berarti:

1. downstream lambat,
2. network latency,
3. server remote belum mengirim response,
4. DB query lambat,
5. TLS overhead,
6. payload besar,
7. connection stuck.

Perlu korelasi dengan:

1. trace dependency span,
2. client timeout config,
3. DB metrics,
4. load balancer metrics,
5. logs retry/timeout.

### 12.7 ExceptionThrown

Exception thrown event bisa sangat banyak bahkan jika tidak semua error user-visible.

Contoh:

1. parser menggunakan exception untuk control flow,
2. framework probing classpath,
3. optional dependency missing,
4. validation failures,
5. retry loops.

Exception storm bisa mahal karena stack trace creation.

### 12.8 GarbageCollection

GC event harus dibaca dengan konteks:

1. duration,
2. cause,
3. before/after heap,
4. allocation rate,
5. old occupancy trend,
6. concurrent cycle,
7. pause vs concurrent phase.

GC sering merupakan symptom dari allocation pressure, bukan root cause utama.

---

## 13. JFR Dan Container/Kubernetes

Di Kubernetes, JFR tetap sangat berguna, tetapi ada operational constraints.

### 13.1 Attach Ke JVM Dalam Pod

Contoh:

```bash
kubectl exec -it <pod> -- jcmd
```

Start recording:

```bash
kubectl exec -it <pod> -- \
  jcmd 1 JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
```

Copy file:

```bash
kubectl cp <namespace>/<pod>:/tmp/incident.jfr ./incident.jfr
```

Catatan:

1. PID sering `1` jika Java process adalah main container process.
2. Minimal container image mungkin tidak punya `jcmd`.
3. JRE-only image mungkin tidak cukup; butuh JDK tools.
4. SecurityContext bisa membatasi attach.
5. File system `/tmp` bisa ephemeral.
6. Pod restart akan menghapus file jika tidak dicopy.

### 13.2 Production Image Strategy

Ada beberapa strategi:

```text
Option A: include JDK tools in runtime image
  + easy troubleshooting
  - larger image

Option B: use debug/ephemeral container with tools
  + smaller app image
  - operational complexity

Option C: always-on JFR writes to mounted volume
  + captures incident window
  - storage/security governance required

Option D: use Cryostat/JMX platform
  + managed JFR fleet
  - additional platform dependency
```

Untuk sistem enterprise, pilihan realistis sering kombinasi:

```text
Production runtime image includes minimal jcmd/jfr capability
+ platform runbook for on-demand JFR
+ optional continuous JFR for critical services
```

### 13.3 CPU Throttling Dan JFR

Jika container terkena CPU throttling, JFR bisa menunjukkan CPU load, thread scheduling symptoms, dan execution samples, tetapi diagnosis final butuh cgroup/container metrics.

Korelasi:

```text
JFR: thread execution delayed / CPU busy
K8s metrics: CPU throttling high
App metrics: latency spike
Logs: timeouts
```

---

## 14. JFR Dan Virtual Threads

Virtual threads mengubah cara membaca runtime.

Di platform-thread world:

```text
one request often consumes one platform thread
thread dump size manageable
thread pool exhaustion easy to see
```

Di virtual-thread world:

```text
many logical tasks can exist as virtual threads
platform carrier threads are fewer
blocking becomes cheaper but not free
pinning can hurt scalability
traditional thread dump can be noisy
```

JFR membantu melihat:

1. virtual thread lifecycle,
2. parking behavior,
3. pinning situations,
4. blocking call patterns,
5. carrier thread utilization,
6. lock/monitor behavior.

Prinsip:

```text
Virtual threads reduce thread-pool starvation problems,
but do not eliminate downstream latency, lock contention, heap pressure, or bad timeout design.
```

JFR dengan virtual threads harus dibaca bersama:

1. traces,
2. HTTP client metrics,
3. DB pool metrics,
4. CPU/memory metrics,
5. structured logs.

---

## 15. JFR Dan Security/Privacy

File JFR bisa mengandung data sensitif.

Potential sensitive content:

1. system properties,
2. environment-related metadata,
3. command line arguments,
4. file paths,
5. hostnames,
6. socket addresses,
7. class/package names,
8. stack traces,
9. exception messages,
10. custom event payload,
11. method names yang mengandung domain sensitive wording.

Jangan perlakukan `.jfr` sebagai file aman biasa.

Production policy:

```text
1. JFR file is diagnostic evidence.
2. Access must be restricted.
3. Retention must be bounded.
4. Sharing externally requires review/sanitization.
5. Custom events must not include PII/secrets.
6. Filename and storage path must not expose sensitive case/user identifiers.
```

Contoh buruk:

```text
/tmp/case-12345-user-john-token-debug.jfr
```

Contoh lebih baik:

```text
/tmp/jfr-aceas-case-20260618T101500Z-pod7.jfr
```

---

## 16. JFR Production Runbook Dasar

### 16.1 Saat Latency Incident Aktif

```bash
# 1. cari pid
jcmd

# 2. start recording profile pendek
jcmd <pid> JFR.start name=latency settings=profile duration=180s filename=/tmp/latency.jfr

# 3. tunggu selesai atau check
jcmd <pid> JFR.check

# 4. jika perlu dump sebelum selesai
jcmd <pid> JFR.dump name=latency filename=/tmp/latency-now.jfr

# 5. copy file untuk analisis
```

Checklist analisis:

```text
[ ] Window sesuai incident?
[ ] CPU load naik?
[ ] Allocation rate naik?
[ ] GC pause signifikan?
[ ] Socket read/write lama?
[ ] Thread park/block dominan?
[ ] Monitor contention?
[ ] Exception storm?
[ ] File IO tak terduga?
[ ] Hot methods dominan?
[ ] Korelasi dengan trace/log/metric?
```

### 16.2 Saat Intermittent Incident

Gunakan continuous bounded:

```bash
jcmd <pid> JFR.start name=continuous settings=default maxage=30m maxsize=512m
```

Saat incident terjadi:

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/incident-window.jfr
```

Jangan stop continuous recording kecuali perlu.

### 16.3 Saat High CPU

```bash
jcmd <pid> JFR.start name=cpu settings=profile duration=120s filename=/tmp/cpu.jfr
```

Cari:

1. hot methods,
2. thread CPU load,
3. GC CPU,
4. exception storm,
5. compilation activity,
6. logging/JSON/regex hotspots.

### 16.4 Saat Memory Pressure

```bash
jcmd <pid> JFR.start name=memory settings=profile duration=300s filename=/tmp/memory.jfr
```

Cari:

1. allocation hotspots,
2. allocation outside TLAB,
3. GC frequency,
4. heap after GC trend,
5. old object sample jika tersedia/aktif,
6. direct buffer/native memory signal jika tersedia.

JFR bukan pengganti heap dump untuk leak definitive analysis, tetapi membantu menemukan allocation path.

### 16.5 Saat Thread/Lock Problem

```bash
jcmd <pid> JFR.start name=threads settings=profile duration=180s filename=/tmp/threads.jfr
```

Cari:

1. JavaMonitorEnter,
2. ThreadPark,
3. ThreadSleep,
4. socket read/write,
5. blocked duration,
6. thread names,
7. stack traces.

---

## 17. Common Mistakes Saat Memakai JFR

### Mistake 1 — Mulai Recording Setelah Incident Hilang

JFR tidak bisa merekam masa lalu kecuali continuous recording sudah berjalan.

Solusi:

```text
Critical services should have bounded continuous JFR or runbook to start quickly.
```

### Mistake 2 — Recording Terlalu Pendek

Jika incident periodik, 30 detik mungkin tidak cukup.

Solusi:

```text
Sesuaikan duration dengan symptom frequency.
```

### Mistake 3 — Mengaktifkan Event Terlalu Banyak Terlalu Lama

Profile settings detail bagus untuk short burst, bukan selalu-on tanpa batas.

Solusi:

```text
default for continuous, profile for incident window.
```

### Mistake 4 — Membaca Hot Method Sebagai Root Cause Otomatis

Hot method bisa hanya consequence.

Contoh:

```text
JSON serialization hot karena error response sangat banyak.
Root cause: downstream timeout causing retries and error body serialization.
```

### Mistake 5 — Mengabaikan Time Window

JFR harus dibaca berdasarkan window.

### Mistake 6 — Tidak Membandingkan Dengan Healthy Baseline

JFR paling kuat jika ada baseline.

```text
Healthy profile: allocation 300 MB/s
Incident profile: allocation 1.8 GB/s
```

### Mistake 7 — Tidak Mengamankan File JFR

JFR bukan public artifact.

---

## 18. JFR Dalam Architecture Observability Enterprise

Untuk enterprise Java system, JFR sebaiknya masuk ke standard operating model.

### 18.1 Service Template

Setiap service punya:

```text
[ ] JFR can be started by runbook
[ ] jcmd available or equivalent mechanism exists
[ ] output path writable
[ ] file copy procedure documented
[ ] retention/security policy documented
[ ] JMC/jfr analysis workflow documented
[ ] baseline JFR exists for critical workloads
```

### 18.2 Incident Response Integration

Incident runbook harus mencakup:

```text
1. Capture logs.
2. Capture metrics snapshot.
3. Capture traces examples.
4. Capture thread dump.
5. Capture JFR.
6. Capture heap dump only if memory leak/OOM evidence warrants it.
7. Capture GC logs if needed.
```

### 18.3 CI/Performance Regression

JFR bisa dipakai pada performance test:

```text
Baseline release A:
  allocation rate
  top methods
  lock contention
  socket IO
  GC pause

Candidate release B:
  compare deltas
```

Possible gates:

1. allocation rate tidak naik > X%,
2. p95 latency tidak naik > Y%,
3. exception count tidak naik drastis,
4. no unexpected file IO,
5. no new lock contention hotspot.

---

## 19. Practical Lab 1 — Rekam JFR Aplikasi Java Sederhana

Buat file:

```java
public class JfrDemoApp {
    public static void main(String[] args) throws Exception {
        while (true) {
            allocate();
            synchronizedWork();
            Thread.sleep(50);
        }
    }

    private static void allocate() {
        byte[] bytes = new byte[1024 * 256];
        bytes[0] = 1;
    }

    private static final Object LOCK = new Object();

    private static void synchronizedWork() {
        synchronized (LOCK) {
            double x = 0;
            for (int i = 0; i < 100_000; i++) {
                x += Math.sqrt(i);
            }
            if (x == -1) {
                System.out.println(x);
            }
        }
    }
}
```

Compile:

```bash
javac JfrDemoApp.java
```

Run dengan startup recording:

```bash
java -XX:StartFlightRecording=name=demo,settings=profile,duration=60s,filename=demo.jfr JfrDemoApp
```

Lihat summary:

```bash
jfr summary demo.jfr
```

Buka dengan JMC.

Cari:

1. allocation events,
2. execution samples,
3. thread sleep,
4. CPU load.

---

## 20. Practical Lab 2 — On-Demand Recording Dengan `jcmd`

Run aplikasi:

```bash
java JfrDemoApp
```

Cari PID:

```bash
jcmd
```

Start recording:

```bash
jcmd <pid> JFR.start name=demo settings=profile duration=60s filename=demo-on-demand.jfr
```

Check:

```bash
jcmd <pid> JFR.check
```

Dump manual:

```bash
jcmd <pid> JFR.dump name=demo filename=demo-dump.jfr
```

Stop:

```bash
jcmd <pid> JFR.stop name=demo filename=demo-final.jfr
```

Pertanyaan:

1. Apa perbedaan file dump vs final?
2. Event apa paling banyak?
3. Apakah stack trace tersedia?
4. Apakah duration cukup untuk melihat pattern?

---

## 21. Practical Lab 3 — Baca JFR Dengan Java Code

Gunakan consumer API:

```java
import jdk.jfr.consumer.RecordedEvent;
import jdk.jfr.consumer.RecordingFile;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

public class JfrEventSummary {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            throw new IllegalArgumentException("Usage: java JfrEventSummary <file.jfr>");
        }

        Map<String, Long> counts = new HashMap<>();

        try (RecordingFile file = new RecordingFile(Path.of(args[0]))) {
            while (file.hasMoreEvents()) {
                RecordedEvent event = file.readEvent();
                String name = event.getEventType().getName();
                counts.merge(name, 1L, Long::sum);
            }
        }

        counts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(30)
                .forEach(e -> System.out.printf("%8d  %s%n", e.getValue(), e.getKey()));
    }
}
```

Compile/run:

```bash
javac JfrEventSummary.java
java JfrEventSummary demo.jfr
```

Tujuan lab:

```text
Membiasakan bahwa JFR adalah structured event data, bukan magic GUI-only artifact.
```

---

## 22. Mini Case Study — Latency Spike Yang Salah Dituduh GC

### 22.1 Symptom

```text
POST /application/submit p95 naik dari 700ms ke 12s.
Error rate naik 2%.
GC pause terlihat naik dari 30ms ke 180ms.
Tim awal menuduh GC.
```

### 22.2 Evidence

Metrics:

```text
http.server.duration p95 high
hikaricp.connections.active maxed
jvm.gc.pause p95 moderately high
cpu usage 55%
```

Logs:

```text
WARN dependency.db.slow duration_ms=9000
ERROR application.submit.failed reason=DB_TIMEOUT
```

Traces:

```text
SERVER /application/submit 12s
CLIENT jdbc query 10.5s
```

JFR:

```text
SocketRead events 8–11s on oracle jdbc stack
ThreadPark events waiting for Hikari connection
Allocation rate high in error response serialization
GC pause increased after request backlog grew
No dominant CPU hotspot
```

### 22.3 Correct Diagnosis

GC bukan root cause.

Causal chain:

```text
DB response slow
-> request threads hold/wait connections longer
-> Hikari pool saturates
-> request backlog grows
-> more timeout/error objects allocated
-> allocation rate rises
-> GC pause increases
-> latency worsens
```

### 22.4 Fix Strategy

Mitigation:

1. reduce traffic temporarily,
2. increase DB timeout discipline,
3. fail fast after deadline,
4. reduce retry amplification,
5. tune Hikari pool only if DB can support it.

Permanent fix:

1. fix slow query/index/plan,
2. add query timeout,
3. separate pool for heavy operation,
4. add bulkhead,
5. add dependency-specific dashboard,
6. add span attribute for query category,
7. add JFR runbook for future DB latency incidents.

---

## 23. Production Checklist Untuk JFR Readiness

Service readiness:

```text
[ ] JDK distribution supports JFR.
[ ] Runtime image has `jcmd` or equivalent attach mechanism.
[ ] `jfr` command or JMC analysis path available.
[ ] JVM user permissions allow diagnostic attach.
[ ] Writable directory exists for `.jfr` files.
[ ] Kubernetes copy/export procedure documented.
[ ] Continuous recording policy decided.
[ ] On-demand recording runbook exists.
[ ] Security classification of `.jfr` files defined.
[ ] Retention policy defined.
[ ] Baseline JFR captured for major workload.
[ ] Incident responders know basic JFR interpretation.
```

Recording readiness:

```text
[ ] default settings for always-on are low overhead.
[ ] profile settings only for short windows.
[ ] maxage/maxsize configured for continuous mode.
[ ] duration configured for on-demand mode.
[ ] file naming avoids PII/secrets.
[ ] artifact storage restricted.
```

Analysis readiness:

```text
[ ] Can identify time window.
[ ] Can read hot methods.
[ ] Can inspect allocation events.
[ ] Can inspect GC events.
[ ] Can inspect thread park/block events.
[ ] Can inspect socket/file IO events.
[ ] Can correlate with logs/traces/metrics.
[ ] Can distinguish root cause from consequence.
```

---

## 24. Recommended Defaults

### 24.1 Local Development

```bash
java \
  -XX:StartFlightRecording=name=local,settings=profile,duration=120s,filename=local.jfr \
  -jar app.jar
```

### 24.2 Load Test

```bash
jcmd <pid> JFR.start name=loadtest settings=profile duration=10m filename=/tmp/loadtest.jfr
```

### 24.3 Production On-Demand

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=180s filename=/tmp/incident.jfr
```

### 24.4 Production Continuous

```bash
jcmd <pid> JFR.start name=continuous settings=default maxage=30m maxsize=512m
```

Dump when needed:

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/incident-window.jfr
```

### 24.5 JVM Startup Continuous

```bash
-XX:StartFlightRecording=name=continuous,settings=default,maxage=30m,maxsize=512m,dumponexit=true,filename=/tmp/app.jfr
```

Sesuaikan dengan policy storage/security masing-masing environment.

---

## 25. Key Takeaways

1. JFR adalah black box recorder JVM.
2. JFR merekam event runtime, bukan hanya CPU profile.
3. JFR melengkapi logs, metrics, traces, dumps, dan async-profiler.
4. JFR paling kuat jika dibaca sebagai timeline.
5. Continuous recording menangkap evidence sebelum incident.
6. On-demand recording cocok untuk incident aktif.
7. `default` cocok untuk low-overhead continuous, `profile` cocok untuk short deep dive.
8. JFR membantu membedakan CPU, IO, lock, GC, allocation, thread, exception, dan compilation issue.
9. JFR file harus dianggap sensitive diagnostic artifact.
10. Engineer yang kuat tidak hanya “bisa membuka JMC”, tetapi bisa membangun hypothesis tree dari JFR dan menghubungkannya ke logs, metrics, traces, dan production symptoms.

---

## 26. Referensi Resmi dan Bacaan Lanjutan

- Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools, Flight Recorder.
- Oracle Java SE 25 API — module `jdk.jfr`.
- dev.java — JDK Flight Recorder tutorial.
- OpenJDK JEP 328 — Flight Recorder.
- Oracle JDK Mission Control documentation.
- Red Hat OpenJDK JFR guide for Java 8/11/17 operational usage.
- OpenJDK JMC project.

---

## 27. Status Seri

Seri **belum selesai**.

Saat ini selesai sampai:

```text
Part 20 — JFR Deep Dive I: Java Flight Recorder Mental Model
```

Berikutnya:

```text
Part 21 — JFR Deep Dive II: Custom Events, Production Recording, JMC Analysis
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./19-exception-logging-and-error-taxonomy.md">⬅️ Part 19 — Exception Logging and Error Taxonomy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./21-jfr-deep-dive-custom-events-production-recording-jmc-analysis.md">Part 21 — JFR Deep Dive II: Custom Events, Production Recording, JMC Analysis ➡️</a>
</div>
