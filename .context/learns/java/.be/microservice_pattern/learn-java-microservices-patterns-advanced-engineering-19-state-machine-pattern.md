# learn-java-microservices-patterns-advanced-engineering — Part 19
# State Machine Pattern for Microservices

> Seri: `learn-java-microservices-patterns-advanced-engineering`  
> Part: `19 / 35`  
> File: `learn-java-microservices-patterns-advanced-engineering-19-state-machine-pattern.md`  
> Scope Java: Java 8 sampai Java 25  
> Level: Advanced / principal-engineer mental model

---

## 0. Status Seri

Kita sudah berada di **Part 19 dari 35**.

Seri **belum selesai**. Setelah part ini, materi berikutnya adalah:

```text
Part 20 — Service-to-Service Security Patterns
File    — learn-java-microservices-patterns-advanced-engineering-20-service-to-service-security-patterns.md
```

---

## 1. Tujuan Part Ini

Part ini membahas **State Machine Pattern for Microservices**.

Ini bukan sekadar membahas enum `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`.

Dalam sistem enterprise, terutama sistem regulatory, compliance, case management, workflow approval, dispute, appeal, enforcement, investigation, renewal, payment, onboarding, claim, document review, atau remediation, masalah utama sering bukan hanya “data apa yang disimpan”, tetapi:

1. sebuah object sedang berada dalam kondisi apa;
2. event/command apa yang boleh terjadi sekarang;
3. siapa yang boleh melakukan transisi;
4. invariant apa yang harus dijaga;
5. side effect apa yang boleh keluar;
6. apakah transisi idempotent;
7. bagaimana jika transisi terjadi bersamaan;
8. bagaimana jika downstream service gagal;
9. bagaimana transisi diaudit;
10. bagaimana rule berubah setelah sistem sudah berjalan lama;
11. bagaimana instance lama tetap valid ketika state machine versi baru dirilis.

State machine adalah pattern untuk membuat perilaku lifecycle menjadi **explicit, testable, auditable, versionable, and concurrency-safe**.

Martin Fowler mendeskripsikan state machine sebagai cara memodelkan sistem sebagai sekumpulan state eksplisit dengan transisi antar-state; sistem dapat merespons stimulus secara berbeda tergantung state internalnya. Referensi ini penting karena state machine bukan pattern framework, melainkan pattern modeling behavior.  
Reference: https://martinfowler.com/dslCatalog/stateMachine.html

---

## 2. Kenapa State Machine Penting di Microservices

Microservices membuat lifecycle lebih sulit karena state tidak lagi hidup di satu proses besar.

Dalam monolith, lifecycle sering tersembunyi di:

```text
if status == "SUBMITTED" and user.role == "OFFICER" then ...
else if status == "APPROVED" and payment.done == true then ...
else if status == "REJECTED" and appealPeriodStillOpen then ...
```

Awalnya terlihat sederhana. Setelah beberapa tahun, sistem berubah menjadi kumpulan conditional logic yang tersebar di controller, service, repository, scheduler, listener, batch job, trigger, UI flag, report query, dan integration handler.

Di microservices, ini lebih berbahaya karena logic tersebar di banyak service.

Contoh:

```text
Application Service      menyimpan status application
Payment Service          tahu apakah fee sudah dibayar
Document Service         tahu apakah document lengkap
Screening Service        tahu hasil screening
Notification Service     mengirim email
Case Service             membuka case jika ada irregularity
Audit Service            menyimpan trail
Reporting Service        membangun projection
```

Tanpa state machine yang eksplisit, beberapa masalah muncul:

1. Service A menganggap entity masih `SUBMITTED`, Service B sudah melihat `UNDER_REVIEW`.
2. Event datang terlambat dan mengubah state mundur.
3. User mengklik submit dua kali dan menghasilkan side effect dua kali.
4. Scheduler menutup case yang sebenarnya sedang appeal.
5. Developer baru menambah status baru tanpa memahami transisi lama.
6. API `updateStatus(String status)` memungkinkan transisi ilegal.
7. Audit trail hanya mencatat “status changed”, bukan alasan transisi.
8. Incident sulit dianalisis karena tidak ada transition history yang jelas.

State machine mengubah lifecycle dari implicit branching menjadi explicit model.

---

## 3. Core Mental Model

State machine adalah model perilaku yang menjawab:

```text
Given current state S
When event/command E occurs
If guard condition G is satisfied
Then transition to state S'
And execute action/side effect A
And record decision D
```

Bentuk dasarnya:

```text
[current state] --event/command + guard/action--> [next state]
```

Contoh:

```text
DRAFT --SubmitApplication(applicant)--> SUBMITTED
SUBMITTED --AssignOfficer(supervisor)--> UNDER_REVIEW
UNDER_REVIEW --Approve(officer)--> APPROVED
UNDER_REVIEW --Reject(officer)--> REJECTED
REJECTED --FileAppeal(applicant, withinDeadline)--> UNDER_APPEAL
UNDER_APPEAL --AppealAllowed(appealOfficer)--> APPROVED
UNDER_APPEAL --AppealDismissed(appealOfficer)--> FINAL_REJECTED
```

Mental model penting:

```text
State machine bukan diagram status.
State machine adalah policy execution model.
```

Artinya, state machine harus menjawab:

1. transisi mana yang legal;
2. condition apa yang harus benar;
3. siapa aktornya;
4. data apa yang dibutuhkan;
5. apa konsekuensi bisnisnya;
6. apa side effect-nya;
7. bagaimana jika transisi gagal di tengah;
8. bagaimana transisi dibuktikan di audit.

---

## 4. State vs Status

Ini perbedaan yang sering diremehkan.

### 4.1 Status

`status` sering hanya field data.

```java
private String status;
```

Atau:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Status menjawab:

```text
Sekarang label object ini apa?
```

### 4.2 State

State adalah kondisi perilaku.

State menjawab:

```text
Dengan kondisi sekarang, perilaku apa yang legal dan ilegal?
```

Contoh:

```text
Status: UNDER_REVIEW

State behavior:
- officer boleh request clarification
- officer boleh approve
- officer boleh reject
- applicant tidak boleh edit field utama
- scheduler boleh escalate kalau SLA lewat
- document service boleh menerima additional document
- payment service tidak boleh refund
```

Jadi, `status` hanyalah representasi sederhana dari state. State yang sebenarnya mencakup:

1. status label;
2. version;
3. actor permission;
4. allowed command;
5. guard condition;
6. SLA/deadline;
7. pending external dependency;
8. lock/reservation;
9. transition history;
10. invariant.

### 4.3 Kesalahan Umum

Kesalahan umum adalah membuat state machine hanya sebagai enum.

```java
public enum Status {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Lalu transisinya dibuat bebas:

```java
application.setStatus(newStatus);
```

Ini bukan state machine. Ini hanya status mutation.

State machine yang benar tidak bertanya:

```text
Status baru apa yang ingin kamu set?
```

Tetapi bertanya:

```text
Command/event apa yang terjadi, oleh siapa, dalam konteks apa, dan apakah transisi itu legal?
```

---

## 5. State Machine Vocabulary

## 5.1 State

State adalah kondisi lifecycle yang relevan secara bisnis.

Contoh:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
CLARIFICATION_REQUIRED
APPROVED
REJECTED
UNDER_APPEAL
FINAL_REJECTED
CANCELLED
EXPIRED
```

State harus punya makna behavior, bukan hanya tampilan UI.

State yang buruk:

```text
SCREEN_1_DONE
SCREEN_2_DONE
BUTTON_DISABLED
PENDING_PAGE_REFRESH
```

Itu UI state, bukan domain state.

---

## 5.2 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

```text
ApplicationSubmitted
OfficerAssigned
ReviewApproved
ReviewRejected
ClarificationRequested
ClarificationSubmitted
AppealFiled
AppealDismissed
```

Event biasanya berbentuk past tense.

---

## 5.3 Command

Command adalah permintaan untuk melakukan sesuatu.

```text
SubmitApplication
AssignOfficer
ApproveApplication
RejectApplication
RequestClarification
FileAppeal
CancelApplication
ExpireApplication
```

Command bisa gagal. Event tidak boleh “gagal” karena event menyatakan fakta yang sudah terjadi.

---

## 5.4 Transition

Transition adalah perpindahan dari state asal ke state tujuan.

```text
SUBMITTED --AssignOfficer--> UNDER_REVIEW
```

Transition harus explicit.

---

## 5.5 Guard

Guard adalah predicate yang harus benar agar transisi legal.

Contoh:

```text
Can SubmitApplication only if:
- current state is DRAFT
- mandatory fields complete
- applicant identity verified
- required documents uploaded
- declaration accepted
```

Guard tidak boleh hanya UI validation. Guard harus berada di domain/application service yang authoritative.

---

## 5.6 Action

Action adalah operasi internal yang terjadi sebagai bagian dari transisi.

Contoh:

```text
- set submittedAt
- assign application number
- freeze submitted snapshot
- compute SLA due date
- write transition history
```

Action biasanya terjadi dalam local transaction.

---

## 5.7 Side Effect

Side effect adalah efek keluar dari aggregate/service boundary.

Contoh:

```text
- publish ApplicationSubmitted event
- send notification
- request screening
- create payment instruction
- create audit record
```

Side effect harus diperlakukan hati-hati. Jangan lakukan remote call langsung di tengah transaction kalau correctness bergantung pada hasilnya.

Gunakan outbox jika perlu reliable publishing.

---

## 5.8 Terminal State

Terminal state adalah state akhir yang tidak memiliki transisi normal keluar.

Contoh:

```text
APPROVED
FINAL_REJECTED
CANCELLED
EXPIRED
CLOSED
```

Namun hati-hati: dalam sistem nyata, terminal state bisa “dibuka kembali” oleh authority tertentu.

Contoh:

```text
CLOSED --ReopenBySupervisor--> REOPENED
```

Kalau ada reopen, berarti state tersebut bukan benar-benar terminal. Ia adalah terminal untuk normal flow, bukan untuk exceptional flow.

---

## 5.9 Composite State

Composite state adalah state besar yang memiliki substate.

Contoh:

```text
UNDER_REVIEW
  - DOCUMENT_REVIEW
  - COMPLIANCE_REVIEW
  - MANAGER_REVIEW
```

Composite state berguna ketika lifecycle mulai kompleks.

---

## 5.10 Parallel State

Parallel state berarti beberapa sub-lifecycle berjalan bersamaan.

Contoh application review:

```text
Application overall state: UNDER_REVIEW

Parallel tracks:
- Document check: PENDING / PASSED / FAILED
- Payment check: PENDING / PAID / FAILED
- Screening check: PENDING / CLEARED / HIT_FOUND
```

Kesalahan umum adalah memaksa semua parallel dimension menjadi satu enum besar:

```text
UNDER_DOCUMENT_REVIEW_PAYMENT_PENDING_SCREENING_PENDING
UNDER_DOCUMENT_REVIEW_PAYMENT_PAID_SCREENING_PENDING
UNDER_MANAGER_REVIEW_PAYMENT_PAID_SCREENING_CLEARED
...
```

Ini menyebabkan state explosion.

---

## 6. State Machine vs Workflow vs Saga

Ketiganya berhubungan, tetapi tidak sama.

| Konsep | Fokus | Scope | Contoh |
|---|---|---|---|
| State machine | Lifecycle satu entity/aggregate/process | Biasanya satu domain/service | Application lifecycle |
| Workflow | Urutan kerja end-to-end | Bisa lintas human/service/time | Application review process |
| Saga | Konsistensi transaction lintas service | Lintas service | Reserve slot → charge fee → issue approval |

State machine bisa menjadi bagian dari workflow.

Workflow bisa memakai banyak state machine.

Saga bisa direpresentasikan sebagai state machine.

Contoh:

```text
Application State Machine
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED

Payment State Machine
UNPAID -> PAYMENT_PENDING -> PAID -> REFUNDED

Screening State Machine
NOT_REQUESTED -> REQUESTED -> CLEARED / HIT_FOUND

Workflow / Process Manager
Coordinates Application + Payment + Screening + Notification
```

Rule penting:

```text
Jangan memaksa satu state machine memodelkan seluruh dunia.
```

Kalau satu enum mencoba mencakup application, payment, document, screening, notification, appeal, dan audit, desainnya kemungkinan salah.

---

## 7. Kenapa `updateStatus()` adalah Anti-Pattern

API seperti ini berbahaya:

```java
public void updateStatus(UUID applicationId, String newStatus) {
    Application app = repository.findById(applicationId);
    app.setStatus(newStatus);
    repository.save(app);
}
```

Masalah:

1. Tidak ada command semantics.
2. Tidak tahu siapa aktornya.
3. Tidak tahu kenapa status berubah.
4. Tidak ada guard.
5. Tidak ada transition invariant.
6. Tidak ada idempotency.
7. Tidak ada audit meaning.
8. Tidak bisa mencegah illegal transition.
9. Tidak bisa membedakan correction vs normal transition.
10. Tidak bisa diuji sebagai lifecycle.

Yang lebih benar:

```java
public TransitionResult submitApplication(SubmitApplicationCommand command)
public TransitionResult approveApplication(ApproveApplicationCommand command)
public TransitionResult rejectApplication(RejectApplicationCommand command)
public TransitionResult requestClarification(RequestClarificationCommand command)
```

Atau command handler generic tetapi command type tetap explicit:

```java
public TransitionResult handle(ApplicationCommand command)
```

Di Java 17+, command bisa dimodelkan lebih aman dengan sealed interface.

```java
public sealed interface ApplicationCommand
        permits SubmitApplication, ApproveApplication, RejectApplication, RequestClarification {
}

public record SubmitApplication(UUID applicationId, UUID actorId, String idempotencyKey)
        implements ApplicationCommand {
}

public record ApproveApplication(UUID applicationId, UUID actorId, String reason, String idempotencyKey)
        implements ApplicationCommand {
}
```

OpenJDK JEP 409 memperkenalkan sealed classes/interfaces untuk membatasi class/interface mana yang boleh extend/implement suatu type, sehingga cocok untuk memodelkan closed set seperti command/event/state hierarchy.  
Reference: https://openjdk.org/jeps/409

---

## 8. State Machine sebagai Correctness Boundary

State machine harus menjadi tempat utama untuk menjaga correctness lifecycle.

Contoh invariant:

```text
Application cannot be approved unless:
- current state is UNDER_REVIEW
- officer has approval authority
- mandatory checks passed
- no active blocking compliance hit
- required payment is paid or exempted
- officer is not the applicant
- approval reason is recorded
```

Kalau invariant tersebar di UI, controller, database trigger, scheduler, listener, dan report query, maka tidak ada satu tempat yang bisa dipercaya.

State machine harus menjadi authority untuk:

1. allowed transition;
2. transition validation;
3. transition side effects;
4. transition audit;
5. transition idempotency;
6. transition concurrency control.

---

## 9. State Machine Anatomy for Microservices

State machine production-grade minimal memiliki komponen berikut:

```text
State
Event/Command
Transition
Guard
Action
Side effect plan
Audit record
Version
Idempotency key
Concurrency token
Actor context
Time context
Policy context
```

Contoh model konseptual:

```text
ApplicationAggregate
- applicationId
- state
- version
- submittedAt
- reviewedAt
- assignedOfficerId
- slaDueAt
- currentPolicyVersion
- transitionHistory

TransitionRequest
- commandId / idempotencyKey
- commandType
- actorId
- actorRole
- tenantId
- requestedAt
- payload

TransitionDecision
- accepted / rejected / idempotentReplay
- fromState
- toState
- reason
- guardResults
- domainEvents
- auditFacts
```

---

## 10. Modeling State in Java 8–25

## 10.1 Java 8 Baseline

Java 8 pilihan paling umum:

```java
public enum ApplicationState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLARIFICATION_REQUIRED,
    APPROVED,
    REJECTED,
    UNDER_APPEAL,
    FINAL_REJECTED,
    CANCELLED,
    EXPIRED
}
```

Transition table bisa memakai `EnumMap`.

```java
public final class TransitionKey {
    private final ApplicationState from;
    private final CommandType commandType;

    // constructor, equals, hashCode
}
```

Java 8 bisa production-grade, tetapi butuh disiplin manual karena belum ada record/sealed/pattern matching.

---

## 10.2 Java 11

Java 11 tidak mengubah modeling state machine secara dramatis, tetapi menjadi baseline modern enterprise untuk:

1. better runtime;
2. HTTP Client standard;
3. long-term support migration;
4. container awareness dibanding Java 8 yang lebih awal.

---

## 10.3 Java 17

Java 17 membawa keuntungan besar untuk domain modeling:

1. records untuk immutable command/event/result;
2. sealed classes/interfaces untuk closed hierarchy;
3. pattern matching awal untuk `instanceof`;
4. switch expression sudah tersedia dari Java 14.

Contoh:

```java
public sealed interface TransitionCommand permits Submit, Approve, Reject {
    UUID applicationId();
    UUID actorId();
    String idempotencyKey();
}

public record Submit(UUID applicationId, UUID actorId, String idempotencyKey)
        implements TransitionCommand {
}

public record Approve(UUID applicationId, UUID actorId, String idempotencyKey, String reason)
        implements TransitionCommand {
}

public record Reject(UUID applicationId, UUID actorId, String idempotencyKey, String reason)
        implements TransitionCommand {
}
```

---

## 10.4 Java 21

Java 21 memperkuat modeling dengan pattern matching for switch.

OpenJDK JEP 441 menjelaskan pattern matching untuk `switch` sehingga expression dapat diuji terhadap sejumlah pattern dengan action spesifik, membuat query data-oriented lebih ringkas dan aman.  
Reference: https://openjdk.org/jeps/441

Contoh:

```java
public TransitionDecision decide(Application app, TransitionCommand command) {
    return switch (command) {
        case Submit submit -> decideSubmit(app, submit);
        case Approve approve -> decideApprove(app, approve);
        case Reject reject -> decideReject(app, reject);
    };
}
```

Dengan sealed hierarchy, compiler membantu memastikan semua command type ditangani.

Java 21 juga membawa virtual threads. Untuk state machine, virtual threads berguna untuk service layer yang blocking I/O, tetapi tidak menghilangkan kebutuhan:

1. transaction boundary yang jelas;
2. locking/optimistic concurrency;
3. idempotency;
4. bounded external calls;
5. outbox.

---

## 10.5 Java 25

Java 25 adalah release modern setelah Java 21. Untuk state machine pattern, prinsipnya sama: gunakan language/runtime modern jika membantu correctness dan maintainability, bukan sekadar karena baru.

Java 25 positioning:

1. cocok untuk greenfield/modern runtime setelah organisasi siap;
2. tetap harus mempertimbangkan ecosystem support;
3. state machine logic tetap harus portable secara konsep ke Java 8/11/17;
4. jangan membuat core domain terlalu bergantung pada framework magic.

OpenJDK mencatat JDK 25 sebagai reference implementation Java SE 25.  
Reference: https://openjdk.org/projects/jdk/25/

---

## 11. Three Implementation Styles

Ada tiga gaya implementasi utama.

---

## 11.1 Code-First State Machine

Semua transition logic ditulis dalam code.

Contoh:

```java
public final class ApplicationStateMachine {

    public TransitionDecision decide(Application app, ApplicationCommand command) {
        if (command instanceof SubmitApplication) {
            return submit(app, (SubmitApplication) command);
        }
        if (command instanceof ApproveApplication) {
            return approve(app, (ApproveApplication) command);
        }
        throw new UnsupportedCommandException(command.getClass().getName());
    }

    private TransitionDecision submit(Application app, SubmitApplication command) {
        if (app.state() != ApplicationState.DRAFT) {
            return TransitionDecision.rejected("Only DRAFT application can be submitted");
        }
        if (!app.hasMandatoryDocuments()) {
            return TransitionDecision.rejected("Mandatory documents are incomplete");
        }
        return TransitionDecision.accepted(
                ApplicationState.DRAFT,
                ApplicationState.SUBMITTED,
                List.of(new ApplicationSubmitted(app.id(), command.actorId()))
        );
    }
}
```

Kelebihan:

1. sangat explicit;
2. mudah unit test;
3. type-safe;
4. cocok untuk complex guard/action;
5. mudah refactor.

Kekurangan:

1. transition map tidak selalu mudah divisualisasikan;
2. non-developer sulit membaca;
3. jika tidak disiplin bisa berubah menjadi if-else besar.

Cocok untuk:

```text
High correctness, rich domain, complex guard, Java-heavy team.
```

---

## 11.2 Table-Driven State Machine

Transition didefinisikan sebagai data/table.

```text
FROM_STATE       COMMAND               TO_STATE                 GUARD
DRAFT            SUBMIT                SUBMITTED                mandatoryComplete
SUBMITTED        ASSIGN_OFFICER        UNDER_REVIEW             supervisorOnly
UNDER_REVIEW     REQUEST_CLARIFICATION CLARIFICATION_REQUIRED   officerOnly
UNDER_REVIEW     APPROVE               APPROVED                 allChecksPassed
UNDER_REVIEW     REJECT                REJECTED                 reasonRequired
```

Implementasi Java:

```java
public final class TransitionDefinition {
    private final ApplicationState from;
    private final CommandType commandType;
    private final ApplicationState to;
    private final Guard guard;
    private final Action action;
}
```

Kelebihan:

1. mudah divisualisasikan;
2. mudah diekspor ke documentation;
3. cocok untuk lifecycle besar;
4. bisa divalidasi secara sistematis.

Kekurangan:

1. guard/action tetap perlu code;
2. terlalu dinamis bisa kehilangan type safety;
3. perubahan table di runtime bisa berbahaya kalau governance lemah.

Cocok untuk:

```text
Lifecycle banyak state/transisi, perlu documentation/review/audit kuat.
```

---

## 11.3 Framework-Backed State Machine

Menggunakan framework seperti Spring Statemachine.

Spring Statemachine mendeskripsikan dirinya sebagai framework untuk memakai konsep state machine tradisional dalam aplikasi Spring.  
Reference: https://docs.spring.io/spring-statemachine/docs/current/reference/

Kelebihan:

1. konsep state/action/guard sudah tersedia;
2. mendukung hierarchical/orthogonal state;
3. punya integration dengan Spring ecosystem;
4. cocok jika workflow state machine sangat kompleks.

Kekurangan:

1. lifecycle domain bisa tersembunyi di framework configuration;
2. debugging bisa lebih sulit;
3. tim harus paham framework;
4. bisa overkill untuk lifecycle sederhana;
5. risk vendor/framework coupling.

Rule of thumb:

```text
Gunakan framework jika complexity state machine memang membutuhkan engine behavior.
Jangan gunakan framework hanya karena ingin terlihat enterprise.
```

---

## 12. Transition as First-Class Object

Dalam sistem advanced, transition bukan sekadar `status = APPROVED`.

Transition sebaiknya menjadi first-class object.

```java
public final class StateTransition {
    private final UUID transitionId;
    private final UUID aggregateId;
    private final ApplicationState fromState;
    private final ApplicationState toState;
    private final String commandType;
    private final UUID actorId;
    private final String actorType;
    private final Instant occurredAt;
    private final String reasonCode;
    private final String reasonText;
    private final String policyVersion;
    private final String idempotencyKey;
    private final long aggregateVersionBefore;
    private final long aggregateVersionAfter;
}
```

Manfaat:

1. audit lebih kuat;
2. debugging lebih mudah;
3. replay/reconstruction lebih mungkin;
4. compliance lebih defensible;
5. analytics lifecycle bisa dibuat;
6. SLA measurement lebih akurat;
7. incident timeline jelas.

---

## 13. Transition Decision Model

State machine sebaiknya menghasilkan decision, bukan langsung melakukan semua side effect.

```java
public final class TransitionDecision {
    private final boolean accepted;
    private final ApplicationState fromState;
    private final ApplicationState toState;
    private final List<GuardResult> guardResults;
    private final List<DomainEvent> events;
    private final List<AuditFact> auditFacts;
    private final String rejectionCode;
    private final String rejectionMessage;
}
```

Kenapa?

Karena ini memisahkan:

```text
Decision logic
from
Persistence + publishing + external side effect
```

Pattern ini memudahkan testing.

Unit test cukup memverifikasi:

```text
Given state UNDER_REVIEW
When ApproveApplication by authorized officer with all checks passed
Then decision accepted
And next state APPROVED
And event ApplicationApproved produced
And audit fact contains approval reason
```

---

## 14. Side Effect Discipline

Side effect adalah sumber bug distributed systems.

Buruk:

```java
@Transactional
public void approve(UUID id) {
    Application app = repository.findById(id);
    app.approve();
    emailClient.sendApprovalEmail(app.email());
    screeningClient.closeScreening(app.id());
    repository.save(app);
}
```

Masalah:

1. email bisa terkirim tetapi DB rollback;
2. DB commit bisa sukses tetapi email gagal;
3. remote call lambat menahan transaction;
4. retry bisa mengirim email berkali-kali;
5. external system bisa melihat state yang belum commit.

Lebih baik:

```text
Local transaction:
- validate transition
- update state
- insert transition history
- insert outbox events

After commit:
- message relay publishes event
- notification service sends email idempotently
- screening service handles event idempotently
```

State machine menghasilkan `ApplicationApproved` event, bukan langsung mengirim semua side effect.

---

## 15. Concurrency in State Machine

State machine di microservices harus menghadapi concurrent command.

Contoh race:

```text
T1: officer A approves application
T2: officer B requests clarification at same time
```

Tanpa concurrency control:

```text
APPROVED and CLARIFICATION_REQUIRED side effects can both happen.
```

Gunakan optimistic locking:

```sql
UPDATE application
SET state = ?, version = version + 1
WHERE id = ? AND version = ?
```

Jika affected row = 0:

```text
Somebody changed the state first. Reload and re-evaluate command.
```

Dalam Java/JPA:

```java
@Version
private long version;
```

Tapi `@Version` saja tidak cukup. Command handler tetap harus:

1. membaca current state;
2. memutuskan transition;
3. menulis dengan version check;
4. menangani optimistic lock failure;
5. menjaga idempotency.

---

## 16. Idempotency in State Transition

State transition harus idempotent terhadap retry.

Contoh:

```text
Client sends ApproveApplication with idempotencyKey = K1.
Server commits APPROVED but response lost.
Client retries K1.
```

Response kedua harus mengembalikan hasil yang sama, bukan error “already approved” secara mentah.

Model idempotency:

```text
idempotency_key
aggregate_id
command_type
request_hash
result_state
transition_id
status: IN_PROGRESS / COMPLETED / FAILED_RETRYABLE / FAILED_FINAL
created_at
expires_at
```

Pseudo-flow:

```text
1. Insert idempotency record K1.
2. If duplicate K1 exists:
   - same request hash and completed -> return stored result
   - same request hash and in progress -> return conflict/retry-later
   - different hash -> reject misuse
3. Evaluate transition.
4. Persist state + transition history + outbox + idempotency result atomically.
```

---

## 17. Illegal Transition Handling

Illegal transition bukan selalu technical error.

Contoh:

```text
ApproveApplication from DRAFT
```

Ini business rejection.

Response API bisa:

```json
{
  "code": "ILLEGAL_TRANSITION",
  "message": "Application cannot be approved from DRAFT state.",
  "currentState": "DRAFT",
  "allowedCommands": ["SubmitApplication", "CancelApplication"]
}
```

Namun hati-hati dengan `allowedCommands` jika informasi itu sensitif atau tergantung authorization.

Untuk internal service, error contract bisa lebih detail.

Untuk public API, mungkin lebih minim.

---

## 18. Actor-Aware State Machine

State machine tidak cukup hanya current state + command.

Harus ada actor context.

```java
public final class ActorContext {
    private final UUID actorId;
    private final ActorType actorType; // APPLICANT, OFFICER, SUPERVISOR, SYSTEM
    private final Set<String> permissions;
    private final String tenantId;
    private final String organizationId;
}
```

Contoh:

```text
DRAFT --SubmitApplication--> SUBMITTED
Allowed actor: applicant owner or authorized agent

UNDER_REVIEW --ApproveApplication--> APPROVED
Allowed actor: officer with approval permission, not applicant, assigned or supervisor

APPROVED --RevokeApproval--> REVOKED
Allowed actor: supervisor/system authority only, with reason
```

Authorization tetap dibahas lebih dalam di Part 20, tetapi penting untuk state machine: authorization bukan hanya endpoint-level.

Endpoint-level authorization:

```text
User has ROLE_OFFICER.
```

Domain transition authorization:

```text
This officer may approve this specific application in this specific state under this policy.
```

---

## 19. Time-Aware State Machine

Banyak lifecycle tergantung waktu.

Contoh:

```text
SUBMITTED --AutoExpireAfter30Days--> EXPIRED
REJECTED --FileAppealWithin14Days--> UNDER_APPEAL
CLARIFICATION_REQUIRED --TimeoutAfter7Days--> WITHDRAWN
UNDER_REVIEW --SlaBreached--> ESCALATED
```

Waktu harus dimodelkan explicit.

Jangan hanya:

```java
if (LocalDate.now().isAfter(deadline)) { ... }
```

Lebih baik:

```java
public interface ClockProvider {
    Instant now();
}
```

Atau gunakan `java.time.Clock`.

```java
public final class ApplicationStateMachine {
    private final Clock clock;
}
```

Manfaat:

1. test deterministik;
2. replay lebih jelas;
3. audit waktu lebih defensible;
4. time zone handling lebih aman;
5. expiry scheduler tidak ambigu.

---

## 20. Policy-Versioned State Machine

Dalam sistem regulatory, rule berubah.

Contoh:

```text
Before 2026-01-01:
- appeal window = 14 days

After 2026-01-01:
- appeal window = 21 days
```

Pertanyaan penting:

```text
Application yang submitted sebelum 2026-01-01 pakai rule lama atau baru?
```

State machine harus bisa policy-versioned.

```text
Application
- state
- policyVersionAtSubmission
- policyVersionAtDecision
```

Guard harus menerima policy context.

```java
public interface TransitionPolicy {
    GuardResult canFileAppeal(Application app, ActorContext actor, Instant now);
}
```

Policy versioning options:

| Option | Meaning | Risk |
|---|---|---|
| Always latest | Semua instance pakai rule terbaru | Bisa melanggar expectation/hukum lama |
| Snapshot at creation | Instance pakai rule saat dibuat | Rule bug sulit diperbaiki |
| Snapshot at submission | Rule dikunci saat submit | Cocok untuk application lifecycle |
| Effective-date policy | Rule dipilih berdasarkan event date | Lebih kompleks tapi defensible |
| Manual migration | Instance lama dimigrasi | Butuh audit kuat |

Top-tier engineer tidak hanya bertanya “statusnya apa”, tetapi “rule version apa yang mengatur status ini”.

---

## 21. State Machine Versioning

Selain policy berubah, structure state machine juga berubah.

Contoh versi lama:

```text
DRAFT -> SUBMITTED -> APPROVED
```

Versi baru:

```text
DRAFT -> SUBMITTED -> SCREENING_REQUIRED -> UNDER_REVIEW -> APPROVED
```

Masalah:

1. instance lama sudah berada di `SUBMITTED`;
2. event lama masih replay;
3. report lama pakai status lama;
4. consumer lama belum paham state baru;
5. UI lama belum support state baru.

Strategi:

### 21.1 Additive State Introduction

Tambahkan state baru tanpa memaksa semua instance lama migrasi langsung.

```text
New applications use SCREENING_REQUIRED.
Old applications continue from SUBMITTED.
```

### 21.2 State Migration

Migrasi state lama ke state baru.

```sql
UPDATE application
SET state = 'SCREENING_REQUIRED'
WHERE state = 'SUBMITTED'
AND submitted_at >= DATE '2026-01-01';
```

Butuh audit/migration record.

### 21.3 Compatibility Mapping

Untuk consumer lama:

```text
SCREENING_REQUIRED maps to SUBMITTED-like category
```

### 21.4 Versioned Transition Engine

Simpan state machine version per instance.

```text
application.state_machine_version = 3
```

Handler memilih engine versi tepat.

---

## 22. Hierarchical State

State machine datar bisa menjadi besar.

Contoh:

```text
UNDER_REVIEW_DOCUMENT_PENDING
UNDER_REVIEW_DOCUMENT_PASSED
UNDER_REVIEW_COMPLIANCE_PENDING
UNDER_REVIEW_MANAGER_PENDING
UNDER_REVIEW_CLARIFICATION_REQUIRED
```

Lebih baik:

```text
Parent state: UNDER_REVIEW
Substate:
  - DOCUMENT_REVIEW
  - COMPLIANCE_REVIEW
  - MANAGER_REVIEW
  - CLARIFICATION_WAIT
```

Parent behavior:

```text
All UNDER_REVIEW substates allow CancelByApplicant? no
All UNDER_REVIEW substates allow EscalateBySupervisor? yes
```

Hierarchical state mengurangi duplikasi transition rule.

---

## 23. Parallel State and State Explosion

State explosion terjadi saat banyak dimension digabung ke satu enum.

Contoh dimension:

```text
Application lifecycle: DRAFT/SUBMITTED/UNDER_REVIEW/APPROVED
Payment lifecycle: UNPAID/PENDING/PAID/FAILED
Document lifecycle: INCOMPLETE/COMPLETE/VERIFIED/REJECTED
Screening lifecycle: NOT_REQUESTED/REQUESTED/CLEARED/HIT
```

Kalau digabung, kombinasi bisa ratusan.

Solusi:

```text
Use multiple coordinated state machines.
```

Contoh:

```java
public final class ApplicationLifecycle {
    private ApplicationState applicationState;
    private PaymentState paymentState;
    private DocumentState documentState;
    private ScreeningState screeningState;
}
```

Tapi jangan asal pecah. Tentukan invariant antar-dimension.

Contoh:

```text
Application can move to APPROVED only if:
- paymentState == PAID or EXEMPTED
- documentState == VERIFIED
- screeningState == CLEARED
```

Ini guard lintas sub-state.

---

## 24. State Machine and Event Sourcing

State machine dapat bekerja dengan event sourcing, tetapi tidak wajib.

Dalam event sourcing:

```text
Current state = result of replaying events
```

Contoh events:

```text
ApplicationDraftCreated
ApplicationSubmitted
OfficerAssigned
ClarificationRequested
ClarificationSubmitted
ApplicationApproved
```

State machine memvalidasi command berdasarkan state hasil replay.

Flow:

```text
1. Load event stream.
2. Rehydrate aggregate state.
3. Evaluate command against current state.
4. Produce new event(s).
5. Append event(s) with expected stream version.
```

Kelebihan:

1. audit natural;
2. history lengkap;
3. replay projection;
4. temporal debugging.

Kekurangan:

1. schema evolution kompleks;
2. replay harus deterministic;
3. external side effects tidak boleh replay sembarangan;
4. snapshot mungkin dibutuhkan;
5. tim perlu disiplin tinggi.

Untuk sistem regulatory, event sourcing menarik karena audit kuat, tetapi tidak selalu perlu. Banyak sistem cukup dengan:

```text
current_state table + transition_history table + outbox events
```

---

## 25. Audit-Ready State Machine

Audit state transition harus menjawab:

```text
Who did what, when, from what state, to what state, under what authority, using what rule version, based on what evidence, and with what result?
```

Minimal transition audit fields:

```text
transition_id
entity_id
entity_type
from_state
to_state
command_type
actor_id
actor_type
actor_roles/authority
tenant_id
reason_code
reason_text
policy_version
request_id
correlation_id
causation_id
occurred_at
recorded_at
entity_version_before
entity_version_after
guard_summary
side_effect_events
```

Audit jangan hanya:

```text
status changed from A to B
```

Itu tidak cukup untuk incident/regulatory defensibility.

---

## 26. State Machine Observability

State machine observability harus mencakup:

### 26.1 Metrics

```text
transition_attempt_total{command,from_state,result}
transition_success_total{command,from_state,to_state}
transition_rejected_total{command,from_state,reason}
illegal_transition_total{command,from_state}
optimistic_lock_failure_total{command}
idempotent_replay_total{command}
state_residence_seconds{state}
sla_breach_total{state,case_type}
terminal_state_total{state}
```

### 26.2 Logs

Log structured:

```json
{
  "event": "state_transition_decision",
  "entityType": "Application",
  "entityId": "...",
  "command": "ApproveApplication",
  "fromState": "UNDER_REVIEW",
  "toState": "APPROVED",
  "actorId": "...",
  "result": "ACCEPTED",
  "correlationId": "..."
}
```

### 26.3 Traces

Trace span:

```text
ApplicationStateMachine.decide
ApplicationRepository.saveWithVersion
OutboxRepository.insert
TransitionHistoryRepository.insert
```

### 26.4 Dashboard Questions

Dashboard harus bisa menjawab:

1. berapa item stuck di state tertentu;
2. berapa lama rata-rata di state tertentu;
3. transisi mana yang paling sering gagal;
4. illegal transition dari client mana yang meningkat;
5. SLA breach terjadi di state mana;
6. apakah ada spike optimistic locking;
7. apakah ada idempotency replay abnormal.

---

## 27. State Machine Testing Strategy

## 27.1 Transition Table Test

Test semua legal transition.

```text
Given DRAFT
When SubmitApplication with valid data
Then SUBMITTED
```

## 27.2 Illegal Transition Test

```text
Given DRAFT
When ApproveApplication
Then rejected ILLEGAL_TRANSITION
```

## 27.3 Guard Test

```text
Given UNDER_REVIEW but mandatory screening not cleared
When ApproveApplication
Then rejected SCREENING_NOT_CLEARED
```

## 27.4 Authorization Test

```text
Given UNDER_REVIEW
When ApproveApplication by applicant
Then rejected NOT_AUTHORIZED_FOR_TRANSITION
```

## 27.5 Idempotency Test

```text
Given first ApproveApplication K1 succeeds
When same ApproveApplication K1 retried
Then same transition result is returned
And no duplicate outbox event
```

## 27.6 Concurrency Test

```text
Given UNDER_REVIEW version 7
When Approve and Reject race
Then only one transition commits
And the other re-evaluates/rejects
```

## 27.7 Time Test

```text
Given REJECTED at 2026-01-01
When FileAppeal at 2026-01-10
Then accepted

When FileAppeal at 2026-01-20
Then rejected APPEAL_WINDOW_EXPIRED
```

## 27.8 Property-Based Test

Untuk lifecycle kompleks, property-based testing berguna.

Invariant:

```text
APPROVED application can never transition to DRAFT.
FINAL_REJECTED can only be reopened by supervisor correction.
Every terminal transition must have reason.
Every transition must increase aggregate version.
Every accepted transition must emit audit fact.
```

---

## 28. State Machine Documentation

State machine harus didokumentasikan sebagai artifact arsitektur.

Minimal:

1. state list;
2. state meaning;
3. transition table;
4. command/event mapping;
5. guard list;
6. actor permissions;
7. side effects;
8. terminal states;
9. exceptional transitions;
10. version policy;
11. audit fields;
12. migration rules.

Contoh transition table:

| From | Command | Guard | To | Event | Actor |
|---|---|---|---|---|---|
| DRAFT | SubmitApplication | mandatoryComplete | SUBMITTED | ApplicationSubmitted | Applicant |
| SUBMITTED | AssignOfficer | supervisorOnly | UNDER_REVIEW | OfficerAssigned | Supervisor |
| UNDER_REVIEW | ApproveApplication | allChecksPassed | APPROVED | ApplicationApproved | Officer |
| UNDER_REVIEW | RejectApplication | reasonRequired | REJECTED | ApplicationRejected | Officer |
| REJECTED | FileAppeal | withinAppealWindow | UNDER_APPEAL | AppealFiled | Applicant |

---

## 29. Example: Regulatory Application State Machine

## 29.1 States

```text
DRAFT
SUBMITTED
PAYMENT_PENDING
SCREENING_PENDING
UNDER_REVIEW
CLARIFICATION_REQUIRED
CLARIFICATION_SUBMITTED
APPROVED
REJECTED
UNDER_APPEAL
FINAL_REJECTED
CANCELLED
EXPIRED
REVOKED
```

## 29.2 Commands

```text
CreateDraft
SubmitApplication
RecordPaymentReceived
RecordScreeningCleared
AssignOfficer
RequestClarification
SubmitClarification
ApproveApplication
RejectApplication
FileAppeal
AllowAppeal
DismissAppeal
CancelApplication
ExpireApplication
RevokeApproval
```

## 29.3 High-Level Flow

```text
DRAFT
  --SubmitApplication-->
SUBMITTED
  --PaymentRequired-->
PAYMENT_PENDING
  --RecordPaymentReceived-->
SCREENING_PENDING
  --RecordScreeningCleared-->
UNDER_REVIEW
  --RequestClarification-->
CLARIFICATION_REQUIRED
  --SubmitClarification-->
UNDER_REVIEW
  --ApproveApplication-->
APPROVED

UNDER_REVIEW
  --RejectApplication-->
REJECTED
  --FileAppeal-->
UNDER_APPEAL
  --AllowAppeal-->
APPROVED
  --DismissAppeal-->
FINAL_REJECTED
```

## 29.4 Important Invariants

```text
- Applicant cannot edit core fields after SUBMITTED.
- APPROVED requires screening cleared.
- APPROVED requires payment paid or exemption granted.
- REJECTED requires reason code and reason text.
- Appeal can only be filed within appeal window.
- FINAL_REJECTED cannot be reopened except supervisor correction.
- Revocation requires authority and reason.
- Every accepted transition must write transition history.
- Every accepted transition must produce domain event or explicit no-event reason.
```

---

## 30. Java Example: Production-Oriented Skeleton

This skeleton avoids framework dependency.

```java
public enum ApplicationState {
    DRAFT,
    SUBMITTED,
    PAYMENT_PENDING,
    SCREENING_PENDING,
    UNDER_REVIEW,
    CLARIFICATION_REQUIRED,
    APPROVED,
    REJECTED,
    UNDER_APPEAL,
    FINAL_REJECTED,
    CANCELLED,
    EXPIRED,
    REVOKED
}
```

For Java 17+:

```java
public sealed interface ApplicationCommand
        permits SubmitApplication,
                ApproveApplication,
                RejectApplication,
                RequestClarification,
                FileAppeal {

    UUID applicationId();
    UUID actorId();
    String idempotencyKey();
}

public record SubmitApplication(
        UUID applicationId,
        UUID actorId,
        String idempotencyKey
) implements ApplicationCommand {
}

public record ApproveApplication(
        UUID applicationId,
        UUID actorId,
        String idempotencyKey,
        String reason
) implements ApplicationCommand {
}

public record RejectApplication(
        UUID applicationId,
        UUID actorId,
        String idempotencyKey,
        String reasonCode,
        String reasonText
) implements ApplicationCommand {
}

public record RequestClarification(
        UUID applicationId,
        UUID actorId,
        String idempotencyKey,
        String clarificationReason
) implements ApplicationCommand {
}

public record FileAppeal(
        UUID applicationId,
        UUID actorId,
        String idempotencyKey,
        String appealReason
) implements ApplicationCommand {
}
```

Decision:

```java
public record TransitionDecision(
        boolean accepted,
        ApplicationState fromState,
        ApplicationState toState,
        String rejectionCode,
        String rejectionMessage,
        List<DomainEvent> events,
        List<AuditFact> auditFacts
) {
    public static TransitionDecision rejected(
            ApplicationState current,
            String code,
            String message
    ) {
        return new TransitionDecision(
                false,
                current,
                current,
                code,
                message,
                List.of(),
                List.of()
        );
    }

    public static TransitionDecision accepted(
            ApplicationState from,
            ApplicationState to,
            List<DomainEvent> events,
            List<AuditFact> auditFacts
    ) {
        return new TransitionDecision(
                true,
                from,
                to,
                null,
                null,
                List.copyOf(events),
                List.copyOf(auditFacts)
        );
    }
}
```

State machine:

```java
public final class ApplicationStateMachine {

    private final Clock clock;
    private final ApplicationPolicy policy;

    public ApplicationStateMachine(Clock clock, ApplicationPolicy policy) {
        this.clock = Objects.requireNonNull(clock);
        this.policy = Objects.requireNonNull(policy);
    }

    public TransitionDecision decide(
            ApplicationSnapshot app,
            ApplicationCommand command,
            ActorContext actor
    ) {
        return switch (command) {
            case SubmitApplication c -> submit(app, c, actor);
            case ApproveApplication c -> approve(app, c, actor);
            case RejectApplication c -> reject(app, c, actor);
            case RequestClarification c -> requestClarification(app, c, actor);
            case FileAppeal c -> fileAppeal(app, c, actor);
        };
    }

    private TransitionDecision submit(
            ApplicationSnapshot app,
            SubmitApplication command,
            ActorContext actor
    ) {
        if (app.state() != ApplicationState.DRAFT) {
            return TransitionDecision.rejected(
                    app.state(),
                    "ILLEGAL_TRANSITION",
                    "Only DRAFT application can be submitted."
            );
        }

        if (!actor.isApplicantOwner(app.applicantId())) {
            return TransitionDecision.rejected(
                    app.state(),
                    "NOT_AUTHORIZED",
                    "Only owner applicant can submit this application."
            );
        }

        if (!app.mandatoryFieldsComplete()) {
            return TransitionDecision.rejected(
                    app.state(),
                    "MANDATORY_FIELDS_INCOMPLETE",
                    "Mandatory fields are incomplete."
            );
        }

        Instant now = clock.instant();

        return TransitionDecision.accepted(
                ApplicationState.DRAFT,
                ApplicationState.SUBMITTED,
                List.of(new ApplicationSubmitted(app.applicationId(), actor.actorId(), now)),
                List.of(AuditFact.transition("Application submitted", now))
        );
    }

    private TransitionDecision approve(
            ApplicationSnapshot app,
            ApproveApplication command,
            ActorContext actor
    ) {
        if (app.state() != ApplicationState.UNDER_REVIEW) {
            return TransitionDecision.rejected(
                    app.state(),
                    "ILLEGAL_TRANSITION",
                    "Only UNDER_REVIEW application can be approved."
            );
        }

        if (!actor.hasPermission("application.approve")) {
            return TransitionDecision.rejected(
                    app.state(),
                    "NOT_AUTHORIZED",
                    "Actor cannot approve application."
            );
        }

        if (!policy.canApprove(app)) {
            return TransitionDecision.rejected(
                    app.state(),
                    "APPROVAL_POLICY_NOT_SATISFIED",
                    "Application does not satisfy approval policy."
            );
        }

        Instant now = clock.instant();

        return TransitionDecision.accepted(
                ApplicationState.UNDER_REVIEW,
                ApplicationState.APPROVED,
                List.of(new ApplicationApproved(app.applicationId(), actor.actorId(), now)),
                List.of(AuditFact.transition("Application approved", now))
        );
    }

    // reject, requestClarification, fileAppeal omitted for brevity.
}
```

Application service boundary:

```java
public final class ApplicationCommandService {

    private final ApplicationRepository repository;
    private final IdempotencyRepository idempotencyRepository;
    private final TransitionHistoryRepository transitionHistoryRepository;
    private final OutboxRepository outboxRepository;
    private final ApplicationStateMachine stateMachine;

    @Transactional
    public TransitionResponse handle(ApplicationCommand command, ActorContext actor) {
        IdempotencyRecord idem = idempotencyRepository.startOrLoad(
                command.idempotencyKey(),
                command.applicationId(),
                command.getClass().getSimpleName()
        );

        if (idem.isCompleted()) {
            return idem.toTransitionResponse();
        }

        ApplicationSnapshot app = repository.findSnapshotForUpdate(command.applicationId());

        TransitionDecision decision = stateMachine.decide(app, command, actor);

        if (!decision.accepted()) {
            idempotencyRepository.completeRejected(idem.id(), decision);
            return TransitionResponse.from(decision);
        }

        repository.updateState(
                app.applicationId(),
                app.version(),
                decision.toState()
        );

        transitionHistoryRepository.insert(app, command, actor, decision);
        outboxRepository.insertAll(decision.events());
        idempotencyRepository.completeAccepted(idem.id(), decision);

        return TransitionResponse.from(decision);
    }
}
```

Note:

```text
In real implementation, decide whether to use SELECT FOR UPDATE or optimistic version update.
For high concurrency, optimistic locking often scales better.
For strict serialization around a single aggregate, row lock can be acceptable.
```

---

## 31. SELECT FOR UPDATE vs Optimistic Locking

| Strategy | How it works | Good for | Risk |
|---|---|---|---|
| Optimistic locking | update with version check | normal business concurrency | retries needed |
| SELECT FOR UPDATE | lock row during transaction | strong serialization per aggregate | long locks, deadlocks |
| Advisory lock | named lock by aggregate id | cross-row coordination | DB-specific |
| Distributed lock | Redis/ZK/etc. | rare cross-resource lock | dangerous if misunderstood |

Rule:

```text
Prefer optimistic locking for aggregate state transition.
Use pessimistic locking only when contention/ordering requires it and transaction is short.
Avoid distributed lock unless you can prove lease, fencing, and failure behavior.
```

---

## 32. State Machine and Database Schema

Minimal schema:

```sql
CREATE TABLE application (
    application_id        UUID PRIMARY KEY,
    state                 VARCHAR(64) NOT NULL,
    version               BIGINT NOT NULL,
    applicant_id          UUID NOT NULL,
    submitted_at          TIMESTAMP NULL,
    reviewed_at           TIMESTAMP NULL,
    policy_version        VARCHAR(64) NOT NULL,
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL
);
```

Transition history:

```sql
CREATE TABLE application_transition_history (
    transition_id          UUID PRIMARY KEY,
    application_id         UUID NOT NULL,
    from_state             VARCHAR(64) NOT NULL,
    to_state               VARCHAR(64) NOT NULL,
    command_type           VARCHAR(128) NOT NULL,
    actor_id               UUID NOT NULL,
    actor_type             VARCHAR(64) NOT NULL,
    reason_code            VARCHAR(128) NULL,
    reason_text            TEXT NULL,
    policy_version         VARCHAR(64) NOT NULL,
    correlation_id         VARCHAR(128) NULL,
    causation_id           VARCHAR(128) NULL,
    idempotency_key        VARCHAR(256) NOT NULL,
    version_before         BIGINT NOT NULL,
    version_after          BIGINT NOT NULL,
    occurred_at            TIMESTAMP NOT NULL,
    recorded_at            TIMESTAMP NOT NULL
);
```

Outbox:

```sql
CREATE TABLE outbox_message (
    outbox_id              UUID PRIMARY KEY,
    aggregate_type         VARCHAR(128) NOT NULL,
    aggregate_id           UUID NOT NULL,
    event_type             VARCHAR(128) NOT NULL,
    event_version          INT NOT NULL,
    payload_json           TEXT NOT NULL,
    headers_json           TEXT NOT NULL,
    status                 VARCHAR(32) NOT NULL,
    created_at             TIMESTAMP NOT NULL,
    published_at           TIMESTAMP NULL
);
```

Idempotency:

```sql
CREATE TABLE idempotency_record (
    idempotency_key        VARCHAR(256) PRIMARY KEY,
    aggregate_id           UUID NOT NULL,
    command_type           VARCHAR(128) NOT NULL,
    request_hash           VARCHAR(128) NOT NULL,
    status                 VARCHAR(32) NOT NULL,
    response_json          TEXT NULL,
    created_at             TIMESTAMP NOT NULL,
    completed_at           TIMESTAMP NULL,
    expires_at             TIMESTAMP NOT NULL
);
```

---

## 33. State Machine Anti-Patterns

## 33.1 String Status Mutation

```java
entity.setStatus(request.getStatus());
```

This bypasses lifecycle rules.

---

## 33.2 Status Controlled by UI

UI decides allowed transition and backend trusts it.

Backend must be authoritative.

---

## 33.3 One Giant Enum for Everything

Combining multiple dimensions causes state explosion.

---

## 33.4 Hidden Transition in Scheduler

Scheduler directly updates status without using state machine.

```sql
UPDATE application SET status = 'EXPIRED' WHERE submitted_at < ...
```

Scheduler should send command/event through same transition path.

---

## 33.5 Remote Call Inside Transition Transaction

Remote dependency failure can corrupt semantics or hold lock too long.

---

## 33.6 No Transition History

Current state without transition history is weak for audit and debugging.

---

## 33.7 No Versioning

State machine changes over time but old instances are not handled.

---

## 33.8 No Idempotency

Retry causes duplicate transition or duplicate side effect.

---

## 33.9 Framework as Domain Model

Framework configuration becomes the domain language, but business engineers cannot reason about it.

---

## 33.10 State Machine as God Object

One state machine controls application, payment, document, screening, notification, reporting, and audit.

This is distributed monolith inside a class.

---

## 34. Relationship with Microservices Boundary

Where should state machine live?

Answer:

```text
In the service that owns the lifecycle and invariant.
```

Example:

```text
Application Service owns Application State Machine.
Payment Service owns Payment State Machine.
Document Service owns Document Review State Machine.
Screening Service owns Screening State Machine.
Case Service owns Enforcement Case State Machine.
```

A workflow/process manager may coordinate them, but should not directly mutate their state.

Correct:

```text
Process Manager sends ApproveApplication command to Application Service.
Application Service decides transition.
```

Wrong:

```text
Process Manager updates application.status table directly.
```

---

## 35. Design Checklist

Before implementing a state machine, answer:

1. What entity/process owns this lifecycle?
2. What are the meaningful states?
3. Which states are terminal?
4. Which states are exceptional?
5. Which commands can trigger transitions?
6. Which events are emitted after accepted transitions?
7. Which actors can perform each command?
8. Which guards protect each transition?
9. Which invariants must always hold?
10. Which side effects are local transaction actions?
11. Which side effects must be outbox events?
12. How is idempotency enforced?
13. How is concurrent transition handled?
14. How is transition history stored?
15. How is audit evidence recorded?
16. How is state machine versioned?
17. How are old instances migrated?
18. How are time-based transitions triggered?
19. How are illegal transitions returned to clients?
20. How is observability designed?

---

## 36. Production Readiness Checklist

A production-ready state machine should have:

```text
[ ] Explicit state list
[ ] Explicit command/event list
[ ] Explicit transition table
[ ] Guard per transition
[ ] Actor-aware authorization hook
[ ] Time-aware policy via Clock
[ ] Idempotency handling
[ ] Optimistic/pessimistic concurrency strategy
[ ] Transition history table
[ ] Audit fields
[ ] Outbox integration for external side effects
[ ] Illegal transition error contract
[ ] State/version migration plan
[ ] Metrics for transition success/rejection
[ ] Logs with correlation id
[ ] Tests for legal transitions
[ ] Tests for illegal transitions
[ ] Tests for guard failure
[ ] Tests for concurrency race
[ ] Tests for idempotent retry
[ ] Tests for time-based transition
[ ] Documentation diagram/table
[ ] Ownership defined
[ ] Runbook for stuck state
```

---

## 37. Architecture Review Questions

Senior/principal-level questions:

1. Is this lifecycle owned by exactly one service?
2. Are transitions command-based or status-mutation-based?
3. Can any API set arbitrary status?
4. What prevents illegal transitions?
5. What prevents duplicate side effects?
6. What happens if the response is lost after commit?
7. What happens if two actors transition the same aggregate concurrently?
8. Are side effects inside local transaction or via outbox?
9. Can we reconstruct why this entity reached this state?
10. Can we show who approved/rejected and under what authority?
11. How are time-based transitions triggered and tested?
12. How are old state machine versions handled?
13. Are there parallel states disguised as enum explosion?
14. Are authorization rules endpoint-level only or transition-level?
15. Can observability show stuck entities and illegal transition spikes?
16. Are terminal states really terminal?
17. Does the state machine know policy version?
18. Can replay/reprocessing cause duplicate transitions?
19. Is the state machine a domain model or framework configuration dump?
20. Can a new engineer understand lifecycle from documentation?

---

## 38. Practical Exercises

### Exercise 1 — Identify Hidden State Machine

Take one existing module and list all `status` values.

Then discover:

```text
- who changes status
- where it changes
- what validation happens
- what side effects happen
- what audit records exist
- what illegal transitions are possible
```

Output:

```text
State list
Transition table
Guard list
Side effect list
Risk list
```

---

### Exercise 2 — Replace updateStatus API

Given:

```text
PUT /applications/{id}/status
{ "status": "APPROVED" }
```

Redesign as command APIs:

```text
POST /applications/{id}/submit
POST /applications/{id}/approve
POST /applications/{id}/reject
POST /applications/{id}/request-clarification
POST /applications/{id}/appeal
```

Define:

```text
request body
idempotency key
response model
error model
audit fields
outbox event
```

---

### Exercise 3 — Concurrency Race

Design what happens when:

```text
Officer A approves application.
Officer B rejects application at the same time.
```

Answer:

```text
locking strategy
expected database behavior
client response
retry behavior
audit behavior
```

---

### Exercise 4 — Policy Change

Appeal window changes from 14 days to 21 days.

Define:

```text
which applications use old rule
which applications use new rule
where policy version is stored
how audit explains decision
how tests cover both versions
```

---

### Exercise 5 — State Explosion Refactoring

Given statuses:

```text
PAYMENT_PENDING_DOCUMENT_PENDING_SCREENING_PENDING
PAYMENT_PAID_DOCUMENT_PENDING_SCREENING_PENDING
PAYMENT_PAID_DOCUMENT_VERIFIED_SCREENING_PENDING
PAYMENT_PAID_DOCUMENT_VERIFIED_SCREENING_CLEARED
```

Refactor into multiple coordinated state machines.

---

## 39. Key Takeaways

1. State machine is not an enum.
2. State is behavior, not only label.
3. Transition must be command/event-driven, not arbitrary status mutation.
4. Guard is where correctness lives.
5. Side effects should be planned and usually emitted via outbox.
6. Transition history is essential for audit and incident analysis.
7. Idempotency is mandatory in distributed systems.
8. Concurrency must be designed, not hoped away.
9. Time and policy version must be explicit in regulatory systems.
10. Avoid one giant state machine for multiple parallel lifecycles.
11. State machine should live in the service that owns the lifecycle invariant.
12. Java 17+ sealed types, records, and Java 21 pattern matching improve modeling, but Java 8 can still implement the pattern with discipline.
13. Frameworks can help, but they do not replace domain thinking.

---

## 40. References

1. Martin Fowler — State Machine.  
   https://martinfowler.com/dslCatalog/stateMachine.html

2. Martin Fowler — Domain Model.  
   https://martinfowler.com/eaaCatalog/domainModel.html

3. Martin Fowler — Rules Engine.  
   https://martinfowler.com/bliki/RulesEngine.html

4. Spring Statemachine Reference Documentation.  
   https://docs.spring.io/spring-statemachine/docs/current/reference/

5. OpenJDK JEP 409 — Sealed Classes.  
   https://openjdk.org/jeps/409

6. OpenJDK JEP 441 — Pattern Matching for switch.  
   https://openjdk.org/jeps/441

7. OpenJDK JDK 25 Project.  
   https://openjdk.org/projects/jdk/25/

---

## 41. Penutup Part 19

Part ini membentuk fondasi untuk melihat lifecycle sebagai explicit correctness model.

Dalam microservices, state machine membantu menjaga agar sistem tidak berubah menjadi kumpulan status mutation yang tersebar, sulit diaudit, rentan race condition, dan sulit dievolusi.

State machine yang baik membuat lifecycle menjadi:

```text
explicit
legal/illegal transition clear
guard-driven
audit-ready
idempotent
concurrency-safe
version-aware
observable
evolvable
```

Selanjutnya kita akan masuk ke:

```text
Part 20 — Service-to-Service Security Patterns
```

