# Learn Java BPMN & Camunda Process Orchestration Engineering

## Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Bagian: `08`  
> Topik: Process variables, data contract, variable scope, serialization, input/output mapping, governance, schema evolution, sensitive data, dan production-grade data handling  
> Target: Java engineer yang ingin memahami workflow data secara arsitektural, operasional, dan defensible untuk sistem enterprise/regulatory.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membahas:

1. kenapa process orchestration berbeda dari CRUD;
2. BPMN sebagai execution contract;
3. elemen BPMN inti;
4. disiplin modeling production-ready;
5. perbedaan Camunda 7 dan Camunda 8;
6. runtime internal Zeebe;
7. reliability job worker: idempotency, retry, backoff, poison job.

Sekarang kita masuk ke salah satu area yang sering diremehkan tetapi sering menjadi sumber masalah production paling mahal: **process variables**.

Banyak engineer awalnya melihat process variable sebagai hal sederhana:

```text
processInstance.setVariable("status", "APPROVED")
```

atau:

```json
{
  "applicationId": "APP-2026-0001",
  "applicantName": "Alice",
  "amount": 1000,
  "approved": true
}
```

Tetapi dalam real production workflow, variable bukan sekadar key-value map. Variable adalah:

1. kontrak data antar BPMN element;
2. kontrak data antara engine dan worker;
3. input untuk gateway, timer, user task, DMN, message correlation, dan audit;
4. state runtime yang dapat hidup lebih lama daripada deployment code;
5. data yang mungkin terlihat di tools operasional;
6. sumber risiko security/privacy jika salah desain;
7. sumber coupling besar jika tidak dikelola;
8. sumber incident jika schema berubah tanpa strategi;
9. sumber performance degradation jika dipakai sebagai database kedua.

Camunda 8 documentation menjelaskan bahwa process variables adalah key-value pairs yang menjadi bagian dari process instance, dan job worker dapat membaca serta memodifikasi variable ketika menyelesaikan job. Camunda juga menekankan bahwa variable harus dipakai secara ringan dan meaningful, menyimpan data yang relevan untuk process instance saja, bukan seluruh data domain.  

Mental model utama part ini:

```text
Process variable is not the truth of your business domain.
Process variable is the minimal execution context needed by the process engine and workers.
```

Dalam bahasa yang lebih tajam:

```text
Domain database owns business truth.
Workflow engine owns process progression state.
Process variables are the contract bridge between them.
```

---

## 1. Apa Itu Process Variable?

Secara sederhana, process variable adalah data bernama yang melekat pada process instance atau scope tertentu.

Contoh:

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-2026-0009",
  "riskLevel": "HIGH",
  "requiresManagerApproval": true,
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Variable ini dapat dipakai oleh:

1. gateway condition;
2. user task form;
3. service task worker;
4. timer configuration;
5. DMN decision;
6. connector;
7. message correlation;
8. subprocess input/output mapping;
9. audit/operate tooling;
10. incident repair.

Tetapi variable bukan:

1. replacement untuk normalized database;
2. document store;
3. cache besar;
4. blob storage;
5. full audit trail;
6. tempat menyimpan semua request/response eksternal;
7. tempat menyimpan secret;
8. tempat menyimpan semua field form karena “nanti mungkin dibutuhkan”.

Perbedaan ini fundamental.

---

## 2. Mental Model: Variable sebagai Execution Context, Bukan Domain Store

Bayangkan sebuah proses regulatory application:

```text
Submit Application
  -> Validate Completeness
  -> Risk Scoring
  -> Officer Review
  -> Manager Approval if High Risk
  -> Issue Decision
  -> Notify Applicant
```

Domain database mungkin menyimpan:

```text
APPLICATION
APPLICATION_PARTY
APPLICATION_DOCUMENT
APPLICATION_RISK_ASSESSMENT
APPLICATION_DECISION
CASE_ASSIGNMENT
AUDIT_TRAIL
NOTIFICATION_LOG
```

Process variable seharusnya menyimpan minimal data seperti:

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-2026-0091",
  "riskLevel": "HIGH",
  "requiresManagerApproval": true,
  "decisionCode": "APPROVED_WITH_CONDITION"
}
```

Kenapa tidak menyimpan seluruh application payload?

Karena process engine perlu mengatur flow, bukan menjadi authoritative source untuk semua data bisnis.

Jika semua data form, document metadata, applicant profile, assessment history, dan notification response disimpan sebagai variable, maka workflow engine menjadi database kedua. Akibatnya:

1. ada dua sumber kebenaran;
2. schema evolution sulit;
3. variable menjadi besar;
4. incident repair menjadi berisiko;
5. audit menjadi ambigu;
6. sensitive data tersebar;
7. Operate/Tasklist bisa menampilkan data yang tidak seharusnya;
8. migration process definition menjadi berat;
9. performance engine turun;
10. worker semakin coupled ke struktur payload besar.

Top 1% engineer tidak bertanya:

```text
Can I put this data into process variables?
```

Mereka bertanya:

```text
Does the process engine need this data to decide, wait, correlate, or operate?
```

Jika tidak, simpan di domain database dan taruh ID/reference di variable.

---

## 3. Data Ownership: Domain State vs Process State

Kesalahan paling umum adalah mencampur **domain state** dan **process state**.

### 3.1 Domain State

Domain state adalah kebenaran bisnis entity.

Contoh:

```text
Application.status = UNDER_REVIEW
Application.riskLevel = HIGH
Application.decision = APPROVED
Application.documents = [...]
Application.lastUpdatedBy = officer123
```

Domain state harus dimiliki oleh domain service/database.

### 3.2 Process State

Process state adalah posisi instance dalam workflow.

Contoh:

```text
Process instance sedang menunggu Officer Review user task.
Timer SLA akan expire 3 hari lagi.
Service task Notify Applicant gagal 2 kali.
Boundary escalation event aktif.
```

Process state dimiliki oleh engine.

### 3.3 Process Variable

Process variable berada di antara keduanya.

Contoh:

```json
{
  "applicationId": "APP-2026-0001",
  "riskLevel": "HIGH",
  "requiresEscalation": false
}
```

Variable membantu process berjalan, tetapi bukan pengganti domain state.

### 3.4 Design Rule

Gunakan rule ini:

```text
If the data is needed to reconstruct business truth, store it in the domain database.
If the data is needed to route or execute the process, store minimal projection in process variables.
If the data is large or sensitive, store a reference in process variables.
```

Contoh:

| Data | Simpan sebagai process variable? | Alasan |
|---|---:|---|
| `applicationId` | Ya | Correlation dan lookup domain data |
| `caseId` | Ya | Operability dan audit linking |
| `riskLevel` | Ya | Gateway routing |
| Full applicant profile | Tidak | Domain data, sensitive, besar |
| Document binary/base64 | Tidak | Gunakan document storage reference |
| JWT/API token | Tidak | Secret, tidak boleh masuk variable |
| External API raw response besar | Tidak | Simpan ringkasan/reference |
| `requiresManagerApproval` | Ya | Gateway decision |
| `lastOfficerComment` | Biasanya tidak / hati-hati | Bisa sensitive; domain/audit lebih cocok |
| `notificationId` | Ya | Tracking side effect |
| Email body lengkap | Tidak | Sensitive/large; simpan notification log reference |

---

## 4. Variable Lifecycle

Process variable biasanya lahir dari salah satu sumber berikut:

1. payload saat start process instance;
2. output dari service task worker;
3. completion dari user task;
4. result dari DMN/business rule task;
5. message correlation payload;
6. connector output;
7. subprocess output mapping;
8. manual repair operation;
9. migration/transformation utility.

Variable kemudian dapat:

1. dibaca oleh element berikutnya;
2. dipakai dalam expression;
3. dipakai untuk gateway condition;
4. diubah oleh worker;
5. dibatasi scope-nya;
6. dipropagasikan ke parent scope;
7. dihapus atau overwritten;
8. tetap ada sampai process instance selesai;
9. masuk ke history/exporter/read model tergantung konfigurasi platform.

Contoh lifecycle sederhana:

```text
Start Process
  input:
    applicationId
    applicantType

Validate Completeness Worker
  reads:
    applicationId
  writes:
    isComplete
    missingDocumentCodes

Exclusive Gateway
  reads:
    isComplete

Risk Scoring Worker
  reads:
    applicationId
  writes:
    riskLevel
    requiresManagerApproval

Manager Approval User Task
  reads:
    applicationId
    riskLevel
  writes:
    managerDecision
    managerDecisionReasonCode
```

Variable yang baik memiliki lifecycle yang jelas.

Variable yang buruk muncul tiba-tiba, berubah sembarangan, dan dipakai di banyak tempat tanpa kontrak.

---

## 5. Variable Scope

Scope adalah wilayah hidup dan wilayah visibilitas variable.

Secara mental, process instance memiliki tree of scopes:

```text
Process Instance Scope
├── Task Scope A
├── Subprocess Scope B
│   ├── Task Scope B1
│   └── Task Scope B2
└── Multi-instance Scope C
    ├── Instance 1 Scope
    ├── Instance 2 Scope
    └── Instance 3 Scope
```

Variable dapat berada di:

1. process-level/global scope;
2. subprocess scope;
3. task/local scope;
4. multi-instance item scope.

### 5.1 Global Process Variables

Global variables dapat dibaca oleh banyak element dalam process.

Contoh:

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-2026-0010",
  "riskLevel": "HIGH"
}
```

Gunakan untuk data yang benar-benar menjadi konteks proses lintas step.

### 5.2 Local Variables

Local variables hanya relevan pada scope tertentu.

Contoh dalam multi-instance review:

```json
{
  "reviewerId": "officer-001",
  "reviewDecision": "APPROVE",
  "reviewCommentRef": "COMMENT-991"
}
```

Jika setiap reviewer punya decision sendiri, jangan semua menulis ke variable global yang sama:

```json
{
  "reviewDecision": "APPROVE"
}
```

Itu rawan overwrite.

Lebih aman:

```json
{
  "reviewResults": [
    { "reviewerId": "officer-001", "decision": "APPROVE" },
    { "reviewerId": "officer-002", "decision": "REJECT" }
  ]
}
```

atau lebih baik lagi, simpan detail review di domain database dan variable hanya menyimpan aggregate:

```json
{
  "reviewSummary": {
    "approvedCount": 2,
    "rejectedCount": 1,
    "requiredApprovalCount": 2,
    "quorumReached": true
  }
}
```

### 5.3 Scope Design Rule

```text
Use the narrowest scope that still satisfies the process decision.
```

Artinya:

1. jangan jadikan semua variable global;
2. jangan expose temporary task data ke seluruh proses;
3. gunakan input/output mapping untuk mengontrol data masuk/keluar element;
4. untuk subprocess reusable, treat variable seperti API contract.

---

## 6. Input/Output Mapping sebagai Data Boundary

Input/output mapping adalah salah satu mekanisme paling penting untuk menjaga proses tetap bersih.

Camunda 8 documentation menjelaskan bahwa input/output variable mappings dapat digunakan untuk membuat variable baru atau mengatur bagaimana variable digabungkan ke process instance. Pada service task, input mapping dapat mentransformasikan variable ke format yang diterima worker, sedangkan output mapping dapat mengatur variable hasil job mana yang digabungkan kembali ke process instance.

Mental model:

```text
Without mapping:
  worker sees too much and may write too much.

With mapping:
  BPMN element receives only what it needs and returns only what process needs.
```

### 6.1 Tanpa Mapping

Misalnya process punya variable besar:

```json
{
  "applicationId": "APP-1",
  "applicant": {...},
  "documents": [...],
  "riskAssessment": {...},
  "internalNotes": [...],
  "notificationConfig": {...}
}
```

Service task `Send Acknowledgement Email` sebenarnya hanya butuh:

```json
{
  "applicationId": "APP-1",
  "notificationTemplateCode": "APPLICATION_ACK"
}
```

Jika worker menerima semua variable, ada risiko:

1. worker tergantung pada field yang tidak seharusnya;
2. sensitive data terbaca;
3. payload besar;
4. testing sulit;
5. future refactor berbahaya.

### 6.2 Dengan Mapping

Kita bisa mendesain input untuk task sebagai contract:

```json
{
  "applicationId": "APP-1",
  "templateCode": "APPLICATION_ACK"
}
```

Worker mengembalikan output minimal:

```json
{
  "notificationId": "NOTIF-2026-991",
  "notificationStatus": "SENT"
}
```

Process tidak perlu tahu SMTP response penuh.

### 6.3 Mapping sebagai API Contract BPMN Element

Setiap service task seharusnya punya kontrak:

```text
Task: Calculate Risk Score
Input:
  applicationId: string
  applicantType: string
Output:
  riskLevel: LOW | MEDIUM | HIGH
  riskScoreRef: string
Errors:
  APPLICATION_NOT_FOUND
  RISK_POLICY_UNAVAILABLE
Side effects:
  writes risk assessment record to domain DB
```

Ini menjadikan BPMN element seperti function dengan contract jelas.

---

## 7. Variable Naming Discipline

Variable naming terlihat kecil, tetapi sangat memengaruhi maintainability.

### 7.1 Naming yang Buruk

```json
{
  "data": {...},
  "result": true,
  "flag": "Y",
  "status": "OK",
  "type": "A",
  "id": "123",
  "response": {...}
}
```

Masalah:

1. tidak jelas domain-nya;
2. rawan conflict;
3. susah dipakai di gateway;
4. susah dibaca operator;
5. susah evolve;
6. ambigu saat process besar.

### 7.2 Naming yang Baik

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-2026-0091",
  "riskLevel": "HIGH",
  "requiresManagerApproval": true,
  "completenessCheckStatus": "INCOMPLETE",
  "missingDocumentCodes": ["NRIC_FRONT", "BUSINESS_PROFILE"],
  "decisionCode": "APPROVED_WITH_CONDITION"
}
```

### 7.3 Naming Rules

Gunakan aturan berikut:

1. pakai `camelCase` untuk JSON variable names;
2. nama harus domain-specific;
3. hindari `data`, `payload`, `response`, `result` kecuali dalam local mapping yang sangat sempit;
4. boolean gunakan prefix jelas:
   - `isComplete`
   - `hasOutstandingPayment`
   - `requiresManagerApproval`
   - `canAutoApprove`
5. enum gunakan suffix jelas:
   - `riskLevel`
   - `decisionCode`
   - `caseType`
   - `reviewOutcome`
6. reference gunakan suffix `Id`, `Key`, atau `Ref` secara konsisten;
7. timestamp gunakan suffix `At` atau `Date` sesuai presisi:
   - `submittedAt`
   - `slaDueAt`
   - `paymentDueDate`

### 7.4 Jangan Campur Domain dan Technical Naming

Buruk:

```json
{
  "svc1Resp": {...},
  "gwFlag": true,
  "task3Result": "OK"
}
```

Baik:

```json
{
  "addressValidationStatus": "VALID",
  "requiresManualAddressReview": false
}
```

Variable harus menjelaskan business meaning, bukan posisi teknis di diagram.

---

## 8. Variable Type Design

Process variables biasanya direpresentasikan sebagai JSON-compatible values:

1. string;
2. number;
3. boolean;
4. object;
5. array;
6. null.

Dalam Java, ini sering dipetakan ke DTO/record/class.

### 8.1 Primitive Variables

Contoh:

```json
{
  "applicationId": "APP-2026-0001",
  "riskLevel": "HIGH",
  "requiresManagerApproval": true,
  "retryCount": 2
}
```

Kelebihan:

1. mudah dipakai di gateway;
2. mudah dibaca operator;
3. mudah dimapping;
4. kecil.

Kekurangan:

1. terlalu banyak primitive bisa membuat namespace berantakan;
2. sulit menjaga grouping semantik.

### 8.2 Object Variables

Contoh:

```json
{
  "riskAssessment": {
    "level": "HIGH",
    "score": 87,
    "policyVersion": "RISK-POLICY-2026-01",
    "assessmentRef": "RISK-991"
  }
}
```

Kelebihan:

1. grouping jelas;
2. cocok untuk structured contract;
3. versionable.

Kekurangan:

1. gateway expression bisa lebih panjang;
2. partial updates perlu hati-hati;
3. schema evolution harus dikelola.

### 8.3 Array Variables

Contoh:

```json
{
  "missingDocumentCodes": ["ID_FRONT", "BUSINESS_PROFILE"]
}
```

Cocok untuk list kecil yang dipakai process.

Tidak cocok untuk:

1. ribuan records;
2. document list besar;
3. full transaction history;
4. bulk processing dataset.

Untuk dataset besar, simpan reference:

```json
{
  "bulkJobId": "BULK-2026-881",
  "itemCount": 125000
}
```

### 8.4 Enum Variables

Gunakan enum string yang stabil:

```json
{
  "riskLevel": "HIGH",
  "decisionCode": "REJECTED_INCOMPLETE_DOCUMENTS"
}
```

Hindari:

```json
{
  "riskLevel": 3,
  "decisionCode": 7
}
```

Kecuali numeric code memang bagian dari domain standard dan terdokumentasi.

String enum lebih readable untuk operator dan auditor.

---

## 9. Serialization dan Java DTO Mapping

Java worker biasanya menerima variable dari Camunda client sebagai map atau typed object.

### 9.1 Jangan Sebar Map ke Seluruh Domain Service

Buruk:

```java
public void handle(JobClient client, ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();
    applicationService.process(vars);
}
```

Masalah:

1. domain service tergantung pada Camunda variable format;
2. tidak type-safe;
3. error baru muncul runtime;
4. schema change sulit dideteksi;
5. testing buruk.

### 9.2 Gunakan DTO Khusus Worker

Lebih baik:

```java
public record CalculateRiskInput(
    String applicationId,
    String applicantType
) {}

public record CalculateRiskOutput(
    String riskLevel,
    String riskAssessmentRef,
    boolean requiresManagerApproval
) {}
```

Worker:

```java
public void handle(JobClient client, ActivatedJob job) {
    CalculateRiskInput input = objectMapper.readValue(
        job.getVariables(),
        CalculateRiskInput.class
    );

    CalculateRiskResult result = riskService.calculate(
        input.applicationId(),
        input.applicantType()
    );

    CalculateRiskOutput output = new CalculateRiskOutput(
        result.riskLevel().name(),
        result.assessmentRef(),
        result.requiresManagerApproval()
    );

    client.newCompleteCommand(job.getKey())
        .variables(output)
        .send()
        .join();
}
```

### 9.3 DTO Boundary

Gunakan tiga model terpisah:

```text
Camunda Variable DTO
  -> Application Service Command
  -> Domain Model
```

Contoh:

```java
public record CalculateRiskInput(
    String applicationId,
    String applicantType
) {}

public record CalculateRiskCommand(
    ApplicationId applicationId,
    ApplicantType applicantType,
    CorrelationId correlationId
) {}
```

Jangan langsung jadikan process variable DTO sebagai domain object.

### 9.4 Validation

Worker harus validate input sebelum menjalankan side effect.

Contoh:

```java
private void validate(CalculateRiskInput input) {
    if (input.applicationId() == null || input.applicationId().isBlank()) {
        throw new InvalidProcessVariableException("applicationId is required");
    }
    if (input.applicantType() == null) {
        throw new InvalidProcessVariableException("applicantType is required");
    }
}
```

Jika invalid karena model/process bug, biasanya ini technical failure/incident, bukan BPMN business error.

Jika invalid karena business condition yang valid, gunakan BPMN error.

---

## 10. Schema Evolution

Process variables hidup bersama process instances yang mungkin berjalan lama.

Hari ini variable:

```json
{
  "riskLevel": "HIGH"
}
```

Tiga bulan lagi team mengubah menjadi:

```json
{
  "riskAssessment": {
    "level": "HIGH",
    "score": 87,
    "policyVersion": "2026-Q3"
  }
}
```

Apa yang terjadi pada process instance lama?

Jika worker baru hanya membaca format baru, instance lama bisa gagal.

### 10.1 Rule: Worker Harus Version-aware

Worker production-grade harus bisa membaca variable versi lama selama masih ada running instance lama.

Contoh:

```java
public RiskInput normalize(Map<String, Object> vars) {
    if (vars.containsKey("riskAssessment")) {
        return fromRiskAssessmentObject(vars.get("riskAssessment"));
    }

    if (vars.containsKey("riskLevel")) {
        return fromLegacyRiskLevel((String) vars.get("riskLevel"));
    }

    throw new InvalidProcessVariableException("Risk data not found");
}
```

### 10.2 Tambahkan Contract Version

Untuk object variable kompleks:

```json
{
  "riskAssessment": {
    "schemaVersion": 2,
    "level": "HIGH",
    "score": 87,
    "policyVersion": "RISK-2026-Q3",
    "assessmentRef": "RISK-991"
  }
}
```

### 10.3 Versioning Strategy

Ada beberapa strategi:

| Strategi | Cocok Untuk | Risiko |
|---|---|---|
| Backward-compatible variable addition | Perubahan kecil | Field baru harus optional |
| New variable name | Breaking semantic change | Namespace bertambah |
| `schemaVersion` inside object | Object kompleks | Worker lebih kompleks |
| Process migration + variable migration | Major change | Operasional berat |
| New process definition only | Instance lama tetap pakai path lama | Multi-version support |

### 10.4 Backward-compatible Changes

Biasanya aman:

1. menambah optional field;
2. menambah enum value jika gateway/worker siap;
3. menambah variable baru yang tidak wajib;
4. memperjelas output mapping tanpa menghapus variable lama.

### 10.5 Breaking Changes

Berbahaya:

1. rename variable;
2. ubah type string ke object;
3. ubah enum value;
4. pindahkan field nested;
5. hapus variable yang masih dipakai process lama;
6. ubah timezone/timestamp format;
7. ubah meaning boolean.

Contoh breaking change:

```json
{
  "approved": true
}
```

menjadi:

```json
{
  "decisionCode": "APPROVED"
}
```

Ini bukan sekadar rename. Ini perubahan semantic model.

---

## 11. Process Variable Contract Document

Setiap process production-grade sebaiknya punya dokumentasi variable contract.

Contoh:

```markdown
## Process: Application Review

### Start Variables

| Name | Type | Required | Owner | Description |
|---|---|---:|---|---|
| applicationId | string | yes | Application Service | Domain application identifier |
| caseId | string | yes | Case Service | Case identifier for audit/correlation |
| applicantType | enum | yes | Application Service | INDIVIDUAL / COMPANY |

### Process Variables

| Name | Type | Scope | Created By | Consumed By | Description |
|---|---|---|---|---|---|
| isComplete | boolean | global | Completeness Worker | Gateway: Complete? | Completeness result |
| missingDocumentCodes | string[] | global | Completeness Worker | Request Documents Task | Missing docs |
| riskLevel | enum | global | Risk Worker | Approval Gateway | LOW/MEDIUM/HIGH |
| requiresManagerApproval | boolean | global | Risk Worker | Gateway | Whether manager task needed |
| decisionCode | enum | global | Decision Worker | Notify Worker | Final decision |

### Sensitive Variables

None. Sensitive applicant details must be retrieved from Application Service by ID.
```

Ini bukan bureaucracy. Ini survival mechanism.

Jika process berjalan bertahun-tahun, variable contract adalah cara team baru memahami runtime data.

---

## 12. Sensitive Data dan Privacy

Process variable sering terlihat di tools operasional seperti Operate/Tasklist, exporter, logs, metrics, atau incident detail. Karena itu, jangan asumsikan variable bersifat private.

### 12.1 Data yang Tidak Boleh Masuk Variable

Hindari menyimpan:

1. password;
2. API token;
3. refresh token;
4. session token;
5. private key;
6. full identity document number;
7. bank account number;
8. credit card data;
9. full personal profile;
10. medical data;
11. legal sensitive notes;
12. raw email body yang mengandung PII;
13. document binary;
14. full external API payload jika mengandung sensitive data.

### 12.2 Gunakan Reference

Buruk:

```json
{
  "applicantName": "Alice Tan",
  "nric": "S1234567A",
  "dateOfBirth": "1990-01-01",
  "address": "...",
  "income": 120000
}
```

Baik:

```json
{
  "applicationId": "APP-2026-0001",
  "applicantProfileRef": "PROFILE-991",
  "applicantType": "INDIVIDUAL"
}
```

Worker yang butuh detail mengambil dari domain service dengan authorization dan audit.

### 12.3 Secret Handling

Secret tidak boleh menjadi process variable.

Untuk connector/worker:

1. gunakan secret manager;
2. gunakan environment/Kubernetes secret/SSM/Vault;
3. inject secret ke worker runtime;
4. jangan return secret sebagai output variable;
5. jangan log request yang berisi secret;
6. jangan expose secret di incident message.

### 12.4 Redaction Strategy

Jika worker menerima payload sensitive, log harus redacted.

Contoh:

```java
log.info("Start risk scoring applicationId={} applicantType={}",
    input.applicationId(),
    input.applicantType());
```

Jangan:

```java
log.info("Variables={}", job.getVariables());
```

Karena seluruh variable bisa masuk log.

---

## 13. Large Payload Anti-pattern

Camunda documentation menekankan bahwa variable harus ringan dan meaningful. Dalam sizing guidance Camunda juga menyebut maximum variable size per process instance terbatas, saat ini roughly beberapa MB, dan tidak direkomendasikan menyimpan data besar dalam process variables.

Terlepas angka limit spesifik versi/deployment, design rule-nya stabil:

```text
Large payloads do not belong in process variables.
```

### 13.1 Contoh Large Payload Buruk

```json
{
  "documents": [
    {
      "fileName": "passport.pdf",
      "base64": "JVBERi0xLjQKJc..."
    }
  ]
}
```

Atau:

```json
{
  "externalApiFullResponse": {
    "thousands": "of fields"
  }
}
```

### 13.2 Gunakan Reference

```json
{
  "documentBundleId": "DOC-BUNDLE-2026-991",
  "externalCheckResultRef": "EXTCHK-2026-773",
  "externalCheckSummary": "MATCH_FOUND"
}
```

### 13.3 Kenapa Large Payload Berbahaya?

1. engine storage membesar;
2. exporter/read model membesar;
3. job activation payload membesar;
4. network overhead naik;
5. Operate UI lambat;
6. incident inspection sulit;
7. backup/restore lebih mahal;
8. encryption/privacy risk naik;
9. schema evolution makin sulit;
10. worker semakin lambat karena parse payload besar.

### 13.4 Rule of Thumb

Variable harus cukup kecil untuk:

1. dibaca manusia di incident;
2. dikirim cepat ke worker;
3. dipakai sebagai decision context;
4. tidak mengandung data yang tidak perlu untuk routing.

---

## 14. Variable Mutation Discipline

Process variable adalah shared mutable context. Shared mutable context selalu berbahaya jika tidak disiplin.

### 14.1 Hindari Banyak Worker Menulis Variable yang Sama

Buruk:

```text
Task A writes status
Task B writes status
Task C writes status
Gateway reads status
```

Karena `status` bisa berarti apa saja.

Lebih baik:

```text
Completeness Worker writes completenessStatus
Payment Worker writes paymentStatus
Risk Worker writes riskLevel
Decision Worker writes decisionCode
```

### 14.2 Hindari Variable Generic

Buruk:

```json
{
  "result": "APPROVED"
}
```

Baik:

```json
{
  "managerReviewOutcome": "APPROVED"
}
```

### 14.3 Mutability Ownership

Tentukan owner setiap variable.

Contoh:

| Variable | Owner Writer | Other Writers Allowed? |
|---|---|---:|
| `riskLevel` | Risk Scoring Worker | No |
| `completenessStatus` | Completeness Worker | No |
| `decisionCode` | Decision Worker | No |
| `slaDueAt` | SLA Calculator Worker | No |
| `notificationStatus` | Notification Worker | Maybe, only notification retry worker |

Jika banyak component boleh menulis variable yang sama, itu tanda design smell.

---

## 15. Variable dan Gateway Decision

Gateway sering membaca variable.

Contoh:

```text
if riskLevel = "HIGH" -> Manager Approval
else -> Auto Approval
```

Variable untuk gateway harus:

1. stable;
2. typed jelas;
3. tidak nullable kecuali path-nya jelas;
4. enum value terdokumentasi;
5. tidak bergantung pada field nested kompleks yang mudah berubah;
6. sudah divalidasi sebelum gateway.

### 15.1 Gateway Condition Buruk

```text
= applicant.details.profile.risk.assessment.score > 75 and applicant.flags.x == true
```

Masalah:

1. terlalu coupled ke payload shape;
2. sulit dibaca business;
3. rawan null;
4. sulit evolve.

### 15.2 Gateway Condition Baik

```text
= requiresManagerApproval = true
```

atau:

```text
= riskLevel = "HIGH"
```

### 15.3 Compute Before Decide Pattern

Jangan taruh decision calculation kompleks di gateway.

Gunakan pattern:

```text
Calculate Risk Decision Task
  -> writes requiresManagerApproval
Gateway reads requiresManagerApproval
```

Bukan:

```text
Gateway contains huge expression based on 20 fields
```

Gateway harus membaca decision result, bukan menjadi decision engine tersembunyi.

---

## 16. Variable dan User Task

User task adalah wait state untuk manusia/aplikasi manusia.

Variable dipakai untuk:

1. menampilkan konteks task;
2. menentukan assignee/candidate group;
3. menentukan due date/follow-up;
4. menerima completion result;
5. menggerakkan path berikutnya.

### 16.1 Jangan Kirim Semua Domain Data ke Tasklist

Buruk:

```json
{
  "fullApplicationPayload": {...},
  "allDocuments": [...],
  "allApplicantHistory": [...]
}
```

Lebih baik:

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-2026-0091",
  "taskDisplaySummary": {
    "applicationNo": "APP-2026-0001",
    "applicantDisplayName": "A*** T***",
    "riskLevel": "HIGH",
    "submittedAt": "2026-06-17T10:15:30+07:00"
  }
}
```

Aplikasi UI internal dapat fetch detail dari backend dengan authorization.

### 16.2 Completion Variables

User task completion harus menghasilkan data yang jelas.

Buruk:

```json
{
  "approved": true,
  "remarks": "ok"
}
```

Baik:

```json
{
  "officerReviewOutcome": "RECOMMEND_APPROVAL",
  "officerReviewReasonCode": "REQUIREMENTS_MET",
  "officerReviewCommentRef": "COMMENT-2026-0021"
}
```

Kenapa comment reference? Karena comment bisa panjang/sensitive dan lebih cocok di domain/audit store.

### 16.3 Maker-checker

Untuk maker-checker:

```json
{
  "makerUserId": "user-001",
  "makerAction": "SUBMIT_RECOMMENDATION",
  "checkerUserId": "user-009",
  "checkerDecision": "APPROVED"
}
```

Tetapi pastikan authorization enforcement tidak hanya berdasarkan variable. Backend tetap harus validate:

1. checker bukan maker;
2. checker punya role benar;
3. task sedang claimable/completable;
4. decision transition valid.

Process variable membantu flow, bukan security authority tunggal.

---

## 17. Variable dan Message Correlation

Message correlation butuh key yang stabil.

Contoh:

```json
{
  "applicationId": "APP-2026-0001",
  "paymentReferenceNo": "PAY-991"
}
```

Jika process menunggu payment callback, correlation key harus jelas:

```text
messageName = PaymentReceived
correlationKey = paymentReferenceNo
```

### 17.1 Correlation Key Requirements

Correlation key harus:

1. unique dalam konteks message;
2. stable sepanjang wait state;
3. tidak berubah karena user edit;
4. tidak mengandung sensitive value;
5. tersedia bagi sender dan process;
6. tidak reused lintas process aktif kecuali memang intended.

### 17.2 Jangan Pakai Mutable Business Field

Buruk:

```text
correlationKey = applicantEmail
```

Email bisa berubah, bisa duplicate, dan sensitive.

Baik:

```text
correlationKey = paymentReferenceNo
```

atau:

```text
correlationKey = externalSubmissionId
```

### 17.3 Store Correlation Reference

Domain DB sebaiknya punya table correlation:

```text
PROCESS_CORRELATION
- process_instance_key
- business_key
- message_name
- correlation_key
- status
- created_at
- consumed_at
```

Ini membantu support jika message gagal correlate.

---

## 18. Variable dan Timer/SLA

Timer sering bergantung pada variable tanggal/durasi.

Contoh:

```json
{
  "slaDueAt": "2026-06-20T17:00:00+07:00"
}
```

### 18.1 Timezone Discipline

Jangan ambigu:

```json
{
  "dueDate": "2026-06-20"
}
```

Apakah ini end of day? timezone mana? business calendar mana?

Lebih jelas:

```json
{
  "slaDueAt": "2026-06-20T17:00:00+07:00",
  "slaCalendarCode": "SG_BUSINESS_DAY",
  "slaPolicyVersion": "SLA-2026-01"
}
```

### 18.2 Timer Variable Ownership

Timer due date harus dihitung oleh satu component jelas:

```text
SLA Calculator Worker writes slaDueAt.
Timer reads slaDueAt.
```

Jangan banyak task mengubah `slaDueAt` tanpa audit.

### 18.3 Business Calendar

Workflow engine timer biasanya tahu waktu absolut/durasi. Tetapi working day/public holiday/business calendar sering domain-specific.

Pattern:

```text
Calculate SLA Due Date Worker
  input: submittedAt, caseType, priority, calendarCode
  output: slaDueAt, slaPolicyVersion

Timer Boundary Event
  uses: slaDueAt
```

Jangan taruh business calendar logic rumit langsung di BPMN expression.

---

## 19. Variable dan DMN/Decision

DMN membutuhkan input yang stabil.

Contoh decision table risk:

| applicantType | declaredRevenue | previousViolationCount | riskLevel |
|---|---:|---:|---|
| COMPANY | > 1000000 | >= 1 | HIGH |
| COMPANY | <= 1000000 | 0 | MEDIUM |
| INDIVIDUAL | any | 0 | LOW |

Process variable untuk DMN input:

```json
{
  "applicantType": "COMPANY",
  "declaredRevenueBand": "GT_1M",
  "previousViolationCount": 2
}
```

DMN output:

```json
{
  "riskLevel": "HIGH",
  "riskPolicyVersion": "RISK-2026-Q3"
}
```

### 19.1 Jangan Kirim Raw Domain Object ke DMN

Buruk:

```json
{
  "application": {
    "applicant": {
      "companyProfile": {
        "financials": {
          "declaredRevenue": 1200000
        }
      }
    }
  }
}
```

Baik:

```json
{
  "applicantType": "COMPANY",
  "declaredRevenueBand": "GT_1M",
  "previousViolationCount": 2
}
```

DMN input sebaiknya curated facts, bukan object dump.

---

## 20. Variable dan Audit Defensibility

Dalam regulatory system, pertanyaan audit bukan hanya:

```text
Apa hasil akhirnya?
```

Tetapi:

```text
Data apa yang dipakai untuk memutuskan?
Siapa yang memutuskan?
Kapan diputuskan?
Aturan versi berapa yang dipakai?
Apakah ada override manual?
Kenapa path escalation terjadi?
```

Process variable bisa membantu, tetapi tidak cukup sebagai audit trail utama.

### 20.1 Audit-relevant Variables

Contoh variable yang berguna:

```json
{
  "riskLevel": "HIGH",
  "riskPolicyVersion": "RISK-2026-Q3",
  "decisionCode": "REJECTED_INCOMPLETE_DOCUMENTS",
  "decisionPolicyVersion": "DECISION-2026-02",
  "requiresManagerApproval": true,
  "slaDueAt": "2026-06-20T17:00:00+07:00"
}
```

### 20.2 Audit Store Tetap Dibutuhkan

Domain/audit DB harus menyimpan event detail:

```text
AUDIT_EVENT
- event_id
- case_id
- process_instance_key
- activity_id
- actor_id
- action
- reason_code
- before_state
- after_state
- policy_version
- timestamp
- correlation_id
```

Process variable bukan audit log lengkap.

### 20.3 Explainability Snapshot

Untuk decision penting, simpan reference ke snapshot:

```json
{
  "riskAssessmentRef": "RISK-ASSMT-2026-991",
  "decisionRecordRef": "DECISION-REC-2026-773"
}
```

Snapshot detail ada di domain/audit store.

---

## 21. Variable dan Incident Repair

Incident sering terjadi karena variable salah atau missing.

Contoh:

```text
Gateway expression expects riskLevel.
But riskLevel is missing.
Process stuck.
```

Atau:

```text
Worker expects applicationId.
applicationId is null.
Job fails until retries exhausted.
Incident created.
```

### 21.1 Repairability Design

Variable harus cukup jelas sehingga operator dapat memahami:

1. apa yang hilang;
2. siapa owner variable;
3. task mana yang seharusnya menulis;
4. apakah aman memperbaiki manual;
5. apakah perlu replay worker;
6. apakah perlu cancel process.

### 21.2 Incident Message Jangan Bocorkan Sensitive Data

Buruk:

```java
throw new RuntimeException("Failed to verify NRIC S1234567A for Alice Tan with income 120000")
```

Baik:

```java
throw new RuntimeException("Failed to verify applicant profile for applicationId=APP-2026-0001, profileRef=PROFILE-991")
```

### 21.3 Manual Variable Correction

Manual correction harus audit-safe.

Runbook harus menjawab:

1. variable apa yang boleh diedit manual;
2. siapa boleh edit;
3. apakah domain DB juga harus diubah;
4. bagaimana approval repair;
5. bagaimana mencatat reason;
6. bagaimana retry job setelah correction.

Jangan membuat process yang hanya bisa diperbaiki dengan “tebak variable di Operate”.

---

## 22. Variable Contract Testing

Variable contract harus diuji seperti API contract.

### 22.1 Test Worker Input

```java
@Test
void shouldRejectMissingApplicationId() {
    Map<String, Object> vars = Map.of(
        "applicantType", "COMPANY"
    );

    assertThrows(InvalidProcessVariableException.class, () ->
        mapper.toInput(vars)
    );
}
```

### 22.2 Test Worker Output

```java
@Test
void shouldReturnMinimalRiskOutput() {
    CalculateRiskOutput output = handler.calculate(input);

    assertThat(output.riskLevel()).isEqualTo("HIGH");
    assertThat(output.riskAssessmentRef()).isNotBlank();
    assertThat(output.requiresManagerApproval()).isTrue();
}
```

### 22.3 Test BPMN Gateway Variable

Test scenario:

```text
Given riskLevel = HIGH
When process reaches approval gateway
Then manager approval task is created
```

Dan:

```text
Given riskLevel = LOW
When process reaches approval gateway
Then process skips manager approval
```

### 22.4 Test Backward Compatibility

```java
@Test
void shouldReadLegacyRiskLevelVariable() {
    Map<String, Object> vars = Map.of("riskLevel", "HIGH");

    RiskInput input = normalizer.normalize(vars);

    assertThat(input.level()).isEqualTo(RiskLevel.HIGH);
}
```

---

## 23. Variable Governance in Team

Dalam project besar, variable governance perlu eksplisit.

### 23.1 Variable Registry

Buat registry per process:

```text
applicationId
caseId
riskLevel
requiresManagerApproval
completenessStatus
missingDocumentCodes
decisionCode
slaDueAt
notificationId
```

Untuk setiap variable:

1. type;
2. owner;
3. creator;
4. consumer;
5. scope;
6. sensitive classification;
7. version;
8. allowed values;
9. migration notes.

### 23.2 Review Checklist

Setiap PR BPMN/worker harus ditanya:

1. variable baru diperlukan untuk apa?
2. siapa owner-nya?
3. apakah bisa reference saja?
4. apakah sensitive?
5. apakah besar?
6. apakah dipakai gateway?
7. apakah nullable?
8. apakah ada default?
9. apakah breaking change?
10. apakah ada test?
11. apakah operator bisa memahami variable ini?
12. apakah variable masuk log?
13. apakah perlu audit event?

### 23.3 Avoid Variable Sprawl

Variable sprawl terjadi saat setiap task menambahkan variable baru tanpa desain.

Gejala:

```json
{
  "applicationId": "APP-1",
  "result": "OK",
  "result2": "OK",
  "isValid": true,
  "valid": true,
  "checkStatus": "PASS",
  "status": "APPROVED",
  "decision": "Y",
  "decisionCode": "APPROVE",
  "flag": true,
  "data": {...},
  "payload": {...}
}
```

Solusi:

1. variable registry;
2. naming convention;
3. output mapping;
4. PR review;
5. delete/deprecate unused variables;
6. task-level contract;
7. tests.

---

## 24. Java 8–25 Considerations

Seri ini mencakup Java 8 sampai 25. Variable handling strategy berubah tergantung versi Java.

### 24.1 Java 8

Gunakan class biasa:

```java
public final class CalculateRiskInput {
    private String applicationId;
    private String applicantType;

    public String getApplicationId() {
        return applicationId;
    }

    public void setApplicationId(String applicationId) {
        this.applicationId = applicationId;
    }

    public String getApplicantType() {
        return applicantType;
    }

    public void setApplicantType(String applicantType) {
        this.applicantType = applicantType;
    }
}
```

Validasi manual atau Bean Validation.

### 24.2 Java 11/17

Masih bisa pakai class biasa, tetapi Java 17 memungkinkan record jika runtime/library mendukung.

```java
public record CalculateRiskInput(
    String applicationId,
    String applicantType
) {}
```

### 24.3 Java 21/25

Lebih nyaman memakai:

1. records untuk immutable DTO;
2. sealed interface untuk typed result/error;
3. pattern matching;
4. virtual threads untuk blocking IO worker jika cocok;
5. structured concurrency untuk internal fan-out terbatas, dengan hati-hati.

Contoh sealed result:

```java
public sealed interface RiskCalculationOutcome
    permits RiskCalculationOutcome.Success, RiskCalculationOutcome.BusinessError {

    record Success(
        RiskLevel riskLevel,
        String assessmentRef,
        boolean requiresManagerApproval
    ) implements RiskCalculationOutcome {}

    record BusinessError(
        String errorCode,
        String message
    ) implements RiskCalculationOutcome {}
}
```

Tetapi jangan over-engineer. Variable contract tetap harus sederhana dan JSON-friendly.

---

## 25. Production-grade Variable Handling Pattern

Berikut pattern yang sehat untuk worker.

### 25.1 Input DTO

```java
public record SendNotificationInput(
    String applicationId,
    String caseId,
    String templateCode,
    String recipientRef
) {}
```

### 25.2 Output DTO

```java
public record SendNotificationOutput(
    String notificationId,
    String notificationStatus
) {}
```

### 25.3 Mapper

```java
public final class ProcessVariableMapper {
    private final ObjectMapper objectMapper;

    public ProcessVariableMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public SendNotificationInput toSendNotificationInput(String variablesJson) {
        try {
            SendNotificationInput input = objectMapper.readValue(
                variablesJson,
                SendNotificationInput.class
            );
            validate(input);
            return input;
        } catch (JsonProcessingException e) {
            throw new InvalidProcessVariableException("Invalid SendNotificationInput", e);
        }
    }

    private void validate(SendNotificationInput input) {
        requireNonBlank(input.applicationId(), "applicationId");
        requireNonBlank(input.caseId(), "caseId");
        requireNonBlank(input.templateCode(), "templateCode");
        requireNonBlank(input.recipientRef(), "recipientRef");
    }

    private void requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new InvalidProcessVariableException(name + " is required");
        }
    }
}
```

### 25.4 Worker Handler

```java
public void handle(JobClient client, ActivatedJob job) {
    String correlationId = correlationIdFrom(job);

    try {
        SendNotificationInput input = mapper.toSendNotificationInput(job.getVariables());

        NotificationResult result = notificationService.send(
            new SendNotificationCommand(
                input.applicationId(),
                input.caseId(),
                input.templateCode(),
                input.recipientRef(),
                correlationId
            )
        );

        SendNotificationOutput output = new SendNotificationOutput(
            result.notificationId(),
            result.status().name()
        );

        client.newCompleteCommand(job.getKey())
            .variables(output)
            .send()
            .join();

    } catch (InvalidProcessVariableException e) {
        client.newFailCommand(job.getKey())
            .retries(0)
            .errorMessage(safeMessage(e))
            .send()
            .join();

    } catch (NotificationBusinessException e) {
        client.newThrowErrorCommand(job.getKey())
            .errorCode(e.errorCode())
            .errorMessage(safeMessage(e))
            .send()
            .join();

    } catch (Exception e) {
        client.newFailCommand(job.getKey())
            .retries(Math.max(job.getRetries() - 1, 0))
            .retryBackoff(Duration.ofMinutes(5))
            .errorMessage(safeMessage(e))
            .send()
            .join();
    }
}
```

Key points:

1. input mapping jelas;
2. variable validasi eksplisit;
3. domain command terpisah;
4. output minimal;
5. error message aman;
6. business error dibedakan dari technical failure;
7. tidak log semua variable.

---

## 26. Design Example: Regulatory Application Review

### 26.1 Domain Data

Domain database:

```text
APPLICATION
- application_id
- applicant_id
- application_type
- status
- submitted_at

CASE
- case_id
- application_id
- assigned_team
- priority

RISK_ASSESSMENT
- assessment_id
- application_id
- risk_level
- score
- policy_version
- created_at

DECISION_RECORD
- decision_id
- case_id
- decision_code
- reason_code
- decided_by
- decided_at
```

### 26.2 Process Start Variables

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-2026-0101",
  "applicationType": "NEW_LICENSE",
  "applicantType": "COMPANY",
  "submittedAt": "2026-06-17T09:00:00+07:00"
}
```

### 26.3 Completeness Worker Output

```json
{
  "completenessStatus": "INCOMPLETE",
  "missingDocumentCodes": ["BUSINESS_PROFILE", "DIRECTOR_ID"],
  "completenessCheckRef": "CHK-2026-991"
}
```

### 26.4 Gateway

```text
If completenessStatus = "COMPLETE" -> Risk Scoring
If completenessStatus = "INCOMPLETE" -> Request Missing Documents
```

### 26.5 Risk Worker Output

```json
{
  "riskLevel": "HIGH",
  "riskAssessmentRef": "RISK-2026-881",
  "riskPolicyVersion": "RISK-POLICY-2026-01",
  "requiresManagerApproval": true
}
```

### 26.6 Officer Task Completion

```json
{
  "officerRecommendation": "RECOMMEND_APPROVAL_WITH_CONDITION",
  "officerReasonCode": "REQUIREMENTS_MET_WITH_MINOR_CONDITION",
  "officerReviewRecordRef": "REV-2026-111"
}
```

### 26.7 Manager Task Completion

```json
{
  "managerDecision": "APPROVED_WITH_CONDITION",
  "managerReasonCode": "ACCEPT_OFFICER_RECOMMENDATION",
  "managerDecisionRecordRef": "DEC-2026-222"
}
```

### 26.8 Final Decision Worker Output

```json
{
  "decisionCode": "APPROVED_WITH_CONDITION",
  "decisionRecordRef": "DEC-2026-222",
  "decisionIssuedAt": "2026-06-19T14:30:00+07:00"
}
```

Perhatikan: process variable hanya menyimpan ringkasan dan reference. Detail tetap ada di domain DB.

---

## 27. Common Anti-patterns

### 27.1 Variable as Database

```json
{
  "application": {
    "everything": "..."
  }
}
```

Konsekuensi:

1. duplicate truth;
2. data stale;
3. privacy risk;
4. migration sulit.

### 27.2 Variable as Log

```json
{
  "history": [
    { "step": "A", "time": "..." },
    { "step": "B", "time": "..." }
  ]
}
```

Gunakan audit table/event log.

### 27.3 Variable as Secret Store

```json
{
  "apiToken": "secret"
}
```

Ini salah secara security.

### 27.4 Generic Variables

```json
{
  "status": "OK",
  "result": true,
  "data": {...}
}
```

Sulit maintain.

### 27.5 Huge Gateway Expression

```text
= application.applicant.profile.financial.revenue > 1000000
  and application.history.violations[0].severity = "HIGH"
  and application.documents[3].verified = true
```

Pindahkan decision ke worker/DMN.

### 27.6 Overwriting Variable in Parallel Path

Parallel tasks menulis variable sama:

```json
{
  "reviewResult": "APPROVED"
}
```

Gunakan per-review result atau aggregate.

### 27.7 No Variable Contract

Gejala:

1. worker gagal karena missing field;
2. gateway tidak jelas;
3. task form mengambil variable sembarangan;
4. incident repair tebak-tebakan.

---

## 28. Variable Design Checklist

Gunakan checklist ini saat mendesain variable.

### 28.1 Necessity

```text
Apakah engine/process benar-benar membutuhkan data ini?
Apakah data ini dipakai untuk routing, wait state, correlation, task display, atau worker input?
Jika tidak, kenapa menjadi variable?
```

### 28.2 Ownership

```text
Siapa yang membuat variable ini?
Siapa yang boleh mengubahnya?
Siapa yang membacanya?
Apakah ada lebih dari satu writer?
```

### 28.3 Scope

```text
Apakah variable harus global?
Bisakah local di task/subprocess?
Apakah output mapping membatasi propagation?
```

### 28.4 Type

```text
Apa type-nya?
Apakah nullable?
Apa allowed enum values?
Apakah timestamp format jelas?
```

### 28.5 Size

```text
Apakah payload kecil?
Apakah ini bisa menjadi reference saja?
Apakah array bisa tumbuh besar?
```

### 28.6 Security

```text
Apakah mengandung PII?
Apakah mengandung secret?
Apakah akan terlihat di Operate/Tasklist/log/exporter?
Perlu redaction?
```

### 28.7 Evolution

```text
Apakah perubahan ini backward-compatible?
Apakah worker lama/baru bisa membaca format ini?
Perlu schemaVersion?
Perlu migration?
```

### 28.8 Operability

```text
Jika incident terjadi, apakah operator bisa memahami variable ini?
Apakah error message aman?
Apakah runbook menjelaskan correction?
```

### 28.9 Audit

```text
Apakah decision-critical variable punya policy version?
Apakah ada reference ke decision record?
Apakah audit event disimpan di luar process variable?
```

---

## 29. Design Heuristics untuk Top 1% Engineer

### Heuristic 1 — Variable Harus Mewakili Process Fact, Bukan UI Payload

Buruk:

```json
{
  "formData": {...}
}
```

Baik:

```json
{
  "officerRecommendation": "RECOMMEND_APPROVAL",
  "officerReviewRecordRef": "REV-991"
}
```

### Heuristic 2 — Gateway Membaca Kesimpulan, Bukan Menghitung Kesimpulan

Buruk:

```text
Gateway evaluates 15 raw fields.
```

Baik:

```text
Decision worker/DMN writes requiresManagerApproval.
Gateway reads requiresManagerApproval.
```

### Heuristic 3 — Simpan Reference untuk Data Besar/Sensitif

```json
{
  "documentBundleId": "DOCB-991",
  "riskAssessmentRef": "RISK-881"
}
```

### Heuristic 4 — Satu Variable, Satu Meaning, Satu Owner

Jika variable punya banyak meaning, pecah.

### Heuristic 5 — Variable Contract Harus Bisa Dibaca Tanpa Membuka Code

Operator/auditor/BA senior harus bisa mengerti variable inti dari namanya dan registry.

### Heuristic 6 — Process Variable Tidak Boleh Menjadi Coupling Tersembunyi

Jika 10 worker bergantung pada object besar yang sama, itu distributed coupling.

### Heuristic 7 — Treat Variable Change as API Change

Rename variable sama seriusnya dengan rename API field.

### Heuristic 8 — Optimize for Long-running Instances

Jangan hanya test instance baru. Pikirkan instance lama yang masih berjalan saat worker baru deploy.

---

## 30. Mini Case Study: Variable Design yang Salah dan Perbaikannya

### 30.1 Desain Awal yang Bermasalah

Process start variable:

```json
{
  "application": {
    "id": "APP-1",
    "applicant": {
      "name": "Alice",
      "idNo": "S1234567A",
      "address": "...",
      "income": 120000
    },
    "documents": [
      { "name": "passport.pdf", "base64": "..." }
    ],
    "status": "SUBMITTED"
  },
  "data": {},
  "status": "NEW"
}
```

Masalah:

1. PII masuk variable;
2. document binary masuk variable;
3. domain object masuk engine;
4. `status` ambigu;
5. `data` tidak bermakna;
6. schema application akan berubah dan merusak worker;
7. operator melihat data sensitif;
8. payload besar.

### 30.2 Desain yang Lebih Baik

Process start variable:

```json
{
  "applicationId": "APP-1",
  "caseId": "CASE-1",
  "applicantType": "INDIVIDUAL",
  "applicationType": "NEW_LICENSE",
  "submittedAt": "2026-06-17T09:00:00+07:00",
  "documentBundleId": "DOCB-1"
}
```

Completeness worker output:

```json
{
  "completenessStatus": "COMPLETE",
  "completenessCheckRef": "CHK-1"
}
```

Risk worker output:

```json
{
  "riskLevel": "MEDIUM",
  "riskAssessmentRef": "RISK-1",
  "requiresManagerApproval": false
}
```

Decision worker output:

```json
{
  "decisionCode": "APPROVED",
  "decisionRecordRef": "DEC-1"
}
```

Hasil:

1. variable kecil;
2. sensitive data tetap di domain service;
3. gateway mudah dibaca;
4. worker contract jelas;
5. schema evolution lebih aman;
6. audit reference tersedia;
7. incident lebih mudah ditangani.

---

## 31. Ringkasan Mental Model

Process variable adalah bagian kecil tetapi sangat kritikal dari process orchestration.

Ingat struktur ini:

```text
Domain database:
  owns business truth

Workflow engine:
  owns process progression

Process variables:
  minimal execution context and routing facts

Audit store:
  owns defensible history

Document store:
  owns large binary/document data

Secret manager:
  owns credentials/secrets
```

Jika semua dimasukkan ke variable, sistem menjadi rapuh.

Jika variable terlalu minimal tanpa kontrak, process menjadi sulit dieksekusi.

Balance-nya adalah:

```text
Store enough data for the process to run, decide, wait, correlate, and operate.
Store nothing more than necessary.
```

---

## 32. Practical Template: Variable Contract Section untuk Setiap BPMN

Gunakan template ini untuk setiap process definition.

```markdown
# Process Variable Contract

## Process

Name: Application Review  
BPMN ID: application_review_process  
Version: 1.x  
Owner: Case Management Team

## Start Variables

| Name | Type | Required | Source | Description |
|---|---|---:|---|---|
| applicationId | string | yes | Application Service | Application domain ID |
| caseId | string | yes | Case Service | Case domain ID |
| applicationType | enum | yes | Application Service | NEW_LICENSE / RENEWAL / APPEAL |
| applicantType | enum | yes | Application Service | INDIVIDUAL / COMPANY |
| submittedAt | datetime | yes | Application Service | Submission timestamp with timezone |

## Runtime Variables

| Name | Type | Scope | Created By | Consumed By | Description |
|---|---|---|---|---|---|
| completenessStatus | enum | global | Completeness Worker | Completeness Gateway | COMPLETE / INCOMPLETE |
| missingDocumentCodes | string[] | global | Completeness Worker | Request Document Task | Missing document codes |
| riskLevel | enum | global | Risk Worker | Approval Gateway | LOW / MEDIUM / HIGH |
| riskAssessmentRef | string | global | Risk Worker | Audit/UI | Reference to risk assessment record |
| requiresManagerApproval | boolean | global | Risk Worker | Approval Gateway | Whether manager approval is required |
| decisionCode | enum | global | Decision Worker | Notification Worker | Final decision code |
| decisionRecordRef | string | global | Decision Worker | Audit/UI | Reference to decision record |

## Sensitive Data Policy

No full applicant profile, identity number, document binary, token, password, or raw external API response may be stored as process variable.

## Size Policy

Variables must remain lightweight. Large payloads must be stored in domain/document storage and referenced by ID.

## Versioning Policy

Breaking variable changes require either backward-compatible worker support or explicit process/variable migration plan.
```

---

## 33. Apa yang Harus Dikuasai Setelah Part Ini

Setelah memahami part ini, kamu seharusnya bisa:

1. membedakan domain state, process state, process variable, audit data, document data, dan secret;
2. mendesain variable contract untuk BPMN process;
3. menentukan data mana yang masuk variable dan mana yang harus menjadi reference;
4. mendesain variable scope dan input/output mapping;
5. menghindari variable sebagai database kedua;
6. mendesain Java DTO untuk worker input/output;
7. menjaga backward compatibility variable schema;
8. menghindari sensitive data leakage;
9. mendesain gateway yang membaca decision facts, bukan menghitung logic kompleks;
10. membuat variable registry dan checklist review;
11. menganalisis incident yang disebabkan variable missing/invalid;
12. menghubungkan variable dengan audit/regulatory defensibility.

---

## 34. Latihan Desain

Ambil proses berikut:

```text
Submit Renewal Application
  -> Validate Submission
  -> Check Outstanding Payment
  -> Risk Assessment
  -> Officer Review
  -> Manager Approval if High Risk
  -> Generate Renewal Certificate
  -> Notify Applicant
```

Desain:

1. start variables;
2. output variable tiap worker;
3. variable untuk gateway;
4. data yang tidak boleh masuk variable;
5. variable reference ke domain/audit/document store;
6. schema version strategy;
7. variable registry;
8. incident repair rule jika `riskLevel` missing;
9. test case untuk backward compatibility variable.

Jawaban yang baik tidak akan menyimpan seluruh renewal application payload di variable. Jawaban yang baik akan menyimpan ID, process facts, decision facts, dan references.

---

## 35. Penutup

Process variable terlihat seperti detail teknis kecil, tetapi di workflow system, variable adalah salah satu desain paling menentukan.

BPMN diagram bisa terlihat rapi, worker bisa terlihat clean, tetapi jika variable contract buruk, production akan mengalami:

1. incident misterius;
2. gateway salah jalur;
3. worker gagal karena schema berubah;
4. sensitive data leak;
5. payload terlalu besar;
6. audit sulit dijelaskan;
7. process migration menyakitkan;
8. debugging lama;
9. team takut mengubah workflow.

Sebaliknya, jika variable contract disiplin, workflow menjadi:

1. mudah dibaca;
2. mudah diuji;
3. mudah dioperasikan;
4. lebih aman;
5. lebih scalable;
6. lebih defensible;
7. lebih siap berubah.

Part berikutnya akan membahas failure semantics yang lebih eksplisit:

```text
BPMN Error, Technical Failure, Incident, Escalation, and Compensation
```

Di sana kita akan membedakan kapan worker harus `fail job`, kapan harus `throw BPMN error`, kapan membuat incident, kapan escalate ke manusia, dan kapan melakukan compensation.

---

## Referensi

- OMG BPMN 2.0.2 Specification — Business Process Model and Notation.
- Camunda 8 Documentation — Concepts: Variables.
- Camunda 8 Documentation — Modeler: Data handling, variable scopes, propagation, and input/output mappings.
- Camunda 8 Documentation — Service tasks and variable mappings.
- Camunda 8 Documentation — Best Practices: Handling data in processes.
- Camunda 8 Documentation — Architecture sizing guidance and variable size considerations.
- Camunda 8 Documentation — Job workers and job lifecycle.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-bpmn-camunda-part-07-job-worker-reliability-idempotency-retry-backoff-poison-jobs.md">⬅️ Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-bpmn-camunda-part-09-bpmn-error-technical-failure-incident-escalation-compensation.md">Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation ➡️</a>
</div>
