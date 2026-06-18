# Part 22 — MapStruct for Domain Boundaries: Entity DTO Event Projection

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `22-mapstruct-domain-boundaries-entity-dto-event-projection.md`  
> Status: Part 22 dari 35  
> Fokus: menggunakan MapStruct untuk menjaga boundary arsitektur, bukan sekadar memindahkan field.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas MapStruct dari sisi teknis: field mapping, nested mapping, collection mapping, update mapping, null strategy, qualifier, context, lifecycle hook, dan object factory.

Bagian ini naik satu level: **bagaimana MapStruct digunakan sebagai alat arsitektur**.

Target akhirnya bukan sekadar:

```java
UserDto toDto(UserEntity entity);
```

Target sebenarnya adalah:

```text
External Input
   -> Request DTO
   -> Command / Intent Model
   -> Domain Aggregate / Domain Service
   -> Persistence Entity
   -> Domain Event
   -> Read Model / Projection
   -> Response DTO / Integration Payload
```

Di setiap perpindahan bentuk, ada boundary. Di setiap boundary, ada risiko:

- field internal bocor ke API;
- entity persistence bocor ke client;
- request DTO langsung mengubah entity;
- event payload berubah mengikuti refactor internal;
- mapper diam-diam memanggil service dan menjadi business logic tersembunyi;
- domain model menjadi kompromi antara database, API, dan integration payload;
- MapStruct menjadi “auto copier” yang mempercepat coupling.

Part ini membahas cara memakai MapStruct untuk **memperjelas boundary**, bukan mengaburkannya.

---

## 2. Mental Model Utama: MapStruct Bukan Boundary, Mapper Design yang Menjadi Boundary

MapStruct hanyalah generator kode. Ia tidak tahu apakah class yang kamu mapping adalah:

- API request;
- API response;
- domain command;
- aggregate;
- JPA entity;
- integration payload;
- audit event;
- read model;
- cache model.

Yang membuat mapping sehat adalah desain manusia di atasnya.

Prinsipnya:

```text
MapStruct generates code.
Architecture decides meaning.
```

Jika arsitektur buruk, MapStruct mempercepat kerusakannya.

Contoh buruk:

```java
@Mapper(componentModel = "spring")
public interface UserMapper {
    UserEntity toEntity(UserRequest request);
    UserResponse toResponse(UserEntity entity);
}
```

Di permukaan ini terlihat rapi. Tetapi pertanyaannya:

- Apakah semua field request boleh menjadi field entity?
- Apakah client boleh mengirim `status`, `role`, `createdBy`, `verifiedAt`?
- Apakah semua field entity aman dikembalikan sebagai response?
- Apakah `UserEntity` adalah domain model atau persistence model?
- Apakah mapping ini bypass invariant domain?

Jika jawabannya tidak jelas, mapper ini adalah coupling accelerator.

Desain yang lebih defensif:

```java
@Mapper(componentModel = "spring")
public interface UserCommandMapper {
    RegisterUserCommand toCommand(RegisterUserRequest request);
}

@Mapper(componentModel = "spring")
public interface UserResponseMapper {
    UserResponse toResponse(UserView view);
}

@Mapper(componentModel = "spring")
public interface UserPersistenceMapper {
    UserEntity toEntity(UserAggregate aggregate);
    UserAggregate toAggregate(UserEntity entity);
}

@Mapper(componentModel = "spring")
public interface UserEventMapper {
    UserRegisteredEvent toEvent(UserAggregate aggregate);
}
```

Lebih banyak class, tetapi boundary lebih jelas.

---

## 3. Boundary yang Umum di Aplikasi Enterprise

Dalam aplikasi enterprise, terutama regulatory/case-management/workflow system, object biasanya bergerak melewati beberapa boundary.

### 3.1 API Boundary

Boundary antara client dan backend.

Contoh object:

```text
RegisterApplicationRequest
ApplicationSummaryResponse
ApplicationDetailResponse
ApplicationDecisionRequest
```

Karakteristik:

- stabil untuk consumer;
- harus aman dari over-posting;
- harus jelas required/nullable;
- tidak boleh mengekspos struktur entity internal;
- sering butuh versioning.

### 3.2 Application Boundary

Boundary antara delivery layer dan use case/application service.

Contoh object:

```text
SubmitApplicationCommand
ApproveApplicationCommand
SearchApplicationQuery
AssignCaseCommand
```

Karakteristik:

- merepresentasikan intent;
- lebih dekat ke use case daripada HTTP;
- tidak terikat JSON/XML;
- bisa mengandung actor/context/correlation;
- biasanya menjadi input application service.

### 3.3 Domain Boundary

Boundary di dalam domain model.

Contoh object:

```text
ApplicationAggregate
CaseAggregate
Decision
Assessment
EscalationPolicy
```

Karakteristik:

- menjaga invariant;
- tidak boleh dikendalikan langsung oleh DTO;
- tidak seharusnya penuh annotation API/persistence;
- perubahan domain tidak otomatis menjadi perubahan API.

### 3.4 Persistence Boundary

Boundary antara domain/application dan database.

Contoh object:

```text
ApplicationEntity
ApplicationDocumentEntity
CaseAssignmentEntity
AuditTrailEntity
```

Karakteristik:

- bentuknya dipengaruhi schema database;
- punya ID teknis, version, audit column;
- bisa memiliki lazy association/proxy;
- tidak selalu cocok dengan domain aggregate;
- tidak boleh langsung menjadi response API.

### 3.5 Event Boundary

Boundary antara domain/application dan event stream/audit/integration.

Contoh object:

```text
ApplicationSubmittedEvent
CaseAssignedEvent
ApplicationApprovedEvent
ComplianceFlagRaisedEvent
```

Karakteristik:

- harus stabil karena event mungkin disimpan lama;
- tidak boleh berubah hanya karena field entity rename;
- biasanya append-only;
- sering butuh event version;
- harus aman untuk downstream consumer.

### 3.6 Projection / Read Model Boundary

Boundary untuk query/read-optimized model.

Contoh object:

```text
ApplicationListingView
CaseQueueItemView
OfficerDashboardProjection
PendingApprovalProjection
```

Karakteristik:

- query-oriented;
- biasanya denormalized;
- tidak sama dengan aggregate;
- bisa berasal dari SQL projection, view, event projection, cache, search index;
- response API sering lebih cocok mapping dari projection daripada entity.

### 3.7 External Integration Boundary

Boundary dengan sistem luar.

Contoh object:

```text
ExternalApplicantPayload
LegacyLicenseStatusResponse
PaymentGatewayRequest
IdentityProviderProfile
```

Karakteristik:

- nama field bisa aneh;
- format tanggal bisa legacy;
- enum/code table berbeda;
- nullable/optional sering tidak konsisten;
- butuh anti-corruption layer.

---

## 4. Kenapa Entity ↔ DTO Langsung Sering Berbahaya

Mapping paling populer:

```java
UserDto toDto(UserEntity entity);
UserEntity toEntity(UserDto dto);
```

Ini tidak selalu salah, tetapi sering menjadi pintu coupling.

### 4.1 Entity Punya Field yang Tidak Boleh Diinput Client

Contoh entity:

```java
@Entity
public class OfficerEntity {
    @Id
    private UUID id;

    private String name;
    private String email;
    private String role;
    private boolean active;
    private boolean superAdmin;
    private Instant createdAt;
    private String createdBy;
    private Instant lastLoginAt;
    private long version;
}
```

Jika request DTO terlalu mirip:

```java
public class OfficerRequest {
    public String name;
    public String email;
    public String role;
    public Boolean active;
    public Boolean superAdmin;
}
```

Lalu mapper:

```java
@Mapper(componentModel = "spring")
public interface OfficerMapper {
    OfficerEntity toEntity(OfficerRequest request);
}
```

Risiko:

- client bisa mengirim `superAdmin = true`;
- client bisa mengubah role tanpa authorization policy;
- mapper melewati use case yang seharusnya memvalidasi transisi;
- field baru yang ditambahkan ke DTO/entity bisa otomatis termapping jika nama sama.

### 4.2 Entity Punya Field yang Tidak Boleh Keluar

Contoh:

```java
public class UserEntity {
    private UUID id;
    private String name;
    private String email;
    private String passwordHash;
    private String mfaSecret;
    private String resetToken;
    private Instant resetTokenExpiresAt;
}
```

Mapper buruk:

```java
UserResponse toResponse(UserEntity entity);
```

Jika response DTO suatu hari menambahkan field dengan nama sama, bisa terjadi leakage.

Top 1% engineer biasanya memilih desain deny-by-default:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface UserResponseMapper {

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "id", source = "id")
    @Mapping(target = "name", source = "name")
    @Mapping(target = "email", source = "email")
    UserResponse toResponse(UserEntity entity);
}
```

Dengan `ignoreByDefault = true`, field harus dipilih eksplisit. Ini cocok untuk response yang sensitif.

### 4.3 Entity Mengandung Persistence Semantics

Entity bukan hanya data.

Entity JPA punya:

- lazy proxy;
- dirty checking;
- persistence identity;
- cascade;
- orphan removal;
- bidirectional relationship;
- optimistic locking;
- audit column;
- database-driven lifecycle.

Saat entity dijadikan DTO, client tidak sengaja ikut melihat struktur persistence.

Contoh:

```java
ApplicationEntity
 ├── applicant
 ├── documents
 ├── assignments
 ├── decisions
 └── auditTrails
```

Response detail belum tentu perlu semua itu.

API mungkin butuh:

```java
ApplicationDetailResponse
 ├── applicationNo
 ├── applicantName
 ├── status
 ├── submittedAt
 ├── currentOfficerName
 └── allowedActions
```

Field `allowedActions` bahkan bukan field entity. Itu hasil policy/application state.

---

## 5. Request DTO → Command: Mapping Input Menjadi Intent

Request DTO adalah bentuk transport. Command adalah bentuk intent.

Contoh request:

```java
public record SubmitApplicationRequest(
    String applicantName,
    String applicantEmail,
    String postalCode,
    List<DocumentRequest> documents
) {}
```

Command:

```java
public record SubmitApplicationCommand(
    ActorId actorId,
    String applicantName,
    EmailAddress applicantEmail,
    PostalCode postalCode,
    List<SubmitDocumentCommand> documents,
    Instant requestedAt,
    CorrelationId correlationId
) {}
```

Perhatikan perbedaannya:

- request tidak punya actor;
- request tidak punya correlation id;
- request masih stringly-typed;
- command mulai membawa semantic type;
- command lebih dekat ke use case.

Mapper:

```java
@Mapper(componentModel = "spring", uses = DocumentCommandMapper.class)
public interface ApplicationCommandMapper {

    @Mapping(target = "actorId", source = "context.actorId")
    @Mapping(target = "requestedAt", source = "context.now")
    @Mapping(target = "correlationId", source = "context.correlationId")
    @Mapping(target = "applicantEmail", source = "request.applicantEmail")
    @Mapping(target = "postalCode", source = "request.postalCode")
    SubmitApplicationCommand toCommand(
        SubmitApplicationRequest request,
        @Context RequestMappingContext context
    );

    default EmailAddress mapEmail(String value) {
        return EmailAddress.parse(value);
    }

    default PostalCode mapPostalCode(String value) {
        return PostalCode.parse(value);
    }
}
```

Context:

```java
public record RequestMappingContext(
    ActorId actorId,
    Instant now,
    CorrelationId correlationId
) {}
```

Penting: context ini bukan tempat business decision kompleks. Ia hanya membawa metadata mapping.

### 5.1 Kenapa Command Lebih Aman daripada Request Langsung ke Entity

Request langsung ke entity:

```text
Client decides object state.
```

Request ke command:

```text
Client expresses intent.
Application decides state transition.
```

Ini perbedaan besar.

Contoh buruk:

```java
ApplicationEntity entity = mapper.toEntity(request);
entity.setStatus(request.status());
repository.save(entity);
```

Contoh lebih sehat:

```java
SubmitApplicationCommand command = commandMapper.toCommand(request, context);
ApplicationId id = submitApplicationUseCase.submit(command);
```

Di use case:

```java
public ApplicationId submit(SubmitApplicationCommand command) {
    ApplicationAggregate application = ApplicationAggregate.submit(
        command.actorId(),
        command.applicantName(),
        command.applicantEmail(),
        command.postalCode(),
        command.documents(),
        command.requestedAt()
    );

    repository.save(application);
    eventPublisher.publish(eventMapper.toSubmittedEvent(application));
    return application.id();
}
```

Mapper membantu membentuk intent, bukan memutuskan lifecycle.

---

## 6. Command → Domain: Biasanya Tidak Selalu MapStruct

Tidak semua mapping harus MapStruct.

Untuk command ke aggregate, sering lebih baik manual/factory karena domain invariant harus eksplisit.

Contoh:

```java
public final class ApplicationAggregate {

    public static ApplicationAggregate submit(
        ActorId submittedBy,
        Applicant applicant,
        List<Document> documents,
        Instant submittedAt
    ) {
        if (documents.isEmpty()) {
            throw new DomainException("Application must contain at least one document");
        }

        ApplicationAggregate aggregate = new ApplicationAggregate();
        aggregate.id = ApplicationId.newId();
        aggregate.status = ApplicationStatus.SUBMITTED;
        aggregate.applicant = applicant;
        aggregate.documents = DocumentSet.of(documents);
        aggregate.submittedBy = submittedBy;
        aggregate.submittedAt = submittedAt;
        aggregate.registerEvent(new ApplicationSubmitted(...));
        return aggregate;
    }
}
```

Menggunakan MapStruct untuk membuat aggregate secara langsung bisa berbahaya:

```java
ApplicationAggregate toAggregate(SubmitApplicationCommand command);
```

Karena MapStruct akan cenderung mengisi field, bukan menjalankan invariant.

Aturan praktis:

```text
DTO -> Command: MapStruct cocok.
Command -> Aggregate creation: factory/domain method lebih aman.
Aggregate -> Snapshot/Event/View: MapStruct bisa cocok.
Entity -> Aggregate rehydration: tergantung kompleksitas invariant.
```

---

## 7. Domain ↔ Persistence Entity

Ada dua model umum.

### 7.1 Model A: Entity JPA adalah Domain Model

Ini umum di Spring/JPA application sederhana.

```java
@Entity
public class Application {
    @Id
    private UUID id;
    private String applicationNo;
    @Enumerated(EnumType.STRING)
    private ApplicationStatus status;

    public void approve(OfficerId officerId, Instant now) {
        if (status != ApplicationStatus.SUBMITTED) {
            throw new IllegalStateException("Only submitted application can be approved");
        }
        this.status = ApplicationStatus.APPROVED;
        this.approvedBy = officerId.value();
        this.approvedAt = now;
    }
}
```

Dalam model ini, mapping persistence-domain tidak perlu karena entity adalah domain.

Namun tetap perlu mapping:

```text
Entity -> Response DTO
Request DTO -> Command
Entity -> Event
Entity -> Projection DTO
```

### 7.2 Model B: Domain Aggregate Terpisah dari Persistence Entity

Ini lebih umum pada domain kompleks atau sistem yang ingin domain bebas dari JPA.

```java
public class ApplicationAggregate {
    private ApplicationId id;
    private ApplicationNo applicationNo;
    private ApplicationStatus status;
    private Applicant applicant;
    private DocumentSet documents;
}
```

Persistence entity:

```java
@Entity
@Table(name = "APPLICATION")
public class ApplicationEntity {
    @Id
    private UUID id;

    @Column(name = "APPLICATION_NO")
    private String applicationNo;

    @Column(name = "STATUS")
    private String status;

    @Column(name = "APPLICANT_NAME")
    private String applicantName;

    @Column(name = "APPLICANT_EMAIL")
    private String applicantEmail;

    @OneToMany(mappedBy = "application", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ApplicationDocumentEntity> documents = new ArrayList<>();
}
```

Mapper:

```java
@Mapper(componentModel = "spring", uses = DocumentPersistenceMapper.class)
public interface ApplicationPersistenceMapper {

    @Mapping(target = "id", source = "id")
    @Mapping(target = "applicationNo", source = "applicationNo")
    @Mapping(target = "status", source = "status")
    @Mapping(target = "applicant", source = ".")
    @Mapping(target = "documents", source = "documents")
    ApplicationAggregate toAggregate(ApplicationEntity entity);

    @Mapping(target = "id", source = "id")
    @Mapping(target = "applicationNo", source = "applicationNo")
    @Mapping(target = "status", source = "status")
    @Mapping(target = "applicantName", source = "applicant.name")
    @Mapping(target = "applicantEmail", source = "applicant.email")
    @Mapping(target = "documents", source = "documents")
    ApplicationEntity toEntity(ApplicationAggregate aggregate);

    default ApplicationId map(UUID value) {
        return value == null ? null : new ApplicationId(value);
    }

    default UUID map(ApplicationId value) {
        return value == null ? null : value.value();
    }

    default ApplicationNo mapApplicationNo(String value) {
        return value == null ? null : new ApplicationNo(value);
    }

    default String map(ApplicationNo value) {
        return value == null ? null : value.value();
    }

    default ApplicationStatus mapStatus(String value) {
        return value == null ? null : ApplicationStatus.valueOf(value);
    }

    default String map(ApplicationStatus value) {
        return value == null ? null : value.name();
    }
}
```

### 7.3 Hati-hati Rehydration vs Creation

Entity ke aggregate bukan selalu sama dengan membuat aggregate baru.

```text
Creation:
- menjalankan invariant creation;
- generate ID;
- set initial status;
- emit domain event.

Rehydration:
- membangun kembali state dari database;
- tidak generate ID baru;
- tidak emit event;
- tidak menjalankan lifecycle creation.
```

Jika domain aggregate punya factory berbeda:

```java
ApplicationAggregate.submit(...)
ApplicationAggregate.rehydrate(...)
```

Maka mapper sebaiknya memanggil rehydrate, bukan constructor biasa.

Contoh dengan `@ObjectFactory` atau default method:

```java
@Mapper(componentModel = "spring")
public interface ApplicationPersistenceMapper {

    default ApplicationAggregate toAggregate(ApplicationEntity entity) {
        if (entity == null) {
            return null;
        }

        return ApplicationAggregate.rehydrate(
            new ApplicationId(entity.getId()),
            new ApplicationNo(entity.getApplicationNo()),
            ApplicationStatus.valueOf(entity.getStatus()),
            new Applicant(entity.getApplicantName(), EmailAddress.parse(entity.getApplicantEmail())),
            mapDocuments(entity.getDocuments())
        );
    }

    List<Document> mapDocuments(List<ApplicationDocumentEntity> entities);
}
```

Di sini manual method dalam mapper lebih benar daripada memaksa semua annotation MapStruct.

---

## 8. Aggregate / Entity → Response DTO

Response DTO adalah kontrak output. Jangan menganggap response adalah dump entity.

Contoh aggregate/entity:

```java
public class CaseEntity {
    private UUID id;
    private String caseNo;
    private String status;
    private String internalRiskScore;
    private String assignedOfficerId;
    private String assignedOfficerName;
    private Instant createdAt;
    private Instant updatedAt;
    private String internalRemarks;
}
```

Response listing:

```java
public record CaseListItemResponse(
    String caseNo,
    String status,
    String assignedOfficerName,
    Instant createdAt
) {}
```

Response detail:

```java
public record CaseDetailResponse(
    String caseNo,
    String status,
    String assignedOfficerName,
    Instant createdAt,
    Instant updatedAt,
    List<String> allowedActions
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface CaseResponseMapper {

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "caseNo", source = "caseNo")
    @Mapping(target = "status", source = "status")
    @Mapping(target = "assignedOfficerName", source = "assignedOfficerName")
    @Mapping(target = "createdAt", source = "createdAt")
    CaseListItemResponse toListItem(CaseEntity entity);

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "caseNo", source = "caseNo")
    @Mapping(target = "status", source = "status")
    @Mapping(target = "assignedOfficerName", source = "assignedOfficerName")
    @Mapping(target = "createdAt", source = "createdAt")
    @Mapping(target = "updatedAt", source = "updatedAt")
    @Mapping(target = "allowedActions", source = "allowedActions")
    CaseDetailResponse toDetail(CaseEntity entity, List<String> allowedActions);
}
```

Namun `allowedActions` biasanya bukan tanggung jawab mapper untuk menghitungnya.

Service/application layer:

```java
CaseEntity entity = caseRepository.getRequired(caseId);
List<String> allowedActions = casePolicy.allowedActionsFor(actor, entity);
return caseResponseMapper.toDetail(entity, allowedActions);
```

Mapper hanya menyusun response. Policy tetap di policy service/domain/application.

---

## 9. Projection Mapping: Jangan Paksa Semua Lewat Entity

Untuk query/listing/report/dashboard, sering lebih baik mengambil projection langsung dari database.

Contoh SQL projection:

```java
public interface CaseQueueProjection {
    String getCaseNo();
    String getStatus();
    String getApplicantName();
    String getAssignedOfficerName();
    Instant getLastActivityAt();
    Integer getPendingDays();
}
```

Response:

```java
public record CaseQueueItemResponse(
    String caseNo,
    String status,
    String applicantName,
    String assignedOfficerName,
    Instant lastActivityAt,
    Integer pendingDays
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface CaseQueueResponseMapper {
    CaseQueueItemResponse toResponse(CaseQueueProjection projection);
    List<CaseQueueItemResponse> toResponses(List<CaseQueueProjection> projections);
}
```

Kenapa ini bagus?

- tidak memuat aggregate besar;
- menghindari lazy loading storm;
- query shape sesuai response shape;
- response listing tidak tergantung struktur entity;
- performa lebih stabil.

### 9.1 Projection Bukan Domain Model

Projection hanya untuk read.

Jangan gunakan projection untuk command/update.

```text
Projection is a read shape.
Command is an intent shape.
Aggregate/entity is a state/change shape.
```

Jika projection dipakai untuk update, biasanya invariant akan bocor.

---

## 10. Aggregate / Entity → Event Payload

Event adalah kontrak jangka panjang. Event bukan entity snapshot mentah.

Contoh buruk:

```java
public record ApplicationSubmittedEvent(ApplicationEntity application) {}
```

Masalah:

- event membawa lazy relation;
- event berubah saat entity berubah;
- event bisa mengandung field internal;
- event sulit disimpan sebagai JSON stabil;
- downstream consumer tergantung entity internal.

Event yang lebih sehat:

```java
public record ApplicationSubmittedEventV1(
    String eventId,
    String eventType,
    int eventVersion,
    Instant occurredAt,
    String applicationId,
    String applicationNo,
    String applicantName,
    String applicantEmail,
    String submittedBy
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface ApplicationEventMapper {

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "eventId", source = "metadata.eventId")
    @Mapping(target = "eventType", constant = "APPLICATION_SUBMITTED")
    @Mapping(target = "eventVersion", constant = "1")
    @Mapping(target = "occurredAt", source = "metadata.occurredAt")
    @Mapping(target = "applicationId", source = "aggregate.id")
    @Mapping(target = "applicationNo", source = "aggregate.applicationNo")
    @Mapping(target = "applicantName", source = "aggregate.applicant.name")
    @Mapping(target = "applicantEmail", source = "aggregate.applicant.email")
    @Mapping(target = "submittedBy", source = "aggregate.submittedBy")
    ApplicationSubmittedEventV1 toSubmittedEvent(
        ApplicationAggregate aggregate,
        EventMetadata metadata
    );

    default String map(ApplicationId id) {
        return id == null ? null : id.value().toString();
    }

    default String map(ApplicationNo no) {
        return no == null ? null : no.value();
    }

    default String map(EmailAddress email) {
        return email == null ? null : email.value();
    }

    default String map(ActorId actorId) {
        return actorId == null ? null : actorId.value();
    }
}
```

Metadata:

```java
public record EventMetadata(
    String eventId,
    Instant occurredAt,
    String correlationId,
    String causationId
) {}
```

### 10.1 Event Version Jangan Bergantung Pada DTO Version

API response version dan event version adalah kontrak berbeda.

```text
ApplicationResponseV2 != ApplicationSubmittedEventV2
```

Perubahan UI response tidak otomatis berarti event berubah.

Perubahan event harus dipikirkan dari sudut consumer/downstream.

---

## 11. Anti-Corruption Layer dengan MapStruct

Anti-corruption layer dipakai saat sistem luar punya model yang tidak boleh mencemari domain internal.

Contoh external payload:

```java
public record LegacyLicensePayload(
    String LIC_NO,
    String LIC_STAT_CD,
    String APPL_NM,
    String EXP_DT,
    String LAST_UPD_TS
) {}
```

Domain command:

```java
public record SyncLicenseStatusCommand(
    LicenseNo licenseNo,
    LicenseStatus status,
    String applicantName,
    LocalDate expiryDate,
    Instant sourceUpdatedAt
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface LegacyLicenseAclMapper {

    @Mapping(target = "licenseNo", source = "LIC_NO")
    @Mapping(target = "status", source = "LIC_STAT_CD")
    @Mapping(target = "applicantName", source = "APPL_NM")
    @Mapping(target = "expiryDate", source = "EXP_DT")
    @Mapping(target = "sourceUpdatedAt", source = "LAST_UPD_TS")
    SyncLicenseStatusCommand toCommand(LegacyLicensePayload payload);

    default LicenseNo mapLicenseNo(String value) {
        return LicenseNo.parse(value);
    }

    default LicenseStatus mapStatus(String code) {
        return switch (code) {
            case "A" -> LicenseStatus.ACTIVE;
            case "S" -> LicenseStatus.SUSPENDED;
            case "E" -> LicenseStatus.EXPIRED;
            case "R" -> LicenseStatus.REVOKED;
            default -> throw new ExternalPayloadMappingException("Unknown license status code: " + code);
        };
    }

    default LocalDate mapExpiryDate(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return LocalDate.parse(value, DateTimeFormatter.BASIC_ISO_DATE);
    }

    default Instant mapSourceUpdatedAt(String value) {
        return Instant.parse(value);
    }
}
```

Di sini mapper memang berisi translation rule dari external code ke internal semantic code. Itu masih wajar karena bagian dari anti-corruption translation.

Tetapi jangan sampai mapper memanggil remote API, repository, atau melakukan workflow decision.

---

## 12. Mapper per Boundary, Bukan Mapper per Entity

Naming mapper berdasarkan entity sering menghasilkan class yang terlalu luas:

```java
UserMapper
ApplicationMapper
CaseMapper
DocumentMapper
```

Masalahnya, satu entity bisa punya banyak boundary:

- request command;
- response detail;
- listing projection;
- audit event;
- external integration;
- persistence conversion.

Lebih jelas:

```text
ApplicationCommandMapper
ApplicationResponseMapper
ApplicationPersistenceMapper
ApplicationEventMapper
ApplicationProjectionMapper
ExternalApplicationAclMapper
```

Aturan:

```text
Name mapper by boundary and purpose, not just by source entity.
```

### 12.1 Struktur Package yang Direkomendasikan

Contoh hexagonal/layered hybrid:

```text
com.example.application
├── application
│   ├── command
│   │   ├── SubmitApplicationCommand.java
│   │   └── ApproveApplicationCommand.java
│   ├── usecase
│   └── mapper
│       └── ApplicationCommandMapper.java
│
├── domain
│   ├── model
│   ├── event
│   └── policy
│
├── adapter
│   ├── inbound
│   │   └── rest
│   │       ├── dto
│   │       ├── controller
│   │       └── mapper
│   │           └── ApplicationRestMapper.java
│   │
│   ├── outbound
│   │   ├── persistence
│   │   │   ├── entity
│   │   │   ├── repository
│   │   │   └── mapper
│   │   │       └── ApplicationPersistenceMapper.java
│   │   │
│   │   └── legacy
│   │       ├── dto
│   │       ├── client
│   │       └── mapper
│   │           └── LegacyApplicationAclMapper.java
│   │
│   └── event
│       ├── payload
│       ├── publisher
│       └── mapper
│           └── ApplicationEventMapper.java
```

Keuntungannya:

- mapper dekat dengan boundary yang menggunakannya;
- DTO external tidak bocor ke domain;
- persistence entity tidak bocor ke REST;
- mapper tidak menjadi util global;
- ownership lebih jelas saat review.

---

## 13. Dependency Direction untuk Mapper

Dependency direction adalah bagian paling penting.

### 13.1 Inbound REST Mapper

```text
adapter.inbound.rest.dto -> application.command
```

REST adapter boleh depend ke application layer.

```java
@RestController
@RequiredArgsConstructor
public class ApplicationController {
    private final SubmitApplicationUseCase useCase;
    private final ApplicationRestMapper mapper;

    @PostMapping("/applications")
    public ApplicationSubmittedResponse submit(@RequestBody SubmitApplicationRequest request) {
        RequestContext context = RequestContext.current();
        SubmitApplicationCommand command = mapper.toCommand(request, context);
        ApplicationId id = useCase.submit(command);
        return new ApplicationSubmittedResponse(id.value().toString());
    }
}
```

### 13.2 Persistence Mapper

```text
adapter.outbound.persistence.entity <-> domain model
```

Persistence adapter boleh depend ke domain.

Domain tidak boleh depend ke entity.

```java
@Repository
@RequiredArgsConstructor
public class JpaApplicationRepository implements ApplicationRepository {
    private final SpringDataApplicationJpaRepository jpa;
    private final ApplicationPersistenceMapper mapper;

    @Override
    public void save(ApplicationAggregate aggregate) {
        ApplicationEntity entity = mapper.toEntity(aggregate);
        jpa.save(entity);
    }

    @Override
    public Optional<ApplicationAggregate> findById(ApplicationId id) {
        return jpa.findById(id.value()).map(mapper::toAggregate);
    }
}
```

### 13.3 Event Mapper

```text
domain/application state -> outbound event payload
```

Event publisher adapter boleh depend ke domain/application model.

Domain tidak perlu depend ke Kafka/Rabbit/JMS payload.

---

## 14. MapperConfig sebagai Boundary Policy

Untuk menjaga konsistensi, buat config per boundary.

### 14.1 Strict REST Response Mapper

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    typeConversionPolicy = ReportingPolicy.ERROR
)
public interface StrictRestMapperConfig {
}
```

Digunakan:

```java
@Mapper(config = StrictRestMapperConfig.class)
public interface ApplicationResponseMapper {
    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "applicationNo", source = "applicationNo")
    @Mapping(target = "status", source = "status")
    ApplicationSummaryResponse toSummary(ApplicationProjection projection);
}
```

### 14.2 Lenient External Inbound Mapper? Hati-Hati

Untuk external inbound payload, kadang kita butuh tolerant reader. Tetapi tolerant reader tidak berarti silent corruption.

Config bisa tetap strict target, tetapi conversion method lebih defensif.

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    unmappedSourcePolicy = ReportingPolicy.WARN
)
public interface ExternalInboundMapperConfig {
}
```

Maknanya:

- target internal harus terisi eksplisit;
- source external boleh punya field tambahan;
- field tambahan tetap terdeteksi sebagai warning saat relevan.

### 14.3 Persistence Mapper Config

Persistence mapper bisa punya policy berbeda.

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    collectionMappingStrategy = CollectionMappingStrategy.ACCESSOR_ONLY
)
public interface PersistenceMapperConfig {
}
```

Namun untuk JPA update mapping, collection strategy harus dipilih hati-hati karena bisa memicu orphan removal atau clear/add behavior yang tidak diinginkan.

---

## 15. Entity to Event: Snapshot atau Semantic Event?

Ada dua jenis event umum.

### 15.1 Semantic Event

Event menyatakan sesuatu terjadi.

```text
ApplicationSubmitted
CaseAssigned
DecisionApproved
LicenseRevoked
```

Payload hanya field yang relevan untuk kejadian itu.

### 15.2 Snapshot Event

Event menyimpan representasi state saat ini.

```text
ApplicationSnapshotUpdated
CaseStateSnapshot
```

Payload lebih besar dan mirip read model.

Kesalahan umum: menyebut event sebagai semantic event, tetapi payload-nya full entity snapshot.

Contoh buruk:

```java
public record CaseAssignedEvent(
    UUID id,
    String caseNo,
    String status,
    String applicantName,
    List<DocumentPayload> documents,
    List<DecisionPayload> decisions,
    List<AuditPayload> auditTrails,
    String internalRiskScore
) {}
```

Jika event-nya `CaseAssigned`, payload minimal mungkin cukup:

```java
public record CaseAssignedEventV1(
    String eventId,
    Instant occurredAt,
    String caseId,
    String caseNo,
    String assignedOfficerId,
    String assignedOfficerName,
    String assignedBy
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface CaseEventMapper {

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "eventId", source = "metadata.eventId")
    @Mapping(target = "occurredAt", source = "metadata.occurredAt")
    @Mapping(target = "caseId", source = "caseEntity.id")
    @Mapping(target = "caseNo", source = "caseEntity.caseNo")
    @Mapping(target = "assignedOfficerId", source = "assignment.officerId")
    @Mapping(target = "assignedOfficerName", source = "assignment.officerName")
    @Mapping(target = "assignedBy", source = "metadata.actorId")
    CaseAssignedEventV1 toCaseAssignedEvent(
        CaseEntity caseEntity,
        Assignment assignment,
        EventMetadata metadata
    );
}
```

---

## 16. Read Model/Event Projection dengan MapStruct

Dalam event-driven architecture atau CQRS, event sering dipakai untuk membangun read model.

Event:

```java
public record ApplicationSubmittedEventV1(
    String applicationId,
    String applicationNo,
    String applicantName,
    String applicantEmail,
    Instant occurredAt
) {}
```

Read model entity:

```java
@Entity
public class ApplicationSearchIndexEntity {
    @Id
    private String applicationId;
    private String applicationNo;
    private String applicantName;
    private String applicantEmail;
    private String status;
    private Instant submittedAt;
    private Instant lastUpdatedAt;
}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface ApplicationReadModelMapper {

    @Mapping(target = "applicationId", source = "applicationId")
    @Mapping(target = "applicationNo", source = "applicationNo")
    @Mapping(target = "applicantName", source = "applicantName")
    @Mapping(target = "applicantEmail", source = "applicantEmail")
    @Mapping(target = "status", constant = "SUBMITTED")
    @Mapping(target = "submittedAt", source = "occurredAt")
    @Mapping(target = "lastUpdatedAt", source = "occurredAt")
    ApplicationSearchIndexEntity fromSubmitted(ApplicationSubmittedEventV1 event);

    @Mapping(target = "status", constant = "APPROVED")
    @Mapping(target = "lastUpdatedAt", source = "occurredAt")
    void applyApproved(
        ApplicationApprovedEventV1 event,
        @MappingTarget ApplicationSearchIndexEntity entity
    );
}
```

Perhatikan:

- event submitted membuat read model;
- event approved meng-update sebagian read model;
- ini mirip update mapping, tetapi domain-nya projection state.

### 16.1 Idempotency dan Event Projection

Mapper tidak cukup untuk idempotency.

Event handler perlu:

- cek event id;
- cek version/sequence;
- handle duplicate;
- handle out-of-order;
- transactional boundary.

Mapper hanya mengubah shape.

---

## 17. DTO Composition: Satu Source vs Banyak Source

Response sering berasal dari lebih dari satu source.

Contoh:

```java
public record ApplicationDetailResponse(
    String applicationNo,
    String status,
    String applicantName,
    String currentOfficerName,
    List<DocumentResponse> documents,
    List<String> allowedActions,
    AuditSummaryResponse auditSummary
) {}
```

Source:

- `ApplicationEntity`;
- `OfficerEntity` atau `OfficerView`;
- `List<DocumentEntity>`;
- `List<String> allowedActions`;
- `AuditSummary`.

Mapper:

```java
@Mapper(componentModel = "spring", uses = DocumentResponseMapper.class)
public interface ApplicationDetailResponseMapper {

    @Mapping(target = "applicationNo", source = "application.applicationNo")
    @Mapping(target = "status", source = "application.status")
    @Mapping(target = "applicantName", source = "application.applicantName")
    @Mapping(target = "currentOfficerName", source = "officer.displayName")
    @Mapping(target = "documents", source = "application.documents")
    @Mapping(target = "allowedActions", source = "allowedActions")
    @Mapping(target = "auditSummary", source = "auditSummary")
    ApplicationDetailResponse toResponse(
        ApplicationEntity application,
        OfficerView officer,
        List<String> allowedActions,
        AuditSummary auditSummary
    );
}
```

Ini valid selama source sudah disiapkan oleh application service.

Mapper jangan melakukan:

```java
// buruk
Officer officer = officerRepository.findById(application.getOfficerId());
```

Repository call harus di service/use case, bukan di mapper.

---

## 18. Derived Field: Boleh di Mapper atau Tidak?

Derived field ada dua jenis.

### 18.1 Derived Field Murni Representasional

Contoh:

```text
firstName + " " + lastName -> fullName
status enum -> display label
BigDecimal -> formatted string
```

Ini boleh di mapper jika deterministic dan tidak butuh policy kompleks.

```java
@Mapper(componentModel = "spring")
public interface OfficerResponseMapper {

    @Mapping(target = "fullName", expression = "java(fullName(entity))")
    OfficerResponse toResponse(OfficerEntity entity);

    default String fullName(OfficerEntity entity) {
        return Stream.of(entity.getFirstName(), entity.getLastName())
            .filter(Objects::nonNull)
            .collect(Collectors.joining(" "));
    }
}
```

### 18.2 Derived Field Berdasarkan Policy

Contoh:

```text
allowedActions
canApprove
canEscalate
riskCategory
slaBreachStatus
```

Ini biasanya bukan tanggung jawab mapper.

Lebih baik:

```java
AllowedActions allowedActions = policy.allowedActions(actor, application);
return mapper.toResponse(application, allowedActions);
```

Aturan:

```text
If it is formatting, mapping can do it.
If it is authorization, workflow, SLA, risk, or business decision, keep it outside mapper.
```

---

## 19. Avoid “God Mapper”

God mapper biasanya terlihat seperti ini:

```java
@Mapper(componentModel = "spring", uses = {
    UserMapper.class,
    RoleMapper.class,
    DocumentMapper.class,
    CaseMapper.class,
    AuditMapper.class,
    ExternalSystemMapper.class
})
public interface ApplicationMapper {
    ApplicationEntity toEntity(ApplicationRequest request);
    ApplicationResponse toResponse(ApplicationEntity entity);
    ApplicationEvent toEvent(ApplicationEntity entity);
    ExternalApplicationPayload toExternal(ApplicationEntity entity);
    ApplicationSearchIndex toSearchIndex(ApplicationEntity entity);
    void updateEntity(ApplicationUpdateRequest request, @MappingTarget ApplicationEntity entity);
}
```

Masalah:

- terlalu banyak alasan berubah;
- dependency melebar;
- sulit review;
- satu mapping config dipakai untuk semua boundary;
- risiko field bocor antar context;
- mapper terlihat reusable padahal semantic berbeda.

Pisahkan:

```text
ApplicationCommandMapper
ApplicationResponseMapper
ApplicationUpdateMapper
ApplicationEventMapper
ApplicationSearchIndexMapper
ExternalApplicationPayloadMapper
ApplicationPersistenceMapper
```

---

## 20. Testing Mapper per Boundary

Mapper boundary tidak cukup hanya compile.

### 20.1 Request DTO → Command Test

```java
@Test
void shouldMapSubmitRequestToCommand() {
    SubmitApplicationRequest request = new SubmitApplicationRequest(
        "Alice",
        "alice@example.com",
        "123456",
        List.of(new DocumentRequest("NRIC", "file-1"))
    );

    RequestMappingContext context = new RequestMappingContext(
        new ActorId("officer-1"),
        Instant.parse("2026-01-01T00:00:00Z"),
        new CorrelationId("corr-1")
    );

    SubmitApplicationCommand command = mapper.toCommand(request, context);

    assertThat(command.actorId().value()).isEqualTo("officer-1");
    assertThat(command.applicantEmail().value()).isEqualTo("alice@example.com");
    assertThat(command.postalCode().value()).isEqualTo("123456");
    assertThat(command.requestedAt()).isEqualTo(Instant.parse("2026-01-01T00:00:00Z"));
}
```

### 20.2 Entity → Response Security Test

```java
@Test
void shouldNotExposeSensitiveFields() throws Exception {
    UserEntity entity = new UserEntity();
    entity.setId(UUID.randomUUID());
    entity.setName("Alice");
    entity.setEmail("alice@example.com");
    entity.setPasswordHash("secret-hash");
    entity.setMfaSecret("mfa-secret");

    UserResponse response = mapper.toResponse(entity);
    String json = objectMapper.writeValueAsString(response);

    assertThat(json).doesNotContain("passwordHash");
    assertThat(json).doesNotContain("mfaSecret");
    assertThat(json).doesNotContain("secret-hash");
    assertThat(json).doesNotContain("mfa-secret");
}
```

### 20.3 Entity → Event Golden Payload Test

```java
@Test
void shouldGenerateStableSubmittedEventPayload() throws Exception {
    ApplicationAggregate aggregate = fixture.submittedApplication();
    EventMetadata metadata = new EventMetadata(
        "evt-1",
        Instant.parse("2026-01-01T00:00:00Z"),
        "corr-1",
        "cmd-1"
    );

    ApplicationSubmittedEventV1 event = mapper.toSubmittedEvent(aggregate, metadata);

    String actualJson = objectMapper.writeValueAsString(event);
    assertThatJson(actualJson).isEqualTo(resource("golden/application-submitted-v1.json"));
}
```

Golden payload penting untuk event/API contract.

---

## 21. Review Checklist untuk Mapper Boundary

Gunakan checklist ini saat code review.

### 21.1 Identity dan Ownership

- Mapper ini milik boundary apa?
- Source object berasal dari layer mana?
- Target object menuju layer mana?
- Apakah dependency direction benar?
- Apakah mapper terlalu generic?

### 21.2 Security

- Apakah field sensitif bisa bocor?
- Apakah request bisa mengisi field internal?
- Apakah ada over-posting risk?
- Apakah response deny-by-default untuk object sensitif?
- Apakah event membawa internal state yang tidak perlu?

### 21.3 Domain Correctness

- Apakah mapper bypass invariant domain?
- Apakah command merepresentasikan intent, bukan state langsung?
- Apakah state transition terjadi di domain/application, bukan mapper?
- Apakah derived field business-policy dihitung di tempat yang benar?

### 21.4 Compatibility

- Apakah event payload versioned?
- Apakah response DTO stabil?
- Apakah external payload diisolasi lewat ACL?
- Apakah rename internal tidak otomatis merusak external contract?

### 21.5 Persistence Safety

- Apakah mapping memicu lazy loading tidak sengaja?
- Apakah collection update aman untuk orphan removal/cascade?
- Apakah entity ID/version/audit field dilindungi?
- Apakah projection dipakai untuk listing berat?

### 21.6 Testability

- Apakah mapper bisa dites tanpa Spring context besar?
- Apakah generated mapping diverifikasi untuk field penting?
- Apakah ada golden payload untuk event/API penting?
- Apakah negative test mencakup sensitive field?

---

## 22. Pattern yang Direkomendasikan

### Pattern 1 — Request DTO to Command

```text
REST request -> command mapper -> use case
```

Gunakan untuk menjaga input sebagai intent.

### Pattern 2 — Projection to Response

```text
SQL/View projection -> response mapper -> API response
```

Gunakan untuk listing/dashboard/search.

### Pattern 3 — Aggregate to Event Payload

```text
domain/application state -> event mapper -> stable event payload
```

Gunakan untuk event-driven integration/audit.

### Pattern 4 — External DTO to Internal Command via ACL

```text
external payload -> ACL mapper -> internal command/model
```

Gunakan untuk legacy/external system.

### Pattern 5 — Persistence Mapper inside Repository Adapter

```text
repository adapter maps domain <-> entity
```

Gunakan saat domain dipisah dari JPA.

---

## 23. Anti-Pattern yang Harus Dihindari

### Anti-Pattern 1 — Entity as API Contract

```java
@GetMapping("/{id}")
public ApplicationEntity get(@PathVariable UUID id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

- persistence model bocor;
- lazy/cycle problem;
- field internal bocor;
- API berubah saat entity berubah.

### Anti-Pattern 2 — Request DTO Directly Updates Entity

```java
mapper.updateEntity(request, entity);
repository.save(entity);
```

Ini berbahaya jika request bukan patch DTO yang sangat dikontrol.

### Anti-Pattern 3 — Mapper Calls Repository

```java
@Mapping(target = "officer", expression = "java(officerRepository.findById(dto.officerId()))")
```

Masalah:

- mapper punya side effect;
- sulit test;
- N+1 hidden;
- transaction boundary kabur.

### Anti-Pattern 4 — Shared Universal Mapper

```java
CommonMapper.mapAnything(source, targetClass)
```

Masalah:

- tidak ada semantic boundary;
- error runtime;
- coupling tersembunyi;
- field baru bisa termapping diam-diam.

### Anti-Pattern 5 — Event Uses Entity Directly

```java
publish(new CaseUpdatedEvent(entity));
```

Masalah:

- event contract tidak stabil;
- downstream tahu internal model;
- serialization risk;
- replay risk.

---

## 24. Realistic Case Study: Case Management Mapping Flow

Kita desain alur untuk case management.

### 24.1 Submit Case

Inbound request:

```java
public record SubmitCaseRequest(
    String applicantName,
    String applicantEmail,
    String caseType,
    List<DocumentRequest> documents
) {}
```

Command:

```java
public record SubmitCaseCommand(
    ActorId submittedBy,
    Applicant applicant,
    CaseType caseType,
    List<SubmitDocumentCommand> documents,
    Instant submittedAt,
    CorrelationId correlationId
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring", uses = DocumentCommandMapper.class)
public interface CaseCommandMapper {

    @Mapping(target = "submittedBy", source = "context.actorId")
    @Mapping(target = "applicant", source = "request")
    @Mapping(target = "caseType", source = "request.caseType")
    @Mapping(target = "documents", source = "request.documents")
    @Mapping(target = "submittedAt", source = "context.now")
    @Mapping(target = "correlationId", source = "context.correlationId")
    SubmitCaseCommand toCommand(SubmitCaseRequest request, @Context RequestMappingContext context);

    default Applicant mapApplicant(SubmitCaseRequest request) {
        return new Applicant(
            request.applicantName(),
            EmailAddress.parse(request.applicantEmail())
        );
    }

    default CaseType mapCaseType(String value) {
        return CaseType.fromCode(value);
    }
}
```

Use case:

```java
public CaseId submit(SubmitCaseCommand command) {
    CaseAggregate aggregate = CaseAggregate.submit(command);
    caseRepository.save(aggregate);
    eventPublisher.publish(caseEventMapper.toSubmittedEvent(aggregate, EventMetadata.now(command)));
    return aggregate.id();
}
```

### 24.2 Case Listing

Projection:

```java
public interface CaseQueueProjection {
    String getCaseNo();
    String getCaseType();
    String getStatus();
    String getApplicantName();
    String getAssignedOfficerName();
    Instant getLastUpdatedAt();
}
```

Response:

```java
public record CaseQueueItemResponse(
    String caseNo,
    String caseType,
    String status,
    String applicantName,
    String assignedOfficerName,
    Instant lastUpdatedAt
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface CaseQueueMapper {
    CaseQueueItemResponse toResponse(CaseQueueProjection projection);
    List<CaseQueueItemResponse> toResponses(List<CaseQueueProjection> projections);
}
```

### 24.3 Case Assigned Event

Payload:

```java
public record CaseAssignedEventV1(
    String eventId,
    int eventVersion,
    Instant occurredAt,
    String caseId,
    String caseNo,
    String assignedOfficerId,
    String assignedOfficerName,
    String assignedBy
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface CaseEventMapper {

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "eventId", source = "metadata.eventId")
    @Mapping(target = "eventVersion", constant = "1")
    @Mapping(target = "occurredAt", source = "metadata.occurredAt")
    @Mapping(target = "caseId", source = "aggregate.id")
    @Mapping(target = "caseNo", source = "aggregate.caseNo")
    @Mapping(target = "assignedOfficerId", source = "assignment.officerId")
    @Mapping(target = "assignedOfficerName", source = "assignment.officerName")
    @Mapping(target = "assignedBy", source = "metadata.actorId")
    CaseAssignedEventV1 toAssignedEvent(
        CaseAggregate aggregate,
        Assignment assignment,
        EventMetadata metadata
    );
}
```

---

## 25. Decision Matrix: Kapan MapStruct Dipakai?

| Boundary | MapStruct cocok? | Catatan |
|---|---:|---|
| Request DTO → Command | Ya | Sangat cocok jika command adalah intent model. |
| Request DTO → Entity | Hati-hati | Hanya untuk CRUD sederhana dan field dikontrol ketat. |
| Command → Aggregate creation | Sering tidak | Lebih aman domain factory/manual. |
| Entity → Response DTO | Ya | Gunakan deny-by-default untuk field sensitif. |
| Projection → Response DTO | Ya | Sangat cocok untuk listing/query. |
| Aggregate → Event | Ya | Pastikan event payload stabil/versioned. |
| Entity → Event | Bisa | Jangan publish entity langsung; map ke payload eksplisit. |
| External DTO → Internal Command | Ya | Cocok sebagai anti-corruption mapper. |
| Domain ↔ Persistence Entity | Tergantung | Cocok jika mapping struktural; manual jika rehydration kompleks. |
| Mapper dengan repository call | Tidak | Pindahkan ke service/application layer. |
| Mapper dengan workflow decision | Tidak | Pindahkan ke domain/policy/use case. |

---

## 26. Prinsip Praktis Top 1% Engineer

1. **Mapper bukan tempat menyembunyikan business logic.**  
   Mapper boleh transformasi, bukan memutuskan workflow.

2. **DTO bukan entity yang diganti nama.**  
   DTO adalah kontrak boundary.

3. **Command bukan request.**  
   Request adalah transport shape; command adalah intent shape.

4. **Event bukan dump entity.**  
   Event adalah kontrak temporal untuk consumer dan audit/replay.

5. **Projection bukan aggregate.**  
   Projection melayani read path; aggregate melayani consistency/invariant/change path.

6. **Mapper dinamai berdasarkan boundary.**  
   Hindari mapper universal yang tampak reusable tetapi semantic-nya kabur.

7. **Generated code tetap harus direview secara konsep.**  
   Tidak perlu review setiap baris generated code, tetapi harus review contract mapping-nya.

8. **Deny-by-default untuk output sensitif.**  
   Pilih field eksplisit untuk API/event yang berisiko.

9. **Strict target mapping untuk contract penting.**  
   Build harus gagal jika field target penting tidak dimap.

10. **Boundary mapping harus punya tests.**  
    Terutama untuk security, event payload, compatibility, dan partial update.

---

## 27. Latihan Desain

Coba desain mapper untuk kasus berikut.

### Latihan 1 — Application Approval

Input:

```java
ApproveApplicationRequest(
    String decisionCode,
    String remarks
)
```

Target command:

```java
ApproveApplicationCommand(
    ApplicationId applicationId,
    ActorId approvedBy,
    Decision decision,
    String remarks,
    Instant decidedAt,
    CorrelationId correlationId
)
```

Pertanyaan:

- field mana dari path variable/context, bukan request body?
- apakah decisionCode langsung menjadi enum?
- siapa yang boleh memvalidasi status transition?
- mapper atau domain?

Jawaban ideal:

- `applicationId` dari path variable;
- `approvedBy`, `decidedAt`, `correlationId` dari context;
- `decisionCode` bisa dimap ke `Decision`, tetapi status transition tetap domain/use case;
- mapper tidak menentukan apakah approval boleh dilakukan.

### Latihan 2 — Case Detail Response

Source:

- `CaseEntity`;
- `ApplicantEntity`;
- `OfficerView`;
- `AllowedActions`;
- `AuditSummary`.

Response:

```java
CaseDetailResponse(
    String caseNo,
    String applicantName,
    String status,
    String assignedOfficerName,
    List<String> allowedActions,
    AuditSummaryResponse auditSummary
)
```

Pertanyaan:

- apakah mapper boleh query officer repository?
- apakah allowedActions dihitung di mapper?
- apakah audit summary dimap di mapper?

Jawaban ideal:

- repository call di service/use case;
- allowed actions dihitung policy service;
- audit summary boleh dimap jika object-nya sudah tersedia.

### Latihan 3 — Event Payload

Domain event internal:

```java
ApplicationApproved(
    ApplicationId id,
    ApplicationNo no,
    OfficerId approvedBy,
    Instant approvedAt
)
```

External event payload:

```java
ApplicationApprovedEventV1(
    String eventId,
    String eventType,
    int eventVersion,
    String applicationId,
    String applicationNo,
    String approvedBy,
    Instant occurredAt
)
```

Pertanyaan:

- apakah event metadata masuk domain event internal?
- apakah eventVersion hardcoded di mapper?
- apakah external payload boleh pakai domain type?

Jawaban ideal:

- metadata bisa ditambahkan saat publish;
- version boleh constant di mapper/payload factory;
- external payload sebaiknya primitive/string/time stable type.

---

## 28. Ringkasan

MapStruct sangat kuat untuk mapping antar object, tetapi dalam sistem enterprise nilai terbesarnya bukan hanya mengurangi boilerplate. Nilai terbesarnya adalah membantu membuat boundary transformasi yang eksplisit, compile-time checked, dan mudah direview.

Namun MapStruct juga bisa mempercepat coupling jika dipakai sembarangan.

Mental model paling penting:

```text
Do not map classes. Map boundaries.
```

Entity, DTO, command, event, projection, dan external payload tidak boleh dianggap variasi class yang sama. Mereka mewakili contract berbeda, lifecycle berbeda, ownership berbeda, dan failure mode berbeda.

Gunakan MapStruct untuk:

- request DTO ke command;
- projection ke response;
- aggregate/entity ke event payload;
- external DTO ke internal model via ACL;
- persistence entity ke domain jika mapping-nya struktural dan terkendali.

Hindari MapStruct untuk:

- domain creation yang butuh invariant kompleks;
- workflow/state transition;
- authorization/policy decision;
- repository call;
- event yang langsung membawa entity;
- mapper universal lintas boundary.

Jika prinsip ini dipegang, MapStruct bukan hanya tool produktivitas, tetapi bagian dari architecture safety system.

---

## 29. Checklist Implementasi Singkat

Sebelum merge mapper boundary, pastikan:

- [ ] Nama mapper menunjukkan boundary/purpose.
- [ ] Source dan target layer jelas.
- [ ] Direction dependency benar.
- [ ] Tidak ada repository/client call di mapper.
- [ ] Tidak ada workflow decision di mapper.
- [ ] Field sensitif tidak ikut keluar.
- [ ] Field internal tidak bisa diisi request.
- [ ] Event payload explicit dan versioned.
- [ ] Projection dipakai untuk read-heavy response.
- [ ] Command digunakan untuk use case input.
- [ ] Domain invariant tidak dibypass.
- [ ] `unmappedTargetPolicy` dipilih sesuai boundary.
- [ ] Test mencakup field penting dan leakage risk.
- [ ] Golden payload tersedia untuk event/API penting.

---

## 30. Posisi Part Ini dalam Seri

Part ini menyelesaikan bagian MapStruct dari sisi boundary/domain architecture.

Kita sudah membahas:

- MapStruct mental model;
- core mapping;
- update/patch/null strategy;
- advanced qualifier/context/hook/object factory;
- MapStruct untuk domain boundary/entity/DTO/event/projection.

Berikutnya kita masuk ke Lombok.

Part berikutnya:

```text
23-lombok-mental-model-annotation-processing-bytecode-shape-ide-coupling.md
```

Fokus berikutnya adalah memahami Lombok sebagai annotation processing/AST transformation tool, termasuk dampaknya terhadap compiler, IDE, generated members, debugging, build reproducibility, Java version coupling, dan kapan Lombok menjadi productivity tool vs architectural debt.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — MapStruct Advanced: Qualifiers, Context, Lifecycle Hooks, Object Factory](./21-mapstruct-advanced-qualifiers-context-lifecycle-hooks-object-factory.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — Lombok Mental Model: Annotation Processing, Bytecode Shape, IDE Coupling](./23-lombok-mental-model-annotation-processing-bytecode-shape-ide-coupling.md)
