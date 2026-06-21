# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-032.md

# Part 032 — Security, Compliance, Audit Trail, PII, and Regulated Workflow Defensibility

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Fokus: Java + Camunda 8 / Zeebe untuk production-grade, regulated, cloud-native process orchestration  
> Level: Advanced / Staff+ Engineering  
> Java scope: Java 8 sampai Java 25, dengan catatan modern baseline Java 17/21+ untuk sistem baru

---

## 0. Tujuan Bagian Ini

Bagian ini membahas bagaimana mendesain Camunda 8 / Zeebe untuk lingkungan yang membutuhkan **security**, **compliance**, **auditability**, **PII protection**, dan **regulatory defensibility**.

Ini bukan bagian tentang “cara login ke Camunda UI” saja. Fokus kita adalah:

1. Bagaimana membuat workflow yang aman secara arsitektur.
2. Bagaimana membatasi siapa boleh melihat, memulai, mengubah, menyelesaikan, atau mengoperasikan proses.
3. Bagaimana mendesain process variables agar tidak menjadi kebocoran data.
4. Bagaimana membedakan audit trail, observability, business timeline, dan engine history.
5. Bagaimana membuat keputusan workflow dapat dipertanggungjawabkan saat audit, dispute, appeal, regulator review, atau incident investigation.
6. Bagaimana Java workers harus mengelola credential, PII, logging, idempotency, dan side effect external system.
7. Bagaimana membangun model defensibility untuk regulatory workflow: “bukan hanya proses berjalan, tetapi bisa dibuktikan kenapa berjalan begitu”.

Target akhirnya: Anda tidak hanya bisa membuat proses Camunda 8 berjalan, tetapi bisa membuatnya **aman, dapat diaudit, minim data sensitif, dapat dijelaskan, dan tahan terhadap dispute**.

---

## 1. Mental Model Utama

Security dan compliance dalam Camunda 8 harus dilihat sebagai **boundary design**, bukan fitur tambahan.

Camunda 8 memiliki beberapa boundary penting:

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Human Access Boundary                         │
│  Admin / Operate / Tasklist / Optimize / Modeler / Console           │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Orchestration Command Boundary                     │
│  start process, publish message, complete task, modify instance       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Zeebe Engine Boundary                         │
│  durable process state, jobs, messages, timers, incidents             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Worker Execution Boundary                     │
│  Java workers, connectors, external systems, DB, APIs                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Read / Audit Boundary                         │
│  exporters, Operate, Tasklist, Optimize, custom audit projection      │
└─────────────────────────────────────────────────────────────────────┘
```

Top 1% engineer tidak bertanya hanya:

> “Bagaimana saya panggil API Camunda?”

Tetapi bertanya:

> “Siapa principal yang melakukan command ini, pada tenant mana, atas dasar permission apa, menghasilkan state transition apa, membawa data apa, terekspos ke projection mana, terekam dalam audit apa, dan bagaimana kita membuktikan keputusan ini 2 tahun kemudian?”

---

## 2. Kesalahan Cara Pikir yang Sering Terjadi

### 2.1 Menganggap BPMN diagram sama dengan audit trail

BPMN menunjukkan **intended control flow**. Audit trail harus menunjukkan **actual execution evidence**.

Contoh BPMN:

```text
Application Submitted -> Review -> Approve -> Notify Applicant
```

Itu belum menjawab:

1. Siapa yang submit?
2. Siapa yang review?
3. Data apa yang dilihat reviewer?
4. Versi rule apa yang dipakai?
5. Apakah decision dibuat manual atau otomatis?
6. Apakah ada override?
7. Apakah task direassign?
8. Apakah ada timer escalation?
9. Apakah external check berhasil, timeout, atau di-retry?
10. Apakah keputusan bisa direkonstruksi setelah variable dibersihkan?

BPMN adalah model eksekusi. Audit defensibility adalah model bukti.

### 2.2 Menganggap Operate sebagai audit system final

Operate sangat berguna untuk operational support, incident handling, dan process inspection. Tetapi dalam regulated system, Operate biasanya tidak cukup sebagai audit system final.

Alasannya:

1. Operate adalah read-side projection dari exported records.
2. Retention policy dapat menghapus data historis tertentu.
3. Tampilan Operate dioptimalkan untuk operations, bukan legal-grade evidence model.
4. Business audit sering membutuhkan konteks domain yang tidak cocok disimpan penuh di process variables.
5. Audit trail perlu stabil walaupun BPMN model, variable schema, atau UI berubah.

Prinsip:

> Operate membantu menjawab “apa yang terjadi di engine?”  
> Audit domain harus menjawab “apa keputusan bisnis yang sah, oleh siapa, atas dasar apa, kapan, dan dampaknya apa?”

### 2.3 Menaruh terlalu banyak data sensitif di process variables

Ini adalah salah satu anti-pattern paling berbahaya.

Process variables mudah terlihat di:

1. Operate.
2. Tasklist.
3. Optimize.
4. Exported records.
5. Secondary storage seperti Elasticsearch/OpenSearch.
6. Backup.
7. Debug logs bila worker tidak disiplin.
8. Incident payload.
9. Custom exporters.
10. Analytics/reporting pipeline.

Prinsip:

> Process variable adalah orchestration state, bukan secure document repository.

### 2.4 Menganggap authorization UI cukup untuk authorization bisnis

Camunda authorization dapat mengontrol akses ke komponen dan resource platform. Tetapi bisnis sering membutuhkan rule yang lebih kompleks:

1. Reviewer tidak boleh review case sendiri.
2. Officer hanya boleh akses case region tertentu.
3. Supervisor hanya boleh override jika escalation level tertentu.
4. Task boleh diklaim hanya jika user memiliki certification tertentu.
5. Evidence tertentu hanya boleh dilihat role tertentu.
6. Appeal handler tidak boleh sama dengan original decision maker.

Rule seperti ini biasanya harus berada di **domain authorization service**, bukan hanya UI permission.

---

## 3. Security Surface Camunda 8

Camunda 8 security surface dapat dipetakan seperti ini:

| Surface | Principal | Risiko | Kontrol |
|---|---|---|---|
| Admin / Identity | admin user | privilege escalation | least privilege, MFA/IdP, audit log |
| Operate | operator/support | melihat PII, retry salah | role-based access, masking, runbook |
| Tasklist | human worker | unauthorized task action | candidate group, task restrictions, domain checks |
| Optimize | analyst/manager | exposure analytics data | variable filtering, tenant isolation, dashboard access |
| Zeebe API / Orchestration API | machine client | start/modify process ilegal | client credentials, scoped authorization |
| Java workers | service principal | secret leakage, broad access | mTLS, secret vault, least privilege |
| Connectors | runtime principal | credential reuse, data exfiltration | secret references, connector governance |
| Exporters | platform process | data replication leakage | index security, filters, retention |
| Secondary storage | ES/OpenSearch operator | PII in indices | encryption, RBAC, ILM/retention |
| Logs/traces | observability users | PII leakage | structured redaction, sampling policy |
| Backup/restore | platform team | historical data leakage | encryption, access control, restore audit |
| CI/CD deployment | release principal | malicious BPMN/worker | approvals, artifact signing, deployment ledger |

Security design harus mencakup semua surface ini, bukan hanya login.

---

## 4. Authentication vs Authorization di Camunda 8

### 4.1 Authentication

Authentication menjawab:

> “Siapa kamu?”

Dalam Camunda 8, akses manusia biasanya melalui identity provider. Self-managed deployment dapat memakai Management Identity dan IdP seperti Keycloak. Machine-to-machine access memakai client credentials/token depending deployment mode.

### 4.2 Authorization

Authorization menjawab:

> “Setelah kamu dikenali, apa yang boleh kamu lakukan?”

Camunda 8 memiliki fine-grained authorization untuk Orchestration Cluster components seperti Zeebe, Admin, Operate, Tasklist, dan Orchestration Cluster APIs.

Namun perlu dipahami:

1. Authorization platform tidak selalu sama dengan authorization domain.
2. User yang boleh membuka Tasklist belum tentu boleh memutuskan case tertentu.
3. Worker yang boleh complete job belum tentu boleh melakukan semua external API call.
4. Operator yang boleh retry incident belum tentu boleh memperbaiki variable berisi data sensitif.

### 4.3 Dua lapis authorization

Untuk regulated workflow, desain minimal harus memisahkan:

```text
Platform Authorization
  └── boleh akses Camunda component/resource/action

Domain Authorization
  └── boleh melakukan aksi bisnis pada case tertentu berdasarkan rule domain
```

Contoh:

```text
User: alice
Platform permission:
  - dapat akses Tasklist
  - dapat claim task
  - dapat complete task

Domain permission:
  - hanya case agency = CEA
  - hanya region = EAST
  - tidak boleh case yang dia submit sendiri
  - tidak boleh override decision > threshold 50k
```

Jika hanya memakai platform authorization, Anda rentan terhadap authorized-but-invalid business action.

---

## 5. Orchestration Cluster Authorization

Camunda 8 Orchestration Cluster authorization mengontrol akses ke resource dan action seperti process definitions, process instances, decision definitions, user tasks, tenants, dan APIs.

Mental model:

```text
Subject / Principal
    │
    ▼
Authorization Rule
    │
    ├── Resource Type
    ├── Resource ID / wildcard
    └── Permission / action
```

Contoh kebutuhan:

| Role | Permission yang wajar |
|---|---|
| Process operator | view process instances, resolve selected incidents |
| Support engineer | inspect incidents, retry technical failures |
| Business supervisor | view and act on tasks in own domain |
| Deployment pipeline | deploy process definitions only |
| Worker client | activate/complete jobs for specific job types if supported by boundary design |
| Auditor | read-only access to relevant history/projections |
| Analyst | read Optimize dashboards but not Operate variables |

Prinsip desain:

1. Jangan beri wildcard luas untuk semua orang.
2. Pisahkan deployer, operator, task user, auditor, dan analyst.
3. Pisahkan environment: DEV/SIT/UAT/PROD.
4. Pisahkan tenant jika multi-tenant.
5. Jangan gunakan human admin credential untuk worker.
6. Jangan gunakan worker credential untuk deployment.
7. Jangan gunakan deployment credential untuk Operate support.

---

## 6. Management Identity vs Orchestration Cluster Authorization

Dalam Camunda 8 Self-Managed, ada boundary antara:

1. Orchestration Cluster access control untuk Zeebe/Admin/Operate/Tasklist/API.
2. Management Identity untuk komponen seperti Console, Web Modeler, dan Optimize.

Implikasi penting:

1. Jangan menganggap satu permission model otomatis berlaku ke semua komponen.
2. Optimize access perlu dilihat sebagai analytics exposure, bukan hanya dashboard convenience.
3. Web Modeler access adalah model governance risk: orang yang bisa mengubah model dapat mengubah alur bisnis.
4. Console/Admin access adalah platform risk: orang yang bisa mengubah cluster/app config dapat mempengaruhi runtime.

Checklist:

```text
[ ] Siapa boleh model BPMN?
[ ] Siapa boleh approve model BPMN?
[ ] Siapa boleh deploy ke PROD?
[ ] Siapa boleh view Operate PROD?
[ ] Siapa boleh melihat variables?
[ ] Siapa boleh resolve incident?
[ ] Siapa boleh modify process instance?
[ ] Siapa boleh view Optimize dashboard?
[ ] Siapa boleh export analytics?
[ ] Siapa boleh manage tenants?
```

---

## 7. Multi-Tenancy dan Data Isolation

Multi-tenancy di Camunda 8 harus dirancang sebagai security boundary, bukan hanya label.

Tenant dapat berarti:

1. Agency berbeda.
2. Customer berbeda.
3. Business unit berbeda.
4. Jurisdiction berbeda.
5. Data classification berbeda.
6. Environment-like isolation untuk regulatory separation.

Kesalahan umum:

```text
tenantId = "agencyA"
```

lalu worker tetap:

1. memakai credential global,
2. menulis ke database shared tanpa tenant predicate,
3. melakukan log tanpa tenant id,
4. memakai idempotency key tanpa tenant prefix,
5. publish message tanpa tenant validation,
6. query task tanpa domain authorization.

Tenant-aware worker harus memastikan semua operation membawa tenant context:

```java
public record WorkflowContext(
        String tenantId,
        String bpmnProcessId,
        long processInstanceKey,
        long jobKey,
        String businessKey,
        String correlationId,
        String actorType,
        String actorId
) {}
```

Idempotency key juga harus tenant-aware:

```text
idempotency_key = tenantId + ":" + businessOperation + ":" + businessId + ":" + operationVersion
```

Bukan:

```text
idempotency_key = businessId
```

Karena `businessId` bisa bentrok antar tenant.

---

## 8. Threat Model untuk Camunda 8 Workflow

Threat model harus mencakup attacker dan accidental misuse.

### 8.1 Human attacker/misuse

Contoh:

1. User mengakses task yang bukan miliknya.
2. Operator retry incident yang seharusnya di-review dulu.
3. Support mengubah variable untuk mempercepat proses tanpa approval.
4. Analyst mengekspor dashboard berisi PII.
5. Developer deploy BPMN salah ke PROD.
6. Admin memberikan permission wildcard terlalu luas.

### 8.2 Machine/client attacker/misuse

Contoh:

1. Service credential bocor lalu dipakai start process palsu.
2. Worker credential dipakai publish message arbitrary.
3. Connector secret disalahgunakan untuk call external API.
4. CI/CD token dipakai deploy malicious BPMN.
5. Bot melakukan message replay.

### 8.3 Data exposure threat

Contoh:

1. PII masuk process variables.
2. Worker log mencetak full variable map.
3. Elasticsearch/OpenSearch index tidak dibatasi aksesnya.
4. Backup dapat diakses tim tidak berwenang.
5. Optimize dashboard membuka sensitive variables.
6. Trace attribute menyimpan NIK/passport/email/phone.

### 8.4 Integrity threat

Contoh:

1. Worker menyelesaikan job tanpa validasi domain state.
2. Duplicate message menyebabkan double approval.
3. User task completed oleh actor yang tidak sah melalui API.
4. Process instance dimodifikasi manual tanpa audit domain.
5. External decision result diganti sebelum complete job.

### 8.5 Availability threat

Contoh:

1. Retry storm memenuhi worker dan external API.
2. Huge variables memperlambat exporter/Operate.
3. Malicious/buggy client membuat banyak process instance.
4. Timer explosion menghasilkan load tinggi.
5. Exporter lag membuat operational view terlambat.

---

## 9. PII dan Sensitive Data Classification

Sebelum bicara variable design, tetapkan klasifikasi data.

| Class | Contoh | Boleh di variable? | Catatan |
|---|---|---:|---|
| Public | process type, status umum | Ya | tetap minim |
| Internal | department code, queue name | Ya | tidak sensitif tapi tetap governance |
| Confidential | case id, agency id, officer id | Terbatas | gunakan reference ID |
| Restricted PII | NRIC/NIK, passport, address, DOB | Hindari | simpan di domain store terenkripsi |
| Secret | token, password, API key | Tidak | gunakan secret manager |
| Regulated evidence | dokumen, attachment, investigation note | Tidak langsung | simpan di document/evidence service |
| Legal decision basis | final decision summary, rule version | Ya, terseleksi | penting untuk defensibility |
| Health/financial/biometric | data sangat sensitif | Hindari keras | butuh kontrol khusus |

Rule sederhana:

> Kalau data tidak diperlukan untuk routing/orchestration, jangan masukkan ke process variable.

---

## 10. Process Variable Security Discipline

### 10.1 Variable sebagai contract minimal

Variable yang baik:

```json
{
  "caseId": "CASE-2026-0000123",
  "agencyCode": "CEA",
  "applicantType": "INDIVIDUAL",
  "riskTier": "MEDIUM",
  "reviewOutcome": "APPROVED",
  "decisionRef": "DEC-2026-983742",
  "ruleSetVersion": "eligibility-rules-v17",
  "tenantId": "cea-prod"
}
```

Variable yang buruk:

```json
{
  "caseId": "CASE-2026-0000123",
  "applicantName": "...",
  "passportNumber": "...",
  "homeAddress": "...",
  "bankAccount": "...",
  "fullApplicationPdfBase64": "...",
  "apiToken": "...",
  "reviewerPassword": "...",
  "allSupportingDocuments": [...]
}
```

### 10.2 Reference-over-payload

Gunakan process variable untuk menunjuk data, bukan membawa semua data.

```text
Process variable:
  caseId
  documentRef
  evidenceBundleRef
  decisionRef
  externalCheckRef

Domain/evidence service:
  full PII
  full document
  encrypted content
  access policy
  legal retention
```

### 10.3 Avoid full variable logging

Jangan lakukan:

```java
log.info("Job variables: {}", job.getVariables());
```

Lebih aman:

```java
log.info(
    "Handling job type={}, processInstanceKey={}, jobKey={}, caseId={}, tenantId={}",
    job.getType(),
    job.getProcessInstanceKey(),
    job.getKey(),
    safe(vars.caseId()),
    safe(vars.tenantId())
);
```

### 10.4 Variable allowlist

Worker sebaiknya deserialize hanya variable yang diperlukan.

```java
public final class ReviewEligibilityInput {
    private String caseId;
    private String tenantId;
    private String applicantType;
    private String riskTier;
}
```

Bukan generic map yang diteruskan ke semua service.

### 10.5 Variable redaction policy

Tetapkan daftar:

```text
Never log:
  password
  token
  secret
  authorization
  nric
  nik
  passportNumber
  bankAccount
  address
  phone
  email jika tidak diperlukan
  documentContent

Log as hash/reference only:
  caseId jika sangat sensitif
  applicantId
  externalReference

Allowed plain:
  processInstanceKey
  jobKey
  bpmnProcessId
  jobType
  tenantId
  non-sensitive status
```

---

## 11. Secret Management untuk Workers dan Connectors

Secret tidak boleh disimpan di:

1. BPMN XML.
2. Process variable.
3. Worker code hardcoded.
4. Git repository.
5. Plain environment variable tanpa governance.
6. Logs.
7. Operate variable view.

Pattern production:

```text
Worker Pod
  │
  ├── obtains service account / workload identity
  │
  ├── reads secret from secret manager / vault / cloud secret store
  │
  ├── caches short-lived token safely
  │
  ├── rotates credential
  │
  └── never returns secret to Zeebe variable
```

Untuk connector:

```text
BPMN connector field:
  secret reference, not secret value

Connector runtime:
  resolves secret
  calls external system
  maps non-sensitive result to variable
```

Governance question:

```text
[ ] Siapa boleh membuat secret?
[ ] Siapa boleh membaca secret?
[ ] Siapa boleh refer secret di BPMN connector?
[ ] Apakah secret reference dapat ditebak?
[ ] Apakah connector output bisa membawa secret balik ke variables?
[ ] Bagaimana secret rotation dilakukan tanpa redeploy process?
```

---

## 12. Java Worker Security Architecture

Worker harus dianggap sebagai privileged automation actor.

### 12.1 Worker principal

Setiap worker app harus punya identity sendiri.

Buruk:

```text
all-workers-prod-client
```

Lebih baik:

```text
eligibility-worker-prod-client
notification-worker-prod-client
payment-worker-prod-client
case-assignment-worker-prod-client
```

Kenapa?

1. Least privilege.
2. Easier revocation.
3. Better audit.
4. Blast radius lebih kecil.
5. Credential rotation lebih aman.

### 12.2 Worker should validate business authorization

Jangan percaya hanya karena job datang dari engine.

```java
public final class ApproveCaseWorker {

    public ApprovalResult handle(ApproveCaseCommand command, WorkflowContext ctx) {
        CaseSnapshot snapshot = caseRepository.get(command.caseId(), ctx.tenantId());

        authorizationService.assertSystemMayApprove(
            ctx.tenantId(),
            "camunda-worker:approve-case",
            snapshot
        );

        decisionPolicy.assertTransitionAllowed(
            snapshot.status(),
            CaseStatus.APPROVED
        );

        return approvalService.approve(command, ctx);
    }
}
```

Worker harus memvalidasi:

1. tenant cocok,
2. case masih dalam state yang benar,
3. command tidak replay invalid,
4. external reference belum diproses,
5. transition legal,
6. actor/system principal diizinkan.

### 12.3 Worker must not leak PII through exception

Buruk:

```java
throw new IllegalArgumentException("Invalid applicant " + applicantDto);
```

Lebih aman:

```java
throw new BusinessValidationException(
    "APPLICANT_VALIDATION_FAILED",
    "Applicant validation failed for caseRef=" + mask(caseId)
);
```

Incident message bisa terlihat di operational tools, jadi error message harus disiplin.

---

## 13. User Task Security

User task adalah titik paling rawan karena manusia membuat keputusan.

### 13.1 Assignment bukan authorization lengkap

Candidate group menentukan siapa yang bisa melihat/claim task pada level workflow/tasklist. Tetapi domain authorization tetap perlu.

Contoh:

```text
candidateGroup = "senior-reviewer"
```

Belum cukup jika rule domain:

```text
senior reviewer hanya boleh region sendiri
senior reviewer tidak boleh kasus yang pernah dia handle sebelumnya
senior reviewer tidak boleh case dengan conflict of interest
```

### 13.2 Complete task must be validated server-side

Jika memakai custom task UI:

```text
Browser -> Custom Task Backend -> Camunda Task API
```

Maka custom backend wajib:

1. authenticate user,
2. check platform access if applicable,
3. check domain authorization,
4. validate task state,
5. validate form input,
6. write domain audit event,
7. complete task with minimal variables,
8. prevent duplicate submit.

Jangan biarkan browser langsung melakukan privileged completion tanpa backend policy enforcement jika domainnya regulated.

### 13.3 Decision evidence

Saat user complete task, audit event minimal:

```json
{
  "eventType": "CASE_REVIEW_COMPLETED",
  "caseId": "CASE-2026-0000123",
  "taskId": "...",
  "processInstanceKey": 2251799813685249,
  "bpmnProcessId": "regulatory_case_review",
  "actorUserId": "u12345",
  "actorDisplayNameSnapshot": "Alice Tan",
  "actorRolesSnapshot": ["SENIOR_REVIEWER"],
  "tenantId": "cea-prod",
  "decision": "APPROVE",
  "reasonCode": "REQUIREMENTS_MET",
  "commentRef": "COMMENT-2026-9912",
  "ruleSetVersion": "review-policy-v12",
  "occurredAt": "2026-06-21T10:15:30+07:00"
}
```

Catatan: comment penuh bisa disimpan di secure domain store, bukan variable bebas.

---

## 14. Operate Security dan Support Boundary

Operate sangat powerful untuk support. Karena itu akses Operate harus dikontrol.

Risiko:

1. Operator melihat process variables sensitif.
2. Operator retry incident tanpa memahami side effect.
3. Operator resolve incident setelah manual variable change tanpa audit domain.
4. Operator cancel process instance yang masih legal-active.
5. Operator modify process instance melewati business control.

Production control:

```text
Read-only operator:
  - view instance
  - view incident metadata
  - no variable edit
  - no retry/modify/cancel

Technical support:
  - retry selected technical incidents
  - no business decision override

Process owner:
  - approve exceptional intervention
  - can request modification via controlled runbook

Break-glass admin:
  - time-limited access
  - approval required
  - audit mandatory
```

Manual intervention harus menghasilkan domain audit event.

```json
{
  "eventType": "MANUAL_PROCESS_INTERVENTION",
  "caseId": "CASE-2026-0000123",
  "processInstanceKey": 2251799813685249,
  "interventionType": "RETRY_INCIDENT",
  "requestedBy": "support.engineer",
  "approvedBy": "process.owner",
  "reasonCode": "EXTERNAL_API_RECOVERED",
  "evidenceRef": "INCIDENT-RUNBOOK-2026-00912",
  "occurredAt": "2026-06-21T11:00:00+07:00"
}
```

---

## 15. Optimize dan Analytics Exposure

Optimize dapat membuka insight yang kuat, tetapi juga bisa membuka data sensitif secara agregat maupun detail.

Risiko:

1. Variable yang terlihat harmless bisa mengungkap protected information jika digabung.
2. Dashboard per team bisa memperlihatkan case type sensitif.
3. Export CSV bisa keluar dari controlled environment.
4. Long retention analytics bisa bertentangan dengan minimization policy.
5. Tenant sync tidak konsisten dapat menyebabkan wrong visibility.

Design principle:

```text
Only export/analyze variables that are intentionally analytics-safe.
```

Variable analytics-safe:

```text
riskTier
caseType
decisionOutcome
slaBucket
processingRegion
submissionChannel
```

Variable unsafe:

```text
fullName
address
nationalId
passportNumber
freeTextComment
medicalCondition
financialAmount if sensitive
exact location if sensitive
```

Untuk sensitive amount, gunakan bucket:

```text
amountBucket = "10K_TO_50K"
```

bukan:

```text
amount = 43872.12
```

---

## 16. Exporters, Secondary Storage, dan Data Replication Risk

Zeebe records dapat diekspor ke Elasticsearch/OpenSearch melalui exporters. Ini penting untuk Operate/Tasklist/Optimize/custom read models.

Namun dari sudut security:

> Exporter memperluas lokasi data.

Data yang awalnya berada di engine stream/state dapat muncul di:

1. Elasticsearch/OpenSearch index.
2. Snapshot/backup ES/OS.
3. Optimize import.
4. Custom audit/read store.
5. Data lake jika diintegrasikan.
6. Monitoring/reporting pipeline.

Prinsip:

1. Treat secondary storage as sensitive data store.
2. Apply RBAC to index access.
3. Encrypt at rest and in transit.
4. Control snapshot access.
5. Define retention and deletion policy.
6. Avoid exporting unnecessary variables.
7. Use filters where appropriate.
8. Do not let BI users query raw indices directly unless governed.

---

## 17. Audit Trail: Apa yang Harus Dicatat?

Audit trail bukan hanya log teknis.

### 17.1 Empat jenis record

| Jenis | Sumber | Tujuan |
|---|---|---|
| Engine record | Zeebe/exporter | reconstruct engine execution |
| Operational log | worker/platform logs | troubleshoot incident |
| Business audit event | domain services | prove business action/decision |
| Evidence record | document/evidence system | prove supporting material |

Keempatnya berbeda dan saling melengkapi.

### 17.2 Business audit event minimal

Untuk regulated workflow, audit event minimal harus menjawab:

1. Apa event-nya?
2. Kapan terjadi?
3. Siapa actor-nya?
4. Actor bertindak dalam role apa?
5. Atas case/entity apa?
6. Pada tenant/agency mana?
7. Sebelum state apa?
8. Setelah state apa?
9. Decision/reason code apa?
10. Rule/policy version apa?
11. Process instance/job/task reference apa?
12. Evidence/document/comment reference apa?
13. Apakah action manual/automated/system?
14. Apakah ada override?
15. Apakah ada approval tambahan?

### 17.3 Contoh audit event untuk automated check

```json
{
  "eventType": "EXTERNAL_ELIGIBILITY_CHECK_COMPLETED",
  "caseId": "CASE-2026-0000123",
  "tenantId": "cea-prod",
  "processInstanceKey": 2251799813685249,
  "jobKey": 2251799813689999,
  "workerType": "eligibility-check-v2",
  "actorType": "SYSTEM",
  "actorId": "eligibility-worker-prod-client",
  "externalSystem": "REGISTRY_X",
  "externalRequestRef": "REQ-777",
  "externalResultRef": "RES-888",
  "outcome": "PASSED",
  "ruleSetVersion": "eligibility-rules-v17",
  "occurredAt": "2026-06-21T10:05:12+07:00"
}
```

### 17.4 Contoh audit event untuk human decision

```json
{
  "eventType": "CASE_DECISION_RECORDED",
  "caseId": "CASE-2026-0000123",
  "tenantId": "cea-prod",
  "processInstanceKey": 2251799813685249,
  "taskDefinitionId": "senior_review",
  "actorType": "USER",
  "actorId": "u12345",
  "actorRoleSnapshot": ["SENIOR_REVIEWER"],
  "decision": "APPROVE",
  "reasonCode": "ALL_REQUIREMENTS_MET",
  "commentRef": "COMMENT-9912",
  "previousCaseState": "UNDER_REVIEW",
  "nextCaseState": "APPROVED",
  "policyVersion": "review-policy-v12",
  "occurredAt": "2026-06-21T10:15:30+07:00"
}
```

---

## 18. Audit Trail vs Event Sourcing vs Zeebe Records

Zeebe internal records mirip event stream, tetapi jangan langsung samakan dengan domain event sourcing.

| Aspek | Zeebe record | Domain audit event |
|---|---|---|
| Owner | workflow engine | business/domain system |
| Fokus | process execution state | business decision evidence |
| Stability | mengikuti engine/version | harus stabil lintas engine/version |
| Audience | operator/engineer | auditor/regulator/business/legal |
| Retention | platform policy | legal/business policy |
| PII policy | depends variable design | domain-controlled |
| Meaning | technical orchestration | business semantic |

Prinsip:

> Gunakan Zeebe records untuk technical reconstruction, tetapi jangan jadikan satu-satunya legal audit source.

---

## 19. Tamper Evidence dan Audit Integrity

Audit defensibility membutuhkan integritas.

Minimal:

1. Append-only audit table/log.
2. No update/delete by application role.
3. Separate write role and read role.
4. Immutable event id.
5. Actor and timestamp recorded server-side.
6. Correlation to processInstanceKey/jobKey/taskKey.
7. Hash of important payload.
8. External evidence reference.
9. Retention policy.
10. Backup and restore audit.

Advanced:

1. Hash chain per case.
2. Periodic Merkle root anchoring.
3. WORM storage.
4. Separate audit database.
5. SIEM forwarding.
6. Cryptographic signing of audit batches.

Contoh hash chain:

```text
audit_event_hash = SHA-256(
  previous_hash + canonical_json(audit_event_payload)
)
```

Ini membuat perubahan historis lebih mudah dideteksi.

---

## 20. Regulatory Defensibility Model

Untuk regulatory workflow, pertanyaan utama bukan hanya:

> “Apakah sistem memproses case?”

Tetapi:

> “Bisakah sistem membuktikan bahwa case diproses sesuai aturan yang berlaku pada saat itu, oleh actor yang berwenang, dalam batas waktu yang benar, dengan evidence yang tepat, dan setiap pengecualian dapat dijelaskan?”

Model defensibility:

```text
Defensible Workflow Decision
  ├── Valid actor
  ├── Valid authority
  ├── Valid process version
  ├── Valid rule/policy version
  ├── Valid data/evidence snapshot
  ├── Valid timing/deadline calculation
  ├── Valid transition
  ├── Valid reason code
  ├── Valid audit event
  ├── Valid external side-effect record
  └── Valid appeal/review trace
```

Jika salah satu hilang, audit risk naik.

---

## 21. Designing Defensible Decision Points

Setiap decision task harus dirancang sebagai controlled decision point.

### 21.1 Decision point metadata

Untuk setiap decision point, definisikan:

```text
Decision Point: Senior Review
BPMN element: senior_review_task
Allowed actors: SENIOR_REVIEWER
Forbidden actors: submitter, previous_checker
Inputs:
  - case summary ref
  - evidence bundle ref
  - eligibility result ref
  - risk tier
Outputs:
  - decision code
  - reason code
  - comment ref
  - escalation flag
Audit:
  - actor snapshot
  - task id
  - decision timestamp
  - policy version
SLA:
  - 5 working days after assignment
Appeal relevance:
  - yes
```

### 21.2 Decision output harus structured

Buruk:

```text
comment = "ok approve"
```

Lebih baik:

```json
{
  "decision": "APPROVE",
  "reasonCode": "ALL_REQUIREMENTS_MET",
  "commentRef": "COMMENT-9912"
}
```

Free-text boleh ada, tetapi jangan menjadi satu-satunya source of truth.

### 21.3 Policy/rule version harus dicatat

Jika peraturan berubah, keputusan lama harus dievaluasi berdasarkan versi aturan saat keputusan dibuat.

```json
{
  "policyVersion": "review-policy-v12",
  "ruleSetVersion": "eligibility-rules-v17",
  "formVersion": "senior-review-form-v5",
  "processVersionTag": "2026.06.1"
}
```

---

## 22. Data Minimization Pattern

### 22.1 Bad pattern: Process-as-data-lake

```text
Every API result -> process variable
Every document -> process variable
Every comment -> process variable
Every user profile -> process variable
Every external response -> process variable
```

Akibat:

1. Operate jadi penuh PII.
2. Exported records besar.
3. Optimize raw data sensitif.
4. Backup berat.
5. Right-to-delete sulit.
6. Logs mudah bocor.
7. Incident troubleshooting berisiko.

### 22.2 Good pattern: Process-as-control-plane

```text
Process variable:
  status/control/routing metadata/reference id

Domain store:
  business state
  detailed PII
  evidence
  comments
  documents
  policy snapshot

Audit store:
  immutable business events

Object/document store:
  binary evidence
```

Diagram:

```text
Zeebe Process Instance
  ├── caseId
  ├── riskTier
  ├── decisionRef
  ├── evidenceBundleRef
  └── policyVersion

Case DB
  ├── full applicant profile
  ├── case state
  ├── reviewer assignment
  └── domain constraints

Evidence Service
  ├── documents
  ├── attachments
  └── encrypted blobs

Audit Store
  ├── decision events
  ├── actor snapshots
  └── intervention events
```

---

## 23. Right to Delete vs Audit Retention

Regulated systems often face tension:

```text
Privacy law:
  delete/minimize personal data

Regulatory/legal requirement:
  retain audit evidence
```

Design approach:

1. Do not put raw PII in process variables.
2. Store PII in domain/evidence store with retention classification.
3. Store audit events with minimized identifiers or pseudonymized references where possible.
4. Separate identity snapshot from sensitive profile detail.
5. Use deletion/anonymization workflow for expired personal data.
6. Keep non-PII legal audit facts if legally required.
7. Define retention per data class, not one global retention.

Example:

```text
Process variable retention:
  short/operational

Operate/Tasklist/Optimize retention:
  operational/reporting

Audit event retention:
  legal/regulatory

Evidence/document retention:
  legal category based

PII profile retention:
  privacy basis based
```

---

## 24. Secure Logging for Java Workers

### 24.1 Required log fields

Worker logs should include:

```text
correlationId
tenantId
bpmnProcessId
processInstanceKey
jobKey
jobType
caseId/reference
operationName
attempt/retry context
outcome
latency
```

### 24.2 Forbidden log fields

Do not log:

```text
full variables
tokens
passwords
authorization headers
full external API responses
full applicant profile
documents
free-text comments if sensitive
stack traces containing sensitive payload
```

### 24.3 Structured log example

```java
log.info(
    "event=worker_completed tenantId={} bpmnProcessId={} processInstanceKey={} jobKey={} jobType={} caseId={} operation={} outcome={} latencyMs={}",
    ctx.tenantId(),
    ctx.bpmnProcessId(),
    ctx.processInstanceKey(),
    ctx.jobKey(),
    ctx.jobType(),
    mask(ctx.caseId()),
    "eligibility_check",
    "PASSED",
    latencyMs
);
```

### 24.4 Secure exception logging

```java
try {
    handler.handle(command, ctx);
} catch (ExternalSystemException ex) {
    log.warn(
        "event=worker_external_failure tenantId={} processInstanceKey={} jobKey={} externalSystem={} errorCode={} retryable={}",
        ctx.tenantId(), ctx.processInstanceKey(), ctx.jobKey(),
        ex.systemCode(), ex.safeErrorCode(), ex.retryable()
    );
    throw ex;
}
```

Do not log raw HTTP body unless explicitly redacted.

---

## 25. Secure Tracing

Distributed tracing sering bocor PII lewat span attributes.

Allowed span attributes:

```text
camunda.process_instance_key
camunda.job_key
camunda.bpmn_process_id
camunda.job_type
tenant.id
case.ref_hash
external.system
external.operation
```

Avoid:

```text
applicant.name
passport.number
address
email
phone
document.content
authorization.header
raw.request.body
raw.response.body
```

Trace sampling juga harus memperhatikan classification. Jangan mengirim trace PROD sensitive ke vendor tanpa review data protection.

---

## 26. Secure Incident Handling

Incident handling bukan hanya technical action. Dalam regulated workflow, incident handling bisa mempengaruhi case outcome.

### 26.1 Incident classification

| Class | Example | Handler |
|---|---|---|
| Technical transient | external API down | support/worker retry |
| Technical config | wrong endpoint/credential | platform/app owner |
| Data quality | missing required variable | business ops + app owner |
| Business conflict | invalid transition | process owner |
| Security | unauthorized action detected | security incident team |
| Compliance | deadline breach | process owner + compliance |

### 26.2 Retry safety decision

Sebelum retry:

```text
[ ] Apakah external side effect mungkin sudah terjadi?
[ ] Apakah worker idempotent?
[ ] Apakah operation ledger menunjukkan success/pending/fail?
[ ] Apakah retry akan duplicate notification/payment/decision?
[ ] Apakah variable sudah diperbaiki dengan audit?
[ ] Apakah approval diperlukan?
```

### 26.3 Manual variable correction

Jika variable diperbaiki manual:

1. Jangan hanya edit variable.
2. Catat reason.
3. Catat before/after dalam secure audit store.
4. Link ke ticket/change request.
5. Pastikan correction tidak menyembunyikan root cause.
6. Pastikan actor authorized.

---

## 27. Process Instance Modification and Compliance Risk

Process instance modification adalah fitur powerful. Tetapi dalam regulated system, modification dapat dianggap bypass process.

Contoh valid:

1. BPMN bug menyebabkan token stuck.
2. External system incident memerlukan recovery path.
3. Migration/cutover controlled.
4. Process model salah deploy dan perlu repair.

Contoh berbahaya:

1. Skip approval task.
2. Jump langsung ke approved.
3. Cancel escalation tanpa reason.
4. Remove incident tanpa fixing data.
5. Bypass maker-checker.

Policy:

```text
No production process instance modification without:
  - ticket id
  - reason code
  - affected instance list
  - risk assessment
  - approval
  - before/after snapshot
  - audit event
  - post-action validation
```

---

## 28. Secure Deployment Governance

BPMN model adalah executable artifact. Jadi harus diperlakukan seperti code.

### 28.1 Risks

1. BPMN menghapus approval task.
2. BPMN mengubah candidate group.
3. BPMN mengubah timer deadline.
4. BPMN mengubah connector endpoint.
5. BPMN mengubah variable mapping sehingga PII terekspos.
6. BPMN mengubah error path sehingga rejection jadi approval.

### 28.2 Required controls

```text
[ ] BPMN in version control
[ ] Pull request review
[ ] Diff review for BPMN XML and rendered diagram
[ ] Automated model validation
[ ] Security review for connectors/secrets
[ ] Variable classification review
[ ] Deployment approval
[ ] Release bundle version
[ ] Rollback plan
[ ] Worker compatibility check
[ ] Process version tag
[ ] Deployment ledger
```

### 28.3 Deployment ledger

```json
{
  "deploymentId": "DEP-2026-06-21-001",
  "environment": "PROD",
  "bpmnProcessId": "regulatory_case_review",
  "versionTag": "2026.06.1",
  "artifactHash": "sha256:...",
  "deployedBy": "cicd-prod",
  "approvedBy": ["process-owner", "security-reviewer"],
  "changeRequestId": "CR-2026-1088",
  "deployedAt": "2026-06-21T22:00:00+07:00"
}
```

---

## 29. Connector Security

Connectors reduce boilerplate but increase configuration security risk.

Review every connector for:

1. Endpoint allowlist.
2. Secret references.
3. Authentication method.
4. Input variable mapping.
5. Output variable mapping.
6. Retry behavior.
7. Error mapping.
8. Timeout.
9. Data classification.
10. Tenant-specific credential.
11. Observability fields.
12. Whether Java worker would be safer.

Anti-pattern:

```text
HTTP connector calls arbitrary URL from process variable
```

Risk:

1. SSRF-like behavior.
2. Data exfiltration.
3. Uncontrolled external calls.
4. Tenant escape.

Better:

```text
connector endpoint selected from approved config key
process variable cannot directly define arbitrary URL
```

---

## 30. Message and Webhook Security

Inbound messages can start or advance processes. They are security-sensitive.

Risks:

1. Unauthorized process start.
2. Replay attack.
3. Duplicate message.
4. Wrong tenant correlation.
5. Payload injection.
6. Message correlation to wrong instance.
7. External callback spoofing.

Controls:

```text
[ ] authenticate sender
[ ] verify signature if webhook
[ ] validate timestamp/nonce
[ ] enforce replay protection
[ ] validate tenant
[ ] validate correlation key ownership
[ ] validate payload schema
[ ] deduplicate message id
[ ] store inbound message audit
[ ] publish only minimal process variables
```

Example inbound callback design:

```text
External System
  -> API Gateway
  -> Callback Backend
      - authenticate/signature verify
      - tenant validation
      - payload schema validation
      - dedup message id
      - write callback ledger
      - publish Camunda message
```

Do not expose Camunda message publish API directly to arbitrary external systems.

---

## 31. Task Completion API Security

If custom UI completes user tasks:

```text
Browser -> Backend -> Camunda API
```

Backend must not merely proxy.

It should enforce:

1. user identity,
2. task existence,
3. task assignment/candidate relation,
4. domain authorization,
5. case state,
6. decision validity,
7. form schema version,
8. CSRF/session protection if browser-based,
9. duplicate submit protection,
10. audit event write,
11. minimal variable completion.

Pseudo-flow:

```java
public CompleteReviewResponse completeReview(
        AuthenticatedUser user,
        CompleteReviewRequest request
) {
    UserTask task = taskClient.getTask(request.taskId());
    CaseSnapshot caseSnapshot = caseService.get(request.caseId());

    taskAuthorization.assertMayComplete(user, task);
    domainAuthorization.assertMayDecide(user, caseSnapshot, request.decision());
    formValidator.validate(request.formVersion(), request.payload());
    duplicateSubmitGuard.assertNotProcessed(request.submitId());

    AuditEvent event = auditService.recordDecision(user, task, caseSnapshot, request);

    camundaTaskClient.complete(task.id(), Map.of(
        "decision", request.decision().name(),
        "reasonCode", request.reasonCode(),
        "decisionRef", event.eventId()
    ));

    return new CompleteReviewResponse(event.eventId());
}
```

---

## 32. Data Retention Strategy

Retention harus dibagi per store:

| Store | Isi | Retention basis |
|---|---|---|
| Zeebe engine state/log | active orchestration state | operational/recovery |
| Operate indices | operational process view | support window |
| Tasklist data | human task view | operational/task history |
| Optimize data | analytics | reporting/KPI |
| Domain DB | business state | business/legal |
| Audit store | decision evidence | legal/regulatory |
| Evidence store | documents | legal category |
| Logs/traces | troubleshooting | short operational/security |
| Backups | disaster recovery | RPO/RTO/legal |

Do not use a single retention policy for everything.

Key questions:

```text
[ ] Berapa lama active process bisa berjalan?
[ ] Berapa lama operator perlu Operate visibility?
[ ] Berapa lama audit evidence harus disimpan?
[ ] Kapan PII harus dihapus/anonymized?
[ ] Apakah analytics boleh menyimpan historical variables?
[ ] Apakah backup retention melebihi privacy retention?
[ ] Bagaimana restore memperlakukan data yang seharusnya sudah expired?
```

---

## 33. Encryption and Network Security

Minimal production expectations:

1. TLS for external and internal sensitive traffic.
2. Secure ingress with authentication boundary.
3. mTLS/service mesh if required by organization.
4. Encryption at rest for broker storage if supported by platform/storage layer.
5. Encryption at rest for Elasticsearch/OpenSearch.
6. Encryption for backups/snapshots.
7. Secret manager integration.
8. Network policies limiting worker access.
9. Egress control for connectors/workers.
10. Private endpoints for internal services.

Worker network policy example concept:

```text
eligibility-worker may call:
  - Camunda Gateway
  - Case DB
  - Registry API
  - Secret Manager
  - Observability collector

eligibility-worker may not call:
  - arbitrary internet
  - unrelated tenant database
  - admin APIs
  - object store buckets outside scope
```

---

## 34. Principle of Least Privilege Matrix

Example matrix:

| Principal | Camunda permission | Domain permission | Infra permission |
|---|---|---|---|
| reviewer-user | claim/complete own group tasks | decide eligible cases only | none |
| supervisor-user | view/escalated task actions | approve override | none |
| support-readonly | view Operate incidents | none | read logs |
| support-retry | retry technical incidents | no business decision | read logs |
| deployment-pipeline | deploy process | none | read artifact secret |
| eligibility-worker | activate/complete eligibility jobs | read case, write check result | read registry credential |
| notification-worker | activate/complete notification jobs | read notification ref | email API credential |
| audit-reader | read audit store | read-only | none |
| platform-admin | manage cluster | no case decision | infra admin |

Important: platform-admin should not automatically be business decision maker.

---

## 35. Secure Variable Mapping in BPMN

Input/output mapping can accidentally expose or overwrite sensitive data.

Bad output mapping:

```text
result -> entire worker result object
```

If result contains:

```json
{
  "decision": "APPROVE",
  "rawExternalResponse": { ... sensitive ... },
  "token": "...",
  "debug": "..."
}
```

Then sensitive fields may enter process variables.

Better:

```text
result.decision -> decision
result.decisionRef -> decisionRef
result.riskTier -> riskTier
```

Use allowlist mapping.

Review every BPMN mapping:

```text
[ ] Does this mapping write PII?
[ ] Does this mapping overwrite global variable accidentally?
[ ] Does this mapping expose connector response?
[ ] Does this mapping include free text?
[ ] Does Optimize need this variable?
[ ] Is variable name stable and versioned?
```

---

## 36. Secure Error Message Design

Error messages are visible in incidents and logs.

Bad:

```text
Failed to validate applicant John Tan passport E1234567 with payload {...}
```

Good:

```text
VALIDATION_FAILED: Applicant validation failed for caseRef=CASE-****-0123, reasonCode=MISSING_REQUIRED_FIELD
```

Error payload structure:

```json
{
  "errorCode": "EXTERNAL_REGISTRY_TIMEOUT",
  "retryable": true,
  "safeMessage": "Registry check timed out",
  "diagnosticRef": "DIAG-2026-00091"
}
```

Detailed sensitive diagnostic can be stored in restricted support system, not in Camunda variable/incident message.

---

## 37. Security Testing Strategy

Security testing for Camunda 8 workflow should include:

### 37.1 Authorization tests

```text
[ ] unauthorized user cannot claim task
[ ] candidate group user can claim only eligible tasks
[ ] user cannot complete task for another tenant
[ ] submitter cannot approve own case
[ ] support cannot perform business decision
[ ] worker credential cannot deploy process
[ ] deployment credential cannot complete tasks
```

### 37.2 Variable leakage tests

```text
[ ] no forbidden fields in variables after each task
[ ] no token/password in variables
[ ] no full document content in variables
[ ] no raw external response in variables
[ ] no forbidden fields in Optimize-exported variables
```

### 37.3 Log/tracing tests

```text
[ ] logs do not contain PII patterns
[ ] traces do not contain sensitive span attributes
[ ] exception messages are safe
[ ] worker never logs full variable map
```

### 37.4 Message/webhook tests

```text
[ ] unauthenticated callback rejected
[ ] wrong tenant callback rejected
[ ] replayed message ignored
[ ] duplicate message id deduplicated
[ ] wrong correlation key rejected
```

### 37.5 Incident/modification tests

```text
[ ] retry requires idempotency
[ ] manual correction creates audit event
[ ] process modification is captured in intervention ledger
[ ] cancellation requires reason
```

---

## 38. Java Secure Coding Patterns for Workers

### 38.1 Safe command object

```java
public final class EligibilityCheckCommand {
    private final String tenantId;
    private final String caseId;
    private final String applicantType;
    private final String riskTier;

    public EligibilityCheckCommand(
            String tenantId,
            String caseId,
            String applicantType,
            String riskTier
    ) {
        this.tenantId = requireNonBlank(tenantId, "tenantId");
        this.caseId = requireNonBlank(caseId, "caseId");
        this.applicantType = requireNonBlank(applicantType, "applicantType");
        this.riskTier = requireNonBlank(riskTier, "riskTier");
    }

    public String tenantId() { return tenantId; }
    public String caseId() { return caseId; }
    public String applicantType() { return applicantType; }
    public String riskTier() { return riskTier; }

    private static String requireNonBlank(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new SafeValidationException("MISSING_" + field.toUpperCase());
        }
        return value;
    }
}
```

### 38.2 Redactor utility

```java
public final class Redactor {
    private Redactor() {}

    public static String maskReference(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "****" + value.substring(value.length() - 4);
    }

    public static String safeEnum(String value) {
        if (value == null) return "null";
        return value.replaceAll("[^A-Z0-9_\\-]", "_");
    }
}
```

### 38.3 Audit event writer

```java
public interface AuditEventWriter {
    void append(AuditEvent event);
}

public final class AuditEvent {
    private final String eventId;
    private final String eventType;
    private final String tenantId;
    private final String caseId;
    private final Long processInstanceKey;
    private final Long jobKey;
    private final String actorType;
    private final String actorId;
    private final String outcome;
    private final String reasonCode;
    private final String policyVersion;
    private final Instant occurredAt;

    // constructor/getters omitted for brevity
}
```

### 38.4 Worker safe failure mapping

```java
try {
    EligibilityResult result = service.check(command, ctx);
    auditWriter.append(AuditEvents.eligibilityCompleted(command, ctx, result));
    completeJob(job, result.toProcessVariables());
} catch (RetryableExternalException ex) {
    failJob(job, ex.safeMessage(), remainingRetries(job), backoff(ex));
} catch (BusinessRuleException ex) {
    throwBpmnError(job, ex.errorCode(), ex.safeMessage(), ex.safeVariables());
} catch (Exception ex) {
    log.error(
        "event=worker_unexpected_error tenantId={} processInstanceKey={} jobKey={} jobType={} errorClass={}",
        ctx.tenantId(), ctx.processInstanceKey(), ctx.jobKey(), ctx.jobType(), ex.getClass().getName()
    );
    failJob(job, "UNEXPECTED_WORKER_FAILURE", 0, Duration.ZERO);
}
```

Note: actual API names differ depending on client/starter version. The design principle is stable.

---

## 39. Regulatory Case Example

Scenario:

```text
Application submitted
  -> automated eligibility check
  -> officer review
  -> senior approval if high risk
  -> decision notification
  -> appeal window
  -> enforcement if breach detected
```

### 39.1 Minimal process variables

```json
{
  "tenantId": "cea-prod",
  "caseId": "CASE-2026-0000123",
  "caseType": "LICENSE_APPLICATION",
  "riskTier": "HIGH",
  "eligibilityCheckRef": "CHK-2026-0098",
  "reviewDecisionRef": "DEC-2026-0111",
  "policyVersion": "licensing-policy-v22",
  "appealDeadline": "2026-07-21"
}
```

### 39.2 Domain data outside variables

```text
Case DB:
  applicant details
  application details
  current domain state
  assignment history

Evidence service:
  documents
  attachments
  external check report

Audit store:
  submission event
  eligibility check event
  review decision event
  senior approval event
  notification event
  appeal event
```

### 39.3 Defensible decision proof package

When regulator asks:

> Why was CASE-2026-0000123 approved?

System can produce:

```text
1. Process version: licensing-review:2026.06.1
2. Policy version: licensing-policy-v22
3. Rule set: eligibility-rules-v17
4. Eligibility result ref: CHK-2026-0098
5. Evidence bundle ref: EVD-2026-0442
6. Officer decision event: DEC-2026-0111
7. Senior approval event: APR-2026-0121
8. Actor role snapshots
9. Deadlines and SLA calculations
10. Notification record
11. Any manual intervention record
```

This is defensibility.

---

## 40. Anti-Patterns

### 40.1 Full DTO in variables

```text
applicationDto -> process variable
```

Usually leaks PII and creates schema coupling.

### 40.2 Raw external API response in variables

External response may include sensitive fields, vendor debug data, or tokens.

### 40.3 Human task as authorization

Candidate group alone is not enough for complex domain rules.

### 40.4 Operate as legal audit

Operate is operational view, not necessarily legal evidence store.

### 40.5 Admin wildcard for support

Support access should be role-specific and audited.

### 40.6 No audit for manual correction

Manual variable edit without business audit destroys defensibility.

### 40.7 BPMN not treated as code

Unreviewed BPMN change can bypass controls.

### 40.8 Optimizing analytics by exporting everything

This creates data protection and retention risk.

### 40.9 Worker logs full job payload

This is common and dangerous.

### 40.10 Secret in connector field

Always use secret reference/governed secret storage.

---

## 41. Design Review Checklist

### 41.1 Access control

```text
[ ] Human users authenticated through approved IdP
[ ] M2M clients separated per application/purpose
[ ] Least privilege applied
[ ] PROD access separated from lower environments
[ ] Orchestration Cluster authorization reviewed
[ ] Management Identity access reviewed
[ ] Tenant permissions reviewed
[ ] Break-glass process defined
```

### 41.2 Variables and data

```text
[ ] Variable inventory exists
[ ] Each variable has data classification
[ ] No secrets in variables
[ ] No raw PII unless explicitly approved
[ ] No documents/blobs in variables
[ ] Output mappings are allowlisted
[ ] Optimize variables are analytics-safe
[ ] Retention policy defined
```

### 41.3 Workers

```text
[ ] Worker principal is dedicated
[ ] Worker secrets are not hardcoded
[ ] Worker validates tenant/domain state
[ ] Worker is idempotent
[ ] Worker logs are redacted
[ ] Worker error messages are safe
[ ] External side effects have ledger
[ ] Audit events are written for business actions
```

### 41.4 Human tasks

```text
[ ] Candidate groups defined
[ ] Domain authorization enforced server-side
[ ] Conflict-of-interest rule enforced
[ ] Decision output structured
[ ] Reason code required
[ ] Actor role snapshot captured
[ ] Form version captured
[ ] Task completion audited
```

### 41.5 Operations

```text
[ ] Operate access controlled
[ ] Retry policy documented
[ ] Manual modification policy exists
[ ] Incident classification exists
[ ] Support runbook exists
[ ] Audit event for intervention exists
[ ] Projection lag understood
```

### 41.6 Compliance

```text
[ ] Audit store append-only
[ ] Audit retention defined
[ ] Evidence retention defined
[ ] PII deletion/anonymization policy defined
[ ] Backup retention reviewed
[ ] Export/report access controlled
[ ] Security testing automated where possible
```

---

## 42. Production Readiness Questions

Ask these before go-live:

1. Can we prove who completed each human task?
2. Can we prove the actor was authorized at that time?
3. Can we prove which process version ran?
4. Can we prove which rule/policy version was used?
5. Can we reconstruct external checks without raw sensitive data in variables?
6. Can we show why a timer escalation happened?
7. Can we show why an incident was retried?
8. Can we detect unauthorized message replay?
9. Can we prevent duplicate task submit?
10. Can we prevent support from bypassing business approval?
11. Can we explain every manual process modification?
12. Can we delete/minimize PII without destroying legal audit facts?
13. Can we restrict Optimize dashboards by tenant/role?
14. Can we rotate worker credentials without outage?
15. Can we restore backup without resurrecting improperly expired data?
16. Can we detect if audit data was altered?
17. Can we produce evidence package for appeal/dispute?
18. Can we demonstrate least privilege to security reviewer?
19. Can we run security regression tests in CI?
20. Can we survive a leaked worker credential with limited blast radius?

---

## 43. Staff-Level Heuristics

1. **Put control metadata in Zeebe, put sensitive facts in domain stores.**
2. **Treat BPMN as executable policy, not just a diagram.**
3. **Treat process variables as replicated data.**
4. **Treat worker credentials as high-value secrets.**
5. **Never depend on UI-only authorization for domain decisions.**
6. **Never make Operate your only audit system.**
7. **Every manual intervention must leave a business audit event.**
8. **Every human decision should have structured reason code and actor snapshot.**
9. **Every external side effect should have an operation ledger.**
10. **Every tenant boundary must be enforced in engine, worker, DB, logs, metrics, and audit.**
11. **Every process deployment is a production code release.**
12. **Every variable should justify its existence.**
13. **Every dashboard can become a data leak.**
14. **Every retry can become duplicate side effect if idempotency is weak.**
15. **Every support permission can become business bypass if not governed.**

---

## 44. How This Connects to Previous Parts

This part builds directly on:

1. Part 007 — Worker correctness and idempotency.
2. Part 008 — Variables and payload discipline.
3. Part 017 — Exporters and read-side architecture.
4. Part 018 — Operate and incident triage.
5. Part 019 — Tasklist and human work management.
6. Part 021 — Identity, authorization, tenancy.
7. Part 027 — Process versioning and deployment governance.
8. Part 030 — Regulatory lifecycle modelling.
9. Part 031 — Multi-tenancy and enterprise isolation.

The key addition here is:

> Security/compliance is not one component. It is an invariant across process model, variables, workers, users, exporters, storage, deployment, and operations.

---

## 45. Ringkasan

Camunda 8 / Zeebe can be used for serious regulated workflows, but only if designed with strong security and compliance boundaries.

Core conclusions:

1. Process variables are not a safe place for arbitrary sensitive data.
2. Operate is operationally useful but should not be the only legal audit system.
3. Tasklist candidate groups are not a replacement for domain authorization.
4. Java workers must be treated as privileged automation actors.
5. Exporters and secondary storage expand data exposure.
6. Optimize and analytics require variable governance.
7. Manual incident handling and process modification must be audited.
8. BPMN deployment must be governed like code release.
9. Defensible regulatory workflow requires actor, authority, rule version, evidence, timing, and decision trace.
10. Top-tier engineering means designing proof, not only execution.

A production-grade Camunda 8 system should be able to answer:

```text
Who did what,
under which authority,
on which case,
using which process/rule version,
with which evidence,
at what time,
with what result,
and how do we prove it later?
```

If the system can answer that, it is moving from basic workflow automation toward defensible process orchestration.

---

## 46. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Camunda 8 Docs — Identity and access management overview.
2. Camunda 8 Docs — Orchestration Cluster authorization.
3. Camunda 8 Docs — Management Identity.
4. Camunda 8 Docs — Audit log.
5. Camunda 8 Docs — Multi-tenancy.
6. Camunda 8 Docs — User tasks and Tasklist access restrictions.
7. Camunda 8 Docs — Exporters, Elasticsearch/OpenSearch exporter, secondary storage.
8. Camunda 8 Docs — Data retention.
9. Camunda 8 Docs — Variables and data handling.
10. Camunda 8 Docs — Operate, incidents, and process instance operations.

---

## 47. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-033.md
```

Judul berikutnya:

```text
Part 033 — Anti-Patterns, Design Smells, and Production Failure Case Studies
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-031.md">⬅️ Part 031 — Multi-Tenancy, Multi-Region, Environment Strategy, and Enterprise Isolation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-033.md">Part 033 — Anti-Patterns, Design Smells, and Production Failure Case Studies ➡️</a>
</div>
