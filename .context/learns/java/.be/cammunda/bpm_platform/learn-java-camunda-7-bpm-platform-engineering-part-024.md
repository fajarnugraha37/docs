# learn-java-camunda-7-bpm-platform-engineering-part-024

# DMN/CMMN in Camunda 7: Decision Automation, Case Management, and When Not to Use Them

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `024`  
> Topik: DMN, CMMN, decision automation, case management, BPMN integration, governance, testing, versioning, and anti-patterns  
> Target: Java engineer/tech lead yang ingin mendesain process platform Camunda 7 secara defensible, maintainable, dan production-grade.

---

## 0. Posisi Bagian Ini dalam Seri

Bagian sebelumnya sudah membahas:

- engine architecture,
- transaction/wait-state semantics,
- async/job executor,
- database schema,
- variable system,
- delegation code,
- external task,
- message correlation,
- timer/SLA,
- human task,
- history/audit,
- incident/error/recovery,
- versioning/migration,
- multi-tenancy/security,
- Spring Boot/Java EE integration,
- REST API governance.

Bagian ini masuk ke dua kemampuan Camunda 7 yang sering dianggap “tambahan”, tetapi di enterprise workflow bisa menjadi sangat penting:

1. **DMN** — Decision Model and Notation: memodelkan keputusan sebagai decision table/decision requirement, bukan sebagai `if/else` tersembunyi di Java code atau BPMN gateway.
2. **CMMN** — Case Management Model and Notation: memodelkan case yang tidak selalu linear, di mana pekerjaan bisa muncul/aktif/selesai berdasarkan kondisi case dan discretionary behavior.

Namun bagian ini sengaja tidak akan menjadi tutorial visual DMN/CMMN dasar. Kita akan membahasnya dari sudut **platform engineering**:

- kapan DMN tepat,
- kapan DMN berbahaya,
- kapan CMMN masuk akal,
- kenapa CMMN harus dipakai sangat hati-hati di Camunda 7 estate modern,
- bagaimana DMN/CMMN berinteraksi dengan BPMN, database, versioning, audit, testing, dan Java runtime,
- bagaimana mendesain decision/case layer agar defensible secara regulatori.

---

## 1. Mental Model Utama

### 1.1 BPMN, DMN, dan CMMN Menjawab Pertanyaan Berbeda

| Notation | Pertanyaan utama | Cocok untuk | Risiko jika disalahgunakan |
|---|---|---|---|
| BPMN | “Apa urutan/koordinasi pekerjaan?” | proses, orchestration, wait state, human/system flow | menjadi spaghetti flow jika dipakai untuk semua rule |
| DMN | “Keputusan apa yang harus diambil dari fakta ini?” | rule, eligibility, scoring, classification, routing decision | menjadi hidden application language jika rule terlalu prosedural |
| CMMN | “Dalam case ini, aktivitas apa yang mungkin/harus tersedia bergantung kondisi?” | case management fleksibel, discretionary work, investigation | sulit dioperasikan, sulit dimigrasi, kurang familiar dibanding BPMN |

BPMN lebih dekat ke **state transition/orchestration**.  
DMN lebih dekat ke **pure decision evaluation**.  
CMMN lebih dekat ke **case lifecycle with dynamic availability**.

Top 1% engineer tidak bertanya “bisa dibuat di Camunda?” tetapi:

> “Notation mana yang membuat invariant, audit, failure recovery, dan future change paling jelas?”

---

## 2. DMN di Camunda 7: Apa Sebenarnya?

Camunda DMN engine adalah Java library yang bisa mengevaluasi DMN decision table. Di Camunda 7, DMN dapat dipakai:

1. sebagai library embedded di aplikasi Java,
2. melalui Camunda process engine,
3. dari BPMN business rule task,
4. dari CMMN decision task,
5. melalui `DecisionService`,
6. melalui REST API.

Secara mental, DMN adalah:

```text
input facts + decision definition version -> deterministic decision result
```

Contoh:

```text
facts:
  applicantType = "COMPANY"
  outstandingFineAmount = 12000
  licenseStatus = "SUSPENDED"
  previousViolationCount = 3

DMN decision:
  enforcementActionDecision:v12

result:
  action = "ESCALATE_TO_INVESTIGATION"
  severity = "HIGH"
  requiredApprovalLevel = "DIRECTOR"
```

DMN tidak seharusnya menjadi tempat untuk:

- call REST API,
- update database,
- send email,
- create task,
- mutate process state,
- execute workflow steps.

DMN yang sehat cenderung **side-effect free**.

---

## 3. Kenapa DMN Dibutuhkan kalau Java Sudah Bisa `if/else`?

Java bisa menulis semua rule:

```java
if (applicantType == COMPANY
    && outstandingFineAmount > 10000
    && licenseStatus == SUSPENDED
    && previousViolationCount >= 3) {
  return ESCALATE_TO_INVESTIGATION;
}
```

Masalahnya bukan kemampuan Java. Masalahnya adalah **governance**.

### 3.1 Rule yang Disembunyikan di Java Sulit Diaudit

Jika decision logic tertanam di service code:

- business user sulit review,
- QA sulit membuat coverage per rule,
- auditor sulit melihat decision basis,
- perubahan rule memerlukan code release,
- versi rule sulit dikaitkan dengan case history,
- regression impact sulit dianalisis.

DMN membuat rule menjadi artifact eksplisit.

### 3.2 DMN Mengubah Rule Menjadi Model yang Bisa Diuji

Dengan DMN, kita bisa memperlakukan decision sebagai contract:

```text
Given facts F
When decision D version V evaluated
Then result R must be produced
And evaluation should be recorded for audit
```

Ini sangat penting untuk:

- eligibility,
- enforcement severity,
- routing,
- SLA category,
- fee classification,
- risk scoring,
- approval matrix,
- document completeness,
- escalation level.

---

## 4. Decision Table Anatomy

Decision table umumnya terdiri dari:

```text
Decision
├── Inputs
│   ├── input expression
│   └── input entries / conditions
├── Outputs
│   ├── output name
│   └── output type
├── Rules
│   ├── condition cells
│   └── output cells
└── Hit Policy
```

Contoh konseptual:

| applicantType | riskScore | violationCount | action | approvalLevel |
|---|---:|---:|---|---|
| COMPANY | >= 80 | >= 3 | INVESTIGATE | DIRECTOR |
| COMPANY | >= 50 | >= 1 | REVIEW | MANAGER |
| INDIVIDUAL | >= 70 | >= 2 | REVIEW | MANAGER |
| - | < 50 | - | AUTO_APPROVE | SYSTEM |

Decision table menjawab:

> Dari input facts ini, rule mana yang match, dan output apa yang dihasilkan?

---

## 5. Hit Policy: Bagian Kecil yang Sering Menentukan Correctness

Hit policy menentukan bagaimana rule yang match diperlakukan.

### 5.1 Unique

Makna:

```text
Paling banyak satu rule boleh match.
```

Cocok untuk:

- classification tunggal,
- approval level tunggal,
- deterministic routing,
- eligibility decision.

Risiko:

- jika dua rule match, model invalid secara logika bisnis.

### 5.2 First

Makna:

```text
Ambil rule pertama yang match berdasarkan urutan table.
```

Cocok untuk:

- priority rule,
- override rule,
- ordered exception handling.

Risiko:

- urutan rule menjadi semantic tersembunyi,
- reviewer bisa salah mengira semua rule setara,
- refactoring row order bisa mengubah behavior.

### 5.3 Any

Makna:

```text
Banyak rule boleh match, tetapi output-nya harus sama.
```

Cocok untuk:

- beberapa kondisi equivalent menghasilkan keputusan sama.

Risiko:

- memberi rasa aman palsu; duplicate match bisa menyembunyikan modelling overlap.

### 5.4 Collect

Makna:

```text
Kumpulkan semua output dari semua rule yang match.
```

Cocok untuk:

- list of required documents,
- list of warnings,
- list of applicable checks,
- list of obligations.

Risiko:

- output menjadi collection yang harus ditangani hati-hati oleh BPMN/Java,
- order dan aggregation semantics harus jelas,
- duplicate output harus dikontrol.

### 5.5 Rule Order / Output Order

Cocok untuk:

- recommendation list,
- ordered obligations,
- ordered task generation.

Risiko:

- decision result berubah jika row order berubah.

### 5.6 Priority

Cocok untuk:

- memilih severity tertinggi,
- memilih action berdasarkan output priority list.

Risiko:

- priority list harus dipahami reviewer,
- bukan sekadar “angka terbesar menang” jika output priority didefinisikan secara eksplisit.

### 5.7 Aggregation Policies

Collect bisa dikombinasikan dengan aggregation seperti sum/min/max/count tergantung engine support dan modelling.

Cocok untuk:

- scoring,
- total penalty points,
- count of violations.

Risiko:

- aggregate numeric sering tampak sederhana, tetapi butuh definisi domain jelas:
  - apakah null dihitung?
  - apakah duplicate dihitung?
  - apakah score capped?
  - apakah negative adjustment boleh?

---

## 6. Decision Table Bukan Spreadsheet Biasa

Decision table sering terlihat seperti spreadsheet, tetapi ia adalah **executable logic artifact**.

Konsekuensinya:

1. Setiap row adalah rule.
2. Setiap cell adalah expression/condition.
3. Setiap hit policy adalah semantic contract.
4. Setiap deployment membuat versioned decision definition.
5. Setiap evaluation bisa menghasilkan historic decision instance.
6. Setiap output bisa memengaruhi process path.

Artinya, perubahan kecil seperti:

- menukar urutan rule,
- mengubah `>=` menjadi `>`,
- mengubah empty cell,
- menambahkan output column,
- mengganti hit policy,

bisa menjadi production behavior change.

---

## 7. DMN Expression: FEEL, JUEL, dan Bahasa Ekspresi

Camunda 7 DMN bisa memakai expression language tertentu tergantung bagian dan konfigurasi. Dalam praktik Camunda 7 modern, FEEL sangat penting karena DMN memang dirancang dekat dengan FEEL.

### 7.1 FEEL Mental Model

FEEL berarti Friendly Enough Expression Language. Tujuannya adalah membuat expression decision bisa dibaca oleh business/analyst lebih mudah dibanding Java.

Contoh:

```text
riskScore >= 80
applicantType = "COMPANY"
violationCount in [3..10]
licenseStatus = "SUSPENDED"
```

### 7.2 Bahaya Expression yang Terlalu Pintar

Expression yang terlalu kompleks membuat DMN berubah menjadi “programming language tersembunyi”.

Contoh smell:

```text
if count(items[category = "A" and amount > 1000]) > 3
then if applicant.country = "SG" then "A" else "B"
else if contains(tags, "manual-review") then "C" else "D"
```

Masalah:

- susah dites,
- susah direview,
- susah dijelaskan ke auditor,
- susah dipindahkan antar versi engine,
- susah di-debug ketika input null/tipe salah.

### 7.3 Rule of Thumb

Gunakan DMN expression untuk:

- comparison,
- membership,
- simple range,
- simple boolean logic,
- simple value mapping.

Pindahkan ke Java/domain service jika:

- butuh query database,
- butuh remote call,
- butuh heavy computation,
- butuh complex normalization,
- butuh iterative algorithm,
- butuh external policy data yang besar.

---

## 8. DMN Input Contract

DMN membutuhkan input facts. Input facts harus stabil, jelas, dan typed.

### 8.1 Jangan Lempar Semua Process Variables ke DMN

Anti-pattern:

```java
runtimeService.setVariables(processInstanceId, hugeVariableMap);
// lalu DMN membaca variabel apa pun dari process context
```

Dampak:

- DMN bergantung pada variable liar,
- sulit tahu input mana yang sebenarnya dipakai,
- sulit membuat test case,
- sulit audit,
- perubahan process variable bisa merusak decision.

### 8.2 Buat Decision Input DTO

Lebih sehat:

```java
public record EnforcementRiskDecisionInput(
    String applicantType,
    String licenseStatus,
    int previousViolationCount,
    BigDecimal outstandingFineAmount,
    boolean hasOpenInvestigation,
    LocalDate applicationDate
) {}
```

Lalu map menjadi variables/facts eksplisit:

```java
Map<String, Object> facts = Map.of(
    "applicantType", input.applicantType(),
    "licenseStatus", input.licenseStatus(),
    "previousViolationCount", input.previousViolationCount(),
    "outstandingFineAmount", input.outstandingFineAmount(),
    "hasOpenInvestigation", input.hasOpenInvestigation(),
    "applicationDate", input.applicationDate().toString()
);
```

### 8.3 Decision Input Harus Bernilai Snapshot

Decision tidak boleh bergantung pada mutable external state secara implisit.

Buruk:

```text
DMN membaca current license status dari service ketika evaluate.
```

Lebih baik:

```text
Application service mengambil license status, membentuk snapshot input, lalu DMN evaluate berdasarkan snapshot tersebut.
```

Kenapa?

Karena audit butuh menjawab:

> “Keputusan dibuat berdasarkan fakta apa pada waktu itu?”

Bukan:

> “Keputusan dibuat berdasarkan data yang sekarang sudah berubah.”

---

## 9. DMN Output Contract

Output DMN harus dianggap sebagai API contract.

### 9.1 Output yang Baik

Contoh:

```text
action: "ROUTE_TO_MANAGER_REVIEW"
approvalLevel: "MANAGER"
riskBand: "HIGH"
requiredDocuments: ["FINANCIAL_STATEMENT", "DIRECTOR_DECLARATION"]
reasonCode: "HIGH_OUTSTANDING_FINE_AND_PRIOR_VIOLATION"
```

Ciri output yang baik:

- typed,
- enumerable jika memungkinkan,
- punya reason code,
- tidak berupa free text utama,
- tidak terlalu banyak field,
- backward-compatible.

### 9.2 Output yang Buruk

```text
result = "do manager thing"
```

Masalah:

- ambiguous,
- sulit dites,
- sulit dikaitkan ke BPMN path,
- sulit diaudit,
- raw text bisa berubah tanpa governance.

### 9.3 Reason Code Sangat Penting

Untuk regulatory workflow, output sebaiknya menyertakan reason code.

```text
riskBand = HIGH
reasonCode = PRIOR_VIOLATION_COUNT_GE_3_AND_FINE_GT_10000
```

Reason code membantu:

- audit,
- explanation,
- notification template,
- appeal handling,
- analytics,
- regression testing.

---

## 10. DMN dalam BPMN: Business Rule Task

Di BPMN, DMN biasanya dipanggil dengan **Business Rule Task**.

Mental model:

```text
BPMN reaches business rule task
-> engine evaluates decision definition
-> result mapped to process variable
-> BPMN continues based on result
```

Contoh flow:

```text
Start
  -> Collect Application Facts
  -> Evaluate Risk Decision (DMN)
  -> Gateway: riskBand
      LOW    -> Auto Approve
      MEDIUM -> Officer Review
      HIGH   -> Investigation Review
```

### 10.1 Kapan Business Rule Task Cocok

Cocok jika:

- decision adalah bagian dari process flow,
- output menentukan routing,
- decision harus versioned bersama platform,
- decision evaluation perlu history,
- input sudah tersedia sebagai process variable.

### 10.2 Kapan Jangan Memakai Business Rule Task

Jangan jika:

- decision dipakai lintas banyak aplikasi tanpa process context,
- decision perlu latency sangat rendah dan high QPS,
- decision butuh custom cache/governance service,
- decision merupakan domain API yang harus tersedia independen dari Camunda engine,
- output tidak terkait workflow.

Alternatif:

```text
Application Service -> DecisionService/embedded DMN -> Domain Result
```

atau:

```text
Dedicated Decision Service -> DMN engine embedded -> REST/gRPC API
```

---

## 11. DecisionService di Java

Camunda menyediakan API untuk evaluate decision.

Contoh konseptual:

```java
DmnDecisionTableResult result = decisionService
    .evaluateDecisionTableByKey("enforcementRiskDecision")
    .variables(facts)
    .evaluate();

String action = result.getSingleResult().getSingleEntry();
```

Untuk output multi-column:

```java
DmnDecisionTableResult result = decisionService
    .evaluateDecisionTableByKey("enforcementRoutingDecision")
    .variables(facts)
    .evaluate();

Map<String, Object> row = result.getSingleResult();
String action = (String) row.get("action");
String approvalLevel = (String) row.get("approvalLevel");
String reasonCode = (String) row.get("reasonCode");
```

Dalam production, jangan biarkan raw `Map<String,Object>` menyebar jauh ke domain logic. Bungkus hasil DMN menjadi typed result:

```java
public record EnforcementRoutingDecisionResult(
    EnforcementAction action,
    ApprovalLevel approvalLevel,
    RiskBand riskBand,
    String reasonCode
) {}
```

Adapter:

```java
public final class EnforcementRoutingDecisionAdapter {

    private final DecisionService decisionService;

    public EnforcementRoutingDecisionResult evaluate(EnforcementRiskDecisionInput input) {
        Map<String, Object> facts = mapFacts(input);

        DmnDecisionTableResult result = decisionService
            .evaluateDecisionTableByKey("enforcementRoutingDecision")
            .variables(facts)
            .evaluate();

        Map<String, Object> row = result.getSingleResult();

        return new EnforcementRoutingDecisionResult(
            EnforcementAction.valueOf((String) row.get("action")),
            ApprovalLevel.valueOf((String) row.get("approvalLevel")),
            RiskBand.valueOf((String) row.get("riskBand")),
            (String) row.get("reasonCode")
        );
    }

    private Map<String, Object> mapFacts(EnforcementRiskDecisionInput input) {
        return Map.of(
            "applicantType", input.applicantType(),
            "licenseStatus", input.licenseStatus(),
            "previousViolationCount", input.previousViolationCount(),
            "outstandingFineAmount", input.outstandingFineAmount(),
            "hasOpenInvestigation", input.hasOpenInvestigation(),
            "applicationDate", input.applicationDate().toString()
        );
    }
}
```

---

## 12. DMN Repository, Versioning, and Deployment

DMN definitions are deployed like BPMN resources.

Important identities:

```text
decisionDefinitionKey
decisionDefinitionId
version
versionTag
deploymentId
tenantId
```

### 12.1 Evaluate by Key vs Version vs Id

Evaluate by key usually means latest version unless constrained.

This is convenient but risky for long-running/auditable workflows.

Ask:

> Should this process instance use the latest decision at time of evaluation, or the decision version that was current when the process started?

Both can be correct depending on business policy.

### 12.2 Version Policy Examples

| Scenario | Suggested policy |
|---|---|
| New application eligibility | latest rule at evaluation time |
| Appeal of old decision | original decision version or explicit appeal rule version |
| Long-running enforcement investigation | rule version anchored at case opening or legal event date |
| SLA category recalculation | maybe latest rule, but audit old calculation |
| Fee computation | version tied to effective regulation date |

### 12.3 Effective Date Is Not Same as Deployment Date

A DMN deployment date is technical.

Business/legal rules often have effective dates:

```text
Rule version v12 deployed: 2026-06-01
Rule effective from: 2026-07-01
Rule applies to applications submitted from: 2026-07-01
```

Do not confuse:

- deployment time,
- evaluation time,
- case creation time,
- event occurrence time,
- legal effective date.

A production-grade decision layer often needs:

```text
ruleKey + ruleVersion + effectiveFrom + effectiveTo + jurisdiction + tenant + decisionDefinitionId
```

---

## 13. DMN History and Audit

Camunda can store historic decision instances depending on history configuration.

Useful audit questions:

- Which decision was evaluated?
- Which decision definition version?
- When?
- For which process instance/activity?
- What input values?
- What output values?
- Which rules matched?
- Which user/process triggered it?

But do not assume DMN history alone is a complete regulatory audit trail.

### 13.1 Domain Audit Still Needed

For defensibility, record domain-level audit:

```text
caseId
businessEventId
decisionKey
decisionDefinitionId
decisionVersion
decisionVersionTag
inputSnapshotHash
inputSnapshotLocation
outputSnapshot
reasonCode
actor/system
correlationId
timestamp
legalBasis/regulationVersion
```

Camunda history is process-engine history. Domain audit is business/legal evidence.

---

## 14. DMN Testing Strategy

DMN without tests is dangerous because table changes look harmless.

### 14.1 Golden Case Tests

For every important rule:

```text
input facts -> expected output
```

Example:

| Test | applicantType | fine | violations | expectedAction |
|---|---|---:|---:|---|
| high risk company | COMPANY | 12000 | 3 | INVESTIGATE |
| low risk individual | INDIVIDUAL | 0 | 0 | AUTO_APPROVE |
| medium risk company | COMPANY | 5000 | 1 | REVIEW |

### 14.2 Boundary Tests

Boundary values are critical:

```text
9999 vs 10000 vs 10001
2 vs 3 violations
expiryDate today vs yesterday vs tomorrow
age 17 vs 18
```

### 14.3 Overlap Tests

For Unique hit policy, test that no input matches multiple rules.

This can be hard exhaustively, but you can create:

- domain sample generation,
- property-like tests,
- rule review checklist,
- DMN simulation matrix.

### 14.4 Null/Missing Input Tests

DMN often fails or behaves unexpectedly around null/missing input.

Test:

- missing variable,
- null variable,
- empty string,
- wrong type,
- out-of-range value,
- unknown enum.

### 14.5 Regression Pack Per Regulation Version

For regulatory systems, store regression packs with regulation/rule version:

```text
/rules/enforcement/v12/test-cases.csv
/rules/enforcement/v13/test-cases.csv
```

When table changes, expected output changes must be reviewed explicitly.

---

## 15. DMN Governance

DMN creates the possibility that non-developers can understand or even author rules. But governance is mandatory.

### 15.1 Rule Change Workflow

Minimum rule change lifecycle:

```text
Propose rule change
-> Business/legal review
-> Technical review
-> Test case update
-> Simulation/regression
-> Approval
-> Deployment
-> Post-deploy verification
-> Audit record
```

### 15.2 Review Checklist

For every DMN change:

- Did hit policy change?
- Did output contract change?
- Did input contract change?
- Are new enum values handled by Java/BPMN/UI/reporting?
- Are old process instances affected?
- Is effective date clear?
- Are test cases updated?
- Are audit reason codes stable?
- Are tenant/jurisdiction variations explicit?
- Is fallback/default rule intentional?

### 15.3 Model Ownership

Decision ownership should be explicit:

| Artifact | Owner |
|---|---|
| DMN model | business/rule owner + engineering co-owner |
| Input contract | engineering/domain owner |
| Output contract | engineering/domain owner |
| Test pack | QA + rule owner |
| Deployment | release owner |
| Audit interpretation | compliance/legal/business owner |

---

## 16. DMN Anti-Patterns

### 16.1 DMN as Giant Spreadsheet Dump

Smell:

- hundreds/thousands of rows,
- mixed concerns,
- unclear hit policy,
- no tests,
- no reason code,
- duplicated conditions,
- huge output payload.

Better:

- split into smaller decisions,
- use DRD/decision requirements,
- isolate classification, scoring, routing, and obligation decisions.

### 16.2 DMN as Programming Language

Smell:

- nested expressions,
- business logic hidden in FEEL functions,
- hard-to-read conditions,
- dependency on external state.

Better:

- normalize/derive complex facts in Java/domain service,
- keep DMN as declarative decision layer.

### 16.3 Gateway Explosion Instead of DMN

Bad BPMN:

```text
Gateway applicant type
  -> Gateway risk score
     -> Gateway violation count
        -> Gateway license status
```

Better:

```text
Business Rule Task: Evaluate Routing Decision
-> Gateway on routingAction
```

### 16.4 DMN Result Directly Driving Sensitive Action Without Domain Validation

Bad:

```text
DMN says AUTO_APPROVE -> process auto-approves license
```

Better:

```text
DMN recommends AUTO_APPROVE
-> domain service validates invariant
-> process applies transition
-> audit records reason
```

DMN should not be the only guard for critical domain invariant.

### 16.5 No Version/Eff-Date Policy

Bad:

```text
Always evaluate latest decision by key.
```

Without policy, old cases can be affected by new rules unexpectedly.

---

## 17. Decision Requirements Graph / DRD

A Decision Requirements Diagram/Graph helps decompose complex decisions.

Example:

```text
Final Enforcement Action
├── Risk Band Decision
│   ├── Violation Severity Decision
│   └── Compliance History Decision
├── Approval Level Decision
└── Required Documents Decision
```

Benefits:

- smaller tables,
- reusable decisions,
- clearer audit,
- easier testing,
- reduced gateway/table complexity.

Risks:

- dependency graph becomes hard to reason about,
- versioning becomes multi-artifact,
- output compatibility across decisions must be managed.

Rule:

> Split decisions when they represent different business concepts, not just to make tables smaller.

---

## 18. DMN vs Rule Engine

DMN is not always enough.

### 18.1 DMN Is Good For

- tabular deterministic decisions,
- business-readable classification,
- eligibility,
- simple scoring,
- routing,
- approval matrix,
- document requirements,
- policy table.

### 18.2 DMN Is Weak For

- complex inference,
- graph traversal,
- probabilistic reasoning,
- large dynamic rule set,
- temporal logic over event streams,
- optimization,
- ML inference,
- heavy computation,
- rules needing external state lookup during evaluation.

### 18.3 Alternative Patterns

| Need | Better option |
|---|---|
| Complex domain algorithm | Java domain service |
| Massive rule catalog | dedicated rule service/rule engine |
| Real-time event rules | stream processor |
| ML/risk model | model serving service + audited output |
| Legal text interpretation | human/legal review + codified subset |
| Optimization | solver/service |

---

## 19. CMMN in Camunda 7: Mental Model

CMMN models case management. In a case, not all work follows a fixed sequence. Activities can become available based on conditions, events, or manual activation.

BPMN says:

```text
Do A, then B, then maybe C.
```

CMMN says:

```text
For this case, A/B/C may become available depending on the case file, milestones, sentries, and manual decisions.
```

Core CMMN concepts:

- case definition,
- case instance,
- plan item,
- stage,
- milestone,
- sentry,
- entry criterion,
- exit criterion,
- human task,
- process task,
- case task,
- decision task,
- manual activation rule,
- required rule,
- repetition rule,
- auto-complete.

---

## 20. CMMN Lifecycle Thinking

A CMMN plan item has lifecycle states. The exact lifecycle is richer than BPMN sequence flow.

Conceptually:

```text
available
-> enabled
-> active
-> completed
```

But depending on type/rules, a plan item can also be:

```text
disabled
terminated
failed
suspended
```

This makes CMMN powerful for case work, but also harder to reason about.

---

## 21. CMMN Example: Enforcement Investigation Case

Imagine a regulatory enforcement case.

Not every investigation follows the same path:

- request additional documents may be needed,
- interview may be needed,
- inspection may be needed,
- legal review may be needed,
- supervisor review may be needed,
- settlement may be possible,
- prosecution referral may become necessary,
- case closure depends on milestones.

CMMN-style model:

```text
Case: Enforcement Investigation

Stage: Initial Assessment
  - Human Task: Review Complaint
  - Decision Task: Classify Risk
  - Milestone: Risk Classified

Stage: Evidence Gathering
  - Human Task: Request Documents       [available if docs incomplete]
  - Human Task: Schedule Interview      [available if interview required]
  - Process Task: Run External Screening [available after consent]
  - Milestone: Evidence Sufficient

Stage: Resolution
  - Human Task: Prepare Recommendation
  - Human Task: Legal Review            [available if high severity]
  - Human Task: Supervisor Approval     [required if penalty proposed]
  - Milestone: Case Closed
```

This is flexible. But that flexibility must be governed.

---

## 22. CMMN in Camunda 7: Reality Check

CMMN exists in Camunda 7 documentation and engine reference, but in modern Camunda strategy, BPMN + patterns are generally more common. Many teams rarely use CMMN compared to BPMN/DMN.

Practical considerations:

1. CMMN knowledge is less common than BPMN.
2. Modeler/tooling familiarity is weaker in many teams.
3. Migration path to Camunda 8 is less straightforward because Camunda 8 focuses on BPMN/DMN style orchestration, not CMMN as a first-class continuation of Camunda 7 CMMN.
4. Operational teams may find CMMN harder to debug.
5. Developers may accidentally reproduce CMMN flexibility with unclear case state.

Therefore:

> Use CMMN only when unordered/discretionary case behavior is central enough to justify the extra complexity.

---

## 23. When to Use CMMN

CMMN may be justified when:

- work is case-driven rather than sequence-driven,
- activities become available based on evolving case file,
- users can choose discretionary actions,
- milestones matter more than linear transitions,
- repeated activities are normal,
- case closure depends on flexible completion criteria,
- forcing BPMN would create spaghetti gateways and event subprocesses.

Examples:

- complex investigation,
- legal case preparation,
- complaint handling,
- exception management,
- social care case,
- insurance claim with discretionary evidence gathering,
- regulatory enforcement file.

---

## 24. When Not to Use CMMN

Avoid CMMN when:

- process has clear sequence,
- team does not understand CMMN lifecycle,
- ops/debugging tooling maturity is low,
- long-term migration to Camunda 8 is likely,
- business can express flexibility with BPMN event subprocess/call activities,
- case behavior is actually a normal state machine,
- discretionary behavior can be handled by task actions over a domain case aggregate.

For many teams, a better architecture is:

```text
Domain Case Aggregate
+ BPMN process fragments
+ DMN decisions
+ task/action APIs
+ event subprocesses
```

rather than CMMN-heavy modelling.

---

## 25. BPMN Alternative to CMMN

Many CMMN-style behaviors can be modelled using BPMN patterns.

### 25.1 Event Subprocess

For actions that can happen anytime:

```text
Main process
  + Event subprocess: Receive Additional Evidence
  + Event subprocess: Escalate Case
  + Event subprocess: Withdraw Application
```

### 25.2 Call Activity for Optional Work

```text
Main Case Process
  -> if docs incomplete: call Request Documents Process
  -> if high risk: call Investigation Process
  -> if appeal submitted: call Appeal Process
```

### 25.3 Domain Case State + BPMN Fragments

Model domain case explicitly:

```text
Case aggregate:
  status
  availableActions
  milestones
  evidenceState
  assignments
  permissions
```

BPMN handles durable orchestration for selected flows.

This often gives better control than CMMN for Java-centric enterprise systems.

---

## 26. CMMN + DMN + BPMN Together

A mature platform can combine all three:

```text
BPMN: overall lifecycle / orchestration
DMN: decision logic / routing / classification
CMMN or case aggregate: flexible case work availability
```

Example:

```text
BPMN Process: Enforcement Lifecycle
  -> DMN: classify case severity
  -> BPMN: create case record
  -> Case layer: evidence gathering available actions
  -> BPMN: legal approval subprocess
  -> DMN: penalty recommendation
  -> BPMN: notification and closure
```

The key is not notation purity. The key is clear boundary ownership.

---

## 27. Decision and Case Boundary Design

### 27.1 What Belongs in DMN?

- pure decision,
- deterministic mapping,
- business-readable rule,
- classification,
- routing,
- approval matrix,
- required document list,
- severity/risk band.

### 27.2 What Belongs in BPMN?

- durable workflow,
- wait state,
- human/system orchestration,
- SLA timer,
- escalation path,
- retry/recovery,
- message correlation,
- compensation.

### 27.3 What Belongs in Java Domain Service?

- domain invariant,
- aggregate mutation,
- external system interaction,
- complex computation,
- transaction with domain DB,
- authorization check,
- audit write,
- idempotency.

### 27.4 What Belongs in CMMN/Case Layer?

- available discretionary actions,
- case milestones,
- flexible evidence gathering,
- dynamic task activation,
- non-linear case work.

---

## 28. Regulatory Platform Example

Suppose we build a licensing/enforcement platform.

### 28.1 Domain Facts

```text
entityType
licenseType
licenseStatus
submissionType
previousViolations
outstandingFees
riskIndicators
documentsSubmitted
caseJurisdiction
caseCreationDate
```

### 28.2 DMN Decisions

```text
Document Completeness Decision
Risk Band Decision
Approval Level Decision
Routing Decision
Penalty Recommendation Decision
SLA Category Decision
```

### 28.3 BPMN Processes

```text
Application Intake Process
Review Process
Investigation Process
Appeal Process
Penalty Issuance Process
Closure Process
```

### 28.4 Case Layer

```text
Case aggregate:
  caseId
  state
  milestones
  availableActions
  assignments
  evidenceIndex
  legalBasis
  auditTimeline
```

### 28.5 Why This Split Works

- DMN keeps rules reviewable.
- BPMN keeps orchestration durable.
- Java domain model protects invariants.
- Case aggregate gives UI/action layer flexibility.
- Audit can reconstruct why, when, and by which rule version a transition happened.

---

## 29. Advanced Design: Decision Snapshot Pattern

When a decision matters legally, store snapshot metadata.

```java
public record DecisionAuditSnapshot(
    String caseId,
    String decisionKey,
    String decisionDefinitionId,
    int decisionVersion,
    String versionTag,
    Map<String, Object> inputFacts,
    Map<String, Object> outputResult,
    String reasonCode,
    String correlationId,
    Instant evaluatedAt
) {}
```

Avoid storing only:

```text
riskBand = HIGH
```

Store:

```text
riskBand = HIGH
because decision enforcementRiskDecision:v12 matched rule R-017
based on facts snapshot hash abc123
at 2026-06-20T10:15:00Z
```

---

## 30. Advanced Design: Decision Adapter Layer

Do not let process delegates directly interpret raw DMN maps everywhere.

Bad:

```java
Map<String, Object> result = decisionService.evaluateDecisionTableByKey(...)
// many casts spread across codebase
```

Better:

```text
BPMN/Delegate -> Decision Adapter -> DecisionService -> typed result
```

Benefits:

- one place for input mapping,
- one place for output parsing,
- one place for validation,
- easier tests,
- better observability,
- easier migration to another decision service later.

---

## 31. Advanced Design: Decision Effective-Date Resolver

For legal/regulatory rules, create resolver:

```java
public interface DecisionDefinitionResolver {
    DecisionReference resolve(
        String decisionKey,
        LocalDate legalEffectiveDate,
        String tenantId,
        String jurisdiction
    );
}
```

Where:

```java
public record DecisionReference(
    String decisionDefinitionId,
    String decisionKey,
    int version,
    String versionTag,
    LocalDate effectiveFrom,
    LocalDate effectiveTo
) {}
```

Then evaluate by definition id, not blindly latest key.

---

## 32. Advanced Design: DMN Result as Recommendation, Domain Service as Authority

For high-impact transitions:

```text
DMN: recommends transition
Domain service: validates and applies transition
BPMN: orchestrates next wait state
Audit: records both recommendation and applied action
```

Example:

```text
DMN output: recommendedAction = SUSPEND_LICENSE
Domain invariant:
  - license must be active
  - notice must have been served
  - appeal window must be elapsed or exception applies
  - officer must have authority
```

DMN should not bypass domain invariant.

---

## 33. Performance Considerations

DMN evaluation itself is usually not the main bottleneck compared to database/job execution, but there are still risks.

### 33.1 Large Tables

Very large decision tables can cause:

- slow evaluation,
- hard review,
- high memory use,
- difficult modeler usage,
- difficult test coverage.

Consider:

- split decisions,
- precompute facts,
- use database lookup for large reference data,
- cache static reference mappings outside DMN,
- dedicated decision service for heavy QPS.

### 33.2 History Cost

Historic decision input/output can increase storage significantly if:

- inputs are large JSON objects,
- decisions run frequently,
- history level is high,
- outputs include large collections,
- decision invoked in loops/multi-instance.

Rule:

> Keep DMN input/output compact and explicit.

### 33.3 Looping DMN Calls

Avoid evaluating DMN per item in large list inside BPMN process if volume is high.

Bad:

```text
multi-instance over 10,000 items -> DMN per item -> history per decision -> DB blow-up
```

Better:

- batch outside process,
- evaluate in domain service,
- store aggregate result,
- only workflow meaningful exceptions.

---

## 34. Security Considerations

DMN/CMMN artifacts are executable logic.

Security implications:

- malicious/incorrect model can alter routing,
- DMN inputs/outputs may contain sensitive data,
- history may store sensitive decision facts,
- expression language may expose functions depending config,
- model deployment endpoint must be protected,
- tenant-specific decisions must be isolated.

Checklist:

- restrict deployment rights,
- review model changes like code,
- validate input/output schema,
- avoid sensitive raw data in decision history,
- use reason codes instead of verbose PII-heavy reason text,
- tenant-aware decision lookup,
- audit every production deployment.

---

## 35. Java 8–25 Compatibility Perspective

For this series, Java 8–25 matters as ecosystem compatibility, not because DMN/CMMN concepts change by Java version.

### 35.1 Java 8 Estate

Older Camunda 7 projects may run Java 8.

Concerns:

- older Spring Boot/Camunda versions,
- old FEEL behavior,
- old serialization habits,
- legacy application servers,
- `javax.*` namespace,
- security patch pressure.

### 35.2 Java 11/17 Estate

Common modernization target.

Concerns:

- library upgrades,
- stricter module/security behavior,
- container upgrade,
- TLS/crypto defaults,
- Spring Boot version compatibility.

### 35.3 Java 21+ Estate

Modern runtime target for recent Camunda 7 support lines.

Concerns:

- Camunda version support matrix,
- Spring Boot generation,
- app server support,
- `javax` vs `jakarta`,
- test all delegates/listeners/DMN function behavior.

### 35.4 Java 25 Planning

For Java 25, treat compatibility as future/verification work:

- do not assume Camunda 7 supports it unless support matrix confirms,
- run full integration tests,
- verify application server/container,
- verify libraries,
- verify modeler/build tooling,
- verify serialization/deserialization.

---

## 36. Practical Implementation Blueprint

### 36.1 Recommended Package Structure

```text
com.example.caseplatform.decision
  ├── DecisionKey.java
  ├── DecisionReference.java
  ├── DecisionDefinitionResolver.java
  ├── DecisionAuditSnapshot.java
  ├── DecisionEvaluationException.java
  ├── enforcement
  │   ├── EnforcementRiskDecisionInput.java
  │   ├── EnforcementRiskDecisionResult.java
  │   ├── EnforcementRiskDecisionAdapter.java
  │   └── EnforcementRiskDecisionTest.java
  └── document
      ├── DocumentCompletenessDecisionInput.java
      ├── DocumentCompletenessDecisionResult.java
      └── DocumentCompletenessDecisionAdapter.java
```

### 36.2 BPMN Integration Pattern

```text
Service Task: Build Decision Facts
Business Rule Task: Evaluate DMN
Service Task: Validate/Apply Domain Transition
Gateway: Route by typed decision result
```

### 36.3 Decision Adapter Responsibilities

- validate input completeness,
- normalize enum/string/date types,
- resolve correct decision version,
- call DecisionService,
- parse output,
- validate output,
- write decision audit snapshot,
- expose typed result.

### 36.4 What Not to Put in Adapter

- domain mutation,
- external side effects,
- user authorization,
- BPMN token manipulation,
- direct REST response mapping.

---

## 37. Testing Blueprint

### 37.1 DMN Unit Test

```java
class EnforcementRiskDecisionTest {

    @Test
    void highRiskCompanyWithMultipleViolationsRequiresInvestigation() {
        EnforcementRiskDecisionInput input = new EnforcementRiskDecisionInput(
            "COMPANY",
            "SUSPENDED",
            3,
            new BigDecimal("12000.00"),
            true,
            LocalDate.of(2026, 6, 20)
        );

        EnforcementRiskDecisionResult result = adapter.evaluate(input);

        assertEquals(EnforcementAction.INVESTIGATE, result.action());
        assertEquals(RiskBand.HIGH, result.riskBand());
        assertEquals("HIGH_FINE_PRIOR_VIOLATION", result.reasonCode());
    }
}
```

### 37.2 BPMN Integration Test

```text
Given application submitted
And risk facts indicate high risk
When process reaches risk decision task
Then process routes to investigation review
And decision audit snapshot exists
And reason code is HIGH_FINE_PRIOR_VIOLATION
```

### 37.3 Regression Matrix

```csv
testId,applicantType,licenseStatus,violations,fine,expectedRisk,expectedAction,reasonCode
R001,COMPANY,SUSPENDED,3,12000,HIGH,INVESTIGATE,HIGH_FINE_PRIOR_VIOLATION
R002,COMPANY,ACTIVE,0,0,LOW,AUTO_APPROVE,NO_RISK_INDICATOR
R003,INDIVIDUAL,ACTIVE,2,1000,MEDIUM,REVIEW,REPEATED_MINOR_VIOLATION
```

---

## 38. Production Diagnostic Playbook

### 38.1 Decision Result Unexpected

Check:

1. Which decision definition id/version was used?
2. What were the input facts at evaluation time?
3. Was latest version used accidentally?
4. Did hit policy produce multiple matches?
5. Did FEEL expression treat null/type differently than expected?
6. Was output parsed incorrectly by Java?
7. Did BPMN gateway route on stale variable?
8. Was tenant-specific decision expected but shared decision used?

### 38.2 Rule Changed but Process Behavior Did Not Change

Possible causes:

- process evaluates by specific decision id/version,
- deployment not picked up,
- tenant mismatch,
- decision cache/deployment cache behavior,
- process model points to different decision key,
- output mapping variable name mismatch,
- BPMN gateway uses old variable.

### 38.3 Decision History Missing

Possible causes:

- history level insufficient,
- decision evaluated outside process engine history context,
- cleanup already removed history,
- using embedded DMN library outside Camunda engine,
- custom history configuration.

### 38.4 CMMN Case Stuck

Check:

- plan item lifecycle state,
- entry/exit criteria,
- sentry conditions,
- required rule,
- manual activation rule,
- case variables,
- human task assignment,
- called BPMN/DMN failure,
- incidents/jobs if any.

---

## 39. Design Review Questions

Before approving DMN/CMMN design, ask:

1. Is this rule truly decision logic, or process orchestration?
2. Is this case behavior truly non-linear/discretionary, or just a normal state machine?
3. Are input facts explicit and typed?
4. Are outputs stable and versioned?
5. Is hit policy correct?
6. Are reason codes defined?
7. Is effective-date policy defined?
8. Are old process instances affected?
9. Is decision history enough, or do we need domain audit snapshot?
10. Are tests covering boundaries, nulls, overlaps, and regressions?
11. Is tenant/jurisdiction variation explicit?
12. Can ops debug failures from Cockpit/logs/SQL?
13. Can the model survive migration to Camunda 8 or another platform?
14. Are model changes reviewed like code?
15. Is business ownership clear?

---

## 40. Strong Recommendations

For most enterprise Java + Camunda 7 systems:

1. Use **DMN** for compact, reviewable, deterministic business decisions.
2. Keep DMN **side-effect free**.
3. Keep DMN input/output **small, typed, explicit, and testable**.
4. Use **reason codes** for audit and explanation.
5. Put complex data gathering/normalization in Java/domain service before DMN.
6. Do not let raw DMN maps leak across the codebase.
7. Evaluate by explicit version/definition id when legal/effective-date correctness matters.
8. Treat DMN deployment as executable code release.
9. Use **CMMN sparingly** and only when case flexibility truly justifies it.
10. Prefer BPMN + DMN + domain case aggregate when future migration/operability matters.

---

## 41. Part 024 Summary

DMN and CMMN are not decorative features. They change where business logic lives.

DMN is best understood as:

```text
explicit, versioned, testable, auditable decision logic
```

CMMN is best understood as:

```text
flexible case work availability and lifecycle management
```

But both require discipline.

Bad DMN becomes a spreadsheet-shaped codebase.  
Bad CMMN becomes an opaque case-state maze.  
Good DMN makes decisions explainable.  
Good case modelling makes human work flexible without destroying invariants.

For a top-tier Camunda 7 engineer, the core skill is not “knowing how to draw a decision table”. It is knowing:

- what belongs in BPMN,
- what belongs in DMN,
- what belongs in Java/domain service,
- what belongs in case layer,
- what must be audited,
- what must be versioned,
- what must remain recoverable.

---

## 42. What Comes Next

Next part:

```text
learn-java-camunda-7-bpm-platform-engineering-part-025.md
```

Topic:

```text
Performance Engineering: Throughput, Latency, Hot Tables, Query Patterns, and Load Testing
```

We will move from modelling/runtime semantics into performance engineering: job executor throughput, database hot tables, variable/history cost, external task worker throughput, indexes, connection pool sizing, load testing methodology, and production bottleneck analysis.

---

## References

- Camunda 7.24 Documentation — DMN Engine.
- Camunda 7.24 Documentation — DMN 1.3 Reference.
- Camunda 7.24 Documentation — DMN Hit Policy.
- Camunda 7.24 Documentation — FEEL Engine.
- Camunda 7.24 Documentation — Decisions in BPMN and CMMN.
- Camunda 7.24 Documentation — CMMN 1.1 Reference.
- Camunda 7.24 Documentation — Process Engine History.
- Camunda 7.24 Documentation — Process Engine Versioning and Deployment.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-023.md">⬅️ Part 023 — REST API, Client Architecture, OpenAPI, Remote Engine, dan API Governance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-025.md">Part 025 — Performance Engineering: Throughput, Latency, Hot Tables, Query Patterns, and Load Testing ➡️</a>
</div>
