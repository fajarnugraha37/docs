# Part 30 — Architecture Pattern: Layered, Hexagonal, Clean, Modular Monolith

```text
Series  : learn-java-design-patterns-antipatterns-architecture-engineering
File    : 30-architecture-layered-hexagonal-clean-modular-monolith.md
Scope   : Java 8–25, enterprise backend, modular monolith, layered architecture, hexagonal architecture, clean architecture, ports and adapters
Status  : Part 30 of 35
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bukan hanya bisa menyebut “layered”, “hexagonal”, “clean architecture”, atau “modular monolith”, tetapi mampu menjawab pertanyaan yang lebih senior:

1. Boundary apa yang sebenarnya sedang dilindungi?
2. Dependency mana yang boleh mengarah ke mana?
3. Kapan layer membantu, kapan layer hanya menjadi ritual folder?
4. Kapan port/adapter membuat sistem lebih fleksibel, kapan hanya ceremony?
5. Bagaimana mencegah domain tergantung pada framework, ORM, HTTP, messaging, atau database schema?
6. Bagaimana mendesain modular monolith yang benar-benar modular, bukan monolith dengan package banyak?
7. Bagaimana menilai apakah codebase sudah modular dari compile-time dependency, transaction boundary, ownership, dan failure isolation?
8. Bagaimana memilih antara layered architecture, hexagonal architecture, clean architecture, dan modular monolith berdasarkan force nyata, bukan tren?
9. Bagaimana refactor legacy layered Java application secara bertahap tanpa big-bang rewrite?
10. Bagaimana pattern architecture ini berhubungan dengan design pattern sebelumnya: Repository, Gateway, Adapter, DTO, Mapper, Command Handler, Domain Service, Policy, State Machine, Event, dan Outbox?

Inti bagian ini:

```text
Architecture pattern bukan bentuk folder.
Architecture pattern adalah aturan dependency, ownership, boundary, dan change isolation.
```

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Di banyak sistem Java enterprise, struktur awal biasanya terlihat seperti ini:

```text
com.company.app
├── controller
├── service
├── repository
├── entity
├── dto
├── util
└── config
```

Sekilas terlihat rapi. Ada controller, service, repository. Tetapi setelah sistem tumbuh, sering muncul masalah:

1. Service module A langsung memanggil repository module B.
2. Entity JPA keluar sampai response API.
3. Controller berisi business rule.
4. Repository berisi authorization logic.
5. DTO dipakai sebagai command, response, event, dan persistence projection sekaligus.
6. Domain object punya annotation framework di mana-mana.
7. Semua module bisa import semua module.
8. Utility class menjadi dumping ground.
9. Transaction boundary tidak jelas.
10. Event publishing dilakukan di tengah transaksi tanpa outbox.
11. External API client dipanggil langsung dari domain service.
12. Circular dependency antar package dianggap normal.
13. Test harus boot seluruh Spring context untuk logic sederhana.
14. Perubahan kecil pada satu module memicu regression di banyak module.
15. Deployment memang satu aplikasi, tetapi secara mental tim sudah tidak tahu ownership tiap fitur.

Masalahnya bukan karena layered architecture salah. Masalahnya adalah layer hanya dijadikan **folder convention**, bukan **dependency rule**.

Architecture pattern diperlukan untuk menjawab:

```text
Apa yang boleh tahu apa?
Apa yang boleh memanggil apa?
Apa yang boleh berubah tanpa menghancurkan yang lain?
Apa yang menjadi policy?
Apa yang menjadi detail?
Apa yang menjadi boundary?
```

---

## 3. Mental Model: Architecture sebagai Dependency Gravity

Bayangkan sistem sebagai sekumpulan keputusan:

```text
Business decision
Application use case
External interface
Persistence detail
Framework detail
Infrastructure detail
Operational concern
```

Tidak semua keputusan punya bobot yang sama.

Business decision biasanya lebih stabil dan lebih bernilai. Framework detail lebih mudah diganti, tetapi sering lebih invasive. Database schema bisa stabil dalam jangka panjang, tetapi secara konseptual tetap detail persistence. HTTP controller adalah entrypoint, bukan pemilik rule.

Architecture yang sehat menjaga agar dependency mengarah dari detail ke policy, bukan sebaliknya.

```text
Bad gravity:
Domain -> Spring
Domain -> JPA
Domain -> HTTP DTO
Domain -> Kafka record
Domain -> Oracle-specific query
Domain -> Redis client
Domain -> external vendor SDK

Better gravity:
Spring adapter -> application port -> domain
JPA adapter   -> repository port/application need
HTTP adapter  -> command/query model -> application service
Kafka adapter -> application event handler
Vendor SDK    -> gateway adapter -> internal model
```

Architecture bukan berarti domain tidak pernah tahu persistence ada. Pada sistem nyata, aplikasi butuh menyimpan state. Tetapi domain tidak harus tahu **cara teknis** state disimpan.

### 3.1 Policy vs Detail

Policy adalah keputusan yang seharusnya tetap benar walaupun detail teknis berubah.

Contoh policy:

```text
Case cannot be approved if required documents are incomplete.
Appeal can only be submitted within allowed window.
Officer cannot approve own submitted case.
Sanction severity depends on violation class and history.
```

Detail:

```text
HTTP endpoint path
JSON field naming
JPA annotation
SQL query
Kafka topic name
Redis key format
AWS S3 bucket
Spring bean scope
```

Top engineer akan bertanya:

```text
Apakah policy saya sedang bergantung pada detail?
Apakah detail teknis saya sedang menyelinap ke rule bisnis?
```

---

## 4. Architecture Pattern yang Dibahas

Bagian ini membahas empat pola utama:

1. Layered Architecture
2. Hexagonal Architecture / Ports and Adapters
3. Clean Architecture / Dependency Rule
4. Modular Monolith

Keempatnya tidak harus dianggap saling eksklusif.

Sistem Java enterprise yang sehat sering menggabungkan semuanya:

```text
Modular monolith sebagai deployment/runtime shape.
Hexagonal architecture sebagai boundary style per module.
Layered architecture sebagai internal vertical organization.
Clean architecture sebagai dependency direction principle.
```

Dengan kata lain:

```text
Modular monolith menjawab: bagaimana membagi sistem besar menjadi module.
Hexagonal menjawab: bagaimana module berinteraksi dengan dunia luar.
Layered menjawab: bagaimana code dalam module disusun.
Clean architecture menjawab: dependency harus mengarah ke mana.
```

---

## 5. Layered Architecture

### 5.1 Definisi

Layered architecture membagi sistem ke dalam lapisan tanggung jawab.

Bentuk umum Java backend:

```text
Controller / API layer
Application / Service layer
Domain layer
Persistence / Infrastructure layer
```

Atau versi yang sering ditemukan:

```text
Controller
Service
Repository
Database
```

Layered architecture yang baik bukan sekadar urutan call. Ia adalah aturan bahwa layer atas hanya boleh bergantung pada layer di bawah atau pada abstraction yang disepakati.

### 5.2 Bentuk Sederhana

```text
HTTP Controller
      |
      v
Application Service
      |
      v
Domain Model / Domain Service
      |
      v
Repository
      |
      v
Database
```

Tetapi bentuk ini sering menipu. Kalau domain langsung import repository teknis, JPA entity, dan Spring annotation, dependency gravity sudah bocor.

### 5.3 Tanggung Jawab Tiap Layer

#### API / Presentation Layer

Bertanggung jawab untuk:

1. Menerima input transport-specific.
2. Parsing request.
3. Authentication token extraction.
4. Basic request validation.
5. Mapping request ke command/query.
6. Mapping result/error ke response.
7. HTTP status semantics.
8. Tidak mengambil business decision inti.

Tidak seharusnya:

1. Memutuskan eligibility bisnis.
2. Mengakses repository langsung.
3. Mengubah entity langsung.
4. Membuka transaksi bisnis panjang.
5. Menulis audit domain secara manual tanpa application boundary.

#### Application Layer

Bertanggung jawab untuk:

1. Menjalankan use case.
2. Mengatur transaction boundary.
3. Orchestrate domain object, domain service, repository, gateway.
4. Authorization use-case level.
5. Idempotency use-case level.
6. Publish domain/integration event secara aman.
7. Return result yang jelas.

Tidak seharusnya:

1. Berisi seluruh rule bisnis detail.
2. Menjadi god service.
3. Berisi SQL teknis.
4. Berisi HTTP response details.
5. Bergantung pada controller.

#### Domain Layer

Bertanggung jawab untuk:

1. Business invariant.
2. State transition.
3. Policy.
4. Specification.
5. Value object.
6. Domain service murni.
7. Rule object.
8. Domain event.

Tidak seharusnya:

1. Tahu HTTP.
2. Tahu JSON.
3. Tahu Kafka topic.
4. Tahu Redis key.
5. Tahu Spring MVC.
6. Tahu database schema teknis.
7. Bergantung pada framework runtime.

#### Infrastructure Layer

Bertanggung jawab untuk:

1. Database access.
2. External API client.
3. Messaging.
4. File storage.
5. Cache.
6. Framework integration.
7. Technical implementation of ports.

Tidak seharusnya:

1. Mengambil business decision inti.
2. Menjadi tempat rule domain.
3. Menjadi dependency yang mengontrol domain.

### 5.4 Layered Architecture yang Naif

Contoh buruk:

```java
@RestController
@RequestMapping("/cases")
class CaseController {
    private final CaseRepository caseRepository;

    @PostMapping("/{id}/approve")
    public ResponseEntity<?> approve(@PathVariable Long id) {
        CaseEntity entity = caseRepository.findById(id).orElseThrow();

        if (!"SUBMITTED".equals(entity.getStatus())) {
            return ResponseEntity.badRequest().body("Invalid status");
        }

        if (!entity.isDocumentsComplete()) {
            return ResponseEntity.badRequest().body("Documents incomplete");
        }

        entity.setStatus("APPROVED");
        caseRepository.save(entity);

        return ResponseEntity.ok().build();
    }
}
```

Masalah:

1. Controller memegang rule bisnis.
2. Status stringly typed.
3. Entity persistence menjadi domain model langsung.
4. Error tidak punya taxonomy.
5. Tidak ada authorization boundary.
6. Tidak ada audit boundary.
7. Tidak ada event boundary.
8. Sulit dites tanpa web/persistence concern.

### 5.5 Layered Architecture yang Lebih Sehat

```java
@RestController
@RequestMapping("/cases")
final class CaseApprovalController {
    private final ApproveCaseUseCase approveCaseUseCase;

    CaseApprovalController(ApproveCaseUseCase approveCaseUseCase) {
        this.approveCaseUseCase = approveCaseUseCase;
    }

    @PostMapping("/{caseId}/approve")
    ResponseEntity<ApproveCaseResponse> approve(
            @PathVariable String caseId,
            @RequestBody ApproveCaseHttpRequest request,
            Authentication authentication
    ) {
        ApproveCaseCommand command = new ApproveCaseCommand(
                new CaseId(caseId),
                new OfficerId(authentication.getName()),
                request.comment(),
                request.idempotencyKey()
        );

        ApproveCaseResult result = approveCaseUseCase.approve(command);

        return switch (result) {
            case ApproveCaseResult.Approved approved ->
                    ResponseEntity.ok(new ApproveCaseResponse(approved.caseId().value(), "APPROVED"));
            case ApproveCaseResult.Rejected rejected ->
                    ResponseEntity.badRequest().body(new ApproveCaseResponse(rejected.caseId().value(), "REJECTED"));
        };
    }
}
```

Application service:

```java
final class ApproveCaseUseCase {
    private final CaseRepository caseRepository;
    private final ApprovalPolicy approvalPolicy;
    private final AuditPort auditPort;
    private final DomainEventPublisher eventPublisher;

    ApproveCaseUseCase(
            CaseRepository caseRepository,
            ApprovalPolicy approvalPolicy,
            AuditPort auditPort,
            DomainEventPublisher eventPublisher
    ) {
        this.caseRepository = caseRepository;
        this.approvalPolicy = approvalPolicy;
        this.auditPort = auditPort;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    ApproveCaseResult approve(ApproveCaseCommand command) {
        RegulatoryCase regulatoryCase = caseRepository.get(command.caseId());

        ApprovalDecision decision = approvalPolicy.evaluate(
                regulatoryCase,
                command.officerId()
        );

        if (decision.isRejected()) {
            auditPort.record(AuditEvent.caseApprovalRejected(command.caseId(), decision.reasons()));
            return ApproveCaseResult.rejected(command.caseId(), decision.reasons());
        }

        regulatoryCase.approve(command.officerId(), command.comment());
        caseRepository.save(regulatoryCase);

        eventPublisher.publish(regulatoryCase.pullDomainEvents());
        auditPort.record(AuditEvent.caseApproved(command.caseId(), command.officerId()));

        return ApproveCaseResult.approved(command.caseId());
    }
}
```

Domain model:

```java
final class RegulatoryCase {
    private final CaseId id;
    private CaseStatus status;
    private DocumentCompletion documentCompletion;
    private final List<DomainEvent> events = new ArrayList<>();

    void approve(OfficerId officerId, String comment) {
        if (status != CaseStatus.SUBMITTED) {
            throw new IllegalCaseTransitionException(id, status, CaseStatus.APPROVED);
        }

        if (!documentCompletion.isComplete()) {
            throw new DomainRuleViolation("Required documents are incomplete");
        }

        this.status = CaseStatus.APPROVED;
        this.events.add(new CaseApproved(id, officerId));
    }

    List<DomainEvent> pullDomainEvents() {
        List<DomainEvent> copy = List.copyOf(events);
        events.clear();
        return copy;
    }
}
```

Perbedaannya bukan hanya lebih banyak class. Perbedaannya adalah **responsibility pindah ke tempat yang benar**.

---

## 6. Kekuatan Layered Architecture

Layered architecture masih sangat berguna jika:

1. Aplikasi CRUD/use-case oriented.
2. Tim besar butuh convention sederhana.
3. Domain tidak terlalu kompleks.
4. Flow request-response dominan.
5. Framework seperti Spring/Jakarta EE dipakai kuat.
6. Runtime deployment masih satu aplikasi.
7. Perubahan teknis lebih sering terjadi di interface/persistence daripada business rule.

Keunggulan:

```text
Mudah dipahami.
Mudah onboarding.
Cocok dengan framework mainstream.
Batas tanggung jawab cukup jelas.
Testing bisa disusun per layer.
Tidak terlalu banyak ceremony.
```

Tetapi layered architecture bisa menjadi buruk kalau setiap request hanya menjadi:

```text
Controller -> Service -> Repository -> Entity -> Database
```

Tanpa domain model, tanpa policy, tanpa boundary abstraction, tanpa invariant.

Itu bukan architecture. Itu call stack convention.

---

## 7. Anti-Pattern dalam Layered Architecture

### 7.1 Layer Bypass

Controller langsung memanggil repository.

```java
@RestController
class CaseController {
    private final CaseJpaRepository repository;
}
```

Dampak:

1. Use case tidak punya boundary.
2. Authorization bisa terlewat.
3. Audit bisa inkonsisten.
4. Transaction behavior tersebar.
5. Testing logic menjadi berat.

### 7.2 Service as God Object

```java
class CaseService {
    void approve() {}
    void reject() {}
    void appeal() {}
    void assignOfficer() {}
    void sendEmail() {}
    void syncExternalSystem() {}
    void calculatePenalty() {}
    void generatePdf() {}
    void uploadDocument() {}
}
```

Masalah bukan jumlah method saja. Masalahnya adalah terlalu banyak alasan perubahan.

### 7.3 Repository as Business Engine

```java
interface CaseRepository {
    List<CaseEntity> findCasesVisibleToOfficerAndEligibleForApprovalAndNotExpired(...);
}
```

Sebagian filtering memang boleh di query untuk performance. Tetapi kalau repository menjadi pemilik rule eligibility, domain kehilangan explicitness.

### 7.4 Entity Leakage

```java
@GetMapping("/{id}")
CaseEntity get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

1. API contract terikat persistence schema.
2. Lazy loading bisa bocor.
3. Field sensitif bisa terekspos.
4. Perubahan DB menjadi breaking API.
5. Serialization cycle risk.

### 7.5 Utility Dumping Ground

```text
common/CaseUtils.java
common/DateUtils.java
common/ValidationUtils.java
common/MappingUtils.java
```

Utility sering menjadi tanda bahwa responsibility belum ditemukan.

Pertanyaan refactoring:

```text
Method ini sebenarnya behavior milik object apa?
Data apa yang paling sering disentuh?
Rule ini berubah bersama konsep domain apa?
```

---

## 8. Hexagonal Architecture / Ports and Adapters

### 8.1 Definisi

Hexagonal architecture memandang aplikasi sebagai core yang berinteraksi dengan dunia luar melalui port dan adapter.

```text
                 HTTP Adapter
                      |
                      v
External API ->  Application Core  <- Database Adapter
Adapter              ^   ^
                     |   |
              Messaging  File Storage
               Adapter   Adapter
```

Core tidak bergantung pada detail dunia luar. Dunia luar masuk/keluar melalui port.

Port adalah kontrak yang dibutuhkan atau disediakan core.
Adapter adalah implementasi teknis port.

### 8.2 Driving Adapter dan Driven Adapter

Driving adapter memanggil aplikasi.

Contoh:

```text
HTTP controller
Kafka consumer
CLI command
Batch scheduler
Test harness
```

Driven adapter dipanggil oleh aplikasi.

Contoh:

```text
Database repository adapter
External REST client adapter
Email sender adapter
S3 storage adapter
Kafka publisher adapter
```

### 8.3 Port yang Salah Kaprah

Banyak developer membuat port sebagai duplikasi nama teknis:

```java
interface CaseJpaPort {
    CaseEntity findById(Long id);
}
```

Ini bukan port yang baik. Itu hanya JPA dibungkus interface.

Port yang baik merepresentasikan kebutuhan application core:

```java
interface CaseRepository {
    RegulatoryCase get(CaseId id);
    void save(RegulatoryCase regulatoryCase);
}

interface DocumentStorage {
    StoredDocument store(DocumentToStore document);
    DownloadedDocument get(DocumentId id);
}

interface AddressValidationGateway {
    AddressValidationResult validate(Postcode postcode);
}
```

Port berbicara dalam bahasa internal, bukan bahasa teknologi.

### 8.4 Struktur Package Hexagonal per Module

Contoh module `case-management`:

```text
case-management
├── application
│   ├── port
│   │   ├── in
│   │   │   ├── ApproveCaseUseCase.java
│   │   │   └── SubmitCaseUseCase.java
│   │   └── out
│   │       ├── CaseRepository.java
│   │       ├── AuditPort.java
│   │       └── CaseEventPublisher.java
│   ├── command
│   ├── query
│   └── service
├── domain
│   ├── model
│   ├── policy
│   ├── event
│   └── exception
└── adapter
    ├── in
    │   ├── web
    │   ├── messaging
    │   └── batch
    └── out
        ├── persistence
        ├── external
        ├── messaging
        └── audit
```

Dependency ideal:

```text
adapter.in      -> application
adapter.out     -> application/domain
application     -> domain
application     -> application.port.out
application     -> application.port.in
application     -X-> adapter
application     -X-> Spring MVC
application     -X-> JPA implementation
application     -X-> Kafka client
```

### 8.5 Contoh Port dan Adapter

Port:

```java
public interface AddressValidationGateway {
    AddressValidationResult validate(AddressToValidate address);
}
```

Application service:

```java
final class SubmitApplicationUseCase {
    private final AddressValidationGateway addressValidationGateway;
    private final ApplicationRepository applicationRepository;

    SubmitApplicationUseCase(
            AddressValidationGateway addressValidationGateway,
            ApplicationRepository applicationRepository
    ) {
        this.addressValidationGateway = addressValidationGateway;
        this.applicationRepository = applicationRepository;
    }

    SubmitApplicationResult submit(SubmitApplicationCommand command) {
        AddressValidationResult addressResult = addressValidationGateway.validate(command.address());

        if (!addressResult.isValid()) {
            return SubmitApplicationResult.rejected(addressResult.reasons());
        }

        Application application = Application.submit(command.applicant(), command.address());
        applicationRepository.save(application);
        return SubmitApplicationResult.accepted(application.id());
    }
}
```

Adapter:

```java
@Component
final class OneMapAddressValidationAdapter implements AddressValidationGateway {
    private final OneMapClient client;
    private final OneMapResponseMapper mapper;

    OneMapAddressValidationAdapter(OneMapClient client, OneMapResponseMapper mapper) {
        this.client = client;
        this.mapper = mapper;
    }

    @Override
    public AddressValidationResult validate(AddressToValidate address) {
        OneMapResponse response = client.search(address.postcode().value());
        return mapper.toAddressValidationResult(response);
    }
}
```

Notice:

```text
Application core does not know OneMap.
Application core knows only AddressValidationGateway.
Adapter knows OneMap and internal result.
Mapper translates semantics.
```

### 8.6 Keunggulan Hexagonal

Hexagonal architecture membantu ketika:

1. Banyak external systems.
2. Banyak entrypoint: REST, batch, messaging, scheduler.
3. Domain logic penting dan harus testable tanpa framework.
4. Integrasi eksternal berubah-ubah.
5. Perlu memisahkan technical model dari domain model.
6. Regulatory/financial/enterprise defensibility penting.
7. Testing core harus cepat dan deterministik.
8. Tim ingin bisa mengganti adapter tanpa mengubah application core.

### 8.7 Risiko Hexagonal

Hexagonal bisa menjadi overengineering kalau:

1. Semua CRUD sederhana dipaksa punya port/adapter ceremony.
2. Interface dibuat untuk setiap class tanpa volatility nyata.
3. Port dinamai berdasarkan teknologi, bukan capability.
4. Domain terlalu tipis sehingga architecture hanya wrapper berlapis.
5. Team tidak disiplin dependency rule.
6. Adapter hanya pass-through tanpa translation.

Anti-pattern:

```text
Fake port:
interface UserRepositoryPort { UserEntity save(UserEntity entity); }

Fake adapter:
class UserRepositoryAdapter implements UserRepositoryPort {
    return jpaRepository.save(entity);
}

Core still speaks JPA entity.
No semantic protection happened.
```

---

## 9. Clean Architecture

### 9.1 Definisi

Clean Architecture menekankan dependency rule:

```text
Source code dependencies must point inward.
```

Bentuk konseptual:

```text
Frameworks & Drivers
        |
Interface Adapters
        |
Application Use Cases
        |
Enterprise Business Rules / Domain
```

Semakin dalam, semakin stabil dan semakin murni policy.

Semakin luar, semakin teknis dan mudah berubah.

### 9.2 Dependency Rule dalam Java

Domain tidak import application.
Application import domain.
Adapter import application/domain.
Framework configuration wire semuanya.

```text
domain        -> no framework
application   -> domain + ports
adapter       -> application + domain + frameworks
bootstrap     -> everything for wiring
```

### 9.3 Contoh Package Clean Architecture

```text
com.company.caseapproval
├── domain
│   ├── Case.java
│   ├── CaseStatus.java
│   ├── ApprovalPolicy.java
│   └── CaseApproved.java
├── application
│   ├── ApproveCaseUseCase.java
│   ├── ApproveCaseCommand.java
│   ├── ApproveCaseResult.java
│   └── port
│       ├── CaseRepository.java
│       └── EventPublisher.java
├── adapter
│   ├── web
│   │   └── CaseApprovalController.java
│   ├── persistence
│   │   ├── JpaCaseRepositoryAdapter.java
│   │   ├── CaseEntity.java
│   │   └── SpringDataCaseJpaRepository.java
│   └── messaging
│       └── KafkaCaseEventPublisher.java
└── bootstrap
    └── CaseApprovalConfiguration.java
```

### 9.4 Dependency Rule yang Bisa Dicek

Dengan Java, dependency rule bisa dijaga menggunakan:

1. Package-private visibility.
2. JPMS module boundaries.
3. Build modules Maven/Gradle.
4. ArchUnit tests.
5. Checkstyle/Error Prone/custom static analysis.
6. Code review rule.

Contoh ArchUnit-style rule konseptual:

```java
@AnalyzeClasses(packages = "com.company")
class ArchitectureRulesTest {

    @Test
    void domain_should_not_depend_on_frameworks() {
        noClasses()
                .that().resideInAPackage("..domain..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "org.springframework..",
                        "jakarta.persistence..",
                        "com.fasterxml.jackson.."
                );
    }

    @Test
    void application_should_not_depend_on_adapters() {
        noClasses()
                .that().resideInAPackage("..application..")
                .should().dependOnClassesThat().resideInAPackage("..adapter..");
    }
}
```

### 9.5 Clean Architecture yang Salah Kaprah

Clean Architecture sering disalahgunakan menjadi folder ceremony:

```text
entities/
usecases/
adapters/
frameworks/
```

Tetapi dependency tetap bocor:

```java
class ApproveCaseUseCase {
    private final CaseJpaRepository repository;
    private final RestTemplate restTemplate;
    private final HttpServletRequest request;
}
```

Nama folder tidak membantu kalau dependency rule dilanggar.

Clean Architecture bukan berarti:

```text
Semua class harus punya interface.
Semua DTO harus dipetakan 5 kali.
Tidak boleh pakai framework.
Tidak boleh pakai JPA.
Tidak boleh pragmatis.
```

Clean Architecture berarti:

```text
Policy tidak boleh dikendalikan oleh detail.
```

---

## 10. Modular Monolith

### 10.1 Definisi

Modular monolith adalah satu deployable application yang dibagi menjadi module internal dengan boundary jelas.

```text
One runtime.
One deployment unit.
Multiple well-bounded modules.
Explicit internal contracts.
Controlled dependencies.
Often one database, but with disciplined ownership.
```

Ini berbeda dari monolith biasa.

Monolith biasa:

```text
Semua bisa panggil semua.
Semua bisa akses tabel semua.
Semua service saling import.
Boundary hanya nama package.
```

Modular monolith:

```text
Module punya public API internal.
Internal implementation hidden.
Cross-module access controlled.
Database ownership jelas.
Event/internal contract jelas.
Dependency direction dicek.
```

### 10.2 Kenapa Modular Monolith Penting

Banyak organisasi terlalu cepat pindah ke microservices padahal boundary domain belum matang.

Microservices menambah:

1. Network failure.
2. Distributed transaction problem.
3. Operational overhead.
4. Observability complexity.
5. Deployment choreography.
6. Version compatibility problem.
7. Data ownership conflict.
8. Latency and retry complexity.

Modular monolith memberi kesempatan membangun modularity dulu sebelum distribusi.

```text
Do not distribute what you cannot modularize.
```

### 10.3 Struktur Modular Monolith

Contoh enterprise system:

```text
com.company.regulatory
├── case_management
├── application_management
├── appeal
├── compliance
├── correspondence
├── document
├── payment
├── user_access
├── notification
└── shared_kernel
```

Setiap module bisa punya internal hexagonal structure:

```text
case_management
├── api
│   ├── CaseManagementFacade.java
│   └── CaseSummaryView.java
├── application
├── domain
├── adapter
└── internal
```

Cross-module access idealnya melalui public module API:

```java
public interface CaseManagementFacade {
    CaseSummary getCaseSummary(CaseId caseId);
    void assignCase(AssignCaseRequest request);
}
```

Module lain tidak boleh import internal class:

```text
appeal -> case_management.api        allowed
appeal -> case_management.domain     maybe disallowed
appeal -> case_management.adapter    disallowed
appeal -> case_management.persistence disallowed
```

### 10.4 Module API vs Java Public Class

Dalam Java, `public` berarti public secara bahasa, bukan public secara arsitektur.

Modular monolith butuh membedakan:

```text
Public to JVM
Public to module consumers
Internal to module
```

Cara menjaga:

1. Package naming convention.
2. `internal` package convention.
3. Package-private class.
4. JPMS `exports` only API package.
5. Separate Gradle/Maven modules.
6. ArchUnit rule.
7. Explicit facade/interface.

JPMS example:

```java
module com.company.case.management {
    exports com.company.case_management.api;

    requires com.company.shared.kernel;

    // domain/internal packages not exported
}
```

Ini membuat package non-exported tidak bisa diakses module lain secara compile-time.

### 10.5 Shared Kernel

Shared kernel adalah bagian kecil yang boleh dibagi antar module.

Contoh yang layak:

```text
Identifier base types
Money
DateRange
Clock abstraction
Result/Error primitives
Audit identity primitives
Common domain events base
```

Contoh yang berbahaya:

```text
CommonStatus
CommonEntity
CommonService
CommonRepository
GenericWorkflowEngineForEverything
UniversalDto
```

Shared kernel harus kecil dan stabil.

Jika shared kernel tumbuh besar, itu tanda boundary belum jelas.

### 10.6 Cross-Module Communication

Ada beberapa pilihan:

#### Direct Facade Call

```java
appealService.createAppeal(caseManagementFacade.getCaseSummary(caseId));
```

Cocok ketika:

1. Same process.
2. Strong consistency diperlukan.
3. Latency rendah.
4. Boundary masih internal.

Risiko:

1. Coupling synchronous.
2. Circular dependency.
3. Transaction ambiguity.

#### Internal Event

```text
CaseApproved -> AppealDeadlineStarted
```

Cocok ketika:

1. Side effect tidak harus synchronous.
2. Module lain perlu bereaksi.
3. Loose coupling lebih penting.

Risiko:

1. Event ordering.
2. Retry/idempotency.
3. Observability.
4. Hidden side effects.

#### Shared Read Model

Module membuat projection sendiri dari event/module API.

Cocok untuk query/dashboard.

Risiko:

1. Staleness.
2. Projection rebuild.
3. Ownership ambiguity.

### 10.7 Database dalam Modular Monolith

Satu database tidak otomatis buruk. Yang buruk adalah ownership tidak jelas.

Pilihan:

```text
One schema, disciplined table ownership.
Schema per module.
Database per module but same deployable.
Shared database with explicit views/contracts.
```

Rule sehat:

```text
Module A tidak menulis tabel milik Module B.
Module A tidak join sembarang tabel Module B untuk rule bisnis.
Cross-module query harus lewat facade, projection, view contract, atau reporting model.
```

Contoh ownership:

```text
case_management owns CASE, CASE_STATUS_HISTORY, CASE_ASSIGNMENT
appeal owns APPEAL, APPEAL_DECISION
document owns DOCUMENT, DOCUMENT_VERSION, DOCUMENT_ACCESS
notification owns NOTIFICATION_OUTBOX, TEMPLATE_RENDER_RESULT
```

### 10.8 Modular Monolith Anti-Pattern

#### Package-by-Name Only

```text
case/
appeal/
document/
```

Tetapi semua saling import.

#### Shared Database Free-for-All

```sql
SELECT *
FROM case c
JOIN appeal a ON a.case_id = c.id
JOIN document d ON d.case_id = c.id
JOIN payment p ON p.case_id = c.id
```

Untuk reporting mungkin boleh dengan model khusus. Untuk transactional business logic, ini sering menjadi coupling lintas module.

#### Common Module Monster

```text
common/
├── CommonService
├── CommonRepository
├── CommonValidator
├── CommonMapper
├── CommonWorkflow
└── CommonEverything
```

`common` sering menjadi tempat module boundary mati.

#### Circular Module Dependency

```text
case_management -> appeal
appeal -> case_management
case_management -> document
ocument -> case_management
```

Circular dependency membuat module tidak bisa dipahami secara terpisah.

---

## 11. Layered vs Hexagonal vs Clean vs Modular Monolith

### 11.1 Perbandingan Mental Model

| Pattern | Fokus Utama | Pertanyaan Utama |
|---|---|---|
| Layered | Separation by responsibility | Layer apa yang memegang tanggung jawab ini? |
| Hexagonal | Boundary from external world | Port apa yang core butuhkan/sediakan? |
| Clean | Dependency direction | Apakah dependency mengarah ke policy? |
| Modular Monolith | Module ownership | Module mana pemilik capability ini? |

### 11.2 Kapan Memakai Apa

Gunakan layered architecture ketika:

```text
Aplikasi relatif sederhana.
Flow mostly request-response.
Team butuh convention mudah.
Domain tidak terlalu kompleks.
```

Gunakan hexagonal ketika:

```text
Banyak external systems.
Domain logic perlu sangat testable.
Integration model berubah-ubah.
Mau melindungi core dari teknologi.
```

Gunakan clean architecture ketika:

```text
Policy domain/application harus stabil.
Framework detail tidak boleh mendikte desain.
Testing tanpa framework penting.
Long-term maintainability penting.
```

Gunakan modular monolith ketika:

```text
Sistem besar tetapi belum perlu microservices.
Banyak domain module.
Ownership antar fitur penting.
Mau mengurangi coupling tanpa distributed complexity.
```

### 11.3 Kombinasi yang Realistis

Untuk Java enterprise besar:

```text
Top-level: Modular Monolith
Per module: Hexagonal/Clean boundary
Inside application: Layered responsibility
Infrastructure: Adapter implementations
```

Contoh:

```text
regulatory-platform
├── case-management
│   ├── api
│   ├── application
│   ├── domain
│   └── adapter
├── appeal
│   ├── api
│   ├── application
│   ├── domain
│   └── adapter
├── document
│   ├── api
│   ├── application
│   ├── domain
│   └── adapter
└── shared-kernel
```

---

## 12. Java 8–25 Perspective

### 12.1 Java 8

Java 8 membawa lambda dan functional interface.

Dampak architecture:

1. Port sederhana bisa berupa functional interface.
2. Strategy/policy bisa lightweight.
3. Test double lebih mudah dibuat.

Contoh:

```java
@FunctionalInterface
interface ClockPort {
    Instant now();
}
```

Tetapi jangan berlebihan. Tidak semua port layak jadi lambda. Jika kontraknya multi-method atau butuh semantic name, interface eksplisit lebih jelas.

### 12.2 Java 9 JPMS

JPMS membantu modular monolith jika dipakai serius.

Kekuatan:

1. Explicit requires.
2. Explicit exports.
3. Strong encapsulation.
4. Compile-time boundary.

Contoh:

```java
module com.company.appeal {
    requires com.company.case.management;
    requires com.company.shared.kernel;

    exports com.company.appeal.api;
}
```

Tetapi JPMS tidak otomatis membuat domain design bagus. Ia hanya membantu enforcement boundary.

### 12.3 Java 14–17 Records

Records cocok untuk:

1. Command.
2. Query result.
3. DTO.
4. Value object sederhana.
5. Internal event payload.
6. Port request/response object.

Contoh:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        String comment,
        IdempotencyKey idempotencyKey
) {}
```

Tetapi record bukan pengganti domain entity mutable lifecycle.

### 12.4 Sealed Classes

Sealed classes cocok untuk result dan domain alternatives.

```java
sealed interface ApproveCaseResult permits Approved, Rejected, NotFound {
}

record Approved(CaseId caseId) implements ApproveCaseResult {}
record Rejected(CaseId caseId, List<RejectionReason> reasons) implements ApproveCaseResult {}
record NotFound(CaseId caseId) implements ApproveCaseResult {}
```

Dengan pattern matching switch, API internal menjadi explicit dan exhaustive.

### 12.5 Virtual Threads

Virtual threads mengubah scalability model untuk blocking I/O, tetapi tidak menghapus kebutuhan boundary.

Kesalahan umum:

```text
Karena virtual thread murah, semua service boleh call semua external systems secara synchronous.
```

Tetap perlu:

1. Timeout.
2. Bulkhead.
3. Rate limit.
4. Transaction boundary.
5. Cancellation.
6. Observability.
7. Idempotency.

### 12.6 Scoped Values dan Context Propagation

Scoped values membantu membawa request context tanpa ThreadLocal leak, terutama dengan virtual threads dan structured concurrency.

Architecture implication:

1. Context seperti correlation ID bisa dikelola lebih aman.
2. Domain tetap tidak boleh bergantung pada global context tersembunyi.
3. Application boundary harus eksplisit tentang identity, tenant, trace context, dan authorization context.

---

## 13. Dependency Rule Praktis

### 13.1 Rule Dasar

```text
Domain must not depend on adapters.
Domain must not depend on frameworks.
Application must not depend on inbound/outbound adapter implementations.
Adapters may depend on application and domain.
Bootstrap may depend on all for wiring.
Cross-module access must use public module API.
```

### 13.2 Allowed Dependency Example

```text
web adapter -> application use case
application -> domain
application -> outbound port
persistence adapter -> outbound port + JPA
external adapter -> outbound port + HTTP client
bootstrap -> all modules for wiring
```

### 13.3 Disallowed Dependency Example

```text
domain -> spring-web
domain -> jakarta.persistence
application -> web controller
application -> kafka producer
application -> jpa repository implementation
module A internal -> module B internal
adapter -> adapter direct call without application boundary
```

### 13.4 Practical Import Smells

Jika kamu menemukan ini di domain package:

```java
import org.springframework.*;
import jakarta.persistence.*;
import com.fasterxml.jackson.*;
import jakarta.servlet.*;
import org.apache.kafka.*;
import software.amazon.awssdk.*;
```

Itu sinyal framework/detail leakage.

Ada pengecualian pragmatis, tetapi harus disengaja dan tercatat.

---

## 14. Package-by-Layer vs Package-by-Feature

### 14.1 Package-by-Layer

```text
controller
service
repository
dto
entity
```

Keunggulan:

1. Familiar.
2. Mudah untuk aplikasi kecil.
3. Cocok dengan scaffolding framework.

Kelemahan:

1. Feature tersebar.
2. Boundary domain tidak jelas.
3. Cross-feature coupling mudah terjadi.
4. Module ownership sulit.
5. Perubahan satu use case menyentuh banyak package global.

### 14.2 Package-by-Feature

```text
case_management
appeal
document
payment
notification
```

Keunggulan:

1. Ownership jelas.
2. Feature cohesion lebih tinggi.
3. Lebih mudah jadi modular monolith.
4. Lebih mudah refactor ke service terpisah jika benar-benar perlu.

Kelemahan:

1. Perlu disiplin boundary.
2. Bisa duplicate pattern antar module.
3. Shared kernel harus dikontrol.

### 14.3 Hybrid yang Direkomendasikan

```text
by feature at top level
by architecture inside feature
```

Contoh:

```text
case_management
├── api
├── application
├── domain
└── adapter

appeal
├── api
├── application
├── domain
└── adapter
```

Ini menggabungkan feature ownership dan internal architectural clarity.

---

## 15. Transaction Boundary dalam Architecture Pattern

Transaction boundary biasanya milik application service/use case, bukan controller dan bukan domain entity.

```java
final class ApproveCaseUseCase {
    @Transactional
    ApproveCaseResult approve(ApproveCaseCommand command) {
        // load aggregate
        // evaluate policy
        // mutate domain
        // save aggregate
        // record outbox/audit
    }
}
```

### 15.1 Jangan Menaruh External Call di Tengah Transaction

Bad:

```java
@Transactional
void approve(CaseId id) {
    Case c = repository.get(id);
    c.approve();
    externalSystem.notifyApproval(id); // risky
    repository.save(c);
}
```

Masalah:

1. External call lambat memperpanjang DB transaction.
2. Jika external berhasil lalu DB rollback, state split-brain.
3. Jika DB commit lalu external gagal, perlu retry/compensation.
4. Timeout external bisa menahan lock.

Better:

```java
@Transactional
void approve(CaseId id) {
    Case c = repository.get(id);
    c.approve();
    repository.save(c);
    outbox.save(IntegrationEvent.caseApproved(id));
}
```

Lalu publisher async mengirim outbox.

### 15.2 Transaction Boundary dan Module Boundary

Dalam modular monolith, cross-module transaction harus hati-hati.

Jika satu use case mengubah tiga module sekaligus dalam satu transaksi, mungkin boundary module salah atau orchestration terlalu besar.

Pertanyaan:

```text
Apakah perubahan lintas module benar-benar satu invariant?
Atau seharusnya eventual consistency dengan event?
Siapa pemilik state utama?
Apa rollback semantics-nya?
Apa audit semantics-nya?
```

---

## 16. Boundary Enforcement Techniques

### 16.1 Package-private Classes

Jangan semua class `public`.

```java
final class JpaCaseRepositoryAdapter implements CaseRepository {
    // package-private, only configuration exposes port bean
}
```

Public hanya untuk API yang memang dipakai luar package/module.

### 16.2 Explicit API Package

```text
case_management.api
case_management.internal
case_management.application
case_management.domain
case_management.adapter
```

Module lain hanya boleh import `api`.

### 16.3 Build Module Separation

Gradle example konseptual:

```text
:shared-kernel
:case-management-api
:case-management-domain
:case-management-application
:case-management-adapter-persistence
:case-management-adapter-web
:app-bootstrap
```

Ini lebih kuat tetapi lebih banyak overhead. Gunakan jika codebase besar dan boundary sering dilanggar.

### 16.4 JPMS

JPMS memberi compile-time module boundary.

Tetapi di banyak Spring Boot enterprise apps, JPMS belum selalu mudah karena reflection, classpath tradition, dan ecosystem. Tetap bisa dipakai untuk library/internal modules tertentu.

### 16.5 ArchUnit / Static Rule

Static architecture tests sering paling pragmatis untuk Spring/Jakarta apps.

Rule yang berguna:

```text
domain must not depend on adapter/framework packages
application must not depend on web/persistence/messaging packages
adapter packages must not depend on each other directly
module internal package must not be accessed from another module
no cyclic package dependencies
repository interfaces must reside in application/domain port package
JPA entities must not be returned from controller
```

---

## 17. Refactoring Legacy Layered App ke Modular/Hexagonal Design

### 17.1 Jangan Big-Bang Rewrite

Big-bang rewrite biasanya gagal karena:

1. Business rule tersembunyi di legacy code.
2. Test coverage kurang.
3. Team kehilangan behavior detail.
4. Deadline fitur tetap berjalan.
5. New architecture belum terbukti menangani edge case.

Gunakan incremental refactoring.

### 17.2 Step 1 — Identify Use Case Boundary

Ambil satu use case:

```text
Approve Case
Submit Appeal
Upload Document
Generate Notice
Validate Application
```

Jangan mulai dari “rapikan semua package”. Mulai dari behavior.

### 17.3 Step 2 — Buat Command/Result

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        String comment,
        IdempotencyKey idempotencyKey
) {}

public sealed interface ApproveCaseResult permits Approved, Rejected, NotFound {}
```

Ini membuat boundary use case eksplisit.

### 17.4 Step 3 — Extract Application Service

Pindahkan orchestration dari controller/service besar ke use case class.

```java
final class ApproveCaseUseCase {
    ApproveCaseResult approve(ApproveCaseCommand command) {
        // initially delegate to old service if needed
    }
}
```

Awalnya boleh wrapper ke legacy service. Tujuannya membuat entrypoint baru.

### 17.5 Step 4 — Extract Domain Rule

Ambil rule dari service/controller/repository ke policy/specification/domain method.

```java
final class ApprovalPolicy {
    ApprovalDecision evaluate(RegulatoryCase regulatoryCase, OfficerId officerId) {
        // rule here
    }
}
```

### 17.6 Step 5 — Introduce Port for External Dependency

Jika use case memanggil external API:

```java
interface AddressValidationGateway {
    AddressValidationResult validate(AddressToValidate address);
}
```

Adapter lama tetap bisa dipakai di belakang port.

### 17.7 Step 6 — Isolate Persistence Model

Jika API/domain langsung pakai JPA entity, buat mapper perlahan.

```java
final class JpaCaseMapper {
    RegulatoryCase toDomain(CaseEntity entity) { ... }
    void updateEntity(RegulatoryCase domain, CaseEntity entity) { ... }
}
```

Tidak harus semua entity langsung dipisah. Mulai dari aggregate/use case yang paling sering berubah atau paling riskan.

### 17.8 Step 7 — Add Architecture Tests

Setelah boundary dibuat, cegah regress.

```text
No controller accesses repository directly.
No domain imports Spring/JPA/Jackson.
No module imports another module internal package.
```

### 17.9 Step 8 — Repeat per Use Case

Refactoring architecture sehat berbasis use case.

```text
One use case at a time.
One boundary at a time.
One dependency direction fixed at a time.
```

---

## 18. Case Study: Approval Module Architecture

### 18.1 Awal yang Bermasalah

```text
approval
├── ApprovalController.java
├── ApprovalService.java
├── ApprovalRepository.java
├── ApprovalEntity.java
├── ApprovalDto.java
└── ApprovalUtil.java
```

`ApprovalService` melakukan:

1. Load case.
2. Check role.
3. Check ownership.
4. Check document completeness.
5. Update status.
6. Save entity.
7. Send email.
8. Push Kafka event.
9. Write audit.
10. Call external registry.
11. Generate PDF.

Ini bukan service. Ini transaction script monster.

### 18.2 Target Structure

```text
approval
├── api
│   ├── ApprovalFacade.java
│   └── ApprovalSummary.java
├── application
│   ├── ApproveCaseUseCase.java
│   ├── RejectCaseUseCase.java
│   ├── command
│   ├── result
│   └── port
│       ├── CaseRepository.java
│       ├── DocumentReadPort.java
│       ├── ApprovalAuditPort.java
│       ├── ApprovalEventOutbox.java
│       └── NotificationPort.java
├── domain
│   ├── ApprovalPolicy.java
│   ├── ApprovalDecision.java
│   ├── ApprovalRule.java
│   ├── ApprovalStatus.java
│   └── event
└── adapter
    ├── web
    ├── persistence
    ├── notification
    ├── audit
    └── messaging
```

### 18.3 Dependency Direction

```text
web adapter -> application
application -> domain
application -> port abstractions
persistence adapter -> port + JPA
messaging adapter -> port + Kafka
notification adapter -> port + SMTP/API
```

### 18.4 Improved Flow

```text
HTTP request
  -> ApprovalController
  -> ApproveCaseCommand
  -> ApproveCaseUseCase
      -> Authorization/Policy check
      -> Load aggregate
      -> Domain transition
      -> Save aggregate
      -> Save outbox event
      -> Save audit event
  -> Result
  -> HTTP response

Outbox worker
  -> publish integration event
  -> notification adapter sends email
```

### 18.5 Why This Is Better

1. Business rule explicit.
2. Controller thin.
3. Transaction boundary clear.
4. External side effects separated.
5. Audit consistent.
6. Messaging reliable via outbox.
7. Testing core does not need HTTP/DB/Kafka.
8. Module API can be controlled.
9. Future integration change does not rewrite domain.
10. Staff-level review can discuss boundary, not only implementation.

---

## 19. Architecture Anti-Pattern Catalog

### 19.1 Fake Clean Architecture

Symptoms:

```text
Folder names look clean.
Dependencies still point everywhere.
Use case imports repository implementation.
Domain imports framework.
Adapters contain business rule.
```

Diagnosis:

```text
Architecture is not folder names; architecture is dependency rule.
```

### 19.2 Anemic Hexagon

Symptoms:

```text
Ports exist.
Adapters exist.
Domain has no behavior.
Application service only copies DTO to entity.
```

Diagnosis:

```text
Boundary ceremony without domain value.
```

### 19.3 Interface for Everything

Symptoms:

```java
interface CaseService {}
class CaseServiceImpl implements CaseService {}
```

No alternate implementation, no testing reason, no boundary reason.

Better:

```text
Use interface at architectural boundary, not as reflex.
```

### 19.4 Shared Kernel Explosion

Symptoms:

```text
shared-kernel contains half the system.
Every module depends on it.
Changing shared breaks everything.
```

Diagnosis:

```text
Shared kernel became common dumping ground.
```

### 19.5 Cross-Module Repository Access

```java
class AppealService {
    private final CaseJpaRepository caseJpaRepository;
}
```

Problem:

```text
Appeal bypasses case-management ownership.
```

Better:

```java
class AppealService {
    private final CaseManagementFacade caseManagementFacade;
}
```

Or event/projection depending on consistency need.

### 19.6 Distributed Monolith in Waiting

A modular monolith with poor boundaries becomes distributed monolith if split into services too early.

Symptoms before split:

```text
Modules call each other constantly.
Shared tables everywhere.
No clear owner.
No stable contracts.
No idempotency.
No event semantics.
```

If split now, you get:

```text
Networked spaghetti.
```

### 19.7 Framework-Owned Domain

```java
@Entity
@JsonIgnoreProperties
@Validated
@Component
class Case { ... }
```

Sometimes pragmatic for small systems. Dangerous for complex domain.

Problem:

```text
Domain lifecycle controlled by framework constraints.
Domain model cannot be tested or evolved independently.
```

### 19.8 Layered CRUD Trap

Everything becomes:

```text
Controller -> Service -> Repository
```

No domain behavior, no use-case boundary, no decision model.

This is acceptable for simple CRUD. It becomes costly for workflow/rule-heavy domain.

---

## 20. Design Review Checklist

Gunakan checklist ini saat review architecture Java module.

### 20.1 Boundary

```text
[ ] Apa module/capability yang sedang didesain?
[ ] Siapa pemilik data utama?
[ ] Siapa pemilik rule utama?
[ ] Apa public API module ini?
[ ] Apa yang internal dan tidak boleh diimport module lain?
```

### 20.2 Dependency

```text
[ ] Apakah domain bebas dari framework?
[ ] Apakah application bebas dari adapter implementation?
[ ] Apakah controller tidak akses repository langsung?
[ ] Apakah adapter tidak saling memanggil langsung?
[ ] Apakah ada cyclic dependency antar package/module?
```

### 20.3 Use Case

```text
[ ] Apakah use case punya command/query model eksplisit?
[ ] Apakah result/error model eksplisit?
[ ] Apakah transaction boundary jelas?
[ ] Apakah authorization dilakukan sebelum mutation?
[ ] Apakah audit/event dilakukan konsisten?
```

### 20.4 Persistence

```text
[ ] Apakah persistence model bocor ke API?
[ ] Apakah module lain mengakses table/repository internal?
[ ] Apakah query cost terlihat?
[ ] Apakah ownership table jelas?
[ ] Apakah N+1/transaction/lazy loading risk dikendalikan?
```

### 20.5 Integration

```text
[ ] Apakah external system dibungkus gateway/adapter?
[ ] Apakah model eksternal diterjemahkan ke model internal?
[ ] Apakah error eksternal dinormalisasi?
[ ] Apakah retry/timeout/idempotency jelas?
[ ] Apakah side effect lintas sistem memakai outbox/inbox jika perlu?
```

### 20.6 Modularity

```text
[ ] Apakah package-by-feature digunakan di level atas?
[ ] Apakah shared kernel kecil?
[ ] Apakah module dependency satu arah?
[ ] Apakah internal package terlindungi?
[ ] Apakah architecture tests tersedia?
```

---

## 21. Testing Strategy

### 21.1 Domain Tests

Tanpa framework.

```java
class ApprovalPolicyTest {
    @Test
    void rejects_when_documents_are_incomplete() {
        RegulatoryCase regulatoryCase = CaseFixture.submittedWithIncompleteDocuments();
        ApprovalPolicy policy = new ApprovalPolicy();

        ApprovalDecision decision = policy.evaluate(regulatoryCase, OfficerId.of("O001"));

        assertThat(decision.isRejected()).isTrue();
    }
}
```

### 21.2 Application Use Case Tests

Gunakan fake port.

```java
class ApproveCaseUseCaseTest {
    @Test
    void approves_case_and_records_event() {
        InMemoryCaseRepository repository = new InMemoryCaseRepository();
        InMemoryOutbox outbox = new InMemoryOutbox();

        ApproveCaseUseCase useCase = new ApproveCaseUseCase(
                repository,
                new ApprovalPolicy(),
                outbox,
                new InMemoryAuditPort()
        );

        ApproveCaseResult result = useCase.approve(command());

        assertThat(result).isInstanceOf(Approved.class);
        assertThat(outbox.events()).hasSize(1);
    }
}
```

### 21.3 Adapter Tests

Adapter test boleh pakai framework/testcontainer/mock server.

```text
Persistence adapter test: JPA mapping, SQL behavior, transaction behavior.
HTTP adapter test: request/response mapping and error mapping.
External adapter test: timeout/error/response mapping.
Messaging adapter test: serialization, headers, idempotency.
```

### 21.4 Architecture Tests

Architecture tests menjaga dependency rule.

```text
Domain no framework.
Application no adapter.
Module no internal cross-access.
No cycles.
Controller no repository direct.
```

### 21.5 Contract Tests

Untuk module API/internal facade:

```text
Consumer expectation terhadap module API.
Backward compatibility.
Error semantics.
Field visibility.
```

---

## 22. Observability dan Debugging Angle

Architecture pattern harus membantu debugging, bukan hanya mempercantik source tree.

### 22.1 Trace by Boundary

Trace span bisa mengikuti boundary:

```text
HTTP adapter span
Application use case span
Repository adapter span
External gateway span
Outbox publish span
```

### 22.2 Log by Use Case

Application service adalah tempat bagus untuk log business-level event.

```text
case.approval.started
case.approval.rejected
case.approval.completed
case.approval.failed
```

Jangan log domain internal terlalu teknis tanpa context.

### 22.3 Architecture-Aware Metrics

Metric yang berguna:

```text
use_case_duration_seconds
use_case_failure_total{reason}
repository_query_duration_seconds
external_gateway_duration_seconds{system}
outbox_pending_total
module_api_call_total{consumer}
```

### 22.4 Debugging Modular Monolith

Pertanyaan debugging:

```text
Use case mana yang memulai flow?
Module mana pemilik state?
Port mana yang gagal?
Adapter mana yang menerjemahkan error?
Apakah side effect synchronous atau outbox?
Correlation ID bertahan melewati boundary mana?
```

---

## 23. Security Angle

Architecture pattern berpengaruh langsung pada security.

### 23.1 Authorization Boundary

Authorization sebaiknya terjadi di application boundary, bukan tersebar acak di controller/repository.

```java
final class ApproveCaseUseCase {
    ApproveCaseResult approve(ApproveCaseCommand command) {
        authorizationPolicy.check(command.officerId(), Action.APPROVE_CASE, command.caseId());
        // mutate after authorized
    }
}
```

### 23.2 Field-Level Security

Jangan return entity langsung. Gunakan presenter/view model yang sadar permission.

```java
CaseDetailView view = casePresenter.present(caseDetail, accessDecision);
```

### 23.3 Module Boundary as Security Boundary

Dalam modular monolith, module internal harus dilindungi. Kalau semua module bisa akses semua repository, access control mudah terlewat.

### 23.4 Audit Boundary

Audit event sebaiknya dibuat di use case boundary dengan:

```text
actor
resource
action
before/after when needed
reason
decision id
correlation id
```

---

## 24. Performance Angle

Architecture abstraction punya biaya, tetapi biaya terbesar sering bukan interface call. Biaya terbesar biasanya:

1. Query tidak terlihat.
2. N+1 tersembunyi.
3. Transaction terlalu panjang.
4. External call di dalam transaction.
5. Cross-module synchronous chain.
6. Excessive mapping object dalam hot path.
7. Reflection/proxy berlebihan.
8. Cache boundary salah.

### 24.1 Jangan Menyembunyikan Query Cost

Repository/port harus tetap memberi sinyal query cost.

Buruk:

```java
List<Case> findAll();
```

Lebih baik:

```java
Page<CaseSummary> findPendingApprovalCases(PendingApprovalQuery query);
```

### 24.2 Cross-Module Call Cost

Dalam monolith, call method murah. Tetapi dependency semantic tidak murah.

Jika module A memanggil module B dalam loop ribuan kali, itu smell:

```text
N+1 at module boundary.
```

Gunakan bulk API/projection.

```java
Map<CaseId, CaseSummary> getCaseSummaries(Set<CaseId> caseIds);
```

---

## 25. Staff-Level Discussion Questions

Gunakan pertanyaan ini untuk menguji maturity design:

1. Apa alasan memilih layered/hexagonal/clean/modular monolith di module ini?
2. Apa dependency rule yang ingin ditegakkan?
3. Apa policy yang harus bebas dari framework?
4. Apa detail teknis yang paling mungkin berubah?
5. Apa module API yang stabil?
6. Apa yang terjadi jika persistence diganti?
7. Apa yang terjadi jika external API berubah?
8. Apa yang terjadi jika module ini nanti dipisah menjadi service?
9. Apakah database ownership sudah jelas?
10. Apakah transaction boundary mengikuti invariant bisnis?
11. Apakah cross-module dependency satu arah?
12. Apakah architecture tests menjaga rule?
13. Apakah abstraction yang dibuat punya volatility nyata?
14. Di mana authorization terjadi?
15. Di mana audit event dibuat?
16. Apakah result/error model explicit?
17. Apakah observability mengikuti boundary?
18. Apakah performance cost dari boundary terlihat?
19. Apakah shared kernel terlalu besar?
20. Apa refactoring path jika boundary sekarang salah?

---

## 26. Pattern Decision Matrix

| Situation | Better Pattern | Avoid |
|---|---|---|
| CRUD sederhana | Simple layered | Full hexagonal ceremony untuk semua class |
| Domain rule kompleks | Clean/hexagonal per module | Controller-service-repository procedural blob |
| Banyak external system | Ports and adapters | Direct SDK/client everywhere |
| Sistem besar satu deployable | Modular monolith | Package-by-layer global |
| Framework-heavy app | Clean dependency rule + adapter isolation | Domain imports framework everywhere |
| Banyak workflow/state | Application use case + domain state machine | Status field updated anywhere |
| Reporting/read-heavy | Query model/projection | Domain aggregate forced for every read |
| Cross-module interaction | Facade/event/projection | Direct repository/table access |
| Future possible service split | Modular monolith with stable API | Premature microservices |
| Regulatory defensibility | Explicit policy/audit/use-case boundary | Rule hidden in SQL/controller |

---

## 27. Mini Reference Implementation Sketch

```text
case-management
├── api
│   ├── CaseManagementFacade.java
│   ├── CaseSummary.java
│   └── CaseId.java
├── application
│   ├── ApproveCaseUseCase.java
│   ├── SubmitCaseUseCase.java
│   ├── command
│   │   └── ApproveCaseCommand.java
│   ├── result
│   │   └── ApproveCaseResult.java
│   └── port
│       ├── CaseRepository.java
│       ├── AuditPort.java
│       └── CaseEventOutbox.java
├── domain
│   ├── RegulatoryCase.java
│   ├── CaseStatus.java
│   ├── ApprovalPolicy.java
│   ├── ApprovalDecision.java
│   └── event
│       └── CaseApproved.java
└── adapter
    ├── web
    │   └── CaseApprovalController.java
    ├── persistence
    │   ├── JpaCaseRepositoryAdapter.java
    │   ├── CaseEntity.java
    │   └── SpringDataCaseRepository.java
    ├── audit
    │   └── DatabaseAuditAdapter.java
    └── messaging
        └── OutboxCaseEventPublisher.java
```

Dependency direction:

```text
api can be used by other modules.
application uses domain and ports.
domain uses only domain/shared-kernel.
adapter implements ports.
bootstrap wires adapters to application.
```

---

## 28. Common Mistakes and Corrections

### Mistake 1: “Clean architecture means no framework.”

Correction:

```text
Framework boleh dipakai.
Framework tidak boleh mengontrol policy/domain.
```

### Mistake 2: “Every repository needs interface.”

Correction:

```text
Interface berguna di boundary yang punya semantic/volatility/testing value.
Interface reflex tanpa reason hanya noise.
```

### Mistake 3: “Modular monolith is just package-by-feature.”

Correction:

```text
Modular monolith butuh dependency enforcement, public API, ownership, and internal hiding.
```

### Mistake 4: “If we may become microservices, start with microservices.”

Correction:

```text
Start by modularizing. Split only when module boundary, data ownership, and operational need are proven.
```

### Mistake 5: “Domain should never call anything.”

Correction:

```text
Domain object can collaborate with domain service/policy/value object.
Application coordinates external ports.
```

### Mistake 6: “Architecture pattern guarantees quality.”

Correction:

```text
Pattern only helps if dependency rule, tests, ownership, and review discipline exist.
```

---

## 29. Summary

Architecture pattern bukan tentang folder cantik. Architecture pattern adalah cara mengendalikan dependency, ownership, volatility, transaction, consistency, dan change impact.

Layered architecture membantu memisahkan responsibility, tetapi bisa menjadi call stack ritual jika tidak ada boundary rule.

Hexagonal architecture membantu melindungi application core dari dunia luar melalui ports and adapters.

Clean architecture menekankan dependency rule: detail bergantung pada policy, bukan policy pada detail.

Modular monolith membantu sistem besar tetap satu deployable tetapi punya module ownership yang jelas.

Untuk Java enterprise modern, kombinasi yang sering paling realistis adalah:

```text
Modular monolith at system level.
Hexagonal/Clean boundary per module.
Layered organization inside module.
Architecture tests to enforce dependency rule.
```

The top 1% engineer tidak bertanya “pakai clean architecture atau layered?” secara dogmatis. Ia bertanya:

```text
Apa force-nya?
Apa yang berubah?
Apa yang harus stabil?
Apa yang harus dilindungi?
Apa dependency rule-nya?
Apa biaya abstraction-nya?
Apa failure mode-nya?
Bagaimana refactoring path-nya?
```

---

## 30. Latihan Praktis

Ambil satu module Java enterprise yang kamu kenal. Jawab:

1. Apa nama module/capability-nya?
2. Apa public API internal module itu?
3. Apa yang seharusnya tidak boleh diimport module lain?
4. Apakah domain import framework?
5. Apakah controller akses repository langsung?
6. Apakah application service mengatur transaction boundary?
7. Apakah external API dibungkus gateway?
8. Apakah entity persistence bocor ke response API?
9. Apakah module lain query table module ini langsung?
10. Apakah ada cyclic dependency?
11. Apa satu architecture test yang paling penting ditambahkan?
12. Apa satu use case terbaik untuk mulai refactoring?

---

## 31. Final Checklist

```text
[ ] Architecture dipahami sebagai dependency rule, bukan folder.
[ ] Layer responsibility jelas.
[ ] Domain bebas dari framework detail.
[ ] Application service menjadi use-case boundary.
[ ] External dependency masuk lewat port/adapter.
[ ] Persistence model tidak bocor ke API.
[ ] Module public API eksplisit.
[ ] Internal package terlindungi.
[ ] Shared kernel kecil.
[ ] Cross-module call terkontrol.
[ ] Transaction boundary mengikuti invariant.
[ ] External side effect tidak sembarang di tengah transaction.
[ ] Architecture tests menjaga rule.
[ ] Refactoring dilakukan per use case, bukan big bang.
```

---

## 32. Posisi dalam Seri

```text
Part 30 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
31-distributed-system-patterns-antipatterns-java-engineers.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./29-framework-patterns-di-aop-annotation-reflection-spi.md">⬅️ Framework Patterns: Dependency Injection, AOP, Annotation, Reflection, SPI</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./31-distributed-system-patterns-antipatterns-java-engineers.md">Distributed System Patterns and Anti-Patterns for Java Engineers ➡️</a>
</div>
