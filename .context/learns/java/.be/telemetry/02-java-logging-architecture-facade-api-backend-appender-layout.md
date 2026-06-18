# Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Module: Java Logging Architecture  
> Scope: Java 8 sampai Java 25  
> Goal: memahami logging Java sebagai pipeline runtime event, bukan sekadar `logger.info(...)`.

---

## 0. Posisi Part Ini Dalam Series

Pada Part 1 kita sudah membangun mental model bahwa logging adalah salah satu bentuk **runtime evidence**. Log bukan tujuan akhir. Log adalah event evidence yang dipakai untuk membaca perilaku sistem saat sistem berjalan, terutama ketika debugger tidak tersedia, incident sedang terjadi, dan sistem sudah terdistribusi.

Part 2 ini turun satu level lebih teknis: **bagaimana arsitektur logging Java sebenarnya bekerja**.

Banyak engineer bisa menulis:

```java
private static final Logger log = LoggerFactory.getLogger(MyService.class);

log.info("Payment created: {}", paymentId);
```

Tetapi tidak semua engineer memahami:

- siapa yang menerima call itu,
- framework mana yang aktif,
- kenapa kadang log hilang,
- kenapa log dobel,
- kenapa dependency logging bentrok,
- kenapa `logback.xml` tidak terbaca,
- kenapa library memakai JUL tapi aplikasi memakai SLF4J,
- kenapa `commons-logging` muncul di classpath,
- kenapa Spring Boot bisa mengubah logging tanpa kita sadar,
- kenapa async appender bisa drop log,
- kenapa JSON log kadang rusak,
- kenapa app server punya classloader issue,
- kenapa `No SLF4J providers were found` muncul,
- kenapa `StaticLoggerBinder` warning muncul di aplikasi lama,
- kenapa bridge dependency bisa membentuk infinite loop.

Top-tier engineer tidak hanya tahu API. Ia tahu **routing path** dari log event sejak line code sampai storage/collector.

---

## 1. Core Mental Model: Logging Is an Event Pipeline

Satu statement logging sebenarnya melewati pipeline:

```text
Application Code
   |
   | logger.info("User {} submitted case {}", userId, caseId)
   v
Logging API / Facade
   |
   | SLF4J / JUL / Log4j API / Commons Logging
   v
Provider / Binding / Bridge
   |
   | connects API to implementation
   v
Logging Backend / Implementation
   |
   | Logback / Log4j2 / JUL backend / reload4j / custom
   v
Logger Configuration
   |
   | level, hierarchy, additivity, filters
   v
Appender / Handler
   |
   | console, file, rolling file, socket, HTTP, async queue
   v
Layout / Encoder / Formatter
   |
   | text pattern, JSON, ECS, OTel-compatible fields
   v
Output Destination
   |
   | stdout, file, collector, log shipper, SIEM, object storage
   v
Query / Alert / Forensic Usage
```

Jadi logging bukan single object. Ia terdiri dari beberapa layer dengan tanggung jawab berbeda.

Jika kita tidak memahami layer ini, troubleshooting logging akan terasa random.

Contoh:

```text
Symptom: log tidak muncul.
```

Kemungkinan layer penyebab:

| Layer | Kemungkinan Masalah |
|---|---|
| Application code | level disabled, conditional branch tidak jalan |
| Facade/API | salah import logger |
| Provider/binding | tidak ada provider, provider dobel, versi mismatch |
| Backend config | logger level terlalu tinggi |
| Appender | appender tidak attached, async queue drop |
| Encoder/layout | exception formatting salah, JSON invalid |
| Destination | stdout tidak diambil collector, file permission error |
| Pipeline | log shipper lag, indexer drop, retention expired |

Engineer yang kuat tidak langsung mengubah level ke DEBUG. Ia mencari layer mana yang gagal.

---

## 2. Vocabulary Penting

Sebelum masuk detail, kita perlu menyamakan istilah.

## 2.1 Log Event

Log event adalah representasi runtime dari satu kejadian logging.

Biasanya berisi:

- timestamp,
- level,
- logger name,
- thread name,
- message template,
- argument values,
- throwable,
- marker,
- MDC/context map,
- caller data jika diaktifkan,
- key-value attributes,
- sequence/order metadata jika backend mendukung.

Statement ini:

```java
log.warn("Failed to call payment gateway. orderId={}, status={}", orderId, status, ex);
```

akan menjadi event yang kira-kira punya struktur:

```text
timestamp = 2026-06-18T10:15:30.123Z
level = WARN
logger = com.example.payment.PaymentGatewayClient
thread = http-nio-8080-exec-17
messageTemplate = Failed to call payment gateway. orderId={}, status={}
arguments = [ORD-123, 503]
throwable = TimeoutException
mdc = {trace_id=..., tenant_id=..., request_id=...}
```

## 2.2 Logger

Logger adalah object bernama yang digunakan aplikasi untuk membuat log event.

Nama logger biasanya mengikuti fully qualified class name:

```java
LoggerFactory.getLogger(PaymentGatewayClient.class);
```

Nama logger:

```text
com.example.payment.PaymentGatewayClient
```

Logger name membentuk hierarchy berbasis dot-separated namespace:

```text
com
com.example
com.example.payment
com.example.payment.PaymentGatewayClient
```

Hierarchy inilah yang membuat kita bisa mengatur level per package:

```xml
<logger name="com.example.payment" level="DEBUG"/>
<logger name="com.example" level="INFO"/>
<root level="WARN"/>
```

## 2.3 Level

Level adalah severity/verbosity signal.

Umumnya:

```text
TRACE < DEBUG < INFO < WARN < ERROR
```

Makna teknis:

| Level | Kapan Dipakai |
|---|---|
| TRACE | detail sangat granular untuk alur internal, biasanya disabled |
| DEBUG | diagnostic detail untuk developer/operator saat investigation |
| INFO | lifecycle/business/technical event penting yang normal |
| WARN | anomali yang recoverable atau risk signal |
| ERROR | failure yang menyebabkan operasi gagal atau membutuhkan attention |

Level bukan hanya warna di console. Level adalah routing/filtering primitive.

## 2.4 Appender / Handler

Appender adalah komponen yang mengirim log event ke destination.

Contoh destination:

- console/stdout,
- file,
- rolling file,
- socket,
- syslog,
- HTTP endpoint,
- Kafka,
- database,
- async queue wrapper,
- custom sink.

Di JUL istilahnya **Handler**. Di Logback/Log4j2 istilahnya **Appender**.

## 2.5 Layout / Encoder / Formatter

Komponen ini mengubah log event menjadi bytes/string yang akan dikirim.

Contoh output text:

```text
2026-06-18 10:15:30.123 WARN [http-nio-8080-exec-17] c.e.PaymentGatewayClient - Failed to call payment gateway. orderId=ORD-123, status=503
```

Contoh output JSON:

```json
{
  "timestamp": "2026-06-18T10:15:30.123Z",
  "level": "WARN",
  "logger": "com.example.payment.PaymentGatewayClient",
  "thread": "http-nio-8080-exec-17",
  "message": "Failed to call payment gateway. orderId=ORD-123, status=503",
  "order_id": "ORD-123",
  "status": 503,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

Pada Logback modern, **encoder** bertanggung jawab mengubah event menjadi byte array dan menulis ke `OutputStream`. Pada Logback lama, banyak appender memakai layout yang mengubah event menjadi string. Pemisahan ini penting karena console/file output pada akhirnya adalah bytes, bukan sekadar string.

## 2.6 Filter

Filter memutuskan apakah event boleh lanjut ke output.

Filter bisa berbasis:

- level,
- logger name,
- marker,
- MDC value,
- message content,
- exception type,
- sampling rule,
- tenant,
- environment.

Filter adalah alat routing dan noise control, tetapi juga bisa membuat log “hilang” jika tidak dipahami.

## 2.7 Facade

Facade adalah API abstraction di depan implementation.

SLF4J adalah contoh paling umum. Aplikasi dan library memanggil SLF4J, tetapi output sebenarnya ditangani Logback, Log4j2, JUL, atau backend lain.

Tujuannya:

- library tidak memaksa aplikasi memakai backend tertentu,
- aplikasi bisa memilih backend di deployment,
- dependency logging lebih fleksibel,
- migrasi backend lebih mudah.

SLF4J sendiri mendefinisikan diri sebagai facade sederhana untuk berbagai logging system sehingga end-user dapat memasang logging system yang diinginkan pada deployment time.

---

## 3. Java Logging Ecosystem: Kenapa Banyak Sekali?

Java logging ecosystem kompleks karena Java sudah lama, enterprise-heavy, dan backward-compatible.

Timeline mental model:

```text
Early Java
  |
  +-- System.out.println
  +-- custom logging

JDK 1.4 era
  |
  +-- java.util.logging (JUL)

Apache era
  |
  +-- Log4j 1.x
  +-- Commons Logging

Facade era
  |
  +-- SLF4J
  +-- Logback

Modern Log4j era
  |
  +-- Log4j2 API/Core

Java 9+ platform logging
  |
  +-- System.Logger

Observability era
  |
  +-- structured logging
  +-- OpenTelemetry logs
  +-- trace/log correlation
```

Akibatnya satu aplikasi bisa tanpa sadar memuat:

- `java.util.logging`,
- `org.apache.commons.logging`,
- `org.slf4j`,
- `ch.qos.logback`,
- `org.apache.logging.log4j`,
- bridge antar-framework.

Masalahnya bukan banyak framework. Masalahnya adalah **arah routing** harus jelas.

---

## 4. API, Facade, Backend, Bridge: Jangan Dicampur

Ini konsep paling penting di Part 2.

## 4.1 API / Facade

API adalah yang dipanggil kode aplikasi.

Contoh:

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
```

atau:

```java
import java.util.logging.Logger;
```

atau:

```java
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;
```

## 4.2 Backend / Implementation

Backend adalah yang benar-benar memproses dan mengirim event.

Contoh:

- Logback Classic,
- Log4j2 Core,
- JUL LogManager/Handler,
- reload4j,
- simple logger.

## 4.3 Provider / Binding

Provider/binding menyambungkan facade ke backend.

Contoh:

```text
SLF4J API -> Logback provider -> Logback Classic
SLF4J API -> Log4j2 SLF4J provider -> Log4j2 Core
SLF4J API -> JUL provider -> java.util.logging
```

Pada SLF4J 1.x, istilah yang sering muncul adalah **binding** dan class `StaticLoggerBinder`.

Pada SLF4J 2.x, mechanism berubah ke **service provider** berbasis Java ServiceLoader.

Maka warning-nya juga berubah:

```text
SLF4J: Failed to load class "org.slf4j.impl.StaticLoggerBinder".
```

lebih umum di SLF4J 1.x.

Sedangkan di SLF4J 2.x, pesan yang sering muncul:

```text
SLF4J: No SLF4J providers were found.
```

## 4.4 Bridge

Bridge mengalihkan API lama ke API/implementation lain.

Contoh bridge:

```text
JUL -> SLF4J
Commons Logging -> SLF4J
Log4j 1.x API -> SLF4J
Log4j2 API -> SLF4J
SLF4J -> Log4j2
```

Bridge berguna untuk menyatukan logging library pihak ketiga.

Tetapi bridge juga berbahaya jika membentuk siklus.

Contoh siklus konseptual:

```text
jul-to-slf4j  +  slf4j-jdk14

JUL event -> SLF4J -> JUL backend -> SLF4J -> JUL backend -> ...
```

Atau:

```text
log4j-to-slf4j + log4j-slf4j2-impl

Log4j API -> SLF4J -> Log4j2 -> SLF4J -> Log4j2 -> ...
```

Rule praktis:

> Dalam satu aplikasi, tentukan satu arah logging flow. Jangan pasang bridge dua arah.

---

## 5. Common Java Logging Stacks

## 5.1 Stack A: SLF4J + Logback

Ini sangat umum di Spring Boot default ecosystem.

```text
Application Code
   -> SLF4J API
   -> Logback provider
   -> Logback Classic
   -> Appenders/Encoders
```

Typical dependencies:

```text
org.slf4j:slf4j-api
ch.qos.logback:logback-classic
ch.qos.logback:logback-core
```

Kelebihan:

- simpel,
- maturity tinggi,
- default di banyak aplikasi Spring,
- konfigurasi relatif mudah,
- support MDC baik,
- appender ecosystem cukup luas.

Trade-off:

- async logging tidak sekuat Log4j2 AsyncLogger,
- structured JSON biasanya perlu encoder tambahan,
- high-throughput logging perlu konfigurasi hati-hati.

## 5.2 Stack B: SLF4J + Log4j2

```text
Application Code
   -> SLF4J API
   -> Log4j2 SLF4J provider
   -> Log4j2 Core
   -> Appenders/Layouts
```

Typical dependencies untuk SLF4J 2.x:

```text
org.slf4j:slf4j-api
org.apache.logging.log4j:log4j-slf4j2-impl
org.apache.logging.log4j:log4j-api
org.apache.logging.log4j:log4j-core
```

Kelebihan:

- async logger sangat kuat,
- JSON Template Layout powerful,
- garbage-free logging features,
- plugin system kaya,
- routing/failover advanced.

Trade-off:

- konfigurasi lebih kompleks,
- dependency bridge harus sangat hati-hati,
- security posture harus disiplin karena sejarah Log4Shell membuat governance dependency penting.

## 5.3 Stack C: Log4j2 API + Log4j2 Core

```text
Application Code
   -> Log4j2 API
   -> Log4j2 Core
```

Ini cocok jika aplikasi memang memilih Log4j2 API langsung.

Tetapi untuk library umum, lebih baik gunakan SLF4J agar library tidak memaksa backend.

## 5.4 Stack D: JUL Only

```text
Application Code
   -> java.util.logging
   -> JUL Handler
```

Kelebihan:

- built-in JDK,
- tidak butuh dependency eksternal,
- dipakai beberapa komponen JDK/server lama.

Trade-off:

- konfigurasi enterprise modern kurang nyaman,
- JSON/structured logging lebih terbatas,
- integration ke modern stack sering butuh bridge.

## 5.5 Stack E: Mixed Framework With Bridges

Ini realita enterprise.

```text
Application code -> SLF4J
Some library     -> JUL
Some old library -> Commons Logging
Some old module  -> Log4j 1.x API

All routed to one backend: Logback or Log4j2
```

Contoh target:

```text
JUL              --jul-to-slf4j-->       SLF4J
Commons Logging  --jcl-over-slf4j-->      SLF4J
Log4j 1.x API    --log4j-over-slf4j-->    SLF4J
Application      --------------------->   SLF4J
                                            |
                                            v
                                      Logback backend
```

Atau:

```text
JUL              -> Log4j2 bridge
Commons Logging  -> Log4j2 bridge
SLF4J            -> Log4j2 provider
Application      -> SLF4J
                       |
                       v
                    Log4j2 Core
```

Prinsipnya: banyak API boleh masuk, tetapi backend akhir harus jelas.

---

## 6. Flow Detail: Dari `logger.info()` Sampai Output

Mari lihat alur praktis pada stack SLF4J + Logback.

```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);

public void submitOrder(String orderId) {
    log.info("Submitting order {}", orderId);
}
```

Runtime flow:

```text
1. LoggerFactory.getLogger(OrderService.class)
   -> meminta logger bernama com.example.OrderService

2. SLF4J provider aktif ditemukan
   -> LogbackServiceProvider

3. Logback LoggerContext mengembalikan Logger instance
   -> logger name: com.example.OrderService

4. log.info(...) dipanggil
   -> cek apakah INFO enabled untuk logger tersebut

5. Jika disabled
   -> return cepat, event tidak dibuat penuh

6. Jika enabled
   -> buat LoggingEvent
   -> resolve message template + arguments
   -> attach throwable jika ada
   -> attach MDC snapshot
   -> attach marker jika ada

7. Event dikirim ke appender berdasarkan hierarchy/additivity

8. Appender menjalankan filter

9. Encoder/layout mengubah event menjadi bytes/string

10. Output ditulis ke destination
```

Hal penting: level check terjadi sebelum expensive formatting penuh, tetapi argument expression tetap dievaluasi oleh Java sebelum method call.

Contoh buruk:

```java
log.debug("Payload: {}", objectMapper.writeValueAsString(payload));
```

Walaupun DEBUG disabled, `objectMapper.writeValueAsString(payload)` tetap dieksekusi sebelum masuk ke `debug(...)`.

Lebih aman:

```java
if (log.isDebugEnabled()) {
    log.debug("Payload: {}", objectMapper.writeValueAsString(payload));
}
```

Atau gunakan fluent/lazy API jika framework mendukung secara tepat.

---

## 7. Logger Hierarchy dan Additivity

Logger name membentuk tree.

Contoh:

```text
root
 └── com
     └── example
         └── payment
             └── PaymentGatewayClient
```

Jika kita konfigurasi:

```xml
<logger name="com.example.payment" level="DEBUG"/>
<root level="INFO"/>
```

Maka logger:

```text
com.example.payment.PaymentGatewayClient
```

akan mewarisi `DEBUG` dari `com.example.payment`, kecuali ada konfigurasi lebih spesifik.

## 7.1 Effective Level

Effective level adalah level yang benar-benar dipakai logger setelah inheritance.

Contoh:

```text
root = WARN
com.example = INFO
com.example.payment = DEBUG
com.example.payment.PaymentGatewayClient = not configured
```

Maka:

```text
PaymentGatewayClient effective level = DEBUG
```

## 7.2 Additivity

Additivity menentukan apakah event yang sudah diproses logger child akan diteruskan ke appender parent.

Default biasanya additive.

Contoh masalah duplicate logs:

```xml
<appender name="CONSOLE" ... />

<logger name="com.example.payment" level="DEBUG">
    <appender-ref ref="CONSOLE"/>
</logger>

<root level="INFO">
    <appender-ref ref="CONSOLE"/>
</root>
```

Jika additivity true, event dari `com.example.payment` bisa masuk ke CONSOLE dua kali:

```text
com.example.payment logger -> CONSOLE
then bubbles to root       -> CONSOLE again
```

Solusi:

```xml
<logger name="com.example.payment" level="DEBUG" additivity="false">
    <appender-ref ref="CONSOLE"/>
</logger>
```

Mental model:

```text
Duplicate log sering bukan karena kode dipanggil dua kali.
Duplicate log sering karena appender attached di child dan parent dengan additivity true.
```

---

## 8. Level Filtering: Dua Tempat yang Sering Tertukar

Filtering level bisa terjadi di:

1. logger,
2. appender/filter.

Contoh:

```xml
<logger name="com.example" level="DEBUG"/>
<appender name="CONSOLE">
    <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
        <level>INFO</level>
    </filter>
</appender>
```

Maka DEBUG event dibuat oleh logger tetapi ditolak appender.

Konsekuensi:

- overhead event creation tetap terjadi,
- output DEBUG tidak muncul,
- engineer bisa bingung karena logger level sudah DEBUG.

Rule:

> Logger level menentukan apakah event dibuat. Appender/filter menentukan apakah event dikirim ke destination tertentu.

Ini berguna untuk routing:

```text
ERROR -> sent to alert sink
INFO  -> sent to general log sink
DEBUG -> only local/dev file
```

Tetapi berbahaya jika konfigurasi tidak eksplisit.

---

## 9. Facade Selection: Library vs Application

## 9.1 Library Code

Jika membuat library reusable, gunakan facade, biasanya SLF4J.

Kenapa?

Library tidak boleh memaksa aplikasi memakai Logback atau Log4j2.

Library sebaiknya hanya declare:

```text
org.slf4j:slf4j-api
```

Jangan declare backend seperti:

```text
ch.qos.logback:logback-classic
org.apache.logging.log4j:log4j-core
```

kecuali library itu memang logging backend/plugin.

Bad library dependency:

```xml
<dependency>
  <groupId>ch.qos.logback</groupId>
  <artifactId>logback-classic</artifactId>
</dependency>
```

Jika library ini dipakai aplikasi yang ingin Log4j2, akan timbul conflict.

## 9.2 Application Code

Aplikasi harus memilih backend final.

Contoh:

```text
Spring Boot default -> Logback
High-throughput platform -> mungkin Log4j2
Legacy server -> mungkin JUL bridge
```

Aplikasi bertanggung jawab atas:

- backend dependency,
- config file,
- appenders,
- structured schema,
- correlation fields,
- retention/routing policy,
- environment profile,
- security redaction.

Rule:

```text
Library owns logging API usage.
Application owns logging implementation.
Platform owns collection/storage/query pipeline.
```

---

## 10. Java Built-in Logging: JUL dan System.Logger

## 10.1 `java.util.logging` / JUL

JUL adalah logging bawaan JDK sejak Java 1.4.

Contoh:

```java
private static final java.util.logging.Logger log =
        java.util.logging.Logger.getLogger(MyService.class.getName());

log.info("Started service");
```

JUL punya:

- Logger,
- Level,
- Handler,
- Formatter,
- Filter,
- LogManager.

JUL logger juga memakai dot-separated hierarchical namespace, biasanya package/class name.

JUL sering muncul dari:

- JDK internal/standard library,
- app server,
- old enterprise libraries,
- framework lama.

Masalahnya, jika aplikasi utama memakai SLF4J + Logback, JUL logs bisa keluar melalui pipeline berbeda kecuali dibridge.

## 10.2 `System.Logger`

Java 9 memperkenalkan platform logging API:

```java
private static final System.Logger log =
        System.getLogger(MyService.class.getName());

log.log(System.Logger.Level.INFO, "Started service");
```

`System.Logger` dirancang untuk platform classes dan dapat dirutekan oleh `LoggerFinder` ke framework logging underlying.

Untuk aplikasi enterprise biasa, SLF4J masih lebih umum karena ecosystem dan compatibility.

Tetapi penting tahu `System.Logger` karena:

- library modular Java 9+ bisa menggunakannya,
- JDK/platform logging bisa masuk ke pipeline lain,
- classloader/module behavior bisa berbeda.

---

## 11. Commons Logging / JCL

Apache Commons Logging dulu banyak dipakai oleh framework seperti Spring versi lama.

Masalah Commons Logging historis:

- discovery mechanism kompleks,
- classloader issue di container,
- unpredictable backend selection.

Di aplikasi modern, biasanya Commons Logging diarahkan ke SLF4J melalui bridge:

```text
jcl-over-slf4j
```

Spring modern memakai `spring-jcl`, bukan Commons Logging klasik secara langsung.

Prinsipnya tetap sama: jangan biarkan JCL memilih backend sendiri jika aplikasi ingin satu pipeline logging.

---

## 12. Log4j 1.x, reload4j, dan Legacy Risk

Log4j 1.x sudah lama end-of-life. Di sistem lama, masih mungkin ada dependency:

```text
log4j:log4j:1.2.x
```

Risiko:

- tidak maintained sebagai framework utama,
- appender lama bisa punya risk,
- konfigurasi lama tidak cocok dengan observability modern,
- conflict dengan bridge.

Alternatif migration:

1. bridge Log4j 1.x API ke SLF4J,
2. bridge Log4j 1.x API ke Log4j2,
3. replace dengan reload4j jika migrasi penuh belum bisa,
4. migrate source code ke SLF4J atau Log4j2 API.

Rule:

> Jangan membiarkan Log4j 1.x menjadi backend final di sistem modern kecuali ada constraint legacy yang sangat kuat dan dikontrol.

---

## 13. Classpath and Dependency Resolution

Logging Java sangat dipengaruhi classpath.

## 13.1 The One Backend Rule

Untuk satu application runtime, idealnya hanya ada satu backend final.

Contoh benar:

```text
slf4j-api
logback-classic
logback-core
```

Contoh benar:

```text
slf4j-api
log4j-slf4j2-impl
log4j-api
log4j-core
```

Contoh risk:

```text
slf4j-api
logback-classic
log4j-slf4j2-impl
log4j-core
```

Karena SLF4J menemukan lebih dari satu provider.

## 13.2 SLF4J 1.x vs 2.x Compatibility

SLF4J 1.x memakai binding lama.

SLF4J 2.x memakai service provider.

Masalah umum:

```text
slf4j-api 2.x + binding SLF4J 1.7 lama
```

atau:

```text
slf4j-api 1.7 + provider SLF4J 2.x
```

Gejala:

- provider tidak ditemukan,
- warning saat startup,
- fallback ke NOP logger,
- log tidak keluar.

Rule:

> Align major version SLF4J API dan provider/backend adapter.

## 13.3 Maven/Gradle Transitive Dependency

Logging backend sering masuk dari transitive dependency.

Maven:

```bash
mvn dependency:tree | grep -E "slf4j|logback|log4j|commons-logging|jul"
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -E "slf4j|logback|log4j|commons-logging"
```

Untuk diagnosis lebih rapi:

```bash
./gradlew dependencyInsight --dependency logback-classic --configuration runtimeClasspath
./gradlew dependencyInsight --dependency log4j-core --configuration runtimeClasspath
./gradlew dependencyInsight --dependency slf4j-api --configuration runtimeClasspath
```

## 13.4 Exclusion

Jika ada library membawa backend yang tidak diinginkan:

Maven:

```xml
<dependency>
  <groupId>com.vendor</groupId>
  <artifactId>vendor-client</artifactId>
  <version>1.0.0</version>
  <exclusions>
    <exclusion>
      <groupId>ch.qos.logback</groupId>
      <artifactId>logback-classic</artifactId>
    </exclusion>
  </exclusions>
</dependency>
```

Gradle:

```groovy
implementation("com.vendor:vendor-client:1.0.0") {
    exclude group: "ch.qos.logback", module: "logback-classic"
}
```

---

## 14. JPMS / Java Modules and Logging

Java 9 memperkenalkan module system.

Dalam modular application, ada beberapa concern:

- module declaration,
- service provider discovery,
- automatic modules,
- split packages,
- classloader/layer behavior,
- reflective access.

Contoh `module-info.java` untuk aplikasi yang memakai SLF4J:

```java
module com.example.app {
    requires org.slf4j;
}
```

Backend/provider biasanya tetap ada di runtime module path/classpath.

Masalah umum di modular runtime:

- provider tidak terdeteksi karena module path salah,
- automatic module name tidak sesuai ekspektasi,
- framework reflection issue,
- custom runtime image tidak memasukkan module/logging dependency.

Rule praktis:

> Untuk aplikasi enterprise Spring Boot/fat jar, classpath masih umum. Untuk custom JPMS runtime, logging provider discovery harus dites eksplisit di packaging final, bukan hanya unit test IDE.

---

## 15. Classloader Problems in App Servers and Containers

Enterprise Java lama sering berjalan di:

- Tomcat,
- Jetty,
- WildFly/JBoss,
- WebLogic,
- WebSphere/Open Liberty,
- OSGi container.

Masalah logging di environment ini sering terkait classloader.

## 15.1 Parent-first vs Child-first

Jika server punya logging framework sendiri, aplikasi juga membawa logging framework, class bisa diload dari tempat berbeda.

Gejala:

- `ClassCastException` antar logger class yang tampak sama,
- config aplikasi tidak dipakai,
- logs masuk ke server log bukan app log,
- duplicate logs,
- memory leak saat redeploy,
- old webapp classloader tertahan oleh static logger/appender/thread.

## 15.2 Static Logger Field

Pattern umum:

```java
private static final Logger log = LoggerFactory.getLogger(MyClass.class);
```

Ini aman pada kebanyakan aplikasi modern.

Tetapi di hot-redeploy container, static references + appender threads + classloader references bisa berkontribusi pada classloader leak jika backend tidak shutdown dengan benar.

## 15.3 Shutdown Hook dan Appender Thread

Async appenders, file watchers, socket appenders, dan reconfiguration watchers bisa membuat thread.

Jika aplikasi redeploy tapi logging context tidak stop, thread lama bisa tetap hidup.

Rule:

> Di container yang support redeploy, pastikan logging backend lifecycle ikut application lifecycle.

---

## 16. Spring Boot Logging Architecture

Spring Boot biasanya menyederhanakan logging, tetapi abstraction ini bisa menyembunyikan detail penting.

Default umum:

```text
spring-boot-starter-logging
   -> SLF4J
   -> Logback
   -> bridges for JUL/Log4j/JCL depending version/config
```

Jika ingin Log4j2:

```text
exclude spring-boot-starter-logging
add spring-boot-starter-log4j2
```

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

Spring Boot-specific config:

- `logging.level.*`,
- `logging.pattern.console`,
- `logging.file.name`,
- `logback-spring.xml`,
- `log4j2-spring.xml`,
- profile-specific config,
- actuator loggers endpoint.

Important distinction:

```text
logback.xml        -> loaded by Logback directly
logback-spring.xml -> understood by Spring Boot with Spring extensions
```

Jika memakai Spring features seperti `<springProfile>`, gunakan `logback-spring.xml`, bukan `logback.xml`.

---

## 17. Appender Architecture

Appender adalah output strategy.

Common appenders:

| Appender | Use Case | Risk |
|---|---|---|
| Console | container/stdout logging | blocking stdout, collector lag |
| File | VM/bare metal local logs | disk full, rotation wrong |
| RollingFile | long-running service | retention misconfig |
| Async | reduce caller latency | dropped logs, queue memory |
| Socket/TCP | central logging direct | network failure affects app |
| HTTP | push logs to collector | latency/backpressure |
| Syslog | infra/security logging | format limitations |
| DB/JDBC | audit-ish persistence | dangerous for app logs, DB coupling |
| Kafka | high-throughput pipeline | operational complexity |

Rule untuk cloud/container modern:

> Application logs should usually go to stdout/stderr, then collector/agent handles shipping.

Tetapi ada exceptions:

- regulated audit trail,
- offline batch job with local retention,
- specialized embedded appliance,
- emergency fallback file,
- app server central log policy.

## 17.1 Appender Failure Semantics

Pertanyaan penting untuk setiap appender:

1. Jika destination lambat, apakah aplikasi ikut lambat?
2. Jika destination mati, apakah request ikut gagal?
3. Jika queue penuh, apakah log drop atau caller block?
4. Jika disk penuh, apa yang terjadi?
5. Jika file rotation gagal, apakah app tetap jalan?
6. Apakah appender punya retry?
7. Apakah retry bisa menyebabkan memory growth?
8. Apakah appender thread daemon atau non-daemon?
9. Apakah shutdown flush dilakukan?
10. Apakah log event bisa hilang saat crash?

Top-tier engineer mendesain appender bukan hanya berdasarkan output, tetapi berdasarkan **failure semantics**.

---

## 18. Layout, Encoder, Formatter: Human vs Machine Output

## 18.1 Human-Oriented Pattern

Contoh pattern:

```text
%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{36} - %msg%n%ex
```

Kelebihan:

- mudah dibaca manusia,
- bagus untuk local development,
- ringkas.

Kekurangan:

- parsing fragile,
- multiline stack trace menyulitkan collector,
- structured query terbatas,
- field extraction tergantung regex.

## 18.2 Machine-Oriented JSON

Kelebihan:

- field query jelas,
- trace/log correlation mudah,
- SIEM/analytics lebih reliable,
- schema governance bisa diterapkan.

Kekurangan:

- lebih verbose,
- serialization cost,
- field cardinality harus dijaga,
- invalid JSON fatal untuk pipeline,
- readability lokal berkurang.

## 18.3 Hybrid Strategy

Rekomendasi praktis:

```text
Local development -> human pattern
Production        -> JSON structured logs
Test/CI           -> compact but deterministic format
```

Atau:

```text
Console stdout -> JSON
Developer profile -> pretty pattern
```

---

## 19. Structured Event Anatomy

Walaupun structured logging dibahas penuh di Part 9, Part 2 perlu menempatkannya dalam arsitektur.

Satu log event idealnya bisa dianggap seperti record:

```json
{
  "timestamp": "2026-06-18T10:15:30.123Z",
  "severity": "WARN",
  "service.name": "order-service",
  "service.version": "1.24.3",
  "deployment.environment": "prod",
  "logger.name": "com.example.order.OrderService",
  "thread.name": "http-nio-8080-exec-17",
  "message": "Payment authorization failed",
  "event.name": "payment.authorization.failed",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "correlation_id": "REQ-20260618-00001",
  "order_id": "ORD-123",
  "payment_provider": "gateway-a",
  "error.type": "java.net.SocketTimeoutException",
  "error.message": "Read timed out"
}
```

Arsitektur logging harus mendukung field-field ini tanpa developer menulis string manual terus-menerus.

---

## 20. MDC / ThreadContext Position in Architecture

MDC adalah context map yang ikut ditempel ke log event.

SLF4J/Logback menyebutnya MDC.

Log4j2 menyebutnya ThreadContext map/stack.

Contoh:

```java
MDC.put("correlation_id", correlationId);
MDC.put("tenant_id", tenantId);
try {
    service.handle(request);
} finally {
    MDC.clear();
}
```

Layout bisa mengambilnya:

```text
%X{correlation_id}
```

JSON encoder bisa memasukkannya sebagai field.

Mental model:

```text
MDC is not the log event itself.
MDC is contextual data captured into the log event at creation/output time.
```

Risk:

- MDC leak di thread pool,
- missing MDC di async boundary,
- excessive MDC cardinality,
- sensitive data masuk semua logs,
- MDC key naming inconsistent.

MDC akan dibahas mendalam di Part 10.

---

## 21. Synchronous vs Asynchronous Logging

## 21.1 Synchronous Logging

```text
Application thread
  -> create event
  -> format event
  -> write output
  -> continue business logic
```

Kelebihan:

- ordering lebih mudah,
- failure lebih visible,
- tidak ada queue drop,
- lebih sederhana.

Kekurangan:

- request latency bisa terkena IO,
- lock/contention bisa naik,
- stdout/file/network bottleneck bisa menghambat app.

## 21.2 Asynchronous Logging

```text
Application thread
  -> create event
  -> enqueue event
  -> continue business logic

Background logging thread
  -> dequeue
  -> format
  -> write output
```

Kelebihan:

- caller latency lebih rendah,
- smoothing burst,
- bisa meningkatkan throughput.

Kekurangan:

- queue bisa penuh,
- event bisa drop,
- event bisa hilang saat crash,
- ordering antar-thread lebih kompleks,
- MDC harus dicapture benar,
- mutable arguments bisa berubah sebelum diformat.

Rule:

> Async logging is a buffering strategy, not free performance.

Kita akan bahas detail di Part 6 dan Part 8.

---

## 22. Logging Configuration Loading

## 22.1 Logback

Common config names:

```text
logback-test.xml
logback.xml
logback-spring.xml
```

Spring Boot preference:

```text
logback-spring.xml
```

Karena bisa memakai Spring profile/property support.

## 22.2 Log4j2

Common config names:

```text
log4j2-test.xml
log4j2.xml
log4j2-spring.xml
log4j2.properties
log4j2.json
log4j2.yaml
```

Spring Boot preference jika butuh Spring lookup/profile integration:

```text
log4j2-spring.xml
```

## 22.3 Externalized Config

Production kadang memakai config eksternal:

```bash
-Dlogging.config=/etc/app/logback-prod.xml
-Dlog4j.configurationFile=/etc/app/log4j2-prod.xml
```

Risk:

- file tidak ada,
- permission salah,
- config lama tidak ikut deploy,
- config drift antar-node,
- container image tidak deterministic,
- secret accidentally included in config.

Rule:

> Logging config is production code. Version it, test it, and validate it.

---

## 23. Environment-Specific Logging Design

Logging tidak boleh sama mentahnya di semua environment.

## 23.1 Local

Goal:

- mudah dibaca,
- cepat debugging,
- stack trace terlihat,
- optional DEBUG package tertentu.

Format:

```text
human-readable pattern
```

## 23.2 Test/CI

Goal:

- deterministic,
- tidak terlalu noisy,
- failure visible,
- bisa capture logs untuk failed test.

Format:

```text
compact pattern or JSON if integration pipeline tests require it
```

## 23.3 Staging/UAT

Goal:

- mirip production,
- structured logs,
- correlation active,
- sampling policy production-like.

## 23.4 Production

Goal:

- machine-queryable,
- low noise,
- secure,
- cost-controlled,
- correlated with traces/metrics,
- stable schema.

Format:

```text
JSON structured logs to stdout/stderr
```

unless platform dictates otherwise.

---

## 24. Import Mistakes: Logger Class Confusion

Masalah sederhana tapi sering terjadi.

Correct SLF4J:

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
```

Wrong accidental JUL:

```java
import java.util.logging.Logger;
```

Wrong Log4j2 mixed into SLF4J standard:

```java
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;
```

Bukan berarti Log4j2 API salah. Yang salah adalah inconsistent API usage tanpa intentional design.

Rule:

> Dalam satu codebase application layer, standardize logger API imports.

Enforce dengan:

- Checkstyle,
- Error Prone,
- ArchUnit,
- IDE inspection,
- build lint,
- code review checklist.

ArchUnit example konseptual:

```java
noClasses()
    .should().dependOnClassesThat().resideInAnyPackage("java.util.logging..")
    .because("Application code should use SLF4J facade");
```

---

## 25. Dependency Recipes

## 25.1 Maven: SLF4J + Logback

```xml
<dependencies>
  <dependency>
    <groupId>org.slf4j</groupId>
    <artifactId>slf4j-api</artifactId>
    <version>${slf4j.version}</version>
  </dependency>

  <dependency>
    <groupId>ch.qos.logback</groupId>
    <artifactId>logback-classic</artifactId>
    <version>${logback.version}</version>
    <scope>runtime</scope>
  </dependency>
</dependencies>
```

In many apps, `logback-classic` is not runtime-only because tests/config may use it. The key point is: library should not force it; application may.

## 25.2 Gradle: SLF4J + Logback

```groovy
dependencies {
    implementation "org.slf4j:slf4j-api:${slf4jVersion}"
    runtimeOnly "ch.qos.logback:logback-classic:${logbackVersion}"
}
```

## 25.3 Maven: SLF4J + Log4j2

```xml
<dependencies>
  <dependency>
    <groupId>org.slf4j</groupId>
    <artifactId>slf4j-api</artifactId>
    <version>${slf4j.version}</version>
  </dependency>

  <dependency>
    <groupId>org.apache.logging.log4j</groupId>
    <artifactId>log4j-slf4j2-impl</artifactId>
    <version>${log4j2.version}</version>
    <scope>runtime</scope>
  </dependency>

  <dependency>
    <groupId>org.apache.logging.log4j</groupId>
    <artifactId>log4j-core</artifactId>
    <version>${log4j2.version}</version>
    <scope>runtime</scope>
  </dependency>
</dependencies>
```

## 25.4 Gradle: SLF4J + Log4j2

```groovy
dependencies {
    implementation "org.slf4j:slf4j-api:${slf4jVersion}"
    runtimeOnly "org.apache.logging.log4j:log4j-slf4j2-impl:${log4j2Version}"
    runtimeOnly "org.apache.logging.log4j:log4j-core:${log4j2Version}"
}
```

## 25.5 Library Dependency Rule

Library:

```groovy
dependencies {
    api "org.slf4j:slf4j-api:${slf4jVersion}"
    testRuntimeOnly "ch.qos.logback:logback-classic:${logbackVersion}"
}
```

Application:

```groovy
dependencies {
    implementation project(":my-library")
    runtimeOnly "ch.qos.logback:logback-classic:${logbackVersion}"
}
```

---

## 26. Minimal Logback Config Anatomy

```xml
<configuration>

    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} trace_id=%X{trace_id} - %msg%n%ex</pattern>
        </encoder>
    </appender>

    <logger name="com.example" level="INFO"/>

    <root level="WARN">
        <appender-ref ref="CONSOLE"/>
    </root>

</configuration>
```

Anatomy:

| Component | Meaning |
|---|---|
| `configuration` | root config |
| `appender` | output destination |
| `encoder` | event-to-bytes formatter |
| `pattern` | human-readable rendering |
| `logger` | package-specific level |
| `root` | fallback logger |
| `appender-ref` | attach output to logger |

Potential issue:

```text
com.example level INFO, root WARN
```

`com.example` logs INFO, but other packages only WARN.

---

## 27. Minimal Log4j2 Config Anatomy

```xml
<Configuration status="WARN">
  <Appenders>
    <Console name="Console" target="SYSTEM_OUT">
      <PatternLayout pattern="%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%t] %c{1.} trace_id=%X{trace_id} - %msg%n%throwable"/>
    </Console>
  </Appenders>

  <Loggers>
    <Logger name="com.example" level="info" additivity="true"/>
    <Root level="warn">
      <AppenderRef ref="Console"/>
    </Root>
  </Loggers>
</Configuration>
```

Anatomy:

| Component | Meaning |
|---|---|
| `Configuration` | root config |
| `status` | internal Log4j2 status logging level |
| `Appenders` | destinations |
| `Console` | stdout/stderr appender |
| `PatternLayout` | event rendering |
| `Loggers` | logger rules |
| `Root` | fallback logger |
| `AppenderRef` | attach appender |

---

## 28. Diagnosing Startup Logging Warnings

## 28.1 `No SLF4J providers were found`

Meaning:

```text
Application has slf4j-api but no runtime provider/backend adapter.
```

Fix:

- add Logback,
- or add Log4j2 SLF4J provider,
- or add desired provider.

## 28.2 Multiple SLF4J Providers

Meaning:

```text
More than one SLF4J provider found in runtime classpath.
```

Fix:

- inspect dependency tree,
- keep one provider,
- exclude unwanted backend.

## 28.3 `StaticLoggerBinder` Warning

Common with SLF4J 1.x.

Meaning:

```text
SLF4J 1.x API expected old binding but none found, or mismatch with 2.x provider.
```

Fix:

- align SLF4J major versions,
- use correct binding/provider.

## 28.4 Logback Config Error

Symptoms:

- fallback default config,
- config syntax error,
- appender not started,
- rolling policy error.

Enable internal status:

```xml
<configuration debug="true">
```

or add status listener:

```xml
<statusListener class="ch.qos.logback.core.status.OnConsoleStatusListener" />
```

## 28.5 Log4j2 Config Error

Use:

```xml
<Configuration status="DEBUG">
```

or JVM property:

```bash
-Dlog4j2.debug=true
```

---

## 29. Logging Architecture Failure Modes

## 29.1 Logs Do Not Appear

Possible causes:

1. code path not executed,
2. wrong logger API imported,
3. logger level disabled,
4. appender filter rejects,
5. no provider/backend,
6. config file not loaded,
7. appender not attached,
8. async queue dropping,
9. stdout not collected,
10. log pipeline delay/retention.

Diagnosis order:

```text
code path -> effective level -> provider -> config -> appender -> destination -> pipeline
```

## 29.2 Duplicate Logs

Possible causes:

1. appender attached to child and root,
2. additivity true,
3. same appender declared twice,
4. multiple logging backends,
5. bridge loop,
6. collector duplicates stdout and file,
7. sidecar + daemonset both collecting same source.

## 29.3 Wrong Format

Possible causes:

1. wrong config file loaded,
2. Spring using default config before app config,
3. local profile active,
4. backend differs from expected,
5. JSON encoder missing.

## 29.4 Missing MDC

Possible causes:

1. MDC not set,
2. MDC cleared too early,
3. async boundary lost context,
4. Reactor/CompletableFuture not propagating,
5. virtual thread context assumption wrong,
6. layout not outputting MDC field.

## 29.5 Logging Causes Latency

Possible causes:

1. synchronous file/stdout slow,
2. network appender blocking,
3. caller data enabled,
4. heavy JSON serialization,
5. huge stack traces,
6. DEBUG logging too verbose,
7. lock contention in appender,
8. collector backpressure.

---

## 30. Java 8 to Java 25 Considerations

## 30.1 Java 8

Characteristics:

- classpath dominant,
- SLF4J 1.7 common in legacy,
- Logback 1.2 common,
- Log4j2 available,
- no JPMS,
- no virtual threads,
- legacy app server issues common.

Focus:

- dependency hygiene,
- bridge cleanup,
- MDC with thread pools,
- old library routing,
- GC log syntax old style.

## 30.2 Java 11 / 17

Characteristics:

- Java 11/17 LTS popular,
- SLF4J 2 adoption increasing,
- Logback 1.4+ targets newer Java baselines depending version,
- stronger container awareness,
- JFR available and widely usable,
- JPMS exists but many apps still classpath.

Focus:

- align dependency versions,
- structured logging,
- OpenTelemetry agent,
- JFR integration,
- container stdout strategy.

## 30.3 Java 21

Characteristics:

- virtual threads become mainstream,
- structured concurrency preview/incubation history matters,
- ThreadLocal/MDC assumptions must be revalidated,
- high concurrency can amplify logging overhead.

Focus:

- MDC propagation strategy,
- avoid per-request huge ThreadLocal state,
- async logging sizing,
- profiling virtual-thread workloads.

## 30.4 Java 25

Characteristics:

- newer platform features around scoped context/structured concurrency are relevant,
- virtual-thread-first architecture more common,
- observability must avoid old platform-thread-only assumptions.

Focus:

- context propagation evolution,
- JFR/profiling modern workflows,
- OpenTelemetry context integration,
- logging overhead under massive concurrency.

---

## 31. Architecture Decision: Logback or Log4j2?

This is not a religious decision. It is a trade-off.

## 31.1 Choose Logback When

- Spring Boot default is enough,
- team wants simpler config,
- throughput is moderate,
- existing platform supports Logback well,
- operational familiarity is high,
- custom routing needs are limited.

## 31.2 Choose Log4j2 When

- high-throughput logging is important,
- async logger performance matters,
- advanced routing/failover needed,
- JSON Template Layout is desired,
- garbage-free logging matters,
- team can manage config complexity.

## 31.3 Do Not Choose Based Only On

- “framework X is faster” without workload,
- “Spring default means always best”,
- “we heard Log4j is insecure” without understanding current dependency governance,
- “JSON logs solve everything”,
- “async means no overhead”.

Decision framework:

```text
1. What is the required log volume?
2. Is log loss acceptable during crash/backpressure?
3. Is ordering important?
4. Is structured JSON mandatory?
5. What does platform logging collector expect?
6. What is team operational maturity?
7. What is dependency/security governance capacity?
8. Is app mostly request/response, batch, messaging, or high-frequency trading-like?
```

---

## 32. Recommended Baseline Architecture for Modern Java Service

For most enterprise Java services:

```text
Application code
  -> SLF4J API
  -> chosen backend: Logback or Log4j2
  -> JSON structured console appender in production
  -> human-readable console in local
  -> MDC/context fields: trace_id, span_id, correlation_id, tenant_id
  -> logs shipped by platform collector
  -> centralized query/alert system
```

Baseline rules:

1. Application code imports only SLF4J logger API.
2. Application runtime has exactly one SLF4J provider.
3. Legacy APIs are bridged in one direction only.
4. Production logs are structured JSON.
5. Local logs are human-readable unless debugging pipeline.
6. Logger level is package-based and externally configurable.
7. Appender failure behavior is documented.
8. Sensitive data redaction exists before production.
9. MDC lifecycle is enforced at request/message/job boundary.
10. Dependency tree is checked in CI.

---

## 33. Reference Architecture Diagram

```text
                         +-----------------------------+
                         |        Java Application      |
                         |-----------------------------|
                         | business code               |
                         | libraries                   |
                         | framework internals         |
                         +--------------+--------------+
                                        |
        +-------------------------------+-------------------------------+
        |                               |                               |
        v                               v                               v
+---------------+              +----------------+              +----------------+
| SLF4J API     |              | JUL            |              | Commons/Log4j1 |
| app standard  |              | JDK/legacy     |              | old libraries  |
+-------+-------+              +-------+--------+              +--------+-------+
        |                              |                                |
        |                              v                                v
        |                    +------------------+              +------------------+
        |                    | JUL bridge       |              | legacy bridge    |
        |                    | -> SLF4J         |              | -> SLF4J         |
        |                    +---------+--------+              +---------+--------+
        |                              |                                 |
        +------------------------------+---------------------------------+
                                       |
                                       v
                              +------------------+
                              | SLF4J Provider   |
                              | Logback/Log4j2   |
                              +---------+--------+
                                        |
                                        v
                              +------------------+
                              | Backend Core     |
                              | config + levels  |
                              +---------+--------+
                                        |
                     +------------------+------------------+
                     |                                     |
                     v                                     v
              +--------------+                      +--------------+
              | Appenders    |                      | Filters      |
              | console/file |                      | routing/drop |
              +------+-------+                      +------+-------+
                     |                                     |
                     +------------------+------------------+
                                        |
                                        v
                              +------------------+
                              | Encoder/Layout   |
                              | JSON/Text        |
                              +---------+--------+
                                        |
                                        v
                              +------------------+
                              | stdout/file/etc. |
                              +---------+--------+
                                        |
                                        v
                              +------------------+
                              | collector/index  |
                              +------------------+
```

---

## 34. Practical Lab 1: Verify Active Logging Backend

Create class:

```java
package com.example.logging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LoggingProbe {
    private static final Logger log = LoggerFactory.getLogger(LoggingProbe.class);

    public static void main(String[] args) {
        log.trace("trace enabled");
        log.debug("debug enabled");
        log.info("info enabled");
        log.warn("warn enabled");
        log.error("error enabled");

        System.out.println("Logger implementation: " + log.getClass().getName());
        System.out.println("ILoggerFactory: " + LoggerFactory.getILoggerFactory().getClass().getName());
    }
}
```

Expected examples:

For Logback:

```text
Logger implementation: ch.qos.logback.classic.Logger
ILoggerFactory: ch.qos.logback.classic.LoggerContext
```

For Log4j2 provider:

```text
Logger implementation: org.apache.logging.slf4j.Log4jLogger
ILoggerFactory: org.apache.logging.slf4j.Log4jLoggerFactory
```

Use this to confirm actual runtime, not assumption.

---

## 35. Practical Lab 2: Detect Duplicate Providers

Maven:

```bash
mvn -q dependency:tree \
  -Dincludes=org.slf4j,ch.qos.logback,org.apache.logging.log4j,commons-logging,log4j
```

Gradle:

```bash
./gradlew dependencyInsight --dependency slf4j --configuration runtimeClasspath
./gradlew dependencyInsight --dependency logback --configuration runtimeClasspath
./gradlew dependencyInsight --dependency log4j --configuration runtimeClasspath
```

Checklist:

```text
[ ] one slf4j-api version family
[ ] one SLF4J provider only
[ ] no unwanted logback-classic if using Log4j2
[ ] no unwanted log4j-slf4j2-impl if using Logback
[ ] no bridge cycles
[ ] no Log4j 1.x backend final
[ ] legacy APIs intentionally bridged
```

---

## 36. Practical Lab 3: Duplicate Log by Additivity

Create config intentionally wrong:

```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%level %logger - %msg%n</pattern>
        </encoder>
    </appender>

    <logger name="com.example" level="INFO">
        <appender-ref ref="CONSOLE"/>
    </logger>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

Run:

```java
log.info("hello");
```

You may see:

```text
INFO com.example.logging.LoggingProbe - hello
INFO com.example.logging.LoggingProbe - hello
```

Fix:

```xml
<logger name="com.example" level="INFO" additivity="false">
    <appender-ref ref="CONSOLE"/>
</logger>
```

Learning:

```text
Duplicate log can be routing duplication, not business duplication.
```

---

## 37. Practical Lab 4: Appender Filter vs Logger Level

Config:

```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
            <level>INFO</level>
        </filter>
        <encoder>
            <pattern>%level %logger - %msg%n</pattern>
        </encoder>
    </appender>

    <logger name="com.example" level="DEBUG"/>

    <root level="WARN">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

Code:

```java
log.debug("debug message");
log.info("info message");
```

Expected:

```text
INFO com.example.logging.LoggingProbe - info message
```

Learning:

```text
Logger level allowed DEBUG event creation, but appender filter rejected DEBUG output.
```

---

## 38. Practical Lab 5: Wrong Import

Bad:

```java
import java.util.logging.Logger;

public class WrongLogger {
    private static final Logger log = Logger.getLogger(WrongLogger.class.getName());
}
```

Good if project standard is SLF4J:

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class RightLogger {
    private static final Logger log = LoggerFactory.getLogger(RightLogger.class);
}
```

Learning:

```text
Codebase consistency starts from import discipline.
```

---

## 39. Production Readiness Checklist

Use this checklist before accepting logging architecture as production-ready.

## 39.1 Dependency

```text
[ ] exactly one backend/provider selected
[ ] transitive logging dependencies reviewed
[ ] no bridge cycle
[ ] SLF4J API/provider versions aligned
[ ] legacy Log4j 1.x handled intentionally
[ ] dependency vulnerability scanning active
```

## 39.2 Configuration

```text
[ ] config file name/location verified
[ ] local/test/prod config separated intentionally
[ ] default/fallback config acceptable
[ ] internal logging diagnostics available
[ ] root logger level not accidentally too verbose
[ ] noisy packages controlled
```

## 39.3 Output

```text
[ ] production output is structured or intentionally text
[ ] timestamp format includes timezone/offset
[ ] exception rendering works
[ ] multiline behavior understood by collector
[ ] stdout/stderr collection verified
[ ] rolling/retention configured if file logging used
```

## 39.4 Context

```text
[ ] trace_id/span_id included when tracing active
[ ] correlation_id included
[ ] request/message/job boundary sets context
[ ] context cleared after processing
[ ] async boundaries handled
[ ] sensitive context values blocked
```

## 39.5 Failure Semantics

```text
[ ] appender behavior under slow destination known
[ ] async queue size configured
[ ] drop/block policy known
[ ] shutdown flush behavior known
[ ] disk full behavior known if file logging
[ ] collector outage behavior known
```

## 39.6 Operations

```text
[ ] log level can be changed operationally if needed
[ ] log schema documented
[ ] query examples exist
[ ] alert-worthy logs separated from diagnostic logs
[ ] log cost/cardinality reviewed
[ ] incident runbook references logging pipeline
```

---

## 40. Anti-Patterns

## 40.1 Library Includes Backend

Bad:

```text
my-shared-library depends on logback-classic
```

Why bad:

- forces backend,
- causes provider conflict,
- breaks host application choice.

Better:

```text
my-shared-library depends on slf4j-api only
```

## 40.2 Multiple Bridges Without Direction

Bad:

```text
jul-to-slf4j + slf4j-jdk14
log4j-to-slf4j + log4j-slf4j2-impl
```

Better:

```text
choose one final backend and route all legacy APIs toward it
```

## 40.3 Root DEBUG in Production

Bad:

```xml
<root level="DEBUG">
```

Impact:

- huge cost,
- noisy logs,
- sensitive data risk,
- storage explosion,
- latency amplification.

Better:

```text
root WARN/INFO, specific package DEBUG temporarily when investigating
```

## 40.4 Direct Network Appender Without Backpressure Plan

Bad:

```text
application directly sends logs over HTTP synchronously to remote collector
```

Impact:

- collector outage impacts app,
- request latency increases,
- cascading failure risk.

Better:

```text
stdout -> node collector/sidecar/agent -> backend
```

or async appender with explicit drop/block policy.

## 40.5 Text Logs Pretending To Be Structured

Bad:

```text
INFO user=abc order=123 result=ok
```

This is key-value-ish but not truly governed.

Problems:

- escaping unclear,
- parsing fragile,
- naming inconsistent,
- nested data impossible,
- whitespace breaks parsing.

Better:

```json
{"level":"INFO","event.name":"order.submitted","user_id":"abc","order_id":"123","result":"ok"}
```

## 40.6 Logging Everything at ERROR

Bad:

```java
log.error("User entered invalid postal code");
```

If it is expected validation failure, ERROR is wrong.

Impact:

- alert fatigue,
- false incident,
- real errors hidden.

Better:

- maybe INFO for business rejection,
- DEBUG for validation detail,
- WARN only if abnormal pattern/risk,
- ERROR only if system operation failed unexpectedly.

---

## 41. Troubleshooting Decision Tree

When logging behaves unexpectedly:

```text
1. Is the code path executed?
   |
   +-- no -> business/control-flow issue
   +-- yes
        |
2. Is the correct Logger API imported?
   |
   +-- no -> standardize import/bridge
   +-- yes
        |
3. Is the level enabled for effective logger?
   |
   +-- no -> adjust logger config
   +-- yes
        |
4. Is SLF4J provider/backend present and correct?
   |
   +-- no -> fix dependency
   +-- yes
        |
5. Is config file loaded?
   |
   +-- no -> fix config naming/path/profile
   +-- yes
        |
6. Is appender attached and filter allowing event?
   |
   +-- no -> fix appender/ref/filter/additivity
   +-- yes
        |
7. Is output destination receiving event?
   |
   +-- no -> stdout/file/network/permission issue
   +-- yes
        |
8. Is collector/index/query pipeline working?
   |
   +-- no -> platform logging issue
   +-- yes -> query/time window/schema issue
```

---

## 42. Top 1% Engineer Perspective

A strong engineer sees logging architecture as part of system design.

They ask:

1. What runtime events do we need to reconstruct a failure timeline?
2. What context is attached automatically?
3. What is the cost of producing each log event?
4. What happens when the logging destination fails?
5. Can we route security/audit/diagnostic events differently?
6. Can we query by tenant, trace, case, job, dependency, error type?
7. Are log fields governed or ad hoc?
8. Are libraries allowed to leak backend dependencies?
9. Does the architecture work under virtual threads and async flows?
10. Can an on-call engineer diagnose a production issue in 10 minutes using available evidence?

Logging architecture is not “which XML file do we use”.

It is:

```text
runtime event generation + context capture + routing + encoding + shipping + querying + operational safety
```

---

## 43. Summary

Part 2 membangun pemahaman bahwa logging Java terdiri dari banyak layer:

```text
API/facade -> provider/binding/bridge -> backend -> logger hierarchy -> appender -> filter -> encoder/layout -> destination -> pipeline
```

Key takeaways:

1. SLF4J adalah facade; Logback/Log4j2 adalah backend.
2. Library sebaiknya memakai facade dan tidak membawa backend final.
3. Aplikasi harus memilih satu backend final.
4. Bridge harus satu arah, bukan siklus.
5. Logger hierarchy dan additivity menjelaskan banyak kasus duplicate/missing logs.
6. Logger level dan appender filter adalah dua hal berbeda.
7. Encoder/layout menentukan apakah log human-readable atau machine-queryable.
8. Async logging mengubah failure semantics, bukan menghapus cost.
9. Java 8–25 membawa perbedaan classpath/module, ThreadLocal/MDC, virtual threads, dan provider compatibility.
10. Logging architecture harus diuji seperti bagian production infrastructure.

---

## 44. What Comes Next

Part berikutnya:

# Part 3 — Log Semantics: What Should Be Logged and Why

Kita akan membahas bukan lagi “bagaimana event bergerak”, tetapi “event apa yang layak dibuat”.

Fokus Part 3:

- log sebagai semantic event,
- level discipline,
- business vs technical log,
- audit vs diagnostic log,
- expected vs unexpected failure,
- state transition logging,
- dependency logging,
- idempotency logging,
- anti-pattern message design,
- taxonomy logging event untuk enterprise Java system.

---

## References

- SLF4J Manual — https://www.slf4j.org/manual.html
- SLF4J FAQ — https://www.slf4j.org/faq.html
- Logback Manual: Configuration — https://logback.qos.ch/manual/configuration.html
- Logback Manual: Appenders — https://logback.qos.ch/manual/appenders.html
- Logback Manual: Layouts — https://logback.qos.ch/manual/layouts.html
- Logback Manual: Encoders — https://logback.qos.ch/manual/encoders.html
- Logback Manual: Filters — https://logback.qos.ch/manual/filters.html
- Apache Log4j 2 Manual: Configuration — https://logging.apache.org/log4j/2.x/manual/configuration.html
- Apache Log4j 2 Manual: Appenders — https://logging.apache.org/log4j/2.x/manual/appenders.html
- Apache Log4j 2 Manual: Layouts — https://logging.apache.org/log4j/2.x/manual/layouts.html
- Java SE API: `java.util.logging.Logger` — https://docs.oracle.com/javase/8/docs/api/java/util/logging/Logger.html
- Java SE API: `System.Logger` — https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/System.Logger.html


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 1 — Mental Model: Runtime Evidence, Not Just Logging](./01-runtime-evidence-not-just-logging.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 3 — Log Semantics: What Should Be Logged and Why](./03-log-semantics-what-should-be-logged-and-why.md)
