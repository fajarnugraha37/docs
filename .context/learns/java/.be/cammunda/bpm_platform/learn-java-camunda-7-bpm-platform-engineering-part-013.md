# learn-java-camunda-7-bpm-platform-engineering-part-013.md

# Part 013 — Message Correlation, Signal, Event, Business Key, dan Race Condition Control

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `013`  
> Topik: Message correlation, signal, event subscription, business key, dan race condition control di Camunda 7  
> Target pembaca: Java engineer senior/principal yang ingin memahami Camunda 7 sebagai durable event-driven process runtime, bukan hanya BPMN executor.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas beberapa fondasi penting:

1. **Camunda 7 engine bukan thread/process daemon aktif yang terus mendorong proses.** Engine pasif dan berjalan ketika dipanggil API, job executor, REST, task completion, message correlation, atau trigger lain.
2. **Wait state adalah durability boundary.** Ketika execution mencapai user task, receive task, intermediate catch event, timer, external task, atau async continuation, state disimpan ke database.
3. **Async continuation menciptakan job boundary.** Ini memecah transaction dan retry scope.
4. **External Task adalah pull-based work item.** Worker mengambil task via fetch-and-lock.
5. **Service invocation pattern harus dipilih berdasarkan ownership retry, idempotency, coupling, dan failure semantics.**

Part ini membahas bentuk event-driven yang paling sering salah dipahami di Camunda 7:

- message event,
- signal event,
- event subscription,
- business key,
- correlation key,
- message start event,
- intermediate catch message,
- event subprocess,
- race condition antara external event dan process wait state,
- idempotency untuk event ingestion,
- ambiguity correlation,
- dan desain event bridge yang aman.

Materi ini tidak bertujuan mengulang definisi dasar BPMN event. Fokus kita adalah **engineering correctness**.

---

## 1. Mental Model Utama

Kalau ada satu kalimat yang harus diingat:

> **Message correlation di Camunda 7 bukan publish-subscribe queue. Ia adalah operasi pencarian dan trigger terhadap subscription yang sudah ada di database engine.**

Ini berarti:

- Camunda 7 tidak otomatis menyimpan semua message eksternal yang datang terlalu awal.
- Message correlation membutuhkan target yang match.
- Target bisa berupa:
  - process definition dengan message start event,
  - atau execution yang sedang menunggu message.
- Jika tidak ada target yang cocok, correlation gagal.
- Jika target terlalu banyak dan API yang dipakai mengharapkan satu target, correlation juga bisa gagal.
- Kalau external system mengirim event dua kali, Camunda bisa mencoba memproses dua kali kecuali kita desain idempotency.

Jadi event handling di Camunda 7 adalah gabungan dari:

```text
External Event
  -> Event Ingestion Layer
  -> Correlation Key Resolution
  -> Idempotency / Deduplication
  -> RuntimeService Message Correlation
  -> Engine Transaction
  -> Execution Continues
  -> New Wait State / End / Job / Incident
```

Bukan:

```text
External Event
  -> Camunda queue magically buffers everything
  -> Process eventually receives it exactly once
```

Camunda 7 bisa menjadi bagian dari event-driven architecture, tetapi ia bukan Kafka, RabbitMQ, JMS broker, atau event store.

---

## 2. Vocabulary Yang Harus Dibedakan

Sebelum masuk teknis, kita perlu memisahkan beberapa istilah yang sering tertukar.

### 2.1 Message

Dalam BPMN/Camunda 7, message adalah event bernama yang diarahkan ke satu penerima logis.

Message punya:

- `message name`,
- optional payload via variables saat correlation,
- target matching via business key, correlation key, process instance id, tenant id, atau process definition.

Contoh message name:

```text
PaymentReceived
ApplicationSubmitted
InspectionResultUploaded
LicenseRevocationConfirmed
DocumentSigned
```

Message **bukan** queue message secara otomatis. Message adalah konsep BPMN dan correlation API.

### 2.2 Signal

Signal adalah broadcast event.

Perbedaannya sangat penting:

```text
Message = one sender -> one intended receiver
Signal  = one sender -> many possible receivers
```

Signal cocok untuk kejadian global seperti:

- emergency stop,
- refresh policy,
- broadcast maintenance notice,
- global cancellation marker,
- “all matching process instances should react”.

Tetapi signal berbahaya jika dipakai untuk event yang sebenarnya milik satu case/application.

### 2.3 Event Subscription

Event subscription adalah catatan runtime bahwa execution sedang menunggu event tertentu.

Secara database, event subscription disimpan di tabel seperti:

```text
ACT_RU_EVENT_SUBSCR
```

Subscription bisa untuk:

- message,
- signal,
- compensation,
- conditional event,
- dan bentuk event lain yang diimplementasikan engine.

Saat process instance mencapai intermediate catch message atau boundary message event, engine membuat event subscription. Saat message berhasil dicorrelate, subscription dikonsumsi/dipakai untuk melanjutkan execution.

### 2.4 Business Key

Business key adalah identifier bisnis dari process instance.

Contoh:

```text
applicationId = APP-2026-00001821
caseNo        = CASE-ENF-2026-00411
appealNo      = APPL-2026-00031
paymentRef    = PAY-9938812
```

Dalam Camunda 7, business key bukan primary key database. Ia adalah metadata process instance yang sangat berguna untuk correlation, search, audit, dan operator diagnostics.

Business key sebaiknya:

- stabil,
- unik dalam domain yang relevan,
- tidak berubah sepanjang process instance,
- bukan data sensitif mentah,
- tidak terlalu panjang,
- dan dipakai konsisten.

### 2.5 Correlation Key

Correlation key adalah kriteria untuk menemukan target event subscription.

Correlation key bisa berupa:

- business key,
- process instance id,
- variable value,
- local variable value,
- tenant id,
- process definition key,
- message name.

Business key sering menjadi correlation key, tetapi tidak semua correlation key adalah business key.

### 2.6 Idempotency Key

Idempotency key adalah identifier event/command eksternal untuk mencegah double processing.

Contoh:

```text
sourceSystem = payment-gateway
eventId      = evt_20260620_998281
businessKey  = APP-2026-00001821
messageName  = PaymentReceived
```

Idempotency key sebaiknya tidak hanya `businessKey`, karena satu business case bisa menerima banyak event berbeda.

Format yang lebih aman:

```text
idempotencyKey = sourceSystem + ':' + eventType + ':' + eventId
```

atau:

```text
idempotencyKey = sourceSystem + ':' + messageName + ':' + businessKey + ':' + externalVersion
```

---

## 3. Message Event Di Camunda 7

Camunda 7 mendukung beberapa bentuk message event BPMN:

1. **Message Start Event**
2. **Intermediate Catch Message Event**
3. **Boundary Message Event**
4. **Event Subprocess Message Start Event**
5. **Intermediate Throw Message Event**
6. **Message End Event**

Namun dalam praktik engineering, yang paling penting untuk runtime correlation adalah:

- message start event,
- intermediate catch message event,
- boundary message event,
- event subprocess message start event.

### 3.1 Message Start Event

Message start event memungkinkan process instance dimulai ketika message tertentu diterima.

Mental model:

```text
Message correlated
  -> engine mencari process definition terbaru yang punya message start event dengan message name cocok
  -> engine membuat process instance baru
  -> business key dan variables dapat diset saat start
```

Contoh penggunaan:

```text
External system sends ApplicationSubmitted
  -> Camunda starts ApplicationReview process
```

Kelebihan:

- cocok untuk event yang memang memulai lifecycle,
- mengurangi kebutuhan endpoint start-process custom,
- event-driven secara natural.

Risiko:

- duplicate external event bisa membuat duplicate process instance kalau tidak ada deduplication,
- message name harus stabil,
- tenant/process definition ambiguity harus dikontrol,
- versioning harus dipahami.

### 3.2 Intermediate Catch Message Event

Intermediate catch message membuat process instance berhenti dan menunggu event tertentu.

Contoh:

```text
Submit Application
  -> Wait for PaymentReceived
  -> Continue Processing
```

Ketika token mencapai catch event:

```text
1. execution mencapai wait state
2. engine membuat event subscription
3. transaction commit
4. process instance sekarang benar-benar menunggu message
```

External system lalu memanggil correlation:

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey(applicationId)
    .setVariable("paymentStatus", "PAID")
    .setVariable("paymentReference", paymentReference)
    .correlate();
```

Jika target ditemukan, execution lanjut dari catch event.

### 3.3 Boundary Message Event

Boundary message event menempel pada activity, biasanya user task atau subprocess.

Contoh:

```text
Wait for Officer Review
  boundary message: ApplicantWithdrawn
```

Jika message datang saat activity aktif:

- interrupting boundary event akan membatalkan activity yang ditempeli,
- non-interrupting boundary event akan membuat jalur tambahan tanpa membatalkan activity utama.

Boundary message sangat berguna untuk:

- applicant withdraw,
- cancellation,
- external update,
- document received while waiting for manual review,
- regulator override.

Tetapi perlu hati-hati:

- interrupting vs non-interrupting mengubah execution tree,
- event hanya aktif selama activity host aktif,
- jika event datang setelah task selesai, subscription sudah hilang,
- jika event datang sebelum task aktif, subscription belum ada.

### 3.4 Event Subprocess Message Start

Event subprocess menangkap event di dalam scope process/subprocess.

Contoh:

```text
Main Process: Application Processing
Event Subprocess: ApplicantWithdrawn
```

Ini berbeda dari boundary event karena event subprocess ditempatkan dalam scope dan bisa menjadi cross-cutting reaction terhadap message selama scope aktif.

Penggunaan yang cocok:

- cancellation,
- complaint received,
- urgent escalation,
- fraud alert,
- regulator intervention,
- external legal hold.

Interrupting event subprocess dapat menghentikan main flow. Non-interrupting event subprocess dapat berjalan paralel.

---

## 4. Message Correlation API Mental Model

Camunda 7 menyediakan fluent API melalui `RuntimeService#createMessageCorrelation`.

Contoh dasar:

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey("APP-2026-00001821")
    .correlate();
```

Dengan variables:

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey("APP-2026-00001821")
    .setVariable("paymentReference", "PAY-9938812")
    .setVariable("paidAt", Instant.now().toString())
    .correlate();
```

Dengan local correlation variable:

```java
runtimeService
    .createMessageCorrelation("InspectionResultUploaded")
    .processInstanceBusinessKey(caseNo)
    .localVariableEquals("inspectionId", inspectionId)
    .correlate();
```

Dengan process instance id:

```java
runtimeService
    .createMessageCorrelation("ApplicantWithdrawn")
    .processInstanceId(processInstanceId)
    .correlate();
```

Dengan result:

```java
MessageCorrelationResult result = runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey(applicationId)
    .correlateWithResult();
```

Untuk multiple matches:

```java
List<MessageCorrelationResult> results = runtimeService
    .createMessageCorrelation("PolicyChanged")
    .correlateAllWithResult();
```

Namun `correlateAll` harus dipakai sangat hati-hati. Di banyak sistem enterprise, operasi broadcast ke banyak process instance lebih cocok sebagai batch terkontrol, bukan satu API call tanpa throttling.

---

## 5. Apa Yang Terjadi Saat Correlation?

Secara konseptual:

```text
runtimeService.createMessageCorrelation(name).correlate()
  -> command dieksekusi dalam CommandContext
  -> engine mencari matching subscription atau start event
  -> jika tepat satu target ditemukan:
       - target execution dilanjutkan atau process instance baru dibuat
       - variables dari correlation diset
       - subscription dikonsumsi bila catch event
       - execution berjalan sampai wait state berikutnya / end / exception
  -> flush ke DB
  -> commit jika tidak error
```

Ini berarti correlation bukan hanya “menandai event diterima”. Correlation bisa menjalankan banyak logic sinkron setelah event diterima.

Contoh:

```text
Wait PaymentReceived
  -> Service Task Validate Payment
  -> Service Task Generate License
  -> User Task Manual Approval
```

Jika message correlated dan tidak ada async boundary setelah catch event, maka caller correlation bisa ikut menjalankan `Validate Payment` dan `Generate License` di transaction yang sama sampai mencapai user task.

Ini sering mengejutkan engineer.

Jadi setelah catch event, pertimbangkan:

```text
Message Catch Event
  -> asyncBefore/asyncAfter boundary?
  -> lightweight validation only?
  -> remote call?
  -> possible retry?
```

Pattern umum yang lebih aman:

```text
Intermediate Catch Message Event
  -> Service Task Normalize Event Payload (local, fast)
  -> asyncBefore Heavy Processing
  -> Heavy Processing
  -> Next Wait State
```

atau:

```text
Intermediate Catch Message Event
  -> asyncAfter
  -> Continue Processing by Job Executor
```

Tujuannya agar HTTP/event ingestion caller tidak menanggung seluruh downstream workflow execution.

---

## 6. Event Subscription Sebagai Runtime Contract

Ketika process instance sedang menunggu message, engine menyimpan subscription.

Mental model tabel:

```text
ACT_RU_EVENT_SUBSCR
  ID_
  REV_
  EVENT_TYPE_       -- message/signal/compensate/conditional
  EVENT_NAME_       -- e.g. PaymentReceived
  EXECUTION_ID_
  PROC_INST_ID_
  ACTIVITY_ID_
  TENANT_ID_
  CREATED_
```

Relasi runtime:

```text
ACT_RU_EXECUTION
  -> ACT_RU_EVENT_SUBSCR
```

Contoh diagnostic query konseptual:

```sql
select
  es.EVENT_TYPE_,
  es.EVENT_NAME_,
  es.PROC_INST_ID_,
  es.EXECUTION_ID_,
  es.ACTIVITY_ID_,
  es.TENANT_ID_,
  es.CREATED_
from ACT_RU_EVENT_SUBSCR es
where es.EVENT_TYPE_ = 'message'
  and es.EVENT_NAME_ = 'PaymentReceived';
```

Gunakan query ini hanya untuk diagnosis. Jangan insert/update/delete manual.

### Kenapa Subscription Penting?

Karena external event hanya bisa dicorrelate ke running execution jika subscription sudah ada.

Urutan aman:

```text
Process reaches message catch event
  -> subscription inserted
  -> commit
External event arrives
  -> correlation finds subscription
```

Urutan bermasalah:

```text
External event arrives
  -> correlation attempted
  -> no subscription found
Process later reaches message catch event
  -> now waits forever
```

Ini disebut **early message problem**.

---

## 7. Early Message Problem

Early message problem adalah salah satu race condition paling penting di Camunda 7 event integration.

### 7.1 Contoh Kasus

Process:

```text
Start
  -> Send Payment Request
  -> Wait for PaymentReceived
  -> Continue
```

Implementation buruk:

```text
Service Task Send Payment Request
  -> calls payment gateway synchronously
  -> payment gateway immediately sends callback PaymentReceived
  -> callback API tries to correlate message
  -> process has not committed event subscription yet
  -> correlation fails
  -> after service task completes, process reaches wait event
  -> waits forever
```

Ini bisa terjadi kalau external system sangat cepat atau callback terjadi dalam transaction yang sama sebelum wait state committed.

### 7.2 Solusi 1: Async Boundary Sebelum External Command

```text
Prepare Payment Request
  -> asyncBefore Send Payment Request
  -> Send Payment Request
  -> Wait for PaymentReceived
```

Namun ini belum selalu menyelesaikan early callback jika callback datang sebelum subscription created.

### 7.3 Solusi 2: Commit Wait State Sebelum Mengirim Command

Lebih aman:

```text
Create Payment Command Record
  -> Wait for PaymentReceived
```

Command ke payment gateway dikirim oleh outbox/worker setelah process sudah berada pada wait state.

Pattern:

```text
Transaction A:
  - process reaches wait state
  - outbox command saved
  - commit

Worker:
  - reads outbox command
  - calls payment gateway

Callback:
  - correlation now finds subscription
```

### 7.4 Solusi 3: Event Buffer / Inbox

Jika external event bisa datang sebelum process siap, simpan event dulu di inbox.

```text
External Callback
  -> store event in event_inbox with idempotency key
  -> try correlate
  -> if no subscription: mark WAITING_FOR_SUBSCRIPTION

Scheduler/Reconciler
  -> retry unmatched event later
  -> correlate when subscription exists
```

Ini sering menjadi desain terbaik untuk sistem enterprise.

### 7.5 Solusi 4: Start Process From Event Instead of Waiting

Jika event adalah pemicu awal lifecycle, jangan buat process menunggu event yang bisa datang sebelum process dibuat.

Gunakan message start event:

```text
PaymentReceived message start
  -> Start Reconciliation Process
```

atau create process instance dengan business state yang sudah ada.

### 7.6 Solusi 5: Synchronous API Instead of Event

Jika sebenarnya remote operation adalah request-response, jangan memodelkan callback event kalau tidak perlu.

Contoh:

```text
Call eligibility service
  -> response returned immediately
  -> continue based on result
```

Tetapi jika response bisa lama, tidak reliable, atau perlu retry eksternal, event/callback tetap lebih baik.

---

## 8. Late Message Problem

Late message problem terjadi ketika event datang setelah subscription sudah tidak ada.

Contoh:

```text
Wait for ApplicantWithdrawn during Manual Review
Manual Review completed
Subscription removed
ApplicantWithdrawn event arrives late
Correlation fails
```

Pertanyaannya: apakah event terlambat harus diabaikan, dicatat, atau memicu compensation?

Tidak ada jawaban universal. Desain harus eksplisit.

### 8.1 Ignore Late Event

Cocok jika event memang tidak relevan setelah state tertentu.

```text
if no subscription:
  store event as ignored_late_event
  return 202 accepted
```

### 8.2 Route To Current State Handler

Event ingestion layer membaca current business state dari application DB, bukan hanya Camunda.

```text
if case status == CLOSED:
  create audit note
elif case status == UNDER_REVIEW:
  correlate ApplicantWithdrawn
else:
  buffer/reject
```

### 8.3 Start Exception Process

Jika event terlambat butuh penanganan manual:

```text
LateApplicantWithdrawalReceived
  -> start ExceptionHandling process
```

### 8.4 Reopen Flow

Untuk regulatory/case management, late event bisa memicu reopen.

```text
Closed Case
  -> Late Evidence Received
  -> Reopen Assessment
```

Namun reopen harus menjadi business capability eksplisit, bukan side effect correlation liar.

---

## 9. Duplicate Message Problem

Duplicate message terjadi karena:

- external system retry callback,
- gateway timeout padahal request berhasil,
- message broker redelivery,
- user double submit,
- scheduled retry,
- load balancer retry,
- operator manual re-trigger,
- event replay.

Camunda 7 tidak otomatis deduplicate external messages berdasarkan event id.

### 9.1 Bad Pattern

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey(applicationId)
    .setVariable("paymentReference", paymentReference)
    .correlate();
```

Jika callback masuk dua kali:

- correlation pertama mungkin melanjutkan process,
- correlation kedua bisa gagal karena subscription sudah hilang,
- atau bisa match subscription lain kalau model membuka message yang sama lagi,
- atau bisa membuat duplicate side effect jika correlation path mengirim email/command.

### 9.2 Good Pattern: Inbox + Idempotency

```sql
create table inbound_event (
  id bigint generated always as identity primary key,
  source_system varchar(100) not null,
  event_type varchar(100) not null,
  event_id varchar(200) not null,
  business_key varchar(200) not null,
  payload_json clob not null,
  status varchar(50) not null,
  received_at timestamp not null,
  processed_at timestamp null,
  error_message varchar(2000) null,
  unique (source_system, event_type, event_id)
);
```

Flow:

```text
Receive external event
  -> insert inbound_event using unique idempotency key
  -> if duplicate: return already accepted
  -> correlate message
  -> mark processed / waiting / failed
```

Java-style pseudocode:

```java
@Transactional
public EventIngestionResult ingest(PaymentReceivedEvent event) {
    String idempotencyKey = event.sourceSystem() + ":" + event.eventType() + ":" + event.eventId();

    Optional<InboundEvent> existing = inboundEventRepository.findByKey(idempotencyKey);
    if (existing.isPresent()) {
        return EventIngestionResult.duplicate(existing.get().status());
    }

    InboundEvent row = inboundEventRepository.insertReceived(event);

    try {
        runtimeService
            .createMessageCorrelation("PaymentReceived")
            .processInstanceBusinessKey(event.applicationId())
            .setVariable("paymentReference", event.paymentReference())
            .setVariable("paymentAmount", event.amount())
            .correlate();

        row.markProcessed();
        return EventIngestionResult.processed();
    } catch (MismatchingMessageCorrelationException ex) {
        row.markWaitingForSubscription(ex.getMessage());
        return EventIngestionResult.acceptedButNotCorrelatedYet();
    }
}
```

Catatan:

- kode di atas konseptual,
- dalam produksi, perlu memperhatikan transaction boundary antara insert inbox dan correlation,
- jika correlation dan insert inbox dalam transaksi yang sama lalu correlation gagal, jangan sampai inbox ikut rollback jika kita ingin menyimpan unmatched event,
- bisa dipisah menjadi `REQUIRES_NEW` untuk inbox receive log.

---

## 10. Correlation Ambiguity

Correlation ambiguity terjadi ketika kriteria correlation cocok ke lebih dari satu target.

Contoh buruk:

```java
runtimeService
    .createMessageCorrelation("DocumentUploaded")
    .correlate();
```

Jika ada banyak process instance menunggu `DocumentUploaded`, engine tidak tahu mana yang dimaksud.

### 10.1 Gunakan Business Key

```java
runtimeService
    .createMessageCorrelation("DocumentUploaded")
    .processInstanceBusinessKey(applicationId)
    .correlate();
```

### 10.2 Tambahkan Correlation Variable

Jika satu process instance punya beberapa parallel wait untuk document berbeda:

```text
Application Process
  parallel:
    Wait for PassportDocumentUploaded documentType=PASSPORT
    Wait for BankStatementUploaded documentType=BANK_STATEMENT
```

Correlation:

```java
runtimeService
    .createMessageCorrelation("DocumentUploaded")
    .processInstanceBusinessKey(applicationId)
    .localVariableEquals("documentType", "PASSPORT")
    .correlate();
```

### 10.3 Gunakan Process Instance Id Hanya Jika Aman

Process instance id sangat presisi, tetapi external system biasanya tidak boleh bergantung pada internal engine id.

Cocok untuk:

- internal UI action,
- admin operation,
- tightly controlled platform integration,
- callback URL yang dibuat oleh platform dan menyimpan opaque token.

Kurang cocok untuk:

- public external API contract,
- long-running cross-system business integration,
- migration-friendly architecture.

### 10.4 Hindari Correlation Variable Yang Tidak Diindex

Correlation by variable bisa mahal karena variable table join/query. Untuk high-throughput event correlation, business key atau dedicated business table sering lebih baik.

Pattern enterprise:

```text
external event
  -> application DB maps external reference to processInstanceId/businessKey
  -> Camunda correlation by processInstanceId/businessKey
```

Jangan menjadikan Camunda variable table sebagai primary event routing database untuk semua event volume tinggi.

---

## 11. Business Key Design

Business key sering diremehkan. Padahal di Camunda 7, business key adalah salah satu anchor paling berguna untuk correlation dan operations.

### 11.1 Business Key Yang Baik

Contoh:

```text
APP-2026-00001821
CASE-ENF-2026-00411
LIC-2026-00911
ORDER-993881
```

Sifat:

- unik dalam process definition/domain,
- mudah dicari operator,
- tidak berubah,
- tidak mengandung rahasia,
- tidak bergantung pada database surrogate internal yang tidak stabil lintas sistem,
- tetap valid lintas process version.

### 11.2 Business Key Yang Buruk

```text
user email
NRIC / national ID mentah
random UUID tanpa mapping
composite string panjang berisi PII
status-dependent value
mutable reference number
```

Masalah:

- privacy/security,
- sulit dioperasikan,
- berubah saat lifecycle,
- tidak cocok untuk audit,
- membingungkan ketika process migration.

### 11.3 Business Key vs Process Variable

Business key sebaiknya mewakili identity process instance.

Process variable mewakili state/data proses.

Contoh:

```text
businessKey = APP-2026-00001821
variables:
  applicantId = CUST-9981
  applicationType = RENEWAL
  riskTier = HIGH
  paymentStatus = PENDING
```

Jangan menaruh semua correlation identifier sebagai business key. Untuk banyak identifier, gunakan mapping table.

### 11.4 Mapping Table Pattern

```sql
create table workflow_instance_ref (
  business_key varchar(200) primary key,
  process_instance_id varchar(64) not null,
  process_definition_key varchar(200) not null,
  current_business_state varchar(100) not null,
  created_at timestamp not null,
  updated_at timestamp not null
);

create table workflow_external_ref (
  external_system varchar(100) not null,
  external_ref_type varchar(100) not null,
  external_ref_value varchar(200) not null,
  business_key varchar(200) not null,
  primary key (external_system, external_ref_type, external_ref_value)
);
```

External event:

```text
paymentGateway paymentRef PAY-9938812
  -> map to businessKey APP-2026-00001821
  -> correlate PaymentReceived by businessKey
```

Ini menghindari variable query dan memisahkan integration routing dari engine internals.

---

## 12. Message Name Design

Message name adalah API contract.

Contoh baik:

```text
PaymentReceived
PaymentFailed
ApplicantWithdrawn
DocumentUploaded
InspectionCompleted
AppealFiled
CaseClosedByExternalAuthority
```

Contoh buruk:

```text
msg1
callback
event
receiveMessage
statusUpdate
handleResponse
```

### 12.1 Message Name Harus Domain-Specific

Lebih baik:

```text
InspectionReportSubmitted
```

daripada:

```text
ReportSubmitted
```

Karena `ReportSubmitted` bisa ambigu antara inspection, financial report, compliance report, annual report.

### 12.2 Jangan Campur Command Dan Event

Command:

```text
RequestPayment
GenerateLicense
SendReminder
```

Event:

```text
PaymentReceived
LicenseGenerated
ReminderSent
```

Message catch event biasanya lebih cocok menangkap **event**, bukan command. Command biasanya dikirim keluar oleh process ke sistem lain.

### 12.3 Versioning Message

Untuk long-running process, message contract bisa berubah.

Pilihan:

```text
PaymentReceived
PaymentReceivedV2
```

atau payload version:

```json
{
  "eventType": "PaymentReceived",
  "schemaVersion": 2,
  "eventId": "evt-991",
  "applicationId": "APP-2026-00001821"
}
```

Biasanya lebih baik message name tetap domain-stable dan payload version berada di envelope.

Namun jika semantics berubah radikal, message name baru lebih aman.

---

## 13. Signal Event: Broadcast Semantics

Signal adalah event global/broadcast.

Camunda signal bisa dikirim dengan API seperti:

```java
runtimeService.signalEventReceived("PolicyChanged");
```

atau builder:

```java
runtimeService
    .createSignalEvent("PolicyChanged")
    .setVariables(Map.of("policyVersion", "2026.06"))
    .send();
```

Mental model:

```text
Signal sent
  -> all active matching signal subscriptions may be triggered
```

### 13.1 Kapan Signal Cocok?

Signal cocok jika semantic-nya memang broadcast.

Contoh:

```text
EmergencyStopIssued
GlobalPolicyChanged
RegulatoryFreezeActivated
SystemMaintenanceWindowStarted
```

### 13.2 Kapan Signal Tidak Cocok?

Jangan pakai signal untuk event yang targetnya satu case.

Buruk:

```text
Signal: PaymentReceived
```

Karena semua process instance yang menunggu `PaymentReceived` bisa bereaksi.

Baik:

```text
Message: PaymentReceived + businessKey APP-2026-00001821
```

### 13.3 Signal Start Event Risk

Signal start event bisa memulai process instance untuk setiap matching signal start.

Jika ada beberapa process definition/deployment dengan signal start yang sama, efeknya bisa luas.

Di enterprise platform, signal harus melalui governance:

- naming convention,
- ownership,
- blast radius analysis,
- audit,
- restricted API access,
- environment isolation,
- tenant awareness.

---

## 14. Message vs Signal Decision Table

| Pertanyaan | Message | Signal |
|---|---:|---:|
| Target satu process instance tertentu? | Ya | Tidak |
| Butuh correlation key/business key? | Ya | Biasanya tidak |
| Broadcast ke banyak listener? | Tidak | Ya |
| Cocok untuk payment callback spesifik? | Ya | Tidak |
| Cocok untuk global freeze? | Mungkin tidak | Ya |
| Risiko accidental mass trigger? | Lebih rendah jika key baik | Tinggi |
| Cocok untuk integration event normal? | Ya | Hanya jika broadcast |
| Perlu governance ketat? | Ya | Sangat ya |

Rule sederhana:

> Jika event punya target bisnis spesifik, gunakan message. Jika event memang announcement global, gunakan signal.

---

## 15. Event Subprocess vs Boundary Event vs Intermediate Catch

Ketiganya bisa menangkap message, tetapi semantics berbeda.

### 15.1 Intermediate Catch

Cocok untuk proses yang memang secara eksplisit menunggu event di titik tertentu.

```text
Request Payment
  -> Wait for PaymentReceived
  -> Continue
```

Pertanyaan desain:

- Apakah process tidak boleh lanjut sebelum event ini datang?
- Apakah event hanya relevan di titik ini?
- Apakah event hanya sekali?

### 15.2 Boundary Event

Cocok untuk event yang relevan selama activity tertentu aktif.

```text
User Task: Review Application
  boundary message: ApplicantWithdrawn
```

Pertanyaan desain:

- Apakah event harus membatalkan activity?
- Apakah event hanya relevan selama activity ini aktif?
- Apa yang terjadi jika event datang setelah activity selesai?

### 15.3 Event Subprocess

Cocok untuk event yang relevan sepanjang scope lebih besar.

```text
Application Process
  event subprocess: ApplicantWithdrawn
```

Pertanyaan desain:

- Apakah event bisa datang kapan pun selama process aktif?
- Apakah ia menginterupsi main flow?
- Apakah bisa terjadi berkali-kali?
- Apakah perlu audit/recovery path sendiri?

---

## 16. Race Condition: Message Arrives Before Subscription

Kita sudah bahas early message problem. Sekarang kita formalize sebagai timeline.

### 16.1 Bad Timeline

```text
T1 Process starts
T2 Service Task sends external request
T3 External system immediately sends callback
T4 Callback tries to correlate PaymentReceived
T5 No event subscription exists yet
T6 Correlation fails
T7 Process reaches message catch event
T8 Event subscription created
T9 Process waits forever
```

### 16.2 Safe Timeline With Outbox

```text
T1 Process creates outbox command
T2 Process reaches wait event
T3 Event subscription committed
T4 Outbox worker sends external request
T5 External system sends callback
T6 Callback correlates message successfully
```

### 16.3 Safe Timeline With Inbox Retry

```text
T1 External callback arrives early
T2 Ingestion stores inbound event
T3 Correlation fails: no subscription
T4 Event remains WAITING_FOR_SUBSCRIPTION
T5 Process reaches wait event
T6 Reconciler retries correlation
T7 Correlation succeeds
```

### 16.4 Which One Is Better?

For mission-critical systems, usually combine both:

```text
Outbox for commands leaving your system.
Inbox for events entering your system.
```

This gives:

- event durability,
- deduplication,
- retry,
- audit,
- manual recovery,
- race condition tolerance.

---

## 17. Correlation Exception Handling

Common exceptions/concepts:

- no matching execution/process definition,
- multiple matching executions,
- authorization failure,
- optimistic locking,
- process logic failure after correlation,
- variable serialization failure,
- database failure.

### 17.1 Treat Correlation As State-Changing Command

Do not treat correlation like simple notification.

```java
try {
    runtimeService
        .createMessageCorrelation("PaymentReceived")
        .processInstanceBusinessKey(applicationId)
        .correlate();
} catch (MismatchingMessageCorrelationException ex) {
    // no target or ambiguous target
} catch (OptimisticLockingException ex) {
    // concurrent update; retry may be safe if ingestion is idempotent
} catch (ProcessEngineException ex) {
    // general engine/runtime issue
}
```

### 17.2 No Match Is Not Always Error

No match can mean:

- event arrived early,
- event arrived late,
- business key wrong,
- process version changed,
- tenant mismatch,
- message name mismatch,
- process already completed,
- subscription not committed yet,
- wrong environment.

So no-match handling must inspect domain context.

### 17.3 Multiple Match Is A Design Smell

Multiple match usually means correlation key is insufficient.

Fix by:

- adding business key,
- adding local variable correlation,
- modelling distinct message names,
- preventing duplicate active waits,
- using process instance id internally,
- avoiding `correlateAll` unless intended.

### 17.4 Optimistic Locking During Correlation

Correlation can conflict with another transaction updating the same execution/process instance.

Examples:

- two callbacks arrive simultaneously,
- user completes task while external message interrupts it,
- timer fires while message arrives,
- job executor continues same instance,
- event subprocess and main flow update variables concurrently.

If event ingestion is idempotent, retrying correlation can be safe. Without idempotency, retry can duplicate side effects.

---

## 18. Correlation Transaction Boundary

Correlation itself runs in a transaction.

Important:

```text
External API receives event
  -> call runtimeService.correlate()
  -> engine may execute process path synchronously
  -> if downstream delegate throws exception
  -> entire correlation transaction may rollback
```

This can lead to unexpected behavior:

```text
PaymentReceived correlation
  -> variable paymentStatus set
  -> service task send email
  -> service task throws exception
  -> transaction rollback
  -> paymentStatus not stored
  -> event subscription may still exist
  -> email might already be sent
```

Pattern:

```text
Message catch event
  -> set event payload variables
  -> async boundary
  -> downstream processing in job executor
```

This lets correlation API return after durable acceptance, while heavy logic is retried by job executor.

Model:

```text
Wait for PaymentReceived
  -> asyncAfter
  -> Validate Payment
  -> Generate License
```

or:

```text
Wait for PaymentReceived
  -> Service Task Store Event Facts
  -> asyncBefore Continue Processing
  -> Continue Processing
```

---

## 19. Event Ingestion Architecture

A production-grade Camunda 7 event integration usually has a layer between external systems and `RuntimeService`.

```text
External System
  -> API Gateway
  -> Event Ingestion Service
      -> AuthN/AuthZ / signature validation
      -> Schema validation
      -> Idempotency check
      -> Business reference resolution
      -> Inbox persistence
      -> Camunda correlation
      -> Result classification
  -> Response 202/200/409/etc.
```

### 19.1 Why Not Expose Camunda REST `/message` Directly?

Direct exposure can be acceptable in internal trusted environments, but risky as public contract.

Problems:

- external systems learn engine-specific API,
- weak domain validation,
- hard to add idempotency,
- hard to hide process definition/message naming changes,
- difficult to enforce business authorization,
- payload/versioning leaks into Camunda variables,
- operational coupling to engine availability,
- ambiguous error semantics.

Prefer:

```text
POST /applications/{applicationId}/payment-events
```

internally maps to:

```text
PaymentReceived message correlation
```

### 19.2 Event Ingestion Service Responsibilities

It should:

- authenticate source,
- verify signature if webhook,
- validate schema,
- normalize payload,
- persist inbound event,
- deduplicate,
- map external references to business key,
- decide message name,
- correlate to Camunda,
- classify result,
- expose metrics,
- support replay/retry,
- provide operator UI/report.

### 19.3 Response Semantics

Do not return raw Camunda exceptions to external system.

Example:

```text
200 OK       duplicate event already processed
202 Accepted event stored; correlation pending or accepted
400 Bad Req  invalid schema
401/403      invalid source/signature
404          unknown business reference, if safe to reveal
409          business state incompatible, if caller should know
500          ingestion internal error
```

For webhooks, `202 Accepted` is often better than `500` when event is stored but not yet correlated.

---

## 20. Inbox State Machine

A robust inbound event table should have explicit states.

Example:

```text
RECEIVED
VALIDATED
DUPLICATE
CORRELATED
WAITING_FOR_SUBSCRIPTION
NO_MATCH_FINAL
AMBIGUOUS_MATCH
FAILED_RETRYABLE
FAILED_FATAL
IGNORED_LATE
MANUAL_REVIEW
```

State transitions:

```text
RECEIVED
  -> VALIDATED
  -> CORRELATED

RECEIVED
  -> DUPLICATE

VALIDATED
  -> WAITING_FOR_SUBSCRIPTION
  -> CORRELATED

VALIDATED
  -> AMBIGUOUS_MATCH
  -> MANUAL_REVIEW

VALIDATED
  -> NO_MATCH_FINAL

VALIDATED
  -> FAILED_RETRYABLE
  -> CORRELATED

VALIDATED
  -> FAILED_FATAL
```

This is more operationally defensible than logging only.

### 20.1 Reconciler

A scheduled reconciler retries unmatched/retryable events.

Pseudo-flow:

```text
find inbound_event where status in (WAITING_FOR_SUBSCRIPTION, FAILED_RETRYABLE)
  and next_attempt_at <= now
  and attempt_count < max_attempts

for each event:
  try resolve business key
  try correlate
  update status
```

Use backoff:

```text
1 min, 5 min, 15 min, 1 hour, 6 hours, manual review
```

For high-volume systems, partition by source/event type/business key and use SKIP LOCKED where supported.

---

## 21. Outbox + Inbox Combined Pattern

For bidirectional integration:

```text
Camunda process
  -> request external service
  -> wait for callback
```

Use both outbox and inbox.

### 21.1 Outbox Side

```text
Process reaches step: request payment
  -> writes payment request command/outbox
  -> process reaches wait state PaymentReceived
  -> commit

Outbox worker:
  -> sends request to gateway
  -> marks command sent
```

### 21.2 Inbox Side

```text
Gateway callback:
  -> store inbound event
  -> dedupe
  -> correlate PaymentReceived
```

### 21.3 Why This Works

It solves:

- early callback,
- duplicate callback,
- engine downtime,
- external downtime,
- callback retry,
- audit needs,
- manual replay.

This is often the most production-grade pattern for regulated workflows.

---

## 22. Message Correlation And BPMN Model Design

### 22.1 Avoid Multiple Identical Message Waits In Same Scope Without Local Key

Bad:

```text
Parallel:
  Wait DocumentUploaded
  Wait DocumentUploaded
  Wait DocumentUploaded
```

Good:

```text
Parallel:
  Wait DocumentUploaded where documentType=PASSPORT
  Wait DocumentUploaded where documentType=BANK_STATEMENT
  Wait DocumentUploaded where documentType=PHOTO
```

Even better, use multi-instance with explicit local variables:

```text
MI body over requiredDocuments
  -> Wait DocumentUploaded local documentType=${documentType}
```

Correlation:

```java
runtimeService
    .createMessageCorrelation("DocumentUploaded")
    .processInstanceBusinessKey(applicationId)
    .localVariableEquals("documentType", event.documentType())
    .correlate();
```

### 22.2 Avoid Message Catch Immediately After Sending External Request Unless Race Is Controlled

Bad:

```text
Send Request via JavaDelegate
  -> Wait Response
```

Better:

```text
Create Request Outbox
  -> Wait Response
```

Worker sends request after subscription committed.

### 22.3 Use Event Subprocess For Cross-Cutting Events

Instead of attaching withdrawal boundary event to many user tasks:

```text
Event Subprocess: ApplicantWithdrawn
```

This centralizes withdrawal logic.

### 22.4 Use Boundary Event For Activity-Specific Interruptions

If event only matters during one activity, boundary event is clearer.

```text
Wait For Payment
  boundary timer: PaymentTimeout
```

or:

```text
Manual Review
  boundary message: AdditionalEvidenceSubmitted
```

---

## 23. Tenant-Aware Correlation

In multi-tenant Camunda 7, event correlation must include tenant strategy.

Potential hazards:

```text
messageName = PaymentReceived
businessKey = APP-2026-0001
```

If business key is only unique inside tenant, correlation without tenant id can be ambiguous or wrong.

Use tenant-aware correlation where applicable:

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .tenantId("agency-a")
    .processInstanceBusinessKey("APP-2026-0001")
    .correlate();
```

or explicitly no tenant:

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .withoutTenantId()
    .processInstanceBusinessKey("APP-2026-0001")
    .correlate();
```

Design rule:

> If process definitions are tenant-scoped, event ingestion must be tenant-aware from the first line of code.

---

## 24. Security And Authorization

Event correlation is state mutation. Treat it as privileged.

### 24.1 Risks

- unauthorized event can move process forward,
- malicious event can complete wait state,
- spoofed callback can approve/reject case,
- payload can poison variables,
- signal can trigger mass effect,
- tenant mismatch can leak/control other tenant process,
- public Camunda REST can expose operational API surface.

### 24.2 Controls

Event ingestion should enforce:

- source authentication,
- request signature verification,
- replay protection,
- timestamp window,
- idempotency key,
- schema validation,
- tenant validation,
- message allowlist,
- variable allowlist,
- payload size limit,
- rate limiting,
- audit logging,
- least-privilege engine credentials.

### 24.3 Variable Injection Risk

Bad:

```java
runtimeService
    .createMessageCorrelation(messageNameFromRequest)
    .processInstanceBusinessKey(key)
    .setVariables(requestBodyAsMap)
    .correlate();
```

Better:

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey(applicationId)
    .setVariable("paymentStatus", normalized.status())
    .setVariable("paymentReference", normalized.reference())
    .setVariable("paymentReceivedAt", normalized.receivedAt().toString())
    .correlate();
```

Never blindly copy external JSON into process variables.

---

## 25. Observability For Message Correlation

At top 1% level, you need to observe event integration across both business and engine dimensions.

### 25.1 Logs

Log with consistent correlation fields:

```text
eventId
sourceSystem
eventType
businessKey
processInstanceId
messageName
tenantId
inboxId
correlationResult
attempt
latencyMs
```

Example structured log:

```json
{
  "event": "camunda_message_correlation_attempt",
  "sourceSystem": "payment-gateway",
  "eventType": "PaymentReceived",
  "eventId": "evt-9981",
  "businessKey": "APP-2026-00001821",
  "messageName": "PaymentReceived",
  "tenantId": "agency-a",
  "attempt": 1
}
```

### 25.2 Metrics

Useful metrics:

```text
inbound_events_total{source,eventType,status}
message_correlation_attempts_total{messageName,result}
message_correlation_latency_seconds{messageName}
message_correlation_no_match_total{messageName}
message_correlation_ambiguous_total{messageName}
inbox_pending_total{status}
inbox_oldest_pending_age_seconds{status}
duplicate_events_total{source,eventType}
late_events_total{eventType}
early_events_total{eventType}
```

### 25.3 SQL Diagnostics

Find active message subscriptions:

```sql
select
  EVENT_NAME_,
  count(*) as cnt
from ACT_RU_EVENT_SUBSCR
where EVENT_TYPE_ = 'message'
group by EVENT_NAME_
order by cnt desc;
```

Find subscriptions for one process instance:

```sql
select
  EVENT_TYPE_, EVENT_NAME_, ACTIVITY_ID_, EXECUTION_ID_, CREATED_
from ACT_RU_EVENT_SUBSCR
where PROC_INST_ID_ = :processInstanceId
order by CREATED_;
```

Find process by business key:

```sql
select
  ID_, PROC_DEF_ID_, BUSINESS_KEY_, SUSPENSION_STATE_
from ACT_RU_EXECUTION
where BUSINESS_KEY_ = :businessKey
  and PARENT_ID_ is null;
```

Find event subscription joined to execution:

```sql
select
  es.EVENT_NAME_,
  es.ACTIVITY_ID_,
  es.EXECUTION_ID_,
  ex.BUSINESS_KEY_,
  ex.PROC_INST_ID_
from ACT_RU_EVENT_SUBSCR es
join ACT_RU_EXECUTION ex on ex.ID_ = es.EXECUTION_ID_
where es.EVENT_TYPE_ = 'message'
  and es.EVENT_NAME_ = :messageName;
```

Again: read-only diagnostics only.

---

## 26. Testing Message Correlation

### 26.1 Unit Test The Resolver

Test mapping external event to message name/business key.

```java
class PaymentEventResolverTest {

    @Test
    void mapsPaidWebhookToPaymentReceived() {
        PaymentWebhook webhook = new PaymentWebhook("evt-1", "APP-1", "PAID");

        CorrelationCommand command = resolver.resolve(webhook);

        assertEquals("PaymentReceived", command.messageName());
        assertEquals("APP-1", command.businessKey());
    }
}
```

### 26.2 Integration Test The Process Wait

Test process reaches subscription.

Conceptual:

```java
ProcessInstance pi = runtimeService.startProcessInstanceByKey(
    "ApplicationProcess",
    "APP-1"
);

// assert waiting at PaymentReceived
EventSubscription sub = runtimeService
    .createEventSubscriptionQuery()
    .processInstanceId(pi.getId())
    .eventType("message")
    .eventName("PaymentReceived")
    .singleResult();

assertNotNull(sub);
```

### 26.3 Test Successful Correlation

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey("APP-1")
    .setVariable("paymentReference", "PAY-1")
    .correlate();

// assert process moved to expected next state
```

### 26.4 Test No Match

```java
assertThrows(MismatchingMessageCorrelationException.class, () ->
    runtimeService
        .createMessageCorrelation("PaymentReceived")
        .processInstanceBusinessKey("UNKNOWN")
        .correlate()
);
```

### 26.5 Test Duplicate Event

In ingestion service test:

```text
Given inbound event evt-1 already processed
When same webhook arrives again
Then no second Camunda correlation is attempted
And response is duplicate/already accepted
```

### 26.6 Test Early Event

```text
Given process not yet waiting
When event arrives
Then event stored WAITING_FOR_SUBSCRIPTION
When process reaches wait state
And reconciler runs
Then event correlated successfully
```

This test is more valuable than most happy-path BPMN tests.

---

## 27. Java Implementation Sketch: Event Ingestion Service

Below is a simplified architecture sketch. It is not tied to Spring, but the pattern maps naturally to Spring Boot.

```java
public final class EventIngestionService {

    private final InboundEventRepository inboundEvents;
    private final BusinessReferenceResolver referenceResolver;
    private final RuntimeService runtimeService;
    private final Clock clock;

    public IngestionResponse ingest(ExternalEventEnvelope envelope) {
        validateEnvelope(envelope);

        String idempotencyKey = buildIdempotencyKey(envelope);

        InboundEventRecord record = inboundEvents.tryInsertReceived(
            idempotencyKey,
            envelope.sourceSystem(),
            envelope.eventType(),
            envelope.eventId(),
            envelope.payload(),
            clock.instant()
        );

        if (record.isDuplicate()) {
            return IngestionResponse.duplicate(record.status());
        }

        CorrelationTarget target;
        try {
            target = referenceResolver.resolve(envelope);
        } catch (UnknownBusinessReferenceException ex) {
            inboundEvents.markNoMatchFinal(record.id(), ex.getMessage());
            return IngestionResponse.acceptedForManualReview();
        }

        CorrelationCommand command = buildCorrelationCommand(envelope, target);

        try {
            correlate(command);
            inboundEvents.markCorrelated(record.id(), clock.instant());
            return IngestionResponse.correlated();
        } catch (MismatchingMessageCorrelationException ex) {
            inboundEvents.markWaitingForSubscription(record.id(), ex.getMessage());
            return IngestionResponse.acceptedPendingCorrelation();
        } catch (OptimisticLockingException ex) {
            inboundEvents.markRetryable(record.id(), ex.getMessage(), nextAttemptTime(record));
            return IngestionResponse.acceptedPendingRetry();
        } catch (ProcessEngineException ex) {
            inboundEvents.markRetryable(record.id(), ex.getMessage(), nextAttemptTime(record));
            return IngestionResponse.acceptedPendingRetry();
        }
    }

    private void correlate(CorrelationCommand command) {
        MessageCorrelationBuilder builder = runtimeService
            .createMessageCorrelation(command.messageName())
            .processInstanceBusinessKey(command.businessKey());

        command.tenantId().ifPresent(builder::tenantId);
        command.variables().forEach(builder::setVariable);
        command.localCorrelationKeys().forEach(builder::localVariableEquals);

        builder.correlate();
    }
}
```

Important production refinements:

- insert inbox in a transaction that survives correlation failure,
- do not run unbounded correlation inside request thread if downstream path heavy,
- use async boundary after catch event,
- enforce message allowlist,
- do not expose raw exception details to webhook caller,
- use metrics around each result.

---

## 28. Process Modelling Patterns

### 28.1 Payment Callback Pattern

```text
Start Application
  -> Create Payment Request Outbox
  -> Wait for PaymentReceived message
  -> asyncAfter
  -> Validate Payment Result
  -> Continue Processing
```

Properties:

- outbox prevents early callback,
- wait state creates subscription,
- asyncAfter keeps webhook correlation lightweight,
- validation runs retryably.

### 28.2 Cancellation Pattern

```text
Application Processing
  event subprocess interrupting message ApplicantWithdrawn
    -> Record Withdrawal
    -> Cancel Open Tasks
    -> Notify Officer
    -> End Cancelled
```

Properties:

- cancellation can arrive at many points,
- event subprocess centralizes behavior,
- interrupting semantics explicit.

### 28.3 Additional Evidence Pattern

```text
Manual Review User Task
  non-interrupting boundary message AdditionalEvidenceSubmitted
    -> Attach Evidence
    -> Notify Reviewer
    -> return to review context
```

Properties:

- review task remains active,
- event can happen multiple times if model allows,
- evidence handling separated.

### 28.4 External Decision Result Pattern

```text
Submit For Screening
  -> Wait ScreeningCompleted
  -> asyncAfter
  -> Evaluate Screening Result
  -> Gateway: Passed / Manual Review / Reject
```

Properties:

- external screening async,
- callback event stored/correlated,
- downstream branch based on normalized variable.

### 28.5 Global Regulatory Freeze Pattern

```text
Signal: RegulatoryFreezeActivated
  -> all matching active case processes enter Hold state or create hold task
```

Use signal only if truly global. Otherwise use targeted messages per case.

---

## 29. Anti-Patterns

### 29.1 Exposing Camunda REST Message Endpoint As Public Webhook

Problem:

- leaks engine API,
- no domain validation,
- no idempotency,
- hard to secure,
- hard to evolve.

Better:

```text
Public webhook -> domain ingestion API -> Camunda correlation
```

### 29.2 Using Signal For Specific Case Callback

Problem:

- broadcast semantics,
- accidental mass trigger,
- hard to test blast radius.

Use message with business key.

### 29.3 No Idempotency Store

Problem:

- duplicates cause inconsistent process state,
- external retries become dangerous,
- manual replay unsafe.

Use inbox table.

### 29.4 Correlation By Variable For High-Volume Events

Problem:

- expensive variable queries,
- serialization/type mismatch,
- poor indexability,
- tight coupling to variable model.

Use business mapping table and business key/process instance id.

### 29.5 Heavy Work Immediately After Correlation

Problem:

- webhook caller waits too long,
- failure rolls back correlation,
- duplicate external retry,
- side-effect inconsistency.

Use async boundary after catch.

### 29.6 Message Names That Are Too Generic

Problem:

- ambiguity,
- accidental cross-model collision,
- difficult operations.

Use domain-specific names.

### 29.7 Treating No Match As Simple 404

Problem:

- could be early event,
- event lost,
- process waits forever.

Store event and reconcile.

### 29.8 Storing Entire External Payload As Variables

Problem:

- storage bloat,
- PII leakage,
- history explosion,
- schema coupling,
- query performance.

Store normalized fields and payload reference.

---

## 30. Regulatory Workflow Example

Imagine a regulatory case management platform.

Process:

```text
Case Opened
  -> Assign Inspector
  -> Wait InspectionCompleted
  -> Review Findings
  -> Wait AgencyResponse
  -> Decide Enforcement Action
  -> Issue Notice
  -> Wait AppealFiled until deadline
  -> Close Case
```

External events:

```text
InspectionCompleted
AgencyResponseSubmitted
AppealFiled
RespondentWithdrawn
CourtOrderReceived
RegulatoryFreezeActivated
```

Design:

| Event | BPMN construct | Targeting | Notes |
|---|---|---|---|
| `InspectionCompleted` | intermediate catch message | `caseNo + inspectionId` | external inspection system callback |
| `AgencyResponseSubmitted` | intermediate catch message | `caseNo` | response portal callback |
| `AppealFiled` | boundary/event subprocess message | `caseNo` | may arrive during appeal window |
| `RespondentWithdrawn` | event subprocess message | `caseNo` | may interrupt active process |
| `CourtOrderReceived` | non-interrupting event subprocess | `caseNo + orderId` | creates legal review path |
| `RegulatoryFreezeActivated` | signal or batch targeted messages | global/tenant | choose carefully by blast radius |

Business key:

```text
CASE-ENF-2026-00411
```

Inbound event table stores:

```text
sourceSystem
sourceEventId
eventType
caseNo
payloadRef
status
correlationResult
```

Event correlation code never trusts external payload directly. It resolves `caseNo`, validates case status, normalizes variables, then correlates.

---

## 31. Troubleshooting Playbook

### 31.1 Event Arrived But Process Did Not Move

Check:

1. Was event stored in inbox?
2. Was idempotency key duplicate?
3. What status does inbox show?
4. Did correlation throw no-match?
5. Does `ACT_RU_EVENT_SUBSCR` contain expected message subscription?
6. Is message name exact?
7. Is business key exact?
8. Tenant id correct?
9. Is process suspended?
10. Did correlation succeed but downstream failed/rolled back?
11. Did process move and wait at another activity?
12. Is Cockpit/history showing transition?

SQL:

```sql
select *
from ACT_RU_EVENT_SUBSCR
where EVENT_NAME_ = :messageName;
```

### 31.2 Correlation Says Multiple Matches

Check:

1. Are there duplicate process instances with same business key?
2. Are there parallel waits for same message?
3. Is local correlation key missing?
4. Is tenant id missing?
5. Did process model open same message in event subprocess and intermediate catch simultaneously?

Fix:

- add local key,
- split message names,
- correlate by process instance id internally,
- enforce uniqueness in business mapping.

### 31.3 Event Arrives Before Process Waits

Check:

1. Does event inbox show `WAITING_FOR_SUBSCRIPTION`?
2. Does process reach wait state later?
3. Is outbox sending external request before subscription commit?
4. Is service task calling external system synchronously before wait state?

Fix:

- outbox command,
- async boundary,
- inbox retry,
- model event start instead.

### 31.4 Duplicate Event Causes Errors

Check:

1. Is source event id stable?
2. Is idempotency unique constraint present?
3. Does webhook retry after timeout?
4. Does correlation path have side effects before async boundary?

Fix:

- idempotency store,
- return 200/202 for duplicate,
- make downstream idempotent,
- use async boundary.

### 31.5 Signal Triggered Too Many Instances

Check:

1. Who sent signal?
2. Which process definitions have signal catch/start?
3. Was tenant/environment scoped?
4. Was signal intended as broadcast?

Fix:

- replace with targeted message,
- restrict signal API,
- introduce signal governance,
- add blast-radius tests.

---

## 32. Production Checklist

Before using message correlation in production, verify:

### Modelling

- [ ] Message names are domain-specific.
- [ ] Message vs signal choice is justified.
- [ ] Boundary/event subprocess/intermediate catch choice is explicit.
- [ ] Parallel waits have local correlation keys.
- [ ] Heavy work after catch event has async boundary.
- [ ] Cancellation/withdrawal semantics are clear.
- [ ] Late event semantics are documented.

### Correlation

- [ ] Business key strategy is stable.
- [ ] Tenant strategy is defined.
- [ ] Correlation does not rely on expensive variable queries at high volume.
- [ ] No public raw Camunda `/message` exposure unless deliberately controlled.
- [ ] No blind external variable injection.

### Reliability

- [ ] Inbound events are stored.
- [ ] Idempotency key exists.
- [ ] Duplicate event behavior is tested.
- [ ] Early event behavior is tested.
- [ ] Reconciler exists for pending events.
- [ ] Outbox exists for outbound commands where callback race is possible.
- [ ] Retry/backoff policy exists.

### Security

- [ ] Webhook/API authentication exists.
- [ ] Signature verification exists where needed.
- [ ] Replay protection exists.
- [ ] Message allowlist exists.
- [ ] Variable allowlist exists.
- [ ] Payload size limit exists.
- [ ] Audit log exists.

### Observability

- [ ] Correlation attempts are logged with event id and business key.
- [ ] No-match/ambiguous metrics exist.
- [ ] Inbox pending age is monitored.
- [ ] Duplicate event rate is monitored.
- [ ] Operator can replay event safely.
- [ ] SQL diagnostic playbook exists.

---

## 33. Key Takeaways

1. **Message correlation is targeted event delivery, not queue publish.**
2. **Signal is broadcast; use it sparingly and intentionally.**
3. **Event subscription must exist before a running process can catch a message.**
4. **Early messages are real and common in production.**
5. **No-match does not always mean invalid event. It can mean timing race.**
6. **Business key is an operational and correlation anchor. Design it carefully.**
7. **Idempotency is mandatory for external events.**
8. **Do not expose Camunda correlation API as your public integration contract unless you fully control the environment.**
9. **Use inbox for inbound events and outbox for outbound commands.**
10. **Put async boundaries after message catch when downstream work is heavy or side-effectful.**
11. **Avoid variable-table correlation for high-volume routing. Use mapping tables where appropriate.**
12. **Top-level Camunda engineering is not drawing message events. It is designing event correctness under race, retry, duplication, and operational recovery.**

---

## 34. Practical Mental Model

When an external event arrives, ask this sequence:

```text
1. Is this event authentic?
2. Have I seen this event before?
3. What business entity does it belong to?
4. What process instance should receive it?
5. Is the process currently waiting for it?
6. If not, is the event early, late, invalid, or ambiguous?
7. Should I store, retry, ignore, reject, or start exception handling?
8. What variables should be passed into Camunda?
9. What should not be passed into Camunda?
10. What happens if correlation succeeds but downstream work fails?
11. What happens if external system retries?
12. How will an operator see and recover this event?
```

If your design answers all twelve clearly, you are operating at platform engineering level.

---

## 35. What Comes Next

Part berikutnya:

```text
learn-java-camunda-7-bpm-platform-engineering-part-014.md
```

Topik:

```text
Timers, Due Dates, Time Zones, Calendar Semantics, dan SLA Modelling
```

Kita akan membahas timer sebagai job, due date, retry/timer interaction, time zone, business calendar, SLA modelling, escalation timer, deadline semantics, timer drift, testability, dan production pitfalls.

---

## 36. Referensi Resmi Dan Bacaan Lanjutan

Referensi utama yang relevan untuk bagian ini:

- Camunda 7 Manual — BPMN Message Events
- Camunda 7 Manual — Signal Events
- Camunda 7 Manual — Process Engine RuntimeService
- Camunda 7 Javadocs — `MessageCorrelationBuilder`
- Camunda 7 Javadocs — `EventSubscriptionQuery`
- Camunda 7 REST API — Message correlation endpoint
- Camunda 7 Manual — Transactions in Processes
- Camunda 7 Manual — Process Variables
- Camunda 7 best-practice notes on routing events to processes

Gunakan dokumentasi sesuai versi Camunda 7 yang dipakai di project. Untuk estate legacy, jangan mengasumsikan perilaku minor version terbaru tersedia di versi lama tanpa verifikasi.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-012.md">⬅️ Part 012 — Service Invocation Patterns: JavaDelegate vs External Task vs Message vs Outbox</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-014.md">Timers, Due Dates, Time Zones, Calendar Semantics, dan SLA Modelling ➡️</a>
</div>
