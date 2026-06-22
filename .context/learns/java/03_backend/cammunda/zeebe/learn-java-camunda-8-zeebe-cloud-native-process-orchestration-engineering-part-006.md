# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-006.md

# Part 006 — Building Production-Grade Java Job Workers

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `006`  
> Topik: Java job worker engineering untuk Camunda 8 / Zeebe  
> Target: Java 8 sampai Java 25, dengan perhatian khusus ke Java 17/21+ sebagai baseline modern production  
> Status seri: belum selesai

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **job worker** sebagai komponen eksekusi utama di Camunda 8/Zeebe.

Di Camunda 7, banyak engineer terbiasa berpikir seperti ini:

> “Process engine memanggil JavaDelegate di dalam transaksi engine.”

Di Camunda 8, cara berpikirnya berubah menjadi:

> “Zeebe membuat job sebagai kewajiban eksekusi yang durable; Java worker mengambil job tersebut secara remote, menjalankan side effect, lalu melaporkan hasilnya kembali ke engine.”

Perubahan ini terlihat kecil di API, tetapi besar secara arsitektur.

Job worker production-grade bukan hanya class dengan annotation `@JobWorker`. Worker adalah **distributed execution boundary** antara:

1. durable process state di Zeebe,
2. aplikasi Java yang menjalankan business logic,
3. external systems,
4. database lokal/domain service,
5. observability stack,
6. failure and retry semantics.

Jika worker salah desain, process model yang bagus pun bisa gagal di production melalui duplicate side effect, incident storm, timeout palsu, overload external API, silent data corruption, atau debugging nightmare.

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. menjelaskan job worker sebagai runtime execution contract, bukan sekadar callback method;
2. memilih konfigurasi worker seperti `maxJobsActive`, timeout, polling/streaming, dan concurrency secara rasional;
3. mendesain worker lifecycle yang aman: startup, processing, retry, fail, complete, shutdown;
4. membedakan job timeout, command timeout, business timeout, retry backoff, dan BPMN timer;
5. membuat struktur Java worker yang maintainable, testable, observable, dan aman untuk production;
6. mengenali design smell pada worker yang rawan incident;
7. menyiapkan mental model untuk Part 007 tentang idempotency dan duplicate execution.

---

## 1. Recap Cepat dari Part Sebelumnya

Dari Part 000 sampai Part 005, kita sudah membangun fondasi berikut:

1. Camunda 8/Zeebe adalah distributed workflow engine.
2. Zeebe Broker menyimpan state orchestration dan memproses stream.
3. Zeebe Gateway adalah entry point stateless untuk client.
4. Operate/Tasklist/Optimize adalah read/projection side, bukan source of truth.
5. BPMN service task di Zeebe biasanya menjadi job.
6. Java code tidak dieksekusi di dalam broker.
7. Java worker mengambil job dari engine dan menyelesaikannya secara remote.
8. Camunda Java Client menjadi arah modern, sementara Zeebe Java Client legacy sedang ditinggalkan pada roadmap baru.

Bagian ini masuk ke pertanyaan praktis:

> Bagaimana membangun Java worker yang tidak hanya “jalan di local”, tetapi aman untuk traffic, failure, retry, shutdown, dan observability production?

---

## 2. Mental Model Utama: Worker Bukan Function, Worker Adalah Execution Lease Holder

Kesalahan paling umum adalah menganggap worker seperti ini:

```text
Zeebe calls my Java method.
```

Model itu salah.

Model yang lebih benar:

```text
Zeebe creates a job.
Worker asks for jobs of a specific type.
Zeebe assigns a job to the worker for a limited timeout window.
Worker now holds a temporary lease over that job.
Worker must complete, fail, throw BPMN error, or let the lease expire.
```

Jadi worker bukan dipanggil secara langsung oleh Zeebe seperti RPC push tradisional. Worker adalah client yang mengambil pekerjaan dari engine.

Dokumentasi Camunda menjelaskan job worker sebagai client yang mengaktifkan job, lalu menyelesaikan atau menggagalkan job. Job memiliki timeout; jika tidak selesai dalam timeout, job dapat diberikan lagi ke worker lain. Ini berarti worker harus didesain dengan asumsi **at-least-once execution**, bukan exactly-once.

### 2.1 Apa itu lease dalam konteks worker?

Saat worker mengaktifkan job, Zeebe memberi hak sementara kepada worker untuk mengerjakan job tersebut.

Lease ini memiliki timeout.

Selama lease aktif:

1. job dianggap sedang dikerjakan oleh worker tertentu;
2. worker lain tidak seharusnya mendapat job yang sama;
3. worker harus menyelesaikan job sebelum timeout;
4. jika worker gagal menyelesaikan sebelum timeout, Zeebe boleh membuat job itu tersedia kembali.

Secara konseptual:

```text
Job Created
   |
   v
Job Activated by Worker A, timeout = 5 minutes
   |
   +--> Worker A completes before timeout  -> Job Completed
   |
   +--> Worker A fails job                 -> Job Failed / Retry / Incident
   |
   +--> Worker A crashes                   -> Timeout expires -> Job available again
   |
   +--> Worker A completes after timeout   -> Completion may be rejected/stale
```

### 2.2 Kenapa lease model penting?

Karena ini menentukan hampir semua keputusan worker:

| Concern | Implikasi |
|---|---|
| Timeout terlalu pendek | job bisa timeout saat masih antre di worker client |
| Timeout terlalu panjang | recovery dari worker mati menjadi lambat |
| `maxJobsActive` terlalu besar | worker menahan terlalu banyak lease |
| Handler lambat | duplicate execution risk naik |
| External side effect non-idempotent | retry bisa merusak data |
| Shutdown tidak drain | job aktif bisa timeout dan diulang |
| Observability buruk | sulit tahu apakah bottleneck di worker, engine, atau external API |

Worker yang bagus bukan hanya cepat. Worker yang bagus **jujur terhadap kapasitasnya sendiri**.

---

## 3. Lifecycle Job Worker: Dari Activation sampai Completion

Secara sederhana, worker lifecycle adalah:

```text
Start worker application
   |
   v
Open job worker subscription / polling loop
   |
   v
Activate jobs by job type
   |
   v
Deserialize variables
   |
   v
Execute business operation
   |
   +--> complete job with variables
   |
   +--> fail job with retries/backoff
   |
   +--> throw BPMN error
   |
   +--> crash / timeout / cancel
   |
   v
Continue loop until shutdown
   |
   v
Stop accepting new jobs
   |
   v
Drain active jobs or let them timeout safely
   |
   v
Close client/application
```

Dalam implementation modern, ini bisa terlihat seperti annotation Spring Boot:

```java
@Component
public final class PaymentWorker {

    private final PaymentApplicationService paymentService;

    public PaymentWorker(PaymentApplicationService paymentService) {
        this.paymentService = paymentService;
    }

    @JobWorker(type = "payment.charge")
    public Map<String, Object> handle(final ActivatedJob job) {
        final String orderId = (String) job.getVariablesAsMap().get("orderId");

        final PaymentResult result = paymentService.charge(orderId);

        return Map.of(
            "paymentStatus", result.status(),
            "paymentReference", result.reference()
        );
    }
}
```

Tetapi production-grade design tidak berhenti di sini. Contoh di atas belum menjawab:

1. Apa yang terjadi jika `paymentService.charge()` sukses tetapi complete job gagal?
2. Apa yang terjadi jika worker mati setelah external payment sukses?
3. Apa yang terjadi jika job timeout sebelum handler selesai?
4. Apa yang terjadi jika variable `orderId` tidak ada?
5. Apakah `payment.charge` idempotent?
6. Bagaimana timeout dan retry dikonfigurasi?
7. Bagaimana log bisa dikorelasikan ke process instance?
8. Bagaimana worker drain saat Kubernetes mengirim SIGTERM?
9. Apa metric yang membuktikan worker sehat?

Itulah bedanya demo worker dan production worker.

---

## 4. Komponen-Konfigurasi Worker yang Harus Dipahami

Ada beberapa parameter yang sering dianggap teknis kecil, padahal menentukan stabilitas sistem.

Nama detail API bisa berbeda antara Zeebe Java Client lama, Camunda Java Client baru, dan Spring Boot Starter, tetapi konsepnya sama.

### 4.1 Job type

Job type adalah contract antara BPMN model dan worker.

Pada BPMN service task, job type biasanya didefinisikan melalui task definition/type.

Contoh:

```text
payment.charge
customer.verify-identity
document.generate-pdf
notification.send-email
case.assign-reviewer
```

Job type harus diperlakukan seperti public API internal.

Jangan asal mengganti job type di BPMN tanpa memastikan worker kompatibel.

#### Job type naming guideline

Gunakan nama yang:

1. stabil;
2. domain-oriented;
3. tidak terlalu teknis;
4. cukup spesifik;
5. bisa diversi jika breaking change.

Contoh buruk:

```text
callApi
serviceTask1
send
worker
http-post
```

Contoh lebih baik:

```text
application.validate-eligibility
application.reserve-case-number
document.render-decision-letter
notification.send-approval-email
payment.collect-application-fee
```

Untuk breaking change:

```text
notification.send-approval-email.v2
```

atau gunakan versioned process + backward-compatible worker tergantung governance.

### 4.2 Worker name

Worker name adalah identifier worker untuk observability/audit.

Jangan gunakan random UUID sebagai satu-satunya identity karena sulit dianalisis. Gunakan gabungan:

```text
<service-name>/<pod-name>/<instance-id>
```

Contoh:

```text
aceas-case-worker/case-worker-7f6b9c9f8d-r2k9p
```

Worker name berguna untuk:

1. melihat worker mana yang mengaktifkan job;
2. forensic analysis;
3. debugging duplicate execution;
4. menghubungkan log Kubernetes dengan job activation;
5. audit operasional.

### 4.3 Timeout

Timeout adalah durasi lease job.

Jika worker tidak complete/fail/throw error sebelum timeout, Zeebe boleh membuat job tersedia lagi untuk worker lain.

Timeout bukan sekadar “berapa lama method boleh jalan”. Timeout adalah kontrak recovery.

Formula kasar:

```text
jobTimeout >= worst_case_queue_wait_inside_worker
           + worst_case_execution_time
           + network_completion_margin
```

Queue wait inside worker penting. Jika worker mengaktifkan 100 job tetapi hanya punya 10 thread, 90 job bisa menunggu sebelum mulai dieksekusi. Timeout tetap berjalan sejak activation, bukan sejak handler mulai bekerja secara nyata.

### 4.4 Max jobs active

`maxJobsActive` adalah jumlah maksimal job yang dapat diaktifkan dan dipegang worker secara bersamaan.

Ini bukan angka “semakin besar semakin cepat”. Ini adalah angka **in-flight lease capacity**.

Jika terlalu kecil:

1. worker underutilized;
2. throughput rendah;
3. banyak round trip activation.

Jika terlalu besar:

1. worker menahan job melebihi kapasitas eksekusi;
2. job timeout sebelum diproses;
3. duplicate execution meningkat;
4. external system bisa overload;
5. debugging menjadi sulit.

Rule of thumb awal:

```text
maxJobsActive ≈ worker_concurrency * small_buffer_factor
```

Contoh:

```text
worker threads = 16
average job time = 500 ms
external API stable
maxJobsActive = 16 sampai 32
```

Untuk job lambat:

```text
worker threads = 8
average job time = 30 seconds
maxJobsActive = 8 atau 12
```

Untuk job yang memanggil legacy API rapuh:

```text
worker threads = 4
maxJobsActive = 4
rate limit external API secara eksplisit
```

### 4.5 Polling vs streaming

Pada mode polling, worker secara berkala meminta job.

Pada job streaming, koneksi dapat dipertahankan agar latency activation lebih rendah dan engine dapat mengirim job saat tersedia melalui stream. Dokumentasi Camunda menyebut Java job worker memiliki stream timeout default satu jam dan bisa dikonfigurasi.

Secara mental:

| Mode | Cocok untuk |
|---|---|
| Polling | sederhana, kompatibel, traffic tidak terlalu latency-sensitive |
| Streaming | latency lebih rendah, throughput lebih smooth, mengurangi delay activation |

Tetapi streaming bukan obat semua masalah. Jika worker lambat atau external system bottleneck, streaming hanya membuat job lebih cepat sampai ke worker, bukan lebih cepat selesai.

### 4.6 Request timeout / command timeout

Command timeout berbeda dari job timeout.

| Timeout | Arti |
|---|---|
| Job timeout | berapa lama job lease dipegang worker |
| Command timeout | berapa lama client menunggu response dari gateway/broker untuk command |
| Request timeout | timeout network/API call dari client ke Camunda |
| Business timeout | deadline bisnis, biasanya dimodelkan dengan BPMN timer atau domain SLA |

Jangan mencampur semuanya.

Contoh:

```text
Job timeout: 5 minutes
Complete command timeout: 10 seconds
External API timeout: 3 seconds
Business SLA: 2 working days
```

Ini empat hal berbeda.

### 4.7 Fetch variables

Worker bisa mengambil semua variable atau subset variable.

Prinsip production:

> Worker hanya fetch variable yang dibutuhkan.

Alasannya:

1. payload lebih kecil;
2. deserialization lebih cepat;
3. risiko exposure PII lebih kecil;
4. coupling worker terhadap process variable lebih rendah;
5. log/debug lebih aman.

Contoh buruk:

```java
Map<String, Object> variables = job.getVariablesAsMap();
// worker mengambil semua variable besar termasuk dokumen, user profile, audit blob
```

Contoh lebih baik secara konsep:

```text
fetchVariables = ["applicationId", "applicantId", "decisionCode"]
```

### 4.8 Auto-completion vs manual completion

Beberapa integration style mengizinkan worker method return Map dan framework otomatis complete job.

Auto-completion nyaman untuk case sederhana.

Manual completion lebih cocok untuk:

1. async operation;
2. custom error mapping;
3. outbox/idempotency;
4. completing setelah transaction boundary tertentu;
5. fine-grained observability;
6. special handling BPMN error/fail command.

Jangan memilih auto-complete hanya karena lebih sedikit code. Pilih berdasarkan boundary semantics.

---

## 5. Anatomy Worker Production-Grade

Worker yang sehat biasanya memiliki struktur seperti ini:

```text
BPMN Service Task
   |
   v
Job Worker Adapter
   |
   +--> validate variables
   +--> create command object
   +--> set logging/tracing context
   +--> call application service
   +--> map domain result to process variables
   +--> complete/fail/throw BPMN error
   |
   v
Application Service
   |
   +--> idempotency guard
   +--> transaction boundary
   +--> domain validation
   +--> external adapter call
   +--> persistence/outbox
   |
   v
External System / DB / Messaging
```

### 5.1 Worker adapter should be thin

Worker method sebaiknya tidak berisi business logic besar.

Buruk:

```java
@JobWorker(type = "application.evaluate")
public Map<String, Object> handle(ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();
    // 300 lines of business rules
    // direct SQL
    // direct REST call
    // direct email
    // direct decision branching
    return result;
}
```

Lebih baik:

```java
@JobWorker(type = "application.evaluate")
public Map<String, Object> handle(ActivatedJob job) {
    EvaluationCommand command = mapper.toCommand(job);
    EvaluationResult result = applicationService.evaluate(command);
    return mapper.toVariables(result);
}
```

Worker adapter bertugas menerjemahkan antara dunia Zeebe dan dunia aplikasi.

### 5.2 Application service owns business use case

Application service sebaiknya tidak tahu detail `ActivatedJob`.

Contoh:

```java
public final class EvaluateApplicationCommand {
    private final String applicationId;
    private final String applicantId;
    private final String processInstanceKey;

    public EvaluateApplicationCommand(
            String applicationId,
            String applicantId,
            String processInstanceKey
    ) {
        this.applicationId = applicationId;
        this.applicantId = applicantId;
        this.processInstanceKey = processInstanceKey;
    }

    public String applicationId() {
        return applicationId;
    }

    public String applicantId() {
        return applicantId;
    }

    public String processInstanceKey() {
        return processInstanceKey;
    }
}
```

Untuk Java 16+ bisa memakai record:

```java
public record EvaluateApplicationCommand(
        String applicationId,
        String applicantId,
        long processInstanceKey
) {}
```

Tetapi karena seri ini mencakup Java 8 sampai 25, contoh utama sering menggunakan class biasa atau menyebut alternatif record jika relevan.

### 5.3 Mapper isolates variable contract

Jangan sebar string variable di seluruh codebase.

Buruk:

```java
String applicationId = (String) job.getVariablesAsMap().get("applicationId");
String applicantId = (String) job.getVariablesAsMap().get("applicantId");
String decision = (String) job.getVariablesAsMap().get("decision");
```

Jika ini tersebar di 30 worker, schema evolution jadi berbahaya.

Lebih baik:

```java
public final class ApplicationEvaluationVariables {
    public static final String APPLICATION_ID = "applicationId";
    public static final String APPLICANT_ID = "applicantId";
    public static final String DECISION = "decision";

    private ApplicationEvaluationVariables() {
    }
}
```

Lebih baik lagi gunakan typed mapper:

```java
public final class ApplicationEvaluationJobMapper {

    public EvaluateApplicationCommand toCommand(ActivatedJob job) {
        Map<String, Object> variables = job.getVariablesAsMap();

        String applicationId = requireString(variables, "applicationId");
        String applicantId = requireString(variables, "applicantId");

        return new EvaluateApplicationCommand(
                applicationId,
                applicantId,
                String.valueOf(job.getProcessInstanceKey())
        );
    }

    public Map<String, Object> toVariables(EvaluationResult result) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("decision", result.decisionCode());
        variables.put("riskScore", result.riskScore());
        return variables;
    }

    private static String requireString(Map<String, Object> variables, String name) {
        Object value = variables.get(name);
        if (!(value instanceof String) || ((String) value).isBlank()) {
            throw new InvalidProcessVariableException("Missing or invalid variable: " + name);
        }
        return (String) value;
    }
}
```

Catatan Java 8: `String.isBlank()` belum ada. Gunakan helper:

```java
private static boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
}
```

---

## 6. Worker Concurrency Model

Worker concurrency harus dipahami dari beberapa lapisan:

```text
Zeebe Broker partition processing
   |
Zeebe Gateway/client activation
   |
Client-side job buffer / active jobs
   |
Worker application thread pool
   |
Business code
   |
External dependency capacity
```

Bottleneck bisa ada di mana saja.

### 6.1 Jangan samakan maxJobsActive dengan thread count secara buta

`maxJobsActive` adalah jumlah lease/job yang aktif.

Thread count adalah kapasitas eksekusi bersamaan.

Keduanya berhubungan tetapi tidak identik.

Contoh masalah:

```text
maxJobsActive = 100
thread pool = 10
jobTimeout = 30 seconds
average job execution = 10 seconds
```

Worst case:

1. 100 job diaktifkan sekaligus.
2. 10 job mulai dieksekusi.
3. 90 job menunggu di queue worker.
4. Batch terakhir baru mulai setelah sekitar 90 detik.
5. Tetapi timeout 30 detik.
6. Banyak job timeout sebelum diproses.
7. Job bisa diaktifkan oleh worker lain.
8. Duplicate execution terjadi.

Maka rule awal:

```text
jobTimeout >= ceil(maxJobsActive / effectiveConcurrency) * worstCaseJobDuration + margin
```

Contoh:

```text
maxJobsActive = 40
effectiveConcurrency = 10
worstCaseJobDuration = 15 sec
margin = 10 sec

required timeout ≈ ceil(40/10) * 15 + 10
                 = 4 * 15 + 10
                 = 70 sec
```

Jika timeout default 5 menit, ini aman secara waktu. Tetapi tetap belum tentu aman untuk external API.

### 6.2 Effective concurrency bukan hanya thread count

Effective concurrency dibatasi oleh:

1. thread pool size;
2. database connection pool;
3. HTTP client connection pool;
4. rate limit external API;
5. CPU;
6. memory;
7. lock contention;
8. downstream service capacity;
9. retry storm;
10. Kubernetes CPU throttling.

Misal:

```text
worker thread pool = 50
HikariCP max pool = 10
external API rate limit = 20 requests/second
```

Effective concurrency untuk DB-bound job mungkin 10, bukan 50.

Untuk API-bound job, effective throughput mungkin 20 req/s, bukan thread count.

### 6.3 Blocking worker vs async worker

Banyak Java worker production tetap blocking IO karena:

1. lebih sederhana;
2. lebih mudah debug;
3. cocok dengan Spring MVC/JDBC/JPA;
4. transaction boundary lebih jelas.

Tetapi blocking worker butuh thread sizing yang benar.

Async worker bisa berguna untuk:

1. high-latency external calls;
2. non-blocking HTTP client;
3. high concurrency with limited threads;
4. event-driven internal architecture.

Namun async worker lebih sulit untuk:

1. exception handling;
2. completion timing;
3. tracing context propagation;
4. graceful shutdown;
5. idempotency boundary;
6. manual complete/fail command ordering.

Prinsip:

> Jangan memakai async hanya supaya terlihat modern. Pakai async jika bottleneck dan lifecycle-nya benar-benar kamu pahami.

### 6.4 Virtual threads Java 21+

Untuk Java 21+, virtual threads dapat membantu worker blocking IO yang melakukan banyak operasi wait.

Tetapi virtual threads tidak menghilangkan batas:

1. external API rate limit;
2. DB connection pool;
3. Zeebe job timeout;
4. memory payload;
5. duplicate execution;
6. idempotency;
7. CPU-bound work.

Virtual threads membuat blocking lebih murah, bukan membuat downstream menjadi infinite.

Model aman:

```text
Virtual threads for handler execution
Semaphore/rate limiter for downstream capacity
maxJobsActive aligned with real capacity
jobTimeout aligned with queue + execution time
```

Contoh konsep:

```java
public final class DownstreamLimiter {
    private final Semaphore semaphore;

    public DownstreamLimiter(int permits) {
        this.semaphore = new Semaphore(permits);
    }

    public <T> T execute(Callable<T> action) throws Exception {
        semaphore.acquire();
        try {
            return action.call();
        } finally {
            semaphore.release();
        }
    }
}
```

---

## 7. Timeout Engineering

Timeout adalah salah satu sumber incident paling umum.

Ada beberapa timeout yang harus disusun sebagai hierarchy.

### 7.1 External API timeout harus lebih pendek dari job timeout

Contoh baik:

```text
job timeout       = 120 seconds
external timeout  = 5 seconds
retry/backoff     = controlled by worker or process
completion margin = enough
```

Contoh buruk:

```text
job timeout       = 30 seconds
external timeout  = 60 seconds
```

Jika external call bisa menunggu 60 detik, tetapi job lease hanya 30 detik, worker bisa menyelesaikan operasi yang secara engine sudah dianggap expired.

### 7.2 Job timeout bukan SLA bisnis

Jangan menyetel job timeout menjadi 3 hari karena “proses bisnis boleh menunggu 3 hari”.

Jika proses bisnis harus menunggu 3 hari, gunakan BPMN timer/user task/message wait state.

Job timeout adalah recovery window untuk worker execution, bukan business waiting time.

Contoh:

```text
Human review SLA = 3 days
Use: user task + timer boundary event
Not: service task worker timeout = 3 days
```

### 7.3 Job timeout terlalu pendek menyebabkan false timeout

Jika timeout terlalu pendek:

1. job timeout saat masih dikerjakan;
2. worker lain mengambil job yang sama;
3. duplicate side effect;
4. completion dari worker pertama bisa gagal;
5. incident/debug sulit.

### 7.4 Job timeout terlalu panjang memperlambat recovery

Jika worker mati setelah mengaktifkan job, Zeebe menunggu timeout sebelum job bisa dikerjakan ulang.

Jika timeout terlalu panjang:

1. recovery lambat;
2. process terlihat stuck;
3. SLA terganggu;
4. incident triage membingungkan.

### 7.5 Practical timeout calculation

Gunakan formula awal:

```text
jobTimeout = queueWaitUpperBound
           + executionTimeUpperBound
           + externalDependencyTimeoutBudget
           + completionCommandBudget
           + safetyMargin
```

Sederhana:

```text
jobTimeout = P99_execution_time * 2 + queue_margin
```

Tetapi untuk worker yang batch activating banyak job:

```text
queue_margin = ceil(maxJobsActive / effectiveConcurrency) * P99_execution_time
```

Contoh:

```text
P99 execution = 4 sec
effective concurrency = 20
maxJobsActive = 40
completion margin = 5 sec

queue margin = ceil(40/20) * 4 = 8 sec
jobTimeout ≈ 8 + 4 + 5 = 17 sec
round up to 30 sec
```

Untuk external legacy API:

```text
P99 execution = 45 sec
effective concurrency = 5
maxJobsActive = 5
completion margin = 15 sec

queue margin = 45 sec
jobTimeout ≈ 45 + 45 + 15 = 105 sec
round up to 2-3 minutes
```

---

## 8. Retry, Fail, BPMN Error, and Incident Boundary

Worker dapat menyelesaikan job dengan beberapa cara:

```text
complete job        -> business work succeeded
fail job            -> technical failure, may retry
throw BPMN error    -> modelled business error path
let timeout expire  -> worker crash/hang/slow; job may be retried by engine
```

### 8.1 Complete job

Complete job jika business operation selesai dan process boleh bergerak maju.

Completion dapat menyertakan variables.

Contoh conceptual:

```java
client.newCompleteCommand(job.getKey())
      .variables(Map.of("decision", "APPROVED"))
      .send()
      .join();
```

Dengan Spring annotation, framework bisa auto-complete dari return value.

### 8.2 Fail job

Fail job untuk technical/transient failure.

Contoh:

1. external API timeout;
2. database temporary unavailable;
3. network error;
4. downstream 503;
5. lock conflict;
6. temporary rate limit.

Fail job biasanya mengurangi retries.

Jika retries habis, incident dibuat.

### 8.3 Retry backoff

Retry tanpa backoff bisa menyebabkan retry storm.

Contoh buruk:

```text
external API down
1000 jobs fail immediately
retry immediately
external API makin down
incident storm
```

Lebih baik:

```text
retry after 30s, then 2m, then 10m
```

Camunda job failure command mendukung retry backoff pada client API. Gunakan backoff untuk memberi waktu external dependency pulih.

### 8.4 BPMN error

BPMN error adalah business error yang dimodelkan.

Contoh:

1. applicant not eligible;
2. document rejected;
3. payment declined;
4. duplicate application detected;
5. verification failed secara valid.

Jika business outcome memang harus mengarah ke path tertentu dalam BPMN, gunakan BPMN error atau output variable + gateway, tergantung desain.

### 8.5 Incident

Incident menunjukkan process instance tidak bisa lanjut tanpa intervensi/perbaikan.

Incident bukan sekadar log error. Incident adalah operational state di process engine.

Incident cocok untuk:

1. retries habis;
2. invalid variable yang tidak bisa diperbaiki otomatis;
3. missing worker untuk job type;
4. expression evaluation failure;
5. unexpected system defect.

### 8.6 Decision matrix

| Situation | Worker action |
|---|---|
| External API 503 | fail job with retry/backoff |
| External API validation says applicant invalid | BPMN error atau complete with rejection variable |
| Required process variable missing due to model bug | fail job, likely incident after retries or direct incident strategy |
| Business rule says application rejected | complete with decision variable atau BPMN error if explicit exception path |
| Worker code bug NullPointerException | fail job; alert; incident if retries exhausted |
| Duplicate request detected but previous success exists | complete idempotently with existing result |
| Downstream rate limited | fail with retry backoff or local rate limiter before call |

Part 007 akan membahas ini lebih dalam dari sisi idempotency.

---

## 9. Worker Backpressure and Capacity Honesty

Zeebe memiliki mekanisme backpressure untuk melindungi broker ketika sistem overload. Dokumentasi Camunda menjelaskan bahwa saat backpressure aktif, broker dapat menolak request tertentu, sementara complete/fail job termasuk request yang tetap penting untuk diterima agar sistem bisa drain.

Dari sisi worker, backpressure harus dianggap sebagai sinyal:

> “Cluster atau downstream orchestration path sedang tidak mampu menerima beban setinggi ini.”

### 9.1 Worker-side overload

Worker sendiri bisa overload meskipun Zeebe sehat.

Tanda-tanda:

1. active jobs tinggi;
2. handler latency naik;
3. queue internal penuh;
4. timeout job meningkat;
5. CPU throttling;
6. GC meningkat;
7. DB pool exhausted;
8. HTTP pool exhausted;
9. error rate external API naik.

### 9.2 Downstream overload

Kadang worker sehat, tetapi external dependency overload.

Contoh:

```text
Zeebe has 10k jobs ready
Worker can process 500/s
External API can process 50/s
```

Jika worker tidak membatasi diri, external API akan jatuh.

Solusi:

1. rate limiter;
2. bulkhead;
3. lower worker concurrency;
4. lower `maxJobsActive`;
5. retry backoff;
6. queueing by process design;
7. circuit breaker;
8. BPMN timer for delayed retry if business meaningful.

### 9.3 Capacity honesty principle

Prinsip:

> Worker should only activate what it can realistically finish within timeout and downstream capacity.

Jangan menggunakan Zeebe sebagai queue tak terbatas untuk memaksa downstream.

---

## 10. Graceful Shutdown

Graceful shutdown sangat penting di Kubernetes, ECS, VM, atau deployment rolling update.

Tanpa graceful shutdown:

1. pod menerima SIGTERM;
2. worker langsung mati;
3. active jobs tidak complete/fail;
4. Zeebe menunggu job timeout;
5. job diulang;
6. process delay meningkat;
7. duplicate side effect mungkin terjadi.

### 10.1 Shutdown lifecycle ideal

```text
SIGTERM received
   |
   v
Stop accepting new jobs
   |
   v
Wait for active jobs to finish until grace period
   |
   +--> completed/fail cleanly
   |
   +--> if grace exhausted, exit safely
   |
   v
Close Camunda client
   |
   v
Application exits
```

### 10.2 Kubernetes implications

Kubernetes biasanya memberi `terminationGracePeriodSeconds`.

Nilai ini harus lebih besar dari expected worker drain time.

Contoh:

```yaml
terminationGracePeriodSeconds: 90
```

Jika job P99 60 detik, grace 30 detik bisa terlalu pendek.

### 10.3 Readiness probe

Saat shutdown dimulai, readiness harus false agar pod tidak menerima traffic HTTP baru.

Tetapi worker activation bukan selalu dikontrol oleh readiness HTTP. Aplikasi worker harus benar-benar close/stop worker subscription.

### 10.4 PreStop hook

Kadang digunakan untuk memberi waktu lebih awal sebelum SIGTERM.

Tetapi jangan bergantung pada sleep sebagai satu-satunya mekanisme. Worker tetap harus support stop accepting new jobs.

---

## 11. Observability Worker

Worker tanpa observability adalah sumber blind spot.

Minimal log context:

```text
processInstanceKey
processDefinitionKey
bpmnProcessId
processDefinitionVersion
jobKey
jobType
workerName
tenantId
correlationKey/businessKey/applicationId
retries
attempt
```

### 11.1 Structured log

Contoh log conceptual:

```json
{
  "event": "job_started",
  "jobType": "application.evaluate",
  "jobKey": 2251799813685249,
  "processInstanceKey": 2251799813685250,
  "bpmnProcessId": "application-review-process",
  "applicationId": "APP-2026-0001",
  "worker": "case-worker/pod-abc",
  "retries": 3
}
```

Completion log:

```json
{
  "event": "job_completed",
  "jobType": "application.evaluate",
  "jobKey": 2251799813685249,
  "processInstanceKey": 2251799813685250,
  "applicationId": "APP-2026-0001",
  "durationMs": 842,
  "decision": "APPROVED"
}
```

Failure log:

```json
{
  "event": "job_failed",
  "jobType": "application.evaluate",
  "jobKey": 2251799813685249,
  "processInstanceKey": 2251799813685250,
  "applicationId": "APP-2026-0001",
  "durationMs": 5000,
  "errorClass": "ExternalServiceTimeoutException",
  "remainingRetries": 2,
  "retryBackoffMs": 30000
}
```

### 11.2 Metrics

Minimal metrics:

| Metric | Meaning |
|---|---|
| `worker_jobs_started_total` | jumlah job mulai diproses |
| `worker_jobs_completed_total` | jumlah job selesai sukses |
| `worker_jobs_failed_total` | jumlah job failed technical |
| `worker_jobs_bpmn_error_total` | jumlah BPMN error thrown |
| `worker_job_duration_seconds` | durasi handler |
| `worker_active_jobs` | active in-flight jobs |
| `worker_queue_depth` | internal queue depth jika ada |
| `worker_downstream_call_duration_seconds` | latency external dependency |
| `worker_downstream_failures_total` | failure external dependency |
| `worker_completion_failures_total` | complete command gagal |
| `worker_timeout_suspected_total` | dugaan job timeout/stale completion |

### 11.3 Tracing

Trace ideal:

```text
Process Instance / Job
   |
   v
Worker handler span
   |
   +--> DB span
   +--> HTTP external API span
   +--> message publish span
   |
   v
Complete job command span
```

Gunakan correlation ID yang konsisten:

```text
traceId
processInstanceKey
jobKey
businessId
```

### 11.4 Alerting

Alert worker jangan hanya CPU tinggi.

Alert yang lebih bermakna:

1. job failure rate naik;
2. job duration P95/P99 naik;
3. active jobs mendekati max terus-menerus;
4. retries exhausted/incident naik;
5. external dependency error naik;
6. completion command failure naik;
7. no completion for job type tertentu dalam X menit;
8. worker pod alive tetapi job throughput zero.

---

## 12. Worker Error Taxonomy

Sebelum menulis code, definisikan error taxonomy.

Contoh:

```text
WorkerError
├── BusinessOutcome
│   ├── ApplicantIneligible
│   ├── PaymentDeclined
│   └── DocumentRejected
├── TransientTechnicalFailure
│   ├── ExternalTimeout
│   ├── RateLimited
│   ├── DatabaseUnavailable
│   └── NetworkFailure
├── PermanentTechnicalFailure
│   ├── InvalidProcessVariable
│   ├── UnsupportedVersion
│   └── MissingConfiguration
└── UnknownDefect
    ├── NullPointerException
    ├── IllegalStateException
    └── UnexpectedSerializationError
```

Mapping:

| Error category | Worker response |
|---|---|
| BusinessOutcome | BPMN error atau complete with business variable |
| TransientTechnicalFailure | fail job with retry/backoff |
| PermanentTechnicalFailure | fail job; likely incident; low/no retry |
| UnknownDefect | fail job; alert; incident if repeated |

### 12.1 Jangan semua exception diperlakukan sama

Buruk:

```java
try {
    service.doWork();
    complete(job);
} catch (Exception e) {
    fail(job, e);
}
```

Lebih baik:

```java
try {
    Result result = service.doWork(command);
    complete(job, result);
} catch (BusinessRejectionException e) {
    throwBpmnError(job, e);
} catch (TransientExternalException e) {
    failWithBackoff(job, e, Duration.ofSeconds(30));
} catch (InvalidProcessVariableException e) {
    failWithoutMeaninglessRetries(job, e);
} catch (Exception e) {
    failAndAlert(job, e);
}
```

---

## 13. Transaction Boundary with Worker

Worker sering melakukan operasi database dan external API.

Masalah muncul saat mencoba menyamakan Zeebe completion dengan DB transaction.

Camunda 8 worker berjalan remote. Complete job command bukan bagian dari transaction DB lokalmu.

### 13.1 DB commit then complete job

Pattern umum:

```text
Begin DB transaction
   |
   +--> update local state
   +--> store idempotency result
Commit DB transaction
   |
Complete Zeebe job
```

Failure case:

```text
DB commit succeeds
Complete job fails due to network
Job retried
Worker sees idempotency result
Worker completes job again with same result
```

Ini aman jika idempotency benar.

### 13.2 Complete job then DB commit

Pattern berbahaya:

```text
Complete Zeebe job
   |
Begin DB transaction
   |
Update DB fails
```

Process sudah bergerak maju, tetapi state lokal gagal. Ini biasanya tidak aman.

### 13.3 External API call then complete job

Pattern umum tapi perlu idempotency:

```text
Call external API
   |
External succeeds
   |
Complete Zeebe job fails
   |
Job retried
   |
External may be called again
```

Harus ada:

1. external idempotency key;
2. local dedup store;
3. query-before-command pattern;
4. outbox/inbox;
5. result replay.

Part 007 akan membahas penuh.

---

## 14. Worker Design for Different Job Types

Tidak semua worker sama.

### 14.1 Fast pure computation worker

Contoh:

1. calculate risk score;
2. transform variables;
3. validate format;
4. derive decision.

Karakteristik:

```text
CPU-bound or memory-bound
No external side effect
Low duplicate risk
Can use higher concurrency if CPU allows
```

Risiko:

1. CPU saturation;
2. payload besar;
3. GC pressure.

### 14.2 External API worker

Contoh:

1. call identity verification;
2. call payment gateway;
3. call geocoding service;
4. call government registry.

Karakteristik:

```text
IO-bound
Downstream rate-limited
High failure variability
Requires idempotency
```

Butuh:

1. strict timeout;
2. retry taxonomy;
3. backoff;
4. circuit breaker;
5. idempotency key;
6. observability per dependency.

### 14.3 Database mutation worker

Contoh:

1. create case record;
2. reserve application number;
3. update status;
4. store audit event.

Karakteristik:

```text
DB-bound
Transaction-sensitive
May need unique constraints
```

Butuh:

1. DB transaction;
2. idempotency table;
3. unique business key;
4. optimistic locking;
5. retry on transient DB errors.

### 14.4 Document generation worker

Contoh:

1. PDF generation;
2. template rendering;
3. report generation;
4. document upload.

Karakteristik:

```text
CPU + IO + storage
Potentially large payload
Longer execution time
```

Butuh:

1. reference-over-payload;
2. object storage;
3. timeout budget lebih besar;
4. memory limit awareness;
5. async generation if long-running;
6. worker-specific scaling.

### 14.5 Notification worker

Contoh:

1. send email;
2. send SMS;
3. send push notification;
4. send internal alert.

Karakteristik:

```text
External side effect
Duplicate can be visible to users
```

Butuh:

1. notification dedup key;
2. outbox;
3. delivery log;
4. retry/backoff;
5. template versioning;
6. suppress duplicate sends.

---

## 15. Worker Scaling Strategy

Worker bisa diskalakan secara horizontal.

```text
worker deployment replicas = N
```

Semua replica bisa mengambil job type yang sama.

### 15.1 Horizontal scaling effect

Jika satu worker pod:

```text
maxJobsActive = 20
replicas = 1
cluster total active capacity = 20
```

Jika 10 pods:

```text
maxJobsActive = 20 each
replicas = 10
total active capacity = 200
```

Ini bisa overload downstream jika tidak dihitung.

### 15.2 Total capacity formula

```text
totalMaxActive = replicas * maxJobsActivePerReplica
```

```text
totalConcurrency = replicas * concurrencyPerReplica
```

```text
downstreamCapacity must be >= totalEffectiveThroughput
```

Jika external API hanya mampu 50 req/s, jangan scale worker menjadi 500 req/s tanpa limiter.

### 15.3 Per-job-type scaling

Pisahkan worker berdasarkan job type jika karakteristiknya sangat berbeda.

Contoh:

```text
case-worker
  - application.validate
  - case.assign

notification-worker
  - email.send
  - sms.send

document-worker
  - pdf.generate
  - document.archive
```

Manfaat:

1. scaling independen;
2. resource tuning spesifik;
3. blast radius lebih kecil;
4. deployment lebih aman;
5. ownership lebih jelas.

Kerugian:

1. lebih banyak service;
2. lebih banyak deployment config;
3. lebih banyak observability surface;
4. version governance lebih kompleks.

### 15.4 One worker app vs many worker apps

| Model | Cocok untuk | Risiko |
|---|---|---|
| One app handles many job types | early stage, small system, shared domain | noisy neighbor, scaling sulit |
| One app per bounded domain | enterprise domain services | butuh governance |
| One app per heavy job type | document, integration, notification | banyak deployment |

Prinsip:

> Scale by bottleneck and ownership boundary, not by BPMN diagram convenience.

---

## 16. Worker Configuration Example

Konfigurasi aktual berubah antar versi client/starter. Gunakan ini sebagai contoh konseptual, bukan copy-paste final tanpa cek versi.

### 16.1 Spring Boot style conceptual YAML

```yaml
camunda:
  client:
    mode: self-managed
    auth:
      client-id: ${CAMUNDA_CLIENT_ID}
      client-secret: ${CAMUNDA_CLIENT_SECRET}
    zeebe:
      enabled: true
      grpc-address: ${CAMUNDA_GRPC_ADDRESS}
      rest-address: ${CAMUNDA_REST_ADDRESS}
      prefer-rest-over-grpc: false
```

Worker-specific property names harus mengikuti versi starter yang digunakan. Pada versi modern Camunda Spring Boot Starter, cek dokumentasi configuration untuk property names yang tepat.

### 16.2 Programmatic worker conceptual example

```java
public final class WorkerBootstrap {

    private final CamundaClient client;
    private final PaymentJobHandler handler;
    private JobWorker worker;

    public WorkerBootstrap(CamundaClient client, PaymentJobHandler handler) {
        this.client = client;
        this.handler = handler;
    }

    public void start() {
        this.worker = client.newWorker()
                .jobType("payment.charge")
                .handler(handler)
                .name("payment-worker")
                .timeout(Duration.ofMinutes(2))
                .maxJobsActive(16)
                .open();
    }

    public void stop() {
        if (worker != null) {
            worker.close();
        }
    }
}
```

Catatan: API detail dapat berubah. Fokus di sini adalah parameter dan mental modelnya.

---

## 17. Manual Handler Pattern

Manual handler cocok jika kamu ingin kontrol penuh.

```java
public final class PaymentJobHandler implements JobHandler {

    private final CamundaClient client;
    private final PaymentApplicationService service;
    private final PaymentJobMapper mapper;
    private final WorkerErrorMapper errorMapper;

    public PaymentJobHandler(
            CamundaClient client,
            PaymentApplicationService service,
            PaymentJobMapper mapper,
            WorkerErrorMapper errorMapper
    ) {
        this.client = client;
        this.service = service;
        this.mapper = mapper;
        this.errorMapper = errorMapper;
    }

    @Override
    public void handle(JobClient ignored, ActivatedJob job) {
        long startedAt = System.nanoTime();

        try {
            PaymentCommand command = mapper.toCommand(job);
            PaymentResult result = service.charge(command);
            Map<String, Object> variables = mapper.toVariables(result);

            client.newCompleteCommand(job.getKey())
                    .variables(variables)
                    .send()
                    .join();

            logCompleted(job, startedAt);
        } catch (PaymentDeclinedException e) {
            throwPaymentDeclinedBpmnError(job, e);
        } catch (TransientPaymentGatewayException e) {
            failWithBackoff(job, e, Duration.ofSeconds(30));
        } catch (InvalidProcessVariableException e) {
            failAsPermanent(job, e);
        } catch (Exception e) {
            failAsUnknown(job, e);
        }
    }

    private void throwPaymentDeclinedBpmnError(ActivatedJob job, PaymentDeclinedException e) {
        client.newThrowErrorCommand(job.getKey())
                .errorCode("PAYMENT_DECLINED")
                .errorMessage(e.getMessage())
                .send()
                .join();
    }

    private void failWithBackoff(ActivatedJob job, Exception e, Duration backoff) {
        int remainingRetries = Math.max(0, job.getRetries() - 1);

        client.newFailCommand(job.getKey())
                .retries(remainingRetries)
                .retryBackoff(backoff)
                .errorMessage(e.getMessage())
                .send()
                .join();
    }

    private void failAsPermanent(ActivatedJob job, Exception e) {
        client.newFailCommand(job.getKey())
                .retries(0)
                .errorMessage(e.getMessage())
                .send()
                .join();
    }

    private void failAsUnknown(ActivatedJob job, Exception e) {
        int remainingRetries = Math.max(0, job.getRetries() - 1);

        client.newFailCommand(job.getKey())
                .retries(remainingRetries)
                .errorMessage("Unexpected worker failure: " + e.getClass().getSimpleName())
                .send()
                .join();
    }

    private void logCompleted(ActivatedJob job, long startedAt) {
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
        // structured log here
    }
}
```

Catatan:

1. Jangan leak stack trace panjang ke process variable/error message.
2. Simpan detail error lengkap di log/observability system.
3. Error message di engine sebaiknya cukup untuk triage, bukan dump rahasia.
4. Jangan expose PII/secret dalam error message.

---

## 18. Annotation-Based Worker Pattern

Spring Boot annotation style ringkas dan produktif.

```java
@Component
public final class ApplicationEvaluationWorker {

    private final ApplicationEvaluationService service;
    private final ApplicationEvaluationJobMapper mapper;

    public ApplicationEvaluationWorker(
            ApplicationEvaluationService service,
            ApplicationEvaluationJobMapper mapper
    ) {
        this.service = service;
        this.mapper = mapper;
    }

    @JobWorker(type = "application.evaluate")
    public Map<String, Object> evaluate(final ActivatedJob job) {
        EvaluateApplicationCommand command = mapper.toCommand(job);
        EvaluationResult result = service.evaluate(command);
        return mapper.toVariables(result);
    }
}
```

Cocok untuk:

1. simple synchronous handlers;
2. clear success/failure model;
3. no complex manual command handling;
4. team yang ingin cepat produktif.

Namun untuk production, tetap perlu:

1. error mapping strategy;
2. global exception handler jika starter mendukung;
3. explicit retries/backoff;
4. logging/tracing interceptor;
5. variable validation;
6. idempotency di service.

---

## 19. Worker as Adapter: Package Structure

Contoh struktur package:

```text
com.example.caseworker
├── boot
│   └── CaseWorkerApplication.java
├── camunda
│   ├── worker
│   │   ├── ApplicationEvaluationWorker.java
│   │   ├── DocumentGenerationWorker.java
│   │   └── NotificationWorker.java
│   ├── mapper
│   │   ├── ApplicationEvaluationJobMapper.java
│   │   └── DocumentGenerationJobMapper.java
│   ├── contract
│   │   ├── JobTypes.java
│   │   ├── Variables.java
│   │   └── BpmnErrors.java
│   └── error
│       └── WorkerExceptionMapper.java
├── application
│   ├── EvaluateApplicationService.java
│   ├── GenerateDocumentService.java
│   └── SendNotificationService.java
├── domain
│   ├── Application.java
│   ├── Decision.java
│   └── CaseNumber.java
├── infrastructure
│   ├── persistence
│   ├── http
│   ├── messaging
│   └── storage
└── observability
    ├── WorkerLoggingContext.java
    └── WorkerMetrics.java
```

Prinsip dependency:

```text
camunda.worker -> application -> domain
camunda.mapper -> application commands/results
application -> infrastructure ports
infrastructure -> external systems
```

Domain tidak boleh bergantung pada Camunda classes.

---

## 20. Variable Validation and Defensive Boundary

Worker harus memvalidasi input variable di boundary.

Kenapa?

Karena process variable dapat rusak karena:

1. model change;
2. previous worker bug;
3. manual modification;
4. migration;
5. JSON schema drift;
6. unexpected null;
7. wrong number type;
8. user task output berbeda.

### 20.1 Required variable

```java
private static String requireString(Map<String, Object> variables, String name) {
    Object value = variables.get(name);
    if (!(value instanceof String)) {
        throw new InvalidProcessVariableException("Required string variable missing: " + name);
    }
    String text = (String) value;
    if (text.trim().isEmpty()) {
        throw new InvalidProcessVariableException("Required string variable blank: " + name);
    }
    return text;
}
```

### 20.2 Optional variable

```java
private static Optional<String> optionalString(Map<String, Object> variables, String name) {
    Object value = variables.get(name);
    if (value == null) {
        return Optional.empty();
    }
    if (!(value instanceof String)) {
        throw new InvalidProcessVariableException("Optional variable has invalid type: " + name);
    }
    String text = (String) value;
    return text.trim().isEmpty() ? Optional.empty() : Optional.of(text);
}
```

### 20.3 Number variable issue

JSON numeric types can deserialize as `Integer`, `Long`, `Double`, `BigDecimal`, depending on mapper/config.

Jangan blindly cast:

```java
Long amount = (Long) variables.get("amount");
```

Lebih defensif:

```java
private static BigDecimal requireBigDecimal(Map<String, Object> variables, String name) {
    Object value = variables.get(name);
    if (value instanceof BigDecimal) {
        return (BigDecimal) value;
    }
    if (value instanceof Number) {
        return new BigDecimal(value.toString());
    }
    if (value instanceof String) {
        return new BigDecimal((String) value);
    }
    throw new InvalidProcessVariableException("Required numeric variable missing: " + name);
}
```

---

## 21. Worker and Sensitive Data

Worker sering melihat process variables. Jangan otomatis log variables.

Buruk:

```java
log.info("Processing job variables={}", job.getVariables());
```

Risiko:

1. PII leakage;
2. credential leakage;
3. audit exposure;
4. log storage compliance issue;
5. incident response lebih kompleks.

Lebih baik:

```java
log.info("Processing job type={} jobKey={} processInstanceKey={} applicationId={}",
        job.getType(),
        job.getKey(),
        job.getProcessInstanceKey(),
        safeApplicationId);
```

Variable besar/sensitif sebaiknya disimpan sebagai reference:

```json
{
  "applicationId": "APP-2026-0001",
  "documentRef": "s3://bucket/path/document.pdf",
  "profileRef": "profile-service/customer/123"
}
```

Bukan:

```json
{
  "fullDocumentBase64": "...massive...",
  "fullApplicantProfile": { ... },
  "fullIdentityPayload": { ... }
}
```

---

## 22. Worker and External System Calls

External calls harus punya standard:

1. connect timeout;
2. read timeout;
3. total timeout;
4. retry policy;
5. idempotency key;
6. rate limiting;
7. circuit breaker;
8. response validation;
9. error mapping;
10. correlation header.

### 22.1 Correlation headers

Saat worker memanggil external service, kirim header:

```text
X-Correlation-Id: <trace-id/business-id>
X-Process-Instance-Key: <processInstanceKey>
X-Zeebe-Job-Key: <jobKey>
X-Request-Id: <idempotency-key>
```

Jangan selalu expose internal Zeebe key ke third-party external jika tidak sesuai security policy. Untuk internal service, ini sangat membantu traceability.

### 22.2 Idempotency header

Untuk operation seperti payment, document generation, notification:

```text
Idempotency-Key: payment:<businessId>:<semanticOperationVersion>
```

Jangan hanya gunakan job key jika retry setelah timeout membuat job baru/aktivasi berbeda tetapi business side effect harus sama.

Part 007 akan membedah pemilihan key.

---

## 23. Worker and Database Design

Worker yang melakukan DB mutation harus punya constraint.

Contoh idempotency table:

```sql
CREATE TABLE worker_execution_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_key VARCHAR(200) NOT NULL,
    job_type VARCHAR(100) NOT NULL,
    process_instance_key VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL,
    result_json CLOB,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT uq_worker_execution_operation UNIQUE (operation_key)
);
```

Flow:

```text
Worker receives job
   |
Compute operation_key
   |
Try insert operation_key as IN_PROGRESS
   |
If duplicate:
   +--> if SUCCESS exists, replay result and complete job
   +--> if IN_PROGRESS stale, decide recovery strategy
   +--> if FAILED permanent, map error
   |
Execute business operation
   |
Store SUCCESS result
   |
Complete job
```

Ini bukan selalu wajib untuk semua worker, tetapi wajib dipertimbangkan untuk side effect non-idempotent.

---

## 24. Worker Health Checks

Worker app biasanya expose HTTP health endpoint.

Tetapi health harus dibedakan:

| Health type | Meaning |
|---|---|
| Liveness | process masih hidup |
| Readiness | siap menerima traffic / menjalankan worker |
| Startup | initialization selesai |
| Dependency health | dependency penting reachable |
| Worker health | worker subscription/client sehat |

### 24.1 Liveness jangan terlalu agresif

Jika liveness gagal, Kubernetes restart pod.

Restart bisa membuat active jobs timeout dan duplicate.

Liveness sebaiknya hanya gagal jika app benar-benar stuck/unrecoverable.

### 24.2 Readiness boleh lebih ketat

Readiness bisa false jika:

1. config belum loaded;
2. client tidak bisa connect;
3. DB unavailable;
4. app sedang shutting down;
5. worker intentionally paused.

### 24.3 Dependency health trade-off

Jika external API down, apakah worker readiness harus false?

Tergantung.

Jika false:

1. worker berhenti ambil job;
2. job tetap di Zeebe;
3. bagus untuk menghindari fail storm.

Tetapi jika semua replicas false, tidak ada worker untuk fail/backoff secara eksplisit.

Alternatif:

1. tetap ready tetapi circuit breaker fail with backoff;
2. pause worker job activation;
3. reduce concurrency dynamically;
4. use feature flag/ops toggle.

---

## 25. Worker Pause/Resume and Operational Control

Production system sering butuh pause worker tertentu.

Contoh:

1. external agency API maintenance;
2. downstream bug;
3. data corruption risk;
4. migration window;
5. rate limit exceeded;
6. emergency stop.

Worker should support operational control:

```text
PAUSED: do not activate new jobs
RUNNING: activate and process jobs
DRAINING: no new jobs, finish active jobs
DISABLED: app alive, worker closed
```

Implementasi bisa melalui:

1. config flag;
2. admin endpoint internal;
3. feature flag service;
4. Kubernetes scale down;
5. deployment config.

Hati-hati scale down mendadak tanpa drain.

---

## 26. Worker Security

Worker memegang credential untuk:

1. Camunda API;
2. DB;
3. external APIs;
4. object storage;
5. messaging;
6. secrets manager.

Prinsip:

1. least privilege;
2. separate credential per worker app/domain;
3. rotate secrets;
4. never log secrets;
5. avoid embedding secrets in BPMN variables;
6. do not expose Camunda client credential to frontend;
7. use network policies where possible;
8. restrict worker egress.

### 26.1 Job worker permission boundary

Worker harus hanya boleh mengerjakan job types yang menjadi tanggung jawabnya.

Secara teknis, client credential mungkin punya akses luas. Secara governance, pisahkan credential jika memungkinkan.

### 26.2 Sensitive error handling

Jangan kirim detail rahasia ke error message job.

Buruk:

```text
Failed to call https://api.example.com with token abc123 because password xyz invalid
```

Baik:

```text
External identity verification failed due to authentication error. See worker logs with correlationId=...
```

---

## 27. Worker Release and Compatibility

Worker deployment harus compatible dengan BPMN process versions.

### 27.1 Breaking worker change

Breaking change:

1. worker membutuhkan variable baru;
2. worker mengubah output variable type;
3. worker mengubah BPMN error code;
4. worker mengubah job type;
5. worker mengubah idempotency key semantics;
6. worker mengubah external side effect behavior.

### 27.2 Backward-compatible worker

Worker bisa support old and new variable contract:

```java
String applicationId = optionalString(vars, "applicationId")
        .orElseGet(() -> requireString(vars, "caseApplicationId"));
```

Tetapi jangan biarkan compatibility logic tumbuh tanpa batas.

### 27.3 Deploy order

Untuk non-breaking change:

```text
Deploy worker first or process first depending compatibility
```

Untuk new job type:

```text
1. deploy worker that supports new job type
2. verify worker registered/healthy
3. deploy BPMN using new job type
4. start traffic
```

Jika deploy BPMN dulu tanpa worker, job akan created tetapi tidak ada worker yang mengambil. Ini bisa terlihat seperti process stuck.

### 27.4 Old process instances

Running process instances versi lama mungkin masih membuat job type lama.

Jangan hapus worker lama sebelum yakin tidak ada instance lama yang membutuhkan.

---

## 28. Worker Testing

Testing detail dibahas di Part 026, tetapi worker production-grade harus dari awal dirancang testable.

Minimal test:

1. mapper test;
2. missing variable test;
3. invalid type test;
4. business success test;
5. business rejection test;
6. transient failure mapping test;
7. permanent failure mapping test;
8. idempotency replay test;
9. duplicate job simulation;
10. timeout/retry scenario;
11. shutdown drain behavior if custom lifecycle.

### 28.1 Mapper unit test

```java
@Test
public void shouldMapValidVariablesToCommand() {
    Map<String, Object> vars = new HashMap<>();
    vars.put("applicationId", "APP-1");
    vars.put("applicantId", "USER-1");

    EvaluateApplicationCommand command = mapper.toCommand(fakeJob(vars));

    assertEquals("APP-1", command.applicationId());
    assertEquals("USER-1", command.applicantId());
}
```

### 28.2 Error mapping test

```java
@Test
public void shouldMapTransientFailureToFailJobWithBackoff() {
    // Given service throws timeout
    // When worker handles job
    // Then fail command is sent with retries-1 and retryBackoff
}
```

### 28.3 Integration test

Gunakan real Camunda test environment/Testcontainers jika memungkinkan untuk:

1. deploy BPMN;
2. start process;
3. worker completes job;
4. assert process reaches expected state;
5. simulate failure;
6. assert incident or BPMN error path.

---

## 29. Common Anti-Patterns

### 29.1 Worker does everything

Worker berisi logic besar, SQL, REST, mapping, branching, notification.

Akibat:

1. susah test;
2. susah reuse;
3. susah observe;
4. coupling BPMN-domain tinggi;
5. bug lebih mudah tersembunyi.

### 29.2 `maxJobsActive` besar tanpa menghitung timeout

Akibat:

1. job timeout saat antre;
2. duplicate execution;
3. incident storm;
4. false perception that Zeebe is slow.

### 29.3 Logging all variables

Akibat:

1. PII leak;
2. log cost tinggi;
3. compliance issue.

### 29.4 No idempotency for external side effect

Akibat:

1. duplicate payment;
2. duplicate email;
3. duplicate case creation;
4. inconsistent external state.

### 29.5 Infinite retry mindset

Retry tanpa batas/backoff membuat outage lebih buruk.

### 29.6 Treating every exception as BPMN error

BPMN error bukan technical exception. Jangan modelkan database down sebagai BPMN business path.

### 29.7 Treating every exception as incident

Business rejection bukan incident. Jika applicant memang tidak eligible, process harus punya path normal untuk itu.

### 29.8 No worker/process deployment coordination

BPMN deploy dengan job type baru sebelum worker siap.

### 29.9 Worker timeout used as business waiting

Worker timeout 3 hari untuk menunggu external approval adalah design smell. Gunakan message/timer/user task.

### 29.10 Single worker credential with unlimited access

Security blast radius terlalu besar.

---

## 30. Production Readiness Checklist

Gunakan checklist ini sebelum worker masuk production.

### 30.1 Contract readiness

- [ ] Job type stable dan terdokumentasi.
- [ ] Required variables terdokumentasi.
- [ ] Output variables terdokumentasi.
- [ ] BPMN error codes terdokumentasi.
- [ ] Variable schema versioning dipertimbangkan.
- [ ] Worker compatible dengan process version yang berjalan.

### 30.2 Runtime readiness

- [ ] `maxJobsActive` dihitung berdasarkan concurrency nyata.
- [ ] Job timeout lebih besar dari queue wait + execution + margin.
- [ ] External API timeout lebih pendek dari job timeout.
- [ ] Retry/backoff disusun.
- [ ] Worker graceful shutdown.
- [ ] Readiness/liveness masuk akal.
- [ ] Worker dapat dipause/scale down dengan aman.

### 30.3 Correctness readiness

- [ ] Idempotency untuk side effect.
- [ ] Duplicate execution sudah disimulasikan.
- [ ] DB transaction boundary jelas.
- [ ] Complete-after-commit strategy jelas.
- [ ] BPMN error vs job failure jelas.
- [ ] Permanent vs transient error jelas.

### 30.4 Observability readiness

- [ ] Structured logs dengan job/process context.
- [ ] Metrics success/failure/duration.
- [ ] External dependency metrics.
- [ ] Alert failure rate/incident/backlog.
- [ ] Trace/correlation ID propagation.
- [ ] No sensitive variable logging.

### 30.5 Security readiness

- [ ] Secrets externalized.
- [ ] Least privilege credential.
- [ ] No token in variables/logs.
- [ ] PII minimized.
- [ ] Error message sanitized.
- [ ] Network access restricted where possible.

### 30.6 Operational readiness

- [ ] Runbook exists.
- [ ] Known failure modes documented.
- [ ] Manual recovery path clear.
- [ ] Dashboard exists.
- [ ] Owner/on-call clear.
- [ ] Deployment rollback strategy clear.

---

## 31. Worked Example: Regulatory Case Assignment Worker

Misal kita punya process:

```text
Application Submitted
   |
   v
Validate Application
   |
   v
Assign Case Officer
   |
   v
Human Review
```

Service task `Assign Case Officer` menggunakan job type:

```text
case.assign-officer
```

### 31.1 BPMN contract

Input variables:

```json
{
  "applicationId": "APP-2026-0001",
  "applicationType": "RENEWAL",
  "riskTier": "MEDIUM"
}
```

Output variables:

```json
{
  "assignedOfficerId": "USR-1001",
  "assignmentStrategy": "LOAD_BALANCED_BY_RISK_TIER"
}
```

Business errors:

```text
NO_ELIGIBLE_OFFICER
```

Technical failures:

```text
assignment DB unavailable
identity service timeout
configuration missing
```

### 31.2 Worker structure

```java
@Component
public final class CaseAssignmentWorker {

    private final CaseAssignmentService assignmentService;
    private final CaseAssignmentJobMapper mapper;

    public CaseAssignmentWorker(
            CaseAssignmentService assignmentService,
            CaseAssignmentJobMapper mapper
    ) {
        this.assignmentService = assignmentService;
        this.mapper = mapper;
    }

    @JobWorker(type = JobTypes.CASE_ASSIGN_OFFICER)
    public Map<String, Object> assignOfficer(ActivatedJob job) {
        CaseAssignmentCommand command = mapper.toCommand(job);
        CaseAssignmentResult result = assignmentService.assign(command);
        return mapper.toVariables(result);
    }
}
```

### 31.3 Contract constants

```java
public final class JobTypes {
    public static final String CASE_ASSIGN_OFFICER = "case.assign-officer";

    private JobTypes() {
    }
}
```

```java
public final class CaseAssignmentVariables {
    public static final String APPLICATION_ID = "applicationId";
    public static final String APPLICATION_TYPE = "applicationType";
    public static final String RISK_TIER = "riskTier";
    public static final String ASSIGNED_OFFICER_ID = "assignedOfficerId";
    public static final String ASSIGNMENT_STRATEGY = "assignmentStrategy";

    private CaseAssignmentVariables() {
    }
}
```

### 31.4 Command object

```java
public final class CaseAssignmentCommand {
    private final String applicationId;
    private final String applicationType;
    private final String riskTier;
    private final long processInstanceKey;
    private final long jobKey;

    public CaseAssignmentCommand(
            String applicationId,
            String applicationType,
            String riskTier,
            long processInstanceKey,
            long jobKey
    ) {
        this.applicationId = applicationId;
        this.applicationType = applicationType;
        this.riskTier = riskTier;
        this.processInstanceKey = processInstanceKey;
        this.jobKey = jobKey;
    }

    public String applicationId() {
        return applicationId;
    }

    public String applicationType() {
        return applicationType;
    }

    public String riskTier() {
        return riskTier;
    }

    public long processInstanceKey() {
        return processInstanceKey;
    }

    public long jobKey() {
        return jobKey;
    }
}
```

### 31.5 Mapper

```java
@Component
public final class CaseAssignmentJobMapper {

    public CaseAssignmentCommand toCommand(ActivatedJob job) {
        Map<String, Object> variables = job.getVariablesAsMap();

        return new CaseAssignmentCommand(
                requireString(variables, CaseAssignmentVariables.APPLICATION_ID),
                requireString(variables, CaseAssignmentVariables.APPLICATION_TYPE),
                requireString(variables, CaseAssignmentVariables.RISK_TIER),
                job.getProcessInstanceKey(),
                job.getKey()
        );
    }

    public Map<String, Object> toVariables(CaseAssignmentResult result) {
        Map<String, Object> variables = new HashMap<>();
        variables.put(CaseAssignmentVariables.ASSIGNED_OFFICER_ID, result.officerId());
        variables.put(CaseAssignmentVariables.ASSIGNMENT_STRATEGY, result.strategy());
        return variables;
    }

    private static String requireString(Map<String, Object> variables, String name) {
        Object value = variables.get(name);
        if (!(value instanceof String)) {
            throw new InvalidProcessVariableException("Missing string variable: " + name);
        }
        String text = (String) value;
        if (text.trim().isEmpty()) {
            throw new InvalidProcessVariableException("Blank string variable: " + name);
        }
        return text;
    }
}
```

### 31.6 Application service

```java
@Service
public final class CaseAssignmentService {

    private final OfficerRepository officerRepository;
    private final AssignmentRepository assignmentRepository;

    public CaseAssignmentService(
            OfficerRepository officerRepository,
            AssignmentRepository assignmentRepository
    ) {
        this.officerRepository = officerRepository;
        this.assignmentRepository = assignmentRepository;
    }

    @Transactional
    public CaseAssignmentResult assign(CaseAssignmentCommand command) {
        Optional<CaseAssignmentResult> existing =
                assignmentRepository.findExistingAssignment(command.applicationId());

        if (existing.isPresent()) {
            return existing.get();
        }

        Officer officer = officerRepository
                .findBestOfficer(command.applicationType(), command.riskTier())
                .orElseThrow(() -> new NoEligibleOfficerException(command.applicationId()));

        assignmentRepository.insertAssignment(
                command.applicationId(),
                officer.id(),
                "LOAD_BALANCED_BY_RISK_TIER"
        );

        return new CaseAssignmentResult(
                officer.id(),
                "LOAD_BALANCED_BY_RISK_TIER"
        );
    }
}
```

Ini sudah lebih production-aware karena:

1. worker tipis;
2. command object typed;
3. mapper terisolasi;
4. idempotency dasar melalui existing assignment;
5. transaction boundary di service;
6. domain exception bisa dimap ke BPMN error atau incident.

---

## 32. Staff-Level Heuristics

Jika ingin berpikir seperti engineer senior/staff, jangan mulai dari API. Mulai dari invariants.

### 32.1 Worker invariant examples

Untuk payment worker:

```text
A payment for the same application fee must not be charged more than once.
```

Untuk document worker:

```text
A decision letter can be regenerated, but only one generated version is considered official unless superseded explicitly.
```

Untuk notification worker:

```text
A user must not receive duplicate approval emails for the same final decision event.
```

Untuk case assignment worker:

```text
An application must have at most one active primary case officer at a time.
```

Setelah invariant jelas, baru tentukan:

1. job type;
2. idempotency key;
3. DB constraint;
4. BPMN retry path;
5. worker timeout;
6. observability;
7. recovery action.

### 32.2 Ask these questions for every worker

1. Apa side effect worker ini?
2. Apakah side effect boleh terjadi dua kali?
3. Apa idempotency key-nya?
4. Apa retry yang aman?
5. Apa yang terjadi jika complete job gagal setelah side effect sukses?
6. Apa yang terjadi jika worker mati setelah mengaktifkan job?
7. Apa variable input/output contract-nya?
8. Apa business error yang normal?
9. Apa technical error yang harus menjadi incident?
10. Berapa kapasitas downstream?
11. Berapa timeout yang realistis?
12. Bagaimana cara operasi menghentikan worker ini tanpa merusak process?
13. Bagaimana membuktikan worker sehat dari metrics?
14. Bagaimana menemukan semua process instance yang terdampak jika worker bug?

---

## 33. Ringkasan Mental Model

Job worker production-grade adalah **remote executor with lease, contract, capacity, and failure responsibility**.

Inti yang harus diingat:

1. Worker tidak dipanggil seperti JavaDelegate Camunda 7.
2. Worker mengaktifkan job dan memegang lease sementara.
3. Job timeout adalah recovery mechanism, bukan SLA bisnis.
4. `maxJobsActive` harus sesuai kapasitas eksekusi nyata.
5. Worker harus hanya fetch variable yang diperlukan.
6. Worker harus memvalidasi variable di boundary.
7. Worker harus membedakan complete, fail, BPMN error, dan incident.
8. Worker harus punya retry/backoff strategy.
9. Worker harus graceful saat shutdown.
10. Worker harus observable dengan job/process/business context.
11. Worker yang punya side effect harus idempotent.
12. Worker code sebaiknya tipis; business logic ada di application service.
13. Worker deployment harus compatible dengan BPMN version.
14. Worker scaling harus menghormati downstream capacity.
15. Worker security harus membatasi credential, logs, dan PII.

---

## 34. Sumber Rujukan

Beberapa rujukan utama yang relevan untuk bagian ini:

1. Camunda 8 Docs — Java Client Job Worker  
   `https://docs.camunda.io/docs/apis-tools/java-client/job-worker/`

2. Camunda 8 Docs — Job Workers Concept  
   `https://docs.camunda.io/docs/components/concepts/job-workers/`

3. Camunda 8 Docs — Camunda Spring Boot Starter  
   `https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/getting-started/`

4. Camunda 8 Docs — Spring Boot Starter Configuration  
   `https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/configuration/`

5. Camunda 8 Docs — Zeebe Backpressure  
   `https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/operations/backpressure/`

6. Camunda Blog — Performance Tuning in Camunda 8  
   `https://camunda.com/blog/2025/01/performance-tuning-camunda-8/`

7. Camunda Blog — Remote Workers and Idempotency  
   `https://camunda.com/blog/2017/08/remote-workers-and-idempotency/`

---

## 35. Penutup Part 006

Bagian ini membangun fondasi worker engineering:

```text
Job worker = lease holder + contract adapter + controlled executor + observable failure boundary
```

Bagian berikutnya akan masuk ke topik yang paling krusial untuk correctness:

```text
Part 007 — Worker Correctness: Idempotency, Retries, Duplicate Execution, and External Side Effects
```

Di Part 007, kita akan membahas secara jauh lebih dalam:

1. kenapa duplicate execution bisa terjadi;
2. bagaimana memilih idempotency key;
3. bagaimana mendesain outbox/inbox;
4. bagaimana menangani external API yang tidak idempotent;
5. bagaimana menyusun DB constraint untuk melindungi invariant;
6. bagaimana recovery ketika side effect sukses tetapi job completion gagal;
7. bagaimana membedakan exactly-once illusion vs effectively-once business outcome.

**Status seri: belum selesai.**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-005.md">⬅️ Part 005 — Java Client Evolution: Zeebe Java Client, Camunda Java Client, REST, gRPC, and Version Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-007.md">Part 007 — Worker Correctness: Idempotency, Retries, Duplicate Execution, and External Side Effects ➡️</a>
</div>
