# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-011

# Part 011 — Persistence II: Panache Active Record vs Repository vs Domain-Centric Persistence

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / Top 1% Software Engineer Track  
> Fokus: Quarkus Hibernate ORM with Panache, Active Record, Repository, domain-centric persistence, testing, failure mode, dan keputusan arsitektural.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 010 kita sudah membahas Hibernate ORM di Quarkus dari sisi runtime dan production engineering:

- build-time entity discovery,
- datasource,
- Agroal pool,
- persistence unit,
- transaction boundary,
- flush timing,
- query shape,
- lazy loading,
- optimistic locking,
- migration discipline,
- observability,
- native-image implications.

Part ini melanjutkan satu lapisan lebih tinggi: **bagaimana kita mendesain persistence API di dalam aplikasi Quarkus**.

Quarkus menyediakan Hibernate ORM with Panache untuk menyederhanakan persistence code. Panache menawarkan dua gaya utama:

1. **Active Record style**  
   Entity mewarisi `PanacheEntity` atau `PanacheEntityBase`, lalu entity dapat memanggil method persistence seperti `persist()`, `find()`, `listAll()`, `delete()`, dan sejenisnya.

2. **Repository style**  
   Entity tetap lebih pasif, sedangkan persistence operation diletakkan pada class repository yang mengimplementasikan `PanacheRepository<T>` atau `PanacheRepositoryBase<T, ID>`.

Masalahnya: pertanyaan top engineer bukan sekadar:

> “Mana yang lebih enak?”

Pertanyaan yang lebih benar:

> “Untuk domain seperti apa Active Record aman? Untuk domain seperti apa Repository lebih sehat? Dan kapan dua-duanya tetap belum cukup sehingga kita butuh domain-centric persistence boundary yang eksplisit?”

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami apa yang benar-benar disederhanakan oleh Panache.
2. Membedakan Active Record, Repository, dan domain-centric persistence secara desain, bukan selera.
3. Menentukan kapan Panache mempercepat delivery dan kapan justru menciptakan coupling.
4. Mendesain persistence layer Quarkus untuk:
   - CRUD sederhana,
   - admin/backoffice module,
   - workflow/case management,
   - regulatory lifecycle,
   - audit-heavy system,
   - multi-tenant service,
   - high-read query service,
   - event/outbox integration.
5. Menghindari anti-pattern seperti:
   - entity terlalu pintar,
   - repository menjadi god object,
   - service menjadi transaction script raksasa,
   - DTO langsung menembus entity,
   - query tersebar di resource layer,
   - persistence leakage ke domain decision.
6. Menguji Panache dengan strategi yang sesuai.
7. Menyusun checklist keputusan sebelum memilih Active Record atau Repository.

---

## 2. Mental Model: Persistence API Adalah Boundary, Bukan Convenience Layer Saja

Banyak engineer melihat persistence layer sebagai tempat menyimpan dan mengambil data. Itu terlalu dangkal.

Dalam sistem production, persistence layer adalah boundary antara:

```text
Application intent
    ↓
Domain rule
    ↓
Consistency boundary
    ↓
Persistence model
    ↓
Physical database behavior
```

Panache menyederhanakan bagian ini:

```text
Boilerplate JPA/Hibernate code
```

Tetapi Panache tidak otomatis menyelesaikan:

```text
Domain boundary
Transaction boundary
Authorization boundary
Audit boundary
Workflow invariant
Query ownership
Aggregate consistency
Migration safety
Testability strategy
```

Karena itu Panache harus dipahami sebagai **tool untuk mengurangi mechanical persistence code**, bukan sebagai pengganti desain domain.

---

## 3. Apa yang Disederhanakan oleh Panache?

Tanpa Panache, Hibernate/JPA code biasanya penuh dengan pola seperti:

```java
@ApplicationScoped
public class PersonRepository {

    @Inject
    EntityManager em;

    public Person findById(Long id) {
        return em.find(Person.class, id);
    }

    public List<Person> findActive() {
        return em.createQuery("""
            select p
            from Person p
            where p.status = :status
            order by p.createdAt desc
        """, Person.class)
        .setParameter("status", PersonStatus.ACTIVE)
        .getResultList();
    }

    public void persist(Person person) {
        em.persist(person);
    }
}
```

Dengan Panache, common operation dipersingkat:

```java
@Entity
public class Person extends PanacheEntity {
    public String name;
    public PersonStatus status;
    public Instant createdAt;
}
```

Lalu:

```java
Person person = Person.findById(id);
List<Person> active = Person.list("status", PersonStatus.ACTIVE);
person.persist();
```

Atau repository style:

```java
@Entity
public class Person {
    @Id
    @GeneratedValue
    public Long id;

    public String name;
    public PersonStatus status;
    public Instant createdAt;
}
```

```java
@ApplicationScoped
public class PersonRepository implements PanacheRepository<Person> {

    public List<Person> findActive() {
        return list("status", PersonStatus.ACTIVE);
    }
}
```

Panache mengurangi:

- injected `EntityManager` boilerplate,
- repetitive query creation,
- simple pagination code,
- simple sorting code,
- common CRUD code,
- common repository plumbing,
- common mocking support,
- repetitive transaction-friendly persistence calls.

Tetapi Panache tidak menghapus kebutuhan untuk memahami:

- lifecycle entity,
- transaction,
- flush,
- lazy loading,
- dirty checking,
- query shape,
- locking,
- optimistic concurrency,
- database isolation,
- migration,
- outbox,
- audit.

---

## 4. Tiga Gaya Persistence yang Akan Dibandingkan

Kita akan membandingkan tiga gaya:

```text
1. Active Record
2. Repository
3. Domain-Centric Persistence
```

### 4.1 Active Record

Entity mengandung state dan persistence operation.

```java
@Entity
public class ApplicationCase extends PanacheEntity {
    public String caseNo;
    public CaseStatus status;

    public static ApplicationCase findByCaseNo(String caseNo) {
        return find("caseNo", caseNo).firstResult();
    }

    public void approve() {
        this.status = CaseStatus.APPROVED;
    }
}
```

Call site:

```java
@Transactional
public void approve(Long id) {
    ApplicationCase caze = ApplicationCase.findById(id);
    caze.approve();
}
```

### 4.2 Repository

Entity menyimpan state, repository menyimpan persistence operation.

```java
@Entity
public class ApplicationCase {
    @Id
    @GeneratedValue
    public Long id;

    public String caseNo;
    public CaseStatus status;

    public void approve() {
        this.status = CaseStatus.APPROVED;
    }
}
```

```java
@ApplicationScoped
public class ApplicationCaseRepository implements PanacheRepository<ApplicationCase> {

    public Optional<ApplicationCase> findByCaseNo(String caseNo) {
        return find("caseNo", caseNo).firstResultOptional();
    }
}
```

Call site:

```java
@Transactional
public void approve(Long id) {
    ApplicationCase caze = repository.findByIdOptional(id)
        .orElseThrow(() -> new NotFoundException("case not found"));

    caze.approve();
}
```

### 4.3 Domain-Centric Persistence

Repository tidak sekadar wrapper query. Repository menjadi boundary untuk mengambil dan menyimpan aggregate/domain object sesuai invariant bisnis.

```java
public interface CaseStore {
    Optional<CaseAggregate> findForDecision(CaseId id);
    void saveDecision(CaseAggregate aggregate, DecisionAudit audit);
}
```

Implementasi bisa memakai Panache di belakang:

```java
@ApplicationScoped
public class HibernateCaseStore implements CaseStore {

    @Inject
    ApplicationCaseRepository cases;

    @Inject
    CaseDecisionLogRepository decisionLogs;

    @Inject
    OutboxRepository outbox;

    @Override
    public Optional<CaseAggregate> findForDecision(CaseId id) {
        return cases.findWithDecisionData(id.value())
            .map(CaseAggregateMapper::toDomain);
    }

    @Override
    public void saveDecision(CaseAggregate aggregate, DecisionAudit audit) {
        ApplicationCaseEntity entity = cases.findById(aggregate.id().value());
        CaseAggregateMapper.apply(entity, aggregate);

        decisionLogs.persist(DecisionLogEntity.from(audit));
        outbox.persist(OutboxEventEntity.from(aggregate.pullDomainEvents()));
    }
}
```

Call site:

```java
@Transactional
public void decide(DecideCaseCommand command) {
    CaseAggregate caze = caseStore.findForDecision(command.caseId())
        .orElseThrow(CaseNotFoundException::new);

    caze.decide(command.decision(), command.actor(), clock.instant());

    caseStore.saveDecision(caze, DecisionAudit.from(command, caze));
}
```

Ini bukan selalu diperlukan. Tetapi untuk domain kompleks, ini jauh lebih defensible.

---

## 5. Active Record Pattern di Panache

### 5.1 Bentuk Dasar

```java
@Entity
public class Person extends PanacheEntity {
    public String name;
    public LocalDate birth;
    public Status status;

    public static List<Person> findAlive() {
        return list("status", Status.ALIVE);
    }

    public static Optional<Person> findByName(String name) {
        return find("name", name).firstResultOptional();
    }
}
```

Karena extend `PanacheEntity`, entity otomatis memiliki:

```java
public Long id;
```

Dan method persistence seperti:

```java
persist()
delete()
isPersistent()
findById()
find()
list()
stream()
count()
deleteAll()
update()
```

### 5.2 `PanacheEntity` vs `PanacheEntityBase`

`PanacheEntity` cocok ketika kamu menerima konvensi:

```java
@Id
@GeneratedValue
public Long id;
```

`PanacheEntityBase` cocok ketika kamu ingin mendefinisikan ID sendiri:

```java
@Entity
public class Country extends PanacheEntityBase {

    @Id
    public String code;

    public String name;
}
```

### 5.3 Kapan Active Record Cocok?

Active Record cocok untuk:

1. CRUD sederhana.
2. Admin table sederhana.
3. Lookup table.
4. Small internal tool.
5. Prototype yang tetap ingin production-friendly.
6. Entity yang query-nya tidak banyak variasi.
7. Entity yang tidak menjadi aggregate root kompleks.
8. Service dengan domain logic tipis.

Contoh cocok:

```text
Country
Currency
FeatureFlag
SimpleAnnouncement
NotificationTemplate
SystemParameter
PostalCodeCache
```

Untuk entity seperti ini, repository eksplisit kadang hanya menjadi ceremony.

### 5.4 Kapan Active Record Mulai Bermasalah?

Active Record mulai bermasalah ketika entity menjadi tempat semua hal:

```java
@Entity
public class CaseFile extends PanacheEntity {

    public CaseStatus status;
    public String assignedOfficer;
    public LocalDate dueDate;

    public static List<CaseFile> findPendingForOfficer(String officer) { ... }
    public static List<CaseFile> findOverdueForEscalation() { ... }
    public static List<CaseFile> findForDashboard(...) { ... }
    public static List<CaseFile> findForReport(...) { ... }
    public static List<CaseFile> findForAuditExport(...) { ... }
    public static List<CaseFile> findForSupervisorQueue(...) { ... }

    public void submit() { ... }
    public void approve() { ... }
    public void reject() { ... }
    public void escalate() { ... }
    public void reopen() { ... }
    public void transfer() { ... }
    public void assign() { ... }
    public void calculateSla() { ... }
    public void emitAudit() { ... }
    public void sendEmail() { ... }
}
```

Ini tanda entity sudah berubah menjadi:

```text
entity + repository + domain service + application service + integration service
```

Itu berbahaya.

### 5.5 Risiko Active Record

#### Risiko 1 — Persistence operation tersebar sebagai static call

```java
ApplicationCase.find("status", PENDING).list();
```

Static call mudah dipakai dari mana saja. Akibatnya query bisa tersebar ke:

- resource,
- service,
- scheduler,
- event consumer,
- validator,
- mapper,
- test helper.

Jika query ownership tidak jelas, sistem sulit di-refactor.

#### Risiko 2 — Entity terlalu dekat dengan database

Active Record membuat entity secara eksplisit tahu persistence operation. Untuk domain kompleks, ini bisa mencampur:

```text
business identity
state transition
persistence concern
query concern
```

#### Risiko 3 — Testing static persistence lebih sulit

Panache menyediakan mocking support, tetapi static method tetap lebih tricky dibanding repository CDI bean.

Repository bisa di-mock seperti dependency biasa:

```java
@InjectMock
ApplicationCaseRepository repository;
```

Active Record static method membutuhkan Panache mock mechanism.

#### Risiko 4 — Domain boundary kabur

Ketika semua orang bisa memanggil:

```java
CaseFile.findById(id)
```

maka sulit memastikan semua access melewati:

- authorization check,
- tenancy filter,
- audit context,
- lock requirement,
- soft delete rule,
- data visibility rule.

#### Risiko 5 — Query kompleks membuat entity bengkak

Active Record bagus untuk query sederhana. Tetapi ketika ada dashboard/report/search/export, entity bisa berubah menjadi query dumping ground.

---

## 6. Repository Pattern di Panache

### 6.1 Bentuk Dasar

```java
@Entity
public class Person {
    @Id
    @GeneratedValue
    public Long id;

    public String name;
    public LocalDate birth;
    public Status status;
}
```

```java
@ApplicationScoped
public class PersonRepository implements PanacheRepository<Person> {

    public List<Person> findAlive() {
        return list("status", Status.ALIVE);
    }

    public Optional<Person> findByName(String name) {
        return find("name", name).firstResultOptional();
    }
}
```

Call site:

```java
@ApplicationScoped
public class PersonService {

    @Inject
    PersonRepository people;

    @Transactional
    public void rename(Long id, String newName) {
        Person person = people.findByIdOptional(id)
            .orElseThrow(NotFoundException::new);
        person.name = newName;
    }
}
```

### 6.2 `PanacheRepository<T>` vs `PanacheRepositoryBase<T, ID>`

Gunakan `PanacheRepository<T>` jika ID adalah `Long` default.

```java
@ApplicationScoped
public class PersonRepository implements PanacheRepository<Person> {
}
```

Gunakan `PanacheRepositoryBase<T, ID>` jika ID bukan `Long`.

```java
@ApplicationScoped
public class CountryRepository implements PanacheRepositoryBase<Country, String> {
}
```

### 6.3 Kapan Repository Cocok?

Repository cocok untuk:

1. Domain sedang sampai kompleks.
2. Banyak query per aggregate.
3. Query ownership harus jelas.
4. Perlu mocking lebih mudah.
5. Entity tidak ingin inherit Panache base class.
6. ID custom.
7. Multi-module domain model.
8. Clean architecture style.
9. Domain object ingin tetap lebih POJO-like.
10. Perlu abstraction boundary untuk future migration.

### 6.4 Repository Bukan Tempat Semua Logic

Repository seharusnya menjawab pertanyaan persistence:

```text
Bagaimana mengambil/menyimpan data sesuai kebutuhan use case?
```

Repository bukan tempat utama untuk:

```text
authorization decision
workflow transition
external API call
email sending
business orchestration
DTO validation
HTTP error mapping
```

Buruk:

```java
@ApplicationScoped
public class CaseRepository implements PanacheRepository<CaseEntity> {

    public void approveCase(Long caseId, String officerId) {
        CaseEntity caze = findById(caseId);

        if (!officerHasPermission(officerId, caze)) {
            throw new ForbiddenException();
        }

        caze.status = APPROVED;
        sendApprovalEmail(caze);
        audit("approved");
        callExternalSystem(caze);
    }
}
```

Lebih sehat:

```java
@ApplicationScoped
public class DecideCaseUseCase {

    @Inject
    CaseRepository cases;

    @Inject
    CasePolicy policy;

    @Inject
    AuditLog audit;

    @Inject
    OutboxRepository outbox;

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseEntity caze = cases.findForDecision(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

        policy.assertCanApprove(command.actor(), caze);

        caze.approve(command.actor(), clock.instant());
        audit.recordCaseApproved(caze, command.actor());
        outbox.persist(CaseApprovedEvent.from(caze));
    }
}
```

---

## 7. Domain-Centric Persistence

Repository pattern masih bisa dangkal jika hanya menjadi wrapper `list()`, `find()`, dan `persist()`.

Domain-centric persistence berarti persistence layer didesain berdasarkan **aggregate/use case boundary**, bukan berdasarkan table saja.

### 7.1 Problem dengan Table-Centric Repository

Misalnya ada domain case management:

```text
CASE
CASE_PARTY
CASE_DOCUMENT
CASE_ASSIGNMENT
CASE_DECISION
CASE_AUDIT
CASE_SLA
OUTBOX_EVENT
```

Table-centric repository akan menghasilkan:

```text
CaseRepository
CasePartyRepository
CaseDocumentRepository
CaseAssignmentRepository
CaseDecisionRepository
CaseAuditRepository
CaseSlaRepository
OutboxRepository
```

Lalu application service harus menggabungkan semuanya.

```java
@Transactional
public void approve(ApproveCommand command) {
    CaseEntity caze = cases.findById(command.caseId());
    List<CasePartyEntity> parties = parties.findByCaseId(command.caseId());
    List<DocumentEntity> docs = docs.findByCaseId(command.caseId());
    SlaEntity sla = slas.findByCaseId(command.caseId());

    // many rules here...
}
```

Ini tidak selalu salah. Tetapi untuk domain kompleks, service bisa menjadi transaction script yang besar.

### 7.2 Aggregate-Centric Store

Alternatif:

```java
public interface CaseDecisionStore {
    Optional<CaseForDecision> loadForDecision(CaseId caseId);
    void saveDecision(CaseForDecision aggregate, DecisionMetadata metadata);
}
```

Implementasi tetap memakai Panache repository di bawah.

```java
@ApplicationScoped
public class HibernateCaseDecisionStore implements CaseDecisionStore {

    @Inject
    CaseRepository cases;

    @Inject
    CaseDocumentRepository documents;

    @Inject
    CaseDecisionRepository decisions;

    @Inject
    OutboxRepository outbox;

    @Override
    public Optional<CaseForDecision> loadForDecision(CaseId caseId) {
        return cases.findCaseHeaderForDecision(caseId.value())
            .map(header -> {
                List<DocumentEntity> docs = documents.findRequiredDocs(caseId.value());
                return CaseForDecisionAssembler.assemble(header, docs);
            });
    }

    @Override
    public void saveDecision(CaseForDecision aggregate, DecisionMetadata metadata) {
        CaseEntity entity = cases.findById(aggregate.id().value());
        CaseForDecisionAssembler.apply(entity, aggregate);

        decisions.persist(DecisionEntity.from(aggregate, metadata));
        outbox.persist(OutboxEventEntity.caseDecided(aggregate));
    }
}
```

Keuntungan:

- application service lebih kecil,
- invariant lebih terlihat,
- repository query tetap terpusat,
- persistence detail tidak bocor ke domain logic,
- outbox/audit bisa dijaga satu boundary,
- lebih mudah review secara regulatory.

### 7.3 Domain-Centric Tidak Sama dengan Overengineering

Domain-centric persistence bukan berarti semua entity harus jadi DDD aggregate murni.

Gunakan jika ada sinyal berikut:

1. Ada state machine.
2. Ada approval/escalation lifecycle.
3. Ada audit defensibility.
4. Ada authorization berbasis state/resource.
5. Ada cross-table invariant.
6. Ada event/outbox yang harus konsisten dengan write.
7. Ada concurrency risk.
8. Ada report/read model yang berbeda dari write model.
9. Ada multi-tenant atau data visibility rule.
10. Ada data retention/archival concern.

Kalau hanya CRUD sederhana, domain-centric layer bisa terlalu berat.

---

## 8. Decision Matrix: Active Record vs Repository vs Domain-Centric

| Kondisi | Active Record | Repository | Domain-Centric |
|---|---:|---:|---:|
| CRUD sederhana | Sangat cocok | Cocok | Berlebihan |
| Lookup table | Sangat cocok | Cocok | Berlebihan |
| Banyak query bisnis | Kurang cocok | Cocok | Cocok |
| Workflow kompleks | Tidak cocok | Cukup | Sangat cocok |
| Audit/regulatory tinggi | Tidak ideal | Cocok | Sangat cocok |
| Testing unit mudah | Sedang | Baik | Baik |
| Static call acceptable | Ya | Tidak perlu | Tidak perlu |
| Clean architecture | Lemah | Baik | Sangat baik |
| Rapid prototype | Sangat cocok | Cocok | Lambat |
| Long-term enterprise module | Risiko meningkat | Cocok | Cocok sekali |
| Multi-tenant visibility | Risiko bocor | Lebih aman | Paling aman |
| Outbox consistency | Bisa, tapi rawan tersebar | Baik | Sangat baik |
| Complex authorization | Kurang cocok | Baik | Sangat baik |
| Native image concern | Umumnya aman | Umumnya aman | Tergantung mapping |

Rule praktis:

```text
Active Record untuk simple data ownership.
Repository untuk persistence ownership.
Domain-Centric untuk invariant ownership.
```

---

## 9. Layering yang Sehat di Quarkus dengan Panache

### 9.1 Minimal CRUD Module

```text
Resource
  ↓
Entity extends PanacheEntity
  ↓
Database
```

Cocok untuk:

- demo,
- small internal service,
- lookup management,
- simple CRUD.

Contoh:

```java
@Path("/countries")
public class CountryResource {

    @GET
    public List<Country> list() {
        return Country.listAll(Sort.by("name"));
    }

    @POST
    @Transactional
    public Response create(Country country) {
        country.persist();
        return Response.status(201).entity(country).build();
    }
}
```

Ini cepat, tetapi untuk production public API tetap perlu hati-hati karena entity langsung terekspos sebagai API contract.

### 9.2 Application Service + Repository

```text
Resource
  ↓
Application Service / Use Case
  ↓
Repository
  ↓
Entity
  ↓
Database
```

Cocok untuk sebagian besar business service.

```java
@Path("/cases")
public class CaseResource {

    @Inject
    CaseApplicationService service;

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") Long id, ApproveRequest request) {
        service.approve(new ApproveCaseCommand(id, request.reason()));
        return Response.noContent().build();
    }
}
```

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject
    CaseRepository cases;

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseEntity caze = cases.findByIdOptional(command.caseId())
            .orElseThrow(CaseNotFoundException::new);
        caze.approve(command.reason());
    }
}
```

### 9.3 Domain-Centric Boundary

```text
Resource
  ↓
Use Case
  ↓
Domain Policy / Aggregate
  ↓
Domain Store Interface
  ↓
Panache Repositories / Hibernate Entities
  ↓
Database
```

Cocok untuk high-value domain.

```java
@ApplicationScoped
public class DecideCaseUseCase {

    @Inject
    CaseDecisionStore store;

    @Inject
    CaseDecisionPolicy policy;

    @Transactional
    public void decide(DecideCaseCommand command) {
        CaseForDecision caze = store.loadForDecision(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

        policy.assertAllowed(command.actor(), caze, command.decision());
        caze.decide(command.decision(), command.reason(), command.actor(), command.now());
        store.saveDecision(caze, DecisionMetadata.from(command));
    }
}
```

---

## 10. Entity Design dengan Panache

### 10.1 Public Field vs Getter/Setter

Panache examples sering memakai public field:

```java
@Entity
public class Person extends PanacheEntity {
    public String name;
    public LocalDate birth;
}
```

Ini sengaja untuk mengurangi boilerplate. Tetapi di enterprise domain, public field harus dipilih dengan sadar.

Masalah public field:

```java
caze.status = APPROVED;
```

Siapa pun bisa bypass invariant.

Lebih aman untuk domain penting:

```java
@Entity
public class CaseEntity {

    @Id
    @GeneratedValue
    private Long id;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    protected CaseEntity() {
        // for Hibernate
    }

    public void approve(OfficerId officer, Instant now) {
        if (status != CaseStatus.PENDING_APPROVAL) {
            throw new InvalidCaseTransitionException(status, CaseStatus.APPROVED);
        }
        this.status = CaseStatus.APPROVED;
        this.approvedBy = officer.value();
        this.approvedAt = now;
    }
}
```

Dengan Panache repository, kamu tidak perlu entity extend `PanacheEntity`, sehingga encapsulation lebih mudah.

### 10.2 Entity Tidak Harus Sama dengan API DTO

Buruk:

```java
@POST
@Transactional
public CaseEntity create(CaseEntity request) {
    request.persist();
    return request;
}
```

Masalah:

- API bisa mengisi field internal,
- entity shape menjadi contract publik,
- lazy relation bisa terserialisasi,
- field sensitif bisa bocor,
- refactoring database memecahkan API,
- validasi domain bercampur dengan persistence.

Lebih sehat:

```java
public record CreateCaseRequest(
    String applicantName,
    String applicationType
) {}

public record CaseResponse(
    Long id,
    String caseNo,
    String status
) {}
```

```java
@POST
@Transactional
public Response create(CreateCaseRequest request) {
    CaseResponse response = service.create(request);
    return Response.status(201).entity(response).build();
}
```

### 10.3 Entity Method Boleh Ada, Tapi Harus Jelas Jenisnya

Entity method yang baik:

```java
public void approve(OfficerId officer, Instant now) { ... }
public void reject(OfficerId officer, String reason, Instant now) { ... }
public boolean isOverdue(Instant now) { ... }
public void assignTo(OfficerId officer, Instant now) { ... }
```

Entity method yang mencurigakan:

```java
public void sendEmail() { ... }
public void callExternalApi() { ... }
public void generatePdf() { ... }
public void checkCurrentUserPermission() { ... }
public Response toHttpResponse() { ... }
```

Rule:

```text
Entity boleh tahu state dan invariant dirinya.
Entity tidak boleh tahu transport, external integration, current HTTP user, atau infrastructure side effect.
```

---

## 11. Query Design dengan Panache

### 11.1 Simple Query

```java
public List<Person> findByStatus(Status status) {
    return list("status", status);
}
```

Panache query shorthand bagus untuk simple equality.

### 11.2 Named Query untuk Query Penting

Untuk query penting dan sering dipakai, named query bisa lebih eksplisit.

```java
@Entity
@NamedQuery(
    name = "Case.findPendingApproval",
    query = """
        select c
        from CaseEntity c
        where c.status = :status
        order by c.submittedAt asc
    """
)
public class CaseEntity { ... }
```

```java
public List<CaseEntity> findPendingApproval() {
    return find("#Case.findPendingApproval", Parameters.with("status", PENDING_APPROVAL)).list();
}
```

### 11.3 Projection untuk Read Model

Jangan selalu return entity.

```java
public record CaseQueueItem(
    Long id,
    String caseNo,
    String applicantName,
    CaseStatus status,
    Instant submittedAt
) {}
```

```java
public List<CaseQueueItem> findQueueItems() {
    return find("""
        select c.id, c.caseNo, c.applicantName, c.status, c.submittedAt
        from CaseEntity c
        where c.status = ?1
        order by c.submittedAt asc
    """, PENDING_APPROVAL)
    .project(CaseQueueItem.class)
    .list();
}
```

Projection mengurangi:

- over-fetching,
- accidental lazy loading,
- serialization risk,
- memory pressure,
- dirty checking overhead.

### 11.4 Pagination

```java
public PanacheQuery<CaseEntity> findPendingApprovalPageable() {
    return find("status", Sort.by("submittedAt"), PENDING_APPROVAL);
}
```

Call:

```java
PanacheQuery<CaseEntity> query = repository.findPendingApprovalPageable()
    .page(Page.of(pageIndex, pageSize));

List<CaseEntity> items = query.list();
long total = query.count();
```

Hati-hati:

- `count()` bisa mahal,
- offset pagination tidak cocok untuk deep page,
- sorting harus stable,
- index harus mendukung filter + order.

Untuk high-volume queue, pertimbangkan keyset pagination.

### 11.5 Locking

Panache mendukung lock mode melalui API find.

Contoh repository:

```java
public Optional<CaseEntity> findForUpdate(Long id) {
    return find("id", id)
        .withLock(LockModeType.PESSIMISTIC_WRITE)
        .firstResultOptional();
}
```

Gunakan locking dengan sadar:

```text
Optimistic locking untuk conflict detection.
Pessimistic locking untuk mencegah concurrent modification pada critical section pendek.
```

Jangan pakai pessimistic lock untuk workflow panjang atau external API call.

---

## 12. Transaction Boundary dengan Panache

Panache method persistence tetap membutuhkan transaction untuk write.

```java
@Transactional
public void create(CreatePersonCommand command) {
    Person person = new Person();
    person.name = command.name();
    person.persist();
}
```

### 12.1 Jangan Letakkan Transaction Sembarangan

Buruk:

```java
@Path("/cases")
public class CaseResource {

    @POST
    @Path("/{id}/approve")
    @Transactional
    public Response approve(@PathParam("id") Long id) {
        CaseEntity caze = CaseEntity.findById(id);
        caze.status = APPROVED;
        return Response.noContent().build();
    }
}
```

Kenapa buruk:

- resource menjadi transaction boundary,
- business logic melekat ke HTTP,
- sulit dipakai dari scheduler/event consumer,
- testing use case lebih sulit,
- authorization/audit mudah tersebar.

Lebih baik:

```java
@Path("/cases")
public class CaseResource {

    @Inject
    ApproveCaseUseCase approveCase;

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") Long id, ApproveCaseRequest request) {
        approveCase.handle(new ApproveCaseCommand(id, request.reason()));
        return Response.noContent().build();
    }
}
```

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    @Inject
    CaseRepository cases;

    @Transactional
    public void handle(ApproveCaseCommand command) {
        CaseEntity caze = cases.findByIdOptional(command.caseId())
            .orElseThrow(CaseNotFoundException::new);
        caze.approve(command.reason());
    }
}
```

### 12.2 Transaction Boundary Harus Mengikuti Consistency Boundary

Jika operasi harus atomic:

```text
update case status
insert decision log
insert audit trail
insert outbox event
```

maka satu transaction boundary masuk akal.

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseEntity caze = cases.findByIdOptional(command.caseId())
        .orElseThrow(CaseNotFoundException::new);

    caze.approve(command.actor(), command.reason(), clock.instant());

    decisionLogs.persist(DecisionLogEntity.approved(caze, command));
    auditLogs.persist(AuditLogEntity.caseApproved(caze, command));
    outbox.persist(OutboxEventEntity.caseApproved(caze));
}
```

Tetapi jangan memasukkan external call di dalam transaction:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    caze.approve(...);
    externalSystem.notifyApproval(...); // dangerous
}
```

Karena:

- transaction DB bisa rollback setelah external call sukses,
- external call bisa lambat sambil memegang lock/connection,
- retry bisa double-send,
- latency database meningkat.

Gunakan outbox:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    caze.approve(...);
    outbox.persist(OutboxEventEntity.caseApproved(caze));
}
```

Lalu worker publish event setelah commit.

---

## 13. Panache dan Domain Events

Panache tidak menyediakan domain event model otomatis. Kamu harus mendesainnya.

### 13.1 Simple Domain Event Collection

```java
@Entity
public class CaseEntity {

    @Transient
    private final List<DomainEvent> events = new ArrayList<>();

    public void approve(OfficerId officer, Instant now) {
        this.status = CaseStatus.APPROVED;
        this.approvedBy = officer.value();
        this.approvedAt = now;

        events.add(new CaseApprovedEvent(this.id, officer.value(), now));
    }

    public List<DomainEvent> pullEvents() {
        List<DomainEvent> copy = List.copyOf(events);
        events.clear();
        return copy;
    }
}
```

Use case:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseEntity caze = cases.findById(command.caseId());
    caze.approve(command.actor(), clock.instant());

    for (DomainEvent event : caze.pullEvents()) {
        outbox.persist(OutboxEventEntity.from(event));
    }
}
```

### 13.2 Jangan Publish Event Langsung dari Entity

Buruk:

```java
public void approve() {
    this.status = APPROVED;
    eventBus.publish(new CaseApprovedEvent(id));
}
```

Entity tidak boleh tahu infrastructure bus. Selain itu publish bisa terjadi sebelum commit.

---

## 14. Soft Delete, Tenancy, dan Visibility Rules

Salah satu risiko Active Record adalah query bypass.

Misalnya entity punya soft delete:

```java
@Entity
public class CaseEntity extends PanacheEntity {
    public boolean deleted;
}
```

Kalau ada developer menulis:

```java
CaseEntity.listAll();
```

maka data deleted bisa ikut muncul.

Repository bisa memusatkan rule:

```java
@ApplicationScoped
public class CaseRepository implements PanacheRepository<CaseEntity> {

    public Optional<CaseEntity> findVisibleById(Long id, TenantId tenantId) {
        return find("id = ?1 and tenantId = ?2 and deleted = false", id, tenantId.value())
            .firstResultOptional();
    }

    public List<CaseEntity> findVisibleForOfficer(TenantId tenantId, OfficerId officerId) {
        return list("tenantId = ?1 and assignedOfficer = ?2 and deleted = false",
            tenantId.value(), officerId.value());
    }
}
```

Domain-centric store lebih jauh lagi:

```java
public interface CaseVisibilityStore {
    Optional<VisibleCase> findForActor(CaseId id, Actor actor);
}
```

Dengan ini, query visibility tidak tersebar.

---

## 15. Multi-Tenancy dengan Panache

Untuk multi-tenant app, pertanyaan penting:

```text
Apakah tenant isolation enforced oleh database, Hibernate, repository, atau application policy?
```

Jika hanya application code:

```java
find("tenantId = ?1 and id = ?2", tenantId, id)
```

maka bypass risk tinggi.

Active Record memudahkan bypass:

```java
CaseEntity.findById(id); // lupa tenant
```

Repository/domain store lebih aman karena kamu bisa menghapus method unsafe dari call site.

```java
public Optional<CaseEntity> findByIdForTenant(CaseId id, TenantId tenantId) {
    return find("id = ?1 and tenantId = ?2", id.value(), tenantId.value())
        .firstResultOptional();
}
```

Prinsip:

```text
Untuk multi-tenant system, jangan biarkan arbitrary code memanggil generic findById tanpa tenant context.
```

---

## 16. Audit-Heavy System

Dalam sistem regulatory, persistence operation tidak hanya menyimpan state baru. Ia harus bisa menjawab:

```text
Siapa melakukan apa?
Kapan?
Dari state apa ke state apa?
Berdasarkan alasan apa?
Dengan authority apa?
Data apa yang berubah?
Apakah perubahan ini valid menurut policy saat itu?
```

Active Record raw update tidak cukup:

```java
caze.status = APPROVED;
```

Lebih baik:

```java
caze.approve(actor, reason, now);
audit.record(AuditEvent.caseApproved(caze, actor, reason, now));
```

Domain-centric boundary membuat audit lebih defensible:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseForDecision caze = store.loadForDecision(command.caseId())
        .orElseThrow(CaseNotFoundException::new);

    DecisionResult result = caze.approve(command.actor(), command.reason(), command.now());

    store.saveDecision(caze, DecisionAudit.from(result, command));
}
```

Audit tidak menjadi side-effect random, tetapi bagian dari consistency boundary.

---

## 17. Testing Panache

### 17.1 Repository Style Testing

Repository sebagai CDI bean mudah di-test dengan `@QuarkusTest`.

```java
@QuarkusTest
class PersonRepositoryTest {

    @Inject
    PersonRepository people;

    @Test
    @Transactional
    void shouldFindAlivePeople() {
        Person p = new Person();
        p.name = "Alice";
        p.status = Status.ALIVE;
        people.persist(p);

        List<Person> alive = people.findAlive();

        assertThat(alive).extracting(x -> x.name).contains("Alice");
    }
}
```

### 17.2 Service Test dengan Mock Repository

```java
@QuarkusTest
class ApproveCaseUseCaseTest {

    @Inject
    ApproveCaseUseCase useCase;

    @InjectMock
    CaseRepository cases;

    @Test
    void shouldApprovePendingCase() {
        CaseEntity caze = CaseEntity.pending(1L);
        when(cases.findByIdOptional(1L)).thenReturn(Optional.of(caze));

        useCase.handle(new ApproveCaseCommand(1L, "valid"));

        assertEquals(APPROVED, caze.status());
    }
}
```

Ini lebih mudah dibanding static Active Record.

### 17.3 Active Record Testing

Active Record bisa dites dengan database real menggunakan `@QuarkusTest`.

```java
@QuarkusTest
class PersonActiveRecordTest {

    @Test
    @Transactional
    void shouldFindAlivePeople() {
        Person p = new Person();
        p.name = "Alice";
        p.status = Status.ALIVE;
        p.persist();

        List<Person> alive = Person.findAlive();

        assertThat(alive).extracting(x -> x.name).contains("Alice");
    }
}
```

Untuk mocking static Panache methods, gunakan support khusus Panache mock. Ini berguna, tetapi tetap lebih specialized dibanding mocking CDI repository.

### 17.4 Jangan Mock Hibernate untuk Semua Hal

Untuk query behavior, test terbaik sering kali adalah integration test dengan database nyata/testcontainer/dev services.

Mock cocok untuk:

```text
use case branch
policy behavior
error mapping
external dependency
```

Database test cocok untuk:

```text
query correctness
mapping correctness
constraint behavior
transaction behavior
lock behavior
migration compatibility
```

---

## 18. Performance Considerations

### 18.1 Active Record Tidak Lebih Cepat Secara Magic

Active Record dan Repository sama-sama memakai Hibernate ORM. Perbedaan utamanya adalah API style, bukan query engine.

Performance tetap ditentukan oleh:

- query shape,
- index,
- fetch plan,
- transaction scope,
- flush timing,
- persistence context size,
- connection pool,
- result size,
- projection,
- locking,
- database plan.

### 18.2 Jangan Return Entity untuk Semua Read

Untuk list page:

```java
List<CaseEntity> cases = CaseEntity.listAll();
```

Masalah:

- semua column terambil,
- relation risk,
- entity managed,
- dirty checking overhead,
- serialization risk.

Lebih baik projection:

```java
public record CaseSummary(Long id, String caseNo, CaseStatus status) {}
```

```java
public List<CaseSummary> findSummaries() {
    return find("status", ACTIVE)
        .project(CaseSummary.class)
        .list();
}
```

### 18.3 Persistence Context Bloat

Dalam batch update:

```java
for (CaseEntity caze : cases) {
    caze.recalculateSla(now);
}
```

Jika ribuan entity dimuat dalam satu transaction, persistence context membengkak.

Solusi:

- process by page,
- flush/clear batch,
- bulk update jika aman,
- gunakan stateless strategy jika cocok,
- hindari relation graph besar.

### 18.4 Bulk Update Hati-Hati

Panache mendukung update query:

```java
update("status = ?1 where dueDate < ?2", OVERDUE, today);
```

Bulk update cepat, tetapi:

- bypass entity lifecycle callback,
- bypass domain method,
- persistence context bisa stale,
- audit event tidak otomatis terbentuk,
- optimistic lock version bisa perlu perhatian.

Untuk regulatory domain, bulk update harus punya audit strategy.

---

## 19. Anti-Pattern Catalogue

### Anti-Pattern 1 — Resource Langsung Memanggil Entity Active Record

```java
@POST
@Path("/{id}/approve")
@Transactional
public void approve(@PathParam("id") Long id) {
    CaseEntity caze = CaseEntity.findById(id);
    caze.status = APPROVED;
}
```

Masalah:

- HTTP layer berisi business transition,
- authorization/audit mudah hilang,
- transaction boundary tidak reusable,
- testing use case lebih sulit.

### Anti-Pattern 2 — Entity sebagai API Contract

```java
public CaseEntity create(CaseEntity request) { ... }
```

Masalah:

- over-posting,
- field internal bocor,
- lazy loading serialization,
- API terikat DB schema.

### Anti-Pattern 3 — Repository Berisi Semua Query Semua Use Case

```java
public class CaseRepository {
    findForApproval()
    findForDashboard()
    findForReportA()
    findForReportB()
    findForExport()
    findForEmailReminder()
    findForEscalation()
    findForAuditTrail()
    findForMobileView()
    findForSupervisorQueue()
}
```

Solusi:

- pisahkan read repository berdasarkan use case,
- gunakan projection,
- gunakan query service,
- pisahkan command store dan read model jika perlu.

### Anti-Pattern 4 — Generic Repository Abstraction Berlebihan

```java
public interface GenericRepository<T, ID> {
    T findById(ID id);
    List<T> findAll();
    void save(T entity);
    void delete(T entity);
}
```

Masalah:

- Panache sudah menyediakan generic operation,
- abstraction tidak membawa domain meaning,
- query penting tetap harus custom,
- bisa menyembunyikan Hibernate behavior.

Lebih baik repository yang eksplisit:

```java
public class CaseRepository implements PanacheRepository<CaseEntity> {
    Optional<CaseEntity> findForDecision(CaseId id) { ... }
    List<CaseQueueItem> findQueueForOfficer(OfficerId officer) { ... }
}
```

### Anti-Pattern 5 — `listAll()` di Production Endpoint

```java
return CaseEntity.listAll();
```

Masalah:

- unbounded result,
- memory pressure,
- latency spike,
- database load,
- serialization explosion.

Selalu gunakan:

- pagination,
- limit,
- filter,
- projection,
- stable sorting.

### Anti-Pattern 6 — Static Query Tersebar

```java
CaseEntity.find("status", status).list();
```

Jika tersebar, query governance hilang.

### Anti-Pattern 7 — Domain Rule di Query String

```java
find("status in ('SUBMITTED', 'PENDING_REVIEW') and riskScore > 80")
```

Jika rule ini penting, beri nama secara domain:

```java
findHighRiskCasesAwaitingReview()
```

Agar reviewer memahami intention, bukan hanya SQL predicate.

---

## 20. Panache untuk Read Model dan CQRS Ringan

Tidak semua read harus melewati aggregate entity.

Untuk dashboard:

```java
public record OfficerDashboardItem(
    Long caseId,
    String caseNo,
    String applicantName,
    CaseStatus status,
    int daysPending
) {}
```

Repository:

```java
@ApplicationScoped
public class CaseDashboardQuery {

    @Inject
    EntityManager em;

    public List<OfficerDashboardItem> findForOfficer(String officerId) {
        return em.createQuery("""
            select new com.example.caseapp.OfficerDashboardItem(
                c.id,
                c.caseNo,
                c.applicantName,
                c.status,
                function('datediff', current_date, c.submittedAt)
            )
            from CaseEntity c
            where c.assignedOfficer = :officerId
              and c.status in :statuses
            order by c.submittedAt asc
        """, OfficerDashboardItem.class)
        .setParameter("officerId", officerId)
        .setParameter("statuses", List.of(SUBMITTED, PENDING_REVIEW))
        .getResultList();
    }
}
```

Walaupun memakai Panache, tidak dosa memakai `EntityManager` langsung untuk query kompleks yang lebih jelas.

Prinsip:

```text
Panache is a convenience, not a prison.
```

---

## 21. Design Example: Regulatory Case Approval Module

### 21.1 Requirements

Misalnya module approval case:

- officer bisa approve case jika assigned,
- supervisor bisa approve high-risk case,
- case harus dalam status `PENDING_APPROVAL`,
- decision reason wajib,
- semua perubahan harus masuk audit trail,
- event `CaseApproved` harus dikirim setelah commit,
- concurrent approval harus dicegah,
- response API tidak boleh expose entity internal.

### 21.2 Jangan Begini

```java
@Path("/cases")
public class CaseResource {

    @POST
    @Path("/{id}/approve")
    @Transactional
    public Response approve(@PathParam("id") Long id, ApproveRequest request) {
        CaseEntity caze = CaseEntity.findById(id);
        caze.status = CaseStatus.APPROVED;
        caze.reason = request.reason();
        return Response.noContent().build();
    }
}
```

Yang hilang:

- status transition validation,
- actor authorization,
- high-risk policy,
- audit trail,
- outbox,
- optimistic lock handling,
- null case handling,
- reason validation,
- domain error mapping.

### 21.3 Repository-Based Design

```java
@Entity
public class CaseEntity {

    @Id
    @GeneratedValue
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    private String assignedOfficer;
    private boolean highRisk;
    private String decisionReason;
    private Instant approvedAt;
    private String approvedBy;

    protected CaseEntity() {}

    public void approve(Actor actor, String reason, Instant now) {
        if (status != CaseStatus.PENDING_APPROVAL) {
            throw new InvalidCaseTransitionException(status, CaseStatus.APPROVED);
        }
        if (reason == null || reason.isBlank()) {
            throw new MissingDecisionReasonException();
        }
        this.status = CaseStatus.APPROVED;
        this.decisionReason = reason;
        this.approvedAt = now;
        this.approvedBy = actor.id();
    }

    public boolean isAssignedTo(Actor actor) {
        return Objects.equals(assignedOfficer, actor.id());
    }

    public boolean isHighRisk() {
        return highRisk;
    }
}
```

```java
@ApplicationScoped
public class CaseRepository implements PanacheRepository<CaseEntity> {

    public Optional<CaseEntity> findForApproval(Long id) {
        return find("id", id)
            .withLock(LockModeType.OPTIMISTIC)
            .firstResultOptional();
    }
}
```

```java
@ApplicationScoped
public class CaseApprovalPolicy {

    public void assertCanApprove(Actor actor, CaseEntity caze) {
        if (caze.isHighRisk() && !actor.hasRole("SUPERVISOR")) {
            throw new CaseApprovalForbiddenException("high risk case requires supervisor");
        }
        if (!caze.isHighRisk() && !caze.isAssignedTo(actor)) {
            throw new CaseApprovalForbiddenException("case is not assigned to actor");
        }
    }
}
```

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    @Inject
    CaseRepository cases;

    @Inject
    CaseApprovalPolicy policy;

    @Inject
    AuditTrailRepository audits;

    @Inject
    OutboxRepository outbox;

    @Inject
    Clock clock;

    @Transactional
    public void handle(ApproveCaseCommand command) {
        CaseEntity caze = cases.findForApproval(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

        policy.assertCanApprove(command.actor(), caze);

        caze.approve(command.actor(), command.reason(), clock.instant());

        audits.persist(AuditTrailEntity.caseApproved(caze, command.actor(), command.reason()));
        outbox.persist(OutboxEventEntity.caseApproved(caze));
    }
}
```

Ini sudah jauh lebih defensible.

### 21.4 Domain-Centric Version

Jika logic semakin kompleks, buat aggregate/store.

```java
public final class CaseForApproval {
    private final CaseId id;
    private CaseStatus status;
    private final OfficerId assignedOfficer;
    private final boolean highRisk;
    private final List<DomainEvent> events = new ArrayList<>();

    public ApprovalDecision approve(Actor actor, String reason, Instant now) {
        assertPendingApproval();
        assertReason(reason);

        this.status = CaseStatus.APPROVED;

        ApprovalDecision decision = new ApprovalDecision(id, actor.id(), reason, now);
        events.add(new CaseApprovedEvent(id, actor.id(), now));
        return decision;
    }
}
```

```java
public interface CaseApprovalStore {
    Optional<CaseForApproval> load(CaseId id);
    void save(CaseForApproval caze, ApprovalDecision decision);
}
```

Panache tetap dipakai pada implementation, bukan diekspos ke use case.

---

## 22. Native Image Implications

Panache dirancang agar cocok dengan Quarkus build-time model. Namun tetap perhatikan:

1. Hindari reflection-heavy mapping custom.
2. Pastikan DTO projection constructor jelas.
3. Hindari dynamic class loading.
4. Jangan bergantung pada runtime scanning.
5. Third-party repository helper harus native-compatible.
6. Entity dan repository harus terindeks dengan benar jika berada di module/JAR lain.
7. Hindari magic generic reflection di abstraction layer.

Native image menyukai:

```text
explicit types
build-time known classes
constructor projection yang jelas
CDI beans yang discoverable
minimal reflection
```

---

## 23. Migration Strategy: Dari JPA Repository Manual ke Panache

### 23.1 Jangan Big Bang

Jika punya repository manual:

```java
@ApplicationScoped
public class CaseRepository {
    @Inject EntityManager em;
}
```

Jangan langsung ubah semua entity menjadi Active Record.

Lebih aman:

1. Tambahkan Panache repository pada module baru.
2. Migrasi query sederhana dulu.
3. Pastikan test coverage query.
4. Jangan ubah API contract.
5. Jangan ubah transaction boundary bersamaan dengan query migration.
6. Jangan ubah domain logic saat migration persistence style.

### 23.2 Prioritas Migrasi

Urutan aman:

```text
1. Lookup/simple CRUD repository
2. Admin module
3. Read-only query repository
4. Low-risk command repository
5. Complex workflow repository terakhir
```

### 23.3 Hindari Migrasi ke Active Record untuk Domain Kompleks

Untuk complex domain, gunakan Panache Repository agar entity tidak harus extend Panache base class.

---

## 24. Practical Heuristics

### 24.1 Pilih Active Record Jika

Gunakan Active Record jika mayoritas benar:

- Entity sederhana.
- Tidak ada state machine kompleks.
- Tidak ada multi-tenant strict visibility.
- Tidak ada audit-heavy transition.
- Query sedikit dan natural di entity.
- Tidak keberatan static persistence methods.
- Testing lebih banyak integration test.
- Team disiplin tidak menaruh query di sembarang layer.

### 24.2 Pilih Repository Jika

Gunakan Repository jika mayoritas benar:

- Ada service/use case layer.
- Query ownership penting.
- Entity ingin tetap encapsulated.
- ID custom.
- Testing dengan CDI mock penting.
- Domain sedang/kompleks.
- Ada soft delete/tenant filter.
- Ada authorization rule yang tidak boleh dibypass.
- Ada kemungkinan future migration.

### 24.3 Pilih Domain-Centric Jika

Gunakan domain-centric persistence jika mayoritas benar:

- Ada state machine.
- Ada cross-entity invariant.
- Ada audit/legal/regulatory requirement.
- Ada event/outbox yang harus atomic.
- Ada complex authorization/resource ownership.
- Ada concurrency conflict.
- Ada long-lived business process.
- Ada reporting/read model terpisah.
- Ada data retention/archival impact.
- Ada kebutuhan review desain oleh stakeholder non-developer.

---

## 25. Production Checklist

Sebelum memilih style Panache, jawab pertanyaan ini.

### 25.1 Domain Complexity

- Apakah entity hanya CRUD?
- Apakah ada state transition?
- Apakah transition punya precondition?
- Apakah ada role/permission berbasis state?
- Apakah ada audit wajib?
- Apakah ada event yang harus keluar setelah perubahan?
- Apakah ada concurrency risk?

### 25.2 Query Governance

- Siapa owner query?
- Apakah query boleh dipanggil dari banyak layer?
- Apakah ada tenant/soft delete/visibility rule?
- Apakah `findById` generic aman?
- Apakah list endpoint selalu paginated?
- Apakah projection dipakai untuk read-heavy endpoint?

### 25.3 Transaction and Consistency

- Di mana transaction boundary?
- Apakah boundary mengikuti use case?
- Apakah external call terjadi dalam transaction?
- Apakah outbox diperlukan?
- Apakah audit dalam transaction yang sama?
- Apakah bulk update butuh audit?

### 25.4 Testing

- Query dites dengan database nyata?
- Use case bisa dites tanpa database?
- Active Record static calls perlu mocking?
- Repository CDI bean mudah dimock?
- Transaction behavior dites?
- Locking behavior dites?

### 25.5 Native and Build-Time

- Apakah entity berada dalam indexed module?
- Apakah projection native-safe?
- Apakah reflection custom diperlukan?
- Apakah dependency repository helper native-compatible?

---

## 26. Top 1% Mental Model

Engineer biasa bertanya:

> “Panache Active Record atau Repository lebih bagus?”

Engineer kuat bertanya:

> “Apa boundary yang ingin saya lindungi?”

Jika boundary-nya adalah data sederhana, Active Record cukup.

Jika boundary-nya adalah query ownership dan testability, Repository lebih baik.

Jika boundary-nya adalah invariant, workflow, audit, authorization, dan consistency, maka domain-centric persistence lebih tepat.

Panache bukan pengganti arsitektur. Panache adalah alat untuk mengurangi boilerplate setelah boundary arsitektur jelas.

---

## 27. Latihan

### Latihan 1 — Classify Persistence Style

Untuk setiap entity berikut, tentukan Active Record, Repository, atau Domain-Centric:

1. `Country`
2. `CurrencyRate`
3. `UserSession`
4. `ApplicationCase`
5. `CaseDecision`
6. `AuditTrail`
7. `NotificationTemplate`
8. `PaymentTransaction`
9. `ScreeningResult`
10. `EscalationRule`

Jelaskan alasannya berdasarkan:

- complexity,
- audit,
- concurrency,
- query ownership,
- state transition,
- testing.

### Latihan 2 — Refactor Active Record ke Repository

Dari kode:

```java
@Entity
public class CaseEntity extends PanacheEntity {
    public CaseStatus status;
    public String assignedOfficer;

    public static List<CaseEntity> findPending(String officer) {
        return list("status = ?1 and assignedOfficer = ?2", PENDING, officer);
    }
}
```

Refactor menjadi:

- entity tanpa Panache base,
- repository dengan method jelas,
- use case service,
- DTO response.

### Latihan 3 — Design Audit-Safe Approval

Buat desain approval use case dengan:

- optimistic locking,
- permission policy,
- status transition,
- decision reason,
- audit trail,
- outbox event,
- no external call inside transaction.

### Latihan 4 — Query Review

Review query ini:

```java
CaseEntity.find("status in ?1", statuses).list();
```

Apa risikonya jika dipakai di production endpoint?

Bahas:

- unbounded result,
- tenant filter,
- soft delete,
- sorting,
- pagination,
- projection,
- index.

---

## 28. Ringkasan Invariants

Ingat invariants berikut:

1. Panache mengurangi boilerplate, bukan menggantikan desain domain.
2. Active Record cocok untuk data sederhana dan query sederhana.
3. Repository cocok ketika query ownership, testability, dan boundary mulai penting.
4. Domain-centric persistence cocok ketika invariant lebih penting daripada table operation.
5. Entity boleh punya behavior, tetapi jangan punya infrastructure side effect.
6. Resource layer jangan menjadi transaction script.
7. API DTO jangan disamakan dengan entity.
8. Query penting harus punya nama domain, bukan hanya string predicate.
9. Generic `findById` berbahaya untuk multi-tenant/visibility-sensitive system.
10. Audit/outbox harus dipikirkan sebagai bagian dari consistency boundary.
11. Bulk update cepat tetapi bisa bypass lifecycle, audit, dan invariant.
12. Projection adalah default sehat untuk read-heavy endpoint.
13. Native image menyukai explicit, build-time-known persistence model.
14. Style persistence harus mengikuti boundary yang ingin dilindungi.

---

## 29. Referensi

- Quarkus Official Guide — Simplified Hibernate ORM with Panache: https://quarkus.io/guides/hibernate-orm-panache
- Quarkus Official Guide — Simplified Hibernate Reactive with Panache: https://quarkus.io/guides/hibernate-reactive-panache
- Quarkus Official Guide — Testing Your Application: https://quarkus.io/guides/getting-started-testing
- Quarkus Official Guide — Testing Components: https://quarkus.io/guides/testing-components
- Quarkus Blog — Mocking CDI Beans in Quarkus: https://quarkus.io/blog/mocking/
- Quarkus Official Guide — Hibernate ORM: https://quarkus.io/guides/hibernate-orm
- Quarkus Official Guide — Datasources: https://quarkus.io/guides/datasource

---

## 30. Status Seri

Part 011 selesai.

Seri belum selesai dan belum mencapai bagian terakhir.

Part berikutnya:

**Part 012 — Persistence III: Hibernate Reactive, Reactive SQL Clients, dan Transaction Semantics**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-010.md">⬅️ Part 010 — Persistence I: Hibernate ORM di Quarkus Tanpa Mengulang JPA Dasar</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-012.md">Part 012 — Persistence III: Hibernate Reactive, Reactive SQL Clients, dan Transaction Semantics ➡️</a>
</div>
