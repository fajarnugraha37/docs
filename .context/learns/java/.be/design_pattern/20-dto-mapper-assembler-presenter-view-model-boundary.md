# Part 20 — DTO, Mapper, Assembler, Presenter, View Model Boundary

File: `20-dto-mapper-assembler-presenter-view-model-boundary.md`

Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`

Status: **Part 20 dari 35**

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu memahami bahwa DTO, mapper, assembler, presenter, dan view model bukan sekadar “class untuk transfer data”, melainkan bagian dari desain boundary.

Target pemahaman:

1. Membedakan DTO, command, query response, event payload, persistence entity, domain model, form model, dan view model.
2. Memahami kenapa satu model tidak boleh dipakai untuk semua boundary.
3. Mendesain DTO yang stabil, versionable, aman, dan tidak membocorkan detail domain/persistence.
4. Menentukan kapan mapping eksplisit lebih baik daripada mapping otomatis.
5. Memahami peran Mapper, Assembler, Presenter, dan View Model dalam arsitektur Java enterprise.
6. Mengenali anti-pattern seperti universal DTO, entity exposed as API, mapper logic leak, dan DTO explosion.
7. Membangun model mental untuk memilih bentuk data yang tepat berdasarkan consumer, lifecycle, ownership, dan stability.

Topik ini terlihat sederhana, tetapi di sistem besar ia sering menjadi sumber coupling jangka panjang. Banyak codebase tidak runtuh karena algoritma yang buruk, melainkan karena model internal, persistence entity, API contract, UI needs, event payload, dan integration payload saling bercampur.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sistem Java enterprise dengan modul `Case`, `Application`, `Compliance`, `Appeal`, `Inspection`, dan `Enforcement`.

Awalnya developer membuat satu class:

```java
public class CaseDto {
    public Long id;
    public String caseNo;
    public String status;
    public String applicantName;
    public String applicantNric;
    public String officerName;
    public String internalRemark;
    public String recommendation;
    public String decision;
    public LocalDateTime createdAt;
    public LocalDateTime updatedAt;
    public List<DocumentDto> documents;
    public List<ActionDto> actions;
    public List<AuditDto> audits;
}
```

Class ini kemudian dipakai untuk:

1. request create case,
2. request update case,
3. response detail page,
4. response listing page,
5. export Excel,
6. event Kafka/RabbitMQ,
7. internal service call,
8. cache value,
9. test fixture,
10. mapper dari JPA entity,
11. mapper ke external API,
12. audit snapshot.

Pada awalnya terasa praktis. Tidak perlu banyak class. Semua field ada.

Lalu masalah mulai muncul:

1. Field `internalRemark` tidak sengaja terkirim ke public API.
2. Listing API lambat karena DTO membawa `documents`, `actions`, dan `audits`.
3. UI butuh `displayStatus`, lalu field itu ditambahkan ke DTO dan ikut masuk event payload.
4. Kafka consumer gagal karena perubahan field response UI memengaruhi event schema.
5. Create request menerima `id`, `status`, dan `decision` padahal field tersebut harus generated/server-owned.
6. API backward compatibility rusak ketika nama field internal berubah.
7. Mapper menjadi tempat business rule terselubung.
8. Entity berubah, API ikut berubah.
9. Query response berubah, command validation ikut rusak.
10. Satu DTO punya banyak nullable field karena “dipakai di banyak skenario”.

Masalah inti:

> Model data yang salah boundary akan menciptakan coupling yang tidak kelihatan sampai requirement berubah.

DTO bukan hanya object kosong. DTO adalah kontrak antar boundary.

---

## 3. Mental Model

### 3.1 Setiap Boundary Butuh Bahasa Sendiri

Dalam sistem besar, setiap boundary memiliki kebutuhan berbeda:

| Boundary | Pertanyaan Utama | Model yang Cocok |
|---|---|---|
| API input | Apa yang client boleh minta? | Request DTO / Command DTO |
| API output | Apa yang client boleh lihat? | Response DTO / View Model |
| Domain | Apa keputusan bisnis yang valid? | Entity / Value Object / Domain Model |
| Persistence | Bagaimana data disimpan? | JPA Entity / MyBatis Record / Row Model |
| Integration | Apa kontrak dengan sistem luar? | External DTO / Event Payload |
| UI | Apa yang perlu dirender? | View Model / Presenter Model |
| Audit | Apa fakta historis yang harus disimpan? | Audit Snapshot |
| Cache | Apa yang efisien untuk reuse? | Cache Model |

Kesalahan umum adalah menganggap semua boundary bisa memakai satu class.

Padahal boundary berbeda memiliki:

1. ownership berbeda,
2. lifecycle berbeda,
3. compatibility contract berbeda,
4. security exposure berbeda,
5. performance profile berbeda,
6. validation semantics berbeda,
7. naming convention berbeda,
8. nullability semantics berbeda.

### 3.2 DTO Adalah Contract, Bukan Domain

DTO tidak seharusnya menjawab:

```text
Apa aturan bisnisnya?
```

DTO menjawab:

```text
Data apa yang boleh melewati boundary ini?
```

Domain model menjawab:

```text
Apa state dan behavior yang valid dalam bisnis?
```

Persistence model menjawab:

```text
Bagaimana data direpresentasikan di storage?
```

View model menjawab:

```text
Apa bentuk data yang paling cocok untuk consumer tertentu?
```

### 3.3 Mapping Adalah Anti-Corruption Boundary Mini

Mapping sering diremehkan sebagai boilerplate. Padahal mapping adalah titik di mana sistem memutuskan:

1. field mana yang exposed,
2. field mana yang disembunyikan,
3. field mana yang derived,
4. field mana yang normalized,
5. error apa yang diterjemahkan,
6. format apa yang dijaga stabil,
7. versi kontrak mana yang dipakai,
8. data sensitif mana yang di-mask,
9. timezone/locale apa yang dipakai,
10. nullability apa yang valid.

Mapping bukan sekadar `A.field = B.field`.

Mapping adalah boundary policy.

### 3.4 Model Reuse Bukan Selalu Efisiensi

Reuse class sering terlihat hemat.

Tetapi reuse yang salah menghasilkan hidden coupling.

Contoh:

```text
Satu class dipakai untuk create request dan detail response.
```

Dampaknya:

1. request menerima field yang tidak boleh diisi client,
2. response menampilkan field yang seharusnya internal,
3. validation menjadi penuh conditional,
4. dokumentasi API tidak jelas,
5. perubahan response bisa merusak input,
6. security review makin sulit.

Senior engineer tidak menilai efisiensi dari jumlah class, tetapi dari kestabilan boundary.

---

## 4. Core Vocabulary

### 4.1 DTO

DTO atau Data Transfer Object adalah object yang dirancang untuk membawa data melewati boundary.

Boundary bisa berupa:

1. HTTP request/response,
2. RPC request/response,
3. message broker event,
4. external API client,
5. batch import/export,
6. internal module boundary,
7. cache serialization boundary.

DTO biasanya:

1. tidak memiliki behavior bisnis berat,
2. mudah diserialisasi,
3. memiliki field sesuai kontrak boundary,
4. stabil terhadap consumer,
5. bisa versioned,
6. berbeda dari domain entity.

### 4.2 Request DTO

Request DTO merepresentasikan data yang dikirim client ke server.

Contoh:

```java
public record CreateCaseRequest(
        String applicantId,
        String caseType,
        String description,
        List<String> documentIds
) {}
```

Request DTO harus menjawab:

1. apa yang client boleh input,
2. apa yang wajib,
3. apa yang optional,
4. format apa yang diterima,
5. constraint apa yang berlaku di boundary,
6. apa yang tidak boleh dikontrol client.

Request DTO tidak boleh sembarangan berisi:

1. database id generated server,
2. internal status,
3. decision field,
4. audit metadata,
5. authorization flag,
6. trusted field.

### 4.3 Response DTO

Response DTO merepresentasikan data yang dikirim server ke client.

Contoh:

```java
public record CaseDetailResponse(
        String caseNo,
        String status,
        String displayStatus,
        String applicantName,
        List<DocumentSummaryResponse> documents,
        List<AvailableActionResponse> availableActions
) {}
```

Response DTO menjawab:

1. apa yang consumer perlu lihat,
2. bentuk data apa yang nyaman untuk consumer,
3. field apa yang boleh exposed,
4. field apa yang derived,
5. field apa yang sudah masked,
6. apakah response backward compatible.

### 4.4 Command DTO

Command DTO merepresentasikan intention untuk menjalankan use case.

Contoh:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        String reason,
        Instant requestedAt
) {}
```

Command berbeda dari request DTO.

Request DTO berasal dari outside boundary. Command DTO berasal dari application boundary setelah parsing, authentication, authorization context extraction, dan basic validation.

Request DTO:

```text
Bentuk data dari client.
```

Command:

```text
Intent internal aplikasi untuk menjalankan use case.
```

### 4.5 Query Response Model

Query response model adalah bentuk data untuk menjawab kebutuhan baca.

Contoh:

```java
public record CaseListingItem(
        String caseNo,
        String applicantName,
        String status,
        LocalDate submittedDate,
        String assignedOfficerName
) {}
```

Ia berbeda dari detail response.

Listing butuh data kecil, cepat, sortable, pageable.

Detail butuh data lengkap.

Export butuh format tabular.

Dashboard butuh aggregation.

Menyamakan semua query response menjadi satu DTO biasanya menghasilkan payload berat dan banyak nullable field.

### 4.6 Event Payload

Event payload adalah kontrak untuk menyampaikan fakta yang sudah terjadi.

Contoh:

```java
public record CaseApprovedEventPayload(
        String eventId,
        String caseNo,
        String approvedBy,
        Instant approvedAt,
        String decisionCode,
        int schemaVersion
) {}
```

Event payload tidak boleh tergantung response DTO UI.

Event payload punya concern sendiri:

1. schema evolution,
2. idempotency,
3. replay,
4. consumer compatibility,
5. event metadata,
6. correlation id,
7. causation id.

### 4.7 Persistence Entity

Persistence entity merepresentasikan storage mapping.

Contoh:

```java
@Entity
@Table(name = "CASE")
public class CaseJpaEntity {
    @Id
    private Long id;

    @Column(name = "CASE_NO")
    private String caseNo;

    @Column(name = "STATUS")
    private String status;

    @Column(name = "INTERNAL_REMARK")
    private String internalRemark;
}
```

Persistence entity punya concern:

1. table structure,
2. ORM lifecycle,
3. lazy loading,
4. dirty checking,
5. identity map,
6. persistence context,
7. column constraints,
8. database compatibility.

Ia tidak seharusnya menjadi public API response.

### 4.8 Domain Model

Domain model merepresentasikan konsep bisnis.

Contoh:

```java
public final class CaseFile {
    private final CaseId id;
    private CaseStatus status;
    private final Applicant applicant;

    public ApprovalDecision approve(Officer officer, ApprovalReason reason, Clock clock) {
        if (!status.canApprove()) {
            throw new IllegalCaseTransitionException(status, CaseAction.APPROVE);
        }
        this.status = CaseStatus.APPROVED;
        return new ApprovalDecision(id, officer.id(), reason, clock.instant());
    }
}
```

Domain model punya behavior dan invariant.

Ia berbeda dari DTO karena domain model tidak hanya membawa data. Ia menjaga meaning.

### 4.9 Mapper

Mapper mengubah satu model ke model lain.

Contoh:

```java
public final class CaseResponseMapper {
    public CaseDetailResponse toDetailResponse(CaseFile caseFile, List<Document> documents) {
        return new CaseDetailResponse(
                caseFile.caseNo().value(),
                caseFile.status().code(),
                caseFile.status().displayName(),
                caseFile.applicant().displayName(),
                documents.stream().map(this::toDocumentSummary).toList(),
                availableActions(caseFile)
        );
    }
}
```

Mapper bisa manual, generated, atau framework-assisted.

### 4.10 Assembler

Assembler biasanya lebih tinggi dari mapper. Ia menyusun response dari banyak sumber.

Mapper:

```text
Case -> CaseResponse
```

Assembler:

```text
Case + Applicant + Documents + Permissions + WorkflowActions -> CaseDetailResponse
```

Assembler sering berada di application/presentation boundary.

### 4.11 Presenter

Presenter mengubah application result menjadi output yang sesuai delivery mechanism.

Contoh dalam web API:

```text
Use case result -> HTTP status + response body + headers
```

Presenter menjawab:

1. status code apa,
2. response schema apa,
3. error representation apa,
4. message localization apa,
5. masking apa,
6. pagination metadata apa.

### 4.12 View Model

View model adalah model yang dirancang untuk kebutuhan tampilan.

Contoh:

```java
public record CaseDetailViewModel(
        String title,
        String statusBadgeText,
        String statusBadgeColor,
        List<FieldViewModel> sections,
        List<ButtonViewModel> actions
) {}
```

Di backend API modern, view model sering berupa response DTO yang sudah disesuaikan kebutuhan UI, tetapi harus tetap hati-hati agar backend tidak terlalu tahu detail UI visual yang berubah cepat.

---

## 5. Java 8–25 Perspective

### 5.1 Java 8: DTO dengan Class Biasa dan Immutability Manual

Sebelum records, DTO immutable butuh banyak boilerplate:

```java
public final class CaseSummaryResponse {
    private final String caseNo;
    private final String status;

    public CaseSummaryResponse(String caseNo, String status) {
        this.caseNo = Objects.requireNonNull(caseNo);
        this.status = Objects.requireNonNull(status);
    }

    public String getCaseNo() {
        return caseNo;
    }

    public String getStatus() {
        return status;
    }
}
```

Ini aman, tetapi verbose.

Banyak project akhirnya memakai Lombok:

```java
@Getter
@AllArgsConstructor
public class CaseSummaryResponse {
    private final String caseNo;
    private final String status;
}
```

Masalahnya bukan Lombok-nya, tetapi jika Lombok membuat developer terlalu mudah membuat data bag tanpa memikirkan boundary.

### 5.2 Java 16+: Records sebagai DTO Natural

Records cocok untuk DTO immutable:

```java
public record CaseSummaryResponse(
        String caseNo,
        String status
) {}
```

Keunggulan:

1. ringkas,
2. immutable secara shallow,
3. equality jelas,
4. cocok untuk serialization,
5. cocok untuk API response/query model,
6. cocok untuk value carrier.

Namun record bukan solusi semua hal.

Record tidak otomatis membuat desain benar.

Anti-pattern:

```java
public record UniversalCaseDto(
        Long id,
        String caseNo,
        String status,
        String internalRemark,
        String applicantNric,
        List<DocumentDto> documents,
        List<AuditDto> audits,
        Boolean canApprove,
        Boolean canReject,
        Boolean isEditable,
        Boolean isPublicView,
        Boolean isInternalView
) {}
```

Ini tetap buruk walaupun memakai record.

### 5.3 Compact Constructor untuk Boundary Validation Ringan

```java
public record CreateCaseRequest(
        String applicantId,
        String caseType,
        String description
) {
    public CreateCaseRequest {
        if (applicantId == null || applicantId.isBlank()) {
            throw new IllegalArgumentException("applicantId is required");
        }
        if (caseType == null || caseType.isBlank()) {
            throw new IllegalArgumentException("caseType is required");
        }
    }
}
```

Namun hati-hati.

Request DTO validation sebaiknya membedakan:

1. syntactic validation,
2. semantic validation,
3. authorization validation,
4. domain invariant validation.

Compact constructor cocok untuk invariant sederhana, bukan untuk query database atau memanggil service.

### 5.4 Sealed Classes untuk Output Union

Kadang use case menghasilkan beberapa bentuk output.

```java
public sealed interface SubmitCaseResult
        permits SubmitCaseResult.Accepted,
                SubmitCaseResult.Duplicate,
                SubmitCaseResult.Rejected {

    record Accepted(String caseNo) implements SubmitCaseResult {}

    record Duplicate(String existingCaseNo) implements SubmitCaseResult {}

    record Rejected(List<String> reasons) implements SubmitCaseResult {}
}
```

Presenter bisa mengubah result menjadi HTTP response:

```java
public ResponseEntity<?> present(SubmitCaseResult result) {
    return switch (result) {
        case SubmitCaseResult.Accepted accepted ->
                ResponseEntity.status(201).body(new SubmitCaseResponse(accepted.caseNo()));

        case SubmitCaseResult.Duplicate duplicate ->
                ResponseEntity.status(409).body(new DuplicateCaseResponse(duplicate.existingCaseNo()));

        case SubmitCaseResult.Rejected rejected ->
                ResponseEntity.badRequest().body(new ValidationErrorResponse(rejected.reasons()));
    };
}
```

Ini membuat output branching lebih eksplisit daripada return `Map<String, Object>`.

### 5.5 Pattern Matching Mengurangi Mapper Boilerplate untuk Hierarchy

Misalnya domain memiliki sealed decision:

```java
public sealed interface Decision permits Approved, Rejected, Withdrawn {}
public record Approved(String approvalNo) implements Decision {}
public record Rejected(List<String> reasons) implements Decision {}
public record Withdrawn(String reason) implements Decision {}
```

Mapper:

```java
public DecisionResponse toResponse(Decision decision) {
    return switch (decision) {
        case Approved approved ->
                new DecisionResponse("APPROVED", approved.approvalNo(), List.of());
        case Rejected rejected ->
                new DecisionResponse("REJECTED", null, rejected.reasons());
        case Withdrawn withdrawn ->
                new DecisionResponse("WITHDRAWN", null, List.of(withdrawn.reason()));
    };
}
```

Pattern matching membuat mapping closed hierarchy lebih aman.

### 5.6 Virtual Threads Tidak Menghapus Boundary Model

Java 21+ virtual threads membuat blocking I/O lebih murah. Tetapi tidak mengubah prinsip DTO boundary.

Kesalahan yang mungkin muncul:

```text
Karena request handling lebih murah, kita bisa load entity penuh dan return langsung.
```

Ini salah.

Virtual threads mengurangi cost thread blocking, bukan menghapus:

1. over-fetching,
2. lazy loading problem,
3. N+1 query,
4. data leakage,
5. serialization cost,
6. boundary coupling.

### 5.7 Scoped Values dan Context-Aware Mapping

Dengan scoped values, request context seperti tenant, correlation id, locale, atau security principal bisa dipropagasikan lebih aman daripada ThreadLocal di beberapa skenario modern.

Namun mapper tetap sebaiknya tidak diam-diam mengambil context global untuk membuat keputusan besar.

Buruk:

```java
public CaseResponse toResponse(CaseFile caseFile) {
    User user = CurrentUser.get();
    return new CaseResponse(caseFile.caseNo(), caseFile.canApprove(user));
}
```

Lebih eksplisit:

```java
public CaseResponse toResponse(CaseFile caseFile, PresentationContext context) {
    return new CaseResponse(
            caseFile.caseNo().value(),
            caseFile.status().code(),
            context.permissions().canApprove(caseFile.id())
    );
}
```

Context boleh ada, tetapi sebaiknya eksplisit pada boundary.

---

## 6. Pattern Anatomy

### 6.1 DTO Pattern

#### Context

Kamu perlu memindahkan data melewati boundary tanpa mengekspos model internal.

#### Problem

Domain/persistence model punya concern berbeda dari consumer. Jika langsung diekspos, perubahan internal akan merusak kontrak eksternal dan bisa membocorkan data.

#### Forces

1. API stability.
2. Security exposure.
3. Consumer convenience.
4. Serialization format.
5. Performance.
6. Backward compatibility.
7. Validation semantics.
8. Versioning.
9. Domain purity.
10. Mapping cost.

#### Solution

Buat object khusus untuk boundary tertentu.

Contoh:

```java
public record CaseDetailResponse(
        String caseNo,
        String status,
        String applicantName,
        List<DocumentSummaryResponse> documents
) {}
```

#### Consequences

Positif:

1. API lebih stabil.
2. Internal model terlindungi.
3. Security exposure lebih terkendali.
4. Payload bisa disesuaikan.
5. Testing lebih jelas.

Negatif:

1. Tambahan class.
2. Perlu mapping.
3. Risiko mapper drift.
4. Bisa terjadi DTO explosion jika tidak dikelola.

### 6.2 Mapper Pattern

#### Context

Ada dua model berbeda yang harus diterjemahkan.

#### Problem

Mapping tersebar di controller/service/repository menyebabkan duplicasi, leakage, dan inconsistent transformation.

#### Solution

Pusatkan transformasi di mapper yang eksplisit.

```java
public final class CaseMapper {
    public CaseSummaryResponse toSummary(CaseProjection projection) {
        return new CaseSummaryResponse(
                projection.caseNo(),
                projection.status(),
                projection.submittedDate()
        );
    }
}
```

#### Consequences

Mapper membuat boundary terlihat. Namun mapper bisa berubah menjadi tempat business logic jika tidak dijaga.

### 6.3 Assembler Pattern

#### Context

Response membutuhkan data dari banyak sumber.

#### Problem

Mapper sederhana tidak cukup karena perlu menyusun model dari domain, permission, lookup, config, dan workflow.

#### Solution

Gunakan assembler untuk composition.

```java
public final class CaseDetailAssembler {
    public CaseDetailResponse assemble(
            CaseFile caseFile,
            Applicant applicant,
            List<Document> documents,
            List<ActionAvailability> actions
    ) {
        return new CaseDetailResponse(
                caseFile.caseNo().value(),
                caseFile.status().code(),
                applicant.displayName(),
                documents.stream().map(this::document).toList(),
                actions.stream().map(this::action).toList()
        );
    }

    private DocumentSummaryResponse document(Document document) {
        return new DocumentSummaryResponse(document.id().value(), document.name());
    }

    private AvailableActionResponse action(ActionAvailability availability) {
        return new AvailableActionResponse(
                availability.action().code(),
                availability.enabled(),
                availability.reason().orElse(null)
        );
    }
}
```

#### Consequences

Assembler memisahkan use case orchestration dari response construction. Tetapi assembler tidak boleh menjadi service yang melakukan query liar ke mana-mana tanpa kontrol.

### 6.4 Presenter Pattern

#### Context

Use case menghasilkan application result. Delivery channel butuh format tertentu.

#### Problem

Jika use case langsung mengembalikan HTTP response, domain/application layer tergantung web framework.

#### Solution

Presenter menerjemahkan result ke representation.

```java
public final class SubmitCasePresenter {
    public ResponseEntity<?> present(SubmitCaseResult result) {
        return switch (result) {
            case SubmitCaseResult.Accepted accepted ->
                    ResponseEntity.status(201).body(new SubmitCaseResponse(accepted.caseNo()));
            case SubmitCaseResult.Duplicate duplicate ->
                    ResponseEntity.status(409).body(new DuplicateCaseResponse(duplicate.existingCaseNo()));
            case SubmitCaseResult.Rejected rejected ->
                    ResponseEntity.badRequest().body(new ValidationErrorResponse(rejected.reasons()));
        };
    }
}
```

#### Consequences

Framework dependency tertahan di edge. Namun jika terlalu banyak presenter kecil tanpa pola, codebase bisa terasa fragmented.

### 6.5 View Model Pattern

#### Context

UI membutuhkan data yang sudah disiapkan untuk ditampilkan.

#### Problem

Raw domain model terlalu mentah; UI harus melakukan banyak interpretasi; atau backend mengekspos data internal terlalu banyak.

#### Solution

Bangun view model yang sesuai use case tampilan.

```java
public record CaseHeaderViewModel(
        String title,
        String subtitle,
        String statusText,
        boolean showUrgentBadge
) {}
```

#### Consequences

UI sederhana dan konsisten. Tetapi view model yang terlalu visual bisa membuat backend terlalu bergantung pada detail UI yang berubah cepat.

---

## 7. Taxonomy Model di Enterprise Java

### 7.1 Input Model

Input model adalah model dari outside world.

Contoh:

```java
public record UpdateApplicantAddressRequest(
        String postalCode,
        String block,
        String street,
        String unitNo
) {}
```

Karakteristik:

1. tidak trusted,
2. raw dari client,
3. perlu validation,
4. bisa punya format eksternal,
5. tidak harus memakai domain primitive langsung,
6. tidak boleh langsung masuk domain tanpa translation.

### 7.2 Application Command

```java
public record UpdateApplicantAddressCommand(
        ApplicantId applicantId,
        Address newAddress,
        OfficerId requestedBy,
        Instant requestedAt
) {}
```

Karakteristik:

1. sudah melewati parsing,
2. sudah dikaitkan dengan authenticated actor,
3. lebih dekat ke domain,
4. bisa memakai value object,
5. merepresentasikan intent.

### 7.3 Domain Model

```java
public final class Applicant {
    private final ApplicantId id;
    private Address address;

    public void changeAddress(Address newAddress, Officer officer) {
        if (!officer.canUpdateApplicantAddress()) {
            throw new UnauthorizedDomainActionException();
        }
        this.address = Objects.requireNonNull(newAddress);
    }
}
```

Karakteristik:

1. menjaga invariant,
2. punya behavior,
3. tidak peduli HTTP/JSON,
4. tidak peduli table/column,
5. menggunakan ubiquitous language.

### 7.4 Persistence Model

```java
@Entity
@Table(name = "APPLICANT")
public class ApplicantEntity {
    @Id
    private Long id;

    @Column(name = "POSTAL_CODE")
    private String postalCode;

    @Column(name = "BLOCK")
    private String block;

    @Column(name = "STREET")
    private String street;

    @Column(name = "UNIT_NO")
    private String unitNo;
}
```

Karakteristik:

1. storage mapping,
2. ORM lifecycle,
3. lazy/eager relationship,
4. persistence constraint,
5. tidak otomatis domain.

### 7.5 Output Response

```java
public record ApplicantAddressResponse(
        String postalCode,
        String displayAddress
) {}
```

Karakteristik:

1. consumer-friendly,
2. security-filtered,
3. stable contract,
4. may contain derived field,
5. may hide internal detail.

### 7.6 Event Payload

```java
public record ApplicantAddressChangedEvent(
        String eventId,
        String applicantId,
        String oldPostalCode,
        String newPostalCode,
        Instant changedAt,
        int schemaVersion
) {}
```

Karakteristik:

1. fact-oriented,
2. versioned,
3. replayable,
4. idempotency-friendly,
5. not UI-specific,
6. not entity dump.

---

## 8. Boundary Ownership

### 8.1 Siapa Pemilik Model?

Pertanyaan paling penting:

```text
Siapa yang akan paling sakit jika model ini berubah?
```

Jika jawabannya external client, model itu API contract.

Jika jawabannya database migration, model itu persistence model.

Jika jawabannya domain expert/business rule, model itu domain model.

Jika jawabannya frontend screen, model itu view model.

Jika jawabannya downstream consumer, model itu event payload.

Ownership menentukan stabilitas.

### 8.2 Model Stability Matrix

| Model | Stability Need | Owner | Change Cost |
|---|---:|---|---:|
| Request DTO public API | Tinggi | API provider + client | Tinggi |
| Response DTO public API | Tinggi | API provider + client | Tinggi |
| Internal command | Sedang | Application layer | Sedang |
| Domain model | Tinggi secara semantic | Domain/application team | Tinggi |
| Persistence entity | Tinggi terhadap schema | Data/application team | Tinggi |
| View model internal UI | Rendah–sedang | UI/API team | Sedang |
| Event payload | Sangat tinggi | Producer + consumers | Sangat tinggi |
| Cache model | Sedang | Service owner | Sedang |
| Test fixture model | Rendah | Test owner | Rendah |

### 8.3 Boundary Change Rule

Semakin banyak consumer, semakin kecil toleransi perubahan.

```text
Internal private class can change freely.
Public API response cannot.
Event schema with many consumers is almost a database schema.
```

---

## 9. DTO Design Principles

### 9.1 Separate Input and Output

Buruk:

```java
public class CaseDto {
    public Long id;
    public String caseNo;
    public String applicantId;
    public String status;
    public String decision;
}
```

Dipakai untuk create dan response.

Lebih baik:

```java
public record CreateCaseRequest(
        String applicantId,
        String caseType,
        String description
) {}

public record CreateCaseResponse(
        String caseNo,
        String status
) {}
```

Alasan:

1. client tidak boleh mengisi `id`,
2. client tidak boleh mengisi `status`,
3. create response tidak perlu semua detail,
4. validation lebih jelas,
5. API documentation lebih akurat.

### 9.2 Separate Listing and Detail

Buruk:

```java
public record CaseResponse(
        String caseNo,
        String status,
        String applicantName,
        List<DocumentResponse> documents,
        List<AuditResponse> auditTrail,
        List<CommentResponse> comments
) {}
```

Dipakai untuk listing 1000 rows.

Lebih baik:

```java
public record CaseListItemResponse(
        String caseNo,
        String status,
        String applicantName,
        LocalDate submittedDate
) {}

public record CaseDetailResponse(
        String caseNo,
        String status,
        String applicantName,
        List<DocumentResponse> documents,
        List<CommentResponse> comments
) {}
```

Listing bukan detail.

### 9.3 Do Not Expose Entity

Buruk:

```java
@GetMapping("/cases/{id}")
public CaseEntity get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

1. lazy loading during serialization,
2. infinite recursion,
3. internal fields leaked,
4. schema changes break API,
5. security filtering sulit,
6. persistence annotations mencemari API,
7. bidirectional relationship bocor,
8. performance unpredictable.

Lebih baik:

```java
@GetMapping("/cases/{id}")
public CaseDetailResponse get(@PathVariable String caseNo) {
    CaseFile caseFile = findCaseUseCase.get(new CaseNo(caseNo));
    return mapper.toDetailResponse(caseFile);
}
```

### 9.4 Prefer Immutable DTO

DTO sebaiknya immutable terutama untuk output, event, query model, dan internal command.

Dengan record:

```java
public record CaseApprovalResponse(
        String caseNo,
        String approvedBy,
        Instant approvedAt
) {}
```

Keuntungan:

1. tidak ada mutation setelah dibuat,
2. aman untuk sharing,
3. test assertion mudah,
4. serialization lebih predictable,
5. mengurangi bug karena partial mutation.

Untuk framework lama yang butuh no-arg constructor, mutable DTO kadang perlu. Namun itu sebaiknya dibatasi di boundary adapter.

### 9.5 Avoid Boolean Explosion

Buruk:

```java
public record CaseViewResponse(
        boolean canApprove,
        boolean canReject,
        boolean canWithdraw,
        boolean canReassign,
        boolean canUploadDocument,
        boolean canDeleteDocument,
        boolean showWarning,
        boolean showEscalation,
        boolean isInternalUser,
        boolean isExternalUser
) {}
```

Lebih baik:

```java
public record CaseViewResponse(
        List<AvailableActionResponse> availableActions,
        List<NoticeResponse> notices
) {}

public record AvailableActionResponse(
        String action,
        boolean enabled,
        String disabledReason
) {}
```

Boolean explosion sering menandakan hidden state machine atau permission model.

### 9.6 Avoid Nullable Protocol

Buruk:

```java
public record DecisionResponse(
        String decision,
        String approvalNo,
        List<String> rejectionReasons,
        String withdrawalReason
) {}
```

Jika `decision = APPROVED`, maka `approvalNo` ada, `rejectionReasons` null, `withdrawalReason` null.

Ini nullable protocol.

Lebih eksplisit:

```java
public sealed interface DecisionResponse
        permits ApprovedDecisionResponse,
                RejectedDecisionResponse,
                WithdrawnDecisionResponse {
}

public record ApprovedDecisionResponse(String approvalNo) implements DecisionResponse {}
public record RejectedDecisionResponse(List<String> reasons) implements DecisionResponse {}
public record WithdrawnDecisionResponse(String reason) implements DecisionResponse {}
```

Jika JSON format harus flat, setidaknya documented dan tested dengan jelas.

### 9.7 Do Not Encode Internal Workflow Too Literally

Response ke UI tidak harus mengekspos semua internal state.

Internal:

```text
PENDING_SUPERVISOR_SCREENING
PENDING_DIRECTOR_CLEARANCE
PENDING_LEGAL_REVIEW
```

Public UI mungkin cukup:

```text
UNDER_REVIEW
```

Mengekspos state internal bisa membuat workflow sulit berubah.

Gunakan mapping:

```java
public String toPublicStatus(CaseStatus status) {
    return switch (status) {
        case DRAFT -> "DRAFT";
        case PENDING_SUPERVISOR_SCREENING,
             PENDING_DIRECTOR_CLEARANCE,
             PENDING_LEGAL_REVIEW -> "UNDER_REVIEW";
        case APPROVED -> "APPROVED";
        case REJECTED -> "REJECTED";
    };
}
```

### 9.8 Include Metadata Deliberately

Pagination response:

```java
public record PageResponse<T>(
        List<T> items,
        int page,
        int size,
        long totalElements,
        int totalPages
) {}
```

Namun hati-hati dengan `totalElements` jika query count mahal.

Kadang lebih baik cursor-based:

```java
public record CursorPageResponse<T>(
        List<T> items,
        String nextCursor,
        boolean hasMore
) {}
```

DTO harus mencerminkan cost model.

---

## 10. Mapper Design

### 10.1 Manual Mapper

Manual mapper jelas dan mudah di-debug.

```java
public final class CaseMapper {
    public CaseListItemResponse toListItem(CaseListProjection projection) {
        return new CaseListItemResponse(
                projection.caseNo(),
                projection.status(),
                projection.applicantName(),
                projection.submittedDate()
        );
    }
}
```

Keunggulan:

1. eksplisit,
2. aman untuk transformation kompleks,
3. mudah dilacak,
4. tidak ada magic runtime,
5. cocok untuk boundary penting.

Kekurangan:

1. boilerplate,
2. repetitive,
3. mudah lupa field saat ada perubahan.

### 10.2 Generated Mapper

Tools seperti MapStruct membantu generate mapper compile-time.

Contoh style:

```java
@Mapper(componentModel = "spring")
public interface CaseDtoMapper {
    CaseListItemResponse toListItem(CaseListProjection projection);
}
```

Keunggulan:

1. mengurangi boilerplate,
2. compile-time generation,
3. relatif cepat,
4. cocok untuk mapping field-to-field.

Risiko:

1. business logic tersembunyi di annotation,
2. mapping kompleks sulit dibaca,
3. nested mapping bisa tidak jelas,
4. implicit conversion bisa mengejutkan,
5. mapper bisa menjadi dumping ground.

Rule praktis:

```text
Gunakan generated mapper untuk mechanical mapping.
Gunakan manual mapper untuk semantic mapping.
```

### 10.3 Reflection Mapper

Reflection mapper seperti generic bean copier terlihat cepat dibuat.

Buruk untuk boundary penting:

```java
BeanUtils.copyProperties(entity, response);
```

Masalah:

1. field matching by name rapuh,
2. error runtime,
3. tidak jelas field mana yang exposed,
4. bisa leak field baru secara tidak sengaja,
5. performance overhead,
6. debugging lebih sulit,
7. conversion semantics tersembunyi.

Reflection mapper boleh untuk tools internal sederhana, tetapi berbahaya untuk public/security-sensitive boundary.

### 10.4 Mapper Harus Side-Effect Free

Mapper yang baik:

```text
Input model -> Output model
```

Tidak boleh:

1. update database,
2. publish event,
3. call external API,
4. mutate domain object,
5. melakukan authorization besar,
6. membuka transaction sendiri.

Buruk:

```java
public CaseResponse toResponse(CaseEntity entity) {
    entity.setLastViewedAt(Instant.now());
    auditRepository.save(...);
    return ...;
}
```

Mapper berubah menjadi service tersembunyi.

### 10.5 Mapper dan Authorization

Security filtering bisa berada di assembler/presenter, tetapi harus eksplisit.

Contoh:

```java
public CaseDetailResponse assemble(CaseFile caseFile, UserViewPolicy policy) {
    return new CaseDetailResponse(
            caseFile.caseNo().value(),
            caseFile.status().code(),
            policy.canViewSensitiveApplicantInfo()
                    ? caseFile.applicant().nric().masked()
                    : null,
            policy.canViewInternalRemarks()
                    ? caseFile.internalRemark().orElse(null)
                    : null
    );
}
```

Yang penting: security decision tidak tersebar diam-diam.

---

## 11. Assembler Design

### 11.1 Kapan Butuh Assembler?

Gunakan assembler ketika output membutuhkan beberapa sumber:

1. domain aggregate,
2. lookup table,
3. permission result,
4. workflow action availability,
5. document metadata,
6. audit summary,
7. user profile,
8. derived display field.

Controller sebaiknya tidak berisi assembly logic besar.

Buruk:

```java
@GetMapping("/cases/{caseNo}")
public CaseDetailResponse get(@PathVariable String caseNo) {
    CaseFile c = caseService.get(caseNo);
    Applicant a = applicantService.get(c.applicantId());
    List<Document> docs = documentService.findByCase(c.id());
    boolean canApprove = authService.canApprove(c);
    List<ActionResponse> actions = new ArrayList<>();
    if (canApprove) {
        actions.add(new ActionResponse("APPROVE", true, null));
    }
    return new CaseDetailResponse(...);
}
```

Lebih baik:

```java
@GetMapping("/cases/{caseNo}")
public CaseDetailResponse get(@PathVariable String caseNo) {
    CaseDetailReadModel model = queryService.getCaseDetail(new CaseNo(caseNo));
    return assembler.assemble(model);
}
```

Atau:

```java
public CaseDetailResponse get(CaseNo caseNo, UserContext user) {
    CaseFile caseFile = caseRepository.get(caseNo);
    List<Document> documents = documentRepository.findSummaries(caseFile.id());
    List<ActionAvailability> actions = actionPolicy.availableActions(caseFile, user);
    return assembler.assemble(caseFile, documents, actions);
}
```

### 11.2 Assembler Bukan Query Service

Assembler sebaiknya tidak melakukan query sembarangan.

Buruk:

```java
public CaseDetailResponse assemble(CaseFile caseFile) {
    Applicant applicant = applicantRepository.find(caseFile.applicantId());
    List<Document> docs = documentRepository.find(caseFile.id());
    List<Audit> audits = auditRepository.find(caseFile.id());
    return ...;
}
```

Ini menyembunyikan cost.

Lebih baik orchestration eksplisit:

```java
CaseFile caseFile = caseRepository.get(caseNo);
Applicant applicant = applicantRepository.get(caseFile.applicantId());
List<Document> documents = documentRepository.findSummaries(caseFile.id());
return assembler.assemble(caseFile, applicant, documents);
```

Assembler boleh melakukan pure composition, bukan orchestration I/O besar.

### 11.3 Assembler dan Query Projection

Untuk read-heavy endpoint, domain aggregate penuh tidak selalu perlu.

```java
public record CaseDetailProjection(
        String caseNo,
        String status,
        String applicantName,
        String officerName,
        LocalDate submittedDate
) {}
```

Assembler:

```java
public CaseDetailResponse assemble(CaseDetailProjection projection) {
    return new CaseDetailResponse(
            projection.caseNo(),
            projection.status(),
            projection.applicantName(),
            projection.officerName(),
            projection.submittedDate()
    );
}
```

Ini menghindari over-fetching.

---

## 12. Presenter Design

### 12.1 Presenter untuk Memisahkan Use Case dari Delivery

Application use case:

```java
public SubmitCaseResult submit(SubmitCaseCommand command) {
    // domain/application logic
}
```

Controller:

```java
@PostMapping("/cases")
public ResponseEntity<?> submit(@RequestBody CreateCaseRequest request) {
    SubmitCaseCommand command = requestMapper.toCommand(request, currentUser());
    SubmitCaseResult result = submitCaseUseCase.submit(command);
    return presenter.present(result);
}
```

Presenter:

```java
public final class SubmitCaseHttpPresenter {
    public ResponseEntity<?> present(SubmitCaseResult result) {
        return switch (result) {
            case SubmitCaseResult.Success success ->
                    ResponseEntity.status(201).body(new CreateCaseResponse(success.caseNo()));
            case SubmitCaseResult.ValidationFailed failed ->
                    ResponseEntity.badRequest().body(new ValidationErrorResponse(failed.errors()));
            case SubmitCaseResult.Duplicate duplicate ->
                    ResponseEntity.status(409).body(new DuplicateCaseResponse(duplicate.caseNo()));
        };
    }
}
```

Benefit:

1. use case tidak tahu HTTP,
2. mapping result jelas,
3. status code konsisten,
4. testing easier,
5. bisa reuse use case untuk batch/message.

### 12.2 Presenter untuk Error Representation

Error response sebaiknya standard.

```java
public record ProblemResponse(
        String type,
        String title,
        int status,
        String detail,
        String instance,
        String correlationId,
        List<FieldErrorResponse> errors
) {}
```

Presenter/error handler mengubah exception/result menjadi error DTO.

Jangan biarkan exception internal langsung serialized.

Buruk:

```json
{
  "exception": "org.hibernate.LazyInitializationException",
  "message": "failed to lazily initialize..."
}
```

Lebih baik:

```json
{
  "type": "https://api.example.com/problems/case-not-readable",
  "title": "Case cannot be read",
  "status": 403,
  "detail": "You do not have permission to view this case.",
  "correlationId": "..."
}
```

### 12.3 Presenter dan Localization

Jika message perlu localized, presenter boundary adalah tempat yang cukup natural.

Namun jangan simpan domain invariant sebagai localized string.

Domain:

```java
public record DomainViolation(String code, Map<String, Object> parameters) {}
```

Presenter:

```java
String message = messageSource.getMessage(violation.code(), args, locale);
```

---

## 13. View Model Design

### 13.1 Backend View Model vs Frontend View State

Backend response bisa membantu UI, tetapi jangan mengambil seluruh tanggung jawab frontend state.

Baik:

```java
public record CaseDetailResponse(
        String caseNo,
        String statusText,
        List<AvailableActionResponse> availableActions,
        List<NoticeResponse> notices
) {}
```

Terlalu UI-specific:

```java
public record CaseDetailResponse(
        String statusBadgeColorHex,
        int buttonMarginLeftPx,
        String modalAnimationName
) {}
```

Backend sebaiknya mengirim semantic information, bukan pixel-level visual decision.

### 13.2 Available Actions sebagai View Model Penting

Dalam sistem workflow, UI sering butuh tahu aksi apa yang tersedia.

Buruk:

```java
public record CaseResponse(
        boolean canApprove,
        boolean canReject,
        boolean canReturn,
        boolean canEscalate
) {}
```

Lebih scalable:

```java
public record AvailableActionResponse(
        String code,
        String label,
        boolean enabled,
        String disabledReason
) {}
```

Keunggulan:

1. action baru tidak menambah field boolean,
2. lebih cocok untuk dynamic workflow,
3. disabled reason bisa ditampilkan,
4. audit/debug lebih mudah.

### 13.3 View Model untuk Form

Form create/edit kadang butuh dropdown/lookup.

```java
public record CreateCaseFormModel(
        List<OptionResponse> caseTypes,
        List<OptionResponse> priorityLevels,
        List<FieldRuleResponse> fieldRules
) {}
```

Ini bukan domain model. Ini UI support model.

Pisahkan dari create request.

---

## 14. Versioning DTO

### 14.1 Public API DTO Harus Memikirkan Compatibility

Perubahan aman:

1. menambah optional field pada response,
2. menambah enum value jika consumer siap,
3. menambah endpoint baru,
4. menambah field request optional dengan default jelas.

Perubahan berisiko:

1. rename field,
2. remove field,
3. change type,
4. change semantics,
5. make optional field required,
6. change enum meaning,
7. change date/time format,
8. change sorting default tanpa dokumentasi.

### 14.2 Versioned DTO

Kadang butuh versi eksplisit:

```java
public record CaseDetailResponseV1(
        String caseNo,
        String status
) {}

public record CaseDetailResponseV2(
        String caseNo,
        String status,
        String displayStatus,
        List<AvailableActionResponse> availableActions
) {}
```

Namun versi berlebihan juga mahal.

Rule:

```text
Version when semantics or compatibility truly changes.
Do not version every minor internal refactor.
```

### 14.3 Event Payload Versioning

Event payload lebih sensitif daripada response biasa karena consumer bisa asynchronous dan tidak langsung terlihat.

```java
public record CaseApprovedEventV1(
        String eventId,
        String caseNo,
        Instant approvedAt
) {}

public record CaseApprovedEventV2(
        String eventId,
        String caseNo,
        String approvedBy,
        Instant approvedAt,
        int schemaVersion
) {}
```

Event evolution harus mempertimbangkan:

1. old consumer,
2. replay old event,
3. schema registry jika ada,
4. default value,
5. optional field,
6. semantic compatibility.

---

## 15. Partial Update Model

### 15.1 PUT vs PATCH Semantics

PUT biasanya mengganti representation penuh.

PATCH mengganti sebagian field.

Jangan menyamakan keduanya.

Buruk:

```java
public record UpdateCaseRequest(
        String description,
        String priority,
        String assignedOfficer
) {}
```

Jika field null, artinya apa?

1. tidak diubah?
2. dihapus?
3. diset null?
4. invalid?

### 15.2 Explicit Patch Field

Salah satu pendekatan:

```java
public sealed interface PatchField<T> permits PatchField.Absent, PatchField.Present {
    record Absent<T>() implements PatchField<T> {}
    record Present<T>(T value) implements PatchField<T> {}
}
```

Lalu:

```java
public record PatchCaseRequest(
        PatchField<String> description,
        PatchField<String> priority
) {}
```

Namun serialization-nya perlu dirancang.

Dalam praktik API, bisa juga pakai JSON Merge Patch/JSON Patch jika sesuai.

### 15.3 Avoid Null Ambiguity

Null ambiguity adalah sumber bug besar.

Jika null berarti “tidak dikirim”, jangan pakai class yang tidak bisa membedakan absent dan explicit null.

---

## 16. Anti-Pattern Catalog

### 16.1 Universal DTO

#### Bentuk

```java
public class CaseDto {
    // every field for every use case
}
```

#### Kenapa Terlihat Menarik

1. fewer classes,
2. cepat saat awal,
3. mapping sedikit,
4. semua field tersedia.

#### Kenapa Berbahaya

1. hidden coupling,
2. security leakage,
3. nullable explosion,
4. performance overhead,
5. API docs tidak akurat,
6. validation penuh conditional,
7. perubahan satu use case merusak use case lain.

#### Refactoring

Pisah berdasarkan use case:

1. `CreateCaseRequest`,
2. `CreateCaseResponse`,
3. `CaseListItemResponse`,
4. `CaseDetailResponse`,
5. `CaseApprovedEventPayload`,
6. `CaseExportRow`.

### 16.2 Entity Exposed as API

#### Bentuk

```java
return repository.findById(id).orElseThrow();
```

#### Failure Mode

1. lazy loading exception,
2. infinite recursion JSON,
3. field leakage,
4. schema/API coupling,
5. accidental over-fetching,
6. security review failure.

#### Refactoring

Introduce response DTO and mapper.

### 16.3 DTO Explosion

#### Bentuk

Terlalu banyak DTO yang berbeda hanya karena naming tidak terkontrol.

```text
CaseDto
CaseDataDto
CaseInfoDto
CaseInfoResponse
CaseViewDto
CaseViewResponse
CaseResultDto
CaseResultResponse
```

#### Failure Mode

1. developer bingung pakai yang mana,
2. duplicate mapping,
3. inconsistent fields,
4. maintenance cost tinggi.

#### Refactoring

Gunakan taxonomy jelas:

```text
<Create><Entity><Request>
<Create><Entity><Command>
<Entity><ListItemResponse>
<Entity><DetailResponse>
<Entity><EventPayload>
<Entity><ExportRow>
```

### 16.4 Mapper Logic Leak

#### Bentuk

Mapper melakukan business decision.

```java
public CaseResponse toResponse(CaseEntity entity) {
    if (entity.getFineAmount().compareTo(BigDecimal.valueOf(10000)) > 0) {
        entity.setEscalated(true);
    }
    return ...;
}
```

#### Failure Mode

1. business rule tidak ter-test di domain/application layer,
2. output mapping mengubah state,
3. behavior tergantung endpoint,
4. side effect tersembunyi.

#### Refactoring

Pindahkan rule ke domain/service/policy. Mapper hanya membaca result.

### 16.5 Reflection Copy Abuse

#### Bentuk

```java
BeanUtils.copyProperties(source, target);
```

Dipakai untuk boundary penting.

#### Failure Mode

1. field baru otomatis bocor,
2. type conversion mengejutkan,
3. silent missing field,
4. runtime error,
5. mapping tidak searchable,
6. security filtering lemah.

#### Refactoring

Gunakan explicit mapper/manual/generated compile-time mapper.

### 16.6 DTO as Domain Model

#### Bentuk

```java
public class CaseDto {
    public String status;

    public void approve() {
        this.status = "APPROVED";
    }
}
```

DTO berubah menjadi domain object palsu.

#### Failure Mode

1. invariant lemah,
2. stringly typed status,
3. behavior tersebar,
4. persistence/API/domain campur.

#### Refactoring

Buat domain model nyata.

### 16.7 View Model as Database Query Dump

#### Bentuk

Response mengikuti hasil join mentah.

```java
public record CaseDashboardResponse(
        String col1,
        String col2,
        String col3,
        String col4
) {}
```

#### Failure Mode

1. meaning hilang,
2. API tergantung query,
3. consumer harus menebak semantics,
4. refactor query memecahkan contract.

#### Refactoring

Nama field berdasarkan meaning, bukan column/query artifact.

### 16.8 Event Payload as Entity Dump

#### Bentuk

```java
public record CaseChangedEvent(CaseEntity entity) {}
```

#### Failure Mode

1. consumer tergantung internal schema,
2. event besar,
3. PII leakage,
4. replay sulit,
5. schema evolution kacau.

#### Refactoring

Buat event payload fact-oriented.

### 16.9 Request DTO with Trusted Fields

#### Bentuk

```java
public record ApproveCaseRequest(
        String caseNo,
        String approvedBy,
        Instant approvedAt,
        boolean supervisorOverride
) {}
```

Client tidak boleh menentukan `approvedBy`, `approvedAt`, atau `supervisorOverride` tanpa server-side authorization.

#### Refactoring

Ambil trusted data dari server context.

```java
public record ApproveCaseRequest(String reason) {}

public record ApproveCaseCommand(
        CaseNo caseNo,
        OfficerId approvedBy,
        ApprovalReason reason,
        Instant approvedAt
) {}
```

---

## 17. Refactoring Path

### 17.1 Dari Entity Exposed ke Response DTO

Awal:

```java
@GetMapping("/cases/{id}")
public CaseEntity get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Step 1: Tambah DTO tanpa mengubah endpoint path.

```java
public record CaseDetailResponse(
        String caseNo,
        String status,
        String applicantName
) {}
```

Step 2: Buat mapper eksplisit.

```java
public CaseDetailResponse toResponse(CaseEntity entity) {
    return new CaseDetailResponse(
            entity.getCaseNo(),
            entity.getStatus(),
            entity.getApplicantName()
    );
}
```

Step 3: Ubah controller.

```java
@GetMapping("/cases/{id}")
public CaseDetailResponse get(@PathVariable Long id) {
    CaseEntity entity = repository.findById(id).orElseThrow();
    return mapper.toResponse(entity);
}
```

Step 4: Tambahkan contract test.

Step 5: Hapus serialization annotation yang dipakai untuk menambal entity.

### 17.2 Dari Universal DTO ke Use-Case DTO

Awal:

```java
public class CaseDto { ... }
```

Step:

1. Identifikasi endpoint/use case yang memakai DTO.
2. Kelompokkan field berdasarkan consumer.
3. Buat DTO baru untuk satu use case paling berisiko.
4. Tambahkan mapper adapter dari old DTO jika perlu compatibility.
5. Migrasikan endpoint satu per satu.
6. Tambahkan tests untuk response shape.
7. Deprecate universal DTO.
8. Hapus setelah tidak dipakai.

### 17.3 Dari Mapper Logic Leak ke Policy + Mapper

Awal:

```java
public CaseResponse toResponse(CaseFile caseFile, User user) {
    boolean canApprove = user.hasRole("SUPERVISOR")
            && caseFile.status().equals("PENDING_REVIEW")
            && !caseFile.hasBlockingIssue();
    return new CaseResponse(caseFile.caseNo(), canApprove);
}
```

Refactor:

```java
public final class CaseActionPolicy {
    public ActionAvailability canApprove(CaseFile caseFile, User user) {
        if (!user.hasPermission(Permission.APPROVE_CASE)) {
            return ActionAvailability.disabled("NO_PERMISSION");
        }
        if (!caseFile.status().canApprove()) {
            return ActionAvailability.disabled("INVALID_STATUS");
        }
        if (caseFile.hasBlockingIssue()) {
            return ActionAvailability.disabled("BLOCKING_ISSUE");
        }
        return ActionAvailability.enabled();
    }
}
```

Mapper/assembler:

```java
public CaseResponse assemble(CaseFile caseFile, ActionAvailability approveAvailability) {
    return new CaseResponse(
            caseFile.caseNo().value(),
            List.of(new AvailableActionResponse(
                    "APPROVE",
                    approveAvailability.enabled(),
                    approveAvailability.reason().orElse(null)
            ))
    );
}
```

---

## 18. Testing Strategy

### 18.1 DTO Contract Test

Untuk public API, test response shape.

```java
@Test
void caseDetailResponse_shouldNotExposeInternalRemark() throws Exception {
    mockMvc.perform(get("/cases/C-001"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.caseNo").value("C-001"))
            .andExpect(jsonPath("$.internalRemark").doesNotExist());
}
```

### 18.2 Mapper Unit Test

```java
@Test
void toListItem_shouldMapProjectionToResponse() {
    CaseListProjection projection = new CaseListProjection(
            "C-001",
            "UNDER_REVIEW",
            "Alice",
            LocalDate.of(2026, 1, 15)
    );

    CaseListItemResponse response = mapper.toListItem(projection);

    assertEquals("C-001", response.caseNo());
    assertEquals("UNDER_REVIEW", response.status());
    assertEquals("Alice", response.applicantName());
}
```

### 18.3 Security Exposure Test

Test field sensitif.

```java
@Test
void publicEndpoint_shouldMaskApplicantIdentifier() throws Exception {
    mockMvc.perform(get("/public/cases/C-001"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.applicantNric").value("S****123A"));
}
```

### 18.4 Snapshot Test dengan Hati-Hati

Snapshot test bisa membantu contract, tetapi jangan terlalu brittle.

Gunakan untuk payload stabil seperti event schema atau public API response penting.

### 18.5 Event Payload Compatibility Test

```java
@Test
void caseApprovedEvent_shouldContainStableFields() throws Exception {
    CaseApprovedEventPayload event = new CaseApprovedEventPayload(
            "evt-1",
            "C-001",
            "officer-1",
            Instant.parse("2026-01-01T00:00:00Z"),
            "APPROVED",
            1
    );

    String json = objectMapper.writeValueAsString(event);

    assertThat(json).contains("caseNo");
    assertThat(json).contains("schemaVersion");
    assertThat(json).doesNotContain("internalRemark");
}
```

### 18.6 Mapper Exhaustiveness Test

Untuk enum/status mapping:

```java
@Test
void everyInternalStatus_shouldHavePublicStatusMapping() {
    for (CaseStatus status : CaseStatus.values()) {
        assertDoesNotThrow(() -> mapper.toPublicStatus(status));
    }
}
```

Dengan sealed switch, compiler bisa membantu exhaustiveness.

---

## 19. Observability and Debugging Angle

### 19.1 Mapping Failure Harus Mudah Dilacak

Jika mapping gagal, log harus menjawab:

1. source model type,
2. target model type,
3. entity id/case no,
4. correlation id,
5. field yang gagal jika aman,
6. jangan leak PII.

Contoh:

```java
log.warn("Failed to map case detail response, caseNo={}, source={}, target={}, correlationId={}",
        caseNo,
        "CaseFile",
        "CaseDetailResponse",
        correlationId,
        exception);
```

### 19.2 Metrics

Metrics yang berguna:

1. response payload size,
2. mapper failure count,
3. serialization failure count,
4. endpoint response time by DTO type,
5. event serialization failure,
6. schema validation failure,
7. field masking failure if detectable,
8. deprecated DTO usage count.

### 19.3 Payload Size Monitoring

Universal DTO sering menyebabkan payload membesar perlahan.

Monitor:

```text
http.response.size{endpoint="/cases"}
```

Jika listing payload tiba-tiba naik, mungkin ada field nested baru.

### 19.4 Logging DTO

Jangan log seluruh DTO sembarangan.

Buruk:

```java
log.info("response={}", response);
```

Jika record `toString()` membawa PII, data sensitif bisa masuk log.

Lebih baik:

```java
log.info("case response built, caseNo={}, status={}, documentCount={}",
        response.caseNo(),
        response.status(),
        response.documents().size());
```

---

## 20. Security and Compliance Angle

DTO boundary adalah security boundary.

### 20.1 Field Exposure Control

Sebelum menambah field response, tanya:

1. siapa consumer-nya?
2. apakah field sensitif?
3. apakah field boleh dilihat semua role?
4. apakah field perlu masking?
5. apakah field termasuk PII?
6. apakah field masuk audit/log?
7. apakah field boleh dikirim ke downstream?
8. apakah field akan tersimpan di browser/cache?

### 20.2 Trusted vs Untrusted Input

Request DTO dari client selalu untrusted.

Jangan percaya:

1. `userId`,
2. `role`,
3. `approvedBy`,
4. `createdAt`,
5. `status`,
6. `permission`,
7. `tenantId`,
8. `isAdmin`,
9. `workflowState`.

Ambil dari server context, token, session, atau authorization service.

### 20.3 Mass Assignment Vulnerability

Mass assignment terjadi ketika request body langsung di-bind ke entity/domain object yang punya field sensitif.

Buruk:

```java
@PostMapping("/users")
public UserEntity create(@RequestBody UserEntity entity) {
    return repository.save(entity);
}
```

Client bisa mengirim:

```json
{
  "username": "alice",
  "role": "ADMIN",
  "enabled": true
}
```

Gunakan request DTO yang hanya berisi allowed fields.

### 20.4 Masking Harus Konsisten

```java
public record ApplicantResponse(
        String name,
        String maskedIdentifier
) {}
```

Jangan setiap mapper punya masking sendiri.

Gunakan service/value object/policy khusus:

```java
public final class IdentifierMasker {
    public String mask(NationalIdentifier identifier) {
        return identifier.masked();
    }
}
```

---

## 21. Performance Angle

### 21.1 DTO Shape Mempengaruhi Query Cost

Jika response butuh nested data, query ikut berat.

Listing endpoint harus minimal.

Buruk:

```java
List<CaseDetailResponse> listCases();
```

Lebih baik:

```java
PageResponse<CaseListItemResponse> listCases();
```

### 21.2 Avoid Over-Mapping

Jangan map entity penuh jika hanya butuh 5 field.

Gunakan projection/read model.

```java
public record CaseListProjection(
        String caseNo,
        String status,
        String applicantName,
        LocalDate submittedDate
) {}
```

### 21.3 Mapping Cost Biasanya Bukan Bottleneck Utama

Di banyak enterprise apps, mapping object bukan bottleneck utama dibanding:

1. database query,
2. network call,
3. serialization payload besar,
4. N+1,
5. external API latency.

Namun mapping bisa menjadi bottleneck jika:

1. payload sangat besar,
2. batch jutaan row,
3. reflection mapper,
4. deep nested conversion,
5. unnecessary intermediate object,
6. excessive date/time formatting.

### 21.4 Streaming Export Model

Export tidak harus membangun DTO besar di memory.

Untuk export besar, gunakan row model dan streaming writer.

```java
public record CaseExportRow(
        String caseNo,
        String status,
        String applicantName,
        LocalDate submittedDate
) {}
```

---

## 22. Package and Naming Convention

### 22.1 Package by Boundary

Contoh:

```text
com.example.caseapp.casefile.api.request
com.example.caseapp.casefile.api.response
com.example.caseapp.casefile.application.command
com.example.caseapp.casefile.application.result
com.example.caseapp.casefile.domain
com.example.caseapp.casefile.persistence.entity
com.example.caseapp.casefile.persistence.mapper
com.example.caseapp.casefile.integration.event
com.example.caseapp.casefile.presentation
```

Atau package by feature:

```text
casefile/
  api/
    request/
    response/
  application/
    command/
    result/
  domain/
  persistence/
  integration/
  presentation/
```

Yang penting boundary terlihat.

### 22.2 Naming Heuristic

Gunakan suffix yang bermakna:

| Suffix | Makna |
|---|---|
| `Request` | Raw API input |
| `Response` | API output |
| `Command` | Application intent |
| `Result` | Use case result |
| `EventPayload` | Message/event contract |
| `Entity` | Persistence model |
| `Projection` | Query result from DB/read model |
| `ViewModel` | UI/rendering-oriented model |
| `ExportRow` | Row untuk export |
| `Mapper` | Model translation |
| `Assembler` | Composition of response from multiple inputs |
| `Presenter` | Delivery-specific representation |

Hindari suffix ambigu:

1. `Data`,
2. `Info`,
3. `Model`,
4. `Bean`,
5. `Object`,
6. `Payload` tanpa konteks.

Bukan berarti tidak pernah boleh, tetapi biasanya kurang spesifik.

---

## 23. Case Study: Regulatory Case Detail Endpoint

### 23.1 Problem Awal

Endpoint:

```text
GET /cases/{caseNo}
```

Mengembalikan entity langsung.

Masalah:

1. internal remarks leaked,
2. applicant identifier unmasked,
3. documents lazy-loaded,
4. audit trail terlalu besar,
5. available actions dihitung di frontend,
6. status internal exposed,
7. response berubah saat entity berubah.

### 23.2 Target Design

Response:

```java
public record CaseDetailResponse(
        String caseNo,
        String publicStatus,
        String applicantName,
        String maskedApplicantIdentifier,
        List<DocumentSummaryResponse> documents,
        List<AvailableActionResponse> availableActions,
        List<NoticeResponse> notices
) {}
```

Document:

```java
public record DocumentSummaryResponse(
        String documentId,
        String fileName,
        String documentType,
        Instant uploadedAt
) {}
```

Available action:

```java
public record AvailableActionResponse(
        String code,
        String label,
        boolean enabled,
        String disabledReason
) {}
```

Notice:

```java
public record NoticeResponse(
        String severity,
        String code,
        String message
) {}
```

### 23.3 Application Flow

```text
Controller
  -> parse caseNo
  -> get current user
  -> query CaseDetailReadService
  -> compute action availability
  -> assemble response
  -> return response
```

### 23.4 Code Sketch

```java
@RestController
@RequestMapping("/cases")
public final class CaseController {
    private final CaseDetailUseCase useCase;
    private final CaseDetailPresenter presenter;

    @GetMapping("/{caseNo}")
    public ResponseEntity<CaseDetailResponse> getCase(@PathVariable String caseNo) {
        CaseDetailResult result = useCase.getDetail(new CaseNo(caseNo));
        return ResponseEntity.ok(presenter.present(result));
    }
}
```

Use case result:

```java
public record CaseDetailResult(
        CaseDetailProjection caseDetail,
        List<DocumentProjection> documents,
        List<ActionAvailability> actionAvailabilities,
        List<Notice> notices
) {}
```

Presenter:

```java
public final class CaseDetailPresenter {
    public CaseDetailResponse present(CaseDetailResult result) {
        return new CaseDetailResponse(
                result.caseDetail().caseNo(),
                toPublicStatus(result.caseDetail().internalStatus()),
                result.caseDetail().applicantName(),
                mask(result.caseDetail().applicantIdentifier()),
                result.documents().stream().map(this::document).toList(),
                result.actionAvailabilities().stream().map(this::action).toList(),
                result.notices().stream().map(this::notice).toList()
        );
    }

    private DocumentSummaryResponse document(DocumentProjection document) {
        return new DocumentSummaryResponse(
                document.documentId(),
                document.fileName(),
                document.documentType(),
                document.uploadedAt()
        );
    }

    private AvailableActionResponse action(ActionAvailability availability) {
        return new AvailableActionResponse(
                availability.actionCode(),
                availability.label(),
                availability.enabled(),
                availability.disabledReason().orElse(null)
        );
    }

    private NoticeResponse notice(Notice notice) {
        return new NoticeResponse(
                notice.severity().name(),
                notice.code(),
                notice.message()
        );
    }
}
```

### 23.5 Design Result

Perbaikan:

1. Entity tidak exposed.
2. Internal status diterjemahkan.
3. Identifier di-mask.
4. Documents hanya summary.
5. Available actions server-driven.
6. Audit trail tidak ikut detail response kecuali endpoint khusus.
7. Response stabil terhadap perubahan persistence.
8. Testing bisa fokus ke contract.

---

## 24. Decision Matrix

### 24.1 Kapan Membuat DTO Baru?

Buat DTO baru jika:

1. consumer berbeda,
2. lifecycle berbeda,
3. security exposure berbeda,
4. performance profile berbeda,
5. validation semantics berbeda,
6. compatibility contract berbeda,
7. serialization format berbeda,
8. field ownership berbeda.

Reuse DTO jika:

1. boundary sama,
2. consumer sama,
3. semantics sama,
4. compatibility sama,
5. field meaning sama,
6. change reason sama.

### 24.2 Manual Mapper vs Generated Mapper

| Kondisi | Pilihan |
|---|---|
| Semantic transformation kompleks | Manual mapper |
| Simple field-to-field | Generated mapper |
| Security-sensitive exposure | Manual/explicit mapper |
| High volume repetitive mapping | Generated mapper possible |
| Debugging clarity penting | Manual mapper |
| Mapping banyak tapi mechanical | MapStruct-style mapper |
| Dynamic untyped payload | Manual parsing/validation |
| Public API boundary | Explicit mapper |

### 24.3 DTO vs Domain Model

| Pertanyaan | DTO | Domain Model |
|---|---|---|
| Melewati network? | Ya | Tidak ideal |
| Menjaga invariant? | Minimal | Ya |
| Punya behavior bisnis? | Tidak/sebaiknya ringan | Ya |
| Stabil untuk client? | Ya | Stabil secara semantic internal |
| Terikat persistence? | Tidak | Tidak seharusnya |
| Serializable? | Biasanya | Bukan tujuan utama |

---

## 25. Staff-Level Discussion

### 25.1 Kenapa Tidak Satu DTO Saja Agar Simpel?

Karena simplicity yang hanya mengurangi jumlah class sering memindahkan kompleksitas ke tempat lain:

1. conditional validation,
2. nullable protocol,
3. security leak,
4. consumer coupling,
5. performance regression,
6. undocumented semantics.

Simplicity yang baik adalah boundary yang jelas, bukan file yang sedikit.

### 25.2 Apakah Banyak DTO Selalu Bagus?

Tidak.

Banyak DTO tanpa taxonomy juga buruk. Tujuannya bukan memperbanyak class, tetapi memisahkan boundary yang memang memiliki alasan perubahan berbeda.

### 25.3 Apakah Mapper Itu Boilerplate?

Sebagian iya. Tetapi boilerplate yang menjaga boundary sering lebih murah daripada coupling tersembunyi.

Pertanyaan yang lebih tepat:

```text
Apakah mapping ini mechanical atau semantic?
```

Mechanical mapping bisa digenerate.

Semantic mapping harus dibaca manusia.

### 25.4 Apakah Domain Model Boleh Langsung Jadi Response?

Untuk aplikasi kecil/internal, kadang bisa diterima. Untuk enterprise/regulatory/public API, biasanya tidak.

Alasannya:

1. security,
2. compatibility,
3. auditability,
4. performance,
5. domain purity,
6. consumer-specific shape.

### 25.5 Apakah Record Selalu Cocok untuk DTO?

Record sangat cocok untuk immutable DTO. Tetapi record tetap harus dirancang.

Record tidak menyelesaikan:

1. boundary confusion,
2. universal DTO,
3. nullable protocol,
4. field leakage,
5. wrong ownership,
6. compatibility issue.

---

## 26. Design Review Checklist

Gunakan checklist ini saat review PR yang menambah DTO/mapper/API response.

### Boundary

1. Boundary apa yang dilayani model ini?
2. Siapa consumer-nya?
3. Apakah model ini input, output, command, event, projection, atau entity?
4. Apakah model ini dipakai lintas boundary?
5. Apakah reuse ini benar atau hanya hemat class?

### Security

1. Apakah ada field sensitif?
2. Apakah field sudah masked?
3. Apakah client bisa mengisi trusted field?
4. Apakah response expose internal workflow?
5. Apakah DTO pernah masuk log?

### Compatibility

1. Apakah DTO public contract?
2. Apakah perubahan backward compatible?
3. Apakah event payload versioned?
4. Apakah enum value aman untuk consumer?
5. Apakah date/time format stabil?

### Performance

1. Apakah endpoint listing membawa detail nested?
2. Apakah DTO menyebabkan over-fetching?
3. Apakah mapper memicu lazy loading?
4. Apakah response payload terlalu besar?
5. Apakah query projection lebih tepat?

### Mapping

1. Apakah mapping eksplisit?
2. Apakah mapper punya side effect?
3. Apakah mapper mengandung business rule?
4. Apakah generated mapper cukup aman?
5. Apakah mapping error observable?

### Semantics

1. Apakah field name mencerminkan meaning, bukan database column?
2. Apakah null semantics jelas?
3. Apakah boolean explosion terjadi?
4. Apakah status internal perlu diterjemahkan?
5. Apakah output model sesuai kebutuhan consumer?

---

## 27. Common Smell and Better Direction

| Smell | Meaning | Better Direction |
|---|---|---|
| One DTO for all operations | Boundary mixed | Split by use case |
| Entity returned by controller | Persistence leak | Response DTO |
| Many nullable fields | Multiple shapes hidden | Separate DTO/sealed output |
| `BeanUtils.copyProperties` | Implicit mapping | Explicit mapper |
| Mapper calls repository | Hidden I/O | Move to service/use case |
| Request contains `status` | Client controls server-owned field | Derive from server/domain |
| Listing response contains nested details | Over-fetching | List item DTO/projection |
| Event contains entity | Internal schema leak | Event payload |
| Field named `data1`/`info` | Semantic unclear | Meaningful field name |
| DTO contains UI pixel detail | Backend coupled to UI rendering | Semantic view model |

---

## 28. Practical Heuristics

### 28.1 The One-Sentence Test

Untuk setiap DTO, kamu harus bisa menjawab dalam satu kalimat:

```text
Model ini adalah kontrak untuk [consumer] ketika [use case] melalui [boundary].
```

Contoh:

```text
CreateCaseRequest adalah kontrak input public API untuk membuat case baru melalui HTTP.
```

Jika tidak bisa dijawab, DTO mungkin terlalu ambigu.

### 28.2 The Field Ownership Test

Untuk setiap field, tanya:

```text
Siapa yang boleh menentukan nilai field ini?
```

Jika client tidak boleh menentukan, jangan taruh di request.

### 28.3 The Change Reason Test

Jika dua field/model berubah karena alasan berbeda, jangan paksa satu model.

### 28.4 The Consumer Cost Test

Jika DTO berubah, siapa yang harus update?

Jika jawabannya banyak consumer, perubahan harus sangat hati-hati.

### 28.5 The Mapper Honesty Test

Mapper harus jujur tentang transformation.

Jika mapping mengandung decision penting, jangan sembunyikan di annotation magic.

---

## 29. Mini Lab

### 29.1 Starting Code

```java
public class ApplicationDto {
    public Long id;
    public String applicationNo;
    public String applicantId;
    public String applicantName;
    public String applicantNric;
    public String status;
    public String internalStatus;
    public String internalRemark;
    public String decision;
    public String createdBy;
    public LocalDateTime createdAt;
    public LocalDateTime submittedAt;
    public List<DocumentDto> documents;
    public List<AuditDto> audits;
    public boolean canApprove;
    public boolean canReject;
}
```

Dipakai untuk:

1. create request,
2. listing response,
3. detail response,
4. event payload.

### 29.2 Refactor Target

Buat:

```java
public record CreateApplicationRequest(
        String applicantId,
        String applicationType,
        List<String> documentIds
) {}

public record ApplicationListItemResponse(
        String applicationNo,
        String applicantName,
        String status,
        LocalDate submittedDate
) {}

public record ApplicationDetailResponse(
        String applicationNo,
        String applicantName,
        String maskedApplicantIdentifier,
        String status,
        List<DocumentSummaryResponse> documents,
        List<AvailableActionResponse> availableActions
) {}

public record ApplicationSubmittedEventPayload(
        String eventId,
        String applicationNo,
        String applicantId,
        Instant submittedAt,
        int schemaVersion
) {}
```

### 29.3 Exercise Questions

1. Field mana yang tidak boleh ada di create request?
2. Field mana yang hanya untuk internal officer?
3. Field mana yang harus masked?
4. Field mana yang tidak boleh masuk event payload?
5. Listing endpoint butuh field apa saja?
6. Detail endpoint butuh nested apa saja?
7. Apakah `canApprove/canReject` lebih baik boolean atau available actions?
8. Apakah event harus membawa applicant name?
9. Apakah status public sama dengan internal status?
10. Mapper mana yang manual, mana yang bisa generated?

---

## 30. Summary

DTO, Mapper, Assembler, Presenter, dan View Model adalah pola boundary design.

Inti pemahamannya:

1. DTO bukan domain model.
2. DTO bukan persistence entity.
3. DTO adalah kontrak boundary.
4. Setiap boundary punya ownership, lifecycle, security, dan compatibility berbeda.
5. Mapper bukan sekadar boilerplate; mapper adalah titik translasi semantics.
6. Assembler menyusun response dari banyak sumber, tetapi jangan menyembunyikan I/O liar.
7. Presenter menjaga use case tetap bebas dari delivery mechanism.
8. View model membantu consumer, tetapi jangan terlalu mengikat backend pada detail visual UI.
9. Universal DTO hampir selalu menjadi coupling trap.
10. Entity exposed as API adalah salah satu anti-pattern paling mahal di Java enterprise.
11. Java records membuat DTO lebih ringkas, tetapi tidak otomatis membuat desain benar.
12. Sealed classes dan pattern matching membantu modeling output variants dengan lebih aman.
13. Security, compatibility, performance, dan observability harus dipertimbangkan saat mendesain model data boundary.

Mental model terakhir:

```text
Jangan bertanya: “Bisa tidak class ini dipakai ulang?”

Tanyakan:
“Apakah boundary ini punya alasan perubahan, consumer, security exposure, dan lifecycle yang sama?”
```

Jika jawabannya tidak, buat model yang berbeda.

---

## 31. Status Seri

```text
Part 20 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
21-error-handling-result-exception-translation-problem-details.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./19-repository-dao-data-mapper-unit-of-work-query-object.md">⬅️ Repository, DAO, Data Mapper, Unit of Work, Query Object</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./21-error-handling-result-exception-translation-problem-details.md">Error Handling Patterns: Result, Exception Translation, Problem Details ➡️</a>
</div>
