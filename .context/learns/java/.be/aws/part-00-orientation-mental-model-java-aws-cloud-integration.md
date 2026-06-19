# Part 0 — Orientation: Mental Model Java + AWS Cloud Integration

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-00-orientation-mental-model-java-aws-cloud-integration.md`  
Scope: Java 8 sampai Java 25, AWS SDK for Java 2.x, Lambda, dan common AWS services  
Status: Part 0 dari 35 — belum bagian terakhir

---

## 0. Tujuan Bagian Ini

Bagian ini bukan tutorial `putObject`, `sendMessage`, atau `invoke Lambda`.

Bagian ini adalah fondasi mental sebelum masuk ke AWS SDK, Lambda, S3, Secrets Manager, Systems Manager Parameter Store, SNS, SQS, KMS, EventBridge, CloudWatch, CloudTrail, IAM, STS, dan pola production lainnya.

Setelah bagian ini, targetnya kamu mampu melihat AWS bukan sebagai kumpulan API, tetapi sebagai kombinasi dari:

1. **remote dependency**,
2. **managed control plane**,
3. **distributed data plane**,
4. **identity and authorization plane**,
5. **failure and retry plane**,
6. **cost and quota plane**,
7. **operational evidence plane**.

Engineer biasa biasanya berhenti di level:

> “Saya panggil S3/SQS/SNS pakai SDK.”

Engineer yang lebih matang berpikir:

> “Saya sedang membuat boundary antar state machine, melewati jaringan, memakai temporary credential, dengan permission tertentu, terhadap managed service yang punya timeout, retry, throttling, quota, cost, audit trail, consistency semantics, dan operational failure mode.”

Perbedaan mental model ini sangat besar.

---

## 1. Kenapa Java + AWS Perlu Dipelajari Sebagai Engineering Discipline

Java backend tradisional sering dipikirkan sebagai:

```text
HTTP request -> controller -> service -> database -> response
```

Begitu masuk AWS-integrated architecture, bentuknya berubah menjadi:

```text
request/event/file/schedule
    -> Java runtime
    -> AWS SDK / Lambda runtime / managed integration
    -> IAM authorization
    -> network path
    -> AWS service control/data plane
    -> retry/throttle/partial failure behavior
    -> audit/log/metric/cost effect
    -> downstream state transition
```

Artinya, satu baris kode seperti:

```java
s3.putObject(request, body);
```

sebenarnya membawa banyak konsekuensi:

- credential apa yang dipakai?
- role mana yang melakukan call?
- region mana?
- bucket policy mengizinkan atau menolak?
- object key aman secara domain?
- timeout berapa?
- retry dilakukan berapa kali?
- upload idempotent atau tidak?
- body dibuffer di heap atau streaming?
- request gagal di client, network, TLS, service, IAM, atau KMS?
- apakah object terenkripsi?
- apakah event S3 memicu workflow lain?
- apakah object lifecycle policy menghapus data terlalu cepat?
- apakah audit event cukup untuk pembuktian?
- apakah biaya request dan storage terkendali?

Top 1% engineer tidak menghafal semua API. Yang mereka punya adalah model sebab-akibat yang stabil.

---

## 2. Seri Ini Berdiri Di Atas Materi yang Sudah Kamu Selesaikan

Karena kamu sudah menyelesaikan seri Java yang luas, seri ini tidak akan mengulang:

- Java syntax dasar,
- collection dan stream dasar,
- concurrency dasar,
- HTTP dasar,
- security/crypto dasar,
- JDBC/HikariCP dasar,
- testing dasar,
- logging dasar,
- deployment dasar,
- reliability dasar,
- Jackson dasar,
- Spring Boot dasar,
- message queue teori dasar secara umum.

Yang akan dilakukan adalah menghubungkan pengetahuan itu ke AWS-specific engineering.

Contoh:

- Dari concurrency → kita pakai untuk SQS poller, async SDK, Lambda concurrency, Netty event loop.
- Dari IO/NIO → kita pakai untuk S3 streaming, multipart upload, memory pressure.
- Dari reliability → kita pakai untuk retry, DLQ, idempotency, timeout, backpressure.
- Dari security → kita pakai untuk IAM, STS, KMS, secret rotation.
- Dari testing → kita pakai untuk emulator, integration test, contract test, AWS sandbox.
- Dari observability → kita pakai untuk AWS request ID, CloudWatch, X-Ray/OpenTelemetry, CloudTrail.
- Dari database/transaction → kita pakai untuk outbox, inbox, idempotency store, compensation.

Jadi seri ini bukan “belajar AWS dari nol”, tetapi “menempatkan AWS sebagai runtime extension dari sistem Java production-grade”.

---

## 3. Versi Java: Dari Java 8 Sampai Java 25

Seri ini membahas Java 8 sampai Java 25, tetapi perlu dibedakan antara:

1. **source compatibility**,
2. **runtime capability**,
3. **AWS runtime availability**,
4. **enterprise migration reality**.

### 3.1 Java 8

Java 8 masih banyak ditemukan di enterprise. Untuk AWS SDK for Java 2.x, Java 8 masih relevan karena SDK v2 mendukung Java 8+. Tetapi dari sisi production modern, Java 8 punya keterbatasan:

- GC modern tidak sebaik versi baru,
- TLS/security baseline lebih tua,
- container ergonomics lebih terbatas dibanding Java modern,
- language feature lebih minim,
- observability/JFR modern terbatas,
- migration pressure makin tinggi.

Dalam seri ini, Java 8 akan tetap dibahas terutama untuk:

- legacy migration,
- SDK v1 ke v2,
- dependency compatibility,
- packaging lama,
- runtime constraint di enterprise.

### 3.2 Java 11

Java 11 adalah jembatan LTS lama yang masih banyak digunakan. Banyak organisasi berpindah dari Java 8 ke Java 11 sebelum ke Java 17/21.

Relevansi Java 11:

- baseline LTS lama,
- lebih baik untuk container dibanding Java 8,
- banyak library enterprise stabil di Java 11,
- cocok untuk transisi AWS SDK v2.

### 3.3 Java 17

Java 17 adalah baseline modern yang relatif aman untuk banyak organisasi.

Relevansi:

- LTS,
- language feature lebih matang,
- runtime lebih baik,
- cocok untuk Spring Boot 3.x,
- cocok untuk Lambda/serverless modern,
- lebih layak sebagai target migration dari Java 8/11.

### 3.4 Java 21

Java 21 sangat relevan untuk workload modern.

Keunggulan utama:

- LTS,
- virtual threads,
- pattern matching modern,
- runtime improvement,
- container ergonomics lebih baik,
- cocok untuk service yang banyak melakukan blocking remote calls jika dirancang dengan benar.

Namun, virtual threads tidak otomatis membuat sistem AWS-integrated menjadi benar. Kamu tetap harus mengatur:

- HTTP connection pool,
- timeout,
- retry,
- downstream quota,
- backpressure,
- queue depth,
- idempotency.

Virtual threads memperbesar kemampuan concurrency di sisi aplikasi, tetapi AWS service tetap punya quota dan throttling.

### 3.5 Java 25

Java 25 relevan sebagai Java modern terbaru di horizon seri ini. Untuk Lambda, AWS sudah mengumumkan dukungan Java 25 sebagai managed runtime dan container base image. Ini membuat Java 25 semakin penting untuk engineer yang ingin siap pada runtime baru.

Namun, pada enterprise, adopsi Java 25 biasanya tidak langsung. Seri ini akan memakai prinsip:

```text
Design portable architecture first.
Optimize per Java runtime second.
```

Artinya:

- desain timeout/retry/IAM/idempotency tidak tergantung Java 25,
- tuning cold start dan packaging bisa berbeda per runtime,
- kode domain sebaiknya tidak terlalu terikat ke fitur runtime yang menyulitkan migration,
- gunakan fitur modern jika memberi keuntungan jelas.

---

## 4. SDK Version Reality: AWS SDK for Java v1 vs v2

Untuk seri ini, default-nya adalah **AWS SDK for Java 2.x**.

Alasannya:

- SDK v2 adalah generasi modern,
- mendukung client immutable dan builder pattern yang lebih bersih,
- mendukung sync dan async client,
- memiliki model HTTP client yang lebih fleksibel,
- punya retry/timeout configuration yang lebih eksplisit,
- lebih cocok untuk aplikasi modern dan cloud-native,
- SDK v1 telah memasuki jalur end-of-support.

AWS mengumumkan bahwa AWS SDK for Java v1.x masuk maintenance mode pada 31 Juli 2024 dan end-of-support pada 31 Desember 2025. Setelah itu SDK v1 tidak lagi menjadi pilihan strategis untuk sistem baru.

Implikasi engineering:

```text
New system      -> use SDK v2
Existing v1 app -> plan migration
Legacy frozen   -> isolate and risk-manage
```

Jangan membangun sistem baru dengan SDK v1 kecuali ada constraint keras yang benar-benar tidak bisa dihindari.

---

## 5. AWS Bukan Library, AWS Adalah Remote System

Kesalahan awal yang umum:

> “Saya import dependency AWS SDK, berarti ini library lokal.”

Secara teknis SDK memang library lokal. Tetapi call SDK ke AWS adalah remote operation.

Artinya setiap call AWS harus dipikirkan seperti distributed system call:

```text
Java process
  -> SDK client
  -> credential provider
  -> signer
  -> HTTP client
  -> DNS
  -> TCP/TLS
  -> AWS endpoint
  -> IAM authorization
  -> service control/data plane
  -> response/error
```

Konsekuensinya:

- bisa lambat,
- bisa timeout,
- bisa gagal sementara,
- bisa gagal permanen,
- bisa berhasil tetapi response hilang,
- bisa berhasil sebagian,
- bisa ter-throttle,
- bisa kena permission denial,
- bisa salah region,
- bisa salah account,
- bisa salah KMS key,
- bisa dikenakan biaya,
- bisa meninggalkan audit trail,
- bisa memicu event downstream.

Top 1% engineer memperlakukan AWS call sebagai **state transition across trust boundary**.

---

## 6. Tujuh Plane Mental Model AWS Integration

Untuk memahami AWS-integrated Java system, gunakan tujuh plane berikut.

```text
+---------------------------+
|  1. Application Plane      |
+---------------------------+
|  2. SDK / Runtime Plane    |
+---------------------------+
|  3. Identity Plane         |
+---------------------------+
|  4. Network Plane          |
+---------------------------+
|  5. Service Plane          |
+---------------------------+
|  6. Observability Plane    |
+---------------------------+
|  7. Cost / Quota Plane     |
+---------------------------+
```

### 6.1 Application Plane

Ini adalah kode Java kamu:

- service class,
- Lambda handler,
- Spring Boot bean,
- SQS worker,
- file processor,
- scheduler job,
- integration adapter.

Di plane ini kamu mengontrol:

- business invariant,
- request validation,
- idempotency key,
- retry decision di level aplikasi,
- error classification,
- audit event,
- transaction boundary,
- graceful shutdown,
- resource lifecycle.

Contoh pertanyaan application plane:

- Apakah operasi ini command atau event?
- Apakah aman diulang?
- Apakah side effect boleh terjadi lebih dari sekali?
- Apakah harus sinkron atau asinkron?
- Apa yang terjadi jika downstream lambat?
- Apa state transition yang valid?

### 6.2 SDK / Runtime Plane

Ini adalah AWS SDK, Lambda runtime, HTTP client, serializer, signer, retry engine.

Di plane ini kamu mengontrol:

- sync vs async client,
- HTTP transport,
- connection pool,
- timeout,
- retry policy,
- paginator,
- waiter,
- execution interceptor,
- request override,
- client lifecycle.

Contoh pertanyaan SDK plane:

- Client dibuat sekali atau per request?
- Timeout total berapa?
- Timeout per attempt berapa?
- Retry mode apa?
- HTTP pool cukup untuk concurrency?
- Async client memakai Netty event loop yang benar?
- Response streaming ditutup dengan benar?

### 6.3 Identity Plane

Ini adalah siapa yang memanggil AWS.

Di plane ini terdapat:

- IAM principal,
- role,
- policy,
- STS session,
- Lambda execution role,
- ECS task role,
- EC2 instance profile,
- EKS IRSA,
- resource policy,
- KMS key policy.

Contoh pertanyaan identity plane:

- Role apa yang dipakai aplikasi?
- Permission minimum apa yang dibutuhkan?
- Apakah access lintas account?
- Apakah KMS key policy mengizinkan?
- Apakah bucket/queue/topic policy cocok?
- Apakah temporary credential expire?
- Apakah local dev memakai credential berbeda dari production?

### 6.4 Network Plane

Ini adalah jalur dari aplikasi ke AWS endpoint.

Di plane ini terdapat:

- DNS,
- TCP,
- TLS,
- NAT Gateway,
- VPC endpoint,
- proxy,
- firewall,
- route table,
- security group,
- private subnet,
- public endpoint.

Contoh pertanyaan network plane:

- Aplikasi keluar lewat NAT atau VPC endpoint?
- Latency dari region mana?
- DNS cache behavior bagaimana?
- TLS handshake timeout berapa?
- Apakah connection reuse terjadi?
- Apakah proxy memutus idle connection?
- Apakah private subnet bisa akses AWS service?

### 6.5 Service Plane

Ini adalah layanan AWS tujuan:

- S3,
- SQS,
- SNS,
- Lambda,
- Secrets Manager,
- SSM Parameter Store,
- KMS,
- EventBridge,
- DynamoDB,
- CloudWatch,
- CloudTrail.

Setiap service punya semantics sendiri.

Contoh:

- S3 adalah object store, bukan filesystem.
- SQS Standard adalah at-least-once delivery dan best-effort ordering.
- SNS adalah pub/sub fan-out, bukan durable queue per consumer kecuali dikombinasikan dengan SQS.
- Lambda adalah execution environment managed by AWS, bukan server permanen.
- Secrets Manager adalah secret lifecycle system, bukan sekadar config map.
- KMS adalah key management and cryptographic operation service, bukan library crypto lokal.

### 6.6 Observability Plane

Ini adalah bukti operasional.

Di plane ini terdapat:

- application log,
- CloudWatch log,
- metric,
- trace,
- AWS request ID,
- correlation ID,
- CloudTrail event,
- audit record,
- DLQ inspection,
- dashboard,
- alarm.

Contoh pertanyaan observability plane:

- Jika request gagal, bisa tahu AWS request ID-nya?
- Bisa bedakan throttling vs IAM denial vs timeout?
- Bisa tahu retry count?
- Bisa tahu age of oldest SQS message?
- Bisa tahu cold start Lambda?
- Bisa rekonstruksi timeline incident?
- Bisa membuktikan siapa mengakses secret?

### 6.7 Cost / Quota Plane

Ini adalah batas dan biaya.

Di plane ini terdapat:

- API quota,
- service quota,
- Lambda concurrency,
- S3 request cost,
- SQS request cost,
- SNS fan-out cost,
- KMS request cost,
- Secrets Manager API cost,
- CloudWatch log ingestion cost,
- NAT Gateway cost,
- data transfer cost.

Contoh pertanyaan cost/quota plane:

- Apakah polling SQS terlalu agresif?
- Apakah secret diambil setiap request?
- Apakah KMS dipanggil terlalu sering?
- Apakah log terlalu verbose?
- Apakah Lambda concurrency bisa membanjiri database?
- Apakah S3 object kecil terlalu banyak sehingga request cost naik?
- Apakah retry storm membuat biaya dan throttling makin parah?

---

## 7. AWS API Call sebagai State Transition

Setiap call AWS perlu dilihat sebagai transisi state.

Contoh S3 upload:

```text
Before:
  object does not exist, or old version exists

Action:
  PutObject(bucket, key, body, metadata, encryption, tags)

After:
  object exists with bytes, metadata, version, encryption state, event side effect
```

Contoh SQS send:

```text
Before:
  message not in queue

Action:
  SendMessage(queue, body, attributes, deduplication id?)

After:
  message eventually available for consumer
```

Contoh Secrets Manager get:

```text
Before:
  application has no secret value in memory/cache

Action:
  GetSecretValue(secretId, versionStage?)

After:
  application holds sensitive material in process memory
```

Contoh Lambda invoke:

```text
Before:
  target function waiting for invoke or no warm environment

Action:
  Invoke(function, payload, invocationType)

After:
  function executed synchronously/asynchronously, possibly with side effects
```

Dengan model ini, kamu akan otomatis bertanya:

- Apakah transisi ini idempotent?
- Apakah transisi ini bisa diulang?
- Apakah transisi ini punya side effect downstream?
- Apakah ada race condition?
- Apakah ada partial completion?
- Apakah ada audit trail?
- Apakah ada compensation?

---

## 8. Control Plane vs Data Plane

Banyak engineer tidak membedakan control plane dan data plane. Padahal ini penting.

### 8.1 Control Plane

Control plane mengelola konfigurasi dan resource.

Contoh:

- create bucket,
- create queue,
- create topic,
- create Lambda function,
- update IAM policy,
- update secret rotation config,
- create KMS key,
- configure EventBridge rule.

Control plane biasanya:

- lebih jarang dipanggil oleh aplikasi runtime,
- dipanggil oleh IaC/CI/CD/admin tooling,
- punya permission lebih sensitif,
- harus sangat dibatasi,
- sering menjadi bagian governance.

### 8.2 Data Plane

Data plane menjalankan operasi runtime.

Contoh:

- put object ke S3,
- get object dari S3,
- send message ke SQS,
- receive message dari SQS,
- publish ke SNS,
- get secret value,
- decrypt via KMS,
- invoke Lambda.

Data plane biasanya:

- dipanggil oleh aplikasi,
- frekuensinya tinggi,
- sensitif terhadap latency dan cost,
- perlu timeout/retry/backpressure,
- perlu least privilege spesifik.

### 8.3 Rule of Thumb

```text
Application runtime should mostly use data-plane permissions.
Provisioning pipeline should use control-plane permissions.
```

Anti-pattern:

- aplikasi runtime punya permission `s3:*`, `sqs:*`, `iam:*`, `kms:*`,
- aplikasi membuat resource sendiri tanpa governance,
- Lambda execution role bisa update policy dirinya sendiri,
- worker bisa purge queue production.

---

## 9. AWS Service as Boundary, Not Utility

Sebuah service AWS bukan hanya utilitas.

Ia bisa berperan sebagai:

1. **storage boundary**,
2. **queue boundary**,
3. **security boundary**,
4. **execution boundary**,
5. **audit boundary**,
6. **organization/account boundary**,
7. **cost boundary**.

Contoh SQS.

SQS bukan cuma “tempat taruh message”. Ia adalah boundary antara producer dan consumer.

```text
Producer service
  -> SendMessage
  -> SQS queue
  -> ReceiveMessage
  -> Consumer worker
```

Boundary ini memberi:

- temporal decoupling,
- retry buffer,
- load smoothing,
- failure isolation,
- DLQ routing,
- operational visibility.

Tetapi boundary ini juga menambahkan:

- duplicate delivery,
- out-of-order risk,
- visibility timeout complexity,
- poison message problem,
- queue age monitoring,
- idempotency requirement.

Top-tier thinking selalu dua sisi:

```text
What capability does this AWS service give me?
What new failure mode does it introduce?
```

---

## 10. Service Map: Apa Peran Setiap Common AWS Service

Bagian ini memberi peta awal. Detail tiap service akan dibahas di part berikutnya.

### 10.1 S3

S3 adalah object storage.

Gunakan untuk:

- file upload/download,
- archive,
- report output,
- data lake landing,
- document storage,
- batch input/output,
- static artifact,
- event source.

Jangan anggap S3 sebagai:

- filesystem biasa,
- database relational,
- queue,
- lock manager,
- transaction log yang mudah dipakai sembarangan.

Mental model:

```text
S3 = durable object store with key-addressed immutable-ish blobs and metadata
```

Pertanyaan desain:

- key naming berdasarkan domain apa?
- object size berapa?
- perlu versioning?
- perlu lifecycle?
- perlu retention/legal hold?
- perlu encryption KMS?
- perlu presigned URL?
- siapa boleh baca/tulis?
- apakah upload memicu event?

### 10.2 SQS

SQS adalah queue managed.

Gunakan untuk:

- async processing,
- retry buffer,
- workload smoothing,
- decoupling,
- DLQ,
- worker pool,
- Lambda event source.

Mental model:

```text
SQS = durable at-least-once delivery buffer between producer and consumer
```

Pertanyaan desain:

- Standard atau FIFO?
- message body schema apa?
- idempotency key apa?
- visibility timeout berapa?
- batch size berapa?
- DLQ policy apa?
- redrive bagaimana?
- ordering penting atau tidak?
- consumer concurrency berapa?

### 10.3 SNS

SNS adalah pub/sub topic.

Gunakan untuk:

- fan-out event,
- notification,
- publish to multiple subscribers,
- SNS to SQS pattern,
- SNS to Lambda pattern.

Mental model:

```text
SNS = event fan-out router, not per-consumer durable queue by itself
```

Pertanyaan desain:

- subscriber siapa?
- filter policy apa?
- payload contract apa?
- raw message delivery perlu?
- cross-account subscriber ada?
- apakah setiap subscriber perlu queue sendiri?
- bagaimana retry dan DLQ per subscription?

### 10.4 Lambda

Lambda adalah managed function execution environment.

Gunakan untuk:

- event processing,
- lightweight integration,
- scheduled task,
- file trigger,
- queue consumer,
- API endpoint kecil,
- automation glue.

Mental model:

```text
Lambda = managed ephemeral compute with lifecycle, concurrency, timeout, and event-source semantics
```

Pertanyaan desain:

- cold start acceptable?
- timeout berapa?
- memory berapa?
- reserved concurrency perlu?
- downstream bisa menahan concurrency Lambda?
- handler idempotent?
- batch failure behavior bagaimana?
- package size berapa?
- dependency terlalu berat?

### 10.5 Secrets Manager

Secrets Manager adalah secret lifecycle service.

Gunakan untuk:

- database password,
- API key,
- third-party credential,
- rotating secret,
- secret auditability.

Mental model:

```text
Secrets Manager = managed secret lifecycle with versioning, rotation, access control, and auditability
```

Pertanyaan desain:

- secret di-load kapan?
- cache TTL berapa?
- rotation bagaimana?
- stale secret ditangani bagaimana?
- log aman?
- heap dump aman?
- siapa boleh read?
- KMS key apa?

### 10.6 SSM Parameter Store

Parameter Store adalah configuration and parameter hierarchy service.

Gunakan untuk:

- environment config,
- feature flag sederhana,
- non-secret config,
- SecureString sederhana,
- hierarchical config.

Mental model:

```text
SSM Parameter Store = managed configuration hierarchy, optionally encrypted
```

Pertanyaan desain:

- parameter naming convention apa?
- config berubah runtime atau saat startup?
- cache perlu?
- SecureString cukup atau harus Secrets Manager?
- permission path-level bagaimana?

### 10.7 KMS

KMS adalah managed key and cryptographic operation service.

Gunakan untuk:

- envelope encryption,
- service encryption,
- data key generation,
- decrypt operation,
- audit of cryptographic use,
- centralized key policy.

Mental model:

```text
KMS = remote cryptographic authority and key governance system
```

Pertanyaan desain:

- key policy mengizinkan siapa?
- encryption context apa?
- apakah request KMS terlalu sering?
- perlu data key cache?
- multi-region key perlu?
- rotation policy bagaimana?

### 10.8 EventBridge

EventBridge adalah event bus/router dan scheduler.

Gunakan untuk:

- event routing,
- scheduled event,
- integration event,
- SaaS event,
- archive/replay event,
- decoupled choreography.

Mental model:

```text
EventBridge = event routing and scheduling fabric
```

Pertanyaan desain:

- event source naming apa?
- detail-type naming apa?
- schema governance bagaimana?
- archive/replay perlu?
- rule pattern apa?
- SNS atau EventBridge lebih cocok?

### 10.9 CloudWatch

CloudWatch adalah metric/log/alarm system.

Gunakan untuk:

- logs,
- metrics,
- alarms,
- dashboards,
- log insights,
- operational visibility.

Mental model:

```text
CloudWatch = operational telemetry and alerting surface
```

Pertanyaan desain:

- metric apa yang penting?
- log structure apa?
- alarm threshold apa?
- log retention berapa?
- biaya ingestion bagaimana?
- query untuk incident apa?

### 10.10 CloudTrail

CloudTrail adalah audit trail untuk AWS API activity.

Gunakan untuk:

- audit,
- forensic,
- compliance,
- IAM debugging,
- who-did-what evidence.

Mental model:

```text
CloudTrail = AWS API audit evidence plane
```

Pertanyaan desain:

- management event cukup?
- data event perlu untuk S3/Lambda?
- retention berapa?
- siapa boleh akses log?
- bagaimana korelasikan CloudTrail dengan application correlation ID?

### 10.11 STS

STS adalah temporary credential and role assumption service.

Gunakan untuk:

- assume role,
- cross-account access,
- federated identity,
- temporary session,
- scoped session policy.

Mental model:

```text
STS = temporary identity vending machine
```

Pertanyaan desain:

- role apa diasumsikan?
- duration berapa?
- external ID perlu?
- session name apa?
- audit trail cukup jelas?
- role chaining terjadi?

---

## 11. Lambda vs Container Worker vs Long-Running Java Service

Tidak semua workload cocok untuk Lambda. Tidak semua workload perlu Kubernetes. Tidak semua workload perlu long-running service.

Gunakan perbandingan berikut.

### 11.1 Lambda cocok ketika

- event-driven kecil sampai menengah,
- bursty workload,
- tidak butuh koneksi long-lived kompleks,
- timeout masih masuk batas Lambda,
- cold start acceptable atau bisa dimitigasi,
- deployment unit kecil,
- tidak perlu kontrol penuh runtime host,
- scale-to-zero menguntungkan.

Contoh:

- process S3 upload event,
- consume SQS message ringan,
- scheduled cleanup,
- publish notification,
- validate payload,
- transform small object,
- webhook adapter.

### 11.2 Container worker cocok ketika

- processing lama,
- throughput tinggi dan stabil,
- butuh kontrol concurrency detail,
- butuh connection pooling stabil,
- warm runtime penting,
- butuh local disk/cache lebih kompleks,
- perlu custom runtime tuning,
- queue consumer jangka panjang.

Contoh:

- large file processing,
- high-throughput SQS consumer,
- batch enrichment,
- streaming-ish workload,
- expensive JVM warmup,
- service dengan heavy dependency.

### 11.3 Long-running service cocok ketika

- ada HTTP API yang terus aktif,
- butuh in-memory cache besar,
- butuh connection pool intensif,
- butuh predictable latency,
- butuh complex coordination,
- domain service memiliki stateful lifecycle internal.

### 11.4 Decision Matrix

| Pertanyaan | Lambda | Container Worker | Long-running Service |
|---|---:|---:|---:|
| Workload sporadis | Sangat cocok | Cukup | Kurang efisien |
| Workload konstan tinggi | Bisa mahal/kompleks | Cocok | Cocok |
| Cold start sensitif | Perlu mitigasi | Lebih aman | Lebih aman |
| Processing lama | Terbatas | Cocok | Cocok |
| Operasional sederhana | Cocok | Sedang | Sedang/tinggi |
| Kontrol runtime detail | Terbatas | Baik | Baik |
| Event source AWS native | Sangat cocok | Cocok | Cocok |
| Koneksi DB intensif | Hati-hati | Cocok | Cocok |

Rule:

```text
Choose Lambda for event glue and elastic small units.
Choose worker for sustained queue processing.
Choose service for stable API/domain capability.
```

---

## 12. Sync vs Async Integration

AWS integration sering salah karena semua dibuat synchronous.

### 12.1 Synchronous Call

Contoh:

```text
User request -> Java API -> AWS call -> response to user
```

Kelebihan:

- sederhana,
- response langsung,
- mudah dipahami,
- cocok untuk read/query kecil.

Kekurangan:

- user latency bergantung AWS,
- failure langsung mempengaruhi request,
- retry memperpanjang latency,
- sulit menahan spike,
- downstream throttling cepat terasa.

Cocok untuk:

- generate presigned URL,
- read config saat startup,
- get small object metadata,
- publish command ringan jika failure bisa dikembalikan.

### 12.2 Asynchronous Call via Queue/Event

Contoh:

```text
User request -> Java API -> SQS/SNS/EventBridge -> worker/Lambda -> downstream
```

Kelebihan:

- decoupling,
- retry terpisah,
- load smoothing,
- response cepat,
- failure bisa diisolasi,
- DLQ bisa dipakai.

Kekurangan:

- eventual consistency,
- user tidak langsung tahu hasil final,
- perlu idempotency,
- perlu status tracking,
- perlu observability lebih matang,
- duplicate/out-of-order handling.

Cocok untuk:

- document processing,
- notification,
- case escalation,
- report generation,
- external API integration,
- long-running workflow step.

### 12.3 Rule

```text
Use sync when caller needs immediate result and operation is bounded.
Use async when operation is slow, retryable, side-effectful, or should be isolated.
```

---

## 13. Request/Response vs Event vs Command

Dalam AWS-integrated system, kamu harus membedakan tiga bentuk komunikasi.

### 13.1 Request/Response

```text
Caller asks for a result now.
```

Contoh:

- get object metadata,
- generate presigned URL,
- validate token,
- read parameter.

Karakteristik:

- caller menunggu,
- timeout pendek,
- error dikembalikan,
- retry hati-hati.

### 13.2 Command

```text
Caller asks another component to do something.
```

Contoh:

- ProcessDocumentCommand,
- SendEmailCommand,
- StartScreeningCommand,
- GenerateReportCommand.

Karakteristik:

- imperative,
- target biasanya jelas,
- idempotency penting,
- boleh asynchronous,
- status tracking penting.

### 13.3 Event

```text
Something happened.
```

Contoh:

- CaseCreated,
- DocumentUploaded,
- ScreeningCompleted,
- AppealSubmitted.

Karakteristik:

- past tense,
- publisher tidak tahu semua consumer,
- fan-out mungkin,
- schema evolution penting,
- replay mungkin,
- subscriber harus idempotent.

### 13.4 Kesalahan Umum

Banyak sistem menyebut semua message sebagai event, padahal isinya command.

Contoh buruk:

```json
{
  "eventType": "SendEmailNow",
  "recipient": "..."
}
```

Itu command, bukan event.

Lebih benar:

```json
{
  "commandType": "SendCaseNotification",
  "caseId": "CASE-123",
  "template": "CASE_CREATED"
}
```

Atau event yang benar:

```json
{
  "eventType": "CaseCreated",
  "caseId": "CASE-123",
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

Kenapa ini penting?

Karena retry, ownership, idempotency, dan audit berbeda.

---

## 14. Idempotency sebagai Hukum Dasar AWS Integration

Kalau kamu hanya membawa satu prinsip dari Part 0, bawa ini:

```text
Every AWS-integrated side effect must be designed as retry-safe.
```

Kenapa?

Karena:

- SDK bisa retry,
- network bisa timeout setelah service berhasil,
- SQS bisa deliver message lebih dari sekali,
- Lambda bisa reinvoke event,
- SNS bisa retry subscription delivery,
- EventBridge bisa replay,
- user bisa klik ulang,
- deployment bisa restart worker,
- batch job bisa dijalankan ulang.

Idempotency artinya operasi yang sama jika diulang tidak merusak state.

### 14.1 Contoh Non-Idempotent

```text
Receive SQS message -> insert payment row -> send notification -> delete message
```

Jika worker crash setelah insert payment tetapi sebelum delete message, message bisa diterima lagi. Jika insert tidak idempotent, payment bisa dobel.

### 14.2 Contoh Lebih Aman

```text
Receive SQS message
  -> derive idempotency key
  -> check processed table
  -> perform state transition only if not processed
  -> record processed result
  -> delete message
```

### 14.3 Idempotency Key

Idempotency key bisa berasal dari:

- command ID,
- event ID,
- business ID + transition name,
- object version ID,
- SQS message attribute,
- deduplication ID,
- request ID dari caller.

Jangan gunakan timestamp random sebagai idempotency key kalau tujuannya deduplication.

### 14.4 Idempotency Scope

Selalu tanya:

```text
Idempotent terhadap apa?
```

Contoh:

- per request?
- per object key?
- per case ID?
- per state transition?
- per external transaction?
- per message ID?

Idempotency yang kabur hampir selalu gagal di production.

---

## 15. Timeout Harus Menjadi Design Decision

Default timeout sering tidak sesuai dengan kebutuhan domain.

AWS SDK for Java 2.x menyediakan konfigurasi timeout di level API call dan attempt. API call timeout membatasi total durasi operasi termasuk semua retry, sedangkan attempt timeout membatasi satu percobaan. Ini penting karena tanpa batas yang jelas, thread bisa tertahan terlalu lama dan memperburuk cascading failure.

Mental model:

```text
Total operation budget
  = attempt timeout + retry delay + attempt timeout + retry delay + ...
```

Contoh:

```text
User-facing API SLA: 2 seconds
AWS call max allowed: 500 ms
Retry: maybe 1 quick retry only
Fallback: return accepted/degraded response
```

Untuk background worker:

```text
SQS visibility timeout: 60 seconds
Processing target: < 30 seconds
AWS downstream timeout: 3 seconds per call
Retry: bounded
If fail: leave message for retry or send to DLQ eventually
```

### 15.1 Timeout Layer

Ada banyak timeout:

- application deadline,
- SDK API call timeout,
- SDK attempt timeout,
- connection acquisition timeout,
- TCP connect timeout,
- TLS/socket read timeout,
- SQS visibility timeout,
- Lambda function timeout,
- API Gateway timeout,
- database timeout,
- external partner timeout.

Top-tier engineer menyelaraskan timeout ini.

Anti-pattern:

```text
Lambda timeout = 30 seconds
SQS visibility timeout = 30 seconds
DB query timeout = 60 seconds
SDK call timeout = unlimited-ish
```

Ini buruk karena message bisa visible lagi saat processing pertama belum benar-benar selesai.

---

## 16. Retry Bukan Obat Universal

AWS SDK memiliki retry behavior default untuk error tertentu seperti transient error dan throttling. Namun retry tetap harus dikendalikan.

Retry membantu ketika:

- transient network failure,
- throttling ringan,
- 5xx sementara,
- connection reset,
- service unavailable sementara.

Retry berbahaya ketika:

- permission denied,
- validation error,
- object key salah,
- secret ID salah,
- KMS key policy salah,
- downstream sedang overload parah,
- operasi tidak idempotent,
- semua instance retry bersamaan.

### 16.1 Retry Storm

Retry storm terjadi ketika banyak client gagal lalu retry bersamaan, membuat downstream makin overload.

```text
Service A instances: 100
Each request fails
Each retries 3x
Downstream load becomes ~400 attempts
```

Jika setiap retry juga memicu log, metric, KMS call, secret refresh, atau DB lookup, efeknya bisa berlipat.

### 16.2 Retry Harus Punya

- maximum attempts,
- backoff,
- jitter,
- total deadline,
- error classification,
- idempotency,
- circuit breaker atau backpressure untuk kasus tertentu,
- metric retry count.

---

## 17. Backpressure: Jangan Mengirim Lebih Cepat dari Kemampuan Sistem

AWS memudahkan scale out. Tetapi scale out tanpa backpressure bisa menghancurkan dependency.

Contoh:

```text
SQS queue has 1,000,000 messages
Lambda concurrency scales up
Each Lambda opens DB connection
DB max connection reached
All invocations slow/fail
Messages retry
Queue age increases
Cost increases
```

Masalahnya bukan SQS atau Lambda. Masalahnya adalah tidak ada pengendalian laju.

Backpressure bisa dilakukan dengan:

- reserved concurrency Lambda,
- maximum concurrency event source mapping,
- worker thread pool limit,
- SQS batch size tuning,
- token bucket rate limiter,
- connection pool cap,
- circuit breaker,
- adaptive polling,
- queue partitioning,
- DLQ threshold.

Rule:

```text
Concurrency is not throughput unless downstream can sustain it.
```

---

## 18. Consistency, Ordering, and Delivery Semantics

AWS services punya semantics berbeda.

### 18.1 S3

S3 sekarang menyediakan strong read-after-write consistency untuk put dan delete object pada semua region secara umum. Namun S3 tetap object store, bukan transactional filesystem.

Implikasi:

- setelah successful put, read object by key bisa langsung konsisten,
- tetapi workflow event tetap bisa duplicate/out-of-order,
- listing dan lifecycle tetap harus dipahami dalam konteks object storage,
- overwrite object harus hati-hati dengan versioning dan concurrency.

### 18.2 SQS Standard

SQS Standard mendukung at-least-once delivery dan best-effort ordering. Artinya message bisa terkirim lebih dari sekali dan urutan tidak boleh diasumsikan mutlak.

Implikasi:

- consumer harus idempotent,
- jangan mengandalkan urutan message untuk state transition kritis,
- gunakan FIFO queue jika ordering/dedup group penting,
- tetap desain recovery dan DLQ.

### 18.3 SNS

SNS melakukan publish ke subscription. Retry dan delivery behavior tergantung protocol/subscriber. Jika butuh durability per consumer, pola umum adalah SNS -> SQS per subscriber.

### 18.4 Lambda

Lambda invocation semantics bergantung event source:

- synchronous invoke beda dengan asynchronous invoke,
- SQS event source mapping beda dengan SNS trigger,
- stream source beda dengan API Gateway,
- batch failure behavior harus dipahami.

### 18.5 Rule

```text
Never assume exactly-once unless you can prove it end-to-end.
Usually design for at-least-once + idempotency + deduplication.
```

---

## 19. Identity Is Part of Application Design

IAM bukan pekerjaan “infra saja”. Untuk Java engineer, IAM adalah bagian dari desain aplikasi.

Setiap capability aplikasi harus diterjemahkan ke permission.

Contoh:

```text
Capability:
  Upload generated PDF to case document bucket

Required permission:
  s3:PutObject on arn:aws:s3:::case-documents-prod/generated/*
  kms:Encrypt on specific KMS key if SSE-KMS is used

Not required:
  s3:DeleteBucket
  s3:ListAllMyBuckets
  s3:GetObject on all prefixes
  kms:ScheduleKeyDeletion
```

### 19.1 Permission Boundary by Capability

Daripada satu role besar:

```text
aceas-app-prod-role -> can access everything
```

Lebih baik capability-oriented:

```text
case-document-writer-role
case-document-reader-role
notification-publisher-role
screening-worker-role
secret-reader-role
```

Dalam praktik, jumlah role harus seimbang agar tidak terlalu rumit. Tetapi prinsipnya jelas:

```text
Permission follows capability, not developer convenience.
```

### 19.2 IAM Failure Mode

IAM failure sering muncul sebagai:

- AccessDenied,
- KMS AccessDenied,
- cannot assume role,
- invalid security token,
- expired token,
- missing resource policy,
- wrong region/account,
- VPC endpoint policy denial.

Debugging IAM perlu melihat:

- caller identity,
- action,
- resource ARN,
- condition,
- identity policy,
- resource policy,
- key policy,
- SCP,
- permission boundary,
- session policy.

---

## 20. Region and Account Are First-Class Dimensions

Banyak bug AWS terjadi karena salah region atau salah account.

Jangan pikir:

```text
bucketName = "my-bucket"
```

Pikir:

```text
account = prod
region = ap-southeast-1
bucket = aceas-prod-case-documents
kmsKey = prod document key in same/allowed region
role = case-document-writer-prod
```

### 20.1 Environment Matrix

Minimal matrix:

| Environment | Account | Region | Credential Source | Data Sensitivity |
|---|---|---|---|---|
| local | sandbox/dev | chosen region | profile/SSO | fake/minimal |
| DEV | dev account | app region | role | non-prod |
| UAT | uat account | app region | role | masked/test |
| PROD | prod account | app region | role | real/sensitive |

### 20.2 Naming Convention Matters

Bad:

```text
my-bucket
queue1
secret/db
```

Better:

```text
/aceas/prod/db/main/credentials
aceas-prod-case-document-events
aceas-prod-case-documents-ap-southeast-1
aceas-prod-notification-topic
```

Naming is not cosmetic. Naming reduces operational ambiguity.

---

## 21. AWS and Java Resource Lifecycle

Java engineer harus mengelola lifecycle AWS client dengan benar.

### 21.1 Client Reuse

AWS SDK clients umumnya expensive enough untuk tidak dibuat per request. Mereka membawa configuration, HTTP client, connection pool, credential provider, retry config, dan signer behavior.

Anti-pattern:

```java
public void upload(...) {
    S3Client s3 = S3Client.create();
    s3.putObject(...);
    s3.close();
}
```

Pattern lebih baik:

```text
Create client once at application startup.
Reuse for many requests.
Close during shutdown.
```

Di Spring Boot:

```text
S3Client as singleton bean
SqsClient as singleton bean
SecretsManagerClient as singleton bean
```

Di Lambda:

```text
static final client initialized outside handler
reuse across warm invocations
```

### 21.2 Streaming Resource

S3 download/upload sering melibatkan stream. Stream harus ditutup.

Masalah umum:

- connection leak,
- pool exhaustion,
- heap pressure,
- temp file leak,
- partial read,
- retry tidak aman karena stream tidak repeatable.

### 21.3 Shutdown

Long-running worker harus punya graceful shutdown:

```text
stop polling
finish in-flight message
extend visibility if needed
flush audit/log/metric
close clients
release thread pools
```

Lambda berbeda: kamu tidak mengontrol shutdown seperti server biasa, tetapi tetap harus mendesain handler agar tidak bergantung pada shutdown hook untuk correctness.

---

## 22. Lambda Execution Environment Mental Model

Lambda menjalankan function dalam execution environment. Ada fase initialization, invocation, dan shutdown. Untuk Java, init phase sangat penting karena class loading, dependency initialization, dan client construction bisa mempengaruhi cold start.

Mental model:

```text
Cold start:
  create execution environment
  initialize runtime
  load class
  run static initialization
  construct handler/client/dependencies
  invoke handler

Warm invoke:
  reuse existing environment if available
  invoke handler again
```

### 22.1 Apa yang Boleh Di-Reuse

Boleh reuse:

- AWS SDK client,
- HTTP connection pool,
- Jackson ObjectMapper,
- config cache,
- secret cache dengan TTL,
- immutable lookup table,
- lightweight in-memory cache.

Hati-hati reuse:

- mutable state,
- request-specific user data,
- transaction/session object,
- stale credentials if manually managed,
- stale secret without refresh logic,
- partially initialized state after failure.

### 22.2 Lambda Is Not Stateless by Accident

Lambda sering disebut stateless, tetapi execution environment bisa menyimpan memory antar warm invocation. Artinya:

- jangan simpan data user/request sebagai static mutable state,
- boleh simpan reusable infrastructure object,
- cache harus punya invalidation/TTL,
- handler harus benar walaupun environment baru atau lama.

Rule:

```text
Correctness must not depend on warm reuse.
Performance may benefit from warm reuse.
```

---

## 23. Java AWS Integration Archetypes

Kita akan sering merujuk beberapa archetype berikut.

### 23.1 API Adapter

```text
HTTP API -> Java service -> AWS service -> response
```

Contoh:

- generate S3 presigned URL,
- publish notification request,
- start async processing command,
- read object metadata.

Key concern:

- latency,
- timeout,
- user-facing error,
- permission,
- request validation.

### 23.2 Queue Worker

```text
SQS -> Java worker -> process -> delete message
```

Key concern:

- long polling,
- batch size,
- visibility timeout,
- idempotency,
- DLQ,
- graceful shutdown,
- backpressure.

### 23.3 Event Fan-Out Publisher

```text
Domain service -> SNS/EventBridge -> multiple subscribers
```

Key concern:

- event contract,
- versioning,
- schema compatibility,
- subscriber isolation,
- replay.

### 23.4 File Processing Pipeline

```text
S3 upload -> event -> SQS/Lambda/worker -> process object -> output/audit
```

Key concern:

- object key design,
- duplicate event,
- large file streaming,
- quarantine,
- partial failure,
- lifecycle.

### 23.5 Secret/Config Consumer

```text
Java app -> Secrets Manager/SSM -> cache -> use config/secret
```

Key concern:

- startup dependency,
- cache TTL,
- rotation,
- log redaction,
- fallback,
- access audit.

### 23.6 Cross-Account Integration

```text
App role -> STS AssumeRole -> target account service
```

Key concern:

- trust policy,
- external ID,
- session duration,
- audit session name,
- blast radius.

---

## 24. Common Architecture Patterns

### 24.1 Direct SDK Pattern

```text
Java service -> AWS SDK -> AWS service
```

Cocok untuk:

- simple direct dependency,
- low latency operation,
- single service access.

Risiko:

- tight coupling,
- AWS failure langsung mempengaruhi caller,
- sulit testing jika tidak diabstraksi.

### 24.2 Gateway/Adapter Pattern

```text
Domain service -> internal port/interface -> AWS adapter -> AWS SDK
```

Cocok untuk:

- clean architecture,
- testability,
- migration,
- mocking at port level,
- vendor isolation sebagian.

Contoh interface:

```java
public interface DocumentObjectStore {
    StoredObject put(DocumentObject object);
    Optional<DocumentObject> get(DocumentObjectKey key);
}
```

Implementation:

```text
S3DocumentObjectStore implements DocumentObjectStore
```

Benefit:

- domain tidak bocor dengan `S3Client`, `PutObjectRequest`, `ResponseInputStream`, dll.

### 24.3 Queue Boundary Pattern

```text
API -> DB transaction -> outbox -> publisher -> SQS/SNS -> worker
```

Cocok untuk:

- decoupling,
- reliability,
- eventual processing,
- retry isolation.

### 24.4 Fan-Out Pattern

```text
Domain event -> SNS topic -> SQS queue per subscriber -> consumer
```

Benefit:

- subscriber isolated,
- satu subscriber lambat tidak memblokir subscriber lain,
- DLQ per subscriber,
- retry independent.

### 24.5 Claim-Check Pattern

Untuk payload besar:

```text
store payload in S3
send small message with S3 pointer via SQS/SNS
consumer retrieves object
```

Benefit:

- message kecil,
- payload besar tidak memaksa queue/topic,
- bisa retention/lifecycle via S3.

Risiko:

- object lifecycle harus sinkron dengan message retention,
- permission consumer ke S3,
- object integrity,
- duplicate processing.

### 24.6 Outbox Pattern

Untuk menghindari dual-write problem:

```text
DB transaction:
  update domain state
  insert outbox event

Separate publisher:
  read outbox
  publish to SNS/SQS/EventBridge
  mark published
```

Benefit:

- domain state dan event record atomic di DB,
- publish bisa retry,
- audit lebih kuat.

### 24.7 Inbox Pattern

Untuk consumer idempotency:

```text
receive event
check inbox table by eventId
if new:
  process
  mark processed
else:
  ignore safely
```

Benefit:

- duplicate message tidak merusak state,
- audit consumer jelas,
- retry aman.

---

## 25. Anti-Patterns yang Harus Dihindari

### 25.1 AWS Client Per Request

Membuat client per request membuang connection reuse dan bisa membebani resource.

### 25.2 No Timeout

Membiarkan default tanpa memahami deadline membuat failure menggantung.

### 25.3 Blind Retry

Retry semua error tanpa klasifikasi bisa memperburuk incident.

### 25.4 No Idempotency

Consumer SQS/Lambda yang tidak idempotent hampir pasti bermasalah saat retry/duplicate.

### 25.5 Static Access Key di App Config

Long-lived access key di config adalah risiko besar. Gunakan role/temporary credential.

### 25.6 Secret Fetch Per Request

Mengambil secret dari Secrets Manager setiap HTTP request biasanya buruk untuk latency, cost, dan quota. Gunakan cache dengan TTL sesuai risk model.

### 25.7 Treat S3 as Filesystem

S3 object key bukan direktori filesystem. Rename bukan operasi murah seperti local filesystem. Directory listing bukan desain database.

### 25.8 Treat DLQ as Final Solution

DLQ hanya tempat parkir failure. Sistem tetap butuh:

- triage,
- alert,
- replay,
- poison message analysis,
- ownership,
- runbook.

### 25.9 Overusing Lambda for Everything

Lambda bukan pengganti semua service. Workload besar, koneksi intensif, atau processing lama mungkin lebih cocok worker/container.

### 25.10 Missing Audit Context

Log “failed to upload” tanpa case ID, correlation ID, bucket, key, request ID, dan error type tidak cukup untuk production.

---

## 26. Production Readiness Dimensions

Untuk setiap AWS integration, kita akan menilai dengan dimensi berikut.

### 26.1 Correctness

Pertanyaan:

- Apakah state transition valid?
- Apakah duplicate aman?
- Apakah out-of-order aman?
- Apakah partial failure aman?
- Apakah data integrity dijaga?

### 26.2 Resilience

Pertanyaan:

- Timeout jelas?
- Retry bounded?
- DLQ ada?
- Backpressure ada?
- Fallback ada?
- Recovery procedure ada?

### 26.3 Security

Pertanyaan:

- Least privilege?
- No static credential?
- Encryption benar?
- Secret aman?
- KMS policy benar?
- Resource policy benar?

### 26.4 Observability

Pertanyaan:

- Log structured?
- Metric cukup?
- Trace/correlation ada?
- AWS request ID terekam?
- CloudTrail bisa dipakai?
- Alarm actionable?

### 26.5 Performance

Pertanyaan:

- Client reused?
- Pool size benar?
- Streaming aman?
- Cold start acceptable?
- Batch size optimal?
- Concurrency sesuai downstream?

### 26.6 Cost

Pertanyaan:

- API call volume wajar?
- Retry cost terkendali?
- Log cost terkendali?
- KMS/Secrets call dicache?
- S3 lifecycle benar?

### 26.7 Operability

Pertanyaan:

- Runbook ada?
- Replay procedure ada?
- DLQ triage ada?
- Secret rotation procedure ada?
- Rollback aman?
- Dashboard tersedia?

---

## 27. Worked Example: Upload Document ke S3 Secara Naif vs Production-Grade

### 27.1 Naive Version

```java
public void upload(byte[] bytes, String fileName) {
    S3Client s3 = S3Client.create();
    s3.putObject(
        PutObjectRequest.builder()
            .bucket("documents")
            .key(fileName)
            .build(),
        RequestBody.fromBytes(bytes)
    );
}
```

Masalah:

- bucket hardcoded,
- key tidak domain-safe,
- client dibuat per call,
- seluruh file ada di heap,
- tidak ada timeout eksplisit,
- tidak ada encryption intent,
- tidak ada metadata/audit,
- tidak ada idempotency,
- tidak ada error classification,
- tidak ada observability,
- tidak ada handling partial failure,
- tidak jelas region/credential,
- tidak jelas permission minimum,
- tidak ada content type/checksum,
- tidak ada strategy untuk large file.

### 27.2 Production Thinking

Sebelum menulis kode, jawab:

```text
Domain:
  Document milik case apa?
  Apakah dokumen immutable?
  Apakah bisa upload ulang?
  Apakah butuh versioning?

Identity:
  Role apa yang boleh upload?
  Prefix mana yang boleh ditulis?
  KMS key mana?

Data:
  Ukuran file maksimum?
  Content type?
  Checksum?
  Metadata?
  Virus scanning?

Reliability:
  Timeout?
  Retry?
  Multipart?
  Idempotency key?
  Jika upload berhasil tapi DB update gagal?

Observability:
  Correlation ID?
  AWS request ID?
  Audit event?
  Metric upload latency/size/failure?

Operations:
  Lifecycle?
  Retention?
  Delete policy?
  Quarantine?
```

### 27.3 Better Shape

```text
DocumentUploadService
  -> validate command
  -> generate domain object key
  -> calculate/check checksum
  -> call DocumentObjectStore port
  -> store metadata transactionally
  -> emit DocumentUploaded event/outbox
  -> write audit trail
```

The AWS SDK code lives behind:

```text
S3DocumentObjectStore
```

The domain should not be polluted by low-level AWS request types.

---

## 28. Worked Example: SQS Consumer Naif vs Production-Grade

### 28.1 Naive Consumer

```java
while (true) {
    ReceiveMessageResponse response = sqs.receiveMessage(...);
    for (Message message : response.messages()) {
        process(message.body());
        sqs.deleteMessage(...);
    }
}
```

Masalah:

- no long polling tuning,
- no concurrency control,
- no idempotency,
- no visibility timeout handling,
- no partial failure strategy,
- no graceful shutdown,
- no DLQ metric,
- no poison message handling,
- no backpressure,
- no structured logs,
- no schema validation,
- no tracing.

### 28.2 Production Consumer

```text
poll with long polling
  -> validate message envelope
  -> extract correlation/idempotency key
  -> acquire processing slot
  -> process with deadline
  -> record idempotency/inbox
  -> delete only after success
  -> on retryable failure: do not delete
  -> on permanent failure: route/mark/let DLQ policy handle
  -> emit metrics/logs/audit
  -> graceful shutdown drains in-flight messages
```

Key invariant:

```text
A message is deleted only after the side effect is safely committed or safely recognized as already processed.
```

---

## 29. Worked Example: Secret Loading Naif vs Production-Grade

### 29.1 Naive

```java
String password = secrets.getSecretValue(...).secretString();
```

called every request.

Masalah:

- latency tinggi,
- cost naik,
- quota pressure,
- secret sering berada di memory/log risk,
- rotation race tidak dipikirkan,
- failure Secrets Manager langsung mematikan request path.

### 29.2 Better

```text
startup:
  load secret or fail depending criticality

runtime:
  cache with TTL
  refresh in controlled path
  detect auth failure from downstream
  force refresh if rotation suspected
  never log value
  expose health carefully
```

Untuk DB credential:

```text
Secrets Manager rotation
  -> old and new credential overlap
  -> HikariCP may hold old connections
  -> app must handle authentication failure / pool refresh strategy
```

---

## 30. What Makes an AWS Java Engineer “Top 1%”

Bukan karena hafal semua API AWS.

Yang membedakan:

### 30.1 Mereka Mendesain Boundary

Mereka tahu kapan harus:

- call langsung,
- queue,
- publish event,
- use Lambda,
- use worker,
- use S3 as claim-check,
- use outbox.

### 30.2 Mereka Mendesain Failure

Mereka tidak bertanya “bagaimana jika berhasil?” saja.

Mereka bertanya:

- bagaimana jika timeout setelah side effect berhasil?
- bagaimana jika message duplicate?
- bagaimana jika event out-of-order?
- bagaimana jika secret rotation terjadi saat traffic tinggi?
- bagaimana jika KMS throttling?
- bagaimana jika Lambda concurrency membanjiri DB?
- bagaimana jika DLQ penuh dengan poison message?

### 30.3 Mereka Mendesain Operability

Mereka membuat sistem yang bisa dioperasikan:

- dashboard,
- alarm,
- runbook,
- replay,
- DLQ triage,
- audit trail,
- correlation ID,
- cost visibility.

### 30.4 Mereka Mendesain Security dari Awal

Mereka tidak menambahkan IAM belakangan.

Mereka mulai dari capability:

```text
This component needs to read only this prefix, write only that prefix, decrypt only this key, publish only this topic.
```

### 30.5 Mereka Memahami Trade-Off

Mereka tidak fanatik Lambda, tidak fanatik Kubernetes, tidak fanatik event-driven.

Mereka memilih berdasarkan:

- latency,
- throughput,
- cost,
- failure isolation,
- team maturity,
- operational burden,
- data sensitivity,
- consistency need.

---

## 31. Step-by-Step Reasoning Template untuk Setiap AWS Integration

Gunakan template ini setiap kali mendesain integration.

### Step 1 — Define the Capability

```text
What business capability is this integration enabling?
```

Contoh:

```text
Store generated compliance report as immutable document.
```

### Step 2 — Identify the State Transition

```text
What state exists before and after the call?
```

Contoh:

```text
Before: report generated but not externally stored.
After: report object exists in S3 and metadata references it.
```

### Step 3 — Choose Communication Mode

```text
Sync, async command, event, queue, file trigger, schedule?
```

### Step 4 — Define Ownership

```text
Who owns the data, event, queue, topic, bucket, secret?
```

### Step 5 — Define Identity

```text
Which role performs the call and what exact permission is required?
```

### Step 6 — Define Idempotency

```text
What key makes repeated execution safe?
```

### Step 7 — Define Timeout and Retry

```text
What is total budget? Which errors are retryable?
```

### Step 8 — Define Failure Outcome

```text
On failure: retry, DLQ, compensate, degrade, alert, rollback?
```

### Step 9 — Define Observability

```text
What logs, metrics, traces, audit records are required?
```

### Step 10 — Define Cost and Quota Guardrails

```text
What request volume, concurrency, and cost are expected?
```

### Step 11 — Define Test Strategy

```text
Unit, integration, emulator, sandbox, replay, chaos/failure injection?
```

### Step 12 — Define Operational Runbook

```text
How do humans inspect, recover, replay, rotate, rollback?
```

---

## 32. Example Design Walkthrough: Case Document Upload

Skenario:

```text
Officer uploads document for a regulatory case.
The system stores the document, records metadata, emits an event, and allows downstream screening.
```

### 32.1 Capability

```text
Case document storage and downstream processing trigger.
```

### 32.2 State Transition

```text
Before:
  Case exists.
  Document not attached.

After:
  Object exists in S3.
  Document metadata exists in DB.
  DocumentUploaded event exists/published.
  Audit trail records actor/action/time.
```

### 32.3 AWS Services

- S3 for object bytes.
- KMS for encryption.
- DB for metadata.
- Outbox table for event reliability.
- SNS/EventBridge for event publish.
- SQS per subscriber for processing.
- CloudWatch for logs/metrics.
- CloudTrail for AWS API evidence.

### 32.4 Critical Invariants

```text
Object must not be publicly readable.
Object key must be scoped to case/document ID.
Metadata must not point to nonexistent object unless recovery handles it.
Duplicate upload command must not create duplicate logical document unless explicitly allowed.
Downstream processing must be idempotent.
```

### 32.5 Failure Cases

| Failure | Risk | Mitigation |
|---|---|---|
| S3 upload fails | no object | return failure/retry safely |
| S3 succeeds, DB insert fails | orphan object | cleanup job or pending metadata recovery |
| DB succeeds, event publish fails | downstream not triggered | outbox publisher retry |
| event duplicate | duplicate processing | inbox/idempotency |
| KMS denied | upload failure | IAM/KMS policy validation |
| object too large | memory/cost issue | multipart/streaming/limit |
| virus scan fails | unsafe file | quarantine state |

### 32.6 Architecture Shape

```text
[API]
  -> validate upload command
  -> [S3 Object Store Adapter]
  -> [DB Metadata Transaction + Outbox]
  -> [Outbox Publisher]
  -> [SNS/EventBridge]
  -> [SQS Screening Queue]
  -> [Screening Worker]
```

This is the type of thinking we will develop throughout the series.

---

## 33. Example Design Walkthrough: Case Escalation Timer

Skenario:

```text
If a case remains in PendingReview for more than 5 working days, escalate to supervisor.
```

Possible AWS designs:

### Option A — EventBridge Scheduler per case

```text
Case enters PendingReview
  -> create schedule for escalation date
  -> schedule invokes Lambda/queues command
```

Pros:

- explicit per-case timer,
- managed scheduling,
- no polling large DB.

Cons:

- many schedules,
- schedule lifecycle management,
- cancellation/update needed when case state changes.

### Option B — Periodic scanner

```text
EventBridge cron -> Java worker/Lambda -> query DB for overdue cases -> enqueue escalation commands
```

Pros:

- simple mental model,
- easy batch control,
- centralized logic.

Cons:

- DB scan/index design,
- delay until next scan,
- duplicate scan handling.

### Option C — SQS delay

```text
Case enters PendingReview -> send delayed message
```

Pros:

- simple for short delays.

Cons:

- delay limit and update/cancel complexity,
- not ideal for long business-calendar logic.

Top-tier answer is not “always use X”. It is:

```text
Choose based on number of timers, cancellation frequency, precision need, operational visibility, and state ownership.
```

---

## 34. Java Abstraction Strategy

Jangan biarkan AWS SDK type menyebar ke seluruh domain.

### 34.1 Bad Coupling

```java
public class CaseService {
    private final S3Client s3;
    private final SqsClient sqs;
    private final SecretsManagerClient secrets;
}
```

Masalah:

- domain service tahu terlalu banyak AWS,
- testing sulit,
- migration sulit,
- business logic bercampur integration logic.

### 34.2 Better Ports

```java
public interface DocumentStore {
    StoredDocument store(StoreDocumentCommand command);
}

public interface DomainEventPublisher {
    void publish(DomainEvent event);
}

public interface SecretProvider {
    DatabaseCredential getDatabaseCredential();
}
```

Adapters:

```text
S3DocumentStore
SnsDomainEventPublisher
SecretsManagerSecretProvider
```

### 34.3 When Direct SDK Is Fine

Direct SDK bisa diterima untuk:

- small internal tooling,
- throwaway migration script,
- infrastructure utility,
- code yang memang adapter layer,
- low-level platform library.

Tetapi untuk domain-heavy enterprise system, gunakan port/adapter.

---

## 35. Configuration Philosophy

AWS-integrated Java app perlu config yang eksplisit.

### 35.1 Config Categories

| Category | Example | Change Frequency | Sensitive? |
|---|---|---:|---:|
| Static app config | service name | rare | no |
| Environment config | region, queue URL | per env | no |
| Secret | DB password | rotation | yes |
| Operational tuning | timeout, batch size | occasional | no |
| Feature flag | enable new publisher | frequent | maybe |
| IAM | role policy | controlled | security-sensitive |

### 35.2 Do Not Mix Everything

Bad:

```text
.env contains all bucket, queue, secret value, password, access key, retry config
```

Better:

```text
Environment variables:
  pointers and lightweight config

SSM Parameter Store:
  non-secret hierarchical config

Secrets Manager:
  secret values and rotation

IAM role:
  identity and permission

Code/config file:
  safe defaults and validation schema
```

### 35.3 Validate at Startup

For critical app, validate:

- required config present,
- region valid,
- bucket name configured,
- queue URL configured,
- timeout sane,
- batch size sane,
- secret reference present,
- no default local placeholder in production.

But avoid doing too many live AWS calls at startup if it causes boot storm or hard dependency. Balance startup validation vs runtime resilience.

---

## 36. Observability Baseline for Every AWS Call

For every important AWS call, capture enough context.

### 36.1 Log Fields

Recommended fields:

```text
timestamp
level
service
operation
correlationId
requestId/internalCommandId
awsService
awsOperation
awsRegion
awsAccountHint if safe
resource logical name
resource ARN/name if safe
latencyMs
attemptCount if available
errorType
awsRequestId if available
outcome
```

Do not log:

- secret value,
- full token,
- password,
- PII unless explicitly governed,
- full document content,
- presigned URL with sensitive signature unless redacted.

### 36.2 Metrics

Baseline metrics:

- call count,
- success count,
- failure count,
- latency percentile,
- throttling count,
- timeout count,
- retry count,
- queue depth,
- age of oldest message,
- DLQ depth,
- Lambda cold start count/indicator,
- object size distribution,
- secret refresh failure.

### 36.3 Tracing

Trace should show:

```text
incoming request/event
  -> domain operation
  -> AWS SDK call
  -> downstream processing
```

Trace without domain identifiers is less useful. But domain identifiers must be safe and governed.

---

## 37. Testing Philosophy

Testing AWS integration needs layers.

### 37.1 Unit Test

Mock your port, not necessarily the AWS SDK everywhere.

Example:

```text
CaseService test -> mock DocumentStore and EventPublisher
```

### 37.2 Adapter Test

Test AWS adapter behavior:

- request mapping,
- metadata mapping,
- error classification,
- retry-safe behavior,
- stream handling.

Can use mocks or local emulator.

### 37.3 Emulator Test

Use tools like LocalStack/Testcontainers where appropriate.

Good for:

- basic S3/SQS/SNS interaction,
- local development,
- contract-ish testing.

But do not assume emulator equals AWS behavior.

### 37.4 Sandbox AWS Integration Test

Needed for:

- IAM,
- KMS,
- Lambda runtime,
- EventBridge,
- service quota behavior,
- real CloudTrail/CloudWatch behavior,
- cross-account access.

### 37.5 Replay Test

For event-driven systems, keep sample events/messages:

- valid event,
- old version event,
- duplicate event,
- malformed event,
- poison message,
- large payload,
- missing object,
- permission failure scenario.

---

## 38. Local Development Strategy

Local development should be productive but honest.

### 38.1 Recommended Local Modes

```text
Mode 1: pure unit tests
Mode 2: local emulator for common flows
Mode 3: dev AWS account for real integration
Mode 4: production-like UAT for release validation
```

### 38.2 Local Credential Rule

Avoid static shared credentials.

Prefer:

- AWS SSO/profile,
- short-lived credentials,
- sandbox account,
- least privilege dev role.

Never let local dev accidentally point to production.

Guardrails:

- environment banner,
- account ID validation,
- explicit profile,
- prod write disabled locally,
- destructive operation confirmation.

---

## 39. Cost Awareness from Day One

Cost is architecture feedback.

Examples:

### 39.1 Secrets Manager Cost

If every request calls Secrets Manager:

```text
100 requests/sec = 8.64 million calls/day
```

That is usually unnecessary and costly. Cache secrets.

### 39.2 CloudWatch Logs Cost

Verbose logging of every message body or large payload can become expensive and risky.

### 39.3 SQS Polling Cost

Short polling too aggressively when queue is empty wastes calls. Long polling reduces empty responses.

### 39.4 KMS Cost/Throttle

Calling KMS decrypt for every record in a hot path can be slow and costly. Use envelope encryption and caching where appropriate.

### 39.5 Lambda Cost

Lambda cost depends on duration, memory, architecture, and request count. More memory can reduce duration, sometimes lowering total cost. But concurrency can also multiply downstream pressure.

Rule:

```text
Cost optimization is not premature optimization when the design multiplies calls by traffic volume.
```

---

## 40. Security Baseline

Minimum baseline for this series:

1. No static AWS access key in application config.
2. Use IAM role/temporary credential.
3. Least privilege per capability.
4. Encrypt sensitive data at rest.
5. Use KMS deliberately.
6. Redact secrets from logs.
7. Do not expose AWS credentials to browser.
8. Use presigned URL carefully with expiration and scope.
9. Separate DEV/UAT/PROD account or at least strong environment boundary.
10. Monitor CloudTrail for sensitive API activity.
11. Avoid wildcard resource/action unless justified.
12. Validate resource policy and KMS key policy.
13. Keep dependency versions maintained.
14. Treat payloads from queues/events as untrusted input.
15. Threat model event replay and duplicate delivery.

---

## 41. How This Series Will Progress

Part 0 gives the mental model.

The next parts will go deeper:

```text
Part 1  -> AWS SDK for Java 2.x internals
Part 2  -> credentials, region, STS, identity
Part 3  -> IAM for Java engineers
Part 4  -> HTTP layer, timeout, retry, backpressure
Part 5  -> error taxonomy and failure modelling
Part 6  -> observability
Part 7  -> testing/local development
Part 8+ -> S3, Secrets, KMS, SQS, SNS, Lambda, EventBridge, etc.
```

Each later part will use the same structure:

```text
mental model
service semantics
Java SDK usage
failure modes
security model
performance model
observability
cost/quota
testing
production patterns
anti-patterns
checklist
```

---

## 42. Practical Checklist: Before Writing Any AWS SDK Code

Use this checklist.

```text
[ ] What business capability is this AWS call supporting?
[ ] Is this call control plane or data plane?
[ ] Which AWS account and region?
[ ] Which IAM role performs the call?
[ ] What exact actions/resources are required?
[ ] Does KMS/resource policy also allow it?
[ ] Is the call synchronous or asynchronous?
[ ] What is the timeout budget?
[ ] What retry behavior is safe?
[ ] Is the operation idempotent?
[ ] What happens if AWS succeeds but app does not receive response?
[ ] What happens if duplicate message/event appears?
[ ] What happens if ordering changes?
[ ] What logs/metrics/traces/audit are needed?
[ ] What is expected call volume?
[ ] What quota can be hit?
[ ] What cost can grow with traffic?
[ ] How is it tested locally?
[ ] How is it tested against real AWS?
[ ] What is the runbook when it fails?
```

---

## 43. Mental Model Summary

AWS SDK is not just a dependency.

It is a bridge from Java process to distributed cloud services.

Lambda is not just a function.

It is a managed execution lifecycle with concurrency, timeout, cold start, event source semantics, and operational constraints.

S3 is not just file storage.

It is object storage with key design, metadata, encryption, lifecycle, event side effects, and data governance.

SQS is not just a queue.

It is a reliability boundary with at-least-once delivery, visibility timeout, duplicate handling, and DLQ operations.

SNS is not just publish.

It is fan-out with subscriber isolation concerns, filtering, retry, and event contract governance.

Secrets Manager and SSM are not just config stores.

They are runtime dependency, security boundary, cost factor, and operational lifecycle mechanism.

KMS is not just encryption.

It is centralized key authority with IAM/key policy, audit, quota, and encryption context semantics.

CloudWatch and CloudTrail are not optional.

They are how you know what happened, why it happened, and whether the system is still defensible.

---

## 44. Final Takeaway

To become excellent at Java AWS engineering, do not start by memorizing service methods.

Start by asking better questions:

```text
What state transition am I creating?
What boundary am I crossing?
Who is allowed to do it?
What can fail?
What can be duplicated?
What can be delayed?
What can be observed?
What can be retried?
What can be recovered?
What can become expensive?
What evidence remains after the fact?
```

That is the foundation of this series.

---

## References

- AWS SDK for Java 2.x Developer Guide — https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS SDK for Java 2.x credentials provider chain — https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html
- AWS SDK for Java 2.x timeout configuration — https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/timeouts.html
- AWS SDK for Java 2.x retry behavior — https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html
- AWS SDK for Java 2.x HTTP client configuration — https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java v1 end-of-support announcement — https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-java-v1-x-on-december-31-2025/
- AWS Lambda runtimes — https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
- AWS Lambda execution environment lifecycle — https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- AWS Lambda Java 21 announcement — https://aws.amazon.com/about-aws/whats-new/2023/11/aws-lambda-support-java-21/
- AWS Lambda Java 25 announcement — https://aws.amazon.com/blogs/compute/aws-lambda-now-supports-java-25/
- Amazon SQS at-least-once delivery — https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html
- Amazon SQS standard queues — https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html
- AWS Well-Architected Framework — https://aws.amazon.com/architecture/well-architected/
- AWS Well-Architected Framework pillars — https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html

---

## Status Seri

Part 0 selesai.  
Seri belum selesai. Masih lanjut ke Part 1: `AWS SDK for Java 2.x Architecture Deep Dive`.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-01-aws-sdk-java-2x-architecture-deep-dive.md">Part 1 — AWS SDK for Java 2.x Architecture Deep Dive ➡️</a>
</div>
