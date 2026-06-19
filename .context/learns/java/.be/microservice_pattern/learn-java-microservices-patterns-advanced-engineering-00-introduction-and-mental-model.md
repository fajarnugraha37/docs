# Learn Java Microservices Patterns Advanced Engineering

## Part 0 — Introduction and Mental Model

**Filename:** `learn-java-microservices-patterns-advanced-engineering-00-introduction-and-mental-model.md`  
**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 0 of 35  
**Target:** Java 8 hingga Java 25  
**Level:** Advanced / architecture / production engineering  

---

## 0. Tujuan Part Ini

Part ini adalah fondasi mental model untuk seluruh seri **Java Microservices Pattern — Advanced Engineering**.

Tujuan utama bukan membuat kita sekadar tahu istilah seperti:

- API Gateway
- Service Discovery
- Circuit Breaker
- Saga
- CQRS
- Outbox
- Event-driven architecture
- Service mesh
- Database-per-service
- Distributed tracing

Itu semua akan dibahas, tetapi bukan sebagai daftar template. Kita akan memperlakukan setiap pattern sebagai **jawaban terhadap tekanan tertentu** dalam sistem nyata.

Microservices bukan dimulai dari pertanyaan:

> “Framework apa yang harus dipakai?”

Pertanyaan yang lebih tepat adalah:

> “Jenis kompleksitas apa yang sedang kita hadapi, siapa yang harus memiliki perubahan tersebut, risiko apa yang harus diisolasi, data apa yang harus dijaga konsistensinya, failure apa yang mungkin terjadi, dan bagaimana sistem tetap bisa berevolusi tanpa runtuh?”

Part ini akan membangun cara berpikir tersebut.

Setelah menyelesaikan Part 0, kamu diharapkan mampu:

1. Menjelaskan microservices secara substansial, bukan sekadar “aplikasi dipecah menjadi service kecil”.
2. Membedakan microservices dari modular monolith, SOA, distributed monolith, dan event-driven platform.
3. Memahami kapan microservices masuk akal dan kapan menjadi kesalahan arsitektural.
4. Menilai microservices dari sisi boundary, ownership, deployment, data, consistency, failure, observability, dan cost.
5. Memahami posisi Java 8 hingga Java 25 dalam desain microservices modern.
6. Membangun mental model awal untuk seluruh pattern lanjutan di seri ini.

---

## 1. Premis Utama: Microservices Bukan Tujuan

Microservices adalah **alat organisasi dan arsitektur** untuk mengelola kompleksitas sistem besar.

Microservices bukan tujuan akhir.

Tujuan sebenarnya biasanya adalah:

- mempercepat perubahan bisnis,
- mengurangi coupling antar tim,
- membuat deployment lebih independen,
- mengisolasi failure,
- memungkinkan scaling per capability,
- memperjelas ownership,
- memisahkan domain yang berubah dengan kecepatan berbeda,
- meningkatkan evolvability sistem jangka panjang.

Kalau microservices tidak membantu tujuan-tujuan tersebut, maka microservices hanya menambah biaya.

### 1.1 Definisi Praktis

Secara praktis, microservices adalah gaya arsitektur di mana aplikasi besar dibentuk dari kumpulan service yang:

1. memiliki boundary yang jelas,
2. menjalankan proses/runtime sendiri,
3. memiliki model data dan model domain yang relatif otonom,
4. berkomunikasi lewat kontrak eksplisit,
5. bisa di-deploy secara independen,
6. dimiliki oleh tim atau kelompok ownership yang jelas,
7. dirancang untuk bertahan dalam kondisi partial failure.

Definisi populer dari Martin Fowler dan James Lewis menekankan bahwa microservices adalah kumpulan layanan kecil yang berjalan dalam proses sendiri, berkomunikasi menggunakan mekanisme ringan, dibangun di sekitar business capabilities, dan dapat di-deploy secara independen melalui automated deployment machinery.

Namun untuk engineer senior/principal, definisi tersebut belum cukup. Kita perlu menambahkan dimensi produksi:

> Microservices adalah strategi membagi sistem berdasarkan ownership, capability, data, failure boundary, dan evolution pressure, dengan konsekuensi bahwa kita harus menerima distributed systems complexity sebagai biaya utama.

---

## 2. Kesalahan Paling Umum: Mengira Microservices = Service Kecil

Banyak tim masuk ke microservices dengan asumsi:

> “Kalau monolith besar sulit diubah, kita pecah saja jadi banyak service kecil.”

Ini framing yang berbahaya.

Ukuran service bukan inti microservices.

Service kecil yang salah boundary bisa lebih buruk daripada monolith besar.

Contoh:

```text
User Service
Role Service
Permission Service
Menu Service
Profile Service
Department Service
Notification Service
Audit Service
Case Service
CaseStatus Service
CaseComment Service
CaseAttachment Service
```

Sekilas terlihat “micro”. Tetapi jika setiap request business harus memanggil 8 service secara synchronous, berbagi database, dan harus dirilis bersama, maka yang terbentuk bukan microservices.

Itu adalah **distributed monolith**.

### 2.1 Distributed Monolith

Distributed monolith adalah sistem yang secara deployment terlihat terpisah, tetapi secara perubahan, data, dan runtime masih sangat tergantung satu sama lain.

Ciri-cirinya:

- service harus deploy berurutan,
- perubahan kecil menyentuh banyak repository,
- service A tidak bisa jalan tanpa service B, C, D,
- database masih shared,
- domain model disalin di semua service,
- request chain terlalu panjang,
- gagal satu service membuat workflow besar gagal,
- integrasi diuji hanya lewat end-to-end environment,
- tim takut deploy independen,
- “microservice” hanya menjadi packaging fisik, bukan boundary semantik.

Distributed monolith sering lebih mahal daripada monolith karena kita tetap punya coupling monolith, tetapi ditambah biaya network, observability, deployment, debugging, security, dan data consistency.

### 2.2 Nano-Service Anti-Pattern

Nano-service adalah service yang terlalu kecil sehingga tidak punya business meaning yang cukup.

Contoh buruk:

```text
EmailValidationService
PostalCodeFormattingService
DateConversionService
StatusLabelService
CurrencyFormatterService
```

Jika service hanya membungkus function kecil dan dipanggil lewat network, maka kita membayar network latency untuk sesuatu yang seharusnya library/module lokal.

Rule of thumb:

> Jangan menjadikan function sebagai service hanya karena bisa dijadikan service.

Service boundary harus punya alasan kuat:

- business ownership,
- data ownership,
- scaling need,
- security isolation,
- regulatory isolation,
- lifecycle berbeda,
- deployment independence,
- failure isolation.

Kalau tidak ada alasan tersebut, module biasa mungkin lebih tepat.

---

## 3. Microservices sebagai Trade-off

Microservices bukan upgrade otomatis dari monolith.

Microservices adalah trade-off.

Ia membeli beberapa hal:

- autonomy,
- deployment independence,
- scaling independence,
- team ownership,
- technology flexibility,
- failure isolation,
- domain isolation.

Tetapi ia membayar dengan:

- distributed systems complexity,
- network latency,
- partial failure,
- data duplication,
- eventual consistency,
- operational overhead,
- observability complexity,
- security complexity,
- testing complexity,
- deployment coordination,
- higher cognitive load.

### 3.1 Persamaan Mental

Gunakan persamaan mental berikut:

```text
Microservices value
= benefit of independent evolution
  - cost of distributed coordination
  - cost of operational complexity
  - cost of data consistency management
```

Jika benefit independent evolution lebih kecil dari biaya distributed coordination, microservices tidak layak.

### 3.2 Pertanyaan Kritis

Sebelum memecah service, tanyakan:

1. Apakah bagian ini berubah dengan alasan yang berbeda?
2. Apakah dimiliki oleh tim berbeda?
3. Apakah punya data yang harus dimiliki sendiri?
4. Apakah punya scaling profile berbeda?
5. Apakah punya security boundary berbeda?
6. Apakah failure-nya harus diisolasi?
7. Apakah deployment independen benar-benar dibutuhkan?
8. Apakah organisasi siap mengoperasikan service tambahan?
9. Apakah observability sudah cukup matang?
10. Apakah consistency requirement-nya bisa diterima tanpa transaksi global?

Jika banyak jawaban “tidak”, kemungkinan microservice belum tepat.

---

## 4. Modular Monolith vs Microservices

Sebelum memilih microservices, engineer kuat harus memahami modular monolith.

### 4.1 Modular Monolith

Modular monolith adalah satu deployable application yang internalnya dipisahkan menjadi module-module domain yang jelas.

Contoh:

```text
aceas-platform
├── case-management
├── compliance
├── appeal
├── correspondence
├── document
├── audit
├── payment
├── reporting
└── identity-integration
```

Semua module masih berada dalam satu proses aplikasi dan satu deployment unit, tetapi boundary internal dijaga ketat.

### 4.2 Keunggulan Modular Monolith

Modular monolith cocok ketika:

- tim masih kecil/menengah,
- domain belum stabil,
- deployment independen belum wajib,
- transaksi kuat masih banyak dibutuhkan,
- observability maturity belum tinggi,
- operational overhead harus rendah,
- perubahan masih sering melintasi banyak module,
- organisasi belum siap ownership per service.

Keunggulan:

- debugging lebih mudah,
- transaksi lokal lebih mudah,
- deployment lebih sederhana,
- latency internal rendah,
- observability lebih sederhana,
- testing lebih murah,
- refactoring boundary lebih mudah.

### 4.3 Kelemahan Modular Monolith

Modular monolith bisa bermasalah ketika:

- codebase terlalu besar,
- build lambat,
- deployment semua fitur harus bersama,
- satu bug bisa menunda seluruh release,
- scaling harus seluruh aplikasi,
- ownership tidak jelas,
- module boundary tidak dijaga,
- database menjadi terlalu besar,
- satu tim menghambat tim lain.

### 4.4 Microservices

Microservices cocok ketika:

- domain boundary sudah cukup jelas,
- ada banyak tim yang butuh autonomy,
- release cadence berbeda,
- scaling profile berbeda,
- reliability boundary berbeda,
- security/regulatory boundary berbeda,
- sistem butuh evolusi jangka panjang,
- organisasi punya maturity DevOps/SRE/Platform yang cukup.

### 4.5 Perbandingan Ringkas

| Aspek | Modular Monolith | Microservices |
|---|---|---|
| Deployment | Satu unit | Banyak unit |
| Runtime | Satu proses utama | Banyak proses/service |
| Communication | In-process call | Network call/message |
| Transaction | Lebih mudah | Harus local/saga/eventual |
| Debugging | Lebih mudah | Lebih kompleks |
| Observability | Lebih sederhana | Wajib matang |
| Scaling | Aplikasi keseluruhan | Per service |
| Team autonomy | Terbatas | Lebih tinggi |
| Boundary refactor | Lebih mudah | Mahal |
| Operational overhead | Rendah/sedang | Tinggi |

### 4.6 Prinsip Penting

> Modular monolith yang baik sering lebih kuat daripada microservices yang buruk.

Banyak organisasi seharusnya memulai dari modular monolith, membangun boundary yang sehat, lalu mengekstrak microservice hanya ketika tekanan nyata muncul.

---

## 5. SOA vs Microservices

Service-Oriented Architecture atau SOA sudah ada jauh sebelum microservices populer.

Keduanya sama-sama bicara tentang service, tetapi berbeda dalam emphasis.

### 5.1 SOA Tradisional

SOA tradisional sering memiliki ciri:

- enterprise service bus,
- centralized governance,
- canonical data model,
- shared integration layer,
- service reuse lintas organisasi,
- XML/SOAP-heavy integration,
- strong enterprise integration discipline.

SOA cocok pada enterprise integration besar, tetapi sering berakhir terlalu sentralistik.

### 5.2 Microservices

Microservices lebih menekankan:

- decentralized ownership,
- independently deployable services,
- bounded context,
- lightweight communication,
- product/team ownership,
- automation,
- DevOps alignment,
- local data ownership,
- evolutionary architecture.

### 5.3 Perbedaan Mental Model

SOA sering bertanya:

> “Bagaimana enterprise capability bisa diekspos sebagai reusable service?”

Microservices lebih sering bertanya:

> “Bagaimana team bisa memiliki business capability end-to-end dan mengubahnya secara independen?”

Keduanya bisa saling belajar. Microservices yang matang tetap butuh governance. SOA yang modern bisa mengadopsi deployment autonomy dan domain ownership.

---

## 6. Event-Driven Platform vs Microservices

Event-driven architecture sering muncul bersama microservices, tetapi keduanya bukan hal yang sama.

Microservices bicara tentang **service boundary dan ownership**.

Event-driven architecture bicara tentang **cara state/fact disebarkan antar komponen**.

Sistem bisa:

1. microservices tanpa event-driven,
2. event-driven monolith,
3. event-driven microservices,
4. event-driven data platform.

### 6.1 Event-Driven Microservices

Dalam event-driven microservices, service tidak selalu memanggil service lain secara langsung. Ia menerbitkan event seperti:

```text
CaseSubmitted
CaseAssigned
InspectionScheduled
AppealFiled
PaymentConfirmed
LicenseIssued
```

Service lain bereaksi terhadap event tersebut.

### 6.2 Kelebihan

- temporal decoupling,
- fan-out lebih mudah,
- audit trail lebih natural,
- integrasi dengan analytics lebih mudah,
- workflow bisa lebih resilient,
- service tidak harus saling tahu secara langsung.

### 6.3 Risiko

- event semantics tidak jelas,
- sulit tahu siapa consumer,
- debugging lebih sulit,
- eventual consistency harus diterima,
- event versioning menjadi penting,
- replay bisa berbahaya jika handler tidak idempotent,
- hidden coupling berpindah dari API ke event schema.

Prinsip penting:

> Event-driven architecture tidak menghilangkan coupling. Ia memindahkan coupling dari temporal call ke semantic contract.

---

## 7. Microservices sebagai Sistem Sosio-Teknis

Microservices bukan hanya arsitektur teknis.

Ia adalah sistem sosio-teknis.

Artinya, bentuk software sangat dipengaruhi oleh:

- struktur tim,
- ownership,
- komunikasi antar tim,
- proses release,
- platform engineering,
- incident response,
- governance,
- knowledge distribution,
- decision rights.

### 7.1 Conway’s Law

Conway’s Law menyatakan bahwa organisasi cenderung menghasilkan desain sistem yang mencerminkan struktur komunikasinya.

Jika organisasi memiliki 6 tim yang harus selalu approval satu sama lain, microservices tidak otomatis membuat delivery cepat.

Jika database dimiliki satu tim pusat dan semua perubahan schema harus antre, service autonomy juga palsu.

Jika security review selalu manual dan lambat, deployment independence akan tertahan.

### 7.2 Ownership Lebih Penting dari Repository

Sebuah service bukan benar-benar microservice hanya karena punya repository sendiri.

Ia harus punya ownership jelas:

- siapa yang maintain,
- siapa yang menerima alert,
- siapa yang approve contract change,
- siapa yang memahami domain-nya,
- siapa yang bertanggung jawab jika incident,
- siapa yang memutuskan roadmap-nya.

Tanpa ownership, microservices menjadi orphan services.

### 7.3 Team Topology

Microservices sehat ketika struktur tim mendukungnya.

Contoh model:

```text
Stream-aligned team
  owns business capability end-to-end

Platform team
  provides paved road: CI/CD, observability, runtime, templates

Enabling team
  helps teams adopt practices: testing, resilience, security

Complicated subsystem team
  owns specialized high-complexity subsystem
```

Service ownership harus mengikuti cognitive load manusia. Jangan membuat lebih banyak service daripada yang bisa dipahami, dirawat, dan dioperasikan oleh tim.

---

## 8. Enam Dimensi Inti Microservices

Untuk memahami microservices secara mendalam, gunakan enam dimensi ini:

```text
1. Boundary
2. Ownership
3. Data
4. Communication
5. Failure
6. Evolution
```

Semua pattern dalam seri ini akan kembali ke enam dimensi tersebut.

---

## 9. Dimensi 1 — Boundary

Boundary adalah keputusan paling penting.

Boundary menentukan:

- apa yang berada di dalam service,
- apa yang berada di luar service,
- data apa yang dimiliki,
- command apa yang diterima,
- event apa yang dipublish,
- invariant apa yang dijaga,
- dependency apa yang diperbolehkan,
- siapa owner-nya,
- bagaimana service berevolusi.

### 9.1 Boundary Buruk

Boundary buruk biasanya muncul dari pembagian teknis:

```text
UserControllerService
UserRepositoryService
ValidationService
EmailService
DatabaseService
```

Ini bukan domain boundary. Ini hanya memindahkan layer internal menjadi network boundary.

### 9.2 Boundary Lebih Baik

Boundary lebih baik mengikuti business capability:

```text
ApplicationManagementService
LicenseIssuanceService
ComplianceInspectionService
AppealManagementService
CorrespondenceService
PaymentCollectionService
CaseAuditService
```

Tetapi nama domain saja belum cukup. Kita perlu memeriksa:

- apakah datanya jelas,
- apakah lifecycle-nya jelas,
- apakah transaksinya mostly lokal,
- apakah owner-nya jelas,
- apakah contract-nya stabil,
- apakah perubahan di dalamnya tidak sering memaksa service lain berubah.

### 9.3 Boundary Heuristics

Gunakan pertanyaan berikut:

1. Apakah capability ini punya alasan berubah sendiri?
2. Apakah keputusan bisnisnya berbeda?
3. Apakah datanya punya lifecycle berbeda?
4. Apakah role/authorization-nya berbeda?
5. Apakah SLA-nya berbeda?
6. Apakah throughput-nya berbeda?
7. Apakah failure-nya harus diisolasi?
8. Apakah audit trail-nya berbeda?
9. Apakah tim berbeda lebih cocok memilikinya?
10. Apakah transaksi internalnya cukup cohesive?

Boundary kuat biasanya menghasilkan jawaban “ya” pada beberapa pertanyaan di atas.

---

## 10. Dimensi 2 — Ownership

Ownership adalah inti autonomy.

Tanpa ownership, microservices hanya menambah repo.

### 10.1 Jenis Ownership

Service ownership mencakup:

1. **Code ownership**  
   Siapa yang mengubah code?

2. **Runtime ownership**  
   Siapa yang bertanggung jawab saat service down?

3. **Data ownership**  
   Siapa yang boleh mengubah schema/data semantics?

4. **Contract ownership**  
   Siapa yang menentukan API/event contract?

5. **Domain ownership**  
   Siapa yang memahami business rules?

6. **Incident ownership**  
   Siapa yang melakukan triage dan recovery?

7. **Lifecycle ownership**  
   Siapa yang memutuskan kapan service dibuat, digabung, atau dimatikan?

### 10.2 Ownership Smell

Tanda ownership bermasalah:

- tidak ada tim yang merasa memiliki service,
- semua perubahan harus disetujui banyak tim,
- service sering rusak tetapi tidak ada yang memperbaiki akar masalah,
- contract berubah tanpa komunikasi,
- dashboard tidak ada owner,
- alert dikirim ke channel umum tanpa responder,
- dokumentasi tidak pernah diperbarui,
- service hanya dipahami oleh satu orang.

### 10.3 Ownership Decision Record

Setiap service penting harus punya informasi:

```text
Service name:
Business capability:
Owning team:
Primary maintainer:
Runtime owner:
Data owner:
API owner:
Event owner:
On-call path:
SLO:
Critical dependencies:
Downstream consumers:
Decommission criteria:
```

Ini terdengar administratif, tetapi pada sistem besar ini adalah survival tool.

---

## 11. Dimensi 3 — Data

Data adalah bagian paling sulit dalam microservices.

Banyak microservices gagal bukan karena HTTP, Kafka, Kubernetes, atau framework, tetapi karena data ownership tidak jelas.

### 11.1 Shared Database Problem

Jika semua service membaca dan menulis database yang sama, maka service tidak benar-benar independen.

Masalahnya:

- schema change memengaruhi banyak service,
- foreign key lintas domain mengikat lifecycle,
- service bisa bypass invariant service lain,
- data semantics tidak jelas,
- deployment independence melemah,
- debugging perubahan data sulit,
- audit ownership kabur.

### 11.2 Database-per-Service

Prinsip database-per-service bukan berarti setiap service wajib punya instance database fisik sendiri.

Intinya:

> Service harus memiliki data secara eksklusif secara logis.

Bentuknya bisa:

- schema terpisah,
- database terpisah,
- table ownership jelas,
- dedicated storage engine,
- dedicated topic log,
- dedicated read/write model.

Yang penting: service lain tidak boleh sembarangan menulis data yang bukan miliknya.

### 11.3 Data Duplication

Dalam monolith, duplikasi data sering dianggap buruk.

Dalam microservices, duplikasi data kadang merupakan desain yang benar.

Contoh:

```text
Application Service owns application core data.
Compliance Service stores subset needed for compliance review.
Reporting Service stores denormalized projection.
Search Service stores indexed document.
Notification Service stores delivery snapshot.
```

Duplikasi ini bukan bug jika:

- owner jelas,
- freshness expectation jelas,
- source of truth jelas,
- update mechanism jelas,
- reconciliation mechanism jelas.

### 11.4 Source of Truth vs Source of Use

Penting membedakan:

```text
Source of truth = pemilik otoritatif data
Source of use   = salinan/proyeksi yang dipakai untuk kebutuhan tertentu
```

Contoh:

```text
Case Service
  source of truth for case lifecycle

Reporting Service
  source of use for dashboard/report

Search Service
  source of use for full-text search
```

Jangan membuat semua service menjadi source of truth untuk data yang sama.

---

## 12. Dimensi 4 — Communication

Service berkomunikasi karena tidak ada service yang hidup sendiri.

Pertanyaan utama bukan “pakai REST atau Kafka?”, tetapi:

> Coupling seperti apa yang ingin kita terima?

### 12.1 Synchronous Communication

Synchronous call cocok ketika caller membutuhkan jawaban langsung.

Contoh:

```text
GET /applications/{id}
POST /cases/{id}/assignments
GET /users/{id}/permissions
```

Kelebihan:

- mudah dipahami,
- request-response jelas,
- cocok untuk query langsung,
- error lebih eksplisit,
- UX lebih mudah.

Kekurangan:

- temporal coupling,
- caller menunggu callee,
- latency bertambah,
- failure mudah cascade,
- retry bisa memperburuk overload,
- chain panjang sulit di-debug.

### 12.2 Asynchronous Communication

Async messaging cocok ketika caller tidak perlu jawaban langsung atau workflow bisa diproses kemudian.

Contoh:

```text
ApplicationSubmitted
CaseAssigned
InspectionCompleted
LetterGenerated
PaymentReceived
```

Kelebihan:

- temporal decoupling,
- buffering,
- fan-out,
- replay,
- resilience terhadap spike,
- audit/event history.

Kekurangan:

- eventual consistency,
- duplicate message,
- out-of-order event,
- poison message,
- debugging sulit,
- schema evolution lebih sensitif,
- consumer ownership harus jelas.

### 12.3 Communication Decision Matrix

| Kondisi | Lebih Cocok |
|---|---|
| Caller butuh jawaban langsung | Sync API |
| Proses lama | Async |
| Banyak consumer bereaksi | Event |
| Butuh command eksplisit ke satu handler | Queue/command message |
| Butuh query cepat | Sync/materialized view |
| Butuh audit state change | Event |
| Butuh strong consistency lokal | Local transaction |
| Butuh cross-service workflow | Saga/process manager |

---

## 13. Dimensi 5 — Failure

Distributed system gagal dengan cara yang tidak dialami local monolith.

Dalam monolith, method call biasanya:

```java
result = service.doSomething(input);
```

Kemungkinan failure relatif sederhana:

- exception,
- timeout internal,
- DB error,
- JVM crash.

Dalam microservices, call yang sama bisa mengalami:

- DNS failure,
- connection refused,
- TLS handshake failure,
- timeout,
- partial response,
- stale endpoint,
- overloaded callee,
- network partition,
- retry storm,
- duplicate processing,
- out-of-order message,
- downstream degraded,
- inconsistent read model,
- circuit breaker open,
- service mesh retry conflict,
- authentication token expired,
- authorization mismatch,
- schema incompatibility.

### 13.1 Partial Failure

Partial failure berarti sebagian sistem gagal sementara bagian lain tetap berjalan.

Contoh:

```text
Application Service up
Case Service up
Notification Service down
Audit Service slow
Payment Service degraded
Search Projection lagging 20 minutes
```

Pertanyaan engineering:

- Apakah user tetap bisa submit application?
- Apakah audit wajib synchronous?
- Apakah notification bisa retry nanti?
- Apakah search result boleh stale?
- Apakah payment harus block workflow?
- Bagaimana status ditampilkan?

Top engineer tidak hanya bertanya “service down atau up”, tetapi:

> Apa dampak degradasi dependency terhadap invariant bisnis?

### 13.2 Failure Mode Thinking

Untuk setiap service, buat failure matrix:

```text
Dependency down:
Dependency slow:
Dependency returns invalid data:
Dependency returns stale data:
Dependency times out after side effect:
Message duplicated:
Message lost:
Message delayed:
Event out of order:
Database commit succeeds but publish fails:
Publish succeeds but consumer fails:
Consumer succeeds but acknowledgment fails:
```

Microservices engineering adalah seni membatasi dampak dari matrix seperti ini.

---

## 14. Dimensi 6 — Evolution

Sistem enterprise hidup bertahun-tahun.

Microservices harus dirancang untuk berubah.

Evolution pressure muncul dari:

- perubahan bisnis,
- perubahan regulasi,
- perubahan security standard,
- perubahan volume traffic,
- perubahan organisasi,
- perubahan cloud/runtime,
- perubahan dependency,
- perubahan data retention,
- perubahan integration partner,
- perubahan SLA.

### 14.1 Backward Compatibility

Karena service bisa deploy independen, contract harus compatible.

Contoh breaking change:

```json
// old
{
  "caseId": "C-001",
  "status": "PENDING_REVIEW"
}

// new breaking change
{
  "id": "C-001",
  "state": "PENDING_REVIEW"
}
```

Jika consumer masih membaca `caseId`, sistem rusak.

### 14.2 Additive Change

Perubahan lebih aman:

```json
{
  "caseId": "C-001",
  "status": "PENDING_REVIEW",
  "statusReason": "WAITING_FOR_OFFICER_ASSIGNMENT"
}
```

Consumer lama masih bisa jalan.

### 14.3 Evolution Rule

Rule penting:

```text
Be conservative in what you emit.
Be tolerant in what you consume.
Do not remove fields before consumers migrate.
Do not change semantics silently.
Version contracts intentionally.
```

### 14.4 Deployment Independence Is Earned

Deployment independence bukan otomatis muncul karena punya banyak service.

Deployment independence butuh:

- contract compatibility,
- automated testing,
- database migration discipline,
- feature flags,
- backward-compatible events,
- observability,
- rollback/roll-forward strategy,
- consumer readiness.

Tanpa ini, microservices tetap harus deploy bersama.

---

## 15. Java 8 hingga Java 25 dalam Microservices

Seri ini membahas Java dari 8 hingga 25, bukan hanya Java modern.

Alasannya: sistem enterprise sering hidup lama. Banyak organisasi masih punya Java 8/11, sementara service baru bisa memakai Java 17/21/25.

### 15.1 Java 8

Java 8 masih penting dalam legacy enterprise.

Karakteristik:

- lambdas dan streams,
- CompletableFuture,
- java.time,
- mature ecosystem,
- banyak aplikasi enterprise lama,
- keterbatasan container ergonomics dibanding versi modern,
- tidak ada module system,
- tidak ada native HTTP client modern,
- tidak ada virtual threads.

Dalam microservices, Java 8 masih bisa digunakan, tetapi perlu hati-hati pada:

- thread pool sizing,
- blocking I/O,
- GC tuning,
- TLS/cipher support,
- dependency compatibility,
- container memory detection,
- observability library version.

### 15.2 Java 11

Java 11 membawa baseline modern awal:

- LTS populer,
- built-in HttpClient,
- improved container support,
- modern TLS baseline,
- banyak framework enterprise mendukung.

Java 11 cocok untuk banyak service yang butuh stabilitas tetapi belum siap Java 17/21.

### 15.3 Java 17

Java 17 menjadi baseline modern banyak organisasi:

- LTS,
- sealed classes,
- records,
- pattern matching awal,
- improved GC,
- strong ecosystem support,
- kompatibel dengan Spring Boot 3 baseline.

Dalam microservices, Java 17 nyaman untuk:

- DTO immutable dengan records,
- domain modeling lebih ekspresif,
- containerized workload,
- modern framework stack.

### 15.4 Java 21

Java 21 sangat penting karena membawa virtual threads sebagai fitur final.

Dampaknya besar untuk service I/O-bound:

- blocking style menjadi lebih scalable,
- thread-per-request dapat dipertimbangkan ulang,
- asynchronous complexity bisa dikurangi untuk banyak kasus,
- tetapi database pool, connection pool, downstream capacity tetap menjadi bottleneck.

Virtual threads bukan peluru ajaib.

Jika service melakukan 10.000 concurrent request ke downstream yang hanya mampu 200 connection, virtual threads hanya membuat lebih banyak request menunggu.

Prinsip:

> Virtual threads meningkatkan concurrency handling di JVM, bukan kapasitas dependency eksternal.

### 15.5 Java 25

Java 25 telah mencapai General Availability pada 16 September 2025 dan diposisikan sebagai LTS oleh banyak vendor.

Dalam konteks microservices, Java 25 relevan sebagai horizon modern untuk:

- runtime terbaru,
- performance improvement,
- language evolution,
- security and maintenance lifecycle,
- baseline baru setelah Java 21.

Namun untuk enterprise, adoption Java 25 harus mempertimbangkan:

- framework support,
- container image availability,
- observability agent compatibility,
- security scan tooling,
- CI/CD compatibility,
- production support policy vendor,
- migration dari Java 17/21.

### 15.6 Java Version Decision Matrix

| Java Version | Cocok Untuk | Catatan |
|---|---|---|
| Java 8 | Legacy services | Hindari untuk service baru jika tidak wajib |
| Java 11 | Transitional enterprise baseline | Stabil, tetapi mulai tertinggal dari modern stack |
| Java 17 | Modern stable baseline | Sangat cocok untuk banyak enterprise service |
| Java 21 | Modern concurrency baseline | Virtual threads penting untuk I/O-bound services |
| Java 25 | Latest LTS horizon | Cocok untuk platform baru jika ecosystem siap |

---

## 16. Framework Positioning: Jangan Mulai dari Tool

Dalam Java microservices, framework penting, tetapi bukan titik awal.

Framework membantu implementasi pattern, tetapi tidak memilih pattern untuk kita.

### 16.1 Spring Boot / Spring Cloud

Spring Boot sering menjadi default untuk Java microservices.

Spring Cloud menyediakan tooling untuk common distributed systems patterns seperti:

- configuration management,
- service discovery,
- circuit breaker,
- routing,
- control bus,
- contract testing,
- micro-proxy.

Namun Spring Cloud bukan pengganti architecture thinking.

Kita tetap harus menentukan:

- service boundary,
- contract versioning,
- failure mode,
- retry policy,
- consistency model,
- data ownership,
- deployment strategy.

### 16.2 Jakarta EE / MicroProfile

MicroProfile memberikan spesifikasi untuk cloud-native enterprise Java seperti:

- Config,
- Fault Tolerance,
- Health,
- OpenAPI,
- REST Client,
- JWT Authentication,
- Telemetry.

MicroProfile cocok untuk organisasi yang menginginkan standar vendor-neutral di sekitar Jakarta EE style.

### 16.3 Quarkus / Micronaut / Helidon

Framework seperti Quarkus, Micronaut, dan Helidon sering dipakai untuk:

- startup cepat,
- memory footprint lebih rendah,
- cloud-native runtime,
- native image path,
- developer productivity.

Tetapi lagi-lagi, native image dan startup cepat tidak menyelesaikan boundary yang salah.

### 16.4 Rule

```text
Architecture first.
Pattern second.
Framework third.
Library fourth.
```

Jika urutan dibalik, sistem sering menjadi framework-driven architecture.

---

## 17. Microservices dan Regulatory / Enterprise Systems

Dalam sistem enterprise atau regulatory, microservices harus mempertimbangkan hal-hal yang sering diabaikan tutorial biasa.

### 17.1 Regulatory Concerns

Sistem regulatory biasanya memiliki:

- lifecycle panjang,
- audit trail wajib,
- decision traceability,
- role-based access kompleks,
- escalation logic,
- legal deadline,
- case ownership,
- data retention,
- document evidence,
- correspondence history,
- appeal process,
- human approval,
- cross-agency integration,
- compliance reporting.

Ini membuat microservices tidak cukup hanya bicara CRUD.

### 17.2 Case Management Example

Misalnya sistem case management punya state:

```text
Draft
Submitted
Pending Review
Information Requested
Under Investigation
Pending Approval
Approved
Rejected
Appealed
Closed
Archived
```

Pertanyaannya:

- service mana yang memiliki state machine?
- apakah appeal bagian dari case service atau service sendiri?
- apakah audit synchronous atau async?
- apakah correspondence hanya notification atau legal evidence?
- apakah document metadata dimiliki case service atau document service?
- apakah reporting membaca langsung database case?
- apakah SLA escalation event-driven atau scheduled?
- apakah role authorization diputuskan edge atau domain service?

Top engineer memodelkan ini sebagai boundary, invariant, workflow, event, dan responsibility.

### 17.3 Auditability

Dalam regulatory systems, audit bukan tambahan.

Audit adalah bagian domain.

Pertanyaan:

- siapa actor?
- apa action?
- kapan terjadi?
- sebelum dan sesudah state apa?
- berdasarkan authority apa?
- data apa yang berubah?
- apakah perubahan dapat dibuktikan?
- apakah event dapat direkonstruksi?
- apakah correction tercatat?
- apakah system action berbeda dari user action?

Microservices harus membuat audit tetap koheren meski data tersebar.

---

## 18. Pattern sebagai Bahasa Desain

Pattern bukan resep.

Pattern adalah bahasa untuk mendiskusikan trade-off.

Contoh:

```text
Problem:
  Service perlu update database dan publish event secara reliable.

Naive solution:
  Save DB, then publish Kafka event.

Failure:
  DB commit sukses, publish gagal.

Pattern:
  Transactional Outbox.

Trade-off:
  Tambah table, publisher, lag, cleanup, deduplication.

Correctness:
  Eventual publish, not instant publish.
```

Jika kita hanya hafal “pakai outbox”, kita belum advanced.

Jika kita bisa menjelaskan:

- problem yang diselesaikan,
- failure yang dicegah,
- failure yang masih tersisa,
- operational cost,
- monitoring yang dibutuhkan,
- kapan tidak perlu digunakan,

barulah kita memahami pattern.

### 18.1 Anatomy of a Pattern

Setiap pattern akan dianalisis dengan format:

```text
Name:
Problem:
Context:
Forces:
Solution:
How it works:
Java implementation considerations:
Operational considerations:
Failure modes:
Trade-offs:
When to use:
When not to use:
Common mistakes:
Testing strategy:
Production checklist:
```

---

## 19. Microservices Decision Forces

Dalam arsitektur, keputusan selalu dipengaruhi forces.

Force adalah tekanan atau constraint yang saling tarik-menarik.

### 19.1 Contoh Forces

```text
Need strong consistency
vs
Need independent service ownership
```

```text
Need low latency
vs
Need service isolation
```

```text
Need audit completeness
vs
Need async scalability
```

```text
Need independent deployment
vs
Need cross-service contract stability
```

```text
Need high throughput
vs
Need strict ordering
```

```text
Need autonomy
vs
Need governance
```

Top engineer tidak mencari satu jawaban absolut. Ia menyeimbangkan forces.

### 19.2 Example: Synchronous vs Asynchronous

Pertanyaan buruk:

> “Lebih baik REST atau Kafka?”

Pertanyaan baik:

> “Apakah caller perlu immediate result, apakah operation idempotent, apakah workflow bisa eventual, apakah ordering penting, apakah consumer banyak, apakah failure perlu di-buffer, apakah user experience bisa menerima pending state?”

Jawaban tergantung forces.

---

## 20. Core Mental Models

Part 0 memperkenalkan beberapa mental model yang akan dipakai sepanjang seri.

---

### 20.1 Mental Model 1 — Boundary Before Technology

Jangan mulai dari:

```text
Kita butuh Kafka.
Kita butuh Kubernetes.
Kita butuh service mesh.
Kita butuh GraphQL.
Kita butuh gRPC.
```

Mulai dari:

```text
Capability apa?
Owner siapa?
Data apa?
Invariant apa?
Failure apa?
SLA apa?
Change frequency apa?
```

Technology dipilih setelah boundary dan forces jelas.

---

### 20.2 Mental Model 2 — Network Call Is Not a Method Call

Local method call:

```java
customer.validateEligibility(application);
```

Network call:

```text
POST /eligibility/validate
```

Network call bisa:

- lambat,
- timeout,
- gagal sebagian,
- sukses tetapi response hilang,
- dieksekusi dua kali,
- diproses versi lama,
- diproses service yang sedang degraded.

Jangan mendesain microservices seperti OOP over HTTP.

---

### 20.3 Mental Model 3 — Data Ownership Is Architecture

Service boundary tanpa data ownership tidak stabil.

Jika service A memiliki logic tetapi service B bisa update database A, maka invariant A bisa dilanggar.

Prinsip:

```text
Only the owning service writes its authoritative data.
Other services request change or consume published state.
```

---

### 20.4 Mental Model 4 — Autonomy Requires Compatibility

Service bisa deploy independen hanya jika contract compatible.

Jika setiap perubahan API memaksa semua consumer berubah bersamaan, autonomy palsu.

Autonomy butuh:

- backward compatibility,
- forward compatibility,
- versioning,
- consumer-driven contract tests,
- deprecation policy,
- schema evolution discipline.

---

### 20.5 Mental Model 5 — Failure Is a Product Feature

Dalam microservices, failure bukan pengecualian.

Failure adalah kondisi normal.

Sistem harus punya behavior untuk:

- dependency down,
- dependency slow,
- duplicate message,
- stale read,
- partial success,
- timeout after side effect,
- retry exhaustion,
- inconsistent projection,
- delayed event.

Jika behavior tidak didefinisikan, production akan mendefinisikannya secara kacau.

---

### 20.6 Mental Model 6 — Consistency Has Business Meaning

Jangan hanya bertanya:

> “Strong consistency atau eventual consistency?”

Tanyakan:

> “Invariant bisnis mana yang wajib langsung benar, mana yang boleh converge, mana yang bisa dikoreksi, dan mana yang punya konsekuensi legal?”

Contoh:

```text
License cannot be issued without approval.
```

Ini mungkin strict invariant.

```text
Dashboard count may lag by 5 minutes.
```

Ini mungkin eventual invariant.

```text
Notification email can be retried later.
```

Ini compensatable/delay-tolerant.

---

### 20.7 Mental Model 7 — Observability Is Part of Design

Observability bukan ditambahkan di akhir.

Untuk setiap workflow, kita harus tahu:

- trace id,
- correlation id,
- causation id,
- request id,
- business id,
- actor id,
- tenant id,
- event id,
- state transition id.

Tanpa ini, distributed debugging menjadi tebak-tebakan.

---

### 20.8 Mental Model 8 — Every Queue Is a Liability

Queue membantu buffering, tetapi juga menyembunyikan backlog.

Queue bisa membuat sistem terlihat sehat padahal sebenarnya sedang gagal perlahan.

Pertanyaan:

- Berapa lag?
- Berapa retry?
- Berapa DLQ?
- Apakah message idempotent?
- Apakah ordering penting?
- Apakah consumer cukup cepat?
- Apa yang terjadi jika backlog 1 juta message?
- Apakah replay aman?

---

### 20.9 Mental Model 9 — Platform Maturity Determines Architecture Ambition

Jangan mengadopsi arsitektur yang lebih kompleks daripada maturity organisasi.

Microservices butuh:

- CI/CD kuat,
- automated testing,
- observability,
- centralized logging,
- tracing,
- metrics,
- alerting,
- incident response,
- secrets management,
- service ownership,
- contract governance,
- runtime platform.

Jika maturity rendah, mulai dari modular monolith atau coarse-grained services.

---

### 20.10 Mental Model 10 — Split Late, Merge When Needed

Service boundary sulit diperbaiki setelah production.

Prinsip sehat:

```text
Start modular.
Observe change pressure.
Extract when boundary proves itself.
Merge when split creates more cost than value.
```

Microservices bukan jalan satu arah. Kadang service harus digabung kembali.

---

## 21. Kapan Microservices Masuk Akal

Microservices masuk akal jika beberapa kondisi berikut benar.

### 21.1 Banyak Tim Butuh Autonomy

Jika satu tim kecil mengerjakan semua hal, microservices sering belum perlu.

Jika banyak tim bekerja pada capability berbeda dan saling blocking, microservices mulai masuk akal.

### 21.2 Domain Boundary Cukup Stabil

Jika domain masih sangat berubah dan belum dipahami, terlalu cepat memecah bisa salah boundary.

Jika boundary capability sudah berulang dan jelas, extraction lebih aman.

### 21.3 Scaling Profile Berbeda

Contoh:

```text
Search service: high read traffic
Document service: heavy storage I/O
Notification service: bursty async workload
Case service: transactional workflow
Reporting service: batch/analytical workload
```

Jika semua bagian punya scaling profile berbeda, microservices bisa membantu.

### 21.4 Deployment Cadence Berbeda

Jika Payment integration berubah jarang, Notification sering berubah, dan Reporting punya release cycle sendiri, independent deployment berguna.

### 21.5 Failure Isolation Penting

Jika Notification gagal, apakah Case Submission harus gagal?

Jika jawabannya tidak, service isolation + async pattern bisa bermanfaat.

### 21.6 Security Boundary Berbeda

Beberapa capability mungkin menangani data sensitif, secret, external credential, atau privileged action.

Microservices bisa membantu isolasi.

### 21.7 Regulatory Boundary Berbeda

Dalam sistem regulatory, beberapa domain punya audit/retention/approval requirement berbeda.

Boundary bisa mengikuti responsibility legal.

---

## 22. Kapan Microservices Tidak Masuk Akal

Microservices bisa menjadi kesalahan jika:

1. Tim kecil dan komunikasi masih mudah.
2. Domain belum jelas.
3. Deployment automation belum matang.
4. Observability belum siap.
5. Testing masih manual.
6. Semua service tetap harus release bersama.
7. Database tetap shared tanpa ownership.
8. Semua request butuh strong consistency lintas service.
9. Organisasi tidak punya on-call/runtime ownership.
10. Microservices dipilih karena hype/framework.
11. Latency sangat sensitif dan call chain panjang.
12. Sistem lebih banyak CRUD sederhana daripada business capability kompleks.
13. Tidak ada masalah scaling/ownership/release yang nyata.

### 22.1 Anti-Framing

Hindari alasan seperti:

```text
Karena Netflix pakai microservices.
Karena monolith tidak modern.
Karena Kubernetes sudah tersedia.
Karena Spring Cloud mudah.
Karena semua orang pakai Kafka.
Karena ingin resume terlihat bagus.
```

Alasan yang valid harus spesifik terhadap sistem dan organisasi.

---

## 23. Top 1% Engineer View

Engineer top-tier tidak hanya bisa membuat microservice.

Ia bisa menjawab:

1. Mengapa service ini harus ada?
2. Mengapa boundary ini benar?
3. Apa invariant yang dijaga service ini?
4. Apa data yang dimiliki?
5. Apa contract publiknya?
6. Apa dependency kritisnya?
7. Apa failure mode utamanya?
8. Apa retry policy-nya?
9. Apa timeout budget-nya?
10. Apa yang terjadi jika dependency lambat?
11. Apa yang terjadi jika event duplicate?
12. Apa yang terjadi jika consumer tertinggal versi?
13. Apa observability signal-nya?
14. Apa SLO-nya?
15. Apa rollback/roll-forward plan-nya?
16. Apa migration path-nya?
17. Apa cost model-nya?
18. Apa alasan tidak membuatnya sebagai module biasa?

### 23.1 Top 1% Tidak Berarti Paling Banyak Tool

Top 1% bukan berarti tahu semua framework.

Top 1% berarti mampu:

- melihat struktur masalah,
- mengidentifikasi coupling tersembunyi,
- memperkirakan failure sebelum terjadi,
- memilih consistency model yang sesuai,
- membuat trade-off eksplisit,
- mendesain sistem yang bisa dioperasikan manusia,
- menolak kompleksitas yang tidak perlu.

---

## 24. Microservices Architecture Review Template

Gunakan template ini saat menilai service baru.

### 24.1 Service Identity

```text
Service name:
Business capability:
Owning team:
Primary users:
Criticality:
SLO:
Runtime language/version:
Framework:
Deployment unit:
```

### 24.2 Boundary

```text
What is inside this service?
What is outside this service?
Why is this not just a module?
What business capability does it own?
What lifecycle does it control?
What state machine does it own?
```

### 24.3 Data

```text
Authoritative data owned:
Read-only replicated data:
External reference data:
Database/schema/table ownership:
Retention policy:
Archival policy:
PII/sensitive data:
```

### 24.4 Contracts

```text
Public APIs:
Published events:
Consumed events:
Commands accepted:
Backward compatibility policy:
Deprecation policy:
Schema versioning:
```

### 24.5 Consistency

```text
Local invariants:
Cross-service invariants:
Eventual invariants:
Compensatable actions:
Non-compensatable actions:
Reconciliation mechanism:
```

### 24.6 Failure

```text
Critical dependencies:
Timeout policy:
Retry policy:
Circuit breaker policy:
Fallback behavior:
Bulkhead strategy:
DLQ strategy:
Manual recovery path:
```

### 24.7 Observability

```text
Logs:
Metrics:
Traces:
Business metrics:
Audit events:
Correlation identifiers:
Dashboards:
Alerts:
Runbooks:
```

### 24.8 Security

```text
Authentication mode:
Authorization model:
Service identity:
User identity propagation:
Secret management:
Token audience:
mTLS/certificate policy:
Audit identity:
```

### 24.9 Deployment

```text
CI/CD:
Migration strategy:
Feature flags:
Canary/rolling strategy:
Rollback/roll-forward:
Runtime resource limits:
Java version:
GC strategy:
```

### 24.10 Cost and Complexity

```text
New operational cost:
New cognitive cost:
New testing cost:
New observability cost:
New security cost:
Reason this complexity is justified:
```

---

## 25. Example: Naive Split vs Mature Split

### 25.1 Naive Split

```text
Monolith modules:
- Application
- Case
- User
- Role
- Document
- Notification
- Audit

Naive microservices:
- ApplicationService
- CaseService
- UserService
- RoleService
- DocumentService
- NotificationService
- AuditService
```

Masalah:

- User/Role mungkin terlalu generic,
- Audit mungkin cross-cutting tetapi juga regulatory domain,
- Case dan Application mungkin punya lifecycle coupling,
- Document ownership belum jelas,
- Notification mungkin hanya technical service,
- service boundary mengikuti noun, bukan capability/invariant.

### 25.2 Mature Analysis

Pertanyaan yang lebih baik:

```text
Apa lifecycle utama?
Apa state machine utama?
Apa legal decision point?
Apa evidence artifact?
Apa action yang irreversible?
Apa audit yang wajib?
Apa query/reporting need?
Apa external integration?
Apa SLA/escalation path?
```

Kemungkinan boundary lebih matang:

```text
Application Intake Service
  owns application submission lifecycle

Eligibility Assessment Service
  owns rule evaluation and assessment result

Case Management Service
  owns regulatory case lifecycle

Compliance Action Service
  owns enforcement/compliance action lifecycle

Document Evidence Service
  owns document metadata, evidence linkage, retention

Correspondence Service
  owns official outgoing/incoming communication record

Notification Delivery Service
  owns technical delivery attempts, retries, provider integration

Audit Ledger Service
  owns immutable audit facts/projections

Reporting Projection Service
  owns reporting-optimized read models
```

Ini belum tentu final, tetapi lebih dekat ke responsibility nyata.

---

## 26. Microservices Maturity Ladder

Tidak semua organisasi langsung masuk microservices matang.

### Level 0 — Monolith Tidak Modular

Ciri:

- semua code bercampur,
- database shared tanpa boundary,
- perubahan kecil berisiko besar,
- testing sulit,
- domain tidak eksplisit.

Strategi:

- rapikan module,
- buat boundary internal,
- pisahkan package/domain,
- buat contract internal,
- stabilkan testing.

### Level 1 — Modular Monolith

Ciri:

- module domain jelas,
- boundary internal dijaga,
- database mungkin masih sama tetapi ownership mulai jelas,
- deployment masih satu.

Strategi:

- ukur change coupling,
- identifikasi extraction candidate,
- buat integration contract.

### Level 2 — Coarse-Grained Services

Ciri:

- beberapa service besar berdasarkan capability,
- deployment mulai terpisah,
- data ownership mulai dipisah,
- observability mulai penting.

Strategi:

- perbaiki contract,
- hindari shared DB,
- implement resilience basic.

### Level 3 — Mature Microservices

Ciri:

- service autonomy nyata,
- owner jelas,
- contract compatible,
- observability kuat,
- deployment independen,
- failure mode dipahami,
- data ownership jelas.

Strategi:

- governance,
- platform engineering,
- SLO,
- event/schema governance,
- chaos/resilience testing.

### Level 4 — Socio-Technical Platform

Ciri:

- teams aligned to capabilities,
- platform menyediakan golden path,
- service lifecycle managed,
- architecture decisions traceable,
- cost and reliability measured,
- service creation/decommission governed.

Strategi:

- continuous architecture evolution,
- portfolio simplification,
- automated compliance,
- internal developer platform.

---

## 27. Java Microservices: Architectural Building Blocks

Sepanjang seri, kita akan memakai building blocks berikut.

### 27.1 Runtime

- JVM process
- container
- Kubernetes pod
- serverless function
- native image binary
- virtual-thread-enabled service

### 27.2 Communication

- REST/HTTP
- gRPC
- messaging queue
- event streaming
- WebSocket/SSE for specific use cases
- file/batch integration

### 27.3 Data

- relational database
- document database
- cache
- search index
- event log
- object storage
- analytical store

### 27.4 Control Plane

- configuration
- service discovery
- secret management
- deployment automation
- feature flags
- traffic routing
- policy enforcement

### 27.5 Observability Plane

- logs
- metrics
- traces
- audit events
- profiling
- business telemetry

### 27.6 Resilience Plane

- timeout
- retry
- circuit breaker
- rate limiter
- bulkhead
- backpressure
- load shedding
- fallback
- DLQ

---

## 28. Key Vocabulary

### Service

A deployable unit that owns a business or technical capability and exposes explicit contracts.

### Capability

A meaningful ability the business/system needs, usually stable across implementation changes.

### Boundary

The conceptual and operational line separating what a service owns from what it does not own.

### Contract

A stable agreement between producer and consumer: API, event schema, semantics, error behavior, timing expectation.

### Invariant

A rule that must remain true within some scope.

Example:

```text
A closed case cannot be modified except through reopening workflow.
```

### Consistency Model

The guarantee about when data becomes correct/visible across components.

### Saga

A sequence of local transactions coordinated to achieve a larger business outcome, with compensation for failure cases.

### Outbox

A pattern for reliably publishing messages/events after local database transaction commits.

### Inbox

A pattern for deduplicating and tracking consumed messages.

### Projection

A read model derived from source data/events for query efficiency.

### Choreography

Workflow coordination through event reactions without central orchestrator.

### Orchestration

Workflow coordination by a central process manager/orchestrator.

### Idempotency

Property where repeating the same operation has the same business effect as executing it once.

### Backpressure

Mechanism to prevent overload by controlling intake or processing rate.

### Blast Radius

The scope of impact when a failure occurs.

---

## 29. Red Flags Saat Mendesain Microservices

Perhatikan tanda-tanda berikut.

### 29.1 Boundary Red Flags

- Service dinamai berdasarkan table.
- Service dinamai berdasarkan technical layer.
- Service terlalu kecil dan tidak punya business meaning.
- Service terlalu besar dan semua capability masuk ke sana.
- Banyak cyclic dependency.
- Banyak synchronous chain.

### 29.2 Data Red Flags

- Semua service memakai database yang sama.
- Semua service boleh update table yang sama.
- Foreign key lintas service boundary.
- Reporting query langsung ke database transactional service.
- Data ownership tidak diketahui.

### 29.3 Contract Red Flags

- API berubah tanpa versioning.
- Event schema berubah tanpa consumer awareness.
- Error response tidak konsisten.
- DTO internal diekspos keluar.
- Enum berubah sembarangan.

### 29.4 Runtime Red Flags

- Tidak ada timeout.
- Retry tanpa budget.
- Circuit breaker dipasang tanpa memahami failure.
- Queue tidak dimonitor.
- DLQ tidak pernah dibaca.
- Scaling hanya menambah pod tanpa memahami bottleneck.

### 29.5 Organization Red Flags

- Tidak ada service owner.
- Semua alert masuk channel umum.
- Semua perubahan butuh approval semua tim.
- Tidak ada runbook.
- Tidak ada ADR.
- Tidak ada decommission plan.

---

## 30. Mini Case Study: Case Submission Workflow

Bayangkan workflow:

```text
User submits application.
System validates eligibility.
System creates case.
System stores documents.
System sends acknowledgment.
System creates audit trail.
System updates reporting dashboard.
```

### 30.1 Monolith Implementation

Dalam monolith:

```java
@Transactional
public SubmitResult submit(SubmitCommand command) {
    eligibility.validate(command);
    Application app = applicationRepository.save(...);
    Case c = caseRepository.save(...);
    documentService.linkDocuments(...);
    auditService.record(...);
    notificationService.sendAcknowledgement(...);
    reportingService.update(...);
    return SubmitResult.success(app.id(), c.id());
}
```

Terlihat sederhana.

Tetapi dalam microservices, setiap langkah bisa berada di service berbeda.

### 30.2 Naive Microservices Implementation

```text
POST /applications
  -> Eligibility Service
  -> Case Service
  -> Document Service
  -> Audit Service
  -> Notification Service
  -> Reporting Service
```

Masalah:

- synchronous chain panjang,
- failure satu dependency menggagalkan semua,
- latency tinggi,
- retry sulit,
- partial side effect mungkin terjadi,
- transaction boundary tidak jelas,
- notification/reporting mungkin tidak perlu blocking.

### 30.3 Better Design

Kemungkinan desain lebih baik:

```text
Application Service:
  - validate local command
  - persist application submission
  - publish ApplicationSubmitted event via outbox

Case Service:
  - consumes ApplicationSubmitted
  - creates case if applicable
  - publishes CaseCreated

Document Evidence Service:
  - consumes ApplicationSubmitted / DocumentAttached
  - links evidence metadata

Audit Ledger Service:
  - consumes key domain events
  - records immutable audit facts

Notification Service:
  - consumes ApplicationSubmitted / CaseCreated
  - sends acknowledgment asynchronously

Reporting Projection Service:
  - consumes events
  - updates dashboard projection
```

Butuh keputusan:

- apakah user harus langsung mendapat case id?
- apakah case creation harus synchronous?
- apakah audit harus dalam transaksi yang sama?
- apakah notification boleh terlambat?
- apakah reporting boleh stale?
- bagaimana jika Case Service gagal membuat case?
- apakah ApplicationSubmitted harus menjadi durable event?

Tidak ada jawaban universal. Yang penting adalah reasoning eksplisit.

---

## 31. The “Microservices Readiness” Checklist

Sebelum membuat microservice baru, gunakan checklist ini.

### 31.1 Domain Readiness

- [ ] Capability jelas.
- [ ] Boundary jelas.
- [ ] State ownership jelas.
- [ ] Invariant jelas.
- [ ] Data ownership jelas.
- [ ] Business owner jelas.

### 31.2 Technical Readiness

- [ ] API/event contract jelas.
- [ ] Timeout policy ada.
- [ ] Retry policy ada.
- [ ] Idempotency strategy ada.
- [ ] Observability ada.
- [ ] Deployment pipeline ada.
- [ ] Config/secrets management ada.
- [ ] Database migration strategy ada.

### 31.3 Operational Readiness

- [ ] Service owner ada.
- [ ] Alert owner ada.
- [ ] Dashboard ada.
- [ ] Runbook ada.
- [ ] SLO ada.
- [ ] Incident path ada.
- [ ] Rollback/roll-forward plan ada.

### 31.4 Evolution Readiness

- [ ] Contract compatibility policy ada.
- [ ] Deprecation policy ada.
- [ ] Versioning strategy ada.
- [ ] Consumer list diketahui.
- [ ] Migration path ada.
- [ ] Decommission criteria ada.

Jika banyak checklist belum terpenuhi, jangan buru-buru membuat microservice.

---

## 32. How This Series Will Proceed

Seri ini akan bergerak dari fondasi menuju pattern spesifik.

Urutan besar:

```text
Part 0  : Mental model
Part 1  : Distributed systems reality
Part 2  : Service boundary
Part 3  : Domain modeling
Part 4  : Architecture styles
Part 5  : Synchronous communication
Part 6  : Asynchronous messaging
Part 7  : Event-driven architecture
Part 8  : Saga and compensation
Part 9  : Outbox/inbox/CDC
Part 10 : Consistency and invariants
Part 11 : Data ownership
Part 12 : Query/CQRS/materialized view
Part 13 : API Gateway/BFF
Part 14 : Discovery/config/topology
Part 15 : Resilience patterns
Part 16 : Backpressure/capacity
Part 17 : Idempotency/deduplication
Part 18 : Workflow/process manager
Part 19 : State machine
Part 20 : Service-to-service security
Part 21 : Multi-tenancy/isolation
Part 22 : Observability patterns
Part 23 : Testing strategy
Part 24 : Contract/schema compatibility
Part 25 : Deployment/release safety
Part 26 : Runtime platform
Part 27 : Performance engineering
Part 28 : Caching
Part 29 : Migration/strangler
Part 30 : Governance/ownership
Part 31 : Incident/reliability operations
Part 32 : Cost/architecture economics
Part 33 : Anti-pattern taxonomy
Part 34 : Capstone architecture review
```

Part 0 ini hanya foundation. Part berikutnya akan masuk ke realita distributed systems yang menjadi alasan mengapa microservices tidak boleh didesain seperti aplikasi lokal yang dipisah-pisah.

---

## 33. Exercises

Jawab pertanyaan berikut untuk melatih mental model.

### Exercise 1 — Identify Boundary

Ambil sistem enterprise yang kamu kenal.

Daftar 10 module utama.

Untuk setiap module, jawab:

```text
Apakah ini business capability atau technical layer?
Siapa owner-nya?
Data apa yang dimiliki?
Apa lifecycle/state machine-nya?
Apa invariant-nya?
Apa alasan module ini berubah?
Apakah perlu deploy independen?
Apa failure yang harus diisolasi?
```

### Exercise 2 — Detect Distributed Monolith

Bayangkan sistem punya 20 microservice.

Cari tanda:

```text
Apakah ada shared database?
Apakah ada release bersama?
Apakah ada synchronous chain > 4 service?
Apakah service saling import DTO internal?
Apakah satu perubahan field menyentuh banyak service?
Apakah debugging hanya bisa lewat E2E environment?
Apakah service owner tidak jelas?
```

Jika banyak “ya”, sistem cenderung distributed monolith.

### Exercise 3 — Classify Communication

Untuk workflow:

```text
Submit Application
Validate Eligibility
Create Case
Send Notification
Update Report
Write Audit
```

Tentukan mana yang harus synchronous, mana yang bisa asynchronous, dan jelaskan alasannya.

### Exercise 4 — Consistency Mapping

Untuk setiap rule:

```text
Application cannot be submitted without required fields.
Case cannot be closed if active appeal exists.
Dashboard count should be updated.
Email acknowledgment should be sent.
Audit trail must record decision.
```

Klasifikasikan sebagai:

```text
Local invariant
Cross-service invariant
Eventual invariant
Compensatable action
Non-compensatable/legal invariant
```

### Exercise 5 — Java Version Strategy

Untuk organisasi dengan service Java 8, 11, 17, dan rencana 21/25, buat strategi:

```text
Service mana yang tetap legacy?
Service mana yang perlu migrasi dulu?
Service baru pakai versi apa?
Apa risiko observability agent?
Apa risiko framework compatibility?
Apa benefit virtual threads?
Apa migration guardrail?
```

---

## 34. Production Thinking Checklist

Saat membaca part berikutnya, biasakan bertanya:

```text
What can fail?
How do we know it failed?
Who owns recovery?
Can it be retried safely?
Can it run twice safely?
Can it arrive late safely?
Can it be rolled back?
Can it be compensated?
Can it be observed?
Can it be migrated?
Can it be deprecated?
Can it be explained to audit/regulator/customer?
```

Ini checklist sederhana, tetapi sangat kuat.

---

## 35. Summary

Microservices bukan sekadar aplikasi yang dipecah menjadi service kecil.

Microservices adalah strategi untuk mengelola complexity, ownership, deployment independence, failure isolation, data ownership, dan long-term evolution.

Tetapi microservices selalu membawa biaya:

- distributed systems complexity,
- partial failure,
- consistency challenge,
- operational overhead,
- testing complexity,
- observability cost,
- security surface area,
- cognitive load.

Engineer kuat tidak bertanya:

```text
Bagaimana cara membuat microservice?
```

Engineer kuat bertanya:

```text
Apakah ini seharusnya menjadi microservice?
Boundary-nya apa?
Owner-nya siapa?
Datanya apa?
Invariant-nya apa?
Failure mode-nya apa?
Trade-off-nya apa?
Apakah organisasi sanggup mengoperasikannya?
```

Part berikutnya akan membahas realita distributed systems yang menjadi fondasi semua pattern microservices:

```text
Part 1 — Distributed Systems Reality Before Microservices
```

---

## 36. References

1. Martin Fowler & James Lewis, “Microservices,” martinfowler.com.  
   https://martinfowler.com/articles/microservices.html

2. Martin Fowler, “Microservices Guide,” martinfowler.com.  
   https://martinfowler.com/microservices/

3. OpenJDK, “JDK 25,” General Availability 16 September 2025.  
   https://openjdk.org/projects/jdk/25/

4. Spring, “Spring Cloud,” common patterns in distributed systems including configuration management, service discovery, circuit breakers, intelligent routing, micro-proxy, control bus, short-lived microservices, and contract testing.  
   https://spring.io/projects/spring-cloud

5. Eclipse MicroProfile, “MicroProfile 7.1,” released 17 June 2025; includes Telemetry, OpenAPI, REST Client, Config, Fault Tolerance, JWT Authentication, and Health.  
   https://microprofile.io/

6. Fabrizio Montesi and Janine Weber, “Circuit Breakers, Discovery, and API Gateways in Microservices,” arXiv, 2016.  
   https://arxiv.org/abs/1609.05830

7. Claudio Guidi, Ivan Lanese, Manuel Mazzara, Fabrizio Montesi, “Microservices: a Language-based Approach,” arXiv, 2017.  
   https://arxiv.org/abs/1704.08073

---

## 37. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 0 of 35 — Introduction and Mental Model
```

Part berikutnya:

```text
Part 1 of 35 — Distributed Systems Reality Before Microservices
```
