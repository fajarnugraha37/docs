# learn-java-validation-jakarta-hibernate-validator-part-005

# Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `005`  
> Topik: Cascaded Validation, Object Graphs, Aggregates, dan Boundary Control  
> Target: Java 8 sampai Java 25, Bean Validation 2.0, Jakarta Validation 3.x, Hibernate Validator 6.x sampai 9.x

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami `@Valid` bukan sebagai “validasi otomatis semua hal”, tetapi sebagai instruksi eksplisit untuk masuk ke object graph tertentu.
2. Membedakan constraint lokal pada object dengan cascaded validation terhadap object lain.
3. Mendesain DTO graph yang aman divalidasi tanpa menciptakan traversal graph yang liar.
4. Menghindari jebakan umum saat `@Valid` dipasang pada entity JPA/Hibernate ORM.
5. Memahami validasi collection, map, optional, nested object, dan container element.
6. Membedakan validation boundary dengan aggregate boundary dalam domain-driven design.
7. Menghindari performance issue, lazy loading issue, dan validation scope yang tidak terkendali.
8. Mendesain validation layer yang cocok untuk API, command, workflow, persistence, dan event.

---

## 1. Mental Model Utama

Cascaded validation adalah mekanisme untuk mengatakan:

> “Object ini tidak cukup divalidasi hanya dari constraint field primitifnya. Beberapa field-nya adalah object lain yang juga memiliki constraint sendiri, dan saya ingin validator masuk ke object tersebut.”

Tanpa `@Valid`, validator hanya melihat constraint pada object saat ini.

Dengan `@Valid`, validator boleh menelusuri object graph.

Contoh sederhana:

```java
public final class CreateApplicantRequest {

    @NotBlank
    private String name;

    @Valid
    @NotNull
    private AddressRequest address;
}

public final class AddressRequest {

    @NotBlank
    private String postalCode;

    @NotBlank
    private String streetName;
}
```

Ketika `CreateApplicantRequest` divalidasi:

- `name` dicek karena constraint ada di object utama.
- `address` dicek tidak null karena `@NotNull` ada di field `address`.
- `postalCode` dan `streetName` pada `AddressRequest` hanya dicek karena ada `@Valid` pada `address`.

Tanpa `@Valid`, object `address` boleh saja berisi `postalCode = null` dan validator tidak akan masuk ke dalamnya.

---

## 2. Constraint Lokal vs Cascaded Validation

Ada dua jenis validation yang harus dipisahkan secara mental.

### 2.1 Constraint Lokal

Constraint lokal mengevaluasi nilai field/property itu sendiri.

```java
public final class ApplicationRequest {

    @NotBlank
    private String applicationNo;

    @Size(max = 1000)
    private String remarks;
}
```

Di sini validator tidak perlu menelusuri object lain.

### 2.2 Cascaded Validation

Cascaded validation mengevaluasi object lain yang direferensikan oleh field/property.

```java
public final class ApplicationRequest {

    @Valid
    private ApplicantRequest applicant;
}
```

`@Valid` bukan constraint seperti `@NotNull`. `@Valid` tidak mengatakan object wajib ada. `@Valid` hanya mengatakan:

> “Jika nilainya ada, validate object itu juga.”

Maka ini:

```java
@Valid
private ApplicantRequest applicant;
```

berbeda dari ini:

```java
@NotNull
@Valid
private ApplicantRequest applicant;
```

Versi pertama:

- `applicant == null` valid.
- Jika `applicant != null`, isi `applicant` divalidasi.

Versi kedua:

- `applicant == null` invalid.
- Jika `applicant != null`, isi `applicant` divalidasi.

Ini prinsip penting: **requiredness dan cascade adalah dua hal berbeda**.

---

## 3. Kenapa Cascaded Validation Penting

Tanpa cascaded validation, nested request bisa lolos walaupun object dalamnya rusak.

Misalnya API menerima payload:

```json
{
  "applicant": {
    "name": "",
    "email": "not-an-email"
  }
}
```

DTO:

```java
public final class SubmitApplicationRequest {

    private ApplicantRequest applicant;
}

public final class ApplicantRequest {

    @NotBlank
    private String name;

    @Email
    private String email;
}
```

Jika controller hanya menjalankan:

```java
validator.validate(request);
```

maka constraint di dalam `ApplicantRequest` tidak dicek, karena field `applicant` tidak diberi `@Valid`.

DTO harus menjadi:

```java
public final class SubmitApplicationRequest {

    @NotNull
    @Valid
    private ApplicantRequest applicant;
}
```

Dengan begitu, validator masuk ke `ApplicantRequest` dan menghasilkan violation seperti:

```text
applicant.name must not be blank
applicant.email must be a well-formed email address
```

---

## 4. `@Valid` pada Single Object

Pola paling dasar:

```java
public final class RegisterCompanyRequest {

    @NotBlank
    private String companyName;

    @NotNull
    @Valid
    private CompanyIdentifierRequest identifier;
}

public final class CompanyIdentifierRequest {

    @NotBlank
    private String type;

    @NotBlank
    private String value;
}
```

Rule yang terbentuk:

1. `companyName` wajib tidak blank.
2. `identifier` wajib tidak null.
3. Jika `identifier` ada, isi `identifier` juga harus valid.
4. `identifier.type` wajib tidak blank.
5. `identifier.value` wajib tidak blank.

Secara mental, validator membangun traversal seperti ini:

```text
RegisterCompanyRequest
 ├─ companyName                  validate local constraint
 └─ identifier                   validate @NotNull
     └─ CompanyIdentifierRequest validate because @Valid
        ├─ type                  validate local constraint
        └─ value                 validate local constraint
```

---

## 5. `@Valid` pada Collection

### 5.1 Legacy Style Java 8 / Bean Validation 1.x Style

Sebelum container element constraints menjadi umum, pola yang sering dipakai:

```java
public final class BatchCreateRequest {

    @NotEmpty
    @Valid
    private List<CreateItemRequest> items;
}
```

Maknanya:

- `items` tidak boleh null atau empty karena `@NotEmpty`.
- Isi `items` akan divalidasi karena `@Valid`.

Namun style ini kurang presisi secara semantik. `@Valid` ditempel di container field, padahal niat sebenarnya adalah men-cascade elemen di dalam container.

### 5.2 Container Element Style

Bean Validation 2.0 memperkenalkan container element constraints dan type-use constraints.

Pola modern:

```java
public final class BatchCreateRequest {

    @NotEmpty
    private List<@Valid CreateItemRequest> items;
}
```

Ini lebih eksplisit:

> `items` adalah list yang tidak boleh kosong, dan setiap element di dalam list harus divalidasi.

Untuk element scalar:

```java
public final class TagRequest {

    @Size(max = 20)
    private List<@NotBlank @Size(max = 50) String> tags;
}
```

Maknanya:

- Jumlah tag maksimal 20.
- Setiap tag tidak boleh blank.
- Setiap tag maksimal 50 karakter.

Bedakan:

```java
@Size(max = 20)
private List<String> tags;
```

Dengan:

```java
private List<@Size(max = 20) String> tags;
```

Yang pertama membatasi ukuran list.  
Yang kedua membatasi ukuran setiap string di dalam list.

Untuk clarity, sering kali dua-duanya diperlukan:

```java
@Size(max = 20)
private List<@NotBlank @Size(max = 50) String> tags;
```

---

## 6. `@Valid` pada Map

Map punya dua dimensi:

1. key,
2. value.

Contoh:

```java
public final class LocalizedTextRequest {

    @NotEmpty
    private Map<
        @NotBlank @Pattern(regexp = "[a-z]{2}(-[A-Z]{2})?") String,
        @NotBlank @Size(max = 500) String
    > textByLocale;
}
```

Maknanya:

- Map tidak boleh kosong.
- Key harus berupa locale code sederhana.
- Value harus teks yang tidak blank dan maksimal 500 karakter.

Untuk value berupa object:

```java
public final class CasePartyMapRequest {

    @NotEmpty
    private Map<@NotBlank String, @Valid PartyRequest> partiesByRole;
}
```

Violation path dapat mengandung map key, misalnya:

```text
partiesByRole[APPLICANT].name
```

atau, tergantung provider/framework mapping:

```text
partiesByRole<map value>[APPLICANT].name
```

Hal ini penting untuk API error mapping. Jangan menganggap path violation selalu sesederhana `field.subfield`.

---

## 7. `@Valid` pada Optional

`Optional` didukung sejak Bean Validation 2.0 sebagai container.

Contoh:

```java
public final class NotificationPreferenceRequest {

    private Optional<@Email String> backupEmail;
}
```

Maknanya:

- Optional boleh kosong.
- Jika ada value, value harus email valid.

Untuk object:

```java
public final class OptionalRepresentativeRequest {

    private Optional<@Valid RepresentativeRequest> representative;
}
```

Namun, seperti dibahas di part nullability, `Optional` sebagai field DTO sering bukan pilihan terbaik. Untuk request body, `Optional` sering mencampuradukkan:

- field absent,
- explicit null,
- empty optional,
- value present.

Untuk partial update, model presence-aware biasanya lebih jujur daripada `Optional` field.

---

## 8. Nested Container

Validasi dapat masuk ke nested containers.

Contoh:

```java
public final class MatrixRequest {

    private List<@NotEmpty List<@NotNull @Positive Integer>> scores;
}
```

Maknanya:

- `scores` boleh null kecuali diberi `@NotNull`.
- Setiap inner list tidak boleh empty.
- Setiap integer di dalam inner list harus non-null dan positive.

Lebih realistis:

```java
public final class BulkCaseAssignmentRequest {

    @NotEmpty
    private Map<
        @NotBlank String,
        @NotEmpty List<@Valid AssignmentRequest>
    > assignmentsByOfficerId;
}
```

Maknanya:

- Map tidak boleh kosong.
- Officer id tidak boleh blank.
- Setiap officer harus memiliki list assignment tidak kosong.
- Setiap assignment object divalidasi.

Ini powerful, tetapi harus dipakai hati-hati. Nested validation yang terlalu dalam membuat error path rumit dan payload sulit dipahami.

---

## 9. Object Graph Traversal

Cascaded validation mengubah validasi dari “cek object ini” menjadi “traverse graph mulai dari object ini”.

Contoh:

```java
public final class ApplicationRequest {

    @NotBlank
    private String applicationType;

    @NotNull
    @Valid
    private ApplicantRequest applicant;

    @Valid
    private List<@Valid DocumentRequest> documents;
}
```

Traversal:

```text
ApplicationRequest
 ├─ applicationType
 ├─ applicant
 │   ├─ name
 │   ├─ email
 │   └─ address
 │       ├─ postalCode
 │       └─ blockNo
 └─ documents[0]
     ├─ documentType
     └─ fileId
```

Setiap `@Valid` memperluas scope traversal.

Karena itu, pertanyaan desain utama bukan:

> “Apakah saya bisa menaruh `@Valid` di sini?”

Tetapi:

> “Apakah object ini memang bagian dari validation boundary yang sama?”

---

## 10. Boundary Control

Cascaded validation harus dikendalikan oleh boundary.

Boundary adalah batas konseptual tempat sebuah object dianggap lengkap untuk divalidasi.

Contoh boundary:

1. HTTP request body.
2. Command object.
3. Domain aggregate root.
4. Imported row dari CSV.
5. Inbound event payload.
6. Outbound integration message.
7. Workflow transition request.

DTO API biasanya aman untuk cascaded validation karena graph-nya disengaja kecil.

Entity graph JPA sering tidak aman karena graph-nya bisa luas, lazy, cyclic, dan terhubung ke seluruh database domain.

---

## 11. DTO Graph vs Entity Graph

### 11.1 DTO Graph

DTO graph biasanya:

- dibuat dari request payload,
- shallow atau bounded,
- tidak punya lazy loading,
- tidak terhubung ke persistence context,
- sengaja merepresentasikan satu operation.

Contoh aman:

```java
public final class SubmitAppealRequest {

    @NotBlank
    private String caseId;

    @NotBlank
    @Size(max = 4000)
    private String reason;

    @Valid
    @Size(max = 10)
    private List<@Valid AttachmentRequest> attachments;
}
```

Ini graph yang jelas:

```text
SubmitAppealRequest
 └─ attachments[0..10]
```

### 11.2 Entity Graph

Entity graph sering:

- punya relationship bidirectional,
- punya lazy association,
- terhubung ke banyak aggregate,
- punya lifecycle yang berbeda,
- tidak selalu fully initialized,
- bisa memicu query saat diakses.

Contoh berbahaya:

```java
@Entity
public class CaseEntity {

    @OneToMany(mappedBy = "caseEntity")
    @Valid
    private List<TaskEntity> tasks;
}

@Entity
public class TaskEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @Valid
    private CaseEntity caseEntity;
}
```

Ini berpotensi membentuk cycle:

```text
CaseEntity
 └─ tasks
     └─ TaskEntity
         └─ caseEntity
             └─ tasks
                 └─ ...
```

Provider validation biasanya memiliki mekanisme mencegah infinite loop berdasarkan object identity/path tertentu, tetapi desain seperti ini tetap buruk karena scope validation menjadi tidak jelas dan bisa sangat mahal.

Prinsipnya:

> Jangan menaruh `@Valid` pada entity relationship hanya karena “ingin semua entity valid”.

---

## 12. Cycle Handling

Object graph bisa cyclic.

Contoh:

```java
public final class ParentRequest {

    @Valid
    private List<ChildRequest> children;
}

public final class ChildRequest {

    @Valid
    private ParentRequest parent;
}
```

Ini jarang masuk akal untuk DTO request, tetapi sering terjadi di entity.

Validation provider perlu mencegah infinite recursion. Namun, sebagai architect, jangan bergantung pada cycle handling untuk membenarkan graph desain yang buruk.

Cycle dalam validation biasanya sinyal bahwa:

1. DTO terlalu mirip entity.
2. Boundary request tidak jelas.
3. Aggregate boundary bocor.
4. Object reference dipakai sebagai shortcut daripada id/reference.
5. Validation scope tidak sengaja melebar.

DTO yang lebih sehat:

```java
public final class ChildRequest {

    @NotBlank
    private String parentId;
}
```

atau:

```java
public final class ParentRequest {

    @Valid
    private List<@Valid ChildRequest> children;
}

public final class ChildRequest {

    @NotBlank
    private String name;
}
```

Tanpa back-reference.

---

## 13. Aggregate Boundary

Dalam domain-driven design, aggregate adalah consistency boundary.

Cascaded validation harus mengikuti aggregate boundary, bukan database relationship boundary.

Misalnya aggregate `Application`:

```text
Application
 ├─ Applicant
 ├─ DeclaredAddress
 ├─ SupportingDocument
 └─ Declaration
```

Jika semua child tersebut bagian dari aggregate yang sama dan dikirim dalam satu command, cascaded validation masuk akal.

```java
public final class SubmitApplicationCommand {

    @NotNull
    @Valid
    private Applicant applicant;

    @NotNull
    @Valid
    private DeclaredAddress address;

    @Size(max = 20)
    private List<@Valid SupportingDocument> documents;

    @NotNull
    @Valid
    private Declaration declaration;
}
```

Tetapi jangan melakukan ini:

```java
public final class SubmitApplicationCommand {

    @NotNull
    @Valid
    private Applicant applicant;

    @NotNull
    @Valid
    private Officer assignedOfficer;

    @NotNull
    @Valid
    private Agency agency;
}
```

Kalau `Officer` dan `Agency` adalah external aggregate/reference, command cukup membawa referensi:

```java
public final class SubmitApplicationCommand {

    @NotNull
    @Valid
    private Applicant applicant;

    @NotBlank
    private String assignedOfficerId;

    @NotBlank
    private String agencyCode;
}
```

Lalu validasi existence/authorization/context dilakukan di application service atau domain policy, bukan cascaded Bean Validation.

---

## 14. Rule of Thumb: Validate Owned Data, Reference External Data

Gunakan `@Valid` untuk data yang “dimiliki” oleh payload/command.

Gunakan id/reference untuk data yang “dirujuk” dari luar.

### 14.1 Owned Data

```java
public final class CreateCompanyRequest {

    @NotBlank
    private String companyName;

    @NotNull
    @Valid
    private RegisteredAddressRequest registeredAddress;
}
```

`registeredAddress` adalah data yang dikirim dan dimiliki oleh request. `@Valid` cocok.

### 14.2 Referenced Data

```java
public final class AssignOfficerRequest {

    @NotBlank
    private String caseId;

    @NotBlank
    private String officerId;
}
```

`caseId` dan `officerId` menunjuk entity yang sudah ada. Jangan masukkan full `CaseEntity` dan `OfficerEntity` lalu `@Valid` semua.

---

## 15. `@Valid` dan Lazy Loading

Pada JPA/Hibernate ORM, association bisa lazy.

```java
@Entity
public class CaseEntity {

    @OneToMany(fetch = FetchType.LAZY)
    @Valid
    private List<DocumentEntity> documents;
}
```

Jika validation mencoba mengakses `documents`, ada beberapa risiko:

1. Lazy collection terinisialisasi dan memicu query.
2. Terjadi N+1 query.
3. Terjadi `LazyInitializationException` jika persistence context sudah tertutup.
4. Validation menjadi tergantung pada fetch plan.
5. Validasi entity menjadi tidak deterministik.

Validation seharusnya deterministic. Jika hasil atau biaya validasi bergantung pada association mana yang sedang initialized, desainnya bermasalah.

Lebih aman:

- Validasi request/command DTO sebelum entity dibuat/diubah.
- Validasi local invariant entity, bukan seluruh relational graph.
- Gunakan database constraint untuk final persistence consistency.
- Gunakan domain service/policy untuk cross-aggregate check.

---

## 16. `@Valid` dan JPA Lifecycle Validation

JPA dapat terintegrasi dengan Bean/Jakarta Validation pada lifecycle seperti pre-persist dan pre-update.

Ini berguna untuk constraint lokal entity:

```java
@Entity
public class ApplicantEntity {

    @NotBlank
    private String name;

    @Email
    private String email;
}
```

Tetapi berbahaya jika entity relationship diberi cascade validation luas:

```java
@Entity
public class ApplicationEntity {

    @OneToMany
    @Valid
    private List<DocumentEntity> documents;
}
```

Saat flush, validator bisa mencoba memvalidasi graph besar yang tidak kamu rencanakan.

Masalah yang sering muncul:

1. Flush gagal karena child entity lama tidak valid menurut rule baru.
2. Update satu field kecil gagal karena relationship lain ikut divalidasi.
3. Migration data legacy menjadi sulit.
4. Batch job menjadi lambat.
5. Persistence operation punya side-effect validasi yang tidak jelas.

Prinsip:

> Entity lifecycle validation cocok untuk invariant lokal yang stabil, bukan workflow/context-specific validation.

---

## 17. Cascaded Validation dan Validation Groups

`@Valid` akan meneruskan group yang sedang divalidasi ke object di bawahnya.

Contoh:

```java
public interface Submit {}
public interface Draft {}

public final class ApplicationRequest {

    @NotNull(groups = Submit.class)
    @Valid
    private ApplicantRequest applicant;
}

public final class ApplicantRequest {

    @NotBlank(groups = Submit.class)
    private String name;

    @Email(groups = {Draft.class, Submit.class})
    private String email;
}
```

Jika dipanggil:

```java
validator.validate(request, Submit.class);
```

maka constraint group `Submit` di `ApplicantRequest` juga dievaluasi.

Ini berguna, tetapi bisa membuat rule sulit dilacak jika group terlalu banyak.

Pada graph besar, pertanyaan review:

1. Group apa yang sedang aktif?
2. Apakah group itu meaningful untuk semua nested object?
3. Apakah nested object punya semantic operation yang sama?
4. Apakah ada child yang seharusnya menggunakan group berbeda?

Kalau jawaban tidak jelas, desain group kemungkinan sudah terlalu kompleks.

---

## 18. Group Conversion

Kadang parent dan child memiliki group taxonomy berbeda.

Misalnya parent divalidasi dengan group `SubmitApplication`, tetapi child `AddressRequest` punya group `CompleteAddress`.

Jakarta Validation menyediakan konsep group conversion dengan `@ConvertGroup`.

Contoh:

```java
public interface SubmitApplication {}
public interface CompleteAddress {}

public final class ApplicationRequest {

    @Valid
    @ConvertGroup(from = SubmitApplication.class, to = CompleteAddress.class)
    private AddressRequest address;
}

public final class AddressRequest {

    @NotBlank(groups = CompleteAddress.class)
    private String postalCode;

    @NotBlank(groups = CompleteAddress.class)
    private String streetName;
}
```

Saat parent divalidasi dengan `SubmitApplication`, child `address` divalidasi menggunakan `CompleteAddress`.

Group conversion berguna untuk boundary translation, tetapi jangan dipakai berlebihan. Jika setiap edge dalam object graph punya group conversion, validation model menjadi graph rule engine terselubung.

---

## 19. Cascaded Validation pada Method Parameter dan Return Value

Cascaded validation tidak hanya untuk bean property. Ia juga bisa diterapkan pada method parameter dan return value dalam executable validation.

Contoh service method:

```java
public interface ApplicationService {

    void submit(@NotNull @Valid SubmitApplicationCommand command);

    @NotNull
    @Valid
    ApplicationResult getApplication(@NotBlank String applicationId);
}
```

Maknanya:

- Parameter `command` tidak boleh null dan isinya divalidasi.
- Return value `ApplicationResult` tidak boleh null dan isinya divalidasi.

Namun, return value validation perlu hati-hati. Ia bagus untuk internal contract, tetapi jangan sampai:

1. Validasi response besar menjadi mahal.
2. Lazy field di response/entity terakses.
3. Error internal bocor sebagai response 500 yang tidak jelas.

Return value validation lebih cocok untuk:

- library/internal component contract,
- generated client/server model,
- strict boundary antara layer,
- defensive development.

Untuk hot path API response besar, gunakan secara selektif.

---

## 20. `@Valid` Tidak Sama dengan Deep Copy, Sanitization, atau Authorization

Kesalahan umum: mengira jika object sudah `@Valid`, maka object aman digunakan.

Tidak selalu.

`@Valid` hanya mengecek constraint yang dideklarasikan.

Ia tidak otomatis:

- menghapus script tag,
- melakukan HTML encoding,
- memastikan user boleh mengakses resource,
- memastikan id yang direferensikan exist,
- memastikan transition state valid,
- memastikan database tidak berubah sejak request dibuat,
- mencegah race condition,
- memvalidasi file content,
- menjamin uniqueness.

Contoh:

```java
public final class AssignCaseRequest {

    @NotBlank
    private String caseId;

    @NotBlank
    private String officerId;
}
```

DTO valid tidak berarti:

- case exists,
- officer exists,
- actor boleh assign case,
- case sedang dalam state assignable,
- officer berada dalam agency yang benar,
- assignment tidak melanggar workload limit.

Itu adalah domain/application validation, bukan Bean Validation shape check.

---

## 21. Validation Boundary per Layer

### 21.1 API Request Boundary

Tujuan:

- payload syntactically valid,
- required fields ada,
- nested DTO valid,
- size limit aman,
- format dasar benar.

Cascaded validation cocok.

```java
@PostMapping("/applications")
public ResponseEntity<?> submit(@Valid @RequestBody SubmitApplicationRequest request) {
    // shape sudah dicek
}
```

### 21.2 Command Boundary

Tujuan:

- command lengkap untuk use case,
- operation-specific constraints,
- nested value object valid.

Cascaded validation cocok jika command graph bounded.

### 21.3 Domain Aggregate Boundary

Tujuan:

- invariant aggregate terjaga,
- child owned object valid,
- external reference tidak divalidasi secara deep.

Cascaded validation bisa dipakai, tetapi jangan menggantikan constructor/factory invariant.

### 21.4 Persistence Boundary

Tujuan:

- entity local constraints,
- database final consistency.

Cascaded validation harus sangat selektif.

### 21.5 Workflow Boundary

Tujuan:

- state transition valid,
- actor valid,
- SLA/deadline valid,
- regulatory rule terpenuhi.

Cascaded Bean Validation hanya sebagian kecil. Workflow guard/domain policy lebih tepat.

---

## 22. DTO Design Pattern untuk Cascaded Validation

### 22.1 Good Pattern: Operation-Specific Request DTO

```java
public final class SubmitApplicationRequest {

    @NotBlank
    private String applicationType;

    @NotNull
    @Valid
    private ApplicantRequest applicant;

    @NotNull
    @Valid
    private AddressRequest declaredAddress;

    @Size(max = 20)
    private List<@Valid SupportingDocumentRequest> supportingDocuments;
}
```

Kelebihan:

- graph bounded,
- rule kelihatan,
- tidak tergantung persistence,
- error path cocok untuk UI,
- mudah dites.

### 22.2 Bad Pattern: Reusing Entity as Request

```java
@PostMapping("/applications")
public void submit(@Valid @RequestBody ApplicationEntity entity) {
    // bad idea
}
```

Masalah:

- exposes persistence model,
- relationship graph bocor,
- field internal bisa diisi client,
- validation rule bercampur dengan DB mapping,
- migration sulit,
- security risk.

### 22.3 Better Mapping

```java
@PostMapping("/applications")
public void submit(@Valid @RequestBody SubmitApplicationRequest request) {
    SubmitApplicationCommand command = mapper.toCommand(request);
    applicationService.submit(command);
}
```

Boundary jelas:

```text
HTTP JSON -> Request DTO validation -> Command mapping -> Domain policy -> Entity persistence
```

---

## 23. Cascaded Validation dan API Error Path

Nested validation menghasilkan nested error path.

Payload:

```json
{
  "applicant": {
    "name": "",
    "address": {
      "postalCode": ""
    }
  },
  "documents": [
    { "fileId": "", "type": "PDF" }
  ]
}
```

Violations bisa menjadi:

```text
applicant.name
applicant.address.postalCode
documents[0].fileId
```

API error response sebaiknya mempertahankan path yang machine-readable:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "violations": [
    {
      "path": "applicant.name",
      "code": "NotBlank",
      "message": "Applicant name is required"
    },
    {
      "path": "applicant.address.postalCode",
      "code": "NotBlank",
      "message": "Postal code is required"
    },
    {
      "path": "documents[0].fileId",
      "code": "NotBlank",
      "message": "Document file id is required"
    }
  ]
}
```

Untuk FE, nested path sangat penting agar error bisa ditempel ke field yang tepat.

---

## 24. Container Error Path Design

Untuk list:

```java
private List<@Valid DocumentRequest> documents;
```

Path ideal:

```text
documents[2].fileId
```

Untuk map:

```java
private Map<@NotBlank String, @Valid PartyRequest> partiesByRole;
```

Path ideal:

```text
partiesByRole[APPLICANT].name
```

Tetapi provider/framework dapat memberi path internal lebih detail seperti:

```text
partiesByRole<K>[APPLICANT]
partiesByRole[APPLICANT].<map value>.name
```

Karena itu, production API sebaiknya punya normalizer:

```java
public interface ViolationPathNormalizer {
    String normalize(Path path);
}
```

Tujuannya:

- menjaga FE contract stabil,
- menyembunyikan provider-specific representation,
- mendukung migration Hibernate Validator version,
- memisahkan internal path dari public API path.

---

## 25. Performance Cost Model

Cascaded validation punya cost lebih besar daripada field validation.

Biaya berasal dari:

1. Traversal object graph.
2. Reflection/metadata access.
3. Constraint validator invocation.
4. Container iteration.
5. Message interpolation.
6. Path construction.
7. Cascaded nested object allocation side-effect jika lazy access terjadi.
8. Possible dependency calls jika custom validators tidak pure.

Contoh risk:

```java
public final class BulkUploadRequest {

    @NotEmpty
    private List<@Valid RowRequest> rows;
}
```

Jika `rows` berisi 100.000 item, validation bisa mahal walaupun setiap row sederhana.

Mitigasi:

- batasi payload size,
- batasi collection size dengan `@Size(max = ...)`,
- validasi streaming/chunked untuk import besar,
- hindari expensive custom validator per row,
- gunakan fail-fast jika cocok,
- pisahkan syntactic validation dan asynchronous semantic validation.

---

## 26. Fail-Fast dan Cascaded Validation

Hibernate Validator mendukung fail-fast mode.

Fail-fast berarti validation berhenti setelah violation pertama.

Kelebihan:

- mengurangi cost,
- cocok untuk internal command/hot path,
- cocok saat hanya perlu tahu valid/tidak.

Kekurangan:

- buruk untuk UX form karena user hanya melihat satu error,
- tidak cocok untuk batch import yang butuh daftar semua error,
- tidak cocok untuk audit rejection yang perlu reason lengkap.

Untuk API form submission, biasanya lebih baik mengembalikan semua violation shape-level.

Untuk internal pipeline high-throughput, fail-fast bisa masuk akal.

---

## 27. Large Graph Validation Strategy

Jika graph besar, jangan langsung `@Valid` seluruh graph.

Gunakan strategi:

### 27.1 Bounded Graph

Pastikan graph validasi terbatas.

```java
@Size(max = 20)
private List<@Valid DocumentRequest> documents;
```

### 27.2 Shallow Reference

Gunakan id untuk external aggregate.

```java
@NotBlank
private String relatedCaseId;
```

bukan:

```java
@Valid
private CaseEntity relatedCase;
```

### 27.3 Chunked Validation

Untuk import:

```text
file -> parse row -> validate row -> collect row errors -> persist valid rows
```

Jangan deserialize seluruh file menjadi satu object graph besar lalu validate semua sekaligus.

### 27.4 Error Limit

Untuk bulk validation, batasi jumlah error.

```text
Stop after 1000 row-level errors.
Return summary + first N details.
```

### 27.5 Separate Shape and Semantic Validation

Shape validation:

- required field,
- format,
- max length,
- local consistency.

Semantic validation:

- reference exists,
- user authorized,
- workflow state valid,
- duplicate check.

---

## 28. Cascaded Validation dan Normalization

Urutan normalisasi penting.

Contoh input:

```json
{
  "applicant": {
    "name": "   Alice   ",
    "email": " ALICE@EXAMPLE.COM "
  }
}
```

Jika constraint:

```java
@NotBlank
private String name;

@Email
private String email;
```

Apakah trimming dilakukan sebelum validation?

Ada beberapa pilihan:

### 28.1 Normalize Before Validation

```text
raw request -> normalize -> validate -> command
```

Kelebihan:

- user-friendly,
- mengurangi false invalid,
- canonical form lebih awal.

Risiko:

- raw input hilang jika tidak diaudit,
- normalization bisa menyembunyikan input aneh,
- tidak cocok untuk field yang whitespace-significant.

### 28.2 Validate Before Normalize

```text
raw request -> validate -> normalize -> command
```

Kelebihan:

- strict,
- raw contract jelas.

Risiko:

- user experience buruk,
- banyak error trivial.

### 28.3 Recommended Practical Pattern

Untuk kebanyakan enterprise API:

```text
parse -> safe canonicalization for known fields -> validate -> map to command
```

Tetapi canonicalization harus eksplisit dan field-specific.

Jangan membuat global trim semua string tanpa governance.

---

## 29. Example: Production DTO Graph

Misalnya sistem menerima submission application.

```java
public final class SubmitApplicationRequest {

    @NotBlank
    @Size(max = 30)
    private String applicationType;

    @NotNull
    @Valid
    private ApplicantRequest applicant;

    @NotNull
    @Valid
    private ContactRequest contact;

    @NotNull
    @Valid
    private DeclarationRequest declaration;

    @Size(max = 20)
    private List<@Valid SupportingDocumentRequest> supportingDocuments;
}
```

Nested DTO:

```java
public final class ApplicantRequest {

    @NotBlank
    @Size(max = 200)
    private String name;

    @NotBlank
    @Size(max = 50)
    private String identifierType;

    @NotBlank
    @Size(max = 100)
    private String identifierValue;

    @Valid
    private AddressRequest registeredAddress;
}
```

```java
public final class ContactRequest {

    @Email
    @Size(max = 320)
    private String email;

    @Size(max = 30)
    private String phoneNo;
}
```

```java
public final class DeclarationRequest {

    @AssertTrue
    private boolean declaredTrueAndCorrect;

    @NotBlank
    @Size(max = 200)
    private String declaredBy;
}
```

```java
public final class SupportingDocumentRequest {

    @NotBlank
    private String documentType;

    @NotBlank
    private String fileId;

    @Size(max = 500)
    private String description;
}
```

Graph:

```text
SubmitApplicationRequest
 ├─ applicant
 │   └─ registeredAddress
 ├─ contact
 ├─ declaration
 └─ supportingDocuments[0..20]
```

Ini graph yang baik karena:

- bounded,
- tidak ada back-reference,
- tidak ada entity JPA,
- tidak ada external aggregate object,
- path error jelas,
- collection size dibatasi.

---

## 30. Example: Bad Production DTO Graph

```java
public final class SubmitApplicationRequest {

    @Valid
    private ApplicantEntity applicant;

    @Valid
    private CaseEntity relatedCase;

    @Valid
    private OfficerEntity assignedOfficer;

    @Valid
    private AgencyEntity agency;
}
```

Masalah:

1. Entity bocor ke API.
2. Client bisa mengirim field internal.
3. Cascaded validation bisa masuk ke relationship besar.
4. Lazy loading dan persistence concern masuk ke request validation.
5. `relatedCase`, `assignedOfficer`, dan `agency` seharusnya reference, bukan owned payload.
6. API contract menjadi tergantung struktur database.
7. Security risk meningkat.

Perbaikan:

```java
public final class SubmitApplicationRequest {

    @NotNull
    @Valid
    private ApplicantRequest applicant;

    @NotBlank
    private String relatedCaseId;

    @NotBlank
    private String assignedOfficerId;

    @NotBlank
    private String agencyCode;
}
```

Kemudian application service:

```java
public void submit(SubmitApplicationCommand command, Actor actor) {
    Case relatedCase = caseRepository.get(command.relatedCaseId());
    Officer officer = officerRepository.get(command.assignedOfficerId());
    Agency agency = agencyRepository.get(command.agencyCode());

    policy.ensureActorCanSubmit(actor, agency);
    policy.ensureCaseCanBeRelated(relatedCase);
    policy.ensureOfficerAssignable(officer, agency);

    // create aggregate
}
```

Bean Validation menjaga shape. Domain policy menjaga semantics.

---

## 31. When Not to Use Cascaded Validation

Jangan gunakan cascaded validation jika:

1. Object child bukan bagian dari input boundary yang sama.
2. Object child adalah entity existing dari database.
3. Relationship bisa lazy-load banyak data.
4. Relationship cyclic/bidirectional.
5. Validasi child membutuhkan actor/current user/context.
6. Validasi child membutuhkan transaction/database lookup.
7. Graph size tidak bounded.
8. Error path tidak bisa dipresentasikan ke user.
9. Child object punya lifecycle berbeda.
10. Rule child tergantung workflow state parent secara kompleks.

Gunakan alternatif:

- id/reference,
- command validator,
- domain policy,
- workflow guard,
- database constraint,
- event schema validation,
- specialized batch validator.

---

## 32. When Cascaded Validation Is Exactly Right

Gunakan cascaded validation jika:

1. Nested object benar-benar bagian dari payload.
2. Nested object adalah value object.
3. Nested object adalah child command.
4. Object graph kecil dan bounded.
5. Semua rule nested object bersifat lokal.
6. Error path dapat dikembalikan ke client.
7. Tidak ada lazy loading.
8. Tidak ada side effect.
9. Tidak butuh actor/security context.
10. Tidak butuh database lookup untuk mengecek validity dasar.

Contoh ideal:

```java
public final class CreatePersonRequest {

    @NotBlank
    private String fullName;

    @NotNull
    @Valid
    private BirthInfoRequest birthInfo;

    @Valid
    private List<@Valid ContactMethodRequest> contactMethods;
}
```

---

## 33. Cascaded Validation for Value Objects

Value object cocok untuk cascaded validation.

Contoh:

```java
public final class MoneyRequest {

    @NotNull
    @DecimalMin("0.00")
    private BigDecimal amount;

    @NotBlank
    @Pattern(regexp = "[A-Z]{3}")
    private String currency;
}
```

Dipakai di parent:

```java
public final class PaymentRequest {

    @NotBlank
    private String invoiceId;

    @NotNull
    @Valid
    private MoneyRequest amount;
}
```

Ini baik karena `MoneyRequest` adalah value object-like DTO. Ia tidak punya identity eksternal dan tidak punya lifecycle sendiri.

Domain-level bisa lebih kuat:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("amount must not be negative");
        }
    }
}
```

Bean Validation memvalidasi boundary input. Constructor menjaga domain invariant.

---

## 34. Cascaded Validation with Records

Java record cocok untuk immutable DTO modern.

```java
public record SubmitApplicationRequest(
    @NotBlank @Size(max = 30) String applicationType,
    @NotNull @Valid ApplicantRequest applicant,
    @Size(max = 20) List<@Valid SupportingDocumentRequest> supportingDocuments
) {}

public record ApplicantRequest(
    @NotBlank @Size(max = 200) String name,
    @Email @Size(max = 320) String email
) {}
```

Dengan records:

- constraint ditempatkan di record component,
- object immutable setelah dibuat,
- DTO lebih jelas sebagai data carrier,
- cocok untuk Java 16+ dan modern Java 21/25.

Namun tetap ingat:

- record constructor tidak otomatis menjalankan Bean Validation,
- framework biasanya menjalankan validation setelah deserialization/binding,
- domain invariant kritikal tetap sebaiknya dijaga di compact constructor/domain factory.

---

## 35. Cascaded Validation and Builder Pattern

Builder sering dipakai untuk object kompleks.

```java
public final class SubmitApplicationRequest {
    private final ApplicantRequest applicant;
    private final List<SupportingDocumentRequest> documents;

    private SubmitApplicationRequest(Builder builder) {
        this.applicant = builder.applicant;
        this.documents = List.copyOf(builder.documents);
    }

    public static final class Builder {
        private ApplicantRequest applicant;
        private List<SupportingDocumentRequest> documents = new ArrayList<>();

        public Builder applicant(ApplicantRequest applicant) {
            this.applicant = applicant;
            return this;
        }

        public Builder addDocument(SupportingDocumentRequest document) {
            this.documents.add(document);
            return this;
        }

        public SubmitApplicationRequest build() {
            return new SubmitApplicationRequest(this);
        }
    }
}
```

Bean Validation tidak otomatis berjalan saat `build()` kecuali kamu memanggilnya.

Pola yang bisa dipakai:

```java
public SubmitApplicationRequest build(Validator validator) {
    SubmitApplicationRequest request = new SubmitApplicationRequest(this);
    Set<ConstraintViolation<SubmitApplicationRequest>> violations = validator.validate(request);
    if (!violations.isEmpty()) {
        throw new ConstraintViolationException(violations);
    }
    return request;
}
```

Namun untuk domain object, jangan terlalu bergantung pada Bean Validation dalam builder. Domain invariant kritikal sebaiknya eksplisit di constructor/factory agar tidak bergantung pada caller untuk memanggil validator.

---

## 36. Cascaded Validation and External Services

Custom validators yang dipakai dalam cascaded graph sebaiknya tidak memanggil external service.

Contoh buruk:

```java
public final class ApplicantRequest {

    @ValidCustomerId // calls remote customer service
    private String customerId;
}
```

Jika ada 100 applicants dalam batch, validator bisa memanggil service 100 kali.

Masalah:

- latency tinggi,
- partial failure,
- retry storm,
- rate limit,
- nondeterministic validation,
- sulit dites,
- validation berubah menjadi integration workflow.

Lebih baik:

```java
public final class ApplicantRequest {

    @NotBlank
    private String customerId;
}
```

Lalu di application service:

```java
Customer customer = customerGateway.getCustomer(command.customerId());
policy.ensureCustomerEligible(customer);
```

Bean Validation: shape.  
Application service: reference and context.  
Domain policy: business rule.

---

## 37. Designing Safe Validation Graphs

Gunakan checklist berikut saat menambahkan `@Valid`.

### 37.1 Ownership

Tanya:

> Apakah child object ini dimiliki oleh parent dalam operation ini?

Jika ya, `@Valid` mungkin benar.

Jika child hanya reference ke object existing, gunakan id.

### 37.2 Size

Tanya:

> Berapa maksimum jumlah child?

Jika collection tidak punya max, tambahkan `@Size(max = ...)` atau validasi payload size di layer transport.

### 37.3 Depth

Tanya:

> Seberapa dalam validator akan masuk?

Graph 1–3 level biasanya wajar untuk DTO. Lebih dari itu perlu justifikasi.

### 37.4 Cycle

Tanya:

> Apakah ada back-reference?

Jika ada, pertimbangkan hapus dari DTO.

### 37.5 Lazy Loading

Tanya:

> Apakah object ini entity/proxy/lazy collection?

Jika ya, hindari cascaded validation.

### 37.6 Context

Tanya:

> Apakah rule child membutuhkan user/current role/current state/database?

Jika ya, jangan paksa ke Bean Validation cascade.

### 37.7 Error Ownership

Tanya:

> Jika child invalid, apakah user yang mengirim parent bisa memperbaikinya?

Jika tidak, jangan expose sebagai nested validation error.

---

## 38. Pattern: Request DTO to Command to Aggregate

Arsitektur umum yang sehat:

```text
HTTP JSON
  -> Request DTO
      -> Bean/Jakarta Validation with @Valid
          -> Mapper
              -> Command
                  -> Command Validation / Domain Policy
                      -> Aggregate Factory/Method
                          -> Entity Persistence
                              -> Database Constraint
```

Contoh:

```java
public record SubmitApplicationRequest(
    @NotBlank String applicationType,
    @NotNull @Valid ApplicantRequest applicant,
    @Size(max = 20) List<@Valid DocumentRequest> documents
) {}
```

Mapper:

```java
public SubmitApplicationCommand toCommand(SubmitApplicationRequest request) {
    return new SubmitApplicationCommand(
        ApplicationType.parse(request.applicationType()),
        toApplicant(request.applicant()),
        request.documents().stream().map(this::toDocument).toList()
    );
}
```

Application service:

```java
public void submit(SubmitApplicationCommand command, Actor actor) {
    policy.ensureActorCanSubmit(actor, command.applicationType());
    Application application = Application.submit(command);
    repository.save(application);
}
```

Setiap layer punya tugas validasi berbeda.

---

## 39. Pattern: Validation Error Accumulation

Cascaded validation naturalnya mengumpulkan violation.

Ini cocok untuk form submission:

```java
Set<ConstraintViolation<SubmitApplicationRequest>> violations = validator.validate(request);
```

Hasil:

```text
applicant.name: must not be blank
applicant.email: must be valid email
documents[3].fileId: must not be blank
```

Untuk domain policy, kamu mungkin butuh model serupa:

```java
public record RuleViolation(
    String code,
    String path,
    String message,
    Severity severity
) {}
```

Lalu gabungkan shape validation dan semantic validation secara terkendali:

```text
400 Validation Error
 ├─ shape violations from Jakarta Validation
 └─ semantic violations from domain policy
```

Namun jangan mencampur semuanya ke annotation. Gunakan common error model, bukan common validation mechanism untuk semua rule.

---

## 40. Pattern: Do Not Cascade Across Security Boundary

Misalnya actor mengirim:

```json
{
  "caseId": "CASE-001",
  "assignedOfficer": {
    "id": "OFFICER-001",
    "role": "ADMIN"
  }
}
```

Jika DTO menerima nested officer:

```java
public final class AssignCaseRequest {

    @NotBlank
    private String caseId;

    @Valid
    private OfficerRequest assignedOfficer;
}
```

Ini berbahaya karena client mengirim representasi officer.

Lebih aman:

```java
public final class AssignCaseRequest {

    @NotBlank
    private String caseId;

    @NotBlank
    private String assignedOfficerId;
}
```

Server mengambil officer dari trusted source.

Cascaded validation hanya boleh masuk ke data yang memang client berhak define.

---

## 41. Pattern: Cascaded Validation for Inbound Events

Inbound event payload juga bisa divalidasi dengan cascade.

```java
public record CaseSubmittedEvent(
    @NotBlank String eventId,
    @NotBlank String caseId,
    @NotNull Instant occurredAt,
    @NotNull @Valid SubmittedBy submittedBy,
    @NotNull @Valid CaseSnapshot snapshot
) {}
```

Namun event validation punya tambahan concern:

- schema version,
- producer compatibility,
- poison message,
- DLQ reason,
- partial tolerance,
- unknown fields,
- idempotency.

Cascaded Bean Validation cocok untuk shape dari deserialized event. Tetapi compatibility/versioning harus ditangani di event contract/schema layer.

---

## 42. Pattern: Cascaded Validation for Batch Import

Batch import sering punya row-level validation.

```java
public record ImportRequest(
    @NotBlank String importId,
    @NotEmpty List<@Valid ImportRow> rows
) {}
```

Untuk file kecil, ini cukup.

Untuk file besar, jangan validasi seluruh file sebagai satu object graph besar.

Lebih baik:

```text
read row 1 -> validate row -> collect result
read row 2 -> validate row -> collect result
...
```

Row DTO:

```java
public record ImportRow(
    @NotBlank String rowNo,
    @NotBlank String applicantName,
    @Email String email,
    @Valid AddressRow address
) {}
```

Batch result:

```java
public record ImportValidationResult(
    int totalRows,
    int validRows,
    int invalidRows,
    List<RowViolation> violations
) {}
```

Batasi jumlah violation detail agar response tidak terlalu besar.

---

## 43. Anti-Patterns

### 43.1 `@Valid` Everywhere

```java
@Valid
private Everything everything;
```

Masalah:

- validation scope tidak jelas,
- performance unpredictable,
- error path terlalu kompleks,
- graph traversal liar.

### 43.2 Entity as DTO

```java
public void create(@Valid @RequestBody UserEntity user) {}
```

Masalah:

- persistence model exposed,
- security risk,
- cascade entity graph,
- API contract rapuh.

### 43.3 Cascading to Reference Data

```java
@Valid
private Agency agency;
```

Padahal agency adalah master data. Gunakan `agencyCode`.

### 43.4 Cascading Bidirectional Relationship

```java
class Parent { @Valid List<Child> children; }
class Child { @Valid Parent parent; }
```

Masalah:

- cycle,
- ambiguity,
- graph besar.

### 43.5 DB Lookup Inside Cascaded Validator

```java
@ExistingCustomer
private String customerId;
```

Jika dipakai dalam list besar, bisa menjadi N+1 remote/database calls.

### 43.6 Workflow State in Nested Annotation

```java
@ValidForApproval
private Application application;
```

Jika rule approval butuh actor, role, state, SLA, evidence, dan policy version, gunakan workflow guard/domain policy.

---

## 44. Review Checklist untuk Pull Request

Saat melihat PR yang menambahkan `@Valid`, review dengan pertanyaan berikut:

1. Apakah field yang diberi `@Valid` adalah owned nested data?
2. Apakah field juga perlu `@NotNull`?
3. Apakah collection diberi batas `@Size(max = ...)`?
4. Apakah map key dan value constraints jelas?
5. Apakah nested object punya back-reference?
6. Apakah graph bisa mengandung entity/proxy/lazy collection?
7. Apakah constraint child butuh context/database/service?
8. Apakah error path bisa dimapping ke API response?
9. Apakah group yang digunakan parent masuk akal untuk child?
10. Apakah validation boundary sama dengan operation boundary?
11. Apakah external aggregate direpresentasikan sebagai id, bukan full object?
12. Apakah ada performance risk untuk payload besar?
13. Apakah validator deterministic dan side-effect-free?
14. Apakah violation tidak membocorkan PII?
15. Apakah ada test untuk nested invalid payload?

---

## 45. Testing Cascaded Validation

Minimal test untuk cascaded validation:

```java
class SubmitApplicationRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void shouldRejectInvalidNestedApplicant() {
        SubmitApplicationRequest request = new SubmitApplicationRequest(
            "NEW",
            new ApplicantRequest("", "not-an-email"),
            List.of()
        );

        Set<ConstraintViolation<SubmitApplicationRequest>> violations = validator.validate(request);

        assertThat(pathsOf(violations)).contains(
            "applicant.name",
            "applicant.email"
        );
    }
}
```

Test penting:

1. Parent valid, child invalid.
2. Parent child null dengan `@Valid` saja.
3. Parent child null dengan `@NotNull @Valid`.
4. List element invalid.
5. Map key invalid.
6. Map value invalid.
7. Nested object dua level.
8. Collection melebihi max size.
9. Error path sesuai API contract.
10. Tidak ada cascade ke external reference.

---

## 46. Practical Design Matrix

| Situation | Use `@Valid`? | Better Model |
|---|---:|---|
| Nested address inside create applicant request | Yes | `@NotNull @Valid AddressRequest` |
| List of uploaded document metadata | Yes | `@Size(max=N) List<@Valid DocumentRequest>` |
| Existing officer assigned by id | No | `@NotBlank officerId` |
| JPA `@ManyToOne AgencyEntity` | Usually no | validate `agencyCode`, load agency in service |
| Value object DTO like Money | Yes | `@NotNull @Valid MoneyRequest` |
| Large CSV import with 500k rows | Not as one graph | row-by-row validation |
| Workflow transition rule | Usually no | workflow guard/domain policy |
| Child entity in same aggregate | Maybe | explicit aggregate method/invariant |
| Response DTO contract | Maybe | selective return value validation |
| Event payload snapshot | Yes, bounded | validate event DTO + schema version |

---

## 47. Java 8 sampai Java 25 Notes

### Java 8

- Bean Validation 2.0 relevan karena mendukung Java 8 date/time dan container element constraints.
- Banyak codebase masih memakai `javax.validation`.
- DTO class biasa masih dominan.

### Java 11

- Banyak enterprise baseline masih Java 11 dengan Spring Boot 2.x atau early Jakarta migration.
- Hati-hati campuran `javax` dan `jakarta`.

### Java 17

- Baseline umum untuk Spring Boot 3 dan Jakarta EE 10/11 ecosystem.
- Records tersedia stabil.
- Hibernate Validator modern menggunakan Jakarta namespace.

### Java 21

- Records, sealed types, pattern matching style semakin natural.
- DTO immutable semakin direkomendasikan.
- Virtual threads tidak mengubah semantics validation, tetapi memperjelas pentingnya validator yang tidak melakukan blocking I/O sembarangan.

### Java 25

- Treat validation sebagai bagian dari modern correctness architecture.
- Gunakan immutable request/command model bila ecosystem mendukung.
- Hindari validator yang melakukan blocking remote call, terutama pada high-concurrency service.
- Namespace Jakarta menjadi arah modern; legacy `javax` tetap perlu dipahami untuk maintenance Java 8/11.

---

## 48. Decision Framework

Sebelum menaruh `@Valid`, gunakan urutan keputusan ini:

```text
1. Apakah field adalah object/container?
   └─ Tidak -> @Valid tidak relevan.

2. Apakah object/container bagian dari input/command boundary yang sama?
   └─ Tidak -> gunakan id/reference, jangan cascade.

3. Apakah child object punya constraint lokal yang harus dievaluasi?
   └─ Tidak -> @Valid tidak memberi nilai.

4. Apakah graph bounded dan tidak cyclic?
   └─ Tidak -> redesign DTO/graph.

5. Apakah validation tidak memicu lazy loading/DB/remote call?
   └─ Tidak -> pindahkan rule ke service/policy.

6. Apakah error path bisa dipakai client/user?
   └─ Tidak -> mungkin bukan Bean Validation boundary.

7. Apakah requiredness juga perlu?
   └─ Ya -> tambahkan @NotNull bersama @Valid.
```

---

## 49. Implementation Guideline

Untuk production-grade Java service:

1. Pakai `@Valid` di API boundary untuk nested DTO yang owned.
2. Tambahkan `@NotNull` jika nested object wajib ada.
3. Pakai container element constraints untuk collection/map element.
4. Batasi collection size.
5. Jangan cascade ke JPA relationship tanpa alasan sangat kuat.
6. Jangan gunakan entity sebagai request DTO.
7. Jangan lakukan DB/remote call dalam validator yang bisa dipanggil per element.
8. Pisahkan shape validation dari semantic/domain validation.
9. Normalize violation path sebelum diekspos ke API.
10. Test nested invalid payload secara eksplisit.
11. Pastikan validation graph mengikuti aggregate/operation boundary.
12. Dokumentasikan boundary: mana owned, mana referenced.

---

## 50. Key Takeaways

1. `@Valid` adalah instruksi traversal graph, bukan constraint requiredness.
2. `@Valid` harus sering dipasangkan dengan `@NotNull` jika child wajib ada.
3. Container element constraints membuat intent lebih presisi: `List<@Valid Item>` lebih jelas daripada hanya `@Valid List<Item>`.
4. Cascaded validation sangat cocok untuk DTO/value object graph yang bounded.
5. Cascaded validation berbahaya pada entity graph, lazy relationship, dan bidirectional association.
6. Aggregate boundary lebih penting daripada database relationship boundary.
7. External aggregate sebaiknya direpresentasikan sebagai id/reference, bukan full object dengan `@Valid`.
8. Bean Validation menjaga shape dan local invariant; workflow/domain policy menjaga contextual rule.
9. API error path dari cascaded validation harus dinormalisasi dan dijaga stabil.
10. Top-tier validation design bukan “validasi sebanyak mungkin”, tetapi “validasi di boundary yang tepat dengan scope yang terkendali”.

---

## 51. Latihan

### Latihan 1

Diberikan DTO:

```java
public final class CreateOrderRequest {
    @NotBlank
    private String customerId;

    @Valid
    private CustomerRequest customer;

    @Valid
    private List<OrderItemRequest> items;
}
```

Pertanyaan:

1. Apa yang salah dari model ini?
2. Apakah `customerId` dan `customer` boleh ada bersamaan?
3. Apakah `items` perlu `@NotEmpty`?
4. Bagaimana cara memperbaikinya?

### Latihan 2

Desain DTO untuk `SubmitCaseAppealRequest` dengan nested:

- appellant,
- contact,
- reason,
- attachments maksimal 10.

Tentukan mana yang `@NotNull`, mana yang `@Valid`, dan mana yang cukup scalar reference.

### Latihan 3

Ambil satu entity JPA dalam project nyata. Identifikasi relationship yang sebaiknya tidak diberi `@Valid`. Jelaskan alasannya dari sisi:

- lazy loading,
- aggregate boundary,
- performance,
- workflow semantics,
- migration risk.

### Latihan 4

Buat API error response model untuk violation path:

```text
applicant.address.postalCode
documents[3].fileId
partiesByRole[APPLICANT].name
```

Pastikan response FE-friendly dan tidak bergantung pada internal provider-specific path.

---

## 52. Referensi

- Jakarta Validation 3.1 Specification — metadata model dan API untuk JavaBean/method validation.
- Jakarta Validation 3.1 API — `jakarta.validation.Valid` dan constraint model.
- Bean Validation 2.0 / JSR 380 — container element constraints, Java 8 date/time support, Optional support.
- Hibernate Validator Reference Guide — cascaded validation, container element constraints, value extractors, fail-fast, provider-specific behavior.
- Hibernate Validator release documentation — version compatibility untuk Jakarta Validation 3.x dan Java baseline modern.

---

## 53. Status Seri

Seri belum selesai.

Bagian yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata
- Part 003 — Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse
- Part 004 — Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence
- Part 005 — Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control

Bagian berikutnya:

- Part 006 — Container Element Constraints: Lists, Maps, Optional, Custom Containers

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-004](./learn-java-validation-jakarta-hibernate-validator-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-006](./learn-java-validation-jakarta-hibernate-validator-part-006.md)

</div>