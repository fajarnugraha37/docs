# Part 2 — Transformation Taxonomy: Copy, Convert, Normalize, Enrich, Redact, Project

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `02-transformation-taxonomy-copy-convert-normalize-enrich-redact-project.md`  
> Status: Part 2 dari 35  
> Target: Java 8 sampai Java 25  

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membangun fondasi tentang bentuk object Java: JavaBean, POJO, record, immutable DTO, collection, enum, nested graph, dan object identity. Bagian ini melangkah ke pertanyaan yang lebih penting:

> Saat satu object diubah menjadi object lain, sebenarnya transformasi apa yang sedang terjadi?

Banyak engineer melihat mapper sebagai pekerjaan sederhana:

```java
response.setName(entity.getName());
response.setEmail(entity.getEmail());
```

Padahal dalam sistem nyata, mapping hampir tidak pernah hanya menyalin field. Mapping bisa berarti:

- menyalin struktur,
- mengubah tipe,
- mengubah makna,
- membersihkan input,
- menambahkan data dari sumber lain,
- menyembunyikan data sensitif,
- memilih subset data,
- menggabungkan beberapa object,
- membuat view khusus untuk user tertentu,
- mempertahankan kompatibilitas payload lama,
- atau menerjemahkan bahasa satu bounded context ke bounded context lain.

Jika semua jenis transformasi ini diperlakukan sebagai hal yang sama, mapper akan menjadi tempat paling rawan untuk bug yang sulit terdeteksi. Bug mapping sering tidak meledak dengan exception. Ia lebih sering menghasilkan data yang “terlihat valid”, tetapi semantiknya salah.

Contoh:

```java
customerDto.setStatus(customerEntity.getStatus().name());
```

Kode ini terlihat benar. Tetapi apakah status internal `SUSPENDED` memang boleh dikirim ke external API? Apakah konsumen API memahami nilai itu? Apakah status internal perlu diterjemahkan menjadi `INACTIVE`? Apakah user tertentu boleh melihat status ini? Apakah status historis dan status operasional adalah hal yang sama?

Bagian ini membangun taksonomi transformasi supaya kita bisa mendesain mapper dengan presisi.

---

## 1. Core Mental Model: Mapping Is Not One Operation

Mapping bukan satu jenis operasi. Mapping adalah payung besar untuk beberapa aktivitas berbeda.

Secara sederhana:

```text
Source Object
    |
    | transformation pipeline
    v
Target Object
```

Tetapi secara nyata:

```text
Source Object
    |
    | 1. select data
    | 2. interpret meaning
    | 3. convert type
    | 4. normalize representation
    | 5. apply policy
    | 6. enrich with additional context
    | 7. redact sensitive data
    | 8. shape for target contract
    v
Target Object
```

Tidak semua mapping melakukan semua langkah. Tetapi engineer senior harus bisa mengenali langkah mana yang sedang terjadi.

Prinsip penting:

> Semakin banyak jenis transformasi dalam satu mapper, semakin tinggi risiko mapper berubah menjadi service layer tersembunyi.

Mapper yang sehat biasanya memiliki batas tanggung jawab yang jelas. Ia boleh melakukan transformasi, tetapi tidak boleh diam-diam menjadi tempat aturan bisnis besar, authorization, workflow transition, database query acak, atau keputusan domain yang tidak terlihat.

---

## 2. Taksonomi Utama Transformasi

Dalam seri ini kita akan memakai beberapa kategori utama:

1. Copy
2. Rename / reshape
3. Type conversion
4. Semantic conversion
5. Normalization
6. Defaulting
7. Enrichment
8. Redaction / masking
9. Projection
10. Aggregation
11. Splitting / decomposition
12. Composition
13. Filtering
14. Localization / presentation formatting
15. Version adaptation
16. Anti-corruption translation
17. Validation-adjacent transformation
18. Audit/event transformation

Masing-masing punya karakteristik, risiko, dan tempat desain yang berbeda.

---

# 3. Copy Transformation

## 3.1 Apa Itu Copy?

Copy adalah transformasi paling sederhana: memindahkan nilai dari source ke target tanpa mengubah tipe, struktur, atau makna.

Contoh:

```java
public CustomerResponse toResponse(Customer entity) {
    CustomerResponse response = new CustomerResponse();
    response.setId(entity.getId());
    response.setName(entity.getName());
    response.setEmail(entity.getEmail());
    return response;
}
```

Di sini:

```text
Customer.id     -> CustomerResponse.id
Customer.name   -> CustomerResponse.name
Customer.email  -> CustomerResponse.email
```

Jika benar-benar hanya copy, maka pertanyaannya sederhana:

- apakah field source dan target punya arti yang sama?
- apakah tipe datanya sama?
- apakah nullability-nya sama?
- apakah exposure-nya aman?

## 3.2 Copy yang Terlihat Aman tetapi Berbahaya

Contoh buruk:

```java
response.setCreatedBy(entity.getCreatedBy());
response.setUpdatedBy(entity.getUpdatedBy());
response.setInternalRemark(entity.getInternalRemark());
```

Secara teknis ini copy. Tetapi secara boundary ini mungkin data leakage.

Copy aman hanya jika:

```text
source meaning == target meaning
source visibility <= target allowed visibility
source lifecycle compatible with target contract
source nullability compatible with target nullability
```

Jika salah satu tidak terpenuhi, itu bukan copy biasa.

## 3.3 Copy vs Aliasing

Untuk field immutable seperti `String`, `Integer`, `LocalDate`, copy reference biasanya aman.

Tetapi untuk collection atau mutable object:

```java
response.setTags(entity.getTags());
```

Ini bukan copy yang aman. Ini reference aliasing.

Masalah:

```text
response.tags dan entity.tags menunjuk object list yang sama
```

Jika target berubah:

```java
response.getTags().clear();
```

maka source bisa ikut berubah.

Lebih aman:

```java
response.setTags(entity.getTags() == null
        ? List.of()
        : new ArrayList<>(entity.getTags()));
```

Untuk Java 8:

```java
response.setTags(entity.getTags() == null
        ? Collections.emptyList()
        : new ArrayList<>(entity.getTags()));
```

Mental model:

> Copy primitive/value-like data berbeda dengan copy mutable object graph.

## 3.4 Kapan Copy Boleh Otomatis?

Copy relatif aman untuk otomatisasi dengan MapStruct jika:

- nama field sama,
- tipe sama,
- makna sama,
- tidak ada policy khusus,
- tidak ada security concern,
- tidak ada lifecycle mismatch.

Contoh MapStruct yang cocok:

```java
@Mapper(componentModel = "spring")
public interface CustomerMapper {
    CustomerResponse toResponse(Customer entity);
}
```

Tetapi untuk boundary public API, tetap harus berhati-hati dengan implicit mapping. Konfigurasi seperti `unmappedTargetPolicy = ReportingPolicy.ERROR` akan lebih aman karena perubahan target DTO tidak diam-diam lupa dimap.

---

# 4. Rename / Reshape Transformation

## 4.1 Apa Itu Rename?

Rename adalah ketika field yang sama secara makna punya nama berbeda di source dan target.

Contoh:

```text
entity.fullName -> response.name
entity.mobileNo -> response.phoneNumber
```

Manual:

```java
response.setName(entity.getFullName());
response.setPhoneNumber(entity.getMobileNo());
```

MapStruct:

```java
@Mapper
public interface CustomerMapper {

    @Mapping(source = "fullName", target = "name")
    @Mapping(source = "mobileNo", target = "phoneNumber")
    CustomerResponse toResponse(Customer entity);
}
```

## 4.2 Rename Bukan Sekadar Nama

Rename harus membuat kita bertanya:

- apakah `mobileNo` dan `phoneNumber` benar-benar sama?
- apakah `phoneNumber` bisa mencakup landline?
- apakah `mobileNo` sudah termasuk country code?
- apakah target mengharapkan format E.164?

Jika jawabannya tidak jelas, rename mungkin sebenarnya semantic conversion atau normalization.

## 4.3 Reshape: Flattening

Flattening adalah mengubah nested object menjadi flat DTO.

Source:

```java
class Customer {
    private Long id;
    private PersonName name;
    private Address address;
}

class PersonName {
    private String firstName;
    private String lastName;
}

class Address {
    private String postalCode;
    private String street;
}
```

Target:

```java
class CustomerSummaryResponse {
    private Long id;
    private String firstName;
    private String lastName;
    private String postalCode;
}
```

Mapping:

```java
response.setFirstName(entity.getName().getFirstName());
response.setLastName(entity.getName().getLastName());
response.setPostalCode(entity.getAddress().getPostalCode());
```

MapStruct:

```java
@Mapper
public interface CustomerMapper {

    @Mapping(source = "name.firstName", target = "firstName")
    @Mapping(source = "name.lastName", target = "lastName")
    @Mapping(source = "address.postalCode", target = "postalCode")
    CustomerSummaryResponse toSummary(Customer entity);
}
```

## 4.4 Reshape: Unflattening

Unflattening adalah kebalikannya.

Input:

```java
class CreateCustomerRequest {
    private String firstName;
    private String lastName;
    private String postalCode;
    private String street;
}
```

Target command:

```java
class CreateCustomerCommand {
    private PersonName name;
    private Address address;
}
```

Mapping:

```java
PersonName name = new PersonName(request.getFirstName(), request.getLastName());
Address address = new Address(request.getPostalCode(), request.getStreet());
return new CreateCustomerCommand(name, address);
```

Unflattening punya risiko lebih besar karena target object sering punya invariant.

Contoh:

```java
new PersonName(firstName, lastName)
```

Mungkin constructor `PersonName` menolak name kosong. Jadi mapping bisa gagal karena invariant domain.

Mental model:

> Flattening biasanya kehilangan struktur. Unflattening mencoba membangun kembali struktur dan sering harus menghadapi invariant.

---

# 5. Type Conversion

## 5.1 Apa Itu Type Conversion?

Type conversion adalah perubahan tipe tanpa mengubah makna utama.

Contoh:

```text
String       -> UUID
String       -> LocalDate
Integer      -> Long
BigDecimal   -> String
Enum         -> String
Timestamp    -> Instant
```

Contoh:

```java
UUID id = UUID.fromString(request.getId());
```

Secara makna, id tetap id. Tetapi representasi berubah dari string menjadi UUID.

## 5.2 Conversion Harus Memiliki Failure Model

Setiap conversion bisa gagal.

Contoh:

```java
LocalDate birthDate = LocalDate.parse(request.getBirthDate());
```

Pertanyaan:

- format tanggal apa yang diterima?
- timezone relevan atau tidak?
- error message ke user bagaimana?
- apakah parse error masuk kategori validation error atau bad request?
- apakah input mentah perlu disimpan untuk audit?

Conversion tanpa failure model menghasilkan error tidak ramah seperti:

```text
java.time.format.DateTimeParseException
```

Engineer senior mendesain conversion dengan kontrak eksplisit.

## 5.3 String to Enum

Contoh sederhana:

```java
CustomerType type = CustomerType.valueOf(request.getType());
```

Masalah:

- case-sensitive,
- error message buruk,
- unknown value gagal keras,
- value enum internal mungkin berbeda dari external value.

Lebih baik:

```java
public enum CustomerType {
    INDIVIDUAL("individual"),
    COMPANY("company");

    private final String wireValue;

    CustomerType(String wireValue) {
        this.wireValue = wireValue;
    }

    public static CustomerType fromWireValue(String value) {
        for (CustomerType type : values()) {
            if (type.wireValue.equalsIgnoreCase(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unsupported customer type: " + value);
    }
}
```

Tetapi hati-hati: `IllegalArgumentException` mungkin tidak cocok langsung dilempar ke controller. Biasanya perlu dibungkus menjadi mapping/validation error yang punya field path.

## 5.4 Date/Time Conversion

Date/time adalah salah satu sumber bug mapping paling sering.

Contoh buruk:

```java
LocalDateTime createdAt = LocalDateTime.parse(request.getCreatedAt());
```

Pertanyaan:

- apakah input punya timezone?
- apakah target harus `Instant`, `OffsetDateTime`, atau `LocalDateTime`?
- apakah ini waktu mesin, waktu user, atau tanggal bisnis?
- apakah daylight saving relevan?
- apakah database menyimpan UTC?

Rule of thumb:

```text
Machine timestamp       -> Instant
User-local date time    -> ZonedDateTime / OffsetDateTime + zone context
Business date only      -> LocalDate
Local wall-clock time   -> LocalTime / LocalDateTime with explicit context
```

Contoh:

```java
Instant submittedAt = OffsetDateTime.parse(request.getSubmittedAt()).toInstant();
```

Jika input hanya tanggal:

```java
LocalDate effectiveDate = LocalDate.parse(request.getEffectiveDate());
```

Jangan mengubah `LocalDate` menjadi `Instant` tanpa business rule yang jelas. Tanggal bisnis bukan timestamp.

## 5.5 Numeric Conversion

Contoh:

```java
int pageSize = Integer.parseInt(request.getPageSize());
```

Risiko:

- overflow,
- negative value,
- leading zero,
- decimal string,
- locale format,
- empty string,
- null,
- unit ambiguity.

Money harus sangat hati-hati:

```java
BigDecimal amount = new BigDecimal(request.getAmount());
```

Pertanyaan:

- scale berapa?
- rounding mode?
- currency dari mana?
- apakah `10.0` dan `10.00` harus dianggap sama?
- apakah input boleh exponential notation?

Money bukan sekadar `BigDecimal`. Dalam model yang lebih kuat:

```java
record Money(BigDecimal amount, Currency currency) {}
```

Untuk Java 8:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        this.amount = amount;
        this.currency = currency;
    }
}
```

---

# 6. Semantic Conversion

## 6.1 Apa Itu Semantic Conversion?

Semantic conversion adalah transformasi yang bukan hanya mengubah tipe, tetapi juga mengubah makna ke bahasa target.

Contoh:

```text
Internal status: PENDING_REVIEW
External status: IN_PROGRESS
```

Atau:

```text
Domain field: suspended = true
API field: accountStatus = "inactive"
```

Ini bukan copy. Ini bukan sekadar enum-to-string. Ini translation antar konsep.

## 6.2 Contoh Status Mapping

Domain:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    PENDING_OFFICER_REVIEW,
    PENDING_MANAGER_APPROVAL,
    APPROVED,
    REJECTED,
    WITHDRAWN
}
```

External API:

```java
enum CaseDisplayStatus {
    DRAFT,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED
}
```

Mapping:

```java
public CaseDisplayStatus toDisplayStatus(CaseStatus status) {
    switch (status) {
        case DRAFT:
            return CaseDisplayStatus.DRAFT;
        case SUBMITTED:
        case PENDING_OFFICER_REVIEW:
        case PENDING_MANAGER_APPROVAL:
            return CaseDisplayStatus.IN_PROGRESS;
        case APPROVED:
        case REJECTED:
            return CaseDisplayStatus.COMPLETED;
        case WITHDRAWN:
            return CaseDisplayStatus.CANCELLED;
        default:
            throw new IllegalStateException("Unhandled case status: " + status);
    }
}
```

Ini mapping dengan policy.

## 6.3 Risiko Semantic Conversion

Semantic conversion berisiko karena:

- bisa kehilangan informasi,
- bisa menyembunyikan state internal,
- bisa membuat external consumer salah memahami proses,
- bisa menimbulkan bug saat status baru ditambahkan,
- sering terkait authorization/presentation/business policy.

Contoh status baru:

```java
PENDING_LEGAL_REVIEW
```

Jika mapper tidak diupdate, external status bisa salah.

Maka semantic conversion harus:

- eksplisit,
- tested,
- fail-fast saat source enum berkembang,
- terdokumentasi,
- dimiliki oleh boundary yang benar.

## 6.4 Semantic Conversion Tidak Boleh Tersembunyi

Buruk:

```java
response.setStatus(entity.getStatus().name().replace("PENDING_", "IN_PROGRESS"));
```

Ini fragile dan tidak jelas.

Lebih baik:

```java
response.setStatus(CaseStatusTranslator.toExternal(entity.getStatus()));
```

Dengan class yang niatnya jelas:

```java
final class CaseStatusTranslator {
    private CaseStatusTranslator() {}

    static ExternalCaseStatus toExternal(CaseStatus status) {
        // explicit switch
    }
}
```

Mental model:

> Jika mapping mengubah bahasa satu model menjadi bahasa model lain, namai sebagai translator, bukan sekadar mapper.

---

# 7. Normalization

## 7.1 Apa Itu Normalization?

Normalization adalah membuat representasi data menjadi bentuk canonical/standar tanpa mengubah makna bisnis.

Contoh:

```text
" fajar@example.com " -> "fajar@example.com"
"SG-123456"           -> "123456"
"john DOE"            -> "John Doe" mungkin presentation normalization
"+65 9123 4567"       -> "+6591234567"
```

Normalization menjawab:

> Dari banyak bentuk input yang mungkin, bentuk internal standar apa yang akan kita simpan/proses?

## 7.2 Normalization vs Validation

Normalization dan validation berbeda.

Normalization:

```text
" ABC " -> "ABC"
```

Validation:

```text
"ABC" valid atau tidak?
```

Urutan bisa berbeda tergantung konteks.

Contoh email:

```text
Input: " Fajar@Example.COM "
Normalize: trim + lowercase domain maybe
Validate: valid email format
```

Tetapi tidak semua bagian email aman di-lowercase secara sembarangan, karena local-part secara standar bisa case-sensitive walaupun praktik umum sering case-insensitive. Jadi normalization harus berdasarkan contract, bukan asumsi.

## 7.3 Normalization sebagai Boundary Decision

Normalization biasanya terjadi saat data masuk boundary:

```text
External input -> normalize -> validate -> command/domain
```

Contoh:

```java
public CreateCustomerCommand toCommand(CreateCustomerRequest request) {
    String email = normalizeEmail(request.getEmail());
    String postalCode = normalizePostalCode(request.getPostalCode());
    return new CreateCustomerCommand(email, postalCode);
}
```

Tetapi jika normalization penting untuk audit, raw input mungkin tetap disimpan.

Contoh regulatory/case management:

```text
rawSubmittedPostalCode = " 079903 "
normalizedPostalCode  = "079903"
```

Raw input berguna untuk:

- audit,
- dispute,
- forensic debugging,
- replay,
- evidence preservation.

## 7.4 Normalization Harus Idempotent

Normalization idealnya idempotent:

```text
normalize(normalize(x)) == normalize(x)
```

Contoh:

```java
String normalizePostalCode(String value) {
    if (value == null) return null;
    return value.trim().replaceAll("\\s+", "");
}
```

Jika dipanggil dua kali, hasil tetap sama.

Non-idempotent normalization berbahaya:

```java
String addPrefix(String id) {
    return "CASE-" + id;
}
```

Jika dipanggil dua kali:

```text
CASE-CASE-123
```

Ini bukan normalization yang baik. Itu transformation yang harus dikontrol.

## 7.5 Normalization Boleh Menghilangkan Informasi?

Kadang iya, tetapi harus sadar.

Contoh:

```text
"  ABC  " -> "ABC"
```

Whitespace hilang.

Untuk field biasa, aman. Untuk field legal statement, mungkin tidak aman.

Contoh:

```text
User statement: "I did not sign.   Please check."
```

Menghapus whitespace ganda mungkin mengubah bukti tekstual.

Prinsip:

> Jangan normalize field evidentiary/legal/audit-sensitive tanpa policy eksplisit.

---

# 8. Defaulting

## 8.1 Apa Itu Defaulting?

Defaulting adalah memberi nilai ketika source tidak menyediakan nilai.

Contoh:

```java
String language = request.getLanguage() == null ? "en" : request.getLanguage();
```

Defaulting tampak sederhana, tetapi sering berbahaya.

## 8.2 Defaulting Menjawab Pertanyaan Semantik

Jika field tidak ada, apakah artinya:

1. user tidak tahu,
2. user tidak mengisi,
3. client lama belum mendukung field itu,
4. field sengaja dikosongkan,
5. nilai default business rule berlaku,
6. server harus menolak request?

Contoh:

```json
{
  "receiveNewsletter": false
}
```

Berbeda dengan:

```json
{}
```

Jika default `receiveNewsletter = true`, maka request kosong bisa membuat user ikut newsletter tanpa explicit consent. Ini bisa menjadi compliance issue.

## 8.3 Defaulting vs Null vs Absent

Dalam Java object biasa, setelah deserialization sering sulit membedakan:

```json
{}
```

Dan:

```json
{"name": null}
```

Keduanya bisa menjadi:

```java
request.getName() == null
```

Padahal semantik PATCH sangat berbeda:

```text
absent -> jangan ubah
null   -> kosongkan nilai
```

Karena itu untuk PATCH, sering perlu model khusus:

```java
class PatchCustomerRequest {
    private JsonNullable<String> name;
}
```

Atau pendekatan custom wrapper:

```java
final class FieldUpdate<T> {
    private final boolean present;
    private final T value;
}
```

## 8.4 Defaulting di Mapper Harus Terlihat

Buruk:

```java
entity.setStatus(request.getStatus() == null ? Status.ACTIVE : request.getStatus());
```

Ini menyembunyikan business policy di mapper.

Lebih baik:

```java
Status initialStatus = statusPolicy.resolveInitialStatus(request.getStatus());
entity.setStatus(initialStatus);
```

Atau jika default murni contract-level:

```java
CreateCustomerCommand command = new CreateCustomerCommand(
        request.getName(),
        request.getLanguage() == null ? Language.EN : request.getLanguage()
);
```

Bedakan:

```text
technical default    -> boleh di mapper/boundary
business default     -> policy/domain/application service
security default     -> explicit policy, jangan tersembunyi
```

---

# 9. Enrichment

## 9.1 Apa Itu Enrichment?

Enrichment adalah menambahkan informasi yang tidak ada langsung di source object.

Contoh:

```text
Customer entity + reference data -> CustomerResponse with countryName
Case entity + current user       -> CaseResponse with canApprove
Order entity + exchange rate     -> OrderResponse with convertedAmount
```

Enrichment membuat mapper lebih kompleks karena mapper mulai membutuhkan konteks eksternal.

## 9.2 Contoh Enrichment

Entity:

```java
class Customer {
    private String countryCode;
}
```

Response:

```java
class CustomerResponse {
    private String countryCode;
    private String countryName;
}
```

Mapping:

```java
response.setCountryCode(entity.getCountryCode());
response.setCountryName(countryDirectory.nameOf(entity.getCountryCode()));
```

Ini bukan pure mapping. Ini lookup.

## 9.3 Enrichment Risiko N+1

Misalnya mapping list 1000 customer:

```java
for (Customer customer : customers) {
    response.setCountryName(countryService.getName(customer.getCountryCode()));
}
```

Jika `countryService.getName()` melakukan database/API call, ini menjadi N+1.

Solusi:

```text
1. collect country codes
2. bulk fetch reference data
3. map with context map
```

Contoh:

```java
Set<String> countryCodes = customers.stream()
        .map(Customer::getCountryCode)
        .collect(Collectors.toSet());

Map<String, String> countryNames = countryDirectory.namesOf(countryCodes);

List<CustomerResponse> responses = customers.stream()
        .map(customer -> mapper.toResponse(customer, countryNames))
        .collect(Collectors.toList());
```

Mapper:

```java
CustomerResponse toResponse(Customer customer, Map<String, String> countryNames) {
    CustomerResponse response = new CustomerResponse();
    response.setCountryCode(customer.getCountryCode());
    response.setCountryName(countryNames.get(customer.getCountryCode()));
    return response;
}
```

## 9.4 Enrichment dengan Current User

Contoh:

```java
response.setCanApprove(authorizationService.canApprove(currentUser, caseEntity));
```

Ini berbahaya jika ditaruh sembarangan di mapper.

Pertanyaan:

- apakah `canApprove` presentation helper atau authorization decision?
- apakah hasilnya harus konsisten dengan endpoint approval sebenarnya?
- apakah authorization policy sama digunakan di action endpoint?
- apakah ada risiko UI menampilkan tombol yang salah?

Jika enrichment berupa permission flag, sumber kebenarannya tetap policy service, bukan mapper.

Mapper boleh menerima hasil policy yang sudah dihitung:

```java
CasePermissionView permissionView = permissionService.evaluate(currentUser, caseEntity);
CaseResponse response = mapper.toResponse(caseEntity, permissionView);
```

Dengan begitu mapper tidak mengambil keputusan authorization sendiri.

## 9.5 Rule of Thumb Enrichment

Enrichment boleh di mapper jika:

- data enrichment sudah tersedia sebagai context,
- tidak melakukan remote/database call per item,
- tidak mengandung business decision besar,
- deterministic,
- mudah diuji,
- failure behavior jelas.

Enrichment sebaiknya di application/service layer jika:

- butuh query/database/API,
- butuh authorization decision,
- butuh workflow state evaluation,
- butuh cache/retry/fallback,
- failure-nya berdampak ke bisnis.

---

# 10. Redaction and Masking

## 10.1 Apa Itu Redaction?

Redaction adalah menghapus atau menyembunyikan data yang tidak boleh keluar dari boundary.

Masking adalah menyamarkan sebagian data.

Contoh:

```text
NRIC: S1234567D -> S****567D
Email: fajar@example.com -> f***r@example.com
Phone: +6591234567 -> ****4567
```

Redaction:

```json
{
  "name": "Fajar"
}
```

Masking:

```json
{
  "name": "Fajar",
  "nric": "S****567D"
}
```

## 10.2 Redaction adalah Security Boundary

Jangan anggap redaction sebagai cosmetic formatter. Redaction adalah security/privacy control.

Buruk:

```java
response.setNric(entity.getNric());
```

Lebih baik:

```java
response.setMaskedNric(maskingPolicy.maskNric(entity.getNric(), viewerRole));
```

Tetapi lebih aman lagi: desain DTO yang tidak memiliki field sensitif jika tidak dibutuhkan.

```java
class CustomerPublicResponse {
    private String name;
    private String maskedNric;
}
```

Jangan gunakan DTO internal yang sama lalu berharap `@JsonIgnore` menyelamatkan semua konteks.

## 10.3 Redaction vs Authorization

Redaction menjawab:

```text
Data apa yang boleh terlihat?
```

Authorization menjawab:

```text
User boleh melakukan aksi apa atau melihat resource apa?
```

Keduanya terkait, tetapi tidak sama.

Contoh:

- user boleh melihat case,
- tetapi tidak boleh melihat full identity number,
- manager boleh melihat lebih banyak field,
- audit officer boleh melihat raw data,
- external applicant hanya melihat masked data.

Mapper bisa menerapkan redaction policy jika policy sudah jelas.

Contoh:

```java
CustomerResponse toResponse(Customer customer, ViewerContext viewer) {
    CustomerResponse response = new CustomerResponse();
    response.setName(customer.getName());
    response.setNric(maskingPolicy.mask(customer.getNric(), viewer));
    return response;
}
```

Namun jika policy kompleks, mapper sebaiknya hanya menerima `DataVisibility` atau `FieldPermission` yang sudah dihitung.

## 10.4 Jangan Log Payload Setelah Redaction Salah Tempat

Masalah umum:

```text
1. deserialize request
2. log request object
3. map to safe DTO
4. return response
```

Jika logging dilakukan sebelum redaction, data sensitif sudah bocor.

Mapping layer harus dipikirkan bersama:

- logging,
- audit,
- tracing,
- exception handling,
- serialization.

## 10.5 Redaction Harus Tested

Test penting:

```java
@Test
void publicResponseShouldNotContainFullNric() {
    Customer customer = new Customer("Fajar", "S1234567D");

    CustomerPublicResponse response = mapper.toPublicResponse(customer);

    assertThat(response.getMaskedNric()).isEqualTo("S****567D");
}
```

Tetapi test field absence juga penting:

```java
String json = objectMapper.writeValueAsString(response);
assertThat(json).doesNotContain("S1234567D");
```

Karena getter lain, Lombok `@Data`, atau accidental field exposure bisa bocor lewat serialization.

---

# 11. Projection

## 11.1 Apa Itu Projection?

Projection adalah memilih sebagian data dari source untuk target tertentu.

Contoh:

```text
Customer entity -> CustomerListItemResponse
Customer entity -> CustomerDetailResponse
Customer entity -> CustomerExportRow
Customer entity -> CustomerAuditView
```

Satu source bisa punya banyak projection.

## 11.2 Projection Berdasarkan Use Case

Contoh:

```java
class CustomerListItemResponse {
    private Long id;
    private String name;
    private String status;
}

class CustomerDetailResponse {
    private Long id;
    private String name;
    private String email;
    private String address;
    private String status;
    private List<ContactPersonResponse> contactPersons;
}
```

List endpoint tidak harus mengembalikan semua detail.

Projection membantu:

- performance,
- security,
- clarity,
- API stability,
- frontend simplicity.

## 11.3 Projection vs Entity Exposure

Buruk:

```java
@GetMapping("/customers/{id}")
public Customer getCustomer(@PathVariable Long id) {
    return customerRepository.findById(id).orElseThrow();
}
```

Ini membuat entity menjadi API contract. Akibat:

- field internal bocor,
- lazy relation bisa terserialize,
- perubahan DB model menjadi breaking API change,
- bidirectional relationship bisa infinite recursion,
- sensitive fields raw bisa keluar.

Projection DTO memutus coupling.

## 11.4 Projection Bisa Dilakukan di Database atau Mapper

Ada dua level projection:

```text
Database projection -> hanya ambil kolom yang dibutuhkan
Object projection   -> ambil entity lalu pilih field di mapper
```

Untuk list besar, database projection lebih efisien.

Contoh JPA projection:

```java
public interface CustomerListProjection {
    Long getId();
    String getName();
    String getStatus();
}
```

Atau constructor expression:

```java
select new com.example.CustomerListItemDto(c.id, c.name, c.status)
from Customer c
```

Tetapi projection database terlalu dekat ke API bisa membuat repository tahu bentuk API. Perlu desain package/layer yang hati-hati.

## 11.5 Projection dan Access Pattern

Pertanyaan desain:

- apakah target untuk list, detail, export, audit, atau integration?
- apakah field mahal dihitung?
- apakah relation perlu fetch?
- apakah field sensitif perlu masking?
- apakah consumer butuh stability jangka panjang?

Projection bukan hanya “field mana yang ditampilkan”, tapi bentuk akses data.

---

# 12. Aggregation

## 12.1 Apa Itu Aggregation?

Aggregation adalah menggabungkan beberapa source menjadi satu target.

Contoh:

```text
Customer + Account + RiskProfile -> CustomerOverviewResponse
Case + TaskSummary + SLAInfo     -> CaseDashboardItem
Order + Payment + Shipment       -> OrderDetailResponse
```

## 12.2 Contoh Aggregation

```java
class CustomerOverviewResponse {
    private Long customerId;
    private String name;
    private String accountStatus;
    private String riskLevel;
}
```

Mapping:

```java
CustomerOverviewResponse response = new CustomerOverviewResponse();
response.setCustomerId(customer.getId());
response.setName(customer.getName());
response.setAccountStatus(account.getStatus().name());
response.setRiskLevel(riskProfile.getLevel().name());
```

## 12.3 Aggregation Bukan Tugas Mapper Murni

Mapper boleh menggabungkan object yang sudah tersedia. Tetapi mapper sebaiknya tidak mengambil semua datanya sendiri.

Buruk:

```java
CustomerOverviewResponse toOverview(Customer customer) {
    Account account = accountRepository.findByCustomerId(customer.getId());
    RiskProfile risk = riskClient.getRisk(customer.getId());
    // map
}
```

Ini membuat mapper:

- tergantung repository/client,
- punya IO,
- sulit diuji,
- punya retry/failure concern,
- bisa memicu N+1,
- melanggar separation of concerns.

Lebih baik:

```java
Customer customer = customerRepository.get(id);
Account account = accountRepository.getByCustomer(id);
RiskProfile risk = riskService.getProfile(id);

return mapper.toOverview(customer, account, risk);
```

Atau untuk list:

```text
application service orchestrates bulk fetch
mapper performs deterministic assembly
```

## 12.4 Aggregation dan Consistency

Jika aggregation mengambil data dari beberapa sumber, consistency menjadi isu.

Contoh:

```text
Customer dari DB utama pada waktu T1
RiskProfile dari service lain pada waktu T2
Account status dari cache pada waktu T3
```

Response adalah snapshot campuran.

Pertanyaan:

- apakah ini acceptable untuk UI dashboard?
- apakah acceptable untuk decision/legal action?
- apakah perlu timestamp per source?
- apakah perlu eventual consistency notice?
- apakah perlu transaction boundary?

Mapper tidak menyelesaikan consistency. Tetapi bentuk response harus mencerminkan realitas consistency.

Contoh:

```java
class CustomerOverviewResponse {
    private CustomerSummary customer;
    private AccountSummary account;
    private RiskSummary risk;
    private Instant generatedAt;
    private Instant riskEvaluatedAt;
}
```

---

# 13. Splitting / Decomposition

## 13.1 Apa Itu Splitting?

Splitting adalah satu source dipecah menjadi beberapa target.

Contoh:

```text
CreateCustomerRequest -> CreateCustomerCommand + CreateAddressCommand + CreateContactCommand
```

Atau:

```text
SubmittedApplication -> ApplicationEntity + AuditEvent + NotificationPayload
```

## 13.2 Contoh Splitting

Request:

```java
class SubmitApplicationRequest {
    private String applicantName;
    private String applicantEmail;
    private String postalCode;
    private List<DocumentRequest> documents;
}
```

Targets:

```java
class SubmitApplicationCommand {
    private ApplicantInfo applicant;
    private AddressInfo address;
    private List<DocumentCommand> documents;
}

class AuditEventPayload {
    private String actor;
    private String action;
    private String applicantEmailMasked;
}
```

Satu request menghasilkan beberapa representasi untuk tujuan berbeda.

## 13.3 Splitting Harus Jelas Ownership-nya

Jika satu input menghasilkan:

- domain command,
- audit event,
- notification message,
- search index document,

maka jangan semua ditaruh dalam satu mega-mapper.

Lebih baik:

```text
SubmitApplicationRequestMapper -> command
ApplicationAuditEventMapper    -> audit event
ApplicationNotificationMapper  -> notification payload
ApplicationSearchMapper        -> search document
```

Setiap target punya contract sendiri.

---

# 14. Composition

## 14.1 Apa Itu Composition?

Composition adalah membentuk object target dari beberapa bagian kecil yang sudah dimap.

Contoh:

```java
CustomerDetailResponse response = new CustomerDetailResponse(
        customerMapper.toSummary(customer),
        addressMapper.toResponse(customer.getAddress()),
        contactMapper.toResponses(customer.getContacts())
);
```

Composition menjaga mapper kecil tetap reusable.

## 14.2 Composition vs Generic Shared Mapper

Reusability harus hati-hati.

Buruk:

```java
CommonMapper.mapAddress(...)
CommonMapper.mapStatus(...)
CommonMapper.mapEverything(...)
```

Common mapper sering berubah menjadi tempat sampah logic. Lebih baik mapper spesifik boundary:

```text
CustomerAddressResponseMapper
ApplicationAddressMapper
ExternalPartnerAddressMapper
```

Alamat yang sama bisa punya makna berbeda di konteks berbeda.

Contoh:

```text
residentialAddress
mailingAddress
registeredBusinessAddress
inspectionSiteAddress
```

Jangan otomatis menganggap semua `Address` sama.

---

# 15. Filtering

## 15.1 Apa Itu Filtering?

Filtering adalah memilih item dalam collection berdasarkan rule.

Contoh:

```java
List<DocumentResponse> visibleDocuments = documents.stream()
        .filter(document -> document.isVisibleToApplicant())
        .map(documentMapper::toResponse)
        .collect(Collectors.toList());
```

Filtering bisa termasuk:

- filter soft-deleted item,
- filter berdasarkan role,
- filter berdasarkan status,
- filter berdasarkan effective date,
- filter berdasarkan tenant/agency,
- filter berdasarkan feature flag.

## 15.2 Filtering di Mapper Bisa Berbahaya

Jika mapper diam-diam filter:

```java
response.setDocuments(entity.getDocuments().stream()
        .filter(Document::isActive)
        .map(this::toDocumentResponse)
        .collect(Collectors.toList()));
```

Pertanyaan:

- apakah caller tahu inactive document hilang?
- apakah audit view juga harus filter?
- apakah legal officer perlu melihat inactive document?
- apakah count di UI menjadi mismatch?

Filtering sering lebih jelas jika dilakukan di query/application layer.

Tetapi filter presentation sederhana bisa dilakukan di mapper jika namanya jelas:

```java
toApplicantVisibleResponse(...)
```

Nama method harus menyatakan policy.

## 15.3 Filter vs Redaction

Filter menghilangkan item.

Redaction menghilangkan field atau sebagian nilai.

Contoh:

```text
filter: remove confidential document from list
redact: show document but hide confidential remark
```

Keduanya punya implikasi UX dan audit berbeda.

---

# 16. Localization and Presentation Formatting

## 16.1 Apa Itu Presentation Formatting?

Presentation formatting adalah mengubah data menjadi bentuk yang nyaman ditampilkan.

Contoh:

```text
2026-06-17 -> "17 Jun 2026"
BigDecimal 1000.5 -> "$1,000.50"
Status.PENDING_MANAGER_APPROVAL -> "Pending Manager Approval"
```

## 16.2 Haruskah Formatting Ada di Backend Mapper?

Jawabannya tergantung boundary.

Untuk API modern yang dikonsumsi frontend:

```json
{
  "submittedAt": "2026-06-17T10:15:30Z",
  "amount": 1000.50,
  "currency": "SGD",
  "status": "PENDING_MANAGER_APPROVAL"
}
```

Frontend bisa format sesuai locale user.

Tetapi untuk export/report/email, backend mungkin harus menghasilkan formatted string:

```java
class PaymentExportRow {
    private String submittedDate;
    private String amountDisplay;
}
```

## 16.3 Jangan Campur Machine Contract dengan Display Contract

Buruk:

```json
{
  "amount": "$1,000.50"
}
```

Jika consumer butuh menghitung amount, string ini menyulitkan.

Lebih baik:

```json
{
  "amount": 1000.50,
  "currency": "SGD",
  "amountDisplay": "$1,000.50"
}
```

Atau hanya kirim machine-readable value dan frontend format.

## 16.4 Localization Butuh Context

Untuk localization perlu:

- locale,
- timezone,
- currency,
- language,
- fallback rule,
- text catalog.

Mapper yang menerima `Locale` masih masuk akal untuk presentation DTO:

```java
CaseResponse toResponse(Case entity, Locale locale, ZoneId userZone);
```

Tetapi jangan gunakan default JVM timezone/locale diam-diam.

Buruk:

```java
DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).format(date);
```

Tanpa locale eksplisit, hasil bisa tergantung environment.

---

# 17. Version Adaptation

## 17.1 Apa Itu Version Adaptation?

Version adaptation adalah transformasi untuk menjaga kompatibilitas antar versi contract.

Contoh:

V1:

```json
{
  "name": "Fajar",
  "phone": "91234567"
}
```

V2:

```json
{
  "fullName": "Fajar",
  "contact": {
    "mobileNumber": "91234567"
  }
}
```

Mapper bisa menerjemahkan model internal ke V1 dan V2.

## 17.2 Jangan Biarkan Versioning Bocor ke Domain

Buruk:

```java
class Customer {
    private String name;
    private String fullNameForV2;
    private String phoneForV1;
}
```

Domain menjadi tercemar contract versi API.

Lebih baik:

```text
Customer domain -> CustomerV1Response
Customer domain -> CustomerV2Response
```

Dengan mapper berbeda:

```java
CustomerV1Response toV1(Customer customer);
CustomerV2Response toV2(Customer customer);
```

## 17.3 Version Adaptation dan Deprecated Field

Kadang field lama masih perlu dikirim:

```json
{
  "name": "Fajar",
  "fullName": "Fajar"
}
```

Ini bisa sementara untuk migrasi.

Mapper harus eksplisit:

```java
response.setName(customer.getFullName());      // deprecated legacy field
response.setFullName(customer.getFullName());  // new field
```

Tambahkan komentar atau dokumentasi contract.

## 17.4 Backward Compatibility Rule

Perubahan relatif aman:

- menambah optional field,
- menambah enum value jika consumer tolerant,
- memperluas string field,
- menambah object nested optional.

Perubahan berisiko/breaking:

- rename field,
- hapus field,
- ubah tipe field,
- ubah nullability,
- ubah format date,
- ubah enum value,
- ubah semantik field tanpa ubah nama.

Yang terakhir paling berbahaya:

```text
field sama, tipe sama, tetapi makna berubah
```

Ini sering tidak terdeteksi contract test sederhana.

---

# 18. Anti-Corruption Translation

## 18.1 Apa Itu Anti-Corruption Layer?

Anti-corruption layer adalah boundary yang mencegah model eksternal merusak model internal.

External system mungkin punya konsep, nama field, status, dan data shape yang tidak cocok dengan domain kita.

Contoh external payload:

```json
{
  "cust_no": "C123",
  "stat": "A",
  "addr1": "Street 1",
  "addr2": "Building 2",
  "zip": "079903"
}
```

Internal command:

```java
class UpsertCustomerCommand {
    private CustomerNumber customerNumber;
    private CustomerStatus status;
    private Address address;
}
```

Mapper ACL:

```java
UpsertCustomerCommand toCommand(ExternalCustomerPayload payload) {
    return new UpsertCustomerCommand(
            new CustomerNumber(payload.getCustNo()),
            externalStatusTranslator.toInternal(payload.getStat()),
            addressTranslator.toInternal(payload)
    );
}
```

## 18.2 ACL Mapper Lebih Dekat ke Translator

Untuk external integration, istilah “mapper” kadang terlalu lemah. Lebih tepat:

```text
ExternalCustomerTranslator
PartnerPayloadAdapter
LegacyCaseTranslator
```

Karena ia menerjemahkan bahasa eksternal ke internal.

## 18.3 Jangan Sebarkan External Model ke Seluruh Aplikasi

Buruk:

```java
service.process(payload.getCustNo(), payload.getStat(), payload.getAddr1());
```

Jika payload eksternal dipakai di banyak layer, sistem internal ikut tergantung pada external contract.

Lebih baik:

```text
external payload -> adapter/translator -> internal command -> application service
```

## 18.4 ACL Harus Tolerant tapi Tidak Ceroboh

External system sering mengirim data aneh:

- numeric sebagai string,
- date format tidak konsisten,
- enum code magic,
- optional field kosong sebagai `""`,
- null dan absent bercampur,
- address dalam field bebas,
- boolean sebagai `Y/N`.

ACL boleh tolerant dalam membaca, tetapi harus canonical dalam mengirim ke domain.

```text
Tolerant reader at boundary
Strict internal model after boundary
```

---

# 19. Validation-Adjacent Transformation

## 19.1 Mapping Bukan Validation, Tetapi Berdekatan

Saat data masuk, biasanya terjadi:

```text
parse -> bind -> normalize -> validate -> map -> execute
```

Tetapi kenyataannya sering bercampur:

```java
if (request.getEmail() == null) {
    throw new BadRequestException("email required");
}
command.setEmail(request.getEmail().trim().toLowerCase());
```

Ini mapping, normalization, dan validation dalam satu tempat.

Tidak selalu salah, tetapi harus sadar.

## 19.2 Validation Sebelum Mapping

Cocok jika target mapper mengharapkan source valid.

```text
request DTO -> bean validation -> mapper -> command
```

Keuntungan:

- mapper lebih sederhana,
- error field langsung sesuai request,
- invalid object tidak masuk pipeline.

Kelemahan:

- validation kadang butuh normalized value,
- Bean Validation tidak selalu cukup untuk semantic validation.

## 19.3 Normalization Sebelum Validation

Contoh:

```text
" fajar@example.com "
```

Jika validasi email dilakukan sebelum trim, input ditolak. Jika trim dulu, input diterima.

Pertanyaan desain:

- apakah sistem boleh memperbaiki input?
- apakah user harus mengirim format strict?
- apakah raw input perlu disimpan?

## 19.4 Validation Saat Mapping

Contoh value object:

```java
Email email = new Email(normalizeEmail(request.getEmail()));
```

Constructor `Email` mungkin melakukan validation. Mapping bisa gagal.

Ini bagus untuk invariant domain, tetapi error mapping harus diterjemahkan menjadi response yang jelas.

## 19.5 Anti-Pattern: Mapper Diam-Diam Menolak Karena Business Rule

Buruk:

```java
if (request.getAge() < 18) {
    throw new IllegalArgumentException("Applicant too young");
}
```

Jika minimum age adalah business rule, sebaiknya ada di domain/application policy, bukan mapper.

Mapper boleh memastikan tipe dan struktur valid. Keputusan eligibility lebih cocok di domain/service.

---

# 20. Audit/Event Transformation

## 20.1 Event Payload Bukan Entity Snapshot Sembarangan

Dalam sistem enterprise/regulatory, mapping ke event/audit payload sangat penting.

Contoh event:

```java
class CaseSubmittedEvent {
    private String caseId;
    private String submittedBy;
    private Instant submittedAt;
    private String submissionChannel;
}
```

Jangan sekadar serialize entity:

```java
objectMapper.writeValueAsString(caseEntity)
```

Risiko:

- lazy relation bocor,
- field internal bocor,
- payload tidak stabil,
- event berubah saat entity berubah,
- event terlalu besar,
- consumer tightly coupled ke DB model.

## 20.2 Event adalah Contract

Event payload harus diperlakukan seperti API contract.

Pertanyaan:

- event ini untuk siapa?
- apakah event immutable secara historis?
- apakah field boleh berubah?
- apakah perlu version?
- apakah ada PII?
- apakah consumer butuh raw atau masked data?
- apakah event harus cukup untuk replay?

## 20.3 Audit Mapping vs Business Event Mapping

Audit event:

```text
who did what, when, from where, before/after maybe
```

Business event:

```text
something meaningful happened in domain
```

Contoh:

```text
Audit: user clicked submit button
Business: application was submitted
```

Keduanya bisa muncul dari aksi yang sama, tetapi payload dan tujuannya berbeda.

## 20.4 Before/After Mapping

Untuk audit perubahan:

```java
class FieldChange {
    private String field;
    private String oldValue;
    private String newValue;
}
```

Mapping before/after harus hati-hati:

- sensitive fields harus masked,
- large CLOB jangan sembarang disimpan,
- order collection harus deterministic,
- field display name perlu stabil,
- null/empty harus jelas.

Contoh representation:

```text
old: null
new: ""
```

Ini berbeda. Jangan collapse tanpa policy.

---

# 21. Mapping Pipeline Design

## 21.1 Mapping Jarang Satu Langkah

Untuk request masuk:

```text
HTTP JSON
  -> Jackson parse/bind
  -> Request DTO
  -> normalize
  -> validate
  -> command mapper
  -> application command
  -> domain model/entity
```

Untuk response keluar:

```text
Domain/entity/projection
  -> response mapper
  -> redaction/presentation shaping
  -> response DTO
  -> Jackson serialization
  -> JSON
```

Untuk integration:

```text
External XML/JSON
  -> external payload DTO
  -> ACL translator
  -> canonical internal command
  -> domain/application service
```

Untuk event:

```text
Domain state/action
  -> event mapper
  -> event payload DTO
  -> serialization
  -> broker/outbox
```

## 21.2 Pipeline Harus Punya Stage yang Bernama

Buruk:

```java
CaseEntity entity = mapper.map(request);
```

Terlalu banyak yang tidak terlihat.

Lebih jelas:

```java
NormalizedSubmitCaseRequest normalized = normalizer.normalize(request);
SubmitCaseCommand command = requestMapper.toCommand(normalized);
SubmitCaseResult result = submitCaseUseCase.submit(command);
CaseResponse response = responseMapper.toResponse(result.caseView(), result.permissions());
```

Nama stage membantu reasoning.

## 21.3 Mapping Pipeline untuk PATCH

PATCH lebih sulit daripada POST.

```text
JSON payload
  -> detect present fields
  -> validate present fields only
  -> normalize present fields only
  -> map to patch command
  -> apply patch with policy
```

Contoh:

```json
{
  "email": null
}
```

Bisa berarti hapus email.

Sedangkan:

```json
{}
```

Berarti tidak mengubah email.

Mapper biasa yang hanya melihat `request.getEmail() == null` tidak cukup.

## 21.4 Mapping Pipeline untuk Large Payload

Untuk payload besar:

```text
stream parse -> validate item -> map item -> process item
```

Jangan selalu:

```text
read entire JSON -> list of DTO -> list of entities -> save all
```

Karena memory bisa meledak.

Large import/export membutuhkan strategi streaming, batching, dan backpressure-adjacent design.

---

# 22. Mapper Responsibility Spectrum

Tidak semua mapper sama. Ada spektrum tanggung jawab.

## 22.1 Pure Structural Mapper

```text
same meaning, same type, different object
```

Contoh:

```java
CustomerResponse toResponse(CustomerView view);
```

Cocok untuk MapStruct.

## 22.2 Conversion Mapper

```text
type changes, meaning mostly same
```

Contoh:

```java
String <-> UUID
String <-> LocalDate
String <-> enum wire value
```

Butuh error handling jelas.

## 22.3 Translator

```text
meaning changes across boundary
```

Contoh:

```java
ExternalStatus -> InternalStatus
InternalCaseStatus -> PublicCaseStatus
```

Harus explicit dan tested.

## 22.4 Assembler

```text
multiple sources -> one target
```

Contoh:

```java
CaseDetailResponse assemble(Case case, List<Task> tasks, PermissionView permissions)
```

Assembler cocok untuk response kompleks.

## 22.5 Projector

```text
source -> simplified view
```

Contoh:

```java
CaseListItem project(CaseProjection projection)
```

Sering terkait query model.

## 22.6 Redactor

```text
source -> visibility-controlled target
```

Contoh:

```java
ApplicantResponse redact(Applicant applicant, ViewerContext viewer)
```

Terkait security/privacy.

## 22.7 Normalizer

```text
raw input -> canonical input
```

Contoh:

```java
String normalizePostalCode(String raw)
```

Harus idempotent.

---

# 23. Naming Matters

Nama `Mapper` sering terlalu umum.

Gunakan nama yang mencerminkan transformasi:

```text
CustomerRequestMapper
CustomerResponseMapper
CustomerStatusTranslator
PostalCodeNormalizer
ApplicantRedactor
CaseDetailAssembler
CustomerListProjector
LegacyCustomerAdapter
ApplicationEventMapper
AuditChangeMapper
```

Nama yang baik membantu reviewer melihat risiko.

Bandingkan:

```java
mapper.map(customer)
```

Dengan:

```java
customerPublicResponseMapper.toMaskedResponse(customer, viewerContext)
```

Yang kedua jauh lebih jelas.

---

# 24. Common Anti-Patterns

## 24.1 The God Mapper

```java
class CustomerMapper {
    CustomerResponse toResponse(Customer customer) { ... }
    CustomerEntity toEntity(CreateCustomerRequest request) { ... }
    CustomerEvent toEvent(CustomerEntity entity) { ... }
    ExternalCustomerPayload toPartnerPayload(CustomerEntity entity) { ... }
    CustomerExportRow toExport(CustomerEntity entity) { ... }
}
```

Masalah:

- terlalu banyak boundary,
- sulit tahu policy mana berlaku,
- perubahan satu target bisa memengaruhi target lain,
- dependency membengkak,
- test besar dan rapuh.

Lebih baik pecah berdasarkan boundary/use case.

## 24.2 Mapper with Hidden IO

```java
response.setCountryName(countryRepository.findName(entity.getCountryCode()));
```

Masalah:

- N+1,
- sulit dites,
- failure tersembunyi,
- mapper tidak lagi deterministic.

## 24.3 Entity as DTO

```java
return entity;
```

Masalah:

- internal field leak,
- lazy loading,
- infinite recursion,
- API contract tergantung persistence model.

## 24.4 Reflection Mapper Everywhere

Contoh library reflection mapper yang otomatis copy field by name bisa produktif untuk prototype, tetapi berbahaya untuk boundary serius.

Risiko:

- implicit mapping,
- runtime error,
- silent field mismatch,
- performance overhead,
- sulit trace,
- semantic conversion tersembunyi.

MapStruct lebih aman untuk banyak kasus karena generated code terlihat dan compile-time checked, tetapi implicit mapping tetap harus dikontrol.

## 24.5 `@Data` DTO Bocor Field

Lombok `@Data` menghasilkan getter untuk semua field. Jika DTO punya field sensitif dan diserialize otomatis, data bisa bocor.

Contoh:

```java
@Data
class UserResponse {
    private String username;
    private String passwordHash; // dangerous
}
```

Lebih aman desain DTO tanpa field itu sama sekali.

## 24.6 Formatting Too Early

```java
response.setAmount("$" + amount);
```

Jika consumer perlu numeric amount, ini buruk.

Pisahkan machine-readable dan display-readable contract.

## 24.7 Defaulting Without Consent

```java
request.setMarketingConsent(request.getMarketingConsent() == null ? true : request.getMarketingConsent());
```

Ini sangat berbahaya.

Defaulting field consent, permission, subscription, visibility, atau security tidak boleh sembarangan.

---

# 25. Decision Framework: Transformasi Ini Harus Diletakkan di Mana?

Gunakan pertanyaan berikut.

## 25.1 Apakah Transformasi Ini Pure?

Pure berarti:

- input sama menghasilkan output sama,
- tidak query database/API,
- tidak bergantung waktu saat ini kecuali diberikan sebagai parameter,
- tidak bergantung global state,
- tidak punya side effect.

Jika pure, mapper cocok.

Jika tidak pure, pertimbangkan service/application layer.

## 25.2 Apakah Transformasi Ini Mengandung Business Policy?

Contoh:

```text
initial status default
eligibility
approval permission
SLA category
risk classification
```

Ini bukan sekadar mapping. Letakkan di policy/domain/application service, lalu hasilnya boleh dimap ke DTO.

## 25.3 Apakah Transformasi Ini Security/Privacy Policy?

Contoh:

```text
masking identity number
hide internal note
show document based on role
```

Boleh ada di redactor/response mapper khusus, tetapi harus eksplisit, tested, dan tidak generic.

## 25.4 Apakah Transformasi Ini External Contract Translation?

Gunakan adapter/translator di integration boundary.

Jangan bocorkan external field/code ke domain.

## 25.5 Apakah Transformasi Ini Presentation-only?

Jika untuk UI web modern, sering lebih baik kirim data machine-readable dan formatting di frontend.

Jika untuk report/email/export, backend formatting bisa masuk akal.

## 25.6 Apakah Transformasi Ini Membutuhkan Lookup?

Jika lookup kecil/static/reference map tersedia sebagai context, mapper boleh pakai.

Jika lookup perlu IO, orchestration di service layer.

---

# 26. Transformation Matrix

| Jenis Transformasi | Contoh | Tempat Umum | Risiko Utama | Cocok untuk MapStruct? |
|---|---|---|---|---|
| Copy | `name -> name` | mapper | field leak, aliasing | Ya |
| Rename | `fullName -> name` | mapper | makna tidak sama | Ya |
| Type conversion | `String -> UUID` | mapper/converter | parse error | Ya, dengan converter |
| Semantic conversion | `INTERNAL_PENDING -> IN_PROGRESS` | translator | meaning loss | Ya, jika explicit |
| Normalization | trim postal code | normalizer/boundary mapper | evidence loss | Bisa |
| Defaulting | missing language -> EN | mapper/policy | wrong assumption | Hati-hati |
| Enrichment | country code -> country name | service + mapper context | N+1, IO hidden | Bisa dengan context |
| Redaction | NRIC mask | redactor/response mapper | data leak | Bisa, harus explicit |
| Projection | entity -> list item | query/mapper | overfetch/underfetch | Ya |
| Aggregation | multiple source -> response | assembler | consistency, IO | Ya jika sources ready |
| Filtering | visible docs only | service/query/mapper | hidden policy | Hati-hati |
| Localization | date display | presentation mapper | env-dependent | Hati-hati |
| Version adaptation | v1/v2 DTO | API mapper | drift | Ya |
| ACL translation | partner payload -> command | adapter/translator | domain pollution | Ya dengan explicit logic |
| Audit mapping | before/after changes | audit mapper | PII, payload bloat | Ya, tested |

---

# 27. Worked Example: Case Management Mapping Taxonomy

Bayangkan sistem case management regulatory.

## 27.1 Domain Entity

```java
class CaseEntity {
    private Long id;
    private String caseNo;
    private CaseStatus status;
    private String applicantName;
    private String applicantNric;
    private String internalRemark;
    private String assignedOfficerId;
    private Instant submittedAt;
    private List<DocumentEntity> documents;
}
```

## 27.2 Public Applicant Response

```java
class ApplicantCaseResponse {
    private String caseNo;
    private String displayStatus;
    private String applicantName;
    private String maskedNric;
    private String submittedAt;
    private List<DocumentResponse> documents;
}
```

Mapping taxonomy:

```text
caseNo              -> copy
status              -> semantic conversion to displayStatus
applicantName       -> copy, maybe presentation normalization
applicantNric       -> redaction/masking
submittedAt         -> type/presentation conversion
internalRemark      -> not projected
assignedOfficerId   -> not projected
all documents       -> filter applicant-visible only
DocumentEntity      -> projection/redaction
```

This is not a simple mapper.

## 27.3 Officer Internal Response

```java
class OfficerCaseDetailResponse {
    private String caseNo;
    private String status;
    private String applicantName;
    private String applicantNric;
    private String internalRemark;
    private String assignedOfficerName;
    private String submittedAt;
    private List<DocumentResponse> documents;
    private boolean canApprove;
}
```

Mapping taxonomy:

```text
caseNo              -> copy
status              -> enum/string conversion, maybe internal display
applicantNric       -> maybe full visible depending role
internalRemark      -> projection for officer only
assignedOfficerId   -> enrichment to assignedOfficerName
canApprove          -> policy-derived enrichment
submittedAt         -> type/presentation conversion
```

## 27.4 Same Source, Different Boundary

Applicant response and officer response use same source entity, but mapping rules differ.

Maka jangan gunakan satu generic mapper:

```java
CaseResponse toResponse(CaseEntity entity);
```

Lebih jelas:

```java
ApplicantCaseResponse toApplicantResponse(CaseEntity entity, ViewerContext viewer);
OfficerCaseDetailResponse toOfficerDetail(CaseEntity entity, OfficerViewContext context);
```

Atau pecah:

```text
ApplicantCaseResponseMapper
OfficerCaseDetailAssembler
CaseStatusDisplayTranslator
NricMaskingPolicy
DocumentVisibilityProjector
```

---

# 28. Worked Example: Inbound Create Request

## 28.1 Request DTO

```java
class CreateCustomerRequest {
    private String name;
    private String email;
    private String postalCode;
    private String customerType;
    private Boolean marketingConsent;
}
```

## 28.2 Command Model

```java
class CreateCustomerCommand {
    private String name;
    private Email email;
    private PostalCode postalCode;
    private CustomerType customerType;
    private MarketingConsent marketingConsent;
}
```

## 28.3 Transformation Taxonomy

```text
name               -> normalize trim, maybe validate non-empty
email              -> normalize + type/value-object conversion
postalCode         -> normalize + value-object conversion
customerType       -> external string to internal enum semantic conversion
marketingConsent   -> explicit conversion, no unsafe default
```

## 28.4 Safer Pipeline

```java
NormalizedCreateCustomerRequest normalized = normalizer.normalize(request);
validation.validate(normalized);
CreateCustomerCommand command = mapper.toCommand(normalized);
```

Or:

```java
CreateCustomerCommand command = CreateCustomerCommand.from(request, normalizer, typeTranslator);
```

But keep policy visible.

## 28.5 Dangerous Pipeline

```java
CustomerEntity entity = objectMapper.convertValue(request, CustomerEntity.class);
```

Why dangerous:

- skips explicit semantic conversion,
- maps by name accidentally,
- may expose entity fields to request,
- no clear null/absent/default policy,
- validation boundary unclear.

---

# 29. What Top 1% Engineers Notice

## 29.1 They Ask “Same Name or Same Meaning?”

Field name similarity is not proof of semantic equality.

```text
status in domain != status in API != status in partner system != status in UI
```

## 29.2 They Separate Mechanical Mapping from Policy

Mechanical:

```text
firstName -> firstName
String -> UUID
```

Policy:

```text
which status should applicant see?
which documents should be hidden?
what default should apply?
```

Policy needs ownership, tests, and review.

## 29.3 They Treat Serialization as Contract

JSON/XML payload is not incidental output. It is contract.

Changing mapper can break clients.

## 29.4 They Design for Failure

For every conversion:

- what can fail?
- where is the error caught?
- what field path is reported?
- is raw input logged safely?
- is the error retryable?

## 29.5 They Avoid Hidden IO in Mappers

Mappers should be deterministic by default. IO belongs in orchestration layer unless explicitly designed.

## 29.6 They Test Negative Cases

Not only:

```text
valid source -> expected target
```

But also:

```text
missing field
null field
unknown enum
new enum
sensitive field
large collection
cyclic graph
partial update
legacy payload
```

## 29.7 They Make Boundary-Specific DTOs

Generic DTO reuse feels efficient early, but causes coupling later.

Boundary-specific DTOs preserve meaning.

---

# 30. Practical Heuristics

## 30.1 Mapper Method Naming

Prefer:

```java
toApplicantResponse(...)
toOfficerDetailResponse(...)
toCreateCommand(...)
toAuditEvent(...)
toExternalPartnerPayload(...)
```

Avoid:

```java
map(...)
convert(...)
toDto(...)
```

unless context is extremely obvious.

## 30.2 One Mapper per Boundary Direction

Better:

```text
CreateCustomerRequestMapper
CustomerResponseMapper
CustomerEventMapper
PartnerCustomerPayloadMapper
```

Than:

```text
CustomerMapper with 40 methods
```

## 30.3 Explicit Semantic Mapping

Use switch for enum translation. Avoid string hacks.

## 30.4 Fail on Unmapped Target for Critical DTOs

If using MapStruct, prefer strict reporting for public/external contracts.

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
```

## 30.5 Never Expose Entities Directly

Especially if entity has:

- JPA annotations,
- lazy relationships,
- audit fields,
- sensitive data,
- internal status,
- bidirectional graph.

## 30.6 Context Should Be Explicit

Bad:

```java
mapper.toResponse(entity); // secretly uses SecurityContextHolder
```

Better:

```java
mapper.toResponse(entity, viewerContext);
```

## 30.7 Separate Raw and Normalized Data When Needed

For audit-sensitive systems:

```java
rawInput
normalizedInput
```

Both may matter.

---

# 31. Checklist: Classify a Mapping

Before writing mapper, answer:

1. What is the source model?
2. What is the target model?
3. What boundary is crossed?
4. Is this inbound, outbound, persistence, event, export, or integration mapping?
5. Which fields are pure copy?
6. Which fields are renamed?
7. Which fields need type conversion?
8. Which fields need semantic conversion?
9. Which fields need normalization?
10. Which fields need defaulting?
11. Which fields need enrichment?
12. Which fields need redaction/masking?
13. Which fields are deliberately not projected?
14. Is there filtering in collection mapping?
15. Does mapping require current user/role/locale/timezone?
16. Does mapping require database/API lookup?
17. What can fail?
18. What error should caller see?
19. What should be logged?
20. What must not be logged?
21. How is compatibility tested?
22. What happens when source enum gains a new value?
23. What happens when target DTO gains a new required field?
24. Is null different from absent?
25. Is this mapping safe for bulk/list usage?

---

# 32. Mini Design Exercise

## Scenario

You receive this external API payload:

```json
{
  "app_id": "A-2026-0001",
  "applicant_name": "  Fajar Abdi Nugraha ",
  "id_no": "S1234567D",
  "status_code": "PEND_OFFCR",
  "submitted_date": "17/06/2026 18:30:00",
  "postal": " 079903 ",
  "docs": [
    { "name": "passport.pdf", "conf": "N" },
    { "name": "investigation-note.pdf", "conf": "Y" }
  ]
}
```

Internal command:

```java
class UpsertApplicationCommand {
    private ApplicationNumber applicationNumber;
    private ApplicantName applicantName;
    private IdentityNumber identityNumber;
    private ApplicationStatus status;
    private Instant submittedAt;
    private PostalCode postalCode;
    private List<DocumentCommand> documents;
}
```

Applicant response:

```java
class ApplicantApplicationResponse {
    private String applicationNumber;
    private String applicantName;
    private String maskedIdentityNumber;
    private String displayStatus;
    private String submittedAt;
    private List<DocumentResponse> documents;
}
```

## Classification

Inbound external payload to command:

| Field | Transformation |
|---|---|
| `app_id` -> `ApplicationNumber` | rename + type/value-object conversion |
| `applicant_name` -> `ApplicantName` | rename + normalization + value-object conversion |
| `id_no` -> `IdentityNumber` | rename + normalization + sensitive value-object |
| `status_code` -> `ApplicationStatus` | semantic conversion / ACL translation |
| `submitted_date` -> `Instant` | date parsing + timezone policy |
| `postal` -> `PostalCode` | normalization + value-object conversion |
| `docs` -> `DocumentCommand` | collection mapping + semantic conversion of confidentiality flag |

Command/domain to applicant response:

| Field | Transformation |
|---|---|
| `applicationNumber` -> string | type conversion / serialization-ready |
| `applicantName` -> string | copy/display conversion |
| `identityNumber` -> `maskedIdentityNumber` | redaction/masking |
| `status` -> `displayStatus` | semantic conversion |
| `submittedAt` -> string | time formatting / API contract formatting |
| `documents` | filter confidential + projection |

Important observation:

> The inbound mapper and outbound mapper should not be the same class.

Better design:

```text
ExternalApplicationPayloadTranslator
ApplicationStatusCodeTranslator
ApplicationRequestNormalizer
ApplicantApplicationResponseMapper
IdentityNumberMasker
DocumentVisibilityProjector
```

---

# 33. Common Review Comments You Should Learn to Make

Use these during code review.

## 33.1 “This looks like semantic mapping, not copy mapping.”

When code maps status/category/type but meaning is not obviously identical.

## 33.2 “Where is null vs absent handled?”

Especially for PATCH/update endpoints.

## 33.3 “This mapper performs IO; can we move lookup to service and pass context?”

Prevents N+1 and hidden failure.

## 33.4 “Why is this entity returned directly?”

Prevents entity exposure.

## 33.5 “Is this field safe to serialize?”

Security/privacy review.

## 33.6 “What happens if this enum gains a new value?”

Compatibility/fail-fast review.

## 33.7 “Are we formatting for display too early?”

Machine-readable contract review.

## 33.8 “Is this default a business policy?”

Moves policy out of mapper if needed.

## 33.9 “Can this list mapping trigger lazy loading or N+1?”

Performance/persistence review.

## 33.10 “Do we have golden payload tests for this contract?”

Regression safety.

---

# 34. Summary Mental Model

Mapping is not merely assigning fields.

A mature engineer sees each mapping as a combination of:

```text
structure + meaning + representation + policy + visibility + compatibility + failure behavior
```

The taxonomy helps you avoid treating every transformation as the same thing.

The most important distinctions:

```text
copy != conversion
conversion != semantic translation
normalization != validation
defaulting != harmless convenience
enrichment != pure mapping
redaction != formatting
projection != entity exposure
aggregation != hidden database query
```

If you can classify the transformation, you can design the right abstraction:

```text
Mapper       -> structural transformation
Converter    -> type conversion
Translator   -> semantic translation
Normalizer   -> canonical representation
Redactor     -> visibility/privacy transformation
Projector    -> subset/view transformation
Assembler    -> multi-source composition
Adapter/ACL  -> external model isolation
```

This is the foundation before going deeper into manual mapping, Jackson, MapStruct, Lombok, records, XML, testing, performance, persistence, and integration.

---

# 35. What Comes Next

Part berikutnya:

```text
03-dto-design-api-domain-persistence-event-dto.md
```

Kita akan membahas desain DTO secara mendalam:

- request DTO,
- response DTO,
- command DTO,
- query DTO,
- event DTO,
- persistence projection DTO,
- external integration DTO,
- internal DTO,
- versioned DTO,
- dan bagaimana memilih bentuk DTO yang tidak mencemari domain ataupun API contract.

Status seri setelah bagian ini:

```text
Part 2 dari 35 selesai.
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 1 — Java Object Model for Mapping: Beans, Records, POJOs, Immutability](./01-java-object-model-for-mapping-beans-records-pojos-immutability.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 3 — DTO Design: API DTO, Domain DTO, Persistence DTO, Event DTO](./03-dto-design-api-domain-persistence-event-dto.md)
