# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic

> Seri: Java BPMN, Camunda, Process Orchestration Engineering  
> Level: Advanced / Production Engineering  
> Target: Java 8 sampai Java 25  
> Fokus: DMN, decision table, decision requirement, FEEL, policy-as-decision, BPMN integration, auditability, testability, dan maintainability

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita sudah membahas:

1. orientasi process orchestration,
2. semantics BPMN,
3. core element BPMN,
4. modeling discipline,
5. Camunda 7 vs Camunda 8,
6. Zeebe runtime mental model,
7. Java client dan worker engineering,
8. worker reliability,
9. process variables,
10. error, incident, escalation, compensation,
11. human workflow.

Sekarang kita masuk ke area yang sering diremehkan tetapi sangat menentukan kualitas workflow system: **decision engineering**.

BPMN menjawab pertanyaan:

```text
What should happen next in the process?
```

DMN menjawab pertanyaan:

```text
Given these facts, what decision should be made?
```

Perbedaan ini terlihat kecil, tetapi dampaknya besar.

Jika semua keputusan bisnis dimasukkan ke BPMN gateway, diagram akan cepat berubah menjadi:

```text
spaghetti gateway
    + nested condition
    + duplicated policy
    + unreadable process
    + hard-to-test decision logic
    + business cannot review confidently
```

DMN membantu memisahkan:

```text
Process flow      -> BPMN
Decision logic    -> DMN
Expression logic  -> FEEL
Domain execution  -> Java service / worker
Persistence       -> domain database
Audit trail       -> process + decision + domain event
```

Top 1% engineer tidak hanya bertanya:

```text
Can I implement this condition?
```

Tetapi bertanya:

```text
Where should this decision live?
Who owns it?
Who can review it?
How is it versioned?
Can we explain the decision later?
Can we test all combinations?
Can it change without corrupting running processes?
```

---

## 1. Apa Itu DMN?

DMN adalah singkatan dari **Decision Model and Notation**.

Secara konseptual, DMN adalah standard untuk memodelkan dan mengeksekusi decision logic menggunakan bentuk yang relatif readable untuk business dan technical stakeholders.

DMN biasanya digunakan untuk:

1. eligibility decision,
2. routing decision,
3. risk classification,
4. fee calculation,
5. priority assignment,
6. SLA category,
7. reviewer group selection,
8. approval requirement,
9. document requirement,
10. enforcement action recommendation.

Contoh pertanyaan yang cocok untuk DMN:

```text
Apakah application eligible untuk auto-approval?
```

```text
Berdasarkan license type, risk score, dan prior violation,
reviewer group mana yang harus menangani case ini?
```

```text
Berapa SLA response time untuk case dengan severity tertentu?
```

```text
Dokumen tambahan apa saja yang wajib diminta?
```

```text
Apakah appeal boleh diterima setelah deadline?
```

DMN bukan pengganti BPMN. DMN juga bukan pengganti Java domain service. DMN adalah tempat untuk **business decision logic yang eksplisit, terstruktur, dan bisa dievaluasi**.

---

## 2. Kenapa Decision Logic Tidak Selalu Cocok di BPMN?

Misalnya kita punya proses application review:

```text
Receive Application
  -> Validate Completeness
  -> Decide Review Path
  -> Assign Reviewer
  -> Review
  -> Approve / Reject / Request Info
```

Di BPMN, `Decide Review Path` bisa dibuat memakai exclusive gateway:

```text
if riskScore < 20 and licenseType == "LOW_RISK" and noViolation:
    autoApprove
else if riskScore < 50 and licenseType in (...):
    officerReview
else if riskScore >= 50 or hasViolation:
    seniorReview
else:
    manualTriage
```

Kalau cuma 2 sampai 3 kondisi, gateway masih masuk akal.

Tetapi bayangkan kondisi bertambah:

```text
licenseType
applicantCategory
priorViolationCount
financialStanding
submissionChannel
documentCompleteness
crossAgencyFlag
appealHistory
paymentStatus
riskScore
specialScheme
jurisdiction
publicHolidayAdjustment
```

Kalau semua dipaksa ke gateway, BPMN akan menjadi policy table yang digambar sebagai diagram. Itu salah tempat.

BPMN bagus untuk menggambarkan **urutan kerja**:

```text
submit -> review -> approve -> issue license
```

DMN bagus untuk menggambarkan **aturan keputusan**:

```text
facts -> decision result
```

Java bagus untuk menggambarkan **komputasi teknis/domain complex**:

```text
query database
calculate aggregate
call external system
validate invariant
persist domain change
```

---

## 3. Mental Model Utama: Flow vs Decision vs Computation

Pisahkan tiga hal ini dengan disiplin.

### 3.1 Flow

Flow adalah urutan aktivitas.

Contoh:

```text
Application Submitted
  -> Completeness Check
  -> Eligibility Decision
  -> Officer Review
  -> Decision Issued
```

Flow menjawab:

```text
Apa langkah berikutnya?
Siapa yang menunggu?
Apa yang terjadi jika timeout?
Apa yang terjadi jika user menolak?
Apa yang terjadi jika external system gagal?
```

Flow biasanya hidup di BPMN.

### 3.2 Decision

Decision adalah hasil logis berdasarkan fakta.

Contoh:

```text
Input:
- licenseType = MONEY_LENDER
- riskScore = 82
- priorViolationCount = 2
- documentComplete = true

Decision:
- reviewLevel = SENIOR_REVIEW
- slaDays = 5
- requireSecondApprover = true
```

Decision menjawab:

```text
Berdasarkan data ini, hasil bisnisnya apa?
```

Decision cocok hidup di DMN.

### 3.3 Computation

Computation adalah operasi teknis atau domain yang mungkin kompleks.

Contoh:

```text
riskScore = calculateRiskScore(applicantId)
```

Di baliknya mungkin ada:

1. query applicant profile,
2. query violation history,
3. query payment behavior,
4. query cross-agency flag,
5. calculate weighted score,
6. persist score snapshot.

Ini tidak cocok ditulis seluruhnya di DMN jika terlalu kompleks. Lebih cocok di Java domain service.

### 3.4 Pemisahan Ideal

```text
Java worker:
  collect facts / compute derived facts
       |
       v
DMN:
  decide outcome based on facts
       |
       v
BPMN:
  route process based on decision outcome
```

Contoh:

```text
Service Task: Prepare Review Facts
  -> Business Rule Task: Determine Review Path
  -> Gateway: Route by reviewPath
```

Di sini:

1. Java menyiapkan fakta.
2. DMN menentukan keputusan.
3. BPMN menjalankan alur berdasarkan keputusan.

---

## 4. Komponen Utama DMN

DMN punya beberapa konsep utama:

1. decision,
2. decision table,
3. input,
4. output,
5. rule,
6. hit policy,
7. FEEL expression,
8. DRD / decision requirements diagram,
9. business knowledge model,
10. knowledge source.

Dalam praktik Camunda, yang paling sering digunakan adalah:

```text
Decision Table + FEEL + Business Rule Task
```

Tetapi untuk sistem besar, kita juga perlu memahami DRD dan decision dependency.

---

## 5. Decision Table Anatomy

Decision table adalah bentuk tabel untuk mengekspresikan rule.

Contoh sederhana:

| Rule | License Type | Risk Score | Prior Violation | Review Path | SLA Days |
|---:|---|---:|---|---|---:|
| 1 | LOW_RISK | < 20 | false | AUTO_APPROVE | 1 |
| 2 | LOW_RISK | >= 20 | false | OFFICER_REVIEW | 3 |
| 3 | ANY | >= 70 | true | SENIOR_REVIEW | 5 |
| 4 | ANY | - | true | ENFORCEMENT_REVIEW | 7 |

Secara umum:

```text
Inputs  -> facts used by rule
Rules   -> condition rows
Outputs -> decision result
```

### 5.1 Input

Input adalah fakta yang dibutuhkan decision.

Contoh:

```text
licenseType
riskScore
priorViolationCount
isDocumentComplete
submissionChannel
```

Input harus:

1. jelas asalnya,
2. punya tipe data eksplisit,
3. punya naming stabil,
4. tidak ambigu,
5. tidak terlalu teknis,
6. tidak bergantung ke internal database schema.

Buruk:

```text
app.tbl_usr_cat_cd
xFlag
status2
```

Lebih baik:

```text
applicantCategory
hasOutstandingViolation
applicationStatus
```

### 5.2 Output

Output adalah hasil decision.

Contoh:

```text
reviewPath
slaDays
requiresSecondApproval
requiredDocuments
riskCategory
```

Output harus dapat dipakai oleh BPMN atau Java worker.

Output buruk:

```text
route = "go left"
```

Output lebih baik:

```text
reviewPath = "SENIOR_REVIEW"
```

Karena output harus meaningful secara business, bukan koordinat diagram.

### 5.3 Rule

Rule adalah baris decision table.

Contoh:

```text
IF licenseType = LOW_RISK
AND riskScore < 20
AND priorViolationCount = 0
THEN reviewPath = AUTO_APPROVE
```

Rule harus dilihat sebagai **policy row**.

Pertanyaan review:

1. Apakah rule ini punya owner?
2. Apakah rule ini punya dasar policy?
3. Apakah rule ini overlapping dengan rule lain?
4. Apakah ada input combination yang tidak tertangani?
5. Apakah output-nya stable?
6. Apakah perubahan rule akan mempengaruhi running process?

---

## 6. Hit Policy: Bagian Kecil yang Sering Menyebabkan Bug Besar

Hit policy menentukan bagaimana decision table memilih hasil ketika satu atau lebih rule match.

Ini sangat penting.

Camunda mendokumentasikan bahwa hit policy menentukan berapa banyak rule yang boleh match dan rule mana yang dimasukkan ke result. Hit policy seperti Unique, Any, dan First mengembalikan maksimal satu satisfied rule, sedangkan Rule Order dan Collect dapat mengembalikan banyak satisfied rule.

Secara engineering, hit policy adalah bagian dari contract.

Jika salah memilih hit policy, sistem bisa:

1. mengambil rule pertama padahal ada conflict,
2. mengabaikan rule yang seharusnya dipakai,
3. menghasilkan multiple outputs padahal BPMN mengharapkan single output,
4. gagal runtime karena hasil tidak sesuai tipe,
5. menyembunyikan overlapping policy.

---

## 7. Common Hit Policies

### 7.1 Unique

Unique berarti hanya boleh ada satu rule yang match.

Mental model:

```text
Exactly one business truth should apply.
```

Cocok untuk:

1. classification yang mutually exclusive,
2. routing path tunggal,
3. status derivation,
4. eligibility final decision.

Contoh:

| Rule | Score Range | Risk Category |
|---:|---|---|
| 1 | < 30 | LOW |
| 2 | 30..69 | MEDIUM |
| 3 | >= 70 | HIGH |

Unique cocok karena range tidak overlap.

Anti-pattern:

```text
Rule 1: riskScore >= 50 -> MEDIUM
Rule 2: riskScore >= 70 -> HIGH
```

Jika `riskScore = 80`, dua rule match. Itu bukan Unique yang sehat.

### 7.2 First

First berarti ambil rule pertama yang match.

Mental model:

```text
Rules are ordered by priority.
```

Cocok untuk:

1. exception-first policy,
2. override rule,
3. fallback rule,
4. ordered business priority.

Contoh:

| Rule | Condition | Review Path |
|---:|---|---|
| 1 | hasFraudFlag = true | ENFORCEMENT_REVIEW |
| 2 | riskScore >= 70 | SENIOR_REVIEW |
| 3 | riskScore >= 30 | OFFICER_REVIEW |
| 4 | - | AUTO_APPROVE |

Di sini urutan rule memang penting.

Bahaya:

```text
First can hide overlap.
```

Kalau business tidak sadar bahwa rule atas mengalahkan rule bawah, hasil bisa mengejutkan.

### 7.3 Any

Any berarti beberapa rule boleh match, tetapi output-nya harus sama.

Mental model:

```text
Multiple equivalent reasons, same result.
```

Cocok jika beberapa condition berbeda menghasilkan output sama.

Tetapi dalam banyak enterprise system, Any kurang eksplisit dibanding Unique/First.

### 7.4 Collect

Collect berarti kumpulkan semua hasil rule yang match.

Mental model:

```text
There may be multiple applicable outputs.
```

Cocok untuk:

1. required document list,
2. applicable warnings,
3. required checks,
4. notification recipients,
5. compliance flags.

Contoh:

| Rule | Condition | Required Document |
|---:|---|---|
| 1 | applicantType = COMPANY | ACRA_PROFILE |
| 2 | licenseType = FINANCIAL | FINANCIAL_STATEMENT |
| 3 | hasForeignDirector = true | FOREIGN_IDENTITY_DOC |
| 4 | highRisk = true | RISK_DECLARATION |

Output bisa berupa list:

```json
[
  "ACRA_PROFILE",
  "FINANCIAL_STATEMENT",
  "RISK_DECLARATION"
]
```

### 7.5 Rule Order

Rule Order mengembalikan hasil dari semua matching rules sesuai urutan rule.

Cocok jika urutan output penting secara business.

Contoh:

```text
ordered checklist steps
priority ordered recommendations
```

Tetapi harus hati-hati karena urutan tabel menjadi bagian dari contract.

---

## 8. Decision Table Completeness dan Consistency

Decision table yang baik bukan hanya bisa dieksekusi. Decision table yang baik harus:

1. complete,
2. consistent,
3. non-overlapping jika hit policy menuntut,
4. explicit fallback,
5. testable,
6. auditable.

### 8.1 Completeness

Completeness berarti semua input combination penting punya hasil.

Contoh buruk:

| Risk Score | Review Path |
|---|---|
| < 30 | AUTO_APPROVE |
| >= 70 | SENIOR_REVIEW |

Bagaimana dengan 30 sampai 69?

Process bisa gagal atau menghasilkan null.

Lebih baik:

| Risk Score | Review Path |
|---|---|
| < 30 | AUTO_APPROVE |
| 30..69 | OFFICER_REVIEW |
| >= 70 | SENIOR_REVIEW |

### 8.2 Consistency

Consistency berarti rule tidak menghasilkan keputusan yang saling bertentangan.

Contoh buruk:

| Rule | Condition | Review Path |
|---:|---|---|
| 1 | riskScore >= 70 | SENIOR_REVIEW |
| 2 | priorViolation = true | ENFORCEMENT_REVIEW |

Jika applicant punya `riskScore = 80` dan `priorViolation = true`, rule mana yang menang?

Jawabannya tergantung hit policy. Kalau tidak jelas, ini bukan hanya bug teknis; ini bug policy.

### 8.3 Explicit Fallback

Sering lebih aman punya fallback rule eksplisit.

Contoh:

```text
If no known rule matches -> MANUAL_TRIAGE
```

Fallback membantu production safety:

1. process tidak silently wrong,
2. unknown case masuk human review,
3. audit bisa melihat bahwa case tidak auto-decided,
4. policy gap bisa diperbaiki.

Tetapi fallback jangan dipakai untuk menyembunyikan decision table yang tidak lengkap.

---

## 9. FEEL: Expression Language untuk DMN dan BPMN

FEEL adalah expression language yang dipakai di DMN dan juga banyak konfigurasi BPMN di Camunda 8.

FEEL digunakan untuk menulis condition seperti:

```feel
riskScore >= 70
```

```feel
licenseType in ["MONEY_LENDER", "DEBT_COLLECTOR"]
```

```feel
priorViolationCount > 0 and riskScore >= 50
```

```feel
if documentComplete then "READY" else "INCOMPLETE"
```

### 9.1 Kenapa FEEL Penting?

Karena di Camunda 8, banyak expression memakai FEEL. Artinya engineer harus paham:

1. boolean expression,
2. null handling,
3. list,
4. range,
5. date/time,
6. context/object,
7. function,
8. comparison,
9. equality,
10. type behavior.

### 9.2 FEEL Bukan Java

Kesalahan umum adalah memperlakukan FEEL seperti Java.

Contoh Java-ish yang buruk:

```java
riskScore >= 70 && licenseType.equals("HIGH_RISK")
```

FEEL style:

```feel
riskScore >= 70 and licenseType = "HIGH_RISK"
```

### 9.3 FEEL Null Safety

Dalam decision engineering, null bukan detail kecil.

Pertanyaan penting:

```text
Apa arti missing value?
```

Contoh:

```text
priorViolationCount = null
```

Bisa berarti:

1. belum dihitung,
2. tidak tersedia,
3. tidak applicable,
4. applicant baru,
5. external system gagal,
6. data corrupted.

Jangan asal treat null sebagai 0.

Lebih aman buat fakta eksplisit:

```json
{
  "priorViolationKnown": true,
  "priorViolationCount": 0
}
```

atau:

```json
{
  "priorViolationStatus": "UNKNOWN"
}
```

Decision table harus bisa membedakan:

```text
NO_VIOLATION
HAS_VIOLATION
UNKNOWN
```

---

## 10. BPMN + DMN Integration Pattern

Pola umum integrasi BPMN dan DMN:

```text
Service Task: Prepare Decision Facts
  -> Business Rule Task: Evaluate Decision
  -> Exclusive Gateway: Route Based on Decision Result
```

Contoh:

```text
Prepare Application Review Facts
  -> Determine Review Path
  -> Gateway: reviewPath?
       AUTO_APPROVE      -> Issue Approval
       OFFICER_REVIEW    -> Officer Review Task
       SENIOR_REVIEW     -> Senior Review Task
       MANUAL_TRIAGE     -> Triage Task
```

### 10.1 Kenapa Perlu Prepare Facts?

DMN sebaiknya menerima facts yang sudah rapi.

Buruk:

```text
DMN membaca banyak field mentah dari process variable:
- rawApplicantJson
- rawExternalProfile
- rawViolationPayload
- rawDocumentPayload
```

Lebih baik:

```json
{
  "licenseType": "MONEY_LENDER",
  "riskScore": 82,
  "priorViolationCount": 2,
  "documentComplete": true,
  "paymentSettled": true,
  "crossAgencyFlag": false
}
```

Java worker bertugas:

1. mengambil data dari database,
2. memanggil external system jika perlu,
3. menghitung derived facts,
4. menormalisasi tipe,
5. snapshot facts,
6. mengirim facts ke DMN.

### 10.2 Kenapa Gateway Tetap Ada?

DMN menghasilkan decision result. BPMN tetap perlu routing.

Contoh:

```text
Decision result: reviewPath = SENIOR_REVIEW
```

BPMN gateway membaca hasil tersebut untuk menentukan flow.

Ini masih sehat karena gateway hanya membaca hasil decision, bukan memuat seluruh policy.

---

## 11. Jangan Campur Decision Logic dan Process Flow

### 11.1 Anti-pattern: Gateway Sebagai Decision Table

Buruk:

```text
Gateway 1: riskScore > 70?
Gateway 2: priorViolation?
Gateway 3: licenseType?
Gateway 4: applicantCategory?
Gateway 5: documentComplete?
Gateway 6: paymentSettled?
Gateway 7: specialScheme?
```

Masalah:

1. policy tersebar di diagram,
2. rule sulit direview business,
3. test path meledak,
4. perubahan kecil mengubah diagram besar,
5. overlap sulit dideteksi,
6. audit decision sulit dijelaskan.

Lebih baik:

```text
Business Rule Task: Determine Review Path
Gateway: route by reviewPath
```

### 11.2 Anti-pattern: DMN Sebagai Process Engine Mini

Sebaliknya, jangan masukkan flow ke DMN.

Buruk:

| Condition | Next Step |
|---|---|
| risk low | call approve service |
| risk high | create senior task |
| incomplete | send email |

DMN tidak seharusnya memerintahkan side effect.

Lebih baik:

| Condition | Review Path |
|---|---|
| risk low | AUTO_APPROVE |
| risk high | SENIOR_REVIEW |
| incomplete | REQUEST_INFO |

BPMN yang melakukan routing. Worker yang melakukan side effect.

### 11.3 Anti-pattern: Java Hidden Decision

Buruk:

```java
if (riskScore >= 70 && priorViolationCount > 0 && licenseType.equals("X")) {
    return ReviewPath.SENIOR_REVIEW;
}
```

Kalau rule ini murni policy bisnis dan sering berubah, menaruhnya di Java membuat:

1. business sulit review,
2. policy tersembunyi,
3. release diperlukan untuk perubahan kecil,
4. audit harus membaca code,
5. testing matrix kurang visible.

Tetapi tidak semua logic harus DMN. Jika logic kompleks, computational, technical, atau heavily algorithmic, Java tetap lebih cocok.

---

## 12. Decision Classification: Mana yang Cocok di DMN?

Gunakan tabel berikut.

| Jenis Logic | Cocok di BPMN | Cocok di DMN | Cocok di Java |
|---|---:|---:|---:|
| Urutan aktivitas | Ya | Tidak | Tidak utama |
| Human approval flow | Ya | Sebagian | Sebagian |
| Routing berdasarkan hasil policy | Sebagian | Ya | Sebagian |
| Rule table bisnis | Tidak | Ya | Bisa tapi kurang visible |
| Fee formula sederhana | Tidak | Ya | Ya |
| Risk algorithm kompleks | Tidak | Sebagian | Ya |
| External API call | Tidak | Tidak | Ya |
| Database aggregation | Tidak | Tidak | Ya |
| Authorization enforcement | Tidak utama | Tidak | Ya |
| SLA classification | Sebagian | Ya | Sebagian |
| Required document list | Tidak | Ya | Sebagian |
| ML scoring | Tidak | Tidak utama | Ya / ML service |
| Case lifecycle | Ya | Sebagian | Ya untuk domain state |

Rule of thumb:

```text
If business can express it as a table and expects to review/change it,
consider DMN.
```

```text
If it mutates state, calls systems, or requires complex algorithm,
keep it in Java/service.
```

```text
If it controls process order, keep it in BPMN.
```

---

## 13. Decision Input Contract

Decision input contract adalah daftar fakta yang dibutuhkan oleh DMN.

Contoh:

```yaml
decision: DetermineReviewPath
version: 1
inputs:
  applicationType:
    type: string
    allowedValues: [NEW, RENEWAL, AMENDMENT]
  licenseType:
    type: string
  riskScore:
    type: number
    range: 0..100
  priorViolationCount:
    type: number
    min: 0
  documentComplete:
    type: boolean
  paymentSettled:
    type: boolean
outputs:
  reviewPath:
    type: string
    allowedValues: [AUTO_APPROVE, OFFICER_REVIEW, SENIOR_REVIEW, MANUAL_TRIAGE]
  slaDays:
    type: number
  requiresSecondApproval:
    type: boolean
```

DMN tanpa input contract akan menjadi fragile.

### 13.1 Input Contract Harus Stabil

Jangan mengikat DMN langsung ke struktur internal DTO yang mudah berubah.

Buruk:

```json
{
  "application": {
    "payload": {
      "sectionA": {
        "x1": "..."
      }
    }
  }
}
```

Lebih baik:

```json
{
  "licenseType": "MONEY_LENDER",
  "riskScore": 82,
  "hasPriorViolation": true
}
```

### 13.2 Input Contract Harus Punya Semantic Meaning

DMN harus berbicara dengan bahasa business.

Buruk:

```text
flagA = true
```

Lebih baik:

```text
hasOutstandingComplianceIssue = true
```

### 13.3 Input Contract Perlu Snapshot

Untuk audit, decision harus bisa dijelaskan setelah fakta berubah.

Jika decision dibuat hari ini berdasarkan risk score 82, lalu besok risk score berubah menjadi 45, audit tetap harus bisa menjawab:

```text
Kenapa kemarin case diarahkan ke Senior Review?
```

Karena itu sistem perlu menyimpan:

1. decision id,
2. decision version,
3. input facts snapshot,
4. output result,
5. evaluation timestamp,
6. process instance key,
7. business key,
8. actor/system yang memicu evaluasi.

---

## 14. Decision Output Contract

Output DMN harus jelas dan actionable.

Contoh baik:

```json
{
  "reviewPath": "SENIOR_REVIEW",
  "slaDays": 5,
  "requiresSecondApproval": true,
  "reasonCode": "HIGH_RISK_PRIOR_VIOLATION"
}
```

Output buruk:

```json
{
  "result": "Y"
}
```

Output harus menjawab:

1. apa keputusannya,
2. apa konsekuensi prosesnya,
3. apa alasan ringkasnya,
4. apakah output bisa dipakai gateway,
5. apakah output bisa diaudit,
6. apakah output bisa ditampilkan ke officer jika perlu.

### 14.1 Reason Code

Reason code sangat penting dalam regulatory system.

Contoh:

```text
HIGH_RISK_PRIOR_VIOLATION
INCOMPLETE_REQUIRED_DOCUMENT
LATE_APPEAL_WITHOUT_JUSTIFICATION
ELIGIBLE_LOW_RISK_RENEWAL
```

Reason code membantu:

1. audit,
2. reporting,
3. explanation,
4. appeal handling,
5. debugging,
6. policy analytics.

Jangan hanya simpan `approved = false`.

Simpan juga alasan.

---

## 15. Decision Versioning

Decision logic berubah. Itu pasti.

Contoh perubahan:

```text
Sebelum:
  riskScore >= 70 -> SENIOR_REVIEW

Sesudah:
  riskScore >= 60 -> SENIOR_REVIEW
```

Pertanyaan engineering:

1. Apakah running process memakai decision version lama atau baru?
2. Apakah decision dievaluasi ulang otomatis?
3. Apakah hasil lama tetap valid?
4. Apakah audit bisa tahu versi rule yang dipakai?
5. Apakah perubahan rule berlaku retroaktif?
6. Siapa yang approve perubahan?
7. Apakah test matrix sudah diperbarui?

### 15.1 Decision Version vs Process Version

BPMN version dan DMN version tidak selalu sama.

Contoh:

```text
Process: Application Review v12
Decision: DetermineReviewPath v5
Decision: DetermineRequiredDocuments v8
Decision: CalculateSla v3
```

Perubahan DMN mungkin tidak perlu mengubah BPMN jika output contract tetap sama.

Tetapi jika output berubah, BPMN mungkin harus berubah juga.

### 15.2 Backward-compatible Decision Change

Contoh backward-compatible:

1. menambah rule baru untuk input case yang sebelumnya fallback,
2. mengubah threshold tetapi output schema tetap,
3. menambah reason code baru tetapi field tetap sama,
4. menambah output optional yang tidak dipakai BPMN lama.

### 15.3 Breaking Decision Change

Contoh breaking:

1. rename output `reviewPath` menjadi `routingPath`,
2. mengubah type `slaDays` dari number ke string,
3. menghapus output yang dipakai gateway,
4. mengubah allowed values tanpa update BPMN,
5. mengubah single result menjadi list result.

Breaking change harus dianggap seperti API contract change.

---

## 16. Decision Testing Strategy

Decision table harus dites seperti production code.

### 16.1 Unit Test untuk Decision Table

Test input-output:

| Test Case | Input | Expected Output |
|---|---|---|
| Low risk renewal | low risk, no violation | AUTO_APPROVE |
| High risk new app | high risk | SENIOR_REVIEW |
| Prior violation | violation true | ENFORCEMENT_REVIEW |
| Missing score | score unknown | MANUAL_TRIAGE |

### 16.2 Boundary Test

Boundary penting untuk threshold.

Contoh:

```text
riskScore = 29
riskScore = 30
riskScore = 69
riskScore = 70
```

Jika rule:

```text
< 30 -> LOW
30..69 -> MEDIUM
>= 70 -> HIGH
```

Maka boundary harus dites.

### 16.3 Overlap Test

Untuk Unique hit policy, pastikan tidak ada dua rule match.

Contoh overlap:

```text
Rule 1: riskScore >= 50
Rule 2: riskScore >= 70
```

Jika `riskScore = 80`, keduanya match.

Kalau Unique, ini harus dianggap defect.

### 16.4 Completeness Test

Pastikan tidak ada combination penting yang tanpa hasil.

Contoh:

```text
applicationType = RENEWAL
riskScore = null
priorViolationKnown = false
```

Apa output-nya?

Jika tidak ada, process bisa stuck atau salah route.

### 16.5 Regression Test

Setiap perubahan DMN harus menjalankan regression tests.

Tujuan:

1. detect output berubah tidak sengaja,
2. protect critical policy,
3. dokumentasikan expected behavior,
4. mendukung audit change.

---

## 17. DMN Dalam Java Application Architecture

### 17.1 Typical Architecture

```text
BPMN Process
  |
  | business rule task
  v
DMN Decision
  |
  | output variables
  v
BPMN Gateway / Worker
```

Di sisi Java:

```text
Worker: PrepareDecisionFactsWorker
  -> loads domain data
  -> normalizes decision facts
  -> stores fact snapshot if needed
  -> completes job with decision input variables

Business Rule Task:
  -> evaluates DMN
  -> produces decision output variables

Worker: ApplyDecisionWorker
  -> validates decision output
  -> updates domain state if needed
  -> emits audit/domain event
```

### 17.2 DTO untuk Decision Facts

Contoh Java DTO:

```java
public record ReviewPathDecisionFacts(
    String applicationType,
    String licenseType,
    int riskScore,
    int priorViolationCount,
    boolean documentComplete,
    boolean paymentSettled,
    boolean crossAgencyFlag
) {}
```

Untuk Java 8:

```java
public final class ReviewPathDecisionFacts {
    private final String applicationType;
    private final String licenseType;
    private final int riskScore;
    private final int priorViolationCount;
    private final boolean documentComplete;
    private final boolean paymentSettled;
    private final boolean crossAgencyFlag;

    public ReviewPathDecisionFacts(
            String applicationType,
            String licenseType,
            int riskScore,
            int priorViolationCount,
            boolean documentComplete,
            boolean paymentSettled,
            boolean crossAgencyFlag) {
        this.applicationType = applicationType;
        this.licenseType = licenseType;
        this.riskScore = riskScore;
        this.priorViolationCount = priorViolationCount;
        this.documentComplete = documentComplete;
        this.paymentSettled = paymentSettled;
        this.crossAgencyFlag = crossAgencyFlag;
    }

    public String getApplicationType() { return applicationType; }
    public String getLicenseType() { return licenseType; }
    public int getRiskScore() { return riskScore; }
    public int getPriorViolationCount() { return priorViolationCount; }
    public boolean isDocumentComplete() { return documentComplete; }
    public boolean isPaymentSettled() { return paymentSettled; }
    public boolean isCrossAgencyFlag() { return crossAgencyFlag; }
}
```

### 17.3 DTO untuk Decision Result

```java
public record ReviewPathDecisionResult(
    String reviewPath,
    int slaDays,
    boolean requiresSecondApproval,
    String reasonCode
) {}
```

Output ini harus divalidasi.

Contoh:

```java
public enum ReviewPath {
    AUTO_APPROVE,
    OFFICER_REVIEW,
    SENIOR_REVIEW,
    MANUAL_TRIAGE,
    ENFORCEMENT_REVIEW
}
```

Jangan biarkan string bebas dari DMN langsung mengontrol domain state tanpa validation.

---

## 18. Validate Decision Output di Java

DMN bisa salah dikonfigurasi. Output bisa null, typo, atau value tidak dikenali.

Contoh defensif:

```java
public ReviewPath parseReviewPath(String value) {
    try {
        return ReviewPath.valueOf(value);
    } catch (Exception ex) {
        throw new InvalidDecisionOutputException("Unknown reviewPath: " + value);
    }
}
```

Di worker:

```java
ReviewPath path = parseReviewPath(result.reviewPath());

switch (path) {
    case AUTO_APPROVE:
    case OFFICER_REVIEW:
    case SENIOR_REVIEW:
    case MANUAL_TRIAGE:
    case ENFORCEMENT_REVIEW:
        // ok
        break;
    default:
        throw new InvalidDecisionOutputException("Unsupported path");
}
```

Jika output invalid, itu biasanya bukan BPMN business error dari applicant. Itu configuration/policy defect. Biasanya lebih cocok menjadi incident agar operator memperbaiki decision/configuration.

---

## 19. Decision Audit Trail

Untuk regulatory system, hasil decision harus bisa dijelaskan.

Minimal audit record:

```json
{
  "decisionName": "DetermineReviewPath",
  "decisionVersion": 5,
  "businessKey": "APP-2026-000123",
  "processInstanceKey": "2251799813685249",
  "evaluatedAt": "2026-06-17T08:30:00+07:00",
  "inputFacts": {
    "applicationType": "NEW",
    "licenseType": "MONEY_LENDER",
    "riskScore": 82,
    "priorViolationCount": 2,
    "documentComplete": true
  },
  "output": {
    "reviewPath": "SENIOR_REVIEW",
    "slaDays": 5,
    "requiresSecondApproval": true,
    "reasonCode": "HIGH_RISK_PRIOR_VIOLATION"
  }
}
```

### 19.1 Why Snapshot Matters

Tanpa snapshot, audit hanya bisa melihat state terbaru.

Itu berbahaya.

Contoh:

```text
Hari Senin:
  riskScore = 82
  reviewPath = SENIOR_REVIEW

Hari Kamis:
  riskScore recalculated = 45
```

Kalau audit tidak menyimpan facts saat decision dibuat, officer bisa terlihat mengambil keputusan yang tidak sesuai data.

Padahal data berubah setelahnya.

### 19.2 Jangan Simpan PII Berlebihan

Snapshot bukan alasan untuk menyimpan semua data.

Simpan fakta yang dibutuhkan decision, bukan seluruh applicant profile.

Buruk:

```json
{
  "fullApplicantPayload": "... huge JSON with PII ..."
}
```

Lebih baik:

```json
{
  "applicantCategory": "COMPANY",
  "riskScore": 82,
  "priorViolationCount": 2
}
```

---

## 20. Decision Requirements Diagram / DRD

DRD menggambarkan dependency antar decision.

Contoh:

```text
Calculate Risk Category
        |
        v
Determine Review Path
        |
        v
Determine SLA
```

Atau:

```text
Determine Required Documents
    depends on:
      - Determine Applicant Category
      - Determine License Risk Category
      - Determine Cross Agency Requirement
```

### 20.1 Kapan DRD Berguna?

DRD berguna saat decision tidak berdiri sendiri.

Contoh regulatory case:

```text
Risk Category Decision
  input: riskScore, priorViolationCount
  output: LOW/MEDIUM/HIGH

Eligibility Decision
  input: licenseType, documentComplete, paymentSettled, riskCategory
  output: ELIGIBLE/NOT_ELIGIBLE/MANUAL_REVIEW

Review Path Decision
  input: eligibility, riskCategory, crossAgencyFlag
  output: AUTO_APPROVE/OFFICER_REVIEW/SENIOR_REVIEW
```

Jika semua dibuat dalam satu tabel besar, tabel bisa terlalu kompleks. DRD membantu decomposition.

### 20.2 Jangan Over-Decompose

Terlalu banyak decision kecil juga buruk.

Anti-pattern:

```text
Decision A -> Decision B -> Decision C -> Decision D -> Decision E
```

Masalah:

1. sulit trace,
2. banyak intermediate output,
3. sulit test end-to-end,
4. business bingung,
5. versioning rumit.

Gunakan DRD jika dependency memang business-significant.

---

## 21. DMN Untuk Assignment

DMN sering cocok untuk dynamic assignment.

Contoh:

```text
Input:
- licenseType
- region
- riskCategory
- workloadClass

Output:
- candidateGroup
- requiredRole
- escalationGroup
```

Decision table:

| License Type | Region | Risk Category | Candidate Group | Required Role |
|---|---|---|---|---|
| LOW_RISK | ANY | LOW | junior-officers | OFFICER |
| FINANCIAL | CENTRAL | HIGH | senior-financial-reviewers | SENIOR_OFFICER |
| ANY | ANY | HIGH | enforcement-reviewers | ENFORCEMENT_OFFICER |

BPMN user task kemudian memakai output:

```text
candidateGroups = candidateGroup
```

Tetapi authorization tetap harus ditegakkan di backend/security layer. DMN boleh membantu memilih assignment, bukan menjadi satu-satunya security control.

---

## 22. DMN Untuk SLA

SLA logic sering cocok untuk DMN.

Contoh:

| Priority | Risk Category | Case Type | SLA Days | Escalation Group |
|---|---|---|---:|---|
| HIGH | HIGH | ENFORCEMENT | 2 | enforcement-managers |
| MEDIUM | HIGH | APPLICATION | 5 | senior-review-managers |
| LOW | LOW | RENEWAL | 10 | operations-leads |

Output:

```json
{
  "slaDays": 5,
  "reminderDaysBeforeDue": 1,
  "escalationGroup": "senior-review-managers"
}
```

BPMN memakai output untuk:

1. due date user task,
2. timer boundary event,
3. reminder process,
4. dashboard aging.

Namun perhitungan calendar working day mungkin tetap di Java service.

Pattern:

```text
DMN decides SLA class/days
Java calendar service calculates actual due datetime
BPMN schedules timer/due date
```

---

## 23. DMN Untuk Required Documents

Required document decision cocok untuk Collect hit policy.

Contoh:

| Rule | Condition | Required Document |
|---:|---|---|
| 1 | applicantType = COMPANY | COMPANY_PROFILE |
| 2 | licenseType = FINANCIAL | FINANCIAL_STATEMENT |
| 3 | hasForeignShareholder = true | FOREIGN_SHAREHOLDER_DECLARATION |
| 4 | highRisk = true | RISK_ASSESSMENT_FORM |

Output:

```json
{
  "requiredDocuments": [
    "COMPANY_PROFILE",
    "FINANCIAL_STATEMENT",
    "RISK_ASSESSMENT_FORM"
  ]
}
```

Java worker kemudian:

1. validates document codes,
2. compares submitted documents,
3. marks missing documents,
4. creates user task/request info if missing,
5. records audit.

---

## 24. DMN Untuk Eligibility

Eligibility decision harus sangat hati-hati karena biasanya berdampak legal/regulatory.

Contoh output:

```json
{
  "eligibility": "NOT_ELIGIBLE",
  "reasonCode": "LICENSE_SUSPENDED",
  "canAppeal": true,
  "requiresManualOverride": false
}
```

Desain eligibility harus mempertimbangkan:

1. hard stop,
2. soft warning,
3. manual override,
4. appeal path,
5. reason code,
6. evidence source,
7. policy version,
8. effective date.

Jangan desain eligibility hanya sebagai boolean:

```json
{
  "eligible": false
}
```

Karena boolean tidak cukup menjelaskan konsekuensi.

Lebih baik:

```text
ELIGIBLE
NOT_ELIGIBLE
MANUAL_REVIEW_REQUIRED
TEMPORARILY_BLOCKED
PENDING_INFORMATION
```

---

## 25. Effective Date dan Policy Change

Regulatory decision sering punya effective date.

Contoh:

```text
Policy A berlaku sampai 2026-06-30.
Policy B berlaku mulai 2026-07-01.
```

Pertanyaan:

1. Apakah decision memakai submission date?
2. Apakah memakai evaluation date?
3. Apakah memakai approval date?
4. Apakah renewal period start date?
5. Apakah ada grandfathering rule?

Jangan anggap `now()` selalu benar.

Decision facts sebaiknya eksplisit:

```json
{
  "submissionDate": "2026-06-25",
  "evaluationDate": "2026-07-02",
  "policyEffectiveDate": "2026-07-01"
}
```

Lalu decision table menentukan rule berdasarkan tanggal yang benar.

---

## 26. DMN dan Manual Override

Banyak sistem regulatory membutuhkan manual override.

Contoh:

```text
DMN says: NOT_ELIGIBLE
Senior officer overrides: allow conditional approval
```

Desain yang sehat:

1. DMN menghasilkan recommendation/decision awal.
2. BPMN route ke manual review jika override diperbolehkan.
3. User harus memasukkan reason.
4. Backend memvalidasi permission.
5. Audit menyimpan original decision + override decision.
6. Final domain decision mencatat override actor dan reason.

Jangan overwrite output DMN tanpa jejak.

Audit record:

```json
{
  "originalDecision": "NOT_ELIGIBLE",
  "originalReasonCode": "MISSING_FINANCIAL_STATEMENT",
  "overrideDecision": "CONDITIONAL_APPROVAL",
  "overrideBy": "senior-officer-123",
  "overrideReason": "Document submitted via separate secured channel",
  "overrideAt": "2026-06-17T09:15:00+07:00"
}
```

---

## 27. DMN dan Authorization: Jangan Salah Tempat

DMN boleh menentukan assignment atau required role.

Contoh:

```text
requiredRole = SENIOR_OFFICER
```

Tetapi DMN tidak boleh menjadi satu-satunya authorization enforcement.

Authorization harus ditegakkan di:

1. backend API,
2. task completion endpoint,
3. domain service,
4. identity/role mapping,
5. audit layer.

DMN dapat membantu memilih:

```text
Who should handle this?
```

Tetapi backend harus menjawab:

```text
Is this actor allowed to perform this action now?
```

---

## 28. DMN dan Process Variables

DMN membaca input dari process variables dan menghasilkan output ke process variables.

Karena itu, Part 8 sangat relevan.

Prinsip:

```text
DMN input variables should be clean facts.
DMN output variables should be stable decision results.
```

Jangan gunakan DMN untuk membaca giant object.

Buruk:

```json
{
  "application": {
    "massiveNestedPayload": "..."
  }
}
```

Lebih baik:

```json
{
  "applicationType": "NEW",
  "licenseType": "MONEY_LENDER",
  "riskScore": 82,
  "priorViolationCount": 2
}
```

### 28.1 Variable Naming

Gunakan naming yang konsisten:

```text
reviewPath
reviewSlaDays
reviewReasonCode
requiredDocuments
eligibilityStatus
eligibilityReasonCode
```

Hindari:

```text
result
status
flag
output
x
```

---

## 29. BPMN Gateway Setelah DMN

Setelah DMN menghasilkan output, gateway harus sederhana.

Contoh sehat:

```text
Gateway: reviewPath
  AUTO_APPROVE -> Auto Approval
  OFFICER_REVIEW -> Officer Review Task
  SENIOR_REVIEW -> Senior Review Task
  MANUAL_TRIAGE -> Manual Triage Task
```

Gateway tidak perlu lagi mengandung policy:

```text
riskScore >= 70 and priorViolationCount > 0 and licenseType = ...
```

Itu sudah dipindahkan ke DMN.

---

## 30. Decision as Contract

DMN harus diperlakukan seperti API contract.

API contract punya:

1. endpoint,
2. input schema,
3. output schema,
4. error behavior,
5. version,
6. owner,
7. tests.

Decision contract juga harus punya:

1. decision id,
2. input facts,
3. output result,
4. hit policy,
5. fallback behavior,
6. version,
7. owner,
8. tests,
9. audit behavior,
10. change control.

Contoh contract:

```yaml
decisionId: DetermineReviewPath
owner: Licensing Policy Team
technicalOwner: Case Platform Team
hitPolicy: FIRST
inputFacts:
  - applicationType
  - licenseType
  - riskScore
  - priorViolationCount
  - documentComplete
outputs:
  - reviewPath
  - slaDays
  - requiresSecondApproval
  - reasonCode
fallback:
  reviewPath: MANUAL_TRIAGE
  reasonCode: NO_RULE_MATCHED
compatibility:
  output schema must remain backward compatible within major process version
audit:
  snapshot input/output for every evaluation
```

---

## 31. Decision Governance

Decision governance menjawab:

```text
Siapa yang boleh mengubah rule?
Bagaimana review dilakukan?
Bagaimana testing dilakukan?
Bagaimana deployment dilakukan?
Bagaimana rollback dilakukan?
Bagaimana audit dilakukan?
```

Tanpa governance, DMN bisa menjadi spreadsheet production yang tidak terkendali.

### 31.1 Role Dalam Governance

| Role | Responsibility |
|---|---|
| Business Owner | menentukan policy |
| Business Analyst | memodelkan rule |
| Software Engineer | memastikan executable, testable, integrated |
| QA | menguji scenario dan regression |
| Security/Compliance | review access dan audit impact |
| Operator | monitor incident dan decision failure |
| Change Approver | approve deployment |

### 31.2 Change Lifecycle

```text
Policy change request
  -> impact analysis
  -> update DMN
  -> update test cases
  -> review with business
  -> technical review
  -> deploy to test
  -> regression test
  -> UAT/business sign-off
  -> production deployment
  -> monitor decision metrics
```

### 31.3 Decision Review Checklist

1. Apakah input facts jelas?
2. Apakah output jelas?
3. Apakah hit policy tepat?
4. Apakah rule overlap disengaja?
5. Apakah semua important cases covered?
6. Apakah fallback aman?
7. Apakah reason code cukup?
8. Apakah test cases lengkap?
9. Apakah change backward-compatible?
10. Apakah audit snapshot tersedia?
11. Apakah sensitive data diminimalkan?
12. Apakah process routing sesuai output?

---

## 32. Decision Observability

Workflow observability tidak cukup hanya melihat process instance.

Kita juga perlu decision observability.

Metrics yang berguna:

1. jumlah evaluasi decision per hari,
2. distribusi output,
3. rule hit frequency,
4. fallback frequency,
5. manual override rate,
6. decision evaluation failure,
7. invalid output count,
8. top reason codes,
9. SLA decision distribution,
10. drift setelah policy change.

Contoh dashboard:

```text
DetermineReviewPath
  AUTO_APPROVE: 42%
  OFFICER_REVIEW: 38%
  SENIOR_REVIEW: 15%
  MANUAL_TRIAGE: 5%
```

Jika setelah policy change `MANUAL_TRIAGE` naik dari 5% ke 35%, itu sinyal:

1. rule gap,
2. input data problem,
3. unintended policy consequence,
4. upstream system change.

---

## 33. Failure Modes DMN

### 33.1 Missing Input

DMN mengharapkan `riskScore`, tetapi variable tidak ada.

Kemungkinan sebab:

1. worker prepare facts gagal,
2. variable renamed,
3. process version mismatch,
4. deployment mismatch,
5. bug mapper.

Mitigation:

1. validate facts before DMN,
2. schema contract test,
3. fail fast to incident,
4. clear error message.

### 33.2 Invalid Output

DMN menghasilkan `SENIOR_REVEW` typo.

Mitigation:

1. allowed values,
2. output validation worker,
3. enum mapping,
4. regression tests,
5. DMN review.

### 33.3 Overlapping Rules

Beberapa rule match padahal hit policy Unique.

Mitigation:

1. use correct hit policy,
2. test overlap,
3. use First only if priority explicit,
4. document rule order.

### 33.4 No Rule Matched

Tidak ada rule match.

Mitigation:

1. explicit fallback,
2. manual triage,
3. decision metrics,
4. alert on fallback spike.

### 33.5 Wrong Effective Date

Rule baru diterapkan ke case lama secara tidak sengaja.

Mitigation:

1. explicit policy date facts,
2. versioned decision,
3. audit snapshot,
4. clear retroactivity rule.

### 33.6 Hidden Breaking Change

Output schema berubah tanpa update BPMN.

Mitigation:

1. decision contract,
2. consumer-driven tests,
3. BPMN gateway validation,
4. deployment checklist.

---

## 34. DMN vs Rules Engine

DMN bukan satu-satunya cara mengelola rule.

Ada rules engine seperti Drools, custom policy service, database-driven rules, atau code-based rules.

### 34.1 DMN Cocok Jika

1. rule tabular,
2. business perlu membaca/review,
3. decision perlu audit,
4. decision dekat dengan workflow,
5. output dipakai BPMN,
6. complexity masih manageable,
7. rule change relatif sering tetapi terkendali.

### 34.2 Rules Engine Cocok Jika

1. banyak rule dengan inference,
2. forward/backward chaining,
3. complex fact matching,
4. conflict resolution sophisticated,
5. rule saling memicu,
6. domain knowledge sangat rule-heavy.

### 34.3 Java Code Cocok Jika

1. logic algorithmic,
2. performance critical,
3. strongly typed computation,
4. data access complex,
5. perlu library/domain model kaya,
6. rule jarang berubah,
7. business tidak perlu edit langsung.

Top engineer tidak fanatik. Pilih berdasarkan shape of problem.

---

## 35. DMN vs Database Configuration Table

Banyak sistem memakai table seperti:

```text
RULE_CONFIG
  condition_type
  operator
  value
  result
```

Ini bisa berguna, tetapi sering menjadi custom DMN buruk.

Risiko:

1. semantics tidak formal,
2. testing lemah,
3. overlap tidak terdeteksi,
4. UI admin sulit,
5. audit tidak jelas,
6. expression engine custom rentan bug,
7. security risk jika expression dynamic.

DMN memberi struktur yang lebih standar.

Namun, configuration table tetap cocok untuk mapping sederhana:

```text
licenseType -> defaultSlaDays
region -> officerGroup
documentCode -> displayName
```

Jika mulai butuh multiple inputs, hit policy, rule overlap, dan reason code, pertimbangkan DMN.

---

## 36. Worked Example: Regulatory Application Review

### 36.1 Business Problem

Sebuah agency menerima application license. System harus menentukan review path.

Input:

1. application type,
2. license type,
3. risk score,
4. prior violation count,
5. document completeness,
6. payment status,
7. cross-agency flag.

Output:

1. review path,
2. SLA days,
3. second approval required,
4. reason code.

### 36.2 BPMN Level

```text
Application Submitted
  -> Prepare Review Facts
  -> Determine Review Path [DMN]
  -> Route by Review Path
      AUTO_APPROVE
        -> Issue Approval
      OFFICER_REVIEW
        -> Officer Review
      SENIOR_REVIEW
        -> Senior Review
      MANUAL_TRIAGE
        -> Manual Triage
      ENFORCEMENT_REVIEW
        -> Enforcement Review
```

### 36.3 DMN Table

Hit policy: First

| Rule | Document Complete | Payment Settled | Prior Violation Count | Risk Score | Cross Agency Flag | Review Path | SLA Days | Second Approval | Reason Code |
|---:|---|---|---:|---:|---|---|---:|---|---|
| 1 | false | - | - | - | - | MANUAL_TRIAGE | 3 | false | INCOMPLETE_DOCUMENT |
| 2 | - | false | - | - | - | MANUAL_TRIAGE | 3 | false | PAYMENT_NOT_SETTLED |
| 3 | - | - | >= 2 | - | - | ENFORCEMENT_REVIEW | 5 | true | MULTIPLE_PRIOR_VIOLATIONS |
| 4 | - | - | >= 1 | >= 70 | - | SENIOR_REVIEW | 5 | true | HIGH_RISK_WITH_PRIOR_VIOLATION |
| 5 | - | - | - | >= 80 | true | SENIOR_REVIEW | 5 | true | HIGH_RISK_CROSS_AGENCY |
| 6 | - | - | 0 | < 30 | false | AUTO_APPROVE | 1 | false | LOW_RISK_CLEAN_HISTORY |
| 7 | - | - | - | - | - | OFFICER_REVIEW | 7 | false | DEFAULT_OFFICER_REVIEW |

### 36.4 Why First?

Karena urutan policy penting:

1. incomplete document harus ditangani dulu,
2. unpaid application tidak boleh lanjut auto-review,
3. multiple violations override risk score,
4. high risk routes to senior,
5. clean low risk can auto approve,
6. fallback officer review.

Jika memakai Unique, banyak rule bisa overlap. Jika memakai First, overlap boleh tetapi harus disengaja dan didokumentasikan.

### 36.5 Java Worker Prepare Facts

Pseudo-code:

```java
public final class PrepareReviewFactsWorker {

    private final ApplicationRepository applicationRepository;
    private final RiskService riskService;
    private final ViolationRepository violationRepository;
    private final DocumentService documentService;
    private final PaymentService paymentService;
    private final DecisionAuditRepository decisionAuditRepository;

    public Map<String, Object> prepare(String applicationId) {
        Application app = applicationRepository.findRequired(applicationId);

        int riskScore = riskService.calculateRiskScore(applicationId);
        int priorViolationCount = violationRepository.countPriorViolations(app.getApplicantId());
        boolean documentComplete = documentService.isComplete(applicationId);
        boolean paymentSettled = paymentService.isSettled(applicationId);

        Map<String, Object> facts = new LinkedHashMap<>();
        facts.put("applicationType", app.getApplicationType());
        facts.put("licenseType", app.getLicenseType());
        facts.put("riskScore", riskScore);
        facts.put("priorViolationCount", priorViolationCount);
        facts.put("documentComplete", documentComplete);
        facts.put("paymentSettled", paymentSettled);
        facts.put("crossAgencyFlag", app.isCrossAgencyFlag());

        return facts;
    }
}
```

### 36.6 Apply Decision Result

```java
public final class ApplyReviewPathDecisionWorker {

    public void apply(String applicationId, ReviewPathDecisionResult result) {
        ReviewPath path = ReviewPath.valueOf(result.reviewPath());

        switch (path) {
            case AUTO_APPROVE:
                // allow BPMN to continue to issue approval
                break;
            case OFFICER_REVIEW:
            case SENIOR_REVIEW:
            case MANUAL_TRIAGE:
            case ENFORCEMENT_REVIEW:
                // create/update domain review metadata if needed
                break;
            default:
                throw new InvalidDecisionOutputException("Unsupported review path: " + path);
        }
    }
}
```

### 36.7 Audit Record

```json
{
  "applicationId": "APP-2026-000123",
  "decision": "DetermineReviewPath",
  "hitPolicy": "FIRST",
  "inputFacts": {
    "applicationType": "NEW",
    "licenseType": "MONEY_LENDER",
    "riskScore": 82,
    "priorViolationCount": 1,
    "documentComplete": true,
    "paymentSettled": true,
    "crossAgencyFlag": false
  },
  "output": {
    "reviewPath": "SENIOR_REVIEW",
    "slaDays": 5,
    "requiresSecondApproval": true,
    "reasonCode": "HIGH_RISK_WITH_PRIOR_VIOLATION"
  }
}
```

---

## 37. Production Checklist untuk DMN

Sebelum deploy DMN ke production, cek:

### 37.1 Contract

- [ ] Decision id jelas.
- [ ] Input facts terdokumentasi.
- [ ] Output schema terdokumentasi.
- [ ] Hit policy dipilih sadar.
- [ ] Reason code tersedia untuk decision penting.
- [ ] Fallback behavior jelas.

### 37.2 Modeling

- [ ] BPMN tidak penuh gateway policy.
- [ ] DMN tidak berisi process flow.
- [ ] Java tidak menyembunyikan policy tabular.
- [ ] DRD dipakai hanya jika perlu.
- [ ] Rule order didokumentasikan jika memakai First.

### 37.3 Testing

- [ ] Boundary cases dites.
- [ ] Negative cases dites.
- [ ] Fallback dites.
- [ ] Overlap dites.
- [ ] Regression tests tersedia.
- [ ] BPMN integration test tersedia.

### 37.4 Audit

- [ ] Input snapshot disimpan jika decision berdampak penting.
- [ ] Output snapshot disimpan.
- [ ] Decision version disimpan.
- [ ] Reason code disimpan.
- [ ] Manual override disimpan.

### 37.5 Security

- [ ] DMN tidak menyimpan PII berlebihan.
- [ ] Authorization tidak hanya bergantung ke DMN.
- [ ] Rule change access controlled.
- [ ] Production deployment approved.

### 37.6 Operations

- [ ] Invalid output menjadi incident/alert.
- [ ] Fallback spike dimonitor.
- [ ] Decision distribution dimonitor.
- [ ] Runbook tersedia untuk decision failure.
- [ ] Rollback/change strategy jelas.

---

## 38. Mental Model Ringkas

Gunakan model ini:

```text
BPMN = process coordination
DMN  = business decision
FEEL = expression language
Java = domain computation and side effects
DB   = source of truth for domain state
Audit = explanation layer
```

Jangan campur semua ke satu tempat.

Jika policy masuk BPMN, diagram menjadi kompleks.

Jika flow masuk DMN, decision table menjadi process engine palsu.

Jika semua decision masuk Java, business kehilangan visibility.

Jika process variable menjadi database, audit dan operability rusak.

Engineering yang matang adalah seni menaruh logic di tempat yang tepat.

---

## 39. Kesimpulan Part 11

DMN bukan sekadar fitur tambahan Camunda. DMN adalah cara untuk membuat decision logic menjadi:

1. eksplisit,
2. readable,
3. testable,
4. versionable,
5. auditable,
6. maintainable,
7. reviewable oleh business,
8. terpisah dari process flow.

Untuk sistem regulatory, DMN sangat berguna karena banyak keputusan berbasis policy:

1. eligibility,
2. risk category,
3. review path,
4. SLA,
5. required document,
6. assignment,
7. escalation,
8. override rule.

Tetapi DMN juga bisa berbahaya jika:

1. tanpa governance,
2. tanpa testing,
3. tanpa versioning,
4. tanpa audit snapshot,
5. dipakai untuk side effect,
6. dipakai sebagai pengganti authorization,
7. dipakai sebagai dumping ground rule kompleks.

Top 1% engineer melihat DMN sebagai **decision contract**, bukan sebagai spreadsheet ajaib.

---

## 40. Hubungan ke Part Berikutnya

Part berikutnya akan membahas:

# Part 12 — Message Correlation and Event-driven Process Design

Kita akan masuk ke bagaimana process berinteraksi dengan dunia luar secara event-driven:

1. message start event,
2. intermediate message catch event,
3. correlation key,
4. business key,
5. message TTL,
6. duplicate message,
7. message arrives before subscription,
8. Kafka/RabbitMQ integration,
9. outbox-to-Camunda message pattern,
10. eventual consistency,
11. orchestration vs choreography.

Decision engineering menentukan **apa hasilnya**.

Message correlation menentukan **bagaimana process menerima fakta/event dari dunia luar secara benar**.

---

## Status Seri

Seri belum selesai.

Selesai sampai saat ini:

1. Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
2. Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
3. Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
4. Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
5. Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
6. Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
7. Part 6 — Java Client Engineering: From API Call to Production-grade Worker
8. Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
9. Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
10. Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
11. Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
12. Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic

Berikutnya:

13. Part 12 — Message Correlation and Event-driven Process Design

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-10-human-workflow-user-task-assignment-forms-sla-authorization.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-12-message-correlation-event-driven-process-design.md)

</div>