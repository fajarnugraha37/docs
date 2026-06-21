# Part 25 — Spring Boot Actuator, Micrometer, Observability, and Runtime Operations

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `25-spring-boot-actuator-micrometer-observability.md`  
> Target pembaca: engineer Spring advanced yang ingin memahami observability sebagai bagian dari runtime contract, bukan sekadar menambah `/actuator/prometheus`.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 24, kita sudah membedah Spring dari sisi:

1. container dan bean graph,
2. dependency resolution,
3. lifecycle dan extension points,
4. configuration dan auto-configuration,
5. startup/failure analysis,
6. AOP/proxy,
7. transaction,
8. Web MVC/WebFlux,
9. HTTP clients,
10. validation/error handling,
11. security,
12. cache,
13. async/event/scheduling,
14. virtual threads,
15. messaging,
16. Spring Integration,
17. Spring Batch.

Part ini menjawab pertanyaan berikut:

> Setelah aplikasi Spring berjalan di production, bagaimana kita tahu apakah aplikasi sehat, siap menerima traffic, lambat, overload, error, stuck, salah konfigurasi, atau sedang diam-diam merusak correctness?

Jawaban Spring modern adalah kombinasi:

```text
Actuator       -> operational endpoint surface
Micrometer     -> metrics facade
Observation    -> unified instrumentation abstraction
Tracing        -> request causality across boundaries
Health         -> runtime dependency status
Availability   -> liveness/readiness lifecycle signal
Audit/events   -> selected security and runtime event surface
```

Spring Boot Actuator menyediakan fitur production-ready seperti endpoint HTTP/JMX, auditing, health, metrics, dan monitoring untuk aplikasi Spring Boot. Dokumentasi resmi Boot menyatakan Actuator dapat dipakai untuk memonitor dan mengelola aplikasi saat didorong ke production melalui HTTP endpoint atau JMX. 

---

## 1. Mental Model Utama

Observability Spring bukan hanya “pasang Prometheus”.

Mental model yang lebih tepat:

```text
Spring Application
   |
   |-- exposes runtime state
   |       -> Actuator endpoints
   |
   |-- reports health and availability
   |       -> HealthIndicator
   |       -> LivenessState
   |       -> ReadinessState
   |
   |-- emits measurements
   |       -> Micrometer MeterRegistry
   |       -> Counter / Gauge / Timer / DistributionSummary
   |
   |-- wraps operations as observations
   |       -> ObservationRegistry
   |       -> ObservationHandler
   |       -> metrics/traces/log correlation
   |
   |-- propagates diagnostic context
   |       -> trace id
   |       -> span id
   |       -> correlation id
   |       -> MDC
   |
   |-- integrates with platform
           -> Prometheus
           -> OpenTelemetry
           -> Grafana
           -> Datadog
           -> New Relic
           -> CloudWatch
           -> Kubernetes probes
```

Observability yang matang harus menjawab 5 pertanyaan operasional:

1. **Apakah proses hidup?**
2. **Apakah instance siap menerima traffic?**
3. **Apakah dependency penting tersedia?**
4. **Apakah request/command/job berjalan dalam latency dan error budget yang benar?**
5. **Jika gagal, failure terjadi di boundary mana?**

---

## 2. Monitoring vs Observability

Monitoring biasanya menjawab:

```text
Apakah sesuatu yang sudah kita tahu sedang bermasalah?
```

Observability menjawab:

```text
Bisakah kita memahami masalah baru yang belum kita prediksi hanya dari sinyal eksternal?
```

Dalam Spring production system, monitoring sederhana mungkin cukup untuk:

```text
CPU > 90%
memory tinggi
endpoint /health DOWN
HTTP 5xx naik
```

Tetapi observability diperlukan untuk kasus seperti:

```text
kenapa endpoint /applications/search lambat hanya untuk tenant tertentu?
kenapa Kafka consumer lag naik setelah deployment?
kenapa thread virtual banyak tetapi throughput tidak naik?
kenapa database pool habis padahal CPU rendah?
kenapa retry outbound membuat traffic ke dependency meledak?
kenapa batch job stuck di step tertentu?
kenapa readiness flapping setiap koneksi Redis lambat?
```

Spring membantu memberi instrumentation default, tetapi engineer tetap harus mendesain:

1. **signal mana yang penting,**
2. **tag mana yang aman,**
3. **endpoint mana yang boleh diekspos,**
4. **health mana yang menentukan readiness,**
5. **metric mana yang menjadi SLO,**
6. **trace mana yang perlu menembus service boundary,**
7. **log mana yang harus correlated,**
8. **alert mana yang actionable.**

---

## 3. Actuator sebagai Operational Surface

### 3.1 Apa Itu Actuator?

Actuator adalah modul Spring Boot untuk mengekspos informasi runtime aplikasi.

Contoh endpoint umum:

```text
/actuator/health
/actuator/info
/actuator/metrics
/actuator/prometheus
/actuator/env
/actuator/configprops
/actuator/beans
/actuator/mappings
/actuator/threaddump
/actuator/heapdump
/actuator/loggers
/actuator/startup
```

Namun jangan salah: Actuator bukan dashboard final.

Actuator adalah **instrumentation and management surface**.

Biasanya pipeline-nya:

```text
Spring Boot Actuator
   -> exposes endpoint
   -> Prometheus scrapes metrics
   -> Grafana visualizes
   -> Alertmanager alerts
   -> OpenTelemetry exports traces
   -> log platform stores logs
```

### 3.2 Dependency

Spring Boot classic:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

Gradle:

```groovy
implementation "org.springframework.boot:spring-boot-starter-actuator"
```

Untuk Prometheus:

```groovy
runtimeOnly "io.micrometer:micrometer-registry-prometheus"
```

Untuk OTLP/OpenTelemetry tergantung versi dan setup:

```groovy
runtimeOnly "io.micrometer:micrometer-registry-otlp"
runtimeOnly "io.micrometer:micrometer-tracing-bridge-otel"
```

---

## 4. Endpoint Exposure: Enabled vs Exposed

Salah satu kesalahan umum adalah mengira semua endpoint Actuator otomatis tersedia.

Spring Boot membedakan:

```text
enabled  -> endpoint aktif di application context
exposed  -> endpoint tersedia melalui HTTP/JMX
```

Contoh konfigurasi:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
```

Untuk production, jangan gunakan ini secara sembarangan:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: "*"
```

Karena endpoint seperti:

```text
/env
/configprops
/beans
/mappings
/threaddump
/heapdump
/loggers
```

dapat mengandung informasi sensitif atau memberi kemampuan operasional yang berisiko.

### 4.1 Rule of Thumb Exposure

| Endpoint | Production Public? | Internal Authenticated? | Catatan |
|---|---:|---:|---|
| `/health` | kadang | ya | untuk load balancer/probe, detail harus dibatasi |
| `/health/liveness` | ya, via platform | ya | sinyal proses hidup |
| `/health/readiness` | ya, via platform | ya | sinyal siap menerima traffic |
| `/info` | hati-hati | ya | jangan bocorkan commit/env sensitif |
| `/metrics` | tidak public | ya | internal only |
| `/prometheus` | tidak public | ya | scrape network harus dikontrol |
| `/env` | tidak | sangat terbatas | sensitif |
| `/configprops` | tidak | sangat terbatas | sensitif |
| `/beans` | tidak | terbatas | bocor struktur aplikasi |
| `/mappings` | tidak | terbatas | bocor endpoint |
| `/threaddump` | tidak | incident-only | bisa sensitif |
| `/heapdump` | tidak | sangat terbatas | sangat sensitif |
| `/loggers` | tidak | terbatas | bisa mengubah log level runtime |

### 4.2 Dedicated Management Port

Untuk production serius, pertimbangkan management port terpisah:

```yaml
management:
  server:
    port: 9001
```

Dengan demikian:

```text
application traffic -> port 8080
management traffic  -> port 9001
```

Keuntungannya:

1. network policy lebih jelas,
2. actuator tidak bercampur dengan public API,
3. scrape/probe path bisa dibatasi,
4. security chain bisa dibedakan,
5. operational access bisa diaudit.

Risikonya:

1. konfigurasi container/service lebih kompleks,
2. readiness/liveness path harus diarahkan benar,
3. firewall/security group harus disesuaikan,
4. service mesh/gateway harus tahu port management.

---

## 5. Health Endpoint: Status Bukan Diagnosis Lengkap

### 5.1 HealthIndicator

Actuator health dibangun dari `HealthIndicator`.

Contoh sederhana:

```java
@Component
public class PaymentGatewayHealthIndicator implements HealthIndicator {

    private final PaymentGatewayClient client;

    public PaymentGatewayHealthIndicator(PaymentGatewayClient client) {
        this.client = client;
    }

    @Override
    public Health health() {
        try {
            PaymentGatewayStatus status = client.ping();

            if (status.available()) {
                return Health.up()
                        .withDetail("provider", "payment-gateway")
                        .withDetail("mode", status.mode())
                        .build();
            }

            return Health.down()
                    .withDetail("provider", "payment-gateway")
                    .withDetail("reason", status.reason())
                    .build();

        } catch (Exception ex) {
            return Health.down(ex)
                    .withDetail("provider", "payment-gateway")
                    .build();
        }
    }
}
```

Tetapi health check harus didesain hati-hati.

Health check yang buruk bisa membuat aplikasi terlihat tidak sehat padahal masalahnya hanya dependency opsional.

### 5.2 Health Tidak Sama dengan Semua Dependency Harus UP

Misalnya sistem punya dependency:

```text
database primary        -> critical
Redis cache             -> degraded acceptable
email provider          -> optional for normal read API
external reporting API  -> optional background feature
Kafka producer          -> critical only for write command
```

Jika semua dependency dijadikan health critical, maka satu email provider lambat dapat membuat seluruh pod keluar dari load balancer.

Itu bisa benar atau salah tergantung domain.

### 5.3 Health Group

Spring Boot mendukung health group untuk membedakan sinyal.

Contoh:

```yaml
management:
  endpoint:
    health:
      show-details: when_authorized
      group:
        readiness:
          include: readinessState,db,rabbit
        liveness:
          include: livenessState
        dependencies:
          include: db,redis,rabbit,kafka,externalPayment
```

Dengan model ini:

```text
/actuator/health/liveness
    -> apakah proses masih hidup?

/actuator/health/readiness
    -> apakah instance boleh menerima traffic?

/actuator/health/dependencies
    -> detail dependency untuk operator
```

### 5.4 Liveness vs Readiness

Liveness:

```text
Apakah proses harus dipertahankan atau direstart?
```

Readiness:

```text
Apakah instance siap menerima traffic?
```

Kesalahan fatal:

```text
dependency external lambat -> liveness DOWN -> Kubernetes restart pod terus-menerus
```

Padahal jika dependency eksternal sedang bermasalah, restart aplikasi tidak memperbaiki dependency tersebut. Itu justru memperparah incident.

Prinsip:

```text
Liveness should not depend on most external systems.
Readiness may depend on critical local ability to serve traffic.
```

### 5.5 Startup Probe

Untuk aplikasi yang startup-nya lama:

```text
large Spring context
migration check
cache warmup
large model loading
native image init
slow secret retrieval
```

Kubernetes startup probe bisa mencegah liveness membunuh aplikasi sebelum siap.

Spring memberi liveness/readiness state, tetapi platform configuration tetap perlu benar.

---

## 6. Availability State dalam Spring Boot

Spring Boot mengenal application availability.

Sinyal utama:

```text
LivenessState
ReadinessState
```

Secara lifecycle:

```text
starting
   -> liveness may become correct
   -> readiness still refusing traffic

application ready
   -> readiness ACCEPTING_TRAFFIC

shutdown
   -> readiness REFUSING_TRAFFIC
   -> graceful shutdown begins
```

Mental model:

```text
readiness = traffic admission signal
liveness  = process recovery signal
health    = dependency/status composition signal
```

Jangan mencampur ketiganya secara naif.

---

## 7. Micrometer: Metrics Facade

Micrometer adalah facade metrics untuk JVM/app instrumentation.

Analoginya:

```text
SLF4J       -> logging facade
Micrometer  -> metrics/observability facade
```

Aplikasi tidak perlu tahu backend metrics final:

```text
Prometheus
Datadog
New Relic
OTLP
CloudWatch
Graphite
JMX
```

Aplikasi cukup memakai API Micrometer, lalu registry menentukan tujuan export.

### 7.1 MeterRegistry

`MeterRegistry` adalah pusat registrasi metrics.

```java
@Service
public class ApplicationCommandMetrics {

    private final Counter submittedCounter;
    private final Timer processingTimer;

    public ApplicationCommandMetrics(MeterRegistry registry) {
        this.submittedCounter = Counter.builder("case.command.submitted")
                .description("Number of submitted case commands")
                .tag("module", "case")
                .register(registry);

        this.processingTimer = Timer.builder("case.command.processing")
                .description("Time spent processing case commands")
                .tag("module", "case")
                .publishPercentileHistogram()
                .register(registry);
    }

    public void markSubmitted() {
        submittedCounter.increment();
    }

    public <T> T recordProcessing(Supplier<T> supplier) {
        return processingTimer.record(supplier);
    }
}
```

### 7.2 Core Meter Types

| Meter | Untuk Apa | Contoh |
|---|---|---|
| Counter | nilai yang hanya naik | total request, total command, total error |
| Gauge | nilai saat ini | queue size, active session, cache entries |
| Timer | durasi + count | HTTP latency, DB query, command processing |
| DistributionSummary | distribusi ukuran | payload size, batch size |
| LongTaskTimer | operasi panjang aktif | batch step, report generation |
| FunctionCounter | counter dari object existing | cache hit count |
| FunctionTimer | timer dari object existing | external library metrics |

### 7.3 Counter

Counter cocok untuk event yang monoton naik:

```java
Counter.builder("case.approval.total")
        .description("Total approved cases")
        .tag("module", "case")
        .register(registry)
        .increment();
```

Jangan pakai counter untuk nilai yang bisa naik-turun seperti active users. Untuk itu gunakan gauge.

### 7.4 Gauge

Gauge merepresentasikan nilai saat ini.

```java
@Component
public class QueueMetrics {

    private final BlockingQueue<CaseCommand> queue;

    public QueueMetrics(MeterRegistry registry, BlockingQueue<CaseCommand> queue) {
        this.queue = queue;

        Gauge.builder("case.command.queue.size", queue, BlockingQueue::size)
                .description("Current case command queue size")
                .register(registry);
    }
}
```

Risiko gauge:

1. object yang diobservasi bisa garbage collected jika tidak direferensikan,
2. nilai gauge bisa mahal dihitung,
3. gauge dengan tag dinamis bisa menyebabkan cardinality explosion.

### 7.5 Timer

Timer cocok untuk latency.

```java
Timer.Sample sample = Timer.start(registry);

try {
    process(command);
} finally {
    sample.stop(Timer.builder("case.command.duration")
            .tag("module", command.module())
            .tag("result", "success")
            .register(registry));
}
```

Namun lebih baik hindari membuat meter baru terus-menerus dengan tag dinamis.

---

## 8. Tag Cardinality: Musuh Besar Metrics

Metrics backend seperti Prometheus menyimpan time series berdasarkan kombinasi:

```text
metric name + tags/labels
```

Jika tag terlalu dinamis, time series meledak.

Contoh buruk:

```java
Counter.builder("http.client.error")
        .tag("userId", userId)
        .tag("caseId", caseId)
        .tag("email", email)
        .register(registry)
        .increment();
```

Ini menyebabkan cardinality explosion.

Contoh lebih baik:

```java
Counter.builder("http.client.error")
        .tag("system", "payment")
        .tag("operation", "create-payment")
        .tag("status", "timeout")
        .register(registry)
        .increment();
```

### 8.1 Tag yang Umumnya Aman

```text
application
module
operation
result
exception category
status class
tenant tier
region
queue name
topic name
consumer group
```

### 8.2 Tag yang Berbahaya

```text
user id
email
case id
request id
trace id
session id
IP address
full URL with query
free-text error message
document id
token/client secret
```

### 8.3 Rule

```text
Metrics are for aggregation.
Traces/logs are for high-cardinality investigation.
```

Jangan memaksa metrics menjadi log database.

---

## 9. Built-in Metrics dari Spring Boot

Spring Boot Actuator otomatis memberi banyak metrics ketika dependency tersedia.

Contoh kategori:

```text
JVM memory
GC
threads
classloader
CPU
process uptime
disk space
HTTP server requests
HTTP client requests
data source pool
cache
executor
logback events
Tomcat/Jetty/Undertow
Reactor Netty
Kafka/Rabbit/JMS depending integration
```

Contoh query umum Prometheus:

```promql
sum(rate(http_server_requests_seconds_count[5m])) by (uri, method, status)
```

Latency p95:

```promql
histogram_quantile(
  0.95,
  sum(rate(http_server_requests_seconds_bucket[5m])) by (le, uri, method)
)
```

Error rate:

```promql
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
/
sum(rate(http_server_requests_seconds_count[5m]))
```

---

## 10. HTTP Metrics: Jangan Salah Membaca `uri`

Spring Boot biasanya menormalisasi URI template:

```text
/api/cases/{id}
```

bukan:

```text
/api/cases/123456
```

Ini penting untuk menghindari cardinality explosion.

Jika custom filter/observation membuat tag URI raw, itu berbahaya.

Contoh tag ideal:

```text
method=GET
uri=/api/cases/{id}
status=200
outcome=SUCCESS
exception=none
```

Bukan:

```text
uri=/api/cases/CASE-2026-0000123?token=...
```

---

## 11. Observation API: Satu Abstraksi untuk Metrics dan Traces

Spring modern menggunakan Micrometer Observation sebagai abstraction untuk mengobservasi operasi.

Mental model:

```text
Observation
   -> starts
   -> adds low-cardinality tags
   -> optionally adds high-cardinality context
   -> stops
   -> handlers convert into metrics/traces/log correlation
```

Contoh:

```java
@Service
public class CaseDecisionService {

    private final ObservationRegistry observationRegistry;

    public CaseDecisionService(ObservationRegistry observationRegistry) {
        this.observationRegistry = observationRegistry;
    }

    public DecisionResult decide(CaseDecisionCommand command) {
        return Observation.createNotStarted("case.decision", observationRegistry)
                .lowCardinalityKeyValue("module", command.module())
                .lowCardinalityKeyValue("decisionType", command.decisionType())
                .observe(() -> doDecide(command));
    }

    private DecisionResult doDecide(CaseDecisionCommand command) {
        // domain/application logic
        return DecisionResult.approved();
    }
}
```

Keuntungan Observation API:

1. satu instrumentasi dapat menghasilkan metrics dan traces,
2. instrumentation tidak hardcode ke Prometheus/OpenTelemetry langsung,
3. low-cardinality dan high-cardinality bisa dibedakan,
4. library internal dapat reusable.

---

## 12. Low Cardinality vs High Cardinality Observation Data

Observation membedakan:

```text
low cardinality  -> cocok untuk metrics tags
high cardinality -> cocok untuk trace/log detail
```

Contoh:

```java
Observation observation = Observation.start("case.transition", registry);

observation.lowCardinalityKeyValue("module", "appeal");
observation.lowCardinalityKeyValue("transition", "submit");

observation.highCardinalityKeyValue("caseId", command.caseId());
observation.highCardinalityKeyValue("actorId", command.actorId());

try (Observation.Scope ignored = observation.openScope()) {
    transition(command);
    observation.stop();
} catch (Exception ex) {
    observation.error(ex);
    observation.stop();
    throw ex;
}
```

Rule:

```text
caseId boleh masuk trace, jangan masuk metric tag.
```

---

## 13. Tracing: Causality Across Boundaries

Metrics menjawab:

```text
berapa sering?
berapa lambat?
berapa error?
```

Trace menjawab:

```text
request ini melewati komponen apa saja?
mana span yang lambat?
dependency mana yang gagal?
apakah retry terjadi?
```

Dalam Spring app, tracing biasanya melewati:

```text
HTTP inbound
controller
service observation
database
HTTP outbound
messaging producer
messaging consumer
batch step
```

### 13.1 Trace ID, Span ID, Correlation ID

| ID | Fungsi |
|---|---|
| Trace ID | mengikat satu end-to-end request/workflow |
| Span ID | satu operasi dalam trace |
| Parent Span ID | hubungan parent-child |
| Correlation ID | business/operational correlation, sering custom |
| Request ID | identitas request spesifik |

Spring/Micrometer/OpenTelemetry dapat menangani trace/span propagation. Namun correlation ID bisnis sering tetap perlu didesain.

Contoh untuk regulatory/case system:

```text
traceId       = technical distributed trace
correlationId = command/request correlation
caseId        = domain reference, high-cardinality
actorId       = user reference, high-cardinality/sensitive
tenantId      = tergantung cardinality dan sensitivity
```

---

## 14. Logging Correlation

Logs tanpa correlation menyebabkan debugging melelahkan.

Target:

```text
setiap log penting punya traceId/spanId/correlationId
```

Contoh log pattern:

```yaml
logging:
  pattern:
    level: "%5p [traceId=%X{traceId:-}, spanId=%X{spanId:-}, correlationId=%X{correlationId:-}]"
```

Untuk custom correlation filter:

```java
@Component
public class CorrelationIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String correlationId = Optional.ofNullable(request.getHeader(HEADER))
                .filter(value -> !value.isBlank())
                .orElseGet(() -> UUID.randomUUID().toString());

        MDC.put(MDC_KEY, correlationId);
        response.setHeader(HEADER, correlationId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }
}
```

### 14.1 Async Context Problem

Jika memakai `@Async`, executor custom, scheduling, messaging listener, atau virtual threads, MDC/security/trace context bisa hilang jika tidak dipropagasi.

Karena itu context propagation harus menjadi platform concern, bukan effort manual per developer.

---

## 15. Custom HealthIndicator: Design yang Benar

### 15.1 Jangan Buat Health Check Mahal

Buruk:

```java
@Override
public Health health() {
    // query besar
    // scan table
    // call external dependency lambat
    // hit endpoint remote without timeout
}
```

Health check harus:

1. cepat,
2. bounded timeout,
3. tidak menyebabkan load besar,
4. tidak mengubah state,
5. tidak bergantung pada dependency non-critical untuk readiness,
6. tidak menimbulkan cascading failure.

### 15.2 Timeout Wajib

```java
@Component
public class ExternalSystemHealthIndicator implements HealthIndicator {

    private final ExternalSystemClient client;

    public ExternalSystemHealthIndicator(ExternalSystemClient client) {
        this.client = client;
    }

    @Override
    public Health health() {
        try {
            boolean ok = client.ping(Duration.ofMillis(500));
            return ok ? Health.up().build() : Health.down().build();
        } catch (Exception ex) {
            return Health.down()
                    .withDetail("error", ex.getClass().getSimpleName())
                    .build();
        }
    }
}
```

Jangan memasukkan full exception message jika bisa berisi URL, token, credential, atau internal detail.

---

## 16. Custom InfoContributor

`/actuator/info` sering dipakai untuk expose build/runtime metadata.

```java
@Component
public class RuntimeInfoContributor implements InfoContributor {

    @Override
    public void contribute(Info.Builder builder) {
        builder.withDetail("runtime", Map.of(
                "java", Runtime.version().toString(),
                "availableProcessors", Runtime.getRuntime().availableProcessors()
        ));
    }
}
```

Namun production info harus dibatasi:

Boleh:

```text
service name
version
commit short hash
build time
java version
environment name jika tidak sensitif
```

Hindari:

```text
database URL
username
internal hostnames
secret provider path
feature flag detail sensitif
tenant list
IP private lengkap jika tidak perlu
```

---

## 17. Custom Metrics untuk Domain dan Application Layer

Built-in metrics tidak cukup untuk memahami sistem domain.

Contoh untuk case-management/regulatory platform:

```text
case.command.submitted.total
case.command.rejected.total
case.transition.duration
case.transition.failed.total
case.escalation.pending.count
case.sla.breached.total
case.assignment.queue.size
appeal.review.duration
document.generation.duration
notification.delivery.failed.total
```

### 17.1 Jangan Terlalu Teknis Saja

Metrics teknis:

```text
CPU
memory
HTTP latency
DB pool
GC pause
thread count
```

perlu, tetapi tidak cukup.

Metrics domain/application:

```text
pending approval count
SLA breach count
failed workflow transition
case stuck in state count
retry exhausted count
dead-letter count
batch records skipped
```

sering lebih cepat memberi sinyal business impact.

### 17.2 Contoh Domain Gauge

```java
@Component
public class CaseBacklogMetrics {

    public CaseBacklogMetrics(MeterRegistry registry, CaseBacklogRepository repository) {
        Gauge.builder("case.backlog.pending", repository, CaseBacklogRepository::countPending)
                .description("Number of pending case items")
                .tag("module", "case")
                .register(registry);
    }
}
```

Catatan: gauge ini melakukan query. Pastikan query murah, cached, atau diupdate periodik.

Lebih aman untuk query mahal:

```java
@Component
public class CaseBacklogSnapshot {

    private final AtomicLong pending = new AtomicLong();

    public CaseBacklogSnapshot(MeterRegistry registry) {
        Gauge.builder("case.backlog.pending", pending, AtomicLong::get)
                .tag("module", "case")
                .register(registry);
    }

    @Scheduled(fixedDelayString = "PT30S")
    public void refresh() {
        // update pending from efficient query
    }
}
```

---

## 18. Metrics untuk Transaction dan Workflow Boundary

Untuk operation seperti:

```text
submit application
approve appeal
assign investigator
generate correspondence
send notification
escalate SLA
close case
```

observability harus memisahkan:

```text
validation failed
authorization denied
business rule rejected
transaction conflict
dependency timeout
unexpected technical error
```

Contoh tag aman:

```text
operation=submit-application
module=application
result=success|validation_failed|business_rejected|conflict|dependency_failed|unexpected_error
```

Jangan gunakan:

```text
applicationId=...
userId=...
caseId=...
errorMessage=...
```

sebagai metric tag.

---

## 19. Observability untuk Transactional Event dan Outbox

Untuk outbox pattern:

```text
write aggregate
write outbox row in same transaction
commit
publisher sends outbox event
mark published
```

Metrics penting:

```text
outbox.pending.count
outbox.publish.duration
outbox.publish.failed.total
outbox.retry.exhausted.total
outbox.oldest.pending.age
```

Trace penting:

```text
command span
transaction span
outbox write span
publisher span
broker send span
consumer span
```

Failure yang harus terlihat:

```text
event written but not published
event published but ack failed
consumer processed duplicate
consumer rejected poison message
DLQ grows
oldest pending event too old
```

---

## 20. Observability untuk Messaging

Untuk Kafka/Rabbit/JMS listener, minimal signal:

```text
message consumed count
processing duration
processing error count
retry count
DLQ/DLT count
consumer lag
in-flight messages
ack/commit failure
deserialization failure
idempotency duplicate count
```

Tag aman:

```text
broker
topic/queue
consumer_group
listener_id
result
exception_category
```

Tag berbahaya:

```text
message_id jika high-cardinality
payload field
business id
user id
raw exception message
```

---

## 21. Observability untuk Spring Batch

Batch membutuhkan signal berbeda dari API.

Minimal metrics:

```text
job duration
step duration
read count
write count
skip count
retry count
rollback count
failed records
current running job count
oldest running execution age
```

Operational endpoint custom bisa berguna, tetapi hati-hati jangan expose data sensitif.

Untuk batch, health tidak boleh sekadar:

```text
job terakhir gagal -> app DOWN
```

Karena batch failure belum tentu berarti service process harus dikeluarkan dari traffic.

Lebih baik:

```text
health UP
custom metric batch_job_last_status{job="...", status="failed"} 1
alert if failed
```

---

## 22. Actuator Security

### 22.1 Separate Security Chain

Contoh security untuk actuator:

```java
@Configuration
class ActuatorSecurityConfiguration {

    @Bean
    SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
        http
            .securityMatcher(EndpointRequest.toAnyEndpoint())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(EndpointRequest.to("health", "info")).permitAll()
                .anyRequest().hasRole("ACTUATOR_ADMIN")
            )
            .httpBasic(Customizer.withDefaults());

        return http.build();
    }
}
```

Untuk endpoint sensitif, pertimbangkan:

```text
network restriction
mTLS
VPN/internal only
separate port
separate role
audit access
disable if not needed
```

### 22.2 Jangan Expose Secret

Endpoint seperti `/env` dan `/configprops` punya sanitization, tetapi jangan bergantung hanya pada masking otomatis.

Prinsip:

```text
If operators do not need it during normal operations, do not expose it.
```

---

## 23. Log Level Runtime dengan `/actuator/loggers`

Endpoint loggers bisa membantu incident:

```text
set package com.company.payment to DEBUG for 10 minutes
```

Namun berbahaya jika:

1. public,
2. tidak diaudit,
3. bisa mengaktifkan debug yang membocorkan PII/secret,
4. tidak dikembalikan,
5. menyebabkan log volume explosion.

Operational rule:

```text
runtime log-level changes must be temporary, audited, and scoped.
```

---

## 24. Thread Dump dan Heap Dump

`/actuator/threaddump` berguna untuk:

```text
deadlock
thread pool exhaustion
blocked threads
event loop blocked
virtual thread pinning suspicion
scheduler stuck
```

`/actuator/heapdump` sangat sensitif karena bisa berisi:

```text
tokens
passwords
PII
request payloads
database results
session data
```

Production policy:

```text
heap dump hanya incident-only
akses sangat terbatas
storage terenkripsi
retention pendek
redaction/process jelas
```

---

## 25. Startup Endpoint

Spring Boot dapat menyediakan startup insight melalui application startup tracking.

Konfigurasi:

```java
public static void main(String[] args) {
    SpringApplication app = new SpringApplication(MyApplication.class);
    app.setApplicationStartup(new BufferingApplicationStartup(2048));
    app.run(args);
}
```

Endpoint:

```text
/actuator/startup
```

Berguna untuk:

```text
bean lambat dibuat
auto-configuration berat
classpath scanning mahal
startup regression
custom init lambat
external call saat startup
```

Namun jangan aktifkan detail berlebihan tanpa alasan di production normal.

---

## 26. SLO-Oriented Observability

Top-tier observability tidak dimulai dari tool, tetapi dari SLO.

Contoh SLO API:

```text
99% GET /api/cases/{id} selesai < 300ms dalam 30 hari
99.5% command submit-case berhasil tanpa technical error
error rate 5xx < 0.1%
readiness unavailable < 5 menit/bulan
```

Metrics yang dibutuhkan:

```text
request count
request latency histogram
error count
availability
dependency latency
queue backlog
```

Alert yang baik:

```text
burn rate error budget tinggi
p95 latency melewati threshold
readiness flapping
DB pool saturation
consumer lag growing
oldest outbox event age too high
```

Alert yang buruk:

```text
CPU > 80% selama 1 menit
heap > 70%
one request failed
one pod restarted once
```

Bukan berarti CPU/heap tidak penting. Tetapi alert harus actionable.

---

## 27. Golden Signals untuk Spring Service

Untuk service synchronous HTTP:

```text
latency
traffic
errors
saturation
```

Spring-specific mapping:

| Signal | Spring/Micrometer Source |
|---|---|
| Latency | `http.server.requests`, custom Timer |
| Traffic | request count/rate |
| Errors | 5xx, exception tag, custom error counter |
| Saturation | DB pool active/max, executor queue, CPU, memory, GC |

Untuk messaging:

| Signal | Source |
|---|---|
| Throughput | consumed/produced messages |
| Latency | processing duration |
| Errors | listener failures, DLT count |
| Saturation | lag, queue depth, executor queue |

Untuk batch:

| Signal | Source |
|---|---|
| Duration | job/step timer |
| Throughput | records/sec |
| Errors | skip/retry/failure count |
| Saturation | job overlap, DB pressure, thread pool |

---

## 28. Metrics Naming Convention

Gunakan nama yang stabil.

Contoh:

```text
case.command.duration
case.command.submitted
case.command.failed
case.backlog.pending
outbox.pending
outbox.publish.duration
external.payment.request.duration
```

Hindari:

```text
my_metric
test_counter
foo_duration
case_command_duration_v2_new
```

Prinsip:

```text
domain.operation.measurement
```

Atau:

```text
technical.component.measurement
```

Contoh teknis:

```text
http.client.duration
db.pool.active
executor.queue.size
cache.hit
```

---

## 29. MeterFilter: Governance untuk Metrics

`MeterFilter` bisa dipakai untuk:

1. rename,
2. deny meter,
3. limit tags,
4. add common tags,
5. cap cardinality.

Contoh common tags:

```java
@Configuration
class MetricsConfiguration {

    @Bean
    MeterRegistryCustomizer<MeterRegistry> commonTags(
            @Value("${spring.application.name}") String appName
    ) {
        return registry -> registry.config().commonTags(
                "application", appName
        );
    }
}
```

Contoh deny tag value terlalu banyak harus dipertimbangkan dengan hati-hati.

Governance metrics untuk platform internal:

```text
semua service wajib punya application tag
tenant/user/case id dilarang sebagai metric tag
uri raw dilarang
exception message dilarang
histogram hanya untuk operation penting
```

---

## 30. Histogram dan Percentile

Latency p95/p99 tidak bisa dihitung benar dari average.

Gunakan histogram untuk endpoint/operation penting.

Contoh:

```java
Timer.builder("case.transition.duration")
        .description("Case transition duration")
        .tag("module", "case")
        .publishPercentileHistogram()
        .register(registry);
```

Namun histogram menambah jumlah time series.

Prinsip:

```text
histogram untuk SLO-critical operation
jangan aktifkan histogram secara membabi-buta untuk semua metric high-cardinality
```

---

## 31. Executor Metrics

Untuk `@Async`, scheduling, dan background task, observability executor penting.

Signal:

```text
active threads
pool size
queue size
completed tasks
rejected tasks
task duration
```

Jika executor queue naik terus:

```text
incoming work > processing capacity
atau worker stuck
atau dependency downstream lambat
atau pool terlalu kecil
atau queue terlalu besar menyembunyikan overload
```

Queue besar bukan selalu bagus. Queue besar sering hanya mengubah overload menjadi latency panjang.

---

## 32. DataSource/Hikari Metrics

Untuk Spring app berbasis JDBC/JPA, pool metrics sering menjadi sinyal paling penting.

Signal:

```text
active connections
idle connections
pending threads
max connections
connection acquire time
connection timeout count
```

Failure interpretation:

```text
active=max, pending naik
   -> DB pool saturated

CPU rendah, pending DB tinggi
   -> bottleneck DB/connection pool, bukan CPU app

virtual threads banyak, DB pool kecil
   -> banyak virtual threads menunggu koneksi

latency naik + DB acquire time naik
   -> request lambat sebelum query pun jalan
```

---

## 33. Cache Metrics

Untuk cache:

```text
hit count/rate
miss count/rate
eviction count
load duration
load failure
cache size
```

Interpretasi:

```text
hit rate turun tiba-tiba
   -> key berubah, TTL terlalu pendek, invalidation berlebihan

eviction tinggi
   -> cache terlalu kecil atau key cardinality tinggi

load failure naik
   -> backend dependency bermasalah
```

Cache metrics harus dikaitkan dengan correctness. Hit rate tinggi tidak selalu baik jika cache stale.

---

## 34. Observability untuk Security

Security metrics/logs harus hati-hati.

Signal berguna:

```text
authentication success/failure
authorization denied
invalid token
expired token
CSRF failure
suspicious request count
rate limit rejected
```

Tag aman:

```text
client_type
auth_scheme
result
reason_category
endpoint_group
```

Tag berbahaya:

```text
username
email
token
raw IP jika kebijakan melarang
full user-agent jika cardinality tinggi
```

Security logs bisa masuk audit trail, tetapi tidak semua security event cocok menjadi metric tag.

---

## 35. Observability untuk Multi-Tenant System

Multi-tenant observability rumit karena tenant adalah dimensi penting, tetapi bisa high-cardinality dan sensitif.

Strategi:

1. Untuk metrics agregat:
   ```text
   tenant_tier=standard|premium|internal
   region=...
   agency_type=...
   ```
2. Untuk tenant spesifik:
   ```text
   trace/log dengan akses terbatas
   dashboard per tenant jika jumlah tenant kecil dan disetujui
   ```
3. Untuk incident:
   ```text
   temporary targeted logs/metrics
   controlled sampling
   audit access
   ```

Jangan otomatis menambahkan `tenantId` ke semua metrics.

---

## 36. Observability dengan Virtual Threads

Virtual threads membuat thread count tidak lagi sama maknanya seperti platform thread.

Yang tetap penting:

```text
DB pool saturation
HTTP client pool saturation
external dependency latency
lock contention
pinning
queue backlog
request latency
GC/memory
```

Jangan menyimpulkan:

```text
thread banyak = buruk
```

pada virtual thread.

Tetapi tetap waspada terhadap:

```text
synchronized block panjang
native call
blocking dalam carrier-sensitive area
connection pool bottleneck
ThreadLocal/MDC propagation
```

---

## 37. WebFlux Observability

Untuk WebFlux/Reactor:

Signal penting:

```text
event loop blocking
scheduler queue
reactor netty connection pool
HTTP client latency
backpressure symptoms
timeout/retry count
```

Kesalahan umum:

```text
.block() di event loop
manual subscribe tanpa error handling
retry storm
context hilang
trace tidak propagate
```

Metrics HTTP biasa tidak cukup untuk reactive incident. Tambahkan tracing dan scheduler/connection pool insight.

---

## 38. Production Dashboard Minimum

Dashboard minimum Spring service:

### 38.1 Overview

```text
UP instances
readiness status
request rate
error rate
p50/p95/p99 latency
CPU
heap
GC pause
pod restarts
```

### 38.2 HTTP/API

```text
top endpoints by rate
top endpoints by latency
top endpoints by 5xx
4xx breakdown
slow requests
```

### 38.3 Dependencies

```text
DB pool active/pending
Redis latency/error
HTTP client latency/error by external system
Kafka/Rabbit lag/error/DLQ
```

### 38.4 Runtime

```text
thread count
executor queue
scheduled job status
batch job status
cache hit/miss
```

### 38.5 Domain

```text
case backlog
SLA breach
workflow transition failure
outbox pending
notification failure
stuck state count
```

---

## 39. Alert Design

Alert harus punya:

```text
condition
duration
severity
owner
impact
runbook
dashboard link
```

Contoh baik:

```text
API 5xx burn rate > threshold for 10 minutes
Impact: users cannot submit applications reliably
Action: check recent deployment, DB pool, dependency errors
```

Contoh buruk:

```text
CPU high
```

Tanpa konteks, CPU high bisa normal.

### 39.1 Multi-Window Burn Rate

Untuk SLO, alert lebih baik berbasis burn rate:

```text
short window catches fast incident
long window reduces noise
```

Contoh konseptual:

```text
5m burn rate high AND 1h burn rate high
```

---

## 40. Runtime Operations Playbook

### 40.1 Jika `/health/readiness` DOWN

Periksa:

```text
which health indicator is DOWN?
is it critical dependency?
is dependency actually down?
is timeout too aggressive?
did deployment change config?
is database pool exhausted?
is external dependency slow?
is readiness group too broad?
```

Action:

```text
do not restart blindly
compare liveness vs readiness
check dependency dashboard
check recent deployment
check logs with trace/correlation
```

### 40.2 Jika p95 Latency Naik

Periksa:

```text
specific uri or all?
DB acquire time?
HTTP outbound latency?
GC pause?
thread/executor queue?
cache miss spike?
tenant/module specific?
recent deployment?
```

### 40.3 Jika Error Rate Naik

Pisahkan:

```text
validation/business rejection
authorization denied
conflict
dependency timeout
unexpected 5xx
```

Jangan semua error dianggap bug aplikasi.

### 40.4 Jika DB Pool Saturated

Periksa:

```text
active=max?
pending threads?
slow query?
transaction too long?
external call inside transaction?
virtual threads waiting on pool?
connection leak?
batch job overlap?
```

### 40.5 Jika Consumer Lag Naik

Periksa:

```text
processing duration
error/retry loop
downstream dependency
consumer instances
partition count
idempotency store latency
DLQ count
deserialization failures
```

---

## 41. Custom Actuator Endpoint

Kadang perlu endpoint custom untuk operational state.

Contoh:

```java
@Component
@Endpoint(id = "caseRuntime")
public class CaseRuntimeEndpoint {

    private final CaseRuntimeService service;

    public CaseRuntimeEndpoint(CaseRuntimeService service) {
        this.service = service;
    }

    @ReadOperation
    public Map<String, Object> runtime() {
        return Map.of(
                "pendingCommands", service.pendingCommands(),
                "oldestPendingAgeSeconds", service.oldestPendingAge().toSeconds()
        );
    }
}
```

Gunakan custom endpoint hanya jika:

1. data benar-benar operational,
2. bukan data business sensitif,
3. akses diamankan,
4. output bounded,
5. query murah,
6. punya owner jelas.

Jangan membuat endpoint menjadi mini admin API tanpa governance.

---

## 42. Audit vs Observability

Audit dan observability sering bercampur, tetapi berbeda.

| Aspek | Observability | Audit |
|---|---|---|
| Tujuan | memahami runtime behavior | bukti tindakan/keputusan |
| Retensi | relatif pendek | sering panjang |
| Data | agregat/diagnostic | per-event, legally meaningful |
| Akses | operator/SRE/dev | security/compliance/auditor |
| Contoh | latency, error rate, trace | user approved case X at time Y |

Jangan hanya mengandalkan logs untuk audit regulatory. Logs bisa berubah, terhapus, sampling, atau tidak memenuhi evidentiary requirements.

---

## 43. Privacy, PII, and Secret Safety

Observability sering menjadi jalur bocor data.

Risiko:

```text
request body masuk log
authorization header masuk trace
query parameter berisi token
exception message mengandung SQL/data
MDC menyimpan user email
metric tag menyimpan user/case id
heap dump berisi PII
/env expose secret
```

Prinsip:

```text
Logs are data stores.
Metrics are data stores.
Traces are data stores.
Dumps are data stores.
Treat them with data governance.
```

Checklist:

```text
mask headers
redact tokens
avoid request/response body logs
limit actuator endpoints
sanitize env/configprops
no PII in metric tags
short retention for debug logs
role-based access to traces/logs
```

---

## 44. Testing Observability

Observability juga perlu dites.

### 44.1 Testing Metrics

```java
@Test
void recordsCommandMetric() {
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    CaseCommandMetrics metrics = new CaseCommandMetrics(registry);

    metrics.markSubmitted();

    Counter counter = registry.find("case.command.submitted").counter();

    assertThat(counter).isNotNull();
    assertThat(counter.count()).isEqualTo(1.0);
}
```

### 44.2 Testing Actuator Endpoint

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ActuatorHealthTest {

    @Autowired
    TestRestTemplate rest;

    @Test
    void healthEndpointIsAvailable() {
        ResponseEntity<String> response =
                rest.getForEntity("/actuator/health", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```

### 44.3 Testing Observation

Use registry/handler test support where available, atau isolate instrumentation wrapper.

Yang perlu diuji:

```text
metric name stable
tag values bounded
error path recorded
timer records duration
sensitive data not emitted
health group includes correct indicators
actuator endpoint exposure matches policy
```

---

## 45. Common Anti-Patterns

### 45.1 Expose Semua Endpoint

```yaml
management.endpoints.web.exposure.include: "*"
```

di production public network adalah red flag.

### 45.2 Health Check Terlalu Luas

Semua dependency dimasukkan readiness/liveness sehingga service flapping.

### 45.3 Metric Tag High-Cardinality

```text
userId
caseId
requestId
traceId
raw URI
```

menjadi label Prometheus.

### 45.4 Tidak Ada Timeout di Health Indicator

Health endpoint jadi lambat/stuck saat dependency lambat.

### 45.5 Alert Tidak Actionable

Alert banyak tetapi tidak ada runbook/owner.

### 45.6 Logs Tanpa Trace/Correlation

Saat incident, log tidak bisa dirangkai.

### 45.7 Menganggap Average Latency Cukup

Average menyembunyikan tail latency.

### 45.8 Tidak Ada Domain Metrics

Sistem terlihat sehat secara CPU/HTTP, tetapi backlog business menumpuk.

### 45.9 Observability Setelah Incident

Instrumentation baru dibuat setelah masalah besar terjadi.

### 45.10 Debug Log Permanent

Debug aktif lama, biaya tinggi, PII risk tinggi.

---

## 46. Enterprise Spring Observability Architecture

Untuk organisasi besar, observability harus distandardisasi.

Platform starter internal bisa menyediakan:

```text
common tags
correlation ID filter
safe logging pattern
meter filters
default actuator exposure
health group conventions
ProblemDetail correlation integration
HTTP client observation
messaging observation
batch observation
security event metrics
outbox metrics
test utilities
```

Contoh starter:

```text
company-spring-observability-starter
```

Isi:

```text
ObservabilityAutoConfiguration
CorrelationIdAutoConfiguration
ActuatorSecurityAutoConfiguration
MetricsGovernanceAutoConfiguration
HealthGroupAutoConfiguration
HttpClientObservationAutoConfiguration
MessagingObservationAutoConfiguration
```

Prinsip:

```text
Every service should be observable by default,
but sensitive endpoints and high-cardinality data should be blocked by default.
```

---

## 47. Java 8 hingga Java 25 Considerations

### 47.1 Java 8 / Spring Boot 2 Era

Umum:

```text
Spring Boot 2.x
Spring Framework 5.x
Micrometer sudah tersedia
Tracing sering via Sleuth
javax.* namespace
```

Catatan:

```text
Spring Cloud Sleuth historically common
Brave/Zipkin banyak dipakai
Actuator endpoint model berbeda dari Boot 1
```

### 47.2 Java 17 / Spring Boot 3 Era

Umum:

```text
Spring Framework 6
Spring Boot 3
Jakarta namespace
Micrometer Observation introduced as central model
Sleuth replaced by Micrometer Tracing direction
AOT/native support
```

### 47.3 Java 21–25 / Spring Boot 3.2+ hingga 4.x

Pertimbangan:

```text
virtual threads affect thread metrics interpretation
OpenTelemetry/OTLP semakin umum
Boot 4 modularization
Java 25 support in Spring Boot 4
observability harus memahami native/AOT constraints
```

Rule migration:

```text
do not just port dependencies
re-check endpoint exposure
re-check tracing stack
re-check metric names/tags
re-check health groups
re-check security chain for actuator
```

---

## 48. Production Checklist

Sebelum service Spring production:

### 48.1 Actuator

```text
[ ] actuator dependency installed
[ ] management endpoint exposure explicit
[ ] sensitive endpoints disabled or protected
[ ] management port/network policy decided
[ ] actuator security chain configured
[ ] /health available
[ ] /health/liveness configured
[ ] /health/readiness configured
[ ] details exposure controlled
```

### 48.2 Health

```text
[ ] critical dependencies mapped
[ ] optional dependencies not breaking readiness
[ ] liveness does not depend on external systems unnecessarily
[ ] custom health indicators have timeout
[ ] health checks are cheap
[ ] health groups documented
```

### 48.3 Metrics

```text
[ ] Prometheus/OTLP/registry configured
[ ] common tags configured
[ ] high-cardinality tags banned
[ ] HTTP metrics checked for URI templating
[ ] DB pool metrics visible
[ ] executor metrics visible
[ ] cache metrics visible if cache used
[ ] domain metrics defined
[ ] SLO metrics available
```

### 48.4 Tracing/Logs

```text
[ ] tracing configured
[ ] trace id in logs
[ ] correlation id strategy defined
[ ] inbound/outbound propagation works
[ ] async context propagation tested
[ ] sensitive headers/body redacted
```

### 48.5 Alerts/Runbooks

```text
[ ] alerts mapped to SLO/impact
[ ] alert owner defined
[ ] runbook linked
[ ] dashboards linked
[ ] false positive rate acceptable
[ ] incident playbooks tested
```

---

## 49. Review Rubric untuk Engineer Senior

Saat review observability Spring app, tanyakan:

1. Apakah readiness dan liveness punya arti yang benar?
2. Apakah actuator exposure aman?
3. Apakah metric tags bounded?
4. Apakah ada domain metrics, bukan hanya technical metrics?
5. Apakah external dependency latency/error terlihat?
6. Apakah DB pool saturation terlihat?
7. Apakah async/scheduled/messaging failure terlihat?
8. Apakah batch job bisa dioperasikan dari metrics/logs?
9. Apakah trace/log punya correlation?
10. Apakah PII/secret aman dari logs/metrics/traces?
11. Apakah alert actionable?
12. Apakah runbook tersedia?
13. Apakah observability diuji?
14. Apakah platform starter mencegah kesalahan berulang?
15. Apakah SLO menentukan instrumentation, bukan sebaliknya?

---

## 50. Kesimpulan

Spring Boot Actuator dan Micrometer bukan sekadar fitur tambahan. Dalam production-grade Spring system, keduanya adalah bagian dari runtime contract.

Pemahaman dangkal:

```text
tambahkan spring-boot-starter-actuator
buka /actuator/prometheus
buat dashboard
```

Pemahaman advanced:

```text
desain health sebagai traffic admission signal
bedakan liveness/readiness/dependency diagnosis
gunakan metrics untuk agregasi, traces/logs untuk detail
jaga cardinality
instrumentasikan domain operation
amankan actuator
hubungkan observability dengan SLO
uji instrumentation
siapkan runbook
bangun starter internal agar semua service konsisten
```

Jika Spring container adalah mesin yang menjalankan object graph, maka observability adalah sistem sarafnya.

Tanpa observability, aplikasi hanya “berjalan”.

Dengan observability yang benar, aplikasi bisa:

```text
dipahami
dioperasikan
diaudit
ditingkatkan
dan dipulihkan saat gagal
```

---

## 51. Status Seri

```text
Part saat ini : 25 dari 35
Status        : belum selesai
Berikutnya    : 26-testing-spring-applications-at-scale.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./24-spring-batch-stateful-job-runtime.md">⬅️ Part 24 — Spring Batch Architecture: Stateful Job Runtime, Restartability, and Operational Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./26-testing-spring-applications-at-scale.md">Testing Spring Applications at Scale ➡️</a>
</div>
