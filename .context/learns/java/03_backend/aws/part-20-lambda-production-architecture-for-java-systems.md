# Part 20 — Lambda Production Architecture for Java Systems

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-20-lambda-production-architecture-for-java-systems.md`  
Scope: Java 8–25, AWS Lambda, AWS SDK for Java 2.x, production architecture  
Status: Advanced continuation material

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas Lambda Java dari sisi fundamental dan event source. Pada bagian ini kita naik satu level: **bagaimana mendesain Lambda Java sebagai komponen production system**, bukan sekadar function yang bisa jalan.

Bagian ini membahas pertanyaan engineering yang lebih penting daripada “bagaimana menulis handler?”:

- Apakah Lambda cocok untuk workload ini?
- Bagaimana menentukan boundary function?
- Bagaimana mengontrol concurrency agar tidak menghancurkan downstream system?
- Bagaimana menghindari cold-start surprise?
- Bagaimana melakukan deployment yang bisa rollback?
- Bagaimana mengelola config, secret, client AWS SDK, observability, dan failure path?
- Bagaimana memastikan Lambda Java tetap masuk akal untuk sistem regulated, auditable, dan maintainable?

Mental model utamanya:

> Lambda bukan hanya compute kecil. Lambda adalah **managed concurrency engine** dengan lifecycle khusus, event source semantics berbeda-beda, retry behavior berbeda-beda, dan deployment unit yang harus didesain sebagai production boundary.

---

## 2. Apa yang Tidak Akan Diulang

Kita tidak mengulang:

- Java dasar.
- AWS SDK dasar.
- IAM dasar.
- Timeout/retry HTTP SDK dasar.
- Lambda handler dasar.
- Cold start dasar.
- SQS/SNS/S3/EventBridge semantics dasar.

Yang kita lakukan adalah menggabungkan semua itu menjadi arsitektur Lambda Java yang bisa dipakai di sistem nyata.

---

## 3. Mental Model: Lambda sebagai Production Boundary

Lambda sering dipahami terlalu sempit:

```text
Event masuk -> handler jalan -> return
```

Model production yang lebih akurat:

```text
External/System Event
      |
      v
Event Source Semantics
      |
      v
Lambda Concurrency Scheduler
      |
      v
Execution Environment Lifecycle
      |
      v
Java Runtime + Classloading + Static Init
      |
      v
Handler + Dependency Graph
      |
      v
AWS SDK / Database / HTTP Downstream
      |
      v
Result / Retry / DLQ / Destination / Audit
```

Setiap lapisan punya failure mode sendiri.

Jika engineer hanya melihat handler, banyak bug production tidak terlihat:

- event source retry mengulang event yang sebenarnya sudah diproses sebagian;
- Lambda scale-out menghantam database connection limit;
- cold start muncul karena dependency graph terlalu besar;
- secret rotation gagal karena client/cache dibuat statis tanpa refresh strategy;
- deployment langsung memindahkan 100% traffic ke version baru tanpa guardrail;
- timeout Lambda lebih besar daripada visibility timeout SQS;
- reserved concurrency tidak diatur sehingga function penting berebut account concurrency;
- observability hanya log string, tidak ada request id, event id, attempt, atau downstream latency.

---

## 4. Lambda Cocok untuk Apa?

Lambda cocok saat workload memiliki karakteristik berikut:

| Karakteristik | Cocok untuk Lambda? | Alasan |
|---|---:|---|
| Event-driven | Ya | Lambda native untuk event source seperti SQS, SNS, S3, EventBridge, API Gateway |
| Burst workload | Ya | Lambda dapat scale secara otomatis dalam batas quota/concurrency |
| Short-lived task | Ya | Lambda punya maximum timeout 15 menit |
| Irregular traffic | Ya | Pay-per-use cocok untuk traffic tidak konstan |
| Stateless computation | Ya | Execution environment bisa reused, tetapi tidak boleh dianggap durable |
| Heavy long-running batch | Biasanya tidak | Container/ECS/EKS/Batch sering lebih cocok |
| High connection reuse ke DB | Hati-hati | Scale-out Lambda bisa membuka terlalu banyak connection |
| Latency sangat stabil sub-10ms | Hati-hati | Cold start, network, VPC, SDK init bisa mengganggu tail latency |
| Workflow kompleks multi-step | Mungkin | Step Functions sering lebih cocok daripada Lambda orchestrator manual |
| CPU-bound long computation | Hati-hati | Bisa mahal dan timeout-bound |

Prinsip:

> Lambda paling kuat saat dipakai sebagai **event processor stateless** dengan boundary jelas, bukan sebagai pengganti semua service backend.

---

## 5. Lambda Tidak Cocok untuk Apa?

Lambda sering dipaksakan untuk workload yang lebih cocok di container atau managed service lain.

### 5.1 Long-running workload

Lambda timeout maksimum adalah 900 detik atau 15 menit. Jika proses secara normal bisa melewati batas ini, desainnya salah jika hanya “menaikkan timeout sampai maksimum”.

Alternatif:

- ECS/Fargate worker;
- EKS worker;
- AWS Batch;
- Step Functions untuk orchestration;
- chunking + SQS untuk memecah pekerjaan.

### 5.2 Stateful in-memory service

Execution environment Lambda bisa reused, tetapi reuse bukan kontrak durable.

Jangan menyimpan state domain penting di:

- static variable;
- local memory;
- `/tmp` sebagai state utama;
- cache tanpa invalidation;
- singleton mutable object yang diasumsikan selalu hidup.

Boleh menyimpan:

- AWS SDK client;
- parsed configuration immutable;
- connection pool terbatas;
- warmed serializer;
- small read-through cache dengan TTL;
- compiled regex;
- metadata non-critical.

### 5.3 High-throughput synchronous DB workload

Lambda bisa scale sangat cepat. Database tradisional tidak selalu bisa.

Jika satu invocation membuka satu DB connection dan Lambda scale ke 1.000 concurrent invocation, DB bisa kehabisan connection.

Mitigasi:

- gunakan RDS Proxy;
- reserved concurrency;
- queue-based worker;
- connection pool kecil;
- batching;
- DynamoDB untuk access pattern yang cocok;
- container worker dengan fixed concurrency.

### 5.4 Workload dengan heavy startup graph

Java Lambda bisa punya cold start signifikan jika:

- framework terlalu besar;
- classpath gemuk;
- reflection berat;
- dependency injection scanning besar;
- AWS clients dibuat terlalu banyak;
- serializer initialization berat;
- config/secret load terlalu banyak di init.

Mitigasi:

- dependency minimization;
- static singleton yang tepat;
- SnapStart/provisioned concurrency bila cocok;
- lightweight framework;
- split function;
- lazy load non-critical dependency.

---

## 6. Function Boundary: Jangan Membuat Lambda Terlalu Kecil atau Terlalu Besar

Ada dua anti-pattern ekstrem.

### 6.1 Nano-function anti-pattern

```text
validate-function
persist-function
notify-function
audit-function
transform-function
```

Masalah:

- terlalu banyak deployment unit;
- observability terfragmentasi;
- IAM policy banyak;
- orchestration overhead;
- debugging sulit;
- latency bertambah;
- testing end-to-end makin mahal.

### 6.2 God-function anti-pattern

```text
case-management-mega-handler
```

Masalah:

- satu function menangani terlalu banyak event type;
- IAM terlalu luas;
- cold start besar;
- deployment berisiko;
- blast radius besar;
- ownership kabur;
- logic bercabang ekstrem.

### 6.3 Boundary yang sehat

Function boundary sebaiknya mengikuti **capability + event semantics + failure behavior**.

Contoh:

```text
case-document-ingestion-worker
case-screening-request-handler
case-notification-dispatcher
case-escalation-scheduler
case-audit-event-writer
```

Boundary sehat memiliki ciri:

- satu reason to change yang dominan;
- event source jelas;
- retry behavior jelas;
- idempotency key jelas;
- IAM permission sempit;
- metrics bisa dimaknai;
- failure path jelas;
- deployment risk terbatas.

---

## 7. Lambda Java Package Architecture

Struktur internal Lambda Java sebaiknya tidak langsung menaruh semua logic di handler.

### 7.1 Struktur buruk

```java
public class Handler implements RequestHandler<SQSEvent, Void> {
    public Void handleRequest(SQSEvent event, Context context) {
        // parse
        // validate
        // call DB
        // call S3
        // publish SNS
        // log
        // catch everything
        return null;
    }
}
```

Masalah:

- sulit dites;
- AWS event source bercampur dengan domain logic;
- exception policy tidak eksplisit;
- dependency lifecycle tidak jelas;
- observability tersebar;
- idempotency sering tertinggal.

### 7.2 Struktur lebih sehat

```text
com.example.caseingestion
  LambdaHandler.java
  bootstrap/
    AppBootstrap.java
    AwsClients.java
    AppConfig.java
  adapter/
    SqsEventAdapter.java
    S3Gateway.java
    SnsEventPublisher.java
    SecretProvider.java
  application/
    IngestCaseDocumentUseCase.java
    IngestionCommand.java
    IngestionResult.java
  domain/
    CaseDocument.java
    CaseDocumentId.java
    ProcessingStatus.java
  reliability/
    IdempotencyStore.java
    RetryClassification.java
    FailureClassifier.java
  observability/
    LogContext.java
    MetricsRecorder.java
    TraceAttributes.java
```

Handler hanya melakukan orchestration tipis:

```java
public final class LambdaHandler implements RequestHandler<SQSEvent, SQSBatchResponse> {

    private static final AppBootstrap BOOTSTRAP = AppBootstrap.initialize();

    @Override
    public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
        return BOOTSTRAP.sqsAdapter().handle(event, context);
    }
}
```

Prinsip:

> Handler adalah adapter AWS. Business use case harus tetap bisa dites tanpa Lambda runtime.

---

## 8. Execution Environment Lifecycle dan Static Initialization

Lambda dapat menggunakan ulang execution environment untuk invocation berikutnya. Karena itu, static initialization bisa dipakai untuk resource mahal.

Cocok untuk static init:

- AWS SDK client;
- ObjectMapper;
- immutable configuration;
- compiled validator;
- metrics helper;
- HTTP client;
- small cache dengan TTL.

Tidak cocok untuk static init:

- request-specific state;
- user-specific data;
- mutable domain aggregate;
- stale credential manual;
- non-thread-safe formatter tanpa guard;
- secret yang tidak punya refresh strategy;
- database transaction/session.

Contoh:

```java
public final class AwsClients {
    private final S3Client s3;
    private final SqsClient sqs;
    private final SnsClient sns;

    private AwsClients(AppConfig config) {
        this.s3 = S3Client.builder()
                .region(config.awsRegion())
                .build();

        this.sqs = SqsClient.builder()
                .region(config.awsRegion())
                .build();

        this.sns = SnsClient.builder()
                .region(config.awsRegion())
                .build();
    }

    public static AwsClients create(AppConfig config) {
        return new AwsClients(config);
    }

    public S3Client s3() {
        return s3;
    }

    public SqsClient sqs() {
        return sqs;
    }

    public SnsClient sns() {
        return sns;
    }
}
```

AWS SDK clients should be reused. Membuat client per invocation meningkatkan overhead connection pool, TLS, credential resolution, dan latency.

---

## 9. Concurrency sebagai Control Surface

Lambda concurrency bukan hanya scaling feature. Ia adalah **safety valve**.

Concurrency menentukan berapa banyak invocation bisa berjalan bersamaan.

```text
concurrency ≈ requests per second × average duration in seconds
```

Contoh:

```text
100 request/second × 0.2 second = 20 concurrent executions
100 request/second × 2.0 second = 200 concurrent executions
```

Implikasi:

- latency naik -> concurrency naik;
- downstream lambat -> Lambda menumpuk concurrent invocation;
- lebih banyak concurrency -> lebih banyak connection/thread/API call;
- retry storm -> concurrency dan downstream pressure bisa membesar.

---

## 10. Reserved Concurrency

Reserved concurrency memberikan dua efek:

1. Menjamin sebagian concurrency untuk function tertentu.
2. Membatasi maksimum concurrency function tersebut.

Ini sangat berguna untuk melindungi downstream.

Contoh:

```text
Function: document-processing-worker
Reserved concurrency: 25
Downstream DB max safe write workers: 25
```

Artinya walaupun SQS punya ribuan message, function tidak akan memproses lebih dari 25 invocation bersamaan.

### 10.1 Reserved concurrency sebagai circuit breaker kasar

Jika reserved concurrency diset ke `0`, function berhenti memproses event.

Ini bisa dipakai sebagai emergency brake saat:

- downstream rusak;
- ada bug destructive;
- message poison massal;
- external vendor sedang incident;
- data corruption risk terdeteksi.

Namun ini bukan pengganti feature flag atau proper circuit breaker. Ini operational brake.

### 10.2 Risiko reserved concurrency

Jika terlalu kecil:

- queue age naik;
- SLA lambat;
- event timeout/retention risk;
- API Gateway request throttled.

Jika terlalu besar:

- database kehabisan connection;
- downstream throttling;
- cost spike;
- retry storm.

---

## 11. Provisioned Concurrency

Provisioned concurrency menjaga sejumlah execution environment sudah initialized dan siap menerima request.

Cocok untuk:

- synchronous API dengan latency SLO ketat;
- Java Lambda dengan cold start signifikan;
- predictable traffic window;
- function kritikal yang tidak boleh cold start pada jam sibuk.

Kurang cocok untuk:

- async background worker yang tidak latency-sensitive;
- traffic sangat sporadis;
- workload murah yang cold start-nya acceptable;
- function sangat banyak tapi jarang dipakai.

### 11.1 Cara berpikir sizing

Jika peak normal function adalah 200 concurrent invocation dan butuh latency stabil, AWS menyarankan buffer, misalnya sekitar 10% di atas peak normal untuk provisioned concurrency.

```text
normal peak concurrency: 200
buffer: 10%
provisioned concurrency: 220
```

Tetapi jangan sizing hanya dari puncak rata-rata. Lihat:

- p95/p99 concurrency;
- traffic burst pattern;
- deployment window;
- downstream limit;
- cold start tolerance;
- cost.

---

## 12. Reserved vs Provisioned Concurrency

| Aspek | Reserved Concurrency | Provisioned Concurrency |
|---|---|---|
| Tujuan utama | Limit dan guarantee concurrency | Mengurangi cold start |
| Melindungi downstream | Ya | Tidak secara langsung |
| Mengurangi cold start | Tidak | Ya |
| Bisa menghentikan function dengan set 0 | Ya | Tidak itu tujuannya |
| Cocok untuk worker SQS | Sering ya | Jarang perlu |
| Cocok untuk latency-sensitive API | Kadang | Sering ya |
| Cost tambahan | Tidak langsung | Ya, ada biaya provisioned |

Rule of thumb:

```text
Gunakan reserved concurrency untuk safety.
Gunakan provisioned concurrency untuk latency.
```

---

## 13. Throttling: Jangan Anggap Selalu Buruk

Throttling sering dianggap error. Dalam arsitektur production, throttling kadang adalah mekanisme perlindungan.

Throttling buruk jika:

- user-facing API gagal;
- event hilang;
- SLA queue terlewati;
- retry memperburuk tekanan.

Throttling baik jika:

- melindungi DB;
- mencegah vendor API dihantam;
- menahan worker saat downstream lambat;
- mengubah burst menjadi backlog yang bisa dikuras.

Desain yang benar bukan “tidak boleh throttling sama sekali”, tetapi:

```text
Apakah throttling terjadi di boundary yang aman?
Apakah event bisa diproses ulang?
Apakah backlog terlihat?
Apakah ada alarm queue age?
Apakah retry tidak memperparah incident?
```

---

## 14. Downstream Protection

Lambda production harus dirancang dari downstream limit ke atas.

Jangan mulai dari:

```text
Berapa banyak Lambda bisa scale?
```

Mulai dari:

```text
Berapa banyak downstream aman menerima load?
```

### 14.1 Database protection

Jika Lambda menulis ke RDS:

- gunakan RDS Proxy jika cocok;
- batasi reserved concurrency;
- gunakan pool kecil;
- hindari connection per record;
- jangan membuka transaction terlalu lama;
- pastikan timeout Lambda lebih besar dari DB statement timeout hanya jika masuk akal;
- lebih baik DB timeout lebih pendek daripada Lambda timeout.

### 14.2 HTTP vendor protection

Jika Lambda call vendor API:

- set API call timeout;
- set attempt timeout;
- retry dengan jitter;
- batasi concurrency;
- gunakan circuit breaker state di DynamoDB/SSM/cache jika perlu;
- masukkan failed command ke SQS untuk retry terkendali;
- jangan retry semua 4xx.

### 14.3 AWS service protection

AWS managed service juga punya quota dan throttling.

Misalnya:

- KMS punya quota request;
- Secrets Manager call mahal dan bisa throttled;
- S3 request cost bisa naik;
- SNS/SQS punya throughput/semantic limits;
- CloudWatch Logs ingestion bisa mahal.

---

## 15. Timeout Architecture

Timeout harus bertingkat, bukan satu angka besar di Lambda.

Urutan sehat:

```text
Downstream attempt timeout
  < SDK API call attempt timeout
  < SDK API call timeout
  < business operation timeout
  < Lambda timeout
  < event source visibility/retention boundary
```

Contoh SQS worker:

```text
HTTP vendor attempt timeout: 2s
HTTP vendor total timeout: 5s
Business processing budget per message: 20s
Lambda timeout: 60s
SQS visibility timeout: 180s
```

Kenapa visibility timeout harus lebih besar dari Lambda timeout?

Karena jika visibility timeout terlalu pendek, message bisa terlihat lagi dan diproses invocation lain saat invocation pertama masih berjalan.

---

## 16. Retry Architecture

Lambda punya beberapa lapisan retry:

- SDK retry;
- application retry;
- event source retry;
- DLQ redrive;
- manual replay.

Jika semua aktif tanpa koordinasi, sistem mengalami retry amplification.

Contoh buruk:

```text
SDK retry 3x
Application retry 3x
Lambda async retry 2x
DLQ redrive 5x
```

Satu event bisa menghasilkan banyak attempt downstream.

Desain lebih baik:

- SDK retry untuk transient network/throttle kecil;
- application retry hanya untuk operasi lokal yang benar-benar aman;
- event source retry untuk unit kerja;
- DLQ untuk investigasi/replay;
- idempotency untuk semua side effect.

---

## 17. Lambda Deployment Model: Versions and Aliases

Jangan invoke `$LATEST` untuk production.

Production sebaiknya menggunakan:

```text
Function code -> Publish version -> Alias production -> Event source/API points to alias
```

Mental model:

```text
$LATEST        = mutable working copy
Version 42     = immutable artifact
Alias prod     = stable pointer to version
Alias staging  = stable pointer to staging version
```

Manfaat:

- rollback cepat dengan mengubah alias;
- canary deployment;
- audit deployment lebih jelas;
- provisioned concurrency bisa ditempel ke alias/version;
- event source tidak perlu berubah saat version berubah.

---

## 18. Canary and Weighted Routing

Lambda alias dapat membagi traffic antara dua version.

Contoh:

```text
prod alias:
  90% -> version 41
  10% -> version 42
```

Gunakan untuk:

- user-facing API;
- high-risk code change;
- dependency upgrade;
- runtime upgrade;
- SDK major/minor behavior change;
- serializer/schema change.

Jangan gunakan canary tanpa metric guardrail.

Minimal monitor:

- error rate;
- duration p95/p99;
- throttle count;
- memory usage;
- downstream error;
- DLQ count;
- business failure count;
- custom invariant violation.

---

## 19. Rollback Strategy

Rollback Lambda yang benar adalah rollback ke **previous known-good version**, bukan rebuild dari branch lama secara panik.

Production deployment harus menyimpan:

- function version;
- artifact hash;
- dependency BOM;
- environment variable snapshot;
- IAM role version/change;
- alias routing config;
- provisioned concurrency config;
- event source mapping config;
- schema version.

Rollback bisa gagal jika:

- database migration tidak backward compatible;
- event schema berubah breaking;
- IAM policy sudah diganti;
- secret/config berubah;
- DLQ berisi event dari version baru yang tidak dipahami version lama;
- external system state sudah berubah.

Prinsip:

> Lambda rollback cepat hanya jika dependency contract juga backward compatible.

---

## 20. Environment Variables and Configuration

Environment variables cocok untuk:

- bucket name;
- queue URL;
- topic ARN;
- table name;
- feature flag sederhana;
- config key path;
- region override;
- log level.

Tidak cocok untuk:

- secret plaintext;
- large config;
- frequently changing dynamic config;
- per-tenant complex policy;
- data yang harus diaudit sebagai config versioned object.

Gunakan pola:

```text
Environment variable -> points to config path/resource
SSM/Secrets/AppConfig -> stores value
Application startup -> loads and validates config
Runtime -> refresh selected config if needed
```

---

## 21. Secret Loading Strategy

Ada tiga pola utama.

### 21.1 Load secret during init

```text
cold start -> load secret -> initialize client -> invocation
```

Cocok untuk:

- secret wajib;
- function tidak boleh jalan tanpa secret;
- secret jarang berubah;
- latency invocation harus stabil.

Risiko:

- cold start lebih lambat;
- secret rotation bisa stale;
- Secrets Manager outage bisa membuat cold start gagal.

### 21.2 Lazy load secret

```text
first use -> load secret -> cache
```

Cocok untuk:

- secret hanya dipakai di path tertentu;
- ingin cold start ringan;
- failure bisa dilokalisasi.

Risiko:

- first request latency spike;
- concurrent first use bisa stampede;
- harus thread-safe.

### 21.3 Cache with TTL

```text
getSecret()
  if cached and not expired -> return
  else refresh with lock
```

Cocok untuk production.

Harus memperhatikan:

- TTL;
- stale fallback;
- rotation window;
- redaction;
- metrics refresh failure;
- per-secret cache size;
- exception classification.

---

## 22. AWS SDK Client Lifecycle in Lambda

Prinsip:

```text
Create once per execution environment.
Reuse across invocations.
Do not close after every invocation.
```

Contoh:

```java
public final class AppBootstrap {
    private static final AppBootstrap INSTANCE = create();

    private final S3Client s3;
    private final SqsClient sqs;
    private final ObjectMapper objectMapper;
    private final UseCase useCase;

    private AppBootstrap() {
        Region region = Region.of(requiredEnv("AWS_REGION"));

        this.s3 = S3Client.builder()
                .region(region)
                .build();

        this.sqs = SqsClient.builder()
                .region(region)
                .build();

        this.objectMapper = new ObjectMapper();
        this.useCase = new UseCase(s3, sqs, objectMapper);
    }

    public static AppBootstrap instance() {
        return INSTANCE;
    }

    private static AppBootstrap create() {
        return new AppBootstrap();
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing environment variable: " + name);
        }
        return value;
    }

    public UseCase useCase() {
        return useCase;
    }
}
```

Caveat:

- static init failure can fail cold start;
- keep init deterministic;
- validate required config early;
- avoid network calls unless necessary;
- avoid loading massive dependency graph.

---

## 23. Java Framework Choice in Lambda

Framework choice adalah arsitektur, bukan selera.

| Approach | Kelebihan | Risiko |
|---|---|---|
| Plain Java handler | Cold start ringan, kontrol penuh | Manual wiring lebih banyak |
| Dagger/manual DI | Cepat, compile-time-ish wiring | Learning curve |
| Spring Cloud Function | Familiar untuk Spring team | Cold start/dependency lebih berat |
| Micronaut/Quarkus | Cloud-native, DI lebih ringan | Complexity build/runtime |
| Full Spring Boot app in Lambda | Reuse code besar | Sering terlalu berat untuk Lambda kecil |

Rule of thumb:

- Untuk worker/event processor kecil: plain Java/manual DI sering paling sehat.
- Untuk domain service kompleks: pertimbangkan apakah container lebih cocok.
- Untuk team enterprise yang butuh Spring ecosystem: ukur cold start dan memory, jangan asumsi.

---

## 24. Lambda as Adapter, Not Domain Core

Desain terbaik biasanya menjadikan Lambda sebagai adapter:

```text
AWS Event -> Lambda Handler -> Application Use Case -> Domain Logic -> Ports/Gateways
```

Jangan membuat domain bergantung pada:

- `SQSEvent`;
- `SNSEvent`;
- `S3Event`;
- `APIGatewayProxyRequestEvent`;
- `Context`;
- AWS SDK response type.

Mapping di adapter:

```java
public final class SqsCommandMapper {
    public IngestionCommand toCommand(SQSEvent.SQSMessage message) {
        // parse body
        // validate envelope
        // extract idempotency key
        // map to application command
    }
}
```

Use case tetap bersih:

```java
public final class IngestDocumentUseCase {
    public IngestionResult handle(IngestionCommand command) {
        // domain/application logic
    }
}
```

Manfaat:

- unit test cepat;
- event source bisa diganti;
- replay lebih mudah;
- domain tidak terkunci ke AWS;
- failure classification lebih eksplisit.

---

## 25. Idempotency as Mandatory Production Feature

Lambda + event-driven system berarti duplicate harus dianggap normal.

Sumber duplicate:

- SQS at-least-once;
- Lambda retry;
- client retry;
- SNS retry;
- EventBridge retry;
- manual replay;
- deployment interruption;
- partial failure setelah side effect.

Idempotency harus dipikirkan sebelum coding.

### 25.1 Idempotency key

Contoh key:

```text
sourceSystem + eventType + eventId
bucket + objectKey + objectVersion
caseId + transitionId
requestId from upstream
business natural key + command type
```

### 25.2 Idempotency store

Bisa memakai:

- DynamoDB conditional write;
- RDBMS unique constraint;
- Redis with TTL untuk transient command;
- S3 marker object untuk pipeline tertentu;
- domain state machine transition guard.

### 25.3 State model

Jangan hanya menyimpan “seen”. Simpan status:

```text
RECEIVED
PROCESSING
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
COMPENSATED
```

Ini membantu audit dan recovery.

---

## 26. Observability Baseline for Every Lambda

Setiap Lambda production minimal punya:

### 26.1 Logs

- correlation id;
- AWS request id;
- event source id;
- idempotency key;
- business entity id;
- attempt number jika tersedia;
- failure classification;
- downstream target;
- duration.

### 26.2 Metrics

- invocation count;
- success count;
- business failure count;
- technical failure count;
- retryable failure count;
- permanent failure count;
- downstream latency;
- downstream throttle count;
- DLQ count;
- batch partial failure count;
- cold start count jika instrumented;
- queue age untuk SQS.

### 26.3 Tracing

- inbound event trace/correlation;
- downstream AWS SDK call;
- DB call;
- external HTTP call;
- serialization/deserialization segment untuk payload besar bila perlu.

### 26.4 Audit event

Untuk regulated system, log observability tidak sama dengan audit.

Audit harus menjawab:

- siapa/apa yang memicu event;
- kapan diterima;
- entity apa terdampak;
- transisi apa yang terjadi;
- input reference apa;
- output reference apa;
- apakah ada retry/replay;
- version code/config mana yang memproses;
- apakah decision automated atau human-triggered.

---

## 27. DLQ and Failure Destinations

DLQ bukan tempat sampah. DLQ adalah **controlled failure inventory**.

DLQ harus punya:

- owner;
- alarm;
- triage procedure;
- replay procedure;
- retention policy;
- payload redaction/security review;
- classification dashboard.

Anti-pattern:

```text
Set DLQ and forget.
```

Pertanyaan wajib:

- Apa yang membuat event masuk DLQ?
- Siapa yang menerima alert?
- Bagaimana tahu event aman direplay?
- Apakah replay idempotent?
- Apakah event lama masih kompatibel dengan code baru?
- Apakah DLQ payload berisi PII?
- Apakah ada DLQ untuk setiap subscription/event source yang butuh?

---

## 28. Synchronous Lambda API Architecture

Jika Lambda dipakai di belakang API Gateway/ALB, karakteristiknya berbeda dari worker async.

Prioritas:

- latency p95/p99;
- cold start mitigation;
- input validation cepat;
- timeout pendek;
- response mapping jelas;
- error taxonomy user-facing;
- idempotency untuk POST;
- authentication/authorization di boundary;
- no long-running business transaction.

### 28.1 Pattern sehat

```text
API Gateway
  -> Lambda API adapter
      -> validate request
      -> call application use case
      -> persist command/event
      -> return accepted/result
```

Untuk proses panjang:

```text
POST /documents
  -> validate
  -> store request
  -> enqueue processing command
  -> return 202 Accepted + trackingId
```

Jangan memaksa API synchronous menunggu proses berat jika bisa diubah ke async.

---

## 29. Asynchronous Worker Lambda Architecture

Untuk SQS/EventBridge/SNS/S3 worker, prioritasnya:

- correctness;
- idempotency;
- retry control;
- poison message handling;
- throughput;
- backlog visibility;
- graceful partial failure;
- downstream protection.

Pattern:

```text
Queue/Event Source
  -> Lambda batch handler
      -> parse each message
      -> check idempotency
      -> process
      -> record result
      -> report partial failure when supported
```

Jangan gunakan exception global untuk menggagalkan seluruh batch jika hanya satu message gagal dan event source mendukung partial batch response.

---

## 30. Graceful Shutdown and Interruption

Lambda dapat menghentikan execution environment. Java code harus siap terhadap:

- timeout mendekat;
- invocation freeze;
- runtime reset setelah failure;
- partial side effect;
- duplicate retry.

Gunakan `context.getRemainingTimeInMillis()` untuk budget-aware processing.

Contoh:

```java
public boolean hasEnoughTime(Context context, long requiredMillis) {
    return context.getRemainingTimeInMillis() > requiredMillis;
}
```

Untuk batch:

```text
Before processing next message:
  if remaining time < safe threshold:
      mark unprocessed messages as failed for retry
      stop processing batch
```

---

## 31. Memory, CPU, and Cost

Lambda memory setting juga memengaruhi CPU allocation. Untuk Java, menaikkan memory kadang menurunkan total cost jika durasi turun signifikan.

Jangan pilih memory berdasarkan “heap yang cukup” saja.

Ukur:

- duration p50/p95/p99;
- max memory used;
- init duration;
- billed duration;
- cost per 1.000 events;
- downstream latency;
- GC behavior;
- payload size variation.

Prinsip:

```text
Lowest memory is not always cheapest.
Fast enough with fewer retries may be cheaper and safer.
```

---

## 32. VPC or Not VPC

Lambda tidak selalu perlu VPC.

Butuh VPC jika mengakses:

- private RDS;
- private OpenSearch;
- private Redis/ElastiCache;
- internal service;
- private subnet resource.

Tidak perlu VPC hanya untuk:

- S3;
- SQS;
- SNS;
- DynamoDB;
- Secrets Manager;
- public AWS APIs;
- public HTTPS APIs.

Jika masuk VPC, perhatikan:

- subnet IP capacity;
- security group;
- NAT Gateway cost jika perlu internet;
- VPC endpoint untuk AWS services;
- DNS resolution;
- route table;
- cold start/network path impact.

Modern Lambda VPC networking sudah jauh lebih baik daripada masa awal, tetapi desain network tetap penting.

---

## 33. Deployment Package Strategy

Untuk Java Lambda, package size memengaruhi cold start, deployment speed, dan maintainability.

### 33.1 Shaded JAR

Kelebihan:

- simple deploy;
- semua dependency satu file;
- cocok untuk function kecil-menengah.

Risiko:

- besar;
- dependency conflict tersembunyi;
- classpath sulit dianalisis;
- cold start bisa membesar.

### 33.2 Lambda layers

Kelebihan:

- share dependency antar function;
- deployment artifact lebih kecil;
- common extension/helper bisa reusable.

Risiko:

- version management layer;
- coupling antar function;
- rollback harus sinkron;
- layer terlalu gemuk menjadi shared liability.

### 33.3 Container image Lambda

Kelebihan:

- packaging fleksibel;
- cocok untuk native dependency;
- familiar untuk container pipeline.

Risiko:

- image besar;
- cold start bisa terdampak;
- patching base image;
- scanning dan provenance wajib.

Rule:

```text
Mulai dari ZIP/JAR sederhana jika cukup.
Gunakan layer untuk dependency stabil dan shared.
Gunakan container image jika benar-benar butuh packaging model itu.
```

---

## 34. Runtime Upgrade Strategy: Java 8 to 25

Seri ini mencakup Java 8 sampai 25, tetapi production strategy harus realistis.

### 34.1 Java 8 Lambda

Masih ditemui di legacy enterprise.

Risiko:

- dependency modern makin sedikit mendukung;
- security posture lebih lemah;
- fitur language/runtime tertinggal;
- migrasi AWS SDK v2 tetap bisa, tetapi ecosystem bisa terbatas.

### 34.2 Java 11/17

Banyak enterprise berada di sini.

Java 17 sering menjadi baseline modern yang sehat untuk:

- long-term support;
- ecosystem compatibility;
- performance lebih baik dari Java 8;
- language feature cukup modern.

### 34.3 Java 21/25

Menarik untuk performa dan fitur modern.

Namun evaluasi:

- Lambda runtime availability;
- dependency compatibility;
- framework support;
- build toolchain;
- observability agent support;
- SnapStart support;
- organizational runtime policy.

Prinsip:

> Upgrade runtime bukan hanya compile target. Upgrade runtime adalah perubahan operational surface.

---

## 35. Lambda and State Machines

Jika flow punya banyak langkah, branching, wait, retry, compensation, human approval, atau timeout panjang, jangan otomatis membuat Lambda orchestrator manual.

Pertimbangkan Step Functions.

Lambda orchestrator manual buruk jika:

- menyimpan state di memory;
- punya loop polling;
- tidur/wait di dalam invocation;
- memanggil banyak downstream sequential dengan retry manual;
- sulit melihat progress;
- tidak ada visual execution history;
- compensation tersebar.

Lambda baik sebagai activity/task:

```text
Step Functions
  -> ValidateInput Lambda
  -> PersistCommand Lambda
  -> WaitForExternalResult
  -> ProcessDecision Lambda
  -> Notify Lambda
```

---

## 36. Production Reference Architecture: SQS Worker Lambda

Contoh arsitektur:

```text
SNS Topic
  -> SQS Queue
      -> Lambda Worker Alias: prod
          -> Idempotency Store: DynamoDB
          -> S3 Object Read/Write
          -> Domain DB / API
          -> Audit Publisher
      -> DLQ
```

Controls:

```text
Reserved concurrency: protects DB/API
SQS visibility timeout: > Lambda timeout
Partial batch response: enabled
DLQ alarm: enabled
Idempotency: mandatory
Structured logs: mandatory
Custom metrics: mandatory
Alias deployment: mandatory
```

Invariants:

- each message has stable idempotency key;
- no message deletion before side effect is durable;
- duplicate message must not duplicate business effect;
- poison message must not block unrelated messages;
- retry must not exceed downstream safe pressure;
- DLQ must be replayable;
- audit trail must survive handler retry.

---

## 37. Production Reference Architecture: API Lambda

```text
API Gateway
  -> Lambda Alias: prod
      -> Request Validator
      -> Auth Context Mapper
      -> Application Use Case
      -> DynamoDB/RDS/SQS/SNS
      -> Response Mapper
```

Controls:

```text
Provisioned concurrency: for latency-sensitive paths
Reserved concurrency: protect downstream
Timeout: short and explicit
Idempotency: for mutating POST
Canary deployment: enabled
Access logs: API Gateway + Lambda
Metrics: status code + business error
```

Invariants:

- no unbounded synchronous work;
- response errors are classified;
- client retry is safe;
- downstream timeout < Lambda timeout;
- no secret in response/log;
- correlation id returned or propagated.

---

## 38. Production Reference Architecture: Scheduled Lambda

```text
EventBridge Scheduler
  -> Lambda Alias: prod
      -> Acquire job lock
      -> Determine work window
      -> Process bounded batch
      -> Emit checkpoint
      -> Publish metrics/audit
```

Controls:

- distributed lock if overlapping runs unsafe;
- max records per run;
- checkpoint;
- dead-letter/failure destination;
- alarm on missed schedule;
- idempotent processing window;
- explicit timezone handling.

Anti-pattern:

```text
Scheduled Lambda scans entire database every minute without checkpoint.
```

---

## 39. Multi-Account and Environment Strategy

Lambda production architecture should account for environment separation.

Recommended separation:

```text
DEV account
UAT/STG account
PROD account
Shared services/security account if needed
```

Each environment should have:

- separate function;
- separate IAM role;
- separate queue/topic/bucket/table;
- separate KMS key where needed;
- separate logs/metrics;
- separate alarm routing;
- separate secret path.

Avoid:

- one Lambda with `ENV=prod/dev` deciding target;
- shared queue between environments;
- prod role usable from dev;
- prod secret readable from non-prod;
- test event source pointing to prod function.

---

## 40. Naming and Tagging

A consistent naming convention reduces operational confusion.

Example:

```text
<system>-<bounded-context>-<capability>-<runtime-role>-<env>
```

Examples:

```text
aceas-case-document-ingestion-worker-prod
aceas-case-notification-dispatcher-uat
aceas-case-escalation-scheduler-dev
```

Tags:

```text
System=ACEAS
Environment=PROD
Owner=CaseManagement
Runtime=Java21
DataClassification=Confidential
CostCenter=...
Criticality=High
```

Tags help:

- cost allocation;
- incident ownership;
- compliance inventory;
- automated policy;
- cleanup detection.

---

## 41. Security Baseline

Every Lambda should follow minimum security posture:

- no static AWS access key;
- least privilege execution role;
- no plaintext secret env var;
- KMS where required;
- restricted resource policy;
- VPC only when needed;
- private endpoints where required;
- dependency scanning;
- deployment artifact provenance;
- log redaction;
- no PII in metric dimensions;
- no broad `s3:*`, `kms:*`, `secretsmanager:*` unless justified;
- function URL disabled unless explicitly needed.

---

## 42. Operational Runbook Template

Every production Lambda should have a runbook.

Minimum sections:

```text
1. Purpose
2. Owner
3. Event source
4. Downstream dependencies
5. IAM role
6. Environment variables
7. Secret/config paths
8. Concurrency settings
9. Timeout settings
10. Retry/DLQ behavior
11. Dashboard link
12. Alarm list
13. Common failure modes
14. Emergency stop procedure
15. Replay procedure
16. Rollback procedure
17. Data correction procedure
18. Security considerations
```

Emergency stop example:

```text
Set reserved concurrency to 0 for function X.
Confirm queue backlog increases but downstream writes stop.
Do not purge queue unless data owner approves.
```

Replay example:

```text
Inspect DLQ message.
Classify failure.
Confirm code/config fix deployed.
Confirm idempotency is safe.
Redrive selected messages.
Monitor business success metric and DLQ count.
```

---

## 43. Production Readiness Checklist

### 43.1 Architecture

- [ ] Function has clear responsibility.
- [ ] Event source semantics documented.
- [ ] Retry behavior documented.
- [ ] DLQ/failure destination configured where needed.
- [ ] Idempotency key defined.
- [ ] Downstream limit known.
- [ ] Reserved concurrency considered.
- [ ] Provisioned concurrency considered for latency-sensitive path.
- [ ] Timeout hierarchy designed.

### 43.2 Java implementation

- [ ] Handler is thin adapter.
- [ ] AWS SDK clients reused.
- [ ] ObjectMapper/serializer reused.
- [ ] No request state in static mutable fields.
- [ ] Config validated at startup.
- [ ] Secret loading has refresh/cache strategy.
- [ ] Exceptions classified.
- [ ] Partial batch failure supported where applicable.
- [ ] Graceful time-budget check for batch processing.

### 43.3 Security

- [ ] Execution role least privilege.
- [ ] No long-lived AWS key.
- [ ] Secrets not in plaintext environment variables.
- [ ] Logs redact sensitive fields.
- [ ] KMS key policy validated.
- [ ] Resource policy scoped.
- [ ] Artifact scanned.

### 43.4 Observability

- [ ] Structured logs.
- [ ] Correlation id.
- [ ] AWS request id logged.
- [ ] Business entity id logged safely.
- [ ] Custom metrics.
- [ ] Dashboard.
- [ ] Alarm on errors/throttles/duration/DLQ/queue age.
- [ ] Deployment version visible in logs/metrics.

### 43.5 Deployment

- [ ] Production uses alias, not `$LATEST`.
- [ ] Version is immutable.
- [ ] Rollback tested.
- [ ] Canary/weighted routing considered.
- [ ] Config backward compatibility checked.
- [ ] Schema compatibility checked.
- [ ] IAM change reviewed.

---

## 44. Design Review Questions

Before approving Lambda Java design, ask:

1. What is the event source and what are its retry semantics?
2. What makes this handler idempotent?
3. What is the maximum safe concurrency for downstream?
4. What happens if downstream is slow for 30 minutes?
5. What happens if one message in a batch fails?
6. What happens if the function times out after partially writing data?
7. What happens if secret rotation happens during warm execution?
8. How do we stop the function during incident?
9. How do we replay failed events safely?
10. How do we rollback code and config?
11. How do we know a new version is bad within 5 minutes?
12. What metric represents business success, not just technical success?
13. What IAM action/resource does the function actually need?
14. What data appears in logs, and is it allowed?
15. Is Lambda actually the right compute model?

---

## 45. Common Anti-Patterns

### 45.1 Client created per invocation

```java
public void handle(...) {
    S3Client s3 = S3Client.create();
}
```

Fix: create once and reuse.

### 45.2 Catch-all exception with success return

```java
try {
    process(event);
} catch (Exception e) {
    log.error("failed", e);
}
return null;
```

This can delete/acknowledge events incorrectly depending on event source.

Fix: classify exception and signal failure correctly.

### 45.3 No idempotency because “SQS usually works”

SQS standard queue is at-least-once. Duplicate handling is not optional.

### 45.4 Lambda timeout equals downstream timeout

If downstream call can consume the entire Lambda timeout, the handler cannot record failure, emit metrics, or return partial batch result.

### 45.5 One role shared by many functions

Shared role makes least privilege impossible and increases blast radius.

### 45.6 DLQ without owner

DLQ without triage/replay process is delayed data loss.

### 45.7 `$LATEST` in production

Mutable production target breaks auditability and rollback discipline.

### 45.8 Environment variable as secret store

Environment variable can be exposed via configuration views, logs, dumps, or overbroad permissions. Use Secrets Manager/SSM SecureString with KMS where appropriate.

---

## 46. Top 1% Mental Model

A strong engineer does not ask only:

```text
Can Lambda run this Java code?
```

They ask:

```text
What is the event contract?
What is the retry contract?
What is the concurrency budget?
What is the downstream protection model?
What is the idempotency invariant?
What is the rollback boundary?
What is the audit evidence?
What happens during partial failure?
What is the cost and quota profile?
What operational action can stop harm quickly?
```

Lambda production architecture is less about writing a handler and more about designing a controlled state transition under uncertain distributed conditions.

---

## 47. Summary

Pada bagian ini kita membahas Lambda Java sebagai komponen production system:

- Lambda cocok untuk event-driven, stateless, short-lived, bursty workload.
- Lambda tidak otomatis cocok untuk long-running, heavily stateful, DB-connection-heavy, atau ultra-low-latency workload.
- Function boundary harus mengikuti capability, event semantics, dan failure behavior.
- Handler sebaiknya hanya adapter; domain logic harus tetap testable di luar Lambda.
- Static initialization berguna untuk SDK client dan serializer, tetapi berbahaya untuk request state dan stale secret.
- Reserved concurrency adalah safety valve.
- Provisioned concurrency adalah latency tool.
- Throttling bisa menjadi protection mechanism jika ditempatkan benar.
- Timeout dan retry harus didesain bertingkat.
- Production harus memakai version + alias, bukan `$LATEST`.
- Canary deployment harus dilengkapi metric guardrail.
- Rollback hanya aman jika schema/config/IAM/dependency compatible.
- Idempotency wajib untuk event-driven Lambda.
- DLQ harus punya owner, alarm, triage, dan replay process.
- Observability harus mencakup technical metric dan business invariant.

---

## 48. References

- AWS Lambda Developer Guide — What is AWS Lambda?  
  https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

- AWS Lambda Developer Guide — Understanding the Lambda execution environment lifecycle  
  https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html

- AWS Lambda Developer Guide — Best practices for working with AWS Lambda functions  
  https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

- AWS Lambda Developer Guide — Understanding Lambda function scaling  
  https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html

- AWS Lambda Developer Guide — Configuring reserved concurrency  
  https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html

- AWS Lambda Developer Guide — Configuring provisioned concurrency  
  https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html

- AWS Lambda Developer Guide — Lambda quotas  
  https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html

- AWS Lambda Developer Guide — Configure Lambda function timeout  
  https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html

- AWS Lambda Developer Guide — Understanding retry behavior in Lambda  
  https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html

- AWS Lambda Developer Guide — Manage Lambda function versions  
  https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html

- AWS Lambda Developer Guide — Create an alias for a Lambda function  
  https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html

- AWS Lambda Developer Guide — Implement Lambda canary deployments using weighted alias routing  
  https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html

- AWS Lambda Developer Guide — Rolling back a Lambda runtime version  
  https://docs.aws.amazon.com/lambda/latest/dg/runtime-management-rollback.html

- AWS SDK for Java 2.x Developer Guide  
  https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html

---

## 49. Status Seri

Bagian ini adalah **Part 20** dari seri `learn-java-aws-sdk-lambda-cloud-integration-engineering`.

Seri **belum selesai**.

Bagian berikutnya:

```text
Part 21 — EventBridge and Scheduler for Java Engineers
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-19-lambda-event-sources-sqs-sns-s3-eventbridge-api-gateway.md">⬅️ Part 19 — Lambda Event Sources: SQS, SNS, S3, EventBridge, API Gateway</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-21-eventbridge-and-scheduler-for-java-engineers.md">Part 21 — EventBridge and Scheduler for Java Engineers ➡️</a>
</div>
