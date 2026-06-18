# Part 34 — Building a Production-Grade Java Observability Starter Kit

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Part: `34`  
Target: Java 8 sampai Java 25  
Focus: reusable observability starter kit untuk Java services, library, batch, worker, dan Kubernetes workloads.

---

## 0. Tujuan Bagian Ini

Sampai Part 33, kita sudah membahas:

- logging architecture,
- SLF4J,
- Logback,
- Log4j2,
- structured logging,
- context propagation,
- OpenTelemetry,
- metrics,
- tracing,
- JFR,
- async-profiler,
- JVM troubleshooting tools,
- thread dump,
- heap dump,
- GC observability,
- dependency troubleshooting,
- messaging/batch/scheduler observability,
- incident playbook,
- Kubernetes observability,
- observability governance.

Part 34 menyatukan semuanya menjadi **starter kit**: sebuah blueprint teknis yang bisa dipakai ulang pada banyak Java service agar observability tidak bergantung pada kebiasaan masing-masing developer.

Targetnya bukan membuat satu dependency magic yang menyelesaikan semua hal. Targetnya adalah membuat **runtime evidence platform kecil** di level aplikasi.

Starter kit yang baik harus menjawab:

1. Bagaimana service mengeluarkan log structured yang konsisten?
2. Bagaimana semua log punya correlation context yang benar?
3. Bagaimana traces/metrics/logs saling terhubung?
4. Bagaimana exception dicatat secara aman dan berguna?
5. Bagaimana logging tidak membocorkan PII/secrets?
6. Bagaimana Java service siap di-debug saat incident?
7. Bagaimana konfigurasi observability bisa berbeda per environment tanpa mengubah code?
8. Bagaimana tim bisa melakukan review observability di PR?
9. Bagaimana kita menguji bahwa evidence benar-benar keluar?
10. Bagaimana starter kit tetap kompatibel dengan Java 8 sampai Java 25?

---

## 1. Mental Model: Starter Kit Sebagai Runtime Evidence Contract

Observability starter kit bukan sekadar kumpulan dependency:

```text
slf4j + logback + opentelemetry + micrometer + config
```

Itu hanya **library stack**.

Starter kit production-grade adalah kontrak:

```text
Application behavior
  -> normalized runtime context
  -> structured event schema
  -> trace/span correlation
  -> metrics dimensions
  -> redaction/security boundary
  -> diagnostic artifacts
  -> operational playbooks
```

Dengan kata lain:

```text
Starter kit = code conventions + runtime hooks + configuration + validation + runbook
```

Kalau hanya dependency, hasilnya sering seperti ini:

- tiap service punya field log beda-beda,
- trace id kadang ada kadang tidak,
- MDC bocor antar request,
- error log berulang 5 kali,
- metric label terlalu high-cardinality,
- token masuk log,
- JFR tidak bisa diambil saat incident,
- async worker kehilangan correlation id,
- Kubernetes pod restart tanpa artifact diagnosis,
- dashboard tidak bisa dipakai saat incident.

Starter kit harus membuat hal-hal penting menjadi **default**, bukan bergantung pada ingatan developer.

---

## 2. Design Principles

### 2.1 Evidence First

Setiap komponen starter kit harus menjawab pertanyaan diagnosis.

Contoh buruk:

```text
INFO Request completed
```

Contoh lebih baik:

```json
{
  "timestamp": "2026-06-18T10:15:31.123Z",
  "severity": "INFO",
  "service.name": "case-service",
  "event.name": "http.request.completed",
  "http.request.method": "POST",
  "url.path": "/cases/{caseId}/approve",
  "http.response.status_code": 200,
  "duration.ms": 84,
  "trace.id": "...",
  "span.id": "...",
  "correlation.id": "...",
  "case.id": "CASE-12345",
  "outcome": "success"
}
```

Yang kedua dapat menjawab:

- request mana?
- endpoint apa?
- hasilnya apa?
- latency berapa?
- trace mana?
- case mana?
- service mana?
- kapan terjadi?

### 2.2 Safe by Default

Starter kit harus mencegah data berbahaya masuk ke telemetry.

Default policy:

- jangan log authorization header,
- jangan log cookie,
- jangan log password/token/API key,
- jangan log full request body secara default,
- jangan log full response body secara default,
- jangan jadikan user-controlled value sebagai metric label,
- jangan jadikan raw email/NIK/passport/national id sebagai log field tanpa policy,
- jangan taruh secrets di baggage atau resource attributes.

### 2.3 Low-Cardinality by Default

Observability sering gagal bukan karena kurang data, tetapi karena data terlalu granular dan mahal.

Metric label buruk:

```text
http.server.request.duration{user_id="u-123",case_id="CASE-888",path="/cases/CASE-888/approve"}
```

Metric label lebih benar:

```text
http.server.request.duration{method="POST",route="/cases/{caseId}/approve",status_code="200"}
```

High-cardinality ID boleh masuk log dan trace attribute tertentu dengan batasan, tetapi hampir selalu tidak boleh masuk metric label.

### 2.4 Explicit Runtime Context

MDC berguna, tetapi jangan jadikan MDC sebagai source of truth internal.

Pattern yang lebih baik:

```text
RequestContext / RuntimeContext
  -> authoritative immutable context object
  -> copied into MDC for logging
  -> copied into OTel span attributes when needed
  -> passed across async boundaries explicitly or by wrapper
```

MDC adalah rendering context untuk log, bukan domain model.

### 2.5 Configurable Without Rebuild

Observability behavior harus bisa dikontrol lewat environment/config:

- log level,
- JSON/text output,
- OTel endpoint,
- sampling ratio,
- service metadata,
- redaction strictness,
- JFR enable/disable,
- async logging queue size,
- debug logging untuk package tertentu.

Production service tidak boleh butuh rebuild hanya untuk menaikkan log level.

### 2.6 Fail Predictably

Telemetry subsystem tidak boleh menjatuhkan core service secara diam-diam.

Pertanyaan desain:

- Jika log sink lambat, apakah app block atau drop?
- Jika OTel Collector down, apakah app tetap jalan?
- Jika metric exporter gagal, apakah request gagal?
- Jika async queue penuh, apa policy-nya?
- Jika redactor error, apakah field dibuang atau raw value bocor?

Rule umum:

```text
Diagnostic telemetry should degrade gracefully.
Security/audit telemetry may need stronger durability guarantees.
```

Diagnostic log boleh drop dalam kondisi ekstrem jika alternatifnya outage lebih parah. Audit event untuk regulatory transaction mungkin butuh durable path berbeda.

---

## 3. Recommended Repository Structure

Untuk organisasi yang punya banyak service, pisahkan starter kit menjadi beberapa module.

```text
observability-starter/
  README.md
  build.gradle.kts / pom.xml

  observability-core/
    src/main/java/.../RuntimeContext.java
    src/main/java/.../CorrelationIds.java
    src/main/java/.../ObservabilityConstants.java
    src/main/java/.../Redactor.java
    src/main/java/.../SafeLogValue.java
    src/main/java/.../TelemetryAttributes.java

  observability-logging-slf4j/
    src/main/java/.../DiagnosticContext.java
    src/main/java/.../MdcScope.java
    src/main/java/.../LogEvents.java
    src/main/java/.../SecureLogger.java
    src/main/resources/logback/default-logback.xml
    src/main/resources/log4j2/default-log4j2.xml

  observability-web-servlet/
    src/main/java/.../CorrelationFilter.java
    src/main/java/.../RequestLoggingFilter.java
    src/main/java/.../ErrorLoggingSupport.java

  observability-spring-boot/
    src/main/java/.../ObservabilityAutoConfiguration.java
    src/main/java/.../MdcTaskDecorator.java
    src/main/java/.../ObservationConfiguration.java
    src/main/resources/META-INF/spring/...

  observability-otel/
    src/main/java/.../TracingSupport.java
    src/main/java/.../SpanAttributes.java
    src/main/java/.../MetricsSupport.java
    src/main/resources/otel/default.properties

  observability-jfr/
    src/main/java/.../CaseTransitionJfrEvent.java
    src/main/java/.../ExternalCallJfrEvent.java
    src/main/java/.../JfrSupport.java

  observability-test/
    src/testFixtures/java/.../LogCapture.java
    src/testFixtures/java/.../TelemetryAssertions.java
    src/testFixtures/java/.../NoSecretInLogsAssert.java

  config-examples/
    logback-json.xml
    logback-local-text.xml
    log4j2-json.xml
    log4j2-local-text.xml
    otel-agent.env
    otel-collector.yaml
    kubernetes-deployment.yaml
    jfr-profile.jfc

  runbooks/
    high-cpu.md
    high-memory.md
    latency-spike.md
    missing-trace.md
    log-storm.md
```

### 3.1 Why Modular?

Jangan paksa semua service memakai semua komponen.

Contoh:

- plain Java library hanya butuh `observability-core`,
- servlet app butuh `observability-web-servlet`,
- Spring Boot app butuh `observability-spring-boot`,
- worker/batch butuh `observability-core`, `observability-logging-slf4j`, dan `observability-otel`,
- service high-performance bisa memilih Log4j2, bukan Logback.

Starter kit harus fleksibel, bukan monolith.

---

## 4. Dependency Baseline

### 4.1 Library Rule

Untuk reusable Java library:

```text
Use SLF4J API only.
Do not depend on Logback or Log4j2 Core.
Do not configure appenders.
Do not start telemetry exporters.
```

Library boleh melakukan:

```java
private static final Logger log = LoggerFactory.getLogger(MyLibrary.class);
```

Library tidak boleh membawa backend logging secara transitif.

### 4.2 Application Rule

Application memilih backend:

Option A:

```text
SLF4J API -> Logback
```

Option B:

```text
SLF4J API -> Log4j2
```

Jangan mencampur backend tanpa alasan jelas.

### 4.3 Spring Boot Rule

Spring Boot default memakai Logback jika `spring-boot-starter-logging` aktif. Jika ingin Log4j2, gunakan starter Log4j2 dan exclude default logging.

Maven example untuk Log4j2:

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

Gradle example:

```kotlin
configurations.all {
    exclude(group = "org.springframework.boot", module = "spring-boot-starter-logging")
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-log4j2")
}
```

### 4.4 Java 8 Compatibility

Untuk Java 8 baseline:

- hindari API Java 9+ di core module,
- jangan gunakan `var`, record, sealed class, virtual threads, scoped values,
- compile dengan `--release 8` jika memungkinkan,
- gunakan multi-release jar hanya jika benar-benar perlu,
- pisahkan modern module untuk Java 21+ bila memakai virtual threads/scoped values.

Pattern:

```text
observability-core-java8
observability-modern-java21
```

Jangan membuat semua service Java 8 gagal hanya karena starter kit memakai fitur Java 21.

---

## 5. Core Runtime Context

### 5.1 Context Fields

Starter kit harus punya model context minimal.

```java
public final class RuntimeContext {
    private final String traceId;
    private final String spanId;
    private final String correlationId;
    private final String requestId;
    private final String originRequestId;
    private final String userId;
    private final String tenantId;
    private final String caseId;
    private final String jobExecutionId;
    private final String messageId;

    // constructor/getters omitted
}
```

Namun hati-hati: jangan semua field selalu dipakai.

Context harus dibagi menjadi beberapa kelas jika domain besar:

```text
TechnicalContext
  traceId
  spanId
  correlationId
  requestId

ActorContext
  userId
  tenantId
  clientId

WorkflowContext
  caseId
  processInstanceId
  stateTransitionId

AsyncContext
  messageId
  eventId
  jobExecutionId
```

### 5.2 Constants

Jangan tulis key string tersebar di seluruh codebase.

```java
public final class TelemetryKeys {
    private TelemetryKeys() {}

    public static final String TRACE_ID = "trace.id";
    public static final String SPAN_ID = "span.id";
    public static final String CORRELATION_ID = "correlation.id";
    public static final String REQUEST_ID = "request.id";
    public static final String EVENT_NAME = "event.name";
    public static final String OUTCOME = "outcome";
    public static final String ERROR_TYPE = "error.type";
    public static final String ERROR_CODE = "error.code";
    public static final String DURATION_MS = "duration.ms";
}
```

### 5.3 Validation

Incoming correlation IDs harus divalidasi.

```java
public final class CorrelationIdValidator {
    private static final int MAX_LENGTH = 128;
    private static final Pattern SAFE = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");

    public static String normalizeOrNew(String incoming) {
        if (incoming == null || incoming.isBlank()) {
            return newId();
        }
        String trimmed = incoming.trim();
        if (trimmed.length() > MAX_LENGTH || !SAFE.matcher(trimmed).matches()) {
            return newId();
        }
        return trimmed;
    }

    private static String newId() {
        return UUID.randomUUID().toString();
    }
}
```

Kenapa tidak langsung percaya header?

Karena header berasal dari external caller dan bisa mengandung:

- newline injection,
- huge string,
- PII,
- malicious payload,
- format yang merusak JSON log,
- cardinality bomb.

---

## 6. MDC Scope Utility

MDC harus dipakai dengan scope agar tidak bocor.

### 6.1 Java 8 Compatible `MdcScope`

```java
public final class MdcScope implements AutoCloseable {
    private final Map<String, String> previous;

    private MdcScope(Map<String, String> values) {
        this.previous = MDC.getCopyOfContextMap();
        if (values != null) {
            values.forEach((k, v) -> {
                if (k != null && v != null) {
                    MDC.put(k, v);
                }
            });
        }
    }

    public static MdcScope with(Map<String, String> values) {
        return new MdcScope(values);
    }

    public static MdcScope withRuntimeContext(RuntimeContext context) {
        Map<String, String> values = new LinkedHashMap<>();
        put(values, "correlation.id", context.getCorrelationId());
        put(values, "request.id", context.getRequestId());
        put(values, "trace.id", context.getTraceId());
        put(values, "span.id", context.getSpanId());
        put(values, "tenant.id", context.getTenantId());
        put(values, "case.id", context.getCaseId());
        return new MdcScope(values);
    }

    private static void put(Map<String, String> map, String key, String value) {
        if (value != null && !value.isEmpty()) {
            map.put(key, value);
        }
    }

    @Override
    public void close() {
        if (previous == null || previous.isEmpty()) {
            MDC.clear();
        } else {
            MDC.setContextMap(previous);
        }
    }
}
```

Usage:

```java
try (MdcScope ignored = MdcScope.withRuntimeContext(ctx)) {
    log.info("case.approval.started caseId={} actorId={}", ctx.getCaseId(), ctx.getUserId());
    service.approve(ctx);
}
```

### 6.2 Important Invariant

Setiap `MDC.put()` harus punya matching `remove()` atau `clear()`. Lebih aman pakai scope daripada manual cleanup.

Buruk:

```java
MDC.put("correlation.id", id);
service.process();
```

Baik:

```java
try (MdcScope ignored = MdcScope.with(Map.of("correlation.id", id))) {
    service.process();
}
```

---

## 7. Servlet Correlation Filter

Untuk servlet/Spring MVC/Tomcat/Jetty/Undertow, starter kit harus punya filter.

```java
public final class CorrelationFilter implements Filter {
    private static final String CORRELATION_HEADER = "X-Correlation-Id";
    private static final String REQUEST_HEADER = "X-Request-Id";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String correlationId = CorrelationIdValidator.normalizeOrNew(
                request.getHeader(CORRELATION_HEADER)
        );
        String requestId = UUID.randomUUID().toString();

        response.setHeader(CORRELATION_HEADER, correlationId);
        response.setHeader(REQUEST_HEADER, requestId);

        RuntimeContext ctx = RuntimeContext.builder()
                .correlationId(correlationId)
                .requestId(requestId)
                .build();

        long startNanos = System.nanoTime();

        try (MdcScope ignored = MdcScope.withRuntimeContext(ctx)) {
            chain.doFilter(request, response);
        } finally {
            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);

            // Log completion after chain so status code is available.
            // In real implementation, use structured logging/key-value API.
            LoggerFactory.getLogger(CorrelationFilter.class).info(
                    "http.request.completed method={} route={} status={} durationMs={} correlationId={} requestId={}",
                    request.getMethod(),
                    safeRoute(request),
                    response.getStatus(),
                    durationMs,
                    correlationId,
                    requestId
            );
        }
    }

    private static String safeRoute(HttpServletRequest request) {
        Object pattern = request.getAttribute("org.springframework.web.servlet.HandlerMapping.bestMatchingPattern");
        if (pattern != null) {
            return pattern.toString();
        }
        return request.getRequestURI();
    }
}
```

### 7.1 Important Route Rule

Metric/log route field sebaiknya memakai template route:

```text
/cases/{caseId}/approve
```

bukan raw path:

```text
/cases/CASE-12345/approve
```

Raw path bisa membuat cardinality tinggi dan membocorkan data.

---

## 8. Request Logging Policy

Starter kit harus punya policy jelas.

### 8.1 What to Log for HTTP Request

Log pada request completion:

```text
event.name=http.request.completed
http.request.method
url.route
http.response.status_code
duration.ms
network.peer.address? optional, privacy-aware
user_agent.original? optional, high-cardinality caution
trace.id
span.id
correlation.id
request.id
outcome
error.type? if failed
```

### 8.2 What Not to Log by Default

Jangan log:

- full headers,
- `Authorization`,
- `Cookie`,
- `Set-Cookie`,
- full request body,
- full response body,
- uploaded files,
- raw credentials,
- raw token,
- raw session id,
- raw PII.

### 8.3 Debug Body Logging

Jika body logging diperlukan untuk DEV/UAT:

```text
disabled by default
allowlist endpoint
max body size
redaction first
never for binary/multipart
never for auth endpoints
never for production unless incident-approved
```

---

## 9. Structured Logging Baseline — Logback

### 9.1 Spring Boot 3.4+ Native Structured Logging

Spring Boot 3.4 memperkenalkan structured logging built-in dengan format ECS, GELF, dan Logstash. Untuk service Spring Boot modern, ini bisa menjadi baseline paling sederhana.

Example application properties:

```properties
spring.application.name=case-service
logging.structured.format.console=ecs
logging.structured.ecs.service.name=${spring.application.name}
logging.structured.ecs.service.version=${APP_VERSION:local}
logging.structured.ecs.service.environment=${APP_ENV:local}
```

Untuk Spring Boot 3.5+, cek opsi terbaru terkait structured stack trace formatting, karena beberapa behavior structured logging berkembang setelah 3.4.

### 9.2 Logback JSON with Encoder

Jika tidak memakai Spring Boot structured logging built-in, gunakan encoder JSON.

Conceptual `logback-spring.xml`:

```xml
<configuration>
  <springProperty scope="context" name="APP_NAME" source="spring.application.name" defaultValue="unknown-service"/>
  <property name="APP_ENV" value="${APP_ENV:-local}"/>

  <appender name="CONSOLE_JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LoggingEventCompositeJsonEncoder">
      <providers>
        <timestamp>
          <fieldName>@timestamp</fieldName>
        </timestamp>
        <logLevel>
          <fieldName>log.level</fieldName>
        </logLevel>
        <loggerName>
          <fieldName>log.logger</fieldName>
        </loggerName>
        <threadName>
          <fieldName>process.thread.name</fieldName>
        </threadName>
        <message>
          <fieldName>message</fieldName>
        </message>
        <mdc/>
        <arguments/>
        <stackTrace>
          <fieldName>error.stack_trace</fieldName>
        </stackTrace>
        <globalCustomFields>{"service.name":"${APP_NAME}","deployment.environment":"${APP_ENV}"}</globalCustomFields>
      </providers>
    </encoder>
  </appender>

  <root level="${LOG_LEVEL:-INFO}">
    <appender-ref ref="CONSOLE_JSON"/>
  </root>
</configuration>
```

### 9.3 Local Text Profile

Untuk local development, text log masih berguna.

```xml
<springProfile name="local">
  <appender name="CONSOLE_TEXT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
      <pattern>%d{HH:mm:ss.SSS} %-5level [%thread] [%X{correlation.id:-no-corr}] %logger{36} - %msg%n%ex</pattern>
    </encoder>
  </appender>

  <root level="INFO">
    <appender-ref ref="CONSOLE_TEXT"/>
  </root>
</springProfile>
```

### 9.4 Production Rule

Production container environment:

```text
prefer JSON to stdout/stderr
avoid rolling files in container unless required
avoid multiline text stack traces if ingestion cannot handle them
include trace/span/correlation fields
keep message human-readable but not the only source of data
```

---

## 10. Structured Logging Baseline — Log4j2

### 10.1 Log4j2 JSON Template Layout

Conceptual `log4j2.xml`:

```xml
<Configuration status="WARN">
  <Properties>
    <Property name="serviceName">${env:SERVICE_NAME:-unknown-service}</Property>
    <Property name="environment">${env:APP_ENV:-local}</Property>
  </Properties>

  <Appenders>
    <Console name="ConsoleJson" target="SYSTEM_OUT">
      <JsonTemplateLayout eventTemplateUri="classpath:LogstashJsonEventLayoutV1.json">
        <EventTemplateAdditionalField key="service.name" value="${serviceName}"/>
        <EventTemplateAdditionalField key="deployment.environment" value="${environment}"/>
      </JsonTemplateLayout>
    </Console>
  </Appenders>

  <Loggers>
    <Root level="${env:LOG_LEVEL:-INFO}">
      <AppenderRef ref="ConsoleJson"/>
    </Root>
  </Loggers>
</Configuration>
```

### 10.2 Async Logger Option

For high-throughput services:

```bash
-Dlog4j2.contextSelector=org.apache.logging.log4j.core.async.AsyncLoggerContextSelector
```

Design decision:

```text
Use AsyncLogger if logging path is high-volume and IO must not block request threads.
Use synchronous logger if audit durability and deterministic failure behavior are more important.
```

### 10.3 Security Hardening

Log4j2 security baseline:

- keep Log4j2 version current,
- avoid unnecessary network appenders,
- avoid untrusted config loading,
- avoid logging raw user input in message template,
- use structured fields with redaction,
- keep dependency scanning/SCA active,
- ensure no legacy Log4j 1.x remains.

---

## 11. Log Event Helper Library

### 11.1 Why Helper?

Tanpa helper, codebase akan punya ratusan variasi log:

```java
log.info("submit case {} by user {}", caseId, userId);
log.info("Case submitted, id=" + caseId);
log.info("event=case.submit caseId={} user={}", caseId, userId);
```

Starter kit bisa menyediakan event constants dan helper.

### 11.2 Event Constants

```java
public final class LogEventNames {
    private LogEventNames() {}

    public static final String HTTP_REQUEST_COMPLETED = "http.request.completed";
    public static final String DEPENDENCY_CALL_COMPLETED = "dependency.call.completed";
    public static final String CASE_STATE_TRANSITION = "case.state.transition";
    public static final String BATCH_JOB_COMPLETED = "batch.job.completed";
    public static final String MESSAGE_CONSUMED = "messaging.message.consumed";
    public static final String AUTHZ_DENIED = "security.authorization.denied";
}
```

### 11.3 SLF4J 2.x Fluent Logging

```java
log.atInfo()
   .setMessage("case state transitioned")
   .addKeyValue("event.name", LogEventNames.CASE_STATE_TRANSITION)
   .addKeyValue("case.id", caseId)
   .addKeyValue("state.from", from)
   .addKeyValue("state.to", to)
   .addKeyValue("transition.reason", reason)
   .addKeyValue("outcome", "success")
   .log();
```

### 11.4 Java 8 Friendly Alternative

If SLF4J 2.x fluent API is not available:

```java
log.info(
    "event.name={} case.id={} state.from={} state.to={} transition.reason={} outcome={} message=case state transitioned",
    LogEventNames.CASE_STATE_TRANSITION,
    caseId,
    from,
    to,
    reason,
    "success"
);
```

Namun ini kurang ideal untuk JSON structured logging kecuali backend encoder bisa mengambil arguments/key-value.

---

## 12. Secure Redaction Utility

### 12.1 Redactor Interface

```java
public interface Redactor {
    String redact(String key, String value);
}
```

### 12.2 Default Redactor

```java
public final class DefaultRedactor implements Redactor {
    private static final Set<String> SENSITIVE_KEYS = new HashSet<>(Arrays.asList(
            "password",
            "passwd",
            "secret",
            "token",
            "access_token",
            "refresh_token",
            "authorization",
            "cookie",
            "set-cookie",
            "api_key",
            "apikey",
            "client_secret"
    ));

    @Override
    public String redact(String key, String value) {
        if (value == null) {
            return null;
        }
        if (key != null && SENSITIVE_KEYS.contains(key.toLowerCase(Locale.ROOT))) {
            return "[REDACTED]";
        }
        return sanitizeControlChars(value);
    }

    private String sanitizeControlChars(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\n' || c == '\r' || c == '\t') {
                out.append(' ');
            } else if (Character.isISOControl(c)) {
                out.append('?');
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }
}
```

### 12.3 Safe Logging Wrapper

```java
public final class SafeLog {
    private final Redactor redactor;

    public SafeLog(Redactor redactor) {
        this.redactor = Objects.requireNonNull(redactor, "redactor");
    }

    public String value(String key, String rawValue) {
        return redactor.redact(key, rawValue);
    }
}
```

Usage:

```java
log.atInfo()
   .setMessage("external dependency request prepared")
   .addKeyValue("event.name", "dependency.request.prepared")
   .addKeyValue("dependency.name", "payment-gateway")
   .addKeyValue("request.header.authorization", safeLog.value("authorization", authHeader))
   .log();
```

Better: do not log authorization at all. Redaction is a safety net, not permission to log sensitive data.

---

## 13. Exception Logging Standard

Starter kit should provide an exception classifier.

```java
public enum ErrorCategory {
    CLIENT_INPUT,
    BUSINESS_RULE,
    AUTHENTICATION,
    AUTHORIZATION,
    STATE_CONFLICT,
    DEPENDENCY_TIMEOUT,
    DEPENDENCY_FAILURE,
    DATA_ACCESS,
    RESOURCE_EXHAUSTED,
    PROGRAMMING_DEFECT,
    UNKNOWN
}
```

```java
public final class ErrorDescriptor {
    private final ErrorCategory category;
    private final String errorCode;
    private final boolean expected;
    private final boolean retriable;
    private final int httpStatus;

    // constructor/getters omitted
}
```

Global handler pattern:

```java
ErrorDescriptor descriptor = classifier.classify(ex);

if (descriptor.isExpected()) {
    log.warn("request failed expected category={} errorCode={} outcome=failure", 
             descriptor.getCategory(), descriptor.getErrorCode());
} else {
    log.error("request failed unexpected category={} errorCode={} outcome=failure", 
              descriptor.getCategory(), descriptor.getErrorCode(), ex);
}
```

Rule:

```text
Expected business/client errors usually WARN or INFO without full stack trace.
Unexpected system/programming errors ERROR with stack trace once.
Dependency errors depend on retry/fallback/outcome.
```

---

## 14. OpenTelemetry Agent Baseline

### 14.1 Runtime Configuration

Example `otel-agent.env`:

```bash
OTEL_SERVICE_NAME=case-service
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod,service.version=1.24.7,service.namespace=aceas
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.10
```

For Java process:

```bash
java \
  -javaagent:/opt/opentelemetry-javaagent.jar \
  -jar app.jar
```

### 14.2 Kubernetes Deployment Snippet

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: example/case-service:1.24.7
          env:
            - name: JAVA_TOOL_OPTIONS
              value: "-javaagent:/otel/opentelemetry-javaagent.jar"
            - name: OTEL_SERVICE_NAME
              value: "case-service"
            - name: OTEL_RESOURCE_ATTRIBUTES
              value: "deployment.environment=prod,service.namespace=aceas,service.version=1.24.7"
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-collector.observability:4318"
            - name: OTEL_EXPORTER_OTLP_PROTOCOL
              value: "http/protobuf"
            - name: OTEL_PROPAGATORS
              value: "tracecontext,baggage"
```

### 14.3 Agent Rollout Strategy

Rollout should be staged:

```text
local -> DEV -> UAT -> production canary -> production partial -> production full
```

Checklist:

- service appears once in service map,
- resource attributes correct,
- traces contain inbound HTTP spans,
- outbound HTTP/JDBC spans appear,
- logs include trace/span id,
- metrics exported,
- overhead acceptable,
- no PII headers captured,
- collector failure does not break service,
- sampling behavior understood.

---

## 15. Manual Tracing Helper

Auto instrumentation is not enough for domain operations.

### 15.1 Tracing Support

```java
public final class TracingSupport {
    private final Tracer tracer;

    public TracingSupport(Tracer tracer) {
        this.tracer = Objects.requireNonNull(tracer, "tracer");
    }

    public <T> T inSpan(String spanName, Map<String, String> attributes, Callable<T> action) throws Exception {
        Span span = tracer.spanBuilder(spanName).startSpan();
        try (Scope ignored = span.makeCurrent()) {
            attributes.forEach(span::setAttribute);
            T result = action.call();
            span.setStatus(StatusCode.OK);
            return result;
        } catch (Exception ex) {
            span.recordException(ex);
            span.setStatus(StatusCode.ERROR, ex.getClass().getName());
            throw ex;
        } finally {
            span.end();
        }
    }
}
```

### 15.2 Domain Span Example

```java
tracing.inSpan(
    "case.approval.evaluate",
    Map.of(
        "case.module", "licensing",
        "rule.set", "approval-v3"
    ),
    () -> approvalEngine.evaluate(command)
);
```

Do not put high-cardinality or sensitive data blindly into span attributes.

Better:

```text
case.module=licensing
rule.set=approval-v3
outcome=approved
```

Careful:

```text
case.id=CASE-12345
user.email=person@example.com
raw.reason=long text from user
```

---

## 16. Metrics Support

### 16.1 Standard Application Metrics

Starter kit should define standard metric families:

```text
http.server.request.duration
http.server.request.count
application.operation.duration
application.operation.count
application.operation.error.count
dependency.call.duration
dependency.call.count
dependency.call.error.count
batch.job.duration
batch.job.records.processed
messaging.consumer.duration
messaging.consumer.error.count
```

### 16.2 Metric Label Policy

Allowed labels:

```text
service.name
operation
route
method
status_code
outcome
error.category
dependency.name
dependency.type
queue.name
job.name
state.from
state.to
```

Usually forbidden labels:

```text
user.id
case.id
request.id
trace.id
span.id
email
ip_address
raw_path
raw_query
exception.message
```

### 16.3 Operation Timer Helper

Conceptual API:

```java
public interface OperationMetrics {
    <T> T time(String operation, Map<String, String> labels, Callable<T> action) throws Exception;
}
```

Usage:

```java
operationMetrics.time(
    "case.approve",
    Map.of("module", "licensing"),
    () -> service.approve(command)
);
```

Metric helper should:

- validate label keys,
- reject high-cardinality labels,
- normalize outcome,
- record duration,
- record error category,
- not throw metric exporter exceptions into business path.

---

## 17. Context Propagation for Executors

### 17.1 Java 8 Executor Wrapper

```java
public final class ContextAwareExecutor implements Executor {
    private final Executor delegate;

    public ContextAwareExecutor(Executor delegate) {
        this.delegate = Objects.requireNonNull(delegate, "delegate");
    }

    @Override
    public void execute(Runnable command) {
        Map<String, String> capturedMdc = MDC.getCopyOfContextMap();
        Context otelContext = Context.current();

        delegate.execute(() -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try (Scope ignored = otelContext.makeCurrent()) {
                if (capturedMdc != null) {
                    MDC.setContextMap(capturedMdc);
                } else {
                    MDC.clear();
                }
                command.run();
            } finally {
                if (previous != null) {
                    MDC.setContextMap(previous);
                } else {
                    MDC.clear();
                }
            }
        });
    }
}
```

### 17.2 Spring TaskDecorator

```java
public final class MdcTaskDecorator implements TaskDecorator {
    @Override
    public Runnable decorate(Runnable runnable) {
        Map<String, String> captured = MDC.getCopyOfContextMap();
        Context otelContext = Context.current();

        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try (Scope ignored = otelContext.makeCurrent()) {
                if (captured != null) {
                    MDC.setContextMap(captured);
                } else {
                    MDC.clear();
                }
                runnable.run();
            } finally {
                if (previous != null) {
                    MDC.setContextMap(previous);
                } else {
                    MDC.clear();
                }
            }
        };
    }
}
```

### 17.3 Virtual Threads

With virtual threads, the cost profile changes, but context discipline still matters.

Principle:

```text
Virtual threads reduce thread scarcity.
They do not remove the need for correlation identity.
They do not make ThreadLocal/MDC automatically safe across async boundaries.
```

For Java 21+, consider:

- fewer shared thread pool reuse bugs,
- still clear MDC per task,
- avoid huge ThreadLocal values,
- consider explicit context or `ScopedValue` for immutable request context in Java 25+ designs,
- test logging context under structured concurrency.

---

## 18. JFR Starter Baseline

### 18.1 JVM Flags

Production-friendly baseline:

```bash
-XX:StartFlightRecording=filename=/tmp/app.jfr,settings=profile,dumponexit=true,maxage=2h,maxsize=512m
```

Alternative: start on demand with `jcmd`.

### 18.2 Diagnostic Commands

```bash
jcmd <pid> JFR.check
jcmd <pid> JFR.dump name=1 filename=/tmp/incident.jfr
jcmd <pid> JFR.stop name=1 filename=/tmp/final.jfr
```

### 18.3 Custom JFR Events

Starter kit can expose custom events for rare, important domain operations.

```java
@Name("com.example.CaseTransition")
@Label("Case Transition")
@Category({"Application", "Workflow"})
public final class CaseTransitionEvent extends Event {
    @Label("Module")
    public String module;

    @Label("From State")
    public String fromState;

    @Label("To State")
    public String toState;

    @Label("Outcome")
    public String outcome;
}
```

Usage:

```java
CaseTransitionEvent event = new CaseTransitionEvent();
event.module = "licensing";
event.fromState = from;
event.toState = to;
event.outcome = "success";
event.commit();
```

Do not put raw PII into JFR event fields.

---

## 19. Incident Dump Script

Starter kit should include scripts.

### 19.1 Linux Script

```bash
#!/usr/bin/env bash
set -euo pipefail

PID="${1:?usage: collect-java-diagnostics.sh <pid> <output-dir>}"
OUT="${2:?usage: collect-java-diagnostics.sh <pid> <output-dir>}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="$OUT/java-diagnostics-$PID-$TS"
mkdir -p "$DIR"

jcmd "$PID" VM.version > "$DIR/vm-version.txt" || true
jcmd "$PID" VM.flags > "$DIR/vm-flags.txt" || true
jcmd "$PID" VM.system_properties > "$DIR/system-properties.txt" || true
jcmd "$PID" Thread.print -l > "$DIR/thread-dump-1.txt" || true
sleep 5
jcmd "$PID" Thread.print -l > "$DIR/thread-dump-2.txt" || true
sleep 5
jcmd "$PID" Thread.print -l > "$DIR/thread-dump-3.txt" || true
jcmd "$PID" GC.heap_info > "$DIR/heap-info.txt" || true
jcmd "$PID" GC.class_histogram > "$DIR/class-histogram.txt" || true
jcmd "$PID" VM.native_memory summary > "$DIR/native-memory.txt" || true
jcmd "$PID" JFR.dump filename="$DIR/incident.jfr" || true

tar -czf "$DIR.tar.gz" -C "$OUT" "$(basename "$DIR")"
echo "$DIR.tar.gz"
```

### 19.2 Kubernetes Usage

```bash
kubectl exec -n app deploy/case-service -- jcmd 1 Thread.print -l
kubectl exec -n app deploy/case-service -- jcmd 1 JFR.dump filename=/tmp/incident.jfr
kubectl cp app/<pod-name>:/tmp/incident.jfr ./incident.jfr
```

### 19.3 Security Warning

Diagnostic artifacts may contain:

- headers,
- payload fragments,
- object values,
- user data,
- tokens,
- system properties,
- environment-derived values,
- internal topology.

Treat them as sensitive.

---

## 20. OpenTelemetry Collector Baseline

### 20.1 Why Collector?

Do not make every app know every vendor.

Better:

```text
Java app -> OTLP -> OTel Collector -> vendor/backend
```

Collector benefits:

- batching,
- retry,
- tail sampling,
- enrichment,
- filtering,
- redaction,
- routing,
- vendor decoupling.

### 20.2 Minimal Collector Config

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
  batch: {}
  resource:
    attributes:
      - key: telemetry.pipeline
        value: otel-collector
        action: upsert

exporters:
  debug:
    verbosity: basic
  otlp/vendor:
    endpoint: vendor-collector.example.com:4317
    tls:
      insecure: false

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp/vendor]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp/vendor]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp/vendor]
```

### 20.3 Kubernetes Metadata

In Kubernetes, add metadata enrichment carefully. Use stable metadata like namespace, pod, deployment, container, node when useful.

Avoid making every pod UID a primary dashboard dimension unless needed.

---

## 21. CI Validation

Starter kit should fail builds for common mistakes.

### 21.1 Dependency Validation

Rules:

- no Log4j 1.x,
- no multiple SLF4J providers,
- no `slf4j-simple` in production app,
- no `logback-classic` and `log4j-core` active together unless explicit bridge design,
- no vulnerable logging framework versions,
- no unwanted transitive backend in libraries.

### 21.2 Config Validation

Check:

- JSON log config exists for production,
- root level not DEBUG in production,
- async queue configured intentionally,
- rolling policy if file appender exists,
- service.name configured,
- OTel endpoint configured per environment,
- no request body logging enabled in production,
- redaction rules present,
- sampling documented.

### 21.3 Secret Leakage Tests

Test log output:

```java
@Test
void logsMustNotContainSecrets() {
    LogCapture capture = LogCapture.start();

    service.callWithHeader("Authorization", "Bearer secret-token-123");

    String logs = capture.text();
    assertThat(logs).doesNotContain("secret-token-123");
    assertThat(logs).doesNotContain("Bearer");
}
```

### 21.4 Context Propagation Tests

```java
@Test
void asyncTaskKeepsCorrelationId() throws Exception {
    MDC.put("correlation.id", "corr-123");
    Executor executor = new ContextAwareExecutor(Executors.newSingleThreadExecutor());

    CompletableFuture<String> future = new CompletableFuture<>();
    executor.execute(() -> future.complete(MDC.get("correlation.id")));

    assertThat(future.get()).isEqualTo("corr-123");
    MDC.clear();
}
```

---

## 22. Load Test Observability Validation

A starter kit is not proven until validated under load.

### 22.1 What to Test

During load test, validate:

- log volume per request,
- log ingestion lag,
- async log queue saturation,
- CPU overhead of logging,
- allocation overhead of structured logging,
- trace sampling volume,
- metrics cardinality,
- collector CPU/memory,
- dashboard usability,
- incident drill evidence completeness.

### 22.2 Load Test Scenarios

```text
normal traffic
error spike
dependency timeout
DB pool saturation
queue backlog
log storm
collector unavailable
high-cardinality input attack
large exception message
pod restart
```

### 22.3 Acceptance Criteria

Example:

```text
P95 latency overhead from observability < 5% under normal load
No request body/token appears in logs
Trace/log correlation available for sampled traces
Metric series count remains within budget
Collector outage does not fail business requests
JFR dump can be captured from pod within operational permission model
Diagnostic script works in DEV/UAT/prod-like environment
```

---

## 23. Kubernetes Deployment Blueprint

### 23.1 App Container Requirements

Container image should include or allow:

- JRE/JDK diagnostic tools depending on policy,
- access to `jcmd` or equivalent diagnostic path,
- OTel Java agent path,
- non-root user with enough permissions for self-diagnostics,
- writable temp directory for JFR dump,
- clear service metadata env vars.

Minimal deployment values:

```yaml
env:
  - name: SERVICE_NAME
    value: case-service
  - name: APP_ENV
    value: prod
  - name: APP_VERSION
    valueFrom:
      fieldRef:
        fieldPath: metadata.labels['app.kubernetes.io/version']
  - name: LOG_LEVEL
    value: INFO
  - name: OTEL_SERVICE_NAME
    value: case-service
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: http://otel-collector.observability:4318
```

### 23.2 Resource Settings

Observability adds overhead. Account for:

- structured JSON serialization CPU,
- async logging queue memory,
- OTel agent memory,
- exporter buffers,
- JFR buffer,
- profiler/JFR during incident,
- log volume to stdout.

Do not size pod memory so tightly that small telemetry overhead triggers OOMKilled.

---

## 24. Environment Profiles

### 24.1 Local

```text
text logs allowed
DEBUG package-specific allowed
OTel optional or local collector
sampling can be always_on
JFR optional
body logging allowed only with fake data
```

### 24.2 DEV

```text
JSON logs preferred
OTel enabled
higher sampling allowed
redaction enabled
body logging restricted
JFR on-demand
```

### 24.3 UAT

```text
production-like JSON logs
production-like redaction
production-like sampling or slightly higher
load test telemetry validation
no real secrets in logs
```

### 24.4 Production

```text
JSON logs
INFO default
DEBUG only temporary and scoped
redaction strict
trace sampling controlled
metrics cardinality budget enforced
JFR continuous/on-demand policy
diagnostic artifact access controlled
```

---

## 25. Starter Kit Public API Design

A good starter kit API should be boring.

### 25.1 Avoid Over-Abstraction

Bad:

```java
observability.emitMagicEverything(...)
```

Better:

```java
try (MdcScope ignored = MdcScope.withRuntimeContext(ctx)) {
    tracing.inSpan("case.approve", attrs, () -> {
        return metrics.time("case.approve", labels, () -> service.approve(command));
    });
}
```

Developer should still understand what is happening.

### 25.2 Suggested Public API

```text
RuntimeContext
RuntimeContextHolder? optional
MdcScope
CorrelationIdValidator
TelemetryKeys
LogEventNames
Redactor
SafeLog
ErrorClassifier
TracingSupport
OperationMetrics
ContextAwareExecutor
JfrEvents
```

### 25.3 Avoid Hidden Global State

Use global state carefully.

Bad:

```java
RuntimeContextHolder.set(ctx); // never cleared reliably
```

Better:

```java
try (RuntimeContextScope ignored = RuntimeContextScope.open(ctx)) {
    service.process();
}
```

For Java 25+, immutable scoped context can be modeled with `ScopedValue`, but maintain Java 8-compatible path separately.

---

## 26. Starter Kit Review Checklist

### 26.1 Logging

- [ ] Logs are structured in production.
- [ ] Every request completion log has correlation id.
- [ ] Trace/span ids are present where available.
- [ ] Log level defaults to INFO.
- [ ] DEBUG can be enabled per package.
- [ ] Stack traces are logged once.
- [ ] No duplicate appenders.
- [ ] No raw request/response body by default.
- [ ] PII/secrets redaction exists.
- [ ] Logs are single-line JSON in containers.

### 26.2 Tracing

- [ ] OTel Java agent can be enabled without code change.
- [ ] Service name and version are set.
- [ ] Propagators are configured.
- [ ] Sampling is documented.
- [ ] Manual spans exist for important domain operations.
- [ ] Span names are low-cardinality.
- [ ] Error status and exceptions are recorded properly.

### 26.3 Metrics

- [ ] HTTP RED metrics available.
- [ ] JVM metrics available.
- [ ] DB pool metrics available.
- [ ] Dependency metrics available.
- [ ] Business operation metrics available.
- [ ] Metric labels are governed.
- [ ] No request/case/user IDs in labels.
- [ ] SLO dashboard exists.

### 26.4 Diagnostics

- [ ] `jcmd` or diagnostic equivalent available.
- [ ] JFR can be started/dumped.
- [ ] Thread dump can be collected.
- [ ] Heap dump policy is documented.
- [ ] Diagnostic artifacts are treated as sensitive.
- [ ] Kubernetes access path is documented.

### 26.5 Governance

- [ ] Service metadata standard exists.
- [ ] Log schema standard exists.
- [ ] Metric naming standard exists.
- [ ] Trace naming standard exists.
- [ ] Ownership labels exist.
- [ ] Runbooks exist for common incidents.
- [ ] CI validates critical rules.

---

## 27. Common Anti-Patterns

### 27.1 Starter Kit as Dependency Dump

Problem:

```text
Add 20 observability dependencies and call it done.
```

Why bad:

- no schema,
- no context discipline,
- no redaction,
- no troubleshooting path,
- no governance.

### 27.2 Only Auto-Instrumentation

Auto-instrumentation captures framework boundaries but cannot understand your domain decisions.

It can show:

```text
POST /cases/{id}/approve -> JDBC query -> 500
```

It cannot explain:

```text
approval rule version v3 rejected because license category is suspended
```

Manual spans/log events are needed for domain transitions.

### 27.3 Every Domain ID Everywhere

Putting `case.id`, `user.id`, `request.id`, and `trace.id` into every metric label will destroy metrics storage and dashboard usability.

Use:

```text
logs/traces for high-cardinality diagnosis
metrics for aggregate behavior
```

### 27.4 Logging Bodies by Default

This creates:

- PII leakage,
- token leakage,
- huge log volume,
- ingestion cost spike,
- legal/compliance risk,
- incident artifacts too sensitive to share.

### 27.5 No Test for Observability

If observability is not tested, it decays.

Test:

- context propagation,
- redaction,
- error classification,
- structured field presence,
- route templating,
- metric labels.

---

## 28. Reference Implementation Roadmap

### Phase 1 — Minimal Baseline

Deliver:

- `RuntimeContext`,
- `MdcScope`,
- correlation filter,
- structured logging config,
- redactor,
- error classifier,
- OTel agent env template,
- basic runbook.

### Phase 2 — Production Hardening

Deliver:

- executor context propagation,
- metrics helper,
- tracing helper,
- JFR config,
- diagnostic scripts,
- Kubernetes snippets,
- CI checks.

### Phase 3 — Governance Integration

Deliver:

- schema registry,
- telemetry PR checklist,
- dashboard templates,
- alert/runbook ownership,
- cost/cardinality budget,
- sampling policy.

### Phase 4 — Advanced Domain Observability

Deliver:

- workflow/state transition event library,
- async messaging propagation,
- batch/job observability,
- domain JFR events,
- incident drill dataset.

---

## 29. Mini Case Study: Service With Bad Observability

Symptoms:

```text
Users report intermittent approval failures.
Dashboard shows 500 errors but no clear cause.
Logs contain stack traces but no case id or correlation id.
Traces show JDBC errors but not which business transition failed.
Metrics show error rate by endpoint but not module/workflow.
```

Root observability problems:

- missing correlation ID,
- raw path instead of route,
- error logged at DAO and controller multiple times,
- no domain event for state transition,
- no DB pool metrics,
- no exception category,
- no trace-log correlation,
- no incident dump runbook.

After starter kit:

```text
Metric: http.server.request.duration{route=/cases/{caseId}/approve,status=500}
Trace: case.approval.evaluate -> case.state.transition -> jdbc.execute
Log: event.name=case.state.transition outcome=failure error.category=STATE_CONFLICT correlation.id=...
JFR: lock contention/DB wait visible if needed
Thread dump: confirms worker threads waiting on DB pool
```

Now diagnosis becomes:

```text
Approval failures affect only licensing module.
Failures correlate with state transition from PENDING_REVIEW to APPROVED.
Error category is STATE_CONFLICT, not DB outage.
Recent deploy changed transition guard rule.
Rollback rule config mitigates issue.
Permanent fix: add explicit stale-state handling and test.
```

---

## 30. Final Production Blueprint

A production-grade Java observability starter kit should ship:

```text
1. core runtime context model
2. correlation ID validation/generation
3. MDC scope utility
4. servlet/web filters
5. async executor context propagation
6. structured logging config for Logback
7. structured logging config for Log4j2
8. secure redaction policy
9. exception/error classifier
10. OpenTelemetry agent configuration
11. manual tracing helper
12. metrics helper and label policy
13. JFR configuration and custom event pattern
14. diagnostic scripts
15. Kubernetes deployment snippets
16. CI validation rules
17. test utilities
18. dashboards/runbook templates
19. governance checklist
20. incident drill scenario
```

This is the difference between:

```text
"We installed observability tools"
```

and:

```text
"Every service emits reliable, safe, correlated, queryable runtime evidence that helps us diagnose production behavior under pressure."
```

---

## 31. Practical Labs

### Lab 1 — Build Minimal Runtime Context

Implement:

- `RuntimeContext`,
- `TelemetryKeys`,
- `CorrelationIdValidator`,
- `MdcScope`.

Acceptance criteria:

- context fields can be added to MDC,
- previous MDC restored after scope,
- invalid correlation header replaced,
- control characters sanitized.

### Lab 2 — Add Servlet Correlation Filter

Implement:

- incoming correlation header extraction,
- request ID generation,
- response header propagation,
- request completion log,
- route template extraction.

Acceptance criteria:

- every request completion log has `correlation.id`,
- response includes `X-Correlation-Id`,
- raw path ID not used as metric route.

### Lab 3 — Add Structured Logging

Implement either:

- Spring Boot 3.4+ structured logging, or
- Logback JSON encoder, or
- Log4j2 JsonTemplateLayout.

Acceptance criteria:

- logs are valid single-line JSON,
- service name exists,
- environment exists,
- trace id appears when OTel active,
- exception stack trace is represented safely.

### Lab 4 — Add Redaction Test

Create a test that logs:

- password,
- bearer token,
- cookie,
- CRLF payload.

Acceptance criteria:

- sensitive values do not appear,
- control characters do not forge a new log line,
- redaction does not throw.

### Lab 5 — Add OTel Agent

Run the service with:

```bash
-javaagent:/path/opentelemetry-javaagent.jar
```

Acceptance criteria:

- service appears in backend/collector,
- inbound HTTP trace appears,
- outbound dependency spans appear,
- logs contain trace/span id,
- service metadata correct.

### Lab 6 — Add JFR Incident Dump

Enable JFR or start recording using `jcmd`.

Acceptance criteria:

- JFR recording can be dumped,
- artifact can be copied from container,
- runbook documents where it is stored,
- artifact is treated as sensitive.

### Lab 7 — Load Test Observability

Generate:

- normal traffic,
- 5xx spike,
- dependency timeout,
- log storm.

Acceptance criteria:

- telemetry overhead measured,
- metric series count checked,
- log volume checked,
- trace sampling checked,
- collector failure simulated.

---

## 32. Closing Mental Model

A top-tier engineer does not ask only:

```text
How do I log this?
```

They ask:

```text
When this fails in production at 2 AM, what evidence will exist?
Will it be correlated?
Will it be safe?
Will it be cheap enough to keep?
Will it be precise enough to diagnose?
Will another engineer understand it without me?
```

That is the point of the starter kit.

The starter kit turns observability from personal craftsmanship into an engineering capability.

---

## References

- OpenTelemetry Java configuration: https://opentelemetry.io/docs/languages/java/configuration/
- OpenTelemetry Java agent configuration: https://opentelemetry.io/docs/zero-code/java/agent/configuration/
- OpenTelemetry general SDK configuration: https://opentelemetry.io/docs/languages/sdk-configuration/general/
- Spring Boot logging reference: https://docs.spring.io/spring-boot/reference/features/logging.html
- Spring Boot 3.4 structured logging announcement: https://spring.io/blog/2024/08/23/structured-logging-in-spring-boot-3-4
- Logback MDC manual: https://logback.qos.ch/manual/mdc.html
- Logback appenders manual: https://logback.qos.ch/manual/appenders.html
- Log4j2 JSON Template Layout: https://logging.apache.org/log4j/2.x/manual/json-template-layout.html
- Log4j2 asynchronous loggers: https://logging.apache.org/log4j/2.x/manual/async.html


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 33 — Observability Governance: Standards, Cost, Cardinality, Retention, Ownership](./33-observability-governance-standards-cost-cardinality-retention-ownership.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 35 — Capstone: Diagnose a Complex Java Production Incident End-to-End](./35-capstone-diagnose-complex-java-production-incident-end-to-end.md)
