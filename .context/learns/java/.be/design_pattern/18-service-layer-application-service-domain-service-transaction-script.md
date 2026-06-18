# Part 18 — Service Layer, Application Service, Domain Service, Transaction Script

File: `18-service-layer-application-service-domain-service-transaction-script.md`

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Staff-level engineering judgment  
> Fokus: service boundary, orchestration, domain behavior, transaction boundary, dan anti-pattern service-heavy Java systems

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan dengan tajam antara:
   - Service Layer
   - Application Service
   - Domain Service
   - Transaction Script
   - Use Case Handler
   - Orchestrator
   - Manager/Helper class yang sebenarnya tidak jelas tanggung jawabnya
2. Menentukan di mana business rule seharusnya berada.
3. Menentukan batas transaksi secara eksplisit.
4. Menghindari `GodService`, `Anemic Domain Model`, dan `Service Calling Service Maze`.
5. Mendesain service yang defensible untuk sistem enterprise/regulatory.
6. Memilih antara rich domain model dan transaction script secara pragmatis.
7. Melakukan refactoring dari service method besar ke model yang lebih modular.
8. Menulis service code yang mudah diuji, diamati, diubah, dan diaudit.

Bagian ini sangat penting karena banyak Java enterprise codebase tidak rusak karena kurang pattern, melainkan karena semua hal dimasukkan ke class bernama `SomethingService`.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Di banyak sistem Java enterprise, kita sering menemukan bentuk seperti ini:

```java
@Service
public class CaseService {

    @Transactional
    public void approve(Long caseId, String officerId, String comment) {
        CaseEntity entity = caseRepository.findById(caseId)
                .orElseThrow(() -> new NotFoundException("Case not found"));

        if (!entity.getStatus().equals("PENDING")) {
            throw new BadRequestException("Invalid status");
        }

        UserEntity officer = userRepository.findById(officerId)
                .orElseThrow(() -> new NotFoundException("Officer not found"));

        if (!officer.hasRole("APPROVER")) {
            throw new ForbiddenException();
        }

        if (comment == null || comment.isBlank()) {
            throw new BadRequestException("Comment required");
        }

        entity.setStatus("APPROVED");
        entity.setApprovedBy(officerId);
        entity.setApprovedAt(LocalDateTime.now());
        entity.setComment(comment);

        auditRepository.save(new AuditEntity(...));
        notificationService.sendApprovalEmail(entity);
        externalGateway.syncStatus(entity);
        eventPublisher.publish(new CaseApprovedEvent(...));
    }
}
```

Sekilas ini terlihat wajar. Ada service, repository, transaction, validation, audit, notification, external sync, event.

Tetapi secara desain, method ini mencampur banyak concern:

| Concern | Ada di method? | Seharusnya dipikirkan sebagai |
|---|---:|---|
| Load aggregate/data | Ya | application service / repository boundary |
| Authorization | Ya | policy / authorization service / application boundary |
| State transition rule | Ya | domain model / state machine / policy |
| Input validation | Ya | command validation / value object / boundary validation |
| Mutation | Ya | domain behavior |
| Audit | Ya | audit pattern / domain event / outbox |
| Notification | Ya | side effect / integration event / async listener |
| External sync | Ya | gateway / outbox / integration service |
| Event publication | Ya | domain/integration event boundary |
| Transaction boundary | Tersembunyi | application service decision |

Masalahnya bukan hanya method panjang. Masalahnya adalah **semua keputusan desain tersembunyi di satu prosedur**.

Ketika requirement berubah, misalnya:

- approval butuh second-level approval,
- role approver berubah menjadi permission-based,
- audit harus menyimpan reason code,
- external sync harus async,
- email tidak boleh menggagalkan transaksi,
- approval hanya boleh pada business hour,
- beberapa case butuh route berbeda,
- approval perlu idempotency,
- API dipanggil ulang oleh client,
- approval perlu compensation ketika external sync gagal,

maka method seperti ini mulai membengkak. Akhirnya service menjadi pusat gravitasi sistem.

Part ini menjawab pertanyaan:

> Apa sebenarnya yang boleh dilakukan service, dan apa yang seharusnya dipindah ke model/policy/pattern lain?

---

## 3. Mental Model Utama

### 3.1 Service bukan tempat menaruh semua logic

Nama `Service` sering disalahgunakan karena terdengar enterprise dan netral.

Tetapi netralitas itu berbahaya.

`CaseService`, `UserService`, `ApplicationService`, `CommonService`, `MasterService`, `UtilityService`, dan `ManagerService` sering menjadi tempat semua logic yang tidak tahu harus ditaruh di mana.

Mental model yang lebih baik:

```text
Service bukan tempat sampah logic.
Service adalah boundary untuk koordinasi tanggung jawab yang memang tidak natural dimiliki satu object/entity/value object.
```

Jika logic punya owner domain yang jelas, taruh di owner itu.

Jika logic mengoordinasikan beberapa object, repository, transaction, security, dan external side effect, kemungkinan ia milik application service.

Jika logic adalah aturan domain lintas entity/value object yang tidak cocok dimiliki salah satu entity, kemungkinan ia domain service.

Jika logic hanya prosedur database sederhana dengan sedikit domain behavior, transaction script mungkin cukup.

---

### 3.2 Pisahkan orchestration dari decision

Salah satu prinsip terpenting:

```text
Application service mengatur alur.
Domain object/domain service mengambil keputusan domain.
Infrastructure menjalankan detail teknis.
```

Contoh buruk:

```java
public void approve(Long caseId, String officerId) {
    CaseEntity c = repository.findById(caseId).orElseThrow();

    if (c.getStatus().equals("PENDING") && c.getRiskScore() < 80) {
        c.setStatus("APPROVED");
    } else if (c.getStatus().equals("PENDING") && c.getRiskScore() >= 80) {
        c.setStatus("REQUIRES_SECOND_APPROVAL");
    } else {
        throw new InvalidTransitionException();
    }
}
```

Service di atas tidak hanya mengatur alur. Ia mengambil keputusan domain.

Contoh lebih baik:

```java
public void approve(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.get(command.caseId());
    Officer officer = officerRepository.get(command.officerId());

    ApprovalOutcome outcome = caseFile.approveBy(officer, command.comment(), clock.instant());

    caseRepository.save(caseFile);
    auditRecorder.record(outcome.auditEvent());
}
```

Di sini service melakukan orchestration:

1. load data,
2. create context,
3. call domain behavior,
4. persist,
5. record side effect.

Keputusan approval ada di `caseFile.approveBy(...)` atau policy/domain service yang dipanggil dari domain layer.

---

### 3.3 Service layer adalah boundary, bukan layer untuk semua business logic

Dalam arsitektur layered tradisional:

```text
Controller -> Service -> Repository -> Database
```

Banyak engineer menyimpulkan:

```text
Business logic harus ada di Service.
```

Ini terlalu kasar.

Lebih tepat:

```text
Application logic ada di Application Service.
Domain logic ada di Domain Model atau Domain Service.
Persistence logic ada di Repository/DAO/Data Mapper.
Integration logic ada di Gateway/Adapter.
Presentation logic ada di Controller/Presenter/View Model.
```

`Service Layer` adalah istilah umum. Di dalamnya perlu dibedakan lagi.

---

## 4. Vocabulary: Istilah yang Sering Tercampur

### 4.1 Service Layer

Service Layer adalah lapisan yang menyediakan operasi aplikasi kepada client/controller/API.

Ia biasanya:

- menjadi entry point use case,
- mengatur transaction boundary,
- mengoordinasikan repository,
- memanggil domain object/domain service,
- mengatur security/application-level validation,
- mengatur side effect secara aman,
- mengembalikan response model atau result.

Contoh:

```java
public interface CaseApprovalUseCase {
    ApprovalResult approve(ApproveCaseCommand command);
}
```

Implementasinya bisa disebut application service.

---

### 4.2 Application Service

Application Service merepresentasikan **use case boundary**.

Ia menjawab:

```text
Apa langkah aplikasi untuk menjalankan use case ini?
```

Bukan:

```text
Apa aturan domain terdalam untuk approval?
```

Tanggung jawab umum application service:

1. menerima command/query,
2. validasi input boundary,
3. memeriksa authorization level aplikasi,
4. membuka transaction,
5. mengambil aggregate/entity dari repository,
6. memanggil domain behavior,
7. menyimpan perubahan,
8. menerbitkan event/outbox,
9. mengembalikan result.

Contoh:

```java
public final class ApproveCaseApplicationService implements ApproveCaseUseCase {

    private final CaseRepository caseRepository;
    private final OfficerRepository officerRepository;
    private final AuthorizationPolicy authorizationPolicy;
    private final Outbox outbox;
    private final Clock clock;

    public ApproveCaseApplicationService(
            CaseRepository caseRepository,
            OfficerRepository officerRepository,
            AuthorizationPolicy authorizationPolicy,
            Outbox outbox,
            Clock clock
    ) {
        this.caseRepository = caseRepository;
        this.officerRepository = officerRepository;
        this.authorizationPolicy = authorizationPolicy;
        this.outbox = outbox;
        this.clock = clock;
    }

    @Transactional
    @Override
    public ApprovalResult approve(ApproveCaseCommand command) {
        command.validateBasicShape();

        CaseFile caseFile = caseRepository.getById(command.caseId());
        Officer officer = officerRepository.getById(command.officerId());

        authorizationPolicy.requireCanApprove(officer, caseFile);

        ApprovalOutcome outcome = caseFile.approve(
                officer,
                ApprovalComment.of(command.comment()),
                clock.instant()
        );

        caseRepository.save(caseFile);
        outbox.add(outcome.toIntegrationEvent());

        return ApprovalResult.from(outcome);
    }
}
```

Application service tidak kosong. Ia punya logic, tetapi logic-nya adalah **application flow**, bukan domain decision detail.

---

### 4.3 Domain Service

Domain Service adalah service yang berisi **domain logic** yang tidak natural dimiliki oleh satu entity/value object.

Ciri domain service:

- namanya berasal dari domain language,
- tidak bergantung pada framework,
- tidak bicara HTTP, database, transaction annotation, queue, email, JSON,
- bisa diuji tanpa container,
- logic-nya meaningful secara bisnis,
- biasanya stateless.

Contoh domain service:

```java
public final class SanctionCalculator {

    public SanctionRecommendation recommend(CaseFile caseFile, ViolationHistory history) {
        int severity = caseFile.primaryViolation().severityPoints();
        int repeat = history.repeatCountFor(caseFile.respondentId());

        if (severity >= 80 || repeat >= 3) {
            return SanctionRecommendation.suspension("High severity or repeated violation");
        }

        if (severity >= 40) {
            return SanctionRecommendation.warning("Medium severity");
        }

        return SanctionRecommendation.noSanction("Low severity");
    }
}
```

Ini domain service karena rekomendasi sanksi melibatkan `CaseFile` dan `ViolationHistory`. Tidak jelas bahwa salah satu object harus memiliki seluruh logic tersebut.

---

### 4.4 Transaction Script

Transaction Script adalah pola di mana satu prosedur menangani satu business transaction dari awal sampai akhir.

Contoh:

```java
@Transactional
public void markNotificationAsRead(long notificationId, long userId) {
    int updated = jdbc.update("""
            update notification
            set read = true, read_at = ?
            where id = ? and user_id = ? and read = false
            """, Instant.now(), notificationId, userId);

    if (updated == 0) {
        throw new NotFoundOrAlreadyReadException();
    }
}
```

Transaction Script tidak selalu buruk.

Ia cocok ketika:

- business rule sederhana,
- data-centric operation,
- tidak ada lifecycle kompleks,
- tidak banyak variasi rule,
- tidak ada kebutuhan reuse domain behavior,
- model domain belum layak diberi abstraction besar.

Tetapi ia menjadi anti-pattern ketika:

- method menjadi ratusan baris,
- banyak `if-else` business rule,
- logic duplicated antar use case,
- state transition tidak eksplisit,
- side effect tercampur dengan mutation,
- sulit diuji tanpa database,
- sulit menjawab “kenapa keputusan ini dibuat”.

---

### 4.5 Use Case Handler

Use Case Handler mirip Application Service, tetapi biasanya lebih granular: satu class untuk satu command/use case.

Contoh:

```java
public interface UseCaseHandler<C, R> {
    R handle(C command);
}
```

```java
public final class ApproveCaseHandler implements UseCaseHandler<ApproveCaseCommand, ApprovalResult> {
    @Override
    public ApprovalResult handle(ApproveCaseCommand command) {
        // one use case only
    }
}
```

Keuntungan:

- class kecil,
- dependency spesifik,
- testing lebih mudah,
- traceability use case jelas,
- cocok untuk command-based architecture.

Risiko:

- terlalu banyak class,
- navigasi code sulit,
- command bus menjadi magic,
- naming tidak konsisten,
- shared flow diduplikasi.

---

### 4.6 Orchestrator

Orchestrator mengoordinasikan langkah-langkah lintas component/service.

Contoh:

```java
public final class RenewalSubmissionOrchestrator {
    public RenewalSubmissionResult submit(SubmitRenewalCommand command) {
        // validate applicant
        // check outstanding payment
        // create renewal application
        // reserve invoice number
        // enqueue document screening
        // publish submission event
    }
}
```

Orchestrator boleh ada, tetapi harus hati-hati.

Jika orchestrator mengambil semua keputusan domain, ia menjadi `GodService` dengan nama lebih modern.

---

## 5. Layering yang Lebih Akurat

Model yang lebih sehat:

```text
[API / Controller]
       |
       v
[Application Service / Use Case Handler]
       |
       +--> [Authorization Policy]
       +--> [Repository Port]
       +--> [Domain Model]
       +--> [Domain Service]
       +--> [Outbox / Event Port]
       +--> [Gateway Port]
       |
       v
[Infrastructure Adapter]
```

### 5.1 Boundary per responsibility

| Responsibility | Tempat yang lebih tepat |
|---|---|
| Parse HTTP request | Controller |
| Validate request shape | Controller/request validator/command factory |
| Check use case permission | Application service / authorization policy |
| Load aggregate | Application service via repository |
| Enforce domain invariant | Entity/value object/domain service |
| Manage transaction | Application service |
| Send email | Application service indirectly via event/outbox/listener |
| Call external API | Gateway/adapter, often after transaction or via outbox |
| Map to API response | Presenter/assembler/controller boundary |
| Build audit event | Domain outcome/application service/audit recorder |

---

## 6. Application Service in Depth

### 6.1 Core responsibilities

Application service bertanggung jawab atas urutan kerja aplikasi.

Template umum:

```java
@Transactional
public Result execute(Command command) {
    // 1. Normalize/validate command shape
    // 2. Load required state
    // 3. Check authorization/application policy
    // 4. Call domain behavior/domain service
    // 5. Persist mutation
    // 6. Register side effects safely
    // 7. Return application result
}
```

Tetapi template ini bukan aturan kaku.

Kadang authorization harus sebelum load detail. Kadang authorization butuh loaded resource. Kadang side effect harus sync. Kadang transaction tidak boleh mencakup external call.

Yang penting adalah keputusan itu eksplisit.

---

### 6.2 Application service boleh punya logic, tapi jenisnya berbeda

Application service boleh punya:

- flow control,
- transaction control,
- orchestration,
- authorization invocation,
- repository coordination,
- idempotency handling,
- mapping command ke domain object,
- event/outbox registration,
- retry boundary decision.

Application service sebaiknya tidak punya:

- complex domain branching,
- lifecycle transition matrix tersembunyi,
- sanction/risk scoring algorithm,
- persistence SQL detail,
- HTTP response formatting,
- email template rendering,
- vendor API payload detail,
- large `if-else` per business rule.

---

### 6.3 Contoh application service yang terlalu gemuk

```java
@Transactional
public ApprovalResponse approve(ApprovalRequest request) {
    CaseEntity c = caseRepo.findById(request.caseId()).orElseThrow();

    if (c.getStatus().equals("DRAFT")) throw new BadRequestException();
    if (c.getStatus().equals("CLOSED")) throw new BadRequestException();
    if (c.getStatus().equals("REJECTED")) throw new BadRequestException();

    if (c.getRiskScore() > 90) {
        c.setStatus("SECOND_APPROVAL_REQUIRED");
    } else {
        c.setStatus("APPROVED");
    }

    if (request.comment() == null || request.comment().length() < 10) {
        throw new BadRequestException();
    }

    if (c.getViolationType().equals("HIGH_RISK") && request.comment().length() < 50) {
        throw new BadRequestException();
    }

    auditRepo.save(...);
    emailClient.send(...);
    externalClient.sync(...);

    return new ApprovalResponse(...);
}
```

Smell:

1. status transition tidak eksplisit,
2. approval rule bercampur validation,
3. comment rule tersebar,
4. external call di dalam transaction,
5. audit event tidak punya domain meaning,
6. response mapping bercampur domain mutation,
7. rule sulit diuji secara isolated.

---

### 6.4 Versi lebih baik

```java
@Transactional
public ApprovalResult approve(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.get(command.caseId());
    Officer officer = officerRepository.get(command.officerId());

    authorization.requireCanApprove(officer, caseFile);

    ApprovalOutcome outcome = caseFile.approve(
            officer,
            ApprovalComment.of(command.comment()),
            approvalPolicy,
            clock.instant()
    );

    caseRepository.save(caseFile);
    outbox.add(CaseApprovedIntegrationEvent.from(outcome));
    auditTrail.record(outcome.auditRecord());

    return ApprovalResult.from(outcome);
}
```

Catatan penting: ini bukan berarti semua logic harus masuk entity. `approvalPolicy` bisa domain service/policy object.

---

## 7. Domain Service in Depth

### 7.1 Kapan perlu domain service?

Gunakan domain service ketika rule:

1. meaningful secara domain,
2. tidak natural dimiliki satu entity,
3. melibatkan beberapa aggregate/value object,
4. butuh policy/calculation/decision object,
5. harus reusable antar use case,
6. perlu diuji tanpa database/framework.

Contoh domain service yang valid:

- `EligibilityPolicy`
- `SanctionCalculator`
- `RenewalWindowPolicy`
- `LateFeeCalculator`
- `CaseAssignmentPolicy`
- `AppealDeadlinePolicy`
- `RiskClassificationPolicy`

Nama domain service harus berasal dari bahasa domain, bukan generic technical suffix.

Buruk:

```java
CommonBusinessService
CaseHelper
ValidationUtil
ProcessManager
ApplicationManager
```

Lebih baik:

```java
RenewalEligibilityPolicy
CaseEscalationPolicy
SanctionRecommendationService
OfficerAssignmentPolicy
AppealDeadlineCalculator
```

---

### 7.2 Domain service harus bebas framework

Buruk:

```java
@Service
public class SanctionCalculator {

    @Autowired
    private SanctionRepository repository;

    @Transactional
    public Sanction calculate(Long caseId) {
        CaseEntity entity = repository.findCase(caseId);
        // domain logic + persistence
    }
}
```

Lebih baik:

```java
public final class SanctionCalculator {

    public SanctionRecommendation calculate(CaseFile caseFile, ViolationHistory history) {
        // pure domain logic
    }
}
```

Jika domain service perlu data tambahan, application service yang mengambil data lalu memberikannya sebagai parameter.

```java
CaseFile caseFile = caseRepository.get(command.caseId());
ViolationHistory history = violationHistoryRepository.findByRespondent(caseFile.respondentId());

SanctionRecommendation recommendation = sanctionCalculator.calculate(caseFile, history);
```

Ini membuat dependency lebih eksplisit.

---

### 7.3 Domain service vs application service

| Pertanyaan | Application Service | Domain Service |
|---|---|---|
| Apa fokusnya? | Menjalankan use case | Mengambil keputusan domain |
| Tahu transaction? | Ya | Tidak |
| Tahu repository? | Biasanya ya via port | Sebaiknya tidak |
| Tahu HTTP? | Tidak langsung | Tidak |
| Tahu framework? | Bisa, tapi dibatasi | Sebaiknya tidak |
| Mengandung rule bisnis? | Memanggil rule | Memiliki rule yang tidak cocok di entity |
| Stateless? | Biasanya | Hampir selalu |
| Unit test tanpa DB? | Bisa dengan mock/fake | Harus mudah |

---

## 8. Transaction Script in Depth

### 8.1 Transaction Script bukan dosa

Kadang solution terbaik adalah prosedur sederhana.

Contoh:

```java
@Transactional
public void updateLastLogin(UserId userId, Instant at) {
    userRepository.updateLastLogin(userId, at);
}
```

Membuat rich domain model untuk operasi ini bisa overengineering.

Top engineer bukan orang yang selalu memakai pattern paling kompleks. Top engineer tahu kapan boring code cukup.

---

### 8.2 Kapan Transaction Script cocok?

Cocok jika:

1. operasi data sederhana,
2. rule sedikit dan stabil,
3. low domain complexity,
4. tidak banyak state transition,
5. tidak perlu reuse rule lintas use case,
6. performance dan simplicity lebih penting,
7. lifecycle object tidak kompleks.

Contoh cocok:

- mark notification as read,
- update last login,
- store audit entry,
- increment view count,
- export simple report,
- simple admin maintenance operation.

---

### 8.3 Kapan Transaction Script mulai berbahaya?

Mulai berbahaya jika muncul tanda:

```text
1 method > 50-80 lines
banyak status check
banyak role/permission check
banyak nested if
banyak external call
banyak duplicated rule
banyak comment menjelaskan business decision
banyak boolean flag
banyak partial update side effect
```

Contoh smell:

```java
if (type.equals("A") && status.equals("PENDING") && role.equals("OFFICER")) { ... }
else if (type.equals("B") && risk > 70 && region.equals("CENTRAL")) { ... }
else if (...) { ... }
```

Ini biasanya bukan lagi transaction script sederhana. Ini rule engine liar.

---

## 9. Rich Domain Model vs Transaction Script

### 9.1 Rich Domain Model

Rich Domain Model berarti domain object memiliki behavior, bukan hanya getter/setter.

Contoh:

```java
public final class CaseFile {
    private CaseStatus status;
    private RiskScore riskScore;
    private OfficerId approvedBy;
    private Instant approvedAt;

    public ApprovalOutcome approve(Officer officer, ApprovalComment comment, ApprovalPolicy policy, Instant now) {
        policy.requireApprovalAllowed(this, officer, comment);

        CaseStatus next = policy.nextStatusAfterApproval(this);
        this.status = next;
        this.approvedBy = officer.id();
        this.approvedAt = now;

        return ApprovalOutcome.of(id, next, officer.id(), now);
    }
}
```

Keuntungan:

- invariant dekat dengan data,
- state transition eksplisit,
- duplicate rule berkurang,
- test domain bisa cepat,
- bahasa domain lebih kuat,
- service lebih tipis.

Kerugian:

- butuh desain lebih matang,
- butuh boundary jelas dengan persistence,
- bisa overkill untuk CRUD sederhana,
- bisa bentrok dengan ORM lazy loading jika tidak hati-hati,
- perlu disiplin tim.

---

### 9.2 Transaction Script

Transaction Script berarti prosedur use case memanipulasi data secara langsung.

Keuntungan:

- mudah dipahami untuk kasus sederhana,
- cepat ditulis,
- cocok untuk CRUD/report/admin,
- tidak banyak class,
- dependency jelas di satu tempat.

Kerugian:

- sulit tumbuh jika rule kompleks,
- mudah duplicate,
- state transition tersembunyi,
- testing cenderung integration-heavy,
- domain language lemah,
- service membengkak.

---

### 9.3 Decision matrix

| Kondisi | Pilihan cenderung lebih tepat |
|---|---|
| CRUD sederhana | Transaction Script |
| Report/query/read model | Transaction Script / Query Service |
| Lifecycle kompleks | Rich Domain Model / State Machine |
| Banyak rule bisnis | Domain Model + Policy/Specification |
| Banyak external orchestration | Application Service / Orchestrator |
| Banyak variasi algoritma | Strategy/Policy |
| Banyak transition dan audit | State Machine / Workflow Object |
| Banyak side effect async | Application Service + Outbox/Event |
| Banyak data transformation | Mapper/Assembler/Gateway |

---

## 10. Transaction Boundary

### 10.1 Transaction boundary adalah design decision

Dalam Java enterprise, `@Transactional` sering dipasang otomatis pada service.

Masalahnya: banyak engineer lupa bahwa transaction boundary bukan detail teknis. Itu keputusan desain.

Pertanyaan penting:

```text
Apa saja perubahan yang harus commit/rollback bersama?
Apa yang tidak boleh berada di dalam database transaction?
Apa yang harus terjadi setelah commit?
Apa yang boleh gagal tanpa membatalkan use case?
Apa yang harus idempotent?
```

---

### 10.2 External call dalam transaction

Anti-pattern umum:

```java
@Transactional
public void approve(...) {
    caseRepository.save(caseFile);
    emailClient.send(...);
    externalGateway.sync(...);
}
```

Masalah:

1. transaction database tertahan selama network call,
2. external call bisa berhasil tetapi DB rollback,
3. DB commit bisa berhasil tetapi external call gagal,
4. retry method bisa mengirim email dua kali,
5. lock duration meningkat,
6. latency melebar,
7. failure semantics tidak jelas.

Lebih aman:

```java
@Transactional
public void approve(...) {
    ApprovalOutcome outcome = caseFile.approve(...);
    caseRepository.save(caseFile);
    outbox.add(CaseApprovedEvent.from(outcome));
}
```

Lalu worker async memproses outbox.

---

### 10.3 Transaction should protect invariant, not everything

Transaction harus melindungi invariant data.

Contoh invariant:

```text
Case yang sudah APPROVED harus punya approvedBy dan approvedAt.
Tidak boleh ada dua active assignment untuk case yang sama.
Renewal application tidak boleh double-submit dengan same idempotency key.
Payment status tidak boleh PAID tanpa payment reference.
```

Transaction tidak harus mencakup:

- email sending,
- notification push,
- remote API sync,
- report generation panjang,
- file upload besar,
- third-party callback lambat.

---

## 11. Use Case Boundary

### 11.1 One application service per aggregate atau per use case?

Dua gaya umum:

#### Gaya A — Aggregate-oriented service

```java
public class CaseApplicationService {
    public void submit(...)
    public void approve(...)
    public void reject(...)
    public void close(...)
    public void reopen(...)
}
```

Keuntungan:

- discoverability mudah,
- related operations di satu tempat,
- dependency reuse.

Risiko:

- menjadi GodService,
- dependency list membengkak,
- method saling share helper private yang ambigu,
- sulit isolate use case.

#### Gaya B — Use-case-oriented handler

```java
public class SubmitCaseHandler { ... }
public class ApproveCaseHandler { ... }
public class RejectCaseHandler { ... }
public class CloseCaseHandler { ... }
```

Keuntungan:

- class kecil,
- dependency tepat guna,
- test fokus,
- traceability per use case.

Risiko:

- banyak class,
- navigasi perlu struktur package rapi,
- shared workflow bisa duplicated,
- handler boilerplate.

---

### 11.2 Heuristic pemilihan

Gunakan aggregate-oriented service jika:

- jumlah use case sedikit,
- logic masih sederhana,
- dependency hampir sama,
- tim butuh navigasi sederhana.

Gunakan use-case-oriented handler jika:

- use case banyak,
- dependency berbeda-beda,
- audit/traceability tinggi,
- tiap operation punya rule kompleks,
- workflow regulatory penting,
- command/event style dipakai.

Dalam sistem enterprise besar, use-case-oriented handler sering lebih sustainable.

---

## 12. Anti-Pattern Catalog

### 12.1 God Service

Ciri:

```text
Class 1000+ lines
Dependency 15+
Method 50+
Private helper banyak
Nama generic: CaseService, ApplicationService, CommonService
Semua flow penting ada di satu class
```

Contoh:

```java
@Service
public class ApplicationService {
    public void submitApplication(...) { ... }
    public void approveApplication(...) { ... }
    public void rejectApplication(...) { ... }
    public void renewApplication(...) { ... }
    public void calculateFee(...) { ... }
    public void sendReminder(...) { ... }
    public void generateReport(...) { ... }
    public void syncExternal(...) { ... }
}
```

Dampak:

- sulit diuji,
- sulit di-review,
- merge conflict tinggi,
- perubahan kecil berisiko luas,
- dependency graph berat,
- ownership tidak jelas.

Refactoring:

1. kelompokkan method per use case,
2. extract command handler,
3. extract domain policy,
4. extract gateway,
5. extract audit/event publishing,
6. pindahkan invariant ke domain object,
7. buat package per feature/use case.

---

### 12.2 Anemic Domain Model

Ciri:

```text
Entity hanya getter/setter
Semua business rule ada di service
Status diubah langsung dari luar
Invariant tidak terlindungi
```

Contoh:

```java
caseEntity.setStatus("APPROVED");
caseEntity.setApprovedBy(userId);
caseEntity.setApprovedAt(now);
```

Masalah:

Tidak ada yang mencegah code lain melakukan:

```java
caseEntity.setStatus("APPROVED");
// lupa set approvedBy dan approvedAt
```

Refactoring:

```java
caseFile.approveBy(officer, comment, now);
```

Jangan expose setter untuk state penting.

---

### 12.3 Service Calling Service Maze

Ciri:

```text
AService -> BService -> CService -> DService
Sulit tahu transaction boundary
Sulit tahu siapa owner rule
Circular dependency muncul
Side effect tersebar
```

Contoh:

```java
public class CaseService {
    public void approve(...) {
        validationService.validateCase(...);
        userService.checkPermission(...);
        workflowService.move(...);
        notificationService.notify(...);
        auditService.audit(...);
    }
}
```

Tidak semua pemanggilan service buruk. Yang buruk adalah jika setiap service juga memanggil service lain dan tidak ada boundary yang jelas.

Perbaikan:

- bedakan application service vs domain service vs infrastructure service,
- application service boleh orchestrate,
- domain service jangan memanggil application service,
- external service dipanggil via port/gateway,
- side effect async jika perlu.

---

### 12.4 Manager/Helper/Util Abuse

Ciri:

```java
CaseManager
ApplicationHelper
BusinessUtil
CommonValidationService
```

Nama seperti ini sering berarti desain belum menemukan responsibility sebenarnya.

Tanya:

```text
Apa konsep domain yang sedang dimodelkan?
Apakah ini policy?
Apakah ini calculator?
Apakah ini factory?
Apakah ini validator?
Apakah ini gateway?
Apakah ini assembler?
Apakah ini state machine?
```

Rename berdasarkan tanggung jawab nyata:

| Nama buruk | Nama lebih baik |
|---|---|
| CaseHelper | CaseNumberFormatter / CaseEligibilityPolicy |
| BusinessUtil | RenewalWindowCalculator |
| ApplicationManager | ApplicationSubmissionUseCase |
| ValidationService | AppealSubmissionPolicy |
| CommonService | Jangan buat dulu; cari konsepnya |

---

### 12.5 Transactional Everything

Ciri:

```java
@Transactional
public class AllServices { ... }
```

Atau semua method diberi transaction walaupun hanya read, external call, atau CPU-only calculation.

Risiko:

- lock tidak perlu,
- transaction panjang,
- hidden DB session dependency,
- lazy loading bocor,
- sulit reasoning side effect,
- false sense of consistency.

Gunakan transaction secara eksplisit berdasarkan invariant.

---

### 12.6 Domain Service with Infrastructure Dependency

Buruk:

```java
public class EligibilityPolicy {
    private final JdbcTemplate jdbc;
    private final ExternalApiClient client;
}
```

Jika policy domain langsung tahu DB dan API eksternal, ia bukan domain service murni. Ia menjadi application/infrastructure hybrid.

Lebih baik:

```java
public boolean isEligible(Applicant applicant, LicenseHistory history, OutstandingPayment payment) {
    ...
}
```

Application service yang mengambil `LicenseHistory` dan `OutstandingPayment`.

---

### 12.7 Transaction Script Masquerading as Domain Model

Ciri:

```java
caseFile.setX(...)
caseFile.setY(...)
caseFile.setZ(...)
```

Lalu method diberi nama domain:

```java
approveCaseFile(caseFile)
```

Tetapi sebenarnya domain object tetap pasif.

Perbaikan:

```java
caseFile.approve(...)
```

Domain object harus menjaga invariant sendiri.

---

## 13. Refactoring Path: Dari God Service ke Desain Lebih Sehat

Misalkan awalnya:

```java
public class CaseService {
    public void approve(...) { huge method }
    public void reject(...) { huge method }
    public void assign(...) { huge method }
    public void escalate(...) { huge method }
}
```

### Step 1 — Characterization test

Sebelum refactor, capture behavior existing.

```java
@Test
void approvePendingLowRiskCaseMarksApproved() {
    // arrange existing database/fake repository state
    // call old service
    // assert status, audit, event, side effects
}
```

Target: jangan mengubah behavior tanpa sadar.

---

### Step 2 — Extract command object

Dari parameter panjang:

```java
approve(Long caseId, String officerId, String comment, Boolean urgent, String source)
```

Menjadi:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        ApprovalComment comment,
        RequestSource source,
        IdempotencyKey idempotencyKey
) {}
```

Manfaat:

- parameter meaning jelas,
- mudah validasi,
- extensible,
- traceable.

---

### Step 3 — Extract authorization policy

Sebelum:

```java
if (!user.hasRole("APPROVER") || !user.getRegion().equals(case.region())) {
    throw new ForbiddenException();
}
```

Sesudah:

```java
authorizationPolicy.requireCanApprove(officer, caseFile);
```

---

### Step 4 — Extract domain behavior

Sebelum:

```java
case.setStatus("APPROVED");
case.setApprovedBy(userId);
case.setApprovedAt(now);
```

Sesudah:

```java
ApprovalOutcome outcome = caseFile.approveBy(officer, comment, now);
```

---

### Step 5 — Extract policy/specification

Jika approval punya banyak variasi:

```java
ApprovalOutcome outcome = approvalPolicy.approve(caseFile, officer, comment, now);
```

Atau:

```java
caseFile.approve(officer, comment, approvalPolicy, now);
```

Pilih berdasarkan ownership rule.

---

### Step 6 — Move side effect to outbox/event

Sebelum:

```java
emailClient.send(...);
externalClient.sync(...);
```

Sesudah:

```java
outbox.add(CaseApprovedEvent.from(outcome));
```

Email dan external sync diproses setelah commit.

---

### Step 7 — Split use case handler

```java
public final class ApproveCaseHandler {
    public ApprovalResult handle(ApproveCaseCommand command) { ... }
}
```

Lakukan jika service sudah terlalu besar.

---

### Step 8 — Introduce package boundary

Contoh struktur:

```text
case/
  approval/
    ApproveCaseCommand.java
    ApproveCaseHandler.java
    ApprovalResult.java
    ApprovalPolicy.java
    ApprovalOutcome.java
  assignment/
    AssignCaseCommand.java
    AssignCaseHandler.java
    AssignmentPolicy.java
  domain/
    CaseFile.java
    CaseStatus.java
    CaseId.java
  port/
    CaseRepository.java
    Outbox.java
  adapter/
    JpaCaseRepository.java
```

Ini lebih jelas daripada:

```text
service/
repository/
entity/
dto/
util/
```

---

## 14. Java 8–25 Perspective

### 14.1 Java 8: functional interface membantu policy kecil

```java
@FunctionalInterface
public interface ApprovalRule {
    ApprovalDecision evaluate(CaseFile caseFile, Officer officer);
}
```

```java
ApprovalRule lowRiskRule = (caseFile, officer) ->
        caseFile.riskScore().isLow()
                ? ApprovalDecision.allowed("Low risk")
                : ApprovalDecision.notApplicable();
```

Cocok untuk rule kecil, tetapi jangan semua domain logic dibuat lambda anonim jika butuh nama, audit, dan testability.

---

### 14.2 Records untuk command/result/value object

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        ApprovalComment comment,
        IdempotencyKey idempotencyKey
) {
    public ApproveCaseCommand {
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(officerId);
        Objects.requireNonNull(comment);
        Objects.requireNonNull(idempotencyKey);
    }
}
```

Records bagus untuk:

- command,
- result,
- value object sederhana,
- event payload,
- query criteria.

Tetapi jangan jadikan record sebagai domain object mutable/lifecycle entity.

---

### 14.3 Sealed classes untuk result/error/outcome

```java
public sealed interface ApprovalResult
        permits ApprovalResult.Approved,
                ApprovalResult.SecondApprovalRequired,
                ApprovalResult.Rejected {

    record Approved(CaseId caseId) implements ApprovalResult {}
    record SecondApprovalRequired(CaseId caseId, String reason) implements ApprovalResult {}
    record Rejected(CaseId caseId, String reason) implements ApprovalResult {}
}
```

Ini membantu application service mengembalikan outcome yang eksplisit.

---

### 14.4 Pattern matching switch untuk outcome handling

```java
String message = switch (result) {
    case ApprovalResult.Approved approved -> "Approved " + approved.caseId();
    case ApprovalResult.SecondApprovalRequired second -> "Needs second approval: " + second.reason();
    case ApprovalResult.Rejected rejected -> "Rejected: " + rejected.reason();
};
```

Ini lebih aman daripada string status.

---

### 14.5 Virtual threads dan service design

Java modern membuat blocking per request lebih murah dengan virtual threads, tetapi tidak menghapus kebutuhan boundary yang jelas.

Virtual threads membantu:

- simpler imperative code,
- blocking repository/client code lebih scalable,
- mengurangi callback spaghetti.

Tetapi tetap perlu:

- timeout,
- cancellation,
- transaction boundary,
- connection pool sizing,
- idempotency,
- external call isolation.

Jangan menganggap virtual threads membuat external call dalam DB transaction menjadi aman.

---

## 15. Testing Strategy

### 15.1 Test pyramid untuk service design

| Layer | Test type | Fokus |
|---|---|---|
| Domain object | Unit test | invariant, transition, calculation |
| Domain service/policy | Unit test | rule matrix, edge case |
| Application service | Unit/integration with fake ports | orchestration, transaction, authorization, outbox |
| Repository adapter | Integration test | persistence mapping/query |
| Gateway adapter | Contract/integration test | external payload/error mapping |
| End-to-end | Few | complete flow confidence |

---

### 15.2 Testing application service dengan fake port

```java
@Test
void approveCaseStoresCaseAndCreatesOutboxEvent() {
    FakeCaseRepository caseRepository = new FakeCaseRepository();
    FakeOutbox outbox = new FakeOutbox();
    Clock fixedClock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);

    CaseFile caseFile = CaseFile.pending(new CaseId("CASE-1"));
    caseRepository.save(caseFile);

    ApproveCaseApplicationService service = new ApproveCaseApplicationService(
            caseRepository,
            new FakeOfficerRepository(Officer.approver("OFFICER-1")),
            new AllowingAuthorizationPolicy(),
            outbox,
            fixedClock
    );

    ApprovalResult result = service.approve(new ApproveCaseCommand(
            new CaseId("CASE-1"),
            new OfficerId("OFFICER-1"),
            ApprovalComment.of("Reviewed and approved"),
            new IdempotencyKey("REQ-1")
    ));

    assertEquals(CaseStatus.APPROVED, caseRepository.get(new CaseId("CASE-1")).status());
    assertEquals(1, outbox.events().size());
}
```

Application service test tidak harus selalu memakai database asli jika port bisa difake.

---

### 15.3 Testing domain service rule matrix

```java
@ParameterizedTest
@MethodSource("approvalCases")
void approvalPolicyProducesExpectedDecision(CaseFile caseFile, Officer officer, ApprovalDecision expected) {
    ApprovalPolicy policy = new ApprovalPolicy();

    ApprovalDecision actual = policy.evaluate(caseFile, officer);

    assertEquals(expected, actual);
}
```

Rule matrix penting untuk domain yang regulatory/defensible.

---

## 16. Observability and Audit Angle

Service design yang baik harus memudahkan debugging.

Untuk application service, log yang berguna bukan:

```text
Entering approve
Leaving approve
```

Tetapi:

```text
use_case=approve_case case_id=CASE-1 officer_id=OFFICER-1 result=APPROVED decision=LOW_RISK_APPROVAL duration_ms=42 outbox_events=1
```

### 16.1 Apa yang perlu diamati?

1. use case name,
2. command/request id,
3. actor/principal id,
4. aggregate id,
5. current state,
6. target state,
7. decision code,
8. policy version,
9. transaction duration,
10. outbox event count,
11. failure classification,
12. idempotency hit/miss.

### 16.2 Audit bukan logging biasa

Audit harus menjawab:

```text
Siapa melakukan apa?
Kapan?
Terhadap entity apa?
Dari state apa ke state apa?
Berdasarkan rule/authority apa?
Apa alasan/komentar/evidence?
Apa correlation id-nya?
```

Jangan menyimpan audit sebagai string bebas jika butuh regulatory defensibility.

Lebih baik:

```java
public record AuditRecord(
        String action,
        String actorId,
        String targetType,
        String targetId,
        String beforeState,
        String afterState,
        String reasonCode,
        String correlationId,
        Instant occurredAt
) {}
```

---

## 17. Security Angle

Authorization sering salah tempat.

### 17.1 Authorization di controller saja tidak cukup

Buruk:

```java
@PreAuthorize("hasRole('APPROVER')")
@PostMapping("/cases/{id}/approve")
public Response approve(...) {
    service.approve(...);
}
```

Ini hanya mengecek role umum. Ia tidak menjawab:

- apakah officer boleh approve case region ini?
- apakah officer conflict of interest?
- apakah officer boleh approve amount/risk level ini?
- apakah case sedang locked?
- apakah delegation aktif?

Application service/domain policy perlu authorization yang context-aware.

```java
authorizationPolicy.requireCanApprove(officer, caseFile);
```

### 17.2 Jangan campur authorization dengan domain transition secara kacau

Authorization menjawab:

```text
Apakah actor boleh melakukan action?
```

Domain invariant menjawab:

```text
Apakah action valid untuk object ini?
```

Dua-duanya bisa gagal, tetapi maknanya berbeda.

---

## 18. Performance Consideration

Service design memengaruhi performance.

### 18.1 God service dan hidden N+1

Service yang memanggil banyak repository dalam loop sering menyembunyikan N+1.

Buruk:

```java
for (CaseFile c : cases) {
    Officer officer = officerRepository.get(c.assignedOfficerId());
    Region region = regionRepository.get(c.regionId());
    ...
}
```

Lebih baik:

- batch load,
- query projection,
- dedicated query service,
- read model,
- avoid rich aggregate for reporting.

### 18.2 Jangan gunakan rich domain model untuk semua read path

Untuk query/report/dashboard, sering lebih baik memakai query model/projection daripada load aggregate lengkap.

```text
Command/write use case: domain model penting.
Read/report use case: query model/projection sering lebih efisien.
```

---

## 19. Package Design

### 19.1 Package-by-layer

```text
controller/
service/
repository/
entity/
dto/
```

Kelebihan:

- familiar,
- sederhana,
- mudah untuk aplikasi kecil.

Kekurangan:

- feature tersebar,
- service layer membengkak,
- dependency antar feature tidak terlihat,
- boundary domain lemah.

### 19.2 Package-by-feature/use case

```text
caseapproval/
  ApproveCaseCommand.java
  ApproveCaseHandler.java
  ApprovalPolicy.java
  ApprovalResult.java
  CaseApprovalController.java
```

Atau modular:

```text
case/
  domain/
  approval/
  assignment/
  repository/
  adapter/
```

Kelebihan:

- ownership jelas,
- navigasi use case mudah,
- dependency lebih lokal,
- cocok untuk complex domain.

Kekurangan:

- butuh disiplin,
- shared code harus dikontrol,
- bisa terjadi duplication ringan.

Duplication ringan kadang lebih murah daripada coupling berat.

---

## 20. Design Review Checklist

Gunakan pertanyaan ini saat review service/application design.

### 20.1 Responsibility

```text
Apakah class ini application service, domain service, gateway, repository, policy, atau helper tidak jelas?
Apakah nama class menggambarkan domain/use case?
Apakah ada method yang mengambil terlalu banyak keputusan domain?
Apakah ada entity yang hanya getter/setter padahal punya invariant?
```

### 20.2 Transaction

```text
Apa yang berada dalam transaction?
Apa yang terjadi setelah commit?
Apakah ada external call di dalam transaction?
Apakah rollback semantics jelas?
Apakah idempotency dibutuhkan?
```

### 20.3 Domain logic

```text
Apakah rule domain berada dekat dengan data/invariant?
Apakah rule duplicated antar service?
Apakah state transition eksplisit?
Apakah illegal transition ditangani jelas?
Apakah domain service bebas framework?
```

### 20.4 Side effect

```text
Apakah email/API/event dilakukan sinkron atau via outbox?
Jika side effect gagal, apa efeknya ke transaksi utama?
Apakah side effect idempotent?
Apakah event punya enough context?
```

### 20.5 Testing

```text
Bisakah domain rule dites tanpa DB?
Bisakah application flow dites dengan fake ports?
Apakah integration test hanya untuk adapter/persistence?
Apakah ada characterization test sebelum refactor?
```

### 20.6 Observability

```text
Apakah log menunjukkan use case, actor, aggregate, decision, result?
Apakah audit event structured?
Apakah failure classification jelas?
Apakah correlation id diteruskan?
```

---

## 21. Common Staff-Level Discussion

### 21.1 “Apakah semua business logic harus di domain model?”

Tidak.

Business logic ada beberapa jenis:

| Jenis logic | Tempat umum |
|---|---|
| Invariant entity/value object | Domain model |
| Rule lintas object | Domain service/policy |
| Use case flow | Application service |
| Persistence query | Repository/query service |
| External translation | Gateway/adapter |
| Presentation formatting | Presenter/controller |
| Security context permission | Authorization policy/application boundary |

Kalimat “business logic harus di service” atau “business logic harus di domain” terlalu kasar.

Yang benar: tempatkan logic berdasarkan ownership dan failure mode.

---

### 21.2 “Apakah anemic domain model selalu buruk?”

Tidak selalu.

Untuk CRUD sederhana, anemic model + transaction script bisa cukup.

Tetapi untuk domain dengan lifecycle, state transition, auditability, dan regulatory rule, anemic model sering menjadi sumber risiko karena invariant tidak terlindungi.

---

### 21.3 “Apakah setiap use case harus punya handler sendiri?”

Tidak.

Gunakan handler per use case jika complexity dan dependency per operation berbeda signifikan.

Jika operasi masih sederhana dan related, satu application service per aggregate bisa cukup.

---

### 21.4 “Apakah service boleh memanggil service lain?”

Boleh, tetapi perlu jelas level-nya.

Application service boleh memanggil domain service, policy, gateway port, repository, outbox.

Yang berbahaya adalah application service memanggil application service lain secara bebas sehingga use case boundary kabur.

---

### 21.5 “Bagaimana dengan Spring `@Service`?”

`@Service` adalah stereotype/framework annotation. Ia tidak otomatis berarti class tersebut adalah domain service atau application service secara desain.

Class dengan `@Service` bisa saja:

- application service,
- domain service yang didaftarkan sebagai bean,
- gateway implementation,
- orchestrator,
- helper yang salah desain.

Jangan biarkan annotation menggantikan design vocabulary.

---

## 22. Practical Heuristics

### 22.1 Jika method service membesar

Tanya:

```text
Apakah ada command object yang perlu dibuat?
Apakah ada policy yang perlu diekstrak?
Apakah ada state transition yang perlu dimodelkan?
Apakah ada gateway yang bocor?
Apakah ada mapper/assembler yang tersembunyi?
Apakah ada side effect yang harus via outbox?
Apakah ada domain primitive yang hilang?
```

### 22.2 Jika domain object terlalu pasif

Tanya:

```text
Apa invariant object ini?
Apa operasi valid pada object ini?
Siapa yang boleh mengubah status?
Field mana yang harus berubah bersama?
Apakah setter harus ditutup?
```

### 22.3 Jika domain service terlalu banyak dependency

Tanya:

```text
Apakah ini sebenarnya application service?
Apakah data harus diambil sebelum masuk domain service?
Apakah rule terlalu bercampur infrastructure?
Apakah perlu port yang lebih domain-specific?
```

---

## 23. Case Study: Approval Use Case Refactoring

### 23.1 Before

```java
@Service
public class CaseService {

    @Transactional
    public void approve(Long caseId, String officerId, String comment) {
        CaseEntity entity = caseRepository.findById(caseId).orElseThrow();
        UserEntity officer = userRepository.findById(officerId).orElseThrow();

        if (!officer.hasRole("APPROVER")) throw new ForbiddenException();
        if (!entity.getStatus().equals("PENDING")) throw new BadRequestException();
        if (comment == null || comment.isBlank()) throw new BadRequestException();

        if (entity.getRiskScore() > 80) {
            entity.setStatus("SECOND_APPROVAL_REQUIRED");
        } else {
            entity.setStatus("APPROVED");
        }

        entity.setApprovedBy(officerId);
        entity.setApprovedAt(LocalDateTime.now());

        caseRepository.save(entity);
        auditRepository.save(...);
        emailClient.send(...);
    }
}
```

### 23.2 Problems

```text
Status string primitive
Authorization inline
Comment validation inline
Risk policy inline
State transition inline
Audit unstructured
Email inside transaction
Entity setter exposed
No idempotency
No explicit outcome
```

### 23.3 After

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        ApprovalComment comment,
        IdempotencyKey idempotencyKey
) {}
```

```java
public final class ApproveCaseApplicationService {

    private final CaseRepository caseRepository;
    private final OfficerRepository officerRepository;
    private final ApprovalAuthorizationPolicy authorization;
    private final ApprovalPolicy approvalPolicy;
    private final Outbox outbox;
    private final AuditTrail auditTrail;
    private final Clock clock;

    @Transactional
    public ApprovalResult approve(ApproveCaseCommand command) {
        CaseFile caseFile = caseRepository.get(command.caseId());
        Officer officer = officerRepository.get(command.officerId());

        authorization.requireCanApprove(officer, caseFile);

        ApprovalOutcome outcome = caseFile.approve(
                officer,
                command.comment(),
                approvalPolicy,
                clock.instant()
        );

        caseRepository.save(caseFile);
        auditTrail.record(outcome.auditRecord());
        outbox.add(outcome.integrationEvent());

        return ApprovalResult.from(outcome);
    }
}
```

```java
public final class CaseFile {
    private CaseStatus status;
    private OfficerId approvedBy;
    private Instant approvedAt;

    public ApprovalOutcome approve(
            Officer officer,
            ApprovalComment comment,
            ApprovalPolicy policy,
            Instant now
    ) {
        ApprovalDecision decision = policy.evaluate(this, officer, comment);
        if (!decision.allowed()) {
            throw new ApprovalNotAllowedException(decision.reason());
        }

        CaseStatus next = decision.nextStatus();
        this.status = next;
        this.approvedBy = officer.id();
        this.approvedAt = now;

        return new ApprovalOutcome(id, next, officer.id(), decision.reason(), now);
    }
}
```

### 23.4 What improved?

| Aspect | Before | After |
|---|---|---|
| Transition | hidden setter logic | domain behavior |
| Authorization | inline | policy |
| Risk decision | inline if | approval policy |
| Side effect | email in transaction | outbox |
| Audit | repository save arbitrary | structured outcome |
| Testing | service integration-heavy | domain/application split |
| Failure semantics | unclear | explicit outcome/event |
| Evolvability | service grows | policy/model evolve |

---

## 24. Summary

Inti Part 18:

```text
Service Layer bukan tempat semua business logic.
Application Service mengatur use case flow.
Domain Service mengambil keputusan domain lintas object.
Domain Object menjaga invariant miliknya.
Transaction Script boleh dipakai untuk operasi sederhana.
Transaction boundary adalah keputusan desain, bukan sekadar annotation.
God Service biasanya muncul saat orchestration, decision, persistence, integration, audit, dan presentation tercampur.
```

Pattern mastery di area ini bukan berarti selalu membuat rich domain model dan banyak class.

Pattern mastery berarti mampu menjawab:

```text
Apa owner logic ini?
Apa invariant yang harus dilindungi?
Apa yang harus atomic?
Apa yang boleh async?
Apa yang harus diaudit?
Apa yang harus bisa diuji tanpa database?
Apa yang akan berubah paling sering?
Apa coupling tersembunyi jika logic tetap di service?
```

Jika kamu bisa menjawab itu dengan konsisten, kamu tidak lagi hanya menulis `Service`. Kamu mulai mendesain application boundary.

---

## 25. Latihan Mandiri

Ambil satu service method dari codebase nyata, lalu jawab:

1. Apa use case name yang paling tepat?
2. Apa command object-nya?
3. Apa domain object utama?
4. Apa invariant yang harus dijaga?
5. Apa authorization rule-nya?
6. Apa domain policy yang tersembunyi?
7. Apa side effect yang tidak seharusnya berada dalam transaction?
8. Apa event/outbox yang perlu dibuat?
9. Apa audit record yang harus structured?
10. Apakah lebih cocok transaction script atau rich domain model?

Kemudian coba refactor secara bertahap tanpa big bang rewrite.

---

## 26. Status Seri

```text
Part 18 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
19-repository-dao-data-mapper-unit-of-work-query-object.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./17-data-domain-modeling-patterns-records-sealed-value-objects.md">⬅️ Data and Domain Modeling Patterns with Modern Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./19-repository-dao-data-mapper-unit-of-work-query-object.md">Repository, DAO, Data Mapper, Unit of Work, Query Object ➡️</a>
</div>
