# Part 29 — Testing Strategy: Unit, Golden Payload, Property-Based, Contract Tests

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `29-testing-strategy-unit-golden-payload-property-based-contract-tests.md`  
> Scope: Java 8–25, Jackson, XML/JAXB/Jakarta XML Binding, MapStruct, Lombok/records/builders, DTO/API/event/integration mapping  
> Prasyarat: Part 0–28

---

## 1. Mengapa Testing Mapping Layer Tidak Boleh Dianggap Remeh

Banyak engineer menganggap mapper sebagai kode “sederhana”:

```java
response.setName(entity.getName());
response.setStatus(entity.getStatus());
response.setCreatedAt(entity.getCreatedAt());
```

Masalahnya, dalam sistem nyata, mapping bukan sekadar memindahkan nilai. Mapping adalah tempat sistem mengubah **bentuk**, **makna**, **kontrak**, **visibility**, dan **compatibility** data.

Satu bug mapping bisa menyebabkan:

- field penting hilang dari response;
- field internal bocor ke API publik;
- update PATCH menghapus data karena `null` ditafsirkan sebagai “clear value”;
- enum baru gagal dipahami client lama;
- tanggal berubah timezone;
- precision decimal uang berubah;
- XML signed payload invalid karena canonicalization berubah;
- event schema berubah diam-diam dan consumer downstream gagal;
- audit log tidak lengkap sehingga defensibility sistem turun;
- MapStruct generated code berubah setelah upgrade dependency;
- Lombok builder berubah shape dan Jackson deserialization gagal.

Jadi testing mapping layer harus menjawab pertanyaan yang lebih dalam:

> Apakah transformasi ini mempertahankan semantic contract yang benar, aman, stabil, dan evolvable?

Bukan hanya:

> Apakah field A sama dengan field B?

---

## 2. Mental Model: Apa yang Sebenarnya Kita Test?

Mapping test bukan satu jenis test. Ia terdiri dari beberapa lapisan.

```text
Raw Payload
   |
   | parse / deserialize
   v
Inbound DTO
   |
   | normalize / validate / map
   v
Command / Domain Input
   |
   | domain processing
   v
Entity / Aggregate / Event
   |
   | map / serialize
   v
Outbound Payload
```

Di setiap transisi, jenis bug berbeda.

| Boundary | Risiko utama | Jenis test |
|---|---|---|
| JSON/XML → DTO | parse error, unknown field, null coercion, constructor binding | deserialization tests, negative payload tests |
| DTO → command | semantic loss, weak normalization, invalid default | unit mapper tests |
| entity → response DTO | leakage, lazy load, wrong projection | mapper unit/integration tests |
| object → JSON/XML | contract drift, null/absent mismatch, formatting | golden payload tests |
| event → consumer contract | schema drift, enum breakage | contract compatibility tests |
| mapper generator | generated code surprise | generated mapper tests, compile checks |
| broad input space | edge case not covered by examples | property-based tests |

Top-level engineer tidak hanya menulis “test mapper”. Ia memilih **test type yang sesuai dengan failure mode**.

---

## 3. Prinsip Besar Testing Mapping Layer

### 3.1 Test Behavior, Bukan Implementasi Internal

Mapper bisa manual, MapStruct, Jackson annotation, custom serializer, atau builder-based. Test tidak boleh terlalu bergantung pada cara internal kecuali memang sedang mengunci generated behavior.

Buruk:

```java
assertThat(mapper).isInstanceOf(OrderMapperImpl.class);
```

Lebih baik:

```java
OrderResponse response = mapper.toResponse(order);

assertThat(response.id()).isEqualTo("ORD-001");
assertThat(response.status()).isEqualTo("APPROVED");
assertThat(response.customerName()).isEqualTo("Alice Tan");
```

Kita peduli output contract, bukan apakah mapper memakai setter, constructor, builder, atau generated method.

### 3.2 Test Contract, Bukan Kebetulan Field

Kalau field `status` dipetakan dari enum `OrderStatus.APPROVED` menjadi string `"APPROVED"`, itu bukan sekadar copy. Itu kontrak.

Test harus menyatakan maksud:

```java
@Test
void approvedOrder_shouldExposePublicApprovedStatus() {
    Order order = OrderFixtures.approvedOrder();

    OrderResponse response = mapper.toResponse(order);

    assertThat(response.status()).isEqualTo("APPROVED");
}
```

Bukan:

```java
assertThat(response.status()).isEqualTo(order.getStatus().name());
```

Test kedua terlalu menempel pada implementasi. Kalau nanti mapping status butuh external code table seperti `"A"`, test harus membantu mendeteksi perubahan contract.

### 3.3 Test Negative Cases Sama Pentingnya dengan Happy Path

Mapping layer sering gagal bukan saat input normal, tetapi saat:

- field missing;
- field null;
- field kosong;
- unknown field;
- enum tidak dikenal;
- angka terlalu besar;
- date invalid;
- nested object partial;
- list kosong;
- list sangat besar;
- XML namespace tidak sesuai;
- field read-only dikirim client;
- field internal muncul di payload;
- polymorphic discriminator invalid.

Jika test hanya happy path, mapping layer terasa benar padahal rapuh.

### 3.4 Test Explicit Invariants

Setiap mapper harus punya invariants.

Contoh:

```text
OrderEntity -> OrderResponse:
- response.id selalu berasal dari order.publicId, bukan database numeric id.
- response.internalRemark tidak pernah muncul.
- response.totalAmount tidak boleh kehilangan scale decimal.
- response.items harus preserve order.
- response.status harus memakai public status code.
```

Testing mapper berarti mengunci invariants tersebut.

---

## 4. Test Pyramid untuk Mapping Layer

Mapping test yang sehat tidak hanya satu level.

```text
                    Contract / Compatibility Tests
                 Golden Payload / Snapshot-like Tests
             Serialization / Deserialization Boundary Tests
        Mapper Unit Tests: Manual / MapStruct / Custom Converter
   Compile-Time Checks: MapStruct policy, annotation processor, build fail
```

Urutannya:

1. compile-time checks mencegah class bug tertentu masuk;
2. unit mapper tests memastikan transformasi object benar;
3. serialization/deserialization tests memastikan runtime binding sesuai;
4. golden payload tests mengunci bentuk payload;
5. contract tests memastikan producer/consumer tetap compatible.

---

## 5. Mapper Unit Test: Baseline yang Wajib Ada

Mapper unit test cocok untuk:

- manual mapper;
- MapStruct mapper;
- custom converter;
- enum translator;
- domain-to-response projection;
- DTO-to-command conversion;
- update mapper.

### 5.1 Contoh Domain

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

```java
public class CaseEntity {
    private Long id;
    private String caseNo;
    private CaseStatus status;
    private String applicantName;
    private String applicantNric;
    private BigDecimal feeAmount;
    private Instant submittedAt;
    private String internalRemark;

    // getters/setters omitted
}
```

```java
public record CaseResponse(
    String caseNo,
    String status,
    String applicantName,
    String maskedApplicantNric,
    BigDecimal feeAmount,
    OffsetDateTime submittedAt
) {}
```

Invariant mapping:

```text
- `id` database tidak boleh keluar.
- `caseNo` boleh keluar.
- `status` harus public code.
- `applicantNric` harus masked.
- `internalRemark` tidak boleh keluar.
- `Instant` harus menjadi `OffsetDateTime` di timezone contract.
```

### 5.2 Unit Test Manual Mapper

```java
class CaseResponseMapperTest {

    private final CaseResponseMapper mapper = new CaseResponseMapper(ZoneOffset.UTC);

    @Test
    void toResponse_shouldMapPublicFieldsAndMaskSensitiveData() {
        CaseEntity entity = new CaseEntity();
        entity.setId(1001L);
        entity.setCaseNo("CASE-2026-0001");
        entity.setStatus(CaseStatus.SUBMITTED);
        entity.setApplicantName("Alice Tan");
        entity.setApplicantNric("S1234567A");
        entity.setFeeAmount(new BigDecimal("120.50"));
        entity.setSubmittedAt(Instant.parse("2026-06-17T01:30:00Z"));
        entity.setInternalRemark("High risk applicant");

        CaseResponse response = mapper.toResponse(entity);

        assertThat(response.caseNo()).isEqualTo("CASE-2026-0001");
        assertThat(response.status()).isEqualTo("SUBMITTED");
        assertThat(response.applicantName()).isEqualTo("Alice Tan");
        assertThat(response.maskedApplicantNric()).isEqualTo("S****567A");
        assertThat(response.feeAmount()).isEqualByComparingTo("120.50");
        assertThat(response.submittedAt()).isEqualTo(OffsetDateTime.parse("2026-06-17T01:30:00Z"));
    }
}
```

Yang sengaja tidak dites:

```java
assertThat(response).doesNotHaveFieldOrProperty("internalRemark");
```

Untuk Java record, field tersebut memang tidak ada. Leakage sebaiknya dites di **serialization/golden payload test**, bukan hanya object-level unit test.

---

## 6. Generated Mapper Test: MapStruct

MapStruct menghasilkan implementation saat compile time. Secara resmi MapStruct adalah annotation processor yang menghasilkan mapper type-safe, performant, dependency-free, dan no-reflection style. Karena itu, bug biasanya bukan “runtime reflection salah membaca field”, tetapi:

- mapping implicit yang tidak disadari;
- field baru tidak dimap;
- nested object salah dipilih;
- null strategy salah;
- builder detection salah;
- Lombok/MapStruct processor order bermasalah;
- generated code berubah setelah upgrade.

MapStruct sendiri memiliki dokumentasi testing internal yang menekankan bahwa annotation processor harus dijalankan oleh compiler untuk memvalidasi behavior-nya. Ini menguatkan pentingnya build-level/compile-level test untuk mapper generated. MapStruct Reference Guide 1.6.3 juga memosisikan MapStruct sebagai annotation processor untuk bean mapping type-safe.  

### 6.1 MapStruct Mapper

```java
@Mapper(
    componentModel = "default",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface CaseMapper {

    @Mapping(target = "maskedApplicantNric", source = "applicantNric", qualifiedByName = "maskNric")
    @Mapping(target = "submittedAt", source = "submittedAt", qualifiedByName = "toUtcOffsetDateTime")
    CaseResponse toResponse(CaseEntity entity);

    @Named("maskNric")
    static String maskNric(String nric) {
        if (nric == null || nric.length() < 5) {
            return null;
        }
        return nric.charAt(0) + "****" + nric.substring(nric.length() - 4);
    }

    @Named("toUtcOffsetDateTime")
    static OffsetDateTime toUtcOffsetDateTime(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
```

### 6.2 Test Mapper Output

```java
class CaseMapperTest {

    private final CaseMapper mapper = Mappers.getMapper(CaseMapper.class);

    @Test
    void toResponse_shouldApplyExplicitMappings() {
        CaseEntity entity = CaseEntityFixture.submittedCase();

        CaseResponse response = mapper.toResponse(entity);

        assertThat(response.caseNo()).isEqualTo(entity.getCaseNo());
        assertThat(response.status()).isEqualTo("SUBMITTED");
        assertThat(response.maskedApplicantNric()).isEqualTo("S****567A");
        assertThat(response.submittedAt()).isEqualTo(OffsetDateTime.parse("2026-06-17T01:30:00Z"));
    }
}
```

### 6.3 Jangan Mengandalkan “Generated Code Pasti Benar”

MapStruct membantu compile-time safety, tetapi tidak tahu semantic intent.

MapStruct bisa tahu:

```text
source.fullName -> target.fullName
```

MapStruct tidak tahu:

```text
fullName di external API harus dipotong maksimal 100 karakter.
applicantName harus dinormalisasi Unicode.
internal status UNDER_REVIEW harus tampil sebagai PENDING_REVIEW.
```

Semantic mapping tetap harus dites.

---

## 7. Compile-Time Policy sebagai Test Pertama

Beberapa hal lebih baik dibuat gagal saat compile daripada ditangkap unit test.

### 7.1 `unmappedTargetPolicy = ERROR`

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface OrderMapper {
    OrderResponse toResponse(OrderEntity entity);
}
```

Jika `OrderResponse` ditambah field baru, build gagal sampai mapper diperbarui.

Ini sangat penting untuk response DTO dan event DTO.

### 7.2 Kapan Tidak Memakai ERROR?

Ada kasus projection partial sengaja tidak memetakan semua field.

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface OrderSummaryMapper {
    OrderSummaryResponse toSummary(OrderEntity entity);
}
```

Tetapi `IGNORE` harus lokal dan sadar. Jangan jadikan default global tanpa alasan.

Policy yang sehat:

```text
- Public API response mapper: ERROR
- Event mapper: ERROR
- Internal summary projection: WARN/IGNORE dengan dokumentasi
- Patch/update mapper: explicit ignore per field
```

---

## 8. Testing Update Mapper: PUT, PATCH, Merge, Null Strategy

Update mapper adalah salah satu area paling rawan.

Contoh request:

```java
public record UpdateCaseRequest(
    String applicantName,
    String contactEmail,
    String internalRemark
) {}
```

Entity:

```java
public class CaseEntity {
    private String applicantName;
    private String contactEmail;
    private String internalRemark;
    private Instant updatedAt;
    private String updatedBy;
}
```

### 8.1 PUT Semantics

PUT biasanya berarti replacement untuk resource atau representasi tertentu.

Test:

```java
@Test
void putUpdate_shouldClearNullableFieldsWhenRequestContainsNull() {
    CaseEntity entity = CaseEntityFixture.existingCase();
    UpdateCaseRequest request = new UpdateCaseRequest(
        "Alice Updated",
        null,
        "Reviewed"
    );

    mapper.applyPut(request, entity);

    assertThat(entity.getApplicantName()).isEqualTo("Alice Updated");
    assertThat(entity.getContactEmail()).isNull();
    assertThat(entity.getInternalRemark()).isEqualTo("Reviewed");
}
```

### 8.2 PATCH Semantics

PATCH sering berarti hanya field hadir yang diubah. Tetapi Java record biasa tidak bisa membedakan absent vs null tanpa wrapper khusus.

Buruk:

```java
public record PatchCaseRequest(
    String applicantName,
    String contactEmail
) {}
```

Dengan bentuk ini:

```json
{}
```

Dan:

```json
{ "contactEmail": null }
```

Bisa sama-sama menjadi `contactEmail == null`.

Lebih eksplisit:

```java
public sealed interface PatchField<T> permits Absent, Present {
}

public record Absent<T>() implements PatchField<T> {
}

public record Present<T>(T value) implements PatchField<T> {
}
```

Atau memakai JSON Merge Patch/JsonNode di boundary.

Test harus mengunci semantics:

```java
@Test
void patchUpdate_shouldNotModifyFieldWhenFieldIsAbsent() {
    CaseEntity entity = CaseEntityFixture.existingCase();

    PatchCaseRequest request = new PatchCaseRequest(
        new Present<>("Alice Updated"),
        new Absent<>()
    );

    mapper.applyPatch(request, entity);

    assertThat(entity.getApplicantName()).isEqualTo("Alice Updated");
    assertThat(entity.getContactEmail()).isEqualTo("alice@example.com");
}
```

```java
@Test
void patchUpdate_shouldClearFieldWhenFieldIsPresentWithNull() {
    CaseEntity entity = CaseEntityFixture.existingCase();

    PatchCaseRequest request = new PatchCaseRequest(
        new Absent<>(),
        new Present<>(null)
    );

    mapper.applyPatch(request, entity);

    assertThat(entity.getApplicantName()).isEqualTo("Alice Tan");
    assertThat(entity.getContactEmail()).isNull();
}
```

### 8.3 Audit Fields Harus Dilindungi

Test:

```java
@Test
void patchUpdate_shouldNotOverwriteAuditFieldsFromClientPayload() {
    CaseEntity entity = CaseEntityFixture.existingCase();
    Instant originalCreatedAt = entity.getCreatedAt();
    String originalCreatedBy = entity.getCreatedBy();

    MaliciousPatchCaseRequest request = new MaliciousPatchCaseRequest(
        "Alice Updated",
        Instant.parse("1999-01-01T00:00:00Z"),
        "attacker"
    );

    mapper.applyPatch(request, entity);

    assertThat(entity.getCreatedAt()).isEqualTo(originalCreatedAt);
    assertThat(entity.getCreatedBy()).isEqualTo(originalCreatedBy);
}
```

Jika client DTO punya audit fields, desain DTO-nya sudah mencurigakan.

---

## 9. Serialization Tests: Object → JSON

Mapper object-level belum cukup. Kita perlu memastikan bentuk JSON aktual sesuai kontrak.

### 9.1 Kenapa Object-Level Test Tidak Cukup?

Object-level test bisa lulus, tetapi JSON salah karena:

- naming strategy berubah `caseNo` → `case_no`;
- `@JsonInclude` menghilangkan field null;
- `@JsonIgnore` salah tempat;
- custom serializer aktif global;
- date format berubah;
- enum serialized sebagai object;
- BigDecimal scientific notation;
- Lombok getter menghasilkan property tambahan;
- boolean getter ambigu `isActive` vs `getActive`.

### 9.2 Contoh Serialization Test

```java
class CaseResponseJsonTest {

    private final ObjectMapper objectMapper = ObjectMapperFactory.publicApiMapper();

    @Test
    void caseResponse_shouldSerializeToPublicApiContract() throws Exception {
        CaseResponse response = new CaseResponse(
            "CASE-2026-0001",
            "SUBMITTED",
            "Alice Tan",
            "S****567A",
            new BigDecimal("120.50"),
            OffsetDateTime.parse("2026-06-17T01:30:00Z")
        );

        String json = objectMapper.writeValueAsString(response);

        assertThatJson(json).isEqualTo("""
            {
              "caseNo": "CASE-2026-0001",
              "status": "SUBMITTED",
              "applicantName": "Alice Tan",
              "maskedApplicantNric": "S****567A",
              "feeAmount": 120.50,
              "submittedAt": "2026-06-17T01:30:00Z"
            }
            """);
    }
}
```

Dengan JSONAssert:

```java
JSONAssert.assertEquals(expectedJson, actualJson, true);
```

JSONAssert menyediakan assertion untuk JSON dan memiliki mode strict dan non-strict. Mode non-strict berguna saat urutan field tidak penting atau response boleh memiliki field tambahan, tetapi untuk public API critical contract sering kali strict lebih tepat.

### 9.3 Strict vs Non-Strict

| Mode | Cocok untuk | Risiko |
|---|---|---|
| Strict | public API contract, event payload, security-sensitive response | test lebih mudah gagal karena perubahan kecil |
| Non-strict | partial assertion, response extensibility, test yang tidak peduli urutan | bisa melewatkan field tambahan yang seharusnya tidak boleh ada |

Untuk response publik yang berisiko leakage, gunakan strict atau assert field denylist.

---

## 10. Deserialization Tests: JSON → Object

Inbound lebih berbahaya karena input berasal dari luar.

### 10.1 Test Valid Payload

```java
@Test
void createCaseRequest_shouldDeserializeValidPayload() throws Exception {
    String json = """
        {
          "applicantName": "Alice Tan",
          "contactEmail": "alice@example.com",
          "applicationType": "NEW"
        }
        """;

    CreateCaseRequest request = objectMapper.readValue(json, CreateCaseRequest.class);

    assertThat(request.applicantName()).isEqualTo("Alice Tan");
    assertThat(request.contactEmail()).isEqualTo("alice@example.com");
    assertThat(request.applicationType()).isEqualTo(ApplicationType.NEW);
}
```

### 10.2 Test Unknown Field

Jika API strict:

```java
@Test
void createCaseRequest_shouldRejectUnknownFields() {
    String json = """
        {
          "applicantName": "Alice Tan",
          "contactEmail": "alice@example.com",
          "applicationType": "NEW",
          "isAdmin": true
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, CreateCaseRequest.class))
        .isInstanceOf(UnrecognizedPropertyException.class);
}
```

Jika API tolerant-reader untuk integration inbound, test sebaliknya:

```java
@Test
void partnerPayload_shouldIgnoreUnknownFieldsForForwardCompatibility() throws Exception {
    String json = """
        {
          "partnerCaseId": "P-1001",
          "status": "ACCEPTED",
          "newFutureField": "ignored"
        }
        """;

    PartnerCasePayload payload = tolerantMapper.readValue(json, PartnerCasePayload.class);

    assertThat(payload.partnerCaseId()).isEqualTo("P-1001");
}
```

Yang penting bukan strict atau lenient secara absolut. Yang penting semantics-nya sadar dan dites.

### 10.3 Test Missing Required Field

Jackson `required = true` tidak selalu cukup untuk semua kombinasi constructor/binding/validation. Test runtime behavior aktual.

```java
@Test
void createCaseRequest_shouldRejectMissingApplicantName() {
    String json = """
        {
          "contactEmail": "alice@example.com",
          "applicationType": "NEW"
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, CreateCaseRequest.class))
        .isInstanceOf(JsonMappingException.class);
}
```

Jika missing boleh deserialize lalu divalidasi oleh Bean Validation, test di validation layer:

```java
@Test
void createCaseRequest_shouldFailValidationWhenApplicantNameMissing() throws Exception {
    CreateCaseRequest request = objectMapper.readValue("""
        {
          "contactEmail": "alice@example.com",
          "applicationType": "NEW"
        }
        """, CreateCaseRequest.class);

    Set<ConstraintViolation<CreateCaseRequest>> violations = validator.validate(request);

    assertThat(violations)
        .extracting(v -> v.getPropertyPath().toString())
        .contains("applicantName");
}
```

### 10.4 Test Null Coercion

```java
@Test
void createCaseRequest_shouldRejectNullApplicationType() {
    String json = """
        {
          "applicantName": "Alice Tan",
          "contactEmail": "alice@example.com",
          "applicationType": null
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, CreateCaseRequest.class))
        .isInstanceOf(JsonMappingException.class);
}
```

### 10.5 Test Enum Unknown Value

```java
@Test
void createCaseRequest_shouldRejectUnknownApplicationType() {
    String json = """
        {
          "applicantName": "Alice Tan",
          "contactEmail": "alice@example.com",
          "applicationType": "FUTURE_TYPE"
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, CreateCaseRequest.class))
        .isInstanceOf(InvalidFormatException.class);
}
```

Atau jika contract memilih fallback:

```java
@Test
void partnerPayload_shouldMapUnknownStatusToUnknownForForwardCompatibility() throws Exception {
    String json = """
        { "partnerCaseId": "P-1001", "status": "FUTURE_STATUS" }
        """;

    PartnerCasePayload payload = tolerantMapper.readValue(json, PartnerCasePayload.class);

    assertThat(payload.status()).isEqualTo(PartnerStatus.UNKNOWN);
}
```

---

## 11. Golden Payload Tests

Golden payload test adalah test yang membandingkan output aktual dengan payload referensi yang disimpan.

Contoh struktur:

```text
src/test/resources/golden/case-response/submitted-case.v1.json
src/test/resources/golden/case-response/approved-case.v1.json
src/test/resources/golden/events/case-submitted.v1.json
src/test/resources/golden/xml/partner-request.v1.xml
```

### 11.1 Kapan Golden Payload Cocok?

Golden payload cocok untuk:

- public API response penting;
- event payload;
- external partner request/response;
- XML integration;
- audit/export/report payload;
- migration compatibility;
- serialization shape dengan banyak field.

Tidak cocok untuk:

- mapper kecil 3 field yang mudah dites eksplisit;
- payload sangat volatile;
- output yang mengandung timestamp/random value tanpa normalization;
- test yang hanya mengejar coverage.

### 11.2 Contoh Golden JSON Test

```java
@Test
void submittedCaseResponse_shouldMatchGoldenPayload() throws Exception {
    CaseResponse response = CaseResponseFixture.submittedCaseResponse();

    String actualJson = objectMapper.writerWithDefaultPrettyPrinter()
        .writeValueAsString(response);

    String expectedJson = Files.readString(Path.of(
        "src/test/resources/golden/case-response/submitted-case.v1.json"
    ));

    JSONAssert.assertEquals(expectedJson, actualJson, true);
}
```

Golden file:

```json
{
  "caseNo": "CASE-2026-0001",
  "status": "SUBMITTED",
  "applicantName": "Alice Tan",
  "maskedApplicantNric": "S****567A",
  "feeAmount": 120.50,
  "submittedAt": "2026-06-17T01:30:00Z"
}
```

### 11.3 Golden Test Anti-Pattern

Buruk:

```text
Test gagal -> developer langsung overwrite golden file -> commit.
```

Golden payload harus diperlakukan seperti contract artifact. Perubahan golden file perlu review:

```text
- Field apa yang berubah?
- Apakah perubahan backward-compatible?
- Siapa consumer-nya?
- Apakah API documentation ikut berubah?
- Apakah migration/deprecation dibutuhkan?
- Apakah security exposure berubah?
```

### 11.4 Golden Payload Review Checklist

Saat golden file berubah, review minimal:

```text
[ ] Field baru tidak membocorkan data internal.
[ ] Field yang hilang memang deprecated/removed sesuai policy.
[ ] Null vs absent sesuai contract.
[ ] Date/time format tidak berubah tanpa sengaja.
[ ] Decimal precision tidak berubah.
[ ] Enum value tetap compatible.
[ ] Naming strategy tidak berubah.
[ ] Ordering penting untuk XML/signature tidak berubah.
[ ] Version marker benar.
[ ] Consumer downstream sudah diketahui.
```

---

## 12. Snapshot Testing vs Golden Payload

Snapshot testing sering berarti test framework otomatis menyimpan output dan membandingkan dengan snapshot sebelumnya.

Golden payload lebih manual dan disengaja.

| Aspek | Snapshot | Golden payload |
|---|---|---|
| Update | sering otomatis | manual/reviewed |
| Cocok untuk | UI-ish output, banyak struktur | API/event/integration contract |
| Risiko | mudah approve perubahan tanpa pikir | maintenance lebih berat |
| Discipline | bergantung workflow | explicit contract review |

Untuk enterprise API/event/XML mapping, golden payload lebih aman karena memaksa review sadar.

---

## 13. Round-Trip Testing

Round-trip test memastikan object bisa serialize lalu deserialize kembali.

```java
@Test
void caseResponse_shouldRoundTrip() throws Exception {
    CaseResponse original = CaseResponseFixture.submittedCaseResponse();

    String json = objectMapper.writeValueAsString(original);
    CaseResponse restored = objectMapper.readValue(json, CaseResponse.class);

    assertThat(restored).isEqualTo(original);
}
```

### 13.1 Kapan Round-Trip Berguna?

Berguna untuk:

- internal DTO;
- cache payload;
- message payload yang producer dan consumer memakai model sama;
- immutable DTO/record constructor binding;
- custom serializer/deserializer pair.

### 13.2 Kapan Round-Trip Menyesatkan?

Round-trip bisa lulus padahal contract salah.

Contoh:

```java
@JsonFormat(pattern = "dd/MM/yyyy")
private LocalDate date;
```

Serialize `2026-06-17` menjadi `17/06/2026`, lalu deserialize kembali sukses. Tetapi external contract mungkin mengharuskan ISO `2026-06-17`.

Jadi round-trip tidak menggantikan golden payload.

Round-trip hanya menjawab:

> Apakah serializer dan deserializer kita konsisten satu sama lain?

Bukan:

> Apakah payload sesuai kontrak eksternal?

---

## 14. Property-Based Testing untuk Mapper

Property-based testing menghasilkan banyak input berdasarkan property/invariant yang kita definisikan.

Library JVM yang populer salah satunya jqwik. Dokumentasi jqwik menyebut tujuan utamanya membawa property-based testing ke JVM, dengan fokus pada Java dan Kotlin.

### 14.1 Kapan Property-Based Testing Cocok?

Cocok untuk mapper yang punya aturan general:

- masking identifier;
- trimming/normalization;
- date conversion;
- money conversion;
- enum fallback;
- pagination metadata;
- flatten/unflatten symmetry;
- collection order preservation;
- idempotent normalization;
- redaction invariants.

Tidak cocok untuk semua mapper. Jika mapping cuma 5 field eksplisit, example-based test cukup.

### 14.2 Contoh Property: Masking Tidak Boleh Membocorkan Full NRIC

```java
class NricMaskingPropertyTest {

    @Property
    void maskedNric_shouldNotExposeFullInput(@ForAll("validNrics") String nric) {
        String masked = NricMasker.mask(nric);

        assertThat(masked).isNotEqualTo(nric);
        assertThat(masked).doesNotContain(nric.substring(1, nric.length() - 4));
    }

    @Provide
    Arbitrary<String> validNrics() {
        Arbitrary<Character> prefix = Arbitraries.of('S', 'T', 'F', 'G');
        Arbitrary<String> digits = Arbitraries.strings()
            .numeric()
            .ofLength(7);
        Arbitrary<Character> suffix = Arbitraries.chars().between('A', 'Z');

        return Combinators.combine(prefix, digits, suffix)
            .as((p, d, s) -> p + d + s);
    }
}
```

Property:

```text
Untuk semua NRIC valid, hasil masking tidak boleh sama dengan input penuh dan tidak boleh mengandung middle digits penuh.
```

### 14.3 Contoh Property: Normalization Idempotent

Normalization seharusnya idempotent:

```text
normalize(normalize(x)) == normalize(x)
```

Test:

```java
@Property
void nameNormalization_shouldBeIdempotent(@ForAll String input) {
    String once = NameNormalizer.normalize(input);
    String twice = NameNormalizer.normalize(once);

    assertThat(twice).isEqualTo(once);
}
```

Ini menangkap bug seperti normalizer yang terus menambah/mengubah karakter setiap dipanggil.

### 14.4 Contoh Property: Collection Order Preserved

```java
@Property
void itemMapping_shouldPreserveOrder(@ForAll List<LineItem> items) {
    Order order = new Order(items);

    OrderResponse response = mapper.toResponse(order);

    List<String> sourceIds = items.stream()
        .map(LineItem::getItemId)
        .toList();

    List<String> targetIds = response.items().stream()
        .map(LineItemResponse::itemId)
        .toList();

    assertThat(targetIds).containsExactlyElementsOf(sourceIds);
}
```

Order preservation penting untuk:

- display order;
- priority list;
- approval stages;
- workflow steps;
- deterministic audit output.

### 14.5 Property-Based Testing Harus Punya Constraint

Buruk:

```java
@Property
void mapperShouldNotThrow(@ForAll String anyString) {
    mapper.map(anyString);
}
```

Ini terlalu luas dan tidak punya semantic invariant.

Lebih baik:

```java
@Property
void postalCodeNormalizer_shouldReturnSixDigitsForValidSingaporePostalCode(
    @ForAll("sixDigitPostalCodes") String postalCode
) {
    String normalized = PostalCodeNormalizer.normalize(postalCode);

    assertThat(normalized).matches("\\d{6}");
}
```

Property-based testing bukan “random testing”. Ia adalah invariant testing dengan generated inputs.

---

## 15. Contract Tests

Contract test memastikan producer dan consumer sepakat pada payload.

Dalam mapping context, contract bisa berupa:

- OpenAPI schema;
- JSON Schema;
- AsyncAPI schema;
- event schema;
- XML XSD;
- sample payload approved by partner;
- consumer-driven contract;
- backward compatibility rules.

### 15.1 Producer-Side Contract Test

Producer memastikan output sesuai schema/contract.

```java
@Test
void caseSubmittedEvent_shouldMatchEventSchema() {
    CaseSubmittedEvent event = CaseEventFixture.submitted();

    String json = eventObjectMapper.writeValueAsString(event);

    JsonSchema schema = schemaLoader.load("schemas/case-submitted.v1.schema.json");
    Set<ValidationMessage> errors = schema.validate(json);

    assertThat(errors).isEmpty();
}
```

### 15.2 Consumer-Side Contract Test

Consumer memastikan bisa membaca payload yang valid dari producer.

```java
@Test
void consumer_shouldDeserializeProducerCaseSubmittedEventV1() throws Exception {
    String payload = Files.readString(Path.of(
        "src/test/resources/contracts/case-submitted.v1.producer.json"
    ));

    CaseSubmittedEvent event = objectMapper.readValue(payload, CaseSubmittedEvent.class);

    assertThat(event.caseNo()).isEqualTo("CASE-2026-0001");
    assertThat(event.status()).isEqualTo("SUBMITTED");
}
```

### 15.3 Compatibility Contract Test

Compatibility test memastikan event/API versi baru masih bisa dibaca oleh consumer lama atau minimal melanggar aturan secara eksplisit.

Contoh backward-compatible additive field:

```json
{
  "eventType": "CASE_SUBMITTED",
  "caseNo": "CASE-2026-0001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-17T01:30:00Z",
  "newOptionalField": "future-value"
}
```

Consumer tolerant:

```java
@Test
void v1Consumer_shouldIgnoreNewOptionalFieldFromV2Payload() throws Exception {
    CaseSubmittedV1 event = tolerantMapper.readValue(v2PayloadWithNewField, CaseSubmittedV1.class);

    assertThat(event.caseNo()).isEqualTo("CASE-2026-0001");
}
```

Jika consumer strict, maka additive field bisa breaking. Jadi contract harus jelas.

---

## 16. Enum Evolution Tests

Enum adalah sumber compatibility bug yang sangat sering.

### 16.1 Problem

Producer menambah status baru:

```java
UNDER_REASSESSMENT
```

Consumer lama hanya tahu:

```java
SUBMITTED, APPROVED, REJECTED
```

Jika deserialization strict, consumer gagal.

### 16.2 Strategy 1: Strict Internal API

Untuk internal API yang harus sinkron:

```java
@Test
void unknownStatus_shouldFailFast() {
    String json = """
        { "caseNo": "CASE-1", "status": "UNDER_REASSESSMENT" }
        """;

    assertThatThrownBy(() -> strictMapper.readValue(json, CaseEvent.class))
        .isInstanceOf(InvalidFormatException.class);
}
```

### 16.3 Strategy 2: Unknown Fallback untuk External Event

```java
public enum PublicCaseStatus {
    SUBMITTED,
    APPROVED,
    REJECTED,
    UNKNOWN
}
```

Test:

```java
@Test
void unknownExternalStatus_shouldMapToUnknown() throws Exception {
    String json = """
        { "caseNo": "CASE-1", "status": "UNDER_REASSESSMENT" }
        """;

    ExternalCaseEvent event = tolerantMapper.readValue(json, ExternalCaseEvent.class);

    assertThat(event.status()).isEqualTo(PublicCaseStatus.UNKNOWN);
}
```

### 16.4 Enum Mapping Matrix Test

Untuk MapStruct enum translator:

```java
@ParameterizedTest
@CsvSource({
    "DRAFT,DRAFT",
    "SUBMITTED,SUBMITTED",
    "UNDER_REVIEW,PENDING_REVIEW",
    "APPROVED,APPROVED",
    "REJECTED,REJECTED"
})
void internalStatus_shouldMapToPublicStatus(
    CaseStatus internal,
    PublicCaseStatus expected
) {
    assertThat(mapper.toPublicStatus(internal)).isEqualTo(expected);
}
```

Matrix test lebih jelas daripada satu test besar.

---

## 17. Null, Missing, Empty, Default Test Matrix

Mapping layer harus membedakan:

```text
absent field
null field
empty string
blank string
empty list
missing nested object
nested object with null fields
default value omitted
default value explicit
```

### 17.1 Test Matrix Contoh

| Input | Expected behavior |
|---|---|
| `{}` | reject jika required |
| `{ "name": null }` | reject atau clear tergantung semantics |
| `{ "name": "" }` | reject jika blank tidak valid |
| `{ "name": "   " }` | normalize+reject atau reject raw |
| `{ "items": [] }` | valid empty atau reject min size |
| `{ "items": null }` | reject atau treat as empty, harus eksplisit |
| missing `items` | berbeda dari empty jika PATCH |

### 17.2 Parameterized Test

```java
@ParameterizedTest
@MethodSource("invalidCreatePayloads")
void createCaseRequest_shouldRejectInvalidPayloads(String payload) {
    assertThatThrownBy(() -> objectMapper.readValue(payload, CreateCaseRequest.class))
        .isInstanceOf(JsonProcessingException.class);
}

static Stream<String> invalidCreatePayloads() {
    return Stream.of(
        "{}",
        "{ \"applicantName\": null }",
        "{ \"applicantName\": \"\" }",
        "{ \"applicantName\": \"   \" }"
    );
}
```

Jika validation terjadi setelah deserialization, pisahkan:

```java
@ParameterizedTest
@MethodSource("validationInvalidRequests")
void createCaseRequest_shouldFailValidation(CreateCaseRequest request) {
    Set<ConstraintViolation<CreateCaseRequest>> violations = validator.validate(request);

    assertThat(violations).isNotEmpty();
}
```

---

## 18. Date/Time Mapping Tests

Tanggal adalah salah satu bug paling mahal.

### 18.1 Test Timezone Contract

```java
@Test
void submittedAt_shouldSerializeAsUtcIsoInstant() throws Exception {
    CaseResponse response = new CaseResponse(
        "CASE-1",
        "SUBMITTED",
        OffsetDateTime.parse("2026-06-17T08:30:00+07:00")
    );

    String json = objectMapper.writeValueAsString(response);

    assertThatJson(json)
        .node("submittedAt")
        .isEqualTo("2026-06-17T01:30:00Z");
}
```

### 18.2 Test DST/Offset Edge

Walaupun Indonesia tidak memakai DST, sistem enterprise bisa berintegrasi dengan timezone lain.

Test minimal:

```java
@ParameterizedTest
@ValueSource(strings = {
    "2026-03-29T01:30:00+01:00",
    "2026-10-25T01:30:00+02:00",
    "2026-06-17T08:30:00+07:00"
})
void dateTimeMapping_shouldPreserveInstant(String value) {
    OffsetDateTime input = OffsetDateTime.parse(value);

    Instant mapped = DateMapper.toInstant(input);

    assertThat(mapped).isEqualTo(input.toInstant());
}
```

### 18.3 LocalDate vs Instant Harus Dites Berbeda

`LocalDate` adalah calendar date tanpa timezone. Jangan ubah menjadi `Instant` tanpa contract jelas.

```java
@Test
void birthDate_shouldNotShiftAcrossTimezone() throws Exception {
    PersonResponse response = new PersonResponse(LocalDate.of(1990, 1, 1));

    String json = objectMapper.writeValueAsString(response);

    assertThatJson(json).node("birthDate").isEqualTo("1990-01-01");
}
```

---

## 19. Decimal and Money Mapping Tests

Uang tidak boleh diuji dengan `double`.

### 19.1 BigDecimal Scale

```java
@Test
void feeAmount_shouldPreserveDecimalValue() throws Exception {
    CaseResponse response = new CaseResponse(new BigDecimal("120.50"));

    String json = objectMapper.writeValueAsString(response);

    assertThat(json).contains("120.50");
}
```

Catatan: JSON number secara logical tidak punya scale yang sama seperti `BigDecimal`. Jika scale penting secara kontrak, pertimbangkan serialize sebagai string:

```json
{ "amount": "120.50" }
```

Test:

```java
assertThatJson(json).node("amount").isEqualTo("120.50");
```

### 19.2 Rounding Test

```java
@ParameterizedTest
@CsvSource({
    "120.504,120.50",
    "120.505,120.51",
    "0.005,0.01"
})
void moneyMapper_shouldRoundHalfUpToTwoDecimals(String input, String expected) {
    MoneyDto dto = MoneyMapper.toDto(new BigDecimal(input));

    assertThat(dto.amount()).isEqualTo(expected);
}
```

Rounding mode adalah policy bisnis. Test harus membuatnya eksplisit.

---

## 20. XML Mapping Tests

XML membutuhkan test berbeda karena namespace, attribute, element order, whitespace, dan canonicalization.

### 20.1 Jangan Membandingkan XML sebagai String Mentah kecuali Perlu

Buruk:

```java
assertThat(actualXml).isEqualTo(expectedXml);
```

Ini terlalu rapuh jika prefix namespace berubah tetapi URI sama.

Lebih baik gunakan XMLUnit atau parser DOM untuk assertion semantic.

### 20.2 Namespace Test

```java
@Test
void partnerRequest_shouldUseCorrectNamespaceUri() {
    Document document = parseXml(actualXml);

    Element root = document.getDocumentElement();

    assertThat(root.getLocalName()).isEqualTo("SubmitCaseRequest");
    assertThat(root.getNamespaceURI()).isEqualTo("https://partner.example.com/case/v1");
}
```

Yang penting adalah namespace URI, bukan prefix:

```xml
<p:SubmitCaseRequest xmlns:p="https://partner.example.com/case/v1"/>
```

Dan:

```xml
<case:SubmitCaseRequest xmlns:case="https://partner.example.com/case/v1"/>
```

Secara namespace bisa equivalent.

### 20.3 XML Attribute vs Element Test

```xml
<Case status="SUBMITTED">
  <CaseNo>CASE-2026-0001</CaseNo>
</Case>
```

Berbeda dari:

```xml
<Case>
  <Status>SUBMITTED</Status>
  <CaseNo>CASE-2026-0001</CaseNo>
</Case>
```

Test harus mengunci shape:

```java
assertThat(root.getAttribute("status")).isEqualTo("SUBMITTED");
assertThat(root.getElementsByTagName("Status").getLength()).isZero();
```

### 20.4 XSD Validation Test

```java
@Test
void partnerRequest_shouldValidateAgainstXsd() {
    Schema schema = schemaFactory.newSchema(new File("src/test/resources/xsd/partner-case-v1.xsd"));
    Validator validator = schema.newValidator();

    assertThatCode(() -> validator.validate(new StreamSource(new StringReader(actualXml))))
        .doesNotThrowAnyException();
}
```

### 20.5 Signed XML Test

Untuk signed XML, semantic comparison saja tidak cukup. Canonicalized bytes bisa penting.

Test minimal:

```text
- signed payload generated
- signature verifies
- mapping change tidak mengubah signed portion
- namespace/whitespace/order tidak merusak canonicalization
```

Jangan refactor XML serialization untuk signed payload tanpa regression test signature verification.

---

## 21. Security Mapping Tests

Security test pada mapper harus memastikan data yang tidak boleh masuk/keluar benar-benar tidak bisa masuk/keluar.

### 21.1 Over-Posting Test

Payload malicious:

```json
{
  "applicantName": "Alice Tan",
  "status": "APPROVED",
  "approvedBy": "attacker",
  "role": "ADMIN"
}
```

Jika DTO tidak punya field tersebut dan ObjectMapper strict:

```java
@Test
void createRequest_shouldRejectOverPostedFields() {
    String payload = """
        {
          "applicantName": "Alice Tan",
          "status": "APPROVED",
          "approvedBy": "attacker",
          "role": "ADMIN"
        }
        """;

    assertThatThrownBy(() -> strictMapper.readValue(payload, CreateCaseRequest.class))
        .isInstanceOf(UnrecognizedPropertyException.class);
}
```

Jika ObjectMapper lenient, test service/mapper tidak memakai field tersebut:

```java
@Test
void createCommand_shouldNotAllowClientToSetStatus() throws Exception {
    CreateCaseRequest request = lenientMapper.readValue(payload, CreateCaseRequest.class);

    CreateCaseCommand command = mapper.toCommand(request);

    assertThat(command.initialStatus()).isEqualTo(CaseStatus.DRAFT);
}
```

### 21.2 Sensitive Field Leakage Test

```java
@Test
void responseJson_shouldNotContainSensitiveFields() throws Exception {
    CaseEntity entity = CaseEntityFixture.submittedCaseWithSensitiveData();

    CaseResponse response = mapper.toResponse(entity);
    String json = objectMapper.writeValueAsString(response);

    assertThat(json).doesNotContain("S1234567A");
    assertThat(json).doesNotContain("internalRemark");
    assertThat(json).doesNotContain("databaseId");
    assertThat(json).doesNotContain("password");
    assertThat(json).doesNotContain("secret");
}
```

Ini bukan pengganti desain DTO deny-by-default, tetapi guardrail tambahan.

### 21.3 Polymorphic Payload Test

Jika memakai polymorphic deserialization:

```java
@Test
void polymorphicPayload_shouldRejectUnknownTypeDiscriminator() {
    String payload = """
        {
          "type": "java.lang.Runtime",
          "value": "malicious"
        }
        """;

    assertThatThrownBy(() -> mapper.readValue(payload, BaseCommand.class))
        .isInstanceOf(JsonMappingException.class);
}
```

Test juga allowed discriminator:

```java
@Test
void polymorphicPayload_shouldDeserializeAllowedSubtype() throws Exception {
    String payload = """
        {
          "type": "SUBMIT_CASE",
          "caseNo": "CASE-1"
        }
        """;

    BaseCommand command = mapper.readValue(payload, BaseCommand.class);

    assertThat(command).isInstanceOf(SubmitCaseCommand.class);
}
```

---

## 22. Lazy Loading and Persistence Mapping Tests

Entity serialization langsung adalah anti-pattern yang harus dijaga dengan test.

### 22.1 Test Mapper Tidak Memicu Lazy Load Tidak Perlu

Dalam integration test dengan Hibernate statistics:

```java
@Test
@Transactional
void summaryMapper_shouldNotTriggerLazyCollectionLoad() {
    CaseEntity entity = caseRepository.getReferenceById(caseId);

    statistics.clear();

    CaseSummaryResponse response = mapper.toSummary(entity);

    assertThat(response.caseNo()).isEqualTo("CASE-1");
    assertThat(statistics.getCollectionFetchCount()).isZero();
}
```

### 22.2 Test Response Tidak Serialize Entity Proxy

```java
@Test
void responseSerialization_shouldNotContainHibernateProxyFields() throws Exception {
    CaseResponse response = service.getCaseResponse(caseId);

    String json = objectMapper.writeValueAsString(response);

    assertThat(json).doesNotContain("hibernateLazyInitializer");
    assertThat(json).doesNotContain("handler");
}
```

Lebih baik tidak pernah expose entity ke serializer.

---

## 23. Event Mapping Tests

Event DTO punya karakteristik berbeda dari response API:

- immutable setelah publish;
- consumer bisa banyak;
- compatibility lebih berat;
- field removal sangat mahal;
- timestamp dan idempotency key penting;
- event version harus jelas.

### 23.1 Event Golden Test

```java
@Test
void caseSubmittedEvent_shouldMatchGoldenV1Payload() throws Exception {
    CaseSubmittedEvent event = eventMapper.toSubmittedEvent(CaseFixtures.submittedCase());

    String actual = eventObjectMapper.writerWithDefaultPrettyPrinter()
        .writeValueAsString(event);

    String expected = Files.readString(Path.of(
        "src/test/resources/golden/events/case-submitted.v1.json"
    ));

    JSONAssert.assertEquals(expected, actual, true);
}
```

### 23.2 Event Required Invariants

Test:

```java
@Test
void caseSubmittedEvent_shouldContainStableIdentityAndOccurredAt() {
    CaseSubmittedEvent event = eventMapper.toSubmittedEvent(CaseFixtures.submittedCase());

    assertThat(event.eventId()).isNotBlank();
    assertThat(event.eventType()).isEqualTo("CASE_SUBMITTED");
    assertThat(event.eventVersion()).isEqualTo(1);
    assertThat(event.caseNo()).isEqualTo("CASE-2026-0001");
    assertThat(event.occurredAt()).isNotNull();
}
```

### 23.3 Event Should Not Contain Read Model Convenience Fields

```java
@Test
void caseSubmittedEvent_shouldNotContainUiOnlyFields() throws Exception {
    CaseSubmittedEvent event = eventMapper.toSubmittedEvent(CaseFixtures.submittedCase());

    String json = eventObjectMapper.writeValueAsString(event);

    assertThat(json).doesNotContain("displayLabel");
    assertThat(json).doesNotContain("buttonText");
    assertThat(json).doesNotContain("screenColor");
}
```

Event adalah integration contract, bukan UI response.

---

## 24. Test Fixtures and Object Mothers

Mapping tests butuh data yang jelas.

### 24.1 Fixture yang Baik

```java
public final class CaseFixtures {

    private CaseFixtures() {}

    public static CaseEntity submittedCase() {
        CaseEntity entity = new CaseEntity();
        entity.setId(1001L);
        entity.setCaseNo("CASE-2026-0001");
        entity.setStatus(CaseStatus.SUBMITTED);
        entity.setApplicantName("Alice Tan");
        entity.setApplicantNric("S1234567A");
        entity.setFeeAmount(new BigDecimal("120.50"));
        entity.setSubmittedAt(Instant.parse("2026-06-17T01:30:00Z"));
        entity.setInternalRemark("Internal only");
        return entity;
    }
}
```

Fixture harus:

- readable;
- deterministic;
- mengandung field sensitif untuk leakage test;
- mengandung value non-trivial;
- tidak bergantung database jika unit test;
- tidak menyembunyikan semua hal di random builder.

### 24.2 Hindari Fixture Terlalu Default

Buruk:

```java
CaseEntity entity = CaseFixtures.defaultCase();
```

Jika semua field default/null, mapper bisa salah tapi test tetap lulus.

Lebih baik:

```java
CaseEntity entity = CaseFixtures.submittedCaseWithFeeAndSensitiveData();
```

Nama fixture harus menyatakan aspek penting.

---

## 25. Testing Lombok/Record/Builder Binding

Lombok dan records memengaruhi constructor/getter/builder shape. Jackson dan MapStruct membaca shape tersebut dengan cara berbeda.

### 25.1 Lombok Builder + Jackson Test

```java
@Value
@Builder
@Jacksonized
public class CreateCaseRequest {
    String applicantName;
    String contactEmail;
}
```

Test:

```java
@Test
void lombokBuilderDto_shouldDeserializeWithJackson() throws Exception {
    String json = """
        {
          "applicantName": "Alice Tan",
          "contactEmail": "alice@example.com"
        }
        """;

    CreateCaseRequest request = objectMapper.readValue(json, CreateCaseRequest.class);

    assertThat(request.getApplicantName()).isEqualTo("Alice Tan");
}
```

Tanpa test ini, upgrade Lombok/Jackson bisa membuat deserialization gagal di runtime.

### 25.2 Record DTO Test

```java
public record CreateCaseRequest(
    String applicantName,
    String contactEmail
) {}
```

Test:

```java
@Test
void recordDto_shouldDeserializeByCanonicalConstructor() throws Exception {
    CreateCaseRequest request = objectMapper.readValue("""
        {
          "applicantName": "Alice Tan",
          "contactEmail": "alice@example.com"
        }
        """, CreateCaseRequest.class);

    assertThat(request.applicantName()).isEqualTo("Alice Tan");
}
```

### 25.3 MapStruct to Builder Target Test

```java
@Test
void mapStruct_shouldMapToLombokBuilderTarget() {
    CaseEntity entity = CaseFixtures.submittedCase();

    CaseResponse response = mapper.toResponse(entity);

    assertThat(response.getCaseNo()).isEqualTo("CASE-2026-0001");
}
```

Ini menangkap masalah annotation processor ordering, builder detection, atau missing `lombok-mapstruct-binding`.

---

## 26. Testing Custom Serializer/Deserializer

Custom serializer/deserializer harus dites langsung dan via ObjectMapper profile tempat ia dipakai.

### 26.1 Serializer Unit Test

```java
@Test
void moneySerializer_shouldWriteAmountAsFixedScaleString() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    SimpleModule module = new SimpleModule()
        .addSerializer(Money.class, new MoneySerializer());
    mapper.registerModule(module);

    String json = mapper.writeValueAsString(new Money("SGD", new BigDecimal("120.5")));

    assertThatJson(json).isEqualTo("""
        { "currency": "SGD", "amount": "120.50" }
        """);
}
```

### 26.2 Deserializer Negative Test

```java
@Test
void moneyDeserializer_shouldRejectInvalidAmountScale() {
    String json = """
        { "currency": "SGD", "amount": "120.505" }
        """;

    assertThatThrownBy(() -> mapper.readValue(json, Money.class))
        .isInstanceOf(JsonMappingException.class)
        .hasMessageContaining("scale");
}
```

### 26.3 Profile Leakage Test

Jika custom serializer hanya untuk external API, pastikan internal mapper tidak ikut terkena.

```java
@Test
void internalMapper_shouldNotUseExternalMoneySerializer() throws Exception {
    Money money = new Money("SGD", new BigDecimal("120.50"));

    String internalJson = internalMapper.writeValueAsString(money);
    String externalJson = externalMapper.writeValueAsString(money);

    assertThat(internalJson).isNotEqualTo(externalJson);
}
```

---

## 27. Testing Error Diagnostics

Dari Part 28, mapping pipeline harus menghasilkan error yang diagnosable tetapi aman.

### 27.1 Field Path Test

```java
@Test
void invalidNestedField_shouldReturnFieldPath() {
    String payload = """
        {
          "applicant": {
            "email": "not-an-email"
          }
        }
        """;

    ApiError error = requestHandler.handle(payload);

    assertThat(error.errors())
        .extracting(ApiFieldError::path)
        .contains("/applicant/email");
}
```

### 27.2 Safe Error Message Test

```java
@Test
void mappingError_shouldNotExposeRawSensitiveValue() {
    String payload = """
        {
          "applicantNric": "S1234567A",
          "applicationType": "INVALID"
        }
        """;

    ApiError error = requestHandler.handle(payload);

    assertThat(error.toString()).doesNotContain("S1234567A");
    assertThat(error.message()).contains("Invalid applicationType");
}
```

### 27.3 Correlation ID Test

```java
@Test
void mappingError_shouldIncludeCorrelationId() {
    ApiError error = requestHandler.handle(invalidPayload, "corr-123");

    assertThat(error.correlationId()).isEqualTo("corr-123");
}
```

---

## 28. Test Organization

Recommended package layout:

```text
src/test/java
  com.example.caseapp.mapping
    CaseMapperTest.java
    CasePatchMapperTest.java
    CaseStatusMapperTest.java
  com.example.caseapp.serialization
    CaseResponseJsonTest.java
    CaseEventJsonTest.java
    MoneySerializerTest.java
  com.example.caseapp.contract
    CaseSubmittedEventContractTest.java
    PublicApiCompatibilityTest.java
  com.example.caseapp.xml
    PartnerRequestXmlTest.java
    PartnerXsdValidationTest.java
  com.example.caseapp.property
    NricMaskingPropertyTest.java
    NormalizationPropertyTest.java

src/test/resources
  golden
    api
      case-response-v1.json
    events
      case-submitted-v1.json
    xml
      partner-submit-case-v1.xml
  schemas
    json
      case-submitted-v1.schema.json
    xsd
      partner-case-v1.xsd
  payloads
    invalid
    compatibility
```

Principle:

```text
Unit mapper tests dekat dengan mapper.
Golden/contract tests dekat dengan boundary contract.
Fixture reusable tapi tidak terlalu abstrak.
```

---

## 29. CI/CD Strategy untuk Mapping Tests

Tidak semua test harus jalan dengan cadence yang sama.

| Test type | Run on PR | Run nightly | Notes |
|---|---:|---:|---|
| mapper unit test | yes | yes | cepat |
| serialization/deserialization test | yes | yes | wajib untuk API/event |
| golden payload test | yes | yes | wajib review saat berubah |
| property-based test kecil | yes | yes | batasi sample count |
| property-based test besar | optional | yes | sample count lebih besar |
| XSD/schema validation | yes | yes | penting untuk integration |
| consumer contract full suite | maybe | yes | tergantung cost |
| performance mapping benchmark | no | scheduled/manual | jangan gate PR biasa kecuali critical |

### 29.1 Property Test Sample Count

Untuk PR:

```text
100–500 generated cases cukup untuk guardrail cepat.
```

Untuk nightly:

```text
1,000–10,000 cases bisa dipakai untuk eksplorasi lebih luas.
```

Tergantung cost dan stabilitas.

### 29.2 Golden File Change Workflow

```text
1. Test gagal karena payload berubah.
2. Developer review diff JSON/XML.
3. Developer jelaskan perubahan contract di PR.
4. Reviewer cek compatibility/security.
5. OpenAPI/schema/event docs ikut diperbarui jika perlu.
6. Golden file baru diterima.
```

Jangan auto-update golden file di CI.

---

## 30. Mapping Test Smells

### 30.1 Test Hanya Mengecek Non-Null

Buruk:

```java
assertThat(response).isNotNull();
```

Ini hampir tidak punya nilai.

Lebih baik:

```java
assertThat(response.caseNo()).isEqualTo("CASE-2026-0001");
assertThat(response.status()).isEqualTo("SUBMITTED");
```

### 30.2 Test Mengulang Implementasi

Buruk:

```java
assertThat(response.name()).isEqualTo(entity.getFirstName() + " " + entity.getLastName());
```

Jika implementation salah dan test menyalin logic yang sama, bug bisa tidak tertangkap.

Lebih baik gunakan expected literal untuk scenario penting:

```java
assertThat(response.name()).isEqualTo("Alice Tan");
```

### 30.3 Fixture Terlalu Random

Random fixture membuat test sulit dibaca.

Buruk:

```java
CaseEntity entity = random(CaseEntity.class);
```

Untuk mapper contract, deterministic fixture lebih baik.

Property-based test boleh generate random, tetapi harus punya property jelas.

### 30.4 Terlalu Banyak Snapshot Tanpa Review

Jika semua response disnapshot, reviewer akan lelah dan approve diff tanpa membaca.

Gunakan golden payload hanya untuk boundary yang penting.

### 30.5 Semua ObjectMapper Sama

Buruk:

```java
private final ObjectMapper mapper = new ObjectMapper();
```

Jika production memakai module/config tertentu, test tidak valid.

Lebih baik:

```java
private final ObjectMapper mapper = ObjectMapperFactory.publicApiMapper();
```

atau inject dari Spring test context untuk boundary integration test.

---

## 31. Testing Matrix per Mapper Type

| Mapper type | Minimal tests | Advanced tests |
|---|---|---|
| manual DTO mapper | field invariants, null cases | property tests for normalization/redaction |
| MapStruct mapper | output behavior, unmapped policy compile | generated behavior after Lombok/builder upgrade |
| update mapper | PUT/PATCH/null/absent matrix | audit preservation, dirty checking interaction |
| Jackson serializer | golden JSON, date/decimal/enum | profile isolation, custom serializer tests |
| Jackson deserializer | valid/invalid/unknown/missing/null | coercion, polymorphic discriminator tests |
| XML mapper | namespace/attribute/element test | XSD validation, canonicalization/signature test |
| event mapper | golden event, version, identity | backward/forward compatibility suite |
| external integration mapper | sample payloads from partner | tolerant reader, weird legacy format tests |
| persistence mapper | entity→DTO without lazy storms | query count/statistics tests |

---

## 32. Practical Testing Recipes

### 32.1 Recipe: Public API Response Mapper

Test set:

```text
[ ] object-level mapper test
[ ] golden JSON test
[ ] sensitive leakage test
[ ] null/absent serialization test
[ ] date/time format test
[ ] enum value test
```

### 32.2 Recipe: Create Request DTO

Test set:

```text
[ ] valid payload deserialize
[ ] unknown field behavior
[ ] missing required field
[ ] explicit null field
[ ] invalid enum
[ ] validation violation mapping
[ ] over-posting attempt
```

### 32.3 Recipe: PATCH Mapper

Test set:

```text
[ ] absent field does not modify entity
[ ] present null clears field if allowed
[ ] present value updates field
[ ] audit/system fields not overwritten
[ ] read-only fields rejected/ignored according to contract
[ ] nested partial update behavior
```

### 32.4 Recipe: Event Mapper

Test set:

```text
[ ] event type/version present
[ ] event id/idempotency key present
[ ] occurredAt format stable
[ ] golden payload match
[ ] schema validation
[ ] consumer compatibility samples
[ ] enum evolution scenario
```

### 32.5 Recipe: XML Partner Payload

Test set:

```text
[ ] golden XML semantic match
[ ] namespace URI correct
[ ] attribute vs element shape correct
[ ] wrapper element correct
[ ] XSD validation
[ ] invalid namespace rejected
[ ] XXE parser hardening test where applicable
[ ] signature verification if signed
```

---

## 33. Top 1% Perspective: What Senior Engineers Actually Protect

Junior view:

```text
Mapper test memastikan field sama.
```

Senior view:

```text
Mapper test memastikan boundary contract tidak drift, data sensitif tidak bocor, semantic meaning tidak hilang, update semantics tidak merusak state, dan future evolution bisa dilakukan tanpa silent breakage.
```

Top-level mapping test strategy melindungi lima hal:

### 33.1 Correctness

Data yang keluar/masuk benar secara nilai dan makna.

### 33.2 Compatibility

Perubahan payload tidak diam-diam mematahkan consumer.

### 33.3 Security

Client tidak bisa mengirim field yang tidak boleh, dan response tidak membocorkan field internal.

### 33.4 Observability

Saat mapping gagal, error bisa didiagnosis tanpa membocorkan sensitive data.

### 33.5 Evolvability

DTO, event, schema, mapper, dan generated code bisa berubah dengan guardrail.

---

## 34. Checklist Desain Testing Mapping Layer

Gunakan checklist ini saat review mapper baru.

```text
Boundary & Contract
[ ] Mapper ini berada di boundary apa?
[ ] Consumer output-nya siapa?
[ ] Input berasal dari trusted atau untrusted source?
[ ] Contract strict atau tolerant?
[ ] Ada schema/OpenAPI/XSD/golden sample?

Correctness
[ ] Field penting dites dengan expected literal?
[ ] Nested mapping dites?
[ ] Collection order dites jika penting?
[ ] Date/time format dites?
[ ] Decimal/money precision dites?
[ ] Enum mapping matrix dites?

Null & Default
[ ] Missing field behavior dites?
[ ] Explicit null behavior dites?
[ ] Empty string/list behavior dites?
[ ] Default value behavior dites?
[ ] PATCH absent vs null dibedakan jika perlu?

Security
[ ] Sensitive field leakage dites?
[ ] Over-posting/mass assignment dites?
[ ] Polymorphic discriminator aman?
[ ] Unknown field policy dites?
[ ] Error message tidak membocorkan payload sensitif?

Generated Code
[ ] MapStruct `unmappedTargetPolicy` sesuai?
[ ] Lombok builder/record binding dites?
[ ] Generated mapper behavior dites setelah upgrade?
[ ] Annotation processor config masuk build CI?

Contract Evolution
[ ] Golden payload tersedia untuk payload penting?
[ ] Schema validation tersedia jika relevan?
[ ] Backward compatibility scenario dites?
[ ] Unknown enum/new optional field scenario dites?
[ ] Golden file change harus direview?

Persistence & Performance
[ ] Mapper tidak serialize entity langsung?
[ ] Lazy loading tidak terpicu tanpa sadar?
[ ] Large payload strategy dites jika relevan?
[ ] Streaming path punya test khusus jika dipakai?
```

---

## 35. Latihan Desain

### Latihan 1 — Public Response Contract

Diberikan `ApplicationEntity`:

```java
class ApplicationEntity {
    Long id;
    String applicationNo;
    String applicantName;
    String applicantNric;
    ApplicationStatus status;
    BigDecimal payableAmount;
    Instant submittedAt;
    String internalRiskScore;
    String officerRemark;
}
```

Desain test untuk `ApplicationResponse` dengan aturan:

```text
- id database tidak boleh keluar.
- applicantNric harus masked.
- internalRiskScore tidak boleh keluar.
- officerRemark hanya keluar untuk admin response, bukan public response.
- payableAmount harus dua decimal.
- submittedAt harus UTC ISO-8601.
```

Expected test set:

```text
1. mapper object-level test
2. golden JSON public response test
3. sensitive leakage test
4. money formatting test
5. date/time formatting test
6. admin vs public response differential test
```

### Latihan 2 — PATCH Semantics

Diberikan request:

```json
{ "contactEmail": null }
```

Tentukan apakah artinya:

```text
A. clear email
B. do not modify email
C. invalid request
```

Lalu tulis test yang membuktikan semantics tersebut.

### Latihan 3 — Event Compatibility

Event v1:

```json
{
  "eventType": "CASE_SUBMITTED",
  "eventVersion": 1,
  "caseNo": "CASE-1",
  "status": "SUBMITTED"
}
```

Event v2 menambah:

```json
{
  "submittedChannel": "ONLINE"
}
```

Desain consumer compatibility test untuk memastikan consumer v1 tetap bisa membaca v2 jika policy tolerant-reader dipilih.

### Latihan 4 — XML Namespace

Dua XML payload:

```xml
<a:SubmitCase xmlns:a="https://example.com/case/v1"/>
```

```xml
<b:SubmitCase xmlns:b="https://example.com/case/v1"/>
```

Apakah equivalent? Buat test yang membandingkan namespace URI dan local name, bukan prefix.

---

## 36. Ringkasan

Testing mapping layer bukan sekadar memastikan field tercopy.

Yang harus diuji:

```text
- object-level transformation
- serialization shape
- deserialization strictness/leniency
- null/missing/default semantics
- enum evolution
- date/time and money precision
- update/PATCH semantics
- sensitive leakage and over-posting
- generated mapper behavior
- XML namespace/XSD/canonicalization
- event/API compatibility
- diagnostics and safe error reporting
```

Mental model akhir:

> Mapper adalah boundary contract executable. Testing mapper berarti mengunci contract tersebut agar tetap benar, aman, kompatibel, dan dapat berevolusi.

Jika sebuah mapping penting untuk API, event, audit, payment, regulatory decision, external integration, atau persistence update, maka test-nya harus lebih kuat daripada “not null” dan “happy path”.

---

## 37. Referensi

- MapStruct Reference Guide 1.6.3 — annotation processor, generated type-safe mapper, mapper configuration, reporting policy.
- MapStruct Testing documentation — MapStruct sebagai annotation processor perlu compiler invocation untuk validasi behavior generated.
- JSONAssert documentation — assertion untuk JSON dengan strict dan non-strict comparison.
- jqwik documentation — property-based testing untuk JVM, terutama Java/Kotlin.
- Jackson Databind `ObjectMapper` API — serialization/deserialization JSON object binding.
- JUnit 5 User Guide — parameterized tests dan test organization.
- AssertJ documentation — fluent assertions untuk Java tests.
- XMLUnit documentation — semantic XML comparison dan XML assertions.
- JSON Schema/OpenAPI tooling documentation — schema validation dan contract tests.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 28 — Error Handling and Diagnostics in Mapping Pipelines](./28-error-handling-diagnostics-mapping-pipelines.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 30 — Performance and Memory Engineering for Mapping Layers](./30-performance-memory-engineering-mapping-layers.md)

</div>