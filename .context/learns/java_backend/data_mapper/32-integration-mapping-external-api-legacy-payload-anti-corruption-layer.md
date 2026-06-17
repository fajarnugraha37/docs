# Part 32 — Integration Mapping: External API, Legacy Payload, Anti-Corruption Layer

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `32-integration-mapping-external-api-legacy-payload-anti-corruption-layer.md`  
> Target: Java 8 hingga Java 25  
> Posisi: Part 32 dari 35

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **mapping untuk integrasi antar sistem**, khususnya ketika sistem Java kita harus berkomunikasi dengan:

- external REST API,
- SOAP-ish/XML service,
- legacy payload,
- file-based integration,
- message/event dari sistem lain,
- partner/vendor API,
- government/regulatory system,
- sistem internal lama dengan model data yang tidak bersih,
- service lain yang lifecycle release-nya tidak sinkron dengan aplikasi kita.

Di bagian sebelumnya kita sudah membahas:

- DTO design,
- manual mapper,
- Jackson,
- XML,
- MapStruct,
- Lombok,
- validation,
- diagnostics,
- testing,
- performance,
- persistence mapping.

Sekarang fokusnya bergeser dari “bagaimana object Java berubah bentuk” menjadi:

> **Bagaimana sistem kita tetap bersih, stabil, dan evolvable walaupun harus hidup berdampingan dengan model data eksternal yang aneh, berubah-ubah, dan tidak sepenuhnya kita kontrol.**

Inilah tempat konsep **Anti-Corruption Layer**, **Tolerant Reader**, **Message Translator**, dan **Canonical Data Model** menjadi sangat penting.

---

## 1. Mental Model Utama: Integration Mapping Bukan Sekadar Adapter Teknis

Banyak engineer melihat integrasi seperti ini:

```text
External JSON/XML/file/message -> Java DTO -> Service -> Database
```

Lalu mapper dianggap sekadar:

```java
externalDto.getCustomerName() -> internalDto.setName(...)
```

Untuk sistem kecil, ini mungkin cukup. Untuk sistem enterprise/regulatory/long-lived, ini berbahaya.

Model yang lebih benar:

```text
External System Model
        |
        | transport decode
        v
Raw External Payload Model
        |
        | tolerant parsing + normalization
        v
External Contract DTO
        |
        | anti-corruption translation
        v
Internal Canonical / Application Model
        |
        | domain/application rules
        v
Domain / Persistence / Event Model
```

Yang penting:

1. **External model bukan domain kita.**
2. **Nama field eksternal bukan bukti semantic sama.**
3. **Integrasi adalah boundary of trust.**
4. **Mapping eksternal harus menyerap perubahan eksternal tanpa mencemari model internal.**
5. **Mapper integrasi sering perlu membawa metadata, provenance, dan diagnostic context.**

Anti-corruption layer dalam konteks ini berarti lapisan isolasi yang menerjemahkan model sistem lain ke model sistem kita, sehingga model internal tidak “terinfeksi” istilah, struktur, kebiasaan, dan kompromi dari sistem luar.

---

## 2. Kenapa Integration Mapping Sulit

Mapping internal biasanya sulit karena object graph, null handling, validation, dan performance.

Mapping integrasi jauh lebih sulit karena kita berhadapan dengan **ketidakpastian eksternal**.

Contoh masalah nyata:

### 2.1 Field Sama, Makna Berbeda

External API:

```json
{
  "status": "APPROVED"
}
```

Di sistem eksternal, `APPROVED` berarti:

> Approved by preliminary officer.

Di sistem kita, `APPROVED` berarti:

> Final approval, legally effective.

Kalau kita mapping langsung:

```java
internal.setStatus(external.getStatus());
```

kita membuat bug semantic, bukan bug teknis.

---

### 2.2 Field Aneh Karena Legacy

```json
{
  "applicant_name": "Fajar",
  "applicantName": null,
  "applNm": "Fajar Abdi",
  "is_company": "Y",
  "created_date": "17/06/2026 08:30:10"
}
```

Masalah:

- field duplikat,
- naming tidak konsisten,
- boolean sebagai `Y/N`,
- date format lokal,
- field lama masih dikirim,
- field baru belum stabil.

Internal model tidak boleh ikut-ikutan memiliki `applNm` hanya karena external payload seperti itu.

---

### 2.3 “Stringly Typed” Payload

```json
{
  "amount": "100000.00",
  "paid": "true",
  "quantity": "5",
  "score": "N/A"
}
```

Semua string. Tapi internal model butuh:

```java
BigDecimal amount;
boolean paid;
int quantity;
Optional<Integer> score;
```

Conversion di sini bukan hanya parsing. Harus ada policy:

- `""` dianggap null atau error?
- `"N/A"` dianggap absent atau special value?
- angka dengan comma `"1,000.50"` diterima?
- negatif boleh?
- precision berapa?

---

### 2.4 Reference Data Drift

External:

```json
{
  "country": "IDN",
  "nationality": "INDONESIAN",
  "entityType": "PTE_LTD"
}
```

Internal:

```java
CountryCode.ID
Nationality.ID
LegalEntityType.PRIVATE_LIMITED_COMPANY
```

Masalah:

- external code table bisa berubah,
- code bisa deprecated,
- satu code external bisa map ke beberapa internal category,
- internal taxonomy bisa lebih sempit/lebih luas,
- mapping harus auditable.

---

### 2.5 Provider Tidak Konsisten Antar Environment

DEV/UAT/PROD external sering berbeda:

- enum tambahan muncul di UAT,
- date format PROD berbeda,
- sandbox payload tidak mencerminkan real production,
- XML namespace prefix berubah,
- field optional mendadak mandatory.

Mapper yang terlalu “happy path” akan gagal saat production pertama kali menerima payload nyata.

---

## 3. Integration Boundary Layers

Untuk integrasi yang sehat, pisahkan minimal empat bentuk object.

```text
Transport Payload
    -> External DTO
    -> Integration Normalized Model
    -> Internal Application Command/Event/View
```

### 3.1 Transport Payload

Ini bentuk paling mentah:

- raw JSON string,
- raw XML string,
- file line,
- CSV row,
- message body,
- multipart response,
- HTTP response dengan header/status.

Biasanya jangan langsung hilang. Untuk diagnostic, kadang kita perlu menyimpan:

- correlation id,
- source system,
- received timestamp,
- content type,
- provider response code,
- payload hash,
- schema/version hint,
- redacted raw payload.

Jangan sembarang simpan raw payload penuh jika mengandung PII/secret. Gunakan redaction/hash/secure storage sesuai kebijakan.

---

### 3.2 External DTO

External DTO merepresentasikan kontrak external **apa adanya**, bukan model internal.

Contoh:

```java
public class ExternalApplicantResponse {
    private String applNm;
    private String applicant_name;
    private String idNo;
    private String dob;
    private String entityType;
    private String sourceStatus;

    // getters/setters
}
```

Prinsip:

- boleh jelek karena mengikuti external contract,
- tidak dipakai oleh domain layer,
- tidak disimpan sebagai entity internal,
- tidak bocor ke controller internal,
- tidak dipakai sebagai command domain,
- package-nya jelas: `integration.partnerx.dto` atau `adapter.partnerx.dto`.

External DTO adalah “quarantine model”.

---

### 3.3 Normalized Integration Model

Ini bentuk antara yang sudah lebih bersih, tetapi masih berada di integration layer.

```java
public class NormalizedApplicantPayload {
    private String legalName;
    private ExternalIdentityNumber identityNumber;
    private LocalDate dateOfBirth;
    private ExternalEntityType externalEntityType;
    private ExternalStatus externalStatus;
    private SourceMetadata metadata;
}
```

Fungsinya:

- menghilangkan naming aneh,
- parsing format primitif,
- mengubah stringly typed value,
- menempelkan metadata,
- menandai field ambiguous,
- belum menerapkan domain decision final.

Normalized model menjembatani raw external DTO dan internal command.

---

### 3.4 Internal Application Model

Ini model yang dipahami sistem kita.

```java
public record RegisterApplicantCommand(
    ApplicantName name,
    IdentityNumber identityNumber,
    LocalDate dateOfBirth,
    ApplicantCategory category,
    IntegrationProvenance provenance
) {}
```

Prinsip:

- pakai language internal/domain,
- external naming tidak bocor,
- external code tidak bocor kecuali sebagai provenance,
- sudah sesuai invariant aplikasi,
- aman dipakai oleh service/domain layer.

---

## 4. Anti-Corruption Layer dalam Java

Anti-corruption layer bukan satu class. Ia adalah kumpulan komponen boundary.

```text
adapter.partnerx
  ├── PartnerXClient
  ├── PartnerXRequestDto
  ├── PartnerXResponseDto
  ├── PartnerXObjectMapperConfig
  ├── PartnerXNormalizer
  ├── PartnerXCodeTranslator
  ├── PartnerXMapper
  ├── PartnerXErrorMapper
  ├── PartnerXContractTestFixtures
  └── PartnerXIntegrationProperties
```

### 4.1 Struktur Package yang Disarankan

```text
com.example.application
  ├── applicant
  │   ├── command
  │   ├── service
  │   └── model
  └── integration
      └── partnerx
          ├── client
          ├── dto
          ├── mapper
          ├── normalizer
          ├── codec
          ├── error
          ├── config
          └── testfixture
```

Aturan dependency:

```text
application service -> integration port/interface
adapter implementation -> external DTO/client/mapper
adapter maps external model -> internal command/result
internal domain never imports partnerx.dto
```

Contoh interface:

```java
public interface ApplicantVerificationGateway {
    VerificationResult verify(ApplicantVerificationRequest request);
}
```

Implementation:

```java
public final class PartnerXApplicantVerificationGateway
        implements ApplicantVerificationGateway {

    private final PartnerXClient client;
    private final PartnerXRequestMapper requestMapper;
    private final PartnerXResponseTranslator responseTranslator;

    public VerificationResult verify(ApplicantVerificationRequest request) {
        PartnerXVerifyRequest externalRequest = requestMapper.toExternal(request);
        PartnerXVerifyResponse externalResponse = client.verify(externalRequest);
        return responseTranslator.toInternalResult(externalResponse);
    }
}
```

Domain/application hanya tahu `ApplicantVerificationGateway`, bukan `PartnerXVerifyResponse`.

---

## 5. Tolerant Reader Pattern

Tolerant reader berarti consumer tidak mudah rusak ketika provider menambah field atau mengubah struktur non-esensial.

Prinsip:

- ambil hanya field yang dibutuhkan,
- ignore field yang tidak relevan,
- jangan terlalu bergantung pada urutan field,
- jangan terlalu bergantung pada struktur wrapper jika tidak perlu,
- toleransi harus dibatasi oleh security dan correctness.

### 5.1 Tolerant Bukan Berarti Ceroboh

Buruk:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
// lalu semua payload diterima tanpa observability
```

Lebih baik:

```text
Unknown fields allowed for partner payload evolution,
but recorded as contract observation in non-production or sampled logs.
```

Contoh pendekatan:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public class PartnerXResponse {
    private String referenceNo;
    private String status;
    private String resultCode;
}
```

Tetapi untuk API publik kita sendiri, strict mode sering lebih aman:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Boundary berbeda, policy berbeda.

---

## 6. Strict Writer, Tolerant Reader

Untuk integrasi stabil:

```text
When reading external payload: be tolerant within safe bounds.
When writing outbound payload: be strict and explicit.
```

Inbound dari external:

- ignore unknown safe fields,
- support alias untuk renamed field,
- support old enum selama masih compatible,
- parse legacy date format jika contract menyebut masih mungkin.

Outbound ke external:

- kirim field yang diminta saja,
- jangan kirim null random,
- jangan kirim internal debug field,
- jangan kirim enum internal langsung,
- jangan rely on default serializer global,
- punya golden payload test.

---

## 7. Canonical Model: Kapan Berguna, Kapan Berbahaya

Canonical Data Model adalah format bersama yang dipakai banyak sistem agar tidak perlu mapping pairwise antar semua sistem.

```text
System A -> Canonical -> System B
System C -> Canonical -> System D
```

### 7.1 Kapan Canonical Model Berguna

Berguna jika:

- banyak sistem bertukar object bisnis serupa,
- ada enterprise integration bus/event backbone,
- konsep bisnis cukup stabil,
- governance kuat,
- organization siap menjaga versioning model.

Contoh:

```java
public record CanonicalApplicantEvent(
    String applicantId,
    String legalName,
    String identityType,
    String identityNumber,
    String status,
    Instant occurredAt,
    String sourceSystem
) {}
```

### 7.2 Kapan Canonical Model Menjadi Masalah

Berbahaya jika canonical model berubah menjadi “god model”:

```java
public class CanonicalApplication {
    // 300 fields from every system
}
```

Gejalanya:

- banyak nullable field,
- field bernama generik: `status1`, `status2`, `code`, `type`,
- tiap consumer punya interpretasi berbeda,
- perubahan butuh approval banyak tim,
- model terlalu abstrak sampai kehilangan makna,
- model terlalu detail sampai mencemari semua sistem.

Rule of thumb:

> Canonical model harus meminimalkan coupling, bukan menjadi database schema global baru.

---

## 8. Message Translator Pattern

Dalam messaging/integration, mapper berperan sebagai **Message Translator**:

```text
External Message Format -> Internal Message Format
```

Contoh:

```json
{
  "txn_id": "X123",
  "event": "CASE_APPR",
  "ts": "2026-06-17T08:00:00+07:00"
}
```

Diterjemahkan menjadi:

```java
public record CaseApprovedEvent(
    CaseId caseId,
    Instant approvedAt,
    SourceSystem source
) {}
```

Translator harus menjawab:

- field mana mandatory?
- field mana optional?
- code mana valid?
- timestamp timezone apa?
- duplicate event dikenali dari mana?
- ordering event dijamin atau tidak?
- event lama masih diterima sampai kapan?

---

## 9. Desain External DTO

### 9.1 Jangan Percantik External DTO Terlalu Cepat

Misalnya external mengirim:

```json
{
  "appl_no": "A-001",
  "appl_nm": "Fajar",
  "sts_cd": "A"
}
```

Boleh saja External DTO seperti ini:

```java
public class PartnerXApplicationResponse {
    @JsonProperty("appl_no")
    private String applNo;

    @JsonProperty("appl_nm")
    private String applNm;

    @JsonProperty("sts_cd")
    private String stsCd;
}
```

Jangan langsung begini kalau semantics belum dipastikan:

```java
public class PartnerXApplicationResponse {
    private String applicationNumber;
    private String applicantName;
    private ApplicationStatus status;
}
```

Kenapa?

Karena `sts_cd = A` belum tentu berarti `ApplicationStatus.APPROVED`. Bisa saja berarti `ACTIVE`, `ACCEPTED`, `ASSESSED`, atau `AMENDED`.

External DTO boleh mengikuti bahasa external. Translation layer yang memberi makna internal.

---

## 10. Code Table Translation

Code table sering menjadi inti integration mapping.

### 10.1 Jangan Mapping Code dengan `Enum.valueOf`

Buruk:

```java
InternalStatus status = InternalStatus.valueOf(external.getStatus());
```

Masalah:

- external code bisa lowercase,
- external code bisa berubah,
- code bisa tidak satu-ke-satu,
- unknown code menyebabkan runtime exception generik,
- tidak ada audit mapping decision.

Lebih baik:

```java
public final class PartnerXStatusTranslator {

    public InternalStatus translate(String externalCode) {
        if (externalCode == null || externalCode.isBlank()) {
            throw new ExternalMappingException("Missing PartnerX status code");
        }

        return switch (externalCode.trim().toUpperCase(Locale.ROOT)) {
            case "A", "APP" -> InternalStatus.APPROVED_PRELIMINARY;
            case "R", "REJ" -> InternalStatus.REJECTED;
            case "P", "PND" -> InternalStatus.PENDING_EXTERNAL_REVIEW;
            default -> throw new UnknownExternalCodeException(
                "PartnerX status", externalCode
            );
        };
    }
}
```

Untuk Java 8:

```java
public InternalStatus translate(String externalCode) {
    if (externalCode == null || externalCode.trim().isEmpty()) {
        throw new ExternalMappingException("Missing PartnerX status code");
    }

    String code = externalCode.trim().toUpperCase(Locale.ROOT);
    switch (code) {
        case "A":
        case "APP":
            return InternalStatus.APPROVED_PRELIMINARY;
        case "R":
        case "REJ":
            return InternalStatus.REJECTED;
        case "P":
        case "PND":
            return InternalStatus.PENDING_EXTERNAL_REVIEW;
        default:
            throw new UnknownExternalCodeException("PartnerX status", externalCode);
    }
}
```

---

### 10.2 Code Translation Harus Punya Policy Unknown

Unknown external code bisa ditangani dengan beberapa strategy:

| Strategy | Cocok Untuk | Risiko |
|---|---|---|
| Reject | financial/regulatory/legal decision | provider change bisa memutus flow |
| Map to UNKNOWN | display/reporting non-critical | downstream bisa salah interpretasi |
| Quarantine | async event/batch | perlu operational queue |
| Fallback default | low-risk UI label | silent semantic loss |
| Feature-flag mapping | staged rollout | complexity bertambah |

Untuk workflow regulatory, biasanya lebih aman:

```text
Unknown code -> quarantine/reject with diagnostic, not silent default.
```

---

## 11. Date/Time Translation

External date/time adalah sumber bug klasik.

Masalah umum:

- `2026-06-17` tanpa timezone,
- `17/06/2026`,
- `20260617`,
- epoch seconds vs milliseconds,
- timezone provider implicit,
- daylight saving untuk negara tertentu,
- local business date vs instant event time.

### 11.1 Pisahkan Business Date dan Event Time

```java
public record ExternalDecisionTime(
    LocalDate businessDate,
    Instant receivedAt,
    ZoneId sourceZone
) {}
```

Jangan semua dipaksa menjadi `Instant`.

Contoh:

- tanggal lahir: `LocalDate`, bukan `Instant`.
- tanggal effective license: `LocalDate`, mungkin dengan timezone rule.
- waktu event diterima: `Instant`.
- waktu external mengklaim memproses: `OffsetDateTime` atau `Instant` + source timezone.

---

### 11.2 Date Parser Boundary-Specific

```java
public final class PartnerXDateParser {
    private static final DateTimeFormatter DATE =
        DateTimeFormatter.ofPattern("dd/MM/uuuu").withResolverStyle(ResolverStyle.STRICT);

    public LocalDate parseBusinessDate(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new ExternalMappingException("Missing date field: " + fieldName);
        }
        try {
            return LocalDate.parse(value, DATE);
        } catch (DateTimeParseException ex) {
            throw new ExternalMappingException(
                "Invalid PartnerX date field " + fieldName + ": " + value,
                ex
            );
        }
    }
}
```

Jangan menaruh format external partner ke global `ObjectMapper`, karena format itu milik boundary tersebut.

---

## 12. Stringly-Typed Number and Money

External sering mengirim amount sebagai string.

```json
{
  "amount": "1,000.50",
  "currency": "SGD"
}
```

Jangan parsing asal:

```java
new BigDecimal(amountString.replace(",", ""));
```

Minimal policy:

- separator apa yang diterima,
- scale maksimum,
- rounding dilarang atau tidak,
- currency mandatory atau tidak,
- negative allowed atau tidak,
- empty string behavior,
- scientific notation allowed atau tidak.

Contoh:

```java
public record MoneyAmount(BigDecimal amount, Currency currency) {
    public MoneyAmount {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.scale() > 2) {
            throw new IllegalArgumentException("Money scale must be <= 2");
        }
    }
}
```

---

## 13. Inbound Integration Pipeline

Desain pipeline inbound yang eksplisit:

```text
1. Receive payload
2. Decode transport
3. Parse into external DTO
4. Validate minimal transport contract
5. Normalize external quirks
6. Translate external semantics
7. Validate internal command/result
8. Execute application use case
9. Store provenance/audit
```

### 13.1 Contoh Flow

```java
public final class PartnerXInboundHandler {

    private final ObjectMapper partnerXObjectMapper;
    private final PartnerXNormalizer normalizer;
    private final PartnerXTranslator translator;
    private final ApplicationService applicationService;

    public void handle(String rawJson, IntegrationContext context) {
        PartnerXEventDto dto = parse(rawJson, context);
        NormalizedPartnerXEvent normalized = normalizer.normalize(dto, context);
        InternalApplicationCommand command = translator.toCommand(normalized);
        applicationService.handle(command);
    }

    private PartnerXEventDto parse(String rawJson, IntegrationContext context) {
        try {
            return partnerXObjectMapper.readValue(rawJson, PartnerXEventDto.class);
        } catch (JsonProcessingException ex) {
            throw IntegrationParseException.forSource("PartnerX", context.correlationId(), ex);
        }
    }
}
```

---

## 14. Outbound Integration Pipeline

Outbound berbeda. Kita mengontrol payload yang dikirim.

```text
1. Receive internal request
2. Validate outbound precondition
3. Translate internal model to external request DTO
4. Apply external code/date/format rules
5. Serialize with partner-specific writer
6. Send request
7. Parse response
8. Translate response to internal result
9. Store request/response metadata safely
```

Contoh:

```java
public final class PartnerXOutboundGateway {

    private final PartnerXClient client;
    private final PartnerXOutboundMapper mapper;
    private final PartnerXResponseMapper responseMapper;

    public VerificationResult verify(ApplicantVerificationRequest request) {
        PartnerXVerifyRequest externalRequest = mapper.toExternal(request);
        PartnerXVerifyResponse externalResponse = client.verify(externalRequest);
        return responseMapper.toInternal(externalResponse);
    }
}
```

---

## 15. Idempotency Key Shape

Dalam integrasi, mapping tidak hanya body. Kadang header dan key juga bagian dari contract.

Contoh outbound:

```http
POST /verify
Idempotency-Key: applicant-verification:ACEAS:APP-2026-001:1
```

Key harus stabil dan bermakna:

```java
public final class IdempotencyKeyFactory {
    public String applicantVerification(ApplicationId appId, int attemptGroup) {
        return "applicant-verification:ACEAS:" + appId.value() + ":" + attemptGroup;
    }
}
```

Pertanyaan desain:

- apakah retry memakai key sama?
- apakah re-submission memakai key baru?
- apakah key mengandung PII? Seharusnya tidak.
- apakah key deterministic?
- apakah provider menyimpan key berapa lama?

---

## 16. Retry-Safe Transformation

Mapper integration harus deterministic.

Buruk:

```java
externalRequest.setRequestId(UUID.randomUUID().toString());
externalRequest.setTimestamp(Instant.now());
```

Jika retry terjadi, payload berubah.

Lebih baik:

```java
public PartnerXRequest toExternal(InternalRequest request, RequestEnvelope envelope) {
    return new PartnerXRequest(
        envelope.externalRequestId(),
        envelope.requestedAt(),
        request.applicantId().value()
    );
}
```

`requestId` dan `requestedAt` dibuat di orchestration layer, bukan diam-diam di mapper.

Rule:

> Mapper sebaiknya pure/deterministic. Entropy seperti time, random id, sequence number, dan network lookup harus eksplisit sebagai context/input.

---

## 17. Handling Legacy Payload Version

External payload sering tidak versioned secara formal.

Contoh:

```json
{
  "version": "2",
  "application": {
    "id": "APP-001"
  }
}
```

Atau tanpa version:

```json
{
  "applId": "APP-001"
}
```

Strategy:

```text
Detect -> Parse -> Normalize -> Translate
```

Contoh:

```java
public interface PartnerXPayloadAdapter {
    boolean supports(JsonNode root);
    NormalizedPartnerXPayload normalize(JsonNode root);
}
```

```java
public final class PartnerXPayloadRouter {
    private final List<PartnerXPayloadAdapter> adapters;

    public NormalizedPartnerXPayload route(JsonNode root) {
        return adapters.stream()
            .filter(adapter -> adapter.supports(root))
            .findFirst()
            .orElseThrow(() -> new UnsupportedExternalPayloadVersionException("PartnerX"))
            .normalize(root);
    }
}
```

Ini berguna ketika provider tidak reliable dengan schema version.

---

## 18. JSON Tree Model untuk Legacy/Unstable Payload

Untuk payload yang sangat tidak stabil, langsung databind ke DTO kadang terlalu rapuh.

Gunakan `JsonNode` sebagai staging:

```java
JsonNode root = objectMapper.readTree(rawJson);
String applicationId = root.path("application").path("id").asText(null);
String legacyApplicationId = root.path("applId").asText(null);
```

Tapi jangan sebarkan `JsonNode` ke seluruh aplikasi.

Batas aman:

```text
JsonNode hanya di adapter/normalizer layer.
Internal application/domain tidak boleh tahu JsonNode.
```

---

## 19. XML Integration Payload

Untuk XML, masalah sering bukan hanya field, tetapi:

- namespace,
- wrapper element,
- attribute vs element,
- optional empty element,
- XSD evolution,
- canonicalization,
- signature,
- SOAP-like envelope.

Mapping XML integration sering butuh dua level:

```text
Envelope DTO -> Body DTO -> Internal Model
```

Contoh:

```xml
<Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
  <Body>
    <VerifyResponse xmlns="urn:partnerx:verification:v2">
      <ReferenceNo>X123</ReferenceNo>
      <Status>A</Status>
    </VerifyResponse>
  </Body>
</Envelope>
```

Jangan mapping body langsung kalau envelope membawa metadata penting seperti:

- message id,
- correlation id,
- signature,
- timestamp,
- source system,
- fault.

---

## 20. Error Mapping dari External System

External error bukan exception internal.

Contoh external:

```json
{
  "errorCode": "E4017",
  "message": "Applicant not found",
  "trace": "abc"
}
```

Internal result:

```java
public sealed interface VerificationResult permits
    VerificationResult.Verified,
    VerificationResult.NotFound,
    VerificationResult.ExternalUnavailable,
    VerificationResult.ExternalRejected,
    VerificationResult.UnknownFailure {

    record Verified(String referenceNo) implements VerificationResult {}
    record NotFound(String reason, IntegrationProvenance provenance) implements VerificationResult {}
    record ExternalUnavailable(String reason) implements VerificationResult {}
    record ExternalRejected(String code, String safeMessage) implements VerificationResult {}
    record UnknownFailure(String category) implements VerificationResult {}
}
```

Untuk Java 8, gunakan class hierarchy biasa atau enum + payload.

### 20.1 Jangan Leak External Error Mentah

Buruk:

```java
throw new RuntimeException(externalError.getMessage());
```

Lebih baik:

```java
throw new ExternalServiceRejectedException(
    "PartnerX rejected verification request",
    externalError.getErrorCode(),
    safeMessage(externalError.getMessage())
);
```

Internal user/client tidak perlu melihat trace provider.

---

## 21. Provenance: Simpan Jejak Transformasi

Dalam sistem regulatory/case-management, hasil integrasi perlu bisa dijelaskan.

Provenance minimal:

```java
public record IntegrationProvenance(
    String sourceSystem,
    String sourceReferenceNo,
    String externalStatusCode,
    Instant receivedAt,
    String correlationId,
    String payloadHash,
    String contractVersion
) {}
```

Kenapa penting?

- audit trail,
- dispute handling,
- replay,
- bug investigation,
- compliance evidence,
- mapping decision explanation.

Contoh:

```text
External status A from PartnerX v2 was translated to APPROVED_PRELIMINARY at 2026-06-17T01:00:00Z using mapping table version 2026-05.
```

---

## 22. Mapping Table Versioning

Jika code translation berubah, hasil lama tidak boleh kehilangan konteks.

Contoh mapping table:

| Version | External Code | Internal Status | Effective From |
|---|---|---|---|
| 2026-01 | A | ACTIVE | 2026-01-01 |
| 2026-05 | A | APPROVED_PRELIMINARY | 2026-05-01 |

Jika payload lama diproses ulang, harus jelas menggunakan mapping version mana:

- version at processing time,
- version at event occurred time,
- version configured for source contract version.

Untuk case regulatory, pilihan ini harus eksplisit.

---

## 23. Reference Data Lookup dalam Mapper

Mapper idealnya tidak melakukan remote call.

Buruk:

```java
public InternalCommand map(ExternalDto dto) {
    Country country = countryApi.lookup(dto.getCountryCode());
    return new InternalCommand(country);
}
```

Masalah:

- mapper tidak deterministic,
- sulit test,
- mapping bisa lambat,
- retry behavior kacau,
- circuit breaker tersembunyi,
- N+1 remote lookup.

Lebih baik:

```java
public InternalCommand map(ExternalDto dto, ReferenceDataSnapshot refData) {
    Country country = refData.countryByExternalCode(dto.getCountryCode());
    return new InternalCommand(country);
}
```

Reference data disiapkan di orchestration layer.

---

## 24. Integration Mapper dengan MapStruct

MapStruct bisa membantu, tetapi jangan pakai secara naif.

Cocok untuk:

- field copy eksplisit,
- nested object mapping,
- simple conversion,
- enum mapping yang stabil,
- DTO antar shape yang jelas.

Tidak cukup untuk:

- ambiguous legacy logic,
- multi-version routing,
- error classification kompleks,
- provenance assembly kompleks,
- non-deterministic enrichment,
- retry/idempotency context.

Contoh:

```java
@Mapper(componentModel = "spring", uses = PartnerXCodeTranslator.class)
public interface PartnerXApplicationMapper {

    @Mapping(target = "applicationId", source = "applNo")
    @Mapping(target = "applicantName", source = "applNm")
    @Mapping(target = "status", source = "stsCd")
    NormalizedPartnerXApplication normalize(PartnerXApplicationResponse response);
}
```

Pastikan `PartnerXCodeTranslator` jelas dan testable.

---

## 25. Integration Mapper dengan Jackson

Jackson config sebaiknya boundary-specific.

```java
public final class PartnerXObjectMapperFactory {

    public static ObjectMapper create() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        mapper.configure(DeserializationFeature.READ_UNKNOWN_ENUM_VALUES_AS_NULL, false);
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }
}
```

Catatan:

- Unknown property bisa false untuk tolerant external reader.
- Unknown enum jangan otomatis null jika status memengaruhi keputusan penting.
- Date format external jangan dijadikan global kecuali memang enterprise-wide standard.
- Gunakan `ObjectReader`/`ObjectWriter` untuk contract tertentu.

---

## 26. Handling Unknown Fields dengan Observability

Jika tolerant reader ignore unknown field, kita tetap ingin tahu ketika provider berubah.

Approach:

```java
JsonNode root = objectMapper.readTree(rawJson);
Set<String> knownFields = Set.of("referenceNo", "status", "resultCode");
Iterator<String> names = root.fieldNames();
while (names.hasNext()) {
    String name = names.next();
    if (!knownFields.contains(name)) {
        contractObserver.recordUnknownField("PartnerX", name);
    }
}
```

Untuk nested object, bisa pakai recursive scanner.

Tapi hati-hati:

- jangan log value sensitif,
- sampling di production,
- aktifkan detail penuh di non-production,
- alert jika unknown field muncul di critical object.

---

## 27. Contract Drift Detection

Contract drift terjadi ketika real payload berbeda dari contract yang kita pahami.

Gejala:

- parsing error meningkat,
- unknown code muncul,
- field mandatory kosong,
- enum baru muncul,
- date format berubah,
- payload wrapper berubah,
- XML namespace berubah.

Mitigasi:

1. golden payload test,
2. provider sample payload repository,
3. schema validation where useful,
4. consumer-driven contract test,
5. unknown field/code monitoring,
6. replay test from captured redacted payload,
7. versioned adapter.

---

## 28. Golden Payload untuk External Integration

Simpan contoh payload nyata/representatif.

```text
src/test/resources/contracts/partnerx/v1/verify-approved.json
src/test/resources/contracts/partnerx/v1/verify-rejected.json
src/test/resources/contracts/partnerx/v1/verify-not-found.json
src/test/resources/contracts/partnerx/v2/verify-approved-new-field.json
src/test/resources/contracts/partnerx/legacy/verify-old-date-format.json
```

Test:

```java
@Test
void shouldTranslateApprovedPayload() throws Exception {
    String json = readResource("contracts/partnerx/v1/verify-approved.json");

    PartnerXVerifyResponse dto = objectMapper.readValue(json, PartnerXVerifyResponse.class);
    VerificationResult result = mapper.toInternal(dto);

    assertThat(result).isInstanceOf(VerificationResult.Verified.class);
}
```

Golden payload bukan hanya untuk serialization. Untuk integration mapping, golden payload adalah contract memory.

---

## 29. Quarantine Pattern untuk Payload Bermasalah

Tidak semua payload gagal harus langsung hilang.

Untuk async/batch/event integration:

```text
Parse failed / unknown code / semantic conflict
        -> quarantine table/topic
        -> alert/ops review
        -> mapping table update or provider fix
        -> replay
```

Quarantine record:

```java
public record QuarantinedIntegrationPayload(
    String sourceSystem,
    String correlationId,
    String payloadHash,
    String redactedPayload,
    String failureCategory,
    String failureMessage,
    Instant receivedAt,
    int retryCount
) {}
```

Jangan quarantine tanpa replay strategy. Kalau tidak bisa replay, itu hanya graveyard.

---

## 30. Integration Mapping Failure Taxonomy

| Failure | Contoh | Handling |
|---|---|---|
| Transport failure | HTTP timeout | retry/circuit breaker |
| Parse failure | malformed JSON/XML | reject/quarantine |
| Binding failure | wrong type | reject/quarantine |
| Conversion failure | invalid date | reject/quarantine |
| Unknown code | new enum | quarantine/manual mapping update |
| Semantic conflict | status approved but rejection reason present | reject/manual review |
| Missing mandatory | no applicant id | reject/provider defect |
| Duplicate payload | same event id | idempotent ignore/update |
| Out-of-order event | approval before submission | buffer/reconcile/domain rule |
| External rejection | provider business error | map to internal result |

Mapping layer harus bisa mengklasifikasi failure, bukan semua menjadi `RuntimeException`.

---

## 31. Out-of-Order and Duplicate Event Mapping

Event integration butuh metadata.

```java
public record ExternalEventEnvelope<T>(
    String eventId,
    String eventType,
    Instant occurredAt,
    Instant receivedAt,
    String sourceSystem,
    String schemaVersion,
    T payload
) {}
```

Mapper tidak menyelesaikan ordering sendiri, tetapi harus menjaga informasi:

- event id,
- occurred at,
- sequence number jika ada,
- source aggregate id,
- version,
- causation/correlation id.

Tanpa metadata ini, application layer tidak bisa idempotent.

---

## 32. Inbound Normalization: Reject vs Repair

Normalization bisa memperbaiki hal kecil:

- trim whitespace,
- uppercase code,
- normalize empty string to null jika policy jelas,
- remove formatting dash dari ID number jika allowed,
- parse date format documented.

Tapi jangan memperbaiki semantic ambiguity.

Contoh aman:

```text
" id " -> "id"
"sgd" -> "SGD"
"2026-06-17 " -> "2026-06-17"
```

Contoh berbahaya:

```text
unknown status "A1" -> assume APPROVED
missing identity number -> generate dummy
invalid date -> use today
negative amount -> absolute value
```

Rule:

> Normalize representation, not truth.

---

## 33. Outbound Canonicalization

Outbound payload harus stabil.

Contoh:

```java
public final class PartnerXOutboundMapper {

    public PartnerXVerifyRequest toExternal(ApplicantVerificationRequest request) {
        return new PartnerXVerifyRequest(
            request.applicationId().value(),
            canonicalName(request.name()),
            formatIdentity(request.identityNumber()),
            formatDate(request.dateOfBirth())
        );
    }

    private String canonicalName(ApplicantName name) {
        return name.value().trim();
    }

    private String formatDate(LocalDate date) {
        return date.format(DateTimeFormatter.BASIC_ISO_DATE); // yyyyMMdd
    }
}
```

Outbound canonicalization memastikan retry, golden tests, dan provider expectation konsisten.

---

## 34. Layering Example End-to-End

### 34.1 External Payload

```json
{
  "appl_no": "APP-2026-001",
  "appl_nm": " Fajar Abdi ",
  "id_no": "S1234567A",
  "sts_cd": "A",
  "decision_dt": "17/06/2026",
  "extra_future_field": "ignore-me"
}
```

### 34.2 External DTO

```java
public class PartnerXApplicationResponse {
    @JsonProperty("appl_no")
    private String applNo;

    @JsonProperty("appl_nm")
    private String applNm;

    @JsonProperty("id_no")
    private String idNo;

    @JsonProperty("sts_cd")
    private String stsCd;

    @JsonProperty("decision_dt")
    private String decisionDt;

    // getters/setters
}
```

### 34.3 Normalized Model

```java
public record NormalizedPartnerXApplication(
    String applicationNumber,
    String applicantName,
    String identityNumber,
    String externalStatusCode,
    LocalDate decisionDate,
    IntegrationProvenance provenance
) {}
```

### 34.4 Translator

```java
public final class PartnerXApplicationTranslator {

    private final PartnerXStatusTranslator statusTranslator;
    private final PartnerXDateParser dateParser;

    public InternalApplicationDecision translate(
            PartnerXApplicationResponse response,
            IntegrationContext context
    ) {
        LocalDate decisionDate = dateParser.parseBusinessDate(
            response.getDecisionDt(),
            "decision_dt"
        );

        InternalDecisionStatus status = statusTranslator.translate(response.getStsCd());

        return new InternalApplicationDecision(
            new ApplicationNumber(requiredTrim(response.getApplNo(), "appl_no")),
            ApplicantName.of(requiredTrim(response.getApplNm(), "appl_nm")),
            IdentityNumber.of(requiredTrim(response.getIdNo(), "id_no")),
            status,
            decisionDate,
            IntegrationProvenance.from("PartnerX", context, response.getStsCd())
        );
    }

    private String requiredTrim(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new ExternalMappingException("Missing required PartnerX field: " + field);
        }
        return value.trim();
    }
}
```

---

## 35. What Should Be in Mapper vs Outside Mapper

### Mapper boleh melakukan:

- field rename,
- object shape conversion,
- deterministic type conversion,
- code translation with local table,
- normalization yang jelas,
- provenance assembly dari supplied context,
- safe redaction for logs,
- wrapping result/error.

### Mapper sebaiknya tidak melakukan:

- remote API call,
- database query,
- random UUID generation tanpa input,
- `Instant.now()` tanpa input,
- business workflow decision,
- authorization decision,
- retry loop,
- persistence save,
- hidden feature flag branching tanpa explicit policy,
- swallowing unknown semantic values.

---

## 36. Java 8 sampai Java 25: Implementation Style

### Java 8 Style

```java
public final class IntegrationProvenance {
    private final String sourceSystem;
    private final String sourceReference;
    private final Instant receivedAt;

    public IntegrationProvenance(String sourceSystem, String sourceReference, Instant receivedAt) {
        this.sourceSystem = Objects.requireNonNull(sourceSystem);
        this.sourceReference = sourceReference;
        this.receivedAt = Objects.requireNonNull(receivedAt);
    }

    public String getSourceSystem() { return sourceSystem; }
    public String getSourceReference() { return sourceReference; }
    public Instant getReceivedAt() { return receivedAt; }
}
```

### Java 16+ / 21 / 25 Style

```java
public record IntegrationProvenance(
    String sourceSystem,
    String sourceReference,
    Instant receivedAt
) {
    public IntegrationProvenance {
        Objects.requireNonNull(sourceSystem, "sourceSystem");
        Objects.requireNonNull(receivedAt, "receivedAt");
    }
}
```

### Sealed Result untuk Integration Outcome

```java
public sealed interface PartnerXOutcome permits
    PartnerXOutcome.Success,
    PartnerXOutcome.BusinessRejected,
    PartnerXOutcome.Unavailable,
    PartnerXOutcome.MappingFailed {

    record Success(VerificationResult result) implements PartnerXOutcome {}
    record BusinessRejected(String code, String message) implements PartnerXOutcome {}
    record Unavailable(String reason) implements PartnerXOutcome {}
    record MappingFailed(String category, String detail) implements PartnerXOutcome {}
}
```

Untuk Java 8, gunakan interface + final classes.

---

## 37. Security Considerations

Integration mapping boundary adalah security boundary.

Perhatikan:

- jangan trust external field,
- jangan deserialize polymorphic type dari external tanpa whitelist,
- jangan log raw payload berisi PII/secret,
- jangan expose provider error mentah ke user,
- jangan kirim internal-only field outbound,
- jangan menerima unknown critical enum sebagai null,
- batasi payload size/depth,
- harden XML parser terhadap XXE,
- validasi signature sebelum mempercayai payload signed,
- pastikan retry tidak menggandakan side effect.

---

## 38. Observability Checklist

Setiap integration mapper production-grade perlu menjawab:

- payload dari source system mana?
- contract version apa?
- correlation id apa?
- external reference id apa?
- parsing berhasil atau gagal?
- field/code mana yang unknown?
- mapping table version apa?
- internal status hasil translation apa?
- payload hash apa?
- apakah payload replayable?
- apakah error aman ditampilkan?

Contoh structured log:

```json
{
  "event": "integration_mapping_failed",
  "sourceSystem": "PartnerX",
  "correlationId": "corr-123",
  "externalReference": "PX-998",
  "failureCategory": "UNKNOWN_EXTERNAL_CODE",
  "field": "sts_cd",
  "externalCode": "A1",
  "mappingVersion": "2026-05",
  "payloadHash": "sha256:..."
}
```

Jangan log payload penuh kecuali sudah redacted dan sesuai policy.

---

## 39. Testing Matrix

Minimal test untuk integration mapping:

| Test | Tujuan |
|---|---|
| golden inbound payload | memastikan sample external tetap terbaca |
| golden outbound payload | memastikan request ke provider stabil |
| unknown field test | tolerant reader tidak rusak |
| unknown critical code test | mapper reject/quarantine |
| missing mandatory field | error jelas |
| malformed date | error field-specific |
| legacy version payload | backward compatibility |
| new version payload | forward compatibility jika allowed |
| duplicate event metadata | idempotency support |
| redaction test | payload/log aman |
| error response mapping | provider error jadi internal result benar |
| replay test | quarantined payload bisa diproses ulang |

---

## 40. Review Checklist untuk Pull Request

Saat review integration mapper, tanyakan:

1. Apakah external DTO bocor ke domain/application internal?
2. Apakah external code diterjemahkan eksplisit?
3. Apakah unknown code ditangani dengan policy yang benar?
4. Apakah date/time memiliki timezone/business-date policy?
5. Apakah mapper deterministic dan retry-safe?
6. Apakah outbound payload punya golden test?
7. Apakah inbound payload punya golden test?
8. Apakah payload sensitif tidak dilog mentah?
9. Apakah provenance cukup untuk audit/debug?
10. Apakah error provider tidak bocor mentah ke user?
11. Apakah reference data lookup tidak tersembunyi di mapper?
12. Apakah version drift bisa terdeteksi?
13. Apakah MapStruct/Jackson config boundary-specific?
14. Apakah mapping behavior sama di DEV/UAT/PROD?
15. Apakah ada replay/quarantine strategy untuk async/batch?

---

## 41. Common Anti-Patterns

### 41.1 External DTO Dipakai Sebagai Internal DTO

```java
public void process(PartnerXResponse response) {
    domainService.process(response);
}
```

Masalah:

- domain tercemar external language,
- provider change merusak internal logic,
- testing domain bergantung sample external,
- coupling meningkat.

---

### 41.2 Global ObjectMapper untuk Semua Partner

```java
@Autowired ObjectMapper objectMapper;
```

Lalu semua partner memakai config sama.

Masalah:

- format date partner A memengaruhi partner B,
- strictness tidak boundary-specific,
- custom deserializer global menyebabkan side effect,
- debugging sulit.

---

### 41.3 Fallback Default untuk Unknown Critical Code

```java
return InternalStatus.PENDING;
```

untuk semua unknown external code.

Masalah:

- silent data corruption,
- salah workflow,
- audit misleading,
- provider change tidak terdeteksi.

---

### 41.4 Mapper Menjadi Service Layer

```java
public InternalCommand map(ExternalDto dto) {
    User user = userRepository.findById(dto.getUserId()).orElseThrow();
    Permission permission = authService.check(user);
    externalAuditClient.send(...);
    return ...;
}
```

Ini bukan mapper lagi. Ini orchestration/service logic tersembunyi.

---

## 42. Practical Architecture Blueprint

Untuk satu partner integration:

```text
PartnerXGateway
  - implements internal port
  - coordinates client + mapper + error mapper

PartnerXClient
  - HTTP/SOAP/file/message transport
  - no domain semantics

PartnerXDto
  - mirrors external contract

PartnerXNormalizer
  - cleans representation quirks

PartnerXTranslator
  - translates external semantics to internal semantics

PartnerXCodeTranslator
  - maps external code table

PartnerXDateParser
  - parses boundary-specific dates

PartnerXErrorMapper
  - converts external errors to internal failures

PartnerXContractTests
  - golden payload and compatibility tests
```

---

## 43. Mini Case Study: Regulatory Case Status Sync

External sends:

```json
{
  "case_no": "C-2026-001",
  "stage": "INV",
  "sub_stage": "PEND_DOC",
  "status": "A",
  "updated_at": "2026-06-17 08:30:00"
}
```

Internal case model:

```java
CaseLifecycleState state;
CaseEscalationStatus escalationStatus;
CaseDocumentRequirement documentRequirement;
```

Naive mapping:

```text
status A -> ACTIVE
stage INV -> INVESTIGATION
sub_stage PEND_DOC -> PENDING_DOCUMENT
```

Butuh semantic decision:

```text
stage=INV + sub_stage=PEND_DOC + status=A
    -> CaseLifecycleState.UNDER_INVESTIGATION
    -> CaseDocumentRequirement.WAITING_FOR_EXTERNAL_DOCUMENT
    -> no escalation yet
```

Ini bukan field mapping satu-ke-satu. Ini **external state translation**.

Mapper harus explicit:

```java
public CaseSyncCommand translate(ExternalCaseStatus dto, IntegrationContext context) {
    ExternalCaseCompositeStatus composite = new ExternalCaseCompositeStatus(
        dto.getStage(),
        dto.getSubStage(),
        dto.getStatus()
    );

    InternalCaseState state = caseStateTranslator.translate(composite);

    return new CaseSyncCommand(
        new CaseNumber(dto.getCaseNo()),
        state,
        parseExternalTimestamp(dto.getUpdatedAt()),
        IntegrationProvenance.from("PartnerX", context, dto.getStatus())
    );
}
```

---

## 44. Latihan Desain

Bayangkan external API mengirim payload:

```json
{
  "application_id": "APP-001",
  "person": {
    "full_name": " Fajar Abdi Nugraha ",
    "id_type": "NRIC",
    "id_no": "S1234567A"
  },
  "company": null,
  "application_status": "AP",
  "submitted_date": "17/06/2026",
  "decision": {
    "code": "OK",
    "reason": ""
  }
}
```

Tugas:

1. Buat External DTO.
2. Buat Normalized Model.
3. Buat Internal Command.
4. Tentukan mapping `application_status = AP`.
5. Tentukan policy empty reason.
6. Tentukan date parser.
7. Tentukan unknown code behavior.
8. Tentukan provenance.
9. Tentukan golden payload tests.
10. Tentukan field mana yang tidak boleh bocor ke domain.

---

## 45. Ringkasan Inti

Integration mapping adalah salah satu tempat paling penting untuk menjaga kesehatan arsitektur.

Prinsip utama:

1. External model bukan internal domain.
2. Gunakan anti-corruption layer untuk menerjemahkan bahasa external ke bahasa internal.
3. External DTO boleh mengikuti bentuk external, tetapi harus dikarantina.
4. Translation semantic harus eksplisit.
5. Tolerant reader berguna untuk evolusi contract, tetapi tidak boleh menyembunyikan unknown critical value.
6. Outbound payload harus strict, deterministic, dan punya golden test.
7. Code table/date/time/money harus punya policy, bukan parsing ad-hoc.
8. Mapper harus deterministic dan retry-safe.
9. Provenance penting untuk audit, debugging, dan replay.
10. Contract drift harus bisa dideteksi, bukan baru diketahui setelah business failure.

---

## 46. Koneksi ke Part Berikutnya

Bagian berikutnya adalah:

> **Part 33 — Mapping Governance: Standards, Reviews, Compatibility Policy**

Setelah memahami mapping integrasi, kita akan naik satu level lagi: bagaimana membuat standar tim/organisasi supaya mapping layer tidak bergantung pada selera personal engineer.

Topik berikutnya:

- DTO naming convention,
- mapper placement standard,
- ObjectMapper profile policy,
- MapStruct reporting policy,
- Lombok allowed/disallowed list,
- compatibility review,
- security checklist,
- generated code review,
- governance untuk long-lived Java systems.
