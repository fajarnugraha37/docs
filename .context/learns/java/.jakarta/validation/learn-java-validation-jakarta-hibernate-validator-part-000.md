# learn-java-validation-jakarta-hibernate-validator-part-000

# Orientation: Validation as Contract, Boundary Defense, and Domain Integrity

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `000`  
> Target Java: 8 sampai 25  
> Fokus: mental model, arsitektur, boundary, correctness, failure model, dan penempatan validation yang benar sebelum masuk ke API detail Jakarta Validation/Hibernate Validator.

---

## 0. Tujuan Part Ini

Part ini bukan dimulai dari `@NotNull`, `@Size`, atau `@Valid`.

Part ini dimulai dari pertanyaan yang lebih penting:

> Ketika sebuah sistem menerima data, kapan data itu boleh dipercaya?

Di sistem kecil, validation sering dianggap sebagai daftar annotation di DTO.

Di sistem besar, terutama sistem regulatory, enforcement lifecycle, case management, workflow approval, financial, government, healthcare, atau sistem audit-heavy, validation adalah mekanisme untuk menjaga:

1. **Contract correctness** — caller tidak boleh mengirim bentuk data yang melanggar kontrak.
2. **Boundary safety** — data dari luar sistem tidak boleh langsung masuk ke domain internal tanpa pemeriksaan.
3. **Domain integrity** — object tidak boleh berada dalam state yang mustahil.
4. **Workflow defensibility** — transisi state harus dapat dijelaskan dan dipertanggungjawabkan.
5. **Operational resilience** — invalid data tidak boleh merusak queue, database, downstream service, atau audit trail.
6. **Security posture** — input tidak boleh menjadi pintu masuk abuse, denial-of-service, injection, data leak, atau privilege bypass.
7. **Regulatory explainability** — penolakan harus punya alasan yang stabil, dapat diaudit, dan dapat dijelaskan.

Validation bukan kosmetik. Validation adalah bagian dari correctness architecture.

---

## 1. Posisi Jakarta Validation dan Hibernate Validator dalam Ekosistem Java

Sebelum masuk mental model, kita perlu tahu posisi teknologinya.

Jakarta Validation mendefinisikan metadata model dan API untuk JavaBean dan method validation. Default metadata source umumnya annotation, tetapi specification juga mendukung metadata melalui XML mapping. Jakarta Validation 3.1 menargetkan Jakarta EE 11 dan memperjelas dukungan terhadap Java Records. Sumber resmi Jakarta EE menyebut Jakarta Validation sebagai API untuk JavaBean dan method validation serta rilis 3.1 sebagai rilis untuk Jakarta EE 11.

Hibernate Validator adalah reference implementation dari Jakarta Validation. Pada keluarga Hibernate Validator 9.x, targetnya adalah Jakarta Validation 3.1 / Jakarta EE 11, dengan baseline Java modern. Untuk legacy, Bean Validation 2.0 / JSR 380 masih sangat penting karena dipakai luas pada Java 8 dan stack `javax.validation`.

Secara ringkas:

| Era | API Package | Spec/Standard | Umum Dipakai Dengan | Catatan |
|---|---:|---|---|---|
| Java EE / Java 8 era | `javax.validation.*` | Bean Validation 2.0 / JSR 380 | Java 8, Spring Boot 2.x, Java EE 8 | Menambahkan container element constraints, Optional, Java 8 date/time support. |
| Jakarta EE 9/10 era | `jakarta.validation.*` | Jakarta Bean Validation 3.0 | Spring Boot 3.x awal, Jakarta EE 10 | Perubahan besar package namespace dari `javax` ke `jakarta`. |
| Jakarta EE 11 era | `jakarta.validation.*` | Jakarta Validation 3.1 | Java 17+, Hibernate Validator 9.x | Rename spec menjadi Jakarta Validation, Java 17 minimum, record support clarified. |
| Java 21/25 application era | mostly `jakarta.validation.*` | 3.x line | Spring Boot 3.x+, Jakarta EE 11+, modern microservices | Validation harus dipikirkan bersama records, immutable DTO, virtual threads, AOT/native-image, observability. |

Part ini tidak akan membahas detail dependency dulu. Itu masuk part migration dan setup. Di sini fokusnya: bagaimana berpikir benar tentang validation.

---

## 2. Definisi Fundamental: Validation Itu Apa?

Validation adalah proses menentukan apakah sebuah nilai, object, command, request, event, atau state transition memenuhi **constraint** yang berlaku pada konteks tertentu.

Kata kuncinya ada dua:

1. **Constraint** — batasan yang harus dipenuhi.
2. **Konteks** — situasi di mana batasan itu berlaku.

Contoh sederhana:

```java
public record RegisterUserRequest(
        @NotBlank String name,
        @Email String email,
        @NotBlank String password
) {}
```

Ini kelihatan sederhana. Tetapi di sistem nyata, pertanyaannya menjadi lebih kompleks:

- Apakah email wajib untuk semua channel?
- Apakah email wajib untuk user internal dan eksternal?
- Apakah email boleh sama dengan existing account?
- Apakah email harus diverifikasi dulu?
- Apakah password rule sama untuk admin-created user dan self-registration?
- Apakah field `name` boleh mengandung karakter non-Latin?
- Apakah panjang `name` dihitung berdasarkan Java `String.length()`, Unicode code point, atau display width?
- Apakah error message boleh menampilkan nilai email yang ditolak?
- Apakah validation dilakukan sebelum atau setelah enrichment dari external identity provider?

Annotation hanya permukaan. Validation yang benar adalah desain kontrak.

---

## 3. Validation Bukan Satu Hal: Ada Banyak Jenis Rule

Kesalahan besar dalam banyak codebase adalah menyebut semua pengecekan sebagai “validation”. Akibatnya semua rule dipaksa masuk annotation atau service method tanpa struktur.

Seorang engineer advanced harus bisa membedakan beberapa kategori berikut.

---

## 3.1 Syntactic Validation

Syntactic validation menjawab:

> Apakah bentuk data valid secara format?

Contoh:

- `email` harus berbentuk email-like string.
- `postalCode` harus 6 digit.
- `caseReferenceNo` harus mengikuti pattern tertentu.
- `date` harus parseable.
- `amount` harus numeric.
- `uuid` harus valid UUID.

Contoh:

```java
public record SearchRequest(
        @Pattern(regexp = "^[0-9]{6}$") String postalCode,
        @Pattern(regexp = "^[A-Z]{3}-[0-9]{8}$") String caseReferenceNo
) {}
```

Syntactic validation cocok untuk Bean Validation.

Namun tetap hati-hati. Regex yang buruk bisa menjadi performance risk. Pattern yang terlihat benar bisa salah untuk Unicode, timezone, locale, atau business format yang berubah.

---

## 3.2 Structural Validation

Structural validation menjawab:

> Apakah shape object/request/event lengkap dan konsisten secara struktur?

Contoh:

- Field wajib tidak boleh null.
- List tidak boleh kosong.
- Jumlah item maksimum 100.
- Nested object harus valid.
- Map key dan value harus valid.

Contoh:

```java
public record SubmitApplicationRequest(
        @NotBlank String applicantId,
        @NotEmpty List<@Valid DocumentRequest> documents
) {}
```

Structural validation cocok untuk Bean Validation, terutama dengan:

- `@NotNull`
- `@NotEmpty`
- `@Size`
- `@Valid`
- container element constraints seperti `List<@NotBlank String>`

---

## 3.3 Semantic Validation

Semantic validation menjawab:

> Apakah nilai itu bermakna benar dalam domain?

Contoh:

- `startDate` harus sebelum `endDate`.
- `birthDate` tidak boleh di masa depan.
- `appealSubmissionDate` harus dalam appeal window.
- `amount` harus sesuai currency scale.
- `uen` valid untuk entity type tertentu.

Sebagian semantic validation cocok untuk Bean Validation, terutama jika rule bersifat lokal terhadap object.

Contoh class-level constraint:

```java
@ValidDateRange(start = "startDate", end = "endDate")
public record EffectivePeriod(
        LocalDate startDate,
        LocalDate endDate
) {}
```

Tetapi tidak semua semantic rule cocok menjadi annotation. Jika rule membutuhkan state database, external service, workflow state, current actor, atau policy version, annotation biasanya mulai menjadi tempat yang buruk.

---

## 3.4 Business Rule Validation

Business rule validation menjawab:

> Apakah aksi ini diperbolehkan menurut aturan bisnis saat ini?

Contoh:

- Case hanya boleh di-approve jika semua mandatory assessment sudah complete.
- Appeal hanya boleh dibuat dalam 14 hari setelah decision notice diterbitkan.
- Officer tidak boleh approve case yang dia submit sendiri.
- Renewal hanya boleh diajukan jika licence masih aktif atau grace period belum lewat.
- Compliance action hanya boleh escalate jika previous warning sudah served.

Sebagian kecil business rule bisa direpresentasikan sebagai validation annotation, tetapi biasanya ini bukan domain terbaik Bean Validation.

Lebih sering business rule perlu model seperti:

```java
public interface Rule<C> {
    RuleResult evaluate(C context);
}
```

atau:

```java
public final class SubmitApplicationPolicy {
    public ValidationResult validate(SubmitApplicationCommand command, CaseContext context) {
        // contextual, auditable, state-aware rules
    }
}
```

Bean Validation bagus untuk local object constraint. Business rule validation lebih cocok di command handler, domain service, policy object, atau workflow guard.

---

## 3.5 Authorization Check

Authorization menjawab:

> Apakah actor ini boleh melakukan aksi ini?

Ini bukan validation biasa.

Contoh:

- User punya permission `CASE_APPROVE`.
- Officer hanya boleh melihat case dalam agency-nya.
- Admin boleh override field tertentu.
- Maker dan checker tidak boleh orang yang sama.

Sering terjadi anti-pattern:

```java
@CanApproveCase
private String caseId;
```

Ini berbahaya jika annotation diam-diam melakukan authorization query. Authorization harus jelas, eksplisit, dan biasanya berada di security/policy layer, bukan tersembunyi sebagai field validation.

Namun hasil authorization failure dan validation failure bisa dipresentasikan dalam format error yang seragam. Yang penting internal modelnya tidak dicampur.

---

## 3.6 Consistency Check

Consistency check menjawab:

> Apakah data masih konsisten terhadap state sistem lain?

Contoh:

- Applicant ID masih exist.
- Licence masih active.
- Referenced document benar-benar milik application ini.
- Selected assessment template masih valid untuk application type.

Ini sering membutuhkan database atau external service.

Masalahnya: consistency check rentan race condition.

Contoh flow buruk:

1. Service mengecek username belum dipakai.
2. Validation pass.
3. Request lain insert username yang sama.
4. Request pertama insert juga.
5. Database unique constraint gagal.

Artinya uniqueness tidak boleh hanya bergantung pada validator. Validator boleh memberi early feedback, tetapi database constraint tetap harus menjadi final guard.

---

## 3.7 Persistence Constraint

Persistence constraint menjawab:

> Apakah data yang disimpan memenuhi aturan integritas storage?

Contoh:

- `NOT NULL`
- `UNIQUE`
- `FOREIGN KEY`
- `CHECK`
- index uniqueness
- trigger
- exclusion constraint

Bean Validation dan database constraint bukan musuh. Mereka punya peran berbeda.

| Concern | Bean/Jakarta Validation | Database Constraint |
|---|---|---|
| User feedback awal | Bagus | Biasanya terlambat dan technical |
| Object-level invariant | Bagus | Terbatas |
| Cross-row uniqueness | Lemah tanpa race protection | Kuat |
| Referential integrity final | Lemah jika hanya query | Kuat via FK |
| Complex workflow rule | Kurang cocok | Kurang cocok juga, biasanya domain layer |
| Transaction final guard | Tidak cukup | Kuat |
| Error explainability | Bagus jika didesain | Perlu translation |

---

## 3.8 Workflow Guard

Workflow guard menjawab:

> Apakah state transition ini boleh terjadi?

Contoh:

- `DRAFT -> SUBMITTED` boleh jika mandatory documents lengkap.
- `SUBMITTED -> APPROVED` boleh jika assessment complete dan checker berbeda dari maker.
- `APPROVED -> REVOKED` boleh jika revocation reason valid dan notice sudah generated.
- `REJECTED -> APPEALED` boleh jika masih dalam appeal window.

Ini mirip validation, tetapi lebih spesifik: validasi terhadap transition.

Pseudo-code:

```java
public interface TransitionGuard<S, E, C> {
    GuardResult canTransit(S currentState, E event, C context);
}
```

Bean Validation bisa memvalidasi command shape:

```java
public record ApproveCaseCommand(
        @NotBlank String caseId,
        @NotBlank String remarks
) {}
```

Tetapi guard menentukan apakah action boleh dilakukan:

```java
if (!casePolicy.canApprove(currentCase, actor)) {
    throw new TransitionRejectedException(...);
}
```

Untuk sistem regulatory, perbedaan ini sangat penting. Annotation tidak boleh menggantikan state machine.

---

## 4. Mental Model Besar: Validation sebagai Boundary Contract

Sistem software terdiri dari boundary. Boundary adalah tempat data berpindah dari satu trust zone ke trust zone lain.

Contoh boundary:

- Browser ke backend API.
- Mobile app ke gateway.
- API Gateway ke internal service.
- Message broker ke consumer.
- External agency system ke integration adapter.
- CSV upload ke import pipeline.
- Database row ke domain object.
- Admin UI ke workflow command.
- Batch job ke downstream event.

Setiap boundary punya pertanyaan:

1. Siapa pengirim data?
2. Apakah pengirim dipercaya?
3. Apakah formatnya stabil?
4. Apakah field boleh hilang?
5. Apakah versi payload diketahui?
6. Apakah ada backward compatibility?
7. Apa konsekuensi jika invalid data lolos?
8. Apakah kita reject, warn, sanitize, default, quarantine, atau accept partially?

Validation harus ditempatkan berdasarkan boundary, bukan berdasarkan “di mana mudah menaruh annotation”.

---

## 5. Trust Zones: Jangan Perlakukan Semua Input Sama

Input dari UI internal berbeda dari public API. Public API berbeda dari message broker. Message broker berbeda dari database internal. Database internal berbeda dari external integration table.

Contoh trust zone:

| Source | Trust Level | Validation Strategy |
|---|---:|---|
| Public internet API | Rendah | Strict shape, size, type, security, auth, rate limit. |
| Internal SPA | Sedang | Tetap validasi server-side; client validation hanya UX. |
| Internal service | Sedang | Validate command contract dan version compatibility. |
| Message broker | Sedang-rendah | Validate schema, version, idempotency, poison handling. |
| Database sendiri | Sedang | Jangan assume perfect; legacy/corrupt data mungkin ada. |
| External agency/system | Rendah-sedang | Anti-corruption validation, mapping, quarantine. |
| Admin override | Tinggi secara role, rendah secara input | Strong audit, explicit override reason, no blind trust. |

Prinsipnya:

> Data yang datang dari luar current boundary harus dianggap belum valid.

Bahkan jika data berasal dari internal service, contract drift tetap mungkin terjadi.

---

## 6. Client-Side Validation Bukan Security Boundary

Client-side validation berguna untuk UX:

- memberi feedback cepat,
- mengurangi roundtrip,
- membantu user mengisi form,
- mencegah error sederhana.

Tetapi client-side validation tidak boleh dipercaya sebagai final guard.

Alasannya:

- User bisa bypass browser.
- Request bisa dikirim dari Postman/curl/script.
- Frontend bisa outdated.
- Mobile app lama masih beredar.
- Malicious actor bisa modify payload.
- Feature flag frontend dan backend bisa berbeda.

Server-side validation tetap wajib.

Rule praktis:

> Frontend validation improves usability. Backend validation preserves correctness.

---

## 7. Layering Validation dalam Aplikasi Java Modern

Validation yang sehat biasanya tersebar di beberapa layer, tetapi dengan tanggung jawab yang jelas.

```text
[Client]
   |
   |  UX validation only
   v
[Transport/API Boundary]
   |  shape, size, syntax, basic semantic
   v
[Application Command Layer]
   |  operation-specific contract, actor/channel context
   v
[Domain Layer]
   |  invariant, policy, state transition guard
   v
[Persistence Layer]
   |  mapping safety, transaction boundary
   v
[Database]
   |  final integrity constraint
   v
[Events/Integration]
   |  outbound contract, versioning, consumer tolerance
```

Setiap layer boleh punya validation, tetapi tidak boleh redundant secara bodoh.

Redundant yang baik:

- API DTO `@NotNull` untuk feedback cepat.
- Domain constructor memastikan object tidak invalid meskipun dibuat dari test/batch/internal code.
- Database `NOT NULL` sebagai final guard.

Redundant yang buruk:

- Rule yang sama disalin ke 8 service dengan pesan berbeda.
- FE dan BE punya regex berbeda.
- DTO, entity, dan DB constraint berbeda tanpa alasan.
- Workflow rule tersebar di controller, service, validator, repository, dan trigger.

---

## 8. Validation di DTO Layer

DTO validation menjawab:

> Apakah request shape layak masuk application layer?

Contoh:

```java
public record CreateLicenceApplicationRequest(
        @NotBlank String applicantId,
        @NotBlank String applicationType,
        @NotEmpty List<@Valid SupportingDocumentRequest> documents,
        @Size(max = 2000) String remarks
) {}
```

DTO validation cocok untuk:

- required field,
- length,
- format,
- collection size,
- nested object shape,
- simple cross-field consistency.

DTO validation tidak cocok untuk:

- complex workflow state,
- permission check,
- database uniqueness final guarantee,
- long external calls,
- rules yang berubah berdasarkan policy version kompleks.

DTO validation sebaiknya menghasilkan error yang bisa dipahami client:

```json
{
  "type": "https://example.gov/errors/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "violations": [
    {
      "path": "documents[0].fileName",
      "code": "DOCUMENT_FILE_NAME_REQUIRED",
      "message": "Document file name is required."
    }
  ]
}
```

---

## 9. Validation di Command Layer

Command layer lebih dekat ke use case.

DTO adalah bentuk transport. Command adalah niat aplikasi.

Contoh:

```java
public record SubmitApplicationCommand(
        String applicationId,
        String actorUserId,
        Channel channel,
        Instant submittedAt
) {}
```

Command validation menjawab:

- Apakah command ini punya semua informasi yang dibutuhkan?
- Apakah actor/channel/action valid?
- Apakah request dari endpoint sudah dinormalisasi?
- Apakah ini create, update, submit, approve, withdraw, atau escalate?

Kenapa command layer penting?

Karena satu DTO bisa berubah, tetapi command use case harus stabil. Sebaliknya, satu endpoint bisa menerima format berbeda tetapi menghasilkan command yang sama.

Contoh:

```java
public final class SubmitApplicationHandler {
    public SubmitApplicationResult handle(SubmitApplicationCommand command) {
        commandValidator.validate(command);
        Application application = repository.get(command.applicationId());
        submissionPolicy.validate(application, command.actorUserId(), command.submittedAt());
        application.submit(command.actorUserId(), command.submittedAt());
        repository.save(application);
        return SubmitApplicationResult.success(application.id());
    }
}
```

Di sini ada beberapa validation:

1. `commandValidator` memeriksa command shape.
2. `submissionPolicy` memeriksa rule contextual.
3. `application.submit()` menjaga invariant/transisi domain.
4. Database menjaga final consistency.

---

## 10. Validation di Domain Layer

Domain layer harus menjaga invariant.

Invariant adalah aturan yang harus selalu benar untuk sebuah object agar object itu masuk akal.

Contoh invariant:

- `Money` harus punya amount dan currency.
- `DateRange` harus punya `start <= end`.
- `Case` tidak boleh punya status null.
- `Decision` harus punya outcome dan decidedAt.
- `LicencePeriod` tidak boleh end sebelum start.

Domain object tidak boleh bergantung sepenuhnya pada DTO validation. Karena domain object bisa dibuat dari:

- REST API,
- batch job,
- event consumer,
- test,
- migration script,
- admin tool,
- integration adapter,
- repository hydration.

Contoh value object:

```java
public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start, "start must not be null");
        Objects.requireNonNull(end, "end must not be null");
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }
}
```

Apakah ini menggantikan Jakarta Validation? Tidak.

Ini menjaga domain invariant. Jakarta Validation menjaga contract pada boundary dan object graph tertentu. Keduanya saling melengkapi.

---

## 11. Validation di Persistence Layer dan Database

Persistence layer memvalidasi mapping dan final storage consistency.

Beberapa rule harus ada di database:

- unique email,
- unique case reference number,
- non-null critical columns,
- FK reference,
- status enum check,
- amount non-negative jika storage-level invariant,
- row version optimistic locking.

Contoh buruk:

```java
if (!userRepository.existsByEmail(email)) {
    userRepository.save(new User(email));
}
```

Tanpa unique constraint, ini race-prone.

Contoh benar:

1. Optional early check untuk user-friendly error.
2. Database unique constraint sebagai final guard.
3. Translate DB exception menjadi domain/API error.

```java
try {
    userRepository.save(user);
} catch (DuplicateKeyException ex) {
    throw new BusinessConflictException("EMAIL_ALREADY_REGISTERED", ex);
}
```

Prinsip:

> Validation can predict invalidity. Database constraints enforce final consistency.

---

## 12. Validation di Event-Driven System

Event-driven system butuh validation yang berbeda.

Inbound event validation menjawab:

- Apakah event schema dikenali?
- Apakah event version didukung?
- Apakah mandatory field ada?
- Apakah event idempotency key ada?
- Apakah event sudah pernah diproses?
- Apakah referenced entity ada?
- Jika invalid, apakah event harus DLQ, retry, quarantine, atau ignore?

Outbound event validation menjawab:

- Apakah event yang dipublish sesuai contract?
- Apakah field sensitif tidak bocor?
- Apakah versioning backward-compatible?
- Apakah consumer lama masih bisa membaca?

Bean Validation bisa dipakai untuk event payload object:

```java
public record ApplicationSubmittedEvent(
        @NotBlank String eventId,
        @NotBlank String applicationId,
        @NotNull Instant submittedAt,
        @NotBlank String schemaVersion
) {}
```

Tetapi event validation harus punya operational policy:

| Failure | Likely Action |
|---|---|
| Missing mandatory field | DLQ/quarantine, no retry. |
| Unsupported future version | DLQ or parking lot. |
| Referenced aggregate not found | Retry if eventual consistency expected, otherwise DLQ. |
| Duplicate event | Ignore/idempotent success. |
| Temporary dependency failure | Retry with backoff. |
| Poison message | DLQ with classification. |

Validation error di synchronous API biasanya dikembalikan ke caller. Validation error di async consumer harus dikelola sebagai operational incident atau data quality issue.

---

## 13. Validation di Workflow dan State Machine

Untuk case management, validation sering terkait state.

Contoh:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ACTIVE
                         |              |
                         v              v
                      REJECTED        REVOKED
```

Rule:

- DRAFT boleh SUBMITTED hanya jika mandatory documents lengkap.
- UNDER_REVIEW boleh APPROVED hanya jika assessment complete.
- APPROVED boleh REVOKED hanya jika revocation notice generated.
- REJECTED boleh APPEALED hanya dalam appeal window.

Ini bukan sekadar `@NotNull`.

Workflow validation harus tahu:

- current state,
- target state,
- actor,
- timestamp,
- previous actions,
- required documents,
- SLA/deadline,
- role/maker-checker,
- policy version,
- audit evidence.

Model yang lebih sehat:

```java
public interface CaseTransitionPolicy {
    TransitionValidationResult validate(CaseAggregate aggregate, CaseCommand command, Actor actor, Clock clock);
}
```

Hasilnya jangan hanya boolean.

```java
public record RuleViolation(
        String ruleCode,
        String message,
        Severity severity,
        boolean blocking,
        Map<String, Object> evidence
) {}
```

Regulatory system butuh explainability:

- Rule mana yang gagal?
- Berdasarkan data apa?
- Pada policy version berapa?
- Siapa actor-nya?
- Kapan evaluasi dilakukan?
- Apakah blocking atau warning?
- Apakah ada override?

Bean Validation annotation tidak cukup untuk itu.

---

## 14. Validation sebagai Anti-Corruption Layer

External system tidak selalu mengikuti domain internal kita.

Contoh external payload:

```json
{
  "status": "A",
  "applicant_name": "  ACME PTE LTD ",
  "postal": "123456",
  "effective_date": "16/06/2026"
}
```

Internal domain mungkin butuh:

```java
public record ApplicantSnapshot(
        ApplicantStatus status,
        ApplicantName name,
        PostalCode postalCode,
        LocalDate effectiveDate
) {}
```

Anti-corruption layer melakukan:

1. Parse external format.
2. Normalize value.
3. Validate external contract.
4. Map ke internal model.
5. Reject/quarantine jika tidak bisa dipercaya.
6. Simpan raw payload untuk audit jika perlu.

Jangan langsung menaruh external DTO ke domain.

```text
External Payload
   -> External DTO
   -> External Contract Validation
   -> Normalization
   -> Mapping
   -> Internal Command/Domain Object
   -> Domain Validation
```

Ini penting untuk sistem yang menerima data dari agency lain, vendor lain, legacy batch, CSV, SFTP, atau message bus.

---

## 15. Failure Model: Jenis Invalid Data

Validation design yang matang dimulai dari failure model.

Bukan hanya “field kosong”.

---

## 15.1 Invalid Input

Input tidak memenuhi format atau constraint.

Contoh:

- email salah,
- amount negatif,
- date invalid,
- list kosong,
- postal code bukan 6 digit.

Biasanya response: `400 Bad Request` atau validation problem.

---

## 15.2 Incomplete Input

Input belum lengkap untuk operasi tertentu.

Contoh:

- draft application boleh tanpa document,
- submit application wajib ada document,
- update profile boleh partial,
- approve case wajib remarks.

Ini membutuhkan operation-specific validation.

Jangan menaruh `@NotNull` global pada field jika field hanya wajib pada operasi tertentu.

---

## 15.3 Inconsistent Input

Masing-masing field valid, tetapi kombinasi tidak valid.

Contoh:

```json
{
  "startDate": "2026-06-20",
  "endDate": "2026-06-10"
}
```

Atau:

```json
{
  "applicantType": "COMPANY",
  "nric": "S1234567D",
  "uen": null
}
```

Butuh cross-field/class-level validation atau command validation.

---

## 15.4 Stale Input

Input valid saat dibuat, tetapi sudah basi saat diproses.

Contoh:

- User membuka form lama, lalu case status berubah.
- Dropdown option sudah disabled.
- Licence sudah expired.
- Version conflict karena concurrent update.

Validation response bisa berupa:

- `409 Conflict`,
- optimistic lock failure,
- stale state error,
- user diminta reload.

Ini bukan sekadar Bean Validation.

---

## 15.5 Unauthorized Input

Input valid secara bentuk, tetapi actor tidak boleh melakukan aksi.

Contoh:

- Officer mencoba approve case di luar scope.
- User mencoba update field system-owned.
- External user mencoba submit internal-only action.

Response biasanya `403 Forbidden`, bukan `400 Validation Failed`.

Namun detailnya harus hati-hati agar tidak membocorkan data.

---

## 15.6 Malicious Input

Input sengaja dibuat untuk menyerang.

Contoh:

- payload sangat besar,
- nested JSON sangat dalam,
- regex catastrophic backtracking,
- string berisi template expression,
- path traversal,
- SQL injection attempt,
- Unicode spoofing,
- log injection.

Validation harus didukung security control lain:

- request size limit,
- rate limiting,
- parser depth limit,
- safe encoding,
- parameterized query,
- output encoding,
- safe logging.

Validation bukan sanitization.

---

## 15.7 Race-Condition Invalidity

Input valid pada saat dicek, tetapi invalid pada saat commit.

Contoh:

- uniqueness,
- inventory/reservation,
- quota,
- concurrent approval,
- state transition race.

Solusi:

- transaction boundary,
- unique constraint,
- optimistic locking,
- pessimistic lock bila perlu,
- idempotency key,
- compare-and-swap style update,
- final state check inside transaction.

---

## 16. Validation Outcome: Jangan Hanya Boolean

Banyak desain buruk memakai:

```java
boolean isValid(Request request);
```

Ini terlalu miskin.

Validation result di sistem besar perlu membawa informasi:

- rule code,
- path,
- severity,
- blocking/non-blocking,
- human message,
- machine-readable message,
- rejected value classification,
- remediation,
- evidence,
- rule version,
- correlation id.

Contoh model:

```java
public record ValidationViolation(
        String code,
        String path,
        String message,
        Severity severity,
        boolean blocking,
        Map<String, Object> evidence
) {}
```

```java
public record ValidationResult(List<ValidationViolation> violations) {
    public boolean isValid() {
        return violations.stream().noneMatch(ValidationViolation::blocking);
    }
}
```

Jakarta Validation menghasilkan `Set<ConstraintViolation<T>>`. Itu bagus untuk object validation. Untuk domain/workflow validation, kita sering butuh model result sendiri.

---

## 17. Hard Validation vs Soft Validation

Tidak semua validation harus langsung menolak.

Ada dua mode:

### Hard validation

Input ditolak.

Contoh:

- field wajib kosong,
- invalid enum,
- action tidak boleh,
- duplicate final key,
- unauthorized transition.

### Soft validation

Input diterima tetapi diberi warning, flagged, atau butuh confirmation.

Contoh:

- applicant name mirip existing record,
- amount unusually high,
- document expired soon,
- address tidak ditemukan di reference dataset tetapi user boleh override,
- optional recommended field kosong.

Soft validation penting untuk workflow manusia. Tidak semua anomaly harus block.

Contoh response:

```json
{
  "valid": true,
  "warnings": [
    {
      "code": "ADDRESS_NOT_CONFIRMED",
      "message": "Address could not be confirmed against reference data.",
      "requiresAcknowledgement": true
    }
  ]
}
```

Jakarta Validation umumnya hard validation. Untuk soft validation, biasanya buat rule engine/policy result sendiri.

---

## 18. Error Code Lebih Penting daripada Error Message

Human message bisa berubah. Error code harus stabil.

Buruk:

```json
{
  "message": "must not be blank"
}
```

Lebih baik:

```json
{
  "code": "APPLICANT_NAME_REQUIRED",
  "path": "applicant.name",
  "message": "Applicant name is required."
}
```

Kenapa?

- Frontend bisa mapping error code ke UI behavior.
- QA bisa test stabil.
- Support bisa search error code.
- Audit bisa menjelaskan rejection.
- Message bisa di-i18n tanpa memutus contract.
- Machine client tidak perlu parse string.

Dalam Jakarta Validation, default message seperti `must not be null` tidak cukup untuk sistem enterprise. Kita perlu mapping dari constraint ke error catalog.

---

## 19. Jangan Bocorkan PII lewat Validation Error

Validation error sering masuk:

- API response,
- application log,
- audit log,
- monitoring,
- APM trace,
- alert,
- support ticket.

Jangan sembarangan menaruh rejected value.

Buruk:

```json
{
  "path": "nric",
  "message": "Invalid NRIC S1234567D"
}
```

Lebih aman:

```json
{
  "path": "nric",
  "code": "NRIC_FORMAT_INVALID",
  "message": "NRIC format is invalid."
}
```

Untuk log:

```json
{
  "path": "nric",
  "code": "NRIC_FORMAT_INVALID",
  "valueClass": "PRESENT_REDACTED"
}
```

Prinsip:

> Validation should explain what is wrong without unnecessarily exposing what was submitted.

---

## 20. Anti-Pattern Utama dalam Validation

---

## 20.1 Semua Rule Dipaksa Jadi Annotation

Annotation bagus untuk static local constraint.

Annotation buruk untuk:

- rule yang butuh actor,
- rule yang butuh workflow state,
- rule yang berubah per tenant/policy version,
- rule yang butuh external service,
- rule yang butuh transaction lock,
- rule yang punya warning/non-blocking result,
- rule yang harus menghasilkan evidence detail.

Jika validator annotation mulai inject 5 service dan query 7 table, biasanya desainnya salah.

---

## 20.2 `@NotNull` Global pada DTO yang Dipakai Banyak Operasi

Contoh:

```java
public class ApplicationDto {
    @NotNull
    private String applicantName;

    @NotNull
    private List<DocumentDto> documents;
}
```

Lalu DTO ini dipakai untuk:

- create draft,
- update draft,
- submit,
- admin correction,
- partial patch.

Akhirnya muncul hack:

- validation group terlalu banyak,
- field dibuat nullable padahal tidak jelas,
- controller skip validation,
- custom if-else di mana-mana.

Solusi:

- command-specific DTO,
- validation group dengan governance,
- explicit patch model,
- domain policy untuk operation-specific rules.

---

## 20.3 Validasi Terlalu Terlambat

Jika invalid payload baru gagal di database, user mendapat error buruk, transaction sudah mahal, dan downstream mungkin sudah terdampak.

Contoh buruk:

- request body tidak divalidasi,
- service memproses 20 langkah,
- insert gagal karena null column,
- response 500.

Solusi:

- validate boundary lebih awal,
- translate validation error menjadi 400,
- gunakan database sebagai final guard, bukan satu-satunya guard.

---

## 20.4 Validasi Terlalu Awal

Terlalu awal juga bisa salah.

Contoh:

- raw request belum dinormalisasi,
- date string belum di-convert timezone,
- external code belum dipetakan ke enum internal,
- missing value sebenarnya bisa di-default berdasarkan context,
- role actor belum diketahui.

Solusi:

- parse dulu,
- normalize dulu,
- enrich context jika memang bagian contract,
- lalu validate pada model yang tepat.

---

## 20.5 Menganggap Validation Sama dengan Sanitization

Validation menjawab “boleh atau tidak”.

Sanitization/normalization mengubah input.

Encoding melindungi output.

Contoh:

```text
Input: " <script>alert(1)</script> "
```

Validation bisa menolak jika field tidak boleh mengandung markup. Sanitization bisa menghapus markup. Output encoding memastikan nilai aman saat ditampilkan di HTML.

Jangan mengira `@Size` dan `@Pattern` otomatis mencegah XSS/SQL injection.

---

## 20.6 Validator Melakukan Side Effect

Validator tidak seharusnya:

- mengirim email,
- membuat audit log business final,
- update database,
- reserve quota,
- publish event,
- mutate object secara diam-diam.

Validator sebaiknya pure atau setidaknya side-effect-free.

Jika harus query read-only, pahami konsekuensi latency, cache, transaction, race condition, dan testability.

---

## 20.7 Error Message Tidak Stabil

Jika frontend bergantung pada string `must not be blank`, sistem rapuh.

Gunakan error code.

---

## 20.8 Validation Rule Tidak Punya Owner

Di enterprise system, rule harus punya owner.

Pertanyaan governance:

- Siapa pemilik rule?
- Kapan rule berubah?
- Apakah ada versioning?
- Apakah rule berlaku untuk data lama?
- Apakah warning dulu sebelum hard reject?
- Apakah rule sudah diumumkan ke client/consumer?
- Apakah ada migration path?

Tanpa owner, validation menjadi tribal knowledge.

---

## 21. Cara Memutuskan Penempatan Rule

Gunakan decision matrix berikut.

| Rule Type | Example | Best Location |
|---|---|---|
| Field required untuk request tertentu | `remarks` wajib saat reject | DTO/command validation |
| Field format | postal code 6 digit | DTO validation/value object |
| Simple local invariant | start <= end | value object/class-level validation |
| Nested object shape | document list valid | DTO `@Valid` cascade |
| Uniqueness | email unique | DB constraint + service translation |
| Reference exists | applicant exists | service/domain policy, maybe early validation |
| Actor permission | officer can approve | authorization/policy layer |
| State transition | DRAFT -> SUBMITTED | workflow guard/state machine |
| Cross-aggregate rule | no active duplicate licence | domain service + DB/query constraint if possible |
| External payload contract | agency event payload | anti-corruption adapter/event validation |
| Security size limit | max payload 1MB | gateway/server/parser + DTO size constraints |
| Output safety | prevent XSS | output encoding, not Bean Validation only |

Rule of thumb:

- Jika rule tentang **shape**, gunakan Jakarta Validation.
- Jika rule tentang **object invariant**, gunakan value object/domain constructor dan bisa juga Jakarta Validation.
- Jika rule tentang **operation**, gunakan command validation/group/operation DTO.
- Jika rule tentang **actor**, gunakan authorization/policy.
- Jika rule tentang **state transition**, gunakan workflow guard.
- Jika rule tentang **database final consistency**, gunakan database constraint.
- Jika rule tentang **external system**, gunakan anti-corruption layer.

---

## 22. Example: Satu Use Case, Banyak Layer Validation

Use case: Submit licence application.

### 22.1 Request DTO

```java
public record SubmitLicenceApplicationRequest(
        @NotBlank String applicationId,
        @NotEmpty List<@Valid SubmitDocumentRequest> documents,
        @Size(max = 2000) String remarks
) {}

public record SubmitDocumentRequest(
        @NotBlank String documentType,
        @NotBlank String fileId
) {}
```

Menjamin request shape.

---

### 22.2 Command

```java
public record SubmitLicenceApplicationCommand(
        ApplicationId applicationId,
        UserId actorId,
        Channel channel,
        List<DocumentRef> documents,
        String remarks,
        Instant requestedAt
) {}
```

Command sudah memakai type yang lebih domain-specific.

---

### 22.3 Value Object

```java
public record ApplicationId(String value) {
    public ApplicationId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("application id is required");
        }
        if (!value.matches("APP-[0-9]{8}")) {
            throw new IllegalArgumentException("application id format is invalid");
        }
    }
}
```

Menjaga invariant identifier.

---

### 22.4 Command Handler

```java
public final class SubmitLicenceApplicationHandler {
    private final ApplicationRepository repository;
    private final SubmitApplicationPolicy policy;

    public SubmitResult handle(SubmitLicenceApplicationCommand command, Actor actor) {
        Application application = repository.get(command.applicationId());

        PolicyResult policyResult = policy.validate(application, command, actor);
        if (!policyResult.isAllowed()) {
            throw new PolicyViolationException(policyResult.violations());
        }

        application.submit(actor.id(), command.requestedAt());
        repository.save(application);

        return SubmitResult.success(application.id());
    }
}
```

---

### 22.5 Policy

```java
public final class SubmitApplicationPolicy {
    public PolicyResult validate(Application application,
                                 SubmitLicenceApplicationCommand command,
                                 Actor actor) {
        PolicyResult result = PolicyResult.empty();

        if (!application.isDraft()) {
            result.addBlocking("APPLICATION_NOT_IN_DRAFT", "Only draft applications can be submitted.");
        }

        if (!actor.canSubmit(application)) {
            result.addBlocking("ACTOR_CANNOT_SUBMIT", "You are not allowed to submit this application.");
        }

        if (!application.hasAllMandatoryDocuments(command.documents())) {
            result.addBlocking("MANDATORY_DOCUMENTS_MISSING", "Mandatory documents are missing.");
        }

        return result;
    }
}
```

Ini bukan annotation karena butuh state, actor, dan context.

---

### 22.6 Domain Aggregate

```java
public final class Application {
    private ApplicationStatus status;

    public void submit(UserId actorId, Instant submittedAt) {
        if (status != ApplicationStatus.DRAFT) {
            throw new IllegalStateException("Only draft application can be submitted");
        }
        this.status = ApplicationStatus.SUBMITTED;
        // add domain event, audit marker, etc.
    }
}
```

Aggregate tetap menjaga dirinya meski policy layer lupa.

---

### 22.7 Database

Database menjaga final integrity:

```sql
alter table application
  modify application_id not null;

alter table application
  add constraint uq_application_reference unique (application_reference_no);

alter table application
  add constraint ck_application_status
  check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'));
```

---

### 22.8 API Error

```json
{
  "type": "https://example.gov/errors/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "correlationId": "01JY...",
  "violations": [
    {
      "path": "documents",
      "code": "DOCUMENTS_REQUIRED",
      "message": "At least one document is required."
    }
  ]
}
```

Untuk policy failure:

```json
{
  "type": "https://example.gov/errors/action-not-allowed",
  "title": "Action is not allowed",
  "status": 409,
  "correlationId": "01JY...",
  "violations": [
    {
      "code": "APPLICATION_NOT_IN_DRAFT",
      "message": "Only draft applications can be submitted."
    }
  ]
}
```

Perhatikan: shape validation dan workflow rejection bisa punya response model mirip, tetapi status dan semantics berbeda.

---

## 23. Java 8 sampai 25: Implikasi Desain Validation

---

## 23.1 Java 8

Java 8 penting karena Bean Validation 2.0 memanfaatkan type annotations dan Java 8 date/time API.

Implikasi:

- Bisa memakai `List<@NotBlank String>`.
- Bisa validate `Optional` dan container element.
- Bisa memakai `LocalDate`, `Instant`, `ZonedDateTime` untuk temporal validation.
- Legacy code sering masih `javax.validation`.

Java 8 style sering memakai mutable POJO:

```java
public class CreateUserRequest {
    @NotBlank
    private String name;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

Risiko:

- object bisa dibuat invalid lalu dimutasi,
- setter bisa bypass invariant,
- validation terjadi hanya jika framework memanggilnya.

---

## 23.2 Java 11/17

Java 11/17 banyak dipakai sebagai baseline enterprise modern.

Dengan Java 17, records dan sealed classes membuka style modeling yang lebih kuat.

```java
public record CreateUserRequest(
        @NotBlank String name,
        @Email String email
) {}
```

Records membuat DTO lebih immutable, tetapi tidak otomatis valid. Constraint tetap harus dievaluasi oleh validator atau invariant di compact constructor.

---

## 23.3 Java 21/25

Java 21 dan 25 mendorong modern Java style:

- records,
- pattern matching,
- sealed hierarchy,
- virtual threads,
- structured concurrency style thinking,
- better immutable modeling,
- newer LTS baseline.

Validation implication:

- Jangan membuat validator blocking-heavy di hot path virtual threads tanpa memahami throughput dependency.
- Immutable command/DTO membuat validation result lebih predictable.
- Sealed command hierarchy bisa membuat operation-specific validation lebih eksplisit.
- Records cocok untuk boundary DTO, tetapi domain invariant tetap perlu didesain.

Contoh sealed command:

```java
public sealed interface CaseCommand permits SubmitCase, ApproveCase, RejectCase {}

public record SubmitCase(@NotBlank String caseId) implements CaseCommand {}
public record ApproveCase(@NotBlank String caseId, @NotBlank String remarks) implements CaseCommand {}
public record RejectCase(@NotBlank String caseId, @NotBlank String reason) implements CaseCommand {}
```

Ini sering lebih jelas daripada satu DTO besar dengan banyak nullable field dan group rumit.

---

## 24. Validation dan Defensibility

Dalam sistem biasa, validation failure berarti user salah input.

Dalam sistem regulatory, validation failure bisa menjadi bagian dari decision record.

Pertanyaan auditor bisa seperti:

- Kenapa submission ditolak?
- Rule apa yang digunakan?
- Apakah rule itu berlaku pada tanggal tersebut?
- Apakah user diberi pesan yang jelas?
- Apakah officer melakukan override?
- Apakah ada evidence?
- Apakah rule berubah setelah itu?

Maka validation rule perlu:

1. **Stable code** — misalnya `MANDATORY_DOCUMENT_MISSING`.
2. **Rule owner** — siapa pemilik policy.
3. **Rule version** — minimal effective date/version.
4. **Evidence** — data pendukung tanpa PII berlebihan.
5. **Decision** — blocking/warning.
6. **Auditability** — tercatat di audit trail jika relevan.
7. **Reproducibility** — bisa dijelaskan ulang.

Bean Validation default tidak memberikan semua ini. Kita harus membangun layer governance di atasnya.

---

## 25. Validation dan Observability

Validation bukan hanya kode. Validation harus terlihat secara operasional.

Metrics yang berguna:

- jumlah validation failure per endpoint,
- top violated field,
- top violated rule code,
- rejection rate per client version,
- rejection rate per channel,
- latency validation,
- expensive validator count,
- DLQ count karena invalid event,
- number of warnings vs blocking errors.

Contoh metric:

```text
validation_failures_total{endpoint="/applications/submit", code="DOCUMENTS_REQUIRED"} 42
validation_latency_seconds{validator="SubmitApplicationPolicy", quantile="0.95"} 0.018
```

Kenapa penting?

- Tiba-tiba rejection naik setelah deployment berarti ada breaking change.
- Banyak client gagal pada field tertentu berarti contract tidak jelas.
- Validator lambat bisa menjadi bottleneck.
- DLQ invalid event bisa menunjukkan producer contract drift.

---

## 26. Validation Rollout Strategy

Rule baru jangan selalu langsung hard reject.

Strategi enterprise:

1. **Observe mode**  
   Rule dievaluasi, tetapi tidak memblokir. Metrics dikumpulkan.

2. **Warn mode**  
   User/client mendapat warning, tetapi masih bisa lanjut.

3. **Soft enforcement**  
   Beberapa channel/role/client version mulai diblokir.

4. **Hard enforcement**  
   Rule menjadi blocking untuk semua applicable context.

5. **Tightening**  
   Rule makin ketat setelah data quality membaik.

Ini penting untuk:

- public API,
- mobile app dengan client lama,
- multi-agency integration,
- regulatory forms dengan banyak user,
- rule change yang berdampak besar.

---

## 27. Validation dan Backward Compatibility

Validation bisa menjadi breaking change.

Contoh breaking validation change:

- field yang dulu optional menjadi required,
- max length diperkecil,
- enum value dihapus,
- regex diperketat,
- nested object sekarang wajib,
- event consumer menolak version lama,
- PATCH sekarang menolak null yang dulu diterima.

Rule:

> Tightening validation is often a breaking API change.

Untuk API versioning, pikirkan:

- apakah client lama masih mengirim payload lama?
- apakah field baru harus optional dulu?
- apakah warning period diperlukan?
- apakah rule berlaku hanya untuk new application, bukan existing draft?
- apakah existing data perlu migration?

---

## 28. Validation dan Data Quality

Validation mencegah data buruk masuk. Tetapi data buruk bisa sudah ada.

Sumber data buruk:

- legacy migration,
- manual DB fix,
- bug lama,
- external integration,
- partial failure,
- inconsistent historical rule,
- relaxed validation masa lalu.

Maka sistem perlu membedakan:

1. **Entry validation** — mencegah data buruk baru.
2. **Read tolerance** — mampu membaca data lama yang tidak sempurna.
3. **Repair workflow** — memperbaiki data buruk.
4. **Migration validation** — memvalidasi batch migration.
5. **Data quality report** — memantau legacy issue.

Jangan membuat sistem tiba-tiba gagal membaca semua data lama hanya karena validation baru ditambahkan di entity getter/deserializer.

---

## 29. Validation dan Performance

Validation punya biaya.

Biaya bisa datang dari:

- metadata scanning,
- reflection,
- object graph traversal,
- cascading nested collections,
- regex,
- message interpolation,
- allocation of violation objects,
- database query dalam validator,
- external service call,
- logging/audit.

Prinsip performance:

- Reuse `ValidatorFactory`.
- Hindari membuat factory per request.
- Jangan cascade graph besar tanpa batas.
- Gunakan fail-fast jika cocok.
- Validasi cheap rules dulu.
- Jangan taruh network call di constraint validator hot path.
- Batasi collection size sebelum cascade per element.
- Hindari regex raw dari user/admin tanpa review.

Contoh masalah:

```java
public record BulkImportRequest(
        @Valid List<ImportRow> rows
) {}
```

Jika `rows` berisi 1 juta item, cascade validation bisa memakan CPU/memory besar. Perlu boundary limit:

```java
public record BulkImportRequest(
        @Size(max = 10_000) List<@Valid ImportRow> rows
) {}
```

Bahkan itu mungkin masih terlalu besar untuk synchronous API.

---

## 30. Validation dan Time

Time-based validation sulit.

Contoh:

- must be future,
- appeal within 14 days,
- SLA deadline,
- grace period,
- business day,
- timezone agency,
- holiday calendar,
- end-of-day rule.

Jangan sembarangan memakai `LocalDate.now()` dalam validator.

Lebih baik inject `Clock` atau gunakan `ClockProvider` di Bean Validation.

Contoh domain policy:

```java
public final class AppealPolicy {
    private final Clock clock;

    public AppealPolicy(Clock clock) {
        this.clock = clock;
    }

    public PolicyResult validateAppealWindow(Decision decision) {
        LocalDate today = LocalDate.now(clock);
        LocalDate deadline = decision.noticeDate().plusDays(14);
        if (today.isAfter(deadline)) {
            return PolicyResult.blocking("APPEAL_WINDOW_CLOSED");
        }
        return PolicyResult.ok();
    }
}
```

Time rule harus eksplisit soal:

- timezone,
- inclusivity,
- holiday/business day,
- source of truth time,
- testability.

---

## 31. Validation dan Normalization

Kadang input perlu dinormalisasi sebelum divalidasi.

Contoh:

- trim whitespace,
- normalize Unicode,
- uppercase code,
- parse date format,
- map external status code,
- convert empty string to null,
- remove formatting from phone number.

Namun normalization harus hati-hati.

Contoh:

```text
Input: " abc "
Normalized: "abc"
```

Ini biasanya aman.

Tapi:

```text
Input: "<script>..."
Sanitized: ""
```

Jika otomatis diubah menjadi kosong tanpa user tahu, bisa menyembunyikan masalah.

Prinsip:

- Normalize format yang jelas dan non-destructive.
- Jangan diam-diam mengubah meaning.
- Audit raw payload jika perlu.
- Validate setelah normalization jika contract internal memakai normalized value.
- Untuk security-sensitive data, lebih baik reject daripada silent sanitize.

---

## 32. Validation dan Partial Update

PATCH adalah sumber bug validation.

Masalah utama:

- absent field berbeda dari explicit null,
- `@NotNull` di DTO bisa salah,
- update partial tidak sama dengan create,
- field clearing harus eksplisit,
- default value bisa berbahaya.

Contoh PATCH payload:

```json
{
  "remarks": null
}
```

Apakah artinya:

- remarks ingin dihapus?
- client lupa isi?
- JSON serializer mengirim null default?
- user tidak punya akses update field?

Model yang lebih eksplisit:

```java
public sealed interface PatchValue<T> {
    record Absent<T>() implements PatchValue<T> {}
    record Present<T>(T value) implements PatchValue<T> {}
}
```

Atau pakai JSON Merge Patch/JSON Patch dengan policy jelas.

Untuk partial update, sering lebih baik tidak memakai DTO create yang sama.

---

## 33. Validation dan Import/Batch

Batch validation berbeda dari API validation.

API biasanya reject satu request.

Batch import biasanya perlu:

- validate banyak row,
- kumpulkan semua error,
- lanjutkan row valid,
- reject row invalid,
- hasilkan report,
- idempotency,
- retry,
- partial success,
- audit file.

Contoh result:

```json
{
  "fileId": "F001",
  "totalRows": 1000,
  "validRows": 950,
  "invalidRows": 50,
  "errors": [
    {
      "row": 12,
      "column": "postalCode",
      "code": "POSTAL_CODE_INVALID"
    }
  ]
}
```

Jakarta Validation bisa validate per row, tetapi orchestration batch error report perlu desain sendiri.

---

## 34. Validation dan Testing Mindset

Validation harus dites bukan hanya happy path.

Kategori test:

- null,
- empty,
- blank,
- Unicode whitespace,
- min/max boundary,
- too long,
- too short,
- invalid format,
- valid edge format,
- timezone boundary,
- leap day,
- DST,
- collection empty,
- collection huge,
- nested invalid object,
- multiple violations,
- group-specific behavior,
- operation-specific rule,
- stale state,
- concurrent race,
- DB constraint translation,
- error code stability.

Validation test harus memastikan:

1. Rule benar.
2. Path benar.
3. Error code benar.
4. Message aman.
5. Severity benar.
6. Behavior stable saat refactor.

---

## 35. Top 1% Mental Checklist

Sebelum membuat validation rule, tanyakan:

1. Rule ini tentang shape, invariant, operation, actor, state transition, atau persistence?
2. Di boundary mana rule harus dievaluasi?
3. Apakah rule context-free atau context-dependent?
4. Apakah rule stable atau sering berubah?
5. Apakah rule harus blocking atau warning?
6. Apakah ada race condition jika dicek sebelum commit?
7. Apakah DB constraint tetap dibutuhkan?
8. Apakah error code stabil?
9. Apakah message aman dari PII leak?
10. Apakah rule bisa diuji deterministik?
11. Apakah rule butuh `Clock`?
12. Apakah rule berdampak pada backward compatibility?
13. Apakah rule punya owner?
14. Apakah rule perlu audit trail?
15. Apakah rule bisa diamati lewat metrics?
16. Apakah rule akan membebani hot path?
17. Apakah validator melakukan side effect?
18. Apakah rule lebih cocok sebagai annotation, policy object, workflow guard, atau DB constraint?
19. Apakah invalid data lama masih bisa dibaca?
20. Apakah rollout perlu observe/warn/enforce?

Jika bisa menjawab semua, desain validation Anda sudah jauh lebih matang daripada sekadar menambah annotation.

---

## 36. Vocabulary yang Akan Dipakai Sepanjang Seri

| Istilah | Arti |
|---|---|
| Constraint | Batasan yang harus dipenuhi data/object/action. |
| Violation | Bukti bahwa constraint gagal. |
| Boundary | Titik perpindahan data antar trust zone/layer/system. |
| DTO | Object transport, biasanya merepresentasikan request/response shape. |
| Command | Object yang merepresentasikan niat use case/application action. |
| Invariant | Kondisi yang harus selalu benar pada domain object. |
| Policy | Rule contextual yang menentukan boleh/tidak/warning. |
| Workflow guard | Rule untuk state transition. |
| Hard validation | Failure memblokir proses. |
| Soft validation | Failure menjadi warning/non-blocking. |
| Error code | Kode stabil machine-readable untuk violation. |
| Message interpolation | Proses menghasilkan pesan dari template constraint. |
| Cascaded validation | Validasi nested object melalui `@Valid`. |
| Container element constraint | Constraint pada elemen generic container, misalnya `List<@NotBlank String>`. |
| Value extractor | Mekanisme untuk mengekstrak value dari custom container agar bisa divalidasi. |
| Group | Mekanisme memilih subset constraint berdasarkan konteks validasi. |
| Group sequence | Mekanisme mengurutkan group dan short-circuit validation. |
| Executable validation | Validasi method/constructor parameter dan return value. |
| Anti-corruption layer | Layer yang melindungi domain internal dari model eksternal. |

---

## 37. Peta Jalan ke Part Berikutnya

Setelah orientation ini, seri akan masuk ke detail teknis secara bertahap.

Part berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-001.md
```

Topik:

```text
Specification Landscape: Bean Validation, Jakarta Validation, javax vs jakarta
```

Di part berikutnya kita akan membahas secara detail:

- sejarah Bean Validation dan Jakarta Validation,
- JSR 303/349/380,
- Bean Validation 2.0,
- Jakarta Validation 3.0/3.1,
- perbedaan `javax.validation` dan `jakarta.validation`,
- Hibernate Validator 6/7/8/9,
- compatibility matrix Java 8 sampai 25,
- migration mindset untuk codebase legacy dan modern.

---

## 38. Ringkasan Part 000

Inti part ini:

1. Validation adalah correctness architecture, bukan sekadar annotation.
2. Tidak semua rule adalah jenis rule yang sama.
3. Jakarta Validation cocok untuk local object/bean/method constraints.
4. Hibernate Validator adalah implementation penting, tetapi bukan tempat semua business rule harus dipaksa masuk.
5. Domain invariant, workflow guard, authorization, database constraint, dan event validation punya tanggung jawab berbeda.
6. Validation harus ditempatkan berdasarkan boundary dan trust zone.
7. Error harus machine-readable, aman, stabil, dan observable.
8. Validation bisa menjadi breaking change.
9. Untuk sistem regulatory, validation harus explainable dan auditable.
10. Engineer top-tier mendesain validation sebagai layered defense, bukan checklist annotation.

---

## 39. Referensi Resmi dan Bacaan Utama

Referensi berikut menjadi dasar seri ini dan akan dipakai lagi di part berikutnya:

1. Jakarta Validation 3.1 Specification — Eclipse Foundation / Jakarta EE.  
   <https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html>

2. Jakarta Validation 3.1 Release Page — Jakarta EE.  
   <https://jakarta.ee/specifications/bean-validation/3.1/>

3. Bean Validation / Jakarta Validation official site.  
   <https://beanvalidation.org/>

4. Bean Validation 2.0 / JSR 380 official page.  
   <https://beanvalidation.org/2.0-jsr380/>

5. Jakarta Validation 3.1 announcement and changes.  
   <https://beanvalidation.org/news/2025/02/17/bean-validation-3-1/>

6. Hibernate Validator Reference Documentation.  
   <https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/>

7. Hibernate Validator project repository.  
   <https://github.com/hibernate/hibernate-validator>

8. Hibernate Validator 9.0.0.Final announcement.  
   <https://in.relation.to/2025/05/20/hibernate-validator-9-0-0-Final/>

9. OpenJDK JDK 25 project page.  
   <https://openjdk.org/projects/jdk/25/>

---

## 40. Status Seri

Seri belum selesai.

Status saat ini:

```text
[x] Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
[ ] Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, javax vs jakarta
[ ] Part 002 — Core API Mental Model
[ ] ...
[ ] Part 030 — Capstone
```

Kita belum mencapai bagian terakhir.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime-part-031](../servlet/learn-java-servlet-websocket-web-container-runtime-part-031.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-001](./learn-java-validation-jakarta-hibernate-validator-part-001.md)

</div>