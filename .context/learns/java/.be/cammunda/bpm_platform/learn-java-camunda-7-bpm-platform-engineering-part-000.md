# learn-java-camunda-7-bpm-platform-engineering-part-000.md

# Part 000 — Orientation, Scope, Mental Model, dan Peta Belajar Camunda 7 Platform Engineering

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Target: Java 8 sampai Java 25, dengan fokus realistis terhadap compatibility Camunda 7  
> Level: Advanced / principal-engineering oriented  
> Status seri: **belum selesai** — ini adalah bagian 0 dari 36 bagian (`part-000` s.d. `part-035`)

---

## 0. Ringkasan Eksekutif

Camunda 7 bukan hanya library BPMN untuk menjalankan diagram. Camunda 7 adalah **durable process engine** berbasis Java yang menyimpan state eksekusi proses ke database relasional, menyediakan API untuk memulai, menggerakkan, menginspeksi, memigrasikan, dan mengoperasikan instance proses yang bisa hidup selama detik, hari, bulan, bahkan tahun.

Kalau dipahami dangkal, Camunda 7 terlihat seperti:

> “Kita gambar BPMN, lalu taruh JavaDelegate di service task.”

Itu cara pandang junior.

Cara pandang engineer senior/principal adalah:

> “Camunda 7 adalah coordination runtime untuk long-running state transition, dengan database sebagai durability layer, transaction boundary sebagai safety point, job executor sebagai asynchronous recovery mechanism, BPMN sebagai executable control-flow contract, dan history sebagai audit substrate.”

Perbedaan dua kalimat ini sangat besar. Kalimat pertama membuat orang cepat membuat proses, tetapi sering gagal ketika masuk produksi: optimistic locking, job stuck, retry menduplikasi side effect, variable bengkak, history table meledak, process migration kacau, dan audit tidak defensible. Kalimat kedua membuat kita mendesain process platform yang bisa bertahan di enterprise environment.

Bagian 0 ini tidak berfokus pada syntax detail. Bagian ini membangun fondasi:

1. Apa posisi Camunda 7 dalam sistem Java enterprise.
2. Apa yang harus dan tidak harus dimodelkan dengan Camunda 7.
3. Bagaimana memandang engine: passive Java code, wait state, DB state, job executor, dan transaction.
4. Mengapa Camunda 7 berbeda dari state machine biasa, queue worker, scheduler, saga framework, dan BPMN drawing tool.
5. Apa ruang belajar seri ini agar tidak mengulang materi BPMN/Camunda sebelumnya.
6. Bagaimana mempelajari Camunda 7 dari Java 8 hingga Java 25 dengan compatibility mindset.
7. Apa checklist mental yang akan dipakai sepanjang seri.

---

## 1. Konteks Strategis Camunda 7

Camunda 7 adalah generasi platform Camunda berbasis relational process engine. Di banyak organisasi enterprise, Camunda 7 masih ditemukan dalam bentuk:

- embedded engine di Spring Boot application;
- shared engine di application server;
- remote process engine yang diakses via REST;
- workflow layer untuk case management;
- approval engine;
- SLA/escalation runtime;
- human task platform;
- decision automation dengan DMN;
- legacy enterprise orchestration layer.

Namun Camunda 7 perlu dipelajari dengan konteks waktu yang benar. Camunda telah mengumumkan bahwa Camunda 7 Enterprise Edition EoL diperpanjang dari April 2027 ke April 2030, dan Camunda 7.24 menjadi release LTS penting. Setelah 7.24, arah strategis Camunda berada pada Camunda 8. Ini berarti engineer yang memegang Camunda 7 harus punya dua kemampuan sekaligus:

1. **Operate and evolve Camunda 7 safely** — karena sistem existing masih harus berjalan stabil.
2. **Prepare migration or coexistence path** — karena Camunda 8 bukan drop-in replacement.

Implikasi praktisnya:

- Jangan memperlakukan Camunda 7 sebagai teknologi hijau yang bisa di-scale secara naif.
- Jangan juga langsung membuangnya jika sistem existing sudah punya proses panjang, audit, dan history kompleks.
- Pahami dulu engine semantics-nya, lalu putuskan apakah sistem perlu dipertahankan, dipisah, di-refactor, atau dimigrasikan.

Camunda 7 bukan teknologi yang cukup dipahami dari “cara membuat delegate”. Di platform lama, value terbesar justru ada pada pemahaman operational correctness.

---

## 2. Apa yang Tidak Akan Diulang dari Seri Sebelumnya

Anda sudah menyelesaikan seri `learn-java-bpmn-camunda-process-orchestration-engineering`. Jadi seri ini tidak akan mengulang hal-hal berikut secara dasar:

- definisi umum BPMN;
- event, activity, gateway, pool, lane secara basic;
- start event / end event / service task / user task sebagai konsep dasar;
- pengenalan process orchestration;
- pengenalan JavaDelegate sederhana;
- pengenalan external task sederhana;
- pengenalan business key sederhana;
- pengenalan DMN dasar;
- pengenalan approval workflow sederhana;
- perbandingan orchestration vs choreography secara permukaan.

Seri ini akan naik level ke pertanyaan seperti:

- Apa yang sebenarnya terjadi di database saat process instance berjalan?
- Mengapa engine “meminjam thread caller” sampai wait state?
- Mengapa `asyncBefore` mengubah failure semantics?
- Apa bedanya job retry yang aman dan job retry yang menggandakan efek samping?
- Bagaimana job executor bekerja di cluster?
- Kapan optimistic locking adalah normal, kapan tanda desain buruk?
- Bagaimana mendesain variable agar long-running process tetap compatible lintas deployment?
- Bagaimana audit trail Camunda berbeda dari audit trail aplikasi biasa?
- Bagaimana memigrasikan instance proses yang sudah berjalan selama berbulan-bulan?
- Bagaimana mendesain workflow untuk enforcement/regulatory lifecycle yang defensible?

Dengan kata lain: seri ini bukan “belajar Camunda 7 dari nol”. Seri ini adalah “membaca Camunda 7 sebagai engine platform”.

---

## 3. Mental Model Utama: Camunda 7 sebagai Durable State Transition Engine

Cara paling berguna untuk memahami Camunda 7 adalah memandangnya sebagai engine yang mengubah **event** menjadi **state transition** secara durable.

Secara abstrak:

```text
External Trigger
    -> Process Engine API
        -> Command
            -> Execution Tree Mutation
                -> Variable Mutation
                    -> Job/Task/Event Subscription Mutation
                        -> History Mutation
                            -> Database Commit
```

Trigger bisa berupa:

- start process;
- complete user task;
- correlate message;
- signal execution;
- execute job;
- set variable;
- migrate instance;
- modify process instance;
- complete external task;
- fail external task;
- resolve incident.

Camunda 7 tidak “menjalankan proses” seperti thread panjang yang hidup terus-menerus. Camunda 7 menjalankan **potongan proses** dari trigger ke wait state berikutnya.

Contoh:

```text
User clicks "Submit Application"
    -> runtimeService.startProcessInstanceByKey(...)
        -> engine enters process
            -> executes automatic activities synchronously
                -> reaches User Task "Officer Review"
                    -> persists state
                        -> commits DB transaction
                            -> returns control to caller
```

Pada titik ini, tidak ada thread Java yang terus hidup untuk process instance tersebut. Yang hidup adalah **state yang tersimpan di database**.

Ketika officer menyelesaikan task:

```text
Officer completes task
    -> taskService.complete(...)
        -> engine reloads runtime state
            -> continues execution
                -> maybe calls delegate
                    -> maybe creates timer/job/message subscription
                        -> persists next wait state
                            -> commits
```

Ini adalah fondasi terpenting. Jika mental model ini salah, hampir semua keputusan Camunda akan salah.

---

## 4. Engine Pasif: Camunda Tidak Selalu Punya Thread Sendiri

Salah satu fakta penting dari dokumentasi Camunda 7: process engine adalah Java code yang pasif dan bekerja di thread client ketika dipanggil dari luar. Misalnya, saat HTTP request di aplikasi Spring Boot memanggil `runtimeService.startProcessInstanceByKey(...)`, thread HTTP itulah yang masuk ke process engine. Camunda menyebut model ini sebagai meminjam thread caller.

Implikasi besar:

1. Jika Anda start process dari endpoint REST, eksekusi awal process berjalan dalam request thread sampai wait state.
2. Jika delegate melakukan call HTTP lambat sebelum wait state, request thread ikut tertahan.
3. Jika delegate melempar exception sebelum wait state/commit, keseluruhan state yang belum commit akan rollback.
4. Jika proses tidak mencapai wait state dan menjalankan banyak logic sinkron, latency caller bisa meledak.
5. Jika Anda ingin memisahkan caller latency dari process continuation, Anda harus membuat boundary eksplisit, biasanya dengan async continuation.

Jadi Camunda 7 bukan selalu “background workflow engine”. Ia menjadi background ketika ada job executor mengambil job. Sampai titik tertentu, ia adalah library Java yang dieksekusi oleh caller.

Mental model:

```text
Without async boundary:

HTTP Thread
    start process
    service task A
    service task B
    user task reached
    DB commit
    return HTTP response
```

Dengan async boundary:

```text
HTTP Thread
    start process
    create async job before service task A
    DB commit
    return HTTP response

Job Executor Thread
    acquire job
    execute service task A
    service task B
    user task reached
    DB commit
```

Jangan memilih async karena “lebih modern”. Pilih async karena Anda ingin mengubah transaction boundary, retry boundary, latency boundary, dan ownership boundary.

---

## 5. Wait State: Konsep yang Lebih Penting daripada Task

Banyak orang belajar Camunda dari jenis task. Engineer yang kuat belajar dari **wait state**.

Wait state adalah titik di mana engine berhenti melanjutkan eksekusi, menyimpan state ke database, commit transaction, dan menunggu trigger berikutnya.

Contoh wait state umum:

- user task;
- receive task;
- message catch event;
- timer event;
- signal catch event;
- external task;
- asynchronous continuation job;
- event-based gateway yang menunggu event.

Mengapa wait state penting?

Karena wait state menentukan:

- kapan data process durable;
- kapan transaction commit;
- kapan thread caller dilepas;
- apa yang bisa di-retry;
- di mana operator bisa melihat state;
- di mana incident bisa muncul;
- sejauh mana rollback akan terjadi;
- apakah side effect sudah terjadi sebelum atau sesudah safety point.

Misalnya proses:

```text
Start
  -> Validate Input
  -> Call Payment Service
  -> Create License
  -> User Task Review
```

Jika semuanya sinkron sampai user task, maka `Validate Input`, `Call Payment Service`, dan `Create License` berada dalam satu transaction path Camunda sampai user task. Jika `Create License` gagal setelah payment berhasil di sistem eksternal, rollback database Camunda tidak akan membatalkan payment. Inilah sumber bug serius.

Dengan async boundary:

```text
Start
  -> Validate Input
  -> asyncBefore Call Payment Service
  -> Call Payment Service
  -> asyncAfter Call Payment Service
  -> Create License
  -> User Task Review
```

Kita menciptakan safety points yang lebih jelas. Tetapi ini juga menambah job, retry, latency, dan operational complexity. Tidak ada pilihan gratis.

---

## 6. Database sebagai Durability Boundary

Camunda 7 menggunakan database relasional untuk menyimpan runtime dan history state. Ini bukan detail implementasi kecil. Ini adalah karakter arsitektural utama.

Secara konseptual:

```text
BPMN Model      -> ACT_RE_*
Runtime State   -> ACT_RU_*
History State   -> ACT_HI_*
General Data    -> ACT_GE_*
Identity Data   -> ACT_ID_*
```

Artinya:

- process definition disimpan sebagai deployment/repository artifact;
- process instance runtime disimpan sebagai rows;
- task, execution, variable, job, event subscription adalah database entities;
- job executor berkoordinasi melalui database;
- cluster node tidak perlu saling bicara langsung untuk process state;
- history/audit juga adalah database write path.

Kelebihan model ini:

- strong durability dengan database relasional;
- mudah dioperasikan di enterprise yang sudah menguasai RDBMS;
- state bisa diinspeksi;
- cluster coordination sederhana;
- cocok untuk human workflow dan long-running case.

Kekurangannya:

- database menjadi pusat bottleneck;
- hot table bisa terjadi;
- high-throughput event streaming bukan use case terbaik;
- schema growth dan history cleanup harus serius;
- query task/history bisa mahal;
- lock/optimistic locking harus dipahami;
- long-running process membuat versioning jauh lebih kompleks.

Camunda 7 bukan Kafka. Camunda 7 bukan actor runtime. Camunda 7 bukan in-memory state machine. Camunda 7 adalah relational durable process engine.

---

## 7. Execution, Process Instance, dan Token: Jangan Disamakan secara Naif

Di BPMN, kita sering bicara “token berjalan dari satu activity ke activity lain”. Itu berguna untuk modelling. Tetapi di Camunda 7 runtime, representasi internal lebih dekat ke **execution tree**.

Istilah penting:

- **Process Definition**: blueprint/version dari proses.
- **Process Instance**: satu eksekusi konkret dari process definition.
- **Execution**: runtime entity yang merepresentasikan path/scope/concurrent branch.
- **Activity Instance**: representasi activity yang sedang/sempat aktif.
- **Task**: work item, biasanya human task atau external task, yang terkait execution.
- **Job**: work item internal untuk job executor.
- **Variable**: data yang melekat pada scope execution/process/task.
- **Event Subscription**: waiting point untuk message/signal/compensation/condition.

Kesalahan umum:

> “Satu process instance = satu row execution.”

Kadang benar untuk proses sederhana. Tetapi pada parallel gateway, subprocess, multi-instance, event subprocess, dan compensation, satu process instance bisa memiliki banyak execution entity.

Mental model yang lebih tepat:

```text
Process Instance
└── Root Execution
    ├── Execution for Branch A
    │   └── Activity: Review Application
    └── Execution for Branch B
        └── Activity: Fraud Screening
```

Dampak engineering:

- parallel gateway bisa memicu optimistic locking saat join;
- variable scope bisa membingungkan jika tidak eksplisit;
- local variable bisa “hilang” dari perspektif root process;
- incident bisa terkait job/execution tertentu;
- process instance modification bisa mengubah execution tree secara non-trivial;
- migration harus memetakan activity instance dengan benar.

Di seri ini, kita akan sering menggunakan execution tree sebagai cara membaca masalah.

---

## 8. Job Executor: Komponen Aktif untuk Melanjutkan Pekerjaan

Jika engine pasif meminjam thread caller, maka job executor adalah komponen aktif yang membuat Camunda bisa melanjutkan pekerjaan asynchronous.

Job dibuat misalnya ketika:

- timer event jatuh tempo;
- activity diberi `camunda:asyncBefore="true"`;
- activity diberi `camunda:asyncAfter="true"`;
- batch operation berjalan;
- history cleanup berjalan;
- process continuation perlu dijalankan async.

Secara umum job processing memiliki tiga tahap:

```text
Job Creation
    -> Job Acquisition
        -> Job Execution
```

Di cluster, beberapa node job executor bisa polling table `ACT_RU_JOB`. Agar job tidak dieksekusi oleh banyak node sekaligus, Camunda mengunci job dengan `LOCK_OWNER_` dan `LOCK_EXP_TIME_`, menggunakan optimistic locking untuk konflik acquisition.

Mental model:

```text
Node A Job Executor        Node B Job Executor
        |                         |
        | query ACT_RU_JOB         | query ACT_RU_JOB
        | lock job X               | tries lock job X
        | succeeds                 | fails optimistic lock
        | execute job X            |
        | update state             |
```

Poin penting:

- Job executor bukan magic exactly-once processor dalam arti distributed side effects.
- Job lock hanya mengontrol eksekusi job di Camunda DB.
- Jika delegate memanggil sistem eksternal, retry bisa mengulang side effect.
- Karena itu idempotency adalah kewajiban desain, bukan optional improvement.

Contoh bug klasik:

```text
Job executes service task: book ticket
External system books ticket successfully
Delegate throws timeout before Camunda commits success
Job retry runs again
External system books second ticket
```

Solusi bukan “matikan retry”. Solusi adalah desain idempotent:

- gunakan business idempotency key;
- simpan outbound command record;
- gunakan transactional outbox;
- cek status remote sebelum mengulang;
- pisahkan command submission dari status confirmation;
- modelkan acknowledgement sebagai message event.

---

## 9. Async Boundary adalah Safety Point, Bukan Sekadar Threading

`asyncBefore` dan `asyncAfter` sering disalahpahami sebagai “jalankan di background”. Itu hanya efek permukaan. Makna sebenarnya adalah mengubah boundary:

- transaction boundary;
- persistence boundary;
- retry boundary;
- incident boundary;
- thread ownership boundary;
- caller latency boundary;
- observability boundary.

Contoh tanpa async:

```text
Start -> A -> B -> C -> User Task
```

Jika B gagal, semua sejak start rollback sampai trigger awal.

Contoh dengan `asyncBefore` B:

```text
Start -> A -> [commit job for B]
Job -> B -> C -> User Task
```

Jika B gagal, proses sudah durable sebelum B. Operator bisa melihat failed job/incident. Retry terjadi dari B, bukan dari start.

Contoh dengan `asyncAfter` B:

```text
Start -> A -> B -> [commit job after B]
Job -> C -> User Task
```

Jika B berhasil dan commit job setelah B, maka kegagalan C tidak mengulang B.

Ini sangat penting untuk side effect.

Rule of thumb:

- `asyncBefore` cocok untuk membuat safety point sebelum aktivitas berisiko.
- `asyncAfter` cocok untuk mencegah aktivitas yang sudah sukses diulang saat langkah berikutnya gagal.
- kombinasi keduanya kadang perlu untuk aktivitas non-transactional external side effect.
- terlalu banyak async boundary memperbanyak job dan overhead.
- terlalu sedikit async boundary memperbesar rollback blast radius.

---

## 10. Camunda 7 vs State Machine Biasa

Sebuah state machine biasa bisa direpresentasikan sebagai:

```text
state + event -> next state
```

Camunda 7 juga bisa dipandang begitu, tetapi dengan fitur tambahan:

```text
process definition + execution tree + variables + jobs + tasks + event subscriptions + history
    + trigger
        -> next durable process state
```

State machine biasa unggul ketika:

- state kecil dan eksplisit;
- transisi sederhana;
- tidak butuh BPMN visual;
- tidak butuh human task engine;
- tidak butuh timer/job/history kompleks;
- lifecycle pendek;
- throughput tinggi;
- domain state bisa dimiliki penuh oleh aplikasi.

Camunda unggul ketika:

- proses long-running;
- banyak human handoff;
- perlu timer/escalation;
- perlu audit timeline;
- perlu process visibility;
- perlu recoverability dan operator intervention;
- flow sering didiskusikan dengan business/BA/compliance;
- process definition perlu versioning;
- case lifecycle punya banyak branch dan waiting point.

Tetapi Camunda bisa menjadi pilihan buruk jika dipakai untuk:

- request-response orchestration ultra-low latency;
- event streaming throughput sangat tinggi;
- business logic kecil yang bisa jadi method call;
- proses yang berubah setiap hari tanpa governance;
- kompleksitas domain yang seharusnya dimodelkan di aggregate/domain model;
- semua integrasi microservice hanya karena “ingin visual”.

Top engineer tidak bertanya “bisa tidak pakai Camunda?” tetapi “apa boundary yang pantas dimiliki Camunda?”

---

## 11. Camunda 7 vs Queue Worker

Queue worker pattern:

```text
Producer -> Queue -> Worker -> DB/External System
```

Camunda job executor mirip worker, tetapi job-nya bukan message bebas. Job adalah representasi continuation dari process execution.

Perbedaan penting:

| Aspek | Queue Worker | Camunda 7 Job Executor |
|---|---|---|
| Unit kerja | Message/task bebas | Continuation proses |
| State utama | Aplikasi/DB/queue | Camunda DB runtime state |
| Retry | Queue retry/DLQ | Job retries/incidents |
| Visibility | Tergantung tooling queue | Cockpit/API/history |
| Workflow graph | Biasanya implicit | BPMN executable model |
| Human task | Harus dibuat sendiri | Built-in task service |
| Timer | Scheduler/queue delay | Timer job/event |
| Versioning process | Manual | Process definition versioning |

Queue worker lebih baik untuk simple asynchronous tasks. Camunda lebih baik untuk stateful long-running process dengan branching, waiting, and human involvement.

Namun Camunda bukan pengganti semua queue. Dalam sistem matang, Camunda sering hidup bersama queue/event broker:

```text
Camunda Process
    -> Outbox Command
        -> Kafka/RabbitMQ
            -> Service Worker
                -> Result Event
                    -> Message Correlation back to Camunda
```

Ini lebih aman daripada membuat Camunda delegate memanggil semua service secara sinkron.

---

## 12. Camunda 7 vs Scheduler

Scheduler menjalankan pekerjaan berdasarkan waktu. Camunda timer event juga berdasarkan waktu. Tapi Camunda timer bukan sekadar cron.

Scheduler:

```text
At 09:00 run job X
```

Camunda timer:

```text
For process instance P, if officer does not review in 3 days, trigger escalation path
```

Perbedaannya ada pada context. Timer Camunda melekat pada process instance, execution, dan business context.

Contoh:

```text
Application Submitted
    -> User Task: Review Application
       boundary timer: PT72H
           -> Escalate to Supervisor
```

Timer ini bukan hanya waktu. Ia membawa makna:

- siapa applicant;
- task apa yang terlambat;
- SLA apa yang dilanggar;
- branch apa yang harus dieksekusi;
- history apa yang harus tercatat;
- operator mana yang harus melihat incident/escalation.

Gunakan scheduler jika pekerjaan tidak membutuhkan process-context. Gunakan Camunda timer jika waktu adalah bagian dari lifecycle state.

---

## 13. Camunda 7 vs Saga Framework

Saga adalah pola untuk koordinasi transaksi terdistribusi menggunakan local transaction dan compensation. Camunda bisa digunakan sebagai saga orchestrator, tetapi tidak semua proses Camunda adalah saga.

Saga fokus pada:

- step A berhasil;
- step B gagal;
- compensate A;
- state konsisten secara eventual.

Camunda menyediakan:

- BPMN control flow;
- compensation event;
- error boundary;
- transaction boundary;
- retry/incident;
- human recovery task;
- timer escalation;
- audit history.

Dalam saga engineering, Camunda membantu karena flow terlihat dan state durable. Namun bahaya besarnya adalah mengira BPMN compensation otomatis menyelesaikan masalah distributed consistency. Tidak.

Compensation tetap membutuhkan:

- operasi kompensasi yang benar secara bisnis;
- idempotency;
- ordering guarantee;
- observability;
- timeout handling;
- manual intervention path;
- reconciliation.

Top engineer memahami bahwa Camunda memberi framework koordinasi, bukan menghapus kompleksitas domain.

---

## 14. BPMN sebagai Executable Contract

BPMN di Camunda 7 bukan hanya dokumentasi. BPMN adalah artifact executable. Ini mengubah cara kita harus memperlakukannya.

BPMN production harus diperlakukan seperti code:

- versioned;
- reviewed;
- tested;
- migrated;
- monitored;
- backward-compatible;
- guarded by invariants;
- connected to release process;
- aligned with operational runbook.

Kesalahan umum:

> “Diagramnya business-friendly, jadi bisa bebas diubah.”

Salah. Diagram BPMN executable adalah program. Perubahan pada gateway, activity id, boundary event, message name, variable name, atau call activity binding bisa menghancurkan process instance yang sedang berjalan.

BPMN executable punya dua audience:

1. Business/compliance audience: memahami lifecycle, responsibility, decision point.
2. Runtime/engineering audience: memahami transaction, retry, wait state, variable scope, migration path.

Model yang baik harus melayani keduanya tanpa mengorbankan correctness.

---

## 15. Top 1% Mental Model: Camunda sebagai Boundary of Responsibility

Dalam platform enterprise, pertanyaan terbesar bukan “bagaimana menaruh logic di delegate”, tetapi:

> “Responsibility apa yang seharusnya dimiliki process engine?”

Camunda bisa bertanggung jawab atas:

- process state;
- wait state;
- human task lifecycle;
- escalation timer;
- retries;
- incidents;
- process audit;
- visibility;
- orchestration decision;
- process versioning;
- migration;
- operational intervention.

Camunda sebaiknya tidak bertanggung jawab penuh atas:

- semua domain invariant;
- semua validation detail;
- semua integration protocol;
- semua reporting analytics;
- all-purpose audit trail;
- high-volume event processing;
- object graph persistence;
- UI state;
- permission model aplikasi secara lengkap;
- data warehouse/history jangka panjang tanpa archival strategy.

Jika boundary tidak jelas, Camunda process berubah menjadi “god workflow”:

```text
BPMN contains:
- domain logic
- integration logic
- validation logic
- authorization logic
- mapping logic
- notification logic
- reporting flags
- cleanup logic
- retry logic
- manual override logic
```

Hasilnya sulit dites, sulit dimigrasikan, dan sulit dioperasikan.

Boundary yang sehat:

```text
BPMN:
  owns lifecycle and coordination

Domain Service:
  owns business invariants and state mutation

Integration Adapter:
  owns external protocol and idempotency

Outbox/Event Layer:
  owns durable external communication

Camunda History + App Audit:
  owns process trace + business audit trace
```

---

## 16. Java 8 sampai Java 25: Compatibility Mindset

User requirement seri ini mencakup Java 8 sampai Java 25. Namun Camunda 7 tidak boleh dipahami seolah-olah semua kombinasi Camunda/Spring/Java/app server selalu valid.

Cara berpikir yang benar:

- Java 8 penting untuk legacy Camunda 7 deployment lama.
- Java 11/17 penting untuk modernized Camunda 7 estate.
- Java 21 relevan pada support environment modern Camunda 7.24/Spring Boot 3 era.
- Java 25 perlu dibahas sebagai forward-looking Java language/runtime knowledge, tetapi tidak boleh diasumsikan didukung otomatis oleh Camunda 7.
- Spring Boot 2 vs Spring Boot 3 membawa perubahan besar karena `javax.*` ke `jakarta.*` ecosystem shift.
- Java EE/Jakarta EE migration tidak hanya compile issue, tetapi classloading, servlet API, app server, transaction manager, dan dependency alignment issue.

Dalam seri ini, ketika membahas Java 8–25, kita akan memisahkan:

1. **Language feature relevance** — fitur Java apa yang berguna untuk menulis worker/delegate/test/tooling.
2. **Runtime compatibility** — Camunda versi tertentu benar-benar support Java/runtime tertentu atau tidak.
3. **Library ecosystem compatibility** — Spring Boot, app server, JDBC driver, Jackson, logging, Jakarta namespace.
4. **Operational supportability** — apakah vendor support, security patch, dan production policy mengizinkan kombinasi tersebut.

Contoh:

```text
Java record bagus untuk immutable DTO.
Tetapi jika process variable diserialisasi sebagai Java object dan long-running instance hidup lintas deployment,
record class evolution bisa menjadi masalah compatibility.
```

Contoh lain:

```text
Virtual thread bagus untuk high-concurrency blocking IO.
Tetapi menaruh blocking remote call panjang di JavaDelegate tetap tidak otomatis benar,
karena masalah utama bisa berada pada transaction boundary dan side-effect retry,
bukan hanya thread cost.
```

Top engineer tidak hanya bertanya “bisa compile?” tetapi “apakah kombinasi ini supportable, recoverable, dan migration-safe?”

---

## 17. Topologi Camunda 7: Embedded, Shared, Remote

Camunda 7 bisa dipakai dalam beberapa topologi. Setiap topologi membawa trade-off berbeda.

### 17.1 Embedded Engine

```text
Spring Boot App
├── REST Controller
├── Business Services
├── Camunda Process Engine
└── Database
```

Kelebihan:

- deployment sederhana;
- delegate bisa langsung memakai Spring beans;
- transaction integration natural;
- cocok untuk modular monolith/process-centric app;
- testing relatif mudah.

Risiko:

- process engine coupling dengan application release;
- classpath/version coupling;
- long-running process terkena perubahan code deployment;
- scaling API dan job executor bisa bercampur;
- jika aplikasi down, engine down.

### 17.2 Shared Engine

```text
Application Server
├── Shared Camunda Engine
├── Process Application A
├── Process Application B
└── Camunda Webapps
```

Kelebihan:

- central engine;
- cocok untuk legacy Java EE estate;
- webapps/tasklist/cockpit/admin integrated;
- multiple process application.

Risiko:

- classloading kompleks;
- deployment coupling;
- app server operational complexity;
- debugging lebih sulit;
- modern cloud-native practices lebih berat.

### 17.3 Remote Engine

```text
Business App / UI / Service
    -> REST API
        -> Camunda Engine Service
            -> Camunda DB
```

Kelebihan:

- boundary lebih jelas;
- app tidak embed engine;
- multi-language client mungkin;
- engine bisa dikelola sebagai platform;
- lebih dekat ke migration/coexistence thinking.

Risiko:

- REST API chatty jika desain buruk;
- transaction dengan business DB tidak satu boundary;
- membutuhkan API governance;
- latency dan error handling harus dirancang;
- authentication/authorization lebih serius.

Tidak ada topologi paling benar. Yang ada adalah topologi yang cocok untuk boundary, team ownership, operational maturity, dan migration roadmap.

---

## 18. Camunda 7 dalam Sistem Regulatory / Case Management

Untuk konteks regulatory case management, Camunda menarik karena banyak lifecycle bersifat:

- long-running;
- human-heavy;
- audit-sensitive;
- SLA-driven;
- escalation-heavy;
- exception-heavy;
- multi-role;
- versioned;
- legally defensible.

Contoh lifecycle enforcement sederhana:

```text
Case Opened
  -> Assign Officer
  -> Preliminary Assessment
  -> Request Information? ── yes ──> Wait for Response
  -> Investigation
  -> Supervisor Review
  -> Enforcement Decision
  -> Issue Notice
  -> Appeal Window Timer
  -> Closure / Appeal Process
```

Camunda bisa menjadi execution backbone untuk lifecycle tersebut. Tetapi desain harus hati-hati.

Camunda tidak boleh menjadi satu-satunya source of truth untuk semua case data. Biasanya perlu pemisahan:

```text
Case Domain DB:
  case profile, parties, evidence, documents, status summary, domain invariants

Camunda Runtime DB:
  process execution state, tasks, jobs, event subscriptions, variables needed by process

Audit/Event Store/History:
  domain audit, process history, user operation, legal evidence timeline
```

Camunda process state dan domain case state harus konsisten secara desain. Jangan biarkan keduanya saling bertentangan tanpa reconciliation strategy.

Contoh invariant:

```text
A case cannot be closed if active enforcement notice exists and appeal window is still open.
```

Pertanyaan desain:

- invariant ini tinggal di BPMN gateway?
- domain service?
- DB constraint?
- authorization service?
- semua di atas dengan responsibility berbeda?

Jawaban senior: domain invariant utama harus dimiliki domain model/service. BPMN boleh merepresentasikan flow dan decision point, tetapi tidak boleh menjadi satu-satunya penjaga invariant kritikal.

---

## 19. Failure Modelling: Camunda Tidak Menghilangkan Kegagalan

Camunda membuat kegagalan lebih terlihat dan lebih recoverable, tetapi tidak menghapusnya.

Jenis kegagalan:

1. **Model failure**  
   BPMN salah menggambarkan lifecycle.

2. **Technical failure**  
   HTTP timeout, DB deadlock, network error, serialization error.

3. **Business failure**  
   applicant tidak eligible, document invalid, payment rejected.

4. **Operational failure**  
   job executor mati, DB penuh, history cleanup gagal, deployment salah.

5. **Concurrency failure**  
   optimistic locking, duplicate message, double completion, race correlation.

6. **Versioning failure**  
   process instance lama memakai delegate/variable/model yang berubah.

7. **Audit failure**  
   system state bisa berjalan, tetapi tidak bisa menjawab “siapa melakukan apa, kapan, dan mengapa”.

8. **Recovery failure**  
   incident muncul, tetapi operator tidak punya safe action.

Top engineer mendesain process bukan hanya happy path:

```text
Happy Path:
  Submit -> Review -> Approve -> Close

Real Path:
  Submit -> Validate -> Missing Info -> Wait -> Timeout -> Escalate
  -> Reopen -> Supervisor Override -> Error -> Retry -> Incident
  -> Manual Repair -> Resume -> Appeal -> Rework -> Close
```

Jika model tidak punya recovery semantics, proses belum production-grade.

---

## 20. Idempotency: Prinsip Wajib Camunda Production

Camunda job retry bisa mengulang aktivitas. HTTP client bisa timeout setelah remote side berhasil. External task worker bisa crash setelah menyelesaikan kerja tetapi sebelum complete task. Message bisa terkirim dua kali. User bisa double-click. Operator bisa retry incident.

Karena itu idempotency adalah prinsip wajib.

Idempotency berarti operasi aman diulang tanpa menggandakan efek buruk.

Contoh buruk:

```java
public void execute(DelegateExecution execution) {
    paymentClient.charge(customerId, amount);
}
```

Jika job retry terjadi, charge bisa dobel.

Lebih baik:

```java
public void execute(DelegateExecution execution) {
    String commandId = execution.getProcessBusinessKey() + ":charge-initial-fee";
    paymentClient.charge(commandId, customerId, amount);
}
```

Tetapi ini pun belum cukup jika payment service tidak mendukung idempotency key.

Pattern lebih matang:

```text
Camunda Delegate
    -> create outbound command in application DB with unique business key
        -> commit
            -> outbox publisher sends command
                -> payment service processes idempotently
                    -> emits result event
                        -> Camunda message correlation resumes process
```

Trade-off:

- lebih banyak komponen;
- lebih lambat secara end-to-end;
- jauh lebih recoverable;
- audit lebih jelas;
- retry lebih aman.

---

## 21. Variable Strategy: Jangan Jadikan Camunda sebagai Object Store

Camunda variable berguna untuk process state, routing decision, payload kecil, dan correlation context. Tetapi menyimpan semua domain object sebagai process variable adalah anti-pattern.

Masalah variable besar:

- serialization bengkak;
- history membengkak;
- query lambat;
- deserialization gagal setelah class berubah;
- sensitive data tersebar;
- DB storage cepat penuh;
- migration sulit;
- debugging raw serialized object menyakitkan.

Prinsip:

```text
Store in Camunda:
- process-relevant identifiers
- routing flags
- small immutable decision snapshots
- correlation keys
- timestamps relevant to process
- outcome codes

Store in domain DB/object storage:
- large documents
- full application form
- evidence files
- rich aggregate object
- sensitive data requiring separate access control
- large audit payload
```

Contoh variable sehat:

```json
{
  "caseId": "CASE-2026-000123",
  "agency": "CEA",
  "riskBand": "HIGH",
  "requiresSupervisorApproval": true,
  "submissionDate": "2026-06-20",
  "appealWindowDays": 14
}
```

Contoh variable berbahaya:

```json
{
  "entireApplicationForm": { "...": "10MB nested object" },
  "allUploadedDocumentsBase64": ["..."],
  "fullUserProfile": { "...": "PII everywhere" },
  "hibernateEntitySerialized": "..."
}
```

Variable bukan domain database.

---

## 22. History dan Audit: Mirip, Tapi Tidak Sama

Camunda history menyimpan riwayat process execution. Audit bisnis/regulasi menyimpan bukti tindakan yang bisa dipertanggungjawabkan.

Camunda history bisa menjawab:

- process instance kapan dimulai/selesai;
- activity apa yang dilalui;
- task siapa yang claim/complete;
- variable apa berubah;
- decision apa dievaluasi;
- incident apa terjadi.

Audit bisnis mungkin perlu menjawab:

- siapa officer yang membuat rekomendasi;
- dasar hukum apa yang digunakan;
- dokumen bukti mana yang dipakai;
- versi template notice apa yang dikirim;
- apakah user punya authority saat action dilakukan;
- apakah action dilakukan sebelum/after SLA;
- apakah override punya alasan dan approval yang sah.

Camunda history membantu, tetapi tidak selalu cukup. Untuk regulatory system, sering perlu audit layer tambahan yang domain-aware.

Mental model:

```text
Camunda History:
  execution trace

Domain Audit:
  legally meaningful business action trace

Security Audit:
  authentication/authorization/session trace

Document Audit:
  evidence/template/file trace
```

Jangan mengandalkan satu history table untuk semua kebutuhan compliance.

---

## 23. Process Versioning: Masalah yang Sering Diremehkan

Camunda process definition versioning terlihat mudah: deploy BPMN baru, version naik. Tetapi long-running process membuat versioning sulit.

Misalnya:

```text
Version 1:
  Start -> Review -> Approve -> End

Version 2:
  Start -> Review -> Risk Assessment -> Approve -> End
```

Pertanyaan:

- instance lama tetap di version 1 atau migrate ke version 2?
- apakah activity id berubah?
- apakah variable lama compatible?
- apakah task form lama masih tersedia?
- apakah delegate class lama masih ada?
- apakah history tetap bisa dibaca?
- apakah call activity binding berubah?
- apakah message name berubah?
- apakah operator tahu instance mana di versi apa?

BPMN change adalah production change. Treat it like schema migration plus code migration plus business policy migration.

Rule:

- jangan rename activity id sembarangan;
- jangan hapus wait state yang masih ditempati instance aktif tanpa migration plan;
- jangan ubah variable schema tanpa compatibility strategy;
- jangan deploy delegate incompatible untuk process instance lama;
- jangan assume “latest version” selalu benar untuk call activity;
- dokumentasikan migration plan.

---

## 24. Camunda 7 dan Microservices: Jangan Salah Boundary

Ada dua gaya umum:

### 24.1 Engine Embedded dalam Service

```text
Case Service
├── Camunda Engine
├── Case Domain Model
└── Case DB / Camunda DB
```

Cocok jika proses adalah bagian dari bounded context service.

### 24.2 Engine sebagai Orchestration Service

```text
Process Orchestrator
├── Camunda Engine
└── Process DB

Case Service
Payment Service
Notification Service
Document Service
```

Cocok jika orchestration melintasi beberapa bounded context.

Bahaya:

```text
Camunda process directly manipulates every service database
```

Itu melanggar service boundary.

Lebih sehat:

```text
Camunda process sends commands / waits for events
Services own their own data and invariants
```

Camunda boleh menjadi process coordinator, tetapi jangan menjadi database integration script yang digambar dalam BPMN.

---

## 25. Observability: Process Runtime Harus Bisa Dibaca

Camunda production harus bisa menjawab:

- proses mana yang stuck?
- job mana yang gagal?
- incident apa yang paling banyak?
- task queue mana yang bottleneck?
- SLA mana yang akan breach?
- timer mana yang overdue?
- process definition version mana yang bermasalah?
- message correlation mana yang gagal?
- worker mana yang lambat?
- query mana yang menekan DB?

Observability Camunda mencakup:

```text
Business Metrics:
  SLA, backlog, open cases, aging, throughput

Engine Metrics:
  jobs acquired/executed/failed, incidents, task count

DB Metrics:
  hot tables, slow queries, locks, storage, index usage

Application Metrics:
  delegate latency, external call latency, error rate

Worker Metrics:
  fetch/lock rate, completion rate, failure rate, lock expiration

Audit Metrics:
  unusual override, repeated reopen, manual repair frequency
```

Jangan hanya memonitor JVM. Process engine failure sering terlihat dulu dari backlog, incident, dan DB growth.

---

## 26. Security Boundary

Camunda 7 menyediakan identity/authorization service dan webapps seperti Admin, Cockpit, Tasklist. Namun dalam enterprise system, security model harus dibaca secara berlapis:

```text
Authentication:
  siapa usernya?

Authorization:
  boleh melakukan action apa?

Task Assignment:
  work item ini tersedia untuk siapa?

Business Permission:
  secara domain, user ini boleh approve case ini?

Data Access:
  boleh melihat field/document apa?

Operational Permission:
  boleh retry job/migrate instance/delete deployment?
```

Camunda authorization tidak otomatis menggantikan domain authorization. Candidate group di user task tidak sama dengan permission final untuk action sensitif.

Contoh:

```text
User belongs to candidate group "officer".
Tetapi case berada di agency/team lain.
Atau user punya conflict of interest.
Atau approval membutuhkan grade tertentu.
```

Maka domain service tetap harus memvalidasi business permission ketika task complete/action dilakukan.

---

## 27. Migration to Camunda 8: Jangan Dianggap Upgrade Biasa

Camunda 8 bukan drop-in replacement untuk Camunda 7. Ini sangat penting. Camunda 8 menggunakan arsitektur berbeda dengan Zeebe sebagai distributed workflow engine, worker model yang berbeda, persistence/operation model berbeda, dan coverage fitur BPMN yang tidak identik.

Implikasi:

- migration bukan sekadar ubah dependency Maven;
- BPMN model perlu ditinjau;
- delegate model berubah ke worker model;
- history/runtime data tidak otomatis pindah begitu saja;
- external task semantics perlu dipetakan ulang;
- operational model berubah;
- migration harus process-by-process;
- coexistence mungkin diperlukan.

Karena itu seri ini akan membahas Camunda 7 dengan dua tujuan:

1. Membuat Camunda 7 estate tetap aman dan maintainable.
2. Mengurangi coupling agar suatu hari bisa keluar/migrasi dengan risiko lebih rendah.

Pattern yang membantu migration readiness:

- hindari terlalu banyak internal engine API;
- gunakan external task/message/outbox untuk boundary eksternal;
- kurangi Java object variable;
- stabilkan business key/correlation key;
- pisahkan domain service dari BPMN;
- dokumentasikan process invariants;
- test process behavior secara executable;
- audit model versioning.

---

## 28. Prinsip Desain yang Akan Dipakai Sepanjang Seri

### 28.1 Make Wait States Intentional

Setiap wait state harus punya alasan:

- menunggu manusia;
- menunggu event;
- menunggu waktu;
- membuat safety point;
- memisahkan retry;
- melepaskan caller;
- membuat operation visible.

Jika wait state tidak punya alasan, mungkin model terlalu fragmented.

### 28.2 Make Side Effects Idempotent

Semua aktivitas yang bisa diulang harus aman diulang. Jika tidak aman, jangan mengandalkan retry default.

### 28.3 Keep Domain Truth Outside BPMN

BPMN mengatur lifecycle. Domain service menjaga invariant.

### 28.4 Store References, Not Worlds

Camunda variable sebaiknya menyimpan ID dan process context kecil, bukan seluruh dunia domain.

### 28.5 Version for Long-Running Reality

Setiap BPMN deployment harus mempertimbangkan instance lama.

### 28.6 Design for Operators

Jika proses gagal, operator harus tahu:

- apa yang gagal;
- mengapa gagal;
- apakah aman di-retry;
- siapa yang harus memperbaiki;
- apa dampak bisnis;
- bagaimana melanjutkan.

### 28.7 Treat BPMN as Code

Review, test, version, migrate, observe.

### 28.8 Avoid Engine-Centric Architecture

Jangan membuat semua hal berputar di Camunda. Camunda adalah coordination layer, bukan seluruh platform.

---

## 29. Cara Membaca Dokumentasi Camunda 7 seperti Engineer Senior

Jangan membaca dokumentasi hanya sebagai daftar fitur. Baca dengan pertanyaan:

1. Apa boundary transaksi fitur ini?
2. Data apa yang ditulis ke table runtime/history?
3. Apa yang terjadi jika exception terjadi sebelum commit?
4. Apa yang terjadi jika node mati setelah external side effect?
5. Apakah ada retry? Retry dari titik mana?
6. Apakah fitur ini aman di cluster?
7. Apakah fitur ini bergantung pada deployment/classpath?
8. Bagaimana observability-nya?
9. Bagaimana migrasinya jika model berubah?
10. Bagaimana authorization-nya?
11. Apakah fitur ini compatible dengan future migration ke Camunda 8?

Contoh membaca `asyncBefore`:

Bukan:

> “Oh, ini membuat task async.”

Tetapi:

> “Ini membuat job sebelum activity, commit state sebelum activity, memindahkan execution ke job executor, memberi retry boundary pada activity, membuka kemungkinan incident, mengubah latency caller, dan menuntut idempotency jika activity punya side effect.”

Itulah level pemahaman yang kita kejar.

---

## 30. Mini Map: Satu Process dari Awal sampai Operasi Produksi

Bayangkan proses regulatory case:

```text
Start Case
  -> Validate Submission
  -> asyncBefore Initial Risk Assessment
  -> Initial Risk Assessment
  -> User Task: Officer Review
      boundary timer: 3 business days
          -> Escalate to Supervisor
  -> Decision: Approve / Reject / Request Info
  -> Send Notice
  -> Wait for Appeal Window
  -> Close Case
```

Apa yang harus dipahami engineer?

### Runtime

- process instance dibuat;
- execution tree berjalan;
- user task dibuat;
- timer job dibuat;
- variables disimpan;
- event subscription mungkin dibuat.

### Transaction

- start sampai asyncBefore commit;
- risk assessment dijalankan oleh job;
- user task menjadi wait state;
- timer boundary menjadi job;
- task completion melanjutkan execution.

### Failure

- risk service timeout;
- job retry;
- incident jika retry habis;
- notice service berhasil tapi delegate gagal;
- officer complete task bersamaan dengan timer firing;
- optimistic locking mungkin terjadi.

### Operations

- officer backlog;
- failed job count;
- overdue timer;
- slow query tasklist;
- history cleanup;
- storage growth.

### Versioning

- policy berubah: supervisor review wajib untuk high risk;
- instance lama harus tetap valid;
- migration plan harus jelas.

### Security

- officer hanya boleh lihat assigned agency;
- supervisor approval butuh role tertentu;
- operator boleh retry incident tetapi tidak boleh modify process sembarangan.

### Audit

- siapa submit;
- siapa review;
- kapan escalation terjadi;
- notice versi apa dikirim;
- alasan rejection;
- apakah SLA breached.

Inilah Camunda engineering. Bukan hanya “gambar flow”.

---

## 31. Kapan Camunda 7 Cocok Digunakan

Gunakan Camunda 7 jika banyak kondisi berikut benar:

- proses long-running;
- ada human approval/review;
- lifecycle punya banyak waiting point;
- perlu audit process-level;
- perlu timer/escalation;
- perlu recoverability;
- process visibility penting;
- process versioning dibutuhkan;
- business stakeholders perlu melihat flow;
- exception path kompleks;
- operator perlu inspect/retry/repair;
- case status tidak cukup direpresentasikan oleh satu enum sederhana.

Contoh cocok:

- license application processing;
- regulatory enforcement lifecycle;
- claims processing;
- onboarding with manual checks;
- approval workflow multi-level;
- document review lifecycle;
- KYC remediation;
- dispute/appeal handling;
- fulfillment dengan human exception handling.

---

## 32. Kapan Camunda 7 Tidak Cocok

Hindari Camunda 7 jika:

- proses hanya CRUD sederhana;
- lifecycle bisa direpresentasikan oleh state enum kecil;
- throughput event sangat tinggi dan human task tidak ada;
- latency sangat rendah lebih penting daripada visibility;
- logic berubah terlalu sering tanpa governance;
- team tidak siap mengoperasikan DB/job/history;
- hanya ingin “diagram cantik”;
- semua logic tetap di service dan BPMN hanya pass-through;
- process instance sangat banyak dengan state trivial;
- audit bisa dipenuhi event log aplikasi biasa.

Contoh tidak cocok:

```text
HTTP request -> validate -> insert row -> return response
```

Tidak perlu Camunda.

Contoh lain:

```text
Consume 50k events/second -> enrich -> publish
```

Lebih cocok Kafka/Flink/stream processor, bukan Camunda 7.

---

## 33. Anti-Pattern Awal yang Harus Diwaspadai

### 33.1 God Process

Satu BPMN menangani semua variasi domain, semua integrasi, semua exception, semua policy.

Gejala:

- diagram sangat besar;
- gateway terlalu banyak;
- activity id tidak stabil;
- sulit dites;
- migration hampir mustahil;
- operator bingung.

### 33.2 Delegate as Transaction Script Dump

JavaDelegate berisi mapping, validation, DB update, HTTP call, authorization, notification, dan audit sekaligus.

Solusi:

- delegate tipis;
- panggil application service;
- application service punya contract jelas;
- external side effects idempotent.

### 33.3 Variable Dumping

Semua object dimasukkan ke process variables.

Solusi:

- simpan reference;
- snapshot kecil;
- domain data di domain DB.

### 33.4 Async Everywhere

Semua activity diberi async karena dianggap lebih aman.

Dampak:

- job table membengkak;
- latency naik;
- debugging lebih rumit;
- ordering/race lebih banyak;
- job executor load naik.

### 33.5 Async Nowhere

Tidak ada async boundary. Semua berjalan sinkron sampai wait state alami.

Dampak:

- rollback blast radius besar;
- side effect risk tinggi;
- caller latency tinggi;
- incident visibility rendah sebelum wait state.

### 33.6 Business Error as Java Exception

Semua business rejection dilempar sebagai exception.

Solusi:

- gunakan BPMN error untuk expected business alternative;
- gunakan exception untuk technical failure;
- modelkan business outcome secara eksplisit.

### 33.7 Manual DB Mutation

Mengubah table `ACT_*` langsung untuk memperbaiki process.

Ini sangat berbahaya. Gunakan API engine, management service, migration/modification API, atau recovery tooling resmi. Direct mutation hanya untuk emergency dengan pemahaman internal tinggi dan backup/approval ketat.

---

## 34. Learning Contract untuk Seri Ini

Setiap part berikutnya akan mengikuti pola:

1. **Mental model** — apa konsep inti dan bagaimana memikirkannya.
2. **Engine semantics** — apa yang terjadi di runtime.
3. **Java implementation** — bagaimana menulis code yang benar.
4. **Failure model** — apa yang bisa salah.
5. **Operational view** — bagaimana mengamati dan memperbaiki.
6. **Design trade-off** — kapan dipakai/kapan dihindari.
7. **Checklist** — bagaimana menerapkan di production.

Kita tidak akan mengejar hafalan API. API bisa dibaca. Yang sulit adalah tahu kapan API tertentu aman, kapan berbahaya, dan apa konsekuensinya setelah 2 tahun process instance hidup di production.

---

## 35. Peta Seri Lengkap

Seri ini dirancang menjadi 36 bagian:

```text
part-000  Orientation, Scope, Mental Model, dan Peta Belajar
part-001  Camunda 7 Architecture Deep Dive: Engine, Runtime, Services, Command Context
part-002  BPMN Execution Tree, Token Semantics, Scope, Activity Instance, dan Event Scope
part-003  Transaction Boundaries, Wait States, Atomic Operations, dan Consistency Model
part-004  Async Continuations, Job Creation, Retry Semantics, dan Idempotency Design
part-005  Job Executor Internals: Acquisition, Locking, Backoff, Deployment Awareness, dan Cluster Behavior
part-006  Database Schema Mastery: ACT_RU, ACT_HI, ACT_RE, ACT_GE, ACT_ID
part-007  Persistence, Flush Ordering, Optimistic Locking, dan Database Isolation
part-008  Variable System Deep Dive: Serialization, Typed Values, Spin, JSON/XML, Object Variables
part-009  Expression Language, Delegation Code, Bean Resolution, dan Runtime Binding
part-010  JavaDelegate, ExecutionListener, TaskListener, ParseListener, dan Extension Point Discipline
part-011  External Task Pattern Advanced: Pull Workers, Locking, Long Polling, Backpressure, dan Worker Fleet Design
part-012  Service Invocation Patterns: JavaDelegate vs External Task vs Message vs Outbox
part-013  Message Correlation, Signal, Event, Business Key, dan Race Condition Control
part-014  Timers, Due Dates, Time Zones, Calendar Semantics, dan SLA Modelling
part-015  Human Task Engineering: Task Lifecycle, Assignment, Candidate Groups, Authorization, Forms
part-016  History, Auditability, Regulatory Traceability, dan Data Retention
part-017  Incidents, Error Taxonomy, BPMN Error, Escalation, Compensation, dan Recovery Semantics
part-018  Process Versioning, Deployment, Migration, dan Long-Running Instance Evolution
part-019  Multi-Tenancy, Engine Partitioning, Authorization Boundary, dan Shared Platform Design
part-020  Authorization, Identity, Security Hardening, dan Webapp/API Exposure
part-021  Spring Boot Integration Advanced: Embedded Engine, Transactions, Beans, Profiles, Testing
part-022  Jakarta EE / Java EE Runtime Integration: Shared Engine, Container Transactions, JNDI, Classloading
part-023  REST API, Client Architecture, OpenAPI, Remote Engine, dan API Governance
part-024  DMN/CMMN in Camunda 7: Decision Automation, Case Management, and When Not to Use Them
part-025  Performance Engineering: Throughput, Latency, Hot Tables, Query Patterns, and Load Testing
part-026  Database Operations: Indexing, Cleanup, Archival, Partitioning, Vacuum/Shrink, and Maintenance Windows
part-027  Observability and Troubleshooting: Metrics, Logs, Cockpit, SQL Diagnostics, and Incident Forensics
part-028  Testing Strategy: Unit, Process Scenario, Integration, Contract, Migration, and Chaos Testing
part-029  Modelling for Correctness: Invariants, State Machines, Escalation Logic, and Regulatory Workflow Design
part-030  Advanced Patterns and Anti-Patterns: Saga, Process Manager, Orchestration, Choreography, and Workflow Smells
part-031  Extending the Engine: ProcessEnginePlugin, Custom Incident Handler, History Event Handler, Custom Batch
part-032  Deployment Topologies: Monolith, Modular Monolith, Microservices, Remote Engine, Kubernetes, and Clustering
part-033  Upgrade and Compatibility Strategy: Camunda 7.x, Java 8–25, Spring Generations, Containers, and Libraries
part-034  Migration Strategy: Camunda 7 to Camunda 8, Replatforming, Coexistence, and Strangler Patterns
part-035  Capstone: Designing a Production-Grade Regulatory Case Management Platform with Camunda 7
```

---

## 36. Checklist Pemahaman Part 000

Sebelum lanjut ke part 001, pastikan Anda bisa menjawab:

1. Mengapa Camunda 7 disebut durable process engine?
2. Apa arti engine “meminjam thread caller”?
3. Apa itu wait state dan mengapa lebih penting daripada sekadar jenis task?
4. Apa konsekuensi `asyncBefore` terhadap transaction dan retry?
5. Mengapa retry bisa menggandakan side effect eksternal?
6. Mengapa Camunda variable tidak boleh menjadi object store?
7. Apa perbedaan Camunda history dan domain audit?
8. Mengapa BPMN executable harus diperlakukan seperti code?
9. Mengapa Camunda 8 bukan upgrade drop-in dari Camunda 7?
10. Apa boundary yang sehat antara BPMN, domain service, integration adapter, dan database?

Jika jawaban Anda masih dangkal, jangan lanjut dulu. Camunda 7 advanced engineering sangat bergantung pada fondasi ini.

---

## 37. Latihan Mental Model

### Latihan 1 — Tentukan Boundary

Anda punya flow:

```text
Submit Application
  -> Validate
  -> Call Payment
  -> Generate Certificate
  -> Notify Applicant
  -> End
```

Pertanyaan:

1. Di mana Anda akan menaruh async boundary?
2. Side effect mana yang harus idempotent?
3. Data apa yang masuk variable Camunda?
4. Data apa yang tetap di domain DB?
5. Jika notification gagal setelah certificate generated, apakah certificate boleh dibuat ulang?

Jawaban yang diharapkan bukan satu solusi tunggal, tetapi reasoning yang sadar transaction dan side effect.

### Latihan 2 — Identify Bad Camunda Usage

Flow:

```text
Every 1 second consume 10,000 telemetry events
  -> enrich each event
  -> publish to downstream topic
```

Pertanyaan:

- Apakah Camunda cocok?
- Jika tidak, apa alternatifnya?
- Apakah ada bagian kecil dari problem yang tetap cocok untuk Camunda?

Jawaban senior:

- throughput stream processing tidak cocok untuk Camunda 7;
- gunakan Kafka/Flink/consumer worker;
- Camunda mungkin cocok untuk exception/remediation workflow ketika event gagal diproses dan perlu human intervention.

### Latihan 3 — Regulatory Workflow

Flow:

```text
Case Opened
  -> Investigation
  -> Enforcement Recommendation
  -> Supervisor Approval
  -> Issue Notice
  -> Appeal Window
  -> Close
```

Pertanyaan:

1. Invariant domain apa yang harus dijaga di luar BPMN?
2. Audit apa yang cukup dari Camunda history?
3. Audit apa yang harus dibuat domain-specific?
4. Apa yang terjadi jika appeal diterima setelah close?
5. Bagaimana model reopen/rework?

Ini akan menjadi pola berpikir untuk capstone.

---

## 38. Glosarium Awal

**Process Engine**  
Runtime yang mengeksekusi BPMN/DMN/CMMN artifact dan menyimpan state.

**Process Definition**  
Versi deployed dari BPMN process.

**Process Instance**  
Satu eksekusi konkret dari process definition.

**Execution**  
Runtime entity yang merepresentasikan path/scope dalam process instance.

**Wait State**  
Titik engine berhenti, persist state, commit, dan menunggu trigger.

**Job**  
Unit kerja persisted yang dieksekusi job executor.

**Job Executor**  
Komponen aktif yang polling dan mengeksekusi job.

**Async Continuation**  
Boundary yang membuat process continuation dijalankan sebagai job.

**Incident**  
Representasi operational failure yang butuh perhatian.

**Business Key**  
Identifier bisnis untuk process instance; sering dipakai untuk correlation dan traceability.

**Variable**  
Data runtime process yang melekat pada scope.

**History**  
Riwayat eksekusi process yang disimpan sesuai history level.

**Migration**  
Pemindahan process instance dari satu process definition version ke version lain.

**Modification**  
Perubahan state process instance secara operasional melalui API.

**External Task**  
Pattern worker pull: engine membuat task, worker mengambil dan menyelesaikan.

---

## 39. Kesimpulan Part 000

Camunda 7 harus dipahami sebagai platform eksekusi proses yang durable, transactional, observable, dan recoverable. Nilainya bukan hanya pada BPMN diagram, tetapi pada kemampuan mengelola long-running state transition dengan human task, timer, retry, incident, versioning, dan audit.

Namun nilai itu hanya muncul jika desainnya benar. Jika salah, Camunda menjadi sumber kompleksitas baru: job stuck, retry menggandakan side effect, variable membengkak, migration kacau, history meledak, dan operator tidak tahu cara recovery.

Fondasi utama part ini:

```text
Camunda 7 = executable process model
          + relational durable state
          + transaction/wait-state semantics
          + job executor retry/recovery
          + human task lifecycle
          + history/audit substrate
          + operational tooling
          + versioning/migration burden
```

Jika Anda membawa mental model ini, part berikutnya akan jauh lebih mudah: kita akan membedah arsitektur internal Camunda 7 — process engine, services, command context, runtime, repository, task, history, management, identity, dan bagaimana satu API call berubah menjadi perubahan state di database.

---

## 40. Referensi Utama

Referensi ini digunakan sebagai basis orientasi dan akan makin diperluas pada part berikutnya.

1. Camunda 7 Docs — Transactions in Processes  
   https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/

2. Camunda 7 Docs — The Job Executor  
   https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/

3. Camunda 7 Docs — Supported Environments  
   https://docs.camunda.org/manual/7.24/introduction/supported-environments/

4. Camunda Enterprise Announcement — Support Announcements  
   https://docs.camunda.org/enterprise/announcement/

5. Camunda Blog — Camunda 7 Enterprise End of Life Extension  
   https://camunda.com/blog/2025/02/camunda-7-enterprise-end-of-life-extension/

6. Camunda 8 Docs — Camunda 7 to Camunda 8 Migration Guide  
   https://docs.camunda.io/docs/guides/migrating-from-camunda-7/

7. Camunda Blog — Advanced Asynchronous Continuations in Camunda BPM  
   https://camunda.com/blog/2014/07/advanced-asynchronous-continuations/

8. Camunda Blog — External Tasks Allows New Use Cases with Camunda BPM  
   https://camunda.com/blog/2015/11/external-tasks/

---

## 41. Status Seri

- Part ini: **selesai**.
- Seri keseluruhan: **belum selesai**.
- Berikutnya: `learn-java-camunda-7-bpm-platform-engineering-part-001.md` — **Camunda 7 Architecture Deep Dive: Engine, Runtime, Services, Command Context**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-001.md">Part 001 — Camunda 7 Architecture Deep Dive: Engine, Runtime, Services, Command Context ➡️</a>
</div>
