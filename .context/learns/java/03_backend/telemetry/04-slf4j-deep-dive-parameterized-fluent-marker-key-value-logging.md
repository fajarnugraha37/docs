# Part 4 — SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Module: Java Logging / Runtime Evidence Engineering  
> Java target: Java 8 sampai Java 25  
> Focus: SLF4J API usage, event construction, performance boundary, context, markers, key-value logs, migration, and production coding standard

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu tidak hanya bisa menulis:

```java
log.info("User {} created", userId);
```

Tetapi paham **apa yang sebenarnya terjadi** saat statement itu dieksekusi, kapan aman secara performa, kapan tetap mahal, bagaimana exception diperlakukan, bagaimana structured logging dibentuk, kapan memakai fluent API, kapan memakai marker, bagaimana menghindari kebocoran MDC, dan bagaimana menulis standar logging yang scalable untuk sistem Java enterprise.

Target akhirnya adalah memiliki kemampuan seperti engineer senior/top-tier yang bisa menjawab pertanyaan berikut dengan tegas:

1. Apakah log statement ini akan membuat alokasi objek walau level-nya disabled?
2. Apakah `toString()` object ini dipanggil sekarang atau nanti?
3. Apakah exception ini benar-benar tercetak sebagai stack trace atau malah menjadi argument biasa?
4. Apakah key-value pair ini akan muncul di backend Logback/Log4j2 saya?
5. Apakah marker ini dipakai untuk filtering, routing, audit, atau hanya dekorasi kosong?
6. Apakah MDC aman pada servlet thread pool, `CompletableFuture`, Reactor, virtual thread, dan scheduled job?
7. Apakah library boleh membawa backend logging?
8. Apakah aplikasi bisa migrasi dari Logback ke Log4j2 tanpa mengubah business code?
9. Apakah kita sedang membuat log manusiawi atau machine-queryable?
10. Apakah log ini membantu incident response atau hanya menambah noise?

---

## 1. Posisi SLF4J dalam Arsitektur Logging Java

SLF4J adalah **facade logging**, bukan backend logging.

Artinya, kode aplikasi dan library berbicara ke API SLF4J, lalu pada runtime event logging diteruskan ke provider/backend seperti:

- Logback,
- Log4j2,
- java.util.logging,
- reload4j,
- provider lain.

Secara konseptual:

```text
Application code
    |
    | uses
    v
SLF4J API
    |
    | provider / binding
    v
Logging backend
    |
    | appender / handler
    v
Console / file / JSON / collector / SIEM / log platform
```

SLF4J memisahkan **source code logging contract** dari **runtime logging implementation**. Ini penting karena library tidak boleh memaksakan backend logging kepada aplikasi host.

### 1.1 Prinsip Utama

Gunakan SLF4J API di kode aplikasi/library.

Backend dipilih di layer aplikasi/deployment.

```text
Library code:
    depend on slf4j-api only

Application code:
    depend on slf4j-api
    choose exactly one backend/provider
```

### 1.2 Kenapa Ini Penting?

Bayangkan kamu membuat library internal `case-workflow-core` dan library itu membawa `logback-classic` sebagai transitive dependency. Aplikasi host yang ingin memakai Log4j2 akan mengalami konflik dependency, duplicate provider, atau behavior logging yang tidak konsisten.

Rule-nya:

```text
Reusable library:
    boleh pakai slf4j-api
    jangan bawa logging backend

Deployable application:
    wajib memilih satu backend final
```

---

## 2. SLF4J 1.x vs SLF4J 2.x

SLF4J memiliki dua generasi besar yang sering ditemui di sistem enterprise.

| Area | SLF4J 1.x | SLF4J 2.x |
|---|---|---|
| Minimum Java | Umumnya Java lama | Java 8+ |
| Backend discovery | Static binding | ServiceLoader provider |
| API klasik | Ada | Ada |
| Fluent API | Tidak | Ada |
| Key-value logging API | Tidak native | Ada via `LoggingEventBuilder` |
| Lambda/supplier support | Tidak | Ada pada fluent API |
| Migration impact | Banyak sistem legacy | Modern Spring Boot 3+ ecosystem |

SLF4J 2.x tetap mempertahankan API klasik seperti:

```java
log.info("Order {} submitted", orderId);
```

Tetapi menambahkan fluent API:

```java
log.atInfo()
   .setMessage("Order submitted")
   .addKeyValue("order.id", orderId)
   .addKeyValue("customer.id", customerId)
   .log();
```

### 2.1 Mental Model Migration

Jangan berpikir SLF4J 2.x memaksa semua log ditulis fluent. API klasik tetap bagus untuk log sederhana.

Gunakan rule berikut:

```text
Simple human-readable event:
    gunakan classic parameterized API

Structured diagnostic/business event:
    gunakan fluent API + key-value

Expensive argument construction:
    gunakan fluent API + Supplier atau guard eksplisit

Need marker:
    classic API bisa, fluent API juga bisa
```

---

## 3. Logger Creation Pattern

Pattern paling umum:

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class PaymentService {
    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);
}
```

### 3.1 Kenapa `private static final`?

Karena logger biasanya:

1. immutable reference,
2. satu per class,
3. tidak bergantung pada instance state,
4. murah untuk dipakai berkali-kali,
5. mengikuti nama class sebagai logger name.

### 3.2 Kapan Tidak Static?

Kadang logger non-static dipakai ketika:

1. class hierarchy ingin logger name mengikuti subclass runtime,
2. framework/proxy menghasilkan dynamic class,
3. testing ingin inject logger wrapper,
4. library tertentu punya pattern khusus.

Namun default terbaik untuk kebanyakan service class tetap:

```java
private static final Logger log = LoggerFactory.getLogger(CurrentClass.class);
```

### 3.3 Jangan Pakai Wrong Class

Anti-pattern:

```java
public final class PaymentService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class); // salah
}
```

Efeknya:

1. log query berdasarkan logger name menjadi misleading,
2. level override per package/class tidak bekerja sesuai ekspektasi,
3. troubleshooting menjadi membingungkan.

### 3.4 Logger Name sebagai Taxonomy

Logger name biasanya mengikuti FQCN:

```text
com.company.case.application.CaseSubmissionService
com.company.case.infrastructure.OracleCaseRepository
com.company.case.integration.OnemapClient
```

Ini membuat kita bisa mengatur level:

```text
com.company.case.integration = DEBUG
com.company.case.application = INFO
com.company.case.infrastructure = WARN
```

Logger name bukan sekadar metadata. Ia adalah routing/filtering hierarchy.

---

## 4. Parameterized Logging

Parameterized logging adalah pola:

```java
log.info("Case {} submitted by user {}", caseId, userId);
```

bukan:

```java
log.info("Case " + caseId + " submitted by user " + userId);
```

### 4.1 Kenapa Bukan String Concatenation?

Karena string concatenation terjadi **sebelum** method `log.info(...)` dipanggil.

Contoh:

```java
log.debug("payload=" + expensivePayloadToJson(payload));
```

Walaupun `DEBUG` disabled, `expensivePayloadToJson(payload)` tetap dieksekusi karena Java harus membangun argument method terlebih dahulu.

Parameterized logging menunda formatting sampai backend memutuskan event perlu diproses.

```java
log.debug("payload={}", payload);
```

Namun perhatikan: object `payload` tetap dievaluasi sebagai reference, tetapi `payload.toString()` umumnya baru dibutuhkan saat formatting event.

### 4.2 Mental Model Evaluasi

```text
String concatenation:
    compute all pieces now
    build String now
    call logger
    logger checks level

Parameterized logging:
    pass template + args
    logger checks level
    backend formats only if needed
```

### 4.3 Classic API Placeholder

Placeholder SLF4J adalah `{}`.

```java
log.info("User {} logged in from {}", userId, ipAddress);
```

Bukan:

```java
log.info("User %s logged in from %s", userId, ipAddress); // bukan format SLF4J
```

Bukan juga:

```java
log.info("User {0} logged in from {1}", userId, ipAddress); // bukan MessageFormat
```

### 4.4 Placeholder Count Mismatch

Jika placeholder lebih sedikit dari argument:

```java
log.info("User {} logged in", userId, ipAddress);
```

`ipAddress` bisa diabaikan atau diperlakukan khusus tergantung posisi dan apakah argument terakhir adalah `Throwable`. Jangan bergantung pada behavior ambigu.

Jika placeholder lebih banyak dari argument:

```java
log.info("User {} logged in from {}", userId);
```

log menjadi tidak lengkap dan troubleshooting kehilangan context.

Rule:

```text
Jumlah placeholder harus sama dengan jumlah semantic arguments,
kecuali trailing Throwable memang dimaksudkan sebagai cause.
```

### 4.5 Argument Terakhir Throwable

SLF4J punya convention penting: jika argument terakhir adalah `Throwable`, backend dapat memperlakukannya sebagai cause dan mencetak stack trace.

Benar:

```java
try {
    paymentGateway.charge(command);
} catch (PaymentGatewayException e) {
    log.error("Payment gateway charge failed for order {}", command.orderId(), e);
}
```

Salah:

```java
log.error("Payment failed: {}", e); // sering hanya mencetak e.toString(), bukan stack trace yang lengkap
```

Salah:

```java
log.error("Payment failed for order {} with error {}", orderId, e); 
```

Pada contoh terakhir, `e` bisa dipakai sebagai argument placeholder kedua, bukan cause. Hasilnya stack trace bisa tidak muncul sesuai ekspektasi.

Lebih baik:

```java
log.error("Payment failed for order {}", orderId, e);
```

Atau dengan fluent API:

```java
log.atError()
   .setMessage("Payment failed")
   .addKeyValue("order.id", orderId)
   .setCause(e)
   .log();
```

---

## 5. Kapan `isDebugEnabled()` Masih Diperlukan?

Parameterized logging mengurangi kebutuhan guard seperti:

```java
if (log.isDebugEnabled()) {
    log.debug("User details: {}", user);
}
```

Biasanya cukup:

```java
log.debug("User details: {}", user);
```

Namun guard masih perlu ketika argument construction mahal.

### 5.1 Expensive Argument Construction

Contoh buruk:

```java
log.debug("Request body: {}", objectMapper.writeValueAsString(request));
```

`writeValueAsString` tetap dieksekusi sebelum `log.debug` dipanggil.

Gunakan guard:

```java
if (log.isDebugEnabled()) {
    log.debug("Request body: {}", objectMapper.writeValueAsString(request));
}
```

Atau SLF4J 2.x fluent supplier:

```java
log.atDebug()
   .setMessage("Request body: {}")
   .addArgument(() -> serializeSafely(request))
   .log();
```

### 5.2 Expensive `toString()`

Walaupun parameterized logging menunda formatting, `toString()` tetap bisa mahal ketika level enabled.

Anti-pattern:

```java
record LargeDomainObject(List<Item> items, Map<String, Object> metadata) {}

log.info("Large object: {}", largeDomainObject);
```

Jika `toString()` record mencetak seluruh field, log bisa menjadi besar, lambat, dan membocorkan data.

Lebih baik:

```java
log.info("Large object processed: id={}, itemCount={}", object.id(), object.items().size());
```

### 5.3 Rule Praktis

```text
Tidak mahal, level rendah:
    parameterized logging cukup

Mahal membangun argument:
    guard atau supplier

Mahal dan sensitif:
    jangan log raw object, pilih field yang aman

Butuh structured event:
    fluent API + key-value
```

---

## 6. SLF4J Fluent API

SLF4J 2.x menambahkan fluent API lewat method:

```java
log.atTrace()
log.atDebug()
log.atInfo()
log.atWarn()
log.atError()
```

Method tersebut mengembalikan `LoggingEventBuilder`.

Contoh:

```java
log.atInfo()
   .setMessage("Case submitted")
   .addKeyValue("case.id", caseId)
   .addKeyValue("module", "APPLICATION")
   .addKeyValue("actor.user_id", userId)
   .log();
```

### 6.1 Fluent API sebagai Event Builder

Mental model:

```text
classic API:
    message template + positional args

fluent API:
    build event object
    attach message
    attach arguments
    attach key-value pairs
    attach marker
    attach cause
    emit event
```

### 6.2 Terminal Operation `.log()`

Fluent API wajib diakhiri `.log()`.

Salah:

```java
log.atInfo()
   .setMessage("Case submitted")
   .addKeyValue("case.id", caseId);
```

Tidak ada event yang dikirim.

Benar:

```java
log.atInfo()
   .setMessage("Case submitted")
   .addKeyValue("case.id", caseId)
   .log();
```

### 6.3 Kapan Memakai Fluent API?

Gunakan fluent API ketika:

1. log event punya banyak structured fields,
2. butuh key-value queryable fields,
3. butuh supplier/lazy argument,
4. butuh marker lebih dari satu,
5. ingin attach exception secara eksplisit dengan `setCause`,
6. ingin menghindari placeholder panjang dan rapuh,
7. ingin membuat event schema stabil.

Contoh classic yang mulai tidak nyaman:

```java
log.info(
    "Case {} transitioned from {} to {} by user {} reason {} durationMs {}",
    caseId,
    oldState,
    newState,
    userId,
    reasonCode,
    durationMs
);
```

Lebih baik:

```java
log.atInfo()
   .setMessage("Case state transitioned")
   .addKeyValue("case.id", caseId)
   .addKeyValue("state.from", oldState)
   .addKeyValue("state.to", newState)
   .addKeyValue("actor.user_id", userId)
   .addKeyValue("reason.code", reasonCode)
   .addKeyValue("duration.ms", durationMs)
   .log();
```

### 6.4 Classic API Masih Valid

Jangan membuat semua log menjadi fluent kalau tidak perlu.

Ini tetap bagus:

```java
log.debug("Loaded {} configuration entries", entries.size());
```

Tidak perlu dipaksakan menjadi:

```java
log.atDebug()
   .setMessage("Loaded configuration entries")
   .addKeyValue("entry.count", entries.size())
   .log();
```

Kecuali `entry.count` memang perlu queryable sebagai field.

---

## 7. Key-Value Logging

Key-value logging adalah cara menambahkan field terstruktur ke event log.

```java
log.atInfo()
   .setMessage("External API call completed")
   .addKeyValue("dependency.name", "onemap")
   .addKeyValue("http.method", "GET")
   .addKeyValue("http.status_code", 200)
   .addKeyValue("duration.ms", durationMs)
   .log();
```

### 7.1 Kenapa Key-Value Penting?

Text log bagus untuk dibaca manusia, tetapi lemah untuk query.

Text:

```text
External API call completed dependency=onemap status=200 durationMs=123
```

Structured event:

```json
{
  "message": "External API call completed",
  "dependency.name": "onemap",
  "http.method": "GET",
  "http.status_code": 200,
  "duration.ms": 123
}
```

Structured event lebih mudah untuk:

1. filtering,
2. aggregation,
3. dashboard,
4. alerting,
5. correlation dengan trace,
6. cost/cardinality governance.

### 7.2 Key-Value Bukan Pengganti Message

Jangan menulis:

```java
log.atInfo()
   .addKeyValue("case.id", caseId)
   .addKeyValue("state.to", "SUBMITTED")
   .log();
```

Event tetap perlu message/event name.

Lebih baik:

```java
log.atInfo()
   .setMessage("Case submitted")
   .addKeyValue("case.id", caseId)
   .addKeyValue("state.to", "SUBMITTED")
   .log();
```

### 7.3 Message vs Event Name

SLF4J menyediakan message, tetapi tidak native menyediakan `event.name` secara khusus. Kita bisa memasukkannya sebagai key-value.

```java
log.atInfo()
   .setMessage("Case submitted")
   .addKeyValue("event.name", "case.submitted")
   .addKeyValue("case.id", caseId)
   .log();
```

Untuk production structured logging, saya sarankan:

```text
message:
    kalimat pendek untuk manusia

event.name:
    identifier stabil untuk query dan alert
```

Contoh:

```java
log.atWarn()
   .setMessage("Idempotent request replay detected")
   .addKeyValue("event.name", "request.idempotency_replay_detected")
   .addKeyValue("idempotency.key", key)
   .addKeyValue("request.id", requestId)
   .log();
```

### 7.4 Key Naming Convention

Gunakan nama field stabil dan konsisten.

Bagus:

```text
case.id
actor.user_id
tenant.id
http.status_code
duration.ms
dependency.name
error.code
retry.attempt
```

Buruk:

```text
caseId
case_id
CaseID
cid
idCase
```

Kalau setiap tim memakai nama field berbeda, query lintas service menjadi mahal.

### 7.5 Dots vs Snake Case

Dua style umum:

```text
http.status_code
actor.user_id
case.id
```

atau:

```text
http_status_code
actor_user_id
case_id
```

Untuk sistem observability modern, dotted attributes sering cocok karena selaras dengan semantic conventions dan namespace concept. Namun beberapa log platform lebih nyaman dengan flat snake_case.

Rule:

```text
Pilih satu style secara organisasi.
Jangan campur tanpa alasan kuat.
```

### 7.6 Cardinality Risk

Tidak semua field aman dijadikan key-value.

Low-cardinality:

```text
environment=prod
region=ap-southeast-1
service.name=case-service
http.method=GET
http.status_code=200
error.type=TimeoutException
```

High-cardinality:

```text
user.id=...
case.id=...
request.id=...
trace.id=...
email=...
phone=...
raw.sql=...
```

High-cardinality field boleh ada di logs untuk debugging, tetapi hati-hati jika dipakai sebagai metric label, index field, atau alert grouping.

### 7.7 Jangan Log Secret

Jangan pernah menaruh ini sebagai key-value:

```text
password
access_token
refresh_token
authorization header
session cookie
api key
private key
otp
secret answer
```

Contoh buruk:

```java
log.atDebug()
   .setMessage("Calling API")
   .addKeyValue("authorization", authorizationHeader)
   .log();
```

Lebih baik:

```java
log.atDebug()
   .setMessage("Calling API")
   .addKeyValue("auth.scheme", "Bearer")
   .addKeyValue("auth.present", true)
   .log();
```

---

## 8. Markers

Marker adalah metadata yang menandai log event untuk tujuan khusus.

```java
import org.slf4j.Marker;
import org.slf4j.MarkerFactory;

private static final Marker SECURITY = MarkerFactory.getMarker("SECURITY");

log.warn(SECURITY, "Failed login attempt for username {}", username);
```

### 8.1 Marker Bukan Level

Level menjawab:

```text
Seberapa serius event ini?
```

Marker menjawab:

```text
Event ini termasuk kategori/routing khusus apa?
```

Contoh marker:

```text
SECURITY
AUDIT
PII_BLOCKED
PAYMENT
COMPLIANCE
BUSINESS_CRITICAL
EXTERNAL_DEPENDENCY
```

### 8.2 Use Case Marker

Marker berguna untuk:

1. routing log ke appender khusus,
2. filtering security/audit events,
3. memisahkan compliance event dari diagnostic event,
4. menandai log yang harus retention lebih lama,
5. trigger alert khusus,
6. membedakan event operational vs forensic.

### 8.3 Marker vs Key-Value

Marker:

```text
kategori event, sering dipakai routing/filtering cepat
```

Key-value:

```text
field detail event, dipakai query/analytics
```

Contoh kombinasi:

```java
private static final Marker AUDIT = MarkerFactory.getMarker("AUDIT");

log.atInfo()
   .addMarker(AUDIT)
   .setMessage("Case ownership changed")
   .addKeyValue("event.name", "case.ownership_changed")
   .addKeyValue("case.id", caseId)
   .addKeyValue("actor.user_id", actorUserId)
   .addKeyValue("owner.from", oldOwnerId)
   .addKeyValue("owner.to", newOwnerId)
   .log();
```

### 8.4 Jangan Overuse Marker

Anti-pattern:

```java
Marker CASE_ID_123 = MarkerFactory.getMarker("CASE_123");
```

Marker bukan tempat untuk value dinamis. Value dinamis harus masuk key-value/MDC/attributes.

Marker harus low-cardinality dan stabil.

Bagus:

```text
AUDIT
SECURITY
EXTERNAL_DEPENDENCY
```

Buruk:

```text
USER_123456
CASE_ABC-999
REQUEST_550e8400-e29b-41d4-a716-446655440000
```

---

## 9. MDC: Mapped Diagnostic Context

MDC adalah context map yang diasosiasikan dengan thread eksekusi.

Contoh:

```java
import org.slf4j.MDC;

MDC.put("request.id", requestId);
MDC.put("trace.id", traceId);
MDC.put("actor.user_id", userId);

try {
    service.handle(request);
} finally {
    MDC.clear();
}
```

Jika backend layout dikonfigurasi untuk mencetak MDC, semua log dalam thread tersebut dapat membawa field context.

### 9.1 Mental Model MDC

```text
Current thread
    |
    | has diagnostic context map
    v
MDC:
    request.id = abc
    trace.id   = def
    tenant.id  = agency-1
```

Saat log dibuat:

```text
log event = message + level + logger + thread + MDC snapshot/context
```

### 9.2 MDC Cocok untuk Apa?

MDC cocok untuk context yang berlaku sepanjang request/task:

```text
request.id
correlation.id
trace.id
span.id
tenant.id
actor.user_id
job.execution_id
message.id
case.id jika seluruh flow memang satu case
```

MDC kurang cocok untuk field yang hanya berlaku pada satu event. Untuk field event-specific, gunakan key-value logging.

### 9.3 MDC vs Key-Value

MDC:

```text
context ambient untuk banyak log event dalam satu execution scope
```

Key-value:

```text
field khusus satu log event
```

Contoh:

```java
// request filter
MDC.put("request.id", requestId);
MDC.put("tenant.id", tenantId);

// inside service
log.atInfo()
   .setMessage("Case submitted")
   .addKeyValue("case.id", caseId)
   .addKeyValue("event.name", "case.submitted")
   .log();
```

Hasil event ideal:

```json
{
  "message": "Case submitted",
  "request.id": "req-123",
  "tenant.id": "cea",
  "case.id": "case-456",
  "event.name": "case.submitted"
}
```

### 9.4 MDC Leak

MDC sering berbasis `ThreadLocal`. Pada thread pool, thread digunakan ulang.

Jika tidak dibersihkan:

```java
MDC.put("request.id", requestId);
service.handle(request);
// lupa clear
```

Request berikutnya yang memakai thread sama bisa mewarisi `request.id` lama.

Ini fatal karena log correlation menjadi salah.

Rule:

```java
MDC.put("request.id", requestId);
try {
    chain.doFilter(request, response);
} finally {
    MDC.clear();
}
```

Atau lebih aman:

```java
Map<String, String> previous = MDC.getCopyOfContextMap();
try {
    MDC.put("request.id", requestId);
    chain.doFilter(request, response);
} finally {
    if (previous == null) {
        MDC.clear();
    } else {
        MDC.setContextMap(previous);
    }
}
```

### 9.5 AutoCloseable MDC Scope

Buat utility agar aman:

```java
public final class MdcScope implements AutoCloseable {
    private final Map<String, String> previous;

    private MdcScope(Map<String, String> values) {
        this.previous = MDC.getCopyOfContextMap();
        values.forEach(MDC::put);
    }

    public static MdcScope put(String key, String value) {
        return new MdcScope(Map.of(key, value));
    }

    public static MdcScope putAll(Map<String, String> values) {
        return new MdcScope(values);
    }

    @Override
    public void close() {
        if (previous == null) {
            MDC.clear();
        } else {
            MDC.setContextMap(previous);
        }
    }
}
```

Penggunaan:

```java
try (MdcScope ignored = MdcScope.put("case.id", caseId)) {
    log.info("Processing case");
    workflow.advance(caseId);
}
```

### 9.6 Java 8 Compatibility Note

`Map.of(...)` tidak ada di Java 8. Untuk Java 8:

```java
Map<String, String> values = new HashMap<>();
values.put("case.id", caseId);
try (MdcScope ignored = MdcScope.putAll(values)) {
    // ...
}
```

---

## 10. MDC dan Async Boundary

MDC tidak otomatis berpindah ke thread lain.

### 10.1 ExecutorService

Contoh problem:

```java
MDC.put("request.id", requestId);
executor.submit(() -> log.info("Async task running"));
```

Task bisa berjalan di thread lain tanpa MDC.

Solusi: capture context lalu restore dalam task.

```java
public final class MdcPropagatingRunnable implements Runnable {
    private final Runnable delegate;
    private final Map<String, String> context;

    public MdcPropagatingRunnable(Runnable delegate) {
        this.delegate = delegate;
        this.context = MDC.getCopyOfContextMap();
    }

    @Override
    public void run() {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            if (context == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(context);
            }
            delegate.run();
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }
}
```

Usage:

```java
executor.submit(new MdcPropagatingRunnable(() -> {
    log.info("Async task running");
}));
```

### 10.2 CompletableFuture

Problem:

```java
CompletableFuture.supplyAsync(() -> {
    log.info("Loading data");
    return repository.load();
});
```

MDC dari request thread tidak otomatis ada.

Solusi:

```java
Executor contextAwareExecutor = command -> {
    Map<String, String> context = MDC.getCopyOfContextMap();
    delegateExecutor.execute(() -> {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            if (context == null) MDC.clear(); else MDC.setContextMap(context);
            command.run();
        } finally {
            if (previous == null) MDC.clear(); else MDC.setContextMap(previous);
        }
    });
};
```

Lalu:

```java
CompletableFuture.supplyAsync(() -> repository.load(), contextAwareExecutor);
```

### 10.3 Reactor / Reactive Pipeline

Pada Reactor, execution tidak selalu tetap di thread yang sama. MDC berbasis ThreadLocal bisa hilang saat `publishOn`/`subscribeOn`.

Strategi umum:

1. simpan correlation data di Reactor Context,
2. restore ke MDC di boundary operator/logging hook,
3. atau gunakan instrumentation framework yang mendukung context propagation.

Jangan berasumsi MDC otomatis aman pada reactive flow.

### 10.4 Virtual Threads

Virtual threads mengurangi masalah thread pool reuse untuk banyak request karena virtual thread biasanya tidak reused seperti platform thread pool tradisional. Namun bukan berarti context propagation hilang sebagai masalah.

Masalah yang tetap ada:

1. child task context,
2. structured concurrency,
3. handoff ke executor lain,
4. library yang masih memakai platform thread pool,
5. ThreadLocal memory/cost bila digunakan berlebihan.

Untuk Java modern, perhatikan perkembangan `ScopedValue` sebagai alternatif context immutable untuk lexical scope. Namun logging backend dan MDC ecosystem masih banyak yang ThreadLocal-based.

Rule praktis Java 8–25:

```text
Java 8–17 platform thread pool:
    MDC harus dikelola ketat dan dipropagasikan manual/otomatis

Java 21+ virtual thread:
    MDC lebih aman dari reuse leak pada request-per-virtual-thread,
    tetapi tetap hati-hati pada async handoff dan ThreadLocal footprint

Java modern dengan ScopedValue:
    cocok untuk domain context immutable,
    tapi integrasi logging perlu adapter eksplisit
```

---

## 11. Exception Logging dengan SLF4J

Exception logging adalah salah satu area paling sering salah.

### 11.1 Jangan Hilangkan Cause

Buruk:

```java
catch (Exception e) {
    log.error("Failed: {}", e.getMessage());
}
```

Masalah:

1. stack trace hilang,
2. exception type bisa hilang,
3. root cause hilang,
4. line number hilang,
5. nested cause hilang.

Lebih baik:

```java
catch (Exception e) {
    log.error("Failed to process case {}", caseId, e);
}
```

### 11.2 Jangan Double Log Exception

Buruk:

```java
try {
    service.process(command);
} catch (Exception e) {
    log.error("Service failed", e);
    throw e;
}
```

Lalu di controller:

```java
catch (Exception e) {
    log.error("Request failed", e);
}
```

Hasilnya satu exception dicetak berkali-kali.

Rule:

```text
Log exception di boundary yang memiliki context cukup dan bertanggung jawab mengubahnya menjadi response/outcome.
Layer bawah boleh menambahkan context dengan wrapping, tetapi jangan selalu log.
```

### 11.3 Wrapping Exception dengan Context

Lebih baik:

```java
try {
    gateway.call(request);
} catch (IOException e) {
    throw new ExternalDependencyException(
        "Failed to call payment gateway for order " + orderId,
        e
    );
}
```

Lalu boundary log:

```java
catch (ExternalDependencyException e) {
    log.error("Order submission failed due to external dependency", e);
    return errorResponse(...);
}
```

### 11.4 Expected Exception Tidak Selalu ERROR

Contoh validation failure:

```java
log.warn("Invalid submission rejected: caseId={}, reason={}", caseId, reason);
```

Bahkan bisa `INFO` jika itu bagian normal dari domain.

Contoh:

```java
log.info("Duplicate idempotency request replayed: key={}", idempotencyKey);
```

Jangan jadikan semua exception sebagai `ERROR`.

### 11.5 Fluent Exception Logging

```java
log.atError()
   .setMessage("External dependency call failed")
   .addKeyValue("dependency.name", "payment-gateway")
   .addKeyValue("operation", "charge")
   .addKeyValue("order.id", orderId)
   .addKeyValue("retry.attempt", attempt)
   .setCause(e)
   .log();
```

Ini lebih jelas daripada placeholder panjang.

---

## 12. Supplier dan Lazy Arguments di SLF4J 2.x

Fluent API mendukung supplier untuk argument tertentu.

```java
log.atDebug()
   .setMessage("Request payload: {}")
   .addArgument(() -> serializeForDebug(request))
   .log();
```

Supplier berguna ketika argument mahal dibuat.

### 12.1 Jangan Pakai Supplier untuk Semuanya

Tidak perlu:

```java
log.atInfo()
   .setMessage("Case {} submitted")
   .addArgument(() -> caseId)
   .log();
```

Cukup:

```java
log.info("Case {} submitted", caseId);
```

Supplier paling berguna untuk:

1. JSON serialization,
2. expensive summary computation,
3. building diagnostic dump,
4. querying object graph,
5. formatting large collection summary.

### 12.2 Supplier Tetap Harus Aman

Buruk:

```java
log.atDebug()
   .setMessage("User: {}")
   .addArgument(() -> user.toString())
   .log();
```

Jika `DEBUG` enabled di production saat incident, bisa bocor PII.

Lebih baik:

```java
log.atDebug()
   .setMessage("User summary: {}")
   .addArgument(() -> UserLogSummary.safe(user))
   .log();
```

---

## 13. Fluent API Pattern Library

### 13.1 State Transition Event

```java
log.atInfo()
   .setMessage("Case state transitioned")
   .addKeyValue("event.name", "case.state_transitioned")
   .addKeyValue("case.id", caseId)
   .addKeyValue("state.from", fromState)
   .addKeyValue("state.to", toState)
   .addKeyValue("actor.user_id", actorUserId)
   .addKeyValue("reason.code", reasonCode)
   .log();
```

### 13.2 External Dependency Call

```java
log.atInfo()
   .setMessage("External dependency call completed")
   .addKeyValue("event.name", "dependency.call_completed")
   .addKeyValue("dependency.name", "onemap")
   .addKeyValue("operation", "postal_code_lookup")
   .addKeyValue("http.method", "GET")
   .addKeyValue("http.status_code", statusCode)
   .addKeyValue("duration.ms", durationMs)
   .addKeyValue("outcome", "success")
   .log();
```

Failure:

```java
log.atWarn()
   .setMessage("External dependency call failed")
   .addKeyValue("event.name", "dependency.call_failed")
   .addKeyValue("dependency.name", "onemap")
   .addKeyValue("operation", "postal_code_lookup")
   .addKeyValue("http.status_code", statusCode)
   .addKeyValue("duration.ms", durationMs)
   .addKeyValue("retryable", retryable)
   .addKeyValue("retry.attempt", attempt)
   .setCause(e)
   .log();
```

### 13.3 Idempotency Replay

```java
log.atInfo()
   .setMessage("Idempotency replay detected")
   .addKeyValue("event.name", "request.idempotency_replay_detected")
   .addKeyValue("idempotency.key", idempotencyKey)
   .addKeyValue("request.id", requestId)
   .addKeyValue("original.request_id", originalRequestId)
   .addKeyValue("outcome", "replayed")
   .log();
```

### 13.4 Validation Rejection

```java
log.atInfo()
   .setMessage("Submission rejected by validation")
   .addKeyValue("event.name", "submission.validation_rejected")
   .addKeyValue("case.id", caseId)
   .addKeyValue("validation.rule", ruleCode)
   .addKeyValue("field.name", fieldName)
   .addKeyValue("outcome", "rejected")
   .log();
```

### 13.5 Authorization Denied

```java
private static final Marker SECURITY = MarkerFactory.getMarker("SECURITY");

log.atWarn()
   .addMarker(SECURITY)
   .setMessage("Access denied")
   .addKeyValue("event.name", "security.access_denied")
   .addKeyValue("actor.user_id", userId)
   .addKeyValue("resource.type", "case")
   .addKeyValue("resource.id", caseId)
   .addKeyValue("action", "approve")
   .addKeyValue("reason.code", "INSUFFICIENT_ROLE")
   .log();
```

### 13.6 Batch Job Summary

```java
log.atInfo()
   .setMessage("Batch job completed")
   .addKeyValue("event.name", "batch.job_completed")
   .addKeyValue("job.name", jobName)
   .addKeyValue("job.execution_id", executionId)
   .addKeyValue("items.read", readCount)
   .addKeyValue("items.processed", processedCount)
   .addKeyValue("items.failed", failedCount)
   .addKeyValue("duration.ms", durationMs)
   .addKeyValue("outcome", failedCount == 0 ? "success" : "partial_failure")
   .log();
```

---

## 14. SLF4J di Library Code

Jika kamu membuat shared library, logging harus hati-hati.

### 14.1 Dependency Rule

Maven library:

```xml
<dependency>
    <groupId>org.slf4j</groupId>
    <artifactId>slf4j-api</artifactId>
</dependency>
```

Jangan tambahkan:

```xml
<dependency>
    <groupId>ch.qos.logback</groupId>
    <artifactId>logback-classic</artifactId>
</dependency>
```

kecuali module itu memang aplikasi deployable.

### 14.2 Library Logging Semantics

Library harus:

1. log secukupnya,
2. tidak spam INFO,
3. tidak log secret payload,
4. tidak mengatur global MDC sembarangan,
5. tidak melakukan `System.out.println`,
6. tidak menentukan backend logging,
7. tidak override global logging configuration.

### 14.3 Library Should Prefer DEBUG for Internal Details

```java
log.debug("Resolved {} handlers for type {}", handlers.size(), type);
```

INFO hanya untuk lifecycle penting jika library memang punya lifecycle runtime signifikan.

---

## 15. SLF4J di Application Code

Application code boleh lebih ekspresif karena memiliki domain context.

### 15.1 Application Boundary Events

Log pada boundary:

1. incoming HTTP request summary,
2. outgoing HTTP dependency summary,
3. message consumed/produced,
4. job started/completed,
5. state transition,
6. authorization denial,
7. unexpected failure,
8. configuration loaded,
9. service startup/shutdown.

### 15.2 Jangan Log Semua Method Entry/Exit

Anti-pattern:

```java
log.debug("Entering method A");
log.debug("Exiting method A");
```

Ini hanya noise, kecuali pada library/framework tertentu atau temporary diagnostic mode.

Lebih baik log event bermakna:

```java
log.debug("Selected workflow route {} for case type {}", routeId, caseType);
```

---

## 16. Lombok `@Slf4j`

Lombok menyediakan:

```java
@Slf4j
public class CaseService {
    public void submit() {
        log.info("Submitting case");
    }
}
```

Ini menghasilkan logger otomatis.

### 16.1 Kelebihan

1. mengurangi boilerplate,
2. konsisten,
3. populer di Spring ecosystem.

### 16.2 Kekurangan

1. generated code tidak terlihat langsung,
2. menambah compile-time magic,
3. bisa kurang disukai di library public,
4. migration/refactoring logger name perlu dipahami.

Jika tim sudah memakai Lombok secara konsisten, `@Slf4j` acceptable. Jika tim menghindari Lombok untuk domain-critical code, gunakan explicit logger.

---

## 17. SLF4J Bridges dan Binding Pitfalls

### 17.1 Binding/Provider Multiplicity

Aplikasi harus punya satu backend final.

Masalah umum:

```text
slf4j-api
logback-classic
log4j-slf4j2-impl
```

Ini berarti dua provider bersaing. Hasilnya warning dan behavior tidak jelas.

Rule:

```text
Exactly one SLF4J provider/backend in final runtime classpath.
```

### 17.2 Bridge Loop

Bridge mengarahkan framework lain ke SLF4J atau sebaliknya.

Contoh:

```text
jul-to-slf4j:
    JUL -> SLF4J

log4j-to-slf4j:
    Log4j API -> SLF4J

jcl-over-slf4j:
    Commons Logging -> SLF4J
```

Namun hati-hati loop:

```text
Log4j -> SLF4J -> Log4j
```

Jika bridge dan provider saling balik, bisa terjadi infinite recursion atau crash.

### 17.3 Spring Boot Consideration

Spring Boot default-nya memakai SLF4J dengan Logback, kecuali dependency logging diganti. Saat mengganti ke Log4j2, exclusion harus bersih.

Konseptual:

```text
Remove default starter logging
Add Log4j2 starter/provider
Ensure no duplicate provider
```

---

## 18. Performance Model SLF4J

### 18.1 Disabled Level

```java
log.debug("Case {} loaded", caseId);
```

Jika DEBUG disabled:

1. method dipanggil,
2. level check dilakukan,
3. formatting tidak dilakukan,
4. event tidak diteruskan.

Cost rendah.

Tapi:

```java
log.debug("Case {} loaded", expensiveCall());
```

`expensiveCall()` tetap dieksekusi.

### 18.2 Enabled Level

Jika level enabled:

1. event object/metadata dibangun,
2. args disimpan/diformat,
3. MDC/context diambil,
4. backend filter berjalan,
5. layout/encoder format event,
6. appender menulis ke target,
7. mungkin async queue involved.

Cost bisa signifikan.

### 18.3 Stack Trace Cost

Stack trace mahal karena:

1. object exception membawa stack frames,
2. formatting multiline besar,
3. ingestion log menjadi berat,
4. indexing mahal,
5. repeated exceptions membuat noise.

Jangan mencetak stack trace untuk expected validation/domain rejection.

### 18.4 Caller Location Cost

Beberapa backend bisa mencetak caller class/method/line.

Contoh pattern:

```text
%class.%method:%line
```

Ini mahal karena perlu inspect stack.

Rule:

```text
Jangan enable caller location secara global di high-throughput production,
kecuali ada kebutuhan forensic kuat dan sudah diuji overhead-nya.
```

---

## 19. Secure SLF4J Usage

### 19.1 Jangan Log Raw Request/Response Body Default

Buruk:

```java
log.info("Request body: {}", body);
```

Masalah:

1. PII,
2. secret,
3. payload besar,
4. compliance risk,
5. log cost tinggi.

Lebih baik:

```java
log.atInfo()
   .setMessage("Request received")
   .addKeyValue("http.method", method)
   .addKeyValue("http.route", route)
   .addKeyValue("content.length", contentLength)
   .addKeyValue("request.id", requestId)
   .log();
```

### 19.2 Redaction Boundary

Jika harus log payload untuk debugging, gunakan redaction utility:

```java
log.atDebug()
   .setMessage("Sanitized request payload: {}")
   .addArgument(() -> redactor.redactAndSummarize(payload))
   .log();
```

### 19.3 Log Injection

User input bisa mengandung newline:

```text
username = "alice\nERROR Admin login succeeded"
```

Jika langsung masuk log text, bisa memalsukan baris log.

Mitigation:

1. structured logging JSON,
2. escaping oleh encoder,
3. sanitasi newline untuk field tertentu,
4. jangan render raw user input di message utama.

Buruk:

```java
log.warn("Login failed for " + username);
```

Lebih baik:

```java
log.atWarn()
   .setMessage("Login failed")
   .addKeyValue("username", Sanitizer.logSafe(username))
   .log();
```

---

## 20. Designing a Team Logging API Wrapper: Perlu atau Tidak?

Kadang tim ingin membuat wrapper:

```java
AuditLogger.logCaseSubmitted(...)
```

Ini bisa bagus atau buruk.

### 20.1 Kapan Wrapper Bagus?

Wrapper bagus untuk event yang harus standar:

1. audit event,
2. security event,
3. compliance event,
4. domain state transition,
5. external dependency event,
6. batch summary event.

Contoh:

```java
public final class AuditEvents {
    private static final Logger log = LoggerFactory.getLogger("audit");
    private static final Marker AUDIT = MarkerFactory.getMarker("AUDIT");

    public static void caseOwnershipChanged(
        String caseId,
        String actorUserId,
        String oldOwner,
        String newOwner
    ) {
        log.atInfo()
           .addMarker(AUDIT)
           .setMessage("Case ownership changed")
           .addKeyValue("event.name", "case.ownership_changed")
           .addKeyValue("case.id", caseId)
           .addKeyValue("actor.user_id", actorUserId)
           .addKeyValue("owner.from", oldOwner)
           .addKeyValue("owner.to", newOwner)
           .log();
    }
}
```

### 20.2 Kapan Wrapper Buruk?

Wrapper buruk jika hanya menyembunyikan SLF4J:

```java
MyLogger.info("hello");
```

Masalah:

1. kehilangan API SLF4J,
2. marker/key-value/cause tidak lengkap,
3. sulit integrasi framework,
4. caller location salah,
5. tidak perlu.

Rule:

```text
Jangan wrap logger umum.
Boleh buat typed event logger untuk audit/security/domain event yang harus standar.
```

---

## 21. Practical Coding Standard

### 21.1 Basic Logger Declaration

```java
private static final Logger log = LoggerFactory.getLogger(CurrentClass.class);
```

### 21.2 Simple Event

```java
log.info("Application module {} initialized", moduleName);
```

### 21.3 Debug with Cheap Arguments

```java
log.debug("Resolved {} candidates for rule {}", candidates.size(), ruleCode);
```

### 21.4 Debug with Expensive Arguments

```java
if (log.isDebugEnabled()) {
    log.debug("Rule evaluation tree: {}", renderTree(tree));
}
```

Atau SLF4J 2.x:

```java
log.atDebug()
   .setMessage("Rule evaluation tree: {}")
   .addArgument(() -> renderTree(tree))
   .log();
```

### 21.5 Structured Business Event

```java
log.atInfo()
   .setMessage("Application submitted")
   .addKeyValue("event.name", "application.submitted")
   .addKeyValue("application.id", applicationId)
   .addKeyValue("actor.user_id", userId)
   .addKeyValue("channel", channel)
   .log();
```

### 21.6 Exception Event

```java
log.atError()
   .setMessage("Application submission failed")
   .addKeyValue("event.name", "application.submission_failed")
   .addKeyValue("application.id", applicationId)
   .addKeyValue("error.code", "SUBMISSION_FAILED")
   .setCause(e)
   .log();
```

### 21.7 Security Event

```java
private static final Marker SECURITY = MarkerFactory.getMarker("SECURITY");

log.atWarn()
   .addMarker(SECURITY)
   .setMessage("Suspicious access pattern detected")
   .addKeyValue("event.name", "security.suspicious_access_detected")
   .addKeyValue("actor.user_id", userId)
   .addKeyValue("source.ip", ipAddress)
   .addKeyValue("reason.code", reasonCode)
   .log();
```

---

## 22. Common Anti-Patterns

### 22.1 String Concatenation

```java
log.debug("User " + userId + " loaded");
```

Better:

```java
log.debug("User {} loaded", userId);
```

### 22.2 `String.format`

```java
log.debug(String.format("User %s loaded", userId));
```

Better:

```java
log.debug("User {} loaded", userId);
```

### 22.3 Exception Message Only

```java
log.error("Failed: {}", e.getMessage());
```

Better:

```java
log.error("Failed to process request {}", requestId, e);
```

### 22.4 Raw Object Logging

```java
log.info("User: {}", user);
```

Better:

```java
log.info("User loaded: userId={}, status={}", user.id(), user.status());
```

### 22.5 High-Cardinality Marker

```java
MarkerFactory.getMarker("USER_" + userId);
```

Better:

```java
log.atInfo()
   .setMessage("User event")
   .addKeyValue("user.id", userId)
   .log();
```

### 22.6 MDC Without Cleanup

```java
MDC.put("request.id", requestId);
handler.handle();
```

Better:

```java
try {
    MDC.put("request.id", requestId);
    handler.handle();
} finally {
    MDC.clear();
}
```

### 22.7 Log and Throw Everywhere

```java
catch (Exception e) {
    log.error("Failed", e);
    throw e;
}
```

Better:

```java
catch (IOException e) {
    throw new ExternalDependencyException("Failed to call X", e);
}
```

Log at boundary.

---

## 23. SLF4J and Java Version Strategy: Java 8–25

### 23.1 Java 8

Common traits:

1. SLF4J 1.7 or 2.x possible depending dependency ecosystem,
2. no `var`, no records, no virtual threads,
3. MDC propagation mostly thread-pool oriented,
4. CompletableFuture exists but context propagation manual,
5. legacy app servers more common.

Recommended:

```text
Use parameterized logging everywhere.
Use explicit guard for expensive diagnostics.
Use strict MDC cleanup.
Avoid backend dependency in libraries.
```

### 23.2 Java 11/17

Common traits:

1. modern LTS baseline,
2. Spring Boot 2.x/3.x split,
3. SLF4J 2.x more common in newer stacks,
4. better container awareness,
5. JFR production viability.

Recommended:

```text
Start moving important domain/diagnostic events to structured key-value style.
Prepare log schema for OpenTelemetry trace correlation.
```

### 23.3 Java 21+

Common traits:

1. virtual threads,
2. structured concurrency preview/incubator depending version,
3. ScopedValue evolution,
4. modern observability agent ecosystem,
5. high concurrency increases importance of low-cost logging.

Recommended:

```text
Revisit MDC assumptions.
Do not store large ThreadLocal context.
Prefer immutable request context abstractions.
Keep logs structured and low allocation.
```

### 23.4 Java 25

Java 25 era systems should assume:

1. coexistence of legacy libraries and modern runtime patterns,
2. virtual-thread-friendly diagnostics,
3. stronger focus on continuous profiling/JFR,
4. structured observability pipelines,
5. logging as one signal among traces/metrics/profiles.

SLF4J remains valuable because application code can stay stable while backend/instrumentation evolves.

---

## 24. Production Review Checklist

Gunakan checklist ini untuk review PR.

### 24.1 API Usage

- [ ] Kode memakai SLF4J API, bukan backend-specific logger kecuali justified.
- [ ] Library hanya depend pada `slf4j-api`.
- [ ] Aplikasi memiliki tepat satu provider/backend SLF4J.
- [ ] Tidak ada `System.out.println` untuk application logs.

### 24.2 Message Quality

- [ ] Message jelas, pendek, dan menyatakan event.
- [ ] Tidak ada log yang hanya berkata `failed`, `error`, `done` tanpa context.
- [ ] Placeholder jumlahnya benar.
- [ ] Exception dipassing sebagai cause, bukan hanya `e.getMessage()`.

### 24.3 Performance

- [ ] Tidak ada string concatenation pada log disabled-prone.
- [ ] Tidak ada `String.format` sebelum logger call.
- [ ] Expensive diagnostic memakai guard/supplier.
- [ ] Tidak log raw large object.
- [ ] Tidak enable caller location sembarangan.

### 24.4 Structured Fields

- [ ] Event penting memakai key-value.
- [ ] `event.name` stabil untuk event penting.
- [ ] Field name mengikuti convention.
- [ ] Tidak ada secret/token/password.
- [ ] High-cardinality field digunakan sadar.

### 24.5 Context

- [ ] MDC dipasang di boundary.
- [ ] MDC dibersihkan di `finally`.
- [ ] Async task punya context propagation jika perlu.
- [ ] Reactive/virtual-thread behavior dipahami.

### 24.6 Security

- [ ] Tidak log raw request body default.
- [ ] Tidak log Authorization/Cookie/token.
- [ ] User input disanitasi/structured encoded.
- [ ] Security/audit event punya marker atau event type jelas.

---

## 25. Practical Lab 1 — Refactor Bad Logs

Refactor kode berikut:

```java
public void submit(Application app) {
    log.info("submit app " + app);
    try {
        repository.save(app);
        log.info("success");
    } catch (Exception e) {
        log.error("error " + e.getMessage());
        throw e;
    }
}
```

Target hasil:

```java
public void submit(Application app) {
    log.atInfo()
       .setMessage("Application submission started")
       .addKeyValue("event.name", "application.submission_started")
       .addKeyValue("application.id", app.id())
       .addKeyValue("application.type", app.type())
       .log();

    try {
        repository.save(app);

        log.atInfo()
           .setMessage("Application submitted")
           .addKeyValue("event.name", "application.submitted")
           .addKeyValue("application.id", app.id())
           .addKeyValue("application.type", app.type())
           .log();
    } catch (RuntimeException e) {
        log.atError()
           .setMessage("Application submission failed")
           .addKeyValue("event.name", "application.submission_failed")
           .addKeyValue("application.id", app.id())
           .addKeyValue("application.type", app.type())
           .setCause(e)
           .log();
        throw e;
    }
}
```

Catatan: apakah perlu log `started` dan `submitted` tergantung volume dan diagnostic value. Pada high-throughput API, mungkin cukup log completion/failure di boundary, bukan dua-duanya.

---

## 26. Practical Lab 2 — Build Request MDC Filter

Servlet filter:

```java
public final class CorrelationMdcFilter implements Filter {
    private static final String REQUEST_ID_HEADER = "X-Request-Id";

    @Override
    public void doFilter(
        ServletRequest servletRequest,
        ServletResponse servletResponse,
        FilterChain chain
    ) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) servletRequest;
        String requestId = resolveRequestId(request);

        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            MDC.put("request.id", requestId);
            MDC.put("http.method", request.getMethod());
            MDC.put("http.route", request.getRequestURI());
            chain.doFilter(servletRequest, servletResponse);
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }

    private String resolveRequestId(HttpServletRequest request) {
        String value = request.getHeader(REQUEST_ID_HEADER);
        if (value == null || value.isBlank()) {
            return UUID.randomUUID().toString();
        }
        return sanitizeRequestId(value);
    }

    private String sanitizeRequestId(String value) {
        return value.replaceAll("[\\r\\n]", "").trim();
    }
}
```

Untuk Java 8, `String.isBlank()` tidak tersedia. Gunakan:

```java
value == null || value.trim().isEmpty()
```

---

## 27. Practical Lab 3 — Context-Aware Executor

```java
public final class MdcAwareExecutor implements Executor {
    private final Executor delegate;

    public MdcAwareExecutor(Executor delegate) {
        this.delegate = Objects.requireNonNull(delegate);
    }

    @Override
    public void execute(Runnable command) {
        Map<String, String> captured = MDC.getCopyOfContextMap();
        delegate.execute(() -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                if (captured == null) {
                    MDC.clear();
                } else {
                    MDC.setContextMap(captured);
                }
                command.run();
            } finally {
                if (previous == null) {
                    MDC.clear();
                } else {
                    MDC.setContextMap(previous);
                }
            }
        });
    }
}
```

Usage:

```java
Executor executor = new MdcAwareExecutor(Executors.newFixedThreadPool(16));

CompletableFuture.supplyAsync(() -> {
    log.info("Loading case asynchronously");
    return repository.load(caseId);
}, executor);
```

---

## 28. Mini Design Exercise — Logging Contract for Case Workflow

Desain event SLF4J untuk workflow berikut:

```text
DRAFT -> SUBMITTED -> SCREENING -> APPROVED -> CLOSED
```

Required events:

1. state transition,
2. validation rejected,
3. authorization denied,
4. external dependency timeout,
5. idempotent replay,
6. workflow completion.

Suggested event names:

```text
case.state_transitioned
case.validation_rejected
security.access_denied
dependency.call_timeout
request.idempotency_replay_detected
case.workflow_completed
```

Suggested core fields:

```text
case.id
state.from
state.to
actor.user_id
reason.code
request.id
correlation.id
trace.id
span.id
outcome
duration.ms
```

The top-tier mindset is not “log everything”. It is designing the minimum event set that can reconstruct state, causality, impact, and failure reason.

---

## 29. Decision Matrix

| Situation | Recommended SLF4J Style |
|---|---|
| Simple info/debug message | Classic parameterized API |
| Expensive debug argument | Guard or fluent supplier |
| Exception with stack trace | Classic trailing Throwable or fluent `setCause` |
| Domain event with fields | Fluent API + key-value |
| Security/audit routing | Marker + key-value |
| Request-wide context | MDC |
| Event-specific detail | Key-value |
| Library internal details | DEBUG classic API |
| High-volume success path | Consider sampling or summary |
| Expected validation failure | INFO/WARN without stack trace |
| Unexpected system failure | ERROR with cause |

---

## 30. Summary

SLF4J terlihat sederhana, tetapi di tangan engineer yang matang, ia menjadi contract penting untuk runtime evidence.

Hal paling penting dari bagian ini:

1. SLF4J adalah facade; backend dipilih runtime.
2. Gunakan parameterized logging, bukan concatenation.
3. Guard/supplier tetap perlu untuk expensive argument construction.
4. Exception harus dipassing sebagai cause, bukan hanya message.
5. SLF4J 2.x fluent API cocok untuk structured event.
6. Key-value logging membuat event machine-queryable.
7. Marker cocok untuk kategori/routing khusus, bukan dynamic value.
8. MDC cocok untuk request/task context, tetapi wajib cleanup.
9. Async boundary membutuhkan context propagation eksplisit.
10. Logging harus memperhatikan cost, PII, cardinality, dan incident value.

Jika Part 3 menjawab “apa yang layak dilog dan kenapa”, maka Part 4 menjawab “bagaimana membentuk log event dengan benar menggunakan SLF4J”.

---

## 31. Referensi Utama

- SLF4J Manual — parameterized logging, fluent logging API, providers, and usage model.
- SLF4J FAQ — logging performance and parameterized logging rationale.
- SLF4J API documentation — `Logger`, `LoggingEventBuilder`, `Marker`, `MDC`, `KeyValuePair`.
- Logback documentation — backend behavior for SLF4J, MDC, marker/filter integration.
- Log4j2 documentation — SLF4J provider, ThreadContext, layouts, async loggers.
- OWASP Logging Cheat Sheet — security-sensitive logging guidance.
- OpenTelemetry Java documentation — correlation context, traces/logs/metrics integration.

---

## 32. Status Series

Selesai sampai:

```text
Part 4 — SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging
```

Seri belum selesai.

Berikutnya:

```text
Part 5 — Logback Deep Dive I: Architecture, Configuration, Appenders, Encoders
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./03-log-semantics-what-should-be-logged-and-why.md">⬅️ Part 3 — Log Semantics: What Should Be Logged and Why</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./05-logback-deep-dive-architecture-configuration-appenders-encoders.md">Part 5 — Logback Deep Dive I: Architecture, Configuration, Appenders, Encoders ➡️</a>
</div>
