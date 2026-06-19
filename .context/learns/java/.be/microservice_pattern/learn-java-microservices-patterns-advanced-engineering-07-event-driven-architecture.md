# learn-java-microservices-patterns-advanced-engineering-07-event-driven-architecture

# Part 7 — Event-Driven Architecture Deep Dive

> Seri: Java Microservices Patterns — Advanced Engineering  
> Part: 7 dari 35  
> Target: Software engineer / tech lead / architect yang ingin mampu mendesain event-driven microservices secara production-grade, bukan hanya memakai Kafka/RabbitMQ/EventBridge sebagai transport.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. realitas distributed systems,
2. service boundary,
3. domain modeling,
4. architecture styles,
5. synchronous API communication,
6. asynchronous messaging.

Part ini melanjutkan dari **asynchronous messaging** ke level yang lebih spesifik: **event-driven architecture**.

Perbedaan besarnya:

```text
Asynchronous messaging:
    Service mengirim message ke service lain tanpa menunggu hasil langsung.

Event-driven architecture:
    Sistem disusun di sekitar fakta perubahan keadaan yang dipublikasikan,
    dikonsumsi, diproyeksikan, direplay, diaudit, dan digunakan untuk
    mengoordinasikan perubahan lintas boundary.
```

Dengan kata lain, tidak semua sistem yang memakai queue atau topic adalah event-driven architecture. Banyak sistem hanya memindahkan RPC ke broker dan menyebutnya event-driven. Itu biasanya menghasilkan **distributed monolith yang asynchronous**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. membedakan event, command, notification, dan document message;
2. membedakan event notification, event-carried state transfer, event sourcing, dan CQRS;
3. mendesain event sebagai **business fact**, bukan sebagai remote instruction;
4. menentukan event granularity yang tepat;
5. membuat event schema yang evolvable;
6. menghindari event soup dan hidden coupling;
7. mendesain choreography dan orchestration secara sadar;
8. memahami kapan event-driven architecture meningkatkan autonomy;
9. memahami kapan event-driven architecture justru memperumit sistem;
10. mengelola duplicate event, out-of-order event, stale projection, dan replay;
11. membuat checklist production-readiness untuk event-driven microservices Java.

---

## 2. Definisi Dasar: Apa Itu Event?

Event adalah **fakta bahwa sesuatu telah terjadi**.

Contoh event yang benar:

```text
ApplicationSubmitted
PaymentReceived
CaseAssigned
InspectionScheduled
AppealApproved
LicenseExpired
DocumentUploaded
EmailDeliveryFailed
```

Ciri event:

1. sudah terjadi;
2. tidak memerintah consumer secara langsung;
3. diberi nama dalam bentuk past tense;
4. merepresentasikan perubahan yang relevan secara bisnis;
5. boleh dikonsumsi oleh nol, satu, atau banyak consumer;
6. producer tidak harus tahu siapa consumer-nya;
7. event sebaiknya immutable setelah dipublikasikan.

Contoh yang bukan event, tetapi command terselubung:

```text
SendEmail
CreateInvoice
UpdateSearchIndex
NotifyCaseOfficer
CallPaymentService
```

Nama-nama tersebut adalah instruksi. Instruksi memiliki target dan intensi. Event memiliki fakta.

Perbedaan mental model:

```text
Command:
    "Tolong lakukan X."

Event:
    "X telah terjadi. Siapa pun yang peduli boleh bereaksi."
```

---

## 3. Event-Driven Architecture Bukan Sekadar Broker

Kesalahan umum:

```text
Kami memakai Kafka, berarti kami event-driven.
```

Belum tentu.

Arsitektur disebut event-driven bukan karena teknologinya, tetapi karena **arah dependensi dan model koordinasinya** berubah.

### 3.1 Sistem Message-Driven Sederhana

```text
Service A ---> Queue ---> Service B
```

Ini bisa saja hanya asynchronous command:

```text
UserService sends CreateAuditLog command to AuditService.
```

Ini async, tetapi belum tentu event-driven.

### 3.2 Sistem Event-Driven

```text
Application Service publishes ApplicationSubmitted

Consumers:
    - Case Service creates initial case
    - Notification Service sends confirmation
    - Audit Service stores audit evidence
    - Reporting Service updates dashboard
    - Risk Service starts screening
```

Producer tidak memanggil consumer satu per satu. Producer hanya menyatakan fakta.

---

## 4. Empat Makna Event-Driven Architecture

Istilah event-driven sering ambigu. Martin Fowler membedakan beberapa makna besar event-driven, termasuk event notification, event-carried state transfer, event sourcing, dan CQRS-related style.

Kita gunakan empat kategori praktis berikut.

---

## 5. Pattern 1: Event Notification

Event notification adalah event kecil yang hanya memberi tahu bahwa sesuatu terjadi.

Contoh:

```json
{
  "eventType": "ApplicationSubmitted",
  "applicationId": "APP-2026-000123",
  "occurredAt": "2026-06-19T10:15:30Z"
}
```

Consumer yang butuh detail harus memanggil producer atau membaca sumber lain.

### 5.1 Kelebihan

1. payload kecil;
2. tidak membocorkan terlalu banyak data;
3. schema lebih stabil;
4. producer tidak perlu mengirim seluruh state;
5. cocok untuk trigger proses lanjutan.

### 5.2 Kekurangan

1. consumer harus call back ke producer;
2. bisa menciptakan fan-out synchronous load;
3. rawan race condition jika data belum terlihat;
4. consumer makin tergantung pada API producer;
5. replay menjadi lebih sulit jika source state sudah berubah.

### 5.3 Cocok Untuk

1. trigger workflow;
2. notification ringan;
3. event dengan data sensitif;
4. sistem dengan consumer sedikit;
5. sistem dengan producer API yang kuat dan stabil.

### 5.4 Tidak Cocok Untuk

1. high-volume projection;
2. analytics pipeline;
3. consumer yang harus mandiri;
4. replay historis;
5. cross-service read model besar.

---

## 6. Pattern 2: Event-Carried State Transfer

Event-carried state transfer membawa cukup data agar consumer tidak perlu call back ke producer.

Contoh:

```json
{
  "eventType": "ApplicationSubmitted",
  "eventId": "evt-8f3a...",
  "applicationId": "APP-2026-000123",
  "applicantId": "USR-9981",
  "applicationType": "SALESPERSON_REGISTRATION",
  "submittedAt": "2026-06-19T10:15:30Z",
  "submittedBy": {
    "actorType": "PUBLIC_USER",
    "actorId": "USR-9981"
  },
  "agencyCode": "CEA"
}
```

Consumer dapat membangun local projection.

### 6.1 Kelebihan

1. mengurangi synchronous dependency;
2. consumer lebih autonomous;
3. cocok untuk materialized view;
4. cocok untuk reporting/search/read model;
5. replay lebih berguna karena data historis ikut dibawa.

### 6.2 Kekurangan

1. payload lebih besar;
2. risiko data leakage;
3. schema evolution lebih sulit;
4. data bisa stale;
5. consumer bisa salah menganggap salinan datanya sebagai source of truth.

### 6.3 Prinsip Penting

Event-carried state transfer bukan berarti semua field dikirim.

Yang dikirim adalah:

```text
cukup data untuk consumer menjalankan responsibility-nya
tanpa melanggar data ownership dan privacy boundary.
```

---

## 7. Pattern 3: Event Sourcing

Event sourcing menyimpan state entity sebagai sequence of events, bukan hanya current state row.

Model biasa:

```text
APPLICATION table:
    id = APP-1
    status = SUBMITTED
```

Model event sourcing:

```text
ApplicationDraftCreated
ApplicationFieldUpdated
DocumentAttached
ApplicationSubmitted
ApplicationRoutedForScreening
```

Current state dibangun dari replay event.

Microservices.io mendefinisikan event sourcing sebagai penyimpanan state business entity sebagai sequence event perubahan state; setiap perubahan state menambahkan event baru, dan current state direkonstruksi dengan replay event.

### 7.1 Kelebihan

1. audit trail sangat kuat;
2. history tidak hilang;
3. temporal query memungkinkan;
4. replay projection memungkinkan;
5. debugging lifecycle lebih kaya;
6. cocok untuk domain dengan regulatory/audit requirement tinggi;
7. cocok untuk domain dengan state transition penting.

### 7.2 Kekurangan

1. learning curve tinggi;
2. schema evolution event sulit;
3. replay bisa mahal;
4. query current state butuh projection;
5. data privacy/right-to-erasure lebih sulit;
6. debugging membutuhkan tooling khusus;
7. tidak cocok untuk semua domain.

Studi industri tentang event-sourced systems menemukan tantangan seperti evolution event system, learning curve, rebuilding projections, dan data privacy. Itu penting: event sourcing bukan silver bullet.

### 7.3 Kapan Layak

Event sourcing layak dipertimbangkan jika:

1. setiap transisi penting secara audit;
2. perlu merekonstruksi masa lalu;
3. perlu forensic traceability;
4. perlu replay untuk projection;
5. domain memiliki lifecycle/state machine kompleks;
6. current state saja tidak cukup menjelaskan kebenaran bisnis.

Contoh domain cocok:

```text
Case lifecycle
Appeal lifecycle
Payment ledger
Regulatory enforcement action
License status history
Workflow execution history
Approval chain
```

### 7.4 Kapan Tidak Layak

Tidak layak jika:

1. domain CRUD sederhana;
2. tim belum siap operationally;
3. data privacy sangat rumit dan belum ada strategi;
4. reporting sederhana sudah cukup;
5. event evolution tidak punya governance;
6. tidak ada kebutuhan temporal/audit kuat.

---

## 8. Pattern 4: CQRS with Event-Driven Projections

CQRS memisahkan write model dan read model.

```text
Command side:
    menerima command
    validasi invariant
    mengubah aggregate
    publish event

Query side:
    consume event
    update projection/materialized view
    melayani query cepat
```

Contoh:

```text
Application Command Service
    submit application
    approve application
    reject application

Application Query Service
    application listing
    dashboard count
    search by applicant
    officer workload view
```

### 8.1 Kelebihan

1. read model bisa dioptimalkan untuk query;
2. write model bisa fokus invariant;
3. cocok untuk dashboard dan listing kompleks;
4. mengurangi cross-service join runtime;
5. cocok untuk high-read systems.

### 8.2 Kekurangan

1. eventual consistency;
2. projection lag;
3. duplicate data;
4. rebuild complexity;
5. operational complexity;
6. butuh observability untuk freshness.

---

## 9. Event Sebagai Business Fact

Event yang kuat bukan sekadar record teknis.

Buruk:

```json
{
  "eventType": "ApplicationUpdated",
  "applicationId": "APP-1"
}
```

Masalah:

1. terlalu generik;
2. tidak memberi tahu apa yang berubah;
3. consumer harus fetch detail;
4. sulit audit;
5. sulit replay;
6. sulit membedakan meaning.

Lebih baik:

```text
ApplicationSubmitted
ApplicationAssignedToOfficer
ApplicationReturnedForClarification
ClarificationSubmitted
ApplicationApproved
ApplicationRejected
```

Event harus menangkap **meaning**, bukan hanya mutation.

### 9.1 Rule of Thumb

Jika event name masih bisa diganti dengan `SomethingChanged`, kemungkinan model domain belum matang.

---

## 10. Event Naming

Gunakan nama event yang:

1. past tense;
2. business meaningful;
3. spesifik;
4. tidak menyebut consumer;
5. tidak menyebut transport;
6. tidak menyebut action teknis.

Contoh baik:

```text
ApplicationSubmitted
PaymentConfirmed
CaseEscalated
DocumentVerificationFailed
LicenseSuspended
RiskScoreCalculated
```

Contoh buruk:

```text
SendEmailEvent
UpdateElasticEvent
KafkaApplicationMessage
ApplicationChangeEvent
DoCaseAssignment
NotificationTrigger
```

### 10.1 Nama Event Bukan Nama Handler

Buruk:

```text
NotifyApplicantEmailEvent
```

Baik:

```text
ApplicationSubmitted
```

Email adalah reaksi consumer, bukan fakta domain utama.

---

## 11. Event Granularity

Event terlalu besar menyebabkan coupling. Event terlalu kecil menyebabkan noise.

### 11.1 Event Terlalu Kasar

```text
ApplicationUpdated
```

Masalah:

1. ambiguous;
2. semua consumer harus inspect detail;
3. schema cenderung generic;
4. consumer logic tersebar;
5. audit meaning lemah.

### 11.2 Event Terlalu Halus

```text
ApplicationNameFieldChanged
ApplicationAddressLine1Changed
ApplicationPostalCodeChanged
ApplicationPhoneNumberChanged
```

Masalah:

1. event flood;
2. consumer sulit memahami business milestone;
3. ordering makin rumit;
4. replay makin mahal;
5. broker topic menjadi noise.

### 11.3 Granularity yang Lebih Baik

```text
ApplicationDraftUpdated
ApplicationSubmitted
ApplicationContactInformationCorrected
ApplicationReturnedForClarification
```

Fokus pada business milestone.

### 11.4 Pertanyaan Desain

Untuk menentukan granularitas, tanyakan:

1. Apakah perubahan ini mengubah lifecycle?
2. Apakah consumer berbeda bereaksi secara berbeda?
3. Apakah event ini penting untuk audit?
4. Apakah event ini memengaruhi SLA?
5. Apakah event ini perlu direplay?
6. Apakah event ini perlu dilihat manusia?
7. Apakah event ini hanya detail teknis internal?

---

## 12. Event Schema Production-Grade

Event bukan hanya payload bisnis. Event butuh envelope.

Contoh envelope:

```json
{
  "eventId": "evt-01JZ8K5...",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 1,
  "source": "application-service",
  "aggregateType": "Application",
  "aggregateId": "APP-2026-000123",
  "aggregateVersion": 7,
  "correlationId": "corr-9a8b...",
  "causationId": "cmd-4f2c...",
  "traceId": "00-...",
  "tenantId": "CEA",
  "actor": {
    "type": "PUBLIC_USER",
    "id": "USR-9981"
  },
  "occurredAt": "2026-06-19T10:15:30Z",
  "publishedAt": "2026-06-19T10:15:31Z",
  "dataClassification": "CONFIDENTIAL",
  "payload": {
    "applicationId": "APP-2026-000123",
    "applicationType": "SALESPERSON_REGISTRATION",
    "submittedAt": "2026-06-19T10:15:30Z"
  }
}
```

### 12.1 Required Metadata

Minimal untuk sistem serius:

| Field | Fungsi |
|---|---|
| `eventId` | deduplication, traceability |
| `eventType` | dispatching |
| `eventVersion` | schema evolution |
| `source` | producer ownership |
| `aggregateId` | ordering/keying |
| `aggregateVersion` | ordering dan concurrency reasoning |
| `correlationId` | end-to-end business flow |
| `causationId` | event/command penyebab langsung |
| `occurredAt` | waktu fakta terjadi |
| `publishedAt` | waktu event keluar dari producer |
| `tenantId` | isolation dan routing |
| `actor` | audit identity |
| `payload` | business data |

### 12.2 occurredAt vs publishedAt

`occurredAt` adalah waktu fakta terjadi.

`publishedAt` adalah waktu event dipublikasikan.

Keduanya tidak selalu sama.

Contoh:

```text
10:00:00 Application approved in database transaction
10:00:03 Outbox relay publishes ApplicationApproved event
```

Maka:

```text
occurredAt  = 10:00:00
publishedAt = 10:00:03
```

Ini penting untuk audit, SLA, lag measurement, dan replay.

---

## 13. Domain Event vs Integration Event

### 13.1 Domain Event

Domain event hidup di dalam bounded context.

Contoh:

```java
record ApplicationSubmitted(
    ApplicationId applicationId,
    ApplicantId applicantId,
    Instant submittedAt
) implements DomainEvent {}
```

Domain event boleh menggunakan type domain internal.

### 13.2 Integration Event

Integration event adalah kontrak publik lintas service.

Contoh:

```java
record ApplicationSubmittedV1(
    String applicationId,
    String applicantId,
    String applicationType,
    Instant submittedAt
) {}
```

Integration event harus stabil, explicit, versioned, dan tidak membocorkan internal domain model.

### 13.3 Mapping

```text
Domain event
    -> event mapper
        -> integration event
            -> outbox
                -> broker
```

Jangan expose domain object langsung sebagai event publik.

---

## 14. Event Publication Boundary

Pertanyaan penting:

```text
Kapan event boleh dipublikasikan?
```

Jawaban production-grade:

```text
Event boleh dianggap publishable hanya setelah state change yang menjadi sumber fakta berhasil commit.
```

Jika `ApplicationSubmitted` terpublish tetapi database rollback, sistem berbohong.

Jika database commit tetapi event gagal publish, sistem tidak lengkap.

Inilah **dual-write problem**.

Solusi umum:

1. transactional outbox;
2. event sourcing;
3. CDC-based relay;
4. broker transaction jika boundary sesuai, tetapi tetap hati-hati.

Part 9 akan membahas outbox/inbox/CDC lebih dalam. Di part ini cukup pegang invariant:

```text
Tidak boleh ada event publik yang tidak dapat dibuktikan oleh committed state.
Tidak boleh ada committed state penting yang tidak pernah dipublikasikan jika consumer bergantung pada event tersebut.
```

---

## 15. Choreography vs Orchestration

Event-driven architecture sering diasosiasikan dengan choreography.

### 15.1 Choreography

Setiap service bereaksi terhadap event.

```text
ApplicationSubmitted
    -> Case Service creates case
    -> Notification Service sends email
    -> Risk Service starts screening
    -> Reporting Service updates dashboard
```

Tidak ada central controller yang memanggil semua step.

Kelebihan:

1. service autonomy tinggi;
2. producer tidak tahu consumer;
3. mudah menambah consumer;
4. cocok untuk notification/projection/side effect longgar;
5. horizontal scalability baik.

Kekurangan:

1. flow tersembunyi;
2. debugging sulit;
3. ownership proses bisa kabur;
4. circular event chain bisa muncul;
5. compliance/audit process sulit jika tidak didesain.

### 15.2 Orchestration

Ada orchestrator/process manager yang menentukan langkah.

```text
Application Orchestrator:
    submit application
    request risk screening
    wait result
    request payment validation
    assign officer
    notify applicant
```

Kelebihan:

1. flow eksplisit;
2. cocok untuk long-running business process;
3. timeout dan compensation lebih jelas;
4. audit process lebih mudah;
5. SLA/escalation lebih mudah dikontrol.

Kekurangan:

1. orchestrator bisa menjadi god service;
2. coupling ke semua participants;
3. bottleneck ownership;
4. lebih sulit menjaga service autonomy.

### 15.3 Rule of Thumb

Gunakan choreography untuk:

```text
independent reactions, projections, notifications, analytics, weakly-coupled side effects
```

Gunakan orchestration untuk:

```text
business process dengan urutan, timeout, compensation, human task, SLA, regulatory accountability
```

---

## 16. Eventual Consistency

Event-driven architecture hampir selalu membawa eventual consistency.

Contoh:

```text
10:00:00 Application submitted
10:00:01 Application Service returns success
10:00:02 Case Service consumes event
10:00:03 Reporting projection updated
10:00:05 Search index updated
```

Pada 10:00:01, write sudah sukses tetapi read model tertentu mungkin belum update.

### 16.1 Jangan Sembunyikan Eventual Consistency

Buruk:

```text
User submit application, lalu langsung dashboard harus pasti update semua.
```

Jika dashboard dari projection async, ini tidak dijamin.

Lebih baik:

```text
Submission success page membaca write model langsung.
Dashboard listing boleh eventually consistent dengan freshness indicator.
```

### 16.2 UX Pattern

1. show confirmation from command result;
2. show pending state;
3. show last updated timestamp;
4. optimistic UI dengan reconciliation;
5. expose processing status;
6. avoid false promise of immediate global consistency.

---

## 17. Read-Your-Writes Problem

Masalah:

```text
User submit application.
Backend publish event.
Projection belum update.
User refresh listing.
Application belum muncul.
```

Solusi:

1. command response mengembalikan resource id;
2. redirect ke detail page dari write model;
3. session-level read-your-writes cache;
4. projection wait with timeout;
5. polling status;
6. use same service for immediate confirmation;
7. communicate freshness.

Jangan memaksa semua projection sync hanya untuk menutup UX gap kecil. Itu menghapus manfaat EDA.

---

## 18. Duplicate Event Handling

Dalam distributed messaging, duplicate harus diasumsikan normal.

Consumer harus idempotent.

Contoh buruk:

```java
void onApplicationSubmitted(Event event) {
    caseRepository.insert(new Case(event.applicationId()));
    emailService.sendConfirmation(event.applicationId());
}
```

Jika event diproses dua kali:

1. case duplicate;
2. email terkirim dua kali;
3. audit kacau.

Lebih baik:

```java
void onApplicationSubmitted(ApplicationSubmittedV1 event) {
    if (inbox.alreadyProcessed(event.eventId())) {
        return;
    }

    transaction.execute(() -> {
        caseRepository.createIfAbsent(event.applicationId());
        notificationRequestRepository.createIfAbsent(
            "APPLICATION_SUBMITTED_CONFIRMATION",
            event.applicationId()
        );
        inbox.markProcessed(event.eventId());
    });
}
```

Prinsip:

```text
Consumer side effect harus bisa dijalankan ulang tanpa menggandakan business effect.
```

---

## 19. Out-of-Order Event Handling

Event bisa datang tidak berurutan.

Contoh:

```text
ApplicationApproved aggregateVersion=8
ApplicationSubmitted aggregateVersion=7
```

Consumer menerima approved dulu.

Strategi:

1. partition by aggregateId agar ordering per aggregate lebih kuat;
2. gunakan aggregateVersion;
3. reject/park event jika predecessor belum ada;
4. rebuild projection dari event log jika memungkinkan;
5. buat handler tolerant terhadap missing prior event;
6. gunakan snapshot/source-of-truth lookup jika aman;
7. desain event agar tidak terlalu bergantung pada urutan global.

### 19.1 Global Ordering Hampir Selalu Ilusi

Ordering global mahal dan sering tidak perlu.

Yang biasanya dibutuhkan:

```text
ordering per aggregate
ordering per business key
ordering per tenant + aggregate
```

---

## 20. Replay Safety

Replay adalah kemampuan memproses ulang event historis.

Replay berguna untuk:

1. rebuild projection;
2. fix bug handler;
3. migrate read model;
4. audit reconstruction;
5. analytics recomputation.

Namun replay berbahaya jika handler punya side effect eksternal.

Contoh side effect yang tidak boleh dijalankan ulang sembarangan:

```text
send email
charge payment
call external agency
generate official document number
send SMS
create irreversible audit record duplicate
```

### 20.1 Pisahkan Projection Handler dan Side-Effect Handler

Projection handler:

```text
ApplicationSubmitted -> update application_listing_projection
```

Replay safe.

Side-effect handler:

```text
ApplicationSubmitted -> send confirmation email
```

Tidak replay safe tanpa guard.

### 20.2 Replay Context

Handler harus tahu mode:

```text
LIVE_PROCESSING
REPLAY_PROJECTION
BACKFILL
RECOVERY
```

Pseudo-code:

```java
void handle(ApplicationSubmitted event, ProcessingContext context) {
    projection.update(event);

    if (context.isLive()) {
        notificationRequests.createIfAbsent(event.eventId(), event.applicationId());
    }
}
```

---

## 21. Event Versioning

Event adalah kontrak jangka panjang.

Sekali dipublikasikan, consumer bisa bergantung padanya.

### 21.1 Backward-Compatible Changes

Biasanya aman:

1. tambah field optional;
2. tambah event type baru;
3. tambah enum value jika consumer tolerant;
4. perluas payload tanpa menghapus field lama.

### 21.2 Breaking Changes

Berbahaya:

1. rename field;
2. hapus field;
3. ubah meaning field;
4. ubah type field;
5. ubah unit waktu/uang;
6. ubah semantic event;
7. ubah id format tanpa compatibility.

### 21.3 Versioning Strategy

Pilihan:

```text
ApplicationSubmittedV1
ApplicationSubmittedV2
```

atau:

```json
{
  "eventType": "ApplicationSubmitted",
  "eventVersion": 2
}
```

Untuk organisasi besar, kombinasi eventType + version biasanya lebih eksplisit.

### 21.4 Tolerant Reader

Consumer harus mengabaikan field yang tidak dikenal.

### 21.5 Strict Writer

Producer harus hanya mengirim schema yang valid dan terdokumentasi.

---

## 22. Event Schema Design Rules

### 22.1 Gunakan Stable Business Identifiers

Buruk:

```json
{
  "applicationDatabasePk": 918273
}
```

Lebih baik:

```json
{
  "applicationId": "APP-2026-000123"
}
```

### 22.2 Jangan Kirim Internal Entity Graph

Buruk:

```json
{
  "application": {
    "hibernateLazyInitializer": {},
    "documents": [...],
    "auditTrails": [...],
    "applicant": {...}
  }
}
```

Lebih baik kirim DTO eksplisit.

### 22.3 Hindari Ambiguous Boolean

Buruk:

```json
{
  "valid": true
}
```

Lebih baik:

```json
{
  "verificationResult": "PASSED"
}
```

### 22.4 Simpan Unit Secara Eksplisit

Buruk:

```json
{
  "amount": 1000
}
```

Lebih baik:

```json
{
  "amount": "1000.00",
  "currency": "SGD"
}
```

### 22.5 Waktu Harus Jelas

Gunakan `Instant`/UTC untuk machine time.

```json
{
  "submittedAt": "2026-06-19T10:15:30Z"
}
```

Jika local business date penting, kirim eksplisit:

```json
{
  "effectiveDate": "2026-06-19",
  "businessTimezone": "Asia/Singapore"
}
```

---

## 23. Event Topics and Routing

Topic design memengaruhi coupling.

### 23.1 Topic per Service

```text
application.events
case.events
payment.events
```

Kelebihan:

1. sederhana;
2. ownership jelas;
3. consumer subscribe berdasarkan source.

Kekurangan:

1. consumer harus filter banyak event;
2. topic bisa terlalu ramai.

### 23.2 Topic per Event Type

```text
application-submitted
application-approved
application-rejected
```

Kelebihan:

1. consumer lebih selektif;
2. filtering mudah.

Kekurangan:

1. topic explosion;
2. governance lebih berat;
3. rollout event baru lebih ribet.

### 23.3 Topic per Domain Area

```text
application.lifecycle.events
application.document.events
case.lifecycle.events
```

Sering menjadi kompromi baik.

### 23.4 Routing Key

Untuk broker seperti RabbitMQ:

```text
application.submitted
application.approved
case.escalated
payment.confirmed
```

Untuk log/stream seperti Kafka, partition key lebih penting:

```text
partitionKey = aggregateId
```

---

## 24. Event Ownership

Setiap event harus punya owner.

Owner bertanggung jawab atas:

1. semantic event;
2. schema;
3. compatibility;
4. documentation;
5. deprecation;
6. data classification;
7. publish reliability;
8. consumer communication;
9. SLO event publication.

Anti-pattern:

```text
"Ini event bersama, tidak ada yang punya."
```

Itu biasanya awal event graveyard.

---

## 25. Consumer Ownership

Consumer bertanggung jawab atas:

1. idempotency;
2. retry handling;
3. poison message handling;
4. projection correctness;
5. lag monitoring;
6. replay safety;
7. compatibility dengan versi event;
8. own side effects;
9. own error recovery.

Producer tidak boleh dipaksa tahu semua consumer.

Namun governance tetap perlu mengetahui consumer kritikal.

---

## 26. Hidden Coupling dalam Event-Driven Architecture

Event-driven sering terlihat decoupled, tetapi coupling tetap ada.

Jenis coupling:

### 26.1 Schema Coupling

Consumer bergantung pada field event.

### 26.2 Semantic Coupling

Consumer bergantung pada arti event.

Contoh:

```text
ApplicationApproved berarti license pasti aktif?
```

Belum tentu.

### 26.3 Temporal Coupling

Consumer mengasumsikan event datang cepat.

### 26.4 Ordering Coupling

Consumer mengasumsikan event selalu berurutan.

### 26.5 Availability Coupling

Producer mengasumsikan broker selalu tersedia.

### 26.6 Organizational Coupling

Banyak team bergantung pada perubahan event yang sama.

Top-tier engineer tidak berkata “event decouples everything”. Mereka bertanya:

```text
Coupling jenis apa yang berpindah?
Apakah coupling itu lebih mudah dikelola?
```

---

## 27. Event Soup Anti-Pattern

Event soup terjadi ketika sistem penuh event tetapi tidak ada model konseptual yang jelas.

Gejala:

1. event name ambigu;
2. topic tidak punya owner;
3. consumer tidak terdokumentasi;
4. event dipakai untuk banyak meaning berbeda;
5. tidak ada schema governance;
6. tidak ada lifecycle/deprecation;
7. replay tidak aman;
8. event chain sulit dilacak;
9. producer takut mengubah event;
10. semua orang subscribe semua topic.

Solusi:

1. event catalog;
2. event owner;
3. schema registry/governance;
4. naming convention;
5. compatibility rules;
6. consumer inventory;
7. event lifecycle policy;
8. architecture review untuk event publik;
9. observability per event type;
10. clear domain boundaries.

---

## 28. Event Catalog

Event catalog adalah dokumentasi hidup event publik.

Minimal berisi:

```text
Event name
Owner service
Business meaning
When emitted
When not emitted
Payload schema
Version history
Data classification
Ordering key
Retention policy
Known consumers
Replay safety
Deprecation status
Example payload
```

Contoh ringkas:

```yaml
event: ApplicationSubmitted
owner: application-service
version: 1
meaning: Applicant has formally submitted an application for processing.
emitted_when:
  - application status transitions from DRAFT to SUBMITTED
not_emitted_when:
  - draft autosave occurs
  - submitted application metadata is corrected
partition_key: applicationId
data_classification: confidential
replay_safe_consumers:
  - reporting-service
  - search-service
known_side_effect_consumers:
  - notification-service
```

---

## 29. Event-Driven Auditability

Event-driven architecture bisa memperkuat audit, tetapi event bukan otomatis audit trail.

### 29.1 Event

Event adalah business fact untuk integration/coordination.

### 29.2 Audit Record

Audit record adalah evidence untuk accountability.

Audit record biasanya butuh:

1. actor;
2. role/capacity;
3. before/after jika relevan;
4. timestamp;
5. source IP/device jika relevan;
6. reason/remarks;
7. authority basis;
8. correlation id;
9. immutable storage policy.

### 29.3 Event Bisa Menjadi Input Audit

Tetapi jangan menganggap semua event memenuhi standar audit.

Contoh:

```text
ApplicationApproved event:
    useful for integration

Approval audit record:
    who approved, under what authority, what changed,
    what evidence was considered, remarks, timestamp, source
```

---

## 30. Event-Driven Regulatory Lifecycle Example

Misal domain regulatory application.

### 30.1 Lifecycle

```text
DRAFT
SUBMITTED
UNDER_SCREENING
PENDING_CLARIFICATION
UNDER_REVIEW
APPROVED
REJECTED
WITHDRAWN
EXPIRED
```

### 30.2 Events

```text
ApplicationDraftCreated
ApplicationSubmitted
ScreeningRequested
ScreeningCompleted
ClarificationRequested
ClarificationSubmitted
ReviewStarted
ApplicationApproved
ApplicationRejected
ApplicationWithdrawn
ApplicationExpired
```

### 30.3 Consumers

| Event | Consumer | Reaction |
|---|---|---|
| ApplicationSubmitted | Case Service | create case if absent |
| ApplicationSubmitted | Notification Service | send confirmation request |
| ApplicationSubmitted | Reporting Service | update submitted count |
| ScreeningCompleted | Review Service | unlock review step |
| ClarificationRequested | Notification Service | notify applicant |
| ApplicationApproved | License Service | issue license if rule allows |
| ApplicationApproved | Audit Service | record approval event evidence |
| ApplicationRejected | Reporting Service | update rejection metrics |

### 30.4 Design Observation

`ApplicationSubmitted` is a fact.

`CreateCase` is a command.

`SendConfirmationEmail` is a command or internal notification request.

Mixing them causes semantic confusion.

---

## 31. Java 8–25 Considerations

### 31.1 Java 8

Java 8 masih banyak di enterprise legacy.

Consideration:

1. tidak ada record;
2. DTO event manual dengan final fields/getters;
3. gunakan `Instant` dari `java.time`;
4. CompletableFuture tersedia tetapi hati-hati executor;
5. no virtual threads;
6. framework version terbatas.

Contoh DTO Java 8 style:

```java
public final class ApplicationSubmittedV1 {
    private final String eventId;
    private final String applicationId;
    private final String applicationType;
    private final Instant submittedAt;

    public ApplicationSubmittedV1(
            String eventId,
            String applicationId,
            String applicationType,
            Instant submittedAt) {
        this.eventId = Objects.requireNonNull(eventId);
        this.applicationId = Objects.requireNonNull(applicationId);
        this.applicationType = Objects.requireNonNull(applicationType);
        this.submittedAt = Objects.requireNonNull(submittedAt);
    }

    public String getEventId() {
        return eventId;
    }

    public String getApplicationId() {
        return applicationId;
    }

    public String getApplicationType() {
        return applicationType;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }
}
```

### 31.2 Java 11

Java 11 memberi baseline LTS modern awal.

Consideration:

1. HTTP Client standar tersedia;
2. masih tanpa record;
3. migration target baik dari Java 8;
4. banyak platform enterprise mendukung.

### 31.3 Java 17

Java 17 sangat nyaman untuk event DTO.

```java
public record ApplicationSubmittedV1(
        String eventId,
        String applicationId,
        String applicationType,
        Instant submittedAt
) {}
```

Record bagus untuk immutable DTO, tetapi tetap hati-hati:

1. jangan expose domain internal;
2. jangan jadikan record sebagai schema governance satu-satunya;
3. JSON compatibility tetap harus diuji.

### 31.4 Java 21

Java 21 membawa virtual threads sebagai fitur stabil.

Virtual threads berguna untuk consumer blocking I/O:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Message message : batch) {
        executor.submit(() -> handler.handle(message));
    }
}
```

Namun virtual threads bukan pengganti backpressure.

Jika broker memberi 100.000 message dan setiap handler membuka DB connection, bottleneck tetap DB/pool/external service.

### 31.5 Java 25

Java 25 adalah latest generation Java setelah Java 21 LTS. Untuk microservices, pertimbangan utamanya bukan hanya syntax baru, tetapi:

1. runtime behavior;
2. GC improvements;
3. container ergonomics;
4. structured concurrency evolution;
5. framework compatibility;
6. observability agent compatibility;
7. production support policy.

Rule praktis:

```text
Use Java 17/21 as conservative enterprise baseline.
Use Java 25 when platform, framework, CI/CD, monitoring, and support model are ready.
```

---

## 32. Java Event Type Design

### 32.1 Event Interface

```java
public interface IntegrationEvent {
    String eventId();
    String eventType();
    int eventVersion();
    String aggregateId();
    long aggregateVersion();
    String correlationId();
    String causationId();
    Instant occurredAt();
}
```

### 32.2 Event Record

```java
public record ApplicationSubmittedV1(
        String eventId,
        String aggregateId,
        long aggregateVersion,
        String correlationId,
        String causationId,
        Instant occurredAt,
        String applicantId,
        String applicationType,
        Instant submittedAt
) implements IntegrationEvent {

    @Override
    public String eventType() {
        return "ApplicationSubmitted";
    }

    @Override
    public int eventVersion() {
        return 1;
    }
}
```

### 32.3 Avoid Magic String Everywhere

```java
public final class EventTypes {
    private EventTypes() {}

    public static final String APPLICATION_SUBMITTED = "ApplicationSubmitted";
    public static final String APPLICATION_APPROVED = "ApplicationApproved";
}
```

Untuk sistem besar, event catalog/schema registry lebih penting daripada constants.

---

## 33. Event Handler Design

Handler harus kecil, idempotent, observable, dan transactionally safe.

```java
public final class ApplicationSubmittedHandler {
    private final InboxRepository inbox;
    private final CaseRepository cases;
    private final TransactionRunner tx;

    public void handle(ApplicationSubmittedV1 event) {
        tx.run(() -> {
            if (inbox.exists(event.eventId())) {
                return;
            }

            cases.createIfAbsent(
                event.aggregateId(),
                event.applicantId(),
                event.applicationType()
            );

            inbox.markProcessed(
                event.eventId(),
                event.eventType(),
                event.occurredAt()
            );
        });
    }
}
```

### 33.1 Handler Rule

```text
Acknowledge message only after durable processing state is committed.
```

Jika acknowledge dulu lalu DB commit gagal, event hilang secara efektif.

Jika commit dulu lalu ack gagal, event bisa diproses ulang. Karena itu idempotency wajib.

---

## 34. Projection Design

Projection adalah read model hasil consume event.

Contoh table:

```sql
CREATE TABLE application_listing_projection (
    application_id      VARCHAR(64) PRIMARY KEY,
    applicant_id        VARCHAR(64) NOT NULL,
    application_type    VARCHAR(64) NOT NULL,
    status              VARCHAR(64) NOT NULL,
    submitted_at        TIMESTAMP NULL,
    last_event_id       VARCHAR(128) NOT NULL,
    last_event_version  BIGINT NOT NULL,
    updated_at          TIMESTAMP NOT NULL
);
```

Handler:

```java
void on(ApplicationSubmittedV1 event) {
    projection.upsertSubmitted(
        event.aggregateId(),
        event.applicantId(),
        event.applicationType(),
        event.submittedAt(),
        event.eventId(),
        event.aggregateVersion()
    );
}
```

### 34.1 Projection Freshness

Projection harus punya metadata:

```text
last_event_id
last_event_occurred_at
last_processed_at
lag_seconds
source_partition
source_offset
```

Ini membantu debugging “kenapa data belum muncul?”

---

## 35. Error Handling in Event-Driven Architecture

Jenis error:

### 35.1 Transient Error

Contoh:

```text
DB timeout
network hiccup
temporary broker issue
external API temporarily unavailable
```

Strategi:

```text
retry with backoff and jitter
```

### 35.2 Permanent Error

Contoh:

```text
invalid schema
unknown enum value not tolerated
missing mandatory business field
unauthorized tenant
```

Strategi:

```text
dead-letter / parking lot / manual correction
```

### 35.3 Semantic Error

Contoh:

```text
ApplicationApproved received but local projection never saw ApplicationSubmitted
```

Strategi:

```text
park event, fetch missing state, replay, or trigger reconciliation
```

### 35.4 Poison Message

Poison message adalah message yang selalu gagal diproses.

Jangan retry selamanya.

Gunakan:

1. retry limit;
2. exponential backoff;
3. dead-letter topic/queue;
4. alert;
5. diagnostic context;
6. replay tool after fix.

---

## 36. Observability for Event-Driven Systems

Observability minimal:

### 36.1 Metrics

```text
events_published_total{event_type, source}
events_consumed_total{event_type, consumer}
event_handler_failures_total{event_type, consumer, reason}
event_processing_duration_seconds{event_type, consumer}
event_lag_seconds{event_type, consumer}
dead_letter_messages_total{event_type, consumer}
replay_events_total{event_type, consumer}
```

### 36.2 Logs

Log harus include:

```text
eventId
eventType
eventVersion
aggregateId
correlationId
causationId
consumerName
partition/offset atau queue/message id
processing result
```

### 36.3 Traces

Trace harus menghubungkan:

```text
HTTP command
    -> database transaction
        -> outbox record
            -> event publish
                -> consumer handler
                    -> projection update / side effect
```

### 36.4 Business Observability

Tidak cukup hanya technical metrics.

Contoh:

```text
applications_submitted_total
cases_created_from_application_total
application_to_case_creation_lag_seconds
screening_completed_total
approval_event_to_license_issue_lag_seconds
```

---

## 37. Security and Privacy

Event sering menyebarkan data ke banyak consumer. Ini risiko besar.

### 37.1 Data Minimization

Jangan kirim field yang tidak diperlukan consumer.

### 37.2 Classification

Tandai event:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
PII
SENSITIVE
```

### 37.3 Authorization

Consumer harus diizinkan subscribe event tertentu.

### 37.4 Encryption

Pertimbangkan:

1. encryption in transit;
2. encryption at rest;
3. field-level encryption untuk payload sensitif;
4. key rotation;
5. broker ACL.

### 37.5 Retention

Event retention harus sesuai policy.

Event log bukan tempat bebas menyimpan PII selamanya.

### 37.6 Redaction and Erasure

Jika event immutable, privacy request menjadi sulit.

Strategi:

1. jangan taruh PII yang tidak perlu;
2. gunakan reference id;
3. tokenization;
4. crypto-shredding;
5. redaction event;
6. separate sensitive store.

---

## 38. Governance Model

Event-driven architecture tanpa governance akan rusak pelan-pelan.

Minimal governance:

1. event naming standard;
2. event catalog;
3. schema compatibility check;
4. event owner;
5. consumer registration;
6. data classification;
7. deprecation policy;
8. replay policy;
9. dead-letter process;
10. production readiness review.

### 38.1 Deprecation Policy

Contoh:

```text
1. Producer announces ApplicationSubmittedV2.
2. V1 and V2 published in parallel for migration window.
3. Consumers migrate to V2.
4. Monitoring verifies no V1 consumption.
5. V1 marked deprecated.
6. V1 removed after agreed date.
```

---

## 39. Event-Driven Architecture Decision Matrix

| Question | Prefer Event-Driven | Prefer Sync/Other |
|---|---|---|
| Banyak consumer perlu bereaksi pada fakta yang sama? | Ya | Tidak |
| Producer harus independent dari consumer? | Ya | Tidak |
| Consumer bisa tolerate delay? | Ya | Tidak |
| Butuh projection/read model async? | Ya | Tidak |
| Butuh audit/replay? | Mungkin | Tidak selalu |
| Perlu immediate consistent response? | Tidak | Ya |
| Side effect irreversible? | Hati-hati | Orchestrate/guard |
| Team siap observability dan replay? | Ya | Tidak |
| Schema governance matang? | Ya | Tidak |
| Domain event meaningful? | Ya | Tidak |

---

## 40. Kapan Event-Driven Architecture Tepat

Gunakan EDA jika:

1. banyak service perlu bereaksi pada business fact yang sama;
2. producer dan consumer harus deploy independently;
3. proses tidak harus selesai dalam satu request;
4. read model bisa eventually consistent;
5. event dapat menjadi kontrak domain yang stabil;
6. sistem butuh audit/history/replay;
7. beban kerja cocok untuk asynchronous processing;
8. consumer bisa idempotent;
9. tim punya observability dan operational maturity.

---

## 41. Kapan Event-Driven Architecture Berbahaya

Hindari atau batasi EDA jika:

1. proses harus immediate dan strongly consistent;
2. domain belum dipahami;
3. event name masih generic `SomethingChanged`;
4. tidak ada owner event;
5. tidak ada schema governance;
6. consumer tidak idempotent;
7. replay tidak direncanakan;
8. DLQ tidak dimonitor;
9. tim tidak bisa debug distributed flow;
10. EDA hanya dipilih karena “Kafka sedang populer”.

---

## 42. Anti-Patterns

### 42.1 Command Masquerading as Event

```text
SendEmailEvent
CreateInvoiceEvent
UpdateSearchIndexEvent
```

Ini command, bukan event.

### 42.2 Generic Update Event

```text
ApplicationUpdated
UserChanged
CaseModified
```

Terlalu ambiguous.

### 42.3 Event as Database Row Dump

Mengirim seluruh entity/table row sebagai event.

Masalah:

1. schema internal bocor;
2. consumer coupling tinggi;
3. privacy risk;
4. evolusi sulit.

### 42.4 Event Chain Without Owner

```text
A happened -> B reacts -> C reacts -> D reacts -> E reacts
```

Tidak ada yang tahu business process end-to-end.

### 42.5 Replay-Unsafe Handler

Handler mengirim email/payment setiap replay.

### 42.6 No Idempotency

Consumer menganggap event hanya datang sekali.

### 42.7 Infinite Retry

Poison message diretry selamanya dan menahan partition/queue.

### 42.8 Event-Driven Distributed Monolith

Semua service harus deploy bersama karena event schema berubah sembarangan.

### 42.9 Broker as Database

Menganggap broker retention sebagai source of truth tanpa lifecycle, compaction, governance, dan recovery design yang jelas.

### 42.10 Over-Eventing

Semua field update menjadi event publik.

---

## 43. Production Readiness Checklist

Sebelum event dipublikasikan ke production, jawab:

### 43.1 Semantic

- [ ] Event name business meaningful.
- [ ] Event merepresentasikan fakta yang sudah terjadi.
- [ ] Event bukan command tersembunyi.
- [ ] Event memiliki owner.
- [ ] Kondisi kapan event emitted jelas.
- [ ] Kondisi kapan event tidak emitted jelas.

### 43.2 Schema

- [ ] Schema terdokumentasi.
- [ ] Event version ada.
- [ ] Field required/optional jelas.
- [ ] Enum evolution dipikirkan.
- [ ] Unknown field tolerant.
- [ ] Breaking change policy ada.

### 43.3 Delivery

- [ ] Publish reliability didesain.
- [ ] Outbox/event sourcing/CDC strategy jelas.
- [ ] Partition/routing key jelas.
- [ ] Ordering expectation jelas.
- [ ] Duplicate delivery diasumsikan.

### 43.4 Consumer

- [ ] Consumer idempotent.
- [ ] Handler transactional boundary jelas.
- [ ] Ack setelah durable processing.
- [ ] Retry policy jelas.
- [ ] DLQ/parking lot jelas.
- [ ] Replay behavior jelas.

### 43.5 Observability

- [ ] Publish count metric.
- [ ] Consume count metric.
- [ ] Handler failure metric.
- [ ] Lag metric.
- [ ] DLQ alert.
- [ ] Correlation id propagated.
- [ ] Trace continuity ada.

### 43.6 Security

- [ ] Data classification jelas.
- [ ] PII minimization dilakukan.
- [ ] Consumer authorization jelas.
- [ ] Retention policy jelas.
- [ ] Encryption requirement jelas.

### 43.7 Operations

- [ ] Replay tool ada atau rencana jelas.
- [ ] Backfill strategy ada.
- [ ] Poison message procedure ada.
- [ ] Consumer lag runbook ada.
- [ ] Schema rollback strategy ada.
- [ ] Deprecation process ada.

---

## 44. Architecture Review Questions

Gunakan pertanyaan berikut dalam review desain:

1. Fakta bisnis apa yang direpresentasikan event ini?
2. Siapa owner event ini?
3. Apakah event ini command terselubung?
4. Apakah nama event cukup spesifik?
5. Siapa consumer sekarang?
6. Siapa consumer potensial di masa depan?
7. Apakah producer tahu terlalu banyak tentang consumer?
8. Apa partition/routing key?
9. Apa ordering guarantee yang benar-benar dibutuhkan?
10. Apa yang terjadi jika event duplicate?
11. Apa yang terjadi jika event terlambat?
12. Apa yang terjadi jika event out-of-order?
13. Apa yang terjadi jika event hilang?
14. Apakah event bisa direplay?
15. Apakah handler replay-safe?
16. Apakah ada side effect irreversible?
17. Apakah schema bisa evolve tanpa breaking consumer?
18. Apakah event membawa PII?
19. Berapa retention event?
20. Apa alert jika consumer lag?
21. Apa runbook jika DLQ penuh?
22. Apa business impact jika projection stale?
23. Apakah user experience menerima eventual consistency?
24. Apakah ada reconciliation process?
25. Apakah event ini benar-benar perlu publik?

---

## 45. Mini Case Study: Application Approval Flow

### 45.1 Requirement

Ketika application disubmit:

1. applicant mendapat confirmation;
2. case dibuat;
3. risk screening dimulai;
4. dashboard officer terupdate;
5. audit evidence tersimpan;
6. jika screening selesai, officer bisa review;
7. jika approved, license diterbitkan.

### 45.2 Naive Synchronous Design

```text
Application Service
    -> Notification Service
    -> Case Service
    -> Risk Service
    -> Reporting Service
    -> Audit Service
```

Masalah:

1. submission latency tinggi;
2. failure satu dependency menggagalkan submit;
3. retry rumit;
4. coupling tinggi;
5. scaling sulit.

### 45.3 Better Event-Driven Design

```text
Application Service commits SUBMITTED
Application Service writes outbox ApplicationSubmitted
Outbox Relay publishes ApplicationSubmitted

Case Service consumes -> create case if absent
Notification Service consumes -> create notification request if absent
Risk Service consumes -> start screening workflow
Reporting Service consumes -> update projection
Audit Service consumes -> append evidence/audit view
```

### 45.4 Important Detail

Notifikasi bukan alasan utama event. Event utamanya adalah:

```text
ApplicationSubmitted
```

Notifikasi hanyalah salah satu reaksi.

### 45.5 Approval

```text
ApplicationApproved
    -> License Service issues license
    -> Notification Service sends approval notice
    -> Reporting Service updates approval count
    -> Audit Service records approval evidence
```

Jika license issuance adalah langkah wajib dengan compensation/SLA ketat, mungkin perlu orchestration/process manager, bukan choreography murni.

---

## 46. Mental Model Ringkas

Event-driven architecture adalah tentang:

```text
Facts, not instructions.
Ownership, not shared chaos.
Contracts, not object dumps.
Autonomy, not invisible coupling.
Replay, not accidental side effects.
Eventual consistency, not hidden inconsistency.
Observability, not blind async processing.
Governance, not event soup.
```

---

## 47. Practical Exercises

### Exercise 1 — Classify Messages

Klasifikasikan sebagai event, command, document, atau notification:

```text
ApplicationSubmitted
SendWelcomeEmail
CaseAssigned
CreateInvoice
PaymentReceiptGenerated
UserProfileSnapshot
UpdateSearchIndex
LicenseSuspended
```

### Exercise 2 — Improve Event Names

Ubah event buruk berikut:

```text
ApplicationUpdated
UserChanged
EmailEvent
CaseProcessed
StatusChanged
```

Menjadi event domain yang lebih meaningful.

### Exercise 3 — Design Event Envelope

Buat schema event untuk:

```text
ClarificationRequested
```

Sertakan:

1. eventId;
2. eventType;
3. eventVersion;
4. aggregateId;
5. aggregateVersion;
6. correlationId;
7. causationId;
8. actor;
9. occurredAt;
10. payload.

### Exercise 4 — Replay Safety Review

Untuk event `ApplicationApproved`, daftar consumer:

1. License Service;
2. Notification Service;
3. Reporting Service;
4. Audit Service.

Tentukan mana yang replay-safe dan mana yang butuh guard.

### Exercise 5 — Eventual Consistency UX

Desain UX untuk kondisi:

```text
User submit application, tetapi listing dashboard async projection belum update selama 5 detik.
```

---

## 48. Summary

Event-driven architecture bukan tentang mengganti HTTP dengan Kafka/RabbitMQ. EDA adalah cara mendesain sistem di sekitar fakta domain yang dipublikasikan dan dikonsumsi lintas boundary.

Hal paling penting:

1. Event adalah fakta, bukan command.
2. Event harus punya owner dan semantic jelas.
3. Event schema adalah kontrak publik.
4. Consumer harus idempotent.
5. Duplicate, delay, dan out-of-order adalah kondisi normal.
6. Replay hanya aman jika dirancang.
7. Eventual consistency harus diterima dan dijelaskan ke UX/business.
8. Choreography cocok untuk reaksi independen.
9. Orchestration cocok untuk proses eksplisit dengan SLA/compensation.
10. Event-driven tanpa governance akan berubah menjadi event soup.

Top 1% engineer tidak hanya bertanya:

```text
Broker apa yang dipakai?
```

Mereka bertanya:

```text
Fakta domain apa yang terjadi?
Siapa owner-nya?
Apa invariant-nya?
Apa contract-nya?
Apa failure mode-nya?
Apa replay behavior-nya?
Apa privacy impact-nya?
Apa operational runbook-nya?
```

---

## 49. Referensi

1. Martin Fowler — *What do you mean by “Event-Driven”?*  
   https://martinfowler.com/articles/201701-event-driven.html

2. Microservices.io — *Pattern: Domain Event*  
   https://microservices.io/patterns/data/domain-event.html

3. Microservices.io — *Pattern: Event Sourcing*  
   https://microservices.io/patterns/data/event-sourcing.html

4. Microservices.io — *Pattern: Saga*  
   https://microservices.io/patterns/data/saga.html

5. Azure Architecture Center — *Event-driven architecture style*  
   https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven

6. Azure Architecture Center — *Event Sourcing pattern*  
   https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing

7. AWS Prescriptive Guidance — *Event sourcing pattern*  
   https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing.html

8. Michiel Overeem, Marten Spoor, Slinger Jansen, Sjaak Brinkkemper — *An Empirical Characterization of Event Sourced Systems and Their Schema Evolution — Lessons from Industry*  
   https://arxiv.org/abs/2104.01146

---

## 50. Status Seri

Part ini adalah **Part 7 dari 35**.

Seri belum selesai.

Part berikutnya:

```text
Part 8 — Transaction Pattern: Local Transaction, Saga, and Compensation
```

File berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-08-transaction-saga-compensation.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-06-asynchronous-messaging.md">⬅️ Part 6 — Communication Pattern: Asynchronous Messaging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-08-transaction-saga-compensation.md">Part 8 — Transaction Pattern: Local Transaction, Saga, and Compensation ➡️</a>
</div>
