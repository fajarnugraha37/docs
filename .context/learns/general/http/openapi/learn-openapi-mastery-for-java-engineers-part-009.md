# OpenAPI Mastery for Java Engineers — Part 009
# Schema Object Deep Dive: Types, Constraints, Formats, and Validation Semantics

> Seri: `learn-openapi-mastery-for-java-engineers`  
> Part: `009 / 030`  
> File: `learn-openapi-mastery-for-java-engineers-part-009.md`  
> Target pembaca: Java software engineer yang ingin memahami OpenAPI sebagai contract engineering discipline, bukan sekadar Swagger UI atau YAML dokumentasi.

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya, kita sudah membahas:

- struktur dokumen OpenAPI,
- paths dan operations,
- parameters,
- request bodies,
- responses,
- components.

Sekarang kita masuk ke salah satu inti paling penting: **Schema Object**.

Kalau `paths` menjawab:

> API ini punya capability apa?

Maka `schema` menjawab:

> Bentuk data apa yang sah, apa yang wajib, apa yang opsional, apa yang boleh berubah, apa yang tidak boleh berubah, dan constraint apa yang consumer/provider harus patuhi?

Bagi Java engineer, Schema Object sering terlihat seperti versi YAML dari class DTO. Ini framing yang terlalu dangkal.

Schema bukan class. Schema adalah **contract constraint**.

Class adalah representasi dalam runtime tertentu. Schema adalah komitmen lintas runtime, lintas bahasa, lintas tim, lintas waktu, dan lintas versi.

---

## 1. Core Mental Model

OpenAPI Schema Object adalah mekanisme untuk mendeskripsikan input dan output data types. Dalam OpenAPI 3.1+ dan 3.2, Schema Object sangat dekat dengan JSON Schema Draft 2020-12. OpenAPI Specification v3.2.0 menyatakan bahwa Schema Object mendefinisikan input/output data types, mencakup object, primitive, dan array, serta merupakan superset dari JSON Schema Draft 2020-12.

Mental model yang tepat:

```text
HTTP operation
  └── request/response/parameter/header
        └── media type or serialization form
              └── schema
                    └── constraints over acceptable data instances
```

Schema tidak hanya berkata:

```text
field ini String
```

Schema berkata:

```text
field ini string, wajib ada di response tertentu, tidak boleh kosong,
formatnya email, panjang maksimal 254, tidak boleh dikirim di request create,
boleh muncul di response read, dan kalau nilainya tidak dikenal client harus tetap toleran.
```

Perbedaan ini penting.

---

## 2. Schema Object Bukan Java DTO

Java DTO punya sifat:

- hidup di runtime Java,
- punya class name,
- punya field,
- punya annotation,
- bisa dipakai oleh Jackson,
- bisa dipakai oleh Bean Validation,
- bisa dipakai internal application layer,
- bisa berubah mengikuti refactor.

OpenAPI schema punya sifat:

- hidup di boundary API,
- dikonsumsi oleh banyak bahasa,
- menjadi dasar validasi,
- menjadi dasar generated client/server,
- menjadi dokumentasi formal,
- menjadi contract compatibility baseline,
- tidak boleh berubah hanya karena internal refactor.

Contoh kesalahan umum:

```java
class CaseEntity {
    private UUID id;
    private String internalWorkflowCode;
    private String assignedOfficerUsername;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Integer optimisticLockVersion;
}
```

Lalu schema digenerate langsung sebagai:

```yaml
CaseEntity:
  type: object
  properties:
    id:
      type: string
      format: uuid
    internalWorkflowCode:
      type: string
    assignedOfficerUsername:
      type: string
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
    optimisticLockVersion:
      type: integer
      format: int32
```

Ini tampak praktis, tetapi contract-nya buruk karena:

1. Nama `CaseEntity` membocorkan persistence model.
2. Field internal ikut terekspos.
3. Field yang semestinya read-only tidak ditandai.
4. Timestamp tidak menjelaskan timezone/precision.
5. `optimisticLockVersion` belum jelas apakah client boleh mengirimnya.
6. Tidak ada state/lifecycle semantics.
7. Tidak ada constraint yang cukup.

Versi contract yang lebih matang:

```yaml
CaseSummary:
  type: object
  required:
    - caseId
    - status
    - receivedAt
  properties:
    caseId:
      type: string
      format: uuid
      description: Stable public identifier for the case.
      readOnly: true
    status:
      $ref: '#/components/schemas/CaseStatus'
    receivedAt:
      type: string
      format: date-time
      description: Time when the case was received by the system. Serialized as RFC 3339 date-time.
      readOnly: true
    assignedUnit:
      type: string
      description: Public-facing unit currently responsible for the case.
      readOnly: true
```

Perhatikan bedanya. Schema kedua tidak mencoba menjadi mirror entity. Ia mendeskripsikan representasi API.

---

## 3. JSON Schema Data Model

OpenAPI Schema Object menggunakan tipe data yang berdasarkan JSON Schema:

- `null`
- `boolean`
- `object`
- `array`
- `number`
- `string`
- `integer`

Namun ada detail penting: JSON sendiri tidak membedakan integer sebagai tipe terpisah dari number. JSON Schema mendefinisikan integer secara matematis. Artinya, secara data model, `1` dan `1.0` bisa dianggap integer-equivalent dalam konteks tertentu.

Untuk engineer Java, ini penting karena Java membedakan:

```java
int
long
Integer
Long
BigInteger
float
double
BigDecimal
```

Sedangkan JSON wire format jauh lebih miskin secara tipe.

Konsekuensinya:

- Jangan menganggap `format: int64` otomatis aman di semua client JavaScript.
- Jangan menganggap `number` selalu cocok dengan `double`.
- Untuk uang/amount yang presisi, sering lebih aman memakai string decimal yang dijelaskan semantiknya, atau number dengan constraint dan keputusan serialization yang eksplisit.
- Untuk ID numerik besar, string ID bisa lebih aman daripada integer 64-bit di ekosistem JavaScript.

---

## 4. `type`: Constraint Pertama yang Sering Diremehkan

Contoh paling sederhana:

```yaml
amount:
  type: number
```

Ini terlalu longgar.

Pertanyaan yang belum terjawab:

- Apakah boleh negatif?
- Apakah boleh nol?
- Berapa maksimum?
- Apakah decimal precision penting?
- Apakah currency terpisah?
- Apakah null boleh?
- Apakah field wajib ada?
- Apakah field boleh dikirim client?

Lebih baik:

```yaml
PenaltyAmount:
  type: object
  required:
    - amount
    - currency
  properties:
    amount:
      type: string
      pattern: '^[0-9]+(\\.[0-9]{1,2})?$'
      description: Decimal monetary amount serialized as string to preserve precision. Must be non-negative with at most 2 decimal places.
      examples:
        - '1250.00'
    currency:
      type: string
      minLength: 3
      maxLength: 3
      pattern: '^[A-Z]{3}$'
      description: ISO 4217 currency code.
      examples:
        - USD
```

Kenapa string untuk amount? Bukan aturan mutlak, tetapi keputusan sadar. Dalam API yang harus menjaga presisi lintas bahasa, string decimal sering lebih aman daripada floating number.

---

## 5. Required vs Optional: Kehadiran Field, Bukan Nilai Non-Null

Salah satu miskonsepsi terbesar:

```yaml
required:
  - name
```

Banyak engineer mengira ini berarti:

```text
name tidak boleh null
```

Yang lebih tepat:

```text
name wajib hadir sebagai property pada object.
```

Apakah nilainya boleh `null` tergantung schema property-nya.

Dalam OpenAPI 3.1+:

```yaml
name:
  type: string
```

berarti value harus string jika property ada.

Kalau ingin menerima string atau null:

```yaml
name:
  type:
    - string
    - 'null'
```

Contoh:

```yaml
Person:
  type: object
  required:
    - name
    - middleName
  properties:
    name:
      type: string
      minLength: 1
    middleName:
      type:
        - string
        - 'null'
```

Interpretasi:

- `name` harus ada dan harus string minimal 1 karakter.
- `middleName` harus ada, tetapi boleh string atau null.

Bandingkan:

```yaml
Person:
  type: object
  required:
    - name
  properties:
    name:
      type: string
      minLength: 1
    middleName:
      type:
        - string
        - 'null'
```

Interpretasi:

- `name` wajib.
- `middleName` boleh tidak ada.
- Jika `middleName` ada, nilainya boleh string atau null.

Ini perbedaan besar untuk compatibility.

---

## 6. Optional, Nullable, Missing: Tiga Keadaan yang Berbeda

Dalam API, setidaknya ada tiga keadaan:

```text
missing property
property present with null
property present with value
```

Contoh JSON:

```json
{}
```

```json
{"middleName": null}
```

```json
{"middleName": "Raden"}
```

Ketiganya bisa punya arti berbeda.

Untuk request PATCH, misalnya:

```text
missing      = jangan ubah field
null         = hapus nilai field
string value = set nilai baru
```

Schema-nya harus mendukung semantic itu secara sadar:

```yaml
UpdatePersonRequest:
  type: object
  properties:
    middleName:
      type:
        - string
        - 'null'
      description: >
        Omit to leave unchanged. Send null to clear the middle name. Send a string to replace it.
```

Kalau Java DTO-nya hanya:

```java
private String middleName;
```

maka runtime Java sulit membedakan missing vs explicit null, tergantung Jackson configuration. Untuk partial update, kadang perlu wrapper seperti:

```java
sealed interface PatchField<T> {
    record Missing<T>() implements PatchField<T> {}
    record NullValue<T>() implements PatchField<T> {}
    record Present<T>(T value) implements PatchField<T> {}
}
```

Atau memakai JSON Merge Patch/JSON Patch dengan semantics yang jelas.

Intinya: schema harus menangkap contract, bukan terbatas oleh kenyamanan DTO.

---

## 7. OAS 3.0 `nullable` vs OAS 3.1/3.2 `type: ['string', 'null']`

Di OpenAPI 3.0, banyak schema memakai:

```yaml
name:
  type: string
  nullable: true
```

Di OpenAPI 3.1+ dan 3.2, karena alignment dengan JSON Schema, bentuk yang lebih tepat adalah:

```yaml
name:
  type:
    - string
    - 'null'
```

Ini penting saat migrasi.

Kalau organisasi masih memakai OAS 3.0 karena tooling, `nullable: true` masih umum. Tetapi untuk seri ini, baseline mental model kita adalah OAS 3.2 dengan JSON Schema style.

Migration checklist:

```text
OAS 3.0
  type: string
  nullable: true

OAS 3.1/3.2
  type: [string, 'null']
```

Namun jangan migrasi mekanis tanpa memahami semantics. Tanyakan:

- Apakah field boleh null di request?
- Apakah field boleh null di response?
- Apakah null beda arti dengan missing?
- Apakah generated client mendukung union with null?
- Apakah validation library sudah support draft 2020-12?

---

## 8. String Constraints

String tanpa constraint sering terlalu lemah:

```yaml
username:
  type: string
```

Lebih baik:

```yaml
username:
  type: string
  minLength: 3
  maxLength: 64
  pattern: '^[a-zA-Z0-9._-]+$'
  description: Stable login username. Case-sensitive.
```

String keywords yang sering dipakai:

| Keyword | Fungsi |
|---|---|
| `minLength` | panjang minimum |
| `maxLength` | panjang maksimum |
| `pattern` | regex constraint |
| `format` | annotation format, tidak selalu divalidasi |
| `enum` | nilai terbatas |
| `const` | satu nilai tertentu |

### 8.1 `minLength: 1` Tidak Sama Dengan Non-Blank

```yaml
name:
  type: string
  minLength: 1
```

Ini mencegah string kosong `""`, tetapi belum tentu mencegah string berisi spasi:

```json
{"name": "   "}
```

Kalau ingin non-blank:

```yaml
name:
  type: string
  minLength: 1
  pattern: '.*\\S.*'
```

Namun hati-hati: regex portability antar tools bisa berbeda. Jangan gunakan regex terlalu kompleks untuk rule bisnis yang lebih baik dijelaskan dan divalidasi di application layer.

### 8.2 `pattern` Harus Dibaca Sebagai Constraint Teknis

Contoh:

```yaml
caseNumber:
  type: string
  pattern: '^CASE-[0-9]{4}-[0-9]{6}$'
  examples:
    - CASE-2026-000123
```

Ini bagus kalau case number memang punya format publik stabil.

Buruk kalau format ini internal dan mungkin berubah.

Rule:

```text
Gunakan pattern untuk format publik yang sengaja menjadi contract.
Jangan gunakan pattern untuk detail internal yang bisa berubah.
```

---

## 9. `format`: Annotation, Bukan Garansi Validasi Universal

OpenAPI v3.2 mengikuti JSON Schema model bahwa `format` pada dasarnya bersifat annotation/non-validating by default. Kemampuan tool memvalidasi format bisa berbeda-beda.

Contoh:

```yaml
email:
  type: string
  format: email
```

Ini tidak boleh dianggap otomatis sama dengan:

```text
semua validator akan menolak string yang bukan email
```

Lebih tepat:

```text
Field ini adalah string dengan semantic email; validator/tool boleh menggunakan format tersebut untuk validasi, code generation, dokumentasi, atau UI hint, tetapi perilaku konkret tergantung implementasi.
```

Format umum:

```yaml
id:
  type: string
  format: uuid

createdAt:
  type: string
  format: date-time

birthDate:
  type: string
  format: date

website:
  type: string
  format: uri
```

### 9.1 Java Mapping

| OpenAPI | Java umum | Catatan |
|---|---|---|
| `string` + `format: uuid` | `UUID` | Pastikan serializer konsisten lowercase/uppercase. |
| `string` + `format: date` | `LocalDate` | Tidak punya timezone. |
| `string` + `format: date-time` | `OffsetDateTime`, `Instant`, `ZonedDateTime` | Pilih semantics jelas. |
| `integer` + `format: int32` | `Integer` / `int` | Primitive tidak bisa null. |
| `integer` + `format: int64` | `Long` / `long` | Hati-hati JavaScript precision. |
| `number` + `format: double` | `Double` | Tidak cocok untuk uang presisi. |
| `string` + `format: binary` | file/byte stream | OAS 3.1+ punya pendekatan binary berbeda. |

### 9.2 `date-time`: Jangan Mengabaikan Timezone

Buruk:

```yaml
createdAt:
  type: string
  format: date-time
  description: Created time.
```

Lebih baik:

```yaml
createdAt:
  type: string
  format: date-time
  description: >
    Timestamp when the case was created. Serialized as RFC 3339 date-time with offset.
    Consumers must not assume local timezone.
  examples:
    - '2026-06-20T09:15:30Z'
```

Dalam Java, pilih secara sadar:

- `Instant` untuk point-in-time global.
- `OffsetDateTime` untuk timestamp dengan offset.
- `LocalDateTime` jarang cocok untuk API boundary karena tidak membawa timezone/offset.
- `ZonedDateTime` membawa zone ID, tetapi wire format dan interoperability perlu dikontrol.

---

## 10. Numeric Constraints

Keyword penting:

| Keyword | Fungsi |
|---|---|
| `minimum` | batas bawah inklusif |
| `maximum` | batas atas inklusif |
| `exclusiveMinimum` | batas bawah eksklusif |
| `exclusiveMaximum` | batas atas eksklusif |
| `multipleOf` | kelipatan tertentu |

Contoh:

```yaml
pageSize:
  type: integer
  minimum: 1
  maximum: 200
  default: 50
  description: Maximum number of records to return.
```

Contoh amount:

```yaml
riskScore:
  type: number
  minimum: 0
  maximum: 1
  description: Normalized risk score between 0 and 1 inclusive.
```

Contoh persentase:

```yaml
confidencePercentage:
  type: number
  minimum: 0
  maximum: 100
  multipleOf: 0.01
```

### 10.1 Constraint Tightening Bisa Breaking

Misalnya versi awal:

```yaml
pageSize:
  type: integer
  minimum: 1
  maximum: 1000
```

Lalu diubah menjadi:

```yaml
pageSize:
  type: integer
  minimum: 1
  maximum: 100
```

Ini breaking untuk consumer yang selama ini mengirim `pageSize=500`.

Constraint bukan dekorasi. Constraint adalah contract.

---

## 11. Array Constraints

Keyword penting:

| Keyword | Fungsi |
|---|---|
| `items` | schema item |
| `minItems` | jumlah minimum |
| `maxItems` | jumlah maksimum |
| `uniqueItems` | item harus unik |
| `prefixItems` | tuple-like array di JSON Schema |

Contoh sederhana:

```yaml
tags:
  type: array
  minItems: 0
  maxItems: 20
  uniqueItems: true
  items:
    type: string
    minLength: 1
    maxLength: 50
```

Pertanyaan desain:

- Apakah urutan penting?
- Apakah duplikasi boleh?
- Apakah array kosong beda arti dari missing?
- Apakah `null` item boleh?
- Apakah semua item harus tipe sama?
- Berapa batas maksimum realistis?

### 11.1 Missing vs Empty Array vs Null

```json
{}
```

```json
{"tags": []}
```

```json
{"tags": null}
```

Ketiganya bisa berarti berbeda.

Untuk response, biasanya lebih baik konsisten:

```text
Kalau collection diketahui kosong, return [] bukan null.
```

Schema:

```yaml
tags:
  type: array
  items:
    type: string
```

Kalau field wajib ada di response:

```yaml
CaseDetail:
  type: object
  required:
    - tags
  properties:
    tags:
      type: array
      items:
        type: string
```

---

## 12. Object Constraints

Keyword penting:

| Keyword | Fungsi |
|---|---|
| `properties` | daftar field yang dikenal |
| `required` | property yang wajib hadir |
| `additionalProperties` | property tambahan selain yang didefinisikan |
| `patternProperties` | dynamic property names berbasis regex |
| `propertyNames` | constraint atas nama property |
| `minProperties` | jumlah property minimum |
| `maxProperties` | jumlah property maksimum |

Contoh:

```yaml
CaseCreateRequest:
  type: object
  required:
    - subjectId
    - complaintSummary
  properties:
    subjectId:
      type: string
      format: uuid
    complaintSummary:
      type: string
      minLength: 20
      maxLength: 5000
  additionalProperties: false
```

### 12.1 `additionalProperties`: Keputusan Evolvability

`additionalProperties: false` berarti consumer tidak boleh mengirim field yang tidak dikenal.

Kelebihan:

- kontrak input ketat,
- typo cepat ketahuan,
- attack surface lebih kecil,
- validasi lebih deterministik.

Kekurangan:

- lebih sulit menerima extension,
- consumer yang mengirim field ekstra akan gagal,
- perlu strategy kalau ingin forward-compatible.

Untuk request command, sering bagus:

```yaml
additionalProperties: false
```

Untuk response, terlalu ketat bisa menyulitkan client codegen tertentu, tetapi sebagai schema contract tetap berguna. Namun consumer sebaiknya tetap didesain toleran terhadap field tambahan, terutama jika API menggunakan additive evolution.

Rule praktis:

```text
Provider boleh menjanjikan shape response.
Consumer sebaiknya tidak crash ketika melihat unknown response fields.
Request validation boleh lebih ketat daripada response consumption.
```

---

## 13. Map / Dictionary Modelling

Object tidak selalu fixed properties. Kadang kita butuh map.

Contoh string-to-string map:

```yaml
metadata:
  type: object
  additionalProperties:
    type: string
```

Contoh map ke object:

```yaml
validationErrors:
  type: object
  additionalProperties:
    type: array
    items:
      type: string
```

JSON:

```json
{
  "validationErrors": {
    "subjectId": ["must be a valid UUID"],
    "complaintSummary": ["must not be blank", "must be at least 20 characters"]
  }
}
```

### 13.1 Jangan Menjadikan Map Sebagai Pelarian dari Design

Buruk:

```yaml
data:
  type: object
  additionalProperties: true
```

Ini sering berarti:

```text
Kami belum tahu contract-nya apa.
```

Map cocok untuk:

- metadata terbatas,
- localization dictionary,
- validation error by field,
- dynamic labels,
- extension points yang disengaja.

Map buruk untuk:

- mengganti domain model,
- menyembunyikan variasi response,
- menghindari breaking change discussion,
- dumping arbitrary data.

---

## 14. Enum Design

Enum tampak sederhana:

```yaml
CaseStatus:
  type: string
  enum:
    - RECEIVED
    - UNDER_REVIEW
    - CLOSED
```

Namun enum adalah salah satu sumber compatibility bugs paling sering.

### 14.1 Menambah Enum Value Bisa Breaking

Banyak orang menganggap:

```text
menambah enum value selalu backward compatible
```

Tidak selalu.

Untuk server response, jika client generated code memakai enum closed set, value baru bisa menyebabkan deserialization error.

Contoh Java generated client:

```java
public enum CaseStatus {
    RECEIVED,
    UNDER_REVIEW,
    CLOSED
}
```

Kalau server mengirim:

```json
{"status": "ESCALATED"}
```

Client lama bisa gagal.

Solusi:

1. Buat client tolerant terhadap unknown enum.
2. Gunakan string + documented known values untuk domain yang volatile.
3. Tambahkan `UNKNOWN` fallback di generated models jika tool mendukung.
4. Jangan memakai enum untuk business configuration yang sering berubah.
5. Gunakan deprecation dan compatibility policy.

### 14.2 Enum yang Stabil vs Volatile

Cocok jadi enum:

- fixed protocol values,
- stable lifecycle state,
- finite domain yang governance-nya kuat,
- value yang jarang berubah dan perubahan dianggap contract event.

Kurang cocok jadi enum:

- daftar reason code yang sering ditambah oleh business,
- product category dinamis,
- organizational unit,
- configurable workflow reason,
- taxonomy eksternal yang berubah sering.

### 14.3 Annotated Enum Pattern

OpenAPI Specification v3.2 membahas bahwa `enum` tidak bisa memberi deskripsi per nilai secara langsung. Salah satu pattern adalah memakai `oneOf`/`anyOf` dengan `const` dan annotation seperti `title`/`description`.

Contoh:

```yaml
DecisionOutcome:
  oneOf:
    - const: NO_BREACH
      title: No Breach
      description: Investigation concluded no regulatory breach occurred.
    - const: WARNING
      title: Warning
      description: A formal warning is issued.
    - const: PENALTY
      title: Penalty
      description: Monetary or non-monetary penalty is imposed.
```

Kelebihan:

- bisa memberi deskripsi per value,
- bagus untuk docs,
- lebih ekspresif.

Kekurangan:

- tidak semua generator memperlakukannya sebagai enum biasa,
- behavior tool bisa berbeda.

Gunakan ketika nilai enum butuh penjelasan formal.

---

## 15. `const`: Nilai Tunggal yang Berguna untuk Discriminator dan Tagged Union

`const` berarti instance harus sama dengan nilai tertentu.

Contoh:

```yaml
ManualAssignmentAction:
  type: object
  required:
    - actionType
    - officerId
  properties:
    actionType:
      const: MANUAL_ASSIGNMENT
    officerId:
      type: string
      format: uuid
```

Ini berguna untuk tagged union:

```yaml
CaseAction:
  oneOf:
    - $ref: '#/components/schemas/ManualAssignmentAction'
    - $ref: '#/components/schemas/EscalationAction'
    - $ref: '#/components/schemas/ClosureAction'
```

Part 010 akan membahas composition/polymorphism lebih dalam. Untuk sekarang, pahami bahwa `const` sering lebih presisi daripada enum satu item.

---

## 16. Defaults: Bukan Selalu Server Behavior

Contoh:

```yaml
pageSize:
  type: integer
  default: 50
```

`default` sering disalahpahami sebagai:

```text
server pasti mengisi 50 kalau client tidak kirim
```

Dalam JSON Schema, `default` adalah annotation. Tool tertentu bisa memakainya untuk docs, generated clients, forms, atau examples. Tetapi server behavior harus tetap dijelaskan.

Lebih baik:

```yaml
pageSize:
  type: integer
  minimum: 1
  maximum: 200
  default: 50
  description: >
    Maximum number of records to return. If omitted, the server uses 50.
```

Untuk behavior penting, jangan hanya mengandalkan `default`.

---

## 17. Examples vs Default

Contoh:

```yaml
status:
  type: string
  enum:
    - RECEIVED
    - UNDER_REVIEW
    - CLOSED
  examples:
    - UNDER_REVIEW
```

`examples` menunjukkan sample nilai.

`default` menunjukkan nilai yang diasumsikan/dipakai ketika tidak diberikan, tergantung konteks dan tooling.

Jangan pakai default sebagai example.

Buruk:

```yaml
status:
  type: string
  default: UNDER_REVIEW
```

Kalau sebenarnya tidak ada default behavior.

Lebih baik:

```yaml
status:
  type: string
  enum:
    - RECEIVED
    - UNDER_REVIEW
    - CLOSED
  examples:
    - UNDER_REVIEW
```

---

## 18. `readOnly` and `writeOnly`

`readOnly` dan `writeOnly` adalah annotation yang sangat penting untuk request/response boundary.

Contoh:

```yaml
User:
  type: object
  required:
    - id
    - username
  properties:
    id:
      type: string
      format: uuid
      readOnly: true
    username:
      type: string
      minLength: 3
      maxLength: 64
    password:
      type: string
      format: password
      writeOnly: true
```

Interpretasi:

- `id` muncul di response, tidak boleh dikirim sebagai input oleh client.
- `password` boleh dikirim request, tidak muncul di response.

### 18.1 Required + readOnly/writeOnly

Ini tricky.

Kalau schema yang sama dipakai untuk request dan response:

```yaml
User:
  type: object
  required:
    - id
    - username
    - password
  properties:
    id:
      type: string
      format: uuid
      readOnly: true
    username:
      type: string
    password:
      type: string
      writeOnly: true
```

`id` required untuk response, tetapi read-only untuk request. `password` required untuk request, tetapi write-only untuk response.

Beberapa tools bisa memahami ini. Namun dalam sistem serius, sering lebih jelas memisahkan:

```yaml
CreateUserRequest:
  type: object
  required:
    - username
    - password
  properties:
    username:
      type: string
    password:
      type: string
      format: password
      writeOnly: true

UserResponse:
  type: object
  required:
    - id
    - username
  properties:
    id:
      type: string
      format: uuid
      readOnly: true
    username:
      type: string
```

Rule praktis:

```text
readOnly/writeOnly membantu, tetapi jangan jadikan alasan untuk reuse schema request/response secara berlebihan.
```

---

## 19. Deprecated Fields

Field bisa ditandai deprecated:

```yaml
legacyStatus:
  type: string
  deprecated: true
  description: Deprecated. Use `status` instead.
```

Namun ini belum cukup.

Deprecation yang baik perlu:

- replacement field,
- timeline,
- migration instruction,
- apakah masih populated,
- apakah akan dihapus,
- version atau date target,
- compatibility expectation.

Lebih baik:

```yaml
legacyStatus:
  type: string
  deprecated: true
  description: >
    Deprecated since 2026-06-01. Use `status` instead.
    This field will continue to be populated until at least 2027-06-01.
```

Jangan deprecate diam-diam tanpa komunikasi.

---

## 20. Additional Semantic Annotations

Schema bisa punya:

```yaml
description:
title:
examples:
deprecated:
readOnly:
writeOnly:
externalDocs:
```

Jangan anggap annotation sebagai kosmetik. Annotation membantu:

- documentation,
- review,
- SDK generation,
- portal UX,
- consumer understanding,
- governance scanning,
- compliance evidence.

Contoh buruk:

```yaml
status:
  type: string
```

Contoh baik:

```yaml
status:
  $ref: '#/components/schemas/CaseStatus'

CaseStatus:
  type: string
  description: >
    Current externally visible lifecycle status of the case.
    This status is intended for consumer workflow decisions and may lag behind internal workflow states.
  enum:
    - RECEIVED
    - TRIAGE_IN_PROGRESS
    - UNDER_INVESTIGATION
    - DECISION_PENDING
    - CLOSED
```

---

## 21. Validation Boundary: Schema Validation vs Business Validation

OpenAPI schema bagus untuk structural validation:

- type benar,
- field wajib ada,
- panjang string,
- numeric range,
- array size,
- allowed enum,
- object shape.

Namun banyak rule tidak cocok atau tidak cukup hanya di schema:

- user boleh akses case ini atau tidak,
- transition status valid atau tidak,
- officer punya role tertentu atau tidak,
- due date harus setelah received date berdasarkan calendar bisnis,
- penalty harus sesuai regulation schedule,
- evidence tidak boleh dihapus jika decision sudah final,
- appeal hanya boleh diajukan dalam window tertentu.

Jangan memaksa semua business rule ke JSON Schema.

Gunakan layered validation:

```text
1. Transport parsing
2. Schema validation
3. Semantic validation
4. Authorization validation
5. Business invariant validation
6. Persistence/integration constraint handling
```

Contoh:

```yaml
EscalateCaseRequest:
  type: object
  required:
    - reasonCode
    - targetUnit
  properties:
    reasonCode:
      type: string
      minLength: 1
    targetUnit:
      type: string
      minLength: 1
```

Schema bisa memastikan shape. Tapi apakah `targetUnit` valid untuk case itu? Itu business validation.

---

## 22. Java Bean Validation Mapping

OpenAPI constraints sering dipetakan ke Bean Validation.

| OpenAPI Schema | Bean Validation umum |
|---|---|
| `required` | `@NotNull` pada property/request model, tetapi hati-hati missing vs null |
| `minLength` | `@Size(min=...)` |
| `maxLength` | `@Size(max=...)` |
| `minimum` | `@Min` / `@DecimalMin` |
| `maximum` | `@Max` / `@DecimalMax` |
| `pattern` | `@Pattern` |
| `format: email` | `@Email` |
| `minItems/maxItems` | `@Size` pada collection |

Tapi mapping tidak selalu 1:1.

### 22.1 `required` vs `@NotNull`

OpenAPI `required` bicara property presence.

Java setelah deserialization biasanya hanya melihat object field value.

Jika JSON tidak punya field:

```json
{}
```

Dan jika JSON punya null:

```json
{"name": null}
```

Keduanya bisa menjadi:

```java
name == null
```

Jadi kalau perlu membedakan missing vs null, Bean Validation saja tidak cukup.

### 22.2 Primitive vs Boxed Type

```java
private int pageSize;
```

Jika client tidak mengirim `pageSize`, Java bisa default ke `0`.

Ini berbahaya kalau contract membedakan missing dari `0`.

Lebih aman untuk request DTO:

```java
private Integer pageSize;
```

Lalu validasi:

```java
@Min(1)
@Max(200)
private Integer pageSize;
```

Gunakan primitive hanya jika benar-benar tidak nullable dan default behavior jelas.

### 22.3 `Optional` Field di DTO

Banyak Java engineer tergoda:

```java
private Optional<String> middleName;
```

Ini sering tidak ideal untuk DTO/Jackson/Bean Validation. `Optional` lebih cocok sebagai return type method, bukan field model. Untuk DTO, lebih baik gunakan field nullable dengan explicit semantics, atau wrapper khusus jika perlu missing/null/value distinction.

---

## 23. Jackson Semantics yang Mempengaruhi Contract

Jackson configuration bisa membuat implementation tidak sesuai schema.

Contoh:

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
```

Efek:

- field null tidak dikirim di response,
- consumer tidak bisa membedakan null vs missing,
- schema yang mengatakan field required mungkin dilanggar.

Contoh:

```yaml
CaseDetail:
  type: object
  required:
    - assignedOfficer
  properties:
    assignedOfficer:
      type:
        - string
        - 'null'
```

Schema berkata field wajib hadir, tapi boleh null.

Response valid:

```json
{"assignedOfficer": null}
```

Kalau Jackson menghilangkan null:

```json
{}
```

maka response tidak sesuai schema.

Rule:

```text
Serialization config adalah bagian dari contract behavior.
Jangan desain schema tanpa memeriksa bagaimana runtime benar-benar serialize/deserialize.
```

---

## 24. Schema for Request vs Schema for Response

Salah satu skill penting: tahu kapan harus memisahkan schema.

Buruk:

```yaml
Case:
  type: object
  properties:
    id:
      type: string
      format: uuid
    summary:
      type: string
    status:
      type: string
    createdAt:
      type: string
      format: date-time
```

Dipakai untuk:

- create request,
- update request,
- detail response,
- list response.

Ini hampir selalu terlalu kasar.

Lebih baik:

```yaml
CreateCaseRequest:
  type: object
  required:
    - summary
  properties:
    summary:
      type: string
      minLength: 20
      maxLength: 5000

UpdateCaseSummaryRequest:
  type: object
  required:
    - summary
  properties:
    summary:
      type: string
      minLength: 20
      maxLength: 5000

CaseSummary:
  type: object
  required:
    - caseId
    - status
    - summary
  properties:
    caseId:
      type: string
      format: uuid
      readOnly: true
    status:
      $ref: '#/components/schemas/CaseStatus'
    summary:
      type: string

CaseDetail:
  allOf:
    - $ref: '#/components/schemas/CaseSummary'
    - type: object
      required:
        - createdAt
        - auditVersion
      properties:
        createdAt:
          type: string
          format: date-time
          readOnly: true
        auditVersion:
          type: integer
          minimum: 1
          readOnly: true
```

Tetapi hati-hati: `allOf` punya nuance dan akan dibahas di part 010. Jangan memakai composition hanya untuk terlihat DRY.

---

## 25. Schema Naming Strategy

Nama schema adalah bagian dari contract comprehension.

Nama buruk:

```yaml
CaseDto
CaseEntity
CaseModel
CaseResponseDto
CommonResponseOfCase
```

Nama lebih baik:

```yaml
CreateCaseRequest
CaseSummary
CaseDetail
CaseStatus
CaseDecisionRequest
CaseDecisionResult
ValidationProblem
```

Gunakan nama berdasarkan role di API, bukan class internal.

Pattern:

```text
<Verb><Resource>Request
<Resource>Summary
<Resource>Detail
<Resource>Status
<Resource>Result
<Resource>Problem
<Resource>EventPayload
```

Contoh:

```yaml
AssignCaseRequest
CaseAssignmentResult
CaseAssignmentConflictProblem
```

Ini langsung menjelaskan konteks pemakaian.

---

## 26. `additionalProperties: false` dan Consumer Tolerance

Untuk request input:

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
```

Ini sangat berguna untuk mencegah typo:

```json
{
  "complaintSumary": "typo field"
}
```

Tanpa strict validation, server mungkin mengabaikan typo dan membuat case dengan summary kosong atau gagal di tahap lebih jauh.

Untuk response, provider bisa mendefinisikan schema ketat, tetapi consumer tetap sebaiknya toleran terhadap field baru.

Ini prinsip Postel yang perlu dipakai dengan hati-hati:

```text
Be strict in what you send.
Be tolerant in what you receive.
```

Namun jangan jadikan ini alasan untuk provider mengirim bentuk liar. Provider tetap harus menjaga contract.

---

## 27. Unknown Fields and Forward Compatibility

Dalam Java/Jackson generated client, konfigurasi ini penting:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
```

Kelebihan:

- client tidak crash saat response mendapat additive fields.

Risiko:

- typo atau unexpected field bisa terabaikan dalam testing.

Strategy:

- Untuk production client, ignore unknown response fields sering baik.
- Untuk provider tests, response harus divalidasi terhadap schema.
- Untuk request validation, unknown fields bisa ditolak.
- Untuk contract tests, pastikan additive response field policy jelas.

---

## 28. Binary Data in Schema

Di OAS 3.0, binary sering dimodelkan:

```yaml
file:
  type: string
  format: binary
```

Di OAS 3.1+ / 3.2, karena lebih dekat JSON Schema, ada pendekatan menggunakan `contentMediaType` dan `contentEncoding` untuk beberapa kasus.

Namun secara praktis, tooling masih bervariasi. Untuk file upload/download, jangan hanya fokus ke schema. Perhatikan:

- media type,
- request body content,
- multipart encoding,
- filename metadata,
- content length,
- checksum,
- virus scan state,
- authorization,
- retention,
- download URL expiry,
- audit trail.

Contoh multipart sederhana:

```yaml
EvidenceUploadRequest:
  type: object
  required:
    - file
    - evidenceType
  properties:
    file:
      type: string
      format: binary
    evidenceType:
      type: string
      enum:
        - DOCUMENT
        - IMAGE
        - AUDIO
        - VIDEO
```

Tetapi untuk regulated system, schema saja belum cukup. Tambahkan metadata operation-level dan response state.

---

## 29. Schema Dialects

OpenAPI 3.1+ memperkenalkan hubungan lebih formal dengan JSON Schema dialect. OpenAPI v3.2 menyebut bahwa tooling harus bisa menentukan dialect/meta-schema, dan `jsonSchemaDialect` bisa dipakai pada OpenAPI Object untuk default dialect.

Untuk kebanyakan engineer, aturan praktisnya:

```text
Kalau memakai OAS 3.1/3.2, pahami bahwa schema mengikuti JSON Schema Draft 2020-12 style.
Kalau memakai OAS 3.0, jangan menyalin fitur JSON Schema modern secara sembarangan.
```

Contoh fitur yang perlu dicek tooling support:

- `type: ['string', 'null']`
- `const`
- `unevaluatedProperties`
- `$dynamicRef`
- `$schema`
- `contentMediaType`
- `contentEncoding`

Jangan hanya valid di spec; pastikan valid di toolchain organisasi.

---

## 30. Schema Constraints and Breaking Change Taxonomy

Perubahan schema bisa aman atau breaking tergantung arah data.

### 30.1 Request Schema

Jika server menerima request dari client:

| Change | Biasanya |
|---|---|
| menambah optional request field | backward compatible |
| menambah required request field | breaking |
| memperketat `maxLength` | breaking |
| menaikkan `minLength` | breaking |
| menghapus enum value yang diterima | breaking |
| menambah enum value yang diterima | biasanya compatible |
| membuat nullable menjadi non-nullable | breaking |
| membuat non-nullable menjadi nullable | bisa compatible, tapi cek semantics |
| menolak additionalProperties yang sebelumnya diterima | breaking |

### 30.2 Response Schema

Jika server mengirim response ke client:

| Change | Biasanya |
|---|---|
| menambah optional response field | sering compatible jika client tolerant |
| menghapus response field | breaking |
| mengubah required menjadi optional | bisa breaking untuk client yang mengandalkan field |
| mengubah type field | breaking |
| menambah enum value di response | bisa breaking untuk generated clients |
| membuat field non-nullable menjadi nullable | breaking untuk client yang tidak siap null |
| membuat nullable menjadi non-nullable | biasanya compatible, tapi cek semantics |
| memperluas constraints response | mungkin compatible |
| mempersempit constraints response | tergantung consumer assumption |

Part 015 akan membahas breaking change secara jauh lebih dalam. Untuk sekarang, pegang prinsip:

```text
Schema constraint adalah compatibility surface.
Setiap perubahan constraint harus direview sebagai perubahan contract.
```

---

## 31. Case Study: Designing Schema for Enforcement Case API

Kita desain beberapa schema untuk sistem enforcement lifecycle.

### 31.1 Requirements

Kebutuhan:

- Case dibuat dari complaint.
- Case punya public ID.
- Case punya lifecycle status.
- Case summary bisa dilihat di list.
- Case detail memuat metadata tambahan.
- Internal workflow state tidak boleh bocor.
- Response harus stabil untuk consumer.
- Timestamp harus jelas.
- Schema harus mendukung auditability.

### 31.2 Bad Schema

```yaml
CaseEntity:
  type: object
  properties:
    id:
      type: integer
      format: int64
    uuid:
      type: string
    status:
      type: string
    workflowState:
      type: string
    description:
      type: string
    assignedUser:
      type: string
    createdAt:
      type: string
    updatedAt:
      type: string
    version:
      type: integer
```

Masalah:

- nama entity,
- dua ID tanpa semantics,
- status tidak dibatasi,
- workflow internal bocor,
- timestamp tanpa format,
- no required,
- no readOnly,
- no constraint,
- assigned user mungkin PII/internal,
- version tidak jelas.

### 31.3 Better Schema

```yaml
CaseStatus:
  type: string
  description: Externally visible lifecycle status of an enforcement case.
  enum:
    - RECEIVED
    - TRIAGE_IN_PROGRESS
    - UNDER_INVESTIGATION
    - DECISION_PENDING
    - CLOSED

CaseSummary:
  type: object
  additionalProperties: false
  required:
    - caseId
    - status
    - summary
    - receivedAt
  properties:
    caseId:
      type: string
      format: uuid
      readOnly: true
      description: Stable public identifier for the case.
    status:
      $ref: '#/components/schemas/CaseStatus'
    summary:
      type: string
      minLength: 1
      maxLength: 500
      description: Short externally visible summary of the case.
    receivedAt:
      type: string
      format: date-time
      readOnly: true
      description: RFC 3339 timestamp when the case was received by the system.

CaseDetail:
  type: object
  additionalProperties: false
  required:
    - caseId
    - status
    - summary
    - receivedAt
    - lastUpdatedAt
    - auditVersion
  properties:
    caseId:
      type: string
      format: uuid
      readOnly: true
    status:
      $ref: '#/components/schemas/CaseStatus'
    summary:
      type: string
      minLength: 1
      maxLength: 500
    receivedAt:
      type: string
      format: date-time
      readOnly: true
    lastUpdatedAt:
      type: string
      format: date-time
      readOnly: true
    auditVersion:
      type: integer
      minimum: 1
      readOnly: true
      description: Monotonic version used for optimistic concurrency and audit traceability.
```

### 31.4 Even Better: Separate Command Request

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required:
    - complaintSummary
    - complainantReference
  properties:
    complaintSummary:
      type: string
      minLength: 20
      maxLength: 5000
      description: Human-readable complaint summary provided at intake.
    complainantReference:
      type: string
      minLength: 1
      maxLength: 128
      description: External reference for the complainant or intake channel.
```

Response:

```yaml
CreateCaseResponse:
  type: object
  additionalProperties: false
  required:
    - caseId
    - status
    - receivedAt
  properties:
    caseId:
      type: string
      format: uuid
      readOnly: true
    status:
      $ref: '#/components/schemas/CaseStatus'
    receivedAt:
      type: string
      format: date-time
      readOnly: true
```

Design reasoning:

- Create request tidak menerima `status`.
- Client tidak boleh menentukan `caseId`.
- Response memberi stable identifier.
- Internal workflow tidak bocor.
- Schema constraint cukup untuk input boundary.
- Business rule tetap di application layer.

---

## 32. Schema Smells

Gunakan daftar ini untuk review.

### 32.1 Weak Schema Smells

```text
- Banyak field hanya type: string tanpa constraint.
- Tidak ada required sama sekali.
- Semua schema bernama *Dto atau *Entity.
- Request dan response memakai schema yang sama untuk semua operation.
- Banyak additionalProperties: true tanpa alasan.
- Enum dipakai untuk data volatile.
- Format timestamp tidak dijelaskan.
- Nullability tidak konsisten.
- Tidak jelas bedanya missing vs null.
- readOnly/writeOnly tidak digunakan.
- Error schemas terlalu generic.
- Examples tidak valid terhadap schema.
```

### 32.2 Over-Specified Schema Smells

```text
- Regex terlalu kompleks untuk business rule.
- additionalProperties: false dipakai tanpa compatibility strategy.
- Semua field dipaksa required di semua context.
- Constraint internal bocor sebagai public contract.
- Enum terlalu closed untuk value yang sering berubah.
- Schema menjadi mirror database constraints.
- Composition dipakai untuk meniru inheritance Java.
```

Schema yang baik bukan yang paling ketat. Schema yang baik adalah yang **tepat**.

---

## 33. Practical Review Checklist

Saat mereview schema, tanyakan:

```text
1. Apakah schema ini request, response, event payload, atau shared value object?
2. Apakah nama schema menjelaskan role-nya?
3. Apakah required field benar-benar wajib di context itu?
4. Apakah nullability disengaja?
5. Apakah missing vs null punya arti berbeda?
6. Apakah constraints cukup untuk mencegah invalid input umum?
7. Apakah constraints terlalu ketat sehingga mengunci evolusi?
8. Apakah timestamp punya timezone/precision semantics?
9. Apakah numeric field aman lintas bahasa?
10. Apakah enum stabil?
11. Apakah unknown enum value bisa merusak generated clients?
12. Apakah additionalProperties policy jelas?
13. Apakah readOnly/writeOnly benar?
14. Apakah schema membocorkan entity/internal state?
15. Apakah generated Java type masuk akal?
16. Apakah examples valid?
17. Apakah perubahan schema ini breaking?
18. Apakah validation runtime sesuai schema?
```

---

## 34. Java Implementation Checklist

Untuk Spring/Java implementation:

```text
1. Jangan expose JPA entity sebagai OpenAPI schema.
2. Pisahkan API DTO dari domain model jika boundary penting.
3. Gunakan boxed type untuk request fields yang optional.
4. Jangan pakai primitive jika missing/null semantics penting.
5. Hindari Optional sebagai DTO field kecuali toolchain benar-benar mendukung.
6. Pastikan Jackson null inclusion sesuai schema required/nullability.
7. Gunakan Bean Validation untuk structural constraints.
8. Jangan mengandalkan Bean Validation untuk business invariants.
9. Test serialized response terhadap schema.
10. Test invalid request terhadap schema + validation behavior.
11. Pastikan date/time type konsisten dengan contract.
12. Pastikan enum unknown behavior dipahami.
13. Jangan biarkan generated code menentukan domain architecture.
```

---

## 35. Exercises

### Exercise 1 — Required vs Nullable

Jelaskan perbedaan tiga schema berikut.

```yaml
A:
  type: object
  required:
    - name
  properties:
    name:
      type: string
```

```yaml
B:
  type: object
  required:
    - name
  properties:
    name:
      type:
        - string
        - 'null'
```

```yaml
C:
  type: object
  properties:
    name:
      type:
        - string
        - 'null'
```

Expected reasoning:

```text
A: name wajib hadir dan harus string.
B: name wajib hadir, boleh string atau null.
C: name boleh tidak hadir; jika hadir, boleh string atau null.
```

### Exercise 2 — Improve Weak Schema

Perbaiki schema ini:

```yaml
User:
  type: object
  properties:
    id:
      type: string
    email:
      type: string
    age:
      type: integer
    password:
      type: string
```

Target improvement:

- `id` UUID read-only,
- email format,
- age range,
- password write-only,
- required fields jelas,
- request/response dipisahkan jika perlu.

### Exercise 3 — Enum Compatibility

Diberikan enum:

```yaml
PaymentStatus:
  type: string
  enum:
    - PENDING
    - PAID
    - FAILED
```

Pertanyaan:

1. Apakah menambah `REFUNDED` breaking?
2. Untuk request?
3. Untuk response?
4. Untuk generated Java client?
5. Strategy mitigasinya apa?

### Exercise 4 — Missing vs Null PATCH

Desain schema untuk request update profile di mana:

- missing field = tidak berubah,
- null = hapus nilai,
- value = set nilai baru.

Jelaskan konsekuensi Java DTO-nya.

---

## 36. Summary

Schema Object adalah pusat contract data di OpenAPI.

Hal paling penting dari part ini:

```text
Schema bukan DTO.
Schema adalah constraint contract.
```

Poin inti:

1. `type` mendefinisikan data model, tetapi tidak cukup sendirian.
2. `required` berarti property wajib hadir, bukan otomatis non-null dalam semua konteks.
3. Missing, null, dan value adalah tiga keadaan berbeda.
4. OAS 3.1/3.2 memakai JSON Schema style untuk nullable via union with `null`.
5. `format` adalah annotation dan tidak selalu divalidasi semua tools.
6. Constraint seperti min/max/enum/pattern adalah compatibility surface.
7. Enum evolution sering lebih berbahaya daripada kelihatannya.
8. `readOnly` dan `writeOnly` membantu boundary request/response.
9. Request schema dan response schema sering harus dipisahkan.
10. Java DTO, Jackson, Bean Validation, dan generated code harus disejajarkan dengan contract, bukan sebaliknya.

Kalau Part 008 mengajarkan cara mengelola reuse, Part 009 mengajarkan cara membuat setiap schema punya makna contract yang presisi.

Di Part 010, kita akan masuk ke topik yang lebih tajam: `allOf`, `oneOf`, `anyOf`, `not`, discriminator, polymorphism, dan perangkap meniru inheritance Java di OpenAPI.

---

## 37. References

- OpenAPI Specification v3.2.0 — Schema Object, Data Types, Format, Extended Validation, Data Modeling Techniques.
- JSON Schema Draft 2020-12 concepts as referenced by OpenAPI Specification.
- OpenAPI Initiative guidance on specification structure and schema modelling.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-008.md">⬅️ OpenAPI Mastery for Java Engineers — Part 008</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-010.md">OpenAPI Mastery for Java Engineers — Part 010 ➡️</a>
</div>
