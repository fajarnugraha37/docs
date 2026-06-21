# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-000.md

# Part 000 — Orientation, Scope, Mental Model, and What Changes from Camunda 7

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `000`  
> Fokus: orientasi, mental model, batas scope, perubahan besar dari Camunda 7 ke Camunda 8/Zeebe, dan peta cara berpikir untuk seluruh seri.  
> Target pembaca: Java engineer advanced yang sudah memahami Java, microservices, reliability, messaging, persistence, BPMN/Camunda 7, dan ingin naik ke level production-grade Camunda 8/Zeebe engineering.

---

## 0. Kenapa Part 000 Penting?

Bagian ini bukan tutorial instalasi, bukan contoh `Hello World`, dan bukan pengulangan BPMN dasar.

Tujuannya adalah membangun **kerangka berpikir** yang benar sebelum masuk ke API, Spring Boot integration, job workers, Kubernetes, incident handling, migration, dan production architecture.

Camunda 8/Zeebe sering disalahpahami oleh engineer yang datang dari Camunda 7. Kesalahan paling umum adalah mengira:

> “Camunda 8 itu Camunda 7 yang lebih cloud-native.”

Itu framing yang berbahaya.

Framing yang lebih tepat:

> Camunda 8 adalah platform orchestration cloud-native yang pusat eksekusinya adalah Zeebe: distributed workflow engine berbasis event stream, partitioned state, broker/gateway architecture, external job workers, exporter, dan read-side projections.

Perubahan ini mempengaruhi hampir semua keputusan engineering:

- cara menulis Java code;
- cara memodelkan BPMN;
- cara retry dan handle error;
- cara membuat audit trail;
- cara menghubungkan database transaction dengan process state;
- cara observability;
- cara deployment dan capacity planning;
- cara migration dari Camunda 7;
- cara membangun sistem yang defensible untuk domain regulated/case-management.

Kalau mental model-nya salah, implementasinya biasanya tetap “jalan”, tetapi production behavior-nya rapuh.

---

## 1. Sumber Kebenaran Awal

Materi seri ini mengikuti beberapa prinsip dari dokumentasi resmi dan release notes Camunda 8 terbaru:

1. **Camunda 8 bukan drop-in replacement untuk Camunda 7.** Migrasi tidak cukup dengan mengganti dependency. BPMN model, source code, dan bahkan arsitektur solusi mungkin perlu disesuaikan ulang.
2. **Zeebe architecture terdiri dari client, gateway, broker, dan exporter.** Client berinteraksi melalui gateway; broker menyimpan dan mengeksekusi state orchestration; exporter mengalirkan record ke read-side/projection.
3. **Zeebe internal processing berbasis record stream dan stream processor.** Process, job, dan stateful entity lain dimodelkan sebagai state machine yang berubah melalui command/event record.
4. **Mulai Camunda 8.8, Camunda Java Client menggantikan Zeebe Java Client.** Zeebe Java Client masih tersedia sementara, tetapi deprecated dan direncanakan dihapus pada 8.10.
5. **Camunda Java Client memakai REST sebagai default protocol, dengan gRPC tetap configurable.** Job streaming tetap berkaitan dengan gRPC.
6. **Operate, Tasklist, Optimize, dan read APIs harus dipahami sebagai read-side/projection, bukan sumber tunggal state engine.**

Implikasi praktisnya: engineer yang ingin bekerja serius dengan Camunda 8 harus memahami distributed systems, at-least-once execution, idempotency, event stream, projection lag, worker lifecycle, dan process versioning.

---

## 2. Posisi Seri Ini dalam Roadmap Belajar

Anda sudah menyelesaikan banyak fondasi:

- Java language dan runtime;
- collections/streams;
- concurrency/reactive;
- reliability;
- IO/NIO/networking;
- HTTP/gRPC;
- file/storage;
- security/crypto;
- JDBC/HikariCP;
- JPA/Hibernate;
- MyBatis;
- Flyway/Liquibase;
- Spring Boot;
- Quarkus;
- logging/observability;
- Kafka/RabbitMQ/JMS;
- Redis;
- microservices/design patterns;
- Camunda 7 BPM platform;
- BPMN/process orchestration engineering.

Karena itu, seri ini **tidak akan mengulang**:

- apa itu Java class/interface/generic;
- basic Spring Boot;
- basic HTTP/gRPC;
- basic JSON serialization;
- basic thread pool;
- basic transaction isolation;
- basic BPMN shape;
- basic Camunda 7 process engine;
- basic microservices pattern;
- basic Docker/Kubernetes.

Yang akan dilakukan adalah memakai semua fondasi itu untuk menjawab pertanyaan yang lebih sulit:

> Bagaimana membangun sistem orchestration Camunda 8/Zeebe yang benar secara arsitektur, aman secara operasional, dapat di-debug, dapat dimigrasikan, dapat di-scale, dan dapat dipertanggungjawabkan?

---

## 3. Satu Kalimat Inti Camunda 8/Zeebe

Kalimat yang perlu diingat sepanjang seri:

> Zeebe menyimpan dan menggerakkan state orchestration secara durable dan terdistribusi; Java worker mengeksekusi side effect bisnis secara eksternal, retryable, observable, dan harus idempotent.

Kalimat ini memisahkan dua dunia:

| Dunia | Tanggung Jawab |
|---|---|
| Zeebe engine | process state, token flow, job creation, retry counter, incident, message/timer orchestration, durable progress |
| Java worker | business execution, API call, database write, file generation, email sending, external system integration |

Kesalahan production sering muncul ketika engineer mencampur dua dunia ini tanpa batas yang jelas.

Contoh kesalahan:

- menganggap worker execution exactly-once;
- menyimpan dokumen besar di process variable;
- membuat BPMN sebagai call graph microservices;
- memakai incident untuk semua jenis business rejection;
- melakukan external side effect tanpa idempotency key;
- menganggap Operate selalu real-time source of truth;
- menganggap migration Camunda 7 ke 8 hanya refactor `JavaDelegate` menjadi worker.

---

## 4. Camunda 7 vs Camunda 8: Perubahan Mental Model

### 4.1 Camunda 7 Mental Model

Camunda 7 biasanya dipakai sebagai:

- embedded process engine di dalam Java/Spring application;
- shared process engine di application server;
- engine yang persist state ke relational database;
- engine yang bisa menjalankan JavaDelegate di dalam transaction boundary aplikasi;
- engine yang sangat dekat dengan relational query model;
- engine yang history-nya bisa dibaca dari database/history tables;
- engine yang bisa sangat coupled dengan application code.

Simplified view:

```text
+------------------------------+
| Java/Spring Application      |
|                              |
|  Controller / Service        |
|        |                     |
|  Camunda 7 Process Engine    |
|        |                     |
|  JavaDelegate / Listener     |
|        |                     |
|  Relational Database         |
+------------------------------+
```

Dalam banyak implementasi Camunda 7:

- process engine berada dalam aplikasi;
- delegate code berjalan di process engine context;
- database transaction bisa mencakup process state dan business state;
- engine API bisa dipanggil langsung dari service code;
- history query bisa menjadi bagian dari aplikasi operasional;
- custom plugin/listener/internal API sering dipakai untuk memperluas behavior.

Ini powerful, tetapi bisa membuat coupling sangat kuat.

### 4.2 Camunda 8 Mental Model

Camunda 8/Zeebe lebih dekat ke model:

```text
+----------------------------+        +------------------------------+
| Java Worker Application    |        | Camunda 8 / Zeebe Cluster    |
|                            |        |                              |
|  Job Handler               |<------>| Gateway                      |
|  Domain Service            |        | Broker / Partitions          |
|  External API Adapter      |        | Exporters                    |
|  Database Adapter          |        |                              |
+----------------------------+        +------------------------------+
                 |                                   |
                 v                                   v
       Business Database / APIs          Operate / Tasklist / Optimize
```

Dalam Camunda 8:

- engine bukan embedded library di Java app;
- Java app berinteraksi sebagai client;
- automated work dieksekusi oleh worker eksternal;
- broker menyimpan durable orchestration state;
- gateway menjadi entry point;
- read-side seperti Operate/Tasklist dibuat dari exported records;
- external side effect terjadi di luar broker;
- consistency model lebih distributed/asynchronous.

### 4.3 Tabel Perbandingan Fundamental

| Aspek | Camunda 7 | Camunda 8 / Zeebe |
|---|---|---|
| Runtime engine | Java process engine, sering embedded/shared | Distributed orchestration cluster |
| State storage | Relational database | Partitioned durable event stream/state |
| Execution code | JavaDelegate/listener bisa berjalan di engine app | External job worker |
| Transaction feel | Bisa dekat dengan DB transaction aplikasi | Remote command + async worker completion |
| Scaling model | Scale app/engine + DB | Scale brokers, gateways, workers, exporters, projections |
| Query model | Runtime/history query APIs over DB-backed engine | Read-side/projection APIs, Operate/Tasklist/Optimize |
| Failure model | DB transaction, job executor, optimistic locking | broker/gateway/partition/worker/exporter/projection failure |
| Coupling risk | Engine deeply coupled to app code | Contract coupling through BPMN job types and variables |
| Migration style | Library/runtime upgrade possible within 7.x | Re-architecture may be required |

---

## 5. Komponen Inti Camunda 8/Zeebe

Untuk Part 000, kita cukup membentuk peta besar. Detail akan dibahas di part berikutnya.

### 5.1 Client

Client adalah cara aplikasi berinteraksi dengan Camunda 8.

Dalam konteks Java modern:

- gunakan **Camunda Java Client** untuk Camunda 8.8+;
- pahami legacy **Zeebe Java Client** karena banyak codebase lama masih memakainya;
- pahami REST/gRPC implication;
- pahami authentication dan lifecycle client.

Client dipakai untuk:

- deploy BPMN/DMN/resource;
- start process instance;
- publish message;
- create/cancel/modify process instance;
- activate and complete jobs;
- query/manage orchestration data melalui supported APIs.

### 5.2 Gateway

Gateway adalah entry point ke Zeebe cluster.

Mental model:

```text
Java Client ---> Gateway ---> Broker Leader for Target Partition
```

Gateway:

- stateless;
- menerima request client;
- routing ke broker/partition yang tepat;
- menjadi boundary penting untuk auth, network, load balancing, dan client connectivity.

Jika gateway down, worker/client tidak bisa berinteraksi, tetapi broker state bisa tetap ada.

### 5.3 Broker

Broker adalah node yang menyimpan dan memproses orchestration state.

Broker mengelola:

- partitions;
- stream processors;
- process instance state;
- job state;
- timer/message state;
- replication;
- snapshots/log/state recovery.

Broker bukan tempat menjalankan business Java code.

Ini sangat penting.

> Di Camunda 8, business code Anda tidak hidup di broker. Business code hidup di worker.

### 5.4 Partition

Partition adalah shard/stream unit.

Mental model:

```text
Partition = ordered stream + state machine processing + durable state for subset of workload
```

Konsekuensi:

- ordering kuat hanya dalam boundary partition tertentu;
- tidak ada total global ordering seluruh cluster;
- process instance akan terkait ke partition tertentu;
- hot partition bisa menjadi bottleneck;
- partition count adalah keputusan kapasitas yang penting.

### 5.5 Exporter

Exporter mengalirkan records dari broker ke sistem lain.

Biasanya untuk:

- Operate visibility;
- Tasklist visibility;
- Optimize analytics;
- Elasticsearch/OpenSearch projection;
- custom audit trail;
- compliance data pipeline.

Exporter membuat read-side menjadi mungkin, tetapi juga memperkenalkan konsep penting:

> Projection can lag behind source-of-truth engine state.

Artinya, apa yang terlihat di Operate/Tasklist bisa terlambat dibanding state broker.

### 5.6 Operate

Operate adalah operational console untuk melihat process instance, incidents, variables, flow node status, dan debugging runtime.

Operate bukan engine.

Operate membaca projection dari exported records.

### 5.7 Tasklist

Tasklist adalah aplikasi untuk human tasks.

Tasklist penting untuk:

- user task visibility;
- claim/complete;
- assignment;
- form interaction;
- human workflow operations.

Namun untuk enterprise case management, Anda tetap perlu menilai apakah Tasklist cukup atau perlu custom task/case UI.

### 5.8 Optimize

Optimize adalah analytics/process intelligence layer.

Optimize membantu melihat:

- bottleneck;
- cycle time;
- SLA;
- workload distribution;
- process performance.

Namun Optimize bukan pengganti domain reporting atau regulatory audit store jika kebutuhan compliance sangat spesifik.

### 5.9 Identity

Identity mengelola akses ke komponen platform.

Di self-managed deployment, Identity sering terkait dengan Keycloak dan integrasi IAM enterprise.

Di level design, security boundary harus mencakup:

- siapa boleh deploy model;
- siapa boleh start process;
- siapa boleh melihat/menyelesaikan task;
- worker mana boleh mengambil job type tertentu;
- tenant separation;
- secret management;
- audit access.

---

## 6. Mental Model Utama: Process Instance sebagai Durable Distributed State Machine

Banyak engineer melihat BPMN sebagai diagram flow.

Untuk Camunda 8, diagram itu perlu dibaca sebagai state machine yang durable.

Contoh sederhana:

```text
[Start]
   |
   v
[Validate Application] --job--> Java Worker
   |
   v
[Human Review] --task--> Tasklist/User
   |
   v
[External Verification] --job--> Java Worker
   |
   v
[Decision Gateway]
   | approved
   v
[Issue License]
   |
   v
[End]
```

Secara mental, ini bukan sekadar flowchart. Ini adalah kumpulan state transition:

```text
Process instance created
Flow node activated: Validate Application
Job created: validate-application
Job activated by worker
Job completed
Flow node completed
Flow node activated: Human Review
User task created
User task completed
...
```

Setiap langkah penting menjadi state/event yang durable.

### 6.1 Kenapa State Machine Penting?

Karena state machine membuat Anda bertanya:

- state apa yang mungkin terjadi?
- state apa yang valid berikutnya?
- transition apa yang boleh dilakukan?
- event apa yang harus terekam?
- jika worker crash di tengah, state process ada di mana?
- jika external API sukses tapi job completion gagal, state mana yang benar?
- jika task overdue, transition apa yang terjadi?
- jika business rejection, apakah itu error, incident, atau normal path?

Engineer top-level tidak hanya bertanya “bagaimana API call-nya?” tetapi “state transition apa yang sedang saya desain?”

---

## 7. Mental Model Kedua: Job sebagai Execution Obligation

Service task di BPMN tidak langsung menjalankan Java code di broker.

Service task menghasilkan job.

Job adalah kewajiban eksekusi yang harus diambil worker.

```text
BPMN Service Task
       |
       v
Zeebe creates Job(type = "verify-customer")
       |
       v
Worker activates Job
       |
       v
Worker performs business work
       |
       v
Worker completes/fails/throws BPMN error
```

Job memiliki properti konseptual:

- job key;
- job type;
- process instance key;
- variables;
- retries;
- timeout;
- custom headers;
- worker identity;
- tenant context jika dipakai.

### 7.1 Job Bukan Method Call

Salah satu kesalahan desain adalah menganggap job seperti synchronous function call.

Padahal job lebih mirip:

```text
Durable work item + lease/activation + timeout + retry counter + completion protocol
```

Konsekuensi:

- worker bisa mengambil job lalu crash;
- job bisa timeout dan diambil lagi;
- job bisa dikerjakan dua kali dalam kondisi tertentu;
- completion command bisa gagal walaupun side effect berhasil;
- external system bisa lambat atau partial failure;
- retry harus aman.

Karena itu, worker harus didesain dengan idempotency.

---

## 8. Mental Model Ketiga: Worker sebagai Stateless Retryable Business Executor

Worker idealnya stateless secara process-control.

Worker boleh punya:

- database;
- cache;
- connection pool;
- domain service;
- idempotency store;
- observability;
- config;
- secret access.

Namun worker tidak boleh menjadi tempat menyimpan “kebenaran process state” secara tersembunyi.

Zeebe menyimpan orchestration state. Worker menjalankan business side effect.

### 8.1 Worker yang Baik

Worker yang baik memiliki karakteristik:

1. **Idempotent**  
   Eksekusi ulang tidak merusak data atau menggandakan side effect.

2. **Bounded**  
   Tidak mengambil job lebih banyak dari kapasitasnya.

3. **Observable**  
   Semua log/metrics/traces membawa process instance key, job key, job type, business key, correlation id.

4. **Versioned**  
   Contract variable dan job type dikelola versinya.

5. **Failure-aware**  
   Bisa membedakan transient technical failure, business rejection, BPMN error, dan non-retryable incident.

6. **Gracefully shutdown-able**  
   Saat deployment/scale down, worker tidak meninggalkan banyak active jobs yang akan timeout tanpa kontrol.

7. **Contract-isolated**  
   BPMN variable schema tidak bocor terlalu dalam ke domain core.

### 8.2 Worker yang Buruk

Worker yang buruk biasanya:

- melakukan external API call tanpa idempotency key;
- meng-update database lalu complete job tanpa recovery strategy;
- complete job lalu melakukan side effect penting setelahnya;
- mengambil terlalu banyak active jobs;
- menyimpan payload besar di variable;
- menggunakan exception generic untuk semua error;
- membuat retry infinite;
- menganggap process variable sebagai database;
- tidak punya correlation logging;
- tidak punya runbook.

---

## 9. Mental Model Keempat: Command Path vs Read Path

Dalam Camunda 8, penting membedakan:

```text
Command path: client -> gateway -> broker -> partition/state
Read path: broker records -> exporter -> Elasticsearch/OpenSearch/read APIs/UI
```

### 9.1 Command Path

Command path dipakai untuk mengubah state:

- deploy resource;
- start process instance;
- complete job;
- fail job;
- publish message;
- cancel instance;
- resolve incident;
- modify instance.

Command path harus dianggap sebagai interaction dengan source-of-truth engine state.

### 9.2 Read Path

Read path dipakai untuk melihat state:

- Operate;
- Tasklist;
- Optimize;
- search/query API;
- analytics;
- custom dashboard.

Read path sangat berguna, tetapi bisa mengalami:

- exporter lag;
- index delay;
- projection mismatch;
- stale view;
- retention behavior;
- API version changes.

### 9.3 Konsekuensi Desain

Jangan membuat business-critical command decision berdasarkan asumsi bahwa projection selalu real-time.

Contoh anti-pattern:

```text
1. Worker complete job.
2. Application immediately query Operate to check if next task exists.
3. Jika belum ada, dianggap process gagal.
```

Masalahnya: mungkin bukan gagal, hanya projection belum update.

Better approach:

- gunakan process messages/events untuk orchestration;
- gunakan domain DB untuk domain consistency;
- gunakan Operate untuk support/debugging;
- gunakan read-side untuk UI/search dengan eventual consistency awareness.

---

## 10. Mental Model Kelima: Variables Bukan Database

Zeebe process variables berguna untuk orchestration context, bukan sebagai tempat menyimpan semua data domain.

### 10.1 Simpan di Variables

Biasanya cocok:

- business id;
- correlation key;
- status ringkas;
- decision result;
- routing information;
- small structured data yang dibutuhkan process;
- reference ke domain object/document.

### 10.2 Jangan Simpan di Variables

Biasanya buruk:

- file besar;
- full document JSON besar;
- raw request/response external API yang panjang;
- sensitive PII tanpa masking/encryption strategy;
- data domain yang berubah sering;
- data yang perlu relational query kompleks;
- audit detail yang lebih cocok di audit store.

### 10.3 Reference-over-Payload

Pattern yang sering lebih benar:

```json
{
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-000777",
  "applicantId": "PERSON-99881",
  "documentBundleRef": "s3://bucket/path/ref-or-domain-document-id",
  "riskScore": 72,
  "reviewRoute": "SENIOR_OFFICER"
}
```

Bukan:

```json
{
  "fullApplicationForm": { "... huge nested object ..." },
  "allUploadedDocumentsBase64": "...",
  "completeExternalApiResponse": { "..." }
}
```

---

## 11. Mental Model Keenam: At-Least-Once Execution dan Idempotency

Dalam distributed workflow, exact-once end-to-end side effect adalah ilusi kecuali Anda mendesain fencing/dedup/transactional protocol yang sangat spesifik.

Yang realistis:

> Zeebe membantu durable orchestration, tetapi side effect bisnis di worker harus aman terhadap retry dan duplicate execution.

### 11.1 Skenario Klasik

Bayangkan worker:

1. menerima job `issue-license`;
2. memanggil external licensing API;
3. external API sukses;
4. worker mengirim command complete job;
5. network timeout terjadi;
6. worker tidak tahu apakah complete job diterima;
7. job mungkin muncul lagi setelah timeout/retry.

Tanpa idempotency, license bisa diterbitkan dua kali.

### 11.2 Idempotency Key

Pilihan idempotency key bisa berasal dari:

- business key;
- process instance key;
- job key;
- domain command id;
- external reference id;
- combination of process step + business id.

Namun hati-hati:

- `jobKey` unik per job, tetapi retry/duplicate semantics harus dipahami;
- business key lebih cocok untuk business-level dedup;
- process instance key cocok untuk instance-level dedup;
- command id cocok untuk explicit external action.

### 11.3 Worker Harus Punya Recovery Story

Setiap worker penting harus bisa menjawab:

- jika worker crash sebelum external call, apa yang terjadi?
- jika worker crash setelah external call tetapi sebelum DB commit, apa yang terjadi?
- jika DB commit sukses tetapi job completion gagal, apa yang terjadi?
- jika job diambil ulang, bagaimana mendeteksi side effect sudah terjadi?
- jika external API tidak idempotent, apa fencing layer-nya?
- jika retry habis, siapa yang memperbaiki incident?

---

## 12. Camunda 8 Java Version Perspective: Java 8 sampai 25

Seri ini membahas Java dari 8 sampai 25, tetapi perlu framing realistis.

### 12.1 Java 8

Java 8 masih mungkin muncul di legacy enterprise system.

Namun untuk Camunda 8 modern:

- official client/starter terbaru cenderung mengikuti ecosystem Java/Spring yang lebih modern;
- Spring Boot 3.x membutuhkan Java 17+;
- Camunda 8 Run modern membutuhkan Java runtime modern;
- self-managed platform modern semakin condong ke Java 21+.

Untuk Java 8, pembahasan akan lebih fokus pada:

- legacy integration service;
- external adapter;
- migration bridge;
- HTTP/gRPC client boundary;
- bukan menjadikan Java 8 sebagai baseline terbaik untuk worker modern.

### 12.2 Java 11

Java 11 bisa muncul di enterprise transitional stack.

Pertimbangan:

- masih cukup modern untuk banyak dependency lama;
- tetapi semakin tidak ideal untuk new Camunda 8/Spring Boot stack;
- cocok sebagai transitional worker runtime bila organisasi belum siap ke 17/21.

### 12.3 Java 17

Java 17 adalah baseline modern yang kuat untuk banyak enterprise Spring Boot 3 application.

Cocok untuk:

- worker services;
- integration services;
- domain services;
- process adapters;
- test tooling.

### 12.4 Java 21

Java 21 adalah baseline yang sangat kuat untuk production modern.

Keuntungan:

- LTS;
- virtual threads untuk workload blocking IO tertentu;
- modern GC improvements;
- improved language/runtime ergonomics;
- cocok dengan cloud-native Java stack modern.

Namun virtual threads tidak menghapus kebutuhan backpressure/idempotency. Worker tetap harus dibatasi sesuai kapasitas external dependency.

### 12.5 Java 25

Java 25 relevan untuk engineer yang ingin memahami arah terbaru platform Java.

Dalam seri ini, Java 25 akan dibahas sebagai:

- compatibility awareness;
- runtime evolution;
- future-proofing;
- bukan alasan untuk memakai fitur preview secara sembarangan.

---

## 13. Modern Client Naming: Zeebe Client vs Camunda Java Client

Karena banyak materi lama menggunakan istilah Zeebe client, Anda perlu memahami transisi nama dan dependency.

### 13.1 Istilah Lama

Sebelum Camunda 8.8, umum ditemukan:

```java
ZeebeClient client = ZeebeClient.newClientBuilder()
    .gatewayAddress("localhost:26500")
    .usePlaintext()
    .build();
```

Package/dependency lama sering memakai istilah `zeebe-client-java`.

### 13.2 Istilah Baru

Mulai Camunda 8.8, arah modern adalah:

```java
CamundaClient client = CamundaClient.newClientBuilder()
    // configuration
    .build();
```

Dependency modern:

```xml
<dependency>
  <groupId>io.camunda</groupId>
  <artifactId>camunda-client-java</artifactId>
  <version>${camunda.version}</version>
</dependency>
```

### 13.3 Prinsip Seri Ini

Dalam seri ini:

- istilah **Zeebe** digunakan untuk engine/runtime/distributed workflow core;
- istilah **Camunda Java Client** digunakan untuk client modern;
- istilah **Zeebe Java Client** digunakan ketika membahas legacy/migration;
- istilah **worker** tetap digunakan untuk automated job execution.

---

## 14. Apa Itu “Top 1%” dalam Konteks Camunda 8?

Top 1% bukan berarti hafal semua annotation atau semua property Helm chart.

Top 1% berarti mampu melihat sistem secara struktural.

### 14.1 Level Beginner

Biasanya bisa:

- deploy BPMN;
- start process;
- membuat worker sederhana;
- complete job;
- melihat Operate.

### 14.2 Level Intermediate

Biasanya bisa:

- membuat beberapa worker;
- handle retry sederhana;
- memakai Spring Boot starter;
- membuat user task;
- publish message;
- debugging incident dasar.

### 14.3 Level Senior

Biasanya bisa:

- desain process versioning;
- desain variable schema;
- desain idempotent workers;
- memisahkan business rejection vs technical failure;
- memahami projection lag;
- mengoperasikan worker di Kubernetes;
- membuat runbook incident;
- melakukan migration assessment dari Camunda 7.

### 14.4 Level Top 1%

Harus bisa:

- menjelaskan Zeebe sebagai partitioned event-stream state machine;
- mendesain workflow untuk at-least-once execution;
- memilih boundary BPMN yang tepat;
- menilai kapan orchestration buruk dan choreography lebih tepat;
- membangun worker yang idempotent, observable, scalable, dan graceful;
- membaca failure mode dari broker/gateway/exporter/projection/worker;
- mendesain custom read model/audit projection;
- mengatur process versioning tanpa merusak running instances;
- melakukan capacity planning berdasarkan partition, workload, exporter, dan worker throughput;
- membuat migration strategy Camunda 7 ke 8 yang realistis;
- menjelaskan trade-off SaaS vs self-managed;
- membuat architecture yang defensible untuk audit/regulatory process;
- tidak tertipu oleh demo sederhana.

---

## 15. Diagram Mental End-to-End

```text
                        +-----------------------------+
                        |      Developer / Modeler    |
                        |  BPMN / DMN / Forms         |
                        +--------------+--------------+
                                       |
                                       | deploy resource
                                       v
+------------------+       +-----------+-----------+       +----------------------+
| Java Application | <---> |  Camunda Gateway      | <---> |  Zeebe Brokers       |
| / Worker Service |       |  stateless entrypoint |       |  partitions/state    |
+--------+---------+       +-----------+-----------+       +----------+-----------+
         |                             ^                              |
         | activate/complete/fail job  |                              | records
         | publish message             |                              v
         | start process               |                  +-----------+-----------+
         v                             |                  | Exporters             |
+--------+---------+                   |                  +-----------+-----------+
| Domain Services  |                   |                              |
| DB / APIs / S3   |                   |                              v
| Email / Legacy   |                   |      +-----------------------+------------+
+------------------+                   |      | Elasticsearch/OpenSearch/Projections |
                                       |      +-----------+-----------+-------------+
                                       |                  |           |
                                       |                  v           v
                                       |              Operate     Tasklist
                                       |                  |
                                       |                  v
                                       |               Optimize
```

Interpretasi diagram:

- BPMN/DMN/form adalah model dan contract.
- Gateway adalah pintu komunikasi.
- Broker adalah tempat orchestration state hidup.
- Worker adalah executor external side effects.
- Exporter mengalirkan record ke read-side.
- Operate/Tasklist/Optimize membantu visibility dan operation, bukan menggantikan source-of-truth engine.

---

## 16. Cara Membaca BPMN di Camunda 8

Jangan membaca BPMN hanya sebagai diagram proses bisnis.

Baca sebagai gabungan:

1. **state machine**  
   Node mana yang aktif? Transition mana yang valid?

2. **distributed coordination contract**  
   Service task mana yang akan membuat job? Worker mana yang bertanggung jawab?

3. **failure boundary**  
   Di mana error ditangkap? Di mana incident dibuat? Di mana compensation terjadi?

4. **human responsibility map**  
   Task mana yang butuh user? Siapa candidate group? Apa SLA-nya?

5. **data contract**  
   Variable apa yang dibutuhkan? Dari mana asalnya? Siapa boleh mengubah?

6. **operational topology**  
   Jika external API down, process berhenti di mana? Alert mana yang menyala?

7. **audit narrative**  
   Apakah alur bisa menjelaskan “siapa melakukan apa, kapan, berdasarkan data apa, dan kenapa?”

---

## 17. Batas antara Orchestration State dan Domain State

Ini salah satu batas paling penting.

### 17.1 Orchestration State

Orchestration state menjawab:

- proses sedang berada di aktivitas mana?
- job mana yang sedang menunggu worker?
- timer mana yang aktif?
- message apa yang ditunggu?
- incident apa yang muncul?
- user task mana yang terbuka?
- path process mana yang diambil?

Orchestration state hidup di Zeebe.

### 17.2 Domain State

Domain state menjawab:

- application status apa?
- case owner siapa?
- license sudah diterbitkan atau belum?
- payment sudah settled atau belum?
- document mana yang valid?
- audit domain event apa yang terjadi?
- rule decision apa yang dipakai?

Domain state hidup di domain database/system of record.

### 17.3 Jangan Tertukar

Anti-pattern:

```text
Process variable menjadi source of truth semua data aplikasi.
```

Better:

```text
Zeebe stores orchestration progress.
Domain database stores domain truth.
Process variables carry references and decision context.
```

---

## 18. Transaction Boundary: Perubahan Besar dari Camunda 7

Di Camunda 7 embedded style, engineer sering bisa membuat process engine dan business database berada dalam transaction boundary yang dekat.

Di Camunda 8, interaction dengan engine adalah remote/distributed.

Artinya:

```text
Database transaction != Zeebe command transaction
```

Contoh worker:

```text
1. Activate job.
2. Begin DB transaction.
3. Update domain table.
4. Commit DB transaction.
5. Complete Zeebe job.
```

Failure window:

- DB commit sukses;
- complete job gagal karena network;
- job retry;
- worker menjalankan update lagi.

Solusinya bukan berharap distributed transaction magically terjadi.

Solusinya:

- idempotency table;
- outbox/inbox;
- external command id;
- state check before side effect;
- retry-safe domain operation;
- compensating action jika perlu;
- incident/manual repair untuk case tertentu.

---

## 19. Error Taxonomy yang Benar

Sebelum masuk implementasi, Anda perlu punya taxonomy error.

### 19.1 Technical Transient Failure

Contoh:

- external API timeout;
- database connection unavailable;
- rate limit;
- temporary auth token refresh issue;
- network error.

Biasanya cocok untuk:

- job failure;
- retry;
- backoff;
- alert jika berulang.

### 19.2 Business Error / BPMN Error

Contoh:

- applicant not eligible;
- document invalid;
- rule decision rejects application;
- duplicate application found;
- payment declined secara final.

Biasanya cocok sebagai:

- BPMN error;
- explicit alternate path;
- human review path;
- rejection path.

### 19.3 Incident-worthy Failure

Contoh:

- invalid variable schema;
- worker bug;
- unexpected null;
- incompatible process version;
- missing critical configuration;
- impossible state.

Biasanya cocok menjadi:

- incident;
- manual repair;
- deployment rollback/fix;
- data correction.

### 19.4 Security Failure

Contoh:

- unauthorized worker credential;
- wrong tenant;
- token misconfiguration;
- permission denied;
- suspicious access.

Tidak boleh hanya dianggap retry biasa.

Perlu:

- security alert;
- credential/config fix;
- audit trail;
- possible incident response.

---

## 20. Why “BPMN as Microservice Call Graph” Is Bad

Engineer yang terbiasa microservices kadang membuat BPMN seperti ini:

```text
[Call User Service]
   |
[Call Address Service]
   |
[Call Profile Service]
   |
[Call Risk Service]
   |
[Call Notification Service]
   |
[Call Audit Service]
```

Ini sering buruk karena:

- BPMN menjadi terlalu teknis;
- process diagram sulit dibaca business;
- terlalu banyak service task kecil;
- throughput dan latency memburuk;
- incident noise meningkat;
- versioning makin rumit;
- worker contract terlalu granular;
- retry semantics tersebar.

Better modelling:

```text
[Validate Application]
   |
[Assess Risk]
   |
[Notify Applicant]
```

Di dalam `Validate Application`, domain service boleh memanggil beberapa internal service jika itu detail implementasi.

BPMN sebaiknya merepresentasikan **business-significant milestones**, bukan semua function call.

---

## 21. Kapan Camunda 8 Cocok?

Camunda 8 cocok ketika Anda punya:

- long-running process;
- human + system workflow;
- explicit business process visibility;
- SLA/escalation;
- cross-service orchestration;
- regulatory audit requirement;
- complex approval/review process;
- retry and incident handling requirement;
- process versioning and operational visibility need;
- durable coordination across unreliable systems.

Contoh domain cocok:

- onboarding;
- loan origination;
- claim processing;
- license application;
- enforcement lifecycle;
- compliance case review;
- procurement approval;
- KYC/AML workflow;
- appeal process;
- incident response process.

---

## 22. Kapan Camunda 8 Mungkin Tidak Cocok?

Camunda 8 bukan jawaban untuk semua masalah.

Mungkin tidak cocok jika:

- hanya butuh synchronous CRUD sederhana;
- hanya butuh single service transaction;
- workflow sangat pendek dan tidak perlu visibility;
- event streaming choreography sudah cukup;
- process berubah sangat dinamis dan tidak cocok dimodelkan BPMN;
- team belum siap operational ownership;
- tidak ada kebutuhan human workflow/audit/long-running state;
- latency ultra-low lebih penting dari durable orchestration;
- Anda hanya ingin queue sederhana.

Pertanyaan penting:

> Apakah kita butuh durable process state yang eksplisit dan dapat dioperasikan, atau hanya butuh asynchronous task execution?

Jika hanya butuh asynchronous task execution, queue biasa seperti RabbitMQ/Kafka/SQS mungkin cukup.

Jika butuh process visibility, timer, escalation, human tasks, incident repair, and long-running orchestration, Camunda 8 mulai masuk akal.

---

## 23. Camunda 8 vs Queue vs Event Streaming vs Temporal: Framing Awal

Seri ini bukan perbandingan utama, tetapi framing awal membantu.

### 23.1 Queue

Queue cocok untuk:

- background job;
- simple async task;
- retry sederhana;
- decoupling producer/consumer.

Queue tidak otomatis memberi:

- BPMN model;
- process visibility;
- human task;
- gateway decision;
- timer escalation;
- incident UI;
- process analytics.

### 23.2 Kafka/Event Streaming

Kafka cocok untuk:

- event-driven architecture;
- high-throughput event log;
- stream processing;
- domain event distribution;
- choreography.

Kafka tidak otomatis memberi:

- explicit process instance state;
- BPMN execution;
- human workflow;
- visual incident repair;
- business process milestones.

### 23.3 Temporal

Temporal cocok untuk:

- code-first durable execution;
- workflow as code;
- strong developer-centric programming model;
- activity retry and durable timers.

Camunda lebih cocok ketika:

- BPMN visual model penting;
- business/operations perlu membaca process;
- human workflow dan business process management penting;
- process governance dan modelling collaboration penting.

Top engineer tidak fanatik tool. Top engineer memilih berdasarkan fit.

---

## 24. Migration Mindset dari Camunda 7

Karena Anda sudah belajar Camunda 7, migration mindset sangat penting.

### 24.1 Jangan Mulai dari Code

Jangan mulai dengan:

> “Bagaimana mengubah semua JavaDelegate menjadi worker?”

Mulai dari:

1. process inventory;
2. business criticality;
3. BPMN compatibility;
4. listener/delegate/custom API usage;
5. data coupling;
6. transaction boundary;
7. history query dependency;
8. forms/tasklist usage;
9. authorization model;
10. runtime operations;
11. migration strategy untuk running instances.

### 24.2 JavaDelegate to Worker Bukan 1:1 Selalu

Camunda 7:

```java
public class ValidateApplicationDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        // access variables
        // call service
        // set variables
    }
}
```

Camunda 8 worker style:

```java
@JobWorker(type = "validate-application")
public Map<String, Object> validateApplication(ActivatedJob job) {
    // fetch variables
    // call domain service
    // return updated variables
}
```

Secara permukaan mirip.

Namun secara arsitektur berbeda:

- remote worker;
- job timeout;
- retry;
- idempotency;
- variable contract;
- external transaction boundary;
- worker scaling;
- different error semantics;
- different observability.

### 24.3 Migration Strategy Bisa Berlapis

Beberapa strategi:

1. **New processes only**  
   Camunda 7 tetap menyelesaikan running instances, Camunda 8 untuk process baru.

2. **Strangler migration**  
   Pindahkan process per domain/module.

3. **Coexistence bridge**  
   Camunda 7 dan 8 berkomunikasi via message/API/event.

4. **Model conversion + refactor**  
   Gunakan tooling untuk membantu, tetapi tetap review manual.

5. **Re-architecture**  
   Untuk solusi yang sangat coupled dengan internal API Camunda 7.

---

## 25. Production Readiness Questions

Sebelum process Camunda 8 masuk production, minimal jawab pertanyaan berikut.

### 25.1 Process Model

- Apa process id dan versioning strategy?
- Apakah BPMN merepresentasikan business milestones, bukan technical call graph?
- Apa path normal, rejection, escalation, timeout, cancellation?
- Apa yang terjadi pada running instances saat model baru deploy?
- Apakah error boundary jelas?
- Apakah user task assignment jelas?

### 25.2 Worker

- Apa job type contract?
- Apa variable input/output schema?
- Apakah worker idempotent?
- Apa retry policy?
- Apa job timeout?
- Apa max jobs active?
- Apa backpressure strategy?
- Apa graceful shutdown behavior?
- Apa observability fields?

### 25.3 Data

- Data apa di variable?
- Data apa di domain DB?
- Data apa di audit store?
- Apakah ada PII?
- Apakah payload size terkendali?
- Apakah schema versioned?

### 25.4 Operations

- Dashboard apa yang tersedia?
- Alert apa yang tersedia?
- Runbook incident apa yang tersedia?
- Siapa owner incident?
- Bagaimana repair dilakukan?
- Bagaimana exporter lag dimonitor?
- Bagaimana backup/restore?

### 25.5 Security

- Siapa boleh deploy?
- Siapa boleh start process?
- Worker memakai credential apa?
- Secret disimpan di mana?
- Tenant isolation bagaimana?
- Task authorization bagaimana?
- Audit access bagaimana?

---

## 26. Vocabulary Penting untuk Seri Ini

### 26.1 Process Definition

Model BPMN yang sudah dideploy dan memiliki version.

### 26.2 Process Instance

Eksekusi konkret dari process definition.

### 26.3 Element / Flow Node

Node BPMN seperti service task, user task, gateway, timer event, message event.

### 26.4 Job

Work item yang dibuat oleh engine dan dieksekusi oleh worker.

### 26.5 Job Worker

Client/application yang mengambil job, menjalankan business logic, lalu complete/fail/throw error.

### 26.6 Gateway

Stateless entry point ke Zeebe cluster.

### 26.7 Broker

Node yang menyimpan dan memproses partition/state.

### 26.8 Partition

Shard/stream unit untuk workload Zeebe.

### 26.9 Exporter

Komponen yang mengekspor records ke sistem lain.

### 26.10 Incident

Kondisi ketika process/job tidak bisa lanjut tanpa intervensi atau perbaikan.

### 26.11 BPMN Error

Business error yang dimodelkan dalam BPMN sebagai path alternatif.

### 26.12 Message Correlation

Mekanisme menghubungkan event/message eksternal ke waiting process instance berdasarkan correlation key.

### 26.13 Projection

Read-side view yang dibangun dari exported records.

### 26.14 Orchestration Cluster

Cluster Camunda/Zeebe yang menerima command, menyimpan state, dan menggerakkan process.

---

## 27. Contoh Mini: Dari Business Process ke Zeebe Thinking

### 27.1 Business Narasi

Sebuah aplikasi lisensi masuk. Sistem harus validasi data, cek risiko, minta review officer jika risiko tinggi, lalu menerbitkan lisensi atau menolak aplikasi.

### 27.2 BPMN Naif

```text
[Start]
 -> [Call Applicant API]
 -> [Call Document API]
 -> [Call Risk API]
 -> [If high risk]
 -> [Call Assignment API]
 -> [User Task]
 -> [Call License API]
 -> [End]
```

Ini terlalu teknis.

### 27.3 BPMN Lebih Baik

```text
[Start Application Review]
 -> [Validate Application]
 -> [Assess Risk]
 -> <Risk Gateway>
      low  -> [Issue License]
      high -> [Senior Officer Review] -> [Issue/Reject]
 -> [Notify Applicant]
 -> [End]
```

### 27.4 Worker Contract

Job types:

```text
validate-application
assess-risk
issue-license
notify-applicant
```

Variables:

```json
{
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-000999",
  "riskLevel": "HIGH",
  "reviewDecision": "APPROVED"
}
```

Domain DB stores:

```text
application details
applicant data
document metadata
review notes
license record
audit events
```

Zeebe stores:

```text
process progress
active task/job state
timer/message state
incident state
process variables needed for routing
```

---

## 28. Development Mindset untuk Seluruh Seri

Setiap kali kita membuat solusi, kita akan bertanya dengan urutan ini:

1. **Business invariant**  
   Apa yang harus selalu benar secara bisnis?

2. **Process state**  
   State orchestration apa yang perlu durable dan visible?

3. **Domain state**  
   Data apa yang menjadi source of truth domain?

4. **Boundary**  
   Di mana BPMN berhenti dan domain service mulai?

5. **Contract**  
   Job type dan variables apa yang menjadi contract?

6. **Failure mode**  
   Apa yang terjadi jika worker, network, DB, API, broker, exporter gagal?

7. **Idempotency**  
   Side effect mana yang bisa terulang?

8. **Observability**  
   Bagaimana kita tahu process stuck, lambat, salah, atau rusak?

9. **Operations**  
   Siapa yang memperbaiki incident? Bagaimana caranya?

10. **Evolution**  
   Bagaimana model berubah tanpa merusak running instances?

---

## 29. Checklist Belajar Setelah Part 000

Setelah menyelesaikan part ini, Anda seharusnya bisa menjelaskan:

- kenapa Camunda 8 bukan Camunda 7 upgrade biasa;
- apa perbedaan embedded engine dan distributed orchestration cluster;
- kenapa Java worker harus idempotent;
- kenapa job bukan method call;
- kenapa process variable bukan database;
- kenapa Operate/Tasklist adalah read-side/projection;
- apa perbedaan command path dan read path;
- apa peran gateway, broker, partition, exporter;
- kenapa migration dari Camunda 7 perlu assessment arsitektur;
- apa skill yang membedakan engineer biasa dan engineer top-level dalam Camunda 8.

Jika belum bisa menjelaskan ini, jangan buru-buru ke API. API akan terasa mudah, tetapi production system akan membingungkan.

---

## 30. Anti-Pattern yang Harus Langsung Dihindari Sejak Awal

### 30.1 “Port semua JavaDelegate jadi worker 1:1”

Kadang bisa, tetapi sering menghasilkan distributed version dari desain lama yang terlalu coupled.

### 30.2 “Semua data masuk variable”

Ini membuat payload besar, security risk, dan performance issue.

### 30.3 “Retry semua error”

Business rejection bukan technical retry.

### 30.4 “BPMN detail sampai tiap REST call”

BPMN menjadi noisy dan tidak business-readable.

### 30.5 “Tidak butuh idempotency karena Zeebe sudah durable”

Zeebe durable untuk orchestration state. Side effect eksternal tetap tanggung jawab worker design.

### 30.6 “Operate adalah database query utama aplikasi”

Operate untuk operational visibility, bukan source of truth domain.

### 30.7 “Scale worker sebanyak mungkin”

Worker scale tanpa backpressure bisa menjatuhkan external dependency.

### 30.8 “Incident berarti process gagal total”

Incident adalah state operasional yang bisa diperbaiki. Tetapi harus punya ownership dan runbook.

---

## 31. Peta Seri Setelah Part 000

Bagian berikutnya akan membahas platform architecture secara lebih detail.

Urutan besar seri:

```text
000 Orientation and mental model
001 Platform architecture
002 Zeebe internals
003 Partitions, replication, ordering
004 BPMN runtime semantics
005 Java client evolution
006 Production-grade workers
007 Worker correctness and idempotency
008 Variables and data contracts
009 Distributed BPMN modelling
010 Messages and correlation
011 Error handling
012 Timers and SLA
013 User tasks
014 Spring Boot integration
015 Worker application architecture
016 Connectors
017 Exporters and read-side
018 Operate
019 Tasklist
020 Optimize
021 Identity/security
022 Deployment models
023 Performance
024 Reliability/DR
025 Observability
026 Testing
027 Versioning/release governance
028 Migration from Camunda 7
029 Saga and compensation
030 Regulatory lifecycle modelling
031 Multi-tenancy/multi-region
032 Compliance/audit/PII
033 Anti-patterns and failure cases
034 End-to-end reference architecture
035 Mastery checklist
```

---

## 32. Practical Mental Exercise

Sebelum lanjut ke Part 001, ambil satu proses yang pernah Anda lihat, misalnya:

- application review;
- appeal;
- enforcement case;
- renewal;
- complaint handling;
- approval workflow;
- document verification.

Lalu jawab:

1. Apa process instance-nya?
2. Apa business key-nya?
3. Apa state domain yang tidak boleh hanya disimpan di variable?
4. Apa service task yang benar-benar business-significant?
5. Apa job type-nya?
6. Apa worker yang perlu idempotent?
7. Apa external side effect yang berbahaya jika terjadi dua kali?
8. Apa error yang harus menjadi BPMN path?
9. Apa error yang harus menjadi incident?
10. Apa yang harus terlihat di Operate untuk support team?
11. Apa yang harus masuk audit domain?
12. Apa yang harus menjadi metric/alert?

Jika Anda bisa menjawab ini, Anda mulai berpikir seperti Camunda 8 engineer, bukan hanya pengguna API.

---

## 33. Ringkasan Eksekutif

Camunda 8/Zeebe harus dipahami sebagai distributed orchestration platform, bukan embedded Java workflow engine.

Perubahan terpenting dari Camunda 7:

- engine remote dan distributed;
- business code berjalan di external workers;
- state disimpan dalam partitioned stream/state model;
- command path dan read/projection path berbeda;
- worker execution harus diasumsikan retryable dan at-least-once;
- process variable harus disiplin;
- migration butuh redesign, bukan dependency swap;
- production readiness melibatkan broker, gateway, worker, exporter, projection, identity, observability, dan operational runbook.

Prinsip utama:

```text
Zeebe owns durable orchestration state.
Java workers own business side effects.
Domain systems own business truth.
Exporters/projections own visibility and analytics.
```

Jika prinsip ini dipegang, desain Camunda 8 akan jauh lebih bersih, scalable, dan tahan incident.

---

## 34. Referensi Utama

- Camunda 8 Docs — Zeebe Architecture: https://docs.camunda.io/docs/components/zeebe/technical-concepts/architecture/
- Camunda 8 Docs — Zeebe Internal Processing: https://docs.camunda.io/docs/components/zeebe/technical-concepts/internal-processing/
- Camunda 8 Docs — Java Client Getting Started: https://docs.camunda.io/docs/apis-tools/java-client/getting-started/
- Camunda 8 Docs — Migration from Camunda 7: https://docs.camunda.io/docs/guides/migrating-from-camunda-7/
- Camunda 8 Docs — Writing Good Workers: https://docs.camunda.io/docs/components/best-practices/development/writing-good-workers/
- Camunda 8.8 Release Announcements: https://docs.camunda.io/docs/reference/announcements-release-notes/880/880-announcements/

---

## 35. Status Seri

Part ini adalah **Part 000** dari seri:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering
```

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-001.md
```

Topik berikutnya:

```text
Camunda 8 Platform Architecture: Zeebe, Gateway, Broker, Operate, Tasklist, Optimize, Identity
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-001.md">Part 001 — Camunda 8 Platform Architecture: Zeebe, Gateway, Broker, Operate, Tasklist, Optimize, Identity ➡️</a>
</div>
