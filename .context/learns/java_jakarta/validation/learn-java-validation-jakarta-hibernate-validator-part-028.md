# learn-java-validation-jakarta-hibernate-validator-part-028

# Architecture Patterns: Validation Layering in Large Systems

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: 028  
> Target pembaca: Java engineer yang sudah memahami Java core, Spring/Jakarta, persistence, REST, event-driven systems, testing, JVM/performance, dan ingin mendesain validation architecture yang kuat untuk sistem besar.  
> Fokus: bagaimana menempatkan validation di layer yang tepat agar sistem benar, explainable, maintainable, observable, dan aman untuk evolusi jangka panjang.

---

## 1. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membahas banyak mekanisme:

- built-in constraints,
- custom constraints,
- class-level validation,
- executable validation,
- validation groups,
- group sequence,
- container element constraints,
- dependency injection di validator,
- REST validation,
- persistence validation,
- event validation,
- workflow/state-machine validation,
- domain rule modeling,
- performance,
- security,
- testing,
- migration `javax` ke `jakarta`.

Bagian ini bukan lagi membahas satu fitur. Bagian ini membahas **arsitektur**.

Pertanyaan besarnya:

> Dalam sistem besar, validation seharusnya diletakkan di mana?

Jawaban naïf:

> “Pakai `@Valid` di controller, kasih annotation di DTO, selesai.”

Jawaban production-grade:

> Validation adalah beberapa jenis kontrol correctness yang hidup di beberapa layer berbeda. Setiap layer punya jenis informasi, waktu eksekusi, failure semantics, dan konsekuensi berbeda. Desain yang baik bukan menaruh semua rule di satu tempat, tetapi menaruh rule di layer yang paling tepat, dengan kontrak error yang konsisten, rule ownership yang jelas, dan fallback constraint di boundary yang tidak bisa dipercaya.

---

## 2. Mental Model Utama: Validation Bukan Satu Layer

Dalam sistem kecil, validation sering tampak seperti satu hal:

```java
public record CreateUserRequest(
        @NotBlank String name,
        @Email String email
) {}
```

Dalam sistem besar, itu hanya satu bagian kecil.

Validation bisa berarti:

1. Apakah payload bisa dibaca?
2. Apakah field wajib ada?
3. Apakah format field benar?
4. Apakah kombinasi field konsisten?
5. Apakah command ini legal untuk actor ini?
6. Apakah case sedang berada di state yang mengizinkan action ini?
7. Apakah referensi eksternal valid?
8. Apakah data masih fresh sejak user melihat layar?
9. Apakah ada konflik concurrent update?
10. Apakah database masih bisa menjamin invariant terakhir?
11. Apakah event yang masuk kompatibel dengan versi consumer?
12. Apakah rule yang dipakai bisa dijelaskan ke user, support, auditor, dan developer lain?

Semua pertanyaan itu sering disebut “validation”, tetapi tidak boleh diperlakukan sama.

---

## 3. Layer Validation yang Direkomendasikan

Untuk sistem besar, gunakan model berlapis berikut.

```text
External Client / External System
        |
        v
[1] Transport Boundary Validation
        |
        v
[2] Request DTO / Input Shape Validation
        |
        v
[3] Normalization / Canonicalization
        |
        v
[4] Command Construction Validation
        |
        v
[5] Application Service / Use Case Validation
        |
        v
[6] Domain Invariant Validation
        |
        v
[7] Workflow / State Transition Guard
        |
        v
[8] Authorization / Entitlement Policy
        |
        v
[9] Cross-Entity / Consistency / Reference Validation
        |
        v
[10] Persistence / Database Constraint
        |
        v
[11] Outbound Event / Integration Contract Validation
```

Tidak semua use case butuh semua layer. Tetapi engineer senior perlu bisa menjawab:

- rule ini butuh informasi apa?
- layer mana yang punya informasi itu?
- failure ini harus menjadi 400, 403, 409, 422, atau 500?
- apakah rule ini harus atomic dengan write?
- apakah rule ini harus tetap dijamin walaupun aplikasi bug?
- apakah rule ini harus bisa diaudit?
- apakah rule ini boleh berubah tanpa deploy?
- apakah rule ini berlaku untuk REST, batch, scheduler, dan event consumer juga?

---

## 4. Layer 1 — Transport Boundary Validation

Transport boundary adalah titik pertama data luar masuk ke sistem.

Contoh:

- HTTP request,
- message broker event,
- file upload,
- batch CSV,
- callback external system,
- scheduled import,
- CLI/admin tool,
- internal service call.

Di layer ini, pertanyaan utamanya:

> Apakah input bisa diterima secara teknis oleh transport?

Contoh failure:

- malformed JSON,
- invalid content type,
- unsupported media type,
- request body terlalu besar,
- file terlalu besar,
- header wajib tidak ada,
- path parameter tidak bisa diparse,
- enum value tidak dikenal,
- date string tidak sesuai format,
- multipart structure rusak,
- authentication token malformed.

Ini biasanya bukan `ConstraintViolationException`, melainkan binding/deserialization/parsing error.

Contoh Spring MVC:

```java
@PostMapping("/applications")
public ResponseEntity<?> create(@Valid @RequestBody CreateApplicationRequest request) {
    // Jika JSON malformed, method ini bahkan tidak dipanggil.
    return ResponseEntity.ok().build();
}
```

Jika JSON rusak, error terjadi sebelum Bean Validation.

### 4.1 Tanggung Jawab Layer Ini

Layer transport harus menangani:

- parsing,
- content negotiation,
- payload size limit,
- authentication envelope,
- raw request sanity,
- request id/correlation id,
- rate limit awal,
- deserialization error mapping.

### 4.2 Yang Tidak Cocok di Layer Ini

Jangan taruh rule seperti:

- apakah user boleh approve case,
- apakah transition allowed,
- apakah email unik,
- apakah dokumen sudah diverifikasi,
- apakah SLA sudah lewat,
- apakah case boleh reopen.

Transport layer belum punya konteks domain cukup.

---

## 5. Layer 2 — DTO / Input Shape Validation

Ini layer paling cocok untuk Jakarta Validation annotation.

Contoh:

```java
public record SubmitApplicationRequest(
        @NotBlank
        @Size(max = 100)
        String applicantName,

        @NotBlank
        @Email
        String email,

        @NotNull
        @Valid
        AddressRequest address,

        @Size(max = 20)
        List<@NotBlank String> supportingDocumentIds
) {}
```

Pertanyaan utama:

> Apakah input memiliki shape yang masuk akal untuk operasi ini?

Cocok untuk:

- requiredness dasar,
- length,
- numeric range,
- format,
- nested DTO validation,
- collection element constraints,
- simple cross-field consistency,
- operation-specific constraints.

Tidak cocok untuk:

- authorization,
- workflow transition,
- database uniqueness final,
- external dependency check,
- complex multi-aggregate policy,
- rule yang perlu snapshot domain besar.

### 5.1 DTO Harus Operation-Specific

Anti-pattern:

```java
public class ApplicationDto {
    @NotNull String id;
    @NotBlank String applicantName;
    @NotBlank String reason;
    @NotNull ApplicationStatus status;
    @NotNull String officerComment;
}
```

Satu DTO dipakai untuk:

- create,
- update,
- submit,
- approve,
- reject,
- return,
- appeal,
- import.

Akibatnya:

- annotation saling bertabrakan,
- group bertambah banyak,
- field required menjadi tidak jelas,
- frontend bingung,
- test sulit,
- error message tidak kontekstual.

Lebih baik:

```java
public record CreateApplicationRequest(...) {}
public record UpdateApplicationDraftRequest(...) {}
public record SubmitApplicationRequest(...) {}
public record ApproveApplicationRequest(...) {}
public record RejectApplicationRequest(...) {}
```

Gunakan validation groups secara selektif, bukan sebagai pengganti modeling operasi.

---

## 6. Layer 3 — Normalization / Canonicalization

Validation sering gagal karena urutan normalization salah.

Contoh:

- trim string,
- normalize whitespace,
- uppercase code,
- normalize postal code,
- normalize Unicode,
- parse date,
- canonicalize phone number,
- remove formatting dash/spaces dari identifier.

Pertanyaan arsitektural:

> Apakah validation dilakukan sebelum atau sesudah normalization?

Jawabannya tergantung rule.

### 6.1 Validasi Sebelum Normalization

Cocok untuk mendeteksi input yang memang tidak boleh berubah diam-diam.

Contoh:

- password tidak boleh di-trim diam-diam,
- legal name mungkin whitespace internal punya makna,
- document number harus exactly as provided,
- signed payload tidak boleh diubah sebelum verifikasi.

### 6.2 Validasi Sesudah Normalization

Cocok untuk input user-facing yang wajar dinormalisasi.

Contoh:

```text
"  abc@example.com  " -> "abc@example.com"
"123 456" -> "123456" untuk postal code tertentu
"uen-123" -> "UEN123" jika domain mengizinkan
```

### 6.3 Jangan Normalisasi Diam-Diam Jika Mengubah Makna

Berbahaya:

```java
String amount = input.amount().replace(",", "");
```

Di beberapa locale, koma bisa berarti decimal separator.

Untuk sistem regulasi/keuangan, canonicalization harus explicit, tested, dan explainable.

---

## 7. Layer 4 — Command Construction Validation

DTO adalah representasi transport. Command adalah representasi use case.

Contoh:

```java
public record SubmitApplicationCommand(
        ApplicationId applicationId,
        OfficerId actorId,
        SubmissionChannel channel,
        Instant requestedAt,
        List<DocumentId> documentIds
) {}
```

Command biasanya lebih domain-aware:

- id sudah jadi value object,
- actor sudah resolved,
- channel jelas,
- timestamp jelas,
- absent/null sudah dimodelkan,
- string mentah sudah dikurangi.

### 7.1 Kenapa Command Layer Penting

DTO validation menjawab:

> Apakah payload request valid?

Command validation menjawab:

> Apakah use case invocation valid?

Misalnya request body tidak mengandung `actorId`, karena actor berasal dari authentication context.

```java
SubmitApplicationCommand command = new SubmitApplicationCommand(
        ApplicationId.of(pathApplicationId),
        OfficerId.of(authenticatedUser.id()),
        SubmissionChannel.PORTAL,
        clock.instant(),
        request.documentIds().stream().map(DocumentId::of).toList()
);
```

Di sini validation tidak hanya body. Ada gabungan:

- path parameter,
- body,
- authenticated principal,
- server time,
- tenant/agency,
- channel.

### 7.2 Command Constructor Invariant

Value object constructor bisa menjaga invariant kuat.

```java
public record ApplicationId(String value) {
    public ApplicationId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("ApplicationId must not be blank");
        }
    }
}
```

Gunakan dengan hati-hati:

- cocok untuk invariant yang selalu benar,
- tidak cocok untuk rule operation-specific,
- jangan melempar error yang sulit dimapping di API,
- jangan melakukan DB call di constructor.

---

## 8. Layer 5 — Application Service / Use Case Validation

Application service adalah layer yang mengorkestrasi use case.

Pertanyaan utama:

> Dengan konteks request, actor, data yang di-load, dan operasi yang diminta, apakah use case ini boleh dilanjutkan?

Contoh:

```java
public SubmitApplicationResult submit(SubmitApplicationCommand command) {
    Application application = applicationRepository.get(command.applicationId());
    Officer actor = officerRepository.get(command.actorId());

    PolicyDecision decision = submitPolicy.evaluate(application, actor, command);
    if (decision.isBlocked()) {
        return SubmitApplicationResult.rejected(decision.violations());
    }

    application.submit(command.requestedAt(), actor.id());
    applicationRepository.save(application);
    outbox.add(ApplicationSubmittedEvent.from(application));

    return SubmitApplicationResult.accepted(application.id());
}
```

Application service cocok untuk:

- load aggregate,
- compose policy,
- check workflow guard,
- check role/permission,
- check related data,
- call domain method,
- handle transaction,
- map result.

### 8.1 Jangan Semua Rule Dipaksa Masuk Annotation

Rule seperti ini buruk jika dipaksa ke annotation:

```java
@CanSubmitApplication
public record SubmitApplicationRequest(...) {}
```

Kenapa?

Karena rule `CanSubmitApplication` mungkin butuh:

- current case state,
- actor role,
- maker-checker history,
- outstanding document count,
- current SLA window,
- agency configuration,
- previous decision,
- lock/version,
- external reference.

Itu bukan DTO shape. Itu use case policy.

---

## 9. Layer 6 — Domain Invariant Validation

Domain invariant adalah kebenaran yang harus selalu berlaku pada domain object.

Contoh:

- approved case harus punya approver,
- rejected case harus punya rejection reason,
- final decision date tidak boleh sebelum submission date,
- application tidak bisa submitted jika tidak punya applicant,
- document verification result harus punya verifier,
- monetary amount tidak boleh negatif.

Domain invariant sebaiknya diproteksi oleh domain model, bukan hanya external validator.

Contoh:

```java
public final class Application {
    private ApplicationStatus status;
    private Applicant applicant;
    private List<Document> documents;
    private Instant submittedAt;

    public void submit(Instant now, OfficerId submittedBy) {
        if (status != ApplicationStatus.DRAFT) {
            throw new DomainRuleViolation("APP_SUBMIT_INVALID_STATUS");
        }
        if (applicant == null) {
            throw new DomainRuleViolation("APP_SUBMIT_MISSING_APPLICANT");
        }
        if (documents.isEmpty()) {
            throw new DomainRuleViolation("APP_SUBMIT_MISSING_DOCUMENT");
        }

        this.status = ApplicationStatus.SUBMITTED;
        this.submittedAt = now;
    }
}
```

### 9.1 Domain Object Tidak Boleh Percaya Controller

Jangan desain seperti ini:

```java
// Controller sudah validate, jadi domain method langsung mutate.
application.setStatus(SUBMITTED);
```

Karena domain object bisa dipanggil dari:

- REST,
- batch,
- event consumer,
- scheduler,
- admin script,
- test fixture,
- future use case.

Domain invariant harus tetap dijaga di domain boundary.

---

## 10. Layer 7 — Workflow / State Transition Guard

Workflow guard menjawab:

> Dari state saat ini, action ini boleh terjadi atau tidak?

Contoh state transition:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
REJECTED -> APPEALED
APPROVED -> REVOKED
```

Rule transition biasanya tergantung:

- current state,
- action,
- actor role,
- timestamp,
- case flags,
- pending tasks,
- maker-checker separation,
- SLA,
- appeal window,
- enforcement status.

### 10.1 State Machine Transition Table

```text
Current State    Action       Target State     Guard
------------     --------     ------------     ---------------------------
DRAFT            submit       SUBMITTED        applicant complete, docs ok
SUBMITTED        assign       UNDER_REVIEW     officer available
UNDER_REVIEW     approve      APPROVED         checker != maker
UNDER_REVIEW     reject       REJECTED         reason provided
REJECTED         appeal       APPEALED         within appeal window
APPROVED         revoke       REVOKED          legal authority exists
```

### 10.2 Jangan Sembunyikan Workflow di Validation Groups

Anti-pattern:

```java
interface Draft {}
interface Submitted {}
interface UnderReview {}
interface Approved {}
interface Rejected {}
interface Appealed {}
```

Lalu rule workflow dimodelkan lewat group. Ini membuat state machine tersembunyi dan sulit diaudit.

Validation group cocok untuk input shape berdasarkan operasi, bukan menggantikan workflow engine.

---

## 11. Layer 8 — Authorization / Entitlement Policy

Authorization sering dicampur dengan validation. Ini berbahaya.

Validation menjawab:

> Apakah data/action valid?

Authorization menjawab:

> Apakah actor ini boleh melakukan action terhadap resource ini?

Contoh:

```text
Invalid:
- reason kosong saat reject
- amount negatif
- date range terbalik

Forbidden:
- officer dari agency lain mencoba approve case
- maker mencoba menjadi checker
- user tidak punya role enforcement officer
```

### 11.1 Error Semantics Berbeda

Jika input salah: biasanya 400 atau 422.

Jika tidak punya hak: 403.

Jika belum login/token invalid: 401.

Jika resource tidak boleh diungkap keberadaannya: mungkin 404 untuk menghindari enumeration.

Jangan membuat semua failure menjadi “validation failed”.

### 11.2 Policy Object Bisa Menggabungkan, Tetapi Result Harus Jelas

```java
public enum RuleCategory {
    INPUT,
    DOMAIN,
    WORKFLOW,
    AUTHORIZATION,
    CONSISTENCY,
    DEPENDENCY
}
```

Dengan kategori, API mapper bisa menentukan status dan response shape secara konsisten.

---

## 12. Layer 9 — Cross-Entity / Consistency / Reference Validation

Banyak rule butuh lebih dari satu aggregate/entity.

Contoh:

- applicant tidak boleh punya application aktif duplikat,
- document id harus milik application yang sama,
- officer harus berasal dari agency yang menangani case,
- selected qualification harus valid untuk license type,
- appeal hanya boleh jika ada rejected decision sebelumnya,
- payment reference harus match amount dan status,
- enforcement action tidak boleh overlap dengan active sanction.

Ini bukan DTO validation.

### 12.1 Snapshot Pattern

Untuk rule kompleks, buat snapshot eksplisit.

```java
public record SubmitEligibilitySnapshot(
        Application application,
        ApplicantProfile applicantProfile,
        List<DocumentSummary> documents,
        List<OutstandingTask> outstandingTasks,
        AgencyPolicy agencyPolicy,
        Instant now
) {}
```

Lalu policy mengevaluasi snapshot.

```java
PolicyDecision decision = submitEligibilityPolicy.evaluate(snapshot);
```

Keuntungan:

- dependency jelas,
- test mudah,
- rule bisa diaudit,
- tidak ada hidden DB call di validator,
- performance lebih bisa dikontrol.

### 12.2 Atomicity dan Race Condition

Reference validation bisa stale.

Contoh:

1. aplikasi mengecek email belum dipakai,
2. request lain insert email yang sama,
3. request pertama insert,
4. database unique constraint gagal.

Karena itu:

- application validation bagus untuk UX,
- database constraint tetap final guard,
- conflict harus dimapping ke error stabil.

---

## 13. Layer 10 — Persistence / Database Constraint

Database adalah last line of defense untuk invariant data yang harus benar secara final.

Cocok untuk:

- `NOT NULL`,
- `UNIQUE`,
- foreign key,
- check constraint,
- exclusion/partial unique constraint jika database mendukung,
- referential integrity,
- optimistic locking version,
- data type/precision.

Tidak cocok untuk semua hal:

- complex user-facing message,
- role-specific rule,
- workflow explanation,
- external dependency,
- rich remediation,
- warning/non-blocking rule.

### 13.1 DB Constraint Bukan Pengganti Application Validation

Jika hanya mengandalkan DB:

- error message buruk,
- user tidak tahu field mana salah,
- batch sulit memberi report semua row,
- frontend contract lemah,
- rule tidak visible di API docs,
- error translation sulit.

### 13.2 Application Validation Bukan Pengganti DB Constraint

Jika hanya mengandalkan aplikasi:

- race condition,
- bug bisa insert invalid data,
- batch/native SQL bisa bypass,
- service lain bisa menulis invalid data,
- operational script bisa merusak invariant.

Production-grade design biasanya memakai keduanya.

---

## 14. Layer 11 — Outbound Event / Integration Contract Validation

Sistem besar tidak selesai saat database write berhasil. Sistem juga mengirim:

- event,
- webhook,
- file export,
- API call ke sistem lain,
- report,
- notification,
- audit record.

Outbound contract juga perlu validation.

Pertanyaan:

> Apakah data yang kita kirim valid menurut kontrak consumer?

Contoh:

```java
public record ApplicationSubmittedEvent(
        @NotBlank String eventId,
        @NotBlank String applicationId,
        @NotBlank String applicantId,
        @NotNull Instant submittedAt,
        @NotBlank String schemaVersion
) {}
```

Outbound validation membantu mendeteksi bug internal sebelum bug menyebar ke sistem lain.

### 14.1 Jangan Kirim Event dari State yang Belum Konsisten

Pattern yang baik:

```text
Validate command
Load aggregate
Evaluate policy
Mutate domain
Persist transactionally
Write outbox event
Publisher sends after commit
```

Jika event dibuat sebelum domain valid, consumer bisa menerima state yang tidak pernah benar-benar committed.

---

## 15. DTO Validation Pattern

DTO validation pattern cocok untuk inbound request shape.

```java
public record CreateApplicantRequest(
        @NotBlank
        @Size(max = 100)
        String fullName,

        @NotBlank
        @Email
        String email,

        @Valid
        @NotNull
        AddressRequest address
) {}
```

Controller:

```java
@PostMapping("/applicants")
public ResponseEntity<?> create(@Valid @RequestBody CreateApplicantRequest request) {
    CreateApplicantCommand command = mapper.toCommand(request, authenticatedActor());
    CreateApplicantResult result = service.create(command);
    return responseMapper.toResponse(result);
}
```

Kelebihan:

- sederhana,
- deklaratif,
- integrasi framework kuat,
- error path otomatis,
- cocok untuk API boundary.

Kelemahan:

- tidak punya konteks domain lengkap,
- bisa disalahgunakan untuk workflow,
- annotation bisa menjadi terlalu banyak,
- group bisa membengkak.

Gunakan untuk shape, bukan seluruh use case.

---

## 16. Command Validation Pattern

Command validation lebih dekat dengan use case.

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        String approvalComment,
        Instant requestedAt,
        long expectedVersion
) {}
```

Command validator:

```java
public final class ApproveCaseCommandValidator {
    public List<RuleViolation> validate(ApproveCaseCommand command) {
        List<RuleViolation> violations = new ArrayList<>();

        if (command.caseId() == null) {
            violations.add(RuleViolation.error("APPROVE_CASE_ID_REQUIRED", "caseId"));
        }
        if (command.approvalComment() != null && command.approvalComment().length() > 1000) {
            violations.add(RuleViolation.error("APPROVE_COMMENT_TOO_LONG", "approvalComment"));
        }
        if (command.expectedVersion() <= 0) {
            violations.add(RuleViolation.error("EXPECTED_VERSION_REQUIRED", "expectedVersion"));
        }

        return violations;
    }
}
```

Command validation cocok ketika:

- data berasal dari lebih dari body,
- path/body/principal perlu digabung,
- error harus domain-specific,
- validation tidak nyaman dengan annotation,
- rule perlu result model kaya.

---

## 17. Domain Constructor / Factory Validation Pattern

Value object dapat menjaga invariant.

```java
public record CaseReferenceNumber(String value) {
    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{8}");

    public CaseReferenceNumber {
        if (value == null || !PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid case reference number");
        }
    }
}
```

Untuk API yang butuh error lebih kaya, gunakan factory result.

```java
public final class CaseReferenceNumberFactory {
    public Either<RuleViolation, CaseReferenceNumber> create(String raw) {
        if (raw == null || raw.isBlank()) {
            return Either.left(RuleViolation.error("CASE_REF_REQUIRED", "caseReferenceNumber"));
        }
        if (!raw.matches("CASE-[0-9]{8}")) {
            return Either.left(RuleViolation.error("CASE_REF_INVALID_FORMAT", "caseReferenceNumber"));
        }
        return Either.right(new CaseReferenceNumber(raw));
    }
}
```

Pattern ini cocok untuk:

- domain primitive yang sering dipakai,
- invariant universal,
- menghindari primitive obsession,
- menjaga domain tidak pernah invalid.

Jangan pakai constructor untuk:

- DB lookup,
- permission check,
- operation-specific rule,
- rule yang butuh locale/user/channel.

---

## 18. Policy Object Pattern

Policy object mengevaluasi rule berdasarkan konteks kaya.

```java
public interface Policy<C> {
    PolicyDecision evaluate(C context);
}
```

```java
public record PolicyDecision(
        boolean allowed,
        List<RuleViolation> violations
) {
    public static PolicyDecision allowed() {
        return new PolicyDecision(true, List.of());
    }

    public static PolicyDecision rejected(List<RuleViolation> violations) {
        return new PolicyDecision(false, List.copyOf(violations));
    }
}
```

Contoh policy:

```java
public final class ApproveCasePolicy implements Policy<ApproveCaseContext> {
    @Override
    public PolicyDecision evaluate(ApproveCaseContext context) {
        List<RuleViolation> violations = new ArrayList<>();

        if (context.caseFile().status() != CaseStatus.UNDER_REVIEW) {
            violations.add(RuleViolation.conflict(
                    "CASE_APPROVE_INVALID_STATUS",
                    "case.status",
                    Map.of("currentStatus", context.caseFile().status())
            ));
        }

        if (context.caseFile().makerId().equals(context.actor().id())) {
            violations.add(RuleViolation.forbidden(
                    "MAKER_CANNOT_APPROVE_OWN_CASE",
                    "actor.id"
            ));
        }

        if (!context.actor().hasRole("CASE_APPROVER")) {
            violations.add(RuleViolation.forbidden(
                    "ACTOR_NOT_CASE_APPROVER",
                    "actor.roles"
            ));
        }

        return violations.isEmpty()
                ? PolicyDecision.allowed()
                : PolicyDecision.rejected(violations);
    }
}
```

Kelebihan:

- eksplisit,
- testable,
- rich error,
- bisa mengandung evidence,
- cocok untuk audit,
- tidak menyalahgunakan annotation.

---

## 19. Specification Pattern

Specification pattern cocok untuk rule composable.

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);
}
```

Versi production sebaiknya tidak hanya boolean.

```java
public interface Rule<T> {
    Optional<RuleViolation> evaluate(T candidate);
}
```

Atau:

```java
public interface RichRule<T> {
    RuleEvaluation evaluate(T candidate);
}
```

Dengan result:

```java
public record RuleEvaluation(
        String ruleId,
        String ruleVersion,
        RuleSeverity severity,
        RuleOutcome outcome,
        String target,
        Map<String, Object> evidence
) {}
```

### 19.1 Jangan Over-Engineer untuk Rule Sederhana

Untuk field sederhana, annotation sudah cukup.

Jangan membuat rule engine untuk:

```java
@NotBlank String name;
```

Gunakan specification/policy saat rule:

- contextual,
- multi-entity,
- workflow-specific,
- auditable,
- versioned,
- reused lintas transport,
- punya severity/warning,
- punya remediation.

---

## 20. Shared Validation Library: Kapan Berguna, Kapan Berbahaya

Sistem besar sering tergoda membuat shared library:

```text
common-validation.jar
```

Isi:

- custom annotation,
- error model,
- common regex,
- id validators,
- message codes,
- response mapper,
- rule engine.

### 20.1 Shared Library yang Sehat

Bagikan hal stabil:

- error response model,
- common `RuleViolation`,
- common severity enum,
- generic validation utilities,
- stable value object format,
- common custom constraints yang benar-benar cross-domain,
- testing helpers.

### 20.2 Shared Library yang Berbahaya

Jangan bagikan rule domain yang berubah-ubah lintas service secara sembarangan.

Contoh buruk:

```text
@ValidApplicationForAllAgencies
```

Kenapa buruk?

- agency rule bisa berbeda,
- service ownership kabur,
- deployment coupling tinggi,
- perubahan rule bisa break banyak service,
- versi rule sulit diaudit.

### 20.3 Rule Ownership

Setiap rule harus punya owner.

Minimal metadata:

```text
ruleId: CASE_SUBMIT_DOCUMENT_REQUIRED
ownerModule: case-management
ownerTeam: case-platform
ruleVersion: 2026.06.01
category: WORKFLOW
severity: ERROR
enforcement: BLOCKING
source: Case submission policy
```

---

## 21. Multi-Service Validation Consistency

Dalam microservices/distributed systems, validation bisa drift.

Contoh:

- frontend menganggap field optional,
- backend menganggap required,
- service A menganggap enum `PENDING_REVIEW` valid,
- service B belum mengenal enum itu,
- API docs bilang max length 100,
- DB column hanya 50,
- event schema optional,
- consumer menganggap required.

### 21.1 Sumber Kebenaran Tidak Selalu Satu

Untuk constraint berbeda, source of truth berbeda:

| Constraint | Source of Truth Utama | Fallback |
|---|---|---|
| API payload shape | API contract/OpenAPI + DTO | runtime validation |
| domain invariant | domain model | DB where possible |
| uniqueness | database | application pre-check for UX |
| workflow transition | state machine/policy | domain guard |
| authorization | IAM/policy layer | resource check |
| event compatibility | schema registry/contract | consumer validation |
| display hint | FE schema/API metadata | backend validation |

Tujuan bukan memaksa semua rule ke satu file. Tujuan adalah memastikan setiap rule punya owner dan sinkronisasi.

### 21.2 Contract Test

Gunakan contract test untuk memastikan:

- DTO annotation selaras dengan OpenAPI,
- API error shape stabil,
- generated client tidak salah,
- event schema kompatibel,
- DB column length tidak lebih kecil dari API max length,
- enum changes tidak break consumer.

---

## 22. Frontend/Backend Validation Drift

Frontend validation berguna untuk UX. Backend validation tetap authoritative.

Frontend boleh:

- memberi immediate feedback,
- disable button,
- show warning,
- format input,
- prevent obvious invalid submission.

Backend harus:

- validate semua input,
- tidak percaya FE,
- mengembalikan stable error code,
- memberi path yang bisa dimapping FE,
- menjaga security dan consistency.

### 22.1 Jangan Mengirim Hanya Human Message

Buruk:

```json
{
  "message": "Applicant name is required"
}
```

Lebih baik:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "violations": [
    {
      "path": "applicant.name",
      "code": "APPLICANT_NAME_REQUIRED",
      "message": "Applicant name is required.",
      "severity": "ERROR"
    }
  ]
}
```

FE bergantung ke `code` dan `path`, bukan parsing message.

---

## 23. Validation Error Taxonomy

Sistem besar butuh taxonomy.

```java
public enum ValidationFailureType {
    MALFORMED_REQUEST,
    BINDING_ERROR,
    SHAPE_VALIDATION,
    SEMANTIC_VALIDATION,
    DOMAIN_INVARIANT,
    WORKFLOW_GUARD,
    AUTHORIZATION,
    CONFLICT,
    DEPENDENCY_UNAVAILABLE,
    SYSTEM_ERROR
}
```

Mapping status:

| Failure Type | Typical HTTP Status | Retry? | Owner |
|---|---:|---|---|
| Malformed request | 400 | no | client |
| DTO shape validation | 422/400 | after fix | client |
| Semantic validation | 422 | after fix | client/domain |
| Workflow guard | 409/422 | depends | domain/workflow |
| Authorization | 403 | no unless role changes | IAM/policy |
| Optimistic conflict | 409 | yes after refresh | client/user |
| DB unique conflict | 409 | after change | client/domain |
| Dependency unavailable | 503 | yes | platform/external |
| System error | 500 | yes maybe | server |

Jangan memaksa semua menjadi 400.

---

## 24. Validation Result Model untuk Sistem Besar

Gunakan model internal yang lebih kaya dari `ConstraintViolation`.

```java
public record RuleViolation(
        String code,
        String messageKey,
        String path,
        RuleSeverity severity,
        RuleCategory category,
        String ruleId,
        String ruleVersion,
        Map<String, Object> safeEvidence
) {}
```

Severity:

```java
public enum RuleSeverity {
    INFO,
    WARNING,
    ERROR,
    FATAL
}
```

Category:

```java
public enum RuleCategory {
    TRANSPORT,
    INPUT_SHAPE,
    SEMANTIC,
    DOMAIN,
    WORKFLOW,
    AUTHORIZATION,
    CONSISTENCY,
    PERSISTENCE,
    INTEGRATION
}
```

Dengan model ini, violation bisa berasal dari:

- Jakarta Validation,
- command validator,
- domain policy,
- workflow guard,
- DB constraint translator,
- event schema validation,
- external dependency response.

Namun response ke client tetap konsisten.

---

## 25. Mapping `ConstraintViolation` ke RuleViolation

```java
public final class ConstraintViolationMapper {
    public RuleViolation map(ConstraintViolation<?> violation) {
        ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();

        String code = resolveCode(descriptor);
        String ruleId = resolveRuleId(descriptor);

        return new RuleViolation(
                code,
                violation.getMessageTemplate(),
                normalizePath(violation.getPropertyPath()),
                RuleSeverity.ERROR,
                RuleCategory.INPUT_SHAPE,
                ruleId,
                "1",
                safeAttributes(descriptor)
        );
    }

    private String normalizePath(Path path) {
        return path.toString();
    }

    private Map<String, Object> safeAttributes(ConstraintDescriptor<?> descriptor) {
        Map<String, Object> result = new LinkedHashMap<>();
        descriptor.getAttributes().forEach((key, value) -> {
            if (List.of("min", "max", "regexp").contains(key)) {
                result.put(key, value);
            }
        });
        return result;
    }
}
```

Jangan expose semua attributes tanpa review. Beberapa attribute bisa mengandung internal data atau regex kompleks.

---

## 26. Module Ownership Pattern

Dalam monolith modular atau microservices, setiap module harus punya validation ownership.

Contoh:

```text
case-management/
  api/
    dto/
    mapper/
    error/
  application/
    command/
    service/
    validator/
  domain/
    model/
    policy/
    rule/
  persistence/
    entity/
    constraint-translator/
  integration/
    event/
    client/
```

Rule placement:

```text
api/dto                 -> shape validation
application/validator   -> command/use case validation
domain/model            -> invariant
domain/policy           -> contextual rule/workflow guard
persistence             -> DB constraint translation
integration/event       -> event contract validation
```

### 26.1 Jangan Taruh Semua Validator di `common`

Buruk:

```text
common/validators/ApplicationValidator.java
common/validators/CaseValidator.java
common/validators/WorkflowValidator.java
```

Ini membuat ownership kabur.

Lebih baik validator tinggal dekat rule owner.

---

## 27. Anti-Corruption Validation untuk External Systems

Saat menerima data dari external system, jangan langsung masukkan ke domain.

```text
External DTO -> Raw Integration DTO -> Anti-Corruption Mapper -> Internal Command/Value Object -> Domain
```

External data bisa:

- missing,
- salah format,
- versi lama,
- ambigu,
- punya enum berbeda,
- mengandung unexpected value,
- memakai timezone/locale berbeda,
- tidak konsisten dengan dokumentasi.

### 27.1 External DTO Constraint Tidak Sama dengan Internal DTO Constraint

External DTO harus tolerant.

Internal command harus strict.

Contoh:

```java
public record ExternalPersonPayload(
        String name,
        String email,
        String birthDate,
        String externalStatus
) {}
```

Anti-corruption mapper:

```java
public Either<List<RuleViolation>, InternalPersonCommand> map(ExternalPersonPayload payload) {
    List<RuleViolation> violations = new ArrayList<>();

    String normalizedEmail = normalizeEmail(payload.email(), violations);
    LocalDate birthDate = parseBirthDate(payload.birthDate(), violations);
    PersonStatus status = mapStatus(payload.externalStatus(), violations);

    if (!violations.isEmpty()) {
        return Either.left(violations);
    }

    return Either.right(new InternalPersonCommand(payload.name(), normalizedEmail, birthDate, status));
}
```

Jangan menganggap external system selalu benar.

---

## 28. Batch and Import Validation Architecture

Batch/import berbeda dari REST.

REST biasanya:

- satu request,
- fail cepat,
- user immediate feedback.

Batch/import biasanya:

- ribuan row,
- perlu collect semua error,
- partial success mungkin,
- error report perlu downloadable,
- rule mungkin staged,
- performance penting.

### 28.1 Pipeline Batch

```text
Read file
Parse row
Validate raw shape
Normalize
Map to command
Validate command
Evaluate domain policy
Persist valid records
Generate rejection report
Emit audit event
```

### 28.2 Jangan Pakai Exception untuk Setiap Invalid Row

Untuk batch, gunakan result object.

```java
public record RowValidationResult(
        int rowNumber,
        boolean valid,
        List<RuleViolation> violations
) {}
```

Exception per row mahal dan sulit dikontrol.

---

## 29. API Versioning dan Validation Evolution

Validation changes bisa breaking.

Contoh breaking:

- field optional menjadi required,
- max length diperkecil,
- enum value dihapus,
- format diperketat,
- previously accepted null ditolak,
- warning menjadi blocking,
- default berubah.

### 29.1 Safe Evolution Strategy

Gunakan tahap:

```text
Observe -> Warn -> Enforce -> Tighten
```

Contoh:

1. Tambahkan metric untuk payload yang akan gagal rule baru.
2. Kirim warning non-blocking.
3. Komunikasikan ke client.
4. Enforce di versi API baru atau tanggal tertentu.
5. Hapus toleransi lama setelah migration window.

### 29.2 Versioned DTO

```java
public record CreateApplicationV1Request(...) {}
public record CreateApplicationV2Request(...) {}
```

Atau maintain compatibility di mapper, bukan dengan annotation group yang tidak terbaca.

---

## 30. Validation Drift dengan Database Schema

Contoh drift:

```java
@Size(max = 100)
String name;
```

Tetapi database:

```sql
name varchar(50) not null
```

Aplikasi menerima 80 karakter, DB menolak.

### 30.1 Guardrail

Buat test yang membandingkan:

- DTO max length,
- entity column length,
- DB schema,
- OpenAPI schema.

Tidak semua bisa otomatis sempurna, tetapi constraint penting harus ditest.

---

## 31. Validation Drift dengan OpenAPI

Jika OpenAPI generated dari code, pastikan annotation terbaca.

Jika OpenAPI manual, pastikan ada contract test.

Contoh mismatch:

```yaml
name:
  type: string
  maxLength: 255
```

Tetapi DTO:

```java
@Size(max = 100)
String name;
```

Client generated dari OpenAPI akan mengirim data yang backend tolak.

---

## 32. Validation Drift dengan Frontend

Frontend sering punya rule manual:

```typescript
if (name.length > 50) showError();
```

Backend punya:

```java
@Size(max = 100)
String name;
```

Akibat:

- frontend menolak input valid,
- backend menerima input yang UI tidak pernah kirim,
- user behavior tidak konsisten lintas channel.

Solusi:

- share metadata bila feasible,
- use generated clients/schema,
- stable error code,
- central message catalog,
- backend tetap authoritative.

---

## 33. Validation in Modular Monolith

Modular monolith cocok untuk explicit validation ownership.

```text
application-module
case-module
appeal-module
compliance-module
correspondence-module
payment-module
profile-module
```

Setiap module punya:

- API DTO,
- command,
- domain policy,
- DB constraint translator,
- event contract.

Cross-module validation harus hati-hati.

### 33.1 Jangan Langsung Query Semua Module

Jika case module perlu profile status, pertimbangkan:

- profile snapshot,
- domain event materialized view,
- query service interface,
- anti-corruption contract.

Validator yang melakukan query lintas module tanpa kontrol bisa menciptakan coupling tersembunyi.

---

## 34. Validation in Microservices

Microservices menambah masalah:

- remote dependency,
- eventual consistency,
- schema evolution,
- duplicate validation,
- stale data,
- retry,
- partial failure.

Prinsip:

1. Validate what you own.
2. Do not rely solely on upstream validation.
3. Keep local invariants local.
4. Use contracts for external boundaries.
5. Treat remote validation as advisory unless transactionally guaranteed.
6. Translate remote failure into local error taxonomy.

### 34.1 Jangan Membuat Synchronous Validation Chain Terlalu Panjang

Buruk:

```text
Service A validate -> Service B validate -> Service C validate -> Service D validate
```

Akibat:

- latency tinggi,
- availability turun,
- cascading failure,
- timeout,
- sulit retry,
- user error bercampur dependency failure.

Alternatif:

- local snapshot,
- async reconciliation,
- reservation pattern,
- saga/compensation,
- final DB constraint,
- eventual validation event.

---

## 35. Validation and Concurrency

Validation sering benar saat dicek, lalu salah saat write.

Contoh:

```text
T1: check case status UNDER_REVIEW
T2: approve case -> status APPROVED
T1: reject case based on stale status
```

Solusi:

- optimistic locking,
- expected version,
- compare-and-set update,
- DB constraint,
- transaction isolation yang tepat,
- re-check before commit,
- domain method check inside transaction.

### 35.1 Expected Version di Command

```java
public record RejectCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        String reason,
        long expectedVersion
) {}
```

Jika version mismatch:

```text
409 Conflict
code: CASE_VERSION_CONFLICT
message: Case has been modified. Please refresh and try again.
```

Ini bukan DTO validation error. Ini concurrency conflict.

---

## 36. Observability Architecture

Validation harus observable.

Metrics:

- validation failures by endpoint,
- validation failures by rule code,
- validation failures by client app version,
- top rejected fields,
- warning vs blocking count,
- validation latency,
- expensive validator count,
- DB constraint violation count,
- event rejection count,
- DLQ invalid payload count.

Logging harus aman:

- no PII,
- no raw payload default,
- correlation id,
- rule code,
- category,
- path,
- actor/channel classification jika aman,
- rule version.

### 36.1 Sample Log

```json
{
  "event": "validation_failed",
  "correlationId": "c-123",
  "endpoint": "POST /cases/{id}/approve",
  "ruleCode": "MAKER_CANNOT_APPROVE_OWN_CASE",
  "ruleCategory": "AUTHORIZATION",
  "severity": "ERROR",
  "caseIdHash": "sha256:...",
  "actorIdHash": "sha256:..."
}
```

Jangan log full rejected value sembarangan.

---

## 37. Rule Governance Architecture

Untuk sistem besar, rule harus punya lifecycle.

Minimal:

```text
Rule proposed
Rule documented
Rule implemented
Rule tested
Rule observed in shadow/warning mode
Rule enforced
Rule monitored
Rule versioned
Rule retired
```

### 37.1 Rule Catalog

Contoh catalog:

```yaml
- ruleId: CASE_APPROVE_INVALID_STATUS
  version: 2026.06.01
  category: WORKFLOW
  severity: ERROR
  enforcement: BLOCKING
  owner: case-management
  description: Case can only be approved from UNDER_REVIEW state.
  userMessageKey: case.approve.invalidStatus
  auditRequired: true

- ruleId: MAKER_CANNOT_APPROVE_OWN_CASE
  version: 2026.06.01
  category: AUTHORIZATION
  severity: ERROR
  enforcement: BLOCKING
  owner: case-management
  description: Maker-checker separation is required for approval.
  userMessageKey: case.approve.makerCheckerViolation
  auditRequired: true
```

Rule catalog bisa berupa file, DB, documentation, atau generated artifact. Yang penting rule tidak menjadi pengetahuan tersembunyi dalam kode annotation.

---

## 38. End-to-End Example: Approve Case

### 38.1 Request DTO

```java
public record ApproveCaseRequest(
        @NotBlank
        @Size(max = 1000)
        String comment,

        @Positive
        long expectedVersion
) {}
```

### 38.2 Controller

```java
@PostMapping("/cases/{caseId}/approve")
public ResponseEntity<?> approve(
        @PathVariable String caseId,
        @Valid @RequestBody ApproveCaseRequest request,
        Authentication authentication
) {
    ApproveCaseCommand command = new ApproveCaseCommand(
            CaseId.of(caseId),
            ActorId.of(authentication.getName()),
            request.comment(),
            request.expectedVersion(),
            clock.instant()
    );

    ApproveCaseResult result = approveCaseService.approve(command);
    return approveCaseResponseMapper.toResponse(result);
}
```

### 38.3 Service

```java
@Transactional
public ApproveCaseResult approve(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.getForUpdate(command.caseId());
    Actor actor = actorRepository.get(command.actorId());

    if (caseFile.version() != command.expectedVersion()) {
        return ApproveCaseResult.rejected(List.of(
                RuleViolation.conflict("CASE_VERSION_CONFLICT", "expectedVersion")
        ));
    }

    ApproveCaseContext context = new ApproveCaseContext(caseFile, actor, command.requestedAt());
    PolicyDecision decision = approveCasePolicy.evaluate(context);

    if (!decision.allowed()) {
        return ApproveCaseResult.rejected(decision.violations());
    }

    caseFile.approve(actor.id(), command.comment(), command.requestedAt());
    caseRepository.save(caseFile);
    outbox.add(CaseApprovedEvent.from(caseFile));

    return ApproveCaseResult.approved(caseFile.id());
}
```

### 38.4 Domain Method

```java
public void approve(ActorId approverId, String comment, Instant approvedAt) {
    if (status != CaseStatus.UNDER_REVIEW) {
        throw new DomainRuleViolation("CASE_APPROVE_INVALID_STATUS");
    }
    if (approverId.equals(makerId)) {
        throw new DomainRuleViolation("MAKER_CANNOT_APPROVE_OWN_CASE");
    }
    this.status = CaseStatus.APPROVED;
    this.approvedBy = approverId;
    this.approvedAt = approvedAt;
    this.approvalComment = comment;
}
```

Kenapa rule dicek di policy dan domain?

- policy memberi rich decision sebelum mutation,
- domain tetap menjaga invariant jika dipanggil dari jalur lain,
- duplicate small rule di boundary penting kadang acceptable untuk safety,
- source-of-truth ownership tetap jelas.

### 38.5 DB Constraint

```sql
alter table case_file add constraint chk_case_status
check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'));

alter table case_file add constraint chk_approved_fields
check (
  status <> 'APPROVED'
  or (approved_by is not null and approved_at is not null)
);
```

DB menjaga invariant final yang bisa diekspresikan secara relational.

---

## 39. Common Anti-Patterns

### 39.1 `@Valid` Everywhere

Menaruh `@Valid` di semua association/entity graph tanpa boundary jelas.

Akibat:

- validation mahal,
- lazy loading tidak terduga,
- recursion/cycle kompleks,
- error path sulit,
- aggregate boundary bocor.

### 39.2 Entity as API DTO

Entity dipakai langsung sebagai request/response.

Akibat:

- persistence constraint bocor ke API,
- lazy relation terekspos,
- security risk,
- validation conflict,
- backward compatibility buruk.

### 39.3 Annotation sebagai Workflow Engine

Semua state/action dimodelkan sebagai validation groups.

Akibat:

- state machine tersembunyi,
- sulit audit,
- group explosion,
- test sulit,
- rule tidak explainable.

### 39.4 Validator Memanggil Banyak Service

Custom `ConstraintValidator` melakukan:

- DB query,
- REST call,
- permission check,
- workflow check,
- cache lookup kompleks.

Akibat:

- latency,
- nondeterminism,
- race condition,
- dependency failure dianggap invalid input,
- sulit test.

### 39.5 Human Message sebagai Contract

Client parsing message string.

Akibat:

- i18n break,
- wording change break,
- FE fragile,
- automation sulit.

### 39.6 No DB Final Guard

Aplikasi validate uniqueness, tetapi DB tidak punya unique constraint.

Akibat:

- duplicate data saat race,
- data corruption,
- audit problem.

### 39.7 All Failures as 400

Authorization, conflict, dependency failure, malformed JSON, dan validation semua jadi 400.

Akibat:

- client tidak tahu aksi benar,
- retry policy salah,
- monitoring kacau,
- support sulit diagnosis.

---

## 40. Design Heuristics: Menaruh Rule di Mana?

Gunakan pertanyaan berikut.

### 40.1 Apakah Rule Hanya Tentang Field Lokal?

Contoh:

- not blank,
- max length,
- numeric min/max,
- email format.

Tempat:

- DTO annotation,
- value object invariant.

### 40.2 Apakah Rule Tentang Kombinasi Field dalam Object yang Sama?

Contoh:

- start date <= end date,
- jika type company maka UEN required,
- at least one contact method.

Tempat:

- class-level constraint,
- command validator,
- value object/factory.

### 40.3 Apakah Rule Butuh Actor/Role?

Tempat:

- authorization/policy layer,
- bukan DTO annotation.

### 40.4 Apakah Rule Butuh Current State?

Tempat:

- workflow guard,
- domain method,
- policy object.

### 40.5 Apakah Rule Butuh Data Lain dari DB?

Tempat:

- application service/policy with explicit load,
- DB constraint if final consistency,
- jangan hidden DB call di constraint validator kecuali sangat sederhana dan accepted.

### 40.6 Apakah Rule Harus Atomic?

Tempat:

- database constraint,
- transaction/domain method,
- optimistic locking.

### 40.7 Apakah Rule Butuh Warning/Observe-Only?

Tempat:

- policy/rule engine/result model,
- bukan built-in Bean Validation biasa.

### 40.8 Apakah Rule Harus Bisa Diaudit?

Tempat:

- policy object dengan rule id/version/evidence,
- audit event,
- rule catalog.

---

## 41. Production Validation Architecture Blueprint

```text
api/
  dto/
    CreateCaseRequest.java
    SubmitCaseRequest.java
    ApproveCaseRequest.java
  validation/
    RestValidationExceptionHandler.java
    ConstraintViolationToApiErrorMapper.java
  error/
    ApiProblem.java
    ApiViolation.java

application/
  command/
    SubmitCaseCommand.java
    ApproveCaseCommand.java
  service/
    SubmitCaseService.java
    ApproveCaseService.java
  validation/
    SubmitCaseCommandValidator.java

case-domain/
  model/
    CaseFile.java
    CaseStatus.java
    CaseReferenceNumber.java
  policy/
    SubmitCasePolicy.java
    ApproveCasePolicy.java
    ReopenCasePolicy.java
  rule/
    RuleViolation.java
    RuleDecision.java
    RuleCatalog.java

persistence/
  entity/
    CaseFileEntity.java
  translator/
    DatabaseConstraintViolationTranslator.java

integration/
  event/
    CaseSubmittedEvent.java
    CaseApprovedEvent.java
    EventValidator.java
  external/
    ExternalProfileMapper.java
    ExternalPayloadValidationReport.java
```

---

## 42. PR Review Checklist

Saat review kode validation, tanyakan:

1. Rule ini jenisnya apa: shape, semantic, domain, workflow, auth, consistency, persistence, integration?
2. Rule ini ada di layer yang tepat?
3. Apakah rule ini butuh context yang tidak tersedia di layer tersebut?
4. Apakah rule ini operation-specific? Kalau iya, DTO/command sudah spesifik?
5. Apakah `@NotNull` dipakai karena memang universal required, atau hanya karena satu operasi?
6. Apakah validation group mulai menjadi workflow tersembunyi?
7. Apakah validator melakukan DB/service call?
8. Apakah race condition tetap ditutup DB constraint/lock?
9. Apakah error code stabil?
10. Apakah message mengandung PII?
11. Apakah failure type dimapping ke HTTP status yang benar?
12. Apakah rule punya test edge case?
13. Apakah API docs/OpenAPI sinkron?
14. Apakah DB schema sinkron?
15. Apakah FE bergantung ke code/path, bukan human message?
16. Apakah rule perlu metrics/audit?
17. Apakah rule punya owner?
18. Apakah perubahan rule ini breaking untuk client lama?
19. Apakah batch/event/scheduler juga terlindungi?
20. Apakah domain invariant tetap dijaga meski controller bypass?

---

## 43. Summary Mental Model

Validation architecture yang kuat bukan berarti semua rule ditulis sebagai annotation.

Yang kuat adalah:

- boundary input divalidasi,
- command dibentuk secara eksplisit,
- domain invariant dijaga domain model,
- workflow guard jelas,
- authorization tidak dicampur dengan shape validation,
- cross-entity rule dievaluasi dengan context eksplisit,
- database menjadi final consistency guard,
- event outbound/inbound punya contract,
- error model machine-readable,
- rule punya owner/version/evidence,
- performance dan security diperhitungkan,
- test mencakup unit, integration, contract, mutation/property-based bila perlu.

Top-tier engineer tidak bertanya:

> “Annotation apa yang harus dipakai?”

Tetapi bertanya:

> “Rule ini jenisnya apa, butuh context apa, harus dijamin di boundary mana, failure semantics-nya apa, bagaimana dia diuji, diaudit, dan dievolusikan tanpa merusak sistem?”

Itulah inti validation layering dalam sistem besar.

---

## 44. Status Seri

Seri **belum selesai**.

Bagian yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model
- Part 003 — Built-in Constraints Deep Dive
- Part 004 — Nullability Strategy
- Part 005 — Cascaded Validation
- Part 006 — Container Element Constraints
- Part 007 — Validation Groups
- Part 008 — Group Sequence and Dynamic Group Sequence
- Part 009 — Custom Constraint Design
- Part 010 — Class-Level and Cross-Field Validation
- Part 011 — Cross-Parameter and Executable Validation
- Part 012 — Records, Immutability, Builders, Lombok, and Modern Java Modeling
- Part 013 — Message Interpolation
- Part 014 — Payload, Severity, Error Codes, and Machine-Readable Violations
- Part 015 — Programmatic Constraint Mapping and Runtime Metadata
- Part 016 — Constraint Composition
- Part 017 — Hibernate Validator Extensions
- Part 018 — Dependency Injection in Validators
- Part 019 — Validation in REST APIs
- Part 020 — Validation in Persistence
- Part 021 — Validation in Event-Driven and Async Systems
- Part 022 — Validation for Workflow, State Machines, and Regulatory Case Management
- Part 023 — Advanced Domain Rule Modeling
- Part 024 — Performance Engineering
- Part 025 — Security and Abuse Resistance
- Part 026 — Testing Validation
- Part 027 — Migration Playbook
- Part 028 — Architecture Patterns: Validation Layering in Large Systems

Bagian berikutnya:

**Part 029 — Observability, Operations, and Governance of Validation Rules**

