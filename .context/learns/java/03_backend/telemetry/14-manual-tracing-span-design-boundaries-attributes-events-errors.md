# Part 14 — Manual Tracing: Span Design, Boundaries, Attributes, Events, Errors

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
File: `14-manual-tracing-span-design-boundaries-attributes-events-errors.md`  
Scope: Java 8 sampai Java 25  
Focus: OpenTelemetry manual tracing untuk Java production systems  
Prerequisite: Part 1–13

---

## 0. Tujuan Part Ini

Pada part sebelumnya, kita sudah membahas OpenTelemetry dari sisi mental model dan Java Agent. Java agent sangat kuat untuk menangkap telemetry di boundary umum seperti HTTP server, HTTP client, JDBC, messaging client, servlet, Spring, dan beberapa framework populer.

Tetapi engineer top-tier tidak berhenti di auto-instrumentation.

Auto-instrumentation biasanya menjawab:

> Request ini masuk ke service mana, memanggil dependency apa, query database apa, dan latensinya berapa?

Manual tracing menjawab pertanyaan yang lebih dalam:

> Di dalam business operation ini, decision point apa yang terjadi, state transition apa yang valid, branch mana yang dipilih, dependency mana yang opsional, retry mana yang meaningful, rule mana yang gagal, dan logical unit mana yang sebenarnya menyebabkan latency/error?

Part ini akan membahas bagaimana mendesain span manual yang **membantu diagnosis**, bukan hanya membuat trace terlihat panjang.

Target akhir part ini:

1. Anda tahu kapan perlu manual tracing dan kapan tidak.
2. Anda bisa mendesain span boundary yang masuk akal.
3. Anda bisa memilih span name yang stabil dan queryable.
4. Anda bisa menambahkan attribute tanpa merusak cardinality.
5. Anda bisa merekam exception, error status, event, dan link dengan benar.
6. Anda bisa melakukan tracing pada async flow, messaging, batch, scheduler, dan workflow.
7. Anda bisa menghindari trace noise, trace explosion, dan privacy leak.
8. Anda bisa membuat tracing standard untuk enterprise Java system.

---

## 1. Core Mental Model: Trace Is a Causal Execution Story

Trace bukan log yang lebih canggih.

Trace adalah struktur kausal dari satu operasi end-to-end.

Satu trace menjawab:

```text
Operation apa yang dimulai?
Sub-operation apa saja yang terjadi?
Mana parent dan mana child?
Berapa durasi masing-masing?
Dependency apa yang dipanggil?
Error terjadi di span mana?
Branch mana yang dilalui?
Apakah operasi ini sync, async, retry, fan-out, atau batch?
```

Model sederhananya:

```text
Trace
└── Span: HTTP POST /applications/{id}/submit
    ├── Span: validate application submission
    ├── Span: load application aggregate
    ├── Span: evaluate submission rules
    │   ├── Event: rule.evaluated
    │   ├── Event: rule.evaluated
    │   └── Event: rule.failed
    ├── Span: persist application state transition
    ├── Span: publish application submitted event
    └── Span: render response
```

Trace memiliki struktur. Log biasanya timeline datar.

Log yang baik dapat memberitahu:

```text
At 10:15:02, rule failed.
```

Trace yang baik dapat memberitahu:

```text
Rule failed inside "evaluate submission rules", which was part of submit operation,
after database read succeeded, before state transition was persisted, and before event was published.
```

Itulah perbedaan critical-nya.

---

## 2. Auto-Instrumentation vs Manual Instrumentation

### 2.1 Auto-instrumentation

Auto-instrumentation cocok untuk boundary teknis:

- HTTP server request.
- HTTP client call.
- JDBC query.
- Redis call.
- Kafka/RabbitMQ publish/consume.
- Servlet container.
- Spring MVC/WebFlux.
- gRPC client/server.
- beberapa framework messaging/cache populer.

Contoh trace hasil auto-instrumentation:

```text
POST /applications/{id}/submit
├── SELECT application ...
├── SELECT document ...
├── UPDATE application ...
└── POST https://notification-service/send
```

Ini berguna, tetapi belum menjelaskan business logic.

Auto-instrumentation tidak tahu:

- rule mana yang dievaluasi;
- approval path mana yang dipilih;
- apakah transition valid;
- apakah duplicate submission terjadi;
- apakah retry merupakan retry normal atau retry berbahaya;
- apakah external call mandatory atau best-effort;
- apakah message publish dilakukan untuk command, event, notification, atau audit.

### 2.2 Manual instrumentation

Manual instrumentation cocok untuk boundary logis:

- validate request.
- evaluate business rules.
- perform state transition.
- reserve inventory.
- calculate price.
- resolve tenant policy.
- generate document.
- execute workflow step.
- perform idempotency check.
- apply escalation rule.
- reconcile batch chunk.
- process message command/event.
- run fraud/compliance screening.
- produce audit trail.

Manual tracing mengubah trace dari sekadar technical call graph menjadi:

```text
technical call graph + domain execution graph
```

### 2.3 Rule praktis

Gunakan auto-instrumentation untuk:

```text
"What technology did we call?"
```

Gunakan manual instrumentation untuk:

```text
"What meaningful operation were we performing?"
```

---

## 3. Apa Itu Span?

Span adalah unit kerja terukur dalam trace.

Span biasanya memiliki:

| Elemen | Fungsi |
|---|---|
| Trace ID | identitas end-to-end operation |
| Span ID | identitas span |
| Parent Span ID | relasi kausal |
| Name | nama operasi |
| Kind | server/client/producer/consumer/internal |
| Start time | kapan dimulai |
| End time | kapan selesai |
| Duration | berapa lama |
| Attributes | metadata queryable |
| Events | titik kejadian di dalam span |
| Links | relasi non-parent-child |
| Status | unset/ok/error |
| Recorded exceptions | exception signal |

Contoh konseptual:

```text
Span:
  name: application.submit.evaluate_rules
  kind: INTERNAL
  duration: 145ms
  attributes:
    service.name: aceas-application-service
    application.module: application-management
    workflow.name: application-submission
    rule.count: 17
    rule.failed.count: 1
    outcome: failure
    reason.code: DOCUMENT_EXPIRED
  events:
    - rule.evaluated
    - rule.evaluated
    - rule.failed
  status:
    ERROR
```

Span bukan sekadar timer. Span adalah **bounded evidence object**.

---

## 4. Span Boundary: Masalah Terpenting dalam Manual Tracing

Kesalahan paling umum dalam manual tracing bukan syntax. Kesalahan paling umum adalah salah memilih boundary.

### 4.1 Boundary buruk

Contoh boundary yang terlalu kecil:

```text
Span: call method A
Span: call method B
Span: call method C
Span: call method D
```

Ini hanya menyalin struktur kode ke trace.

Masalah:

- trace terlalu ramai;
- tidak stabil jika refactor;
- tidak bermakna untuk incident;
- sulit dicari;
- overhead naik;
- signal-to-noise turun.

Contoh boundary yang terlalu besar:

```text
Span: process request
```

Masalah:

- tidak tahu bagian mana lambat;
- tidak tahu decision point;
- tidak bisa isolate dependency atau logic;
- tidak membantu root cause.

### 4.2 Boundary baik

Boundary baik biasanya mengikuti **logical operation**, bukan method.

Contoh:

```text
Span: application.submit
├── Span: application.submit.validate_input
├── Span: application.submit.load_aggregate
├── Span: application.submit.evaluate_rules
├── Span: application.submit.persist_transition
├── Span: application.submit.publish_event
└── Span: application.submit.prepare_response
```

Boundary ini baik karena:

- stabil terhadap refactor internal;
- relevan ke domain;
- berguna untuk latency breakdown;
- dapat diberi attribute meaningful;
- mudah dibaca saat incident;
- dapat dikorelasikan dengan logs dan metrics.

### 4.3 Span boundary heuristic

Buat span manual jika operasi tersebut memenuhi minimal satu kondisi:

1. Memiliki latency yang ingin diukur.
2. Memiliki decision point penting.
3. Memiliki external atau cross-component effect.
4. Dapat gagal dengan reason yang meaningful.
5. Membentuk state transition.
6. Memproses banyak item.
7. Memiliki retry/backoff/fallback.
8. Merupakan boundary async.
9. Merupakan boundary workflow.
10. Merupakan operasi yang sering muncul di post-incident analysis.

Jangan buat span jika:

1. Hanya getter/setter.
2. Hanya private helper kecil.
3. Sangat sering dipanggil dalam loop besar.
4. Nama span akan mengandung ID unik.
5. Attribute-nya tidak akan dipakai.
6. Span hanya meniru struktur method.
7. Operation tidak membantu diagnosis.

---

## 5. Span Kind

OpenTelemetry memiliki beberapa span kind:

| Span Kind | Makna |
|---|---|
| `SERVER` | menerima request dari luar process |
| `CLIENT` | memanggil service/dependency luar |
| `PRODUCER` | mengirim pesan ke broker/queue/topic |
| `CONSUMER` | menerima/memproses pesan |
| `INTERNAL` | operasi internal dalam process |

Manual tracing business logic umumnya memakai `INTERNAL`.

Contoh:

```java
Span span = tracer.spanBuilder("application.submit.evaluate_rules")
        .setSpanKind(SpanKind.INTERNAL)
        .startSpan();
```

Gunakan `CLIENT` hanya jika Anda membuat instrumentation untuk outbound dependency yang belum diinstrumentasi otomatis.

Gunakan `PRODUCER`/`CONSUMER` untuk messaging jika library Anda tidak otomatis diinstrumentasi atau jika Anda membuat custom messaging/workflow layer.

---

## 6. Span Naming: Stable, Low-Cardinality, Domain-Relevant

Span name adalah salah satu keputusan desain paling penting.

### 6.1 Nama span yang buruk

```text
submit application 8f4a1f02a
GET /applications/123456
validate rule DOCUMENT_EXPIRED for user 923712
process John Doe submission
execute SQL SELECT * FROM APPLICATION WHERE ID = 123
```

Masalah:

- mengandung ID unik;
- high cardinality;
- mencampur data runtime dengan operation name;
- sulit agregasi;
- berbahaya dari sisi privacy.

### 6.2 Nama span yang baik

```text
application.submit
application.submit.validate_input
application.submit.load_aggregate
application.submit.evaluate_rules
application.submit.persist_transition
application.submit.publish_event
notification.send
document.generate_pdf
screening.evaluate
case.transition
batch.reconcile.chunk
```

Properties:

- stabil;
- operation-oriented;
- low-cardinality;
- tidak mengandung PII;
- tidak mengandung ID;
- tetap bermakna untuk engineer dan domain owner.

### 6.3 Naming convention

Rekomendasi:

```text
<domain>.<operation>
<domain>.<operation>.<phase>
<workflow>.<step>
<batch>.<phase>
<dependency>.<operation>
```

Contoh:

```text
application.submit
application.submit.evaluate_rules
application.submit.persist_transition

case.escalate
case.escalate.resolve_policy
case.escalate.transition_state

payment.authorize
payment.authorize.call_gateway
payment.authorize.persist_result

batch.application_reconciliation.chunk
batch.application_reconciliation.publish_summary
```

### 6.4 Jangan membuat span name dari method name secara buta

Method name bisa berubah karena refactor.

Trace adalah operational contract. Ia harus lebih stabil daripada struktur kode.

Buruk:

```text
ApplicationSubmissionServiceImpl.submitApplicationInternal
```

Lebih baik:

```text
application.submit
```

---

## 7. Attributes: Metadata Queryable, Bukan Dump Semua Data

Attributes adalah metadata key-value pada span.

Gunanya:

- filtering;
- grouping;
- correlation;
- diagnosis;
- agregasi;
- root cause analysis.

### 7.1 Attribute yang baik

Attribute baik memiliki ciri:

1. Relevan untuk diagnosis.
2. Low atau controlled cardinality.
3. Tidak mengandung secret.
4. Tidak mengandung PII mentah.
5. Stabil secara schema.
6. Bisa digunakan untuk query.
7. Memiliki naming convention.

Contoh:

```text
application.module = "application-management"
workflow.name = "application-submission"
workflow.step = "eligibility-check"
transition.from = "DRAFT"
transition.to = "SUBMITTED"
rule.failed.count = 1
dependency.name = "onemap"
retry.count = 2
outcome = "failure"
reason.code = "DOCUMENT_EXPIRED"
```

### 7.2 Attribute yang buruk

```text
user.email = "fajar@example.com"
jwt.token = "eyJhbGciOi..."
request.body = "{...full payload...}"
sql.raw = "SELECT ... WHERE NRIC = ..."
application.description = "long free text..."
document.content = "..."
```

Masalah:

- PII leak;
- secret leak;
- cardinality tinggi;
- storage cost;
- compliance risk;
- query tidak stabil.

### 7.3 Attribute cardinality

Cardinality berarti jumlah kemungkinan nilai unik.

Low-cardinality:

```text
environment = "prod"
http.method = "POST"
outcome = "success"
transition.to = "SUBMITTED"
error.type = "TimeoutException"
```

Medium-cardinality:

```text
tenant.id = "agency-a"
module.name = "application-management"
external.system = "onemap"
rule.id = "DOCUMENT_EXPIRY_RULE"
```

High-cardinality:

```text
request.id
trace.id
user.id
application.id
document.id
email
free text
full URL with query
full SQL with literal values
```

High-cardinality tidak selalu dilarang, tetapi harus sadar tempat.

- High-cardinality di logs: kadang wajar.
- High-cardinality di traces: hati-hati.
- High-cardinality di metrics labels: hampir selalu berbahaya.
- High-cardinality di span name: buruk.
- PII: jangan.

### 7.4 Attribute placement

Pertanyaan penting:

> Data ini harus ada di span attribute, span event, log, baggage, metric label, atau audit record?

Guideline:

| Data | Tempat yang lebih tepat |
|---|---|
| operation kind | span name / attribute |
| outcome | span attribute |
| reason code | span attribute |
| rule evaluation detail banyak | span events atau logs |
| full exception stack | log atau exception event |
| request body | biasanya jangan |
| PII | audit store khusus / masked log, bukan trace biasa |
| trace id | log field |
| latency numeric | metric/span duration |
| business transition | log + span attribute + audit event |
| cross-service propagation | trace context, bukan custom header acak |

---

## 8. Span Events: Point-in-Time Evidence Inside a Span

Span punya durasi. Event adalah titik waktu di dalam span.

Gunakan span event untuk kejadian penting yang tidak layak menjadi span sendiri.

Contoh:

```text
Span: application.submit.evaluate_rules
  Event: rule.evaluated {rule.id=MINIMUM_AGE, outcome=success}
  Event: rule.evaluated {rule.id=DOCUMENT_VALIDITY, outcome=failure}
  Event: rule.evaluation.completed {rule.count=17, failed.count=1}
```

### 8.1 Kapan memakai event

Gunakan event jika:

1. Kejadian penting terjadi di dalam span.
2. Kejadian tidak punya durasi meaningful.
3. Anda butuh timeline detail.
4. Anda ingin mencatat decision point.
5. Anda ingin mencatat retry attempt.
6. Anda ingin mencatat fallback selected.
7. Anda ingin mencatat partial progress.

Contoh event:

```text
validation.failed
rule.evaluated
retry.scheduled
fallback.selected
cache.miss
cache.hit
state.transition.applied
message.acknowledged
chunk.completed
external.response.classified
```

### 8.2 Kapan event bukan pilihan tepat

Jangan memakai event untuk:

- ribuan item dalam loop besar;
- full payload;
- high-volume per-row detail;
- data yang seharusnya menjadi log;
- data yang perlu retention audit;
- data yang sensitif.

Jika batch memproses 100.000 item, jangan membuat 100.000 span event.

Gunakan aggregate:

```text
chunk.item.count = 1000
chunk.success.count = 997
chunk.failure.count = 3
```

Dan log detail failure terbatas/rate-limited jika perlu.

---

## 9. Span Status and Error Recording

OpenTelemetry span memiliki status. Dalam praktik umum:

- `UNSET`: default, tidak eksplisit sukses atau error.
- `OK`: operasi eksplisit dianggap sukses.
- `ERROR`: operasi gagal.

Banyak instrumentation membiarkan success sebagai `UNSET`. Itu normal.

### 9.1 Kapan set ERROR

Set `ERROR` jika operation yang direpresentasikan span gagal.

Contoh:

- request gagal diproses;
- state transition gagal;
- dependency call gagal setelah retry habis;
- validation internal invariant gagal;
- authorization check gagal jika span merepresentasikan protected operation;
- batch chunk gagal;
- message processing gagal dan akan retry/DLQ.

Jangan set `ERROR` hanya karena ada exception yang ditangkap dan memang expected serta berhasil ditangani.

Contoh:

```text
Cache miss exception caught, fallback DB success
```

Span utama tidak perlu error. Bisa beri event:

```text
cache.lookup.failed
fallback.selected
```

### 9.2 Expected failure vs unexpected failure

Contoh expected failure:

```text
User submits invalid form.
Business validation rejects request.
HTTP 400 returned.
```

Apakah span error?

Tergantung semantic organization.

Untuk HTTP server span, banyak convention menganggap 4xx bukan selalu error dari sisi server. Tetapi untuk business operation `application.submit`, Anda mungkin ingin outcome failure dengan reason code, tanpa status ERROR jika itu normal user-correctable failure.

Contoh:

```text
span.setAttribute("outcome", "rejected");
span.setAttribute("reason.code", "DOCUMENT_EXPIRED");
```

Status tetap bisa `UNSET`.

Contoh unexpected failure:

```text
NullPointerException saat evaluate rule.
Database timeout saat persist transition.
External payment gateway timeout setelah retry habis.
```

Ini layak `ERROR`.

### 9.3 Error taxonomy untuk span

Gunakan attribute stabil:

```text
error.type = "TimeoutException"
error.category = "dependency_timeout"
error.retryable = true
error.owner = "external_dependency"
outcome = "failure"
reason.code = "ONEMAP_TIMEOUT"
```

Hindari:

```text
error.message = "Connection timed out for user fajar@example.com with token ..."
```

Message boleh ada, tetapi jangan menjadi field utama untuk grouping.

---

## 10. Exception Recording

Di Java OpenTelemetry API, pattern umum:

```java
try {
    // operation
} catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR, "failed to submit application");
    throw e;
} finally {
    span.end();
}
```

### 10.1 Stack trace once rule tetap berlaku

Jika Anda sudah punya central exception handler yang logging stack trace, jangan semua layer juga log stack trace penuh.

Tetapi merekam exception di span berbeda dari logging stack trace. Span exception membantu trace viewer menunjukkan error di span yang tepat.

Tetap gunakan disiplin:

- span record exception di boundary operation;
- log stack trace di boundary yang bertanggung jawab;
- jangan spam stack trace di tiap wrapper layer;
- jangan kehilangan cause chain.

### 10.2 Jangan swallow exception setelah set ERROR tanpa context

Buruk:

```java
catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR);
    return null;
}
```

Lebih baik:

```java
catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR, "failed to resolve eligibility");
    throw new EligibilityEvaluationException("Failed to resolve eligibility", e);
}
```

Atau jika fallback valid:

```java
catch (CacheException e) {
    span.addEvent("cache.lookup.failed", Attributes.of(
            stringKey("error.type"), e.getClass().getSimpleName()
    ));
    span.setAttribute("fallback.selected", "database");
    return loadFromDatabase(id);
}
```

Jangan tandai span utama sebagai error jika fallback membuat operasi berhasil.

---

## 11. Java Manual Tracing Basic Pattern

### 11.1 Dependency

Untuk library/application yang ingin manual instrumentation, dependency paling dasar:

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

Pada aplikasi, SDK/agent/auto-config biasanya disediakan oleh runtime atau framework. Library sebaiknya hanya bergantung pada API, bukan SDK.

### 11.2 Basic tracer

```java
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Tracer;

public final class Tracing {
    public static final Tracer TRACER =
            GlobalOpenTelemetry.getTracer("com.example.application-service");
}
```

Instrumentation scope name sebaiknya stabil dan menggambarkan library/module instrumentation.

Lebih baik:

```text
com.company.aceas.application.instrumentation
```

Daripada:

```text
ApplicationServiceImpl
```

### 11.3 Basic span pattern

```java
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Scope;

public SubmissionResult submit(SubmitCommand command) {
    Span span = tracer.spanBuilder("application.submit")
            .setAttribute("application.module", "application-management")
            .setAttribute("workflow.name", "application-submission")
            .startSpan();

    try (Scope scope = span.makeCurrent()) {
        SubmissionResult result = doSubmit(command);
        span.setAttribute("outcome", result.outcome().name());
        return result;
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "application submission failed");
        throw e;
    } finally {
        span.end();
    }
}
```

### 11.4 Why `try-with-resources Scope`

`span.makeCurrent()` membuat span menjadi current context, sehingga child spans otomatis punya parent yang benar.

Tanpa `makeCurrent()`:

```text
manual child span bisa orphan
logs mungkin tidak punya trace/span context
downstream instrumentation mungkin tidak menjadi child span
```

Pattern wajib:

```java
try (Scope scope = span.makeCurrent()) {
    ...
} finally {
    span.end();
}
```

### 11.5 Jangan lupa `span.end()`

Span yang tidak di-end akan menyebabkan telemetry rusak:

- duration tidak selesai;
- exporter mungkin tidak mengirim;
- memory/resource leak;
- trace viewer membingungkan.

---

## 12. Manual Tracing Helper: Mengurangi Boilerplate dengan Aman

Boilerplate manual tracing mudah salah. Buat helper.

### 12.1 Synchronous helper

```java
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

import java.util.function.Supplier;

public final class TraceSupport {
    private final Tracer tracer;

    public TraceSupport(Tracer tracer) {
        this.tracer = tracer;
    }

    public <T> T inSpan(String spanName, Attributes attributes, Supplier<T> supplier) {
        Span span = tracer.spanBuilder(spanName)
                .setAllAttributes(attributes)
                .startSpan();

        try (Scope scope = span.makeCurrent()) {
            T result = supplier.get();
            span.setAttribute("outcome", "success");
            return result;
        } catch (RuntimeException e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, e.getClass().getSimpleName());
            span.setAttribute("outcome", "failure");
            throw e;
        } finally {
            span.end();
        }
    }

    public void inSpan(String spanName, Attributes attributes, Runnable runnable) {
        inSpan(spanName, attributes, () -> {
            runnable.run();
            return null;
        });
    }
}
```

### 12.2 Checked exception helper

Java `Supplier` tidak mendukung checked exception. Buat functional interface.

```java
@FunctionalInterface
public interface CheckedSupplier<T, E extends Exception> {
    T get() throws E;
}

public <T, E extends Exception> T inCheckedSpan(
        String spanName,
        Attributes attributes,
        CheckedSupplier<T, E> supplier
) throws E {
    Span span = tracer.spanBuilder(spanName)
            .setAllAttributes(attributes)
            .startSpan();

    try (Scope scope = span.makeCurrent()) {
        T result = supplier.get();
        span.setAttribute("outcome", "success");
        return result;
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, e.getClass().getSimpleName());
        span.setAttribute("outcome", "failure");
        throw e;
    } finally {
        span.end();
    }
}
```

### 12.3 Jangan membuat helper yang menyembunyikan semantic

Buruk:

```java
trace("method", () -> service.call());
```

Lebih baik:

```java
trace("application.submit.evaluate_rules", attrs, () -> evaluateRules(command));
```

Helper mengurangi boilerplate, tetapi semantic tetap harus eksplisit.

---

## 13. Attribute Key Management

Jangan menulis string attribute key tersebar di seluruh codebase.

Buruk:

```java
span.setAttribute("workflowname", "submission");
span.setAttribute("workflow.name", "submission");
span.setAttribute("workflow_name", "submission");
```

Buat constants.

```java
import io.opentelemetry.api.common.AttributeKey;

public final class TelemetryAttributes {
    private TelemetryAttributes() {}

    public static final AttributeKey<String> APPLICATION_MODULE =
            AttributeKey.stringKey("application.module");

    public static final AttributeKey<String> WORKFLOW_NAME =
            AttributeKey.stringKey("workflow.name");

    public static final AttributeKey<String> WORKFLOW_STEP =
            AttributeKey.stringKey("workflow.step");

    public static final AttributeKey<String> OUTCOME =
            AttributeKey.stringKey("outcome");

    public static final AttributeKey<String> REASON_CODE =
            AttributeKey.stringKey("reason.code");

    public static final AttributeKey<Long> RULE_COUNT =
            AttributeKey.longKey("rule.count");

    public static final AttributeKey<Long> RULE_FAILED_COUNT =
            AttributeKey.longKey("rule.failed.count");
}
```

Penggunaan:

```java
span.setAttribute(TelemetryAttributes.WORKFLOW_NAME, "application-submission");
span.setAttribute(TelemetryAttributes.OUTCOME, "failure");
span.setAttribute(TelemetryAttributes.REASON_CODE, "DOCUMENT_EXPIRED");
```

Manfaat:

- schema lebih konsisten;
- refactor lebih aman;
- code review lebih mudah;
- governance lebih mungkin;
- typo berkurang.

---

## 14. Semantic Conventions vs Custom Attributes

OpenTelemetry Semantic Conventions menyediakan nama attribute standar untuk konsep umum:

- HTTP.
- RPC.
- database.
- messaging.
- errors.
- resources.
- server/client.
- code.
- deployment.
- exception/log-related concepts.

Gunakan semantic convention jika tersedia.

Contoh standard-like:

```text
http.request.method
url.scheme
server.address
server.port
db.system.name
db.namespace
messaging.system
messaging.destination.name
service.name
service.version
deployment.environment.name
```

Gunakan custom attributes untuk domain Anda:

```text
application.module
case.type
case.priority
workflow.name
workflow.step
transition.from
transition.to
rule.id
rule.failed.count
agency.code
```

Prinsip:

```text
Standard for common infrastructure.
Custom for domain-specific meaning.
```

Jangan membuat custom key untuk hal yang sudah distandarkan kecuali ada alasan kuat.

Buruk:

```text
httpVerb = POST
databaseType = oracle
environment = production
```

Lebih baik:

```text
http.request.method = POST
db.system.name = oracle
deployment.environment.name = prod
```

---

## 15. Span Links: Relasi Tanpa Parent-Child

Tidak semua hubungan adalah parent-child.

Contoh:

1. Batch job memproses 100 pesan dari trace berbeda.
2. Consumer memproses pesan yang diproduksi dari trace lama.
3. Workflow step dipicu oleh event dari operation sebelumnya.
4. Retried operation membuat eksekusi baru tetapi terkait attempt sebelumnya.
5. Fan-in aggregator menggabungkan banyak input.

Parent-child berarti:

```text
child caused directly by parent and usually starts within parent context
```

Link berarti:

```text
span ini related to another context, tetapi bukan child langsung
```

Contoh conceptual:

```text
Trace A:
  Span: application.submit
  Span: publish event

Trace B:
  Span: notification.consume_submitted_event
    Link to publish span context from Trace A
```

Dalam messaging, auto instrumentation biasanya mengatur propagation context. Tetapi untuk custom workflow/event store, span link bisa penting.

Pseudo-code:

```java
SpanContext linkedContext = extractContextFromMessage(message);

Span span = tracer.spanBuilder("notification.process_application_submitted")
        .addLink(linkedContext)
        .setSpanKind(SpanKind.CONSUMER)
        .startSpan();
```

Gunakan span link untuk:

- async delayed processing;
- batch fan-in;
- workflow continuation;
- event sourcing projection;
- DLQ replay;
- scheduled retry.

---

## 16. Async Tracing in Java

Async tracing adalah salah satu bagian paling sering rusak.

Masalah utamanya:

```text
Current context disimpan per execution context.
Ketika pindah thread, context bisa hilang jika tidak dipropagate.
```

### 16.1 CompletableFuture problem

Buruk:

```java
Span span = tracer.spanBuilder("application.submit").startSpan();

try (Scope scope = span.makeCurrent()) {
    CompletableFuture.supplyAsync(() -> callExternalService());
} finally {
    span.end();
}
```

Masalah:

- async task mungkin berjalan setelah span end;
- child span mungkin tidak punya parent;
- error async tidak tercatat di parent;
- duration parent tidak merefleksikan async operation.

### 16.2 Pattern: span around actual async operation

```java
public CompletableFuture<Result> submitAsync(Command command) {
    Span span = tracer.spanBuilder("application.submit.async")
            .startSpan();

    Context context = Context.current().with(span);

    return CompletableFuture.supplyAsync(context.wrapSupplier(() -> {
        try (Scope scope = span.makeCurrent()) {
            return doSubmit(command);
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, e.getClass().getSimpleName());
            throw e;
        }
    })).whenComplete((result, error) -> {
        if (error == null) {
            span.setAttribute("outcome", "success");
        } else {
            span.setAttribute("outcome", "failure");
        }
        span.end();
    });
}
```

Catatan: API exact untuk wrapping dapat berbeda tergantung versi, tetapi konsepnya sama:

```text
capture current context
wrap async runnable/supplier/callback
end span when async operation truly completes
```

### 16.3 Better architecture

Sering kali lebih baik span parent sync hanya mencatat scheduling, lalu async task punya span sendiri:

```text
Span: application.submit.schedule_async_processing
Span: application.async_processing.execute
```

Dengan link/correlation:

```text
schedule span -> async execution span
```

Ini lebih akurat jika work benar-benar terjadi setelah response dikembalikan.

### 16.4 Executor wrapper

Untuk Java 8–25 platform thread pools, gunakan context-aware executor.

```java
import io.opentelemetry.context.Context;

import java.util.concurrent.Executor;

public final class ContextAwareExecutor implements Executor {
    private final Executor delegate;

    public ContextAwareExecutor(Executor delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        Context context = Context.current();
        delegate.execute(context.wrap(command));
    }
}
```

Ini menjaga parent-child relation untuk child spans di task.

---

## 17. Virtual Threads and Manual Tracing

Virtual threads mengubah cost model thread, tetapi tidak menghapus kebutuhan context propagation.

Beberapa prinsip:

1. Virtual thread tetap punya execution context.
2. ThreadLocal/MDC masih bisa dipakai, tetapi harus hati-hati jumlah dan lifecycle.
3. Span context tetap perlu current scope yang benar.
4. Structured concurrency membuat parent-child task lebih eksplisit.
5. ScopedValue bisa menjadi model context immutable yang lebih aman untuk beberapa data application context, tetapi OpenTelemetry context tetap punya mekanisme sendiri.

### 17.1 Virtual thread per request

Jika server memakai virtual thread per request:

```text
request context lebih mudah karena thread tidak reused seperti pool tradisional
```

Tetapi async handoff masih ada:

- executor lain;
- CompletableFuture;
- scheduler;
- messaging;
- reactive stream;
- callback;
- native client.

Jadi tetap perlu context propagation.

### 17.2 StructuredTaskScope conceptual pattern

Pada Java modern:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Supplier<A> a = scope.fork(() -> callA());
    Supplier<B> b = scope.fork(() -> callB());

    scope.join();
    scope.throwIfFailed();

    return combine(a.get(), b.get());
}
```

Tracing implication:

```text
parent span: aggregate.operation
child span: dependency.a
child span: dependency.b
```

Jika context current diwariskan dengan benar ke child task, trace menjadi natural. Jika tidak, child spans bisa orphan.

---

## 18. Manual Tracing for HTTP Application Layer

Auto-instrumentation biasanya sudah membuat server span:

```text
POST /applications/{id}/submit
```

Manual span sebaiknya berada di bawahnya:

```text
POST /applications/{id}/submit
└── application.submit
    ├── application.submit.validate_input
    ├── application.submit.evaluate_rules
    ├── application.submit.persist_transition
    └── application.submit.publish_event
```

### 18.1 Controller should not own all tracing

Controller boundary biasanya terlalu teknis.

Buruk:

```java
@PostMapping("/submit")
public ResponseEntity<?> submit(...) {
    Span span = tracer.spanBuilder("ApplicationController.submit").startSpan();
    ...
}
```

Lebih baik:

- server span dari agent untuk HTTP;
- service layer span untuk domain operation;
- lower-level spans untuk meaningful phases.

```java
@PostMapping("/applications/{id}/submit")
public ResponseEntity<SubmitResponse> submit(@PathVariable String id,
                                             @RequestBody SubmitRequest request) {
    SubmitCommand command = mapper.toCommand(id, request);
    SubmitResult result = applicationSubmissionService.submit(command);
    return ResponseEntity.ok(mapper.toResponse(result));
}
```

Service:

```java
public SubmitResult submit(SubmitCommand command) {
    return traceSupport.inSpan(
            "application.submit",
            Attributes.of(
                    TelemetryAttributes.APPLICATION_MODULE, "application-management",
                    TelemetryAttributes.WORKFLOW_NAME, "application-submission"
            ),
            () -> submitInternal(command)
    );
}
```

### 18.2 Avoid duplicate HTTP spans

Jangan manual membuat span `http.post.submit` jika agent sudah membuat server span.

Manual span harus menambah semantic:

```text
application.submit
```

Bukan mengulang:

```text
POST /applications/{id}/submit
```

---

## 19. Manual Tracing for Business Rule Evaluation

Business rule evaluation sering menjadi black box di trace.

Contoh:

```java
public EligibilityResult evaluate(Application application) {
    Span span = tracer.spanBuilder("application.submit.evaluate_rules")
            .setAttribute("rule.engine", "internal")
            .setAttribute("rule.count", rules.size())
            .startSpan();

    int failed = 0;

    try (Scope scope = span.makeCurrent()) {
        for (Rule rule : rules) {
            RuleResult result = rule.evaluate(application);

            if (!result.passed()) {
                failed++;
                span.addEvent("rule.failed", Attributes.of(
                        AttributeKey.stringKey("rule.id"), rule.id(),
                        AttributeKey.stringKey("reason.code"), result.reasonCode()
                ));
            }
        }

        span.setAttribute("rule.failed.count", failed);
        span.setAttribute("outcome", failed == 0 ? "success" : "rejected");

        return failed == 0 ? EligibilityResult.passed() : EligibilityResult.rejected();
    } catch (RuntimeException e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "rule evaluation failed unexpectedly");
        throw e;
    } finally {
        span.end();
    }
}
```

### 19.1 Event volume control

Jika rules sedikit, event per failed rule masuk akal.

Jika rules ribuan:

```text
jangan event per rule
```

Gunakan aggregate:

```text
rule.count
rule.failed.count
rule.failed.categories
```

Dan log detail terbatas untuk failed cases.

---

## 20. Manual Tracing for State Machines and Workflow

State transition adalah salah satu area paling bernilai untuk manual tracing.

### 20.1 Span design

```text
case.transition
case.transition.validate
case.transition.apply
case.transition.publish_event
```

Attributes:

```text
workflow.name
entity.type
transition.from
transition.to
transition.trigger
transition.allowed
reason.code
actor.type
```

Hindari raw user identity sebagai attribute kalau sensitif.

### 20.2 Example

```java
public Case transition(CaseId caseId, TransitionCommand command) {
    Span span = tracer.spanBuilder("case.transition")
            .setAttribute("workflow.name", "enforcement-case")
            .setAttribute("entity.type", "case")
            .setAttribute("transition.from", command.fromState().name())
            .setAttribute("transition.to", command.toState().name())
            .setAttribute("transition.trigger", command.trigger().name())
            .startSpan();

    try (Scope scope = span.makeCurrent()) {
        Case updated = transitionInternal(caseId, command);
        span.setAttribute("outcome", "success");
        span.addEvent("state.transition.applied");
        return updated;
    } catch (InvalidTransitionException e) {
        span.setAttribute("outcome", "rejected");
        span.setAttribute("reason.code", e.reasonCode());
        // Depending on semantics, may not be StatusCode.ERROR if expected business rejection.
        throw e;
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "case transition failed");
        span.setAttribute("outcome", "failure");
        throw e;
    } finally {
        span.end();
    }
}
```

### 20.3 Why this matters

Saat incident:

```text
"Why did this case not move from REVIEW to APPROVED?"
```

Trace dapat menunjukkan:

```text
case.transition
  transition.from=REVIEW
  transition.to=APPROVED
  outcome=rejected
  reason.code=MISSING_REQUIRED_DOCUMENT
```

Ini jauh lebih berguna daripada:

```text
ERROR Cannot transition
```

---

## 21. Manual Tracing for Messaging

Messaging flow berbeda dari HTTP karena execution bisa delayed, retried, duplicated, reordered.

### 21.1 Producer span

Producer operation:

```text
application.submit.publish_event
```

Attributes:

```text
messaging.system = rabbitmq/kafka/custom
messaging.destination.name = application.submitted
messaging.operation.name = publish
message.type = ApplicationSubmitted
outcome = success
```

### 21.2 Consumer span

Consumer operation:

```text
notification.consume_application_submitted
```

Attributes:

```text
messaging.operation.name = process
message.type = ApplicationSubmitted
message.redelivery = true/false
retry.count = 2
outcome = success/failure
```

### 21.3 Context propagation

Message headers should carry trace context.

Conceptual:

```text
producer current context -> inject traceparent into message headers
consumer extracts traceparent -> creates consumer span
```

Do not invent correlation-only tracing if W3C trace context can be used.

Keep separate:

```text
traceparent: technical distributed trace propagation
correlation.id: business/log correlation
message.id: broker/application message identity
causation.id: event-causality identity
```

### 21.4 DLQ/retry event

Add span event:

```text
message.retry.scheduled
message.dead_lettered
message.acknowledged
message.nacked
```

But avoid one event per internal low-level ack if noisy.

---

## 22. Manual Tracing for Batch and Scheduler

Batch systems need different tracing shape.

Bad trace:

```text
one trace with 500,000 item spans
```

Good trace:

```text
batch.reconcile
├── batch.reconcile.prepare
├── batch.reconcile.chunk
├── batch.reconcile.chunk
├── batch.reconcile.chunk
└── batch.reconcile.summary
```

### 22.1 Batch attributes

```text
job.name
job.execution.id
chunk.index
chunk.size
item.success.count
item.failure.count
retry.count
outcome
```

### 22.2 Example

```java
public void processChunk(JobExecution execution, int chunkIndex, List<Item> items) {
    Span span = tracer.spanBuilder("batch.application_reconciliation.chunk")
            .setAttribute("job.name", "application-reconciliation")
            .setAttribute("chunk.index", chunkIndex)
            .setAttribute("chunk.size", items.size())
            .startSpan();

    int success = 0;
    int failed = 0;

    try (Scope scope = span.makeCurrent()) {
        for (Item item : items) {
            try {
                processItem(item);
                success++;
            } catch (Exception e) {
                failed++;
                // Avoid recording every exception if volume can explode.
                // Consider sampled/rate-limited logs for item-level errors.
            }
        }

        span.setAttribute("item.success.count", success);
        span.setAttribute("item.failure.count", failed);
        span.setAttribute("outcome", failed == 0 ? "success" : "partial_failure");

        if (failed > 0) {
            span.addEvent("chunk.partial_failure");
        }
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "chunk failed");
        throw e;
    } finally {
        span.end();
    }
}
```

### 22.3 Scheduler

For scheduled tasks:

```text
scheduler.job.execute
```

Attributes:

```text
job.name
schedule.type
scheduled.time
actual.start.delay.ms
lock.acquired
leader.instance
outcome
```

If job skipped because another node holds lock:

```text
outcome = skipped
reason.code = LOCK_NOT_ACQUIRED
```

Not necessarily error.

---

## 23. Manual Tracing for Retries, Fallbacks, and Timeouts

Retries are often invisible without manual instrumentation.

### 23.1 Span structure options

Option A: one span with retry events

```text
onemap.resolve_address
  event retry.attempt {attempt=1}
  event retry.scheduled {delay.ms=250}
  event retry.attempt {attempt=2}
  outcome=success
  retry.count=1
```

Option B: parent span with child spans per attempt

```text
onemap.resolve_address
├── onemap.resolve_address.attempt
├── onemap.resolve_address.backoff
└── onemap.resolve_address.attempt
```

Use child spans per attempt if each attempt has meaningful latency/dependency detail.

Use events if attempts are simple and you want lower overhead.

### 23.2 Timeout attributes

```text
timeout.type = connect/read/write/acquire/deadline
timeout.ms = 3000
retry.count = 2
retry.max = 3
fallback.selected = cache
outcome = success/failure
```

### 23.3 Fallback semantics

If fallback succeeds:

```text
dependency primary failed
operation overall success
```

Represent that nuance.

```java
span.addEvent("primary_dependency.failed", Attributes.of(
        stringKey("dependency.name"), "onemap",
        stringKey("error.type"), "TimeoutException"
));
span.setAttribute("fallback.selected", "cached_address");
span.setAttribute("outcome", "success");
```

Do not mark parent span ERROR unless overall operation failed.

---

## 24. Manual Tracing for Idempotency

Idempotency is a logical consistency boundary.

### 24.1 Span design

```text
payment.capture
├── payment.capture.check_idempotency
├── payment.capture.execute_gateway_call
└── payment.capture.persist_result
```

Attributes:

```text
idempotency.status = new/replay/conflict/expired
idempotency.key.present = true
idempotency.conflict = false
outcome = success
```

Avoid storing raw idempotency key if it is high-cardinality or sensitive.

You may store hashed/truncated form in logs if policy allows, but be careful in traces.

### 24.2 Example

```java
Span span = tracer.spanBuilder("application.submit.check_idempotency")
        .setAttribute("idempotency.key.present", command.idempotencyKey() != null)
        .startSpan();

try (Scope scope = span.makeCurrent()) {
    IdempotencyDecision decision = idempotencyService.check(command);
    span.setAttribute("idempotency.status", decision.status().name().toLowerCase());
    span.setAttribute("outcome", decision.allowed() ? "success" : "rejected");
    return decision;
} finally {
    span.end();
}
```

---

## 25. Manual Tracing for Security and Authorization

Security-related tracing is useful but dangerous.

### 25.1 What to include

Safe-ish attributes:

```text
auth.decision = allow/deny
auth.scheme = session/oauth2/api_key
auth.policy.name = case-access-policy
auth.reason.code = ROLE_MISSING
actor.type = internal_user/external_user/system
resource.type = case
```

Be careful with:

```text
user.id
username
email
NRIC
JWT claims
roles if sensitive
full policy input
```

### 25.2 Deny as error?

Authorization denied is often expected behavior. Do not always mark span `ERROR`.

Example:

```text
auth.decision=deny
outcome=rejected
reason.code=INSUFFICIENT_ROLE
```

Status can remain `UNSET` if denial is valid business/security response.

But if authorization system fails:

```text
policy engine timeout
JWKS fetch failed
token parser exception
```

Then mark error.

---

## 26. Trace-Log Correlation

Manual span design should support logs.

Inside current span, logs can include:

```text
trace.id
span.id
correlation.id
event.name
```

With Java agent and supported logging integrations, trace/span IDs may be injected into MDC automatically depending configuration.

Manual code should not manually generate trace IDs. Use OpenTelemetry context.

Example log event inside span:

```java
log.info("Application submission rule evaluation completed",
        kv("event.name", "application.rule_evaluation.completed"),
        kv("rule.count", ruleCount),
        kv("rule.failed.count", failedCount),
        kv("outcome", outcome));
```

Trace tells structure. Log tells detail.

Do not put everything into span attributes.

---

## 27. Trace-Metric Correlation

Manual tracing complements metrics.

For important operations, also expose metrics:

```text
application_submission_duration
application_submission_total
application_submission_failure_total
rule_evaluation_duration
batch_chunk_processed_total
```

But do not put high-cardinality IDs in metric labels.

Trace is good for one execution.

Metric is good for aggregate behavior.

Log is good for detail.

JFR/profiler is good for runtime mechanics.

A top-tier engineer knows which evidence belongs where.

---

## 28. Sampling and Manual Spans

Sampling affects whether traces are recorded/exported.

If a trace is not sampled, manual spans may be no-op or minimally active depending SDK behavior.

Design implication:

1. Manual instrumentation should be cheap.
2. Do not rely only on traces for audit.
3. Critical business records must go to durable audit/log/database.
4. Trace attributes should not be the only place storing important decision data.
5. For rare incidents, consider tail sampling in collector if available.

### 28.1 Sampling risk

If you sample 1% traces:

```text
rare failure might be missed
```

Mitigations:

- error-biased tail sampling;
- per-route sampling;
- per-service sampling;
- span/log correlation;
- event logs for critical failures;
- on-demand debug sampling.

---

## 29. Privacy and Compliance

Trace data often leaves the application process and enters observability vendor/platform.

Treat trace attributes as potentially sensitive operational data.

Do not include:

- raw NRIC/passport/identity number;
- email;
- phone;
- access token;
- refresh token;
- session cookie;
- Authorization header;
- full request body;
- full response body;
- raw SQL with literals;
- full address;
- free text from users;
- confidential document content;
- secrets from config.

Prefer:

```text
reason.code
policy.name
rule.id
status category
resource.type
hashed/truncated ID only if approved
```

Top-tier rule:

> A trace should explain the operation, not leak the subject.

---

## 30. Manual Instrumentation in Libraries vs Applications

### 30.1 Library code

Library should:

- depend only on OpenTelemetry API if needed;
- avoid configuring SDK/exporter;
- avoid forcing vendor;
- use stable instrumentation scope name;
- keep attributes generic;
- avoid business-specific semantics unless library is domain-specific.

### 30.2 Application code

Application can:

- define domain spans;
- define domain attributes;
- configure SDK/agent;
- define sampling;
- integrate logs/metrics/traces;
- enforce governance.

### 30.3 Shared internal platform library

For company-internal libraries, useful helpers:

- `TraceSupport`;
- `TelemetryAttributes`;
- `ContextAwareExecutor`;
- `SpanNaming`;
- `ObservationPolicy`;
- `RedactionPolicy`;
- `ErrorClassifier`.

But avoid hiding semantic decisions too deeply.

---

## 31. Common Anti-Patterns

### 31.1 Span per method

```text
Every method gets a span.
```

Result:

- trace unreadable;
- overhead high;
- no semantic value;
- refactor breaks observability.

### 31.2 High-cardinality span names

```text
application.submit.12345
```

Bad for aggregation.

### 31.3 Full payload attributes

```text
request.body = entire JSON
```

Compliance and cost problem.

### 31.4 Every exception is ERROR

Expected validation rejection is not necessarily system error.

### 31.5 Parent span ends before async work

Creates misleading duration and orphan child spans.

### 31.6 Manual HTTP spans duplicate agent spans

Trace becomes noisy and confusing.

### 31.7 Attribute schema chaos

Different teams use different keys for same thing.

```text
workflowName
workflow.name
flow
process
```

Query becomes painful.

### 31.8 Trace as audit log

Trace is sampled, operational, and retention-limited. Audit needs stronger guarantees.

### 31.9 Baggage abuse

Baggage propagates across services. Do not put large/sensitive/high-cardinality data there.

### 31.10 No span events for decision points

Trace shows duration but not why branch was taken.

---

## 32. Production Span Design Review Checklist

For every proposed manual span, ask:

1. What question will this span answer during incident?
2. Is the span name stable and low-cardinality?
3. Is the boundary logical, not merely method-level?
4. Does the span have meaningful duration?
5. Is this already covered by auto-instrumentation?
6. Are attributes useful and safe?
7. Are attributes low/controlled cardinality?
8. Are errors classified consistently?
9. Are expected business rejections separated from system failures?
10. Does async work end span at the correct time?
11. Does context propagate across thread/message boundaries?
12. Are logs correlated with current trace/span?
13. Is important audit data stored outside trace?
14. Is there a sampling strategy?
15. Is PII/secret avoided?
16. Will this still make sense after refactor?
17. Can SRE/dev query this span reliably?
18. Is event volume bounded?
19. Does it improve signal-to-noise?
20. Is ownership clear?

If answer banyak “tidak”, jangan tambahkan span dulu.

---

## 33. Reference Span Catalog for Enterprise Java Systems

### 33.1 HTTP command operation

```text
<domain>.<command>
```

Example:

```text
application.submit
case.assign
payment.capture
document.generate
```

Attributes:

```text
application.module
workflow.name
outcome
reason.code
```

### 33.2 Validation

```text
<domain>.<operation>.validate_input
<domain>.<operation>.validate_business_rules
```

Attributes:

```text
validation.error.count
reason.code
outcome
```

### 33.3 State transition

```text
<entity>.transition
```

Attributes:

```text
entity.type
transition.from
transition.to
transition.trigger
outcome
reason.code
```

### 33.4 External dependency orchestration

```text
<dependency_domain>.<operation>
```

Example:

```text
address.resolve
identity.verify
payment.authorize
notification.send
```

Attributes:

```text
dependency.name
dependency.operation
retry.count
fallback.selected
outcome
```

### 33.5 Batch

```text
batch.<job_name>
batch.<job_name>.chunk
batch.<job_name>.summary
```

Attributes:

```text
job.name
job.execution.id
chunk.index
chunk.size
item.success.count
item.failure.count
```

### 33.6 Messaging

```text
<domain>.publish_<event>
<domain>.consume_<event>
<domain>.process_<command>
```

Attributes:

```text
message.type
messaging.destination.name
message.redelivery
retry.count
outcome
```

### 33.7 Workflow

```text
workflow.<workflow_name>.<step_name>
```

Attributes:

```text
workflow.name
workflow.step
workflow.instance.type
outcome
reason.code
```

---

## 34. Example: End-to-End Manual Tracing for Application Submission

### 34.1 Target trace

```text
POST /applications/{id}/submit                         [auto SERVER]
└── application.submit                                  [manual INTERNAL]
    ├── application.submit.validate_input               [manual INTERNAL]
    ├── application.submit.load_aggregate               [manual INTERNAL]
    │   └── SELECT application                          [auto CLIENT/JDBC]
    ├── application.submit.evaluate_rules               [manual INTERNAL]
    │   ├── Event: rule.failed
    │   └── Event: rule_evaluation.completed
    ├── application.submit.persist_transition           [manual INTERNAL]
    │   └── UPDATE application                          [auto CLIENT/JDBC]
    └── application.submit.publish_event                [manual PRODUCER/custom or auto]
```

### 34.2 Service code sketch

```java
public SubmitResult submit(SubmitCommand command) {
    Span span = tracer.spanBuilder("application.submit")
            .setAttribute("application.module", "application-management")
            .setAttribute("workflow.name", "application-submission")
            .startSpan();

    try (Scope scope = span.makeCurrent()) {
        validateInput(command);

        Application application = loadAggregate(command.applicationId());

        EligibilityResult eligibility = evaluateRules(application);

        if (!eligibility.allowed()) {
            span.setAttribute("outcome", "rejected");
            span.setAttribute("reason.code", eligibility.reasonCode());
            return SubmitResult.rejected(eligibility.reasonCode());
        }

        Application submitted = persistTransition(application);

        publishSubmittedEvent(submitted);

        span.setAttribute("outcome", "success");
        return SubmitResult.success(submitted.id());
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "application submit failed");
        span.setAttribute("outcome", "failure");
        throw e;
    } finally {
        span.end();
    }
}
```

### 34.3 Phase method example

```java
private EligibilityResult evaluateRules(Application application) {
    Span span = tracer.spanBuilder("application.submit.evaluate_rules")
            .setAttribute("rule.engine", "internal")
            .startSpan();

    try (Scope scope = span.makeCurrent()) {
        EligibilityResult result = ruleEngine.evaluate(application);

        span.setAttribute("rule.count", result.ruleCount());
        span.setAttribute("rule.failed.count", result.failedCount());
        span.setAttribute("outcome", result.allowed() ? "success" : "rejected");

        result.failedRules().stream()
                .limit(5)
                .forEach(rule -> span.addEvent("rule.failed", Attributes.of(
                        AttributeKey.stringKey("rule.id"), rule.id(),
                        AttributeKey.stringKey("reason.code"), rule.reasonCode()
                )));

        return result;
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "rule evaluation crashed");
        throw e;
    } finally {
        span.end();
    }
}
```

Notice:

- failed business eligibility is not necessarily `StatusCode.ERROR`;
- unexpected crash is `ERROR`;
- event volume is bounded with `.limit(5)`;
- raw application ID is not placed in span attribute;
- rule IDs/reason codes are stable and queryable.

---

## 35. Testing Manual Instrumentation

Observability code should be tested like other behavior.

### 35.1 What to test

1. Span created with correct name.
2. Attributes set correctly.
3. Error status set on unexpected exception.
4. Exception recorded.
5. Span ended.
6. Child span parent relationship is correct.
7. Context propagates across async boundary.
8. Sensitive data not included.
9. Expected rejection does not become system error if policy says so.

### 35.2 Unit testing idea

Use OpenTelemetry SDK testing utilities where possible.

Conceptual structure:

```java
@Test
void submitRejectedSetsOutcomeRejected() {
    // arrange test exporter / in-memory span exporter
    // call service
    // assert span name application.submit
    // assert attribute outcome=rejected
    // assert reason.code=DOCUMENT_EXPIRED
    // assert status is not ERROR if expected rejection
}
```

### 35.3 Golden trace tests

For critical flows, keep trace shape expectation:

```text
application.submit
application.submit.validate_input
application.submit.evaluate_rules
application.submit.persist_transition
```

Do not overfit to every JDBC span because auto-instrumentation version may change.

Test domain spans, not vendor-specific trace rendering.

---

## 36. Operational Query Examples

Good manual tracing enables useful queries.

### 36.1 Find slow rule evaluation

```text
span.name = application.submit.evaluate_rules
duration > 500ms
```

Group by:

```text
rule.engine
application.module
deployment.environment.name
```

### 36.2 Find rejected submissions by reason

```text
span.name = application.submit
outcome = rejected
```

Group by:

```text
reason.code
```

### 36.3 Find state transition failures

```text
span.name = case.transition
outcome = failure OR outcome = rejected
```

Group by:

```text
transition.from
transition.to
reason.code
```

### 36.4 Find retry-heavy dependency

```text
dependency.name = onemap
retry.count > 0
```

Group by:

```text
outcome
error.type
fallback.selected
```

### 36.5 Find partial batch failures

```text
span.name = batch.application_reconciliation.chunk
item.failure.count > 0
```

Group by:

```text
job.name
reason.code
```

---

## 37. Troubleshooting Broken Manual Traces

### 37.1 Span tidak muncul

Possible causes:

- no SDK/agent configured;
- exporter disabled;
- sampler drops trace;
- span not ended;
- exception before span creation;
- instrumentation scope filtered;
- collector pipeline drops spans.

Check:

```text
Is OTel agent/SDK loaded?
Is OTEL_TRACES_EXPORTER set?
Is endpoint reachable?
Is sampling too low?
Is span.end() called?
```

### 37.2 Child span appears as root

Possible causes:

- missing `span.makeCurrent()`;
- context lost across thread;
- async callback not wrapped;
- message context not extracted;
- custom executor not context-aware.

### 37.3 Trace too noisy

Possible causes:

- span per method;
- loop spans;
- duplicate HTTP spans;
- too many rule events;
- instrumentation overlap.

Fix:

- remove low-value spans;
- aggregate;
- use events instead of child spans;
- disable duplicate auto instrumentation if needed;
- create span design standard.

### 37.4 Error rate wrong

Possible causes:

- expected validation marked as `ERROR`;
- caught fallback exception marked as parent error;
- dependency attempt error propagated to overall operation;
- HTTP 4xx policy inconsistent.

Fix:

- define error taxonomy;
- separate `outcome` from `StatusCode.ERROR`;
- use reason code;
- classify expected rejection.

### 37.5 Attribute missing

Possible causes:

- span not current;
- attributes set after span ended;
- wrong helper path;
- exception path skips attribute;
- schema typo.

Fix:

- set baseline attributes at span creation;
- use constants;
- use finally carefully;
- test failure path.

---

## 38. Practical Lab 1 — Add Manual Tracing to Service Operation

### Task

Instrument service operation:

```text
application.submit
```

Required spans:

```text
application.submit
application.submit.validate_input
application.submit.evaluate_rules
application.submit.persist_transition
application.submit.publish_event
```

Required attributes:

```text
application.module
workflow.name
outcome
reason.code
rule.count
rule.failed.count
transition.from
transition.to
```

Rules:

- no raw user email;
- no request body;
- no application ID in span name;
- expected validation rejection should be `outcome=rejected`;
- unexpected exception should set status `ERROR`;
- span must always end.

### Expected result

Trace should tell:

```text
Submission rejected because DOCUMENT_EXPIRED during rule evaluation.
No state transition was persisted.
No event was published.
```

---

## 39. Practical Lab 2 — Async Context Propagation

### Task

Instrument operation:

```text
document.generate_async
```

Flow:

```text
HTTP request schedules document generation.
Async worker generates PDF.
Worker uploads file.
Worker publishes event.
```

Design two alternatives:

Alternative A:

```text
single trace with async span child
```

Alternative B:

```text
separate trace linked by span link / correlation ID
```

Discuss:

- which duration is more honest;
- how to handle response-before-work-complete;
- where to put job execution ID;
- how to correlate logs.

---

## 40. Practical Lab 3 — Batch Chunk Tracing

### Task

Instrument batch:

```text
batch.application_reconciliation
```

Requirements:

- parent job span;
- chunk spans;
- item count attributes;
- failure count attributes;
- bounded error events;
- no span per item unless item count tiny and debug mode only;
- summary log with trace ID.

Expected shape:

```text
batch.application_reconciliation
├── batch.application_reconciliation.prepare
├── batch.application_reconciliation.chunk
├── batch.application_reconciliation.chunk
└── batch.application_reconciliation.summary
```

---

## 41. Practical Lab 4 — Retry and Fallback Tracing

### Task

Instrument address lookup dependency:

```text
address.resolve
```

Flow:

1. call external address API;
2. if timeout, retry twice;
3. if still fail, use stale cache if available;
4. if no cache, fail operation.

Required attributes:

```text
dependency.name
retry.count
retry.max
fallback.selected
outcome
error.type
```

Expected interpretation:

- primary dependency failed;
- fallback may make overall operation success;
- parent span should not be `ERROR` if fallback success;
- span events should show retry schedule.

---

## 42. Production Manual Tracing Standard Template

Gunakan template berikut untuk design review.

```markdown
# Manual Tracing Design: <Operation Name>

## Operation
- Span name:
- Owner:
- Service:
- Domain:
- Trigger:
- Sync/async:

## Why this span exists
- Incident question answered:
- Latency question answered:
- Failure question answered:

## Boundary
- Starts when:
- Ends when:
- Parent span:
- Child spans:
- Links:

## Attributes
| Key | Type | Cardinality | Sensitive? | Example | Required? |
|---|---|---:|---|---|---|

## Events
| Event Name | When emitted | Attributes | Volume bound |
|---|---|---|---|

## Error Semantics
- Expected rejection:
- Unexpected failure:
- Retry exhausted:
- Fallback success:
- StatusCode policy:

## Async/Context Propagation
- Thread boundary:
- Message boundary:
- Context injection/extraction:
- Executor wrapper needed:

## Logs/Metrics Correlation
- Related log event names:
- Related metrics:
- Trace-log correlation fields:

## Privacy
- PII excluded:
- Secret excluded:
- High-cardinality controlled:

## Testing
- Unit tests:
- Failure-path tests:
- Async propagation tests:
```

---

## 43. Mini Case Study: Trace That Looks Complete but Is Useless

### Situation

A service has auto-instrumentation enabled.

Trace:

```text
POST /submit
├── SELECT application
├── SELECT document
├── SELECT rules
├── UPDATE application
└── INSERT audit_trail
```

Incident question:

```text
Why did application A move to PENDING_REVIEW instead of AUTO_APPROVED?
```

Trace cannot answer.

Why?

Because technical spans show database calls but not decision logic.

### Better trace

```text
POST /applications/{id}/submit
└── application.submit
    ├── application.submit.load_aggregate
    ├── application.submit.evaluate_auto_approval
    │   ├── Event: rule.failed {rule.id=RISK_SCORE_THRESHOLD}
    │   └── outcome=rejected
    ├── application.submit.resolve_next_state
    │   ├── transition.from=DRAFT
    │   ├── transition.to=PENDING_REVIEW
    │   └── reason.code=AUTO_APPROVAL_RULE_FAILED
    └── application.submit.persist_transition
```

Now trace answers:

```text
Application moved to PENDING_REVIEW because auto approval failed due to RISK_SCORE_THRESHOLD.
```

This is the point of manual tracing.

---

## 44. Summary

Manual tracing is not about adding spans everywhere.

Manual tracing is about designing **causal evidence**.

Key lessons:

1. Auto-instrumentation gives technical boundary visibility.
2. Manual tracing gives domain and decision visibility.
3. Span boundary should follow meaningful operations, not method names.
4. Span names must be stable and low-cardinality.
5. Attributes must be queryable, safe, and governed.
6. Span events capture point-in-time decisions.
7. Error status must distinguish expected rejection from system failure.
8. Async tracing requires explicit context propagation.
9. Messaging and batch need different trace shapes.
10. Trace is not audit log.
11. Trace is not full payload storage.
12. Good manual tracing lets you reconstruct causality under pressure.

The top-tier mental model:

```text
A trace should not merely show what code ran.
A trace should explain why the system behaved the way it did.
```

---

## 45. Readiness Checklist

Anda siap lanjut jika bisa menjawab:

1. Apa perbedaan auto-instrumentation dan manual instrumentation?
2. Kapan sebuah operation layak menjadi span?
3. Kenapa span name tidak boleh mengandung ID?
4. Apa beda span attribute dan span event?
5. Kapan exception perlu `recordException()`?
6. Kapan failure tidak perlu `StatusCode.ERROR`?
7. Bagaimana tracing berubah di async flow?
8. Apa beda parent-child dan span link?
9. Kenapa trace bukan audit log?
10. Bagaimana menghindari trace cardinality explosion?
11. Bagaimana mendesain tracing untuk batch chunk?
12. Bagaimana tracing retry/fallback secara akurat?
13. Bagaimana menjaga context propagation di executor?
14. Apa attribute domain yang aman untuk state transition?
15. Bagaimana trace membantu menjawab root cause, bukan hanya call graph?

---

## 46. Next Part

Part berikutnya:

```text
Part 15 — Metrics Engineering: RED, USE, JVM, Application, Business Metrics
```

Di sana kita akan membahas metric bukan sebagai angka dashboard, tetapi sebagai **aggregate truth** untuk reliability engineering: rate, error, duration, saturation, JVM metrics, DB pool metrics, queue metrics, business metrics, SLI/SLO, histogram, cardinality, dan metric governance.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./13-opentelemetry-java-agent-zero-code-instrumentation-java-8-plus.md">⬅️ Part 13 — OpenTelemetry Java Agent: Zero-Code Instrumentation for Java 8+</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./15-metrics-engineering-red-use-jvm-application-business-metrics.md">Part 15 — Metrics Engineering: RED, USE, JVM, Application, Business Metrics ➡️</a>
</div>
