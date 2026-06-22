# Learn Java Microservices Patterns — Advanced Engineering
## Part 4 — Microservice Architecture Styles

**Filename:** `learn-java-microservices-patterns-advanced-engineering-04-architecture-styles.md`  
**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 04 of 35  
**Target level:** Advanced / staff-level / principal-level engineering  
**Java scope:** Java 8 sampai Java 25  

---

## 0. Tujuan Part Ini

Part sebelumnya membahas **domain modeling for microservices**: entity, aggregate, command, event, policy, invariant, dan state machine. Setelah domain mulai terbentuk, pertanyaan berikutnya adalah:

> “Bentuk arsitektur microservices seperti apa yang paling cocok untuk domain ini?”

Banyak engineer salah paham bahwa microservices hanya punya satu bentuk:

```text
Client → API Gateway → Service A → Service B → Service C → Database
```

Padahal ini hanya salah satu gaya, dan sering justru menjadi **distributed monolith** jika dipakai tanpa sadar.

Part ini membahas **architecture styles** dalam microservices. Tujuannya bukan sekadar mengenal nama gaya arsitektur, tetapi memahami:

1. masalah apa yang diselesaikan tiap gaya,
2. coupling apa yang ditambah atau dikurangi,
3. failure mode apa yang muncul,
4. bagaimana gaya itu memengaruhi consistency, latency, operability, testing, deployment, dan ownership,
5. kapan gaya itu cocok untuk Java enterprise systems,
6. kapan gaya itu harus ditolak.

Setelah part ini, kamu diharapkan bisa membaca sebuah sistem microservices dan berkata:

> “Ini bukan sekadar microservices. Ini request/response orchestration dengan shared query problem, synchronous critical path terlalu panjang, ownership boundary tidak sejajar dengan consistency boundary, dan event-driven part-nya hanya notification bus, bukan state propagation.”

Itu level analisis yang kita incar.

---

## 1. Definisi: Apa Itu Architecture Style?

**Architecture style** adalah keluarga struktur arsitektur yang memiliki karakteristik umum tertentu: cara komponen dibagi, cara mereka berkomunikasi, cara data dimiliki, cara failure diisolasi, dan cara perubahan dilakukan.

Dalam microservices, architecture style menjawab pertanyaan besar:

```text
Bagaimana service-service ini bekerja sama untuk menghasilkan kemampuan bisnis?
```

Bukan hanya:

```text
Framework apa yang dipakai?
Broker apa yang dipakai?
Gateway apa yang dipakai?
Database apa yang dipakai?
```

Framework dan tool adalah implementation detail. Architecture style adalah bentuk kerja sama antar bagian sistem.

Contoh architecture style:

1. request/response microservices,
2. event-driven microservices,
3. workflow-driven microservices,
4. CQRS-based microservices,
5. API composition,
6. Backend-for-Frontend,
7. data pipeline microservices,
8. service mesh oriented architecture,
9. serverless microservices,
10. hybrid architecture.

Yang penting: satu sistem nyata hampir selalu memakai lebih dari satu style.

Contoh:

```text
Public API           → API Gateway + BFF
Case lifecycle       → workflow-driven + state machine
Document indexing    → event-driven projection
Reporting            → CQRS/materialized read model
Payment/fee process  → saga orchestration
Audit                → append-only event/log pipeline
Admin UI             → request/response CRUD
```

Jadi pertanyaan yang matang bukan:

> “Sistem ini microservices atau event-driven?”

Tetapi:

> “Subdomain mana yang cocok sync, mana yang cocok async, mana yang perlu workflow, mana yang perlu CQRS, mana yang cukup modular monolith, dan boundary mana yang jangan dipisah?”

---

## 2. Jangan Menganggap Semua Microservice Sama

Microservice berbeda-beda berdasarkan perannya.

### 2.1 Capability Service

Service yang merepresentasikan kemampuan bisnis utama.

Contoh:

```text
ApplicationService
CaseService
PaymentService
DocumentService
LicenseService
InspectionService
```

Ciri:

1. punya business invariant,
2. punya data authority,
3. biasanya punya state,
4. punya lifecycle,
5. dimiliki oleh tim/domain owner tertentu.

### 2.2 Process Service

Service yang mengoordinasikan proses lintas service.

Contoh:

```text
ApplicationSubmissionWorkflow
RenewalProcessManager
AppealCaseOrchestrator
```

Ciri:

1. menyimpan status proses,
2. memanggil beberapa service,
3. menangani timeout,
4. menangani compensation,
5. menghasilkan audit trail proses.

### 2.3 Integration Service

Service yang menghubungkan sistem internal dengan sistem eksternal.

Contoh:

```text
IdentityGateway
EmailConnector
PaymentGatewayAdapter
ExternalRegistryAdapter
OneMapConnector
```

Ciri:

1. menyembunyikan protokol eksternal,
2. menangani retry/backoff/rate limit,
3. menerjemahkan schema eksternal ke internal,
4. sering menjadi anti-corruption layer.

### 2.4 Query Service / Read Model Service

Service untuk query, listing, search, dashboard, dan reporting.

Contoh:

```text
CaseListingQueryService
AuditSearchService
DashboardProjectionService
```

Ciri:

1. mengoptimalkan read path,
2. bisa memakai denormalized table/index,
3. biasanya eventual consistent,
4. tidak boleh menjadi hidden source of truth.

### 2.5 Edge Service / BFF

Service yang dekat dengan client experience.

Contoh:

```text
CitizenPortalBff
OfficerPortalBff
MobileBff
AdminConsoleBff
```

Ciri:

1. mengagregasi kebutuhan UI,
2. menerjemahkan internal model ke view model,
3. mengurangi chatty UI,
4. tidak boleh menyimpan business invariant utama.

### 2.6 Platform/Utility Service

Service pendukung teknis.

Contoh:

```text
NotificationService
TemplateRenderingService
FileScanningService
SchedulerService
```

Ciri:

1. reusable,
2. utility-like,
3. sering rawan menjadi “common service” yang terlalu besar,
4. perlu boundary yang jelas agar tidak menjadi dumping ground.

---

## 3. Style 1 — Request/Response Microservices

## 3.1 Bentuk Dasar

```text
Client
  ↓ HTTP/gRPC
Service A
  ↓ HTTP/gRPC
Service B
  ↓ HTTP/gRPC
Service C
```

Ini gaya yang paling mudah dipahami. Satu service mengirim request ke service lain dan menunggu response.

Biasanya memakai:

1. REST over HTTP,
2. gRPC,
3. GraphQL internal gateway,
4. synchronous messaging RPC-like pattern,
5. Java HTTP clients seperti JDK HttpClient, OkHttp, WebClient, RestClient, Feign, atau MicroProfile REST Client.

## 3.2 Kapan Cocok

Request/response cocok ketika:

1. user sedang menunggu hasil langsung,
2. operasi pendek,
3. dependency cepat dan reliable,
4. consistency perlu segera diketahui,
5. failure harus langsung dikembalikan ke caller,
6. workflow tidak panjang,
7. jumlah service dalam critical path kecil.

Contoh yang cocok:

```text
GET /applications/{id}
GET /officers/{id}/profile
POST /postal-code/validate
GET /documents/{id}/metadata
```

## 3.3 Kapan Berbahaya

Request/response berbahaya ketika:

1. call chain terlalu panjang,
2. satu request user memanggil banyak service serial,
3. dependency lambat,
4. retry tidak dibatasi,
5. timeout tidak konsisten,
6. semua service harus online agar satu flow berhasil,
7. transaksi bisnis sebenarnya panjang tetapi dipaksa synchronous.

Contoh buruk:

```text
Submit Application API
  → validate applicant
  → validate company
  → validate address
  → reserve fee
  → generate case
  → notify officer
  → create audit entry
  → render email
  → send email
  → update dashboard
```

Jika semua dilakukan synchronously dalam satu request, latency naik, failure probability naik, rollback sulit, dan user experience rapuh.

## 3.4 Mental Model

Synchronous call adalah **temporal coupling**.

Artinya:

```text
Caller dan callee harus hidup pada waktu yang sama.
```

Jika Service A memanggil Service B synchronously, maka availability operasi A bergantung pada availability B.

Jika A memanggil B, C, D, dan E, maka availability total bukan rata-rata availability, tetapi kombinasi semua dependency.

Secara kasar:

```text
Availability total ≈ A × B × C × D × E
```

Jika masing-masing 99.9%, chain 5 dependency bisa turun menjadi sekitar 99.5% sebelum menghitung network, timeout, dan overload.

## 3.5 Design Rule

Gunakan request/response untuk:

```text
Need answer now
Need bounded latency
Need direct user feedback
Need simple interaction
```

Hindari untuk:

```text
Long-running workflow
Cross-service transaction
Bulk processing
Slow side effect
Fan-out operation
Notification
Index update
Audit enrichment
```

## 3.6 Java Consideration

### Java 8

Biasanya:

1. RestTemplate,
2. Apache HttpClient,
3. OkHttp,
4. blocking servlet thread model.

Perhatian:

1. thread pool exhaustion,
2. connection pool leak,
3. timeout default buruk,
4. blocking chain berbahaya.

### Java 11+

JDK HttpClient tersedia sebagai client modern.

Manfaat:

1. HTTP/2 support,
2. async API,
3. lebih baik daripada `HttpURLConnection` lama.

### Java 21–25

Virtual threads membuat blocking request/response lebih murah dari sisi thread, tetapi **tidak membuat dependency remote menjadi murah**.

Virtual threads membantu:

```text
more concurrent blocking calls
simpler imperative code
less pressure on platform threads
```

Tetapi tidak menghapus:

```text
remote latency
remote failure
downstream overload
database bottleneck
connection pool limit
retry storm
```

Rule penting:

> Virtual threads solve thread scalability, not distributed systems correctness.

---

## 4. Style 2 — Event-Driven Microservices

## 4.1 Bentuk Dasar

```text
Service A
  → publishes Event X
       ↓
     Broker / Stream
       ↓
Service B consumes Event X
Service C consumes Event X
Service D consumes Event X
```

Event-driven architecture memakai event untuk menyebarkan fakta bahwa sesuatu telah terjadi.

Contoh event:

```text
ApplicationSubmitted
CaseAssigned
PaymentConfirmed
DocumentVerified
LicenseIssued
AppealFiled
```

## 4.2 Event Bukan Command

Event adalah fakta masa lalu.

```text
ApplicationSubmitted
```

Bukan instruksi.

```text
CreateCaseNow
```

Command meminta sesuatu dilakukan. Event menyatakan sesuatu sudah terjadi.

Perbedaan ini penting karena event-driven system yang buruk sering memakai event bus sebagai remote command bus tersembunyi.

Contoh buruk:

```text
SendEmailEvent
GeneratePdfEvent
UpdateDatabaseEvent
```

Nama seperti itu sering bukan event domain, tetapi command yang disamarkan.

## 4.3 Kapan Cocok

Event-driven cocok ketika:

1. banyak consumer perlu mengetahui perubahan,
2. publisher tidak perlu tahu siapa consumer,
3. side effect bisa terjadi setelah transaksi utama,
4. proses bisa eventual consistent,
5. replay berguna,
6. audit/history penting,
7. service perlu loose temporal coupling.

Contoh cocok:

```text
ApplicationSubmitted → Case service creates initial case
ApplicationSubmitted → Notification service sends confirmation
ApplicationSubmitted → Reporting projection updates dashboard
ApplicationSubmitted → Audit pipeline records business fact
```

## 4.4 Kapan Berbahaya

Event-driven berbahaya ketika:

1. event semantic tidak jelas,
2. tidak ada owner event,
3. schema berubah sembarangan,
4. consumer diam-diam bergantung pada urutan tertentu,
5. replay tidak aman,
6. duplicate tidak ditangani,
7. business flow tersebar tanpa visibilitas,
8. error handling tidak jelas.

Event-driven yang buruk menghasilkan:

```text
event soup
hidden workflow
hard-to-debug production behavior
uncontrolled fan-out
schema chaos
```

## 4.5 Mental Model

Event-driven architecture mengubah komunikasi dari:

```text
Ask service B to do something now
```

menjadi:

```text
Publish a fact and allow other services to react independently
```

Ini mengurangi temporal coupling, tetapi menambah complexity di:

1. ordering,
2. duplication,
3. replay,
4. schema compatibility,
5. observability,
6. eventual consistency,
7. debugging.

## 4.6 Java Consideration

Java service bisa memakai:

1. Kafka,
2. RabbitMQ,
3. JMS/Jakarta Messaging,
4. Pulsar,
5. cloud queues,
6. outbox + CDC.

Tetapi tool bukan inti. Yang penting:

```text
Can the consumer process event idempotently?
Can event be replayed safely?
Can schema evolve safely?
Can failure be observed?
Can business owner understand the flow?
```

### Java 8–17

Biasanya memakai thread pool consumer, listener container, atau reactive stream library.

### Java 21–25

Virtual threads dapat membantu consumer blocking workload, tetapi partition ordering, broker flow control, dan transaction semantics tetap perlu didesain eksplisit.

---

## 5. Style 3 — Workflow-Driven Microservices

## 5.1 Bentuk Dasar

```text
Workflow / Process Manager
  → Step 1: call Service A
  → Step 2: wait event from Service B
  → Step 3: timer / SLA
  → Step 4: human task
  → Step 5: compensation if failed
```

Workflow-driven architecture memakai process manager/orchestrator untuk mengelola proses bisnis lintas service.

Contoh:

```text
Application Submission Workflow
Renewal Workflow
Appeal Workflow
Investigation Workflow
Enforcement Case Workflow
```

## 5.2 Kapan Cocok

Workflow-driven cocok ketika:

1. proses panjang,
2. banyak step,
3. ada human task,
4. ada timer/SLA,
5. ada escalation,
6. ada compensation,
7. visibility proses penting,
8. compliance/audit membutuhkan jejak proses,
9. debugging choreography terlalu sulit.

Contoh:

```text
Application submitted
  → validate applicant
  → validate documents
  → assign officer
  → wait officer review
  → request clarification if needed
  → wait applicant response
  → supervisor approval
  → issue license
  → notify applicant
```

Ini bukan sekadar event chain. Ini process lifecycle.

## 5.3 Kapan Berbahaya

Workflow-driven berbahaya ketika:

1. orchestrator menjadi god service,
2. semua business logic pindah ke workflow engine,
3. service menjadi dumb CRUD endpoint,
4. workflow engine menjadi bottleneck,
5. workflow versioning tidak dirancang,
6. failure workflow tidak bisa dipulihkan,
7. process definition tidak sesuai domain model.

## 5.4 Orchestration vs Choreography

### Choreography

```text
Service A publishes event
Service B reacts and publishes event
Service C reacts and publishes event
```

Kelebihan:

1. loose coupling,
2. scalable fan-out,
3. service autonomy tinggi.

Kekurangan:

1. global flow sulit dilihat,
2. debugging lebih sulit,
3. error path tersebar,
4. business process tidak eksplisit.

### Orchestration

```text
Orchestrator decides next step
Service A/B/C execute local capability
```

Kelebihan:

1. process visibility,
2. easier audit,
3. easier timeout handling,
4. easier compensation,
5. easier debugging.

Kekurangan:

1. orchestrator bisa terlalu besar,
2. coupling ke process manager,
3. central point of coordination,
4. perlu versioning workflow.

## 5.5 Mental Model

Workflow style cocok jika domain memiliki konsep:

```text
process instance
step
transition
timer
actor
state
escalation
compensation
audit
```

Jika semua itu ada, jangan sembunyikan proses dalam event chain acak.

## 5.6 Java Consideration

Java ecosystem sering memakai:

1. Camunda,
2. Flowable,
3. Activiti,
4. Temporal Java SDK,
5. custom process manager,
6. Spring Statemachine-like approach,
7. database-backed state machine.

Tetapi part ini tidak mengulang detail Camunda/BPMN. Fokusnya adalah arsitektur:

```text
Should workflow be explicit?
Who owns it?
Where is process state stored?
How is versioning handled?
How is compensation represented?
How is audit produced?
```

---

## 6. Style 4 — CQRS-Based Microservices

## 6.1 Bentuk Dasar

CQRS memisahkan command/write model dari query/read model.

```text
Command side
  → validate intent
  → enforce invariant
  → write source of truth
  → publish event

Query side
  ← consume event
  ← build projection/read model
  ← serve fast queries
```

## 6.2 Kapan Cocok

CQRS cocok ketika:

1. read pattern sangat berbeda dari write pattern,
2. query butuh join lintas boundary,
3. listing/reporting/dashboard berat,
4. search butuh denormalized model,
5. read scalability berbeda dari write scalability,
6. audit/history penting,
7. eventual consistency dapat diterima.

Contoh:

```text
Case command model:
  - approve case
  - reject case
  - assign officer
  - request clarification

Case listing read model:
  - filter by status
  - filter by officer
  - filter by SLA breach
  - sort by last action date
  - search by applicant name
```

Write model dan read model punya struktur yang sangat berbeda.

## 6.3 Kapan Berbahaya

CQRS berbahaya ketika:

1. domain masih sederhana,
2. team belum siap mengelola eventual consistency,
3. read model dianggap source of truth,
4. projection error tidak terdeteksi,
5. rebuild projection tidak dirancang,
6. user experience tidak siap menghadapi stale data.

## 6.4 Mental Model

CQRS mengatakan:

> Model terbaik untuk mengubah state belum tentu model terbaik untuk membaca state.

Write model menjaga kebenaran. Read model menjaga kegunaan query.

## 6.5 Java Consideration

Command side biasanya memakai:

1. Spring Boot service,
2. Jakarta service,
3. JPA/JDBC/MyBatis,
4. optimistic locking,
5. transactional outbox.

Query side bisa memakai:

1. PostgreSQL/Oracle denormalized table,
2. Elasticsearch/OpenSearch,
3. Redis materialized view,
4. ClickHouse/QuestDB untuk analytical read,
5. Kafka Streams/ksqlDB projection,
6. custom projection worker.

Java 21–25 virtual threads membantu blocking projection worker, tetapi tidak menggantikan desain idempotency dan replay.

---

## 7. Style 5 — API Composition Architecture

## 7.1 Bentuk Dasar

```text
Client
  ↓
API Composer / Aggregator / BFF
  → Service A
  → Service B
  → Service C
  → combine response
```

API composition menyelesaikan query lintas service dengan memanggil beberapa service dan menggabungkan hasilnya.

## 7.2 Kapan Cocok

API composition cocok ketika:

1. query sederhana,
2. jumlah dependency kecil,
3. latency masih acceptable,
4. freshness harus real-time,
5. data tidak perlu disimpan sebagai projection,
6. aggregation dekat dengan UI.

Contoh:

```text
GET /application-detail-page/{id}
  → Application service
  → Applicant profile service
  → Document metadata service
  → Payment status service
```

## 7.3 Kapan Berbahaya

API composition berbahaya ketika:

1. fan-out besar,
2. nested composition,
3. setiap halaman memanggil banyak service,
4. sorting/filtering dilakukan setelah mengambil data besar,
5. dependency failure membuat seluruh page gagal,
6. aggregator menjadi god service.

Contoh buruk:

```text
GET /case-listing?page=1
  → get 100 cases
  → for each case call applicant service
  → for each case call SLA service
  → for each case call payment service
  → for each case call officer service
```

Ini N+1 remote call problem.

## 7.4 Mental Model

API composition adalah query-time join.

Database join diganti menjadi remote join.

Remote join jauh lebih mahal karena:

1. network latency,
2. partial failure,
3. rate limit,
4. timeout,
5. serialization,
6. inconsistent freshness.

Gunakan API composition untuk small fan-out. Untuk large fan-out, gunakan materialized view atau CQRS.

---

## 8. Style 6 — Backend-for-Frontend Architecture

## 8.1 Bentuk Dasar

```text
Web UI     → Web BFF     → Internal services
Mobile App → Mobile BFF  → Internal services
Admin UI   → Admin BFF   → Internal services
```

BFF adalah service yang disesuaikan untuk kebutuhan experience tertentu.

## 8.2 Kapan Cocok

BFF cocok ketika:

1. client berbeda punya kebutuhan data berbeda,
2. UI terlalu chatty jika langsung memanggil service internal,
3. mobile butuh payload kecil,
4. web butuh view model kompleks,
5. admin console punya kebutuhan berbeda dari public portal,
6. token/session handling perlu dibungkus.

## 8.3 Apa yang Boleh di BFF

BFF boleh berisi:

1. view model composition,
2. request shaping,
3. response shaping,
4. client-specific validation ringan,
5. pagination adaptation,
6. localization support,
7. feature flag presentation,
8. token relay/session bridging.

## 8.4 Apa yang Tidak Boleh di BFF

BFF tidak boleh menjadi tempat:

1. business invariant utama,
2. approval rule,
3. regulatory decision,
4. source of truth,
5. long-running workflow,
6. hidden transaction manager.

## 8.5 Mental Model

BFF adalah **experience adapter**, bukan domain owner.

Jika BFF hilang, domain tetap harus benar. Yang rusak hanya cara client mengaksesnya.

---

## 9. Style 7 — Data Pipeline Microservices

## 9.1 Bentuk Dasar

```text
Source System
  → ingestion service
  → validation service
  → enrichment service
  → transformation service
  → storage/indexing service
  → analytics/reporting
```

Data pipeline microservices fokus pada pemindahan, validasi, transformasi, enrichment, dan publikasi data.

## 9.2 Kapan Cocok

Cocok untuk:

1. audit pipeline,
2. reporting pipeline,
3. search indexing,
4. external data import,
5. data archival,
6. compliance monitoring,
7. event enrichment,
8. document processing.

## 9.3 Risiko

Risiko utama:

1. duplicate processing,
2. out-of-order data,
3. schema drift,
4. partial reprocessing,
5. poison record,
6. backfill impact,
7. unclear data lineage,
8. hidden source of truth.

## 9.4 Mental Model

Data pipeline bukan sekadar “worker”. Ia harus punya:

```text
source identity
input contract
output contract
checkpoint
retry strategy
idempotency
lineage
replay strategy
error quarantine
observability
```

## 9.5 Java Consideration

Java pipeline bisa memakai:

1. Kafka Streams,
2. Spring Batch,
3. Jakarta Batch,
4. custom worker,
5. Debezium consumer,
6. Flink/Spark integration,
7. plain Java virtual-thread workers.

Namun, semakin pipeline menjadi critical, semakin penting untuk memiliki checkpoint dan replay design.

---

## 10. Style 8 — Service Mesh Oriented Architecture

## 10.1 Bentuk Dasar

```text
Service A → Sidecar Proxy → Network → Sidecar Proxy → Service B
```

Service mesh memindahkan sebagian concern komunikasi ke infrastructure layer.

Biasanya menangani:

1. mTLS,
2. traffic routing,
3. retry,
4. timeout,
5. circuit breaking,
6. telemetry,
7. policy,
8. canary routing.

## 10.2 Kapan Cocok

Service mesh cocok ketika:

1. service count besar,
2. bahasa/runtime beragam,
3. mTLS antar service wajib,
4. traffic control kompleks,
5. platform team matang,
6. observability standard perlu dipaksakan,
7. deployment/canary policy perlu seragam.

## 10.3 Kapan Berbahaya

Service mesh berbahaya ketika:

1. organisasi belum siap operasional,
2. service count kecil,
3. debugging network masih lemah,
4. retry terjadi di app dan mesh sekaligus,
5. timeout policy bertabrakan,
6. sidecar overhead tidak dihitung,
7. developer menganggap mesh menyelesaikan semua resilience.

## 10.4 Mental Model

Service mesh bukan pengganti desain aplikasi.

Mesh bisa membantu:

```text
transport security
traffic policy
standard telemetry
routing control
```

Tetapi mesh tidak tahu:

```text
business idempotency
semantic retry safety
compensation
aggregate invariant
user intent
legal audit meaning
```

Jangan meletakkan keputusan domain di mesh.

---

## 11. Style 9 — Serverless Microservices

## 11.1 Bentuk Dasar

```text
Event/API
  → Function
  → Managed service / DB / queue
```

Serverless microservices memakai function atau managed runtime sebagai unit deployment.

Contoh:

```text
API Gateway → Lambda → DynamoDB
S3 event → Lambda → Queue
Queue event → Function → external API
```

## 11.2 Kapan Cocok

Serverless cocok ketika:

1. workload event-based,
2. traffic spiky,
3. operasi pendek,
4. infrastructure management ingin dikurangi,
5. cost per invocation lebih ekonomis,
6. team menerima cloud coupling,
7. cold start acceptable.

## 11.3 Kapan Kurang Cocok

Kurang cocok ketika:

1. long-running workflow kompleks,
2. low-latency strict,
3. heavy JVM startup tanpa mitigasi,
4. connection management sulit,
5. local debugging penting,
6. cloud portability wajib,
7. high sustained throughput lebih mahal.

## 11.4 Java Consideration

Java serverless punya tantangan:

1. cold start,
2. classloading,
3. dependency size,
4. connection reuse,
5. reflection-heavy frameworks,
6. native image trade-off.

Java 17/21 lebih cocok daripada Java 8 untuk modern serverless runtime, tetapi tuning masih diperlukan.

Quarkus, Micronaut, Spring Native/AOT, dan GraalVM sering dipertimbangkan, tetapi bukan magic bullet. Native image mengurangi startup, tetapi menambah build complexity, reflection configuration issue, dan runtime behavior yang berbeda.

---

## 12. Style 10 — Actor-like / Message-Driven Service Model

## 12.1 Bentuk Dasar

```text
Entity/Actor mailbox
  → process messages sequentially
  → update state
  → emit events
```

Actor-like architecture cocok untuk domain yang memiliki banyak entity independen dengan state dan message ordering per entity.

Contoh:

```text
CaseActor(caseId)
ApplicationActor(applicationId)
SessionActor(sessionId)
DeviceActor(deviceId)
```

## 12.2 Kapan Cocok

Cocok ketika:

1. state bisa dipartisi per key,
2. ordering per key penting,
3. concurrency global tinggi,
4. setiap entity punya lifecycle,
5. command bisa diproses secara serial per aggregate,
6. contention antar entity rendah.

## 12.3 Risiko

Risiko:

1. actor placement,
2. recovery,
3. persistence,
4. mailbox backlog,
5. cross-actor transaction,
6. debugging,
7. framework lock-in.

## 12.4 Java Consideration

Java ecosystem historis mengenal Akka/Pekko, Vert.x, custom queue-per-key, Kafka partition-per-key, atau database locking per aggregate.

Virtual threads di Java 21+ membuka opsi imperative actor-like implementation yang lebih sederhana, tetapi ordering, mailbox, persistence, dan backpressure tetap harus didesain.

---

## 13. Style 11 — Modular Monolith as Strategic Companion

Walaupun seri ini tentang microservices, engineer top-tier tidak boleh anti-monolith secara dogmatis.

Modular monolith adalah satu deployment unit dengan boundary internal yang kuat.

```text
Single deployable
  ├─ application module
  ├─ case module
  ├─ payment module
  ├─ document module
  └─ notification module
```

## 13.1 Kapan Modular Monolith Lebih Baik

Lebih baik ketika:

1. team masih kecil,
2. domain belum stabil,
3. boundary belum jelas,
4. distributed operations belum matang,
5. latency antar module harus rendah,
6. transaksi kuat masih dominan,
7. deployment independence belum bernilai tinggi.

## 13.2 Kapan Harus Mulai Split

Mulai split ketika:

1. satu module berubah jauh lebih sering,
2. ownership jelas berbeda,
3. scaling profile berbeda,
4. data ownership jelas,
5. runtime failure perlu diisolasi,
6. deployment bottleneck nyata,
7. boundary sudah stabil.

## 13.3 Mental Model

Microservices bukan tujuan akhir. Tujuan akhirnya adalah:

```text
sistem yang bisa berubah aman, berjalan andal, dipahami manusia, dan dipertanggungjawabkan.
```

Jika modular monolith memenuhi itu lebih baik, maka itu pilihan lebih matang.

---

## 14. Hybrid Architecture: Real System Hampir Selalu Campuran

Sistem enterprise nyata biasanya hybrid.

Contoh sistem regulatory case management:

```text
External Portal
  → API Gateway
  → Citizen BFF
  → Application Command Service
  → Application DB
  → Outbox
  → Event Broker

Event Broker
  → Case Workflow Service
  → Notification Service
  → Audit Projection Service
  → Dashboard Projection Service
  → Search Indexing Service

Officer Portal
  → Officer BFF
  → Case Query Service
  → Case Command Service

Case Workflow Service
  → Document Service
  → Payment Service
  → Identity/Registry Connector
  → SLA/Escalation Scheduler
```

Di dalam satu sistem ini ada:

1. request/response,
2. BFF,
3. event-driven,
4. workflow orchestration,
5. CQRS/read model,
6. outbox,
7. data pipeline,
8. integration adapter,
9. state machine.

Ini normal. Yang tidak normal adalah tidak sadar style mana sedang dipakai.

---

## 15. Architecture Style Decision Matrix

Gunakan matrix berikut ketika memilih style.

| Concern | Request/Response | Event-Driven | Workflow-Driven | CQRS | API Composition | BFF |
|---|---:|---:|---:|---:|---:|---:|
| User needs immediate answer | High | Low | Medium | Low | High | High |
| Long-running process | Low | Medium | High | Low | Low | Low |
| Many consumers | Low | High | Medium | Medium | Low | Low |
| Strong consistency | Medium | Low | Medium | Medium | Low | Low |
| Eventual consistency acceptable | Medium | High | High | High | Medium | Medium |
| Process visibility | Medium | Low | High | Medium | Low | Medium |
| Query complexity | Low | Medium | Medium | High | Medium | High |
| Fan-out risk | Medium | Low | Medium | Low | High | Medium |
| Debuggability | High simple / Low chain | Medium-Low | High if designed | Medium | Medium | Medium |
| Operational complexity | Low-Medium | High | High | High | Medium | Medium |
| Best for | Direct operations | Fact propagation | Business process | Read/write separation | Small aggregation | Client experience |

Tidak ada style yang selalu menang. Style yang baik adalah style yang cocok dengan force dominan.

---

## 16. Forces yang Harus Dibaca Sebelum Memilih Style

Sebelum memilih architecture style, baca forces berikut.

### 16.1 Latency Force

Pertanyaan:

```text
Apakah user harus menunggu hasil ini sekarang?
```

Jika ya, sync mungkin perlu.

Jika tidak, async mungkin lebih aman.

### 16.2 Consistency Force

Pertanyaan:

```text
Apakah state harus benar sekarang, atau boleh converge nanti?
```

Jika harus benar sekarang, boundary transaksi harus hati-hati.

Jika boleh converge, event-driven/CQRS lebih masuk akal.

### 16.3 Ownership Force

Pertanyaan:

```text
Siapa pemilik business capability ini?
```

Jika owner berbeda, service boundary mungkin masuk akal.

Jika owner sama dan perubahan sangat erat, split bisa memperburuk.

### 16.4 Failure Force

Pertanyaan:

```text
Kalau dependency ini down, apakah operasi utama harus gagal?
```

Jika tidak, jangan taruh dependency itu di critical synchronous path.

### 16.5 Volume Force

Pertanyaan:

```text
Apakah workload ini high-throughput, bursty, bulk, atau interactive?
```

Interactive cocok sync. Bulk/bursty sering lebih cocok queue/stream.

### 16.6 Audit Force

Pertanyaan:

```text
Apakah proses ini harus bisa dijelaskan setelah kejadian?
```

Jika ya, workflow/state machine/event log menjadi penting.

### 16.7 Evolution Force

Pertanyaan:

```text
Apakah schema/API/event akan sering berubah?
```

Jika ya, compatibility dan contract governance harus menjadi bagian style.

---

## 17. Common Style Combinations

## 17.1 Gateway + BFF + Request/Response

Cocok untuk UI-oriented enterprise apps.

```text
Browser → Gateway → Web BFF → Services
```

Risiko:

1. BFF terlalu banyak logic,
2. API composition fan-out,
3. duplicated logic antar BFF.

## 17.2 Command Service + Outbox + Event-Driven Projections

Cocok untuk domain dengan source of truth dan read model.

```text
Command Service → DB transaction → Outbox → Broker → Projection Service
```

Risiko:

1. projection lag,
2. outbox backlog,
3. event schema drift.

## 17.3 Workflow Orchestrator + Capability Services

Cocok untuk long-running business process.

```text
Workflow Service → Application Service
                 → Document Service
                 → Payment Service
                 → Notification Service
```

Risiko:

1. orchestrator terlalu pintar,
2. service menjadi anemic,
3. workflow versioning sulit.

## 17.4 CQRS + Search Index

Cocok untuk listing/search/reporting.

```text
Domain events → Projection worker → Search index → Query API
```

Risiko:

1. stale read,
2. index rebuild,
3. authorization filtering salah.

## 17.5 Modular Monolith + Event Extraction Later

Cocok untuk domain baru.

```text
Start modular
Stabilize boundary
Extract high-value service
Introduce events
```

Risiko:

1. boundary internal tidak dijaga,
2. shared DB dependency mengeras,
3. extraction terlambat.

---

## 18. Architecture Style Smells

## 18.1 Semua Flow Synchronous

Gejala:

```text
Semua operasi user memanggil banyak service secara langsung.
```

Dampak:

1. latency tinggi,
2. availability turun,
3. cascading failure,
4. sulit scale.

## 18.2 Semua Hal Dijadikan Event

Gejala:

```text
Bahkan operasi yang butuh jawaban langsung dibuat async.
```

Dampak:

1. UX membingungkan,
2. debugging sulit,
3. eventual consistency tanpa alasan,
4. business flow tidak terlihat.

## 18.3 Gateway Menjadi Otak Sistem

Gejala:

```text
Gateway tahu workflow, rule, validation, dan aggregation berat.
```

Dampak:

1. god gateway,
2. bottleneck,
3. domain logic bocor,
4. ownership kabur.

## 18.4 Workflow Engine Menjadi Database Bisnis

Gejala:

```text
Semua state domain hanya hidup di workflow engine.
```

Dampak:

1. domain service kehilangan invariant,
2. process state dan domain state bercampur,
3. migration sulit.

## 18.5 CQRS Tanpa Rebuild Strategy

Gejala:

```text
Projection dibuat, tetapi tidak bisa dibangun ulang.
```

Dampak:

1. data drift permanen,
2. production fix manual,
3. audit sulit.

## 18.6 Event-Driven Tanpa Idempotency

Gejala:

```text
Consumer menganggap event hanya datang sekali.
```

Dampak:

1. duplicate side effect,
2. double email,
3. double payment,
4. state corruption.

---

## 19. Java 8–25 Architecture Style Implications

## 19.1 Java 8

Java 8 masih banyak dipakai di enterprise legacy.

Kekuatan:

1. ecosystem matang,
2. banyak library support,
3. baseline enterprise lama.

Keterbatasan:

1. tidak ada JDK HttpClient modern,
2. tidak ada virtual threads,
3. GC modern terbatas dibanding JDK baru,
4. container awareness tidak sebaik versi baru,
5. async code sering lebih kompleks.

Style yang perlu hati-hati:

```text
high-concurrency blocking API composition
large fan-out sync chain
worker pool without bounded queue
```

## 19.2 Java 11

Java 11 adalah modern LTS baseline awal.

Manfaat:

1. JDK HttpClient,
2. better container support,
3. better GC options,
4. stronger migration target dari Java 8.

## 19.3 Java 17

Java 17 menjadi baseline modern enterprise yang umum.

Manfaat:

1. sealed classes,
2. records mulai tersedia dari versi sebelumnya dan matang,
3. pattern-friendly domain modeling,
4. runtime improvement.

Cocok untuk:

```text
DTO modeling
command/event representation
state machine modeling
cleaner immutable models
```

## 19.4 Java 21

Java 21 membawa virtual threads sebagai fitur final.

Dampak:

1. blocking style menjadi lebih feasible,
2. imperative code lebih menarik kembali,
3. thread-per-request bisa dievaluasi ulang,
4. worker model bisa disederhanakan.

Namun:

```text
Virtual threads do not fix bad architecture styles.
```

Jika API composition fan-out 50 service, virtual threads hanya membuat waiting lebih murah, bukan dependency lebih reliable.

## 19.5 Java 25

Java 25 adalah versi modern setelah Java 21 dan menjadi horizon terbaru untuk seri ini. Untuk microservices, yang paling penting bukan satu fitur tunggal, tetapi akumulasi runtime maturity:

1. GC improvement,
2. observability/runtime diagnostics,
3. language ergonomics,
4. continued virtual-thread ecosystem adaptation,
5. better modern baseline for cloud-native Java.

Saat mendesain architecture style, versi Java memengaruhi implementation options, tetapi tidak mengubah hukum dasar distributed systems.

---

## 20. Framework Positioning

## 20.1 Spring Boot / Spring Cloud

Spring ecosystem kuat untuk:

1. request/response services,
2. API gateway,
3. service discovery,
4. config management,
5. circuit breaker integration,
6. distributed tracing,
7. messaging,
8. contract testing.

Tetapi Spring Cloud bukan pengganti architecture thinking.

Ia menyediakan building blocks. Engineer tetap harus memilih:

```text
sync or async?
orchestration or choreography?
API composition or CQRS?
local transaction or saga?
cache or source of truth?
```

## 20.2 Jakarta EE / MicroProfile

Jakarta/MicroProfile cocok untuk enterprise Java microservices yang ingin standar lebih vendor-neutral.

MicroProfile memberi building blocks seperti:

1. Config,
2. Health,
3. Fault Tolerance,
4. REST Client,
5. JWT Authentication,
6. OpenAPI,
7. Telemetry.

Tetapi lagi-lagi, spesifikasi menyediakan capability, bukan keputusan arsitektur.

## 20.3 Quarkus / Micronaut

Cocok untuk:

1. cloud-native runtime,
2. fast startup,
3. lower memory footprint,
4. native image consideration,
5. serverless/container density.

Tetapi native image tidak mengubah semantic complexity dari saga, event replay, atau CQRS projection.

## 20.4 Plain Java

Plain Java tetap valid untuk:

1. domain model,
2. command/event model,
3. state machine core,
4. worker runtime,
5. libraries,
6. high-performance service internals.

Top-tier engineer tidak memulai dari framework. Ia memulai dari forces, lalu memilih tool.

---

## 21. Worked Example: Regulatory Application System

Bayangkan sistem pengajuan izin/regulatory application.

## 21.1 Requirement

```text
Applicant submits application.
System validates data.
Documents are checked.
Payment may be required.
Officer reviews case.
Supervisor approves.
License is issued.
Applicant is notified.
Audit trail must be defensible.
Dashboard must show SLA status.
```

## 21.2 Naive Request/Response Design

```text
POST /submit
  → ApplicantService.validate()
  → DocumentService.validate()
  → PaymentService.reserve()
  → CaseService.create()
  → WorkflowService.start()
  → NotificationService.send()
  → DashboardService.update()
  → AuditService.record()
```

Masalah:

1. too many synchronous dependencies,
2. slow dependency delays submit,
3. notification failure can break submission,
4. dashboard update in critical path,
5. audit semantics unclear,
6. rollback impossible after some side effects.

## 21.3 Better Hybrid Design

```text
POST /applications
  → ApplicationCommandService
       - validate local invariant
       - persist ApplicationSubmitted state
       - write outbox event
       - return submission id

Outbox Publisher
  → publishes ApplicationSubmitted

Consumers:
  → CaseWorkflowService starts process
  → NotificationService sends confirmation
  → DashboardProjectionService updates read model
  → AuditService records business fact
  → SearchIndexService updates index
```

Officer review:

```text
Officer BFF
  → CaseQueryService for listing/detail
  → CaseCommandService for actions
  → CaseWorkflowService for process state
```

Payment:

```text
CaseWorkflowService
  → PaymentService reserve/confirm
  ← PaymentConfirmed event
```

Audit:

```text
Domain command result + event log + actor metadata + transition reason
```

## 21.4 Style Mapping

| Concern | Style |
|---|---|
| Submit request | Request/response command |
| Post-submit side effects | Event-driven |
| Officer lifecycle | Workflow-driven + state machine |
| Dashboard/listing | CQRS/materialized view |
| Portal UI | BFF/API composition |
| External payment/address/identity | Integration adapter |
| Audit/search/report | Data pipeline/projection |

This is what mature microservices look like: not one style, but deliberate composition.

---

## 22. Design Checklist

Sebelum memilih architecture style, jawab pertanyaan berikut.

### 22.1 Business and Domain

```text
Apa business capability utama?
Apa invariant yang harus dijaga?
Apa state lifecycle-nya?
Apa event domain yang benar-benar berarti?
Apa proses yang harus terlihat secara eksplisit?
```

### 22.2 Communication

```text
Apakah caller perlu jawaban langsung?
Apakah side effect boleh tertunda?
Apakah consumer banyak?
Apakah ordering penting?
Apakah duplicate aman?
```

### 22.3 Data

```text
Siapa source of truth?
Apakah query butuh join lintas service?
Apakah read model perlu denormalized?
Apakah projection bisa dibangun ulang?
```

### 22.4 Failure

```text
Dependency mana yang boleh gagal tanpa menggagalkan operasi utama?
Apa timeout budget?
Apa retry policy?
Apa fallback?
Apa compensation?
```

### 22.5 Operation

```text
Bisakah flow dilihat di trace/log/metrics?
Bisakah incident ditriage cepat?
Bisakah replay dilakukan aman?
Bisakah release dilakukan tanpa lockstep?
```

### 22.6 Ownership

```text
Siapa owner service?
Siapa owner event?
Siapa owner schema?
Siapa owner read model?
Siapa yang on-call?
```

---

## 23. Architecture Review Questions

Gunakan pertanyaan ini saat review desain microservices.

1. Style apa yang dipakai di setiap subdomain?
2. Apakah style itu dipilih sadar atau hanya mengikuti framework?
3. Apakah ada request/response chain terlalu panjang?
4. Apakah ada event-driven flow tanpa ownership?
5. Apakah workflow bisnis terlihat eksplisit?
6. Apakah query lintas service memakai API composition atau projection?
7. Apakah API composition memiliki fan-out limit?
8. Apakah read model punya rebuild strategy?
9. Apakah event consumer idempotent?
10. Apakah synchronous dependency benar-benar harus synchronous?
11. Apakah BFF menyimpan business logic yang seharusnya di domain service?
12. Apakah gateway menjadi god gateway?
13. Apakah orchestrator menjadi god service?
14. Apakah service mesh retry bertabrakan dengan app retry?
15. Apakah Java version membantu implementation atau hanya dijadikan alasan?
16. Apakah design bisa dijelaskan ke business owner?
17. Apakah failure mode bisa diuji?
18. Apakah style ini masih cocok jika traffic naik 10x?
19. Apakah style ini masih cocok jika team bertambah 3x?
20. Apakah style ini masih cocok jika regulatory audit datang 2 tahun lagi?

---

## 24. Production Readiness Checklist

Sebuah architecture style siap produksi jika:

```text
[ ] Communication style jelas: sync, async, workflow, query, atau hybrid.
[ ] Critical path latency dihitung.
[ ] Timeout budget ditentukan.
[ ] Retry policy ditentukan.
[ ] Idempotency strategy ada.
[ ] Event schema owner jelas.
[ ] API contract owner jelas.
[ ] Data source of truth jelas.
[ ] Read model freshness jelas.
[ ] Projection rebuild strategy ada.
[ ] Workflow state owner jelas.
[ ] Compensation strategy ada untuk proses panjang.
[ ] Audit semantics jelas.
[ ] Observability untuk flow lintas service tersedia.
[ ] Failure mode diuji.
[ ] Deployment compatibility diuji.
[ ] Ownership/on-call jelas.
[ ] Architecture decision record dibuat.
```

---

## 25. Anti-Pattern: Framework-First Architecture

Contoh reasoning yang lemah:

```text
Kita pakai Kafka, jadi architecture kita event-driven.
```

Belum tentu.

Kafka bisa dipakai sebagai:

1. event bus,
2. command bus,
3. log replication,
4. data pipeline,
5. async RPC hack,
6. integration buffer,
7. audit stream.

Tool tidak menentukan architecture style. Semantik penggunaan tool yang menentukan.

Contoh lain:

```text
Kita pakai Spring Cloud Gateway, jadi architecture kita microservices matang.
```

Belum tentu. Gateway hanya edge component. Jika service di belakangnya shared database, lockstep deployment, dan cyclic dependency, itu distributed monolith.

---

## 26. Anti-Pattern: Style Purism

Style purism adalah keyakinan bahwa satu style selalu benar.

Contoh:

```text
Semua harus event-driven.
Semua harus REST.
Semua harus gRPC.
Semua harus serverless.
Semua harus workflow engine.
Semua harus CQRS.
```

Ini tanda berpikir tool-driven, bukan force-driven.

Engineer top-tier bertanya:

```text
Apa constraint-nya?
Apa invariant-nya?
Apa failure mode-nya?
Apa ownership-nya?
Apa trade-off-nya?
```

Bukan:

```text
Pattern favorit saya apa?
```

---

## 27. Decision Framework: Cara Memilih Style

Gunakan langkah berikut.

## Step 1 — Identify User Interaction

```text
Apakah user menunggu hasil?
```

Jika ya, mulai dari request/response.

Jika tidak, pertimbangkan async/event/pipeline.

## Step 2 — Identify Business Process Length

```text
Apakah proses selesai dalam satu transaksi pendek?
```

Jika tidak, pertimbangkan workflow/saga/process manager.

## Step 3 — Identify Data Ownership

```text
Siapa source of truth?
```

Jika banyak service butuh membaca data gabungan, pertimbangkan API composition atau CQRS.

## Step 4 — Identify Consumer Count

```text
Berapa pihak yang perlu bereaksi atas perubahan?
```

Jika banyak, event-driven lebih cocok daripada direct calls.

## Step 5 — Identify Consistency Requirement

```text
Apakah hasil harus immediately consistent?
```

Jika ya, jangan asal async.

Jika tidak, gunakan eventual consistency secara eksplisit.

## Step 6 — Identify Failure Tolerance

```text
Apa yang boleh gagal tanpa menggagalkan operasi utama?
```

Side effect yang boleh gagal sebaiknya keluar dari synchronous path.

## Step 7 — Identify Observability Requirement

```text
Bisakah flow ini dijelaskan saat incident atau audit?
```

Jika tidak, style belum siap.

---

## 28. Mini Case Study: Memilih Style untuk “Submit Application”

Requirement:

```text
Applicant submit application.
Applicant must receive submission id immediately.
Email confirmation can be delayed.
Officer case creation should happen reliably.
Dashboard can be eventually consistent.
Audit must be defensible.
```

Decision:

| Concern | Style | Reason |
|---|---|---|
| Receive submission id | Request/response | User needs immediate confirmation |
| Persist application | Local transaction | Source of truth update |
| Publish fact | Outbox/event-driven | Avoid dual-write failure |
| Create case | Event-driven or workflow | Can happen after submission but must be reliable |
| Send email | Async consumer | Side effect should not break submit |
| Dashboard | CQRS projection | Query optimization and eventual consistency |
| Audit | Event/log pipeline + domain audit | Defensibility |

Bad design:

```text
Submit API waits for email, dashboard, search index, and audit enrichment.
```

Better design:

```text
Submit API guarantees application accepted and event recorded.
Other side effects are reliable async reactions.
```

---

## 29. Mini Case Study: Memilih Style untuk “Officer Case Listing”

Requirement:

```text
Officer wants list of cases filtered by status, SLA, applicant name, module, risk score, and last activity.
```

Bad design:

```text
BFF calls CaseService for page
Then calls ApplicantService for each case
Then calls SLAService for each case
Then calls RiskService for each case
Then calls ActivityService for each case
```

Problem:

```text
remote N+1
slow page
partial failure
inconsistent sorting
hard pagination
```

Better design:

```text
Case events + applicant snapshot + SLA events + activity events
  → CaseListingProjection
  → Query API serves officer listing
```

Style:

```text
CQRS/materialized view
```

Trade-off:

```text
listing may be slightly stale, but fast and reliable.
```

---

## 30. Mini Case Study: Memilih Style untuk “Appeal Process”

Requirement:

```text
Appeal filed.
Officer reviews.
Additional info may be requested.
Applicant has 14 days to respond.
Supervisor approves.
Decision letter generated.
Audit trail must show every step.
```

Style:

```text
workflow-driven + state machine + events
```

Reason:

1. long-running,
2. human task,
3. timer,
4. escalation,
5. audit,
6. multiple roles,
7. versioned process.

Bad design:

```text
AppealService emits event, many services react, and no one owns the whole process.
```

Better design:

```text
AppealWorkflow owns process state.
Appeal domain service owns appeal invariant.
Notification/document services perform side effects.
Events expose facts.
```

---

## 31. Exercise

Ambil satu sistem yang kamu kenal, lalu buat table berikut.

| Flow | User waits? | Long-running? | Many consumers? | Query-heavy? | Recommended style |
|---|---:|---:|---:|---:|---|
| Submit application | Yes | Partially | Yes | No | Request/response + outbox + event-driven |
| Officer listing | Yes | No | No | Yes | CQRS/read model |
| Appeal review | Yes/No | Yes | Medium | Medium | Workflow-driven |
| Send notification | No | No | Medium | No | Event-driven async consumer |
| Audit search | Yes | No | No | Yes | Data pipeline + read model |

Kemudian jawab:

1. Apa synchronous critical path terpanjang?
2. Dependency mana yang tidak seharusnya synchronous?
3. Flow mana yang membutuhkan workflow eksplisit?
4. Query mana yang tidak boleh API composition karena fan-out terlalu besar?
5. Event mana yang sebenarnya command terselubung?
6. Read model mana yang perlu rebuild strategy?
7. Boundary mana yang masih kabur?

---

## 32. Ringkasan

Microservices bukan satu bentuk arsitektur. Ia adalah pendekatan membangun sistem sebagai kumpulan service independen, tetapi cara service bekerja sama bisa berbeda-beda.

Style utama yang perlu dikuasai:

1. **Request/response** untuk operasi langsung dan bounded latency.
2. **Event-driven** untuk fact propagation dan loose temporal coupling.
3. **Workflow-driven** untuk long-running process, human task, SLA, dan compensation.
4. **CQRS** untuk memisahkan write correctness dari read optimization.
5. **API composition** untuk small real-time aggregation.
6. **BFF** untuk experience-specific adaptation.
7. **Data pipeline** untuk ingestion, projection, reporting, audit, dan search.
8. **Service mesh oriented** untuk platform-level traffic/security/telemetry concern.
9. **Serverless** untuk event-based managed runtime tertentu.
10. **Modular monolith** sebagai pilihan strategis saat microservices belum layak.

Kunci top-tier engineering:

```text
Do not choose style by fashion.
Choose style by forces.
```

Forces yang harus dibaca:

1. latency,
2. consistency,
3. ownership,
4. failure,
5. volume,
6. audit,
7. evolution,
8. operability,
9. team maturity.

Architecture style yang baik bukan yang paling modern, tetapi yang paling jujur terhadap masalah.

---

## 33. Referensi

1. Martin Fowler — Microservices:  
   `https://martinfowler.com/articles/microservices.html`

2. Microservices.io — What are microservices?:  
   `https://microservices.io/`

3. Microservices.io — Microservice Architecture Pattern:  
   `https://microservices.io/patterns/microservices.html`

4. Microservices.io — API Composition Pattern:  
   `https://microservices.io/patterns/data/api-composition.html`

5. Microservices.io — Saga Pattern:  
   `https://microservices.io/patterns/data/saga.html`

6. Microservices.io — Transactional Outbox Pattern:  
   `https://microservices.io/patterns/data/transactional-outbox.html`

7. Azure Architecture Center — Architecture Styles:  
   `https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/`

8. Azure Architecture Center — Design Patterns for Microservices:  
   `https://learn.microsoft.com/en-us/azure/architecture/microservices/design/patterns`

9. Azure Architecture Center — CQRS Pattern:  
   `https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs`

10. Azure Architecture Center — Event Sourcing Pattern:  
    `https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing`

11. Azure Architecture Center — API Gateways:  
    `https://learn.microsoft.com/en-us/azure/architecture/microservices/design/gateway`

12. Spring Cloud official project page:  
    `https://spring.io/projects/spring-cloud`

13. Spring Microservices guide:  
    `https://spring.io/microservices`

---

## 34. Status Seri

Seri belum selesai.

Saat ini selesai:

```text
Part 0 — Introduction and Mental Model
Part 1 — Distributed Systems Reality Before Microservices
Part 2 — Service Boundary Engineering
Part 3 — Domain Modeling for Microservices
Part 4 — Microservice Architecture Styles
```

Berikutnya:

```text
Part 5 — Communication Pattern: Synchronous APIs
```

File berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-05-synchronous-api-communication.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-03-domain-modeling-for-microservices.md">⬅️ 0. Posisi Part Ini Dalam Seri</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-05-synchronous-api-communication.md">Part 5 — Communication Pattern: Synchronous APIs ➡️</a>
</div>
