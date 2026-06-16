# Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Bagian: `002 / 032`  
> Target pembaca: Java engineer tingkat advanced yang ingin memahami persistence bukan sebagai CRUD, tetapi sebagai boundary arsitektural antara domain, database, transaksi, query, integrasi, dan operasi produksi.  
> Rentang relevansi: Java 8 sampai Java 25; JPA 2.x `javax.persistence`; Jakarta Persistence 3.x `jakarta.persistence`; Hibernate ORM 5/6/7; Spring Data JPA; Jakarta Data; Jakarta Transactions.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan dengan jelas antara **domain model**, **persistence entity**, **DTO**, **command model**, **read model**, dan **projection**.
2. Mendesain arah dependency agar persistence detail tidak merusak domain/application layer.
3. Menentukan kapan entity JPA boleh merangkap domain model dan kapan harus dipisah.
4. Menentukan batas tanggung jawab antara repository, service/application layer, entity, database constraint, dan transaction boundary.
5. Menghindari anti-pattern umum seperti entity bocor ke API, generic repository berlebihan, `@Transactional` tersebar acak, dan repository yang berubah menjadi dump semua query.
6. Mendesain persistence architecture untuk aplikasi enterprise besar, termasuk case management, regulatory workflow, approval, audit, dan reporting.
7. Memahami bahwa arsitektur persistence yang baik bukan tentang jumlah layer terbanyak, tetapi tentang **invariant ownership**, **change isolation**, **query intent**, dan **failure containment**.

---

## 2. Big Mental Model

Persistence architecture adalah keputusan tentang **di mana kebenaran sistem ditempatkan**.

Banyak engineer melihat persistence layer sebagai:

```text
Controller -> Service -> Repository -> Database
```

Model ini terlalu dangkal. Untuk aplikasi kecil, mungkin cukup. Untuk aplikasi kompleks, terutama yang memiliki workflow, approval, audit, regulatory defensibility, high concurrency, dan reporting, model tersebut menyembunyikan banyak boundary penting.

Model yang lebih realistis:

```text
External Request / Message / Job
        |
        v
Application Use Case Boundary
        |
        |-- validates command intent
        |-- opens transaction boundary
        |-- coordinates domain behavior
        |-- calls repository/query port
        |-- emits domain/application events
        |
        v
Domain / Business Model
        |
        |-- protects invariants
        |-- models state transitions
        |-- rejects invalid changes
        |
        v
Persistence Adapter
        |
        |-- maps domain/entity to database representation
        |-- executes query plan
        |-- controls fetch strategy
        |-- handles persistence-specific exceptions
        |
        v
Database
        |
        |-- enforces hard constraints
        |-- provides isolation and locking
        |-- stores source-of-truth state
        |-- exposes physical performance reality
```

Hal utama: **database is not just storage**. Database adalah consistency engine, constraint engine, concurrency control engine, query engine, dan operational component.

JPA/Hibernate juga bukan hanya mapper object-table. Ia membawa konsep:

- persistence context,
- identity map,
- unit of work,
- dirty checking,
- lazy loading,
- flush ordering,
- transactional write-behind,
- association graph,
- query language,
- cache,
- optimistic/pessimistic locking.

Karena itu, persistence architecture harus memutuskan:

- Siapa yang boleh membuat entity menjadi managed?
- Siapa yang menentukan transaction boundary?
- Siapa yang menentukan fetch plan?
- Siapa yang boleh melakukan mutation?
- Siapa yang menerjemahkan exception database menjadi error aplikasi?
- Siapa yang bertanggung jawab terhadap invariant?
- Siapa yang boleh tahu detail ORM/provider?

Kalau keputusan ini tidak eksplisit, aplikasi akan tumbuh menjadi sistem yang sulit diprediksi.

---

## 3. Persistence Architecture Bukan Sekadar Layering

Layering biasanya digambarkan seperti ini:

```text
Controller
Service
Repository
Entity
Database
```

Masalahnya, diagram ini tidak menjawab pertanyaan arsitektural penting:

1. Apakah `Entity` adalah domain object atau database row object?
2. Apakah `Service` berisi business logic atau hanya transaction script?
3. Apakah `Repository` mewakili aggregate collection atau hanya query utility?
4. Apakah DTO boleh langsung di-map ke entity?
5. Apakah lazy loading boleh terjadi di controller?
6. Apakah API boleh return entity?
7. Apakah transaction dibuka di controller, service, repository, listener, atau job?
8. Apakah reporting query harus melewati aggregate/domain model?
9. Apakah database constraint dianggap bagian dari domain invariant?
10. Apakah exception persistence boleh bocor ke API layer?

Layering yang baik bukan sekadar banyak kotak. Layering yang baik harus memberikan **separation of responsibility**.

Tiga boundary yang paling penting:

```text
1. Intent boundary
   Apa yang user/system ingin lakukan?

2. Consistency boundary
   Perubahan apa yang harus atomik dan invariant apa yang harus dijaga?

3. Representation boundary
   Bentuk data apa yang dipakai oleh API, domain, persistence, dan database?
```

Kalau tiga boundary ini dicampur, biasanya muncul gejala:

- controller terlalu tahu struktur database,
- entity terlalu mirip JSON request,
- service hanya memindahkan field,
- repository menjadi tempat business rule,
- transaction boundary tidak jelas,
- query menjadi tidak terkontrol,
- N+1 sulit dilacak,
- audit sulit dipercaya,
- concurrency bug muncul di production.

---

## 4. Vocabulary: Model yang Sering Tertukar

Sebelum membahas arsitektur, kita harus menertibkan istilah.

### 4.1 Domain Model

Domain model adalah representasi konsep bisnis dan aturan yang penting bagi sistem.

Contoh dalam sistem case management:

```text
Case
Appeal
OfficerAssignment
ComplianceInspection
NoticeOfIntent
EnforcementAction
ApprovalRoute
DocumentSubmission
```

Domain model menjawab:

- state apa yang valid?
- transisi apa yang diperbolehkan?
- siapa yang boleh melakukan aksi?
- kondisi apa yang harus terpenuhi sebelum aksi?
- apa akibat dari aksi tersebut?

Domain model tidak harus selalu class JPA. Domain model bisa berupa:

- rich entity,
- aggregate root,
- domain service,
- state machine,
- policy object,
- rule object,
- pure function,
- command handler.

### 4.2 Persistence Entity

Persistence entity adalah object yang dikenali oleh JPA/Hibernate sebagai persistent object.

Ciri-cirinya:

- diberi `@Entity`,
- punya identity persistence,
- dikelola oleh persistence context,
- bisa berada pada state transient/managed/detached/removed,
- memiliki mapping ke table/column/relationship,
- bisa terkena dirty checking,
- bisa lazy-loaded,
- bisa menjadi proxy.

Persistence entity menjawab:

- data disimpan di table mana?
- column apa saja?
- relationship foreign key apa?
- identifier bagaimana dibuat?
- field mana nullable?
- association mana lazy/eager?
- optimistic lock memakai field apa?

### 4.3 DTO

DTO adalah object untuk membawa data melewati boundary.

DTO biasanya dipakai untuk:

- HTTP request,
- HTTP response,
- message payload,
- external API payload,
- form submission,
- import/export,
- integration contract.

DTO tidak semestinya menjadi entity. DTO mengikuti kebutuhan kontrak luar, bukan kebutuhan persistence.

Contoh:

```java
public record SubmitAppealRequest(
        Long caseId,
        String reason,
        List<Long> documentIds
) {}

public record CaseSummaryResponse(
        Long id,
        String caseNo,
        String status,
        String assignedOfficerName,
        Instant lastUpdatedAt
) {}
```

DTO boleh berubah karena API berubah. Entity boleh berubah karena schema berubah. Domain berubah karena business rule berubah. Ketiganya punya alasan perubahan berbeda.

### 4.4 Command Model

Command model merepresentasikan niat untuk mengubah sistem.

Contoh:

```java
public record SubmitAppealCommand(
        CaseId caseId,
        OfficerId submittedBy,
        String reason,
        List<DocumentId> documents,
        Instant requestedAt
) {}
```

Command bukan sekadar DTO. Command biasanya sudah melewati tahap adaptasi dari external request menjadi model aplikasi yang lebih eksplisit.

Command menjawab:

```text
Apa aksi yang ingin dilakukan?
Oleh siapa?
Terhadap aggregate apa?
Dengan parameter apa?
Dalam konteks apa?
```

### 4.5 Read Model

Read model adalah model khusus untuk query/read use case.

Contoh:

```java
public record CaseInboxItem(
        Long caseId,
        String caseNo,
        String applicantName,
        String currentStage,
        String riskLevel,
        Instant pendingSince
) {}
```

Read model tidak harus mengikuti struktur entity. Dalam aplikasi besar, read model sering lebih dekat ke kebutuhan layar/report.

Read model bisa berasal dari:

- JPQL projection,
- native SQL,
- database view,
- materialized view,
- Elasticsearch/OpenSearch index,
- denormalized table,
- CQRS projection,
- reporting database.

### 4.6 Projection

Projection adalah hasil query yang mengambil subset/shape data tertentu.

Contoh:

```java
public record CaseOption(Long id, String caseNo) {}
```

Projection berguna untuk:

- menghindari load entity besar,
- menghindari lazy loading tak terkendali,
- memperjelas query intent,
- mengurangi persistence context overhead,
- memperbaiki performa listing/search/report.

### 4.7 Aggregate

Aggregate adalah consistency boundary domain.

Aggregate menjawab:

```text
Data apa yang harus berubah bersama agar invariant tetap benar?
```

Dalam DDD, aggregate root adalah object yang menjadi pintu mutation aggregate. Tapi dalam praktik enterprise Java, aggregate tidak harus selalu diterapkan secara dogmatis. Yang penting adalah memahami boundary invariant.

Contoh:

```text
Case aggregate:
- Case
- CaseStatusHistory
- CaseAssignment
- CaseDecisionDraft

Document mungkin aggregate terpisah jika punya lifecycle sendiri.
AuditTrail hampir pasti bukan bagian mutable aggregate Case.
```

---

## 5. Core Rule: Satu Model Tidak Harus Memenuhi Semua Kebutuhan

Salah satu kesalahan terbesar adalah mencoba membuat satu class memenuhi semua kebutuhan:

```java
@Entity
public class Case {
    // JPA entity
    // JSON request body
    // JSON response body
    // domain object
    // validation object
    // Excel export row
    // audit object
    // search result object
}
```

Awalnya terlihat efisien. Dalam jangka panjang, ini menghasilkan coupling besar.

Masalahnya:

1. API contract berubah, entity ikut berubah.
2. Database schema berubah, response ikut berubah.
3. Field internal bocor ke client.
4. Lazy association terserialisasi tanpa sadar.
5. Infinite recursion di JSON serialization.
6. Security field exposure.
7. Validation rule create/update/search bercampur.
8. Query listing mengambil object graph terlalu besar.
9. Business invariant dipengaruhi kebutuhan UI.
10. Test menjadi rapuh karena semua boundary saling bergantung.

Prinsip yang lebih sehat:

```text
Gunakan model yang berbeda ketika alasan perubahannya berbeda.
```

Tetapi jangan ekstrem. Untuk aplikasi kecil, entity dapat dipakai sebagai domain model. Untuk aplikasi besar, pisahkan ketika coupling mulai berbahaya.

---

## 6. Architecture Options

Tidak ada satu arsitektur yang benar untuk semua sistem. Yang ada adalah trade-off.

### 6.1 Simple Layered Architecture

```text
Controller -> Service -> Repository -> Entity -> Database
```

Cocok untuk:

- CRUD sederhana,
- admin internal kecil,
- lifecycle sederhana,
- sedikit concurrency,
- sedikit reporting,
- tidak banyak integrasi.

Kelebihan:

- mudah dipahami,
- cepat dibuat,
- sedikit boilerplate,
- cocok untuk tim kecil.

Risiko:

- domain logic sering tersebar,
- repository menjadi besar,
- entity bocor ke API,
- transaction boundary sering asal,
- sulit ketika workflow kompleks.

### 6.2 Rich Domain with JPA Entities

```text
Controller -> Application Service -> JPA Entity as Domain Model -> Repository -> DB
```

Entity berisi behavior, bukan hanya getter/setter.

Contoh:

```java
@Entity
public class EnforcementCase {

    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    @Version
    private long version;

    protected EnforcementCase() {
        // for JPA
    }

    public void submitForReview(Officer officer, Instant now) {
        if (status != CaseStatus.DRAFT) {
            throw new InvalidCaseTransitionException(status, CaseStatus.UNDER_REVIEW);
        }
        if (!officer.canSubmitCase()) {
            throw new UnauthorizedCaseActionException();
        }
        this.status = CaseStatus.UNDER_REVIEW;
        // append status history, register event, etc.
    }
}
```

Kelebihan:

- invariant dekat dengan data,
- mutation lebih terkontrol,
- domain lebih ekspresif,
- service tidak menjadi procedural blob.

Risiko:

- JPA constraints memengaruhi desain domain,
- lazy loading bisa masuk domain method,
- proxy/no-arg constructor/final class limitation,
- domain test bisa perlu memahami persistence behavior,
- entity lifecycle detached/managed bisa membingungkan.

Cocok jika:

- domain cukup kompleks,
- tim disiplin menjaga entity tidak bocor,
- mapping tidak terlalu berbeda dari domain,
- aggregate boundary jelas,
- tidak terlalu banyak legacy schema mismatch.

### 6.3 Separate Domain Model and Persistence Entity

```text
Controller -> Application Service -> Domain Model -> Port -> Persistence Adapter -> JPA Entity -> DB
```

Contoh struktur:

```text
case-management/
  application/
    SubmitCaseUseCase.java
    SubmitCaseCommand.java
  domain/
    EnforcementCase.java
    CaseStatus.java
    CaseRepository.java       // port
  infrastructure/
    persistence/
      JpaCaseEntity.java
      JpaCaseRepository.java  // adapter
      CaseMapper.java
```

Kelebihan:

- domain bebas dari JPA,
- lebih mudah unit test domain,
- schema legacy bisa diisolasi,
- persistence provider bisa diganti lebih mudah,
- cocok untuk domain kompleks.

Risiko:

- mapping overhead,
- lebih banyak class,
- risk anemic mapper hell,
- performance tuning lebih eksplisit,
- identity consistency harus dijaga manual.

Cocok jika:

- legacy database rumit,
- domain berbeda jauh dari schema,
- sistem sangat long-lived,
- butuh portability tinggi,
- domain rule sangat kritis,
- entity JPA terlalu terikat technical detail.

### 6.4 CQRS-Light

CQRS-light memisahkan write path dan read path tanpa harus event sourcing penuh.

```text
Write path:
Controller -> Command Handler -> Domain/Aggregate -> Repository -> DB

Read path:
Controller -> Query Service -> Projection Query -> DB/View/Search Index
```

Kelebihan:

- write model fokus invariant,
- read model fokus UI/report performance,
- menghindari entity graph besar untuk listing,
- query kompleks tidak mengotori aggregate.

Risiko:

- dua model perlu dijaga konsistensinya,
- developer junior bisa bingung,
- potensi duplikasi konsep.

Cocok untuk:

- aplikasi case management,
- dashboard,
- reporting,
- inbox/task list,
- search/filter/sort kompleks,
- workflow dengan banyak screen.

### 6.5 Hexagonal / Ports and Adapters

```text
Inbound Adapter
  REST Controller / Message Listener / Scheduler
        |
        v
Application Port / Use Case
        |
        v
Domain
        |
        v
Outbound Port
        |
        v
Persistence Adapter / External API Adapter
```

Kelebihan:

- dependency direction lebih bersih,
- domain/application tidak tergantung framework,
- mudah test use case dengan fake port,
- persistence detail terisolasi.

Risiko:

- bisa overengineering jika domain sederhana,
- banyak interface yang tidak memberi value,
- mapping dan adapter boilerplate.

Prinsip penting:

```text
Jangan membuat port hanya karena pola arsitektur.
Buat port ketika ada boundary yang memang perlu dilindungi.
```

---

## 7. Dependency Direction

Arah dependency yang sehat:

```text
infrastructure depends on application/domain
application depends on domain
inbound adapter depends on application
outbound adapter implements domain/application ports
```

Contoh:

```text
com.acme.case.domain
  Case.java
  CaseRepository.java

com.acme.case.application
  SubmitCaseUseCase.java
  SubmitCaseCommand.java

com.acme.case.infrastructure.persistence
  JpaCaseEntity.java
  HibernateCaseRepository.java

com.acme.case.interfaces.rest
  CaseController.java
  SubmitCaseRequest.java
```

Yang perlu dihindari:

```text
Domain -> Spring Data JpaRepository
Domain -> EntityManager
Domain -> Hibernate Session
Domain -> HTTP DTO
Domain -> JSON annotation
Domain -> database exception
```

Namun dalam aplikasi Spring/Jakarta yang pragmatic, tidak semua dependency framework harus dianggap dosa. Pertanyaannya bukan “apakah ada annotation framework?”, tetapi:

```text
Apakah dependency ini membuat business rule sulit diuji, sulit diubah, atau bocor ke layer yang salah?
```

Misalnya `@Entity` di domain class mungkin acceptable jika entity memang domain model. Tetapi `@JsonIgnore`, `@RequestBody`, `@Schema`, dan API serialization detail di domain entity biasanya smell kuat.

---

## 8. Entity as Domain Model: Kapan Boleh?

Entity JPA boleh menjadi domain model jika kondisi berikut terpenuhi:

1. Struktur domain cukup dekat dengan relational schema.
2. Entity tidak digunakan langsung sebagai API request/response.
3. Domain behavior bisa hidup nyaman dengan constraint JPA.
4. Lazy loading dikontrol, bukan terjadi random.
5. Aggregate boundary jelas.
6. Transaction boundary jelas.
7. Entity tidak menjadi “god object” untuk semua use case.
8. Tim memahami lifecycle managed/detached.

Contoh acceptable:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private CaseStatus status;

    @Version
    private long version;

    protected CaseRecord() {
        // Required by JPA
    }

    public static CaseRecord draft(String caseNo) {
        CaseRecord record = new CaseRecord();
        record.caseNo = requireNonBlank(caseNo);
        record.status = CaseStatus.DRAFT;
        return record;
    }

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new InvalidTransitionException(status, CaseStatus.SUBMITTED);
        }
        this.status = CaseStatus.SUBMITTED;
    }

    public void approve() {
        if (status != CaseStatus.UNDER_REVIEW) {
            throw new InvalidTransitionException(status, CaseStatus.APPROVED);
        }
        this.status = CaseStatus.APPROVED;
    }
}
```

Perhatikan:

- setter publik tidak dibuka sembarangan,
- mutation lewat method domain,
- status transition dijaga,
- `@Version` disiapkan untuk concurrency,
- entity tidak menjadi request/response DTO.

---

## 9. Entity as Domain Model: Kapan Tidak Boleh?

Pisahkan domain model dari persistence entity jika:

1. Database schema legacy sangat buruk.
2. Satu table berisi banyak konsep domain yang berbeda.
3. Satu aggregate tersebar di banyak table dengan mapping rumit.
4. Domain rule lebih penting daripada persistence convenience.
5. Entity harus punya banyak annotation provider-specific.
6. Entity sering berubah karena kebutuhan UI/API.
7. Lazy loading mengganggu domain logic.
8. Testing domain menjadi berat karena JPA.
9. Ada kebutuhan multi-persistence backend.
10. Sistem memiliki regulatory audit tinggi dan separation of concern dibutuhkan.

Contoh separation:

```java
// Domain
public final class EnforcementCase {
    private final CaseId id;
    private CaseStatus status;
    private final List<CaseEvent> pendingEvents = new ArrayList<>();

    public void escalate(Officer officer, Reason reason, Instant now) {
        if (!officer.canEscalate()) {
            throw new UnauthorizedCaseActionException();
        }
        if (!status.canEscalate()) {
            throw new InvalidCaseTransitionException(status);
        }
        this.status = CaseStatus.ESCALATED;
        this.pendingEvents.add(CaseEscalated.of(id, officer.id(), reason, now));
    }
}
```

```java
// Persistence entity
@Entity
@Table(name = "enforcement_case")
class JpaEnforcementCaseEntity {
    @Id
    private Long id;

    @Column(name = "case_status", nullable = false)
    private String status;

    @Version
    private long version;

    protected JpaEnforcementCaseEntity() {}
}
```

```java
// Adapter mapper
final class CasePersistenceMapper {
    EnforcementCase toDomain(JpaEnforcementCaseEntity entity) {
        return EnforcementCase.rehydrate(
                new CaseId(entity.getId()),
                CaseStatus.valueOf(entity.getStatus()),
                entity.getVersion()
        );
    }

    void updateEntity(EnforcementCase domain, JpaEnforcementCaseEntity entity) {
        entity.setStatus(domain.status().name());
    }
}
```

Trade-off-nya nyata: lebih bersih secara boundary, tetapi lebih banyak mapping.

---

## 10. Repository Boundary

Repository sering disalahpahami sebagai “class untuk akses table”. Itu terlalu sempit.

Dalam desain yang lebih kuat, repository adalah boundary untuk **mengambil dan menyimpan aggregate/model sesuai use case**.

### 10.1 Repository yang Buruk

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {
    List<CaseEntity> findByStatus(String status);
    List<CaseEntity> findByApplicantNameContaining(String name);
    List<CaseEntity> findByCreatedAtBetween(Instant from, Instant to);
    List<CaseEntity> findByOfficerIdAndStatusAndRiskLevelAndCreatedAtBetween(...);
    List<CaseEntity> findEverythingForDashboard(...);
}
```

Masalah:

- repository menjadi campuran command query listing report dashboard export,
- return entity untuk semua kebutuhan,
- fetch plan tidak jelas,
- query intent tidak jelas,
- domain mutation dan read projection tercampur,
- API use case mengendalikan repository shape.

### 10.2 Repository yang Lebih Baik

Pisahkan command repository dan query service/repository.

```java
public interface CaseCommandRepository {
    Optional<CaseRecord> findForUpdate(CaseId id);
    void save(CaseRecord caseRecord);
}
```

```java
public interface CaseInboxQuery {
    Page<CaseInboxItem> findPendingCases(CaseInboxFilter filter, Pageable pageable);
}
```

```java
public interface CaseReportQuery {
    List<CaseAgingReportRow> findAgingReport(CaseAgingReportCriteria criteria);
}
```

Manfaat:

- write path fokus aggregate/invariant,
- read path fokus projection/performance,
- query kompleks tidak mengotori aggregate repository,
- return type mencerminkan intent,
- fetch strategy lebih eksplisit.

---

## 11. Repository Return Type

Return type repository adalah keputusan arsitektural.

### 11.1 Return Entity

Cocok untuk:

- mutation use case,
- aggregate rehydration,
- business rule execution,
- state transition.

Contoh:

```java
Optional<EnforcementCase> findById(CaseId id);
```

### 11.2 Return Projection

Cocok untuk:

- list page,
- dropdown,
- dashboard,
- report,
- search result,
- read-only view.

Contoh:

```java
Page<CaseInboxItem> searchInbox(CaseInboxFilter filter, Pageable pageable);
```

### 11.3 Return Reference/Id

Cocok untuk:

- existence check,
- authorization check,
- relation validation,
- lightweight operations.

Contoh:

```java
boolean existsOpenCaseForApplicant(ApplicantId applicantId);
```

### 11.4 Return Stream

Cocok untuk:

- batch export,
- large read operation,
- processing cursor-like result.

Harus hati-hati:

- transaction harus tetap terbuka,
- stream harus ditutup,
- persistence context bisa membesar,
- fetch size harus dikontrol.

---

## 12. Service Layer: Application Service vs Domain Service

Kata “service” sering ambigu.

### 12.1 Application Service / Use Case Service

Application service mengorkestrasi use case.

Tanggung jawab:

- menerima command,
- membuka transaction boundary,
- load aggregate,
- memanggil domain behavior,
- menyimpan perubahan,
- menerbitkan event/outbox,
- mapping result.

Contoh:

```java
@Service
public class SubmitAppealUseCase {

    private final CaseRepository caseRepository;
    private final AppealRepository appealRepository;
    private final OutboxPublisher outboxPublisher;
    private final Clock clock;

    @Transactional
    public SubmitAppealResult handle(SubmitAppealCommand command) {
        CaseRecord caseRecord = caseRepository.findById(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        Appeal appeal = caseRecord.submitAppeal(
                command.reason(),
                command.submittedBy(),
                clock.instant()
        );

        appealRepository.save(appeal);
        outboxPublisher.enqueueAll(caseRecord.pullDomainEvents());

        return new SubmitAppealResult(appeal.id());
    }
}
```

Application service tidak seharusnya berisi semua rule detail. Ia harus mengorkestrasi.

### 12.2 Domain Service

Domain service berisi rule domain yang tidak natural menjadi method satu entity.

Contoh:

```java
public final class CaseEscalationPolicy {

    public EscalationDecision evaluate(CaseRecord caseRecord,
                                       Officer officer,
                                       WorkloadSnapshot workload) {
        if (!officer.hasRole(Role.SENIOR_OFFICER)) {
            return EscalationDecision.rejected("Officer is not senior enough");
        }
        if (workload.currentOpenEscalations() > 20) {
            return EscalationDecision.rejected("Escalation workload exceeded");
        }
        if (!caseRecord.isPendingLongerThan(Duration.ofDays(14))) {
            return EscalationDecision.rejected("Case is not aged enough");
        }
        return EscalationDecision.approved();
    }
}
```

Domain service tidak seharusnya langsung query database kecuali sengaja didesain sebagai domain policy port. Jika butuh data eksternal, application service biasanya load data lalu pass snapshot ke domain service.

---

## 13. Transaction Ownership

Pertanyaan penting:

```text
Siapa yang memiliki transaction boundary?
```

Jawaban umum: **application use case layer**.

Mengapa bukan controller?

- Controller adalah transport boundary, bukan consistency boundary.
- Controller bisa HTTP, message, scheduler, CLI.
- Transaction tidak boleh tergantung transport.

Mengapa bukan repository?

- Repository hanya tahu operasi data tertentu.
- Use case bisa melibatkan beberapa repository.
- Invariant biasanya melintasi beberapa operasi.
- Kalau tiap repository punya transaction sendiri, atomicity use case rusak.

Mengapa bukan entity?

- Entity tidak tahu persistence context/transaction.
- Entity harus memodelkan state/behavior, bukan resource lifecycle.

Model sehat:

```text
Controller / Listener / Job
        |
        v
UseCaseService  <-- @Transactional biasanya di sini
        |
        +-- Repository A
        +-- Repository B
        +-- Domain behavior
        +-- Outbox enqueue
```

Contoh:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseRecord caseRecord = caseRepository.findById(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

    ApprovalRoute route = routeRepository.findActiveRoute(command.caseId())
            .orElseThrow(ApprovalRouteNotFoundException::new);

    caseRecord.approve(command.approver(), route, clock.instant());

    outboxRepository.save(CaseApprovedEvent.from(caseRecord));
}
```

Semua perubahan yang harus atomik berada dalam satu boundary.

---

## 14. DTO Boundary: Jangan Bocorkan Entity ke API

Mengembalikan entity langsung dari controller adalah jebakan klasik.

```java
@GetMapping("/cases/{id}")
public CaseEntity get(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Masalah:

1. Field internal bocor.
2. Lazy association bisa trigger query saat serialization.
3. Infinite recursion parent-child.
4. API contract berubah saat entity berubah.
5. Security exposure.
6. Serialization bisa terjadi setelah transaction selesai.
7. Version/internal id/audit field bisa terlihat.
8. Client jadi bergantung ke schema internal.

Gunakan DTO response:

```java
@GetMapping("/cases/{id}")
public CaseDetailResponse get(@PathVariable Long id) {
    return caseDetailQuery.findDetail(new CaseId(id));
}
```

Dengan projection:

```java
public record CaseDetailResponse(
        Long id,
        String caseNo,
        String status,
        String applicantName,
        Instant submittedAt,
        List<DocumentItem> documents
) {}
```

DTO bukan sekadar “boilerplate”. DTO adalah kontrak boundary.

---

## 15. Mapping Strategies

Mapping terjadi antara model-model berbeda.

### 15.1 Manual Mapping

```java
public CaseDetailResponse toResponse(CaseRecord entity) {
    return new CaseDetailResponse(
            entity.getId(),
            entity.getCaseNo(),
            entity.getStatus().name(),
            entity.getApplicant().getName(),
            entity.getSubmittedAt(),
            entity.getDocuments().stream()
                    .map(doc -> new DocumentItem(doc.getId(), doc.getFilename()))
                    .toList()
    );
}
```

Kelebihan:

- eksplisit,
- mudah debug,
- aman untuk logic kecil,
- tidak ada magic.

Risiko:

- repetitive,
- bisa lupa field,
- bisa memicu lazy loading jika tidak hati-hati.

### 15.2 Projection Query Mapping

```java
@Query("""
    select new com.acme.caseapp.CaseInboxItem(
        c.id,
        c.caseNo,
        a.name,
        c.status,
        c.updatedAt
    )
    from CaseRecord c
    join c.applicant a
    where c.status in :statuses
    order by c.updatedAt desc
""")
Page<CaseInboxItem> findInbox(List<CaseStatus> statuses, Pageable pageable);
```

Kelebihan:

- hanya ambil data yang perlu,
- tidak load full entity,
- bagus untuk read-heavy path,
- mengurangi N+1.

Risiko:

- query lebih eksplisit,
- projection perlu dijaga saat screen berubah,
- tidak cocok untuk mutation.

### 15.3 Mapper Library

MapStruct sering dipakai di Java enterprise.

Kelebihan:

- compile-time generated mapper,
- lebih aman dari reflection mapper,
- cocok untuk DTO mapping banyak.

Risiko:

- bisa menyembunyikan lazy loading,
- mapping kompleks tetap butuh desain,
- tidak menggantikan domain modeling.

### 15.4 Reflection Mapper / Generic Mapper

Contoh: mapper otomatis berdasarkan nama field.

Risiko:

- mudah bocor field,
- fragile,
- magic,
- security exposure,
- sulit reason tentang query/fetch,
- buruk untuk domain-rich model.

Gunakan sangat terbatas.

---

## 16. Read Path vs Write Path

Dalam aplikasi kompleks, read dan write punya kebutuhan berbeda.

### 16.1 Write Path

Write path membutuhkan:

- invariant correctness,
- transaction boundary,
- locking/versioning,
- validation,
- authorization,
- audit,
- idempotency,
- event/outbox.

Write path biasanya load aggregate/entity, memanggil behavior, lalu commit.

```text
Command -> Use Case -> Aggregate -> Repository -> Transaction Commit
```

### 16.2 Read Path

Read path membutuhkan:

- filtering,
- sorting,
- pagination,
- projection,
- performance,
- index alignment,
- security filtering,
- sometimes denormalization.

Read path tidak selalu perlu entity.

```text
Query Request -> Query Service -> Projection Query -> DTO
```

### 16.3 Kenapa Dipisah?

Karena kalau tidak dipisah, entity akan dipaksa melayani dua kebutuhan yang bertolak belakang:

- write ingin invariant dan behavior,
- read ingin shape fleksibel dan cepat.

Contoh buruk:

```java
List<CaseEntity> cases = caseRepository.findByStatus("PENDING");
return cases.stream().map(CaseResponse::from).toList();
```

Jika `CaseResponse.from()` mengakses applicant, documents, officer, SLA, comments, maka bisa terjadi N+1 dan object graph besar.

Contoh lebih baik:

```java
Page<CaseInboxItem> page = caseInboxQuery.search(filter, pageable);
return page.map(CaseInboxResponse::from);
```

---

## 17. Persistence Context Boundary

JPA `EntityManager` mengelola persistence context. Persistence context adalah tempat entity managed hidup. Dalam Hibernate, setiap stateful `Session`/JPA `EntityManager` memiliki persistence context sendiri.

Secara arsitektural, ini berarti:

```text
Managed entity tidak boleh diperlakukan seperti object biasa tanpa memahami scope-nya.
```

Jika entity keluar dari transaction/use case, ia bisa menjadi detached. Jika masih lazy association belum di-load, akses setelah persistence context tertutup bisa gagal.

Model sehat:

```text
Inside use case transaction:
- load entity
- mutate entity
- access required associations intentionally
- map to output/projection if needed
- commit

Outside transaction:
- use DTO/result, not managed entity
```

Anti-pattern:

```java
@Transactional
public CaseEntity getCase(Long id) {
    return repository.findById(id).orElseThrow();
}

// Later in controller serialization:
// lazy loading, detached access, accidental DB queries, or serialization failure
```

Gunakan:

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCase(Long id) {
    CaseEntity caseEntity = repository.findDetailById(id)
            .orElseThrow();
    return mapper.toDetailResponse(caseEntity);
}
```

Atau projection langsung.

---

## 18. Open Session in View: Architecture Smell atau Pragmatic Tool?

Open Session in View memungkinkan persistence context tetap terbuka sampai view/response rendering selesai.

Manfaat:

- lazy loading masih bisa terjadi saat serialization/view rendering,
- developer tidak perlu menentukan fetch plan sejak awal,
- cepat untuk prototyping.

Risiko:

- query bisa terjadi di layer view/controller,
- N+1 sulit terlihat,
- transaction/read consistency kabur,
- response serialization bisa memicu database access,
- API contract dan persistence graph tercampur,
- debugging performance lebih sulit.

Rekomendasi untuk sistem besar:

```text
Matikan atau batasi Open Session in View.
Bangun DTO/projection di application/query layer.
Tentukan fetch plan per use case.
```

Namun jangan dogmatis. Untuk admin CRUD kecil, OSIV bisa acceptable. Untuk core business workflow, reporting, dan high-scale API, OSIV biasanya berbahaya.

---

## 19. Database Constraint as Architecture

Persistence architecture yang matang tidak menyerahkan semua invariant ke application code.

Application code bisa race. Database constraint adalah garis pertahanan terakhir.

Contoh invariant:

```text
Satu active assignment per case.
```

Jangan hanya:

```java
if (!assignmentRepository.existsActive(caseId)) {
    assignmentRepository.save(new Assignment(caseId, officerId));
}
```

Dua request paralel bisa sama-sama lolos.

Tambahkan constraint database, misalnya partial unique index jika database mendukung:

```sql
create unique index ux_assignment_active_case
on case_assignment(case_id)
where active = true;
```

Atau desain alternatif untuk database yang tidak mendukung partial index.

Prinsip:

```text
Business invariant yang harus mustahil dilanggar perlu diproteksi sedekat mungkin dengan source of truth.
```

Layering invariant:

```text
UI validation        -> fast feedback
DTO validation       -> input contract
Domain rule          -> business correctness
Database constraint  -> race-condition safety
Audit/log            -> accountability
```

---

## 20. Where Business Logic Should Live

Pertanyaan klasik: business logic di service atau entity?

Jawaban lebih tepat:

```text
Business logic harus berada di tempat yang paling mampu menjaga invariant dengan dependency paling sedikit dan perubahan paling lokal.
```

### 20.1 Logic di Entity

Cocok untuk rule yang bergantung pada state entity itu sendiri.

```java
public void cancel(Officer officer, Instant now) {
    if (!status.canCancel()) {
        throw new InvalidTransitionException(status, CaseStatus.CANCELLED);
    }
    if (!officer.canCancelCase()) {
        throw new UnauthorizedCaseActionException();
    }
    this.status = CaseStatus.CANCELLED;
    this.cancelledAt = now;
}
```

### 20.2 Logic di Domain Service

Cocok untuk rule yang melibatkan beberapa object atau policy eksternal.

```java
public EscalationDecision decide(CaseRecord caseRecord,
                                 Officer officer,
                                 SlaPolicy slaPolicy,
                                 WorkloadSnapshot workload) {
    // cross-object business decision
}
```

### 20.3 Logic di Application Service

Cocok untuk orchestration, bukan rule detail.

```java
@Transactional
public void escalate(EscalateCaseCommand command) {
    CaseRecord caseRecord = caseRepository.findById(command.caseId()).orElseThrow();
    Officer officer = officerRepository.findById(command.officerId()).orElseThrow();
    WorkloadSnapshot workload = workloadQuery.currentFor(officer.id());

    EscalationDecision decision = escalationPolicy.decide(caseRecord, officer, slaPolicy, workload);
    caseRecord.escalate(decision, clock.instant());
}
```

### 20.4 Logic di Repository

Repository sebaiknya tidak berisi business decision kompleks. Ia boleh berisi persistence-specific query.

Buruk:

```java
public void approveCase(Long caseId, Long officerId) {
    // load case
    // check role
    // check state
    // update status
    // send email
    // save audit
}
```

Repository berubah menjadi use case tersembunyi.

---

## 21. Package/Module Structure

Untuk aplikasi besar, struktur package harus mencerminkan boundary, bukan hanya tipe teknis.

### 21.1 Technical Package yang Terlalu Umum

```text
controller/
service/
repository/
entity/
dto/
mapper/
```

Masalah:

- semua domain bercampur,
- package menjadi besar,
- coupling antar fitur sulit terlihat,
- ownership modul tidak jelas.

### 21.2 Feature/Domain-Oriented Package

```text
case/
  application/
  domain/
  infrastructure/
    persistence/
    messaging/
  interfaces/
    rest/
    event/

appeal/
  application/
  domain/
  infrastructure/
  interfaces/

compliance/
  application/
  domain/
  infrastructure/
  interfaces/
```

Manfaat:

- cohesion lebih tinggi,
- dependency lebih mudah dikontrol,
- modul bisa dipecah kemudian,
- ownership tim lebih jelas,
- bounded context lebih terlihat.

### 21.3 Hybrid Pragmatic Structure

Untuk sistem existing:

```text
modules/
  case-management/
    controller/
    service/
    repository/
    entity/
    query/
    dto/
  appeal/
    controller/
    service/
    repository/
    entity/
    query/
    dto/
```

Ini masih lebih baik daripada semua `service` global dicampur.

---

## 22. Module Boundary and Persistence

Jika aplikasi memakai multi-module Maven/Gradle, dependency bisa dikontrol lebih kuat.

Contoh:

```text
case-domain
  - pure domain classes
  - repository ports

case-application
  - use cases
  - commands
  - transaction boundary annotations if using Spring/Jakarta

case-persistence-jpa
  - JPA entities
  - Spring Data/Jakarta Data repositories
  - mappers
  - adapter implementations

case-web
  - REST controllers
  - request/response DTOs
```

Dependency:

```text
case-web -> case-application -> case-domain
case-persistence-jpa -> case-application/domain
runtime wiring connects ports to adapters
```

Dalam praktik Spring Boot, module wiring bisa menggunakan configuration class.

Keuntungan:

- domain tidak bisa import JPA tanpa terlihat,
- API DTO tidak bisa masuk domain sembarangan,
- persistence adapter bisa diganti/tested terpisah,
- architecture rule bisa dicek dengan ArchUnit.

---

## 23. Spring Data JPA and Jakarta Data Placement

Spring Data JPA dan Jakarta Data adalah abstraction repository. Mereka berguna, tetapi jangan biarkan abstraction ini menentukan seluruh arsitektur.

### 23.1 Spring Data JPA Interface sebagai Infrastructure Detail

```java
interface SpringDataCaseJpaRepository extends JpaRepository<CaseEntity, Long> {
    Optional<CaseEntity> findByCaseNo(String caseNo);
}
```

Lalu adapter:

```java
@Repository
class CaseRepositoryAdapter implements CaseRepository {

    private final SpringDataCaseJpaRepository delegate;

    @Override
    public Optional<CaseRecord> findById(CaseId id) {
        return delegate.findById(id.value()).map(this::toDomainOrEntity);
    }
}
```

Untuk aplikasi sederhana, domain service bisa langsung depend ke Spring Data repository. Untuk aplikasi besar, pertimbangkan adapter agar dependency lebih bersih.

### 23.2 Jakarta Data Repository

Jakarta Data memperkenalkan standard repository interface di ekosistem Jakarta EE. Ini berguna untuk mengurangi coupling ke provider tertentu. Tetapi secara arsitektur, tetap perlu diputuskan apakah repository interface tersebut adalah:

- application/domain port,
- infrastructure implementation detail,
- atau convenience abstraction di module persistence.

Jangan menganggap standard API otomatis menyelesaikan boundary design.

---

## 24. EntityManager Placement

`EntityManager` adalah API kuat. Tetapi semakin banyak layer yang tahu `EntityManager`, semakin bocor persistence detail.

### 24.1 Acceptable Use

`EntityManager` acceptable di:

- custom repository implementation,
- query adapter,
- persistence infrastructure,
- batch persistence component,
- migration/backfill tool,
- low-level performance tuning path.

### 24.2 Suspicious Use

`EntityManager` suspicious di:

- controller,
- domain entity,
- domain service pure,
- DTO mapper,
- random utility,
- authorization component yang seharusnya menerima snapshot.

Contoh sehat:

```java
@Repository
class JpaCaseInboxQuery implements CaseInboxQuery {

    @PersistenceContext
    private EntityManager entityManager;

    public Page<CaseInboxItem> search(CaseInboxFilter filter, Pageable pageable) {
        // Build explicit JPQL/Criteria/native query for read model
    }
}
```

---

## 25. Application Flow Patterns

### 25.1 Command Flow

```text
HTTP Request
  -> Request DTO validation
  -> Controller maps to Command
  -> UseCase starts transaction
  -> Repository loads aggregate
  -> Domain method validates transition
  -> Repository persists changes
  -> Outbox event saved
  -> Transaction commits
  -> Response DTO returned
```

Example:

```java
@RestController
class CaseCommandController {

    private final SubmitCaseUseCase submitCaseUseCase;

    @PostMapping("/cases/{id}/submit")
    SubmitCaseResponse submit(@PathVariable Long id,
                              @RequestBody SubmitCaseRequest request,
                              Principal principal) {
        SubmitCaseCommand command = new SubmitCaseCommand(
                new CaseId(id),
                new OfficerId(principal.getName()),
                request.comment()
        );
        SubmitCaseResult result = submitCaseUseCase.handle(command);
        return new SubmitCaseResponse(result.caseId().value(), result.status().name());
    }
}
```

### 25.2 Query Flow

```text
HTTP Query Params
  -> Query Criteria/Filter
  -> Query Service
  -> Projection query
  -> Page DTO
```

Example:

```java
@RestController
class CaseQueryController {

    private final CaseInboxQuery caseInboxQuery;

    @GetMapping("/cases/inbox")
    Page<CaseInboxItemResponse> inbox(CaseInboxRequest request, Pageable pageable) {
        CaseInboxFilter filter = request.toFilter();
        return caseInboxQuery.search(filter, pageable)
                .map(CaseInboxItemResponse::from);
    }
}
```

### 25.3 Message Consumer Flow

```text
Message received
  -> Deserialize event/command
  -> Idempotency check
  -> UseCase transaction
  -> Domain mutation
  -> Inbox/outbox update
  -> Commit
  -> Ack message
```

Persistence architecture harus memikirkan message retry dan idempotency. Jika consumer crash setelah commit tapi sebelum ack, message bisa diproses ulang.

---

## 26. Handling External Systems in Persistence Architecture

Jangan panggil external API sembarangan di dalam transaction.

Buruk:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseRecord caseRecord = caseRepository.findById(command.caseId()).orElseThrow();
    caseRecord.approve(command.approver());

    externalNotificationClient.sendApprovalEmail(caseRecord); // risky

    auditRepository.save(...);
}
```

Risiko:

- transaction terbuka lama,
- DB lock ditahan sambil menunggu network,
- external call sukses tapi DB rollback,
- DB commit sukses tapi external timeout,
- retry bisa menghasilkan duplicate side effect.

Lebih aman:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseRecord caseRecord = caseRepository.findById(command.caseId()).orElseThrow();
    caseRecord.approve(command.approver());

    outboxRepository.save(NotificationRequested.approval(caseRecord.id()));
}
```

Lalu worker terpisah memproses outbox.

Prinsip:

```text
Di dalam DB transaction, simpan fakta dan intent.
Efek eksternal diproses setelah commit dengan idempotency.
```

---

## 27. Designing for Regulatory Defensibility

Untuk sistem regulatory/case management, persistence architecture harus mendukung:

1. Explainability.
2. Auditability.
3. Non-repudiation internal.
4. Traceability.
5. Correct state transition.
6. Role-based action history.
7. Data retention.
8. Legal hold/archival.
9. Reproducible decision trail.

Artinya, desain persistence tidak boleh hanya fokus CRUD.

Contoh minimum untuk state transition:

```text
case_record
- id
- case_no
- status
- version
- created_at
- updated_at

case_status_history
- id
- case_id
- from_status
- to_status
- changed_by
- changed_at
- reason
- correlation_id

audit_trail
- id
- module
- entity_type
- entity_id
- activity
- before_snapshot
- after_snapshot
- performed_by
- performed_at
- request_id
```

State transition method harus menyimpan history/audit dalam transaction yang sama dengan status change, atau menggunakan outbox/audit event yang reliable.

Jika status berubah tapi audit gagal, apakah transaction harus rollback? Untuk regulatory system, sering jawabannya: ya, jika audit adalah bagian dari defensibility invariant.

---

## 28. Architecture Failure Modes

### 28.1 Entity Leak Failure

Gejala:

- API response tiba-tiba punya field baru,
- sensitive data bocor,
- serialization lambat,
- circular reference error.

Root cause:

- entity dipakai sebagai response DTO.

Fix:

- response DTO/projection,
- mapping eksplisit,
- disable entity serialization di boundary.

### 28.2 Transaction Fragmentation

Gejala:

- sebagian data tersimpan, sebagian gagal,
- audit tidak match state,
- external event terkirim walaupun DB rollback.

Root cause:

- transaction boundary ada di repository atau method kecil,
- use case tidak atomik.

Fix:

- transaction boundary di application use case,
- outbox untuk side effect eksternal.

### 28.3 Repository Blob

Gejala:

- satu repository punya ratusan method,
- query sulit dipahami,
- return entity untuk semua screen,
- performance regression sering.

Root cause:

- command/read/report query tercampur.

Fix:

- pisahkan command repository, query service, report query.

### 28.4 Anemic Domain with Procedural Service Blob

Gejala:

- service ribuan baris,
- entity hanya getter/setter,
- rule tersebar,
- state transition tidak konsisten.

Root cause:

- domain behavior tidak dimodelkan.

Fix:

- pindahkan invariant dekat ke entity/domain service/policy object.

### 28.5 Hidden Lazy Loading

Gejala:

- query count meledak,
- endpoint lambat hanya saat data besar,
- N+1 muncul di serialization.

Root cause:

- fetch plan tidak eksplisit,
- OSIV,
- DTO mapper akses lazy association.

Fix:

- projection query,
- fetch join/entity graph per use case,
- matikan OSIV untuk core API.

### 28.6 Database Constraint Missing

Gejala:

- duplicate active assignment,
- double approval,
- negative quota,
- invalid state di production.

Root cause:

- invariant hanya dicek di application code.

Fix:

- database constraint,
- optimistic/pessimistic locking,
- conditional update,
- idempotency.

---

## 29. Decision Matrix: Pilih Arsitektur Mana?

| Context | Entity as Domain | Separate Domain/Persistence | CQRS-Light | Notes |
|---|---:|---:|---:|---|
| CRUD admin kecil | Good | Overkill | Usually no | Keep simple |
| Workflow approval kompleks | Good if disciplined | Often good | Strongly useful | State transition needs protection |
| Legacy schema buruk | Painful | Strongly good | Useful | Mapping isolates schema ugliness |
| High-volume reporting | Bad alone | Neutral | Strongly good | Use projection/read model |
| Regulatory audit | Good if explicit | Strongly good | Useful | Audit must be first-class |
| Microservice small bounded context | Good | Optional | Optional | Simplicity wins |
| Large monolith 50+ modules | Risky if uncontrolled | Good for core domains | Good | Boundaries matter |
| Team junior-heavy | Simpler is better | Risk if too abstract | Moderate | Architecture must be teachable |
| Performance-critical read APIs | Not enough | Neutral | Strongly good | Avoid full entity graph |

---

## 30. Practical Architecture Templates

### 30.1 Template A: Pragmatic Spring Boot / Jakarta Persistence

```text
case/
  CaseController.java
  SubmitCaseRequest.java
  CaseResponse.java
  CaseService.java
  CaseEntity.java
  CaseRepository.java
  CaseInboxQuery.java
```

Use when:

- module small/medium,
- schema aligned with domain,
- team wants speed,
- rules manageable.

Rules:

- no entity as API response,
- transaction only in service/use case,
- separate query projection for listing,
- entity contains basic invariant methods.

### 30.2 Template B: Domain-Centric Module

```text
case/
  domain/
    Case.java
    CaseRepository.java
    CaseStatus.java
    CaseTransitionPolicy.java
  application/
    SubmitCaseUseCase.java
    SubmitCaseCommand.java
  infrastructure/persistence/
    JpaCaseEntity.java
    SpringDataCaseRepository.java
    JpaCaseRepositoryAdapter.java
    CasePersistenceMapper.java
  interfaces/rest/
    CaseController.java
    SubmitCaseRequest.java
    CaseResponse.java
```

Use when:

- core domain critical,
- business rule complex,
- long-lived system,
- need stronger testability,
- persistence schema not ideal.

### 30.3 Template C: CQRS-Light Enterprise Module

```text
case/
  command/
    SubmitCaseUseCase.java
    ApproveCaseUseCase.java
    AssignOfficerUseCase.java
  domain/
    CaseAggregate.java
    CaseStatus.java
    CaseTransitionPolicy.java
  persistence/
    CaseEntity.java
    CaseCommandRepository.java
    JpaCaseCommandRepository.java
  query/
    CaseInboxQuery.java
    CaseDetailQuery.java
    CaseReportQuery.java
    projections/
      CaseInboxItem.java
      CaseDetailView.java
      CaseAgingReportRow.java
  api/
    CaseCommandController.java
    CaseQueryController.java
```

Use when:

- many screens,
- complex filtering,
- dashboard/reporting,
- write correctness important,
- read performance important.

---

## 31. Example: Case Approval Architecture

### 31.1 Requirement

```text
Officer approves an enforcement case.
Rules:
- case must be UNDER_REVIEW
- officer must be assigned approver
- case must not be locked by another active review
- approval must write status history
- audit trail must capture before/after
- notification must be sent after successful commit
- duplicate request must not double-approve
```

### 31.2 Poor Design

```java
@PostMapping("/cases/{id}/approve")
public CaseEntity approve(@PathVariable Long id) {
    CaseEntity c = repo.findById(id).orElseThrow();
    c.setStatus("APPROVED");
    repo.save(c);
    email.send(...);
    return c;
}
```

Problems:

- controller owns business logic,
- no transaction clarity,
- no authorization rule,
- no optimistic lock,
- entity response leak,
- email inside request flow,
- audit missing,
- duplicate request unsafe.

### 31.3 Better Design

```java
@RestController
class CaseApprovalController {

    private final ApproveCaseUseCase approveCaseUseCase;

    @PostMapping("/cases/{id}/approve")
    ApproveCaseResponse approve(@PathVariable Long id,
                                @RequestBody ApproveCaseRequest request,
                                Principal principal) {
        ApproveCaseCommand command = new ApproveCaseCommand(
                new CaseId(id),
                new OfficerId(principal.getName()),
                request.reason(),
                request.idempotencyKey()
        );
        ApproveCaseResult result = approveCaseUseCase.handle(command);
        return ApproveCaseResponse.from(result);
    }
}
```

```java
@Service
class ApproveCaseUseCase {

    private final CaseCommandRepository caseRepository;
    private final OfficerAssignmentRepository assignmentRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final OutboxRepository outboxRepository;
    private final IdempotencyRepository idempotencyRepository;
    private final Clock clock;

    @Transactional
    public ApproveCaseResult handle(ApproveCaseCommand command) {
        if (idempotencyRepository.alreadyProcessed(command.idempotencyKey())) {
            return idempotencyRepository.previousResult(command.idempotencyKey());
        }

        CaseRecord caseRecord = caseRepository.findById(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        OfficerAssignment assignment = assignmentRepository.findActiveApprover(command.caseId())
                .orElseThrow(() -> new ApproverNotAssignedException(command.caseId()));

        CaseSnapshot before = CaseSnapshot.from(caseRecord);

        caseRecord.approve(command.officerId(), assignment, command.reason(), clock.instant());

        CaseSnapshot after = CaseSnapshot.from(caseRecord);

        auditTrailRepository.save(AuditTrail.caseApproved(before, after, command.officerId(), clock.instant()));
        outboxRepository.save(NotificationRequested.caseApproved(caseRecord.id()));

        ApproveCaseResult result = new ApproveCaseResult(caseRecord.id(), caseRecord.status());
        idempotencyRepository.markProcessed(command.idempotencyKey(), result);
        return result;
    }
}
```

Architecture properties:

- controller only adapts transport,
- use case owns transaction,
- domain owns transition rule,
- repository loads required state,
- audit and state change are atomic,
- notification uses outbox,
- idempotency is explicit,
- response is DTO.

---

## 32. Testing Architecture Boundaries

Gunakan test berbeda untuk boundary berbeda.

### 32.1 Domain Test

Test tanpa database.

```java
@Test
void cannotApproveDraftCase() {
    CaseRecord caseRecord = CaseRecord.draft("CASE-001");
    OfficerAssignment assignment = OfficerAssignment.approver("officer-1");

    assertThrows(InvalidCaseTransitionException.class,
            () -> caseRecord.approve(new OfficerId("officer-1"), assignment, "ok", Instant.now()));
}
```

### 32.2 Repository Integration Test

Test dengan database real/testcontainer.

```java
@Test
void findInboxReturnsProjectionWithoutLoadingFullGraph() {
    Page<CaseInboxItem> page = caseInboxQuery.search(filter, PageRequest.of(0, 20));
    assertThat(page.getContent()).hasSize(20);
}
```

### 32.3 Use Case Test

Test orchestration transaction behavior.

```java
@Test
void approveCaseWritesAuditAndOutboxInSameTransaction() {
    approveCaseUseCase.handle(command);

    assertThat(caseRepository.findById(caseId).orElseThrow().status()).isEqualTo(APPROVED);
    assertThat(auditTrailRepository.existsFor(caseId, "CASE_APPROVED")).isTrue();
    assertThat(outboxRepository.existsEvent("CASE_APPROVED", caseId)).isTrue();
}
```

### 32.4 Architecture Test

Dengan ArchUnit misalnya:

```java
noClasses()
    .that().resideInAPackage("..domain..")
    .should().dependOnClassesThat().resideInAnyPackage(
        "jakarta.persistence..",
        "org.hibernate..",
        "org.springframework.web.."
    );
```

Jika kamu memilih entity as domain model, rule ini bisa disesuaikan. Architecture tests harus mencerminkan keputusan nyata, bukan dogma.

---

## 33. Anti-Patterns

### 33.1 Entity as Everything

```text
Entity = request DTO = response DTO = domain = export row = audit payload
```

Akibat:

- coupling tinggi,
- security risk,
- performance risk,
- schema/API evolution sulit.

### 33.2 Generic Repository Everywhere

```java
interface GenericRepository<T, ID> {
    T save(T t);
    Optional<T> findById(ID id);
    List<T> findAll();
    void delete(T t);
}
```

Generic repository sering menghilangkan intent. Untuk domain kompleks, repository harus berbicara dalam bahasa use case/aggregate.

### 33.3 Service as God Class

```text
CaseService:
- create
- update
- delete
- approve
- reject
- export
- import
- report
- assign
- notify
- audit
- archive
```

Fix:

- use case class,
- query service terpisah,
- domain behavior,
- policy object.

### 33.4 Repository with Business Workflow

Repository tidak boleh menjadi approval engine.

### 33.5 Transaction on Every Method

`@Transactional` ditempel di semua method bukan desain. Itu sering menutupi boundary yang tidak dipahami.

### 33.6 Returning Managed Entity Outside Boundary

Managed entity harus selesai di use case boundary. Keluar sebagai DTO/result.

### 33.7 Over-Abstraction Too Early

Membuat port/adapter/mapper/domain separation untuk CRUD kecil bisa memperlambat tim tanpa value.

Prinsipnya:

```text
Start simple, but keep seams where complexity is expected.
```

---

## 34. Production Considerations

Architecture persistence harus mendukung operasi produksi.

Checklist:

1. Bisa tahu query apa yang dijalankan per endpoint/use case.
2. Bisa tahu transaction mana yang long-running.
3. Bisa tahu connection pool saturation.
4. Bisa tahu N+1 dari metrics/log.
5. Bisa trace request id ke audit/outbox/database operation.
6. Bisa classify exception retriable/non-retriable.
7. Bisa rollback migration.
8. Bisa menjalankan backfill tanpa membunuh application traffic.
9. Bisa membedakan read query dan write transaction.
10. Bisa enforce invariant di database.

Arsitektur yang terlihat indah tapi tidak bisa dioperasikan di production belum matang.

---

## 35. Heuristics untuk Staff-Level Review

Saat mereview persistence architecture, tanyakan:

1. Apa use case boundary-nya?
2. Apa transaction boundary-nya?
3. Apa aggregate/invariant yang dilindungi?
4. Apa yang terjadi jika dua request paralel masuk?
5. Apa yang terjadi jika DB commit sukses tapi external notification gagal?
6. Apakah API response bergantung pada entity graph?
7. Apakah listing/search menggunakan projection atau full entity?
8. Apakah query count bisa diprediksi?
9. Apakah database constraint menutup race condition?
10. Apakah exception persistence diterjemahkan dengan benar?
11. Apakah audit atomik dengan state change?
12. Apakah repository method mencerminkan intent?
13. Apakah domain logic tersebar di controller/service/repository?
14. Apakah lazy loading bisa terjadi di luar transaction?
15. Apakah schema migration bisa dilakukan zero/minimal downtime?

Jika jawaban atas pertanyaan ini tidak jelas, arsitektur persistence belum cukup matang.

---

## 36. Design Rules of Thumb

1. **Transaction belongs to use case**, not random repository method.
2. **Entity is not API contract**.
3. **DTO is boundary contract**, not domain model.
4. **Projection is first-class for read use cases**.
5. **Database constraint is part of correctness**, not optional decoration.
6. **Repository should express intent**, not merely expose table operations.
7. **Fetch plan belongs to use case/query**, not accidental serialization.
8. **External side effect should not be blindly executed inside DB transaction**.
9. **Separate write correctness from read performance when complexity grows**.
10. **Avoid both extremes**: anemic CRUD chaos and abstract architecture theater.

---

## 37. Summary

Persistence architecture adalah tentang mengendalikan boundary:

- boundary antara external contract dan internal model,
- boundary antara command dan query,
- boundary antara domain invariant dan database constraint,
- boundary antara transaction dan side effect,
- boundary antara managed entity dan DTO,
- boundary antara portability dan database-specific optimization,
- boundary antara simple design dan necessary complexity.

Untuk aplikasi kecil, layered architecture sederhana bisa cukup. Untuk aplikasi besar, terutama workflow/regulatory/case-management, kamu biasanya butuh desain yang lebih eksplisit:

```text
Command/use case layer owns transaction.
Domain model owns invariant/state behavior.
Repository/persistence adapter owns database access.
Query service owns read model/projection.
Database owns hard constraints and concurrency enforcement.
Outbox/inbox owns reliable integration boundary.
API DTO owns external contract.
```

Tujuan akhirnya bukan membuat arsitektur terlihat “clean”, tetapi membuat sistem:

- benar di bawah concurrency,
- mudah diubah,
- mudah diuji,
- performanya bisa diprediksi,
- failure mode-nya bisa dijelaskan,
- operasional di production,
- defensible secara audit/regulatory.

---

## 38. Latihan / Scenario

### Scenario 1 — Entity Leak

Sebuah endpoint mengembalikan `CaseEntity` langsung. Setelah developer menambahkan field `internalRiskScore`, field itu muncul di response API.

Pertanyaan:

1. Boundary apa yang dilanggar?
2. Kenapa ini bukan hanya masalah serialization?
3. Bagaimana desain DTO/projection yang lebih aman?

### Scenario 2 — Double Assignment

Requirement: hanya boleh ada satu active officer assignment untuk satu case.

Saat traffic tinggi, ditemukan dua active assignment untuk case yang sama.

Pertanyaan:

1. Kenapa application-level `existsActive()` tidak cukup?
2. Constraint database apa yang bisa membantu?
3. Apakah perlu optimistic lock, pessimistic lock, atau unique constraint?

### Scenario 3 — Reporting Query Lambat

Dashboard pending case memuat entity `Case` lengkap, termasuk applicant, documents, comments, audit trail, dan assignment.

Pertanyaan:

1. Kenapa full entity tidak cocok untuk dashboard?
2. Projection apa yang lebih sesuai?
3. Query ownership sebaiknya di repository aggregate atau query service?

### Scenario 4 — Approval + Notification

Use case approve case mengubah status dan langsung memanggil email service dalam transaction.

Pertanyaan:

1. Failure mode apa saja yang mungkin terjadi?
2. Bagaimana outbox memperbaiki desain?
3. Apa yang harus idempotent?

### Scenario 5 — Legacy Schema

Table `CASE_MASTER` punya 150 column dan dipakai untuk 12 workflow berbeda.

Pertanyaan:

1. Apakah entity sebagai domain model masih sehat?
2. Kapan perlu separate domain model?
3. Bagaimana membagi read/write model?

---

## 39. Referensi Utama

- Jakarta Persistence 3.2 Specification — https://jakarta.ee/specifications/persistence/3.2/
- Jakarta Persistence `EntityManager` API — https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager
- Jakarta Data 1.0 Specification — https://jakarta.ee/specifications/data/1.0/
- Jakarta Transactions 2.0 Specification — https://jakarta.ee/specifications/transactions/2.0/
- Jakarta EE Tutorial: Transactions — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/transactions/transactions.html
- Hibernate ORM 7 User Guide — https://docs.hibernate.org/orm/7.0/userguide/html_single/
- Hibernate ORM 7 Introduction — https://docs.hibernate.org/orm/7.0/introduction/html_single/

---

## 40. Status Seri

Seri belum selesai.

Saat ini selesai:

```text
Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer
Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions
Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction
```

Berikutnya:

```text
Part 003 — Entity Identity: Object Identity, Database Identity, Business Identity
```
