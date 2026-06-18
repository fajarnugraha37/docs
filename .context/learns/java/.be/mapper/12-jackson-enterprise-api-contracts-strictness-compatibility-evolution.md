# Part 12 — Jackson for Enterprise API Contracts: Strictness, Compatibility, Evolution

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `12-jackson-enterprise-api-contracts-strictness-compatibility-evolution.md`  
> Status: Part 12 dari 35  
> Scope Java: Java 8 sampai Java 25  
> Fokus: menggunakan Jackson bukan hanya sebagai JSON mapper, tetapi sebagai mekanisme runtime untuk menjaga kontrak API enterprise yang bisa berevolusi tanpa merusak consumer.

---

## 1. Kenapa Part Ini Penting

Di aplikasi kecil, JSON sering dianggap hanya sebagai format transport:

```java
UserDto dto = objectMapper.readValue(json, UserDto.class);
String body = objectMapper.writeValueAsString(dto);
```

Di sistem enterprise, terutama sistem yang memiliki banyak consumer, integrasi eksternal, backward compatibility, audit, regulatory constraint, dan versi aplikasi yang berjalan paralel, JSON bukan hanya format. JSON adalah **kontrak operasional**.

Kontrak itu menentukan:

- field apa yang boleh dikirim consumer;
- field apa yang dijamin dikembalikan server;
- field mana yang wajib ada;
- field mana yang boleh `null`;
- field mana yang boleh hilang;
- field mana yang sudah deprecated;
- nama field mana yang masih diterima untuk kompatibilitas lama;
- tipe data apa yang tidak boleh diam-diam dikonversi;
- perubahan mana yang additive dan mana yang breaking;
- bagaimana payload lama tetap bisa dibaca;
- bagaimana payload baru tidak merusak service lama;
- bagaimana contract drift dideteksi lebih awal.

Jackson berada tepat di perbatasan ini. Karena itu, konfigurasi Jackson adalah keputusan arsitektur, bukan sekadar preferensi library.

Mental model penting:

> Kalau DTO adalah bentuk kontrak, maka Jackson adalah mesin yang menegakkan atau melonggarkan kontrak itu pada runtime.

---

## 2. Problem Utama: API Contract Tidak Rusak Sekaligus, Tetapi Membusuk Perlahan

Banyak kerusakan kontrak API tidak terlihat sebagai error besar. Ia muncul sebagai perubahan kecil yang terlihat aman.

Contoh perubahan kecil:

```json
{
  "caseId": "C-1001",
  "status": "OPEN",
  "officerName": "Dina"
}
```

Lalu response berubah menjadi:

```json
{
  "id": "C-1001",
  "caseStatus": "OPEN",
  "assignedOfficerName": "Dina"
}
```

Bagi developer internal, perubahan ini mungkin terlihat lebih rapi. Bagi consumer eksternal, ini breaking change.

Contoh lain yang lebih halus:

```json
{
  "amount": 100
}
```

Berubah menjadi:

```json
{
  "amount": "100"
}
```

Atau:

```json
{
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Berubah menjadi:

```json
{
  "submittedAt": "2026-06-17 10:15:30"
}
```

Tidak semua perubahan ini langsung crash di semua client. Sebagian client mungkin coercive, sebagian strict, sebagian silently default, sebagian gagal hanya di edge case. Inilah yang membuat contract drift berbahaya.

---

## 3. Kontrak API Harus Dipikirkan dari Dua Arah

Setiap endpoint punya dua sisi kontrak:

1. **Inbound contract**: apa yang boleh diterima service dari luar.
2. **Outbound contract**: apa yang dijanjikan service kepada consumer.

Keduanya tidak selalu harus punya strictness yang sama.

### 3.1 Inbound Contract

Inbound contract menjawab:

- Apakah unknown field ditolak?
- Apakah field lama masih diterima?
- Apakah `null` boleh?
- Apakah missing field boleh?
- Apakah string boleh dikonversi menjadi number?
- Apakah number boleh dikonversi menjadi enum ordinal?
- Apakah empty string dianggap null?
- Apakah duplicate field dalam JSON dianggap error?
- Apakah field deprecated masih diterima?

Inbound lebih dekat dengan **attack surface** dan **data correctness**.

### 3.2 Outbound Contract

Outbound contract menjawab:

- Field apa yang selalu muncul?
- Field apa yang boleh hilang?
- Field apa yang muncul sebagai `null`?
- Apakah response tetap memakai nama field lama?
- Apakah field baru additive?
- Apakah deprecated field masih dikirim?
- Apakah enum baru bisa merusak client lama?
- Apakah format tanggal stabil?
- Apakah angka decimal stabil?

Outbound lebih dekat dengan **compatibility guarantee**.

---

## 4. Strict vs Lenient: Tidak Ada Satu Jawaban Universal

Salah satu kesalahan umum adalah mencari satu konfigurasi ObjectMapper untuk semua kebutuhan.

Misalnya:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
```

atau:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Lalu dipakai global untuk semua endpoint, semua integration, semua event, semua test.

Itu terlalu kasar.

Strategi yang lebih matang adalah membedakan beberapa profil:

| Profile | Karakter | Cocok untuk |
|---|---|---|
| Strict inbound | Tolak unknown/coercion mencurigakan | Public write API, admin action, command endpoint |
| Lenient inbound | Terima unknown/additive field | Event consumer, tolerant external integration |
| Strict outbound | Bentuk JSON stabil dan dites | Public API response, partner contract |
| Internal relaxed | Lebih fleksibel | Internal temporary tooling, debug payload |
| Migration profile | Menerima nama lama dan baru | Transisi contract |

Prinsipnya:

> Strictness adalah policy boundary, bukan setting global universal.

---

## 5. `FAIL_ON_UNKNOWN_PROPERTIES`: Lebih dari Sekadar Error atau Tidak

Jackson memiliki fitur `FAIL_ON_UNKNOWN_PROPERTIES` untuk menentukan apakah unknown property saat deserialization harus menghasilkan failure. Dokumentasi Jackson menjelaskan bahwa unknown property adalah property yang tidak map ke property target, tidak ditangani oleh any-setter, dan tidak ditangani handler lain. Jika fitur aktif, Jackson melempar mapping exception.  

Secara arsitektur, pertanyaannya bukan hanya “aktif atau tidak?”, tetapi “di boundary mana harus aktif?”.

### 5.1 Contoh DTO

```java
public class CreateCaseRequest {
    private String applicantName;
    private String caseType;

    public String getApplicantName() {
        return applicantName;
    }

    public void setApplicantName(String applicantName) {
        this.applicantName = applicantName;
    }

    public String getCaseType() {
        return caseType;
    }

    public void setCaseType(String caseType) {
        this.caseType = caseType;
    }
}
```

Payload:

```json
{
  "applicantName": "Dina",
  "caseType": "LICENCE_APPEAL",
  "isAdminApproved": true
}
```

Field `isAdminApproved` tidak ada di DTO.

Kalau unknown field diabaikan, request tetap masuk. Itu mungkin aman kalau field itu benar-benar irrelevant. Tetapi di write API, unknown field bisa mengindikasikan:

- client salah versi;
- client salah endpoint;
- typo field penting;
- malicious over-posting attempt;
- hidden assumption dari frontend;
- contract mismatch antara OpenAPI dan runtime.

Untuk command endpoint penting, unknown field sering lebih baik ditolak.

### 5.2 Strict Inbound Example

```java
ObjectMapper strictInboundMapper = JsonMapper.builder()
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();
```

Dengan strict mapper, payload salah cepat gagal.

Keuntungan:

- typo cepat terdeteksi;
- contract drift cepat terlihat;
- over-posting lebih mudah dicegah;
- consumer tidak merasa field diterima padahal diabaikan;
- audit input lebih jelas.

Kerugian:

- additive change dari client bisa gagal;
- backward/forward compatibility lebih sulit;
- consumer harus sinkron ketat;
- event consumer sulit jika producer lebih cepat evolve.

### 5.3 Lenient Inbound Example

```java
ObjectMapper lenientInboundMapper = JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();
```

Keuntungan:

- cocok untuk tolerant reader;
- event consumer bisa bertahan saat producer menambah field;
- integrasi eksternal lebih resilient;
- rolling deployment lebih mudah.

Kerugian:

- typo bisa diam-diam hilang;
- consumer mengira field diproses padahal tidak;
- bug mapping sulit ditemukan;
- over-posting attempt tidak tampak kecuali dilog secara eksplisit.

### 5.4 Rekomendasi Praktis

Gunakan pendekatan boundary-specific:

```text
Public command/write API      -> strict unknown field
Public query filter API       -> strict untuk parameter penting, tolerant jika ada extension map eksplisit
Internal event consumer       -> lenient unknown field
External partner inbound      -> tergantung SLA contract, sering strict untuk regulated API
Legacy migration endpoint     -> lenient dengan telemetry
Audit replay payload          -> lenient untuk payload lama, strict untuk output baru
```

---

## 6. Unknown Field Boleh Diabaikan, Tapi Jangan Tidak Terlihat

Lenient tidak berarti buta.

Jika service menerima unknown field untuk alasan compatibility, ada baiknya unknown field bisa diamati di environment tertentu.

Pilihan desain:

1. Fail di local/test.
2. Warn di staging/UAT.
3. Metrics di production.
4. Allowlist unknown field tertentu saat migration.
5. Audit unknown field untuk partner integration.

Contoh konseptual dengan `DeserializationProblemHandler`:

```java
public class UnknownPropertyLoggingHandler extends DeserializationProblemHandler {

    @Override
    public boolean handleUnknownProperty(
            DeserializationContext ctxt,
            JsonParser p,
            JsonDeserializer<?> deserializer,
            Object beanOrClass,
            String propertyName
    ) throws IOException {

        String targetType = beanOrClass instanceof Class<?>
                ? ((Class<?>) beanOrClass).getName()
                : beanOrClass.getClass().getName();

        // Jangan log full payload berisi PII.
        // Log nama field, target type, correlation id, endpoint, client id.
        System.out.printf(
                "Unknown JSON property ignored: property=%s target=%s%n",
                propertyName,
                targetType
        );

        p.skipChildren();
        return true;
    }
}
```

Registration:

```java
ObjectMapper mapper = JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .addHandler(new UnknownPropertyLoggingHandler())
        .build();
```

Catatan: jangan sembarang log raw payload karena bisa mengandung PII, token, dokumen, atau data rahasia.

---

## 7. `@JsonIgnoreProperties(ignoreUnknown = true)`: Local Leniency

Kadang kita tidak ingin mapper global lenient, tetapi satu DTO tertentu perlu tolerant.

Contoh:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public class PartnerStatusCallback {
    private String partnerReferenceNo;
    private String status;
}
```

Ini berguna untuk external partner callback yang sering menambah metadata.

Tetapi ada trade-off:

- policy tersebar di DTO;
- developer berikutnya mungkin tidak sadar DTO tersebut tolerant;
- sulit membuat strict test jika annotation sudah melekat;
- DTO menjadi membawa policy boundary.

Rule of thumb:

```text
Gunakan annotation lokal jika toleransi memang bagian dari kontrak DTO tersebut.
Gunakan ObjectMapper profile jika toleransi adalah policy endpoint/adapter.
```

---

## 8. Field Rename: Salah Satu Breaking Change Paling Umum

Misalnya field lama:

```json
{
  "officerName": "Dina"
}
```

Ingin diganti menjadi:

```json
{
  "assignedOfficerName": "Dina"
}
```

Kalau langsung rename Java field:

```java
private String assignedOfficerName;
```

maka consumer lama yang mengirim `officerName` bisa gagal atau field menjadi null.

Jackson menyediakan `@JsonAlias` untuk menerima nama alternatif saat deserialization. Dokumentasi Jackson menyatakan `@JsonAlias` mendefinisikan satu atau lebih nama alternatif yang diterima saat deserialization, sedangkan serialization tetap menggunakan nama utama.

```java
public class AssignCaseRequest {

    @JsonProperty("assignedOfficerName")
    @JsonAlias({"officerName", "handlerName"})
    private String assignedOfficerName;

    public String getAssignedOfficerName() {
        return assignedOfficerName;
    }

    public void setAssignedOfficerName(String assignedOfficerName) {
        this.assignedOfficerName = assignedOfficerName;
    }
}
```

Behavior:

Inbound diterima:

```json
{
  "officerName": "Dina"
}
```

Inbound juga diterima:

```json
{
  "assignedOfficerName": "Dina"
}
```

Outbound tetap:

```json
{
  "assignedOfficerName": "Dina"
}
```

Ini pola yang baik untuk rename field:

1. Tambahkan field baru sebagai canonical name.
2. Terima nama lama menggunakan alias.
3. Emit hanya nama baru untuk response baru, kecuali butuh dual-write sementara.
4. Tambahkan telemetry penggunaan nama lama.
5. Umumkan deprecation window.
6. Hapus alias setelah aman.

---

## 9. `@JsonProperty`: Nama Kontrak Bukan Nama Field Java

`@JsonProperty` mendefinisikan nama logical JSON property yang digunakan Jackson. Ini penting karena nama field Java tidak selalu harus sama dengan nama field kontrak.

Contoh:

```java
public class CaseResponse {

    @JsonProperty("caseId")
    private String id;

    @JsonProperty("submittedAt")
    private OffsetDateTime submissionTimestamp;
}
```

Java internal bisa memakai nama yang lebih domain-specific, sementara JSON contract tetap stabil.

Prinsip penting:

> Jangan biarkan refactor nama field Java otomatis menjadi breaking change API.

Kalau field Java berubah:

```java
private OffsetDateTime submissionTimestamp;
```

menjadi:

```java
private OffsetDateTime submittedDateTime;
```

kontrak JSON tetap:

```java
@JsonProperty("submittedAt")
private OffsetDateTime submittedDateTime;
```

Tanpa `@JsonProperty`, rename internal bisa diam-diam mengubah response JSON.

---

## 10. Read-Only dan Write-Only Field

Dalam kontrak enterprise, tidak semua field boleh dua arah.

Contoh field:

- `id`: server-generated, read-only untuk client.
- `createdAt`: read-only.
- `createdBy`: read-only.
- `password`: write-only.
- `token`: write-only atau response sekali saja.
- `internalStatus`: tidak boleh external.

Jackson mendukung access control melalui `@JsonProperty(access = ...)`.

### 10.1 Read-Only Field

```java
public class CaseDto {

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    private String caseId;

    private String applicantName;
}
```

Artinya field ini digunakan saat serialization, tetapi tidak di-set dari input.

Ini membantu mencegah client mengirim:

```json
{
  "caseId": "FORGED-ID",
  "applicantName": "Dina"
}
```

Namun, ini bukan pengganti authorization atau validation. Untuk write API penting, lebih baik request DTO tidak memiliki field read-only sama sekali.

Lebih aman:

```java
public class CreateCaseRequest {
    private String applicantName;
}

public class CaseResponse {
    private String caseId;
    private String applicantName;
    private OffsetDateTime createdAt;
}
```

### 10.2 Write-Only Field

```java
public class LoginRequest {

    private String username;

    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    private String password;
}
```

Jika object ini tidak sengaja diserialize, `password` tidak keluar.

Tetapi best practice tetap:

```text
Jangan gunakan object yang mengandung secret sebagai response DTO.
```

`WRITE_ONLY` adalah safety net, bukan desain utama.

---

## 11. Null vs Missing: Dua Makna yang Sering Salah Disatukan

Dalam JSON, ini berbeda:

```json
{
  "email": null
}
```

Dengan:

```json
{}
```

Makna possible:

| Bentuk | Kemungkinan Makna |
|---|---|
| field missing | tidak dikirim, tidak ingin diubah, client lama, default berlaku |
| field null | sengaja dikosongkan, unknown value, not applicable, error input |

Untuk create request, missing dan null sering sama-sama invalid.

Untuk patch request, missing dan null sangat berbeda.

Contoh PATCH:

```json
{
  "email": null
}
```

bisa berarti “hapus email”.

Sedangkan:

```json
{}
```

berarti “jangan ubah email”.

Masalahnya, DTO biasa tidak bisa membedakan missing dan null:

```java
public class UpdateProfileRequest {
    private String email;
}
```

Jika `email` missing, nilai Java `email == null`.
Jika `email` explicit null, nilai Java juga `email == null`.

Untuk kasus seperti ini, butuh model khusus:

- JSON Merge Patch;
- `JsonNode` untuk patch boundary;
- wrapper `OptionalField<T>`;
- custom deserializer;
- command object yang menyimpan presence;
- library patch khusus.

Contoh wrapper konseptual:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    private PatchField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> PatchField<T> absent() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> of(T value) {
        return new PatchField<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T getValue() {
        return value;
    }
}
```

Dengan DTO:

```java
public class UpdateProfilePatchRequest {
    private PatchField<String> email = PatchField.absent();
    private PatchField<String> phone = PatchField.absent();
}
```

Ini lebih eksplisit daripada mengandalkan null biasa.

---

## 12. Required Field: Jangan Bergantung pada Satu Mekanisme Saja

Required field bisa ditegakkan di beberapa tempat:

1. JSON Schema/OpenAPI.
2. Jackson deserialization.
3. Bean Validation.
4. Domain command validation.
5. Database constraint.

Masing-masing punya peran.

### 12.1 `@JsonProperty(required = true)`

```java
public class CreateCaseRequest {

    @JsonProperty(value = "applicantName", required = true)
    private String applicantName;
}
```

Namun, dalam praktik enterprise, jangan hanya mengandalkan ini untuk semua validasi required. Behavior bisa bergantung pada creator/property mode dan konfigurasi.

Lebih aman:

```java
public class CreateCaseRequest {

    @NotBlank
    private String applicantName;

    @NotBlank
    private String caseType;
}
```

Lalu validasi dilakukan setelah deserialization.

### 12.2 Constructor Binding untuk Required Invariant

Untuk immutable DTO:

```java
public class CreateCaseRequest {
    private final String applicantName;
    private final String caseType;

    @JsonCreator
    public CreateCaseRequest(
            @JsonProperty(value = "applicantName", required = true) String applicantName,
            @JsonProperty(value = "caseType", required = true) String caseType
    ) {
        this.applicantName = applicantName;
        this.caseType = caseType;
    }

    public String getApplicantName() {
        return applicantName;
    }

    public String getCaseType() {
        return caseType;
    }
}
```

Lebih kuat lagi jika constructor melakukan guard:

```java
public CreateCaseRequest(String applicantName, String caseType) {
    if (applicantName == null || applicantName.isBlank()) {
        throw new IllegalArgumentException("applicantName is required");
    }
    if (caseType == null || caseType.isBlank()) {
        throw new IllegalArgumentException("caseType is required");
    }
    this.applicantName = applicantName;
    this.caseType = caseType;
}
```

Tetapi hati-hati: error constructor mentah bisa menjadi error response yang buruk jika tidak dipetakan dengan benar.

### 12.3 Recommended Layering

```text
OpenAPI/Schema        -> dokumentasi dan client generation
Jackson               -> parse/binding structural correctness
Bean Validation       -> request-level validation
Application command   -> use-case validation
Domain model          -> invariant yang tidak boleh dilanggar
Database              -> final integrity guard
```

---

## 13. Coercion: Musuh Halus Contract Correctness

Jackson historically cukup fleksibel dalam mengubah bentuk input.

Misalnya input:

```json
{
  "age": "30"
}
```

bisa masuk ke:

```java
private int age;
```

Atau:

```json
{
  "active": "true"
}
```

bisa masuk ke:

```java
private boolean active;
```

Fleksibilitas ini bisa membantu integrasi legacy. Tapi untuk public API modern, coercion bisa menyembunyikan contract violation.

### 13.1 Problem Coercion

Jika contract mengatakan `amount` number:

```json
{
  "amount": 100.25
}
```

lalu client mengirim string:

```json
{
  "amount": "100.25"
}
```

Kalau diterima diam-diam, maka:

- OpenAPI tidak lagi dipercaya;
- client salah tidak sadar;
- test contract longgar;
- downstream mungkin menerima bentuk lain;
- bug muncul saat angka punya koma lokal, spasi, leading zero, atau format aneh.

### 13.2 Policy

```text
External strict command API:
  Tolak coercion mencurigakan.

Legacy partner adapter:
  Terima coercion terbatas, normalize eksplisit, log source behavior.

Internal event:
  Hindari coercion diam-diam; evolusi event harus eksplisit.
```

### 13.3 Example: Enum from Number

JSON:

```json
{
  "status": 1
}
```

Java:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Jika number diterima sebagai ordinal, ini sangat berbahaya. Urutan enum berubah, makna berubah.

Lebih aman:

```java
ObjectMapper mapper = JsonMapper.builder()
        .enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
        .build();
```

Contract sebaiknya menggunakan string symbolic:

```json
{
  "status": "SUBMITTED"
}
```

---

## 14. Enum Evolution: Sering Breaking Tanpa Terlihat

Enum terlihat sederhana, tapi evolusinya sulit.

Awal:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Response lama:

```json
{
  "status": "APPROVED"
}
```

Lalu ditambah:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Bagi server, ini additive. Bagi client lama, `UNDER_REVIEW` bisa breaking jika client switch exhaustive.

### 14.1 Consumer Problem

Client TypeScript lama:

```ts
type CaseStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
```

Ketika menerima:

```json
{
  "status": "UNDER_REVIEW"
}
```

UI bisa gagal, masuk default branch salah, atau tampil kosong.

### 14.2 Server-Side Strategy

Untuk inbound enum:

- strict untuk command API;
- jangan menerima unknown enum kecuali ada migration reason;
- jangan menerima number ordinal;
- pertimbangkan explicit `UNKNOWN` hanya untuk external integration/read model, bukan domain state utama.

Untuk outbound enum:

- treat penambahan enum sebagai compatibility event;
- update OpenAPI;
- berikan deprecation/migration note;
- tambahkan contract test;
- hindari rename enum literal;
- jangan expose enum internal jika lifecycle state terlalu volatile.

### 14.3 Stable External Code vs Internal Enum

Internal:

```java
public enum CaseWorkflowState {
    DRAFT,
    PENDING_SUPERVISOR_REVIEW,
    PENDING_DIRECTOR_APPROVAL,
    APPROVED,
    REJECTED
}
```

External:

```java
public enum CasePublicStatus {
    DRAFT,
    IN_PROGRESS,
    COMPLETED,
    REJECTED
}
```

Mapping:

```java
public CasePublicStatus toPublicStatus(CaseWorkflowState state) {
    return switch (state) {
        case DRAFT -> CasePublicStatus.DRAFT;
        case PENDING_SUPERVISOR_REVIEW, PENDING_DIRECTOR_APPROVAL -> CasePublicStatus.IN_PROGRESS;
        case APPROVED -> CasePublicStatus.COMPLETED;
        case REJECTED -> CasePublicStatus.REJECTED;
    };
}
```

Untuk Java 8:

```java
public CasePublicStatus toPublicStatus(CaseWorkflowState state) {
    switch (state) {
        case DRAFT:
            return CasePublicStatus.DRAFT;
        case PENDING_SUPERVISOR_REVIEW:
        case PENDING_DIRECTOR_APPROVAL:
            return CasePublicStatus.IN_PROGRESS;
        case APPROVED:
            return CasePublicStatus.COMPLETED;
        case REJECTED:
            return CasePublicStatus.REJECTED;
        default:
            throw new IllegalArgumentException("Unsupported state: " + state);
    }
}
```

---

## 15. Deprecating Fields Without Breaking Consumers

Field deprecation harus punya lifecycle.

Misalnya response lama:

```json
{
  "caseId": "C-1001",
  "officerName": "Dina"
}
```

Response baru ingin:

```json
{
  "caseId": "C-1001",
  "assignedOfficer": {
    "name": "Dina",
    "userId": "U-9001"
  }
}
```

Langsung menghapus `officerName` adalah breaking.

### 15.1 Dual-Write Response During Migration

```java
public class CaseResponse {
    private String caseId;
    private OfficerDto assignedOfficer;

    /**
     * Deprecated: use assignedOfficer.name.
     */
    @Deprecated
    @JsonProperty("officerName")
    public String getOfficerName() {
        return assignedOfficer == null ? null : assignedOfficer.getName();
    }
}
```

Response sementara:

```json
{
  "caseId": "C-1001",
  "officerName": "Dina",
  "assignedOfficer": {
    "name": "Dina",
    "userId": "U-9001"
  }
}
```

### 15.2 Deprecation Lifecycle

```text
Phase 1: Add new field, keep old field.
Phase 2: Mark old field deprecated in docs/OpenAPI.
Phase 3: Add telemetry to see old field usage if possible.
Phase 4: Notify consumers with removal date.
Phase 5: Remove old field in major API version or agreed release.
Phase 6: Keep compatibility test proving new contract.
```

### 15.3 Avoid Ambiguous Dual Input

Inbound migration lebih tricky.

Payload bisa mengirim keduanya:

```json
{
  "officerName": "Dina",
  "assignedOfficerName": "Budi"
}
```

Apa yang harus dipakai?

Jangan biarkan Jackson diam-diam memilih berdasarkan property order. Buat rule eksplisit:

- reject jika keduanya ada dan berbeda;
- canonical field menang jika keduanya sama;
- legacy field diterima hanya jika canonical absent;
- log penggunaan legacy field.

Butuh custom deserializer atau parse ke `JsonNode` untuk migration endpoint penting.

---

## 16. Additive Change Tidak Selalu Aman

Secara teori, menambah field response adalah backward-compatible untuk tolerant consumers.

Response lama:

```json
{
  "caseId": "C-1001"
}
```

Response baru:

```json
{
  "caseId": "C-1001",
  "riskScore": 87
}
```

Bagi client yang strict schema validation, field baru bisa dianggap error.

Karena itu, compatibility bergantung pada consumer behavior.

### 16.1 Tolerant Reader Pattern

Consumer yang baik biasanya:

- membaca field yang dibutuhkan;
- mengabaikan unknown field;
- tidak menganggap object harus exact shape;
- tidak gagal karena field tambahan;
- punya default behavior untuk enum/value baru.

Tapi kita tidak selalu mengontrol consumer.

### 16.2 Enterprise Reality

Untuk public/partner API:

- dokumentasikan policy bahwa response bisa bertambah field;
- minta consumer ignore unknown field;
- gunakan versioning jika consumer strict;
- lakukan consumer-driven contract jika consumer kritis;
- hindari menambah field dengan nama yang bisa konflik dengan extension field consumer.

---

## 17. Removing Field Hampir Selalu Breaking

Menghapus field dari response:

```json
{
  "caseId": "C-1001",
  "status": "OPEN"
}
```

menjadi:

```json
{
  "caseId": "C-1001"
}
```

hampir selalu breaking jika ada consumer yang bergantung pada `status`.

Menghapus field inbound juga breaking jika client lama masih mengirim field tersebut dan strict mapper menolak unknown field.

Strategi:

- deprecate dulu;
- accept old inbound selama migration;
- emit old outbound selama migration;
- hapus di versi baru atau major release;
- jika harus emergency removal karena security, beri clear incident/migration notice.

---

## 18. Changing Field Type Adalah Breaking, Walaupun Nama Sama

Contoh breaking:

```json
{
  "amount": 100
}
```

menjadi:

```json
{
  "amount": "100"
}
```

Atau:

```json
{
  "officer": "Dina"
}
```

menjadi:

```json
{
  "officer": {
    "name": "Dina"
  }
}
```

Walaupun field name sama, tipe berubah. Ini breaking.

Lebih aman:

```json
{
  "officerName": "Dina",
  "officer": {
    "name": "Dina",
    "userId": "U-9001"
  }
}
```

Kemudian deprecate `officerName`.

---

## 19. Date/Time Contract Harus Stabil

Date/time adalah salah satu sumber drift paling umum.

Bad contract:

```json
{
  "submittedAt": "17/06/2026 10:15"
}
```

Masalah:

- format lokal;
- timezone tidak jelas;
- ordering sulit;
- parsing ambiguous;
- DST/timezone issue;
- locale-sensitive.

Better:

```json
{
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Atau jika selalu UTC:

```json
{
  "submittedAt": "2026-06-17T03:15:30Z"
}
```

### 19.1 DTO Type Choice

| Java Type | Cocok untuk | Catatan |
|---|---|---|
| `Instant` | machine timestamp UTC | bagus untuk event/audit |
| `OffsetDateTime` | timestamp dengan offset | bagus untuk API external |
| `LocalDate` | tanggal tanpa waktu | expiry date, birth date |
| `LocalDateTime` | waktu lokal tanpa zone | berbahaya untuk event global |
| `ZonedDateTime` | timezone region-aware | lebih kompleks, jarang perlu di API |

### 19.2 Contract Rule

```text
Jangan ganti format tanggal diam-diam.
Jangan ganti timezone semantics diam-diam.
Jangan expose LocalDateTime untuk event lintas zona tanpa definisi timezone.
```

---

## 20. Decimal and Money: Jangan Pakai `double` untuk Contract Finansial

JSON number tidak membawa precision semantics. Java `double` punya binary floating-point behavior.

Untuk amount/money:

```java
public class PaymentDto {
    private BigDecimal amount;
    private String currency;
}
```

Payload:

```json
{
  "amount": "100.25",
  "currency": "SGD"
}
```

atau:

```json
{
  "amount": 100.25,
  "currency": "SGD"
}
```

Mana yang lebih baik?

Trade-off:

| Bentuk JSON | Kelebihan | Kekurangan |
|---|---|---|
| number | natural JSON numeric | JS client precision risk untuk angka besar/decimal tertentu |
| string | precision lebih aman | perlu validasi format eksplisit |

Untuk regulatory/financial, string decimal sering dipilih agar precision contract eksplisit, tetapi harus didokumentasikan sebagai decimal string, bukan arbitrary string.

Contoh:

```json
{
  "amount": "100.25"
}
```

Validation:

```text
pattern: ^-?\d+(\.\d{1,2})?$
```

Di Java:

```java
public record MoneyDto(String amount, String currency) {
    public BigDecimal amountAsBigDecimal() {
        return new BigDecimal(amount);
    }
}
```

Untuk Java 8:

```java
public final class MoneyDto {
    private final String amount;
    private final String currency;

    public MoneyDto(String amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }

    public BigDecimal amountAsBigDecimal() {
        return new BigDecimal(amount);
    }
}
```

---

## 21. Canonical Output: Satu Bentuk Resmi

Inbound bisa menerima beberapa bentuk selama migration:

```json
{
  "officerName": "Dina"
}
```

atau:

```json
{
  "assignedOfficerName": "Dina"
}
```

Tetapi outbound sebaiknya punya satu canonical form:

```json
{
  "assignedOfficerName": "Dina"
}
```

Prinsip:

> Be liberal in what you accept only when boundary membutuhkan compatibility; be consistent in what you produce.

Jika output punya banyak variasi, consumer bingung. Canonical output membuat dokumentasi, test, caching, signing, diffing, audit, dan contract review lebih mudah.

---

## 22. Versioning Strategy: URI, Header, Field, atau Media Type?

JSON contract evolution kadang cukup dengan additive change dan deprecation. Tetapi breaking change butuh versioning.

Pilihan umum:

### 22.1 URI Versioning

```text
/api/v1/cases
/api/v2/cases
```

Kelebihan:

- mudah dimengerti;
- mudah routing;
- mudah dokumentasi;
- cocok untuk public API.

Kekurangan:

- bisa duplikasi endpoint;
- versi besar terasa berat;
- resource identity tercampur versi.

### 22.2 Header Versioning

```text
X-API-Version: 2
```

Kelebihan:

- URI bersih;
- bisa version per client.

Kekurangan:

- kurang terlihat;
- cache/proxy perlu perhatian;
- debugging manual lebih sulit.

### 22.3 Media Type Versioning

```text
Accept: application/vnd.company.case-v2+json
```

Kelebihan:

- REST/content negotiation friendly;
- eksplisit pada representation.

Kekurangan:

- lebih kompleks;
- tidak semua client nyaman.

### 22.4 Field-Level Versioning

```json
{
  "schemaVersion": 2,
  "caseId": "C-1001"
}
```

Kelebihan:

- bagus untuk event/message;
- payload self-describing.

Kekurangan:

- tidak cukup untuk HTTP routing sendiri;
- logic deserializer lebih kompleks.

### 22.5 Rekomendasi

```text
Public REST API       -> URI atau media type versioning
Internal event        -> schemaVersion dalam payload/header event
Partner callback      -> explicit version per partner contract
Batch file JSON       -> schemaVersion di file metadata/payload
```

---

## 23. DTO Versioning: Jangan Pakai Satu Class untuk Semua Versi Besar

Anti-pattern:

```java
public class CaseResponse {
    private String caseId;
    private String oldStatus;
    private String newStatus;
    private OfficerDto officer;
    private String officerName;
    private Integer schemaVersion;
    // dozens of conditional fields...
}
```

Class menjadi penuh conditional.

Lebih baik:

```java
public class CaseResponseV1 {
    private String caseId;
    private String status;
    private String officerName;
}

public class CaseResponseV2 {
    private String caseId;
    private CaseStatusDto status;
    private OfficerDto assignedOfficer;
}
```

Lalu mapping dipisah:

```java
public class CaseResponseMapper {

    public CaseResponseV1 toV1(CaseView view) {
        // compatibility mapping
    }

    public CaseResponseV2 toV2(CaseView view) {
        // canonical new mapping
    }
}
```

Prinsip:

> Versi kontrak besar layak punya DTO berbeda.

---

## 24. Backward Compatibility vs Forward Compatibility

### 24.1 Backward Compatibility

Service baru masih bisa melayani client lama.

Contoh:

- menerima field lama via `@JsonAlias`;
- tetap emit deprecated field;
- endpoint v1 tetap aktif;
- enum lama tetap didukung;
- format tanggal lama masih diterima di migration adapter.

### 24.2 Forward Compatibility

Service/client lama bisa bertahan saat berhadapan dengan payload baru.

Contoh:

- consumer mengabaikan unknown field;
- event consumer tidak gagal saat producer menambah metadata;
- client punya default handling untuk enum baru;
- payload punya schemaVersion;
- unknown extension disimpan dalam map.

### 24.3 Trade-Off

Strict inbound meningkatkan correctness, tapi mengurangi forward compatibility.
Lenient inbound meningkatkan survivability, tapi bisa menyembunyikan bug.

Karena itu kita kembali ke boundary policy.

---

## 25. Tolerant Reader Pattern dengan Extension Fields

Kadang kita ingin menerima field tambahan secara eksplisit, bukan sekadar ignore.

Contoh:

```java
public class PartnerEvent {
    private String eventId;
    private String eventType;

    private Map<String, JsonNode> extensions = new LinkedHashMap<>();

    @JsonAnySetter
    public void putExtension(String name, JsonNode value) {
        extensions.put(name, value);
    }

    @JsonAnyGetter
    public Map<String, JsonNode> getExtensions() {
        return extensions;
    }
}
```

Payload:

```json
{
  "eventId": "E-1001",
  "eventType": "CASE_UPDATED",
  "partnerSpecificCode": "ABC",
  "sourceSystem": "LEGACY-X"
}
```

`partnerSpecificCode` dan `sourceSystem` masuk ke extensions.

Kapan cocok:

- external event;
- plugin model;
- metadata extensibility;
- partner-specific fields;
- schema evolution dengan extension area.

Kapan tidak cocok:

- command API sensitif;
- regulated input yang harus exact;
- DTO internal domain;
- field yang seharusnya divalidasi.

---

## 26. Golden Payload Tests: Menjaga Bentuk JSON Stabil

Unit test mapper biasa tidak cukup. Kita butuh test yang menjaga bentuk JSON kontrak.

### 26.1 Golden Serialization Test

File:

```text
src/test/resources/contracts/case-response-v1.json
```

Isi:

```json
{
  "caseId": "C-1001",
  "status": "OPEN",
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Test:

```java
class CaseResponseContractTest {

    private final ObjectMapper mapper = TestObjectMappers.contractMapper();

    @Test
    void shouldSerializeCaseResponseUsingStableContract() throws Exception {
        CaseResponse response = new CaseResponse(
                "C-1001",
                "OPEN",
                OffsetDateTime.parse("2026-06-17T10:15:30+07:00")
        );

        String actualJson = mapper.writerWithDefaultPrettyPrinter()
                .writeValueAsString(response);

        String expectedJson = Files.readString(
                Path.of("src/test/resources/contracts/case-response-v1.json")
        );

        assertJsonEquals(expectedJson, actualJson);
    }
}
```

Untuk Java 8, gunakan:

```java
String expectedJson = new String(
        Files.readAllBytes(Paths.get("src/test/resources/contracts/case-response-v1.json")),
        StandardCharsets.UTF_8
);
```

### 26.2 Jangan Bandingkan String Mentah Jika Ordering Tidak Dijamin

Gunakan JSON structural comparison:

```java
static void assertJsonEquals(String expected, String actual) throws Exception {
    ObjectMapper mapper = TestObjectMappers.contractMapper();
    JsonNode expectedNode = mapper.readTree(expected);
    JsonNode actualNode = mapper.readTree(actual);
    assertEquals(expectedNode, actualNode);
}
```

Jika property order adalah bagian dari kontrak khusus, baru bandingkan string atau canonical form.

---

## 27. Golden Deserialization Tests

Test inbound penting untuk memastikan payload lama masih bisa dibaca.

File:

```text
src/test/resources/contracts/create-case-request-v1-legacy.json
```

Isi:

```json
{
  "applicant_name": "Dina",
  "case_type": "LICENCE_APPEAL"
}
```

DTO baru:

```java
public class CreateCaseRequest {

    @JsonProperty("applicantName")
    @JsonAlias("applicant_name")
    private String applicantName;

    @JsonProperty("caseType")
    @JsonAlias("case_type")
    private String caseType;
}
```

Test:

```java
@Test
void shouldDeserializeLegacyCreateCaseRequest() throws Exception {
    String json = readResource("contracts/create-case-request-v1-legacy.json");

    CreateCaseRequest request = mapper.readValue(json, CreateCaseRequest.class);

    assertEquals("Dina", request.getApplicantName());
    assertEquals("LICENCE_APPEAL", request.getCaseType());
}
```

Test seperti ini menjaga backward compatibility.

---

## 28. Negative Contract Tests

Test tidak hanya happy path. Harus ada negative tests untuk memastikan invalid payload benar-benar ditolak.

Contoh unknown field harus ditolak:

```java
@Test
void shouldRejectUnknownFieldForCreateCaseCommand() {
    String json = """
            {
              "applicantName": "Dina",
              "caseType": "LICENCE_APPEAL",
              "isAdminApproved": true
            }
            """;

    assertThrows(JsonMappingException.class, () ->
            strictMapper.readValue(json, CreateCaseRequest.class)
    );
}
```

Untuk Java 8 tanpa text block:

```java
String json = "{"
        + "\"applicantName\":\"Dina\","
        + "\"caseType\":\"LICENCE_APPEAL\","
        + "\"isAdminApproved\":true"
        + "}";
```

Contoh enum ordinal harus ditolak:

```java
@Test
void shouldRejectEnumOrdinal() {
    String json = "{\"status\":1}";

    assertThrows(JsonMappingException.class, () ->
            strictMapper.readValue(json, UpdateStatusRequest.class)
    );
}
```

Contoh wrong type harus ditolak:

```java
@Test
void shouldRejectStringForNumericAmount() {
    String json = "{\"amount\":\"100.25\"}";

    assertThrows(JsonMappingException.class, () ->
            strictMapper.readValue(json, PaymentRequest.class)
    );
}
```

Negative tests adalah cara memastikan strictness tidak berubah tanpa sadar saat ObjectMapper configuration berubah.

---

## 29. Contract Matrix: Cara Senior Engineer Melihat Perubahan DTO

Setiap perubahan DTO harus diklasifikasi.

| Perubahan | Inbound Impact | Outbound Impact | Biasanya Breaking? | Strategi |
|---|---:|---:|---:|---|
| Tambah optional field inbound | rendah | n/a | tidak, jika server lenient/field optional | dokumentasi |
| Tambah required field inbound | tinggi | n/a | ya | versi baru atau default/migration |
| Tambah response field | n/a | rendah-sedang | tidak untuk tolerant consumer | dokumentasi, contract policy |
| Hapus response field | n/a | tinggi | ya | deprecate dulu |
| Rename field inbound | tinggi | n/a | ya | `@JsonAlias`, migration window |
| Rename field outbound | n/a | tinggi | ya | dual-write/deprecate/version |
| Ubah tipe field | tinggi | tinggi | ya | field baru, deprecate lama |
| Tambah enum value | sedang | sedang | bisa | consumer notice, default handling |
| Rename enum value | tinggi | tinggi | ya | alias/custom mapping/version |
| Ubah date format | tinggi | tinggi | ya | jangan; atau version |
| Ubah null menjadi absent | sedang | sedang | bisa | policy jelas |
| Ubah absent menjadi null | sedang | sedang | bisa | policy jelas |
| Tambah object wrapper | tinggi | tinggi | ya | field baru/version |

Checklist review:

```text
Apakah perubahan ini mengubah nama field JSON?
Apakah mengubah tipe JSON?
Apakah mengubah required/nullability?
Apakah mengubah enum literal?
Apakah mengubah date/time/decimal format?
Apakah menghapus field?
Apakah response menjadi lebih besar dan memengaruhi client/mobile?
Apakah field baru sensitif?
Apakah OpenAPI berubah?
Apakah golden payload test berubah?
Apakah consumer sudah diberi migration path?
```

---

## 30. Mapper Profile: Public API vs Internal Event vs Legacy Adapter

Contoh desain ObjectMapper profiles.

```java
public final class JsonMapperProfiles {

    private JsonMapperProfiles() {
    }

    public static ObjectMapper publicCommandMapper() {
        return JsonMapper.builder()
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
                .build();
    }

    public static ObjectMapper eventConsumerMapper() {
        return JsonMapper.builder()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .build();
    }

    public static ObjectMapper legacyPartnerMapper() {
        return JsonMapper.builder()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .build();
    }
}
```

Catatan compatibility:

- Beberapa API builder/config bisa berbeda antara Jackson 2.x dan 3.x.
- Di Jackson 3, ada perubahan package/group id besar dari `com.fasterxml.jackson` ke `tools.jackson` untuk banyak komponen Jackson, sementara migration guide resmi harus dijadikan acuan saat upgrade.
- Untuk codebase Spring Boot/Jakarta modern, jangan asumsikan semua library sudah Jackson 3-ready.

Prinsipnya bukan hafal syntax, tetapi punya profile strategy.

---

## 31. API Contract Drift: Bagaimana Terjadi di Real Project

Contract drift sering terjadi lewat jalur berikut:

### 31.1 Refactor Internal Field

Developer rename Java field:

```java
private String officerName;
```

menjadi:

```java
private String assignedOfficerName;
```

Tanpa `@JsonProperty`, JSON berubah.

### 31.2 Lombok/Record Migration

Class mutable:

```java
public class CaseResponse {
    private String caseId;
    private String status;
}
```

Migrasi ke record:

```java
public record CaseResponse(String id, String status) {}
```

JSON field berubah dari `caseId` menjadi `id` jika tidak diberi annotation.

### 31.3 Global ObjectMapper Change

Seseorang mengubah:

```java
spring.jackson.default-property-inclusion=non_null
```

Response yang dulu:

```json
{
  "caseId": "C-1001",
  "remarks": null
}
```

menjadi:

```json
{
  "caseId": "C-1001"
}
```

Bagi client, absent dan null bisa berbeda.

### 31.4 Enum Refactor

```java
IN_PROGRESS
```

renamed to:

```java
PROCESSING
```

Internal lebih bagus, external breaking.

### 31.5 Date Module Change

ObjectMapper tanpa JavaTimeModule atau konfigurasi timestamp berubah bisa mengubah date shape.

---

## 32. Stabilizing Contract dengan Explicit Annotation

Untuk DTO public, eksplisit lebih baik.

```java
public class CaseResponse {

    @JsonProperty("caseId")
    private String caseId;

    @JsonProperty("status")
    private String status;

    @JsonProperty("submittedAt")
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    private OffsetDateTime submittedAt;
}
```

Apakah ini verbose? Ya.

Tapi untuk public/regulatory/partner API, verbosity ini adalah insurance.

Rule:

```text
Internal DTO: boleh convention-based jika risiko rendah.
External/public DTO: gunakan explicit property names untuk field penting.
```

---

## 33. DTO Documentation dan Runtime Harus Selaras

OpenAPI bisa mengatakan:

```yaml
caseId:
  type: string
  nullable: false
  required: true
```

Tetapi runtime DTO bisa:

```java
private String caseId;
```

Dan Jackson/validation bisa menerima missing/null.

Itu drift antara docs dan runtime.

Alignment membutuhkan:

- DTO annotation;
- Bean Validation;
- Jackson strictness;
- schema generation config;
- contract tests;
- API review.

Jangan percaya generated OpenAPI begitu saja tanpa melihat runtime behavior.

---

## 34. Example: Designing a Compatible Field Rename

### 34.1 Current Contract V1

Inbound:

```json
{
  "officerName": "Dina"
}
```

Outbound:

```json
{
  "caseId": "C-1001",
  "officerName": "Dina"
}
```

### 34.2 Target Contract V2

Inbound:

```json
{
  "assignedOfficerName": "Dina"
}
```

Outbound:

```json
{
  "caseId": "C-1001",
  "assignedOfficerName": "Dina"
}
```

### 34.3 Migration DTO

```java
public class AssignOfficerRequest {

    @JsonProperty("assignedOfficerName")
    @JsonAlias("officerName")
    private String assignedOfficerName;

    public String getAssignedOfficerName() {
        return assignedOfficerName;
    }

    public void setAssignedOfficerName(String assignedOfficerName) {
        this.assignedOfficerName = assignedOfficerName;
    }
}
```

### 34.4 Response During Transition

```java
public class CaseResponseV1Compatible {

    @JsonProperty("caseId")
    private String caseId;

    @JsonProperty("assignedOfficerName")
    private String assignedOfficerName;

    @Deprecated
    @JsonProperty("officerName")
    public String getOfficerName() {
        return assignedOfficerName;
    }
}
```

### 34.5 Test Cases

```text
Should accept officerName legacy input.
Should accept assignedOfficerName new input.
Should serialize assignedOfficerName.
Should still serialize officerName during migration.
Should reject both fields if values conflict.
Should update OpenAPI with deprecation note.
Should remove officerName only after agreed version/window.
```

Conflict test may require `JsonNode` parsing instead of plain alias.

---

## 35. Example: Strict Command API Design

Request:

```java
public class CreateEnforcementCaseRequest {

    @JsonProperty("applicantName")
    private String applicantName;

    @JsonProperty("caseType")
    private String caseType;

    @JsonProperty("submittedAt")
    private OffsetDateTime submittedAt;

    // getters/setters
}
```

Mapper profile:

```java
public static ObjectMapper commandApiMapper() {
    return JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .build();
}
```

Accepted:

```json
{
  "applicantName": "Dina",
  "caseType": "LICENCE_APPEAL",
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Rejected:

```json
{
  "applicantName": "Dina",
  "caseType": "LICENCE_APPEAL",
  "submittedAt": "2026-06-17T10:15:30+07:00",
  "adminApproved": true
}
```

Rejected:

```json
{
  "applicantName": "Dina",
  "caseType": 123,
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Why:

- write API should not silently ignore suspicious fields;
- type mismatch should be fixed by client;
- server should not guess business intent.

---

## 36. Example: Lenient Event Consumer Design

Event V1:

```json
{
  "eventId": "E-1001",
  "eventType": "CASE_SUBMITTED",
  "caseId": "C-1001"
}
```

Event V2:

```json
{
  "eventId": "E-1001",
  "eventType": "CASE_SUBMITTED",
  "caseId": "C-1001",
  "sourceSystem": "ACEAS",
  "schemaVersion": 2
}
```

Consumer lama seharusnya tetap bisa membaca event V2 jika `sourceSystem` dan `schemaVersion` tidak dibutuhkan.

DTO:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public class CaseSubmittedEventV1 {
    private String eventId;
    private String eventType;
    private String caseId;
}
```

Atau mapper profile lenient.

Tetapi tetap simpan metadata raw event jika audit/replay penting.

---

## 37. Error Response Contract

Contract bukan hanya request/response sukses. Error response juga contract.

Bad error:

```json
{
  "error": "com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException: Unrecognized field..."
}
```

Masalah:

- leakage internal class;
- sulit diparse client;
- tidak stabil;
- terlalu teknis;
- bisa bocorkan field internal.

Better:

```json
{
  "code": "INVALID_REQUEST_BODY",
  "message": "Request body contains an unsupported field.",
  "details": [
    {
      "field": "adminApproved",
      "reason": "Unsupported field."
    }
  ],
  "correlationId": "abc-123"
}
```

Untuk wrong type:

```json
{
  "code": "INVALID_FIELD_TYPE",
  "message": "One or more fields have invalid types.",
  "details": [
    {
      "field": "caseType",
      "expected": "string",
      "reason": "Expected a string value."
    }
  ],
  "correlationId": "abc-123"
}
```

Mapper/deserialization exception harus diterjemahkan ke error contract yang stabil.

---

## 38. Handling Duplicate JSON Fields

JSON object secara praktis sering diasumsikan tidak punya duplicate property, tetapi payload bisa mengandung:

```json
{
  "status": "APPROVED",
  "status": "REJECTED"
}
```

Jika parser mengambil value terakhir, ini bisa berbahaya.

Untuk API sensitif, duplicate key harus dipertimbangkan sebagai invalid payload.

Policy:

```text
Public command API    -> reject duplicate key
Event consumer        -> ideally reject or log, tergantung source trust
Legacy integration    -> normalize only if contract jelas
```

Jackson memiliki fitur terkait duplicate key untuk tree reading di `DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY`. Untuk streaming/databind, detail behavior bisa berbeda berdasarkan konfigurasi dan versi, jadi pastikan dites pada ObjectMapper profile yang benar.

---

## 39. JSON View: Hati-Hati Sebagai Contract Mechanism

Jackson punya `@JsonView` untuk serialization view.

Contoh:

```java
public class Views {
    public interface Public {}
    public interface Internal extends Public {}
}

public class CaseDto {
    @JsonView(Views.Public.class)
    private String caseId;

    @JsonView(Views.Internal.class)
    private String internalRemarks;
}
```

Bisa digunakan:

```java
String publicJson = mapper
        .writerWithView(Views.Public.class)
        .writeValueAsString(dto);
```

Namun untuk enterprise contract, `@JsonView` bisa membuat satu DTO punya banyak bentuk tersembunyi.

Risiko:

- sulit dites semua kombinasi;
- controller salah view bisa bocor data;
- dokumentasi OpenAPI bisa tidak akurat;
- DTO menjadi multi-contract;
- security bergantung pada runtime selection.

Rekomendasi:

```text
Untuk public/internal response berbeda secara signifikan, lebih baik DTO berbeda.
Gunakan JsonView hanya untuk kasus sangat terkendali dan dites ketat.
```

---

## 40. Mix-ins: Migration Tool, Bukan Fondasi Utama

Jackson mix-in bisa menambahkan annotation ke class yang tidak bisa diubah.

Contoh external class:

```java
public class LegacyPerson {
    public String n;
}
```

Mix-in:

```java
abstract class LegacyPersonMixin {
    @JsonProperty("name")
    public String n;
}
```

Registration:

```java
ObjectMapper mapper = JsonMapper.builder()
        .addMixIn(LegacyPerson.class, LegacyPersonMixin.class)
        .build();
```

Kapan berguna:

- third-party class;
- migration tanpa mengubah source;
- compatibility adapter;
- temporary bridge.

Risiko:

- annotation tidak terlihat di DTO;
- behavior tersembunyi di config;
- debugging lebih sulit;
- contract ownership kabur.

Rule:

```text
Mix-in cocok sebagai adapter/migration mechanism.
Untuk DTO milik sendiri, prefer explicit annotation langsung atau DTO baru.
```

---

## 41. Contract Ownership: Siapa yang Berhak Mengubah DTO?

Di banyak team, DTO diubah seperti class internal biasa. Ini salah untuk public/shared contract.

Perlu ownership:

```text
Public API DTO        -> API owner / platform / module owner
Partner integration   -> adapter owner + partner contract owner
Internal event DTO    -> producing domain owner
Persistence DTO       -> owning service/module
Admin UI DTO          -> backend + frontend agreement
```

Perubahan DTO harus melalui checklist:

- Apakah breaking?
- Apakah OpenAPI/event schema update?
- Apakah golden payload test update?
- Apakah consumer impacted?
- Apakah migration path ada?
- Apakah old field masih diterima/dikirim?
- Apakah security review perlu?

---

## 42. Contract Review Example

Pull request mengubah:

```java
public class CaseResponse {
    private String id;
    private String status;
}
```

menjadi:

```java
public class CaseResponse {
    private String caseId;
    private String status;
}
```

Reviewer harus bertanya:

```text
Apakah JSON field berubah dari id ke caseId?
Apakah ini endpoint public?
Apakah consumer lama masih butuh id?
Apakah ada @JsonProperty untuk menjaga id?
Apakah OpenAPI berubah?
Apakah golden response test gagal?
Apakah perlu dual field sementara?
```

Pilihan compatibility:

```java
public class CaseResponse {

    @JsonProperty("id")
    private String caseId;

    public String getCaseId() {
        return caseId;
    }
}
```

Internal Java boleh `caseId`, JSON tetap `id`.

Atau response migration:

```java
public class CaseResponse {

    @JsonProperty("caseId")
    private String caseId;

    @Deprecated
    @JsonProperty("id")
    public String getLegacyId() {
        return caseId;
    }
}
```

---

## 43. Java 8 sampai Java 25: Apa yang Berubah untuk Contract DTO?

### 43.1 Java 8 Style

```java
public class CaseResponse {
    private String caseId;
    private String status;

    public CaseResponse() {
    }

    public String getCaseId() {
        return caseId;
    }

    public void setCaseId(String caseId) {
        this.caseId = caseId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
```

Pros:

- compatible dengan banyak framework lama;
- easy databind;
- mutable.

Cons:

- weak invariants;
- accidental mutation;
- no constructor guarantee;
- refactor field bisa mengubah contract jika tidak explicit.

### 43.2 Java 16+ Record Style

```java
public record CaseResponse(
        @JsonProperty("caseId") String caseId,
        @JsonProperty("status") String status
) {
}
```

Pros:

- immutable;
- concise;
- constructor-based;
- good for response DTO;
- less boilerplate.

Cons:

- Java 8 incompatible;
- component name adalah contract jika tanpa annotation;
- patch/update DTO tidak selalu cocok;
- binary/source compatibility harus dipikirkan.

### 43.3 Sealed Types for Versioned/Polymorphic Contract

Java modern bisa menggunakan sealed hierarchy untuk closed polymorphic DTO.

```java
public sealed interface CaseEventDto
        permits CaseSubmittedDto, CaseApprovedDto {
}

public record CaseSubmittedDto(String caseId) implements CaseEventDto {
}

public record CaseApprovedDto(String caseId, String approvedBy) implements CaseEventDto {
}
```

Bagus untuk event model, tapi perlu explicit Jackson polymorphic contract. Jangan mengandalkan class name sebagai type id.

---

## 44. Jackson 2 vs Jackson 3: Contract Thinking Saat Upgrade

Jackson 3 adalah major version. Major version berarti potensi breaking behavior/config/package. Migration guide resmi Jackson 3 harus menjadi rujukan upgrade, terutama karena ada perubahan besar pada coordinates/package untuk banyak komponen Jackson 3.

Saat upgrade Jackson:

```text
Jangan hanya run test unit.
Run contract serialization tests.
Run contract deserialization tests.
Run negative tests.
Run golden payload diff.
Run API compatibility suite.
Check date/time shape.
Check null inclusion.
Check unknown field behavior.
Check enum behavior.
Check custom serializer/deserializer.
Check module registration.
```

Upgrade JSON library bisa menjadi API breaking change walaupun business code tidak berubah.

---

## 45. Production Checklist: Jackson API Contract

Gunakan checklist berikut untuk setiap endpoint/event penting.

### 45.1 Inbound Checklist

```text
[ ] Apakah unknown field harus ditolak atau diterima?
[ ] Apakah unknown field yang diterima tetap dimonitor?
[ ] Apakah field required ditegakkan?
[ ] Apakah null dan missing dibedakan jika perlu?
[ ] Apakah scalar coercion dikontrol?
[ ] Apakah enum ordinal ditolak?
[ ] Apakah duplicate key dipertimbangkan?
[ ] Apakah field deprecated masih diterima?
[ ] Apakah rename field memakai alias/migration rule?
[ ] Apakah payload error dipetakan ke error response stabil?
[ ] Apakah raw payload tidak dilog sembarangan?
```

### 45.2 Outbound Checklist

```text
[ ] Apakah field JSON punya nama eksplisit untuk contract public?
[ ] Apakah null inclusion policy stabil?
[ ] Apakah date/time format stabil?
[ ] Apakah decimal/money format stabil?
[ ] Apakah enum literal stabil?
[ ] Apakah field sensitive tidak keluar?
[ ] Apakah deprecated field masih perlu dikirim?
[ ] Apakah response punya golden payload test?
[ ] Apakah OpenAPI sesuai runtime?
[ ] Apakah perubahan response diklasifikasikan breaking/additive?
```

### 45.3 Evolution Checklist

```text
[ ] Apakah perubahan ini additive?
[ ] Apakah ada consumer yang strict terhadap unknown field?
[ ] Apakah perlu API version baru?
[ ] Apakah perlu deprecation window?
[ ] Apakah perlu dual-read?
[ ] Apakah perlu dual-write?
[ ] Apakah telemetry pemakaian field lama tersedia?
[ ] Apakah contract tests untuk payload lama masih ada?
[ ] Apakah changelog/migration guide disiapkan?
```

---

## 46. Common Anti-Patterns

### 46.1 Menggunakan Entity Sebagai API Contract

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable String id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

- field internal bocor;
- lazy proxy issue;
- contract berubah mengikuti database;
- bidirectional relationship bisa cycle;
- security annotation tidak cukup;
- refactor entity menjadi breaking API.

### 46.2 Global Leniency Tanpa Test

```java
objectMapper.disable(FAIL_ON_UNKNOWN_PROPERTIES);
```

Semua input menjadi tolerant tanpa policy.

### 46.3 Rename DTO Field Tanpa Golden Test

```java
private String caseId;
```

menjadi:

```java
private String id;
```

Response JSON berubah tanpa review.

### 46.4 Menggunakan `@JsonIgnore` untuk Security Utama

```java
@JsonIgnore
private String passwordHash;
```

Ini safety net. Desain utama harus tidak memakai object sensitif sebagai response DTO.

### 46.5 Satu DTO untuk Semua Versi

DTO menjadi penuh optional/deprecated/conditional field dan sulit dipahami.

---

## 47. Mini Case Study: Case Management API Evolution

### 47.1 V1 Response

```json
{
  "caseId": "C-1001",
  "status": "OPEN",
  "officerName": "Dina"
}
```

### 47.2 New Requirement

Perlu expose officer id dan team.

Naive breaking change:

```json
{
  "caseId": "C-1001",
  "status": "OPEN",
  "officer": {
    "id": "U-9001",
    "name": "Dina",
    "team": "Licensing"
  }
}
```

Masalah: `officerName` hilang.

### 47.3 Compatible Transition

```json
{
  "caseId": "C-1001",
  "status": "OPEN",
  "officerName": "Dina",
  "officer": {
    "id": "U-9001",
    "name": "Dina",
    "team": "Licensing"
  }
}
```

DTO:

```java
public class CaseResponse {

    @JsonProperty("caseId")
    private String caseId;

    @JsonProperty("status")
    private String status;

    @JsonProperty("officer")
    private OfficerResponse officer;

    @Deprecated
    @JsonProperty("officerName")
    public String getOfficerName() {
        return officer == null ? null : officer.getName();
    }
}
```

Review:

```text
Is officerName deprecated in OpenAPI? yes.
Is removal date defined? yes.
Is golden payload updated? yes.
Do we have V1 consumer tests? yes.
Does officer contain sensitive internal user data? checked.
Is officer.id stable external id or internal DB id? must be external-safe id.
```

Top 1% engineer tidak hanya membuat JSON baru. Ia mengatur migration path dan mencegah consumer rusak.

---

## 48. Decision Framework

Saat mendesain atau mengubah contract, tanyakan secara berurutan:

```text
1. Boundary apa ini?
   Public API, internal API, event, batch, partner, admin, persistence?

2. Siapa consumer-nya?
   Browser, mobile, partner, service lain, BI/reporting, audit replay?

3. Apakah consumer bisa diubah bersamaan?
   Kalau tidak, backward compatibility wajib.

4. Apakah input trusted?
   Kalau tidak, strictness dan validation lebih penting.

5. Apakah unknown field harus survivable?
   Kalau ya, tolerant reader + telemetry.

6. Apakah perubahan field additive atau breaking?
   Klasifikasikan sebelum coding.

7. Apakah DTO public terlindungi dari refactor internal?
   Gunakan explicit @JsonProperty.

8. Apakah ada test kontrak?
   Golden payload + negative tests.

9. Apakah docs dan runtime selaras?
   OpenAPI/schema harus match ObjectMapper behavior.

10. Apakah ada migration plan?
   Alias, dual-read, dual-write, versioning, deprecation.
```

---

## 49. Latihan Praktis

### Latihan 1 — Classify Contract Changes

Untuk setiap perubahan di bawah, klasifikasikan sebagai additive, potentially breaking, atau breaking:

1. Menambah optional response field `remarks`.
2. Menghapus response field `remarks`.
3. Mengubah `status` dari string menjadi object.
4. Menambah enum value `SUSPENDED`.
5. Mengubah date format dari ISO offset ke `dd/MM/yyyy`.
6. Mengubah DTO Java field `caseId` menjadi `id` tanpa `@JsonProperty`.
7. Menambah required request field `reason`.
8. Menerima field lama `officerName` sebagai alias dari `assignedOfficerName`.

Expected reasoning:

```text
1. Additive, tetapi bisa breaking untuk strict consumer.
2. Breaking.
3. Breaking.
4. Potentially breaking.
5. Breaking.
6. Breaking jika JSON name ikut berubah.
7. Breaking.
8. Backward-compatible migration improvement.
```

### Latihan 2 — Design Migration

Current inbound:

```json
{
  "handlerName": "Dina"
}
```

Target inbound:

```json
{
  "assignedOfficerName": "Dina"
}
```

Tugas:

- desain DTO;
- tentukan behavior jika kedua field ada;
- tentukan telemetry;
- tentukan kapan alias boleh dihapus;
- tulis test cases.

### Latihan 3 — Strict Mapper Profile

Buat mapper profile untuk public command API yang:

- menolak unknown field;
- menolak enum ordinal;
- menolak coercion scalar;
- memakai Java time module;
- menghasilkan error response yang tidak bocor class internal.

### Latihan 4 — Golden Payload

Ambil salah satu response DTO di project. Buat:

- golden JSON response;
- serialization test;
- deserialization compatibility test;
- negative test untuk unknown field;
- negative test untuk wrong enum value.

---

## 50. Ringkasan Mental Model

Jackson di enterprise bukan hanya JSON utility. Ia adalah bagian dari contract enforcement layer.

Pegangan utama:

```text
1. DTO public adalah kontrak, bukan object internal.
2. Nama field Java tidak boleh sembarang menentukan nama field JSON public.
3. Strictness harus dipilih per boundary.
4. Lenient tidak boleh berarti silent dan invisible.
5. Rename field butuh alias/migration/versioning.
6. Removing/changing field type hampir selalu breaking.
7. Null dan missing punya makna berbeda.
8. Enum evolution bisa breaking bagi consumer.
9. Date/time/decimal format adalah bagian dari kontrak.
10. Golden payload tests melindungi contract dari refactor internal.
11. OpenAPI/schema harus match runtime ObjectMapper behavior.
12. Upgrade Jackson bisa mengubah contract behavior; test harus menangkapnya.
```

Top 1% engineer tidak hanya tahu annotation Jackson. Ia tahu kapan annotation itu menjadi policy kontrak, kapan harus dipisah ke ObjectMapper profile, kapan harus membuat DTO versi baru, kapan harus dual-read/dual-write, dan kapan harus menolak perubahan karena secara kontrak merusak consumer.

---

## 51. Referensi Utama

- Jackson `@JsonAlias`: annotation untuk menerima nama alternatif saat deserialization; serialization tetap memakai nama utama.
- Jackson `@JsonProperty`: annotation untuk mendefinisikan logical property name JSON.
- Jackson `DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES`: fitur untuk menentukan apakah unknown property saat deserialization menyebabkan failure.
- Jackson 3 Migration Guide: rujukan resmi untuk perubahan besar Jackson 2 ke Jackson 3.
- Jackson 3 release notes: Jackson 3.0 adalah major version sehingga harus diperlakukan sebagai upgrade yang berpotensi memengaruhi contract runtime.

---

## 52. Koneksi ke Part Berikutnya

Part ini membahas contract evolution pada level enterprise.

Part berikutnya akan masuk ke sisi security:

```text
Part 13 — Jackson Security: Over-Posting, Polymorphic Attacks, Data Exposure
```

Di sana kita akan membahas bagaimana deserialization/serialization bisa menjadi attack surface: mass assignment, unsafe polymorphic typing, sensitive field leakage, payload limits, exception leakage, dan desain DTO deny-by-default.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 11 — Jackson Custom Serializer/Deserializer Deep Dive](./11-jackson-custom-serializer-deserializer-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 13 — Jackson Security: Over-Posting, Polymorphic Attacks, Data Exposure](./13-jackson-security-overposting-polymorphic-attacks-data-exposure.md)
