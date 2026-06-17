# learn-java-testing-benchmarking-performance-jvm-part-007

# Testing Domain Logic, State Machine, Workflow, dan Business Invariant

> Seri: **Java Testing, Benchmarking, Performance Engineering and JVM Arguments & JVM Configuration**  
> Part: **007 / 031**  
> Fokus: menguji domain logic, state machine, workflow, guard condition, business invariant, auditability, authorization, SLA, dan regulatory defensibility.  
> Target Java: **Java 8 hingga Java 25**.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

1. kenapa testing adalah bagian dari sistem bukti engineering;
2. taxonomy test dan risk-based strategy;
3. evolusi JUnit 4/5/6;
4. desain test yang readable;
5. assertion engineering;
6. test data engineering;
7. mocking dan collaboration testing.

Part ini masuk ke inti yang lebih dekat dengan real enterprise system: **domain logic dan workflow**.

Di banyak sistem enterprise, bug paling mahal jarang berupa `NullPointerException` sederhana. Bug yang mahal biasanya seperti ini:

- status case berubah ke state yang salah;
- user yang tidak berwenang bisa melakukan transition tertentu;
- SLA dihitung salah karena cut-off date, holiday, atau timezone;
- audit trail tidak merekam alasan keputusan;
- duplicate command membuat double approval, double payment, atau double notification;
- escalation terjadi terlalu cepat atau terlambat;
- workflow menabrak invariant yang seharusnya mustahil;
- UI/API terlihat benar, tetapi state machine domain diam-diam korup.

Testing domain logic harus diperlakukan sebagai **pembuktian behavior bisnis**, bukan sekadar memanggil method dan mengejar line coverage.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. membedakan domain logic biasa, workflow logic, dan state-machine-driven logic;
2. mendesain test berdasarkan **state, event, transition, guard, effect, dan invariant**;
3. membuat transition matrix untuk memastikan semua legal dan illegal transition teruji;
4. menulis test yang kuat untuk workflow approval, rejection, appeal, escalation, withdrawal, reassignment, dan reopening;
5. menguji authorization bukan hanya di controller/filter, tetapi juga di domain/application decision point;
6. menguji auditability sebagai bagian dari business correctness;
7. menguji SLA/time-sensitive rule secara deterministik;
8. menghindari test yang terlalu rapuh karena menyalin implementation detail;
9. membangun mini DSL untuk test workflow agar expressive dan maintainable;
10. memahami kapan domain logic cukup diuji dengan unit test dan kapan perlu integration/component test.

---

## 2. Mental Model Utama: Domain Test Bukan Test Method

Kesalahan umum engineer adalah menulis test dengan pola:

```java
@Test
void testApprove() {
    // call approve()
}
```

Masalahnya bukan nama test-nya saja. Masalah utamanya adalah cara berpikirnya:

```text
method exists → call method → assert returned object
```

Untuk domain logic, model yang lebih benar adalah:

```text
Given a domain state
When a business event/command occurs
And required actor/context/evidence exists
Then the domain must move to an allowed state
And preserve all invariants
And emit/record required effects
And reject forbidden outcomes
```

Dengan kata lain, test domain harus berpusat pada **business rule**, bukan method signature.

Contoh buruk:

```java
@Test
void approveShouldSetStatusApproved() {
    Case c = new Case();
    c.approve();
    assertEquals(Status.APPROVED, c.getStatus());
}
```

Test ini dangkal karena tidak menjawab:

- dari status apa case boleh di-approve?
- siapa yang boleh approve?
- apakah evidence sudah lengkap?
- apakah approval reason wajib?
- apakah audit trail dibuat?
- apakah timestamp memakai clock yang benar?
- apakah case yang sudah rejected boleh di-approve?
- apakah duplicate approve idempotent atau error?

Test yang lebih domain-aware:

```java
@Test
void officer_can_approve_submitted_case_when_required_evidence_is_complete() {
    CaseApplication application = aSubmittedCase()
            .withRequiredEvidenceComplete()
            .assignedTo(officer("officer-1"))
            .build();

    Decision decision = application.approve(approvalCommand()
            .by(officer("officer-1"))
            .withReason("All eligibility requirements satisfied")
            .at(Instant.parse("2026-06-16T03:00:00Z"))
            .build());

    assertThat(decision.status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(decision.auditEvents())
            .extracting(AuditEvent::activity)
            .containsExactly("CASE_APPROVED");
    assertThat(decision.auditEvents().get(0).reason())
            .isEqualTo("All eligibility requirements satisfied");
}
```

Test kedua lebih panjang, tetapi jauh lebih defensible karena menjelaskan business scenario.

---

## 3. Domain Logic, Application Logic, Workflow Logic: Jangan Dicampur

Sebelum menulis test, pisahkan tiga layer behavior.

### 3.1 Domain logic

Domain logic menjawab:

```text
Secara bisnis, apakah perubahan ini valid?
```

Contoh:

- submitted case tidak boleh diubah applicant setelah review dimulai;
- rejected case hanya bisa appeal dalam 14 hari;
- approved license tidak boleh punya missing mandatory document;
- case tidak boleh berada di `CLOSED` tanpa final decision;
- withdrawal hanya boleh oleh applicant atau authorized representative;
- escalation hanya boleh jika SLA breach.

Domain logic sebaiknya bisa diuji tanpa database, HTTP, broker, dan framework.

### 3.2 Application logic

Application logic menjawab:

```text
Bagaimana command diproses dari luar menuju domain dan side effect?
```

Contoh:

- load aggregate dari repository;
- check permission dari authorization service;
- call domain method;
- save aggregate;
- publish event;
- create audit trail;
- return response DTO.

Application logic test biasanya butuh fakes/mocks untuk repository, event publisher, audit writer, dan permission checker.

### 3.3 Workflow orchestration logic

Workflow orchestration menjawab:

```text
Bagaimana proses multi-step, multi-actor, dan time-sensitive dikendalikan?
```

Contoh:

- case submitted → assigned → reviewed → approved;
- case pending applicant clarification → applicant responds → officer resumes review;
- SLA breach → escalation → supervisor reassignment;
- appeal submitted → appeal review → appeal approved/rejected;
- scheduled job mencari case overdue.

Workflow test sering membutuhkan gabungan:

- domain unit test;
- application service test;
- component test dengan database;
- scheduler test;
- authorization matrix test;
- audit assertion.

---

## 4. State Machine sebagai Model Berpikir

Banyak sistem enterprise sebenarnya state machine, walaupun tidak selalu memakai state machine library.

Elemen dasarnya:

```text
State      : kondisi domain saat ini
Event      : sesuatu yang terjadi
Command    : permintaan aktor untuk mengubah state
Transition : perpindahan dari state lama ke state baru
Guard      : syarat agar transition boleh terjadi
Effect     : efek setelah transition terjadi
Invariant  : kebenaran yang harus selalu dijaga
```

Contoh sederhana:

```text
DRAFT --submit--> SUBMITTED
SUBMITTED --assign--> UNDER_REVIEW
UNDER_REVIEW --approve--> APPROVED
UNDER_REVIEW --reject--> REJECTED
REJECTED --appeal--> APPEALED
APPROVED --revoke--> REVOKED
ANY_ACTIVE --withdraw--> WITHDRAWN
```

Tetapi real system biasanya punya guard:

```text
DRAFT --submit--> SUBMITTED
  guard: mandatory documents complete
  guard: applicant profile verified
  effect: audit CASE_SUBMITTED
  effect: notification sent

UNDER_REVIEW --approve--> APPROVED
  guard: actor has APPROVE_CASE permission
  guard: case assigned to actor or actor is supervisor
  guard: all mandatory checks passed
  guard: decision reason provided
  effect: final decision recorded
  effect: audit CASE_APPROVED
  effect: license generated
```

### 4.1 State machine bukan berarti harus pakai framework

Kamu tidak wajib memakai state machine framework. Yang penting adalah domain model dan test-nya eksplisit.

State machine dapat diwakili oleh:

- enum + domain method;
- transition table;
- sealed hierarchy pada Java modern;
- explicit state pattern;
- workflow engine;
- external BPMN engine;
- custom rule engine.

Test tetap bisa berbasis state-event-invariant.

---

## 5. Transition Matrix: Senjata Utama untuk Workflow Test

Untuk workflow, jangan mulai dari test case acak. Mulai dari matrix.

Misal status:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    PENDING_CLARIFICATION,
    APPROVED,
    REJECTED,
    APPEALED,
    WITHDRAWN,
    CLOSED
}
```

Command:

```java
public enum CaseCommandType {
    SUBMIT,
    ASSIGN,
    REQUEST_CLARIFICATION,
    RESPOND_CLARIFICATION,
    APPROVE,
    REJECT,
    APPEAL,
    WITHDRAW,
    CLOSE
}
```

Transition matrix:

| From | Command | To | Legal? | Main Guard |
|---|---:|---|---:|---|
| DRAFT | SUBMIT | SUBMITTED | yes | mandatory docs complete |
| DRAFT | APPROVE | - | no | cannot approve draft |
| SUBMITTED | ASSIGN | UNDER_REVIEW | yes | actor is officer/supervisor |
| SUBMITTED | WITHDRAW | WITHDRAWN | yes | actor is applicant/representative |
| UNDER_REVIEW | APPROVE | APPROVED | yes | checks passed + permission |
| UNDER_REVIEW | REJECT | REJECTED | yes | reason required |
| UNDER_REVIEW | REQUEST_CLARIFICATION | PENDING_CLARIFICATION | yes | clarification reason required |
| PENDING_CLARIFICATION | RESPOND_CLARIFICATION | UNDER_REVIEW | yes | actor is applicant |
| REJECTED | APPEAL | APPEALED | yes | within appeal window |
| APPROVED | APPEAL | - | no | cannot appeal approved case |
| CLOSED | APPROVE | - | no | closed is terminal |

Dari matrix ini, kamu bisa turunkan test:

1. all legal transitions produce expected state;
2. all illegal transitions rejected with clear error;
3. all guard failure rejected;
4. all effects generated;
5. all terminal states cannot mutate;
6. all audit-critical transitions record sufficient evidence.

---

## 6. Implementasi Domain Model Contoh

Contoh domain model minimal:

```java
public final class CaseApplication {
    private final CaseId id;
    private CaseStatus status;
    private OfficerId assignedOfficerId;
    private final List<Document> documents;
    private final List<CaseEvent> events;
    private Decision finalDecision;

    public CaseApplication(CaseId id, CaseStatus status, List<Document> documents) {
        this.id = Objects.requireNonNull(id);
        this.status = Objects.requireNonNull(status);
        this.documents = new ArrayList<>(Objects.requireNonNull(documents));
        this.events = new ArrayList<>();
    }

    public void submit(SubmitCase command) {
        requireStatus(CaseStatus.DRAFT);
        requireMandatoryDocumentsComplete();

        this.status = CaseStatus.SUBMITTED;
        this.events.add(CaseSubmitted.of(id, command.actorId(), command.occurredAt()));
    }

    public void assign(AssignCase command) {
        requireStatus(CaseStatus.SUBMITTED);
        requireActorHas(command, Permission.ASSIGN_CASE);

        this.assignedOfficerId = command.officerId();
        this.status = CaseStatus.UNDER_REVIEW;
        this.events.add(CaseAssigned.of(id, command.actorId(), command.officerId(), command.occurredAt()));
    }

    public void approve(ApproveCase command) {
        requireStatus(CaseStatus.UNDER_REVIEW);
        requireActorHas(command, Permission.APPROVE_CASE);
        requireAssignedOfficerOrSupervisor(command.actorId());
        requireAllChecksPassed();
        requireNonBlank(command.reason(), "Approval reason is required");

        this.finalDecision = Decision.approved(command.reason(), command.actorId(), command.occurredAt());
        this.status = CaseStatus.APPROVED;
        this.events.add(CaseApproved.of(id, command.actorId(), command.reason(), command.occurredAt()));
    }

    public List<CaseEvent> pullEvents() {
        List<CaseEvent> copy = List.copyOf(events);
        events.clear();
        return copy;
    }

    public CaseStatus status() {
        return status;
    }

    private void requireStatus(CaseStatus expected) {
        if (status != expected) {
            throw new InvalidCaseTransitionException(status, expected);
        }
    }

    private void requireMandatoryDocumentsComplete() {
        boolean complete = documents.stream().anyMatch(Document::isMandatoryAndValid);
        if (!complete) {
            throw new BusinessRuleViolationException("Mandatory documents are incomplete");
        }
    }

    private void requireActorHas(Command command, Permission permission) {
        if (!command.permissions().contains(permission)) {
            throw new AuthorizationViolationException(permission);
        }
    }
}
```

Ini hanya contoh. Pada real system, permission bisa tidak dimasukkan ke command, melainkan dicek di application service. Tetapi prinsip test-nya sama: **transition tidak boleh terjadi tanpa guard yang valid**.

---

## 7. Testing Legal Transition

Legal transition test harus membuktikan minimal empat hal:

1. given state benar;
2. command valid;
3. state berubah ke expected state;
4. required effect terjadi.

Contoh:

```java
@Test
void submitted_case_can_be_assigned_to_officer_by_supervisor() {
    CaseApplication application = aCase()
            .withStatus(CaseStatus.SUBMITTED)
            .withMandatoryDocumentsComplete()
            .build();

    AssignCase command = assignCase()
            .by(supervisor("sup-1"))
            .toOfficer(officerId("officer-1"))
            .at(Instant.parse("2026-06-16T03:00:00Z"))
            .withPermission(Permission.ASSIGN_CASE)
            .build();

    application.assign(command);

    assertThat(application.status()).isEqualTo(CaseStatus.UNDER_REVIEW);
    assertThat(application.assignedOfficerId()).isEqualTo(officerId("officer-1"));
    assertThat(application.pullEvents())
            .singleElement()
            .satisfies(event -> {
                assertThat(event).isInstanceOf(CaseAssigned.class);
                assertThat(event.actorId()).isEqualTo(actorId("sup-1"));
                assertThat(event.occurredAt()).isEqualTo(Instant.parse("2026-06-16T03:00:00Z"));
            });
}
```

### 7.1 Kenapa assert event penting?

Karena di sistem enterprise, state change tanpa event/audit sering tidak cukup.

Misalnya `status = APPROVED` benar, tetapi kalau tidak ada audit event:

- sulit trace siapa approve;
- sulit membuktikan alasan approval;
- downstream process tidak berjalan;
- regulator/user tidak bisa melihat history;
- support team tidak bisa investigasi.

Jadi test domain sebaiknya tidak hanya memeriksa final state, tetapi juga **evidence of transition**.

---

## 8. Testing Illegal Transition

Illegal transition sama pentingnya dengan legal transition.

Contoh:

```java
@Test
void draft_case_cannot_be_approved() {
    CaseApplication application = aCase()
            .withStatus(CaseStatus.DRAFT)
            .withMandatoryDocumentsComplete()
            .build();

    ApproveCase command = approveCase()
            .by(officer("officer-1"))
            .withPermission(Permission.APPROVE_CASE)
            .withReason("Looks fine")
            .at(Instant.parse("2026-06-16T03:00:00Z"))
            .build();

    assertThatThrownBy(() -> application.approve(command))
            .isInstanceOf(InvalidCaseTransitionException.class)
            .hasMessageContaining("DRAFT");

    assertThat(application.status()).isEqualTo(CaseStatus.DRAFT);
    assertThat(application.pullEvents()).isEmpty();
}
```

Perhatikan tiga assertion:

1. exception type benar;
2. state tidak berubah;
3. event tidak keluar.

Ini penting karena bug bisa berbentuk:

```text
throw exception, tetapi state sudah berubah sebagian
```

atau:

```text
transition ditolak, tetapi event/audit sudah terlanjur dibuat
```

Keduanya berbahaya.

---

## 9. Parameterized Test untuk Transition Matrix

JUnit Jupiter menyediakan parameterized tests sehingga matrix dapat diuji sebagai data, bukan ditulis manual satu per satu. Dokumentasi JUnit menjelaskan `@ParameterizedTest` sebagai mekanisme menjalankan test yang sama dengan argument berbeda.

Contoh legal transition matrix:

```java
@ParameterizedTest(name = "{0} --{1}--> {2}")
@MethodSource("legalTransitions")
void legal_transition_moves_case_to_expected_status(
        CaseStatus from,
        CaseCommandType commandType,
        CaseStatus expectedTo
) {
    CaseApplication application = aCase()
            .withStatus(from)
            .withEverythingRequiredFor(commandType)
            .build();

    execute(application, validCommandFor(commandType));

    assertThat(application.status()).isEqualTo(expectedTo);
}

static Stream<Arguments> legalTransitions() {
    return Stream.of(
            arguments(CaseStatus.DRAFT, CaseCommandType.SUBMIT, CaseStatus.SUBMITTED),
            arguments(CaseStatus.SUBMITTED, CaseCommandType.ASSIGN, CaseStatus.UNDER_REVIEW),
            arguments(CaseStatus.UNDER_REVIEW, CaseCommandType.APPROVE, CaseStatus.APPROVED),
            arguments(CaseStatus.UNDER_REVIEW, CaseCommandType.REJECT, CaseStatus.REJECTED),
            arguments(CaseStatus.REJECTED, CaseCommandType.APPEAL, CaseStatus.APPEALED)
    );
}
```

Contoh illegal transition matrix:

```java
@ParameterizedTest(name = "{0} must reject {1}")
@MethodSource("illegalTransitions")
void illegal_transition_is_rejected_without_state_change(
        CaseStatus from,
        CaseCommandType commandType
) {
    CaseApplication application = aCase()
            .withStatus(from)
            .withEverythingRequiredFor(commandType)
            .build();

    assertThatThrownBy(() -> execute(application, validCommandFor(commandType)))
            .isInstanceOf(InvalidCaseTransitionException.class);

    assertThat(application.status()).isEqualTo(from);
    assertThat(application.pullEvents()).isEmpty();
}

static Stream<Arguments> illegalTransitions() {
    return Stream.of(
            arguments(CaseStatus.DRAFT, CaseCommandType.APPROVE),
            arguments(CaseStatus.DRAFT, CaseCommandType.REJECT),
            arguments(CaseStatus.SUBMITTED, CaseCommandType.APPROVE),
            arguments(CaseStatus.APPROVED, CaseCommandType.APPEAL),
            arguments(CaseStatus.CLOSED, CaseCommandType.APPROVE),
            arguments(CaseStatus.CLOSED, CaseCommandType.WITHDRAW)
    );
}
```

### 9.1 Parameterized test tidak boleh mengaburkan behavior

Jangan memaksa semua test menjadi parameterized. Gunakan parameterized test untuk matrix yang strukturnya sama.

Gunakan test eksplisit untuk scenario yang butuh detail naratif:

- approval membutuhkan reason;
- appeal window expired;
- supervisor override;
- clarification timeout;
- duplicate submission;
- audit trail lengkap;
- cross-entity rule.

---

## 10. Guard Condition Testing

Transition legal belum tentu selalu boleh. Guard condition menentukan apakah transition boleh terjadi dalam konteks tertentu.

Contoh guard untuk approval:

```text
UNDER_REVIEW --approve--> APPROVED
  guard: actor has APPROVE_CASE permission
  guard: actor is assigned officer or supervisor
  guard: all mandatory checks passed
  guard: approval reason non-blank
  guard: case not under active hold
```

Setiap guard penting sebaiknya punya test terpisah.

### 10.1 Permission guard

```java
@Test
void officer_without_approve_permission_cannot_approve_case() {
    CaseApplication application = aCase()
            .withStatus(CaseStatus.UNDER_REVIEW)
            .assignedTo(officerId("officer-1"))
            .withAllChecksPassed()
            .build();

    ApproveCase command = approveCase()
            .by(officer("officer-1"))
            .withoutPermission(Permission.APPROVE_CASE)
            .withReason("Requirements satisfied")
            .build();

    assertThatThrownBy(() -> application.approve(command))
            .isInstanceOf(AuthorizationViolationException.class)
            .hasMessageContaining("APPROVE_CASE");

    assertThat(application.status()).isEqualTo(CaseStatus.UNDER_REVIEW);
    assertThat(application.pullEvents()).isEmpty();
}
```

### 10.2 Assignment guard

```java
@Test
void non_assigned_officer_cannot_approve_case_unless_supervisor() {
    CaseApplication application = aCase()
            .withStatus(CaseStatus.UNDER_REVIEW)
            .assignedTo(officerId("officer-1"))
            .withAllChecksPassed()
            .build();

    ApproveCase command = approveCase()
            .by(officer("officer-2"))
            .withPermission(Permission.APPROVE_CASE)
            .withReason("Requirements satisfied")
            .build();

    assertThatThrownBy(() -> application.approve(command))
            .isInstanceOf(AuthorizationViolationException.class)
            .hasMessageContaining("assigned officer");

    assertThat(application.status()).isEqualTo(CaseStatus.UNDER_REVIEW);
}
```

### 10.3 Reason guard

```java
@Test
void approval_reason_is_required() {
    CaseApplication application = aCase()
            .withStatus(CaseStatus.UNDER_REVIEW)
            .assignedTo(officerId("officer-1"))
            .withAllChecksPassed()
            .build();

    ApproveCase command = approveCase()
            .by(officer("officer-1"))
            .withPermission(Permission.APPROVE_CASE)
            .withReason("   ")
            .build();

    assertThatThrownBy(() -> application.approve(command))
            .isInstanceOf(BusinessRuleViolationException.class)
            .hasMessageContaining("reason");
}
```

### 10.4 Guard test rule

Untuk setiap guard:

```text
Given all other guards pass
When this one guard fails
Then transition is rejected
And state remains unchanged
And no domain event/audit side effect is produced
```

Ini mencegah test menjadi ambiguous.

---

## 11. Invariant Testing

Invariant adalah kebenaran yang harus selalu berlaku.

Contoh invariant:

```text
A CLOSED case must have final decision.
An APPROVED case must have approval reason.
A REJECTED case must have rejection reason.
A case cannot be both APPROVED and WITHDRAWN.
An active case must have exactly one current status.
A submitted case must have applicant identity.
A case under review must have assigned officer.
A generated license must refer to approved case.
Audit event timestamp must not be before case creation timestamp.
```

Invariant berbeda dari transition.

Transition test bertanya:

```text
apakah event X boleh mengubah state A ke B?
```

Invariant test bertanya:

```text
apakah setelah operasi apa pun, domain masih valid?
```

### 11.1 Invariant method

Salah satu teknik adalah menyediakan internal validation method:

```java
public void assertInvariants() {
    if (status == CaseStatus.APPROVED && finalDecision == null) {
        throw new DomainInvariantViolation("Approved case must have final decision");
    }
    if (status == CaseStatus.UNDER_REVIEW && assignedOfficerId == null) {
        throw new DomainInvariantViolation("Under review case must have assigned officer");
    }
    if (status == CaseStatus.CLOSED && finalDecision == null) {
        throw new DomainInvariantViolation("Closed case must have final decision");
    }
}
```

Test:

```java
@Test
void approved_case_must_have_final_decision() {
    CaseApplication corrupted = aCase()
            .withStatus(CaseStatus.APPROVED)
            .withoutFinalDecision()
            .buildUnsafeForInvariantTest();

    assertThatThrownBy(corrupted::assertInvariants)
            .isInstanceOf(DomainInvariantViolation.class)
            .hasMessageContaining("final decision");
}
```

### 11.2 Jangan expose unsafe builder sembarangan

`buildUnsafeForInvariantTest()` hanya boleh dipakai untuk test invariant. Jangan jadikan API produksi.

Alternatif yang lebih baik:

- gunakan package-private constructor khusus test;
- gunakan fixture di test package;
- gunakan serialization/deserialization test untuk corrupted persisted data;
- gunakan repository rehydration validation.

---

## 12. Testing Terminal State

Terminal state adalah state yang tidak boleh berubah lagi, kecuali ada explicit exceptional command.

Contoh terminal:

- `CLOSED`
- `WITHDRAWN`
- `REVOKED`
- kadang `APPROVED`, tergantung domain

Test terminal state:

```java
@ParameterizedTest
@EnumSource(CaseCommandType.class)
void closed_case_rejects_all_mutating_commands(CaseCommandType commandType) {
    CaseApplication application = aCase()
            .withStatus(CaseStatus.CLOSED)
            .withFinalDecisionApproved()
            .build();

    assertThatThrownBy(() -> execute(application, validCommandFor(commandType)))
            .isInstanceOf(InvalidCaseTransitionException.class);

    assertThat(application.status()).isEqualTo(CaseStatus.CLOSED);
    assertThat(application.pullEvents()).isEmpty();
}
```

Namun hati-hati: kalau ada command `REOPEN`, jangan masukkan sebagai illegal. Matrix harus mencerminkan business rule.

---

## 13. Testing Idempotency pada Domain Workflow

Idempotency berarti operasi yang sama jika diterima lebih dari sekali tidak menghasilkan efek ganda yang salah.

Tidak semua command harus idempotent. Tetapi untuk sistem enterprise, beberapa command sangat perlu idempotent:

- submit application dari UI yang retry;
- callback payment;
- webhook external system;
- message consumer;
- scheduled escalation;
- approval API dengan client retry;
- document upload callback.

Ada dua model:

### 13.1 Strict duplicate rejection

```text
First submit  → success
Second submit → DuplicateCommandException
```

Test:

```java
@Test
void duplicate_submit_with_same_command_id_is_rejected_without_duplicate_event() {
    CommandId commandId = commandId("cmd-1");
    CaseApplication application = aDraftCaseWithCompleteDocuments();

    application.submit(submitCase().withCommandId(commandId).build());

    assertThatThrownBy(() -> application.submit(submitCase().withCommandId(commandId).build()))
            .isInstanceOf(DuplicateCommandException.class);

    assertThat(application.status()).isEqualTo(CaseStatus.SUBMITTED);
    assertThat(application.history())
            .filteredOn(event -> event instanceof CaseSubmitted)
            .hasSize(1);
}
```

### 13.2 Idempotent same response

```text
First submit  → success response
Second submit → same success response, no duplicate side effect
```

Test:

```java
@Test
void repeated_submit_with_same_idempotency_key_returns_same_result_without_duplicate_event() {
    IdempotencyKey key = idempotencyKey("idem-1");
    CaseApplication application = aDraftCaseWithCompleteDocuments();

    SubmitResult first = application.submit(submitCase().withIdempotencyKey(key).build());
    SubmitResult second = application.submit(submitCase().withIdempotencyKey(key).build());

    assertThat(second).isEqualTo(first);
    assertThat(application.status()).isEqualTo(CaseStatus.SUBMITTED);
    assertThat(application.history())
            .filteredOn(CaseSubmitted.class::isInstance)
            .hasSize(1);
}
```

### 13.3 Rule

Idempotency test harus memeriksa:

```text
same command identity
same aggregate identity
same resulting state
no duplicate event
no duplicate audit
no duplicate external side effect
```

---

## 14. Testing Auditability sebagai Domain Requirement

Audit trail sering dianggap infrastructure concern. Untuk regulated/enterprise workflow, itu salah.

Audit adalah bagian dari correctness.

Minimal audit untuk state transition biasanya mencakup:

- aggregate ID;
- previous state;
- new state;
- actor;
- role/authority;
- timestamp;
- reason;
- source channel;
- correlation ID/request ID;
- affected fields;
- decision/evidence reference.

Contoh domain event:

```java
public record CaseApproved(
        CaseId caseId,
        CaseStatus previousStatus,
        CaseStatus newStatus,
        ActorId actorId,
        String reason,
        Instant occurredAt,
        CorrelationId correlationId
) implements CaseEvent {}
```

Test:

```java
@Test
void approval_records_audit_evidence_needed_for_regulatory_traceability() {
    Instant decisionTime = Instant.parse("2026-06-16T03:00:00Z");
    CorrelationId correlationId = correlationId("req-123");

    CaseApplication application = aCase()
            .withStatus(CaseStatus.UNDER_REVIEW)
            .assignedTo(officerId("officer-1"))
            .withAllChecksPassed()
            .build();

    application.approve(approveCase()
            .by(officer("officer-1"))
            .withPermission(Permission.APPROVE_CASE)
            .withReason("Eligibility confirmed")
            .at(decisionTime)
            .withCorrelationId(correlationId)
            .build());

    assertThat(application.pullEvents())
            .singleElement()
            .isInstanceOfSatisfying(CaseApproved.class, event -> {
                assertThat(event.caseId()).isEqualTo(application.id());
                assertThat(event.previousStatus()).isEqualTo(CaseStatus.UNDER_REVIEW);
                assertThat(event.newStatus()).isEqualTo(CaseStatus.APPROVED);
                assertThat(event.actorId()).isEqualTo(actorId("officer-1"));
                assertThat(event.reason()).isEqualTo("Eligibility confirmed");
                assertThat(event.occurredAt()).isEqualTo(decisionTime);
                assertThat(event.correlationId()).isEqualTo(correlationId);
            });
}
```

### 14.1 Audit anti-pattern

Buruk:

```java
assertThat(auditRepository.count()).isEqualTo(1);
```

Lebih baik:

```java
assertThat(auditEvents)
        .singleElement()
        .satisfies(audit -> {
            assertThat(audit.activity()).isEqualTo("CASE_APPROVED");
            assertThat(audit.previousStatus()).isEqualTo("UNDER_REVIEW");
            assertThat(audit.newStatus()).isEqualTo("APPROVED");
            assertThat(audit.actorId()).isEqualTo("officer-1");
            assertThat(audit.reason()).isEqualTo("Eligibility confirmed");
            assertThat(audit.correlationId()).isEqualTo("req-123");
        });
```

Audit test harus memastikan **makna audit**, bukan jumlah row saja.

---

## 15. Testing Authorization Matrix pada Workflow

Authorization dalam workflow bukan cuma endpoint security.

Contoh:

```text
Applicant can submit own draft.
Applicant cannot approve.
Officer can review assigned case.
Officer cannot approve unassigned case.
Supervisor can reassign.
Supervisor can override assignment.
Admin cannot bypass business guard unless explicit rule says so.
System job can escalate overdue case.
External agency can only update allowed fields.
```

Buat matrix:

| Actor | Draft Submit | Assign | Approve Assigned | Approve Unassigned | Reopen | Withdraw |
|---|---:|---:|---:|---:|---:|---:|
| Applicant | yes own | no | no | no | no | yes own |
| Officer | no | no | yes | no | no | no |
| Supervisor | no | yes | yes | yes | yes | no |
| System Job | no | no | no | no | no | no |
| Admin | depends | depends | depends | depends | depends | depends |

Parameterized test:

```java
@ParameterizedTest(name = "{0} attempting {1} should be {2}")
@MethodSource("authorizationCases")
void workflow_authorization_matrix_is_enforced(
        Actor actor,
        CaseCommandType commandType,
        AuthorizationExpectation expectation
) {
    CaseApplication application = caseReadyFor(commandType)
            .assignedTo(officerId("officer-1"))
            .ownedBy(applicantId("applicant-1"))
            .build();

    Executable action = () -> execute(application, commandFor(commandType).by(actor).build());

    if (expectation == AuthorizationExpectation.ALLOWED) {
        assertThatCode(action::execute).doesNotThrowAnyException();
    } else {
        assertThatThrownBy(action::execute)
                .isInstanceOf(AuthorizationViolationException.class);
    }
}
```

Catatan: `Executable` di atas bisa dari JUnit. Kalau memakai AssertJ, cukup pakai lambda langsung.

### 15.1 Authorization test harus menghindari false confidence

Jangan hanya test:

```java
mockMvc.perform(post("/cases/1/approve").with(user("officer")))
       .andExpect(status().isOk());
```

Itu hanya membuktikan HTTP security sebagian.

Harus ada test di level domain/application:

```text
officer boleh approve hanya jika assigned atau punya supervisor override
```

Karena bug authorization sering terjadi bukan di URL access, tetapi di **object-level permission**.

---

## 16. Testing SLA dan Time-Sensitive Workflow

Time-sensitive rule harus diuji dengan fake clock, bukan `Instant.now()` langsung.

Contoh rule:

```text
Case must be escalated if UNDER_REVIEW for more than 5 working days.
Appeal can be submitted within 14 calendar days after rejection.
Clarification response deadline is 7 days after request.
```

### 16.1 Inject Clock

```java
public final class AppealPolicy {
    private final Clock clock;

    public AppealPolicy(Clock clock) {
        this.clock = clock;
    }

    public boolean canAppeal(CaseApplication application) {
        Instant now = Instant.now(clock);
        return application.status() == CaseStatus.REJECTED
                && !now.isAfter(application.rejectedAt().plus(Duration.ofDays(14)));
    }
}
```

Test:

```java
@Test
void rejected_case_can_be_appealed_on_the_14th_day() {
    Instant rejectedAt = Instant.parse("2026-06-01T00:00:00Z");
    Clock clock = Clock.fixed(Instant.parse("2026-06-15T00:00:00Z"), ZoneOffset.UTC);
    AppealPolicy policy = new AppealPolicy(clock);

    CaseApplication application = aCase()
            .withStatus(CaseStatus.REJECTED)
            .rejectedAt(rejectedAt)
            .build();

    assertThat(policy.canAppeal(application)).isTrue();
}

@Test
void rejected_case_cannot_be_appealed_after_appeal_window_expired() {
    Instant rejectedAt = Instant.parse("2026-06-01T00:00:00Z");
    Clock clock = Clock.fixed(Instant.parse("2026-06-15T00:00:01Z"), ZoneOffset.UTC);
    AppealPolicy policy = new AppealPolicy(clock);

    CaseApplication application = aCase()
            .withStatus(CaseStatus.REJECTED)
            .rejectedAt(rejectedAt)
            .build();

    assertThat(policy.canAppeal(application)).isFalse();
}
```

### 16.2 Boundary time test

Untuk time-sensitive workflow, test minimal:

```text
just before boundary
exactly at boundary
just after boundary
timezone conversion
holiday/weekend if relevant
DST transition if relevant
clock skew if distributed system relevant
```

### 16.3 Jangan pakai sleep

Buruk:

```java
Thread.sleep(1000);
```

Lebih baik:

```java
MutableClock clock = new MutableClock(Instant.parse("2026-06-01T00:00:00Z"));
clock.advance(Duration.ofDays(14));
```

Fake/mutable clock membuat test cepat, deterministik, dan tidak flaky.

---

## 17. Testing Cross-Entity Invariant

Sering kali invariant tidak hidup di satu aggregate saja.

Contoh:

```text
One applicant cannot have two active applications for the same license type.
A license cannot be renewed if there is an unresolved enforcement case.
An appeal cannot be created if original case is not rejected.
A payment cannot be marked settled unless amount matches invoice.
A child case cannot be closed before parent case.
```

Cross-entity rule biasanya tidak cocok dimasukkan semua ke entity. Bisa diletakkan di domain service atau application service.

Contoh:

```java
public final class RenewalEligibilityService {
    private final ActiveCaseRepository activeCaseRepository;
    private final EnforcementRepository enforcementRepository;

    public RenewalEligibility check(ApplicantId applicantId, LicenseType licenseType) {
        if (activeCaseRepository.existsActiveApplication(applicantId, licenseType)) {
            return RenewalEligibility.rejected("Applicant already has active application");
        }
        if (enforcementRepository.existsUnresolvedCase(applicantId)) {
            return RenewalEligibility.rejected("Applicant has unresolved enforcement case");
        }
        return RenewalEligibility.allowed();
    }
}
```

Test dengan fake repository:

```java
@Test
void renewal_is_rejected_when_applicant_has_unresolved_enforcement_case() {
    FakeActiveCaseRepository activeCases = new FakeActiveCaseRepository()
            .withoutActiveApplication(applicantId("app-1"), LicenseType.SALESPERSON);

    FakeEnforcementRepository enforcement = new FakeEnforcementRepository()
            .withUnresolvedCase(applicantId("app-1"));

    RenewalEligibilityService service = new RenewalEligibilityService(activeCases, enforcement);

    RenewalEligibility result = service.check(applicantId("app-1"), LicenseType.SALESPERSON);

    assertThat(result.allowed()).isFalse();
    assertThat(result.reason()).contains("unresolved enforcement case");
}
```

### 17.1 Unit vs integration for cross-entity rule

Gunakan unit test untuk rule semantics.

Gunakan integration test untuk membuktikan query repository benar:

- active status filter benar;
- deleted/archived record tidak dihitung;
- tenant/agency filter benar;
- date range benar;
- transaction visibility benar;
- locking/isolation benar jika concurrent.

---

## 18. Testing Workflow dengan Mini DSL

Jika workflow kompleks, raw test code bisa berisik.

Mini DSL dapat membuat test lebih expressive.

Contoh:

```java
@Test
void applicant_can_respond_to_clarification_and_case_returns_to_under_review() {
    workflow()
            .givenCase(caseId("case-1"))
            .isSubmittedBy(applicant("applicant-1"))
            .isAssignedTo(officer("officer-1"))
            .officerRequestsClarification("Please upload missing document")
            .whenApplicantResponds(applicant("applicant-1"), "Document uploaded")
            .thenCaseStatusIs(CaseStatus.UNDER_REVIEW)
            .andAuditContains("CLARIFICATION_RESPONDED")
            .andCurrentAssigneeIs(officer("officer-1"));
}
```

DSL implementation bisa sederhana:

```java
public final class CaseWorkflowFixture {
    private CaseApplication application;
    private final List<CaseEvent> emittedEvents = new ArrayList<>();

    public static CaseWorkflowFixture workflow() {
        return new CaseWorkflowFixture();
    }

    public CaseWorkflowFixture givenCase(CaseId caseId) {
        this.application = aCase().withId(caseId).withStatus(CaseStatus.DRAFT).build();
        return this;
    }

    public CaseWorkflowFixture isSubmittedBy(Applicant applicant) {
        application.submit(submitCase().by(applicant).withMandatoryData().build());
        emittedEvents.addAll(application.pullEvents());
        return this;
    }

    public CaseWorkflowFixture isAssignedTo(Officer officer) {
        application.assign(assignCase().by(supervisor("sup-1")).toOfficer(officer.id()).build());
        emittedEvents.addAll(application.pullEvents());
        return this;
    }

    public CaseWorkflowFixture officerRequestsClarification(String reason) {
        application.requestClarification(requestClarification().withReason(reason).build());
        emittedEvents.addAll(application.pullEvents());
        return this;
    }

    public CaseWorkflowFixture whenApplicantResponds(Applicant applicant, String response) {
        application.respondClarification(respondClarification().by(applicant).withResponse(response).build());
        emittedEvents.addAll(application.pullEvents());
        return this;
    }

    public CaseWorkflowFixture thenCaseStatusIs(CaseStatus expected) {
        assertThat(application.status()).isEqualTo(expected);
        return this;
    }

    public CaseWorkflowFixture andAuditContains(String activity) {
        assertThat(emittedEvents)
                .extracting(CaseEvent::activity)
                .contains(activity);
        return this;
    }
}
```

### 18.1 DSL rule

DSL boleh menyembunyikan noise, tetapi tidak boleh menyembunyikan rule penting.

Baik:

```java
.officerRequestsClarification("Please upload missing document")
```

Buruk:

```java
.makeItReadyForWhateverTestNeeds()
```

DSL harus meningkatkan clarity, bukan menjadi magic setup.

---

## 19. Testing State Transition Coverage

Line coverage tidak cukup untuk workflow.

Untuk state machine, coverage yang lebih bermakna:

```text
state coverage       : semua state pernah dikunjungi
transition coverage  : semua legal transition diuji
guard coverage       : setiap guard pernah pass dan fail
negative coverage    : illegal transition penting diuji
terminal coverage    : terminal state menolak mutasi
effect coverage      : event/audit/notification diuji untuk transition penting
path coverage        : business journey end-to-end diuji
```

Contoh coverage matrix:

| Coverage Type | Pertanyaan |
|---|---|
| State | Apakah semua status pernah muncul dalam test? |
| Legal transition | Apakah semua transition legal diuji? |
| Illegal transition | Apakah transition berbahaya ditolak? |
| Guard | Apakah semua guard punya success dan failure scenario? |
| Event/effect | Apakah side effect kritikal diuji? |
| Terminal | Apakah closed/withdrawn/revoked tidak bisa dimutasi? |
| Path | Apakah journey utama dari draft sampai final state diuji? |

---

## 20. Model-Based Testing untuk Workflow

Untuk workflow sangat kompleks, kamu bisa naik ke model-based testing.

Model-based testing berarti:

```text
buat model state machine → generate/derive test path → jalankan terhadap implementation → bandingkan expected state/effect
```

Secara konseptual, model-based testing membantu memastikan coverage behavior, bukan hanya coverage code. Literatur testing juga menunjukkan model-based test suites dapat membantu mendeteksi requirements errors secara lebih baik dibanding test manual yang langsung diturunkan dari requirement naratif.

Di Java, kamu tidak harus memakai library khusus. Bisa mulai dari transition graph sederhana.

Contoh model:

```java
record TransitionSpec(
        CaseStatus from,
        CaseCommandType command,
        CaseStatus to,
        Predicate<TestContext> guard
) {}
```

Generate simple one-step transition test:

```java
@ParameterizedTest
@MethodSource("transitionSpecs")
void implementation_follows_transition_model(TransitionSpec spec) {
    CaseApplication application = aCase()
            .withStatus(spec.from())
            .withContextSatisfying(spec.guard())
            .build();

    execute(application, validCommandFor(spec.command()));

    assertThat(application.status()).isEqualTo(spec.to());
}
```

Generate path test:

```java
@Test
void happy_path_from_draft_to_approved_follows_model() {
    CaseApplication application = aDraftCaseWithCompleteDocuments();

    execute(application, submitCommand());
    assertThat(application.status()).isEqualTo(CaseStatus.SUBMITTED);

    execute(application, assignCommand());
    assertThat(application.status()).isEqualTo(CaseStatus.UNDER_REVIEW);

    execute(application, approveCommand());
    assertThat(application.status()).isEqualTo(CaseStatus.APPROVED);
}
```

### 20.1 Jangan over-engineer dari awal

Mulai dari:

1. transition matrix manual;
2. parameterized test;
3. DSL fixture;
4. model-based generation jika workflow makin besar.

---

## 21. Testing Aggregate Rehydration dan Persisted State

Domain object sering tidak dibuat dari constructor biasa, tetapi direhydrate dari database/event store.

Bug umum:

- persisted status invalid;
- field wajib null;
- enum lama tidak dikenali;
- legacy data tidak memenuhi invariant baru;
- partial migration membuat aggregate tidak valid;
- archived/deleted flag salah ditafsirkan;
- timezone persisted salah.

Test rehydration:

```java
@Test
void rehydrated_under_review_case_requires_assigned_officer() {
    PersistedCaseRow row = persistedCaseRow()
            .withStatus("UNDER_REVIEW")
            .withAssignedOfficerId(null)
            .build();

    assertThatThrownBy(() -> CaseApplication.rehydrate(row))
            .isInstanceOf(DomainInvariantViolation.class)
            .hasMessageContaining("assigned officer");
}
```

Test legacy compatibility:

```java
@Test
void legacy_approved_case_without_reason_is_mapped_to_unknown_reason_for_read_only_compatibility() {
    PersistedCaseRow legacyRow = persistedCaseRow()
            .withStatus("APPROVED")
            .withApprovalReason(null)
            .createdBefore(Instant.parse("2024-01-01T00:00:00Z"))
            .build();

    CaseApplication application = CaseApplication.rehydrateLegacy(legacyRow);

    assertThat(application.status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(application.finalDecision().reason()).isEqualTo("<legacy-not-recorded>");
}
```

### 21.1 Migration-aware testing

Kalau rule baru lebih ketat dari data lama, test harus membedakan:

```text
new write path must enforce invariant
old read path may tolerate legacy state explicitly
migration should repair or classify legacy records
```

---

## 22. Testing Domain Events

Domain event bukan cuma side-effect; event adalah catatan bahwa sesuatu yang bermakna terjadi.

Event test harus menjawab:

```text
Apakah event terjadi saat business fact terjadi?
Apakah event tidak terjadi saat transition gagal?
Apakah payload event cukup untuk downstream consumer?
Apakah event ordering benar?
Apakah event identity/idempotency benar?
```

Contoh:

```java
@Test
void approval_emits_case_approved_before_license_generation_requested() {
    CaseApplication application = caseUnderReviewReadyForApproval();

    application.approve(validApprovalCommand());

    assertThat(application.pullEvents())
            .extracting(CaseEvent::activity)
            .containsExactly(
                    "CASE_APPROVED",
                    "LICENSE_GENERATION_REQUESTED"
            );
}
```

### 22.1 Event ordering

Ordering penting jika downstream bergantung pada urutan.

Buruk:

```java
contains("CASE_APPROVED", "LICENSE_GENERATION_REQUESTED")
```

Baik jika order wajib:

```java
containsExactly("CASE_APPROVED", "LICENSE_GENERATION_REQUESTED")
```

### 22.2 Event should not leak implementation detail

Event sebaiknya merepresentasikan business fact:

Baik:

```text
CASE_APPROVED
CLARIFICATION_REQUESTED
APPEAL_SUBMITTED
SLA_BREACHED
```

Buruk:

```text
CASE_STATUS_FIELD_UPDATED
APPROVE_METHOD_CALLED
ROW_SAVED
```

Test event harus menjaga bahasa domain.

---

## 23. Testing Application Service Boundary

Domain unit test saja tidak cukup. Application service perlu diuji karena di sinilah orchestration side-effect terjadi.

Contoh service:

```java
public final class ApproveCaseService {
    private final CaseRepository repository;
    private final PermissionService permissionService;
    private final AuditWriter auditWriter;
    private final EventPublisher eventPublisher;
    private final Clock clock;

    public ApproveCaseResult approve(ApproveCaseRequest request) {
        CaseApplication application = repository.getById(request.caseId());
        Actor actor = permissionService.currentActor();
        PermissionSet permissions = permissionService.permissionsFor(actor, request.caseId());

        application.approve(new ApproveCase(
                request.caseId(),
                actor.id(),
                permissions,
                request.reason(),
                Instant.now(clock),
                request.correlationId()
        ));

        repository.save(application);

        List<CaseEvent> events = application.pullEvents();
        auditWriter.write(events);
        eventPublisher.publish(events);

        return ApproveCaseResult.approved(application.id());
    }
}
```

Application service test:

```java
@Test
void approve_loads_case_checks_permission_saves_and_publishes_audit_events() {
    FakeCaseRepository repository = new FakeCaseRepository()
            .with(caseUnderReviewReadyForApproval(caseId("case-1")));
    FakePermissionService permissions = new FakePermissionService()
            .withCurrentActor(officer("officer-1"))
            .allow(caseId("case-1"), Permission.APPROVE_CASE);
    FakeAuditWriter audit = new FakeAuditWriter();
    FakeEventPublisher publisher = new FakeEventPublisher();
    Clock clock = Clock.fixed(Instant.parse("2026-06-16T03:00:00Z"), ZoneOffset.UTC);

    ApproveCaseService service = new ApproveCaseService(repository, permissions, audit, publisher, clock);

    service.approve(new ApproveCaseRequest(caseId("case-1"), "Eligible", correlationId("req-1")));

    assertThat(repository.savedCase(caseId("case-1")).status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(audit.writtenEvents())
            .extracting(CaseEvent::activity)
            .containsExactly("CASE_APPROVED");
    assertThat(publisher.publishedEvents())
            .extracting(CaseEvent::activity)
            .containsExactly("CASE_APPROVED");
}
```

### 23.1 What not to oververify

Jangan terlalu rigid:

```java
verify(repository, times(1)).getById(...);
verify(repository, times(1)).save(...);
verifyNoMoreInteractions(...);
```

Kecuali interaction itu benar-benar contract penting. Untuk application service, lebih baik assert observable result:

- saved state;
- emitted audit;
- published event;
- error behavior;
- no side effect on failure.

---

## 24. Testing Failure Atomicity

Workflow bug sering muncul ketika operasi gagal di tengah.

Contoh:

```text
approve changes state
repository save succeeds
audit write fails
event publish skipped
```

Pertanyaan penting:

```text
Apakah approval tetap dianggap sukses?
Apakah retry akan duplicate?
Apakah audit wajib transactional?
Apakah event memakai outbox?
Apakah user menerima response apa?
```

Test failure atomicity:

```java
@Test
void approval_failure_before_save_does_not_change_persisted_case_or_publish_event() {
    FakeCaseRepository repository = new FakeCaseRepository()
            .with(caseUnderReviewReadyForApproval(caseId("case-1")))
            .failOnSave(new DatabaseException("DB down"));
    FakeEventPublisher publisher = new FakeEventPublisher();

    ApproveCaseService service = serviceWith(repository, publisher);

    assertThatThrownBy(() -> service.approve(validApproveRequest(caseId("case-1"))))
            .isInstanceOf(DatabaseException.class);

    assertThat(repository.persistedCase(caseId("case-1")).status())
            .isEqualTo(CaseStatus.UNDER_REVIEW);
    assertThat(publisher.publishedEvents()).isEmpty();
}
```

Kalau memakai outbox:

```java
@Test
void approval_persists_state_and_outbox_event_in_same_transaction() {
    service.approve(validApproveRequest(caseId("case-1")));

    assertThat(database.caseStatus(caseId("case-1"))).isEqualTo(CaseStatus.APPROVED);
    assertThat(database.outboxEventsFor(caseId("case-1")))
            .singleElement()
            .extracting(OutboxEvent::type)
            .isEqualTo("CASE_APPROVED");
}
```

---

## 25. Testing Workflow dengan Database: Kapan Perlu?

Domain logic sebaiknya banyak diuji tanpa database. Tetapi beberapa rule wajib diuji dengan database nyata.

Perlu database integration test untuk:

- unique constraint;
- optimistic locking;
- transaction isolation;
- query filter;
- pagination;
- cross-entity lookup;
- outbox transaction;
- rehydration dari persisted row;
- migration compatibility;
- enum/string mapping;
- date/time persistence;
- LOB/JSON field jika dipakai untuk audit/evidence.

Contoh optimistic lock:

```java
@Test
void concurrent_approval_of_same_case_allows_only_one_successful_decision() {
    CaseId caseId = database.insert(caseUnderReviewReadyForApproval());

    CaseApplication firstCopy = repository.getById(caseId);
    CaseApplication secondCopy = repository.getById(caseId);

    firstCopy.approve(validApprovalCommandBy("officer-1"));
    repository.save(firstCopy);

    secondCopy.approve(validApprovalCommandBy("officer-2"));

    assertThatThrownBy(() -> repository.save(secondCopy))
            .isInstanceOf(OptimisticLockException.class);

    assertThat(repository.getById(caseId).status()).isEqualTo(CaseStatus.APPROVED);
}
```

Ini tidak bisa dibuktikan cukup dengan unit test biasa.

---

## 26. Testing Concurrency pada Domain Workflow

Part concurrency khusus akan dibahas lebih dalam nanti, tetapi domain workflow sering butuh minimal concurrency test.

Contoh race:

```text
Officer A approves case
Officer B rejects same case at nearly same time
```

Expected:

```text
Only one final decision wins.
Losing command must fail cleanly.
There must not be two final audit events.
```

Pseudo-test:

```java
@Test
void concurrent_final_decisions_result_in_single_final_state() throws Exception {
    CaseId caseId = database.insert(caseUnderReviewReadyForApproval());
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);

    Callable<Result> approve = () -> {
        start.await();
        return attempt(() -> approveService.approve(validApproveRequest(caseId)));
    };

    Callable<Result> reject = () -> {
        start.await();
        return attempt(() -> rejectService.reject(validRejectRequest(caseId)));
    };

    Future<Result> approval = executor.submit(approve);
    Future<Result> rejection = executor.submit(reject);

    start.countDown();

    List<Result> results = List.of(approval.get(), rejection.get());

    assertThat(results).filteredOn(Result::success).hasSize(1);
    assertThat(results).filteredOn(Result::failedDueToConcurrency).hasSize(1);

    CaseApplication persisted = repository.getById(caseId);
    assertThat(persisted.status()).isIn(CaseStatus.APPROVED, CaseStatus.REJECTED);
    assertThat(auditRepository.finalDecisionEvents(caseId)).hasSize(1);
}
```

Catatan:

- test concurrency bisa flaky jika tidak dikontrol;
- gunakan synchronization helper seperti latch/barrier;
- untuk low-level concurrency correctness gunakan jcstress, bukan JUnit biasa;
- untuk database concurrency gunakan database nyata.

---

## 27. Testing Workflow Error Semantics

Error semantics harus eksplisit.

Contoh error types:

```java
public sealed class CaseCommandException extends RuntimeException
        permits InvalidCaseTransitionException,
                BusinessRuleViolationException,
                AuthorizationViolationException,
                DuplicateCommandException,
                ConcurrencyConflictException {
}
```

Jika belum memakai sealed class karena Java 8/11, gunakan class hierarchy biasa.

Test error semantics:

```java
@Test
void approving_closed_case_returns_invalid_transition_not_authorization_error() {
    CaseApplication application = aCase()
            .withStatus(CaseStatus.CLOSED)
            .withFinalDecisionApproved()
            .build();

    ApproveCase command = approveCase()
            .by(officer("officer-1"))
            .withoutPermission(Permission.APPROVE_CASE)
            .build();

    assertThatThrownBy(() -> application.approve(command))
            .isInstanceOf(InvalidCaseTransitionException.class);
}
```

Kenapa ini penting?

Karena order validation bisa menjadi security decision.

Kadang kamu ingin authorization dicek dulu agar tidak membocorkan status object. Kadang kamu ingin transition dicek dulu di pure domain. Pilihan harus sadar, bukan kebetulan.

### 27.1 Security-sensitive ordering

Untuk external API:

```text
If actor cannot see case → return 404/403 without revealing workflow state.
If actor can see but cannot act → return 403.
If actor can act but state invalid → return 409.
If request invalid → return 400.
```

Test application service/API harus mencerminkan ordering ini.

---

## 28. Testing Read Model vs Write Model

Dalam banyak enterprise system, write model dan read model berbeda.

Write model:

```text
validates command and changes domain state
```

Read model:

```text
shows listing/detail/history/search/projection
```

Bug bisa terjadi ketika write state benar tetapi read projection salah.

Contoh test projection:

```java
@Test
void approved_case_appears_in_listing_with_final_decision_and_latest_activity() {
    CaseId caseId = workflow()
            .createSubmittedCase()
            .assignToOfficer("officer-1")
            .approveWithReason("Eligible")
            .caseId();

    CaseListingRow row = listingRepository.findById(caseId);

    assertThat(row.status()).isEqualTo("APPROVED");
    assertThat(row.finalDecision()).isEqualTo("Approved");
    assertThat(row.latestActivity()).isEqualTo("CASE_APPROVED");
    assertThat(row.decisionReason()).isEqualTo("Eligible");
}
```

Ini biasanya integration/component test karena melibatkan DB view/query/projection.

---

## 29. Testing Reportability dan Regulatory Defensibility

Untuk sistem regulatory/case management, correctness sering berarti:

```text
Keputusan dapat dijelaskan setelah kejadian.
```

Test harus memastikan data untuk explanation tersedia.

Contoh defensibility questions:

- siapa membuat keputusan?
- kapan keputusan dibuat?
- berdasarkan evidence apa?
- rule apa yang dipakai?
- status sebelumnya apa?
- status sesudahnya apa?
- apakah actor punya authority saat itu?
- apakah ada override?
- apakah alasan override disimpan?
- apakah applicant mendapat notification?
- apakah SLA dipenuhi atau dilanggar?

Test:

```java
@Test
void rejection_captures_reason_rule_reference_actor_and_evidence_snapshot() {
    CaseApplication application = caseUnderReviewWithEvidence(
            evidence("doc-1", "Missing mandatory certification")
    );

    application.reject(rejectCase()
            .by(officer("officer-1"))
            .withPermission(Permission.REJECT_CASE)
            .withReason("Mandatory certification missing")
            .withRuleReference("RULE-ELIGIBILITY-004")
            .withEvidenceRefs(List.of(evidenceId("doc-1")))
            .at(Instant.parse("2026-06-16T03:00:00Z"))
            .build());

    assertThat(application.finalDecision())
            .satisfies(decision -> {
                assertThat(decision.type()).isEqualTo(DecisionType.REJECTED);
                assertThat(decision.reason()).isEqualTo("Mandatory certification missing");
                assertThat(decision.ruleReference()).isEqualTo("RULE-ELIGIBILITY-004");
                assertThat(decision.evidenceRefs()).containsExactly(evidenceId("doc-1"));
                assertThat(decision.actorId()).isEqualTo(actorId("officer-1"));
            });
}
```

---

## 30. Java 8–25 Compatibility Notes

### 30.1 Java 8

Java 8 masih umum di legacy enterprise.

Ciri test stack:

- JUnit 4 atau JUnit 5 Jupiter yang masih mendukung Java 8;
- tidak ada record;
- tidak ada sealed class;
- tidak ada switch expression;
- tidak ada `List.of`;
- Optional/Stream tersedia;
- `Clock` tersedia dan sangat berguna untuk time test.

Contoh Java 8-compatible value object:

```java
public final class CaseApproved implements CaseEvent {
    private final CaseId caseId;
    private final ActorId actorId;
    private final String reason;
    private final Instant occurredAt;

    public CaseApproved(CaseId caseId, ActorId actorId, String reason, Instant occurredAt) {
        this.caseId = caseId;
        this.actorId = actorId;
        this.reason = reason;
        this.occurredAt = occurredAt;
    }

    public CaseId caseId() { return caseId; }
    public ActorId actorId() { return actorId; }
    public String reason() { return reason; }
    public Instant occurredAt() { return occurredAt; }
}
```

### 30.2 Java 11

Java 11 sering menjadi migration baseline.

Tambahan berguna:

- `var` untuk local variable jika team mengizinkan;
- `List.of`, `Map.of` dari Java 9 sudah ada;
- better HTTP client untuk integration client test jika relevan.

### 30.3 Java 17

Java 17 adalah baseline modern untuk banyak enterprise.

Berguna untuk domain test:

- record untuk command/event DTO;
- sealed class untuk error hierarchy atau event hierarchy;
- pattern matching instanceof;
- text block dari Java 15 untuk JSON fixture.

Contoh sealed event:

```java
public sealed interface CaseEvent
        permits CaseSubmitted, CaseAssigned, CaseApproved, CaseRejected {
    CaseId caseId();
    Instant occurredAt();
}

public record CaseApproved(
        CaseId caseId,
        ActorId actorId,
        String reason,
        Instant occurredAt
) implements CaseEvent {}
```

### 30.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Untuk domain test murni tidak terlalu berpengaruh, tetapi penting untuk application workflow yang menjalankan banyak blocking IO.

Testing concern:

- jangan asumsikan thread identity sebagai business identity;
- ThreadLocal user context harus diuji hati-hati;
- virtual thread bisa mengubah concurrency profile;
- workflow logic tetap harus deterministic.

### 30.5 Java 25

Untuk Java 25, fokus testing domain tetap sama. Yang berubah lebih banyak pada platform/tooling dan baseline modern. Pastikan:

- test suite berjalan di JDK target;
- build tool mendukung JDK target;
- test framework compatibility dicek;
- preview feature tidak menjadi dependency test kecuali sengaja.

---

## 31. Domain Test Smells

### 31.1 Test hanya assert status

```java
assertThat(case.status()).isEqualTo(APPROVED);
```

Jika approval butuh audit, decision reason, actor, dan event, assertion ini terlalu lemah.

### 31.2 Test menyalin implementation detail

Buruk:

```java
assertThat(case.getInternalTransitionCounter()).isEqualTo(3);
```

Lebih baik:

```java
assertThat(case.history()).extracting(CaseEvent::activity)
        .containsExactly("CASE_SUBMITTED", "CASE_ASSIGNED", "CASE_APPROVED");
```

### 31.3 Magic fixture

Buruk:

```java
CaseApplication c = TestFixtures.validCase();
```

Masalah: valid untuk apa?

Lebih baik:

```java
CaseApplication c = aCase()
        .withStatus(CaseStatus.UNDER_REVIEW)
        .assignedTo(officerId("officer-1"))
        .withAllChecksPassed()
        .build();
```

### 31.4 Testing happy path saja

Workflow harus menguji illegal transition dan guard failure.

### 31.5 Ignoring no-side-effect assertion

Saat transition gagal, test harus memeriksa state dan event tidak berubah.

### 31.6 Overmocked domain test

Domain object seharusnya tidak butuh mock banyak. Jika butuh banyak mock, kemungkinan domain logic terlalu tersebar atau terlalu framework-dependent.

### 31.7 Time test pakai current time

Buruk:

```java
Instant.now()
LocalDate.now()
```

Lebih baik:

```java
Clock.fixed(...)
```

### 31.8 Authorization hanya diuji di endpoint

Object-level permission harus diuji di application/domain decision point.

---

## 32. Step-by-Step: Membuat Test Strategy untuk Satu Workflow

Gunakan langkah berikut untuk workflow apa pun.

### Step 1: Definisikan state

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_CLARIFICATION
APPROVED
REJECTED
WITHDRAWN
CLOSED
```

### Step 2: Definisikan command/event

```text
submit
assign
request clarification
respond clarification
approve
reject
appeal
withdraw
close
```

### Step 3: Buat transition matrix

```text
from + command → to / rejected
```

### Step 4: Definisikan guard per transition

```text
permission
ownership
assignment
required data
deadline
business rule
cross-entity rule
```

### Step 5: Definisikan effects

```text
domain event
audit
notification
outbox
read model update
external callback
```

### Step 6: Definisikan invariant

```text
approved must have decision
under review must have assignee
closed must have final state
terminal cannot mutate
```

### Step 7: Pilih test level

| Rule | Best Test Level |
|---|---|
| Pure transition | domain unit test |
| Guard with role | domain/application unit test |
| Guard with DB lookup | application + repository fake, plus integration query test |
| Outbox transaction | integration test |
| Workflow journey | component test |
| UI/API compatibility | API/contract test |
| Concurrent final decision | DB integration/concurrency test |

### Step 8: Implement fixture/builder

Builder harus membuat setup eksplisit.

### Step 9: Tambahkan matrix/parameterized test

Untuk coverage transition.

### Step 10: Tambahkan scenario narrative test

Untuk high-value business journeys.

---

## 33. Example: Full Workflow Test Set

Untuk workflow approval, minimal test set:

### Legal transitions

```text
DRAFT submit → SUBMITTED
SUBMITTED assign → UNDER_REVIEW
UNDER_REVIEW approve → APPROVED
UNDER_REVIEW reject → REJECTED
UNDER_REVIEW request clarification → PENDING_CLARIFICATION
PENDING_CLARIFICATION respond → UNDER_REVIEW
REJECTED appeal → APPEALED
```

### Illegal transitions

```text
DRAFT approve rejected
SUBMITTED approve rejected
APPROVED appeal rejected
CLOSED any mutating command rejected
WITHDRAWN approve rejected
```

### Guard failures

```text
submit without mandatory documents rejected
approve without permission rejected
approve by non-assigned officer rejected
approve without reason rejected
reject without reason rejected
appeal after deadline rejected
withdraw by non-owner rejected
```

### Effects

```text
submit emits CASE_SUBMITTED
assign emits CASE_ASSIGNED
approve emits CASE_APPROVED and audit evidence
reject emits CASE_REJECTED and reason
clarification emits CLARIFICATION_REQUESTED
appeal emits APPEAL_SUBMITTED
```

### Invariants

```text
approved has final decision
rejected has rejection reason
under review has assignee
closed has final decision
terminal states do not mutate
```

### Cross-entity

```text
cannot renew with unresolved enforcement case
cannot create duplicate active application
cannot close parent before child cases closed
```

### Concurrency

```text
concurrent approve/reject results in only one final decision
```

---

## 34. Top 1% Engineer Notes

### 34.1 Strong engineers test rules, not methods

They ask:

```text
What rule is protected by this test?
What production failure would this catch?
What invariant does this preserve?
```

### 34.2 Strong engineers separate state, guard, and effect

Weak test:

```text
approve works
```

Strong test decomposition:

```text
approve is allowed from UNDER_REVIEW
approve is rejected from DRAFT/SUBMITTED/CLOSED
approve requires permission
approve requires assignment
approve requires reason
approve records decision
approve emits audit event
approve is atomic on failure
approve is concurrency-safe
```

### 34.3 Strong engineers design negative tests intentionally

Illegal transitions are not edge cases. They are often where real incidents happen.

### 34.4 Strong engineers make audit part of correctness

If a system must be explainable, audit is not optional infrastructure. It is business behavior.

### 34.5 Strong engineers use matrix, not memory

For workflow-heavy systems, relying on memory is dangerous. Matrix exposes missing paths.

### 34.6 Strong engineers avoid false confidence

100% line coverage can still miss:

- illegal transition;
- missing audit;
- wrong actor;
- duplicate side effect;
- stale read model;
- race condition;
- invalid persisted state.

### 34.7 Strong engineers know when to move test level

Pure domain rule? Unit test.

DB constraint? Integration test.

Workflow journey? Component test.

Concurrent final decision? Database/concurrency test.

API compatibility? Contract/API test.

---

## 35. Practical Checklist

Sebelum menganggap workflow test cukup, cek:

```text
[ ] Semua state utama terwakili.
[ ] Semua legal transition penting diuji.
[ ] Illegal transition berbahaya diuji.
[ ] Guard condition diuji satu per satu.
[ ] Failure tidak mengubah state secara parsial.
[ ] Failure tidak menghasilkan event/audit palsu.
[ ] Terminal state menolak mutasi.
[ ] Audit event menyimpan actor, reason, timestamp, previous/new state.
[ ] Authorization diuji di decision point, bukan hanya endpoint.
[ ] Time-sensitive rule memakai fake Clock.
[ ] Boundary time diuji.
[ ] Cross-entity rule diuji.
[ ] Rehydration/persisted state diuji jika data berasal dari DB.
[ ] Outbox/transaction diuji jika side effect harus atomic.
[ ] Concurrent final decision diuji jika business-critical.
[ ] Test name menjelaskan behavior, bukan method.
[ ] Fixture eksplisit dan tidak magic.
```

---

## 36. Latihan Mandiri

Ambil satu workflow nyata, misalnya:

```text
Application Renewal
Appeal Submission
Case Escalation
Document Clarification
Payment Confirmation
License Revocation
```

Lakukan:

1. tulis semua state;
2. tulis semua command;
3. buat transition matrix;
4. tandai terminal state;
5. tulis guard per transition;
6. tulis required audit/effect per transition;
7. tulis invariant;
8. buat 5 legal transition tests;
9. buat 5 illegal transition tests;
10. buat 3 guard failure tests;
11. buat 1 SLA/time-boundary test;
12. buat 1 idempotency test;
13. buat 1 failure atomicity test;
14. buat 1 cross-entity rule test;
15. review apakah test membuktikan behavior atau hanya implementation.

---

## 37. Ringkasan

Domain workflow testing adalah salah satu pembeda engineer biasa dan engineer yang kuat dalam sistem enterprise.

Inti part ini:

1. test domain bukan test method;
2. workflow harus dimodelkan sebagai state, command/event, transition, guard, effect, dan invariant;
3. transition matrix membantu menemukan missing test;
4. legal transition dan illegal transition sama-sama penting;
5. guard condition harus diuji secara terisolasi;
6. auditability adalah bagian dari correctness untuk sistem regulated;
7. authorization harus diuji di decision point;
8. time-sensitive workflow harus memakai fake clock;
9. idempotency dan failure atomicity harus menjadi first-class test concern;
10. line coverage tidak cukup untuk workflow; gunakan state/transition/guard/effect coverage.

Jika part ini diterapkan dengan disiplin, test suite tidak hanya mengatakan “kode jalan”, tetapi mengatakan:

```text
Business process ini valid, defensible, traceable, dan tahan terhadap misuse serta failure mode penting.
```

---

## 38. Referensi

- JUnit 5 User Guide — parameterized tests, nested tests, assertions, lifecycle.
- AssertJ Core Documentation — fluent assertions and recursive comparison.
- Martin Fowler — domain modeling, state machine discussion, and testing vocabulary.
- Stately/XState Documentation — state machines, statecharts, model-based testing concepts.
- Research on model-based testing — behavior model and transition/path-based test generation.

---

## 39. Status Seri

Progress seri:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 selesai
```

Seri belum selesai. Berikutnya:

```text
Part 008 — Testing Error Handling, Exception Semantics, Retry, Timeout, dan Idempotency
```
