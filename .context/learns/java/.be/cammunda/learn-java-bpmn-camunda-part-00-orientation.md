# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer

> Seri lanjutan untuk memahami Java BPMN, Camunda, workflow engine, process orchestration, long-running business process, dan production-grade process automation engineering.

---

## 0. Metadata

**Nama file:** `learn-java-bpmn-camunda-process-orchestration-engineering-part-00-orientation.md`  
**Seri:** `learn-java-bpmn-camunda-process-orchestration-engineering`  
**Part:** `00`  
**Tema:** Orientation, mental model, boundaries, dan cara berpikir process orchestration engineer  
**Target pembaca:** Java engineer yang sudah memahami Java core, concurrency, IO, SQL/JDBC/JPA/MyBatis, Jakarta, security, testing, deployment, HTTP client, migration, dan distributed-system fundamentals  
**Java coverage:** Java 8 sampai Java 25, dengan catatan bahwa sebagian runtime modern Camunda/Spring ecosystem lebih realistis berjalan di Java LTS modern seperti 17/21/25  
**Fokus:** bukan tutorial tombol, bukan sekadar menggambar BPMN, tetapi membangun fondasi berpikir untuk mendesain proses bisnis jangka panjang yang reliable, auditable, operable, dan maintainable

---

## 1. Tujuan Part 0

Part 0 adalah fondasi. Sebelum masuk ke syntax BPMN, Camunda 7, Camunda 8, Zeebe, Java Client, worker, Spring Boot integration, testing, observability, dan production operations, kita perlu membangun satu perubahan cara berpikir:

> Dari engineer yang hanya berpikir dalam request-response dan entity lifecycle, menjadi engineer yang mampu memodelkan, menjalankan, mengawasi, memperbaiki, dan mempertanggungjawabkan proses bisnis jangka panjang.

Dalam sistem biasa, developer sering berpikir seperti ini:

```text
User klik tombol
  -> HTTP request masuk
  -> service method dipanggil
  -> validasi
  -> update database
  -> return response
```

Dalam process orchestration, alurnya sering jauh lebih panjang:

```text
Permohonan diajukan
  -> validasi awal
  -> dokumen dicek
  -> officer melakukan review
  -> ada clarification request
  -> applicant submit ulang
  -> SLA berjalan
  -> supervisor approve
  -> external agency perlu memberi input
  -> payment harus diterima sebelum deadline
  -> lisensi diterbitkan
  -> email dikirim
  -> audit harus bisa menjelaskan seluruh perjalanan kasus 2 tahun kemudian
```

Perbedaan utamanya bukan hanya durasi. Perbedaan utamanya adalah **state proses menjadi first-class concern**.

Setelah menyelesaikan part ini, kamu harus bisa menjawab:

1. Apa beda workflow, process, orchestration, choreography, saga, state machine, rules engine, dan BPMN engine?
2. Masalah apa yang sebenarnya diselesaikan BPMN/Camunda?
3. Kapan BPMN/Camunda justru overkill atau salah alat?
4. Kenapa process orchestration tidak boleh diperlakukan seperti CRUD dengan diagram?
5. Apa mental model yang membedakan engineer biasa dengan engineer yang matang dalam workflow/process automation?
6. Bagaimana menilai apakah sebuah proses layak dimodelkan sebagai BPMN?
7. Bagaimana memisahkan tanggung jawab antara process engine, domain service, database, message broker, UI, dan audit trail?

---

## 2. Posisi Seri Ini dalam Roadmap Java Advanced

Kamu sudah mempelajari banyak fondasi Java dan enterprise engineering:

- Java language dan runtime
- collections, streams, concurrency, reactive
- data types, reliability, DSA
- IO/NIO/networking/file/security
- SQL/JDBC/HikariCP/JPA/MyBatis/migration
- Jakarta stack
- testing, benchmarking, JVM performance, memory, GC
- HTTP client, JSON/XML mapper, deployment, build tools

Semua itu tetap dipakai. Tetapi seri BPMN/Camunda ini berdiri di atas layer berbeda.

Kalau seri sebelumnya banyak menjawab:

```text
Bagaimana menulis service yang benar?
Bagaimana query database dengan efisien?
Bagaimana membuat API yang reliable?
Bagaimana mengamankan aplikasi?
Bagaimana deploy aplikasi Java?
```

Seri ini menjawab:

```text
Bagaimana menjalankan proses bisnis yang hidup berhari-hari/bulan-bulan?
Bagaimana state lintas manusia, sistem, waktu, dan organisasi dimodelkan?
Bagaimana kegagalan eksternal tidak menghancurkan alur bisnis?
Bagaimana proses bisa diaudit, dioperasikan, dan diubah tanpa chaos?
Bagaimana keputusan, approval, SLA, escalation, dan compensation menjadi eksplisit?
```

Ini bukan pengganti JPA, messaging, REST, atau state machine. Ini adalah layer koordinasi di atasnya.

---

## 3. Kenapa BPMN dan Process Orchestration Menjadi Skill Mahal

Banyak engineer mahir membuat API. Banyak engineer mahir membuat query. Banyak engineer mahir membuat microservice. Tetapi lebih sedikit engineer yang mampu menjawab pertanyaan seperti ini secara matang:

- Kalau proses sudah berjalan 3 minggu, lalu business rule berubah, apa yang terjadi pada instance lama?
- Kalau external payment berhasil, tetapi worker crash sebelum memberi tahu engine, apakah payment akan dipanggil dua kali?
- Kalau applicant submit clarification tepat saat timer SLA expire, siapa yang menang?
- Kalau officer A membuat rekomendasi dan supervisor B approve, bagaimana audit menjelaskan chain of accountability?
- Kalau user task sudah assigned ke officer yang resign, apa repair path yang aman?
- Kalau proses stuck karena variable payload invalid, apakah boleh update variable manual di production?
- Kalau process definition versi 12 punya bug, tetapi 40.000 process instance sedang berjalan, apa strategi recovery?
- Kalau satu subprocess reusable dipakai oleh 15 proses, bagaimana versioning-nya?
- Kalau satu case perlu split ke beberapa review paralel lalu join sebagian, apakah itu parallel gateway, multi-instance, case model, atau custom domain state?

Pertanyaan seperti ini tidak selesai dengan decorator, annotation, atau tutorial “hello world”. Ini membutuhkan pemahaman gabungan:

```text
business process semantics
+ distributed systems
+ transaction boundaries
+ reliability patterns
+ human workflow
+ auditability
+ security
+ operations
+ migration
+ domain modeling
+ Java implementation discipline
```

Di sinilah skill process orchestration menjadi pembeda.

---

## 4. Apa Itu BPMN?

BPMN adalah singkatan dari **Business Process Model and Notation**. Secara sederhana, BPMN adalah notasi standar untuk menggambarkan proses bisnis.

Namun untuk engineer, definisi yang lebih berguna adalah:

> BPMN adalah bahasa visual untuk menyatakan alur proses, event, aktivitas, keputusan, paralelisme, waktu tunggu, error, escalation, message, dan kompensasi dalam bentuk yang bisa dibaca manusia, dan pada engine tertentu bisa dieksekusi sebagai process definition.

BPMN memiliki dua sisi:

| Sisi | Penjelasan |
|---|---|
| Modeling notation | Diagram yang bisa dibaca business user, analyst, developer, QA, auditor, dan operator |
| Execution semantics | Aturan bagaimana token bergerak dari satu element ke element lain saat process instance berjalan |

Kesalahan umum adalah menganggap BPMN hanya sebagai gambar. Untuk process engineer, BPMN bukan gambar. BPMN adalah **kontrak eksekusi**.

Contoh sederhana:

```text
[Start]
   |
[Validate Application]
   |
<Valid?>
   | yes
[Review Application]
   |
[Approve]
   |
[End]

   | no
[Reject]
   |
[End]
```

Sebagai gambar, ini terlihat mudah. Sebagai runtime contract, ada banyak pertanyaan:

- Siapa menjalankan `Validate Application`?
- Apakah validasi otomatis atau manual?
- Apakah validasi boleh retry?
- Kalau validasi gagal karena database down, apakah itu rejection atau technical failure?
- Apa variable yang menentukan `Valid?`?
- Apakah `Reject` mengirim email?
- Kalau email gagal, apakah rejection batal?
- Apakah proses dianggap selesai sebelum email sukses?
- Bagaimana audit mencatat alasan rejection?
- Apakah reviewer boleh mengubah data?
- Apakah approval bisa dibatalkan?

Top 1% engineer tidak berhenti pada diagram. Ia bertanya: **apa semantics, ownership, failure mode, dan operational behavior dari diagram ini?**

---

## 5. Apa Itu Camunda?

Camunda adalah platform process orchestration dan automation yang mendukung BPMN dan DMN. Secara historis, ada dua generasi besar yang penting:

1. **Camunda 7**
2. **Camunda 8**

Keduanya sama-sama terkait BPMN, tetapi arsitekturnya sangat berbeda.

### 5.1 Camunda 7 secara mental model

Camunda 7 cenderung dipahami sebagai:

```text
Java process engine
+ relational database
+ job executor
+ embedded/shared runtime
+ BPMN execution
+ task management
+ history/audit tables
```

Camunda 7 sangat dekat dengan aplikasi Java tradisional. Engine bisa embedded di aplikasi Spring Boot atau berjalan sebagai shared engine di application server. Banyak interaksi terjadi melalui Java API seperti `RuntimeService`, `TaskService`, `RepositoryService`, dan `HistoryService`.

Mental model sederhananya:

```text
Application JVM
  -> Camunda process engine
  -> relational database state
  -> job executor executes async jobs
```

### 5.2 Camunda 8 secara mental model

Camunda 8 berbeda. Core engine-nya adalah **Zeebe**, yang memakai model broker/gateway/partition dan job worker eksternal.

Mental model sederhananya:

```text
Java/Spring worker applications
  -> Camunda Java Client
  -> Zeebe Gateway
  -> Zeebe Brokers / partitions
  -> process instances, jobs, incidents
  -> Operate / Tasklist / Optimize / exporters
```

Di Camunda 8, service task umumnya tidak dieksekusi sebagai JavaDelegate di dalam engine. Engine membuat job, lalu worker eksternal mengambil job tersebut, menjalankan logic, dan menyelesaikan job.

Ini menggeser cara berpikir:

```text
Camunda 7: engine sering dekat dengan aplikasi Java
Camunda 8: engine adalah orchestration cluster, worker adalah aplikasi eksternal
```

Konsekuensinya besar:

- worker harus idempotent
- network failure adalah hal normal
- local database transaction tidak otomatis satu transaksi dengan engine
- retry harus dipikirkan serius
- observability lintas engine dan worker wajib ada
- deployment worker dan deployment process model adalah dua lifecycle berbeda

---

## 6. Kenapa Part 0 Tidak Langsung Coding?

Karena workflow system sering gagal bukan karena developer tidak tahu API, tetapi karena salah mental model.

Contoh kegagalan desain:

```java
// Terlihat biasa, tapi bisa berbahaya dalam workflow worker
paymentClient.charge(command);
camundaClient.newCompleteCommand(job.getKey()).send().join();
```

Pertanyaan penting:

- Bagaimana kalau `charge()` sukses tetapi `completeCommand()` timeout?
- Worker restart, job diambil ulang, lalu `charge()` dipanggil lagi?
- Apakah payment API punya idempotency key?
- Apakah command id disimpan?
- Apakah proses punya status yang bisa direconcile?
- Apakah duplicate charge bisa dideteksi?

Engineer yang hanya berpikir request-response mungkin berkata:

```text
Tangkap exception lalu retry.
```

Process orchestration engineer akan berkata:

```text
Kita perlu idempotency boundary, external command ledger, retry classification, reconciliation path, dan compensation strategy.
```

Itulah alasan Part 0 dimulai dari mental model.

---

## 7. Vocabulary Dasar yang Harus Dibedakan

Banyak kebingungan di workflow engineering berasal dari istilah yang dipakai campur aduk. Kita perlu membedakannya sejak awal.

### 7.1 Workflow

Workflow adalah urutan kerja yang melibatkan aktivitas, aktor, dan transisi.

Contoh:

```text
Draft -> Submit -> Review -> Approve -> Publish
```

Workflow bisa sederhana dan internal aplikasi. Tidak semua workflow membutuhkan BPMN engine.

Workflow biasanya menjawab:

```text
Apa langkah berikutnya?
Siapa yang harus melakukan apa?
Kapan langkah dianggap selesai?
```

### 7.2 Business Process

Business process adalah rangkaian aktivitas yang menghasilkan outcome bisnis.

Contoh:

```text
License application process
Complaint handling process
Case investigation process
Appeal process
Procurement approval process
```

Business process bukan hanya status. Ia mencakup:

- actor
- decision
- document
- rule
- SLA
- exception
- escalation
- audit
- communication
- integration
- outcome

Workflow bisa menjadi bagian dari business process. Tetapi business process biasanya lebih luas.

### 7.3 Process Instance

Process definition adalah template. Process instance adalah satu eksekusi nyata dari template.

```text
Process definition:
  License Application v12

Process instances:
  Application A-2026-0001
  Application A-2026-0002
  Application A-2026-0003
```

Satu definition bisa punya ribuan atau jutaan instance.

Inilah salah satu hal yang membuat workflow system sulit: **definition bisa berubah, tetapi instance lama masih hidup**.

### 7.4 Orchestration

Orchestration adalah koordinasi terpusat atas beberapa aktivitas/service/aktor.

Dalam orchestration, ada satu coordinator yang tahu alur:

```text
Orchestrator:
  1. validate application
  2. request payment
  3. wait payment confirmation
  4. issue license
  5. notify applicant
```

Kelebihan orchestration:

- alur eksplisit
- monitoring lebih mudah
- retry/timeout/escalation lebih jelas
- audit lebih kuat
- cocok untuk human workflow dan regulatory process

Kelemahan orchestration:

- orchestrator bisa menjadi terlalu pintar
- coupling ke banyak service
- diagram bisa menjadi god-process
- perubahan proses perlu governance

### 7.5 Choreography

Choreography adalah koordinasi melalui event tanpa satu coordinator utama.

Contoh:

```text
ApplicationSubmitted event
  -> Validation service reacts
  -> Document service reacts
  -> Notification service reacts
  -> Payment service reacts
```

Setiap service tahu kapan harus bereaksi terhadap event tertentu.

Kelebihan choreography:

- service lebih otonom
- cocok untuk event-driven microservices
- tidak ada central orchestrator bottleneck

Kelemahan choreography:

- alur end-to-end tersebar
- sulit diaudit dari satu tempat
- sulit menjawab “case ini sekarang sedang di mana?”
- retry dan compensation tersebar
- hidden coupling lewat event

### 7.6 Case Management

Case management adalah pengelolaan case yang jalurnya tidak selalu linear dan sering membutuhkan judgement manusia.

Contoh regulatory case:

```text
Case opened
  -> officer reviews evidence
  -> officer may request clarification
  -> officer may escalate
  -> officer may add investigation branch
  -> legal review may be needed
  -> supervisor may return for rework
  -> enforcement action may or may not happen
```

Case management sering lebih fleksibel daripada BPMN linear.

Pertanyaan case management:

- Case sedang dalam fase apa?
- Task apa yang terbuka?
- Dokumen apa yang kurang?
- Siapa owner case?
- Apa action yang diperbolehkan sekarang?
- Apa milestone yang sudah dilewati?
- Apa SLA yang aktif?

BPMN bisa dipakai untuk bagian case management, tetapi tidak semua case management cocok dijadikan satu BPMN besar.

### 7.7 Saga

Saga adalah pola untuk mengelola long-running transaction yang terdiri dari beberapa local transaction dan compensation.

Contoh:

```text
Reserve inventory
  -> Charge payment
  -> Create shipment

Jika shipment gagal:
  -> Refund payment
  -> Release inventory
```

Saga bukan hanya “workflow”. Saga fokus pada consistency lintas service.

Ada dua style:

```text
orchestration-based saga
choreography-based saga
```

BPMN sangat cocok untuk orchestration-based saga karena compensation dan failure path bisa dimodelkan eksplisit.

### 7.8 State Machine

State machine memodelkan state dan event yang menyebabkan transition.

Contoh:

```text
DRAFT --submit--> SUBMITTED
SUBMITTED --approve--> APPROVED
SUBMITTED --reject--> REJECTED
APPROVED --revoke--> REVOKED
```

State machine cocok untuk entity lifecycle yang state-nya jelas dan transition-nya relatif terbatas.

BPMN lebih cocok ketika:

- ada banyak aktivitas
- ada human task
- ada timer
- ada parallel branch
- ada message wait
- ada compensation
- ada sub-process
- perlu audit alur, bukan hanya state akhir

Namun BPMN dan state machine sering perlu digabung.

Contoh:

```text
Domain entity: Application.status = UNDER_REVIEW
Process instance: sedang menunggu Officer Review user task + SLA timer + clarification boundary
```

Status entity tidak harus merepresentasikan seluruh detail process token.

### 7.9 Rules Engine

Rules engine mengeksekusi aturan keputusan.

Contoh:

```text
If applicant.age < 18 -> ineligible
If riskScore > 80 -> require supervisor review
If amount > 100000 -> require committee approval
```

Rules engine menjawab:

```text
Keputusan apa yang harus diambil berdasarkan data ini?
```

BPMN menjawab:

```text
Setelah keputusan diambil, alur proses bergerak ke mana?
```

DMN sering dipakai bersama BPMN untuk memisahkan flow dan decision.

### 7.10 BPMN Engine

BPMN engine menjalankan process definition berdasarkan semantics BPMN.

Ia mengatur:

- process instance
- token flow
- wait state
- job creation
- message correlation
- timer
- user task
- incidents
- completion

Tetapi BPMN engine **bukan**:

- domain database utama
- message broker umum
- document storage
- audit warehouse lengkap
- replacement untuk service layer
- replacement untuk authorization model
- magic distributed transaction manager

---

## 8. Ringkasan Perbedaan Konsep

| Konsep | Fokus | Cocok Untuk | Risiko Jika Disalahgunakan |
|---|---|---|---|
| Workflow | Urutan kerja | approval sederhana, task routing | menjadi status spaghetti |
| Business process | Outcome bisnis end-to-end | regulatory process, application lifecycle | terlalu besar dan abstrak |
| Orchestration | Coordinator eksplisit | human workflow, saga, SLA | god orchestrator |
| Choreography | Event reaction tersebar | event-driven microservices | alur sulit dilacak |
| Case management | Flexible knowledge work | investigation, enforcement case | terlalu bebas, susah distandardisasi |
| Saga | Consistency lintas local transaction | payment/order/document issuance | compensation tidak aman |
| State machine | Entity state transition | lifecycle sederhana | tidak menangkap activity history |
| Rules engine | Keputusan berbasis aturan | eligibility, routing, risk scoring | rule sprawl |
| BPMN engine | Executable process semantics | long-running auditable process | dipakai sebagai database/broker |

---

## 9. Masalah Nyata yang Diselesaikan BPMN/Camunda

### 9.1 Long-running process

Request-response biasanya hidup dalam milidetik sampai detik. Business process bisa hidup berjam-jam, berhari-hari, berbulan-bulan, bahkan bertahun-tahun.

Contoh:

```text
License renewal:
  submit today
  wait payment 7 days
  wait officer review 5 working days
  request clarification
  applicant responds after 14 days
  supervisor reviews
  license issued
```

Tanpa workflow engine, logic seperti ini sering tersebar di:

- status column
- scheduled job
- cron script
- email handler
- controller condition
- manual admin tool
- database trigger
- ad-hoc queue consumer

BPMN membuat alur eksplisit.

### 9.2 Human approval

Banyak proses bisnis tidak sepenuhnya otomatis.

Ada human decision:

- officer review
- supervisor approve
- legal review
- finance verification
- committee decision
- applicant clarification

Human task memiliki karakteristik yang berbeda dari service task:

| Service task | Human task |
|---|---|
| dieksekusi cepat | bisa menunggu lama |
| deterministik relatif | judgement manusia |
| retry otomatis mungkin | retry tidak selalu masuk akal |
| failure teknis | rejection/return/request info adalah outcome bisnis |
| owner service | owner manusia/role/group |

Workflow engine membantu memodelkan task assignment, due date, escalation, dan completion.

### 9.3 Timeout dan SLA

SLA bukan sekadar field `due_date`. SLA adalah behavior.

Contoh:

```text
Jika officer belum review dalam 3 working days:
  -> kirim reminder
Jika belum review dalam 5 working days:
  -> escalate ke supervisor
Jika applicant tidak submit clarification dalam 14 calendar days:
  -> auto-close application
```

Dalam BPMN, ini bisa dimodelkan dengan timer event, boundary event, dan escalation path.

### 9.4 Retry dan technical failure

External system bisa gagal:

- timeout
- 500 error
- rate limit
- network partition
- invalid response
- partial success

Workflow engine membantu menyimpan state “pekerjaan ini belum selesai” dan mencoba ulang sesuai policy.

Tetapi retry harus dirancang. Retry buta dapat merusak data.

### 9.5 Compensation

Distributed system tidak punya rollback global yang mudah.

Jika sebuah proses sudah:

```text
create account
send email
reserve quota
charge payment
```

Lalu step berikutnya gagal, kita tidak bisa sekadar rollback database lokal.

Kita butuh compensation:

```text
close account
send cancellation email
release quota
refund payment
```

BPMN menyediakan konsep compensation, tetapi design compensation tetap tanggung jawab engineer.

### 9.6 Auditability

Dalam proses regulatori atau enterprise, pertanyaan paling penting sering bukan:

```text
Apakah sistem berhasil update status?
```

Melainkan:

```text
Siapa melakukan apa?
Kapan?
Berdasarkan data apa?
Dengan keputusan apa?
Dengan alasan apa?
Apakah SLA terpenuhi?
Jika tidak, siapa yang menerima escalation?
Apakah ada override?
Apakah override disetujui?
```

BPMN membantu membuat jalur proses eksplisit. Tetapi audit yang baik tetap perlu desain:

- business event log
- task history
- variable snapshot
- decision trace
- actor identity
- correlation id
- document version reference
- reason code

### 9.7 Operational visibility

Tanpa process engine, proses yang stuck sering sulit dicari.

Contoh pertanyaan support:

```text
Application A-2026-00123 stuck di mana?
Kenapa email tidak terkirim?
Apakah sedang menunggu payment atau officer?
Timer SLA sudah aktif atau belum?
Apakah ada job failure?
Apakah message dari external agency belum masuk?
```

Dengan process engine dan observability yang benar, operator bisa melihat:

- process instance aktif
- current BPMN element
- incidents
- failed job
- user task backlog
- timers
- variables tertentu
- process duration

---

## 10. Masalah yang Tidak Otomatis Diselesaikan BPMN/Camunda

Penting: BPMN/Camunda bukan silver bullet.

### 10.1 BPMN tidak otomatis membuat desain domain bagus

Kalau domain model kacau, BPMN hanya menggambar kekacauan itu.

Contoh buruk:

```text
Application.status = PENDING
```

Tetapi `PENDING` bisa berarti:

- pending officer review
- pending payment
- pending clarification
- pending document verification
- pending supervisor approval
- pending external agency response
- pending system retry

BPMN bisa membantu memperjelas, tetapi domain vocabulary tetap harus benar.

### 10.2 BPMN tidak menggantikan database

Process variables bukan tempat menyimpan semua data domain.

Buruk:

```json
{
  "application": {
    "id": "A-001",
    "applicant": { ... huge object ... },
    "documents": [ ... huge base64 ... ],
    "auditTrail": [ ... ],
    "allFormData": { ... }
  }
}
```

Lebih baik:

```json
{
  "applicationId": "A-001",
  "applicantId": "P-998",
  "riskScore": 72,
  "requiresSupervisorReview": true,
  "documentBundleId": "DOC-BUNDLE-123"
}
```

Data utama tetap di domain database/document store. Process engine menyimpan data koordinasi secukupnya.

### 10.3 BPMN tidak menggantikan message broker

Camunda bisa menunggu message dan melakukan message correlation, tetapi jangan memperlakukan engine sebagai broker umum untuk semua event.

Message broker seperti Kafka/RabbitMQ tetap berguna untuk:

- high-throughput event streaming
- pub/sub antar banyak consumer
- replayable event log
- decoupled integration
- buffering traffic

Camunda berguna ketika message tersebut menggerakkan process state.

### 10.4 BPMN tidak menggantikan authorization system

User task assignment bukan authorization lengkap.

Contoh:

```text
Task assigned to group OFFICER
```

Tetap perlu menjawab:

- officer dari agency mana?
- boleh lihat field apa?
- boleh complete task dengan action apa?
- boleh reassign task atau tidak?
- boleh override decision atau tidak?
- apakah task visibility sama dengan case visibility?

Authorization harus dirancang di aplikasi, identity provider, dan/atau platform policy.

### 10.5 BPMN tidak menggantikan audit trail bisnis

Engine history berguna, tetapi sering tidak cukup untuk kebutuhan audit/regulatory.

Audit bisnis membutuhkan narasi yang dapat dimengerti:

```text
Officer Tan reviewed application A-001 on 2026-06-17 10:32.
Decision: Request Clarification.
Reason: Missing certified document.
SLA: paused until applicant response.
Notification: sent to applicant email reference N-123.
```

Engine history mungkin mencatat task completed dan variable changed, tetapi audit bisnis harus punya vocabulary domain.

### 10.6 BPMN tidak menggantikan operational maturity

Workflow engine bisa membuat stuck process terlihat. Tetapi memperbaikinya tetap butuh:

- runbook
- alerting
- incident taxonomy
- retry policy
- repair authorization
- migration process
- observability
- deployment discipline

---

## 11. Cara Berpikir CRUD vs Process Orchestration

### 11.1 CRUD thinking

CRUD thinking fokus pada entity dan operasi langsung.

```text
POST /applications
PUT /applications/{id}/submit
PUT /applications/{id}/approve
PUT /applications/{id}/reject
```

Data model:

```text
APPLICATION
- id
- status
- submitted_at
- approved_at
- rejected_at
```

Service logic:

```java
if (application.status != SUBMITTED) {
    throw new InvalidStateException();
}
application.status = APPROVED;
repository.save(application);
```

Ini tidak salah. Untuk proses sederhana, ini cukup.

### 11.2 Process orchestration thinking

Process thinking melihat bahwa `status` bukan satu-satunya state.

```text
Application A-001:
  process: LicenseApplicationProcess v12
  current wait state: Officer Review user task
  active SLA timer: 5 working days
  possible actions:
    - approve
    - reject
    - request clarification
    - escalate
  open tasks:
    - Review Application assigned to group LicensingOfficer
  business state:
    - UNDER_REVIEW
  technical state:
    - no active incident
  audit state:
    - submitted by applicant at T1
    - validation completed at T2
```

Dalam process orchestration, kita memisahkan:

| Layer | Contoh state |
|---|---|
| Domain entity state | `UNDER_REVIEW`, `APPROVED`, `REJECTED` |
| Process runtime state | token sedang di `OfficerReviewTask` |
| Human work state | task assigned/claimed/completed |
| Technical job state | job retries left, incident, lock timeout |
| SLA state | due soon, breached, escalated |
| Audit state | siapa melakukan action dan alasan |

Banyak sistem enterprise gagal karena semua state ini dipaksa masuk ke satu field `status`.

---

## 12. The Status Field Trap

Status field sangat berguna, tetapi sering menjadi tempat menumpuk semua makna.

Contoh status yang terlihat wajar:

```text
DRAFT
SUBMITTED
PENDING
APPROVED
REJECTED
```

Masalahnya ada di `PENDING`.

`PENDING` bisa berarti:

```text
pending validation
pending payment
pending document upload
pending officer review
pending supervisor approval
pending legal clearance
pending external agency
pending retry
pending manual repair
pending scheduled issuance
```

Ketika status terlalu generik, developer mulai menambah flag:

```text
status = PENDING
is_payment_pending = true
is_document_pending = false
is_external_pending = true
is_supervisor_required = true
is_escalated = false
is_retrying = true
```

Lalu controller menjadi seperti ini:

```java
if (status == PENDING && paymentPending && !documentPending && externalPending && supervisorRequired) {
    // show button A unless escalated but only if retrying is false
}
```

Ini adalah smell bahwa proses tidak dimodelkan eksplisit.

Process orchestration membantu dengan cara:

```text
Current BPMN element = WaitForPayment
Current BPMN element = OfficerReview
Current BPMN element = WaitForExternalAgencyResponse
Current BPMN element = SupervisorApproval
```

Namun bukan berarti domain status hilang. Domain status tetap diperlukan untuk query, reporting, authorization, dan business summary. Tetapi detail perjalanan proses tidak harus dipaksa masuk semua ke satu field.

---

## 13. Mental Model: Process as Explicit Business State

Fondasi pertama:

> Proses adalah state bisnis yang eksplisit, bukan efek samping dari beberapa update database.

Dalam sistem tanpa orchestration, proses sering implisit:

```text
Kalau application.status = SUBMITTED dan payment.status = PAID dan document.status = VERIFIED, berarti harus masuk officer review.
```

Logic seperti itu tersebar di service, scheduled job, dan UI.

Dalam process orchestration, transisi dibuat eksplisit:

```text
Application submitted
  -> validate documents
  -> wait for payment
  -> after payment received, create officer review task
```

Keuntungannya:

- proses bisa dibaca
- proses bisa diuji
- proses bisa dimonitor
- proses bisa diaudit
- proses bisa dibicarakan dengan business user
- proses bisa diubah dengan governance

Risikonya:

- kalau semua detail dimasukkan ke diagram, diagram menjadi rumit
- kalau ownership tidak jelas, engine menjadi pusat coupling
- kalau process variables tidak dijaga, engine menjadi shadow database

---

## 14. Mental Model: Engine as Coordinator, Not Domain Owner

Fondasi kedua:

> Process engine mengoordinasikan aktivitas. Ia tidak seharusnya menjadi pemilik utama domain business data.

Contoh pemisahan yang sehat:

```text
Camunda process:
  - tahu applicationId
  - tahu current step
  - tahu decision routing
  - tahu timer/escalation
  - tahu job/task yang harus dibuat

Application service:
  - tahu aggregate Application
  - validasi invariant domain
  - update application status
  - menyimpan data application
  - enforce business rule yang merupakan invariant

Audit service:
  - mencatat business event
  - menyimpan actor, reason, timestamp, data snapshot/reference

Document service:
  - menyimpan file
  - mengelola document version

Notification service:
  - mengirim email/SMS
  - mencatat delivery attempt
```

Engine tidak harus tahu semua detail applicant, document binary, atau full audit history.

### 14.1 Analogi yang berguna

Pikirkan process engine sebagai **air traffic controller**, bukan pesawat.

Air traffic controller:

- tahu pesawat mana harus take off
- tahu runway mana tersedia
- tahu urutan koordinasi
- tahu kapan harus menunggu
- tahu kapan harus memberi instruksi

Tetapi air traffic controller tidak menjadi mesin pesawat.

Begitu juga Camunda:

- mengatur kapan `validate-document` dijalankan
- menunggu `payment-received`
- membuat task `officer-review`
- men-trigger escalation timer

Tetapi logic validasi document, payment, dan officer permission tetap milik service/domain masing-masing.

---

## 15. Mental Model: BPMN as Executable Contract

Fondasi ketiga:

> BPMN adalah kontrak yang menghubungkan business expectation, implementation, testing, operation, dan audit.

Sebuah BPMN model yang baik harus bisa dibaca oleh beberapa pihak:

| Pihak | Yang dicari dari BPMN |
|---|---|
| Business analyst | Apakah alur sesuai policy? |
| Developer | Worker/task apa yang harus diimplementasi? |
| QA | Scenario apa yang harus diuji? |
| Operator | Instance stuck di mana? |
| Auditor | Kenapa keputusan terjadi? |
| Product owner | Apa impact perubahan rule? |
| Security | Siapa bisa melakukan action apa? |

Kalau BPMN hanya bisa dipahami developer, ia gagal sebagai business process model.

Kalau BPMN hanya indah untuk business tetapi tidak executable/operable, ia gagal sebagai engineering artifact.

Top 1% targetnya adalah dua-duanya:

```text
business-readable
+ execution-aware
+ testable
+ operable
+ auditable
+ changeable
```

---

## 16. Mental Model: Worker as Deterministic Business Adapter

Dalam Camunda 8, service task biasanya dieksekusi oleh job worker.

Worker harus diperlakukan sebagai adapter deterministik antara process engine dan domain/external system.

Contoh worker:

```text
job type: validate-application
input variables:
  - applicationId
output variables:
  - validationPassed
  - validationFailureReason
```

Worker melakukan:

```text
1. Ambil applicationId dari job variable
2. Panggil ApplicationService.validate(applicationId)
3. Simpan business result di domain DB/audit jika perlu
4. Complete job dengan output variable minimal
```

Worker yang baik:

- idempotent
- small responsibility
- clear input/output contract
- explicit error classification
- observable
- safe to retry
- does not hide process transition logic that belongs in BPMN
- does not dump entire domain object into process variable

Worker yang buruk:

```text
job type: process-everything
```

Lalu di dalamnya:

```java
validate();
chargePayment();
sendEmail();
updateStatus();
createTask();
notifyExternalAgency();
```

Jika worker melakukan semua, BPMN hanya menjadi dekorasi.

---

## 17. Mental Model: Process Instance as Long-lived Consistency Boundary

Dalam request-response, transaction boundary sering jelas:

```text
begin DB transaction
  update table A
  update table B
commit
return response
```

Dalam process orchestration, proses bisa hidup lama dan melibatkan banyak local transaction:

```text
T1: create application
T2: validate documents
T3: request payment
T4: receive payment callback
T5: create review task
T6: officer completes task
T7: issue license
T8: send notification
```

Setiap langkah bisa punya transaction sendiri.

Process instance menjadi boundary koordinasi jangka panjang, bukan ACID transaction.

Konsekuensi:

- consistency bersifat bertahap
- failure normal terjadi antar step
- compensation lebih realistis daripada rollback
- idempotency wajib
- audit harus menangkap perjalanan
- repair path harus tersedia

---

## 18. Kapan BPMN/Camunda Cocok Digunakan?

Gunakan BPMN/Camunda ketika banyak dari kondisi ini benar:

1. Proses berjalan lama.
2. Ada human task/approval.
3. Ada SLA/timer/escalation.
4. Ada banyak cabang proses yang perlu terlihat eksplisit.
5. Ada integrasi dengan external system yang bisa gagal.
6. Ada kebutuhan audit dan explainability.
7. Ada kebutuhan monitoring process instance.
8. Business ingin melihat/mendiskusikan alur proses.
9. Proses berubah secara berkala dan perlu versioning.
10. Ada retry/compensation/manual repair path.
11. Ada parent-child process atau reusable subprocess.
12. Ada message correlation dari event eksternal.
13. Ada regulatory/compliance requirement.
14. Ada kebutuhan memisahkan process flow dari domain service implementation.

Contoh cocok:

```text
license application
permit renewal
case investigation
complaint handling
appeal processing
audit remediation
loan approval
insurance claim
employee onboarding
procurement approval
KYC onboarding
payment dispute
multi-agency review
```

---

## 19. Kapan BPMN/Camunda Tidak Perlu?

BPMN/Camunda bisa overkill jika:

1. Proses sangat sederhana.
2. Tidak ada long-running state.
3. Tidak ada human task.
4. Tidak ada timer/SLA/escalation.
5. Tidak ada kebutuhan visual process monitoring.
6. Tidak ada audit proses detail.
7. State transition cukup sedikit dan stabil.
8. Throughput sangat tinggi tetapi flow sangat sederhana.
9. Team belum punya operational maturity untuk workflow engine.
10. Yang dibutuhkan hanya queue consumer biasa.

Contoh tidak perlu BPMN:

```text
CRUD master data sederhana
simple REST proxy
one-step file upload
stateless validation API
simple cache refresh job
single database transaction command
basic status transition with 3 states
```

Untuk kasus ini, state machine, scheduled job, queue consumer, atau service method biasa bisa lebih efisien.

---

## 20. Kapan Custom State Machine Lebih Cocok?

Custom state machine lebih cocok ketika:

- lifecycle entity sederhana
- state dan transition eksplisit tetapi tidak banyak activity panjang
- tidak ada human task kompleks
- tidak ada parallel branch
- tidak ada message wait rumit
- process visualization bukan kebutuhan utama
- semua transisi terjadi dalam aplikasi yang sama

Contoh:

```text
Order: CREATED -> PAID -> SHIPPED -> DELIVERED -> CLOSED
```

Tetapi jika order melibatkan:

```text
payment retry
fraud review
manual approval
inventory reservation
shipment partner callback
timeout cancellation
refund compensation
customer support intervention
```

Maka BPMN/saga orchestration mulai masuk akal.

---

## 21. Kapan Event Choreography Lebih Cocok?

Choreography lebih cocok ketika:

- setiap service punya ownership jelas
- tidak ada satu business process owner yang butuh melihat semua step
- event consumer bisa bereaksi mandiri
- eventual consistency diterima
- alur end-to-end tidak perlu dikontrol ketat
- high-throughput event distribution lebih penting daripada visual process state

Contoh:

```text
UserProfileUpdated event:
  -> search index updates
  -> recommendation service updates
  -> analytics service consumes
  -> cache invalidation happens
```

Tidak perlu BPMN untuk semua event.

Tetapi kalau event adalah bagian dari proses bisnis auditable:

```text
PaymentReceived harus melanjutkan application process dari WaitForPayment ke IssueLicense
```

Maka Camunda message correlation berguna.

---

## 22. Kapan Rules Engine/DMN Lebih Cocok?

Jika masalah utamanya adalah decision logic, bukan flow, maka gunakan rules/DMN.

Contoh:

```text
If applicantType = COMPANY and annualRevenue > X then require enhanced review
If riskScore >= 80 then route to senior officer
If productType = A and country = B then require document D
```

BPMN tidak ideal untuk menaruh banyak aturan seperti ini dalam gateway bertumpuk.

Buruk:

```text
Gateway 1: applicant type?
Gateway 2: country?
Gateway 3: revenue?
Gateway 4: risk score?
Gateway 5: document type?
Gateway 6: previous violation?
```

Lebih baik:

```text
[BPMN] Evaluate Eligibility
   -> [DMN/rules] returns decision result
[BPMN] Route based on decision category
```

Flow tetap di BPMN. Decision detail di DMN/rules.

---

## 23. Kapan Temporal/Code-first Workflow Bisa Lebih Cocok?

Temporal dan BPMN engine memecahkan sebagian masalah yang mirip, tetapi philosophy-nya berbeda.

BPMN/Camunda cocok ketika:

- business readability penting
- human workflow penting
- BPMN diagram menjadi shared artifact
- analyst/operator/auditor perlu melihat flow
- process model governance penting

Temporal/code-first workflow cocok ketika:

- developer-first durable execution lebih penting
- workflow logic lebih natural ditulis sebagai code
- determinism dan replay model diterima team
- visual business modeling bukan kebutuhan utama
- human task bisa dibangun sendiri/di luar

Top engineer tidak fanatik alat. Ia memilih berdasarkan problem shape.

---

## 24. Anti-pattern Besar dalam BPMN/Camunda

### 24.1 BPMN sebagai God Orchestrator

Semua service dipanggil dari satu proses raksasa:

```text
Application Mega Process
  -> validate user
  -> validate company
  -> validate documents
  -> call payment
  -> call email
  -> call reporting
  -> call audit
  -> call analytics
  -> call search index
  -> call notification
  -> call every subsystem
```

Masalah:

- coupling tinggi
- diagram sulit dipahami
- perubahan kecil berdampak besar
- process model menjadi distributed monolith

Solusi:

- pisahkan business-critical orchestration dari side-effect non-critical
- gunakan domain events untuk non-critical projection/analytics
- gunakan call activity/subprocess dengan hati-hati
- batasi process responsibility

### 24.2 Process Variable sebagai Database

Semua data dimasukkan ke process variable.

Masalah:

- payload besar
- serialization issue
- schema evolution sulit
- sensitive data exposure
- engine performance turun
- source of truth ambigu

Solusi:

- simpan ID/reference
- simpan decision output minimal
- domain data tetap di domain DB
- document binary di document storage
- audit detail di audit service

### 24.3 User Task sebagai Status Table

Semua state bisnis direpresentasikan sebagai open task.

Masalah:

- task list penuh task palsu
- task lifecycle tidak sama dengan domain lifecycle
- reporting kacau
- cancellation/reassignment sulit

Solusi:

- user task hanya untuk pekerjaan manusia yang benar-benar perlu action
- domain status tetap explicit
- SLA/task ownership jelas

### 24.4 Gateway sebagai Rules Engine

Banyak business rule dimodelkan dengan gateway bercabang-cabang.

Masalah:

- diagram spaghetti
- rule sulit diuji
- perubahan rule perlu ubah diagram
- business tidak bisa maintain

Solusi:

- gunakan DMN/rules service untuk decision detail
- BPMN hanya route kategori keputusan

### 24.5 Worker Tidak Idempotent

Worker melakukan side effect lalu complete job tanpa idempotency.

Masalah:

- duplicate payment
- duplicate email
- duplicate document
- duplicate external request

Solusi:

- idempotency key
- command ledger
- outbox/inbox
- external reference tracking
- safe retry policy

### 24.6 Semua Error Dianggap Technical Retry

Business rejection dilempar sebagai exception teknis.

Buruk:

```java
if (!eligible) {
    throw new RuntimeException("Applicant not eligible");
}
```

Akibat:

- job retry berulang padahal secara bisnis memang tidak eligible
- incident palsu
- operator bingung

Lebih baik:

```text
Business result: not eligible
  -> BPMN routes to rejection path

Technical failure: eligibility service timeout
  -> retry/fail job/incident
```

### 24.7 Tidak Ada Repair Path

Sistem menganggap semua proses akan berjalan mulus.

Realita production:

- external API salah response
- variable payload corrupt
- worker bug
- model bug
- user salah complete task
- timer salah konfigurasi
- message correlation gagal

Workflow system harus punya repair strategy.

---

## 25. Layered Architecture untuk Workflow System

Salah satu mental model paling penting:

```text
+------------------------------------------------------+
|                    User Interface                    |
| task inbox, case detail, action form, admin console   |
+------------------------------------------------------+
                          |
+------------------------------------------------------+
|                Application/API Layer                 |
| authz, validation, command handling, query API        |
+------------------------------------------------------+
                          |
+-------------------+        +-------------------------+
| Process Engine    |        | Domain Services         |
| BPMN runtime      | <----> | aggregates, invariants  |
| tasks, timers     |        | business operations     |
| jobs, incidents   |        +-------------------------+
+-------------------+                    |
          |                              |
+-------------------+        +-------------------------+
| Workers           |        | Domain Database         |
| service task impl |        | source of truth         |
+-------------------+        +-------------------------+
          |
+-------------------+        +-------------------------+
| Integration Layer |        | Audit/Reporting Store   |
| REST, messaging,  |        | business history        |
| email, files      |        +-------------------------+
+-------------------+
```

Kunci:

- UI tidak langsung memanipulasi process variable sembarangan.
- API layer enforce authorization dan command validity.
- Process engine mengatur flow.
- Domain service enforce invariant.
- Worker menghubungkan engine dengan domain/integration.
- Audit store menyimpan narasi bisnis.
- Reporting tidak selalu query langsung ke engine runtime.

---

## 26. Process Engine dan Domain Model: Siapa Pemilik State?

Pertanyaan penting:

```text
Jika process instance mengatakan sedang menunggu review,
tetapi application.status = APPROVED,
siapa yang benar?
```

Jawaban matang: desainmu seharusnya menghindari divergence tanpa ownership jelas.

Ada beberapa strategy.

### 26.1 Engine as process source of truth, domain as business summary

```text
Engine:
  current step = OfficerReview

Domain DB:
  status = UNDER_REVIEW
```

Process runtime menentukan posisi detail. Domain DB menyimpan status ringkas untuk query/reporting.

Cocok untuk proses yang engine-driven.

### 26.2 Domain as source of truth, engine as automation coordinator

```text
Domain DB:
  application status and lifecycle authoritative

Engine:
  coordinates async tasks, reminders, integrations
```

Cocok jika domain lifecycle sudah kuat dan BPMN digunakan untuk orchestration sebagian.

### 26.3 Hybrid dengan explicit synchronization

Ini paling umum di enterprise.

Rule-nya harus jelas:

- process transition tertentu memanggil domain command
- domain command update status
- output command melanjutkan process
- reconciliation job memeriksa mismatch
- manual repair path tersedia

Yang berbahaya adalah tidak ada rule.

---

## 27. Process Boundary: Satu Proses atau Banyak Proses?

Salah satu keputusan desain paling sulit adalah process granularity.

### 27.1 Satu proses besar

Contoh:

```text
End-to-end License Application Process
```

Kelebihan:

- end-to-end visibility
- mudah melihat flow lengkap
- correlation sederhana

Kekurangan:

- diagram besar
- sulit versioning
- sulit reuse
- perubahan kecil berdampak luas
- process instance hidup sangat lama

### 27.2 Banyak proses kecil

Contoh:

```text
Application Submission Process
Document Verification Process
Payment Process
Officer Review Process
License Issuance Process
Notification Process
```

Kelebihan:

- modular
- reuse lebih mudah
- versioning lebih terkontrol
- ownership bisa dipisah

Kekurangan:

- end-to-end visibility perlu komposisi
- correlation lebih rumit
- parent-child lifecycle perlu desain
- debugging lintas process lebih sulit

### 27.3 Heuristic awal

Gunakan satu process ketika:

- satu business owner
- satu lifecycle outcome
- flow cukup readable
- instance duration masuk akal
- change cadence relatif sama

Pecah process ketika:

- subprocess punya lifecycle sendiri
- reuse nyata
- ownership berbeda
- change cadence berbeda
- failure/retry/compensation boundary berbeda
- diagram mulai tidak terbaca

---

## 28. BPMN dan Microservices: Teman atau Musuh?

BPMN dan microservices bisa saling melengkapi, tetapi juga bisa saling merusak.

### 28.1 BPMN sebagai orchestration layer lintas service

```text
License Process
  -> Application Service
  -> Document Service
  -> Payment Service
  -> Notification Service
```

Kelebihan:

- business flow terlihat
- retry/timeout bisa eksplisit
- process instance bisa dimonitor

Risiko:

- orchestrator tahu terlalu banyak detail service
- service menjadi pasif/anemic
- diagram menjadi dependency graph teknis

### 28.2 Prinsip sehat

Process engine sebaiknya memanggil **business capability**, bukan operasi teknis terlalu granular.

Buruk:

```text
Service task: update application table
Service task: insert audit row
Service task: update document flag
Service task: send email row
```

Lebih baik:

```text
Service task: Validate Application
Service task: Request Payment
Service task: Issue License
Service task: Notify Applicant
```

Worker memanggil domain/application service yang punya invariant internal.

---

## 29. BPMN dan Regulatory Defensibility

Dalam sistem regulatori, proses bukan hanya automation. Proses adalah bukti.

Kamu harus bisa menjawab:

```text
Kenapa case ini diproses seperti itu?
Siapa yang mengambil keputusan?
Apakah decision sesuai policy yang berlaku saat itu?
Apakah officer punya authority?
Apakah SLA dilanggar?
Kalau dilanggar, apakah escalation dilakukan?
Apakah applicant diberi kesempatan clarification?
Apakah document version yang dipakai benar?
Apakah ada manual override?
```

BPMN membantu karena flow eksplisit. Tetapi regulatory defensibility membutuhkan layer tambahan:

1. **Process definition version**  
   Keputusan terjadi berdasarkan versi proses yang mana?

2. **Decision version**  
   DMN/rules/policy versi berapa yang dipakai?

3. **Actor identity**  
   User mana, role apa, agency mana, delegation apa?

4. **Reason code**  
   Kenapa action diambil?

5. **Evidence reference**  
   Dokumen/data apa yang menjadi dasar?

6. **Timestamp and timezone**  
   Kapan action terjadi? Dalam timezone apa?

7. **SLA context**  
   Apakah deadline aktif, paused, breached, extended?

8. **Repair trail**  
   Jika ada manual correction, siapa approve dan kenapa?

Top engineer mendesain BPMN bukan hanya agar proses jalan, tetapi agar proses bisa dipertanggungjawabkan.

---

## 30. Contoh Transformasi: Dari Status-based CRUD ke Process-based Design

### 30.1 Desain awal yang umum

Table:

```sql
APPLICATION(
  ID,
  STATUS,
  SUBMITTED_AT,
  APPROVED_AT,
  REJECTED_AT,
  OFFICER_ID,
  REMARKS
)
```

Status:

```text
DRAFT
SUBMITTED
PENDING_REVIEW
PENDING_CLARIFICATION
APPROVED
REJECTED
```

Controller:

```text
POST /applications/{id}/submit
POST /applications/{id}/approve
POST /applications/{id}/reject
POST /applications/{id}/request-clarification
```

Scheduled job:

```text
Find PENDING_CLARIFICATION older than 14 days -> auto close
Find PENDING_REVIEW older than 5 days -> send reminder
```

Problem setelah sistem tumbuh:

- SLA rule tersebar
- reminder logic di scheduler
- approval logic di controller
- document validation di service
- external agency response di queue consumer
- audit tersebar
- support sulit tahu case stuck di mana

### 30.2 Process-based design

BPMN-level flow:

```text
Start: Application Submitted
  -> Validate Submission
  -> Document Complete?
      no -> Request Clarification
              -> Wait Applicant Response with 14-day timer
              -> if timeout: Close Application
              -> if response: Validate Submission again
      yes -> Officer Review
              -> Approve / Reject / Request Clarification
              -> if approve: Supervisor Approval if required
              -> Issue License
              -> Notify Applicant
End
```

Domain model tetap ada:

```text
Application.status:
  DRAFT
  SUBMITTED
  UNDER_VALIDATION
  WAITING_FOR_CLARIFICATION
  UNDER_REVIEW
  APPROVED
  REJECTED
  CLOSED
  LICENSE_ISSUED
```

Task model:

```text
Officer Review Task
Clarification Response Task
Supervisor Approval Task
```

Audit events:

```text
APPLICATION_SUBMITTED
VALIDATION_COMPLETED
CLARIFICATION_REQUESTED
CLARIFICATION_SUBMITTED
OFFICER_RECOMMENDED_APPROVAL
SUPERVISOR_APPROVED
LICENSE_ISSUED
NOTIFICATION_SENT
```

Process variables minimal:

```json
{
  "applicationId": "A-2026-0001",
  "applicantId": "P-1001",
  "requiresSupervisorApproval": true,
  "clarificationRound": 1,
  "riskCategory": "MEDIUM"
}
```

Worker responsibilities:

```text
validate-submission worker
issue-license worker
send-notification worker
```

Dengan desain ini, proses lebih eksplisit dan supportable.

---

## 31. Java 8 sampai Java 25: Apa Relevansinya?

Seri ini membahas Java 8 sampai 25, tetapi perlu realistis.

### 31.1 Java 8 era

Banyak enterprise system lama masih Java 8. Dalam konteks Camunda:

- Camunda 7 historis banyak dipakai di Java 8/11 environment.
- Worker/integration service legacy mungkin masih Java 8.
- Lambdas, CompletableFuture, Stream API sudah tersedia.
- Tidak ada records, sealed classes, virtual threads, pattern matching modern.

Design implication:

- DTO lebih verbose
- concurrency pakai ExecutorService/CompletableFuture
- error handling harus disciplined
- testing/mocking cenderung lebih klasik

### 31.2 Java 11/17 era

Java 11 dan 17 menjadi baseline umum enterprise modern.

Keuntungan:

- HTTP client bawaan sejak Java 11
- var lokal
- better GC/runtime
- records sejak Java 16/17 final
- sealed classes sejak Java 17
- better container awareness

Untuk workflow worker:

- records cocok untuk immutable command/result DTO
- sealed interface cocok untuk result taxonomy
- modern switch expression membantu decision handling

### 31.3 Java 21/25 era

Java modern memberi alat lebih baik:

- virtual threads
- structured concurrency preview/advanced evolution tergantung versi
- pattern matching
- records/sealed mature
- better observability/runtime behavior

Untuk Camunda worker:

- virtual threads bisa membantu blocking IO-heavy worker
- tetapi tidak menghapus kebutuhan rate limit, idempotency, backpressure
- concurrency harus tetap dibatasi sesuai external system capacity

Peringatan penting:

> Virtual thread membuat blocking lebih murah, bukan membuat external dependency lebih kuat.

Jika external API hanya sanggup 100 request/menit, membuat 10.000 virtual thread hanya mempercepat kegagalan.

---

## 32. Java Code Mental Model: Result Taxonomy

Salah satu kebiasaan penting dalam workflow worker adalah membedakan hasil:

```text
success
business rejection
business alternative path
technical retryable failure
technical non-retryable failure
unexpected bug
```

Contoh dengan Java modern:

```java
public sealed interface ValidationOutcome
        permits ValidationOutcome.Valid,
                ValidationOutcome.Invalid,
                ValidationOutcome.TechnicalFailure {

    record Valid(String applicationId) implements ValidationOutcome {}

    record Invalid(String applicationId, String reasonCode, String message)
            implements ValidationOutcome {}

    record TechnicalFailure(String applicationId, String errorCode, String message)
            implements ValidationOutcome {}
}
```

Di Java 8, bisa dibuat dengan class hierarchy biasa:

```java
public interface ValidationOutcome {
    String applicationId();
}

public final class Valid implements ValidationOutcome { ... }
public final class Invalid implements ValidationOutcome { ... }
public final class TechnicalFailure implements ValidationOutcome { ... }
```

Kenapa ini penting?

Karena worker tidak boleh menyamakan business invalid dengan technical exception.

Mapping ke BPMN:

```text
Valid
  -> complete job with validationPassed = true

Invalid
  -> complete job with validationPassed = false
     lalu BPMN gateway menuju rejection/clarification path

TechnicalFailure retryable
  -> fail job with retries/backoff

TechnicalFailure non-retryable
  -> fail job and create incident/manual repair
```

---

## 33. Failure Thinking: Pertanyaan yang Harus Selalu Ditanyakan

Setiap kali melihat BPMN service task, tanyakan:

1. Apakah task ini punya side effect?
2. Kalau worker crash setelah side effect, apa yang terjadi?
3. Apakah task aman di-retry?
4. Apa idempotency key-nya?
5. Apa external reference yang disimpan?
6. Apa error yang business vs technical?
7. Apa yang harus dilakukan jika retry habis?
8. Apakah operator bisa memperbaiki manual?
9. Apakah audit mencatat attempt dan outcome?
10. Apakah timeout task masuk akal?
11. Apakah process variable cukup minimal?
12. Apakah domain invariant tetap dijaga di domain service?

Setiap kali melihat user task, tanyakan:

1. Siapa yang boleh melihat task?
2. Siapa yang boleh claim?
3. Siapa yang boleh complete?
4. Action apa saja yang valid?
5. Apa form/data yang boleh diedit?
6. Apakah action butuh reason?
7. Apakah action butuh attachment/evidence?
8. Apa SLA-nya?
9. Apa escalation path-nya?
10. Bagaimana reassign jika user unavailable?
11. Bagaimana audit-nya?
12. Apa yang terjadi kalau process version berubah saat task terbuka?

Setiap kali melihat gateway, tanyakan:

1. Apakah decision ini seharusnya DMN/rules?
2. Apakah condition expression mudah diuji?
3. Apakah semua branch punya meaning bisnis?
4. Apakah default path aman?
5. Apakah data untuk decision tersedia dan valid?
6. Apakah decision harus diaudit?

Setiap kali melihat timer, tanyakan:

1. Calendar day atau working day?
2. Timezone apa?
3. Public holiday bagaimana?
4. Apakah timer pause saat clarification?
5. Apa yang terjadi kalau event masuk bersamaan dengan timer?
6. Apakah timer volume tinggi?
7. Apakah timer perlu reminder atau escalation?

---

## 34. BPMN Process sebagai Contract Antara Banyak Role

Process model yang bagus bukan hanya benar secara teknis. Ia juga menjadi bahasa bersama.

### 34.1 Business analyst

Melihat:

```text
Apakah flow sesuai SOP?
Apakah exception path lengkap?
Apakah terminology sesuai domain?
```

### 34.2 Developer

Melihat:

```text
Worker apa yang harus dibuat?
Variable apa yang dibutuhkan?
Message apa yang dikorelasikan?
Task mana yang external UI handle?
```

### 34.3 QA

Melihat:

```text
Scenario apa yang diuji?
Branch mana yang belum covered?
Timer path bagaimana diuji?
Error path bagaimana diuji?
```

### 34.4 Operator

Melihat:

```text
Jika stuck, current element apa?
Incident apa?
Retry bisa dilakukan?
Manual repair aman?
```

### 34.5 Auditor

Melihat:

```text
Apakah proses dijalankan sesuai versi yang approved?
Apakah decision point tercatat?
Apakah human task actor jelas?
```

### 34.6 Security engineer

Melihat:

```text
Siapa boleh start process?
Siapa boleh complete task?
Apakah sensitive variable terekspos?
Apakah worker credential aman?
```

---

## 35. The Top 1% Difference

Engineer biasa sering bertanya:

```text
Bagaimana cara start process?
Bagaimana cara complete task?
Bagaimana cara deploy BPMN?
```

Engineer yang lebih matang bertanya:

```text
Apa process boundary yang benar?
Apa source of truth untuk state ini?
Apa business invariant yang tidak boleh dilanggar?
Apa failure mode dari setiap service task?
Apa idempotency key untuk setiap side effect?
Apa retry policy per error class?
Apa compensation path?
Apa yang terjadi pada running instance saat model berubah?
Apa audit evidence untuk setiap decision?
Apa operational runbook jika instance stuck?
Apa authorization boundary antara task visibility dan task action?
Apa data yang tidak boleh masuk process variable?
Apa metric yang memberi sinyal proses mulai rusak?
```

Top 1% bukan berarti hafal semua BPMN symbol. Top 1% berarti mampu mendesain sistem yang tetap masuk akal saat:

- ada perubahan requirement
- external system down
- user salah action
- process sudah berjalan lama
- audit datang 2 tahun kemudian
- production incident terjadi jam 2 pagi
- process model harus dimigrasikan
- data harus diperbaiki manual
- throughput naik
- compliance rule berubah

---

## 36. Mini Case Study: License Application Process

Mari gunakan contoh domain regulatori.

### 36.1 Problem

Applicant mengajukan license.

Flow bisnis:

1. Applicant submit application.
2. Sistem validasi data dan dokumen.
3. Jika dokumen kurang, applicant diminta clarification.
4. Applicant punya 14 hari untuk submit clarification.
5. Jika tidak submit, application closed.
6. Jika lengkap, officer review.
7. Officer bisa approve, reject, atau request clarification.
8. Jika risk tinggi, perlu supervisor approval.
9. Setelah approved, sistem issue license.
10. Applicant diberi notifikasi.

### 36.2 CRUD-only design risk

Dengan CRUD-only, kita mungkin punya:

```text
application.status
application.pending_reason
application.due_date
application.officer_id
application.supervisor_required
application.clarification_count
application.last_action
```

Lalu logic tersebar.

Problem muncul ketika:

- clarification timeout
- officer review overdue
- supervisor changes decision
- document validation service down
- notification failed
- applicant submit clarification saat timeout job berjalan
- audit ingin melihat alasan tiap transition

### 36.3 BPMN-oriented design

Process:

```text
ApplicationSubmitted
  -> ValidateApplication
  -> ExclusiveGateway: complete?
       no -> RequestClarification
             -> WaitForClarification with timer
             -> ValidateApplication
       yes -> OfficerReview
             -> Gateway: officerDecision
                 approve -> Gateway: supervisorRequired?
                               yes -> SupervisorApproval
                               no  -> IssueLicense
                 reject  -> RejectApplication
                 clarify -> RequestClarification
  -> NotifyApplicant
  -> End
```

Domain services:

```text
ApplicationService.submit()
ApplicationService.markUnderValidation()
ApplicationService.recordClarificationRequest()
ApplicationService.recordOfficerDecision()
ApplicationService.approve()
ApplicationService.reject()
LicenseService.issue()
NotificationService.notifyApplicant()
```

Process variables:

```json
{
  "applicationId": "APP-001",
  "clarificationCount": 0,
  "supervisorRequired": false,
  "officerDecision": null,
  "riskCategory": null
}
```

Audit events:

```text
APPLICATION_SUBMITTED
APPLICATION_VALIDATED
CLARIFICATION_REQUESTED
CLARIFICATION_TIMEOUT
OFFICER_REVIEW_COMPLETED
SUPERVISOR_APPROVAL_COMPLETED
LICENSE_ISSUED
APPLICANT_NOTIFIED
```

Operational questions answered:

```text
Current instance waiting where? OfficerReview.
Who owns task? LicensingOfficer group.
Due date? 5 working days from assignment.
If overdue? Escalate to supervisor.
If worker failed? Incident on IssueLicense.
If notification failed? Retry notification job, process may or may not block depending design.
```

---

## 37. Decision Checklist: Haruskah Ini BPMN?

Gunakan checklist berikut sebelum memilih BPMN/Camunda.

### 37.1 Process complexity

| Pertanyaan | Ya/Tidak |
|---|---|
| Apakah proses punya lebih dari 3-5 langkah bisnis signifikan? | |
| Apakah proses berjalan lebih dari satu request-response? | |
| Apakah ada wait state? | |
| Apakah ada human task? | |
| Apakah ada SLA/timer? | |
| Apakah ada branch bisnis yang perlu dilihat jelas? | |
| Apakah ada external event callback? | |
| Apakah ada compensation? | |
| Apakah process monitoring dibutuhkan? | |

Jika banyak “ya”, BPMN mulai masuk akal.

### 37.2 Audit/regulatory need

| Pertanyaan | Ya/Tidak |
|---|---|
| Apakah keputusan perlu reason code? | |
| Apakah actor identity penting? | |
| Apakah process version penting? | |
| Apakah SLA harus dibuktikan? | |
| Apakah manual override harus tercatat? | |
| Apakah auditor perlu melihat journey case? | |

Jika banyak “ya”, process model eksplisit sangat membantu.

### 37.3 Operational need

| Pertanyaan | Ya/Tidak |
|---|---|
| Apakah support perlu melihat instance stuck? | |
| Apakah retry/manual repair perlu aman? | |
| Apakah external system sering gagal? | |
| Apakah process bisa hidup lama? | |
| Apakah instance migration mungkin terjadi? | |

Jika banyak “ya”, engine + runbook bisa bernilai.

### 37.4 Warning sign

Jika alasan memakai BPMN hanya:

```text
karena ingin terlihat enterprise
karena diagram lebih keren
karena semua system harus pakai workflow engine
karena ingin mengganti semua service logic dengan BPMN
```

Maka berhenti dulu. Itu bukan alasan kuat.

---

## 38. Design Principle Awal untuk Seluruh Seri

Prinsip-prinsip ini akan dipakai sepanjang seri.

### 38.1 Model business flow, not technical plumbing

BPMN harus memperlihatkan business process, bukan semua detail teknis.

Buruk:

```text
Open DB Connection -> Query Table -> Map DTO -> Call API -> Parse JSON
```

Baik:

```text
Validate Application -> Request Payment -> Issue License
```

### 38.2 Keep process variables small and meaningful

Variable adalah contract, bukan dumping ground.

### 38.3 Make failure explicit

Jika failure penting secara bisnis, modelkan.

Jika failure teknis, tentukan retry/incident policy.

### 38.4 Separate business error from technical error

Business error mengubah flow. Technical error biasanya retry/incident.

### 38.5 Every side effect needs idempotency thinking

Email, payment, document generation, external API update, notification, audit insert: semua harus dipikirkan duplicate behavior-nya.

### 38.6 Human task is a governance object

User task bukan hanya todo item. Ia membawa authorization, accountability, SLA, evidence, dan audit.

### 38.7 Process versioning is not optional

Begitu proses berjalan di production, versioning menjadi realitas.

### 38.8 Operability is design-time concern

Jangan menunggu production incident baru membuat runbook.

### 38.9 BPMN should reduce ambiguity, not hide it

Jika diagram membuat orang merasa paham padahal detail penting disembunyikan, diagram itu berbahaya.

### 38.10 Do not confuse visibility with correctness

Karena proses terlihat di Operate/Cockpit, bukan berarti desainnya benar.

---

## 39. Terminology Map untuk Seri Ini

Sepanjang seri, istilah berikut akan dipakai konsisten.

| Istilah | Makna dalam seri ini |
|---|---|
| Process definition | Template BPMN yang dideploy |
| Process instance | Eksekusi nyata dari process definition |
| Token | Konsep eksekusi BPMN yang bergerak melewati flow node |
| Wait state | Titik proses berhenti menunggu event/task/job/timer |
| Service task | Aktivitas otomatis yang biasanya dijalankan worker/delegate |
| User task | Aktivitas manusia yang perlu completion |
| Worker | Aplikasi/kode yang mengambil dan menyelesaikan job |
| Job | Unit kerja yang dibuat engine untuk worker |
| Incident | Kondisi runtime yang butuh perhatian/perbaikan |
| BPMN error | Error bisnis yang dimodelkan dalam process flow |
| Technical failure | Kegagalan teknis yang biasanya retry/incident |
| Compensation | Aksi bisnis untuk membalik/menetralkan efek step sebelumnya |
| Correlation | Menghubungkan message/event eksternal ke process instance yang tepat |
| Business key | Identifier bisnis untuk melacak instance, misalnya application number |
| Process variable | Data runtime yang dipakai engine untuk routing/worker/task |
| Domain state | State utama entity di domain database |
| Audit event | Catatan bisnis yang menjelaskan action/decision penting |

---

## 40. Output Pembelajaran Setelah Part 0

Setelah Part 0, kamu belum harus bisa coding Camunda. Tetapi kamu harus sudah punya kerangka berpikir:

1. Tidak semua proses perlu BPMN.
2. BPMN berguna saat proses long-running, auditable, human-involved, event-driven, dan operationally visible.
3. Camunda 7 dan Camunda 8 punya mental model berbeda.
4. Process engine adalah coordinator, bukan domain owner.
5. Process variable bukan database.
6. Worker harus idempotent dan failure-aware.
7. Business error berbeda dari technical failure.
8. Human task membawa authorization, SLA, dan audit responsibility.
9. Domain state dan process runtime state harus punya ownership jelas.
10. Process model yang baik harus business-readable, execution-aware, testable, operable, dan auditable.

---

## 41. Latihan Pemahaman

Jawab pertanyaan ini sebelum lanjut ke Part 1.

### Latihan 1 — Klasifikasi masalah

Untuk setiap kasus, tentukan apakah lebih cocok:

- CRUD biasa
- state machine
- BPMN/Camunda
- event choreography
- rules/DMN
- hybrid

Kasus:

1. User update nomor telepon profile.
2. Applicant mengajukan izin dengan review officer, clarification, SLA, dan supervisor approval.
3. Risk scoring berdasarkan 50 rule eligibility.
4. Search index perlu update setelah product berubah.
5. Order e-commerce sederhana: created, paid, shipped, delivered.
6. Payment dispute dengan bank callback, manual review, evidence upload, timeout, dan appeal.
7. Notification email setelah user register.
8. Enforcement case dengan investigation, legal review, escalation, and closure.

### Latihan 2 — Status trap

Ambil status berikut:

```text
PENDING
```

Pecah menjadi minimal 8 kemungkinan makna bisnis/teknis. Lalu tentukan mana yang sebaiknya menjadi:

- domain status
- BPMN wait state
- user task
- technical incident
- SLA state

### Latihan 3 — Worker failure

Sebuah worker melakukan:

```text
1. call external payment API
2. update application status to PAID
3. complete Camunda job
```

Pertanyaan:

1. Apa yang terjadi jika crash setelah step 1?
2. Apa yang terjadi jika crash setelah step 2?
3. Apa idempotency key yang bisa dipakai?
4. Apa data yang harus disimpan untuk reconciliation?
5. Error mana yang business dan mana yang technical?

### Latihan 4 — Process boundary

Sebuah process `ApplicationProcessing` sudah punya 80 BPMN elements.

Pertanyaan:

1. Kapan harus dipecah?
2. Apa kandidat subprocess/call activity?
3. Apa risiko jika dipecah terlalu kecil?
4. Apa risiko jika tetap satu proses besar?

---

## 42. Referensi Utama

Referensi ini menjadi anchor awal seri. Detail teknis akan diperluas di part berikutnya.

1. OMG BPMN 2.0.2 — Business Process Model and Notation. OMG menyatakan BPMN sebagai standard de-facto untuk diagram proses bisnis dan menyediakan specification artifacts resmi.  
   https://www.omg.org/spec/BPMN/2.0.2/About-BPMN

2. OMG BPMN 2.0 specification documents.  
   https://www.omg.org/spec/BPMN/2.0/

3. Camunda 8 documentation — Using Camunda 8. Dokumentasi Camunda 8 menjelaskan orchestration untuk proses yang melibatkan people, systems, and devices, memakai BPMN dan DMN dengan tooling modeling, operations, dan analytics.  
   https://docs.camunda.io/docs/components/

4. Camunda 8 self-managed overview. Dokumentasi self-managed menjelaskan orchestration cluster dan komponen seperti Zeebe, Tasklist, Operate, Identity, Connectors, Optimize, Web Modeler, Console, dan Management Identity.  
   https://docs.camunda.io/docs/self-managed/about-self-managed/

5. Camunda Java Client migration guide. Camunda Java Client adalah official Java library untuk terhubung ke orchestration cluster, process automation, dan job workers. Zeebe Java Client tetap tersedia sampai Camunda 8.10.  
   https://docs.camunda.io/docs/apis-tools/migration-manuals/migrate-to-camunda-java-client/

6. Camunda 8.8 release announcement. Camunda 8.8 memperkenalkan Camunda Java Client dan Camunda Spring Boot Starter sebagai pengganti Zeebe Java Client dan Spring Zeebe SDK.  
   https://docs.camunda.io/docs/reference/announcements-release-notes/880/880-announcements/

7. Camunda 7 Enterprise EoL extension. Camunda mengumumkan Enterprise support extension sampai April 9, 2030, dan final feature release Camunda 7.24 dijadwalkan/dirilis pada October 14, 2025.  
   https://camunda.com/blog/2025/02/camunda-7-enterprise-end-of-life-extension/

---

## 43. Ringkasan Super Singkat

```text
CRUD thinks in rows.
State machine thinks in states.
Messaging thinks in events.
Rules engine thinks in decisions.
BPMN thinks in long-running business flow.
Camunda runs that flow as process instances.
Java workers connect that flow to real business capabilities.
Top engineers design the boundaries, failures, audit, versioning, and operations—not just the happy path.
```

---

## 44. Status Seri

Part ini adalah **Part 0 dari 30**.

Seri belum selesai. Lanjutkan ke:

```text
Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-031](../../.base/testing/learn-java-testing-benchmarking-performance-jvm-part-031.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-01-bpmn-20-deep-semantics-execution-contract.md)
