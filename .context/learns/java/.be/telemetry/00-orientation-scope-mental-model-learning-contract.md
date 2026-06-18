# learn-java-logging-observability-profiling-troubleshooting-engineering

# Bagian 0 — Orientation, Scope, Mental Model, dan Learning Contract

> Seri lanjutan untuk Java 8 sampai Java 25: logging, SLF4J, Logback, Log4j2, OpenTelemetry, profiling, JVM diagnostics, dan troubleshooting production-grade.

---

## 0. Metadata Materi

**Nama seri:** `learn-java-logging-observability-profiling-troubleshooting-engineering`  
**Bagian:** `00`  
**Judul:** `Orientation, Scope, Mental Model, dan Learning Contract`  
**Target level:** advanced menuju staff/principal/top-tier software engineer  
**Target Java:** Java 8, 11, 17, 21, 25  
**Fokus utama:** runtime evidence, diagnosability, observability, profiling, dan troubleshooting  
**Bukan fokus utama:** mengulang dasar Java, dasar concurrency, dasar JDBC, dasar HTTP, dasar security, dasar GC, atau dasar deployment yang sudah dipelajari di seri sebelumnya.

---

## 1. Kenapa Seri Ini Penting

Ada tahap dalam perjalanan engineer ketika kemampuan menulis fitur saja tidak cukup. Engineer yang lebih senior tidak hanya ditanya:

- “Bisa implement fitur ini?”
- “Bisa bikin endpoint ini?”
- “Bisa query database ini?”
- “Bisa fix bug ini?”

Tetapi mulai ditanya:

- “Kenapa production latency naik padahal CPU terlihat normal?”
- “Kenapa error hanya muncul di tenant tertentu?”
- “Kenapa request timeout tetapi tidak ada exception di service utama?”
- “Kenapa database pool penuh padahal traffic tidak naik?”
- “Kenapa heap naik pelan-pelan selama 6 jam?”
- “Kenapa trace tidak lengkap?”
- “Kenapa log banyak tetapi tidak menjawab apa pun?”
- “Kenapa retry memperparah incident?”
- “Kenapa satu perubahan kecil menyebabkan queue backlog?”
- “Apa bukti teknis bahwa root cause sudah benar?”
- “Bagaimana mencegah incident serupa, bukan hanya menutup tiket?”

Di titik ini, logging dan observability bukan sekadar fitur tambahan. Mereka adalah **sistem bukti**.

Tanpa sistem bukti yang baik, engineer hanya menebak. Dengan sistem bukti yang baik, engineer bisa melakukan diagnosis berbasis data.

Seri ini bertujuan membentuk kemampuan itu.

---

## 2. Prinsip Utama Seri Ini

Seri ini dibangun di atas satu prinsip:

> Production system harus bisa menjelaskan dirinya sendiri ketika gagal.

Bukan berarti semua masalah bisa otomatis terselesaikan. Bukan berarti semua bug bisa langsung diketahui. Tetapi sistem yang baik harus meninggalkan jejak yang cukup untuk menjawab pertanyaan penting:

1. Apa yang terjadi?
2. Kapan terjadi?
3. Di node/pod/instance mana terjadi?
4. Request atau job mana yang terdampak?
5. User, tenant, module, case, entity, atau dependency mana yang terlibat?
6. Apakah ini masalah isolated atau systemic?
7. Apakah penyebabnya aplikasi, JVM, database, network, dependency, container, atau konfigurasi?
8. Apakah error bersifat expected, unexpected, retriable, non-retriable, transient, permanent, atau data-specific?
9. Apakah mitigasi aman?
10. Apa bukti bahwa mitigasi bekerja?

Inilah perbedaan antara:

```text
"Kayaknya masalahnya di database."
```

dan:

```text
"Pada 2026-06-18 10:12–10:27 WIB, p95 latency endpoint /case/search naik dari 450ms ke 9.2s.
Trace menunjukkan 87% waktu habis di JDBC span untuk query case listing.
HikariCP active connection mencapai max 50, pending threads naik ke 180.
Thread dump menunjukkan banyak request thread WAITING pada pool acquire.
Database AWR menunjukkan query plan berubah setelah statistics refresh.
Tidak ada kenaikan CPU aplikasi, GC pause normal, dan dependency lain sehat.
Root cause paling kuat: regression query plan pada query case listing, bukan aplikasi CPU atau GC."
```

Kalimat kedua menunjukkan engineer yang bekerja dengan bukti.

---

## 3. Apa yang Akan Dipelajari

Seri ini mencakup enam domain besar.

### 3.1 Logging Engineering

Logging bukan `System.out.println()` yang lebih rapi. Logging adalah event stream yang harus didesain.

Kita akan mempelajari:

- SLF4J sebagai logging facade.
- Perbedaan API, facade, binding/provider, backend, appender, layout, encoder.
- Parameterized logging.
- Fluent logging SLF4J 2.x.
- Marker.
- MDC.
- Structured logging.
- JSON logs.
- Log levels.
- Log schema.
- Log cost model.
- Secure logging.
- Audit logging vs diagnostic logging.
- Logging dalam servlet, batch, scheduler, messaging, async flow, dan virtual threads.
- Logback dan Log4j2 secara mendalam.
- Perbandingan trade-off Logback vs Log4j2.
- Async logging dan backpressure.
- Garbage-free logging.
- Logging failure modes.

### 3.2 Observability Engineering

Observability bukan sekadar “punya dashboard”. Observability adalah kemampuan menyimpulkan internal state sistem dari external signals.

Kita akan mempelajari:

- Logs, metrics, traces.
- OpenTelemetry.
- Resource attributes.
- Semantic conventions.
- Trace context.
- Baggage.
- Auto instrumentation.
- Manual instrumentation.
- Java agent.
- Collector.
- Exporter.
- Sampling.
- Correlation antara logs, traces, metrics, dan profiles.
- Observability pipeline.
- Cardinality management.
- Cost control.
- Alerting dan SLO.

### 3.3 Profiling

Profiling menjawab pertanyaan yang tidak bisa dijawab hanya dengan log.

Kita akan mempelajari:

- CPU profiling.
- Wall-clock profiling.
- Allocation profiling.
- Lock profiling.
- Native memory profiling.
- Flame graph.
- async-profiler.
- JFR.
- Continuous profiling.
- Profiling di container/Kubernetes.
- Profiling virtual threads.
- Bias dan jebakan interpretasi profiler.

### 3.4 JVM Diagnostics

Java punya toolset diagnostik yang sangat kuat. Banyak engineer tahu namanya, tetapi tidak tahu kapan dan bagaimana menggunakannya dengan benar.

Kita akan mempelajari:

- `jcmd`
- `jstack`
- `jmap`
- `jstat`
- `jinfo`
- `jhsdb`
- Native Memory Tracking
- heap dump
- thread dump
- class histogram
- JFR recording
- GC logs
- safepoint evidence
- container-aware diagnostics

### 3.5 Troubleshooting Methodology

Troubleshooting bukan aktivitas panik. Troubleshooting adalah proses inferensi.

Kita akan mempelajari:

- Symptom vs cause.
- Blast radius.
- Timeline reconstruction.
- Hypothesis tree.
- Evidence quality.
- Differential diagnosis.
- Healthy vs unhealthy comparison.
- Regression analysis.
- Change correlation.
- Incident playbook.
- Mitigation vs permanent fix.
- Post-incident learning.

### 3.6 Production Operating Model

Engineer top-tier tidak hanya bisa debug sendiri. Ia bisa membuat sistem, standar, dan praktik yang membuat tim lebih kuat.

Kita akan mempelajari:

- Logging standard.
- Observability governance.
- Metric naming.
- Trace naming.
- Attribute governance.
- Secure logging policy.
- Runbook.
- Incident template.
- On-call checklist.
- Starter kit.
- CI validation.
- Observability review in PR.
- Production readiness review.

---

## 4. Apa yang Tidak Akan Diulang

Karena seri ini adalah lanjutan dari banyak seri Java sebelumnya, kita tidak akan mengulang detail yang sudah dipelajari kecuali relevan untuk observability/troubleshooting.

Contoh hal yang tidak akan dibahas dari nol:

- Dasar syntax Java.
- OOP dasar.
- Collection dasar.
- Stream API dasar.
- Java concurrency dasar.
- JDBC dasar.
- HTTP dasar.
- TLS/crypto dasar.
- Spring/Jakarta dasar.
- Hibernate dasar.
- MyBatis dasar.
- Flyway/Liquibase dasar.
- GC theory dari nol.
- Docker/Kubernetes dasar.
- AWS dasar.

Namun, konsep tersebut akan muncul ketika menjadi bagian dari diagnosis.

Contoh:

- Kita tidak belajar JDBC dari nol, tetapi kita akan belajar bagaimana membaca gejala `connection pool exhaustion`.
- Kita tidak belajar GC dari nol, tetapi kita akan belajar bagaimana GC log dan JFR digunakan untuk menjelaskan latency spike.
- Kita tidak belajar HTTP client dari nol, tetapi kita akan belajar bagaimana timeout, retry, pool, DNS, TLS handshake, dan dependency latency terlihat di traces/logs/metrics.
- Kita tidak belajar concurrency dari nol, tetapi kita akan belajar bagaimana thread dump, lock profiling, virtual threads, ThreadLocal, MDC, dan scoped values memengaruhi observability.

---

## 5. Mental Model Besar: Runtime Evidence Graph

Aplikasi production adalah mesin yang berjalan dalam waktu. Saat terjadi masalah, kita tidak melihat source code yang sedang “berniat” melakukan sesuatu. Kita melihat bukti:

```text
logs
metrics
traces
profiles
dumps
events
errors
alerts
deploy records
config changes
resource usage
database behavior
network behavior
queue behavior
user impact
```

Semua bukti ini membentuk graph.

```text
[User Action]
    |
    v
[HTTP Request] -- trace_id --> [Service A Span]
    |                            |
    |                            +--> [Log Event: validation passed]
    |                            +--> [Metric: request duration]
    |                            +--> [DB Span: SELECT case]
    |                            |       |
    |                            |       +--> [DB wait / slow query]
    |                            |
    |                            +--> [External API Span]
    |                                    |
    |                                    +--> [Timeout]
    |
    +--> [Error Response]
```

Saat sistem makin kompleks, graph-nya menjadi lebih besar:

```text
HTTP request
  -> service
  -> database
  -> cache
  -> message broker
  -> worker
  -> external system
  -> scheduler
  -> batch job
  -> file/object storage
  -> audit trail
  -> notification
```

Tugas engineer bukan hanya membaca satu log line. Tugas engineer adalah membangun ulang graph sebab-akibat dari bukti yang tersebar.

---

## 6. Perbedaan Logs, Metrics, Traces, Profiles, dan Dumps

### 6.1 Logs

Log adalah event diskret.

Contoh:

```json
{
  "timestamp": "2026-06-18T10:12:31.912+07:00",
  "level": "WARN",
  "service": "case-service",
  "event": "external_api_timeout",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "case_id": "CASE-2026-000123",
  "dependency": "document-service",
  "timeout_ms": 3000,
  "elapsed_ms": 3005
}
```

Log bagus untuk menjawab:

- Apa event spesifik yang terjadi?
- Context apa yang melekat pada event itu?
- Error apa yang dilempar?
- ID bisnis apa yang terlibat?
- State transition apa yang terjadi?
- Request atau job mana yang terdampak?

Log buruk untuk menjawab:

- P95 latency seluruh service selama 1 jam.
- CPU hotspot.
- Allocation hotspot.
- Lock contention.
- System-wide saturation.
- Dependency graph secara otomatis.

### 6.2 Metrics

Metric adalah angka yang berubah seiring waktu.

Contoh:

```text
http.server.request.duration{service="case-service", route="/case/search", status="200"}
hikaricp.connections.active{pool="CaseDB"}
jvm.memory.used{area="heap"}
rabbitmq.queue.messages.ready{queue="case.events"}
```

Metric bagus untuk menjawab:

- Apakah sistem sehat?
- Kapan mulai abnormal?
- Seberapa besar dampaknya?
- Apakah memburuk atau membaik?
- Apakah ada saturation?
- Apakah alert perlu menyala?

Metric buruk untuk menjawab:

- Request spesifik mana yang gagal?
- Stack trace detail.
- Payload atau business context detail.
- Urutan langkah internal sebuah request.

### 6.3 Traces

Trace adalah graph eksekusi satu request/workflow melintasi service dan dependency.

Trace bagus untuk menjawab:

- Waktu habis di mana?
- Service mana yang memanggil siapa?
- Dependency mana yang lambat?
- Apakah retry terjadi?
- Apakah request masuk ke branch tertentu?
- Apakah error terjadi di service downstream?

Trace buruk untuk menjawab:

- Semua event detail jika tidak diberi span event/log.
- Long-term trend jika tidak diubah menjadi metric.
- Masalah yang tidak ter-sample.
- Masalah yang tidak berada di jalur instrumented.

### 6.4 Profiles

Profile adalah sampling atau pengukuran runtime behavior.

Profile bagus untuk menjawab:

- CPU habis di method mana?
- Allocation paling banyak dari mana?
- Lock contention terjadi di mana?
- Thread banyak idle atau blocked?
- Wall time habis untuk sleep, IO, lock, atau compute?
- Native memory leak mungkin berasal dari mana?

Profile buruk untuk menjawab:

- User mana yang terdampak.
- Business entity mana yang gagal.
- Error message spesifik.
- Audit trail.

### 6.5 Dumps

Dump adalah snapshot.

Contoh:

- thread dump
- heap dump
- class histogram
- JFR recording dump
- native memory summary

Dump bagus untuk menjawab:

- Apa keadaan JVM pada titik waktu tertentu?
- Thread sedang menunggu apa?
- Object apa yang menahan memory?
- Classloader apa yang masih hidup?
- Lock apa yang diperebutkan?

Dump buruk jika:

- Diambil terlalu terlambat.
- Tidak ada baseline pembanding.
- Tidak dikorelasikan dengan timeline.
- Diambil hanya sekali padahal masalah temporal.

---

## 7. Top 1% Engineer Mindset

Istilah “top 1%” di sini tidak berarti hafal semua API. Yang lebih penting adalah kualitas berpikir.

### 7.1 Mereka Membedakan Symptom dan Cause

Symptom:

```text
HTTP 504 meningkat.
```

Possible causes:

```text
DB query lambat.
Connection pool penuh.
Thread pool habis.
External API timeout.
GC pause.
CPU throttling.
DNS issue.
Network packet loss.
Lock contention.
Deadlock.
Retry storm.
Queue backlog.
Downstream deployment regression.
```

Engineer biasa sering berhenti di symptom.

Engineer kuat bertanya:

```text
Apa evidence yang membedakan satu kemungkinan dari kemungkinan lain?
```

### 7.2 Mereka Tidak Percaya Satu Signal Saja

Log bisa misleading. Metric bisa terlalu agregat. Trace bisa tidak lengkap. Profile bisa bias. Dump bisa snapshot yang kebetulan.

Karena itu, diagnosis kuat biasanya memakai beberapa signal:

```text
metric -> menentukan kapan dan seberapa parah
trace  -> menentukan jalur lambat
log    -> memberi event/context/error
dump   -> memberi state JVM
profile-> memberi hotspot runtime
```

### 7.3 Mereka Berpikir dalam Timeline

Masalah production hampir selalu temporal.

Pertanyaan penting:

- Kapan mulai?
- Apa yang berubah sebelum itu?
- Apakah bertahap atau mendadak?
- Apakah membaik sendiri?
- Apakah mengikuti traffic?
- Apakah mengikuti jadwal batch?
- Apakah muncul setelah deployment?
- Apakah muncul setelah config change?
- Apakah muncul setelah data growth?
- Apakah muncul setelah dependency degradation?

### 7.4 Mereka Berpikir dalam Blast Radius

Tidak semua incident sama.

Pertanyaan:

- Semua user atau user tertentu?
- Semua tenant atau tenant tertentu?
- Semua endpoint atau endpoint tertentu?
- Semua pod atau satu pod?
- Semua AZ/node atau satu node?
- Semua database query atau query tertentu?
- Semua external API atau satu dependency?
- Semua flow atau flow setelah state tertentu?

Blast radius membantu mempersempit root cause.

### 7.5 Mereka Memiliki Bias pada Falsification

Diagnosis bagus bukan hanya mencari bukti yang mendukung hipotesis, tetapi juga mencari bukti yang bisa membantahnya.

Contoh:

Hipotesis:

```text
Latency naik karena GC.
```

Bukti yang mendukung:

```text
Ada GC pause.
```

Bukti yang membantah:

```text
GC pause hanya 50ms, tetapi request latency 8s.
P95 latency naik hanya di endpoint database-heavy.
CPU dan allocation normal.
Trace menunjukkan JDBC span 7.5s.
```

Maka GC mungkin bukan root cause utama.

### 7.6 Mereka Mendesain Sistem Agar Bisa Diinvestigasi

Mereka tidak menunggu incident baru menambah log. Mereka bertanya sejak desain:

- ID apa yang harus ada di semua log?
- Metric apa yang harus ada sebelum production?
- Span boundary mana yang penting?
- Error code apa yang membedakan failure mode?
- Bagaimana audit dan diagnostic log dipisah?
- Bagaimana redaction dilakukan?
- Bagaimana dump dikumpulkan saat incident?
- Bagaimana profiling aman dilakukan?
- Bagaimana alert dikaitkan dengan runbook?

---

## 8. Runtime Evidence Pyramid

Kita akan memakai piramida berikut sebagai model belajar:

```text
                 [Root Cause Reasoning]
                         ^
                         |
              [Correlation & Timeline]
                         ^
                         |
        [Logs] [Metrics] [Traces] [Profiles] [Dumps]
                         ^
                         |
          [Instrumentation & Runtime Configuration]
                         ^
                         |
             [Code Design & Architecture Choices]
```

Maknanya:

- Root cause reasoning tidak bisa kuat jika signal buruk.
- Signal buruk sering berasal dari instrumentation yang asal-asalan.
- Instrumentation buruk sering berasal dari code design yang tidak mempertimbangkan diagnosability.
- Jadi observability bukan hanya urusan ops, tetapi urusan architecture dan code design.

---

## 9. Java Version Scope: Java 8 sampai Java 25

Seri ini sengaja mencakup Java 8 sampai Java 25 karena real-world enterprise Java jarang seragam.

### 9.1 Java 8

Masih banyak sistem enterprise berjalan di Java 8.

Konsekuensi observability:

- SLF4J 1.x banyak ditemukan.
- Logback klasik banyak ditemukan.
- Log4j2 bisa digunakan.
- JFR pada Java 8 historically punya licensing/availability nuance tergantung distribusi dan update line.
- Tidak ada virtual threads.
- Tidak ada unified logging `-Xlog` seperti Java 9+.
- Banyak tool modern tetap bisa attach, tetapi feature set bisa berbeda.
- OpenTelemetry Java agent mendukung Java 8+.

### 9.2 Java 11

Java 11 adalah LTS penting.

Konsekuensi:

- Unified JVM logging sudah tersedia.
- JFR open dan lebih umum digunakan.
- Banyak library modern masih support Java 11.
- Observability stack lebih nyaman dibanding Java 8.

### 9.3 Java 17

Java 17 menjadi baseline modern untuk banyak framework.

Konsekuensi:

- Banyak Spring Boot 3 ecosystem bergerak ke Java 17+.
- JFR, JMC, container awareness, GC logs lebih matang.
- Strong encapsulation membuat beberapa agent/tool perlu konfigurasi ekstra jika mengakses internals.

### 9.4 Java 21

Java 21 adalah LTS besar untuk era virtual threads.

Konsekuensi:

- Virtual threads finalized.
- Structured concurrency masih preview pada beberapa rilis.
- Observability harus paham perbedaan platform thread dan virtual thread.
- Thread dump dan thread naming menjadi lebih penting.
- ThreadLocal/MDC usage perlu dievaluasi ulang.

### 9.5 Java 25

Java 25 adalah LTS setelah Java 21. JDK 25 mencapai General Availability pada 16 September 2025, dan OpenJDK menyebutnya reference implementation untuk Java SE 25. Scoped Values difinalkan melalui JEP 506 untuk berbagi immutable data dalam thread dan child threads dengan model yang lebih mudah dinalar dan lebih rendah biaya terutama bersama virtual threads/structured concurrency. Ini relevan langsung untuk context propagation, observability, dan pengganti sebagian pola ThreadLocal/MDC lama.

Konsekuensi:

- Context propagation design harus mempertimbangkan Scoped Values.
- Virtual thread observability makin penting.
- Tooling/debugging/profiling perlu diuji terhadap high-concurrency virtual-thread workload.
- Seri ini akan membedakan strategi untuk Java lama dan Java modern.

---

## 10. Core Technologies yang Akan Menjadi Tulang Punggung Seri

### 10.1 SLF4J

SLF4J adalah logging facade. Ia menyediakan API logging, tetapi backend aktualnya bisa Logback, Log4j2, JUL bridge, atau implementation lain.

Yang penting dipahami:

- SLF4J bukan “logger engine”.
- SLF4J adalah abstraction.
- SLF4J 2.x memperkenalkan fluent logging API.
- Fluent API mendukung pola seperti key-value pair.
- Backend menentukan bagaimana event akhirnya ditulis.

Contoh gaya klasik:

```java
log.info("Case {} submitted by user {}", caseId, userId);
```

Contoh gaya fluent SLF4J 2.x:

```java
log.atInfo()
   .setMessage("case_submitted")
   .addKeyValue("case.id", caseId)
   .addKeyValue("user.id", userId)
   .addKeyValue("module", "case")
   .log();
```

Perbedaan mental model:

```text
Classic message:
"Case CASE-123 submitted by user U-456"

Structured event:
event=case_submitted
case.id=CASE-123
user.id=U-456
module=case
```

Gaya kedua lebih mudah dicari, difilter, dikorelasikan, dan diolah oleh log platform.

### 10.2 Logback

Logback adalah backend logging yang sangat umum di ecosystem Spring.

Konsep penting:

- Logger
- Appender
- Layout
- Encoder
- Filter
- AsyncAppender
- MDC
- SiftingAppender
- Rolling policy
- `logback-spring.xml`

Logback cocok ketika:

- Integrasi Spring Boot diutamakan.
- Tim sudah familiar.
- Kebutuhan high-throughput async ekstrem tidak dominan.
- Konfigurasi sederhana dan stabil lebih penting.

Namun Logback tetap bisa salah pakai:

- Duplicate appenders.
- Async queue drop tanpa disadari.
- MDC leak.
- Caller data terlalu mahal.
- Rolling policy buruk.
- File logging di container tanpa strategi.
- JSON logging tidak distandarkan.

### 10.3 Log4j2

Log4j2 adalah backend logging yang kuat, terutama untuk high-throughput dan structured logging.

Konsep penting:

- Log4j API vs Core.
- SLF4J binding ke Log4j2.
- AsyncAppender vs AsyncLogger.
- Disruptor ring buffer.
- JSON Template Layout.
- Garbage-free logging.
- ThreadContext.
- RoutingAppender.
- FailoverAppender.
- Security-sensitive configuration.

Log4j2 cocok ketika:

- Throughput logging tinggi.
- Async logging menjadi concern utama.
- Structured JSON logging perlu dikontrol detail.
- Garbage reduction penting.
- Routing/failover logging lebih kompleks.

Namun Log4j2 juga memerlukan governance ketat, terutama setelah sejarah Log4Shell dan risiko appender/lookup/configuration yang tidak aman.

### 10.4 OpenTelemetry

OpenTelemetry adalah standar vendor-neutral untuk telemetry.

Konsep penting:

- Traces
- Metrics
- Logs
- Resource
- Attributes
- Semantic conventions
- Context propagation
- Instrumentation
- SDK
- Java agent
- Collector
- Exporter
- OTLP
- Sampling

OTel penting karena memungkinkan aplikasi tidak dikunci ke satu vendor observability.

Pola umum:

```text
Java Application
  -> OpenTelemetry API/SDK or Java Agent
  -> OTLP Exporter
  -> OpenTelemetry Collector
  -> Backend Observability Platform
```

### 10.5 JFR

JDK Flight Recorder adalah observability/profiling framework built-in di HotSpot JVM.

JFR sangat penting karena:

- Overhead rendah.
- Bisa digunakan production.
- Event JVM sangat kaya.
- Bisa merekam allocation, GC, thread, lock, file IO, socket IO, exceptions, method sampling, dan custom event.
- Bisa dianalisis dengan JDK Mission Control.
- Bisa di-trigger melalui `jcmd`.
- Bisa menjadi bukti kuat saat log/metric/trace tidak cukup.

### 10.6 async-profiler

async-profiler adalah profiler sampling populer untuk Java.

Ia bisa memprofil:

- CPU time.
- Java heap allocation.
- Native memory allocation/leak.
- Contended locks.
- Hardware/software counters.
- Wall-clock behavior pada skenario tertentu.
- Flame graph output.
- JFR output.

async-profiler penting karena banyak masalah performance tidak bisa ditemukan dari logs.

### 10.7 JVM Diagnostic Tools

Tool seperti `jcmd`, `jstack`, `jmap`, `jstat`, dan `jhsdb` tetap penting.

Di tangan engineer kuat, tool ini menjadi alat emergency.

Contoh:

```bash
jcmd <pid> Thread.print
jcmd <pid> GC.class_histogram
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_info
```

---

## 11. Architecture View: Dari Code ke Evidence

Salah satu cara melihat observability adalah sebagai pipeline.

```text
Application Code
  |
  | emits
  v
Logging API / Metrics API / Tracing API / JFR Events
  |
  | enriches with context
  v
Runtime Context
  - trace_id
  - span_id
  - correlation_id
  - request_id
  - user_id
  - tenant_id
  - module
  - case_id
  - thread
  - instance
  |
  v
Backend / Agent / Collector
  |
  v
Storage & Query Platform
  |
  v
Engineer Investigation
```

Jika context hilang di awal, downstream tool tidak bisa mengarangnya.

Contoh buruk:

```text
ERROR Failed to process request
java.lang.RuntimeException: timeout
```

Masalah:

- Request mana?
- User mana?
- Tenant mana?
- Endpoint mana?
- Dependency mana?
- Timeout berapa?
- Sudah retry?
- Apakah transaction rollback?
- Apakah external system menerima request?
- Apakah error expected?
- Apakah ada trace id?

Contoh lebih baik:

```json
{
  "timestamp": "2026-06-18T10:31:15.421+07:00",
  "level": "ERROR",
  "service.name": "case-service",
  "service.version": "2026.06.18-1",
  "environment": "prod",
  "event.name": "external_dependency_timeout",
  "trace_id": "f5a1f7e93e2b4576af1047169b9f62c1",
  "span_id": "938afe6b71ad4abc",
  "correlation_id": "REQ-20260618-000001",
  "http.method": "POST",
  "http.route": "/cases/{caseId}/submit",
  "case.id": "CASE-2026-000123",
  "tenant.id": "agency-a",
  "dependency.name": "document-service",
  "dependency.operation": "uploadDocument",
  "timeout.ms": 3000,
  "elapsed.ms": 3007,
  "retry.attempt": 2,
  "retry.max": 3,
  "error.type": "java.net.SocketTimeoutException",
  "error.category": "DEPENDENCY_TIMEOUT",
  "retriable": true
}
```

Log kedua tidak hanya memberi pesan. Ia memberi dimensi analisis.

---

## 12. The Observability Triangle

Salah satu model populer adalah tiga pilar observability:

```text
logs      metrics      traces
```

Namun untuk Java production engineering, tiga pilar itu belum cukup. Kita butuh versi yang lebih lengkap:

```text
logs
metrics
traces
profiles
dumps
configuration/deployment history
business state
```

Mengapa?

Karena banyak incident Java tidak bisa dijawab hanya dengan logs/metrics/traces.

Contoh:

### 12.1 High CPU

Metric menunjukkan CPU 95%.

Trace mungkin menunjukkan request lambat.

Log mungkin tidak menunjukkan error.

Yang dibutuhkan:

- CPU profile.
- JFR execution sample.
- Flame graph.
- Thread dump.
- Recent deployment diff.

### 12.2 Memory Leak

Metric menunjukkan heap naik.

Log mungkin normal.

Trace mungkin normal.

Yang dibutuhkan:

- heap dump.
- class histogram.
- allocation profile.
- GC log.
- JFR allocation event.
- retained heap analysis.

### 12.3 Lock Contention

Metric menunjukkan latency naik.

Log mungkin tidak ada error.

Trace menunjukkan span lambat tetapi tidak tahu kenapa.

Yang dibutuhkan:

- thread dump.
- JFR monitor blocked events.
- async-profiler lock profile.
- code path analysis.

### 12.4 Connection Pool Exhaustion

Metric menunjukkan Hikari pending threads naik.

Log mungkin hanya timeout.

Trace menunjukkan DB span lambat atau pool acquisition lambat.

Yang dibutuhkan:

- pool metrics.
- thread dump.
- slow query evidence.
- transaction boundary log.
- DB session view.
- code path yang lupa close resource atau transaction terlalu panjang.

---

## 13. Signal Design: Pertanyaan yang Harus Bisa Dijawab

Setiap service production-grade harus bisa menjawab pertanyaan berikut.

### 13.1 Request-Level Questions

- Request apa yang gagal?
- Siapa caller-nya?
- Endpoint apa?
- Method apa?
- Status code apa?
- Latency berapa?
- Trace id apa?
- User/tenant/module/case mana?
- Error code apa?
- Error category apa?
- Retry terjadi berapa kali?
- Dependency mana yang dipanggil?
- Apakah request idempotent?

### 13.2 Dependency-Level Questions

- Dependency mana yang lambat?
- Apakah connect timeout atau read timeout?
- Apakah pool acquire timeout?
- Apakah DNS lambat?
- Apakah TLS handshake lambat?
- Apakah response error dari downstream atau timeout di client?
- Apakah retry memperparah load?
- Apakah circuit breaker open?
- Apakah fallback dipakai?

### 13.3 Database-Level Questions

- Query mana yang lambat?
- Pool active berapa?
- Pool idle berapa?
- Pending acquire berapa?
- Transaction berapa lama?
- Lock wait terjadi?
- Deadlock terjadi?
- Apakah N+1?
- Apakah query plan berubah?
- Apakah rows scanned melonjak?
- Apakah connection leak?

### 13.4 JVM-Level Questions

- Heap usage bagaimana?
- Allocation rate bagaimana?
- GC pause berapa?
- Thread count berapa?
- Deadlock ada?
- Blocked threads ada?
- CPU hotspot apa?
- Allocation hotspot apa?
- Native memory naik?
- Direct buffer usage bagaimana?
- Classloader leak ada?

### 13.5 Business-Level Questions

- Case/application/order/payment mana yang terdampak?
- State transition terakhir apa?
- Apakah duplicate processing terjadi?
- Apakah audit trail lengkap?
- Apakah notification terkirim?
- Apakah external system menerima request?
- Apakah user bisa retry aman?
- Apakah data inconsistent?

---

## 14. Log Event Taxonomy Awal

Dalam seri ini, kita akan memakai taxonomy log berikut.

### 14.1 Technical Diagnostic Logs

Digunakan untuk developer/operator mendiagnosis sistem.

Contoh event:

```text
http_request_completed
external_api_timeout
db_connection_acquire_timeout
cache_miss
message_consume_failed
batch_chunk_failed
```

### 14.2 Business Event Logs

Merekam event domain penting.

Contoh:

```text
case_submitted
case_approved
application_rejected
appeal_created
document_uploaded
email_notification_sent
```

### 14.3 Audit Logs

Merekam tindakan yang harus defensible secara compliance.

Contoh:

```text
user_logged_in
user_viewed_sensitive_record
user_changed_case_status
admin_updated_role
system_exported_report
```

Audit log biasanya punya requirement lebih ketat:

- integrity
- immutability
- retention
- access control
- timestamp accuracy
- actor identity
- before/after state
- reason/purpose
- source IP/device if needed

### 14.4 Security Logs

Merekam signal security.

Contoh:

```text
login_failed
token_validation_failed
authorization_denied
suspicious_payload_detected
rate_limit_exceeded
signature_validation_failed
```

### 14.5 Operational Lifecycle Logs

Merekam lifecycle aplikasi.

Contoh:

```text
application_started
application_ready
configuration_loaded
database_migration_started
database_migration_completed
scheduler_started
consumer_started
shutdown_initiated
```

### 14.6 Incident-Oriented Logs

Log yang sengaja dibuat untuk investigasi failure.

Contoh:

```text
retry_attempted
circuit_breaker_opened
fallback_used
dead_letter_published
idempotency_conflict_detected
partial_failure_detected
```

---

## 15. Standar Naming Awal

Salah satu masalah besar observability adalah naming yang tidak konsisten.

Contoh buruk:

```text
caseId
case_id
case-id
case
applicationCaseId
businessCaseID
```

Seri ini akan mendorong naming konsisten.

Contoh rekomendasi:

```text
service.name
service.version
deployment.environment
trace_id
span_id
correlation_id
request_id
user.id
tenant.id
module.name
case.id
job.id
message.id
dependency.name
dependency.operation
error.type
error.category
error.code
retry.attempt
retry.max
elapsed.ms
timeout.ms
```

Catatan:

- Untuk OpenTelemetry attributes, kita akan mempertimbangkan semantic conventions.
- Untuk log schema internal, kita akan gunakan naming yang query-friendly.
- Kita akan membedakan field internal, field OTel, dan field platform-specific.

---

## 16. Error Taxonomy Awal

Error harus diklasifikasikan.

Contoh taxonomy:

```text
VALIDATION_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
NOT_FOUND
CONFLICT
STATE_TRANSITION_INVALID
IDEMPOTENCY_CONFLICT
DEPENDENCY_TIMEOUT
DEPENDENCY_ERROR
DATABASE_TIMEOUT
DATABASE_DEADLOCK
DATABASE_CONSTRAINT_VIOLATION
MESSAGE_PROCESSING_ERROR
RETRY_EXHAUSTED
RESOURCE_EXHAUSTED
RATE_LIMITED
CONFIGURATION_ERROR
PROGRAMMING_BUG
UNKNOWN_ERROR
```

Kenapa ini penting?

Karena `ERROR` level saja tidak cukup.

Dua error berikut berbeda:

```text
User memasukkan postal code invalid.
```

vs

```text
Database connection pool exhausted.
```

Yang pertama mungkin normal business validation. Yang kedua production incident.

---

## 17. Level Semantics Awal

Seri ini akan memakai aturan awal berikut.

### TRACE

Untuk detail sangat rendah yang hanya dipakai saat investigasi lokal atau targeted debugging.

Contoh:

```text
serializing field x
entering mapper y
cache key candidate generated
```

Biasanya off di production.

### DEBUG

Untuk detail diagnostic yang berguna saat troubleshooting tetapi terlalu noisy untuk default production.

Contoh:

```text
request mapped to handler
query parameters normalized
feature flag evaluated
```

Bisa dinyalakan sementara untuk package tertentu.

### INFO

Untuk event lifecycle atau business/operational event yang normal dan penting.

Contoh:

```text
application_started
case_submitted
batch_job_completed
message_consumer_started
```

INFO bukan tempat untuk semua hal.

### WARN

Untuk kondisi abnormal tetapi masih bisa ditangani.

Contoh:

```text
retry_attempted
fallback_used
external_dependency_slow
cache_unavailable_using_db
```

WARN harus actionable atau meaningful.

### ERROR

Untuk failure yang menyebabkan operasi gagal, membutuhkan perhatian, atau menunjukkan bug/incident.

Contoh:

```text
request_failed_unexpectedly
message_processing_failed_after_retries
database_connection_acquire_timeout
```

ERROR sebaiknya tidak dipakai untuk validation failure biasa yang memang expected.

---

## 18. Observability Anti-Patterns yang Akan Kita Hindari

### 18.1 Log Banyak Tetapi Tidak Berguna

Contoh:

```text
INFO start
INFO process
INFO success
ERROR failed
```

Masalah:

- Tidak ada ID.
- Tidak ada context.
- Tidak ada elapsed time.
- Tidak ada dependency.
- Tidak ada state.
- Tidak ada reason.

### 18.2 Log Message Tidak Stabil

Contoh:

```java
log.info("User {} submitted case {}", userId, caseId);
log.info("Case submitted. user={}, id={}", userId, caseId);
log.info("Submit success: {}", caseId);
```

Jika event sama punya banyak format, query jadi sulit.

Lebih baik:

```java
log.atInfo()
   .setMessage("case_submitted")
   .addKeyValue("case.id", caseId)
   .addKeyValue("user.id", userId)
   .log();
```

### 18.3 Stack Trace Berulang

Satu failure sering di-log berkali-kali di beberapa layer.

Contoh buruk:

```text
Repository logs stack trace.
Service logs same stack trace.
Controller logs same stack trace.
Global handler logs same stack trace.
```

Akibat:

- Log mahal.
- Noise tinggi.
- Error count inflated.
- Root cause tertutup.

Prinsip:

> Log exception dengan stack trace di boundary yang punya context paling lengkap.

### 18.4 Catch and Log Then Throw

Contoh buruk:

```java
try {
    repository.save(entity);
} catch (Exception e) {
    log.error("Failed to save", e);
    throw e;
}
```

Ini sering menyebabkan duplicate logs tanpa menambah context.

Lebih baik:

```java
try {
    repository.save(entity);
} catch (DataAccessException e) {
    throw new CasePersistenceException("Failed to persist case " + caseId, e);
}
```

Lalu log di boundary yang tepat.

### 18.5 Logging Sensitive Data

Contoh berbahaya:

```java
log.info("Login request body: {}", request);
log.info("Authorization header: {}", authHeader);
log.info("User token: {}", token);
```

Risiko:

- credential leak
- privacy breach
- regulatory violation
- forensic exposure
- lateral movement oleh attacker

### 18.6 Metrics Cardinality Explosion

Contoh buruk:

```text
http_request_duration{user_id="U123456", case_id="CASE-123", trace_id="..."}
```

Metric labels dengan cardinality tinggi bisa menghancurkan storage dan query performance.

### 18.7 Trace Everything Without Sampling Strategy

Trace semua request mungkin mahal. Trace terlalu sedikit mungkin kehilangan bukti. Sampling perlu didesain.

### 18.8 Profiling Tanpa Hipotesis

Profiling tanpa pertanyaan sering menghasilkan flame graph yang menarik tetapi tidak menjawab masalah.

Pertanyaan harus jelas:

- CPU tinggi karena method apa?
- Latency tinggi karena blocking atau compute?
- Allocation tinggi dari object apa?
- Lock contention di monitor mana?
- Native memory naik dari mana?

---

## 19. Cara Membaca Incident: Model 5 Lapisan

Saat ada masalah production, kita akan menggunakan model lima lapisan.

```text
Layer 1: User Impact
Layer 2: Application Behavior
Layer 3: Dependency Behavior
Layer 4: JVM Runtime Behavior
Layer 5: Infrastructure/Platform Behavior
```

### 19.1 Layer 1 — User Impact

Pertanyaan:

- Siapa terdampak?
- Fitur apa?
- Seberapa parah?
- Error visible ke user?
- Data corruption ada?
- Workaround ada?

### 19.2 Layer 2 — Application Behavior

Pertanyaan:

- Endpoint/job/message apa?
- Error category apa?
- State transition apa?
- Request path apa?
- Retry/fallback terjadi?
- Business rules berubah?

### 19.3 Layer 3 — Dependency Behavior

Pertanyaan:

- DB lambat?
- Cache gagal?
- Queue backlog?
- External API timeout?
- DNS/TLS/connectivity?
- Pool exhausted?

### 19.4 Layer 4 — JVM Runtime Behavior

Pertanyaan:

- CPU?
- Heap?
- GC?
- Threads?
- Locks?
- Allocation?
- Native memory?
- Classloader?
- Safepoint?

### 19.5 Layer 5 — Infrastructure/Platform Behavior

Pertanyaan:

- Container restart?
- CPU throttling?
- Memory limit?
- Node pressure?
- Disk full?
- Network issue?
- Load balancer?
- Deployment/config change?
- Clock skew?

---

## 20. Evidence Quality Ladder

Tidak semua bukti sama kuatnya.

```text
Weak:
- "User bilang lambat"
- "Kayaknya setelah deployment"
- "Ada error di log"

Medium:
- Metric menunjukkan p95 naik sejak jam tertentu
- Log error meningkat di endpoint tertentu
- Trace menunjukkan dependency tertentu lambat

Strong:
- Multiple independent signals konsisten
- Healthy vs unhealthy comparison jelas
- Timeline cocok dengan change/event
- Reproduction atau controlled mitigation membuktikan hipotesis
- Fix mengubah metric yang relevan
```

Root cause analysis harus mengejar strong evidence.

---

## 21. Minimum Production Observability Baseline

Setiap Java service production-grade minimal harus punya baseline berikut.

### 21.1 Application Identity

```text
service.name
service.version
deployment.environment
deployment.region
host.name / pod.name
instance.id
```

### 21.2 Request Observability

```text
request start/end
method
route
status
duration
trace_id
span_id
correlation_id
error category
```

### 21.3 Dependency Observability

```text
dependency name
operation
duration
status
timeout
retry count
circuit breaker state
```

### 21.4 JVM Metrics

```text
heap used/max
non-heap
GC count/duration
thread count
class count
buffer pools
CPU
process memory
```

### 21.5 Pool Metrics

```text
DB active/idle/pending/max
HTTP client pool leased/available/pending
executor active/queue/completed/rejected
```

### 21.6 Error Observability

```text
error.type
error.category
error.code
root cause
handled/unhandled
retriable
user-visible impact
```

### 21.7 Diagnostic Capability

```text
thread dump command
heap dump command
JFR start/dump command
profiler attach method
log level override method
config dump method
```

---

## 22. Recommended Lab Environment

Untuk mengikuti seri ini secara maksimal, siapkan lab environment.

### 22.1 Java Versions

Minimal:

```text
Java 8
Java 11
Java 17
Java 21
Java 25
```

Jika tidak semua tersedia, minimal gunakan:

```text
Java 17
Java 21
Java 25
```

Tetapi materi akan menjelaskan perbedaan Java 8/11 juga.

### 22.2 Build Tools

Gunakan salah satu atau keduanya:

```text
Maven
Gradle
```

Karena logging dependency conflict sering terlihat di build graph, kita akan banyak membaca:

```bash
mvn dependency:tree
gradle dependencies
gradle dependencyInsight
```

### 22.3 Sample Applications

Idealnya punya beberapa sample app:

```text
plain-java-logging-lab
servlet-logging-lab
spring-boot-logback-lab
spring-boot-log4j2-lab
otel-java-agent-lab
jfr-profiling-lab
troubleshooting-scenario-lab
```

Jika memakai Spring Boot, pastikan paham bahwa default logging backend biasanya Logback kecuali diganti.

### 22.4 Tools

Install/siapkan:

```text
JDK tools:
- jcmd
- jstack
- jmap
- jstat
- jinfo
- jfr

JMC:
- JDK Mission Control

Profiler:
- async-profiler

Observability:
- OpenTelemetry Java agent
- OpenTelemetry Collector
- Prometheus or compatible metrics backend
- Grafana or equivalent visualization
- log backend such as Loki/ELK/OpenSearch/Splunk/etc.
- trace backend such as Jaeger/Tempo/Zipkin/vendor APM
```

### 22.5 Container/Kubernetes Optional

Untuk bagian lanjut:

```text
Docker
Kubernetes
kubectl
ephemeral containers if available
container runtime logs
resource limits
```

---

## 23. Suggested Repository Structure

Untuk belajar efektif, buat repo seperti ini:

```text
learn-java-logging-observability-profiling-troubleshooting/
  README.md
  docs/
    00-orientation-scope-mental-model-learning-contract.md
    01-runtime-evidence-not-just-logging.md
    ...
  labs/
    plain-slf4j/
    logback-baseline/
    logback-async-json/
    log4j2-baseline/
    log4j2-async-json/
    otel-agent/
    otel-manual-instrumentation/
    jfr-custom-events/
    async-profiler/
    troubleshooting-high-cpu/
    troubleshooting-memory-leak/
    troubleshooting-pool-exhaustion/
  scripts/
    jfr/
    profiler/
    dumps/
    k8s/
  config/
    logback/
    log4j2/
    otel/
  runbooks/
    high-cpu.md
    high-memory.md
    latency-spike.md
    pool-exhaustion.md
    missing-logs.md
```

---

## 24. Learning Output yang Diharapkan

Setelah menyelesaikan seri ini, targetnya bukan hanya “tahu tools”.

Target kompetensi:

### 24.1 Bisa Mendesain Logging Standard

Kamu bisa menjawab:

- Field apa yang wajib ada?
- Event apa yang harus di-log?
- Apa yang tidak boleh di-log?
- Level apa yang tepat?
- Bagaimana log dikorelasikan dengan trace?
- Bagaimana audit log dipisahkan dari diagnostic log?
- Bagaimana redaction dilakukan?
- Bagaimana JSON schema distandarkan?

### 24.2 Bisa Memilih Backend Logging

Kamu bisa menjawab:

- Kapan cukup Logback?
- Kapan Log4j2 lebih cocok?
- Apa trade-off AsyncAppender vs AsyncLogger?
- Apa risiko async logging?
- Apa biaya caller data?
- Apa risiko structured logging?
- Bagaimana rolling file policy diatur?
- Bagaimana logging di container dilakukan?

### 24.3 Bisa Menginstrumentasi Service

Kamu bisa menjawab:

- Kapan pakai OTel Java agent?
- Kapan perlu manual span?
- Attribute apa yang aman?
- Bagaimana menghindari cardinality explosion?
- Bagaimana trace context melewati HTTP, messaging, scheduler, dan batch?
- Bagaimana logs punya trace id/span id?

### 24.4 Bisa Melakukan Profiling

Kamu bisa menjawab:

- Kapan pakai CPU profile?
- Kapan pakai wall-clock profile?
- Kapan pakai allocation profile?
- Kapan pakai lock profile?
- Bagaimana membaca flame graph?
- Bagaimana membedakan compute bottleneck vs blocking bottleneck?
- Bagaimana profiling tanpa membuat production makin buruk?

### 24.5 Bisa Melakukan JVM Troubleshooting

Kamu bisa menjawab:

- Kapan ambil thread dump?
- Kapan ambil heap dump?
- Kapan mulai JFR?
- Kapan pakai NMT?
- Bagaimana membaca blocked threads?
- Bagaimana membaca heap dominator?
- Bagaimana menghubungkan GC pause dengan latency?
- Bagaimana menganalisis pool exhaustion?

### 24.6 Bisa Memimpin Incident Investigation

Kamu bisa menjawab:

- Apa symptom?
- Apa blast radius?
- Apa timeline?
- Apa recent changes?
- Apa hipotesis utama?
- Evidence apa yang mendukung?
- Evidence apa yang membantah?
- Apa mitigasi paling aman?
- Apa permanent fix?
- Apa observability gap yang harus diperbaiki?

---

## 25. Maturity Model

Kita akan memakai maturity model berikut.

### Level 0 — Blind System

Ciri:

- Tidak ada structured log.
- Tidak ada trace id.
- Metric minimal.
- Log hanya text random.
- Tidak ada dashboard.
- Tidak ada runbook.
- Troubleshooting berbasis tebakan.

### Level 1 — Basic Visibility

Ciri:

- Ada application logs.
- Ada basic metrics.
- Ada error logs.
- Ada dashboard sederhana.
- Tetapi correlation masih lemah.

### Level 2 — Correlated Observability

Ciri:

- Logs punya trace id/correlation id.
- Metrics punya label yang terkendali.
- Traces tersedia untuk major flows.
- Error taxonomy mulai jelas.
- Dependency latency terlihat.
- Runbook mulai ada.

### Level 3 — Diagnostic-Ready System

Ciri:

- JFR/profiler/dump playbook tersedia.
- Structured logs konsisten.
- Secure logging diterapkan.
- Context propagation stabil.
- Async/messaging flow observable.
- SLO/alert lebih meaningful.
- Incident bisa dianalisis dengan cepat.

### Level 4 — Adaptive Production Engineering

Ciri:

- Observability standar di PR/design review.
- High-cardinality/cost governance.
- Automated diagnostic capture.
- Continuous profiling.
- Production readiness gates.
- Post-incident improvements terintegrasi.
- Team tidak bergantung pada satu “hero debugger”.

Target seri ini adalah membantu kamu bergerak menuju Level 4.

---

## 26. Konsep Penting: Observability Is a Product Feature

Observability sering dianggap internal engineering concern. Padahal untuk sistem enterprise, observability adalah bagian dari kualitas produk.

Contoh:

- Jika user melaporkan gagal submit application, sistem harus bisa melacak application ID dan failure stage.
- Jika regulator meminta audit aktivitas user, sistem harus punya audit trail defensible.
- Jika data inconsistent, sistem harus bisa menjelaskan state transition.
- Jika external integration gagal, sistem harus tahu apakah request dikirim, diterima, timeout, atau di-retry.
- Jika incident terjadi, sistem harus bisa mengurangi MTTR.

Observability berdampak pada:

```text
reliability
security
compliance
operability
debuggability
maintainability
customer trust
engineering velocity
```

---

## 27. Java-Specific Complexity yang Membuat Seri Ini Tidak Trivial

Java punya karakteristik unik.

### 27.1 Multiple Logging Frameworks

Dalam satu aplikasi, bisa ada:

```text
SLF4J
Logback
Log4j2
java.util.logging
Commons Logging
JCL bridge
JUL bridge
Log4j-to-SLF4J bridge
SLF4J-to-Log4j2 binding
```

Jika salah bridge, bisa terjadi:

- duplicate logs
- infinite loop bridge
- missing logs
- runtime warning
- classpath conflict
- provider conflict

### 27.2 Classpath dan Classloader

Masalah logging sering muncul karena:

- app server classloader
- fat jar
- WAR deployment
- JPMS module path
- shading
- transitive dependency
- old binding dari library
- multiple providers

### 27.3 JVM Runtime

Java punya runtime kompleks:

- JIT
- GC
- safepoint
- thread scheduling
- monitor locks
- biased/legacy locking behavior
- classloading
- metaspace
- direct memory
- JNI/native memory
- virtual threads

Observability Java harus paham runtime ini.

### 27.4 Enterprise Framework Layers

Request sering melewati banyak layer:

```text
filter
interceptor
controller/resource
validation
service
transaction proxy
repository/mapper
JDBC driver
connection pool
database
event publisher
message broker
consumer
external API
```

Jika context propagation buruk, trace/log akan putus.

### 27.5 Asynchronous Boundaries

Banyak bug observability muncul pada:

```text
ExecutorService
CompletableFuture
ForkJoinPool
Reactor
scheduler
message listener
batch job
virtual thread executor
```

MDC berbasis ThreadLocal tidak otomatis melewati semua boundary.

---

## 28. Seri Ini Akan Menggunakan Gaya Berpikir Berikut

Setiap topik akan dijelaskan dengan pola:

1. Problem yang ingin diselesaikan.
2. Mental model.
3. API/configuration.
4. Runtime behavior.
5. Trade-off.
6. Failure mode.
7. Production checklist.
8. Example.
9. Troubleshooting angle.
10. Design standard.

Contoh ketika membahas AsyncAppender:

Tidak cukup hanya:

```xml
<appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">
  <appender-ref ref="STDOUT"/>
</appender>
```

Kita harus paham:

- Queue di mana?
- Siapa producer?
- Siapa consumer?
- Apa yang terjadi saat queue penuh?
- Apakah log bisa drop?
- Apakah caller block?
- Apakah shutdown flush?
- Apakah stack trace mahal?
- Apakah caller data dihitung di caller thread?
- Apakah timestamp dibuat sebelum atau sesudah enqueue?
- Apakah ordering dijamin?
- Apakah audit log boleh async?
- Bagaimana incident jika log hilang?

Itulah standar kedalaman seri ini.

---

## 29. Reference Architecture yang Akan Kita Bangun Bertahap

Pada akhir seri, kita ingin punya architecture seperti ini:

```text
Java Service
  |
  +-- SLF4J API
  |     |
  |     +-- Logback or Log4j2 backend
  |           |
  |           +-- JSON structured logs to stdout
  |           +-- trace_id/span_id/correlation_id injected
  |           +-- redaction/masking
  |
  +-- OpenTelemetry Java Agent
  |     |
  |     +-- HTTP server spans
  |     +-- HTTP client spans
  |     +-- JDBC spans
  |     +-- messaging spans
  |     +-- JVM metrics
  |
  +-- Manual Instrumentation
  |     |
  |     +-- business spans
  |     +-- domain attributes
  |     +-- span events
  |
  +-- Metrics
  |     |
  |     +-- RED
  |     +-- USE
  |     +-- JVM
  |     +-- pools
  |     +-- business counters
  |
  +-- JFR
  |     |
  |     +-- continuous low-overhead recording
  |     +-- emergency dump
  |     +-- custom business/runtime events
  |
  +-- Profiling Toolkit
        |
        +-- async-profiler CPU
        +-- async-profiler alloc
        +-- async-profiler lock
        +-- async-profiler wall
```

Pipeline:

```text
stdout logs / OTLP / metrics endpoint / JFR files / profiler outputs
  -> collector/agent
  -> storage backend
  -> dashboard/query
  -> alert/runbook
  -> incident response
```

---

## 30. Seri Ini dan Regulatory/Enterprise Case Management Systems

Untuk sistem enterprise/regulatory/case management, observability punya kebutuhan tambahan.

### 30.1 State Transition Defensibility

Setiap perubahan state penting harus bisa dijawab:

- state awal apa?
- state akhir apa?
- siapa actor?
- kapan?
- alasan?
- rule apa yang mengizinkan?
- validation apa yang dilewati?
- apakah ada override?
- apakah notification dikirim?
- apakah downstream sync berhasil?

### 30.2 Cross-Entity Impact

Satu request bisa berdampak pada banyak entity:

```text
case
application
document
party
license
appeal
correspondence
payment
audit trail
notification
external reference
```

Logging dan tracing harus membantu melihat dampak ini tanpa membocorkan data sensitif.

### 30.3 Long-Running Workflows

Banyak sistem case management tidak selesai dalam satu HTTP request.

Flow bisa melibatkan:

```text
draft
submit
screening
assignment
review
clarification
approval
rejection
appeal
closure
archival
```

Observability harus mendukung workflow yang berlangsung hari/minggu/bulan.

### 30.4 Audit vs Diagnostic Separation

Audit log menjawab:

```text
Siapa melakukan apa, kapan, terhadap data apa, dengan otorisasi apa?
```

Diagnostic log menjawab:

```text
Mengapa sistem gagal atau lambat?
```

Mencampur keduanya berbahaya.

---

## 31. Practical Standard: Every Important Operation Should Emit Three Kinds of Evidence

Untuk operasi penting, idealnya ada:

### 31.1 Trace Span

Menunjukkan operasi berada di mana dalam distributed flow.

```text
span: CaseService.submitCase
attributes:
  case.id
  module.name
  operation.name
```

### 31.2 Structured Log Event

Menunjukkan event penting.

```text
event.name=case_submitted
case.id=...
actor.id=...
state.from=DRAFT
state.to=SUBMITTED
```

### 31.3 Metric

Menunjukkan agregat.

```text
case_submission_total{result="success"}
case_submission_duration_seconds
case_submission_total{result="failed", error_category="VALIDATION_ERROR"}
```

Ketiganya punya tujuan berbeda.

---

## 32. Command Mindset: Jangan Menunggu Incident Baru Cari Command

Seri ini akan membangun muscle memory command.

Contoh command awal:

```bash
# Lihat proses Java
jps -lv

# Lihat command yang tersedia untuk proses
jcmd <pid> help

# Thread dump
jcmd <pid> Thread.print > thread-dump.txt

# Class histogram
jcmd <pid> GC.class_histogram > class-histogram.txt

# Start JFR 2 menit
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr

# Dump JFR yang sedang berjalan
jcmd <pid> JFR.dump name=continuous filename=/tmp/dump.jfr

# Native memory summary jika NMT enabled
jcmd <pid> VM.native_memory summary

# Heap info
jcmd <pid> GC.heap_info

# System properties
jcmd <pid> VM.system_properties
```

Command ini akan dibahas lebih detail di part khusus.

---

## 33. Example: Bedah Skenario 504 Timeout

Skenario:

```text
User melaporkan submit case timeout.
Frontend mendapat HTTP 504.
```

Engineer lemah mungkin langsung berkata:

```text
Backend lambat.
```

Engineer kuat memecah:

### 33.1 Pertanyaan Awal

- 504 dari browser, API gateway, load balancer, atau service?
- Request masuk ke service atau tidak?
- Ada trace id?
- Ada log request completed?
- Berapa duration di service?
- Apakah backend mengembalikan response tetapi gateway timeout?
- Apakah request masih berjalan setelah client timeout?
- Apakah DB/external dependency lambat?
- Apakah hanya submit case atau semua endpoint?
- Apakah semua tenant atau tenant tertentu?

### 33.2 Evidence yang Dicari

Logs:

```text
http_request_started
http_request_completed
case_submit_started
case_submit_failed
external_dependency_timeout
transaction_rollback
```

Metrics:

```text
http duration p95/p99
error rate 5xx
db pool active/pending
JVM CPU/heap/GC
external API latency
```

Traces:

```text
gateway -> service -> db -> document service -> notification service
```

Thread dump:

```text
Apakah request threads WAITING pada DB pool?
Apakah blocked pada lock?
Apakah RUNNABLE CPU-heavy?
```

JFR/profile:

```text
CPU hotspot?
Allocation spike?
Socket read blocked?
Monitor blocked?
```

### 33.3 Kemungkinan Root Cause

- Gateway timeout lebih pendek dari backend operation.
- DB query lambat.
- DB connection pool exhausted.
- External document upload timeout.
- Retry storm.
- Lock contention pada state transition.
- Transaction terlalu panjang.
- GC pause.
- CPU throttling di Kubernetes.
- Single pod unhealthy.
- DNS/cache issue.
- Downstream service partial outage.

### 33.4 Output Diagnosis yang Baik

```text
504 terjadi di API gateway karena upstream service tidak merespons dalam 30 detik.
Request mencapai case-service dan tetap berjalan sampai 42 detik.
Trace menunjukkan 38 detik habis pada document-service upload.
Log case-service menunjukkan retry 3 kali dengan read timeout 10 detik.
Metric document-service p99 naik dari 800ms ke 12s sejak deployment 14:05.
DB pool, GC, dan CPU case-service normal.
Root cause sementara: degradation document-service menyebabkan retry serial di submit flow.
Mitigasi: turunkan retry untuk synchronous submit, aktifkan fallback async document validation, dan buka incident ke document-service owner.
```

Ini contoh reasoning yang akan dilatih.

---

## 34. Example: Bedah Skenario Memory Leak

Skenario:

```text
Pod restart setiap 8 jam karena OOMKilled.
```

Pertanyaan:

- OOM dari JVM heap atau container memory?
- Ada `OutOfMemoryError` di log?
- Pod killed oleh kernel/cgroup?
- Heap max berapa?
- RSS berapa?
- Direct memory?
- Native memory?
- Metaspace?
- Thread count?
- Buffer pool?
- GC behavior?
- Heap dump ada?
- NMT enabled?

Evidence:

```text
Kubernetes event: OOMKilled
container_memory_working_set_bytes
jvm_memory_used_bytes
jvm_buffer_memory_used_bytes
GC logs
JFR allocation
heap histogram
NMT summary
```

Kemungkinan:

- Java heap leak.
- Direct buffer leak.
- Native memory leak.
- Too many threads.
- Metaspace/classloader leak.
- Memory limit terlalu dekat dengan Xmx.
- Profiler/agent overhead.
- Huge log buffer/async queue.
- Large response buffering.
- Cache unbounded.

Diagnosis bagus membedakan:

```text
Heap naik mengikuti container memory.
```

vs

```text
Heap stabil tetapi RSS naik.
```

Kasus kedua mengarah ke native/direct/thread/metaspace, bukan heap object leak biasa.

---

## 35. Example: Bedah Skenario Log Hilang

Skenario:

```text
Saat incident, log ERROR yang diharapkan tidak ada.
```

Kemungkinan:

- Code path tidak mencapai log.
- Level logger salah.
- Logger package disabled.
- Async appender queue penuh dan drop.
- App shutdown sebelum flush.
- Container restart sebelum log collector baca.
- Multiline stack trace pecah.
- Log platform ingestion lag.
- Sampling/filtering.
- STDOUT/STDERR misconfigured.
- Duplicate/misrouted appender.
- Exception ditelan tanpa log.
- Log ditulis ke file, bukan stdout.
- File rolling menghapus terlalu cepat.
- MDC/filter menolak event.

Ini menunjukkan bahwa logging sendiri juga punya failure modes.

---

## 36. Observability Design Review Checklist Awal

Sebelum sebuah fitur besar production, tanya:

### 36.1 Logging

- Event penting apa yang di-log?
- Apakah event punya stable name?
- Apakah semua log punya trace/correlation id?
- Apakah business ID penting tersedia?
- Apakah sensitive data aman?
- Apakah error category jelas?
- Apakah stack trace tidak duplicate?

### 36.2 Metrics

- Apa success/failure counter?
- Apa latency histogram?
- Apa queue/pool/resource metric?
- Apa label cardinality aman?
- Apa SLI yang terdampak?

### 36.3 Tracing

- Span boundary mana yang penting?
- External dependency terinstrumentasi?
- DB spans tersedia?
- Async/message context propagate?
- Manual span perlu?

### 36.4 Profiling/Diagnostics

- Jika lambat, tool apa yang dipakai?
- Jika memory naik, dump apa yang diambil?
- Jika thread stuck, command apa?
- Jika incident di Kubernetes, bagaimana ambil evidence?

### 36.5 Runbook

- Alert apa?
- Dashboard mana?
- Query log mana?
- Mitigasi aman apa?
- Owner siapa?

---

## 37. How to Avoid Learning This as Tool Memorization

Bahaya besar seri ini adalah menjadi kumpulan command dan config.

Padahal targetnya adalah berpikir.

Jangan hafal:

```bash
jcmd <pid> Thread.print
```

Pahami:

```text
Thread dump menjawab pertanyaan "thread sedang melakukan/menunggu apa pada waktu tertentu?"
```

Jangan hafal:

```xml
<AsyncAppender>
```

Pahami:

```text
Async logging memindahkan IO ke thread lain, tetapi memperkenalkan queue, drop policy, shutdown flushing, dan backpressure decision.
```

Jangan hafal:

```text
trace_id
```

Pahami:

```text
trace_id adalah identitas causal path sebuah distributed operation.
```

Jangan hafal:

```text
p95
```

Pahami:

```text
p95 menyembunyikan 5% worst requests tetapi lebih representatif dari average untuk latency user experience.
```

---

## 38. Seri Ini Akan Banyak Menggunakan Trade-off

Tidak ada konfigurasi observability yang selalu benar.

Contoh trade-off:

### 38.1 Synchronous Logging

Pro:

- lebih predictable
- lebih kecil risiko log loss
- ordering lebih sederhana

Con:

- request thread membayar IO cost
- latency bisa naik
- disk/stdout backpressure bisa memengaruhi aplikasi

### 38.2 Asynchronous Logging

Pro:

- request thread lebih cepat
- IO dipindah ke background
- throughput bisa lebih baik

Con:

- queue bisa penuh
- logs bisa drop
- shutdown flush risk
- memory usage naik
- audit log mungkin tidak cocok

### 38.3 Full Tracing

Pro:

- visibility tinggi
- debugging mudah

Con:

- cost tinggi
- storage besar
- overhead
- privacy/cardinality risk

### 38.4 Sampling

Pro:

- cost terkendali
- overhead turun

Con:

- rare issue bisa hilang
- forensic completeness rendah

### 38.5 Rich Logs

Pro:

- query powerful
- context lengkap

Con:

- storage mahal
- sensitive data risk
- serialization cost
- cardinality/noise risk

Top-tier engineer tidak mencari “best practice” secara buta. Mereka mencari trade-off yang sesuai constraint.

---

## 39. Common Production Constraints

Seri ini akan realistis terhadap constraint produksi.

Constraint umum:

```text
Tidak bisa attach debugger.
Tidak bisa restart sembarangan.
Tidak bisa menaikkan log level global.
Tidak bisa mengambil heap dump besar saat traffic puncak.
Tidak bisa menyimpan PII di log.
Tidak semua service sudah instrumented.
Trace sampling tidak 100%.
Log backend bisa delay.
Dashboard bisa salah interpretasi.
Akses database production terbatas.
Pod bisa mati sebelum evidence terkumpul.
Agent bisa punya overhead.
Security policy membatasi profiler.
```

Karena itu kita butuh strategi bertahap:

```text
least invasive evidence first
targeted diagnostics
safe sampling
short JFR capture
temporary log level per package
compare healthy/unhealthy
capture before restart
document commands
```

---

## 40. Safety and Security Principles

Observability bisa menjadi risiko security jika salah.

Prinsip:

1. Jangan log secret.
2. Jangan log token.
3. Jangan log password.
4. Jangan log full Authorization header.
5. Jangan log full request/response body by default.
6. Jangan log PII tanpa purpose dan control.
7. Redact sebelum event keluar dari process jika memungkinkan.
8. Pisahkan audit dan diagnostic logs.
9. Batasi akses log.
10. Tentukan retention.
11. Hindari log injection.
12. Hindari dynamic config yang bisa dieksploitasi.
13. Treat logs as sensitive data.

---

## 41. Relationship dengan Testing

Observability juga bisa diuji.

Contoh test:

- Saat validation gagal, error category benar.
- Saat dependency timeout, retry count masuk log.
- Saat request masuk, correlation id dibuat jika belum ada.
- Saat header traceparent ada, context dipakai.
- Saat MDC dipakai, MDC dibersihkan setelah request.
- Saat exception dilempar, global handler log satu kali.
- Saat sensitive field masuk, redaction bekerja.
- Saat logback/log4j2 config parse, app bisa start.
- Saat OTel agent aktif, trace id muncul di log.

Observability tanpa test sering regression diam-diam.

---

## 42. Relationship dengan Performance

Logging dan observability punya overhead.

Sumber overhead:

```text
string formatting
JSON serialization
stack trace generation
caller location lookup
MDC map copy
ThreadLocal access
context propagation wrapper
span creation
metric label creation
exporter batching
network export
async queue allocation
file IO
stdout blocking
```

Tujuannya bukan menghilangkan overhead, tetapi membuat overhead:

```text
known
bounded
worth it
measured
configurable
```

---

## 43. Relationship dengan Architecture

Banyak keputusan architecture memengaruhi observability.

Contoh:

### 43.1 Layered Architecture

Jika semua exception dibungkus tanpa cause, root cause hilang.

### 43.2 Async Architecture

Jika message tidak membawa trace/correlation id, flow putus.

### 43.3 Microservices

Jika setiap service membuat correlation id baru, distributed trace tidak berguna.

### 43.4 Batch Processing

Jika log hanya per job, sulit tahu record mana yang gagal.

### 43.5 Stateful Workflow

Jika state transition tidak direkam, sulit audit.

### 43.6 Database Transaction

Jika transaction terlalu panjang, pool exhaustion bisa terlihat sebagai HTTP timeout, bukan DB issue.

---

## 44. Vocabulary yang Harus Konsisten

Istilah yang akan sering muncul:

```text
event
signal
telemetry
instrumentation
context
correlation
causality
span
trace
metric
attribute
label
resource
scope
profile
sample
dump
snapshot
timeline
blast radius
root cause
contributing factor
mitigation
permanent fix
runbook
SLO
SLI
cardinality
backpressure
redaction
retention
```

Kita akan memakai istilah ini secara disiplin.

---

## 45. Reading Map of Official/Primary References

Berikut referensi utama yang menjadi anchor seri:

1. SLF4J Manual — menjelaskan SLF4J API, parameterized logging, fluent API, dan key-value pair.
2. Logback Manual — menjelaskan Logger, Appender, Layout, Encoder, Filter, dan configuration.
3. Apache Log4j2 Manual — menjelaskan architecture, async loggers, JSON Template Layout, dan garbage-free logging.
4. OpenTelemetry Java Documentation — menjelaskan API, SDK, auto instrumentation, Java agent, dan signal telemetry.
5. OpenTelemetry Specification — terutama logs, traces, metrics, resources, context propagation, dan semantic conventions.
6. Dev.java JFR Documentation — menjelaskan JDK Flight Recorder sebagai observability/monitoring framework built into HotSpot JVM.
7. Oracle/JDK Mission Control Documentation — menjelaskan analisis data JFR menggunakan JMC.
8. async-profiler GitHub — menjelaskan jenis profiling yang didukung.
9. OpenJDK JEPs — terutama JEP terkait virtual threads, scoped values, structured concurrency, dan perubahan JDK modern.
10. JDK release notes — untuk perbedaan Java 8, 11, 17, 21, 25.

---

## 46. Roadmap 35 Part

Daftar part seri:

```text
00. Orientation, Scope, Mental Model, dan Learning Contract
01. Runtime Evidence, Not Just Logging
02. Java Logging Architecture: Facade, API, Backend, Appender, Layout
03. Log Semantics: What Should Be Logged and Why
04. SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging
05. Logback Deep Dive I: Architecture, Configuration, Appenders, Encoders
06. Logback Deep Dive II: AsyncAppender, MDC, Sifting, Filtering, JSON
07. Log4j2 Deep Dive I: Architecture, Configuration, Appenders, Layouts
08. Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security
09. Structured Logging: From Human Text to Machine-Queryable Events
10. Context Propagation: MDC, ThreadLocal, Virtual Threads, Scoped Values
11. Correlation ID, Trace ID, Request ID, Idempotency Key, Causality
12. OpenTelemetry Mental Model: Signals, Resource, Scope, Context
13. OpenTelemetry Java Agent: Zero-Code Instrumentation for Java 8+
14. Manual Tracing: Span Design, Boundaries, Attributes, Events, Errors
15. Metrics Engineering: RED, USE, JVM, Application, Business Metrics
16. Logs + Traces + Metrics Correlation
17. Logging Performance: Cost Model, Allocation, Locking, IO, Backpressure
18. Secure Logging: PII, Secrets, Injection, Compliance, Auditability
19. Exception Logging and Error Taxonomy
20. JFR Deep Dive I: Java Flight Recorder Mental Model
21. JFR Deep Dive II: Custom Events, Production Recording, JMC Analysis
22. Profiling Mental Model: CPU Time, Wall Time, Allocation, Lock, IO
23. async-profiler Deep Dive: CPU, Wall, Alloc, Lock, Native, Flame Graph
24. JVM Troubleshooting Toolkit: jcmd, jstack, jmap, jstat, jhsdb, jinfo
25. Thread Dump Analysis: Deadlock, Blocking, Starvation, Pool Exhaustion
26. Heap Dump and Memory Troubleshooting: Leak, Retention, Allocation, Native Memory
27. GC Observability and Troubleshooting Across Java 8–25
28. Database and External Dependency Troubleshooting with Logs, Metrics, Traces
29. Messaging, Batch, Scheduler, and Async Workflow Observability
30. Troubleshooting Methodology: From Symptom to Root Cause
31. Production Incident Playbooks for Java Systems
32. Observability in Containers and Kubernetes
33. Observability Governance: Standards, Cost, Cardinality, Retention, Ownership
34. Building a Production-Grade Java Observability Starter Kit
35. Capstone: Diagnose a Complex Java Production Incident End-to-End
```

Catatan:

- Bagian 0 adalah orientasi.
- Bagian terakhir adalah Part 35.
- Jadi seri ini belum selesai; kita baru memulai.

---

## 47. Mini Glossary

### Logger

Object/API yang digunakan code untuk membuat event log.

### Appender

Komponen backend logging yang menentukan tujuan output, misalnya console, file, socket, queue.

### Layout

Komponen yang mengubah event log menjadi representasi text/JSON.

### Encoder

Komponen yang mengubah event menjadi byte dan menulis ke output stream, umum di Logback.

### MDC

Mapped Diagnostic Context. Biasanya ThreadLocal-backed map untuk menyimpan context seperti request id.

### ThreadContext

Konsep serupa MDC di Log4j2.

### Trace

Representasi distributed execution sebuah operation.

### Span

Unit kerja dalam trace.

### Metric

Pengukuran numerik agregat.

### Profile

Sampling/pengukuran runtime untuk mengetahui waktu CPU, allocation, lock, wall time, dan sejenisnya.

### JFR

JDK Flight Recorder, framework event recording built-in di HotSpot JVM.

### JMC

JDK Mission Control, tool GUI untuk menganalisis JFR.

### Cardinality

Jumlah kombinasi unik label/attribute/field. Cardinality tinggi bisa membuat observability backend mahal atau lambat.

### Backpressure

Kondisi ketika downstream tidak bisa memproses secepat upstream menghasilkan data.

### Redaction

Menghapus atau menyamarkan data sensitif sebelum disimpan/dikirim.

---

## 48. Latihan Awal Sebelum Part 1

Sebelum masuk Part 1, coba evaluasi satu service Java yang kamu kenal.

Jawab pertanyaan ini:

1. Apakah semua request punya correlation id?
2. Apakah logs punya trace id/span id?
3. Apakah logs structured atau plain text?
4. Apakah log level konsisten?
5. Apakah exception di-log sekali atau berkali-kali?
6. Apakah sensitive data bisa bocor ke log?
7. Apakah HTTP latency punya histogram?
8. Apakah DB pool metrics tersedia?
9. Apakah JVM metrics tersedia?
10. Apakah trace mencakup DB dan external API?
11. Apakah async message membawa context?
12. Apakah thread dump bisa diambil saat incident?
13. Apakah JFR bisa dinyalakan tanpa restart?
14. Apakah profiler bisa attach di environment aman?
15. Apakah ada runbook untuk high CPU, high memory, latency spike, dan pool exhaustion?

Jika banyak jawaban “tidak tahu”, itu bukan kegagalan. Itu baseline awal.

---

## 49. Ringkasan Bagian 0

Bagian ini menetapkan arah seri:

1. Logging, observability, profiling, dan troubleshooting adalah satu kesatuan runtime evidence.
2. Tujuan utama bukan hafal tool, tetapi mampu melakukan diagnosis dan desain diagnosability.
3. Java punya kompleksitas khusus: banyak logging framework, classloader, JVM runtime, async boundaries, virtual threads, dan enterprise framework layers.
4. Seri ini akan mencakup Java 8 sampai Java 25.
5. Kita akan belajar SLF4J, Logback, Log4j2, OpenTelemetry, JFR, async-profiler, JVM tools, diagnostics, dan incident methodology.
6. Fokusnya adalah produksi nyata: evidence, trade-off, failure mode, security, cost, dan governance.
7. Seri ini terdiri dari Bagian 0 sampai Part 35.
8. Seri belum selesai; ini baru orientasi.

---

## 50. Referensi Utama

- SLF4J Manual: https://www.slf4j.org/manual.html
- Logback Architecture Manual: https://logback.qos.ch/manual/architecture.html
- Logback Appenders Manual: https://logback.qos.ch/manual/appenders.html
- Logback Filters Manual: https://logback.qos.ch/manual/filters.html
- Apache Log4j2 Async Loggers Manual: https://logging.apache.org/log4j/2.x/manual/async.html
- Apache Log4j2 JSON Template Layout Manual: https://logging.apache.org/log4j/2.x/manual/json-template-layout.html
- Apache Log4j2 Garbage-Free Logging Manual: https://logging.apache.org/log4j/2.x/manual/garbagefree.html
- OpenTelemetry Java Documentation: https://opentelemetry.io/docs/languages/java/
- OpenTelemetry Java Agent Documentation: https://opentelemetry.io/docs/zero-code/java/agent/
- OpenTelemetry Logs Specification: https://opentelemetry.io/docs/specs/otel/logs/
- JDK Flight Recorder on dev.java: https://dev.java/learn/jvm/jfr/
- JDK Mission Control: https://www.oracle.com/java/technologies/jdk-mission-control.html
- async-profiler GitHub: https://github.com/async-profiler/async-profiler
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/
- JEP 506 Scoped Values: https://openjdk.org/jeps/506

---

## 51. Lanjut ke Bagian Berikutnya

Materi berikutnya:

```text
Part 1 — Runtime Evidence, Not Just Logging
```

Part 1 akan membahas lebih dalam mental model runtime evidence:

- Kenapa logging bukan tujuan akhir.
- Bagaimana sistem meninggalkan bukti.
- Bagaimana membangun timeline.
- Bagaimana membedakan log, metric, trace, profile, dump.
- Bagaimana cara berpikir saat production incident.
- Bagaimana mengubah “debugging” menjadi “evidence-based investigation”.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./01-runtime-evidence-not-just-logging.md">Part 1 — Mental Model: Runtime Evidence, Not Just Logging ➡️</a>
</div>
