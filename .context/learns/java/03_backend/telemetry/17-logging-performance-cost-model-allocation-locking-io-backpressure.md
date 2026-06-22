# Part 17 — Logging Performance: Cost Model, Allocation, Locking, IO, Backpressure

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Status: Part 17 of 35  
Scope: Java 8–25, SLF4J, Logback, Log4j2, JSON logging, containers, production troubleshooting

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membangun fondasi logging semantics, SLF4J, Logback, Log4j2, structured logging, context propagation, OpenTelemetry, tracing, metrics, dan korelasi antar-signal.

Bagian ini membahas satu hal yang sering diremehkan oleh engineer menengah: **logging bukan gratis**.

Logging adalah subsystem runtime yang mengonsumsi:

- CPU,
- memory allocation,
- lock/coordination,
- queue capacity,
- disk/network IO,
- file descriptor,
- stdout pipe throughput,
- collector throughput,
- indexing/storage budget,
- dan attention budget manusia.

Engineer top-tier tidak hanya bertanya:

> “Apakah log ini membantu debugging?”

Tetapi juga:

> “Berapa biaya log ini ketika request rate 2.000 RPS, error storm terjadi, thread pool penuh, collector lambat, container throttled, dan GC sedang pressure?”

Logging performance harus dipahami sebagai bagian dari reliability engineering.

---

## 1. Mental Model: Logging as a Runtime Data Plane

Jangan melihat logging sebagai satu method call:

```java
log.info("Order submitted: {}", orderId);
```

Secara runtime, statement ini bisa berubah menjadi pipeline panjang:

```text
application code
  -> logger facade
  -> level check
  -> argument evaluation
  -> logging event creation
  -> MDC/context capture
  -> marker/key-value capture
  -> backend logger
  -> filter chain
  -> formatter/layout/encoder
  -> stack trace rendering if any
  -> async queue enqueue or sync appender
  -> appender worker
  -> stdout/file/socket/network client
  -> container runtime
  -> node log agent
  -> collector/forwarder
  -> ingest pipeline
  -> parser/indexer/storage
  -> query engine/dashboard/alert
```

Setiap tahap memiliki cost dan failure mode.

Logging yang terlihat sederhana bisa menjadi bottleneck ketika:

- log rate tinggi,
- format JSON berat,
- exception besar,
- caller data diaktifkan,
- appender synchronous ke slow disk/network,
- async queue penuh,
- stdout pipe blocked,
- collector backpressure,
- log indexing mahal,
- atau error loop menghasilkan log storm.

Top-tier mental model:

> Log event adalah unit data produksi. Ia harus punya value lebih besar daripada cost-nya.

---

## 2. Logging Cost Model

Logging cost dapat dibagi menjadi dua fase:

1. **Producer-side cost**: cost di thread aplikasi yang membuat log event.
2. **Consumer-side cost**: cost di appender/collector/storage yang memproses log event.

### 2.1 Producer-Side Cost

Producer-side cost terjadi di request thread, worker thread, virtual thread, scheduler thread, consumer thread, atau thread lain yang menjalankan business logic.

Biaya utamanya:

| Cost | Contoh |
|---|---|
| Level check | `isDebugEnabled`, effective level lookup |
| Argument construction | membuat object, string, map, DTO snapshot |
| Message formatting | mengganti `{}` / template rendering |
| Event object allocation | membuat logging event |
| MDC copy | mengambil/copy context map |
| Throwable capture | exception object dan stack trace |
| Throwable rendering | stack trace to string |
| Caller data | mencari class/method/line pemanggil |
| Serialization | JSON encoding |
| Queue enqueue | lock/CAS/blocking |
| Synchronous appender | write langsung ke destination |

### 2.2 Consumer-Side Cost

Consumer-side cost terjadi setelah event dibuat.

Contoh:

| Cost | Contoh |
|---|---|
| Queue drain | background thread membaca queue |
| Layout/encoder | pattern/JSON rendering |
| Compression | rolling file gzip |
| Disk write | file appender |
| Stdout write | container stdout pipe |
| Network write | socket/HTTP appender |
| Retry | network appender retry |
| Collector parse | JSON parse, multiline handling |
| Indexing | Elasticsearch/OpenSearch/Loki/Splunk/etc |
| Retention | storage footprint |

### 2.3 Hidden Cost

Hidden cost sering lebih besar daripada method call-nya:

- storage cost karena log terlalu verbose,
- query lambat karena schema buruk,
- incident delay karena noise,
- customer impact karena logging block,
- data breach karena PII bocor,
- GC pressure karena stack trace storm,
- false alert karena low-value error log.

---

## 3. Disabled Log Cost

Disabled log adalah statement yang level-nya tidak aktif.

Contoh:

```java
log.debug("Payload: {}", payload);
```

Jika `DEBUG` disabled, backend seharusnya tidak membuat event penuh. Tetapi cost masih bisa terjadi sebelum call masuk ke logger.

### 3.1 Cheap Disabled Log

```java
log.debug("Order {} processed", orderId);
```

Biasanya murah karena:

- message template constant,
- argument sederhana,
- formatting tidak dilakukan jika disabled,
- `orderId` sudah ada.

### 3.2 Expensive Disabled Log

```java
log.debug("Order snapshot: {}", buildLargeSnapshot(order));
```

Walaupun `DEBUG` disabled, method `buildLargeSnapshot(order)` dieksekusi sebelum logger dipanggil.

Masalahnya bukan SLF4J. Masalahnya evaluation order Java.

Java mengevaluasi argument method sebelum memanggil method.

### 3.3 String Concatenation Anti-Pattern

```java
log.debug("Order snapshot: " + buildLargeSnapshot(order));
```

Ini lebih buruk karena string sudah dibangun sebelum level check.

Gunakan parameterized logging:

```java
log.debug("Order snapshot: {}", order);
```

Tetapi kalau `toString()` object mahal dan level enabled, tetap mahal.

### 3.4 Guarded Expensive Debug

Untuk operasi mahal:

```java
if (log.isDebugEnabled()) {
    log.debug("Order snapshot: {}", buildLargeSnapshot(order));
}
```

Rule:

> Parameterized logging cukup untuk argument murah. Guard eksplisit diperlukan untuk argument mahal.

### 3.5 SLF4J 2.x Supplier

Dengan SLF4J 2.x fluent API, kita bisa memakai supplier untuk lazy argument tergantung backend/support:

```java
log.atDebug()
   .setMessage("Order snapshot: {}")
   .addArgument(() -> buildLargeSnapshot(order))
   .log();
```

Tetap perhatikan:

- supplier membuat lambda object atau bisa dioptimasi JIT,
- jangan pakai supplier untuk semuanya secara membabi buta,
- pastikan terminal `.log()` dipanggil.

---

## 4. Enabled Log Cost

Jika level enabled, event akan diproses.

Contoh:

```java
log.info("Payment authorized orderId={} amount={} currency={}", orderId, amount, currency);
```

Cost yang mungkin terjadi:

1. Logger melakukan level check.
2. Argument sudah tersedia.
3. Logging event dibuat.
4. Timestamp diambil.
5. Thread name diambil.
6. MDC/context di-copy.
7. Marker/key-value ditangkap.
8. Appender/filter dipanggil.
9. Layout/encoder membentuk output.
10. Output ditulis ke destination.

### 4.1 Cost Berdasarkan Level

Level bukan hanya severity. Level juga memengaruhi volume.

| Level | Typical volume | Performance risk |
|---|---:|---|
| TRACE | sangat tinggi | sangat berbahaya di production |
| DEBUG | tinggi | boleh sementara dengan sampling/window |
| INFO | sedang/tinggi | harus dikontrol ketat |
| WARN | rendah/sedang | bisa storm saat dependency degrade |
| ERROR | rendah | exception storm bisa sangat mahal |

Kesalahan umum:

- INFO per item dalam loop besar,
- WARN per retry attempt tanpa rate limit,
- ERROR per validation failure,
- DEBUG payload besar di production,
- TRACE masuk release config.

---

## 5. Allocation Cost

Allocation adalah salah satu biaya logging paling sering tidak terlihat.

Allocation tinggi menyebabkan:

- GC lebih sering,
- latency jitter,
- throughput turun,
- CPU naik,
- memory pressure,
- container OOM risk.

### 5.1 Sumber Allocation dalam Logging

| Sumber | Contoh |
|---|---|
| String concatenation | `"x=" + x` |
| Varargs array | `log.info("{} {} {}", a, b, c)` bisa membuat array |
| Boxing | primitive menjadi object |
| `toString()` | membuat string besar |
| Exception stack trace | array stack trace elements |
| JSON serialization | buffer/string/object temporary |
| MDC map copy | copy context per event |
| Caller data | stack walking |
| Layout buffer | StringBuilder/byte buffer |
| Queue node/event | async appender event object |

### 5.2 Parameterized Logging Mengurangi Formatting Cost, Bukan Semua Allocation

SLF4J parameterized logging menghindari formatting ketika disabled.

Namun ketika enabled:

- event tetap dibuat,
- arguments tetap perlu direpresentasikan,
- backend tetap encode output,
- exception tetap dirender jika dikirim.

### 5.3 Varargs Subtlety

```java
log.info("a={} b={} c={}", a, b, c);
```

Tergantung API overload, beberapa jumlah argument punya overload khusus; jumlah banyak dapat jatuh ke varargs dan membuat array.

Biasanya ini bukan masalah besar untuk low-volume log, tetapi bisa signifikan untuk hot path high-frequency logging.

### 5.4 Structured Arguments

Structured logging dengan banyak key-value bisa membuat allocation tambahan.

Contoh:

```java
log.atInfo()
   .setMessage("dependency call completed")
   .addKeyValue("dependency.name", dependency)
   .addKeyValue("http.status_code", status)
   .addKeyValue("duration.ms", durationMs)
   .log();
```

Ini jauh lebih berguna daripada text-only log, tetapi tetap ada cost.

Rule:

> Structured fields harus query-worthy, bukan semua variable lokal dimasukkan.

### 5.5 Exception Allocation

Membuat exception mahal karena stack trace di-capture saat construction.

Anti-pattern:

```java
if (invalid) {
    log.warn("Invalid request", new IllegalArgumentException("invalid"));
    return;
}
```

Jika invalid request adalah expected user error, jangan buat exception hanya untuk logging.

Lebih baik:

```java
log.info("request rejected reason={} field={}", "validation_failed", fieldName);
```

Exception harus mewakili exceptional control flow, bukan formatting tool.

---

## 6. Stack Trace Cost

Stack trace adalah salah satu bagian paling mahal dalam logging.

Biayanya datang dari dua hal:

1. Capturing stack trace saat exception dibuat.
2. Rendering stack trace saat log ditulis.

### 6.1 Stack Trace Once Rule

Jika exception merambat melalui beberapa layer, jangan log stack trace di setiap layer.

Buruk:

```java
try {
    repository.save(entity);
} catch (SQLException e) {
    log.error("Repository failed", e);
    throw new PersistenceException("Save failed", e);
}
```

Lalu service layer:

```java
try {
    orderService.submit(cmd);
} catch (PersistenceException e) {
    log.error("Service failed", e);
    throw e;
}
```

Lalu controller:

```java
catch (Exception e) {
    log.error("Request failed", e);
}
```

Hasil:

- stack trace sama muncul 3 kali,
- log volume membengkak,
- diagnosis makin noise,
- cost makin tinggi.

Lebih baik:

- lower layer menambahkan context melalui exception wrapping tanpa log stack trace,
- boundary layer log sekali dengan context lengkap.

### 6.2 Expected Exception Tidak Perlu Stack Trace

Contoh expected:

- validation failed,
- unauthorized,
- forbidden,
- not found karena input user,
- duplicate idempotency key,
- optimistic lock conflict yang normal,
- user cancels operation.

Untuk expected error:

```java
log.info("request rejected reason={} field={} request.id={}", reason, field, requestId);
```

Bukan:

```java
log.error("Request rejected", exception);
```

### 6.3 Error Storm

Saat dependency down, ribuan request bisa gagal.

Jika setiap request log stack trace penuh:

- stdout/file membanjir,
- CPU habis render stack trace,
- collector overload,
- disk penuh,
- aplikasi makin lambat,
- incident diperparah oleh logging.

Gunakan:

- rate-limited logging,
- aggregate metric,
- sampled stack trace,
- circuit breaker state-change log,
- dependency health event.

---

## 7. Caller Data Cost

Caller data adalah informasi seperti:

- class,
- method,
- file,
- line number.

Contoh pattern:

```xml
%class.%method:%line
```

atau Logback/Log4j2 `includeCallerData` / `includeLocation`.

Untuk mendapatkan caller data, framework sering perlu melakukan stack walking.

Ini mahal, terutama:

- high RPS,
- async logging,
- deep stack,
- virtual threads banyak,
- JSON logging dengan source location.

### 7.1 Kenapa Caller Data Menggoda

Line number terlihat membantu saat debugging.

Namun dalam sistem matang:

- logger name sudah menunjukkan source class,
- event name menunjukkan semantic event,
- trace ID menunjukkan flow,
- code version/commit menunjukkan build,
- stack trace tersedia untuk unexpected exception.

Line number di setiap INFO log biasanya tidak worth it.

### 7.2 Rule

Production default:

- jangan include caller data untuk semua log,
- aktifkan hanya sementara atau untuk targeted diagnostic,
- pertimbangkan cost saat async logging.

---

## 8. Timestamp Cost

Timestamp tampak sederhana, tetapi high-frequency logging dapat membuat timestamp formatting menjadi signifikan.

Cost berasal dari:

- current time retrieval,
- timezone conversion,
- date formatting,
- string formatting.

Best practice:

- gunakan UTC atau timezone standar platform,
- gunakan ISO-8601 jika structured JSON,
- jangan membuat timestamp manual di message,
- biarkan backend logging menghasilkan timestamp,
- pastikan clock sync via NTP/chrony di infra.

Buruk:

```java
log.info("{} Order submitted", LocalDateTime.now().format(formatter));
```

Baik:

```java
log.info("Order submitted order.id={}", orderId);
```

Timestamp adalah field logging backend, bukan message content.

---

## 9. JSON Serialization Cost

Structured JSON logging sangat berguna, tetapi tidak gratis.

Cost-nya:

- escaping string,
- rendering number/boolean,
- rendering exception,
- MDC copy,
- JSON field ordering,
- buffer allocation,
- UTF-8 encoding,
- stdout/file write.

### 9.1 JSON Log Harus Flat dan Query-Friendly

Buruk:

```json
{
  "message": "Order submitted",
  "payload": {
    "entireOrder": { "...": "very large object" }
  }
}
```

Baik:

```json
{
  "@timestamp": "2026-06-18T05:00:00.000Z",
  "log.level": "INFO",
  "event.name": "order.submitted",
  "order.id": "ord_123",
  "customer.segment": "enterprise",
  "trace.id": "...",
  "span.id": "..."
}
```

### 9.2 Jangan Serialize Domain Object Besar ke Log

Anti-pattern:

```java
log.info("Order submitted: {}", objectMapper.writeValueAsString(order));
```

Masalah:

- mahal,
- bisa bocor PII,
- schema tidak stabil,
- log besar,
- indexing mahal,
- sulit query field penting jika nested berantakan.

Gunakan selected fields:

```java
log.atInfo()
   .setMessage("order submitted")
   .addKeyValue("event.name", "order.submitted")
   .addKeyValue("order.id", order.id())
   .addKeyValue("order.type", order.type())
   .addKeyValue("amount", order.amount())
   .log();
```

### 9.3 Multiline Stack Trace dalam JSON

JSON logging harus memastikan stack trace tetap valid sebagai field string atau array, bukan multiline mentah yang merusak log collector.

Rule:

> Dalam container/Kubernetes, satu log event idealnya satu baris JSON.

---

## 10. IO Cost

Logging biasanya berakhir di IO.

Jenis IO:

- stdout/stderr,
- file,
- rolling file,
- socket,
- HTTP endpoint,
- syslog,
- message broker,
- database appender.

### 10.1 Stdout di Container

Di Kubernetes, pattern umum adalah aplikasi menulis ke stdout/stderr, lalu container runtime/node agent mengambil log.

Keunggulan:

- sederhana,
- cloud-native,
- tidak perlu manage file dalam container,
- integrasi log collector mudah.

Risiko:

- stdout pipe bisa bottleneck,
- log besar memperlambat proses,
- restart pod bisa kehilangan buffered logs,
- collector/node pressure bisa berdampak ke ingestion,
- multiline log bisa sulit diparse.

### 10.2 File Appender

File appender cocok untuk:

- VM/bare metal,
- legacy deployment,
- local forensic capture,
- aplikasi yang butuh retention lokal sementara.

Risiko:

- disk penuh,
- rolling salah,
- compression cost,
- permission issue,
- log rotation konflik dengan external logrotate,
- container ephemeral storage habis.

### 10.3 Network Appender

Network appender terlihat menarik karena langsung kirim ke log platform.

Namun sangat berisiko jika dipakai langsung dari request thread.

Risiko:

- network latency masuk path aplikasi,
- DNS issue memengaruhi logging,
- retry storm,
- queue growth,
- TLS handshake cost,
- backpressure sulit,
- dependency observability menjadi dependency availability.

Rule:

> Aplikasi sebaiknya tidak bergantung langsung pada availability log backend untuk melayani user request.

Gunakan collector/agent lokal jika memungkinkan.

---

## 11. Synchronous Logging

Synchronous logging berarti thread aplikasi ikut melakukan write ke appender.

Flow:

```text
request thread
  -> log event
  -> encode
  -> write stdout/file/network
  -> return to business logic
```

### 11.1 Kelebihan

- sederhana,
- ordering lebih mudah dipahami,
- log loss lebih kecil jika write sukses,
- failure behavior lebih langsung,
- cocok untuk low-volume service.

### 11.2 Kekurangan

- latency request ikut terpengaruh,
- slow IO memperlambat aplikasi,
- lock contention di appender,
- high-volume logging bisa membatasi throughput,
- error storm bisa memperparah incident.

### 11.3 Kapan Synchronous Masuk Akal

- CLI/tooling,
- low-throughput admin app,
- local development,
- audit log yang harus durable dan kecil volumenya,
- emergency diagnostic mode singkat.

Tetapi untuk web service high-throughput, asynchronous logging sering perlu dipertimbangkan.

---

## 12. Asynchronous Logging

Asynchronous logging memisahkan producer thread dari IO thread.

Flow:

```text
request thread
  -> create log event
  -> enqueue
  -> return to business logic

logging worker
  -> dequeue
  -> encode
  -> write output
```

### 12.1 Manfaat

- request latency lebih stabil,
- IO dipindahkan ke background,
- batching lebih mungkin,
- throughput logging lebih baik,
- contention berkurang di request path.

### 12.2 Trade-Off

- queue bisa penuh,
- log bisa hilang saat crash,
- ordering bisa tidak intuitif,
- MDC harus di-capture benar,
- memory bisa naik,
- shutdown harus flush,
- backpressure behavior harus dipilih.

Async logging bukan “free performance”. Ia menukar **latency producer** dengan **queueing risk**.

---

## 13. Logback AsyncAppender Cost Model

Logback `AsyncAppender` adalah queue-based appender wrapper.

Flow mental:

```text
application thread
  -> AsyncAppender.append(event)
  -> preprocess event
  -> enqueue into blocking queue
  -> return

worker thread
  -> take event
  -> delegate to attached appender
```

### 13.1 Parameter Penting

| Parameter | Meaning | Risk |
|---|---|---|
| `queueSize` | kapasitas queue | terlalu kecil drop/block, terlalu besar memory |
| `discardingThreshold` | mulai discard event level rendah saat queue hampir penuh | kehilangan INFO/DEBUG/WARN tergantung config |
| `neverBlock` | jangan block producer saat queue penuh | log bisa hilang |
| `includeCallerData` | capture caller data | mahal |
| `maxFlushTime` | waktu flush saat shutdown | terlalu kecil log hilang |

### 13.2 Queue Size

Queue terlalu kecil:

- mudah penuh saat burst,
- log ter-drop atau producer block.

Queue terlalu besar:

- memory naik,
- OOM risk saat log storm,
- delay log tinggi,
- incident signal telat muncul.

Rule:

> Queue size bukan solusi untuk log storm permanen. Queue hanya buffer untuk burst sementara.

### 13.3 Discarding Threshold

Logback dapat membuang event level rendah saat queue hampir penuh. Dokumentasi Logback menyebut event loss dapat dicegah dengan `discardingThreshold=0`, tetapi konsekuensinya producer lebih mungkin block saat queue penuh.

Trade-off:

```text
preserve logs -> risk application slowdown
protect app latency -> risk log loss
```

Tidak ada pilihan universal.

### 13.4 neverBlock

`neverBlock=true` berarti producer tidak block jika queue penuh. Ini melindungi latency aplikasi, tetapi log dapat hilang.

Cocok untuk:

- diagnostic logs,
- INFO/DEBUG high-volume,
- service yang lebih penting melayani request daripada mempertahankan semua log.

Tidak cocok untuk:

- audit log wajib,
- security event critical,
- financial/legal event,
- forensic event yang harus durable.

### 13.5 Production Config Example

```xml
<appender name="JSON_CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LoggingEventCompositeJsonEncoder">
        <!-- providers omitted for brevity -->
    </encoder>
</appender>

<appender name="ASYNC_JSON" class="ch.qos.logback.classic.AsyncAppender">
    <queueSize>${LOG_ASYNC_QUEUE_SIZE:-8192}</queueSize>
    <discardingThreshold>${LOG_DISCARDING_THRESHOLD:-0}</discardingThreshold>
    <neverBlock>${LOG_NEVER_BLOCK:-false}</neverBlock>
    <includeCallerData>false</includeCallerData>
    <maxFlushTime>5000</maxFlushTime>
    <appender-ref ref="JSON_CONSOLE" />
</appender>

<root level="INFO">
    <appender-ref ref="ASYNC_JSON" />
</root>
```

Catatan:

- `discardingThreshold=0` mengurangi silent loss tetapi bisa block.
- Untuk latency-critical API, mungkin `neverBlock=true` dipilih dengan observability bahwa drops terjadi.
- Untuk audit/security, jangan gabungkan dengan lossy async appender tanpa durability strategy.

---

## 14. Log4j2 Async Logger Cost Model

Log4j2 menyediakan dua async mechanism:

1. `AsyncAppender`: queue-based wrapper.
2. `AsyncLogger`: async logger berbasis LMAX Disruptor.

Log4j2 documentation menjelaskan asynchronous logging memindahkan IO ke thread berbeda. Async Logger biasanya lebih performan daripada async appender karena desain ring buffer/disruptor.

### 14.1 AsyncAppender vs AsyncLogger

| Aspect | AsyncAppender | AsyncLogger |
|---|---|---|
| Position | appender wrapper | logger pipeline itself |
| Structure | blocking queue | ring buffer / Disruptor |
| Performance | baik | biasanya lebih tinggi |
| Configuration | per appender | global/mixed async logger |
| Complexity | sedang | lebih advanced |

### 14.2 Ring Buffer

AsyncLogger menggunakan ring buffer sebagai buffer event.

Producer menulis event ke slot ring buffer, consumer membaca dan menulis ke appender.

Keunggulan:

- throughput tinggi,
- latency rendah,
- allocation dapat dikurangi,
- lock contention rendah.

Risiko:

- ring buffer penuh,
- wait strategy salah untuk workload,
- event mutable data issue,
- shutdown flush,
- include location mahal.

### 14.3 Wait Strategy

Wait strategy menentukan bagaimana consumer menunggu event baru.

Pilihan dapat berdampak pada:

- latency,
- CPU usage,
- power consumption,
- throughput.

Secara umum:

- busy spin lebih rendah latency tetapi CPU tinggi,
- blocking lebih hemat CPU tetapi latency bisa lebih tinggi,
- sleep/yield di tengah-tengah.

Production rule:

> Jangan optimize wait strategy sebelum punya profiling/load test. Default biasanya cukup baik.

### 14.4 Include Location

Log4j2 async logger dengan location info dapat mahal karena caller location harus diambil sebelum event berpindah thread.

Rule sama:

- hindari location info default di production,
- aktifkan targeted dan sementara.

---

## 15. Garbage-Free Logging

Log4j2 punya dukungan garbage-free/low-garbage logging. Dokumentasi Log4j2 menjelaskan garbage-free logging membutuhkan konfigurasi core serta layout/appender/filter yang mendukung, dan Log4j2 memiliki mode garbage-free/low-garbage untuk mengurangi temporary allocation.

### 15.1 Apa Arti Garbage-Free

Garbage-free bukan berarti tidak ada object sama sekali dalam seluruh aplikasi.

Artinya logging framework berusaha:

- reuse buffers,
- reuse message objects,
- menghindari temporary allocation,
- mengurangi GC pressure pada steady-state logging.

### 15.2 Batasannya

Garbage-free bisa rusak jika:

- aplikasi membuat string sendiri sebelum logging,
- argument `toString()` allocate besar,
- layout tidak garbage-free,
- appender tidak cocok,
- exception stack trace dirender besar,
- JSON provider custom allocate banyak,
- message mutable berubah sebelum async consumer render.

### 15.3 Mutable Object Risk

Buruk:

```java
Map<String, Object> data = new HashMap<>();
data.put("status", "STARTED");
log.info("processing data={}", data);
data.put("status", "COMPLETED");
```

Pada async logging, tergantung kapan object dirender, log bisa mencerminkan state yang sudah berubah.

Lebih aman:

```java
log.info("processing status={}", "STARTED");
```

atau snapshot immutable kecil:

```java
log.info("processing data={}", Map.copyOf(data));
```

Namun `Map.copyOf` sendiri punya allocation. Pilih field eksplisit jika hot path.

---

## 16. Locking and Contention

Logging dapat menciptakan lock contention.

Sumber lock:

- synchronized appender,
- file writer lock,
- encoder buffer lock,
- queue lock,
- stdout stream lock,
- rolling file lock,
- compression lock,
- logger context reconfiguration,
- MDC map operations,
- log collector pipe.

### 16.1 Symptoms

- banyak thread `BLOCKED` pada logging class,
- request latency naik saat log volume naik,
- CPU tidak terlalu tinggi tapi throughput turun,
- thread dump menunjukkan `PrintStream.write`, appender lock, file output stream,
- async queue penuh.

### 16.2 Thread Dump Pattern

Contoh indikasi:

```text
"http-nio-8080-exec-123" BLOCKED
  at java.io.PrintStream.write(PrintStream.java:...)
  - waiting to lock <...> (a java.io.PrintStream)
  at ch.qos.logback.core.joran.spi.ConsoleTarget$1.write(...)
  at ch.qos.logback.core.OutputStreamAppender.writeBytes(...)
```

Atau:

```text
"pool-1-thread-42" WAITING
  at java.util.concurrent.ArrayBlockingQueue.put(...)
  at ch.qos.logback.classic.AsyncAppenderBase.put(...)
```

Interpretasi:

- producer thread block karena async queue penuh,
- atau synchronous console/file write menjadi bottleneck.

### 16.3 Mitigation

- kurangi volume log,
- gunakan async logger/appender,
- matikan caller data,
- sampling/rate limit error storm,
- ubah stdout/file strategy,
- pisahkan audit log dari diagnostic log,
- sizing queue berdasarkan burst,
- observability untuk queue/drop/block.

---

## 17. Backpressure vs Dropping

Saat log producer lebih cepat daripada log consumer, ada tiga pilihan:

1. **Block producer**.
2. **Drop logs**.
3. **Crash/OOM eventually** jika buffer tumbuh tak terkendali.

Pilihan ketiga adalah kegagalan desain.

### 17.1 Block Producer

Kelebihan:

- log lebih lengkap,
- tidak silent loss,
- backpressure jelas.

Kekurangan:

- user request bisa lambat,
- thread pool bisa habis,
- cascading failure.

Cocok untuk:

- audit-critical event dengan volume rendah,
- batch offline,
- sistem yang lebih memilih berhenti daripada kehilangan evidence.

### 17.2 Drop Logs

Kelebihan:

- aplikasi tetap melayani request,
- log storm tidak langsung menjatuhkan aplikasi.

Kekurangan:

- observability gap,
- forensic evidence hilang,
- incident debugging lebih sulit.

Cocok untuk:

- DEBUG/INFO noisy logs,
- diagnostic event non-critical,
- high-volume request event yang sudah diwakili metrics/traces.

### 17.3 Hybrid Strategy

Production-grade strategy biasanya hybrid:

- audit/security log: durable, low-volume, not lossy.
- application diagnostic log: async, may drop low-value event under pressure.
- metrics: aggregate error storm.
- traces: sampled + error-biased.
- incident mode: temporary increased logging with time limit.

---

## 18. Log Storm

Log storm adalah kondisi ketika sistem menghasilkan log jauh lebih banyak daripada normal.

Penyebab:

- dependency down,
- retry loop,
- validation spam,
- bad deployment,
- debug enabled accidentally,
- exception logged at multiple layers,
- poison message infinite retry,
- health check failure every second,
- circuit breaker open logged per request,
- DB pool timeout logged with full stack trace.

### 18.1 Log Storm Failure Chain

```text
dependency slow
  -> request timeout
  -> every request logs ERROR stack trace
  -> stdout/file throughput saturated
  -> request threads block in logging
  -> latency increases
  -> more timeouts
  -> more logs
  -> collector/indexer overloaded
  -> dashboards delayed
  -> incident harder to diagnose
```

### 18.2 Prevention

- stack trace once rule,
- rate-limited logging,
- circuit breaker state-change logging,
- retry summary instead of every attempt,
- metrics for counts,
- sampling for repetitive errors,
- deduplication key,
- disable payload logging by default,
- production guardrails for DEBUG/TRACE.

### 18.3 Rate-Limited Logging Pattern

Pseudo-pattern:

```java
if (rateLimiter.tryAcquire()) {
    log.warn("dependency unavailable dependency.name={} error.type={} suppressed.count={}",
            dependencyName,
            errorType,
            suppressedCounter.getAndSet(0));
} else {
    suppressedCounter.incrementAndGet();
}
```

Important:

- jangan hanya drop silently,
- catat suppressed count,
- expose metric juga.

---

## 19. Logging in Hot Paths

Hot path adalah path yang dieksekusi sangat sering.

Contoh:

- per item loop,
- per row mapping,
- per cache lookup,
- per validation field,
- per message polling,
- per DB row streaming,
- per serialization field,
- per reactive signal.

### 19.1 Anti-Pattern

```java
for (OrderLine line : order.lines()) {
    log.info("Processing line orderId={} lineId={} sku={}", orderId, line.id(), line.sku());
    process(line);
}
```

Jika order punya 500 lines dan ada 100 RPS, ini 50.000 logs/detik.

Lebih baik:

```java
log.info("processing order lines started order.id={} line.count={}", orderId, order.lines().size());

int success = 0;
int failed = 0;
for (OrderLine line : order.lines()) {
    try {
        process(line);
        success++;
    } catch (Exception e) {
        failed++;
        log.warn("order line failed order.id={} line.id={} reason={}", orderId, line.id(), classify(e));
    }
}

log.info("processing order lines completed order.id={} success.count={} failed.count={}",
        orderId, success, failed);
```

### 19.2 Loop Logging Rule

Log di loop hanya jika:

- error/exception spesifik perlu forensic evidence,
- sampling digunakan,
- volume bounded,
- event memiliki nilai bisnis/diagnostic tinggi.

Untuk progress, gunakan aggregate summary.

---

## 20. Retry Logging Performance

Retry sering menyebabkan log multiplication.

Buruk:

```java
for (int attempt = 1; attempt <= 3; attempt++) {
    try {
        return client.call();
    } catch (IOException e) {
        log.error("External call failed attempt={}", attempt, e);
    }
}
```

Jika 2.000 RPS dan dependency down, 3 attempts berarti 6.000 stack traces/detik.

Lebih baik:

```java
IOException last = null;
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        return client.call();
    } catch (IOException e) {
        last = e;
        log.warn("external call attempt failed dependency.name={} attempt={} max.attempts={} reason={}",
                dependencyName, attempt, maxAttempts, e.getClass().getSimpleName());
    }
}

log.error("external call exhausted dependency.name={} attempts={} error.type={}",
        dependencyName, maxAttempts, last.getClass().getName(), last);
throw last;
```

Even better:

- log attempts at DEBUG or sampled WARN,
- log final failure once,
- metrics counter for attempts/failures,
- trace events for attempts if sampled.

---

## 21. Logging and Virtual Threads

Java 21 introduced virtual threads as a stable feature. Java 25 ecosystem continues to normalize virtual-thread based services.

Virtual threads change cost perception:

- thread count can be much higher,
- thread name in logs may be less meaningful,
- ThreadLocal/MDC usage must be disciplined,
- blocking logging still blocks the virtual thread, but carrier thread behavior and IO path matter,
- high virtual-thread concurrency can generate much higher log burst.

### 21.1 Virtual Threads Do Not Make Logging Free

Virtual threads make blocking cheaper from thread scalability perspective, not from IO throughput perspective.

If 100.000 virtual threads log at once:

- stdout still has finite throughput,
- appender queue still finite,
- collector still finite,
- CPU serialization still finite,
- storage still finite.

### 21.2 MDC with Virtual Threads

MDC backed by ThreadLocal can work, but:

- set/clear lifecycle must be correct,
- avoid huge context maps,
- avoid inheritable context surprises,
- prefer explicit context propagation or ScopedValue where appropriate.

### 21.3 Rule

With virtual threads:

- log less per logical operation,
- rely more on metrics/traces for high-cardinality flow,
- keep MDC small,
- avoid per-thread logger state,
- test burst behavior.

---

## 22. Logging and Garbage Collectors

Logging allocation interacts with GC.

### 22.1 G1

Logging allocation can increase young GC frequency. Large string/byte arrays can create humongous allocations.

Symptoms:

- allocation rate spikes with log rate,
- young GC frequency increases,
- pause p95/p99 worsens,
- CPU spent in GC rises.

### 22.2 ZGC/Shenandoah

Low-pause collectors reduce pause impact, but allocation still consumes CPU and memory bandwidth.

Logging can still hurt:

- CPU saturation,
- memory pressure,
- native buffer pressure,
- IO bottleneck,
- collector/indexer cost.

### 22.3 GC Logs + Application Logs

During incident, correlate:

- app log rate,
- error log rate,
- allocation rate,
- GC frequency,
- request latency,
- CPU,
- stdout/file IO.

A sudden error storm can show as both log rate increase and allocation/GC increase.

---

## 23. Observing the Logging Subsystem

A mature system observes its observability subsystem.

Metrics to expose/collect:

| Metric | Meaning |
|---|---|
| log events by level | volume trend |
| log events by logger/category | noisy component |
| async queue size | backlog |
| async queue remaining capacity | saturation |
| dropped log count | evidence loss |
| appender error count | output failure |
| encode duration | formatting bottleneck |
| write duration | IO bottleneck |
| log bytes/sec | cost/storage pressure |
| collector ingest lag | pipeline delay |
| indexer rejection count | backend overload |

Frameworks may not expose all of these directly. You may need:

- custom appender wrapper,
- status listener,
- collector metrics,
- sidecar/agent metrics,
- log platform metrics,
- synthetic checks.

### 23.1 Dropped Logs Must Be Visible

If using lossy async logging, dropped logs must be observable.

Silent dropping is dangerous.

At minimum:

- expose metric,
- emit periodic summary,
- alert if drop rate exceeds threshold.

---

## 24. Benchmarking Logging

Benchmarking logging is tricky.

### 24.1 Common Benchmark Mistakes

- benchmark disabled logs only,
- benchmark without realistic MDC,
- benchmark without JSON layout,
- benchmark without exception rendering,
- benchmark writing to `/dev/null`,
- benchmark single thread only,
- ignore warmup/JIT,
- ignore disk/stdout/container runtime,
- ignore collector/indexer.

### 24.2 What to Benchmark

Scenarios:

1. Disabled DEBUG log in hot path.
2. Enabled INFO log with 3 fields.
3. Enabled JSON log with MDC.
4. ERROR log with stack trace.
5. Burst logging with async queue.
6. Queue full behavior.
7. Stdout in container.
8. Rolling file under load.
9. Collector slow/down behavior.
10. Log storm simulation.

### 24.3 Measurement Dimensions

Measure:

- application throughput,
- request latency p50/p95/p99,
- CPU,
- allocation rate,
- GC frequency,
- async queue size,
- dropped logs,
- bytes/sec,
- collector lag,
- storage/indexing cost.

### 24.4 JMH for Micro Cost

JMH can help compare:

- string concatenation vs parameterized logging,
- disabled vs enabled,
- guarded vs unguarded expensive argument,
- pattern vs JSON layout.

But JMH does not replace full-system load testing.

---

## 25. Production Logging Performance Design

A production-grade logging design separates event classes by criticality.

### 25.1 Event Classes

| Class | Example | Loss tolerance | Strategy |
|---|---|---:|---|
| Audit | decision approved/rejected | very low | durable, low-volume |
| Security | auth failure, privilege change | low | secure routing, alerting |
| Error diagnostic | unexpected exception | medium-low | log once, stack trace |
| Operational | startup, config, dependency status | medium | INFO/WARN |
| Request summary | inbound completed | medium | sampled or INFO depending volume |
| Debug diagnostic | internal decisions | high | DEBUG, temporary |
| Trace-level detail | protocol internals | very high | off by default |

### 25.2 Separate Pipelines

Do not force all events into one behavior.

Possible architecture:

```text
application diagnostic logs
  -> async stdout JSON
  -> node collector
  -> log platform

audit/security events
  -> dedicated appender/channel
  -> stricter retention/access/tamper policy

metrics
  -> OpenTelemetry/Micrometer
  -> metrics backend

traces
  -> OTel agent/SDK
  -> collector
  -> trace backend
```

### 25.3 Do Not Use Logs for Everything

Use metrics for counts and rates.
Use traces for causal request flow.
Use logs for semantic events and forensic details.
Use profiles/JFR for runtime resource behavior.

If you log every event only to count them later, you may be using the wrong signal.

---

## 26. Practical Patterns

### 26.1 Cheap Diagnostic Log

```java
log.info("case transition completed case.id={} from.state={} to.state={} outcome={}",
        caseId, fromState, toState, "success");
```

Properties:

- bounded fields,
- no payload dump,
- low-cardinality state names,
- useful for timeline.

### 26.2 Expensive Payload Log Behind Guard

```java
if (log.isDebugEnabled()) {
    log.debug("case transition evaluation details case.id={} details={}",
            caseId,
            evaluationDebugView(caseContext));
}
```

### 26.3 SLF4J 2.x Structured Event

```java
log.atInfo()
   .setMessage("case transition completed")
   .addKeyValue("event.name", "case.transition.completed")
   .addKeyValue("case.id", caseId)
   .addKeyValue("from.state", fromState)
   .addKeyValue("to.state", toState)
   .addKeyValue("outcome", "success")
   .log();
```

### 26.4 Error Once at Boundary

```java
try {
    service.submit(command);
} catch (CaseTransitionException e) {
    log.warn("case transition rejected case.id={} reason={} current.state={} requested.action={}",
            e.caseId(), e.reasonCode(), e.currentState(), e.requestedAction());
    throw e;
} catch (Exception e) {
    log.error("case submission failed case.id={} command.id={} error.type={}",
            command.caseId(), command.commandId(), e.getClass().getName(), e);
    throw e;
}
```

### 26.5 Retry Summary

```java
RetrySummary summary = retryExecutor.execute(() -> externalClient.call(request));

if (summary.succeededAfterRetry()) {
    log.warn("external call succeeded after retry dependency.name={} attempts={} duration.ms={}",
            dependencyName, summary.attempts(), summary.durationMillis());
}
```

---

## 27. Troubleshooting: Logging Is the Bottleneck

### 27.1 Symptoms

- latency naik saat log volume naik,
- CPU tinggi di logging/layout/JSON classes,
- thread dump blocked/waiting di appender/queue/stdout,
- async queue penuh,
- dropped logs muncul,
- pod CPU throttled saat error storm,
- disk usage naik cepat,
- collector lag,
- log platform ingestion delay,
- application improves when log level lowered.

### 27.2 Investigation Steps

1. Check log volume by level and logger.
2. Check recent deployment/config change.
3. Check whether DEBUG/TRACE accidentally enabled.
4. Check error storm and stack trace rate.
5. Take thread dumps.
6. Run JFR or async-profiler if safe.
7. Inspect async queue metrics/status.
8. Check stdout/file IO throughput.
9. Check container CPU throttling and memory.
10. Check collector/indexer lag.
11. Reduce logging temporarily if needed.
12. Apply permanent semantic/rate/sampling fix.

### 27.3 Thread Dump Questions

Ask:

- Are many request threads inside logging framework?
- Are they blocked on queue `put`?
- Are they blocked on `PrintStream` or file write?
- Are async workers stuck on slow destination?
- Are there reconfiguration locks?
- Are rolling/compression operations blocking?

### 27.4 JFR Questions

Ask:

- Which methods allocate most?
- Is stack trace rendering visible?
- Is JSON encoding hot?
- Are threads blocked on logging locks?
- Is file/socket IO slow?
- Did GC allocation pressure rise with log rate?

---

## 28. Java 8–25 Notes

### Java 8

- Older logging stacks common.
- JFR availability differs by distribution/update lineage.
- Unified GC logging not available like Java 9+.
- More legacy Log4j 1.x/reload4j risk in old systems.
- ThreadLocal/MDC with classic pools dominates.

### Java 11

- Strong baseline for modern services.
- JFR generally available in OpenJDK era.
- Unified logging available.
- Better container awareness than Java 8.

### Java 17

- Common LTS baseline.
- Stronger container ergonomics.
- Modern Spring Boot 3 ecosystem begins at Java 17.

### Java 21

- Virtual threads stable.
- Structured concurrency preview era.
- Logging burst potential increases with concurrency.
- Thread naming and MDC strategy need review.

### Java 25

- Modern Java baseline with continued virtual-thread-oriented ecosystem.
- Scoped Values finalized via JEP 506, useful for immutable context propagation alternatives.
- Observability libraries continue adapting to virtual thread workloads.

---

## 29. Production Checklist

### Code-Level Checklist

- [ ] No string concatenation in disabled log paths.
- [ ] Expensive debug arguments guarded or lazy.
- [ ] No large domain object serialization in hot logs.
- [ ] Stack trace logged once per unexpected failure.
- [ ] Expected failures do not log stack traces.
- [ ] Retry logs are summarized or sampled.
- [ ] Loop logs are bounded or aggregated.
- [ ] MDC is small and cleaned up.
- [ ] Caller data disabled by default.
- [ ] Structured fields are query-worthy.

### Config-Level Checklist

- [ ] Async behavior intentionally chosen.
- [ ] Queue size configured based on burst, not as infinite buffer.
- [ ] Drop/block policy documented.
- [ ] Dropped logs observable.
- [ ] File rolling/retention configured if using file logs.
- [ ] JSON logs are one-line and collector-friendly.
- [ ] DEBUG/TRACE disabled in production by default.
- [ ] Sensitive data redaction enabled.
- [ ] Audit/security pipeline separated if needed.

### Runtime Checklist

- [ ] Log volume monitored by level/logger.
- [ ] Log bytes/sec monitored.
- [ ] Collector lag monitored.
- [ ] Appender errors visible.
- [ ] Async queue saturation visible.
- [ ] Incident mode logging has TTL/timebox.
- [ ] Runbook includes logging bottleneck diagnosis.

---

## 30. Mini Case Study: Error Storm Becomes Latency Incident

### Scenario

A Java service calls external identity provider.

At 10:00, identity provider latency rises.

The application has retry policy:

- max attempts: 3,
- timeout: 2 seconds,
- logs every failed attempt as ERROR with stack trace.

Request rate: 1.500 RPS.

### What Happens

Per request:

- attempt 1 fails -> ERROR stack trace,
- attempt 2 fails -> ERROR stack trace,
- attempt 3 fails -> ERROR stack trace,
- final failure logged again at controller.

Total log rate:

```text
1.500 RPS * 4 stack traces = 6.000 stack traces/sec
```

### Impact

- CPU spent rendering stack traces,
- stdout throughput saturated,
- request threads block in logging,
- async queue fills,
- logs dropped,
- GC allocation rises,
- latency worsens,
- more timeouts occur,
- log platform ingestion delayed.

### Better Design

- attempt failures logged at DEBUG or sampled WARN without stack trace,
- final exhausted retry logged once with stack trace,
- circuit breaker state change logged,
- metric tracks failure rate and retry attempts,
- trace span events record retry attempts for sampled traces,
- dependency health dashboard shows degradation.

Example final log:

```java
log.error("external dependency call failed dependency.name={} attempts={} timeout.ms={} error.type={}",
        "identity-provider",
        attempts,
        timeoutMs,
        last.getClass().getName(),
        last);
```

Example state-change log:

```java
log.warn("circuit breaker opened dependency.name={} failure.rate={} window.size={}",
        "identity-provider",
        failureRate,
        windowSize);
```

---

## 31. Practical Labs

### Lab 1 — Disabled Log Cost

Implement three variants:

1. String concatenation.
2. Parameterized logging.
3. Guarded expensive argument.

Measure using JMH or simple allocation profiler.

Expected learning:

- disabled log can still be expensive,
- Java argument evaluation matters,
- parameterized logging is not magic for expensive method calls.

### Lab 2 — Async Queue Saturation

Configure Logback `AsyncAppender` with small queue.

Generate burst logs.

Observe:

- blocking behavior,
- discarding behavior,
- effect of `neverBlock`,
- request latency.

### Lab 3 — Stack Trace Storm

Create endpoint that throws exception under load.

Compare:

1. stack trace at every layer,
2. stack trace once at boundary,
3. sampled stack traces.

Measure:

- log bytes/sec,
- CPU,
- allocation,
- latency.

### Lab 4 — JSON vs Pattern Layout

Compare:

- pattern text log,
- JSON log with selected fields,
- JSON log with large payload.

Measure:

- allocation,
- log size,
- query usefulness.

### Lab 5 — Logging Bottleneck Thread Dump

Create slow appender or slow stdout simulation.

Take thread dumps.

Identify:

- blocked producer threads,
- async queue behavior,
- logging worker bottleneck.

---

## 32. Key Takeaways

1. Logging has real runtime cost.
2. Disabled logs can still be expensive if arguments are expensive.
3. Enabled logs cost CPU, allocation, formatting, context capture, and IO.
4. Stack traces are high-value but high-cost; log them intentionally.
5. Caller data is expensive and rarely needed in every production log.
6. JSON structured logging improves queryability but must be schema-disciplined.
7. Async logging reduces producer latency but introduces queue/drop/flush risks.
8. Backpressure strategy must be explicit: block, drop, or separate pipelines.
9. Log storm can turn a dependency incident into an application outage.
10. A top-tier engineer observes the logging subsystem itself.

---

## 33. References

- SLF4J Manual — parameterized logging, fluent API, facade model: https://www.slf4j.org/manual.html
- SLF4J FAQ — performance rationale for parameterized logging: https://www.slf4j.org/faq.html
- Logback Manual — appenders and AsyncAppender behavior: https://logback.qos.ch/manual/appenders.html
- Logback Manual — architecture and configuration model: https://logback.qos.ch/manual/architecture.html
- Apache Log4j2 Manual — asynchronous loggers: https://logging.apache.org/log4j/2.x/manual/async.html
- Apache Log4j2 Manual — garbage-free logging: https://logging.apache.org/log4j/2.x/manual/garbagefree.html
- Apache Log4j2 Manual — JSON Template Layout: https://logging.apache.org/log4j/2.x/manual/json-template-layout.html
- OpenJDK JEP 506 — Scoped Values finalized in JDK 25: https://openjdk.org/jeps/506

---

## 34. Status Series

Selesai sampai: **Part 17 — Logging Performance: Cost Model, Allocation, Locking, IO, Backpressure**.

Seri belum selesai.

Berikutnya:

**Part 18 — Secure Logging: PII, Secrets, Injection, Compliance, Auditability**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./16-logs-traces-metrics-correlation.md">⬅️ Part 16 — Logs + Traces + Metrics Correlation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./18-secure-logging-pii-secrets-injection-compliance-auditability.md">Part 18 — Secure Logging: PII, Secrets, Injection, Compliance, Auditability ➡️</a>
</div>
