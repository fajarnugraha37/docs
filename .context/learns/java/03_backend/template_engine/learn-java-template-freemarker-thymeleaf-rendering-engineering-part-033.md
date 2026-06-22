# learn-java-template-freemarker-thymeleaf-rendering-engineering — Part 33
# Real-World Blueprint III: Rule/State-Based Document Rendering for Case Management

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `033`  
> Topik: rule/state-based document rendering untuk case management, regulatory workflow, enforcement lifecycle, notices, approvals, rejections, escalations, closures, audit, dan legal defensibility.  
> Scope Java: Java 8 sampai Java 25.  
> Fokus engine: FreeMarker dan Thymeleaf sebagai rendering layer, bukan workflow engine, bukan rule engine, bukan persistence engine.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas platform notification/correspondence dan admin portal SSR. Part ini lebih spesifik: bagaimana template rendering dipakai pada sistem case management yang punya state machine, escalation logic, SLA, decision point, document lifecycle, dan audit trail.

Target akhirnya bukan sekadar bisa membuat template surat. Targetnya adalah mampu mendesain mekanisme berikut:

1. case berpindah state;
2. state transition menghasilkan kebutuhan dokumen;
3. sistem memilih template yang benar berdasarkan rule;
4. sistem mengambil snapshot data yang benar;
5. renderer menghasilkan output yang aman dan deterministik;
6. output disimpan sebagai artifact immutable;
7. artifact bisa dibuktikan ulang secara audit/legal;
8. failure tidak merusak state machine;
9. perubahan template tidak merusak dokumen lama;
10. rendering bisa diuji, diobservasi, dan dioperasikan.

Dalam sistem regulatory/case management, dokumen bukan kosmetik. Dokumen sering menjadi _legal artifact_. Surat peringatan, notice of non-compliance, approval letter, rejection letter, reminder SLA, enforcement notice, closure letter, dan appeal outcome bisa menjadi bagian dari evidence trail.

Karena itu, mental model-nya harus berubah:

```text
Template rendering in case management is not presentation only.
It is controlled generation of legally meaningful artifacts from state, facts, rules, and time.
```

---

## 1. Problem Domain: Case Management Bukan CRUD Biasa

CRUD biasa berpusat pada record:

```text
create -> read -> update -> delete
```

Case management berpusat pada lifecycle:

```text
intake -> triage -> assessment -> investigation -> decision -> action -> appeal -> closure
```

Di tiap fase, sistem bisa menghasilkan dokumen yang berbeda:

| Lifecycle area | Contoh dokumen |
|---|---|
| Intake | acknowledgement notice, submission receipt |
| Triage | request for more information, invalid submission notice |
| Assessment | assessment memo, clarification request |
| Investigation | inspection notice, interview notice, evidence request |
| Decision | approval, rejection, warning, penalty, directive |
| Escalation | overdue reminder, breach notice, supervisor escalation |
| Appeal | appeal received notice, appeal outcome letter |
| Closure | closure letter, final decision record |

Perbedaannya dengan rendering web biasa:

1. Output harus bisa direproduksi secara historis.
2. Template punya versi dan effective date.
3. Data input harus disnapshot.
4. Pemilihan template biasanya rule-based.
5. Output bisa memiliki konsekuensi hukum/operasional.
6. Rendering biasanya terjadi setelah state transition, event, timer, atau human decision.
7. Kesalahan dokumen bisa lebih serius daripada kesalahan UI.

---

## 2. Core Mental Model

Blueprint ini berdiri di atas lima konsep:

```text
Case State
  -> Rendering Trigger
    -> Template Selection
      -> Data Snapshot
        -> Immutable Artifact
```

### 2.1 Case State

Case state merepresentasikan posisi resmi case dalam lifecycle.

Contoh:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_INFORMATION
APPROVED
REJECTED
ENFORCEMENT_ACTION_REQUIRED
UNDER_APPEAL
CLOSED
```

State bukan label UI. State adalah invariant bisnis. State menentukan:

1. aksi yang boleh dilakukan;
2. aktor yang boleh melakukan aksi;
3. SLA yang berlaku;
4. dokumen yang wajib/opsional;
5. notification yang dikirim;
6. audit event yang harus dicatat.

### 2.2 Rendering Trigger

Rendering trigger adalah kejadian yang membuat dokumen perlu dibuat.

Contoh:

```text
CASE_SUBMITTED
CASE_APPROVED
CASE_REJECTED
INFORMATION_REQUESTED
SLA_DUE_SOON
SLA_BREACHED
APPEAL_FILED
APPEAL_DECIDED
CASE_CLOSED
```

Trigger bisa berasal dari:

1. state transition synchronous;
2. domain event after commit;
3. BPMN service task;
4. batch scheduler;
5. manual user action;
6. message queue;
7. re-render request untuk preview;
8. remediation job.

### 2.3 Template Selection

Template selection adalah proses memilih template yang benar berdasarkan state, event, jurisdiction, tenant, language, document type, effective date, dan rule bisnis.

Contoh:

```text
caseType = BROKER_LICENSE
state = REJECTED
reasonCode = MISSING_QUALIFICATION
locale = en-SG
tenant = CEA
output = PDF
```

Hasilnya:

```text
templateId = broker-license-rejection-letter
templateVersion = 7
effectiveFrom = 2026-01-01
engine = freemarker
format = html-pdf
```

### 2.4 Data Snapshot

Snapshot adalah data konkret yang dipakai untuk render.

Bukan:

```text
ambil data paling baru setiap kali dokumen dibuka
```

Melainkan:

```text
ambil data pada saat event resmi terjadi, simpan snapshot, render dari snapshot itu
```

Snapshot membuat output defensible. Kalau nama applicant berubah besok, surat rejection kemarin tidak ikut berubah.

### 2.5 Immutable Artifact

Artifact adalah hasil final rendering:

1. HTML;
2. plain text;
3. PDF;
4. DOCX;
5. email body;
6. XML payload;
7. generated notice package.

Artifact harus disimpan immutable, minimal dengan metadata:

```text
artifactId
documentType
templateId
templateVersion
caseId
caseStateAtRender
triggerEventId
renderedAt
renderedBy
locale
timezone
dataSnapshotHash
outputHash
storageLocation
contentType
```

---

## 3. Key Design Principle: State Machine Owns Meaning, Template Owns Representation

Kesalahan umum adalah membuat template menentukan meaning.

Buruk:

```ftl
<#if case.score gt 80 && case.hasLicense && !case.hasViolation>
  Your application is approved.
<#else>
  Your application is rejected.
</#if>
```

Masalah:

1. business decision tersembunyi di template;
2. tidak mudah diaudit;
3. tidak reusable;
4. rawan beda antara UI, workflow, email, dan PDF;
5. sulit dites sebagai business rule;
6. template editor bisa mengubah keputusan secara tidak sadar.

Lebih baik:

```java
public enum DecisionOutcome {
    APPROVED,
    REJECTED,
    PENDING_INFORMATION,
    ESCALATED
}
```

Template hanya menampilkan keputusan yang sudah dibuat:

```ftl
Decision: ${decision.label}
Reason: ${decision.reasonText}
```

Aturan utama:

```text
Business rule decides.
Template explains.
```

Template boleh memiliki conditional presentation:

```text
jika ada penalty amount, tampilkan section penalty
jika ada appeal deadline, tampilkan section appeal deadline
jika ada attachment list, render tabel attachment
```

Template tidak boleh menjadi tempat decision logic utama:

```text
menentukan approved/rejected
menghitung penalty final
menentukan statutory deadline
memilih enforcement action
menentukan recipient legal
```

---

## 4. Domain Model Blueprint

Kita mulai dengan model konseptual.

```text
Case
 ├─ CaseState
 ├─ CaseType
 ├─ Parties
 ├─ Facts
 ├─ Decisions
 ├─ SLA
 ├─ Events
 ├─ Documents
 └─ AuditTrail

Document
 ├─ DocumentType
 ├─ TemplateReference
 ├─ SnapshotReference
 ├─ ArtifactReference
 ├─ RenderStatus
 └─ DeliveryStatus
```

### 4.1 Case Aggregate

Contoh Java record untuk Java 17+:

```java
public record CaseRecord(
        CaseId id,
        CaseType type,
        CaseState state,
        List<Party> parties,
        CaseFacts facts,
        List<CaseDecision> decisions,
        List<CaseEvent> events,
        Instant createdAt,
        Instant updatedAt
) {}
```

Untuk Java 8, gunakan final class immutable:

```java
public final class CaseRecord {
    private final CaseId id;
    private final CaseType type;
    private final CaseState state;
    private final List<Party> parties;
    private final CaseFacts facts;
    private final List<CaseDecision> decisions;
    private final List<CaseEvent> events;
    private final Instant createdAt;
    private final Instant updatedAt;

    public CaseRecord(
            CaseId id,
            CaseType type,
            CaseState state,
            List<Party> parties,
            CaseFacts facts,
            List<CaseDecision> decisions,
            List<CaseEvent> events,
            Instant createdAt,
            Instant updatedAt
    ) {
        this.id = Objects.requireNonNull(id);
        this.type = Objects.requireNonNull(type);
        this.state = Objects.requireNonNull(state);
        this.parties = Collections.unmodifiableList(new ArrayList<>(parties));
        this.facts = Objects.requireNonNull(facts);
        this.decisions = Collections.unmodifiableList(new ArrayList<>(decisions));
        this.events = Collections.unmodifiableList(new ArrayList<>(events));
        this.createdAt = Objects.requireNonNull(createdAt);
        this.updatedAt = Objects.requireNonNull(updatedAt);
    }

    public CaseId id() { return id; }
    public CaseType type() { return type; }
    public CaseState state() { return state; }
    public List<Party> parties() { return parties; }
    public CaseFacts facts() { return facts; }
    public List<CaseDecision> decisions() { return decisions; }
    public List<CaseEvent> events() { return events; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
}
```

### 4.2 Case State

```java
public enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    PENDING_INFORMATION,
    APPROVED,
    REJECTED,
    ENFORCEMENT_ACTION_REQUIRED,
    UNDER_APPEAL,
    CLOSED
}
```

### 4.3 Document Type

```java
public enum DocumentType {
    ACKNOWLEDGEMENT_NOTICE,
    REQUEST_FOR_INFORMATION,
    APPROVAL_LETTER,
    REJECTION_LETTER,
    WARNING_NOTICE,
    PENALTY_NOTICE,
    APPEAL_RECEIVED_NOTICE,
    APPEAL_OUTCOME_LETTER,
    CLOSURE_LETTER
}
```

### 4.4 Render Status

```java
public enum RenderStatus {
    PENDING,
    RENDERING,
    RENDERED,
    FAILED,
    CANCELLED,
    SUPERSEDED
}
```

### 4.5 Delivery Status

```java
public enum DeliveryStatus {
    NOT_REQUIRED,
    PENDING,
    SENT,
    FAILED,
    RETRYING,
    CANCELLED
}
```

---

## 5. Rendering Trigger Model

A robust system should model rendering trigger explicitly.

```java
public record RenderingTrigger(
        String triggerId,
        CaseId caseId,
        CaseState fromState,
        CaseState toState,
        String eventType,
        Instant occurredAt,
        String actorId,
        Map<String, Object> attributes
) {}
```

Java 8 style:

```java
public final class RenderingTrigger {
    private final String triggerId;
    private final CaseId caseId;
    private final CaseState fromState;
    private final CaseState toState;
    private final String eventType;
    private final Instant occurredAt;
    private final String actorId;
    private final Map<String, Object> attributes;

    // constructor + getters
}
```

Kenapa trigger penting?

Karena dokumen tidak selalu berasal dari state akhir saja. Contoh:

```text
UNDER_REVIEW -> PENDING_INFORMATION
```

Bisa menghasilkan:

```text
REQUEST_FOR_INFORMATION
```

Tapi state `PENDING_INFORMATION` juga bisa dimasuki dari beberapa event berbeda:

1. missing document;
2. unclear declaration;
3. payment issue;
4. expired certificate.

Template selection perlu tahu event/reason, bukan hanya state.

---

## 6. Template Selection Rule

Template selection sebaiknya menjadi service eksplisit.

```java
public interface TemplateSelector {
    SelectedTemplate select(TemplateSelectionRequest request);
}
```

```java
public record TemplateSelectionRequest(
        CaseId caseId,
        CaseType caseType,
        CaseState currentState,
        String triggerEventType,
        DocumentType documentType,
        String reasonCode,
        String tenantId,
        Locale locale,
        ZoneId zoneId,
        Instant effectiveAt,
        OutputKind outputKind
) {}
```

```java
public record SelectedTemplate(
        String templateId,
        int version,
        String engine,
        String templatePath,
        OutputKind outputKind,
        String contentType,
        boolean autoEscapingRequired
) {}
```

Selection bisa berbasis database rule table:

| priority | tenant | case_type | state | event | document_type | reason_code | locale | effective_from | template_id | version |
|---:|---|---|---|---|---|---|---|---|---|---:|
| 100 | CEA | LICENCE | REJECTED | CASE_REJECTED | REJECTION_LETTER | MISSING_QUALIFICATION | en-SG | 2026-01-01 | licence-rejection-mq | 7 |
| 90 | CEA | LICENCE | REJECTED | CASE_REJECTED | REJECTION_LETTER | * | en-SG | 2026-01-01 | licence-rejection-generic | 5 |
| 10 | * | * | REJECTED | CASE_REJECTED | REJECTION_LETTER | * | en | 2025-01-01 | generic-rejection | 3 |

Rule lookup harus deterministic:

1. filter by effective date;
2. filter by active status;
3. match tenant/case/state/event/document/reason/locale;
4. sort by priority and specificity;
5. reject ambiguity;
6. return one selected template.

### 6.1 Ambiguity Is a Production Bug

Jika dua rule sama-sama cocok dengan priority sama:

```text
Rule A: tenant=CEA, caseType=LICENCE, state=REJECTED
Rule B: tenant=CEA, documentType=REJECTION_LETTER, reasonCode=MISSING_QUALIFICATION
```

Jangan pilih acak. Jangan pilih berdasarkan database order.

Harus fail:

```text
TEMPLATE_SELECTION_AMBIGUOUS
```

Dan log/audit:

```text
caseId
triggerId
criteria
matchingRuleIds
```

### 6.2 No Template Found

Jika tidak ada template:

```text
TEMPLATE_NOT_FOUND
```

Behavior tergantung jenis dokumen:

| Dokumen | Failure behavior |
|---|---|
| mandatory legal notice | block transition atau mark document generation failed sebelum delivery |
| optional notification | allow transition, create failed notification task |
| internal memo | allow transition, queue retry |
| preview | return validation error |

---

## 7. Template Selection Pseudocode

```java
public final class RuleBasedTemplateSelector implements TemplateSelector {
    private final TemplateRuleRepository repository;

    @Override
    public SelectedTemplate select(TemplateSelectionRequest request) {
        List<TemplateRule> candidates = repository.findActiveRules(
                request.tenantId(),
                request.effectiveAt()
        );

        List<ScoredRule> matching = candidates.stream()
                .filter(rule -> rule.matches(request))
                .map(rule -> new ScoredRule(rule, rule.specificityScore(request)))
                .sorted(Comparator
                        .comparingInt(ScoredRule::priority).reversed()
                        .thenComparingInt(ScoredRule::specificity).reversed()
                        .thenComparing(ScoredRule::ruleId))
                .toList();

        if (matching.isEmpty()) {
            throw new TemplateNotFoundException(request);
        }

        ScoredRule best = matching.get(0);

        boolean ambiguous = matching.size() > 1
                && matching.get(1).priority() == best.priority()
                && matching.get(1).specificity() == best.specificity();

        if (ambiguous) {
            throw new AmbiguousTemplateRuleException(request, matching);
        }

        return best.rule().toSelectedTemplate();
    }
}
```

Untuk Java 8, ganti `toList()` dengan `collect(Collectors.toList())`, dan record dengan final class.

---

## 8. Rendering Placement: Synchronous vs Asynchronous

Ada tiga pilihan besar.

### 8.1 Render Inside State Transition Transaction

```text
begin transaction
  update case state
  render document
  save artifact
commit
```

Kelebihan:

1. state dan artifact commit bersama;
2. mudah dipahami;
3. strong consistency.

Kekurangan:

1. render PDF bisa lama;
2. storage bisa gagal;
3. external font/image bisa memperpanjang transaction;
4. risiko lock lebih lama;
5. sulit retry parsial.

Biasanya hanya cocok untuk output kecil dan mandatory yang murah dirender.

### 8.2 Render After Commit via Domain Event

```text
begin transaction
  update case state
  insert domain event
commit

worker consumes event
  render document
  save artifact
```

Kelebihan:

1. transaction case pendek;
2. render bisa retry;
3. cocok untuk PDF/email/batch;
4. scalable.

Kekurangan:

1. eventual consistency;
2. perlu status tracking;
3. harus mendesain failure recovery.

Untuk enterprise case management, ini sering menjadi default terbaik.

Spring menyediakan `@TransactionalEventListener` untuk mengikat listener ke fase transaction, default-nya ke commit phase. Namun untuk reliability tinggi, outbox table sering lebih kuat daripada in-memory event listener karena aman terhadap process crash setelah commit.

### 8.3 BPMN Service Task / External Worker

```text
BPMN process reaches GenerateDocument task
Worker fetches job
Worker renders document
Worker completes task
```

Kelebihan:

1. workflow eksplisit;
2. retry dan incident bisa terlihat di process engine;
3. cocok untuk human + system orchestration;
4. mudah menempatkan timer/escalation.

Kekurangan:

1. tambahan complexity;
2. perlu idempotency worker;
3. boundary data harus jelas;
4. jangan jadikan BPMN sebagai tempat semua business logic kecil.

---

## 9. Recommended Architecture for Case-Based Rendering

Untuk sistem regulatory/case management, pola robust biasanya:

```text
Case Service
  -> State Transition
  -> Domain Event / Outbox
  -> Rendering Orchestrator
  -> Template Selector
  -> Snapshot Builder
  -> Rendering Engine Adapter
  -> Artifact Store
  -> Delivery Orchestrator
  -> Audit Trail
```

Diagram teks:

```text
+-------------------+
| Case Command API  |
+---------+---------+
          |
          v
+-------------------+        +------------------+
| Case State Machine| -----> | Case Event/Outbox|
+---------+---------+        +---------+--------+
          |                            |
          |                            v
          |                  +-------------------+
          |                  | Rendering Worker  |
          |                  +---------+---------+
          |                            |
          |        +-------------------+--------------------+
          |        |                                        |
          v        v                                        v
+----------------+  +-------------------+        +-------------------+
| Case Repository|  | Template Selector |        | Snapshot Builder  |
+----------------+  +---------+---------+        +---------+---------+
                              |                            |
                              v                            v
                    +-------------------+        +-------------------+
                    | Template Registry |        | Snapshot Store    |
                    +---------+---------+        +---------+---------+
                              |                            |
                              +-------------+--------------+
                                            v
                                  +------------------+
                                  | Renderer Adapter |
                                  | FreeMarker/Thym. |
                                  +---------+--------+
                                            |
                                            v
                                  +------------------+
                                  | Artifact Store   |
                                  +---------+--------+
                                            |
                                            v
                                  +------------------+
                                  | Delivery/Audit   |
                                  +------------------+
```

---

## 10. Snapshot Builder

Snapshot builder mengubah domain data menjadi immutable rendering model.

```java
public interface CaseDocumentSnapshotBuilder {
    CaseDocumentSnapshot build(CaseDocumentSnapshotRequest request);
}
```

```java
public record CaseDocumentSnapshotRequest(
        CaseId caseId,
        DocumentType documentType,
        String triggerEventId,
        Instant snapshotAt,
        Locale locale,
        ZoneId zoneId
) {}
```

```java
public record CaseDocumentSnapshot(
        String snapshotId,
        CaseId caseId,
        DocumentType documentType,
        String triggerEventId,
        Instant snapshotAt,
        Locale locale,
        ZoneId zoneId,
        Map<String, Object> model,
        String modelSchemaVersion,
        String hash
) {}
```

### 10.1 Snapshot Data Should Be Presentation-Ready But Not Overformatted

Baik:

```json
{
  "caseNumber": "EA-2026-000123",
  "applicant": {
    "displayName": "Example Pte Ltd",
    "maskedIdentifier": "****123A"
  },
  "decision": {
    "outcome": "REJECTED",
    "reasonTitle": "Missing qualification requirement",
    "reasonDetails": [
      "The submitted certificate is expired.",
      "The required training evidence was not provided."
    ]
  },
  "importantDates": {
    "decisionDate": "2026-06-19",
    "appealDeadline": "2026-07-19"
  }
}
```

Buruk:

```json
{
  "entity": "full Hibernate entity graph here",
  "securityContext": "current user session object",
  "repository": "service object",
  "rawNric": "S1234567A"
}
```

### 10.2 Snapshot Hash

Snapshot hash membantu audit.

```java
public final class SnapshotHasher {
    public String sha256CanonicalJson(String canonicalJson) {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(canonicalJson.getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(hash); // Java 17+
    }
}
```

Untuk Java 8, implement hex manual:

```java
private static String toHex(byte[] bytes) {
    char[] hex = new char[bytes.length * 2];
    char[] digits = "0123456789abcdef".toCharArray();
    for (int i = 0; i < bytes.length; i++) {
        int v = bytes[i] & 0xff;
        hex[i * 2] = digits[v >>> 4];
        hex[i * 2 + 1] = digits[v & 0x0f];
    }
    return new String(hex);
}
```

Hash berguna untuk membuktikan bahwa artifact dibuat dari snapshot tertentu. Namun hash bukan pengganti access control, encryption, retention policy, atau audit trail.

---

## 11. Rendering Model Contract

Sebelum template dipublish, sistem harus tahu model apa yang dibutuhkan.

Contoh contract:

```yaml
templateId: licence-rejection-letter
modelSchemaVersion: 3
required:
  - case.caseNumber
  - applicant.displayName
  - decision.reasonTitle
  - decision.reasonDetails
  - dates.decisionDate
  - dates.appealDeadline
optional:
  - officer.displayName
  - attachments
  - penalty.amount
forbidden:
  - applicant.rawIdentifier
  - securityContext
  - repository
  - internalNotes
```

Contract ini bisa divalidasi saat:

1. template upload;
2. template publish;
3. render preview;
4. production render;
5. CI test.

### 11.1 Missing Required Field

Jika template mandatory butuh field yang tidak tersedia:

```text
MODEL_CONTRACT_MISSING_FIELD
```

Jangan diam-diam menghasilkan:

```text
Dear ,
```

### 11.2 Forbidden Field

Jika model mengandung field sensitif:

```text
MODEL_CONTRACT_FORBIDDEN_FIELD
```

Contoh forbidden:

1. raw national identifier;
2. access token;
3. internal investigator note;
4. security role list;
5. service object;
6. domain aggregate full graph.

---

## 12. Template Example: FreeMarker Rejection Letter

`templates/licence/rejection-letter.ftlh`

```ftl
<#ftl output_format="HTML" auto_esc=true>
<!doctype html>
<html lang="${locale.language}">
<head>
  <meta charset="UTF-8">
  <title>Application Outcome</title>
</head>
<body>
  <h1>Application Outcome</h1>

  <p>Dear ${applicant.displayName},</p>

  <p>
    We refer to your application <strong>${case.caseNumber}</strong>.
  </p>

  <p>
    After assessment, your application has not been approved.
  </p>

  <h2>Reason</h2>
  <p>${decision.reasonTitle}</p>

  <#if decision.reasonDetails?has_content>
    <ul>
      <#list decision.reasonDetails as detail>
        <li>${detail}</li>
      </#list>
    </ul>
  </#if>

  <#if dates.appealDeadline?has_content>
    <h2>Appeal</h2>
    <p>
      You may submit an appeal by ${dates.appealDeadline}.
    </p>
  </#if>

  <p>Generated on ${dates.generatedAt}.</p>
</body>
</html>
```

Note:

1. output format HTML;
2. auto-escaping aktif;
3. tidak ada business decision logic;
4. conditional hanya presentation section;
5. template menerima `reasonTitle` dan `reasonDetails`, bukan menghitung rejection reason sendiri.

---

## 13. Template Example: Thymeleaf Notice

`templates/licence/rejection-letter.html`

```html
<!doctype html>
<html lang="en" xmlns:th="http://www.thymeleaf.org">
<head>
  <meta charset="UTF-8">
  <title>Application Outcome</title>
</head>
<body>
  <h1>Application Outcome</h1>

  <p>
    Dear <span th:text="${applicant.displayName}">Applicant Name</span>,
  </p>

  <p>
    We refer to your application
    <strong th:text="${case.caseNumber}">EA-2026-000123</strong>.
  </p>

  <p>After assessment, your application has not been approved.</p>

  <h2>Reason</h2>
  <p th:text="${decision.reasonTitle}">Reason title</p>

  <ul th:if="${decision.reasonDetails != null and !decision.reasonDetails.isEmpty()}">
    <li th:each="detail : ${decision.reasonDetails}" th:text="${detail}">
      Reason detail
    </li>
  </ul>

  <section th:if="${dates.appealDeadline != null}">
    <h2>Appeal</h2>
    <p>
      You may submit an appeal by
      <span th:text="${dates.appealDeadline}">2026-07-19</span>.
    </p>
  </section>

  <p>
    Generated on <span th:text="${dates.generatedAt}">2026-06-19</span>.
  </p>
</body>
</html>
```

Thymeleaf cocok jika template perlu natural HTML preview. FreeMarker sering lebih fleksibel untuk text/document/email generation yang bukan natural web page.

---

## 14. Document Generation Transaction Boundary

Masalah utama:

```text
Kapan dokumen dianggap resmi?
```

Ada tiga momen berbeda:

1. selected: template sudah dipilih;
2. rendered: output sudah dibuat;
3. issued: output sudah disahkan/dikirim/dipublish.

Jangan campur.

```java
public enum DocumentLifecycleStatus {
    REQUESTED,
    TEMPLATE_SELECTED,
    SNAPSHOT_CREATED,
    RENDERED,
    APPROVED_FOR_ISSUE,
    ISSUED,
    DELIVERY_FAILED,
    SUPERSEDED,
    VOIDED
}
```

### 14.1 Rendered Is Not Always Issued

PDF berhasil dibuat bukan berarti sudah resmi dikirim.

Contoh:

```text
renderedAt = 2026-06-19T10:00Z
approvedForIssueAt = 2026-06-19T11:00Z
issuedAt = 2026-06-19T11:05Z
```

Ini penting untuk audit:

1. siapa yang menyetujui;
2. template versi apa;
3. apakah dokumen pernah diganti;
4. apakah delivery gagal;
5. apakah recipient benar.

---

## 15. Re-Render Policy

Pertanyaan penting:

```text
Jika ada data berubah, apakah dokumen lama boleh di-render ulang?
```

Jawaban enterprise:

```text
Preview boleh re-render.
Draft boleh re-render.
Issued artifact tidak boleh silently re-render.
```

Policy:

| Status dokumen | Re-render? | Catatan |
|---|---:|---|
| preview | yes | tidak resmi |
| draft | yes | simpan version history jika perlu |
| rendered not issued | maybe | tergantung approval workflow |
| issued | no | buat amendment/superseding artifact |
| voided | no | tetap simpan audit |

Jika dokumen issued salah, jangan overwrite. Buat:

```text
correction notice
amendment notice
superseding document
void event
```

---

## 16. Idempotency

Rendering worker harus idempotent.

Event bisa terkirim dua kali. Worker bisa crash setelah menyimpan artifact tapi sebelum ack. Retry bisa terjadi.

Gunakan idempotency key:

```text
caseId + triggerEventId + documentType + templateId + templateVersion + snapshotHash
```

Contoh:

```java
public record RenderIdempotencyKey(
        CaseId caseId,
        String triggerEventId,
        DocumentType documentType,
        String templateId,
        int templateVersion,
        String snapshotHash
) {}
```

Repository enforcing uniqueness:

```sql
create unique index uq_document_render_idempotency
on case_document_render (
    case_id,
    trigger_event_id,
    document_type,
    template_id,
    template_version,
    snapshot_hash
);
```

Jika retry menemukan artifact existing dengan key sama:

```text
return existing artifact
```

Bukan render ulang diam-diam.

---

## 17. Outbox Pattern for Rendering Requests

Untuk menghindari lost event:

```sql
create table case_outbox_event (
    id varchar(64) primary key,
    aggregate_type varchar(64) not null,
    aggregate_id varchar(64) not null,
    event_type varchar(128) not null,
    payload clob not null,
    occurred_at timestamp not null,
    status varchar(32) not null,
    retry_count integer not null,
    next_attempt_at timestamp,
    created_at timestamp not null,
    updated_at timestamp not null
);
```

Case transition:

```text
begin transaction
  update case state
  insert case event
  insert outbox event
commit
```

Worker:

```text
poll outbox pending event
lock event
process rendering
mark processed or retry
```

Kenapa lebih baik daripada hanya publish message langsung?

Karena update DB dan publish message tidak atomik kecuali memakai distributed transaction, yang biasanya tidak diinginkan. Outbox memastikan event tercatat dalam transaction yang sama dengan state change.

---

## 18. BPMN Integration Pattern

Jika memakai BPMN, jangan jadikan renderer sebagai hidden side effect tanpa model jelas.

Contoh BPMN conceptual flow:

```text
Assess Case
  -> Decision Gateway
    -> Approved Path
      -> Generate Approval Letter
      -> Send Approval Letter
      -> Close Case
    -> Rejected Path
      -> Generate Rejection Letter
      -> Send Rejection Letter
      -> Wait for Appeal Window
```

### 18.1 Service Task Contract

Worker input:

```json
{
  "caseId": "CASE-123",
  "documentType": "REJECTION_LETTER",
  "triggerEventId": "EVT-456",
  "locale": "en-SG",
  "timezone": "Asia/Singapore"
}
```

Worker output:

```json
{
  "documentId": "DOC-789",
  "artifactId": "ART-101",
  "renderStatus": "RENDERED",
  "templateId": "licence-rejection-letter",
  "templateVersion": 7
}
```

### 18.2 BPMN Should Orchestrate, Not Render

BPMN process should decide that a rejection letter must be generated. It should not contain the whole template selection/rendering logic.

Better:

```text
BPMN: Generate Rejection Letter task
Worker: calls rendering subsystem
Rendering subsystem: selects template, snapshots data, renders artifact
```

---

## 19. SLA and Timer-Based Documents

Some documents are not caused by user action but by time.

Examples:

1. reminder before deadline;
2. overdue notice;
3. escalation notice;
4. auto-closure warning;
5. appeal window expired notice.

### 19.1 Timer Event Model

```java
public record CaseTimerEvent(
        String timerId,
        CaseId caseId,
        String timerType,
        Instant dueAt,
        Instant firedAt,
        CaseState stateAtFire
) {}
```

Timer-based rendering must re-check state before render.

Bad:

```text
Timer scheduled when case was PENDING_INFORMATION.
Timer fires 14 days later.
System sends overdue notice without checking current state.
```

Correct:

```text
Timer fires.
Reload case.
If case is still PENDING_INFORMATION and response not received, render overdue notice.
Otherwise cancel/no-op.
```

### 19.2 Timer Idempotency

Idempotency key for timer document:

```text
caseId + timerId + documentType
```

If timer is recalculated due to SLA change, create new timer ID or versioned timer key.

---

## 20. Recipient Rules

Document generation and delivery are separate.

Recipient selection must be explicit.

```java
public interface RecipientResolver {
    List<Recipient> resolve(DocumentRecipientRequest request);
}
```

```java
public record DocumentRecipientRequest(
        CaseId caseId,
        DocumentType documentType,
        CaseState state,
        String triggerEventId,
        String tenantId
) {}
```

Recipient types:

```java
public enum RecipientType {
    APPLICANT,
    REPRESENTATIVE,
    CASE_OFFICER,
    SUPERVISOR,
    AGENCY_MAILBOX,
    EXTERNAL_PARTY
}
```

Important rule:

```text
Do not derive legal recipients only from template variables.
```

Template can show recipient display name. Recipient resolver decides actual delivery destination.

---

## 21. Signatory Rules

Case documents often need signatory block.

Bad:

```text
Template hardcodes officer name.
```

Better:

```java
public interface SignatoryResolver {
    Signatory resolve(SignatoryRequest request);
}
```

```java
public record Signatory(
        String displayName,
        String title,
        String department,
        String signatureImageId,
        String authorityReference
) {}
```

Signatory selection could depend on:

1. document type;
2. case type;
3. decision severity;
4. officer role;
5. approval chain;
6. delegation rule;
7. effective date.

For legal defensibility, store signatory snapshot in document snapshot.

---

## 22. Attachment Rules

Some documents require attachments:

1. evidence summary;
2. submitted files;
3. inspection report;
4. invoice/payment schedule;
5. appeal form;
6. regulatory guideline.

Attachment rule:

```java
public interface AttachmentResolver {
    List<DocumentAttachment> resolve(AttachmentRequest request);
}
```

Store metadata:

```text
attachmentId
sourceType
sourceId
filename
contentType
hash
includedAt
```

Do not let template dynamically fetch attachments. Template can render attachment list, but resolver decides what is included.

---

## 23. Artifact Storage

Artifact store should treat rendered documents as immutable blobs plus metadata.

Storage options:

1. database BLOB/CLOB;
2. object storage;
3. document management system;
4. file system for small internal tools only.

Metadata table:

```sql
create table case_document_artifact (
    artifact_id varchar(64) primary key,
    case_id varchar(64) not null,
    document_id varchar(64) not null,
    document_type varchar(64) not null,
    template_id varchar(128) not null,
    template_version integer not null,
    snapshot_id varchar(64) not null,
    content_type varchar(128) not null,
    storage_uri varchar(512) not null,
    output_hash varchar(128) not null,
    size_bytes bigint not null,
    rendered_at timestamp not null,
    rendered_by varchar(128) not null,
    lifecycle_status varchar(64) not null
);
```

### 23.1 Output Hash

Hash the final output bytes, not only model.

```text
snapshotHash proves input.
outputHash proves artifact content.
```

For PDF, hash final PDF bytes.

---

## 24. Audit Trail Model

At minimum, audit these events:

```text
DOCUMENT_REQUESTED
TEMPLATE_SELECTED
SNAPSHOT_CREATED
RENDER_STARTED
RENDER_SUCCEEDED
RENDER_FAILED
DOCUMENT_APPROVED_FOR_ISSUE
DOCUMENT_ISSUED
DOCUMENT_DELIVERY_FAILED
DOCUMENT_SUPERSEDED
DOCUMENT_VOIDED
```

Audit event payload should include:

```json
{
  "caseId": "CASE-123",
  "documentId": "DOC-789",
  "artifactId": "ART-101",
  "documentType": "REJECTION_LETTER",
  "templateId": "licence-rejection-letter",
  "templateVersion": 7,
  "snapshotId": "SNAP-555",
  "snapshotHash": "...",
  "outputHash": "...",
  "actorId": "system:render-worker",
  "triggerEventId": "EVT-456",
  "caseStateAtRender": "REJECTED",
  "occurredAt": "2026-06-19T03:00:00Z"
}
```

Avoid storing full PII in audit event if audit logs have broader access than case records.

---

## 25. Legal Defensibility Checklist

A generated document is defensible when you can answer:

1. Which case produced it?
2. Which event triggered it?
3. Which state was the case in?
4. Which template ID and version were used?
5. Which data snapshot was used?
6. Who/what rendered it?
7. When was it rendered?
8. Was it preview, draft, rendered, issued, voided, or superseded?
9. Who approved it, if approval was required?
10. Who received it?
11. Was delivery successful?
12. Has the document been replaced?
13. Is the stored artifact byte-identical to the issued artifact?
14. Which locale/timezone/formatting rules were applied?
15. Were sensitive fields redacted according to policy?

If the answer relies on “current database state”, it is weak.

If the answer relies on stored immutable snapshot + template version + output hash + audit event, it is much stronger.

---

## 26. Failure Model

Rendering failure should be classified.

```java
public enum DocumentRenderFailureCode {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_SELECTION_AMBIGUOUS,
    TEMPLATE_PARSE_ERROR,
    MODEL_CONTRACT_MISSING_FIELD,
    MODEL_CONTRACT_FORBIDDEN_FIELD,
    TEMPLATE_RUNTIME_ERROR,
    UNSAFE_TEMPLATE_OPERATION,
    PDF_GENERATION_FAILED,
    ARTIFACT_STORAGE_FAILED,
    RECIPIENT_RESOLUTION_FAILED,
    SIGNATORY_RESOLUTION_FAILED,
    ATTACHMENT_RESOLUTION_FAILED,
    UNKNOWN
}
```

### 26.1 Failure Response Matrix

| Failure | Retry? | Human intervention? | Block case transition? |
|---|---:|---:|---:|
| template not found | no | yes | maybe |
| ambiguous selection | no | yes | maybe |
| parse error | no | yes | maybe |
| missing model field | no | yes | maybe |
| storage timeout | yes | maybe | no if async |
| PDF engine temporary failure | yes | maybe | no if async |
| recipient resolution failed | no/maybe | yes | no/depends |
| email send failed | yes | maybe | no |

Top 1% design does not just catch `Exception`. It classifies failure by operational meaning.

---

## 27. Observability

Metrics:

```text
case_document_render_requests_total
case_document_render_success_total
case_document_render_failure_total{failure_code}
case_document_render_duration_seconds{document_type,engine,output_kind}
case_document_template_selection_duration_seconds
case_document_snapshot_build_duration_seconds
case_document_pdf_generation_duration_seconds
case_document_artifact_store_duration_seconds
case_document_render_retry_total{failure_code}
case_document_render_queue_lag_seconds
```

Logs must include correlation fields:

```text
correlationId
caseId
documentId
artifactId
triggerEventId
templateId
templateVersion
snapshotId
failureCode
```

Do not log full model. Log model hash, schema version, and safe diagnostics.

Traces:

```text
render-document
  select-template
  build-snapshot
  validate-model-contract
  render-template
  generate-pdf
  store-artifact
  write-audit
```

---

## 28. Security Model

Threats:

1. XSS in rendered HTML/email;
2. SSTI from user-editable template;
3. data leakage through overbroad model;
4. unauthorized template edit;
5. unauthorized preview of another case;
6. template changes bypassing approval;
7. malicious attachment inclusion;
8. raw identifier exposure;
9. output tampering;
10. unsafe PDF resource loading.

Controls:

1. auto-escaping enabled;
2. strict object wrapper;
3. no service/repository exposure;
4. template approval workflow;
5. field allowlist;
6. output hash;
7. immutable artifact storage;
8. preview access control;
9. tenant isolation;
10. safe PDF asset resolver;
11. audit on every admin change;
12. static linting for forbidden constructs.

---

## 29. FreeMarker vs Thymeleaf in Case Documents

| Use case | FreeMarker | Thymeleaf |
|---|---|---|
| legal letter HTML-to-PDF | excellent | good |
| email HTML + text | excellent | excellent |
| natural HTML preview by designers | moderate | excellent |
| XML generation | excellent | good |
| fixed-width text | excellent | weak/moderate |
| CSV/text output | excellent | not primary |
| admin SSR page | possible | excellent |
| component-like UI layout | possible via macros | excellent via fragments |
| strict text artifact generation | excellent | moderate |

Recommended split:

```text
Thymeleaf: admin portal, preview UI, SSR case screens.
FreeMarker: official document/email/text/XML generation.
```

But do not over-generalize. If your team has strong Thymeleaf governance and documents are HTML-first, Thymeleaf can work. If your documents include multi-format text artifacts, FreeMarker is often more natural.

---

## 30. Case State to Document Matrix

Example:

| From state | Event | To state | Document | Mandatory | Timing |
|---|---|---|---|---:|---|
| DRAFT | CASE_SUBMITTED | SUBMITTED | ACKNOWLEDGEMENT_NOTICE | yes | async immediate |
| UNDER_REVIEW | INFO_REQUESTED | PENDING_INFORMATION | REQUEST_FOR_INFORMATION | yes | after commit |
| UNDER_REVIEW | CASE_APPROVED | APPROVED | APPROVAL_LETTER | yes | after approval |
| UNDER_REVIEW | CASE_REJECTED | REJECTED | REJECTION_LETTER | yes | after approval |
| PENDING_INFORMATION | SLA_DUE_SOON | PENDING_INFORMATION | REMINDER_NOTICE | no | timer |
| PENDING_INFORMATION | SLA_BREACHED | ENFORCEMENT_ACTION_REQUIRED | BREACH_NOTICE | yes | timer + transition |
| REJECTED | APPEAL_FILED | UNDER_APPEAL | APPEAL_RECEIVED_NOTICE | yes | after commit |
| UNDER_APPEAL | APPEAL_ALLOWED | APPROVED | APPEAL_OUTCOME_LETTER | yes | after decision |
| UNDER_APPEAL | APPEAL_DISMISSED | CLOSED | APPEAL_OUTCOME_LETTER | yes | after decision |
| APPROVED | CASE_CLOSED | CLOSED | CLOSURE_LETTER | maybe | after commit |

This matrix should be controlled configuration or code, not scattered across controllers and templates.

---

## 31. Implementation Skeleton

### 31.1 Main Orchestrator

```java
public final class CaseDocumentRenderingOrchestrator {
    private final TemplateSelector templateSelector;
    private final CaseDocumentSnapshotBuilder snapshotBuilder;
    private final TemplateModelValidator modelValidator;
    private final RenderingEngineRegistry engineRegistry;
    private final ArtifactStore artifactStore;
    private final DocumentAuditService auditService;
    private final DocumentRepository documentRepository;

    public RenderedDocument render(RenderDocumentCommand command) {
        auditService.recordRequested(command);

        TemplateSelectionRequest selectionRequest = command.toTemplateSelectionRequest();
        SelectedTemplate selectedTemplate = templateSelector.select(selectionRequest);
        auditService.recordTemplateSelected(command, selectedTemplate);

        CaseDocumentSnapshot snapshot = snapshotBuilder.build(command.toSnapshotRequest());
        auditService.recordSnapshotCreated(command, snapshot);

        modelValidator.validate(selectedTemplate, snapshot.model());

        RenderingEngine engine = engineRegistry.get(selectedTemplate.engine());

        RenderResult renderResult = engine.render(new RenderRequest(
                selectedTemplate.templatePath(),
                selectedTemplate.outputKind(),
                snapshot.model(),
                snapshot.locale(),
                snapshot.zoneId()
        ));

        StoredArtifact artifact = artifactStore.store(new StoreArtifactCommand(
                command.caseId(),
                command.documentType(),
                selectedTemplate,
                snapshot,
                renderResult
        ));

        RenderedDocument document = documentRepository.markRendered(
                command.documentId(),
                selectedTemplate,
                snapshot,
                artifact
        );

        auditService.recordRenderSucceeded(command, selectedTemplate, snapshot, artifact);
        return document;
    }
}
```

### 31.2 Engine Interface

```java
public interface RenderingEngine {
    RenderResult render(RenderRequest request);
}
```

```java
public record RenderRequest(
        String templatePath,
        OutputKind outputKind,
        Map<String, Object> model,
        Locale locale,
        ZoneId zoneId
) {}
```

```java
public record RenderResult(
        byte[] bytes,
        String contentType,
        String outputHash,
        long renderDurationMillis
) {}
```

For large outputs, avoid always returning `byte[]`; use stream/storage callback. But `byte[]` is fine for conceptual skeleton.

---

## 32. Rendering Official PDF

PDF flow:

```text
selected template -> HTML render -> PDF engine -> PDF bytes -> artifact store
```

Potential failure points:

1. HTML template error;
2. missing image/font;
3. invalid CSS;
4. PDF engine memory issue;
5. page break issue;
6. unsupported CSS feature;
7. Unicode/font rendering error;
8. storage failure.

PDF should be tested with:

1. long names;
2. long addresses;
3. many attachments;
4. empty optional fields;
5. multilingual content;
6. page break boundary;
7. table split;
8. missing logo fallback;
9. signature image unavailable;
10. large case facts.

---

## 33. Preview vs Official Rendering

Preview and official rendering should use same engine, but different lifecycle.

Preview:

```text
no official artifact
watermark allowed
sample data allowed
not delivered
not legally binding
```

Official:

```text
snapshot stored
template version fixed
artifact immutable
hash recorded
audit recorded
optional approval required
delivery tracked
```

Never let preview endpoint become a way to read unauthorized case data.

Preview command should check:

1. user can view case;
2. user can preview document type;
3. template is draft/active depending mode;
4. tenant boundary;
5. model redaction rules.

---

## 34. Testing Strategy Specific to Case Documents

Tests:

1. state-event-document matrix test;
2. template selection specificity test;
3. ambiguity test;
4. no-template-found test;
5. snapshot immutability test;
6. snapshot hash stability test;
7. issued artifact non-overwrite test;
8. re-render policy test;
9. missing model field test;
10. forbidden field test;
11. XSS escaping test;
12. PDF generation smoke test;
13. locale/timezone test;
14. recipient resolver test;
15. signatory resolver test;
16. timer no-op when state changed;
17. outbox retry idempotency test;
18. audit event completeness test.

### 34.1 Example Matrix Test

```java
@Test
void rejectedCaseMustGenerateRejectionLetter() {
    DocumentGenerationPlan plan = planner.plan(new CaseTransition(
            CaseState.UNDER_REVIEW,
            CaseState.REJECTED,
            "CASE_REJECTED",
            CaseType.LICENCE
    ));

    assertThat(plan.documents())
            .extracting(DocumentGenerationRequest::documentType)
            .contains(DocumentType.REJECTION_LETTER);
}
```

### 34.2 Idempotency Test

```java
@Test
void retryingSameRenderCommandReturnsExistingArtifact() {
    RenderDocumentCommand command = sampleCommand();

    RenderedDocument first = orchestrator.render(command);
    RenderedDocument second = orchestrator.render(command);

    assertThat(second.artifactId()).isEqualTo(first.artifactId());
    assertThat(artifactStore.countFor(command.idempotencyKey())).isEqualTo(1);
}
```

---

## 35. Java 8–25 Considerations

### Java 8

Use:

1. final immutable classes;
2. `java.time` already available;
3. manual hex encoding;
4. `CompletableFuture` carefully;
5. no records/sealed classes/switch expressions.

### Java 11

Better runtime baseline for modern libraries. Still no records as standard.

### Java 17

Good enterprise LTS baseline:

1. records;
2. sealed classes;
3. pattern matching improvements;
4. `HexFormat`;
5. stronger baseline for modern Spring Boot 3.

### Java 21

Useful for high-concurrency rendering workers:

1. virtual threads for I/O-heavy orchestration;
2. structured concurrency preview/incubation state depends on release;
3. better runtime observability and GC options.

Use virtual threads for orchestration if rendering pipeline is mostly blocking I/O:

```text
load template metadata
load snapshot data
store artifact
write audit
send delivery request
```

Do not assume virtual threads make CPU-heavy PDF rendering free.

### Java 25

Treat as modern reference for latest JDK capabilities, but production adoption depends on organization LTS policy and framework compatibility. Keep core rendering architecture independent from latest syntax where possible.

---

## 36. Anti-Patterns

### 36.1 Template Decides Case Outcome

```text
Template contains approval/rejection decision logic.
```

Fix:

```text
State machine/rule engine decides. Template displays.
```

### 36.2 Rendering from Live Entity

```text
Open document loads current case entity and renders on demand.
```

Fix:

```text
Official document renders from immutable snapshot and stored artifact.
```

### 36.3 Overwriting Issued Document

```text
New template version changes old issued letter.
```

Fix:

```text
Issued artifact immutable. New version creates superseding artifact.
```

### 36.4 Delivery and Rendering Mixed

```text
renderAndSendEmail() with no document status.
```

Fix:

```text
Render artifact first. Delivery consumes artifact. Track statuses separately.
```

### 36.5 No Idempotency

```text
Retry creates duplicate official letters.
```

Fix:

```text
Use render idempotency key and unique constraint.
```

### 36.6 Template Rule Ambiguity

```text
Multiple templates match and system picks first.
```

Fix:

```text
Reject ambiguity as configuration error.
```

### 36.7 Full Domain Graph in Template

```text
Template can access case.officer.department.manager.email and more.
```

Fix:

```text
Allowlisted view model only.
```

---

## 37. Production Readiness Checklist

Before going live, verify:

1. All document types mapped to state/event matrix.
2. Mandatory documents have fail behavior defined.
3. Template selection is deterministic.
4. Template ambiguity fails loudly.
5. Template version/effective date implemented.
6. Snapshot stored immutably.
7. Official artifacts immutable.
8. Output hash recorded.
9. Snapshot hash recorded.
10. Audit event complete.
11. Renderer errors classified.
12. Retry/idempotency implemented.
13. Preview separated from official render.
14. Recipient resolver separated from template.
15. Signatory resolver separated from template.
16. Attachment resolver separated from template.
17. Auto-escaping enabled.
18. Forbidden fields blocked.
19. No service/repository exposure to template.
20. PDF edge cases tested.
21. Locale/timezone explicit.
22. Timer documents re-check current state.
23. Delivery tracked separately from render.
24. Supersede/void policy defined.
25. Operational dashboard exists.
26. Support team has runbook.

---

## 38. Runbook Example

### Incident: Rejection Letter Failed to Render

1. Search by `caseId` or `triggerEventId`.
2. Check `case_document_render_failure_total` by failure code.
3. Open document render record.
4. Verify selected template ID/version.
5. Verify snapshot exists.
6. Check model contract validation result.
7. If template parse/runtime error:
   - disable bad template if active;
   - publish fixed version;
   - retry failed document if not issued.
8. If missing model field:
   - inspect snapshot builder version;
   - fix snapshot builder or template contract;
   - retry.
9. If artifact storage failed:
   - check storage service;
   - retry same idempotency key.
10. Record incident notes in audit/support log.

### Incident: Wrong Letter Sent

1. Do not overwrite artifact.
2. Mark document as disputed/voided if policy allows.
3. Generate correction/superseding notice.
4. Preserve original artifact.
5. Audit who approved/issued it.
6. Identify whether issue was:
   - wrong template selection;
   - wrong data snapshot;
   - wrong business decision;
   - wrong recipient;
   - template content defect;
   - delivery defect.
7. Patch root cause.
8. Add regression test.

---

## 39. Final Mental Model

For case management, the rendering subsystem is a controlled artifact factory.

It takes:

```text
state + event + rule + snapshot + template version + locale/timezone
```

And produces:

```text
immutable artifact + audit evidence + optional delivery
```

The strongest architecture separates concerns:

```text
State machine decides lifecycle.
Rule engine/selector chooses document/template.
Snapshot builder freezes facts.
Template engine renders representation.
Artifact store preserves output.
Delivery service sends output.
Audit trail proves what happened.
```

A weak system says:

```text
We can regenerate the letter from the current database.
```

A strong system says:

```text
This exact artifact was generated at this time from this template version and this immutable data snapshot because this state transition occurred, and here is the audit trail proving it.
```

That is the level of thinking expected in high-stakes regulatory/case-management platforms.

---

## 40. Summary

Di Part 33, kita membahas:

1. perbedaan case management dengan CRUD biasa;
2. state/event-based rendering;
3. template selection rule;
4. data snapshot dan hash;
5. immutable artifact;
6. official vs preview rendering;
7. render vs issue vs deliver;
8. re-render/supersede policy;
9. idempotency dan outbox;
10. BPMN/timer integration;
11. recipient/signatory/attachment rules;
12. audit/legal defensibility;
13. failure model;
14. observability;
15. security;
16. testing;
17. Java 8–25 considerations;
18. production readiness checklist.

Part ini sengaja lebih architectural karena di sistem case management, rendering bukan hanya kemampuan template. Rendering adalah bagian dari lifecycle governance.

---

## 41. Referensi

- Apache FreeMarker Manual — Template loading, output formats, auto-escaping, object wrapping.
- Thymeleaf 3.1 Documentation — Template modes, Spring integration, natural templates.
- Spring Framework Documentation — Transaction-bound events and `@TransactionalEventListener`.
- Camunda 8 Documentation — BPMN processes and user tasks.
- OWASP guidance — injection and output encoding principles.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-032.md">⬅️ Part 32 — Real-World Blueprint II: Server-Side Rendered Admin Portal with Thymeleaf</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-034.md">Part 34 — Designing a Top 1% Java Template Rendering Architecture ➡️</a>
</div>
