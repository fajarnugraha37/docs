# Part 17 — Lambda Java Fundamentals

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-17-lambda-java-fundamentals.md`  
Scope: Java 8 sampai Java 25, dengan fokus utama AWS Lambda managed runtime, AWS SDK for Java 2.x, dan desain production-grade.

> Tujuan bagian ini bukan membuat “Hello World Lambda”. Tujuan bagian ini adalah membentuk mental model yang benar tentang bagaimana Java code hidup di dalam AWS Lambda: kapan object dibuat, kapan environment dipakai ulang, apa yang aman disimpan di static field, bagaimana timeout bekerja, bagaimana retry terjadi, dan bagaimana membuat function yang predictable saat production.

---

## 1. Posisi Lambda dalam Arsitektur Java Modern

AWS Lambda adalah layanan compute berbasis function. Kita meng-upload code, memilih runtime, mengatur konfigurasi, lalu AWS menjalankan code tersebut saat ada event. Dalam konteks Java backend, Lambda bisa berperan sebagai:

1. event processor,
2. adapter ke managed service,
3. lightweight API endpoint,
4. scheduled job,
5. file processing worker,
6. integration glue,
7. asynchronous command handler,
8. operational automation,
9. validation/enrichment step,
10. bridge antara sistem enterprise dan AWS managed services.

Namun Lambda bukan pengganti universal untuk semua service Java. Lambda sangat kuat saat workload:

- event-driven,
- bursty,
- stateless atau mostly-stateless,
- punya batas waktu kerja jelas,
- bisa dipecah menjadi unit kecil,
- tidak membutuhkan long-running in-memory process,
- bisa menerima at-least-once invocation semantics,
- bisa diskalakan berdasarkan event source.

Lambda kurang cocok saat workload:

- membutuhkan proses berjalan terus-menerus tanpa trigger eksternal,
- memerlukan long-lived in-memory state,
- sangat sensitif terhadap cold start tanpa mitigation,
- membutuhkan connection pool besar dan stabil sepanjang waktu,
- membutuhkan kontrol rendah terhadap OS/network/runtime,
- butuh durasi eksekusi di luar batas Lambda standard,
- lebih natural dijalankan sebagai container service atau batch engine.

Mental model paling penting:

```text
Lambda bukan method call lokal.
Lambda adalah event-driven compute boundary yang hidup di dalam managed execution environment.
```

Artinya, Java handler yang terlihat seperti method biasa sebenarnya berada di balik beberapa boundary:

```text
Event source
  -> Lambda invoke service
      -> execution environment
          -> Java runtime
              -> handler method
                  -> AWS SDK / DB / HTTP / domain logic
```

Setiap boundary punya failure model, timeout, retry, concurrency, observability, dan security implication.

---

## 2. Lambda Bukan “Java Application Server Mini”

Developer Java sering salah membawa mental model Tomcat/Spring Boot service penuh ke Lambda.

Pada server tradisional:

```text
process starts once
  -> server opens port
  -> accepts many requests
  -> owns thread pool
  -> keeps running until stopped
```

Pada Lambda:

```text
AWS owns invocation routing
  -> runtime receives one invocation per environment at a time for normal synchronous Java invocation
  -> handler runs
  -> environment may be reused or discarded
```

Perbedaannya fundamental.

### 2.1 Pada service tradisional

Aplikasi Java biasanya:

- punya main method,
- membuka port,
- menjalankan embedded server,
- menerima request secara kontinu,
- mengatur thread pool sendiri,
- mempunyai lifecycle process yang relatif panjang,
- punya readiness/liveness endpoint,
- connection pool cenderung stabil,
- deployment unit hidup sebagai process/container.

### 2.2 Pada Lambda

Function Java biasanya:

- tidak membuka public server socket,
- tidak menerima request langsung dari client,
- menerima event dari Lambda runtime,
- dieksekusi oleh handler,
- berjalan dalam execution environment yang dikelola AWS,
- punya timeout eksplisit,
- bisa dihentikan saat timeout,
- bisa di-retry tergantung event source,
- bisa cold start saat environment baru dibuat,
- bisa warm start saat environment dipakai ulang.

### 2.3 Implikasi engineering

Karena Lambda bukan application server mini:

- jangan menganggap process selalu hidup,
- jangan mengandalkan in-memory state sebagai source of truth,
- jangan membuat expensive object di setiap invocation bila bisa dibuat di init phase,
- jangan membuka resource tanpa lifecycle strategy,
- jangan mengasumsikan hanya ada satu instance global function,
- jangan mengabaikan duplicate invocation,
- jangan membuat handler terlalu besar sampai menjadi “mini monolith tersembunyi”.

---

## 3. Java Runtime Support: Java 8 sampai Java 25

Seri ini mencakup Java 8 sampai Java 25. Untuk Lambda, ada dua hal yang perlu dibedakan:

1. Java language/runtime version yang kita gunakan untuk compile dan run.
2. Lambda managed runtime yang disediakan AWS.

AWS Lambda mendukung Java melalui managed runtime berbasis Amazon Corretto untuk versi tertentu. AWS juga memungkinkan container image dan custom runtime untuk kebutuhan yang tidak cocok dengan managed runtime.

Secara praktis:

- Java 8 masih banyak ditemukan di enterprise legacy.
- Java 11 pernah menjadi baseline modern awal.
- Java 17 menjadi baseline LTS yang kuat.
- Java 21 membawa banyak peningkatan runtime modern.
- Java 25 tersedia sebagai runtime Lambda modern berdasarkan Amazon Corretto menurut pengumuman AWS 2025.

Rujukan resmi yang perlu selalu dicek sebelum production:

- AWS Lambda runtimes: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
- Building Lambda functions with Java: https://docs.aws.amazon.com/lambda/latest/dg/lambda-java.html
- AWS Lambda now supports Java 25: https://aws.amazon.com/blogs/compute/aws-lambda-now-supports-java-25/

### 3.1 Jangan menyamakan “Java supported by compiler” dengan “Java supported by Lambda managed runtime”

Kita bisa compile Java dengan banyak target, tetapi Lambda managed runtime hanya menyediakan runtime tertentu. Bila ingin menggunakan versi Java yang belum atau tidak tersedia sebagai managed runtime, pilihannya adalah:

- container image,
- custom runtime,
- atau downgrade target bytecode/runtime.

### 3.2 Rule praktis pemilihan Java version

Untuk sistem production baru:

```text
Default modern choice: Java 21 atau Java 25 jika organisasi/runtime/lifecycle sudah siap.
Conservative enterprise choice: Java 17 atau Java 21.
Legacy compatibility: Java 8 hanya bila ada constraint kuat.
```

Namun pilihan final harus memperhitungkan:

- runtime lifecycle AWS,
- dependency compatibility,
- build pipeline,
- security patching,
- cold start profile,
- SnapStart/provisioned concurrency strategy,
- observability agent compatibility,
- base image jika memakai container.

---

## 4. The Most Important Mental Model: Execution Environment

Lambda menjalankan function di dalam execution environment. Execution environment adalah lingkungan runtime isolated yang berisi:

- runtime bahasa,
- code function,
- dependencies,
- environment variables,
- temporary storage `/tmp`,
- AWS credentials dari execution role,
- runtime API integration,
- network configuration,
- extension jika ada.

Execution environment bisa dibuat, digunakan untuk satu atau banyak invocation, lalu dihentikan.

Mental model sederhananya:

```text
Function version/configuration
  -> AWS creates execution environment
      -> init Java runtime and function code
      -> invoke handler for event A
      -> maybe reuse same environment
      -> invoke handler for event B
      -> maybe freeze/thaw or shutdown later
```

AWS documentation membahas lifecycle execution environment dengan fase seperti init, invoke, dan shutdown. Untuk SnapStart, ada juga restore phase. Rujukan: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html

---

## 5. Lifecycle: Init, Invoke, Shutdown, and Restore

Lifecycle Lambda sangat penting karena menentukan di mana kita menaruh initialization logic.

## 5.1 Init phase

Init phase terjadi saat execution environment baru dibuat sebelum handler memproses invocation pertama.

Pada Java, init phase bisa mencakup:

- class loading,
- static initializer,
- constructor handler,
- dependency initialization,
- AWS SDK client creation,
- JSON mapper creation,
- loading config,
- warming internal caches,
- opening DB connection pool,
- loading certificates,
- initializing telemetry.

Contoh:

```java
public final class OrderHandler implements RequestHandler<OrderEvent, OrderResult> {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final S3Client S3 = S3Client.builder().build();

    public OrderHandler() {
        // Constructor may run during init phase.
    }

    @Override
    public OrderResult handleRequest(OrderEvent event, Context context) {
        // Invocation logic.
        return process(event, context);
    }
}
```

Object `OBJECT_MAPPER` dan `S3` dibuat di luar handler agar bisa dipakai ulang antar invocation dalam execution environment yang sama.

AWS best practice juga menganjurkan reuse execution environment dan inisialisasi SDK clients/database connection di luar handler untuk mengurangi durasi function. Rujukan: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

## 5.2 Invoke phase

Invoke phase adalah saat handler menerima event.

Pada invoke phase, kita harus:

- parse/validate event,
- menjalankan domain logic,
- memanggil dependency eksternal,
- menulis output/result,
- mencatat log/metric/tracing,
- menangani error sesuai event source.

Invoke phase harus cepat, bounded, dan idempotent.

## 5.3 Shutdown phase

Shutdown phase terjadi saat Lambda menghentikan execution environment. Kita tidak boleh mengandalkan shutdown untuk business-critical operation.

Jangan menaruh logic seperti ini hanya di shutdown:

- commit transaksi penting,
- publish event final,
- flush audit mandatory,
- delete lock,
- release domain reservation.

Kenapa? Karena shutdown timing tidak boleh menjadi bagian dari correctness bisnis. Treat shutdown as best-effort cleanup, not business workflow.

## 5.4 Restore phase

Untuk fitur seperti SnapStart, AWS dapat mengambil snapshot initialized environment lalu restore saat invocation. Ini mengubah mental model init karena state setelah init bisa di-snapshot dan dipakai ulang dari snapshot.

Konsekuensi:

- data unik yang dibuat saat init bisa menjadi tidak unik setelah restore,
- koneksi network yang dibuat sebelum snapshot mungkin perlu divalidasi ulang,
- random seed, token, timestamp, cache, dan credential harus dipikirkan ulang,
- resource external harus restore-safe.

SnapStart akan dibahas lebih dalam di Part 18. Untuk Part 17, cukup pahami bahwa lifecycle Java Lambda tidak selalu sekadar cold init lalu invoke; ada mode optimasi lifecycle yang mengubah asumsi initialization.

---

## 6. Cold Start and Warm Start

Cold start terjadi saat Lambda perlu membuat execution environment baru sebelum invocation bisa diproses.

Warm start terjadi saat invocation diproses oleh execution environment yang sudah ada.

### 6.1 Cold start Java biasanya lebih terasa

Java cold start bisa lebih berat dibanding runtime ringan karena:

- JVM startup,
- class loading,
- dependency graph besar,
- framework initialization,
- reflection scanning,
- JSON mapper initialization,
- AWS SDK module loading,
- logging/telemetry initialization,
- dependency injection container startup.

### 6.2 Warm start bukan guarantee

Warm start adalah optimization, bukan contract.

Jangan membuat logic yang bergantung pada warm start:

```text
Salah:
Saya simpan progress job di static Map karena kemungkinan environment warm.
```

Correct mental model:

```text
Static/cache boleh dipakai untuk performance optimization.
State of truth harus berada di durable external store.
```

### 6.3 Cold start bukan hanya latency problem

Cold start juga memengaruhi:

- cost,
- concurrency burst,
- downstream connection spike,
- SDK client creation storm,
- secret/config retrieval spike,
- KMS/Secrets throttling,
- database connection surge,
- observability initialization noise.

Karena itu cold start harus dipikirkan sebagai system behavior, bukan sekadar angka latency.

---

## 7. Handler Model in Java

Java Lambda handler adalah entry point yang dipanggil runtime.

Ada beberapa bentuk umum:

1. Implement `RequestHandler<I, O>`.
2. Implement `RequestStreamHandler`.
3. Plain method handler dengan signature tertentu.

AWS documentation menjelaskan cara mendefinisikan Java handler di sini: https://docs.aws.amazon.com/lambda/latest/dg/java-handler.html

---

## 8. `RequestHandler<I, O>`

`RequestHandler` adalah model paling nyaman untuk event yang bisa dimapping ke POJO.

Contoh:

```java
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;

public final class OrderHandler implements RequestHandler<OrderEvent, OrderResult> {

    @Override
    public OrderResult handleRequest(OrderEvent event, Context context) {
        validate(event);
        return new OrderResult("ACCEPTED", event.orderId());
    }
}
```

### 8.1 Kapan cocok

Gunakan `RequestHandler` saat:

- payload relatif kecil,
- event shape stabil,
- POJO mapping jelas,
- tidak butuh kontrol penuh terhadap stream input/output,
- function bukan binary streaming endpoint,
- ingin kode lebih mudah dites.

### 8.2 Kelebihan

- sederhana,
- type-friendly,
- mudah unit test,
- cocok untuk SQS/SNS/EventBridge/API Gateway event model,
- cocok untuk domain DTO.

### 8.3 Risiko

- hidden JSON mapping behavior,
- memory overhead untuk payload besar,
- sulit untuk streaming besar,
- error mapping bisa membingungkan bila POJO tidak cocok.

---

## 9. `RequestStreamHandler`

`RequestStreamHandler` memberi akses langsung ke `InputStream` dan `OutputStream`.

Contoh:

```java
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestStreamHandler;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public final class StreamingHandler implements RequestStreamHandler {

    @Override
    public void handleRequest(InputStream input, OutputStream output, Context context) throws IOException {
        // Parse input manually, write output manually.
        byte[] response = "{\"status\":\"ok\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        output.write(response);
    }
}
```

### 9.1 Kapan cocok

Gunakan `RequestStreamHandler` saat:

- perlu kontrol penuh serialization/deserialization,
- payload besar,
- ingin mengurangi object mapping overhead,
- membuat adapter generic,
- ingin custom JSON parser,
- output perlu ditulis langsung.

### 9.2 Trade-off

`RequestStreamHandler` lebih fleksibel tetapi lebih raw. Kita harus mengelola parsing, validation, error response, dan serialization sendiri.

---

## 10. Plain Method Handler

Lambda juga bisa memakai method tertentu sebagai handler tanpa implement interface. Namun untuk sistem production, interface eksplisit sering lebih mudah dibaca, dites, dan distandarisasi.

Contoh signature style:

```java
public final class Handler {
    public Output handleRequest(Input input, Context context) {
        return new Output("ok");
    }
}
```

Untuk tim besar, pilih satu standard:

```text
Default: RequestHandler<I, O>
Special case: RequestStreamHandler
Avoid: many inconsistent plain method signatures
```

---

## 11. The `Context` Object

`Context` memberi metadata runtime invocation.

Contoh informasi yang tersedia:

- AWS request ID,
- function name,
- function version,
- invoked function ARN,
- memory limit,
- remaining time,
- logger,
- log group,
- log stream.

Rujukan: https://docs.aws.amazon.com/lambda/latest/dg/java-context.html

Contoh:

```java
@Override
public OrderResult handleRequest(OrderEvent event, Context context) {
    String requestId = context.getAwsRequestId();
    int remainingMs = context.getRemainingTimeInMillis();

    if (remainingMs < 1_000) {
        throw new IllegalStateException("Not enough time to safely process requestId=" + requestId);
    }

    return process(event, requestId);
}
```

### 11.1 Gunakan remaining time untuk safety

`getRemainingTimeInMillis()` penting untuk menghindari function mati di tengah operasi kritis.

Contoh policy:

```text
If remaining time < safety threshold:
  do not start new external operation
  fail safely
  let event source retry if appropriate
```

Untuk SQS consumer Lambda, ini bisa mencegah function timeout setelah memproses sebagian batch tapi sebelum mengembalikan partial batch response.

---

## 12. Event Shape: Jangan Campur Event DTO dengan Domain Model

Kesalahan umum adalah memakai event DTO sebagai domain object.

Contoh buruk:

```text
S3EventNotification directly used as business document model
```

Lebih baik:

```text
AWS event DTO
  -> adapter/parser
      -> command/domain input
          -> application service
```

Contoh struktur:

```java
public final class S3DocumentIngestHandler implements RequestHandler<S3Event, IngestResult> {

    private final IngestApplicationService service = Bootstrap.service();

    @Override
    public IngestResult handleRequest(S3Event event, Context context) {
        List<IngestCommand> commands = S3EventMapper.toCommands(event, context.getAwsRequestId());
        return service.ingest(commands);
    }
}
```

Boundary yang benar:

```text
Lambda handler = adapter layer
Application service = business orchestration
Domain model = independent from AWS event shape
AWS SDK client = infrastructure dependency
```

Ini membuat code lebih testable dan lebih mudah migrasi kalau event source berubah dari S3 direct ke SQS-wrapped S3 event.

---

## 13. Packaging Java Lambda

Java Lambda biasanya dikirim sebagai:

1. ZIP/JAR deployment package,
2. shaded/fat JAR,
3. container image.

### 13.1 Thin JAR vs fat JAR

Dalam Lambda, deployment package harus membawa dependency yang dibutuhkan. Karena itu fat JAR/shaded JAR sering digunakan.

Namun fat JAR besar punya konsekuensi:

- upload lebih lambat,
- cold start lebih berat,
- classpath lebih besar,
- dependency conflict lebih sulit dideteksi,
- package scanning lebih mahal,
- vulnerability surface lebih besar.

Rule praktis:

```text
Lambda package should be as small as reasonably possible,
but not at the cost of fragile dependency management.
```

### 13.2 Maven Shade Plugin example

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-shade-plugin</artifactId>
      <version>3.6.0</version>
      <executions>
        <execution>
          <phase>package</phase>
          <goals>
            <goal>shade</goal>
          </goals>
          <configuration>
            <createDependencyReducedPom>false</createDependencyReducedPom>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

### 13.3 Gradle Shadow example

```kotlin
plugins {
    java
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

tasks.shadowJar {
    archiveClassifier.set("all")
}
```

### 13.4 Container image

Container image cocok saat:

- dependency native besar,
- butuh custom OS package,
- ingin standardisasi container pipeline,
- ingin runtime Java tertentu,
- butuh deployment artifact lebih dari ZIP limit,
- ingin menyamakan local/prod packaging.

Namun container image bukan otomatis lebih cepat. Image size, layer design, runtime startup, dan dependency tetap memengaruhi cold start.

---

## 14. Dependency Strategy for Java Lambda

Dependency yang buruk adalah cold start multiplier.

### 14.1 Hindari dependency graph yang tidak perlu

Contoh keputusan:

```text
Need only S3 putObject?
Use software.amazon.awssdk:s3
Do not import full AWS SDK bundle.
```

AWS SDK v2 modular. Gunakan service module spesifik.

Contoh Maven:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>2.x.x</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>s3</artifactId>
  </dependency>
  <dependency>
    <groupId>com.amazonaws</groupId>
    <artifactId>aws-lambda-java-core</artifactId>
    <version>1.2.3</version>
  </dependency>
  <dependency>
    <groupId>com.amazonaws</groupId>
    <artifactId>aws-lambda-java-events</artifactId>
    <version>3.14.0</version>
  </dependency>
</dependencies>
```

Catatan: cek versi terbaru saat implementasi production.

### 14.2 Framework decision

Spring Boot bisa berjalan di Lambda, tetapi jangan otomatis membawa full Boot app ke semua function.

Pilihan spektrum:

```text
Plain Java handler
  -> light DI/manual composition
      -> Micronaut/Quarkus/Spring Cloud Function
          -> full Spring Boot style function
```

Semakin berat framework:

- developer productivity naik,
- cold start bisa naik,
- memory footprint bisa naik,
- debugging lifecycle lebih kompleks,
- packaging lebih besar.

Untuk function kecil, plain Java sering cukup. Untuk platform enterprise yang butuh consistency, DI ringan atau framework serverless-aware bisa masuk akal.

---

## 15. Static Fields: Powerful but Dangerous

Static fields di Java Lambda sering digunakan untuk reuse.

Contoh baik:

```java
private static final S3Client S3 = S3Client.builder().build();
private static final ObjectMapper MAPPER = new ObjectMapper();
private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_OFFSET_DATE_TIME;
```

Contoh berbahaya:

```java
private static final Map<String, OrderState> IN_MEMORY_ORDER_STATE = new HashMap<>();
private static String currentUserId;
private static int processedCountForBusinessDecision;
```

### 15.1 Static field boleh untuk

- SDK client,
- immutable config,
- serializer/deserializer,
- compiled regex,
- static lookup table,
- thread-safe cache dengan bounded size,
- metric/logger handle,
- connection pool dengan lifecycle strategy.

### 15.2 Static field tidak boleh untuk

- source of truth bisnis,
- request-specific mutable state,
- user/session data,
- mutable data tanpa thread-safety,
- state yang correctness-nya bergantung pada warm start,
- lock antar invocation global,
- counter bisnis yang harus akurat.

### 15.3 Warm state leakage

Karena environment bisa dipakai ulang, bug state leakage bisa terjadi.

Contoh buruk:

```java
public final class BadHandler implements RequestHandler<Request, Response> {

    private static String tenantId;

    @Override
    public Response handleRequest(Request request, Context context) {
        tenantId = request.tenantId();
        return doWork();
    }

    private Response doWork() {
        return new Response("processed tenant " + tenantId);
    }
}
```

Walaupun satu execution environment biasanya memproses satu invocation pada satu waktu, mutable static request state tetap buruk karena:

- membingungkan,
- tidak testable,
- rawan bila ada background thread,
- rawan bila kode berubah,
- rawan leakage antar invocation,
- tidak aman untuk future runtime/architecture changes.

Lebih baik pass context eksplisit:

```java
@Override
public Response handleRequest(Request request, Context context) {
    RequestScope scope = new RequestScope(request.tenantId(), context.getAwsRequestId());
    return service.process(request, scope);
}
```

---

## 16. AWS SDK Client Lifecycle in Lambda

AWS menganjurkan reuse SDK clients di luar handler. Ini menghindari biaya setup client/connection berulang. Rujukan: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

Contoh:

```java
public final class ReceiptHandler implements RequestHandler<OrderEvent, Void> {

    private static final S3Client S3 = S3Client.builder().build();

    @Override
    public Void handleRequest(OrderEvent event, Context context) {
        S3.putObject(request(event), RequestBody.fromString(renderReceipt(event)));
        return null;
    }
}
```

### 16.1 Jangan buat client per invocation

Buruk:

```java
@Override
public Void handleRequest(Event event, Context context) {
    S3Client s3 = S3Client.builder().build();
    s3.putObject(...);
    return null;
}
```

Masalah:

- overhead CPU,
- cold/warm invocation lebih lambat,
- connection reuse hilang,
- lebih banyak object allocation,
- lebih sulit tuning HTTP client.

### 16.2 Tapi jangan lupa resource semantics

Di Lambda, static SDK client biasanya dibiarkan hidup selama environment hidup. Jangan close per invocation. Jika memakai custom HTTP client, async client, background executor, atau resource khusus, pahami lifecycle-nya.

Rule:

```text
Create expensive reusable clients during init.
Do not close them after each invocation.
Do not depend on shutdown for business correctness.
```

---

## 17. Environment Variables

Environment variables adalah konfigurasi deployment-time. Cocok untuk:

- bucket name,
- queue URL,
- topic ARN,
- table name,
- feature flag sederhana,
- log level,
- environment name,
- config path,
- region override jika diperlukan.

Tidak cocok untuk:

- secret plaintext jangka panjang,
- credential AWS static,
- large config blob,
- dynamic frequently changing config,
- tenant-specific mutable data.

Contoh:

```java
public final class Config {
    public static final String RECEIPT_BUCKET = requiredEnv("RECEIPT_BUCKET");

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }
        return value;
    }
}
```

### 17.1 Fail fast for mandatory config

Mandatory config sebaiknya divalidasi saat init agar function gagal cepat dan jelas.

Namun untuk config yang berasal dari remote service seperti Secrets Manager/SSM, keputusan perlu lebih hati-hati:

- load saat init untuk fail-fast,
- lazy load untuk mengurangi cold start,
- cache refresh untuk dynamic config.

Tidak ada satu jawaban universal. Pilih berdasarkan criticality dan failure behavior.

---

## 18. `/tmp` Temporary Storage

Lambda menyediakan temporary storage di `/tmp`. AWS best practice menyebut `/tmp` bisa digunakan untuk cache static assets antar invocation dalam execution environment yang sama. Rujukan: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

Gunakan `/tmp` untuk:

- temporary file processing,
- downloaded model/config kecil,
- intermediate artifact,
- decompression,
- staging file sebelum upload,
- cache best-effort.

Jangan gunakan `/tmp` sebagai:

- durable storage,
- source of truth,
- cross-function sharing,
- guaranteed cache,
- security boundary permanen.

### 18.1 `/tmp` warm reuse

File di `/tmp` bisa tetap ada saat environment reused. Ini berguna untuk cache, tetapi rawan leakage.

Rule:

```text
Assume /tmp may contain files from previous invocation in same environment.
Assume /tmp may be empty at any time from business perspective.
```

### 18.2 File naming

Gunakan request-specific directory:

```java
Path workDir = Path.of("/tmp", "work-" + context.getAwsRequestId());
Files.createDirectories(workDir);
```

Hapus best-effort setelah selesai:

```java
try {
    process(workDir);
} finally {
    deleteRecursivelyBestEffort(workDir);
}
```

Untuk data sensitif, jangan mengandalkan delete biasa sebagai sanitization kuat. Lebih baik hindari menulis secret/plain sensitive payload ke disk bila tidak perlu.

---

## 19. Memory, CPU, and Timeout

Lambda memory setting bukan hanya memory. Memory allocation memengaruhi resource CPU yang tersedia. Semakin besar memory, biasanya semakin besar CPU share yang didapat.

Artinya tuning memory bisa menurunkan latency dan kadang menurunkan cost total karena execution duration turun.

### 19.1 Timeout

Timeout adalah batas keras durasi invocation. Jika function melewati timeout, execution dihentikan.

Desain handler harus mempertimbangkan:

- timeout Lambda,
- timeout AWS SDK call,
- timeout downstream HTTP/DB,
- visibility timeout SQS,
- API Gateway timeout,
- client timeout,
- retry policy event source.

Invariant:

```text
Downstream operation timeout must be less than Lambda remaining time.
Lambda timeout must align with event source retry/visibility behavior.
```

Contoh buruk:

```text
Lambda timeout: 30s
HTTP client timeout: 60s
```

Ini buruk karena Lambda bisa mati sebelum HTTP client punya kesempatan gagal dan menjalankan cleanup/error handling.

Contoh lebih baik:

```text
Lambda timeout: 30s
API call timeout: 20s
attempt timeout: 5s
safety margin: 2s
handler stops starting new work if remaining < 3s
```

### 19.2 Use remaining time guard

```java
private static void ensureTime(Context context, int minimumMillis, String operation) {
    int remaining = context.getRemainingTimeInMillis();
    if (remaining < minimumMillis) {
        throw new IllegalStateException(
            "Not enough time for " + operation + ", remainingMillis=" + remaining
        );
    }
}
```

---

## 20. Invocation Types and Retry Semantics

Lambda bisa dipanggil secara:

1. synchronous,
2. asynchronous,
3. poll-based event source mapping.

Retry behavior berbeda tergantung sumber invocation. Ini sangat penting.

---

## 21. Synchronous Invocation

Contoh synchronous invocation:

- API Gateway,
- Application Load Balancer,
- direct `Invoke` dengan `RequestResponse`,
- beberapa service integration yang menunggu response.

Behavior:

- caller menunggu response,
- error dikembalikan ke caller,
- retry biasanya tanggung jawab caller,
- latency user-facing penting,
- response shape penting.

Design consequence:

- timeout lebih pendek,
- response harus deterministic,
- error mapping harus jelas,
- jangan memproses pekerjaan panjang langsung,
- gunakan async handoff untuk heavy work.

Pattern:

```text
API request
  -> Lambda validates
  -> enqueue command to SQS/EventBridge
  -> return 202 Accepted
```

---

## 22. Asynchronous Invocation

Contoh asynchronous invocation:

- SNS to Lambda,
- S3 event to Lambda,
- EventBridge to Lambda,
- direct `Invoke` dengan `Event`.

Behavior umum:

- event diterima Lambda service,
- Lambda menjalankan function asynchronously,
- retry bisa dilakukan oleh Lambda/service,
- failure bisa dikirim ke destination atau DLQ tergantung konfigurasi,
- duplicate invocation mungkin terjadi.

Design consequence:

- handler harus idempotent,
- event harus punya correlation/idempotency key,
- failure harus observable,
- jangan menganggap event hanya diproses sekali,
- jangan mengandalkan ordering kecuali event source menjamin dan konfigurasi mendukung.

---

## 23. Poll-Based Event Source Mapping

Contoh:

- SQS,
- DynamoDB Streams,
- Kinesis.

Lambda service melakukan polling dari source lalu memanggil function dengan batch records.

Design consequence:

- batch failure semantics penting,
- partial batch response bisa penting,
- visibility timeout/checkpointing penting,
- concurrency dikontrol event source mapping,
- poison message bisa menahan progress,
- ordering bisa terpengaruh batch/error strategy.

Untuk SQS, Lambda menerima batch message. Jika function gagal total, message bisa kembali visible setelah visibility timeout dan diproses lagi. Karena itu handler harus idempotent dan harus memahami partial failure.

---

## 24. Idempotency is Not Optional

Lambda harus dianggap bisa menerima event yang sama lebih dari sekali.

Penyebab duplicate:

- retry event source,
- timeout setelah side effect berhasil,
- network failure setelah response,
- batch partial failure,
- SQS at-least-once delivery,
- async retry,
- manual replay,
- operator redrive DLQ.

### 24.1 Idempotency key

Sumber idempotency key bisa:

- event ID,
- business command ID,
- order ID + action,
- S3 bucket + key + version ID,
- SQS message deduplication ID,
- EventBridge event ID,
- client-generated request ID.

### 24.2 Idempotency store

Store bisa:

- DynamoDB,
- relational DB,
- Redis dengan TTL,
- domain table unique constraint,
- S3 object marker untuk workflow tertentu.

### 24.3 Idempotent handler shape

```text
receive event
  -> derive idempotency key
  -> acquire/process marker atomically
  -> perform side effect
  -> mark success
  -> return success if already processed
```

Pseudo Java:

```java
public Result handleRequest(Event event, Context context) {
    String key = Idempotency.keyOf(event);

    IdempotencyStatus status = store.tryStart(key);
    if (status == IdempotencyStatus.ALREADY_SUCCEEDED) {
        return Result.alreadyProcessed(key);
    }
    if (status == IdempotencyStatus.IN_PROGRESS) {
        throw new RetryableConflictException(key);
    }

    try {
        Result result = service.process(event);
        store.markSucceeded(key);
        return result;
    } catch (Exception e) {
        store.markFailedIfRetryable(key, e);
        throw e;
    }
}
```

---

## 25. Handler as Adapter, Not Business God Class

Buruk:

```java
public final class Handler implements RequestHandler<Map<String, Object>, Map<String, Object>> {
    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        // parse event
        // validate tenant
        // query DB
        // call S3
        // calculate business rule
        // publish SNS
        // build response
        // handle all errors
    }
}
```

Lebih baik:

```text
Handler
  -> EventMapper
  -> ApplicationService
  -> DomainService
  -> Repository/Gateway
  -> ResultMapper
```

Contoh:

```java
public final class CaseEscalationHandler implements RequestHandler<EventBridgeEvent, EscalationResult> {

    private static final App APP = App.bootstrap();

    @Override
    public EscalationResult handleRequest(EventBridgeEvent event, Context context) {
        RequestContext requestContext = RequestContext.from(context);
        EscalationCommand command = APP.eventMapper().toEscalationCommand(event, requestContext);
        return APP.caseEscalationService().handle(command, requestContext);
    }
}
```

Keuntungan:

- handler tipis,
- domain logic testable tanpa Lambda,
- event source bisa diganti,
- AWS-specific code terisolasi,
- audit/correlation lebih konsisten,
- failure behavior lebih mudah dimodelkan.

---

## 26. Bootstrap Pattern for Java Lambda

Karena tidak selalu memakai DI framework, bootstrap manual sering efektif.

```java
public final class App {

    private final CaseEscalationService caseEscalationService;
    private final EventMapper eventMapper;

    private App(CaseEscalationService caseEscalationService, EventMapper eventMapper) {
        this.caseEscalationService = caseEscalationService;
        this.eventMapper = eventMapper;
    }

    public static App bootstrap() {
        S3Client s3 = S3Client.builder().build();
        SqsClient sqs = SqsClient.builder().build();
        ObjectMapper mapper = new ObjectMapper();

        CaseRepository repository = new DynamoDbCaseRepository(...);
        AuditPublisher auditPublisher = new SqsAuditPublisher(sqs, Config.AUDIT_QUEUE_URL);
        CaseEscalationService service = new CaseEscalationService(repository, auditPublisher);

        return new App(service, new EventMapper(mapper));
    }

    public CaseEscalationService caseEscalationService() {
        return caseEscalationService;
    }

    public EventMapper eventMapper() {
        return eventMapper;
    }
}
```

Handler:

```java
public final class Handler implements RequestHandler<Event, Result> {

    private static final App APP = App.bootstrap();

    @Override
    public Result handleRequest(Event event, Context context) {
        return APP.caseEscalationService().handle(APP.eventMapper().map(event), RequestContext.from(context));
    }
}
```

This pattern gives:

- explicit dependencies,
- cold start control,
- no hidden framework scan,
- reusable test composition,
- clear boundary.

---

## 27. Logging in Java Lambda

Logging minimal yang buruk:

```java
System.out.println("processing");
```

Logging yang lebih baik:

```text
timestamp, level, awsRequestId, correlationId, eventType, businessKey, operation, result, durationMs
```

Contoh structured-ish log tanpa framework:

```java
private static void logInfo(Context context, String message, Map<String, Object> fields) {
    System.out.println(JsonLog.of("INFO", message)
        .put("awsRequestId", context.getAwsRequestId())
        .putAll(fields)
        .toJson());
}
```

### 27.1 Jangan log secret/payload penuh

Hindari:

- full event body yang berisi PII,
- Authorization header,
- secret value,
- presigned URL penuh,
- KMS plaintext,
- database password,
- large payload.

Log yang baik menjawab:

- invocation mana?
- event apa?
- business key mana?
- dependency apa yang dipanggil?
- berapa latency?
- retry berapa kali?
- gagal karena apa?
- bisa direplay atau tidak?

---

## 28. Metrics for Lambda Java

Minimal metrics:

- invocation count,
- error count,
- duration,
- timeout count,
- cold start count,
- downstream latency,
- downstream error count,
- retry count,
- throttling count,
- idempotency hit,
- DLQ publish count,
- processed record count,
- failed record count.

CloudWatch memberi beberapa metric built-in, tetapi application metric tetap perlu.

Untuk Java, pertimbangkan:

- Embedded Metric Format,
- AWS Lambda Powertools for Java,
- OpenTelemetry metrics,
- custom CloudWatch metric bila perlu.

Part 6 sudah membahas observability umum; di Lambda, tambahkan dimensi:

```text
functionName
functionVersion
alias
coldStart
eventSource
operation
result
```

---

## 29. Error Handling Strategy

Error handling Lambda harus disesuaikan dengan event source.

### 29.1 Synchronous API

Untuk API Gateway:

```text
Validation error -> 400
Unauthorized -> 401/403
Not found -> 404
Conflict/idempotency conflict -> 409
Downstream unavailable -> 503
Unexpected -> 500
```

Jangan lempar raw stacktrace ke client.

### 29.2 Asynchronous event

Untuk async event:

```text
Non-retryable bad event -> mark failed / send to failure destination / DLQ
Retryable downstream error -> throw to trigger retry
Duplicate event -> return success
Partial failure -> report partial failure if supported
```

### 29.3 SQS batch

Untuk SQS batch, keputusan penting:

- fail whole batch,
- delete successful and fail failed manually,
- use partial batch response.

Modern approach untuk banyak kasus:

```text
Process records independently.
Return partial batch failure for failed message IDs.
Ensure successful records are not retried unnecessarily.
```

Detail akan dibahas di Part 19.

---

## 30. Concurrency Model

Lambda scales by creating multiple execution environments. Untuk Java handler biasa, satu execution environment memproses satu invocation pada satu waktu. Tetapi secara global, banyak environment bisa berjalan paralel.

Mental model:

```text
Concurrency 100
  -> roughly up to 100 concurrent execution environments/invocations
  -> each may have its own static clients/cache/tmp
```

Implication:

- static cache bukan global cache,
- in-memory lock tidak mengunci seluruh system,
- DB connection count bisa melonjak per environment,
- downstream quota bisa terkena burst,
- idempotency harus external/durable,
- rate limiting harus global jika perlu.

### 30.1 Reserved concurrency

Reserved concurrency membatasi concurrency function. Berguna untuk:

- melindungi database,
- melindungi downstream API,
- memberi capacity guarantee,
- mencegah runaway cost,
- isolasi antar function.

### 30.2 Provisioned concurrency

Provisioned concurrency menjaga environment siap untuk mengurangi cold start. Cocok untuk:

- latency-sensitive API,
- predictable traffic window,
- Java function dengan cold start mahal,
- enterprise API dengan SLO ketat.

---

## 31. Database Connections in Lambda

Lambda + database connection harus hati-hati.

Masalah umum:

```text
High Lambda concurrency -> many execution environments -> many connection pools -> database exhausted
```

Jika setiap environment membuat Hikari pool 10 connection dan concurrency 100:

```text
potential DB connections = 100 * 10 = 1000
```

Ini bisa menghancurkan database.

### 31.1 Rule praktis

Untuk Lambda:

- jangan default Hikari maximumPoolSize besar,
- gunakan pool kecil bila perlu,
- pertimbangkan RDS Proxy,
- pertimbangkan DynamoDB/SQS/S3 untuk serverless-native state,
- batasi reserved concurrency,
- close per-invocation connection jika workload jarang dan overhead acceptable,
- monitor DB connection count.

### 31.2 Lambda bukan tempat ideal untuk long transaction

Hindari:

- transaksi panjang,
- lock DB lama,
- polling DB intensif,
- batch besar dalam satu invocation,
- nested distributed transaction.

---

## 32. Networking: VPC or Not VPC

Lambda bisa berjalan dengan atau tanpa VPC attachment.

Gunakan VPC saat perlu akses:

- private RDS,
- internal service,
- private subnet resource,
- VPC endpoint,
- internal cache.

Tanpa VPC sering lebih sederhana untuk akses managed public AWS service, tetapi security/network architecture bisa mengharuskan VPC endpoint.

### 32.1 VPC endpoint

Untuk regulated/private architecture, akses ke layanan AWS seperti S3, SQS, SNS, Secrets Manager, STS, KMS sering diarahkan melalui VPC endpoint.

Manfaat:

- traffic tidak perlu keluar internet publik,
- policy bisa dibatasi via endpoint,
- network path lebih controlled,
- governance lebih kuat.

### 32.2 DNS and timeout

Di Lambda VPC, masalah umum:

- DNS resolution,
- NAT gateway dependency,
- security group egress,
- route table salah,
- VPC endpoint policy menolak,
- SDK timeout terlalu panjang.

Selalu set timeout SDK eksplisit seperti dibahas di Part 4.

---

## 33. Security Model

Setiap Lambda punya execution role. Role ini menentukan apa yang boleh dilakukan function.

Rule:

```text
One function/capability should have the minimum role needed for that capability.
```

Hindari:

- role shared terlalu luas,
- `AdministratorAccess`,
- wildcard action/resource tanpa alasan,
- secret plaintext di env var,
- static AWS access key,
- logging full event berisi PII.

Minimal permission example for S3 put:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::my-receipt-bucket/receipts/*"
    }
  ]
}
```

Jika bucket memakai SSE-KMS, perlu permission KMS yang sesuai:

```json
{
  "Effect": "Allow",
  "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
  "Resource": "arn:aws:kms:ap-southeast-1:123456789012:key/xxxx"
}
```

Detail IAM sudah dibahas di Part 3, KMS di Part 12.

---

## 34. Lambda and AWS SDK Region/Credential

Dalam Lambda, SDK default credentials provider akan memperoleh credential dari execution role environment. Region biasanya tersedia dari environment/runtime configuration.

Contoh cukup:

```java
private static final SqsClient SQS = SqsClient.builder().build();
```

Jangan hardcode access key:

```java
// Bad: never do this
StaticCredentialsProvider.create(AwsBasicCredentials.create("AKIA...", "secret"));
```

Jika perlu cross-account:

```java
private static final StsClient STS = StsClient.builder().build();

private static final S3Client CROSS_ACCOUNT_S3 = S3Client.builder()
    .credentialsProvider(StsAssumeRoleCredentialsProvider.builder()
        .stsClient(STS)
        .refreshRequest(r -> r.roleArn(Config.CROSS_ACCOUNT_ROLE_ARN)
            .roleSessionName("receipt-writer"))
        .build())
    .build();
```

Namun cross-account assume role di Lambda harus memperhitungkan:

- STS latency,
- credential refresh,
- role trust policy,
- external ID jika perlu,
- CloudTrail audit,
- least privilege target role.

---

## 35. Event Source Design Matrix

| Event Source | Invocation Style | Main Risk | Java Handler Concern |
|---|---:|---|---|
| API Gateway | Sync | latency/user error mapping | response shape, timeout, cold start |
| ALB | Sync | HTTP semantics | status/header/body mapping |
| S3 Event | Async | duplicate/out-of-order | idempotency by bucket/key/version |
| SNS | Async | duplicate fan-out | event schema, retry/DLQ |
| EventBridge | Async | event contract drift | event versioning, routing, replay |
| SQS | Poll-based batch | poison message/batch retry | partial failure, visibility timeout |
| Kinesis | Poll/checkpoint | ordering/shard blocking | batch failure, checkpointing |
| DynamoDB Streams | Poll/checkpoint | record ordering/retry | idempotent projection |
| Scheduler | Async | missed/duplicate run assumptions | idempotent scheduled command |

---

## 36. Function Granularity

Granularity adalah keputusan arsitektur.

### 36.1 Too small

Terlalu banyak function kecil bisa menyebabkan:

- IAM sprawl,
- deployment complexity,
- observability fragmentation,
- duplicated bootstrap code,
- hard-to-follow workflow,
- high operational overhead.

### 36.2 Too large

Function terlalu besar bisa menyebabkan:

- handler god class,
- IAM role terlalu luas,
- cold start berat,
- blast radius besar,
- deployment risk naik,
- event source logic bercampur.

### 36.3 Practical boundary

Pisahkan function berdasarkan:

- event source,
- security boundary,
- scaling profile,
- timeout profile,
- dependency profile,
- ownership,
- failure/retry behavior,
- domain capability.

Contoh:

```text
Good separation:
- document-upload-event-handler
- document-virus-scan-worker
- document-metadata-extractor
- case-escalation-scheduler-handler
- notification-dispatcher
```

Buruk:

```text
one-lambda-handles-all-case-management-events
```

---

## 37. Deployment Units: Version, Alias, and Environment

Lambda function code/config bisa dipublish sebagai version. Alias bisa menunjuk ke version tertentu.

Production-grade deployment biasanya memakai:

```text
$LATEST for development only
published immutable versions for release
alias such as dev/uat/prod/live
weighted alias for canary deployment
```

Kenapa penting?

- rollback lebih jelas,
- audit deployment lebih kuat,
- traffic shifting mungkin,
- config/version bisa dikontrol,
- production tidak bergantung pada mutable `$LATEST`.

---

## 38. Configuration Contract

Setiap Lambda harus punya configuration contract eksplisit.

Contoh:

```text
Environment variables:
- APP_ENV
- AWS_REGION
- RECEIPT_BUCKET
- AUDIT_QUEUE_URL
- IDEMPOTENCY_TABLE
- LOG_LEVEL
- POWERTOOLS_SERVICE_NAME

IAM permissions:
- s3:PutObject to receipt prefix
- sqs:SendMessage to audit queue
- dynamodb:PutItem/GetItem/UpdateItem to idempotency table
- kms:GenerateDataKey if using SSE-KMS

Timeout:
- Lambda timeout 30s
- SDK apiCallTimeout 20s
- SDK attemptTimeout 5s

Concurrency:
- reserved concurrency 20

Event source:
- SQS batch size 10
- max batching window 5s
- partial batch response enabled
```

Ini membuat function bisa direview sebagai unit operasional, bukan hanya code artifact.

---

## 39. Minimal Production Java Lambda Skeleton

Contoh skeleton sederhana tapi serius:

```java
package example.lambda;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.core.retry.RetryMode;
import software.amazon.awssdk.services.s3.S3Client;

import java.time.Duration;
import java.util.Objects;

public final class ReceiptHandler implements RequestHandler<ReceiptEvent, ReceiptResult> {

    private static final App APP = App.bootstrap();

    @Override
    public ReceiptResult handleRequest(ReceiptEvent event, Context context) {
        RequestContext requestContext = RequestContext.from(context);
        APP.logger().info("receipt.processing.started", requestContext, "orderId", event.orderId());

        try {
            ReceiptResult result = APP.receiptService().generate(event, requestContext);
            APP.logger().info("receipt.processing.succeeded", requestContext, "orderId", event.orderId());
            return result;
        } catch (InvalidReceiptEventException e) {
            APP.logger().warn("receipt.processing.invalid", requestContext, "reason", e.getMessage());
            throw e;
        } catch (Exception e) {
            APP.logger().error("receipt.processing.failed", requestContext, e);
            throw e;
        }
    }

    static final class App {
        private final ReceiptService receiptService;
        private final JsonLogger logger;

        private App(ReceiptService receiptService, JsonLogger logger) {
            this.receiptService = receiptService;
            this.logger = logger;
        }

        static App bootstrap() {
            Config config = Config.loadFromEnv();

            S3Client s3 = S3Client.builder()
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                    .apiCallTimeout(Duration.ofSeconds(20))
                    .apiCallAttemptTimeout(Duration.ofSeconds(5))
                    .retryStrategy(RetryMode.STANDARD)
                    .build())
                .build();

            JsonLogger logger = new JsonLogger(config.serviceName());
            ReceiptRepository repository = new S3ReceiptRepository(s3, config.receiptBucket());
            ReceiptService service = new ReceiptService(repository);

            return new App(service, logger);
        }

        ReceiptService receiptService() {
            return receiptService;
        }

        JsonLogger logger() {
            return logger;
        }
    }

    record Config(String serviceName, String receiptBucket) {
        static Config loadFromEnv() {
            return new Config(required("SERVICE_NAME"), required("RECEIPT_BUCKET"));
        }

        private static String required(String name) {
            String value = System.getenv(name);
            if (value == null || value.isBlank()) {
                throw new IllegalStateException("Missing environment variable: " + name);
            }
            return value;
        }
    }
}
```

Catatan:

- Java `record` tersedia sejak Java 16. Untuk Java 8, gunakan class biasa.
- `RetryMode.STANDARD` API detail bisa berbeda mengikuti versi SDK; cek versi SDK saat implementasi.
- Skeleton ini menunjukkan pola, bukan template final.

---

## 40. Java 8 Compatibility Notes

Jika target Java 8:

- tidak ada `record`,
- tidak ada `var`,
- tidak ada switch expression,
- tidak ada text block,
- tidak ada sealed class,
- dependency modern mungkin tidak support Java 8,
- runtime Lambda Java 8 perlu dicek lifecycle/support-nya,
- cold start optimization berbeda dibanding Java modern.

Contoh DTO Java 8:

```java
public final class ReceiptEvent {
    private String orderId;
    private String customerId;

    public ReceiptEvent() {
    }

    public String getOrderId() {
        return orderId;
    }

    public void setOrderId(String orderId) {
        this.orderId = orderId;
    }

    public String getCustomerId() {
        return customerId;
    }

    public void setCustomerId(String customerId) {
        this.customerId = customerId;
    }
}
```

Untuk code shared Java 8–25, jangan pakai fitur bahasa modern di module yang harus compatible Java 8.

---

## 41. Java 17/21/25 Notes

Untuk Java modern:

- gunakan records untuk immutable DTO internal bila mapper mendukung,
- gunakan sealed interface untuk result/error modeling bila cocok,
- gunakan switch expression untuk mapping event type,
- manfaatkan runtime performance improvement,
- perhatikan dependency compatibility,
- gunakan CDS/SnapStart/provisioned concurrency bila relevan,
- jangan otomatis memakai virtual thread di Lambda tanpa alasan.

### 41.1 Virtual threads in Lambda?

Java 21 membawa virtual threads. Namun Lambda handler invocation punya concurrency model sendiri. Virtual thread bisa berguna bila dalam satu invocation kita menjalankan banyak blocking I/O paralel yang bounded.

Tetapi hati-hati:

- Lambda timeout tetap batas keras,
- downstream quota tetap ada,
- parallelism internal bisa memperbesar retry storm,
- SQS batch processing dengan virtual thread harus tetap partial-failure safe,
- DB connection pool tetap bottleneck.

Rule:

```text
Use virtual threads only when they simplify bounded internal concurrency.
Do not use them to hide unbounded fan-out.
```

---

## 42. Common Anti-Patterns

## 42.1 Creating clients inside handler

```text
Impact: slow warm invocation, poor connection reuse, unnecessary allocation.
```

## 42.2 Using Lambda as long-running worker

```text
Impact: timeout risk, poor fit, hidden retry complexity.
```

## 42.3 Storing business state in static field

```text
Impact: data loss, cross-invocation leakage, wrong correctness model.
```

## 42.4 Ignoring duplicate events

```text
Impact: double charge, double email, double case transition, duplicate audit.
```

## 42.5 Logging full payload

```text
Impact: PII leak, secret leak, CloudWatch cost explosion.
```

## 42.6 One role for all functions

```text
Impact: excessive blast radius and poor auditability.
```

## 42.7 Full Spring Boot for trivial glue function

```text
Impact: bigger package, slower cold start, unnecessary complexity.
```

## 42.8 No timeout alignment

```text
Impact: function dies before cleanup or before dependency fails cleanly.
```

## 42.9 No reserved concurrency for database function

```text
Impact: Lambda scales faster than database can survive.
```

## 42.10 Treating DLQ as solution

```text
Impact: messages pile up without triage, replay unsafe, business process stuck.
```

---

## 43. Production Readiness Checklist for Java Lambda Fundamentals

### Handler

- [ ] Handler is thin adapter.
- [ ] Event DTO is separated from domain model.
- [ ] Validation is explicit.
- [ ] Error mapping matches event source.
- [ ] Idempotency strategy exists.
- [ ] Duplicate event handling is tested.

### Runtime

- [ ] Java runtime version is supported by AWS Lambda lifecycle.
- [ ] Dependency versions support selected Java version.
- [ ] Package size is reviewed.
- [ ] Cold start is measured.
- [ ] Warm start assumptions do not affect correctness.

### Initialization

- [ ] SDK clients are initialized outside handler.
- [ ] ObjectMapper/logger/config are reused.
- [ ] Mandatory env vars fail fast.
- [ ] Init does not call slow remote dependency unnecessarily.
- [ ] SnapStart/provisioned concurrency implications considered if used.

### Timeout and Retry

- [ ] Lambda timeout is explicit.
- [ ] SDK timeouts are less than Lambda timeout.
- [ ] Remaining time guard exists for critical operations.
- [ ] Event source retry behavior is documented.
- [ ] SQS visibility timeout aligns with Lambda timeout if applicable.

### Security

- [ ] No static AWS access key.
- [ ] Execution role least privilege.
- [ ] Secrets not stored in plaintext env vars.
- [ ] Logs redact sensitive data.
- [ ] KMS permissions reviewed if encryption used.

### Observability

- [ ] Logs include AWS request ID.
- [ ] Logs include business correlation ID.
- [ ] Metrics include success/failure/latency.
- [ ] Cold start metric exists.
- [ ] Downstream errors and throttling visible.
- [ ] DLQ/failure destination monitored.

### Operations

- [ ] Function version/alias strategy exists.
- [ ] Rollback procedure exists.
- [ ] Reserved concurrency considered.
- [ ] Cost/quota reviewed.
- [ ] Runbook exists.
- [ ] Replay procedure is safe.

---

## 44. Mental Model Summary

Java Lambda harus dipahami sebagai:

```text
Managed event-driven compute environment
  with reusable-but-disposable execution environments
  running Java handler code
  under strict timeout, identity, concurrency, and retry semantics.
```

Top 1% engineer tidak hanya tahu cara menulis handler. Mereka tahu:

- apa yang terjadi sebelum handler dipanggil,
- apa yang boleh disimpan di static field,
- kapan cold start terjadi,
- bagaimana event source melakukan retry,
- bagaimana timeout harus disusun,
- bagaimana mencegah duplicate side effect,
- bagaimana membatasi blast radius IAM,
- bagaimana mencegah Lambda menghancurkan database,
- bagaimana membuat logs/metrics cukup untuk incident,
- kapan Lambda bukan pilihan yang tepat.

---

## 45. Key Takeaways

1. Lambda Java handler adalah adapter, bukan tempat semua business logic.
2. Execution environment bisa dipakai ulang, tetapi bisa juga dibuang kapan saja.
3. Static state hanya boleh untuk optimization, bukan correctness.
4. SDK clients sebaiknya dibuat di luar handler dan dipakai ulang.
5. Cold start adalah system behavior, bukan hanya latency angka tunggal.
6. Timeout Lambda, SDK, event source, dan downstream harus selaras.
7. Retry behavior tergantung invocation source.
8. Idempotency wajib untuk event-driven Lambda.
9. Concurrency Lambda bisa memperbesar tekanan ke database/downstream.
10. Production Lambda harus punya observability, IAM least privilege, versioning, dan runbook.

---

## 46. References

- AWS Lambda runtimes: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
- Building Lambda functions with Java: https://docs.aws.amazon.com/lambda/latest/dg/lambda-java.html
- Define Lambda function handler in Java: https://docs.aws.amazon.com/lambda/latest/dg/java-handler.html
- Lambda execution environment lifecycle: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- Lambda best practices: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html
- Lambda Java context object: https://docs.aws.amazon.com/lambda/latest/dg/java-context.html
- AWS Lambda now supports Java 25: https://aws.amazon.com/blogs/compute/aws-lambda-now-supports-java-25/
- AWS SDK for Java 2.x Developer Guide: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS Lambda Java libraries: https://github.com/aws/aws-lambda-java-libs

---

## 47. What Comes Next

Part berikutnya:

```text
Part 18 — Lambda Java Performance: Cold Start, SnapStart, Memory, and Runtime Tuning
```

Part 17 membangun fondasi lifecycle dan handler model. Part 18 akan masuk lebih dalam ke performa Java Lambda: cold start anatomy, class loading, dependency minimization, SnapStart, provisioned concurrency, memory sizing, JVM flags, benchmark methodology, dan trade-off Java 8/17/21/25.

---

## 48. Series Progress

Status:

```text
Completed: Part 0 sampai Part 17
Current: Part 17
Remaining: Part 18 sampai Part 35
Series status: belum selesai
```
