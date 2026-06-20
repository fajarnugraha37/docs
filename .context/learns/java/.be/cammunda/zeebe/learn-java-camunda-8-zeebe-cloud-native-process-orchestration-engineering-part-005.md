# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-005.md

# Part 005 — Java Client Evolution: Zeebe Java Client, Camunda Java Client, REST, gRPC, and Version Strategy

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Level: Advanced / Staff+ Engineering  
> Fokus: Java 8–25, Camunda 8 / Zeebe >= 8, production-grade orchestration client strategy  
> Status seri: **belum selesai**  
> Prasyarat seri sebelumnya: Java runtime, concurrency, HTTP/gRPC, Spring Boot, Camunda 7, BPMN orchestration, observability, distributed systems basics

---

## 0. Tujuan Part Ini

Part ini membahas satu area yang sering terlihat sederhana tetapi berdampak besar terhadap maintainability sistem Camunda 8: **strategi client Java**.

Banyak engineer memulai Camunda 8 dengan pertanyaan:

> “Library apa yang saya import agar bisa start process dan bikin worker?”

Itu pertanyaan yang valid, tetapi belum cukup untuk production. Pertanyaan yang lebih matang adalah:

> “Bagaimana saya mengisolasi aplikasi Java saya dari perubahan client SDK, protokol transport, authentication model, deployment topology, retry semantics, observability, dan lifecycle compatibility Camunda 8?”

Camunda 8 mengalami evolusi API/client yang penting:

1. Pada fase awal Camunda 8, Java integration banyak dikenal sebagai **Zeebe Java Client**.
2. Spring integration banyak dikenal sebagai **Spring Zeebe SDK**.
3. Mulai Camunda 8.8, Camunda memperkenalkan konsolidasi menuju **Camunda Java Client** dan **Camunda Spring Boot Starter**.
4. REST menjadi default protocol pada client baru, sedangkan gRPC tetap tersedia/configurable dalam konteks tertentu.
5. Zeebe Java Client dan Spring Zeebe SDK berada pada jalur deprecated/legacy dan perlu dimigrasikan sebelum versi removal.

Part ini bukan hanya “cara pakai client”, tetapi cara berpikir agar integrasi Camunda tidak menjadi technical debt besar.

---

## 1. Mental Model Utama: Client Bukan Detail Kecil

Dalam Camunda 7, banyak Java engineer terbiasa dengan mental model:

```text
Spring Boot App
  -> Camunda engine embedded/shared engine
  -> JavaDelegate executed inside engine transaction/context
  -> relational database as engine state
```

Dalam Camunda 8/Zeebe, mental modelnya berubah:

```text
Java Application
  -> Camunda/Zeebe client
  -> Gateway API
  -> Zeebe broker/partitions
  -> durable distributed workflow state
```

Artinya, client Java adalah **remote orchestration boundary**.

Ia bukan sekadar helper library. Ia menentukan:

1. Bagaimana aplikasi mengirim command ke cluster.
2. Bagaimana worker mengaktifkan job.
3. Bagaimana authentication dilakukan.
4. Bagaimana timeout, retry, dan backpressure terasa di aplikasi.
5. Bagaimana observability dibuat.
6. Bagaimana upgrade Camunda memengaruhi aplikasi.
7. Bagaimana network/proxy/security infrastructure memengaruhi runtime.

Jika client digunakan langsung di seluruh codebase tanpa abstraction, maka upgrade client/protocol akan menyentuh banyak tempat.

Jika client diisolasi dengan baik, perubahan dari Zeebe Java Client ke Camunda Java Client bisa menjadi perubahan adapter, bukan rewrite domain.

---

## 2. Evolusi Client: Dari Zeebe Java Client ke Camunda Java Client

### 2.1 Fase Lama: Zeebe Java Client

Pada awal Camunda 8, integrasi Java utama untuk Zeebe adalah `ZeebeClient`.

Secara konseptual, `ZeebeClient` digunakan untuk:

1. Deploy BPMN/DMN/forms.
2. Create process instance.
3. Publish message.
4. Resolve incidents tertentu melalui command API.
5. Membuat job worker.
6. Complete/fail/throw error untuk job.
7. Mengambil topology.

Contoh gaya lama secara konseptual:

```java
ZeebeClient client = ZeebeClient.newClientBuilder()
    .gatewayAddress("localhost:26500")
    .usePlaintext()
    .build();

client.newCreateInstanceCommand()
    .bpmnProcessId("order-process")
    .latestVersion()
    .variables(Map.of("orderId", "ORD-123"))
    .send()
    .join();
```

Untuk worker:

```java
client.newWorker()
    .jobType("charge-payment")
    .handler((jobClient, job) -> {
        // business execution
        jobClient.newCompleteCommand(job.getKey())
            .send()
            .join();
    })
    .open();
```

Ini berguna, tetapi nama dan package-nya mengikat aplikasi pada era “Zeebe-only client”.

### 2.2 Fase Baru: Camunda Java Client

Camunda Java Client adalah client konsolidasi untuk Camunda 8 orchestration cluster.

Mental modelnya:

```text
Old:
  Application -> ZeebeClient -> Zeebe API

New:
  Application -> CamundaClient -> Camunda orchestration APIs
```

Perubahan nama dari `ZeebeClient` ke `CamundaClient` bukan hanya kosmetik. Ia mencerminkan perubahan arah:

1. Camunda 8 tidak hanya Zeebe broker.
2. Ada orchestration cluster API yang lebih luas.
3. API experience ingin dikonsolidasikan.
4. REST menjadi default path modern.
5. gRPC tetap relevan untuk beberapa workload/infrastruktur.

Contoh gaya baru secara konseptual:

```java
CamundaClient client = CamundaClient.newClientBuilder()
    .grpcAddress(URI.create("http://localhost:26500"))
    .restAddress(URI.create("http://localhost:8080"))
    .usePlaintext()
    .build();

client.newCreateInstanceCommand()
    .bpmnProcessId("order-process")
    .latestVersion()
    .variables(Map.of("orderId", "ORD-123"))
    .send()
    .join();
```

Catatan:

- Bentuk API dapat berbeda antar versi minor.
- Jangan menghafal snippet sebagai kontrak absolut.
- Yang penting untuk part ini adalah **strategi isolasi dan versioning**, bukan syntactic memorization.

---

## 3. Kenapa Camunda Melakukan Konsolidasi Client?

Ada beberapa alasan engineering yang masuk akal.

### 3.1 Produk Camunda 8 Semakin Luas

Camunda 8 bukan hanya broker Zeebe.

Ada:

1. Zeebe broker.
2. Gateway.
3. Operate.
4. Tasklist.
5. Optimize.
6. Identity.
7. Connectors.
8. Web Modeler.
9. Orchestration Cluster API.

Nama `ZeebeClient` terlalu sempit jika platform ingin menyediakan pengalaman API yang menyatukan orchestration operations.

### 3.2 REST Lebih Mudah untuk Enterprise Adoption

gRPC sangat bagus untuk low-latency streaming dan strongly typed API, tetapi di banyak enterprise environment, REST lebih mudah:

1. Lebih umum didukung oleh API gateway.
2. Lebih mudah melewati proxy.
3. Tidak membutuhkan HTTP/2 awareness pada banyak layer.
4. Lebih mudah diobservasi oleh existing API monitoring tools.
5. Lebih familiar untuk security/network team.
6. Lebih mudah untuk governance OpenAPI.

Dengan REST sebagai default, barrier integrasi turun.

### 3.3 gRPC Tetap Berguna

gRPC tetap kuat untuk:

1. High-throughput workers.
2. Streaming job activation.
3. Low-latency binary protocol.
4. Strong contract via protobuf.
5. Efficient long-lived channel.

Karena itu, keputusan REST vs gRPC bukan keputusan ideologis. Itu keputusan berdasarkan runtime constraints.

### 3.4 Migration Pressure Harus Dikelola

Ketika client lama akan deprecated/removed, aplikasi yang menaruh `ZeebeClient` langsung di seluruh layer akan sakit saat migration.

Aplikasi yang memiliki adapter boundary bisa migrasi lebih mudah.

---

## 4. Compatibility Mindset: Java 8 sampai Java 25

User requirement seri ini mencakup Java 8 hingga 25. Untuk Camunda 8 modern, kita harus membedakan:

1. **Java language level aplikasi**.
2. **Runtime requirement client library**.
3. **Runtime requirement Camunda component**.
4. **Spring Boot baseline**.
5. **Deployment JVM baseline**.

### 4.1 Jangan Samakan “Java 8 Supported by My App” dengan “Java 8 Ideal for New Camunda 8 Workload”

Java 8 masih ada di banyak enterprise, tetapi untuk Camunda 8 modern:

- Banyak tooling modern bergerak ke Java 17/21.
- Spring Boot 3.x membutuhkan Java 17+.
- Camunda 8 runtime modern sering ditargetkan pada Java 21+ untuk local run/tooling tertentu.
- Java 25 mulai relevan untuk certified/supported runtime tertentu pada generasi baru.

Jadi strategi realistis:

```text
Legacy integration compatibility:
  Java 8/11 may exist in older estate.

Modern new Camunda 8 Java worker baseline:
  Java 17 or 21 is more realistic.

Forward-looking production baseline:
  Java 21 now, evaluate Java 25 after organizational support matures.
```

### 4.2 Java 8 Strategy

Jika organisasi masih punya Java 8 service yang perlu berinteraksi dengan Camunda 8:

Pilihan 1 — Direct client, jika versi client masih compatible:

```text
Java 8 app -> supported older Zeebe/Camunda client -> Camunda 8 gateway
```

Risiko:

- Client version mungkin tertinggal.
- Tidak semua fitur baru tersedia.
- Upgrade path sulit.
- Security maintenance lebih berat.

Pilihan 2 — Adapter service:

```text
Java 8 app -> internal REST adapter -> Java 21 Camunda adapter -> Camunda 8
```

Keuntungan:

- Java 8 service tidak perlu memuat SDK modern.
- Camunda client terkonsentrasi di adapter.
- Auth, retry, observability, compatibility dikelola di satu tempat.

Kekurangan:

- Tambah hop jaringan.
- Tambah service yang harus dioperasikan.
- Perlu contract governance.

Pilihan 3 — Event bridge:

```text
Java 8 app -> Kafka/RabbitMQ/domain event -> orchestrator worker/initiator -> Camunda 8
```

Cocok jika legacy system sudah event-driven.

### 4.3 Java 11 Strategy

Java 11 berada di tengah:

- Lebih modern dari Java 8.
- Tetapi tidak ideal untuk ekosistem Spring Boot 3.x.
- Bisa cocok untuk non-Spring worker ringan jika client version mendukung.

Untuk greenfield Camunda 8, Java 11 biasanya bukan pilihan terbaik jika organisasi sudah bisa memakai Java 17/21.

### 4.4 Java 17 Strategy

Java 17 adalah minimum realistis untuk banyak aplikasi enterprise modern karena:

1. Spring Boot 3.x baseline.
2. Jakarta namespace compatibility.
3. LTS maturity.
4. Tooling mature.

Jika organisasi belum siap Java 21, Java 17 adalah baseline yang aman.

### 4.5 Java 21 Strategy

Java 21 adalah baseline yang sangat kuat untuk Camunda 8 worker modern:

1. LTS.
2. Virtual threads tersedia.
3. Better GC/runtime improvements.
4. Cocok untuk IO-heavy worker jika digunakan dengan disiplin.
5. Banyak cloud-native Java framework bergerak ke Java 21.

Namun, jangan otomatis memakai virtual threads tanpa memahami:

- client library blocking behavior,
- connection pool behavior,
- JDBC driver behavior,
- external HTTP client behavior,
- rate limit external systems,
- backpressure worker.

### 4.6 Java 25 Strategy

Java 25 adalah next LTS generation. Untuk Camunda 8 modern, Java 25 mulai masuk konteks supported/certified pada versi baru tertentu.

Strategi production:

1. Jangan upgrade hanya demi versi.
2. Validasi client compatibility.
3. Validasi Spring Boot compatibility.
4. Validasi container base image.
5. Validasi observability agent.
6. Validasi performance baseline.
7. Validasi memory/GC tuning.
8. Jalankan canary.

---

## 5. REST vs gRPC: Cara Memilih dengan Benar

Pertanyaan umum:

> “Mana yang lebih baik, REST atau gRPC?”

Jawaban advanced:

> “Tergantung command pattern, worker throughput, network infrastructure, governance, security, dan operational capability.”

### 5.1 REST: Kapan Cocok?

REST cocok jika:

1. Enterprise network lebih nyaman dengan HTTP/1.1/HTTP semantics biasa.
2. API gateway/proxy/security tooling sudah REST-first.
3. Tim butuh observability mudah.
4. Workload command tidak sangat high-throughput.
5. Integrasi datang dari banyak language/platform.
6. Standardization lebih penting daripada latency minimum.
7. Self-managed cluster ingin mengurangi kompleksitas HTTP/2/gRPC exposure.

Contoh use case REST-friendly:

```text
- start process dari backend API
- publish message dari integration adapter
- deploy BPMN dari CI/CD
- query orchestration API
- moderate throughput worker
```

### 5.2 gRPC: Kapan Cocok?

gRPC cocok jika:

1. Worker high-throughput.
2. Job activation streaming penting.
3. Latency penting.
4. Internal service-to-service network mendukung HTTP/2 dengan baik.
5. Tim mampu debug gRPC channel, deadline, keepalive, TLS/mTLS.
6. Load balancer/gateway support matang.

Contoh use case gRPC-friendly:

```text
- high-throughput automated service tasks
- internal worker fleet
- controlled Kubernetes network
- low-latency job activation
```

### 5.3 Anti-Pattern Pemilihan Protokol

Anti-pattern:

```text
“Kita pilih gRPC karena lebih modern.”
```

Masalah:

- Network team mungkin tidak support HTTP/2 pass-through.
- Ingress mungkin terminate/translate dengan aneh.
- Debugging lebih sulit.
- Corporate proxy mungkin bermasalah.

Anti-pattern lain:

```text
“Kita pilih REST karena semua orang tahu REST.”
```

Masalah:

- Worker throughput tinggi mungkin tidak optimal.
- Polling/streaming behavior bisa berbeda.
- Latency dan connection reuse harus dipahami.

### 5.4 Decision Matrix

| Faktor | REST | gRPC |
|---|---:|---:|
| Enterprise compatibility | tinggi | sedang/tergantung infra |
| API gateway support | tinggi | sedang/khusus |
| Human debugging | mudah | sedang |
| Latency | baik | sangat baik |
| Streaming worker | tergantung support | kuat |
| HTTP/2 requirement | tidak selalu | ya |
| Governance OpenAPI | kuat | perlu protobuf tooling |
| Internal K8s service-to-service | baik | sangat baik |
| External/public exposure | lebih mudah | lebih sensitif |
| High-throughput workers | bisa | lebih cocok |

### 5.5 Rekomendasi Default

Untuk organisasi enterprise/regulatory:

```text
Default integration command path:
  REST

High-throughput internal worker path:
  evaluate gRPC

Legacy compatibility:
  isolate behind adapter

Never expose protocol choice directly to business/domain code.
```

---

## 6. Client Usage Boundaries: Jangan Sebar SDK ke Semua Layer

### 6.1 Bad Architecture

```text
Controller
  -> CamundaClient directly

Service A
  -> CamundaClient directly

Service B
  -> CamundaClient directly

Worker Handler
  -> CamundaClient directly

Domain Service
  -> CamundaClient directly
```

Masalah:

1. Sulit migration dari ZeebeClient ke CamundaClient.
2. Sulit mock/test.
3. Protocol details bocor.
4. Retry semantics tersebar.
5. Observability tidak konsisten.
6. Error handling tidak seragam.
7. Domain logic tahu detail engine.

### 6.2 Better Architecture

```text
Application Layer
  -> ProcessOrchestrator port
       -> CamundaProcessOrchestrator adapter
            -> CamundaClient

Worker Adapter Layer
  -> JobHandler adapter
       -> Domain Command Handler
       -> JobCompletion adapter
```

Port:

```java
public interface ProcessOrchestrator {
    ProcessStartResult startProcess(StartProcessCommand command);
    void publishMessage(PublishWorkflowMessage command);
}
```

Adapter:

```java
public final class CamundaProcessOrchestrator implements ProcessOrchestrator {
    private final CamundaClient client;
    private final ProcessVariableMapper mapper;

    public CamundaProcessOrchestrator(
            CamundaClient client,
            ProcessVariableMapper mapper
    ) {
        this.client = client;
        this.mapper = mapper;
    }

    @Override
    public ProcessStartResult startProcess(StartProcessCommand command) {
        Map<String, Object> variables = mapper.toVariables(command);

        var response = client.newCreateInstanceCommand()
                .bpmnProcessId(command.processId())
                .latestVersion()
                .variables(variables)
                .send()
                .join();

        return new ProcessStartResult(
                response.getProcessInstanceKey(),
                response.getBpmnProcessId(),
                response.getVersion()
        );
    }

    @Override
    public void publishMessage(PublishWorkflowMessage command) {
        client.newPublishMessageCommand()
                .messageName(command.messageName())
                .correlationKey(command.correlationKey())
                .timeToLive(command.ttl())
                .variables(command.variables())
                .send()
                .join();
    }
}
```

Domain layer tidak tahu Camunda.

---

## 7. What Should Be Abstracted?

Tidak semua hal perlu diabstraksikan. Abstraction yang terlalu generik akan menjadi lemah.

### 7.1 Abstraksi yang Layak

Abstraksikan:

1. Start process.
2. Publish message.
3. Process variable mapping.
4. Worker job payload mapping.
5. Worker completion/failure/error mapping.
6. Authentication configuration.
7. Client construction.
8. Retry policy wrapper.
9. Observability/correlation.
10. Multi-tenant routing.

### 7.2 Abstraksi yang Jangan Terlalu Dini

Hati-hati mengabstraksikan:

1. Semua command Camunda menjadi generic interface.
2. Semua BPMN concepts menjadi internal DSL.
3. Worker runtime lifecycle.
4. Incident operations.
5. Process instance modification.

Kenapa?

Karena orchestration semantics itu domain teknis yang penting. Jika terlalu disembunyikan, engineer kehilangan kemampuan debug.

Prinsip:

```text
Hide SDK instability.
Do not hide workflow semantics.
```

---

## 8. Dependency Management: Maven dan Gradle Strategy

### 8.1 Prinsip Umum

Untuk Camunda client:

1. Pin version dengan jelas.
2. Hindari floating/latest version.
3. Gunakan BOM jika tersedia dan sesuai stack.
4. Jangan campur versi Camunda client berbeda dalam satu aplikasi.
5. Pastikan starter Spring dan client underlying compatible.
6. Simpan version decision di satu tempat.

### 8.2 Maven Conceptual Setup

Contoh konseptual:

```xml
<properties>
    <java.version>21</java.version>
    <camunda.version>8.9.x</camunda.version>
</properties>

<dependencies>
    <dependency>
        <groupId>io.camunda</groupId>
        <artifactId>camunda-client-java</artifactId>
        <version>${camunda.version}</version>
    </dependency>
</dependencies>
```

Untuk Spring Boot:

```xml
<dependencies>
    <dependency>
        <groupId>io.camunda</groupId>
        <artifactId>spring-boot-starter-camunda</artifactId>
        <version>${camunda.version}</version>
    </dependency>
</dependencies>
```

Catatan:

- Artifact name harus diverifikasi sesuai versi yang dipakai.
- Dokumentasi resmi versi target harus menjadi sumber final.
- Jangan copy paste dependency dari blog lama tanpa cek versi.

### 8.3 Gradle Conceptual Setup

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.5.x"
    id("io.spring.dependency-management") version "1.1.x"
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    implementation("io.camunda:camunda-client-java:8.9.x")
    implementation("io.camunda:spring-boot-starter-camunda:8.9.x")
}
```

### 8.4 Version Drift Smell

Smell:

```text
service-a uses Zeebe client 8.3
service-b uses Zeebe client 8.5
service-c uses Camunda client 8.8
service-d uses Spring Zeebe SDK 8.2
```

Risiko:

1. Different behavior under failure.
2. Different defaults.
3. Different protocol support.
4. Different auth config.
5. Different observability.
6. Hard incident diagnosis.

Governance:

```text
One approved Camunda client version per platform release train.
Exceptions require ADR and expiry date.
```

---

## 9. Client Lifecycle: Singleton, Thread Safety, and Shutdown

### 9.1 Client Should Usually Be Singleton

Camunda client biasanya memiliki internal resources:

1. HTTP/gRPC channel.
2. Connection pools.
3. Threads/event loops.
4. Worker polling/streaming loops.
5. Auth token handling.

Anti-pattern:

```java
public void startProcess(Request request) {
    try (CamundaClient client = newClient()) {
        client.newCreateInstanceCommand()...
    }
}
```

Masalah:

- Connection churn.
- TLS/auth overhead.
- Resource leak risk.
- Latency tinggi.
- Worker lifecycle kacau.

Better:

```text
Application startup:
  create CamundaClient once

Application runtime:
  reuse CamundaClient

Application shutdown:
  close CamundaClient gracefully
```

### 9.2 Spring Bean Lifecycle

```java
@Configuration
public class CamundaClientConfig {

    @Bean(destroyMethod = "close")
    CamundaClient camundaClient(CamundaProperties properties) {
        return CamundaClient.newClientBuilder()
                // configure addresses/auth/protocol
                .build();
    }
}
```

Jika menggunakan Spring Boot Starter, banyak konfigurasi ini dikelola oleh starter. Namun prinsip lifecycle tetap sama.

### 9.3 Graceful Shutdown Worker

Worker shutdown harus menjawab:

1. Apakah aplikasi berhenti mengambil job baru?
2. Apakah job aktif diberi waktu selesai?
3. Apa yang terjadi jika job belum selesai saat pod mati?
4. Apakah job timeout cukup aman agar diambil worker lain?
5. Apakah external side effect sudah idempotent?

Urutan ideal:

```text
SIGTERM received
  -> stop accepting HTTP traffic
  -> stop activating new jobs
  -> finish active jobs if possible
  -> complete/fail active jobs
  -> close worker/client
  -> exit before Kubernetes grace period ends
```

---

## 10. Authentication Strategy

Authentication berbeda antara SaaS dan self-managed.

### 10.1 SaaS

Biasanya menggunakan OAuth/client credentials dengan Camunda Cloud credentials.

Konsep:

```text
client-id
client-secret
cluster-id / region / audience
OAuth token endpoint
```

Risk:

1. Secret leakage.
2. Token expiry.
3. Wrong audience/scope.
4. Misconfigured environment.
5. Overprivileged client.

### 10.2 Self-Managed

Self-managed bisa memiliki beberapa mode tergantung konfigurasi:

1. Plain/internal no auth untuk local development.
2. Identity/Keycloak backed auth.
3. TLS/mTLS at ingress/service mesh.
4. Network-restricted gateway.

Production self-managed sebaiknya tidak mengandalkan “network only” tanpa governance. Minimal:

```text
- gateway internal exposure controlled
- credentials stored in secret manager
- worker identity separated by service
- least privilege where possible
- TLS/mTLS evaluated
- audit trail enabled for sensitive operations
```

### 10.3 Secret Handling

Jangan:

```text
- hardcode client secret
- commit application.yaml with prod secret
- log auth headers
- expose secret to frontend
- reuse one super-client for all services
```

Gunakan:

```text
- Kubernetes Secret / External Secret / AWS SSM / Vault
- environment-specific credentials
- short rotation path
- separate credential per worker app
- secret access audit
```

---

## 11. Command Semantics: Async Result, Join, Future, and Timeout

Client command biasanya mengembalikan async future/promise-like result.

Contoh blocking:

```java
var result = client.newCreateInstanceCommand()
        .bpmnProcessId("application-review")
        .latestVersion()
        .variables(variables)
        .send()
        .join();
```

Ini mudah, tetapi punya risiko:

1. Thread blocking.
2. Timeout tidak eksplisit.
3. Error wrapping bisa membingungkan.
4. Dalam web request, bisa menghabiskan request threads.
5. Dalam worker, bisa menyebabkan worker thread stuck.

Better untuk production:

```java
try {
    var result = client.newCreateInstanceCommand()
            .bpmnProcessId("application-review")
            .latestVersion()
            .variables(variables)
            .send()
            .toCompletableFuture()
            .get(5, TimeUnit.SECONDS);

    return ProcessStartResult.from(result);
} catch (TimeoutException e) {
    throw new ProcessCommandTimeoutException("Timed out starting process", e);
} catch (ExecutionException e) {
    throw mapCamundaException(e.getCause());
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new ProcessCommandInterruptedException(e);
}
```

Aturan:

```text
Never let remote orchestration command block forever.
```

---

## 12. Retry Policy: Mana yang Boleh Di-retry?

Client command retry harus dibedakan dari job retry.

### 12.1 Command Retry

Command retry adalah retry saat aplikasi mengirim command ke Camunda.

Contoh:

```text
start process command failed because gateway temporarily unavailable
```

### 12.2 Job Retry

Job retry adalah retry execution task dalam process.

Contoh:

```text
worker failed calling external credit bureau API
```

Keduanya berbeda.

### 12.3 Start Process Retry Risk

Jika `create process instance` command dikirim, cluster menerima command, tetapi response hilang karena network failure, aplikasi mungkin retry dan membuat process instance kedua.

```text
App -> CreateInstance(orderId=ORD-123)
Camunda creates instance
Network fails before response
App retries
Camunda creates another instance
```

Mitigasi:

1. Gunakan idempotency di sisi aplikasi.
2. Simpan process instance reference di database.
3. Gunakan business key/correlation discipline.
4. Jangan anggap retry command selalu aman.

Example:

```java
@Transactional
public ProcessStartResult startApplicationReview(String applicationId) {
    Optional<WorkflowLink> existing = repository.findByBusinessId(applicationId);
    if (existing.isPresent()) {
        return existing.get().toResult();
    }

    var result = orchestrator.startProcess(new StartProcessCommand(
            "application-review",
            applicationId,
            Map.of("applicationId", applicationId)
    ));

    repository.insert(new WorkflowLink(applicationId, result.processInstanceKey()));
    return result;
}
```

Masih ada race jika dua request paralel. Tambahkan unique constraint:

```sql
create unique index ux_workflow_link_business_id
on workflow_link(business_id);
```

### 12.4 Publish Message Retry Risk

Publish message dengan correlation key juga bisa duplicate.

Jika process menunggu message dan duplicate message masuk, behavior tergantung message name, correlation key, TTL, dan process state.

Gunakan message id/dedup key di domain side jika external event bisa duplicate.

---

## 13. Worker API: Low-Level Client vs Spring Annotation

Ada dua gaya umum:

1. Low-level client worker registration.
2. Spring Boot annotation-based worker.

### 13.1 Low-Level Worker

```java
client.newWorker()
        .jobType("validate-application")
        .handler(new ValidateApplicationJobHandler())
        .maxJobsActive(32)
        .timeout(Duration.ofMinutes(2))
        .open();
```

Kelebihan:

1. Eksplisit.
2. Bisa custom lifecycle.
3. Cocok untuk framework non-Spring.
4. Mudah memahami apa yang terjadi.

Kekurangan:

1. Boilerplate.
2. Lifecycle harus dikelola sendiri.
3. Config harus dibuat sendiri.

### 13.2 Spring Annotation Worker

Konseptual:

```java
@Component
public class ValidateApplicationWorker {

    @JobWorker(type = "validate-application")
    public Map<String, Object> handle(JobClient client, ActivatedJob job) {
        // business logic
        return Map.of("validationStatus", "PASSED");
    }
}
```

Kelebihan:

1. Cepat produktif.
2. Lifecycle dikelola Spring starter.
3. Configuration via properties.
4. Integrasi dengan DI, metrics, logging lebih mudah.

Kekurangan:

1. Detail runtime bisa tersembunyi.
2. Annotation bisa mendorong logic terlalu banyak di method worker.
3. Perlu disiplin architecture agar domain tidak bocor.

### 13.3 Rekomendasi

Untuk enterprise Java/Spring:

```text
Use Spring Boot Starter for lifecycle and configuration.
Keep worker methods thin.
Delegate to application/domain services.
Centralize error mapping and variable mapping.
```

Worker method ideal:

```java
@JobWorker(type = "assess-risk")
public Map<String, Object> assessRisk(ActivatedJob job) {
    RiskAssessmentCommand command = mapper.fromJob(job);
    RiskAssessmentResult result = handler.handle(command);
    return mapper.toVariables(result);
}
```

Jangan:

```java
@JobWorker(type = "assess-risk")
public Map<String, Object> assessRisk(ActivatedJob job) {
    // 300 lines:
    // parse variables
    // query database
    // call external systems
    // decide retry
    // update audit
    // publish event
    // complete manually
}
```

---

## 14. Worker Completion Mode: Auto vs Manual

### 14.1 Auto Completion

Auto completion berarti method return value dianggap sebagai variables untuk complete job.

Kelebihan:

1. Simple.
2. Less boilerplate.
3. Cocok untuk straightforward task.

Risiko:

1. Error mapping kurang eksplisit.
2. Sulit untuk advanced completion/failure flow.
3. Bisa menyamarkan side-effect order.

### 14.2 Manual Completion

Manual completion memberi kontrol penuh:

```java
@JobWorker(type = "send-notification", autoComplete = false)
public void sendNotification(JobClient client, ActivatedJob job) {
    try {
        service.send(job);

        client.newCompleteCommand(job.getKey())
                .variables(Map.of("notificationSent", true))
                .send()
                .join();
    } catch (TransientExternalException e) {
        client.newFailCommand(job.getKey())
                .retries(job.getRetries() - 1)
                .errorMessage(e.getMessage())
                .send()
                .join();
    } catch (BusinessRejectedException e) {
        client.newThrowErrorCommand(job.getKey())
                .errorCode("NOTIFICATION_REJECTED")
                .errorMessage(e.getMessage())
                .send()
                .join();
    }
}
```

Kapan manual completion cocok?

1. Need custom failure mapping.
2. Need BPMN error throwing.
3. Need conditional completion.
4. Need explicit observability.
5. Need complex side-effect order.

Kapan auto completion cukup?

1. Pure computation.
2. Low-risk internal operation.
3. Simple variable transformation.
4. Error handling bisa dikelola oleh starter/default policy.

---

## 15. Client Error Taxonomy

Aplikasi harus memiliki taxonomy error sendiri, bukan membiarkan exception SDK bocor ke domain.

Contoh taxonomy:

```java
public sealed class WorkflowClientException extends RuntimeException
        permits WorkflowCommandTimeoutException,
                WorkflowCommandRejectedException,
                WorkflowAuthenticationException,
                WorkflowUnavailableException,
                WorkflowSerializationException,
                WorkflowUnknownException {

    protected WorkflowClientException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Kategori penting:

| Category | Meaning | Retry? | Example |
|---|---|---:|---|
| Timeout | command response not received in time | maybe | gateway slow |
| Unavailable | gateway/cluster unreachable | yes with backoff | network issue |
| Auth | credential/token issue | no until fixed | invalid secret |
| Rejection | command invalid/rejected | usually no | process id not found |
| Serialization | variable payload invalid | no | invalid JSON mapping |
| Conflict/idempotency | duplicate business operation | no/return existing | duplicate start |
| Unknown | unmapped | cautious | unexpected SDK error |

Prinsip:

```text
Map SDK exceptions at adapter boundary.
Domain/application layer should see workflow-specific exceptions.
```

---

## 16. Variable Serialization Strategy in Client Layer

Client layer sering menjadi tempat variable chaos.

Anti-pattern:

```java
Map<String, Object> variables = new HashMap<>();
variables.put("applicationId", app.getId());
variables.put("user", userEntity);
variables.put("document", documentEntity);
variables.put("createdAt", LocalDateTime.now());
```

Masalah:

1. Entity bocor ke workflow variables.
2. Lazy loading issue.
3. Circular reference.
4. Payload terlalu besar.
5. Date format tidak konsisten.
6. PII bocor.
7. Schema evolution kacau.

Better:

```java
public record ApplicationReviewVariables(
        String applicationId,
        String applicantId,
        String applicationType,
        String submittedAtIso,
        int schemaVersion
) {}
```

Mapper:

```java
public final class ApplicationReviewVariableMapper {

    public Map<String, Object> toVariables(ApplicationReviewStartCommand command) {
        return Map.of(
                "applicationId", command.applicationId(),
                "applicantId", command.applicantId(),
                "applicationType", command.applicationType(),
                "submittedAt", command.submittedAt().toString(),
                "schemaVersion", 1
        );
    }
}
```

Principle:

```text
Variables are process contract, not object dump.
```

---

## 17. Multi-Tenant Client Strategy

Dalam enterprise platform, satu aplikasi worker bisa melayani banyak tenant/agency/unit.

Pertanyaan:

1. Apakah setiap tenant punya Camunda cluster sendiri?
2. Apakah tenant dipisahkan dalam satu cluster?
3. Apakah credentials per tenant?
4. Apakah process definitions tenant-specific?
5. Apakah workers boleh mengambil job lintas tenant?
6. Bagaimana variable data isolation dijamin?

### 17.1 Single Client, Single Tenant

```text
worker-service-a -> CamundaClient tenant A -> cluster A
```

Simple dan aman.

### 17.2 Client Per Tenant

```text
worker-service -> client tenant A
               -> client tenant B
               -> client tenant C
```

Risiko:

1. Resource usage naik.
2. Config lebih kompleks.
3. Error tenant bisa memengaruhi app.
4. Observability harus tenant-aware.

### 17.3 Tenant Routing Adapter

```java
public interface TenantWorkflowClientRouter {
    WorkflowClient forTenant(String tenantId);
}
```

Setiap operation harus membawa tenant context:

```java
public record StartProcessCommand(
        String tenantId,
        String processId,
        String businessKey,
        Map<String, Object> variables
) {}
```

Rule:

```text
Never infer tenant from mutable user input without authorization validation.
```

---

## 18. Configuration Design

### 18.1 Bad Configuration

```yaml
camunda-url: http://localhost:26500
client-secret: abc123
```

Masalah:

- Ambiguous: REST or gRPC?
- Secret stored plainly.
- No timeout.
- No worker tuning.
- No environment separation.

### 18.2 Better Configuration

```yaml
workflow:
  camunda:
    enabled: true
    mode: self-managed
    protocol: rest
    rest-address: http://camunda-gateway:8080
    grpc-address: http://camunda-gateway:26500
    auth:
      type: oauth-client-credentials
      client-id: ${CAMUNDA_CLIENT_ID}
      client-secret: ${CAMUNDA_CLIENT_SECRET}
      audience: ${CAMUNDA_AUDIENCE}
      token-url: ${CAMUNDA_TOKEN_URL}
    command:
      timeout: 5s
      retry:
        max-attempts: 3
        initial-backoff: 200ms
        max-backoff: 2s
    workers:
      validate-application:
        enabled: true
        type: validate-application
        max-jobs-active: 32
        timeout: 2m
        request-timeout: 30s
      send-notification:
        enabled: true
        type: send-notification
        max-jobs-active: 16
        timeout: 1m
```

### 18.3 Configuration Principles

1. Protocol explicit.
2. Address explicit.
3. Auth explicit.
4. Timeout explicit.
5. Worker tuning externalized.
6. Environment-specific secrets externalized.
7. Fail fast on invalid config.
8. Avoid silent defaults for production.

---

## 19. Local Development Strategy

Local development should be easy but not misleading.

### 19.1 Local Modes

Common options:

1. Camunda SaaS dev cluster.
2. Local Camunda 8 Run.
3. Docker Compose/self-managed lightweight.
4. Testcontainers for integration tests.

### 19.2 Avoid Local/Prod Semantic Gap

Bad:

```text
local: no auth, no timeout, no retries, no TLS, no worker limit
prod: auth, network proxy, strict timeout, TLS, resource constraints
```

Then local success says little about production readiness.

Better:

```text
local:
  simplified auth allowed
  but same process id/job type/variable schema
  same worker timeout/concurrency shape
  same error mapping
  same observability fields
```

### 19.3 Developer Starter Template

A serious team should provide:

```text
/camunda
  /bpmn
  /forms
  /dmn
/src/main/java
  /workflow
    /client
    /worker
    /variables
    /errors
    /observability
/src/test/java
  /workflow
    /contract
    /integration
```

---

## 20. CI/CD and Deployment Integration

Client choice affects CI/CD.

### 20.1 BPMN Deployment

Options:

1. Deploy BPMN at app startup.
2. Deploy BPMN through CI/CD pipeline.
3. Deploy BPMN manually/modeler-managed.
4. Deploy BPMN as platform artifact.

### 20.2 App Startup Deployment

Pros:

- Simple.
- App and process version move together.
- Good for small services.

Cons:

- Every restart can deploy.
- Process definition lifecycle tied to app deployment.
- Harder for regulated change control.

### 20.3 CI/CD Deployment

Pros:

- Better governance.
- Approval flow possible.
- Process artifact versioned.
- Rollout controlled.

Cons:

- Need pipeline credentials.
- Need compatibility with worker deployment.
- Need rollback model.

### 20.4 Production Recommendation

For regulated/enterprise system:

```text
BPMN deployment should be explicit release activity.
Worker deployment should be compatible with deployed BPMN.
CI/CD should validate BPMN + worker contract together.
```

---

## 21. Worker Versioning and Client Versioning Are Different

Jangan campur dua hal ini:

1. **Client library version**: `camunda-client-java` version.
2. **Worker contract version**: job type/variables/error semantics.

Contoh:

```text
client library version:
  8.9.x

worker contract:
  validate-application.v2
```

Client upgrade tidak seharusnya mengubah business contract.

Worker contract upgrade tidak selalu butuh client upgrade.

### 21.1 Job Type Versioning

Option A:

```text
validate-application
```

Dengan schemaVersion variable.

Option B:

```text
validate-application-v1
validate-application-v2
```

Trade-off:

| Strategy | Pros | Cons |
|---|---|---|
| Same job type + schemaVersion | fewer BPMN changes | handler more complex |
| Versioned job type | explicit runtime separation | BPMN change required |

Production heuristic:

```text
For breaking input/output contract changes, prefer explicit versioning.
For additive compatible changes, schemaVersion may be enough.
```

---

## 22. Client Adapter Design Blueprint

Berikut blueprint yang bisa dipakai untuk aplikasi enterprise.

### 22.1 Package Structure

```text
com.example.workflow
  client
    WorkflowCommandGateway.java
    CamundaWorkflowCommandGateway.java
    WorkflowClientException.java
    WorkflowClientProperties.java
  variables
    VariableMapper.java
    ApplicationReviewVariables.java
    RiskAssessmentVariables.java
  worker
    JobWorkerAdapter.java
    JobErrorMapper.java
    JobVariableExtractor.java
  observability
    WorkflowCorrelation.java
    WorkflowMdc.java
  idempotency
    WorkflowCommandDeduplicator.java
```

### 22.2 WorkflowCommandGateway Port

```java
public interface WorkflowCommandGateway {

    ProcessInstanceReference startLatest(
            String bpmnProcessId,
            String businessKey,
            Map<String, Object> variables
    );

    void publishMessage(
            String messageName,
            String correlationKey,
            Duration timeToLive,
            Map<String, Object> variables
    );
}
```

### 22.3 ProcessInstanceReference

```java
public record ProcessInstanceReference(
        long processInstanceKey,
        String bpmnProcessId,
        int version,
        String businessKey
) {}
```

### 22.4 Camunda Adapter

```java
public final class CamundaWorkflowCommandGateway implements WorkflowCommandGateway {

    private final CamundaClient client;
    private final Duration commandTimeout;
    private final WorkflowExceptionMapper exceptionMapper;

    public CamundaWorkflowCommandGateway(
            CamundaClient client,
            Duration commandTimeout,
            WorkflowExceptionMapper exceptionMapper
    ) {
        this.client = Objects.requireNonNull(client);
        this.commandTimeout = Objects.requireNonNull(commandTimeout);
        this.exceptionMapper = Objects.requireNonNull(exceptionMapper);
    }

    @Override
    public ProcessInstanceReference startLatest(
            String bpmnProcessId,
            String businessKey,
            Map<String, Object> variables
    ) {
        try {
            var response = client.newCreateInstanceCommand()
                    .bpmnProcessId(bpmnProcessId)
                    .latestVersion()
                    .variables(variables)
                    .send()
                    .toCompletableFuture()
                    .get(commandTimeout.toMillis(), TimeUnit.MILLISECONDS);

            return new ProcessInstanceReference(
                    response.getProcessInstanceKey(),
                    response.getBpmnProcessId(),
                    response.getVersion(),
                    businessKey
            );
        } catch (Exception e) {
            throw exceptionMapper.map("startLatest", bpmnProcessId, e);
        }
    }

    @Override
    public void publishMessage(
            String messageName,
            String correlationKey,
            Duration timeToLive,
            Map<String, Object> variables
    ) {
        try {
            client.newPublishMessageCommand()
                    .messageName(messageName)
                    .correlationKey(correlationKey)
                    .timeToLive(timeToLive)
                    .variables(variables)
                    .send()
                    .toCompletableFuture()
                    .get(commandTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            throw exceptionMapper.map("publishMessage", messageName, e);
        }
    }
}
```

### 22.5 Why This Helps

Ketika client berubah:

```text
ZeebeClient -> CamundaClient
REST -> gRPC
gRPC -> REST
auth config changes
exception type changes
```

Yang berubah terutama adapter, bukan domain.

---

## 23. Migration Plan: ZeebeClient ke CamundaClient

### 23.1 Inventory

Cari semua import:

```text
io.camunda.zeebe.client.ZeebeClient
io.camunda.zeebe.client.api.response.*
io.camunda.zeebe.client.api.worker.*
io.camunda.zeebe.spring.client.*
```

Klasifikasikan usage:

1. Process instantiation.
2. Message publishing.
3. Deployment.
4. Worker registration.
5. Job completion/failure/error.
6. Topology call.
7. Operate/Tasklist API usage.
8. Test utilities.

### 23.2 Separate Migration Tracks

Track A — Plain Java client:

```text
ZeebeClient -> CamundaClient
```

Track B — Spring:

```text
Spring Zeebe SDK -> Camunda Spring Boot Starter
```

Track C — Test:

```text
Old test helpers -> new test utilities/integration setup
```

Track D — Config:

```text
old zeebe.* properties -> new camunda.* properties
```

### 23.3 Migration Steps

1. Upgrade dependencies in a branch.
2. Introduce adapter boundary if missing.
3. Replace client construction.
4. Replace worker annotations/config if Spring.
5. Replace imports.
6. Update properties.
7. Run compile.
8. Run unit tests.
9. Run worker integration tests.
10. Deploy to dev with one worker type.
11. Validate job activation/completion/failure.
12. Validate message publishing.
13. Validate process start.
14. Validate auth.
15. Validate observability.
16. Canary in lower environment.
17. Document rollback.

### 23.4 Migration Risks

| Risk | Example | Mitigation |
|---|---|---|
| Config rename | old properties ignored | fail-fast config validation |
| Protocol default change | REST used instead of expected gRPC | make protocol explicit |
| Worker behavior change | timeout/default changed | externalize worker config |
| Exception mapping change | wrong retry | adapter exception mapper |
| Auth config change | token failure | env-specific smoke test |
| Dependency conflict | Spring Boot mismatch | compatibility matrix |
| Hidden import | old SDK still used | static search / dependency tree |

### 23.5 Definition of Done

Migration done only if:

```text
- no old Zeebe/Spring Zeebe dependency remains
- no old import remains
- all workers activate jobs
- complete/fail/throw error paths tested
- start process path tested
- publish message path tested
- auth tested
- metrics/logging still works
- rollback plan documented
- version decision recorded in ADR
```

---

## 24. REST/gRPC and Network Topology

Client protocol choice must match topology.

### 24.1 SaaS

```text
Java app
  -> internet/private connectivity
  -> Camunda SaaS endpoint
  -> auth via OAuth
```

Concerns:

1. Egress allowlist.
2. TLS trust.
3. Token endpoint availability.
4. Region latency.
5. Secret rotation.
6. Rate limits / quotas.

### 24.2 Self-Managed Internal Kubernetes

```text
worker pod
  -> cluster DNS
  -> camunda gateway service
  -> broker leader partition
```

Concerns:

1. Service DNS.
2. Gateway scaling.
3. Pod disruption.
4. Network policy.
5. mTLS/service mesh.
6. HTTP/2 support for gRPC.
7. Liveness/readiness.

### 24.3 External Enterprise Gateway

```text
app outside cluster
  -> corporate API gateway / ingress
  -> Camunda gateway
```

Concerns:

1. Header forwarding.
2. Timeout translation.
3. HTTP/2/gRPC pass-through.
4. Request body limits.
5. TLS termination.
6. Auth policy.
7. Observability trace propagation.

---

## 25. Java 21 Virtual Threads and Camunda Workers

Virtual threads can help IO-heavy workers, but they do not remove workflow correctness problems.

### 25.1 Where Virtual Threads Help

They help when worker code blocks on IO:

1. HTTP API call.
2. JDBC query.
3. File/object storage call.
4. Remote validation service.

### 25.2 Where They Do Not Help

They do not solve:

1. External system rate limits.
2. Non-idempotent side effects.
3. Job timeout misconfiguration.
4. Payload bloat.
5. Hot partitions.
6. Exporter lag.
7. Bad retry policy.
8. Database connection pool exhaustion.

### 25.3 Danger

With virtual threads, it becomes easy to create too much concurrency.

```text
maxJobsActive = 1000
virtual threads = cheap
external API limit = 50 rps
result = incident storm / rate limit / retry amplification
```

Rule:

```text
Concurrency must be limited by downstream capacity, not by Java thread cost.
```

### 25.4 Practical Pattern

```java
Semaphore downstreamLimit = new Semaphore(50);

@JobWorker(type = "call-external-registry")
public Map<String, Object> handle(ActivatedJob job) {
    if (!downstreamLimit.tryAcquire()) {
        throw new TemporaryCapacityException("External registry capacity exhausted");
    }
    try {
        return service.callExternalRegistry(job);
    } finally {
        downstreamLimit.release();
    }
}
```

Better yet, coordinate via worker config, rate limiter, and external capacity model.

---

## 26. Observability at Client Boundary

Every command and worker operation should include correlation fields.

### 26.1 Fields

```text
bpmnProcessId
processDefinitionKey
processInstanceKey
jobKey
jobType
workerName
tenantId
businessKey
correlationKey
messageName
commandName
camundaProtocol
camundaCluster
```

### 26.2 Logging Example

```java
log.info("Starting process: bpmnProcessId={}, businessKey={}",
        command.processId(),
        command.businessKey());
```

After result:

```java
log.info("Started process: bpmnProcessId={}, businessKey={}, processInstanceKey={}, version={}",
        result.bpmnProcessId(),
        result.businessKey(),
        result.processInstanceKey(),
        result.version());
```

### 26.3 Worker MDC

```java
try (MDC.MDCCloseable ignored1 = MDC.putCloseable("jobKey", String.valueOf(job.getKey()));
     MDC.MDCCloseable ignored2 = MDC.putCloseable("processInstanceKey", String.valueOf(job.getProcessInstanceKey()));
     MDC.MDCCloseable ignored3 = MDC.putCloseable("jobType", job.getType())) {
    handler.handle(job);
}
```

### 26.4 Metrics

At client boundary:

```text
workflow_command_duration_seconds{command="startProcess"}
workflow_command_failures_total{command="publishMessage", reason="timeout"}
workflow_worker_job_duration_seconds{jobType="validate-application"}
workflow_worker_job_failures_total{jobType="send-notification", failureType="transient"}
workflow_worker_bpmn_errors_total{jobType="assess-risk", errorCode="RISK_REJECTED"}
```

---

## 27. Security at Client Boundary

### 27.1 Worker Identity

Do not use one god credential for everything.

Better:

```text
worker-application-review
worker-notification
worker-payment
worker-document-verification
```

Each has:

1. Own client id/secret.
2. Own secret rotation.
3. Own access scope where possible.
4. Own audit trail.

### 27.2 Frontend Must Not Use Camunda Engine Credentials

Bad:

```text
Browser SPA -> Camunda gateway directly with engine credential
```

Risks:

1. Credential exposure.
2. Unauthorized command.
3. Bypass business authorization.
4. Hard audit.

Better:

```text
Browser SPA
  -> backend API with user auth
  -> authorization check
  -> workflow command adapter
  -> Camunda client
```

### 27.3 User Action vs System Action

When user completes task or triggers process action, preserve:

```text
actorUserId
actorRole
actorAgency
decisionTimestamp
sourceIp/sessionId if allowed
business reason
```

But do not dump full user profile into process variables.

---

## 28. Testing Client Integration

### 28.1 Unit Test Adapter

Mock client or wrap at boundary.

Better unit target:

```text
Application service -> ProcessOrchestrator mock
```

Not:

```text
mock every nested Camunda fluent API chain everywhere
```

Because fluent API mocking becomes fragile.

### 28.2 Contract Test Variable Mapping

```java
@Test
void shouldMapApplicationReviewStartVariables() {
    var command = new ApplicationReviewStartCommand(
            "APP-001",
            "USER-123",
            "NEW_LICENSE",
            Instant.parse("2026-06-20T00:00:00Z")
    );

    Map<String, Object> variables = mapper.toVariables(command);

    assertThat(variables)
            .containsEntry("applicationId", "APP-001")
            .containsEntry("applicantId", "USER-123")
            .containsEntry("applicationType", "NEW_LICENSE")
            .containsEntry("schemaVersion", 1);
}
```

### 28.3 Integration Test

Test real engine behavior:

1. Deploy BPMN.
2. Start process.
3. Activate job.
4. Complete job.
5. Assert next state.
6. Test failure path.
7. Test BPMN error path.
8. Test message correlation.

### 28.4 Migration Regression Test

Before migrating client:

```text
capture baseline behavior:
  - start process works
  - publish message works
  - worker activates job
  - worker completes job
  - worker fails job
  - worker throws BPMN error
  - timeout handling works
  - auth failure is mapped
```

After migration, same tests must pass.

---

## 29. Production Readiness Checklist

### 29.1 Client Version Checklist

```text
[ ] Approved Camunda client version documented
[ ] Compatibility with Camunda cluster version checked
[ ] Compatibility with Spring Boot version checked
[ ] Deprecated Zeebe/Spring Zeebe dependencies removed or justified
[ ] Dependency tree verified
[ ] Upgrade/removal timeline documented
```

### 29.2 Protocol Checklist

```text
[ ] REST/gRPC choice explicit
[ ] Network path tested
[ ] Timeout configured
[ ] TLS/mTLS config tested if applicable
[ ] API gateway/proxy behavior tested
[ ] gRPC HTTP/2 support validated if used
```

### 29.3 Worker Checklist

```text
[ ] maxJobsActive configured
[ ] job timeout configured
[ ] graceful shutdown tested
[ ] downstream capacity considered
[ ] idempotency implemented for side effects
[ ] failure mapping defined
[ ] BPMN error mapping defined
[ ] logs include processInstanceKey/jobKey/jobType
```

### 29.4 Auth Checklist

```text
[ ] No secrets in repository
[ ] Separate credentials per environment
[ ] Secret rotation path exists
[ ] Least privilege evaluated
[ ] Token failure tested
[ ] Frontend never receives engine credential
```

### 29.5 Migration Checklist

```text
[ ] Old imports scanned
[ ] Old properties scanned
[ ] Old dependency scanned
[ ] Adapter boundary introduced
[ ] Integration tests pass
[ ] Lower env canary completed
[ ] Rollback documented
```

---

## 30. Common Mistakes

### Mistake 1 — Treating Client Upgrade as Simple Dependency Bump

Client upgrade changes may affect:

1. Protocol default.
2. Package names.
3. Spring properties.
4. Error types.
5. Worker lifecycle.
6. Auth behavior.

Treat it as integration migration.

### Mistake 2 — Using `.join()` Everywhere

`.join()` is fine for simple examples, but production needs:

1. Timeout.
2. Error mapping.
3. Interrupt handling if using blocking get.
4. Backpressure awareness.

### Mistake 3 — Starting Process Without Idempotency

Duplicate starts are common under retry/network uncertainty.

Use business id + unique constraint + workflow link table.

### Mistake 4 — Letting SDK Types Leak Everywhere

Bad:

```java
public void approve(ActivatedJob job) { ... }
```

inside domain service.

Better:

```java
public ApprovalResult approve(ApprovalCommand command) { ... }
```

### Mistake 5 — Worker Concurrency Based on CPU Only

Worker concurrency must consider:

1. External API rate limit.
2. DB connection pool.
3. Process SLA.
4. Job timeout.
5. Retry storm risk.
6. Partition/job distribution.

### Mistake 6 — Not Making Protocol Explicit

If default changes, behavior changes silently.

Always configure intentionally.

---

## 31. Senior/Staff-Level Heuristics

1. **Client is an infrastructure dependency, not a domain dependency.**
2. **Protocol is an operational decision, not only a developer preference.**
3. **REST is often easier to govern; gRPC can be better for high-throughput internal worker paths.**
4. **Never put workflow SDK types into core domain model.**
5. **Every remote command needs timeout and error taxonomy.**
6. **Start process commands are not automatically idempotent.**
7. **Worker retry and command retry are different failure domains.**
8. **Java 21 virtual threads reduce thread cost, not downstream capacity cost.**
9. **Migration from ZeebeClient to CamundaClient should be adapter-level, not codebase-wide.**
10. **A Camunda client version is part of platform governance.**

---

## 32. Mini Reference Architecture

```text
+----------------------------+
| Business REST API          |
|                            |
|  ApplicationService        |
|      |                     |
|      v                     |
|  ProcessOrchestrator Port  |
+-------------|--------------+
              |
              v
+----------------------------+
| Camunda Adapter            |
|                            |
|  CamundaClient             |
|  ExceptionMapper           |
|  VariableMapper            |
|  TimeoutPolicy             |
|  Metrics/Tracing           |
+-------------|--------------+
              |
              v
+----------------------------+
| Camunda Gateway            |
|  REST and/or gRPC          |
+-------------|--------------+
              |
              v
+----------------------------+
| Zeebe Brokers/Partitions   |
+----------------------------+
```

Worker side:

```text
+----------------------------+
| Camunda Worker Adapter     |
|                            |
| @JobWorker / Worker API    |
| ActivatedJob               |
|      |                     |
|      v                     |
| JobVariableMapper          |
| JobErrorMapper             |
+-------------|--------------+
              |
              v
+----------------------------+
| Application Command Handler|
| Domain Service             |
| Repositories               |
| External Adapters          |
+----------------------------+
```

---

## 33. Practical ADR Template

```markdown
# ADR: Camunda Java Client Strategy

## Status
Accepted

## Context
We are integrating Java services with Camunda 8 orchestration cluster. Camunda client APIs are evolving from Zeebe Java Client/Spring Zeebe SDK to Camunda Java Client/Camunda Spring Boot Starter.

## Decision
- Use Camunda Java Client version `<version>`.
- Use Camunda Spring Boot Starter version `<version>` for Spring worker apps.
- Use REST as default protocol for command operations.
- Evaluate gRPC for high-throughput internal worker services.
- Encapsulate client usage behind `WorkflowCommandGateway` and worker adapter layer.
- Do not expose Camunda SDK types to domain services.

## Consequences
Positive:
- Easier migration across Camunda minor versions.
- Clear error handling and observability boundary.
- Less domain coupling.

Negative:
- More adapter code.
- Need maintain mapping layer.

## Validation
- Integration tests cover process start, message publish, job complete, job fail, BPMN error.
- Lower environment canary required before production.
```

---

## 34. What You Should Be Able to Explain After This Part

Setelah part ini, engineer harus bisa menjawab:

1. Apa beda `ZeebeClient` dan `CamundaClient` secara strategic?
2. Kenapa client migration tidak boleh dianggap dependency bump biasa?
3. Kenapa REST menjadi default modern, dan kapan gRPC tetap dipilih?
4. Bagaimana Java 8 legacy service bisa berinteraksi dengan Camunda 8 tanpa memaksa semua service upgrade sekaligus?
5. Kenapa SDK types tidak boleh bocor ke domain layer?
6. Bagaimana mendesain adapter untuk process start dan message publish?
7. Apa risiko retry create process instance?
8. Bagaimana worker completion mode memengaruhi error handling?
9. Apa saja field observability minimum untuk client/worker?
10. Bagaimana menyusun migration checklist dari Zeebe Java Client ke Camunda Java Client?

---

## 35. Summary

Part ini membangun fondasi integrasi Java modern untuk Camunda 8.

Intinya:

1. Camunda 8 Java client landscape sedang berevolusi dari Zeebe-centric menuju Camunda platform-centric.
2. Camunda Java Client dan Camunda Spring Boot Starter adalah arah modern untuk 8.8+.
3. REST menjadi default yang lebih enterprise-friendly, tetapi gRPC tetap penting untuk beberapa high-throughput/internal use case.
4. Java version strategy harus realistis: Java 8/11 untuk legacy, Java 17/21 untuk modern production, Java 25 untuk forward-looking setelah compatibility matang.
5. Client harus diisolasi di adapter boundary.
6. Worker harus tipis, idempotent, observable, dan memiliki error mapping eksplisit.
7. Command retry, job retry, BPMN error, dan incident adalah domain kegagalan yang berbeda.
8. Migration dari ZeebeClient ke CamundaClient harus direncanakan dengan inventory, tests, config migration, dan rollout strategy.

Jika part 000–004 membangun mental model engine dan BPMN runtime, part 005 membangun mental model **bagaimana aplikasi Java berbicara dengan engine secara aman, evolvable, dan production-grade**.

---

## 36. Preview Part Berikutnya

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-006.md
```

Judul:

```text
Part 006 — Building Production-Grade Java Job Workers
```

Fokus berikutnya:

1. Worker lifecycle.
2. Job activation.
3. maxJobsActive.
4. Timeout.
5. Backoff.
6. Concurrency.
7. Graceful shutdown.
8. Manual vs auto completion.
9. Worker observability.
10. Worker production template.

Status seri: **belum selesai**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-004.md">⬅️ Part 004 — BPMN Execution Semantics in Zeebe: What Actually Runs, Waits, and Persists</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-006.md">Part 006 — Building Production-Grade Java Job Workers ➡️</a>
</div>
