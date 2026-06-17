# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 26 — Process Versioning, Deployment Strategy, and Change Management

> Seri: Java BPMN, Camunda, Process Orchestration Engineering  
> Level: Advanced / Top 1% Engineering Mindset  
> Fokus: process definition versioning, deployment strategy, running instance compatibility, worker compatibility, migration, rollback reality, variable schema evolution, governance, and release safety  
> Java scope: Java 8 sampai Java 25, dengan perhatian khusus ke Spring Boot, Camunda 7, Camunda 8, dan production workflow systems

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 25, kita sudah membahas:

- BPMN sebagai execution contract.
- Camunda 7 vs Camunda 8.
- Zeebe runtime internals.
- Java workers.
- idempotency.
- process variables.
- error, escalation, compensation.
- human workflow.
- DMN.
- message correlation.
- timers/SLA.
- parallelism.
- subprocess/call activity.
- saga.
- testing.
- observability.
- production operations.
- security.
- integration.
- performance and capacity.

Sekarang kita masuk ke masalah yang sering diremehkan: **bagaimana proses berubah setelah production berjalan**.

Di aplikasi CRUD biasa, deployment biasanya berarti:

```text
old code -> new code
old API -> new API
old DB schema -> migrated DB schema
```

Dalam workflow engine, deployment tidak sesederhana itu karena ada **process instance yang sedang hidup**.

```text
Process Definition v1
  ├─ Instance A: sudah sampai approval
  ├─ Instance B: menunggu dokumen
  ├─ Instance C: sedang proses payment
  └─ Instance D: sudah escalate karena SLA breach

Deploy Process Definition v2
  ├─ New instances pakai v2
  └─ Existing instances tetap bisa berada di v1, atau perlu dimigrasi
```

Workflow versioning adalah masalah gabungan dari:

1. runtime compatibility,
2. data compatibility,
3. worker compatibility,
4. human task compatibility,
5. audit compatibility,
6. operational repair,
7. business governance.

Seorang engineer biasa bertanya:

> “Kalau BPMN berubah, deploy ulang saja kan?”

Engineer top 1% bertanya:

> “Apa yang terjadi pada process instance yang sedang menunggu di node yang dihapus? Apakah worker baru masih bisa mengerjakan job dari model lama? Apakah variable lama masih valid? Apakah audit trail tetap bisa menjelaskan kenapa kasus lama mengikuti rule lama? Apakah rollback benar-benar mungkin?”

---

## 1. Mental Model Utama: Process Definition Bukan Sekadar File BPMN

Satu file BPMN yang dideploy menjadi **process definition version**.

Secara konseptual:

```text
BPMN model file
  -> deployed to engine
  -> becomes process definition
  -> each deployment creates/updates version
  -> process instance is created from a specific version
```

Dalam Camunda, sebuah process dimodelkan dengan BPMN, dideploy sebagai process definition, lalu dieksekusi sebagai process instance.

Model mentalnya:

```text
Process Model
  = source artifact manusia/developer

Process Definition
  = executable runtime artifact

Process Instance
  = one running business case based on one process definition version
```

Contoh:

```text
Process ID: license-application-review

Process Definition v1
  deployed: 2026-01-01
  rule: manual finance check

Process Definition v2
  deployed: 2026-02-15
  rule: automated finance check + manual fallback

Process Definition v3
  deployed: 2026-04-01
  rule: new agency clearance step
```

Instance yang dibuat pada 2026-01-20 mungkin masih berjalan di v1 saat v3 sudah ada.

Jadi pertanyaan penting bukan hanya:

> “Versi terbaru apa?”

Tapi:

> “Versi apa yang sedang menjalankan kasus ini?”

---

## 2. Kenapa Workflow Versioning Lebih Sulit Dari Code Versioning

Dalam aplikasi stateless API:

```text
request datang -> code baru dieksekusi -> response keluar
```

Setelah deployment, request baru biasanya memakai code baru.

Dalam workflow:

```text
process instance start hari Senin
wait user task selama 14 hari
external event datang hari Jumat minggu depan
service task jalan setelah itu
escalation timer mungkin aktif bulan depan
```

Process instance bisa hidup lebih lama dari deployment cycle.

Akibatnya:

```text
code deploy frequency: daily/weekly
process instance lifetime: days/weeks/months/years
```

Ini menciptakan beberapa masalah:

1. instance lama masih menunggu di element lama,
2. worker baru mungkin tidak kompatibel dengan job lama,
3. variable lama mungkin tidak punya field baru,
4. DMN decision lama mungkin tidak sama dengan decision baru,
5. form lama mungkin sudah tidak sesuai UI baru,
6. task assignment lama mungkin mengikuti group lama,
7. audit lama harus tetap menjelaskan rule lama,
8. migration bisa mengubah jalur proses secara business-significant.

---

## 3. Empat Jenis Versioning Dalam Workflow System

Jangan melihat versioning hanya sebagai “BPMN version”. Dalam sistem nyata, ada beberapa layer versioning.

```text
+------------------------------------------------------+
|  Business Policy Version                             |
|  contoh: eligibility rule, SLA rule, fee rule         |
+------------------------------------------------------+
|  Process Definition Version                          |
|  contoh: BPMN v1, v2, v3                              |
+------------------------------------------------------+
|  Decision/Form/Called Process Version                |
|  contoh: DMN, form, reusable approval subprocess      |
+------------------------------------------------------+
|  Application Code / Worker Version                   |
|  contoh: Spring Boot service release                  |
+------------------------------------------------------+
|  Data Contract Version                               |
|  contoh: process variable schema, command DTO         |
+------------------------------------------------------+
|  Infrastructure/Platform Version                     |
|  contoh: Camunda 8.x, Java 21, Kubernetes             |
+------------------------------------------------------+
```

Top 1% workflow engineer selalu bertanya:

> “Layer mana yang berubah?”

Karena perubahan BPMN kecil bisa aman, tetapi perubahan variable schema bisa merusak worker. Sebaliknya, BPMN tidak berubah, tetapi DMN berubah bisa mengubah keputusan bisnis secara besar.

---

## 4. Jenis Perubahan Process Model

Tidak semua perubahan BPMN sama risikonya.

### 4.1 Cosmetic Change

Contoh:

- rename label diagram,
- move shape position,
- improve documentation,
- add comments.

Jika tidak mengubah executable semantics, biasanya low risk.

Tetapi hati-hati: rename element ID berbeda dari rename label.

```text
Safe-ish:
  label: "Review Application" -> "Review Submitted Application"

Risky:
  element id: Task_Review -> Task_AssessApplication
```

Element ID sering dipakai untuk:

- migration mapping,
- metrics,
- logs,
- test assertion,
- custom audit,
- UI mapping,
- incident diagnosis.

### 4.2 Additive Change

Contoh:

- tambah optional service task setelah existing task,
- tambah non-interrupting timer reminder,
- tambah optional data enrichment,
- tambah user task untuk new cases only.

Risiko: medium.

Pertanyaan penting:

- Apakah instance lama perlu melewati step baru?
- Apakah worker lama/baru kompatibel?
- Apakah variable baru punya default?
- Apakah audit harus mencatat bahwa step baru tidak berlaku untuk kasus lama?

### 4.3 Control Flow Change

Contoh:

- ubah gateway condition,
- tambah branch baru,
- hapus branch lama,
- ubah sequence flow,
- ubah timer boundary dari non-interrupting ke interrupting.

Risiko: high.

Control flow change dapat mengubah nasib kasus.

```text
Before:
  submit -> review -> approve/reject

After:
  submit -> auto-screen -> review -> approve/reject
```

Pertanyaan:

- Haruskah kasus yang sudah di-review kembali ke auto-screen?
- Jika tidak, apakah audit bisa menjelaskan pengecualian?
- Jika ya, bagaimana mapping active token-nya?

### 4.4 Contract Change

Contoh:

- process variable rename,
- field required baru,
- enum value baru,
- payload structure berubah,
- job type berubah,
- message correlation key berubah.

Risiko: very high.

Contract change sering lebih berbahaya dari diagram change.

```json
// v1
{
  "applicationId": "APP-001",
  "riskLevel": "HIGH"
}

// v2
{
  "application": {
    "id": "APP-001"
  },
  "risk": {
    "level": "HIGH",
    "score": 87
  }
}
```

Jika worker tidak backward-compatible, job lama gagal.

### 4.5 Behavioral Change

Contoh:

- retry count berubah,
- SLA duration berubah,
- assignment rule berubah,
- DMN hit policy berubah,
- compensation strategy berubah.

Risiko: high, terutama untuk regulated process.

Perubahan behavioral mungkin tidak terlihat besar di BPMN, tetapi berdampak pada fairness, compliance, dan audit.

---

## 5. Running Instance: Prinsip Paling Penting

Ketika process definition baru dideploy, tidak otomatis berarti semua running instances pindah ke versi baru.

Mental model aman:

```text
New version affects new instances.
Existing instances remain where they are unless explicitly migrated/modified.
```

Ini justru bagus karena:

- kasus lama tidak tiba-tiba berubah jalur,
- audit tetap konsisten,
- bug fix bisa diuji sebelum migrasi massal,
- perubahan policy tidak retroaktif kecuali business memutuskan demikian.

Namun ini juga berarti:

- worker harus melayani versi lama dan baru,
- form lama mungkin masih perlu didukung,
- DMN lama mungkin masih dipakai,
- deprecated process version tidak bisa langsung dihapus,
- dashboard harus bisa membedakan versi.

---

## 6. Deployment Strategy: New Instances Only vs Migrate Existing Instances

Setiap perubahan proses harus memilih salah satu strategi utama.

### 6.1 Strategy A — New Instances Only

```text
v1 instances continue on v1
new instances start on v2
```

Cocok untuk:

- perubahan policy mulai tanggal tertentu,
- proses lama masih valid,
- perubahan terlalu risky untuk migrasi,
- jumlah instance lama kecil,
- instance lama akan selesai natural.

Kelebihan:

- risiko rendah,
- audit jelas,
- migration effort minimal,
- rollback lebih sederhana.

Kekurangan:

- worker harus support multi-version,
- operasi harus memantau beberapa versi,
- bug di v1 tetap perlu workaround,
- proses lama bisa bertahan lama.

### 6.2 Strategy B — Selective Migration

```text
some v1 instances migrate to v2
some v1 instances stay on v1
```

Cocok untuk:

- bug fix kritikal,
- regulatory change yang berlaku pada open cases tertentu,
- instance di state tertentu aman untuk migrasi,
- instance lain terlalu kompleks.

Contoh:

```text
Migrate only:
  - active at "Wait for Applicant Resubmission"
  - not yet reviewed
  - not escalated
  - applicationType = "NEW_LICENSE"
```

Kelebihan:

- targeted risk,
- bisa menghindari kasus edge,
- cocok untuk staged migration.

Kekurangan:

- filtering harus akurat,
- butuh migration plan,
- butuh audit approval,
- perlu rollback/repair plan.

### 6.3 Strategy C — Big Bang Migration

```text
all active v1 instances migrate to v2
```

Cocok hanya jika:

- perubahan wajib untuk semua open cases,
- mapping jelas,
- process sederhana,
- instance count manageable,
- testing sangat matang,
- operational window tersedia.

Risiko:

- mass incident,
- wrong mapping,
- business dispute,
- audit ambiguity,
- worker overload setelah migration.

### 6.4 Strategy D — Let Old Version Drain

```text
deploy v2
prevent new v1 starts
let v1 running instances finish naturally
remove v1 support only after zero active instances
```

Ini sering menjadi strategi paling aman.

Kuncinya:

```sql
count active instances by processDefinitionVersion
```

Dan governance:

```text
A process version may be retired only when:
  active instances = 0
  incidents = 0
  pending user tasks = 0
  pending messages/timers = 0
  legal retention/export completed
```

---

## 7. Process Instance Migration: Apa Artinya Sebenarnya

Process instance migration berarti:

> “Fit running process instance from old process definition into a different process definition.”

Ini bukan sekadar update pointer versi.

Engine perlu tahu:

```text
old active element -> new active element
```

Contoh:

```text
v1:
  Start -> Review Application -> Approve

v2:
  Start -> Initial Screening -> Review Application -> Approve
```

Jika instance sedang aktif di `Review Application`, migration mapping mungkin:

```text
v1.ReviewApplication -> v2.ReviewApplication
```

Tetapi pertanyaan business-nya:

> “Apakah instance yang sudah sampai Review Application boleh melewati Initial Screening?”

Migration plan bukan hanya teknis. Ia adalah keputusan business.

---

## 8. Migration Mapping: Element ID Stability

Agar migration aman, element ID harus stabil.

Buruk:

```text
Task_1a2b3c
Gateway_0x9y8z
Event_7k6l5m
```

Lebih baik:

```text
Task_ReviewApplication
Task_RequestAdditionalDocuments
Gateway_IsHighRisk
Timer_ApplicantResubmissionDeadline
Event_PaymentReceived
```

Kenapa?

Karena mapping migration, test, logs, metrics, dan audit jauh lebih mudah.

```text
sourceElementId = Task_ReviewApplication
 targetElementId = Task_ReviewApplication
```

Element ID yang stabil adalah investasi operasional.

---

## 9. Kapan Migration Aman?

Migration relatif aman jika:

1. active element masih ada di versi baru,
2. semantic element tidak berubah drastis,
3. variable yang dibutuhkan versi baru sudah tersedia,
4. worker kompatibel dengan payload lama,
5. user task/form masih bisa diselesaikan,
6. timer/message subscription masih valid,
7. audit sudah approved,
8. migration bisa diuji dengan sample instance nyata.

Contoh aman:

```text
v1:
  Review Application -> Approve

v2:
  Review Application -> Approve
      + improved labels/documentation
      + added non-interrupting reminder timer
```

Contoh berisiko:

```text
v1:
  Review Application -> Approve

v2:
  Auto Screen -> Agency Clearance -> Committee Review -> Approve
```

Jika perubahan mengubah meaning proses, jangan treat sebagai migration teknis.

---

## 10. Kapan Migration Tidak Aman?

Migration tidak aman jika:

- active element lama dihapus tanpa equivalent baru,
- branch lama tidak ada mapping business yang jelas,
- user task lama memakai form lama yang sudah tidak tersedia,
- process variable lama tidak cukup untuk versi baru,
- external system already received side effect,
- compensation path berubah,
- timer lama punya deadline yang berbeda dari rule baru,
- migration membuat kasus melewati mandatory legal step,
- tidak ada cara menjelaskan hasilnya ke auditor.

Rule praktis:

```text
If you cannot explain the migration in business language,
do not execute it as a technical migration.
```

---

## 11. Versioning dan Call Activity

Call activity memperkenalkan layer versioning tambahan.

Contoh:

```text
Main Process: license-application-review
  -> Call Activity: reusable-payment-process
  -> Call Activity: reusable-notification-process
```

Pertanyaan:

> Saat main process v1 berjalan, kalau reusable-payment-process v2 dideploy, apakah main process harus memanggil latest version atau versi yang fixed?

Ada beberapa binding strategy.

### 11.1 Latest Binding

```text
Call latest deployed version of called process
```

Kelebihan:

- bug fix called process langsung dipakai,
- tidak perlu deploy parent ulang,
- cocok untuk utility process yang backward-compatible.

Kekurangan:

- parent behavior bisa berubah tanpa parent deployment,
- audit lebih sulit,
- regression risk tersembunyi.

### 11.2 Deployment Binding

```text
Call version deployed together with parent
```

Kelebihan:

- parent-child release lebih konsisten,
- lebih aman untuk regulated flow,
- audit lebih jelas.

Kekurangan:

- perlu deploy package bersama,
- bug fix child mungkin tidak otomatis berlaku.

### 11.3 Fixed Version Binding

```text
Call specific version/tag
```

Kelebihan:

- paling deterministic,
- cocok untuk critical business process.

Kekurangan:

- upgrade perlu explicit change,
- risk old version linger lebih lama.

Camunda 8 mendukung resource binding untuk linked resources seperti call activities, DMN decisions, dan Camunda Forms agar versi resource yang dipakai bisa dikendalikan dan deployment baru tidak mengganggu live processes.

---

## 12. Versioning DMN dan Decision Logic

DMN sering lebih sensitif daripada BPMN.

BPMN mungkin tetap:

```text
Assess Eligibility -> Approve/Reject
```

Tetapi DMN eligibility rule berubah:

```text
v1: minimum capital >= 50,000
v2: minimum capital >= 100,000
```

Pertanyaan:

- Rule baru berlaku untuk aplikasi baru saja?
- Berlaku untuk aplikasi yang sudah submit tapi belum assessed?
- Berlaku untuk aplikasi yang sudah assessed tapi belum approved?
- Berlaku retroaktif?

Decision versioning harus jelas.

Pattern aman:

```text
Process instance stores:
  policyVersion: "ELIGIBILITY-2026-04"
  decisionVersion: "eligibility-v7"
  decisionResultSnapshot: {...}
```

Jangan hanya menyimpan result akhir:

```json
{"eligible": true}
```

Simpan juga konteks keputusan:

```json
{
  "decision": "ELIGIBILITY",
  "decisionVersion": "2026.04",
  "inputs": {
    "licenseType": "A",
    "capital": 75000,
    "riskScore": 42
  },
  "outputs": {
    "eligible": true,
    "requiredReviewLevel": "STANDARD"
  },
  "evaluatedAt": "2026-04-10T09:15:00Z"
}
```

Dalam regulated process, keputusan harus reproducible secara business, bukan hanya secara teknis.

---

## 13. Versioning Forms dan User Task UI

Human workflow punya problem tambahan: task lama bisa masih terbuka saat UI/form baru sudah dideploy.

Contoh:

```text
Task: Review Application
Form v1 fields:
  - recommendation
  - remarks

Form v2 fields:
  - recommendation
  - riskCategory
  - remarks
  - legalBasis
```

Jika task lama dibuka dengan form baru, apa yang terjadi?

Risiko:

- field required baru tidak punya default,
- officer tidak tahu policy lama/baru,
- submission gagal,
- audit menjadi ambigu,
- old task completed with new meaning.

Pattern:

```text
User task should know form version.
Form version should be compatible with task/process version.
Backend completion endpoint should validate command version.
```

Contoh payload completion:

```json
{
  "taskId": "...",
  "processDefinitionVersion": 3,
  "formVersion": "review-application-v2",
  "commandVersion": "ReviewApplicationCommand.v2",
  "decision": "APPROVE",
  "remarks": "All requirements met",
  "legalBasis": "Reg-2026-04"
}
```

---

## 14. Worker Compatibility: Hal yang Paling Sering Dilupakan

BPMN versioning tidak berguna kalau worker tidak kompatibel.

Misalnya service task:

```text
job type: generate-license-document
```

Process v1 mengirim variable:

```json
{
  "applicationId": "APP-001",
  "licenseType": "SALESPERSON"
}
```

Process v2 mengirim:

```json
{
  "application": {
    "id": "APP-001",
    "type": "SALESPERSON"
  },
  "documentTemplate": "LICENSE_V2"
}
```

Jika worker v2 hanya paham format baru, process v1 akan gagal.

### 14.1 Compatibility Strategy A — One Worker Supports Multiple Versions

```java
switch (contractVersion) {
    case "1": handleV1(vars); break;
    case "2": handleV2(vars); break;
    default: throw unsupportedVersion(...);
}
```

Kelebihan:

- operationally simple,
- one deployment,
- cocok untuk small version count.

Kekurangan:

- code branch bertambah,
- testing matrix membesar,
- risk legacy logic tidak pernah dibersihkan.

### 14.2 Compatibility Strategy B — Versioned Job Types

```text
v1: generate-license-document.v1
v2: generate-license-document.v2
```

Kelebihan:

- kontrak eksplisit,
- worker bisa dipisah,
- legacy bisa dihentikan saat instance lama selesai.

Kekurangan:

- BPMN lebih banyak variasi,
- worker deployment lebih banyak,
- observability perlu grouping.

### 14.3 Compatibility Strategy C — Adapter/Translator Layer

```text
old process variable -> canonical command -> worker handler
new process variable -> canonical command -> worker handler
```

Kelebihan:

- core business logic tetap bersih,
- versioning isolated di adapter,
- cocok untuk long-lived processes.

Contoh:

```java
public interface JobCommandMapper<T> {
    boolean supports(String processId, int processVersion, String jobType);
    T map(ProcessVariables variables);
}
```

---

## 15. Variable Schema Evolution

Process variable schema berubah seiring waktu.

Masalah umum:

```text
v1 variable tidak punya field yang v2 worker anggap required
```

### 15.1 Safe Changes

Biasanya aman:

- add optional field,
- add field with default,
- add enum value jika consumer tolerant,
- add nested object jika optional.

### 15.2 Risky Changes

Berisiko:

- rename field,
- remove field,
- change type,
- change meaning,
- change enum semantics,
- change date/time format,
- change ID/correlation key.

### 15.3 Compatibility Rule

Gunakan prinsip:

```text
Writers may add.
Readers must tolerate unknown fields.
Readers must define defaults for missing optional fields.
Breaking changes require new contract version.
```

Contoh DTO Java:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record GenerateDocumentCommandV2(
    String applicationId,
    String licenseType,
    String documentTemplate,
    String policyVersion
) {
    public String documentTemplateOrDefault() {
        return documentTemplate == null ? "LICENSE_DEFAULT" : documentTemplate;
    }
}
```

Untuk Java 8, gunakan class biasa:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public class GenerateDocumentCommandV2 {
    private String applicationId;
    private String licenseType;
    private String documentTemplate;
    private String policyVersion;

    public String documentTemplateOrDefault() {
        return documentTemplate == null ? "LICENSE_DEFAULT" : documentTemplate;
    }

    // getters/setters
}
```

---

## 16. Semantic Versioning Untuk Workflow Contract

Semantic versioning bisa diadaptasi untuk workflow contract.

```text
MAJOR.MINOR.PATCH
```

Tetapi artinya harus didefinisikan untuk process.

### PATCH

Perubahan tidak mengubah executable behavior/signature.

Contoh:

- label fix,
- documentation fix,
- monitoring metadata,
- safe bug fix worker yang backward-compatible.

### MINOR

Perubahan additive dan backward-compatible.

Contoh:

- optional reminder,
- optional variable,
- new branch only for new application type,
- new DMN rule that does not affect old policy version.

### MAJOR

Breaking change.

Contoh:

- variable schema breaking,
- mandatory step baru,
- changed SLA semantics,
- changed approval authority,
- removed task/branch,
- changed correlation key,
- changed legal decision rule.

Workflow semver bukan hanya developer convention. Ia harus masuk ke release notes dan business governance.

---

## 17. Deployment Pipeline untuk BPMN/Camunda

Production-grade pipeline minimal:

```text
1. BPMN lint/validation
2. BPMN semantic review
3. DMN/form compatibility check
4. Worker contract test
5. Process scenario test
6. Migration simulation, jika ada
7. Security review
8. Observability metadata check
9. Release notes generation
10. Deployment to lower env
11. Smoke test
12. Production deploy
13. Post-deploy monitoring
```

### 17.1 BPMN Lint

Validasi:

- executable process exists,
- no missing job type,
- no unnamed major element,
- no unstable generated ID untuk critical element,
- no orphan event,
- no missing error boundary untuk known business exception,
- no unbounded timer loop,
- no large variable mapping,
- no missing correlation key.

### 17.2 Contract Test

Pastikan setiap service task punya worker:

```text
BPMN job type -> registered worker handler
```

Contoh registry:

```text
calculate-risk-score         -> RiskScoreWorker
request-external-clearance   -> ExternalClearanceWorker
send-approval-email          -> NotificationWorker
```

Jika BPMN mendefinisikan job type baru tetapi worker belum deploy, deployment harus gagal di CI.

### 17.3 Process Scenario Test

Test path:

- happy path,
- rejection path,
- document resubmission path,
- payment timeout path,
- external agency late response,
- duplicate message,
- worker failure,
- compensation,
- escalation.

---

## 18. Release Strategy: Blue/Green, Canary, Feature Flag

Workflow release tidak sama dengan stateless service release.

### 18.1 Blue/Green Application Deployment

Untuk Java worker:

```text
blue worker version running
start green worker version
shift traffic/deployment
stop blue after drain
```

Tetapi job activation tidak seperti HTTP load balancer biasa. Dua worker version bisa sama-sama mengambil job type yang sama.

Jika worker green tidak kompatibel dengan old job payload, bahaya.

Pattern:

```text
Do not run incompatible workers with same job type.
Use versioned job type or compatibility adapter.
```

### 18.2 Canary Process Deployment

Untuk process definition:

```text
deploy v2
route only selected new instances to v2
others still start v1
```

Butuh process start router.

```java
public String chooseProcessDefinitionKey(StartApplicationCommand cmd) {
    if (featureFlag.isEnabled("license-process-v2", cmd.agencyId())) {
        return "license-application-review-v2";
    }
    return "license-application-review";
}
```

Alternatif: same process ID, latest version auto-start untuk semua new instance. Ini lebih sederhana tapi kurang kontrol.

### 18.3 Feature Flag Dalam Process

Hati-hati.

Feature flag bisa membuat BPMN sulit dipahami jika semua variasi tersembunyi di gateway expression.

Buruk:

```text
Gateway condition: featureFlagX && complexConditionY && temporaryFlagZ
```

Lebih baik:

```text
Explicit process version for major flow change.
Feature flag only for rollout routing or non-semantic behavior.
```

### 18.4 Dark Launch Worker

Worker baru bisa dideploy tetapi belum diaktifkan oleh process baru.

```text
Deploy worker v2 first
Verify health/metrics
Deploy BPMN v2 using job type v2
Start canary instances
```

Ini lebih aman daripada deploy BPMN yang langsung membuat jobs tanpa worker siap.

---

## 19. Rollback Reality

Rollback dalam workflow sangat berbeda dari rollback aplikasi.

### 19.1 Code Rollback

Relatif mudah:

```text
worker v2 -> rollback to worker v1
```

Tetapi hanya aman jika:

- process v2 belum membuat job type baru,
- variable schema masih compatible,
- external side effects belum berubah,
- worker v1 bisa membaca payload yang dibuat v2.

### 19.2 BPMN Rollback

Tidak ada “undo deployment” sederhana untuk running instances.

Kalau process v2 sudah start instance:

```text
Instance X based on v2
```

Menghapus/mengabaikan v2 tidak otomatis memindahkan Instance X ke v1.

Rollback opsi:

1. stop creating new v2 instances,
2. deploy v3 that fixes v2,
3. migrate selected v2 instances to v3,
4. manually repair affected instances,
5. let unaffected v2 instances drain.

Sering kali strategi terbaik bukan rollback ke v1, tapi **forward fix** ke v3.

### 19.3 DMN Rollback

Jika decision rule salah dan sudah dipakai:

- keputusan yang sudah diambil harus dievaluasi ulang secara business,
- process instance mungkin perlu repair,
- audit harus mencatat correction,
- notification/payment/document side effects mungkin perlu compensation.

### 19.4 External Side Effect Cannot Be Rolled Back Technically

Jika worker sudah:

- mengirim email,
- membuat invoice,
- menerbitkan dokumen,
- mengirim data ke agency external,
- memotong payment,

maka rollback code tidak membatalkan side effect tersebut.

Butuh business compensation.

---

## 20. Change Management Governance

Setiap process change harus diklasifikasikan.

Template klasifikasi:

```text
Change ID:
Process ID:
Current Version:
Target Version:
Change Type:
  [ ] cosmetic
  [ ] additive
  [ ] control-flow
  [ ] data-contract
  [ ] decision-policy
  [ ] form/task
  [ ] integration
  [ ] security
  [ ] SLA

Affected Running Instances:
Migration Required:
Worker Compatibility:
Variable Compatibility:
DMN/Form Binding Impact:
Audit Impact:
Rollback/Forward Fix Plan:
Testing Evidence:
Business Approval:
Technical Approval:
Operational Approval:
```

Governance bukan birokrasi kosong. Ia melindungi sistem dari perubahan yang “kelihatan kecil” tapi mengubah nasib kasus.

---

## 21. Process Change Impact Analysis

Sebelum deploy, jawab pertanyaan ini.

### 21.1 Runtime Impact

- Ada berapa active instances per version?
- Mereka aktif di element mana?
- Ada incident aktif?
- Ada timer/message subscription aktif?
- Ada user task pending?

### 21.2 Data Impact

- Variable apa yang ditambah?
- Variable apa yang dihapus/rename?
- Apakah old instance punya required data baru?
- Apakah variable besar akan membebani engine?

### 21.3 Worker Impact

- Job type berubah?
- Payload berubah?
- Retry semantics berubah?
- Worker baru backward-compatible?
- Worker lama masih perlu hidup?

### 21.4 Human Task Impact

- Form berubah?
- Assignment rule berubah?
- Task lama masih bisa dibuka?
- Completion command compatible?
- Maker-checker rule berubah?

### 21.5 Integration Impact

- Message name berubah?
- Correlation key berubah?
- External event schema berubah?
- API contract berubah?
- External system perlu diberi tahu?

### 21.6 Audit/Compliance Impact

- Rule baru retroaktif?
- Case lama harus ikut rule lama atau baru?
- Decision snapshot cukup?
- Repair action perlu approval?
- Legal basis berubah?

---

## 22. Change Matrix

| Change | New instance only | Existing instance migration | Worker update | Data migration | Business approval |
|---|---:|---:|---:|---:|---:|
| Label/documentation only | optional | no | no | no | usually no |
| Add optional reminder | yes | optional | no | no | maybe |
| Add mandatory approval step | yes | maybe | yes | maybe | yes |
| Rename variable | risky | risky | yes | yes | yes |
| Change SLA from 14d to 7d | yes | maybe | maybe | maybe | yes |
| Add new external agency clearance | yes | selective | yes | yes | yes |
| Fix worker retry bug | no BPMN change | no | yes | no | maybe |
| Change DMN eligibility rule | yes | maybe | maybe | maybe | yes |
| Change message correlation key | high risk | high risk | yes | yes | yes |

---

## 23. Regulatory Case Example: License Application Process v1 to v2

### 23.1 Existing v1

```text
Start
  -> Submit Application
  -> Officer Review
  -> Payment
  -> Issue License
  -> End
```

Variables:

```json
{
  "applicationId": "APP-001",
  "applicantId": "UEN-123",
  "licenseType": "SALESPERSON",
  "riskLevel": "LOW"
}
```

### 23.2 New Requirement

Regulator introduces:

1. mandatory risk screening before officer review,
2. high-risk cases require senior approval,
3. new SLA: high-risk cases must be reviewed within 7 working days,
4. new legal basis field required in decision form.

### 23.3 v2 Process

```text
Start
  -> Submit Application
  -> Risk Screening
  -> Gateway: High Risk?
      -> Yes: Senior Approval
      -> No: Officer Review
  -> Payment
  -> Issue License
  -> End
```

### 23.4 Decision Questions

For existing v1 instances:

```text
Case A: waiting at Officer Review
Case B: already completed Officer Review, waiting Payment
Case C: waiting applicant document resubmission
Case D: incident at Issue License
```

Should they migrate?

Possible decision:

```text
Case A: migrate to v2 Risk Screening if not yet reviewed
Case B: stay on v1 because review already completed
Case C: stay on v1 until resubmission, then maybe migrate selectively
Case D: repair in v1; do not migrate during incident
```

This is not a technical decision. It requires business/legal approval.

---

## 24. Migration Plan Example

Migration proposal:

```text
Migration: license-application-review v1 -> v2

Scope:
  - Only active instances at Task_OfficerReview
  - Exclude escalated instances
  - Exclude instances with active incident
  - Exclude instances already assessed

Mapping:
  Task_OfficerReview -> Task_RiskScreening

Variable preparation:
  - Add policyVersion = "LIC-POLICY-2026-04"
  - Add riskScreeningRequired = true
  - Add formVersion = "risk-screening-v1"

Post-migration validation:
  - Instance active at Task_RiskScreening
  - No incidents created
  - Audit repair event written
  - Dashboard migration count matches approved list
```

Audit note:

```text
Migration performed because regulatory rule LIC-POLICY-2026-04 applies to open applications not yet assessed. Migration approved by Business Owner X and System Owner Y.
```

---

## 25. Java Architecture for Versioned Process Applications

### 25.1 Process Contract Registry

```java
public final class ProcessContracts {
    public static final String LICENSE_REVIEW = "license-application-review";

    public static final class Variables {
        public static final String APPLICATION_ID = "applicationId";
        public static final String PROCESS_CONTRACT_VERSION = "processContractVersion";
        public static final String POLICY_VERSION = "policyVersion";
    }

    public static final class JobTypes {
        public static final String RISK_SCREENING_V1 = "risk-screening.v1";
        public static final String ISSUE_LICENSE_V1 = "issue-license.v1";
        public static final String ISSUE_LICENSE_V2 = "issue-license.v2";
    }

    private ProcessContracts() {}
}
```

### 25.2 Version-aware Command Mapper

```java
public interface VersionedJobMapper<T> {
    boolean supports(JobContext context);
    T map(JobContext context);
}
```

```java
public final class JobContext {
    private final String processDefinitionId;
    private final int processVersion;
    private final String jobType;
    private final Map<String, Object> variables;

    // constructor/getters
}
```

### 25.3 Worker Handler

```java
public final class IssueLicenseWorker {
    private final List<VersionedJobMapper<IssueLicenseCommand>> mappers;
    private final LicenseIssuer issuer;
    private final IdempotencyService idempotency;

    public void handle(JobContext context) {
        IssueLicenseCommand command = mappers.stream()
            .filter(mapper -> mapper.supports(context))
            .findFirst()
            .orElseThrow(() -> new UnsupportedProcessContractException(context))
            .map(context);

        idempotency.executeOnce(command.idempotencyKey(), () -> {
            issuer.issue(command);
            return null;
        });
    }
}
```

### 25.4 Why This Matters

Worker tidak boleh hanya parsing map sembarangan:

```java
String applicationId = (String) variables.get("applicationId");
```

Karena variable contract berubah.

Lebih baik:

```text
process variables -> versioned command mapper -> stable domain command -> domain service
```

---

## 26. Deployment Order

Urutan deployment penting.

### 26.1 Safe Order for Additive Worker-backed BPMN Change

```text
1. Deploy backward-compatible worker first
2. Verify worker healthy
3. Deploy BPMN v2
4. Start limited new instances
5. Monitor incidents/job failures
6. Increase rollout
```

### 26.2 Unsafe Order

```text
1. Deploy BPMN v2 with new job type
2. New instance reaches new service task
3. No worker exists
4. Incidents pile up
```

### 26.3 Safe Order for Variable Contract Change

```text
1. Deploy worker that supports old and new schema
2. Deploy UI/API that writes both old/new if needed
3. Deploy BPMN/DMN using new schema
4. Wait for old instances to drain or migrate
5. Remove old schema support only after evidence
```

---

## 27. Retirement Strategy

Process version retirement is a controlled operation.

Checklist:

```text
[ ] active instances = 0
[ ] active incidents = 0
[ ] active user tasks = 0
[ ] active timers/messages = 0
[ ] external pending callbacks = 0
[ ] worker legacy job type unused for N days
[ ] audit/export retention complete
[ ] dashboards updated
[ ] runbooks updated
[ ] business owner approved retirement
```

Jangan hapus worker lama hanya karena “sudah deploy versi baru”.

---

## 28. Observability for Versioning

Metrics penting:

```text
process_instances_started_total{processId, version}
process_instances_active{processId, version, elementId}
process_instances_completed_total{processId, version}
process_instances_incident_total{processId, version, elementId}
job_failures_total{jobType, workerVersion, processVersion}
user_tasks_active{taskDefinitionId, processVersion}
message_correlation_failures_total{messageName, processVersion}
migration_attempts_total{sourceVersion, targetVersion, status}
```

Logs harus punya:

```json
{
  "processId": "license-application-review",
  "processVersion": 4,
  "processInstanceKey": "2251799813685251",
  "elementId": "Task_RiskScreening",
  "jobType": "risk-screening.v1",
  "workerVersion": "2026.04.12-1",
  "contractVersion": "2",
  "businessKey": "APP-001"
}
```

Tanpa observability per version, migration dan rollback diagnosis menjadi tebak-tebakan.

---

## 29. Testing Strategy for Versioning

### 29.1 Contract Compatibility Test

Test worker dengan payload versi lama dan baru.

```text
Given v1 payload
When worker v2 handles job
Then command is mapped correctly
```

```text
Given v2 payload
When worker v2 handles job
Then command is mapped correctly
```

### 29.2 Migration Simulation Test

Simulasikan instance aktif di element lama lalu migrasikan ke versi baru.

Validate:

- active element setelah migration,
- variables setelah migration,
- no incident,
- next step executable,
- audit event written.

### 29.3 Regression Test for Old Version

Selama v1 masih punya active instances, v1 path masih harus dites.

```text
Do not delete old tests until old process instances are gone.
```

### 29.4 Golden Case Set

Simpan representative cases:

- simple approval,
- rejection,
- resubmission,
- payment timeout,
- high-risk approval,
- external clearance pending,
- SLA escalation,
- compensation.

Setiap process version diuji terhadap golden cases yang relevan.

---

## 30. Common Anti-patterns

### 30.1 “Latest Everything”

Semua call activity, DMN, dan form mengambil latest version.

Akibat:

- behavior parent process berubah tanpa deployment parent,
- sulit audit,
- sulit reproduce old case.

### 30.2 “One Worker to Rule Them All” Without Version Mapping

Worker membaca variable map langsung dan menganggap semua payload sama.

Akibat:

- old instance gagal setelah deploy,
- error muncul hanya di production,
- sulit trace karena tidak ada contract version.

### 30.3 Delete Old Worker Too Early

Worker legacy dihapus saat masih ada active instances.

Akibat:

- job lama stuck,
- incident muncul setelah delay,
- support team bingung karena deployment sudah lewat lama.

### 30.4 Migration Without Business Approval

Engineer memigrasikan instance karena “secara teknis bisa”.

Akibat:

- business outcome berubah,
- audit tidak bisa membenarkan,
- user dispute.

### 30.5 Variable Rename Without Backward Compatibility

```text
applicationId -> application.id
```

tanpa adapter/default.

Akibat:

- old jobs fail,
- message correlation fails,
- user task completion fails.

### 30.6 Rollback Illusion

Mengira rollback deployment akan rollback process state.

Akibat:

- instance v2 tetap hidup,
- external side effects sudah terjadi,
- rollback memperburuk compatibility.

---

## 31. Design Review Checklist

Gunakan checklist ini sebelum setiap process release.

### Process Definition

```text
[ ] Process ID stable
[ ] Element IDs stable and meaningful
[ ] Change type classified
[ ] New version behavior documented
[ ] Old version behavior documented
[ ] Running instance strategy chosen
```

### Migration

```text
[ ] Migration required?
[ ] Migration scope defined?
[ ] Source and target elements mapped?
[ ] Exclusions defined?
[ ] Variable preparation defined?
[ ] Migration tested?
[ ] Business approval obtained?
[ ] Roll-forward repair plan ready?
```

### Worker

```text
[ ] New job types have workers
[ ] Old job types still supported if needed
[ ] Worker supports old/new payloads
[ ] Idempotency unaffected
[ ] Retry semantics reviewed
[ ] Worker version visible in logs/metrics
```

### Variables

```text
[ ] Variable schema diff reviewed
[ ] Required fields have defaults or migration
[ ] Unknown fields tolerated
[ ] Sensitive data minimized
[ ] Contract version stored
```

### DMN/Form/Call Activity

```text
[ ] Binding strategy reviewed
[ ] Decision version impact understood
[ ] Form version compatible with active tasks
[ ] Called process version controlled
```

### Operations

```text
[ ] Dashboard per version available
[ ] Incident alert per version available
[ ] Runbook updated
[ ] Retirement criteria defined
[ ] Post-deploy monitoring window defined
```

### Audit/Compliance

```text
[ ] Business reason recorded
[ ] Policy effective date recorded
[ ] Retroactivity decision recorded
[ ] Migration/repair audit event design ready
[ ] Evidence reproducible later
```

---

## 32. Top 1% Mental Model

A process version is not a file version.

It is a **business behavior version**.

A deployment is not just a technical event.

It is a **change in how future cases may be decided, routed, escalated, retried, repaired, and audited**.

A migration is not just a runtime operation.

It is a **business claim that an in-flight case can legally and semantically move from one execution contract to another**.

A rollback is not time travel.

It is usually a **forward correction with explicit audit, compensation, and repair**.

The strongest workflow engineers design every process change with these invariants:

```text
1. Running cases must remain explainable.
2. Worker contracts must remain compatible.
3. Process variables must evolve safely.
4. Human tasks must remain completable.
5. Decision versions must be auditable.
6. Migration must be business-approved, not merely technically possible.
7. Rollback must be treated as operational recovery, not magic undo.
8. Old versions may live longer than code release cycles.
9. Version visibility is mandatory for operations.
10. A process release is a governance event.
```

---

## 33. Practical Exercise

Ambil satu process yang sudah kita pakai di contoh sebelumnya:

```text
license-application-review
```

Buat perubahan v2:

```text
Add mandatory agency clearance for high-risk applications.
```

Jawab:

1. Apakah perubahan ini major/minor/patch?
2. Apakah existing instances perlu migrasi?
3. Instance state mana yang boleh migrasi?
4. Instance state mana yang tidak boleh migrasi?
5. Variable baru apa yang dibutuhkan?
6. Worker baru apa yang dibutuhkan?
7. Apakah job type perlu versioned?
8. Apakah DMN berubah?
9. Apakah form review berubah?
10. Apa migration audit note-nya?
11. Apa rollback/forward-fix plan-nya?
12. Metrics apa yang harus dipantau setelah deployment?

Jika kamu bisa menjawab pertanyaan ini dengan jelas, kamu bukan lagi sekadar “bisa pakai Camunda”. Kamu mulai berpikir seperti process orchestration engineer.

---

## 34. Ringkasan

Part ini membahas:

- kenapa workflow versioning berbeda dari code versioning,
- process definition vs process instance,
- running instance compatibility,
- new instance only vs selective migration vs big bang migration vs drain old version,
- process instance migration,
- element ID stability,
- call activity/DMN/form binding,
- worker compatibility,
- variable schema evolution,
- semantic versioning untuk workflow contract,
- deployment order,
- rollback reality,
- governance,
- observability,
- testing,
- retirement strategy,
- anti-patterns,
- production checklist.

Kunci utama:

```text
Workflow release engineering is about preserving business truth while changing executable behavior.
```

---

## 35. Referensi

- Camunda 8 Docs — Process instance migration: https://docs.camunda.io/docs/components/concepts/process-instance-migration/
- Camunda 8 Docs — Versioning process definitions: https://docs.camunda.io/docs/components/best-practices/operations/versioning-process-definitions/
- Camunda 8 Docs — Choosing the resource binding type: https://docs.camunda.io/docs/components/best-practices/modeling/choosing-the-resource-binding-type/
- Camunda 8 REST API — Migrate process instance: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/migrate-process-instance/
- Camunda 8 REST API — Migrate process instances batch operation: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/migrate-process-instances-batch-operation/
- Camunda 8 Docs — Process instance modification: https://docs.camunda.io/docs/components/concepts/process-instance-modification/
- Camunda 8 Docs — Process application versioning: https://docs.camunda.io/docs/components/modeler/web-modeler/process-applications/process-application-versioning/
- Semantic Versioning 2.0.0: https://semver.org/

---

## 36. Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
- Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
- Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
- Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic
- Part 12 — Message Correlation and Event-driven Process Design
- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior
- Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control
- Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition
- Part 16 — Saga and Long-running Transaction Engineering with BPMN
- Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot
- Part 18 — Camunda 8 Deep Dive: Zeebe, Workers, Operate, Tasklist, Optimize, Identity
- Part 19 — Spring Boot + Camunda 8 Process Application Architecture
- Part 20 — Testing BPMN and Camunda Applications
- Part 21 — Observability: Logs, Metrics, Tracing, Audit, and Operability
- Part 22 — Production Operations: Incidents, Repair, Migration, and Runbook Engineering
- Part 23 — Security, Identity, Authorization, and Data Protection
- Part 24 — Integration Patterns: REST, Messaging, Files, Email, External Systems, and Connectors
- Part 25 — Performance, Scaling, Capacity Planning, and Cost Engineering
- Part 26 — Process Versioning, Deployment Strategy, and Change Management

Seri belum selesai.

Berikutnya:

> Part 27 — Advanced Modeling Patterns for Regulatory and Case Management Systems
