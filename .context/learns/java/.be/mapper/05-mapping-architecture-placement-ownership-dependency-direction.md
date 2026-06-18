# Part 5 — Mapping Architecture: Mapper Placement, Ownership, and Dependency Direction

**Series:** `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
**File:** `05-mapping-architecture-placement-ownership-dependency-direction.md`  
**Scope:** Java 8–25, enterprise backend, API/application/domain/persistence/integration boundaries  
**Goal:** Membentuk kemampuan arsitektural untuk menentukan **di mana mapper berada**, **siapa yang memiliki logic mapping**, **arah dependency yang benar**, dan **bagaimana mapping layer melindungi domain dari kebocoran model eksternal**.

---

## 0. Ringkasan Eksekutif

Pada level junior, mapping sering dilihat sebagai pekerjaan mekanis:

> Ambil field dari object A, isi object B.

Pada level senior/top engineer, mapping dilihat sebagai bagian dari **boundary architecture**:

> Setiap kali data melewati batas antar layer, antar bounded context, antar sistem, antar format, atau antar versi kontrak, data harus diterjemahkan secara eksplisit agar makna, invariant, ownership, security, dan compatibility tetap terjaga.

Mapper bukan hanya util class. Mapper adalah **translator** antar model yang memiliki tujuan berbeda.

Contoh sederhana:

```java
UserResponse response = UserMapper.toResponse(userEntity);
```

Kelihatannya hanya copy field. Tapi secara arsitektural, itu bisa berarti:

- menyembunyikan internal entity structure;
- menghindari leak field sensitif;
- mengubah `LocalDateTime` internal menjadi ISO-8601 external contract;
- memutus lazy-loading graph JPA;
- mengontrol API backward compatibility;
- mengubah enum internal menjadi public status code;
- memastikan response DTO tidak membawa domain behavior;
- memastikan domain tidak bergantung pada framework serialization.

Part ini membahas pertanyaan utama:

> Mapper seharusnya ditempatkan di mana, dan dependency-nya harus mengarah ke mana?

---

## 1. Mental Model: Mapping Happens at Boundaries, Not Randomly

Mapping sebaiknya terjadi saat data melewati boundary.

Boundary umum di backend Java:

```text
[HTTP JSON Request]
        |
        v
[API DTO]
        |
        v
[Application Command / Query]
        |
        v
[Domain Model]
        |
        v
[Persistence Entity / Projection]
        |
        v
[Database]
```

Atau untuk response:

```text
[Database]
    |
    v
[Persistence Entity / Projection]
    |
    v
[Domain / Read Model]
    |
    v
[API Response DTO]
    |
    v
[JSON Response]
```

Untuk integration:

```text
[External System Payload]
        |
        v
[External DTO]
        |
        v
[Anti-Corruption Mapper]
        |
        v
[Internal Command / Domain Intent]
```

Prinsipnya:

> Jika dua model dimiliki oleh layer/boundary berbeda, jangan biarkan satu model menyusup ke boundary lain tanpa translation eksplisit.

Mapping bukan aktivitas bebas. Mapping adalah **pernyataan arsitektur** bahwa satu bentuk data sedang diterjemahkan ke bentuk data lain dengan ownership, invariant, dan policy yang berbeda.

---

## 2. Kenapa Mapper Placement Penting?

Mapper placement yang salah biasanya tidak langsung terasa. Awalnya code tampak lebih singkat. Masalah muncul setelah sistem membesar.

### 2.1 Gejala Mapper Placement yang Buruk

Beberapa gejala umum:

1. Entity JPA langsung dipakai sebagai API response.
2. Request DTO langsung dipakai sebagai entity.
3. Domain object punya annotation Jackson, JPA, OpenAPI, Lombok, validation, dan XML sekaligus.
4. Mapper dipakai lintas module tanpa jelas boundary-nya.
5. Mapper mengakses repository, service, security context, dan remote API secara bebas.
6. Mapping logic tersebar di controller, service, entity constructor, dan util static class.
7. Field baru ditambahkan di entity lalu tiba-tiba muncul di API response.
8. Perubahan external API memaksa perubahan domain model.
9. MapStruct mapper menjadi dependency graph besar yang sulit dipahami.
10. Mapper sulit dites karena membutuhkan Spring context penuh.

Semua gejala ini menunjukkan bahwa mapping tidak lagi menjadi boundary yang terkendali, tetapi menjadi **jalur bocor antar layer**.

---

## 3. Layer Model yang Akan Kita Pakai

Agar pembahasan konsisten, kita gunakan model layer berikut:

```text
┌──────────────────────────────────────────────────────────────┐
│ Interface / Delivery Layer                                   │
│ - REST Controller                                            │
│ - GraphQL Resolver                                           │
│ - Message Listener                                           │
│ - CLI / Batch Adapter                                        │
│ - JSON/XML boundary                                          │
└──────────────────────────────────────────────────────────────┘
                            |
                            v
┌──────────────────────────────────────────────────────────────┐
│ Application Layer                                            │
│ - Use case orchestration                                     │
│ - Command / Query handling                                   │
│ - Transaction boundary                                       │
│ - Authorization decision orchestration                       │
│ - Workflow coordination                                      │
└──────────────────────────────────────────────────────────────┘
                            |
                            v
┌──────────────────────────────────────────────────────────────┐
│ Domain Layer                                                 │
│ - Business concepts                                          │
│ - Aggregate / Entity / Value Object                          │
│ - Invariants                                                 │
│ - Domain behavior                                            │
│ - Domain events                                              │
└──────────────────────────────────────────────────────────────┘
                            ^
                            |
┌──────────────────────────────────────────────────────────────┐
│ Infrastructure Layer                                         │
│ - JPA entities / repositories                                │
│ - External API clients                                       │
│ - Message broker adapters                                    │
│ - File storage adapters                                      │
│ - Serialization-specific code                                │
└──────────────────────────────────────────────────────────────┘
```

Catatan penting:

- Tidak semua project harus menerapkan Clean Architecture murni.
- Tetapi setiap project tetap punya boundary.
- Bahkan simple CRUD service tetap punya minimal boundary: API, application, persistence.
- Semakin regulated/enterprise sistemnya, semakin penting boundary mapping eksplisit.

---

## 4. Prinsip Dependency Direction

Prinsip utama:

> Inner layer tidak boleh tahu detail outer layer.

Dalam desain layered/hexagonal:

```text
Outer depends on inner.
Inner does not depend on outer.
```

Contoh:

```text
Controller  -> Application Service -> Domain
Repository Adapter -> Domain
External API Adapter -> Domain/Application Port
```

Maka mapping dependency harus mengikuti arah itu.

### 4.1 Yang Seharusnya Tidak Terjadi

Domain tidak ideal bergantung pada API DTO:

```java
// Buruk
public class Case {
    public static Case from(CreateCaseRequest request) {
        ...
    }
}
```

Kenapa buruk?

Karena domain sekarang tahu bentuk HTTP request. Kalau API berubah, domain ikut berubah.

Domain juga tidak ideal tahu JPA entity:

```java
// Buruk
public class Case {
    public CaseEntity toEntity() {
        ...
    }
}
```

Kenapa buruk?

Karena domain tahu persistence mechanism. Kalau DB schema berubah, domain ikut berubah.

Domain juga tidak ideal tahu external DTO:

```java
// Buruk
public class Customer {
    public static Customer fromSingpassResponse(SingpassUserInfoResponse response) {
        ...
    }
}
```

Kenapa buruk?

Karena domain terkontaminasi model provider eksternal.

### 4.2 Yang Lebih Sehat

Mapper berada di boundary adapter:

```text
CreateCaseRequest
        |
        v
ApiRequestMapper
        |
        v
CreateCaseCommand
        |
        v
Application Service
        |
        v
Domain
```

Untuk persistence:

```text
CaseEntity
    |
    v
PersistenceMapper
    |
    v
Case Aggregate / CaseSnapshot / CaseReadModel
```

Untuk external API:

```text
ExternalProviderResponse
        |
        v
ExternalProviderMapper / AntiCorruptionMapper
        |
        v
InternalVerifiedIdentity
```

Domain tetap bersih.

---

## 5. Mapper Placement Pattern

Ada beberapa pattern placement yang umum. Tidak ada satu jawaban absolut. Pilihan tergantung ukuran sistem, kompleksitas domain, tim, dan lifecycle kontrak.

---

## 6. Pattern 1 — Controller-Level Mapper

### 6.1 Bentuk

```text
Controller
   |- receives RequestDTO
   |- maps RequestDTO -> Command
   |- calls ApplicationService
   |- maps Result -> ResponseDTO
```

Contoh:

```java
@RestController
@RequestMapping("/cases")
public class CaseController {

    private final CaseApplicationService service;
    private final CaseApiMapper mapper;

    @PostMapping
    public ResponseEntity<CaseResponse> create(@Valid @RequestBody CreateCaseRequest request) {
        CreateCaseCommand command = mapper.toCommand(request);
        CaseResult result = service.createCase(command);
        CaseResponse response = mapper.toResponse(result);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
}
```

### 6.2 Cocok Jika

- mapping hanya API boundary;
- service menerima command/query internal;
- controller tidak terlalu gemuk;
- API DTO tidak boleh masuk application layer;
- mapping sederhana sampai sedang;
- response DTO benar-benar public contract.

### 6.3 Kelebihan

- boundary API jelas;
- application layer tidak tahu HTTP DTO;
- mudah melihat transformasi masuk/keluar API;
- cocok untuk REST controller.

### 6.4 Kekurangan

- controller bisa membesar;
- kalau banyak endpoint, mapping logic bisa tersebar;
- sulit reuse mapping antar delivery mechanism;
- raw controller test bisa terlalu banyak mapping concern.

### 6.5 Rule of Thumb

Controller-level mapper baik untuk:

```text
API DTO <-> Application Command/Query/Result
```

Jangan gunakan controller mapper untuk:

```text
Entity <-> Domain
External API DTO <-> Domain
Complex enrichment dengan repository
```

---

## 7. Pattern 2 — Application-Level Mapper

### 7.1 Bentuk

Application service menerima DTO atau command, lalu mapping terjadi di application layer.

```java
@Service
public class CaseApplicationService {

    private final CaseCommandMapper commandMapper;
    private final CaseRepository repository;

    @Transactional
    public CaseResult createCase(CreateCaseCommand command) {
        CaseDraft draft = commandMapper.toDraft(command);
        Case created = Case.open(draft);
        repository.save(created);
        return CaseResult.from(created);
    }
}
```

### 7.2 Cocok Jika

- mapping adalah bagian dari use case orchestration;
- command perlu diterjemahkan menjadi domain intent;
- ada enrichment dari authenticated user/context;
- mapping perlu audit metadata;
- mapping membutuhkan transaction-aware behavior, tapi bukan business invariant inti.

### 7.3 Kelebihan

- application layer menjadi tempat natural untuk orchestration;
- bisa menggabungkan input API, user context, reference data, dan domain command;
- controller tetap tipis.

### 7.4 Kekurangan

- raw API DTO bisa bocor ke application layer jika tidak hati-hati;
- application service bisa berubah menjadi mapper besar;
- mapper dapat mulai mengambil alih domain logic.

### 7.5 Praktik Baik

Application layer sebaiknya menerima **command/query**, bukan HTTP request DTO.

```java
// Baik
service.createCase(CreateCaseCommand command);

// Kurang baik untuk sistem besar
service.createCase(CreateCaseRequest request);
```

Karena `CreateCaseRequest` adalah API contract, sedangkan `CreateCaseCommand` adalah use case intent.

---

## 8. Pattern 3 — Domain Factory / Domain Assembler

### 8.1 Bentuk

Domain object menyediakan factory untuk membangun dirinya dari domain-level input.

```java
public final class Case {

    public static Case open(OpenCaseIntent intent) {
        CaseId id = CaseId.newId();
        CaseStatus status = CaseStatus.DRAFT;

        return new Case(
            id,
            intent.applicant(),
            intent.caseType(),
            status,
            AuditStamp.createdBy(intent.actor())
        );
    }
}
```

### 8.2 Ini Mapping atau Domain Logic?

Ini bukan mapping dari API DTO. Ini domain construction.

Perbedaannya:

```text
API DTO -> Command                 = boundary mapping
Command -> Domain Intent           = application mapping/orchestration
Domain Intent -> Aggregate         = domain construction
Aggregate -> Entity                = persistence mapping
```

### 8.3 Cocok Jika

- object punya invariant kuat;
- construction bukan sekadar field assignment;
- ada domain rule pada pembentukan object;
- ingin mencegah invalid aggregate.

### 8.4 Risiko

Jangan biarkan domain factory menerima DTO luar:

```java
// Buruk
Case.open(CreateCaseRequest request);

// Lebih baik
Case.open(OpenCaseIntent intent);
```

Domain boleh tahu domain intent. Domain tidak perlu tahu HTTP JSON shape.

---

## 9. Pattern 4 — Persistence Mapper

### 9.1 Bentuk

Mapper antara domain model dan persistence model.

```text
Domain Aggregate <-> JPA Entity
```

Contoh:

```java
@Component
public class CasePersistenceMapper {

    public Case toDomain(CaseEntity entity) {
        return Case.rehydrate(
            new CaseId(entity.getId()),
            ApplicantSnapshot.of(entity.getApplicantId(), entity.getApplicantName()),
            CaseStatus.valueOf(entity.getStatus()),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    public CaseEntity toEntity(Case domain) {
        CaseEntity entity = new CaseEntity();
        entity.setId(domain.id().value());
        entity.setApplicantId(domain.applicant().id());
        entity.setApplicantName(domain.applicant().name());
        entity.setStatus(domain.status().name());
        entity.setCreatedAt(domain.createdAt());
        entity.setUpdatedAt(domain.updatedAt());
        return entity;
    }
}
```

### 9.2 Cocok Jika

- domain model tidak sama dengan DB model;
- ingin domain bebas dari JPA annotation;
- ingin menghindari lazy-loading leak;
- ingin persistence schema bisa berubah tanpa mengubah domain;
- ingin domain aggregate lebih kaya dari entity table structure.

### 9.3 Kelebihan

- memisahkan domain invariant dari persistence technical detail;
- mengurangi risiko JPA proxy masuk response;
- memudahkan migration schema;
- cocok untuk complex domain.

### 9.4 Kekurangan

- lebih banyak code;
- perlu update mapper saat model berubah;
- bisa terasa overkill untuk CRUD sederhana;
- perlu discipline testing.

### 9.5 Kapan Entity Boleh Menjadi Domain?

Di project sederhana, entity sering juga menjadi domain model.

Itu bisa diterima jika:

- domain logic ringan;
- entity tidak diekspos langsung ke API;
- API tetap memakai DTO;
- bidirectional relationship dikontrol;
- lazy-loading aman;
- field sensitif tidak otomatis terserialisasi;
- lifecycle kontrak API tidak bergantung ke schema DB.

Tetapi untuk sistem enterprise/regulatory/case management, entity-as-domain harus dipakai sangat hati-hati.

---

## 10. Pattern 5 — Integration Adapter Mapper / Anti-Corruption Layer

### 10.1 Masalah

External system sering punya model yang tidak cocok dengan internal model.

Contoh external identity provider response:

```json
{
  "uinfin": "S1234567D",
  "name": "JOHN TAN",
  "sex": "M",
  "dob": "1980-01-20",
  "regadd": {
    "postal": "123456",
    "block": "12",
    "street": "ABC ROAD"
  }
}
```

Internal model mungkin ingin:

```java
public record VerifiedPersonIdentity(
    IdentityNumber identityNumber,
    PersonName legalName,
    Gender gender,
    LocalDate dateOfBirth,
    PostalAddress registeredAddress
) {}
```

Mapper ini bukan sekadar rename field. Ia melakukan:

- translation code;
- normalization name;
- parsing date;
- address shaping;
- null handling;
- compatibility dengan provider version;
- isolasi external naming;
- protection dari provider-specific quirks.

### 10.2 Bentuk

```java
@Component
public class IdentityProviderMapper {

    public VerifiedPersonIdentity toVerifiedIdentity(MyInfoPersonResponse response) {
        return new VerifiedPersonIdentity(
            IdentityNumber.of(response.uinfin()),
            PersonName.legal(response.name()),
            mapGender(response.sex()),
            LocalDate.parse(response.dob()),
            mapAddress(response.regadd())
        );
    }

    private Gender mapGender(String sex) {
        return switch (sex) {
            case "M" -> Gender.MALE;
            case "F" -> Gender.FEMALE;
            default -> Gender.UNKNOWN;
        };
    }
}
```

Untuk Java 8, switch expression diganti switch statement biasa.

### 10.3 Prinsip Anti-Corruption Mapper

External DTO tidak boleh menyebar ke internal code.

```text
Allowed:
External DTO -> Adapter Mapper -> Internal Model

Not allowed:
External DTO -> Service -> Domain -> Repository -> Event
```

Jika external DTO menyebar, maka external provider sedang mendesain sistem internal kita secara tidak langsung.

### 10.4 Cocok Jika

- integrasi dengan third-party/regulator/provider;
- payload external punya naming/format/semantics berbeda;
- provider bisa berubah versi;
- internal domain harus stabil;
- ada mapping code table;
- ada compatibility mode.

---

## 11. Pattern 6 — Event Mapper

### 11.1 Event Bukan Entity Snapshot Mentah

Kesalahan umum:

```java
publish(caseEntity);
```

Atau:

```java
CaseCreatedEvent event = objectMapper.convertValue(caseEntity, CaseCreatedEvent.class);
```

Ini berbahaya karena event adalah contract jangka panjang. Entity adalah persistence detail.

### 11.2 Event Mapper yang Lebih Benar

```java
@Component
public class CaseEventMapper {

    public CaseCreatedEvent toCaseCreatedEvent(Case domain) {
        return new CaseCreatedEvent(
            domain.id().value(),
            domain.caseType().code(),
            domain.applicant().id(),
            domain.status().name(),
            domain.createdAt(),
            1
        );
    }
}
```

### 11.3 Event Mapping Harus Memikirkan

- event version;
- idempotency key;
- aggregate id;
- occurredAt;
- actor;
- correlation id;
- causation id;
- schema compatibility;
- sensitive data minimization;
- consumer needs;
- replay safety.

### 11.4 Rule of Thumb

> Event payload harus didesain sebagai public/internal integration contract, bukan hasil otomatis dari entity serialization.

---

## 12. Pattern 7 — Read Model / Projection Mapper

Tidak semua response harus berasal dari domain aggregate.

Untuk query/reporting/listing, sering lebih baik menggunakan projection.

```text
Database View / Query Projection -> Read DTO -> API Response
```

Contoh:

```java
public record CaseListItemProjection(
    String caseId,
    String caseNo,
    String applicantName,
    String status,
    LocalDateTime submittedAt
) {}
```

Mapper:

```java
public class CaseListResponseMapper {

    public CaseListItemResponse toResponse(CaseListItemProjection projection) {
        return new CaseListItemResponse(
            projection.caseId(),
            projection.caseNo(),
            projection.applicantName(),
            CaseStatusLabel.fromCode(projection.status()),
            projection.submittedAt()
        );
    }
}
```

### 12.1 Cocok Jika

- listing/search/reporting;
- data berasal dari join besar;
- domain aggregate tidak perlu dimuat;
- performance penting;
- read model berbeda dari write model;
- ingin menghindari lazy loading.

### 12.2 Risiko

Projection mapper tidak boleh berisi business invariant write-side. Ia hanya membentuk read contract.

---

## 13. Mapper Ownership

Pertanyaan penting:

> Siapa pemilik mapper?

Jawaban tergantung boundary.

| Source | Target | Pemilik Ideal |
|---|---|---|
| API Request DTO | Command | API/interface adapter |
| Application Result | API Response DTO | API/interface adapter |
| Command | Domain Intent | Application layer |
| Domain | JPA Entity | Persistence adapter |
| JPA Entity | Domain | Persistence adapter |
| External API DTO | Internal model | Integration adapter / ACL |
| Domain | Event DTO | Event publishing adapter/application layer |
| Projection | Response DTO | Query/read adapter |
| XML payload | Internal command | XML integration adapter |
| Internal model | External API request | Integration adapter |

Prinsip:

> Mapper dimiliki oleh boundary yang paling tahu source/target contract tanpa membuat inner layer bergantung pada outer detail.

---

## 14. Package Structure Strategy

### 14.1 Struktur Sederhana per Feature

```text
com.example.case
  ├── api
  │   ├── CaseController.java
  │   ├── dto
  │   │   ├── CreateCaseRequest.java
  │   │   └── CaseResponse.java
  │   └── mapper
  │       └── CaseApiMapper.java
  ├── application
  │   ├── CreateCaseCommand.java
  │   ├── CaseApplicationService.java
  │   └── mapper
  │       └── CaseCommandMapper.java
  ├── domain
  │   ├── Case.java
  │   ├── CaseId.java
  │   └── CaseStatus.java
  └── persistence
      ├── CaseEntity.java
      ├── CaseJpaRepository.java
      └── mapper
          └── CasePersistenceMapper.java
```

Kelebihan:

- cohesive per feature;
- mudah menemukan mapping terkait fitur;
- mengurangi god mapper global.

### 14.2 Struktur Hexagonal

```text
com.example.case
  ├── domain
  ├── application
  │   ├── port
  │   │   ├── in
  │   │   └── out
  │   └── service
  ├── adapter
  │   ├── in
  │   │   └── rest
  │   │       ├── dto
  │   │       └── mapper
  │   └── out
  │       ├── persistence
  │       │   ├── entity
  │       │   └── mapper
  │       └── identityprovider
  │           ├── dto
  │           └── mapper
```

Kelebihan:

- boundary sangat jelas;
- external adapter tidak mencemari domain;
- cocok untuk sistem integrasi kompleks.

### 14.3 Struktur Layered Tradisional

```text
com.example
  ├── controller
  ├── dto
  ├── mapper
  ├── service
  ├── entity
  └── repository
```

Ini umum, tapi ada risiko:

- folder `mapper` menjadi tempat semua mapping;
- ownership tidak jelas;
- mapper lintas layer gampang tercampur;
- `dto` global menjadi dumping ground.

Jika memakai struktur ini, minimal gunakan naming yang kuat:

```text
mapper
  ├── api
  ├── persistence
  ├── integration
  └── event
```

---

## 15. Naming Strategy untuk Mapper

Nama mapper harus menunjukkan boundary, bukan hanya entity name.

### 15.1 Kurang Informatif

```text
UserMapper
CaseMapper
ApplicationMapper
CommonMapper
DtoMapper
EntityMapper
```

Masalah:

- tidak jelas source/target;
- mudah berubah jadi god mapper;
- dipakai lintas boundary.

### 15.2 Lebih Informatif

```text
CaseApiMapper
CaseCommandMapper
CasePersistenceMapper
CaseEventMapper
IdentityProviderMapper
CustomerAntiCorruptionMapper
CaseListProjectionMapper
PaymentGatewayRequestMapper
PaymentGatewayResponseMapper
```

Nama yang baik menjawab:

1. Boundary apa?
2. Source/target apa?
3. Ownership-nya di layer mana?
4. Apakah ini mapping internal atau external?

---

## 16. God Mapper Anti-Pattern

### 16.1 Contoh

```java
@Component
public class CaseMapper {

    public CaseResponse toResponse(CaseEntity entity) { ... }

    public CaseEntity toEntity(CreateCaseRequest request) { ... }

    public CaseCreatedEvent toEvent(CaseEntity entity) { ... }

    public ExternalCaseRequest toExternal(CaseEntity entity) { ... }

    public CaseSummaryDto toSummary(CaseEntity entity) { ... }

    public CaseSearchIndexDocument toSearchDocument(CaseEntity entity) { ... }
}
```

Mapper ini tampak praktis, tapi secara arsitektur buruk.

### 16.2 Masalah

- API mapping, persistence mapping, event mapping, dan external mapping tercampur.
- Entity menjadi sumber semua bentuk data.
- Perubahan entity berdampak luas.
- Testing sulit difokuskan.
- Ownership tidak jelas.
- Boundary hilang.
- Mapper menjadi tempat logic acak.

### 16.3 Refactor

```text
CaseApiMapper
CasePersistenceMapper
CaseEventMapper
CaseExternalGatewayMapper
CaseSearchIndexMapper
CaseSummaryProjectionMapper
```

Setiap mapper punya satu alasan berubah.

---

## 17. Shared Mapper: Kapan Boleh dan Kapan Berbahaya?

Shared mapper menggoda karena mengurangi duplikasi.

Contoh:

```java
AddressDto toAddressDto(Address address)
```

Ini mungkin aman jika Address DTO memang shared contract.

Tapi sering berbahaya:

```text
Applicant Address Response
Billing Address Response
Registered Address External Payload
Internal Postal Address
```

Semua terlihat mirip, tapi maknanya bisa berbeda.

### 17.1 Shared Mapper Aman Jika

- source/target benar-benar value object stabil;
- tidak membawa policy boundary tertentu;
- tidak ada field sensitif berbeda per context;
- tidak ada versioning berbeda;
- owner-nya jelas;
- dipakai untuk primitive/value conversion, bukan business mapping.

Contoh aman:

```java
public final class DateTimeMappingSupport {
    public String toIsoOffsetDateTime(OffsetDateTime value) { ... }
}
```

Atau:

```java
public final class MoneyMappingSupport {
    public MoneyDto toDto(Money money) { ... }
}
```

### 17.2 Shared Mapper Berbahaya Jika

- digunakan oleh API, event, persistence, dan integration sekaligus;
- ada conditional field visibility;
- ada role-based masking;
- ada version-specific behavior;
- source/target punya nama mirip tapi makna berbeda;
- perubahan satu consumer memengaruhi consumer lain.

Prinsip:

> Reuse conversion primitives, not boundary decisions.

---

## 18. Mapper dan Service Dependency

Pertanyaan klasik:

> Bolehkah mapper memanggil service/repository?

Jawaban matang:

> Boleh sangat terbatas, tetapi default-nya jangan. Mapper sebaiknya deterministic dan side-effect free.

### 18.1 Mapper Ideal

Mapper ideal:

- pure atau near-pure function;
- tidak melakukan I/O;
- tidak call database;
- tidak call remote service;
- tidak membuat transaction;
- tidak publish event;
- tidak baca security context global secara tersembunyi;
- output ditentukan oleh input.

Contoh baik:

```java
CaseResponse toResponse(CaseResult result);
```

### 18.2 Mapper yang Mulai Berbahaya

```java
@Component
public class CaseMapper {

    private final UserRepository userRepository;
    private final PermissionService permissionService;

    public CaseResponse toResponse(CaseEntity entity) {
        User user = userRepository.findById(entity.getCreatedBy()).orElseThrow();
        boolean canApprove = permissionService.canApprove(entity.getId());
        return ...;
    }
}
```

Masalah:

- mapping memicu query tersembunyi;
- N+1 problem;
- sulit dites;
- sulit diprediksi;
- mapping tidak lagi sekadar translation;
- response building tergantung environment.

### 18.3 Alternatif Lebih Baik

Application/query service mengumpulkan data, mapper hanya membentuk output.

```java
public CaseResponse getCase(String id) {
    CaseDetailProjection projection = queryRepository.findDetail(id);
    PermissionView permission = permissionService.getPermissionView(id);
    return mapper.toResponse(projection, permission);
}
```

Mapper:

```java
public CaseResponse toResponse(CaseDetailProjection projection, PermissionView permission) {
    return new CaseResponse(
        projection.caseId(),
        projection.caseNo(),
        projection.status(),
        permission.canApprove(),
        permission.canReject()
    );
}
```

Mapper tetap deterministic karena semua input eksplisit.

---

## 19. Contextual Mapping

Kadang mapping butuh context:

- current user;
- tenant;
- locale;
- timezone;
- permission view;
- feature flag;
- API version;
- correlation id;
- redaction mode;
- request source.

Jangan sembunyikan context dalam mapper.

### 19.1 Buruk

```java
public CaseResponse toResponse(Case domain) {
    User currentUser = SecurityContextHolder.getCurrentUser();
    ZoneId zone = TenantContext.currentZone();
    ...
}
```

### 19.2 Lebih Baik

```java
public CaseResponse toResponse(Case domain, MappingContext context) {
    return new CaseResponse(
        domain.id().value(),
        domain.status().name(),
        formatDate(domain.createdAt(), context.zoneId()),
        maskIfNeeded(domain.applicantName(), context.redactionMode())
    );
}
```

Context eksplisit membuat mapper:

- lebih testable;
- lebih mudah dipahami;
- lebih aman dari hidden dependency;
- lebih cocok untuk batch/replay;
- lebih mudah diaudit.

### 19.3 MappingContext Jangan Menjadi Service Locator

Buruk:

```java
public record MappingContext(
    UserRepository userRepository,
    PermissionService permissionService,
    ExternalClient externalClient
) {}
```

Ini hanya memindahkan dependency tersembunyi ke object lain.

Baik:

```java
public record MappingContext(
    ZoneId zoneId,
    Locale locale,
    RedactionMode redactionMode,
    ApiVersion apiVersion
) {}
```

Context sebaiknya berisi value, bukan service.

---

## 20. Mapper as Policy Boundary

Tidak semua mapping hanya technical. Sebagian mapping adalah policy.

Contoh response untuk internal officer:

```json
{
  "caseId": "C-001",
  "applicantName": "John Tan",
  "identityNo": "S1234567D"
}
```

Response untuk public user:

```json
{
  "caseId": "C-001",
  "applicantName": "John Tan",
  "identityNo": "S****567D"
}
```

Ini bukan hanya formatting. Ini policy redaction.

### 20.1 Di Mana Policy Mapping Diletakkan?

Pilihan yang umum:

1. Di API mapper, jika policy spesifik response.
2. Di application service, jika policy butuh authorization decision.
3. Di dedicated presentation policy component, jika kompleks.
4. Jangan di entity/domain jika policy tergantung consumer/channel.

Contoh:

```java
public CaseResponse toOfficerResponse(CaseDetailView view) { ... }

public CaseResponse toPublicResponse(CaseDetailView view) { ... }
```

Atau:

```java
public CaseResponse toResponse(CaseDetailView view, RedactionPolicy policy) { ... }
```

### 20.2 Hindari Boolean Parameter Kabur

Buruk:

```java
mapper.toResponse(caseDetail, true);
```

Lebih baik:

```java
mapper.toResponse(caseDetail, RedactionMode.PUBLIC_USER);
```

Atau:

```java
mapper.toPublicUserResponse(caseDetail);
mapper.toOfficerResponse(caseDetail);
```

---

## 21. Mapping dan Authorization

Mapper tidak boleh menjadi authorization engine.

Buruk:

```java
public CaseResponse toResponse(Case domain) {
    if (securityService.hasRole("ADMIN")) {
        return fullResponse(domain);
    }
    return maskedResponse(domain);
}
```

Kenapa buruk?

- authorization tersembunyi di mapping;
- sulit audit;
- sulit test semua permission path;
- API behavior tidak jelas;
- mapper butuh security service.

Lebih baik:

```java
AccessDecision decision = authorizationService.evaluateCaseAccess(user, caseId);
CaseDetailView view = queryService.getCaseDetail(caseId, decision.allowedFields());
return mapper.toResponse(view, decision.redactionMode());
```

Mapper menerapkan shape/redaction berdasarkan decision yang sudah dibuat eksplisit.

---

## 22. Mapping dan Validation

Mapping tidak sama dengan validation, tetapi keduanya berdekatan.

```text
Deserialize JSON -> Validate DTO -> Map to Command -> Enforce Domain Invariant
```

### 22.1 Yang Boleh di Mapper

- trim string;
- normalize code case;
- convert date format;
- map external enum;
- convert empty string to null jika policy eksplisit;
- default technical value jika aman dan terdokumentasi.

### 22.2 Yang Sebaiknya Bukan di Mapper

- memutuskan apakah user boleh approve;
- memutuskan case bisa transition status;
- menghitung penalti bisnis kompleks;
- mengecek uniqueness ke database;
- validasi cross-aggregate;
- memutuskan workflow next state.

Mapper boleh membantu membentuk input untuk rule, tapi rule-nya sebaiknya tidak tersembunyi di mapper.

---

## 23. Mapping dan Transaction Boundary

Mapper idealnya tidak mengatur transaction.

Buruk:

```java
@Transactional
public CaseEntity toEntity(CreateCaseRequest request) {
    ...
}
```

Mapper tidak seharusnya menjadi transaction boundary.

Transaction biasanya berada di application service:

```java
@Transactional
public CaseResult createCase(CreateCaseCommand command) {
    Case caseAggregate = Case.open(command.toIntent());
    repository.save(caseAggregate);
    return mapper.toResult(caseAggregate);
}
```

Jika mapping butuh lazy association, itu tanda fetch plan atau projection perlu diperbaiki, bukan mapper diberi transaction.

---

## 24. Mapping dan Lazy Loading

Salah satu bug paling mahal di Java enterprise adalah mapper yang tidak sadar lazy loading.

Contoh:

```java
public CaseResponse toResponse(CaseEntity entity) {
    return new CaseResponse(
        entity.getId(),
        entity.getApplicant().getName(),
        entity.getDocuments().stream().map(...).toList()
    );
}
```

Risiko:

- `LazyInitializationException` jika session sudah tutup;
- N+1 query jika session masih terbuka;
- response accidentally memuat graph besar;
- performance tidak predictable.

### 24.1 Solusi

Gunakan explicit fetch plan atau projection:

```java
@Query("""
    select new com.example.case.CaseDetailProjection(
        c.id,
        c.caseNo,
        a.name,
        c.status
    )
    from CaseEntity c
    join c.applicant a
    where c.id = :id
""")
Optional<CaseDetailProjection> findDetail(String id);
```

Mapper kemudian memakai projection, bukan entity graph besar.

```java
public CaseResponse toResponse(CaseDetailProjection p) {
    return new CaseResponse(p.id(), p.caseNo(), p.applicantName(), p.status());
}
```

---

## 25. Mapper Granularity

Pertanyaan:

> Mapper dibuat per entity, per DTO, per use case, atau per boundary?

Jawaban:

> Default terbaik untuk sistem besar adalah per boundary/use-case cluster, bukan per entity global.

### 25.1 Per Entity Mapper

```text
UserMapper
CaseMapper
DocumentMapper
```

Cocok untuk CRUD sederhana.

Risiko:

- jadi god mapper;
- dipakai semua layer;
- ownership kabur.

### 25.2 Per Boundary Mapper

```text
CaseApiMapper
CasePersistenceMapper
CaseEventMapper
```

Lebih baik untuk enterprise.

### 25.3 Per Use Case Mapper

```text
CreateCaseMapper
ApproveCaseMapper
CaseDetailResponseMapper
CaseListingMapper
```

Cocok jika:

- use case kompleks;
- request/response shape berbeda jauh;
- mapping punya policy khusus;
- module besar.

### 25.4 Rule of Thumb

Mulai dengan boundary mapper. Pecah menjadi use-case mapper saat:

- file mapper terlalu besar;
- mapping banyak conditional;
- satu mapper punya banyak alasan berubah;
- test mapper terlalu banyak scenario tidak terkait;
- API versioning mulai berbeda.

---

## 26. DTO Boundary Matrix

Gunakan matrix ini untuk menentukan mapper.

| Boundary | Source | Target | Mapper Name | Layer |
|---|---|---|---|---|
| REST Inbound | CreateCaseRequest | CreateCaseCommand | CaseApiMapper | Interface |
| REST Outbound | CaseResult | CaseResponse | CaseApiMapper | Interface |
| Use Case | CreateCaseCommand | OpenCaseIntent | CaseCommandMapper | Application |
| Persistence Save | Case | CaseEntity | CasePersistenceMapper | Infrastructure |
| Persistence Load | CaseEntity | Case | CasePersistenceMapper | Infrastructure |
| Query | CaseListProjection | CaseListItemResponse | CaseListResponseMapper | Interface/Query adapter |
| External Inbound | ProviderResponse | VerifiedIdentity | IdentityProviderMapper | Integration adapter |
| External Outbound | PaymentInstruction | PaymentGatewayRequest | PaymentGatewayMapper | Integration adapter |
| Event Publish | Case | CaseCreatedEvent | CaseEventMapper | Application/Event adapter |
| Audit | DomainAction | AuditRecord | AuditMapper | Application/Infrastructure |

---

## 27. Mapper Design Decision Tree

Gunakan decision tree ini.

```text
Apakah source dan target berada di boundary berbeda?
  |
  +-- Tidak
  |     |
  |     +-- Apakah hanya helper conversion kecil?
  |           |
  |           +-- Ya: shared conversion helper boleh
  |           +-- Tidak: pertanyakan kenapa perlu mapping
  |
  +-- Ya
        |
        +-- Apakah salah satunya external system/API?
        |     |
        |     +-- Ya: tempatkan di adapter/anti-corruption layer
        |
        +-- Apakah salah satunya persistence entity?
        |     |
        |     +-- Ya: tempatkan di persistence adapter
        |
        +-- Apakah salah satunya API request/response?
        |     |
        |     +-- Ya: tempatkan di interface/API adapter
        |
        +-- Apakah mapping butuh use case context?
              |
              +-- Ya: application mapper/orchestrator
```

---

## 28. Common Architecture Smells

### 28.1 Entity as API Contract

```java
@GetMapping("/{id}")
public CaseEntity get(@PathVariable String id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

- field internal bocor;
- lazy graph bisa ikut terserialisasi;
- schema DB menjadi API contract;
- security risk;
- compatibility buruk.

### 28.2 Request DTO to Entity Directly

```java
CaseEntity entity = objectMapper.convertValue(request, CaseEntity.class);
```

Masalah:

- over-posting;
- attacker bisa mengisi field yang seharusnya server-controlled;
- default ambiguity;
- invariant dilewati;
- entity lifecycle rusak.

### 28.3 Generic Reflection Mapper Everywhere

```java
modelMapper.map(source, Target.class);
```

Masalah:

- mapping implicit;
- runtime error;
- field rename silent bug;
- sulit audit;
- performance tidak jelas;
- semantic mismatch tidak terlihat.

### 28.4 Mapper Calls Repository in Loop

```java
for (CaseEntity entity : cases) {
    responses.add(mapper.toResponse(entity)); // mapper calls userRepository internally
}
```

Masalah:

- N+1 query;
- hidden I/O;
- performance collapse.

### 28.5 Domain Depends on API DTO

```java
public void submit(SubmitCaseRequest request) { ... }
```

Masalah:

- domain berubah karena API berubah;
- sulit reuse domain untuk batch/message listener;
- delivery mechanism bocor.

### 28.6 One DTO for Everything

```java
CaseDto used for request, response, entity mapping, event, export
```

Masalah:

- field required di satu context optional di context lain;
- security rules beda;
- versioning mustahil bersih;
- kontrak saling mengunci.

---

## 29. Architecture Example: Case Management Service

Kita gunakan contoh domain case management.

### 29.1 API Request

```java
public record CreateCaseRequest(
    String applicantId,
    String caseType,
    String description,
    List<String> attachmentIds
) {}
```

### 29.2 Application Command

```java
public record CreateCaseCommand(
    String applicantId,
    String caseTypeCode,
    String description,
    List<String> attachmentIds,
    String requestedBy
) {}
```

### 29.3 Domain Intent

```java
public record OpenCaseIntent(
    ApplicantId applicantId,
    CaseType caseType,
    CaseDescription description,
    List<DocumentId> attachmentIds,
    Actor actor
) {}
```

### 29.4 Domain Aggregate

```java
public final class Case {

    private final CaseId id;
    private CaseStatus status;
    private final ApplicantId applicantId;
    private final CaseType caseType;
    private final CaseDescription description;

    private Case(
        CaseId id,
        CaseStatus status,
        ApplicantId applicantId,
        CaseType caseType,
        CaseDescription description
    ) {
        this.id = id;
        this.status = status;
        this.applicantId = applicantId;
        this.caseType = caseType;
        this.description = description;
    }

    public static Case open(OpenCaseIntent intent) {
        return new Case(
            CaseId.newId(),
            CaseStatus.DRAFT,
            intent.applicantId(),
            intent.caseType(),
            intent.description()
        );
    }
}
```

### 29.5 Persistence Entity

```java
@Entity
@Table(name = "case")
public class CaseEntity {

    @Id
    private String id;

    private String applicantId;
    private String caseTypeCode;
    private String status;

    @Column(length = 4000)
    private String description;

    private Instant createdAt;
    private Instant updatedAt;

    // getters/setters
}
```

### 29.6 API Mapper

```java
@Component
public class CaseApiMapper {

    public CreateCaseCommand toCommand(CreateCaseRequest request, String currentUserId) {
        return new CreateCaseCommand(
            request.applicantId(),
            request.caseType(),
            request.description(),
            List.copyOf(request.attachmentIds()),
            currentUserId
        );
    }

    public CaseResponse toResponse(CaseResult result) {
        return new CaseResponse(
            result.caseId(),
            result.caseNo(),
            result.status(),
            result.createdAt()
        );
    }
}
```

Untuk Java 8, `List.copyOf` belum ada. Gunakan:

```java
Collections.unmodifiableList(new ArrayList<>(request.getAttachmentIds()))
```

### 29.7 Command Mapper

```java
@Component
public class CaseCommandMapper {

    public OpenCaseIntent toIntent(CreateCaseCommand command) {
        return new OpenCaseIntent(
            ApplicantId.of(command.applicantId()),
            CaseType.of(command.caseTypeCode()),
            CaseDescription.of(command.description()),
            command.attachmentIds().stream()
                .map(DocumentId::of)
                .toList(),
            Actor.of(command.requestedBy())
        );
    }
}
```

Untuk Java 8:

```java
command.getAttachmentIds().stream()
    .map(DocumentId::of)
    .collect(Collectors.toList())
```

### 29.8 Persistence Mapper

```java
@Component
public class CasePersistenceMapper {

    public CaseEntity toEntity(Case domain) {
        CaseEntity entity = new CaseEntity();
        entity.setId(domain.id().value());
        entity.setApplicantId(domain.applicantId().value());
        entity.setCaseTypeCode(domain.caseType().code());
        entity.setStatus(domain.status().name());
        entity.setDescription(domain.description().value());
        return entity;
    }

    public Case toDomain(CaseEntity entity) {
        return Case.rehydrate(
            CaseId.of(entity.getId()),
            ApplicantId.of(entity.getApplicantId()),
            CaseType.of(entity.getCaseTypeCode()),
            CaseStatus.valueOf(entity.getStatus()),
            CaseDescription.of(entity.getDescription())
        );
    }
}
```

### 29.9 Event Mapper

```java
@Component
public class CaseEventMapper {

    public CaseCreatedEvent toEvent(Case domain, CorrelationContext context) {
        return new CaseCreatedEvent(
            domain.id().value(),
            domain.applicantId().value(),
            domain.caseType().code(),
            domain.status().name(),
            context.correlationId(),
            Instant.now(),
            1
        );
    }
}
```

### 29.10 Architecture Flow

```text
CreateCaseRequest
      |
      v
CaseApiMapper
      |
      v
CreateCaseCommand
      |
      v
CaseCommandMapper
      |
      v
OpenCaseIntent
      |
      v
Case.open(intent)
      |
      v
Case Aggregate
      |
      +-----------------------+
      |                       |
      v                       v
CasePersistenceMapper     CaseEventMapper
      |                       |
      v                       v
CaseEntity              CaseCreatedEvent
```

Setiap mapper punya boundary dan ownership jelas.

---

## 30. Mapping in Modular Monolith

Dalam modular monolith, mapping membantu menjaga module boundary.

Contoh modules:

```text
case-management
applicant-profile
document-management
payment
notification
```

Jangan sembarang import entity antar module.

Buruk:

```java
case-management imports applicant-profile.entity.ApplicantEntity
```

Lebih baik:

```java
case-management uses ApplicantProfilePort
case-management receives ApplicantSnapshot
```

Mapper berada di adapter yang menghubungkan module.

```java
public class ApplicantProfileAdapterMapper {
    public ApplicantSnapshot toSnapshot(ApplicantProfileDto dto) { ... }
}
```

Prinsip:

> Internal model satu module tidak boleh menjadi public model module lain.

---

## 31. Mapping in Microservices

Di microservices, mapping lebih penting karena network payload adalah contract.

### 31.1 Jangan Share Entity Library

Buruk:

```text
common-model.jar contains UserEntity, CaseEntity, PaymentEntity
```

Service A dan B memakai entity yang sama.

Masalah:

- tight coupling;
- independent deployment hilang;
- schema change menyebar;
- service boundary palsu.

### 31.2 Share Contract dengan Hati-Hati

Boleh share:

- generated client dari OpenAPI/AsyncAPI;
- protobuf schema;
- small stable value object;
- error code enum yang governance-nya jelas.

Tapi internal entity/domain tetap tidak dishare.

### 31.3 External Contract Mapper

```text
Internal Domain -> Public API DTO
Internal Domain -> Event Contract DTO
External Service DTO -> Internal Model
```

Microservice yang sehat biasanya punya banyak mapper boundary, bukan satu common mapper library besar.

---

## 32. Mapping Versioning Architecture

Saat API punya versi:

```text
/v1/cases
/v2/cases
```

Jangan paksa satu mapper menangani semua versi dengan conditional acak.

Buruk:

```java
public CaseResponse toResponse(Case domain, int version) {
    if (version == 1) { ... }
    else if (version == 2) { ... }
}
```

Lebih baik:

```text
CaseV1ApiMapper
CaseV2ApiMapper
```

Atau:

```text
v1/mapper/CaseApiMapper
v2/mapper/CaseApiMapper
```

### 32.1 Kapan Mapper Bisa Shared Antar Versi?

Jika mapping benar-benar identik dan field semantics sama. Tetapi untuk public API, hati-hati: perubahan kecil bisa menjadi breaking change.

### 32.2 Version-Specific DTO

```java
package com.example.case.api.v1.dto;
public record CaseResponse(...) {}

package com.example.case.api.v2.dto;
public record CaseResponse(...) {}
```

Walaupun namanya sama, contract berbeda secara package.

---

## 33. Mapping dan Backward Compatibility

Backward compatibility bukan hanya urusan Jackson annotation. Mapper juga berperan.

Contoh field rename:

```json
// v1
{
  "caseStatus": "PENDING"
}

// v2
{
  "status": "PENDING_REVIEW"
}
```

Mapper harus menentukan:

- apakah status lama masih diterima?
- apakah response masih mengirim alias lama?
- bagaimana enum lama dipetakan ke enum baru?
- apakah unknown value ditolak atau menjadi UNKNOWN?
- apakah consumer lama masih bisa membaca event?

Mapping layer adalah tempat compatibility decision terlihat.

---

## 34. Mapping dan Auditability

Untuk sistem regulated/case management, mapping harus bisa diaudit.

Pertanyaan audit:

- Dari payload apa domain command dibuat?
- Field apa yang diabaikan?
- Field apa yang dinormalisasi?
- Field apa yang dimasking?
- Default apa yang diberikan sistem?
- External code apa yang diterjemahkan menjadi internal code?
- Mapping versi berapa yang digunakan?
- Apakah raw input disimpan?
- Apakah transformed value bisa direkonstruksi?

### 34.1 Audit-Friendly Mapper

Ciri-ciri:

- eksplisit;
- deterministic;
- testable;
- punya policy naming jelas;
- tidak banyak hidden dependency;
- error reporting jelas;
- version mapping terdokumentasi;
- tidak silent drop field penting.

---

## 35. Mapping Documentation

Mapper yang penting harus punya dokumentasi ringan.

Contoh di code comment:

```java
/**
 * Maps public CreateCaseRequest into internal CreateCaseCommand.
 *
 * Boundary policy:
 * - request.applicantId is accepted as external applicant identifier;
 * - server controls requestedBy from authenticated principal;
 * - request.status is intentionally not accepted to prevent over-posting;
 * - attachmentIds are defensively copied;
 * - description normalization is handled later in CaseDescription value object.
 */
public CreateCaseCommand toCommand(CreateCaseRequest request, String currentUserId) { ... }
```

Dokumentasi mapper bukan menjelaskan syntax. Ia menjelaskan **policy**.

---

## 36. MapStruct Placement Preview

Nanti di part MapStruct, kita akan bahas lebih detail. Tetapi dari sisi arsitektur:

MapStruct mapper tetap harus mengikuti boundary.

Buruk:

```java
@Mapper(componentModel = "spring")
public interface GlobalMapper {
    CaseResponse entityToResponse(CaseEntity entity);
    CaseEntity requestToEntity(CreateCaseRequest request);
    CaseCreatedEvent entityToEvent(CaseEntity entity);
}
```

Lebih baik:

```java
@Mapper(componentModel = "spring")
public interface CaseApiMapper {
    CreateCaseCommand toCommand(CreateCaseRequest request);
    CaseResponse toResponse(CaseResult result);
}

@Mapper(componentModel = "spring")
public interface CasePersistenceMapper {
    CaseEntity toEntity(Case domain);
    Case toDomain(CaseEntity entity);
}

@Mapper(componentModel = "spring")
public interface CaseEventMapper {
    CaseCreatedEvent toEvent(Case domain);
}
```

Tool tidak menggantikan arsitektur. MapStruct hanya mempercepat mapping yang boundary-nya sudah benar.

---

## 37. Jackson Placement Preview

Jackson sebaiknya berada di serialization boundary.

Idealnya:

```text
Jackson <-> API DTO
Jackson <-> External DTO
Jackson <-> Event DTO
```

Bukan:

```text
Jackson <-> Domain Aggregate
Jackson <-> JPA Entity
```

Tentu ada exception, tetapi default mental model:

> Domain model tidak perlu didesain berdasarkan kebutuhan JSON serializer.

Jika domain penuh annotation Jackson, tanyakan:

- apakah domain sedang menjadi API contract?
- apakah field internal bisa leak?
- apakah constructor domain dikompromikan demi deserialization?
- apakah invariant domain bisa dilewati?
- apakah polymorphic serialization aman?

---

## 38. Lombok Placement Preview

Lombok sering memengaruhi mapper karena menghasilkan getter, setter, constructor, builder.

Dari sisi architecture:

- Lombok di DTO bisa diterima jika convention jelas.
- Lombok `@Data` di entity/domain harus hati-hati.
- Lombok builder bisa membantu immutable DTO.
- Lombok generated setter bisa membuka mutability berlebihan.
- Lombok equals/hashCode bisa berbahaya untuk JPA entity.

Mapper placement tetap tidak boleh dikacaukan oleh kenyamanan Lombok.

Contoh buruk:

```java
@Data
@Entity
public class CaseEntity {
    @OneToMany(mappedBy = "case")
    private List<DocumentEntity> documents;
}
```

Risiko:

- generated `toString` memicu lazy loading;
- equals/hashCode melibatkan relationship;
- setter bebas merusak invariant;
- serialization bisa melebar.

---

## 39. Practical Checklist: Memilih Lokasi Mapper

Gunakan checklist ini saat review desain.

### 39.1 Boundary Checklist

- Apakah source dan target dimiliki layer berbeda?
- Apakah source/target bagian dari external contract?
- Apakah target boleh berubah jika source berubah?
- Apakah mapper mencegah model leak?
- Apakah mapping policy eksplisit?
- Apakah mapper punya satu alasan berubah?

### 39.2 Dependency Checklist

- Apakah domain bergantung pada DTO/API/entity eksternal?
- Apakah mapper membuat inner layer tahu outer layer?
- Apakah mapper memanggil repository/service tanpa perlu?
- Apakah mapper bisa dites tanpa Spring context?
- Apakah mapper deterministic?
- Apakah semua context penting menjadi parameter eksplisit?

### 39.3 Security Checklist

- Apakah request DTO bisa mengisi field server-controlled?
- Apakah response DTO mengekspos field internal/sensitif?
- Apakah redaction policy eksplisit?
- Apakah role/permission logic tersembunyi di mapper?
- Apakah entity langsung diserialisasi?

### 39.4 Performance Checklist

- Apakah mapper memicu lazy loading?
- Apakah mapper melakukan query tersembunyi?
- Apakah mapper dipanggil dalam loop besar?
- Apakah mapping collection defensively copied dengan tepat?
- Apakah projection lebih cocok daripada aggregate mapping?

### 39.5 Compatibility Checklist

- Apakah DTO version-specific?
- Apakah field rename/alias terdokumentasi?
- Apakah unknown enum behavior jelas?
- Apakah event payload stabil?
- Apakah mapping punya golden payload test?

---

## 40. Architecture Review Questions

Saat melakukan review PR, tanyakan:

1. Kenapa mapper ini berada di package/layer ini?
2. Siapa pemilik source model?
3. Siapa pemilik target model?
4. Apa yang terjadi jika API berubah?
5. Apa yang terjadi jika schema DB berubah?
6. Apa yang terjadi jika external provider mengubah payload?
7. Apakah domain ikut berubah karena outer contract?
8. Apakah mapper melakukan I/O?
9. Apakah mapper bisa menghasilkan output berbeda untuk input sama?
10. Apakah ada field yang sengaja tidak dimap?
11. Apakah field yang tidak dimap diuji?
12. Apakah ada default value tersembunyi?
13. Apakah mapper bisa menyebabkan data leak?
14. Apakah mapper bisa menyebabkan N+1 query?
15. Apakah mapper terlalu besar?
16. Apakah MapStruct/Jackson annotation menyembunyikan decision penting?
17. Apakah versioning jelas?
18. Apakah mapping bisa diaudit?

---

## 41. Exercise 1 — Tentukan Mapper Placement

Diberikan flow:

```text
POST /applications
  -> CreateApplicationRequest
  -> Application entity
  -> ApplicationSubmittedEvent
  -> ExternalNotificationRequest
```

Pertanyaan:

1. Mapper apa saja yang harus ada?
2. Di layer mana masing-masing mapper berada?
3. Apakah `CreateApplicationRequest` boleh langsung menjadi entity?
4. Apakah `ApplicationSubmittedEvent` boleh dibuat dari entity langsung?
5. Di mana redaction untuk external notification dilakukan?

Jawaban ideal:

```text
CreateApplicationRequest -> SubmitApplicationCommand
  Mapper: ApplicationApiMapper
  Layer: Interface/API

SubmitApplicationCommand -> SubmitApplicationIntent
  Mapper: ApplicationCommandMapper
  Layer: Application

Application aggregate -> ApplicationEntity
  Mapper: ApplicationPersistenceMapper
  Layer: Infrastructure persistence

Application aggregate/result -> ApplicationSubmittedEvent
  Mapper: ApplicationEventMapper
  Layer: Application/Event adapter

ApplicationSubmittedEvent/Internal notification model -> ExternalNotificationRequest
  Mapper: NotificationProviderMapper
  Layer: Integration adapter
```

Request DTO tidak langsung menjadi entity karena raw client input tidak boleh mengontrol persistence state. Event sebaiknya bukan entity serialization karena event adalah integration contract. Redaction untuk external notification berada di notification integration/application boundary, tergantung apakah policy membutuhkan authorization/context.

---

## 42. Exercise 2 — Refactor God Mapper

Awal:

```java
@Component
public class UserMapper {
    public UserResponse toResponse(UserEntity entity) { ... }
    public UserEntity toEntity(CreateUserRequest request) { ... }
    public UserCreatedEvent toEvent(UserEntity entity) { ... }
    public ExternalCrmUserRequest toCrmRequest(UserEntity entity) { ... }
    public UserSearchDocument toSearchDocument(UserEntity entity) { ... }
}
```

Refactor menjadi:

```text
UserApiMapper
UserPersistenceMapper
UserEventMapper
CrmUserMapper
UserSearchIndexMapper
```

Lalu evaluasi apakah `UserEntity` harus menjadi source semua mapper. Mungkin lebih baik:

```text
User aggregate -> UserEventMapper
UserReadProjection -> UserApiMapper
User aggregate/UserSnapshot -> CrmUserMapper
UserSearchProjection -> UserSearchIndexMapper
```

Ini mengurangi coupling ke persistence entity.

---

## 43. Exercise 3 — Hidden Dependency Detection

Kode:

```java
@Component
public class OrderResponseMapper {

    private final UserRepository userRepository;
    private final CurrencyService currencyService;

    public OrderResponse toResponse(OrderEntity order) {
        UserEntity user = userRepository.findById(order.getUserId()).orElseThrow();
        String formattedAmount = currencyService.format(order.getAmount(), order.getCurrency());

        return new OrderResponse(
            order.getId(),
            user.getDisplayName(),
            formattedAmount
        );
    }
}
```

Masalah:

- mapper call repository;
- mapper call service;
- hidden N+1 risk;
- output tergantung service;
- mapper sulit dites;
- application/query service kehilangan kontrol fetch plan.

Refactor:

```java
public record OrderDetailView(
    String orderId,
    String userDisplayName,
    BigDecimal amount,
    String currency
) {}

public record AmountDisplay(
    String formatted
) {}

public OrderResponse getOrder(String orderId) {
    OrderDetailView view = orderQueryRepository.findDetail(orderId);
    AmountDisplay amountDisplay = currencyFormatter.format(view.amount(), view.currency());
    return mapper.toResponse(view, amountDisplay);
}
```

Mapper:

```java
public OrderResponse toResponse(OrderDetailView view, AmountDisplay amountDisplay) {
    return new OrderResponse(
        view.orderId(),
        view.userDisplayName(),
        amountDisplay.formatted()
    );
}
```

---

## 44. Key Takeaways

1. Mapper adalah boundary translator, bukan util copy field.
2. Mapper placement harus mengikuti ownership source/target.
3. Inner layer tidak boleh tahu outer DTO/entity/external payload.
4. API mapper dimiliki interface adapter.
5. Persistence mapper dimiliki infrastructure/persistence adapter.
6. External mapper dimiliki integration adapter/anti-corruption layer.
7. Event mapper harus memperlakukan event sebagai contract, bukan entity snapshot.
8. Shared mapper hanya aman untuk conversion primitive/value object yang stabil.
9. Mapper idealnya deterministic dan tidak melakukan I/O.
10. Context mapping harus eksplisit, bukan hidden global lookup.
11. Authorization decision tidak boleh tersembunyi dalam mapper.
12. Mapper tidak boleh menjadi transaction boundary.
13. JPA lazy loading harus dipikirkan sebelum entity dimap ke response.
14. Versioned API/event sering perlu versioned mapper.
15. Tool seperti Jackson, MapStruct, dan Lombok tidak menggantikan keputusan arsitektur.

---

## 45. Practical Heuristic

Gunakan kalimat ini saat ragu:

> Mapper harus berada di sisi boundary yang paling luar yang mengetahui dua model tersebut, tanpa membuat model yang lebih dalam bergantung pada detail yang lebih luar.

Contoh:

- API DTO ke command: API adapter tahu keduanya, domain tidak perlu tahu API DTO.
- Entity ke domain: persistence adapter tahu entity dan domain, domain tidak perlu tahu entity.
- External DTO ke internal model: integration adapter tahu external DTO dan internal contract, domain tidak perlu tahu provider.
- Domain ke event: event adapter/application tahu domain dan event contract, entity tidak perlu ikut.

---

## 46. Penutup

Pada part sebelumnya, kita belajar manual mapping sebagai baseline. Pada part ini, kita naik satu level: **bukan hanya bagaimana menulis mapper, tetapi di mana mapper hidup dalam arsitektur sistem**.

Ini penting karena mapping yang salah tempat dapat menyebabkan:

- boundary bocor;
- domain terkontaminasi API/persistence/external contract;
- security leak;
- compatibility sulit;
- performance tidak terkendali;
- mapper menjadi god object;
- perubahan kecil menyebar lintas layer.

Setelah memahami placement dan dependency direction, barulah kita siap masuk ke Jackson dengan mental model yang benar: Jackson bukan sekadar JSON library, tetapi runtime serialization/deserialization engine yang harus ditempatkan secara tepat di boundary.

---

# Status Seri

**Part 5 selesai.**

Progress:

- [x] Part 0 — Orientation: Data Transformation as Software Boundary
- [x] Part 1 — Java Object Model for Mapping: Beans, Records, POJOs, Immutability
- [x] Part 2 — Transformation Taxonomy: Copy, Convert, Normalize, Enrich, Redact, Project
- [x] Part 3 — DTO Design: API DTO, Domain DTO, Persistence DTO, Event DTO
- [x] Part 4 — Manual Mapping: The Baseline Every Senior Engineer Must Master
- [x] Part 5 — Mapping Architecture: Mapper Placement, Ownership, and Dependency Direction
- [ ] Part 6 — Jackson Mental Model: Streaming, Tree Model, Data Binding

Seri **belum selesai**. Bagian berikutnya adalah **Part 6 — Jackson Mental Model: Streaming, Tree Model, Data Binding**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 4 — Manual Mapping: The Baseline Every Senior Engineer Must Master](./04-manual-mapping-baseline-every-senior-engineer-must-master.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 6 — Jackson Mental Model: Streaming, Tree Model, Data Binding](./06-jackson-mental-model-streaming-tree-model-data-binding.md)
