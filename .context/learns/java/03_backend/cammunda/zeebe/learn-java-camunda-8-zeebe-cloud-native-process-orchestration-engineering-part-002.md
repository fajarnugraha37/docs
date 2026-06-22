# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-002.md

# Part 002 — Zeebe Engine Internals: Event Stream, Commands, Records, State, and Deterministic Progress

> Seri: **learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering**  
> Level: **Advanced / Staff+ Engineering**  
> Fokus: **internal execution model Zeebe sebagai log-driven distributed workflow engine**  
> Target pembaca: engineer Java yang sudah memahami Camunda 7, BPMN, distributed systems, messaging, reliability, database transaction, dan ingin menguasai Camunda 8/Zeebe dari sisi mental model engine.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya, `part-001`, membahas arsitektur platform Camunda 8 sebagai kumpulan komponen:

- Zeebe Gateway
- Zeebe Broker
- partition
- exporter
- Operate
- Tasklist
- Optimize
- Identity/Admin
- secondary storage / projection store
- Java worker application

Part ini masuk satu lapisan lebih dalam:

> **Bagaimana Zeebe benar-benar mengeksekusi proses?**

Ini bukan sekadar pertanyaan akademis. Tanpa memahami cara Zeebe memproses command, event, record, stream, dan state, engineer mudah salah desain pada area berikut:

1. Menganggap completion job bersifat sama seperti method call lokal.
2. Menganggap worker Java punya transaksi yang sama dengan engine.
3. Mengira proses lanjut karena worker “memanggil next step”, padahal engine yang menggerakkan state machine.
4. Menganggap Operate delay berarti engine delay.
5. Mengira retry di worker sama dengan retry di BPMN.
6. Menganggap process instance state bisa dipahami seperti row biasa di relational database.
7. Mengira duplicate execution adalah bug, padahal dalam distributed workflow itu kondisi yang harus didesain.
8. Mengira semua event terjadi secara global ordered, padahal ordering kuat hanya relevan di boundary tertentu seperti partition stream.

Part ini akan membangun mental model bahwa Zeebe adalah:

> **durable state machine runtime yang digerakkan oleh stream of records, memproses commands secara berurutan di dalam partition, menghasilkan events, mengubah internal state, dan menulis follow-up commands untuk membuat process instance maju secara deterministik.**

---

## 1. Ringkasan Mental Model

Kalau harus diringkas dalam satu gambar:

```text
Client / Worker / Broker Internal Logic
        |
        | submits command
        v
+-------------------------------+
| Partition Record Stream       |
|                               |
|  [Command]                    |
|  [Event]                      |
|  [Command]                    |
|  [Event]                      |
|  [Rejection]                  |
|  [Command]                    |
|  [Event]                      |
+-------------------------------+
        |
        | sequential processing
        v
+-------------------------------+
| Stream Processor              |
|                               |
|  read next record             |
|  validate against state       |
|  apply lifecycle transition   |
|  mutate internal state        |
|  append resulting record(s)   |
|  produce client response      |
|  schedule follow-up command   |
+-------------------------------+
        |
        v
+-------------------------------+
| Durable Runtime State         |
|                               |
|  process definitions          |
|  process instances            |
|  element instances            |
|  jobs                         |
|  timers                       |
|  messages                     |
|  incidents                    |
|  variables                    |
+-------------------------------+
        |
        | exported asynchronously
        v
+-------------------------------+
| Exporters / Projections       |
| Operate / Tasklist / Optimize |
+-------------------------------+
```

Kunci pemahamannya:

> **Zeebe tidak mengeksekusi proses dengan cara memanggil Java method secara langsung. Zeebe memproses record stream, mengubah state machine, dan membuat work item berupa job yang diambil oleh worker eksternal.**

Dalam Camunda 7, banyak engineer terbiasa berpikir:

```text
Java app transaction
    -> engine command
    -> database update
    -> JavaDelegate executed in same runtime
    -> next activity
```

Dalam Camunda 8/Zeebe, cara berpikirnya berubah:

```text
Client sends command
    -> command appended/handled by partition leader
    -> stream processor validates lifecycle transition
    -> event/state written durably
    -> job created when service task reached
    -> external worker activates job
    -> worker performs side effect outside engine
    -> worker sends complete/fail/throw error command
    -> engine continues process
```

Ini membuat Camunda 8 sangat kuat untuk cloud-native orchestration, tetapi juga memaksa engineer mendesain ulang reliability boundary.

---

## 2. Istilah Inti: Command, Event, Record, Intent, State

Sebelum masuk detail, kita harus menstabilkan istilah.

### 2.1 Command

**Command** adalah permintaan untuk melakukan perubahan state.

Contoh command:

- deploy process
- create process instance
- publish message
- activate jobs
- complete job
- fail job
- throw BPMN error
- resolve incident
- cancel process instance

Command menyatakan niat:

```text
"Engine, please complete this job."
"Engine, please create a process instance for this process definition."
"Engine, please publish this message with this correlation key."
```

Command belum tentu berhasil. Ia harus divalidasi terhadap current state.

Contoh command yang bisa ditolak:

```text
Complete job with jobKey=123
```

Tetapi job tersebut mungkin:

- sudah completed
- sudah timed out
- sudah failed sampai incident
- berada pada partition yang tidak menerima command itu
- process instance-nya sudah canceled
- key tidak ditemukan

Maka command bisa menghasilkan rejection.

---

### 2.2 Event

**Event** adalah fakta bahwa sesuatu sudah terjadi dan state sudah berubah.

Contoh event:

- process deployed
- process instance created
- element activated
- job created
- job activated
- job completed
- job failed
- incident created
- timer triggered
- message correlated

Command adalah request. Event adalah fact.

```text
Command:
  Complete job 123

Event:
  Job 123 completed
```

Perbedaan ini penting karena event menjadi dasar auditability dan projection.

Dalam sistem yang matang, kita tidak berpikir:

```text
worker memanggil next step
```

Kita berpikir:

```text
worker mengirim command CompleteJob
engine memvalidasi command
engine menghasilkan event JobCompleted
stream processor melanjutkan state machine
```

---

### 2.3 Rejection

**Rejection** terjadi ketika command tidak valid terhadap state saat ini atau melanggar aturan engine.

Contoh:

```text
Command: Complete job 123
Current state: job 123 already completed
Result: rejection
```

Rejection bukan sekadar exception lokal. Rejection adalah sinyal bahwa command tidak bisa diterapkan secara benar.

Bagi Java engineer, rejection harus dipahami sebagai bagian dari distributed command processing:

- worker mungkin terlambat menyelesaikan job
- job mungkin sudah timeout
- process instance mungkin sudah dibatalkan
- duplicate completion bisa terjadi
- command bisa diterima gateway tetapi ditolak broker

Prinsip penting:

> **Tidak semua command failure berarti sistem rusak. Sebagian command failure adalah konsekuensi normal dari concurrency, timeout, retry, dan distributed execution.**

---

### 2.4 Record

**Record** adalah entri di stream.

Record dapat merepresentasikan command, event, rejection, atau metadata lain tergantung record type/value type/intent-nya.

Secara mental:

```text
Record = envelope + metadata + value + intent + position
```

Contoh mental record:

```json
{
  "position": 928371,
  "partitionId": 2,
  "recordType": "COMMAND",
  "valueType": "JOB",
  "intent": "COMPLETE",
  "key": 4503599627371234,
  "value": {
    "type": "charge-payment",
    "processInstanceKey": 2251799813685250,
    "elementId": "charge_card",
    "worker": "payment-worker-01"
  }
}
```

Lalu setelah diproses, bisa muncul event:

```json
{
  "position": 928372,
  "partitionId": 2,
  "recordType": "EVENT",
  "valueType": "JOB",
  "intent": "COMPLETED",
  "key": 4503599627371234,
  "value": {
    "processInstanceKey": 2251799813685250,
    "elementId": "charge_card"
  }
}
```

Detail field internal bisa berubah antar versi, tetapi mental modelnya stabil:

> **Zeebe memproses record stream. Semua perubahan penting terhadap runtime direpresentasikan sebagai record.**

---

### 2.5 Intent

**Intent** menjelaskan maksud lifecycle transition pada suatu record.

Contoh intent pada value type job:

- CREATE
- CREATED
- ACTIVATE
- ACTIVATED
- COMPLETE
- COMPLETED
- FAIL
- FAILED
- TIMED_OUT

Contoh intent pada process instance element:

- ACTIVATE_ELEMENT
- ELEMENT_ACTIVATING
- ELEMENT_ACTIVATED
- COMPLETE_ELEMENT
- ELEMENT_COMPLETED
- TERMINATE_ELEMENT
- ELEMENT_TERMINATED

Nama aktual intent bisa berubah sesuai versi/internal API, tetapi konsepnya:

```text
value type = entity yang dibicarakan
intent     = transisi lifecycle yang diminta/terjadi
recordType = command/event/rejection
```

Mental model:

```text
Entity lifecycle + intent = state machine transition
```

---

### 2.6 State

**State** adalah representasi current condition engine untuk entity runtime.

State dapat mencakup:

- process definition
- process instance
- element instance
- job
- variable
- message subscription
- timer
- incident

State bukan sekadar “row yang dibaca worker”. State adalah working state milik broker/partition yang dibangun dan diperbarui oleh stream processor.

Poin penting:

> **Stream adalah history of changes. State adalah hasil materialisasi dari history yang sudah diproses.**

Analogi:

```text
record stream  = journal / log perubahan
engine state   = current materialized runtime state
exporter store = external projection for read/UX/analytics
```

---

## 3. Stateful Stream Processing

Zeebe memproses state dengan pola **stateful stream processing**.

Siklus sederhananya:

```text
1. Ambil record berikutnya dari stream.
2. Jika record adalah command, cek apakah command valid terhadap lifecycle dan current state.
3. Jika valid, apply command ke state machine.
4. Jika command berasal dari client, kirim response.
5. Tulis event yang menyatakan state baru.
6. Jika command tidak valid, tulis/hasilkan rejection dan kirim error response.
7. Jika event tertentu membutuhkan kelanjutan proses, tulis follow-up command.
8. Ulangi.
```

Diagram:

```text
+----------------+
| Next Record    |
+-------+--------+
        |
        v
+-----------------------------+
| Is this command applicable? |
+----------+------------------+
           |
     +-----+-----+
     |           |
     v           v
  valid       invalid
     |           |
     v           v
+-----------+  +------------+
| mutate    |  | reject     |
| state     |  | command    |
+-----+-----+  +-----+------+
      |              |
      v              v
+------------+  +--------------+
| append     |  | reply error  |
| event      |  | if needed    |
+-----+------+  +--------------+
      |
      v
+------------------+
| write follow-up  |
| commands if any  |
+------------------+
```

Kenapa sequential processing penting?

Karena untuk setiap partition, Zeebe perlu menjaga lifecycle consistency.

Misalnya sebuah process instance berada di service task `charge_card`.

State machine-nya tidak boleh secara bersamaan:

- job completed
- job failed
- job timed out
- element terminated

Tanpa ordering dan lifecycle validation, state bisa corrupt.

---

## 4. Engine Progress: Zeebe Tidak Diam Menunggu Client Saja

Workflow engine berbeda dari message broker biasa.

Message broker umumnya:

```text
producer writes message
consumer reads message
```

Workflow engine harus:

```text
start process
activate element
create job
wait for worker
continue after completion
evaluate gateway
schedule timer
correlate message
raise incident
complete process
```

Artinya engine harus “menggerakkan” proses.

Zeebe melakukan ini dengan menulis **follow-up commands** ke stream.

Contoh simplified execution:

```text
Client command:
  CreateProcessInstance(order-process)

Engine event:
  ProcessInstanceCreated

Engine follow-up command:
  ActivateElement(startEvent)

Engine event:
  ElementActivated(startEvent)

Engine follow-up command:
  CompleteElement(startEvent)

Engine event:
  ElementCompleted(startEvent)

Engine follow-up command:
  ActivateElement(validateOrderTask)

Engine event:
  ElementActivated(validateOrderTask)

Engine follow-up command:
  CreateJob(validate-order)

Engine event:
  JobCreated(validate-order)
```

Sampai di sini engine berhenti pada wait state service task karena butuh external worker.

Lalu worker:

```text
Worker command:
  ActivateJobs(type=validate-order)

Engine event:
  JobActivated

Worker executes business logic

Worker command:
  CompleteJob(jobKey)

Engine event:
  JobCompleted

Engine follow-up command:
  CompleteElement(validateOrderTask)

Engine event:
  ElementCompleted(validateOrderTask)

Engine continues to next BPMN element
```

Mental model penting:

> **Worker tidak memindahkan token BPMN secara langsung. Worker hanya menyelesaikan job. Engine yang melanjutkan process execution.**

---

## 5. Contoh Lifecycle Lengkap: Service Task Sederhana

Misalkan BPMN:

```text
Start Event
   |
   v
Service Task: reserve-inventory
   |
   v
End Event
```

Job type:

```text
reserve-inventory
```

Execution sequence simplified:

```text
[1] Client sends CreateProcessInstance
[2] Engine creates process instance
[3] Engine activates start event
[4] Engine completes start event
[5] Engine activates service task
[6] Engine creates job type=reserve-inventory
[7] Worker activates job
[8] Worker reserves inventory externally
[9] Worker completes job
[10] Engine completes service task
[11] Engine activates end event
[12] Engine completes end event
[13] Engine completes process instance
```

Expanded state thinking:

```text
ProcessInstance(order-process)
  state: ACTIVE

Element(startEvent)
  ACTIVATED -> COMPLETED

Element(reserveInventoryTask)
  ACTIVATED

Job(reserve-inventory)
  CREATED -> ACTIVATED -> COMPLETED

Element(reserveInventoryTask)
  COMPLETED

Element(endEvent)
  ACTIVATED -> COMPLETED

ProcessInstance(order-process)
  COMPLETED
```

Apa yang persisted?

- process instance exists
- element instance lifecycle
- job lifecycle
- variables
- incidents if any
- timers/subscriptions if any
- record stream of changes

Apa yang tidak terjadi?

- engine tidak menjalankan method `reserveInventory()` di dalam broker
- worker tidak mengunci database engine secara lokal
- Java transaction worker tidak otomatis mencakup state Zeebe
- complete job bukan local in-memory operation

---

## 6. Why Deterministic Progress Matters

Zeebe perlu memastikan bahwa dari state tertentu, command tertentu menghasilkan transisi yang valid dan predictable.

Contoh:

```text
Current element: exclusive gateway
Variable: approved = true
```

Engine harus mengevaluasi expression dan memilih path secara deterministik.

Jika evaluasi tidak deterministik, maka:

- replay recovery bisa menghasilkan jalur berbeda
- debugging tidak bisa dipercaya
- audit trail kehilangan makna
- failover bisa menghasilkan state berbeda

Maka desain proses harus menghindari konsep seperti:

```text
Gateway condition calls random external API directly
Gateway condition depends on current wall-clock in uncontrolled way
Gateway condition reads mutable external database implicitly
```

Dalam Camunda 8, gateway condition dievaluasi berdasarkan process variables dan expression. External business decision seharusnya dilakukan oleh worker atau DMN/decision component yang hasilnya ditulis sebagai variable eksplisit.

Desain buruk:

```text
Exclusive Gateway:
  condition = externalCreditApi.isApproved(customerId)
```

Desain baik:

```text
Service Task: evaluate-credit
  worker calls external credit API
  worker writes variable creditDecision = APPROVED / REJECTED

Exclusive Gateway:
  condition = creditDecision = "APPROVED"
```

Prinsip:

> **BPMN routing should depend on durable process data, not hidden external side effects.**

---

## 7. Source of Truth: Stream, State, Projection

Ada tiga konsep yang sering tercampur:

| Layer | Fungsi | Contoh | Boleh dipakai untuk command decision? |
|---|---|---|---|
| Record stream | history perubahan engine | event log partition | tidak langsung oleh app biasa |
| Broker state | current execution state | active job, active element, timer | ya, melalui engine command semantics |
| Projection store | read/search/UX/analytics | Operate index, Tasklist view | hati-hati, eventual consistency |

### 7.1 Record Stream

Record stream adalah sequence durable dari perubahan dan command.

Kegunaan:

- engine processing
- recovery
- exporter
- audit/projection

Tetapi application worker biasanya tidak membaca stream langsung. Worker berinteraksi lewat client API.

---

### 7.2 Broker State

Broker state adalah state yang dipakai stream processor untuk memvalidasi lifecycle dan melanjutkan process.

Contoh:

```text
Job 123 is ACTIVATED by worker payment-worker until timeout T.
```

Ketika command `CompleteJob(123)` datang, broker state menentukan apakah command itu valid.

---

### 7.3 Projection Store

Projection store dipakai oleh tools seperti Operate dan Tasklist untuk:

- search
- filtering
- UI display
- analytics
- operational inspection

Projection store bisa tertinggal dari broker state karena exporter dan indexing asynchronous.

Kesalahan umum:

```text
Worker queries Operate to decide whether it should complete a job.
```

Ini rawan karena Operate adalah projection, bukan execution state.

Lebih benar:

```text
Worker receives activated job from engine.
Worker uses job metadata and business database to decide action.
Worker sends command to engine.
If command rejected, handle as command outcome.
```

---

## 8. Command Path vs Projection Path

Sangat penting membedakan dua jalur ini.

```text
Command Path
============
Client / Worker
   -> Gateway
   -> Broker partition leader
   -> stream processor
   -> broker state
   -> response/rejection

Projection Path
===============
Broker record stream
   -> exporter
   -> Elasticsearch/OpenSearch/RDBMS projection
   -> Operate/Tasklist/Optimize/API read view
```

Jika command berhasil tetapi Operate belum update:

```text
CompleteJob command success
Broker state advanced
Exporter/indexing delayed
Operate still displays old state temporarily
```

Itu bukan kontradiksi. Itu eventual consistency.

Prinsip production:

> **Gunakan command response untuk command outcome. Gunakan projection untuk observability/search/human operation, bukan sebagai satu-satunya dasar correctness.**

---

## 9. Job Lifecycle sebagai State Machine

Job adalah konsep sentral dalam Java integration.

Simplified lifecycle:

```text
CREATED
   |
   | worker activates job
   v
ACTIVATED
   |      |       |
   |      |       +--> timeout
   |      |              |
   |      |              v
   |      |           ACTIVATABLE again / retryable state
   |      |
   |      +--> fail with retries > 0
   |              |
   |              v
   |           ACTIVATABLE after backoff
   |
   +--> complete
   |       |
   |       v
   |    COMPLETED
   |
   +--> fail with retries <= 0
           |
           v
        INCIDENT
```

Secara lebih detail:

```text
Job created by engine when service task is reached.
Job becomes available for workers of matching type.
Worker activates job.
Activation gives worker temporary exclusive right until timeout.
Worker either completes, fails, throws BPMN error, or crashes.
If timeout passes before completion, job can become available again.
If worker fails job with retries remaining, job can be retried.
If retries reach zero, Zeebe raises an incident.
Incident prevents that process instance from advancing through that point until resolved.
```

### 9.1 Job Created

Job created berarti process instance berada pada service task dan membutuhkan external execution.

```text
Element: charge_card
Job type: payment-charge
Job state: CREATED / activatable
```

Engine menunggu worker.

---

### 9.2 Job Activated

Worker meminta job berdasarkan type:

```text
activate jobs where type = payment-charge
```

Engine mengembalikan job kepada worker dan menandainya activated untuk worker tersebut dengan timeout tertentu.

Maknanya:

```text
Worker memiliki lease sementara.
```

Bukan ownership permanen.

Jika worker crash atau timeout, job dapat diaktivasi lagi.

---

### 9.3 Job Completed

Worker selesai melakukan business work dan mengirim command complete.

Jika valid:

```text
JobCompleted event
Service task can complete
Process continues
```

Jika invalid:

```text
Command rejected
```

Contoh invalid:

- job timeout dan diambil worker lain
- job sudah completed
- process canceled
- wrong state

---

### 9.4 Job Failed

Worker dapat menyatakan job gagal secara teknis.

Contoh:

- external API 503
- database temporary unavailable
- timeout to downstream
- parsing response gagal karena transient bad payload

Worker mengirim fail dengan retries dan optional retry backoff.

Jika retries masih positif:

```text
job becomes retryable after backoff / immediately depending config
```

Jika retries nol:

```text
incident raised
```

---

### 9.5 Job Timed Out

Jika worker tidak menyelesaikan job sebelum timeout:

```text
activation lease expires
job becomes activatable again
```

Ini bukan incident otomatis dalam semua kasus. Timeout adalah mekanisme recovery dari worker crash/hang.

Konsekuensinya:

> **Worker yang lambat dapat menyebabkan duplicate execution.**

Scenario:

```text
T0  worker A activates job timeout=30s
T1  worker A calls external API, slow but succeeds at 35s
T30 job activation times out
T31 worker B activates same job
T35 worker A tries complete job
T36 worker B also processes job
```

Inilah kenapa idempotency wajib.

---

## 10. Process Instance Lifecycle

Process instance juga state machine.

Simplified:

```text
CREATED
   |
   v
ACTIVE
   |
   +--> COMPLETED
   |
   +--> TERMINATED / CANCELED
```

Tetapi di dalamnya ada banyak element instance:

```text
Process Instance
  Element Instance: start event
  Element Instance: service task
  Element Instance: gateway
  Element Instance: user task
  Element Instance: subprocess
  Element Instance: boundary event
  Element Instance: end event
```

Setiap element punya lifecycle.

Contoh simplified element lifecycle:

```text
ACTIVATING
   |
   v
ACTIVATED
   |
   v
COMPLETING
   |
   v
COMPLETED
```

Atau jika dihentikan:

```text
ACTIVATED
   |
   v
TERMINATING
   |
   v
TERMINATED
```

Mengapa ini penting?

Karena banyak incident bukan terjadi pada “process” secara umum, tetapi pada element tertentu:

```text
Process instance active
  Service task charge_card has job failed with retries=0
  Incident attached to element charge_card
```

Operate menampilkan posisi ini secara visual, tetapi mental model-nya tetap element lifecycle.

---

## 11. Token Flow vs Engine Record Flow

BPMN sering dijelaskan dengan “token flow”. Itu berguna untuk modelling.

Tetapi di Zeebe internal, token movement direpresentasikan sebagai record dan state transitions.

BPMN mental model:

```text
Token leaves start event
Token enters service task
Token waits
Token leaves service task
Token enters end event
```

Zeebe mental model:

```text
ElementActivated(start)
ElementCompleted(start)
ElementActivated(serviceTask)
JobCreated(serviceTask)
JobActivated
JobCompleted
ElementCompleted(serviceTask)
ElementActivated(end)
ElementCompleted(end)
ProcessInstanceCompleted
```

Keduanya benar, tetapi dipakai untuk tujuan berbeda.

| Model | Dipakai untuk |
|---|---|
| Token flow | memahami BPMN secara visual |
| Record/state flow | memahami runtime correctness dan debugging |

Staff-level engineer harus bisa berpindah antara keduanya.

---

## 12. Wait State: Di Mana Engine Berhenti?

Engine tidak selalu “running”. Banyak process instance mayoritas waktunya berada dalam wait state.

Wait state umum:

1. Service task menunggu job worker.
2. User task menunggu human completion.
3. Receive task menunggu message.
4. Message catch event menunggu correlation.
5. Timer event menunggu waktu.
6. Event-based gateway menunggu salah satu event.
7. Incident menunggu human repair.

Zeebe durable karena wait state bukan thread yang sleep.

Bukan seperti ini:

```java
Thread.sleep(7 days);
```

Melainkan:

```text
Timer subscription stored durably.
When due, engine writes trigger command/event.
```

Service task juga bukan thread yang blocking.

```text
Job stored durably.
Worker may pick it up later.
```

Ini inti workflow engine:

> **Long-running process is represented as durable state, not long-running thread.**

---

## 13. Why Java Worker Is Outside the Engine

Camunda 8 sengaja memisahkan business code dari engine runtime.

Broker bertanggung jawab atas:

- durable orchestration state
- lifecycle validation
- partition processing
- job creation
- timer/message handling
- incident generation
- exporting records

Worker bertanggung jawab atas:

- business execution
- database mutation
- external API call
- file generation
- email sending
- integration with legacy system
- domain validation
- idempotency control

Diagram:

```text
+-------------------------+         +---------------------------+
| Zeebe Broker            |         | Java Worker Service       |
|-------------------------|         |---------------------------|
| process state           | <-----> | activate job              |
| element lifecycle       |         | run business use case     |
| job lifecycle           |         | call external services    |
| timers/messages         |         | update business DB        |
| incidents               |         | complete/fail job         |
+-------------------------+         +---------------------------+
```

Keuntungannya:

1. Engine tidak crash karena business code bug.
2. Worker bisa diskalakan independen.
3. Worker bisa deploy terpisah.
4. Worker bisa ditulis dalam berbagai bahasa.
5. Engine tetap fokus pada orchestration state.
6. Business side effect bisa diatur sesuai domain.

Konsekuensinya:

1. Tidak ada single local ACID transaction antara Zeebe dan worker DB.
2. Duplicate execution harus diantisipasi.
3. Worker harus idempotent.
4. Completion command bisa gagal setelah side effect sukses.
5. Observability harus cross-system.

---

## 14. Transaction Boundary: Hal yang Paling Sering Disalahpahami

Camunda 7 sering digunakan embedded dalam aplikasi Java/Spring.

Dalam banyak deployment Camunda 7:

```text
HTTP request
  -> Spring transaction starts
  -> application updates business DB
  -> Camunda engine updates engine DB
  -> JavaDelegate executes
  -> transaction commits
```

Walaupun tidak selalu ideal, banyak developer terbiasa menganggap engine dan aplikasi berada dalam satu transaction boundary.

Di Camunda 8:

```text
Worker DB transaction != Zeebe broker transaction
```

Contoh worker:

```java
@Transactional
public void handle(JobClient client, ActivatedJob job) {
    orderRepository.markReserved(orderId);
    client.newCompleteCommand(job.getKey()).send().join();
}
```

Masalah:

```text
DB commit succeeds.
CompleteJob command fails due to network timeout.
Worker retries.
Job times out.
Another worker activates same job.
Business action may run again.
```

Maka desain harus menggunakan idempotency/outbox/dedup.

Prinsip:

> **Camunda 8 gives durable orchestration, not distributed ACID transaction with your service database.**

---

## 15. The At-Least-Once Reality

Worker execution harus diasumsikan **at-least-once**.

Artinya:

```text
A job may be executed more than once.
```

Penyebab:

1. Worker crash setelah side effect sebelum complete job.
2. Network timeout saat complete job.
3. Job activation timeout terlalu pendek.
4. Broker failover/retry behavior.
5. Client retry command.
6. Worker deployment restart.
7. Downstream call slow.
8. Duplicate process/message input dari luar.

At-least-once bukan kelemahan unik Zeebe. Ini konsekuensi normal distributed systems.

Target engineer bukan “menghilangkan duplicate execution sepenuhnya”, tetapi:

> **membuat duplicate execution tidak merusak business state.**

---

## 16. Exactly-Once Myth

Banyak engineer mencari exactly-once execution:

```text
Saya ingin service task pasti hanya execute sekali.
```

Dalam distributed system dengan external side effect, klaim exactly-once biasanya misleading.

Misalnya:

```text
Worker calls payment provider.
Payment provider charges customer.
Worker completes Zeebe job.
Network fails before worker receives response.
```

Apakah payment terjadi? Mungkin ya.

Apakah engine tahu? Belum tentu.

Jika job retry, apakah boleh charge lagi? Tidak.

Solusinya bukan “exactly once Zeebe”, melainkan:

1. Idempotency key ke payment provider.
2. Business transaction record di database.
3. Reconciliation status.
4. Safe retry.
5. Process variable menyimpan external reference.
6. Compensation jika perlu.

Production-grade thinking:

```text
External side effect must be idempotent or fenced.
Engine job completion must be retry-safe.
Business state must tolerate re-processing.
```

---

## 17. Idempotency Key Selection

Idempotency adalah kemampuan menjalankan operasi lebih dari sekali tanpa menghasilkan efek ganda yang salah.

Kandidat key:

| Key | Kelebihan | Risiko |
|---|---|---|
| jobKey | unik per job | jika job baru dibuat ulang, mungkin berbeda |
| processInstanceKey | stabil untuk instance | terlalu luas jika banyak task dalam satu process |
| elementInstanceKey | lebih spesifik ke element | butuh paham lifecycle |
| businessKey/orderId | mudah dikaitkan domain | butuh uniqueness domain yang jelas |
| externalReferenceId | cocok untuk provider | harus disimpan durable |
| command id custom | fleksibel | harus dikelola sendiri |

Untuk worker service task, sering lebih aman menggunakan kombinasi:

```text
business operation name + business entity id + process instance key / element id
```

Contoh:

```text
reserve-inventory:ORDER-2026-0001
charge-payment:PAYMENT-2026-0088
send-email:APPLICATION-123:APPROVAL_NOTICE:v1
```

Jangan asal menggunakan jobKey sebagai idempotency key untuk external side effect yang harus stabil di level bisnis.

---

## 18. Internal Follow-Up Command: Engine Drives Itself

Zeebe tidak hanya menerima command dari client.

Broker juga dapat menghasilkan command internal untuk melanjutkan process.

Contoh setelah start event activated:

```text
ElementActivated(startEvent)
  -> engine writes CompleteElement(startEvent)
```

Setelah service task job completed:

```text
JobCompleted(serviceTask job)
  -> engine writes CompleteElement(serviceTask)
```

Setelah exclusive gateway activated:

```text
ElementActivated(gateway)
  -> engine evaluates conditions
  -> engine writes command to activate selected outgoing sequence flow / next element
```

Ini menjelaskan kenapa Zeebe disebut engine:

> **Engine bukan hanya penyimpan state; engine aktif menggerakkan lifecycle berdasarkan BPMN semantics.**

---

## 19. Backpressure from Internal Processing Perspective

Backpressure terjadi ketika broker menerima lebih banyak request daripada yang bisa diproses dengan latency yang sehat.

Dari mental model stream processing:

```text
incoming commands > processing capacity
```

Akibat:

- broker/gateway dapat menolak request
- client mendapat resource exhausted / unavailable / retryable error
- latency meningkat
- worker activation/completion bisa terdampak

Penyebab umum:

1. Terlalu banyak process instance dibuat sekaligus.
2. Terlalu banyak job completion command.
3. Payload variable terlalu besar.
4. Exporter lambat sehingga log truncation terganggu.
5. Disk IO bottleneck.
6. Partition hot spot.
7. Broker CPU/memory pressure.
8. Elasticsearch/OpenSearch lambat pada self-managed setup.

Prinsip worker/client:

```text
Respect backpressure.
Retry with exponential backoff.
Avoid uncontrolled loops.
Do not convert engine backpressure into application-level storm.
```

Anti-pattern:

```java
while (true) {
    try {
        client.newCreateInstanceCommand().bpmnProcessId("x").latestVersion().send().join();
    } catch (Exception e) {
        // immediately retry forever
    }
}
```

Lebih benar:

```text
bounded concurrency
retry with backoff
rate limit upstream
monitor command latency
separate business retry from transport retry
```

---

## 20. Stream Position and Why It Matters

Record stream memiliki posisi.

Posisi membantu memahami ordering di dalam stream/partition.

Mental example:

```text
position 100: CreateProcessInstance command
position 101: ProcessInstanceCreated event
position 102: ElementActivated start event
position 103: ElementCompleted start event
position 104: ElementActivated service task
position 105: JobCreated
position 106: JobActivated
position 107: JobCompleted
position 108: ElementCompleted service task
```

Bagi application developer, posisi stream jarang dipakai langsung. Tetapi untuk debugging/architecture, konsep ini penting:

1. Menjelaskan why order matters.
2. Menjelaskan exporter progress.
3. Menjelaskan recovery.
4. Menjelaskan projection lag.
5. Menjelaskan partition-local ordering.

Jika exporter sudah mengekspor sampai position 105, tetapi broker sudah memproses sampai 108, maka read projection bisa tertinggal.

---

## 21. Partitions and Local Ordering Preview

Part detail partition akan dibahas di part berikutnya, tetapi untuk internal processing kita perlu preview.

Zeebe cluster memiliki beberapa partition.

Setiap partition memiliki stream sendiri.

```text
Partition 1 stream:
  p1-pos-1
  p1-pos-2
  p1-pos-3

Partition 2 stream:
  p2-pos-1
  p2-pos-2
  p2-pos-3
```

Ordering kuat berlaku di dalam partition.

Tidak ada satu global total order sederhana untuk semua hal di semua partition yang bisa dipakai application sebagai asumsi bisnis.

Konsekuensi:

1. Jangan mendesain proses lintas instance yang membutuhkan global order tanpa mekanisme eksplisit.
2. Jangan mengasumsikan Operate list order = exact causal business order lintas partition.
3. External consistency harus dikendalikan oleh business database/event store jika butuh global ordering domain.

---

## 22. Exporting Records: From Engine Truth to Read Model

Setelah record diproses, data dapat diekspor oleh exporter ke storage eksternal.

Tujuan exporter:

- Operate visibility
- Tasklist visibility
- Optimize analytics
- custom audit trail
- external monitoring
- BI/reporting

Flow:

```text
Broker stream
   -> exporter reads records
   -> exporter writes projection
   -> UI/API reads projection
```

Exporter harus dipahami sebagai downstream consumer dari engine records.

Jika exporter lambat:

```text
engine may continue processing
read model may lag
storage pressure may increase
log truncation may be delayed depending exporter progress
```

Untuk production, jangan hanya monitor worker dan broker. Monitor exporter/projection health juga.

---

## 23. Incident Lifecycle from Internal Perspective

Incident bukan “exception log”. Incident adalah engine-level condition yang menghentikan progress pada titik tertentu sampai diperbaiki.

Simplified:

```text
Service Task reached
Job created
Worker activates job
Worker fails job with retries = 0
Engine creates incident
Process instance cannot advance past that element
Human/operator fixes cause
Incident resolved
Job becomes available/retried
Process continues
```

Diagram:

```text
JOB ACTIVATED
    |
    | FailJob(retries=0)
    v
JOB FAILED
    |
    v
INCIDENT CREATED
    |
    | operator intervention
    v
INCIDENT RESOLVED
    |
    v
JOB RETRY / ACTIVATABLE
```

Incident harus digunakan untuk kondisi yang memang membutuhkan intervensi atau repair.

Jangan menjadikan incident sebagai mekanisme business routing normal.

Buruk:

```text
Customer rejected application -> fail job retries=0 -> incident
```

Benar:

```text
Customer rejected application -> BPMN business path / BPMN error / gateway decision
```

Incident cocok untuk:

- required variable missing karena bug
- downstream integration broken
- authentication credential expired
- worker repeatedly failing unexpectedly
- BPMN expression invalid
- data corruption
- configuration mismatch

---

## 24. BPMN Error vs Job Failure vs Incident

Tiga hal ini sering dicampur.

| Konsep | Makna | Dipakai untuk | Efek |
|---|---|---|---|
| Job failure | technical failure in execution | retryable/non-retryable technical problem | retry or incident |
| BPMN error | business/expected error path | modelled alternative business flow | caught by boundary/error handler |
| Incident | engine cannot progress | human repair needed | process waits until resolved |

Contoh:

### 24.1 Job Failure

```text
Payment API timeout.
Retry 3 times with backoff.
```

### 24.2 BPMN Error

```text
Payment declined.
Route process to payment_failed path.
```

### 24.3 Incident

```text
Payment worker bug: NullPointerException for all jobs.
Retries exhausted.
Operator must deploy fix and resolve incident.
```

Guideline:

```text
Expected business outcome -> BPMN path/error.
Unexpected technical recoverable issue -> job failure with retry.
Unrecoverable technical issue needing human action -> incident.
```

---

## 25. Variables as Part of State

Variables are part of runtime state.

Worker completes job with variables:

```json
{
  "paymentStatus": "APPROVED",
  "paymentReference": "PAY-123"
}
```

Engine merges variables into process scope according to its variable semantics.

Then gateway may evaluate:

```text
paymentStatus = "APPROVED"
```

Variable discipline matters because variables influence deterministic routing.

Bad variable practice:

```json
{
  "result": "ok",
  "data": { ... huge external response ... },
  "payload": "unversioned blob"
}
```

Good variable practice:

```json
{
  "payment": {
    "schemaVersion": 1,
    "status": "APPROVED",
    "reference": "PAY-123",
    "evaluatedAt": "2026-06-20T10:15:30Z"
  }
}
```

Principles:

1. Store routing facts.
2. Store external references.
3. Avoid huge payloads.
4. Avoid secrets.
5. Version variable contracts.
6. Make gateway decisions explainable.

---

## 26. Message Correlation from Internal Perspective

Message correlation is another state machine interaction.

Process may create a message subscription:

```text
Waiting for message:
  name = PaymentReceived
  correlationKey = ORDER-123
```

External system publishes message:

```text
MessagePublished(
  name=PaymentReceived,
  correlationKey=ORDER-123,
  variables={...}
)
```

Engine checks whether a matching subscription exists.

If match:

```text
MessageCorrelated
Process continues
```

If no match but TTL positive:

```text
Message buffered until subscription appears or TTL expires
```

Mental model:

```text
message publish command + subscription state -> correlation event or buffered message
```

Common race:

```text
External message arrives before process reaches catch event.
```

This can be valid if message TTL allows buffering. Otherwise message can be lost from process perspective.

Design implication:

> **Correlation key and message TTL are not minor config; they are process correctness controls.**

---

## 27. Timers from Internal Perspective

Timer is durable scheduling state.

When process reaches timer:

```text
Timer subscription created with due date/duration
Process waits
```

When due:

```text
TimerTriggered event
Process continues / boundary fires / event subprocess starts
```

Timer is not a thread.

Good mental model:

```text
Durable timer record + engine scheduler + follow-up command
```

Important concerns:

1. Clock correctness.
2. Time zone normalization.
3. Business calendar limitations.
4. Timer explosion for huge process volume.
5. Timer boundary cancellation semantics.
6. Incident/debugging if expected timer did not fire.

---

## 28. Recovery: Why Log + State Matters

A distributed engine must recover from broker crash.

Simplified recovery concept:

```text
persisted log + snapshots -> rebuild current state
```

If broker restarts, it can recover partition state from durable data.

This is why deterministic processing matters.

If state reconstruction from stream could produce different result depending on random external call, recovery would be unsafe.

Zeebe avoids that by ensuring engine state transitions are based on stored records and deterministic semantics.

Worker external side effects are not replayed by broker. They only happen when workers process jobs.

This separation is critical:

```text
Broker recovery replays/reconstructs engine state.
External side effects are controlled by workers and idempotency.
```

---

## 29. Comparison with Relational Engine Thinking

Camunda 7 style mental model often:

```text
ACT_RU_* tables hold runtime state
ACT_HI_* tables hold history
Engine command updates DB transactionally
JavaDelegate may execute in engine transaction
```

Zeebe style mental model:

```text
record stream records changes
partition state represents runtime
exporter emits records to projection stores
workers execute outside engine transaction
```

Comparison:

| Area | Camunda 7 typical mental model | Camunda 8/Zeebe mental model |
|---|---|---|
| Engine state | relational DB tables | partition stream + state |
| Execution | command context + DB transaction | stream processor + lifecycle records |
| Java code | delegate/listener inside engine app possible | external worker app |
| History | engine history tables | exported/projection records |
| Scaling | DB-centered | partition/broker/worker-centered |
| Transaction boundary | often shared with Java app | remote command boundary |
| Failure handling | DB transaction rollback often central | retry/idempotency/incident central |

This is why migration is architectural, not merely syntactic.

---

## 30. Debugging with Internal Mental Model

Ketika ada masalah, jangan langsung bertanya:

```text
Kenapa BPMN-nya error?
```

Tanya berdasarkan layer:

### 30.1 Command Layer

```text
Did the client send the command?
Did gateway accept it?
Was command routed to correct partition?
Was command rejected?
Was there backpressure?
Was auth valid?
```

### 30.2 Engine State Layer

```text
What state is the process instance in?
Which element is active?
Is there a job created?
Is job activated?
Did job timeout?
Is there an incident?
Is a message subscription waiting?
Is a timer due?
```

### 30.3 Worker Layer

```text
Is worker polling/streaming correct job type?
Is worker authorized?
Is maxJobsActive too low/high?
Is timeout too short?
Is worker failing before complete?
Is worker stuck on downstream dependency?
```

### 30.4 Projection Layer

```text
Is Operate up to date?
Is exporter lagging?
Is index healthy?
Is Tasklist projection delayed?
```

### 30.5 Business Layer

```text
Was external side effect executed?
Was it executed twice?
Is idempotency record present?
Is business DB state consistent with process variable?
```

This layered debugging is what separates top-tier workflow engineers from API users.

---

## 31. Example: Complete Job Timeout Race

Scenario:

```text
Worker A activates job J with timeout 30s.
Worker A calls external system.
External system takes 40s but succeeds.
At 30s, job times out.
Worker B activates job J.
Worker A sends CompleteJob at 41s.
```

Possible outcome:

```text
Worker A complete command rejected because job no longer activated by A / wrong state.
Worker B may execute same external side effect again.
```

What a beginner says:

```text
Zeebe duplicated my job. This is a bug.
```

What a production engineer says:

```text
Timeout was shorter than external execution p99.
Worker side effect was not idempotent.
Need adjust timeout/backoff/concurrency and introduce operation-level idempotency key.
```

Corrective actions:

1. Set job timeout above expected processing p99 with margin.
2. Use idempotency key for external call.
3. Store external reference before/after call according to design.
4. Make complete command retry-safe.
5. Monitor worker execution time vs job timeout.
6. Avoid unbounded worker concurrency causing self-induced slowdowns.

---

## 32. Example: Command Success but Operate Looks Old

Scenario:

```text
Worker completes job successfully.
Client receives success.
Operate still shows service task active for a few seconds.
```

Beginner interpretation:

```text
Complete job failed or Camunda inconsistent.
```

Better interpretation:

```text
Broker state advanced, but Operate projection has not caught up.
Check exporter/index lag before assuming engine failure.
```

Important distinction:

```text
Command response comes from execution path.
Operate display comes from projection path.
```

---

## 33. Example: Incident Created After Retries Exhausted

Scenario:

```text
Worker fails job with retries=2.
Worker fails job with retries=1.
Worker fails job with retries=0.
Incident appears in Operate.
```

Engine perspective:

```text
Job failure records updated retry count.
Retries reached zero.
Engine created incident for the element/job.
Process cannot advance past this point.
```

Operator actions:

1. Inspect incident message.
2. Check worker logs using processInstanceKey/jobKey/correlationId.
3. Fix root cause.
4. Optionally update variables if bad data caused failure.
5. Resolve incident/retry.
6. Confirm process moves forward.

Design lesson:

> **Retries are not a substitute for proper error taxonomy.**

---

## 34. Java Client Result Handling: Do Not Ignore Command Outcome

Because command can be rejected or fail, Java client code must treat command outcome seriously.

Bad:

```java
client.newCompleteCommand(job.getKey())
      .send();
// fire-and-forget, no observation, no retry policy, no logging
```

Better conceptual pattern:

```java
try {
    client.newCompleteCommand(job.getKey())
          .variables(resultVariables)
          .send()
          .join();

    log.info("job completed", kv("jobKey", job.getKey()));
} catch (Exception ex) {
    log.warn("complete job command failed",
        kv("jobKey", job.getKey()),
        kv("processInstanceKey", job.getProcessInstanceKey()),
        ex);

    // Decide if retrying completion is safe.
    // Do not blindly re-run external side effects.
}
```

But even this is incomplete without idempotency.

Recommended worker flow:

```text
1. Receive activated job.
2. Extract business key and operation key.
3. Check idempotency/business operation table.
4. If operation already completed, complete job with known result.
5. If not started, mark operation in progress.
6. Execute side effect with idempotency key.
7. Persist result/reference.
8. Complete Zeebe job.
9. If complete command fails, do not repeat side effect blindly.
```

---

## 35. Worker-Side State Machine

A robust worker often needs its own state machine.

Example table:

```text
workflow_operation
------------------
operation_key       varchar primary key
process_instance_key bigint
job_key             bigint
operation_type      varchar
business_id         varchar
status              varchar
external_ref        varchar
request_hash        varchar
response_summary    json
created_at          timestamp
updated_at          timestamp
```

Status:

```text
RECEIVED
IN_PROGRESS
EXTERNAL_SUCCEEDED
EXTERNAL_FAILED_RETRYABLE
EXTERNAL_FAILED_FINAL
ZEEBE_COMPLETED
ZEEBE_COMPLETE_FAILED
```

This lets the worker recover from ambiguous outcomes.

Without this, the worker only has memory/logs, which is not enough for production.

---

## 36. Determinism and Expressions

BPMN gateways and expressions should depend on stable variables.

Bad:

```text
Gateway condition depends on worker-local cache not stored in process variable.
```

Bad:

```text
Worker completes job with variable { "decision": true }
but no metadata explaining why.
```

Better:

```json
{
  "eligibilityDecision": {
    "schemaVersion": 1,
    "result": "ELIGIBLE",
    "ruleSetVersion": "2026.06",
    "evaluatedAt": "2026-06-20T10:15:30Z",
    "source": "eligibility-service"
  }
}
```

This makes process routing explainable.

In regulated systems, this matters because later you need to answer:

```text
Why did this case go to enforcement path?
Which data/rule decided it?
Which worker wrote the decision?
When?
Was the downstream result retried?
```

---

## 37. How Zeebe Internals Shape BPMN Modelling

Understanding internals changes how you model BPMN.

### 37.1 Service Task Granularity

Too fine-grained:

```text
Task A: call API /validate/name
Task B: call API /validate/address
Task C: call API /validate/phone
Task D: call API /validate/email
```

This creates too many jobs, variables, retries, incidents, and operational noise.

Too coarse-grained:

```text
Task: process entire application including validation, payment, document generation, approval, notification
```

This hides business milestones and failure points.

Better:

```text
Service task boundary = meaningful business/technical responsibility + retry/error semantics.
```

---

### 37.2 Gateway Decisions

Gateway should not hide integration.

Bad:

```text
Gateway expression performs implicit external lookup.
```

Better:

```text
Service task writes decision variable.
Gateway routes based on variable.
```

---

### 37.3 Incidents

Model expected business paths explicitly.

Bad:

```text
Application invalid -> incident
```

Better:

```text
Application invalid -> business rejection path
```

---

## 38. How Zeebe Internals Shape Java Code

A Java worker is not just:

```java
@JobWorker(type = "x")
void handle(Job job) { ... }
```

A production-grade worker must handle:

1. Job activation lease.
2. Timeout vs execution time.
3. Duplicate execution.
4. Command rejection.
5. Fail vs BPMN error vs incident.
6. Variable schema evolution.
7. Backpressure.
8. Graceful shutdown.
9. Idempotency.
10. External side effect fencing.
11. Observability.
12. Tenant/security boundary.

Skeleton mental architecture:

```text
Job Handler Adapter
  -> parse variables
  -> validate contract
  -> build operation key
  -> call domain use case
  -> map result to process variables
  -> complete/fail/throw error command

Domain Use Case
  -> business validation
  -> idempotency service
  -> external adapter
  -> persistence

Infrastructure
  -> Zeebe/Camunda client
  -> database
  -> HTTP/gRPC clients
  -> metrics/logging/tracing
```

---

## 39. Practical Mental Checklist for Any Zeebe Runtime Question

When analyzing Zeebe behavior, ask:

1. What command was submitted?
2. Which entity does it target?
3. Which partition owns that entity?
4. What was the current lifecycle state?
5. Was the command applicable?
6. If applicable, what event should be produced?
7. What state mutation follows?
8. Does engine need to write follow-up command?
9. Is the process now at a wait state?
10. If waiting, what can unblock it?
11. Has the record been exported to projection?
12. Is UI showing execution truth or delayed projection?
13. If worker involved, is execution idempotent?
14. If external side effect involved, what happens on retry?
15. If command failed, is it transport failure, rejection, backpressure, or business failure?

This checklist is far more powerful than memorizing API calls.

---

## 40. Production Readiness Implications

From this internal model, production requirements become obvious.

### 40.1 Worker Requirements

Every important worker must define:

```text
job type
input variables
output variables
timeout
max active jobs
retry policy
BPMN error mapping
incident message policy
idempotency key
external side effect semantics
observability fields
shutdown behavior
```

### 40.2 Process Requirements

Every process must define:

```text
process id
versioning strategy
start triggers
business key/correlation key
message names
error paths
SLA/timers
human task assignment
incident ownership
migration compatibility
variable schema
```

### 40.3 Platform Requirements

Every platform must monitor:

```text
broker health
partition health
command latency
backpressure
job activation/completion rate
worker availability
incident count
exporter lag
projection health
disk usage
snapshot/log behavior
identity/auth failures
```

---

## 41. Common Misconceptions

### Misconception 1: “Complete job means process definitely completed.”

No. Complete job only completes that job. Engine then continues and may hit gateway, another task, timer, incident, or end event.

---

### Misconception 2: “If worker succeeds, process state must be updated immediately in Operate.”

No. Operate is projection. It can lag behind broker state.

---

### Misconception 3: “Job timeout means worker stopped.”

No. Timeout only expires engine-side activation lease. Worker process may still be running unless your application cancels it.

---

### Misconception 4: “Retry count solves reliability.”

No. Retry without idempotency can amplify damage.

---

### Misconception 5: “Incident means business rejection.”

No. Incident means engine cannot progress and usually needs repair.

---

### Misconception 6: “Zeebe gives exactly-once external side effect.”

No. External side effects must be designed idempotently.

---

### Misconception 7: “Camunda 8 process engine can query like Camunda 7 runtime tables.”

No. Read-side is projection-based. Execution truth lives in broker/partition state.

---

## 42. Staff-Level Design Questions

Use these to test understanding.

### 42.1 Duplicate Payment Scenario

A payment worker charges customer successfully, but fails to complete the job due to network timeout. What happens if job retries?

A strong answer mentions:

- external charge may already have happened
- Zeebe may not know completion succeeded
- job can be retried/activated again
- payment call must use idempotency key
- worker must store external reference
- complete command retry must not repeat charge blindly
- reconciliation may be needed

---

### 42.2 Projection Lag Scenario

Worker completes job successfully, but Operate still shows old activity. Is engine inconsistent?

A strong answer mentions:

- command path vs projection path
- exporter/index delay
- broker state may already be advanced
- check command response and exporter lag

---

### 42.3 Incident Scenario

Worker fails job with retries zero. What should happen?

A strong answer mentions:

- incident is created
- process instance cannot advance past that step
- operator fixes root cause
- resolve incident/retry
- not suitable for expected business rejection

---

### 42.4 Timeout Scenario

Worker timeout is 30 seconds, downstream p99 is 45 seconds. What risk exists?

A strong answer mentions:

- job may become activatable again while original worker still executing
- duplicate execution risk
- increase timeout or change architecture
- idempotency mandatory
- monitor execution duration vs timeout

---

### 42.5 Gateway Decision Scenario

Gateway routes based on variable written by worker. What makes this defensible?

A strong answer mentions:

- variable contains explicit decision result
- schema/version/source/timestamp stored
- gateway expression deterministic
- audit trail can explain path

---

## 43. Minimal Internal Vocabulary to Memorize

You should be fluent with these words:

```text
command
record
event
intent
rejection
stream processor
partition
position
state
job
activation
lease timeout
completion
failure
retry
incident
message subscription
timer subscription
exporter
projection
backpressure
idempotency
follow-up command
wait state
```

If you cannot explain these without looking them up, you are not yet ready to debug Camunda 8 production issues.

---

## 44. Practical Java Worker Pseudocode with Correct Mental Model

This is not final production code. It is a mental template.

```java
public final class ReserveInventoryWorker {

    private final InventoryUseCase inventoryUseCase;
    private final OperationIdempotencyService idempotencyService;
    private final CamundaCommandFacade camunda;
    private final WorkerObservation observation;

    public void handle(ActivatedJob job) {
        WorkerContext ctx = WorkerContext.from(job);

        observation.withContext(ctx, () -> {
            ReserveInventoryInput input = parseAndValidate(job.getVariables());

            String operationKey = OperationKeys.reserveInventory(input.orderId());

            OperationResult<ReserveInventoryOutput> result =
                idempotencyService.executeOnce(operationKey, () ->
                    inventoryUseCase.reserve(input)
                );

            switch (result.status()) {
                case SUCCESS -> camunda.completeJob(job.getKey(), result.output().toVariables());

                case BUSINESS_REJECTED -> camunda.throwBpmnError(
                    job.getKey(),
                    "INVENTORY_NOT_AVAILABLE",
                    result.reasonVariables()
                );

                case RETRYABLE_TECHNICAL_FAILURE -> camunda.failJob(
                    job.getKey(),
                    result.errorMessage(),
                    result.remainingRetries(),
                    result.retryBackoff()
                );

                case FINAL_TECHNICAL_FAILURE -> camunda.failJob(
                    job.getKey(),
                    result.errorMessage(),
                    0,
                    null
                );
            }
        });
    }
}
```

Key ideas:

1. Parse variables explicitly.
2. Validate contract.
3. Derive operation idempotency key.
4. Execute business use case with dedup/fencing.
5. Map domain result to BPMN semantics.
6. Complete/fail/throw BPMN error intentionally.
7. Observe every important key.

---

## 45. Regulatory Workflow Implication

Untuk sistem regulasi/enforcement/case management, Zeebe internals punya dampak besar.

Misalnya proses:

```text
Application Submitted
  -> Validate Eligibility
  -> Assign Officer
  -> Request Clarification
  -> Wait for Applicant Response
  -> Review Evidence
  -> Decide Approval/Rejection
  -> Appeal Window Timer
  -> Enforcement Escalation
```

Setiap langkah harus jelas:

1. Apakah ini engine wait state?
2. Apakah ini human task?
3. Apakah ini external worker side effect?
4. Apakah ini business decision variable?
5. Apakah ini timer statutory deadline?
6. Apakah ini message correlation dari external system?
7. Apakah failure-nya business path, retry, atau incident?
8. Apakah duplicate execution akan merusak case state?
9. Apakah audit bisa menjelaskan keputusan?
10. Apakah projection delay mempengaruhi user operation?

Camunda 8 kuat untuk lifecycle seperti ini karena ia menyimpan durable orchestration state, tetapi Anda tetap harus membangun domain model dan audit model yang benar.

Workflow engine bukan pengganti domain model.

---

## 46. Summary Mental Model

Part ini dapat diringkas menjadi beberapa invariant:

1. **Zeebe is stream-driven.**  
   Engine memproses records, bukan menjalankan Java method internal seperti embedded engine.

2. **Command is request; event is fact.**  
   Command bisa berhasil, ditolak, atau gagal karena transport/backpressure.

3. **State is lifecycle-controlled.**  
   Process, element, job, timer, message, dan incident punya lifecycle.

4. **Engine drives process with follow-up commands.**  
   Setelah satu event terjadi, engine dapat menulis command internal untuk melanjutkan BPMN.

5. **Worker is external.**  
   Worker tidak berada dalam transaction boundary broker.

6. **Job execution is at-least-once.**  
   Duplicate execution harus dianggap normal possibility.

7. **Idempotency is mandatory for side effects.**  
   Terutama payment, notification, document generation, external registration, dan regulatory action.

8. **Projection is not execution truth.**  
   Operate/Tasklist/Optimize bergantung pada exported/projection data.

9. **Incident means engine cannot progress.**  
   Jangan gunakan incident sebagai business rejection path.

10. **Determinism makes recovery and audit possible.**  
    BPMN routing harus berbasis durable variables dan explicit facts.

---

## 47. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk part ini:

1. Camunda 8 Docs — Zeebe Internal Processing  
   `https://docs.camunda.io/docs/components/zeebe/technical-concepts/internal-processing/`

2. Camunda 8 Docs — Zeebe Architecture  
   `https://docs.camunda.io/docs/components/zeebe/technical-concepts/architecture/`

3. Camunda 8 Docs — Introduction to Camunda 8 Concepts  
   `https://docs.camunda.io/docs/components/concepts/concepts-overview/`

4. Camunda 8 Docs — Job Workers  
   `https://docs.camunda.io/docs/components/concepts/job-workers/`

5. Camunda 8 Docs — Incidents  
   `https://docs.camunda.io/docs/components/concepts/incidents/`

6. Camunda 8 Docs — Zeebe API / Gateway Service  
   `https://docs.camunda.io/docs/apis-tools/zeebe-api/gateway-service/`

7. Camunda 8 Docs — Backpressure  
   `https://docs.camunda.io/docs/8.7/self-managed/zeebe-deployment/operations/backpressure/`

8. Camunda 8 Docs — Resource Planning  
   `https://docs.camunda.io/docs/8.7/self-managed/zeebe-deployment/operations/resource-planning/`

---

## 48. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum masuk part berikutnya, pastikan Anda bisa menjawab tanpa melihat catatan:

1. Apa bedanya command dan event?
2. Apa itu record?
3. Apa itu stream processor?
4. Mengapa Zeebe menulis follow-up command?
5. Mengapa worker tidak boleh diasumsikan exactly-once?
6. Apa yang terjadi jika job timeout tapi worker masih berjalan?
7. Apa bedanya job failure, BPMN error, dan incident?
8. Mengapa Operate bisa tertinggal dari broker state?
9. Mengapa gateway decision harus berdasarkan variable durable?
10. Mengapa Camunda 8 butuh idempotency design di worker?

Jika jawaban Anda sudah solid, part berikutnya akan jauh lebih mudah.

---

## 49. Penutup Part 002

Part ini membahas bagian paling fundamental dari Zeebe engine internals:

- command
- event
- record
- intent
- rejection
- state
- stateful stream processing
- follow-up command
- job lifecycle
- process instance lifecycle
- wait state
- transaction boundary
- at-least-once execution
- idempotency
- projection lag
- incident semantics
- deterministic progress

Ini adalah pondasi untuk part berikutnya.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-003.md
```

Judul:

```text
Part 003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees
```

Di part 003, kita akan masuk lebih dalam ke pertanyaan:

> **Bagaimana Zeebe membagi workload ke partition, menjaga replication, memilih leader, mempertahankan ordering, dan menskalakan workflow execution tanpa database relational terpusat seperti Camunda 7?**

---

## Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
[x] part-000 — Orientation, Scope, Mental Model, and What Changes from Camunda 7
[x] part-001 — Camunda 8 Platform Architecture
[x] part-002 — Zeebe Engine Internals
[ ] part-003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees
...
[ ] part-035 — Mastery Checklist, Engineering Heuristics, Interview-Level Depth, and Next Roadmap
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-001.md">⬅️ Part 001 — Camunda 8 Platform Architecture: Zeebe, Gateway, Broker, Operate, Tasklist, Optimize, Identity</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-003.md">Part 003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees ➡️</a>
</div>
