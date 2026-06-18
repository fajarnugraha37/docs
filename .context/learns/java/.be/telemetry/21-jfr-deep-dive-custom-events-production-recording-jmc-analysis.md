# Part 21 — JFR Deep Dive II: Custom Events, Production Recording, JMC Analysis

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
File: `21-jfr-deep-dive-custom-events-production-recording-jmc-analysis.md`  
Target: Java 8 sampai Java 25  
Level: Advanced / Production Engineering / Top 1% Runtime Diagnostics

---

## 0. Posisi Part Ini dalam Series

Pada Part 20, kita membangun mental model dasar Java Flight Recorder atau JFR sebagai **black box recorder JVM**: event recorder yang built-in ke HotSpot JVM, berbiaya rendah, dan bisa dipakai di production untuk menangkap bukti runtime yang biasanya tidak terlihat dari log, metric, atau trace.

Part 21 masuk lebih dalam:

1. Bagaimana membuat **custom JFR event** untuk domain aplikasi.
2. Bagaimana menjalankan JFR secara **production-grade**: continuous recording, on-demand dump, emergency capture, startup recording, dan incident automation.
3. Bagaimana menganalisis `.jfr` memakai **JDK Mission Control** dan CLI `jfr`.
4. Bagaimana menghubungkan JFR dengan log, metric, trace, thread dump, heap dump, dan profiler.
5. Bagaimana memakai JFR bukan hanya sebagai profiler, tetapi sebagai **runtime evidence stream**.

Goal akhirnya: setelah part ini, kamu tidak hanya tahu command `jcmd JFR.start`, tetapi mampu mendesain strategi JFR untuk sistem Java enterprise yang kompleks: HTTP, batch, workflow, scheduler, messaging, DB, cache, external API, virtual threads, container, dan incident response.

---

## 1. Mental Model: JFR adalah Event Ledger di Dalam JVM

JFR bukan logger. JFR bukan APM. JFR bukan heap dump. JFR bukan thread dump. JFR adalah **event ledger** yang berjalan di dalam JVM.

Setiap event JFR menjawab pertanyaan:

```text
Pada waktu X,
thread Y,
di JVM/service Z,
terjadi event jenis A,
dengan durasi D,
dengan payload P,
dan optional stack trace S.
```

Contoh event built-in:

```text
GC pause happened.
Thread parked.
Socket read took 800 ms.
File write happened.
Object allocation sampled.
Monitor was contended.
Exception was thrown.
Method sample captured.
Virtual thread was pinned.
```

Custom event aplikasi bisa seperti:

```text
Case state transition evaluated.
Workflow escalation rule matched.
External dependency retry exhausted.
Batch chunk committed.
Idempotency duplicate detected.
Authorization decision denied.
Template rendering completed.
Regulatory validation produced N violations.
```

Jadi JFR bisa menjadi jembatan antara:

- JVM internals,
- application runtime,
- business/domain workflow,
- incident investigation.

---

## 2. Kenapa Custom JFR Event Penting?

Log bisa mencatat domain event. Trace bisa mencatat call path. Metric bisa mencatat agregasi. Tapi ada celah:

1. Log bisa terlalu noisy.
2. Trace bisa sampling, sehingga event penting hilang.
3. Metric kehilangan individual event detail.
4. Profiler tidak tahu business meaning.
5. Thread dump hanya snapshot.
6. Heap dump terlalu berat untuk sering diambil.

Custom JFR event mengisi celah itu karena:

1. Berjalan di runtime JVM secara efisien.
2. Bisa aktif hanya ketika recording aktif.
3. Bisa menyimpan payload domain yang terstruktur.
4. Bisa membawa durasi dan stack trace jika perlu.
5. Bisa dianalisis bersama event JVM seperti GC, lock, allocation, socket, dan thread.
6. Bisa disimpan sebagai `.jfr` untuk post-mortem.

Dengan custom JFR event, kamu bisa bertanya:

```text
Saat latency spike, apakah business rule tertentu lebih lambat?
Apakah escalation engine menyebabkan allocation spike?
Apakah case transition lambat karena DB, lock, remote API, atau rule evaluation?
Apakah retry storm terlihat bersamaan dengan socket timeout dan thread park?
Apakah virtual thread pinning terjadi pada flow tertentu?
```

---

## 3. Kapan Memakai Custom JFR Event, Bukan Log/Metric/Trace?

Gunakan custom JFR event ketika event tersebut:

1. Penting untuk diagnosis runtime.
2. Tidak harus selalu dikirim ke log backend.
3. Membutuhkan durasi, thread, stack, dan korelasi JVM-level.
4. Terjadi di hot path tetapi tidak ingin menghasilkan log volume tinggi.
5. Perlu dianalisis saat incident atau load test.
6. Memiliki payload domain teknis yang berguna untuk engineer, bukan user/auditor.
7. Bisa disimpan locally dalam recording buffer.

Jangan gunakan custom JFR event untuk:

1. Audit compliance utama.
2. Security alert utama.
3. Business reporting.
4. Long-term analytics.
5. Data yang wajib searchable real-time oleh support team.
6. Data sensitif yang tidak boleh masuk artifact diagnostik.

Rule sederhana:

```text
Log = operational/diagnostic/event trail yang perlu masuk platform log.
Metric = agregasi numerik untuk dashboard/alert.
Trace = causal path lintas service/request.
JFR = high-fidelity runtime evidence di JVM, terutama untuk incident dan performance diagnosis.
```

---

## 4. JFR API: Konsep Dasar

JFR custom event dibuat dengan subclass `jdk.jfr.Event`.

Contoh minimal:

```java
import jdk.jfr.Event;
import jdk.jfr.Label;
import jdk.jfr.Category;
import jdk.jfr.Description;

@Label("Case Transition")
@Category({"ACEAS", "Workflow"})
@Description("Emitted when a case state transition is evaluated")
public class CaseTransitionEvent extends Event {
    @Label("Case ID")
    public String caseId;

    @Label("From State")
    public String fromState;

    @Label("To State")
    public String toState;

    @Label("Outcome")
    public String outcome;

    @Label("Rule Count")
    public int ruleCount;
}
```

Penggunaan:

```java
CaseTransitionEvent event = new CaseTransitionEvent();
event.caseId = caseId;
event.fromState = fromState;
event.toState = toState;
event.ruleCount = rules.size();

event.begin();
try {
    TransitionResult result = transitionEngine.evaluate(caseId, fromState, toState);
    event.outcome = result.allowed() ? "allowed" : "denied";
    return result;
} finally {
    event.commit();
}
```

Jika `begin()` dan `commit()` dipakai, event memiliki durasi. Jika hanya `commit()` dipakai tanpa `begin()`, event menjadi instant event.

---

## 5. Lifecycle Custom Event

Ada tiga pola umum.

### 5.1 Instant Event

Cocok untuk kejadian titik waktu.

```java
@Label("Duplicate Request Detected")
@Category({"Application", "Idempotency"})
public class DuplicateRequestEvent extends Event {
    public String idempotencyKey;
    public String operation;
    public String originalRequestId;
}
```

Usage:

```java
DuplicateRequestEvent event = new DuplicateRequestEvent();
event.idempotencyKey = safeKey;
event.operation = operationName;
event.originalRequestId = originalRequestId;
event.commit();
```

Use case:

- duplicate request,
- retry exhausted,
- config reloaded,
- circuit breaker opened,
- feature flag switched,
- security decision denied.

### 5.2 Duration Event

Cocok untuk operasi yang butuh latency analysis.

```java
RuleEvaluationEvent event = new RuleEvaluationEvent();
event.ruleSet = ruleSetName;
event.ruleCount = rules.size();

event.begin();
try {
    return evaluator.evaluate(input);
} finally {
    event.commit();
}
```

Use case:

- business rule evaluation,
- template rendering,
- PDF generation,
- object mapping,
- validation engine,
- DB logical operation,
- external API wrapper,
- batch chunk processing.

### 5.3 Conditional Event

Cocok untuk menghindari overhead field population mahal ketika event tidak aktif.

```java
RuleEvaluationEvent event = new RuleEvaluationEvent();
if (event.isEnabled()) {
    event.ruleSet = ruleSetName;
    event.ruleCount = rules.size();
}

event.begin();
try {
    return evaluator.evaluate(input);
} finally {
    if (event.shouldCommit()) {
        event.outcome = "completed";
        event.commit();
    }
}
```

Catatan:

- `isEnabled()` membantu menghindari pekerjaan persiapan field yang mahal.
- `shouldCommit()` mempertimbangkan threshold/duration setting.
- Jangan isi field mahal seperti serialized JSON besar jika event tidak aktif.

---

## 6. Metadata Event: Label, Category, Description, Unit, Threshold

Custom event yang bagus bukan hanya berisi field. Ia harus bisa dibaca manusia di JDK Mission Control.

Contoh lebih lengkap:

```java
import jdk.jfr.Category;
import jdk.jfr.Description;
import jdk.jfr.Event;
import jdk.jfr.Label;
import jdk.jfr.Name;
import jdk.jfr.StackTrace;
import jdk.jfr.Threshold;
import jdk.jfr.Timespan;

@Name("com.example.workflow.RuleEvaluation")
@Label("Rule Evaluation")
@Category({"Application", "Workflow"})
@Description("Measures business rule evaluation latency and outcome")
@StackTrace(false)
@Threshold("20 ms")
public class RuleEvaluationEvent extends Event {

    @Label("Rule Set")
    public String ruleSet;

    @Label("Rule Count")
    public int ruleCount;

    @Label("Outcome")
    public String outcome;

    @Label("Duration Budget")
    @Timespan(Timespan.MILLISECONDS)
    public long durationBudgetMillis;
}
```

### Field Design Rules

| Field Type | Good | Bad |
|---|---|---|
| String | `ruleSet`, `operation`, `outcome` | full request body, token, huge JSON |
| int/long | count, size, retry attempt | arbitrary encoded ID if sensitive |
| boolean | cache hit, allowed, fallback used | ambiguous flags like `ok` |
| enum as String | stable finite states | unbounded user input |
| timestamp | usually unnecessary because JFR has event time | manually formatted date string |

### Naming Rules

Gunakan event name stabil:

```text
com.company.area.EventName
```

Contoh:

```text
com.acme.case.StateTransition
com.acme.workflow.RuleEvaluation
com.acme.integration.ExternalCallAttempt
com.acme.batch.ChunkCommit
com.acme.security.AuthorizationDecision
```

Hindari:

```text
RuleEvaluationForUser123
CaseTransition_CASE-2026-00001
SlowThing
DebugEvent
```

Event name harus low-cardinality dan stabil lintas deploy.

---

## 7. Desain Payload Custom JFR Event

Custom event harus membawa data yang cukup untuk diagnosis, tetapi tidak menjadi data leak.

### 7.1 Payload Minimum

Untuk operation duration event:

```text
operation.name
outcome
error.type
retry.attempt
input.size
output.size
cache.hit
budget.ms
```

Untuk workflow/state event:

```text
workflow.name
state.from
state.to
transition.name
outcome
reason.code
rule.count
actor.type
```

Untuk dependency wrapper:

```text
dependency.name
operation.name
attempt
outcome
timeout.ms
status.code
fallback.used
```

Untuk batch/chunk:

```text
job.name
job.execution.id
step.name
chunk.index
item.count
success.count
failed.count
retry.count
outcome
```

### 7.2 Jangan Masukkan Ini

```text
password
access token
refresh token
session cookie
authorization header
full request body
full response body
full personal identity number
email content
large CLOB/document payload
raw SQL with user values
large stack trace as field
```

JFR file sering dipindah ke engineer, vendor, atau platform observability. Perlakukan `.jfr` sebagai artifact sensitif.

---

## 8. Pattern: Custom JFR Event untuk State Machine

State machine adalah kandidat bagus untuk custom JFR event karena banyak incident terjadi bukan karena JVM rusak, tetapi karena runtime state/transition behavior tidak terlihat.

```java
@Name("com.example.case.StateTransition")
@Label("Case State Transition")
@Category({"Application", "Case", "StateMachine"})
@Description("Measures a case state transition decision")
@Threshold("10 ms")
@StackTrace(false)
public class CaseStateTransitionEvent extends Event {
    public String module;
    public String transition;
    public String fromState;
    public String toState;
    public String outcome;
    public String reasonCode;
    public int ruleCount;
    public boolean persisted;
}
```

Usage:

```java
public TransitionResult transition(TransitionCommand command) {
    CaseStateTransitionEvent event = new CaseStateTransitionEvent();
    event.module = command.module();
    event.transition = command.transitionName();
    event.fromState = command.fromState();
    event.toState = command.toState();
    event.ruleCount = command.rules().size();

    event.begin();
    try {
        TransitionResult result = transitionEngine.evaluate(command);
        event.outcome = result.allowed() ? "allowed" : "denied";
        event.reasonCode = result.reasonCode();

        if (result.allowed()) {
            repository.persistTransition(command);
            event.persisted = true;
        }

        return result;
    } catch (RuntimeException ex) {
        event.outcome = "failed";
        event.reasonCode = ex.getClass().getSimpleName();
        throw ex;
    } finally {
        event.commit();
    }
}
```

Saat dianalisis di JMC, kita bisa melihat apakah latency spike berasal dari:

- rule evaluation,
- persistence,
- lock contention,
- GC,
- socket IO,
- file IO,
- thread parking,
- atau event custom tertentu.

---

## 9. Pattern: Custom JFR Event untuk External Dependency

JFR tidak menggantikan trace external dependency. Tapi custom event bisa mencatat wrapper-level decision seperti retry, fallback, timeout budget, dan response classification.

```java
@Name("com.example.integration.ExternalDependencyCall")
@Label("External Dependency Call")
@Category({"Application", "Integration"})
@Threshold("50 ms")
@StackTrace(false)
public class ExternalDependencyCallEvent extends Event {
    public String dependency;
    public String operation;
    public String outcome;
    public int attempt;
    public int maxAttempts;
    public int statusCode;
    public long timeoutMillis;
    public boolean fallbackUsed;
}
```

Usage:

```java
public ApiResponse callExternal(String dependency, Request request) {
    ExternalDependencyCallEvent event = new ExternalDependencyCallEvent();
    event.dependency = dependency;
    event.operation = "submitCase";
    event.maxAttempts = 3;
    event.timeoutMillis = 2_000;

    event.begin();
    try {
        ApiResponse response = client.call(request);
        event.statusCode = response.statusCode();
        event.outcome = response.isSuccessful() ? "success" : "http_error";
        return response;
    } catch (TimeoutException ex) {
        event.outcome = "timeout";
        throw ex;
    } catch (RuntimeException ex) {
        event.outcome = "exception";
        throw ex;
    } finally {
        event.commit();
    }
}
```

Ini berguna ketika trace memberi tahu `HTTP GET /x took 2s`, tapi JFR bisa menambah konteks runtime:

```text
During that exact period:
- many socket read events were slow,
- thread pool was saturated,
- retries increased,
- dependency wrapper emitted timeout events,
- GC was not the cause.
```

---

## 10. Pattern: Custom JFR Event untuk Batch/Chunk

Batch job sering sulit dianalisis karena tidak memiliki user-facing request trace.

```java
@Name("com.example.batch.ChunkProcessing")
@Label("Batch Chunk Processing")
@Category({"Application", "Batch"})
@Threshold("100 ms")
@StackTrace(false)
public class BatchChunkProcessingEvent extends Event {
    public String jobName;
    public String stepName;
    public String executionId;
    public int chunkIndex;
    public int itemCount;
    public int successCount;
    public int failedCount;
    public int retryCount;
    public String outcome;
}
```

Usage:

```java
BatchChunkProcessingEvent event = new BatchChunkProcessingEvent();
event.jobName = jobName;
event.stepName = stepName;
event.executionId = executionId;
event.chunkIndex = chunkIndex;
event.itemCount = items.size();

event.begin();
try {
    ChunkResult result = processor.process(items);
    event.successCount = result.successCount();
    event.failedCount = result.failedCount();
    event.retryCount = result.retryCount();
    event.outcome = "completed";
    return result;
} catch (RuntimeException ex) {
    event.outcome = "failed";
    throw ex;
} finally {
    event.commit();
}
```

Pada incident batch lambat, custom JFR event dapat dikorelasikan dengan:

- file read/write event,
- socket read/write event,
- JDBC/network event jika tersedia dari instrumentation lain,
- GC pause,
- allocation spike,
- monitor contention,
- thread park.

---

## 11. Pattern: Custom JFR Event untuk Idempotency dan Duplicate Request

Duplicate request sering menyebabkan:

- double submit,
- duplicate workflow transition,
- constraint violation,
- lock contention,
- DB pool exhaustion,
- retry storm.

Custom event:

```java
@Name("com.example.idempotency.Decision")
@Label("Idempotency Decision")
@Category({"Application", "Idempotency"})
@StackTrace(false)
public class IdempotencyDecisionEvent extends Event {
    public String operation;
    public String decision;
    public String keyHashPrefix;
    public boolean existingResultFound;
    public boolean lockAcquired;
    public long waitMillis;
}
```

Note: jangan simpan full idempotency key jika key bisa berisi sensitive data. Pakai hash prefix yang cukup untuk debugging tetapi tidak membuka secret.

---

## 12. Pattern: Custom JFR Event untuk Authorization Decision

Security-related custom event harus hati-hati. Untuk audit resmi, tetap gunakan audit log. Untuk performance/diagnostic, JFR bisa mencatat decision pattern.

```java
@Name("com.example.security.AuthorizationDecision")
@Label("Authorization Decision")
@Category({"Application", "Security"})
@Threshold("5 ms")
@StackTrace(false)
public class AuthorizationDecisionEvent extends Event {
    public String resourceType;
    public String action;
    public String decision;
    public String reasonCode;
    public int roleCount;
    public int policyCount;
}
```

Jangan masukkan:

- raw JWT,
- username jika tidak perlu,
- email,
- NRIC/NIK/passport,
- full role list jika sensitif,
- policy expression yang mengandung data tenant/user.

---

## 13. Wrapper Utility agar Custom JFR Tidak Mengotori Business Code

Jika setiap service method membuat event manual, code menjadi noisy. Gunakan helper.

```java
public final class JfrEvents {
    private JfrEvents() {}

    public static <T> T recordRuleEvaluation(
            String ruleSet,
            int ruleCount,
            Supplier<T> action
    ) {
        RuleEvaluationEvent event = new RuleEvaluationEvent();
        if (event.isEnabled()) {
            event.ruleSet = ruleSet;
            event.ruleCount = ruleCount;
        }

        event.begin();
        try {
            T result = action.get();
            if (event.isEnabled()) {
                event.outcome = "success";
            }
            return result;
        } catch (RuntimeException ex) {
            if (event.isEnabled()) {
                event.outcome = "failed";
            }
            throw ex;
        } finally {
            event.commit();
        }
    }
}
```

Usage:

```java
return JfrEvents.recordRuleEvaluation(
    ruleSetName,
    rules.size(),
    () -> evaluator.evaluate(input)
);
```

Untuk checked exception, buat functional interface sendiri:

```java
@FunctionalInterface
public interface CheckedSupplier<T, E extends Exception> {
    T get() throws E;
}
```

---

## 14. Annotation-Based Custom JFR via Aspect: Gunakan dengan Hati-Hati

Kamu bisa membuat annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface JfrTimed {
    String name();
    String category() default "Application";
}
```

Lalu aspect/interceptor membuat generic event. Namun custom JFR event class biasanya statically defined. Generic event bisa dibuat:

```java
@Name("com.example.application.MethodTiming")
@Label("Application Method Timing")
@Category({"Application", "Generic"})
@Threshold("20 ms")
public class MethodTimingEvent extends Event {
    public String className;
    public String methodName;
    public String operation;
    public String outcome;
}
```

Kelebihan:

- mudah diterapkan,
- konsisten,
- cocok untuk boundary-level timing.

Kekurangan:

- raw method name bisa high cardinality jika dynamic/proxy buruk,
- domain payload kurang kaya,
- AOP overhead,
- bisa overlap dengan profiler/trace,
- bisa membuat JFR ramai tetapi kurang bermakna.

Top-tier rule:

```text
Gunakan generic JFR timing untuk boundary stabil.
Gunakan strongly typed custom JFR event untuk domain operation penting.
```

---

## 15. Production Recording Strategy

JFR production strategy biasanya punya empat mode.

### 15.1 Always-On Continuous Recording

Tujuan: selalu punya rolling buffer sebelum incident.

Contoh startup:

```bash
java \
  -XX:StartFlightRecording=name=continuous,settings=profile,disk=true,maxage=30m,maxsize=512m,dumponexit=true,filename=/var/log/app/continuous.jfr \
  -jar app.jar
```

Karakteristik:

- recording selalu aktif,
- menyimpan window terakhir,
- bisa dump saat incident,
- cocok untuk service kritikal.

Trade-off:

- disk usage,
- overhead kecil tetapi tetap ada,
- perlu akses file yang aman,
- perlu SOP pengambilan artifact.

### 15.2 On-Demand Incident Recording

Tujuan: mulai recording ketika gejala muncul.

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=5m filename=/tmp/incident.jfr
```

Atau:

```bash
jcmd <pid> JFR.start name=incident settings=profile delay=10s duration=5m filename=/tmp/incident.jfr
```

Cocok ketika:

- issue bisa direproduksi,
- alert sedang aktif,
- engineer punya akses ke pod/VM.

Kelemahan:

- bisa terlambat,
- early evidence hilang,
- butuh permission attach.

### 15.3 Emergency Dump dari Continuous Recording

Jika recording continuous sudah berjalan:

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/incident-$(date +%Y%m%d-%H%M%S).jfr
```

Ini sering lebih baik daripada baru start recording karena kamu mendapat **pre-incident window**.

### 15.4 Load Test Recording

Untuk performance engineering:

```bash
java \
  -XX:StartFlightRecording=name=loadtest,settings=profile,disk=true,filename=/tmp/loadtest.jfr,duration=15m \
  -jar app.jar
```

Gunakan bersamaan dengan:

- test scenario timeline,
- traffic generator logs,
- deployment version,
- DB metrics,
- GC logs,
- application logs,
- OpenTelemetry traces/metrics.

---

## 16. JFR Settings: default vs profile vs custom

JFR biasanya punya konfigurasi `default` dan `profile`.

Mental model:

| Setting | Tujuan | Overhead | Cocok Untuk |
|---|---:|---:|---|
| `default` | observability ringan | sangat rendah | always-on |
| `profile` | detail performance lebih tinggi | lebih tinggi | incident/load test |
| custom `.jfc` | kontrol event detail | tergantung | production maturity tinggi |

### 16.1 Always-On Baseline

```bash
-XX:StartFlightRecording=name=continuous,settings=default,disk=true,maxage=30m,maxsize=256m
```

### 16.2 Incident Performance Capture

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=5m filename=/tmp/incident.jfr
```

### 16.3 Custom `.jfc`

Gunakan custom `.jfc` jika kamu perlu:

- enable/disable event spesifik,
- threshold berbeda,
- stack trace untuk event tertentu,
- rate/period khusus,
- custom event category.

Contoh approach:

```text
jfr configure atau JMC template editor -> export .jfc -> store di repo ops -> mount ke container/VM
```

---

## 17. Command Cookbook: jcmd + JFR

### 17.1 Cari PID

```bash
jcmd
```

atau:

```bash
jps -lv
```

### 17.2 Cek Recording

```bash
jcmd <pid> JFR.check
```

### 17.3 Start Recording

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=5m filename=/tmp/incident.jfr
```

### 17.4 Dump Recording Berjalan

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/continuous-dump.jfr
```

### 17.5 Stop Recording

```bash
jcmd <pid> JFR.stop name=incident filename=/tmp/incident-final.jfr
```

### 17.6 Dump Tanpa Stop

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/snapshot.jfr
```

### 17.7 Mulai dengan Disk Ring Buffer

```bash
jcmd <pid> JFR.start name=continuous settings=default disk=true maxage=30m maxsize=512m
```

### 17.8 Mulai dengan Delay

```bash
jcmd <pid> JFR.start name=delayed settings=profile delay=30s duration=5m filename=/tmp/delayed.jfr
```

---

## 18. CLI `jfr`: First-Pass Analysis Tanpa GUI

CLI `jfr` berguna ketika kamu berada di server, container, CI artifact, atau ingin automate triage.

### 18.1 Summary

```bash
jfr summary incident.jfr
```

Gunakan untuk melihat:

- event types,
- count,
- total size,
- available event categories.

### 18.2 Print Event Tertentu

```bash
jfr print --events jdk.CPULoad incident.jfr
```

```bash
jfr print --events jdk.JavaMonitorEnter incident.jfr
```

```bash
jfr print --events com.example.workflow.RuleEvaluation incident.jfr
```

### 18.3 Print JSON

```bash
jfr print --json --events com.example.workflow.RuleEvaluation incident.jfr
```

Ini bisa dipipe ke `jq`.

### 18.4 Metadata

```bash
jfr metadata incident.jfr
```

Berguna untuk memastikan custom event masuk dengan label/category/field yang benar.

---

## 19. JDK Mission Control Analysis Method

JMC adalah tool GUI untuk membaca `.jfr`. Top-tier analysis bukan klik random tab, tetapi mengikuti alur diagnosis.

### 19.1 Mulai dari Recording Overview

Periksa:

- duration,
- JVM version,
- command line,
- host/container context,
- event availability,
- recording settings.

Pertanyaan:

```text
Apakah recording mencakup window incident?
Apakah event yang dibutuhkan aktif?
Apakah sampling cukup?
Apakah recording diambil dari instance yang benar?
```

### 19.2 Lihat Automated Analysis / Rules

JMC biasanya menyediakan rules/analysis yang memberi indikasi:

- high allocation,
- lock contention,
- GC pressure,
- high CPU,
- IO latency,
- thread issues.

Jangan langsung percaya sebagai root cause. Treat sebagai hypothesis generator.

### 19.3 Method Profiling

Cari:

- hot methods,
- top packages,
- application vs framework vs JDK,
- repeated expensive mapper/serializer/template/rule engine code,
- unexpected logging/JSON cost,
- cryptography/compression overhead.

Pertanyaan:

```text
CPU habis di business logic, serialization, DB driver, logging, GC, regex, reflection, crypto, compression, atau framework?
```

### 19.4 Allocation

Cari:

- allocation hotspot,
- large object allocation,
- repeated byte array/string/map/list allocation,
- JSON serialization allocation,
- exception allocation,
- logging allocation,
- buffer allocation.

Pertanyaan:

```text
Apakah latency spike disertai allocation spike?
Apakah GC meningkat sebagai akibat allocation, bukan root cause?
```

### 19.5 Garbage Collection

Cari:

- pause duration,
- frequency,
- allocation rate,
- old generation pressure,
- humongous allocation untuk G1,
- concurrent phase behavior untuk ZGC/Shenandoah.

Pertanyaan:

```text
Apakah GC pause bertepatan dengan request latency?
Atau request lambat menyebabkan allocation dan akhirnya GC?
```

### 19.6 Threads and Locks

Cari:

- blocked time,
- monitor enter,
- park events,
- thread sleep,
- executor behavior,
- deadlock signals,
- virtual thread pinning jika tersedia.

Pertanyaan:

```text
Apakah thread RUNNABLE benar-benar menggunakan CPU?
Apakah banyak thread park menunggu pool/queue/lock?
Apakah synchronized block menahan banyak request?
```

### 19.7 IO

Cari:

- socket read/write duration,
- file read/write,
- DNS/network symptoms,
- external dependency latency.

Pertanyaan:

```text
Apakah aplikasi CPU-bound, lock-bound, GC-bound, atau IO-bound?
```

### 19.8 Exceptions

Cari:

- exception count,
- exception type,
- stack traces,
- repeated expected exceptions,
- expensive control-flow exception.

Pertanyaan:

```text
Apakah error storm menciptakan overhead exception/logging?
Apakah exception digunakan sebagai normal control flow?
```

### 19.9 Custom Events

Cari custom event domain:

- slow rule evaluation,
- failed transition,
- duplicate idempotency decision,
- external retry exhaustion,
- slow batch chunk,
- authorization decision spike.

Pertanyaan:

```text
Apakah domain event tertentu sinkron dengan JVM-level degradation?
```

---

## 20. Correlating JFR with Logs, Traces, Metrics

JFR tidak otomatis punya `trace.id` kecuali kamu memasukkannya sendiri ke custom event atau menulis integrasi khusus. Tapi jangan sembarangan memasukkan trace id ke setiap JFR event.

### 20.1 Korelasi Berdasarkan Waktu

Paling umum:

```text
metric spike window: 10:05:00 - 10:10:00
trace latency sample: 10:06:30
log error storm: 10:06:20 - 10:07:00
JFR recording: 10:04:00 - 10:11:00
```

Pertanyaan:

```text
Apa yang berubah dalam JFR pada window yang sama?
```

### 20.2 Korelasi Berdasarkan Thread

Untuk synchronous request, thread name bisa membantu:

```text
http-nio-8080-exec-42
ForkJoinPool.commonPool-worker-3
pool-7-thread-12
virtual-thread-12345
```

Namun thread name kurang cukup untuk async/virtual-thread-heavy apps.

### 20.3 Korelasi Berdasarkan Custom Event Field

Custom event bisa membawa low-cardinality domain ID:

```text
module=Case
operation=stateTransition
transition=SUBMIT_TO_REVIEW
outcome=failed
reasonCode=LOCK_TIMEOUT
```

Untuk ID sensitif/high-cardinality, gunakan hati-hati:

```text
case.id hashed? maybe
request.id? sometimes
trace.id? only for sampled critical events or lab/debug mode
```

### 20.4 Korelasi Berdasarkan Deployment/Version

Tambahkan resource/version context di nama file atau directory:

```text
service=case-service
env=prod
version=2026.06.18-rc3
pod=case-service-7c98d7f8dd-x2abc
recording=incident-20260618T101500Z.jfr
```

---

## 21. JFR Incident Automation

Production-grade system sebaiknya punya SOP/automation.

### 21.1 Trigger Manual Runbook

Saat alert latency/error/CPU/memory aktif:

```bash
POD=case-service-abc123
kubectl exec "$POD" -- jcmd 1 JFR.dump name=continuous filename=/tmp/incident.jfr
kubectl cp "$POD:/tmp/incident.jfr" ./incident-case-service-$(date +%Y%m%d-%H%M%S).jfr
```

### 21.2 Trigger On-Demand Recording

```bash
kubectl exec "$POD" -- jcmd 1 JFR.start name=incident settings=profile duration=5m filename=/tmp/incident.jfr
```

Setelah selesai:

```bash
kubectl cp "$POD:/tmp/incident.jfr" ./incident.jfr
```

### 21.3 Automation Script Skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail

NAMESPACE=${1:?namespace required}
POD=${2:?pod required}
OUT_DIR=${3:-./jfr-artifacts}
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="incident-${POD}-${TS}.jfr"

mkdir -p "$OUT_DIR"

echo "Checking JFR recordings..."
kubectl exec -n "$NAMESPACE" "$POD" -- jcmd 1 JFR.check || true

echo "Dumping continuous recording..."
kubectl exec -n "$NAMESPACE" "$POD" -- jcmd 1 JFR.dump name=continuous filename=/tmp/$FILE

echo "Copying artifact..."
kubectl cp "$NAMESPACE/$POD:/tmp/$FILE" "$OUT_DIR/$FILE"

echo "Done: $OUT_DIR/$FILE"
```

### 21.4 Safety Controls

Runbook harus menyebut:

- siapa boleh menjalankan,
- di environment mana,
- maximum duration,
- maximum file size,
- storage path,
- encryption/transfer rule,
- retention,
- PII handling,
- incident ticket reference.

---

## 22. Kubernetes-Specific Considerations

### 22.1 PID Bias

Di container, Java process sering PID 1:

```bash
jcmd 1 JFR.check
```

Tapi jangan assume. Cek:

```bash
jcmd
```

### 22.2 Missing jcmd

Jika image hanya JRE/minimal runtime, `jcmd` mungkin tidak ada.

Pilihan:

1. Gunakan JDK base image untuk service kritikal.
2. Sediakan debug image/ephemeral container.
3. Start JFR via JVM option sejak startup.
4. Expose safe internal admin operation via MXBean, dengan kontrol ketat.

### 22.3 Writable Filesystem

Pastikan path output bisa ditulis:

```text
/tmp
/var/log/app
mounted emptyDir
mounted diagnostics volume
```

### 22.4 Pod Restart Risk

Jika pod restart sebelum artifact dicopy, file hilang kecuali disimpan ke volume persistent atau dikirim ke artifact store.

### 22.5 Security

JFR file dapat berisi:

- command line,
- system properties,
- environment clues,
- class/method names,
- exception messages,
- file/socket paths,
- custom event fields.

Jangan publish sembarangan.

---

## 23. Java 8 sampai Java 25: Practical Compatibility

### Java 8

Tergantung distribusi dan update level. JFR pada Oracle JDK 8 historically memiliki licensing concern lama; pada OpenJDK 8 modern beberapa vendor menyediakan JFR backport. Operationally, jangan assume sama antara semua JDK 8 distribution.

Checklist:

```text
java -version
jcmd <pid> help | grep JFR
```

### Java 11

JFR menjadi bagian umum dari OpenJDK ecosystem. API `jdk.jfr` tersedia sebagai module.

### Java 17

Baseline LTS umum untuk production. JFR/JMC workflow matang.

### Java 21

Virtual threads mulai relevan. JFR menjadi sangat penting untuk melihat perilaku thread/parking/pinning di aplikasi Loom-era.

### Java 25

JDK 25 tetap menyediakan module `jdk.jfr` untuk membuat event dan mengontrol Flight Recorder. Java 25 juga relevan untuk kombinasi modern seperti virtual threads, structured concurrency/scoped values ecosystem, dan observability yang lebih matang.

---

## 24. JFR untuk Virtual Threads

Virtual threads mengubah mental model thread dump dan profiling:

- jumlah thread bisa sangat banyak,
- platform thread bukan lagi satu-satunya unit concurrency application-level,
- blocking operation bisa murah jika tidak pinning,
- synchronized/native/foreign calls bisa menyebabkan pinning dalam kondisi tertentu.

JFR berguna untuk:

- melihat virtual thread lifecycle,
- mengidentifikasi pinning,
- melihat blocking/parking behavior,
- melihat apakah latency berasal dari carrier thread starvation,
- membedakan logical concurrency tinggi vs platform resource saturation.

Design rule:

```text
Untuk Java 21+, observability concurrency harus melihat virtual-thread-level dan platform-thread-level.
Thread dump saja tidak cukup; gunakan JFR events dan profiler.
```

---

## 25. Custom JFR Event vs OpenTelemetry Span

Keduanya mirip karena sama-sama bisa punya duration dan attributes. Tapi tujuannya berbeda.

| Dimension | JFR Custom Event | OTel Span |
|---|---|---|
| Scope | single JVM/runtime | distributed trace |
| Storage | `.jfr` local/recording | observability backend |
| Cost model | low-level event recorder | exporter/backend pipeline |
| Best for | profiling/diagnosis internals | request causality across services |
| Retention | short/incident artifact | backend retention policy |
| Analysis | JMC/CLI | tracing UI/query |
| Sensitive risk | artifact sharing | backend ingestion |

Gunakan dua-duanya bila operasi penting:

```text
Span: tells distributed story.
JFR event: tells JVM/runtime cost and domain timing story.
```

Contoh:

```java
Span span = tracer.spanBuilder("case.transition").startSpan();
CaseStateTransitionEvent event = new CaseStateTransitionEvent();

event.begin();
try (Scope scope = span.makeCurrent()) {
    TransitionResult result = transition(command);
    span.setAttribute("case.transition", command.transitionName());
    event.transition = command.transitionName();
    event.outcome = result.allowed() ? "allowed" : "denied";
    return result;
} catch (RuntimeException ex) {
    span.recordException(ex);
    span.setStatus(StatusCode.ERROR);
    event.outcome = "failed";
    throw ex;
} finally {
    event.commit();
    span.end();
}
```

Jangan otomatis copy semua span attributes ke JFR atau sebaliknya. Pikirkan schema, cost, dan privacy.

---

## 26. Security and Privacy for JFR Artifacts

JFR harus diperlakukan sebagai sensitive diagnostic artifact.

### 26.1 Risiko Isi JFR

JFR bisa berisi:

- command-line arguments,
- JVM flags,
- system properties,
- exception messages,
- class names,
- method names,
- file paths,
- socket endpoints,
- custom event fields,
- thread names,
- allocation object types.

### 26.2 Policy

```text
1. Jangan masukkan secrets ke JVM args.
2. Jangan masukkan PII ke custom JFR event.
3. Jangan upload .jfr ke public issue tracker.
4. Encrypt artifact saat transfer.
5. Attach ke incident ticket restricted.
6. Set retention singkat.
7. Redact metadata jika dikirim ke vendor.
8. Document who accessed artifact.
```

### 26.3 Custom Event Review

Custom JFR event harus melewati review seperti log schema:

- apakah field high-cardinality?
- apakah field sensitive?
- apakah event terlalu sering?
- apakah payload terlalu besar?
- apakah event membantu diagnosis?
- apakah ada threshold?
- apakah stack trace dibutuhkan?

---

## 27. Anti-Patterns

### 27.1 Membuat Custom Event untuk Semua Method

Ini menghasilkan noise dan overhead. JFR bukan replacement AOP logger.

### 27.2 Menaruh Full Request/Response Body

Ini data leak dan file bloat.

### 27.3 StackTrace(true) untuk Event Frekuensi Tinggi

Stack trace mahal dan bisa memperbesar recording.

### 27.4 Event Name High Cardinality

Buruk:

```text
com.example.RuleEvaluation.User123.Case456
```

Baik:

```text
com.example.workflow.RuleEvaluation
```

### 27.5 Mengandalkan On-Demand Recording Saja

Jika incident terjadi cepat, evidence hilang. Untuk sistem kritikal, continuous recording lebih baik.

### 27.6 Menyimpan `.jfr` tanpa Metadata Incident

File tanpa konteks sulit dianalisis.

Minimal metadata:

```text
service
environment
version
pod/host
incident ticket
start/end time
timezone
symptom
traffic condition
recent deploy/change
```

### 27.7 Menganggap JMC Rule = Root Cause

JMC rule adalah starting point. Root cause tetap harus dibuktikan dengan korelasi.

---

## 28. Production JFR Readiness Checklist

### Runtime

- [ ] JDK menyediakan JFR.
- [ ] `jcmd` tersedia atau startup recording disiapkan.
- [ ] Recording continuous bisa berjalan dengan `maxage`/`maxsize`.
- [ ] Output path writable.
- [ ] Disk usage dibatasi.
- [ ] Recording name standard.

### Security

- [ ] Artifact classified as sensitive.
- [ ] Access restricted.
- [ ] Transfer encrypted.
- [ ] Retention defined.
- [ ] Custom event field reviewed.

### Operation

- [ ] Runbook dump tersedia.
- [ ] Kubernetes command tersedia.
- [ ] Artifact naming standard.
- [ ] Incident metadata captured.
- [ ] Engineer tahu cara membuka di JMC.

### Design

- [ ] Custom events hanya untuk operation penting.
- [ ] Event names stable.
- [ ] Field names stable.
- [ ] No secrets/PII.
- [ ] Threshold configured.
- [ ] Stack trace disabled by default untuk high-frequency events.

### Analysis

- [ ] Bisa membaca CPU samples.
- [ ] Bisa membaca allocation hotspots.
- [ ] Bisa membaca GC events.
- [ ] Bisa membaca lock/thread events.
- [ ] Bisa membaca IO events.
- [ ] Bisa membaca custom events.
- [ ] Bisa korelasi dengan logs/metrics/traces.

---

## 29. Practical Lab 1: Membuat Custom JFR Event untuk Rule Evaluation

### Goal

Membuat custom event yang mencatat rule evaluation latency.

### Event

```java
@Name("lab.workflow.RuleEvaluation")
@Label("Rule Evaluation")
@Category({"Lab", "Workflow"})
@Threshold("10 ms")
@StackTrace(false)
public class RuleEvaluationEvent extends Event {
    public String ruleSet;
    public int ruleCount;
    public String outcome;
}
```

### Service

```java
public boolean evaluate(String ruleSet, List<String> rules) {
    RuleEvaluationEvent event = new RuleEvaluationEvent();
    event.ruleSet = ruleSet;
    event.ruleCount = rules.size();

    event.begin();
    try {
        busyWork(rules.size());
        event.outcome = "allowed";
        return true;
    } catch (RuntimeException ex) {
        event.outcome = "failed";
        throw ex;
    } finally {
        event.commit();
    }
}
```

### Run

```bash
java -XX:StartFlightRecording=name=lab,settings=profile,duration=60s,filename=lab.jfr -jar app.jar
```

### Inspect

```bash
jfr summary lab.jfr
jfr print --events lab.workflow.RuleEvaluation lab.jfr
```

Expected:

```text
Custom event appears.
Fields are visible.
Durations are captured.
Only events above threshold may appear depending on settings.
```

---

## 30. Practical Lab 2: Continuous Recording + Emergency Dump

### Start App

```bash
java \
  -XX:StartFlightRecording=name=continuous,settings=default,disk=true,maxage=15m,maxsize=256m \
  -jar app.jar
```

### Trigger Load

Run load test or endpoint loop.

### Dump

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/continuous-dump.jfr
```

### Analyze

```bash
jfr summary /tmp/continuous-dump.jfr
```

Open in JMC.

Questions:

```text
Apa top CPU method?
Apa allocation hotspot?
Apakah ada lock contention?
Apakah ada slow socket/file IO?
Apakah custom event terlihat?
```

---

## 31. Practical Lab 3: Incident Correlation Exercise

Scenario:

```text
10:00 deploy version v2.
10:05 latency p95 naik dari 300 ms ke 3 s.
10:06 error rate naik.
10:07 Hikari pool waiting meningkat.
10:08 log menunjukkan duplicate submission meningkat.
10:09 JFR dump diambil.
```

Analyze:

1. Buka metrics untuk window 10:00-10:10.
2. Buka logs untuk error/correlation IDs.
3. Buka traces lambat.
4. Buka JFR.
5. Cari custom event idempotency/transition.
6. Cari JavaMonitorEnter/ThreadPark/socket/GC/allocation.
7. Buat hypothesis tree.

Possible finding:

```text
New idempotency logic uses synchronized block around DB lookup.
Duplicate submission spike causes monitor contention.
Threads wait before Hikari acquisition.
DB pool saturation is symptom, not root cause.
GC is secondary due to exception/log allocation storm.
```

---

## 32. Mini Case Study: Latency Spike yang Salah Dituduh GC

### Symptom

```text
p95 latency: 250 ms -> 4 s
CPU: moderate
Heap: naik turun
GC pause: terlihat meningkat sedikit
Logs: timeout ke dependency
DB pool: normal
```

Tim awal menyalahkan GC karena dashboard GC pause naik.

### JFR Evidence

JFR menunjukkan:

```text
- SocketRead events ke dependency X meningkat menjadi 2s.
- Banyak ThreadPark pada CompletableFuture join.
- Custom ExternalDependencyCallEvent outcome=timeout meningkat.
- GC pause terjadi setelah timeout storm karena exception/log allocation meningkat.
- CPU tidak saturated.
```

### Root Cause

External dependency X latency spike. GC adalah efek samping dari exception/log volume, bukan root cause utama.

### Fix

Mitigation:

```text
- Turunkan timeout.
- Tambah circuit breaker.
- Rate limit retry.
- Reduce ERROR stack trace storm.
```

Permanent:

```text
- Dependency SLO contract.
- Retry budget.
- Fallback strategy.
- Alert on dependency latency and timeout ratio.
- Custom JFR event for fallback and retry exhaustion retained.
```

---

## 33. Top 1% Engineer Heuristics for JFR

1. Jangan tunggu incident untuk belajar JFR.
2. Jalankan JFR pada load test dan review hasilnya.
3. Simpan JFR baseline untuk version sehat.
4. Bandingkan healthy vs unhealthy recording.
5. Treat JFR sebagai evidence, bukan magic answer.
6. Jangan melihat CPU saja; lihat allocation, IO, locks, GC, exceptions, custom events.
7. Masukkan domain event yang menjelaskan workflow penting.
8. Gunakan threshold agar event meaningful.
9. Jangan simpan sensitive data.
10. Automate dump sebelum pod mati.
11. Selalu korelasikan dengan metrics/logs/traces.
12. Tulis post-incident improvement untuk event yang tidak ada tetapi seharusnya ada.

---

## 34. Output Standar Setelah Part Ini

Setelah menyelesaikan part ini, kamu seharusnya bisa membuat:

1. Custom JFR event untuk operation domain penting.
2. Continuous recording strategy.
3. On-demand incident recording command.
4. Kubernetes JFR dump runbook.
5. JMC analysis checklist.
6. Artifact security policy.
7. JFR correlation workflow dengan logs/metrics/traces.
8. JFR-based mini postmortem.

---

## 35. Referensi

- Oracle Java SE 25 `jdk.jfr` module documentation: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/module-summary.html
- Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools / JFR: https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html
- Oracle JDK Mission Control: https://docs.oracle.com/en/java/java-components/jdk-mission-control/
- Java Flight Recorder tutorial on dev.java: https://dev.java/learn/jvm/jfr/
- Java SE `jdk.jfr.Event` API: https://docs.oracle.com/en/java/javase/11/docs/api/jdk.jfr/jdk/jfr/Event.html
- Java SE `jdk.jfr` package summary: https://docs.oracle.com/en/java/javase/11/docs/api/jdk.jfr/jdk/jfr/package-summary.html
- Red Hat OpenJDK JFR guide: https://docs.redhat.com/en/documentation/red_hat_build_of_openjdk/17/html/using_jdk_flight_recorder_with_red_hat_build_of_openjdk/

---

## 36. Ringkasan

JFR custom event memungkinkan aplikasi Java mencatat evidence domain langsung ke JVM event recorder. Ini sangat kuat ketika dipakai bersama built-in event seperti CPU samples, GC, allocation, locks, socket IO, file IO, thread park, exception, dan virtual thread events.

Log menjawab “apa yang aplikasi katakan”. Trace menjawab “bagaimana request bergerak”. Metric menjawab “seberapa sering/seberapa besar”. JFR menjawab “apa yang benar-benar dilakukan JVM dan aplikasi pada waktu itu”.

Di level production engineering, JFR bukan tool ops tambahan. JFR adalah bagian dari incident readiness.

---

## 37. Status Series

Selesai sampai: **Part 21 — JFR Deep Dive II: Custom Events, Production Recording, JMC Analysis**.

Seri belum selesai.

Part berikutnya: **Part 22 — Profiling Mental Model: CPU Time, Wall Time, Allocation, Lock, IO**.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — JFR Deep Dive I: Java Flight Recorder Mental Model](./20-jfr-deep-dive-java-flight-recorder-mental-model.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Profiling Mental Model: CPU Time, Wall Time, Allocation, Lock, IO](./22-profiling-mental-model-cpu-time-wall-time-allocation-lock-io.md)
