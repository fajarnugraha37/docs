# learn-java-camunda-7-bpm-platform-engineering-part-019.md

# Part 019 — Multi-Tenancy, Engine Partitioning, Authorization Boundary, dan Shared Platform Design

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `019`  
> Topik: Multi-tenancy, tenant identifier, one engine per tenant, shared definitions, isolation, authorization boundary, platform topology, dan desain shared workflow platform  
> Target pembaca: Java engineer / tech lead / platform engineer yang perlu mengoperasikan Camunda 7 sebagai workflow platform enterprise, bukan sekadar embedded BPMN runtime.

---

## 0. Posisi Materi Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- runtime dan execution tree,
- transaction boundary,
- async continuation,
- job executor,
- database schema,
- optimistic locking,
- variable system,
- delegation dan extension point,
- external task,
- service invocation,
- message correlation,
- timers,
- human task,
- history/audit,
- incident/error/recovery,
- process versioning dan migration.

Sekarang kita masuk ke problem yang lebih tinggi: **bagaimana satu platform Camunda 7 melayani lebih dari satu organisasi, agency, business unit, product line, tenant, atau regulatory domain tanpa membuat data, deployment, job execution, audit, dan security saling bocor.**

Camunda 7 menyediakan fitur multi-tenancy, tetapi fitur tersebut bukan jawaban lengkap untuk semua kebutuhan isolasi. Di level engineering senior/principal, pertanyaan sebenarnya bukan:

> “Bagaimana cara menambahkan `tenantId`?”

Melainkan:

> “Boundary apa yang benar-benar harus diisolasi, siapa yang boleh melihat/menjalankan apa, bagaimana deployment/versioning bekerja per tenant, bagaimana job executor dan database behave, dan apa risiko jika tenant check dianggap sebagai security boundary absolut?”

Bagian ini akan membangun mental model tersebut.

---

## 1. Core Mental Model

### 1.1 Multi-tenancy bukan satu fitur; ia adalah desain boundary

Dalam sistem enterprise, “tenant” bisa berarti banyak hal:

| Istilah | Contoh | Implikasi |
|---|---|---|
| Customer tenant | SaaS customer A, B, C | isolasi data dan konfigurasi kuat |
| Agency tenant | Agency pemerintah A, B | isolasi regulatory, audit, ownership |
| Business unit tenant | Division finance, compliance, sales | isolasi operasional moderat |
| Product tenant | Product line A, B | bisa berbagi data/identity tertentu |
| Jurisdiction tenant | Negara/provinsi/regulator | aturan, retention, dan audit berbeda |
| Environment pseudo-tenant | dev/uat/prod | **bukan** tenant; harus dipisah secara environment |

Camunda 7 memaknai tenant secara lebih spesifik: **tenant identifier yang ditempelkan pada data engine tertentu**, seperti deployment, process definition, process instance, task, decision, dan lain-lain. Tetapi enterprise tenancy mencakup jauh lebih banyak:

- network boundary,
- database boundary,
- encryption boundary,
- identity boundary,
- authorization boundary,
- operational boundary,
- deployment boundary,
- monitoring boundary,
- incident boundary,
- audit boundary,
- data retention boundary,
- support/administrator boundary.

Jadi, `tenantId` di Camunda adalah **satu mekanisme**, bukan seluruh strategi.

---

### 1.2 Camunda 7 menyediakan dua pola utama multi-tenancy

Secara besar, ada dua pendekatan:

```text
Model A — Single Process Engine + Tenant Identifiers

  one engine
  one database/schema/table set
  rows tagged with TENANT_ID_

  + simpler maintenance
  + scalable for many small tenants
  - weaker physical isolation
  - query/API exposure risk if not wrapped properly
  - noisy neighbor risk
```

```text
Model B — One Process Engine Per Tenant

  engine tenant-A -> datasource/schema/table-prefix A
  engine tenant-B -> datasource/schema/table-prefix B
  engine tenant-C -> datasource/schema/table-prefix C

  + stronger isolation
  + tenant-specific configuration possible
  - more operational overhead
  - more memory/config complexity
  - harder upgrade/deployment management
```

Ada juga model hybrid:

```text
Hybrid

  engine group 1: shared small tenants
  engine group 2: high-risk/high-volume tenant A
  engine group 3: high-risk/high-volume tenant B
```

Model hybrid sering paling realistis untuk enterprise/regulatory systems.

---

### 1.3 Tenant isolation punya beberapa level

Jangan hanya bertanya “multi-tenant atau tidak?”. Lebih tepat gunakan skala isolasi:

| Level | Boundary | Contoh |
|---|---|---|
| L0 | No tenant isolation | semua user/process satu domain |
| L1 | Logical row isolation | single engine, `TENANT_ID_` |
| L2 | Logical + application authorization | row isolation + gateway/service layer |
| L3 | Schema/table isolation | engine/schema per tenant |
| L4 | Database isolation | DB per tenant |
| L5 | Runtime isolation | app/process engine per tenant |
| L6 | Infrastructure isolation | cluster/VPC/account per tenant |

Camunda 7 tenant identifier kira-kira ada di L1. Enterprise secure platform minimal biasanya butuh L2. Regulated/high-risk tenant bisa butuh L3–L6.

---

## 2. Apa yang Sebenarnya Diisolasi oleh Camunda Tenant Identifier?

Dalam model single engine with tenant identifiers, data tenant disimpan dalam tabel yang sama, lalu engine menyimpan tenant id pada kolom tenant-related.

Secara konseptual:

```text
ACT_RE_PROCDEF
  ID_          KEY_       VERSION_  TENANT_ID_
  procA:1      review     1         agency-a
  procA:1      review     1         agency-b
  procShared   review     1         null

ACT_RU_EXECUTION
  ID_          PROC_INST_ID_  PROC_DEF_ID_  TENANT_ID_
  exec-001     pi-001         review:a:1    agency-a
  exec-002     pi-002         review:b:1    agency-b

ACT_RU_TASK
  ID_          EXECUTION_ID_  NAME_         TENANT_ID_
  task-001     exec-001       Review Case   agency-a
  task-002     exec-002       Review Case   agency-b
```

Tenant id biasanya dipropagate dari deployment/definition ke instance/task/runtime data. Jika definition tidak punya tenant id, maka ia adalah **shared definition**. Shared definition bisa diakses banyak tenant, tetapi instance yang dibuat dari shared definition perlu strategi untuk menetapkan tenant id pada instance.

---

## 3. Single Process Engine with Tenant Identifiers

### 3.1 Kapan model ini cocok?

Model single engine + tenant identifiers cocok jika:

- tenant banyak tetapi relatif kecil,
- proses antar tenant mirip,
- operational team ingin satu engine/cluster saja,
- database isolation fisik tidak diwajibkan,
- tenant tidak boleh mengakses API mentah Camunda secara langsung,
- application layer dapat enforce authorization dengan benar,
- SLA/noisy-neighbor risk masih bisa dikendalikan.

Contoh:

```text
Satu platform workflow internal untuk beberapa department:

- tenant = finance
- tenant = licensing
- tenant = inspection
- tenant = enforcement

Semua memakai engine dan DB yang sama, tetapi task/query/process instance dibatasi berdasarkan tenant.
```

---

### 3.2 Deployment tenant-specific

Jika setiap tenant punya process definition sendiri:

```java
repositoryService
    .createDeployment()
    .tenantId("agency-a")
    .addClasspathResource("processes/case-review.bpmn")
    .deploy();
```

Untuk tenant lain:

```java
repositoryService
    .createDeployment()
    .tenantId("agency-b")
    .addClasspathResource("processes/case-review.bpmn")
    .deploy();
```

Walaupun BPMN file sama, versioning-nya berjalan independen per tenant.

```text
agency-a: case-review version 1
agency-b: case-review version 1
agency-a deploy lagi -> agency-a version 2
agency-b tetap version 1
```

Ini penting untuk release management.

Jika tenant A upgrade lebih dulu, tenant B tidak otomatis ikut.

---

### 3.3 Start process instance per tenant

Jika key process sama di beberapa tenant, command bisa ambigu:

```java
runtimeService.startProcessInstanceByKey("case-review");
```

Masalah:

```text
Ada:
- case-review tenant agency-a
- case-review tenant agency-b

Start by key tanpa tenant id: engine tidak tahu definition mana yang dimaksud.
```

Gunakan builder:

```java
runtimeService
    .createProcessInstanceByKey("case-review")
    .processDefinitionTenantId("agency-a")
    .businessKey("CASE-2026-0001")
    .setVariables(Map.of(
        "caseId", "CASE-2026-0001",
        "submittedBy", "user-123"
    ))
    .execute();
```

Mental model:

```text
processDefinitionTenantId -> pilih definition tenant-specific
businessKey               -> anchor business instance
variables                 -> initial routing facts
```

Jangan mencampur ketiganya.

---

### 3.4 Query tenant-specific data

Contoh query deployment:

```java
List<Deployment> deployments = repositoryService
    .createDeploymentQuery()
    .tenantIdIn("agency-a")
    .list();
```

Contoh query process definition:

```java
List<ProcessDefinition> defs = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("case-review")
    .tenantIdIn("agency-a")
    .list();
```

Contoh query task:

```java
List<Task> tasks = taskService
    .createTaskQuery()
    .tenantIdIn("agency-a")
    .taskCandidateGroup("reviewer")
    .active()
    .orderByTaskCreateTime()
    .desc()
    .listPage(0, 50);
```

Rule penting:

> Query harus selalu punya tenant boundary kecuali query tersebut memang dijalankan oleh operator/platform administrator lintas tenant.

---

## 4. Transparent Tenant Checks

Camunda dapat memakai current authentication untuk membatasi API calls berdasarkan tenant ids.

Contoh:

```java
try {
    identityService.setAuthentication(
        "mary",
        List.of("reviewer"),
        List.of("agency-a")
    );

    // API calls di dalam blok ini transparently tenant-scoped.
    List<Task> tasks = taskService.createTaskQuery().list();
}
finally {
    identityService.clearAuthentication();
}
```

Secara mental:

```text
current authentication thread-local
  userId    = mary
  groups    = reviewer
  tenants   = agency-a

engine query/command
  + tenant check
  -> hanya data tenant agency-a yang visible/accessible
```

---

### 4.1 Transparent tenant check bukan pengganti authorization layer

Ini poin kritikal.

Tenant check membantu memfilter data tenant. Tetapi ia bukan pengganti:

- business authorization,
- case ownership check,
- role-based action policy,
- four-eyes principle,
- conflict-of-interest rule,
- organization hierarchy rule,
- sensitive-case restriction,
- dynamic delegation/acting officer rule.

Contoh:

```text
Mary berada di tenant agency-a.
Mary dapat melihat task agency-a.

Tetapi apakah Mary boleh menyetujui case tertentu?
Belum tentu.

Mungkin:
- case tersebut assigned ke officer lain,
- Mary pernah menjadi applicant representative,
- case butuh senior reviewer,
- case high-risk dan butuh panel,
- Mary adalah creator dan tidak boleh approve sendiri.
```

Tenant check menjawab:

> “Apakah ini tenant yang sama?”

Business authorization menjawab:

> “Apakah user ini boleh melakukan aksi ini terhadap business object ini pada state ini dengan context ini?”

Keduanya berbeda.

---

### 4.2 Jangan expose Camunda REST API mentah ke tenant

Camunda documentation sendiri memberi peringatan bahwa transparent tenant separation tidak diimplementasikan untuk semua API, dan deployment API misalnya dapat membuat tenant deploy untuk tenant lain jika endpoint diekspos tanpa custom access checking.

Prinsip desain enterprise:

```text
Browser / External Client
        |
        v
Application API / Workflow Gateway
        |
        | enforce authN, authZ, tenant, case policy, input validation
        v
Camunda Java API / Camunda REST internal
        |
        v
Process Engine
```

Hindari:

```text
Browser / Tenant Client
        |
        v
Camunda REST API directly
```

Kecuali Anda benar-benar memahami dan mengaktifkan authorization/tenant checks/resource permissions secara ketat, pattern tersebut terlalu berisiko.

---

### 4.3 Thread-local authentication discipline

`identityService.setAuthentication(...)` bersifat context untuk current thread. Maka pattern yang aman:

```java
public <T> T withCamundaAuthentication(
    String userId,
    List<String> groupIds,
    List<String> tenantIds,
    Supplier<T> action
) {
    try {
        identityService.setAuthentication(userId, groupIds, tenantIds);
        return action.get();
    }
    finally {
        identityService.clearAuthentication();
    }
}
```

Anti-pattern:

```java
identityService.setAuthentication(userId, groups, tenants);
// do work
// lupa clearAuthentication()
```

Jika authentication tidak dibersihkan, request/thread berikutnya di thread pool bisa mewarisi context yang salah. Dalam web server, ini adalah potensi kebocoran tenant/security.

---

## 5. Shared Definitions

### 5.1 Kenapa shared definitions dibutuhkan?

Jika ada 500 tenant dan prosesnya sama, deploy BPMN yang sama 500 kali bisa berat:

```text
case-review tenant-001 version 1
case-review tenant-002 version 1
...
case-review tenant-500 version 1
```

Masalah:

- banyak deployment artifact,
- banyak process definition rows,
- versioning lebih rumit,
- migration lebih banyak,
- deployment cache lebih berat,
- per-tenant release tracking lebih kompleks.

Shared definition pattern:

```text
case-review tenant null version 1

Tenant-specific instance:
- pi-001 tenant agency-a
- pi-002 tenant agency-b
```

Definition-nya shared, instance-nya tetap tenant-specific.

---

### 5.2 Deploy shared definition

Deploy tanpa tenant id:

```java
repositoryService
    .createDeployment()
    .addClasspathResource("processes/case-review.bpmn")
    .deploy();
```

Definition tenant id = `null`.

Query yang perlu include shared definitions:

```java
List<ProcessDefinition> available = repositoryService
    .createProcessDefinitionQuery()
    .tenantIdIn("agency-a")
    .includeProcessDefinitionsWithoutTenantId()
    .list();
```

---

### 5.3 Problem: tenant id tidak otomatis dipropagate dari shared definition

Jika process definition tidak punya tenant id, instance yang dibuat dari definition tersebut tidak otomatis punya tenant id berdasarkan definition.

Karena itu, Anda membutuhkan `TenantIdProvider` atau aplikasi harus memastikan tenant assignment ketika instance dibuat.

Contoh conceptual provider:

```java
public final class AuthenticationBasedTenantIdProvider implements TenantIdProvider {

    @Override
    public String provideTenantIdForProcessInstance(
            TenantIdProviderProcessInstanceContext ctx) {
        return requireSingleTenantFromAuthentication();
    }

    @Override
    public String provideTenantIdForCaseInstance(
            TenantIdProviderCaseInstanceContext ctx) {
        return requireSingleTenantFromAuthentication();
    }

    @Override
    public String provideTenantIdForHistoricDecisionInstance(
            TenantIdProviderHistoricDecisionInstanceContext ctx) {
        return requireSingleTenantFromAuthentication();
    }

    private String requireSingleTenantFromAuthentication() {
        IdentityService identityService =
            Context.getProcessEngineConfiguration().getIdentityService();

        Authentication auth = identityService.getCurrentAuthentication();
        if (auth == null) {
            throw new IllegalStateException("No Camunda authentication in context");
        }

        List<String> tenantIds = auth.getTenantIds();
        if (tenantIds.size() != 1) {
            throw new IllegalStateException(
                "Expected exactly one tenant, got " + tenantIds
            );
        }

        return tenantIds.get(0);
    }
}
```

Kenapa harus strict?

Karena jika user punya lebih dari satu tenant, engine tidak bisa menebak tenant mana yang dimaksud untuk instance baru. Multi-tenant user harus memilih tenant eksplisit di application layer.

---

### 5.4 Shared definition + tenant-specific variation

Sering realitasnya tidak hitam-putih:

```text
80% proses sama semua tenant
20% behavior tenant-specific
```

Pattern yang bagus:

```text
Main shared process
  -> common intake
  -> common validation
  -> call activity: tenant-specific review sub-process
  -> common finalization
```

Diagram:

```text
[Shared Main Process: tenant null]

Start
  |
  v
Common Intake
  |
  v
Common Eligibility Check
  |
  v
Call Activity: tenant-specific-review
  |   calledElementTenantId = current tenant id
  v
Common Closure
  |
  v
End
```

Tenant-specific sub-process:

```text
agency-a: tenant-specific-review v3
agency-b: tenant-specific-review v1
agency-c: tenant-specific-review v7
```

Keuntungan:

- common logic tidak diduplikasi,
- tenant variation tetap explicit,
- migration lebih kecil,
- audit lebih jelas,
- release blast radius lebih terkendali.

---

## 6. One Process Engine Per Tenant

### 6.1 Kapan model ini cocok?

Gunakan one engine per tenant jika:

- tenant memerlukan isolasi DB/schema kuat,
- tenant memiliki proses/extension/plugin/config berbeda,
- regulatory atau contract mewajibkan physical/logical isolation kuat,
- tenant volume besar dan noisy-neighbor risk tinggi,
- tenant butuh upgrade window berbeda,
- operator tenant-specific cukup kuat untuk membenarkan overhead.

Contoh:

```text
Agency A punya high-volume enforcement workflow.
Agency B punya sensitive investigation workflow.
Agency C punya low-volume licensing workflow.

A dan B dipisah engine/schema.
C berbagi engine dengan tenant kecil lain.
```

---

### 6.2 Bentuk isolasi database

One engine per tenant bisa berarti:

```text
Option 1 — Different databases
engine-a -> jdbc:postgresql://db-a/camunda
engine-b -> jdbc:postgresql://db-b/camunda

Option 2 — Same database, different schemas
engine-a -> jdbc:postgresql://db/camunda schema agency_a
engine-b -> jdbc:postgresql://db/camunda schema agency_b

Option 3 — Same schema, different table prefix
engine-a -> ACT_A_*
engine-b -> ACT_B_*
```

Urutan isolasi dari kuat ke lemah:

```text
different infrastructure/database > different schema > table prefix > tenant id column
```

Tetapi operational cost juga naik.

---

### 6.3 Multi-engine cost model

Jangan naif menganggap “engine itu murah”. Setiap process engine membawa:

- engine configuration,
- deployment cache,
- MyBatis mappings/session factory,
- job executor relationship,
- command infrastructure,
- metrics/config,
- datasource/transaction integration,
- possible plugin state,
- deployment scanning behavior.

Jika Anda membuat ratusan engine dalam satu JVM tanpa desain, memory dan startup time bisa memburuk.

Camunda menyediakan konfigurasi seperti `useSharedSqlSessionFactory` untuk multi-engine scenario tertentu, tetapi ia punya syarat: engine harus berbagi datasource dan transaction factory. Jika tidak, caching static SQL session factory bisa menjadi risiko konfigurasi.

---

### 6.4 Job executor dengan banyak engine

Dalam one engine per tenant, job executor design harus dipikirkan:

```text
Option A: each engine has its own acquisition
  + isolation lebih jelas
  - banyak acquisition thread
  - DB load lebih tinggi

Option B: shared acquisition/thread pool
  + resource lebih manageable
  - scheduling/fairness perlu dipantau
```

Risiko:

- tenant besar memenuhi thread pool,
- tenant kecil mengalami delay,
- maintenance tenant A mempengaruhi tenant B jika resource shared,
- incident flood dari satu tenant mengganggu observability tenant lain.

Untuk high-value tenant, pertimbangkan:

- dedicated engine,
- dedicated job executor/thread pool,
- dedicated DB pool,
- dedicated deployment pipeline,
- dedicated monitoring dashboard,
- dedicated alert threshold.

---

## 7. Authorization Boundary vs Tenant Boundary

### 7.1 Authorization Camunda: resource permission model

Camunda Authorization Service mengatur permission pada resources seperti:

- application,
- process definition,
- process instance,
- task,
- deployment,
- group,
- user,
- tenant,
- decision definition,
- batch,
- historic task/process depending on APIs/config.

Permission umum:

- `READ`,
- `UPDATE`,
- `CREATE`,
- `DELETE`,
- `ACCESS`,
- `ALL`,
- dan permission khusus resource tertentu.

Ini berguna jika untrusted users dapat mengakses Camunda REST/webapp/API.

Tetapi authorization engine punya cost dan complexity. Jika aplikasi Anda sepenuhnya mengontrol semua Camunda API calls, authorization Camunda bisa tidak perlu untuk end-user flow, tetapi tetap bisa berguna untuk admin/operator tools.

---

### 7.2 Tiga lapis security yang sebaiknya dipisah

```text
Layer 1 — Authentication
  Siapa user/service ini?

Layer 2 — Tenant boundary
  Tenant apa yang boleh ia akses?

Layer 3 — Business authorization
  Aksi apa yang boleh ia lakukan terhadap case/task/resource ini?
```

Contoh service method:

```java
public CompleteTaskResult completeReviewTask(
    AuthenticatedPrincipal principal,
    String tenantId,
    String taskId,
    ReviewDecisionCommand command
) {
    // 1. tenant membership
    tenantAccessPolicy.requireTenant(principal, tenantId);

    // 2. fetch task with tenant boundary
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .tenantIdIn(tenantId)
        .singleResult();

    if (task == null) {
        throw new NotFoundException("Task not found");
    }

    // 3. domain object / case authorization
    CaseRecord caseRecord = caseRepository.findByTaskId(taskId)
        .orElseThrow(() -> new IllegalStateException("Task not linked to case"));

    caseAuthorizationPolicy.requireCanReview(principal, caseRecord, command);

    // 4. business validation
    reviewPolicy.validateDecision(caseRecord, command);

    // 5. Camunda auth context
    return camundaAuthentication.with(principal, tenantId, () -> {
        taskService.complete(taskId, Map.of(
            "reviewDecision", command.decision(),
            "reviewDecisionId", command.decisionId()
        ));
        return new CompleteTaskResult(taskId, caseRecord.id());
    });
}
```

Poin penting:

> Tenant filter di Camunda query tidak menggantikan domain authorization.

---

### 7.3 System-to-system calls

Tidak semua command dijalankan oleh human user. Ada juga service account:

```text
- event ingestion service
- scheduler
- migration tool
- cleanup tool
- reporting extractor
- admin automation
- external task worker
```

Setiap service account harus punya tenant semantics jelas.

Contoh:

| Service | Tenant scope | Risk |
|---|---|---|
| Inbound webhook service | per event tenant | salah map event ke tenant |
| External task worker | one/many topics across tenants | worker complete task tenant salah |
| Migration tool | cross-tenant admin | blast radius besar |
| Reporting extractor | read many tenants | data leak |
| Cleanup job | cross-tenant or per tenant | accidental deletion |

Untuk service account lintas tenant, jangan bergantung pada “admin can access all”. Buat explicit control:

```text
allowedTenants = [agency-a, agency-b]
action = history-export
approval = change-request-123
runId = batch-2026-06-20-001
```

---

## 8. Tenant-Aware Deployment Strategy

### 8.1 Deployment model menentukan blast radius

Ada tiga pola utama:

```text
A. Per-tenant deployment
  + tenant-specific versioning
  + tenant-specific rollout
  - duplication

B. Shared deployment
  + simpler common process management
  + one rollout
  - blast radius semua tenant

C. Shared main + tenant-specific subprocess/DMN
  + common core
  + controlled variation
  - design discipline required
```

---

### 8.2 Per-tenant deployment pipeline

```text
source repo
  -> build BPMN/DMN/form bundle
  -> validate model
  -> deploy tenant agency-a to UAT
  -> smoke test agency-a
  -> deploy tenant agency-a to PROD
  -> monitor
  -> repeat agency-b
```

Metadata minimal:

```yaml
deployment:
  process_key: case-review
  tenant_id: agency-a
  version_tag: 2026.06.20-r1
  git_commit: abc123
  release_ticket: CHG-2026-001
  deployed_by: cicd
  deployed_at: 2026-06-20T10:00:00Z
```

Kenapa ini penting?

Karena Camunda deployment row saja tidak cukup untuk enterprise traceability. Anda perlu release metadata eksternal yang menghubungkan:

- BPMN artifact,
- source commit,
- environment,
- tenant,
- approval ticket,
- deployment actor,
- smoke test result.

---

### 8.3 Tenant rollout ring

Untuk shared platform, gunakan rollout ring:

```text
Ring 0: internal/sandbox tenant
Ring 1: low-risk tenant
Ring 2: medium-risk tenants
Ring 3: high-volume tenants
Ring 4: regulated/high-critical tenants
```

Jika shared definition digunakan, blast radius lebih besar. Gunakan feature flag/configuration carefully:

```text
BPMN definition v10 shared
  behavior branch controlled by tenant capability/config
```

Tetapi hati-hati: terlalu banyak tenant condition di BPMN bisa membuat proses menjadi spaghetti.

Lebih baik:

```text
common BPMN
  -> tenant policy service
  -> tenant-specific call activity/DMN
```

---

## 9. Tenant-Aware Process Modelling

### 9.1 Jangan jadikan tenant sebagai gateway di mana-mana

Anti-pattern:

```text
Exclusive gateway:
  if tenant == A -> path A
  if tenant == B -> path B
  if tenant == C -> path C
  if tenant == D -> path D
  ...
```

Akibat:

- BPMN sulit dibaca,
- tenant variation tersebar,
- test matrix meledak,
- perubahan tenant A bisa merusak tenant B,
- migration menjadi sulit.

Lebih baik:

```text
Common process
  -> Determine policy
  -> Execute policy-specific sub-process / DMN / service
```

---

### 9.2 Tenant context sebagai immutable fact

Pada start process instance, simpan tenant context sebagai fact:

```java
Map<String, Object> variables = Map.of(
    "tenantId", tenantId,
    "tenantType", tenantType,
    "jurisdiction", jurisdiction,
    "policyVersion", policyVersion,
    "caseId", caseId
);
```

Tetapi jangan hanya mengandalkan variable untuk tenant security. Engine-level tenant id tetap harus benar.

Bedakan:

```text
Engine tenant id
  -> isolation/query/security concern

Variable tenantId
  -> business/routing/audit concern
```

Keduanya sebaiknya konsisten, tetapi fungsi mereka berbeda.

---

### 9.3 Tenant-specific SLA

Contoh:

```text
Agency A: initial review SLA = 5 working days
Agency B: initial review SLA = 10 calendar days
Agency C: initial review SLA = 3 working days for high-risk cases
```

Jangan hardcode di BPMN:

```xml
<timeDuration>P5D</timeDuration>
```

Lebih baik:

```text
On entering review:
  SLA service computes deadline using tenant + case type + calendar
  store reviewDueAt
  create/update executable timer if required
```

Atau gunakan expression yang membaca variable deadline:

```xml
<timeDate>${reviewDueAt}</timeDate>
```

Dengan catatan: deadline harus dihitung sebelum timer dibuat.

---

## 10. Tenant-Aware Message Correlation

Dalam multi-tenant platform, message correlation tanpa tenant id berbahaya.

Problem:

```text
Message name: paymentReceived
Business key: CASE-123

agency-a punya CASE-123
agency-b juga punya CASE-123

Tanpa tenant id -> ambiguous atau salah correlation.
```

Gunakan tenant-aware correlation:

```java
runtimeService
    .createMessageCorrelation("paymentReceived")
    .tenantId("agency-a")
    .processInstanceBusinessKey("CASE-123")
    .setVariable("paymentId", "PAY-999")
    .correlate();
```

Event ingestion layer harus resolve tenant secara deterministik:

```text
external event
  -> authenticate source
  -> validate signature
  -> resolve tenant from source/client/account/jurisdiction
  -> lookup business object scoped by tenant
  -> deduplicate event
  -> correlate message with tenant id
```

Jangan membiarkan external payload bebas menentukan tenant tanpa validasi.

---

## 11. Tenant-Aware External Task Workers

External task memiliki `tenantId` di query/fetch behavior tergantung API/client usage.

Desain worker:

```text
Option A — worker per tenant
  + isolation kuat
  + credentials scoped
  - lebih banyak deployment

Option B — worker shared multi-tenant
  + resource efficient
  - harus tenant-aware secara ketat

Option C — worker pool per tenant class
  + balance
```

Shared worker harus memperlakukan tenant sebagai bagian dari execution context:

```java
record WorkContext(
    String workerId,
    String tenantId,
    String topicName,
    String processInstanceId,
    String businessKey,
    String externalTaskId
) {}
```

Worker idempotency key sebaiknya memasukkan tenant:

```text
idempotency_key = tenantId + ':' + externalTaskId + ':' + operationName
```

Atau untuk remote business command:

```text
idempotency_key = tenantId + ':' + businessKey + ':' + commandType + ':' + commandVersion
```

Tanpa tenant prefix, collision antar tenant bisa terjadi.

---

## 12. Tenant-Aware Database and Indexing

### 12.1 Query pattern tenant-scoped

Jika mayoritas query memakai tenant filter, index perlu mendukungnya.

Contoh task inbox:

```sql
select *
from ACT_RU_TASK
where TENANT_ID_ = ?
  and ASSIGNEE_ = ?
  and SUSPENSION_STATE_ = 1
order by CREATE_TIME_ desc
fetch first 50 rows only;
```

Index candidate tergantung database/vendor/workload:

```text
(TENANT_ID_, ASSIGNEE_, SUSPENSION_STATE_, CREATE_TIME_)
```

Contoh runtime instance lookup:

```sql
select *
from ACT_RU_EXECUTION
where TENANT_ID_ = ?
  and BUSINESS_KEY_ = ?;
```

Index candidate:

```text
(TENANT_ID_, BUSINESS_KEY_)
```

Namun jangan asal menambah index. Camunda schema sudah punya index bawaan; custom index harus berdasarkan query plan dan workload produksi.

---

### 12.2 Tenant skew

Tenant skew terjadi jika satu tenant jauh lebih besar dari tenant lain.

```text
agency-a: 50 million history rows
agency-b: 100 thousand history rows
agency-c: 80 thousand history rows
```

Masalah:

- query tenant kecil tetap bisa terkena table bloat,
- cleanup batch dominated by tenant besar,
- index cardinality berubah,
- storage/cost attribution sulit,
- backup/restore per tenant sulit,
- reporting slow karena data tenant besar.

Jika skew besar, tenant identifier saja mungkin tidak cukup. Pertimbangkan:

- schema per tenant besar,
- database per tenant besar,
- archive per tenant,
- partitioning by tenant/time jika database dan support model memungkinkan,
- separate reporting pipeline.

---

### 12.3 Data retention per tenant

Regulatory retention sering berbeda:

```text
agency-a: retain 7 years
agency-b: retain 10 years
agency-c: retain 3 years after closure
```

Camunda history cleanup TTL bekerja pada definition/removal time model, tetapi business retention policy lintas tenant sering lebih kompleks.

Strategi:

```text
Camunda history TTL
  -> technical process history retention

Domain audit retention
  -> legal/business audit retention

Archive/export pipeline
  -> long-term evidence/reporting

Deletion/anonymization policy
  -> privacy/legal requirement
```

Jangan menjadikan Camunda history sebagai satu-satunya legal record jika retention policy per tenant berbeda dan sangat ketat.

---

## 13. Tenant-Aware Observability

Minimal semua log/metric/trace event harus punya tenant dimension, dengan hati-hati terhadap cardinality.

### 13.1 Logging

Structured log fields:

```json
{
  "event": "camunda.task.complete",
  "tenantId": "agency-a",
  "processDefinitionKey": "case-review",
  "processInstanceId": "...",
  "businessKey": "CASE-2026-0001",
  "taskDefinitionKey": "reviewTask",
  "taskId": "...",
  "actorUserId": "mary",
  "decision": "APPROVE"
}
```

### 13.2 Metrics

Useful dimensions:

- tenant id,
- process key,
- topic name,
- job type,
- incident type,
- environment.

Tetapi jangan semua cardinality dimasukkan ke label metrics. Hindari label seperti processInstanceId/taskId/businessKey pada Prometheus metrics.

Contoh metric:

```text
workflow_tasks_completed_total{tenant="agency-a", process="case-review", task="review"}
workflow_incidents_open{tenant="agency-a", process="case-review", type="failedJob"}
external_task_completion_seconds_bucket{tenant="agency-a", topic="send-email"}
```

### 13.3 Dashboards

Dashboard per tenant:

- open process instances,
- open user tasks,
- overdue tasks,
- failed jobs,
- incidents by process,
- external task failure rate,
- message correlation failures,
- history cleanup backlog,
- SLA breach count.

Dashboard platform-wide:

- top tenants by workload,
- DB growth by tenant,
- job executor acquisition lag,
- failed jobs by tenant,
- tenant skew,
- cleanup throughput,
- deployment version matrix.

---

## 14. Tenant-Aware Operations and Support

### 14.1 Operator roles

Dalam shared platform, bedakan:

| Role | Scope | Example Permission |
|---|---|---|
| Tenant operator | one tenant | view incidents/tasks/processes tenant sendiri |
| Platform operator | all tenants | diagnose engine/job/DB |
| Release operator | deployment | deploy/migrate definitions |
| Security admin | auth/tenant membership | manage access |
| Auditor | read-only history/audit | export timeline |
| DBA/platform SRE | DB/runtime | maintenance, cleanup |

Jangan memberi semua orang `camunda-admin` hanya karena troubleshooting lebih mudah.

---

### 14.2 Support workflow

Contoh support case:

```text
User reports: task missing for agency-a case CASE-2026-0001
```

Playbook:

1. Verify tenant and user identity.
2. Query application case table by `(tenant_id, case_id)`.
3. Query Camunda process instance by `(tenant_id, business_key)`.
4. Query active tasks for process instance.
5. Check candidate groups/assignee.
6. Check authorization membership.
7. Check history activity/task lifecycle.
8. Check incidents/jobs/event subscriptions.
9. Produce support result with tenant-safe details.

SQL diagnostic example:

```sql
select ID_, PROC_INST_ID_, BUSINESS_KEY_, TENANT_ID_, ACT_ID_, IS_ACTIVE_
from ACT_RU_EXECUTION
where TENANT_ID_ = :tenantId
  and BUSINESS_KEY_ = :businessKey;
```

Task:

```sql
select ID_, NAME_, TASK_DEF_KEY_, ASSIGNEE_, OWNER_, TENANT_ID_, CREATE_TIME_, DUE_DATE_
from ACT_RU_TASK
where TENANT_ID_ = :tenantId
  and PROC_INST_ID_ = :processInstanceId;
```

Never send cross-tenant data in support response.

---

## 15. Tenant-Aware Migration

Process instance migration dalam multi-tenant environment harus memperhatikan tenant.

### 15.1 Per-tenant migration

```text
Migrate agency-a case-review v3 -> v4
Do not migrate agency-b yet
```

Use tenant-scoped query:

```java
ProcessDefinition source = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("case-review")
    .processDefinitionTenantId("agency-a")
    .processDefinitionVersion(3)
    .singleResult();

ProcessDefinition target = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("case-review")
    .processDefinitionTenantId("agency-a")
    .processDefinitionVersion(4)
    .singleResult();

MigrationPlan plan = runtimeService
    .createMigrationPlan(source.getId(), target.getId())
    .mapEqualActivities()
    .build();

List<String> instanceIds = runtimeService
    .createProcessInstanceQuery()
    .tenantIdIn("agency-a")
    .processDefinitionId(source.getId())
    .list()
    .stream()
    .map(ProcessInstance::getId)
    .toList();

runtimeService
    .newMigration(plan)
    .processInstanceIds(instanceIds)
    .execute();
```

### 15.2 Cross-tenant migration anti-pattern

Anti-pattern:

```java
runtimeService
    .createProcessInstanceQuery()
    .processDefinitionKey("case-review")
    .list(); // all tenants
```

Lalu migrate semua. Ini bisa merusak tenant yang belum approve release.

Rule:

> Migration batch harus punya tenant scope eksplisit, release ticket, dry-run report, rollback/recovery plan, dan audit trail.

---

## 16. Tenant-Aware Incident Handling

Incident harus diprioritaskan berdasarkan tenant impact.

Contoh incident table view:

```sql
select TENANT_ID_, INCIDENT_TYPE_, count(*) as cnt
from ACT_RU_INCIDENT
where INCIDENT_STATE_ = 0
 group by TENANT_ID_, INCIDENT_TYPE_
order by cnt desc;
```

Triage dimension:

| Dimension | Question |
|---|---|
| Tenant | tenant mana terdampak? |
| Process | process key/version apa? |
| Business criticality | apakah case enforcement/high-risk? |
| Retryability | technical transient atau deterministic failure? |
| Blast radius | satu instance, satu tenant, semua tenant? |
| Recent release | setelah deployment tenant tertentu? |
| Shared resource | apakah shared worker/DB/job executor terlibat? |

Jika incident muncul di shared definition setelah release, treat sebagai potential multi-tenant incident sampai terbukti hanya tenant tertentu.

---

## 17. Tenant Isolation Failure Modes

### 17.1 Missing tenant filter

```java
taskService.createTaskQuery()
    .taskCandidateGroup("reviewer")
    .list();
```

Jika transparent tenant check tidak aktif atau authentication context tidak ada, query ini bisa mengembalikan task lintas tenant.

Mitigation:

- require tenantId parameter in application service,
- use repository/service wrappers,
- static analysis/code review rule,
- integration tests with two tenants,
- fail closed if tenant missing.

---

### 17.2 Wrong tenant in message correlation

```java
runtimeService
    .createMessageCorrelation("documentUploaded")
    .processInstanceBusinessKey("CASE-001")
    .correlate();
```

Jika business key tidak globally unique, ini ambiguous.

Mitigation:

```java
runtimeService
    .createMessageCorrelation("documentUploaded")
    .tenantId(tenantId)
    .processInstanceBusinessKey(caseId)
    .correlate();
```

Plus inbox deduplication.

---

### 17.3 Shared worker completes wrong task semantics

Worker mengambil task tenant A tetapi memanggil downstream service tenant B karena config resolution salah.

Mitigation:

```text
external task tenant id
  -> resolve tenant config
  -> validate downstream account belongs to same tenant
  -> include tenant in idempotency key
  -> log tenant context
```

---

### 17.4 Admin accidentally operates all tenants

Contoh:

```java
managementService.createJobQuery().withRetriesLeft().list()
```

atau batch set retries semua tenant.

Mitigation:

- admin tool requires tenant selection,
- explicit “all tenants” confirmation,
- dry-run count grouped by tenant,
- approval for cross-tenant operation,
- audit every admin action.

---

### 17.5 Shared definition blast radius

Satu BPMN shared deploy bug mempengaruhi semua tenant.

Mitigation:

- canary tenant,
- rollout ring,
- version tag,
- smoke test per tenant profile,
- feature flag cautiously,
- migration plan only after validation,
- support rollback by starting new instances on old version if needed.

---

## 18. Platform Architecture Patterns

### 18.1 Embedded engine per application module

```text
Case Management App
  -> embedded Camunda engine
  -> app DB / Camunda schema
```

Good:

- simple for one domain,
- application controls all API calls,
- auth/business policy easier,
- no direct public Camunda API.

Bad:

- hard to share platform across domains,
- scaling tied to app,
- multi-tenant ops must be built inside app.

---

### 18.2 Central workflow platform service

```text
Business apps
  -> Workflow Gateway API
  -> Camunda engine cluster
  -> Camunda DB
```

Good:

- reusable platform,
- central observability,
- consistent workflow ops,
- shared worker fleet.

Bad:

- gateway must be very well-designed,
- process ownership can become unclear,
- tenant authorization mistakes have bigger blast radius,
- deployment governance more complex.

---

### 18.3 Engine per bounded context

```text
Licensing engine
Enforcement engine
Inspection engine
Appeal engine
```

Good:

- domain boundary clearer,
- isolation better,
- smaller blast radius,
- tenant model can differ per domain.

Bad:

- more infrastructure,
- cross-process visibility harder,
- shared tasklist/reporting needs aggregation.

This is often better than one mega-engine for all enterprise workflows.

---

### 18.4 Hybrid regulatory platform

```text
Workflow Platform

  shared core engine:
    - low/medium tenants
    - common workflows

  dedicated engine agency-high-risk:
    - high volume
    - stricter audit
    - own DB/schema

  dedicated engine investigation:
    - sensitive data
    - restricted operators
```

This model maps well to real-world regulatory systems.

---

## 19. Design Decision Framework

Gunakan pertanyaan berikut untuk memilih tenancy model.

### 19.1 Isolation requirement

```text
Apakah tenant boleh berada di database/schema/table yang sama?
Apakah contract/regulation melarang shared database?
Apakah backup/restore harus bisa per tenant?
Apakah tenant admin boleh melihat operational metadata tenant lain?
```

Jika jawabannya strict, single engine tenant-id mungkin tidak cukup.

### 19.2 Volume and skew

```text
Berapa process instances per tenant per hari?
Berapa open tasks?
Berapa history rows per tahun?
Berapa external task throughput?
Apakah satu tenant bisa mendominasi workload?
```

Jika skew tinggi, pertimbangkan partition/dedicated engine.

### 19.3 Variation

```text
Apakah proses sama semua tenant?
Apakah variasi hanya SLA/assignment/rules?
Apakah variasi mengubah flow besar?
Apakah tenant perlu release window berbeda?
```

Jika variasi kecil, shared definition + policy service/DMN cukup. Jika variasi besar, tenant-specific deployment/subprocess lebih aman.

### 19.4 Operational model

```text
Siapa deploy BPMN?
Siapa handle incident?
Siapa boleh migrate instance?
Siapa boleh modify process instance?
Apakah tenant punya operator sendiri?
```

Jika tenant operator berbeda, authorization and admin tooling harus tenant-aware.

---

## 20. Recommended Reference Architecture

Untuk enterprise/regulatory system, baseline yang aman:

```text
[Frontend]
   |
   v
[Application API / Workflow Gateway]
   - authenticate user/service
   - resolve tenant
   - enforce tenant membership
   - enforce business authorization
   - validate command
   - set Camunda authentication
   - call Camunda API
   - write domain audit
   |
   v
[Camunda Engine]
   - tenant id on definitions/instances/tasks
   - tenant checks enabled
   - authorization enabled if direct API/webapp exposed
   - job executor tuned
   |
   v
[Camunda DB]
   - indexes support tenant query patterns
   - history cleanup configured
   - backups/archival strategy

[Workers]
   - tenant-aware topic handling
   - idempotency by tenant
   - bounded concurrency
   - per-tenant config resolution

[Observability]
   - tenant dimensions
   - dashboards per tenant and platform-wide
   - audit/reporting pipeline
```

Key rule:

> Camunda tenant id protects engine data visibility. The application/platform layer protects business correctness.

---

## 21. Java 8–25 Considerations

Camunda 7 estate often spans old and new Java versions.

### 21.1 Java 8 legacy

Common in older Camunda 7 deployments.

Considerations:

- no `record`, `var`, modern switch,
- weaker TLS/default crypto posture unless patched,
- old Spring Boot generations,
- old app servers,
- more risk with old dependencies,
- code examples must be adapted.

Java 8 style DTO:

```java
public final class TenantContext {
    private final String tenantId;
    private final String userId;
    private final List<String> groups;

    public TenantContext(String tenantId, String userId, List<String> groups) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.userId = Objects.requireNonNull(userId);
        this.groups = Collections.unmodifiableList(new ArrayList<>(groups));
    }

    public String getTenantId() { return tenantId; }
    public String getUserId() { return userId; }
    public List<String> getGroups() { return groups; }
}
```

### 21.2 Java 17/21 modern style

```java
public record TenantContext(
    String tenantId,
    String userId,
    List<String> groups
) {
    public TenantContext {
        Objects.requireNonNull(tenantId);
        Objects.requireNonNull(userId);
        groups = List.copyOf(groups);
    }
}
```

### 21.3 Java 25 planning caveat

Java 25 can be a target for surrounding applications, workers, or platform services, but Camunda 7 compatibility must follow the actual Camunda version support matrix. Do not assume “Java supports it” means “Camunda 7 runtime supports it”.

Recommended approach:

```text
Camunda engine runtime:
  use supported Java version from Camunda support matrix

External task workers / gateway services:
  can move faster if decoupled by REST/topic contract

Domain services:
  can use newer Java if not embedded inside Camunda runtime
```

This is one reason external task architecture is useful for legacy modernization.

---

## 22. Production Checklist

### 22.1 Tenancy model

- [ ] Tenant meaning is explicitly defined.
- [ ] Tenant id format and whitelist are defined.
- [ ] Single engine vs engine per tenant decision is documented.
- [ ] Shared definition vs tenant-specific definition strategy is documented.
- [ ] Tenant-specific variation strategy is documented.

### 22.2 Security

- [ ] Tenant membership resolved from trusted identity/source.
- [ ] Camunda tenant checks enabled unless intentionally disabled.
- [ ] `setAuthentication`/`clearAuthentication` wrapper exists.
- [ ] Camunda REST is not directly exposed to untrusted tenants, or authorization is fully configured.
- [ ] Business authorization is implemented outside Camunda tenant checks.
- [ ] Admin cross-tenant actions require explicit approval/audit.

### 22.3 Deployment

- [ ] Deployment metadata includes tenant id, version tag, git commit, release ticket.
- [ ] Rollout ring exists for shared definitions.
- [ ] Migration batch is tenant-scoped.
- [ ] Call activity/DMN tenant binding is tested.

### 22.4 Operations

- [ ] Dashboards show per-tenant workload and incident counts.
- [ ] Logs include tenant id where safe.
- [ ] Workers include tenant in idempotency keys.
- [ ] DB indexes support tenant query patterns.
- [ ] Cleanup/retention policy accounts for tenant differences.

### 22.5 Testing

- [ ] Integration tests include at least two tenants.
- [ ] Tests verify missing tenant filter does not leak data.
- [ ] Tests verify message correlation with duplicate business key across tenants.
- [ ] Tests verify shared definition assigns tenant id correctly.
- [ ] Tests verify user in tenant A cannot complete tenant B task.

---

## 23. Anti-Pattern Catalog

### Anti-pattern 1 — “Tenant id as normal variable only”

```text
Process variable tenantId = agency-a
Engine TENANT_ID_ = null
```

Problem:

- engine queries not tenant-scoped,
- Cockpit/Tasklist visibility wrong,
- tenant checks not effective,
- incident/reporting ambiguous.

Fix:

- set engine tenant id via deployment/start/TenantIdProvider.

---

### Anti-pattern 2 — “Expose Camunda REST directly to browser”

Problem:

- users can craft arbitrary queries/commands,
- authorization config becomes hard,
- deployment/admin endpoints dangerous,
- business policy bypassed.

Fix:

- use workflow gateway/application API.

---

### Anti-pattern 3 — “Everything shared definition”

Problem:

- one bug hits all tenants,
- variation hidden in expressions,
- tenant-specific tests ignored,
- release window impossible.

Fix:

- shared core + tenant-specific subprocess/DMN/policy service.

---

### Anti-pattern 4 — “One engine per tenant for hundreds of tenants without cost model”

Problem:

- memory overhead,
- startup overhead,
- config sprawl,
- job executor complexity,
- upgrade pain.

Fix:

- group small tenants; dedicate only high-risk/high-volume tenants.

---

### Anti-pattern 5 — “Admin actions default all tenants”

Problem:

- accidental cross-tenant migration/retry/delete,
- huge blast radius.

Fix:

- tenant must be explicit; all-tenants operation requires special approval.

---

## 24. Regulatory Case Management Example

Scenario:

```text
Platform: enforcement lifecycle management
Tenants: agency-a, agency-b, agency-c
Process: enforcement-case
Case states:
  Intake -> Screening -> Investigation -> Legal Review -> Decision -> Appeal/Closure
```

### 24.1 Tenant model

```text
agency-a:
  high volume
  strict SLA
  dedicated engine/schema

agency-b:
  medium volume
  common workflow
  shared engine with tenant id

agency-c:
  low volume
  shared engine with tenant id
```

### 24.2 Process modelling

```text
Shared main enforcement process:
  Intake
  Screening
  Call Activity: tenant-specific investigation policy
  Common legal review
  Decision
  Closure
```

Tenant-specific:

```text
agency-a investigation policy:
  field inspection mandatory
  supervisor review if risk score > 80

agency-b investigation policy:
  document review first
  field inspection optional

agency-c investigation policy:
  simplified path
```

### 24.3 Security

```text
Tenant check:
  agency-a officer sees only agency-a process/task data

Business authorization:
  officer can review only assigned case
  supervisor can approve only if not original reviewer
  legal officer can access legal review stage only
  investigator cannot decide own investigation outcome
```

### 24.4 Audit

Camunda history records process/task lifecycle.

Domain audit records:

- case state transition,
- legal basis,
- evidence references,
- actor role,
- decision reason,
- tenant policy version,
- approval chain.

Do not rely on Camunda history alone for defensible regulatory audit.

---

## 25. Summary

Camunda 7 multi-tenancy is powerful, but it is easy to misunderstand.

Core conclusions:

1. Multi-tenancy is a platform design problem, not only a `tenantId` feature.
2. Camunda 7 supports single engine with tenant identifiers and one engine per tenant.
3. Tenant identifier gives logical row-level separation, not physical isolation.
4. Transparent tenant checks help, but not all APIs are safe to expose directly to tenants.
5. Business authorization must live above Camunda tenant checks.
6. Shared definitions reduce deployment duplication but increase blast radius.
7. `TenantIdProvider` is important when shared definitions need tenant-specific instances.
8. Message correlation, external task workers, migration, history cleanup, and admin operations must all be tenant-aware.
9. For regulatory systems, tenant isolation must include audit, operations, incident, retention, and support boundaries.
10. Top-level architecture should be chosen by isolation requirement, volume skew, variation, and operational model.

The practical mental model:

```text
Camunda tenant id:
  protects workflow engine data scoping

Application authorization:
  protects business action correctness

Database/topology isolation:
  protects blast radius and compliance boundary

Operational governance:
  protects humans from unsafe cross-tenant actions
```

A top 1% engineer does not ask only:

> “Can Camunda support multi-tenancy?”

They ask:

> “What isolation guarantee do we need, where is it enforced, how can it fail, how do we prove it, and how do we operate it safely for years?”

---

## 26. References

- Camunda 7.24 Manual — Multi-Tenancy: https://docs.camunda.org/manual/7.24/user-guide/process-engine/multi-tenancy/
- Camunda 7.24 Manual — Authorization Service: https://docs.camunda.org/manual/7.24/user-guide/process-engine/authorization-service/
- Camunda 7.24 Manual — Identity Service: https://docs.camunda.org/manual/7.24/user-guide/process-engine/identity-service/
- Camunda 7.24 Manual — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda 7.24 Manual — Process Versioning: https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-versioning/
- Camunda 7.24 Manual — Process Instance Migration: https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-instance-migration/
- Camunda 7.24 Manual — External Tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda 7.24 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-018.md">⬅️ Part 018 — Process Versioning, Deployment, Migration, dan Long-Running Instance Evolution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-020.md">Part 020 — Authorization, Identity, Security Hardening, dan Webapp/API Exposure ➡️</a>
</div>
