# learn-java-validation-jakarta-hibernate-validator-part-007

# Validation Groups: Operation-Specific Contracts without DTO Explosion

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `007`  
> Topik: Validation Groups, Default Group, Group Inheritance, Operation-Specific Validation, dan Design Governance  
> Target Java: Java 8 sampai Java 25  
> Namespace: `javax.validation` dan `jakarta.validation`  
> Provider utama: Hibernate Validator

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas constraint bawaan, nullability strategy, cascaded validation, dan container element constraints. Sekarang kita masuk ke salah satu fitur yang sering dipakai tetapi juga sering disalahgunakan: **validation groups**.

Validation group memungkinkan satu class memiliki constraint yang aktif hanya pada konteks tertentu, misalnya:

- create,
- update,
- submit,
- approve,
- publish,
- import,
- admin override,
- internal integration,
- external public API.

Contoh sederhana:

```java
public interface OnCreate {}
public interface OnUpdate {}

public class UserRequest {

    @Null(groups = OnCreate.class)
    @NotNull(groups = OnUpdate.class)
    private Long id;

    @NotBlank(groups = {OnCreate.class, OnUpdate.class})
    private String name;
}
```

Pada create, `id` harus `null`. Pada update, `id` harus ada. Ini terlihat praktis.

Namun fitur ini punya risiko besar:

- class menjadi penuh aturan tersembunyi,
- endpoint sulit dibaca,
- rule menyebar ke banyak marker interface,
- developer tidak tahu constraint mana aktif pada operasi tertentu,
- workflow rule dipaksa masuk ke annotation,
- validasi menjadi sulit dites dan sulit diaudit.

Target bagian ini bukan hanya memahami syntax group, tetapi membangun mental model: **validation group adalah alat untuk memilih contract shape berdasarkan konteks operasi, bukan workflow engine dan bukan pengganti domain policy.**

---

## 2. Core Mental Model

### 2.1 Tanpa Group: Semua Constraint Default Berlaku Saat Default Group Divalidasi

Constraint tanpa atribut `groups` masuk ke group `Default`.

```java
public class CreateCustomerRequest {

    @NotBlank
    private String fullName;

    @Email
    private String email;
}
```

Secara konseptual sama seperti:

```java
public class CreateCustomerRequest {

    @NotBlank(groups = Default.class)
    private String fullName;

    @Email(groups = Default.class)
    private String email;
}
```

`Default` berada di package:

```java
jakarta.validation.groups.Default
```

atau pada legacy stack:

```java
javax.validation.groups.Default
```

Saat kita memanggil:

```java
validator.validate(request);
```

maka yang divalidasi adalah `Default` group.

Sama secara konseptual dengan:

```java
validator.validate(request, Default.class);
```

---

### 2.2 Dengan Group: Constraint Hanya Aktif Jika Group-nya Diminta

```java
public interface OnCreate {}
public interface OnUpdate {}

public class CustomerRequest {

    @Null(groups = OnCreate.class)
    @NotNull(groups = OnUpdate.class)
    private Long id;

    @NotBlank(groups = {OnCreate.class, OnUpdate.class})
    private String fullName;
}
```

Jika dipanggil:

```java
validator.validate(request, OnCreate.class);
```

maka constraint yang aktif:

- `@Null(groups = OnCreate.class)` pada `id`,
- `@NotBlank(groups = OnCreate.class)` pada `fullName`.

Jika dipanggil:

```java
validator.validate(request, OnUpdate.class);
```

maka constraint yang aktif:

- `@NotNull(groups = OnUpdate.class)` pada `id`,
- `@NotBlank(groups = OnUpdate.class)` pada `fullName`.

Constraint tanpa group tidak otomatis ikut jika kita hanya meminta `OnCreate.class`, kecuali group design kita membuat `OnCreate` mewarisi `Default`, atau kita eksplisit memvalidasi `Default.class` juga.

Ini salah satu sumber bug paling umum.

---

## 3. Validation Group Bukan “Mode Object”, tetapi “Mode Evaluasi”

Sebuah object tidak “menjadi” `OnCreate` atau `OnUpdate`. Yang berubah adalah **cara validator mengevaluasi constraint**.

Object yang sama:

```java
CustomerRequest request = new CustomerRequest();
```

bisa divalidasi dengan beberapa konteks:

```java
validator.validate(request, OnCreate.class);
validator.validate(request, OnUpdate.class);
validator.validate(request, Import.class);
validator.validate(request, AdminOverride.class);
```

Artinya group bukan state object. Group adalah **validation lens**.

Mental model:

```text
Object data sama
        │
        ├── validate as Create contract
        ├── validate as Update contract
        ├── validate as Import contract
        └── validate as Admin override contract
```

Karena group adalah lens, maka gunakan untuk memilih **input contract**. Jangan gunakan untuk menyimpan lifecycle state domain.

Buruk:

```java
@NotBlank(groups = Draft.class)
@NotBlank(groups = Submitted.class)
@NotBlank(groups = Approved.class)
@NotBlank(groups = Rejected.class)
private String applicantName;
```

Ini mencampur validation group dengan state machine. State machine seharusnya punya guard/policy sendiri.

Lebih baik:

```text
Transport validation:
- apakah command memiliki field wajib?
- apakah format field benar?

Workflow guard:
- apakah case boleh submit dari state ini?
- apakah actor punya role yang benar?
- apakah mandatory assessment sudah lengkap?
- apakah evidence sudah tersedia?
```

---

## 4. Kenapa Validation Group Ada?

Validation group menyelesaikan masalah praktis: satu model kadang dipakai dalam beberapa operasi yang mirip, tetapi tidak identik.

Contoh:

```java
public class UserDto {

    private Long id;
    private String username;
    private String password;
    private String displayName;
}
```

Pada create:

- `id` harus tidak dikirim,
- `username` wajib,
- `password` wajib,
- `displayName` opsional.

Pada update profile:

- `id` wajib,
- `username` mungkin immutable,
- `password` tidak relevan,
- `displayName` opsional.

Pada change password:

- `id` wajib,
- `password` wajib,
- `username` tidak relevan,
- `displayName` tidak relevan.

Ada beberapa pilihan desain:

### Pilihan A: DTO Terpisah

```java
public record CreateUserRequest(
    @NotBlank String username,
    @NotBlank String password,
    String displayName
) {}

public record UpdateUserProfileRequest(
    @NotNull Long id,
    String displayName
) {}

public record ChangePasswordRequest(
    @NotNull Long id,
    @NotBlank String newPassword
) {}
```

Ini sering paling jelas.

### Pilihan B: Satu DTO dengan Validation Groups

```java
public interface Create {}
public interface UpdateProfile {}
public interface ChangePassword {}

public class UserRequest {

    @Null(groups = Create.class)
    @NotNull(groups = {UpdateProfile.class, ChangePassword.class})
    private Long id;

    @NotBlank(groups = Create.class)
    private String username;

    @NotBlank(groups = {Create.class, ChangePassword.class})
    private String password;

    private String displayName;
}
```

Ini mengurangi jumlah class, tetapi meningkatkan hidden complexity.

### Pilihan C: DTO Minimal + Domain/Command Validator

```java
public record UpdateUserCommand(
    UserId id,
    Optional<String> displayName,
    Optional<PasswordChange> passwordChange
) {}
```

Lalu rule dievaluasi di application service atau domain policy.

Pilihan terbaik tergantung stabilitas contract, jumlah operasi, kompleksitas rule, dan kebutuhan audit.

---

## 5. Kapan Group Cocok?

Validation group cocok ketika:

1. Object shape hampir sama di beberapa operasi.
2. Perbedaan requiredness sederhana.
3. Rule bersifat syntactic atau local semantic.
4. Jumlah konteks kecil dan stabil.
5. Tidak ada state machine kompleks.
6. Tidak ada dependency eksternal.
7. Tidak perlu rule versioning yang rumit.
8. Error contract masih mudah dijelaskan.

Contoh cocok:

```java
public interface Create {}
public interface Update {}

public class ProductRequest {

    @Null(groups = Create.class)
    @NotNull(groups = Update.class)
    private Long id;

    @NotBlank(groups = {Create.class, Update.class})
    private String name;

    @Positive(groups = {Create.class, Update.class})
    private BigDecimal price;
}
```

Ini masih sehat karena perbedaannya jelas.

---

## 6. Kapan Group Tidak Cocok?

Validation group tidak cocok ketika:

1. Rule bergantung pada database.
2. Rule bergantung pada actor/role/permission.
3. Rule bergantung pada current workflow state.
4. Rule bergantung pada waktu saat ini secara business-specific.
5. Rule punya side effect.
6. Rule perlu audit evidence.
7. Rule berubah berdasarkan tenant/regulasi/jurisdiction.
8. Rule perlu explainability tinggi.
9. Jumlah group mulai meledak.
10. Developer harus membuka 5 file untuk tahu rule create.

Contoh buruk:

```java
@NotBlank(groups = {
    DraftSubmitByOfficer.class,
    DraftSubmitBySupervisor.class,
    ResubmitAfterClarification.class,
    ApproveByDirector.class,
    ReopenByAdmin.class,
    EscalateToEnforcement.class
})
private String justification;
```

Ini bukan lagi input contract sederhana. Ini indikasi bahwa rule sudah menjadi workflow policy.

Lebih baik:

```text
DTO validation:
- justification max length
- justification blank/null basic rule if provided

Workflow policy:
- justification required when transition requires reason
- reason category must match action type
- actor must have role
- case must be in allowed source state
- mandatory assessment must be complete
```

---

## 7. Basic Syntax

### 7.1 Membuat Marker Interface

```java
public interface OnCreate {}
public interface OnUpdate {}
```

Marker interface tidak punya method. Ia hanya menjadi identifier group.

### 7.2 Menempelkan Constraint ke Group

```java
public class ApplicantRequest {

    @Null(groups = OnCreate.class)
    @NotNull(groups = OnUpdate.class)
    private Long id;

    @NotBlank(groups = {OnCreate.class, OnUpdate.class})
    private String name;
}
```

### 7.3 Memanggil Manual dengan Validator

```java
Set<ConstraintViolation<ApplicantRequest>> violations =
    validator.validate(request, OnCreate.class);
```

Multiple groups:

```java
Set<ConstraintViolation<ApplicantRequest>> violations =
    validator.validate(request, Default.class, OnCreate.class);
```

Catatan penting: jika beberapa group diminta sekaligus tanpa group sequence, jangan bergantung pada urutan evaluasinya.

---

## 8. Default Group: Sumber Banyak Bug

Perhatikan class ini:

```java
public interface OnCreate {}

public class RegisterRequest {

    @NotBlank
    private String username;

    @NotBlank(groups = OnCreate.class)
    private String password;
}
```

Jika dipanggil:

```java
validator.validate(request, OnCreate.class);
```

Apakah `username` divalidasi?

Tidak, jika hanya `OnCreate.class` yang diminta dan `OnCreate` tidak mencakup `Default`.

`@NotBlank` pada `username` masuk ke `Default`, bukan `OnCreate`.

Solusi eksplisit:

```java
validator.validate(request, Default.class, OnCreate.class);
```

Atau buat group inheritance:

```java
public interface OnCreate extends Default {}
```

Namun inheritance ini perlu digunakan secara disiplin.

---

## 9. Group Inheritance

Group bisa mewarisi group lain karena group adalah interface.

```java
public interface BasicChecks {}
public interface CreateChecks extends BasicChecks {}
public interface UpdateChecks extends BasicChecks {}
```

Constraint:

```java
public class CustomerRequest {

    @NotBlank(groups = BasicChecks.class)
    private String name;

    @Null(groups = CreateChecks.class)
    @NotNull(groups = UpdateChecks.class)
    private Long id;
}
```

Jika validasi `CreateChecks`, maka constraints di `BasicChecks` juga diperhitungkan karena `CreateChecks extends BasicChecks`.

Konseptual:

```text
CreateChecks
    └── BasicChecks
```

Ini bisa berguna untuk membangun taxonomy:

```java
public interface ApiInput {}
public interface Create extends ApiInput {}
public interface Update extends ApiInput {}
public interface Submit extends ApiInput {}
```

Namun hati-hati. Group inheritance mudah menjadi opaque.

Jika hierarchy menjadi seperti ini:

```text
ApproveByDirector
  └── Approve
      └── Submit
          └── Update
              └── BasicInput
                  └── Default
```

maka developer baru akan kesulitan mengetahui constraint apa yang aktif.

---

## 10. Design Pattern: Stable Group Taxonomy

Gunakan group taxonomy yang kecil dan stabil.

Contoh yang sehat:

```java
public final class ValidationGroups {
    private ValidationGroups() {}

    public interface Api {}

    public interface Create extends Api {}
    public interface Update extends Api {}
    public interface Patch extends Api {}
    public interface Submit extends Api {}

    public interface Import {}
    public interface Internal {}
}
```

Atau per bounded context:

```java
public final class ApplicationValidationGroups {
    private ApplicationValidationGroups() {}

    public interface Create {}
    public interface UpdateDraft {}
    public interface Submit {}
}
```

Hindari group dengan nama terlalu spesifik terhadap role, user, atau event kecil:

```java
// Hindari
public interface SubmitBySeniorOfficerAfterClarification {}
```

Nama seperti itu biasanya tanda rule sudah keluar dari validation group dan masuk ke workflow policy.

---

## 11. Operation-Specific Contract

Bayangkan sistem application/case management.

Kita punya operasi:

1. save draft,
2. submit application,
3. request clarification,
4. resubmit,
5. approve,
6. reject,
7. withdraw.

Tidak semua cocok dijadikan validation group.

### 11.1 Save Draft

Draft biasanya longgar:

```java
public interface DraftSave {}
```

Constraint:

```java
public class ApplicationDraftRequest {

    @Size(max = 300, groups = DraftSave.class)
    private String applicantName;

    @Email(groups = DraftSave.class)
    private String contactEmail;
}
```

Draft bisa punya format validation ringan tetapi tidak semua mandatory field wajib.

### 11.2 Submit Application

Submit lebih ketat:

```java
public interface Submit {}
```

```java
public class ApplicationDraftRequest {

    @NotBlank(groups = Submit.class)
    @Size(max = 300, groups = {DraftSave.class, Submit.class})
    private String applicantName;

    @NotBlank(groups = Submit.class)
    @Email(groups = {DraftSave.class, Submit.class})
    private String contactEmail;
}
```

Ini masuk akal: shape sama, requiredness berbeda.

### 11.3 Approve

Approve biasanya bukan validasi DTO yang sama. Approve adalah command berbeda:

```java
public record ApproveApplicationCommand(
    @NotNull Long applicationId,
    @NotBlank String decisionReason
) {}
```

Rule seperti:

- case harus di state `SUBMITTED`,
- officer tidak boleh approve case miliknya sendiri,
- semua assessment mandatory harus complete,
- no outstanding clarification,
- no unresolved risk flag,

lebih cocok di workflow/domain policy, bukan group annotation.

---

## 12. DTO Terpisah vs Validation Group

Ini keputusan arsitektural penting.

### 12.1 Gunakan DTO Terpisah Jika Contract Berbeda Signifikan

```java
public record CreateProductRequest(
    @NotBlank String name,
    @Positive BigDecimal price
) {}

public record UpdateProductRequest(
    @NotNull Long id,
    @NotBlank String name,
    @Positive BigDecimal price
) {}

public record PatchProductRequest(
    PatchField<@NotBlank String> name,
    PatchField<@Positive BigDecimal> price
) {}
```

Keunggulan:

- eksplisit,
- mudah dites,
- mudah didokumentasikan,
- lebih aman untuk API versioning,
- menghindari group explosion.

Kelemahan:

- lebih banyak class,
- ada duplikasi constraint,
- mapping lebih banyak.

### 12.2 Gunakan Group Jika Contract Hampir Sama

```java
public class ProductRequest {

    @Null(groups = Create.class)
    @NotNull(groups = Update.class)
    private Long id;

    @NotBlank(groups = {Create.class, Update.class})
    private String name;

    @Positive(groups = {Create.class, Update.class})
    private BigDecimal price;
}
```

Keunggulan:

- mengurangi class,
- cocok untuk simple CRUD,
- rule local tetap dekat dengan field.

Kelemahan:

- rule aktif tidak terlihat dari class saja,
- endpoint harus tahu group,
- dokumentasi lebih sulit,
- mudah menjadi terlalu kompleks.

### 12.3 Decision Rule

Gunakan panduan ini:

```text
Jika operasi hanya beda id required/null dan 1-2 field requiredness:
    validation group masih masuk akal.

Jika operasi punya field berbeda, semantic berbeda, lifecycle berbeda:
    DTO terpisah lebih baik.

Jika rule bergantung pada state/role/database/workflow:
    domain policy/workflow guard lebih baik.
```

---

## 13. Spring Integration: `@Valid` vs `@Validated`

Pada Spring, `@Valid` berasal dari Jakarta/Javax Validation. `@Validated` adalah annotation Spring yang mendukung group.

Contoh:

```java
@RestController
@RequestMapping("/users")
public class UserController {

    @PostMapping
    public ResponseEntity<?> create(
        @Validated(OnCreate.class) @RequestBody UserRequest request
    ) {
        return ResponseEntity.ok().build();
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(
        @Validated(OnUpdate.class) @RequestBody UserRequest request
    ) {
        return ResponseEntity.ok().build();
    }
}
```

Jika menggunakan:

```java
@Valid @RequestBody UserRequest request
```

maka biasanya yang aktif adalah `Default` group, bukan `OnCreate`/`OnUpdate`.

Untuk method validation pada service:

```java
@Validated
@Service
public class UserService {

    public void create(@Validated(OnCreate.class) UserRequest request) {
        // ...
    }
}
```

Namun detail behavior bisa dipengaruhi versi Spring dan konfigurasi proxy method validation. Dalam desain arsitektur, jangan membuat correctness utama hanya bergantung pada proxy magic yang sulit terlihat.

---

## 14. JAX-RS / Jakarta REST Integration

Dalam Jakarta REST / JAX-RS, Bean/Jakarta Validation dapat diterapkan pada:

- request entity,
- path parameter,
- query parameter,
- header parameter,
- method return value.

Contoh konseptual:

```java
@Path("/applications")
public class ApplicationResource {

    @POST
    public Response create(@Valid CreateApplicationRequest request) {
        return Response.ok().build();
    }
}
```

Untuk group-specific validation, dukungan dan syntax bisa bergantung pada integration framework/container. Karena itu, dalam large enterprise system, sering lebih aman memakai command validation eksplisit di application service:

```java
Set<ConstraintViolation<ApplicationRequest>> violations =
    validator.validate(request, Submit.class);

if (!violations.isEmpty()) {
    throw new ValidationFailureException(violations);
}
```

Keuntungannya:

- group yang dipakai terlihat jelas,
- test lebih mudah,
- error mapping konsisten,
- tidak terlalu bergantung pada magic framework.

---

## 15. Groups dan Cascaded Validation

Group berlaku saat validation cascade juga.

Contoh:

```java
public interface Submit {}

public class ApplicationRequest {

    @NotBlank(groups = Submit.class)
    private String applicationType;

    @Valid
    @NotNull(groups = Submit.class)
    private ApplicantRequest applicant;
}

public class ApplicantRequest {

    @NotBlank(groups = Submit.class)
    private String fullName;

    @Email(groups = Submit.class)
    private String email;
}
```

Jika kita memanggil:

```java
validator.validate(applicationRequest, Submit.class);
```

maka nested `ApplicantRequest` juga dievaluasi dengan `Submit.class`.

Ini powerful, tetapi bisa menciptakan coupling: child object harus tahu group parent. Jika group parent terlalu spesifik, child DTO menjadi bergantung pada workflow parent.

Buruk:

```java
public class ApplicantRequest {
    @NotBlank(groups = SubmitApplicationByOfficerAfterClarification.class)
    private String fullName;
}
```

Lebih baik:

```java
public interface CompleteApplicantInfo {}

public class ApplicantRequest {
    @NotBlank(groups = CompleteApplicantInfo.class)
    private String fullName;
}
```

Lalu mapping parent-to-child group bisa memakai group conversion jika diperlukan.

---

## 16. Group Conversion

Group conversion memungkinkan saat cascade, group dari parent diubah menjadi group lain pada child.

Contoh konseptual:

```java
public interface SubmitApplication {}
public interface CompleteApplicantInfo {}

public class ApplicationRequest {

    @Valid
    @ConvertGroup(from = SubmitApplication.class, to = CompleteApplicantInfo.class)
    private ApplicantRequest applicant;
}

public class ApplicantRequest {

    @NotBlank(groups = CompleteApplicantInfo.class)
    private String fullName;
}
```

Saat `ApplicationRequest` divalidasi dengan `SubmitApplication`, nested `ApplicantRequest` divalidasi dengan `CompleteApplicantInfo`.

Kapan berguna:

- child object reusable di banyak parent,
- parent operation berbeda dari child contract,
- ingin menghindari child mengetahui semua parent workflow.

Risiko:

- behavior tersembunyi,
- debugging lebih sulit,
- documentation harus jelas,
- test wajib mencakup cascade group conversion.

Gunakan group conversion jika ia mengurangi coupling, bukan menambah magic.

---

## 17. Groups dan Container Element Constraints

Group juga berlaku pada type-use constraints.

```java
public interface Submit {}

public class ApplicationRequest {

    private List<@NotBlank(groups = Submit.class) String> declaredActivities;

    private Map<
        @NotBlank(groups = Submit.class) String,
        @Valid AddressRequest
    > addressesByType;
}
```

Validasi:

```java
validator.validate(request, Submit.class);
```

Violation path bisa menunjuk ke:

- list index,
- map key,
- map value,
- nested property.

Design API error response harus bisa membawa path yang structured:

```json
{
  "code": "VALIDATION_ERROR",
  "violations": [
    {
      "path": "declaredActivities[2]",
      "constraint": "NotBlank",
      "message": "must not be blank"
    },
    {
      "path": "addressesByType[REGISTERED].postalCode",
      "constraint": "NotBlank",
      "message": "must not be blank"
    }
  ]
}
```

---

## 18. Groups dan Method Validation

Group bisa diterapkan pada method parameter dan return value.

```java
public interface Create {}

public class CustomerService {

    public CustomerId create(
        @NotNull(groups = Create.class) @Valid CustomerRequest request
    ) {
        // ...
    }
}
```

Secara manual:

```java
ExecutableValidator executableValidator = validator.forExecutables();

Set<ConstraintViolation<CustomerService>> violations =
    executableValidator.validateParameters(
        service,
        method,
        new Object[] { request },
        Create.class
    );
```

Method validation cocok untuk internal contract, tetapi hati-hati pada framework proxy:

- self-invocation bisa bypass proxy,
- private method tidak tervalidasi oleh proxy,
- final class/method bisa bermasalah pada proxy tertentu,
- overloaded method perlu mapping yang benar.

Group tidak menghilangkan masalah ini.

---

## 19. Groups dan Error Contract

Saat error dikirim ke client, jangan hanya kirim message.

Buruk:

```json
{
  "error": "name must not be blank"
}
```

Lebih baik:

```json
{
  "code": "VALIDATION_ERROR",
  "context": "CREATE_CUSTOMER",
  "violations": [
    {
      "path": "name",
      "constraint": "NotBlank",
      "group": "Create",
      "message": "must not be blank",
      "errorCode": "CUSTOMER_NAME_REQUIRED"
    }
  ]
}
```

Namun hati-hati: mengekspos nama group internal bisa membuat API contract terlalu terikat pada implementasi Java.

Alternatif:

```json
{
  "operation": "CREATE_CUSTOMER",
  "violations": [
    {
      "path": "name",
      "code": "CUSTOMER_NAME_REQUIRED",
      "message": "Customer name is required."
    }
  ]
}
```

Group tetap internal. API melihat operation dan stable error code.

---

## 20. Group Explosion

Group explosion terjadi ketika jumlah group berkembang tanpa desain.

Contoh:

```java
public interface Create {}
public interface Update {}
public interface Patch {}
public interface Submit {}
public interface SubmitDraft {}
public interface SubmitAfterClarification {}
public interface Approve {}
public interface ApproveBySupervisor {}
public interface ApproveByDirector {}
public interface Reject {}
public interface RejectWithWarning {}
public interface Escalate {}
public interface EscalateUrgent {}
public interface Reopen {}
public interface Withdraw {}
public interface WithdrawByApplicant {}
public interface WithdrawByAdmin {}
```

Gejala:

- constraint annotation menjadi panjang,
- setiap field punya group list berbeda,
- tidak ada yang tahu group mana dipakai endpoint mana,
- test hanya happy path,
- bug muncul saat satu group lupa ditambahkan,
- rule audit sulit dijelaskan.

Jika ini terjadi, refactor ke:

1. DTO per command,
2. domain policy object,
3. workflow guard,
4. rule catalog,
5. programmatic validation layer yang eksplisit.

---

## 21. Pattern: Input Shape Group vs Workflow Policy

Pisahkan dua dunia:

### 21.1 Input Shape Group

Menjawab:

- apakah field ada?
- apakah format benar?
- apakah panjang valid?
- apakah collection tidak terlalu besar?
- apakah nested object valid?

Contoh:

```java
public interface SubmitInput {}
```

### 21.2 Workflow Policy

Menjawab:

- apakah case boleh submit dari state ini?
- apakah actor boleh melakukan action?
- apakah mandatory assessment sudah complete?
- apakah semua outstanding clarification sudah dijawab?
- apakah deadline masih berlaku?
- apakah override perlu approval tambahan?

Contoh:

```java
public final class SubmitApplicationPolicy {

    public RuleResult evaluate(ApplicationCase caseData, Actor actor, Clock clock) {
        RuleResult result = RuleResult.ok();

        if (!caseData.status().canSubmit()) {
            result.reject("CASE_STATE_NOT_SUBMITTABLE");
        }

        if (!actor.hasPermission("APPLICATION_SUBMIT")) {
            result.reject("ACTOR_NOT_ALLOWED_TO_SUBMIT");
        }

        if (!caseData.hasCompletedMandatorySections()) {
            result.reject("MANDATORY_SECTIONS_INCOMPLETE");
        }

        return result;
    }
}
```

Layering:

```text
Request JSON
   ↓
DTO validation group: SubmitInput
   ↓
Command mapping
   ↓
Domain/workflow policy: SubmitApplicationPolicy
   ↓
Persistence constraints
   ↓
Audit/event
```

---

## 22. Pattern: Command-Specific DTO with Shared Embedded Object

Daripada satu mega DTO dengan banyak group, gunakan command-specific DTO yang memakai embedded reusable object.

```java
public record ApplicantInfo(
    @NotBlank String fullName,
    @Email String email,
    @NotBlank String postalCode
) {}

public record SaveDraftApplicationRequest(
    String applicationType,
    ApplicantDraftInfo applicant
) {}

public record SubmitApplicationRequest(
    @NotBlank String applicationType,
    @Valid @NotNull ApplicantInfo applicant
) {}
```

Kalau draft dan submit punya requiredness berbeda, bisa ada dua embedded object:

```java
public record ApplicantDraftInfo(
    @Size(max = 300) String fullName,
    @Email String email,
    @Size(min = 6, max = 6) String postalCode
) {}

public record ApplicantSubmitInfo(
    @NotBlank @Size(max = 300) String fullName,
    @NotBlank @Email String email,
    @NotBlank @Size(min = 6, max = 6) String postalCode
) {}
```

Ini lebih verbose, tetapi sangat jelas.

Top-tier engineering sering memilih clarity daripada DRY ekstrem.

---

## 23. Pattern: Group untuk Cost Gate, Bukan Workflow Engine

Kadang group dipakai untuk memisahkan cheap validation dan expensive validation.

```java
public interface CheapChecks {}
public interface ExpensiveChecks {}
```

```java
public class ImportRow {

    @NotBlank(groups = CheapChecks.class)
    private String referenceNo;

    @Pattern(regexp = "[A-Z0-9]{12}", groups = CheapChecks.class)
    private String externalId;

    @ValidExternalReference(groups = ExpensiveChecks.class)
    private String externalId;
}
```

Ini bisa dikombinasikan dengan group sequence agar expensive checks tidak jalan kalau cheap checks sudah gagal.

Namun group sequence dibahas mendalam di part berikutnya.

Prinsipnya:

- cheap syntactic validation dulu,
- expensive semantic validation belakangan,
- DB/network check sebaiknya tidak berada di Bean Validation kecuali sangat terkendali.

---

## 24. Jangan Menggunakan Group untuk Authorization

Buruk:

```java
public interface Admin {}
public interface Officer {}

@NotNull(groups = Admin.class)
private String adminOnlyReason;
```

Masalahnya:

- group bukan security boundary,
- caller bisa salah memilih group,
- validasi bukan permission check,
- rule bisa bypass lewat endpoint lain,
- audit authorization menjadi kabur.

Lebih baik:

```java
if (!actor.canPerform(Action.APPROVE_WITH_OVERRIDE)) {
    throw new ForbiddenException("ACTOR_NOT_ALLOWED");
}
```

Lalu validasi input tetap berdasarkan operation:

```java
@Validated(ApproveWithOverrideInput.class)
```

Authorization dan validation bisa saling melengkapi, tetapi tidak boleh saling menggantikan.

---

## 25. Jangan Menggunakan Group untuk Database Consistency

Buruk:

```java
public interface UniqueEmailCheck {}

@UniqueEmail(groups = UniqueEmailCheck.class)
private String email;
```

Masalah:

- race condition,
- transaction isolation,
- stale read,
- latency,
- retry semantics,
- error handling sulit.

Lebih aman:

1. Format email divalidasi oleh Bean Validation.
2. Unique constraint ditegakkan di database.
3. Duplicate key diterjemahkan ke domain/API error.

```text
Bean Validation:
- email tidak blank
- email format valid

Database:
- unique(email)

Application error translation:
- DB unique violation -> EMAIL_ALREADY_REGISTERED
```

Jika tetap butuh pre-check untuk UX, anggap sebagai advisory, bukan source of truth.

---

## 26. Groups dalam Batch Import

Batch import sering punya dua tahap:

1. row shape validation,
2. cross-row/business validation.

Bean Validation group cocok untuk tahap pertama.

```java
public interface ImportRowShape {}

public class CustomerImportRow {

    @NotBlank(groups = ImportRowShape.class)
    private String rowNumber;

    @NotBlank(groups = ImportRowShape.class)
    private String customerName;

    @Email(groups = ImportRowShape.class)
    private String email;
}
```

Tahap kedua lebih baik pakai validator khusus:

```java
public final class CustomerImportBatchValidator {

    public BatchValidationResult validate(List<CustomerImportRow> rows) {
        // duplicate email within file
        // reference existence
        // row dependency
        // max allowed active customers
        // tenant rule
    }
}
```

Jangan memaksa cross-row validation ke annotation group.

---

## 27. Groups dalam API Versioning

Misalnya API v1 dan v2 berbeda requiredness.

Pilihan group:

```java
public interface V1 {}
public interface V2 {}
```

```java
public class CustomerRequest {

    @NotBlank(groups = {V1.class, V2.class})
    private String name;

    @NotBlank(groups = V2.class)
    private String taxIdentifier;
}
```

Ini bisa dipakai jika perbedaan v1/v2 kecil.

Tetapi jika API v2 berubah signifikan, lebih baik DTO berbeda:

```java
public record CreateCustomerV1Request(...) {}
public record CreateCustomerV2Request(...) {}
```

API versioning adalah public contract. Jangan terlalu tersembunyi di group internal.

---

## 28. Groups dan Records

Java records membuat DTO immutable dan jelas.

```java
public interface Create {}
public interface Update {}

public record ProductRequest(
    @Null(groups = Create.class)
    @NotNull(groups = Update.class)
    Long id,

    @NotBlank(groups = {Create.class, Update.class})
    String name,

    @Positive(groups = {Create.class, Update.class})
    BigDecimal price
) {}
```

Ini valid untuk modern Java/Jakarta Validation stack.

Namun jika jumlah group bertambah, record header menjadi berisik.

```java
public record CaseRequest(
    @NotBlank(groups = {Draft.class, Submit.class, Resubmit.class, Escalate.class, Reopen.class})
    String reason
) {}
```

Ini tanda desain mulai rusak.

Untuk Java 21/25, records bagus untuk command-specific DTO:

```java
public record SubmitCaseRequest(
    @NotNull Long caseId,
    @NotBlank String submissionReason,
    @Valid @NotNull ApplicantInfo applicant
) {}
```

---

## 29. Groups dan Legacy Java 8

Di Java 8, kita tidak punya record, tetapi group tetap tersedia.

```java
public class SubmitCaseRequest {

    @NotNull(groups = Submit.class)
    private Long caseId;

    @NotBlank(groups = Submit.class)
    private String submissionReason;

    public Long getCaseId() {
        return caseId;
    }

    public void setCaseId(Long caseId) {
        this.caseId = caseId;
    }

    public String getSubmissionReason() {
        return submissionReason;
    }

    public void setSubmissionReason(String submissionReason) {
        this.submissionReason = submissionReason;
    }
}
```

Prinsip desain sama:

- jangan group explosion,
- jangan workflow engine di annotation,
- pakai DTO terpisah jika contract berbeda,
- test group secara eksplisit.

---

## 30. Package Design untuk Group

Ada beberapa opsi.

### 30.1 Central Shared Groups

```text
com.example.validation.ValidationGroups
```

```java
public final class ValidationGroups {
    private ValidationGroups() {}

    public interface Create {}
    public interface Update {}
    public interface Patch {}
    public interface Submit {}
}
```

Cocok untuk aplikasi kecil-menengah.

Risiko:

- semua bounded context berbagi istilah sama padahal makna berbeda,
- `Submit` di module application belum tentu sama dengan `Submit` di module appeal.

### 30.2 Per Module / Bounded Context

```text
com.example.application.validation.ApplicationValidationGroups
com.example.appeal.validation.AppealValidationGroups
com.example.compliance.validation.ComplianceValidationGroups
```

Lebih aman untuk sistem besar.

### 30.3 Per Use Case

```text
com.example.application.submit.SubmitApplicationValidation
```

Terlalu granular jika berlebihan, tetapi bisa cocok untuk module high-complexity.

Rekomendasi enterprise:

```text
Gunakan group per bounded context.
Hindari group global yang terlalu generic jika domain besar.
```

---

## 31. Documentation Pattern

Setiap group penting harus terdokumentasi.

Contoh:

```java
/**
 * Validation group for Application draft save request.
 *
 * Scope:
 * - cheap syntactic validation only
 * - no mandatory completeness checks
 * - no workflow transition checks
 *
 * Not for:
 * - submit validation
 * - authorization
 * - database consistency
 */
public interface DraftSave {}
```

Untuk group kompleks, buat markdown:

```text
validation-groups.md

# ApplicationValidationGroups

## DraftSave
Used by:
- POST /applications/draft

Purpose:
- ensure provided fields have valid basic format
- allow incomplete mandatory fields

Not responsible for:
- checking whether application is submittable
- checking user permission
- checking reference existence

## Submit
Used by:
- POST /applications/{id}/submit

Purpose:
- ensure command contains mandatory submission input
- ensure applicant/contact fields are complete

Not responsible for:
- workflow transition validity
- officer authorization
- outstanding clarification checks
```

Top-tier engineering bukan hanya membuat rule, tetapi membuat rule bisa dipahami, diuji, dan diaudit.

---

## 32. Testing Validation Groups

Setiap group yang dipakai endpoint harus punya test.

### 32.1 Test Manual Validator

```java
class ProductRequestValidationTest {

    private Validator validator;

    @BeforeEach
    void setUp() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
    }

    @Test
    void create_shouldRejectId() {
        ProductRequest request = new ProductRequest();
        request.setId(10L);
        request.setName("Keyboard");
        request.setPrice(new BigDecimal("100.00"));

        Set<ConstraintViolation<ProductRequest>> violations =
            validator.validate(request, Create.class);

        assertThat(violations)
            .anyMatch(v -> v.getPropertyPath().toString().equals("id"));
    }

    @Test
    void update_shouldRequireId() {
        ProductRequest request = new ProductRequest();
        request.setName("Keyboard");
        request.setPrice(new BigDecimal("100.00"));

        Set<ConstraintViolation<ProductRequest>> violations =
            validator.validate(request, Update.class);

        assertThat(violations)
            .anyMatch(v -> v.getPropertyPath().toString().equals("id"));
    }
}
```

### 32.2 Test Endpoint Group Mapping

Pastikan endpoint memakai group yang benar.

Misalnya controller create harus reject id, update harus require id.

```java
// create request with id should fail
// update request without id should fail
```

Bug umum bukan constraint-nya salah, tetapi endpoint memakai group salah atau tidak memakai group sama sekali.

### 32.3 Test Default Group Trap

Jika ada constraint tanpa group, pastikan apakah ia memang masuk `Default` atau harus masuk group tertentu.

```java
@Test
void create_shouldAlsoValidateDefaultConstraints_ifThatIsTheDesign() {
    Set<ConstraintViolation<Request>> violations =
        validator.validate(request, Default.class, Create.class);

    // assert default constraints active
}
```

---

## 33. Review Checklist untuk Pull Request

Saat review kode yang memakai validation groups, cek:

1. Apakah group memang diperlukan, atau DTO terpisah lebih jelas?
2. Apakah group hanya mewakili input contract, bukan workflow state?
3. Apakah `Default` group tidak terlupakan?
4. Apakah endpoint/service memanggil group yang benar?
5. Apakah cascaded validation memakai group yang sesuai?
6. Apakah group conversion digunakan dengan test?
7. Apakah jumlah group masih kecil dan stabil?
8. Apakah nama group jelas?
9. Apakah group tidak dipakai untuk authorization?
10. Apakah group tidak dipakai untuk final database consistency?
11. Apakah error response tidak mengekspos internal group secara tidak perlu?
12. Apakah test mencakup minimal satu valid dan satu invalid case per group?
13. Apakah constraint list masih bisa dibaca?
14. Apakah migration `javax`/`jakarta` konsisten?
15. Apakah group ditempatkan di package yang benar?

---

## 34. Anti-Patterns

### 34.1 `@Validated` Lupa, Mengira Group Aktif

```java
@PostMapping
public ResponseEntity<?> create(@Valid @RequestBody UserRequest request) {
    // OnCreate tidak aktif
}
```

Jika constraint hanya punya `groups = OnCreate.class`, maka `@Valid` default tidak cukup.

Gunakan:

```java
@PostMapping
public ResponseEntity<?> create(@Validated(OnCreate.class) @RequestBody UserRequest request) {
    // OnCreate aktif
}
```

### 34.2 Constraint Tanpa Group Tidak Ikut Saat Group Khusus Dipanggil

```java
@NotBlank
private String name;

@NotBlank(groups = Create.class)
private String password;
```

```java
validator.validate(request, Create.class);
```

`name` tidak divalidasi jika hanya `Create` yang diminta.

### 34.3 Group Terlalu Spesifik

```java
public interface SubmitAppealAfterSecondClarificationBySeniorOfficer {}
```

Ini workflow policy, bukan simple group.

### 34.4 Group Dipakai untuk Role

```java
public interface AdminValidation {}
public interface OfficerValidation {}
```

Biasanya ini bercampur dengan authorization.

### 34.5 Group Dipakai untuk External DB Check

```java
@ExistingCustomer(groups = Submit.class)
private Long customerId;
```

Bisa saja dalam kondisi tertentu, tetapi default-nya sebaiknya dihindari. Reference existence sering lebih baik di application service karena butuh transaction, error semantics, dan observability.

### 34.6 Mega DTO dengan 20 Group

Jika satu DTO dipakai untuk semua operation, kemungkinan readability kalah.

---

## 35. Practical Architecture Example

### 35.1 Problem

Kita punya application management system.

Operasi:

- save draft,
- submit application,
- update draft,
- approve,
- reject.

### 35.2 Bad Design

```java
public class ApplicationRequest {

    @NotBlank(groups = {SaveDraft.class, Submit.class, UpdateDraft.class, Approve.class, Reject.class})
    private String applicationType;

    @NotBlank(groups = {Submit.class, Approve.class})
    private String applicantName;

    @NotBlank(groups = {Submit.class, Approve.class, Reject.class})
    private String reason;

    @NotNull(groups = {Approve.class, Reject.class})
    private Boolean officerConfirmed;
}
```

Masalah:

- approve/reject bukan request shape yang sama dengan application submission,
- reason punya arti berbeda di submit, approve, reject,
- object menjadi semantic soup,
- error message sulit dijelaskan.

### 35.3 Better Design

```java
public record SaveApplicationDraftRequest(
    @Size(max = 50) String applicationType,
    @Valid ApplicantDraftInfo applicant
) {}

public record SubmitApplicationRequest(
    @NotNull Long applicationId,
    @NotBlank String applicationType,
    @Valid @NotNull ApplicantSubmitInfo applicant
) {}

public record ApproveApplicationRequest(
    @NotNull Long applicationId,
    @NotBlank String approvalReason
) {}

public record RejectApplicationRequest(
    @NotNull Long applicationId,
    @NotBlank String rejectionReason
) {}
```

Lalu workflow policy:

```java
public final class ApproveApplicationPolicy {

    public RuleResult evaluate(ApplicationCase caseData, Actor actor) {
        RuleResult result = RuleResult.ok();

        if (!caseData.status().equals(CaseStatus.SUBMITTED)) {
            result.reject("CASE_NOT_IN_SUBMITTED_STATE");
        }

        if (!actor.canApprove(caseData)) {
            result.reject("ACTOR_CANNOT_APPROVE_CASE");
        }

        if (!caseData.assessmentCompleted()) {
            result.reject("ASSESSMENT_NOT_COMPLETED");
        }

        return result;
    }
}
```

Ini jauh lebih defensible.

---

## 36. Validation Groups dalam Modular Monolith / Microservices

Dalam sistem besar, group bisa menjadi bagian dari module contract.

Contoh package:

```text
com.company.application.api.dto
com.company.application.api.validation
com.company.application.domain.policy
com.company.application.workflow.guard
```

Jangan biarkan module lain memakai group internal sembarangan.

Buruk:

```java
// compliance module menggunakan group internal application module
validator.validate(request, ApplicationValidationGroups.Submit.class);
```

Lebih baik:

- expose API contract DTO,
- expose validation facade jika perlu,
- atau validasi di boundary module masing-masing.

Dalam microservices, jangan share validation group jar secara berlebihan. Shared validation library bisa menciptakan coupling antar service.

Gunakan shared library hanya untuk stable cross-cutting primitives:

- email format,
- postal code primitive,
- common identifier format,
- safe string length,
- common error model.

Jangan share workflow group antar service.

---

## 37. Migration Notes: `javax.validation` ke `jakarta.validation`

Untuk Java 8 / Spring Boot 2 / Jakarta EE 8 era, group menggunakan:

```java
import javax.validation.groups.Default;
```

Untuk Spring Boot 3 / Jakarta EE 10+ / Jakarta Validation 3.x:

```java
import jakarta.validation.groups.Default;
```

Constraint annotation juga pindah:

```java
javax.validation.constraints.NotBlank
```

menjadi:

```java
jakarta.validation.constraints.NotBlank
```

Marker interface buatan sendiri tidak harus berubah package-nya, tetapi annotation import dan API import harus konsisten.

Mixed namespace adalah bahaya:

```java
// Buruk: campur javax dan jakarta
import javax.validation.constraints.NotBlank;
import jakarta.validation.Validator;
```

Ini bisa membuat constraint tidak terbaca oleh provider modern atau menyebabkan konflik dependency.

Migration checklist:

1. Ubah semua import validation dari `javax.validation` ke `jakarta.validation`.
2. Pastikan dependency provider sesuai.
3. Pastikan Spring Boot/Jakarta EE version sesuai.
4. Jalankan test semua group.
5. Pastikan custom constraints memakai namespace yang benar.
6. Pastikan `Default` group import tidak tertinggal.
7. Pastikan generated code ikut dimigrasi.

---

## 38. Version-Aware Notes: Java 8 sampai Java 25

### Java 8

- Bean Validation 2.0 relevan.
- Type-use constraints mulai tersedia.
- DTO masih class biasa.
- Group design tetap sama.
- Banyak legacy app memakai `javax.validation`.

### Java 11

- Masih banyak enterprise app di Java 11.
- Bisa memakai Bean Validation 2.0/Hibernate Validator 6.x atau transisi stack lain.
- Group tetap berguna, tetapi migration planning penting.

### Java 17

- Minimum penting untuk Jakarta EE 11/Jakarta Validation 3.1 ecosystem.
- Record support makin relevan.
- Spring Boot 3 menggunakan Jakarta namespace.

### Java 21

- Records, sealed classes, pattern matching style mendorong command-specific modeling yang lebih jelas.
- Group tetap berguna, tetapi tidak perlu memaksakan satu mutable DTO.

### Java 25

- Prinsip validation group tidak berubah.
- Modern style makin condong ke explicit immutable command DTO.
- Gunakan group secara selektif, bukan sebagai default desain.

---

## 39. Practical Heuristics

Gunakan aturan sederhana berikut.

### 39.1 Rule 1: Jika Group Lebih dari 3 untuk Satu DTO, Review Desain

Bukan otomatis salah, tetapi perlu ditinjau.

```text
0-2 group: biasanya aman
3-4 group: hati-hati
5+ group: kemungkinan DTO terlalu banyak tanggung jawab
```

### 39.2 Rule 2: Jika Nama Group Mengandung Role, Curigai Authorization Leak

```text
AdminApprove
SupervisorSubmit
OfficerReject
```

Mungkin ini permission, bukan validation.

### 39.3 Rule 3: Jika Nama Group Mengandung State Detail, Curigai Workflow Leak

```text
SubmitAfterClarification
ApproveAfterEscalation
ReopenAfterWithdrawal
```

Mungkin ini transition guard.

### 39.4 Rule 4: Jika Constraint Butuh Repository, Jangan Cepat Masukkan ke Bean Validation

Repository call di validator bisa menyebabkan race, latency, dan observability buruk.

### 39.5 Rule 5: Test Endpoint Memakai Group yang Benar

Bug production sering terjadi karena:

- DTO benar,
- constraint benar,
- group benar,
- tetapi endpoint memakai `@Valid` bukan `@Validated(Group.class)`.

---

## 40. Implementation Example: Clean Group Usage

### 40.1 Groups

```java
package com.example.customer.validation;

public final class CustomerValidationGroups {
    private CustomerValidationGroups() {}

    public interface Create {}
    public interface Update {}
}
```

### 40.2 DTO

```java
package com.example.customer.api;

import com.example.customer.validation.CustomerValidationGroups.Create;
import com.example.customer.validation.CustomerValidationGroups.Update;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.Size;

public class CustomerRequest {

    @Null(groups = Create.class, message = "customer.id.must_be_absent_on_create")
    @NotNull(groups = Update.class, message = "customer.id.required_on_update")
    private Long id;

    @NotBlank(groups = {Create.class, Update.class}, message = "customer.name.required")
    @Size(max = 300, groups = {Create.class, Update.class}, message = "customer.name.too_long")
    private String name;

    @Email(groups = {Create.class, Update.class}, message = "customer.email.invalid")
    @Size(max = 320, groups = {Create.class, Update.class}, message = "customer.email.too_long")
    private String email;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
```

### 40.3 Controller

```java
package com.example.customer.api;

import com.example.customer.validation.CustomerValidationGroups.Create;
import com.example.customer.validation.CustomerValidationGroups.Update;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/customers")
public class CustomerController {

    @PostMapping
    public ResponseEntity<Void> create(
        @Validated(Create.class) @RequestBody CustomerRequest request
    ) {
        return ResponseEntity.ok().build();
    }

    @PutMapping
    public ResponseEntity<Void> update(
        @Validated(Update.class) @RequestBody CustomerRequest request
    ) {
        return ResponseEntity.ok().build();
    }
}
```

### 40.4 What This Design Does Well

- Create and update contract are explicit.
- Group count is small.
- Constraint meaning is local.
- No workflow rule hidden in annotation.
- No authorization hidden in validation.
- Error message uses stable code-like keys.

---

## 41. Implementation Example: When DTO Separate Is Better

Jika update dan create makin berbeda:

```java
public class CustomerRequest {

    @Null(groups = Create.class)
    @NotNull(groups = Update.class)
    private Long id;

    @NotBlank(groups = Create.class)
    private String name;

    @NotBlank(groups = Create.class)
    private String registrationNumber;

    @NotBlank(groups = Update.class)
    private String updateReason;

    @NotBlank(groups = Suspend.class)
    private String suspensionReason;

    @NotBlank(groups = Reactivate.class)
    private String reactivationReason;
}
```

Refactor:

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @NotBlank String registrationNumber
) {}

public record UpdateCustomerRequest(
    @NotNull Long id,
    @NotBlank String name,
    @NotBlank String updateReason
) {}

public record SuspendCustomerRequest(
    @NotNull Long id,
    @NotBlank String suspensionReason
) {}

public record ReactivateCustomerRequest(
    @NotNull Long id,
    @NotBlank String reactivationReason
) {}
```

Clarity menang.

---

## 42. “Top 1%” Mental Model

Engineer biasa melihat validation group sebagai cara menghindari banyak DTO.

Engineer kuat melihat validation group sebagai **context selector** untuk constraint evaluation.

Engineer top-tier bertanya:

1. Contract apa yang sedang ditegakkan?
2. Siapa konsumennya?
3. Apakah ini shape validation, semantic validation, workflow guard, authorization, atau consistency constraint?
4. Apakah group membuat rule lebih jelas atau lebih tersembunyi?
5. Apakah failure bisa dijelaskan ke user dan auditor?
6. Apakah test membuktikan endpoint memilih group yang benar?
7. Apakah rule ini stabil atau akan berubah berdasarkan state/role/jurisdiction?
8. Apakah DTO terpisah lebih defensible?
9. Apakah database tetap menjadi final consistency guard?
10. Apakah API error contract stabil?

Validation group adalah pisau tajam. Dipakai dengan benar, ia mengurangi duplikasi. Dipakai sembarangan, ia membuat contract tidak terlihat.

---

## 43. Summary

Validation groups memungkinkan constraint aktif berdasarkan konteks evaluasi tertentu.

Gunakan untuk:

- create vs update sederhana,
- draft vs submit input shape,
- import vs API input,
- cheap vs expensive checks,
- reusable child object dengan group conversion yang jelas.

Hindari untuk:

- authorization,
- workflow transition,
- database uniqueness final check,
- role-specific behavior,
- state-machine modeling,
- rule yang butuh audit evidence kompleks,
- dynamic jurisdiction/tenant policy yang besar.

Prinsip utama:

```text
Validation group memilih contract evaluasi.
Ia bukan state machine, bukan authorization model, bukan database constraint, dan bukan rule engine.
```

Dalam sistem besar, clarity lebih penting daripada menghindari class tambahan. Jika group membuat pembaca harus menebak rule, gunakan DTO/command/policy terpisah.

---

## 44. Referensi

- Jakarta Validation 3.1 Specification, Eclipse Foundation.
- Bean Validation 2.0 / JSR 380 Specification.
- Hibernate Validator Reference Guide.
- Hibernate Validator API Documentation.
- Jakarta Validation API: `Default`, `GroupSequence`, `ConvertGroup`, `ConstraintViolation`.
- Spring Framework validation integration documentation.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-006](./learn-java-validation-jakarta-hibernate-validator-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-008](./learn-java-validation-jakarta-hibernate-validator-part-008.md)

</div>