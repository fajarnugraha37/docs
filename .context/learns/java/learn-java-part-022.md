# learn-java-part-022.md

# Bagian 22 — Design Principles dan Domain Modeling dengan Java

> Target pembaca: software engineer yang sudah memahami Java language, object model, generics, collections, error handling, concurrency, testing, framework internals, dan backend engineering.
>
> Target hasil: kamu mampu memakai Java bukan hanya sebagai bahasa implementasi, tetapi sebagai alat modeling untuk membangun sistem bisnis yang benar, defensible, testable, auditable, evolvable, dan tahan terhadap kompleksitas domain.

---

## Daftar Isi

1. [Orientasi: Java sebagai Bahasa untuk Modeling](#1-orientasi-java-sebagai-bahasa-untuk-modeling)
2. [Mental Model: Domain Model Bukan Database Model](#2-mental-model-domain-model-bukan-database-model)
3. [Prinsip Utama Domain Modeling](#3-prinsip-utama-domain-modeling)
4. [Ubiquitous Language, Bounded Context, dan Context Boundary](#4-ubiquitous-language-bounded-context-dan-context-boundary)
5. [Jenis Objek dalam Domain Model](#5-jenis-objek-dalam-domain-model)
6. [Entity](#6-entity)
7. [Value Object](#7-value-object)
8. [Aggregate dan Aggregate Root](#8-aggregate-dan-aggregate-root)
9. [Invariant Modeling](#9-invariant-modeling)
10. [Factory dan Construction Policy](#10-factory-dan-construction-policy)
11. [Domain Service](#11-domain-service)
12. [Application Service / Use Case](#12-application-service--use-case)
13. [Repository](#13-repository)
14. [Policy, Specification, Strategy, dan Rule Object](#14-policy-specification-strategy-dan-rule-object)
15. [State Machine Modeling](#15-state-machine-modeling)
16. [Command, Event, Query, dan Causality](#16-command-event-query-dan-causality)
17. [Domain Event dan Integration Event](#17-domain-event-dan-integration-event)
18. [Error Modeling dengan Java](#18-error-modeling-dengan-java)
19. [API Surface Design untuk Domain Core](#19-api-surface-design-untuk-domain-core)
20. [Immutability, Mutability, dan Encapsulation](#20-immutability-mutability-dan-encapsulation)
21. [Java Modern untuk Domain Modeling](#21-java-modern-untuk-domain-modeling)
22. [Package, Module, dan Dependency Direction](#22-package-module-dan-dependency-direction)
23. [Persistence Boundary: JPA, JDBC, dan Domain Model](#23-persistence-boundary-jpa-jdbc-dan-domain-model)
24. [Transaction Boundary dan Consistency](#24-transaction-boundary-dan-consistency)
25. [Auditability dan Regulatory Defensibility](#25-auditability-dan-regulatory-defensibility)
26. [Testing Domain Model](#26-testing-domain-model)
27. [Refactoring Transaction Script ke Domain Model](#27-refactoring-transaction-script-ke-domain-model)
28. [Anti-Patterns](#28-anti-patterns)
29. [Code Review Checklist](#29-code-review-checklist)
30. [Latihan Bertahap](#30-latihan-bertahap)
31. [Mini Project: Enforcement Case Lifecycle Model](#31-mini-project-enforcement-case-lifecycle-model)
32. [Referensi](#32-referensi)

---

# 1. Orientasi: Java sebagai Bahasa untuk Modeling

Sebagian engineer memakai Java seperti bahasa untuk “memindahkan data”:

```text
Controller → Service → Repository → Entity → Database
```

Lalu semua business rule ditaruh di service method panjang:

```java
public void approveCase(String caseId, String officerId) {
    CaseEntity entity = repository.findById(caseId).orElseThrow();
    if (!entity.getStatus().equals("SUBMITTED")) {
        throw new IllegalStateException("Invalid status");
    }
    if (entity.getAssignedOfficer() == null) {
        throw new IllegalStateException("No officer");
    }
    entity.setStatus("APPROVED");
    entity.setApprovedBy(officerId);
    entity.setApprovedAt(Instant.now());
    repository.save(entity);
}
```

Kode ini bisa jalan. Tetapi semakin domain bertambah, ia rapuh:

- status hanya string;
- transition tidak eksplisit;
- invariant tersebar;
- audit reason mudah lupa;
- command semantics tidak jelas;
- rule sulit diuji tanpa database;
- authorization/validation/business rule tercampur;
- tidak jelas mana domain failure dan technical failure;
- data dapat diubah dari setter mana pun;
- sulit membuktikan kenapa suatu keputusan diambil.

Domain modeling yang kuat bertanya:

```text
Apa konsep domain yang penting?
Apa lifecycle-nya?
Apa invariant-nya?
Siapa yang boleh mengubah apa?
Apa command yang valid?
Apa event yang terjadi?
Apa alasan perubahan?
Apa bukti/audit trail-nya?
Apa yang harus atomic?
Apa yang boleh eventual?
```

Java modern sangat cocok untuk modeling karena punya:

- class untuk entity;
- record untuk value object/data carrier;
- enum untuk finite constants;
- sealed interface/class untuk closed alternatives;
- pattern matching untuk exhaustive decision;
- generics untuk type-safe abstractions;
- package/module untuk boundary;
- exception/sealed result untuk error modeling;
- collections immutable/unmodifiable;
- strong typing untuk mencegah primitive obsession.

> Domain modeling adalah seni membuat illegal state sulit atau mustahil direpresentasikan, dan membuat legal transition eksplisit, teruji, dan dapat dijelaskan.

---

# 2. Mental Model: Domain Model Bukan Database Model

## 2.1 Database model menjawab: bagaimana data disimpan?

Database model fokus pada:

- table;
- column;
- primary key;
- foreign key;
- index;
- normalization;
- constraints;
- query;
- transaction;
- storage;
- migration.

Contoh:

```text
case_record
  id
  status
  severity
  assigned_officer_id
  created_at
  updated_at
  version
```

## 2.2 Domain model menjawab: apa arti dan aturan data?

Domain model fokus pada:

- konsep bisnis;
- behavior;
- invariant;
- lifecycle;
- transition;
- policy;
- responsibility;
- decision;
- audit;
- language;
- consequence.

Contoh:

```text
Case can be escalated only when:
  - status is OPEN or UNDER_REVIEW
  - severity after escalation is higher than current severity
  - escalation reason is provided
  - acting officer has authority
  - escalation creates audit trail
  - escalation emits CaseEscalated event
```

## 2.3 Object bukan row

Kesalahan umum:

```text
1 table = 1 entity class = 1 domain object
```

Kadang benar, sering salah.

Satu aggregate bisa disimpan di banyak table. Satu table bisa menjadi read model saja. Satu domain concept bisa tidak punya table langsung. Satu persistence entity bisa tidak sama dengan domain entity.

## 2.4 Domain core harus bisa dipahami tanpa framework

Domain core idealnya bisa dibaca dan diuji tanpa:

- Spring;
- Hibernate;
- Jackson;
- HTTP;
- Kafka;
- database;
- Kubernetes.

Contoh domain core:

```java
public final class EnforcementCase {
    private final CaseId id;
    private CaseStatus status;
    private Severity severity;
    private OfficerId assignedOfficer;
    private long version;

    public CaseEscalated escalate(EscalateCase command, EscalationPolicy policy, Clock clock) {
        ...
    }
}
```

Framework boleh berada di boundary:

```text
HTTP → Application Service → Domain Model → Repository Port → Persistence Adapter
```

---

# 3. Prinsip Utama Domain Modeling

## 3.1 Model the behavior, not only the data

Buruk:

```java
case.setStatus(CaseStatus.CLOSED);
case.setClosedAt(now);
case.setClosedBy(officer);
case.setClosureReason(reason);
```

Lebih baik:

```java
caseRecord.close(new CloseCase(officer, reason), clock);
```

Karena `close(...)` bisa menjaga:

- status sebelumnya valid;
- reason wajib;
- officer valid;
- audit event dibuat;
- timestamp konsisten;
- invariant tetap benar.

## 3.2 Make illegal state unrepresentable

Buruk:

```java
record Money(BigDecimal amount, String currency) {}
```

Ini mengizinkan:

```java
new Money(null, "");
new Money(new BigDecimal("-100"), "???");
```

Lebih baik:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Invalid scale for currency");
        }
    }
}
```

## 3.3 Explicit boundary, explicit responsibility

Jangan semua logic masuk `CaseService`.

Pisahkan:

| Responsibility | Tempat |
|---|---|
| command orchestration | application service/use case |
| invariant internal case | aggregate |
| rule eksternal/kompleks | policy/specification |
| persistence | repository adapter |
| integration event publishing | outbox/application layer |
| authorization | application/security layer |
| audit reason/domain event | domain + application |

## 3.4 Prefer type over convention

Buruk:

```java
void assign(String caseId, String officerId, String reason)
```

Lebih baik:

```java
void assign(CaseId caseId, OfficerId officerId, AssignmentReason reason)
```

String membuat semua terlihat sama. Type membuat maksud berbeda.

## 3.5 State transition harus eksplisit

Buruk:

```java
entity.setStatus("CLOSED");
```

Lebih baik:

```java
caseRecord.close(command, clock);
```

Atau:

```java
transitionEngine.apply(caseRecord, new CloseCase(...));
```

## 3.6 Domain event adalah fakta masa lalu

Event bukan command.

Command:

```text
EscalateCase
```

berarti permintaan/niat.

Event:

```text
CaseEscalated
```

berarti fakta yang sudah terjadi.

Jangan beri nama event seperti:

```text
EscalateCaseEvent
```

Lebih baik:

```text
CaseEscalated
```

## 3.7 Domain model harus audit-friendly

Terutama untuk sistem regulatori/enforcement, setiap perubahan penting harus bisa menjawab:

- siapa melakukan;
- kapan;
- dari state apa;
- ke state apa;
- berdasarkan command apa;
- reason apa;
- rule apa yang dievaluasi;
- evidence apa;
- correlation ID apa;
- version berapa;
- outcome apa.

---

# 4. Ubiquitous Language, Bounded Context, dan Context Boundary

## 4.1 Ubiquitous Language

Ubiquitous Language berarti bahasa yang sama dipakai oleh:

- domain expert;
- product owner;
- engineer;
- tester;
- documentation;
- API;
- code.

Jika business mengatakan:

```text
case escalated due to severity threshold
```

maka code sebaiknya punya konsep:

```java
CaseEscalated
EscalationReason
SeverityThresholdPolicy
```

Bukan:

```java
updateStatus(...)
flag = 3
type = "E"
```

## 4.2 Bounded Context

Bounded Context adalah batas di mana istilah/domain model punya makna konsisten.

Contoh istilah `Case` bisa berbeda:

| Context | Arti Case |
|---|---|
| Enforcement | lifecycle investigasi/enforcement |
| Licensing | application/request izin |
| Support Ticket | issue pengguna |
| Audit | objek pemeriksaan historical |
| Document | folder/evidence grouping |

Jika semua dipaksa menjadi satu class `Case`, model akan kacau.

## 4.3 Context boundary lebih penting daripada microservice boundary

Satu bounded context bisa diimplementasikan sebagai:

- modul dalam monolith;
- modul dalam modulith;
- satu microservice;
- beberapa microservice;
- library shared terbatas.

Jangan langsung menyamakan:

```text
bounded context = microservice
```

Microservice adalah deployment boundary. Bounded context adalah semantic/model boundary.

## 4.4 Context map

Context map menjelaskan hubungan antar context:

- customer/supplier;
- conformist;
- anti-corruption layer;
- shared kernel;
- open host service;
- published language.

Contoh:

```text
Enforcement Context
  uses Profile Context through published API
  must not share Profile database tables directly
```

## 4.5 Anti-corruption layer

Jika external system memakai model yang tidak cocok, jangan bocorkan model itu ke domain core.

Contoh external status:

```text
PENDING_01
PENDING_02
APPR
RJCT
```

Buat translator:

```java
public final class ExternalCaseStatusTranslator {
    public CaseStatus translate(String externalStatus) {
        return switch (externalStatus) {
            case "PENDING_01", "PENDING_02" -> CaseStatus.UNDER_REVIEW;
            case "APPR" -> CaseStatus.APPROVED;
            case "RJCT" -> CaseStatus.REJECTED;
            default -> throw new UnknownExternalStatus(externalStatus);
        };
    }
}
```

Jangan masukkan kode external ke enum domain jika itu bukan bahasa domain internal.

---

# 5. Jenis Objek dalam Domain Model

Domain model biasanya punya beberapa building block:

| Building block | Fungsi |
|---|---|
| Entity | object dengan identity dan lifecycle |
| Value Object | object tanpa identity, equality by value |
| Aggregate | consistency boundary |
| Aggregate Root | entry point perubahan aggregate |
| Domain Service | behavior domain yang tidak natural masuk entity/value object |
| Application Service | orchestration use case |
| Repository | abstraction penyimpanan aggregate |
| Factory | construction kompleks |
| Policy | rule/decision yang dapat berubah |
| Specification | predicate domain yang reusable/composable |
| Domain Event | fakta domain yang sudah terjadi |
| Command | intent/action request |
| Query/View Model | read-side representation |
| Saga/Process Manager | koordinasi workflow multi-aggregate/context |

Kesalahan umum adalah memakai satu kata `Service` untuk semuanya.

---

# 6. Entity

Entity adalah object yang punya identity dan lifecycle.

Dua entity bisa memiliki nilai field sama tetapi tetap object berbeda jika identity berbeda.

Contoh:

```java
public record CaseId(UUID value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
    }

    public static CaseId newId() {
        return new CaseId(UUID.randomUUID());
    }
}
```

Entity:

```java
public final class EnforcementCase {
    private final CaseId id;
    private CaseStatus status;
    private Severity severity;
    private OfficerId assignedOfficer;
    private long version;

    public EnforcementCase(CaseId id, Severity severity) {
        this.id = Objects.requireNonNull(id, "id");
        this.severity = Objects.requireNonNull(severity, "severity");
        this.status = CaseStatus.OPEN;
        this.version = 0;
    }

    public CaseId id() {
        return id;
    }

    public CaseStatus status() {
        return status;
    }
}
```

## 6.1 Entity equality

Untuk domain entity, equality harus hati-hati.

Option umum:

### Option A — identity equality only

```java
@Override
public boolean equals(Object other) {
    return this == other;
}
```

Cocok jika entity object hanya hidup dalam aggregate/session tertentu.

### Option B — equality by stable ID

```java
@Override
public boolean equals(Object o) {
    return o instanceof EnforcementCase other
        && id.equals(other.id);
}

@Override
public int hashCode() {
    return id.hashCode();
}
```

Cocok jika ID sudah ada sejak construction dan immutable.

Risiko jika ID assigned belakangan oleh DB:

- sebelum persist ID null;
- hashCode berubah setelah dimasukkan ke HashSet;
- equality inconsistent.

Domain model yang kuat sering memakai application-generated ID agar identity stabil sejak awal.

## 6.2 Entity bukan DTO

Entity punya behavior.

Buruk:

```java
public class Case {
    public String id;
    public String status;
}
```

Lebih baik:

```java
public final class EnforcementCase {
    public CaseEscalated escalate(EscalateCase command, EscalationPolicy policy, Clock clock) {
        ...
    }
}
```

## 6.3 Entity method harus menyatakan maksud domain

Buruk:

```java
caseRecord.updateStatus(CaseStatus.ESCALATED);
```

Lebih baik:

```java
caseRecord.escalate(command, policy, clock);
caseRecord.assign(command, policy, clock);
caseRecord.close(command, clock);
```

Method domain harus memakai bahasa domain.

## 6.4 Entity harus menjaga invariant internal

Jangan expose setter bebas:

```java
public void setStatus(CaseStatus status) {
    this.status = status;
}
```

Karena semua orang bisa bypass transition rules.

Gunakan behavior method:

```java
public CaseClosed close(CloseCase command, Clock clock) {
    if (!status.canClose()) {
        throw new InvalidCaseTransition(id, status, CaseAction.CLOSE);
    }

    this.status = CaseStatus.CLOSED;
    this.version++;

    return new CaseClosed(id, command.officerId(), command.reason(), clock.instant(), version);
}
```

---

# 7. Value Object

Value Object adalah object yang equality-nya berdasarkan nilai, bukan identity.

Contoh:

```java
public record OfficerId(String value) {
    public OfficerId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("Officer ID must not be blank");
        }
    }
}
```

Dua `OfficerId("O-123")` adalah value yang sama.

## 7.1 Record cocok untuk banyak value object

Java `record` bagus untuk value object karena:

- field final;
- accessor otomatis;
- `equals`;
- `hashCode`;
- `toString`;
- canonical constructor;
- compact constructor validation.

Contoh:

```java
public record CaseTitle(String value) {
    public CaseTitle {
        Objects.requireNonNull(value, "value");
        value = value.strip();
        if (value.length() < 5) {
            throw new IllegalArgumentException("Case title too short");
        }
        if (value.length() > 200) {
            throw new IllegalArgumentException("Case title too long");
        }
    }
}
```

Catatan: assignment ke parameter compact constructor diperbolehkan untuk normalisasi sebelum field diassign otomatis.

## 7.2 Value object harus immutable

Jika value object punya collection, jangan bocorkan mutable reference.

Buruk:

```java
public record EvidenceSet(List<EvidenceId> evidenceIds) {}
```

Caller bisa mengubah list jika list mutable.

Lebih baik:

```java
public record EvidenceSet(List<EvidenceId> evidenceIds) {
    public EvidenceSet {
        evidenceIds = List.copyOf(evidenceIds);
        if (evidenceIds.isEmpty()) {
            throw new IllegalArgumentException("Evidence set must not be empty");
        }
    }
}
```

## 7.3 Primitive obsession

Primitive obsession terjadi saat konsep domain direpresentasikan dengan primitive/string generik.

Buruk:

```java
void assign(String caseId, String officerId, String reason, int severity)
```

Lebih baik:

```java
void assign(CaseId caseId, OfficerId officerId, AssignmentReason reason, Severity severity)
```

Keuntungan:

- validation dekat data;
- compiler mencegah parameter tertukar;
- code lebih readable;
- refactoring lebih aman;
- business meaning explicit.

## 7.4 Value object untuk constraint

Contoh `EscalationReason`:

```java
public record EscalationReason(String value) {
    public EscalationReason {
        Objects.requireNonNull(value, "value");
        value = value.strip();
        if (value.length() < 10) {
            throw new IllegalArgumentException("Escalation reason too short");
        }
        if (value.length() > 2_000) {
            throw new IllegalArgumentException("Escalation reason too long");
        }
    }
}
```

Sekarang tidak mungkin membuat reason kosong di domain core.

## 7.5 Value object dan persistence

Value object bisa disimpan sebagai:

- single column;
- embedded columns;
- child table;
- JSON column;
- separate normalized table.

Jangan biarkan persistence mapping menentukan apakah konsep domain layak menjadi value object.

---

# 8. Aggregate dan Aggregate Root

Aggregate adalah cluster object yang diperlakukan sebagai satu consistency boundary.

Aggregate Root adalah object utama yang menjadi entry point untuk membaca/mengubah aggregate.

Contoh:

```text
EnforcementCase aggregate
  root: EnforcementCase
  children:
    CaseAssignment
    CaseNote
    CaseEvidenceReference
    CaseDecision
```

External code tidak boleh mengubah child langsung. Semua perubahan lewat root:

```java
caseRecord.addEvidence(command, policy, clock);
caseRecord.assign(command, policy, clock);
caseRecord.escalate(command, policy, clock);
```

## 8.1 Aggregate boundary ditentukan oleh invariant

Pertanyaan utama:

```text
Apa yang harus konsisten secara atomik?
```

Jika rule:

```text
Case cannot be closed unless all mandatory evidence references are attached.
```

Maka evidence references mungkin bagian dari aggregate atau harus dicek dalam transaction/policy dengan konsistensi kuat.

Jika rule:

```text
When case is closed, notification eventually sent.
```

Notification bukan bagian aggregate. Itu integration side effect.

## 8.2 Aggregate harus kecil

Aggregate terlalu besar menyebabkan:

- transaction besar;
- lock contention;
- load banyak data;
- concurrent update conflict;
- slow persistence;
- high memory;
- sulit scale.

Guideline:

```text
Aggregate should include only objects needed to enforce invariants synchronously.
```

## 8.3 Cross-aggregate invariant

Contoh:

```text
Officer cannot have more than 20 active cases.
```

Ini melibatkan banyak case.

Jangan otomatis membuat aggregate `Officer` berisi semua cases. Itu bisa besar.

Alternatif:

- enforce with database constraint/counter;
- application service checks read model with optimistic retry;
- domain policy reads assignment load;
- eventual consistency with compensating action;
- process manager;
- reservation pattern.

## 8.4 Aggregate root controls children

Buruk:

```java
caseRecord.notes().add(new CaseNote(...));
```

Baik:

```java
caseRecord.addNote(new AddCaseNote(officer, text), clock);
```

Expose collection sebagai immutable snapshot:

```java
public List<CaseNote> notes() {
    return List.copyOf(notes);
}
```

## 8.5 Aggregate version

Version penting untuk optimistic locking dan event ordering.

```java
private long version;

private long nextVersion() {
    return ++version;
}
```

Event membawa version:

```java
public record CaseEscalated(
    CaseId caseId,
    Severity previousSeverity,
    Severity newSeverity,
    OfficerId escalatedBy,
    EscalationReason reason,
    Instant occurredAt,
    long aggregateVersion
) implements DomainEvent {}
```

---

# 9. Invariant Modeling

Invariant adalah aturan yang harus selalu benar pada state domain yang valid.

Contoh invariant:

```text
Closed case cannot be escalated.
Case with severity CRITICAL must have assigned officer.
Escalation reason is mandatory.
Decision date cannot be before case opened date.
Approved case must have approver.
Case version must monotonically increase.
```

## 9.1 Jenis invariant

| Jenis | Contoh |
|---|---|
| structural invariant | title tidak kosong |
| temporal invariant | closedAt >= openedAt |
| state invariant | closed case tidak bisa assigned ulang |
| cross-field invariant | approvedBy wajib jika status APPROVED |
| cross-child invariant | cannot close without mandatory evidence |
| cross-aggregate invariant | officer active caseload limit |
| regulatory invariant | rejection must have legally acceptable reason |
| audit invariant | every status change must produce audit event |

## 9.2 Invariant dekat dengan data

Buruk:

```java
if (reason == null || reason.isBlank()) ...
```

diulang di banyak service.

Lebih baik:

```java
new EscalationReason(reason)
```

## 9.3 Invariant dalam constructor

```java
public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start, "start");
        Objects.requireNonNull(end, "end");
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }
}
```

## 9.4 Invariant dalam behavior

```java
public CaseClosed close(CloseCase command, Clock clock) {
    requireStatus(CaseStatus.UNDER_REVIEW, CaseStatus.RESOLVED);

    if (!hasMandatoryEvidence()) {
        throw new MissingMandatoryEvidence(id);
    }

    this.status = CaseStatus.CLOSED;
    long newVersion = nextVersion();

    return new CaseClosed(id, command.closedBy(), command.reason(), clock.instant(), newVersion);
}
```

## 9.5 Invariant dengan policy

Jika rule berubah sering atau membutuhkan data eksternal, jangan hardcode semua di entity.

```java
public CaseEscalated escalate(
        EscalateCase command,
        EscalationPolicy policy,
        Clock clock
) {
    policy.validate(this, command);

    Severity previous = this.severity;
    this.severity = command.newSeverity();
    this.status = CaseStatus.ESCALATED;

    return new CaseEscalated(id, previous, severity, command.officerId(), command.reason(), clock.instant(), nextVersion());
}
```

## 9.6 Invariant dan concurrency

Invariant yang benar di single-thread object bisa gagal saat concurrent update.

Gunakan:

- optimistic locking;
- transaction isolation;
- database constraints;
- compare-and-set;
- aggregate version;
- idempotency key;
- event ordering.

---

# 10. Factory dan Construction Policy

Factory berguna saat construction kompleks atau memiliki business meaning.

## 10.1 Static factory

```java
public final class EnforcementCase {
    public static OpenedCaseResult open(OpenCase command, CaseNumberGenerator generator, Clock clock) {
        CaseId id = CaseId.newId();
        CaseNumber number = generator.nextNumber(command.caseType(), clock);

        EnforcementCase caseRecord = new EnforcementCase(
            id,
            number,
            command.title(),
            command.initialSeverity(),
            CaseStatus.OPEN,
            clock.instant()
        );

        CaseOpened event = new CaseOpened(id, number, command.openedBy(), clock.instant(), 0);

        return new OpenedCaseResult(caseRecord, event);
    }

    private EnforcementCase(...) {
        ...
    }
}
```

## 10.2 Factory object

Jika construction butuh dependency:

```java
public final class EnforcementCaseFactory {
    private final CaseNumberGenerator numberGenerator;
    private final Clock clock;

    public OpenedCaseResult open(OpenCase command) {
        ...
    }
}
```

## 10.3 Factory vs constructor

Gunakan constructor jika:

- construction sederhana;
- invariant lokal;
- dependency tidak diperlukan.

Gunakan factory jika:

- nama construction penting;
- banyak alternative creation path;
- perlu dependency;
- perlu event;
- perlu generated ID/number;
- perlu policy;
- perlu validation kompleks.

## 10.4 Jangan jadikan factory tempat semua logic

Factory bertanggung jawab membuat object valid. Behavior lifecycle tetap di aggregate/entity.

---

# 11. Domain Service

Domain Service adalah service untuk behavior domain yang tidak natural menjadi method entity/value object.

Contoh:

```text
Calculate penalty across several cases and historical violations.
Determine risk score from case, profile, and compliance history.
Generate enforcement recommendation based on multiple policies.
```

## 11.1 Ciri Domain Service

- domain language;
- stateless or mostly stateless;
- tidak sekadar CRUD;
- berisi business decision;
- tidak tergantung framework;
- tidak mengatur transaction/HTTP;
- dapat diuji dengan object domain.

Contoh:

```java
public final class EnforcementRecommendationService {
    public Recommendation recommend(
            EnforcementCase caseRecord,
            ComplianceHistory history,
            RiskScoringPolicy riskPolicy
    ) {
        RiskScore score = riskPolicy.score(caseRecord, history);

        return switch (score.level()) {
            case LOW -> Recommendation.noAction("Low risk");
            case MEDIUM -> Recommendation.warning("Medium risk");
            case HIGH -> Recommendation.investigate("High risk");
            case CRITICAL -> Recommendation.escalate("Critical risk");
        };
    }
}
```

## 11.2 Domain Service vs Application Service

| Aspect | Domain Service | Application Service |
|---|---|---|
| Fokus | business rule/domain decision | orchestration use case |
| Framework dependency | sebaiknya tidak | boleh tipis |
| Transaction | tidak mengelola | biasanya mengelola |
| Repository | biasanya tidak atau via domain port/policy | ya |
| Input | domain object/value | command DTO/use case input |
| Output | domain result | response/result/use case outcome |

## 11.3 Domain Service anti-pattern

Buruk:

```java
public class CaseDomainService {
    public void createCase(...) {}
    public void updateCase(...) {}
    public void deleteCase(...) {}
    public void findCase(...) {}
}
```

Itu CRUD service, bukan domain service.

---

# 12. Application Service / Use Case

Application Service mengorkestrasi use case.

Tugas:

- validate command shape;
- load aggregate;
- call domain behavior;
- persist aggregate;
- publish/store domain events;
- manage transaction;
- authorization check;
- idempotency;
- map result;
- call external adapter if appropriate.

Contoh:

```java
public final class EscalateCaseUseCase {
    private final CaseRepository repository;
    private final EscalationPolicy policy;
    private final DomainEventPublisher events;
    private final Clock clock;

    public EscalateCaseUseCase(
            CaseRepository repository,
            EscalationPolicy policy,
            DomainEventPublisher events,
            Clock clock
    ) {
        this.repository = repository;
        this.policy = policy;
        this.events = events;
        this.clock = clock;
    }

    public EscalateCaseResult handle(EscalateCase command) {
        EnforcementCase caseRecord = repository.get(command.caseId());

        CaseEscalated event = caseRecord.escalate(command, policy, clock);

        repository.save(caseRecord);
        events.publish(event);

        return new EscalateCaseResult(caseRecord.id(), caseRecord.status(), caseRecord.severity());
    }
}
```

## 12.1 Application service tidak berisi business rule utama

Buruk:

```java
public void escalate(EscalateCase command) {
    var c = repo.get(command.caseId());
    if (c.getStatus() == CLOSED) throw ...
    if (command.newSeverity().compareTo(c.getSeverity()) <= 0) throw ...
    c.setSeverity(command.newSeverity());
    c.setStatus(ESCALATED);
}
```

Lebih baik rule ada di aggregate/policy.

## 12.2 Transaction boundary

Application service sering menjadi transaction boundary:

```java
@Transactional
public EscalateCaseResult handle(EscalateCase command) {
    ...
}
```

Namun domain core tidak perlu tahu `@Transactional`.

## 12.3 Idempotency

Application service cocok untuk idempotency:

```java
public EscalateCaseResult handle(EscalateCase command) {
    return idempotency.run(command.idempotencyKey(), () -> doHandle(command));
}
```

Domain model tidak perlu tahu HTTP retry, tetapi command identity dapat dibawa untuk audit/causality.

## 12.4 Authorization

Authorization biasanya application/security layer:

```java
authorizer.requireCanEscalate(actor, command.caseId());
```

Tetapi domain tetap boleh punya rule:

```text
Only assigned officer can close case.
```

Jika rule itu adalah business invariant, masukkan ke policy/domain.

---

# 13. Repository

Repository adalah abstraction untuk mengambil dan menyimpan aggregate.

```java
public interface CaseRepository {
    EnforcementCase get(CaseId id);
    void save(EnforcementCase caseRecord);
}
```

Domain/application melihat repository sebagai collection-like abstraction, bukan SQL abstraction.

## 13.1 Repository returns aggregate

Jangan return persistence entity jika domain aggregate terpisah.

```java
EnforcementCase get(CaseId id);
```

bukan:

```java
CaseJpaEntity findEntity(CaseId id);
```

di application/domain core.

## 13.2 Query repository vs command repository

Untuk write model:

```java
interface CaseRepository {
    EnforcementCase get(CaseId id);
    void save(EnforcementCase caseRecord);
}
```

Untuk read model:

```java
interface CaseQueryService {
    CaseDetailView findDetail(CaseId id);
    Page<CaseSummaryView> search(CaseSearchCriteria criteria);
}
```

Jangan paksa aggregate untuk semua read query. Read model boleh optimized.

## 13.3 Repository should not hide business decisions

Buruk:

```java
repository.escalateCase(id, severity);
```

Ini memindahkan domain behavior ke repository/database.

Lebih baik:

```java
caseRecord.escalate(command, policy, clock);
repository.save(caseRecord);
```

## 13.4 Persistence exceptions

Repository interface domain/application sebaiknya tidak membocorkan exception spesifik database.

Adapter boleh translate:

```java
catch (DataIntegrityViolationException e) {
    throw new DuplicateCaseNumber(caseNumber, e);
}
```

## 13.5 Optimistic locking

Repository `save` harus menjaga version.

Conceptual:

```sql
UPDATE cases
SET status = ?, severity = ?, version = version + 1
WHERE id = ? AND version = ?
```

Jika affected rows = 0:

```java
throw new ConcurrentCaseModification(caseId);
```

---

# 14. Policy, Specification, Strategy, dan Rule Object

Business rules sering berubah. Jangan semua rule masuk `if` panjang di service.

## 14.1 Policy

Policy menentukan keputusan.

```java
public interface EscalationPolicy {
    void validate(EnforcementCase caseRecord, EscalateCase command);
}
```

Implementation:

```java
public final class DefaultEscalationPolicy implements EscalationPolicy {
    @Override
    public void validate(EnforcementCase caseRecord, EscalateCase command) {
        if (!caseRecord.status().allowsEscalation()) {
            throw new InvalidCaseTransition(caseRecord.id(), caseRecord.status(), CaseAction.ESCALATE);
        }

        if (!command.newSeverity().isHigherThan(caseRecord.severity())) {
            throw new EscalationMustIncreaseSeverity(caseRecord.id());
        }
    }
}
```

## 14.2 Specification

Specification adalah predicate domain yang bisa dicompose.

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);

    default Specification<T> and(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) && other.isSatisfiedBy(candidate);
    }

    default Specification<T> or(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) || other.isSatisfiedBy(candidate);
    }

    default Specification<T> not() {
        return candidate -> !this.isSatisfiedBy(candidate);
    }
}
```

Example:

```java
public final class CaseIsEscalatable implements Specification<EnforcementCase> {
    @Override
    public boolean isSatisfiedBy(EnforcementCase c) {
        return c.status().allowsEscalation();
    }
}
```

## 14.3 Strategy

Strategy memilih algorithm yang interchangeable.

Contoh:

```java
public interface RiskScoringStrategy {
    RiskScore score(EnforcementCase caseRecord, ComplianceHistory history);
}
```

Implementasi:

- rule-based;
- weighted score;
- ML-backed;
- jurisdiction-specific;
- versioned policy.

## 14.4 Rule object

Rule object membuat rule eksplisit dan testable.

```java
public interface CaseRule {
    Optional<RuleViolation> evaluate(EnforcementCase caseRecord);
}
```

```java
public final class MandatoryEvidenceBeforeClosureRule implements CaseRule {
    @Override
    public Optional<RuleViolation> evaluate(EnforcementCase caseRecord) {
        if (caseRecord.hasMandatoryEvidence()) {
            return Optional.empty();
        }
        return Optional.of(new RuleViolation("MANDATORY_EVIDENCE_MISSING"));
    }
}
```

## 14.5 Rules with explanations

Untuk sistem regulatori, rule tidak cukup boolean. Butuh explanation.

```java
public record PolicyDecision(
    boolean allowed,
    String code,
    String explanation,
    List<EvidenceReference> evidence
) {}
```

Baik untuk audit:

```text
Escalation denied because severity did not increase.
```

bukan hanya:

```text
Invalid request.
```

---

# 15. State Machine Modeling

Lifecycle domain sering lebih tepat dimodelkan sebagai state machine.

Contoh status case:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
ESCALATED
RESOLVED
CLOSED
REJECTED
```

## 15.1 State machine terdiri dari

- states;
- commands/actions;
- transitions;
- guards;
- effects;
- events;
- audit.

```text
state + command + guard -> new state + event/effect
```

## 15.2 Enum sederhana

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    RESOLVED,
    CLOSED,
    REJECTED;

    public boolean allowsEscalation() {
        return this == UNDER_REVIEW || this == ESCALATED;
    }
}
```

Cocok jika:

- behavior kecil;
- transition tidak terlalu kompleks;
- state tidak punya data berbeda-beda.

## 15.3 Transition table

```java
public enum CaseAction {
    SUBMIT,
    ASSIGN,
    ESCALATE,
    RESOLVE,
    CLOSE,
    REJECT
}
```

```java
public record Transition(CaseStatus from, CaseAction action, CaseStatus to) {}
```

```java
public final class CaseTransitionPolicy {
    private static final Set<Transition> ALLOWED = Set.of(
        new Transition(CaseStatus.DRAFT, CaseAction.SUBMIT, CaseStatus.SUBMITTED),
        new Transition(CaseStatus.SUBMITTED, CaseAction.ASSIGN, CaseStatus.UNDER_REVIEW),
        new Transition(CaseStatus.UNDER_REVIEW, CaseAction.ESCALATE, CaseStatus.ESCALATED),
        new Transition(CaseStatus.RESOLVED, CaseAction.CLOSE, CaseStatus.CLOSED)
    );

    public CaseStatus next(CaseStatus from, CaseAction action) {
        return ALLOWED.stream()
            .filter(t -> t.from() == from && t.action() == action)
            .map(Transition::to)
            .findFirst()
            .orElseThrow(() -> new InvalidTransition(from, action));
    }
}
```

For performance, use `EnumMap<CaseStatus, EnumMap<CaseAction, CaseStatus>>`.

## 15.4 Sealed state hierarchy

Jika setiap state punya data/behavior berbeda, gunakan sealed types.

```java
public sealed interface CaseLifecycleState
        permits Draft, Submitted, UnderReview, Escalated, Resolved, Closed, Rejected {
}

public record Draft(Instant createdAt) implements CaseLifecycleState {}
public record Submitted(Instant submittedAt, OfficerId submittedBy) implements CaseLifecycleState {}
public record UnderReview(OfficerId assignedOfficer, Instant assignedAt) implements CaseLifecycleState {}
public record Escalated(Severity severity, EscalationReason reason, Instant escalatedAt) implements CaseLifecycleState {}
public record Resolved(Resolution resolution, Instant resolvedAt) implements CaseLifecycleState {}
public record Closed(ClosureReason reason, Instant closedAt) implements CaseLifecycleState {}
public record Rejected(RejectionReason reason, Instant rejectedAt) implements CaseLifecycleState {}
```

Keuntungan:

- state-specific data explicit;
- illegal field combinations hilang;
- pattern matching exhaustive;
- state transition lebih type-safe.

## 15.5 Pattern matching untuk state handling

```java
public boolean isTerminal(CaseLifecycleState state) {
    return switch (state) {
        case Closed ignored -> true;
        case Rejected ignored -> true;
        case Draft ignored -> false;
        case Submitted ignored -> false;
        case UnderReview ignored -> false;
        case Escalated ignored -> false;
        case Resolved ignored -> false;
    };
}
```

Jika ada state baru, compiler dapat membantu menemukan switch yang belum exhaustive.

## 15.6 Guard vs effect

Jangan campur guard dan effect.

Guard:

```text
apakah transition boleh?
```

Effect:

```text
apa yang terjadi setelah transition?
```

Contoh:

```java
policy.validateCanClose(caseRecord, command); // guard
caseRecord.applyClosed(command, clock);       // state mutation
events.add(new CaseClosed(...));              // effect/event
```

## 15.7 State transition audit

Setiap transition penting sebaiknya menghasilkan event/audit.

```java
public record CaseStateChanged(
    CaseId caseId,
    CaseStatus from,
    CaseStatus to,
    CaseAction action,
    ActorId actor,
    String reason,
    Instant occurredAt,
    long version
) implements DomainEvent {}
```

---

# 16. Command, Event, Query, dan Causality

## 16.1 Command

Command adalah intent/request.

```java
public record EscalateCase(
    CommandId commandId,
    CaseId caseId,
    OfficerId officerId,
    Severity newSeverity,
    EscalationReason reason,
    Instant requestedAt
) {}
```

Command properties:

- imperative;
- may fail;
- usually processed once/idempotently;
- carries actor/context;
- can be rejected;
- can produce events.

Naming:

```text
OpenCase
AssignCase
EscalateCase
CloseCase
RejectCase
```

## 16.2 Event

Event adalah fact.

```java
public record CaseEscalated(
    EventId eventId,
    CaseId caseId,
    Severity previousSeverity,
    Severity newSeverity,
    OfficerId escalatedBy,
    EscalationReason reason,
    Instant occurredAt,
    long aggregateVersion
) implements DomainEvent {}
```

Event properties:

- past tense;
- already happened;
- immutable;
- should not be “failed” after emitted;
- carries causality metadata;
- useful for audit/integration/projection.

Naming:

```text
CaseOpened
CaseAssigned
CaseEscalated
CaseClosed
CaseRejected
```

## 16.3 Query

Query asks for data and should not mutate state.

```java
public record FindCaseDetail(CaseId caseId) {}
```

Query result can be read model:

```java
public record CaseDetailView(
    String id,
    String status,
    String severity,
    String assignedOfficer,
    Instant updatedAt
) {}
```

## 16.4 Causality metadata

Useful metadata:

```java
public record Causation(
    CommandId commandId,
    CorrelationId correlationId,
    ActorId actorId,
    Instant requestedAt
) {}
```

Event can include:

```java
CommandId causedByCommandId
CorrelationId correlationId
```

This helps answer:

```text
Why did this event happen?
Which request caused it?
Which workflow does it belong to?
Who initiated it?
```

## 16.5 Command result

Command result should be explicit.

```java
public sealed interface CommandResult permits CommandAccepted, CommandRejected {}

public record CommandAccepted(List<DomainEvent> events) implements CommandResult {}
public record CommandRejected(RejectionReason reason) implements CommandResult {}
```

Or for application:

```java
public record EscalateCaseResult(
    CaseId caseId,
    CaseStatus status,
    Severity severity,
    long version
) {}
```

---

# 17. Domain Event dan Integration Event

## 17.1 Domain event

Domain event lives inside domain/application boundary.

```java
public interface DomainEvent {
    EventId eventId();
    Instant occurredAt();
}
```

## 17.2 Integration event

Integration event is published to other systems.

It often has:

- stable schema;
- version;
- external naming;
- compatibility rules;
- no internal-only fields;
- no sensitive data unless allowed.

Example:

```java
public record CaseEscalatedIntegrationEvent(
    String eventId,
    String caseId,
    String severity,
    String occurredAt,
    int schemaVersion
) {}
```

## 17.3 Do not expose domain event blindly

Domain event may contain internal details. Integration event should be a published contract.

Mapping:

```text
Domain Event → Integration Event
```

## 17.4 Outbox pattern

If aggregate update and event publish must be consistent:

```text
transaction:
  update aggregate
  insert outbox event
commit

separate publisher:
  reads outbox
  publishes to broker
  marks as sent
```

This avoids:

```text
DB commit success, broker publish failure
```

## 17.5 Event ordering

For aggregate events, include:

```java
long aggregateVersion
```

Consumers can detect:

- duplicate;
- out-of-order;
- missing event.

## 17.6 Event evolution

Events are contracts. Design for:

- additive fields;
- default values;
- schema version;
- consumer tolerance;
- deprecation;
- no rename without migration;
- no semantic change hidden behind same field.

---

# 18. Error Modeling dengan Java

Domain error harus berbeda dari technical error.

## 18.1 Exception approach

```java
public final class InvalidCaseTransition extends RuntimeException {
    private final CaseId caseId;
    private final CaseStatus currentStatus;
    private final CaseAction action;

    public InvalidCaseTransition(CaseId caseId, CaseStatus currentStatus, CaseAction action) {
        super("Cannot apply action %s to case %s in status %s".formatted(action, caseId.value(), currentStatus));
        this.caseId = caseId;
        this.currentStatus = currentStatus;
        this.action = action;
    }
}
```

Good for:

- fail-fast invariant violation;
- simple API;
- transaction rollback;
- exceptional domain rejection.

## 18.2 Result type approach

```java
public sealed interface DomainResult<T> permits DomainSuccess, DomainFailure {}

public record DomainSuccess<T>(T value) implements DomainResult<T> {}
public record DomainFailure<T>(DomainError error) implements DomainResult<T> {}

public sealed interface DomainError permits InvalidTransition, MissingEvidence, UnauthorizedActor {}

public record InvalidTransition(CaseStatus from, CaseAction action) implements DomainError {}
public record MissingEvidence(CaseId caseId) implements DomainError {}
public record UnauthorizedActor(ActorId actorId) implements DomainError {}
```

Good for:

- expected business rejection;
- explicit branching;
- no exception control flow;
- batch validation;
- functional style.

Trade-off:

- more verbose;
- caller must handle result;
- can be ignored if API poorly designed.

## 18.3 Sealed error hierarchy

```java
public sealed interface CloseCaseError
        permits CaseAlreadyClosed, MissingMandatoryEvidence, ActorNotAssigned {
}

public record CaseAlreadyClosed(CaseId caseId) implements CloseCaseError {}
public record MissingMandatoryEvidence(CaseId caseId, List<EvidenceType> missing) implements CloseCaseError {}
public record ActorNotAssigned(CaseId caseId, ActorId actorId) implements CloseCaseError {}
```

Pattern matching:

```java
String message(CloseCaseError error) {
    return switch (error) {
        case CaseAlreadyClosed e -> "Case already closed";
        case MissingMandatoryEvidence e -> "Missing evidence: " + e.missing();
        case ActorNotAssigned e -> "Actor is not assigned";
    };
}
```

## 18.4 Domain rejection vs technical failure

| Category | Example | Handling |
|---|---|---|
| domain rejection | invalid transition | return 409/422, no retry |
| validation error | blank reason | return 400 |
| authorization error | actor cannot close | return 403 |
| not found | case missing | return 404 |
| concurrency conflict | version mismatch | return 409, maybe retry |
| transient technical | DB timeout | retry maybe |
| permanent technical | schema missing | alert/fail |
| fatal | OOM | restart/investigate |

Don't mix all into:

```java
throw new RuntimeException("failed");
```

---

# 19. API Surface Design untuk Domain Core

## 19.1 Minimal public API

Expose only what domain users need.

```java
public final class EnforcementCase {
    public CaseId id() {}
    public CaseStatus status() {}
    public Severity severity() {}

    public CaseEscalated escalate(...) {}
    public CaseClosed close(...) {}
}
```

Avoid:

```java
public void setStatus(...)
public void setSeverity(...)
public List<Note> getMutableNotes()
```

## 19.2 Defensive copy

```java
public List<CaseNote> notes() {
    return List.copyOf(notes);
}
```

## 19.3 Null policy

Domain core should avoid null.

Use:

- required constructor args;
- value objects;
- `Optional` for absence return;
- domain-specific type;
- Null Object only if meaningful.

Avoid fields:

```java
private String closedReason; // null if not closed
```

With sealed state:

```java
record Closed(ClosureReason reason, Instant closedAt) implements CaseState {}
```

Now reason exists only for closed state.

## 19.4 Optional policy

Good:

```java
public Optional<OfficerId> assignedOfficer()
```

Bad:

```java
public void assign(Optional<OfficerId> officer)
```

Parameters should usually be concrete. Optional is better for return values.

## 19.5 Time policy

Never call `Instant.now()` directly in domain behavior if you need testability/audit consistency.

Use:

```java
Clock clock
```

```java
Instant now = clock.instant();
```

## 19.6 ID policy

Prefer typed IDs:

```java
public record CaseId(UUID value) {}
public record OfficerId(String value) {}
```

Avoid:

```java
String id
```

because ID mix-ups are common and compiler cannot help.

---

# 20. Immutability, Mutability, dan Encapsulation

## 20.1 Value objects immutable

Value objects should be immutable.

Use records where appropriate.

## 20.2 Entities may be mutable internally

Entity lifecycle needs state changes.

But mutability should be encapsulated:

```java
private CaseStatus status;
```

not:

```java
public CaseStatus status;
```

## 20.3 Immutable aggregate alternative

Some teams prefer immutable aggregates:

```java
public record EnforcementCase(
    CaseId id,
    CaseStatus status,
    Severity severity,
    long version
) {
    public EnforcementCase escalate(...) {
        return new EnforcementCase(id, CaseStatus.ESCALATED, newSeverity, version + 1);
    }
}
```

Pros:

- easier reasoning;
- no accidental mutation;
- functional style;
- event sourcing friendly.

Cons:

- more allocation;
- persistence mapping friction;
- large aggregate copy;
- Java ergonomics sometimes verbose.

## 20.4 Mutable aggregate with controlled mutation

Common in enterprise Java:

```java
public final class EnforcementCase {
    private CaseStatus status;

    public CaseEscalated escalate(...) {
        ...
        this.status = CaseStatus.ESCALATED;
        ...
    }
}
```

This is fine if mutation is only through behavior methods.

## 20.5 Encapsulation is not getter/setter generation

Encapsulation means object protects its invariant.

A class with private fields and public setters for everything is not truly encapsulated.

---

# 21. Java Modern untuk Domain Modeling

## 21.1 Records

Good for:

- value object;
- command;
- event;
- query;
- result;
- DTO;
- immutable data carrier;
- composite key;
- policy decision.

Example:

```java
public record AssignCase(
    CommandId commandId,
    CaseId caseId,
    OfficerId officerId,
    AssignmentReason reason,
    ActorId actorId
) {
    public AssignCase {
        Objects.requireNonNull(commandId);
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(officerId);
        Objects.requireNonNull(reason);
        Objects.requireNonNull(actorId);
    }
}
```

Not ideal for:

- entity with lifecycle mutation;
- object needing hidden representation different from API;
- behavior-heavy class with complex invariants over time;
- JPA entity in many setups.

## 21.2 Sealed types

Good for:

- closed set of states;
- closed set of commands;
- closed set of domain errors;
- closed set of events in module;
- workflow alternatives;
- decision outcomes.

Example:

```java
public sealed interface CaseCommand
        permits OpenCase, AssignCase, EscalateCase, CloseCase, RejectCase {
    CommandId commandId();
    CaseId caseId();
}
```

## 21.3 Pattern matching switch

```java
public CommandResult handle(CaseCommand command) {
    return switch (command) {
        case OpenCase c -> open(c);
        case AssignCase c -> assign(c);
        case EscalateCase c -> escalate(c);
        case CloseCase c -> close(c);
        case RejectCase c -> reject(c);
    };
}
```

With sealed command hierarchy, compiler helps ensure all commands are handled.

## 21.4 Record patterns

Useful for deconstructing nested values.

```java
public record Address(String postalCode, String street) {}
public record Respondent(String name, Address address) {}

public boolean isLocalRespondent(Respondent respondent) {
    return switch (respondent) {
        case Respondent(var name, Address(var postalCode, var street))
            when postalCode.startsWith("10") -> true;
        default -> false;
    };
}
```

Use sparingly; don't make business logic unreadable with deeply nested patterns.

## 21.5 Enum still useful

Enum is perfect for fixed constants:

```java
public enum Severity {
    LOW(1),
    MEDIUM(2),
    HIGH(3),
    CRITICAL(4);

    private final int rank;

    Severity(int rank) {
        this.rank = rank;
    }

    public boolean isHigherThan(Severity other) {
        return this.rank > other.rank;
    }
}
```

## 21.6 When not to use sealed/records

Don't use sealed types everywhere.

Use sealed when alternatives are intentionally closed. If extension by external modules/plugins is expected, use normal interface.

Don't use records for mutable lifecycle entity just because concise.

---

# 22. Package, Module, dan Dependency Direction

## 22.1 Package by domain boundary

Instead of:

```text
controller/
service/
repository/
entity/
dto/
```

Consider:

```text
case/
  domain/
  application/
  infrastructure/
  api/
assignment/
  domain/
  application/
  infrastructure/
```

Or context-level:

```text
enforcement/
  case/
  assignment/
  decision/
  evidence/
```

## 22.2 Dependency direction

Clean direction:

```text
api → application → domain
infrastructure → application/domain ports
domain → no framework
```

Domain should not depend on:

- Spring;
- JPA;
- Jackson;
- Kafka;
- HTTP;
- database driver.

## 22.3 Ports

```java
public interface CaseRepository {
    EnforcementCase get(CaseId id);
    void save(EnforcementCase caseRecord);
}
```

Infrastructure implements:

```java
@Repository
final class JpaCaseRepository implements CaseRepository {
    ...
}
```

## 22.4 Package-private for internal details

Java package-private is powerful.

```java
final class CaseTransitionRules {
    ...
}
```

Only expose public API needed outside package.

## 22.5 JPMS module boundary

For larger systems:

```java
module com.example.enforcement.case {
    exports com.example.enforcement.case.application;
    exports com.example.enforcement.case.domain.api;

    requires java.base;
}
```

Keep internal domain implementation unexported if possible.

---

# 23. Persistence Boundary: JPA, JDBC, dan Domain Model

## 23.1 Three common approaches

### Approach A — JPA entity as domain entity

Pros:

- less mapping;
- common in Spring apps;
- faster initial development.

Cons:

- domain polluted with JPA annotations;
- lazy loading leaks;
- no-arg constructor/setters pressure;
- entity lifecycle tied to persistence context;
- serialization temptation.

### Approach B — separate persistence entity and domain aggregate

Pros:

- pure domain;
- persistence flexibility;
- easier testing;
- no framework leakage.

Cons:

- mapping overhead;
- more classes;
- performance mapping cost;
- risk of mapper bugs.

### Approach C — pragmatic hybrid

Use JPA annotations but keep behavior/invariant in entity and avoid exposing it as API DTO.

Pros:

- pragmatic;
- less mapping.

Cons:

- must be disciplined.

## 23.2 Recommended default for complex domain

For business-rule-heavy system:

```text
domain aggregate separate from persistence model
```

Especially when:

- lifecycle complex;
- audit critical;
- persistence schema legacy;
- multiple read models;
- event sourcing/outbox;
- regulatory defensibility;
- integration model differs.

## 23.3 Mapper

```java
final class CasePersistenceMapper {
    EnforcementCase toDomain(CaseJpaEntity entity) {
        ...
    }

    CaseJpaEntity toEntity(EnforcementCase domain) {
        ...
    }
}
```

Mapper should not contain business decisions. It maps representation.

## 23.4 Avoid lazy loading in domain logic

Domain logic should operate on loaded aggregate data.

Do not let domain method accidentally trigger DB query through lazy proxy.

## 23.5 Database constraints still matter

Domain invariant should be backed by database constraints where possible:

- unique case number;
- not null;
- foreign key;
- optimistic version;
- check constraints;
- idempotency key unique;
- event unique ID.

Defense in depth:

```text
domain validation + database constraint + test
```

---

# 24. Transaction Boundary dan Consistency

## 24.1 Aggregate boundary and transaction boundary

Usually:

```text
one aggregate change = one transaction
```

But not always. Application service may update multiple aggregates, but beware complexity.

## 24.2 Strong consistency

Use when invariant must be immediately true.

Examples:

- cannot close case without mandatory evidence;
- version conflict;
- unique case number;
- idempotency key.

Mechanisms:

- DB transaction;
- row lock;
- optimistic locking;
- unique constraints;
- serializable isolation when justified.

## 24.3 Eventual consistency

Use when delayed update acceptable.

Examples:

- send notification;
- update analytics;
- sync search index;
- generate report;
- notify external agency.

Mechanisms:

- outbox;
- domain event handler;
- message broker;
- projection;
- retry;
- DLQ.

## 24.4 Saga/process manager

For multi-step long-running process:

```text
Case escalated
  → request supervisor review
  → wait for decision
  → if approved assign specialist
  → if rejected revert/record decision
```

Use process manager/saga when workflow crosses aggregate/context boundaries and cannot be one DB transaction.

## 24.5 Idempotency

Every externally retried command should have idempotency.

```java
public record CommandId(UUID value) {}
```

Application service:

```text
if commandId already processed:
  return previous result
else:
  process and store command result atomically
```

## 24.6 Optimistic conflict

If two officers update same case:

```text
read version 10
both modify
first save succeeds -> version 11
second save fails WHERE version=10
```

Return conflict:

```java
throw new ConcurrentCaseModification(caseId);
```

Or retry if operation is safe and deterministic.

---

# 25. Auditability dan Regulatory Defensibility

In regulated systems, correctness is not enough. You must prove correctness.

## 25.1 Audit trail should answer

For each important domain change:

- what changed?
- from what?
- to what?
- who requested it?
- who approved it?
- when?
- why?
- under which rule/policy version?
- based on which evidence?
- under which correlation/request?
- was it automated or manual?
- what was the previous aggregate version?
- what was the resulting aggregate version?

## 25.2 Audit event

```java
public record CaseAuditEntry(
    AuditId auditId,
    CaseId caseId,
    CaseAction action,
    CaseStatus fromStatus,
    CaseStatus toStatus,
    ActorId actorId,
    String reason,
    PolicyVersion policyVersion,
    List<EvidenceReference> evidenceReferences,
    Instant occurredAt,
    long aggregateVersion,
    CorrelationId correlationId
) {}
```

## 25.3 Domain event vs audit entry

Domain event:

```text
used by domain/application to express fact
```

Audit entry:

```text
used as durable evidence for review/regulatory traceability
```

They can be related but not always identical.

## 25.4 Policy versioning

If rules change over time, record policy version used.

```java
public record PolicyVersion(String value) {}
```

Decision:

```java
public record PolicyDecision(
    boolean allowed,
    String ruleCode,
    PolicyVersion policyVersion,
    String explanation
) {}
```

## 25.5 No silent mutation

Every status change should go through explicit method and event.

Bad:

```java
case.status = CLOSED;
```

Good:

```java
CaseClosed event = case.close(command, policy, clock);
audit.record(event);
```

## 25.6 Evidence-aware decision

For enforcement systems, a decision often depends on evidence.

```java
public record DecisionReason(
    String explanation,
    List<EvidenceReference> supportingEvidence
) {
    public DecisionReason {
        explanation = Objects.requireNonNull(explanation).strip();
        supportingEvidence = List.copyOf(supportingEvidence);

        if (explanation.isBlank()) {
            throw new IllegalArgumentException("explanation is required");
        }
    }
}
```

---

# 26. Testing Domain Model

## 26.1 Domain test should be fast

Domain test should not need:

- Spring context;
- database;
- Kafka;
- HTTP server.

Example:

```java
@Test
void closedCaseCannotBeEscalated() {
    EnforcementCase c = Fixtures.closedCase();

    EscalateCase command = Fixtures.escalateCommand();

    assertThatThrownBy(() -> c.escalate(command, new DefaultEscalationPolicy(), fixedClock))
        .isInstanceOf(InvalidCaseTransition.class);
}
```

## 26.2 Test invariant

For each invariant:

- valid example;
- invalid example;
- boundary value;
- state transition;
- event produced;
- audit metadata.

## 26.3 State transition test table

```java
@ParameterizedTest
@MethodSource("invalidTransitions")
void invalidTransitionsAreRejected(CaseStatus from, CaseAction action) {
    CaseTransitionPolicy policy = new CaseTransitionPolicy();

    assertThatThrownBy(() -> policy.next(from, action))
        .isInstanceOf(InvalidTransition.class);
}
```

## 26.4 Event assertion

```java
CaseEscalated event = caseRecord.escalate(command, policy, fixedClock);

assertThat(event.caseId()).isEqualTo(caseRecord.id());
assertThat(event.previousSeverity()).isEqualTo(Severity.MEDIUM);
assertThat(event.newSeverity()).isEqualTo(Severity.HIGH);
assertThat(event.aggregateVersion()).isEqualTo(11);
```

## 26.5 Property-based testing

Useful for value object invariants and state machines.

Examples:

- date range end never before start;
- severity comparison transitive;
- invalid random strings rejected;
- state transition graph never reaches impossible state.

## 26.6 Golden master for legacy refactor

When refactoring transaction script to domain model:

1. capture existing behavior;
2. write characterization tests;
3. refactor gradually;
4. compare outcomes;
5. document intentional behavior changes.

---

# 27. Refactoring Transaction Script ke Domain Model

Suppose legacy service:

```java
@Transactional
public void closeCase(String id, String actor, String reason) {
    CaseEntity e = repo.findById(id).orElseThrow();

    if (!e.getStatus().equals("RESOLVED")) {
        throw new IllegalStateException("Only resolved case can be closed");
    }

    e.setStatus("CLOSED");
    e.setClosedBy(actor);
    e.setClosedAt(Instant.now());
    e.setCloseReason(reason);

    auditRepo.save(...);
    repo.save(e);
}
```

## 27.1 Step 1 — Introduce value objects

```java
CaseId caseId = new CaseId(UUID.fromString(id));
ActorId actorId = new ActorId(actor);
ClosureReason closureReason = new ClosureReason(reason);
```

## 27.2 Step 2 — Introduce command

```java
public record CloseCase(
    CommandId commandId,
    CaseId caseId,
    ActorId actorId,
    ClosureReason reason
) {}
```

## 27.3 Step 3 — Move rule into domain

```java
public CaseClosed close(CloseCase command, Clock clock) {
    if (status != CaseStatus.RESOLVED) {
        throw new InvalidCaseTransition(id, status, CaseAction.CLOSE);
    }

    CaseStatus previous = status;
    status = CaseStatus.CLOSED;
    closedBy = command.actorId();
    closedAt = clock.instant();
    closeReason = command.reason();

    return new CaseClosed(id, previous, status, command.actorId(), command.reason(), closedAt, nextVersion());
}
```

## 27.4 Step 4 — Application service orchestrates

```java
@Transactional
public CloseCaseResult handle(CloseCase command) {
    EnforcementCase c = repository.get(command.caseId());

    CaseClosed event = c.close(command, clock);

    repository.save(c);
    audit.record(event);
    outbox.append(event);

    return new CloseCaseResult(c.id(), c.status(), c.version());
}
```

## 27.5 Step 5 — Add tests

- cannot close draft;
- cannot close open;
- can close resolved;
- event contains previous/new status;
- reason required;
- version increments.

## 27.6 Step 6 — Remove setters

Once behavior methods cover lifecycle, make setters private/remove them.

---

# 28. Anti-Patterns

## 28.1 Anemic domain model

Entity only has getters/setters. All rules in service.

Symptom:

```java
case.setStatus(...)
case.setSeverity(...)
case.setClosedAt(...)
```

Fix:

```java
case.close(...)
case.escalate(...)
case.assign(...)
```

## 28.2 God service

One service handles all:

```text
CaseService
  4000 lines
  open
  assign
  escalate
  close
  notify
  audit
  generate document
  call external systems
  update reports
```

Fix:

- use cases;
- domain policies;
- event handlers;
- repositories;
- process manager;
- adapters.

## 28.3 Primitive obsession

Everything is `String`, `int`, `boolean`.

Fix:

- typed IDs;
- value objects;
- enum;
- sealed types.

## 28.4 Boolean flags for state

Buruk:

```java
boolean approved;
boolean rejected;
boolean closed;
```

Can represent impossible state:

```text
approved=true, rejected=true
```

Fix:

```java
CaseStatus status
```

or sealed state.

## 28.5 Status string

Buruk:

```java
if (status.equals("CLS")) ...
```

Fix:

```java
enum CaseStatus
```

with translator at boundary.

## 28.6 Entity exposes mutable collection

Buruk:

```java
public List<Note> notes() { return notes; }
```

Fix:

```java
public List<Note> notes() { return List.copyOf(notes); }
```

## 28.7 Domain depends on infrastructure

Buruk:

```java
public class Case {
    @Autowired KafkaTemplate kafka;
}
```

Domain should not know Kafka.

## 28.8 Business rule hidden in SQL

Some constraints belong in DB, but if all business meaning is in SQL/stored procedure, Java domain becomes blind.

Use DB constraints as defense, not as only model.

## 28.9 Event as mutable DTO

Events should be immutable facts.

Use record.

## 28.10 Over-DDD

Not every CRUD module needs rich domain model.

For simple admin reference data, transaction script may be enough.

Use domain modeling where complexity justifies it.

---

# 29. Code Review Checklist

## 29.1 Language and modeling

- [ ] Domain terms match business language?
- [ ] Important concepts have names/types?
- [ ] Primitive obsession avoided?
- [ ] Status/lifecycle explicit?
- [ ] Commands/events named correctly?

## 29.2 Invariant

- [ ] Invariants enforced in value object/entity/policy?
- [ ] Illegal state difficult/impossible?
- [ ] Setters not bypassing rules?
- [ ] Cross-field rules tested?
- [ ] Temporal rules tested?

## 29.3 Aggregate

- [ ] Aggregate boundary based on consistency?
- [ ] Aggregate not too large?
- [ ] Changes go through aggregate root?
- [ ] Versioning/concurrency handled?
- [ ] Child collections protected?

## 29.4 Application service

- [ ] Orchestration only?
- [ ] Transaction boundary clear?
- [ ] Idempotency considered?
- [ ] Authorization boundary clear?
- [ ] Domain events persisted/published safely?

## 29.5 Persistence

- [ ] Domain not polluted unnecessarily?
- [ ] Repository abstraction clean?
- [ ] Read model separated if needed?
- [ ] DB constraints support invariants?
- [ ] Optimistic locking handled?

## 29.6 Events/audit

- [ ] Domain events immutable?
- [ ] Integration events versioned?
- [ ] Audit captures actor/time/reason/state/version?
- [ ] Causation/correlation present?
- [ ] Sensitive data controlled?

## 29.7 Errors

- [ ] Domain rejection distinct from technical failure?
- [ ] Error messages useful?
- [ ] Sealed error/result considered for expected failures?
- [ ] Exceptions not too generic?

## 29.8 Tests

- [ ] Domain tests fast/no framework?
- [ ] State transition tests?
- [ ] Invalid cases tested?
- [ ] Event contents tested?
- [ ] Concurrency conflict tested?

---

# 30. Latihan Bertahap

## Latihan 1 — Typed IDs

Refactor method:

```java
void assign(String caseId, String officerId)
```

menjadi:

```java
void assign(CaseId caseId, OfficerId officerId)
```

Tambahkan validation.

## Latihan 2 — Value object

Buat:

- `CaseTitle`;
- `EscalationReason`;
- `ClosureReason`;
- `EvidenceReference`;
- `PolicyVersion`.

Pastikan immutable dan valid.

## Latihan 3 — Enum status transition

Buat `CaseTransitionPolicy` dengan transition table.

Test semua valid/invalid transition.

## Latihan 4 — Sealed state

Model lifecycle dengan sealed state:

```java
Draft
Submitted
UnderReview
Escalated
Resolved
Closed
Rejected
```

Buat `isTerminal`, `canEscalate`, `displayLabel`.

## Latihan 5 — Aggregate behavior

Buat aggregate:

```java
EnforcementCase
```

Behavior:

- submit;
- assign;
- escalate;
- resolve;
- close;
- reject.

Setiap behavior menghasilkan domain event.

## Latihan 6 — Application service

Buat use case:

```java
EscalateCaseUseCase
```

Dengan fake repository dan fake event publisher.

Test orchestration.

## Latihan 7 — Outbox

Tambahkan `OutboxRepository`.

Dalam transaction:

```text
save aggregate + append outbox event
```

## Latihan 8 — Audit trail

Tambahkan audit entry untuk setiap status change.

Pastikan audit menyimpan:

- from/to status;
- action;
- actor;
- reason;
- occurredAt;
- version;
- correlationId.

## Latihan 9 — Policy version

Buat dua policy:

- `EscalationPolicyV1`;
- `EscalationPolicyV2`.

Event/audit harus mencatat policy version yang dipakai.

## Latihan 10 — Legacy refactor

Ambil service method CRUD panjang. Refactor bertahap:

1. introduce value object;
2. introduce command;
3. move invariant;
4. create aggregate;
5. publish domain event;
6. add tests.

---

# 31. Mini Project: Enforcement Case Lifecycle Model

## 31.1 Goal

Bangun domain core Java untuk enforcement/case lifecycle.

No Spring. No database. Pure Java domain model.

## 31.2 Package structure

```text
src/main/java/com/example/enforcement/casecore/
  domain/
    model/
    command/
    event/
    error/
    policy/
    service/
  application/
    port/
    usecase/
  test/
```

## 31.3 Domain concepts

Value objects:

- `CaseId`;
- `CommandId`;
- `EventId`;
- `ActorId`;
- `OfficerId`;
- `CaseTitle`;
- `EscalationReason`;
- `ClosureReason`;
- `RejectionReason`;
- `PolicyVersion`;
- `CorrelationId`.

Enums:

- `Severity`;
- `CaseStatus`;
- `CaseAction`;
- `EvidenceType`.

Aggregate:

- `EnforcementCase`.

Commands:

- `OpenCase`;
- `SubmitCase`;
- `AssignCase`;
- `EscalateCase`;
- `ResolveCase`;
- `CloseCase`;
- `RejectCase`.

Events:

- `CaseOpened`;
- `CaseSubmitted`;
- `CaseAssigned`;
- `CaseEscalated`;
- `CaseResolved`;
- `CaseClosed`;
- `CaseRejected`;
- `CaseAuditRecorded`.

Policies:

- `AssignmentPolicy`;
- `EscalationPolicy`;
- `ClosurePolicy`.

Errors:

- `InvalidCaseTransition`;
- `MissingMandatoryEvidence`;
- `UnauthorizedCaseAction`;
- `EscalationMustIncreaseSeverity`;
- `CaseAlreadyTerminal`.

## 31.4 Rules

1. Draft case can be submitted.
2. Submitted case can be assigned.
3. Only assigned case can be escalated.
4. Escalation must increase severity.
5. Critical case cannot be closed without mandatory evidence.
6. Resolved case can be closed.
7. Closed/rejected case is terminal.
8. Every status change emits event.
9. Every status change records audit metadata.
10. Version increments exactly once per state-changing command.

## 31.5 Application use cases

- `OpenCaseUseCase`;
- `AssignCaseUseCase`;
- `EscalateCaseUseCase`;
- `CloseCaseUseCase`.

Ports:

```java
public interface CaseRepository {
    EnforcementCase get(CaseId id);
    void save(EnforcementCase caseRecord);
}

public interface DomainEventStore {
    void appendAll(List<DomainEvent> events);
}
```

## 31.6 Test requirements

- 100% tests for transition matrix;
- invalid command rejected;
- event content exact;
- audit metadata exact;
- version monotonic;
- no mutable collection leak;
- no dependency on Spring/database.

## 31.7 Stretch goals

- Add optimistic locking simulation.
- Add outbox mapping.
- Add integration event mapper.
- Add state machine visualization export.
- Add property-based tests.
- Add policy versioning.
- Add migration from enum state to sealed state.

## 31.8 Reflection questions

1. Which invariants belong in value objects?
2. Which invariants belong in aggregate?
3. Which rules belong in policy?
4. Which operations require strong consistency?
5. Which effects can be eventual?
6. Which event fields are needed for audit?
7. Which event fields are safe for integration?
8. What happens under duplicate command?
9. What happens under concurrent update?
10. How would you explain a case transition to an auditor?

---

# 32. Referensi

Referensi konseptual dan teknis yang relevan:

1. Java Language Specification SE 25 — class, interface, enum, record, sealed, switch, pattern matching semantics.
2. Oracle Java SE 25 Language Changes Summary — Java modern features including records, sealed classes, record patterns, pattern matching for switch, module imports, and Java 25 language changes.
3. JEP 395 — Records.
4. JEP 409 — Sealed Classes.
5. JEP 440 — Record Patterns.
6. JEP 441 — Pattern Matching for switch.
7. Oracle Java SE 25 Pattern Matching with switch documentation.
8. Martin Fowler — Domain-Driven Design.
9. Martin Fowler — Value Object.
10. Martin Fowler — Bounded Context.
11. Microsoft Architecture Guide — Domain events design and implementation.
12. Eric Evans — Domain-Driven Design: Tackling Complexity in the Heart of Software.
13. Vaughn Vernon — Implementing Domain-Driven Design.
14. Vaughn Vernon — Domain-Driven Design Distilled.
15. Alberto Brandolini — EventStorming.
16. Greg Young — CQRS/Event Sourcing writings.
17. Enterprise Integration Patterns — messaging/event integration patterns.

---

# Penutup

Domain modeling dengan Java bukan tentang membuat class lebih banyak. Tujuannya adalah membuat domain knowledge eksplisit, terstruktur, dan terlindungi.

Java modern memberi alat yang sangat kuat:

```text
record        → value object, command, event, result
enum          → finite constants
sealed        → closed alternatives/state/error
switch pattern→ exhaustive decision
class         → entity/aggregate with lifecycle
package/module→ boundary and encapsulation
```

Namun alat ini hanya membantu jika modelnya benar.

Pertanyaan utama yang harus selalu kamu bawa:

```text
Apa invariant yang harus selalu benar?
Apa state yang legal?
Apa transition yang legal?
Apa command yang boleh gagal?
Apa event yang harus tercatat?
Apa boundary konsistensi?
Apa yang perlu diaudit?
Apa yang harus dicegah compiler?
Apa yang harus dicegah domain object?
Apa yang harus dicegah database?
```

Engineer Java yang kuat tidak hanya menulis service yang “jalan”. Ia membuat model yang bisa dipahami oleh manusia, dibuktikan oleh test, dijaga oleh compiler, dipertahankan oleh database, dan dijelaskan saat audit/incident.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-part-021.md](./learn-java-part-021.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: learn-java-part-023.md](./learn-java-part-023.md)

</div>