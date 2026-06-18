# Part 15 — JSON Schema, OpenAPI, and Runtime Contract Alignment

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `15-json-schema-openapi-runtime-contract-alignment.md`  
> Target: Java 8 sampai Java 25  
> Fokus: menyelaraskan DTO Java, OpenAPI/JSON Schema, Jackson runtime behavior, generated clients, validation, compatibility, dan contract regression.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas Jackson sebagai engine serialization/deserialization, termasuk strictness, compatibility, security, dan performance. Bagian ini naik satu level: **bagaimana memastikan bentuk JSON yang terdokumentasi di OpenAPI/JSON Schema benar-benar sama dengan perilaku runtime Java/Jackson**.

Masalah yang ingin kita selesaikan:

1. API documentation mengatakan field required, tetapi runtime menerima field yang hilang.
2. Schema mengatakan field nullable, tetapi Java DTO memakai primitive atau constructor yang tidak menerima null.
3. OpenAPI mengatakan enum hanya punya 3 value, tetapi backend diam-diam menerima value lain sebagai `UNKNOWN`.
4. Generated client menganggap response field selalu ada, tetapi server menghilangkan field karena `@JsonInclude(NON_NULL)`.
5. JSON Schema melarang unknown field, tetapi Jackson `ObjectMapper` membiarkan unknown field masuk.
6. DTO berubah, tetapi OpenAPI tidak berubah.
7. OpenAPI berubah, tetapi runtime tidak berubah.
8. Contract test hanya mengecek status 200, bukan payload compatibility.

Di sistem kecil, ini terasa seperti dokumentasi tidak rapi. Di sistem enterprise, regulatory, public API, integration API, atau case management multi-agency, ini adalah **contract failure**.

Mental model utama bagian ini:

> OpenAPI/JSON Schema bukan hanya dokumentasi. Ia adalah proyeksi kontrak. Jackson runtime bukan hanya parser. Ia adalah enforcement engine. DTO bukan hanya class. Ia adalah bentuk object-side dari kontrak. Ketiganya harus align, atau sistem akan berbohong kepada consumer.

---

## 1. Kenapa Contract Alignment Sulit?

Kita sering mengira contract alignment cukup dengan membuat DTO lalu generate OpenAPI. Itu terlalu sederhana.

Dalam praktik, ada beberapa model yang berjalan bersamaan:

```text
Human contract
  -> OpenAPI / JSON Schema / examples / API portal

Runtime wire contract
  -> actual JSON payload sent/received over HTTP/message/event

Java shape contract
  -> DTO class, record, enum, Optional, collection, primitive/wrapper

Jackson binding contract
  -> ObjectMapper config, annotations, modules, coercion, inclusion

Validation contract
  -> Bean Validation, custom validation, service-level invariant

Consumer contract
  -> generated client, frontend model, mobile app, downstream batch importer
```

Mereka bisa drift.

Contoh sederhana:

```java
public record CreateUserRequest(
    String email,
    String displayName
) {}
```

OpenAPI mungkin tertulis:

```yaml
CreateUserRequest:
  type: object
  required:
    - email
  properties:
    email:
      type: string
      format: email
    displayName:
      type: string
```

Tapi runtime Java/Jackson mungkin menerima:

```json
{}
```

Lalu menghasilkan:

```java
new CreateUserRequest(null, null)
```

Jika tidak ada validation, API contract mengatakan `email` required, tetapi runtime membiarkan `email = null`.

Itu bukan problem OpenAPI saja. Itu problem **alignment antara schema, binding, dan validation**.

---

## 2. Definisi: JSON Schema vs OpenAPI Schema

### 2.1 JSON Schema

JSON Schema adalah bahasa untuk mendeskripsikan struktur dan constraint JSON.

Ia bisa menyatakan hal seperti:

```json
{
  "type": "object",
  "required": ["email"],
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    },
    "age": {
      "type": "integer",
      "minimum": 0
    }
  },
  "additionalProperties": false
}
```

Yang penting:

- `type` menjelaskan tipe JSON.
- `properties` menjelaskan property yang dikenal.
- `required` menjelaskan property yang wajib hadir.
- `additionalProperties` mengatur apakah property tambahan boleh ada.
- `enum` membatasi value yang valid.
- `format` memberi semantic hint seperti `date`, `date-time`, `email`, `uuid`.
- `oneOf`, `anyOf`, `allOf` mendukung komposisi.

### 2.2 OpenAPI Schema

OpenAPI adalah standard untuk mendeskripsikan HTTP API: path, method, request, response, parameter, security, dan schema payload.

OpenAPI 3.1 semakin align dengan JSON Schema dibanding OpenAPI 3.0. Di OpenAPI 3.1, pendekatan nullable lebih dekat ke JSON Schema, misalnya menggunakan type array:

```yaml
middleName:
  type:
    - string
    - 'null'
```

Di OpenAPI 3.0, pola umum adalah:

```yaml
middleName:
  type: string
  nullable: true
```

Implikasi engineering-nya:

> Jangan menganggap semua OpenAPI schema sama. OpenAPI 3.0 dan 3.1 punya perbedaan penting dalam alignment dengan JSON Schema, terutama nullability dan beberapa keyword schema.

---

## 3. Kontrak Bukan Hanya `type`

Banyak engineer membaca schema hanya sebagai tipe field.

```yaml
email:
  type: string
```

Padahal contract payload minimal punya beberapa dimensi:

| Dimensi | Pertanyaan |
|---|---|
| Presence | Field harus hadir atau boleh absen? |
| Nullability | Kalau hadir, boleh `null` atau tidak? |
| Value constraint | Nilainya harus mengikuti format/range/regex/enum? |
| Unknown field policy | Field di luar schema diterima atau ditolak? |
| Direction | Field ini input-only, output-only, atau dua arah? |
| Versioning | Field ini baru, lama, deprecated, atau alias? |
| Security | Field ini boleh terlihat oleh semua consumer? |
| Semantics | Arti field ini sama untuk semua context? |
| Defaulting | Kalau hilang, apakah server memberi default? |
| Compatibility | Perubahan field ini breaking atau non-breaking? |

Contoh field `status`:

```yaml
status:
  type: string
  enum: [DRAFT, SUBMITTED, APPROVED, REJECTED]
```

Ini belum cukup. Kita perlu tahu:

- Apakah `status` wajib ada di response?
- Apakah request boleh mengirim `status`?
- Apakah `status = null` boleh?
- Kalau backend menambah `CANCELLED`, apakah consumer lama rusak?
- Kalau field absen, apakah artinya unknown atau not applicable?
- Apakah status internal seperti `PENDING_INTERNAL_REVIEW` boleh bocor ke public API?

Top-level engineer tidak hanya bertanya “tipe datanya apa?” tetapi “kontrak behavioral-nya apa?”

---

## 4. Alignment Matrix

Untuk setiap DTO penting, buat matrix seperti ini:

| Concern | OpenAPI/Schema | Java DTO | Jackson Runtime | Validation | Test |
|---|---|---|---|---|---|
| Required | `required: [email]` | non-null semantic | missing field behavior | `@NotBlank` | missing email rejected |
| Nullable | `type: string` not null | `String` can still be null | null accepted unless configured | `@NotNull`/`@NotBlank` | null email rejected |
| Unknown field | `additionalProperties: false` | no member | fail unknown? | n/a | extra field rejected |
| Enum | enum list | Java enum | unknown enum behavior | custom if needed | unknown status rejected or mapped |
| Date-time | `format: date-time` | `OffsetDateTime` | JavaTimeModule | range/business validation | timezone test |
| Read only | `readOnly: true` | response-only DTO | request mapper ignores it | over-posting blocked | request cannot set id/status |
| Write only | `writeOnly: true` | request-only field | not serialized back | sensitive field validation | password not returned |

Tanpa matrix ini, contract correctness bergantung pada asumsi.

---

## 5. Required vs Non-Null: Ini Bukan Hal yang Sama

Ini salah satu jebakan terbesar.

### 5.1 Required berarti property hadir

Dalam schema object:

```yaml
required:
  - email
properties:
  email:
    type: string
```

Artinya property `email` harus hadir.

Payload ini gagal:

```json
{}
```

### 5.2 Non-null berarti value bukan null

Payload ini punya property `email`, tetapi nilainya null:

```json
{
  "email": null
}
```

Apakah valid? Tergantung schema.

Di OpenAPI 3.1 / JSON Schema style, non-null string:

```yaml
email:
  type: string
```

Nullable string:

```yaml
email:
  type:
    - string
    - 'null'
```

Di OpenAPI 3.0:

```yaml
email:
  type: string
  nullable: true
```

### 5.3 Java membuat ini lebih rumit

Java `String email` bisa menyimpan null.

```java
public record Request(String email) {}
```

Record component bukan otomatis non-null.

Jika ingin enforce:

```java
public record Request(String email) {
    public Request {
        if (email == null || email.isBlank()) {
            throw new IllegalArgumentException("email is required");
        }
    }
}
```

Atau pada request DTO dengan Bean Validation:

```java
public record CreateUserRequest(
    @jakarta.validation.constraints.NotBlank String email
) {}
```

Tapi catatan penting:

- Jackson binding terjadi sebelum Bean Validation.
- `@NotBlank` biasanya dieksekusi setelah object terbentuk.
- Jika constructor menolak null, error muncul saat deserialization.
- Jika validation menolak null, error muncul saat validation phase.

Dua-duanya valid, tetapi error taxonomy-nya beda.

---

## 6. Primitive vs Wrapper dalam Contract

Java primitive sering terlihat simpel:

```java
public record UpdateQuantityRequest(int quantity) {}
```

Tapi primitive punya default value.

Jika JSON tidak mengirim `quantity`, runtime dapat menghasilkan:

```java
quantity = 0
```

Sekarang muncul ambiguity:

```json
{}
```

Apakah user ingin quantity 0? Atau field hilang?

Untuk request DTO, hati-hati memakai primitive.

Lebih aman:

```java
public record UpdateQuantityRequest(
    @NotNull Integer quantity
) {}
```

Lalu schema:

```yaml
required:
  - quantity
properties:
  quantity:
    type: integer
    minimum: 0
```

Rule praktis:

| Context | Primitive | Wrapper |
|---|---:|---:|
| Internal computed response always present | Boleh | Boleh |
| Request field required | Hindari jika missing harus dibedakan | Lebih aman + validation |
| Partial update/PATCH | Jangan | Wajib wrapper/tri-state |
| Optional output field | Tidak cocok | Cocok |
| Numeric semantic default valid | Boleh dengan dokumentasi jelas | Boleh |

---

## 7. Null vs Absent vs Empty

Contract engineer harus membedakan tiga keadaan:

```json
{}
```

```json
{"middleName": null}
```

```json
{"middleName": ""}
```

Ketiganya berbeda.

| Bentuk | Meaning umum |
|---|---|
| Absent | client tidak mengirim / field tidak berlaku / unknown |
| Null | client sengaja mengosongkan / value tidak diketahui / explicitly none |
| Empty string | value hadir tetapi kosong |

Dalam PATCH semantics, perbedaan ini sangat penting:

```json
{}
```

Artinya jangan ubah `middleName`.

```json
{"middleName": null}
```

Artinya hapus `middleName`.

```json
{"middleName": ""}
```

Mungkin artinya set menjadi string kosong, atau validasi harus menolak.

Java `String middleName` tidak cukup untuk membedakan absent dan null setelah binding biasa.

Beberapa opsi:

1. Gunakan `JsonNode` untuk PATCH input.
2. Gunakan wrapper tri-state custom.
3. Gunakan JSON Merge Patch semantics.
4. Gunakan DTO field-level presence tracking.
5. Pisahkan endpoint PUT dan PATCH dengan semantics jelas.

Contoh tri-state konseptual:

```java
public sealed interface PatchField<T> permits Absent, PresentNull, PresentValue {}

public record Absent<T>() implements PatchField<T> {}
public record PresentNull<T>() implements PatchField<T> {}
public record PresentValue<T>(T value) implements PatchField<T> {}
```

Ini tidak perlu selalu digunakan, tetapi mental model-nya penting.

---

## 8. `additionalProperties` vs Jackson Unknown Field

Schema:

```yaml
type: object
additionalProperties: false
properties:
  email:
    type: string
```

Artinya field selain `email` tidak diizinkan.

Jackson punya konfigurasi:

```java
objectMapper.configure(
    DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
    true
);
```

Jika schema melarang unknown field tetapi Jackson membiarkan unknown field, maka runtime contract lebih longgar dari dokumentasi.

Jika schema membolehkan unknown field tetapi Jackson fail unknown, maka runtime lebih ketat dari dokumentasi.

Keduanya bisa bermasalah.

### 8.1 External public API

Untuk command/request public yang security-sensitive, biasanya lebih aman:

```text
OpenAPI: additionalProperties: false
Jackson: FAIL_ON_UNKNOWN_PROPERTIES = true
DTO: explicit field only
Test: unknown property rejected
```

Alasannya:

- mencegah typo diam-diam diterima
- mencegah over-posting attempt tidak terlihat
- memudahkan client memperbaiki payload
- mengurangi ambiguity contract

### 8.2 Event consumer / tolerant reader

Untuk event dari producer lain, kadang lebih aman:

```text
Schema: allow additive fields
Jackson: ignore unknown properties
DTO: only fields needed by consumer
Test: unknown future field ignored
```

Alasannya:

- producer bisa menambah field tanpa merusak consumer lama
- consumer menerapkan tolerant reader pattern
- compatibility lebih baik untuk asynchronous integration

Jadi tidak ada satu rule universal. Policy tergantung boundary.

---

## 9. Directionality: Input DTO Bukan Output DTO

OpenAPI punya `readOnly` dan `writeOnly`.

Contoh response-only field:

```yaml
id:
  type: string
  format: uuid
  readOnly: true
```

Contoh request-only field:

```yaml
password:
  type: string
  writeOnly: true
```

Masalah muncul jika kita memakai satu DTO untuk request dan response:

```java
public class UserDto {
    public UUID id;
    public String email;
    public String password;
    public String role;
    public Instant createdAt;
}
```

Risiko:

- client bisa mengirim `id`
- client bisa mengirim `role`
- `password` bisa terserialisasi balik
- `createdAt` bisa di-overpost
- schema menjadi ambiguous

Lebih baik:

```java
public record CreateUserRequest(
    String email,
    String password
) {}

public record UserResponse(
    UUID id,
    String email,
    Instant createdAt
) {}
```

Jika harus memakai satu schema untuk dokumentasi, pastikan runtime mapper benar-benar menegakkan directionality. Tetapi untuk sistem enterprise, request/response DTO terpisah biasanya lebih aman.

---

## 10. Enum Contract: Closed vs Open Set

Enum tampak sederhana, tetapi evolusinya rumit.

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Schema:

```yaml
status:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - APPROVED
    - REJECTED
```

### 10.1 Closed enum

Closed enum artinya hanya value yang disebut valid.

Cocok untuk:

- request command
- internal admin action
- state transition input
- strict business operation

Jika client mengirim:

```json
{"status": "CANCELLED"}
```

Server harus reject.

### 10.2 Open enum

Open enum artinya consumer harus siap menerima value baru.

Cocok untuk:

- response API yang berkembang
- event payload antar service
- external integration dari provider yang bisa menambah code

Masalahnya, OpenAPI `enum` secara default memberi kesan closed set. Jika response enum bisa berkembang, dokumentasikan dengan jelas.

Java strategy:

```java
public enum ExternalStatus {
    ACTIVE,
    INACTIVE,
    UNKNOWN
}
```

Dengan Jackson mapping unknown ke default:

```java
public enum ExternalStatus {
    ACTIVE,
    INACTIVE,

    @com.fasterxml.jackson.annotation.JsonEnumDefaultValue
    UNKNOWN
}
```

Dan config:

```java
objectMapper.configure(
    DeserializationFeature.READ_UNKNOWN_ENUM_VALUES_USING_DEFAULT_VALUE,
    true
);
```

Namun jangan aktifkan ini sembarangan untuk semua boundary.

Rule:

| Boundary | Unknown enum policy |
|---|---|
| Request command | Reject |
| State transition | Reject |
| Public response consumed by generated clients | Prefer compatibility plan |
| External inbound integration | Often map to UNKNOWN + preserve raw value |
| Event consumer | Often tolerant, but alert on unknown |

### 10.3 Preserve raw enum value

Untuk integration, jangan hanya ubah unknown menjadi `UNKNOWN` dan membuang value asli.

Lebih baik:

```java
public record ExternalStatusValue(
    ExternalStatus normalized,
    String raw
) {}
```

Kenapa?

- raw value penting untuk audit
- membantu debugging partner integration
- memungkinkan backfill mapping setelah code table update
- menghindari data loss

---

## 11. Format: `date`, `date-time`, `uuid`, `email` Bukan Jaminan Runtime

Schema:

```yaml
dueDate:
  type: string
  format: date

submittedAt:
  type: string
  format: date-time

userId:
  type: string
  format: uuid
```

`format` tidak selalu berarti validator/runtime akan enforce dengan cara yang sama. Di banyak toolchain, `format` bisa menjadi annotation/documentation hint, bukan hard validation.

Java mapping:

| Schema format | Java type umum | Catatan |
|---|---|---|
| `date` | `LocalDate` | Tidak punya timezone/time |
| `date-time` | `OffsetDateTime` / `Instant` | Pilih semantics jelas |
| `uuid` | `UUID` | Invalid string gagal binding |
| `email` | `String` + validation | Jangan menganggap Jackson validate email |
| decimal amount | `BigDecimal` | Hindari `double` untuk uang |

Contoh:

```java
public record PaymentRequest(
    @NotNull BigDecimal amount,
    @NotNull Currency currency,
    @NotNull OffsetDateTime requestedAt
) {}
```

Schema harus match:

```yaml
PaymentRequest:
  type: object
  required:
    - amount
    - currency
    - requestedAt
  properties:
    amount:
      type: number
      multipleOf: 0.01
    currency:
      type: string
      pattern: '^[A-Z]{3}$'
    requestedAt:
      type: string
      format: date-time
```

Tetapi business rule seperti “currency harus supported oleh sistem” bukan sekadar schema; itu perlu validation/reference data check.

---

## 12. Numeric Contract: Integer, Long, BigDecimal, Scale, Precision

JSON hanya punya number. Java punya banyak tipe:

- `int`
- `long`
- `BigInteger`
- `float`
- `double`
- `BigDecimal`

Schema:

```yaml
amount:
  type: number
```

Terlalu lemah untuk financial/regulatory system.

Lebih jelas:

```yaml
amount:
  type: string
  pattern: '^\d{1,12}(\.\d{1,2})?$'
  description: Decimal amount encoded as string to preserve precision.
```

Atau:

```yaml
amount:
  type: number
  multipleOf: 0.01
  minimum: 0
```

Tergantung ecosystem consumer.

Java:

```java
public record MoneyDto(
    BigDecimal amount,
    String currency
) {}
```

Engineering concern:

- JSON number di JavaScript bisa kehilangan precision untuk integer besar.
- `double` punya floating point error.
- `BigDecimal` scale perlu dinormalisasi.
- Schema `maximum`/`minimum` harus sesuai DB precision.
- Serialization `BigDecimal` bisa keluar scientific notation jika tidak dikontrol.

Checklist amount field:

```text
[ ] Apakah field uang memakai BigDecimal?
[ ] Apakah scale didefinisikan?
[ ] Apakah rounding policy jelas?
[ ] Apakah schema minimum/maximum sesuai DB?
[ ] Apakah JSON number aman untuk consumer JS?
[ ] Apakah string decimal lebih aman?
[ ] Apakah tests mencakup boundary precision?
```

---

## 13. Schema Generation: Code-First vs Contract-First

Ada dua pendekatan besar.

### 13.1 Code-first

Java DTO menjadi sumber utama, lalu OpenAPI di-generate.

```text
Java DTO + annotations
  -> OpenAPI generator
  -> API docs
  -> client SDK
```

Kelebihan:

- cepat untuk internal API
- source of truth dekat dengan code
- mengurangi manual doc drift
- cocok untuk Spring Boot CRUD-ish service

Kekurangan:

- schema mengikuti bentuk Java, bukan desain contract yang ideal
- annotation bisa campur dengan domain concern
- sulit mendesain compatibility secara sadar
- generated schema bisa salah representasikan null/required
- DTO refactor bisa menjadi breaking API change diam-diam

### 13.2 Contract-first

OpenAPI/JSON Schema menjadi sumber utama, lalu server/client code mengikuti.

```text
OpenAPI contract
  -> generated server model/client
  -> implementation
  -> contract tests
```

Kelebihan:

- contract eksplisit
- cocok untuk multi-team/multi-vendor integration
- consumer bisa develop paralel
- review API bisa dilakukan sebelum code
- breaking change lebih terlihat

Kekurangan:

- generated code kadang tidak idiomatic
- mapping ke domain tetap perlu
- spec maintenance butuh disiplin
- tooling mismatch bisa mengganggu

### 13.3 Hybrid yang realistis

Untuk enterprise Java, sering paling realistis:

```text
Boundary-critical API: contract-first
Internal/admin API: code-first with strict generated spec review
Events/external integration: schema-first or explicitly versioned payload
```

Rule praktis:

| API Type | Recommended |
|---|---|
| Public external API | Contract-first |
| Multi-agency integration | Contract-first/schema-first |
| Internal microservice API | Hybrid |
| Admin UI backend-for-frontend | Code-first acceptable |
| Event payload | Schema-first/versioned contract strongly recommended |
| Legacy adapter | Contract captured from real payload + tests |

---

## 14. Jackson Schema Generation: Hati-Hati

Jackson punya ekosistem terkait JSON Schema, tetapi jangan menganggap “generate schema dari POJO” otomatis production-grade.

Alasannya:

1. Tidak semua runtime behavior Jackson mudah diekspresikan sebagai schema.
2. Tidak semua Bean Validation annotation otomatis menjadi schema constraint dengan benar.
3. Custom serializer/deserializer bisa menghasilkan shape yang tidak terlihat dari POJO.
4. Polymorphism membutuhkan discriminator design yang eksplisit.
5. Null/required behavior sering bergantung pada framework, not just DTO.
6. Jackson module tertentu punya keterbatasan versi draft JSON Schema.

Contoh masalah:

```java
@JsonSerialize(using = MaskedEmailSerializer.class)
public String email;
```

POJO mengatakan field string. Runtime response mungkin:

```json
{"email":"f***@example.com"}
```

Schema tidak tahu masking policy kecuali kita dokumentasikan.

Contoh lain:

```java
@JsonFormat(pattern = "yyyyMMdd")
private LocalDate businessDate;
```

OpenAPI default generator mungkin tetap menghasilkan:

```yaml
format: date
```

Padahal runtime menerima/menghasilkan:

```json
"20260617"
```

Ini mismatch.

Rule:

> Schema generated dari code harus dianggap draft awal, bukan bukti kebenaran kontrak.

---

## 15. Required Inference dari Java DTO

Tool OpenAPI code-first sering mencoba infer required dari:

- primitive type
- Bean Validation `@NotNull`
- record component
- Kotlin nullability jika Kotlin
- config generator

Di Java, inferensi ini rawan.

```java
public record SearchRequest(
    String keyword,
    Integer page,
    Integer size
) {}
```

Apakah `keyword` required? Tidak bisa disimpulkan hanya dari `String`.

Tambah explicit validation:

```java
public record SearchRequest(
    @NotBlank String keyword,
    @Min(0) Integer page,
    @Min(1) @Max(100) Integer size
) {}
```

Tetap perlu cek generated schema:

```yaml
required:
  - keyword
```

Jika generator tidak memasukkan `keyword` ke required, dokumentasi salah.

Jika generator memasukkan `page` dan `size` ke required padahal optional, dokumentasi juga salah.

Senior-level discipline:

```text
DTO annotation is not enough.
Generated OpenAPI must be reviewed as API artifact.
```

---

## 16. Bean Validation vs JSON Schema

Bean Validation dan JSON Schema overlap tetapi tidak identik.

| Concern | Bean Validation | JSON Schema/OpenAPI |
|---|---|---|
| Required | `@NotNull`, `@NotBlank` | `required` + non-null type |
| String length | `@Size` | `minLength`, `maxLength` |
| Pattern | `@Pattern` | `pattern` |
| Numeric min/max | `@Min`, `@Max`, `@DecimalMin` | `minimum`, `maximum` |
| Email | `@Email` | `format: email` |
| Cross-field | class-level validator | hard/awkward in schema |
| Reference data | custom validator | usually impossible/static enum only |
| Business invariant | service/domain logic | not schema’s job |

Example:

```java
public record PeriodRequest(
    @NotNull LocalDate startDate,
    @NotNull LocalDate endDate
) {}
```

Schema can say both required.

But rule:

```text
endDate must be >= startDate
```

This is cross-field validation. JSON Schema can express some conditional logic, but in many API ecosystems it becomes too complex or poorly supported. For Java backend, keep it in validation/service/domain logic, and document it.

---

## 17. Runtime Contract Profiles

Tidak semua endpoint harus memakai ObjectMapper policy yang sama.

Kita bisa punya profiles:

### 17.1 Strict request mapper

Untuk public command API:

```java
ObjectMapper strictRequestMapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
    .enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
    .build();
```

Tujuan:

- reject typo/unknown property
- reject unsafe enum numeric coercion
- reduce ambiguous input
- align with `additionalProperties: false`

### 17.2 Lenient integration mapper

Untuk inbound legacy/integration:

```java
ObjectMapper integrationMapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .build();
```

Tetapi lenient bukan berarti tanpa observability.

Tambahkan:

- raw payload capture dengan masking
- unknown enum alert
- schema compatibility check
- dead-letter path
- partner-specific error report

### 17.3 Stable response writer

Untuk response API:

```java
ObjectWriter publicResponseWriter = objectMapper
    .writerFor(UserResponse.class);
```

Tujuan:

- stable shape
- predictable inclusion policy
- testable golden output

---

## 18. OpenAPI Examples sebagai Test Artifact

Examples di OpenAPI sering dianggap kosmetik.

Padahal examples bisa menjadi test fixture.

```yaml
examples:
  validCreateUser:
    summary: Valid request
    value:
      email: user@example.com
      displayName: Jane Doe
```

Gunakan sebagai:

1. dokumentasi untuk manusia
2. fixture untuk contract test
3. baseline untuk generated client
4. regression guard saat DTO berubah

Test idea:

```java
@Test
void openApiExampleShouldDeserialize() throws Exception {
    String json = loadResource("openapi-examples/create-user-valid.json");

    CreateUserRequest request = strictMapper.readValue(json, CreateUserRequest.class);

    Set<ConstraintViolation<CreateUserRequest>> violations = validator.validate(request);
    assertThat(violations).isEmpty();
}
```

Untuk response:

```java
@Test
void responseShouldMatchGoldenPayload() throws Exception {
    UserResponse response = new UserResponse(
        UUID.fromString("11111111-1111-1111-1111-111111111111"),
        "user@example.com",
        OffsetDateTime.parse("2026-06-17T10:15:30+07:00")
    );

    String actual = mapper.writeValueAsString(response);

    assertJsonEquals(loadResource("golden/user-response.json"), actual);
}
```

Jangan snapshot semua output tanpa review. Golden payload harus intentional.

---

## 19. Contract Test Layering

Contract alignment butuh beberapa jenis test.

### 19.1 DTO binding test

Menguji Jackson binding langsung.

```java
@Test
void missingRequiredEmailShouldFailValidation() throws Exception {
    String json = "{}";

    CreateUserRequest request = mapper.readValue(json, CreateUserRequest.class);
    var violations = validator.validate(request);

    assertThat(violations)
        .extracting(v -> v.getPropertyPath().toString())
        .contains("email");
}
```

### 19.2 Unknown property test

```java
@Test
void unknownPropertyShouldBeRejected() {
    String json = """
        {
          "email": "user@example.com",
          "role": "ADMIN"
        }
        """;

    assertThatThrownBy(() -> mapper.readValue(json, CreateUserRequest.class))
        .isInstanceOf(UnrecognizedPropertyException.class);
}
```

### 19.3 Schema validation test

Validasi payload terhadap JSON Schema/OpenAPI-derived schema.

```text
actual JSON response
  -> validate against schema
  -> fail if undocumented field/missing required/wrong type
```

### 19.4 OpenAPI diff test

Saat PR mengubah OpenAPI:

```text
old-openapi.yaml
new-openapi.yaml
  -> detect breaking changes
  -> require review/approval
```

Breaking examples:

- remove field
- make optional field required
- narrow enum
- change type
- make nullable field non-nullable
- remove response code
- change path/method

### 19.5 Consumer-driven contract test

Consumer mendefinisikan expectation payload minimal. Provider harus memenuhi.

Cocok untuk:

- microservices
- vendor integration
- FE/backend contract
- async event consumer expectation

---

## 20. Golden Payload Tests

Golden payload adalah JSON/XML canonical yang mewakili contract.

Contoh:

`golden/create-user-request.valid.json`

```json
{
  "email": "user@example.com",
  "displayName": "Jane Doe"
}
```

`golden/create-user-request.unknown-field.json`

```json
{
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "role": "ADMIN"
}
```

`golden/user-response.valid.json`

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "email": "user@example.com",
  "createdAt": "2026-06-17T10:15:30+07:00"
}
```

Golden payload harus mencakup:

```text
[ ] Minimal valid request
[ ] Full valid request
[ ] Missing required field
[ ] Explicit null field
[ ] Unknown field
[ ] Invalid enum
[ ] Future enum if tolerant reader
[ ] Invalid date format
[ ] Boundary number
[ ] Deprecated field
[ ] Alias field if supported
[ ] Response with optional absent field
[ ] Response with optional null field if contract allows
```

---

## 21. Schema Drift Detection

Drift terjadi ketika satu artifact berubah tanpa yang lain.

Contoh drift:

```text
Java DTO: added field `riskScore`
OpenAPI: not updated
Response runtime: now emits riskScore
Frontend: ignores, maybe okay
Public consumer: complains undocumented field
Security: riskScore should not have been public
```

Atau:

```text
OpenAPI: field `statusReason` marked required
Java DTO: field nullable
Runtime: sometimes omits due to NON_NULL
Generated client: crashes on missing field
```

### 21.1 Drift detection pipeline

```text
Build step:
  1. Generate OpenAPI from code or fetch contract source.
  2. Normalize OpenAPI output.
  3. Compare with committed contract.
  4. Run breaking-change diff.
  5. Run golden payload tests.
  6. Run schema validation against actual controller examples.
```

### 21.2 Normalize before diff

OpenAPI generated output can reorder fields.

Normalize:

- sort keys
- remove timestamp metadata
- stable formatting
- stable component ordering
- canonical YAML/JSON representation

Otherwise diff becomes noisy.

---

## 22. DTO Annotation Strategy

Annotation can be useful, but uncontrolled annotation layering creates hidden contract.

Example overloaded DTO:

```java
public class UserDto {
    @JsonProperty("user_id")
    @Schema(description = "User identifier")
    @NotNull
    private UUID id;

    @JsonInclude(JsonInclude.Include.NON_NULL)
    @Schema(nullable = true)
    private String displayName;
}
```

Possible issue:

- Jackson says omit null.
- Schema says nullable.
- Consumer expects field can be present as null.
- Runtime omits it instead.

Nullable and optional are not same.

Better document intentionally:

```yaml
displayName:
  type: string
  description: Optional. Field may be absent when not configured.
```

Or if field must always be present but can be null, configure serialization accordingly.

```java
@JsonInclude(JsonInclude.Include.ALWAYS)
public record UserResponse(
    UUID id,
    String displayName
) {}
```

Policy:

```text
[ ] Do not mix @JsonInclude(NON_NULL) with schema that implies field always present unless tested.
[ ] Do not rely on Java nullable type to infer OpenAPI nullable.
[ ] Do not put security-sensitive fields on shared DTO.
[ ] Prefer request/response-specific DTOs over directionality annotations when risk is high.
```

---

## 23. Versioning Contract

API contract evolves. The question is whether it evolves safely.

### 23.1 Usually non-breaking

- Add optional response field.
- Add optional request field with safe default.
- Add new endpoint.
- Add new response code if clients tolerate it.
- Add enum value only if enum documented as open/tolerant.

### 23.2 Usually breaking

- Remove field.
- Rename field.
- Change field type.
- Make optional field required.
- Make nullable field non-nullable.
- Remove enum value.
- Add enum value to closed enum if clients generated exhaustive switch.
- Change date format.
- Change numeric precision/scale.
- Change semantic meaning while keeping name.

### 23.3 Rename strategy

Bad:

```text
v1 response: fullName
v2 response: displayName
remove fullName immediately
```

Safer:

```text
Step 1: Add displayName, keep fullName.
Step 2: Mark fullName deprecated.
Step 3: Populate both from same source.
Step 4: Monitor consumer migration.
Step 5: Remove fullName in major version/window.
```

Jackson support:

```java
public record UserResponse(
    String displayName,

    @Deprecated
    String fullName
) {}
```

Inbound alias:

```java
public record UpdateUserRequest(
    @JsonAlias("fullName")
    String displayName
) {}
```

But do not overuse alias silently. Alias can hide consumer migration problems.

---

## 24. Generated Clients: Contract Becomes Code Elsewhere

OpenAPI often generates clients for:

- TypeScript frontend
- Java client
- Kotlin client
- C# client
- Python client
- mobile client

Small schema change can cause compile/runtime change in generated code.

Example:

```yaml
status:
  type: string
  enum: [DRAFT, SUBMITTED]
```

Generated TypeScript might be:

```ts
export type Status = 'DRAFT' | 'SUBMITTED';
```

If backend returns:

```json
{"status":"APPROVED"}
```

Client may fail if not regenerated, or UI switch may not handle it.

Java generated client might generate enum:

```java
public enum Status {
    DRAFT,
    SUBMITTED
}
```

Unknown value may fail deserialization.

Therefore:

- enum addition in response can be breaking for generated clients
- optional field addition is usually safe, but strict clients may reject unknown field
- required field addition to request breaks clients
- changing nullability can break generated type checks

Top 1% engineer thinks not only from provider’s code, but from generated consumer code.

---

## 25. OpenAPI for Polymorphism

Jackson polymorphism and OpenAPI polymorphism must align.

Java:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = EmailNotification.class, name = "EMAIL"),
    @JsonSubTypes.Type(value = SmsNotification.class, name = "SMS")
})
public sealed interface Notification permits EmailNotification, SmsNotification {}
```

OpenAPI:

```yaml
Notification:
  oneOf:
    - $ref: '#/components/schemas/EmailNotification'
    - $ref: '#/components/schemas/SmsNotification'
  discriminator:
    propertyName: type
    mapping:
      EMAIL: '#/components/schemas/EmailNotification'
      SMS: '#/components/schemas/SmsNotification'
```

Each subtype:

```yaml
EmailNotification:
  type: object
  required: [type, emailAddress]
  properties:
    type:
      type: string
      enum: [EMAIL]
    emailAddress:
      type: string
      format: email
```

Alignment checklist:

```text
[ ] Jackson discriminator property equals OpenAPI discriminator propertyName.
[ ] Jackson subtype names equal OpenAPI discriminator mapping keys.
[ ] Each subtype schema requires discriminator field.
[ ] Unknown discriminator behavior is defined.
[ ] Security review done for polymorphic deserialization.
[ ] Generated clients handle oneOf as expected.
[ ] Golden payload exists for every subtype.
```

---

## 26. `oneOf`, `anyOf`, `allOf`: Jangan Sekadar Ikut Generator

### 26.1 `oneOf`

Exactly one schema should match.

Cocok untuk discriminated union.

```yaml
paymentMethod:
  oneOf:
    - $ref: '#/components/schemas/CardPayment'
    - $ref: '#/components/schemas/BankTransferPayment'
```

### 26.2 `anyOf`

One or more schemas can match.

Sering membingungkan untuk generated client.

### 26.3 `allOf`

Composition/intersection.

Sering dipakai untuk inheritance-like modeling.

```yaml
AdminUser:
  allOf:
    - $ref: '#/components/schemas/User'
    - type: object
      properties:
        adminLevel:
          type: integer
```

Hati-hati: Java inheritance, Jackson inheritance, and OpenAPI `allOf` are not always semantically identical.

Rule:

> Gunakan composition schema untuk express wire contract, bukan untuk memaksakan inheritance Java ke API.

---

## 27. Response Inclusion Policy and Schema

Jackson:

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserResponse(
    UUID id,
    String email,
    String phoneNumber
) {}
```

If `phoneNumber = null`, output:

```json
{
  "id": "...",
  "email": "user@example.com"
}
```

OpenAPI should not imply `phoneNumber` is always present.

Schema:

```yaml
required:
  - id
  - email
properties:
  id:
    type: string
    format: uuid
  email:
    type: string
  phoneNumber:
    type: string
```

If contract requires field present as null:

```json
{
  "id": "...",
  "email": "user@example.com",
  "phoneNumber": null
}
```

Then schema must allow null, and Jackson inclusion must include null.

OpenAPI 3.1:

```yaml
required:
  - id
  - email
  - phoneNumber
properties:
  phoneNumber:
    type:
      - string
      - 'null'
```

Jackson:

```java
@JsonInclude(JsonInclude.Include.ALWAYS)
public record UserResponse(... ) {}
```

---

## 28. Request Defaulting Policy

Schema can define default:

```yaml
page:
  type: integer
  default: 0
size:
  type: integer
  default: 20
```

But OpenAPI `default` documentation does not automatically mean Jackson applies it.

Java:

```java
public record SearchRequest(
    String keyword,
    Integer page,
    Integer size
) {
    public int effectivePage() {
        return page == null ? 0 : page;
    }

    public int effectiveSize() {
        return size == null ? 20 : size;
    }
}
```

Better: map request DTO to command with defaulting explicitly.

```java
public record SearchCommand(
    String keyword,
    int page,
    int size
) {}

public final class SearchRequestMapper {
    public SearchCommand toCommand(SearchRequest request) {
        return new SearchCommand(
            request.keyword(),
            request.page() == null ? 0 : request.page(),
            request.size() == null ? 20 : request.size()
        );
    }
}
```

Why?

- request DTO preserves raw input shape
- command gets effective business values
- defaulting is testable
- OpenAPI default matches mapping logic

---

## 29. Contract Alignment in Spring Boot Context

A common Spring Boot stack:

```text
Controller
  -> Request DTO
  -> Jackson deserialization
  -> Bean Validation
  -> Mapper
  -> Command/Application service
  -> Domain/Persistence
  -> Mapper
  -> Response DTO
  -> Jackson serialization
  -> OpenAPI generated documentation
```

Contract alignment points:

```text
OpenAPI request schema
  must match Request DTO + Jackson + Validation

OpenAPI response schema
  must match Response DTO + Jackson serialization config

OpenAPI examples
  must pass runtime deserialization/serialization tests

Generated OpenAPI
  must be diffed and reviewed
```

### 29.1 Controller anti-pattern

```java
@PostMapping("/users")
public UserEntity create(@RequestBody UserEntity entity) {
    return repository.save(entity);
}
```

Problems:

- entity exposed as input contract
- over-posting risk
- lazy/proxy serialization issue
- DB shape leaks to API
- OpenAPI schema tied to persistence
- changing entity breaks API

Better:

```java
@PostMapping("/users")
public UserResponse create(@Valid @RequestBody CreateUserRequest request) {
    CreateUserCommand command = mapper.toCommand(request);
    User user = service.create(command);
    return mapper.toResponse(user);
}
```

---

## 30. Event Schema Alignment

OpenAPI is HTTP-focused. Event payloads still need schema discipline.

Example event:

```json
{
  "eventId": "...",
  "eventType": "ApplicationSubmitted",
  "occurredAt": "2026-06-17T10:15:30+07:00",
  "schemaVersion": 1,
  "payload": {
    "applicationId": "A-123",
    "submittedBy": "U-999"
  }
}
```

Event schema concerns:

- envelope vs payload
- schema version
- event type discriminator
- backward/forward compatibility
- consumer tolerant reader policy
- raw event retention
- replay compatibility
- deprecation window
- idempotency key

Schema-first is often useful for event payloads because consumer may not be Java.

Contract tests should include:

```text
[ ] Old event version can still deserialize.
[ ] New optional field does not break old consumer.
[ ] Unknown event type goes to safe path.
[ ] Unknown enum triggers alert/preserve raw value.
[ ] Replay old golden event payload works.
```

---

## 31. Compatibility Review Checklist

Before changing DTO/schema, ask:

```text
Presence:
[ ] Did we add/remove a required field?
[ ] Did we change optional to required?
[ ] Did we change required to optional?

Nullability:
[ ] Did we allow null where previously not allowed?
[ ] Did we disallow null where previously allowed?
[ ] Does Jackson inclusion match schema?

Type:
[ ] Did the JSON type change?
[ ] Did Java type change but wire type stay same?
[ ] Did date/time format change?
[ ] Did numeric precision/scale change?

Enum:
[ ] Did we add enum value?
[ ] Is enum closed or open?
[ ] Do generated clients handle unknown value?

Object shape:
[ ] Did we rename field?
[ ] Did we remove field?
[ ] Did we flatten/unflatten nested object?
[ ] Did we add unknown additionalProperties behavior?

Security:
[ ] Did new field expose sensitive/internal data?
[ ] Is field request-only or response-only?
[ ] Can user over-post this field?

Runtime:
[ ] Does Jackson actually serialize/deserialize as schema says?
[ ] Do validation errors match contract?
[ ] Are examples still valid?

Consumer:
[ ] Which consumers are affected?
[ ] Are generated clients impacted?
[ ] Is migration/deprecation plan needed?
```

---

## 32. Contract Ownership

Tanpa owner, contract akan drift.

Possible ownership model:

```text
API owner:
  Owns OpenAPI and compatibility policy.

Backend owner:
  Owns runtime DTO/Jackson/validation implementation.

Consumer owner:
  Owns client expectation and feedback.

Architecture/API review:
  Reviews breaking changes, security exposure, naming, versioning.
```

For internal team, one engineer may wear multiple hats, but responsibilities still must be explicit.

Minimum governance:

```text
[ ] OpenAPI committed in repository.
[ ] Contract diff visible in PR.
[ ] Breaking change requires explicit approval.
[ ] DTO changes require payload tests.
[ ] Public examples must be executable tests.
[ ] Unknown field policy documented per API category.
[ ] Enum evolution policy documented.
```

---

## 33. Practical Blueprint: Code-First with Guardrails

For many Java teams, code-first is the current reality. Here is a pragmatic blueprint.

### 33.1 DTO

```java
public record CreateCaseRequest(
    @NotBlank String applicantId,
    @NotBlank String caseType,
    @Size(max = 2000) String description
) {}
```

### 33.2 Command

```java
public record CreateCaseCommand(
    ApplicantId applicantId,
    CaseType caseType,
    String description
) {}
```

### 33.3 Mapper

```java
public final class CreateCaseMapper {
    public CreateCaseCommand toCommand(CreateCaseRequest request) {
        return new CreateCaseCommand(
            ApplicantId.parse(request.applicantId()),
            CaseType.fromCode(request.caseType()),
            normalizeDescription(request.description())
        );
    }

    private String normalizeDescription(String value) {
        return value == null ? null : value.trim();
    }
}
```

### 33.4 OpenAPI expected shape

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required:
    - applicantId
    - caseType
  properties:
    applicantId:
      type: string
    caseType:
      type: string
      enum: [COMPLAINT, INVESTIGATION, APPEAL]
    description:
      type: string
      maxLength: 2000
```

### 33.5 Tests

```java
@Test
void validExampleShouldBindAndValidate() throws Exception {
    String json = """
        {
          "applicantId": "A-123",
          "caseType": "COMPLAINT",
          "description": "Something happened"
        }
        """;

    CreateCaseRequest request = mapper.readValue(json, CreateCaseRequest.class);
    assertThat(validator.validate(request)).isEmpty();
}

@Test
void unknownFieldShouldBeRejected() {
    String json = """
        {
          "applicantId": "A-123",
          "caseType": "COMPLAINT",
          "internalPriority": "HIGH"
        }
        """;

    assertThatThrownBy(() -> mapper.readValue(json, CreateCaseRequest.class))
        .isInstanceOf(UnrecognizedPropertyException.class);
}
```

### 33.6 CI guardrail

```text
mvn test
  -> DTO binding tests
  -> validation tests
  -> golden payload tests
  -> generated OpenAPI diff
  -> OpenAPI breaking change check
```

---

## 34. Practical Blueprint: Contract-First for Integration API

For external integration, start from OpenAPI/JSON Schema.

### 34.1 Contract

```yaml
SubmitApplicationRequest:
  type: object
  additionalProperties: false
  required:
    - applicationId
    - applicant
    - submittedAt
  properties:
    applicationId:
      type: string
    applicant:
      $ref: '#/components/schemas/Applicant'
    submittedAt:
      type: string
      format: date-time
```

### 34.2 Generated model is not domain model

Do not use generated class as domain aggregate.

```text
Generated SubmitApplicationRequest
  -> Integration mapper
  -> ApplicationSubmissionCommand
  -> Domain/application service
```

### 34.3 Anti-corruption mapping

```java
public final class SubmitApplicationAclMapper {
    public ApplicationSubmissionCommand toCommand(SubmitApplicationRequest request) {
        return new ApplicationSubmissionCommand(
            ApplicationId.of(request.getApplicationId()),
            mapApplicant(request.getApplicant()),
            request.getSubmittedAt().toInstant()
        );
    }
}
```

Contract-first does not remove mapper. It makes mapper more important.

---

## 35. Common Anti-Patterns

### Anti-pattern 1: “OpenAPI generated, therefore correct”

Generated docs can be wrong or incomplete.

Fix:

```text
Review generated OpenAPI as contract artifact.
```

### Anti-pattern 2: “DTO annotation equals runtime behavior”

Annotations do not always enforce what they document.

Fix:

```text
Test runtime deserialization/serialization.
```

### Anti-pattern 3: “Nullable means optional”

Nullable and optional are different.

Fix:

```text
Model presence and nullability separately.
```

### Anti-pattern 4: “Enum addition is always safe”

Generated clients may fail.

Fix:

```text
Define closed/open enum policy.
```

### Anti-pattern 5: “Use entity as schema”

Persistence model becomes public contract.

Fix:

```text
Use boundary DTO.
```

### Anti-pattern 6: “Ignore unknown fields everywhere”

May hide typo, attack attempt, or unsupported client behavior.

Fix:

```text
Boundary-specific unknown field policy.
```

### Anti-pattern 7: “Schema default automatically applies”

OpenAPI `default` is not automatically runtime defaulting.

Fix:

```text
Implement and test defaulting in mapper/application layer.
```

---

## 36. Senior Mental Model: Contract Alignment as Invariant

A top-level engineer treats API contract as a set of invariants.

Example invariants:

```text
Invariant 1:
Every field marked required in OpenAPI must be enforced by runtime binding/validation.

Invariant 2:
Every field omitted by Jackson due to inclusion policy must not be required in response schema.

Invariant 3:
Every request-only field must never appear in response serialization.

Invariant 4:
Every response-only field must be ignored/rejected from client request.

Invariant 5:
Every enum evolution must be classified as closed/open before release.

Invariant 6:
Every public DTO change must produce OpenAPI diff and compatibility decision.

Invariant 7:
Every published example must deserialize/serialize successfully in tests.
```

This is the difference between “I can make REST API” and “I can govern contracts safely across teams, versions, and runtime boundaries.”

---

## 37. Recommended Policy Template

You can adapt this for real projects.

```text
API Contract Policy

1. All public request/response payloads must use dedicated DTOs.
2. Entity classes must not be exposed directly as request/response schema.
3. OpenAPI must be committed and reviewed.
4. Generated OpenAPI diff must be visible in PR.
5. Request DTOs must define required/nullability explicitly using validation and schema review.
6. Public command APIs must reject unknown fields unless explicitly documented otherwise.
7. Event consumers may ignore unknown fields, but unknown enum/discriminator must be observable.
8. Response inclusion policy must match schema required/nullability.
9. Examples in OpenAPI must be executable tests.
10. Enum fields must be classified as closed or open.
11. Deprecated fields must have migration plan and removal version/date.
12. Breaking changes require explicit approval.
13. Sensitive fields must be reviewed for readOnly/writeOnly and serialization exposure.
14. Default values must be implemented in mapper/application code, not assumed from OpenAPI.
15. DTO/schema/mapper tests must cover missing, null, unknown, invalid enum, and date format cases.
```

---

## 38. Mini Case Study: Case Management API

Suppose we have an endpoint:

```http
POST /cases
```

Request:

```json
{
  "caseType": "COMPLAINT",
  "applicantId": "A-10001",
  "description": "Noise complaint near block 123",
  "attachments": [
    {"documentId": "D-1", "type": "PHOTO"}
  ]
}
```

### 38.1 Contract concerns

```text
caseType:
  required, closed enum for request

applicantId:
  required, string format may be agency-specific

description:
  optional? nullable? max length? trim?

attachments:
  optional array? empty array allowed? max items?

documentId:
  required per attachment

type:
  closed or open enum?

unknown fields:
  reject for command API
```

### 38.2 Java DTO

```java
public record CreateCaseRequest(
    @NotBlank String caseType,
    @NotBlank String applicantId,
    @Size(max = 4000) String description,
    @Valid List<AttachmentRequest> attachments
) {}

public record AttachmentRequest(
    @NotBlank String documentId,
    @NotBlank String type
) {}
```

### 38.3 OpenAPI

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required:
    - caseType
    - applicantId
  properties:
    caseType:
      type: string
      enum: [COMPLAINT, INVESTIGATION, APPEAL]
    applicantId:
      type: string
    description:
      type: string
      maxLength: 4000
    attachments:
      type: array
      items:
        $ref: '#/components/schemas/AttachmentRequest'

AttachmentRequest:
  type: object
  additionalProperties: false
  required:
    - documentId
    - type
  properties:
    documentId:
      type: string
    type:
      type: string
      enum: [PHOTO, PDF, SUPPORTING_DOCUMENT]
```

### 38.4 Runtime tests

```text
[ ] Missing caseType rejected.
[ ] Null caseType rejected.
[ ] Empty caseType rejected.
[ ] Unknown caseType rejected.
[ ] Unknown top-level field rejected.
[ ] Unknown attachment field rejected.
[ ] Attachment missing documentId rejected.
[ ] Description > 4000 rejected.
[ ] Empty attachments accepted or rejected based on policy.
[ ] Response payload matches schema.
```

### 38.5 Response DTO

```java
public record CreateCaseResponse(
    String caseId,
    String status,
    OffsetDateTime createdAt
) {}
```

Schema:

```yaml
CreateCaseResponse:
  type: object
  required:
    - caseId
    - status
    - createdAt
  properties:
    caseId:
      type: string
    status:
      type: string
      enum: [DRAFT, SUBMITTED]
    createdAt:
      type: string
      format: date-time
```

If later status can become `PENDING_SCREENING`, compatibility review required.

---

## 39. Exercise

### Exercise 1

Given DTO:

```java
public record UpdateProfileRequest(
    String displayName,
    String phoneNumber,
    Boolean marketingConsent
) {}
```

Design OpenAPI schema for PUT semantics and PATCH semantics separately.

Questions:

1. Which fields are required for PUT?
2. How do you represent clearing `phoneNumber`?
3. Is `marketingConsent = null` valid?
4. How do you distinguish absent from null in PATCH?
5. What Jackson strategy do you use?

### Exercise 2

Given enum:

```java
public enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH
}
```

Your API returns risk level to external clients.

Questions:

1. Is enum closed or open?
2. What happens if you add `CRITICAL`?
3. How do generated TypeScript clients behave?
4. Should schema use `enum`?
5. Should response include raw code and display label?

### Exercise 3

Given response DTO:

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserResponse(
    UUID id,
    String email,
    String phoneNumber
) {}
```

Questions:

1. Should `phoneNumber` be in OpenAPI `required`?
2. Should schema mark `phoneNumber` nullable?
3. What payload appears when phone number is null?
4. How would you change runtime if contract requires explicit null?

---

## 40. Summary

Pada bagian ini kita membangun mental model bahwa OpenAPI/JSON Schema, DTO Java, Jackson runtime, validation, dan generated clients adalah satu ekosistem kontrak.

Poin utama:

1. Required tidak sama dengan non-null.
2. Nullable tidak sama dengan optional.
3. Absent, null, dan empty punya makna berbeda.
4. Schema `default` tidak otomatis menjadi runtime default.
5. Schema `format` tidak selalu berarti runtime validation.
6. Unknown field policy harus boundary-specific.
7. Enum harus diklasifikasikan closed atau open.
8. Request DTO dan response DTO sebaiknya dipisah.
9. Code-first cepat, tetapi perlu guardrail.
10. Contract-first kuat untuk integration/public API, tetapi tetap butuh mapper.
11. Generated OpenAPI harus direview sebagai artifact kontrak.
12. Golden payload dan schema tests adalah regression safety net.
13. Contract alignment harus diperlakukan sebagai invariant engineering.

---

## 41. Referensi

- OpenAPI Specification v3.1.1 — https://spec.openapis.org/oas/v3.1.1.html
- OpenAPI Specification v3.1.0 — https://spec.openapis.org/oas/v3.1.0.html
- OpenAPI Initiative: Migrating from OpenAPI 3.0 to 3.1.0 — https://www.openapis.org/blog/2021/02/16/migrating-from-openapi-3-0-to-3-1-0
- JSON Schema Object Reference — https://json-schema.org/understanding-json-schema/reference/object
- FasterXML Jackson portal — https://github.com/FasterXML/jackson
- FasterXML Jackson JSON Schema module — https://github.com/FasterXML/jackson-module-jsonSchema
- Jackson Databind `JsonSchema` deprecated API note — https://fasterxml.github.io/jackson-databind/javadoc/2.5/com/fasterxml/jackson/databind/jsonschema/JsonSchema.html

---

## 42. Posisi dalam Seri

Selesai: Part 15 dari 35.

Berikutnya:

**Part 16 — XML Mapping in Modern Java: JAXB/Jakarta XML Binding and Jackson XML**

Bagian berikutnya akan masuk ke XML mapping modern di Java: JAXB/Jakarta XML Binding, Jackson XML, element vs attribute, namespace, wrapper element, ordering, XML date/time, dan migrasi `javax.xml.bind` ke `jakarta.xml.bind`.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 14 — Jackson Performance: Allocation, Streaming, Large Payloads, Hot Paths](./14-jackson-performance-allocation-streaming-large-payloads-hot-paths.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 16 — XML Mapping in Modern Java: JAXB/Jakarta XML Binding and Jackson XML](./16-xml-mapping-modern-java-jaxb-jakarta-xml-binding-jackson-xml.md)

</div>