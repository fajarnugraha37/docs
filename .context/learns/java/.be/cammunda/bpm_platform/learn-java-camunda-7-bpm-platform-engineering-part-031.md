# learn-java-camunda-7-bpm-platform-engineering-part-031.md

# Part 031 — Extending the Engine: ProcessEnginePlugin, Custom Incident Handler, History Event Handler, Custom Batch, dan Extension Governance

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `031`  
> Topik: Camunda 7 engine extension points, internal API risk, governance, dan production-grade extension design  
> Target: engineer yang ingin mampu memperluas Camunda 7 secara aman tanpa membuat platform menjadi rapuh, sulit di-upgrade, atau tidak bisa dioperasikan.

---

## 1. Posisi Bagian Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- engine architecture,
- transaction boundary,
- job executor,
- database schema,
- variable system,
- delegates/listeners,
- external task,
- message/timer/user-task,
- history/audit,
- security,
- Spring Boot dan Java EE integration,
- REST/API governance,
- DMN/CMMN,
- performance,
- DB operations,
- observability,
- testing,
- correctness modelling,
- advanced patterns/anti-patterns.

Sekarang kita masuk ke area yang lebih berbahaya: **memperluas engine Camunda 7**.

Ini bukan sekadar menulis `JavaDelegate` atau `TaskListener`. Itu sudah dibahas. Di sini kita membahas mekanisme yang lebih dekat ke konfigurasi dan internal lifecycle engine:

- `ProcessEnginePlugin`,
- custom history event handler,
- custom history level / producer,
- custom incident handler,
- custom parse listener,
- custom command,
- custom command interceptor,
- custom authorization behavior,
- custom batch-like orchestration,
- custom metrics/event export,
- custom platform policy enforcement.

Di level ini, satu keputusan buruk bisa menyebabkan:

- engine tidak bisa start,
- history hilang,
- incident tidak muncul,
- deployment gagal,
- upgrade minor version rusak,
- transaction boundary menjadi tidak jelas,
- audit tidak defensible,
- performance DB memburuk,
- operational tooling tidak lagi cocok dengan engine state.

Karena itu bagian ini bukan mengajarkan “semua bisa di-customize”. Justru sebaliknya: bagian ini mengajarkan **kapan tidak boleh meng-customize engine**.

---

## 2. Mental Model: Extension Point Bukan Shortcut

Camunda 7 menyediakan banyak extension point. Tetapi semua extension point tidak setara.

Ada extension point yang relatif aman:

- JavaDelegate,
- ExecutionListener,
- TaskListener,
- External Task Worker,
- REST/domain API wrapper,
- BPMN Parse Listener yang hanya melakukan validasi,
- ProcessEnginePlugin untuk konfigurasi yang jelas dan terisolasi.

Ada extension point yang jauh lebih berisiko:

- custom command,
- custom command interceptor,
- custom history event handler yang mengganti default handler,
- custom incident handler,
- custom authorization provider,
- penggunaan `org.camunda.bpm.engine.impl.*`,
- manipulasi internal entity seperti `ExecutionEntity`, `JobEntity`, `TaskEntity`, `CommandContext`, `DbEntityManager`.

Mental model yang tepat:

```text
Application Extension
  relatif aman
  contoh: delegates, listeners, external workers, domain API wrapper

Platform Extension
  sedang-berisiko
  contoh: ProcessEnginePlugin, parse listener, custom history policy

Engine Internal Extension
  tinggi-risiko
  contoh: custom command, custom incident handler, command interceptor, internal entity mutation
```

Semakin rendah ke engine internal, semakin besar konsekuensi terhadap:

- compatibility,
- testing burden,
- upgrade cost,
- observability,
- audit,
- failure mode,
- operational recovery.

Aturan senior/principal:

> Jangan memakai extension point internal hanya karena lebih cepat. Pakai hanya ketika ada platform invariant yang tidak bisa ditegakkan di layer yang lebih aman.

---

## 3. Public API vs Internal API

Camunda 7 punya public API dan internal API.

Public API biasanya berada di package seperti:

```text
org.camunda.bpm.engine
org.camunda.bpm.engine.runtime
org.camunda.bpm.engine.task
org.camunda.bpm.engine.history
org.camunda.bpm.engine.repository
org.camunda.bpm.engine.management
org.camunda.bpm.engine.delegate
```

Internal API sering berada di package:

```text
org.camunda.bpm.engine.impl.*
```

Contoh internal:

```text
org.camunda.bpm.engine.impl.interceptor.CommandContext
org.camunda.bpm.engine.impl.persistence.entity.ExecutionEntity
org.camunda.bpm.engine.impl.jobexecutor.JobExecutor
org.camunda.bpm.engine.impl.history.handler.HistoryEventHandler
org.camunda.bpm.engine.impl.incident.IncidentHandler
org.camunda.bpm.engine.impl.bpmn.parser.BpmnParseListener
```

Beberapa extension point penting memang ada di `impl.*`, karena Camunda 7 secara historis membuka banyak kemampuan extension melalui internal package.

Tetapi konsekuensinya:

```text
Internal API tidak punya stabilitas kontrak sekuat public API.
```

Artinya:

- method bisa berubah,
- class bisa berubah,
- lifecycle callback bisa berubah,
- internal invariant bisa berubah,
- behavior bisa berubah antar minor version,
- test yang dulu pass bisa gagal setelah upgrade.

Jadi kalau memakai internal API, lakukan dengan disiplin:

1. Bungkus dalam module kecil.
2. Jangan sebar usage `impl.*` ke seluruh codebase.
3. Pin version Camunda.
4. Buat integration test yang benar-benar start engine.
5. Buat upgrade test untuk setiap target Camunda minor.
6. Dokumentasikan alasan bisnis/teknis kenapa extension ini ada.
7. Sediakan fallback/disable switch bila memungkinkan.

---

## 4. Decision Framework: Kapan Extension Engine Layak?

Sebelum membuat engine extension, tanya pertanyaan ini:

### 4.1 Apakah bisa diselesaikan di model BPMN?

Contoh:

- SLA? Gunakan timer boundary/event subprocess.
- Branching bisnis? Gunakan gateway/DMN.
- Error bisnis? Gunakan BPMN Error.
- Escalation? Gunakan escalation/timer.

Kalau bisa diselesaikan dengan BPMN/DMN secara jelas, jangan buru-buru extension.

### 4.2 Apakah bisa diselesaikan di application layer?

Contoh:

- authorization?
- tenant filtering?
- task queue projection?
- audit domain?
- validation sebelum complete task?

Sering kali lebih aman membuat domain API wrapper daripada mengubah engine behavior.

### 4.3 Apakah bisa diselesaikan dengan listener/delegate?

Contoh:

- set task due date,
- enrich variable,
- emit domain audit,
- validate variable,
- route assignment.

Listener/delegate lebih mudah dites dan lebih sedikit menyentuh engine internals.

### 4.4 Apakah ini policy lintas semua process model?

Kalau requirement-nya adalah:

- semua service task harus `asyncBefore`,
- semua user task harus punya candidate group,
- semua process definition harus punya TTL,
- semua external task harus punya topic prefix,
- semua variable object serialization dilarang,
- semua deployment harus memenuhi naming convention,

maka parse listener atau deployment validation bisa masuk akal.

### 4.5 Apakah extension memengaruhi audit/legal evidence?

Kalau ya, treat as high-risk.

Contoh:

- custom history handler,
- filtering history event,
- exporting event to external audit store,
- suppressing variable history,
- altering incident behavior.

Ini harus punya governance, test, dan sign-off.

---

## 5. ProcessEnginePlugin

`ProcessEnginePlugin` adalah extension point yang memungkinkan kita menyesuaikan process engine configuration selama lifecycle engine bootstrap.

Secara konseptual:

```text
Engine bootstrap
  -> create ProcessEngineConfiguration
  -> apply plugins before initialization
  -> initialize engine internals
  -> build ProcessEngine
  -> apply post-build behavior if any
```

Plugin sering dipakai untuk:

- menambahkan parse listener,
- mengubah history event handler,
- mengatur custom incident handler,
- menambah custom pre/post command interceptor,
- mengubah job executor setting,
- menambahkan event publisher,
- enforce configuration policy,
- set custom ID generator,
- menambahkan custom history level,
- configure metrics/history cleanup policy.

Skeleton sederhana:

```java
import org.camunda.bpm.engine.impl.cfg.ProcessEnginePlugin;
import org.camunda.bpm.engine.impl.cfg.ProcessEngineConfigurationImpl;
import org.camunda.bpm.engine.impl.interceptor.CommandExecutor;

public final class PlatformPolicyEnginePlugin implements ProcessEnginePlugin {

    @Override
    public void preInit(ProcessEngineConfigurationImpl configuration) {
        // Called before engine internals are initialized.
        // Good for altering configuration lists, handlers, listeners.
    }

    @Override
    public void postInit(ProcessEngineConfigurationImpl configuration) {
        // Called after initialization of engine configuration.
        // Useful when defaults have been initialized and you want to inspect/augment them.
    }

    @Override
    public void postProcessEngineBuild(org.camunda.bpm.engine.ProcessEngine processEngine) {
        // Called after engine has been built.
        // Avoid heavy business work here.
    }
}
```

Dalam Spring Boot, plugin biasanya didaftarkan sebagai bean:

```java
import org.camunda.bpm.engine.impl.cfg.ProcessEnginePlugin;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class CamundaPluginConfiguration {

    @Bean
    public ProcessEnginePlugin platformPolicyEnginePlugin() {
        return new PlatformPolicyEnginePlugin();
    }
}
```

### 5.1 preInit vs postInit vs postProcessEngineBuild

Gunakan mental model ini:

```text
preInit
  sebelum engine menyiapkan banyak default internal config
  cocok untuk menambah/mengganti konfigurasi awal

postInit
  setelah konfigurasi default engine disiapkan
  cocok untuk memeriksa final config dan wrap default handler

postProcessEngineBuild
  engine sudah dibuat
  cocok untuk lightweight verification, registration, logging
```

Kesalahan umum:

```java
@Override
public void postProcessEngineBuild(ProcessEngine processEngine) {
    // BAD: menjalankan migration/cleanup/heavy query saat app startup
}
```

Kenapa buruk?

- Startup menjadi tidak deterministik.
- Pod/container bisa crashloop.
- Engine cluster bisa melakukan kerja yang sama berkali-kali.
- Operational action tersembunyi di startup lifecycle.

Lebih baik:

- expose admin command eksplisit,
- scheduled maintenance job dengan lock,
- migration pipeline terpisah,
- CI/CD step terkontrol.

---

## 6. Parse Listener: Enforcing Model Policy at Deployment Time

BPMN parse listener memungkinkan kita memeriksa/memodifikasi model ketika BPMN di-parse oleh engine.

Use case yang sehat:

- reject service task tanpa async boundary,
- reject user task tanpa candidate group,
- reject process tanpa history TTL,
- enforce ID naming convention,
- reject Java serialization variable pattern tertentu,
- inject listener platform untuk audit metadata,
- collect metadata for governance.

Use case yang berbahaya:

- diam-diam mengubah behavior model secara besar,
- menambahkan business logic tersembunyi,
- mengubah gateway/timer/sequence flow semantics,
- membuat model di Cockpit/Modeler tidak lagi merepresentasikan runtime sebenarnya.

Prinsip:

> Parse listener boleh enforcing policy. Jangan membuat BPMN visual berbeda jauh dari behavior runtime.

Contoh pseudo-code policy:

```java
public final class ServiceTaskPolicyParseListener extends AbstractBpmnParseListener {

    @Override
    public void parseServiceTask(Element serviceTaskElement,
                                 ScopeImpl scope,
                                 ActivityImpl activity) {
        String activityId = activity.getId();
        String asyncBefore = serviceTaskElement.attributeNS(CAMUNDA_NS, "asyncBefore");

        if (!"true".equals(asyncBefore)) {
            throw new ProcessEngineException(
                "Service task " + activityId + " must use camunda:asyncBefore=\"true\""
            );
        }
    }
}
```

Catatan:

- API detail bisa berbeda antar versi Camunda 7.
- Banyak class parse listener berada di internal package.
- Treat sebagai internal extension.

Cara mendaftarkan parse listener melalui plugin secara konseptual:

```java
@Override
public void preInit(ProcessEngineConfigurationImpl configuration) {
    List<BpmnParseListener> listeners = configuration.getCustomPreBPMNParseListeners();
    if (listeners == null) {
        listeners = new ArrayList<>();
        configuration.setCustomPreBPMNParseListeners(listeners);
    }
    listeners.add(new ServiceTaskPolicyParseListener());
}
```

### 6.1 Validasi vs Mutasi

Lebih baik:

```text
parse listener validates and rejects bad model
```

daripada:

```text
parse listener silently rewrites model semantics
```

Contoh sehat:

```text
Reject deployment because user task is missing candidate group.
```

Contoh berbahaya:

```text
Automatically add candidate group based on naming convention without making it visible to model owner.
```

Kenapa?

Karena operator, BA, QA, dan auditor membaca BPMN sebagai executable contract. Kalau engine diam-diam mengubah behavior, model kehilangan trust.

---

## 7. Custom History Event Handler

History event handler bertanggung jawab mengonsumsi history event. Default implementation menulis history ke Camunda database.

Custom history event handler bisa dipakai untuk:

- export audit event ke Kafka/SQS/Splunk/OpenSearch,
- filter event tertentu,
- duplicate event ke external audit store,
- enrich event metadata,
- create process mining event log,
- implement external compliance audit pipeline.

Tetapi ini area sangat sensitif.

Jika mengganti default handler secara salah, akibatnya bisa fatal:

- `ACT_HI_*` tidak terisi,
- Cockpit history rusak,
- audit internal hilang,
- cleanup behavior berubah,
- incident forensic sulit,
- regulatory evidence tidak lengkap.

### 7.1 Jangan Mengganti Default Handler Tanpa Composite

Anti-pattern:

```java
configuration.setHistoryEventHandler(new MyExternalOnlyHistoryEventHandler());
```

Jika handler ini tidak menulis ke database, maka history Camunda bisa hilang.

Pattern yang lebih aman:

```text
Composite handler
  -> default DB history handler tetap jalan
  -> custom export handler menerima copy event
```

Pseudocode:

```java
public final class CompositeHistoryEventHandler implements HistoryEventHandler {

    private final HistoryEventHandler databaseHandler;
    private final HistoryEventHandler exportHandler;

    public CompositeHistoryEventHandler(HistoryEventHandler databaseHandler,
                                        HistoryEventHandler exportHandler) {
        this.databaseHandler = databaseHandler;
        this.exportHandler = exportHandler;
    }

    @Override
    public void handleEvent(HistoryEvent historyEvent) {
        databaseHandler.handleEvent(historyEvent);
        exportHandler.handleEvent(historyEvent);
    }

    @Override
    public void handleEvents(List<HistoryEvent> historyEvents) {
        databaseHandler.handleEvents(historyEvents);
        exportHandler.handleEvents(historyEvents);
    }
}
```

Tetapi ini pun belum cukup.

Masalah berikutnya: **transaction coupling**.

### 7.2 Transaction Coupling Problem

History event handler dipanggil dalam konteks engine transaction.

Kalau handler melakukan HTTP call ke audit service secara synchronous:

```java
public void handleEvent(HistoryEvent event) {
    auditClient.post(event); // dangerous inside engine tx
}
```

Risiko:

- audit service lambat -> process transaction lambat,
- audit service down -> process execution gagal,
- retry engine -> duplicate audit event,
- transaction rollback -> audit event sudah terkirim padahal process state rollback,
- backpressure hilang,
- outage audit menurunkan availability workflow.

Pattern lebih aman:

```text
HistoryEventHandler
  -> write minimal export record into local outbox table in same DB transaction
  -> separate exporter reads outbox
  -> send to external audit/event platform
  -> mark exported idempotently
```

Atau:

```text
Use DB history as source
  -> CDC/Debezium/exporter reads ACT_HI_* or dedicated audit projection
```

Trade-off:

- handler direct export: near realtime, but risky.
- local outbox: reliable, controlled, extra table/job.
- CDC: less intrusive, but depends on DB infra and schema interpretation.

### 7.3 Filtering History Events

Filtering history bisa berbahaya.

Contoh requirement:

```text
Do not store sensitive variable values in history.
```

Solusi buruk:

```text
Drop variable update history event blindly.
```

Dampaknya:

- audit gap,
- Cockpit/history query inconsistent,
- support sulit,
- cleanup assumptions berubah,
- regulatory evidence incomplete.

Solusi lebih sehat:

1. Jangan simpan sensitive data sebagai Camunda variable.
2. Simpan reference id saja.
3. Pakai domain secure store untuk sensitive payload.
4. Kalau perlu, store redacted value atau classification metadata.
5. Buat policy variable allowlist.
6. Audit decision/event di domain audit.

Jika filtering tetap diperlukan, dokumentasikan:

- event type apa yang difilter,
- alasan,
- dampak ke Cockpit/history,
- alternative audit source,
- test coverage,
- approval/security sign-off.

---

## 8. Custom History Level dan History Event Producer

History level menentukan berapa banyak history event yang dihasilkan/disimpan.

Camunda menyediakan level seperti:

- none,
- activity,
- audit,
- full,
- auto.

Custom history level bisa dipakai untuk kebutuhan khusus, misalnya:

- store activity/task history tapi tidak variable detail tertentu,
- suppress high-volume variable updates,
- retain job log only under condition,
- compliance-specific event subset.

Namun custom history level adalah keputusan platform besar.

Risiko:

- tooling standard tidak lagi sesuai expectation,
- support team bingung kenapa data history tidak ada,
- audit gap,
- migration/upgrade behavior tidak jelas,
- test matrix lebih besar.

Rule:

> Prefer default history level + variable/data modelling discipline. Custom history level hanya untuk case yang benar-benar justified.

Kalau tujuan hanya mengurangi storage:

- jangan simpan payload besar di variable,
- kurangi variable update frequency,
- pakai local variables dengan lifecycle jelas,
- gunakan history cleanup TTL,
- gunakan external projection untuk reporting,
- archive old history,
- review byte array usage,
- jangan langsung custom history level.

---

## 9. Custom Incident Handler

Incident handler menentukan bagaimana incident dibuat dan di-resolve untuk incident type tertentu.

Default incident behavior penting untuk:

- failed job,
- failed external task,
- operator visibility,
- Cockpit troubleshooting,
- retry/recovery.

Custom incident handler bisa dipakai untuk:

- enrich incident metadata,
- send incident event to monitoring system,
- customize incident creation for custom failure type,
- bridge incident into enterprise ticketing system,
- apply incident classification.

Tetapi jangan gunakan custom incident handler untuk menyembunyikan failure.

Anti-pattern:

```text
When job fails, do not create incident; just log warning.
```

Ini buruk karena:

- process stuck tanpa marker,
- operator tidak tahu,
- SLA dilanggar diam-diam,
- audit recovery tidak jelas.

Pattern lebih baik:

```text
Default incident remains
  + mirror incident to monitoring/ticket system
  + add correlation/business metadata
  + keep operator recovery path in Camunda
```

### 9.1 Incident as Operational State

Incident adalah state operasional.

Jangan samakan dengan business status:

```text
Business: Application rejected
Operational: Process cannot continue due to failed job
```

Jika business outcome gagal, modelkan dengan BPMN Error/decision path.

Jika technical execution gagal dan tidak bisa lanjut otomatis, biarkan incident muncul.

### 9.2 Incident Handler Side Effects

Sama seperti history handler, custom incident handler bisa berada dalam engine transaction.

Jangan lakukan:

```java
ticketingClient.createTicket(...); // synchronous, inside incident creation path
```

Lebih aman:

```text
write incident-export outbox
separate exporter creates ticket idempotently
```

Atau:

```text
monitor ACT_RU_INCIDENT / history incident via read-only exporter
```

---

## 10. Custom Command

Camunda engine internal banyak bekerja dengan command pattern.

Public API seperti:

```java
runtimeService.startProcessInstanceByKey("case-process")
```

pada akhirnya dijalankan sebagai command di dalam command context.

Custom command dapat dibuat untuk operasi advanced yang tidak tersedia di public API.

Contoh use case yang mungkin:

- read internal state dengan cara tertentu,
- execute atomic operation yang harus berada dalam command context,
- custom maintenance operation,
- custom migration aid,
- specialized diagnostic operation.

Tetapi custom command sangat berisiko karena biasanya memakai internal API.

Skeleton konseptual:

```java
public final class MyDiagnosticCommand implements Command<MyResult> {

    @Override
    public MyResult execute(CommandContext commandContext) {
        // Internal engine access here.
        // High risk: internal API.
        return new MyResult(...);
    }
}
```

Execution:

```java
ProcessEngineConfigurationImpl cfg =
    (ProcessEngineConfigurationImpl) processEngine.getProcessEngineConfiguration();

MyResult result = cfg.getCommandExecutorTxRequired()
    .execute(new MyDiagnosticCommand(...));
```

### 10.1 Kapan Custom Command Tidak Layak

Jangan buat custom command untuk:

- start process,
- complete task,
- correlate message,
- query task/history,
- set variable,
- modify process instance,
- retry job,
- resolve incident,
- migrate instance,

karena semua itu sudah punya public API.

Custom command layak dipertimbangkan hanya jika:

- public API tidak cukup,
- operasi harus atomic dengan engine internals,
- ada test dan governance,
- internal access diisolasi,
- ada rencana upgrade.

### 10.2 Custom Command Anti-Pattern

Anti-pattern berat:

```java
commandContext.getDbEntityManager().insert(new ExecutionEntity(...));
```

Jangan membangun internal entity sendiri kecuali benar-benar memahami invariant engine.

Kenapa?

- execution tree bisa corrupt,
- cache/flush ordering rusak,
- history tidak sinkron,
- job/event subscription tidak konsisten,
- process instance tidak bisa dimigrasi/recover.

---

## 11. Command Interceptor

Command interceptor memungkinkan intercept command execution.

Use case:

- logging command duration,
- adding correlation context,
- metrics,
- security enforcement,
- tenant guard,
- tracing.

Risiko:

- semua engine command melewati interceptor,
- latency global bertambah,
- bug memengaruhi seluruh engine,
- ordering interceptor penting,
- exception handling bisa mengubah transaction behavior,
- bisa menyebabkan deadlock kalau melakukan query tambahan sembarangan.

Pattern sehat:

```text
Interceptor should be fast, deterministic, no remote IO, no business logic.
```

Contoh prinsip:

```java
public final class CommandTimingInterceptor extends CommandInterceptor {

    @Override
    public <T> T execute(Command<T> command) {
        long start = System.nanoTime();
        try {
            return next.execute(command);
        } finally {
            long elapsed = System.nanoTime() - start;
            // record local metric only, no remote call
        }
    }
}
```

Jangan:

```java
public <T> T execute(Command<T> command) {
    authzService.callRemotePolicyEngine(); // dangerous
    return next.execute(command);
}
```

Kalau policy membutuhkan remote service, lakukan di application/domain API layer, bukan global command interceptor engine.

---

## 12. Custom Authorization Behavior

Camunda authorization model sudah dibahas di part 020.

Extension authorization bisa menggoda untuk:

- custom permission model,
- tenant-aware security,
- jurisdiction-based access,
- case-level permission,
- organizational hierarchy.

Namun sering kali lebih aman menaruh business authorization di domain API layer.

Kenapa?

Camunda authorization tahu resource engine:

- process definition,
- process instance,
- task,
- deployment,
- group,
- user,
- decision definition,
- batch.

Tetapi regulatory/business authorization sering membutuhkan:

- case type,
- case status,
- officer assignment,
- team/unit,
- agency,
- jurisdiction,
- conflict-of-interest,
- four-eyes rule,
- confidentiality classification,
- legal authority,
- action-specific guard.

Ini lebih cocok di domain layer.

Extension engine authorization layak bila:

- ada kebutuhan platform-wide resource filtering,
- tidak bisa dilakukan di wrapper API,
- surface raw engine API memang harus dibuka,
- performance dan security sudah diuji.

Rule:

> Jangan memaksa Camunda authorization menjadi policy engine bisnis lengkap.

---

## 13. Custom Batch dan Bulk Operation

Camunda 7 punya batch API untuk operasi tertentu seperti migration, modification, deletion, dan restart pada versi tertentu/fitur tertentu.

Kadang tim ingin membuat custom batch untuk:

- bulk retry job,
- bulk update variables,
- bulk migrate business state,
- bulk cancel stale instances,
- bulk export history,
- bulk recompute SLA.

Sebelum membuat custom batch engine-level, pertimbangkan alternatif:

```text
Application-level batch orchestrator
  -> query ids in pages
  -> execute public Camunda API per item
  -> commit per item/small chunk
  -> checkpoint progress
  -> retry idempotently
  -> audit every action
```

Ini sering lebih aman daripada internal custom batch.

### 13.1 Batch Design Requirements

Untuk bulk operation production:

- idempotent,
- checkpointed,
- resumable,
- cancellable,
- rate-limited,
- observable,
- auditable,
- dry-run capable,
- supports allowlist/filter,
- small transaction chunks,
- backpressure-aware,
- has operator approval.

Pseudo-design:

```text
BulkOperationRequest
  id
  type
  filter
  dryRun
  requestedBy
  approvedBy
  status
  createdAt

BulkOperationItem
  requestId
  targetProcessInstanceId
  status
  attempt
  lastError
  completedAt
```

Worker:

```text
while has pending item:
  lock item
  execute public Camunda API
  write result
  emit audit
  continue
```

Untuk regulatory systems, ini biasanya lebih defensible daripada custom internal batch.

---

## 14. Event Export: History Handler vs Listener vs Outbox vs CDC

Salah satu kebutuhan umum enterprise:

```text
Export process events to data lake / monitoring / audit platform.
```

Pilihan:

### 14.1 ExecutionListener/TaskListener Export

Kelebihan:

- dekat dengan BPMN semantics,
- bisa custom per activity/task,
- mudah dipahami developer.

Kekurangan:

- tersebar di model,
- rawan lupa pasang listener,
- bisa mengacaukan transaction,
- bukan central event stream.

### 14.2 History Event Handler Export

Kelebihan:

- central,
- mencakup banyak event engine,
- cocok untuk audit/process mining.

Kekurangan:

- internal extension,
- transaction coupling,
- event structure internal-ish,
- duplicate/rollback semantics harus dipahami.

### 14.3 Domain Outbox

Kelebihan:

- business semantics jelas,
- idempotent,
- decoupled,
- audit friendly.

Kekurangan:

- butuh domain code,
- tidak otomatis mencakup semua engine event.

### 14.4 CDC dari DB

Kelebihan:

- non-intrusive terhadap engine runtime,
- scalable untuk analytics,
- tidak menambah latency process transaction.

Kekurangan:

- tergantung DB schema,
- schema bukan public API,
- event semantics perlu rekonstruksi,
- upgrade harus diuji.

Decision rule:

```text
Need business audit? Use domain audit/outbox.
Need technical process mining? Use history DB/handler/CDC carefully.
Need monitoring? Use metrics/logs + incident/job exporters.
Need realtime side effect? Prefer application event/outbox, not history handler direct HTTP.
```

---

## 15. Engine Plugin Packaging

### 15.1 Spring Boot Embedded

Di Spring Boot:

```java
@Configuration
public class CamundaEngineExtensions {

    @Bean
    public ProcessEnginePlugin processEnginePlugin() {
        return new PlatformPolicyEnginePlugin();
    }
}
```

Plugin ikut lifecycle aplikasi.

Keuntungan:

- mudah versioned bersama app,
- Spring dependency injection tersedia,
- testing relatif mudah,
- cocok untuk embedded engine.

Risiko:

- plugin version sama dengan app; long-running process lama bisa kena plugin baru,
- plugin bisa terlalu tergantung Spring service,
- startup app gagal jika plugin gagal.

### 15.2 Shared Engine / Application Server

Di shared engine, plugin bisa dipasang di engine/container configuration.

Risiko lebih besar:

- plugin berlaku untuk banyak process application,
- classloader lebih kompleks,
- dependency conflict,
- upgrade container/engine lebih sensitif,
- governance harus platform-level.

Rule:

> Di shared engine, engine plugin adalah platform component, bukan application component.

Jangan deploy plugin application-specific ke shared engine global kecuali memang menjadi platform policy.

---

## 16. Versioning and Compatibility of Extensions

Setiap extension harus punya compatibility strategy.

Dokumentasikan:

```text
Extension name:
Purpose:
Owner:
Camunda versions tested:
Java versions tested:
Spring/container versions tested:
Internal APIs used:
Failure mode:
Disable switch:
Observability:
Upgrade test:
Rollback plan:
```

Contoh:

```text
Extension: PlatformBpmnPolicyPlugin
Purpose: Reject BPMN deployment without process TTL and required task assignment metadata
Camunda: 7.20, 7.21, 7.22, 7.23, 7.24 tested
Java: 17, 21 tested
Internal APIs: BpmnParseListener, ProcessEnginePlugin
Failure mode: deployment rejected with explicit error
Disable switch: camunda.platform.policy.enabled=false
Observability: deployment validation log, metric counter
Rollback: disable plugin and redeploy previous artifact
```

### 16.1 Avoid Deep Object Coupling

Bad:

```java
if (executionEntity.getActivity().getActivityBehavior() instanceof SomeInternalClass) {
    // internal behavior mutation
}
```

Better:

- use public API,
- use BPMN model metadata,
- validate XML/model elements,
- avoid mutating runtime internals.

---

## 17. Testing Engine Extensions

Engine extension testing harus lebih serius daripada delegate testing.

### 17.1 Unit Test

Untuk logic murni:

- policy rule,
- event mapping,
- idempotency key generation,
- classification logic.

### 17.2 Engine Bootstrap Test

Test bahwa engine bisa start dengan plugin:

```java
@Test
void engineStartsWithPlugin() {
    ProcessEngine engine = configuration
        .setProcessEnginePlugins(List.of(new PlatformPolicyEnginePlugin()))
        .buildProcessEngine();

    assertNotNull(engine);
    engine.close();
}
```

### 17.3 Deployment Validation Test

Untuk parse listener:

```text
given invalid BPMN without asyncBefore
when deploy
then deployment fails with explicit policy error
```

Dan:

```text
given valid BPMN
when deploy
then deployment succeeds
```

### 17.4 History Handler Test

Test:

- default DB history still written,
- custom export/outbox written,
- rollback does not publish external event prematurely,
- duplicate handling,
- serialization safe,
- sensitive variables redacted.

### 17.5 Incident Handler Test

Test:

- failed job still creates incident,
- incident metadata exported,
- resolving incident works,
- ticket export idempotent,
- plugin failure does not hide incident.

### 17.6 Upgrade Test

Run same extension test suite against target Camunda version.

For example:

```text
Camunda 7.20 + Java 17
Camunda 7.21 + Java 21
Camunda 7.22 + Java 21
Camunda 7.23 + Java 21
Camunda 7.24 + Java 21
```

Kalau organisasi masih punya Java 8/11 estate, matrix harus realistis sesuai Camunda/Spring support.

---

## 18. Operational Safety

Setiap extension harus punya observability.

Minimal:

- startup log jelas,
- config flag terlihat,
- version extension logged,
- metric count untuk action penting,
- error logs structured,
- correlation id/business key bila relevan,
- health/readiness impact jelas,
- dashboard untuk export lag jika ada outbox,
- alert untuk extension failure.

Contoh log startup:

```text
CamundaExtension name=PlatformBpmnPolicyPlugin version=1.4.2 enabled=true camundaVersion=7.24.0 policies=ttl,userTaskAssignment,serviceTaskAsync
```

Kalau extension menolak deployment:

```text
DeploymentRejected processDefinitionKey=case-review activityId=sendEmail reason=SERVICE_TASK_REQUIRES_ASYNC_BEFORE
```

Jangan log:

```text
Validation failed
```

Itu tidak cukup untuk operator.

---

## 19. Failure Modes

### 19.1 Plugin Startup Failure

Jika plugin gagal saat engine startup:

```text
Application cannot start
```

Mitigasi:

- fail-fast untuk policy critical,
- feature flag untuk non-critical exporter,
- clear startup diagnostic,
- smoke test sebelum production.

### 19.2 Parse Listener Too Strict

Jika parse listener terlalu ketat:

```text
Deployment blocked
```

Mitigasi:

- policy versioning,
- warning mode dulu,
- dry-run validator di CI,
- documented remediation.

### 19.3 History Export Slow

Jika history handler synchronous export lambat:

```text
Every process transaction slows down
```

Mitigasi:

- no remote IO in handler,
- outbox,
- asynchronous exporter,
- backpressure metric.

### 19.4 Incident Handler Failure

Jika incident handler error saat incident creation:

```text
Original failure can be obscured
```

Mitigasi:

- handler minimal,
- fallback to default handler,
- never suppress incident,
- log extension failure separately.

### 19.5 Internal API Breaks After Upgrade

Jika internal API berubah:

```text
Compilation/runtime failure or subtle behavior drift
```

Mitigasi:

- isolate internal API usage,
- upgrade test suite,
- avoid reflection hacks,
- version pin,
- compatibility notes.

---

## 20. Regulatory Platform Example

Misal kita membangun regulatory case management platform dengan Camunda 7.

Kebutuhan:

- semua process harus punya TTL,
- semua user task harus punya assignment metadata,
- semua service task remote harus async/external,
- semua task completion harus diaudit,
- semua incident harus muncul di operational dashboard,
- sensitive variables tidak boleh masuk history,
- process events perlu diekspor ke audit lake.

Desain yang sehat:

```text
BPMN CI Validator
  validates model before merge

Parse Listener
  rejects critical policy violation at deployment

Domain API Wrapper
  enforces business authorization, four-eyes, tenant, state invariant

Task Listener
  sets standardized task metadata and domain audit reference

History Event Handler / Outbox
  exports technical process event to local outbox

Outbox Exporter
  sends event to audit lake idempotently

Incident Exporter
  mirrors incidents to monitoring/ticketing without suppressing Camunda incident

Projection Worker
  builds work queue/search/reporting read model
```

Hal yang sengaja tidak dilakukan:

```text
- expose raw Camunda REST to frontend
- put all business authorization in Camunda authorization only
- direct HTTP call from history handler
- suppress history without alternative audit
- mutate ACT_* tables manually
- use custom command for normal task completion
```

---

## 21. Extension Point Decision Table

| Problem | Preferred Solution | Engine Extension? |
|---|---|---:|
| Complete task with business validation | Domain API + TaskService | No |
| Remote service call | External Task / async delegate + outbox | No/Low |
| Enforce every process has TTL | CI validator + parse listener | Maybe |
| Export business decision audit | Domain audit/outbox | No |
| Export technical history events | History event handler/outbox/CDC | Maybe |
| Hide sensitive payload from history | Data modelling + variable policy | Rarely |
| Add incident to ticketing system | Incident exporter/outbox | Maybe |
| Custom query for work queue | Projection/read model | No |
| Bulk retry/cancel/migrate | App-level batch using public API | Usually No |
| Custom atomic internal engine mutation | Custom command | High risk |
| Global tracing/metrics per command | Command interceptor | Maybe, minimal |
| Replace default engine behavior | Internal extension | Avoid unless unavoidable |

---

## 22. Extension Governance Checklist

Before approving an engine extension, answer:

```text
1. What problem does this solve?
2. Why cannot BPMN/DMN/application layer solve it?
3. Which Camunda public/internal APIs are used?
4. What transaction does it run inside?
5. Does it do remote IO?
6. What happens if it fails?
7. Does it affect history/audit/incident visibility?
8. Does it affect deployment/startup?
9. Is it tenant-aware?
10. Is it version-aware?
11. Is it observable?
12. Can it be disabled?
13. Does it have integration tests?
14. Does it have upgrade tests?
15. Is ownership clear?
16. Is rollback plan clear?
```

If these cannot be answered, the extension is not production-ready.

---

## 23. Common Anti-Patterns

### 23.1 Engine Plugin as Dumping Ground

```text
Put all platform hacks into one massive plugin.
```

Better:

```text
small focused plugins with clear ownership and config
```

### 23.2 Direct Remote Calls in Engine Lifecycle

```text
history handler -> HTTP audit service
incident handler -> ticketing REST API
command interceptor -> remote authz service
```

Better:

```text
local outbox + async exporter
```

### 23.3 Silent Model Mutation

```text
parse listener silently changes behavior
```

Better:

```text
validate and reject with clear error
```

### 23.4 Replacing Default History

```text
custom history handler replaces DB history
```

Better:

```text
composite handler or CDC/outbox while preserving standard history unless consciously approved
```

### 23.5 Using Custom Command for Public API Operations

```text
custom command to complete task because developer wants extra checks
```

Better:

```text
domain API validates then calls TaskService.complete
```

### 23.6 Internal Entity Mutation

```text
manual ExecutionEntity/JobEntity mutation
```

Better:

```text
public RuntimeService/ManagementService APIs
```

### 23.7 No Upgrade Tests

```text
works on 7.17, assume works on 7.24
```

Better:

```text
run extension test suite on target minor version
```

---

## 24. Java 8–25 Considerations

Camunda 7 spans a long historical period, while Java evolved from 8 to 25.

For extensions, compatibility matters more than for normal delegates.

### 24.1 Java Language Features

If extension must run on Java 8, avoid:

- records,
- switch expressions,
- sealed classes,
- var,
- pattern matching,
- text blocks,
- virtual threads.

If extension targets Java 17/21, those features can be used in application code, but still be careful if artifact must be shared across older runtime.

### 24.2 Classpath and Module System

Camunda 7 is largely classpath-era technology.

Java 9+ module system can introduce reflective access problems if using strict modules.

For engine extensions:

- avoid deep reflection,
- avoid relying on JDK internal APIs,
- avoid classloader assumptions,
- test on the exact runtime/container.

### 24.3 Virtual Threads

Do not assume virtual threads improve Camunda engine internals.

Camunda 7 Job Executor is built around conventional thread pool and DB transaction model.

Virtual threads may be useful in external worker/application IO layer, but engine extension internals should not depend on virtual-thread-specific behavior unless tested carefully.

### 24.4 Serialization

Extensions that export history/incident/event payload should avoid Java native serialization.

Prefer:

- JSON with explicit schema version,
- Avro/Protobuf if platform supports schema registry,
- stable event envelope,
- idempotency key,
- correlation id.

Example event envelope:

```json
{
  "eventId": "hist-...",
  "schemaVersion": 1,
  "source": "camunda7",
  "engineName": "default",
  "processDefinitionKey": "case-review",
  "processInstanceId": "...",
  "businessKey": "CASE-2026-0001",
  "eventType": "activity-end",
  "activityId": "reviewTask",
  "occurredAt": "2026-06-20T12:00:00Z"
}
```

---

## 25. Production-Ready Extension Architecture

A mature extension architecture looks like this:

```text
camunda-platform-extension-core
  pure logic
  policies
  event mapping
  DTOs
  no Camunda internals if possible

camunda-platform-extension-engine
  ProcessEnginePlugin
  parse listeners
  history handler wrapper
  incident exporter adapter
  internal API isolated here

camunda-platform-extension-springboot
  Spring Boot auto/config
  beans
  properties
  metrics integration

camunda-platform-extension-tests
  engine bootstrap tests
  deployment tests
  history/incident tests
  upgrade matrix tests
```

This structure prevents internal Camunda API from leaking into application code.

---

## 26. Reference Implementation Concept: Safe History Export Plugin

Goal:

```text
Export selected Camunda history events to external audit lake without slowing process execution or losing default history.
```

Architecture:

```text
Camunda History Event
  -> Composite History Handler
      -> DbHistoryEventHandler
      -> AuditOutboxHistoryHandler
            writes event envelope into AUDIT_OUTBOX table in same transaction

Audit Outbox Exporter
  -> poll unexported rows
  -> publish to Kafka/SQS/etc
  -> mark exported
  -> retry idempotently
```

Properties:

```yaml
camunda:
  platform-extension:
    history-export:
      enabled: true
      include-event-types:
        - process-instance-start
        - process-instance-end
        - activity-instance-start
        - activity-instance-end
        - task-instance-create
        - task-instance-complete
      redact-variable-values: true
      outbox-table: AUDIT_OUTBOX
```

Outbox fields:

```text
ID
EVENT_KEY
EVENT_TYPE
PROCESS_INSTANCE_ID
BUSINESS_KEY
ACTIVITY_ID
TASK_ID
PAYLOAD_JSON
STATUS
ATTEMPT
NEXT_RETRY_AT
CREATED_AT
EXPORTED_AT
LAST_ERROR
```

Idempotency:

```text
EVENT_KEY unique
```

Possible key:

```text
camunda-history:{engineName}:{historyEventId or deterministic attributes}
```

Do not rely blindly on one field unless verified per event type.

---

## 27. Reference Implementation Concept: BPMN Policy Parse Plugin

Goal:

```text
Prevent risky BPMN deployments.
```

Policies:

- process must have history TTL,
- process ID must follow naming convention,
- service task with delegate/expression must have async boundary unless allowlisted,
- user task must have assignment policy,
- external task topic must follow prefix,
- timer duration must not be unbounded ambiguous literal,
- signal event usage must be approved,
- process must not use Java serialization marker.

Deployment behavior:

```text
invalid -> deployment rejected with explicit violation list
valid -> deployment succeeds
```

Violation example:

```text
BPMN_POLICY_VIOLATION
process=case-review
activity=sendApprovalEmail
type=SERVICE_TASK_REQUIRES_ASYNC_BEFORE
message=Service task using delegateExpression must declare camunda:asyncBefore="true" or be explicitly allowlisted.
```

This gives developers feedback before production.

---

## 28. Summary Mental Model

Camunda 7 extension points are powerful because the engine was designed to be embeddable and configurable.

But power here is dangerous.

A top-level engineer treats engine extension as platform surgery, not convenience coding.

Key principles:

1. Prefer BPMN/DMN/domain API before engine internals.
2. Keep default history and incident behavior unless there is a strong reason not to.
3. Never do uncontrolled remote IO inside engine transaction/lifecycle.
4. Use outbox/exporter patterns for reliability.
5. Treat `impl.*` usage as internal API debt.
6. Validate model policy rather than silently mutating behavior.
7. Keep extension small, isolated, observable, tested, and versioned.
8. Build upgrade tests for every Camunda minor target.
9. Preserve operator visibility.
10. Preserve audit defensibility.

---

## 29. Practical Exercises

### Exercise 1 — Extension Point Selection

Given these requirements, decide the right extension point:

1. Reject deployment if process has no TTL.
2. Send task-completed event to audit lake.
3. Prevent officer from approving own submitted case.
4. Mirror failed-job incident to ticket system.
5. Bulk cancel process instances older than 2 years.
6. Add correlation id to every command log.
7. Hide sensitive NRIC/passport value from history.
8. Enforce all external task topics start with `regulatory.`.

Expected direction:

1. CI validator + parse listener.
2. Domain outbox or history outbox, depending event semantics.
3. Domain API authorization, not Camunda authorization alone.
4. Incident exporter/outbox, do not suppress default incident.
5. App-level batch using public API.
6. Minimal command interceptor or application logging, depending need.
7. Data modelling first; variable policy; avoid storing sensitive value.
8. CI validator + parse listener.

### Exercise 2 — Design a Safe History Exporter

Design:

- event envelope,
- outbox table,
- retry policy,
- idempotency key,
- redaction policy,
- monitoring dashboard,
- failure behavior.

### Exercise 3 — Upgrade Readiness

Pick one custom extension and write:

```text
- internal APIs used
- Camunda versions tested
- tests that prove behavior
- rollback plan
- disable flag
- owner
```

---

## 30. Closing

This part introduced the dangerous but powerful area of Camunda 7 engine extension.

The main lesson:

> Extension points should enforce platform invariants and integrate operational/audit concerns. They should not become hidden business logic, remote IO shortcuts, or uncontrolled internal API hacks.

In the next part, we move from extension internals to deployment reality: **how Camunda 7 should be deployed across monolith, modular monolith, microservices, remote engine, Kubernetes, and clustered database-backed topologies**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-030.md">⬅️ Part 030 — Advanced Patterns and Anti-Patterns: Saga, Process Manager, Orchestration, Choreography, and Workflow Smells</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-032.md">Part 032 — Deployment Topologies: Monolith, Modular Monolith, Microservices, Remote Engine, Kubernetes, and Clustering ➡️</a>
</div>
