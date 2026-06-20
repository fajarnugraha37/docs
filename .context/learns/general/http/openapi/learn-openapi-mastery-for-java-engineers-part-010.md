# OpenAPI Mastery for Java Engineers — Part 010

# JSON Schema Composition: `allOf`, `oneOf`, `anyOf`, `not`, Discriminators, and Polymorphism

> Filename: `learn-openapi-mastery-for-java-engineers-part-010.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `010 / 030`  
> Audience: Java software engineer, tech lead, backend/API/platform engineer  
> Focus: memahami schema composition sebagai logika kontrak, bukan sekadar inheritance mapping dari Java.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami `allOf`, `oneOf`, `anyOf`, dan `not` sebagai **logical composition**, bukan fitur inheritance.
2. Menentukan kapan memakai composition dan kapan justru menghindarinya.
3. Mendesain schema polymorphic yang valid, readable, compatible, dan aman untuk generated code.
4. Memahami keterbatasan `discriminator`: membantu deserialization/error messaging, tetapi tidak “memaksa” validasi menggantikan rules schema.
5. Menghindari jebakan umum Java engineer:
   - memakai `allOf` sebagai `extends`,
   - memakai `oneOf` tanpa membuat alternatif mutually exclusive,
   - memakai discriminator yang tidak sinkron dengan schema,
   - menjadikan OpenAPI schema sebagai mirror hierarchy Java.
6. Membaca dampak composition terhadap:
   - validation,
   - code generation,
   - SDK ergonomics,
   - backward compatibility,
   - schema evolution,
   - contract testing.

---

## 1. Kenapa Bagian Ini Penting

Schema composition adalah salah satu fitur OpenAPI yang terlihat sangat powerful, tetapi sering menjadi sumber kontrak ambigu.

Bagi Java engineer, godaan terbesarnya adalah membaca schema composition seperti membaca type system Java:

```java
class Animal {}
class Cat extends Animal {}
class Dog extends Animal {}
```

Lalu mencoba menulis OpenAPI seperti ini:

```yaml
Animal:
  type: object
  properties:
    id:
      type: string

Cat:
  allOf:
    - $ref: '#/components/schemas/Animal'
    - type: object
      properties:
        huntingSkill:
          type: string

Dog:
  allOf:
    - $ref: '#/components/schemas/Animal'
    - type: object
      properties:
        packSize:
          type: integer
```

Secara sekilas terlihat seperti inheritance. Tetapi secara schema semantics, `allOf` berarti:

> instance harus valid terhadap semua subschema.

Itu bukan “class extends”. Itu bukan “copy fields from parent”. Itu bukan “inheritance relationship”. Itu adalah **intersection of constraints**.

Perbedaan ini penting karena OpenAPI contract tidak hanya dibaca manusia. Ia dibaca oleh validator, generator, linter, mock server, test framework, API gateway, SDK generator, documentation renderer, dan governance tool. Kalau composition ambigu, semua tool itu bisa mengambil interpretasi berbeda.

Dalam sistem sederhana, dampaknya mungkin hanya dokumentasi aneh. Dalam sistem besar, dampaknya bisa berupa:

- generated client tidak bisa deserialize response,
- mobile app crash ketika server menambah subtype baru,
- partner tidak tahu field mana yang wajib,
- mock server menerima payload yang server sebenarnya tolak,
- validator menolak payload yang secara bisnis valid,
- breaking change tidak terdeteksi karena polymorphism terlalu longgar,
- governance pipeline menghasilkan false positive/false negative.

Top 1% engineer tidak hanya bisa menulis `oneOf`. Ia tahu **apa konsekuensi contract dari `oneOf`**.

---

## 2. Mental Model Utama: Composition Adalah Logic, Bukan Object-Oriented Inheritance

Sebelum masuk detail syntax, pegang mental model ini:

| Keyword | Mental Model | Valid Jika |
|---|---|---|
| `allOf` | AND / intersection | instance valid terhadap semua subschema |
| `anyOf` | OR / inclusive union | instance valid terhadap minimal satu subschema |
| `oneOf` | XOR / exclusive union | instance valid terhadap tepat satu subschema |
| `not` | negation | instance tidak valid terhadap subschema tertentu |

Contoh sederhana:

```yaml
schema:
  allOf:
    - type: object
      required: [id]
      properties:
        id:
          type: string
    - type: object
      required: [name]
      properties:
        name:
          type: string
```

Payload ini valid:

```json
{
  "id": "case-123",
  "name": "Investigation Case"
}
```

Karena memenuhi kedua subschema.

Payload ini tidak valid:

```json
{
  "id": "case-123"
}
```

Karena hanya memenuhi subschema pertama, tetapi tidak memenuhi subschema kedua yang membutuhkan `name`.

Sekarang `anyOf`:

```yaml
schema:
  anyOf:
    - required: [email]
    - required: [phone]
```

Payload valid:

```json
{ "email": "a@example.com" }
```

Payload juga valid:

```json
{ "phone": "+628123456" }
```

Payload ini juga valid:

```json
{
  "email": "a@example.com",
  "phone": "+628123456"
}
```

Karena `anyOf` berarti satu atau lebih.

Sekarang `oneOf`:

```yaml
schema:
  oneOf:
    - required: [email]
    - required: [phone]
```

Payload ini valid:

```json
{ "email": "a@example.com" }
```

Payload ini valid:

```json
{ "phone": "+628123456" }
```

Tetapi payload ini **tidak valid**:

```json
{
  "email": "a@example.com",
  "phone": "+628123456"
}
```

Karena payload tersebut memenuhi dua subschema sekaligus, bukan tepat satu.

Inilah sumber banyak bug: engineer memakai `oneOf` ketika sebenarnya maksudnya “salah satu bentuk yang mungkin”, tetapi tidak membuat bentuk-bentuk itu mutually exclusive.

---

## 3. Baseline Spec: OAS 3.1/3.2 dan JSON Schema

OpenAPI 3.1 membawa perubahan besar karena Schema Object makin selaras dengan JSON Schema 2020-12. OpenAPI 3.2 melanjutkan refinement tersebut. Dalam konteks composition, artinya kamu harus makin serius memahami JSON Schema semantics, bukan hanya Swagger-era modelling.

Beberapa hal penting:

1. `allOf`, `oneOf`, `anyOf`, dan `not` berasal dari JSON Schema applicator vocabulary.
2. Validator tidak berpikir seperti Java compiler.
3. Validator mengevaluasi instance JSON terhadap schema constraints.
4. `discriminator` di OpenAPI tidak mengganti hasil validasi `oneOf`/`anyOf`/`allOf`.
5. Tooling bisa berbeda tingkat dukungannya, terutama untuk fitur JSON Schema modern.

Prinsip praktis:

> Tulis schema composition yang tetap jelas jika dibaca sebagai JSON Schema murni, bukan hanya jelas bagi tool tertentu.

Kalau sebuah schema hanya “berfungsi” karena satu generator tertentu menginterpretasikannya seperti inheritance Java, schema itu rapuh.

---

## 4. `allOf`: Intersection of Constraints

### 4.1 Apa Itu `allOf`

`allOf` berarti instance harus valid terhadap semua subschema di dalam array.

```yaml
CaseSummary:
  allOf:
    - $ref: '#/components/schemas/IdentifiedResource'
    - type: object
      required:
        - title
        - status
      properties:
        title:
          type: string
        status:
          type: string
          enum: [OPEN, CLOSED]
```

Jika `IdentifiedResource` adalah:

```yaml
IdentifiedResource:
  type: object
  required:
    - id
  properties:
    id:
      type: string
```

Maka `CaseSummary` efektifnya membutuhkan:

- valid terhadap `IdentifiedResource`, dan
- valid terhadap object yang punya `title` dan `status`.

Payload valid:

```json
{
  "id": "case-001",
  "title": "Market manipulation inquiry",
  "status": "OPEN"
}
```

Payload tidak valid:

```json
{
  "title": "Market manipulation inquiry",
  "status": "OPEN"
}
```

Karena tidak memenuhi `IdentifiedResource` yang membutuhkan `id`.

---

### 4.2 `allOf` Bukan Inheritance

Walaupun banyak dokumentasi lama dan banyak generator memperlakukan `allOf` seperti inheritance, secara semantic `allOf` bukan inheritance.

`allOf` tidak berarti:

- child schema mewarisi parent schema,
- parent schema tahu semua child,
- validator membuat object hierarchy,
- generated code pasti memakai `extends`,
- field parent otomatis digabung secara aman.

`allOf` hanya berarti:

> data harus lulus semua constraints.

Contoh yang sering disalahpahami:

```yaml
BaseError:
  type: object
  required: [code, message]
  properties:
    code:
      type: string
    message:
      type: string

ValidationError:
  allOf:
    - $ref: '#/components/schemas/BaseError'
    - type: object
      required: [fieldErrors]
      properties:
        fieldErrors:
          type: array
          items:
            type: object
            required: [field, reason]
            properties:
              field:
                type: string
              reason:
                type: string
```

Ini masih cukup masuk akal sebagai composition constraint. Tetapi jangan langsung menyimpulkan bahwa di Java harus menjadi:

```java
class ValidationError extends BaseError {}
```

Bisa saja implementasi yang lebih sehat adalah:

```java
record ValidationErrorResponse(
    String code,
    String message,
    List<FieldErrorItem> fieldErrors
) {}
```

Atau mapping boundary:

```java
sealed interface ApiError permits ValidationErrorResponse, ConflictErrorResponse {}
```

Intinya: OpenAPI composition tidak wajib sama dengan Java inheritance.

---

### 4.3 Kapan `allOf` Tepat

Gunakan `allOf` ketika kamu memang ingin menyatakan **akumulasi constraints**.

Contoh use case yang baik:

#### A. Menambahkan metadata umum ke representation tertentu

```yaml
CaseDetail:
  allOf:
    - $ref: '#/components/schemas/ResourceIdentity'
    - $ref: '#/components/schemas/AuditMetadata'
    - type: object
      required:
        - caseNumber
        - status
      properties:
        caseNumber:
          type: string
        status:
          $ref: '#/components/schemas/CaseStatus'
```

Ini cukup bagus jika `ResourceIdentity` dan `AuditMetadata` memang vocabulary stabil dan tidak terlalu banyak dipakai secara sembarangan.

#### B. Menggabungkan schema constraint yang orthogonal

```yaml
ActiveCase:
  allOf:
    - $ref: '#/components/schemas/CaseBase'
    - type: object
      required: [status]
      properties:
        status:
          const: ACTIVE
```

Ini menyatakan bahwa `ActiveCase` adalah `CaseBase` dengan status harus `ACTIVE`.

#### C. Menyusun schema reusable yang stabil

```yaml
PaginatedCaseList:
  allOf:
    - $ref: '#/components/schemas/PaginationEnvelope'
    - type: object
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
```

Ini wajar, selama `PaginationEnvelope` memang generic dan stabil.

---

### 4.4 Kapan `allOf` Berbahaya

`allOf` mulai berbahaya ketika dipakai untuk mensimulasikan object-oriented inheritance hierarchy yang kompleks.

Contoh buruk:

```yaml
Animal:
  type: object
  properties:
    type:
      type: string

Mammal:
  allOf:
    - $ref: '#/components/schemas/Animal'
    - type: object
      properties:
        warmBlooded:
          type: boolean

Dog:
  allOf:
    - $ref: '#/components/schemas/Mammal'
    - type: object
      properties:
        barkVolume:
          type: integer
```

Masalahnya:

1. Schema hierarchy tidak otomatis menciptakan polymorphic base type.
2. Consumer belum tentu tahu kapan response `Animal` sebenarnya `Dog`.
3. Discriminator belum ada atau tidak jelas.
4. Generated code bisa sangat berbeda antar language.
5. Evolusi subtype menjadi sulit.
6. Validation bisa ambiguous kalau constraints tidak ketat.

Dalam API contract, hierarchy dalam domain model sering lebih baik diratakan menjadi explicit representation.

Misalnya:

```yaml
Animal:
  type: object
  required:
    - id
    - kind
    - displayName
  properties:
    id:
      type: string
    kind:
      type: string
      enum: [DOG, CAT, BIRD]
    displayName:
      type: string
```

Kalau subtype behavior benar-benar penting, baru pertimbangkan `oneOf` + discriminator.

---

### 4.5 Konflik Constraint dalam `allOf`

`allOf` bisa membuat schema yang mustahil dipenuhi.

Contoh:

```yaml
ImpossibleSchema:
  allOf:
    - type: object
      properties:
        status:
          type: string
          enum: [OPEN]
    - type: object
      properties:
        status:
          type: string
          enum: [CLOSED]
```

Payload tidak mungkin memiliki `status` yang sekaligus `OPEN` dan `CLOSED`.

Ini disebut schema unsatisfiable.

Masalah ini sering muncul saat:

- dua shared schema mendefinisikan field yang sama dengan constraint berbeda,
- base schema terlalu spesifik,
- subtype mencoba mengubah constraint parent secara tidak kompatibel,
- `additionalProperties: false` dipakai di tempat yang salah,
- `required` disebar tanpa review.

Contoh subtle:

```yaml
BaseCase:
  type: object
  required: [status]
  properties:
    status:
      type: string
      enum: [OPEN, CLOSED]

DraftCase:
  allOf:
    - $ref: '#/components/schemas/BaseCase'
    - type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [DRAFT]
```

`DraftCase` mustahil valid, karena `status` harus salah satu dari `[OPEN, CLOSED]` dan juga salah satu dari `[DRAFT]`.

Solusi:

```yaml
BaseCase:
  type: object
  required: [status]
  properties:
    status:
      type: string

DraftCase:
  allOf:
    - $ref: '#/components/schemas/BaseCase'
    - type: object
      properties:
        status:
          const: DRAFT
```

Atau definisikan enum global yang mencakup semua status:

```yaml
CaseStatus:
  type: string
  enum: [DRAFT, OPEN, CLOSED]
```

---

## 5. `anyOf`: Inclusive Union

### 5.1 Apa Itu `anyOf`

`anyOf` berarti instance valid jika memenuhi minimal satu subschema.

```yaml
ContactMethod:
  type: object
  anyOf:
    - required: [email]
    - required: [phone]
  properties:
    email:
      type: string
      format: email
    phone:
      type: string
```

Valid:

```json
{ "email": "case.officer@example.gov" }
```

Valid:

```json
{ "phone": "+628123456789" }
```

Valid juga:

```json
{
  "email": "case.officer@example.gov",
  "phone": "+628123456789"
}
```

Karena `anyOf` tidak menuntut eksklusivitas.

---

### 5.2 Kapan `anyOf` Tepat

Gunakan `anyOf` ketika lebih dari satu alternatif boleh benar pada saat yang sama.

Contoh baik:

#### A. Minimal salah satu identifier tersedia

```yaml
SubjectLookupRequest:
  type: object
  anyOf:
    - required: [nationalId]
    - required: [passportNumber]
    - required: [companyRegistrationNumber]
  properties:
    nationalId:
      type: string
    passportNumber:
      type: string
    companyRegistrationNumber:
      type: string
```

Dalam pencarian, mungkin user mengirim lebih dari satu identifier untuk mempersempit hasil. Maka `anyOf` lebih tepat daripada `oneOf`.

#### B. Resource dapat memenuhi beberapa classification

```yaml
EvidenceItem:
  type: object
  anyOf:
    - required: [documentMetadata]
    - required: [imageMetadata]
    - required: [externalReference]
```

Satu evidence bisa berupa document dan sekaligus punya external reference.

---

### 5.3 Risiko `anyOf`

`anyOf` bisa terlalu longgar.

Contoh:

```yaml
SearchRequest:
  anyOf:
    - type: object
      properties:
        query:
          type: string
    - type: object
      properties:
        filters:
          type: object
```

Masalah: payload `{}` bisa valid jika subschema tidak punya `required`. Karena object kosong tetap valid terhadap object schema yang hanya mendeklarasikan properties opsional.

Lebih baik:

```yaml
SearchRequest:
  type: object
  anyOf:
    - required: [query]
    - required: [filters]
  properties:
    query:
      type: string
      minLength: 1
    filters:
      type: object
      minProperties: 1
      additionalProperties:
        type: string
```

Rule penting:

> Dalam `anyOf`, pastikan setiap branch benar-benar menambahkan constraint yang berarti.

---

## 6. `oneOf`: Exclusive Union

### 6.1 Apa Itu `oneOf`

`oneOf` berarti instance harus valid terhadap tepat satu subschema.

Ini sering digunakan untuk polymorphism:

```yaml
EvidenceSubmission:
  oneOf:
    - $ref: '#/components/schemas/DocumentEvidenceSubmission'
    - $ref: '#/components/schemas/ImageEvidenceSubmission'
    - $ref: '#/components/schemas/ExternalReferenceEvidenceSubmission'
```

Secara intensi: evidence submission bisa berupa document, image, atau external reference.

Tetapi secara validasi, setiap branch harus dibuat agar tidak overlap secara tidak sengaja.

---

### 6.2 Masalah Utama `oneOf`: Ambiguity

Contoh buruk:

```yaml
Pet:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'

Cat:
  type: object
  properties:
    name:
      type: string

Dog:
  type: object
  properties:
    name:
      type: string
```

Payload:

```json
{ "name": "Milo" }
```

Payload ini valid terhadap `Cat` dan valid terhadap `Dog`. Maka ia **tidak valid** terhadap `oneOf`, karena matching dua branch.

Ini mengejutkan bagi banyak engineer.

Untuk membuat `oneOf` sehat, branches harus bisa dibedakan.

---

### 6.3 Membuat `oneOf` Mutually Exclusive dengan Tag Field

Pola paling umum adalah tag field:

```yaml
Pet:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
  discriminator:
    propertyName: petType
    mapping:
      cat: '#/components/schemas/Cat'
      dog: '#/components/schemas/Dog'

Cat:
  type: object
  required:
    - petType
    - name
    - huntingSkill
  properties:
    petType:
      type: string
      const: cat
    name:
      type: string
    huntingSkill:
      type: string
      enum: [low, medium, high]

Dog:
  type: object
  required:
    - petType
    - name
    - packSize
  properties:
    petType:
      type: string
      const: dog
    name:
      type: string
    packSize:
      type: integer
      minimum: 1
```

Payload Cat:

```json
{
  "petType": "cat",
  "name": "Milo",
  "huntingSkill": "high"
}
```

Payload Dog:

```json
{
  "petType": "dog",
  "name": "Bruno",
  "packSize": 3
}
```

Kenapa ini lebih baik?

1. `petType` eksplisit.
2. Setiap branch punya `const` berbeda.
3. Validator dapat membuktikan exclusivity.
4. Generated code punya clue untuk deserialization.
5. Human reader paham representation type.

---

### 6.4 Discriminator Tidak Mengubah Validasi

Penting: `discriminator` membantu tool memilih schema, tetapi tidak boleh dipahami sebagai pengganti constraint.

Contoh buruk:

```yaml
Pet:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
  discriminator:
    propertyName: petType

Cat:
  type: object
  properties:
    petType:
      type: string
    name:
      type: string

Dog:
  type: object
  properties:
    petType:
      type: string
    name:
      type: string
```

Kalau tidak ada `const` atau `enum` di masing-masing branch, payload ini bisa tetap ambiguous:

```json
{
  "petType": "cat",
  "name": "Milo"
}
```

Secara manusia, kita bilang “ini cat”. Tetapi schema `Dog` juga menerima `petType` string apa saja dan `name` string. Jadi ia match `Dog` juga.

Lebih benar:

```yaml
Cat:
  type: object
  required: [petType, name]
  properties:
    petType:
      type: string
      const: cat
    name:
      type: string

Dog:
  type: object
  required: [petType, name]
  properties:
    petType:
      type: string
      const: dog
    name:
      type: string
```

Rule:

> Jangan hanya mengandalkan `discriminator.mapping`. Pastikan setiap branch memiliki constraint yang benar-benar membedakan dirinya.

---

### 6.5 Kapan `oneOf` Tepat

Gunakan `oneOf` ketika:

1. payload memang harus tepat satu dari beberapa bentuk,
2. bentuk-bentuk tersebut mutually exclusive,
3. consumer perlu tahu tipe concrete representation,
4. deserialization ke subtype memang penting,
5. branch-specific fields benar-benar berbeda,
6. evolusi subtype dapat dikelola dengan compatibility policy.

Contoh realistis dalam sistem enforcement lifecycle:

```yaml
EvidenceCreateRequest:
  oneOf:
    - $ref: '#/components/schemas/DocumentEvidenceCreateRequest'
    - $ref: '#/components/schemas/ExternalUrlEvidenceCreateRequest'
    - $ref: '#/components/schemas/WitnessStatementEvidenceCreateRequest'
  discriminator:
    propertyName: evidenceType
    mapping:
      DOCUMENT: '#/components/schemas/DocumentEvidenceCreateRequest'
      EXTERNAL_URL: '#/components/schemas/ExternalUrlEvidenceCreateRequest'
      WITNESS_STATEMENT: '#/components/schemas/WitnessStatementEvidenceCreateRequest'
```

Subtypes:

```yaml
DocumentEvidenceCreateRequest:
  type: object
  required:
    - evidenceType
    - fileId
    - title
  properties:
    evidenceType:
      type: string
      const: DOCUMENT
    fileId:
      type: string
    title:
      type: string

ExternalUrlEvidenceCreateRequest:
  type: object
  required:
    - evidenceType
    - url
    - title
  properties:
    evidenceType:
      type: string
      const: EXTERNAL_URL
    url:
      type: string
      format: uri
    title:
      type: string

WitnessStatementEvidenceCreateRequest:
  type: object
  required:
    - evidenceType
    - witnessId
    - statementText
  properties:
    evidenceType:
      type: string
      const: WITNESS_STATEMENT
    witnessId:
      type: string
    statementText:
      type: string
      minLength: 1
```

Ini sehat karena setiap subtype punya discriminating constant dan required fields yang spesifik.

---

### 6.6 Kapan Jangan Pakai `oneOf`

Jangan pakai `oneOf` hanya karena kamu punya enum status.

Buruk:

```yaml
Case:
  oneOf:
    - $ref: '#/components/schemas/DraftCase'
    - $ref: '#/components/schemas/OpenCase'
    - $ref: '#/components/schemas/ClosedCase'
```

Jika perbedaannya hanya `status`, sering lebih baik:

```yaml
Case:
  type: object
  required:
    - id
    - status
    - title
  properties:
    id:
      type: string
    status:
      type: string
      enum: [DRAFT, OPEN, CLOSED]
    title:
      type: string
```

Lalu dokumentasikan lifecycle rules di operation semantics.

Gunakan `oneOf` untuk state hanya jika representation benar-benar berbeda besar dan consumer perlu branch-specific handling.

Contoh mungkin layak:

```yaml
CaseDecision:
  oneOf:
    - $ref: '#/components/schemas/NoViolationDecision'
    - $ref: '#/components/schemas/ViolationDecision'
    - $ref: '#/components/schemas/DeferredDecision'
```

Karena masing-masing decision type mungkin punya required fields berbeda.

---

## 7. `not`: Negation

### 7.1 Apa Itu `not`

`not` berarti instance tidak boleh valid terhadap subschema tertentu.

Contoh:

```yaml
NonEmptyObject:
  type: object
  not:
    maxProperties: 0
```

Ini melarang object kosong.

Atau:

```yaml
NonAdminUserUpdate:
  type: object
  properties:
    role:
      type: string
  not:
    properties:
      role:
        const: ADMIN
```

Secara intensi: request update tidak boleh mengatur role menjadi `ADMIN`.

---

### 7.2 Kenapa `not` Jarang Dipakai

`not` powerful, tetapi sulit dibaca dan bisa membuat schema kompleks.

Dalam API contract, readability sangat penting. Banyak consumer tidak membaca schema sebagai formal logic. Mereka butuh tahu “boleh apa, tidak boleh apa” secara jelas.

Contoh sulit:

```yaml
CaseTransitionRequest:
  type: object
  not:
    anyOf:
      - required: [closeReason, escalationReason]
      - required: [appealReason, closureTimestamp]
```

Ini mungkin benar secara logika, tetapi sulit untuk consumer.

Sering lebih baik membuat schema eksplisit:

```yaml
CaseTransitionRequest:
  oneOf:
    - $ref: '#/components/schemas/CloseCaseRequest'
    - $ref: '#/components/schemas/EscalateCaseRequest'
    - $ref: '#/components/schemas/AppealCaseRequest'
```

Atau pecah endpoint:

```text
POST /cases/{caseId}/close
POST /cases/{caseId}/escalate
POST /cases/{caseId}/appeal
```

Rule praktis:

> Gunakan `not` untuk constraint kecil yang jelas. Hindari `not` sebagai alat modelling workflow kompleks.

---

## 8. Discriminator Object

### 8.1 Apa Itu Discriminator

`discriminator` adalah mekanisme OpenAPI untuk memberi tahu tool property mana yang membedakan schema alternatif.

Contoh:

```yaml
PaymentInstruction:
  oneOf:
    - $ref: '#/components/schemas/BankTransferInstruction'
    - $ref: '#/components/schemas/CardPaymentInstruction'
  discriminator:
    propertyName: paymentMethod
    mapping:
      BANK_TRANSFER: '#/components/schemas/BankTransferInstruction'
      CARD: '#/components/schemas/CardPaymentInstruction'
```

`propertyName` menunjuk field yang menjadi tag.

`mapping` mengaitkan nilai tag ke schema.

---

### 8.2 Discriminator Harus Didukung oleh Schema Branch

Jangan tulis discriminator tanpa membuat property itu required dan constrained di setiap branch.

Baik:

```yaml
BankTransferInstruction:
  type: object
  required:
    - paymentMethod
    - bankAccountNumber
  properties:
    paymentMethod:
      type: string
      const: BANK_TRANSFER
    bankAccountNumber:
      type: string

CardPaymentInstruction:
  type: object
  required:
    - paymentMethod
    - cardToken
  properties:
    paymentMethod:
      type: string
      const: CARD
    cardToken:
      type: string
```

Buruk:

```yaml
BankTransferInstruction:
  type: object
  properties:
    bankAccountNumber:
      type: string

CardPaymentInstruction:
  type: object
  properties:
    cardToken:
      type: string
```

Kenapa buruk?

- `paymentMethod` tidak didefinisikan.
- Consumer tidak tahu field tag wajib atau tidak.
- Validator tidak bisa membuktikan branch secara kuat.
- Generated client bisa gagal deserialization.

---

### 8.3 Explicit Mapping vs Implicit Mapping

Sebagian tool bisa memakai implicit mapping berdasarkan schema name. Namun untuk contract yang serius, explicit mapping lebih aman.

Kurang eksplisit:

```yaml
discriminator:
  propertyName: evidenceType
```

Lebih baik:

```yaml
discriminator:
  propertyName: evidenceType
  mapping:
    DOCUMENT: '#/components/schemas/DocumentEvidence'
    URL: '#/components/schemas/UrlEvidence'
    WITNESS_STATEMENT: '#/components/schemas/WitnessStatementEvidence'
```

Alasan:

1. Schema name tidak selalu sama dengan wire value.
2. Wire value mungkin mengikuti domain vocabulary.
3. Schema name mungkin berubah untuk refactor documentation.
4. Mapping eksplisit lebih jelas untuk review.
5. Menghindari generator-specific behavior.

---

### 8.4 Discriminator dan Case Sensitivity

Nilai discriminator adalah data di wire contract. Perlakukan sebagai value yang stabil.

Pilih salah satu style:

```json
{ "type": "document" }
```

atau:

```json
{ "type": "DOCUMENT" }
```

atau:

```json
{ "type": "DocumentEvidence" }
```

Jangan campur.

Rekomendasi praktis:

- Untuk domain enum internal-public: `UPPER_SNAKE_CASE` sering jelas.
- Untuk public JSON style: `lower-kebab` atau `lower_snake` bisa lebih friendly.
- Untuk Java enum mapping: hati-hati agar tidak menjadikan nama Java enum sebagai wire contract tanpa sadar.

Buruk:

```json
{ "evidenceType": "DocumentEvidenceCreateRequest" }
```

Ini membocorkan schema/class naming ke public contract.

Lebih baik:

```json
{ "evidenceType": "DOCUMENT" }
```

---

## 9. Polymorphism dalam OpenAPI vs Java

### 9.1 Java Polymorphism

Dalam Java, polymorphism biasanya berarti object dapat direferensikan lewat supertype:

```java
sealed interface Evidence permits DocumentEvidence, UrlEvidence, WitnessStatementEvidence {}

record DocumentEvidence(String fileId, String title) implements Evidence {}
record UrlEvidence(URI url, String title) implements Evidence {}
record WitnessStatementEvidence(String witnessId, String statementText) implements Evidence {}
```

Jackson dapat menggunakan type info:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "evidenceType"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = DocumentEvidence.class, name = "DOCUMENT"),
    @JsonSubTypes.Type(value = UrlEvidence.class, name = "URL"),
    @JsonSubTypes.Type(value = WitnessStatementEvidence.class, name = "WITNESS_STATEMENT")
})
sealed interface Evidence {}
```

Ini implementation detail.

OpenAPI harus mendeskripsikan wire contract:

```json
{
  "evidenceType": "DOCUMENT",
  "fileId": "file-123",
  "title": "Signed agreement"
}
```

Bukan mendeskripsikan Java inheritance semata.

---

### 9.2 Mapping yang Sehat

OpenAPI:

```yaml
Evidence:
  oneOf:
    - $ref: '#/components/schemas/DocumentEvidence'
    - $ref: '#/components/schemas/UrlEvidence'
    - $ref: '#/components/schemas/WitnessStatementEvidence'
  discriminator:
    propertyName: evidenceType
    mapping:
      DOCUMENT: '#/components/schemas/DocumentEvidence'
      URL: '#/components/schemas/UrlEvidence'
      WITNESS_STATEMENT: '#/components/schemas/WitnessStatementEvidence'
```

Java API DTO:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "evidenceType",
    visible = true
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = DocumentEvidenceDto.class, name = "DOCUMENT"),
    @JsonSubTypes.Type(value = UrlEvidenceDto.class, name = "URL"),
    @JsonSubTypes.Type(value = WitnessStatementEvidenceDto.class, name = "WITNESS_STATEMENT")
})
public sealed interface EvidenceDto
    permits DocumentEvidenceDto, UrlEvidenceDto, WitnessStatementEvidenceDto {

    EvidenceType evidenceType();
}
```

DTO subtype:

```java
public record DocumentEvidenceDto(
    EvidenceType evidenceType,
    String fileId,
    String title
) implements EvidenceDto {
    public DocumentEvidenceDto {
        if (evidenceType != EvidenceType.DOCUMENT) {
            throw new IllegalArgumentException("Invalid evidenceType for DocumentEvidenceDto");
        }
    }
}
```

Namun jangan biarkan DTO polymorphism bocor ke domain core jika domain sebenarnya tidak membutuhkannya.

Domain bisa berbeda:

```java
public final class Evidence {
    private EvidenceId id;
    private EvidenceType type;
    private EvidencePayload payload;
}
```

Atau:

```java
sealed interface EvidencePayload permits DocumentPayload, UrlPayload, WitnessStatementPayload {}
```

Yang penting: API contract dan domain model boleh berbeda.

---

## 10. Composition dan `additionalProperties` / Closed Objects

### 10.1 Problem

Banyak engineer ingin menutup object shape:

```yaml
Base:
  type: object
  additionalProperties: false
  properties:
    id:
      type: string
```

Lalu extend:

```yaml
Case:
  allOf:
    - $ref: '#/components/schemas/Base'
    - type: object
      properties:
        title:
          type: string
```

Masalahnya: tergantung draft/tooling dan letak constraint, `additionalProperties: false` di `Base` bisa membuat property `title` dianggap additional terhadap `Base`, sehingga payload:

```json
{
  "id": "case-1",
  "title": "Case title"
}
```

bisa ditolak oleh branch `Base`.

Ini jebakan klasik.

---

### 10.2 Pendekatan Aman

#### A. Jangan tutup base reusable schema terlalu awal

```yaml
BaseResource:
  type: object
  required: [id]
  properties:
    id:
      type: string
```

Tutup di concrete schema jika perlu.

#### B. Gunakan `unevaluatedProperties` jika tooling mendukung JSON Schema modern

```yaml
Case:
  allOf:
    - $ref: '#/components/schemas/BaseResource'
    - type: object
      required: [title]
      properties:
        title:
          type: string
  unevaluatedProperties: false
```

Namun hati-hati: dukungan tooling untuk keyword modern bisa bervariasi.

#### C. Hindari `allOf` untuk sekadar merge fields jika toolchain tidak matang

Kadang lebih jelas:

```yaml
Case:
  type: object
  additionalProperties: false
  required:
    - id
    - title
  properties:
    id:
      type: string
    title:
      type: string
```

Duplikasi kecil bisa lebih sehat daripada composition yang membuat validator/generator ambigu.

---

## 11. Composition dan Generated Code

### 11.1 Kenapa Generated Code Sulit

Schema composition mudah bagi validator tetapi sulit bagi generator.

Validator hanya perlu menjawab:

> Apakah JSON ini valid terhadap schema?

Generator harus menjawab:

> Type Java/TypeScript/C#/Go apa yang harus dibuat?

Itu jauh lebih sulit.

Contoh:

```yaml
Contact:
  oneOf:
    - $ref: '#/components/schemas/EmailContact'
    - $ref: '#/components/schemas/PhoneContact'
```

Generator bisa memilih:

- interface `Contact`,
- wrapper class `Contact` dengan `actualInstance`,
- union type jika bahasa mendukung,
- base class + subclasses,
- `Object`,
- custom deserializer.

Setiap generator/language bisa berbeda.

---

### 11.2 Design untuk Generator-Friendly Schema

Agar schema lebih ramah generated code:

1. Gunakan discriminator eksplisit untuk `oneOf` polymorphism.
2. Pastikan discriminator property required di semua branch.
3. Gunakan `const` atau enum single-value per branch.
4. Hindari nested `oneOf` terlalu dalam.
5. Hindari kombinasi `allOf` + `oneOf` + `anyOf` yang sulit.
6. Hindari anonymous inline schema untuk branch penting.
7. Beri nama komponen dengan jelas.
8. Uji output generator, bukan hanya schema validity.
9. Tambahkan contract tests untuk serialization/deserialization.

Buruk:

```yaml
Result:
  oneOf:
    - type: object
      properties:
        value:
          type: string
    - type: object
      properties:
        value:
          type: integer
```

Lebih baik:

```yaml
Result:
  oneOf:
    - $ref: '#/components/schemas/StringResult'
    - $ref: '#/components/schemas/IntegerResult'
  discriminator:
    propertyName: resultType
    mapping:
      STRING: '#/components/schemas/StringResult'
      INTEGER: '#/components/schemas/IntegerResult'
```

---

## 12. Pattern: Tagged Union

Tagged union adalah pattern paling umum untuk polymorphism yang sehat.

### 12.1 Generic Shape

```yaml
Thing:
  oneOf:
    - $ref: '#/components/schemas/ThingA'
    - $ref: '#/components/schemas/ThingB'
  discriminator:
    propertyName: kind
    mapping:
      A: '#/components/schemas/ThingA'
      B: '#/components/schemas/ThingB'

ThingA:
  type: object
  required: [kind, aField]
  properties:
    kind:
      type: string
      const: A
    aField:
      type: string

ThingB:
  type: object
  required: [kind, bField]
  properties:
    kind:
      type: string
      const: B
    bField:
      type: integer
```

### 12.2 Kapan Bagus

Tagged union bagus untuk:

- event payloads,
- command payloads,
- evidence types,
- payment methods,
- notification channels,
- search criteria variants,
- workflow transition requests,
- rule condition expressions,
- integration message variants.

### 12.3 Kapan Berlebihan

Tagged union berlebihan jika:

- hanya satu atau dua field yang berbeda kecil,
- consumer tidak butuh branch-specific handling,
- subtype sering berubah,
- generator target tidak mendukung polymorphism dengan baik,
- schema akan dipakai oleh banyak partner non-technical.

---

## 13. Pattern: State-Specific Representations

Kadang resource memiliki representation berbeda berdasarkan lifecycle state.

Contoh enforcement case:

```yaml
Case:
  oneOf:
    - $ref: '#/components/schemas/DraftCase'
    - $ref: '#/components/schemas/ActiveCase'
    - $ref: '#/components/schemas/ClosedCase'
  discriminator:
    propertyName: status
    mapping:
      DRAFT: '#/components/schemas/DraftCase'
      ACTIVE: '#/components/schemas/ActiveCase'
      CLOSED: '#/components/schemas/ClosedCase'
```

Subtypes:

```yaml
DraftCase:
  type: object
  required: [id, status, title]
  properties:
    id:
      type: string
    status:
      type: string
      const: DRAFT
    title:
      type: string

ActiveCase:
  type: object
  required: [id, status, title, assignedOfficerId]
  properties:
    id:
      type: string
    status:
      type: string
      const: ACTIVE
    title:
      type: string
    assignedOfficerId:
      type: string

ClosedCase:
  type: object
  required: [id, status, title, closedAt, closureReason]
  properties:
    id:
      type: string
    status:
      type: string
      const: CLOSED
    title:
      type: string
    closedAt:
      type: string
      format: date-time
    closureReason:
      type: string
```

Ini bisa benar jika consumer memang perlu mengetahui field yang hanya ada pada state tertentu.

Namun hati-hati. Ini membuat setiap state evolution menjadi schema evolution. Jika state sering berubah, model ini bisa membuat API rapuh.

Alternatif:

```yaml
Case:
  type: object
  required:
    - id
    - status
    - title
  properties:
    id:
      type: string
    status:
      $ref: '#/components/schemas/CaseStatus'
    title:
      type: string
    assignedOfficerId:
      type: string
      description: Present when case has been assigned.
    closedAt:
      type: string
      format: date-time
      description: Present when case is closed.
    closureReason:
      type: string
      description: Present when case is closed.
```

Trade-off:

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| `oneOf` state-specific | precise, strong validation | more complex, harder evolution |
| single schema + conditional docs | simpler, generator-friendly | weaker machine validation |
| separate endpoints | clear workflow boundary | more endpoints |

Top-tier design biasanya memilih berdasarkan consumer need, bukan keinginan schema purity.

---

## 14. Pattern: Command Variants

Command API sering cocok memakai `oneOf`.

Contoh endpoint:

```text
POST /cases/{caseId}/transitions
```

Request:

```yaml
CaseTransitionRequest:
  oneOf:
    - $ref: '#/components/schemas/AssignCaseRequest'
    - $ref: '#/components/schemas/EscalateCaseRequest'
    - $ref: '#/components/schemas/CloseCaseRequest'
  discriminator:
    propertyName: transitionType
    mapping:
      ASSIGN: '#/components/schemas/AssignCaseRequest'
      ESCALATE: '#/components/schemas/EscalateCaseRequest'
      CLOSE: '#/components/schemas/CloseCaseRequest'
```

Subtypes:

```yaml
AssignCaseRequest:
  type: object
  required: [transitionType, assigneeId]
  properties:
    transitionType:
      type: string
      const: ASSIGN
    assigneeId:
      type: string
    reason:
      type: string

EscalateCaseRequest:
  type: object
  required: [transitionType, escalationLevel, reason]
  properties:
    transitionType:
      type: string
      const: ESCALATE
    escalationLevel:
      type: string
      enum: [SUPERVISOR, LEGAL, ENFORCEMENT_BOARD]
    reason:
      type: string
      minLength: 1

CloseCaseRequest:
  type: object
  required: [transitionType, closureReason]
  properties:
    transitionType:
      type: string
      const: CLOSE
    closureReason:
      type: string
      enum: [NO_VIOLATION, RESOLVED, DUPLICATE, OUT_OF_SCOPE]
    notes:
      type: string
```

Ini cocok jika organisasi ingin satu command endpoint yang menerima banyak transition variant.

Namun pertimbangkan alternatif:

```text
POST /cases/{caseId}/assign
POST /cases/{caseId}/escalate
POST /cases/{caseId}/close
```

Endpoint terpisah sering lebih jelas untuk authorization, audit, documentation, dan observability.

Decision heuristic:

| Pilih satu transition endpoint + `oneOf` jika | Pilih endpoint terpisah jika |
|---|---|
| transition diproses oleh engine generik | tiap transition punya auth/policy berbeda |
| UI mengirim command envelope generik | audit butuh operation-level clarity |
| workflow sangat configurable | API public/partner membutuhkan clarity |
| transition type sering ditambah | monitoring per action penting |

---

## 15. Pattern: Search Criteria Variants

Search API sering punya beberapa mode:

- by keyword,
- by structured filters,
- by saved query,
- by exact identifier.

Bisa memakai `oneOf`:

```yaml
CaseSearchRequest:
  oneOf:
    - $ref: '#/components/schemas/KeywordCaseSearchRequest'
    - $ref: '#/components/schemas/StructuredCaseSearchRequest'
    - $ref: '#/components/schemas/SavedCaseSearchRequest'
  discriminator:
    propertyName: searchMode
    mapping:
      KEYWORD: '#/components/schemas/KeywordCaseSearchRequest'
      STRUCTURED: '#/components/schemas/StructuredCaseSearchRequest'
      SAVED: '#/components/schemas/SavedCaseSearchRequest'
```

Tetapi jangan terlalu cepat pakai `oneOf`. Jika request bisa menggabungkan keyword dan filters, `anyOf` atau single schema lebih tepat:

```yaml
CaseSearchRequest:
  type: object
  anyOf:
    - required: [query]
    - required: [filters]
  properties:
    query:
      type: string
    filters:
      $ref: '#/components/schemas/CaseFilters'
    sort:
      type: array
      items:
        $ref: '#/components/schemas/SortCriterion'
```

Kalau user boleh search dengan query + filters, jangan pakai `oneOf`.

---

## 16. Composition dan Compatibility

### 16.1 Menambah Branch ke `oneOf`

Menambah subtype baru ke `oneOf` tampak additive:

```yaml
Evidence:
  oneOf:
    - DocumentEvidence
    - UrlEvidence
    - WitnessStatementEvidence
    - AudioEvidence # baru
```

Namun bagi consumer, ini bisa breaking.

Kenapa?

- Generated client lama mungkin tidak mengenal subtype baru.
- Switch statement di client bisa tidak exhaustive.
- Mobile app bisa crash saat deserialization.
- Partner integration mungkin menolak unknown discriminator value.
- UI mungkin tidak punya renderer untuk subtype baru.

Jadi “menambah branch” bukan selalu safe.

Rule:

> Untuk response polymorphism, menambah subtype baru harus diperlakukan sebagai potentially breaking kecuali contract compatibility policy menyatakan consumer wajib toleran terhadap unknown discriminator values.

Untuk request polymorphism, menambah subtype biasanya lebih aman bagi existing consumer, karena mereka tidak mengirim subtype baru. Tetapi masih bisa berdampak ke generated SDK/documentation.

---

### 16.2 Mengubah Branch Constraint

Menambah required field ke branch request adalah breaking.

```yaml
DocumentEvidenceCreateRequest:
  required:
    - evidenceType
    - fileId
    - title
    - sourceSystem # baru
```

Existing client yang mengirim payload lama akan gagal.

Menambah optional response field biasanya additive, tetapi tidak selalu aman jika consumer strict terhadap unknown fields.

Mengubah `const` discriminator value adalah breaking.

```yaml
const: DOCUMENT
```

menjadi:

```yaml
const: FILE_DOCUMENT
```

Itu breaking besar.

---

### 16.3 Mengubah `anyOf` ke `oneOf`

Ini hampir pasti breaking karena kamu memperketat validasi.

Sebelumnya valid:

```json
{
  "email": "a@example.com",
  "phone": "+628123456"
}
```

Dengan `anyOf`, valid. Dengan `oneOf`, tidak valid.

---

### 16.4 Mengubah `oneOf` ke `anyOf`

Ini melonggarkan validasi. Untuk request, bisa membuat server menerima payload yang sebelumnya tidak valid, tetapi implementasi mungkin belum siap menghadapi overlap. Untuk response, bisa membuat contract kurang jelas bagi consumer.

Tidak selalu breaking, tapi semantic change.

---

## 17. Composition dan Validation Boundary

OpenAPI validation hanya structural/schema-level. Ia tidak menggantikan business validation.

Contoh:

```yaml
CloseCaseRequest:
  type: object
  required: [transitionType, closureReason]
  properties:
    transitionType:
      type: string
      const: CLOSE
    closureReason:
      type: string
      enum: [NO_VIOLATION, RESOLVED, DUPLICATE]
```

Schema bisa memastikan request berbentuk close command. Tetapi schema tidak bisa memastikan:

- case memang ada,
- case belum closed,
- user punya permission untuk close,
- required evidence sudah complete,
- appeal window sudah lewat,
- supervisor approval sudah diberikan.

Jangan memasukkan seluruh business rule ke schema composition.

Boundary sehat:

| Layer | Bertanggung Jawab |
|---|---|
| OpenAPI schema | shape, type, required field, basic constraints, representation variant |
| Request validator | reject structurally invalid request |
| Application service | authorization, state transition, business invariant |
| Domain model | lifecycle consistency, aggregate invariant |
| Audit layer | evidence of decision/action |

---

## 18. Error Modelling dengan Composition

Error responses sering cocok memakai composition, tetapi hati-hati.

### 18.1 Base Problem + Specific Error

Problem Details style:

```yaml
Problem:
  type: object
  required:
    - type
    - title
    - status
  properties:
    type:
      type: string
      format: uri
    title:
      type: string
    status:
      type: integer
    detail:
      type: string
    instance:
      type: string
      format: uri
```

Specific validation problem:

```yaml
ValidationProblem:
  allOf:
    - $ref: '#/components/schemas/Problem'
    - type: object
      required:
        - errors
      properties:
        type:
          const: https://api.example.gov/problems/validation-error
        errors:
          type: array
          items:
            type: object
            required: [field, message]
            properties:
              field:
                type: string
              message:
                type: string
```

Namun perhatikan: jika `Problem.type` sudah didefinisikan sebagai `format: uri`, menambahkan `const` URI masih compatible. Jika base punya enum terbatas dan specific memakai const di luar enum, bisa unsatisfiable.

### 18.2 Error Union

```yaml
ApiError:
  oneOf:
    - $ref: '#/components/schemas/ValidationProblem'
    - $ref: '#/components/schemas/ConflictProblem'
    - $ref: '#/components/schemas/AuthorizationProblem'
  discriminator:
    propertyName: type
    mapping:
      https://api.example.gov/problems/validation-error: '#/components/schemas/ValidationProblem'
      https://api.example.gov/problems/conflict: '#/components/schemas/ConflictProblem'
      https://api.example.gov/problems/authorization: '#/components/schemas/AuthorizationProblem'
```

Ini bisa berguna, tetapi jangan sampai setiap error code kecil jadi subtype baru. Kadang satu `Problem` schema plus `errorCode` lebih sederhana.

---

## 19. Schema Design Decision Tree

Gunakan decision tree ini:

### 19.1 Apakah Bentuk Payload Selalu Sama?

Jika ya, jangan pakai composition polymorphism.

Gunakan single schema:

```yaml
Case:
  type: object
  required: [id, status, title]
```

### 19.2 Apakah Payload Bisa Memiliki Minimal Salah Satu dari Beberapa Field?

Jika ya, gunakan `anyOf` dengan required constraints.

```yaml
anyOf:
  - required: [email]
  - required: [phone]
```

### 19.3 Apakah Payload Harus Tepat Satu Variant?

Jika ya, gunakan `oneOf`.

Pastikan:

- ada tag/discriminator field,
- branch mutually exclusive,
- field tag required,
- value tag constrained dengan `const`/single enum,
- mapping eksplisit.

### 19.4 Apakah Kamu Hanya Ingin Menambahkan Common Fields?

Pertimbangkan `allOf`, tetapi jangan overuse.

Jika common fields sedikit, duplikasi mungkin lebih jelas.

### 19.5 Apakah Constraint Sulit Dijelaskan Tanpa Negation?

Pertimbangkan `not`, tetapi review readability. Kalau sulit dibaca, pecah schema atau endpoint.

---

## 20. Worked Example: Evidence API

### 20.1 Requirement

Sistem case management membutuhkan endpoint untuk submit evidence. Evidence bisa berupa:

1. uploaded document,
2. external URL,
3. witness statement.

Setiap evidence memiliki:

- `evidenceType`,
- `title`,
- `submittedBy`,
- subtype-specific fields.

### 20.2 Bad Design: Loose Object

```yaml
EvidenceCreateRequest:
  type: object
  required:
    - evidenceType
    - title
  properties:
    evidenceType:
      type: string
      enum: [DOCUMENT, URL, WITNESS_STATEMENT]
    title:
      type: string
    fileId:
      type: string
    url:
      type: string
      format: uri
    witnessId:
      type: string
    statementText:
      type: string
```

Masalah:

- Untuk `DOCUMENT`, apakah `fileId` required?
- Untuk `URL`, apakah `url` required?
- Bolehkah `DOCUMENT` mengirim `url`?
- Bolehkah semua field dikirim sekaligus?
- Validation logic tersembunyi di server.

### 20.3 Better Design: Tagged Union

```yaml
EvidenceCreateRequest:
  oneOf:
    - $ref: '#/components/schemas/DocumentEvidenceCreateRequest'
    - $ref: '#/components/schemas/UrlEvidenceCreateRequest'
    - $ref: '#/components/schemas/WitnessStatementEvidenceCreateRequest'
  discriminator:
    propertyName: evidenceType
    mapping:
      DOCUMENT: '#/components/schemas/DocumentEvidenceCreateRequest'
      URL: '#/components/schemas/UrlEvidenceCreateRequest'
      WITNESS_STATEMENT: '#/components/schemas/WitnessStatementEvidenceCreateRequest'

DocumentEvidenceCreateRequest:
  type: object
  required:
    - evidenceType
    - title
    - fileId
  properties:
    evidenceType:
      type: string
      const: DOCUMENT
    title:
      type: string
      minLength: 1
    fileId:
      type: string
      minLength: 1

UrlEvidenceCreateRequest:
  type: object
  required:
    - evidenceType
    - title
    - url
  properties:
    evidenceType:
      type: string
      const: URL
    title:
      type: string
      minLength: 1
    url:
      type: string
      format: uri

WitnessStatementEvidenceCreateRequest:
  type: object
  required:
    - evidenceType
    - title
    - witnessId
    - statementText
  properties:
    evidenceType:
      type: string
      const: WITNESS_STATEMENT
    title:
      type: string
      minLength: 1
    witnessId:
      type: string
      minLength: 1
    statementText:
      type: string
      minLength: 1
```

Kelebihan:

- Consumer tahu field wajib per variant.
- Validator bisa menolak payload ambiguous.
- Discriminator membantu generated client/server.
- Contract review lebih mudah.

### 20.4 Response Design

Response bisa sama atau berbeda.

Jika semua evidence response punya shape umum:

```yaml
Evidence:
  type: object
  required:
    - id
    - evidenceType
    - title
    - createdAt
  properties:
    id:
      type: string
    evidenceType:
      type: string
      enum: [DOCUMENT, URL, WITNESS_STATEMENT]
    title:
      type: string
    createdAt:
      type: string
      format: date-time
```

Tetapi jika consumer perlu subtype-specific fields:

```yaml
Evidence:
  oneOf:
    - $ref: '#/components/schemas/DocumentEvidence'
    - $ref: '#/components/schemas/UrlEvidence'
    - $ref: '#/components/schemas/WitnessStatementEvidence'
  discriminator:
    propertyName: evidenceType
    mapping:
      DOCUMENT: '#/components/schemas/DocumentEvidence'
      URL: '#/components/schemas/UrlEvidence'
      WITNESS_STATEMENT: '#/components/schemas/WitnessStatementEvidence'
```

Jangan otomatis menyamakan request polymorphism dan response polymorphism. Mereka punya kebutuhan berbeda.

---

## 21. Worked Example: Polymorphic Events vs OpenAPI Boundary

OpenAPI mendeskripsikan HTTP APIs. Untuk event streaming, AsyncAPI sering lebih tepat. Namun HTTP endpoint bisa menerima event-like payload.

```text
POST /case-events
```

Request:

```yaml
CaseEvent:
  oneOf:
    - $ref: '#/components/schemas/CaseOpenedEvent'
    - $ref: '#/components/schemas/CaseAssignedEvent'
    - $ref: '#/components/schemas/CaseClosedEvent'
  discriminator:
    propertyName: eventType
    mapping:
      CASE_OPENED: '#/components/schemas/CaseOpenedEvent'
      CASE_ASSIGNED: '#/components/schemas/CaseAssignedEvent'
      CASE_CLOSED: '#/components/schemas/CaseClosedEvent'
```

Namun untuk event systems, subtype addition adalah compatibility issue besar. Consumer event lama harus bisa ignore event baru atau event stream harus versioned/capability-filtered.

OpenAPI bisa mendeskripsikan endpoint, tetapi event governance tetap harus didesain.

---

## 22. Anti-Patterns

### 22.1 `allOf` as Java `extends`

```yaml
Employee:
  allOf:
    - $ref: '#/components/schemas/Person'
```

Tanpa constraint tambahan, ini tidak memberi nilai contract.

### 22.2 `oneOf` dengan Branch Identik

```yaml
Thing:
  oneOf:
    - type: object
      properties:
        id:
          type: string
    - type: object
      properties:
        id:
          type: string
```

Payload dengan `id` match dua branch, sehingga invalid.

### 22.3 Discriminator Tanpa Required Tag

```yaml
Pet:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
  discriminator:
    propertyName: type
```

Tetapi `Cat` dan `Dog` tidak require `type`. Ini rapuh.

### 22.4 Enum Variant Tanpa Branch Constraint

```yaml
Cat:
  properties:
    type:
      type: string
```

Harusnya:

```yaml
Cat:
  required: [type]
  properties:
    type:
      const: CAT
```

### 22.5 Polymorphism untuk Semua Hal

Tidak semua variasi butuh `oneOf`. Kadang single schema lebih baik.

### 22.6 Hiding Business Rules in Schema Tricks

Menggunakan `not`, nested `anyOf`, dan conditional schemas untuk menggantikan application logic biasanya membuat contract sulit dipahami.

### 22.7 Ignoring Generator Output

Schema valid belum tentu generated client/server bagus. Selalu test toolchain target.

---

## 23. Review Checklist untuk Composition

Gunakan checklist ini dalam API review.

### 23.1 Untuk `allOf`

- Apakah ini benar-benar intersection constraint?
- Apakah ada field yang didefinisikan ulang dengan constraint konflik?
- Apakah base schema terlalu spesifik?
- Apakah `additionalProperties: false` menyebabkan masalah composition?
- Apakah composition membuat contract lebih jelas daripada duplikasi kecil?
- Apakah generated code masih masuk akal?

### 23.2 Untuk `anyOf`

- Apakah lebih dari satu branch boleh valid sekaligus?
- Apakah setiap branch punya constraint meaningful?
- Apakah object kosong tidak sengaja valid?
- Apakah consumer paham konsekuensi multiple matches?
- Apakah server implementation siap menangani combined fields?

### 23.3 Untuk `oneOf`

- Apakah branch benar-benar mutually exclusive?
- Apakah ada discriminator/tag field?
- Apakah tag field required di semua branch?
- Apakah setiap branch memakai `const` atau single-value enum?
- Apakah mapping eksplisit?
- Apakah subtype addition policy jelas?
- Apakah generated client dapat deserialize dengan benar?

### 23.4 Untuk `not`

- Apakah constraint mudah dipahami?
- Apakah ada alternatif schema yang lebih eksplisit?
- Apakah error message dari validator akan masuk akal?
- Apakah logic ini seharusnya di application layer?

---

## 24. Java Engineer Guidelines

### 24.1 Jangan Mulai dari Class Hierarchy

Jangan mulai dari:

```java
abstract class BaseCase {}
class DraftCase extends BaseCase {}
class ClosedCase extends BaseCase {}
```

Mulai dari pertanyaan contract:

- Apa yang consumer lihat?
- Apa yang consumer kirim?
- Apakah representation berbeda secara substansial?
- Apakah consumer perlu subtype-specific handling?
- Apakah unknown subtype harus tolerated?
- Apakah schema ini akan digenerate ke SDK?

### 24.2 Gunakan API DTO Boundary

Jangan pakai JPA entity atau domain class sebagai OpenAPI schema langsung.

Lebih sehat:

```text
OpenAPI Schema
    ↓
API DTO / Generated DTO
    ↓ mapping
Application Command / Query Model
    ↓
Domain Model
    ↓
Persistence Model
```

### 24.3 Test Serialization dan Deserialization

Untuk polymorphism, selalu test:

- JSON -> Java DTO,
- Java DTO -> JSON,
- JSON invalid ditolak,
- unknown discriminator behavior,
- missing discriminator behavior,
- branch-specific required fields,
- generated client compatibility.

Example JUnit mindset:

```java
@Test
void documentEvidenceRequiresDocumentType() {
    String json = """
        {
          "evidenceType": "DOCUMENT",
          "fileId": "file-123",
          "title": "Signed agreement"
        }
        """;

    EvidenceDto dto = objectMapper.readValue(json, EvidenceDto.class);

    assertThat(dto).isInstanceOf(DocumentEvidenceDto.class);
}
```

Dan negative test:

```java
@Test
void documentEvidenceRejectsUrlType() {
    String json = """
        {
          "evidenceType": "URL",
          "fileId": "file-123",
          "title": "Signed agreement"
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, EvidenceDto.class))
        .isInstanceOf(JsonProcessingException.class);
}
```

---

## 25. Governance Rules untuk Composition

Dalam organisasi besar, buat rules eksplisit.

Contoh governance rules:

1. `oneOf` pada request/response harus memiliki discriminator kecuali ada justifikasi tertulis.
2. Discriminator property harus required di semua branch.
3. Discriminator value harus constrained dengan `const` atau enum single value.
4. `oneOf` branch tidak boleh anonymous inline schema untuk API public.
5. Menambah branch pada response `oneOf` memerlukan compatibility review.
6. `allOf` tidak boleh dipakai hanya untuk meniru Java inheritance tanpa tambahan constraint bermakna.
7. Shared base schema tidak boleh memakai `additionalProperties: false` kecuali sudah diuji terhadap composition.
8. Generated SDK harus diuji untuk semua target language yang officially supported.
9. Nested composition lebih dari dua level butuh design review.
10. Schema composition harus punya valid examples untuk setiap branch.

Governance yang baik bukan melarang composition, tetapi memastikan composition tidak menjadi ambiguity factory.

---

## 26. Practical Design Heuristics

Pegang heuristik berikut:

1. Prefer simple object schema unless polymorphism gives clear consumer value.
2. Use `allOf` for additive constraints, not as inheritance reflex.
3. Use `anyOf` when combinations are allowed.
4. Use `oneOf` when exactly one variant must apply.
5. Make `oneOf` branches mutually exclusive structurally.
6. Use explicit discriminator mapping for public or multi-team APIs.
7. Add `const` discriminator values in each branch.
8. Avoid deep composition trees.
9. Validate examples against schema.
10. Test generated code before standardizing a pattern.
11. Treat response subtype additions as compatibility-sensitive.
12. Document unknown subtype behavior.
13. Do not encode complex business workflows entirely in schema logic.
14. Optimize for long-term clarity, not cleverness.

---

## 27. Mini Lab

### Lab 1 — Identify the Problem

Given schema:

```yaml
NotificationTarget:
  oneOf:
    - type: object
      properties:
        email:
          type: string
    - type: object
      properties:
        phone:
          type: string
```

Question: Is this safe?

Answer: Not fully. Because `{}` is valid against both branches unless fields are required. Also payload with both `email` and `phone` may match both if both branches allow additional properties.

Better:

```yaml
NotificationTarget:
  oneOf:
    - $ref: '#/components/schemas/EmailNotificationTarget'
    - $ref: '#/components/schemas/SmsNotificationTarget'
  discriminator:
    propertyName: channel
    mapping:
      EMAIL: '#/components/schemas/EmailNotificationTarget'
      SMS: '#/components/schemas/SmsNotificationTarget'
```

### Lab 2 — Choose `anyOf` or `oneOf`

Requirement: user must provide email, phone, or both.

Use `anyOf`, not `oneOf`.

```yaml
anyOf:
  - required: [email]
  - required: [phone]
```

### Lab 3 — Choose Endpoint Split or Polymorphic Command

Requirement: case can be assigned, escalated, or closed. Each action has different permissions and audit records.

Better default: separate endpoints.

```text
POST /cases/{caseId}/assign
POST /cases/{caseId}/escalate
POST /cases/{caseId}/close
```

Reason: operation-level auth, audit, documentation, monitoring, and governance are clearer.

Use polymorphic command endpoint only if workflow engine model genuinely requires it.

---

## 28. Summary

Composition adalah fitur penting, tetapi harus dipakai dengan mental model yang benar.

Core ideas:

- `allOf` = AND, bukan inheritance.
- `anyOf` = at least one, boleh lebih dari satu.
- `oneOf` = exactly one, branches harus mutually exclusive.
- `not` = negation, powerful tapi mudah membuat schema sulit dibaca.
- `discriminator` membantu tooling, tetapi tidak menggantikan validation constraints.
- Java polymorphism dan OpenAPI polymorphism tidak harus sama.
- Tagged union adalah pattern paling aman untuk polymorphic contract.
- Generated code harus diuji, bukan diasumsikan benar.
- Schema evolution dengan polymorphism punya risiko compatibility tinggi.

Kalau ada satu prinsip yang harus diingat:

> Composition should make the contract more precise, not merely make the YAML look object-oriented.

---

## 29. References

- OpenAPI Specification v3.2.0 — Schema Object, Discriminator Object, composition semantics, and OpenAPI Description structure.  
  https://spec.openapis.org/oas/v3.2.0.html
- JSON Schema Draft 2020-12 — Applicator vocabulary including `allOf`, `anyOf`, `oneOf`, and `not`.  
  https://json-schema.org/draft/2020-12
- JSON Schema official learning material — Applicability and composition mental model.  
  https://json-schema.org/blog/posts/applicability-json-schema-fundamentals-part-1
- Swagger/OpenAPI documentation — `oneOf`, `anyOf`, `allOf`, `not`, and discriminator modelling examples.  
  https://swagger.io/docs/specification/v3_0/data-models/oneof-anyof-allof-not/

---

## 30. Part Status

```text
Current part: 010 / 030
Status: Complete
Series complete: No
Remaining parts: 20
Next: Part 011 — Modelling Domain Resources Without Leaking Persistence Models
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-009.md">⬅️ OpenAPI Mastery for Java Engineers — Part 009</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-011.md">OpenAPI Mastery for Java Engineers — Part 011 ➡️</a>
</div>
