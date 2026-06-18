# Part 7 — Log4j2 Deep Dive I: Architecture, Configuration, Appenders, Layouts

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Target: Java 8 sampai Java 25  
Posisi: setelah memahami SLF4J dan Logback, kita masuk ke Log4j2 sebagai logging backend yang sangat kuat untuk production, high-throughput, structured logging, routing, dan konfigurasi yang eksplisit.

---

## 0. Tujuan Bagian Ini

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan arsitektur Log4j2 dari API sampai Core.
2. Membedakan `log4j-api`, `log4j-core`, `log4j-slf4j-impl`, `log4j-slf4j2-impl`, `log4j-to-slf4j`, dan bridge lain.
3. Mendesain konfigurasi Log4j2 yang production-grade.
4. Memahami logger hierarchy, additivity, level inheritance, appender reference, filter, dan layout.
5. Memilih appender dan layout sesuai runtime: local, VM, container, Kubernetes, batch, security, audit, dan high-throughput service.
6. Menghindari dependency conflict, infinite routing loop, duplicate logs, missing logs, broken JSON, dan konfigurasi berbahaya.
7. Membaca Log4j2 sebagai event pipeline, bukan sekadar file XML.

Bagian ini belum membahas async logger secara mendalam. Async, garbage-free, routing advanced, failover, dan security hardening akan dibahas di Part 8.

---

## 1. Mental Model: Log4j2 Sebagai Runtime Event Router

Log4j2 bukan hanya “library untuk menulis log”. Secara arsitektural, Log4j2 adalah **runtime event router**.

Alurnya:

```text
Application Code
   |
   | logger.info(...)
   v
Logging API / Facade
   |
   v
Logger Resolution
   |
   v
LogEvent Creation
   |
   v
Filter Decision
   |
   v
Appender Routing
   |
   v
Layout Formatting
   |
   v
Destination
   |-- stdout
   |-- stderr
   |-- file
   |-- rolling file
   |-- socket
   |-- HTTP
   |-- Kafka/JMS/custom
   |-- collector/agent via stdout
```

Top 1% engineer tidak melihat konfigurasi logging sebagai “boilerplate”. Mereka melihatnya sebagai **pipeline evidence**:

- event apa yang dibuat,
- event mana yang dibuang,
- event mana yang dirouting,
- event mana yang diformat,
- event mana yang bisa hilang,
- event mana yang bisa menahan request thread,
- event mana yang bisa membocorkan data,
- event mana yang bisa dipakai saat incident.

Log4j2 kuat karena pipeline-nya sangat eksplisit dan extensible.

---

## 2. Posisi Log4j2 Dalam Ekosistem Logging Java

Di Java modern, application code biasanya memakai salah satu dari dua pendekatan:

### 2.1 Aplikasi Menulis ke SLF4J, Backend Log4j2

Ini paling umum untuk aplikasi enterprise yang ingin framework-agnostic.

```text
Application Code
   uses org.slf4j.Logger
        |
        v
SLF4J API
        |
        v
Log4j2 SLF4J Provider/Binding
        |
        v
Log4j2 Core
        |
        v
Appender/Layout
```

Keuntungan:

- application code tidak tergantung Log4j2 API,
- backend bisa diganti,
- library internal lebih netral,
- cocok untuk Spring, Jakarta, batch, dan shared library.

### 2.2 Aplikasi Menulis Langsung ke Log4j2 API

```text
Application Code
   uses org.apache.logging.log4j.Logger
        |
        v
Log4j2 API
        |
        v
Log4j2 Core
```

Keuntungan:

- akses fitur Log4j2 lebih langsung,
- message types, marker, ThreadContext, flow tracing, dan fitur advanced lebih natural,
- cocok untuk aplikasi yang memang memilih Log4j2 sebagai platform logging utama.

Kelemahan:

- code lebih terikat ke Log4j2,
- library yang dipakai banyak aplikasi menjadi kurang netral,
- migrasi backend lebih sulit.

### 2.3 Rule Praktis

Untuk sebagian besar enterprise Java system:

```text
Application/service code: SLF4J
Logging backend: Log4j2 atau Logback
Reusable library: SLF4J only, no backend dependency
Infrastructure/platform library: boleh expose extension jika memang standard organisasi
```

---

## 3. Modul Penting Log4j2

Log4j2 terdiri dari beberapa artefak. Kesalahan dependency di sini adalah sumber banyak masalah produksi.

### 3.1 `log4j-api`

Ini adalah API Log4j2.

Dipakai jika code memanggil:

```java
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
```

Contoh:

```java
private static final Logger log = LogManager.getLogger(OrderService.class);
```

`log4j-api` sendiri tidak cukup untuk output penuh. Butuh implementation/core.

### 3.2 `log4j-core`

Ini adalah implementation/backend Log4j2:

- membaca konfigurasi,
- membuat logger context,
- menjalankan appender,
- menerapkan layout,
- menjalankan filter,
- plugin system,
- async support.

Tanpa `log4j-core`, Log4j2 API tidak memiliki backend normal untuk output.

### 3.3 `log4j-slf4j-impl`

Adapter/provider agar code yang memakai **SLF4J 1.x** bisa diarahkan ke Log4j2.

Dipakai untuk stack lama:

```text
slf4j-api 1.7.x -> log4j-slf4j-impl -> log4j-core
```

### 3.4 `log4j-slf4j2-impl`

Provider agar code yang memakai **SLF4J 2.x** bisa diarahkan ke Log4j2.

Dipakai untuk stack modern:

```text
slf4j-api 2.x -> log4j-slf4j2-impl -> log4j-core
```

### 3.5 `log4j-to-slf4j`

Ini kebalikannya: code yang memakai Log4j2 API diarahkan ke SLF4J.

```text
log4j-api -> log4j-to-slf4j -> SLF4J backend
```

Ini biasa dipakai oleh Spring Boot default logging stack yang backend-nya Logback, tetapi ingin menangkap library yang menulis ke Log4j2 API.

### 3.6 Bahaya Kombinasi Salah

Jangan memasang ini bersamaan dalam satu aplikasi:

```text
log4j-slf4j2-impl + log4j-to-slf4j
```

Karena bisa membentuk loop:

```text
SLF4J -> Log4j2 -> SLF4J -> Log4j2 -> ...
```

Atau minimal menyebabkan conflict dan perilaku aneh.

### 3.7 Bridge Lain

Umumnya kamu juga akan bertemu:

| Library legacy | Tujuan bridge |
|---|---|
| `jul-to-slf4j` | JUL ke SLF4J |
| `log4j-jul` | JUL ke Log4j2 |
| `jcl-over-slf4j` | Commons Logging ke SLF4J |
| `log4j-1.2-api` | compatibility Log4j 1.x API ke Log4j2 |

Rule penting:

> Dalam satu aplikasi, pilih satu “logging sink utama”. Semua API lain harus diarahkan ke sink itu. Jangan membuat graph logging yang cyclic.

---

## 4. Dependency Recipes

### 4.1 Maven — Application Code Pakai SLF4J 2.x, Backend Log4j2

```xml
<dependencies>
    <dependency>
        <groupId>org.slf4j</groupId>
        <artifactId>slf4j-api</artifactId>
        <version>2.0.17</version>
    </dependency>

    <dependency>
        <groupId>org.apache.logging.log4j</groupId>
        <artifactId>log4j-slf4j2-impl</artifactId>
        <version>2.25.1</version>
    </dependency>

    <dependency>
        <groupId>org.apache.logging.log4j</groupId>
        <artifactId>log4j-core</artifactId>
        <version>2.25.1</version>
    </dependency>
</dependencies>
```

Catatan:

- versi contoh harus diselaraskan dengan BOM/platform project,
- jangan campur dengan `logback-classic`,
- jangan campur dengan `log4j-to-slf4j`.

### 4.2 Maven — Code Langsung Pakai Log4j2 API

```xml
<dependencies>
    <dependency>
        <groupId>org.apache.logging.log4j</groupId>
        <artifactId>log4j-api</artifactId>
        <version>2.25.1</version>
    </dependency>

    <dependency>
        <groupId>org.apache.logging.log4j</groupId>
        <artifactId>log4j-core</artifactId>
        <version>2.25.1</version>
    </dependency>
</dependencies>
```

### 4.3 Gradle — SLF4J 2.x ke Log4j2

```groovy
dependencies {
    implementation 'org.slf4j:slf4j-api:2.0.17'
    runtimeOnly 'org.apache.logging.log4j:log4j-slf4j2-impl:2.25.1'
    runtimeOnly 'org.apache.logging.log4j:log4j-core:2.25.1'
}
```

### 4.4 Spring Boot Dengan Log4j2

Spring Boot default memakai Logback jika memakai `spring-boot-starter-logging`. Untuk memakai Log4j2, biasanya gunakan starter Log4j2 dan exclude default logging.

Maven pattern:

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

Dengan Boot, jangan asal tambahkan Log4j2 tanpa mengerti dependency graph. Pastikan hanya ada satu backend aktif.

---

## 5. Configuration Discovery

Log4j2 mencari konfigurasi dari beberapa nama file standar, misalnya:

```text
log4j2-test.properties
log4j2-test.yaml
log4j2-test.yml
log4j2-test.json
log4j2-test.xml
log4j2.properties
log4j2.yaml
log4j2.yml
log4j2.json
log4j2.xml
```

Biasanya:

- `log4j2-test.*` untuk test classpath,
- `log4j2.*` untuk runtime normal.

Kamu juga bisa menentukan config eksplisit:

```bash
-Dlog4j.configurationFile=/opt/app/config/log4j2.xml
```

Untuk production, config eksplisit sering lebih aman karena:

- tidak tergantung urutan classpath,
- mudah dibedakan per environment,
- mudah diaudit,
- mudah diganti tanpa rebuild image jika config dimount.

---

## 6. Format Konfigurasi: XML, YAML, JSON, Properties

Log4j2 mendukung beberapa format konfigurasi.

### 6.1 XML

Paling umum dan paling ekspresif.

Kelebihan:

- dokumentasi banyak,
- struktur jelas,
- plugin nested mudah,
- cocok untuk konfigurasi kompleks.

Kekurangan:

- verbose,
- raw XML escaping kadang mengganggu.

### 6.2 Properties

Ringkas untuk konfigurasi sederhana.

Kelebihan:

- mudah override,
- cocok untuk baseline kecil.

Kekurangan:

- struktur kompleks menjadi sulit dibaca,
- routing/filter/layout advanced jadi kurang nyaman.

### 6.3 YAML/JSON

Kelebihan:

- natural untuk tim yang terbiasa infra-as-code,
- struktur nested lebih ringan dari XML.

Kekurangan:

- butuh dependencies tambahan untuk parsing tertentu,
- indentation error bisa fatal,
- tidak selalu seumum XML.

### 6.4 Rule Praktis

```text
Simple service: properties atau XML
Complex enterprise service: XML
Kubernetes platform config: XML atau YAML, tergantung standar tim
Library/test: minimal test config
```

---

## 7. Konfigurasi Minimal Log4j2 XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN">
    <Appenders>
        <Console name="Console" target="SYSTEM_OUT">
            <PatternLayout pattern="%d{ISO8601} %-5p [%t] %c{1.} - %m%n%throwable"/>
        </Console>
    </Appenders>

    <Loggers>
        <Root level="INFO">
            <AppenderRef ref="Console"/>
        </Root>
    </Loggers>
</Configuration>
```

Penjelasan:

| Elemen | Fungsi |
|---|---|
| `Configuration` | root config Log4j2 |
| `status` | level internal status logger Log4j2 |
| `Appenders` | daftar destination output |
| `Console` | appender ke stdout/stderr |
| `PatternLayout` | format text log |
| `Loggers` | konfigurasi logger hierarchy |
| `Root` | fallback logger paling atas |
| `AppenderRef` | menghubungkan logger ke appender |

---

## 8. Status Logger: Debugging Log4j2 Itu Sendiri

`status="WARN"` mengatur internal logging Log4j2.

Untuk troubleshooting config:

```xml
<Configuration status="DEBUG">
```

Atau:

```bash
-Dlog4j2.debug=true
```

Gunakan saat:

- config tidak terbaca,
- appender tidak jalan,
- plugin tidak ditemukan,
- rolling policy tidak aktif,
- JSON layout tidak muncul,
- duplicate config dicurigai.

Jangan biarkan `DEBUG` internal status logger permanen di production, karena bisa noisy dan membocorkan detail config.

---

## 9. Logger Hierarchy

Logger Log4j2 mengikuti nama package/class.

Contoh:

```text
com.acme.payment.PaymentService
com.acme.payment.gateway.StripeClient
com.acme.caseflow.CaseStateMachine
```

Hierarchy:

```text
Root
 └── com
      └── acme
           ├── payment
           │    └── gateway
           └── caseflow
```

Jika logger `com.acme.payment.gateway.StripeClient` tidak punya level eksplisit, Log4j2 mencari level parent:

```text
com.acme.payment.gateway.StripeClient
-> com.acme.payment.gateway
-> com.acme.payment
-> com.acme
-> com
-> Root
```

### 9.1 Effective Level

Contoh:

```xml
<Loggers>
    <Logger name="com.acme.payment" level="DEBUG"/>
    <Root level="INFO">
        <AppenderRef ref="Console"/>
    </Root>
</Loggers>
```

Maka:

```text
com.acme.payment.PaymentService      DEBUG
com.acme.payment.gateway.StripeClient DEBUG
com.acme.caseflow.CaseService         INFO
```

### 9.2 Kenapa Ini Penting

Saat incident, kamu sering perlu menaikkan level hanya untuk package tertentu:

```xml
<Logger name="com.acme.payment.gateway" level="DEBUG"/>
```

Bukan menaikkan root ke DEBUG.

Root DEBUG di production bisa:

- membuat log meledak,
- menambah latency,
- menambah cost ingestion,
- memenuhi disk,
- menyembunyikan signal penting dalam noise,
- membocorkan data dari library.

---

## 10. Additivity

Default-nya, event dari child logger akan diteruskan ke parent appender.

Contoh:

```xml
<Logger name="com.acme.audit" level="INFO">
    <AppenderRef ref="AuditFile"/>
</Logger>

<Root level="INFO">
    <AppenderRef ref="Console"/>
</Root>
```

Event dari `com.acme.audit` bisa masuk ke:

```text
AuditFile + Console
```

Karena additivity default aktif.

Jika ingin hanya audit file:

```xml
<Logger name="com.acme.audit" level="INFO" additivity="false">
    <AppenderRef ref="AuditFile"/>
</Logger>
```

### 10.1 Failure Mode: Duplicate Logs

Duplicate log sering terjadi karena:

```text
Child logger punya appender
+ additivity true
+ parent/root punya appender sama/serupa
```

Diagnosis:

1. Cari logger spesifik yang punya appender.
2. Cek `additivity`.
3. Cek root appender.
4. Cek apakah dependency backend ganda.
5. Aktifkan status logger sementara.

---

## 11. Log Levels Dalam Log4j2

Level umum:

```text
OFF
FATAL
ERROR
WARN
INFO
DEBUG
TRACE
ALL
```

Urutan severity:

```text
OFF > FATAL > ERROR > WARN > INFO > DEBUG > TRACE > ALL
```

Namun dalam desain modern, jangan terlalu bergantung pada `FATAL`. Banyak aplikasi Java memakai `ERROR` sebagai severity tertinggi operasional.

Rekomendasi:

| Level | Gunakan untuk |
|---|---|
| `TRACE` | detail algoritmik sangat granular, local/lab only |
| `DEBUG` | diagnostic event yang berguna saat investigation |
| `INFO` | lifecycle, state transition penting, business/operational milestone |
| `WARN` | abnormal tapi masih bisa ditangani, degraded path, retry exhausted sebagian |
| `ERROR` | failure yang butuh perhatian atau menyebabkan operasi gagal |
| `FATAL` | proses tidak bisa lanjut, jika standar organisasi memakainya |

Log4j2 memungkinkan custom level, tetapi untuk enterprise application biasa, hindari kecuali ada governance kuat. Custom level memperumit ingestion, alerting, dashboard, dan training tim.

---

## 12. Appender Mental Model

Appender adalah destination writer.

Apache Log4j2 mendefinisikan appender sebagai komponen yang bertanggung jawab mengirim log event ke destination. Appender biasanya memakai filter untuk memutuskan event mana yang diterima dan layout untuk memformat event sebelum dikirim.

Model:

```text
LogEvent
   |
   v
Appender Filter
   |
   v
Layout
   |
   v
Output Manager
   |
   v
Destination
```

### 12.1 Appender Umum

| Appender | Kegunaan |
|---|---|
| ConsoleAppender | stdout/stderr, container-friendly |
| FileAppender | file tunggal, jarang cocok untuk production lama tanpa rolling |
| RollingFileAppender | file dengan rotation/retention |
| RandomAccessFileAppender | file IO performa lebih baik pada skenario tertentu |
| RollingRandomAccessFileAppender | rolling + random access file manager |
| RoutingAppender | routing dinamis berdasarkan context/pattern |
| AsyncAppender | queue-based async wrapper |
| FailoverAppender | fallback jika primary gagal |
| SocketAppender | kirim event ke network destination |
| JDBC/JMS/Kafka/custom | integrasi khusus, harus hati-hati terhadap coupling/failure |

Rule produksi:

> Appender adalah dependency runtime. Jika destination lambat/gagal, logging bisa ikut memengaruhi aplikasi. Jangan anggap logging selalu “free”.

---

## 13. ConsoleAppender

ConsoleAppender cocok untuk container dan Kubernetes.

Contoh text:

```xml
<Console name="Console" target="SYSTEM_OUT">
    <PatternLayout pattern="%d{ISO8601} %-5p [%t] %c - %m%n%throwable"/>
</Console>
```

Contoh stderr untuk error:

```xml
<Console name="ErrorConsole" target="SYSTEM_ERR">
    <ThresholdFilter level="ERROR" onMatch="ACCEPT" onMismatch="DENY"/>
    <PatternLayout pattern="%d{ISO8601} %-5p [%t] %c - %m%n%throwable"/>
</Console>
```

### 13.1 Console di Kubernetes

Di Kubernetes, pattern umum:

```text
Application writes structured logs to stdout/stderr
Container runtime captures logs
Node agent/collector ships logs
Central backend indexes logs
```

Keuntungan:

- tidak perlu manage file di container,
- restart tidak meninggalkan file lokal yang sulit diambil,
- collector bisa enrich metadata pod/namespace/container,
- sesuai twelve-factor style.

Risiko:

- stdout bisa menjadi bottleneck,
- log line multiline bisa rusak,
- JSON harus satu event per line,
- collector lag bisa membuat observability delay,
- container restart dapat kehilangan buffer kecil.

---

## 14. FileAppender

Contoh:

```xml
<File name="AppFile" fileName="logs/application.log">
    <PatternLayout pattern="%d{ISO8601} %-5p [%t] %c - %m%n%throwable"/>
</File>
```

FileAppender tanpa rolling biasanya buruk untuk production karena:

- file bisa tumbuh tanpa batas,
- disk bisa penuh,
- incident bisa diperparah oleh log volume,
- cleanup manual rawan.

Gunakan hanya untuk:

- local development,
- test scenario,
- temporary debugging,
- environment dengan external logrotate yang jelas.

---

## 15. RollingFileAppender

RollingFileAppender adalah default yang lebih aman untuk VM/bare metal.

Contoh:

```xml
<RollingFile name="RollingFile"
             fileName="/var/log/acme/payment-service/application.log"
             filePattern="/var/log/acme/payment-service/application-%d{yyyy-MM-dd}-%i.log.gz">
    <PatternLayout pattern="%d{ISO8601} %-5p [%t] %c - %m%n%throwable"/>
    <Policies>
        <TimeBasedTriggeringPolicy interval="1" modulate="true"/>
        <SizeBasedTriggeringPolicy size="100 MB"/>
    </Policies>
    <DefaultRolloverStrategy max="30"/>
</RollingFile>
```

### 15.1 Time-Based Policy

Rolling harian:

```xml
<TimeBasedTriggeringPolicy interval="1" modulate="true"/>
```

`modulate="true"` membuat boundary lebih natural, misalnya rolling tepat pada pergantian hari/jam sesuai pattern.

### 15.2 Size-Based Policy

```xml
<SizeBasedTriggeringPolicy size="100 MB"/>
```

Ini mencegah satu file terlalu besar.

### 15.3 Kombinasi Time + Size

Kombinasi ini umum:

```text
roll tiap hari, tetapi jika hari itu file sudah 100MB, buat index berikutnya
```

Pattern:

```text
application-2026-06-18-1.log.gz
application-2026-06-18-2.log.gz
application-2026-06-18-3.log.gz
```

### 15.4 Retention

`DefaultRolloverStrategy max="30"` membatasi jumlah file per pattern. Untuk retention berbasis umur/path/size yang lebih advanced, Log4j2 memiliki mekanisme Delete action dalam rollover strategy.

Contoh konsep:

```xml
<DefaultRolloverStrategy>
    <Delete basePath="/var/log/acme/payment-service" maxDepth="1">
        <IfFileName glob="application-*.log.gz"/>
        <IfLastModified age="30d"/>
    </Delete>
</DefaultRolloverStrategy>
```

Ini membantu mencegah disk penuh.

---

## 16. Layout Mental Model

Layout mengubah `LogEvent` menjadi bytes/string.

```text
LogEvent object
   contains:
     timestamp
     level
     logger name
     thread name
     message
     throwable
     marker
     context data
     source location optional
   |
   v
Layout
   |
   v
formatted output
```

Layout bukan kosmetik. Layout menentukan apakah log bisa:

- dibaca manusia,
- diparse mesin,
- dikorelasikan dengan trace,
- diquery by field,
- dipakai untuk alert,
- aman dari multiline issue,
- aman dari secret leakage.

---

## 17. PatternLayout

PatternLayout menghasilkan text log.

Contoh:

```xml
<PatternLayout pattern="%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} trace_id=%X{trace_id} span_id=%X{span_id} correlation_id=%X{correlation_id} - %msg%n%throwable"/>
```

### 17.1 Pattern Penting

| Pattern | Makna |
|---|---|
| `%d` | timestamp |
| `%level` / `%p` | log level |
| `%thread` / `%t` | thread name |
| `%logger` / `%c` | logger name |
| `%msg` / `%m` | message |
| `%n` | newline |
| `%throwable` / `%ex` | exception stack trace |
| `%X{key}` | ThreadContext/MDC value |
| `%marker` | marker |
| `%class`, `%method`, `%line` | caller location, mahal |

### 17.2 Caller Location Cost

Pattern seperti ini mahal:

```text
%C %M %L
```

Karena Log4j2 harus menemukan call site, biasanya melalui stack walking.

Hindari di production high-throughput kecuali benar-benar diperlukan.

Lebih baik gunakan logger name:

```text
%logger{36}
```

Karena logger name biasanya sudah menunjukkan class/package.

### 17.3 PatternLayout Cocok Untuk Apa?

Cocok untuk:

- local development,
- CLI tools,
- human-readable VM logs,
- simple service,
- debugging sementara.

Kurang cocok untuk:

- log analytics modern,
- structured search,
- high-scale distributed system,
- compliance evidence yang butuh stable schema.

---

## 18. JsonTemplateLayout

Untuk structured logging modern, Log4j2 menyediakan `JsonTemplateLayout`.

Konsep:

```text
LogEvent -> JSON object according to template -> one line JSON
```

Keuntungan:

- schema eksplisit,
- efficient,
- customizable,
- bisa garbage-free pada skenario tertentu,
- lebih cocok untuk log backend modern.

Contoh minimal:

```xml
<Console name="JsonConsole" target="SYSTEM_OUT">
    <JsonTemplateLayout eventTemplateUri="classpath:LogstashJsonEventLayoutV1.json"/>
</Console>
```

Namun untuk production, sering lebih baik memakai custom event template.

Contoh konseptual template:

```json
{
  "timestamp": {
    "$resolver": "timestamp",
    "pattern": {
      "format": "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
      "timeZone": "UTC"
    }
  },
  "level": {
    "$resolver": "level",
    "field": "name"
  },
  "logger": {
    "$resolver": "logger",
    "field": "name"
  },
  "thread": {
    "$resolver": "thread",
    "field": "name"
  },
  "message": {
    "$resolver": "message",
    "stringified": true
  },
  "trace_id": {
    "$resolver": "mdc",
    "key": "trace_id"
  },
  "span_id": {
    "$resolver": "mdc",
    "key": "span_id"
  },
  "correlation_id": {
    "$resolver": "mdc",
    "key": "correlation_id"
  },
  "exception": {
    "$resolver": "exception",
    "field": "stackTrace",
    "stackTrace": {
      "stringified": true
    }
  }
}
```

### 18.1 JSON Log Requirements

Production JSON log harus:

1. Satu event = satu line.
2. Valid JSON meskipun message mengandung quote/newline.
3. Memiliki timestamp dengan timezone jelas.
4. Memiliki level.
5. Memiliki service/environment/version.
6. Memiliki trace/span/correlation id jika ada.
7. Tidak membocorkan secret.
8. Stabil secara schema.
9. Tidak memakai dynamic field name liar.
10. Tidak memasukkan payload besar tanpa kontrol.

---

## 19. ThreadContext: MDC Versi Log4j2

Log4j2 memiliki `ThreadContext`, mirip MDC.

Contoh:

```java
import org.apache.logging.log4j.ThreadContext;

public void handle(Request request) {
    ThreadContext.put("correlation_id", request.correlationId());
    ThreadContext.put("tenant_id", request.tenantId());
    try {
        log.info("Processing request");
    } finally {
        ThreadContext.clearMap();
    }
}
```

Jika memakai SLF4J API, biasanya code memakai:

```java
import org.slf4j.MDC;
```

Ketika backend Log4j2, MDC SLF4J akan dipetakan ke context data Log4j2 melalui provider/binding.

### 19.1 PatternLayout Dengan Context Data

```xml
<PatternLayout pattern="%d %-5p [%t] %c trace_id=%X{trace_id} correlation_id=%X{correlation_id} - %m%n%throwable"/>
```

### 19.2 JSON Layout Dengan Context Data

Pada structured logging, context data harus menjadi field JSON, bukan ditempel dalam message.

Buruk:

```text
Processing request correlation_id=abc tenant_id=t1
```

Lebih baik:

```json
{
  "event": "request.processing.started",
  "correlation_id": "abc",
  "tenant_id": "t1"
}
```

---

## 20. Filters

Filter menentukan apakah event diterima, ditolak, atau diteruskan ke decision berikutnya.

Outcome umum:

```text
ACCEPT
DENY
NEUTRAL
```

### 20.1 ThresholdFilter

```xml
<ThresholdFilter level="WARN" onMatch="ACCEPT" onMismatch="DENY"/>
```

Artinya hanya WARN ke atas.

### 20.2 LevelRangeFilter

Berguna jika ingin memisahkan INFO ke stdout dan ERROR ke stderr.

Konsep:

```xml
<LevelRangeFilter minLevel="INFO" maxLevel="WARN" onMatch="ACCEPT" onMismatch="DENY"/>
```

### 20.3 MarkerFilter

Misalnya security event diarahkan ke appender khusus.

```xml
<MarkerFilter marker="SECURITY" onMatch="ACCEPT" onMismatch="DENY"/>
```

### 20.4 RegexFilter

Bisa dipakai untuk pattern tertentu, tetapi hati-hati:

- mahal,
- brittle,
- bisa salah reject,
- sulit diaudit.

Lebih baik pakai marker/context field daripada regex message.

---

## 21. Routing Pattern Dasar Tanpa RoutingAppender

Sebelum masuk `RoutingAppender`, banyak kebutuhan routing bisa diselesaikan dengan logger spesifik dan filter.

### 21.1 Pisahkan Audit Log

```xml
<RollingFile name="AuditFile"
             fileName="/var/log/acme/audit.log"
             filePattern="/var/log/acme/audit-%d{yyyy-MM-dd}-%i.log.gz">
    <JsonTemplateLayout eventTemplateUri="classpath:audit-event-template.json"/>
    <Policies>
        <TimeBasedTriggeringPolicy/>
        <SizeBasedTriggeringPolicy size="100 MB"/>
    </Policies>
</RollingFile>

<Logger name="com.acme.audit" level="INFO" additivity="false">
    <AppenderRef ref="AuditFile"/>
</Logger>
```

### 21.2 Pisahkan Security Log Berdasarkan Marker

```xml
<RollingFile name="SecurityFile"
             fileName="/var/log/acme/security.log"
             filePattern="/var/log/acme/security-%d{yyyy-MM-dd}-%i.log.gz">
    <MarkerFilter marker="SECURITY" onMatch="ACCEPT" onMismatch="DENY"/>
    <JsonTemplateLayout eventTemplateUri="classpath:security-event-template.json"/>
    <Policies>
        <TimeBasedTriggeringPolicy/>
        <SizeBasedTriggeringPolicy size="100 MB"/>
    </Policies>
</RollingFile>

<Root level="INFO">
    <AppenderRef ref="Console"/>
    <AppenderRef ref="SecurityFile"/>
</Root>
```

Kelemahan: jika security appender juga menerima root event dan filter salah, event bisa hilang atau bocor. Pastikan test.

---

## 22. Properties and Environment Substitution

Log4j2 mendukung property substitution.

Contoh:

```xml
<Configuration status="WARN">
    <Properties>
        <Property name="SERVICE_NAME">payment-service</Property>
        <Property name="LOG_PATH">${env:LOG_PATH:-/var/log/acme/payment-service}</Property>
        <Property name="LOG_LEVEL">${env:LOG_LEVEL:-INFO}</Property>
    </Properties>

    <Appenders>
        <Console name="Console" target="SYSTEM_OUT">
            <PatternLayout pattern="%d %-5p service=${SERVICE_NAME} [%t] %c - %m%n%throwable"/>
        </Console>
    </Appenders>

    <Loggers>
        <Root level="${LOG_LEVEL}">
            <AppenderRef ref="Console"/>
        </Root>
    </Loggers>
</Configuration>
```

### 22.1 Environment Config Discipline

Bagus:

```text
LOG_LEVEL=INFO
APP_LOG_LEVEL=INFO
COM_ACME_PAYMENT_LOG_LEVEL=DEBUG
LOG_FORMAT=JSON
```

Buruk:

```text
LOG_LEVEL=TRACE globally in production
```

Gunakan override spesifik saat incident.

---

## 23. Production Baseline: Kubernetes JSON stdout

Contoh baseline untuk service container:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN" monitorInterval="0">
    <Properties>
        <Property name="SERVICE_NAME">${env:SERVICE_NAME:-unknown-service}</Property>
        <Property name="ENVIRONMENT">${env:ENVIRONMENT:-unknown}</Property>
        <Property name="APP_VERSION">${env:APP_VERSION:-unknown}</Property>
        <Property name="ROOT_LOG_LEVEL">${env:ROOT_LOG_LEVEL:-INFO}</Property>
        <Property name="APP_LOG_LEVEL">${env:APP_LOG_LEVEL:-INFO}</Property>
    </Properties>

    <Appenders>
        <Console name="JsonConsole" target="SYSTEM_OUT">
            <JsonTemplateLayout eventTemplateUri="classpath:log4j2-json-event-template.json"/>
        </Console>
    </Appenders>

    <Loggers>
        <Logger name="com.acme" level="${APP_LOG_LEVEL}" additivity="true"/>

        <Logger name="org.springframework" level="INFO"/>
        <Logger name="org.hibernate.SQL" level="WARN"/>
        <Logger name="com.zaxxer.hikari" level="INFO"/>

        <Root level="${ROOT_LOG_LEVEL}">
            <AppenderRef ref="JsonConsole"/>
        </Root>
    </Loggers>
</Configuration>
```

Template JSON bisa memuat:

```json
{
  "timestamp": { "$resolver": "timestamp", "pattern": { "format": "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "timeZone": "UTC" } },
  "severity": { "$resolver": "level", "field": "name" },
  "logger": { "$resolver": "logger", "field": "name" },
  "thread": { "$resolver": "thread", "field": "name" },
  "message": { "$resolver": "message", "stringified": true },
  "service.name": "${SERVICE_NAME}",
  "deployment.environment": "${ENVIRONMENT}",
  "service.version": "${APP_VERSION}",
  "trace_id": { "$resolver": "mdc", "key": "trace_id" },
  "span_id": { "$resolver": "mdc", "key": "span_id" },
  "correlation_id": { "$resolver": "mdc", "key": "correlation_id" },
  "tenant_id": { "$resolver": "mdc", "key": "tenant_id" },
  "error.stack_trace": { "$resolver": "exception", "field": "stackTrace", "stackTrace": { "stringified": true } }
}
```

Catatan:

- Sesuaikan resolver syntax dengan versi Log4j2 yang digunakan.
- Validasi template di test startup.
- Jangan memasukkan field dengan nilai undefined jika backend log tidak suka null/missing field.

---

## 24. Production Baseline: VM Rolling File Text

Untuk VM/bare metal tanpa collector modern:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN">
    <Properties>
        <Property name="LOG_PATH">${env:LOG_PATH:-/var/log/acme/payment-service}</Property>
        <Property name="ROOT_LOG_LEVEL">${env:ROOT_LOG_LEVEL:-INFO}</Property>
    </Properties>

    <Appenders>
        <RollingFile name="AppFile"
                     fileName="${LOG_PATH}/application.log"
                     filePattern="${LOG_PATH}/application-%d{yyyy-MM-dd}-%i.log.gz">
            <PatternLayout pattern="%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{40} trace_id=%X{trace_id} span_id=%X{span_id} correlation_id=%X{correlation_id} - %msg%n%throwable"/>
            <Policies>
                <TimeBasedTriggeringPolicy interval="1" modulate="true"/>
                <SizeBasedTriggeringPolicy size="100 MB"/>
            </Policies>
            <DefaultRolloverStrategy max="30">
                <Delete basePath="${LOG_PATH}" maxDepth="1">
                    <IfFileName glob="application-*.log.gz"/>
                    <IfLastModified age="30d"/>
                </Delete>
            </DefaultRolloverStrategy>
        </RollingFile>
    </Appenders>

    <Loggers>
        <Root level="${ROOT_LOG_LEVEL}">
            <AppenderRef ref="AppFile"/>
        </Root>
    </Loggers>
</Configuration>
```

---

## 25. Production Baseline: Split Application, Audit, Security

```xml
<Configuration status="WARN">
    <Properties>
        <Property name="LOG_PATH">${env:LOG_PATH:-/var/log/acme/case-service}</Property>
    </Properties>

    <Appenders>
        <RollingFile name="AppFile"
                     fileName="${LOG_PATH}/application.log"
                     filePattern="${LOG_PATH}/application-%d{yyyy-MM-dd}-%i.log.gz">
            <PatternLayout pattern="%d %-5p [%t] %c - %m%n%throwable"/>
            <Policies>
                <TimeBasedTriggeringPolicy/>
                <SizeBasedTriggeringPolicy size="100 MB"/>
            </Policies>
        </RollingFile>

        <RollingFile name="AuditFile"
                     fileName="${LOG_PATH}/audit.log"
                     filePattern="${LOG_PATH}/audit-%d{yyyy-MM-dd}-%i.log.gz">
            <JsonTemplateLayout eventTemplateUri="classpath:audit-event-template.json"/>
            <Policies>
                <TimeBasedTriggeringPolicy/>
                <SizeBasedTriggeringPolicy size="100 MB"/>
            </Policies>
        </RollingFile>

        <RollingFile name="SecurityFile"
                     fileName="${LOG_PATH}/security.log"
                     filePattern="${LOG_PATH}/security-%d{yyyy-MM-dd}-%i.log.gz">
            <JsonTemplateLayout eventTemplateUri="classpath:security-event-template.json"/>
            <Policies>
                <TimeBasedTriggeringPolicy/>
                <SizeBasedTriggeringPolicy size="100 MB"/>
            </Policies>
        </RollingFile>
    </Appenders>

    <Loggers>
        <Logger name="com.acme.audit" level="INFO" additivity="false">
            <AppenderRef ref="AuditFile"/>
        </Logger>

        <Logger name="com.acme.securitylog" level="INFO" additivity="false">
            <AppenderRef ref="SecurityFile"/>
        </Logger>

        <Root level="INFO">
            <AppenderRef ref="AppFile"/>
        </Root>
    </Loggers>
</Configuration>
```

Catatan desain:

- Audit/security sebaiknya tidak hanya berbeda message. Sebaiknya berbeda logger/marker/schema/retention/access control.
- Jangan mengandalkan regex message untuk compliance evidence.
- Pastikan event audit/security tidak jatuh ke appender umum jika policy melarang.

---

## 26. Log4j2 Plugin System

Log4j2 memiliki plugin system untuk menemukan komponen seperti:

- appender,
- layout,
- filter,
- lookup,
- converter,
- policy,
- strategy.

Ini membuat Log4j2 sangat extensible.

Contoh custom appender/layout bisa dibuat, tetapi rule-nya:

> Jangan membuat custom logging plugin kecuali kebutuhan benar-benar tidak bisa dipenuhi konfigurasi standar.

Kenapa?

- logging path harus sangat reliable,
- bug kecil bisa menyebabkan kehilangan evidence,
- dependency tambahan bisa memperbesar attack surface,
- performance cost bisa sulit diprediksi,
- testing harus sangat serius.

Custom plugin cocok untuk platform team, bukan feature team biasa.

---

## 27. Lookups

Log4j2 mendukung lookup untuk property substitution.

Contoh:

```xml
${env:LOG_LEVEL}
${sys:user.home}
${date:yyyy-MM-dd}
```

Gunakan untuk konfigurasi environment, bukan untuk menyusun message dari untrusted input.

Setelah sejarah Log4Shell, governance lookup harus ketat. Jangan aktifkan fitur yang tidak diperlukan, jangan menerima pattern/config dari user input, dan selalu pakai versi Log4j2 yang patched/maintained.

---

## 28. Java 8 Sampai Java 25 Considerations

### 28.1 Java 8

Karakteristik:

- banyak legacy dependency,
- banyak SLF4J 1.7,
- banyak framework lama,
- classpath conflict umum,
- Log4j 1.x legacy masih sering ditemukan.

Fokus:

- bersihkan dependency tree,
- pastikan tidak ada Log4j 1.x vulnerable,
- pilih provider/binding sesuai SLF4J version,
- jangan campur bridge bolak-balik.

### 28.2 Java 11/17

Karakteristik:

- baseline modern enterprise,
- Spring Boot 2.x/3.x mix,
- container support lebih matang,
- unified logging JVM lebih baik.

Fokus:

- structured logs,
- stdout container,
- OpenTelemetry trace id injection,
- JSON layout stabil.

### 28.3 Java 21

Karakteristik:

- virtual threads production-ready,
- structured concurrency preview/incubation history,
- thread naming dan MDC assumptions mulai diuji ulang.

Fokus:

- jangan bergantung pada thread name sebagai request identity,
- pahami context propagation,
- hati-hati ThreadContext/MDC pada virtual threads jika volume sangat besar,
- gunakan trace/correlation id sebagai identity utama.

### 28.4 Java 25

Karakteristik:

- LTS modern berikutnya,
- virtual-thread era makin matang,
- Scoped Values menjadi bagian penting untuk context sharing modern.

Fokus:

- desain context propagation yang tidak terlalu bergantung pada mutable ThreadLocal,
- logging schema tetap stabil,
- profiling dan observability modern makin penting.

---

## 29. Common Failure Modes

### 29.1 Tidak Ada Log Keluar

Kemungkinan:

1. Tidak ada backend.
2. Config tidak terbaca.
3. Root level terlalu tinggi.
4. Logger package salah.
5. Appender tidak direferensikan.
6. Filter menolak event.
7. File path tidak writable.
8. Dependency conflict.
9. Spring Boot masih memakai Logback.
10. Container stdout tidak dicapture sesuai ekspektasi.

Diagnosis:

```bash
java -Dlog4j2.debug=true -jar app.jar
```

Cek dependency:

```bash
mvn dependency:tree | grep -E "log4j|slf4j|logback"
```

atau:

```bash
gradle dependencies --configuration runtimeClasspath
```

### 29.2 Duplicate Logs

Kemungkinan:

1. Additivity true dengan appender child dan root.
2. Dua backend aktif.
3. Bridge loop.
4. AppenderRef sama di beberapa parent.
5. Framework menambahkan appender default.

Fix:

- pastikan satu backend,
- set `additivity="false"` jika perlu,
- hilangkan duplicate appender,
- cek starter logging.

### 29.3 JSON Log Rusak

Kemungkinan:

1. Message multiline tidak diescape karena memakai pattern text, bukan JSON layout.
2. Appender mencampur text dan JSON.
3. Internal status logger menulis ke stdout.
4. Stack trace multiline text.
5. Template salah.

Fix:

- gunakan JsonTemplateLayout,
- pastikan one event one line,
- redirect status logger dengan hati-hati,
- validasi log sample di CI.

### 29.4 Disk Penuh

Kemungkinan:

1. FileAppender tanpa rolling.
2. Rolling tanpa retention.
3. Root DEBUG/TRACE.
4. Exception storm.
5. Retry loop noisy.
6. Audit log volume tidak dihitung.

Fix:

- rolling + size + retention,
- rate-limit noisy logs,
- alert disk usage,
- sampling untuk repetitive diagnostic event,
- jangan log payload besar.

### 29.5 Latency Naik Karena Logging

Kemungkinan:

1. Synchronous file/network appender.
2. Caller location aktif.
3. JSON serialization mahal.
4. Stack trace terlalu sering.
5. Destination lambat.
6. Lock contention di appender.

Fix:

- async logger/appender dengan policy jelas,
- hapus caller location,
- structured but lean schema,
- sampling/dedup noisy error,
- stdout collector sehat,
- profiling logging path.

### 29.6 Security Leakage

Kemungkinan:

1. Request/response body logging.
2. Authorization header tercatat.
3. Token/API key masuk exception message.
4. SQL parameter sensitive.
5. PII masuk MDC.
6. Debug library membocorkan payload.

Fix:

- redaction policy,
- masking converter/filter,
- secure logging review,
- disable noisy sensitive package,
- test forbidden fields.

---

## 30. Diagnostic Commands

### 30.1 Maven Dependency Tree

```bash
mvn dependency:tree -Dincludes=org.apache.logging.log4j
mvn dependency:tree -Dincludes=org.slf4j
mvn dependency:tree -Dincludes=ch.qos.logback
```

### 30.2 Gradle Dependency Insight

```bash
gradle dependencyInsight --dependency log4j-core --configuration runtimeClasspath
gradle dependencyInsight --dependency slf4j-api --configuration runtimeClasspath
gradle dependencyInsight --dependency logback-classic --configuration runtimeClasspath
```

### 30.3 Runtime Debug

```bash
-Dlog4j2.debug=true
-Dlog4j.configurationFile=/path/to/log4j2.xml
```

### 30.4 Container Check

```bash
kubectl logs deployment/payment-service
kubectl logs pod/payment-service-xxx --previous
kubectl exec -it payment-service-xxx -- printenv | grep LOG
```

### 30.5 File Permission Check

```bash
ls -lah /var/log/acme/payment-service
id
stat /var/log/acme/payment-service
```

---

## 31. Design Decision Matrix

### 31.1 Backend Choice

| Need | Logback | Log4j2 |
|---|---:|---:|
| Spring Boot default simplicity | Strong | Good with starter |
| High-performance async logging | Good | Very strong |
| Garbage-free path | Limited | Strong |
| Advanced routing | Good | Very strong |
| JSON Template Layout | External encoder usually | Built-in JsonTemplateLayout |
| Familiarity in Spring teams | Very high | Medium-high |
| Plugin extensibility | Good | Very strong |

### 31.2 Layout Choice

| Runtime | Recommended layout |
|---|---|
| Local dev | PatternLayout |
| Simple CLI | PatternLayout |
| Kubernetes production | JsonTemplateLayout to stdout |
| VM legacy | RollingFile + PatternLayout or JSON |
| Compliance audit | JSON with stable schema |
| Security event | JSON with restricted schema |
| High-throughput service | JSON template lean + async design |

### 31.3 Appender Choice

| Destination | Recommended |
|---|---|
| Kubernetes | Console stdout |
| VM | RollingFile |
| Local | Console |
| Audit separate file | RollingFile with retention |
| Security separate channel | RollingFile or collector route |
| Remote network logging | Prefer collector/agent; direct appender only with strong failure design |

---

## 32. Code Patterns

### 32.1 SLF4J Code With Log4j2 Backend

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class PaymentService {
    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    public void authorize(String paymentId) {
        log.info("payment.authorization.started payment_id={}", paymentId);
    }
}
```

### 32.2 SLF4J 2.x Fluent Key-Value With Log4j2 Backend

```java
log.atInfo()
   .setMessage("Payment authorization started")
   .addKeyValue("event", "payment.authorization.started")
   .addKeyValue("payment_id", paymentId)
   .addKeyValue("gateway", gatewayName)
   .log();
```

Backend Log4j2 dapat menampilkan key-value tergantung layout/template.

### 32.3 Log4j2 API Direct

```java
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

public class PaymentService {
    private static final Logger log = LogManager.getLogger(PaymentService.class);

    public void authorize(String paymentId) {
        log.info("Payment authorization started payment_id={}", paymentId);
    }
}
```

### 32.4 ThreadContext Direct

```java
import org.apache.logging.log4j.ThreadContext;

public final class RequestLoggingContext implements AutoCloseable {
    public RequestLoggingContext(String correlationId, String tenantId) {
        ThreadContext.put("correlation_id", correlationId);
        ThreadContext.put("tenant_id", tenantId);
    }

    @Override
    public void close() {
        ThreadContext.remove("correlation_id");
        ThreadContext.remove("tenant_id");
    }
}
```

Usage:

```java
try (var ignored = new RequestLoggingContext(correlationId, tenantId)) {
    service.handle(request);
}
```

---

## 33. Testing Log4j2 Configuration

Logging config harus dites. Jangan menunggu production untuk tahu JSON rusak.

### 33.1 Startup Test

Minimal:

```java
@Test
void log4j2ConfigurationShouldLoad() {
    Logger logger = LogManager.getLogger("com.acme.test");
    logger.info("test log4j2 configuration load");
}
```

### 33.2 JSON Validity Test

Untuk structured logs, capture output dan parse sebagai JSON.

Pseudo-test:

```java
@Test
void jsonLogShouldBeValidSingleLineJson() {
    // arrange appender output capture
    // act log one event with quote, newline, exception
    // assert each line parses as JSON
    // assert fields timestamp, severity, logger, message, trace_id exist
}
```

### 33.3 Forbidden Field Test

```java
@Test
void logsShouldNotContainSecrets() {
    // log request containing Authorization header
    // assert output does not contain raw token
    // assert output contains masked marker if needed
}
```

### 33.4 Dependency Test

CI bisa gagal jika ada backend ganda:

```text
Forbidden together:
- logback-classic + log4j-slf4j2-impl
- log4j-to-slf4j + log4j-slf4j2-impl
- old vulnerable log4j-core versions
- log4j 1.x direct dependency
```

---

## 34. Production Review Checklist

### 34.1 Dependency

- [ ] Hanya satu backend logging aktif.
- [ ] SLF4J provider/binding sesuai versi SLF4J.
- [ ] Tidak ada bridge loop.
- [ ] Tidak ada Log4j 1.x legacy tanpa compatibility strategy.
- [ ] Log4j2 version patched dan managed via BOM/dependency management.

### 34.2 Configuration

- [ ] Config file eksplisit dan terdeteksi.
- [ ] Root level bukan DEBUG/TRACE di production.
- [ ] Package-specific override tersedia.
- [ ] Status logger tidak noisy.
- [ ] Additivity disengaja, bukan default tak sadar.

### 34.3 Appender

- [ ] Container memakai stdout/stderr atau collector strategy jelas.
- [ ] File appender punya rolling dan retention.
- [ ] Network appender punya failure strategy.
- [ ] Audit/security destination sesuai policy.
- [ ] Tidak ada appender duplicate.

### 34.4 Layout

- [ ] JSON valid jika production memakai structured logging.
- [ ] One event one line.
- [ ] Stack trace terkendali.
- [ ] Trace/correlation fields tersedia.
- [ ] Caller location tidak aktif kecuali perlu.

### 34.5 Security

- [ ] Secret redaction aktif.
- [ ] Request/response body logging dibatasi.
- [ ] PII policy jelas.
- [ ] Log injection dipertimbangkan.
- [ ] Access control log backend sesuai sensitivitas.

### 34.6 Operability

- [ ] Log volume diketahui.
- [ ] Disk usage/log ingestion monitored.
- [ ] Runtime level change policy jelas.
- [ ] Incident override aman.
- [ ] Config tested di CI.

---

## 35. Practical Labs

### Lab 1 — Build Minimal SLF4J to Log4j2 App

Tujuan:

- membuat Java app kecil,
- code memakai SLF4J,
- backend memakai Log4j2,
- output ke console.

Tugas:

1. Buat project Maven/Gradle.
2. Tambahkan `slf4j-api`, `log4j-slf4j2-impl`, `log4j-core`.
3. Buat `log4j2.xml` minimal.
4. Log event INFO, WARN, ERROR.
5. Jalankan.
6. Cek tidak ada warning “multiple bindings/providers”.

### Lab 2 — Diagnose Duplicate Logs

Tugas:

1. Buat logger `com.acme.audit` dengan appender sendiri.
2. Biarkan additivity true.
3. Lihat duplicate output.
4. Set `additivity="false"`.
5. Jelaskan perubahan event routing.

### Lab 3 — Rolling File Safety

Tugas:

1. Buat rolling file dengan size 1 MB.
2. Generate banyak log.
3. Validasi file rotation.
4. Tambahkan retention delete action.
5. Jelaskan risiko disk penuh jika retention tidak ada.

### Lab 4 — JSON Template Logging

Tugas:

1. Buat `JsonTemplateLayout`.
2. Tambahkan fields:
   - timestamp,
   - severity,
   - logger,
   - thread,
   - message,
   - trace_id,
   - correlation_id.
3. Log message dengan quote dan newline.
4. Pastikan output tetap valid JSON per line.

### Lab 5 — Dependency Conflict Drill

Tugas:

1. Tambahkan `logback-classic` secara sengaja.
2. Jalankan app.
3. Amati warning/conflict.
4. Perbaiki dependency tree.
5. Dokumentasikan rule “one backend only”.

---

## 36. Review Questions

1. Apa perbedaan `log4j-api` dan `log4j-core`?
2. Kapan memakai `log4j-slf4j2-impl`?
3. Kenapa `log4j-to-slf4j` tidak boleh digabung dengan `log4j-slf4j2-impl`?
4. Apa penyebab duplicate logs paling umum?
5. Apa fungsi `additivity="false"`?
6. Kapan PatternLayout masih cukup?
7. Kenapa JsonTemplateLayout lebih cocok untuk centralized logging?
8. Kenapa caller location mahal?
9. Apa risiko FileAppender tanpa rolling?
10. Apa yang harus dicek saat Log4j2 config tidak terbaca?
11. Apa perbedaan appender dan layout?
12. Apa fungsi filter?
13. Kenapa root DEBUG berbahaya di production?
14. Bagaimana cara memisahkan audit log dari application log?
15. Apa field minimal structured log production-grade?

---

## 37. Mini Case Study: Duplicate Log Saat Migrasi Spring Boot ke Log4j2

### Situasi

Tim mengganti backend dari Logback ke Log4j2. Setelah deploy UAT, setiap log muncul dua kali.

### Gejala

```text
2026-06-18 10:00:01 INFO  PaymentService - Payment authorized
2026-06-18 10:00:01 INFO  PaymentService - Payment authorized
```

### Kemungkinan Penyebab

1. `spring-boot-starter-logging` belum diexclude.
2. `spring-boot-starter-log4j2` ditambahkan, tetapi Logback masih ada.
3. Logger spesifik punya appender dan additivity true.
4. Root appender dan package appender sama-sama menerima event.
5. Ada bridge loop.

### Investigation

Cek dependency:

```bash
mvn dependency:tree | grep -E "logback|log4j|slf4j"
```

Cek config:

```xml
<Logger name="com.acme" level="INFO">
    <AppenderRef ref="Console"/>
</Logger>

<Root level="INFO">
    <AppenderRef ref="Console"/>
</Root>
```

Jika `com.acme` additivity default true, event masuk `Console` dari logger `com.acme`, lalu naik ke root dan masuk `Console` lagi.

### Fix

```xml
<Logger name="com.acme" level="INFO" additivity="false">
    <AppenderRef ref="Console"/>
</Logger>
```

Atau lebih sederhana:

```xml
<Logger name="com.acme" level="INFO"/>

<Root level="INFO">
    <AppenderRef ref="Console"/>
</Root>
```

### Lesson

Duplicate log bukan hanya masalah “rapi”. Duplicate log bisa:

- menggandakan ingestion cost,
- membuat alert count salah,
- menyulitkan incident timeline,
- membuat audit evidence ambigu,
- mempercepat disk penuh.

---

## 38. Mini Case Study: JSON Logs Tidak Bisa Diparse Collector

### Situasi

Service sudah memakai “JSON logs”, tetapi log backend menolak sebagian event.

### Gejala

Collector error:

```text
failed to parse log line as JSON
```

Sample log:

```text
{"timestamp":"2026-06-18T10:00:00Z","message":"Failed to process
request"}
java.lang.RuntimeException: timeout
    at com.acme.PaymentService.authorize(PaymentService.java:42)
```

### Root Cause

Tim membuat JSON secara manual di PatternLayout atau message, lalu stack trace tetap multiline text.

### Fix

Gunakan JSON layout yang benar:

```xml
<JsonTemplateLayout eventTemplateUri="classpath:log4j2-json-event-template.json"/>
```

Dan representasikan exception sebagai field JSON string/object yang diescape.

### Lesson

Structured logging bukan berarti “message terlihat seperti JSON”. Structured logging berarti layout menghasilkan JSON valid sebagai kontrak output.

---

## 39. Mental Model Final

Log4j2 harus dipahami sebagai kombinasi:

```text
API compatibility
+ event creation
+ logger hierarchy
+ filter decisions
+ appender routing
+ layout formatting
+ destination failure behavior
+ runtime configuration
+ security policy
+ cost model
```

Jika salah satu bagian tidak dipahami, logging bisa berubah dari alat diagnosis menjadi sumber masalah:

- missing evidence,
- duplicate evidence,
- false alert,
- production latency,
- disk outage,
- secret leakage,
- broken incident investigation.

Top-tier engineer tidak hanya bertanya:

```text
“Bagaimana cara log muncul?”
```

Mereka bertanya:

```text
“Apakah event yang tepat dibuat, dirouting dengan benar, diformat dengan schema stabil, aman, murah, dan tetap tersedia saat sistem sedang rusak?”
```

Itulah standar berpikir untuk Log4j2 di production.

---

## 40. Ringkasan

Di bagian ini kita mempelajari:

1. Log4j2 sebagai runtime event router.
2. Perbedaan Log4j2 API, Core, SLF4J binding/provider, dan bridge.
3. Dependency recipes untuk Maven, Gradle, dan Spring Boot.
4. Configuration discovery dan format config.
5. Logger hierarchy, effective level, dan additivity.
6. Appender model dan pilihan appender.
7. PatternLayout vs JsonTemplateLayout.
8. ThreadContext/MDC.
9. Filter.
10. Production baseline untuk Kubernetes, VM, audit, dan security logs.
11. Failure modes dan diagnostic workflow.
12. Testing dan review checklist.

Bagian berikutnya akan masuk lebih dalam ke kekuatan utama Log4j2:

# Part 8 — Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security

Di sana kita akan membahas AsyncLogger, Disruptor, queue/ring buffer, wait strategy, garbage-free logging, routing advanced, failover, dan Log4j2 security hardening secara lebih dalam.

---

## Referensi

- Apache Log4j2 Manual — Appenders.
- Apache Log4j2 Manual — Layouts dan JSON Template Layout.
- Apache Log4j2 Manual — Asynchronous Loggers.
- Apache Log4j2 Manual — Garbage-free logging.
- Apache Log4j2 Manual — SLF4J binding/provider dan bridge modules.
- Spring Boot Logging Documentation.
- SLF4J Manual.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 6 — Logback Deep Dive II: AsyncAppender, MDC, Sifting, Filtering, JSON](./06-logback-deep-dive-asyncappender-mdc-sifting-filtering-json.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 8 — Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security](./08-log4j2-deep-dive-async-logger-garbage-free-routing-security.md)
