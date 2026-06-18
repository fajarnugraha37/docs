# 00 — Orientation: Data Transformation as Software Boundary

**Series:** `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
**Part:** 0 of 35  
**File:** `00-orientation-data-transformation-as-software-boundary.md`  
**Target Java:** Java 8 sampai Java 25  
**Main Theme:** data mapper, JSON, XML, Jackson, MapStruct, Lombok, object transformation engineering  

---

## Tujuan Bagian Ini

Bagian ini membentuk fondasi mental sebelum masuk ke Jackson, XML, MapStruct, Lombok, records, builder, custom serializer, annotation processor, contract test, dan migration playbook.

Inti dari bagian ini:

> Object mapping bukan pekerjaan mekanis “copy field A ke field B”. Object mapping adalah **boundary engineering**: proses mengubah representasi data dari satu konteks ke konteks lain sambil menjaga makna, keamanan, kompatibilitas, auditability, dan evolusi sistem.

Seorang engineer biasa melihat mapping seperti ini:

```java
userDto.setName(user.getName());
userDto.setEmail(user.getEmail());
```

Engineer senior melihat pertanyaan yang lebih dalam:

- Apakah `name` di source dan target benar-benar punya makna yang sama?
- Apakah `email` boleh keluar ke response ini?
- Apakah field null berarti “tidak dikirim”, “hapus value”, “belum diketahui”, atau “tidak berlaku”?
- Apakah enum baru akan merusak consumer lama?
- Apakah mapping ini memicu lazy loading dan menyebabkan N+1 query?
- Apakah field internal seperti `statusReasonInternalNote` bocor ke public API?
- Apakah perubahan DTO ini backward compatible?
- Apakah mapping ini deterministic dan bisa diaudit?
- Apakah mapper ini hanya transformasi atau diam-diam menjalankan business decision?
- Apakah generated code dari MapStruct/Lombok akan tetap stabil ketika Java/Jackson versi naik?

Bagian 0 ini menjawab: **bagaimana cara berpikir tentang semua itu.**

---

## 1. Kenapa Data Transformation Layak Dipelajari Secara Mendalam?

Di banyak sistem enterprise, terutama sistem case management, regulatory workflow, financial workflow, insurance, public service, healthcare, logistics, dan integration-heavy systems, bug paling berbahaya sering bukan berasal dari algoritma kompleks. Bug sering muncul dari transformasi data yang terlihat sederhana.

Contoh sederhana:

```json
{
  "status": "APPROVED",
  "remarks": null
}
```

Pertanyaannya:

- Apakah `remarks: null` berarti user ingin menghapus remarks?
- Apakah berarti user tidak mengubah remarks?
- Apakah berarti remarks memang tidak wajib?
- Apakah berarti client lama belum mengenal field tersebut?
- Apakah berarti serializer mengirim null karena default configuration?

Jika sistem memperlakukan semua null sama, maka bug bisa muncul:

- data lama terhapus tanpa sengaja,
- audit trail salah,
- approval workflow berubah state tanpa alasan yang benar,
- consumer event salah interpretasi,
- UI menampilkan informasi yang misleading,
- downstream system menerima payload yang secara syntax valid tetapi secara semantic salah.

Mapping layer adalah salah satu tempat utama di mana **syntax berubah menjadi meaning**.

---

## 2. Definisi Praktis: Apa Itu Data Transformation?

Dalam konteks Java backend, data transformation adalah proses mengubah satu representasi data menjadi representasi lain.

Contoh bentuk transformasi:

```text
HTTP JSON Request
    -> Request DTO
    -> Command Object
    -> Domain Object / Aggregate
    -> Persistence Entity
    -> Database Row
    -> Domain Event
    -> Integration Payload
    -> Audit Payload
    -> Response DTO
    -> HTTP JSON Response
```

Setiap panah di atas adalah boundary. Setiap boundary punya aturan sendiri.

Contoh:

| Boundary | Source | Target | Risiko Utama |
|---|---|---|---|
| API inbound | JSON | Request DTO | over-posting, unknown field, null ambiguity |
| Application | Request DTO | Command | validation leakage, wrong semantic conversion |
| Domain | Command | Aggregate change | invariant rusak, state transition tidak sah |
| Persistence | Aggregate | Entity | identity confusion, dirty checking, partial update bug |
| API outbound | Domain/Projection | Response DTO | data leakage, lazy loading, circular graph |
| Integration | Internal model | External payload | incompatible contract, format drift |
| Event | Domain state | Event DTO | backward compatibility, consumer breakage |
| Audit | Operation context | Audit record | missing raw input, non-replayable history |

Mental model penting:

> Mapping bukan hanya mengubah bentuk data. Mapping adalah tempat di mana sistem memutuskan bagian mana dari realitas internal yang boleh, harus, atau tidak boleh direpresentasikan ke konteks lain.

---

## 3. Object Shape vs Semantic Meaning

Dua object bisa punya shape yang sama tetapi meaning berbeda.

Contoh:

```java
class UserRegistrationRequest {
    String name;
    String email;
    String role;
}

class UserResponse {
    String name;
    String email;
    String role;
}
```

Secara shape mirip. Tetapi secara meaning berbeda.

Pada request:

```text
role = role yang diminta oleh client
```

Pada response:

```text
role = role efektif yang sudah diverifikasi dan diberikan sistem
```

Jika mapper asal copy, user bisa melakukan privilege escalation:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "role": "ADMIN"
}
```

Masalahnya bukan Jackson. Masalahnya adalah desain boundary.

Rule:

> Field dengan nama sama belum tentu punya makna sama. Field dengan tipe sama belum tentu punya constraint sama. Field yang bisa dibaca belum tentu boleh ditulis.

---

## 4. Boundary: Konsep Paling Penting dalam Seri Ini

Boundary adalah perbatasan antara dua konteks yang memiliki aturan berbeda.

Dalam Java backend, boundary bisa berupa:

- client/server boundary,
- public/internal API boundary,
- controller/application boundary,
- application/domain boundary,
- domain/persistence boundary,
- sync/async boundary,
- service/service boundary,
- module/module boundary,
- database/application boundary,
- old system/new system boundary,
- Java object/JSON boundary,
- Java object/XML boundary,
- trusted/untrusted input boundary.

Mapping adalah mekanisme yang menjaga boundary tetap eksplisit.

Tanpa boundary yang jelas, object internal akan bocor keluar:

```java
@GetMapping("/users/{id}")
public UserEntity getUser(@PathVariable Long id) {
    return userRepository.findById(id).orElseThrow();
}
```

Ini terlihat cepat, tetapi membuka banyak risiko:

- semua field entity berpotensi terserialisasi,
- relasi lazy bisa terpanggil,
- struktur database bocor ke API,
- perubahan entity menjadi breaking API change,
- field internal/audit/security bisa ikut keluar,
- circular reference bisa muncul,
- consumer jadi bergantung ke persistence model.

Boundary yang lebih sehat:

```java
@GetMapping("/users/{id}")
public UserResponse getUser(@PathVariable Long id) {
    User user = userApplicationService.getUser(id);
    return userResponseMapper.toResponse(user);
}
```

Di sini mapping layer memutuskan bentuk response secara sadar.

---

## 5. Representasi Data Berubah Karena Konteks Berubah

Satu konsep bisnis bisa punya banyak representasi.

Contoh konsep: `Application`

| Context | Representasi | Tujuan |
|---|---|---|
| API request | `CreateApplicationRequest` | menerima input dari client |
| Application layer | `CreateApplicationCommand` | instruksi use case |
| Domain | `Application` aggregate | state dan invariant bisnis |
| Persistence | `ApplicationEntity` | mapping ke table |
| Query | `ApplicationListProjection` | optimized listing |
| Response | `ApplicationDetailResponse` | data untuk UI |
| Event | `ApplicationSubmittedEvent` | komunikasi async |
| Audit | `ApplicationAuditRecord` | regulatory trace |
| Integration | `ExternalApplicationPayload` | kontrak dengan sistem lain |

Kesalahan umum adalah memaksa satu class dipakai di semua tempat.

Contoh anti-pattern:

```java
class ApplicationDto {
    Long id;
    String applicantName;
    String status;
    String internalRemarks;
    String externalRemarks;
    LocalDateTime createdAt;
    LocalDateTime updatedAt;
    String createdBy;
    String updatedBy;
    List<DocumentDto> documents;
    List<ApprovalDto> approvals;
    List<AuditDto> audits;
}
```

Awalnya praktis. Lama-lama menjadi “God DTO”. Semua screen, semua API, semua event, semua integration memakai object yang sama. Dampaknya:

- field bertambah tanpa governance,
- consumer tidak jelas siapa yang butuh field apa,
- backward compatibility sulit dijaga,
- response terlalu besar,
- sensitive data gampang bocor,
- serializer configuration penuh pengecualian,
- mapper jadi penuh kondisi `if screen == X`,
- object kehilangan makna.

Rule:

> Semakin banyak konteks memakai object yang sama, semakin kabur makna object tersebut.

---

## 6. Mapping sebagai Translation, Bukan Transportation

Banyak engineer memperlakukan mapping seperti transportasi:

```text
Ambil data dari A, pindahkan ke B.
```

Mental model yang lebih tepat adalah translasi:

```text
Ambil makna dari konteks A, representasikan ulang secara benar untuk konteks B.
```

Analogi bahasa:

- “Case is closed” di konteks hukum bisa berarti proses hukum selesai.
- “Case is closed” di konteks customer support bisa berarti ticket ditutup.
- Kata sama, arti operasional berbeda.

Dalam software:

```java
source.getStatus()
```

Tidak otomatis sama dengan:

```java
target.setStatus(...)
```

Mungkin butuh mapping:

```text
Domain status: SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, WITHDRAWN
UI status: Pending, Processing, Completed, Unsuccessful, Cancelled
External status: S, P, A, R, W
Audit status: BEFORE -> AFTER with actor and reason
```

Mapping yang baik mempertahankan meaning, bukan sekadar field.

---

## 7. Kategori Transformasi Data

Dalam seri ini, kita akan sering membedakan beberapa jenis transformasi.

### 7.1 Structural Copy

Copy field yang memang setara.

```java
response.setId(user.getId());
response.setName(user.getName());
```

Aman jika:

- meaning sama,
- visibility sama,
- constraint sama,
- tidak butuh policy,
- perubahan source tidak otomatis harus mengubah target.

### 7.2 Type Conversion

Mengubah tipe teknis.

```text
String -> UUID
String -> LocalDate
BigDecimal -> String
Integer -> Enum
Instant -> OffsetDateTime
```

Risiko:

- timezone salah,
- decimal precision hilang,
- invalid format,
- locale-dependent parsing,
- enum unknown value.

### 7.3 Semantic Conversion

Mengubah meaning antar konteks.

```text
Domain APPROVED -> API "approved"
External "A" -> Domain APPROVED
Internal risk score 800 -> UI category "High"
```

Risiko:

- mapping table tidak lengkap,
- default value misleading,
- status baru tidak dikenali,
- consumer salah mengambil keputusan.

### 7.4 Normalization

Membersihkan atau menstandarkan input.

```text
"  alice@example.com " -> "alice@example.com"
"SG-123456" -> "123456"
"yes" -> true
```

Risiko:

- normalization mengubah bukti raw input,
- normalisasi terlalu agresif,
- data yang seharusnya ditolak malah diperbaiki diam-diam.

### 7.5 Enrichment

Menambahkan data dari sumber lain.

```text
postalCode -> address details
userId -> user display name
code -> code description
```

Risiko:

- mapper menjadi service layer,
- mapping tidak deterministic,
- external call di mapper,
- performance collapse,
- sulit dites.

### 7.6 Redaction / Masking

Menghapus atau menyamarkan data.

```text
NRIC: S1234567A -> S****567A
Email: alice@example.com -> a***@example.com
Internal remarks -> omitted
```

Risiko:

- sensitive data bocor,
- inconsistent masking,
- audit dan public response memakai rule yang sama padahal seharusnya berbeda.

### 7.7 Projection

Mengambil subset data untuk use case tertentu.

```text
ApplicationDetail -> ApplicationListItem
User -> UserSummary
Case -> CaseSearchResult
```

Risiko:

- projection memicu lazy loading,
- list API membawa object graph terlalu besar,
- query inefficient karena mapping dilakukan setelah fetch terlalu banyak data.

### 7.8 Aggregation

Menggabungkan banyak source menjadi target.

```text
Application + Applicant + Documents + LatestDecision -> ApplicationDetailResponse
```

Risiko:

- hidden query storm,
- partial failure,
- source freshness berbeda,
- response terlihat konsisten padahal data berasal dari snapshot berbeda.

---

## 8. Mapping Bukan Tempat Semua Logic

Mapper sering menjadi tempat “nyelipin logic”. Ini berbahaya.

Contoh mapper yang mulai membusuk:

```java
public ApplicationResponse toResponse(Application application) {
    ApplicationResponse response = new ApplicationResponse();
    response.setId(application.getId());
    response.setStatus(application.getStatus().name());

    if (application.getStatus() == Status.APPROVED &&
        application.getExpiryDate().isBefore(LocalDate.now())) {
        response.setStatus("EXPIRED");
    }

    if (securityService.currentUserHasRole("ADMIN")) {
        response.setInternalRemarks(application.getInternalRemarks());
    }

    response.setOfficerName(userService.findName(application.getOfficerId()));

    return response;
}
```

Masalah:

- status domain dimodifikasi di response mapper,
- mapper bergantung pada waktu (`LocalDate.now()`),
- mapper bergantung pada security context,
- mapper melakukan lookup service,
- output sulit diprediksi,
- test mapper menjadi test business/security/integration.

Mapping boleh mengandung policy ringan, tetapi harus jelas jenisnya.

Lebih baik pisahkan:

```text
ApplicationService
    -> menghitung effective status
    -> menentukan visibility policy
    -> mengambil data enrichment yang diperlukan
    -> membentuk view model input
Mapper
    -> mengubah view model ke response DTO
```

Rule praktis:

> Mapper boleh tahu cara mengubah bentuk. Mapper tidak boleh diam-diam menentukan keputusan bisnis utama.

Namun ada pengecualian yang sah:

- redaction policy khusus response,
- format conversion,
- enum translation,
- default representasi output,
- flattening/unflattening,
- deterministic derived field ringan.

Kuncinya: deterministic, local, testable, dan bukan decision engine.

---

## 9. Null, Missing, Empty, Default: Empat Hal yang Berbeda

Salah satu penyebab bug mapping terbesar adalah menyamakan `null`, missing field, empty value, dan default value.

### 9.1 Missing Field

Payload:

```json
{
  "name": "Alice"
}
```

Field `email` tidak dikirim.

Makna mungkin:

- client tidak ingin mengubah email,
- client versi lama belum mengenal email,
- email tidak relevan untuk operation ini,
- request invalid karena email wajib.

### 9.2 Explicit Null

Payload:

```json
{
  "email": null
}
```

Makna mungkin:

- hapus email,
- email belum diketahui,
- client sengaja mengirim kosong,
- request invalid karena email tidak boleh null.

### 9.3 Empty Value

Payload:

```json
{
  "email": ""
}
```

Makna mungkin:

- user input kosong,
- perlu trim dan validasi,
- invalid email,
- legacy client mengirim empty string untuk null.

### 9.4 Default Value

Java object:

```java
boolean active; // default false
int retryCount; // default 0
```

Makna mungkin:

- client mengirim false/0,
- field tidak dikirim lalu Java memberi default,
- deserializer defaulting,
- nilai belum dihitung.

Kesalahan besar:

```java
if (!request.isActive()) {
    deactivateUser();
}
```

Jika field `active` tidak dikirim, primitive boolean tetap `false`. Sistem bisa menonaktifkan user tanpa niat client.

Rule:

> Untuk inbound DTO, gunakan wrapper type (`Boolean`, `Integer`) ketika perlu membedakan “tidak dikirim” dari “dikirim dengan nilai false/0”. Untuk PATCH, missing dan null harus punya semantic yang eksplisit.

---

## 10. Mapping dan Security

Mapping layer adalah security boundary.

### 10.1 Over-Posting / Mass Assignment

Contoh request:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "role": "ADMIN",
  "accountLocked": false,
  "approvedBy": "self"
}
```

Jika request langsung di-bind ke entity:

```java
@PostMapping("/users")
public void create(@RequestBody UserEntity user) {
    userRepository.save(user);
}
```

Client bisa mengirim field yang tidak seharusnya bisa ditulis.

DTO inbound harus deny-by-default:

```java
class CreateUserRequest {
    String name;
    String email;
}
```

Role, locked status, approval, audit metadata harus ditentukan server.

### 10.2 Data Leakage

Outbound risk:

```java
class UserEntity {
    Long id;
    String name;
    String email;
    String passwordHash;
    String resetToken;
    String internalNotes;
}
```

Jika entity langsung diserialisasi, field sensitive bisa bocor.

DTO outbound harus allow-by-design:

```java
class UserResponse {
    Long id;
    String name;
}
```

### 10.3 Polymorphic Deserialization Risk

Ketika deserializer menerima type information dari payload, ada potensi risiko serius jika tipe yang boleh dibuat terlalu luas. Ini akan dibahas mendalam pada bagian Jackson polymorphism dan security.

Rule awal:

> Jangan pernah mengaktifkan polymorphic/default typing secara luas untuk input tidak trusted tanpa allowlist type yang ketat.

### 10.4 Error Message Leakage

Mapping error juga bisa membocorkan detail internal.

Buruk:

```json
{
  "error": "Cannot deserialize com.company.internal.caseworkflow.ApprovalEntity[approvalSecret]"
}
```

Lebih aman:

```json
{
  "error": "Invalid request payload",
  "field": "approvalStatus",
  "reason": "Unsupported value"
}
```

Internal log boleh lebih detail, tetapi harus hati-hati dengan PII dan secret.

---

## 11. Mapping dan Compatibility

Di sistem jangka panjang, object shape berubah. Compatibility menjadi kunci.

### 11.1 Additive Change

Menambah field response biasanya relatif aman:

```json
{
  "id": 1,
  "name": "Alice",
  "preferredLanguage": "en"
}
```

Tetapi tetap bisa bermasalah jika consumer strict dan gagal ketika menemukan unknown field.

### 11.2 Removing Field

Menghapus field biasanya breaking change.

Consumer lama mungkin masih membaca:

```json
{
  "status": "APPROVED"
}
```

Jika field `status` hilang, consumer gagal atau salah default.

### 11.3 Renaming Field

Renaming adalah remove + add.

```text
applicantName -> customerName
```

Jika harus dilakukan, biasanya butuh masa transisi:

- support old and new field inbound,
- output both fields sementara,
- dokumentasikan deprecation,
- ukur consumer usage,
- hapus setelah window aman.

### 11.4 Changing Meaning

Paling berbahaya adalah field sama tetapi makna berubah.

Sebelumnya:

```text
status = current workflow state
```

Setelah perubahan:

```text
status = effective display status
```

Ini breaking secara semantic walaupun JSON schema tidak berubah.

Rule:

> Compatibility bukan hanya soal field ada atau tidak. Compatibility juga soal meaning, allowed values, timing, nullability, ordering, precision, dan side effect interpretasi.

---

## 12. Mapping dan Auditability

Dalam sistem regulatory atau case management, mapping harus bisa diaudit.

Pertanyaan penting:

- Apa input mentah yang diterima?
- Apa hasil normalisasi?
- Apa field yang ditolak?
- Apa field yang diabaikan?
- Siapa actor yang memicu mapping?
- Versi mapper/contract mana yang berlaku?
- Apa perbedaan before/after?
- Apakah transformasi deterministic?
- Apakah hasil bisa direplay?

Contoh audit-friendly thinking:

```text
Raw request:
  statusReason = "  insufficient docs "

Normalized command:
  statusReason = "insufficient docs"

Domain event:
  ApplicationRejected(reasonCode=INSUFFICIENT_DOCUMENTS)

Audit record:
  beforeStatus = UNDER_REVIEW
  afterStatus = REJECTED
  actor = officer-123
  reasonTextRaw = "  insufficient docs "
  reasonTextNormalized = "insufficient docs"
```

Jika hanya menyimpan hasil akhir, investigasi akan sulit.

Rule:

> Untuk domain sensitif, jangan hilangkan raw input terlalu cepat. Normalisasi boleh dilakukan, tetapi raw evidence sering tetap perlu disimpan atau dilog secara aman sesuai policy.

---

## 13. Mapping dan Performance

Mapping bisa menjadi bottleneck.

Contoh umum:

```java
List<ApplicationResponse> responses = applications.stream()
    .map(applicationMapper::toResponse)
    .toList();
```

Terlihat sederhana. Tetapi `toResponse()` mungkin memanggil:

```java
application.getApplicant().getName();
application.getDocuments().size();
application.getLatestApproval().getOfficer().getName();
```

Jika object adalah JPA entity dengan lazy relationship, mapping bisa menyebabkan N+1 query.

Masalah lain:

- object graph terlalu besar,
- deep copy tidak perlu,
- JSON databind memuat seluruh payload ke memory,
- large array seharusnya diproses streaming,
- mapper membuat banyak temporary object,
- repeated date formatter allocation,
- collection tidak di-pre-size,
- response list membawa field detail yang tidak dibutuhkan.

Rule:

> Mapping performance bukan hanya soal mapper library cepat atau lambat. Lebih penting: data apa yang sudah terlanjur difetch, object graph sebesar apa yang dibentuk, dan apakah mapping memicu kerja tersembunyi.

---

## 14. Mapping dan Failure Model

Mapper production-grade harus punya failure model.

Bukan hanya:

```text
mapping success / mapping failed
```

Tetapi:

| Failure | Contoh | Respons yang Benar |
|---|---|---|
| Parse failure | JSON invalid | 400 Bad Request |
| Binding failure | field type salah | field-level error |
| Unknown field | client kirim field ilegal | reject atau ignore sesuai policy |
| Missing required | field wajib tidak ada | validation error |
| Null semantic error | null tidak boleh | validation/mapping error |
| Conversion failure | string ke date gagal | field-level error |
| Enum unknown | status tidak dikenal | reject atau map ke UNKNOWN sesuai boundary |
| Semantic mismatch | code tidak valid untuk context | domain/application error |
| Enrichment failure | reference data tidak ditemukan | controlled error atau fallback |
| Security violation | field tidak boleh ditulis | reject/log security event |
| Compatibility failure | payload versi lama/baru | migration/adapter path |

Mapper harus membantu menghasilkan error yang:

- jelas untuk client,
- aman dari data leakage,
- cukup detail untuk debugging,
- punya field path,
- punya correlation id,
- bisa dilacak ke logs/audit.

---

## 15. Data Mapper sebagai Policy Boundary

Mapping sering membawa policy. Itu tidak selalu salah. Yang salah adalah policy tersembunyi.

Contoh policy yang sering ada di mapper:

- field visibility,
- masking,
- date/time format,
- enum translation,
- null handling,
- default output,
- external code conversion,
- version aliasing,
- flattening rule,
- unknown enum fallback.

Policy harus eksplisit.

Buruk:

```java
response.setRemarks(application.getRemarks());
```

Lebih baik:

```java
response.setRemarks(remarksVisibilityPolicy.visibleRemarksFor(viewer, application));
```

Atau jika policy sederhana dan lokal:

```java
response.setMaskedEmail(maskEmail(user.getEmail()));
```

Top-level engineer tidak hanya bertanya “bisa dimap atau tidak”, tetapi:

- policy siapa ini?
- ownership-nya di mana?
- apakah policy berubah per actor?
- apakah policy perlu audit?
- apakah policy harus dites sebagai business rule?
- apakah policy boleh berada di generated mapper?

---

## 16. Object Mapper vs Data Mapper vs Serializer

Istilah sering tercampur. Untuk seri ini, kita bedakan.

### 16.1 Serializer/Deserializer

Mengubah object ke format data, atau sebaliknya.

```text
Java Object <-> JSON
Java Object <-> XML
```

Contoh tooling:

- Jackson databind,
- Jackson XML,
- JAXB/Jakarta XML Binding.

### 16.2 Object Mapper / Bean Mapper

Mengubah satu object Java ke object Java lain.

```text
Entity -> DTO
Request DTO -> Command
Domain -> Event DTO
```

Contoh tooling:

- MapStruct,
- manual mapper,
- ModelMapper-style runtime mapper,
- custom assembler.

### 16.3 Data Mapper Pattern

Dalam enterprise architecture, Data Mapper juga bisa berarti pattern yang memisahkan domain object dari database persistence.

Contoh:

```text
Domain Object <-> Database Row
```

Dalam seri ini, istilah “data mapper” akan dipakai luas untuk transformation layer, tetapi kita akan tetap membedakan konteksnya.

---

## 17. Tooling Landscape: Jackson, MapStruct, Lombok

### 17.1 Jackson

Jackson adalah ekosistem utama untuk JSON di Java. Jackson memiliki beberapa level:

- streaming API,
- tree model,
- databind,
- annotation model,
- module system,
- support data format tambahan seperti XML.

Jackson bukan hanya library parsing JSON. Dalam banyak aplikasi, Jackson adalah **runtime contract engine**.

Ia menentukan:

- field apa yang diterima,
- field apa yang keluar,
- bagaimana null diperlakukan,
- bagaimana enum dibaca,
- bagaimana date/time diformat,
- bagaimana polymorphic type dibuat,
- bagaimana unknown property ditangani,
- bagaimana constructor/record/builder dipakai.

Karena Jackson 3.x sudah menjadi jalur mayor baru dan tidak API-compatible penuh dengan 2.x, seri ini akan memperlakukan migration awareness sebagai skill penting, bukan catatan kecil.

### 17.2 MapStruct

MapStruct adalah compile-time mapper. Kita mendefinisikan interface, MapStruct menghasilkan implementation saat compile.

Konsekuensinya:

- tidak bergantung reflection runtime untuk mapping utama,
- kesalahan mapping bisa muncul di compile time,
- generated code bisa dibaca,
- performa umumnya predictable,
- annotation processing menjadi bagian build penting,
- interaksi dengan Lombok/IDE/compiler harus dipahami.

MapStruct bagus untuk structural dan semi-semantic mapping yang deterministic. Tetapi bukan silver bullet untuk business logic kompleks.

### 17.3 Lombok

Lombok mengurangi boilerplate dengan annotation seperti:

- `@Getter`,
- `@Setter`,
- `@Builder`,
- `@Value`,
- `@Data`,
- `@EqualsAndHashCode`,
- `@NoArgsConstructor`,
- `@AllArgsConstructor`.

Tetapi Lombok bekerja dengan cara yang lebih invasive dibanding annotation biasa. Ia memengaruhi source transformation/compile-time behavior dan sangat bergantung pada dukungan JDK/IDE.

Lombok bisa sangat produktif jika dipakai disiplin. Tetapi bisa menjadi debt jika:

- `@Data` dipakai sembarangan di entity,
- equals/hashCode salah untuk JPA,
- builder membuat invariant bisa dilewati,
- generated constructor tidak cocok dengan Jackson,
- annotation processor order konflik dengan MapStruct,
- upgrade JDK membuat build/IDE bermasalah.

---

## 18. Manual Mapping Tetap Wajib Dipahami

Tooling tidak menggantikan pemahaman.

MapStruct membantu generate code, tetapi engineer harus tahu code seperti apa yang seharusnya dihasilkan.

Jackson membantu binding JSON, tetapi engineer harus tahu apakah binding itu aman.

Lombok membantu membuat boilerplate, tetapi engineer harus tahu bentuk bytecode/source behavior yang dihasilkan.

Manual mapping adalah baseline:

```java
public static UserResponse from(User user) {
    return new UserResponse(
        user.id().value(),
        user.profile().displayName(),
        maskEmail(user.email().value())
    );
}
```

Kelebihan manual mapping:

- sangat eksplisit,
- mudah debug,
- tidak butuh annotation processor,
- cocok untuk mapping kecil/kritis,
- policy terlihat jelas.

Kekurangan:

- boilerplate banyak,
- rawan lupa field,
- consistency sulit jika scale besar,
- refactor harus disiplin.

Top-level engineer tahu kapan menggunakan manual mapping dan kapan menggunakan generated mapping.

---

## 19. Mapping Layer dalam Architecture

### 19.1 Layered Architecture

```text
Controller
  -> Request DTO
  -> Mapper
  -> Service
  -> Entity/Domain
  -> Mapper
  -> Response DTO
```

Risiko:

- service menerima DTO terlalu dekat dengan API,
- entity bocor ke controller,
- mapper jadi dependency service yang salah arah.

### 19.2 Hexagonal / Ports and Adapters

```text
Inbound Adapter
  JSON Request -> Request DTO -> Command

Application Core
  Command -> Use Case -> Domain

Outbound Adapter
  Domain/Event -> External Payload
```

Mapping berada di adapter boundary.

### 19.3 Clean Architecture

DTO framework-specific harus berada di outer layer. Domain tidak boleh bergantung Jackson annotation, JPA annotation, atau Lombok builder jika itu membuat domain coupling ke framework.

Namun real-world trade-off ada. Tidak semua sistem butuh purity ekstrem. Yang penting adalah sadar coupling-nya.

---

## 20. Anti-Patterns Besar dalam Data Mapping

### 20.1 Entity as API DTO

```java
public UserEntity getUser() { ... }
```

Dampak:

- persistence model bocor,
- sensitive data risk,
- lazy loading risk,
- API contract tidak stabil.

### 20.2 One DTO for Everything

```java
ApplicationDto dipakai untuk create, update, detail, list, event, export.
```

Dampak:

- field ambiguity,
- null semantics kacau,
- validation annotation konflik,
- over-posting,
- response bloat.

### 20.3 Blind Auto-Mapping

Runtime mapper yang mencocokkan field by name tanpa review bisa menyebabkan:

- data salah masuk field,
- field baru otomatis ikut termap,
- security policy terlewat,
- bug silent.

### 20.4 Mapper with Hidden I/O

```java
response.setName(userService.getName(id));
```

Dampak:

- mapper lambat,
- mapper bisa gagal karena network/db,
- sulit dites,
- mapping order memengaruhi hasil.

### 20.5 Annotation Soup

Satu class penuh annotation:

```java
@Entity
@Table
@JsonIgnoreProperties
@JsonInclude
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@XmlRootElement
```

Dampak:

- class melayani terlalu banyak framework,
- perubahan satu boundary merusak boundary lain,
- sulit memahami object contract.

### 20.6 Null Strategy Tidak Eksplisit

PATCH mapper yang asal copy null:

```java
entity.setEmail(request.getEmail());
```

Dampak:

- field terhapus tanpa sengaja,
- audit salah,
- user data rusak.

### 20.7 Mapping Tests Hanya Happy Path

Mapper harus dites untuk:

- missing field,
- null field,
- unknown field,
- enum unknown,
- nested null,
- collection empty,
- invalid date,
- timezone,
- precision,
- sensitive field,
- backward compatibility.

---

## 21. Prinsip-Prinsip Desain Mapping yang Baik

### Prinsip 1 — Boundary-Specific Model

Gunakan model berbeda untuk boundary yang berbeda jika maknanya berbeda.

```text
CreateUserRequest != UpdateUserRequest != UserResponse != UserEvent
```

### Prinsip 2 — Explicit over Accidental

Mapping field penting harus eksplisit.

Jika ada field baru, build/test sebaiknya memberi sinyal bahwa mapping perlu direview.

### Prinsip 3 — Deny-by-Default Inbound

Client hanya boleh mengirim field yang memang diizinkan.

### Prinsip 4 — Allow-by-Design Outbound

Response hanya berisi field yang memang diputuskan boleh keluar.

### Prinsip 5 — Null Semantics Must Be Designed

Null bukan detail teknis. Null adalah semantic contract.

### Prinsip 6 — Mapping Must Be Testable

Mapping harus bisa dites tanpa setup sistem besar.

### Prinsip 7 — Generated Code Must Be Inspectable

Jika memakai MapStruct/Lombok, pahami generated behavior.

### Prinsip 8 — Avoid Hidden I/O

Mapper sebaiknya tidak melakukan network call, database query, atau external lookup secara diam-diam.

### Prinsip 9 — Compatibility Is a First-Class Requirement

Perubahan DTO adalah perubahan contract.

### Prinsip 10 — Security and Privacy Are Mapping Concerns

Mapping menentukan data apa yang diterima dan keluar.

---

## 22. Decision Matrix: Manual vs MapStruct vs Jackson Annotation vs Custom Serializer

| Problem | Manual Mapper | MapStruct | Jackson Annotation | Custom Serializer/Deserializer |
|---|---:|---:|---:|---:|
| Entity -> Response DTO | Good | Excellent | Not ideal | Rare |
| Request JSON -> DTO | No | No | Excellent | Sometimes |
| DTO -> Command | Good | Good | No | No |
| Complex business decision | Good if explicit | Avoid | Avoid | Avoid |
| Large repetitive bean mapping | Tedious | Excellent | No | No |
| Format-specific JSON shape | No | No | Good | Excellent |
| Dynamic field masking | Good | Possible | Limited | Good |
| XML namespace handling | No | No | Limited | Sometimes |
| Patch update | Good | Good with care | Partial | No |
| Legacy weird payload | Good | Good with adapters | Sometimes | Good |
| High performance stable mapping | Good | Excellent | Depends | Depends |

Rule:

> Jangan memilih tool berdasarkan popularitas. Pilih berdasarkan boundary, semantic complexity, failure mode, dan maintainability.

---

## 23. Mapping Review Checklist

Gunakan checklist ini saat review PR yang mengubah DTO, mapper, JSON/XML contract, atau serializer.

### 23.1 Contract Checklist

- Apakah field baru backward compatible?
- Apakah field yang dihapus punya consumer?
- Apakah rename dilakukan dengan migration path?
- Apakah allowed enum values berubah?
- Apakah nullability berubah?
- Apakah date/time format berubah?
- Apakah precision number berubah?
- Apakah XML namespace/order berubah?

### 23.2 Security Checklist

- Apakah inbound DTO hanya berisi field yang boleh ditulis?
- Apakah outbound DTO tidak membawa secret/internal data?
- Apakah sensitive data dimasking?
- Apakah polymorphic input aman?
- Apakah error message tidak membocorkan class/package/internal field?
- Apakah unknown field harus ditolak?

### 23.3 Correctness Checklist

- Apakah source dan target field punya meaning sama?
- Apakah null/missing/default semantics jelas?
- Apakah nested object null-safe?
- Apakah collection null vs empty jelas?
- Apakah enum unknown ditangani?
- Apakah timezone benar?
- Apakah BigDecimal precision aman?

### 23.4 Architecture Checklist

- Apakah mapper berada di layer yang tepat?
- Apakah domain bebas dari annotation framework yang tidak perlu?
- Apakah entity tidak bocor ke API?
- Apakah mapper tidak melakukan hidden I/O?
- Apakah mapper tidak menjadi service layer?
- Apakah dependency direction benar?

### 23.5 Testing Checklist

- Apakah ada test happy path?
- Apakah ada test null/missing/unknown?
- Apakah ada golden payload?
- Apakah ada compatibility test?
- Apakah generated mapper behavior diverifikasi?
- Apakah sensitive field absence dites?

---

## 24. Worked Example: Dari Naive Mapping ke Boundary-Aware Mapping

### 24.1 Naive Design

```java
@Entity
@Getter
@Setter
class ApplicationEntity {
    private Long id;
    private String applicantName;
    private String status;
    private String internalRemarks;
    private String publicRemarks;
    private String assignedOfficerId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

Controller:

```java
@GetMapping("/applications/{id}")
public ApplicationEntity get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Update:

```java
@PutMapping("/applications/{id}")
public ApplicationEntity update(@PathVariable Long id,
                                @RequestBody ApplicationEntity request) {
    ApplicationEntity entity = repository.findById(id).orElseThrow();
    entity.setApplicantName(request.getApplicantName());
    entity.setStatus(request.getStatus());
    entity.setInternalRemarks(request.getInternalRemarks());
    entity.setPublicRemarks(request.getPublicRemarks());
    entity.setAssignedOfficerId(request.getAssignedOfficerId());
    return repository.save(entity);
}
```

Masalah:

- client bisa mengubah status langsung,
- client bisa mengubah internal remarks,
- client bisa mengubah assigned officer,
- response membocorkan internal data,
- entity menjadi API contract,
- null update bisa menghapus data,
- tidak ada audit semantic,
- tidak ada command intent.

### 24.2 Boundary-Aware Design

Inbound DTO:

```java
public class UpdateApplicationPublicInfoRequest {
    private String applicantName;
    private String publicRemarks;
}
```

Command:

```java
public record UpdateApplicationPublicInfoCommand(
    ApplicationId applicationId,
    String applicantName,
    String publicRemarks,
    UserId actorId
) {}
```

Response DTO:

```java
public record ApplicationDetailResponse(
    Long id,
    String applicantName,
    String displayStatus,
    String publicRemarks,
    String submittedAt
) {}
```

Mapper:

```java
public final class ApplicationCommandMapper {

    public UpdateApplicationPublicInfoCommand toCommand(
        Long applicationId,
        UpdateApplicationPublicInfoRequest request,
        UserId actorId
    ) {
        return new UpdateApplicationPublicInfoCommand(
            new ApplicationId(applicationId),
            normalizeName(request.getApplicantName()),
            normalizeRemarks(request.getPublicRemarks()),
            actorId
        );
    }

    private String normalizeName(String value) {
        return value == null ? null : value.trim();
    }

    private String normalizeRemarks(String value) {
        return value == null ? null : value.trim();
    }
}
```

Response mapper:

```java
public final class ApplicationResponseMapper {

    public ApplicationDetailResponse toDetail(Application application) {
        return new ApplicationDetailResponse(
            application.id().value(),
            application.applicantName().value(),
            mapDisplayStatus(application.status()),
            application.publicRemarks().value(),
            formatSubmittedAt(application.submittedAt())
        );
    }

    private String mapDisplayStatus(ApplicationStatus status) {
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case UNDER_REVIEW -> "Under Review";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
            case WITHDRAWN -> "Withdrawn";
        };
    }
}
```

Keuntungan:

- inbound field dibatasi,
- status tidak bisa diubah dari API ini,
- internal remarks tidak masuk contract,
- command membawa intent,
- normalization eksplisit,
- response punya display status sendiri,
- entity tidak bocor,
- mapping bisa dites.

---

## 25. Java 8 sampai Java 25: Evolusi yang Mempengaruhi Mapping

Seri ini mencakup Java 8 sampai Java 25. Beberapa perubahan Java modern memengaruhi strategi mapping.

### Java 8

Umum di enterprise legacy.

Karakteristik:

- POJO mutable,
- JavaBean convention dominan,
- `Optional`, `Stream`, `java.time` mulai tersedia,
- Lombok populer untuk mengurangi boilerplate,
- DTO biasanya class dengan getter/setter.

### Java 11/17

Banyak aplikasi enterprise mulai pindah ke LTS modern.

Karakteristik:

- module awareness mulai relevan,
- var lokal,
- performa runtime lebih baik,
- ecosystem mulai meninggalkan Java 8 secara bertahap.

### Java 16+

Records menjadi stable.

Dampak:

- DTO immutable lebih natural,
- constructor binding lebih penting,
- Jackson/MapStruct support records menjadi penting,
- Lombok `@Value` tidak selalu diperlukan untuk DTO sederhana.

### Java 17+

Sealed classes stable.

Dampak:

- polymorphic DTO hierarchy bisa lebih terkendali,
- exhaustive switch membantu enum/sealed mapping,
- domain event hierarchy bisa lebih aman.

### Java 21/25

Modern LTS era.

Dampak:

- records/sealed/pattern matching semakin natural,
- migration dari JavaBean mutable DTO ke immutable DTO makin masuk akal,
- annotation processor compatibility harus diperhatikan,
- library version alignment menjadi penting.

Rule:

> Untuk Java 8, desain mapping sering berbasis mutable POJO + Lombok + MapStruct. Untuk Java 21/25, desain bisa lebih banyak memakai records, sealed hierarchy, constructor binding, dan explicit immutable DTO.

---

## 26. Mental Model Akhir Part 0

Simpan model ini:

```text
Data Transformation = Boundary + Meaning + Policy + Compatibility + Failure Handling
```

Bukan:

```text
Data Transformation = Copy field dengan nama sama
```

Setiap kali membuat mapper, tanyakan:

1. Boundary apa yang sedang dilewati?
2. Source dan target mewakili konteks apa?
3. Apakah field yang sama punya meaning sama?
4. Siapa yang boleh menulis field ini?
5. Siapa yang boleh membaca field ini?
6. Bagaimana null/missing/default diperlakukan?
7. Apakah perubahan ini compatible?
8. Apa failure mode-nya?
9. Apakah mapping deterministic?
10. Apakah mapping bisa dites dan diaudit?
11. Apakah mapper melakukan hidden I/O?
12. Apakah tool yang dipilih sesuai dengan kompleksitas boundary?

Jika pertanyaan ini menjadi kebiasaan, kamu tidak lagi melihat mapper sebagai boilerplate. Kamu melihat mapper sebagai salah satu lapisan paling penting untuk menjaga sistem tetap benar ketika model berubah.

---

## 27. Mini Exercise

Ambil satu endpoint nyata di sistemmu, lalu jawab:

```text
Endpoint:
Request DTO:
Command/Application Input:
Domain Object:
Persistence Entity:
Response DTO:
Event/Audit Payload:
```

Lalu cek:

- Apakah request DTO sama dengan response DTO?
- Apakah entity bocor ke API?
- Apakah ada field yang client bisa tulis padahal seharusnya server-only?
- Apakah ada field internal yang keluar?
- Apakah null handling jelas?
- Apakah update endpoint PUT/PATCH semantics jelas?
- Apakah mapper melakukan lookup/service call?
- Apakah perubahan field akan memengaruhi consumer lain?

Jika jawabannya banyak yang “tidak yakin”, berarti mapping boundary perlu diperbaiki.

---

## 28. Checklist Ringkas untuk Dipakai Mulai Sekarang

Sebelum menulis mapper baru:

```text
[ ] Saya tahu boundary source dan target.
[ ] Saya tahu field mana yang boleh inbound.
[ ] Saya tahu field mana yang boleh outbound.
[ ] Saya tahu null/missing/default semantics.
[ ] Saya tahu mapping ini structural, semantic, normalization, enrichment, redaction, atau projection.
[ ] Saya tahu apakah mapping ini butuh manual, MapStruct, Jackson annotation, atau custom serializer.
[ ] Saya tahu failure mode utama.
[ ] Saya tahu test minimal yang harus dibuat.
```

Sebelum approve PR mapping:

```text
[ ] Tidak ada entity langsung sebagai API response/request.
[ ] Tidak ada sensitive field leakage.
[ ] Tidak ada blind auto-mapping untuk boundary sensitif.
[ ] Tidak ada hidden database/network call di mapper.
[ ] Tidak ada null overwrite bug di update/patch.
[ ] Tidak ada breaking contract tanpa migration path.
[ ] Generated mapping behavior bisa dipahami.
[ ] Error handling aman dan jelas.
```

---

## 29. Apa yang Akan Dibahas di Part Berikutnya

Part berikutnya:

```text
01-java-object-model-for-mapping-beans-records-pojos-immutability.md
```

Kita akan membahas object model Java yang menjadi bahan baku semua mapping:

- JavaBean convention,
- field vs property,
- getter/setter discovery,
- constructor binding,
- records,
- immutable DTO,
- builders,
- nested object graph,
- enum,
- optional,
- collection,
- map,
- sealed classes,
- polymorphic model,
- kapan mutable object masih masuk akal,
- kapan immutable/record lebih aman.

Part 0 belum masuk detail Jackson/MapStruct/Lombok secara teknis karena tujuannya adalah fondasi mental. Tanpa fondasi ini, tool apa pun akan terlihat seperti template. Dengan fondasi ini, setiap tool akan bisa dievaluasi berdasarkan boundary, meaning, policy, failure, dan evolution.

---

## Referensi Utama

Referensi ini digunakan sebagai konteks versi dan arah ekosistem, bukan sebagai pengganti penalaran desain di materi ini.

- Oracle Java SE / JDK 25 API Documentation.
- Oracle Java downloads page, termasuk status JDK 25 sebagai LTS.
- FasterXML Jackson project dan Jackson 3.0 release/migration notes.
- FasterXML jackson-databind documentation, termasuk baseline Java version untuk lini Jackson 2.x tertentu.
- MapStruct Reference Guide, khususnya positioning MapStruct sebagai Java annotation processor untuk type-safe bean mapping.
- Project Lombok Changelog, termasuk dukungan JDK 25 pada Lombok 1.18.40.

---

## Status Seri

Seri **belum selesai**. Ini adalah **Part 0 dari 35**.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 32 — Capstone: Building a Production-Grade Jersey Platform Module](../framework/jersey/32-capstone-building-production-grade-jersey-platform-module.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 1 — Java Object Model for Mapping: Beans, Records, POJOs, Immutability](./01-java-object-model-for-mapping-beans-records-pojos-immutability.md)

</div>