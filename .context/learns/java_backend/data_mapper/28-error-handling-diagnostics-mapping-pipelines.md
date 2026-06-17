# Part 28 — Error Handling and Diagnostics in Mapping Pipelines

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `28-error-handling-diagnostics-mapping-pipelines.md`  
> Posisi: Part 28 dari 35  
> Fokus: error handling, diagnostics, observability, safe logging, replayability, dan operational design untuk pipeline mapping JSON/XML/DTO/domain/event/integration.

---

## 0. Kenapa Error Handling Mapping Itu Penting

Di sistem kecil, error mapping sering dianggap hal teknis: JSON gagal parse, field salah tipe, enum tidak valid, atau DTO gagal divalidasi.

Di sistem enterprise, regulatory, case management, financial, identity, atau integration-heavy system, error mapping adalah bagian dari **contract enforcement**, **auditability**, **operational diagnosis**, dan **defensive boundary design**.

Masalahnya bukan hanya:

```text
Request invalid.
```

Masalah yang sebenarnya adalah:

```text
Sistem menerima payload dari boundary eksternal.
Payload gagal dipahami.
Kita perlu tahu:
- bagian mana yang gagal,
- apakah gagal karena syntax, binding, conversion, validation, atau semantic rule,
- apakah error aman dikembalikan ke caller,
- apakah payload boleh dilog,
- apakah error bisa direplay,
- apakah ada bug backward compatibility,
- apakah contract producer berubah diam-diam,
- apakah kegagalan ini satu kali atau sistemik,
- apakah perlu masuk dead-letter/retry/manual resolution.
```

Mapping pipeline yang buruk membuat engineer hanya melihat:

```text
Cannot deserialize value of type java.time.LocalDate from String "31/02/2026"
```

Mapping pipeline yang baik memberi diagnosis seperti:

```json
{
  "errorCode": "INVALID_FIELD_FORMAT",
  "message": "Field 'birthDate' must be a valid date in ISO-8601 format yyyy-MM-dd.",
  "path": "/applicant/birthDate",
  "receivedType": "string",
  "expectedType": "date",
  "correlationId": "c-20260617-9f2a",
  "detailsVisibleToClient": true
}
```

Dan untuk log internal:

```json
{
  "event": "mapping.failure",
  "stage": "DESERIALIZATION",
  "boundary": "PUBLIC_API",
  "operation": "CreateApplication",
  "path": "/applicant/birthDate",
  "exceptionClass": "InvalidFormatException",
  "safePayloadFingerprint": "sha256:...",
  "correlationId": "c-20260617-9f2a",
  "payloadStored": false,
  "sensitiveFieldsRedacted": true
}
```

Part ini membangun cara berpikir bahwa mapping error bukan exception acak, tetapi **domain dari failure handling** yang perlu didesain.

---

## 1. Mental Model: Mapping Pipeline sebagai Serangkaian Gate

Mapping pipeline idealnya tidak dipandang sebagai satu langkah:

```text
JSON -> DTO -> Domain
```

Lebih tepat:

```text
Raw Input
  -> Transport Gate
  -> Syntax Gate
  -> Structural Binding Gate
  -> Type Conversion Gate
  -> Boundary Validation Gate
  -> Normalization Gate
  -> Semantic Mapping Gate
  -> Domain Invariant Gate
  -> Persistence/Event/Integration Projection Gate
```

Setiap gate memiliki jenis error berbeda.

| Gate | Pertanyaan | Contoh Error |
|---|---|---|
| Transport gate | Apakah request bisa dibaca? | body terlalu besar, encoding salah, content-type salah |
| Syntax gate | Apakah JSON/XML well-formed? | JSON koma salah, XML tag tidak tertutup |
| Binding gate | Apakah struktur cocok ke DTO? | object diharapkan array, unknown field, missing creator property |
| Type conversion gate | Apakah nilai bisa dikonversi? | string ke enum gagal, date invalid, number overflow |
| Boundary validation gate | Apakah input memenuhi aturan boundary? | mandatory field kosong, panjang string melebihi batas |
| Normalization gate | Apakah input perlu dibersihkan secara deterministik? | trim whitespace, uppercase code, normalize phone |
| Semantic mapping gate | Apakah input bisa diterjemahkan ke command/domain intent? | code external tidak dikenal, state transition tidak valid |
| Domain invariant gate | Apakah model domain tetap sah? | applicant underage, duplicate active license |
| Projection gate | Apakah output bisa dibentuk? | lazy proxy gagal, cycle object, missing reference |

Prinsip penting:

> Error yang berbeda gate-nya tidak boleh dilempar sebagai error generik yang sama.

Karena tindakan operasionalnya berbeda:

- syntax error biasanya client harus memperbaiki payload;
- unknown field bisa jadi client bug atau contract drift;
- semantic mapping error bisa jadi reference data belum sinkron;
- domain invariant error bisa jadi request valid secara format tapi ditolak secara bisnis;
- projection error bisa jadi bug internal server;
- integration mapping error bisa jadi perlu dead-letter/manual repair.

---

## 2. Taxonomy Error Mapping

### 2.1 Parse Error

Parse error terjadi sebelum object Java terbentuk.

Contoh JSON invalid:

```json
{
  "name": "Fajar",
  "age": 29,
}
```

Trailing comma dapat gagal tergantung konfigurasi parser.

Contoh XML invalid:

```xml
<Application>
  <Applicant>Fajar</Application>
```

Karakteristik:

- belum ada DTO;
- belum bisa validasi field domain;
- path mungkin hanya line/column;
- biasanya error external/client;
- jangan log full raw body tanpa redaction policy.

Respons API sebaiknya:

```json
{
  "errorCode": "MALFORMED_JSON",
  "message": "Request body is not valid JSON.",
  "correlationId": "c-..."
}
```

Jangan mengembalikan stack trace parser.

---

### 2.2 Binding Error

Binding error terjadi saat payload syntactically valid, tetapi tidak cocok dengan bentuk DTO.

Contoh:

```json
{
  "applicant": [
    { "name": "Fajar" }
  ]
}
```

Padahal DTO mengharapkan:

```java
record CreateApplicationRequest(ApplicantDto applicant) {}
```

Error-nya bukan syntax JSON. JSON valid, tetapi struktur tidak cocok.

Contoh error binding:

- expected object but got array;
- creator property missing;
- unknown property;
- duplicate property;
- field tidak punya setter/constructor parameter;
- no suitable constructor;
- builder tidak dikenali;
- immutable object tidak bisa diisi.

Respons:

```json
{
  "errorCode": "INVALID_PAYLOAD_SHAPE",
  "message": "Field 'applicant' must be an object.",
  "path": "/applicant",
  "expected": "object",
  "actual": "array",
  "correlationId": "c-..."
}
```

---

### 2.3 Type Conversion Error

Type conversion error terjadi saat field ada dan struktur benar, tetapi nilai tidak bisa dikonversi.

Contoh:

```json
{
  "birthDate": "31/02/2026",
  "amount": "ABC",
  "status": "SUBMITED"
}
```

Masalah:

- date format invalid;
- decimal invalid;
- enum unknown;
- boolean ambiguous;
- integer overflow;
- timezone invalid;
- currency code unknown;
- identifier format invalid.

Respons:

```json
{
  "errorCode": "INVALID_FIELD_FORMAT",
  "message": "Field 'birthDate' must use format yyyy-MM-dd.",
  "path": "/birthDate",
  "correlationId": "c-..."
}
```

Senior-level point:

> Conversion error harus dibedakan dari validation error. `birthDate = "abc"` adalah conversion error; `birthDate = "1900-01-01"` mungkin validation/domain error.

---

### 2.4 Validation Error

Validation error terjadi setelah nilai berhasil dibaca ke bentuk Java yang representatif, tetapi tidak memenuhi constraint boundary.

Contoh DTO:

```java
public record CreateApplicantRequest(
    @NotBlank
    String name,

    @Email
    String email,

    @Past
    LocalDate birthDate
) {}
```

Payload:

```json
{
  "name": "",
  "email": "not-email",
  "birthDate": "2030-01-01"
}
```

JSON valid. Binding valid. Conversion valid. Validation gagal.

Respons:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "violations": [
    {
      "path": "/name",
      "code": "NotBlank",
      "message": "Name is required."
    },
    {
      "path": "/email",
      "code": "Email",
      "message": "Email format is invalid."
    }
  ],
  "correlationId": "c-..."
}
```

---

### 2.5 Semantic Mapping Error

Semantic mapping error terjadi saat payload valid secara format, tetapi tidak bisa diterjemahkan menjadi makna internal.

Contoh:

```json
{
  "applicationTypeCode": "XYZ"
}
```

Secara format `XYZ` valid string. Tetapi code table internal tidak punya application type `XYZ`.

Contoh lain:

- external status code tidak dikenal;
- old reference id sudah tidak aktif;
- enum external perlu mapping tapi tidak ada mapping;
- agency code valid format tapi tidak authorized;
- state transition request tidak bisa diterjemahkan ke command;
- field combination tidak punya interpretasi yang sah.

Respons:

```json
{
  "errorCode": "UNKNOWN_REFERENCE_CODE",
  "message": "Unknown application type code.",
  "path": "/applicationTypeCode",
  "correlationId": "c-..."
}
```

Semantic mapping error sangat penting untuk integration system, karena sering menandakan **contract drift** atau **reference data drift**.

---

### 2.6 Domain Invariant Error

Domain invariant error bukan lagi urusan mapper murni. Payload sudah berhasil menjadi command/domain intent, tetapi domain menolak.

Contoh:

```text
Applicant valid secara data.
Command valid secara shape.
Tetapi applicant tidak memenuhi eligibility policy.
```

Respons:

```json
{
  "errorCode": "APPLICATION_NOT_ELIGIBLE",
  "message": "Applicant is not eligible for this application type.",
  "correlationId": "c-..."
}
```

Bedakan:

```text
INVALID_FIELD_FORMAT       -> boundary/data format problem
VALIDATION_FAILED          -> boundary constraint problem
UNKNOWN_REFERENCE_CODE     -> semantic translation problem
APPLICATION_NOT_ELIGIBLE   -> domain decision problem
```

Jika semua dilempar sebagai `BAD_REQUEST`, debugging jangka panjang akan buruk.

---

### 2.7 Projection Error

Projection error terjadi saat sistem membentuk output DTO/event/XML/JSON dari object internal.

Contoh:

- JPA lazy association belum di-fetch;
- circular reference saat serialization;
- sensitive field tidak sengaja ikut;
- formatter gagal karena nilai internal invalid;
- MapStruct target field unmapped;
- event schema membutuhkan field yang domain belum punya;
- XML namespace/wrapper salah;
- serializer custom gagal.

Projection error sering berarti bug internal, bukan kesalahan client.

Respons external:

```json
{
  "errorCode": "INTERNAL_MAPPING_ERROR",
  "message": "Unable to process the response.",
  "correlationId": "c-..."
}
```

Log internal harus lebih kaya:

```json
{
  "event": "mapping.failure",
  "stage": "PROJECTION",
  "sourceType": "ApplicationAggregate",
  "targetType": "ApplicationResponseDto",
  "operation": "GetApplicationDetail",
  "exceptionClass": "LazyInitializationException",
  "correlationId": "c-..."
}
```

---

## 3. Error Classification Model

A robust mapping layer should classify every mapping failure.

Contoh enum:

```java
public enum MappingFailureStage {
    TRANSPORT,
    PARSE,
    BINDING,
    CONVERSION,
    VALIDATION,
    NORMALIZATION,
    SEMANTIC_MAPPING,
    DOMAIN_INVARIANT,
    PROJECTION,
    INTEGRATION_OUTPUT
}
```

Error object internal:

```java
public record MappingFailure(
    MappingFailureStage stage,
    String code,
    String message,
    String path,
    String sourceType,
    String targetType,
    boolean clientVisible,
    boolean retryable,
    boolean containsSensitiveData,
    Throwable cause
) {}
```

Kenapa ini berguna?

Karena error handling bisa menjadi policy-driven:

```java
public ApiError toApiError(MappingFailure failure, String correlationId) {
    return switch (failure.stage()) {
        case PARSE -> ApiError.badRequest(
            "MALFORMED_JSON",
            "Request body is not valid JSON.",
            correlationId
        );
        case BINDING, CONVERSION -> ApiError.badRequest(
            failure.code(),
            failure.message(),
            failure.path(),
            correlationId
        );
        case VALIDATION -> ApiError.validation(
            failure.message(),
            correlationId
        );
        case SEMANTIC_MAPPING -> ApiError.badRequest(
            failure.code(),
            failure.message(),
            failure.path(),
            correlationId
        );
        case PROJECTION, INTEGRATION_OUTPUT -> ApiError.internal(
            "INTERNAL_MAPPING_ERROR",
            "Unable to process the request.",
            correlationId
        );
        default -> ApiError.internal(
            "INTERNAL_ERROR",
            "Unable to process the request.",
            correlationId
        );
    };
}
```

The key is not the specific Java code. The key is the classification discipline.

---

## 4. Field Path: Dari Exception ke Lokasi yang Dipahami Manusia

### 4.1 Kenapa Field Path Penting

Error seperti ini tidak cukup:

```text
Cannot deserialize value of type `java.time.LocalDate`
```

Lebih baik:

```text
/applicants/2/birthDate
```

Path berguna untuk:

- API client memperbaiki payload;
- FE menandai field yang salah;
- QA membuat test case;
- integration partner debug payload;
- support team membaca log;
- dead-letter repair;
- audit dan incident analysis.

---

### 4.2 JSON Pointer sebagai Format Path

Gunakan format JSON Pointer untuk error field:

```text
/applicant/name
/applicant/address/postalCode
/items/0/amount
/documents/3/fileName
```

Jangan hanya:

```text
applicant.address.postalCode
```

Dot path kurang ideal untuk array dan field yang punya dot di namanya.

JSON Pointer lebih standar untuk JSON document path.

---

### 4.3 Extract Path dari Jackson Exception

Jackson exception seperti `JsonMappingException` biasanya membawa path references.

Contoh helper konseptual:

```java
public final class JacksonPathExtractor {

    private JacksonPathExtractor() {}

    public static String toJsonPointer(JsonMappingException exception) {
        if (exception.getPath() == null || exception.getPath().isEmpty()) {
            return "";
        }

        StringBuilder pointer = new StringBuilder();

        for (JsonMappingException.Reference ref : exception.getPath()) {
            pointer.append('/');

            if (ref.getFieldName() != null) {
                pointer.append(escape(ref.getFieldName()));
            } else if (ref.getIndex() >= 0) {
                pointer.append(ref.getIndex());
            } else {
                pointer.append("?");
            }
        }

        return pointer.toString();
    }

    private static String escape(String segment) {
        return segment
            .replace("~", "~0")
            .replace("/", "~1");
    }
}
```

Path extraction sebaiknya dipusatkan agar semua endpoint menghasilkan error format konsisten.

---

## 5. Error Response Design

### 5.1 Jangan Return Raw Exception Message

Raw exception message sering mengandung:

- nama class internal;
- package internal;
- stack trace;
- SQL/entity hint;
- value sensitif;
- detail library yang tidak stabil;
- pesan terlalu teknis untuk API consumer.

Buruk:

```json
{
  "error": "Cannot construct instance of com.company.internal.caseflow.ApplicationEntity no Creators, like default constructor, exist"
}
```

Lebih baik:

```json
{
  "errorCode": "INVALID_PAYLOAD_SHAPE",
  "message": "Request payload shape is invalid.",
  "path": "/application",
  "correlationId": "c-..."
}
```

---

### 5.2 Error Envelope yang Konsisten

Contoh sederhana:

```java
public record ApiErrorResponse(
    String errorCode,
    String message,
    String correlationId,
    List<FieldViolation> violations
) {}

public record FieldViolation(
    String path,
    String code,
    String message,
    Object rejectedValue
) {}
```

Tetapi hati-hati dengan `rejectedValue`.

Untuk field sensitif, jangan echo:

- password;
- token;
- NRIC/SSN/NIK/passport;
- email jika policy melarang;
- phone;
- address;
- raw document content;
- full payload;
- credit card/payment data;
- internal identifiers.

Versi lebih aman:

```java
public record FieldViolation(
    String path,
    String code,
    String message,
    RejectedValueInfo rejectedValue
) {}

public record RejectedValueInfo(
    boolean present,
    boolean redacted,
    String type,
    Integer length
) {}
```

Contoh respons:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "violations": [
    {
      "path": "/password",
      "code": "Size",
      "message": "Password does not meet length requirement.",
      "rejectedValue": {
        "present": true,
        "redacted": true,
        "type": "string",
        "length": 4
      }
    }
  ],
  "correlationId": "c-..."
}
```

---

### 5.3 One Error vs Many Errors

Parse/binding error sering hanya bisa memberi satu error karena parsing berhenti.

Validation error biasanya bisa memberi banyak violations.

Semantic mapping bisa keduanya:

- fail-fast untuk dependency/reference lookup mahal;
- collect-all untuk batch/import UI;
- collect-all untuk field-level form correction.

Rule praktis:

| Error Type | Bias |
|---|---|
| malformed JSON/XML | one error |
| binding shape error | one/few errors |
| field validation | many errors |
| semantic lookup | depends on use case |
| domain invariant | usually one decision reason |
| batch row mapping | many row-level errors |

---

## 6. Exception Mapping di Spring/Jakarta Style

### 6.1 Centralized Exception Translation

Mapping exception tidak boleh di-handle di setiap controller.

Gunakan centralized translator:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadable(
        HttpMessageNotReadableException ex,
        HttpServletRequest request
    ) {
        String correlationId = CorrelationIds.from(request);
        Throwable root = rootCause(ex);

        MappingFailure failure = MappingFailureClassifier.classify(root);
        ApiErrorResponse response = ApiErrorMapper.toApiError(failure, correlationId);

        MappingFailureLogger.log(failure, correlationId);

        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(response);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(
        MethodArgumentNotValidException ex,
        HttpServletRequest request
    ) {
        String correlationId = CorrelationIds.from(request);

        ApiErrorResponse response = ValidationErrorMapper.from(ex, correlationId);

        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(response);
    }
}
```

Ini bukan sekadar convenience. Ini membuat:

- format error konsisten;
- redaction konsisten;
- observability konsisten;
- correlation id konsisten;
- status code konsisten;
- contract error stabil.

---

### 6.2 Jangan Campur Library Exception ke API Contract

API response tidak perlu menyebut:

```text
InvalidFormatException
MismatchedInputException
UnrecognizedPropertyException
JsonParseException
ConstraintViolationException
```

Itu internal detail.

API cukup expose semantic code:

```text
MALFORMED_JSON
INVALID_PAYLOAD_SHAPE
UNKNOWN_FIELD
INVALID_FIELD_FORMAT
VALIDATION_FAILED
UNKNOWN_REFERENCE_CODE
INTERNAL_MAPPING_ERROR
```

Internal log boleh menyimpan exception class.

---

## 7. Jackson Exception Classification

### 7.1 Contoh Classifier

```java
public final class MappingFailureClassifier {

    private MappingFailureClassifier() {}

    public static MappingFailure classify(Throwable throwable) {
        Throwable root = unwrap(throwable);

        if (root instanceof JsonParseException e) {
            return new MappingFailure(
                MappingFailureStage.PARSE,
                "MALFORMED_JSON",
                "Request body is not valid JSON.",
                null,
                null,
                null,
                true,
                false,
                false,
                e
            );
        }

        if (root instanceof UnrecognizedPropertyException e) {
            return new MappingFailure(
                MappingFailureStage.BINDING,
                "UNKNOWN_FIELD",
                "Unknown field: " + e.getPropertyName(),
                JacksonPathExtractor.toJsonPointer(e),
                e.getReferringClass() != null ? e.getReferringClass().getSimpleName() : null,
                null,
                true,
                false,
                false,
                e
            );
        }

        if (root instanceof InvalidFormatException e) {
            return new MappingFailure(
                MappingFailureStage.CONVERSION,
                "INVALID_FIELD_FORMAT",
                "Field format is invalid.",
                JacksonPathExtractor.toJsonPointer(e),
                null,
                e.getTargetType() != null ? e.getTargetType().getSimpleName() : null,
                true,
                false,
                mayContainSensitiveValue(e),
                e
            );
        }

        if (root instanceof MismatchedInputException e) {
            return new MappingFailure(
                MappingFailureStage.BINDING,
                "INVALID_PAYLOAD_SHAPE",
                "Request payload shape is invalid.",
                JacksonPathExtractor.toJsonPointer(e),
                null,
                e.getTargetType() != null ? e.getTargetType().toString() : null,
                true,
                false,
                false,
                e
            );
        }

        return new MappingFailure(
            MappingFailureStage.PROJECTION,
            "INTERNAL_MAPPING_ERROR",
            "Unable to map payload.",
            null,
            null,
            null,
            false,
            false,
            true,
            root
        );
    }

    private static Throwable unwrap(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current;
    }

    private static boolean mayContainSensitiveValue(InvalidFormatException e) {
        return e.getValue() != null;
    }
}
```

Ini bukan implementasi final universal. Tujuannya menunjukkan pola:

```text
Library exception -> internal mapping failure -> public API error + internal diagnostic log
```

---

## 8. Safe Logging: Yang Paling Sering Salah

### 8.1 Jangan Log Raw Payload Secara Default

Buruk:

```java
log.warn("Failed to map request body: {}", rawBody, ex);
```

Kenapa buruk?

Payload bisa berisi:

- PII;
- credential;
- token;
- document content;
- confidential case notes;
- payment data;
- health/legal/sensitive attributes;
- internal IDs;
- data pihak ketiga.

Default stance:

> Log metadata, bukan raw payload.

Log yang aman:

```java
log.warn(
    "Mapping failure stage={} code={} path={} boundary={} operation={} correlationId={} payloadHash={} payloadSize={}",
    failure.stage(),
    failure.code(),
    failure.path(),
    boundary,
    operation,
    correlationId,
    payloadHash,
    payloadSize
);
```

---

### 8.2 Payload Fingerprint

Daripada menyimpan payload mentah, simpan hash.

```java
public final class PayloadFingerprint {

    public static String sha256Hex(byte[] payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(payload);
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

Manfaat:

- bisa mendeteksi payload yang sama berulang;
- bisa korelasi antar log;
- tidak menyimpan data asli;
- bisa membantu dedup incident;
- bisa digunakan untuk dead-letter metadata.

Catatan Java 8:

`HexFormat` baru ada di Java 17. Untuk Java 8, pakai formatter manual atau library seperti Apache Commons Codec jika sudah menjadi standard dependency.

---

### 8.3 Redaction Policy

Jika payload harus dilog untuk lingkungan DEV/UAT tertentu, gunakan redaction policy.

Contoh conceptual redactor:

```java
public final class JsonPayloadRedactor {

    private static final Set<String> SENSITIVE_FIELDS = Set.of(
        "password",
        "token",
        "accessToken",
        "refreshToken",
        "nric",
        "nik",
        "passportNo",
        "email",
        "phone",
        "address"
    );

    public static JsonNode redact(JsonNode node) {
        if (node == null || node.isNull()) {
            return node;
        }

        if (node.isObject()) {
            ObjectNode object = ((ObjectNode) node).deepCopy();
            Iterator<String> names = object.fieldNames();
            List<String> fieldNames = new ArrayList<>();
            names.forEachRemaining(fieldNames::add);

            for (String fieldName : fieldNames) {
                if (isSensitive(fieldName)) {
                    object.put(fieldName, "***REDACTED***");
                } else {
                    object.set(fieldName, redact(object.get(fieldName)));
                }
            }

            return object;
        }

        if (node.isArray()) {
            ArrayNode array = JsonNodeFactory.instance.arrayNode();
            for (JsonNode child : node) {
                array.add(redact(child));
            }
            return array;
        }

        return node;
    }

    private static boolean isSensitive(String fieldName) {
        String normalized = fieldName.toLowerCase(Locale.ROOT);
        return SENSITIVE_FIELDS.stream()
            .map(s -> s.toLowerCase(Locale.ROOT))
            .anyMatch(normalized::contains);
    }
}
```

Tetapi jangan over-trust field-name redaction. PII bisa muncul di field seperti `remarks`, `description`, `metadata`, `notes`, atau nested blob.

Field-name redaction adalah minimum, bukan jaminan.

---

## 9. Correlation ID dan Diagnostic Context

### 9.1 Kenapa Correlation ID Wajib

Mapping failure sering tersebar di beberapa log:

- ingress log;
- controller log;
- exception handler log;
- downstream service log;
- audit log;
- message consumer log;
- dead-letter log.

Tanpa correlation id, debugging menjadi pencarian manual.

Setiap mapping failure harus membawa:

```text
correlationId
requestId/messageId
operation/useCase
boundary/source system
tenant/agency if applicable
payload fingerprint
stage
path
error code
```

---

### 9.2 MDC di Java Logging

Contoh konsep dengan SLF4J MDC:

```java
public class CorrelationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        String correlationId = Optional
            .ofNullable(request.getHeader("X-Correlation-Id"))
            .filter(s -> !s.isBlank())
            .orElseGet(() -> UUID.randomUUID().toString());

        MDC.put("correlationId", correlationId);
        response.setHeader("X-Correlation-Id", correlationId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("correlationId");
        }
    }
}
```

Di log pattern:

```text
correlationId=%X{correlationId}
```

Untuk virtual threads/async/reactive, hati-hati: MDC propagation tidak selalu otomatis. Jangan asumsikan context selalu terbawa antar thread.

---

## 10. Diagnostics untuk MapStruct

MapStruct failure berbeda dengan Jackson.

Jackson sering gagal runtime saat payload dibaca.

MapStruct sebagian besar failure muncul saat compile time:

- unmapped target property;
- ambiguous mapping method;
- no conversion method;
- builder tidak dikenali;
- property tidak ditemukan;
- annotation processor conflict;
- Lombok generated method belum terlihat;
- target immutable tidak punya factory/builder.

Ini keuntungan besar, tetapi bukan berarti runtime error hilang.

Runtime MapStruct error bisa muncul karena:

- custom expression melempar exception;
- after-mapping hook gagal;
- context dependency null;
- object factory gagal;
- enum mapping incomplete jika value tak terduga;
- null handling salah;
- nested mapper custom gagal;
- reference lookup di mapper gagal.

---

### 10.1 Compile-Time Diagnostics Policy

Untuk mapper production-grade, jangan biarkan unmapped field diam-diam.

Contoh:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface ApplicationMapper {
    ApplicationResponseDto toResponse(Application application);
}
```

Untuk field yang memang sengaja tidak dipetakan:

```java
@Mapping(target = "internalRiskScore", ignore = true)
ApplicationResponseDto toResponse(Application application);
```

Pesannya jelas:

```text
Field ini sengaja tidak keluar ke response.
```

Bukan:

```text
MapStruct kebetulan tidak mapping field ini.
```

---

### 10.2 Wrap Custom Mapping Exception

Jika mapper custom melakukan conversion semantik, jangan lempar exception generik.

Buruk:

```java
@Named("toApplicationType")
default ApplicationType toApplicationType(String code) {
    return ApplicationType.valueOf(code);
}
```

Jika code tidak dikenal, akan keluar `IllegalArgumentException` tanpa path/domain context.

Lebih baik:

```java
@Named("toApplicationType")
default ApplicationType toApplicationType(String code) {
    if (code == null || code.isBlank()) {
        throw new SemanticMappingException(
            "MISSING_APPLICATION_TYPE",
            "/applicationTypeCode",
            "Application type code is required."
        );
    }

    return ApplicationType.fromExternalCode(code)
        .orElseThrow(() -> new SemanticMappingException(
            "UNKNOWN_APPLICATION_TYPE",
            "/applicationTypeCode",
            "Unknown application type code."
        ));
}
```

---

## 11. Diagnostics untuk Lombok-Generated Model

Lombok dapat membuat error mapping lebih membingungkan karena source code tidak menampilkan semua method/constructor/builder.

Contoh masalah:

- Jackson tidak bisa menemukan constructor;
- MapStruct tidak melihat builder;
- `@Builder` membuat no-args constructor tidak tersedia;
- `@Data` menghasilkan setter yang membuat DTO mutable tanpa sadar;
- `@EqualsAndHashCode` pada entity menyebabkan lazy loading/cycle;
- `@ToString` membocorkan field sensitif;
- annotation processor order salah.

Diagnostics yang baik:

1. cek generated/delomboked code;
2. cek bytecode shape;
3. cek constructor visibility;
4. cek builder method name;
5. cek `@Jacksonized` bila builder dipakai untuk Jackson;
6. cek `lombok-mapstruct-binding` untuk MapStruct + Lombok;
7. cek IDE annotation processing;
8. cek build CI, bukan hanya IDE.

Tambahkan section troubleshooting dalam dokumentasi project:

```text
If Jackson cannot deserialize Lombok DTO:
- Is there a visible no-args constructor or @JsonCreator?
- If using @Builder, is @Jacksonized present?
- Are fields final?
- Are constructor parameter names available?
- Is ParameterNamesModule registered where needed?
- Are there conflicting constructors?
```

---

## 12. Batch Mapping Error Model

Batch/import/message processing butuh error model berbeda dari synchronous API.

Dalam API single request, kita bisa fail-fast.

Dalam batch:

```text
1 file berisi 10.000 rows.
Row 251 invalid.
Apakah seluruh batch gagal?
Apakah row 251 saja gagal?
Apakah partial commit boleh?
Apakah user butuh report error semua row?
```

Contoh row-level error:

```java
public record BatchMappingError(
    int rowNumber,
    String path,
    String code,
    String message,
    String rawValueFingerprint
) {}
```

Batch result:

```java
public record BatchMappingResult<T>(
    List<T> validItems,
    List<BatchMappingError> errors,
    boolean accepted,
    boolean partial
) {}
```

Policy perlu eksplisit:

| Mode | Behavior |
|---|---|
| all-or-nothing | jika 1 row gagal, semua gagal |
| partial accept | row valid diproses, row invalid dilaporkan |
| threshold accept | gagal jika error > threshold |
| staging mode | semua row disimpan dulu untuk review |
| dead-letter mode | invalid record masuk DLQ |

Untuk regulatory/case system, partial accept harus sangat hati-hati karena bisa menciptakan state tidak konsisten.

---

## 13. Message Consumer dan Dead-Letter Mapping

Mapping error pada message consumer berbeda dari HTTP request.

HTTP:

```text
client dapat response langsung
```

Message:

```text
producer mungkin sudah tidak menunggu
consumer harus menentukan retry, skip, dead-letter, atau poison-message handling
```

### 13.1 Retryable vs Non-Retryable

Mapping error biasanya non-retryable jika:

- malformed JSON;
- invalid schema;
- unknown enum karena producer salah;
- missing required field;
- invalid date format.

Retryable jika:

- reference data belum sinkron sementara;
- lookup service down;
- schema registry temporarily unavailable;
- encryption/decryption dependency unavailable;
- object storage for attachment temporarily unavailable.

Jangan retry malformed JSON 100 kali. Itu poison message.

---

### 13.2 Dead-Letter Metadata

DLQ message sebaiknya menyimpan metadata diagnosis:

```json
{
  "originalMessageId": "m-123",
  "sourceSystem": "ExternalAgencyA",
  "messageType": "ApplicationSubmitted",
  "schemaVersion": "2.1",
  "failureStage": "CONVERSION",
  "errorCode": "INVALID_FIELD_FORMAT",
  "path": "/submittedAt",
  "payloadHash": "sha256:...",
  "firstFailureAt": "2026-06-17T08:10:00Z",
  "correlationId": "c-...",
  "retryable": false
}
```

Raw payload storage policy harus disesuaikan dengan data classification.

---

## 14. Replayability: Bisa Mengulang Failure Secara Aman

Debugging mapping production tidak boleh bergantung pada screenshot log.

Pertanyaan penting:

```text
Bisakah kita reproduce failure dengan payload yang sama?
Bisakah payload disimpan secara aman?
Bisakah payload direplay di environment non-production?
Bisakah PII disamarkan tapi struktur error tetap sama?
Bisakah kita tahu versi mapper/schema saat failure terjadi?
```

### 14.1 Replay Metadata

Simpan metadata:

```text
application version
mapper version/config version
schema version
ObjectMapper profile
source system
operation
payload fingerprint
feature flags
Java version
library version
correlation id
```

Jika mapping behavior berubah karena upgrade Jackson/MapStruct/Lombok/Java, metadata ini penting.

---

### 14.2 Sanitized Replay Payload

Untuk payload sensitif, buat sanitized replay fixture:

```json
{
  "name": "REDACTED_NAME",
  "email": "redacted@example.test",
  "birthDate": "31/02/2026",
  "applicationTypeCode": "XYZ"
}
```

Tujuannya mempertahankan field yang menyebabkan error tanpa mempertahankan data asli.

---

## 15. Observability Metrics untuk Mapping

Logging saja tidak cukup. Butuh metrics.

Metric yang berguna:

```text
mapping_failures_total{stage, code, boundary, operation}
mapping_duration_seconds{source_type,target_type,operation}
payload_size_bytes{operation}
unknown_field_total{field, operation}
invalid_enum_total{enum_type, value_group}
dead_letter_total{source_system,message_type,error_code}
contract_drift_suspected_total{source_system,operation}
```

Contoh alarm:

```text
UNKNOWN_FIELD naik setelah release client baru.
INVALID_ENUM naik untuk statusCode dari ExternalAgencyA.
PROJECTION error naik setelah deployment BE.
MALFORMED_JSON naik hanya dari satu source IP/system.
```

Metric mengubah mapping failure dari “bug random” menjadi signal contract.

---

## 16. Mapping Error Code Design

Error code harus stabil dan bermakna.

Buruk:

```text
ERROR_001
ERROR_002
JSON_ERROR
BAD_REQUEST
```

Lebih baik:

```text
MALFORMED_JSON
MALFORMED_XML
UNKNOWN_FIELD
MISSING_REQUIRED_FIELD
INVALID_PAYLOAD_SHAPE
INVALID_FIELD_FORMAT
INVALID_ENUM_VALUE
NUMBER_OUT_OF_RANGE
VALIDATION_FAILED
UNKNOWN_REFERENCE_CODE
UNSUPPORTED_SCHEMA_VERSION
INTERNAL_MAPPING_ERROR
```

Error code bukan pesan manusia. Error code adalah kontrak machine-readable.

Message bisa berubah. Code sebaiknya tidak berubah sembarangan.

---

## 17. HTTP Status Code Mapping

General rule:

| Failure | HTTP Status |
|---|---:|
| malformed JSON/XML | 400 |
| invalid field type/format | 400 |
| validation failed | 400 atau 422 sesuai API convention |
| unsupported media type | 415 |
| payload too large | 413 |
| unknown field dalam strict API | 400 |
| unauthorized field/over-posting | 400/403 tergantung semantics |
| domain business rejection | 400/409/422 tergantung semantics |
| internal projection error | 500 |
| downstream mapping dependency unavailable | 502/503 |

Yang penting bukan memilih 400 vs 422 secara dogmatis. Yang penting:

- konsisten;
- terdokumentasi;
- consumer tahu cara menanganinya;
- error code spesifik tetap ada.

---

## 18. Content-Type dan Boundary Diagnostics

Mapping error bisa terjadi sebelum Jackson/JAXB jalan.

Contoh:

```http
POST /applications
Content-Type: text/plain

{"name":"Fajar"}
```

Payload JSON, tetapi content-type salah.

Respons:

```json
{
  "errorCode": "UNSUPPORTED_MEDIA_TYPE",
  "message": "Content-Type must be application/json.",
  "correlationId": "c-..."
}
```

Jangan diam-diam menerima semua content type, kecuali API memang dirancang tolerant.

Boundary harus jelas:

```text
application/json -> JSON mapper
application/xml  -> XML mapper
multipart/form-data -> multipart parser + metadata mapper
text/csv -> CSV parser + row mapper
```

---

## 19. XML Diagnostics

XML error handling punya dimensi tambahan.

Untuk XML, path bisa berupa:

```text
/Application/Applicant/BirthDate
```

Tetapi namespace harus dipertimbangkan:

```text
/{urn:agency:application}Application/{urn:agency:application}Applicant/{urn:agency:common}BirthDate
```

Error XML umum:

- malformed XML;
- invalid namespace;
- missing wrapper element;
- unexpected element order;
- XSD validation failure;
- invalid attribute;
- empty element vs absent element;
- mixed content tidak didukung;
- XXE blocked;
- canonicalization/signature mismatch.

Respons external sebaiknya tidak membocorkan parser internals:

```json
{
  "errorCode": "MALFORMED_XML",
  "message": "Request body is not valid XML.",
  "correlationId": "c-..."
}
```

Untuk XSD:

```json
{
  "errorCode": "XML_SCHEMA_VALIDATION_FAILED",
  "message": "XML payload does not match the required schema.",
  "path": "/Application/Applicant/BirthDate",
  "correlationId": "c-..."
}
```

---

## 20. Anti-Pattern: Mapper yang Menelan Error

Buruk:

```java
public ApplicationDto toDto(Application application) {
    try {
        return mapper.toDto(application);
    } catch (Exception e) {
        return new ApplicationDto();
    }
}
```

Ini sangat berbahaya.

Efeknya:

- data hilang diam-diam;
- response tampak sukses tapi salah;
- audit trail menipu;
- downstream menerima empty/default value;
- root cause hilang;
- SLA debugging memburuk;
- regulator/user melihat data inconsistent.

Prinsip:

> Mapping failure should be explicit, classified, and observable.

Jika ingin fallback, fallback harus policy sadar:

```java
public Optional<ApplicationDto> tryMapForSearchListing(Application application) {
    try {
        return Optional.of(mapper.toListingDto(application));
    } catch (KnownNonCriticalMappingException e) {
        diagnostics.recordPartialProjectionFailure(application.id(), e);
        return Optional.empty();
    }
}
```

Bahkan fallback pun harus meninggalkan signal.

---

## 21. Anti-Pattern: Generic `RuntimeException("Mapping failed")`

Buruk:

```java
throw new RuntimeException("Mapping failed", e);
```

Masalah:

- tidak ada stage;
- tidak ada path;
- tidak ada source/target type;
- tidak ada retryability;
- tidak ada client visibility;
- tidak ada error code;
- susah dikategorikan.

Lebih baik:

```java
throw new MappingException(
    MappingFailureStage.SEMANTIC_MAPPING,
    "UNKNOWN_REFERENCE_CODE",
    "/applicationTypeCode",
    "Unknown application type code.",
    false,
    e
);
```

---

## 22. Anti-Pattern: Menggunakan Validation untuk Semua Error

Kadang semua error dimasukkan ke `ValidationException`.

```text
JSON malformed -> validation error
unknown field -> validation error
invalid enum -> validation error
business rule rejected -> validation error
```

Ini membuat taxonomy rusak.

Validation harus punya scope:

```text
DTO berhasil dibuat -> constraint dicek -> validation error
```

Kalau DTO belum bisa dibuat, itu bukan validation error. Itu parse/binding/conversion error.

---

## 23. Anti-Pattern: Mengembalikan Value Sensitif di Error

Buruk:

```json
{
  "path": "/token",
  "message": "Invalid token abc.def.ghi"
}
```

Buruk:

```json
{
  "path": "/nric",
  "rejectedValue": "S1234567D"
}
```

Lebih aman:

```json
{
  "path": "/token",
  "message": "Token format is invalid.",
  "rejectedValue": {
    "present": true,
    "redacted": true,
    "type": "string",
    "length": 11
  }
}
```

---

## 24. Designing a Mapping Diagnostics Module

Untuk codebase besar, buat module kecil:

```text
mapping-diagnostics
  ├─ MappingFailure
  ├─ MappingFailureStage
  ├─ MappingException
  ├─ MappingFailureClassifier
  ├─ JacksonPathExtractor
  ├─ ApiErrorMapper
  ├─ SafePayloadLogger
  ├─ PayloadFingerprint
  ├─ RedactionPolicy
  └─ MappingMetrics
```

Module ini tidak harus library terpisah. Bisa package internal.

Tujuannya:

- menghindari copy-paste exception handling;
- menjaga format error stabil;
- memudahkan audit/security review;
- memudahkan metric standar;
- memudahkan migration Jackson 2/3;
- memudahkan test reusable.

---

## 25. Contoh End-to-End Mapping Failure Flow

### Scenario

API menerima payload:

```json
{
  "applicant": {
    "name": "Fajar",
    "birthDate": "31/02/2026",
    "email": "fajar@example.com"
  }
}
```

DTO:

```java
public record CreateApplicationRequest(
    ApplicantRequest applicant
) {}

public record ApplicantRequest(
    String name,
    LocalDate birthDate,
    String email
) {}
```

### Flow

```text
1. Transport OK.
2. JSON syntax OK.
3. Binding enters /applicant/birthDate.
4. LocalDate conversion fails.
5. Jackson throws InvalidFormatException.
6. Exception handler catches HttpMessageNotReadableException.
7. Classifier unwraps root cause.
8. Stage = CONVERSION.
9. Code = INVALID_FIELD_FORMAT.
10. Path = /applicant/birthDate.
11. API response created.
12. Internal diagnostic log written with correlation id and payload fingerprint.
13. Metric incremented.
```

### API Response

```json
{
  "errorCode": "INVALID_FIELD_FORMAT",
  "message": "Field 'birthDate' must be a valid date in format yyyy-MM-dd.",
  "path": "/applicant/birthDate",
  "correlationId": "c-20260617-abc123"
}
```

### Internal Log

```json
{
  "event": "mapping.failure",
  "stage": "CONVERSION",
  "code": "INVALID_FIELD_FORMAT",
  "boundary": "PUBLIC_API",
  "operation": "CreateApplication",
  "path": "/applicant/birthDate",
  "sourceType": "json",
  "targetType": "CreateApplicationRequest",
  "exceptionClass": "InvalidFormatException",
  "payloadSize": 101,
  "payloadHash": "sha256:...",
  "correlationId": "c-20260617-abc123"
}
```

---

## 26. Testing Error Handling Mapping

Error handling harus dites seperti fitur utama.

### 26.1 Test Malformed JSON

```java
@Test
void shouldReturnMalformedJsonForInvalidJson() throws Exception {
    mockMvc.perform(post("/applications")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{ invalid json"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("MALFORMED_JSON"))
        .andExpect(jsonPath("$.correlationId").exists());
}
```

### 26.2 Test Invalid Field Format

```java
@Test
void shouldReturnInvalidFieldFormatForBadDate() throws Exception {
    String body = """
        {
          "applicant": {
            "name": "Fajar",
            "birthDate": "31/02/2026"
          }
        }
        """;

    mockMvc.perform(post("/applications")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("INVALID_FIELD_FORMAT"))
        .andExpect(jsonPath("$.path").value("/applicant/birthDate"));
}
```

### 26.3 Test Unknown Field Strict Mode

```java
@Test
void shouldRejectUnknownFieldInStrictPublicApi() throws Exception {
    String body = """
        {
          "applicant": {
            "name": "Fajar"
          },
          "isAdmin": true
        }
        """;

    mockMvc.perform(post("/applications")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("UNKNOWN_FIELD"))
        .andExpect(jsonPath("$.path").value("/isAdmin"));
}
```

### 26.4 Test No Sensitive Echo

```java
@Test
void shouldNotEchoSensitiveRejectedValue() throws Exception {
    String body = """
        {
          "password": "abc"
        }
        """;

    mockMvc.perform(post("/accounts")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.violations[0].path").value("/password"))
        .andExpect(jsonPath("$.violations[0].rejectedValue.redacted").value(true))
        .andExpect(content().string(not(containsString("abc"))));
}
```

---

## 27. Failure Mode Checklist

Gunakan checklist ini saat review mapper/API/integration.

### 27.1 Inbound JSON/API

- Apakah malformed JSON menghasilkan error code stabil?
- Apakah unknown field ditolak untuk public API?
- Apakah path field dikembalikan?
- Apakah enum unknown ditangani dengan jelas?
- Apakah date/time format error jelas?
- Apakah null vs missing dibedakan jika penting?
- Apakah validation error bisa multi-field?
- Apakah sensitive value tidak di-echo?
- Apakah correlation id selalu ada?
- Apakah raw payload tidak dilog default?

### 27.2 XML/Integration

- Apakah malformed XML dibedakan dari XSD validation?
- Apakah namespace error bisa didiagnosis?
- Apakah XXE blocked menghasilkan error aman?
- Apakah XML path cukup informatif?
- Apakah signed/canonicalized payload tidak dinormalisasi sembarangan?
- Apakah partner/source system tercatat?
- Apakah schema version tercatat?

### 27.3 MapStruct

- Apakah unmapped target policy `ERROR` untuk boundary penting?
- Apakah ignored fields eksplisit?
- Apakah custom mapping exception punya code/path?
- Apakah update mapping null strategy dites?
- Apakah generated code bisa diinspeksi di CI?
- Apakah Lombok integration stabil?

### 27.4 Logging/Observability

- Apakah stage/code/path tercatat?
- Apakah source/target type tercatat?
- Apakah operation/boundary tercatat?
- Apakah payload fingerprint tersedia?
- Apakah metrics ada?
- Apakah DLQ metadata cukup?
- Apakah replay aman?

---

## 28. Top 1% Mental Model

Engineer biasa bertanya:

```text
Bagaimana cara menangkap exception Jackson?
```

Engineer senior bertanya:

```text
Exception ini terjadi di gate mana?
Apakah error ini client-visible?
Apakah aman dikembalikan?
Apakah path field tersedia?
Apakah payload boleh dilog?
Apakah error ini retryable?
Apakah ini contract drift?
Apakah ini perlu metric/alarm?
Apakah bisa direplay?
Apakah error code stabil untuk consumer?
Apakah ini bug mapper, bug producer, atau domain rejection?
```

Top-level engineer melihat mapping pipeline sebagai **observed boundary**, bukan helper function.

---

## 29. Practical Design Rules

1. **Classify before responding.**  
   Jangan langsung return `BAD_REQUEST` dari semua exception.

2. **Expose semantic error code, not library class.**  
   `INVALID_FIELD_FORMAT` lebih baik daripada `InvalidFormatException`.

3. **Always include correlation id.**  
   Tanpa correlation id, production debugging mahal.

4. **Prefer JSON Pointer for field path.**  
   Path harus machine-readable dan UI-friendly.

5. **Do not log raw payload by default.**  
   Gunakan fingerprint dan redaction.

6. **Separate parse, binding, conversion, validation, semantic, domain, projection errors.**  
   Mereka punya tindakan berbeda.

7. **Use compile-time enforcement where possible.**  
   MapStruct `ReportingPolicy.ERROR` lebih baik daripada runtime surprise.

8. **Make fallback explicit and observable.**  
   Jangan telan error diam-diam.

9. **Test error contracts.**  
   Error response adalah bagian dari API contract.

10. **Treat mapping failure as contract signal.**  
    Spike error mapping bisa berarti producer berubah, schema drift, atau deployment bug.

---

## 30. Latihan Desain

### Latihan 1 — API Error Taxonomy

Ambil satu endpoint create/update di sistemmu. Buat daftar error:

```text
- malformed JSON
- unknown field
- missing required field
- invalid enum
- invalid date
- validation failed
- unknown reference code
- unauthorized field
- domain rejection
- projection failure
```

Untuk masing-masing, tentukan:

```text
errorCode
HTTP status
client message
internal log fields
path available?
retryable?
metric label
```

---

### Latihan 2 — Mapping Failure Classifier

Buat `MappingFailureClassifier` kecil untuk Jackson exception di project Java/Spring:

```text
JsonParseException -> MALFORMED_JSON
UnrecognizedPropertyException -> UNKNOWN_FIELD
InvalidFormatException -> INVALID_FIELD_FORMAT
MismatchedInputException -> INVALID_PAYLOAD_SHAPE
else -> INTERNAL_MAPPING_ERROR
```

Tambahkan extraction path.

---

### Latihan 3 — Safe Logging Test

Buat test yang memastikan error response/log tidak mengandung:

```text
password
token
NRIC/NIK/passport
email jika sensitif
raw document content
```

Minimal test response body tidak echo raw sensitive value.

---

### Latihan 4 — DLQ Error Metadata

Untuk satu message consumer, desain DLQ metadata:

```text
messageId
sourceSystem
messageType
schemaVersion
failureStage
errorCode
path
payloadHash
retryable
correlationId
firstFailureAt
```

Tentukan mana field yang wajib dan mana opsional.

---

## 31. Ringkasan

Part ini membahas bahwa error handling mapping adalah desain boundary, bukan sekadar `try-catch`.

Poin utama:

- mapping pipeline terdiri dari banyak gate;
- parse, binding, conversion, validation, semantic, domain, projection error harus dibedakan;
- API harus expose error code stabil dan path yang jelas;
- raw exception message tidak boleh menjadi public contract;
- raw payload tidak boleh dilog default;
- correlation id, payload fingerprint, stage, path, source/target type adalah diagnostic metadata penting;
- MapStruct memberi compile-time diagnostics, tetapi custom mapping tetap perlu error model;
- Lombok bisa menyulitkan diagnostics karena generated code tidak terlihat langsung;
- batch/message mapping butuh row-level error, retryability, dan DLQ metadata;
- replayability dan metrics membuat mapping failure dapat dioperasikan secara profesional.

Mental model akhirnya:

```text
Mapping failure is not noise.
Mapping failure is contract telemetry.
```

Jika sistem bisa mengklasifikasi, menjelaskan, mengamankan, mengukur, dan mereplay mapping failure, maka mapping layer sudah naik dari utility code menjadi production-grade boundary infrastructure.

---

## 32. Status Seri

- Part 28 selesai.
- Seri belum selesai.
- Berikutnya: **Part 29 — Testing Strategy: Unit, Golden Payload, Property-Based, Contract Tests**.
