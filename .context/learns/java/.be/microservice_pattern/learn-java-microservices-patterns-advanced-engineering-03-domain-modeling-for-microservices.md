# learn-java-microservices-patterns-advanced-engineering-03-domain-modeling-for-microservices

> Series: **Java Microservices Patterns — Advanced Engineering**  
> Part: **03 / 34**  
> Topic: **Domain Modeling for Microservices**  
> Java scope: **Java 8 hingga Java 25**  
> Level: **Advanced / Principal Engineer Track**

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 2 kita membahas **service boundary engineering**: bagaimana memilih batas service berdasarkan capability, ownership, data, invariant, workflow, dan change coupling.

Part 3 masuk lebih dalam ke pertanyaan berikut:

> Setelah boundary mulai terlihat, **model seperti apa yang harus hidup di dalam service agar microservice tidak berubah menjadi CRUD wrapper, distributed monolith, atau event soup?**

Microservices yang kuat tidak lahir dari jumlah repository, jumlah endpoint, atau jumlah container. Microservices yang kuat lahir dari **model domain yang benar**, yaitu model yang mampu menjelaskan:

1. apa yang sedang terjadi di bisnis,
2. siapa pemilik keputusan,
3. data mana yang menjadi authority,
4. invariant mana yang harus dijaga,
5. perubahan state apa yang legal,
6. event apa yang merupakan fakta,
7. command apa yang merupakan niat,
8. policy apa yang menentukan keputusan,
9. dan bagaimana semua itu tetap dapat berevolusi tanpa menghancurkan sistem.

Domain modeling adalah titik temu antara:

```text
business reality
+ system behavior
+ service boundary
+ transaction boundary
+ data ownership
+ event semantics
+ auditability
+ long-term evolution
```

Tanpa domain model yang kuat, microservices biasanya jatuh ke salah satu bentuk berikut:

```text
1. CRUD services around tables
2. Anemic services around DTOs
3. Distributed monolith with HTTP calls
4. Event-driven chaos
5. Shared-database pseudo-microservices
6. Workflow hidden across many services
7. Business rules scattered across controllers, consumers, jobs, and UI
```

Part ini adalah fondasi untuk part berikutnya tentang architecture styles, synchronous APIs, asynchronous messaging, event-driven architecture, saga, outbox, consistency, CQRS, workflow, dan state machine.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, targetnya bukan hanya tahu istilah DDD seperti entity, value object, aggregate, event, dan bounded context.

Targetnya adalah mampu:

1. membedakan **data model**, **object model**, **domain model**, dan **integration model**;
2. membangun model yang mencerminkan behavior, bukan hanya struktur tabel;
3. menentukan kapan sesuatu adalah entity, value object, aggregate, domain service, policy, atau process manager;
4. mengidentifikasi invariant dan owner-nya;
5. membedakan command, event, query, policy, rule, dan state transition;
6. menentukan aggregate boundary yang aman untuk microservices;
7. membedakan domain event dan integration event;
8. mendesain model yang tahan terhadap versioning, audit, regulatory change, dan partial failure;
9. menghindari CRUD-centric microservices;
10. membuat domain model yang bisa diimplementasikan di Java 8 sampai Java 25.

---

## 2. Referensi Konseptual

Beberapa fondasi yang relevan:

- Martin Fowler menjelaskan **Bounded Context** sebagai pattern utama dalam strategic Domain-Driven Design untuk membagi model besar dan membuat relasi antar model eksplisit.
- Martin Fowler juga menekankan bahwa DDD memperkenalkan konsep seperti **Entity**, **Value Object**, **Service Object**, dan **Aggregate**, serta strategic design untuk mengorganisasi domain besar ke dalam bounded contexts.
- Microservices.io menempatkan service microservices sebagai unit yang **independently deployable** dan **loosely coupled**, biasanya diorganisasi di sekitar business capability.
- Microsoft Azure Architecture Center menyarankan, sebagai prinsip umum, microservice sebaiknya **tidak lebih kecil dari aggregate dan tidak lebih besar dari bounded context**.
- Microservices.io juga menekankan bahwa domain event, saga, CQRS, dan transactional outbox saling berkaitan ketika business state harus dipropagasikan lintas service.
- OpenJDK menyatakan JDK 25 mencapai General Availability pada 16 September 2025 sebagai reference implementation Java SE 25.

Referensi ini penting karena domain modeling untuk microservices bukan sekadar “gaya coding”. Ia adalah cara mengurangi ambiguity dan menjaga sistem tetap bisa berevolusi.

---

## 3. Masalah Besar: Banyak Microservice Tidak Punya Domain Model

Banyak sistem microservices terlihat modern secara deployment, tetapi primitif secara domain modeling.

Contoh service yang tampak microservice:

```text
application-service
case-service
document-service
notification-service
audit-service
user-service
payment-service
```

Namun implementasinya sering seperti ini:

```java
@RestController
class ApplicationController {
    @PostMapping("/applications")
    ApplicationDto create(@RequestBody ApplicationDto dto) {
        return applicationRepository.save(dto);
    }

    @PutMapping("/applications/{id}/status")
    ApplicationDto updateStatus(@PathVariable Long id, @RequestBody StatusDto dto) {
        ApplicationEntity entity = repository.findById(id).orElseThrow();
        entity.setStatus(dto.status());
        return repository.save(entity);
    }
}
```

Masalahnya bukan pada REST controller. Masalahnya adalah service ini tidak menjelaskan:

```text
Siapa yang boleh membuat application?
Status apa yang valid?
Transition apa yang legal?
Apa invariant-nya?
Apa konsekuensi dari submit?
Apakah submit menghasilkan event?
Apakah status boleh diubah langsung?
Apakah ada audit trail wajib?
Apakah ada workflow SLA?
Apa yang terjadi jika approval gagal?
Apa yang terjadi jika event terkirim dua kali?
```

Jika pertanyaan domain seperti ini tidak punya tempat eksplisit di model, rule akan menyebar ke:

```text
controller
service class
repository query
frontend validation
database trigger
message consumer
batch job
stored procedure
manual operational script
```

Itulah awal dari **distributed business logic erosion**.

---

## 4. Data Model vs Domain Model vs Integration Model

Sebelum masuk lebih jauh, kita perlu membedakan beberapa jenis model.

### 4.1 Data Model

Data model menjawab:

```text
Bagaimana data disimpan?
```

Contoh:

```text
APPLICATION_TABLE
- ID
- APPLICATION_NO
- STATUS
- CREATED_AT
- UPDATED_AT
- APPLICANT_ID
```

Data model penting, tetapi tidak cukup. Ia tidak menjelaskan behavior.

### 4.2 Object Model

Object model menjawab:

```text
Bagaimana struktur objek di program?
```

Contoh:

```java
class Application {
    Long id;
    String applicationNo;
    String status;
    LocalDateTime createdAt;
}
```

Object model juga belum tentu domain model. Banyak object model hanya pantulan tabel.

### 4.3 Domain Model

Domain model menjawab:

```text
Apa konsep bisnisnya, behavior-nya, rule-nya, invariant-nya, dan perubahan state-nya?
```

Contoh:

```java
public final class Application {
    private final ApplicationId id;
    private ApplicationStatus status;
    private final ApplicantId applicantId;
    private final List<DomainEvent> pendingEvents = new ArrayList<>();

    public void submit(SubmissionContext context) {
        if (!status.canSubmit()) {
            throw new InvalidApplicationTransition(id, status, ApplicationAction.SUBMIT);
        }
        if (!context.hasRequiredDocuments()) {
            throw new MissingRequiredDocuments(id);
        }
        this.status = ApplicationStatus.SUBMITTED;
        this.pendingEvents.add(new ApplicationSubmitted(id, applicantId, context.submittedBy(), context.submittedAt()));
    }
}
```

Domain model lebih kaya karena ia membawa behavior.

### 4.4 Integration Model

Integration model menjawab:

```text
Bagaimana fakta/command/query dipertukarkan dengan sistem lain?
```

Contoh event:

```json
{
  "eventId": "evt-123",
  "eventType": "ApplicationSubmitted",
  "schemaVersion": 2,
  "occurredAt": "2026-06-19T10:15:30Z",
  "applicationId": "APP-2026-0001",
  "submittedBy": "user-123"
}
```

Integration model tidak harus sama dengan domain object internal.

### 4.5 Kesalahan Umum

Kesalahan umum di microservices adalah memakai satu model untuk semuanya:

```text
JPA Entity = REST DTO = Kafka Event = Domain Object = UI Model
```

Ini terlihat cepat di awal, tetapi berbahaya karena perubahan internal akan langsung menjadi breaking change eksternal.

Prinsip yang lebih aman:

```text
Internal domain model: optimized for business correctness.
Persistence model: optimized for storage.
API DTO: optimized for client contract.
Event schema: optimized for integration stability.
Read model: optimized for query.
```

---

## 5. Ubiquitous Language: Bahasa Sebagai Arsitektur

Domain model dimulai dari bahasa.

Jika engineer, BA, user, tester, support, dan architect memakai istilah berbeda untuk konsep yang sama, sistem akan menyimpan ambiguity itu sebagai bug.

Contoh ambiguity:

```text
User says: "case closed"
Developer models: status = COMPLETED
Database stores: CASE_STATUS = 'C'
API returns: "done"
Report says: "resolved"
Audit trail says: "terminated"
```

Apakah closed, completed, done, resolved, dan terminated sama?

Mungkin tidak.

Dalam regulatory/case-management system, perbedaan kata bisa penting:

```text
Closed       = proses selesai secara administratif
Resolved     = isu substantif sudah diselesaikan
Withdrawn    = applicant menarik aplikasi
Rejected     = otoritas menolak
Terminated   = sistem menghentikan karena kondisi tertentu
Expired      = waktu habis tanpa action
Cancelled    = dibatalkan sebelum berlaku
Revoked      = hak yang sudah diberikan dicabut
Suspended    = hak sementara dibekukan
```

Top-tier engineer tidak menganggap ini “urusan BA saja”. Ini adalah desain state machine, audit, authorization, report, SLA, dan legal defensibility.

### 5.1 Teknik Membentuk Ubiquitous Language

Gunakan tabel berikut saat menganalisis domain.

| Term | Meaning | Not Same As | Owner | Source of Truth | Example |
|---|---|---|---|---|---|
| Submitted | aplikasi resmi dikirim untuk diproses | Drafted | Application Service | Application lifecycle | applicant submits application |
| Approved | decision positif dari authority | Completed | Decision Service | Decision record | officer approves application |
| Closed | case administratif selesai | Approved | Case Service | Case lifecycle | case closed after all tasks done |
| Revoked | approval/license dicabut | Rejected | Enforcement Service | Enforcement lifecycle | authority revokes license |

### 5.2 Bahasa Harus Masuk Ke Code

Buruk:

```java
application.setStatus("P");
application.setFlag1(true);
application.setActionCode("A03");
```

Lebih baik:

```java
application.submit(submissionContext);
caseFile.assignTo(officerId);
decision.approve(approvalReason, approver);
license.revoke(revocationDecision);
```

Bahasa yang baik membuat code menjadi executable domain documentation.

---

## 6. Building Blocks Domain Model

Domain modeling untuk microservices biasanya melibatkan building blocks berikut:

```text
Entity
Value Object
Aggregate
Aggregate Root
Repository
Domain Service
Application Service
Policy
Rule
Specification
Command
Event
Query
Process Manager
State Machine
Read Model
Integration Contract
```

Kita bahas satu per satu secara praktis.

---

## 7. Entity

Entity adalah object yang memiliki identity dan continuity sepanjang waktu.

Contoh:

```text
Application
Case
License
User
Organization
Payment
Inspection
Appeal
```

Entity bukan sekadar row di database. Entity adalah konsep bisnis yang tetap sama walaupun atributnya berubah.

Contoh:

```text
Application APP-2026-001 tetap application yang sama walaupun status berubah dari Draft ke Submitted ke Approved.
```

### 7.1 Entity Identity

Identity harus dipikirkan serius.

Pilihan identity:

```text
Database surrogate key: 1000123
Business id: APP-2026-000001
UUID/ULID: 018f... 
Composite id: tenant + applicationNo
External id: Singpass/Corppass/agency reference
```

Untuk microservices, jangan sembarangan mengekspos database id sebagai contract publik jika ia tidak stabil secara domain.

Lebih baik:

```java
public record ApplicationId(String value) {
    public ApplicationId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("ApplicationId must not be blank");
        }
    }
}
```

### 7.2 Entity Anti-Pattern

Buruk:

```java
@Entity
public class ApplicationEntity {
    @Id
    private Long id;
    private String status;

    public void setStatus(String status) {
        this.status = status;
    }
}
```

Masalah:

```text
1. Status bisa diubah ke apa saja.
2. Tidak ada transition rule.
3. Tidak ada domain event.
4. Tidak ada audit intent.
5. Tidak ada language.
```

Lebih baik:

```java
public final class Application {
    private final ApplicationId id;
    private ApplicationStatus status;

    public void submit(SubmissionContext context) {
        ensureDraft();
        ensureRequiredDocuments(context);
        this.status = ApplicationStatus.SUBMITTED;
        record(new ApplicationSubmitted(id, context.actor(), context.now()));
    }

    private void ensureDraft() {
        if (status != ApplicationStatus.DRAFT) {
            throw new InvalidTransition("Only draft applications can be submitted");
        }
    }
}
```

---

## 8. Value Object

Value Object adalah object yang diidentifikasi oleh nilainya, bukan identity.

Contoh:

```text
Money
Address
EmailAddress
PostalCode
DateRange
Period
RiskScore
DocumentChecksum
PhoneNumber
PersonName
```

Value object idealnya immutable.

Contoh Java 16+:

```java
public record Money(String currency, BigDecimal amount) {
    public Money {
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("Invalid currency");
        }
        if (amount == null) {
            throw new IllegalArgumentException("Amount is required");
        }
        amount = amount.setScale(2, RoundingMode.HALF_UP);
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(currency, amount.add(other.amount));
    }
}
```

Java 8 version:

```java
public final class Money {
    private final String currency;
    private final BigDecimal amount;

    public Money(String currency, BigDecimal amount) {
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("Invalid currency");
        }
        if (amount == null) {
            throw new IllegalArgumentException("Amount is required");
        }
        this.currency = currency;
        this.amount = amount.setScale(2, RoundingMode.HALF_UP);
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(currency, amount.add(other.amount));
    }

    public String currency() { return currency; }
    public BigDecimal amount() { return amount; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money)) return false;
        Money money = (Money) o;
        return currency.equals(money.currency) && amount.equals(money.amount);
    }

    @Override
    public int hashCode() {
        return Objects.hash(currency, amount);
    }
}
```

### 8.1 Mengapa Value Object Penting di Microservices?

Karena banyak bug microservices berasal dari primitive obsession.

Buruk:

```java
void createApplication(String postalCode, String email, String amount, String dateFrom, String dateTo)
```

Lebih baik:

```java
void createApplication(PostalCode postalCode, EmailAddress email, Money amount, DateRange period)
```

Value object membuat constraint lokal dan eksplisit.

### 8.2 Value Object Sebagai Boundary Protection

Misalnya external API mengirim postal code:

```json
{ "postalCode": "123456" }
```

Jangan biarkan string mentah menyebar ke seluruh sistem.

```java
public record PostalCode(String value) {
    public PostalCode {
        if (value == null || !value.matches("\\d{6}")) {
            throw new InvalidPostalCode(value);
        }
    }
}
```

Setelah masuk domain, gunakan `PostalCode`, bukan `String`.

---

## 9. Aggregate

Aggregate adalah cluster object domain yang diperlakukan sebagai satu consistency boundary.

Aggregate root adalah entry point untuk mengubah aggregate.

Contoh:

```text
Application aggregate
- Application root
- ApplicantSnapshot
- SubmittedDocument
- Declaration
- ApplicationFee
```

Rule penting:

> Transactional consistency sebaiknya dijaga di dalam satu aggregate. Jangan membuat aggregate terlalu besar hanya karena ingin semua hal strong consistent.

Azure Architecture Center menyatakan prinsip umum: microservice tidak lebih kecil dari aggregate dan tidak lebih besar dari bounded context. Artinya aggregate adalah unit minimum yang masuk akal sebagai boundary perilaku, tetapi satu service bisa punya beberapa aggregate dalam bounded context yang sama.

### 9.1 Aggregate Bukan Object Graph Bebas

Buruk:

```text
Application
 ├── Applicant
 ├── Organization
 ├── Case
 ├── Officer
 ├── License
 ├── Payment
 ├── Document
 └── AuditTrail
```

Ini bukan aggregate. Ini graph seluruh sistem.

Aggregate harus kecil dan menjaga invariant lokal.

Lebih baik:

```text
Application Aggregate
 ├── Application
 ├── ApplicationSection
 ├── RequiredDocumentRef
 └── Declaration

Case Aggregate
 ├── CaseFile
 ├── Assignment
 ├── CaseNote
 └── CaseStatus

Decision Aggregate
 ├── Decision
 ├── DecisionReason
 └── DecisionCondition
```

### 9.2 Aggregate Boundary Heuristics

Gunakan pertanyaan berikut:

```text
1. Apa invariant yang harus selalu benar setelah transaksi commit?
2. Object mana yang harus berubah bersama secara atomik?
3. Apakah object ini dimiliki oleh lifecycle yang sama?
4. Apakah object ini selalu diakses bersama untuk command?
5. Apakah object ini memiliki owner service yang sama?
6. Apakah object ini perlu lock/version yang sama?
7. Apakah object ini bisa direferensikan by id saja?
8. Apakah perubahan object ini harus menghasilkan event yang sama?
```

Jika jawabannya “tidak selalu”, jangan buru-buru masukkan ke aggregate yang sama.

### 9.3 Aggregate Reference Rule

Di microservices, aggregate sebaiknya mereferensikan aggregate lain by id, bukan object langsung.

Buruk:

```java
class Application {
    private Applicant applicant;
    private CaseFile caseFile;
    private License license;
}
```

Lebih baik:

```java
class Application {
    private ApplicantId applicantId;
    private CaseId caseId;
    private LicenseId resultingLicenseId;
}
```

Kenapa?

```text
1. Menghindari object graph besar.
2. Menghindari lazy loading lintas boundary.
3. Menghindari coupling model.
4. Memudahkan eventual consistency.
5. Memaksa explicit query/read model untuk kebutuhan view.
```

---

## 10. Aggregate dan Transaction Boundary

Microservices memaksa kita bertanya:

> Apa yang benar-benar harus atomic?

Contoh use case:

```text
Applicant submits application.
System validates required fields.
System stores submitted application.
System creates case.
System sends notification.
System updates dashboard.
System writes audit trail.
```

Tidak semua harus satu transaction.

Pisahkan:

```text
Local transaction:
- mark application as SUBMITTED
- persist submission timestamp
- persist submitter
- append local domain event/outbox

Eventually consistent reactions:
- create case
- send notification
- update dashboard projection
- index search document
- send integration event
```

### 10.1 Transaction Boundary Decision

| Operation | Must be atomic with submit? | Reason |
|---|---:|---|
| Change application status to SUBMITTED | Yes | core invariant |
| Store submitted timestamp | Yes | audit-critical local fact |
| Store submitter identity | Yes | audit-critical local fact |
| Create case | Usually no | can be eventually consistent via event |
| Send email | No | external side effect |
| Update dashboard | No | read model projection |
| Index search | No | derived model |
| Write outbox record | Yes | reliable publishing |

Top-tier rule:

```text
Atomicity should protect invariants, not convenience.
```

---

## 11. Invariant

Invariant adalah kondisi yang harus selalu benar untuk menjaga correctness domain.

Contoh:

```text
Application cannot be submitted without required documents.
A closed case cannot be reassigned.
A revoked license cannot be renewed.
A decision must have at least one reason.
A payment cannot be captured twice.
An appeal can only be submitted within allowed period.
Only assigned officer can approve a case.
```

### 11.1 Klasifikasi Invariant

Dalam microservices, invariant harus diklasifikasikan karena tidak semua bisa dijaga dengan cara yang sama.

| Type | Meaning | Enforcement |
|---|---|---|
| Local invariant | Dijaga dalam satu aggregate | same transaction |
| Cross-aggregate invariant | Melibatkan beberapa aggregate satu service | application service/domain service |
| Cross-service invariant | Melibatkan service berbeda | saga, reservation, policy, reconciliation |
| Temporal invariant | Benar dalam rentang waktu tertentu | scheduler, timeout, SLA monitor |
| Eventual invariant | Harus converge akhirnya | reconciliation/projection repair |
| Legal/audit invariant | Harus dapat dibuktikan | immutable log/audit record |
| Human invariant | Membutuhkan keputusan manusia | workflow/human task |

### 11.2 Contoh Regulatory Case

Invariant:

```text
A case cannot be closed while there is an unresolved enforcement action.
```

Pertanyaan desain:

```text
Apakah enforcement action berada dalam service yang sama dengan case?
Apakah close case harus synchronous check ke enforcement service?
Apakah perlu materialized view di case service?
Apakah close case bisa diterima lalu dibatalkan jika enforcement masih open?
Apakah ini legal invariant atau operational invariant?
Apakah case closure harus diblokir hard atau ditandai pending validation?
```

Jawaban tidak bisa generik. Ia bergantung pada severity bisnis.

### 11.3 Invariant Enforcement Spectrum

```text
Strong local enforcement
→ strong synchronous remote validation
→ reservation/hold pattern
→ saga with compensation
→ eventual detection and correction
→ audit-only monitoring
```

Semakin ke kanan, semakin longgar consistency-nya, tetapi semakin scalable dan loosely coupled.

Semakin ke kiri, semakin kuat consistency-nya, tetapi semakin tinggi coupling dan failure propagation.

---

## 12. Command

Command merepresentasikan niat untuk mengubah state.

Contoh:

```text
SubmitApplication
AssignCase
ApproveDecision
RejectApplication
RevokeLicense
SendClarificationRequest
CloseCase
EscalateCase
```

Command biasanya imperative.

```java
public record SubmitApplicationCommand(
    ApplicationId applicationId,
    UserId submittedBy,
    Instant submittedAt,
    IdempotencyKey idempotencyKey
) {}
```

Command bukan event.

```text
Command: SubmitApplication
Meaning: request/intent to submit
May fail: yes

Event: ApplicationSubmitted
Meaning: fact that submission happened
May fail semantically: no, because it already happened
```

### 12.1 Command Handler

Command handler mengoordinasikan use case.

```java
public final class SubmitApplicationHandler {
    private final ApplicationRepository repository;
    private final RequiredDocumentPolicy documentPolicy;
    private final Clock clock;

    public void handle(SubmitApplicationCommand command) {
        Application application = repository.get(command.applicationId());
        RequiredDocumentCheck check = documentPolicy.check(application);

        application.submit(new SubmissionContext(
            command.submittedBy(),
            clock.instant(),
            check
        ));

        repository.save(application);
    }
}
```

Command handler bukan tempat semua business logic. Ia sebaiknya menjadi orchestrator tipis untuk use case lokal.

---

## 13. Event

Event merepresentasikan fakta yang sudah terjadi.

Contoh:

```text
ApplicationSubmitted
CaseAssigned
DecisionApproved
LicenseRevoked
PaymentCaptured
ClarificationRequested
CaseClosed
```

Event harus memakai past tense.

Buruk:

```text
SubmitApplicationEvent
ProcessCaseEvent
UpdateStatusEvent
```

Lebih baik:

```text
ApplicationSubmitted
CaseProcessingStarted
ApplicationStatusChanged
```

Namun hati-hati dengan event terlalu generik seperti `StatusChanged`.

### 13.1 Domain Event vs Integration Event

Domain event hidup di dalam bounded context.

Integration event dikirim ke luar service sebagai contract.

Contoh domain event:

```java
public record ApplicationSubmitted(
    ApplicationId applicationId,
    ApplicantId applicantId,
    UserId submittedBy,
    Instant submittedAt
) implements DomainEvent {}
```

Contoh integration event:

```json
{
  "eventId": "evt-2026-000001",
  "eventType": "application.submitted.v2",
  "schemaVersion": 2,
  "occurredAt": "2026-06-19T10:15:30Z",
  "producer": "application-service",
  "correlationId": "corr-123",
  "payload": {
    "applicationId": "APP-2026-0001",
    "applicantId": "APL-991",
    "submittedBy": "USER-123"
  }
}
```

Domain event boleh berubah lebih cepat. Integration event harus dijaga compatibility-nya.

### 13.2 Event Design Rules

Event yang baik:

```text
1. Menyatakan fakta bisnis.
2. Memiliki timestamp kejadian, bukan hanya publish time.
3. Memiliki event id unik.
4. Memiliki correlation id.
5. Memiliki causation id jika berasal dari command/event sebelumnya.
6. Memiliki schema version.
7. Tidak mengekspos internal entity secara mentah.
8. Tidak terlalu generic.
9. Tidak terlalu chatty tanpa reason.
10. Bisa diproses idempotently oleh consumer.
```

---

## 14. Query dan Read Model

Query tidak boleh disamakan dengan command.

Command mengubah state. Query membaca state.

Di microservices, query sering membutuhkan data dari banyak service. Jika tidak hati-hati, query akan menciptakan coupling lebih parah daripada command.

Contoh kebutuhan UI:

```text
Show application detail page:
- application info
- applicant profile
- documents
- case status
- payment status
- latest decision
- pending actions
```

Pilihan desain:

```text
1. API composition: UI/BFF memanggil banyak service.
2. Aggregator service: satu service compose response.
3. Materialized view: data diproyeksikan via event.
4. CQRS read model: read side khusus query.
5. Search index: optimized for flexible query.
```

Part 12 akan membahas ini detail. Untuk Part 3, yang penting adalah:

```text
Jangan memaksa aggregate domain menjadi query model besar.
```

Aggregate dirancang untuk command correctness. Read model dirancang untuk query efficiency.

---

## 15. Policy dan Rule

Business rule sering bercampur dengan domain logic. Untuk sistem sederhana, ini tidak masalah. Untuk sistem enterprise/regulatory, rule perlu eksplisit.

### 15.1 Rule

Rule biasanya satu kondisi spesifik.

```java
public interface BusinessRule {
    boolean isSatisfiedBy(Application application);
    String violationMessage();
}
```

Contoh:

```java
public final class RequiredDocumentsMustExist implements BusinessRule {
    public boolean isSatisfiedBy(Application application) {
        return application.hasAllRequiredDocuments();
    }

    public String violationMessage() {
        return "Required documents are missing";
    }
}
```

### 15.2 Policy

Policy biasanya kumpulan rule untuk menghasilkan keputusan.

```java
public final class SubmissionPolicy {
    private final List<BusinessRule> rules;

    public SubmissionPolicy(List<BusinessRule> rules) {
        this.rules = List.copyOf(rules);
    }

    public SubmissionDecision evaluate(Application application) {
        List<String> violations = rules.stream()
            .filter(rule -> !rule.isSatisfiedBy(application))
            .map(BusinessRule::violationMessage)
            .toList();

        return violations.isEmpty()
            ? SubmissionDecision.allowed()
            : SubmissionDecision.rejected(violations);
    }
}
```

Java 8 version:

```java
public SubmissionDecision evaluate(Application application) {
    List<String> violations = new ArrayList<>();
    for (BusinessRule rule : rules) {
        if (!rule.isSatisfiedBy(application)) {
            violations.add(rule.violationMessage());
        }
    }
    if (violations.isEmpty()) {
        return SubmissionDecision.allowed();
    }
    return SubmissionDecision.rejected(violations);
}
```

### 15.3 Kapan Rule/Policy Dipisahkan?

Pisahkan rule/policy jika:

```text
1. Rule sering berubah.
2. Rule dipakai di beberapa command.
3. Rule butuh audit explanation.
4. Rule memiliki effective date.
5. Rule berbeda per tenant/agency/product.
6. Rule perlu diuji independen.
7. Rule merupakan policy bisnis, bukan sekadar validation teknis.
```

Jangan pisahkan berlebihan untuk rule trivial.

---

## 16. Domain Service vs Application Service

### 16.1 Application Service

Application service mengoordinasikan use case.

Tugasnya:

```text
1. Load aggregate.
2. Check authorization jika perlu.
3. Call domain behavior.
4. Save aggregate.
5. Publish/record event via outbox.
6. Manage transaction boundary.
```

Ia tidak seharusnya menjadi tempat business rule utama.

### 16.2 Domain Service

Domain service dipakai ketika behavior domain tidak natural dimiliki oleh satu entity/value object.

Contoh:

```text
RiskAssessmentService
EligibilityEvaluator
FeeCalculator
RequiredDocumentPolicy
AssignmentPolicy
```

Contoh:

```java
public final class AssignmentPolicy {
    public OfficerId chooseOfficer(CaseFile caseFile, List<OfficerWorkload> candidates) {
        return candidates.stream()
            .filter(candidate -> candidate.canHandle(caseFile.caseType()))
            .min(Comparator.comparing(OfficerWorkload::activeCaseCount))
            .map(OfficerWorkload::officerId)
            .orElseThrow(() -> new NoAvailableOfficer(caseFile.id()));
    }
}
```

### 16.3 Anti-Pattern: God Application Service

Buruk:

```java
public void approveApplication(Long id) {
    ApplicationEntity app = repo.findById(id).get();
    if (!app.getStatus().equals("SUBMITTED")) throw ...;
    if (!user.hasRole("APPROVER")) throw ...;
    if (app.getDocuments().size() < 5) throw ...;
    if (app.getRiskScore() > 80) throw ...;
    app.setStatus("APPROVED");
    repo.save(app);
    kafka.send(...);
    email.send(...);
    audit.save(...);
}
```

Masalah:

```text
1. Rule tersembunyi.
2. Sulit test domain tanpa framework.
3. Sulit reuse.
4. Sulit explain ke bisnis.
5. Sulit versioning.
6. Sulit audit.
```

Lebih baik:

```java
public void approve(ApproveApplicationCommand command) {
    Application application = repository.get(command.applicationId());
    ApprovalPolicy policy = approvalPolicyFactory.forContext(command.context());
    ApprovalDecision decision = policy.evaluate(application);

    application.approve(decision, command.approvedBy(), command.approvedAt());

    repository.save(application);
}
```

---

## 17. State Machine Sebagai Domain Backbone

Banyak domain enterprise sebenarnya adalah lifecycle.

Contoh:

```text
Application lifecycle
Draft → Submitted → UnderReview → ClarificationRequested → UnderReview → Approved/Rejected/Withdrawn/Expired
```

Case lifecycle:

```text
Created → Assigned → InProgress → PendingExternalInput → Escalated → Resolved → Closed
```

License lifecycle:

```text
Inactive → Active → Suspended → Active → Revoked → Expired
```

Jika lifecycle penting, modelkan eksplisit.

### 17.1 Status vs State

Status sering hanya label.

State mengandung rule.

Buruk:

```java
application.setStatus(ApplicationStatus.APPROVED);
```

Lebih baik:

```java
application.approve(approvalDecision);
```

Karena `approve` membawa intent dan rule.

### 17.2 Transition Matrix

| Current State | Action | Next State | Allowed? | Guard |
|---|---|---|---:|---|
| Draft | Submit | Submitted | Yes | required docs exist |
| Submitted | StartReview | UnderReview | Yes | assigned officer exists |
| UnderReview | RequestClarification | ClarificationRequested | Yes | clarification reason exists |
| ClarificationRequested | SubmitClarification | UnderReview | Yes | response before deadline |
| UnderReview | Approve | Approved | Yes | approval policy passed |
| Approved | Reject | Rejected | No | terminal conflict |
| Rejected | Submit | Submitted | No | must appeal, not resubmit |

### 17.3 Java Model

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLARIFICATION_REQUESTED,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    EXPIRED;

    public boolean isTerminal() {
        return this == APPROVED || this == REJECTED || this == WITHDRAWN || this == EXPIRED;
    }
}
```

Better with transition object:

```java
public final class ApplicationTransitionPolicy {
    public void ensureCanSubmit(Application application, SubmissionContext context) {
        if (application.status() != ApplicationStatus.DRAFT) {
            throw new InvalidTransition(application.id(), application.status(), "submit");
        }
        if (!context.hasRequiredDocuments()) {
            throw new MissingRequiredDocuments(application.id());
        }
    }
}
```

Part 19 akan membahas state machine lebih dalam.

---

## 18. Domain Event Sebagai State Change Memory

Jika domain penting, perubahan state harus bisa dijelaskan.

Jangan hanya menyimpan:

```text
status = APPROVED
```

Simpan juga fakta:

```text
ApplicationApproved
- who approved
- when approved
- based on what decision
- reason
- correlation id
- previous state
- resulting state
```

### 18.1 Audit vs Event

Audit trail dan domain event mirip, tetapi tidak sama.

| Aspect | Domain Event | Audit Trail |
|---|---|---|
| Purpose | propagate business fact | prove what happened |
| Consumer | other services/processes | compliance/support/investigation |
| Schema | integration/domain contract | forensic/explanatory record |
| Retention | based on event policy | often regulatory/legal |
| Mutability | immutable | immutable |
| Detail | enough for reaction | enough for accountability |

Kadang satu domain event menghasilkan audit trail. Kadang audit trail menyimpan lebih banyak context daripada event publik.

---

## 19. Modeling Time

Time adalah bagian domain yang sering diremehkan.

Contoh rule:

```text
Appeal must be submitted within 14 calendar days after rejection.
Clarification response deadline is 7 working days.
License expires at end of day in agency timezone.
SLA excludes public holidays.
Case escalates after 3 business days without action.
```

Jangan pakai `LocalDateTime.now()` sembarangan di domain.

Lebih baik:

```java
public final class AppealPeriodPolicy {
    private final BusinessCalendar calendar;
    private final Clock clock;

    public boolean isWithinAppealPeriod(Decision decision) {
        LocalDate deadline = calendar.addBusinessDays(decision.decidedDate(), 14);
        return !LocalDate.now(clock).isAfter(deadline);
    }
}
```

### 19.1 Time Types

| Type | Use Case |
|---|---|
| Instant | machine timestamp, event occurredAt |
| LocalDate | business date without time |
| LocalDateTime | local timestamp without zone; be careful |
| ZonedDateTime | user/business timezone aware timestamp |
| OffsetDateTime | timestamp with offset |
| Duration | machine elapsed time |
| Period | calendar date amount |

Dalam microservices, event timestamp sebaiknya jelas:

```text
occurredAt: kapan kejadian bisnis terjadi
publishedAt: kapan event dipublish
receivedAt: kapan consumer menerima
processedAt: kapan consumer selesai memproses
```

---

## 20. Modeling Actor and Authority

Dalam sistem enterprise/regulatory, siapa yang melakukan aksi sangat penting.

Jangan hanya simpan user id sebagai string tanpa semantics.

Modelkan:

```text
Actor
- user id
- organization id
- role at time of action
- acting on behalf of
- authentication method
- channel
- authority source
```

Contoh:

```java
public record Actor(
    UserId userId,
    OrganizationId organizationId,
    Set<Role> roles,
    Channel channel,
    Instant authenticatedAt
) {}
```

Aksi domain:

```java
application.submit(new SubmissionContext(actor, clock.instant(), requiredDocumentCheck));
```

### 20.1 Authorization vs Domain Authority

Authorization menjawab:

```text
Apakah user secara security boleh memanggil action ini?
```

Domain authority menjawab:

```text
Apakah actor ini secara bisnis/aturan berwenang melakukan keputusan ini pada entity ini sekarang?
```

Contoh:

```text
User memiliki role OFFICER.
Namun officer ini bukan assigned officer untuk case tersebut.
Maka secara authentication/authorization umum dia valid, tetapi domain authority-nya tidak cukup.
```

---

## 21. Modeling External Systems

Microservices sering terhubung ke external systems:

```text
identity provider
payment gateway
postal/address API
government registry
document management system
email/SMS gateway
legacy system
```

Jangan biarkan external model masuk mentah ke domain.

Gunakan anti-corruption layer.

```java
public interface AddressLookupGateway {
    Address resolve(PostalCode postalCode);
}
```

Implementation boleh memakai HTTP client, Redis cache, retry, token, dsb. Domain tidak perlu tahu.

```java
public final class OneMapAddressLookupGateway implements AddressLookupGateway {
    private final OneMapClient client;
    private final AddressMapper mapper;

    public Address resolve(PostalCode postalCode) {
        OneMapResponse response = client.search(postalCode.value());
        return mapper.toDomainAddress(response);
    }
}
```

Prinsip:

```text
External schema is not your domain model.
External status is not your lifecycle.
External id is not always your identity.
External error is not your domain exception.
```

---

## 22. Context Map

Bounded context tidak hidup sendiri. Ia punya relasi.

Contoh context:

```text
Application Context
Case Context
Decision Context
Document Context
Payment Context
Notification Context
Audit Context
Identity Context
Reporting Context
```

Context map menjelaskan hubungan antar context.

### 22.1 Relasi Umum

| Relationship | Meaning |
|---|---|
| Customer/Supplier | satu context menyediakan model/contract untuk context lain |
| Conformist | downstream mengikuti model upstream |
| Anti-Corruption Layer | downstream menerjemahkan model upstream |
| Shared Kernel | sebagian kecil model dibagi |
| Published Language | integrasi via contract eksplisit |
| Open Host Service | upstream menyediakan API stabil |
| Separate Ways | tidak integrasi langsung |

### 22.2 Contoh

```text
Application Context --publishes--> ApplicationSubmitted
Case Context --consumes--> ApplicationSubmitted
Case Context --publishes--> CaseCreated
Notification Context --consumes--> CaseCreated
Reporting Context --consumes--> ApplicationSubmitted, CaseCreated, DecisionApproved
```

Context map membantu menjawab:

```text
Siapa upstream?
Siapa downstream?
Siapa bergantung pada siapa?
Contract mana yang publik?
Model mana yang tidak boleh bocor?
Apa yang terjadi jika upstream berubah?
```

---

## 23. Shared Kernel: Sangat Kecil atau Jangan

Shared kernel adalah model yang sengaja dibagi oleh beberapa bounded context.

Contoh yang mungkin masuk akal:

```text
Money
TenantId
CorrelationId
EmailAddress
PostalCode
```

Namun shared kernel sangat berbahaya jika berisi domain behavior besar.

Buruk:

```text
common-domain.jar
- Application
- Case
- Decision
- License
- Payment
- User
- Organization
- WorkflowStatus
```

Ini membuat semua service compile-time coupled.

Lebih baik:

```text
shared-kernel-core.jar
- CorrelationId
- TenantId
- Money
- PageRequest
- ErrorCode base
```

Bahkan ini pun harus hati-hati.

Rule:

```text
Share primitives of meaning, not business lifecycle.
```

---

## 24. Domain Model Versioning

Domain model berubah karena bisnis berubah.

Contoh:

```text
Sebelumnya application hanya Approved/Rejected.
Sekarang ada ConditionalApproval.
Sebelumnya license bisa Renewed langsung.
Sekarang renewal membutuhkan risk review.
Sebelumnya case close tidak butuh enforcement check.
Sekarang harus cek unresolved enforcement action.
```

Versioning perlu dipikirkan di beberapa layer:

```text
1. Domain behavior version
2. API contract version
3. Event schema version
4. Workflow definition version
5. Rule/policy effective date
6. Database schema version
7. Read model projection version
```

### 24.1 Effective-Dated Policy

Untuk regulatory system, rule sering berlaku mulai tanggal tertentu.

```java
public final class EffectiveDatedPolicy<T> {
    private final NavigableMap<LocalDate, T> versions;

    public T effectiveOn(LocalDate date) {
        Map.Entry<LocalDate, T> entry = versions.floorEntry(date);
        if (entry == null) {
            throw new NoPolicyForDate(date);
        }
        return entry.getValue();
    }
}
```

Java 8 compatible.

### 24.2 Jangan Rewrite History Sembarangan

Jika rule berubah hari ini, keputusan lama tidak otomatis invalid.

Model harus bisa menjawab:

```text
Rule versi mana yang dipakai saat keputusan dibuat?
Siapa yang menyetujui?
Apa alasan saat itu?
Data apa yang tersedia saat itu?
Apakah keputusan perlu re-evaluation?
Apakah re-evaluation menghasilkan event baru?
```

---

## 25. Domain Model dan Persistence

Ada dua pendekatan umum:

```text
1. Rich domain model separated from persistence model.
2. JPA entity as domain model.
```

Keduanya bisa dipakai, tetapi trade-off-nya berbeda.

### 25.1 JPA Entity as Domain Model

Kelebihan:

```text
1. Lebih sedikit mapping.
2. Lebih sederhana untuk CRUD/moderate domain.
3. Familiar di enterprise Java.
```

Kekurangan:

```text
1. Lazy loading bisa bocor ke domain behavior.
2. Entity lifecycle dipengaruhi ORM.
3. Mutability sering berlebihan.
4. Constructor/proxy constraint.
5. Domain model bisa terdorong mengikuti tabel.
```

### 25.2 Separate Domain and Persistence Model

Kelebihan:

```text
1. Domain bersih dari ORM.
2. Behavior lebih eksplisit.
3. Mapping boundary jelas.
4. Cocok untuk complex domain.
5. Test lebih ringan.
```

Kekurangan:

```text
1. Butuh mapper.
2. Lebih banyak code.
3. Risiko mapping bug.
4. Butuh disiplin repository.
```

### 25.3 Rekomendasi Praktis

Untuk domain kompleks seperti case management, regulatory lifecycle, enforcement, appeal, approval, dan audit-heavy workflows:

```text
Prefer rich domain model separated or carefully isolated from persistence details.
```

Untuk service sederhana seperti notification preference, lookup, static reference, atau simple catalog:

```text
JPA entity as domain model may be acceptable.
```

Top-tier engineering bukan dogma. Yang penting trade-off sadar.

---

## 26. Package Structure Java

Struktur package yang mendukung domain model:

```text
com.example.application
  application
    command
    handler
    port
  domain
    model
    event
    policy
    service
    exception
  infrastructure
    persistence
    messaging
    http
    config
  interface
    rest
    messaging
```

Atau hexagonal style:

```text
com.example.application
  domain
  usecase
  port.in
  port.out
  adapter.in.web
  adapter.in.messaging
  adapter.out.persistence
  adapter.out.messaging
  adapter.out.external
```

Rule penting:

```text
Domain must not depend on infrastructure.
Application/usecase may depend on domain and ports.
Infrastructure implements ports.
Interface adapters translate external contracts.
```

### 26.1 Dependency Direction

```text
REST Controller → Application Service → Domain Model
Kafka Consumer → Application Service → Domain Model
Repository Adapter → Domain Mapper → Persistence Model
Domain Model → no Spring, no JPA, no Kafka, no HTTP
```

Domain model yang tidak bergantung ke framework lebih mudah diuji dan dipahami.

---

## 27. Java 8 hingga Java 25 Considerations

### 27.1 Java 8

Java 8 masih banyak di enterprise legacy.

Yang tersedia:

```text
lambda
stream
Optional
java.time
CompletableFuture
functional interfaces
```

Yang belum tersedia:

```text
record
sealed class
pattern matching
switch expression modern
virtual threads
```

Domain model Java 8 harus lebih verbose.

```java
public final class ApplicationId {
    private final String value;

    public ApplicationId(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("ApplicationId is required");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

### 27.2 Java 11

Java 11 cocok sebagai migration baseline.

Tambahan kecil tapi berguna:

```text
var for local variables
HTTP Client standard
String utilities
better runtime/container support than Java 8
```

Domain modeling tidak berubah drastis, tetapi platform lebih baik.

### 27.3 Java 17

Java 17 sering menjadi modern enterprise baseline.

Fitur penting:

```text
records
sealed classes
pattern matching instanceof
switch expression
stronger runtime baseline
```

Value object menjadi lebih ringan.

```java
public record ApplicationId(String value) {
    public ApplicationId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("ApplicationId is required");
        }
    }
}
```

Sealed interface cocok untuk domain event hierarchy.

```java
public sealed interface ApplicationEvent
    permits ApplicationSubmitted, ApplicationApproved, ApplicationRejected {
}
```

### 27.4 Java 21

Java 21 membawa virtual threads sebagai fitur final.

Dampaknya untuk domain model tidak langsung, tetapi memengaruhi application service dan IO orchestration.

Prinsip:

```text
Virtual threads simplify blocking style orchestration.
Virtual threads do not solve wrong domain boundaries.
Virtual threads do not remove need for timeout, idempotency, and consistency design.
```

### 27.5 Java 25

JDK 25 sudah GA pada 16 September 2025 sebagai reference implementation Java SE 25. Untuk domain modeling, Java 25 adalah horizon terbaru, tetapi prinsip domain tetap tidak bergantung pada versi.

Yang perlu diingat:

```text
Language/runtime can reduce ceremony.
It cannot decide boundaries.
It cannot define invariant.
It cannot understand policy.
It cannot fix event semantics.
```

Top-tier engineer memakai fitur Java baru untuk memperjelas model, bukan untuk membuat desain lebih fancy.

---

## 28. Implementation Example: Application Submission Domain

Kita buat contoh kecil tapi serius.

### 28.1 Domain Concepts

```text
Application
ApplicationId
ApplicantId
ApplicationStatus
SubmittedDocument
SubmissionPolicy
SubmissionContext
ApplicationSubmitted
```

### 28.2 Java 17+ Example

```java
public record ApplicationId(String value) {
    public ApplicationId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("ApplicationId is required");
        }
    }
}

public record ApplicantId(String value) {}

public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    WITHDRAWN;

    public boolean canSubmit() {
        return this == DRAFT;
    }
}

public sealed interface DomainEvent permits ApplicationSubmitted {}

public record ApplicationSubmitted(
    ApplicationId applicationId,
    ApplicantId applicantId,
    UserId submittedBy,
    Instant occurredAt
) implements DomainEvent {}

public final class Application {
    private final ApplicationId id;
    private final ApplicantId applicantId;
    private ApplicationStatus status;
    private final List<SubmittedDocument> documents;
    private final List<DomainEvent> events = new ArrayList<>();

    public Application(
        ApplicationId id,
        ApplicantId applicantId,
        ApplicationStatus status,
        List<SubmittedDocument> documents
    ) {
        this.id = Objects.requireNonNull(id);
        this.applicantId = Objects.requireNonNull(applicantId);
        this.status = Objects.requireNonNull(status);
        this.documents = new ArrayList<>(documents);
    }

    public void submit(SubmissionContext context, SubmissionPolicy policy) {
        if (!status.canSubmit()) {
            throw new InvalidApplicationTransition(id, status, "submit");
        }

        SubmissionDecision decision = policy.evaluate(this);
        if (!decision.allowed()) {
            throw new SubmissionRejected(id, decision.violations());
        }

        this.status = ApplicationStatus.SUBMITTED;
        record(new ApplicationSubmitted(id, applicantId, context.actor().userId(), context.now()));
    }

    private void record(DomainEvent event) {
        events.add(event);
    }

    public List<DomainEvent> pullEvents() {
        List<DomainEvent> copy = List.copyOf(events);
        events.clear();
        return copy;
    }

    public boolean hasDocument(DocumentType type) {
        return documents.stream().anyMatch(doc -> doc.type().equals(type));
    }

    public ApplicationId id() { return id; }
    public ApplicantId applicantId() { return applicantId; }
    public ApplicationStatus status() { return status; }
}
```

### 28.3 Application Service

```java
public final class SubmitApplicationUseCase {
    private final ApplicationRepository repository;
    private final SubmissionPolicy submissionPolicy;
    private final Outbox outbox;
    private final Clock clock;

    @Transactional
    public void submit(SubmitApplicationCommand command) {
        Application application = repository.get(command.applicationId());

        SubmissionContext context = new SubmissionContext(
            command.actor(),
            Instant.now(clock),
            command.idempotencyKey()
        );

        application.submit(context, submissionPolicy);

        repository.save(application);

        for (DomainEvent event : application.pullEvents()) {
            outbox.append(IntegrationEventMapper.toIntegrationEvent(event));
        }
    }
}
```

### 28.4 Apa yang Penting Dari Contoh Ini?

Perhatikan:

```text
1. Controller tidak mengubah status langsung.
2. Domain method memakai business verb: submit.
3. Transition rule ada di domain.
4. Policy dievaluasi eksplisit.
5. Event direkam setelah state change.
6. Outbox berada dalam transaction yang sama.
7. Integration event dipisahkan dari domain event.
8. Actor dan idempotency masuk sebagai context.
```

Ini bukan sekadar clean code. Ini adalah correctness architecture.

---

## 29. Anti-Patterns Domain Modeling Microservices

### 29.1 CRUD Service Masquerading as Domain Service

Gejala:

```text
Service hanya create/read/update/delete tabel.
Endpoint penuh dengan updateStatus.
Tidak ada business method.
Tidak ada event bermakna.
```

Dampak:

```text
Business logic pindah ke UI, batch, consumer, atau manual process.
```

### 29.2 Anemic Domain Model

Gejala:

```text
Entity hanya getter/setter.
Service class mengandung semua rule.
```

Dampak:

```text
Rule sulit dilokalisasi dan diuji.
```

### 29.3 Shared Domain Library Across Services

Gejala:

```text
Semua service memakai common-domain.jar besar.
```

Dampak:

```text
Independent deployment rusak.
Model evolution lambat.
Semua service harus upgrade bersama.
```

### 29.4 Event as Database Row Dump

Gejala:

```json
{
  "table": "APPLICATION",
  "operation": "UPDATE",
  "before": {...},
  "after": {...}
}
```

Dampak:

```text
Consumer tergantung struktur storage internal.
Business meaning hilang.
```

CDC boleh dipakai, tetapi published event sebaiknya tetap punya semantic bisnis.

### 29.5 Status-Driven Without Transition Model

Gejala:

```text
Semua workflow direpresentasikan sebagai status string.
Tidak ada transition matrix.
```

Dampak:

```text
Invalid transition mudah terjadi.
Audit sulit dipahami.
Bug muncul di edge case lifecycle.
```

### 29.6 Generic Workflow Engine Without Domain Language

Gejala:

```text
Semua proses menjadi task, node, edge, variable.
Tidak ada domain verb.
```

Dampak:

```text
Sistem fleksibel secara teknis tetapi miskin meaning.
```

Workflow engine boleh dipakai, tetapi domain language tetap harus eksplisit.

---

## 30. Domain Modeling Checklist

Gunakan checklist ini saat mendesain microservice.

### 30.1 Language Checklist

```text
[ ] Apakah term utama sudah didefinisikan?
[ ] Apakah ada term yang ambigu?
[ ] Apakah status memiliki arti berbeda antar tim?
[ ] Apakah nama command memakai imperative verb?
[ ] Apakah nama event memakai past-tense fact?
[ ] Apakah istilah domain muncul di code?
```

### 30.2 Aggregate Checklist

```text
[ ] Apa aggregate root?
[ ] Apa invariant lokalnya?
[ ] Apa yang harus atomic?
[ ] Apa yang bisa eventual?
[ ] Apakah aggregate terlalu besar?
[ ] Apakah aggregate mereferensikan aggregate lain by id?
[ ] Apakah lifecycle-nya jelas?
```

### 30.3 Event Checklist

```text
[ ] Event menyatakan fakta bisnis?
[ ] Event punya occurredAt?
[ ] Event punya eventId?
[ ] Event punya correlationId?
[ ] Event punya schemaVersion?
[ ] Event tidak mengekspos internal persistence model?
[ ] Consumer bisa idempotent?
```

### 30.4 Policy Checklist

```text
[ ] Rule apa yang sering berubah?
[ ] Rule apa yang perlu effective date?
[ ] Rule apa yang perlu explanation?
[ ] Rule apa yang tenant/agency-specific?
[ ] Rule apa yang harus diaudit?
```

### 30.5 Boundary Checklist

```text
[ ] Apakah model ini milik bounded context ini?
[ ] Apakah ada model dari context lain yang bocor?
[ ] Apakah integration contract dipisahkan dari domain object?
[ ] Apakah shared kernel terlalu besar?
[ ] Apakah service bisa deploy tanpa compile-time dependency ke service lain?
```

---

## 31. Senior/Principal Engineer Review Questions

Saat review desain domain microservice, tanyakan:

```text
1. Apa business capability service ini?
2. Apa ubiquitous language-nya?
3. Apa aggregate root utamanya?
4. Apa invariant yang dijaga aggregate?
5. Apa invariant yang tidak bisa dijaga lokal?
6. Apa command utama?
7. Apa event utama?
8. Apa state machine-nya?
9. Apa policy yang berubah seiring waktu?
10. Apa data yang menjadi source of truth service ini?
11. Apa data yang hanya snapshot/reference?
12. Apa integration model yang dipublish?
13. Apa model upstream yang harus diterjemahkan via ACL?
14. Apa yang terjadi jika event duplicate?
15. Apa yang terjadi jika event out-of-order?
16. Apa yang terjadi jika policy berubah setelah keputusan lama dibuat?
17. Apa yang harus bisa dibuktikan saat audit?
18. Apa konsekuensi jika service ini down?
19. Apakah domain behavior bisa diuji tanpa Spring/Kafka/database?
20. Apakah ada alasan jelas mengapa ini microservice, bukan module?
```

---

## 32. Practical Exercise

Ambil domain berikut:

```text
Regulatory application processing system.
Applicant submits application.
Officer reviews application.
Officer may request clarification.
Applicant responds.
Officer recommends approval/rejection.
Supervisor makes final decision.
Approved application creates license.
Rejected application may be appealed within 14 days.
License may later be suspended or revoked due to enforcement case.
```

### 32.1 Tugas

Buat:

```text
1. Ubiquitous language glossary.
2. Candidate bounded contexts.
3. Aggregate list per context.
4. State machine untuk Application, Case, License, Appeal.
5. Command list.
6. Domain event list.
7. Invariant classification.
8. Policy list.
9. Integration event list.
10. Context map.
```

### 32.2 Expected Thinking

Jangan langsung membuat service:

```text
application-service
case-service
license-service
```

Sebelum itu, jawab:

```text
Apakah decision bagian dari application atau context sendiri?
Apakah license lifecycle berbeda dari application lifecycle?
Apakah appeal mereferensikan decision atau application?
Apakah enforcement punya authority untuk mengubah license?
Apakah suspension dan revocation event dari enforcement atau license?
Apakah application approved otomatis license active?
Apakah appeal mengubah decision lama atau membuat decision baru?
```

Inilah jenis pertanyaan yang membedakan engineer biasa dan engineer arsitektural.

---

## 33. Ringkasan Mental Model

Domain modeling untuk microservices bukan menggambar class diagram.

Ia adalah proses menjawab:

```text
Apa konsep bisnis yang benar-benar ada?
Apa bahasa yang dipakai bisnis?
Apa state yang legal?
Apa perubahan state yang legal?
Apa invariant yang harus dijaga?
Apa yang harus atomic?
Apa yang boleh eventual?
Siapa pemilik data?
Siapa pemilik keputusan?
Apa fakta yang harus dipublish?
Apa rule yang berubah?
Apa yang harus bisa diaudit?
Apa model internal dan apa contract eksternal?
```

Microservices tanpa domain model hanyalah distributed CRUD.

Microservices dengan domain model yang kuat dapat menjadi sistem yang:

```text
1. lebih mudah dievolusi,
2. lebih jelas ownership-nya,
3. lebih aman terhadap partial failure,
4. lebih audit-friendly,
5. lebih mudah diuji,
6. lebih mudah dipahami oleh engineer baru,
7. lebih defensible secara bisnis dan regulasi.
```

---

## 34. Key Takeaways

1. **Domain model bukan data model.** Data model menyimpan; domain model menjelaskan behavior.
2. **Entity memiliki identity.** Value object memiliki value equality.
3. **Aggregate adalah consistency boundary.** Jangan jadikan aggregate sebagai seluruh graph sistem.
4. **Command adalah intent. Event adalah fact.** Jangan campur keduanya.
5. **Invariant harus diklasifikasikan.** Tidak semua invariant bisa dijaga dengan transaction lokal.
6. **Policy perlu eksplisit jika sering berubah, butuh audit, atau punya effective date.**
7. **State machine sering menjadi backbone domain enterprise.** Status string saja tidak cukup.
8. **Integration event harus stabil dan semantic.** Jangan mengekspos persistence model mentah.
9. **Shared domain library besar menghancurkan autonomy.** Share sedikit saja jika benar-benar perlu.
10. **Java version membantu ekspresivitas, bukan menggantikan modeling.** Java 8 bisa tetap baik; Java 17/21/25 bisa lebih ringkas.

---

## 35. Koneksi Ke Part Berikutnya

Part ini membentuk vocabulary untuk membahas arsitektur microservices lebih luas.

Part berikutnya:

```text
Part 4 — Microservice Architecture Styles
```

Di Part 4 kita akan membandingkan architecture style seperti:

```text
request/response microservices
event-driven microservices
workflow-driven microservices
CQRS-based architecture
BFF/API composition
service mesh oriented architecture
serverless microservices
hybrid architecture
```

Kunci dari Part 4 adalah memahami bahwa architecture style seharusnya dipilih berdasarkan domain, consistency, latency, ownership, dan failure model — bukan karena trend.

---

## 36. Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
[x] Part 0 — Introduction and Mental Model
[x] Part 1 — Distributed Systems Reality Before Microservices
[x] Part 2 — Service Boundary Engineering
[x] Part 3 — Domain Modeling for Microservices
[ ] Part 4 — Microservice Architecture Styles
...
[ ] Part 34 — Capstone Architecture Review
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-02-service-boundary-engineering.md">⬅️ Learn Java Microservices Patterns Advanced Engineering — Part 2</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-04-architecture-styles.md">Learn Java Microservices Patterns — Advanced Engineering ➡️</a>
</div>
