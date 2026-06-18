# Part 35 — Capstone: Designing a Production-Grade Mapping Layer

**Series:** `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
**File:** `35-capstone-designing-production-grade-mapping-layer.md`  
**Scope:** Java 8 → Java 25, Jackson, MapStruct, Lombok, Records, JSON/XML, enterprise transformation architecture  
**Status:** Final part of the series

---

## 0. Tujuan Capstone

Bagian ini adalah latihan sintesis. Setelah mempelajari object model Java, manual mapping, Jackson, XML, MapStruct, Lombok, records, testing, performance, persistence, integration, governance, dan migration, sekarang kita desain satu mapping layer production-grade secara utuh.

Targetnya bukan sekadar bisa menulis:

```java
UserDto dto = mapper.toDto(entity);
```

Targetnya adalah memahami bagaimana sebuah sistem enterprise/regulatory/case-management menjaga transformasi data tetap:

1. benar secara semantic,
2. aman dari over-posting dan data leakage,
3. kompatibel terhadap evolusi kontrak,
4. jelas ownership-nya,
5. mudah diuji,
6. mudah didiagnosis,
7. efisien secara memory/performance,
8. tidak mencemari domain model,
9. tidak membuat persistence model bocor ke API,
10. tidak membuat mapper berubah menjadi service layer tersembunyi.

Capstone ini menggunakan contoh domain **regulatory case management** karena domain seperti ini cocok untuk membahas kompleksitas nyata: lifecycle, audit, status transition, assignment, document, external integration, eventing, reporting, dan legal defensibility.

---

## 1. Mental Model Utama

Production-grade mapping layer bukan hanya lapisan konversi object. Ia adalah **boundary control system**.

Setiap boundary memiliki bahasa, risiko, dan stabilitas berbeda:

| Boundary | Model Masuk/Keluar | Risiko Utama | Mapping Responsibility |
|---|---|---|---|
| HTTP API inbound | Request DTO | over-posting, invalid shape, coercion | parse, bind, normalize minimal, validate shape |
| Application layer | Command/Query | semantic intent kabur | ubah DTO menjadi intent eksplisit |
| Domain layer | Aggregate/value object | invariant rusak | jangan auto-map domain behavior |
| Persistence layer | Entity/projection | lazy loading, proxy, cycles | entity mapping sadar fetch plan |
| Event layer | Domain/integration event | compatibility drift | payload stabil dan versioned |
| Audit layer | Audit snapshot/diff | legal defensibility | raw + canonical + actor + timestamp |
| External integration | Partner payload | legacy weirdness, schema drift | anti-corruption translation |
| Reporting/query | Read model | over-fetching, slow mapping | projection-first mapping |

Prinsipnya:

> Mapper boleh mengubah bentuk data, tetapi tidak boleh menyembunyikan keputusan bisnis penting.

Jika transformasi membutuhkan policy bisnis, external lookup, authorization, lifecycle transition, atau conflict resolution, itu bukan sekadar mapper. Itu application/domain service concern.

---

## 2. Studi Kasus Capstone

Kita akan mendesain mapping layer untuk fitur:

> **Create Enforcement Case**

Fitur ini menerima laporan pelanggaran, membuat case, menyimpan entity, menghasilkan audit record, menerbitkan event, dan kadang mengirim payload ke external agency.

### 2.1 Input API

Endpoint:

```http
POST /api/v1/enforcement-cases
Content-Type: application/json
```

Contoh payload:

```json
{
  "source": "PUBLIC_PORTAL",
  "caseType": "UNLICENSED_ACTIVITY",
  "subject": {
    "name": "ABC Trading Pte Ltd",
    "identifierType": "UEN",
    "identifierValue": "202312345Z"
  },
  "incident": {
    "occurredDate": "2026-06-15",
    "description": "Suspected unlicensed activity observed at reported premises.",
    "location": {
      "postalCode": "123456",
      "addressLine1": "10 Example Road",
      "unitNo": "#01-02"
    }
  },
  "reporter": {
    "name": "John Tan",
    "email": "john@example.com",
    "phone": "+65 8123 4567"
  },
  "attachments": [
    {
      "documentId": "doc_123",
      "fileName": "photo.jpg"
    }
  ]
}
```

### 2.2 Output API

```json
{
  "caseId": "CASE-2026-000123",
  "status": "DRAFT",
  "assignedTeam": "ENFORCEMENT_INTAKE",
  "createdAt": "2026-06-17T08:30:00+07:00"
}
```

### 2.3 Internal Flow

Text diagram:

```text
HTTP JSON
  ↓ Jackson inbound ObjectMapper
CreateEnforcementCaseRequest
  ↓ API mapper
CreateEnforcementCaseCommand
  ↓ Application service
Domain factory / aggregate behavior
  ↓ Persistence mapper / repository
EnforcementCaseEntity
  ↓ JPA / DB
Stored case
  ↓ Domain event mapper
EnforcementCaseCreatedEventV1
  ↓ Event publisher
Message broker
  ↓ Audit mapper
AuditRecord
  ↓ Audit store
Audit trail
  ↓ Integration mapper, optional
ExternalAgencyCaseNotificationV1
```

Pola ini sengaja memisahkan banyak model. Di sistem kecil, ini terasa verbose. Di sistem enterprise yang panjang umurnya, pemisahan ini menyelamatkan sistem dari coupling yang mahal.

---

## 3. Model Taxonomy untuk Capstone

Jangan mulai dari MapStruct. Mulai dari taxonomy model.

### 3.1 API Request DTO

API request DTO mewakili shape input HTTP. Ia bukan domain object.

```java
public record CreateEnforcementCaseRequest(
        String source,
        String caseType,
        SubjectRequest subject,
        IncidentRequest incident,
        ReporterRequest reporter,
        List<AttachmentRequest> attachments
) {}

public record SubjectRequest(
        String name,
        String identifierType,
        String identifierValue
) {}

public record IncidentRequest(
        String occurredDate,
        String description,
        LocationRequest location
) {}

public record LocationRequest(
        String postalCode,
        String addressLine1,
        String unitNo
) {}

public record ReporterRequest(
        String name,
        String email,
        String phone
) {}

public record AttachmentRequest(
        String documentId,
        String fileName
) {}
```

Kenapa `occurredDate` masih `String`? Untuk external/public inbound, kadang kita ingin membedakan:

1. field tidak ada,
2. field ada tapi null,
3. field ada tapi format salah,
4. field ada dan valid.

Namun di banyak sistem, langsung memakai `LocalDate` juga valid jika error binding sudah distandardisasi. Pilihannya tergantung error model API.

Untuk capstone ini, kita gunakan `String` agar mapping layer eksplisit menangani parsing.

### 3.2 Application Command

Command adalah intent internal. Ia lebih semantic daripada DTO.

```java
public record CreateEnforcementCaseCommand(
        CaseSource source,
        CaseType caseType,
        SubjectInput subject,
        IncidentInput incident,
        ReporterInput reporter,
        List<AttachmentInput> attachments,
        Actor actor,
        RequestContext requestContext
) {}

public record SubjectInput(
        String name,
        Identifier identifier
) {}

public record Identifier(
        IdentifierType type,
        String value
) {}

public record IncidentInput(
        LocalDate occurredDate,
        String description,
        LocationInput location
) {}

public record LocationInput(
        String postalCode,
        String addressLine1,
        String unitNo
) {}

public record ReporterInput(
        String name,
        String email,
        String phone
) {}

public record AttachmentInput(
        String documentId,
        String fileName
) {}
```

Perhatikan perbedaannya:

- `String caseType` menjadi `CaseType`.
- `String source` menjadi `CaseSource`.
- `identifierType + identifierValue` menjadi value object `Identifier`.
- `occurredDate String` menjadi `LocalDate`.
- actor dan request context tidak berasal dari payload, tetapi dari security/session/request metadata.

Ini adalah mapping yang benar-benar bernilai. Kita mengubah raw request menjadi intent yang lebih kuat.

### 3.3 Domain Aggregate

Domain aggregate bukan hasil auto-copy dari DTO.

```java
public final class EnforcementCase {

    private final CaseId caseId;
    private final CaseType caseType;
    private CaseStatus status;
    private final Subject subject;
    private final Incident incident;
    private final Reporter reporter;
    private final List<CaseAttachment> attachments;
    private Assignment assignment;
    private final Instant createdAt;
    private final Actor createdBy;

    private EnforcementCase(
            CaseId caseId,
            CaseType caseType,
            CaseStatus status,
            Subject subject,
            Incident incident,
            Reporter reporter,
            List<CaseAttachment> attachments,
            Assignment assignment,
            Instant createdAt,
            Actor createdBy
    ) {
        this.caseId = Objects.requireNonNull(caseId);
        this.caseType = Objects.requireNonNull(caseType);
        this.status = Objects.requireNonNull(status);
        this.subject = Objects.requireNonNull(subject);
        this.incident = Objects.requireNonNull(incident);
        this.reporter = Objects.requireNonNull(reporter);
        this.attachments = List.copyOf(attachments);
        this.assignment = Objects.requireNonNull(assignment);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.createdBy = Objects.requireNonNull(createdBy);
    }

    public static EnforcementCase createNew(
            CaseId caseId,
            CaseType caseType,
            Subject subject,
            Incident incident,
            Reporter reporter,
            List<CaseAttachment> attachments,
            AssignmentPolicy assignmentPolicy,
            Clock clock,
            Actor actor
    ) {
        Assignment assignment = assignmentPolicy.initialAssignmentFor(caseType, incident.location());

        return new EnforcementCase(
                caseId,
                caseType,
                CaseStatus.DRAFT,
                subject,
                incident,
                reporter,
                attachments,
                assignment,
                clock.instant(),
                actor
        );
    }

    public CaseId caseId() { return caseId; }
    public CaseStatus status() { return status; }
    public Assignment assignment() { return assignment; }
    public Instant createdAt() { return createdAt; }
}
```

Domain object tidak diisi via MapStruct begitu saja karena creation logic memiliki invariant dan policy:

- initial status harus benar,
- assignment harus mengikuti policy,
- case id harus generated,
- timestamp harus dari controlled clock,
- actor harus dari authenticated context,
- attachments harus divalidasi ownership/access-nya.

Mapper boleh membantu membentuk value object, tetapi aggregate creation tetap domain/application concern.

### 3.4 Persistence Entity

Persistence entity dirancang untuk ORM, bukan API.

```java
@Entity
@Table(name = "ENFORCEMENT_CASE")
public class EnforcementCaseEntity {

    @Id
    @Column(name = "CASE_ID")
    private String caseId;

    @Column(name = "CASE_TYPE")
    private String caseType;

    @Column(name = "STATUS")
    private String status;

    @Column(name = "SUBJECT_NAME")
    private String subjectName;

    @Column(name = "IDENTIFIER_TYPE")
    private String identifierType;

    @Column(name = "IDENTIFIER_VALUE")
    private String identifierValue;

    @Column(name = "OCCURRED_DATE")
    private LocalDate occurredDate;

    @Column(name = "DESCRIPTION")
    private String description;

    @Column(name = "POSTAL_CODE")
    private String postalCode;

    @Column(name = "ADDRESS_LINE_1")
    private String addressLine1;

    @Column(name = "UNIT_NO")
    private String unitNo;

    @Column(name = "REPORTER_NAME")
    private String reporterName;

    @Column(name = "REPORTER_EMAIL")
    private String reporterEmail;

    @Column(name = "REPORTER_PHONE")
    private String reporterPhone;

    @Column(name = "ASSIGNED_TEAM")
    private String assignedTeam;

    @Column(name = "CREATED_AT")
    private Instant createdAt;

    @Column(name = "CREATED_BY")
    private String createdBy;

    @Version
    @Column(name = "VERSION")
    private Long version;

    protected EnforcementCaseEntity() {
        // JPA
    }

    // getters/setters omitted intentionally in this snippet
}
```

Entity shape dapat flat karena database table flat. Domain shape dapat nested karena semantic lebih penting. API shape dapat berbeda lagi karena contract readability.

Jangan memaksakan satu model untuk semua layer.

---

## 4. Boundary Mapping Design

### 4.1 Inbound JSON to Request DTO

Inbound JSON dikendalikan oleh Jackson.

Kita butuh ObjectMapper profile khusus untuk external API inbound:

```java
@Configuration
public class JsonMapperConfiguration {

    @Bean
    @Qualifier("externalApiObjectMapper")
    public ObjectMapper externalApiObjectMapper() {
        return JsonMapper.builder()
                .addModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
                .build();
    }

    @Bean
    @Qualifier("internalEventObjectMapper")
    public ObjectMapper internalEventObjectMapper() {
        return JsonMapper.builder()
                .addModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .build();
    }
}
```

Policy:

- external inbound strict,
- internal event consumer tolerant,
- outbound stable,
- audit serializer redacts/masks where needed.

Satu global ObjectMapper untuk semua kebutuhan sering menyebabkan konflik policy.

### 4.2 API DTO to Command Mapper

DTO → command adalah mapping dari raw boundary shape ke internal intent.

Di sini MapStruct bisa dipakai, tetapi parsing dan enum normalization perlu policy eksplisit.

```java
@Mapper(
        componentModel = "spring",
        unmappedTargetPolicy = ReportingPolicy.ERROR,
        uses = {
                CaseEnumMapper.class,
                DateMapper.class,
                TextNormalizer.class
        }
)
public interface CreateCaseApiMapper {

    @Mapping(target = "source", source = "request.source")
    @Mapping(target = "caseType", source = "request.caseType")
    @Mapping(target = "subject", source = "request.subject")
    @Mapping(target = "incident", source = "request.incident")
    @Mapping(target = "reporter", source = "request.reporter")
    @Mapping(target = "attachments", source = "request.attachments")
    @Mapping(target = "actor", source = "actor")
    @Mapping(target = "requestContext", source = "requestContext")
    CreateEnforcementCaseCommand toCommand(
            CreateEnforcementCaseRequest request,
            Actor actor,
            RequestContext requestContext
    );

    @Mapping(target = "identifier", source = ".")
    SubjectInput toSubjectInput(SubjectRequest request);

    default Identifier toIdentifier(SubjectRequest request) {
        return new Identifier(
                IdentifierType.fromExternalCode(request.identifierType()),
                normalizeIdentifier(request.identifierValue())
        );
    }

    default String normalizeIdentifier(String value) {
        if (value == null) {
            return null;
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }
}
```

Catatan penting:

- `unmappedTargetPolicy = ERROR` memaksa perubahan field disadari.
- `Actor` dan `RequestContext` bukan dari JSON body.
- identifier dibentuk sebagai value object.
- normalization kecil boleh di mapper jika deterministik dan tidak memerlukan policy eksternal.
- validation lebih dalam tetap di service/domain.

### 4.3 Command to Domain

Untuk command → domain aggregate, jangan auto-map semua. Gunakan application service.

```java
@Service
public class CreateEnforcementCaseService {

    private final CaseIdGenerator caseIdGenerator;
    private final AssignmentPolicy assignmentPolicy;
    private final EnforcementCaseRepository repository;
    private final EnforcementCasePersistenceMapper persistenceMapper;
    private final EnforcementCaseEventMapper eventMapper;
    private final AuditMapper auditMapper;
    private final EventPublisher eventPublisher;
    private final AuditRepository auditRepository;
    private final Clock clock;

    @Transactional
    public CreateEnforcementCaseResult create(CreateEnforcementCaseCommand command) {
        validateCommand(command);

        CaseId caseId = caseIdGenerator.nextId();

        EnforcementCase aggregate = EnforcementCase.createNew(
                caseId,
                command.caseType(),
                toSubject(command.subject()),
                toIncident(command.incident()),
                toReporter(command.reporter()),
                toAttachments(command.attachments()),
                assignmentPolicy,
                clock,
                command.actor()
        );

        EnforcementCaseEntity entity = persistenceMapper.toEntity(aggregate);
        repository.save(entity);

        auditRepository.save(auditMapper.caseCreated(aggregate, command.requestContext()));
        eventPublisher.publish(eventMapper.caseCreatedV1(aggregate));

        return new CreateEnforcementCaseResult(
                aggregate.caseId().value(),
                aggregate.status(),
                aggregate.assignment().team(),
                aggregate.createdAt()
        );
    }
}
```

Command → aggregate bukan sekadar mapping karena ada orchestration:

- generate id,
- validate command,
- apply assignment policy,
- set timestamp,
- persist,
- audit,
- publish event.

MapStruct dapat membantu sub-value object, tetapi jangan biarkan MapStruct menjadi domain factory utama bila domain memiliki invariant penting.

---

## 5. Response Mapping

Response DTO harus minim dan stabil.

```java
public record CreateEnforcementCaseResponse(
        String caseId,
        String status,
        String assignedTeam,
        OffsetDateTime createdAt
) {}
```

Mapper:

```java
@Mapper(
        componentModel = "spring",
        unmappedTargetPolicy = ReportingPolicy.ERROR,
        uses = TimeMapper.class
)
public interface CreateCaseResponseMapper {

    @Mapping(target = "status", expression = "java(result.status().name())")
    @Mapping(target = "assignedTeam", expression = "java(result.assignedTeam().code())")
    CreateEnforcementCaseResponse toResponse(CreateEnforcementCaseResult result);
}
```

Response tidak perlu mengekspos semua internal field. Jangan mengembalikan entity. Jangan mengembalikan aggregate penuh jika use case hanya butuh acknowledgement.

---

## 6. Event Mapping

Event payload lebih stabil daripada internal model. Jangan publish entity atau aggregate langsung.

```java
public record EnforcementCaseCreatedEventV1(
        String eventId,
        String eventType,
        String eventVersion,
        String occurredAt,
        String caseId,
        String caseType,
        String status,
        String assignedTeam,
        SubjectPayload subject,
        IncidentPayload incident
) {}
```

Mapper:

```java
@Mapper(
        componentModel = "spring",
        unmappedTargetPolicy = ReportingPolicy.ERROR,
        uses = { TimeMapper.class }
)
public interface EnforcementCaseEventMapper {

    @Mapping(target = "eventId", expression = "java(java.util.UUID.randomUUID().toString())")
    @Mapping(target = "eventType", constant = "ENFORCEMENT_CASE_CREATED")
    @Mapping(target = "eventVersion", constant = "1")
    @Mapping(target = "occurredAt", expression = "java(TimeMapper.toIsoOffsetDateTime(java.time.Instant.now()))")
    @Mapping(target = "caseId", expression = "java(aggregate.caseId().value())")
    @Mapping(target = "caseType", expression = "java(aggregate.caseType().name())")
    @Mapping(target = "status", expression = "java(aggregate.status().name())")
    @Mapping(target = "assignedTeam", expression = "java(aggregate.assignment().team().code())")
    EnforcementCaseCreatedEventV1 caseCreatedV1(EnforcementCase aggregate);
}
```

Namun ada nuance penting: `UUID.randomUUID()` dan `Instant.now()` di mapper membuat mapper tidak deterministic. Untuk high-grade design, lebih baik event envelope dibuat oleh event factory yang menerima `Clock` dan id generator.

Versi lebih baik:

```java
public final class EventEnvelopeFactory {
    private final Clock clock;
    private final EventIdGenerator eventIdGenerator;

    public EventMetadata newMetadata(String eventType, int version) {
        return new EventMetadata(
                eventIdGenerator.nextId(),
                eventType,
                version,
                clock.instant()
        );
    }
}
```

Lalu mapper menerima metadata:

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface EnforcementCaseEventMapper {

    @Mapping(target = "eventId", source = "metadata.eventId")
    @Mapping(target = "eventType", source = "metadata.eventType")
    @Mapping(target = "eventVersion", expression = "java(String.valueOf(metadata.version()))")
    @Mapping(target = "occurredAt", expression = "java(TimeMapper.toIsoOffsetDateTime(metadata.occurredAt()))")
    EnforcementCaseCreatedEventV1 caseCreatedV1(
            EnforcementCase aggregate,
            EventMetadata metadata
    );
}
```

Prinsip:

> Mapper harus deterministic kecuali ada alasan sangat kuat.

---

## 7. Audit Mapping

Audit berbeda dari event. Event ditujukan untuk sistem lain. Audit ditujukan untuk traceability, investigation, legal defensibility, dan operational debugging.

Audit record bisa menyimpan:

- actor,
- action,
- entity id,
- before snapshot,
- after snapshot,
- field diff,
- raw request reference,
- correlation id,
- source IP atau channel,
- timestamp,
- reason/comment,
- redacted sensitive fields.

Contoh model:

```java
public record AuditRecord(
        String auditId,
        String entityType,
        String entityId,
        String action,
        String actorId,
        String correlationId,
        Instant occurredAt,
        JsonNode beforeSnapshot,
        JsonNode afterSnapshot,
        JsonNode diff,
        String remarks
) {}
```

Audit mapper tidak harus MapStruct murni karena sering butuh ObjectMapper untuk snapshot.

```java
@Component
public class AuditMapper {

    private final ObjectMapper auditObjectMapper;
    private final Clock clock;

    public AuditRecord caseCreated(EnforcementCase aggregate, RequestContext context) {
        JsonNode after = auditObjectMapper.valueToTree(toAuditSnapshot(aggregate));

        return new AuditRecord(
                UUID.randomUUID().toString(),
                "ENFORCEMENT_CASE",
                aggregate.caseId().value(),
                "CREATE",
                context.actorId(),
                context.correlationId(),
                clock.instant(),
                NullNode.getInstance(),
                after,
                after,
                null
        );
    }

    private EnforcementCaseAuditSnapshot toAuditSnapshot(EnforcementCase aggregate) {
        return new EnforcementCaseAuditSnapshot(
                aggregate.caseId().value(),
                aggregate.status().name(),
                aggregate.createdAt(),
                aggregate.assignment().team().code()
        );
    }
}
```

Audit snapshot tidak harus sama dengan response DTO, event DTO, atau entity. Ia punya tujuan sendiri.

---

## 8. External Integration Mapping

Misalnya external agency butuh XML payload:

```xml
<AgencyCaseNotification xmlns="https://example.gov/agency/case/v1">
  <CaseId>CASE-2026-000123</CaseId>
  <CaseType>UNLICENSED_ACTIVITY</CaseType>
  <SubjectName>ABC Trading Pte Ltd</SubjectName>
  <OccurredDate>2026-06-15</OccurredDate>
</AgencyCaseNotification>
```

External DTO:

```java
@JacksonXmlRootElement(
        localName = "AgencyCaseNotification",
        namespace = "https://example.gov/agency/case/v1"
)
public record AgencyCaseNotificationXmlV1(
        @JacksonXmlProperty(localName = "CaseId")
        String caseId,

        @JacksonXmlProperty(localName = "CaseType")
        String caseType,

        @JacksonXmlProperty(localName = "SubjectName")
        String subjectName,

        @JacksonXmlProperty(localName = "OccurredDate")
        String occurredDate
) {}
```

Integration mapper:

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface AgencyNotificationMapper {

    @Mapping(target = "caseId", expression = "java(aggregate.caseId().value())")
    @Mapping(target = "caseType", expression = "java(toAgencyCaseType(aggregate.caseType()))")
    @Mapping(target = "subjectName", expression = "java(aggregate.subject().name())")
    @Mapping(target = "occurredDate", expression = "java(aggregate.incident().occurredDate().toString())")
    AgencyCaseNotificationXmlV1 toAgencyXmlV1(EnforcementCase aggregate);

    default String toAgencyCaseType(CaseType caseType) {
        return switch (caseType) {
            case UNLICENSED_ACTIVITY -> "UA";
            case MISREPRESENTATION -> "MR";
            case DOCUMENT_FRAUD -> "DF";
        };
    }
}
```

External code mapping harus explicit. Jangan mengandalkan `.name()` jika external agency memiliki code table sendiri.

Untuk Java 8, ganti switch expression dengan switch statement biasa.

---

## 9. Package Structure

Contoh struktur module:

```text
com.example.enforcement
  ├── api
  │   ├── controller
  │   ├── dto
  │   └── mapper
  ├── application
  │   ├── command
  │   ├── result
  │   └── service
  ├── domain
  │   ├── model
  │   ├── policy
  │   └── event
  ├── persistence
  │   ├── entity
  │   ├── mapper
  │   └── repository
  ├── integration
  │   ├── agency
  │   │   ├── dto
  │   │   ├── mapper
  │   │   └── client
  ├── audit
  │   ├── dto
  │   ├── mapper
  │   └── repository
  └── config
      ├── JsonMapperConfiguration
      └── MapStructConfiguration
```

Aturan dependency:

```text
api.mapper → application.command
application.service → domain + persistence + event + audit
persistence.mapper → domain + persistence.entity
integration.mapper → domain + integration.dto

domain → no dependency to api/persistence/integration/jackson/mapstruct
```

Domain sebaiknya tidak tahu Jackson, JPA, MapStruct, Lombok, atau HTTP.

---

## 10. MapStruct Central Configuration

Jangan konfigurasi mapper satu per satu tanpa standard.

```java
@MapperConfig(
        componentModel = "spring",
        unmappedTargetPolicy = ReportingPolicy.ERROR,
        unmappedSourcePolicy = ReportingPolicy.WARN,
        nullValueCheckStrategy = NullValueCheckStrategy.ALWAYS,
        nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE,
        collectionMappingStrategy = CollectionMappingStrategy.ACCESSOR_ONLY
)
public interface CentralMapperConfig {
}
```

Mapper memakai config:

```java
@Mapper(
        config = CentralMapperConfig.class,
        uses = { CaseEnumMapper.class, DateMapper.class }
)
public interface CreateCaseApiMapper {
    // mapping methods
}
```

Catatan:

- `unmappedTargetPolicy = ERROR` cocok untuk critical mapping.
- `unmappedSourcePolicy = WARN` membantu mendeteksi source field tidak dipakai.
- Null strategy harus disesuaikan untuk create vs update. Jangan satu policy dipakai buta untuk semua use case.

Untuk update/PATCH mapper, biasanya perlu config khusus.

---

## 11. Jackson Profiles

Mapping layer production-grade biasanya butuh beberapa JSON profile.

### 11.1 External API Inbound

```java
public ObjectMapper externalInboundMapper() {
    return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .build();
}
```

Tujuan:

- fail fast,
- reject unknown field,
- hindari coercion mengejutkan,
- lebih aman terhadap contract drift.

### 11.2 External API Outbound

```java
public ObjectMapper externalOutboundMapper() {
    return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .serializationInclusion(JsonInclude.Include.NON_NULL)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .build();
}
```

Tujuan:

- stable format,
- no timestamp numeric surprise,
- control null contract.

### 11.3 Internal Event Mapper

```java
public ObjectMapper eventMapper() {
    return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .build();
}
```

Tujuan:

- tolerant reader,
- consumer tidak mati karena additive field,
- tetap konsisten date/time.

### 11.4 Audit Mapper

```java
public ObjectMapper auditMapper() {
    return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .build();
}
```

Audit mapper sering punya serializer khusus untuk masking.

---

## 12. Validation Boundary

Untuk endpoint create case, validation sebaiknya staged.

### 12.1 Stage 1 — JSON Parse/Bind

Menjawab:

- JSON valid?
- shape cocok?
- unknown field boleh/tidak?
- tipe primitive cocok?

Failure menjadi `400 Bad Request` dengan error path.

### 12.2 Stage 2 — DTO Validation

Menjawab:

- required field ada?
- string tidak blank?
- length sesuai?
- email format valid?
- attachment count limit?

Contoh:

```java
public record CreateEnforcementCaseRequest(
        @NotBlank String source,
        @NotBlank String caseType,
        @Valid @NotNull SubjectRequest subject,
        @Valid @NotNull IncidentRequest incident,
        @Valid ReporterRequest reporter,
        @Size(max = 10) List<@Valid AttachmentRequest> attachments
) {}
```

### 12.3 Stage 3 — Command Mapping

Menjawab:

- string external code bisa diubah menjadi enum internal?
- date bisa diparse?
- identifier bisa dinormalisasi?

Failure menjadi mapping/conversion error, tetap biasanya `400`.

### 12.4 Stage 4 — Application/Domain Validation

Menjawab:

- case type boleh dibuat oleh actor ini?
- subject valid terhadap policy?
- incident date tidak di masa depan?
- attachment benar-benar milik request ini?
- duplicate case check?

Failure bisa `400`, `403`, `409`, atau domain-specific error.

Jangan semua hal dipaksa masuk ke Bean Validation atau mapper.

---

## 13. Error Model

Mapping error harus bisa dibaca client dan bisa ditelusuri engineer.

Contoh external error:

```json
{
  "errorCode": "INVALID_REQUEST_BODY",
  "message": "Request body contains invalid fields.",
  "correlationId": "corr-20260617-abc123",
  "violations": [
    {
      "path": "/incident/occurredDate",
      "code": "INVALID_DATE",
      "message": "occurredDate must use ISO-8601 date format yyyy-MM-dd."
    }
  ]
}
```

Internal log:

```text
level=WARN
correlationId=corr-20260617-abc123
errorCode=INVALID_DATE
jsonPointer=/incident/occurredDate
rawValueHash=sha256:...
clientId=public-portal
endpoint=POST /api/v1/enforcement-cases
```

Prinsip:

- external error cukup jelas tapi tidak membocorkan internal class/stacktrace,
- internal log cukup diagnostik,
- payload sensitif tidak dicetak mentah,
- path field harus presisi.

---

## 14. Security Review

Mapping security checklist untuk capstone:

### 14.1 Over-Posting

Jangan pernah menerima entity sebagai request body.

Buruk:

```java
@PostMapping
public CaseEntity create(@RequestBody CaseEntity entity) {
    return repository.save(entity);
}
```

Aman:

```java
@PostMapping
public CreateEnforcementCaseResponse create(
        @Valid @RequestBody CreateEnforcementCaseRequest request,
        Authentication authentication
) {
    Actor actor = actorResolver.resolve(authentication);
    RequestContext context = requestContextFactory.current();
    CreateEnforcementCaseCommand command = mapper.toCommand(request, actor, context);
    return responseMapper.toResponse(service.create(command));
}
```

### 14.2 Sensitive Output Leakage

Response DTO harus deny-by-default. Jangan `toDto(entity)` untuk semua field.

Field seperti:

- internal notes,
- investigation strategy,
- personal identifier,
- raw reporter phone/email,
- audit metadata,
- role/security field,
- DB version,
- deleted flag,

tidak boleh otomatis keluar.

### 14.3 Polymorphic Deserialization

Jangan aktifkan default typing global untuk untrusted input.

Hindari:

```java
objectMapper.activateDefaultTyping(...);
```

Gunakan explicit discriminator dan whitelist subtype bila perlu.

### 14.4 XML Parser Safety

Untuk XML inbound:

- disable external entity,
- disable DTD jika tidak perlu,
- set secure processing,
- limit payload size,
- validate namespace.

---

## 15. Persistence Mapping Review

### 15.1 Entity to Domain

```java
@Mapper(config = CentralMapperConfig.class)
public interface EnforcementCasePersistenceMapper {

    @Mapping(target = "caseId", expression = "java(new CaseId(entity.getCaseId()))")
    @Mapping(target = "caseType", expression = "java(CaseType.valueOf(entity.getCaseType()))")
    @Mapping(target = "status", expression = "java(CaseStatus.valueOf(entity.getStatus()))")
    EnforcementCase toDomain(EnforcementCaseEntity entity);

    @InheritInverseConfiguration
    EnforcementCaseEntity toEntity(EnforcementCase aggregate);
}
```

Namun untuk aggregate dengan private constructor dan invariant, inverse mapping sering tidak trivial. Untuk persistence rehydration, domain biasanya butuh factory khusus:

```java
public static EnforcementCase rehydrate(
        CaseId caseId,
        CaseType caseType,
        CaseStatus status,
        Subject subject,
        Incident incident,
        Reporter reporter,
        List<CaseAttachment> attachments,
        Assignment assignment,
        Instant createdAt,
        Actor createdBy
) {
    return new EnforcementCase(
            caseId,
            caseType,
            status,
            subject,
            incident,
            reporter,
            attachments,
            assignment,
            createdAt,
            createdBy
    );
}
```

Creation dan rehydration berbeda:

- creation menerapkan policy baru,
- rehydration mengembalikan state yang sudah sah dari DB.

Jangan memakai `createNew` untuk load dari database.

### 15.2 Avoid Lazy Loading Trap

Jika response butuh list case, jangan load entity penuh lalu mapping nested graph.

Lebih baik projection:

```java
public interface CaseListProjection {
    String getCaseId();
    String getCaseType();
    String getStatus();
    String getSubjectName();
    Instant getCreatedAt();
}
```

Response mapper:

```java
public record CaseListItemResponse(
        String caseId,
        String caseType,
        String status,
        String subjectName,
        OffsetDateTime createdAt
) {}
```

Prinsip:

> Untuk query/listing, mapping terbaik sering dimulai dari projection query, bukan entity graph.

---

## 16. Testing Strategy untuk Capstone

### 16.1 Mapper Unit Tests

```java
class CreateCaseApiMapperTest {

    private final CreateCaseApiMapper mapper = Mappers.getMapper(CreateCaseApiMapper.class);

    @Test
    void shouldMapValidRequestToCommand() {
        CreateEnforcementCaseRequest request = fixtureRequest();
        Actor actor = new Actor("user-1", "Officer One");
        RequestContext context = new RequestContext("corr-1", "PUBLIC_PORTAL");

        CreateEnforcementCaseCommand command = mapper.toCommand(request, actor, context);

        assertThat(command.caseType()).isEqualTo(CaseType.UNLICENSED_ACTIVITY);
        assertThat(command.subject().identifier().type()).isEqualTo(IdentifierType.UEN);
        assertThat(command.actor()).isEqualTo(actor);
    }
}
```

### 16.2 Golden Payload Tests

Store sample JSON:

```text
src/test/resources/contracts/create-case/request-valid-v1.json
src/test/resources/contracts/create-case/response-valid-v1.json
src/test/resources/contracts/events/case-created-v1.json
```

Test:

```java
@Test
void responseJsonShouldMatchGoldenPayload() throws Exception {
    CreateEnforcementCaseResponse response = fixtureResponse();

    String actual = objectMapper.writeValueAsString(response);
    String expected = readResource("contracts/create-case/response-valid-v1.json");

    JSONAssert.assertEquals(expected, actual, true);
}
```

### 16.3 Negative Deserialization Tests

Test case:

- unknown field rejected,
- wrong date format rejected,
- enum unknown rejected,
- null required field rejected,
- trailing token rejected,
- unexpected object/array shape rejected.

### 16.4 Compatibility Tests

For event V1:

- old consumer can read event with additive field,
- renamed field fails unless alias supported,
- removed field fails if required,
- enum addition handled or rejected intentionally.

### 16.5 Persistence Mapping Tests

Test:

- entity → domain preserves all critical fields,
- domain → entity does not lose status/version/audit fields,
- list projection mapping does not trigger lazy load,
- bidirectional cycles are not serialized.

---

## 17. Performance Review

### 17.1 Hot Path Classification

Not all mapping needs optimization.

| Path | Optimization Level |
|---|---|
| single create request | correctness first |
| admin detail page | moderate |
| list page 10,000 rows | projection + pagination |
| batch import 1M rows | streaming + chunking |
| event consumer high throughput | ObjectReader/ObjectWriter reuse |
| audit snapshot huge object | selective snapshot |

### 17.2 Avoid Object Graph Explosion

Bad:

```java
List<CaseResponse> responses = cases.stream()
        .map(caseMapper::toFullResponse)
        .toList();
```

If `toFullResponse` maps nested documents, comments, assignments, audit, and related cases, a simple listing becomes expensive.

Better:

```java
Page<CaseListProjection> page = repository.findCaseList(criteria, pageable);
return page.map(caseListMapper::toResponse);
```

### 17.3 Large JSON/XML

For large imports:

- use Jackson streaming,
- validate item by item,
- process in chunks,
- avoid full `List<T>` in memory,
- emit per-row diagnostics,
- use backpressure or bounded queue if asynchronous.

---

## 18. Governance Checklist

A production-grade mapping layer should have explicit policy.

### 18.1 DTO Policy

- Request DTO must not be entity.
- Response DTO must be use-case-specific.
- Event DTO must be versioned.
- External DTO must be isolated per partner/system.
- Audit DTO/snapshot must be separate.

### 18.2 Jackson Policy

- No global unsafe default typing.
- External inbound mapper strict by default.
- Internal event consumer tolerant by design.
- Date/time serialized as ISO string unless explicitly documented otherwise.
- Null inclusion documented per API.
- Sensitive fields redacted/masked explicitly.

### 18.3 MapStruct Policy

- `unmappedTargetPolicy = ERROR` for critical mappers.
- Generated code inspected for non-trivial mappers.
- No hidden DB/network call in mapper.
- `@Context` allowed only for deterministic mapping context.
- Update mapper has separate null strategy.

### 18.4 Lombok Policy

- `@Data` forbidden for JPA entity and API DTO in critical modules unless justified.
- `@Getter` and constructor annotations allowed selectively.
- `@Builder` allowed for test fixture and immutable internal DTO, but checked with Jackson/MapStruct compatibility.
- Prefer records for simple immutable DTO on Java 16+ where suitable.
- `equals/hashCode` on entity must follow persistence identity rules, not blind Lombok generation.

### 18.5 Review Questions

Every new mapper should answer:

1. Which boundary does this mapper belong to?
2. Who owns this contract?
3. Is this mapping structural or semantic?
4. Can this mapping lose data silently?
5. What happens when a new field is added?
6. What happens when a field is renamed?
7. Is null different from absent here?
8. Are we leaking internal fields?
9. Can this trigger lazy loading?
10. Is this mapper deterministic?
11. Is it tested with negative cases?
12. Does it preserve compatibility?

---

## 19. Java 8 to Java 25 Variant Strategy

### 19.1 Java 8 Style

Use classes:

```java
public final class CreateEnforcementCaseResponse {
    private final String caseId;
    private final String status;
    private final String assignedTeam;
    private final OffsetDateTime createdAt;

    public CreateEnforcementCaseResponse(
            String caseId,
            String status,
            String assignedTeam,
            OffsetDateTime createdAt
    ) {
        this.caseId = caseId;
        this.status = status;
        this.assignedTeam = assignedTeam;
        this.createdAt = createdAt;
    }

    public String getCaseId() { return caseId; }
    public String getStatus() { return status; }
    public String getAssignedTeam() { return assignedTeam; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
```

Or Lombok:

```java
@Value
@Builder
public class CreateEnforcementCaseResponse {
    String caseId;
    String status;
    String assignedTeam;
    OffsetDateTime createdAt;
}
```

### 19.2 Java 16+ / 21 / 25 Style

Use records for simple immutable DTO:

```java
public record CreateEnforcementCaseResponse(
        String caseId,
        String status,
        String assignedTeam,
        OffsetDateTime createdAt
) {}
```

Use sealed types for controlled polymorphic model:

```java
public sealed interface CaseSubject permits IndividualSubject, CompanySubject {
}

public record IndividualSubject(String name, String idNo) implements CaseSubject {
}

public record CompanySubject(String name, String uen) implements CaseSubject {
}
```

But do not migrate everything blindly. Records are excellent for data carriers, not always for ORM entities or complex mutable lifecycle objects.

---

## 20. Full End-to-End Sequence

```text
1. Client sends JSON.
2. HTTP framework reads body.
3. External inbound ObjectMapper parses JSON strictly.
4. JSON binds to CreateEnforcementCaseRequest.
5. Bean Validation validates DTO shape.
6. Controller resolves Actor and RequestContext.
7. API mapper converts request DTO to command.
8. Application service validates command semantic.
9. Domain factory creates aggregate using policy, id generator, and clock.
10. Persistence mapper converts aggregate to entity.
11. Repository saves entity.
12. Audit mapper creates audit record.
13. Event factory creates metadata.
14. Event mapper creates EnforcementCaseCreatedEventV1.
15. Event publisher serializes event with event ObjectMapper.
16. Response mapper creates response DTO.
17. External outbound ObjectMapper serializes response.
```

This is verbose by design. Each boundary has clear ownership.

---

## 21. Common Failure Modes and Fixes

### 21.1 New Field Added to Request but Ignored

Symptom:

- frontend sends `priority`, backend ignores silently.

Fix:

- `unmappedTargetPolicy = ERROR` for command mapping,
- DTO validation,
- contract test,
- review checklist.

### 21.2 Entity Field Leaked to API

Symptom:

- response includes `deleted`, `version`, `internalNotes`.

Fix:

- never serialize entity,
- response DTO per use case,
- deny-by-default output design.

### 21.3 Lazy Loading Explosion

Symptom:

- list endpoint suddenly does hundreds of queries.

Fix:

- projection query,
- fetch plan review,
- mapper test with SQL count,
- avoid full graph mapping in listing.

### 21.4 Event Consumer Breaks After Producer Change

Symptom:

- producer renames `caseId` to `id`.

Fix:

- version event,
- never rename in-place,
- consumer-driven contract test,
- tolerant reader for additive fields.

### 21.5 Mapper Performs Hidden Lookup

Symptom:

- mapping slow and flaky because mapper calls repository/external service.

Fix:

- move lookup to application service,
- pass resolved reference via `@Context` only if deterministic and preloaded,
- keep mapper pure where possible.

---

## 22. Capstone Final Reference Architecture

```text
                       ┌──────────────────────┐
                       │      HTTP Client      │
                       └──────────┬───────────┘
                                  │ JSON
                                  ▼
                     ┌─────────────────────────┐
                     │ External API ObjectMapper│
                     └──────────┬──────────────┘
                                │
                                ▼
                     ┌─────────────────────────┐
                     │ Request DTO              │
                     └──────────┬──────────────┘
                                │ validate shape
                                ▼
                     ┌─────────────────────────┐
                     │ API Mapper               │
                     └──────────┬──────────────┘
                                │
                                ▼
                     ┌─────────────────────────┐
                     │ Application Command      │
                     └──────────┬──────────────┘
                                │ semantic validation
                                ▼
                     ┌─────────────────────────┐
                     │ Application Service      │
                     └───────┬───────┬─────────┘
                             │       │
                  create     │       │ publish/audit
                             ▼       ▼
              ┌────────────────┐   ┌────────────────────┐
              │ Domain Aggregate│   │ Event/Audit Mapper  │
              └───────┬────────┘   └─────────┬──────────┘
                      │                      │
                      ▼                      ▼
              ┌────────────────┐   ┌────────────────────┐
              │ Persistence     │   │ Event/Audit Payload │
              │ Mapper          │   └────────────────────┘
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │ JPA Entity / DB │
              └────────────────┘
```

---

## 23. Final Top 1% Mapping Engineer Checklist

A top-tier engineer does not ask only “how do I map A to B?” They ask:

1. What boundary am I crossing?
2. What meaning changes across this boundary?
3. Which model owns the contract?
4. Which fields are allowed inbound?
5. Which fields are allowed outbound?
6. What fields are required, nullable, optional, deprecated, or ignored?
7. What happens when clients send unknown fields?
8. What happens when producers add new fields?
9. What is the versioning strategy?
10. Is polymorphism safe and explicit?
11. Is XML namespace/signature behavior stable?
12. Is ObjectMapper shared safely?
13. Is MapStruct generated code inspected?
14. Is Lombok reducing boilerplate or hiding behavior?
15. Are records suitable here?
16. Does mapping trigger database access?
17. Does mapping allocate too much?
18. Does mapping leak sensitive fields?
19. Does error reporting identify exact field path?
20. Are golden payloads tested?
21. Are negative payloads tested?
22. Are compatibility rules tested?
23. Is the mapper deterministic?
24. Are business decisions outside the mapper?
25. Can a new engineer understand the mapping ownership quickly?

If the answer to these questions is clear, the mapping layer is not accidental. It is engineered.

---

## 24. Summary

Production-grade mapping layer is a system of boundaries.

Jackson controls runtime JSON/XML shape and binding. MapStruct controls compile-time object transformation. Lombok can reduce boilerplate but must be governed. Records provide modern immutable DTOs. Manual mapping remains essential for semantic boundaries. Testing, contract governance, security review, and performance profiling turn mapping from “glue code” into reliable infrastructure.

The most important lesson of the whole series:

> Data mapping is not about moving fields. It is about preserving meaning while crossing boundaries.

When meaning changes, mapping must be explicit. When contracts evolve, mapping must be tested. When data crosses trust boundaries, mapping must be secure. When systems grow, mapping must be governed.

That is the difference between basic DTO conversion and engineering-grade transformation architecture.

---

## 25. Series Completion

This is **Part 35 of 35**.

The series `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering` is now complete.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./34-migration-playbook-java-8-legacy-to-java-25-modern-mapping-stack.md">⬅️ Part 34 — Migration Playbook: Java 8 Legacy to Java 25 Modern Mapping Stack</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
