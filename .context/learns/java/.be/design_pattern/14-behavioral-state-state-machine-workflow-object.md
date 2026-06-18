# 14 — Behavioral Pattern VI: State, State Machine, Workflow Object

> Series: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: `14 / 35`  
> File: `14-behavioral-state-state-machine-workflow-object.md`  
> Scope: Java 8–25, enterprise application design, regulatory/case-management workflow, domain lifecycle modeling, auditability, failure control.

---

## 0. Executive Summary

Banyak sistem enterprise terlihat sederhana karena hanya menyimpan kolom seperti:

```java
status = "APPROVED";
```

Tetapi realitas bisnisnya jauh lebih kompleks:

- siapa yang boleh mengubah status,
- dari status mana ke status mana,
- kapan transisi boleh dilakukan,
- validasi apa yang wajib lolos,
- side effect apa yang terjadi,
- audit apa yang harus dicatat,
- event apa yang harus dipublikasikan,
- apakah transisi boleh diulang,
- bagaimana menangani race condition,
- bagaimana menjelaskan keputusan kepada user, auditor, regulator, atau support team.

Di sinilah **State Pattern**, **State Machine**, dan **Workflow Object** menjadi sangat penting.

Pattern ini bukan sekadar mengganti `switch(status)` menjadi banyak class. Intinya adalah membuat **lifecycle sebagai model eksplisit** sehingga sistem memiliki invariant yang jelas, failure mode yang terkendali, dan jejak keputusan yang dapat dipertanggungjawabkan.

Mental model utama:

```text
Status adalah label.
State adalah posisi perilaku.
Transition adalah perubahan yang valid.
Guard adalah alasan boleh/tidak boleh berubah.
Action adalah konsekuensi perubahan.
Workflow adalah lifecycle yang punya aturan, aktor, audit, dan efek samping.
```

Engineer junior sering berpikir:

```text
"Tinggal update status."
```

Engineer senior berpikir:

```text
"Apa invariant lifecycle-nya?
Dari state mana transisi ini valid?
Siapa aktornya?
Apa guard condition-nya?
Apakah command ini idempotent?
Apakah efek sampingnya atomic?
Apa yang terjadi jika dua user submit bersamaan?
Apakah audit menjelaskan alasan transisi?
Apakah status ini hanya label atau mengubah behavior?"
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan `status enum`, `State Pattern`, `State Machine`, dan `Workflow Object`.
2. Mendesain lifecycle object yang eksplisit, aman, dan dapat diuji.
3. Mengidentifikasi anti-pattern seperti boolean state explosion dan workflow yang tersembunyi di service method.
4. Mendesain transition rule, guard condition, entry action, exit action, audit trail, dan event publication.
5. Memilih representasi yang tepat:
   - simple enum,
   - enum with behavior,
   - polymorphic state,
   - table-driven state machine,
   - workflow object,
   - external workflow/BPM engine.
6. Menggunakan fitur Java 8–25 untuk lifecycle modeling:
   - enum,
   - records,
   - sealed interfaces,
   - pattern matching,
   - functional interface,
   - immutable transition result,
   - virtual thread-aware workflow orchestration.
7. Menulis test untuk lifecycle invariant, illegal transition, concurrency, idempotency, auditability, dan regression safety.
8. Melakukan refactoring dari `if/switch` status spaghetti menuju model workflow yang bersih.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sistem case management/regulatory enforcement dengan lifecycle seperti ini:

```text
DRAFT
  -> SUBMITTED
  -> SCREENING
  -> UNDER_REVIEW
  -> PENDING_CLARIFICATION
  -> UNDER_REVIEW
  -> APPROVED
  -> CLOSED
```

Ada juga cabang:

```text
UNDER_REVIEW -> REJECTED
UNDER_REVIEW -> ESCALATED
ESCALATED    -> APPROVED
ESCALATED    -> REJECTED
APPROVED     -> REVOKED
```

Aturan bisnisnya:

- case hanya bisa `SUBMITTED` jika mandatory document lengkap,
- case hanya bisa `APPROVED` oleh officer dengan role tertentu,
- case yang `CLOSED` tidak boleh diubah,
- case yang `REVOKED` harus punya revocation reason,
- transisi `ESCALATED` harus mencatat escalation level,
- transisi tertentu harus mengirim notification,
- beberapa transisi harus menghasilkan audit trail,
- beberapa transisi harus publish domain event,
- beberapa transisi harus mengunci field tertentu,
- beberapa transisi hanya bisa terjadi sebelum deadline,
- beberapa transisi harus idempotent karena user bisa double-click atau request retry.

Implementasi buruk biasanya seperti ini:

```java
public void updateStatus(Long caseId, String newStatus) {
    Case c = repository.findById(caseId);

    if ("CLOSED".equals(c.getStatus())) {
        throw new IllegalStateException("Closed case cannot be updated");
    }

    if ("APPROVED".equals(newStatus)) {
        if (!currentUser.hasRole("APPROVER")) {
            throw new ForbiddenException();
        }
        if (!c.hasAllDocuments()) {
            throw new ValidationException("Missing documents");
        }
        notificationService.sendApproved(c);
    }

    if ("REJECTED".equals(newStatus)) {
        if (c.getRejectionReason() == null) {
            throw new ValidationException("Reason required");
        }
    }

    c.setStatus(newStatus);
    audit.log("Status changed");
    repository.save(c);
}
```

Masalahnya bukan hanya code style. Masalah sebenarnya:

1. **Valid transition tidak eksplisit**.
2. **Guard condition tersebar**.
3. **Audit tidak menjelaskan decision**.
4. **Side effect bercampur dengan mutation**.
5. **Tidak ada model idempotency**.
6. **Tidak jelas mana state terminal**.
7. **Tidak jelas siapa pemilik lifecycle rule**.
8. **Sulit test semua kombinasi state**.
9. **Sulit menganalisis dampak perubahan requirement**.
10. **Race condition mudah terjadi**.

State machine membuat lifecycle menjadi model eksplisit, bukan efek samping dari service method.

---

## 3. Mental Model

### 3.1 Status vs State

`status` adalah data.

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

`state` adalah posisi perilaku.

Contoh:

```text
DRAFT:
- boleh edit form
- boleh upload document
- boleh submit
- tidak boleh approve

UNDER_REVIEW:
- tidak boleh edit applicant data sembarangan
- boleh request clarification
- boleh approve
- boleh reject

CLOSED:
- read-only
- tidak boleh transisi normal
```

Jika value hanya dipakai untuk display/filtering, itu status.

Jika value menentukan behavior, permission, validation, transition, audit, dan side effect, itu state.

---

### 3.2 State Machine sebagai Graph

State machine bisa dipahami sebagai directed graph:

```text
[State A] --transition--> [State B]
```

Contoh:

```text
DRAFT --submit--> SUBMITTED
SUBMITTED --start_screening--> SCREENING
SCREENING --assign_reviewer--> UNDER_REVIEW
UNDER_REVIEW --request_clarification--> PENDING_CLARIFICATION
PENDING_CLARIFICATION --respond--> UNDER_REVIEW
UNDER_REVIEW --approve--> APPROVED
UNDER_REVIEW --reject--> REJECTED
APPROVED --close--> CLOSED
REJECTED --close--> CLOSED
```

Yang penting bukan hanya node dan edge, tetapi juga aturan pada edge.

```text
Transition = from + action + to + guard + side effect + audit + event
```

---

### 3.3 Guard, Action, Effect

Dalam workflow, transisi biasanya memiliki tiga lapisan:

```text
Guard       : boleh atau tidak?
Mutation    : state berubah menjadi apa?
Effect      : apa konsekuensinya?
```

Contoh `approve`:

```text
Guard:
- current state harus UNDER_REVIEW atau ESCALATED
- actor harus APPROVER
- mandatory documents lengkap
- tidak ada outstanding clarification

Mutation:
- status menjadi APPROVED
- approvedBy diisi
- approvedAt diisi

Effect:
- audit APPROVED
- publish CaseApproved event
- send notification
- lock editable fields
```

Jika guard, mutation, dan effect bercampur dalam method besar, workflow menjadi susah dipahami.

---

### 3.4 Workflow sebagai Contract

Workflow bukan UI flow.

Workflow adalah contract lifecycle:

```text
Given current state S
When actor A invokes command C
And guard conditions G are satisfied
Then state becomes S'
And effects E are produced
And audit trail T records decision context
```

Bentuk ini sangat cocok untuk testing, review, audit, dan debugging.

---

## 4. Pattern Family

Topik ini sering bercampur. Kita pisahkan dengan jelas.

### 4.1 Status Enum

Gunakan jika:

- lifecycle sederhana,
- behavior tidak berbeda jauh antar status,
- transition rule minimal,
- tidak banyak side effect,
- tidak butuh audit decision detail.

Contoh:

```java
public enum PaymentStatus {
    PENDING,
    PAID,
    FAILED
}
```

Cukup baik jika hanya untuk display dan filtering.

---

### 4.2 Enum with Behavior

Gunakan jika behavior kecil dan stabil.

```java
public enum CaseStatus {
    DRAFT {
        @Override
        public boolean editable() {
            return true;
        }
    },
    UNDER_REVIEW {
        @Override
        public boolean editable() {
            return false;
        }
    },
    CLOSED {
        @Override
        public boolean editable() {
            return false;
        }
    };

    public abstract boolean editable();
}
```

Kelebihan:

- sederhana,
- behavior dekat dengan state,
- compile-time safe.

Kekurangan:

- enum bisa menjadi terlalu besar,
- sulit dependency injection,
- kurang fleksibel untuk rule kompleks,
- sulit membawa contextual data,
- tidak cocok jika transition/action butuh banyak service.

---

### 4.3 State Pattern

State Pattern memindahkan behavior spesifik state ke object tersendiri.

```java
interface CaseState {
    CaseStatus status();

    TransitionResult submit(CaseContext context);

    TransitionResult approve(CaseContext context);

    TransitionResult reject(CaseContext context);
}
```

Setiap state mengatur behavior yang valid untuk dirinya.

```java
final class DraftState implements CaseState {
    @Override
    public CaseStatus status() {
        return CaseStatus.DRAFT;
    }

    @Override
    public TransitionResult submit(CaseContext context) {
        if (!context.caseFile().hasMandatoryDocuments()) {
            return TransitionResult.rejected("MISSING_DOCUMENTS");
        }
        return TransitionResult.changedTo(CaseStatus.SUBMITTED);
    }

    @Override
    public TransitionResult approve(CaseContext context) {
        return TransitionResult.illegal("Draft case cannot be approved");
    }

    @Override
    public TransitionResult reject(CaseContext context) {
        return TransitionResult.illegal("Draft case cannot be rejected");
    }
}
```

Kelebihan:

- behavior dekat dengan state,
- mengurangi `if/switch`,
- illegal behavior eksplisit,
- mudah reasoning per state.

Kekurangan:

- class bisa banyak,
- action yang berlaku di banyak state bisa duplicate,
- transition graph tidak selalu terlihat di satu tempat,
- bisa overkill untuk workflow kecil.

---

### 4.4 Table-Driven State Machine

State machine direpresentasikan sebagai table/rules.

```text
FROM          ACTION       TO                    GUARD
DRAFT         SUBMIT       SUBMITTED             documentsComplete
SUBMITTED     START        SCREENING             actorIsOfficer
SCREENING     ASSIGN       UNDER_REVIEW          reviewerAvailable
UNDER_REVIEW  APPROVE      APPROVED              actorIsApprover && noOutstandingClarification
UNDER_REVIEW  REJECT       REJECTED              rejectionReasonProvided
APPROVED      CLOSE        CLOSED                none
REJECTED      CLOSE        CLOSED                none
```

Representasi Java:

```java
record TransitionRule(
        CaseStatus from,
        CaseAction action,
        CaseStatus to,
        Guard guard
) {}
```

Kelebihan:

- graph terlihat eksplisit,
- mudah test matrix,
- cocok untuk lifecycle kompleks,
- mudah generate documentation,
- cocok untuk audit dan analysis.

Kekurangan:

- behavior bisa terasa tidak OO,
- guard/action harus dirancang rapi,
- jika rule terlalu dinamis, debugging bisa sulit,
- butuh disiplin agar table tidak menjadi configuration soup.

---

### 4.5 Workflow Object

Workflow Object menggabungkan state machine dengan domain intent, actor, audit, effect, dan persistence boundary.

```java
public final class CaseWorkflow {
    private final CaseRepository repository;
    private final CaseTransitionEngine transitionEngine;
    private final AuditSink auditSink;
    private final DomainEventPublisher eventPublisher;

    public TransitionOutcome handle(TransitionCommand command) {
        CaseFile caseFile = repository.findForUpdate(command.caseId());
        TransitionOutcome outcome = transitionEngine.evaluate(caseFile, command);

        if (!outcome.accepted()) {
            auditSink.recordRejectedTransition(caseFile, command, outcome.reasons());
            return outcome;
        }

        caseFile.apply(outcome.mutation());
        repository.save(caseFile);
        auditSink.recordAcceptedTransition(caseFile, command, outcome);
        eventPublisher.publish(outcome.events());
        return outcome;
    }
}
```

Workflow Object cocok ketika lifecycle adalah bagian penting dari domain.

---

### 4.6 BPM/Workflow Engine

Gunakan external workflow engine jika:

- proses panjang,
- melibatkan human task,
- timer/deadline kompleks,
- process visibility penting,
- non-developer perlu melihat workflow,
- ada parallel gateway,
- compensation/saga kompleks,
- workflow sering berubah karena policy/regulation.

Tetapi jangan memakai BPM engine hanya karena ada status.

Anti-pattern:

```text
Menggunakan workflow engine untuk mengganti method sederhana.
```

Atau sebaliknya:

```text
Membangun BPM engine sendiri di dalam service class.
```

---

## 5. Kapan Menggunakan Pattern Ini

### 5.1 Gunakan Simple Enum Jika

- state hanya untuk display,
- jumlah status sedikit,
- transition tidak kompleks,
- tidak banyak role/guard,
- tidak ada side effect besar,
- tidak perlu audit detail.

Contoh:

```java
enum EmailDeliveryStatus {
    QUEUED,
    SENT,
    FAILED
}
```

---

### 5.2 Gunakan Enum with Behavior Jika

- behavior kecil,
- tidak butuh dependency injection,
- rule stabil,
- tidak perlu banyak context,
- state count rendah.

Contoh:

```java
public enum AccountStatus {
    ACTIVE {
        @Override boolean canLogin() { return true; }
    },
    SUSPENDED {
        @Override boolean canLogin() { return false; }
    },
    CLOSED {
        @Override boolean canLogin() { return false; }
    };

    abstract boolean canLogin();
}
```

---

### 5.3 Gunakan State Pattern Jika

- behavior sangat berbeda antar state,
- state memiliki operasi yang berbeda,
- kamu ingin menghindari conditional besar,
- perubahan state lebih sering berupa behavior internal,
- jumlah state sedang.

---

### 5.4 Gunakan Table-Driven State Machine Jika

- transition graph penting,
- banyak transition,
- guard/action harus eksplisit,
- workflow perlu didokumentasikan,
- test matrix penting,
- auditability penting.

---

### 5.5 Gunakan Workflow Object Jika

- lifecycle adalah domain utama,
- transisi melibatkan actor, role, permission, reason, audit, event, persistence,
- ada concurrency control,
- ada idempotency requirement,
- ada regulatory defensibility.

---

### 5.6 Gunakan BPM Engine Jika

- proses long-running,
- banyak human task,
- ada timer, SLA, escalation,
- ada process diagram formal,
- ada need untuk operational visibility,
- workflow bisa berubah oleh policy/process owner.

---

## 6. Core Vocabulary

### 6.1 State

Posisi lifecycle yang menentukan behavior.

```text
DRAFT, UNDER_REVIEW, APPROVED, CLOSED
```

---

### 6.2 Event

Fakta bahwa sesuatu telah terjadi.

```text
CaseSubmitted
CaseApproved
ClarificationRequested
```

---

### 6.3 Command / Action

Intent untuk melakukan sesuatu.

```text
SubmitCase
ApproveCase
RejectCase
RequestClarification
```

---

### 6.4 Transition

Perubahan dari satu state ke state lain.

```text
DRAFT --SubmitCase--> SUBMITTED
```

---

### 6.5 Guard

Kondisi yang harus benar agar transition boleh terjadi.

```text
actor is approver
mandatory documents complete
no outstanding clarification
case is not locked
```

---

### 6.6 Action

Perubahan yang dilakukan saat transition diterima.

```text
set status APPROVED
set approvedBy
set approvedAt
lock fields
```

---

### 6.7 Entry Action

Action yang terjadi saat memasuki state.

```text
When entering PENDING_CLARIFICATION:
- create clarification task
- notify applicant
- start response deadline
```

---

### 6.8 Exit Action

Action yang terjadi saat keluar dari state.

```text
When leaving PENDING_CLARIFICATION:
- close clarification task
- mark response received
```

---

### 6.9 Terminal State

State yang tidak punya normal outgoing transition.

```text
CLOSED
CANCELLED
EXPIRED
```

---

### 6.10 Transient State

State yang biasanya cepat berlalu atau otomatis.

```text
PROCESSING
SENDING_NOTIFICATION
GENERATING_DOCUMENT
```

Transient state harus hati-hati. Jika disimpan di database, harus jelas recovery behavior-nya.

---

## 7. Java 8–25 Perspective

### 7.1 Java 8: Functional Interface untuk Guard dan Action

Java 8 memungkinkan guard/action direpresentasikan sebagai function.

```java
@FunctionalInterface
interface Guard {
    GuardResult evaluate(TransitionContext context);
}

@FunctionalInterface
interface TransitionAction {
    List<DomainEvent> execute(TransitionContext context);
}
```

Ini membuat table-driven state machine lebih bersih.

---

### 7.2 Java 8: Optional Jangan Dipakai untuk State

Anti-pattern:

```java
Optional<CaseStatus> status;
```

State wajib biasanya bukan optional. Jika object bisa tidak punya status, domain concept-nya perlu eksplisit:

```java
enum CaseLifecycleState {
    NOT_CREATED,
    DRAFT,
    SUBMITTED
}
```

Atau pisahkan object yang belum punya lifecycle.

---

### 7.3 Java 14–17: Records untuk Transition Command dan Result

Records cocok untuk immutable message/result.

```java
public record TransitionCommand(
        CaseId caseId,
        CaseAction action,
        Actor actor,
        String reason,
        Instant requestedAt,
        String requestId
) {}
```

```java
public record TransitionOutcome(
        boolean accepted,
        CaseStatus from,
        CaseStatus to,
        List<DecisionReason> reasons,
        List<DomainEvent> events
) {
    public static TransitionOutcome rejected(
            CaseStatus from,
            CaseAction action,
            List<DecisionReason> reasons
    ) {
        return new TransitionOutcome(false, from, from, reasons, List.of());
    }
}
```

Records membuat transition result lebih aman karena immutable dan eksplisit.

---

### 7.4 Java 17+: Sealed Interface untuk Closed Workflow Type

Untuk domain dengan jenis transition terbatas:

```java
public sealed interface CaseCommand
        permits SubmitCase, ApproveCase, RejectCase, RequestClarification {
    CaseId caseId();
    Actor actor();
}

public record SubmitCase(CaseId caseId, Actor actor) implements CaseCommand {}

public record ApproveCase(CaseId caseId, Actor actor, String approvalNote) implements CaseCommand {}

public record RejectCase(CaseId caseId, Actor actor, String reason) implements CaseCommand {}

public record RequestClarification(CaseId caseId, Actor actor, String question) implements CaseCommand {}
```

Keuntungan:

- command family tertutup,
- compile-time exhaustiveness lebih baik,
- cocok dengan pattern matching switch.

---

### 7.5 Java 21+: Pattern Matching Switch untuk Command Dispatch

Dengan sealed hierarchy, dispatch bisa lebih jelas.

```java
public TransitionOutcome handle(CaseFile caseFile, CaseCommand command) {
    return switch (command) {
        case SubmitCase submit -> submit(caseFile, submit);
        case ApproveCase approve -> approve(caseFile, approve);
        case RejectCase reject -> reject(caseFile, reject);
        case RequestClarification clarification -> requestClarification(caseFile, clarification);
    };
}
```

Ini bukan berarti `switch` selalu buruk. `switch` buruk jika menyembunyikan rule tersebar dan membesar tanpa struktur. Pattern matching switch bisa sangat baik jika dipakai sebagai explicit closed dispatch.

---

### 7.6 Java 21+: Virtual Threads dan Workflow Orchestration

Virtual threads membuat synchronous orchestration lebih feasible untuk IO-bound workflow.

Contoh:

```java
public TransitionOutcome approve(ApproveCase command) {
    CaseFile caseFile = repository.findForUpdate(command.caseId());
    TransitionOutcome outcome = transitionEngine.evaluate(caseFile, command);

    if (outcome.accepted()) {
        repository.save(caseFile.apply(outcome.mutation()));
        auditSink.record(outcome);
        notificationGateway.notifyApproval(caseFile.id());
    }

    return outcome;
}
```

Tetapi virtual thread tidak menghapus kebutuhan desain:

- transition tetap harus idempotent,
- external call tetap butuh timeout,
- transaction boundary tetap harus benar,
- side effect tetap harus aman,
- context propagation tetap harus jelas.

---

### 7.7 Java 25: Structured Concurrency dan Scoped Values

Structured concurrency membantu mengelola subtasks sebagai satu unit kerja. Ini relevan jika workflow step perlu melakukan beberapa query/check paralel.

Contoh konsep:

```text
ApproveCase requires:
- document completeness check
- outstanding debt check
- sanction history check
- reviewer assignment check
```

Dengan structured concurrency, model mentalnya:

```text
Semua subtask milik parent workflow evaluation.
Jika salah satu gagal, cancellation/error handling bisa dikelola sebagai satu scope.
```

Scoped values dapat menggantikan sebagian penggunaan `ThreadLocal` untuk context seperti correlation id atau actor context, terutama pada virtual thread environment.

Namun jangan jadikan context implicit sebagai pengganti parameter domain penting. Actor, command, reason, dan request id tetap sebaiknya masuk model command/context secara eksplisit.

---

## 8. Pattern Anatomy

### 8.1 Context

Gunakan pattern ini saat object memiliki lifecycle dan behavior yang bergantung pada lifecycle tersebut.

Contoh domain:

- application submission,
- enforcement case,
- payment,
- document approval,
- account lifecycle,
- order fulfillment,
- ticketing,
- onboarding,
- complaint handling,
- appeal process.

---

### 8.2 Problem

Tanpa model lifecycle eksplisit, logic akan tersebar:

```text
Controller checks status.
Service checks status.
Repository query filters status.
UI checks status.
Scheduler checks status.
Batch job changes status.
Event listener changes status.
```

Akhirnya tidak ada single source of truth.

---

### 8.3 Forces

Design force utama:

| Force | Pertanyaan |
|---|---|
| Correctness | Apakah transition valid? |
| Auditability | Apakah alasan keputusan tercatat? |
| Extensibility | Bagaimana menambah state/action baru? |
| Readability | Apakah lifecycle bisa dibaca? |
| Testability | Apakah semua transition bisa dites? |
| Concurrency | Apa yang terjadi jika dua command bersamaan? |
| Idempotency | Apa yang terjadi jika command diulang? |
| Side effect safety | Apakah notification/event aman? |
| Performance | Apakah evaluation mahal? |
| Operational recovery | Apa yang terjadi jika proses mati di tengah? |

---

### 8.4 Solution

Representasikan lifecycle sebagai model eksplisit:

1. definisikan state,
2. definisikan action/command,
3. definisikan transition graph,
4. definisikan guard,
5. definisikan mutation,
6. definisikan side effect,
7. definisikan audit,
8. definisikan idempotency,
9. definisikan concurrency control,
10. definisikan testing matrix.

---

### 8.5 Consequences

Manfaat:

- lifecycle lebih jelas,
- illegal transition terdeteksi,
- audit lebih kuat,
- test lebih sistematis,
- debugging lebih mudah,
- requirement change lebih terkendali.

Biaya:

- lebih banyak model,
- butuh disiplin naming,
- bisa overengineering,
- transition engine bisa menjadi framework mini,
- developer harus paham lifecycle, bukan hanya CRUD.

---

## 9. Step-by-Step Design Process

### Step 1 — Jangan Mulai dari Class, Mulai dari Lifecycle

Tuliskan lifecycle sebagai state graph.

```text
DRAFT
  --submit--> SUBMITTED
SUBMITTED
  --start_review--> UNDER_REVIEW
UNDER_REVIEW
  --approve--> APPROVED
  --reject--> REJECTED
  --request_clarification--> PENDING_CLARIFICATION
PENDING_CLARIFICATION
  --respond--> UNDER_REVIEW
APPROVED
  --close--> CLOSED
REJECTED
  --close--> CLOSED
```

Pertanyaan:

- state mana initial?
- state mana terminal?
- apakah ada loop?
- apakah ada transition otomatis?
- apakah ada transition manual?
- apakah ada transition yang reversible?
- apakah ada state yang hanya UI label?
- apakah ada state yang sebenarnya task/subprocess?

---

### Step 2 — Pisahkan State dari Action

State adalah posisi.
Action adalah intent.

Jangan mencampur:

```java
APPROVE_PENDING // buruk jika ini sebenarnya state + action
```

Lebih baik:

```java
enum CaseStatus {
    UNDER_REVIEW,
    APPROVED
}

enum CaseAction {
    APPROVE
}
```

Kenapa penting?

Karena satu action bisa valid dari beberapa state:

```text
UNDER_REVIEW --approve--> APPROVED
ESCALATED    --approve--> APPROVED
```

Dan satu state bisa menerima banyak action:

```text
UNDER_REVIEW --approve--> APPROVED
UNDER_REVIEW --reject--> REJECTED
UNDER_REVIEW --request_clarification--> PENDING_CLARIFICATION
```

---

### Step 3 — Definisikan Transition Matrix

Contoh:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    PENDING_CLARIFICATION,
    APPROVED,
    REJECTED,
    CLOSED
}
```

```java
public enum CaseAction {
    SUBMIT,
    START_REVIEW,
    REQUEST_CLARIFICATION,
    RESPOND_CLARIFICATION,
    APPROVE,
    REJECT,
    CLOSE
}
```

Matrix konseptual:

| From | Action | To |
|---|---|---|
| DRAFT | SUBMIT | SUBMITTED |
| SUBMITTED | START_REVIEW | UNDER_REVIEW |
| UNDER_REVIEW | REQUEST_CLARIFICATION | PENDING_CLARIFICATION |
| PENDING_CLARIFICATION | RESPOND_CLARIFICATION | UNDER_REVIEW |
| UNDER_REVIEW | APPROVE | APPROVED |
| UNDER_REVIEW | REJECT | REJECTED |
| APPROVED | CLOSE | CLOSED |
| REJECTED | CLOSE | CLOSED |

---

### Step 4 — Definisikan Guard per Transition

```java
@FunctionalInterface
public interface Guard {
    GuardResult evaluate(TransitionContext context);
}
```

```java
public record GuardResult(
        boolean passed,
        String code,
        String message
) {
    public static GuardResult pass() {
        return new GuardResult(true, "PASS", "Passed");
    }

    public static GuardResult fail(String code, String message) {
        return new GuardResult(false, code, message);
    }
}
```

Contoh guard:

```java
public final class DocumentsCompleteGuard implements Guard {
    @Override
    public GuardResult evaluate(TransitionContext context) {
        if (context.caseFile().hasMandatoryDocuments()) {
            return GuardResult.pass();
        }
        return GuardResult.fail(
                "MISSING_MANDATORY_DOCUMENTS",
                "Case cannot be submitted because mandatory documents are incomplete"
        );
    }
}
```

---

### Step 5 — Definisikan Transition Rule

```java
public record TransitionRule(
        CaseStatus from,
        CaseAction action,
        CaseStatus to,
        List<Guard> guards,
        List<TransitionEffect> effects
) {}
```

Effect:

```java
@FunctionalInterface
public interface TransitionEffect {
    List<DomainEvent> apply(TransitionContext context);
}
```

---

### Step 6 — Definisikan Transition Context

Context harus memuat semua data yang dibutuhkan guard dan effect.

```java
public record TransitionContext(
        CaseFile caseFile,
        TransitionCommand command,
        Actor actor,
        Clock clock
) {}
```

Hindari guard mengambil data dari global context tersembunyi.

Buruk:

```java
SecurityContextHolder.getContext().getAuthentication();
```

Lebih baik:

```java
context.actor()
```

Framework security boleh dipakai di boundary, tetapi domain/workflow sebaiknya menerima actor secara eksplisit.

---

### Step 7 — Definisikan Transition Outcome

```java
public record TransitionOutcome(
        boolean accepted,
        CaseStatus from,
        CaseStatus to,
        CaseAction action,
        List<DecisionReason> reasons,
        List<DomainEvent> events
) {
    public static TransitionOutcome accepted(
            CaseStatus from,
            CaseStatus to,
            CaseAction action,
            List<DomainEvent> events
    ) {
        return new TransitionOutcome(true, from, to, action, List.of(), events);
    }

    public static TransitionOutcome rejected(
            CaseStatus from,
            CaseAction action,
            List<DecisionReason> reasons
    ) {
        return new TransitionOutcome(false, from, from, action, reasons, List.of());
    }
}
```

Reason object:

```java
public record DecisionReason(
        String code,
        String message
) {}
```

Outcome harus bisa menjelaskan:

- accepted atau rejected,
- state asal,
- state tujuan,
- action,
- alasan reject jika gagal,
- event yang dihasilkan jika sukses.

---

### Step 8 — Implementasikan Transition Engine

```java
public final class CaseTransitionEngine {
    private final List<TransitionRule> rules;

    public CaseTransitionEngine(List<TransitionRule> rules) {
        this.rules = List.copyOf(rules);
    }

    public TransitionOutcome evaluate(TransitionContext context) {
        CaseStatus from = context.caseFile().status();
        CaseAction action = context.command().action();

        TransitionRule rule = findRule(from, action);
        if (rule == null) {
            return TransitionOutcome.rejected(
                    from,
                    action,
                    List.of(new DecisionReason(
                            "ILLEGAL_TRANSITION",
                            "Action " + action + " is not allowed from state " + from
                    ))
            );
        }

        List<DecisionReason> failures = new ArrayList<>();
        for (Guard guard : rule.guards()) {
            GuardResult result = guard.evaluate(context);
            if (!result.passed()) {
                failures.add(new DecisionReason(result.code(), result.message()));
            }
        }

        if (!failures.isEmpty()) {
            return TransitionOutcome.rejected(from, action, failures);
        }

        List<DomainEvent> events = new ArrayList<>();
        for (TransitionEffect effect : rule.effects()) {
            events.addAll(effect.apply(context));
        }

        return TransitionOutcome.accepted(from, rule.to(), action, events);
    }

    private TransitionRule findRule(CaseStatus from, CaseAction action) {
        return rules.stream()
                .filter(rule -> rule.from() == from && rule.action() == action)
                .findFirst()
                .orElse(null);
    }
}
```

Untuk production code, jangan pakai linear search jika rules banyak. Gunakan map:

```java
record TransitionKey(CaseStatus from, CaseAction action) {}
```

```java
private final Map<TransitionKey, TransitionRule> ruleByKey;
```

---

### Step 9 — Terapkan Mutation di Domain Object

Engine mengevaluasi. Domain object menerapkan mutation.

```java
public final class CaseFile {
    private final CaseId id;
    private CaseStatus status;
    private long version;

    public void applyTransition(TransitionOutcome outcome) {
        if (!outcome.accepted()) {
            throw new IllegalArgumentException("Cannot apply rejected transition");
        }
        if (this.status != outcome.from()) {
            throw new IllegalStateException("State changed during transition evaluation");
        }
        this.status = outcome.to();
    }

    public CaseStatus status() {
        return status;
    }
}
```

Kenapa masih cek `outcome.from()`?

Karena antara evaluation dan mutation bisa terjadi bug atau race. Domain object harus menjaga invariant-nya sendiri.

---

### Step 10 — Letakkan Persistence dan Side Effect di Workflow Object

```java
public final class CaseWorkflow {
    private final CaseRepository repository;
    private final CaseTransitionEngine engine;
    private final AuditSink auditSink;
    private final Outbox outbox;
    private final Clock clock;

    public TransitionOutcome transition(TransitionCommand command) {
        CaseFile caseFile = repository.findForUpdate(command.caseId());

        TransitionContext context = new TransitionContext(
                caseFile,
                command,
                command.actor(),
                clock
        );

        TransitionOutcome outcome = engine.evaluate(context);

        if (!outcome.accepted()) {
            auditSink.recordRejected(caseFile.id(), command, outcome.reasons());
            return outcome;
        }

        caseFile.applyTransition(outcome);
        repository.save(caseFile);
        auditSink.recordAccepted(caseFile.id(), command, outcome);
        outbox.store(outcome.events());

        return outcome;
    }
}
```

Catatan penting:

- publish event langsung ke broker di dalam transaction bisa berisiko dual-write,
- untuk event integration, gunakan outbox pattern,
- audit bisa menjadi bagian transaction jika wajib konsisten dengan state mutation.

---

## 10. State Pattern Implementation

Jika behavior berbeda kuat antar state, gunakan polymorphic state.

### 10.1 Interface

```java
public interface CaseState {
    CaseStatus status();

    default TransitionOutcome submit(TransitionContext context) {
        return illegal(context, CaseAction.SUBMIT);
    }

    default TransitionOutcome approve(TransitionContext context) {
        return illegal(context, CaseAction.APPROVE);
    }

    default TransitionOutcome reject(TransitionContext context) {
        return illegal(context, CaseAction.REJECT);
    }

    private TransitionOutcome illegal(TransitionContext context, CaseAction action) {
        return TransitionOutcome.rejected(
                status(),
                action,
                List.of(new DecisionReason(
                        "ILLEGAL_TRANSITION",
                        action + " is not allowed from " + status()
                ))
        );
    }
}
```

Catatan: private method di interface tersedia di Java 9+. Jika harus support Java 8, pindahkan helper ke abstract base class atau utility.

---

### 10.2 Draft State

```java
public final class DraftCaseState implements CaseState {
    @Override
    public CaseStatus status() {
        return CaseStatus.DRAFT;
    }

    @Override
    public TransitionOutcome submit(TransitionContext context) {
        if (!context.caseFile().hasMandatoryDocuments()) {
            return TransitionOutcome.rejected(
                    status(),
                    CaseAction.SUBMIT,
                    List.of(new DecisionReason(
                            "MISSING_DOCUMENTS",
                            "Mandatory documents are incomplete"
                    ))
            );
        }

        return TransitionOutcome.accepted(
                CaseStatus.DRAFT,
                CaseStatus.SUBMITTED,
                CaseAction.SUBMIT,
                List.of(new CaseSubmitted(context.caseFile().id()))
        );
    }
}
```

---

### 10.3 Under Review State

```java
public final class UnderReviewCaseState implements CaseState {
    @Override
    public CaseStatus status() {
        return CaseStatus.UNDER_REVIEW;
    }

    @Override
    public TransitionOutcome approve(TransitionContext context) {
        if (!context.actor().hasPermission("CASE_APPROVE")) {
            return TransitionOutcome.rejected(
                    status(),
                    CaseAction.APPROVE,
                    List.of(new DecisionReason(
                            "FORBIDDEN",
                            "Actor is not allowed to approve this case"
                    ))
            );
        }

        if (context.caseFile().hasOutstandingClarification()) {
            return TransitionOutcome.rejected(
                    status(),
                    CaseAction.APPROVE,
                    List.of(new DecisionReason(
                            "OUTSTANDING_CLARIFICATION",
                            "Case has unresolved clarification request"
                    ))
            );
        }

        return TransitionOutcome.accepted(
                CaseStatus.UNDER_REVIEW,
                CaseStatus.APPROVED,
                CaseAction.APPROVE,
                List.of(new CaseApproved(context.caseFile().id(), context.actor().id()))
        );
    }
}
```

---

### 10.4 State Registry

```java
public final class CaseStateRegistry {
    private final Map<CaseStatus, CaseState> states;

    public CaseStateRegistry(List<CaseState> stateList) {
        Map<CaseStatus, CaseState> map = new EnumMap<>(CaseStatus.class);
        for (CaseState state : stateList) {
            if (map.put(state.status(), state) != null) {
                throw new IllegalArgumentException("Duplicate state: " + state.status());
            }
        }
        this.states = Map.copyOf(map);
    }

    public CaseState get(CaseStatus status) {
        CaseState state = states.get(status);
        if (state == null) {
            throw new IllegalArgumentException("Unknown state: " + status);
        }
        return state;
    }
}
```

---

### 10.5 Dispatch

```java
public TransitionOutcome evaluate(TransitionContext context) {
    CaseState state = registry.get(context.caseFile().status());
    CaseAction action = context.command().action();

    return switch (action) {
        case SUBMIT -> state.submit(context);
        case APPROVE -> state.approve(context);
        case REJECT -> state.reject(context);
        default -> TransitionOutcome.rejected(
                state.status(),
                action,
                List.of(new DecisionReason("UNSUPPORTED_ACTION", "Unsupported action"))
        );
    };
}
```

Jika support Java 8, gunakan switch statement biasa.

---

## 11. Table-Driven Implementation

Untuk lifecycle yang perlu visible sebagai graph, table-driven lebih cocok.

### 11.1 Transition Key

```java
public record TransitionKey(
        CaseStatus from,
        CaseAction action
) {}
```

Java 8 version:

```java
public final class TransitionKey {
    private final CaseStatus from;
    private final CaseAction action;

    public TransitionKey(CaseStatus from, CaseAction action) {
        this.from = Objects.requireNonNull(from);
        this.action = Objects.requireNonNull(action);
    }

    // equals, hashCode
}
```

---

### 11.2 Rule Builder

```java
public final class TransitionRuleBuilder {
    private CaseStatus from;
    private CaseAction action;
    private CaseStatus to;
    private final List<Guard> guards = new ArrayList<>();
    private final List<TransitionEffect> effects = new ArrayList<>();

    public static TransitionRuleBuilder from(CaseStatus from) {
        TransitionRuleBuilder builder = new TransitionRuleBuilder();
        builder.from = from;
        return builder;
    }

    public TransitionRuleBuilder on(CaseAction action) {
        this.action = action;
        return this;
    }

    public TransitionRuleBuilder to(CaseStatus to) {
        this.to = to;
        return this;
    }

    public TransitionRuleBuilder guard(Guard guard) {
        this.guards.add(guard);
        return this;
    }

    public TransitionRuleBuilder effect(TransitionEffect effect) {
        this.effects.add(effect);
        return this;
    }

    public TransitionRule build() {
        return new TransitionRule(from, action, to, List.copyOf(guards), List.copyOf(effects));
    }
}
```

---

### 11.3 Rule Definition

```java
List<TransitionRule> rules = List.of(
        TransitionRuleBuilder.from(CaseStatus.DRAFT)
                .on(CaseAction.SUBMIT)
                .to(CaseStatus.SUBMITTED)
                .guard(new DocumentsCompleteGuard())
                .effect(ctx -> List.of(new CaseSubmitted(ctx.caseFile().id())))
                .build(),

        TransitionRuleBuilder.from(CaseStatus.UNDER_REVIEW)
                .on(CaseAction.APPROVE)
                .to(CaseStatus.APPROVED)
                .guard(new PermissionGuard("CASE_APPROVE"))
                .guard(new NoOutstandingClarificationGuard())
                .effect(ctx -> List.of(new CaseApproved(ctx.caseFile().id(), ctx.actor().id())))
                .build(),

        TransitionRuleBuilder.from(CaseStatus.UNDER_REVIEW)
                .on(CaseAction.REJECT)
                .to(CaseStatus.REJECTED)
                .guard(new PermissionGuard("CASE_REJECT"))
                .guard(new RejectionReasonRequiredGuard())
                .effect(ctx -> List.of(new CaseRejected(ctx.caseFile().id(), ctx.command().reason())))
                .build()
);
```

---

### 11.4 Engine with Indexed Rules

```java
public final class IndexedTransitionEngine {
    private final Map<TransitionKey, TransitionRule> ruleByKey;

    public IndexedTransitionEngine(List<TransitionRule> rules) {
        EnumMap<CaseStatus, Map<CaseAction, TransitionRule>> nested = new EnumMap<>(CaseStatus.class);
        Map<TransitionKey, TransitionRule> map = new HashMap<>();

        for (TransitionRule rule : rules) {
            TransitionKey key = new TransitionKey(rule.from(), rule.action());
            TransitionRule previous = map.put(key, rule);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate transition rule: " + key);
            }
        }

        this.ruleByKey = Map.copyOf(map);
    }

    public TransitionOutcome evaluate(TransitionContext context) {
        CaseStatus from = context.caseFile().status();
        CaseAction action = context.command().action();
        TransitionRule rule = ruleByKey.get(new TransitionKey(from, action));

        if (rule == null) {
            return TransitionOutcome.rejected(
                    from,
                    action,
                    List.of(new DecisionReason(
                            "ILLEGAL_TRANSITION",
                            action + " is not allowed from " + from
                    ))
            );
        }

        List<DecisionReason> reasons = new ArrayList<>();
        for (Guard guard : rule.guards()) {
            GuardResult result = guard.evaluate(context);
            if (!result.passed()) {
                reasons.add(new DecisionReason(result.code(), result.message()));
            }
        }

        if (!reasons.isEmpty()) {
            return TransitionOutcome.rejected(from, action, reasons);
        }

        List<DomainEvent> events = new ArrayList<>();
        for (TransitionEffect effect : rule.effects()) {
            events.addAll(effect.apply(context));
        }

        return TransitionOutcome.accepted(from, rule.to(), action, events);
    }
}
```

---

## 12. Transition Invariants

Workflow design harus punya invariant. Tanpa invariant, state machine hanya table.

### 12.1 Invariant: Current State Must Match Transition From

```text
A transition from UNDER_REVIEW cannot be applied to a case currently in DRAFT.
```

Implementasi:

```java
if (caseFile.status() != outcome.from()) {
    throw new IllegalStateException("Transition source mismatch");
}
```

---

### 12.2 Invariant: Terminal State Cannot Mutate Normally

```text
CLOSED case cannot return to UNDER_REVIEW via normal transition.
```

Jika ada reopen, jadikan explicit action:

```text
CLOSED --reopen--> UNDER_REVIEW
```

Dan guard-nya harus jelas.

---

### 12.3 Invariant: Illegal Transition Must Not Mutate State

Rejected transition tidak boleh mengubah state.

```java
if (!outcome.accepted()) {
    auditRejected(...);
    return outcome;
}
```

---

### 12.4 Invariant: Every State Change Must Produce Audit

Untuk domain regulated:

```text
No state mutation without audit record.
```

Praktik:

- audit berada dalam transaction yang sama dengan state mutation,
- audit mencatat from/to/action/actor/time/reason/result,
- audit rejected transition jika relevan,
- audit bukan sekadar log string.

---

### 12.5 Invariant: Side Effect Must Not Happen Before Commit

Buruk:

```java
email.sendApproved(caseFile);
repository.save(caseFile);
```

Jika save gagal, user menerima email approval palsu.

Lebih aman:

```text
transaction:
- update case
- insert audit
- insert outbox event

async publisher:
- publish event after commit
- send notification
```

---

### 12.6 Invariant: Idempotent Command Has Stable Result

Jika request sama dikirim dua kali, hasilnya harus terkendali.

Contoh:

```text
ApproveCase(requestId=abc)
ApproveCase(requestId=abc) retry
```

Hasil retry harus:

- mengembalikan outcome yang sama, atau
- menyatakan already processed, bukan menggandakan audit/event.

---

## 13. Guard Condition Design

### 13.1 Guard Harus Pure Jika Bisa

Guard idealnya tidak mengubah state.

```java
public final class PermissionGuard implements Guard {
    private final String permission;

    public PermissionGuard(String permission) {
        this.permission = permission;
    }

    @Override
    public GuardResult evaluate(TransitionContext context) {
        if (context.actor().hasPermission(permission)) {
            return GuardResult.pass();
        }
        return GuardResult.fail("FORBIDDEN", "Missing permission: " + permission);
    }
}
```

Guard yang mengubah data membuat evaluation tidak aman.

---

### 13.2 Guard Jangan Mengirim Notification

Buruk:

```java
public GuardResult evaluate(TransitionContext context) {
    if (!valid) {
        notification.sendFailure(context.caseFile());
        return fail(...);
    }
}
```

Guard seharusnya hanya mengevaluasi. Notification adalah effect/side effect.

---

### 13.3 Guard Harus Menghasilkan Reason Code

Jangan hanya boolean.

Buruk:

```java
boolean canApprove(CaseFile caseFile);
```

Lebih baik:

```java
GuardResult evaluate(TransitionContext context);
```

Karena sistem perlu menjelaskan:

- kepada user,
- kepada API client,
- kepada audit,
- kepada support,
- kepada tester,
- kepada regulator.

---

### 13.4 Fail-Fast vs Accumulate All Failures

Fail-fast:

```text
Stop at first failed guard.
```

Kelebihan:

- cepat,
- aman jika guard mahal,
- cocok untuk security.

Accumulate:

```text
Evaluate all guards and return all reasons.
```

Kelebihan:

- user mendapat feedback lengkap,
- cocok untuk validation.

Untuk workflow regulated, bisa mix:

```text
Authorization guard fail-fast.
Business validation guard accumulate.
```

---

## 14. Entry Action dan Exit Action

### 14.1 Entry Action

Entry action terjadi saat masuk state.

Contoh masuk `PENDING_CLARIFICATION`:

```text
- create clarification task
- set due date
- notify applicant
- pause SLA clock
```

---

### 14.2 Exit Action

Exit action terjadi saat keluar state.

Contoh keluar `PENDING_CLARIFICATION`:

```text
- close clarification task
- resume SLA clock
- record applicant response timestamp
```

---

### 14.3 Hati-Hati dengan Side Effect di Entry/Exit

Jika entry action melakukan IO eksternal, perlu model recovery.

Misalnya:

```text
State changed to PENDING_CLARIFICATION.
System failed before email sent.
```

Apakah state valid? Ya. Tetapi notification belum dikirim.

Solusi:

- entry action yang memodifikasi domain/audit dilakukan dalam transaction,
- external side effect via outbox,
- background publisher retry.

---

### 14.4 Representasi Entry/Exit Action

```java
public record TransitionRule(
        CaseStatus from,
        CaseAction action,
        CaseStatus to,
        List<Guard> guards,
        List<TransitionEffect> exitEffects,
        List<TransitionEffect> transitionEffects,
        List<TransitionEffect> entryEffects
) {}
```

Tetapi jangan terlalu cepat membuat model kompleks. Jika belum butuh, cukup `effects` biasa.

---

## 15. Illegal Transition Handling

### 15.1 Illegal Transition Bukan Selalu Exception

Ada dua pilihan:

1. exception,
2. domain result.

Exception cocok jika:

- illegal transition adalah programmer error,
- API internal,
- tidak diharapkan sebagai user flow normal.

Domain result cocok jika:

- user bisa memilih action yang ternyata tidak valid,
- concurrent update bisa menyebabkan state berubah,
- API client butuh reason code,
- audit rejected transition diperlukan.

Untuk enterprise workflow, domain result sering lebih baik.

---

### 15.2 Jangan Silent No-Op

Buruk:

```java
if (!allowed) {
    return;
}
```

Masalah:

- user tidak tahu apa yang terjadi,
- audit hilang,
- retry logic bingung,
- debugging sulit.

Lebih baik:

```java
return TransitionOutcome.rejected(...);
```

---

### 15.3 Illegal Transition Harus Bisa Diobservasi

Log minimal:

```text
caseId
fromStatus
action
actorId
reasonCode
correlationId
```

Audit jika relevan:

```text
attempted transition rejected because actor lacked permission
```

---

## 16. Persistence and Concurrency

### 16.1 Optimistic Locking

Gunakan version column.

```java
class CaseEntity {
    private Long id;
    private CaseStatus status;
    private long version;
}
```

Flow:

```text
read case version 10
compute transition
update where id = ? and version = 10
if updated rows = 0 -> concurrent modification
```

Jika pakai JPA:

```java
@Version
private long version;
```

---

### 16.2 Pessimistic Locking

Untuk lifecycle kritis:

```java
CaseFile caseFile = repository.findForUpdate(caseId);
```

Gunakan ketika:

- transition tidak boleh overlap,
- command side effect mahal,
- conflict tinggi,
- audit correctness kritis.

Hati-hati:

- deadlock,
- long transaction,
- lock wait timeout,
- user-facing latency.

---

### 16.3 Compare-and-Set Transition

SQL style:

```sql
UPDATE case_file
SET status = 'APPROVED', version = version + 1
WHERE id = ?
  AND status = 'UNDER_REVIEW'
  AND version = ?
```

Ini menjaga transition atomic di DB.

Tetapi jika guard kompleks, tetap perlu evaluate sebelum update.

---

### 16.4 Race Condition Example

Dua user bersamaan:

```text
Officer A approves case.
Officer B requests clarification.
```

Tanpa locking:

```text
both read UNDER_REVIEW
A saves APPROVED
B saves PENDING_CLARIFICATION
last write wins
```

Ini fatal.

Solusi:

- optimistic lock,
- pessimistic lock,
- transition compare-and-set,
- idempotency key,
- command ordering.

---

### 16.5 Transaction Boundary

Ideal untuk state mutation:

```text
BEGIN
  read case with lock/version
  evaluate transition
  update case
  insert audit
  insert outbox event
COMMIT
```

External call tidak sebaiknya dilakukan di dalam transaction kecuali benar-benar diperlukan dan terkendali.

---

## 17. Idempotency in Workflow

### 17.1 Kenapa Idempotency Penting

Command bisa berulang karena:

- user double click,
- browser retry,
- API gateway retry,
- client timeout,
- message redelivery,
- scheduler retry,
- operator re-run.

Tanpa idempotency:

- audit duplicate,
- event duplicate,
- notification duplicate,
- transition error palsu,
- inconsistent UX.

---

### 17.2 Request ID

```java
public record TransitionCommand(
        CaseId caseId,
        CaseAction action,
        Actor actor,
        String reason,
        String requestId,
        Instant requestedAt
) {}
```

Store processed request:

```text
case_transition_request
- request_id
- case_id
- action
- outcome
- created_at
```

Jika request sama datang lagi, return stored outcome.

---

### 17.3 Natural Idempotency

Beberapa command bisa naturally idempotent.

```text
Close already closed case -> return already closed
```

Tetapi hati-hati. `approve` biasanya tidak selalu idempotent jika second request dari actor berbeda/reason berbeda.

---

### 17.4 Idempotency vs Illegal Transition

Jika request yang sama diulang:

```text
UNDER_REVIEW --approve/requestId=abc--> APPROVED
APPROVED --approve/requestId=abc--> should return original approved outcome
```

Jika request berbeda:

```text
APPROVED --approve/requestId=xyz--> illegal or already approved depending domain rule
```

Perbedaan ini penting.

---

## 18. Auditability and Regulatory Defensibility

### 18.1 Audit Record Structure

Minimal:

```java
public record TransitionAuditRecord(
        CaseId caseId,
        CaseStatus from,
        CaseStatus to,
        CaseAction action,
        ActorId actorId,
        Instant occurredAt,
        boolean accepted,
        List<DecisionReason> reasons,
        String correlationId,
        String requestId
) {}
```

---

### 18.2 Audit Accepted and Rejected Transition

Accepted:

```text
Actor A approved Case C from UNDER_REVIEW to APPROVED.
```

Rejected:

```text
Actor B attempted to approve Case C from UNDER_REVIEW but lacked CASE_APPROVE permission.
```

Rejected audit penting jika:

- security sensitive,
- compliance critical,
- user dispute possible,
- suspicious behavior monitoring diperlukan.

---

### 18.3 Audit Must Capture Reason, Not Just Status

Buruk:

```text
status changed from UNDER_REVIEW to REJECTED
```

Lebih baik:

```text
action=REJECT
from=UNDER_REVIEW
to=REJECTED
actor=officer-123
reasonCode=INSUFFICIENT_DOCUMENTATION
reasonText="Missing audited financial statement"
policyVersion=2026-01
```

---

### 18.4 Policy Version

Untuk rule yang berubah karena regulasi, simpan versi policy/rule.

```java
public record DecisionReason(
        String code,
        String message,
        String policyVersion
) {}
```

Ini penting jika nanti auditor bertanya:

```text
Kenapa case pada tanggal tersebut ditolak?
Rule versi mana yang dipakai?
```

---

## 19. Workflow Object Design

### 19.1 Responsibility

Workflow Object bertanggung jawab terhadap use case lifecycle.

Bukan:

- menyimpan semua business logic unrelated,
- menjadi god service,
- menjadi controller kedua,
- menjadi repository.

Tanggung jawabnya:

```text
load aggregate
build context
evaluate transition
apply mutation
persist state
audit decision
store events
return outcome
```

---

### 19.2 Example

```java
public final class CaseWorkflow {
    private final CaseRepository repository;
    private final IndexedTransitionEngine transitionEngine;
    private final AuditRepository auditRepository;
    private final OutboxRepository outboxRepository;
    private final IdempotencyRepository idempotencyRepository;
    private final Clock clock;

    public TransitionOutcome handle(TransitionCommand command) {
        Optional<TransitionOutcome> existing = idempotencyRepository.find(command.requestId());
        if (existing.isPresent()) {
            return existing.get();
        }

        CaseFile caseFile = repository.findForUpdate(command.caseId());
        TransitionContext context = new TransitionContext(
                caseFile,
                command,
                command.actor(),
                clock
        );

        TransitionOutcome outcome = transitionEngine.evaluate(context);

        if (outcome.accepted()) {
            caseFile.applyTransition(outcome);
            repository.save(caseFile);
            auditRepository.insertAccepted(caseFile.id(), command, outcome);
            outboxRepository.insertAll(outcome.events());
        } else {
            auditRepository.insertRejected(caseFile.id(), command, outcome);
        }

        idempotencyRepository.save(command.requestId(), outcome);
        return outcome;
    }
}
```

---

### 19.3 Be Careful with Transaction

Dalam production, method di atas harus berada dalam transaction.

Tetapi pastikan:

- idempotency check atomic,
- duplicate request tidak race,
- audit dan state mutation commit bersama,
- outbox commit bersama,
- external publish setelah commit.

---

## 20. Workflow and Authorization

### 20.1 Authorization Sebagai Guard

Authorization sering menjadi guard transisi.

```java
public final class PermissionGuard implements Guard {
    private final Permission permission;

    public PermissionGuard(Permission permission) {
        this.permission = permission;
    }

    @Override
    public GuardResult evaluate(TransitionContext context) {
        return context.actor().has(permission)
                ? GuardResult.pass()
                : GuardResult.fail("FORBIDDEN", "Missing permission " + permission);
    }
}
```

---

### 20.2 Jangan Hanya UI yang Mengatur Action Visibility

UI boleh hide button.

Backend tetap harus enforce.

```text
UI visibility is convenience.
Backend guard is authority.
```

---

### 20.3 Authorization Before Mutation

Anti-pattern:

```java
caseFile.approve();
if (!actor.canApprove()) throw forbidden;
```

Benar:

```java
if (!actor.canApprove()) reject;
caseFile.approve();
```

---

### 20.4 Authorization Must Consider State

Permission global tidak cukup.

```text
Actor has CASE_APPROVE
but case is from another department
or case is escalated above actor level
or actor is maker and cannot be checker
```

Guard harus bisa mengevaluasi context.

---

## 21. Workflow and UI

### 21.1 Available Actions Endpoint

Daripada UI hardcode action berdasarkan status, backend bisa expose available actions.

```http
GET /cases/{id}/available-actions
```

Response:

```json
{
  "caseId": "C-123",
  "status": "UNDER_REVIEW",
  "actions": [
    {
      "action": "APPROVE",
      "enabled": true
    },
    {
      "action": "REJECT",
      "enabled": true
    },
    {
      "action": "REQUEST_CLARIFICATION",
      "enabled": false,
      "reasons": ["Outstanding clarification already exists"]
    }
  ]
}
```

Ini membuat UI konsisten dengan backend rule.

---

### 21.2 Preview vs Execute

Untuk workflow kompleks, kadang butuh preview.

```http
POST /cases/{id}/transitions/preview
POST /cases/{id}/transitions/execute
```

Preview:

- evaluate guard,
- tidak mutate,
- tidak publish event,
- tidak audit sebagai accepted mutation.

Execute:

- evaluate ulang,
- mutate,
- audit,
- outbox.

Jangan percaya hasil preview saat execute karena state bisa berubah.

---

### 21.3 UI Should Not Own Workflow

Buruk:

```javascript
if (status === 'UNDER_REVIEW' && role === 'APPROVER') {
  showApproveButton();
}
```

Ini boleh sebagai optimization, tetapi bukan source of truth.

Lebih baik:

```text
UI asks backend available actions.
Backend owns lifecycle rule.
```

---

## 22. Workflow and Events

### 22.1 Domain Event Setelah Transition

Jika transition accepted:

```java
new CaseApproved(caseId, actorId, occurredAt)
```

Event harus merepresentasikan fakta yang sudah terjadi, bukan request.

Buruk:

```text
ApproveCaseEvent
```

Lebih baik:

```text
CaseApproved
```

---

### 22.2 Event Tidak Boleh Menjadi Source of Hidden Transition

Anti-pattern:

```text
Approve handler updates status.
Listener A sends notification.
Listener B also updates status to CLOSED.
Listener C creates another task.
```

Jika listener mengubah lifecycle tanpa model eksplisit, workflow tersebar.

---

### 22.3 State Mutation First, Event Publication Safely

Gunakan outbox:

```text
case_file updated
transition_audit inserted
outbox_event inserted
commit
publisher sends event
```

---

### 22.4 Event Replay

Jika event bisa replay, listener harus idempotent.

Workflow sendiri juga harus tahan duplicate event jika event menjadi command input.

---

## 23. Workflow and Time

### 23.1 Deadline Guard

```java
public final class BeforeDeadlineGuard implements Guard {
    @Override
    public GuardResult evaluate(TransitionContext context) {
        Instant now = context.clock().instant();
        Instant deadline = context.caseFile().deadline();

        if (now.isBefore(deadline) || now.equals(deadline)) {
            return GuardResult.pass();
        }
        return GuardResult.fail("DEADLINE_PASSED", "Deadline has passed");
    }
}
```

Gunakan `Clock`, jangan `Instant.now()` langsung agar testable.

---

### 23.2 Scheduled Transition

Contoh:

```text
PENDING_CLARIFICATION --timeout--> EXPIRED
```

Scheduler harus mengirim command:

```text
ExpireClarification(caseId, requestId)
```

Bukan update status langsung.

---

### 23.3 Time Zone

Workflow rule biasanya pakai:

- `Instant` untuk timestamp sistem,
- `LocalDate` untuk policy date,
- `ZonedDateTime` jika rule terkait zona tertentu.

Jangan mencampur display timezone dengan decision timezone.

---

## 24. Workflow Versioning

### 24.1 Problem

Rule berubah:

```text
Before 2026-01-01:
approval requires 1 reviewer.
After 2026-01-01:
approval requires 2 reviewers.
```

Case lama bagaimana?

Pilihan:

1. existing case tetap memakai rule lama,
2. existing case mengikuti rule baru,
3. tergantung state,
4. tergantung submission date,
5. tergantung transition date.

Harus eksplisit.

---

### 24.2 Store Workflow Version

```java
class CaseFile {
    private WorkflowVersion workflowVersion;
}
```

Transition context membawa versi:

```java
public record TransitionContext(
        CaseFile caseFile,
        TransitionCommand command,
        Actor actor,
        Clock clock,
        WorkflowVersion workflowVersion
) {}
```

---

### 24.3 Versioned Rule Set

```java
public final class VersionedTransitionEngine {
    private final Map<WorkflowVersion, IndexedTransitionEngine> engines;

    public TransitionOutcome evaluate(TransitionContext context) {
        IndexedTransitionEngine engine = engines.get(context.workflowVersion());
        if (engine == null) {
            throw new IllegalArgumentException("Unknown workflow version");
        }
        return engine.evaluate(context);
    }
}
```

---

## 25. Anti-Pattern Catalog

### 25.1 Boolean State Explosion

Buruk:

```java
boolean submitted;
boolean approved;
boolean rejected;
boolean closed;
boolean escalated;
boolean clarificationRequested;
```

Masalah:

```text
submitted=true, approved=true, rejected=true
```

Apa artinya?

Gunakan explicit state:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Boolean boleh untuk property independen, bukan lifecycle utama.

---

### 25.2 Status Without Transition Model

Ada enum status, tetapi tidak ada transition rule.

```java
caseFile.setStatus(CaseStatus.APPROVED);
```

Jika setter public, semua orang bisa bypass workflow.

Lebih baik:

```java
caseWorkflow.handle(new ApproveCase(...));
```

Domain object:

```java
private CaseStatus status;

private void setStatus(CaseStatus status) {
    this.status = status;
}
```

---

### 25.3 Workflow Hidden in Service Method

Service method besar:

```java
if (status == DRAFT) { ... }
else if (status == SUBMITTED) { ... }
else if (status == UNDER_REVIEW) { ... }
```

Masalah:

- transition graph tersembunyi,
- guard tersebar,
- sulit test matrix,
- sulit audit.

---

### 25.4 Mutable State Leak

Buruk:

```java
caseFile.setStatus(APPROVED);
```

Dari controller/test/listener/batch job.

Solusi:

- status setter private/package-private,
- mutation lewat method domain/workflow,
- repository tidak expose arbitrary update status,
- DB constraint jika perlu.

---

### 25.5 Enum God Object

Enum berisi semua rule, permission, email template, query, repository call.

```java
enum CaseStatus {
    UNDER_REVIEW {
        void approve(...) {
            repository.save(...);
            email.send(...);
            audit.log(...);
        }
    }
}
```

Masalah:

- enum menjadi service locator,
- sulit test,
- sulit dependency injection,
- sulit versioning,
- sulit modularity.

---

### 25.6 Transition by String

Buruk:

```java
transition(caseId, "approve");
```

Masalah:

- typo runtime,
- tidak refactor-safe,
- sulit discoverability.

Lebih baik:

```java
transition(caseId, CaseAction.APPROVE);
```

Atau command type:

```java
new ApproveCase(...)
```

---

### 25.7 UI-Owned Workflow

UI menentukan status berikutnya.

```json
{
  "newStatus": "APPROVED"
}
```

Lebih baik UI mengirim intent:

```json
{
  "action": "APPROVE",
  "reason": "Documents verified"
}
```

Backend menentukan next state.

---

### 25.8 Event-Owned Workflow

Lifecycle berubah lewat banyak listener tanpa pusat kontrol.

```text
CaseSubmitted listener changes to UNDER_REVIEW.
DocumentUploaded listener changes to READY.
Timer listener changes to EXPIRED.
Payment listener changes to APPROVED.
```

Jika tidak ada state machine pusat, workflow menjadi emergent behavior yang sulit dipahami.

---

### 25.9 Terminal State with Backdoor Update

`CLOSED` katanya final, tetapi batch job bisa update ke `UNDER_REVIEW`.

Jika reopen memang valid, jadikan explicit transition:

```text
CLOSED --reopen_by_admin--> UNDER_REVIEW
```

Dengan audit dan reason wajib.

---

### 25.10 Workflow Engine Abuse

Memakai BPM engine untuk CRUD sederhana.

Akibat:

- complexity tinggi,
- debugging sulit,
- deployment kompleks,
- developer kehilangan domain clarity.

Gunakan engine jika problem-nya memang process orchestration.

---

### 25.11 Homegrown BPM Accident

Service biasa tumbuh menjadi workflow engine tidak resmi:

- dynamic transition table di DB,
- expression language custom,
- role rule custom,
- scheduler custom,
- retry custom,
- visualizer custom,
- audit custom.

Jika sudah sampai sini, evaluasi apakah seharusnya memakai workflow/BPM engine formal.

---

## 26. Refactoring Path

### 26.1 Starting Point

```java
public void changeStatus(Long id, String newStatus) {
    CaseEntity c = repo.findById(id);
    // huge if/switch
    c.setStatus(newStatus);
    repo.save(c);
}
```

---

### 26.2 Step 1 — Replace String with Enum

```java
enum CaseStatus { DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, CLOSED }
```

```java
enum CaseAction { SUBMIT, START_REVIEW, APPROVE, REJECT, CLOSE }
```

---

### 26.3 Step 2 — Change API from New Status to Action

Before:

```http
POST /cases/{id}/status
{ "status": "APPROVED" }
```

After:

```http
POST /cases/{id}/transitions
{ "action": "APPROVE", "reason": "Verified" }
```

Backend decides target state.

---

### 26.4 Step 3 — Extract Transition Matrix

```java
boolean allowed(CaseStatus from, CaseAction action) { ... }
```

Kemudian ubah menjadi rule table.

---

### 26.5 Step 4 — Extract Guards

From:

```java
if (!actor.canApprove()) ...
if (!caseFile.hasDocuments()) ...
```

To:

```java
new PermissionGuard(CASE_APPROVE)
new DocumentsCompleteGuard()
```

---

### 26.6 Step 5 — Introduce TransitionOutcome

Jangan langsung throw/return void.

```java
TransitionOutcome outcome = engine.evaluate(context);
```

---

### 26.7 Step 6 — Restrict State Mutation

Hapus public setter.

```java
caseFile.applyTransition(outcome);
```

---

### 26.8 Step 7 — Add Audit and Outbox

State mutation tanpa audit/event sangat berisiko untuk lifecycle penting.

---

### 26.9 Step 8 — Add Idempotency and Locking

Tambahkan:

- optimistic lock,
- request id,
- duplicate detection,
- stored outcome.

---

### 26.10 Step 9 — Add Transition Matrix Tests

Pastikan semua legal/illegal transition tested.

---

## 27. Testing Strategy

### 27.1 Transition Matrix Test

```java
@Test
void draftCanSubmit() {
    CaseFile caseFile = draftCaseWithDocuments();
    TransitionCommand command = submitCommand();

    TransitionOutcome outcome = engine.evaluate(context(caseFile, command));

    assertTrue(outcome.accepted());
    assertEquals(CaseStatus.DRAFT, outcome.from());
    assertEquals(CaseStatus.SUBMITTED, outcome.to());
}
```

---

### 27.2 Illegal Transition Test

```java
@Test
void draftCannotApprove() {
    CaseFile caseFile = draftCaseWithDocuments();
    TransitionCommand command = approveCommand();

    TransitionOutcome outcome = engine.evaluate(context(caseFile, command));

    assertFalse(outcome.accepted());
    assertEquals(CaseStatus.DRAFT, outcome.from());
    assertEquals(CaseStatus.DRAFT, outcome.to());
    assertReason(outcome, "ILLEGAL_TRANSITION");
}
```

---

### 27.3 Guard Failure Test

```java
@Test
void cannotSubmitWithoutMandatoryDocuments() {
    CaseFile caseFile = draftCaseWithoutDocuments();

    TransitionOutcome outcome = engine.evaluate(context(caseFile, submitCommand()));

    assertFalse(outcome.accepted());
    assertReason(outcome, "MISSING_MANDATORY_DOCUMENTS");
}
```

---

### 27.4 Apply Mutation Test

```java
@Test
void acceptedTransitionChangesState() {
    CaseFile caseFile = draftCaseWithDocuments();
    TransitionOutcome outcome = accepted(DRAFT, SUBMITTED, SUBMIT);

    caseFile.applyTransition(outcome);

    assertEquals(CaseStatus.SUBMITTED, caseFile.status());
}
```

---

### 27.5 Rejected Transition Must Not Mutate

```java
@Test
void rejectedTransitionCannotBeApplied() {
    CaseFile caseFile = draftCaseWithDocuments();
    TransitionOutcome rejected = rejected(DRAFT, APPROVE);

    assertThrows(IllegalArgumentException.class, () -> caseFile.applyTransition(rejected));
    assertEquals(CaseStatus.DRAFT, caseFile.status());
}
```

---

### 27.6 Concurrency Test

Test optimistic lock at repository/integration level.

Scenario:

```text
Thread A approves.
Thread B rejects.
Only one should succeed.
```

Expected:

- one commit success,
- one optimistic lock failure or rejected due to updated state,
- audit consistent.

---

### 27.7 Idempotency Test

```java
@Test
void repeatedSameRequestReturnsSameOutcome() {
    TransitionCommand command = approveCommandWithRequestId("req-1");

    TransitionOutcome first = workflow.handle(command);
    TransitionOutcome second = workflow.handle(command);

    assertEquals(first, second);
    assertSingleAuditRecord("req-1");
    assertSingleOutboxEvent("req-1");
}
```

---

### 27.8 Golden Matrix Test

Untuk workflow besar, simpan matrix expected transition.

```text
from,action,expected
DRAFT,SUBMIT,SUBMITTED
DRAFT,APPROVE,ILLEGAL
UNDER_REVIEW,APPROVE,APPROVED
UNDER_REVIEW,REJECT,REJECTED
CLOSED,APPROVE,ILLEGAL
```

Test membaca matrix dan memastikan engine sesuai.

---

## 28. Observability and Debugging

### 28.1 Structured Log for Transition

```json
{
  "event": "case.transition.evaluated",
  "caseId": "C-123",
  "from": "UNDER_REVIEW",
  "action": "APPROVE",
  "to": "APPROVED",
  "accepted": true,
  "actorId": "U-456",
  "requestId": "REQ-789",
  "correlationId": "CORR-001"
}
```

Rejected:

```json
{
  "event": "case.transition.rejected",
  "caseId": "C-123",
  "from": "UNDER_REVIEW",
  "action": "APPROVE",
  "accepted": false,
  "reasons": ["OUTSTANDING_CLARIFICATION"],
  "actorId": "U-456",
  "requestId": "REQ-789"
}
```

---

### 28.2 Metrics

Useful metrics:

```text
case_transition_total{action,from,to,result}
case_transition_rejected_total{action,from,reason}
case_transition_duration_seconds{action}
case_transition_conflict_total{action}
outbox_event_created_total{eventType}
```

---

### 28.3 Alerting

Alert examples:

- illegal transition spike,
- optimistic lock conflict spike,
- transition duration high,
- outbox backlog high,
- rejected due to permission spike,
- terminal state reopened unexpectedly.

---

### 28.4 Debugging Questions

Saat bug lifecycle terjadi, tanya:

1. Command apa yang diterima?
2. State awal apa?
3. Actor siapa?
4. Guard mana yang lolos/gagal?
5. Rule versi mana?
6. Outcome accepted/rejected?
7. State mutation commit atau rollback?
8. Audit tercatat?
9. Event/outbox tercatat?
10. Ada retry/duplicate request?
11. Ada concurrent transition?

---

## 29. Security Considerations

### 29.1 State Transition is Security Boundary

Jika seseorang bisa mengubah status, ia bisa mengubah realitas domain.

```text
APPROVED is not a label.
APPROVED is authority.
```

Jadi transition harus dilindungi.

---

### 29.2 Maker-Checker Rule

Regulated systems sering butuh maker-checker.

Guard:

```java
public final class MakerCheckerGuard implements Guard {
    @Override
    public GuardResult evaluate(TransitionContext context) {
        ActorId maker = context.caseFile().createdBy();
        ActorId checker = context.actor().id();

        if (!maker.equals(checker)) {
            return GuardResult.pass();
        }
        return GuardResult.fail("MAKER_CANNOT_CHECK", "Creator cannot approve own case");
    }
}
```

---

### 29.3 Trust Nothing from Client

Client boleh mengirim:

```json
{ "action": "APPROVE" }
```

Client tidak boleh dipercaya untuk:

```json
{ "from": "UNDER_REVIEW", "to": "APPROVED", "actorRole": "APPROVER" }
```

Server menentukan from, to, actor permission, guard, dan audit.

---

## 30. Performance Considerations

### 30.1 Rule Lookup

Untuk small workflow, linear scan acceptable.

Untuk high-throughput:

```java
Map<TransitionKey, TransitionRule>
```

---

### 30.2 Guard Cost

Guard bisa mahal jika query DB/external API.

Strategi:

- group guard murah dulu,
- fail-fast untuk authorization,
- cache reference data,
- avoid external API in transaction,
- precompute eligibility if needed,
- expose preview carefully.

---

### 30.3 Avoid Over-Abstraction

Jika hanya tiga state dan satu transisi, jangan membuat mini-framework.

Pattern bagus menurunkan kompleksitas. Jika menaikkan kompleksitas tanpa alasan, itu anti-pattern.

---

## 31. Design Review Checklist

Gunakan checklist ini saat review workflow/state design.

### 31.1 Lifecycle Clarity

- Apakah semua state terdaftar?
- Apakah initial state jelas?
- Apakah terminal state jelas?
- Apakah transition graph eksplisit?
- Apakah action berbeda dari status?
- Apakah target state ditentukan backend?

### 31.2 Correctness

- Apakah illegal transition ditolak?
- Apakah guard condition eksplisit?
- Apakah guard menghasilkan reason code?
- Apakah rejected transition tidak mutate state?
- Apakah terminal state dilindungi?

### 31.3 Concurrency

- Apakah transition atomic?
- Apakah ada optimistic/pessimistic lock?
- Apakah ada protection dari last-write-wins?
- Apakah duplicate request aman?

### 31.4 Auditability

- Apakah state change selalu audit?
- Apakah rejected transition perlu audit?
- Apakah audit mencatat actor/action/from/to/reason/time?
- Apakah rule/policy version tercatat?

### 31.5 Side Effect

- Apakah notification/event tidak terjadi sebelum commit?
- Apakah outbox dipakai untuk integration event?
- Apakah listener idempotent?
- Apakah retry aman?

### 31.6 Maintainability

- Apakah rule mudah dibaca?
- Apakah menambah state/action mudah?
- Apakah test matrix lengkap?
- Apakah workflow tidak tersebar di UI/listener/batch?

### 31.7 Security

- Apakah backend enforce action permission?
- Apakah maker-checker rule ada jika perlu?
- Apakah client tidak bisa mengirim arbitrary target status?
- Apakah sensitive rejected attempt tercatat?

---

## 32. Staff-Level Discussion

### 32.1 Pertanyaan: Apakah Semua Status Harus Jadi State Pattern?

Tidak.

Jika status hanya label, enum cukup.

State Pattern dibutuhkan ketika status menentukan behavior. State Machine dibutuhkan ketika transition graph dan guard penting. Workflow Object dibutuhkan ketika transition punya actor, audit, persistence, side effect, idempotency, dan concurrency.

Top engineer tidak memaksakan pattern. Top engineer memilih representasi paling sederhana yang masih menjaga invariant.

---

### 32.2 Pertanyaan: Switch Status Selalu Buruk?

Tidak.

Switch buruk jika:

- tersebar di banyak tempat,
- setiap switch punya logic berbeda,
- tidak ada single transition model,
- sulit test.

Switch bisa baik jika:

- hierarchy tertutup,
- dispatch eksplisit,
- logic kecil,
- ada exhaustive checking,
- digunakan di boundary yang jelas.

Modern Java pattern matching switch membuat beberapa kasus lebih baik daripada polymorphism berlebihan.

---

### 32.3 Pertanyaan: State Machine di Code atau DB?

Default: di code.

Karena:

- compile-time safety,
- refactoring safety,
- testability,
- code review,
- version control.

DB/config cocok jika:

- workflow benar-benar berubah runtime,
- non-developer perlu configure,
- ada governance kuat,
- expression language aman,
- testing/deployment rule config matang.

Dynamic workflow config tanpa governance adalah jalan menuju chaos.

---

### 32.4 Pertanyaan: Kapan Perlu BPM Engine?

Jika problem-nya process orchestration, bukan sekadar state transition.

Gunakan BPM jika ada:

- long-running process,
- human task assignment,
- timers/SLA/escalation,
- visual process monitoring,
- parallel gateway,
- compensation,
- frequent process change,
- business owner perlu melihat diagram.

Jangan pakai BPM engine hanya untuk mengganti `status` enum.

---

### 32.5 Pertanyaan: Apakah Workflow Object Sama dengan Service Layer?

Tidak persis.

Service layer bisa umum. Workflow Object spesifik mengelola lifecycle transition.

```text
CaseApplicationService
- create case
- update applicant details
- upload document
- search case

CaseWorkflow
- submit
- approve
- reject
- close
- reopen
```

Jika semua dimasukkan ke satu service, mudah menjadi god service.

---

## 33. Case Study: Enforcement Lifecycle

### 33.1 Initial Bad Design

```java
public void updateCaseStatus(Long id, String status, String reason) {
    EnforcementCase c = repository.find(id);

    if (status.equals("ESCALATED")) {
        if (!security.hasRole("SENIOR_OFFICER")) {
            throw new ForbiddenException();
        }
        c.setEscalated(true);
        c.setEscalationReason(reason);
        email.sendEscalation(c);
    }

    if (status.equals("CLOSED")) {
        if (!c.isApproved() && !c.isRejected()) {
            throw new ValidationException();
        }
    }

    c.setStatus(status);
    audit.log("status changed");
    repository.save(c);
}
```

Problems:

- status as string,
- boolean state mixed with enum state,
- side effect before save,
- authorization buried,
- audit weak,
- no idempotency,
- no concurrency control.

---

### 33.2 Target Lifecycle

```text
OPEN
  --assign--> UNDER_INVESTIGATION
UNDER_INVESTIGATION
  --request_info--> PENDING_INFORMATION
  --escalate--> ESCALATED
  --recommend_close--> CLOSURE_RECOMMENDED
PENDING_INFORMATION
  --receive_info--> UNDER_INVESTIGATION
  --timeout--> ESCALATED
ESCALATED
  --approve_enforcement--> ENFORCEMENT_APPROVED
  --reject_enforcement--> CLOSURE_RECOMMENDED
CLOSURE_RECOMMENDED
  --close--> CLOSED
ENFORCEMENT_APPROVED
  --serve_notice--> NOTICE_SERVED
NOTICE_SERVED
  --close--> CLOSED
```

---

### 33.3 Transition Rule Example

```java
TransitionRule escalate = TransitionRuleBuilder
        .from(CaseStatus.UNDER_INVESTIGATION)
        .on(CaseAction.ESCALATE)
        .to(CaseStatus.ESCALATED)
        .guard(new PermissionGuard(Permission.CASE_ESCALATE))
        .guard(new EscalationReasonRequiredGuard())
        .effect(ctx -> List.of(new CaseEscalated(
                ctx.caseFile().id(),
                ctx.actor().id(),
                ctx.command().reason(),
                ctx.clock().instant()
        )))
        .build();
```

---

### 33.4 Outcome

Benefits:

- transition legalitas eksplisit,
- guard reusable,
- audit kuat,
- event aman via outbox,
- UI bisa query available actions,
- test matrix jelas,
- concurrency bisa dikontrol,
- regulatory explanation lebih defensible.

---

## 34. Common Mistakes and Better Alternatives

| Mistake | Better Alternative |
|---|---|
| UI sends target status | UI sends action/command |
| Public `setStatus` | Workflow-controlled transition |
| String status/action | Enum or sealed command |
| Boolean lifecycle flags | Explicit state |
| Guard returns boolean only | Guard returns reason code |
| Notification before save | Outbox after state mutation |
| No audit for rejected transition | Audit important rejected attempts |
| State rule in many services | Central transition engine/workflow object |
| Ignore duplicate request | Idempotency key |
| Last-write-wins update | Optimistic/pessimistic locking |
| Workflow config in DB without tests | Versioned rules with test matrix |

---

## 35. Practical Heuristics

Gunakan heuristik berikut:

```text
If status only displays information, use enum.
If status changes small behavior, use enum with behavior.
If each state has significantly different behavior, use State Pattern.
If transition graph matters, use State Machine.
If transition involves actor/audit/event/persistence, use Workflow Object.
If process is long-running with human task/timer/escalation, consider BPM/workflow engine.
```

Heuristik lain:

```text
Never let client choose target state for important lifecycle.
Never expose public status setter for regulated transition.
Never mutate state without audit in compliance-sensitive domain.
Never publish external side effect before commit.
Never rely on UI to enforce lifecycle rule.
Never treat retry as impossible.
Never ignore concurrent transition.
```

---

## 36. Mini Reference Implementation

Berikut versi kecil yang merangkum konsep utama.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

```java
public enum CaseAction {
    SUBMIT,
    START_REVIEW,
    APPROVE,
    REJECT,
    CLOSE
}
```

```java
public record TransitionCommand(
        CaseId caseId,
        CaseAction action,
        Actor actor,
        String reason,
        String requestId,
        Instant requestedAt
) {}
```

```java
public record TransitionContext(
        CaseFile caseFile,
        TransitionCommand command,
        Actor actor,
        Clock clock
) {}
```

```java
public record DecisionReason(String code, String message) {}
```

```java
public record GuardResult(boolean passed, String code, String message) {
    public static GuardResult pass() {
        return new GuardResult(true, "PASS", "Passed");
    }

    public static GuardResult fail(String code, String message) {
        return new GuardResult(false, code, message);
    }
}
```

```java
@FunctionalInterface
public interface Guard {
    GuardResult evaluate(TransitionContext context);
}
```

```java
@FunctionalInterface
public interface TransitionEffect {
    List<DomainEvent> apply(TransitionContext context);
}
```

```java
public record TransitionRule(
        CaseStatus from,
        CaseAction action,
        CaseStatus to,
        List<Guard> guards,
        List<TransitionEffect> effects
) {}
```

```java
public record TransitionOutcome(
        boolean accepted,
        CaseStatus from,
        CaseStatus to,
        CaseAction action,
        List<DecisionReason> reasons,
        List<DomainEvent> events
) {
    public static TransitionOutcome accepted(
            CaseStatus from,
            CaseStatus to,
            CaseAction action,
            List<DomainEvent> events
    ) {
        return new TransitionOutcome(true, from, to, action, List.of(), List.copyOf(events));
    }

    public static TransitionOutcome rejected(
            CaseStatus from,
            CaseAction action,
            List<DecisionReason> reasons
    ) {
        return new TransitionOutcome(false, from, from, action, List.copyOf(reasons), List.of());
    }
}
```

```java
public record TransitionKey(CaseStatus from, CaseAction action) {}
```

```java
public final class TransitionEngine {
    private final Map<TransitionKey, TransitionRule> rules;

    public TransitionEngine(List<TransitionRule> rules) {
        Map<TransitionKey, TransitionRule> map = new HashMap<>();
        for (TransitionRule rule : rules) {
            TransitionKey key = new TransitionKey(rule.from(), rule.action());
            if (map.put(key, rule) != null) {
                throw new IllegalArgumentException("Duplicate transition rule: " + key);
            }
        }
        this.rules = Map.copyOf(map);
    }

    public TransitionOutcome evaluate(TransitionContext context) {
        CaseStatus from = context.caseFile().status();
        CaseAction action = context.command().action();
        TransitionRule rule = rules.get(new TransitionKey(from, action));

        if (rule == null) {
            return TransitionOutcome.rejected(
                    from,
                    action,
                    List.of(new DecisionReason(
                            "ILLEGAL_TRANSITION",
                            action + " is not allowed from " + from
                    ))
            );
        }

        List<DecisionReason> failures = new ArrayList<>();
        for (Guard guard : rule.guards()) {
            GuardResult result = guard.evaluate(context);
            if (!result.passed()) {
                failures.add(new DecisionReason(result.code(), result.message()));
            }
        }

        if (!failures.isEmpty()) {
            return TransitionOutcome.rejected(from, action, failures);
        }

        List<DomainEvent> events = new ArrayList<>();
        for (TransitionEffect effect : rule.effects()) {
            events.addAll(effect.apply(context));
        }

        return TransitionOutcome.accepted(from, rule.to(), action, events);
    }
}
```

```java
public final class CaseFile {
    private final CaseId id;
    private CaseStatus status;

    public CaseFile(CaseId id, CaseStatus status) {
        this.id = Objects.requireNonNull(id);
        this.status = Objects.requireNonNull(status);
    }

    public CaseId id() {
        return id;
    }

    public CaseStatus status() {
        return status;
    }

    public void applyTransition(TransitionOutcome outcome) {
        if (!outcome.accepted()) {
            throw new IllegalArgumentException("Cannot apply rejected transition");
        }
        if (status != outcome.from()) {
            throw new IllegalStateException("Transition source mismatch");
        }
        this.status = outcome.to();
    }
}
```

---

## 37. Summary

State, State Machine, dan Workflow Object adalah pattern penting untuk sistem yang memiliki lifecycle bermakna.

Inti pemahamannya:

```text
Status is not enough.
Lifecycle needs rules.
Rules need guards.
Guards need reasons.
Transitions need audit.
Side effects need safety.
Concurrency needs control.
Retry needs idempotency.
```

Pattern ini membantu mengubah workflow dari logic tersembunyi menjadi model eksplisit yang bisa:

- dibaca,
- diuji,
- diaudit,
- di-debug,
- dikembangkan,
- dipertanggungjawabkan.

Tetapi pattern ini juga bisa menjadi overengineering jika dipakai pada lifecycle sederhana.

Keputusan senior bukan “pakai State Pattern atau tidak”, tetapi:

```text
Seberapa eksplisit lifecycle ini harus dimodelkan agar invariant, auditability, dan perubahan requirement tetap aman?
```

Jika lifecycle adalah pusat domain, seperti case management, approval, enforcement, payment, atau compliance workflow, maka state machine/workflow object bukan sekadar pattern. Ia adalah struktur kebenaran sistem.

---

## 38. What Comes Next

Bagian berikutnya:

```text
15-behavioral-visitor-double-dispatch-pattern-matching-alternative.md
```

Topik berikutnya akan membahas **Visitor, Double Dispatch, dan Pattern Matching Alternative**: bagaimana menangani operasi pada struktur object yang memiliki banyak subtype, kapan Visitor masih relevan, kapan pattern matching switch lebih bersih, dan bagaimana Java modern mengubah trade-off klasik antara extensibility of types vs extensibility of operations.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./13-behavioral-template-method-hook-callback-extension-point.md">⬅️ Behavioral Pattern V: Template Method, Hook, Callback, Extension Point</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./15-behavioral-visitor-double-dispatch-pattern-matching-alternative.md">Part 15 — Behavioral Pattern VI: Visitor, Double Dispatch, Pattern Matching Alternative ➡️</a>
</div>
