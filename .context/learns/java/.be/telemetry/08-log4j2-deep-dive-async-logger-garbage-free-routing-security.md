# Part 8 — Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Fokus: Log4j2 advanced runtime architecture, async logger, Disruptor, garbage-free logging, routing/failover, dan security hardening.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas Log4j2 dari sisi arsitektur dasar: `log4j-api`, `log4j-core`, configuration discovery, logger hierarchy, appender, layout, filter, dan JSON logging.

Bagian ini masuk ke level yang lebih dalam: **bagaimana Log4j2 berperilaku ketika logging volume tinggi, latency sensitif, sistem sedang overload, atau aplikasi harus memenuhi standar keamanan produksi**.

Setelah menyelesaikan bagian ini, targetnya bukan hanya bisa menulis konfigurasi Log4j2, tetapi mampu menjawab pertanyaan seperti:

1. Kapan harus memakai synchronous logger, `AsyncAppender`, atau `AsyncLogger`?
2. Apa yang terjadi ketika async ring buffer penuh?
3. Kenapa logging bisa menjadi sumber latency, allocation pressure, GC pressure, bahkan outage?
4. Apa arti garbage-free logging di Log4j2?
5. Apa saja syarat agar garbage-free logging benar-benar terjadi?
6. Bagaimana cara routing log event ke destination berbeda tanpa membuat high-cardinality disaster?
7. Bagaimana mendesain failover logging tanpa menyembunyikan kegagalan appender?
8. Bagaimana hardening Log4j2 setelah pelajaran Log4Shell?
9. Bagaimana membuat configuration standard yang aman untuk Java 8 sampai Java 25?
10. Bagaimana melakukan troubleshooting kalau log hilang, terlambat, duplicate, corrupt, atau membuat aplikasi lambat?

Mental model utama bagian ini:

```text
Logging is not free.
Async logging is not magic.
Structured logging is not automatically safe.
Routing is powerful but dangerous.
Security hardening is part of logging design, not an afterthought.
```

---

## 1. Big Picture: Log4j2 Sebagai High-Throughput Event Pipeline

Secara konseptual, Log4j2 adalah pipeline:

```text
Application Code
    |
    | logger.info(...)
    v
Log4j2 API / SLF4J Facade
    |
    v
Logger / LoggerConfig
    |
    | level check
    | filter check
    | context capture
    v
LogEvent
    |
    +------------------------+
    |                        |
    v                        v
Synchronous path         Asynchronous path
    |                        |
    v                        v
Appender(s)             Disruptor Ring Buffer
    |                        |
    v                        v
Layout                  Background logging thread
    |                        |
    v                        v
Destination             Appender(s)
                             |
                             v
                         Layout
                             |
                             v
                         Destination
```

Destination dapat berupa:

- stdout/stderr,
- file,
- rolling file,
- socket,
- HTTP collector,
- failover chain,
- routing appender,
- queue/log forwarder,
- custom appender.

Yang sering dilupakan: setiap tahap punya biaya.

| Tahap | Potensi biaya |
|---|---|
| Level check | sangat kecil, tapi tetap ada |
| Argument evaluation | bisa mahal jika ekspresi dievaluasi sebelum logging call |
| Message formatting | allocation, CPU |
| Capturing caller location | stack walking, mahal |
| Capturing Throwable | stack trace construction sudah terjadi saat exception dibuat; rendering stack trace tetap mahal |
| Context map copy | allocation/copy overhead |
| JSON serialization | CPU dan allocation jika tidak hati-hati |
| Async enqueue | ring buffer contention/backpressure |
| Appender IO | disk/stdout/network latency |
| Rolling/compression | CPU dan IO burst |
| Flush/sync | latency tinggi |

Prinsip besar:

> Logging harus didesain sebagai subsystem produksi, bukan sebagai efek samping kode aplikasi.

---

## 2. Synchronous Logging vs AsyncAppender vs AsyncLogger

Log4j2 punya beberapa mode logging yang sering disamakan padahal berbeda.

### 2.1 Synchronous Logger

Pada synchronous logger, thread aplikasi yang memanggil `logger.info(...)` juga menjalankan proses logging sampai appender menulis event ke destination.

```text
request thread
  -> create log event
  -> layout formatting
  -> write stdout/file/network
  -> return to application flow
```

Kelebihan:

- sederhana,
- ordering lebih mudah dipahami,
- failure lebih langsung terlihat,
- tidak ada async buffer yang bisa penuh,
- cocok untuk low/medium volume.

Kekurangan:

- request thread membayar biaya IO,
- latency aplikasi bisa naik karena logging,
- appender lambat langsung memperlambat business path,
- dapat memperparah incident ketika sistem sudah overload.

Cocok untuk:

- aplikasi kecil,
- batch sederhana,
- local development,
- sistem dengan log volume rendah,
- audit log yang harus strict dan tidak boleh drop.

Tidak cocok untuk:

- high-throughput HTTP service,
- low-latency service,
- aplikasi dengan log burst tinggi,
- service yang log ke destination lambat.

---

### 2.2 AsyncAppender

`AsyncAppender` membungkus appender lain dengan queue asynchronous.

```text
application thread
  -> create log event
  -> enqueue to AsyncAppender queue
  -> return

background thread
  -> dequeue
  -> delegate to real appender
  -> layout/write
```

Mental model:

```text
Logger masih synchronous sampai event masuk ke AsyncAppender.
Appender downstream dijalankan oleh background thread.
```

Kelebihan:

- mudah diterapkan,
- bisa membuat appender lambat tidak langsung memblokir request thread,
- cocok untuk wrapping file/network appender,
- konfigurasi relatif sederhana.

Kekurangan:

- masih ada sebagian cost di application thread,
- memakai queue biasa, bukan full async logger architecture,
- bisa drop/block tergantung konfigurasi,
- jika queue penuh, aplikasi tetap terdampak,
- caller location/context capture tetap perlu dipahami.

Cocok untuk:

- service existing yang ingin mengurangi impact appender lambat,
- transisi dari sync ke async,
- appender tertentu yang ingin diisolasi.

---

### 2.3 AsyncLogger

`AsyncLogger` adalah mode asynchronous di level logger, menggunakan LMAX Disruptor ring buffer.

```text
application thread
  -> level check
  -> capture event data
  -> publish to Disruptor ring buffer
  -> return

async logger thread
  -> consume event
  -> run LoggerConfig/appender pipeline
  -> layout/write
```

Log4j2 async logger didesain untuk throughput dan latency lebih baik daripada queue-based async appender.

Kelebihan:

- high throughput,
- lower latency pada banyak skenario,
- memindahkan lebih banyak pekerjaan ke background thread,
- Disruptor ring buffer lebih efisien daripada blocking queue biasa,
- mendukung garbage-free mode lebih baik.

Kekurangan:

- lebih kompleks,
- ring buffer tetap bisa penuh,
- ordering perlu dipahami,
- include location mahal,
- error handling appender bisa terasa jauh dari thread aplikasi,
- shutdown/flush harus benar,
- perlu dependency Disruptor.

Cocok untuk:

- high-throughput backend,
- latency-sensitive services,
- logging volume besar,
- JSON structured logging yang ingin di-offload,
- aplikasi yang sudah memiliki observability discipline.

Tidak otomatis cocok untuk:

- audit log yang harus durable strict,
- aplikasi yang tidak boleh kehilangan event sama sekali,
- sistem dengan appender downstream sangat lambat tanpa backpressure policy,
- environment yang tidak mengelola shutdown dengan baik.

---

## 3. AsyncAppender vs AsyncLogger: Perbedaan Penting

| Aspek | AsyncAppender | AsyncLogger |
|---|---|---|
| Level async | Appender layer | Logger layer |
| Data structure | Queue | Disruptor ring buffer |
| Tujuan utama | Isolasi appender lambat | High-throughput async logging |
| Scope | Per appender config | Bisa global/mixed |
| Complexity | Sedang | Lebih tinggi |
| Performance | Baik | Umumnya lebih baik untuk high volume |
| Dependency | Core Log4j2 | Membutuhkan Disruptor untuk async logger |
| Context/caller capture | Perlu hati-hati | Perlu lebih hati-hati |
| Failure behavior | Queue full/drop/block | Ring buffer full/block/policy |

Prinsip pemilihan:

```text
Default production app small/medium: synchronous stdout JSON bisa cukup.
High-throughput service: pertimbangkan AsyncLogger.
Appender tertentu lambat: AsyncAppender bisa cukup.
Audit/security critical logs: jangan asal async-drop.
```

---

## 4. LMAX Disruptor Mental Model

AsyncLogger Log4j2 memakai LMAX Disruptor. Tidak perlu memahami semua detail internal Disruptor, tetapi engineer produksi harus memahami mental model berikut.

### 4.1 Ring Buffer

Ring buffer adalah array circular berukuran tetap.

```text
+-----+-----+-----+-----+-----+-----+-----+-----+
|  0  |  1  |  2  |  3  |  4  |  5  |  6  |  7  |
+-----+-----+-----+-----+-----+-----+-----+-----+
   ^                             ^
consumer                      producer
```

Application thread publish event ke slot berikutnya. Background thread consume event dari slot yang sudah tersedia.

### 4.2 Kenapa Ring Buffer Cepat?

Karena:

- preallocated memory,
- predictable access pattern,
- mengurangi allocation,
- mengurangi lock contention,
- komunikasi antar-thread lebih efisien daripada banyak queue tradisional.

Namun cepat bukan berarti tidak terbatas.

### 4.3 Ring Buffer Full

Jika producer lebih cepat daripada consumer, ring buffer akan penuh.

```text
application logging rate > appender drain rate
    -> ring buffer fills
    -> producer cannot publish freely
    -> application thread may block or experience slowdown
```

Ini adalah poin yang sangat penting.

> Async logging hanya memindahkan bottleneck. Ia tidak menghapus bottleneck.

Jika destination logging lambat, buffer hanya memberi waktu tambahan. Setelah penuh, aplikasi tetap harus menghadapi kenyataan: block, drop, atau fail.

### 4.4 Ring Buffer Size

Ring buffer size harus cukup besar untuk menyerap burst, tetapi tidak boleh dianggap sebagai tempat menampung backlog permanen.

Terlalu kecil:

- cepat penuh,
- request thread sering block,
- latency spike.

Terlalu besar:

- memory lebih besar,
- incident lebih sulit terlihat,
- log delay makin panjang,
- shutdown flush lebih lama,
- memberi ilusi sehat padahal downstream tidak sanggup.

Rule of thumb:

```text
Buffer is for burst absorption, not for sustained overload.
```

---

## 5. Mengaktifkan AsyncLogger

Ada beberapa cara mengaktifkan async logger di Log4j2.

### 5.1 Semua Logger Async via System Property

Contoh JVM arg:

```bash
-Dlog4j2.contextSelector=org.apache.logging.log4j.core.async.AsyncLoggerContextSelector
```

Dependency Maven yang umum diperlukan:

```xml
<dependency>
  <groupId>org.apache.logging.log4j</groupId>
  <artifactId>log4j-api</artifactId>
  <version>${log4j2.version}</version>
</dependency>

<dependency>
  <groupId>org.apache.logging.log4j</groupId>
  <artifactId>log4j-core</artifactId>
  <version>${log4j2.version}</version>
</dependency>

<dependency>
  <groupId>com.lmax</groupId>
  <artifactId>disruptor</artifactId>
  <version>${disruptor.version}</version>
</dependency>
```

Jika memakai SLF4J 2.x facade ke Log4j2:

```xml
<dependency>
  <groupId>org.apache.logging.log4j</groupId>
  <artifactId>log4j-slf4j2-impl</artifactId>
  <version>${log4j2.version}</version>
</dependency>
```

Untuk SLF4J 1.7:

```xml
<dependency>
  <groupId>org.apache.logging.log4j</groupId>
  <artifactId>log4j-slf4j-impl</artifactId>
  <version>${log4j2.version}</version>
</dependency>
```

Jangan campur binding/bridge secara sembarangan.

Salah satu kesalahan fatal:

```text
slf4j-api
+ log4j-slf4j2-impl
+ log4j-to-slf4j
```

Itu bisa membuat loop routing.

### 5.2 Mixed Async Logger

Bisa juga membuat logger tertentu async via konfigurasi:

```xml
<Configuration status="WARN">
  <Appenders>
    <Console name="Console" target="SYSTEM_OUT">
      <JsonTemplateLayout />
    </Console>
  </Appenders>

  <Loggers>
    <AsyncLogger name="com.example.highvolume" level="info" additivity="false">
      <AppenderRef ref="Console" />
    </AsyncLogger>

    <Root level="info">
      <AppenderRef ref="Console" />
    </Root>
  </Loggers>
</Configuration>
```

Mixed mode berguna saat hanya sebagian package yang high-volume, tetapi konfigurasi ini juga menambah kompleksitas ordering dan behavior.

### 5.3 Jangan Campur Async Berlapis Tanpa Alasan

Anti-pattern:

```xml
<AsyncLogger name="com.example" level="info">
  <AppenderRef ref="AsyncFile"/>
</AsyncLogger>

<Async name="AsyncFile">
  <AppenderRef ref="File"/>
</Async>
```

Ini membuat async di logger layer lalu async lagi di appender layer.

Konsekuensi:

- latency behavior sulit diprediksi,
- dua buffer bisa penuh dengan cara berbeda,
- shutdown/flush lebih kompleks,
- troubleshooting log loss lebih sulit,
- ordering makin tidak intuitif.

Gunakan satu async boundary yang jelas kecuali ada alasan kuat dan sudah diuji.

---

## 6. AsyncLogger Configuration Knobs

Nama property bisa berubah lintas versi, jadi selalu cek dokumentasi versi yang digunakan. Namun konsep yang perlu dipahami stabil.

### 6.1 Ring Buffer Size

Contoh:

```bash
-Dlog4j2.asyncLoggerRingBufferSize=262144
```

Pertanyaan desain:

- berapa log event per detik saat normal?
- berapa log event per detik saat burst?
- berapa lama downstream appender bisa lambat?
- apakah log boleh delay?
- apakah log boleh drop?
- apakah aplikasi boleh block?

Formula mental sederhana:

```text
required_buffer >= burst_log_rate_per_second * tolerated_burst_seconds
```

Contoh:

```text
Normal log rate: 5,000 events/sec
Burst log rate: 30,000 events/sec
Tolerated burst: 5 sec
Required buffer: 150,000 events
```

Maka ring buffer 262,144 mungkin masuk akal.

Tapi kalau downstream hanya sanggup 5,000/sec sedangkan aplikasi sustained 30,000/sec selama 10 menit, buffer berapa pun akhirnya penuh.

### 6.2 Wait Strategy

Wait strategy mengatur cara consumer menunggu event baru.

Konsep umum:

| Strategy | Karakter |
|---|---|
| blocking | CPU lebih rendah, latency mungkin lebih tinggi |
| sleeping | compromise |
| yielding | latency lebih rendah, CPU lebih tinggi |
| busy spin | latency rendah, CPU tinggi |

Untuk kebanyakan service enterprise, default biasanya cukup. Jangan mengubah wait strategy hanya karena “ingin cepat”. Ukur dulu.

### 6.3 Queue Full Policy

Saat ring buffer penuh, policy menentukan respons.

Pilihan konseptual:

1. block application thread,
2. discard event tertentu,
3. route synchronously,
4. apply custom policy.

Tidak ada pilihan gratis.

| Policy | Dampak |
|---|---|
| Block | log tidak hilang, tetapi latency aplikasi naik |
| Drop | aplikasi tetap jalan, tetapi evidence hilang |
| Sync fallback | caller ikut membayar appender cost |
| Custom | fleksibel, tapi kompleks |

Untuk audit/security critical event, drop biasanya tidak boleh. Untuk high-volume debug diagnostic event, drop bisa diterima.

---

## 7. Include Location: Salah Satu Biaya Termahal

Caller location adalah informasi seperti:

```text
com.example.OrderService.submit(OrderService.java:123)
```

Ini terlihat berguna, tetapi mahal karena perlu stack walking.

Contoh konfigurasi yang mengaktifkan location:

```xml
<AsyncLogger name="com.example" level="info" includeLocation="true">
  <AppenderRef ref="Console" />
</AsyncLogger>
```

Pertimbangan:

- pada high-throughput async logging, `includeLocation=true` bisa merusak performance,
- location sering kurang berguna dibanding `event.name`, `operation`, `module`, `caseId`, `traceId`,
- source location bisa didapat dari logger name dan code search,
- untuk debugging lokal boleh, untuk production default sebaiknya off.

Recommended default:

```text
Production high-throughput service: includeLocation=false
Local/debug environment: includeLocation=true jika benar-benar dibutuhkan
```

---

## 8. Garbage-Free Logging Mental Model

Garbage-free logging berarti logging path berusaha mengurangi atau menghindari object allocation saat membuat dan memformat log event.

Tujuannya:

- mengurangi allocation rate,
- mengurangi young GC pressure,
- mengurangi latency jitter,
- menjaga throughput saat log volume tinggi.

Namun garbage-free logging bukan sihir. Ia hanya berhasil jika seluruh rantai mendukung.

```text
Application logging call
  -> message object
  -> event object
  -> context data
  -> layout
  -> appender
  -> destination
```

Jika salah satu tahap membuat banyak allocation, pipeline tidak lagi garbage-free secara praktis.

---

## 9. Sumber Allocation dalam Logging

### 9.1 String Concatenation

Buruk:

```java
log.debug("user=" + userId + ", payload=" + expensivePayloadToJson(payload));
```

Masalah:

- ekspresi dievaluasi meskipun DEBUG disabled,
- string dibuat sebelum level check efektif,
- `expensivePayloadToJson` tetap jalan.

Lebih baik:

```java
log.debug("user={}, payloadId={}", userId, payload.getId());
```

Untuk expensive computation:

```java
if (log.isDebugEnabled()) {
    log.debug("payload={}", expensivePayloadToJson(payload));
}
```

### 9.2 Throwable Rendering

```java
log.error("Failed to process order orderId={}", orderId, exception);
```

Stack trace rendering bisa sangat besar. Jangan log stack trace berulang pada setiap retry attempt jika tidak perlu.

### 9.3 JSON Serialization di Message

Buruk:

```java
log.info("request={}", objectMapper.writeValueAsString(request));
```

Masalah:

- membuat string JSON manual,
- raw request mungkin mengandung PII/secrets,
- structured log menjadi nested escaped string,
- mahal.

Lebih baik:

```java
log.info("Request accepted requestId={} operation={} payloadSize={}",
    requestId,
    operation,
    payloadSize);
```

Atau gunakan structured fields melalui ThreadContext / key-value / structured logging library.

### 9.4 Caller Data

Caller data biasanya mahal.

### 9.5 Context Map Copy

MDC/ThreadContext perlu dicopy atau disnapshot agar async event tidak melihat context yang sudah berubah. Context yang besar berarti allocation dan copy cost besar.

Prinsip:

```text
Context should be small, stable, and query-worthy.
```

---

## 10. Message Types di Log4j2

Log4j2 mendukung berbagai message abstraction. Untuk advanced usage, penting memahami bahwa logging tidak hanya string.

Contoh umum:

```java
logger.info("Order submitted orderId={} amount={}", orderId, amount);
```

Di bawahnya, framework dapat memakai message object untuk menyimpan pattern dan arguments.

Beberapa konsep:

- `ParameterizedMessage`,
- `ReusableParameterizedMessage`,
- `StringMapMessage`,
- `ObjectMessage`,
- custom `Message`,
- message factory.

### 10.1 Parameterized Message

Ini gaya umum:

```java
logger.info("Payment authorized paymentId={} orderId={}", paymentId, orderId);
```

Kelebihan:

- familiar,
- mudah,
- relatif efisien,
- compatible dengan SLF4J style.

### 10.2 MapMessage / StructuredMessage

Contoh Log4j2 API langsung:

```java
logger.info(new StringMapMessage()
    .with("event.name", "payment.authorized")
    .with("payment.id", paymentId)
    .with("order.id", orderId)
    .with("amount", amount.toPlainString()));
```

Kelebihan:

- lebih structured,
- layout JSON dapat memetakan field,
- event menjadi machine-queryable.

Kekurangan:

- kode lebih verbose,
- jika library/application memakai SLF4J facade, API ini tidak selalu idiomatis,
- perlu standard agar tidak chaos.

### 10.3 ObjectMessage

Hati-hati dengan object logging:

```java
logger.info(new ObjectMessage(user));
```

Risiko:

- `toString()` bisa bocorkan PII,
- format tidak stabil,
- serialization bisa mahal,
- field tidak governed.

Default enterprise rule:

```text
Do not log arbitrary domain objects.
Log stable identifiers and governed fields.
```

---

## 11. Reusable Message Factory

Log4j2 memiliki konsep message factory untuk mengurangi allocation.

Contoh system property:

```bash
-Dlog4j2.messageFactory=org.apache.logging.log4j.message.ReusableMessageFactory
```

Atau async logger bisa memakai reusable message secara default tergantung konfigurasi/versi.

Namun ada risiko penting:

> Jangan menyimpan reference ke message/event mutable di luar logging call.

Reusable object berarti data internal dapat dipakai ulang. Jika custom appender/layout menyimpan reference tanpa copy yang benar, bisa muncul corruption atau data berubah.

Prinsip:

```text
Reusable internals are framework-owned.
Application code must treat logging call as fire-and-forget.
Custom appenders must understand Log4j2 event immutability contracts.
```

---

## 12. JsonTemplateLayout dan Garbage-Free Structured Logging

Untuk structured JSON logging di Log4j2 modern, `JsonTemplateLayout` adalah pilihan kuat.

Contoh konfigurasi minimal:

```xml
<Configuration status="WARN">
  <Appenders>
    <Console name="Console" target="SYSTEM_OUT">
      <JsonTemplateLayout eventTemplateUri="classpath:LogstashJsonEventLayoutV1.json" />
    </Console>
  </Appenders>

  <Loggers>
    <Root level="info">
      <AppenderRef ref="Console" />
    </Root>
  </Loggers>
</Configuration>
```

Contoh custom template konseptual:

```json
{
  "@timestamp": {
    "$resolver": "timestamp",
    "pattern": {
      "format": "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
      "timeZone": "UTC"
    }
  },
  "log.level": {
    "$resolver": "level",
    "field": "name"
  },
  "log.logger": {
    "$resolver": "logger",
    "field": "name"
  },
  "message": {
    "$resolver": "message",
    "stringified": true
  },
  "thread.name": {
    "$resolver": "thread",
    "field": "name"
  },
  "trace.id": {
    "$resolver": "mdc",
    "key": "trace_id"
  },
  "span.id": {
    "$resolver": "mdc",
    "key": "span_id"
  },
  "correlation.id": {
    "$resolver": "mdc",
    "key": "correlation_id"
  },
  "error.stack_trace": {
    "$resolver": "exception",
    "field": "stackTrace",
    "stackTrace": {
      "stringified": true
    }
  }
}
```

Production note:

- pilih schema yang stabil,
- jangan asal dump semua MDC,
- jangan include semua request header,
- gunakan explicit allowlist,
- uji apakah multiline stack trace tetap valid JSON,
- pastikan log collector bisa parse JSON per line.

---

## 13. ThreadContext Deep Dive

Log4j2 memakai `ThreadContext` untuk diagnostic context.

Contoh:

```java
import org.apache.logging.log4j.ThreadContext;

public void handle(Request request) {
    ThreadContext.put("correlation_id", request.correlationId());
    ThreadContext.put("tenant_id", request.tenantId());
    ThreadContext.put("user_id", request.userId());
    try {
        logger.info("Request started operation={}", request.operation());
        service.process(request);
        logger.info("Request completed operation={}", request.operation());
    } finally {
        ThreadContext.clearMap();
        ThreadContext.clearStack();
    }
}
```

### 13.1 ThreadContext Map vs Stack

Map:

```text
key -> value
```

Cocok untuk:

- correlation id,
- trace id,
- tenant,
- user,
- request id,
- case id.

Stack:

```text
nested diagnostic stack
```

Lebih jarang digunakan di sistem modern. Untuk structured logging, map biasanya lebih berguna.

### 13.2 Thread Pool Leak

Jika ThreadContext tidak dibersihkan:

```text
Request A sets tenant_id=agency-a
Thread returned to pool
Request B uses same thread
Request B logs tenant_id=agency-a accidentally
```

Ini bukan hanya bug observability. Ini bisa menjadi insiden compliance/security karena log request B mengandung context request A.

Rule:

```text
Every context setup must have a finally cleanup.
```

### 13.3 AsyncLogger dan Context Snapshot

Dengan async logger, event diproses setelah logging call. Karena itu context harus disnapshot pada saat event dibuat/published, bukan saat event ditulis.

Jika tidak, event bisa memakai context yang sudah berubah.

Log4j2 menangani snapshot context, tetapi custom extension harus hati-hati.

---

## 14. ThreadContext Propagation Across Async Boundaries

Masalah besar:

```text
HTTP request thread
  -> sets ThreadContext
  -> submits task to executor
       -> task runs on different thread
       -> ThreadContext missing
```

### 14.1 Executor Decorator

```java
import org.apache.logging.log4j.ThreadContext;

import java.util.Map;
import java.util.concurrent.Executor;

public final class ThreadContextPropagatingExecutor implements Executor {
    private final Executor delegate;

    public ThreadContextPropagatingExecutor(Executor delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        Map<String, String> contextMap = ThreadContext.getImmutableContext();

        delegate.execute(() -> {
            Map<String, String> previous = ThreadContext.getImmutableContext();
            try {
                ThreadContext.clearMap();
                ThreadContext.putAll(contextMap);
                command.run();
            } finally {
                ThreadContext.clearMap();
                ThreadContext.putAll(previous);
            }
        });
    }
}
```

### 14.2 CompletableFuture

Buruk:

```java
CompletableFuture.supplyAsync(() -> service.call());
```

Context hilang karena memakai executor lain.

Lebih baik:

```java
Executor contextAwareExecutor = new ThreadContextPropagatingExecutor(delegateExecutor);

CompletableFuture.supplyAsync(() -> service.call(), contextAwareExecutor);
```

### 14.3 Virtual Threads

Virtual threads mengurangi masalah thread pool reuse karena virtual thread biasanya per task. Namun bukan berarti ThreadContext propagation otomatis benar di semua kasus.

Perhatikan:

- jika membuat virtual thread setelah context diset, inheritance tidak selalu sesuai ekspektasi,
- jika task async dibuat di luar request scope, context bisa hilang,
- ThreadLocal dalam jutaan virtual threads tetap punya biaya,
- untuk structured concurrency dan immutable context, Scoped Values di Java modern bisa menjadi alternatif desain.

Prinsip Java 21+:

```text
Virtual threads reduce thread reuse leaks, but do not remove context design responsibility.
```

---

## 15. RoutingAppender: Powerful but Dangerous

`RoutingAppender` dapat mengirim log event ke appender berbeda berdasarkan value tertentu.

Contoh use case:

- audit events ke file audit,
- security events ke file security,
- tenant tertentu ke destination tertentu,
- error event ke alert stream,
- module-specific log.

Contoh konseptual:

```xml
<Routing name="Routing">
  <Routes pattern="$${ctx:log_route}">
    <Route key="audit">
      <RollingFile name="AuditFile"
                   fileName="logs/audit.log"
                   filePattern="logs/audit-%d{yyyy-MM-dd}.log.gz">
        <JsonTemplateLayout />
        <TimeBasedTriggeringPolicy />
      </RollingFile>
    </Route>

    <Route key="security">
      <RollingFile name="SecurityFile"
                   fileName="logs/security.log"
                   filePattern="logs/security-%d{yyyy-MM-dd}.log.gz">
        <JsonTemplateLayout />
        <TimeBasedTriggeringPolicy />
      </RollingFile>
    </Route>

    <Route>
      <AppenderRef ref="ApplicationFile" />
    </Route>
  </Routes>
</Routing>
```

Application code:

```java
ThreadContext.put("log_route", "audit");
try {
    logger.info("User role changed userId={} role={}", userId, role);
} finally {
    ThreadContext.remove("log_route");
}
```

### 15.1 High-Cardinality Routing Disaster

Sangat buruk:

```text
route by user_id
route by request_id
route by tenant_id with thousands of tenants
route by case_id
```

Konsekuensi:

- ribuan file appender,
- file descriptor exhaustion,
- memory growth,
- rolling policy chaos,
- disk pressure,
- degraded logging performance,
- log collector overload.

Rule:

```text
Never route by unbounded cardinality value.
```

Route hanya berdasarkan domain kecil dan bounded:

- `application`,
- `audit`,
- `security`,
- `integration`,
- `performance`,
- `billing`,
- `workflow`.

### 15.2 Prefer Marker untuk Routing Intent

Daripada ThreadContext route manual, marker bisa lebih eksplisit.

```java
private static final Marker AUDIT = MarkerManager.getMarker("AUDIT");

logger.info(AUDIT, "Role assigned userId={} role={}", userId, role);
```

Filter/appender bisa routing berdasarkan marker.

Keuntungan:

- intent ada di call site,
- tidak bergantung pada context cleanup,
- lebih aman untuk event-specific routing.

Kekurangan:

- marker tidak membawa rich fields,
- jika memakai facade SLF4J, marker support tetap ada tetapi backend behavior perlu diuji.

---

## 16. FailoverAppender: Reliability Boundary

FailoverAppender mengirim event ke primary appender, lalu fallback ke secondary appender jika primary gagal.

Contoh:

```xml
<Appenders>
  <Socket name="Remote" host="log-collector" port="4560">
    <JsonTemplateLayout />
  </Socket>

  <RollingFile name="LocalFallback"
               fileName="logs/fallback.log"
               filePattern="logs/fallback-%d{yyyy-MM-dd}-%i.log.gz">
    <JsonTemplateLayout />
    <Policies>
      <TimeBasedTriggeringPolicy />
      <SizeBasedTriggeringPolicy size="100MB" />
    </Policies>
    <DefaultRolloverStrategy max="10" />
  </RollingFile>

  <Failover name="Failover" primary="Remote">
    <Failovers>
      <AppenderRef ref="LocalFallback" />
    </Failovers>
  </Failover>
</Appenders>
```

### 16.1 Apa yang FailoverAppender Tidak Selesaikan

Failover bukan durability guarantee penuh.

Ia tidak otomatis menyelesaikan:

- disk full,
- appender fallback juga lambat,
- backpressure dari async ring buffer,
- log collector down lama,
- exactly-once delivery,
- audit immutability,
- corruption karena process crash sebelum flush.

### 16.2 Failover Harus Observable

Failover yang diam-diam terjadi adalah bahaya.

Harus ada:

- metric jumlah failover,
- internal status log,
- health check/log collector status,
- alert jika fallback digunakan,
- disk usage alert untuk fallback file,
- runbook recovery/replay.

Rule:

```text
A failover path must produce evidence that failover happened.
```

---

## 17. Network Appenders: Handle with Suspicion

Network appender terlihat praktis, tetapi sering menjadi sumber latency dan failure coupling.

Masalah:

- log collector down dapat mempengaruhi aplikasi,
- network latency masuk ke logging path,
- retry internal bisa memperparah backlog,
- TLS handshake/cert issue dapat menghentikan logging,
- DNS issue bisa membuat startup/error,
- data loss jika buffer tidak durable.

Untuk Kubernetes/container, sering lebih baik:

```text
Application logs JSON to stdout
Node/sidecar/daemonset collector ships logs
```

Keuntungan:

- aplikasi tidak perlu tahu collector network protocol,
- coupling lebih rendah,
- operational pattern standar,
- stdout/stderr di-handle container runtime.

Namun stdout juga tidak gratis:

- stdout blocking bisa terjadi,
- container runtime logging driver bisa bottleneck,
- log collector lag bisa naik,
- multiline JSON harus valid per line.

---

## 18. Security Hardening Setelah Log4Shell

Log4Shell mengubah cara engineer harus memandang logging framework.

Pelajaran besarnya:

```text
Logging framework is part of the attack surface.
```

Logging bukan hanya library harmless. Logging memproses input yang sering berasal dari user, header, payload, external system, exception message, dan dependency.

### 18.1 Prinsip Security Logging Framework

1. Gunakan versi Log4j2 yang masih didukung dan patched.
2. Jangan memakai Log4j 1.x.
3. Jangan memakai versi Log4j2 lama yang vulnerable.
4. Hindari appender yang tidak diperlukan.
5. Hindari JNDI/JMS/socket behavior yang tidak dipahami.
6. Jangan log raw untrusted input tanpa sanitization.
7. Jangan enable lookup berbahaya.
8. Jangan treat logging config sebagai file tidak penting.
9. Scan transitive dependencies.
10. Validasi runtime classpath, bukan hanya `pom.xml`.

### 18.2 Dependency Hygiene

Maven check:

```bash
mvn dependency:tree | grep -i log4j
```

Gradle check:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -i log4j
```

Cari:

- `log4j-core`,
- `log4j-api`,
- `log4j-slf4j-impl`,
- `log4j-slf4j2-impl`,
- `log4j-to-slf4j`,
- `log4j-1.2-api`,
- legacy `log4j:log4j`.

Runtime check dalam container:

```bash
find /app -iname '*log4j*.jar' -print
```

Atau:

```bash
jar tf app.jar | grep -i log4j
```

Untuk fat jar Spring Boot:

```bash
jar tf app.jar | grep 'BOOT-INF/lib' | grep -i log4j
```

### 18.3 SBOM dan SCA

Untuk top-tier engineering, security logging tidak cukup dengan “kita pakai versi aman”. Harus ada kontrol supply chain:

- SBOM,
- dependency scanning,
- CVE monitoring,
- pinned versions,
- renovate/dependabot-like process,
- emergency patch procedure,
- transitive dependency override policy,
- runtime verification.

### 18.4 Ban Dangerous Logging Patterns

Banned by default:

```java
logger.info("headers={}", headers);
logger.info("requestBody={}", body);
logger.info("authorization={}", authHeader);
logger.info("token={}", token);
logger.info("password={}", password);
logger.info("user={}", userEntity);
logger.error("error={}", exception.getMessage()); // if message contains raw untrusted data and no context
```

Better:

```java
logger.info("External call failed system={} operation={} status={} correlationId={}",
    system,
    operation,
    statusCode,
    correlationId);
```

For security event:

```java
logger.warn(SECURITY,
    "Authentication failed event.name={} reason={} clientIpHash={} usernameHash={}",
    "auth.failed",
    reasonCode,
    clientIpHash,
    usernameHash);
```

### 18.5 Log Injection

Log injection terjadi ketika input user mengandung newline/control characters sehingga membuat fake log entry.

Contoh input malicious:

```text
alice
2026-01-01T00:00:00Z INFO Admin login successful user=attacker
```

Jika ditulis raw dalam text log, timeline bisa dipalsukan.

Mitigasi:

- structured JSON per line,
- escape newline/control chars,
- sanitize untrusted text,
- limit length,
- avoid raw body logging,
- use allowlist fields.

Contoh sanitizer sederhana:

```java
public final class LogSanitizer {
    private static final int MAX_LENGTH = 500;

    private LogSanitizer() {}

    public static String safeText(String value) {
        if (value == null) {
            return null;
        }
        String sanitized = value
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\t", "\\t");

        if (sanitized.length() > MAX_LENGTH) {
            return sanitized.substring(0, MAX_LENGTH) + "...[truncated]";
        }
        return sanitized;
    }
}
```

---

## 19. Secure Configuration Baseline

### 19.1 Minimal Safe JSON Stdout for Kubernetes

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN" shutdownHook="enable">
  <Properties>
    <Property name="service.name">${env:SERVICE_NAME:-unknown-service}</Property>
    <Property name="service.env">${env:ENVIRONMENT:-unknown}</Property>
  </Properties>

  <Appenders>
    <Console name="Console" target="SYSTEM_OUT">
      <JsonTemplateLayout eventTemplateUri="classpath:log4j2-json-template.json" />
    </Console>
  </Appenders>

  <Loggers>
    <Logger name="org.apache.http" level="warn" />
    <Logger name="org.springframework" level="info" />
    <Logger name="com.example" level="info" />

    <Root level="info">
      <AppenderRef ref="Console" />
    </Root>
  </Loggers>
</Configuration>
```

Characteristics:

- stdout only,
- JSON per line,
- no network appender,
- no dynamic high-cardinality routing,
- status WARN,
- framework package level controlled.

### 19.2 AsyncLogger Production Variant

JVM args:

```bash
-Dlog4j2.contextSelector=org.apache.logging.log4j.core.async.AsyncLoggerContextSelector \
-Dlog4j2.asyncLoggerRingBufferSize=262144
```

Config:

```xml
<Configuration status="WARN" shutdownHook="enable">
  <Appenders>
    <Console name="Console" target="SYSTEM_OUT">
      <JsonTemplateLayout eventTemplateUri="classpath:log4j2-json-template.json" />
    </Console>
  </Appenders>

  <Loggers>
    <Logger name="com.example.noisy" level="warn" />

    <Root level="info" includeLocation="false">
      <AppenderRef ref="Console" />
    </Root>
  </Loggers>
</Configuration>
```

Operational requirements:

- monitor stdout/log collector throughput,
- ensure graceful shutdown,
- test burst logging,
- test collector slowdown,
- define drop/block expectations,
- keep `includeLocation=false`.

### 19.3 Audit/Security Split with Marker

```xml
<Configuration status="WARN">
  <Appenders>
    <Console name="AppConsole" target="SYSTEM_OUT">
      <JsonTemplateLayout eventTemplateUri="classpath:app-log-template.json" />
      <Filters>
        <MarkerFilter marker="AUDIT" onMatch="DENY" onMismatch="NEUTRAL" />
        <MarkerFilter marker="SECURITY" onMatch="DENY" onMismatch="NEUTRAL" />
      </Filters>
    </Console>

    <RollingFile name="AuditFile"
                 fileName="logs/audit.log"
                 filePattern="logs/audit-%d{yyyy-MM-dd}.log.gz">
      <JsonTemplateLayout eventTemplateUri="classpath:audit-log-template.json" />
      <Filters>
        <MarkerFilter marker="AUDIT" onMatch="ACCEPT" onMismatch="DENY" />
      </Filters>
      <Policies>
        <TimeBasedTriggeringPolicy />
      </Policies>
    </RollingFile>

    <RollingFile name="SecurityFile"
                 fileName="logs/security.log"
                 filePattern="logs/security-%d{yyyy-MM-dd}.log.gz">
      <JsonTemplateLayout eventTemplateUri="classpath:security-log-template.json" />
      <Filters>
        <MarkerFilter marker="SECURITY" onMatch="ACCEPT" onMismatch="DENY" />
      </Filters>
      <Policies>
        <TimeBasedTriggeringPolicy />
      </Policies>
    </RollingFile>
  </Appenders>

  <Loggers>
    <Root level="info">
      <AppenderRef ref="AppConsole" />
      <AppenderRef ref="AuditFile" />
      <AppenderRef ref="SecurityFile" />
    </Root>
  </Loggers>
</Configuration>
```

Caveat:

- audit/security file dalam container harus dipikirkan ulang,
- pastikan retention dan shipping jelas,
- pastikan access control berbeda,
- pastikan audit event tidak bisa drop jika requirement compliance strict.

---

## 20. Async Logging dan Audit Logs: Hati-Hati

Audit log berbeda dari diagnostic application log.

Diagnostic log boleh:

- sampling,
- drop DEBUG under pressure,
- delay beberapa detik,
- best effort pada shutdown.

Audit log sering butuh:

- completeness,
- integrity,
- ordering cukup jelas,
- retention,
- access control,
- tamper evidence,
- no silent drop.

Karena itu jangan otomatis memasukkan audit log ke async logger yang bisa drop/block tanpa policy jelas.

Pertanyaan wajib:

1. Apakah event audit harus durable sebelum transaksi dianggap sukses?
2. Apakah audit log satu transaksi harus commit atomik dengan DB?
3. Apakah audit log boleh berada hanya di file lokal?
4. Apakah audit log boleh hilang saat crash?
5. Apakah audit log perlu hash chain/tamper evidence?
6. Apakah audit log harus masuk database/outbox?
7. Siapa yang boleh baca audit log?

Untuk sistem regulatory/case management, sering lebih tepat:

```text
Audit event as domain record/outbox -> durable store -> async ship to observability platform
Diagnostic log -> Log4j2 stdout JSON
```

Jangan mencampur audit compliance dengan application diagnostic logging tanpa desain eksplisit.

---

## 21. Log4j2 dalam Spring Boot

Spring Boot default memakai Logback jika menggunakan starter default. Untuk memakai Log4j2, perlu exclude Logback dan include Log4j2 starter.

Maven contoh:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
  <exclusions>
    <exclusion>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>

<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-log4j2</artifactId>
</dependency>
```

Checklist:

```bash
mvn dependency:tree | grep -E 'logback|log4j|slf4j'
```

Pastikan tidak ada:

- `logback-classic` tanpa sengaja,
- multiple SLF4J providers,
- bridge loop,
- old Log4j 1.x,
- vulnerable transitive Log4j2.

---

## 22. Java 8 sampai Java 25 Considerations

### 22.1 Java 8

Perhatikan:

- masih banyak legacy dependency,
- Log4j2 versi modern mungkin punya baseline Java tertentu; cek compatibility versi,
- container awareness JVM tidak sebaik Java modern,
- GC logging format berbeda dari Java 9+ unified logging,
- ThreadLocal/MDC dengan executor tetap rawan leak.

### 22.2 Java 11/17

Umumnya baseline enterprise modern.

Perhatikan:

- JPMS module path jika digunakan,
- container support lebih baik,
- JFR tersedia open source di JDK modern,
- GC log unified logging,
- dependency scanning harus runtime-aware.

### 22.3 Java 21

Virtual threads mulai relevan.

Perhatikan:

- thread name pada log bisa kurang informatif jika virtual thread banyak,
- ThreadLocal/MDC tetap bisa dipakai tetapi harus hati-hati,
- blocking appender dengan virtual thread tidak berarti bebas cost; carrier thread dan IO path tetap bottleneck,
- structured concurrency membuka peluang context model lebih bersih.

### 22.4 Java 25

Untuk Java modern/next LTS-style adoption planning:

- virtual threads makin matang,
- Scoped Values/structured concurrency semakin relevan untuk context design,
- observability harus tidak terlalu bergantung pada thread name,
- trace/span/correlation ID menjadi lebih penting daripada thread identity.

Prinsip lintas Java 8–25:

```text
Do not design observability around thread identity alone.
Design around causal identity: trace, span, correlation, job, message, transaction, case.
```

---

## 23. Troubleshooting Async Log4j2

### 23.1 Gejala: Log Terlambat Muncul

Kemungkinan:

- async buffer backlog,
- appender lambat,
- stdout collector lambat,
- disk IO lambat,
- network appender retry,
- JSON layout mahal,
- CPU saturated,
- GC pause.

Langkah diagnosis:

1. Bandingkan timestamp event vs ingestion timestamp.
2. Cek CPU dan GC.
3. Cek log collector lag.
4. Cek disk IO atau stdout driver.
5. Kurangi log volume sementara.
6. Uji synchronous mode di staging.
7. Ambil JFR/profiler jika perlu.

### 23.2 Gejala: Log Hilang

Kemungkinan:

- level/filter salah,
- marker filter salah,
- appender tidak attached,
- async queue/ring buffer drop policy,
- process crash sebelum flush,
- stdout collector loss,
- file rolling overwrite,
- disk full,
- exception dalam custom appender/layout.

Diagnosis:

```bash
-Dorg.apache.logging.log4j.simplelog.StatusLogger.level=TRACE
```

Atau set:

```xml
<Configuration status="TRACE">
```

Gunakan hanya untuk troubleshooting, bukan default production.

### 23.3 Gejala: Duplicate Logs

Kemungkinan:

- additivity true pada child logger dan root appender,
- SLF4J bridge loop,
- multiple appenders output sama,
- Spring Boot logging conflict,
- library membawa provider lain.

Contoh penyebab:

```xml
<Logger name="com.example" level="info">
  <AppenderRef ref="Console" />
</Logger>

<Root level="info">
  <AppenderRef ref="Console" />
</Root>
```

Dengan `additivity=true`, event dari `com.example` juga naik ke root.

Fix:

```xml
<Logger name="com.example" level="info" additivity="false">
  <AppenderRef ref="Console" />
</Logger>
```

Atau jangan attach appender di child jika tidak perlu.

### 23.4 Gejala: Logging Membuat CPU Tinggi

Kemungkinan:

- log volume terlalu tinggi,
- JSON layout mahal,
- stack trace terlalu banyak,
- includeLocation true,
- async ring buffer contention,
- status logger TRACE aktif,
- expensive `toString()` / string concatenation,
- log collector backpressure.

Diagnosis:

- async-profiler CPU,
- JFR execution sample,
- count log lines/sec,
- reduce noisy logger level,
- disable includeLocation,
- inspect top logging call sites.

### 23.5 Gejala: Memory/GC Naik Karena Logging

Kemungkinan:

- object serialization di message,
- huge MDC,
- huge stack traces,
- JSON allocation,
- log events queued besar,
- exception storm,
- custom appender buffering.

Diagnosis:

- allocation profiling,
- JFR allocation events,
- heap histogram,
- compare log volume with allocation rate,
- temporarily reduce logging.

---

## 24. Testing Async Logging Behavior

Production-grade logging config harus diuji.

### 24.1 Test JSON Validity

Generate log:

```java
logger.info("User input received value={}", "hello\nworld");
```

Expected:

- satu JSON object per line,
- newline di-escape,
- parser tidak gagal.

### 24.2 Test MDC Cleanup

Test pseudo-code:

```java
@Test
void shouldNotLeakThreadContextBetweenRequests() {
    handleRequest("correlation-a");
    handleRequest("correlation-b");

    // assert logs for second request do not contain correlation-a
}
```

### 24.3 Test Appender Failure

Simulasikan:

- disk path unavailable,
- permission denied,
- log collector down,
- fallback path active.

Expected:

- aplikasi behavior sesuai policy,
- failover observable,
- no silent data loss untuk critical event.

### 24.4 Test Burst Logging

Load test:

```text
normal traffic + burst error scenario
```

Measure:

- latency p50/p95/p99,
- CPU,
- allocation rate,
- GC pause,
- log ingestion delay,
- dropped logs if measurable,
- ring buffer saturation symptoms.

---

## 25. Practical Lab 1 — Migrasi ke AsyncLogger dengan Aman

### Goal

Mengubah service dari synchronous Log4j2 ke AsyncLogger tanpa kehilangan kontrol operasional.

### Steps

1. Baseline existing performance.
2. Hitung log lines/sec normal dan burst.
3. Pastikan dependency Disruptor tersedia.
4. Tambahkan JVM arg:

```bash
-Dlog4j2.contextSelector=org.apache.logging.log4j.core.async.AsyncLoggerContextSelector
```

5. Set ring buffer awal:

```bash
-Dlog4j2.asyncLoggerRingBufferSize=262144
```

6. Pastikan `includeLocation=false`.
7. Jalankan load test normal.
8. Jalankan burst test.
9. Simulasikan collector slowdown.
10. Verifikasi shutdown flush.
11. Dokumentasikan policy:

```text
If downstream logging is slow, application may block / may drop / may degrade.
```

### Acceptance Criteria

- tidak ada duplicate logs,
- JSON valid,
- MDC tetap muncul,
- latency tidak memburuk,
- log delay acceptable,
- failure mode diketahui.

---

## 26. Practical Lab 2 — Secure JSON Template Layout

### Goal

Membuat JSON log schema yang aman dan queryable.

### Required fields

```text
@timestamp
service.name
service.environment
log.level
log.logger
thread.name
event.name
message
trace.id
span.id
correlation.id
error.type
error.message
error.stack_trace
```

### Forbidden fields

```text
authorization
cookie
set-cookie
password
token
access_token
refresh_token
id_token
secret
raw_request_body
raw_response_body
full_user_object
```

### Validation

1. Log request dengan newline malicious.
2. Log exception dengan nested cause.
3. Log event dengan MDC.
4. Parse output dengan JSON parser.
5. Query by `trace.id` dan `event.name`.

---

## 27. Practical Lab 3 — Marker-Based Audit/Security Routing

### Goal

Pisahkan audit/security event dari diagnostic logs tanpa high-cardinality routing.

### Java Code

```java
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.Marker;
import org.apache.logging.log4j.MarkerManager;

public final class SecurityLogger {
    private static final Logger logger = LogManager.getLogger(SecurityLogger.class);
    private static final Marker SECURITY = MarkerManager.getMarker("SECURITY");
    private static final Marker AUDIT = MarkerManager.getMarker("AUDIT");

    public void authenticationFailed(String reasonCode, String usernameHash, String clientIpHash) {
        logger.warn(SECURITY,
            "Authentication failed event.name={} reason={} usernameHash={} clientIpHash={}",
            "auth.failed",
            reasonCode,
            usernameHash,
            clientIpHash);
    }

    public void roleAssigned(String actorId, String subjectId, String role) {
        logger.info(AUDIT,
            "Role assigned event.name={} actorId={} subjectId={} role={}",
            "role.assigned",
            actorId,
            subjectId,
            role);
    }
}
```

### Acceptance Criteria

- SECURITY events masuk ke security route,
- AUDIT events masuk ke audit route,
- application logs tidak duplicate,
- no user/request/case based file explosion,
- missing marker does not break app logging.

---

## 28. Production Design Checklist

### 28.1 Async Logging

- [ ] Sudah memilih sync/AsyncAppender/AsyncLogger dengan alasan jelas.
- [ ] Ring buffer size dihitung berdasarkan burst.
- [ ] `includeLocation=false` di production high-throughput.
- [ ] Shutdown flush diuji.
- [ ] Collector slowdown diuji.
- [ ] Policy saat buffer penuh diketahui.
- [ ] Audit/security critical event tidak silent drop.

### 28.2 Garbage-Free / Performance

- [ ] Tidak memakai string concatenation untuk log disabled level.
- [ ] Tidak serialize object besar di message.
- [ ] Tidak log full request/response body.
- [ ] Stack trace tidak diulang di setiap retry.
- [ ] MDC kecil dan bounded.
- [ ] JSON layout dipilih dengan sadar.
- [ ] Allocation profiling dilakukan untuk high-volume service.

### 28.3 Routing

- [ ] Tidak route by user/request/case/tenant unbounded.
- [ ] Route keys bounded.
- [ ] Marker/filter diuji.
- [ ] Additivity tidak menyebabkan duplicate logs.
- [ ] File descriptor usage dipahami.

### 28.4 Security

- [ ] Log4j2 patched dan supported.
- [ ] Tidak ada Log4j 1.x legacy.
- [ ] Runtime classpath diverifikasi.
- [ ] Dependency scanning aktif.
- [ ] Secret/PII redaction policy ada.
- [ ] Log injection dimitigasi.
- [ ] Logging config direview seperti production code.

### 28.5 Operability

- [ ] Log ingestion delay dipantau.
- [ ] Log volume dipantau.
- [ ] Disk usage dipantau jika file logging.
- [ ] Appender failure observable.
- [ ] Runbook tersedia.
- [ ] Logging config bisa diubah aman per environment.

---

## 29. Common Anti-Patterns

### Anti-Pattern 1 — “Async Logger Means No Logging Cost”

Salah. Async logger tetap punya cost:

- event creation,
- context snapshot,
- enqueue,
- contention,
- memory barrier,
- eventual appender IO.

Async hanya mengubah lokasi dan timing biaya.

### Anti-Pattern 2 — “Bigger Ring Buffer Solves Everything”

Salah. Buffer menyerap burst, bukan overload permanen.

### Anti-Pattern 3 — “Route Logs by Tenant/User”

Berbahaya jika cardinality tinggi.

### Anti-Pattern 4 — “Log Full Payload for Debugging”

Berbahaya untuk security, cost, dan privacy.

### Anti-Pattern 5 — “Audit Log Is Just Another App Log”

Salah. Audit log punya requirement integrity/completeness yang berbeda.

### Anti-Pattern 6 — “Enable includeLocation Everywhere”

Mahal dan sering tidak perlu.

### Anti-Pattern 7 — “Network Appender Directly from App Is Always Better”

Sering menciptakan failure coupling ke log collector.

### Anti-Pattern 8 — “Only Check Maven Dependency, Not Runtime Artifact”

Fat jar, container image, app server, dan transitive dependency bisa berbeda dari asumsi.

---

## 30. Mini Case Study: Logging-Induced Latency Incident

### Situation

Service mengalami latency p99 naik dari 400 ms ke 8 detik. Error rate tidak tinggi. CPU naik, GC minor meningkat. DB normal. External API normal.

### Initial Symptoms

- p99 latency tinggi,
- log volume naik 20x,
- banyak WARN timeout dari dependency minor,
- AsyncLogger aktif,
- log collector delay 2 menit,
- ring buffer penuh.

### Bad Initial Hypothesis

```text
Dependency timeout adalah root cause.
```

### Better Hypothesis

```text
Dependency warning storm caused logging backlog.
Async ring buffer filled.
Application threads blocked/fell back under logging pressure.
Logging amplified latency.
```

### Evidence to Collect

1. Log lines/sec before and during incident.
2. App latency vs log ingestion delay.
3. CPU profile: logging classes in top stack?
4. JFR allocation: JSON layout/Throwable rendering?
5. Async logger full behavior.
6. Count repeated identical WARNs.
7. Check if stack traces logged per retry.

### Root Cause Example

A retry loop logged full stack trace at WARN on every retry attempt for every failed downstream call.

```java
for (int attempt = 1; attempt <= 3; attempt++) {
    try {
        return client.call();
    } catch (TimeoutException e) {
        logger.warn("Downstream timeout attempt={} request={}", attempt, request, e);
    }
}
```

Problems:

- logs full request object,
- logs stack trace every attempt,
- WARN storm,
- request may contain sensitive data,
- expensive `toString()`,
- async buffer saturation.

### Fix

```java
for (int attempt = 1; attempt <= 3; attempt++) {
    try {
        return client.call();
    } catch (TimeoutException e) {
        if (attempt < 3) {
            logger.warn("Downstream timeout event.name={} system={} operation={} attempt={} maxAttempts={} outcome=retry",
                "dependency.timeout",
                system,
                operation,
                attempt,
                3);
        } else {
            logger.error("Downstream timeout event.name={} system={} operation={} attempt={} maxAttempts={} outcome=failed",
                "dependency.timeout",
                system,
                operation,
                attempt,
                3,
                e);
        }
    }
}
```

Further improvement:

- rate-limit repeated warning,
- aggregate retry metrics,
- trace dependency span,
- alert on error rate/latency, not raw log volume,
- never log full request object.

---

## 31. Engineering Standard: Recommended Defaults

For high-throughput Java service:

```text
Facade: SLF4J 2.x if ecosystem allows
Backend: Log4j2 or Logback depending org standard
Log4j2 mode: synchronous stdout JSON first; AsyncLogger after measurement
Format: JSON per line
Schema: governed explicit fields
Context: trace/span/correlation/request/job/case IDs
Location: disabled in production
Routing: marker-based and bounded
Network appender: avoid direct from app unless justified
Security: patched Log4j2, no Log4j 1.x, no raw secrets/PII
Audit: separate durable design, not casual app log
```

For legacy Java 8 service:

```text
Keep dependencies patched within Java 8 compatibility.
Avoid old Log4j 1.x.
Verify runtime classpath.
Use SLF4J facade.
Use JSON logs if pipeline supports it.
Be conservative with async until tested.
```

For Java 21+ virtual-thread service:

```text
Do not rely heavily on thread names.
Use trace/correlation IDs.
Keep ThreadContext small.
Measure ThreadLocal/MDC cost if task volume is huge.
Prefer immutable scoped request context where architecture allows.
```

---

## 32. Key Takeaways

1. `AsyncLogger` is a high-performance logging architecture, not a guarantee that logging has no cost.
2. Ring buffer absorbs burst but cannot fix sustained downstream slowness.
3. Queue/ring-buffer full behavior must be a deliberate policy: block, drop, fallback, or custom.
4. `includeLocation=true` is expensive and should not be default in production high-throughput systems.
5. Garbage-free logging requires discipline across message construction, context, layout, and appender.
6. Structured JSON logging should use governed schema, not arbitrary object dumping.
7. ThreadContext/MDC must be cleaned and propagated explicitly across async boundaries.
8. RoutingAppender is powerful but dangerous with high-cardinality keys.
9. FailoverAppender must be observable; silent failover is operational debt.
10. Log4Shell taught that logging frameworks are part of the attack surface.
11. Audit/security logs are not merely application logs with different names.
12. Top-tier engineers test logging behavior under failure, burst, shutdown, and collector slowdown.

---

## 33. Latihan Mandiri

1. Ambil satu service Java yang memakai Log4j2.
2. Buat dependency tree dan identifikasi seluruh logging-related dependencies.
3. Pastikan tidak ada bridge/provider loop.
4. Ubah output menjadi JSON per line.
5. Tambahkan `trace_id`, `span_id`, `correlation_id` dari ThreadContext.
6. Buat marker `AUDIT` dan `SECURITY`.
7. Buat filter agar event security bisa dipisah.
8. Jalankan load test normal.
9. Jalankan burst logging test.
10. Simulasikan log collector lambat/down.
11. Bandingkan sync vs AsyncLogger.
12. Ambil CPU/allocation profile saat burst.
13. Dokumentasikan policy logging overload.

---

## 34. Referensi

- Apache Log4j2 Manual — Asynchronous Loggers
- Apache Log4j2 Manual — Appenders
- Apache Log4j2 Manual — JSON Template Layout
- Apache Log4j2 Manual — Garbage-free Logging
- Apache Log4j2 Security Page
- SLF4J Manual
- OpenTelemetry Logs/Trace Context documentation
- OWASP Logging Cheat Sheet

---

## 35. Status Seri

Selesai sampai bagian ini:

```text
Part 8 — Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security
```

Seri belum selesai.

Berikutnya:

```text
Part 9 — Structured Logging: From Human Text to Machine-Queryable Events
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 7 — Log4j2 Deep Dive I: Architecture, Configuration, Appenders, Layouts](./07-log4j2-deep-dive-architecture-configuration-appenders-layouts.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 9 — Structured Logging: From Human Text to Machine-Queryable Events](./09-structured-logging-from-human-text-to-machine-queryable-events.md)
