# Part 3 — DTO Design: API DTO, Domain DTO, Persistence DTO, Event DTO

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `03-dto-design-api-domain-persistence-event-dto.md`  
> Status: Part 3 dari 35  
> Target pembaca: Java engineer yang ingin mendesain layer transformasi data secara eksplisit, aman, evolvable, dan production-grade.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita membedakan jenis transformasi: copy, convert, normalize, enrich, redact, project, aggregate, dan defaulting. Sekarang kita masuk ke keputusan desain yang sering menjadi akar masalah di codebase enterprise:

> Apakah satu class data bisa dipakai untuk semua layer?

Jawaban praktisnya: **kadang bisa untuk sistem kecil, tetapi hampir selalu berbahaya untuk sistem enterprise yang punya lifecycle panjang, banyak aktor, banyak integrasi, dan banyak perubahan kontrak.**

DTO sering dianggap hanya class sederhana yang berisi field. Ini framing yang terlalu dangkal. Dalam sistem yang serius, DTO adalah **bentuk kontrak di boundary tertentu**.

DTO menjawab pertanyaan:

- data ini sedang melewati boundary apa?
- siapa konsumennya?
- field ini bermakna apa di boundary tersebut?
- field ini boleh berasal dari user, sistem internal, database, atau service lain?
- field ini wajib, opsional, deprecated, computed, sensitive, atau read-only?
- apakah bentuk data ini stabil secara kontrak atau bebas berubah bersama implementation?
- apakah object ini mewakili intent, state, event, projection, atau persistence shape?

Bagian ini akan membangun mental model agar kamu tidak sekadar membuat class `SomethingDto`, tetapi mampu merancang family DTO yang tepat untuk API, domain application layer, persistence projection, eventing, integration, audit, dan reporting.

---

## 2. Core Mental Model: DTO Adalah Boundary Contract, Bukan Data Bag

DTO adalah **Data Transfer Object**. Tetapi istilah ini sering menyesatkan karena seolah-olah tugasnya hanya “memindahkan data”. Dalam sistem modern, DTO lebih tepat dipahami sebagai:

> **Object shape yang mewakili kontrak komunikasi antara dua boundary dengan ownership, lifecycle, dan semantic expectation yang berbeda.**

Boundary bisa berupa:

- frontend ke backend
- API gateway ke service
- controller ke application service
- application service ke domain command handler
- domain ke event bus
- service ke database projection query
- service ke external API
- batch job ke file export
- internal module ke module lain
- public API v1 ke public API v2
- audit subsystem ke reporting subsystem

Setiap boundary punya bahasa, aturan, dan risiko berbeda.

Contoh sederhana:

```java
public class UserDto {
    public Long id;
    public String username;
    public String password;
    public String role;
    public Boolean active;
    public Instant createdAt;
    public Instant updatedAt;
}
```

Class ini tampak nyaman, tetapi berbahaya bila dipakai untuk:

- request create user
- response user detail
- update user
- admin list user
- public profile
- internal domain command
- database projection
- audit event

Kenapa?

Karena setiap use case punya ownership field berbeda:

| Field | Create Request | Update Request | API Response | Domain | Audit Event |
|---|---:|---:|---:|---:|---:|
| `id` | tidak boleh dari user | mungkin path param | boleh tampil | identity | wajib |
| `username` | user input | mungkin immutable | boleh tampil | invariant | wajib |
| `password` | raw input sementara | tidak boleh tampil | tidak boleh tampil | credential policy | tidak boleh raw |
| `role` | mungkin admin only | admin only | mungkin masked | authorization model | wajib old/new |
| `active` | mungkin default | admin action | tampil | state machine | wajib transition |
| `createdAt` | server generated | tidak boleh input | tampil | metadata | wajib |
| `updatedAt` | server generated | tidak boleh input | tampil | metadata | wajib |

Satu DTO tidak bisa membawa semua aturan ini dengan aman tanpa banyak conditional logic, annotation conflict, dan accidental exposure.

---

## 3. Kesalahan Umum: Nama DTO Dipakai Terlalu Generik

Nama seperti ini sering menjadi sumber ambiguitas:

```java
UserDto
ApplicationDto
CaseDto
OrderDto
PaymentDto
DocumentDto
```

Nama tersebut tidak menjawab:

- DTO ini untuk request atau response?
- untuk create, update, detail, list, atau event?
- untuk admin atau public?
- untuk API external atau internal?
- untuk v1 atau v2?
- field mana yang authoritative?

Di codebase kecil, nama generik terasa praktis. Di codebase besar, nama generik menciptakan hidden coupling.

Lebih baik:

```java
CreateUserRequest
UpdateUserRequest
UserDetailResponse
UserListItemResponse
UserAdminDetailResponse
UserProfileResponse
UserCreatedEventPayload
UserStatusChangedEventPayload
UserSearchProjection
ExternalUserProfilePayload
```

Nama DTO yang eksplisit adalah dokumentasi arsitektur.

---

## 4. DTO Berdasarkan Peran Utama

Kita bisa membagi DTO menjadi beberapa kategori besar:

1. **API Request DTO**
2. **API Response DTO**
3. **Application Command DTO / Command Object**
4. **Application Query DTO / Query Criteria**
5. **Domain-facing Intent Model**
6. **Persistence Projection DTO**
7. **Event DTO / Message Payload**
8. **Integration DTO / External Contract DTO**
9. **Audit DTO**
10. **Report/Export DTO**
11. **Internal Transport DTO**

Masing-masing punya design pressure berbeda.

---

# 5. API Request DTO

API Request DTO adalah shape data yang diterima dari client.

Contoh:

```java
public record CreateUserRequest(
        String username,
        String email,
        String password,
        String displayName
) {}
```

## 5.1 Request DTO Mewakili Input, Bukan State

Request DTO bukan representasi database row. Request DTO adalah representasi **intent dari client**.

Create user request tidak seharusnya memiliki:

```java
Long id;
Instant createdAt;
Instant updatedAt;
boolean active;
String createdBy;
```

Field tersebut milik server, domain, atau persistence layer.

Request create user biasanya hanya berisi:

- field yang client boleh submit
- field yang relevan untuk intent create
- field yang bisa divalidasi di boundary input

## 5.2 Jangan Memakai Entity sebagai Request DTO

Anti-pattern:

```java
@PostMapping("/users")
public UserEntity create(@RequestBody UserEntity user) {
    return userRepository.save(user);
}
```

Masalah:

- client bisa mengisi field internal
- client bisa memanipulasi relationship
- lazy proxy/ORM detail bocor ke API
- validation menjadi campur dengan persistence annotation
- API contract ikut berubah saat entity berubah
- raw password atau sensitive field bisa tersimpan tanpa policy
- over-posting vulnerability

Request DTO harus menjadi **deny-by-default input surface**.

Artinya: field tidak boleh diterima kecuali memang didesain untuk diterima.

## 5.3 Request DTO Harus Use-Case Specific

Contoh create dan update tidak sama.

```java
public record CreateCaseRequest(
        String applicantId,
        String caseType,
        String description,
        List<CreateCaseAttachmentRequest> attachments
) {}
```

```java
public record UpdateCaseDescriptionRequest(
        String description,
        String changeReason
) {}
```

```java
public record AssignCaseRequest(
        String assigneeUserId,
        String assignmentReason
) {}
```

Jangan pakai:

```java
public class CaseDto {
    public String applicantId;
    public String caseType;
    public String description;
    public String assigneeUserId;
    public String assignmentReason;
    public String status;
    public Instant createdAt;
    public Instant updatedAt;
}
```

Kenapa?

Karena create case, update description, assign case, dan transition status adalah intent berbeda. Kalau digabung, validasi dan security menjadi conditional jungle.

## 5.4 Request DTO dan Validation

Request DTO boleh memiliki validation annotation karena ia berada di input boundary.

```java
public record CreateUserRequest(
        @NotBlank
        @Size(max = 50)
        String username,

        @NotBlank
        @Email
        String email,

        @NotBlank
        @Size(min = 12, max = 128)
        String password
) {}
```

Tetapi hati-hati: validation annotation di DTO hanya menjawab **input validity**, bukan domain truth.

Contoh:

```java
@Email
String email;
```

Ini hanya memastikan format email masuk akal. Bukan memastikan email unik, verified, allowed domain, atau tidak blacklist.

## 5.5 Request DTO Tidak Boleh Menjadi Domain Object

Request DTO biasanya masih penuh representasi user/API:

```json
{
  "case_type": "COMPLAINT",
  "postal_code": " 123456 ",
  "preferred_contact_method": "email"
}
```

Domain mungkin butuh bentuk yang sudah dinormalisasi:

```java
public record CreateComplaintCommand(
        CaseType caseType,
        PostalCode postalCode,
        ContactPreference contactPreference,
        Actor actor,
        Instant requestedAt
) {}
```

Request DTO adalah raw boundary shape. Command adalah application intent yang sudah lebih dekat dengan bahasa sistem.

---

# 6. API Response DTO

API Response DTO adalah bentuk data yang dikembalikan ke client.

Contoh:

```java
public record UserDetailResponse(
        Long id,
        String username,
        String email,
        String displayName,
        String status,
        Instant createdAt
) {}
```

## 6.1 Response DTO Mewakili View, Bukan Entity

Response DTO harus menjawab:

- siapa pembacanya?
- data apa yang perlu mereka lihat?
- data apa yang tidak boleh mereka lihat?
- apakah field ini computed?
- apakah response ini untuk detail, list, summary, export, atau admin?

Contoh:

```java
public record CaseListItemResponse(
        String caseId,
        String caseNumber,
        String caseType,
        String status,
        String assignedOfficerName,
        Instant submittedAt
) {}
```

```java
public record CaseDetailResponse(
        String caseId,
        String caseNumber,
        String caseType,
        String status,
        ApplicantSummaryResponse applicant,
        List<DocumentSummaryResponse> documents,
        List<CaseTimelineItemResponse> timeline
) {}
```

List item dan detail response tidak harus memakai class yang sama. List item biasanya optimized untuk table/grid. Detail response biasanya membawa graph lebih lengkap.

## 6.2 Jangan Mengembalikan Entity ke Client

Anti-pattern:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Risiko:

- lazy loading meledak saat serialization
- circular reference
- field internal bocor
- database schema menjadi API contract
- perubahan entity menjadi breaking API change
- audit/internal metadata tampil
- performance tidak terkontrol

## 6.3 Response DTO Bisa Mengandung Derived Field

Contoh:

```java
public record CaseDetailResponse(
        String caseNumber,
        String status,
        boolean editable,
        boolean cancellable,
        List<String> allowedActions
) {}
```

`editable`, `cancellable`, dan `allowedActions` bukan field database murni. Mereka adalah hasil policy/projection untuk UI.

Tetapi hati-hati: jangan menaruh policy kompleks di mapper tanpa batas. Lebih baik policy dihitung di application service atau dedicated policy component, lalu mapper hanya menyusun response.

## 6.4 Response DTO Harus Mengendalikan Sensitive Data

Contoh buruk:

```java
public record UserResponse(
        Long id,
        String email,
        String passwordHash,
        String resetToken,
        String mfaSecret
) {}
```

Contoh lebih aman:

```java
public record UserSecurityResponse(
        Long id,
        String email,
        boolean mfaEnabled,
        Instant lastPasswordChangedAt
) {}
```

Prinsipnya:

> Jangan mengandalkan `@JsonIgnore` di entity sebagai satu-satunya mekanisme keamanan response.

Lebih aman menggunakan response DTO yang memang tidak memiliki field sensitive.

---

# 7. Command DTO / Application Command

Command adalah object yang mewakili **intent untuk mengubah state**.

Contoh:

```java
public record SubmitApplicationCommand(
        ApplicantId applicantId,
        ApplicationType applicationType,
        List<DocumentId> documentIds,
        Actor submittedBy,
        Instant submittedAt
) {}
```

## 7.1 Command Bukan Request DTO

Request DTO berasal dari API boundary:

```java
public record SubmitApplicationRequest(
        String applicantId,
        String applicationType,
        List<String> documentIds
) {}
```

Command berasal dari application layer:

```java
public record SubmitApplicationCommand(
        ApplicantId applicantId,
        ApplicationType applicationType,
        List<DocumentId> documentIds,
        Actor submittedBy,
        Instant submittedAt,
        CorrelationId correlationId
) {}
```

Perbedaannya:

| Aspek | Request DTO | Command |
|---|---|---|
| Sumber | Client/API | Application layer |
| Bahasa | External/API language | Internal/use-case language |
| Actor | mungkin dari security context | eksplisit |
| Time | biasanya tidak dari client | server authoritative |
| Type | string/raw primitive | value object/domain-ish type |
| Validasi | input constraint | use-case precondition |
| Lifecycle | API contract | internal application contract |

## 7.2 Command Harus Intent-Specific

Jangan buat:

```java
public record UpdateCaseCommand(
        String caseId,
        String status,
        String assignee,
        String description,
        String closureReason,
        String appealReason
) {}
```

Lebih baik:

```java
public record AssignCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        Actor assignedBy,
        String reason
) {}
```

```java
public record CloseCaseCommand(
        CaseId caseId,
        ClosureReason reason,
        Actor closedBy,
        Instant closedAt
) {}
```

```java
public record LodgeAppealCommand(
        CaseId caseId,
        String appealReason,
        Actor lodgedBy,
        Instant lodgedAt
) {}
```

Command yang spesifik membuat invariant lebih jelas.

## 7.3 Command Tidak Harus Serializable

Tidak semua command perlu JSON annotation. Kalau command hanya internal Java object, jangan cemari dengan annotation API:

```java
public record ApproveApplicationCommand(
        ApplicationId applicationId,
        OfficerId approvedBy,
        ApprovalRemarks remarks,
        Instant approvedAt
) {}
```

Tidak perlu:

```java
@JsonProperty("application_id")
@Schema(description = "...")
```

Boundary internal tidak perlu membawa beban external contract.

---

# 8. Query DTO / Query Criteria

Query DTO mewakili intent membaca data.

Contoh:

```java
public record SearchCaseRequest(
        String keyword,
        String status,
        String assignedTo,
        LocalDate submittedFrom,
        LocalDate submittedTo,
        Integer page,
        Integer size,
        String sort
) {}
```

Lalu ditransformasi ke internal query criteria:

```java
public record SearchCaseCriteria(
        Optional<String> keyword,
        Set<CaseStatus> statuses,
        Optional<OfficerId> assignedTo,
        Optional<DateRange> submittedDateRange,
        PageRequest pageRequest
) {}
```

## 8.1 Query DTO Sering Butuh Normalization

Input dari API bisa berupa:

- empty string
- whitespace
- comma-separated values
- timezone-dependent date
- default page size
- alias sort field

Contoh:

```java
public record SearchCaseRequest(
        String keyword,
        List<String> statuses,
        String submittedFrom,
        String submittedTo,
        Integer page,
        Integer size
) {}
```

Mapper/application translator perlu mengubahnya menjadi:

```java
public record SearchCaseCriteria(
        Optional<String> normalizedKeyword,
        Set<CaseStatus> statuses,
        Optional<LocalDate> submittedFrom,
        Optional<LocalDate> submittedTo,
        PageSpec page
) {}
```

## 8.2 Query DTO Harus Aman terhadap Field Injection

Sort adalah area rawan.

Jangan langsung:

```java
String sort = request.sort();
query.orderBy(sort);
```

Gunakan whitelist:

```java
public enum CaseSortField {
    SUBMITTED_AT,
    CASE_NUMBER,
    STATUS
}
```

Atau mapping alias:

```java
Map<String, String> allowedSortColumns = Map.of(
    "submittedAt", "c.submitted_at",
    "caseNumber", "c.case_number",
    "status", "c.status"
);
```

API field name tidak harus sama dengan database column.

---

# 9. Persistence Projection DTO

Persistence projection DTO adalah DTO yang dipakai untuk mengambil data dari database secara efisien, biasanya untuk read model/list/report.

Contoh:

```java
public record CaseListProjection(
        Long caseId,
        String caseNumber,
        String caseType,
        String status,
        String assignedOfficerName,
        Instant submittedAt
) {}
```

## 9.1 Projection DTO Berbeda dari API Response DTO

Projection DTO dekat dengan query/database shape. Response DTO dekat dengan API/client shape.

Kadang bentuknya sama. Tapi jangan langsung anggap sama.

Projection:

```java
public record CaseListProjection(
        Long caseId,
        String caseNo,
        String statusCode,
        String officerDisplayName,
        Timestamp submittedAt
) {}
```

Response:

```java
public record CaseListItemResponse(
        String id,
        String caseNumber,
        String status,
        String assignedOfficerName,
        Instant submittedAt
) {}
```

Perbedaannya:

- `Long` internal id bisa diubah ke public string id
- `caseNo` menjadi `caseNumber`
- `statusCode` menjadi display/API enum
- `Timestamp` menjadi `Instant`
- internal naming tidak bocor ke API

## 9.2 Projection Menghindari Entity Graph Explosion

Untuk list page, jangan load entity lengkap jika hanya butuh 8 field.

Anti-pattern:

```java
List<CaseEntity> cases = caseRepository.findAll(spec, pageable);
return cases.stream()
        .map(caseMapper::toListItemResponse)
        .toList();
```

Risiko:

- N+1 query
- lazy loading tidak sengaja
- object graph besar
- memory tinggi
- serialization lambat

Lebih baik untuk read-heavy query:

```java
List<CaseListProjection> rows = caseQueryRepository.search(criteria);
return rows.stream()
        .map(caseMapper::toListItemResponse)
        .toList();
```

## 9.3 Projection DTO Boleh “Database-ish”, Tapi Jangan Bocor

Projection DTO boleh memiliki field yang lebih teknis:

```java
public record CaseAgingProjection(
        Long caseId,
        String caseNo,
        String statusCode,
        Integer agingDays,
        String slaBandCode
) {}
```

Tapi API response bisa lebih friendly:

```java
public record CaseAgingResponse(
        String caseNumber,
        String status,
        int agingDays,
        String slaBand,
        boolean overdue
) {}
```

---

# 10. Event DTO / Message Payload

Event DTO adalah shape data yang dikirim melalui message broker, event bus, outbox table, audit stream, atau integration channel.

Contoh:

```java
public record CaseSubmittedEventPayload(
        String eventId,
        String eventType,
        String eventVersion,
        Instant occurredAt,
        String caseId,
        String caseNumber,
        String applicantId,
        String submittedBy
) {}
```

## 10.1 Event DTO Bukan Response DTO

Response DTO menjawab client saat ini. Event DTO menjawab consumer yang mungkin ada sekarang atau nanti.

Response DTO boleh berubah lebih sering. Event DTO harus jauh lebih stabil.

Jangan reuse response DTO sebagai event:

```java
publisher.publish(caseDetailResponse);
```

Masalah:

- response field bisa berubah karena UI
- event consumer terkena perubahan UI
- response mungkin punya derived field yang tidak cocok untuk event
- event butuh metadata seperti event id, version, occurredAt
- event butuh semantic transition, bukan hanya snapshot

## 10.2 Event Harus Menyatakan Fakta yang Sudah Terjadi

Nama event sebaiknya past tense:

```java
CaseSubmitted
CaseAssigned
CaseClosed
ApplicationApproved
DocumentUploaded
PaymentReceived
```

Hindari event ambigu:

```java
CaseUpdate
ApplicationData
UserMessage
StatusChanged
```

`StatusChanged` terlalu generik jika tidak membawa from/to dan context.

Lebih baik:

```java
public record CaseStatusChangedEventPayload(
        String eventId,
        String eventVersion,
        Instant occurredAt,
        String caseId,
        String previousStatus,
        String newStatus,
        String changedBy,
        String reason
) {}
```

## 10.3 Event Payload Perlu Versioning

Event payload hampir selalu butuh versi.

```java
public record CaseSubmittedEventV1(
        String eventId,
        Instant occurredAt,
        String caseId,
        String caseNumber,
        String applicantId
) {}
```

Saat berubah:

```java
public record CaseSubmittedEventV2(
        String eventId,
        Instant occurredAt,
        String caseId,
        String caseNumber,
        String applicantId,
        String submissionChannel
) {}
```

Atau gunakan field:

```json
{
  "eventType": "CaseSubmitted",
  "eventVersion": "2",
  "eventId": "...",
  "occurredAt": "...",
  "data": { }
}
```

Prinsipnya:

> Event consumer tidak boleh rusak hanya karena producer menambah kebutuhan internal.

## 10.4 Event DTO Harus Memikirkan Idempotency dan Traceability

Event payload sebaiknya membawa:

- `eventId`
- `eventType`
- `eventVersion`
- `occurredAt`
- `producer`
- `correlationId`
- `causationId`
- aggregate id
- actor/system

Contoh envelope:

```java
public record EventEnvelope<T>(
        String eventId,
        String eventType,
        int eventVersion,
        Instant occurredAt,
        String producer,
        String correlationId,
        String causationId,
        T data
) {}
```

Payload:

```java
public record CaseAssignedData(
        String caseId,
        String previousAssigneeId,
        String newAssigneeId,
        String assignedBy,
        String reason
) {}
```

---

# 11. Integration DTO / External Contract DTO

Integration DTO adalah DTO yang mengikuti kontrak sistem eksternal.

Contoh:

```java
public record ExternalAddressLookupResponse(
        String POSTAL_CODE,
        String BLK_NO,
        String ROAD_NAME,
        String BUILDING,
        String LATITUDE,
        String LONGITUDE
) {}
```

Mungkin bentuknya tidak idiomatis Java. Tidak apa-apa jika itu memang external contract.

## 11.1 Jangan Paksa External DTO Menjadi Domain Model

External API sering memiliki:

- nama field aneh
- date format non-standard
- number sebagai string
- boolean sebagai `Y/N`
- code table berbeda
- nested structure legacy
- optional field tidak konsisten

Jangan sebarkan bentuk eksternal itu ke domain.

Gunakan anti-corruption layer:

```java
ExternalAddressLookupResponse external = client.lookup(postalCode);
AddressCandidate candidate = addressMapper.toAddressCandidate(external);
```

External DTO:

```java
public record ExternalAddressLookupResponse(
        String postalCode,
        String blockNo,
        String roadName,
        String buildingName,
        String latitude,
        String longitude
) {}
```

Internal model:

```java
public record AddressCandidate(
        PostalCode postalCode,
        String blockNumber,
        String roadName,
        Optional<String> buildingName,
        GeoCoordinate coordinate
) {}
```

## 11.2 External DTO Harus Diisolasi dalam Adapter

Struktur package yang sehat:

```text
case-management/
  application/
  domain/
  infrastructure/
    integration/
      address/
        AddressLookupClient.java
        ExternalAddressLookupResponse.java
        AddressLookupMapper.java
```

Jangan taruh external DTO di package domain.

```text
// buruk
domain/model/ExternalAddressLookupResponse.java
```

Domain tidak boleh tahu bentuk payload external.

---

# 12. Audit DTO

Audit DTO mewakili apa yang perlu direkam untuk accountability, traceability, forensic analysis, dan regulatory defensibility.

Contoh:

```java
public record CaseAuditEntry(
        String auditId,
        String caseId,
        String activity,
        String actorId,
        String actorType,
        Instant occurredAt,
        Map<String, Object> oldValues,
        Map<String, Object> newValues,
        String correlationId
) {}
```

## 12.1 Audit DTO Tidak Sama dengan Event DTO

Event untuk consumer bisnis. Audit untuk bukti/riwayat.

| Aspek | Event DTO | Audit DTO |
|---|---|---|
| Tujuan | Integrasi / reaction | Accountability / forensic |
| Consumer | Sistem lain | Admin, auditor, support, regulator |
| Bentuk | Semantic fact | Activity trace |
| Retensi | tergantung event policy | sering lebih panjang |
| Sensitive data | biasanya dibatasi | bisa masked/controlled |
| Query pattern | by stream/aggregate | by actor/time/activity/case |

## 12.2 Audit Harus Memisahkan Raw dan Display Representation

Buruk:

```java
public record AuditEntryResponse(
        String description
) {}
```

Contoh description:

```text
Officer Ahmad changed status from PENDING_REVIEW to APPROVED on 2026-01-01
```

Masalah:

- sulit query
- sulit translate
- sulit compare
- sulit mask
- sulit reconstruct

Lebih baik simpan structured audit:

```java
public record AuditChangeSet(
        String field,
        Object oldValue,
        Object newValue,
        String oldDisplayValue,
        String newDisplayValue
) {}
```

Response bisa menghasilkan display:

```java
public record AuditTimelineItemResponse(
        String activity,
        String actorName,
        Instant occurredAt,
        List<AuditFieldChangeResponse> changes
) {}
```

---

# 13. Report / Export DTO

Report/export DTO adalah shape untuk CSV, Excel, PDF, data extract, atau regulatory submission.

Contoh:

```java
public record CaseExportRow(
        String caseNumber,
        String applicantName,
        String status,
        String assignedOfficer,
        LocalDate submittedDate,
        Integer agingDays
) {}
```

## 13.1 Export DTO Tidak Harus Sama dengan API DTO

Export punya kebutuhan berbeda:

- column ordering
- header display name
- formatting date/number
- flattening nested object
- timezone fixed
- localized label
- large data volume
- streaming output
- no interactive pagination

API detail response mungkin nested:

```java
public record CaseDetailResponse(
        ApplicantResponse applicant,
        List<DocumentResponse> documents
) {}
```

Export row biasanya flat:

```java
public record CaseExportRow(
        String caseNumber,
        String applicantName,
        String applicantIdNo,
        String documentCount
) {}
```

## 13.2 Export DTO Harus Stabil terhadap Audit/Regulatory Need

Untuk regulatory report, perubahan column bisa menjadi breaking change operasional.

Sebaiknya ada:

- explicit version
- column definition
- formatting policy
- timezone policy
- null display policy
- masking policy
- generated-at metadata

---

# 14. Internal Transport DTO

Kadang sistem modular menggunakan DTO antar module internal.

Contoh:

```java
public record CaseSummaryInternalDto(
        CaseId caseId,
        String caseNumber,
        CaseStatus status
) {}
```

Ini bisa valid jika module boundary jelas. Tetapi hati-hati: internal DTO sering tumbuh menjadi hidden shared kernel.

## 14.1 Shared DTO Bisa Menjadi Coupling Magnet

Misalnya ada shared library:

```text
common-dto.jar
  UserDto
  CaseDto
  ApplicationDto
  DocumentDto
```

Awalnya reusable. Lama-lama semua service tergantung ke versi DTO yang sama. Perubahan kecil menjadi koordinasi besar.

Lebih baik gunakan shared DTO hanya untuk:

- benar-benar stable shared kernel
- protocol envelope umum
- error response standard
- pagination metadata
- identity primitive/value wrapper yang stabil

Untuk business payload, lebih aman boundary-specific.

---

# 15. DTO Naming Convention

Naming adalah design tool.

## 15.1 Pattern Nama yang Disarankan

Untuk API request:

```text
CreateXRequest
UpdateXRequest
PatchXRequest
SearchXRequest
SubmitXRequest
ApproveXRequest
RejectXRequest
AssignXRequest
CancelXRequest
```

Untuk API response:

```text
XDetailResponse
XSummaryResponse
XListItemResponse
XSearchResponse
XAdminResponse
XPublicResponse
XTimelineResponse
```

Untuk command:

```text
CreateXCommand
SubmitXCommand
ApproveXCommand
AssignXCommand
CloseXCommand
```

Untuk query:

```text
SearchXCriteria
FindXQuery
GetXDetailQuery
ListXQuery
```

Untuk projection:

```text
XListProjection
XSearchProjection
XReportProjection
XAgingProjection
```

Untuk event:

```text
XCreatedEvent
XSubmittedEvent
XApprovedEvent
XStatusChangedEvent
XAssignedEvent
```

Untuk integration:

```text
ExternalSystemXRequest
ExternalSystemXResponse
PartnerXPayload
LegacyXRecord
```

## 15.2 Hindari Nama Ambigu

Hindari:

```text
XDto
XModel
XData
XInfo
XPayload
XBean
```

Kecuali konteks package sangat jelas.

`Payload` boleh dipakai untuk event/integration jika envelope terpisah:

```java
EventEnvelope<CaseSubmittedPayload>
```

---

# 16. DTO Package Strategy

Package strategy membantu menjaga boundary.

Contoh untuk modular monolith:

```text
com.example.caseapp.casefile
  api
    request
      SubmitCaseRequest.java
      AssignCaseRequest.java
    response
      CaseDetailResponse.java
      CaseListItemResponse.java
    mapper
      CaseApiMapper.java
  application
    command
      SubmitCaseCommand.java
      AssignCaseCommand.java
    query
      SearchCaseCriteria.java
  domain
    Case.java
    CaseStatus.java
    CaseId.java
  persistence
    entity
      CaseEntity.java
    projection
      CaseListProjection.java
    mapper
      CasePersistenceMapper.java
  messaging
    event
      CaseSubmittedEvent.java
      CaseAssignedEvent.java
    mapper
      CaseEventMapper.java
  integration
    externalregistry
      ExternalRegistryCaseResponse.java
      ExternalRegistryMapper.java
```

Alternatif package by layer:

```text
api/request
api/response
application/command
domain
persistence/entity
persistence/projection
messaging/event
integration/external
```

Yang penting bukan gaya package-nya, tetapi boundary tidak kabur.

---

# 17. DTO Lifecycle dan Stability

Tidak semua DTO punya tingkat stabilitas yang sama.

| DTO Type | Stability | Consumer | Change Cost |
|---|---:|---|---:|
| Request DTO public API | tinggi | external client | tinggi |
| Response DTO public API | tinggi | external client | tinggi |
| Internal API DTO | sedang | internal frontend/service | sedang |
| Command object | sedang-rendah | internal application | rendah-sedang |
| Projection DTO | rendah | repository/application | rendah |
| Event DTO | sangat tinggi | async consumers | sangat tinggi |
| Integration DTO | tergantung external | adapter | sedang-tinggi |
| Audit DTO | tinggi | audit/reporting | tinggi |
| Export DTO | tinggi | business/regulator | tinggi |

Semakin banyak consumer dan semakin asynchronous hubungannya, semakin tinggi kebutuhan compatibility.

Event dan export sering lebih sulit diubah daripada REST response karena consumer tidak selalu terlihat.

---

# 18. Versioning Strategy untuk DTO

## 18.1 API DTO Versioning

Ada beberapa pendekatan:

### URL versioning

```text
/api/v1/cases
/api/v2/cases
```

DTO:

```java
public record CaseDetailResponseV1(...) {}
public record CaseDetailResponseV2(...) {}
```

### Media type versioning

```text
Accept: application/vnd.company.case.v2+json
```

### Field-level compatibility

Tambah field optional tanpa ganti versi mayor.

```java
public record CaseDetailResponse(
        String caseNumber,
        String status,
        String submissionChannel // additive
) {}
```

## 18.2 Event DTO Versioning

Event lebih aman menggunakan explicit event version:

```java
public record CaseSubmittedEvent(
        String eventId,
        String eventType,
        int eventVersion,
        Instant occurredAt,
        CaseSubmittedData data
) {}
```

Atau class per version:

```java
CaseSubmittedEventV1
CaseSubmittedEventV2
```

## 18.3 Integration DTO Versioning

Jika external provider punya versi API:

```text
integration/onemap/v1/OneMapSearchResponse.java
integration/onemap/v2/OneMapSearchResponse.java
```

Jangan overwrite v1 DTO secara diam-diam jika v1 dan v2 harus coexist.

---

# 19. Required, Optional, Nullable, Absent

DTO design harus membedakan empat konsep:

1. required
2. optional
3. nullable
4. absent

Ini bukan hal yang sama.

## 19.1 Required

Field harus ada dan punya nilai valid.

```java
public record CreateUserRequest(
        @NotBlank String username
) {}
```

## 19.2 Optional

Field boleh tidak dikirim, dan sistem punya behavior jelas.

```java
public record SearchCaseRequest(
        String keyword // optional filter
) {}
```

## 19.3 Nullable

Field dikirim dengan nilai `null` dan null punya arti.

```json
{
  "middleName": null
}
```

Bisa berarti hapus middle name.

## 19.4 Absent

Field tidak dikirim sama sekali.

```json
{}
```

Dalam PATCH, absent biasanya berarti “jangan ubah”.

Ini penting:

```json
{
  "displayName": null
}
```

berbeda dengan:

```json
{}
```

Jika DTO tidak bisa membedakan null dan absent, PATCH semantics bisa rusak.

Solusi bisa berupa:

- JSON Merge Patch
- explicit patch field wrapper
- `JsonNullable<T>` pattern
- custom deserialization
- separate endpoint per action

---

# 20. DTO dan Mutability

DTO bisa mutable atau immutable.

## 20.1 Mutable DTO

Contoh JavaBean style:

```java
public class CreateUserRequest {
    private String username;
    private String email;

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
```

Kelebihan:

- kompatibel dengan library lama
- mudah untuk framework binding lama
- familiar di Java 8

Kekurangan:

- state bisa berubah setelah validasi
- setter bisa dipanggil sembarang
- object tidak thread-safe by design
- lebih sulit reason tentang invariant

## 20.2 Immutable DTO dengan Constructor

```java
public final class CreateUserRequest {
    private final String username;
    private final String email;

    public CreateUserRequest(String username, String email) {
        this.username = username;
        this.email = email;
    }

    public String getUsername() { return username; }
    public String getEmail() { return email; }
}
```

## 20.3 Record DTO

Java modern:

```java
public record CreateUserRequest(
        String username,
        String email
) {}
```

Kelebihan:

- concise
- immutable shallowly
- canonical constructor
- equals/hashCode/toString otomatis
- cocok untuk DTO kecil-menengah

Trade-off:

- semua component bagian dari API record
- tidak cocok jika butuh inheritance
- nested mutable collection tetap perlu defensive copy jika penting
- perubahan component adalah source/binary compatibility concern

## 20.4 Builder DTO

```java
@Builder
public record UserDetailResponse(
        Long id,
        String username,
        String displayName,
        Instant createdAt
) {}
```

Builder berguna untuk response besar, tetapi bisa menyembunyikan required field jika tidak disiplin.

---

# 21. DTO dan Collection Design

Collection di DTO tampak sederhana tetapi punya banyak jebakan.

## 21.1 Null Collection vs Empty Collection

Untuk response, biasanya lebih baik empty collection daripada null.

```json
{
  "documents": []
}
```

lebih predictable daripada:

```json
{
  "documents": null
}
```

atau field absent.

Untuk request, bedakan:

- absent: client tidak mengirim
- empty list: client sengaja mengirim kosong
- null: client mengirim null

## 21.2 Defensive Copy

Record hanya immutable secara shallow.

```java
public record CaseDetailResponse(List<DocumentResponse> documents) {}
```

List di dalamnya masih bisa mutable jika berasal dari mutable list.

Lebih aman:

```java
public record CaseDetailResponse(List<DocumentResponse> documents) {
    public CaseDetailResponse {
        documents = List.copyOf(documents);
    }
}
```

Untuk Java 8, gunakan:

```java
this.documents = Collections.unmodifiableList(new ArrayList<>(documents));
```

## 21.3 Ordered vs Unordered Semantics

DTO harus jelas apakah urutan penting.

- timeline: order penting
- tags: order mungkin tidak penting
- search results: order penting
- permission set: order tidak penting

Pilih type yang sesuai:

```java
List<TimelineItemResponse>
Set<String> permissions
```

Tetapi untuk JSON, set tetap muncul sebagai array. Jangan mengandalkan consumer memahami uniqueness kecuali didokumentasikan.

---

# 22. DTO dan Enum Design

Enum sering menjadi sumber breaking change.

## 22.1 Internal Enum vs API Enum

Internal:

```java
public enum CaseStatus {
    DRAFT,
    PENDING_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

API response mungkin ingin label:

```java
public record CaseStatusResponse(
        String code,
        String label
) {}
```

Atau:

```json
{
  "status": "PENDING_REVIEW",
  "statusLabel": "Pending Review"
}
```

## 22.2 Enum Evolution

Menambah enum value bisa breaking untuk client yang exhaustive.

Misalnya client lama hanya tahu:

```text
APPROVED, REJECTED
```

Lalu server menambah:

```text
PENDING_CLARIFICATION
```

Client bisa gagal.

Strategi:

- dokumentasikan enum sebagai extensible jika perlu
- sediakan `UNKNOWN` handling di consumer
- pisahkan internal enum dari external code
- gunakan code table endpoint untuk UI dynamic
- jangan rename enum value sembarangan

---

# 23. DTO dan Date/Time Design

Date/time mapping adalah area bug klasik.

DTO harus jelas:

- instant absolute atau local date?
- timezone siapa?
- date-only atau datetime?
- format ISO atau custom?
- precision sampai detik, millis, nanos?

Contoh:

```java
public record CaseDetailResponse(
        Instant submittedAt,
        LocalDate dueDate
) {}
```

`submittedAt` adalah timestamp absolute.

`dueDate` adalah tanggal bisnis, mungkin tanpa timezone.

Jangan gunakan `Date` lama tanpa alasan kuat.

## 23.1 Request Date Range

Untuk search:

```java
public record SearchCaseRequest(
        LocalDate submittedFrom,
        LocalDate submittedTo
) {}
```

Application layer perlu menentukan semantics:

- from inclusive?
- to inclusive?
- timezone apa saat convert ke instant?

Contoh:

```java
Instant from = submittedFrom.atStartOfDay(zone).toInstant();
Instant toExclusive = submittedTo.plusDays(1).atStartOfDay(zone).toInstant();
```

---

# 24. DTO dan Money/Decimal Design

Jangan memakai `double` untuk uang.

Buruk:

```java
public record PaymentResponse(double amount) {}
```

Lebih baik:

```java
public record MoneyResponse(
        BigDecimal amount,
        String currency
) {}
```

Atau jika butuh minor unit:

```java
public record MoneyMinorUnitResponse(
        long amountInCents,
        String currency
) {}
```

DTO harus mendefinisikan:

- scale
- rounding
- currency
- display formatting bukan domain amount

---

# 25. DTO dan Identity Design

Internal id tidak selalu boleh bocor.

Internal entity:

```java
Long id;
```

API response:

```java
String userId;
```

Mungkin menggunakan:

- UUID
- ULID
- prefixed id
- opaque id
- natural business number

Contoh:

```java
public record CaseDetailResponse(
        String caseId,
        String caseNumber
) {}
```

`caseId` untuk API operation. `caseNumber` untuk display/business reference.

Jangan campur:

- database primary key
- public id
- business number
- external reference id
- idempotency key

---

# 26. DTO dan Security Surface

DTO adalah bagian dari security architecture.

## 26.1 Request DTO Security

Bahaya:

- over-posting
- privilege escalation
- hidden field manipulation
- nested object injection
- insecure polymorphic binding
- unbounded collection size
- string payload terlalu besar

Mitigasi:

- request DTO spesifik per use case
- whitelist field
- validation size
- no entity binding
- no internal role/status field dari user kecuali explicit admin endpoint
- strict unknown field policy untuk endpoint sensitif

## 26.2 Response DTO Security

Bahaya:

- password hash bocor
- token bocor
- internal note bocor
- PII bocor
- audit metadata bocor
- authorization decision bocor
- relationship object bocor

Mitigasi:

- response DTO deny-by-default
- field-level authorization diputuskan sebelum mapping atau dengan projection policy jelas
- masking policy eksplisit
- jangan mengandalkan `toString()` untuk log DTO sensitive

---

# 27. DTO dan Authorization

Authorization memengaruhi DTO shape.

Contoh user biasa melihat:

```java
public record CaseDetailResponse(
        String caseNumber,
        String status,
        String description
) {}
```

Officer melihat:

```java
public record OfficerCaseDetailResponse(
        String caseNumber,
        String status,
        String description,
        String applicantId,
        List<InternalNoteResponse> internalNotes,
        List<String> allowedActions
) {}
```

Admin melihat:

```java
public record AdminCaseDetailResponse(
        String caseNumber,
        String status,
        String description,
        String applicantId,
        List<InternalNoteResponse> internalNotes,
        AuditSummaryResponse auditSummary,
        List<String> systemFlags
) {}
```

Tiga strategi:

1. DTO berbeda per role/view
2. DTO sama dengan field nullable/omitted berdasarkan authorization
3. DTO envelope dengan sections authorized

Untuk sistem high-risk, DTO berbeda sering lebih jelas dan aman.

---

# 28. DTO dan State Machine

Dalam case management/regulatory systems, state machine penting.

Jangan desain update DTO yang membiarkan client set status sembarang:

```java
public record UpdateCaseRequest(
        String status
) {}
```

Lebih baik action-specific:

```java
public record SubmitCaseRequest(String declaration) {}
public record ApproveCaseRequest(String remarks) {}
public record RejectCaseRequest(String reason) {}
public record RequestClarificationRequest(String question) {}
```

Lalu command:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        Actor approvedBy,
        String remarks,
        Instant approvedAt
) {}
```

State transition bukan field update. Ia adalah domain action.

---

# 29. DTO dan Mapping Layer Responsibilities

Mapper tidak seharusnya melakukan semua hal.

## 29.1 Mapper Boleh Melakukan

- field copy
- type conversion sederhana
- enum code conversion
- flatten/unflatten sederhana
- date/time representation conversion
- null/default mapping yang deterministic
- composition DTO dari projection

## 29.2 Mapper Harus Hati-Hati Melakukan

- database lookup
- authorization decision
- business rule
- state transition
- external API call
- random id generation
- current time assignment
- audit persistence

Bukan berarti tidak pernah boleh. Tetapi jika mapper melakukan hal tersebut, mapper bukan lagi pure mapper. Ia menjadi orchestrator/service terselubung.

Lebih baik:

```java
Actor actor = securityContext.currentActor();
Instant now = clock.instant();
CreateCaseCommand command = mapper.toCommand(request, actor, now);
```

Bukan:

```java
CreateCaseCommand command = mapper.toCommand(request);
// mapper diam-diam baca security context dan clock
```

Explicit dependency membuat behavior lebih testable.

---

# 30. DTO Design Decision Matrix

Gunakan matrix berikut saat membuat DTO baru.

| Pertanyaan | Dampak Desain |
|---|---|
| Siapa consumer DTO ini? | menentukan stability dan field exposure |
| Boundary apa yang dilewati? | menentukan annotation dan naming |
| Apakah DTO input atau output? | menentukan validation dan sensitive policy |
| Apakah DTO mewakili intent atau state? | request/command vs response/projection |
| Apakah contract public atau internal? | versioning dan compatibility |
| Apakah async/event? | wajib versioning dan envelope |
| Apakah field boleh absent/null? | PATCH semantics dan deserialization strategy |
| Apakah field sensitive? | masking/exclusion |
| Apakah DTO akan disimpan lama? | audit/export compatibility |
| Apakah shape mengikuti external system? | isolasi di adapter |
| Apakah performance penting? | projection dan flattening |
| Apakah Java 8 atau modern Java? | class/record/builder strategy |

---

# 31. Worked Example: Case Management DTO Family

Bayangkan domain case management.

## 31.1 API Request DTO

```java
public record SubmitCaseRequest(
        String applicantId,
        String caseType,
        String description,
        List<SubmitCaseDocumentRequest> documents
) {}

public record SubmitCaseDocumentRequest(
        String documentId,
        String documentType
) {}
```

## 31.2 Application Command

```java
public record SubmitCaseCommand(
        ApplicantId applicantId,
        CaseType caseType,
        String description,
        List<SubmittedDocument> documents,
        Actor submittedBy,
        Instant submittedAt,
        CorrelationId correlationId
) {}
```

## 31.3 Domain Aggregate

```java
public final class CaseFile {
    private final CaseId id;
    private CaseStatus status;
    private final ApplicantId applicantId;
    private final List<CaseDocument> documents;

    public void submit(Actor actor, Instant now) {
        // enforce invariant and state transition
    }
}
```

## 31.4 Persistence Entity

```java
@Entity
@Table(name = "case_file")
public class CaseEntity {
    @Id
    private Long id;
    private String caseNumber;
    private String statusCode;
    private Long applicantId;
    private Instant submittedAt;
}
```

## 31.5 Projection DTO

```java
public record CaseListProjection(
        Long caseId,
        String caseNumber,
        String statusCode,
        String applicantName,
        Instant submittedAt
) {}
```

## 31.6 API Response DTO

```java
public record CaseListItemResponse(
        String caseId,
        String caseNumber,
        String status,
        String applicantName,
        Instant submittedAt
) {}
```

## 31.7 Event DTO

```java
public record CaseSubmittedEvent(
        String eventId,
        int eventVersion,
        Instant occurredAt,
        String correlationId,
        CaseSubmittedPayload data
) {}

public record CaseSubmittedPayload(
        String caseId,
        String caseNumber,
        String applicantId,
        String submittedBy
) {}
```

## 31.8 Audit DTO

```java
public record CaseAuditEntry(
        String auditId,
        String caseId,
        String activity,
        String actorId,
        Instant occurredAt,
        List<AuditFieldChange> changes,
        String correlationId
) {}
```

## 31.9 External Integration DTO

```java
public record ExternalRegistryCaseSubmissionRequest(
        String referenceNo,
        String applicantIdentifier,
        String submissionTimestamp,
        List<ExternalRegistryDocument> attachments
) {}
```

Satu use case menghasilkan banyak DTO karena boundary-nya berbeda. Ini bukan overengineering jika sistem punya kebutuhan audit, integration, API stability, dan domain correctness.

---

# 32. Anti-Pattern Catalog

## 32.1 God DTO

```java
public class CaseDto {
    // request fields
    // response fields
    // entity fields
    // audit fields
    // event fields
    // UI helper fields
}
```

Gejala:

- banyak field nullable
- banyak annotation campur
- banyak `@JsonIgnore`
- validasi conditional rumit
- mapper penuh if
- perubahan satu endpoint memengaruhi endpoint lain

## 32.2 Entity as DTO

Entity langsung dipakai di API.

Gejala:

- lazy loading saat JSON serialization
- relationship cycle
- internal field bocor
- API contract tergantung database schema

## 32.3 Response DTO as Event

Response dikirim ke message broker.

Gejala:

- UI change merusak consumer
- event tidak punya version
- event tidak punya occurredAt/correlationId

## 32.4 Request DTO as Command Tanpa Translasi

Controller langsung mengirim request DTO ke domain/application.

Gejala:

- domain menerima string/raw primitive
- actor/time/correlation tidak eksplisit
- validation dan business precondition campur

## 32.5 Shared Common DTO Everywhere

Satu DTO library dipakai semua service.

Gejala:

- deployment coupling
- version conflict
- field ditambah untuk satu service tapi terlihat di semua service
- sulit deprecate

## 32.6 DTO with Business Behavior Too Much

DTO punya method besar:

```java
public boolean canApprove(User user) { ... }
public void transitionStatus(...) { ... }
```

DTO berubah menjadi domain object palsu. Lebih baik pindahkan ke domain/policy/service.

---

# 33. Best Practices Ringkas

1. Buat DTO berdasarkan boundary, bukan berdasarkan table/entity.
2. Pisahkan request dan response.
3. Pisahkan create/update/action request.
4. Jangan expose entity.
5. Jangan reuse response sebagai event.
6. Command harus mewakili intent, bukan raw request.
7. Projection DTO boleh berbeda dari response DTO.
8. External DTO harus diisolasi dalam adapter.
9. Audit DTO harus structured, bukan hanya text description.
10. Beri nama DTO secara eksplisit.
11. Gunakan versioning untuk public API, event, export, dan external integration.
12. Bedakan required, optional, nullable, dan absent.
13. Treat DTO as security surface.
14. Jangan taruh policy besar di mapper.
15. Gunakan records/immutable DTO jika Java version dan framework mendukung.
16. Untuk Java 8, gunakan final class/manual constructor/builder bila perlu.
17. Jangan biarkan common DTO menjadi coupling magnet.

---

# 34. Checklist Saat Mendesain DTO Baru

Sebelum membuat DTO, jawab:

- DTO ini untuk boundary apa?
- Apakah input, output, command, query, event, projection, audit, export, atau external integration?
- Siapa owner kontraknya?
- Siapa consumer-nya?
- Apakah public/stable atau internal/evolvable?
- Apakah field ini boleh dikirim client?
- Apakah field ini boleh dilihat client?
- Apakah ada sensitive field?
- Apakah null dan absent berbeda?
- Apakah DTO perlu version?
- Apakah DTO perlu envelope?
- Apakah DTO perlu validation annotation?
- Apakah DTO perlu Jackson annotation?
- Apakah DTO perlu OpenAPI annotation?
- Apakah DTO harus immutable?
- Apakah collection harus defensive copy?
- Apakah enum value bisa berkembang?
- Apakah date/time semantics jelas?
- Apakah identity yang dipakai public id atau database id?
- Apakah DTO ini akan dipakai di event/export/audit jangka panjang?
- Apakah ada risiko mapper menjadi service tersembunyi?

---

# 35. Exercise: Refactor God DTO

Misalkan ada DTO:

```java
public class ApplicationDto {
    public Long id;
    public String applicationNumber;
    public String applicantId;
    public String applicantName;
    public String type;
    public String status;
    public String remarks;
    public String rejectionReason;
    public String assignedOfficerId;
    public String assignedOfficerName;
    public List<DocumentDto> documents;
    public Instant createdAt;
    public Instant submittedAt;
    public Instant approvedAt;
    public String createdBy;
    public String approvedBy;
}
```

Pecah menjadi minimal:

```text
CreateApplicationRequest
SubmitApplicationRequest
ApproveApplicationRequest
RejectApplicationRequest
ApplicationDetailResponse
ApplicationListItemResponse
ApplicationSearchProjection
SubmitApplicationCommand
ApproveApplicationCommand
ApplicationSubmittedEvent
ApplicationAuditEntry
```

Tentukan:

- field mana masuk ke request
- field mana server-generated
- field mana hanya response
- field mana hanya audit
- field mana hanya event
- field mana sensitive/internal
- field mana perlu value object di command

---

# 36. Key Takeaways

DTO design adalah salah satu pembeda engineer biasa dan engineer senior/top-tier.

Engineer biasa sering bertanya:

> “Field ini ada di mana?”

Engineer matang bertanya:

> “Boundary apa yang sedang dilewati data ini, siapa owner kontraknya, siapa consumer-nya, apa semantic expectation-nya, dan failure apa yang terjadi jika shape ini berubah?”

Kesimpulan utama:

1. DTO bukan class “kosong” biasa.
2. DTO adalah boundary contract.
3. Satu entity/domain concept bisa punya banyak DTO yang sah.
4. Reuse DTO berlebihan sering menciptakan coupling, security issue, dan compatibility problem.
5. Mapping layer yang sehat dimulai dari DTO taxonomy yang sehat.
6. API, command, projection, event, audit, export, dan external integration punya pressure desain berbeda.
7. Semakin long-lived dan asynchronous consumer-nya, semakin hati-hati versioning dan compatibility-nya.
8. DTO naming yang eksplisit adalah bentuk architecture documentation.

---

# 37. Hubungan dengan Part Berikutnya

Part ini menjelaskan jenis DTO dan boundary-nya. Berikutnya kita masuk ke fondasi yang sengaja tidak boleh dilewati:

> **Part 4 — Manual Mapping: The Baseline Every Senior Engineer Must Master**

Sebelum memakai MapStruct, Jackson annotation, Lombok builder, atau code generator lain, kita harus paham manual mapping yang benar. Manual mapping adalah baseline mental model untuk melihat apa yang sebenarnya dilakukan tool otomatis.

Jika manual mapping-nya saja tidak bisa dirancang dengan aman, framework hanya akan mempercepat munculnya bug.

---

# Status Seri

- Part 0: selesai
- Part 1: selesai
- Part 2: selesai
- Part 3: selesai
- Part 4 sampai Part 35: belum selesai

Seri belum mencapai bagian terakhir.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./02-transformation-taxonomy-copy-convert-normalize-enrich-redact-project.md">⬅️ Part 2 — Transformation Taxonomy: Copy, Convert, Normalize, Enrich, Redact, Project</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./04-manual-mapping-baseline-every-senior-engineer-must-master.md">Part 4 — Manual Mapping: The Baseline Every Senior Engineer Must Master ➡️</a>
</div>
