# learn-java-json-xml-soap-connectors-enterprise-integration — Part 10
# JSON-B for Enterprise DTO Design

> Seri: Java JSON, XML, SOAP Legacy, dan Jakarta Connectors untuk Java 8–25  
> Part: 10 dari 34  
> Topik: desain DTO enterprise dengan JSON-B: boundary model, compatibility, PATCH semantics, polymorphism, validation, dan failure modeling

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

1. ekosistem JSON di Java,
2. JSON-P sebagai API struktural dan streaming,
3. JSON-P untuk transformasi, patch, canonicalization, dan production patterns,
4. JSON-B core model,
5. annotation dan customization JSON-B.

Part ini tidak lagi fokus pada `@JsonbProperty`, `JsonbAdapter`, atau cara memanggil `jsonb.toJson()`. Fokus part ini adalah pertanyaan yang lebih penting di sistem enterprise:

> Bagaimana mendesain object Java yang menjadi kontrak JSON agar aman, evolutif, stabil, tidak membocorkan domain internal, dan tetap bisa dipertahankan ketika sistem tumbuh selama bertahun-tahun?

JSON-B hanyalah binding layer. DTO adalah keputusan arsitektur.

Kalau DTO didesain asal, masalahnya biasanya tidak muncul di hari pertama. Masalahnya muncul saat:

- field perlu diubah tetapi client lama masih hidup,
- `null` ternyata berarti tiga hal berbeda,
- domain object ikut berubah dan merusak response API,
- PATCH request menghapus data secara tidak sengaja,
- enum baru membuat consumer lama error,
- object graph terlalu dalam dan menyebabkan payload membengkak,
- audit trail tidak bisa menjelaskan perubahan,
- data sensitif ikut terserialisasi,
- polymorphic deserialization membuka attack surface,
- migration Java 8 ke 17/21/25 membuat reflection/binding behavior berubah.

Part ini membahas cara berpikir agar DTO bukan sekadar “class request/response”, tetapi boundary contract yang bisa hidup lama.

---

## 1. Mental Model Utama: DTO adalah Boundary Contract, Bukan Object Sementara

DTO sering disebut Data Transfer Object. Nama itu terlihat sederhana, bahkan menipu. Banyak developer menganggap DTO hanya wadah data agar controller/service bisa menerima JSON.

Dalam sistem enterprise, DTO memiliki fungsi yang lebih besar:

```text
External JSON Contract
        |
        v
Inbound DTO
        |
        v
Validation / Normalization / Authorization Context
        |
        v
Application Command / Query Model
        |
        v
Domain / Persistence / Integration Model
        |
        v
Outbound DTO
        |
        v
External JSON Contract
```

DTO berada di perbatasan. Ia bukan domain model. Ia bukan entity model. Ia bukan sekadar mirror dari table database. Ia adalah bentuk eksplisit dari kontrak komunikasi.

### 1.1 Tiga dunia yang harus dipisahkan

Ada minimal tiga model yang perlu dibedakan:

| Model | Tujuan | Stabilitas | Contoh |
|---|---|---:|---|
| API DTO | kontrak external/internal antar service | harus relatif stabil | `CreateCaseRequest`, `CaseSummaryResponse` |
| Application model | representasi use case | berubah mengikuti logic | `CreateCaseCommand`, `AssignOfficerCommand` |
| Domain/persistence model | aturan bisnis dan storage | berubah mengikuti domain/data | `Case`, `OfficerAssignment`, `CaseEntity` |

Kesalahan umum adalah memakai satu class untuk semuanya.

Contoh buruk:

```java
@Entity
public class CaseRecord {
    @Id
    private Long id;

    private String caseNo;
    private String status;
    private String internalRemark;
    private String createdBy;
    private Instant createdAt;

    @OneToMany(fetch = FetchType.LAZY)
    private List<DocumentEntity> documents;
}
```

Lalu langsung dikembalikan sebagai JSON response:

```java
return caseRepository.findById(id);
```

Masalahnya:

- field internal bisa bocor,
- lazy relation bisa trigger query tidak terduga,
- perubahan schema database menjadi perubahan API,
- cyclic reference bisa membuat serialization gagal,
- response contract tidak eksplisit,
- akses data sensitif sulit dikontrol,
- audit dan compatibility sulit diuji.

DTO enterprise harus memutus coupling tersebut.

---

## 2. JSON-B dalam Arsitektur DTO

Jakarta JSON Binding mendefinisikan framework standar untuk mengubah Java object ke/dari JSON document. JSON-B menyediakan default mapping dan customization lewat annotation/configuration. Namun JSON-B tidak otomatis membuat desain DTO menjadi baik.

Peran JSON-B:

```text
JSON text <-> JSON-B runtime <-> Java DTO object
```

Yang tetap menjadi tanggung jawab engineer:

- menentukan shape DTO,
- menentukan field mana public contract,
- menentukan null/absent semantics,
- menentukan versioning strategy,
- menentukan validation rule,
- menentukan mapper ke application/domain model,
- menentukan security boundary,
- menentukan compatibility test.

Dengan kata lain:

> JSON-B menyelesaikan masalah binding. DTO design menyelesaikan masalah kontrak.

---

## 3. Prinsip 1 — DTO Harus Use-Case Specific

DTO yang terlalu generic biasanya terlihat hemat di awal, tetapi mahal di maintenance.

Contoh buruk:

```java
public class CaseDto {
    public String caseNo;
    public String status;
    public String applicantName;
    public String applicantEmail;
    public String internalAssessment;
    public String officerRemark;
    public List<DocumentDto> documents;
    public Instant createdAt;
    public Instant updatedAt;
}
```

Class ini lalu dipakai untuk:

- create case,
- update case,
- list case,
- detail case,
- export case,
- internal review,
- external public response.

Masalahnya setiap use case punya kebutuhan berbeda.

### 3.1 DTO yang lebih sehat

```java
public final class CreateCaseRequest {
    public String applicantName;
    public String applicantEmail;
    public String applicationType;
    public List<CreateDocumentRequest> documents;
}
```

```java
public final class CaseListItemResponse {
    public String caseNo;
    public String status;
    public Instant submittedAt;
}
```

```java
public final class CaseDetailResponse {
    public String caseNo;
    public String status;
    public ApplicantView applicant;
    public List<DocumentView> documents;
    public List<CaseTimelineItem> timeline;
}
```

```java
public final class InternalCaseAssessmentResponse {
    public String caseNo;
    public String status;
    public String riskLevel;
    public String internalAssessment;
    public List<OfficerActionView> officerActions;
}
```

Keuntungannya:

- field sensitive tidak ikut terbawa ke endpoint lain,
- response list bisa ringan,
- detail response bisa kaya tanpa membebani list,
- perubahan use case tidak merusak semua consumer,
- authorization lebih eksplisit,
- dokumentasi API lebih jelas.

### 3.2 Rule praktis

Gunakan DTO berbeda jika salah satu hal ini berbeda:

- actor berbeda,
- permission berbeda,
- lifecycle stage berbeda,
- payload size berbeda,
- validation rule berbeda,
- null/absent semantics berbeda,
- compatibility promise berbeda,
- response freshness berbeda,
- data source berbeda.

Jika dua endpoint memakai DTO yang sama hanya karena field-nya kebetulan mirip, itu belum tentu reuse yang baik. Bisa jadi itu coupling tersembunyi.

---

## 4. Prinsip 2 — Inbound DTO dan Outbound DTO Jangan Dicampur

Inbound DTO mewakili niat client. Outbound DTO mewakili fakta yang sistem expose.

Keduanya berbeda.

### 4.1 Inbound DTO

Inbound DTO harus menjawab:

- apa yang boleh diminta client,
- apa yang wajib dikirim,
- apa yang optional,
- apa yang tidak boleh client kontrol,
- bagaimana input dinormalisasi,
- bagaimana invalid input ditolak.

Contoh:

```java
public final class CreateUserRequest {
    public String fullName;
    public String email;
    public String preferredLanguage;
}
```

Client tidak boleh mengirim:

- `id`,
- `createdAt`,
- `createdBy`,
- `role`,
- `approvalStatus`,
- `riskScore`.

### 4.2 Outbound DTO

Outbound DTO harus menjawab:

- apa yang consumer perlu lihat,
- apa yang aman diekspos,
- apakah data ini computed atau stored,
- apakah field ini stable,
- apakah field ini bisa hilang di versi depan,
- apakah field ini boleh `null`.

Contoh:

```java
public final class UserProfileResponse {
    public String userId;
    public String fullName;
    public String email;
    public String preferredLanguage;
    public Instant registeredAt;
}
```

### 4.3 Anti-pattern: request=response

```java
public class UserDto {
    public String userId;
    public String fullName;
    public String email;
    public String role;
    public Instant createdAt;
}
```

Jika class ini dipakai sebagai request, client bisa mencoba mengirim `role`. Walaupun service mengabaikannya, DTO sudah mengundang ambiguity.

Boundary yang aman bukan hanya “server tidak memakai field itu”, tetapi “kontrak tidak memberi kesan field itu boleh dikontrol client”.

---

## 5. Prinsip 3 — DTO Jangan Mengekspor Domain Invariant Mentah

Domain object menyimpan aturan. DTO menyimpan representasi kontrak.

Contoh domain:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        if (amount == null || currency == null) {
            throw new IllegalArgumentException("amount and currency are required");
        }
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("invalid currency scale");
        }
        this.amount = amount;
        this.currency = currency;
    }
}
```

DTO tidak harus mengekspos semua detail internal `Money`. Kontrak JSON dapat dipilih:

```json
{
  "amount": "100.50",
  "currency": "SGD"
}
```

DTO:

```java
public final class MoneyDto {
    public String amount;
    public String currency;
}
```

Mapping ke domain:

```java
public Money toDomain(MoneyDto dto) {
    return new Money(new BigDecimal(dto.amount), Currency.getInstance(dto.currency));
}
```

Kenapa `amount` sering lebih aman sebagai string untuk external contract?

- JSON number tidak punya fixed precision/scale semantics universal,
- JavaScript number memakai floating-point double,
- monetary value butuh precision deterministik,
- string memaksa consumer memperlakukan nilai sebagai decimal, bukan binary floating point.

Ini bukan berarti semua angka harus string. Untuk money, large identifier, dan high-precision decimal, string sering lebih defensible.

---

## 6. Prinsip 4 — Null, Absent, Empty, Default Harus Punya Makna Terpisah

Salah satu sumber bug terbesar pada DTO JSON adalah menyamakan:

- field tidak dikirim,
- field dikirim dengan `null`,
- field dikirim string kosong,
- field dikirim array kosong,
- field dikirim default value.

Padahal dalam kontrak enterprise, semuanya bisa punya arti berbeda.

### 6.1 Empat keadaan field

Misal field `middleName`:

| JSON | Kemungkinan arti |
|---|---|
| tidak ada | client tidak menyentuh field ini |
| `"middleName": null` | client ingin menghapus nilai |
| `"middleName": ""` | client mengirim nilai kosong, mungkin invalid |
| `"middleName": "A."` | client ingin mengisi nilai |

Untuk create request, absent dan null biasanya sama-sama invalid jika field required.

Untuk update request, absent dan null bisa sangat berbeda.

### 6.2 Create DTO

```java
public final class CreateApplicantRequest {
    public String fullName;
    public String email;
    public String phoneNumber;
}
```

Semua required field divalidasi setelah binding:

```java
if (request.fullName == null || request.fullName.isBlank()) {
    throw new BadRequestException("fullName is required");
}
```

### 6.3 Replace DTO

Untuk PUT/replace, client biasanya mengirim representasi lengkap.

```java
public final class ReplaceApplicantRequest {
    public String fullName;
    public String email;
    public String phoneNumber;
}
```

Jika field tidak ada, bisa dianggap invalid karena replace membutuhkan full representation.

### 6.4 Patch DTO

Untuk PATCH, kita butuh membedakan absent vs explicit null.

Pendekatan buruk:

```java
public final class PatchApplicantRequest {
    public String fullName;
    public String email;
    public String phoneNumber;
}
```

Dengan class ini, setelah JSON-B binding:

```json
{}
```

Dan:

```json
{"email": null}
```

bisa sama-sama menghasilkan `email == null`, sehingga server tidak tahu apakah client tidak mengirim email atau ingin menghapus email.

### 6.5 Solusi 1: gunakan JSON-P untuk patch boundary

Untuk PATCH yang butuh semantics presisi, JSON-P object model sering lebih aman daripada langsung binding ke POJO.

```java
public void patchApplicant(String applicantId, JsonObject patch) {
    if (patch.containsKey("email")) {
        JsonValue value = patch.get("email");
        if (value.getValueType() == JsonValue.ValueType.NULL) {
            command.clearEmail();
        } else {
            command.changeEmail(patch.getString("email"));
        }
    }
}
```

Keuntungannya:

- bisa detect field presence,
- bisa detect explicit null,
- bisa reject unknown field,
- bisa audit raw patch,
- bisa menerapkan JSON Merge Patch/JSON Patch semantics secara tepat.

### 6.6 Solusi 2: tri-state wrapper

Untuk DTO berbasis POJO, buat wrapper tri-state.

```java
public final class FieldPatch<T> {
    private final boolean present;
    private final T value;

    private FieldPatch(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> FieldPatch<T> absent() {
        return new FieldPatch<>(false, null);
    }

    public static <T> FieldPatch<T> of(T value) {
        return new FieldPatch<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T value() {
        return value;
    }
}
```

Namun wrapper seperti ini butuh adapter/deserializer custom agar JSON-B dapat membedakan absent vs null. Karena JSON-B binding biasa tidak selalu cukup untuk presence tracking, JSON-P sering menjadi pilihan lebih eksplisit untuk PATCH.

---

## 7. DTO untuk POST, PUT, PATCH, dan Response

Jangan gunakan satu DTO untuk semua operasi.

### 7.1 POST / create

Karakteristik:

- client mengirim niat membuat resource,
- server menentukan identity,
- server menentukan audit fields,
- server menentukan initial status,
- beberapa default bisa dihitung server.

DTO:

```java
public final class CreateApplicationRequest {
    public String applicationType;
    public ApplicantRequest applicant;
    public List<DocumentUploadRequest> documents;
}
```

Field yang tidak boleh ada:

- `applicationId`,
- `applicationNo`,
- `status`,
- `createdAt`,
- `createdBy`,
- `approvedBy`.

### 7.2 PUT / replace

Karakteristik:

- representasi lengkap,
- absent field biasanya error,
- cocok untuk resource kecil dan stable,
- tidak cocok untuk aggregate besar yang punya lifecycle kompleks.

DTO:

```java
public final class ReplaceContactRequest {
    public String email;
    public String phoneNumber;
    public String mailingAddress;
}
```

### 7.3 PATCH / partial update

Karakteristik:

- representasi parsial,
- absent berarti no-op,
- null bisa berarti clear jika kontrak mengizinkan,
- harus punya allowlist field,
- harus audit per change.

Untuk enterprise system, PATCH perlu desain jauh lebih hati-hati dibanding POST.

Contoh command-level patch lebih eksplisit:

```java
public final class ChangeApplicantEmailRequest {
    public String newEmail;
    public String reason;
}
```

Daripada generic patch:

```json
{
  "email": "new@example.com"
}
```

Untuk lifecycle penting, action-specific endpoint sering lebih defensible:

```text
POST /applications/{id}/actions/change-email
POST /applications/{id}/actions/withdraw
POST /applications/{id}/actions/assign-officer
POST /applications/{id}/actions/approve
```

DTO:

```java
public final class ApproveApplicationRequest {
    public String decisionReason;
    public String officerRemark;
}
```

Keuntungannya:

- intent jelas,
- authorization jelas,
- audit jelas,
- validation context jelas,
- state transition bisa dikontrol,
- tidak ada generic mutation liar.

### 7.4 Response DTO

Response DTO sebaiknya dipisah berdasarkan audience.

```java
public final class PublicApplicationResponse {
    public String applicationNo;
    public String status;
    public Instant submittedAt;
}
```

```java
public final class OfficerApplicationResponse {
    public String applicationNo;
    public String status;
    public ApplicantView applicant;
    public RiskAssessmentView riskAssessment;
    public List<InternalRemarkView> internalRemarks;
}
```

---

## 8. DTO dan Validation Boundary

JSON-B mengubah JSON menjadi object. Ia tidak menjamin object itu valid secara bisnis.

Validation harus diposisikan sebagai tahap setelah binding dan sebelum application command.

```text
Raw JSON
  -> JSON-B binding
  -> syntactic validation
  -> semantic validation
  -> authorization-aware validation
  -> application command
  -> domain operation
```

### 8.1 Syntactic validation

Contoh:

- required field,
- string length,
- regex format,
- number min/max,
- array size,
- enum known value.

Dengan Jakarta Validation:

```java
public final class CreateApplicantRequest {
    @NotBlank
    @Size(max = 200)
    public String fullName;

    @NotBlank
    @Email
    public String email;

    @Size(max = 30)
    public String phoneNumber;
}
```

Jakarta Validation mendefinisikan metadata model dan API untuk validasi JavaBean dan method validation. Pada Jakarta Validation 3.1, dukungan Records juga diklarifikasi sebagai bagian dari target Jakarta EE 11.

### 8.2 Semantic validation

Contoh:

- email domain harus sesuai tipe applicant,
- `applicationType` harus masih aktif,
- document type harus valid untuk application type,
- effective date tidak boleh sebelum policy date,
- applicant tidak boleh punya pending duplicate case.

Ini tidak cukup dengan annotation.

```java
public void validate(CreateApplicationRequest request) {
    ApplicationType type = applicationTypeRepository.findActive(request.applicationType)
        .orElseThrow(() -> badRequest("Unknown or inactive applicationType"));

    if (!documentPolicy.isAllowed(type, request.documents)) {
        throw badRequest("Invalid document set for application type");
    }
}
```

### 8.3 Authorization-aware validation

Contoh:

- officer biasa tidak boleh set `riskLevel`,
- supervisor boleh override assignment,
- public applicant tidak boleh mutate internal remark,
- system user boleh mengirim field integrasi tertentu.

Jangan simpan semua logic ini di DTO. DTO hanya boundary data. Authorization-aware validation berada di application layer.

---

## 9. Unknown Field Policy: Strict vs Lenient

Salah satu keputusan paling penting pada inbound DTO adalah: apa yang terjadi jika client mengirim field tidak dikenal?

Contoh:

```json
{
  "fullName": "Alice",
  "email": "alice@example.com",
  "role": "ADMIN"
}
```

Jika `role` tidak ada di DTO, ada dua pendekatan:

### 9.1 Lenient: ignore unknown field

Keuntungan:

- forward compatibility lebih mudah,
- client bisa mengirim field tambahan tanpa gagal,
- cocok untuk consumer yang heterogen.

Risiko:

- typo tidak terdeteksi,
- client mengira field diproses padahal tidak,
- security probing tidak terlihat,
- audit input kurang jelas.

### 9.2 Strict: reject unknown field

Keuntungan:

- kontrak lebih presisi,
- typo cepat ditemukan,
- lebih aman untuk command endpoint,
- mengurangi ambiguity.

Risiko:

- evolusi client/server lebih kaku,
- perlu versioning/discovery lebih baik,
- bisa mematahkan client yang mengirim metadata tambahan.

### 9.3 Rule praktis

| Endpoint | Rekomendasi |
|---|---|
| command/create/update internal | strict lebih aman |
| public API dengan banyak consumer | pertimbangkan lenient dengan observability |
| event payload | sering lenient untuk forward compatibility |
| security-sensitive action | strict |
| PATCH | strict allowlist wajib |

Dengan JSON-B murni, unknown field behavior bergantung provider/configuration. Untuk endpoint yang harus benar-benar strict, pertimbangkan pre-parse dengan JSON-P untuk membandingkan field input dengan allowlist.

```java
private static final Set<String> CREATE_APPLICANT_FIELDS = Set.of(
    "fullName",
    "email",
    "phoneNumber"
);

public void rejectUnknownFields(JsonObject raw) {
    for (String field : raw.keySet()) {
        if (!CREATE_APPLICANT_FIELDS.contains(field)) {
            throw new BadRequestException("Unknown field: " + field);
        }
    }
}
```

Pattern ini membuat strictness explicit, bukan bergantung pada default provider.

---

## 10. DTO dan Records: Bagus, Tetapi Bukan Obat Semua

Sejak Java 16, records menjadi fitur final. Untuk DTO immutable, record terlihat sangat cocok.

```java
public record CreateApplicantRequest(
    String fullName,
    String email,
    String phoneNumber
) {}
```

Keuntungan:

- immutable by default,
- constructor eksplisit,
- shape jelas,
- cocok untuk response simple,
- mengurangi boilerplate.

Namun ada beberapa catatan.

### 10.1 Record bagus untuk value-oriented DTO

Contoh:

```java
public record CaseListItemResponse(
    String caseNo,
    String status,
    Instant submittedAt
) {}
```

```java
public record MoneyDto(
    String amount,
    String currency
) {}
```

### 10.2 Record kurang ideal jika binding butuh lifecycle kompleks

Misalnya:

- partial construction,
- defaulting rumit,
- backward compatibility constructor,
- provider lama belum stabil,
- Java 8 compatibility masih wajib,
- DTO harus dipakai di stack lama `javax`.

Karena seri ini mencakup Java 8–25, record tidak bisa menjadi baseline universal. Untuk library/module yang harus Java 8 compatible, gunakan class biasa.

### 10.3 Compact constructor bukan pengganti validation lengkap

```java
public record CreateApplicantRequest(String fullName, String email) {
    public CreateApplicantRequest {
        if (fullName == null || fullName.isBlank()) {
            throw new IllegalArgumentException("fullName is required");
        }
    }
}
```

Ini terlihat menarik, tetapi hati-hati:

- exception mapping bisa tidak konsisten,
- error response bisa kurang detail,
- validation butuh localization,
- semantic validation butuh repository/service,
- constructor exception terjadi saat binding, sebelum request context lengkap.

Untuk enterprise API, sering lebih baik DTO tetap sederhana dan validation dilakukan eksplisit di boundary layer.

---

## 11. DTO dan Sealed Types / Polymorphism

JSON-B 3.0 menambahkan dukungan untuk polymorphic types. Ini berguna, tetapi juga perlu kehati-hatian.

Polymorphism berarti satu field bisa berisi beberapa subtype.

Contoh:

```java
public sealed interface PaymentRequest permits CardPaymentRequest, BankTransferPaymentRequest {
}

public final class CardPaymentRequest implements PaymentRequest {
    public String cardToken;
}

public final class BankTransferPaymentRequest implements PaymentRequest {
    public String bankCode;
    public String accountNo;
}
```

JSON bisa menggunakan discriminator:

```json
{
  "type": "CARD",
  "cardToken": "tok_123"
}
```

atau:

```json
{
  "type": "BANK_TRANSFER",
  "bankCode": "DBS",
  "accountNo": "123456789"
}
```

### 11.1 Risiko polymorphic deserialization

Polymorphism pada boundary external berisiko jika:

- subtype resolution terlalu dinamis,
- class name digunakan sebagai discriminator,
- consumer bisa memicu class yang tidak dimaksud,
- subtype punya field sensitif,
- validation per subtype lemah,
- ada gadget/deserialization attack surface.

Rule penting:

> Jangan pernah membiarkan external JSON menentukan arbitrary Java class.

Gunakan discriminator allowlist:

```java
public PaymentCommand toCommand(JsonObject json) {
    String type = json.getString("type", null);
    if (type == null) {
        throw badRequest("type is required");
    }

    return switch (type) {
        case "CARD" -> parseCard(json);
        case "BANK_TRANSFER" -> parseBankTransfer(json);
        default -> throw badRequest("Unsupported payment type: " + type);
    };
}
```

Untuk contract-critical endpoint, manual discriminator mapping seperti ini sering lebih defensible daripada magic polymorphic binding.

### 11.2 Kapan polymorphism layak dipakai

Gunakan jika:

- subtype memang bagian dari public contract,
- discriminator stabil,
- subtype jumlahnya terkendali,
- schema/API docs jelas,
- validation per subtype kuat,
- unknown subtype ditolak atau ditangani eksplisit,
- tidak memakai Java class name sebagai contract.

Hindari jika:

- hanya karena domain model punya inheritance,
- client tidak perlu tahu subtype internal,
- subtype masih sering berubah,
- security boundary tinggi,
- consumer sulit menguji semua variasi.

---

## 12. Enum Design: Jangan Menganggap Enum Stabil Selamanya

Enum terlihat sederhana:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Response:

```json
{
  "status": "APPROVED"
}
```

Masalahnya status enterprise hampir selalu berkembang.

Nanti muncul:

- `PENDING_PAYMENT`,
- `PENDING_EXTERNAL_VERIFICATION`,
- `WITHDRAWN`,
- `EXPIRED`,
- `SUSPENDED`,
- `RETURNED_FOR_CLARIFICATION`.

### 12.1 Inbound enum harus strict

Untuk request command, unknown enum sebaiknya ditolak.

```json
{
  "decision": "APPROVE"
}
```

Jika client mengirim `APPROVEDDD`, itu invalid.

### 12.2 Outbound enum perlu compatibility strategy

Consumer lama bisa gagal saat menerima enum baru.

Strategi:

1. dokumentasikan bahwa enum response bisa bertambah,
2. minta consumer handle unknown value,
3. sediakan `statusGroup` yang lebih stabil,
4. jangan hapus value lama tanpa versioning.

Contoh:

```json
{
  "status": "PENDING_EXTERNAL_VERIFICATION",
  "statusGroup": "IN_PROGRESS",
  "statusLabel": "Pending external verification"
}
```

`status` detail bisa berkembang. `statusGroup` lebih stabil.

DTO:

```java
public final class ApplicationStatusResponse {
    public String status;
    public String statusGroup;
    public String statusLabel;
}
```

### 12.3 Jangan expose enum domain mentah jika lifecycle kompleks

Domain status bisa granular untuk state machine internal. API response mungkin butuh status yang lebih sederhana.

```text
Internal Status:
- ROUTED_TO_SCREENING
- WAITING_SCREENING_CALLBACK
- SCREENING_CALLBACK_FAILED
- SCREENING_CALLBACK_RETRYING
- SCREENING_MANUAL_REVIEW

Public Status:
- IN_PROGRESS
```

Mapping ini penting agar internal workflow bisa berubah tanpa merusak public API.

---

## 13. DTO Versioning: Tambah Field Lebih Mudah daripada Mengubah Makna Field

Versioning sering dianggap nanti saja. Padahal DTO harus didesain sejak awal untuk evolusi.

### 13.1 Perubahan yang biasanya backward compatible

Untuk response:

- tambah optional field,
- tambah enum value jika consumer siap,
- tambah nested object optional,
- tambah metadata.

Untuk request:

- tambah optional field dengan default server-side,
- tambah field yang hanya dipakai jika dikirim.

### 13.2 Perubahan yang breaking

- rename field,
- hapus field,
- ubah tipe field,
- ubah semantic field,
- ubah required field,
- ubah enum meaning,
- ubah date/time format,
- ubah numeric precision,
- ubah null semantics,
- ubah array order semantics,
- ubah identifier format.

### 13.3 Field deprecation pattern

Jangan langsung hapus field.

```java
public final class ApplicantResponse {
    public String applicantId;

    /**
     * @deprecated Use fullName instead.
     */
    @Deprecated
    public String name;

    public String fullName;
}
```

Response sementara:

```json
{
  "applicantId": "A-1001",
  "name": "Alice Tan",
  "fullName": "Alice Tan"
}
```

Plan:

1. tambah `fullName`,
2. isi `name` dan `fullName` paralel,
3. dokumentasikan deprecation,
4. monitor consumer,
5. hapus hanya pada major version atau agreed migration window.

### 13.4 Jangan reuse field dengan makna baru

Ini sangat berbahaya:

```json
{
  "status": "ACTIVE"
}
```

Awalnya `ACTIVE` berarti account bisa login. Lalu diubah menjadi account masih ada di database. Ini breaking walaupun tipe tidak berubah.

Semantic compatibility lebih penting daripada syntactic compatibility.

---

## 14. DTO Mapping Layer: Tempat Menaruh Translasi

DTO perlu mapping ke application command/domain object.

### 14.1 Jangan taruh domain mutation di DTO

Buruk:

```java
public final class CreateCaseRequest {
    public String applicantName;
    public String email;

    public CaseEntity toEntity() {
        CaseEntity entity = new CaseEntity();
        entity.setApplicantName(applicantName);
        entity.setEmail(email);
        entity.setStatus("SUBMITTED");
        return entity;
    }
}
```

Kenapa buruk?

- DTO tahu persistence entity,
- status default tersembunyi di boundary class,
- sulit test use-case rule,
- DTO menjadi tempat business logic,
- perubahan domain memaksa perubahan DTO.

Lebih baik:

```java
public final class CreateCaseMapper {
    public CreateCaseCommand toCommand(CreateCaseRequest request, UserContext user) {
        return new CreateCaseCommand(
            request.applicantName,
            request.email,
            user.userId()
        );
    }
}
```

Command:

```java
public record CreateCaseCommand(
    String applicantName,
    String email,
    String submittedBy
) {}
```

Application service:

```java
public CaseId create(CreateCaseCommand command) {
    CaseAggregate aggregate = CaseAggregate.submit(
        command.applicantName(),
        command.email(),
        command.submittedBy()
    );
    repository.save(aggregate);
    return aggregate.id();
}
```

### 14.2 Mapper manual vs generated

Manual mapper:

- eksplisit,
- aman untuk logic kompleks,
- cocok untuk boundary penting,
- sedikit boilerplate.

Generated mapper seperti MapStruct:

- cepat untuk mapping mekanis,
- compile-time safety,
- bagus untuk banyak DTO simple,
- tetap butuh review untuk field sensitif.

Reflection mapper generic:

- terlihat hemat,
- tetapi berisiko silent field copy,
- bisa membocorkan data,
- sulit diaudit.

Untuk enterprise boundary, mapping harus bisa dibaca manusia.

---

## 15. DTO dan Data Sensitif

DTO adalah salah satu tempat paling sering terjadi data leak.

### 15.1 Jangan rely pada `@JsonbTransient` saja

Misal domain/entity:

```java
public class UserEntity {
    public String userId;
    public String email;
    public String passwordHash;
    public String resetToken;
    public String internalRemark;
}
```

Menambahkan `@JsonbTransient` pada `passwordHash` membantu, tetapi itu bukan desain boundary yang sehat. Lebih aman adalah response DTO eksplisit:

```java
public final class UserResponse {
    public String userId;
    public String email;
}
```

Alasan:

- field baru di entity tidak otomatis terekspos,
- reviewer bisa melihat kontrak response,
- authorization bisa beda per DTO,
- serialization tidak bergantung pada annotation defensive.

### 15.2 Data classification dalam DTO review

Setiap field DTO sebaiknya bisa diklasifikasi:

| Kategori | Contoh | Perlakuan |
|---|---|---|
| public | status umum | bisa diekspos |
| user-owned | alamat/email applicant | perlu auth context |
| internal | officer remark | internal endpoint only |
| sensitive | NRIC/passport/payment token | mask/minimize |
| secret | password hash/token/key | jangan pernah expose |
| audit | createdBy, approvedBy | expose sesuai role |

DTO review harus bertanya:

- siapa audience field ini?
- apakah field ini perlu untuk use case?
- apakah bisa dimask?
- apakah boleh disimpan di client cache?
- apakah boleh masuk log?
- apakah boleh masuk audit trail?

---

## 16. Date/Time DTO Design

Date/time sering menjadi sumber bug lintas sistem.

### 16.1 Gunakan tipe yang tepat

| Kebutuhan | Java type | JSON shape |
|---|---|---|
| timestamp global | `Instant` | ISO-8601 UTC string |
| tanggal kalender | `LocalDate` | `YYYY-MM-DD` |
| waktu tanpa tanggal | `LocalTime` | `HH:mm:ss` |
| date-time dengan zona bisnis | `ZonedDateTime`/explicit zone | string + zone |
| durasi | `Duration` atau number | ISO duration atau seconds |

### 16.2 Jangan campur instant dengan local date-time

Buruk:

```json
{
  "submittedAt": "2026-06-17T10:30:00"
}
```

Tanpa timezone/offset, consumer tidak tahu apakah ini UTC, Asia/Jakarta, Singapore, atau server local time.

Lebih baik untuk timestamp:

```json
{
  "submittedAt": "2026-06-17T03:30:00Z"
}
```

Untuk tanggal bisnis:

```json
{
  "effectiveDate": "2026-06-17"
}
```

Tanggal bisnis tidak perlu timezone jika maknanya memang kalender lokal.

### 16.3 Timezone sebagai kontrak

Jika sistem lintas negara, jangan mengandalkan default JVM timezone.

DTO bisa eksplisit:

```json
{
  "appointmentStart": "2026-06-17T10:30:00+08:00",
  "timeZone": "Asia/Singapore"
}
```

Offset menjelaskan instant relatif UTC. Zone menjelaskan aturan kalender seperti DST dan local business rule.

---

## 17. Identifier DTO Design

Identifier sebaiknya tidak sembarang dipilih.

### 17.1 Jangan expose database id jika tidak perlu

Buruk:

```json
{
  "id": 12345
}
```

Risiko:

- enumeration attack,
- coupling ke database,
- sulit migrasi storage,
- terlihat tidak meaningful,
- bisa bocor volume data.

Lebih baik:

```json
{
  "caseId": "case_01HX7Y7Y9E4Y9PA2T7WJ6V8Y3R",
  "caseNo": "EA-2026-000123"
}
```

Pisahkan:

- technical id untuk API routing,
- business number untuk manusia.

### 17.2 Large numeric id sebagai string

Jika identifier bisa melebihi precision aman JavaScript, kirim sebagai string.

```json
{
  "documentId": "9007199254740993123"
}
```

Bukan:

```json
{
  "documentId": 9007199254740993123
}
```

---

## 18. Collection Design: Array Bukan Sekadar List

Array dalam JSON punya semantics.

### 18.1 Ordered vs unordered

Jika order penting, dokumentasikan.

```json
{
  "timeline": [
    {"event": "SUBMITTED", "at": "2026-06-01T01:00:00Z"},
    {"event": "ASSIGNED", "at": "2026-06-02T01:00:00Z"}
  ]
}
```

Di sini order mungkin chronological.

Jika order tidak penting, consumer tidak boleh bergantung pada urutan.

### 18.2 Empty vs absent

Response:

```json
{
  "documents": []
}
```

Lebih jelas daripada menghilangkan `documents` jika artinya memang “tidak ada dokumen”.

Namun untuk optional expensive expansion:

```json
{
  "caseNo": "EA-2026-000123"
}
```

Dan jika include documents:

```json
{
  "caseNo": "EA-2026-000123",
  "documents": []
}
```

Absent di sini berarti “tidak diminta/ tidak diexpand”, bukan “kosong”.

### 18.3 Pagination DTO

Jangan return unbounded array untuk data besar.

```java
public final class PageResponse<T> {
    public List<T> items;
    public PageMeta meta;
}

public final class PageMeta {
    public int limit;
    public String nextCursor;
    public boolean hasMore;
}
```

Cursor lebih stabil daripada offset untuk data yang berubah cepat.

---

## 19. Error DTO: Kontrak yang Sering Dilupakan

Error response juga DTO.

Jangan biarkan error response bergantung pada exception internal.

Buruk:

```json
{
  "exception": "java.lang.NullPointerException",
  "message": "Cannot invoke ...",
  "stackTrace": "..."
}
```

Lebih baik:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "correlationId": "9f3c7e2a0c",
  "violations": [
    {
      "field": "email",
      "code": "INVALID_EMAIL",
      "message": "email must be a valid email address"
    }
  ]
}
```

DTO:

```java
public final class ErrorResponse {
    public String errorCode;
    public String message;
    public String correlationId;
    public List<FieldViolationResponse> violations;
}

public final class FieldViolationResponse {
    public String field;
    public String code;
    public String message;
}
```

Prinsip:

- stable `errorCode`,
- human-readable `message`,
- machine-readable violation code,
- correlation id untuk tracing,
- jangan expose stack trace,
- jangan expose SQL/internal class name,
- jangan leak authorization detail.

---

## 20. DTO dan Audit Trail

Dalam sistem regulatori/enterprise, DTO design harus memikirkan audit.

Pertanyaan audit:

- request apa yang diterima?
- field apa yang diubah?
- siapa actor-nya?
- kapan terjadi?
- dari channel mana?
- validasi apa yang gagal?
- rule mana yang dipakai?
- response decision apa yang dikirim?

### 20.1 Audit raw JSON vs normalized command

Raw JSON berguna untuk forensics, tetapi berisiko menyimpan data sensitif.

Normalized command lebih aman untuk audit bisnis.

Contoh audit event:

```json
{
  "eventType": "APPLICANT_EMAIL_CHANGED",
  "caseNo": "EA-2026-000123",
  "actor": "officer_123",
  "changes": [
    {
      "field": "email",
      "oldValueMasked": "a***@old.com",
      "newValueMasked": "a***@new.com"
    }
  ],
  "reason": "Applicant requested correction",
  "correlationId": "9f3c7e2a0c"
}
```

DTO PATCH yang terlalu generic menyulitkan audit. Action-specific DTO sering lebih jelas.

---

## 21. DTO dan Idempotency

Create/update command dalam sistem enterprise sering perlu idempotency.

Contoh request:

```json
{
  "idempotencyKey": "client-req-20260617-0001",
  "applicationType": "EA",
  "applicant": {
    "fullName": "Alice Tan",
    "email": "alice@example.com"
  }
}
```

DTO:

```java
public final class CreateApplicationRequest {
    public String idempotencyKey;
    public String applicationType;
    public ApplicantRequest applicant;
}
```

Namun idempotency key kadang lebih baik sebagai header daripada body:

```text
Idempotency-Key: client-req-20260617-0001
```

Pertimbangan:

| Lokasi | Kelebihan | Kekurangan |
|---|---|---|
| Header | transport concern jelas, reusable | tidak masuk DTO body |
| Body | masuk audit payload bisnis | bisa tercampur domain data |

Yang penting adalah semantics:

- key unik per operation intent,
- retry dengan key sama menghasilkan result sama,
- payload berbeda dengan key sama harus ditolak,
- retention window jelas,
- response replay aman.

---

## 22. DTO dan Concurrency Control

DTO update harus mencegah lost update.

### 22.1 ETag/header based

```text
If-Match: "v7"
```

Jika version tidak cocok, return conflict/precondition failed.

### 22.2 Body based

```json
{
  "expectedVersion": 7,
  "newEmail": "alice@example.com",
  "reason": "Correction"
}
```

DTO:

```java
public final class ChangeEmailRequest {
    public long expectedVersion;
    public String newEmail;
    public String reason;
}
```

Untuk internal enterprise workflow, body-based expected version sering lebih mudah diaudit. Untuk HTTP API murni, ETag lebih sesuai protocol semantics.

---

## 23. DTO dan Hypermedia/Links

Tidak semua API perlu HATEOAS penuh. Tetapi response enterprise sering butuh action affordance.

Contoh:

```json
{
  "caseNo": "EA-2026-000123",
  "status": "PENDING_REVIEW",
  "availableActions": [
    {
      "rel": "approve",
      "method": "POST",
      "href": "/cases/EA-2026-000123/actions/approve"
    },
    {
      "rel": "request-clarification",
      "method": "POST",
      "href": "/cases/EA-2026-000123/actions/request-clarification"
    }
  ]
}
```

Keuntungan:

- UI tidak hardcode semua state transition,
- backend bisa expose action sesuai role/status,
- mengurangi invalid operation,
- workflow lebih discoverable.

Namun jangan berlebihan. Untuk internal UI + backend yang dikembangkan tim sama, simple `availableActions` sering cukup.

---

## 24. JSON-B DTO di Java 8–25

### 24.1 Java 8

Baseline Java 8:

- belum ada records,
- belum ada sealed classes,
- `java.time` sudah ada,
- module system belum ada,
- banyak stack masih `javax.*`,
- Java EE/Jakarta EE transition perlu hati-hati.

DTO style yang aman:

```java
public final class ApplicantResponse {
    private String applicantId;
    private String fullName;

    public ApplicantResponse() {
    }

    public ApplicantResponse(String applicantId, String fullName) {
        this.applicantId = applicantId;
        this.fullName = fullName;
    }

    public String getApplicantId() {
        return applicantId;
    }

    public void setApplicantId(String applicantId) {
        this.applicantId = applicantId;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }
}
```

Verbose, tetapi compatible.

### 24.2 Java 11+

Java 11 penting karena banyak Java EE module lama tidak lagi ada di JDK. Untuk JSON-B/Jakarta API, dependency eksplisit adalah praktik normal.

DTO tetap bisa class biasa. Perhatikan module/classpath behavior jika masuk JPMS.

### 24.3 Java 16+

Records bisa dipakai untuk DTO immutable.

```java
public record ApplicantResponse(String applicantId, String fullName) {}
```

Gunakan jika provider stack mendukung dengan baik dan compatibility target mengizinkan.

### 24.4 Java 17+

Java 17 LTS memungkinkan sealed type untuk model tertutup.

```java
public sealed interface NotificationRequest
    permits EmailNotificationRequest, SmsNotificationRequest {
}
```

Tetap hati-hati untuk external polymorphic binding.

### 24.5 Java 21–25

Untuk Java modern, DTO design bisa memanfaatkan:

- records,
- sealed classes,
- pattern matching,
- virtual threads di surrounding request handling,
- improved runtime performance.

Tetapi wire contract JSON tetap tidak peduli fitur Java internal. Jangan membuat kontrak external terlalu bergantung pada shape class Java modern yang mungkin berubah.

---

## 25. DTO Testing Strategy

DTO harus diuji sebagai contract, bukan hanya object biasa.

### 25.1 Serialization golden test

```java
@Test
void serializesCaseListItemAsContract() {
    CaseListItemResponse response = new CaseListItemResponse();
    response.caseNo = "EA-2026-000123";
    response.status = "SUBMITTED";
    response.submittedAt = Instant.parse("2026-06-17T03:30:00Z");

    String json = jsonb.toJson(response);

    assertThat(json).contains("\"caseNo\":");
    assertThat(json).contains("\"status\":");
    assertThat(json).contains("\"submittedAt\":");
}
```

Lebih baik lagi gunakan JSON assertion, bukan string contains.

### 25.2 Deserialization test

```java
@Test
void deserializesCreateApplicantRequest() {
    String json = """
        {
          "fullName": "Alice Tan",
          "email": "alice@example.com"
        }
        """;

    CreateApplicantRequest request = jsonb.fromJson(json, CreateApplicantRequest.class);

    assertThat(request.fullName).isEqualTo("Alice Tan");
    assertThat(request.email).isEqualTo("alice@example.com");
}
```

### 25.3 Unknown field test

Jika strict policy:

```java
@Test
void rejectsUnknownField() {
    JsonObject raw = parse("""
        {
          "fullName": "Alice",
          "email": "alice@example.com",
          "role": "ADMIN"
        }
        """);

    assertThatThrownBy(() -> rejectUnknownFields(raw))
        .hasMessageContaining("Unknown field: role");
}
```

### 25.4 Compatibility test

Simpan sample payload lama.

```text
src/test/resources/contracts/v1/create-applicant-request.json
src/test/resources/contracts/v1/case-detail-response.json
src/test/resources/contracts/v2/case-detail-response.json
```

Test bahwa payload lama masih bisa dibaca atau response baru masih memenuhi expectation consumer.

### 25.5 Sensitive field test

```java
@Test
void userResponseDoesNotExposeSecrets() {
    UserResponse response = mapper.toResponse(userEntityWithSecrets());
    String json = jsonb.toJson(response);

    assertThat(json).doesNotContain("passwordHash");
    assertThat(json).doesNotContain("resetToken");
    assertThat(json).doesNotContain("internalRemark");
}
```

Test seperti ini terlihat sederhana, tetapi sangat berharga.

---

## 26. Production DTO Checklist

Gunakan checklist ini sebelum DTO dianggap siap production.

### 26.1 Contract checklist

- Apakah DTO use-case specific?
- Apakah inbound dan outbound dipisahkan?
- Apakah field naming stabil dan konsisten?
- Apakah required/optional jelas?
- Apakah null vs absent semantics jelas?
- Apakah unknown field policy jelas?
- Apakah enum evolution dipikirkan?
- Apakah date/time format eksplisit?
- Apakah numeric precision aman?
- Apakah identifier aman diexpose?

### 26.2 Security checklist

- Apakah DTO tidak memakai entity/domain langsung?
- Apakah field sensitive tidak terekspos?
- Apakah log/audit masking jelas?
- Apakah polymorphism memakai allowlist?
- Apakah unknown field untuk command endpoint ditolak?
- Apakah error DTO tidak expose internal detail?
- Apakah mass assignment dicegah?

### 26.3 Validation checklist

- Apakah syntactic validation ada?
- Apakah semantic validation ada?
- Apakah authorization-aware validation ada?
- Apakah PATCH allowlist ada?
- Apakah duplicate/conflicting field behavior jelas?
- Apakah defaulting dilakukan server-side secara eksplisit?

### 26.4 Compatibility checklist

- Apakah perubahan DTO bisa backward compatible?
- Apakah deprecated field punya migration plan?
- Apakah sample payload lama dites?
- Apakah consumer bisa handle new response field?
- Apakah response enum bisa bertambah?
- Apakah major breaking change punya versi baru?

### 26.5 Operational checklist

- Apakah DTO size dibatasi?
- Apakah collection dipaginasi?
- Apakah large nested object dihindari?
- Apakah correlation id masuk error response?
- Apakah idempotency/concurrency control dipikirkan?
- Apakah audit event bisa menjelaskan perubahan?

---

## 27. Decision Matrix: DTO Design Patterns

| Situasi | Pattern yang disarankan | Hindari |
|---|---|---|
| create resource | `CreateXRequest` use-case specific | reuse entity/response DTO |
| replace resource | `ReplaceXRequest` complete representation | partial DTO ambigu |
| partial update sederhana | JSON Merge Patch atau tri-state DTO | POJO biasa tanpa presence tracking |
| lifecycle action | action-specific command DTO | generic PATCH untuk state machine |
| response list | lightweight item response | detail response besar |
| response detail | audience-specific detail response | satu DTO untuk semua role |
| data sensitif | explicit response DTO + masking | rely pada blacklist annotation |
| polymorphic request | discriminator allowlist | class-name based polymorphism |
| status response | stable group + detailed status | expose internal state machine mentah |
| high precision number | string decimal atau explicit scale | JSON number sembarang |
| large data | pagination/cursor | unbounded array |
| contract evolution | additive fields + deprecation | rename/reuse semantic field |

---

## 28. Worked Example: Case Management DTO Design

Misal sistem case management memiliki use case:

- applicant submit application,
- officer list cases,
- officer view case detail,
- officer request clarification,
- applicant update contact,
- supervisor approve/reject.

### 28.1 Create application

```java
public final class SubmitApplicationRequest {
    public String idempotencyKey;
    public String applicationType;
    public ApplicantSubmission applicant;
    public List<DocumentSubmission> documents;
}

public final class ApplicantSubmission {
    public String fullName;
    public String email;
    public String phoneNumber;
}

public final class DocumentSubmission {
    public String documentType;
    public String uploadedFileId;
}
```

Tidak ada:

- status,
- caseNo,
- assignedOfficer,
- riskScore,
- internalRemark.

### 28.2 Submit response

```java
public final class SubmitApplicationResponse {
    public String caseNo;
    public String status;
    public Instant submittedAt;
    public String nextStepMessage;
}
```

### 28.3 Officer list response

```java
public final class OfficerCaseListItemResponse {
    public String caseNo;
    public String applicationType;
    public String applicantNameMasked;
    public String status;
    public String statusGroup;
    public Instant submittedAt;
    public String priority;
}
```

Ringan untuk list.

### 28.4 Officer detail response

```java
public final class OfficerCaseDetailResponse {
    public String caseNo;
    public String applicationType;
    public String status;
    public String statusGroup;
    public ApplicantOfficerView applicant;
    public List<DocumentOfficerView> documents;
    public List<TimelineItemResponse> timeline;
    public List<AvailableActionResponse> availableActions;
}
```

### 28.5 Action-specific request

```java
public final class RequestClarificationRequest {
    public long expectedVersion;
    public String clarificationReason;
    public List<String> requestedDocumentTypes;
}
```

```java
public final class ApproveCaseRequest {
    public long expectedVersion;
    public String decisionReason;
    public String internalRemark;
}
```

```java
public final class RejectCaseRequest {
    public long expectedVersion;
    public String rejectionReasonCode;
    public String rejectionExplanation;
}
```

Keuntungan:

- setiap action punya reason,
- audit mudah,
- validation spesifik,
- authorization jelas,
- state transition eksplisit.

---

## 29. Anti-Patterns yang Harus Dihindari

### 29.1 Entity as DTO

```java
return repository.findAll();
```

Ini mengikat API ke persistence.

### 29.2 God DTO

Satu DTO untuk semua endpoint.

Akibat:

- field membengkak,
- validation bercabang,
- security sulit,
- compatibility rapuh.

### 29.3 Blind mapper

```java
BeanUtils.copyProperties(request, entity);
```

Risiko mass assignment.

### 29.4 Generic update map

```java
Map<String, Object> updates
```

Bisa berguna untuk internal low-level patch, tetapi buruk sebagai command contract jika tidak ada allowlist dan validation kuat.

### 29.5 Domain inheritance exposed as JSON inheritance

Inheritance internal tidak otomatis berarti polymorphic API bagus.

### 29.6 Null as universal default

Jika semua optional field pakai null tanpa semantics, PATCH dan validation akan penuh bug.

### 29.7 Response mengikuti kebutuhan UI saat ini saja

DTO harus melayani use case, tetapi jangan terlalu menempel ke layout UI sehingga setiap perubahan UI memecah API.

---

## 30. Top 1% Mental Model

Engineer biasa bertanya:

> Bagaimana cara serialize object ini ke JSON?

Engineer senior bertanya:

> Object apa yang seharusnya menjadi kontrak JSON?

Engineer top-level bertanya:

> Kontrak ini akan berevolusi bagaimana selama lima tahun, actor mana yang boleh melihat/mengubah field ini, bagaimana null/absent/enum/versioning bekerja, bagaimana audit menjelaskan perubahan, bagaimana consumer lama tetap hidup, dan bagaimana kegagalan binding/validation/security terlihat secara operasional?

DTO design yang matang memiliki ciri:

1. shape-nya eksplisit,
2. use-case specific,
3. tidak membocorkan domain/entity,
4. tidak mengandalkan default provider secara buta,
5. punya null/absent semantics,
6. punya validation boundary,
7. punya compatibility strategy,
8. punya security review,
9. punya audit story,
10. punya contract tests.

JSON-B membantu binding. Tetapi kontrak yang tahan lama lahir dari desain boundary yang disiplin.

---

## 31. Ringkasan

Pada Part 10 ini kita mempelajari:

- DTO adalah boundary contract, bukan object sementara.
- Inbound dan outbound DTO harus dipisah.
- DTO harus use-case specific.
- Domain/entity tidak boleh langsung menjadi JSON contract.
- Null, absent, empty, dan default harus punya makna jelas.
- PATCH sering membutuhkan JSON-P atau tri-state model, bukan POJO biasa.
- Unknown field policy harus eksplisit.
- Records berguna untuk Java modern, tetapi bukan baseline universal Java 8–25.
- Polymorphism harus memakai discriminator allowlist dan tidak boleh membiarkan client memilih arbitrary class.
- Enum response harus punya strategi evolusi.
- Date/time, identifier, collection, error response, audit, idempotency, dan concurrency adalah bagian dari desain DTO.
- DTO harus diuji sebagai contract melalui serialization/deserialization/compatibility/security tests.

---

## 32. Referensi

- Jakarta JSON Binding Specification: https://jakarta.ee/specifications/jsonb/
- Jakarta JSON Binding 3.0: https://jakarta.ee/specifications/jsonb/3.0/
- Jakarta JSON Binding API Docs: https://jakarta.ee/specifications/jsonb/3.0/apidocs/
- Jakarta JSON Binding Tutorial: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonb/jsonb.html
- Jakarta Validation 3.1: https://jakarta.ee/specifications/bean-validation/3.1/
- Jakarta Validation: https://beanvalidation.org/
- RFC 6902 — JSON Patch: https://www.rfc-editor.org/rfc/rfc6902
- RFC 7396 — JSON Merge Patch: https://www.rfc-editor.org/rfc/rfc7396
- RFC 8259 — The JavaScript Object Notation Data Interchange Format: https://www.rfc-editor.org/rfc/rfc8259

---

## 33. Status Seri

Seri belum selesai.

Part ini adalah **Part 10 dari 34**.

Berikutnya: **Part 11 — JSON Security & Robustness**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration-part-009](./learn-java-json-xml-soap-connectors-enterprise-integration-part-009.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 011](./learn-java-json-xml-soap-connectors-enterprise-integration-part-011.md)
