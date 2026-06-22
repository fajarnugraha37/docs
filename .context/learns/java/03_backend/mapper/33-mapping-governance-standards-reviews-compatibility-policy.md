# Part 33 — Mapping Governance: Standards, Reviews, Compatibility Policy

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `33-mapping-governance-standards-reviews-compatibility-policy.md`  
> Cakupan Java: Java 8 sampai Java 25  
> Fokus: governance, standard, ownership, review, compatibility, security, dan policy untuk mapping layer enterprise

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 32, kita sudah membahas mapping dari sisi teknik:

- mental model transformation boundary,
- DTO design,
- manual mapper,
- Jackson serialization/deserialization,
- XML mapping,
- MapStruct,
- Lombok,
- records/builders,
- validation boundary,
- diagnostics,
- testing,
- performance,
- persistence pitfalls,
- integration mapping dan anti-corruption layer.

Part 33 naik satu level: **bagaimana membuat seluruh praktik itu konsisten di organisasi, codebase besar, multi-team, dan sistem yang hidup bertahun-tahun**.

Di codebase kecil, mapping bisa terlihat sederhana:

```java
UserResponse response = userMapper.toResponse(user);
```

Di sistem enterprise/regulatory/case-management, mapping menyentuh banyak hal:

- API contract,
- audit trail,
- privacy/redaction,
- backward compatibility,
- integration payload,
- database fetch plan,
- event schema,
- migration Java version,
- generated code,
- framework configuration,
- review standard,
- operational debugging.

Karena itu, mapping tidak cukup hanya “benar secara code”. Mapping harus **governed**.

---

## 1. Core Thesis

> Mapping governance adalah seperangkat keputusan eksplisit tentang bagaimana object berubah bentuk antar boundary, siapa pemilik perubahan itu, bagaimana perubahan direview, bagaimana compatibility dijaga, dan bagaimana failure dicegah sebelum masuk production.

Tanpa governance, mapping layer biasanya membusuk menjadi:

- mapper tersebar di banyak layer,
- DTO dipakai lintas boundary tanpa ownership,
- `ObjectMapper` global berubah diam-diam,
- `@Data` dipakai di entity dan DTO sensitif,
- MapStruct silent-ignore field penting,
- API response berubah karena rename field Java,
- null handling tidak konsisten,
- event payload breaking consumer,
- sensitive field bocor lewat serialization,
- mapper menjadi tempat business logic tersembunyi,
- review hanya melihat “compile pass”, bukan semantic contract.

Governance yang baik bukan birokrasi berlebihan. Governance yang baik adalah **guardrail** agar engineer tetap cepat tetapi tidak merusak contract.

---

## 2. Kenapa Mapping Butuh Governance?

### 2.1 Mapping adalah tempat sistem kehilangan makna

Contoh sederhana:

```java
record CaseDto(
    String status,
    String officerName,
    String applicantName,
    LocalDateTime submittedAt
) {}
```

Field terlihat biasa. Tetapi secara semantic:

- `status` mungkin external display status, bukan internal workflow state.
- `officerName` mungkin hanya boleh muncul untuk admin.
- `applicantName` mungkin PII.
- `submittedAt` mungkin perlu timezone normalization.

Jika mapping hanya dianggap copy field, maka reviewer bisa melewatkan pertanyaan penting:

- Status ini source-nya dari state machine atau derived label?
- Nama officer boleh keluar ke public API?
- Applicant name perlu masking?
- Timezone-nya UTC, local agency time, atau client time?

Governance memaksa pertanyaan itu muncul secara sistematis.

---

### 2.2 Mapping adalah API compatibility surface

Perubahan kecil di DTO Java bisa menjadi breaking change.

```java
// Before
record ApplicantResponse(String id, String name) {}

// After
record ApplicantResponse(String applicantId, String fullName) {}
```

Secara Java, ini mungkin refactor biasa. Secara API contract, ini breaking.

Bahkan perubahan default/null juga bisa breaking:

```json
// Before
{
  "middleName": null
}
```

```json
// After
{
}
```

Bagi consumer tertentu, `null` dan absent bukan hal yang sama.

Governance harus menjawab:

- field mana contract-stable?
- field mana internal-only?
- perubahan apa yang boleh minor?
- perubahan apa harus major/versioned?
- golden payload mana yang wajib dipertahankan?
- siapa yang approve breaking change?

---

### 2.3 Mapping adalah security boundary

Over-posting terjadi saat input DTO terlalu dekat dengan internal model.

```java
class UpdateUserRequest {
    public String displayName;
    public boolean admin;
    public boolean locked;
}
```

Jika mapper langsung menyalin semua field ke entity:

```java
user.setDisplayName(request.displayName);
user.setAdmin(request.admin);
user.setLocked(request.locked);
```

Maka client bisa mengubah field yang seharusnya bukan haknya.

Governance harus punya prinsip:

> Inbound DTO harus deny-by-default. Field yang tidak boleh diubah oleh actor tertentu tidak boleh ada di request DTO actor tersebut.

---

### 2.4 Mapping adalah audit/legal boundary

Di sistem enforcement/case-management, mapping juga menentukan:

- apa yang tercatat sebagai before/after,
- apakah raw input disimpan,
- apakah normalized value menggantikan raw value,
- apakah redacted value masih bisa diaudit,
- apakah event merepresentasikan fakta atau hanya tampilan UI.

Contoh:

```java
record AddressInput(String postalCode, String block, String street) {}
record NormalizedAddress(String postalCode, String block, String street, String buildingName) {}
```

Jika `postalCode` input `" 123456 "` dinormalisasi menjadi `"123456"`, maka audit mungkin perlu tahu:

- raw value yang dikirim,
- normalized value yang dipakai sistem,
- source enrichment jika `buildingName` didapat dari API eksternal,
- waktu enrichment,
- fallback jika enrichment gagal.

Governance harus menjelaskan field mana yang merupakan:

- user asserted value,
- system derived value,
- external enriched value,
- masked/redacted value,
- display-only value.

---

## 3. Governance Bukan Sama dengan Standardisasi Buta

Governance yang buruk:

> “Semua mapping harus pakai MapStruct.”

Governance yang baik:

> “Gunakan MapStruct untuk deterministic structural mapping antar DTO/entity/projection yang jelas. Gunakan manual mapper untuk mapping dengan semantic decision, security filtering, atau complex orchestration. Jangan taruh IO/service call di mapper.”

Governance yang buruk:

> “Semua DTO pakai Lombok `@Data`.”

Governance yang baik:

> “DTO inbound public API harus immutable atau constructor-bound; hindari `@Data`; pakai records di Java modern jika kompatibel; pakai Lombok builder hanya jika shape kompleks dan sudah dites dengan Jackson/MapStruct.”

Governance yang buruk:

> “ObjectMapper global dipakai semua.”

Governance yang baik:

> “Ada mapper profile per boundary: external API strict, internal event stable, legacy integration tolerant, debug/test controlled. Global ObjectMapper tidak boleh dimutasi setelah bootstrap.”

---

## 4. Mapping Governance Model

Model governance praktis dapat dibagi menjadi 8 area:

```text
Mapping Governance
├── 1. Boundary Ownership
├── 2. DTO & Model Naming Standard
├── 3. Mapper Placement & Dependency Rule
├── 4. Jackson/ObjectMapper Profile Policy
├── 5. MapStruct Policy
├── 6. Lombok/Records/Builder Policy
├── 7. Compatibility & Versioning Policy
└── 8. Review, Testing, and Operational Diagnostics
```

Kita bahas satu per satu.

---

# 1. Boundary Ownership

## 1.1 Prinsip ownership

Setiap model harus punya boundary owner.

| Model | Owner | Boleh dipakai di | Tidak boleh dipakai di |
|---|---|---|---|
| Request DTO | API adapter/controller | inbound API layer | domain/entity/event langsung |
| Response DTO | API adapter/controller | outbound API layer | persistence/entity layer |
| Command | application layer | use case orchestration | controller sebagai JSON DTO |
| Query model | application/read layer | query use case | mutable update flow |
| Entity | persistence/domain layer | repository/domain internal | public API response langsung |
| Event payload | event producer boundary | messaging/public event contract | request DTO reuse sembarang |
| External API DTO | integration adapter | external client adapter | domain internal |
| Audit DTO | audit subsystem | audit writer/reader | UI DTO langsung tanpa redaction |

Rule sederhana:

> Model yang lahir dari boundary tertentu tidak boleh menjadi universal model.

---

## 1.2 Anti-pattern: shared DTO package

Banyak proyek punya package seperti ini:

```text
com.company.common.dto
├── UserDto.java
├── CaseDto.java
├── AddressDto.java
└── DocumentDto.java
```

Lalu semua layer memakai DTO tersebut:

- controller,
- service,
- repository projection,
- event publisher,
- integration adapter.

Awalnya hemat. Lama-lama menjadi trap.

Masalah:

1. Satu field ditambah untuk UI, ikut muncul di event.
2. Field internal untuk batch ikut terekspos ke API.
3. Perubahan API memaksa perubahan persistence projection.
4. Consumer external bergantung pada field yang sebenarnya internal.
5. DTO tidak punya owner karena semua layer merasa punya.

Governance rule:

```text
Tidak ada "god DTO" lintas boundary.
DTO boleh shared hanya jika memang contract package eksplisit, versioned, dan owner-nya jelas.
```

---

## 1.3 Boundary naming

Gunakan nama yang menunjukkan boundary dan intent.

Buruk:

```java
class CaseDto {}
class UserDto {}
class DocumentDto {}
```

Lebih baik:

```java
record CreateCaseRequest(...) {}
record CaseDetailResponse(...) {}
record CaseSummaryResponse(...) {}
record AssignCaseCommand(...) {}
record CaseSearchCriteria(...) {}
record CaseSearchRow(...) {}
record CaseSubmittedEventV1(...) {}
record ExternalAgencyCasePayload(...) {}
record AuditCaseChangeRecord(...) {}
```

Nama yang baik menjawab:

- dibuat oleh siapa?
- dibaca oleh siapa?
- digunakan untuk command/query/event?
- untuk create/update/detail/list/export?
- public/private/internal/external?
- versioned atau tidak?

---

# 2. DTO & Model Naming Standard

## 2.1 Suffix yang disarankan

| Suffix | Makna | Contoh |
|---|---|---|
| `Request` | Payload inbound API | `CreateApplicationRequest` |
| `Response` | Payload outbound API | `ApplicationDetailResponse` |
| `Command` | Intent application layer | `SubmitApplicationCommand` |
| `Query` / `Criteria` | Query input internal | `ApplicationSearchCriteria` |
| `Row` | Projection tabular/list | `ApplicationSearchRow` |
| `View` | Read model komposit | `ApplicationCaseView` |
| `EventV1` | Event contract versioned | `ApplicationSubmittedEventV1` |
| `Payload` | External/raw integration payload | `OneMapSearchPayload` |
| `Envelope` | Wrapper transport/message | `AgencyMessageEnvelope` |
| `Snapshot` | Immutable state capture | `ApplicationAuditSnapshot` |
| `Patch` | Partial update shape | `UpdateApplicantPatch` |
| `Draft` | Mutable temporary state | `ApplicationDraftResponse` |

---

## 2.2 Hindari suffix yang ambigu

Hindari nama seperti:

```java
UserModel
UserBean
UserData
UserInfo
UserObject
UserVO
UserDO
```

Kecuali organisasi sudah punya definisi formal dan konsisten.

Masalah suffix ambigu:

- tidak menunjukkan direction,
- tidak menunjukkan owner,
- tidak menunjukkan mutability,
- tidak menunjukkan contract stability,
- sering menjadi tempat field campuran.

---

## 2.3 Naming untuk mapping method

Nama method mapper harus menunjukkan direction dan intent.

Buruk:

```java
UserDto map(User user);
User map(UserDto dto);
```

Lebih baik:

```java
UserResponse toResponse(User user);
UserSummaryResponse toSummaryResponse(User user);
CreateUserCommand toCreateCommand(CreateUserRequest request);
UserCreatedEventV1 toUserCreatedEvent(User user);
ExternalUserPayload toExternalPayload(User user);
```

Untuk update:

```java
void applyPatch(UpdateUserPatch patch, @MappingTarget User user);
void replaceFromCommand(ReplaceUserCommand command, @MappingTarget User user);
```

Gunakan kata kerja yang berbeda untuk semantic berbeda:

| Method prefix | Makna |
|---|---|
| `toX` | membuat object baru |
| `fromX` | factory direction dari source tertentu |
| `applyX` | mutate target existing |
| `mergeX` | partial merge dengan null/absent semantics |
| `replaceX` | replacement penuh |
| `redactX` | masking/security transformation |
| `normalizeX` | canonicalization input |
| `projectX` | mengambil subset/read shape |
| `enrichX` | menambah data dari context/reference |

---

# 3. Mapper Placement & Dependency Rule

## 3.1 Layer placement model

Contoh struktur package:

```text
com.example.caseapp
├── domain
│   ├── model
│   └── service
├── application
│   ├── command
│   ├── query
│   └── mapper
├── adapter
│   ├── web
│   │   ├── request
│   │   ├── response
│   │   └── mapper
│   ├── persistence
│   │   ├── entity
│   │   ├── projection
│   │   └── mapper
│   ├── messaging
│   │   ├── event
│   │   └── mapper
│   └── integration
│       ├── client
│       ├── payload
│       └── mapper
└── shared
    └── types
```

Rule:

- Web mapper tahu request/response dan command/query.
- Application mapper tahu command/query dan domain-facing models.
- Persistence mapper tahu entity/projection dan domain/application model.
- Messaging mapper tahu domain/application facts dan event payload.
- Integration mapper tahu external payload dan internal canonical model.

---

## 3.2 Dependency direction

Ideal clean/hexagonal direction:

```text
adapter.web       ──maps──> application.command
adapter.persistence <─maps─ application/domain model
adapter.messaging  <─maps─ application/domain fact
adapter.integration ─maps─> application/domain canonical command
```

Domain sebaiknya tidak bergantung ke:

- Jackson annotation,
- JPA annotation DTO-specific,
- external API payload,
- web request/response,
- Lombok builder shape yang hanya untuk transport.

Exception dapat dibuat, tapi harus sadar konsekuensinya.

---

## 3.3 Mapper tidak boleh menjadi service layer tersembunyi

Mapper boleh melakukan:

- field copy,
- type conversion,
- normalization lokal,
- redaction berdasarkan context sederhana,
- enum/code mapping,
- flatten/unflatten,
- deterministic derived field.

Mapper tidak boleh melakukan:

- database query sembarangan,
- network call,
- authorization decision kompleks,
- workflow transition,
- transaction management,
- event publish,
- retry orchestration,
- side effect.

Contoh buruk:

```java
public CaseResponse toResponse(CaseEntity entity) {
    User officer = userRepository.findById(entity.getOfficerId()).orElseThrow();
    boolean canEdit = authorizationService.canEdit(entity);
    externalStatusClient.refresh(entity.getExternalRef());
    return ...;
}
```

Ini bukan mapper. Ini use case/query assembler dengan IO dan policy.

Lebih baik:

```java
record CaseResponseContext(
    String officerDisplayName,
    boolean canEdit
) {}

public CaseResponse toResponse(CaseEntity entity, CaseResponseContext context) {
    return new CaseResponse(
        entity.getCaseNo(),
        entity.getStatus().displayName(),
        context.officerDisplayName(),
        context.canEdit()
    );
}
```

IO/policy dihitung di application/query service. Mapper tetap deterministic.

---

# 4. Jackson/ObjectMapper Profile Policy

## 4.1 Jangan punya satu ObjectMapper global untuk semua semantic

`ObjectMapper` dapat di-share jika sudah dikonfigurasi sebelum digunakan. `ObjectReader` dan `ObjectWriter` dirancang immutable dan ringan untuk reuse. Namun itu tidak berarti semua boundary harus memakai konfigurasi yang sama.

Boundary berbeda membutuhkan strictness berbeda.

| Profile | Use case | Character |
|---|---|---|
| `externalApiMapper` | Public inbound/outbound API | strict, stable, secure |
| `internalApiMapper` | Internal service-to-service | strict but pragmatic |
| `eventMapper` | Message/event payload | stable, version-aware |
| `legacyIntegrationMapper` | Legacy external system | tolerant reader, weird format support |
| `auditMapper` | Audit snapshot/log payload | deterministic, explicit, redacted carefully |
| `testContractMapper` | Golden payload tests | mirrors production contract |
| `debugMapper` | Local debugging only | pretty print allowed, not production contract |

Governance rule:

```text
ObjectMapper configuration is infrastructure contract.
It must not be casually changed by feature code.
```

---

## 4.2 ObjectMapper mutation policy

Disallow mutation after bootstrap.

Buruk:

```java
@Autowired ObjectMapper objectMapper;

public String debug(Object value) {
    objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    return objectMapper.writeValueAsString(value);
}
```

Masalah:

- mengubah global behavior,
- thread-safety assumption rusak,
- semua response bisa berubah formatting,
- test bisa flaky.

Lebih baik:

```java
private final ObjectWriter prettyWriter;

public DebugJsonWriter(ObjectMapper mapper) {
    this.prettyWriter = mapper.writerWithDefaultPrettyPrinter();
}
```

Policy:

```text
Feature code may create ObjectReader/ObjectWriter from approved ObjectMapper.
Feature code may not mutate shared ObjectMapper configuration.
```

---

## 4.3 Strictness policy

Untuk public inbound API:

Rekomendasi default:

```text
Unknown fields: fail or explicitly policy-based.
Missing required fields: fail via validation/constructor policy.
Null for non-null semantic: fail.
Enum unknown value: fail unless tolerant reader required.
Numeric coercion from string: avoid unless integration-specific.
Date format: explicit.
Timezone: explicit.
```

Untuk legacy integration inbound:

```text
Unknown fields: often tolerate.
Weird date/string number: adapter-local conversion.
Enum unknown: map to UNKNOWN only if domain can handle it safely.
Missing field: explicit fallback or reject with partner-specific diagnostics.
```

Yang penting bukan strict atau lenient secara absolut. Yang penting adalah **profile-nya eksplisit**.

---

## 4.4 Annotation policy

Jackson annotation boleh digunakan, tetapi jangan membanjiri domain model.

| Annotation | Umumnya aman di DTO | Hati-hati di domain/entity |
|---|---:|---:|
| `@JsonProperty` | Ya | Hindari kecuali model memang contract model |
| `@JsonInclude` | Ya | Hati-hati karena mempengaruhi contract |
| `@JsonIgnore` | Ya | Berbahaya jika dipakai untuk security sebagai satu-satunya guard |
| `@JsonFormat` | Ya | Hindari format policy tersebar |
| `@JsonCreator` | Ya | Boleh untuk immutable DTO |
| `@JsonAlias` | Ya | Dokumentasikan migration/deprecation |
| `@JsonTypeInfo` | Sangat hati-hati | Hindari di domain publik tanpa policy security |
| custom serializer annotation | Boleh | Review ketat |

Rule:

```text
Jackson annotations belong primarily in transport/contract DTO, not core domain model.
```

---

# 5. MapStruct Policy

MapStruct bagus karena generated code terlihat dan compile-time. Tetapi governance tetap perlu.

## 5.1 Central MapperConfig

Gunakan `@MapperConfig` untuk standard organisasi.

Contoh:

```java
import org.mapstruct.MapperConfig;
import org.mapstruct.ReportingPolicy;
import org.mapstruct.NullValueCheckStrategy;
import org.mapstruct.NullValuePropertyMappingStrategy;

@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    unmappedSourcePolicy = ReportingPolicy.WARN,
    nullValueCheckStrategy = NullValueCheckStrategy.ALWAYS
)
public interface CentralMapperConfig {
}
```

Lalu:

```java
@Mapper(config = CentralMapperConfig.class)
public interface CaseMapper {
    CaseResponse toResponse(Case entity);
}
```

Kenapa `unmappedTargetPolicy = ERROR` sering bagus?

Karena ketika target DTO menambah field, compiler memaksa mapper owner memutuskan:

- field diisi dari mana?
- di-ignore sengaja?
- deprecated?
- redacted?
- default?

Ini mencegah silent field loss.

---

## 5.2 Ignore harus eksplisit dan beralasan

Buruk:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.IGNORE)
interface UserMapper {}
```

Ini mematikan alarm.

Lebih baik:

```java
@Mapper(config = CentralMapperConfig.class)
interface UserMapper {

    @Mapping(target = "internalRiskScore", ignore = true) // not exposed to public API
    @Mapping(target = "adminNotes", ignore = true)       // role-specific endpoint only
    UserResponse toPublicResponse(User user);
}
```

Tetapi komentar saja tidak cukup dalam sistem besar. Bisa lebih baik dengan method terpisah:

```java
UserPublicResponse toPublicResponse(User user);
UserAdminResponse toAdminResponse(User user);
```

Jika field sering di-ignore karena endpoint tertentu tidak boleh melihatnya, kemungkinan DTO-nya salah.

---

## 5.3 MapStruct expression policy

MapStruct `expression = "java(...)"` powerful tetapi mudah menjadi hidden logic.

Acceptable:

```java
@Mapping(target = "displayName", expression = "java(user.getFirstName() + \" \" + user.getLastName())")
```

Better jika reusable:

```java
@Mapping(target = "displayName", source = "user", qualifiedByName = "displayName")
```

Dengan helper:

```java
@Named("displayName")
default String displayName(User user) {
    return Stream.of(user.getFirstName(), user.getLastName())
        .filter(Objects::nonNull)
        .collect(Collectors.joining(" "));
}
```

Policy:

```text
Use expression only for trivial deterministic conversion.
For reusable or policy-bearing conversion, use named method/qualifier.
For IO/business decision, do not use mapper expression.
```

---

## 5.4 `@Context` policy

`@Context` bagus untuk membawa mapping context:

- actor role,
- locale,
- timezone,
- redaction policy,
- reference lookup map yang sudah preloaded,
- cycle avoidance context,
- audit metadata.

Contoh:

```java
record MappingContext(
    ZoneId zoneId,
    Locale locale,
    RedactionPolicy redactionPolicy
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
interface CaseResponseMapper {
    CaseResponse toResponse(CaseEntity entity, @Context MappingContext context);
}
```

Policy:

```text
Context may carry already-computed data or deterministic policy.
Context must not become a service locator for arbitrary repositories/clients.
```

---

## 5.5 Generated code review policy

Generated code tidak perlu direview setiap PR secara manual penuh. Tetapi harus bisa diinspeksi saat:

- mapper baru dibuat,
- null strategy berubah,
- update mapping `@MappingTarget` dibuat,
- collection mapping kompleks,
- lifecycle hook/object factory dipakai,
- Lombok builder/record interaction bermasalah,
- performance bug dicurigai.

Checklist saat inspeksi generated code:

```text
[ ] Apakah source null menghasilkan target null atau empty object sesuai contract?
[ ] Apakah nested null dicek aman?
[ ] Apakah collection dimap dengan copy baru atau reuse reference?
[ ] Apakah field sensitif tidak ter-copy?
[ ] Apakah enum default aman?
[ ] Apakah update mapping menghapus field yang tidak dikirim?
[ ] Apakah builder dipanggil sesuai expectation?
[ ] Apakah ada unintended database lazy load trigger?
```

---

# 6. Lombok / Records / Builder Policy

## 6.1 Lombok harus allowlist, bukan bebas

Contoh policy matang:

| Lombok annotation | Status | Catatan |
|---|---|---|
| `@Getter` | Allowed | Aman untuk kebanyakan DTO/entity |
| `@Setter` | Limited | Hindari di immutable DTO; hati-hati entity invariant |
| `@RequiredArgsConstructor` | Allowed | Bagus untuk dependency injection |
| `@Builder` | Allowed with tests | Pastikan Jackson/MapStruct compatibility |
| `@Jacksonized` | Allowed with tests | Untuk Jackson builder deserialization |
| `@Value` | Allowed | Bisa diganti records di Java modern |
| `@With` | Allowed | Useful untuk immutable transformation |
| `@Data` | Discouraged / banned | Terlalu banyak behavior sekaligus |
| `@EqualsAndHashCode` | Limited | Sangat hati-hati di entity/inheritance |
| `@ToString` | Limited | Hindari sensitive data dan lazy-loading relationship |
| `@SneakyThrows` | Banned | Merusak explicit error boundary |
| `@Cleanup` | Discouraged | Prefer try-with-resources |
| experimental annotations | Banned unless approved | Version/tooling risk |

Lombok memiliki `lombok.config` yang bisa mengatur behavior dan bahkan menandai penggunaan feature tertentu sebagai warning/error. Ini berguna untuk menjadikan policy enforceable.

---

## 6.2 Contoh `lombok.config`

```properties
config.stopBubbling = true

# Make generated code visible to tools where supported
lombok.addLombokGeneratedAnnotation = true

# Discourage broad annotations
lombok.data.flagUsage = error
lombok.sneakyThrows.flagUsage = error
lombok.experimental.flagUsage = warning

# Prefer explicit equals/hashCode consideration
lombok.equalsAndHashCode.callSuper = warn
```

Catatan: opsi dapat berubah antar versi Lombok. Policy harus divalidasi terhadap versi Lombok yang dipakai build.

---

## 6.3 Records policy

Untuk Java 16+ dan terutama Java 21/25, records sering lebih baik untuk DTO immutable.

Use records untuk:

- request DTO sederhana,
- response DTO sederhana,
- event payload immutable,
- projection immutable,
- command object,
- value-style object tanpa identity.

Hindari records untuk:

- JPA entity,
- object dengan lifecycle mutable panjang,
- object yang butuh banyak optional field dan readability constructor buruk,
- API yang masih harus kompatibel dengan library lama yang belum support records,
- framework lama Java 8 baseline.

Contoh:

```java
public record CaseSummaryResponse(
    String caseNo,
    String status,
    String applicantName,
    Instant submittedAt
) {}
```

Policy:

```text
For Java 21+ DTOs, prefer records unless builder/readability/framework constraints justify class-based DTO.
```

---

## 6.4 Builder policy

Builder cocok untuk:

- banyak optional fields,
- test data builder,
- complex response composition,
- immutable class sebelum records cocok,
- backward-compatible construction saat constructor terlalu panjang.

Builder kurang cocok untuk:

- simple 2-4 field DTO,
- request DTO yang harus fail-fast required constructor,
- entity mutable,
- object dengan invariant yang mudah dilewati builder.

Rule:

```text
Builder is a readability tool, not a substitute for invariant enforcement.
```

---

# 7. Compatibility & Versioning Policy

## 7.1 Kategori perubahan mapping

| Change | Bias compatibility | Catatan |
|---|---|---|
| Tambah optional response field | Biasanya non-breaking | Consumer robust harus ignore unknown |
| Tambah required request field | Breaking | Client lama gagal |
| Rename response field | Breaking | Kecuali alias/dual-write sementara |
| Remove response field | Breaking | Kecuali deprecated dan usage nol |
| Change field type | Breaking | String ke number tetap breaking |
| Change enum values | Potentially breaking | Unknown enum bisa crash consumer |
| Change null to absent | Potentially breaking | Tergantung consumer/schema |
| Change absent to null | Potentially breaking | Contract berubah |
| Change date format | Breaking | Sangat sensitif |
| Change timezone meaning | Breaking/semantic bug | Bisa tidak terlihat di schema |
| Add stricter validation | Potentially breaking | Request yang dulu diterima kini ditolak |
| Redact existing field | Potentially breaking | Bisa benar secara security tetapi perlu komunikasi |

---

## 7.2 API compatibility policy

Gunakan prinsip:

```text
Be conservative in what you emit.
Be explicit in what you accept.
Be version-aware in what you preserve.
```

Untuk public API:

- jangan rename field tanpa migration window,
- jangan ubah type tanpa versioning,
- jangan ubah enum semantics diam-diam,
- jangan ubah date/time format tanpa major/versioned change,
- jangan rely pada Java field name sebagai contract tanpa `@JsonProperty`,
- golden payload test wajib untuk response penting,
- contract test wajib untuk request penting.

---

## 7.3 Event compatibility policy

Event lebih sulit dari API sinkron karena consumer mungkin tidak diketahui lengkap.

Event rule:

```text
Event payload is append-only by default.
Never reuse field name with changed meaning.
Version event type or payload when semantic changes.
```

Contoh:

```java
record CaseSubmittedEventV1(
    String caseId,
    String submittedBy,
    Instant submittedAt
) {}
```

Jika `submittedBy` berubah dari username menjadi user UUID, jangan diam-diam ubah isi field.

Lebih baik:

```java
record CaseSubmittedEventV2(
    String caseId,
    String submittedByUserId,
    String submittedByDisplayName,
    Instant submittedAt
) {}
```

Atau tambahkan field baru sementara di V1 jika masih compatible:

```json
{
  "caseId": "C-001",
  "submittedBy": "john.doe",
  "submittedByUserId": "user-123"
}
```

---

## 7.4 Deprecation policy

Field deprecated harus punya lifecycle.

```java
public record ApplicantResponse(
    String applicantId,

    /**
     * @deprecated Use fullName instead. To be removed after 2027-01-01.
     */
    @Deprecated
    String name,

    String fullName
) {}
```

Policy minimal:

```text
Deprecated field must include replacement, reason, earliest removal date, and consumer migration note.
```

Untuk OpenAPI:

```yaml
name:
  type: string
  deprecated: true
  description: "Use fullName. Planned removal after 2027-01-01."
fullName:
  type: string
```

---

## 7.5 Dual-read / dual-write migration

Untuk rename field:

Inbound request:

```java
record UpdateApplicantRequest(
    @JsonAlias("name")
    String fullName
) {}
```

Outbound response sementara:

```java
record ApplicantResponse(
    String name,
    String fullName
) {}
```

Migration phases:

```text
Phase 1: Add new field, keep old field.
Phase 2: Accept both inbound old/new, emit both outbound.
Phase 3: Communicate deprecation and monitor usage.
Phase 4: Stop emitting old field for opted-in version.
Phase 5: Remove old field in major/versioned release.
```

---

# 8. Review Policy

## 8.1 PR checklist untuk mapping change

Setiap PR yang mengubah DTO/mapper/ObjectMapper harus menjawab:

```text
Boundary & Ownership
[ ] Model ini milik boundary mana?
[ ] Apakah DTO ini dipakai lintas boundary?
[ ] Apakah ada god DTO/shared DTO yang makin membesar?

Contract Compatibility
[ ] Apakah JSON/XML shape berubah?
[ ] Apakah OpenAPI/schema diperbarui?
[ ] Apakah golden payload test diperbarui?
[ ] Apakah perubahan ini backward compatible?
[ ] Jika breaking, apakah ada versioning/migration note?

Security & Privacy
[ ] Apakah field sensitif bisa bocor?
[ ] Apakah inbound DTO membuka over-posting?
[ ] Apakah redaction/masking konsisten?
[ ] Apakah error/log aman dari PII/secret?

Mapping Correctness
[ ] Apakah null vs absent semantics jelas?
[ ] Apakah default value explicit?
[ ] Apakah enum unknown behavior jelas?
[ ] Apakah timezone/date format explicit?
[ ] Apakah nested/collection mapping aman?

Persistence
[ ] Apakah mapping memicu lazy loading/N+1?
[ ] Apakah entity diekspos langsung?
[ ] Apakah update mapping merusak dirty checking/audit?

Generated Code
[ ] Jika MapStruct/Lombok, apakah generated behavior sudah diverifikasi?
[ ] Apakah annotation processor config stabil di build/IDE?

Operational
[ ] Jika mapping gagal, apakah error diagnosable?
[ ] Apakah field path/correlation id tersedia?
[ ] Apakah payload failure bisa direplay secara aman?
```

---

## 8.2 Red flag saat review

Waspadai:

```java
BeanUtils.copyProperties(source, target);
```

```java
objectMapper.convertValue(request, Entity.class);
```

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.IGNORE)
```

```java
@Data
@Entity
class UserEntity { ... }
```

```java
@JsonIgnore
private boolean admin;
```

sebagai satu-satunya security protection.

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
```

untuk public input.

```java
public Map<String, Object> payload;
```

tanpa schema/policy.

```java
catch (Exception e) {
    log.error("Failed payload: {}", rawJson, e);
}
```

untuk payload sensitif.

---

## 8.3 Green flag saat review

Cari hal-hal ini:

- DTO boundary-specific,
- mapper method direction jelas,
- `@Mapping` explicit untuk field penting,
- strict `unmappedTargetPolicy`,
- ObjectMapper profile jelas,
- null/absent semantics dites,
- golden payload test ada,
- sensitive field redaction dites,
- generated mapper code dipahami untuk case kompleks,
- schema/OpenAPI sinkron,
- migration/deprecation note jelas.

---

# 9. Testing Governance

## 9.1 Test pyramid untuk mapping

```text
Mapping Test Pyramid
├── Unit mapper tests
├── Serialization/deserialization tests
├── Golden payload tests
├── Contract/schema tests
├── Compatibility regression tests
├── Integration adapter tests
└── End-to-end smoke tests
```

Mapping tidak boleh hanya mengandalkan E2E.

Kenapa?

Karena E2E sering hanya cover happy path. Mapping bug banyak muncul di:

- null,
- absent,
- unknown field,
- enum baru,
- timezone,
- date format,
- nested empty collection,
- sensitive field,
- backward compatibility.

---

## 9.2 Required tests per change type

| Change type | Required tests |
|---|---|
| New request DTO | positive + missing/null/unknown tests |
| New response DTO | golden payload test |
| Mapper update | unit test for field semantics |
| Event payload change | compatibility test V1/V2 |
| ObjectMapper config change | regression suite all critical payloads |
| Lombok builder/Jackson DTO | deserialize test |
| MapStruct update mapping | patch/null/absent overwrite test |
| Sensitive field mapping | redaction/non-leak test |
| External integration payload | tolerant/strict partner sample tests |

---

## 9.3 Golden payload ownership

Golden payload bukan snapshot sembarangan.

Policy:

```text
Golden payload is contract artifact.
Changing it requires intentional review.
```

Struktur:

```text
src/test/resources/contracts
├── public-api
│   ├── case-detail-response.v1.json
│   └── create-case-request.valid.v1.json
├── events
│   ├── case-submitted.v1.json
│   └── case-submitted.v2.json
└── integration
    ├── partner-x-response.success.xml
    └── partner-x-response.partial.xml
```

---

# 10. Security Governance

## 10.1 Deny-by-default DTO

Inbound DTO harus hanya berisi field yang boleh dikirim actor.

Buruk:

```java
record UpdateUserRequest(
    String displayName,
    boolean admin,
    boolean locked,
    Set<String> roles
) {}
```

Lebih baik:

```java
record SelfUpdateProfileRequest(
    String displayName,
    String phoneNumber
) {}

record AdminUpdateUserRequest(
    boolean locked,
    Set<String> roles
) {}
```

Rule:

```text
Different actors/use cases deserve different request DTOs.
```

---

## 10.2 Sensitive field classification

Setiap field sensitif harus diklasifikasi.

| Classification | Example | Mapping policy |
|---|---|---|
| Secret | password, token, API key | never serialize/log |
| PII | name, email, phone, ID number | role-based exposure/masking |
| Internal operational | risk score, officer note | internal/admin only |
| Audit-sensitive | enforcement decision reason | immutable, controlled access |
| Security state | locked, roles, permissions | no public inbound write |

DTO review harus mempertanyakan field classification.

---

## 10.3 Redaction strategy

Redaction tidak boleh tersebar sembarangan.

Buruk:

```java
response.setEmail(user.getEmail().replaceAll(".*@", "***@"));
```

di banyak mapper.

Lebih baik:

```java
interface Redactor {
    String email(String raw);
    String phone(String raw);
    String identityNo(String raw);
}
```

Mapper:

```java
@Mapping(target = "email", expression = "java(redactor.email(user.getEmail()))")
UserPublicResponse toPublic(User user, @Context Redactor redactor);
```

Atau lakukan redaction di assembler sebelum mapper jika policy kompleks.

---

# 11. Operational Governance

## 11.1 Mapping error taxonomy

Operational logging harus membedakan:

| Error | Meaning | Example response |
|---|---|---|
| Parse error | invalid JSON/XML syntax | 400 malformed payload |
| Binding error | field cannot bind to Java type | 400 invalid field type |
| Validation error | DTO rule violated | 400 validation error |
| Semantic mapping error | value valid syntactically but invalid domain transition | 422/409 depending context |
| Integration mapping error | partner payload unexpected | 502/failed integration event |
| Internal mapper bug | mapping code inconsistent | 500 + alert |

Jangan semua dijadikan:

```text
500 Internal Server Error
```

atau:

```text
Bad Request
```

tanpa field path.

---

## 11.2 Safe logging policy

Log mapping failure dengan:

- correlation id,
- endpoint/message type,
- field path,
- error category,
- sanitized sample,
- schema/version,
- actor/system id jika aman,
- no raw secret/PII by default.

Contoh:

```json
{
  "event": "mapping_failure",
  "correlationId": "c-123",
  "boundary": "public-api",
  "operation": "CreateCase",
  "payloadVersion": "v1",
  "errorCategory": "BINDING_ERROR",
  "fieldPath": "$.applicant.birthDate",
  "message": "Invalid date format, expected yyyy-MM-dd"
}
```

---

## 11.3 Replay policy

Untuk sistem penting, mapping failure perlu bisa dianalisis.

Tetapi replay raw payload berbahaya jika payload mengandung PII/secret.

Policy opsi:

1. Simpan raw payload terenkripsi dengan retention pendek.
2. Simpan sanitized payload untuk debugging umum.
3. Simpan hash/correlation untuk traceability.
4. Simpan partner sample di secure test fixture setelah anonymization.
5. DLQ event harus punya redaction/retention policy.

---

# 12. Governance untuk Multi-Module Codebase

## 12.1 Pisahkan module berdasarkan boundary

Contoh Maven/Gradle modules:

```text
case-domain
case-application
case-adapter-web
case-adapter-persistence
case-adapter-messaging
case-adapter-integration-agencyx
case-contract-public-api
case-contract-events
case-test-contracts
```

Manfaat:

- DTO contract bisa versioned,
- mapper dependency lebih jelas,
- domain tidak tergoda import web DTO,
- integration payload tidak bocor ke application,
- generated code/config lebih terkendali.

---

## 12.2 Dependency rule sebagai build check

Gunakan ArchUnit atau build rules untuk melarang dependency tertentu.

Contoh rule konseptual:

```text
domain must not depend on ..adapter.. or com.fasterxml.jackson..
application must not depend on ..adapter.web.response..
web adapter must not expose persistence entity
integration adapter payload must not be used by domain
```

Contoh ArchUnit-style:

```java
noClasses()
    .that().resideInAPackage("..domain..")
    .should().dependOnClassesThat().resideInAnyPackage("..adapter..", "com.fasterxml.jackson..");
```

---

# 13. Governance Decision Records

Mapping decisions yang berdampak panjang sebaiknya ditulis sebagai ADR.

Contoh ADR:

```text
ADR-014: Public API DTOs use records for Java 21 services
ADR-015: MapStruct unmappedTargetPolicy is ERROR by default
ADR-016: Public API ObjectMapper fails on unknown fields
ADR-017: Event payloads are append-only and versioned by type name
ADR-018: Lombok @Data is disallowed in production source
ADR-019: Entity classes must not be serialized directly as API response
ADR-020: External integration payloads are isolated in adapter modules
```

ADR template ringkas:

```markdown
# ADR-XXX — Title

## Status
Accepted / Proposed / Deprecated

## Context
What problem forced this decision?

## Decision
What rule do we adopt?

## Consequences
What becomes easier/harder?

## Migration
How existing code moves toward this rule?

## Exceptions
When can this rule be bypassed and who approves?
```

---

# 14. Policy Examples

## 14.1 Public API DTO policy

```text
1. Public API DTO must be boundary-specific.
2. Public API DTO must not be JPA entity.
3. Public API DTO must have explicit JSON property names for stable contract fields.
4. Request DTO must contain only writable fields for that actor/use case.
5. Response DTO must not expose internal security/audit fields unless explicitly approved.
6. Date/time fields must document timezone and format.
7. Enum changes require compatibility review.
8. Golden payload tests are required for externally consumed responses.
```

---

## 14.2 MapStruct policy

```text
1. All production mappers use CentralMapperConfig.
2. unmappedTargetPolicy defaults to ERROR.
3. Field ignore must be explicit.
4. @MappingTarget update methods require tests for null/absent/overwrite semantics.
5. Expression mappings are limited to trivial deterministic expressions.
6. IO calls are not allowed inside mappers.
7. Generated code must be inspected for complex update/nested/collection mappings.
```

---

## 14.3 Jackson policy

```text
1. Shared ObjectMapper must be fully configured at bootstrap and not mutated afterward.
2. Use boundary-specific mapper profiles where semantics differ.
3. Public inbound API should be strict by default.
4. Legacy integration mapper may be tolerant, but only inside integration adapter.
5. Polymorphic deserialization for public input requires security review.
6. Sensitive field serialization must be deny-by-default.
7. Custom serializer/deserializer must have focused unit tests.
```

---

## 14.4 Lombok policy

```text
1. @Data is disallowed in production source.
2. @SneakyThrows is disallowed.
3. @Getter and @RequiredArgsConstructor are generally allowed.
4. @Builder is allowed for DTOs with tests for Jackson/MapStruct behavior.
5. @EqualsAndHashCode on entities requires explicit review.
6. @ToString must exclude sensitive fields and relationships that may trigger lazy loading.
7. lombok.config must enforce known organization rules where possible.
```

---

## 14.5 Event payload policy

```text
1. Event payloads are immutable and versioned.
2. Existing field meaning must not change.
3. New fields must be additive unless new event version is introduced.
4. Event timestamps use Instant/UTC unless explicitly defined otherwise.
5. Event payloads must not include raw secrets.
6. Consumer compatibility tests must cover old payload versions.
```

---

# 15. Advanced Governance: Mapping Risk Matrix

Gunakan risk matrix untuk menentukan review depth.

| Mapping change | Risk | Review depth |
|---|---:|---|
| Internal DTO field rename with no external exposure | Low | normal PR |
| Public response field addition | Medium | schema + golden payload |
| Public request required field addition | High | versioning/migration review |
| ObjectMapper global config change | Very high | architecture review + regression suite |
| MapStruct null strategy change | High | mapper regression tests |
| Lombok annotation change on entity | High | generated behavior review |
| Event field semantic change | Very high | versioning required |
| Sensitive field added to response | Very high | security/privacy review |
| Integration tolerant parsing change | Medium/high | partner sample regression |

---

# 16. Mapping Governance in Code Review Conversation

Reviewer sebaiknya tidak hanya bertanya:

> “Apakah test pass?”

Tanyakan:

1. Boundary apa yang sedang berubah?
2. Siapa consumer payload ini?
3. Apakah field baru ini additive atau semantic change?
4. Apakah null/absent behavior berubah?
5. Apakah field ini sensitif?
6. Apakah mapper ini bisa memicu lazy load?
7. Apakah generated code sesuai expectation?
8. Apakah ObjectMapper config berubah untuk semua endpoint?
9. Apakah old payload masih bisa dibaca?
10. Apakah golden payload berubah karena disengaja atau kebetulan?

---

# 17. Example: Before and After Governance

## 17.1 Before

```java
@Data
@Entity
class CaseEntity {
    private Long id;
    private String caseNo;
    private String status;
    private String applicantName;
    private String internalNote;
    private BigDecimal riskScore;
}
```

Controller:

```java
@GetMapping("/cases/{id}")
public CaseEntity get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

- entity exposed,
- internal note bocor,
- risk score bocor,
- lazy relationship bisa serialisasi,
- API contract mengikuti entity,
- field rename DB/domain bisa break API,
- no explicit redaction,
- no response ownership.

---

## 17.2 After

Response DTO:

```java
public record CaseDetailResponse(
    String caseNo,
    String status,
    String applicantDisplayName,
    boolean editable
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface CaseResponseMapper {

    @Mapping(target = "applicantDisplayName", source = "applicantName")
    @Mapping(target = "editable", source = "context.editable")
    CaseDetailResponse toDetailResponse(CaseEntity entity, @Context CaseViewContext context);
}
```

Context:

```java
public record CaseViewContext(boolean editable) {}
```

Controller/service flow:

```java
public CaseDetailResponse getCaseDetail(Long id, Actor actor) {
    CaseEntity entity = caseRepository.findDetailById(id).orElseThrow();
    boolean editable = permissionService.canEdit(actor, entity);
    return mapper.toDetailResponse(entity, new CaseViewContext(editable));
}
```

Benefits:

- API response explicit,
- internal fields not exposed,
- permission computed outside mapper,
- mapper deterministic,
- fetch plan controlled,
- response contract testable,
- future domain/entity change can be isolated.

---

# 18. Tooling Enforcement

Governance yang hanya ada di dokumen akan dilanggar.

Minimal enforcement:

| Rule | Enforcement option |
|---|---|
| No entity in controller response | ArchUnit/static analysis |
| No `@Data` | Checkstyle/Error Prone/custom grep/build fail/lombok.config |
| MapStruct policy | Central `@MapperConfig` + compile fail |
| ObjectMapper not mutated | code review + wrapper bean + restricted config package |
| DTO package ownership | module dependency rules |
| Golden payload | CI tests |
| OpenAPI drift | schema diff in CI |
| Sensitive field leak | unit/contract tests |
| No raw payload logs | logging tests/static scan |

---

# 19. Practical Team Standard: Minimal Version

Jika tim belum punya governance, mulai dari 10 rule ini:

```text
1. Never expose JPA entity as public API response.
2. Never bind public request directly into entity.
3. Public API DTO must be boundary-specific.
4. MapStruct unmapped target fields must fail build by default.
5. ObjectMapper shared instances must not be mutated after bootstrap.
6. Lombok @Data is banned in production DTO/entity.
7. Sensitive fields require explicit response DTO decision.
8. Update/PATCH mapping must test null vs absent behavior.
9. Public response must have golden payload tests for important endpoints.
10. Breaking contract changes require versioning or migration plan.
```

Ini sudah mencegah sebagian besar mapping failure kelas enterprise.

---

# 20. Practical Team Standard: Mature Version

Untuk tim mature:

```text
1. Boundary-specific module ownership.
2. Contract DTO package versioning.
3. Central ObjectMapper profiles.
4. Central MapStruct config.
5. Lombok config enforcement.
6. ArchUnit dependency rules.
7. OpenAPI/schema diff CI gate.
8. Golden payload approval workflow.
9. Event compatibility test suite.
10. Sensitive field classification registry.
11. Mapping error taxonomy.
12. Safe replay/DLQ policy.
13. Mapper review checklist in PR template.
14. ADR for mapping-wide decisions.
15. Migration playbook for breaking changes.
```

---

# 21. Mental Model: Mapping Governance as Change Control

Mapping governance bukan tentang membuat developer lambat. Ini tentang menyadari bahwa mapping adalah **change amplifier**.

Satu perubahan kecil:

```java
private String status;
```

menjadi:

```java
private CaseStatus status;
```

bisa mempengaruhi:

- JSON output,
- OpenAPI schema,
- mobile app parsing,
- event consumer,
- database projection,
- audit renderer,
- CSV export,
- admin UI,
- external partner integration.

Governance membuat impact itu terlihat sebelum production.

---

# 22. Checklist Evaluasi Codebase Mapping

Gunakan checklist ini untuk menilai maturity mapping layer.

## 22.1 Boundary clarity

```text
[ ] DTO tidak dipakai lintas banyak boundary tanpa alasan.
[ ] Request dan response model terpisah.
[ ] Event payload versioned.
[ ] External integration payload terisolasi.
[ ] Domain tidak bergantung pada web/integration DTO.
```

## 22.2 Configuration clarity

```text
[ ] ObjectMapper profile jelas.
[ ] Config tidak diubah setelah bootstrap.
[ ] Date/time policy explicit.
[ ] Unknown field policy explicit.
[ ] Null/coercion policy explicit.
```

## 22.3 Mapper quality

```text
[ ] MapStruct central config ada.
[ ] Unmapped target fail/warn sesuai policy.
[ ] Ignore field explicit.
[ ] Update mapping dites.
[ ] Mapper tidak melakukan IO.
```

## 22.4 Lombok/records quality

```text
[ ] Lombok usage punya allowlist.
[ ] @Data tidak dipakai sembarangan.
[ ] @EqualsAndHashCode entity direview.
[ ] Records digunakan untuk DTO modern jika cocok.
[ ] Builder behavior dites dengan Jackson/MapStruct.
```

## 22.5 Contract safety

```text
[ ] Golden payload tests ada.
[ ] OpenAPI/schema sinkron.
[ ] Breaking change punya migration.
[ ] Deprecated field punya replacement/removal plan.
[ ] Event compatibility dites.
```

## 22.6 Security/privacy

```text
[ ] Sensitive field classification ada.
[ ] Inbound DTO deny-by-default.
[ ] Public response tidak expose internal field.
[ ] Logs tidak menyimpan raw sensitive payload.
[ ] Polymorphic deserialization direview ketat.
```

---

# 23. Latihan Desain

## Latihan 1 — Audit DTO leakage

Diberikan DTO:

```java
record UserDto(
    String id,
    String name,
    String email,
    Set<String> roles,
    boolean locked,
    String passwordHash,
    String internalNote
) {}
```

Digunakan untuk:

- GET `/users/{id}` public admin UI,
- PATCH `/users/{id}`,
- event `UserUpdated`,
- CSV export.

Tugas:

1. Pecah menjadi DTO boundary-specific.
2. Tentukan field mana sensitif.
3. Tentukan mapper method.
4. Tentukan tests yang wajib.
5. Tentukan compatibility risk.

---

## Latihan 2 — ObjectMapper profile

Sistem punya:

- public REST API,
- internal REST API,
- Kafka event,
- legacy XML/JSON partner,
- audit snapshot.

Tugas:

1. Rancang profile mapper.
2. Tentukan unknown field policy.
3. Tentukan date/time format.
4. Tentukan enum unknown behavior.
5. Tentukan di mana custom serializer boleh dipakai.

---

## Latihan 3 — MapStruct governance

Sebuah tim memakai:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.IGNORE)
```

karena “biar build tidak ribet”.

Tugas:

1. Jelaskan risiko nyata.
2. Buat migration plan ke `ReportingPolicy.ERROR`.
3. Tentukan exception policy.
4. Buat PR checklist untuk mapper change.

---

## Latihan 4 — Lombok policy

Sebuah codebase Java 21 masih memakai:

```java
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
class CreateCaseRequest { ... }
```

Tugas:

1. Tentukan apakah diganti record atau class immutable.
2. Evaluasi Jackson deserialization behavior.
3. Evaluasi MapStruct builder behavior.
4. Buat policy baru untuk request DTO.

---

# 24. Ringkasan

Mapping governance adalah layer yang membuat mapping engineering bertahan di dunia nyata.

Poin penting:

1. Mapping adalah boundary, bukan copy utility.
2. DTO harus punya owner dan boundary jelas.
3. Mapper placement mengikuti dependency direction.
4. ObjectMapper config adalah infrastructure contract.
5. MapStruct harus dikonfigurasi agar gagal saat contract mapping tidak explicit.
6. Lombok perlu allowlist/denylist agar produktivitas tidak berubah menjadi debt.
7. Compatibility policy harus membedakan additive, breaking, semantic, dan operational changes.
8. Review mapping harus mencakup security, contract, null/absent, persistence, generated code, dan diagnostics.
9. Test mapping harus mencakup golden payload, negative binding, compatibility, event, dan sensitive field.
10. Governance harus enforceable melalui config, build rule, CI, test, dan ADR.

Engineer top-level tidak hanya tahu cara menulis mapper. Ia tahu **bagaimana memastikan seluruh organisasi tidak membuat mapping layer yang diam-diam merusak kontrak, membuka celah security, atau membuat sistem sulit berevolusi**.

---

# 25. Referensi Utama

- MapStruct Reference Guide 1.6.3 — mapper configuration, reporting policy, mapper composition, generated mapping behavior.
- MapStruct API docs — `MapperConfig`, `BeanMapping`, `ReportingPolicy`, unmapped source/target policy.
- FasterXML Jackson documentation/wiki — ObjectMapper/ObjectReader/ObjectWriter lifecycle, immutability, and configuration model.
- Jackson Databind Javadocs — ObjectMapper as factory for ObjectReader/ObjectWriter and configuration lifecycle.
- Project Lombok official documentation — feature list, `lombok.config`, flagging usage as warning/error, delombok, and annotation-specific behavior.
- OpenAPI Specification — API description as formal contract for humans/tools, schema-driven lifecycle, and contract tooling.
- API evolution literature and practice — backward compatibility, versioning, consumer migration, and change impact analysis.

---

# 26. Status Seri

Part ini adalah **Part 33 dari 35**.

Seri belum selesai.

Berikutnya:

**Part 34 — Migration Playbook: Java 8 Legacy to Java 25 Modern Mapping Stack**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./32-integration-mapping-external-api-legacy-payload-anti-corruption-layer.md">⬅️ Part 32 — Integration Mapping: External API, Legacy Payload, Anti-Corruption Layer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./34-migration-playbook-java-8-legacy-to-java-25-modern-mapping-stack.md">Part 34 — Migration Playbook: Java 8 Legacy to Java 25 Modern Mapping Stack ➡️</a>
</div>
