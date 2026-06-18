# learn-java-bpmn-camunda-process-orchestration-engineering  
## Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Part: `17`  
> Fokus: Camunda 7 runtime, embedded engine, database-centric execution, job executor, transaction boundary, JavaDelegate, external task, Spring Boot integration, runtime/history persistence, dan migration mindset menuju Camunda 8.  
> Target Java: Java 8 sampai Java 25, dengan perhatian khusus pada legacy enterprise Java, Spring Boot, dan modernization path.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 16 kita sudah membangun fondasi besar:

1. BPMN bukan sekadar diagram.
2. Process instance adalah long-running execution state.
3. Camunda 8/Zeebe adalah remote orchestration cluster.
4. Java worker harus idempotent.
5. Process variable harus diperlakukan sebagai kontrak data, bukan database kedua.
6. Failure handling harus membedakan technical failure, BPMN error, incident, escalation, dan compensation.
7. Human workflow, DMN, message correlation, timers, parallelism, reusable process, dan saga sudah dibahas secara production-minded.

Part ini mundur secara sadar ke **Camunda 7**, karena banyak enterprise system masih menjalankan Camunda 7, dan pemahaman Camunda 7 tetap sangat berharga untuk:

- membaca legacy BPMN application;
- melakukan support production;
- memahami embedded engine;
- memahami transaction boundary engine-database-application;
- melakukan migration assessment ke Camunda 8;
- membedakan style lama `JavaDelegate` dari style baru job worker Camunda 8;
- menghindari kesalahan saat membawa mental model Camunda 7 ke Camunda 8.

Camunda 7 dan Camunda 8 bukan sekadar beda versi. Keduanya memiliki cara berpikir yang berbeda:

```text
Camunda 7:
Application + Process Engine + Relational DB
sering berada di runtime Java yang sama

Camunda 8:
Application Worker + Remote Orchestration Cluster
dipisahkan melalui client protocol dan job activation
```

Camunda 7 sangat kuat di dunia Java enterprise karena engine bisa hidup di dalam aplikasi Java/Spring. Tetapi kekuatan itu juga membawa risiko: boundary antara business application, transaction, dan process engine bisa menjadi terlalu kabur.

---

## 1. Mental Model Utama Camunda 7

Camunda 7 adalah **BPMN process engine yang database-centric dan Java-centric**.

Artinya:

1. State process disimpan di relational database.
2. Command engine dijalankan dalam transaction.
3. Java application dapat memanggil engine API secara langsung.
4. Service task dapat mengeksekusi Java code di thread engine.
5. Job executor mengambil pekerjaan async dari database.
6. Runtime state dan history state disimpan di tabel relational.
7. Banyak operasi engine berjalan dalam transaction boundary yang sama dengan application transaction, terutama bila embedded di Spring.

Mental model sederhananya:

```text
HTTP request / scheduled job / message consumer
        |
        v
Spring Service / Java Application
        |
        v
Camunda 7 Process Engine API
        |
        v
Command Context + Transaction
        |
        v
Relational Database
        |
        +--> Runtime tables
        +--> Job tables
        +--> Task tables
        +--> History tables
```

Pada Camunda 7, database bukan hanya persistence storage. Database juga menjadi:

- runtime state store;
- job queue;
- lock coordination medium;
- history/audit source;
- migration substrate;
- operational troubleshooting surface.

Ini berbeda dari Camunda 8/Zeebe yang berbasis log stream, partition, dan exporter.

---

## 2. Camunda 7 Bukan Hanya Library

Ada cara yang salah memahami Camunda 7:

> “Camunda 7 itu library BPMN yang tinggal ditambahkan ke Spring Boot.”

Lebih tepat:

> “Camunda 7 adalah process engine lengkap yang bisa di-embed di aplikasi Java, memakai relational database sebagai state engine, menyediakan API untuk runtime/task/history/repository, menjalankan job executor, dan menghasilkan history/audit proses.”

Perbedaan ini penting.

Kalau dianggap library biasa, developer sering melakukan hal buruk:

- service task memanggil external API lama secara synchronous tanpa timeout;
- JavaDelegate menulis domain DB dan memanggil engine API secara campur aduk;
- variable besar disimpan langsung di process variable;
- process engine ikut mati ketika aplikasi mati;
- job executor diperlakukan seperti background thread biasa;
- transaction rollback tidak dipahami efeknya terhadap token BPMN;
- migration process definition dilakukan tanpa memahami running instance.

Camunda 7 harus dipahami sebagai **runtime platform**.

---

## 3. Komponen Utama Camunda 7

Secara praktis, Camunda 7 terdiri dari beberapa komponen:

```text
+-------------------------------+
| Camunda 7 Platform            |
+-------------------------------+
| Process Engine                |
| Repository Service            |
| Runtime Service               |
| Task Service                  |
| History Service               |
| Management Service            |
| Identity Service              |
| Authorization Service         |
| External Task Service         |
| Form Service                  |
| Decision Service              |
| Case Service                  |
+-------------------------------+
| Job Executor                  |
| Relational DB                 |
+-------------------------------+
| Webapps: Cockpit, Tasklist,   |
| Admin                         |
+-------------------------------+
| REST API                      |
+-------------------------------+
```

Tidak semua aplikasi memakai semua komponen, tetapi engineer senior harus tahu tanggung jawab masing-masing.

---

## 4. Process Engine

Process engine adalah core runtime.

Tugasnya:

1. Deploy BPMN/DMN/forms.
2. Start process instance.
3. Advance token.
4. Evaluate gateways.
5. Create user task.
6. Execute service task.
7. Create jobs for async work/timers.
8. Persist runtime state.
9. Write history.
10. Handle incidents.
11. Execute process migration.
12. Provide API for query/control.

Dalam embedded mode, process engine hidup di aplikasi yang sama.

Contoh:

```text
Spring Boot Application
  ├─ REST Controller
  ├─ Domain Service
  ├─ Camunda Process Engine
  ├─ Job Executor
  └─ DataSource
```

Keuntungannya:

- mudah integrasi dengan Spring bean;
- JavaDelegate bisa inject service;
- transaction bisa join dengan Spring transaction;
- local API cepat;
- deployment mudah untuk aplikasi kecil/menengah.

Risikonya:

- coupling tinggi antara process dan application;
- engine load bercampur dengan API load;
- job executor bersaing dengan thread/resources aplikasi;
- scale process engine = scale whole app;
- process engine restart saat app restart;
- boundary transactional mudah disalahpahami.

---

## 5. Repository Service

`RepositoryService` menangani process definition dan deployment artifact.

Digunakan untuk:

- deploy BPMN;
- deploy DMN;
- query process definition;
- query deployment;
- delete deployment;
- access model metadata.

Mental model:

```text
Deployment
  ├─ one or more BPMN process definitions
  ├─ one or more DMN decisions
  ├─ forms/resources
  └─ version metadata
```

Contoh Java:

```java
repositoryService
    .createDeployment()
    .name("licensing-application-process")
    .addClasspathResource("bpmn/licensing-application.bpmn")
    .deploy();
```

Dalam production, deployment bukan sekadar upload file. Deployment adalah perubahan kontrak runtime.

Pertanyaan yang harus dijawab sebelum deploy:

1. Apakah process definition baru backward-compatible?
2. Apakah running instance lama tetap memakai versi lama?
3. Apakah JavaDelegate/worker masih mendukung versi lama?
4. Apakah variable contract berubah?
5. Apakah migration plan diperlukan?
6. Apakah history/audit requirement terdampak?
7. Apakah rollback realistis?

---

## 6. Runtime Service

`RuntimeService` menangani process instance yang sedang berjalan.

Digunakan untuk:

- start process instance;
- correlate message;
- signal event;
- set/get variable;
- query execution;
- suspend/activate process instance;
- delete process instance;
- trigger migration;
- interact dengan execution tree.

Contoh start process:

```java
Map<String, Object> variables = new HashMap<>();
variables.put("applicationId", "APP-2026-0001");
variables.put("submittedBy", "UEN-12345678A");

ProcessInstance instance = runtimeService
    .startProcessInstanceByKey(
        "licensingApplication",
        "APP-2026-0001",
        variables
    );
```

Di sini ada tiga konsep penting:

```text
process definition key = jenis proses
business key           = identitas business case
process instance id    = identitas runtime engine
```

Kesalahan umum:

```text
Menggunakan processInstanceId sebagai business identity di domain table.
```

Lebih baik:

```text
Domain table:
application_id = APP-2026-0001
process_instance_id = engine reference

Camunda:
businessKey = APP-2026-0001
```

Business key mempermudah:

- audit;
- troubleshooting;
- process lookup;
- correlation;
- dashboard;
- support production.

---

## 7. Task Service

`TaskService` menangani user task.

Digunakan untuk:

- query task;
- claim task;
- assign task;
- complete task;
- set task variable;
- add comment;
- manage candidate user/group;
- delegate/resolve task.

Contoh:

```java
List<Task> tasks = taskService
    .createTaskQuery()
    .processInstanceBusinessKey("APP-2026-0001")
    .taskCandidateGroup("licensing-officer")
    .active()
    .list();
```

Complete task:

```java
Map<String, Object> variables = new HashMap<>();
variables.put("officerDecision", "APPROVE");
variables.put("officerRemarks", "All documents verified");

taskService.complete(taskId, variables);
```

Production concern:

User task completion bukan sekadar klik tombol.

Harus ada:

1. Authorization check.
2. Task ownership/claim validation.
3. Domain state validation.
4. Stale task prevention.
5. Maker-checker rule.
6. Input validation.
7. Audit trail.
8. Idempotency terhadap double submit.
9. Consistency antara domain DB dan process advancement.

Anti-pattern:

```text
Frontend langsung call Camunda REST /task/{id}/complete tanpa domain validation.
```

Pattern yang lebih aman:

```text
Frontend
  -> Application Backend
      -> validate user permission
      -> validate domain state
      -> persist domain decision/audit
      -> complete Camunda task
```

---

## 8. History Service

`HistoryService` menyediakan query untuk data historis.

Digunakan untuk:

- completed process instance;
- historic activity instance;
- historic task instance;
- historic variable;
- historic detail;
- audit/process timeline;
- duration analysis.

Camunda 7 history sangat penting untuk enterprise audit.

Tetapi perlu hati-hati:

1. History bukan domain audit replacement.
2. History level mempengaruhi storage.
3. Variable history bisa besar.
4. Sensitive variable bisa bocor ke history.
5. High-volume process bisa membuat history tables sangat besar.
6. Cleanup strategy harus dirancang.

History level umum:

```text
none
activity
audit
full
```

Secara konseptual:

```text
none     -> hampir tidak ada history
activity -> activity lifecycle
audit    -> activity + variable updates penting
full     -> detail sangat lengkap
```

Trade-off:

```text
More history = better audit/debugging
More history = more storage/indexing/cleanup burden
```

Untuk regulatory system, biasanya auditability penting, tetapi bukan berarti semua payload harus masuk process variable history.

Prinsip:

```text
Camunda history menjelaskan execution path.
Domain audit menjelaskan business accountability.
```

Keduanya saling melengkapi, bukan saling menggantikan.

---

## 9. Management Service

`ManagementService` digunakan untuk operasi teknis engine.

Digunakan untuk:

- query jobs;
- execute job manually;
- set job retries;
- query incidents;
- manage job definition;
- query database table metadata;
- execute management commands tertentu.

Contoh job retry:

```java
managementService.setJobRetries(jobId, 3);
```

Contoh execute job manual:

```java
managementService.executeJob(jobId);
```

Dalam production, operation ini harus sangat dikontrol.

Tidak semua developer boleh:

- menaikkan retry;
- delete process instance;
- execute job manual;
- set variable manual;
- migrate instance;
- suspend process definition.

Harus ada operational governance:

```text
who performed repair
when
why
what changed
approval reference
before/after value
affected process instance
affected business case
```

---

## 10. External Task Service

External task pattern adalah salah satu bridge penting antara Camunda 7 dan Camunda 8-style thinking.

Dalam JavaDelegate:

```text
engine pushes execution into Java code
```

Dalam external task:

```text
worker pulls work from engine
```

External task flow:

```text
BPMN external service task created
        |
        v
Engine stores external task in DB
        |
        v
External worker fetchAndLock(topic)
        |
        v
Worker executes work
        |
        v
Worker complete / failure / BPMN error
```

Keuntungan external task:

- engine tidak perlu memanggil external service langsung;
- worker bisa ditulis dalam bahasa selain Java;
- worker bisa scale terpisah;
- lebih cocok untuk microservices;
- failure lebih isolated;
- lebih mirip Camunda 8 job worker mental model.

Kekurangan:

- polling overhead;
- REST roundtrip;
- perlu worker lifecycle;
- perlu lock duration tuning;
- perlu idempotency;
- transaction tidak local dengan engine.

Contoh external worker Java pseudo-code:

```java
ExternalTaskClient client = ExternalTaskClient.create()
    .baseUrl("http://localhost:8080/engine-rest")
    .asyncResponseTimeout(10000)
    .build();

client.subscribe("send-email")
    .lockDuration(30000)
    .handler((externalTask, externalTaskService) -> {
        try {
            String applicationId = externalTask.getVariable("applicationId");

            emailService.sendSubmissionEmail(applicationId);

            externalTaskService.complete(externalTask);
        } catch (BusinessException ex) {
            externalTaskService.handleBpmnError(
                externalTask,
                "EMAIL_BUSINESS_ERROR",
                ex.getMessage()
            );
        } catch (Exception ex) {
            externalTaskService.handleFailure(
                externalTask,
                ex.getMessage(),
                stackTrace(ex),
                externalTask.getRetries() == null ? 3 : externalTask.getRetries() - 1,
                60_000
            );
        }
    })
    .open();
```

Sama seperti Camunda 8 job worker, external task worker harus idempotent.

---

## 11. Identity Service dan Authorization

Camunda 7 memiliki `IdentityService` dan `AuthorizationService`.

Dalam banyak enterprise system, identity tidak sepenuhnya memakai Camunda built-in user store. Seringnya:

```text
Enterprise IdP / SSO / Keycloak / LDAP / AD
        |
        v
Application Backend
        |
        v
Camunda authorization / task assignment integration
```

Beberapa model:

### Model A — Camunda Tasklist Native

User login ke Camunda Tasklist. Task visibility memakai Camunda authorization/candidate group.

Cocok untuk:

- internal workflow sederhana;
- quick adoption;
- operator memakai Camunda UI.

Keterbatasan:

- UI customization terbatas;
- domain-level authorization kompleks sulit;
- integration dengan existing app bisa awkward.

### Model B — Custom Application UI

User memakai aplikasi sendiri. Backend query/complete task melalui Camunda API.

Cocok untuk:

- regulatory case management;
- complex permissions;
- custom forms;
- field-level authorization;
- maker-checker;
- agency/team hierarchy.

Pattern:

```text
User
  -> Custom UI
      -> Domain Backend
          -> AuthZ check
          -> Domain validation
          -> Camunda TaskService/REST
```

Untuk system serius, Model B sering lebih aman dan fleksibel.

---

## 12. Camunda 7 Database Mental Model

Camunda 7 menyimpan state di relational DB.

Kategori table umum:

```text
ACT_RE_*  repository
ACT_RU_*  runtime
ACT_HI_*  history
ACT_ID_*  identity
ACT_GE_*  general
```

Contoh konseptual:

```text
ACT_RE_PROCDEF       process definition
ACT_RE_DEPLOYMENT    deployment
ACT_RU_EXECUTION     execution tree / process runtime
ACT_RU_TASK          active user tasks
ACT_RU_JOB           async jobs / timers
ACT_RU_EXT_TASK      external tasks
ACT_RU_VARIABLE      runtime variables
ACT_RU_INCIDENT      runtime incidents
ACT_HI_PROCINST      historic process instances
ACT_HI_ACTINST       historic activity instances
ACT_HI_TASKINST      historic task instances
ACT_HI_VARINST       historic variable instances
ACT_HI_DETAIL        detailed variable/form updates
```

Penting:

Jangan membangun business logic dengan langsung membaca/menulis tabel Camunda internal.

Boleh untuk:

- troubleshooting read-only;
- DBA diagnostics;
- index/storage analysis;
- emergency support with official guidance.

Tidak boleh sebagai normal application integration:

```sql
UPDATE ACT_RU_VARIABLE SET ...
```

Karena:

- schema internal bisa berubah;
- cache engine bisa inconsistent;
- transaction semantics bisa rusak;
- history tidak lengkap;
- audit repair tidak jelas.

Gunakan API engine/REST.

---

## 13. Execution Tree: Root Process, Scope, Activity, Token

Camunda 7 memakai konsep execution tree.

Ketika process berjalan, engine menyimpan execution yang merepresentasikan token/scope.

Contoh sederhana:

```text
Process Instance
  Execution root
    -> Activity: Review Application
```

Parallel gateway:

```text
Process Instance
  Execution root
    -> child execution: Agency A Review
    -> child execution: Agency B Review
    -> child execution: Agency C Review
```

Subprocess:

```text
Process Instance
  Execution root
    -> subprocess scope execution
        -> activity execution
```

Kenapa ini penting?

Karena variable scope, cancellation, boundary event, multi-instance, dan parallel execution sering bergantung pada execution tree.

Misalnya:

- variable global disimpan di process instance scope;
- local variable disimpan di execution tertentu;
- boundary event attached ke activity scope;
- interrupting boundary event membatalkan execution activity;
- parallel branch memiliki child execution sendiri.

Engineer yang memahami execution tree akan lebih mudah mendiagnosis:

- “kenapa variable saya tidak terlihat?”
- “kenapa branch ini masih hidup?”
- “kenapa join tidak lanjut?”
- “kenapa task lama masih muncul?”
- “kenapa migration gagal?”

---

## 14. Transaction Boundary di Camunda 7

Ini inti Camunda 7.

Camunda 7 menjalankan process advancement dalam transaction.

Contoh process:

```text
Start Event
  -> Service Task A
  -> Service Task B
  -> User Task
```

Jika Service Task A dan B synchronous JavaDelegate tanpa async boundary, maka ketika start process dipanggil:

```text
runtimeService.startProcessInstanceByKey()
    opens transaction
        execute Start Event
        execute Service Task A
        execute Service Task B
        create User Task
        persist state
    commit transaction
```

Jika Service Task B throw exception:

```text
transaction rollback
process instance may not be persisted as advanced
side effects inside delegate may or may not be rolled back depending on resource
```

Ini sangat penting.

Jika delegate:

1. menulis ke DB yang sama dalam transaction;
2. lalu exception terjadi;

maka DB write bisa rollback.

Tetapi jika delegate:

1. memanggil external REST API;
2. external API sukses;
3. lalu exception terjadi;

maka external side effect tidak rollback.

Inilah sumber bug klasik:

```text
Engine transaction rollback, but external side effect already happened.
```

Karena itu service task synchronous yang memanggil external system sangat berbahaya jika tidak didesain dengan idempotency dan async boundary.

---

## 15. Async Before dan Async After

Camunda 7 menyediakan async continuation.

`asyncBefore` berarti engine berhenti sebelum activity, membuat job, dan activity dieksekusi oleh job executor nanti.

`asyncAfter` berarti engine mengeksekusi activity dulu, lalu berhenti setelah activity dan membuat job untuk melanjutkan sequence berikutnya.

Contoh:

```xml
<bpmn:serviceTask id="chargePayment"
                  name="Charge Payment"
                  camunda:asyncBefore="true"
                  camunda:delegateExpression="${chargePaymentDelegate}" />
```

Mental model:

```text
Without asyncBefore:
caller thread executes service task now

With asyncBefore:
caller thread creates job and commits
job executor executes service task later
```

Manfaat async boundary:

1. Memecah transaction.
2. Membuat retry job.
3. Menghindari long-running work di request thread.
4. Membuat failure menjadi incident/retry, bukan rollback seluruh process start.
5. Memungkinkan concurrency lebih baik.
6. Memberikan recovery point.

Tetapi async boundary bukan solusi ajaib.

Risiko:

- job executor load meningkat;
- job retry harus dikonfigurasi;
- process menjadi eventually progressing;
- duplicate side effect tetap mungkin jika retry;
- debugging butuh observability.

Rule of thumb:

```text
Pasang asyncBefore sebelum service task yang:
- memanggil external system;
- bisa lambat;
- bisa gagal temporary;
- punya side effect;
- perlu retry;
- tidak boleh membuat caller transaction lama.
```

`asyncAfter` berguna saat:

```text
activity sukses harus committed dulu sebelum lanjut;
failure setelah activity tidak boleh rollback activity;
ingin memisahkan post-action continuation.
```

---

## 16. Job Executor

Job executor adalah komponen yang mengambil dan mengeksekusi job asynchronous dari database.

Job dibuat oleh:

- async before;
- async after;
- timer event;
- message-related async continuation;
- failed retry;
- process continuation tertentu.

Mental model:

```text
ACT_RU_JOB
    |
    v
Job Acquisition Thread
    |
    v
Job Execution Thread Pool
    |
    v
Execute command
    |
    v
Commit / retry / incident
```

Job executor bukan message broker. Ia adalah engine-internal async executor berbasis database.

Hal yang mempengaruhi performa job executor:

1. Jumlah engine node.
2. Job acquisition interval.
3. Thread pool size.
4. Database latency.
5. Lock contention.
6. Due date job.
7. Exclusive job setting.
8. Failed job retries.
9. Long delegate execution.
10. Index dan DB health.

Masalah umum:

```text
Job stuck
Job retries exhausted
Timer terlambat
Deadlock database
Optimistic locking exception
Job executor tidak aktif
Thread pool habis
Long-running delegate blocking worker thread
```

Camunda 7 job executor battle-tested, tetapi karena bergantung pada DB dan application runtime, engineer harus menguasai DB-level symptoms.

---

## 17. Exclusive Jobs dan Concurrency

Secara default, job tertentu bisa bersifat exclusive untuk process instance agar menghindari concurrent modification yang tidak aman.

Mental model:

```text
Same process instance
  -> multiple async jobs
  -> exclusive jobs avoid parallel execution conflict
```

Trade-off:

```text
exclusive = safer per instance, less parallelism
non-exclusive = more concurrency, more risk of conflicts
```

Dalam regulatory workflow, safety biasanya lebih penting daripada raw throughput untuk satu process instance.

Namun untuk bulk/fan-out proses yang benar-benar independen, concurrency bisa dirancang lebih eksplisit.

---

## 18. Retry dan Incident di Camunda 7

Jika async job gagal, Camunda 7 dapat retry berdasarkan konfigurasi.

Jika retry habis, incident dibuat.

Contoh BPMN retry cycle:

```xml
<camunda:failedJobRetryTimeCycle>R3/PT5M</camunda:failedJobRetryTimeCycle>
```

Artinya secara konseptual:

```text
retry 3 kali
interval 5 menit
```

Failure path:

```text
Job executes
  -> exception
      -> retries decreased
      -> due date updated
      -> if retries > 0: retry later
      -> if retries == 0: incident
```

Pembedaan penting:

```text
Technical temporary failure:
  throw exception / fail job / retry

Business expected failure:
  BPMN error / gateway path / business status

Unrecoverable corrupted state:
  incident + manual repair
```

Jangan semua failure dijadikan exception.

Contoh business failure:

```text
Applicant not eligible
Document invalid
Payment rejected
Approval denied
```

Ini bukan incident teknis. Ini outcome bisnis.

---

## 19. JavaDelegate

`JavaDelegate` adalah cara klasik mengimplementasikan service task di Camunda 7.

Contoh:

```java
@Component("validateApplicationDelegate")
public class ValidateApplicationDelegate implements JavaDelegate {

    private final ApplicationService applicationService;

    public ValidateApplicationDelegate(ApplicationService applicationService) {
        this.applicationService = applicationService;
    }

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String applicationId = (String) execution.getVariable("applicationId");

        ValidationResult result = applicationService.validate(applicationId);

        execution.setVariable("validationStatus", result.status());
        execution.setVariable("validationReason", result.reason());
    }
}
```

BPMN:

```xml
<bpmn:serviceTask id="validateApplication"
                  name="Validate Application"
                  camunda:delegateExpression="${validateApplicationDelegate}" />
```

Kelebihan:

- simple;
- sangat natural untuk Java/Spring;
- bisa inject service;
- local call cepat;
- transaction mudah join.

Risiko:

- delegate bisa terlalu gemuk;
- process engine thread menjalankan business code;
- external API call bisa memblokir engine;
- transaction rollback ambiguity;
- sulit scale secara independen;
- deployment process dan code sangat tightly coupled;
- boundary antara process orchestration dan domain service kabur.

Rule:

```text
JavaDelegate sebaiknya tipis:
- baca variable minimal;
- panggil application service;
- tulis output variable minimal;
- tidak mengandung orchestration logic besar;
- tidak melakukan long blocking operation tanpa async boundary;
- tidak menjadi tempat business policy kompleks.
```

---

## 20. Delegate Expression vs Class

Ada beberapa cara menghubungkan service task ke Java code.

### Class

```xml
camunda:class="com.example.ValidateApplicationDelegate"
```

Engine instantiate class.

Kurang fleksibel untuk Spring dependency injection.

### Delegate Expression

```xml
camunda:delegateExpression="${validateApplicationDelegate}"
```

Engine resolve bean dari Spring/CDI.

Lebih umum untuk Spring application.

### Expression

```xml
camunda:expression="${applicationService.validate(execution)}"
```

Bisa, tetapi sering membuat BPMN terlalu terkait implementation detail.

Rekomendasi:

```text
Gunakan delegateExpression untuk Spring-managed delegate.
```

---

## 21. Execution Listener dan Task Listener

Camunda 7 mendukung listener.

Execution listener:

- start activity;
- end activity;
- take sequence flow.

Task listener:

- create task;
- assignment;
- complete;
- delete;
- update.

Contoh use case:

- set default task metadata;
- emit audit event;
- assign candidate group;
- record activity started;
- enrich variables.

Anti-pattern:

```text
Menyembunyikan business logic penting di listener sehingga diagram tidak menunjukkan real behavior.
```

Listener sebaiknya untuk cross-cutting concern yang jelas, bukan core process decision.

Jika listener mengubah flow behavior secara signifikan, model menjadi sulit dipahami.

---

## 22. Script Task

Camunda 7 mendukung script task, misalnya JavaScript/Groovy bergantung konfigurasi engine/runtime.

Namun dalam enterprise Java modern, script task harus dibatasi.

Risiko:

- runtime scripting dependency;
- security risk;
- poor type safety;
- sulit testing;
- sulit observability;
- sulit versioning;
- performance unpredictable;
- beda behavior antar JVM/script engine.

Rekomendasi:

```text
Gunakan script task hanya untuk ekspresi kecil/non-critical.
Untuk business logic, gunakan Java service/DMN.
```

Lebih baik:

```text
Gateway condition:
  ${approved == true}

DMN:
  eligibility decision

JavaDelegate:
  typed integration with domain service
```

---

## 23. Service Task Invocation Styles di Camunda 7

Ada beberapa style:

```text
1. JavaDelegate embedded
2. Expression method call
3. Connector
4. External task
5. REST call dari delegate
6. Message/event to external system
```

Perbandingan:

| Style | Cocok Untuk | Risiko |
|---|---|---|
| JavaDelegate | Local domain service, same app | Tight coupling, blocking |
| Expression | Simple bean method | BPMN terlalu technical |
| Connector | Simple integration | Limited control |
| External task | Microservice/remote worker | Polling, idempotency |
| REST from delegate | Quick integration | Transaction ambiguity |
| Message/event | Async integration | Correlation complexity |

Untuk system serius, pilihan terbaik sering:

```text
Local domain operation:
  JavaDelegate + async boundary + idempotency

Remote side effect:
  external task / outbox event / worker

Business rule:
  DMN

Human action:
  user task melalui application backend
```

---

## 24. Spring Boot Integration

Camunda 7 sangat populer dengan Spring Boot.

Typical structure:

```text
src/main/java
  com.example.workflow
    WorkflowApplication.java
    delegate/
    service/
    controller/
    repository/
    config/

src/main/resources
  bpmn/
    licensing-application.bpmn
  application.yml
```

Contoh dependency konseptual:

```xml
<dependency>
  <groupId>org.camunda.bpm.springboot</groupId>
  <artifactId>camunda-bpm-spring-boot-starter</artifactId>
</dependency>
```

Contoh config konseptual:

```yaml
camunda:
  bpm:
    admin-user:
      id: admin
      password: admin
    database:
      schema-update: true
    history-level: audit
    job-execution:
      enabled: true
```

Production warning:

```text
schema-update: true
```

Tidak selalu cocok untuk production. Dalam enterprise production, schema migration harus controlled.

Lebih baik:

- DB migration explicit;
- DBA-reviewed script;
- environment-specific config;
- no surprise schema alteration at startup.

---

## 25. Embedded Engine Deployment Model

Dalam embedded mode:

```text
Application instance A:
  process engine
  job executor

Application instance B:
  process engine
  job executor

Shared database:
  Camunda tables
```

Ini memungkinkan horizontal scaling, tetapi juga menimbulkan:

- job acquisition coordination via DB lock;
- duplicate deployment concern;
- deployment-aware job executor concern;
- thread pool sizing per node;
- DB connection pool pressure;
- version mismatch risk antar node;
- rolling deployment challenge.

Scenario:

```text
Node A runs app version 1
Node B runs app version 2
Both share same Camunda DB
Process definition version 3 deployed by node B
Job picked by node A but delegate code unavailable
```

Karena itu rolling deployment harus memperhatikan:

1. process definition deployment timing;
2. delegate compatibility;
3. classpath availability;
4. async job execution;
5. job executor enable/disable strategy;
6. process application registration.

---

## 26. Shared Engine / Container Deployment Model

Camunda 7 juga bisa digunakan sebagai shared engine di application server/container.

Model:

```text
Application Server
  ├─ Camunda Engine
  ├─ Camunda Webapps
  ├─ Process Application A
  └─ Process Application B
```

Kelebihan:

- centralized engine;
- shared operations webapps;
- cocok untuk beberapa legacy enterprise setup.

Risiko:

- operational coupling;
- app server complexity;
- deployment lifecycle lebih rumit;
- classloader issues;
- modern microservice fit lebih rendah.

---

## 27. Camunda Run / Remote Engine Model

Camunda 7 juga bisa dijalankan sebagai remote engine via Camunda Run + REST API.

Model:

```text
Custom Application
  -> REST API
      -> Camunda Run
          -> Camunda Engine
              -> DB
```

Automated work lebih cocok memakai external task:

```text
Camunda Run
  -> external task stored
      -> worker fetches and completes
```

Keuntungan:

- engine lifecycle terpisah;
- application tidak embed engine;
- lebih dekat ke remote orchestration mindset;
- easier language polyglot;
- lebih mirip transition path ke Camunda 8.

Risiko:

- REST latency;
- auth/security API;
- less local transaction;
- operational management terpisah;
- external task worker complexity.

Camunda sendiri pernah mendorong rekomendasi remote engine/external task untuk Camunda 7 greenfield dibanding embedded-heavy style, karena boundary yang lebih jelas.

---

## 28. Process Application

Process application adalah konsep Camunda 7 untuk mengaitkan process definition dengan application code/resources.

Fungsi:

- register deployment;
- provide classpath;
- provide delegates/listeners;
- manage process application lifecycle;
- support deployment-aware job executor.

Masalah yang sering muncul:

```text
ENGINE-09005 Could not find process definition
ClassNotFoundException for delegate
Delegate bean not found
Job executor cannot execute job because process application unavailable
```

Dalam architecture review, tanyakan:

1. Di mana BPMN deployed?
2. Di mana delegate code hidup?
3. Apakah job executor bisa menemukan bean/class?
4. Apakah process application registered?
5. Apa yang terjadi saat rolling restart?
6. Apakah process definition version cocok dengan application version?

---

## 29. Domain Transaction vs Engine Transaction

Ini salah satu bagian paling penting.

Misalnya API submit application:

```java
@Transactional
public SubmitResponse submit(SubmitRequest request) {
    Application app = applicationRepository.save(...);

    runtimeService.startProcessInstanceByKey(
        "licensingApplication",
        app.getId(),
        Map.of("applicationId", app.getId())
    );

    return new SubmitResponse(app.getId());
}
```

Jika engine memakai datasource/transaction manager yang sama, domain insert dan process start bisa berada di transaction yang sama.

Keuntungan:

```text
Application saved and process started atomically.
```

Risiko:

```text
Process start bisa execute delegate synchronous sebelum transaction commit.
Delegate mungkin membaca application yang belum committed.
Delegate mungkin call external side effect sebelum transaction commit.
```

Pattern lebih aman:

```text
@Transactional
submit:
  save application
  save domain audit
  start process with asyncBefore at first side-effect task
commit

Job executor:
  execute external side-effect later
```

Atau:

```text
@Transactional
submit:
  save application
  save outbox event ApplicationSubmitted
commit

Outbox publisher:
  start/correlate process
```

Pilihan tergantung consistency requirement.

---

## 30. The Dangerous Pattern: Synchronous External Call in JavaDelegate

Contoh buruk:

```java
@Override
public void execute(DelegateExecution execution) {
    String applicationId = (String) execution.getVariable("applicationId");

    externalAgencyClient.notify(applicationId); // side effect

    applicationRepository.markNotified(applicationId);

    execution.setVariable("agencyNotified", true);
}
```

Failure window:

```text
externalAgencyClient.notify succeeds
applicationRepository.markNotified fails
engine transaction rolls back
job retries
externalAgencyClient.notify called again
```

Solusi:

1. Idempotency key untuk external call.
2. Outbox pattern.
3. Async boundary.
4. External task worker.
5. Persist side effect command before executing.
6. Reconciliation status.
7. Avoid direct external call in engine transaction when possible.

Better pattern:

```java
@Transactional
public void requestAgencyNotification(String applicationId, String commandId) {
    if (commandRepository.exists(commandId)) {
        return;
    }

    commandRepository.insert(commandId, applicationId, "AGENCY_NOTIFICATION_REQUESTED");
    outboxRepository.insert("NotifyAgencyRequested", commandId, applicationId);
}
```

Delegate hanya membuat durable command/outbox, bukan call remote API langsung.

---

## 31. User Task Integration in Camunda 7

User task di Camunda 7 dapat dikelola via Tasklist native atau custom UI.

Untuk custom UI, backend bisa:

```java
Task task = taskService.createTaskQuery()
    .taskId(taskId)
    .active()
    .singleResult();

if (task == null) {
    throw new TaskNotFoundException();
}

if (!authorizationService.canComplete(currentUser, task)) {
    throw new ForbiddenException();
}

domainService.recordDecision(applicationId, decision, remarks, currentUser);

taskService.complete(taskId, Map.of(
    "reviewDecision", decision,
    "reviewedBy", currentUser.id()
));
```

Tapi production-grade flow harus menghindari partial commit.

Jika domain DB write sukses tapi `taskService.complete` gagal, user bisa melihat inconsistent state.

Solusi bergantung setup:

### Same transaction

Jika same DB/transaction manager:

```text
domain write + task complete in one transaction
```

Cocok untuk embedded Camunda dengan same datasource.

### Outbox/command

Jika remote Camunda atau ingin loose coupling:

```text
domain write decision as pending
outbox command CompleteTask
worker completes Camunda task
domain state updated on success
```

### Idempotent complete

Task complete endpoint harus tahan double click:

```text
decision command id
unique constraint
task active check
domain state check
safe retry
```

---

## 32. BPMN Error in Camunda 7

Dalam JavaDelegate, BPMN error dilempar dengan `BpmnError`.

Contoh:

```java
throw new BpmnError("DOCUMENT_INVALID", "Document validation failed");
```

BPMN harus punya error boundary event atau error event subprocess yang menangkap error code tersebut.

Pembedaan:

```text
throw new BpmnError(...)
  -> expected business path

throw new RuntimeException(...)
  -> technical failure / retry / incident
```

Jangan gunakan `BpmnError` untuk:

- database down;
- timeout external API temporary;
- NullPointerException;
- serialization bug;
- system misconfiguration.

Gunakan `BpmnError` untuk:

- applicant not eligible;
- document invalid;
- payment rejected secara final;
- business rule violation;
- maker-checker rejected.

---

## 33. Message Correlation in Camunda 7

RuntimeService menyediakan message correlation.

Contoh:

```java
runtimeService
    .createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey("APP-2026-0001")
    .setVariable("paymentStatus", "PAID")
    .correlate();
```

Risiko:

1. No matching execution.
2. Multiple matching executions.
3. Message datang terlalu awal.
4. Duplicate message.
5. Wrong business key.
6. Race dengan cancellation/timer.
7. Correlation dalam transaction yang salah.

Pattern:

```text
Inbound event table
  -> validate
  -> deduplicate
  -> correlate message
  -> record correlation result
```

Jangan langsung:

```text
Kafka consumer -> runtimeService.correlate()
```

tanpa idempotency dan failure handling.

---

## 34. Signal vs Message

Signal bersifat broadcast-like. Message ditujukan untuk process instance/subscription tertentu.

Rule sederhana:

```text
Message:
  use when event belongs to specific case/process

Signal:
  use when event is broadcast to many listeners
```

Untuk regulatory case, hampir semua external response sebaiknya message dengan correlation key.

Signal risk:

```text
accidentally waking multiple process instances
```

Gunakan signal dengan hati-hati.

---

## 35. Timer in Camunda 7

Timer disimpan sebagai job.

Contoh:

```text
User Task: Review Application
  boundary timer: PT5D
```

Engine membuat timer job.

Job executor mengambil saat due.

Risiko:

- DB/job executor delay;
- timezone expression;
- huge number of timers;
- changed due date logic;
- business calendar not represented;
- timer fires after domain state changed;
- timer and user completion race.

Production pattern:

```text
Timer event triggers "Evaluate SLA Breach"
  -> delegate checks current domain/task state
  -> if still valid, escalate
  -> if already resolved, no-op
```

Jangan anggap timer firing berarti business condition masih valid.

Timer hanya berarti:

```text
scheduled time reached
```

Business validity harus dicek lagi.

---

## 36. Incident Operations

Incident terjadi saat engine tidak bisa melanjutkan execution.

Contoh:

- failed job retries exhausted;
- external task failure retries exhausted;
- failed migration;
- unresolved BPMN issue.

Production repair flow:

```text
1. Identify business case
2. Identify process instance
3. Identify failed activity/job
4. Read exception message/stack trace
5. Classify failure
6. Fix root cause
7. Correct variable if needed
8. Increase retry / resolve incident
9. Verify process advanced
10. Record audit/support note
```

Jangan langsung menaikkan retry tanpa memahami root cause.

Jika root cause adalah bad variable, retry hanya akan gagal ulang.

Jika root cause adalah external system down, retry setelah recovery masuk akal.

Jika root cause adalah bug code, deploy fix dulu.

---

## 37. Process Instance Migration in Camunda 7

Camunda 7 mendukung process instance migration antar process definition version.

Migration bukan hal sepele.

Misalnya:

```text
v1:
Start -> Review -> Approve -> End

v2:
Start -> PreCheck -> Review -> Approve -> End
```

Running instance yang sedang di `Review` mungkin bisa dimigrasi ke `Review` v2.

Tetapi jika:

- activity id berubah;
- scope berubah;
- multi-instance berubah;
- subprocess boundary berubah;
- variable contract berubah;
- event subscription berubah;

migration bisa kompleks atau tidak valid.

Prinsip:

```text
Stable BPMN activity id is migration asset.
```

Jangan sering rename `id` BPMN hanya karena label berubah.

```xml
<bpmn:userTask id="reviewApplication" name="Review Application"/>
```

`name` boleh berubah lebih mudah daripada `id`.

Migration checklist:

1. Apa versi asal dan target?
2. Activity mana yang active?
3. Mapping activity id bagaimana?
4. Apakah scope hierarchy berubah?
5. Apakah variable contract kompatibel?
6. Apakah listener/delegate kompatibel?
7. Apakah user task form berubah?
8. Apakah audit implications dipahami?
9. Apakah dry-run sudah dilakukan?
10. Apakah rollback plan ada?

---

## 38. Versioning Strategy

Camunda 7 membuat process definition version baru saat deployment baru dengan key yang sama.

New process instance biasanya memakai latest version jika start by key.

Running instance tetap memakai version lama kecuali dimigrasi.

Artinya:

```text
Deploy v2 tidak otomatis mengubah running instance v1.
```

Ini bagus untuk stability, tetapi:

- worker/delegate code harus support v1 dan v2;
- UI harus handle task dari beberapa versi;
- variable contract lama masih muncul;
- reporting harus gabungkan multiple versions;
- bug fix process untuk running instance butuh migration atau operational repair.

Strategy:

### Compatible additive change

Contoh:

- tambah optional variable;
- tambah logging listener;
- tambah non-breaking task after stable point.

Mungkin tidak perlu migrate running instances.

### Breaking change

Contoh:

- ubah core path;
- hapus activity active;
- ubah variable type;
- ubah task completion contract;
- ubah call activity mapping.

Perlu migration plan.

### New process key

Jika perubahan secara business besar:

```text
licensingApplicationV2
```

Kadang lebih jelas daripada memaksa migration.

---

## 39. Camunda 7 Testing Strategy

Testing Camunda 7 harus mencakup:

1. Unit test delegate.
2. Process path test.
3. BPMN model validation.
4. User task completion test.
5. Timer test.
6. Message correlation test.
7. Error boundary test.
8. Retry/incident test.
9. Migration test.
10. Integration test with DB.

Contoh pseudo-test:

```java
@Test
void shouldRouteToManualReviewWhenRiskHigh() {
    ProcessInstance pi = runtimeService.startProcessInstanceByKey(
        "licensingApplication",
        Map.of("riskScore", 90)
    );

    Task task = taskService.createTaskQuery()
        .processInstanceId(pi.getId())
        .taskDefinitionKey("manualReview")
        .singleResult();

    assertNotNull(task);
}
```

Testing jangan hanya happy path.

Test minimal untuk process penting:

```text
happy path
rejection path
missing document path
timer escalation path
technical failure path
BPMN error path
message duplicate path
migration path
```

---

## 40. Performance and Database Considerations

Camunda 7 performance sangat terkait database.

Bottleneck umum:

1. ACT_RU_JOB acquisition.
2. ACT_RU_VARIABLE large payload.
3. ACT_HI_DETAIL huge history.
4. ACT_HI_VARINST high churn.
5. Missing indexes for query pattern.
6. Large task query with candidate groups.
7. Long-running transaction.
8. Deadlock/optimistic locking.
9. Job executor over-aggressive polling.
10. Connection pool exhaustion.

Key metrics:

```text
active process instances
active tasks
job backlog
failed jobs
incident count
job acquisition duration
DB CPU
DB locks
connection pool usage
history growth
largest variable payload
task query latency
```

Production tuning is not only engine config. It includes:

- process model design;
- variable size discipline;
- history cleanup;
- DB indexing;
- API query pagination;
- job executor sizing;
- thread pool sizing;
- connection pool sizing;
- async boundary placement.

---

## 41. History Cleanup

History cleanup is critical.

Without cleanup:

```text
ACT_HI_* grows forever
queries slow down
storage grows
backup time grows
index maintenance grows
audit retrieval becomes harder
```

But cleanup must respect regulatory retention.

Do not blindly delete history.

Define retention:

```text
application process history: 7 years
payment process history: 7 years
notification process history: 2 years
technical test process: 30 days
```

Questions:

1. What must be retained by law/policy?
2. What is already stored in domain audit?
3. What can be deleted?
4. What can be archived?
5. What is required for dispute investigation?
6. What is required for operational debugging?
7. Who approves cleanup?

---

## 42. Cockpit, Tasklist, Admin

Camunda 7 webapps:

### Cockpit

Used for:

- process monitoring;
- instance inspection;
- incidents;
- retries;
- variables;
- migration;
- operations.

### Tasklist

Used for:

- human task work;
- claim/complete;
- forms;
- candidate tasks.

### Admin

Used for:

- users/groups;
- authorization;
- system management.

In enterprise custom apps, these may be internal/support tools rather than end-user tools.

Governance:

```text
Cockpit access should be privileged.
Tasklist access depends on workflow model.
Admin access should be highly restricted.
```

Do not give broad Cockpit repair access casually.

---

## 43. Camunda 7 and Java 8–25

Camunda 7 historically fits Java 8+ enterprise applications, but actual supported Java versions depend on Camunda 7 release and dependencies.

Engineering guidance across Java versions:

### Java 8

Common in legacy Camunda 7.

Constraints:

- no records;
- no var;
- no modern switch;
- no virtual threads;
- older TLS/cipher defaults;
- older dependency ecosystem.

Use:

- simple DTOs;
- explicit transaction boundaries;
- conservative libraries.

### Java 11

Good modernization baseline for many older Spring apps.

Use:

- improved JVM;
- better TLS;
- better container awareness than Java 8;
- still conservative.

### Java 17

Strong LTS baseline.

Consider:

- better GC options;
- records if supported by project style;
- modern Spring ecosystem;
- better performance.

### Java 21/25

If platform supports it:

- virtual threads are tempting but not automatically useful inside Camunda 7 job executor;
- be careful with thread-local transaction/security context;
- library compatibility matters;
- app server compatibility matters;
- Camunda 7 support matrix must be respected.

Important:

```text
Do not assume modern Java feature is safe inside legacy embedded engine.
```

Especially around:

- classloading;
- serialization;
- expression language;
- script engine;
- transaction manager;
- job executor thread pool.

---

## 44. Comparing Camunda 7 JavaDelegate and Camunda 8 Worker

| Concern | Camunda 7 JavaDelegate | Camunda 8 Worker |
|---|---|---|
| Invocation | Engine calls Java code directly | Worker activates job remotely |
| Runtime coupling | High | Lower |
| Transaction | Can join engine transaction | Separate transaction |
| Scaling | Scale app/engine together | Scale worker separately |
| Failure | Exception rollback/retry via job if async | fail/complete/error job |
| Deployment | BPMN and code often same app | BPMN and worker separate |
| Data store | Relational DB engine | Zeebe log/state + exporters |
| Side effect risk | Hidden in local transaction | Explicit remote worker boundary |
| Testing | engine test + delegate test | worker contract + process test |
| Migration style | process instance migration in DB engine | different model/tooling |

Neither is universally better.

Camunda 7 is powerful when:

- strong Java integration needed;
- database-centric enterprise environment;
- local transaction with domain DB is valuable;
- legacy system already uses it.

Camunda 8 is stronger when:

- cloud-native orchestration needed;
- workers must scale separately;
- polyglot architecture;
- high process orchestration throughput;
- remote operational platform preferred.

---

## 45. Migration Mindset from Camunda 7 to Camunda 8

Migration is not “upgrade dependency”.

It is architectural migration.

Areas to assess:

1. BPMN element compatibility.
2. JavaDelegate usage.
3. Execution listener usage.
4. Task listener usage.
5. Script task usage.
6. External task usage.
7. Variable serialization.
8. Process instance migration needs.
9. History/reporting dependencies.
10. Cockpit/Tasklist usage.
11. REST API usage.
12. Custom authorization.
13. DMN usage.
14. Forms usage.
15. Custom database queries to ACT_* tables.
16. Transaction boundary assumptions.
17. Synchronous service task assumptions.
18. Error handling semantics.
19. Incident operations.
20. Deployment pipeline.

Migration classification:

```text
Easy:
  external task heavy
  clean BPMN
  small variable payloads
  custom UI already separate
  no internal ACT_* queries

Hard:
  many JavaDelegates
  heavy listeners
  embedded transaction assumptions
  custom Cockpit plugins
  direct ACT_* queries
  complex migration of running instances
  script-heavy processes
```

---

## 46. Refactoring Camunda 7 Toward Camunda 8 Readiness

Even before migrating, improve Camunda 7 architecture:

1. Move heavy JavaDelegate logic into domain services.
2. Add async boundaries before side-effect tasks.
3. Introduce idempotency keys.
4. Use external task for remote services.
5. Stop querying ACT_* tables in application logic.
6. Minimize variables.
7. Define variable contracts.
8. Add business key consistently.
9. Separate domain audit from Camunda history.
10. Build custom task API if needed.
11. Add process path tests.
12. Add incident runbooks.
13. Add process versioning discipline.
14. Remove hidden listener business logic.
15. Replace scripts with DMN/Java service.
16. Document migration constraints.

This gives value even if migration never happens.

---

## 47. Camunda 7 Production Architecture Patterns

### Pattern 1 — Embedded Monolith Workflow

```text
Spring Boot App
  + Camunda Engine
  + Domain Services
  + Job Executor
  + Same DB or related DB
```

Good for:

- simple deployment;
- cohesive domain;
- moderate scale;
- local transaction.

Risk:

- tight coupling;
- scaling constraints;
- delegate side effect risk.

### Pattern 2 — Embedded Modular Workflow

```text
Spring Boot App
  workflow module
  domain module
  integration module
  audit module
```

Better internal boundaries.

### Pattern 3 — Remote Camunda 7 Engine + External Workers

```text
Camunda Run
  + DB
  + REST API
Workers
  + Domain APIs
Custom UI
```

Good bridge toward Camunda 8.

### Pattern 4 — Custom Case App + Camunda 7 Engine

```text
Custom Case Management UI
  -> Case Backend
      -> Domain DB
      -> Camunda Runtime/Task API
```

Best fit for regulatory workflows where Camunda is orchestration engine, not entire application.

---

## 48. Example: Regulatory Application Process in Camunda 7

Process:

```text
Submit Application
  -> Validate Completeness
  -> Officer Review
  -> Risk Decision
  -> if Low Risk: Approve
  -> if High Risk: Supervisor Review
  -> Generate Licence
  -> Notify Applicant
  -> End
```

Implementation approach:

```text
Submit:
  application backend saves domain data
  start process with business key

Validate Completeness:
  JavaDelegate with asyncBefore
  reads applicationId
  calls domain validation service
  writes validationStatus variable

Officer Review:
  user task
  custom UI
  complete via backend

Risk Decision:
  DMN or domain risk service

Generate Licence:
  external task or async delegate
  idempotent command

Notify Applicant:
  outbox/email worker
  not direct synchronous send
```

BPMN principles:

- business key = application id;
- variable minimal;
- document content stored in document service, not process variable;
- task completion goes through domain backend;
- technical failures become job retry/incident;
- business rejection becomes BPMN path;
- generated licence side effect idempotent;
- audit exists in both domain audit and process history.

---

## 49. Design Review Checklist for Camunda 7

### Process Model

- Is the BPMN readable?
- Are activity IDs stable?
- Are async boundaries placed before risky service tasks?
- Are BPMN errors used only for business exceptions?
- Are timers modeled with business revalidation?
- Are parallel branches safe?
- Are subprocess scopes clear?

### Java Code

- Are JavaDelegates thin?
- Is business logic in domain services?
- Are external calls idempotent?
- Are timeouts configured?
- Are retries intentional?
- Are exceptions classified?
- Are listeners not hiding core logic?

### Transactions

- Which datasource/transaction manager is used?
- Does process start join domain transaction?
- Are external side effects outside rollback assumptions?
- Are async boundaries used to split transaction?
- Is outbox needed?

### Variables

- Is variable payload small?
- Is variable contract documented?
- Are sensitive fields minimized?
- Is schema evolution considered?
- Are large documents stored by reference?

### User Tasks

- Is task completion authorized by application backend?
- Is maker-checker enforced?
- Is double submit safe?
- Are stale tasks handled?
- Are decisions audited?

### Operations

- Is job executor configured?
- Are incidents monitored?
- Is history cleanup configured?
- Are Cockpit permissions restricted?
- Are retry runbooks defined?
- Is migration plan documented?

### Migration Readiness

- Any JavaDelegates with heavy logic?
- Any direct ACT_* table queries?
- Any script tasks?
- Any listener-hidden business logic?
- Any custom Cockpit plugin?
- Any transaction assumption that fails in Camunda 8?
- Any process instance migration requirement?

---

## 50. Common Camunda 7 Anti-patterns

### Anti-pattern 1 — BPMN as Java Call Graph

Diagram becomes:

```text
Task A -> Task B -> Task C -> Task D
```

Each task maps to one Java method.

Problem:

- no business meaning;
- too technical;
- hard for business/audit;
- BPMN adds little value.

Better:

```text
BPMN models business milestones and wait states.
Java models internal computation.
```

### Anti-pattern 2 — One Huge Process

Everything in one BPMN:

```text
application + payment + appeal + enforcement + renewal + notification
```

Problem:

- unreadable;
- hard migration;
- hard testing;
- high blast radius.

Better:

```text
Process landscape:
  application process
  payment subprocess/process
  appeal process
  enforcement process
  notification process
```

### Anti-pattern 3 — Process Variables as Domain Database

Storing:

```text
full applicant profile
all documents
all comments
entire form payload
all payment details
```

Problem:

- history bloat;
- privacy risk;
- slow queries;
- versioning pain.

Better:

```text
applicationId
decision
status
riskLevel
documentReference
paymentReference
```

### Anti-pattern 4 — Direct ACT_* Table Integration

Application queries Camunda internal tables for normal features.

Problem:

- fragile;
- unsupported;
- bypasses API semantics;
- hard migration.

Better:

```text
Use RuntimeService/TaskService/HistoryService/REST.
Build domain read model if needed.
```

### Anti-pattern 5 — Hidden Listener Logic

Critical assignment/business decisions hidden in listener code.

Problem:

- diagram lies;
- difficult debugging;
- audit weak.

Better:

```text
Core decision visible as BPMN/DMN/domain action.
Listener only cross-cutting concern.
```

### Anti-pattern 6 — No Async Boundary Before Remote Call

Synchronous delegate calls remote API in caller transaction.

Problem:

- timeout;
- rollback ambiguity;
- duplicate side effect;
- bad user latency.

Better:

```text
asyncBefore + idempotency / external task / outbox.
```

### Anti-pattern 7 — Retry Everything

Every exception retries 3 times.

Problem:

- retries business failures;
- delays correct path;
- creates noise;
- hides data bugs.

Better:

```text
Classify:
  transient technical -> retry
  business expected -> BPMN path
  data/code bug -> incident/manual repair
```

---

## 51. Top 1% Mental Model for Camunda 7

A strong engineer thinks like this:

```text
Camunda 7 is not only a BPMN runner.
It is a transactional process runtime embedded in or connected to a Java application,
with relational database state, command execution, async job execution, human task state,
history persistence, and operational repair mechanisms.
```

The core questions are:

1. In whose transaction is this action running?
2. What happens if this JavaDelegate throws after a side effect?
3. Where is the wait state?
4. What state is in Camunda vs domain DB?
5. What can be retried safely?
6. What is business error vs technical failure?
7. What happens during rolling deployment?
8. Can running instances survive code/model version changes?
9. Can support repair this without corrupting audit?
10. Can we migrate this to Camunda 8 later?

Top 1% engineers do not merely ask:

```text
How do I implement a service task?
```

They ask:

```text
What is the consistency boundary of this process step?
What is the failure window?
What is the replay behavior?
What is the audit evidence?
What is the migration path?
```

---

## 52. Summary

Camunda 7 is powerful because it brings BPMN execution directly into the Java enterprise world.

Its strengths:

- deep Java/Spring integration;
- mature BPMN engine;
- strong relational persistence;
- local API;
- task/runtime/history services;
- job executor;
- webapps for operations;
- mature enterprise adoption.

Its risks:

- tight coupling;
- hidden transaction traps;
- JavaDelegate side-effect ambiguity;
- database growth;
- job executor tuning complexity;
- migration complexity;
- overuse of process variables;
- hidden business logic in listeners/scripts;
- direct internal table dependency.

The central engineering lesson:

```text
Camunda 7 gives you great power by letting process engine, Java code, and database transaction live close together.
That closeness is useful, but dangerous.
Production-grade design requires explicit boundaries.
```

For legacy systems, mastering Camunda 7 means being able to:

- support incidents;
- refactor unsafe delegates;
- tune job executor;
- govern process variables;
- design safe user task completion;
- manage history cleanup;
- migrate process definitions;
- prepare transition toward Camunda 8.

---

## 53. What Comes Next

Part 17 has focused on Camunda 7.

Next:

```text
Part 18 — Camunda 8 Deep Dive:
Zeebe, Workers, Operate, Tasklist, Optimize, Identity
```

Part 18 will return to Camunda 8 and go deeper into its platform components, operational architecture, and self-managed/SaaS deployment mental model.

---

## 54. Practical Exercises

### Exercise 1 — Classify Service Tasks

Take an existing BPMN process and classify each service task:

```text
local computation
domain DB operation
external API call
message publish
document generation
email notification
payment operation
```

For each one, decide:

```text
sync JavaDelegate?
asyncBefore JavaDelegate?
external task?
outbox?
DMN?
should not be in BPMN?
```

### Exercise 2 — Find Transaction Traps

For every JavaDelegate, answer:

1. Does it call external system?
2. Does it write domain DB?
3. Does it write process variable?
4. What happens if it fails after side effect?
5. Is it idempotent?
6. Is there async boundary before it?
7. Is retry safe?

### Exercise 3 — Migration Readiness Score

Score your Camunda 7 app:

```text
0 = not present
1 = minor
2 = moderate
3 = heavy
```

Criteria:

- JavaDelegate heavy logic
- script task usage
- execution listener business logic
- direct ACT_* queries
- large process variables
- custom Cockpit usage
- embedded transaction assumptions
- external calls in delegates
- no process tests
- no migration tests

High score means migration to Camunda 8 will need architectural refactoring.

### Exercise 4 — Build Incident Runbook

For one failed job incident, document:

```text
business key
process instance id
failed activity
exception
retry count
root cause
fix action
variable correction needed?
retry action
audit/support note
postmortem prevention
```

### Exercise 5 — Refactor Delegate

Take a delegate that calls external API directly and refactor into:

```text
delegate:
  creates durable command/outbox

worker:
  sends external API request idempotently

process:
  waits for result message or continues after command accepted
```

---

## 55. Minimal Production Rules

If you remember only a few rules:

1. Do not put large domain payloads in process variables.
2. Do not call unreliable external systems synchronously without async boundary.
3. Do not treat `RuntimeException` and `BpmnError` as the same thing.
4. Do not expose raw Camunda task completion directly from frontend without domain authorization.
5. Do not query/update `ACT_*` tables as application integration.
6. Do not rename BPMN activity IDs casually.
7. Do not deploy new process definitions without worker/delegate compatibility analysis.
8. Do not retry business failures.
9. Do not use Camunda history as the only legal audit source.
10. Do not migrate to Camunda 8 as if it were dependency upgrade.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java BPMN, Camunda, and Process Orchestration Engineering](./learn-java-bpmn-camunda-part-16-saga-long-running-transaction-engineering-with-bpmn.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java BPMN + Camunda Process Orchestration Engineering](./learn-java-bpmn-camunda-part-18-camunda-8-zeebe-workers-operate-tasklist-optimize-identity.md)

</div>