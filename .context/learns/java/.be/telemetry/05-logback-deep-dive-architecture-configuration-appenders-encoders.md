# Part 5 — Logback Deep Dive I: Architecture, Configuration, Appenders, Encoders

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> File: `05-logback-deep-dive-architecture-configuration-appenders-encoders.md`  
> Scope: Java 8–25, SLF4J + Logback, production logging architecture, configuration, appenders, encoders, rolling, filters, and operational failure modes.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

1. runtime evidence sebagai mental model,
2. arsitektur logging Java secara umum,
3. semantik log,
4. SLF4J sebagai facade.

Bagian ini masuk ke **Logback sebagai backend logging**.

Targetnya bukan hanya bisa menulis `logback.xml`, tetapi paham:

- bagaimana event dari SLF4J berubah menjadi output log,
- bagaimana logger hierarchy dan appender bekerja,
- bagaimana konfigurasi Logback di-load,
- kapan memakai console/file/rolling appender,
- bagaimana encoder dan layout memengaruhi format dan cost,
- bagaimana filter memotong noise,
- bagaimana konfigurasi logging bisa menyebabkan duplicate logs, dropped logs, disk penuh, latency, bahkan outage,
- bagaimana membuat baseline configuration yang production-grade.

Logback sering terasa “sederhana” karena Spring Boot membuatnya otomatis. Justru karena itu banyak engineer hanya tahu surface-level configuration. Engineer yang kuat harus paham bahwa Logback adalah **runtime event routing engine**.

---

## 1. Posisi Logback dalam Ekosistem Logging Java

Logback adalah backend logging yang paling sering dipakai di aplikasi Spring Boot default. Secara umum flow-nya:

```text
Application Code
    |
    | logger.info(...)
    v
SLF4J API
    |
    | provider/binding
    v
Logback Classic
    |
    | logger hierarchy + level + filters
    v
Appender(s)
    |
    | encoder/layout
    v
Output Destination
    |-- stdout/stderr
    |-- file
    |-- rolling file
    |-- socket
    |-- custom sink
```

Yang penting: **SLF4J tidak menulis log**. SLF4J hanya API/facade. Yang memutuskan apakah log diterima, diformat, dan dikirim adalah backend seperti Logback.

Logback terdiri dari beberapa modul utama:

| Module | Fungsi |
|---|---|
| `logback-core` | fondasi umum: appender, encoder, rolling policy, filter dasar |
| `logback-classic` | implementasi SLF4J backend, logger hierarchy, level, MDC |
| `logback-access` | logging HTTP access/request-response di container tertentu |

Dalam aplikasi modern, yang paling sering dipakai adalah:

```text
slf4j-api + logback-classic + logback-core
```

`logback-classic` membawa integrasi SLF4J, sedangkan `logback-core` membawa primitif output.

---

## 2. Mental Model Logback: Event Routing Pipeline

Setiap log statement yang enabled akan menjadi event.

Misalnya:

```java
log.info("payment submitted caseId={} amount={}", caseId, amount);
```

Secara konseptual berubah menjadi:

```text
LoggingEvent {
  timestamp,
  level = INFO,
  loggerName,
  threadName,
  messageTemplate,
  argumentArray,
  formattedMessage,
  throwable,
  marker,
  mdcMap,
  callerData?,
  sequence?,
  keyValuePairs? depends on facade/backend support
}
```

Lalu Logback melakukan pipeline:

```text
1. Is logger enabled for this level?
2. Create logging event.
3. Apply turbo filters if any.
4. Deliver event to logger appenders.
5. If additivity=true, propagate to parent loggers.
6. Each appender applies appender-level filters.
7. Encoder/layout transforms event to bytes/text.
8. Appender writes to destination.
```

Ini penting karena banyak masalah logging berasal dari salah paham pipeline:

- log hilang karena level tidak enabled,
- log dobel karena additivity,
- log salah format karena appender berbeda,
- log lambat karena encoder mahal,
- log tidak muncul di Kubernetes karena ditulis ke file internal,
- MDC hilang karena event dibuat di thread lain,
- stack trace tidak muncul karena pattern salah,
- disk penuh karena rolling policy salah,
- aplikasi lambat karena synchronous file/network appender.

---

## 3. Logback Components

### 3.1 Logger

Logger adalah named object yang menerima request logging.

Contoh:

```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);
```

Nama logger biasanya nama fully-qualified class:

```text
com.example.order.OrderService
```

Logger berada dalam hierarchy berdasarkan nama package:

```text
ROOT
└── com
    └── example
        └── order
            └── OrderService
```

Jika `com.example.order` punya level `DEBUG`, maka `com.example.order.OrderService` akan mewarisi level itu kecuali diset eksplisit.

---

### 3.2 Level

Urutan level:

```text
TRACE < DEBUG < INFO < WARN < ERROR
```

`OFF` berarti mematikan logger. `ALL` berarti mengaktifkan semua level.

Contoh:

```xml
<logger name="com.example.order" level="DEBUG"/>
<root level="INFO">
    <appender-ref ref="CONSOLE"/>
</root>
```

Maknanya:

- package `com.example.order` menerima DEBUG ke atas,
- logger lain menerima INFO ke atas,
- output tetap dikirim ke root appender kecuali additivity dimatikan.

---

### 3.3 Appender

Appender adalah output destination.

Contoh destination:

- console,
- file,
- rolling file,
- socket,
- syslog,
- custom appender,
- async wrapper.

Appender tidak menentukan apakah log level enabled di logger. Appender menerima event yang sudah lolos logger-level check, lalu bisa memfilter lagi.

---

### 3.4 Encoder

Encoder mengubah event menjadi bytes dan menulisnya ke output stream.

Contoh:

```xml
<encoder>
    <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{36} - %msg%n</pattern>
</encoder>
```

Untuk file/console modern, encoder lebih relevan daripada layout karena output akhirnya bytes.

---

### 3.5 Layout

Layout mengubah event menjadi string. Dalam Logback modern, banyak appender memakai encoder. Pattern encoder secara internal memakai pattern layout concept.

Simplified:

```text
LoggingEvent -> Layout -> String
LoggingEvent -> Encoder -> byte[] / OutputStream write
```

---

### 3.6 Filter

Filter menentukan apakah event diterima, ditolak, atau netral.

Filter decision:

| Decision | Meaning |
|---|---|
| `ACCEPT` | langsung terima event |
| `DENY` | tolak event |
| `NEUTRAL` | tidak memutuskan, lanjutkan filter berikutnya |

Filter bisa dipasang di appender. TurboFilter bekerja lebih awal di logger context.

---

### 3.7 LoggerContext

`LoggerContext` adalah runtime container untuk logger dan konfigurasi.

Ia menyimpan:

- logger registry,
- appender instances,
- status messages,
- properties,
- lifecycle state.

Saat aplikasi start, Logback membuat atau memakai LoggerContext lalu menginisialisasi konfigurasi.

---

## 4. Configuration Loading Order

Logback mencari konfigurasi dari classpath atau system property.

Secara umum aplikasi sering memakai:

```text
logback.xml
logback-test.xml
logback-spring.xml
```

### 4.1 `logback.xml`

Ini file standar Logback.

Cocok untuk:

- aplikasi Java biasa,
- library test harness,
- aplikasi non-Spring,
- konfigurasi yang tidak butuh Spring profile/property extension.

Contoh lokasi:

```text
src/main/resources/logback.xml
```

---

### 4.2 `logback-test.xml`

Dipakai untuk test scope.

Contoh lokasi:

```text
src/test/resources/logback-test.xml
```

Biasanya digunakan untuk:

- menurunkan log noise saat unit test,
- mengaktifkan DEBUG untuk package tertentu,
- mematikan appender mahal,
- mengarahkan log test ke console.

---

### 4.3 `logback-spring.xml`

Ini varian khusus Spring Boot. Spring Boot bisa memproses extension seperti:

```xml
<springProfile name="dev">
    ...
</springProfile>

<springProperty name="appName" source="spring.application.name"/>
```

Gunakan `logback-spring.xml` untuk Spring Boot jika ingin menggunakan:

- Spring profiles,
- properties dari `application.yml`,
- profile-specific appenders,
- environment-specific pattern.

Jangan mengandalkan Spring extension di `logback.xml`, karena `logback.xml` bisa di-load terlalu awal oleh Logback sebelum Spring Boot punya kesempatan memproses extension.

---

## 5. Minimal Logback Configuration

Contoh paling sederhana:

```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

Ini cukup untuk development kecil, tetapi belum cukup untuk production karena belum punya:

- structured logging,
- trace/correlation fields,
- controlled exception format,
- rolling policy jika file,
- async strategy,
- profile-specific config,
- redaction,
- log volume governance.

---

## 6. Logger Hierarchy and Additivity

### 6.1 Effective Level

Jika logger tidak punya level eksplisit, ia mewarisi level dari parent.

Contoh:

```xml
<logger name="com.example" level="INFO"/>
<logger name="com.example.payment" level="DEBUG"/>
```

Maka:

| Logger | Effective level |
|---|---|
| `com.example.UserService` | INFO |
| `com.example.payment.PaymentService` | DEBUG |
| `org.springframework.web` | dari root |

---

### 6.2 Additivity

Secara default, event yang diterima logger akan dikirim ke appender logger tersebut, lalu diteruskan ke parent logger sampai root.

Contoh masalah duplicate log:

```xml
<logger name="com.example.payment" level="DEBUG">
    <appender-ref ref="PAYMENT_FILE"/>
</logger>

<root level="INFO">
    <appender-ref ref="CONSOLE"/>
</root>
```

Event `com.example.payment` akan masuk ke:

```text
PAYMENT_FILE + CONSOLE
```

Jika ingin hanya ke `PAYMENT_FILE`:

```xml
<logger name="com.example.payment" level="DEBUG" additivity="false">
    <appender-ref ref="PAYMENT_FILE"/>
</logger>
```

Namun hati-hati. `additivity=false` bisa membuat log tidak muncul di central collector jika root appender adalah satu-satunya appender yang dikumpulkan.

Rule praktis:

- gunakan additivity default untuk kebanyakan logger,
- pakai `additivity=false` hanya jika ingin routing khusus,
- dokumentasikan kenapa event tidak mengikuti root pipeline,
- test apakah log masih masuk ke observability platform.

---

## 7. PatternLayout and PatternEncoder

Pattern adalah bahasa kecil untuk mengubah event menjadi teks.

Contoh umum:

```xml
<pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} traceId=%X{trace_id} spanId=%X{span_id} - %msg%n%ex</pattern>
```

Komponen penting:

| Pattern | Meaning |
|---|---|
| `%d` | timestamp |
| `%level` / `%-5level` | log level |
| `%thread` | thread name |
| `%logger` | logger name |
| `%logger{36}` | shortened logger name |
| `%msg` | formatted message |
| `%n` | newline |
| `%ex` | exception stack trace |
| `%X` | full MDC map |
| `%X{key}` | MDC value by key |
| `%marker` | marker |
| `%class` | caller class, expensive |
| `%method` | caller method, expensive |
| `%line` | source line, expensive |

### 7.1 Caller Data Is Expensive

Pattern seperti ini mahal:

```xml
%class.%method:%line
```

Karena logging framework perlu menentukan call site. Itu biasanya membutuhkan stack walking.

Jangan aktifkan caller data di high-throughput production logs kecuali benar-benar dibutuhkan.

Lebih baik:

```text
logger name + event name + trace id + business id
```

Daripada:

```text
class + method + line number
```

Line number juga rapuh karena berubah setiap refactor.

---

## 8. ConsoleAppender

ConsoleAppender menulis ke stdout atau stderr.

Contoh:

```xml
<appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <target>System.out</target>
    <encoder>
        <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} - %msg%n%ex</pattern>
    </encoder>
</appender>
```

### 8.1 Console Logging di Container

Di Kubernetes/container, best practice umum adalah tulis application logs ke stdout/stderr, lalu biarkan runtime/agent mengumpulkan log.

Model:

```text
Java app -> stdout/stderr -> container runtime -> node log file -> collector -> log backend
```

Keunggulan:

- tidak perlu manage file rolling di aplikasi,
- log ikut lifecycle container,
- collector bisa enrich metadata pod/node/namespace,
- operational model lebih sederhana.

Risiko:

- stdout blocking di kondisi tertentu,
- collector lag,
- multiline stack trace parsing,
- log hilang saat restart jika collector tidak mengejar,
- log volume sangat besar membebani node.

---

### 8.2 stdout vs stderr

Strategi umum:

- semua application logs ke stdout,
- framework/runtime fatal bootstrap errors ke stderr,
- jangan split WARN/ERROR ke stderr tanpa alasan kuat karena bisa membuat ordering sulit.

Jika platform membedakan stdout/stderr severity, bisa dipakai. Tetapi pastikan tidak menimbulkan duplicate ingestion atau missing logs.

---

## 9. FileAppender

FileAppender menulis ke file tetap.

```xml
<appender name="FILE" class="ch.qos.logback.core.FileAppender">
    <file>${LOG_DIR:-logs}/application.log</file>
    <append>true</append>
    <encoder>
        <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} - %msg%n%ex</pattern>
    </encoder>
</appender>
```

FileAppender cocok untuk:

- aplikasi bare-metal/VM,
- local development,
- batch offline,
- environment di mana collector membaca file.

Tidak cukup untuk production jika tidak ada rolling policy. File akan terus membesar.

---

## 10. RollingFileAppender

RollingFileAppender adalah FileAppender dengan rotasi.

Ada dua alasan rolling:

1. membatasi ukuran file,
2. membatasi retensi historis.

Contoh time + size rolling:

```xml
<appender name="ROLLING_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>${LOG_DIR:-logs}/application.log</file>

    <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
        <fileNamePattern>${LOG_DIR:-logs}/application.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
        <maxFileSize>100MB</maxFileSize>
        <maxHistory>14</maxHistory>
        <totalSizeCap>10GB</totalSizeCap>
    </rollingPolicy>

    <encoder>
        <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} - %msg%n%ex</pattern>
    </encoder>
</appender>
```

### 10.1 `file` vs `fileNamePattern`

`file` adalah file aktif.

`fileNamePattern` adalah nama file hasil rolling.

Contoh:

```text
application.log                  current active file
application.2026-06-18.0.log.gz   archived file
application.2026-06-18.1.log.gz   archived file
```

---

### 10.2 `maxHistory`

`maxHistory` menentukan berapa periode arsip disimpan.

Jika pattern harian:

```xml
<maxHistory>14</maxHistory>
```

Berarti simpan sekitar 14 hari arsip.

---

### 10.3 `totalSizeCap`

`totalSizeCap` membatasi total ukuran arsip.

Ini penting karena `maxHistory` saja tidak cukup. Traffic log bisa naik drastis pada incident. Tanpa `totalSizeCap`, 14 hari log bisa menjadi ratusan GB.

Rule:

```text
Always combine retention count/time with total size cap.
```

---

### 10.4 Compression Cost

`.gz` menghemat disk, tetapi compression memakai CPU.

Di high-throughput environment:

- perhatikan waktu rollover,
- perhatikan CPU spike saat compress,
- hindari rolling terlalu sering,
- pastikan disk IO cukup.

---

## 11. Rolling Policy Selection

| Situation | Suggested approach |
|---|---|
| Local dev | console only or small rolling file |
| VM/bare metal | rolling file + collector |
| Kubernetes | console JSON logging; avoid app-managed file unless required |
| Batch job | per-execution file may be acceptable |
| Audit log | separate immutable/audit sink, not ordinary app log only |
| High-throughput service | async + structured stdout/file collector, careful queue/backpressure |
| Regulated environment | retention + access control + redaction + tamper consideration |

---

## 12. Filters

Appender filter example:

```xml
<appender name="ERROR_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>${LOG_DIR:-logs}/error.log</file>

    <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
        <level>ERROR</level>
    </filter>

    <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
        <fileNamePattern>${LOG_DIR:-logs}/error.%d{yyyy-MM-dd}.log.gz</fileNamePattern>
        <maxHistory>30</maxHistory>
        <totalSizeCap>5GB</totalSizeCap>
    </rollingPolicy>

    <encoder>
        <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} - %msg%n%ex</pattern>
    </encoder>
</appender>
```

### 12.1 ThresholdFilter

Menerima event dengan level >= threshold.

Jika threshold ERROR:

```text
ERROR accepted
WARN denied/neutral depending chain
INFO denied/neutral depending chain
```

### 12.2 LevelFilter

Cocok untuk exact level routing.

Misalnya hanya `ERROR`, bukan `WARN`.

```xml
<filter class="ch.qos.logback.classic.filter.LevelFilter">
    <level>ERROR</level>
    <onMatch>ACCEPT</onMatch>
    <onMismatch>DENY</onMismatch>
</filter>
```

### 12.3 EvaluatorFilter

Bisa memakai kondisi lebih kompleks, misalnya message atau marker tertentu. Gunakan hati-hati karena ekspresi kompleks bisa mahal dan sulit dirawat.

---

## 13. Separate Error File: Useful or Dangerous?

Banyak aplikasi membuat dua appender:

- `application.log` untuk semua INFO+,
- `error.log` untuk ERROR.

Ini bisa berguna untuk VM/bare-metal, tetapi berisiko:

1. ERROR event muncul dua kali di ingestion backend.
2. Alert bisa double-count.
3. Timeline pecah.
4. Storage bertambah.
5. Team hanya melihat `error.log` dan kehilangan konteks sebelum error.

Jika central log platform sudah bisa query `level=ERROR`, separate error file sering tidak perlu.

Gunakan separate error file hanya jika:

- ada kebutuhan operasional legacy,
- collector membaca file berbeda untuk retention berbeda,
- compliance meminta severity-specific retention,
- dashboard/alert legacy bergantung padanya.

---

## 14. Properties and Environment Variables

Contoh properti internal:

```xml
<property name="LOG_DIR" value="${LOG_DIR:-logs}"/>
<property name="APP_NAME" value="${APP_NAME:-order-service}"/>
```

Kemudian:

```xml
<file>${LOG_DIR}/${APP_NAME}.log</file>
```

Dalam `logback-spring.xml`:

```xml
<springProperty name="appName" source="spring.application.name" defaultValue="unknown-service"/>
<springProperty name="env" source="app.environment" defaultValue="local"/>
```

Ini membuat logging configuration ikut environment tanpa hardcode.

Namun jangan terlalu banyak logic di XML. Jika konfigurasi logging menjadi “programming language”, readability turun.

---

## 15. Spring Boot and Logback

Spring Boot default menggunakan Logback jika memakai starter umum.

Konsekuensi:

- banyak dependency logging sudah diatur oleh Boot,
- biasanya tidak perlu menambahkan logging backend sendiri,
- mengganti backend harus dilakukan dengan exclude dependency yang benar,
- `logback-spring.xml` lebih fleksibel daripada `logback.xml` untuk Boot.

Contoh `logback-spring.xml`:

```xml
<configuration scan="false">
    <springProperty name="appName" source="spring.application.name" defaultValue="unknown-service"/>
    <springProperty name="env" source="app.environment" defaultValue="local"/>

    <property name="CONSOLE_PATTERN"
              value="%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level app=${appName} env=${env} traceId=%X{trace_id:-} spanId=%X{span_id:-} [%thread] %logger{36} - %msg%n%ex"/>

    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>${CONSOLE_PATTERN}</pattern>
        </encoder>
    </appender>

    <springProfile name="local,dev">
        <logger name="com.example" level="DEBUG"/>
    </springProfile>

    <springProfile name="uat,prod">
        <logger name="com.example" level="INFO"/>
    </springProfile>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

### 15.1 Common Spring Boot Mistakes

#### Mistake 1 — using `logback.xml` while expecting Spring profiles

Wrong expectation:

```xml
<springProfile name="prod">
    ...
</springProfile>
```

inside `logback.xml`.

Better:

```text
Use logback-spring.xml
```

#### Mistake 2 — adding duplicate backend

Example:

```text
spring-boot-starter-web already brings logging default
application manually adds another backend
```

Symptoms:

- multiple SLF4J providers,
- logging warning at startup,
- unexpected backend,
- duplicate logs,
- missing logs.

#### Mistake 3 — changing root level to DEBUG in production

```xml
<root level="DEBUG">
```

This can explode logs from:

- Spring,
- Hibernate,
- HTTP clients,
- connection pools,
- security frameworks.

Better:

```xml
<root level="INFO"/>
<logger name="com.example.specific.component" level="DEBUG"/>
```

---

## 16. Production Baseline: Console Text Logging

This baseline is suitable for simple services or early migration stage.

```xml
<configuration scan="false">
    <property name="APP_NAME" value="${APP_NAME:-unknown-service}"/>
    <property name="ENV" value="${ENV:-local}"/>

    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <target>System.out</target>
        <encoder>
            <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level app=${APP_NAME} env=${ENV} traceId=%X{trace_id:-} spanId=%X{span_id:-} correlationId=%X{correlation_id:-} [%thread] %logger{40} - %msg%n%ex</pattern>
            <charset>UTF-8</charset>
        </encoder>
    </appender>

    <logger name="org.springframework" level="INFO"/>
    <logger name="org.hibernate.SQL" level="WARN"/>
    <logger name="com.zaxxer.hikari" level="INFO"/>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

Strength:

- simple,
- works in container,
- includes trace/correlation fields,
- avoids file management.

Limitation:

- not JSON,
- parsing depends on collector regex,
- stack trace multiline issue,
- not ideal for large-scale query.

---

## 17. Production Baseline: Rolling File Text Logging

For VM/bare-metal environments:

```xml
<configuration scan="false">
    <property name="APP_NAME" value="${APP_NAME:-unknown-service}"/>
    <property name="ENV" value="${ENV:-local}"/>
    <property name="LOG_DIR" value="${LOG_DIR:-/var/log/${APP_NAME}}"/>

    <appender name="ROLLING_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_DIR}/application.log</file>
        <append>true</append>

        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_DIR}/application.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>14</maxHistory>
            <totalSizeCap>10GB</totalSizeCap>
        </rollingPolicy>

        <encoder>
            <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level app=${APP_NAME} env=${ENV} traceId=%X{trace_id:-} spanId=%X{span_id:-} correlationId=%X{correlation_id:-} [%thread] %logger{40} - %msg%n%ex</pattern>
            <charset>UTF-8</charset>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="ROLLING_FILE"/>
    </root>
</configuration>
```

Operational checklist:

- log directory exists,
- process has write permission,
- disk has capacity,
- collector reads active file and rolled files if needed,
- rotation pattern matches collector behavior,
- compression does not break ingestion,
- retention does not violate compliance.

---

## 18. JSON Logging with Logback

Logback core does not provide rich JSON structured logging by itself in the same way Log4j2 JSON Template Layout does. In many Logback deployments, teams use additional encoders such as `logstash-logback-encoder`.

Conceptual JSON event:

```json
{
  "timestamp": "2026-06-18T10:15:30.123+07:00",
  "level": "INFO",
  "service.name": "case-service",
  "deployment.environment": "prod",
  "logger": "com.example.case.CaseService",
  "thread": "http-nio-8080-exec-17",
  "message": "case transition completed",
  "event.name": "case.transition.completed",
  "trace_id": "...",
  "span_id": "...",
  "correlation_id": "...",
  "case_id": "CASE-123",
  "from_status": "SUBMITTED",
  "to_status": "APPROVED"
}
```

Benefits:

- safer parsing,
- easier query,
- fields are first-class,
- no fragile regex,
- better correlation with traces/metrics.

Costs:

- larger payload,
- JSON serialization cost,
- schema governance needed,
- risk of high-cardinality explosion,
- field naming must be standardized.

Structured logging will be covered deeper in Part 9. In this part, the key is knowing that encoder choice determines whether your log is human text or machine event.

---

## 19. MDC with Logback Pattern

MDC lets you enrich log events with request/context fields.

Example pattern:

```xml
<pattern>%d %-5level traceId=%X{trace_id:-} correlationId=%X{correlation_id:-} userId=%X{user_id:-} [%thread] %logger{36} - %msg%n%ex</pattern>
```

Example servlet filter:

```java
public final class CorrelationIdFilter implements Filter {
    private static final String HEADER = "X-Correlation-Id";

    @Override
    public void doFilter(ServletRequest request,
                         ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletRequest http = (HttpServletRequest) request;
        String correlationId = http.getHeader(HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = UUID.randomUUID().toString();
        }

        MDC.put("correlation_id", correlationId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("correlation_id");
        }
    }
}
```

Critical rule:

```text
Every MDC put must have a deterministic cleanup path.
```

In thread pools, missing cleanup means the next request can inherit the previous request’s context.

---

## 20. Scanning and Auto Reload

Logback supports configuration scanning:

```xml
<configuration scan="true" scanPeriod="30 seconds">
```

This reloads config when changed.

Useful for:

- local/dev,
- legacy VM apps,
- temporary operational tuning.

Risk in production:

- inconsistent behavior across instances,
- accidental reload with invalid config,
- operational drift,
- unexpected appender reset,
- security/compliance concern.

Recommendation:

```text
For immutable deployments, prefer scan=false.
Change logging through deployment/config management, not manual file mutation.
```

---

## 21. StatusListener: Debugging Logback Itself

Sometimes the problem is the logging system.

Add status listener temporarily:

```xml
<configuration debug="true">
    ...
</configuration>
```

Or:

```xml
<statusListener class="ch.qos.logback.core.status.OnConsoleStatusListener"/>
```

This helps diagnose:

- config parse errors,
- appender start failure,
- file permission issue,
- rolling policy misconfiguration,
- missing property,
- class not found,
- duplicate appender name.

Do not leave verbose internal status logging enabled permanently in production unless you know the impact.

---

## 22. Common Failure Modes

### 22.1 Duplicate Logs

Symptoms:

```text
same line appears twice or more
```

Likely causes:

- appender attached both to package logger and root,
- additivity true when custom appender also used,
- multiple logging backends/providers,
- collector reads both stdout and file,
- app logs to stdout and file with same content,
- sidecar duplicates node collector.

Diagnosis:

1. Check startup warning for multiple SLF4J providers.
2. Check `logback.xml` appender refs.
3. Check `additivity`.
4. Check collector paths.
5. Check whether platform duplicates stdout/stderr.

---

### 22.2 Missing Logs

Likely causes:

- logger level too high,
- appender filter denies event,
- wrong config file loaded,
- package name mismatch,
- appender failed to start,
- async appender dropped event,
- app crashed before flush,
- collector lag or filter.

Diagnosis:

```text
Application emitted? -> Logger enabled? -> Event created? -> Appender attached? -> Filter accepted? -> Destination written? -> Collector ingested? -> Query correct?
```

---

### 22.3 Disk Full

Likely causes:

- FileAppender without rolling,
- rolling without `totalSizeCap`,
- DEBUG enabled globally,
- retry loop logging too much,
- stack trace repeated repeatedly,
- collector failure causing local accumulation,
- audit/application logs mixed.

Mitigation:

- reduce log level,
- add rate limiting at source,
- fix rolling policy,
- compress/archive/delete according to policy,
- separate high-volume diagnostic logs from audit logs,
- build alert on log volume growth.

---

### 22.4 Application Latency due to Logging

Likely causes:

- synchronous file appender under heavy IO,
- network appender blocking,
- expensive JSON serialization,
- caller data enabled,
- large message construction,
- huge exception stack traces,
- slow disk,
- stdout backpressure in container.

Immediate checks:

- thread dump: threads blocked in appender/write path,
- profiler: logging layout/encoder hot,
- metrics: log volume spike,
- GC: allocation spike from logging,
- disk IO saturation.

---

### 22.5 Logs Without Context

Symptoms:

```text
ERROR Something failed
java.lang.RuntimeException: failed
```

No request ID, no user, no tenant, no operation, no dependency.

Root causes:

- no MDC setup,
- MDC not propagated to async execution,
- logs emitted outside request boundary,
- exception logged too far from context,
- event schema not standardized.

Fix:

- define mandatory context fields,
- setup context at boundary,
- clear context deterministically,
- propagate context across executor/reactor/message boundary,
- use structured key-value fields.

---

## 23. Designing a Production Logging Configuration

A good Logback config answers these questions:

1. What is the default level?
2. Which packages are noisier/quieter?
3. Where do logs go?
4. Is output structured or text?
5. How are trace/correlation IDs included?
6. How are exceptions represented?
7. How is log volume bounded?
8. What happens if destination is slow?
9. How is config changed across environments?
10. How do we know logging itself is failing?

A weak config focuses only on:

```text
"I want to see logs."
```

A strong config focuses on:

```text
"I want the right evidence, with bounded cost, queryable context, and predictable operational behavior."
```

---

## 24. Suggested Environment Strategy

| Environment | Root level | App output | Format | Notes |
|---|---:|---|---|---|
| local | INFO or DEBUG for app package | console | human-readable text | fast feedback |
| test | WARN/INFO | console | text | reduce noise |
| dev | INFO + selective DEBUG | stdout or rolling | text/JSON | debugging allowed |
| UAT | INFO | stdout | JSON preferred | production-like |
| prod | INFO/WARN + targeted temporary DEBUG | stdout/collector | JSON preferred | controlled volume |

Do not use production as “turn everything DEBUG” environment. Use targeted logger level and temporary window.

---

## 25. Temporary Debug Logging in Production

Sometimes you need temporary DEBUG.

Safe strategy:

1. choose one package/class,
2. define time window,
3. avoid root DEBUG,
4. ensure sensitive fields are not logged,
5. monitor log volume,
6. revert immediately,
7. document why it was enabled.

Bad:

```xml
<root level="DEBUG">
```

Better:

```xml
<logger name="com.example.payment.PaymentGatewayClient" level="DEBUG"/>
```

Even better if runtime logging level change is controlled by platform/admin endpoint and audited.

---

## 26. Logback in Java 8–25

### 26.1 Java 8

Common characteristics:

- legacy Spring Boot versions,
- SLF4J 1.x common,
- older Logback versions,
- classpath-based config,
- no JPMS,
- limited modern context features.

Watch for:

- old transitive dependencies,
- Log4j 1.x bridges,
- Commons Logging bridge,
- dependency conflicts,
- older container behavior.

### 26.2 Java 11/17

Common characteristics:

- modern Spring Boot 2.x/3.x split,
- Java 17 baseline for Spring Boot 3,
- container awareness much better than Java 8,
- SLF4J 2.x increasingly common.

Watch for:

- migration from javax to jakarta not directly logging-related but impacts stack traces/package names,
- dependency upgrade from SLF4J 1.x to 2.x,
- multiple providers during migration.

### 26.3 Java 21/25

Common characteristics:

- virtual threads,
- structured concurrency/scoped values in newer Java line,
- modern JFR,
- more attention to ThreadLocal/MDC behavior,
- containerized deployment default.

Watch for:

- MDC with virtual threads and async boundaries,
- log volume from high-concurrency virtual-thread workloads,
- thread name usefulness decreasing if many virtual threads,
- need for trace/correlation IDs over thread-centric debugging.

Important shift:

```text
Old mental model: thread name helps identify request.
Modern mental model: trace/correlation context identifies request; thread is just execution vehicle.
```

---

## 27. Pattern Design Examples

### 27.1 Human-Readable Local Pattern

```xml
<pattern>%d{HH:mm:ss.SSS} %-5level [%thread] %logger{30} - %msg%n%ex</pattern>
```

Good for local dev.

---

### 27.2 Production Text Pattern

```xml
<pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level service=${APP_NAME} env=${ENV} traceId=%X{trace_id:-} spanId=%X{span_id:-} correlationId=%X{correlation_id:-} [%thread] %logger{40} - %msg%n%ex</pattern>
```

Good for transitional production logging.

---

### 27.3 Avoid This Pattern in High-Throughput Production

```xml
<pattern>%d %-5level %class.%method:%line [%thread] - %msg%n%ex</pattern>
```

Reason:

- caller data expensive,
- line number unstable,
- not enough business context,
- hard to query.

---

## 28. Logback Configuration Review Checklist

Use this checklist during PR review.

### 28.1 Dependency

- [ ] Application has exactly one SLF4J backend/provider.
- [ ] No accidental `slf4j-simple` in production runtime.
- [ ] No legacy Log4j 1.x backend.
- [ ] Bridges do not create cycles.
- [ ] Spring Boot logging starter not duplicated manually.

### 28.2 Configuration Loading

- [ ] `logback-spring.xml` used for Spring Boot profile/property extensions.
- [ ] `logback-test.xml` used for test-specific config.
- [ ] No ambiguous multiple config files.
- [ ] Startup logs show expected config loaded.

### 28.3 Logger Levels

- [ ] Root level is not DEBUG/TRACE in production.
- [ ] No broad noisy package at DEBUG.
- [ ] Framework package levels are intentional.
- [ ] Temporary debug has owner and expiry.

### 28.4 Appenders

- [ ] Container apps log to stdout/stderr unless there is a strong reason not to.
- [ ] File appenders have rolling policy.
- [ ] Rolling policy has both history and total size cap.
- [ ] No duplicate appender routing unless intended.
- [ ] Error-only appender does not break alert semantics.

### 28.5 Pattern/Encoder

- [ ] Timestamp includes timezone/offset.
- [ ] Service/environment fields included.
- [ ] Trace/correlation IDs included.
- [ ] Exception format included.
- [ ] Caller data not enabled by default.
- [ ] Charset explicitly UTF-8.

### 28.6 Operational

- [ ] Disk usage bounded.
- [ ] Log volume monitored.
- [ ] Collector ingestion verified.
- [ ] Logs can be queried by service/env/trace/correlation.
- [ ] Sensitive data redaction policy exists.

---

## 29. Practical Lab 1 — Build a Minimal Logback App

### Goal

Understand event pipeline.

### Steps

1. Create small Java app with SLF4J + Logback.
2. Add `logback.xml`.
3. Create loggers in different packages:
   - `com.example.order`,
   - `com.example.payment`,
   - `com.example.common`.
4. Set different levels.
5. Observe which logs appear.
6. Add custom appender to `com.example.payment`.
7. Observe duplicate logs.
8. Set `additivity=false`.
9. Observe routing change.

### Expected learning

You should be able to explain:

```text
Why did this log appear here?
Why did this log disappear?
Why did this log appear twice?
```

---

## 30. Practical Lab 2 — Rolling File Under Load

### Goal

Understand rolling behavior.

### Steps

1. Configure `RollingFileAppender` with small `maxFileSize`, e.g. `1MB`.
2. Generate many logs.
3. Observe active file and archive files.
4. Set `maxHistory` and `totalSizeCap`.
5. Observe deletion behavior.
6. Change pattern to compress `.gz`.
7. Observe CPU/disk effect.

### Expected learning

You should be able to explain:

- active vs archived log file,
- index `%i`,
- date pattern `%d`,
- why `totalSizeCap` matters,
- how rolling can fail operationally.

---

## 31. Practical Lab 3 — MDC in Pattern

### Goal

Understand context enrichment.

### Steps

1. Add `%X{correlation_id:-}` to pattern.
2. Put MDC before service method.
3. Log from nested classes.
4. Clear MDC.
5. Reuse thread pool.
6. Intentionally forget cleanup.
7. Observe context leak.

### Expected learning

You should be able to explain:

```text
MDC is not business data storage.
MDC is diagnostic context attached to execution path.
Thread reuse makes cleanup mandatory.
```

---

## 32. Practical Lab 4 — Diagnose Misconfiguration

Create these bugs intentionally:

1. wrong appender name in `appender-ref`,
2. duplicate appender attachment,
3. root DEBUG,
4. file appender to non-writable directory,
5. missing `%ex`,
6. use `logback.xml` with Spring profile tag,
7. multiple backend dependencies.

For each:

- record symptom,
- inspect startup warning/status,
- fix root cause,
- write prevention rule.

---

## 33. Mental Model Summary

Logback is not “the XML file for logs”.

It is a runtime event pipeline:

```text
Logger call
  -> level check
  -> event creation
  -> context capture
  -> logger hierarchy
  -> additivity
  -> appender routing
  -> filter decision
  -> encoder/layout formatting
  -> destination write
  -> collector ingestion
  -> query/alert/dashboard
```

A top-tier engineer designs this pipeline with five constraints:

1. **evidence quality** — enough context to diagnose,
2. **cost bound** — no unbounded IO/storage/CPU/GC,
3. **operational predictability** — no surprise routing/drop/duplication,
4. **security** — no secrets/PII leakage,
5. **queryability** — logs are usable during incident pressure.

---

## 34. What You Should Be Able to Do After This Part

You should now be able to:

- explain Logback architecture,
- distinguish logger, appender, encoder, layout, filter,
- reason about logger hierarchy and additivity,
- design a console logging config for containers,
- design a rolling file config for VM/bare-metal,
- include MDC fields in pattern safely,
- identify duplicate/missing log causes,
- avoid caller-data performance traps,
- use `logback-spring.xml` correctly in Spring Boot,
- review Logback config in production PRs,
- diagnose common Logback startup/runtime issues.

---

## 35. References

- Logback Manual — Architecture: https://logback.qos.ch/manual/architecture.html
- Logback Manual — Configuration: https://logback.qos.ch/manual/configuration.html
- Logback Manual — Appenders: https://logback.qos.ch/manual/appenders.html
- Logback Manual — Encoders: https://logback.qos.ch/manual/encoders.html
- Logback Manual — Filters: https://logback.qos.ch/manual/filters.html
- Spring Boot Reference — Logging: https://docs.spring.io/spring-boot/reference/features/logging.html
- SLF4J Manual: https://www.slf4j.org/manual.html

---

# Status Seri

Seri belum selesai.

Progress saat ini:

- [x] Bagian 0 — Orientation, Scope, Mental Model, Learning Contract
- [x] Part 1 — Runtime Evidence, Not Just Logging
- [x] Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout
- [x] Part 3 — Log Semantics: What Should Be Logged and Why
- [x] Part 4 — SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging
- [x] Part 5 — Logback Deep Dive I: Architecture, Configuration, Appenders, Encoders
- [ ] Part 6 — Logback Deep Dive II: AsyncAppender, MDC, Sifting, Filtering, JSON
- [ ] Part 7 — Log4j2 Deep Dive I: Architecture, Configuration, Appenders, Layouts
- [ ] Part 8 — Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security
- [ ] Part 9 — Structured Logging: From Human Text to Machine-Queryable Events
- [ ] Part 10 — Context Propagation: MDC, ThreadLocal, Virtual Threads, Scoped Values
- [ ] Part 11 — Correlation ID, Trace ID, Request ID, Idempotency Key, Causality
- [ ] Part 12 — OpenTelemetry Mental Model: Signals, Resource, Scope, Context
- [ ] Part 13 — OpenTelemetry Java Agent: Zero-Code Instrumentation for Java 8+
- [ ] Part 14 — Manual Tracing: Span Design, Boundaries, Attributes, Events, Errors
- [ ] Part 15 — Metrics Engineering: RED, USE, JVM, Application, Business Metrics
- [ ] Part 16 — Logs + Traces + Metrics Correlation
- [ ] Part 17 — Logging Performance: Cost Model, Allocation, Locking, IO, Backpressure
- [ ] Part 18 — Secure Logging: PII, Secrets, Injection, Compliance, Auditability
- [ ] Part 19 — Exception Logging and Error Taxonomy
- [ ] Part 20 — JFR Deep Dive I: Java Flight Recorder Mental Model
- [ ] Part 21 — JFR Deep Dive II: Custom Events, Production Recording, JMC Analysis
- [ ] Part 22 — Profiling Mental Model: CPU Time, Wall Time, Allocation, Lock, IO
- [ ] Part 23 — async-profiler Deep Dive: CPU, Wall, Alloc, Lock, Native, Flame Graph
- [ ] Part 24 — JVM Troubleshooting Toolkit: jcmd, jstack, jmap, jstat, jhsdb, jinfo
- [ ] Part 25 — Thread Dump Analysis: Deadlock, Blocking, Starvation, Pool Exhaustion
- [ ] Part 26 — Heap Dump and Memory Troubleshooting: Leak, Retention, Allocation, Native Memory
- [ ] Part 27 — GC Observability and Troubleshooting Across Java 8–25
- [ ] Part 28 — Database and External Dependency Troubleshooting with Logs, Metrics, Traces
- [ ] Part 29 — Messaging, Batch, Scheduler, and Async Workflow Observability
- [ ] Part 30 — Troubleshooting Methodology: From Symptom to Root Cause
- [ ] Part 31 — Production Incident Playbooks for Java Systems
- [ ] Part 32 — Observability in Containers and Kubernetes
- [ ] Part 33 — Observability Governance: Standards, Cost, Cardinality, Retention, Ownership
- [ ] Part 34 — Building a Production-Grade Java Observability Starter Kit
- [ ] Part 35 — Capstone: Diagnose a Complex Java Production Incident End-to-End

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./04-slf4j-deep-dive-parameterized-fluent-marker-key-value-logging.md">⬅️ Part 4 — SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./06-logback-deep-dive-asyncappender-mdc-sifting-filtering-json.md">Part 6 — Logback Deep Dive II: AsyncAppender, MDC, Sifting, Filtering, JSON ➡️</a>
</div>
