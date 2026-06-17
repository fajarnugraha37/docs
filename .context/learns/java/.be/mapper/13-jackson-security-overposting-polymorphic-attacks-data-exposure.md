# Part 13 — Jackson Security: Over-Posting, Polymorphic Attacks, Data Exposure

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> Bagian: 13 dari 35  
> Fokus: Jackson sebagai attack surface: inbound binding, outbound exposure, polymorphism, mass assignment, payload abuse, dan secure ObjectMapper profiles.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat serialization/deserialization sebagai **security boundary**, bukan sekadar parsing JSON.
2. Membedakan risiko:
   - over-posting / mass assignment,
   - unsafe polymorphic deserialization,
   - data exposure via serialization,
   - payload abuse / denial of service,
   - exception leakage,
   - schema drift yang berubah menjadi security bug.
3. Mendesain DTO dan `ObjectMapper` secara **deny-by-default**.
4. Menentukan kapan harus strict, kapan boleh tolerant, dan kapan input harus ditolak total.
5. Membuat checklist review mapping security untuk API enterprise.
6. Menghindari pola berbahaya seperti expose entity langsung, global default typing, dan binding payload eksternal ke domain/entity object.

---

## 1. Mental Model: Jackson Is Not Just a JSON Library

Banyak developer melihat Jackson seperti ini:

```java
UserRequest request = objectMapper.readValue(json, UserRequest.class);
String json = objectMapper.writeValueAsString(response);
```

Model itu terlalu sempit.

Dalam sistem production, Jackson adalah:

```text
Untrusted bytes
   ↓
JSON parser
   ↓
Shape binding
   ↓
Type construction
   ↓
Object graph creation
   ↓
Application state mutation
```

Dan pada sisi output:

```text
Internal object graph
   ↓
Property discovery
   ↓
Serialization policy
   ↓
External contract
   ↓
Potential data exposure
```

Artinya, Jackson berada di dua titik sensitif:

1. **Inbound trust boundary** — data dari luar berubah menjadi object yang mungkin memengaruhi business operation.
2. **Outbound disclosure boundary** — object internal berubah menjadi data yang dilihat consumer.

Kesalahan di inbound bisa membuat attacker mengubah field yang tidak seharusnya. Kesalahan di outbound bisa membocorkan password hash, internal status, permission flag, token, audit metadata, atau data sensitif lain.

Security mapper bukan hanya soal “valid JSON atau tidak”. Pertanyaan yang lebih penting:

- object apa yang boleh dibuat dari input?
- field apa yang boleh diisi client?
- field apa yang tidak boleh diterima walaupun ada di JSON?
- tipe apa yang boleh dipilih payload?
- property apa yang boleh keluar ke response?
- apakah output berbeda untuk public user, admin, internal system, audit, atau external integration?
- apakah parser punya batas ukuran, kedalaman, dan kompleksitas?

---

## 2. Security Invariant Utama

Gunakan invariant ini sebagai fondasi semua keputusan:

> **External payload must never be able to create or mutate more application state than the use case explicitly allows.**

Turunannya:

1. **Input DTO harus lebih sempit daripada domain/entity.**
2. **Output DTO harus lebih sempit daripada internal object.**
3. **Deserialization tidak boleh memilih arbitrary Java type dari untrusted payload.**
4. **Unknown field tidak boleh diam-diam diterima pada command sensitif.**
5. **Mapping tidak boleh menjadi privilege escalation path.**
6. **Serialization tidak boleh bergantung pada “semoga field internal tidak ikut keluar”.**
7. **Default global ObjectMapper tidak boleh dipakai untuk semua boundary dengan security posture yang sama.**

---

## 3. Threat Model untuk Jackson Mapping Layer

Sebelum membahas teknis, kita butuh threat model.

### 3.1 Actor

Payload dapat berasal dari:

- public internet user,
- authenticated normal user,
- admin user,
- internal service,
- batch file,
- message queue,
- legacy integration,
- trusted-but-buggy upstream system,
- compromised internal service.

“Internal” bukan berarti otomatis aman. Dalam distributed system, internal service bisa salah kirim payload, memakai versi contract lama, atau sudah compromised.

### 3.2 Asset yang Dilindungi

Mapping layer harus melindungi:

- permission / role / authority,
- ownership field,
- workflow status,
- approval status,
- audit metadata,
- createdBy / updatedBy,
- tenant id / agency id,
- internal remarks,
- financial amount,
- legal decision field,
- token / secret / credential,
- personally identifiable information,
- system routing metadata,
- optimistic lock / version field,
- domain invariant.

### 3.3 Attack Surface

Attack surface umum:

1. JSON request body.
2. Query parameter yang dibind ke object.
3. Form parameter yang dibind ke object.
4. Multipart metadata JSON.
5. Webhook payload.
6. Message queue payload.
7. Cached JSON restored to object.
8. Audit/event replay payload.
9. Test/admin/debug endpoint.
10. Internal controller yang diasumsikan “tidak terkena user”.

---

## 4. Over-Posting / Mass Assignment

### 4.1 Definisi

Over-posting atau mass assignment terjadi saat framework/binder otomatis mengisi field object dari input, termasuk field yang tidak dimaksudkan boleh diatur oleh client.

Contoh payload:

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "role": "ADMIN",
  "status": "APPROVED",
  "createdBy": "system",
  "tenantId": "another-tenant"
}
```

Kalau payload ini dibind langsung ke entity seperti ini:

```java
@PostMapping("/users")
public UserResponse create(@RequestBody User user) {
    User saved = userRepository.save(user);
    return toResponse(saved);
}
```

maka attacker mungkin bisa mengisi field yang seharusnya hanya dikontrol server.

### 4.2 Kenapa Ini Berbahaya

Karena developer sering berpikir:

> “UI tidak mengirim field itu.”

Security tidak boleh bergantung pada UI. Attacker bisa membuat request sendiri.

Masalahnya bukan Jackson semata, tetapi kombinasi:

```text
automatic binding
+ broad target object
+ sensitive mutable fields
+ insufficient allowlist
= mass assignment vulnerability
```

### 4.3 Contoh Domain Case Management

Misal sistem regulatory case management punya entity:

```java
public class CaseEntity {
    private Long id;
    private String caseNo;
    private String subject;
    private String description;
    private CaseStatus status;
    private DecisionOutcome decisionOutcome;
    private String assignedOfficerId;
    private String agencyId;
    private boolean escalated;
    private boolean enforcementActionAllowed;
    private String createdBy;
    private Instant createdAt;
    private String approvedBy;
    private Instant approvedAt;
    private Long version;
}
```

User biasa hanya boleh membuat case dengan:

```json
{
  "subject": "Complaint about ...",
  "description": "..."
}
```

Kalau request dibind langsung ke `CaseEntity`, attacker bisa mencoba:

```json
{
  "subject": "Complaint about ...",
  "description": "...",
  "status": "APPROVED",
  "decisionOutcome": "PENALTY_WAIVED",
  "assignedOfficerId": "senior-admin",
  "agencyId": "other-agency",
  "enforcementActionAllowed": true,
  "approvedBy": "director"
}
```

Walaupun sebagian field nanti dioverride service, bug sekecil lupa override satu field bisa menjadi privilege escalation.

### 4.4 Secure Design

Gunakan input DTO sempit:

```java
public record CreateCaseRequest(
    String subject,
    String description
) {}
```

Lalu mapping eksplisit:

```java
public CaseCreateCommand toCommand(CreateCaseRequest request, AuthenticatedUser user) {
    return new CaseCreateCommand(
        request.subject(),
        request.description(),
        user.userId(),
        user.agencyId()
    );
}
```

Kemudian domain/application service mengisi field server-owned:

```java
public CaseEntity createCase(CaseCreateCommand command) {
    CaseEntity entity = new CaseEntity();
    entity.setCaseNo(caseNoGenerator.next());
    entity.setSubject(command.subject());
    entity.setDescription(command.description());
    entity.setStatus(CaseStatus.DRAFT);
    entity.setAgencyId(command.agencyId());
    entity.setCreatedBy(command.userId());
    entity.setCreatedAt(clock.instant());
    entity.setEscalated(false);
    entity.setEnforcementActionAllowed(false);
    return caseRepository.save(entity);
}
```

Security invariant:

```text
Client may request intent.
Server derives authority-sensitive state.
```

---

## 5. Deny-by-Default DTO Design

### 5.1 Allowlist, Not Blocklist

Blocklist approach:

```java
@JsonIgnore
private boolean admin;

@JsonIgnore
private String internalStatus;
```

Masalahnya: setiap field baru harus diingat untuk di-ignore. Ini fragile.

Allowlist approach:

```java
public record RegisterUserRequest(
    String email,
    String password,
    String displayName
) {}
```

Hanya field yang ada di DTO yang bisa masuk.

### 5.2 Separate DTO per Operation

Buruk:

```java
public class UserDto {
    public String id;
    public String email;
    public String displayName;
    public String role;
    public boolean locked;
    public Instant createdAt;
    public Instant lastLoginAt;
}
```

Dipakai untuk:

- create user,
- update profile,
- admin update,
- response,
- search result.

Ini rawan karena field yang valid untuk response belum tentu valid untuk request.

Lebih aman:

```java
public record RegisterUserRequest(
    String email,
    String password,
    String displayName
) {}

public record UpdateMyProfileRequest(
    String displayName
) {}

public record AdminUpdateUserStatusRequest(
    boolean locked
) {}

public record UserProfileResponse(
    String id,
    String email,
    String displayName
) {}

public record AdminUserResponse(
    String id,
    String email,
    String displayName,
    String role,
    boolean locked,
    Instant createdAt,
    Instant lastLoginAt
) {}
```

Satu use case, satu DTO intent.

### 5.3 DTO Width Rule

Gunakan aturan:

```text
request DTO width <= operation authority width
response DTO width <= viewer authorization width
```

Artinya:

- DTO request tidak boleh punya field lebih banyak daripada yang boleh diubah operation.
- DTO response tidak boleh punya field lebih banyak daripada yang boleh dilihat caller.

---

## 6. Unknown Field Policy

### 6.1 Kenapa Unknown Field Penting

Unknown field terlihat seperti compatibility issue, tapi bisa menjadi security signal.

Payload:

```json
{
  "displayName": "Alice",
  "role": "ADMIN"
}
```

Kalau `role` tidak ada di DTO dan `ObjectMapper` mengabaikan unknown field, request sukses. Itu mungkin baik untuk forward compatibility, tetapi buruk untuk endpoint sensitif karena attacker probe tidak terlihat.

### 6.2 Strict Command Mapper

Untuk command yang mengubah state, terutama public API, gunakan strict mode:

```java
ObjectMapper strictCommandMapper = JsonMapper.builder()
    .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .build();
```

Dengan strict mode, payload berisi field tak dikenal ditolak.

Keuntungan:

- mencegah attacker menyisipkan field shadow,
- mendeteksi client salah versi,
- mempercepat feedback contract,
- membuat API lebih predictable.

Trade-off:

- lebih sulit untuk forward compatibility,
- client harus lebih disiplin,
- rolling deployment antar service perlu dipikirkan.

### 6.3 Tolerant Reader untuk Integration

Untuk event/integration tertentu, tolerant reader bisa masuk akal:

```java
ObjectMapper integrationReaderMapper = JsonMapper.builder()
    .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .build();
```

Tapi tolerant bukan berarti bebas. Tetap harus:

- pakai DTO sempit,
- validasi field yang digunakan,
- log unknown field jika contract sensitif,
- punya compatibility test.

### 6.4 Boundary Matrix

| Boundary | Unknown Field Policy | Alasan |
|---|---:|---|
| Public command API | Reject | Prevent probing, over-posting attempt, typo hidden bug |
| Admin command API | Reject | High privilege operation |
| Public query filter | Usually reject | Avoid silent misfiltering |
| Internal event consumer | Usually tolerate | Forward compatibility antar producer/consumer |
| External legacy integration | Tolerate carefully | Legacy payload sering berubah / noisy |
| Audit replay | Reject or quarantine | Integrity penting |
| Debug/admin import | Reject with report | Operator perlu tahu error data |

---

## 7. Null, Missing, and Default as Security Problems

### 7.1 Null Is Not Always “Empty”

Payload:

```json
{
  "approvedBy": null
}
```

Bisa berarti:

1. client tidak tahu field itu,
2. client ingin menghapus approval,
3. client mengirim bug,
4. attacker mencoba reset field,
5. deserializer defaulting menyebabkan value hilang.

### 7.2 PUT vs PATCH

Untuk PUT:

```text
missing field may mean set to default or invalid full replacement
```

Untuk PATCH:

```text
missing field = do not change
null field = explicitly clear, only if allowed
```

Kalau mapper tidak membedakan missing vs null, security bug bisa muncul.

### 7.3 Dangerous Example

```java
public void updateCase(UpdateCaseRequest request, CaseEntity entity) {
    entity.setSubject(request.subject());
    entity.setDescription(request.description());
    entity.setAssignedOfficerId(request.assignedOfficerId());
}
```

Kalau `assignedOfficerId` missing lalu menjadi null, mapper bisa menghapus assignment tanpa intent eksplisit.

### 7.4 Safer Patch Model

Gunakan wrapper field presence:

```java
public record PatchField<T>(
    boolean present,
    T value
) {}
```

Atau gunakan JSON Merge Patch/JsonNode layer untuk membedakan field presence.

Pseudo-flow:

```text
raw JSON
  → detect fields present
  → validate allowed patch paths
  → convert only allowed values
  → apply explicit update command
```

Ingat: patch adalah operation language, bukan sekadar DTO biasa.

---

## 8. Unsafe Polymorphic Deserialization

### 8.1 Apa Itu Polymorphic Deserialization

Kadang field dideklarasikan sebagai interface/base class:

```java
public interface NotificationTarget {}

public final class EmailTarget implements NotificationTarget {
    public String email;
}

public final class SmsTarget implements NotificationTarget {
    public String phone;
}
```

JSON perlu memberi tahu subtype mana yang dipakai:

```json
{
  "type": "email",
  "email": "alice@example.com"
}
```

Ini normal.

Masalah muncul kalau payload bisa menentukan arbitrary class Java.

### 8.2 Dangerous Pattern: Global Default Typing

Pola lama yang berbahaya:

```java
objectMapper.enableDefaultTyping();
```

Atau varian yang terlalu luas:

```java
objectMapper.activateDefaultTyping(
    laxPolymorphicTypeValidator,
    ObjectMapper.DefaultTyping.NON_FINAL
);
```

Risikonya: payload eksternal bisa membawa type metadata yang meminta Jackson membuat class tertentu. Jika classpath berisi gadget type berbahaya dan konfigurasi menerima subtype luas, ini dapat menjadi deserialization vulnerability.

### 8.3 Safe Polymorphism Principle

Gunakan prinsip:

```text
Payload may choose business subtype from a closed allowlist.
Payload must never choose arbitrary Java class name.
```

Buruk:

```json
{
  "@class": "com.some.library.DangerousClass",
  "...": "..."
}
```

Lebih baik:

```json
{
  "type": "EMAIL",
  "email": "alice@example.com"
}
```

Dengan mapping eksplisit:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = EmailTarget.class, name = "EMAIL"),
    @JsonSubTypes.Type(value = SmsTarget.class, name = "SMS")
})
public sealed interface NotificationTarget permits EmailTarget, SmsTarget {
}
```

### 8.4 Sealed Classes Help, But Do Not Magically Secure Everything

Java sealed classes membantu membatasi subtype secara source-level:

```java
public sealed interface PaymentMethod
    permits CardPayment, BankTransferPayment, WalletPayment {
}
```

Namun security tetap bergantung pada:

- Jackson configuration,
- subtype registration,
- discriminator design,
- visibility constructor,
- apakah payload eksternal dipercaya,
- apakah base type digunakan di field yang tepat.

Sealed class adalah structural constraint, bukan pengganti allowlist deserialization.

### 8.5 Polymorphism Design Checklist

Untuk setiap polymorphic payload, jawab:

1. Apakah polymorphism benar-benar perlu di boundary eksternal?
2. Apakah consumer perlu melihat subtype atau cukup flattened response?
3. Apakah subtype list tertutup?
4. Apakah discriminator business-level, bukan Java class name?
5. Apakah subtype punya field yang aman untuk diisi client?
6. Apakah unknown subtype harus reject atau quarantine?
7. Apakah semua subtype punya test negative?
8. Apakah default implementation berbahaya?
9. Apakah type metadata bocor di response publik?
10. Apakah classpath gadget risk dieliminasi dengan tidak memakai arbitrary default typing?

---

## 9. Serialization Data Exposure

### 9.1 Problem: Entity as Response

Pola buruk:

```java
@GetMapping("/users/{id}")
public UserEntity getUser(@PathVariable Long id) {
    return userRepository.findById(id).orElseThrow();
}
```

Entity:

```java
public class UserEntity {
    private Long id;
    private String email;
    private String passwordHash;
    private String resetToken;
    private String role;
    private boolean locked;
    private String internalRemark;
    private Instant createdAt;
    private Instant updatedAt;
}
```

Jackson akan men-serialize property yang terlihat. Jika field sensitif punya getter, data bisa bocor.

### 9.2 `@JsonIgnore` Is Not Enough as Primary Defense

Kamu bisa menulis:

```java
@JsonIgnore
private String passwordHash;
```

Tapi defense ini rapuh karena:

- field baru mungkin lupa di-ignore,
- annotation bercampur dengan persistence/domain concern,
- response berbeda per role sulit dikelola,
- entity untuk internal use jadi dikotori API concern,
- getter derived bisa bocor,
- bidirectional relationship bisa terbuka.

Lebih aman: response DTO eksplisit.

```java
public record UserProfileResponse(
    Long id,
    String email,
    String displayName
) {}
```

### 9.3 Exposure Through Nested Graph

Bahkan jika top-level aman, nested object bisa bocor.

```java
public class CaseResponse {
    public Long id;
    public String subject;
    public UserEntity assignedOfficer;
}
```

Jika `assignedOfficer` adalah entity, response bisa ikut membawa:

- email internal,
- role,
- department,
- audit fields,
- internal remarks,
- lazy-loaded relationships.

Gunakan nested DTO:

```java
public record OfficerSummary(
    String officerId,
    String displayName
) {}

public record CaseResponse(
    Long id,
    String subject,
    OfficerSummary assignedOfficer
) {}
```

### 9.4 Exposure Through Error Response

Jackson error bisa memuat path internal:

```text
Cannot deserialize value of type `com.company.case.domain.DecisionOutcome`
from String "XXX": not one of the values accepted...
```

Untuk public API, jangan expose package internal atau class name detail.

Lebih aman:

```json
{
  "code": "INVALID_FIELD_VALUE",
  "message": "One or more fields contain invalid values.",
  "fieldErrors": [
    {
      "field": "decisionOutcome",
      "reason": "Unsupported value."
    }
  ],
  "correlationId": "..."
}
```

Internal logs boleh lebih detail, tapi harus aman dari secret/PII leakage.

---

## 10. Sensitive Data Masking

### 10.1 Masking Is Boundary-Specific

Jangan buat satu serializer global untuk semua masking tanpa memahami boundary.

Contoh field NRIC/identity number:

| Boundary | Output |
|---|---|
| Public profile | masked |
| Admin detail | partially masked or full based on permission |
| Audit export | maybe full, access-controlled |
| Log | masked/tokenized |
| External integration | depends on contract and lawful basis |

### 10.2 Bad Global Masking

```java
public class SensitiveStringSerializer extends JsonSerializer<String> {
    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
        gen.writeString("****");
    }
}
```

Jika dipasang global terlalu luas, bisa merusak:

- internal integration payload,
- audit record,
- downstream reconciliation,
- signed canonical payload.

### 10.3 Better: Explicit Response Model

```java
public record ApplicantPublicResponse(
    String name,
    String maskedNric
) {}

public record ApplicantInternalResponse(
    String name,
    String nric,
    String accessReason
) {}
```

Masking dilakukan saat mapping:

```java
public ApplicantPublicResponse toPublicResponse(Applicant applicant) {
    return new ApplicantPublicResponse(
        applicant.name(),
        maskNric(applicant.nric())
    );
}
```

Untuk top-level engineering maturity, masking harus bagian dari authorization-aware projection, bukan hiasan serializer.

---

## 11. Payload Abuse and Denial of Service

Security JSON bukan hanya RCE. Payload besar, terlalu dalam, atau terlalu kompleks bisa menghabiskan CPU/memory.

### 11.1 Attack Forms

1. Very large JSON object.
2. Very large array.
3. Deeply nested object.
4. Huge string field.
5. Huge number token.
6. Repeated duplicate fields.
7. Unknown field storm.
8. Polymorphic subtype explosion.
9. Recursive object graph serialization.
10. Payload yang menyebabkan expensive validation/mapping.

### 11.2 Example: Deep Nesting

```json
{"a":{"a":{"a":{"a":{"a":{"a":{}}}}}}}
```

Jika parser tidak punya batas kedalaman, recursive parse/mapping bisa menjadi DoS vector.

### 11.3 Layered Defense

Gunakan pertahanan berlapis:

```text
Reverse proxy / gateway body size limit
  ↓
HTTP server request size limit
  ↓
Jackson stream constraints
  ↓
DTO validation constraints
  ↓
application-level collection limits
  ↓
transaction/workflow guardrails
```

Jangan hanya mengandalkan satu layer.

### 11.4 Limit Collection Size at DTO Level

```java
public record BulkApproveRequest(
    List<Long> caseIds
) {}
```

Tambahkan validation:

```java
public record BulkApproveRequest(
    @NotEmpty
    @Size(max = 100)
    List<Long> caseIds
) {}
```

Tapi ingat: Bean Validation terjadi setelah deserialization. Untuk payload sangat besar, request mungkin sudah menghabiskan memory sebelum validation. Karena itu perlu body size limit/gateway/server/parser constraint.

### 11.5 Recursive Serialization

Bidirectional entity graph:

```java
class Department {
    List<Employee> employees;
}

class Employee {
    Department department;
}
```

Jika entity diserialisasi langsung, bisa terjadi:

- infinite recursion,
- huge output,
- lazy loading storm,
- data leakage.

DTO projection memotong graph:

```java
public record DepartmentResponse(
    Long id,
    String name,
    List<EmployeeSummary> employees
) {}

public record EmployeeSummary(
    Long id,
    String name
) {}
```

---

## 12. Duplicate Fields and Ambiguous Payload

JSON secara teknis bisa berisi duplicate property:

```json
{
  "role": "USER",
  "role": "ADMIN"
}
```

Bagaimana parser memperlakukan ini bisa berbeda. Ada yang last-wins, ada yang detect duplicate jika dikonfigurasi.

Security posture yang baik untuk command API:

```text
Duplicate field should be rejected.
```

Alasannya:

- mencegah ambiguity,
- mencegah parser differential attack,
- mencegah proxy/backend interpretasi berbeda,
- meningkatkan auditability.

Jika menggunakan Jackson, evaluasi fitur duplicate detection di parser/config yang sesuai dengan versi yang dipakai.

---

## 13. Coercion as Security Risk

### 13.1 Silent Coercion

Jackson bisa mengubah input tertentu tergantung konfigurasi:

- string angka menjadi number,
- empty string menjadi null,
- single value menjadi array,
- unknown enum menjadi null/default,
- case-insensitive enum/property.

Contoh:

```json
{
  "amount": "1000000"
}
```

Atau:

```json
{
  "roles": "ADMIN"
}
```

Jika mapper menerima coercion terlalu longgar, API menjadi lebih sulit diprediksi dan bisa membuka celah bypass validation.

### 13.2 Strict External Command

Untuk API command sensitif, sebaiknya:

- jangan terima number sebagai string kecuali contract memang begitu,
- jangan terima empty string sebagai null diam-diam,
- jangan terima unknown enum sebagai null,
- jangan terima single value as array tanpa alasan kuat,
- jangan case-insensitive untuk field security-sensitive jika contract menuntut presisi.

### 13.3 Contract-Specific Exception

Legacy integration kadang mengirim semua value sebagai string:

```json
{
  "amount": "123.45",
  "approved": "Y",
  "date": "20260617"
}
```

Untuk kasus ini, buat mapper/profile khusus legacy boundary, bukan melonggarkan mapper global.

```text
PublicCommandMapper: strict
LegacyPartnerMapper: tolerant + normalization + quarantine
InternalEventMapper: version tolerant
AuditMapper: canonical strict
```

---

## 14. Views, Filters, and Why They Are Not a Replacement for DTOs

Jackson punya fitur seperti:

- `@JsonView`,
- filters,
- mix-ins,
- conditional serializers.

Fitur ini berguna, tapi berbahaya jika dijadikan security boundary utama.

### 14.1 Problem with `@JsonView`

```java
public class UserEntity {
    @JsonView(Public.class)
    public String email;

    @JsonView(Admin.class)
    public String role;

    @JsonView(Internal.class)
    public String passwordHash;
}
```

Risiko:

- lupa menetapkan view saat serialization,
- view hierarchy salah,
- field baru lupa diberi view,
- entity dipakai di banyak context,
- security policy tersebar di annotation.

### 14.2 Better Use Case

`@JsonView` bisa diterima untuk:

- internal admin tooling rendah risiko,
- transitional migration,
- read-only representation yang sudah terkontrol,
- bukan sebagai defense utama untuk sensitive domain.

Untuk security-critical API, tetap gunakan DTO eksplisit.

---

## 15. Mix-ins: Powerful but Governance-Heavy

Jackson mix-ins memungkinkan memberi annotation ke class tanpa mengubah source.

Contoh:

```java
abstract class UserMixin {
    @JsonIgnore
    abstract String getPasswordHash();
}

objectMapper.addMixIn(UserEntity.class, UserMixin.class);
```

Ini berguna untuk:

- third-party class,
- legacy class,
- library model,
- migration sementara.

Tapi governance risk tinggi:

- behavior serialization tersembunyi dari class,
- sulit dilihat saat code review,
- mapper global bisa berubah efeknya,
- field baru tetap bisa bocor jika mixin tidak update.

Gunakan mix-in sebagai adapter technique, bukan primary security design.

---

## 16. Secure ObjectMapper Profiles

Sistem besar sebaiknya tidak punya satu mapper global untuk semua boundary.

### 16.1 Profile Contoh

```text
StrictPublicCommandJsonMapper
TolerantInternalEventJsonMapper
LegacyPartnerJsonMapper
CanonicalAuditJsonMapper
PublicResponseJsonMapper
```

### 16.2 Strict Public Command Mapper

Karakteristik:

- reject unknown properties,
- reject duplicate fields,
- strict enum,
- strict number/string coercion,
- no default typing,
- limited polymorphism allowlist,
- request size/depth constrained at surrounding layers,
- safe error response mapping.

### 16.3 Tolerant Internal Event Mapper

Karakteristik:

- allow unknown additive fields,
- reject unsafe type metadata,
- version-aware payload,
- dead-letter on invalid required semantic field,
- log contract drift,
- no broad default typing.

### 16.4 Legacy Partner Mapper

Karakteristik:

- tolerate weird format intentionally,
- normalize into canonical internal command,
- quarantine malformed payload,
- do not expose legacy looseness to internal domain,
- extremely well-tested with golden payloads.

### 16.5 Canonical Audit Mapper

Karakteristik:

- stable deterministic output,
- explicit field order if needed,
- no accidental omission of important field,
- careful masking/tokenization policy,
- no lenient mutation,
- compatibility governed.

---

## 17. Secure Deserialization Pipeline

Untuk inbound API, pikirkan pipeline seperti ini:

```text
HTTP request
  ↓
size/depth/content-type guard
  ↓
strict JSON parse
  ↓
request DTO binding
  ↓
syntactic validation
  ↓
authorization-aware semantic validation
  ↓
command mapping
  ↓
domain operation
```

Jangan langsung:

```text
HTTP request → Entity → save
```

### 17.1 Example Secure Controller

```java
@RestController
@RequestMapping("/cases")
public class CaseController {
    private final CaseApplicationService service;
    private final CaseApiMapper mapper;

    @PostMapping
    public CaseResponse create(
        @Valid @RequestBody CreateCaseRequest request,
        Authentication authentication
    ) {
        AuthenticatedUser user = AuthenticatedUser.from(authentication);
        CreateCaseCommand command = mapper.toCommand(request, user);
        CaseResult result = service.create(command);
        return mapper.toResponse(result, user);
    }
}
```

Security properties:

- request DTO sempit,
- validation terjadi sebelum command,
- user context berasal dari authentication, bukan payload,
- command membawa intent,
- service mengisi server-owned state,
- response DTO eksplisit.

---

## 18. Secure Serialization Pipeline

Outbound pipeline:

```text
Domain/application result
  ↓
authorization-aware projection
  ↓
response DTO
  ↓
serialization policy
  ↓
external JSON
```

Jangan langsung:

```text
Entity → JSON
```

### 18.1 Role-Aware Projection

```java
public CaseResponse toResponse(CaseResult result, AuthenticatedUser viewer) {
    if (viewer.hasRole("CASE_ADMIN")) {
        return toAdminResponse(result);
    }
    return toPublicResponse(result);
}
```

Atau lebih eksplisit:

```java
public PublicCaseResponse toPublicResponse(CaseResult result) { ... }
public AdminCaseResponse toAdminResponse(CaseResult result) { ... }
public AuditCaseResponse toAuditResponse(CaseResult result) { ... }
```

Jangan membuat satu DTO besar lalu berharap `null`/`@JsonIgnore`/view menyelesaikan semua.

---

## 19. Logging Failed Payloads Safely

Saat deserialization gagal, engineer ingin log payload untuk debugging. Ini berbahaya.

### 19.1 Bad Logging

```java
catch (JsonProcessingException e) {
    log.error("Failed to parse payload: {}", rawBody, e);
    throw e;
}
```

Risiko:

- PII bocor ke log,
- token/password bocor,
- log injection,
- payload sangat besar membengkakkan log,
- legal/regulatory issue.

### 19.2 Safer Logging

Log metadata:

```java
log.warn("JSON parse failed: endpoint={}, correlationId={}, errorType={}, fieldPath={}, payloadHash={}, sizeBytes={}",
    endpoint,
    correlationId,
    e.getClass().getSimpleName(),
    extractSafePath(e),
    sha256(rawBody),
    rawBody.length()
);
```

Kalau perlu payload sampling, lakukan:

- redaction,
- truncation,
- access-controlled secure storage,
- retention policy,
- explicit incident/debug mode.

### 19.3 Log Injection

Payload bisa berisi newline/control characters:

```json
{
  "name": "Alice\nERROR fake log line"
}
```

Pastikan logging framework/encoder menghasilkan structured logs dan value di-escape.

---

## 20. Security Tests for Jackson Mapping

### 20.1 Negative Tests for Over-Posting

```java
@Test
void createUserRejectsRoleField() {
    String json = """
        {
          "email": "alice@example.com",
          "password": "secret",
          "displayName": "Alice",
          "role": "ADMIN"
        }
        """;

    assertThatThrownBy(() -> strictMapper.readValue(json, RegisterUserRequest.class))
        .isInstanceOf(UnrecognizedPropertyException.class);
}
```

### 20.2 Unknown Field Tests

Untuk setiap command DTO sensitif, test:

- unknown field rejected,
- misspelled field rejected,
- duplicate field rejected jika dikonfigurasi,
- forbidden server-owned field rejected.

### 20.3 Polymorphic Tests

Test:

- known subtype accepted,
- unknown subtype rejected,
- Java class name metadata rejected,
- missing discriminator rejected,
- default implementation tidak menelan error,
- subtype tidak boleh mengisi field server-owned.

### 20.4 Data Exposure Tests

Golden response test:

```java
@Test
void publicUserResponseDoesNotExposeSensitiveFields() throws Exception {
    UserEntity entity = fixtureUserWithSensitiveFields();
    UserProfileResponse response = mapper.toPublicResponse(entity);

    String json = objectMapper.writeValueAsString(response);

    assertThat(json).doesNotContain("passwordHash");
    assertThat(json).doesNotContain("resetToken");
    assertThat(json).doesNotContain("internalRemark");
}
```

Lebih kuat: parse JSON lalu assert field set:

```java
JsonNode node = objectMapper.readTree(json);
assertThat(node.has("passwordHash")).isFalse();
assertThat(node.has("resetToken")).isFalse();
assertThat(node.has("internalRemark")).isFalse();
```

### 20.5 Fuzz-ish Payload Tests

Minimal payload abuse tests:

- very large array,
- deeply nested object,
- unknown field storm,
- invalid enum variants,
- wrong type per field,
- duplicate keys,
- null for required field,
- empty string for non-string field,
- number overflow,
- string too long.

---

## 21. Secure Review Checklist

Gunakan checklist ini untuk code review.

### 21.1 Inbound DTO

- [ ] Endpoint tidak bind langsung ke entity/domain aggregate.
- [ ] Request DTO hanya berisi field yang boleh dikontrol caller.
- [ ] Server-owned fields tidak ada di request DTO.
- [ ] DTO berbeda untuk create/update/patch/admin operation.
- [ ] Unknown field policy sesuai boundary.
- [ ] Null/missing semantics jelas.
- [ ] Enum handling strict untuk command sensitif.
- [ ] Collection size dibatasi.
- [ ] Large payload limit tersedia di layer HTTP/gateway/parser.
- [ ] Error response tidak expose class/package internal.

### 21.2 Outbound DTO

- [ ] Response tidak memakai entity langsung.
- [ ] Response DTO spesifik untuk audience/use case.
- [ ] Sensitive field tidak ada di DTO.
- [ ] Nested object juga DTO, bukan entity.
- [ ] Role-based response tidak bergantung pada annotation magic saja.
- [ ] Golden response test memastikan field sensitif tidak muncul.

### 21.3 Polymorphism

- [ ] Tidak memakai global broad default typing untuk untrusted payload.
- [ ] Discriminator memakai business name, bukan Java class name.
- [ ] Subtype list allowlist/closed.
- [ ] Unknown subtype ditolak atau masuk quarantine.
- [ ] Sealed hierarchy digunakan bila cocok, tetapi tetap diuji.
- [ ] No default implementation yang menutupi invalid subtype.

### 21.4 ObjectMapper Configuration

- [ ] Ada mapper/profile berbeda untuk boundary berbeda.
- [ ] Mapper public command strict.
- [ ] Mapper legacy/integration tolerant secara sengaja, bukan global accident.
- [ ] Tidak ada `enableDefaultTyping()` lama.
- [ ] Module registration tidak membuka behavior tidak diinginkan.
- [ ] Config dites dengan negative cases.

### 21.5 Logging and Observability

- [ ] Failed payload tidak dilog mentah.
- [ ] Ada correlation id.
- [ ] Error path aman untuk client.
- [ ] Internal log cukup untuk debug tanpa bocor secret.
- [ ] Payload hash/size digunakan untuk korelasi.
- [ ] Quarantine/dead-letter punya redaction/access control.

---

## 22. Anti-Patterns

### 22.1 Entity as Request

```java
@PostMapping
public CaseEntity create(@RequestBody CaseEntity entity) { ... }
```

Masalah:

- mass assignment,
- invariant bypass,
- persistence concern bocor ke API,
- field server-owned bisa masuk,
- future field menjadi attack surface.

### 22.2 Entity as Response

```java
@GetMapping("/{id}")
public CaseEntity get(@PathVariable Long id) { ... }
```

Masalah:

- data exposure,
- lazy loading,
- recursion,
- contract tidak stabil,
- persistence model menjadi public API.

### 22.3 One DTO for Everything

```java
public class CaseDto {
    public Long id;
    public String subject;
    public String status;
    public String assignedOfficerId;
    public String approvedBy;
    public Instant approvedAt;
    public boolean escalated;
}
```

Masalah:

- field semantics berbeda per operation,
- sulit enforce authority,
- patch ambiguity,
- response/request bercampur.

### 22.4 Global Lenient Mapper

```java
objectMapper.configure(FAIL_ON_UNKNOWN_PROPERTIES, false);
objectMapper.configure(ACCEPT_EMPTY_STRING_AS_NULL_OBJECT, true);
objectMapper.configure(READ_UNKNOWN_ENUM_VALUES_AS_NULL, true);
```

Masalah:

- public API terlalu permisif,
- typo client tersembunyi,
- attacker probing tidak terlihat,
- validation bisa dibypass via null/coercion.

### 22.5 Broad Default Typing

```java
objectMapper.enableDefaultTyping();
```

Masalah:

- payload bisa membawa type metadata terlalu luas,
- classpath gadget risk,
- sulit diaudit,
- tidak cocok untuk untrusted input.

---

## 23. Practical Secure Patterns

### 23.1 Pattern: Request DTO → Command

```text
JSON
  → Request DTO
  → Command enriched with authenticated context
  → Domain operation
```

Keuntungan:

- caller hanya menyampaikan intent,
- authority berasal dari server context,
- command bisa diuji tanpa Jackson,
- domain tidak tergantung transport.

### 23.2 Pattern: Entity → Projection DTO

```text
Entity/domain result
  → role-aware mapper
  → response DTO
  → JSON
```

Keuntungan:

- output explicit,
- field sensitif tidak ikut,
- nested graph dikontrol,
- contract stabil.

### 23.3 Pattern: Boundary-Specific ObjectMapper

```text
Public API mapper != Legacy partner mapper != Audit mapper
```

Keuntungan:

- strictness sesuai risk,
- legacy tolerance tidak mencemari public API,
- audit canonicalization tidak terganggu response formatting.

### 23.4 Pattern: Closed Polymorphic Contract

```text
type = business discriminator
subtype = allowlisted domain DTO
no arbitrary class name
```

Keuntungan:

- payload fleksibel tapi tetap aman,
- subtype evolution bisa diatur,
- test matrix jelas.

---

## 24. Case Study: Secure Case Approval Endpoint

### 24.1 Bad Design

```java
@PatchMapping("/cases/{id}")
public CaseEntity update(@PathVariable Long id, @RequestBody CaseEntity input) {
    CaseEntity entity = repository.findById(id).orElseThrow();
    entity.setSubject(input.getSubject());
    entity.setDescription(input.getDescription());
    entity.setStatus(input.getStatus());
    entity.setDecisionOutcome(input.getDecisionOutcome());
    entity.setApprovedBy(input.getApprovedBy());
    return repository.save(entity);
}
```

Payload attacker:

```json
{
  "subject": "minor change",
  "status": "APPROVED",
  "decisionOutcome": "NO_ACTION",
  "approvedBy": "director"
}
```

Masalah:

- endpoint update biasa bisa mengubah approval state,
- approvedBy berasal dari payload,
- no authority check pada field level,
- entity digunakan sebagai request/response.

### 24.2 Better Design

Separate endpoint intent:

```java
public record UpdateCaseDraftRequest(
    String subject,
    String description
) {}

public record ApproveCaseRequest(
    String approvalRemark
) {}
```

Controller:

```java
@PatchMapping("/cases/{id}/draft")
public CaseDraftResponse updateDraft(
    @PathVariable Long id,
    @Valid @RequestBody UpdateCaseDraftRequest request,
    Authentication authentication
) {
    AuthenticatedUser user = AuthenticatedUser.from(authentication);
    UpdateCaseDraftCommand command = mapper.toCommand(id, request, user);
    CaseDraftResult result = service.updateDraft(command);
    return mapper.toDraftResponse(result);
}

@PostMapping("/cases/{id}/approve")
public CaseApprovalResponse approve(
    @PathVariable Long id,
    @Valid @RequestBody ApproveCaseRequest request,
    Authentication authentication
) {
    AuthenticatedUser user = AuthenticatedUser.from(authentication);
    ApproveCaseCommand command = mapper.toCommand(id, request, user);
    CaseApprovalResult result = service.approve(command);
    return mapper.toApprovalResponse(result);
}
```

Service:

```java
public CaseApprovalResult approve(ApproveCaseCommand command) {
    CaseEntity entity = repository.findByIdForUpdate(command.caseId())
        .orElseThrow(CaseNotFoundException::new);

    authorization.checkCanApprove(command.user(), entity);

    entity.approve(
        command.user().userId(),
        clock.instant(),
        command.approvalRemark()
    );

    return CaseApprovalResult.from(repository.save(entity));
}
```

Keamanan meningkat karena:

- approval adalah use case eksplisit,
- field approval tidak datang dari request,
- actor approval berasal dari authentication,
- status transition dikontrol domain/service,
- response berbeda dari entity.

---

## 25. How Top 1% Engineers Think About This

Engineer biasa bertanya:

> “Bagaimana cara ignore password field di JSON?”

Engineer kuat bertanya:

> “Kenapa object yang punya password field bisa masuk ke response pipeline?”

Engineer biasa bertanya:

> “Bagaimana supaya Jackson bisa deserialize subtype ini?”

Engineer kuat bertanya:

> “Apakah payload eksternal memang boleh memilih subtype, dan subtype list-nya closed atau open?”

Engineer biasa bertanya:

> “Kenapa field role bisa masuk dari request?”

Engineer kuat bertanya:

> “Kenapa request DTO punya konsep role sama sekali untuk operation ini?”

Engineer biasa bertanya:

> “Bagaimana supaya API backward compatible?”

Engineer kuat bertanya:

> “Boundary mana yang harus tolerant, dan boundary mana yang harus strict demi security?”

Intinya: security mapping bukan kumpulan annotation, tetapi desain boundary.

---

## 26. Latihan

### Latihan 1 — Identify Over-Posting Risk

Diberikan DTO:

```java
public class EmployeeDto {
    public Long id;
    public String name;
    public String email;
    public String departmentId;
    public String role;
    public BigDecimal salary;
    public boolean active;
    public String createdBy;
    public Instant createdAt;
}
```

Dipakai untuk:

- create employee,
- update profile,
- admin list,
- HR salary update.

Tugas:

1. Pecah menjadi DTO per operation.
2. Tentukan field yang server-owned.
3. Tentukan unknown field policy untuk masing-masing endpoint.
4. Tentukan response DTO untuk employee sendiri, manager, dan HR admin.

### Latihan 2 — Polymorphic Payload Review

Payload:

```json
{
  "actionType": "EMAIL",
  "recipient": "alice@example.com",
  "template": "CASE_APPROVED"
}
```

Dan:

```json
{
  "@class": "com.company.notification.EmailAction",
  "recipient": "alice@example.com",
  "template": "CASE_APPROVED"
}
```

Tugas:

1. Bandingkan risiko dua desain tersebut.
2. Buat subtype allowlist.
3. Tentukan behavior untuk unknown action type.
4. Buat negative test untuk arbitrary class name.

### Latihan 3 — Data Exposure Test

Diberikan entity:

```java
public class ApplicantEntity {
    private Long id;
    private String name;
    private String nric;
    private String phone;
    private String email;
    private String internalRiskScore;
    private String investigationRemark;
    private String createdBy;
    private Instant createdAt;
}
```

Tugas:

1. Buat public response DTO.
2. Buat officer response DTO.
3. Buat audit export DTO.
4. Tentukan masking rule.
5. Buat golden response test agar field tertentu tidak bocor.

---

## 27. Ringkasan

Jackson security bukan hanya tentang menambal CVE. Ia adalah disiplin desain boundary.

Hal yang paling penting:

1. Jangan bind untrusted input ke entity/domain object.
2. Jangan expose entity sebagai response.
3. Gunakan DTO sempit per operation.
4. Treat unknown fields as suspicious pada command sensitif.
5. Bedakan null, missing, default, dan explicit clear.
6. Hindari broad/default polymorphic typing untuk untrusted payload.
7. Gunakan business discriminator dan subtype allowlist.
8. Batasi payload size/depth/collection.
9. Jangan log raw failed payload tanpa redaction.
10. Test negative path, bukan hanya happy path.

Top-level engineer tidak melihat mapper sebagai boilerplate. Mapper adalah salah satu tempat sistem menentukan:

```text
what external actors are allowed to say,
what internal state may be changed,
and what information may leave the system.
```

---

## 28. Referensi

- FasterXML Jackson Docs — Polymorphic Deserialization: https://github.com/FasterXML/jackson-docs/wiki/JacksonPolymorphicDeserialization
- FasterXML Jackson Wiki — Polymorphic Deserialization CVE Criteria: https://github.com/FasterXML/jackson/wiki/Jackson-Polymorphic-Deserialization-CVE-Criteria
- OWASP Mass Assignment Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
- OWASP Web Security Testing Guide — Testing for Mass Assignment: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/20-Testing_for_Mass_Assignment
- OWASP Proactive Controls — Validate All Input and Handle Exceptions: https://top10proactive.owasp.org/the-top-10/c3-validate-input-and-handle-exceptions/
- Spring Security Advisory CVE-2017-4995: https://spring.io/security/cve-2017-4995
