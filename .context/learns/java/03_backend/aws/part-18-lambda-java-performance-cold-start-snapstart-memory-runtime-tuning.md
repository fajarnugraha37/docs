# Part 18 — Lambda Java Performance: Cold Start, SnapStart, Memory, and Runtime Tuning

Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Target pembaca: engineer Java yang sudah memahami JVM, concurrency, HTTP, AWS SDK, IAM, SQS/SNS/S3, dan dasar Lambda.  
Rentang Java: Java 8 sampai Java 25.  
Fokus: memahami, mengukur, dan mengoptimalkan performa AWS Lambda berbasis Java secara production-grade.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kita ingin memiliki mental model yang cukup kuat untuk menjawab pertanyaan seperti:

1. Mengapa Java Lambda terasa lambat saat cold start, tetapi bisa sangat cepat saat warm execution?
2. Apa sebenarnya yang terjadi pada fase initialization, invocation, freeze, restore, dan shutdown?
3. Kapan cold start harus dioptimalkan, dan kapan tidak perlu?
4. Bagaimana memory setting memengaruhi CPU, network throughput, GC behavior, dan cost?
5. Kapan memakai SnapStart, kapan memakai provisioned concurrency, dan kapan cukup optimasi biasa?
6. Bagaimana menghindari dependency graph yang membuat Lambda Java berat?
7. Bagaimana menulis handler Java yang tidak memperburuk cold start, warm start, memory pressure, dan tail latency?
8. Bagaimana melakukan benchmark Lambda dengan metrik yang benar, bukan sekadar rata-rata?

Topik ini bukan sekadar “Java Lambda lambat, pakai SnapStart”. Engineer yang matang harus bisa membaca performa Lambda sebagai hasil interaksi antara:

- ukuran deployment artifact,
- runtime Java,
- dependency graph,
- class loading,
- static initialization,
- AWS SDK client initialization,
- JVM startup behavior,
- memory/CPU allocation,
- GC,
- network path,
- IAM/STSesque credential resolution,
- downstream latency,
- concurrency pattern,
- retry behavior,
- observability overhead,
- dan pola traffic.

AWS Lambda menyediakan runtime Java terkelola, termasuk runtime Java modern seperti Java 17, Java 21, dan Java 25, serta mendokumentasikan lifecycle runtime, SnapStart, best practice, packaging, dan mekanisme tuning Java runtime. Rujukan resmi yang relevan termasuk Lambda runtimes, Java Lambda guide, execution environment lifecycle, SnapStart, SnapStart best practices, Java runtime customization, packaging, quota, dan best practices Lambda secara umum.

---

## 2. Inti Mental Model: Lambda Java Bukan Hanya Function, Tetapi Runtime System

Banyak developer melihat Lambda seperti ini:

```text
Event masuk -> handler Java dipanggil -> return response
```

Untuk performa, model itu terlalu dangkal.

Model yang lebih benar:

```text
Traffic / Event Source
        |
        v
Lambda control plane decides scaling / placement
        |
        v
Execution environment created or reused
        |
        v
Runtime bootstrap
        |
        v
JVM starts
        |
        v
Class loading + dependency initialization
        |
        v
Static fields / constructors / DI container / SDK client setup
        |
        v
Handler invoke
        |
        v
Downstream calls: S3/SQS/SNS/DB/HTTP/etc
        |
        v
Logs/metrics/traces emitted
        |
        v
Execution environment may be frozen, reused, restored, or discarded
```

Performa Lambda Java adalah kombinasi dari dua kategori besar:

1. **Startup performance**  
   Berapa lama environment siap menjalankan handler.

2. **Invoke performance**  
   Berapa lama handler memproses event setelah runtime siap.

Cold start berada terutama di startup performance. Warm invocation berada terutama di invoke performance. SnapStart mengubah startup path. Provisioned concurrency mengubah availability dari pre-initialized environments. Memory tuning memengaruhi keduanya.

---

## 3. Cold Start Anatomy

Cold start terjadi ketika Lambda harus membuat execution environment baru untuk menjalankan invocation.

Secara konseptual, cold start Java dapat dipecah menjadi beberapa fase:

```text
Cold invocation received
        |
        v
Environment provisioning
        |
        v
Runtime initialization
        |
        v
JVM startup
        |
        v
User code initialization
        |
        v
Handler execution
```

Dalam Java, bagian yang sering mahal adalah:

- JVM startup,
- class loading,
- bytecode verification,
- JIT warmup awal,
- dependency injection container bootstrap,
- reflection scanning,
- annotation scanning,
- JSON serializer/deserializer initialization,
- AWS SDK client creation,
- credential/region provider resolution,
- TLS/client connection preparation,
- logging/tracing framework initialization,
- loading configuration/secrets,
- static initialization yang terlalu berat.

### 3.1 Cold Start Tidak Sama Dengan Lambat Selamanya

Java sering memiliki pola:

```text
Cold invocation: lebih lambat
Warm invocation: jauh lebih stabil dan cepat
Long-running CPU-heavy handler: bisa sangat baik karena JVM/JIT
```

Jadi diagnosis harus memisahkan:

| Masalah | Penyebab Umum | Solusi Umum |
|---|---|---|
| Cold start tinggi | init berat, artifact besar, classpath besar | SnapStart, reduce deps, lazy init, provisioned concurrency |
| Warm latency tinggi | downstream lambat, algoritma buruk, serialization berat | optimize handler, timeout, pool, batching |
| Tail latency tinggi | retry, throttling, GC, queueing, noisy downstream | backpressure, memory tuning, observability |
| Cost tinggi | memory terlalu besar, duration tinggi, over-invocation | power tuning, batching, architecture review |

Kesalahan umum adalah mengoptimalkan cold start padahal bottleneck sebenarnya adalah downstream latency atau retry storm.

---

## 4. Warm Start, Freeze, Reuse, dan State

Lambda dapat menggunakan ulang execution environment untuk invocation berikutnya. Ini memungkinkan kita meletakkan beberapa objek mahal di luar handler.

Contoh yang benar:

```java
public final class Handler implements RequestHandler<MyEvent, MyResult> {

    private static final S3Client S3 = S3Client.builder().build();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public MyResult handleRequest(MyEvent event, Context context) {
        // use S3 and MAPPER
        return new MyResult("ok");
    }
}
```

Tujuannya:

- client dibuat sekali per environment,
- connection pool dapat dipakai ulang,
- serializer tidak dibuat per request,
- init cost tidak mengulang di setiap invocation.

Tetapi state reuse punya batas:

- tidak boleh menyimpan data user antar invocation,
- tidak boleh mengandalkan environment selalu reuse,
- cache harus punya TTL dan invalidation,
- resource harus valid setelah freeze/restore,
- object mutable global harus thread-safe jika handler atau library memunculkan concurrency internal,
- credential provider harus dibiarkan refresh otomatis jika perlu.

Mental model:

```text
Reuse is an optimization, not a correctness guarantee.
```

Jika correctness bergantung pada warm reuse, desainnya salah.

---

## 5. Static Initialization: Senjata dan Risiko

Static initialization adalah salah satu alat paling kuat untuk Lambda Java.

### 5.1 Baik untuk Objek Mahal dan Aman

Cocok untuk:

- AWS SDK clients,
- ObjectMapper,
- immutable config parser,
- static lookup table kecil,
- compiled regex,
- validator yang thread-safe,
- metrics/logging registry yang aman.

### 5.2 Buruk untuk Side Effect Berat

Hindari static init yang melakukan:

- call database,
- call Secrets Manager tanpa timeout jelas,
- call SSM berkali-kali,
- call S3 untuk fetch large file,
- migrasi schema,
- warmup semua dependency tanpa seleksi,
- membuat thread pool tak terkendali,
- blocking network call tanpa fallback,
- menginisialisasi seluruh Spring context jika function hanya butuh satu adapter kecil.

Contoh berbahaya:

```java
static {
    // buruk: cold start sekarang tergantung jaringan dan secret service
    String password = secretsManager.getSecretValue(...).secretString();
    database = DriverManager.getConnection(url, user, password);
}
```

Lebih baik:

```java
private static final SecretsProvider SECRETS = new CachedSecretsProvider(...);
private static volatile DataSource dataSource;

private static DataSource dataSource() {
    DataSource local = dataSource;
    if (local != null) return local;

    synchronized (Handler.class) {
        if (dataSource == null) {
            dataSource = createDataSource(SECRETS.currentDatabaseCredential());
        }
        return dataSource;
    }
}
```

Tetapi lazy initialization juga punya trade-off: invocation pertama yang butuh resource tetap membayar cost. Jadi pilih berdasarkan traffic dan latency objective.

---

## 6. Java Runtime Choices: Java 8 Sampai Java 25

Seri ini mencakup Java 8 sampai Java 25, tetapi keputusan runtime Lambda harus realistis.

### 6.1 Java 8

Java 8 masih banyak di enterprise legacy. Keunggulan utamanya adalah compatibility dengan codebase lama. Namun untuk Lambda modern, Java 8 biasanya bukan pilihan ideal jika tidak ada constraint legacy.

Risiko:

- library modern makin meninggalkan Java 8,
- fitur language dan JVM lama,
- runtime lifecycle perlu diperhatikan,
- tuning dan observability modern lebih terbatas.

Gunakan Java 8 jika:

- sistem legacy belum bisa migrasi,
- dependency internal hanya support Java 8,
- migration cost terlalu tinggi untuk tahap awal.

Tetapi untuk function baru, default yang lebih sehat adalah Java LTS modern.

### 6.2 Java 11

Java 11 pernah menjadi baseline modern enterprise. Namun banyak organisasi sekarang bergerak ke Java 17/21.

Gunakan Java 11 jika:

- platform internal masih baseline Java 11,
- framework belum certified di Java 17/21,
- migrasi bertahap.

### 6.3 Java 17

Java 17 adalah baseline kuat untuk banyak workload enterprise.

Keunggulan:

- LTS,
- performance JVM lebih baik dibanding Java 8/11 dalam banyak kasus,
- ecosystem matang,
- kompatibel dengan banyak framework modern.

### 6.4 Java 21

Java 21 adalah pilihan sangat menarik untuk Java Lambda modern.

Keunggulan:

- LTS,
- runtime modern,
- language/API improvements,
- potensi performa lebih baik,
- virtual threads tersedia, walau penggunaannya di Lambda harus tetap bijak.

Catatan penting: virtual threads tidak otomatis membuat Lambda lebih cepat. Jika handler hanya satu invocation per environment dan workload I/O kecil, manfaatnya terbatas. Virtual threads lebih berguna jika handler melakukan banyak concurrent I/O internal, misalnya fan-out ke banyak endpoint, tetapi harus tetap dikontrol dengan timeout dan concurrency limit.

### 6.5 Java 25

Java 25 sudah relevan untuk Lambda modern berdasarkan dukungan runtime AWS. Ini penting untuk engineer yang ingin siap pada generasi runtime terbaru. Namun adoption harus mempertimbangkan:

- support framework,
- support library,
- build plugin,
- observability agent,
- compliance runtime policy,
- internal platform readiness,
- rollback strategy.

Rekomendasi praktis:

```text
Legacy maintenance: Java 8/11 jika belum bisa migrasi.
New production baseline conservative: Java 17.
New production baseline modern: Java 21.
Forward-looking / platform-ready: Java 25 setelah dependency dan tooling validated.
```

---

## 7. Memory, CPU, Network, dan Cost

Di Lambda, memory bukan hanya heap. Memory setting memengaruhi resource yang tersedia untuk function, termasuk CPU allocation secara proporsional. AWS mendokumentasikan bahwa memory function dapat dikonfigurasi sampai 10,240 MB, dan function dapat berjalan sampai 15 menit per invocation. AWS juga merekomendasikan penggunaan Lambda Power Tuning untuk mencari konfigurasi memory yang tepat.

### 7.1 Memory Setting Bukan Sekadar “RAM”

Memory setting memengaruhi:

- heap capacity,
- native memory,
- CPU share,
- JIT speed,
- GC behavior,
- network throughput,
- JSON parsing throughput,
- compression/decompression speed,
- TLS handshake speed,
- S3 upload/download speed,
- total cost per invocation.

Menaikkan memory dapat menurunkan duration cukup besar sehingga cost total bisa sama atau bahkan lebih murah.

Contoh konseptual:

| Memory | Duration | Cost per ms | Total Cost | Catatan |
|---:|---:|---:|---:|---|
| 512 MB | 2000 ms | rendah | sedang | CPU kurang, lama |
| 1024 MB | 900 ms | lebih tinggi | bisa lebih rendah | CPU cukup |
| 2048 MB | 500 ms | lebih tinggi | bisa optimal | latency bagus |
| 4096 MB | 430 ms | jauh lebih tinggi | mungkin mahal | diminishing return |

Yang dicari bukan memory paling kecil, tetapi titik optimal antara:

- p50 latency,
- p95/p99 latency,
- cost,
- error rate,
- downstream pressure,
- concurrency requirement.

### 7.2 Heap Sizing

Lambda memory adalah batas total environment, bukan hanya heap. JVM juga memakai native memory untuk:

- metaspace,
- thread stacks,
- JIT/code cache,
- direct buffers,
- TLS/native libraries,
- AWS CRT/Netty native memory jika dipakai,
- logging/tracing agents,
- decompression buffers.

Jangan mengatur `-Xmx` sama dengan memory Lambda.

Contoh buruk:

```text
Lambda memory = 1024 MB
JAVA_TOOL_OPTIONS = -Xmx1024m
```

Ini bisa membuat native memory kehabisan ruang.

Lebih aman:

```text
Lambda memory = 1024 MB
Xmx sekitar 50-70% tergantung workload
```

Namun di banyak Lambda, biarkan runtime default dulu, ukur `Max Memory Used`, lalu tuning.

---

## 8. JVM Startup Behavior dan `JAVA_TOOL_OPTIONS`

AWS Lambda memungkinkan customization startup behavior untuk Java runtime melalui environment variable seperti `JAVA_TOOL_OPTIONS`. Ini bisa dipakai untuk mengatur opsi JVM tanpa mengubah kode.

Contoh opsi yang kadang dipakai:

```text
JAVA_TOOL_OPTIONS=-XX:+TieredCompilation -XX:TieredStopAtLevel=1
```

Tujuannya dapat mengurangi startup time karena compiler berhenti di tier awal. Namun trade-off-nya adalah peak throughput warm execution bisa lebih rendah. Ini cocok untuk function pendek dan latency-sensitive, tetapi belum tentu cocok untuk CPU-heavy function yang mendapat banyak warm invocation.

### 8.1 Jangan Copy-Paste JVM Flags

JVM flags harus dipilih berdasarkan workload.

Pertanyaan evaluasi:

1. Apakah function latency-sensitive API?
2. Apakah function batch worker CPU-heavy?
3. Apakah cold start sering terjadi?
4. Apakah warm invocation jauh lebih banyak daripada cold invocation?
5. Apakah handler berjalan <100 ms, 500 ms, 5 detik, atau menit?
6. Apakah menggunakan SnapStart?
7. Apakah GC pernah muncul sebagai bottleneck?

Rule praktis:

```text
No measurement -> no JVM flag.
```

Flags yang tidak dipahami dapat memperbaiki p50 tetapi merusak p99, atau menurunkan cost satu function tetapi menaikkan error downstream.

---

## 9. SnapStart: Mental Model

Lambda SnapStart adalah fitur untuk mengurangi startup latency dengan membuat snapshot dari initialized execution environment ketika function version dipublish, lalu memakai snapshot tersebut untuk invocation berikutnya. AWS menjelaskan bahwa SnapStart ditujukan untuk mengurangi latency variability dari one-time initialization seperti loading dependency dan framework, dan dalam skenario optimal dapat menurunkan startup dari beberapa detik menjadi sub-second.

Model konseptual:

```text
Publish version
        |
        v
Lambda initializes function
        |
        v
Init code runs
        |
        v
Snapshot memory/disk state is captured and cached
        |
        v
Later invocation
        |
        v
Environment restored from snapshot
        |
        v
Handler runs
```

Jadi SnapStart bukan “membuat Java ringan”. SnapStart mengubah kapan biaya initialization dibayar.

Tanpa SnapStart:

```text
Cold invocation pays init cost.
```

Dengan SnapStart:

```text
Publish/version preparation pays init cost.
Invocation pays restore cost.
```

### 9.1 SnapStart Cocok Untuk

- Java function dengan initialization mahal,
- framework-heavy function,
- latency-sensitive API,
- traffic bursty yang sering memunculkan cold start,
- function dengan dependency graph besar yang sulit dipangkas cepat,
- handler yang aman terhadap snapshot/restore semantics.

### 9.2 SnapStart Tidak Otomatis Cocok Untuk

- function yang sangat sederhana,
- function yang bottleneck-nya downstream,
- function yang init-nya sudah kecil,
- function yang memakai state unik saat init dan tidak aman disnapshot,
- function yang butuh network connection valid dari init tanpa restore handling,
- function yang belum punya test untuk uniqueness, randomness, credential, dan socket behavior.

---

## 10. SnapStart Correctness Hazard

SnapStart mengubah correctness surface.

Hal yang aman di normal cold start belum tentu aman setelah snapshot restore.

### 10.1 Randomness dan Uniqueness

Jika unique value dibuat saat init lalu disnapshot, semua restored environment dapat melihat seed/value yang sama jika tidak dirancang benar.

Buruk:

```java
private static final String INSTANCE_ID = UUID.randomUUID().toString();
```

Jika `INSTANCE_ID` dimaksudkan unik per restored environment, ini bermasalah.

Lebih baik:

```java
private static String invocationInstanceId() {
    return UUID.randomUUID().toString();
}
```

Atau gunakan runtime hook after restore jika memang butuh environment-specific initialization.

### 10.2 Network Connection

AWS mencatat dalam SnapStart best practices bahwa state koneksi yang dibuat saat initialization tidak dijamin ketika function resume dari snapshot. Banyak koneksi AWS SDK dapat resume otomatis, tetapi koneksi lain perlu divalidasi atau dibuat ulang.

Hindari:

- membuka JDBC connection saat init dan menganggap pasti valid setelah restore,
- membuka raw socket saat init,
- menyimpan connection state yang tidak punya health check,
- mengasumsikan TLS session lama tetap valid.

Lebih aman:

- gunakan client/pool yang bisa reconnect,
- validasi connection saat first use,
- refresh resource di after-restore hook jika perlu,
- buat downstream call idempotent.

### 10.3 Credentials dan Time-Sensitive Data

Snapshot dapat menangkap state pada waktu publish/init.

Perhatikan:

- credential temporary,
- cached secret,
- timestamp,
- token,
- DNS cache,
- config yang bisa berubah,
- certificate/session state.

Untuk AWS SDK, gunakan provider chain yang mampu refresh. Jangan hardcode credential hasil resolve ke static string.

Buruk:

```java
static final AwsCredentials CREDS = DefaultCredentialsProvider.create()
        .resolveCredentials();
```

Lebih baik:

```java
static final S3Client S3 = S3Client.builder()
        .credentialsProvider(DefaultCredentialsProvider.create())
        .build();
```

Client/provider dapat mengelola refresh sesuai desain SDK.

---

## 11. SnapStart Runtime Hooks

AWS menyediakan runtime hooks untuk menjalankan kode sebelum snapshot dibuat dan setelah snapshot direstore. Untuk Java, hook ini berguna untuk cleanup sebelum snapshot dan reinitialize resource setelah restore.

Konsep:

```text
beforeCheckpoint:
    cleanup state that should not be snapshotted
    close resources if unsafe
    precompute safe immutable data

afterRestore:
    regenerate uniqueness
    refresh dynamic config if needed
    validate or recreate network resources
```

Gunakan hook untuk correctness, bukan sebagai tempat memasukkan semua logic aplikasi.

Anti-pattern:

```text
afterRestore becomes mini application bootstrap with many remote calls.
```

Jika afterRestore terlalu berat, SnapStart benefit berkurang.

---

## 12. Provisioned Concurrency vs SnapStart vs Warmup Hack

Ada tiga pendekatan populer untuk cold start.

### 12.1 Provisioned Concurrency

Provisioned concurrency menjaga sejumlah execution environment tetap initialized dan siap melayani request. Ini kuat untuk latency-sensitive traffic dengan kapasitas yang dapat diprediksi.

Cocok untuk:

- API synchronous,
- strict latency SLO,
- traffic pattern predictable,
- cold start tidak boleh muncul pada p99,
- budget tersedia.

Trade-off:

- ada biaya walau tidak dipakai,
- perlu kapasitas planning,
- traffic spike di atas provisioned concurrency tetap bisa cold start/on-demand,
- deployment/version/alias management lebih penting.

### 12.2 SnapStart

Cocok untuk menurunkan startup latency tanpa menjaga environment selalu warm.

Trade-off:

- snapshot semantics harus dipahami,
- perlu publish version,
- correctness hazard pada uniqueness/network/time-sensitive state,
- restore duration tetap ada.

### 12.3 Scheduled Warmup Hack

Warmup hack adalah membuat scheduled invocation untuk menjaga function warm.

Masalah:

- tidak menjamin semua concurrent environments warm,
- boros invocation,
- menambah noise logs/metrics,
- bisa salah mengukur traffic,
- tidak menyelesaikan scale-out cold start.

Rekomendasi:

```text
Serious latency SLO -> evaluate provisioned concurrency or SnapStart.
Casual warmup hack -> avoid as primary strategy.
```

---

## 13. Dependency Graph Minimization

Java Lambda sering lambat bukan karena Java, tetapi karena dependency graph terlalu besar.

### 13.1 Masalah Umum

- membawa seluruh Spring Boot untuk handler kecil,
- membawa semua AWS SDK service module,
- memakai fat jar tanpa pruning,
- membawa test/resources/docs,
- multiple JSON libraries,
- multiple logging bindings,
- reflection-heavy libraries,
- annotation scanning besar,
- transitive dependencies tidak dipahami.

### 13.2 Prinsip

```text
Lambda package should contain what the function needs, not what the application platform usually contains.
```

Cek dependency:

Maven:

```bash
mvn dependency:tree
```

Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson
```

### 13.3 AWS SDK Module Discipline

Jangan import bundle besar jika hanya butuh S3/SQS.

Baik:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>${aws.sdk.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>sqs</artifactId>
  </dependency>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>secretsmanager</artifactId>
  </dependency>
</dependencies>
```

Buruk:

```text
Pull everything because easier.
```

### 13.4 Serialization Discipline

Jackson sangat powerful, tetapi bisa mahal jika:

- ObjectMapper dibuat per invocation,
- module auto-discovery berlebihan,
- reflection model kompleks,
- payload object terlalu generik,
- polymorphic deserialization tidak perlu.

Gunakan static `ObjectMapper` yang dikonfigurasi eksplisit.

```java
final class JsonSupport {
    static final ObjectMapper MAPPER = new ObjectMapper()
            .findAndRegisterModules()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    private JsonSupport() {}
}
```

Jika function sangat latency-sensitive dan payload sederhana, pertimbangkan model DTO sederhana dan hindari framework binding berlebihan.

---

## 14. AWS SDK Startup Optimization

AWS SDK for Java 2.x sangat modular dan powerful, tetapi tetap perlu disiplin di Lambda.

AWS menyediakan panduan khusus untuk mengurangi startup time SDK di Lambda, termasuk mempertimbangkan SnapStart untuk Java.

### 14.1 Reuse Client

Benar:

```java
private static final SqsClient SQS = SqsClient.builder().build();
```

Salah:

```java
public Void handleRequest(Event event, Context context) {
    SqsClient sqs = SqsClient.builder().build(); // buruk per invocation
    ...
}
```

### 14.2 Pilih HTTP Client Dengan Sengaja

Untuk sync Lambda sederhana, default mungkin cukup. Untuk kebutuhan startup/footprint tertentu, evaluasi HTTP client:

- URLConnection HTTP client: ringan, tetapi fitur lebih terbatas.
- Apache HTTP client: umum untuk sync, pooling matang.
- Netty NIO async client: cocok async/fan-out, tapi menambah event loop/native footprint.
- AWS CRT client: dapat memberi performa tinggi untuk use case tertentu, tetapi evaluasi footprint dan native dependency.

Tidak ada “best universal”. Pilih berdasarkan:

- cold start,
- throughput,
- connection reuse,
- TLS behavior,
- artifact size,
- async requirement,
- operational familiarity.

### 14.3 Jangan Resolve Credential Manual

Biarkan client memakai provider.

```java
private static final S3Client S3 = S3Client.builder()
        .region(Region.AP_SOUTHEAST_1)
        .credentialsProvider(DefaultCredentialsProvider.create())
        .build();
```

Untuk Lambda execution role, default provider biasanya cukup.

### 14.4 Region Eksplisit Untuk Production

Region resolution otomatis bagus untuk portability, tetapi production sering lebih aman eksplisit via config.

```java
private static final Region REGION = Region.of(System.getenv("AWS_REGION"));
```

Atau gunakan environment variable domain-specific:

```text
APP_AWS_REGION=ap-southeast-1
```

---

## 15. Framework Choice: Plain Java, Dagger, Micronaut, Quarkus, Spring

Framework choice sangat memengaruhi Lambda startup.

### 15.1 Plain Java

Cocok untuk:

- simple adapter,
- SQS processor,
- S3 event handler,
- SNS publisher,
- strict cold start requirement,
- low dependency footprint.

Kelebihan:

- startup kecil,
- dependency jelas,
- package kecil,
- mudah di-debug.

Kekurangan:

- lebih banyak wiring manual,
- standardisasi tim perlu dibuat sendiri.

### 15.2 Dagger / Compile-Time DI

Cocok jika butuh DI tanpa reflection scanning besar.

Kelebihan:

- dependency graph compile-time,
- startup lebih predictable,
- cocok untuk Lambda.

Kekurangan:

- learning curve,
- generated code,
- tidak senyaman Spring untuk beberapa tim.

### 15.3 Micronaut / Quarkus

Keduanya punya fokus startup cepat dan cloud-native. Cocok jika ingin framework tetapi lebih ringan dibanding Spring Boot tradisional.

Tetap perlu:

- ukur cold/warm latency,
- cek artifact size,
- cek native image trade-off,
- cek AWS integration maturity,
- cek observability integration.

### 15.4 Spring Boot

Spring Boot nyaman dan kuat, tetapi dapat berat untuk Lambda jika dipakai tanpa disiplin.

Gunakan Spring Boot jika:

- tim sudah heavily standardized,
- function cukup kompleks,
- integrasi enterprise banyak,
- SnapStart/provisioned concurrency diterima,
- cold start SLO masih tercapai.

Hindari Spring Boot untuk function kecil yang hanya memproses satu event sederhana.

Prinsip:

```text
Do not deploy an application framework when you only need an adapter.
```

---

## 16. Handler Design Untuk Latency Rendah

### 16.1 Pisahkan Bootstrap, Decode, Business Logic, Encode

Struktur handler yang sehat:

```text
Handler
  -> parse event
  -> validate envelope
  -> call use case
  -> call AWS/downstream gateways
  -> build response
```

Jangan membuat handler menjadi tempat semua logic.

Contoh:

```java
public final class OrderEventHandler implements RequestHandler<SQSEvent, SQSBatchResponse> {

    private static final OrderProcessor PROCESSOR = Bootstrap.orderProcessor();

    @Override
    public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
        return PROCESSOR.processBatch(event, LambdaContextView.from(context));
    }
}
```

### 16.2 Hindari Allocation Berlebihan

Pada handler yang dipanggil sangat sering:

- jangan buat ObjectMapper per invocation,
- jangan buat SDK client per invocation,
- jangan compile regex per invocation,
- jangan parse config per invocation,
- jangan convert payload bolak-balik String/byte[] tanpa perlu,
- jangan log full payload besar.

### 16.3 Timeout Budgeting

Lambda timeout harus dibagi ke internal operations.

Contoh:

```text
Lambda timeout: 30s
Reserved shutdown/buffer: 2s
SQS delete/batch response: 1s
Business processing budget: 25s
Observability flush: 1s
Unknown overhead: 1s
```

Gunakan `context.getRemainingTimeInMillis()` untuk mencegah function mati di tengah operasi penting.

```java
private boolean enoughTimeLeft(Context context, long requiredMillis) {
    return context.getRemainingTimeInMillis() > requiredMillis;
}
```

---

## 17. GC dan Memory Pressure

Lambda Java function pendek sering tidak bottleneck di GC, tetapi GC bisa muncul pada:

- file processing,
- JSON payload besar,
- batch SQS besar,
- image/document processing,
- compression/decompression,
- large map/list aggregation,
- high concurrency internal fan-out.

### 17.1 Tanda Memory Pressure

- `Max Memory Used` mendekati configured memory,
- duration p99 melonjak,
- `OutOfMemoryError`,
- frequent timeout saat payload besar,
- DLQ naik karena batch gagal,
- logs menunjukkan repeated retry tanpa clear downstream error.

### 17.2 Prinsip

- stream data besar,
- batasi batch size,
- gunakan bounded buffer,
- hindari load seluruh S3 object ke memory,
- hindari full payload logging,
- batasi parallelism internal,
- gunakan temporary file `/tmp` jika lebih aman daripada heap,
- tune memory sebelum tune GC flags.

---

## 18. `/tmp` Storage dan Performance

Lambda menyediakan ephemeral storage di `/tmp`. Ini berguna untuk:

- temporary file saat download S3 besar,
- decompression staging,
- model/cache kecil,
- batch processing intermediate,
- avoiding heap pressure.

Tetapi:

- jangan menganggap `/tmp` selalu kosong,
- jangan simpan data sensitif tanpa cleanup strategy,
- jangan mengandalkan file tetap ada untuk correctness,
- size harus dikonfigurasi sesuai workload,
- cleanup harus dilakukan terutama untuk large temporary files.

Pattern:

```java
Path temp = Files.createTempFile(Path.of("/tmp"), "input-", ".bin");
try {
    // process
} finally {
    Files.deleteIfExists(temp);
}
```

---

## 19. Network Performance dan VPC Considerations

Banyak Lambda latency bukan dari Java, tetapi dari network path.

Perhatikan:

- VPC configuration,
- NAT Gateway path,
- VPC endpoint untuk AWS services,
- DNS lookup,
- TLS handshake,
- connection reuse,
- downstream service region,
- cross-AZ/cross-region call,
- security group/NACL misconfiguration,
- database connection creation.

Untuk AWS services seperti S3, SQS, SNS, Secrets Manager, dan SSM, evaluasi VPC endpoint jika function berada dalam VPC dan harus mengakses services privat. Ini dapat mengurangi dependency ke NAT path dan memperbaiki security posture.

---

## 20. Database Connection: Lambda Java Anti-Pattern Klasik

Lambda + relational database adalah area rawan.

Masalah:

- cold start membuat connection baru,
- scale-out membuat banyak connection,
- database connection limit habis,
- connection pool per environment tidak sama dengan global pool,
- warm environment reuse membuat connection stale,
- SnapStart dapat menangkap state connection yang tidak valid.

Jika Lambda butuh RDBMS:

- pertimbangkan RDS Proxy,
- batasi reserved concurrency,
- gunakan pool kecil,
- validate connection,
- timeout pendek,
- jangan buka connection per record,
- jangan lakukan long transaction,
- gunakan idempotency.

Pool Lambda bukan seperti pool di long-running service. Jika concurrency Lambda 500 dan pool per environment 10, secara teoritis bisa mencoba 5000 connections.

---

## 21. Measuring Lambda Performance Correctly

### 21.1 Jangan Pakai Average Saja

Average menipu.

Gunakan:

- p50,
- p90,
- p95,
- p99,
- max,
- cold start count,
- init duration,
- restore duration,
- duration,
- billed duration,
- memory used,
- error rate,
- timeout count,
- throttles,
- iterator age / queue age jika event source.

### 21.2 Bedakan Init, Restore, dan Handler Duration

Untuk normal cold start, log REPORT dapat menunjukkan init duration. Untuk SnapStart, monitoring memiliki restore duration. AWS menyediakan dokumentasi monitoring SnapStart dan query untuk melihat restore duration/latency percentile.

Mental model:

```text
No SnapStart cold start:
  observed latency ~= init duration + handler duration

SnapStart:
  observed latency ~= restore duration + handler duration

Warm start:
  observed latency ~= handler duration
```

### 21.3 Controlled Benchmark

Benchmark harus mengontrol:

- runtime version,
- memory setting,
- artifact version,
- dependency version,
- region,
- VPC/non-VPC,
- provisioned concurrency on/off,
- SnapStart on/off,
- payload size,
- downstream mock/real,
- concurrency level,
- test duration,
- cold/warm ratio.

Tanpa kontrol ini, hasil benchmark sulit dipercaya.

---

## 22. Power Tuning Methodology

AWS merekomendasikan Lambda Power Tuning untuk menemukan memory configuration yang tepat. Secara konsep, power tuning menjalankan function pada beberapa memory setting dan membandingkan duration/cost.

Metodologi manual juga bisa:

1. Pilih payload representatif kecil, normal, besar.
2. Jalankan pada beberapa memory setting: 512, 1024, 1536, 2048, 3008, 4096 MB.
3. Ukur p50/p95/p99 dan cost estimate.
4. Pisahkan cold dan warm jika latency-sensitive.
5. Lihat `Max Memory Used`.
6. Lihat downstream error/throttle.
7. Pilih konfigurasi berdasarkan SLO, bukan hanya cost terendah.

Matrix sederhana:

| Memory | p50 | p95 | p99 | Max Memory Used | Error | Cost | Keputusan |
|---:|---:|---:|---:|---:|---:|---:|---|
| 512 | | | | | | | |
| 1024 | | | | | | | |
| 1536 | | | | | | | |
| 2048 | | | | | | | |
| 3008 | | | | | | | |

---

## 23. Cold Start Optimization Checklist

Urutan optimasi yang disarankan:

### Step 1 — Confirm Cold Start Is the Problem

Cari:

- init duration tinggi,
- restore duration tinggi,
- p99 spike saat scale-out,
- traffic burst setelah idle,
- first request lambat,
- logs menunjukkan environment baru.

Jika p95/p99 tinggi tetapi init duration kecil, cold start bukan masalah utama.

### Step 2 — Reduce Package and Dependency

- hapus dependency tidak perlu,
- gunakan AWS SDK module spesifik,
- hilangkan duplicate logging bindings,
- exclude docs/test resources,
- hindari framework besar untuk handler kecil.

### Step 3 — Move Safe Expensive Objects Outside Handler

- SDK clients,
- ObjectMapper,
- compiled validators,
- immutable config.

### Step 4 — Remove Unsafe Heavy Static Initialization

- network call tanpa timeout,
- DB connection eager,
- load huge file,
- scan classpath besar.

### Step 5 — Tune Memory

Menaikkan memory dapat mempercepat startup karena CPU meningkat.

### Step 6 — Evaluate JVM Startup Options

Gunakan `JAVA_TOOL_OPTIONS` hanya setelah benchmark.

### Step 7 — Evaluate SnapStart

Jika init masih mahal dan correctness cocok, aktifkan SnapStart pada version.

### Step 8 — Evaluate Provisioned Concurrency

Jika p99 strict dan traffic predictable, gunakan provisioned concurrency.

---

## 24. Warm Performance Optimization Checklist

Untuk warm invocation:

- ukur downstream latency,
- set SDK timeouts,
- reuse client,
- batch SQS/SNS/S3 operations jika aman,
- batasi concurrency internal,
- hindari full payload logging,
- stream large payload,
- pilih memory optimal,
- hindari retry berlapis,
- gunakan idempotency,
- gunakan circuit/degradation jika dependency lemah.

Warm performance sering lebih dipengaruhi desain handler dan downstream daripada runtime Java.

---

## 25. Tail Latency: Lawan Sebenarnya

Top-tier engineer tidak hanya mengejar p50. Production user dan event pipeline sering rusak karena p99.

Penyebab p99 tinggi:

- cold start,
- restore delay,
- downstream p99,
- DNS/TLS spikes,
- retry amplification,
- throttling,
- GC,
- queue backlog,
- large payload outlier,
- log ingestion overhead,
- VPC/NAT path contention,
- database pool exhaustion.

Cara berpikir:

```text
p50 tells normal path.
p95 tells common stress.
p99 tells architecture weakness.
max tells incident story.
```

---

## 26. Lambda Java Untuk API vs Worker

### 26.1 API Lambda

Prioritas:

- low cold start,
- low p99,
- strict timeout,
- small payload,
- fast auth/config,
- SnapStart/provisioned concurrency mungkin penting,
- response mapping jelas.

### 26.2 SQS Worker Lambda

Prioritas:

- throughput,
- batch failure handling,
- idempotency,
- visibility timeout,
- DLQ,
- memory untuk payload batch,
- cost per message,
- graceful partial failure.

Cold start mungkin tidak sepenting API, kecuali queue age dan burst processing sensitif.

### 26.3 S3 Processing Lambda

Prioritas:

- streaming,
- `/tmp` usage,
- object size guard,
- duplicate event handling,
- multipart/range processing,
- timeout budget,
- quarantine on failure.

### 26.4 Scheduled Lambda

Prioritas:

- predictable completion,
- idempotency,
- lock/leader election jika schedule overlap,
- timeout,
- operational alert.

---

## 27. Java Virtual Threads Dalam Lambda

Java 21+ membawa virtual threads. Ini berguna untuk menyederhanakan concurrent I/O, tetapi tidak otomatis mempercepat Lambda.

Cocok jika handler melakukan:

- banyak independent HTTP calls,
- parallel AWS SDK sync calls dengan batas concurrency,
- fan-out/fan-in ringan,
- waiting-heavy operations.

Tidak cocok jika:

- function hanya satu call sederhana,
- downstream punya strict rate limit,
- concurrency internal tidak dibatasi,
- CPU-bound workload,
- memory kecil dan task terlalu banyak.

Contoh bounded virtual thread usage:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Result>> futures = requests.stream()
            .map(req -> executor.submit(() -> callDownstream(req)))
            .toList();

    for (Future<Result> future : futures) {
        results.add(future.get(2, TimeUnit.SECONDS));
    }
}
```

Tetapi tetap butuh semaphore/rate limit jika downstream terbatas.

```java
private static final Semaphore LIMIT = new Semaphore(20);

private Result guardedCall(Request request) throws Exception {
    if (!LIMIT.tryAcquire(100, TimeUnit.MILLISECONDS)) {
        throw new TooMuchInternalConcurrencyException();
    }
    try {
        return callDownstream(request);
    } finally {
        LIMIT.release();
    }
}
```

---

## 28. Native Image: GraalVM Trade-Off

Native image dapat mengurangi startup, tetapi bukan solusi universal.

Potensi kelebihan:

- startup cepat,
- memory footprint lebih kecil,
- cocok latency-sensitive.

Trade-off:

- build complexity,
- reflection configuration,
- library compatibility,
- debugging lebih sulit,
- build time lebih lama,
- peak throughput bisa berbeda,
- operational skill lebih tinggi.

Untuk tim enterprise, native image sebaiknya dipilih jika:

- cold start SLO tidak tercapai dengan Java modern + SnapStart/provisioned concurrency,
- dependency compatibility sudah diuji,
- pipeline build siap,
- observability tetap lengkap,
- rollback tersedia.

---

## 29. Packaging Strategy

AWS Lambda Java dapat dikemas sebagai `.zip`/JAR archive atau container image. Dokumentasi Lambda menjelaskan deployment package sebagai arsip zip/JAR atau container image.

### 29.1 JAR/ZIP

Cocok untuk:

- function standar,
- artifact kecil-menengah,
- deployment cepat,
- simple operational model.

Optimasi:

- minimize dependencies,
- avoid unnecessary resources,
- deterministic build,
- keep artifact small,
- use layers only jika benar-benar membantu.

### 29.2 Container Image

Cocok untuk:

- custom runtime needs,
- native libraries,
- complex packaging,
- enterprise base image control,
- security scanning standardized.

Trade-off:

- image size bisa besar,
- build/push lebih berat,
- cold start dapat terpengaruh image loading/cache,
- base image patching menjadi tanggung jawab lebih eksplisit.

---

## 30. Observability Khusus Performance

Minimum log/metric untuk Lambda Java performance:

- function name/version/alias,
- cold/warm indicator jika bisa,
- memory configured,
- max memory used dari REPORT,
- duration,
- init duration,
- restore duration jika SnapStart,
- downstream latency per dependency,
- retry count,
- timeout budget remaining,
- payload size bucket,
- batch size,
- error type,
- AWS request id,
- correlation id/domain event id.

Structured log contoh:

```json
{
  "event": "lambda.invoke.completed",
  "function": "case-document-processor",
  "version": "42",
  "coldStart": false,
  "durationMs": 184,
  "remainingTimeMs": 28110,
  "payloadBytes": 10422,
  "s3GetMs": 63,
  "sqsDeleteMs": 18,
  "retryCount": 0,
  "caseId": "CASE-2026-0001",
  "correlationId": "corr-abc"
}
```

Jangan log payload penuh untuk mengejar observability. Log metadata yang cukup untuk diagnosis.

---

## 31. Example: Refactoring Slow Java Lambda

### 31.1 Kondisi Awal

Sebuah Lambda API Java punya p99 4 detik setelah idle.

Gejala:

- cold start tinggi,
- artifact 80 MB,
- Spring Boot full context,
- ObjectMapper dibuat per request,
- SSM dipanggil 12 kali saat init,
- Secrets Manager dipanggil setiap invocation,
- SDK client dibuat per invocation,
- memory 512 MB.

### 31.2 Diagnosis

Masalah bukan satu hal, tetapi kombinasi:

```text
large classpath
+ framework bootstrap
+ remote config calls
+ no cache
+ low CPU due to low memory
+ per-invocation client creation
= cold and warm latency bad
```

### 31.3 Perbaikan Bertahap

1. Hapus dependency tidak perlu.
2. Ganti full Spring context dengan small bootstrap atau functional bean subset.
3. Load config sebagai environment variable/SSM cached provider.
4. Cache secret dengan TTL.
5. Static SDK clients.
6. Static ObjectMapper.
7. Memory test 512 -> 1024 -> 2048.
8. Set SDK timeout.
9. Enable SnapStart jika masih cold-heavy.
10. Tambahkan metric init/warm/downstream.

### 31.4 Hasil Yang Diharapkan

- cold start turun,
- warm p95 turun,
- p99 lebih stabil,
- cost mungkin turun walau memory naik,
- incident diagnosability naik.

---

## 32. Decision Matrix

| Kondisi | Strategi Utama |
|---|---|
| Function kecil, cold start sudah rendah | Jangan over-optimize |
| Java function init berat, traffic bursty | SnapStart |
| API strict p99, traffic predictable | Provisioned concurrency |
| Worker SQS throughput tinggi | Batch, memory tuning, idempotency |
| Large file processing | Streaming, `/tmp`, memory tuning |
| DB connection bottleneck | RDS Proxy, reserved concurrency, pool kecil |
| Cost tinggi | Power tuning, batching, dependency trimming |
| p99 tinggi tapi init kecil | Downstream/retry/GC/network analysis |
| Java 8 legacy | Migration plan to 17/21/25 |
| New service | Java 21/25 evaluation with SDK v2 |

---

## 33. Production Readiness Checklist

Sebelum Lambda Java dianggap siap production:

### Runtime and Package

- [ ] Runtime version jelas dan lifecycle dipantau.
- [ ] Artifact minimal.
- [ ] Dependency tree direview.
- [ ] Tidak ada dependency test/docs di artifact.
- [ ] AWS SDK v2 module spesifik dipakai.

### Initialization

- [ ] SDK client direuse.
- [ ] ObjectMapper/validator direuse.
- [ ] Tidak ada remote call berat tanpa timeout di static init.
- [ ] Lazy/eager init dipilih berdasarkan SLO.
- [ ] SnapStart correctness diuji jika aktif.

### Performance

- [ ] Memory power tuning dilakukan.
- [ ] p50/p95/p99 diukur.
- [ ] Cold vs warm dipisahkan.
- [ ] Init/restore duration dimonitor.
- [ ] Timeout budget jelas.

### Reliability

- [ ] Handler idempotent.
- [ ] Downstream timeout jelas.
- [ ] Retry tidak berlapis berlebihan.
- [ ] Batch failure semantics benar.
- [ ] DLQ/alert tersedia untuk async/event source.

### Security

- [ ] Tidak ada static credential.
- [ ] Secret tidak dilog.
- [ ] IAM least privilege.
- [ ] KMS/secret/cache behavior jelas.

### Operations

- [ ] Dashboard ada.
- [ ] Alarm p95/p99/error/throttle/timeout ada.
- [ ] Runbook cold start/performance ada.
- [ ] Rollback alias/version tersedia.

---

## 34. Common Anti-Patterns

### Anti-Pattern 1 — Membuat SDK Client Per Invocation

Dampak:

- latency naik,
- connection reuse hilang,
- CPU waste,
- cold/warm sama-sama buruk.

### Anti-Pattern 2 — Full Framework Untuk Function Sederhana

Dampak:

- cold start besar,
- artifact besar,
- dependency risk naik.

### Anti-Pattern 3 — Warmup Scheduler Sebagai Solusi Utama

Dampak:

- false confidence,
- tidak menjamin scale-out,
- biaya/noise tambahan.

### Anti-Pattern 4 — Average Latency Reporting

Dampak:

- p99 incident tersembunyi,
- user experience buruk tidak terlihat.

### Anti-Pattern 5 — SnapStart Tanpa Correctness Review

Dampak:

- duplicate uniqueness,
- stale connection,
- stale token/config,
- subtle production bug.

### Anti-Pattern 6 — Memory Minimum Karena Ingin Murah

Dampak:

- CPU kecil,
- duration lama,
- p99 tinggi,
- cost bisa lebih mahal.

### Anti-Pattern 7 — Internal Parallelism Tanpa Limit

Dampak:

- downstream throttle,
- retry storm,
- memory pressure,
- timeout.

---

## 35. Top 1% Mental Model

Engineer biasa bertanya:

```text
Bagaimana cara membuat Lambda Java lebih cepat?
```

Engineer kuat bertanya:

```text
Latency mana yang lambat: init, restore, handler, downstream, retry, GC, network, atau queueing?
```

Engineer top-tier bertanya:

```text
Apa SLO-nya, traffic shape-nya, cold/warm ratio-nya, p99 contributor-nya,
resource/cost frontier-nya, dan correctness risk dari setiap optimasi?
```

Performa Lambda Java bukan satu trik. Ini adalah proses engineering:

1. definisikan SLO,
2. ukur baseline,
3. pisahkan cold/warm/downstream,
4. kurangi dependency,
5. reuse resource,
6. set timeout,
7. tune memory,
8. evaluasi SnapStart/provisioned concurrency,
9. validasi correctness,
10. observasi production,
11. ulangi berdasarkan data.

---

## 36. Ringkasan

Bagian ini membahas bahwa performa Lambda Java adalah hasil interaksi antara JVM, Lambda lifecycle, dependency graph, initialization strategy, memory/CPU allocation, networking, downstream services, dan observability.

Kesimpulan utama:

- Cold start harus didiagnosis, bukan diasumsikan.
- Warm latency sering lebih penting daripada cold latency untuk worker.
- Static initialization berguna, tetapi side effect berbahaya.
- SDK client, serializer, dan immutable resource harus direuse.
- Memory tuning adalah performance dan cost tool, bukan sekadar RAM setting.
- SnapStart mengurangi startup latency tetapi menambah correctness surface.
- Provisioned concurrency cocok untuk strict p99 dan traffic predictable.
- Java 21 dan Java 25 sangat relevan untuk Lambda modern, tetapi dependency/tooling readiness tetap harus diuji.
- Benchmark harus memakai percentile dan memisahkan init/restore/handler/downstream.
- Top-tier engineer mengoptimalkan berdasarkan SLO, measurement, dan failure model.

---

## 37. Referensi Resmi Utama

- AWS Lambda runtimes — runtime Java, lifecycle, dan runtime support policy.
- AWS Lambda Java developer guide — Java handler dan runtime environment.
- AWS Lambda execution environment lifecycle.
- AWS Lambda SnapStart documentation.
- AWS Lambda SnapStart best practices.
- AWS Lambda SnapStart monitoring.
- AWS Lambda Java runtime customization.
- AWS Lambda best practices.
- AWS Lambda quotas.
- AWS Lambda Java packaging documentation.
- AWS SDK for Java 2.x Lambda startup optimization.

---

## 38. Apa Yang Dibahas Berikutnya

Bagian berikutnya adalah:

```text
Part 19 — Lambda Event Sources: SQS, SNS, S3, EventBridge, API Gateway
```

Di sana kita akan membahas bagaimana performa dan correctness Lambda berubah tergantung event source. SQS, SNS, S3, EventBridge, dan API Gateway punya retry semantics, batch behavior, failure model, dan idempotency requirement yang berbeda.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-17-lambda-java-fundamentals.md">⬅️ Part 17 — Lambda Java Fundamentals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-19-lambda-event-sources-sqs-sns-s3-eventbridge-api-gateway.md">Part 19 — Lambda Event Sources: SQS, SNS, S3, EventBridge, API Gateway ➡️</a>
</div>
