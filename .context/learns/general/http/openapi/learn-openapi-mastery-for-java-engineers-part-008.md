# OpenAPI Mastery for Java Engineers — Part 008
# Components: Reuse Without Coupling Yourself Into a Corner

> Filename: `learn-openapi-mastery-for-java-engineers-part-008.md`

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya, kita sudah membangun fondasi OpenAPI dari sisi surface area API:

- `paths` dan `operations` sebagai daftar capability.
- `parameters` sebagai kontrak input di URL/header/cookie.
- `requestBody` sebagai payload input.
- `responses` sebagai kontrak output dan failure handling.

Sekarang kita masuk ke bagian yang terlihat sederhana tetapi sangat menentukan kualitas jangka panjang sebuah OpenAPI specification: **`components`**.

Banyak engineer menganggap `components` hanya tempat menaruh schema supaya tidak copy-paste. Itu benar, tetapi terlalu dangkal.

Dalam sistem yang tumbuh besar, `components` adalah:

1. **Vocabulary bersama** untuk API.
2. **Pusat reuse** untuk schema, responses, parameters, examples, request bodies, headers, security schemes, links, callbacks, dan path items.
3. **Boundary desain** antara konsep yang memang stabil secara organisasi dan konsep yang hanya lokal untuk satu endpoint.
4. **Sumber coupling tersembunyi** jika dipakai sembarangan.
5. **Sinyal arsitektur** tentang cara tim memahami domain API.

Part ini fokus pada pertanyaan praktis:

> Kapan sesuatu layak masuk `components`, kapan sebaiknya tetap inline, dan bagaimana reuse tanpa mengunci evolusi API?

---

## 1. Mental Model: Components Bukan Folder `common`

Secara formal, `components` adalah bagian OpenAPI document untuk mendefinisikan objek reusable. Objek di dalam `components` **tidak otomatis menjadi bagian dari API contract yang terekspos** kecuali direferensikan dari bagian lain, misalnya dari operation, request, response, atau security requirement.

Tetapi secara arsitektural, `components` sering menjadi tempat yang berbahaya karena engineer membawa kebiasaan dari codebase:

```text
Codebase thinking:
"Ada duplikasi? Extract class."

OpenAPI thinking yang lebih benar:
"Apakah dua bentuk data ini memang harus berevolusi bersama?"
```

Di Java, reuse sering terasa natural:

```java
class UserDto {
    UUID id;
    String name;
    String email;
}
```

Lalu class itu dipakai untuk:

- create user request,
- update user request,
- user list response,
- user detail response,
- admin response,
- audit response,
- internal integration response.

Di awal kelihatan efisien. Setelah API berjalan, muncul masalah:

- field `id` tidak boleh ada di create request,
- field `email` tidak boleh muncul di public list response,
- field `status` hanya boleh admin lihat,
- update request butuh partial semantics,
- audit response butuh immutable snapshot,
- generated SDK consumer bingung karena semua model punya field yang tidak relevan.

Masalahnya bukan OpenAPI. Masalahnya adalah **reuse tanpa semantic boundary**.

Rule awal:

> Reuse di OpenAPI harus berdasarkan semantic stability, bukan kemiripan bentuk.

Dua schema yang mirip belum tentu sama. Dua schema yang sama hari ini belum tentu harus berevolusi bersama besok.

---

## 2. Apa Saja Yang Bisa Ada Di `components`

Dalam OpenAPI 3.x, `components` bisa menyimpan banyak jenis reusable object. Secara umum, kategori besarnya adalah:

```yaml
components:
  schemas:
    # reusable data shapes
  responses:
    # reusable response definitions
  parameters:
    # reusable path/query/header/cookie parameters
  examples:
    # reusable examples
  requestBodies:
    # reusable request body definitions
  headers:
    # reusable response headers
  securitySchemes:
    # reusable auth/security definitions
  links:
    # reusable link definitions
  callbacks:
    # reusable callback definitions
  pathItems:
    # reusable path item definitions, available in newer OAS versions
```

Setiap kategori punya karakter reuse yang berbeda. Jangan samakan reuse schema dengan reuse response, atau reuse parameter dengan reuse security scheme.

---

## 3. `components.schemas`: Reuse Data Shape Dengan Hati-Hati

`schemas` adalah komponen yang paling sering dipakai dan paling sering disalahgunakan.

Contoh sederhana:

```yaml
components:
  schemas:
    CustomerSummary:
      type: object
      required:
        - id
        - displayName
      properties:
        id:
          type: string
          format: uuid
        displayName:
          type: string
```

Schema ini bisa direferensikan dari response:

```yaml
paths:
  /customers:
    get:
      operationId: listCustomers
      responses:
        '200':
          description: Customers found
          content:
            application/json:
              schema:
                type: object
                required:
                  - items
                properties:
                  items:
                    type: array
                    items:
                      $ref: '#/components/schemas/CustomerSummary'
```

Ini reuse yang sehat jika `CustomerSummary` memang representasi ringkas customer yang stabil dan dipakai konsisten di beberapa endpoint.

Namun, reuse menjadi buruk ketika schema dipakai karena bentuknya mirip, bukan karena maknanya sama.

### 3.1 Contoh Reuse Yang Berbahaya

```yaml
components:
  schemas:
    Customer:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        email:
          type: string
          format: email
        status:
          type: string
          enum: [ACTIVE, SUSPENDED, DELETED]
        createdAt:
          type: string
          format: date-time
```

Lalu dipakai untuk semuanya:

```yaml
requestBody:
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/Customer'
```

Masalah:

- Apakah client boleh mengirim `id`?
- Apakah client boleh mengirim `createdAt`?
- Apakah client boleh mengatur `status`?
- Apakah `DELETED` boleh muncul di public API?
- Apakah email wajib saat create?
- Apakah email boleh null saat response?
- Apakah update harus mengirim semua field?

Schema yang terlihat reusable justru membuat kontrak kabur.

### 3.2 Schema Yang Lebih Tepat

Lebih baik pecah berdasarkan peran:

```yaml
components:
  schemas:
    CustomerCreateRequest:
      type: object
      required:
        - name
        - email
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 200
        email:
          type: string
          format: email

    CustomerUpdateRequest:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 200
        email:
          type: string
          format: email

    CustomerSummaryResponse:
      type: object
      required:
        - id
        - displayName
      properties:
        id:
          type: string
          format: uuid
        displayName:
          type: string

    CustomerDetailResponse:
      type: object
      required:
        - id
        - name
        - email
        - status
        - createdAt
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        email:
          type: string
          format: email
        status:
          $ref: '#/components/schemas/CustomerStatus'
        createdAt:
          type: string
          format: date-time

    CustomerStatus:
      type: string
      enum:
        - ACTIVE
        - SUSPENDED
```

Ini memang lebih banyak schema. Tetapi semantiknya lebih jelas.

Top 1% API design sering terlihat seperti “lebih verbose”, padahal sebenarnya **lebih sedikit ambiguity**.

---

## 4. Prinsip Utama Reuse: Same Shape Is Not Same Meaning

Dua objek bisa punya struktur sama tetapi makna berbeda.

Contoh:

```yaml
Address:
  type: object
  properties:
    line1:
      type: string
    city:
      type: string
    postalCode:
      type: string
```

Apakah address ini sama untuk:

- billing address,
- shipping address,
- registered office address,
- residential address,
- enforcement notice service address,
- evidence collection location?

Secara bentuk mungkin sama. Secara makna tidak selalu.

Jika semua memakai `Address`, maka perubahan karena satu konteks dapat memengaruhi konteks lain.

Misalnya regulated system butuh `serviceAddress` dengan field tambahan:

```yaml
serviceMethod:
  type: string
  enum: [POSTAL, EMAIL, IN_PERSON]
```

Apakah semua address harus punya field itu? Tidak.

Maka pilihan yang lebih baik bisa jadi:

```yaml
components:
  schemas:
    PostalAddress:
      type: object
      required: [line1, city, postalCode]
      properties:
        line1:
          type: string
        city:
          type: string
        postalCode:
          type: string

    NoticeServiceAddress:
      type: object
      required: [postalAddress, serviceMethod]
      properties:
        postalAddress:
          $ref: '#/components/schemas/PostalAddress'
        serviceMethod:
          type: string
          enum: [POSTAL, EMAIL, IN_PERSON]
```

Di sini `PostalAddress` reusable sebagai value object umum, sedangkan `NoticeServiceAddress` punya konteks domain spesifik.

---

## 5. Kapan Schema Layak Masuk Components?

Gunakan pertanyaan ini sebelum extract schema ke `components.schemas`:

### 5.1 Apakah Konsepnya Punya Nama Domain Yang Stabil?

Bagus:

- `CustomerId`
- `CaseReference`
- `MoneyAmount`
- `ProblemDetails`
- `PaginationMetadata`
- `AuditActor`
- `EvidenceSummary`

Kurang bagus:

- `CommonObject`
- `BaseResponse`
- `Data`
- `Payload`
- `Result`
- `GenericDto`

Schema reusable harus punya nama yang menjawab:

> Ini apa dalam bahasa domain/API?

Bukan:

> Ini kumpulan field yang kebetulan sering muncul.

### 5.2 Apakah Perubahannya Harus Berdampak Ke Semua Pengguna?

Jika field baru ditambahkan ke schema ini, apakah semua endpoint yang memakai schema itu memang harus ikut berubah?

Jika jawabannya “tidak yakin”, jangan reuse terlalu cepat.

### 5.3 Apakah Consumer Akan Memahami Model Ini Sebagai Konsep Mandiri?

Jika generated SDK menghasilkan class `CustomerSummary`, consumer akan melihatnya sebagai tipe publik.

Apakah nama dan field-nya masuk akal bagi consumer?

Jika tidak, mungkin schema tersebut hanya detail internal spec dan tidak layak menjadi reusable model publik.

### 5.4 Apakah Schema Ini Akan Dipakai Lebih Dari Sekali Dengan Semantik Yang Sama?

Reuse untuk satu penggunaan kadang tetap masuk akal jika schema besar dan ingin modular. Tetapi jangan membuat components hanya karena ingin “rapi”.

Local inline schema kadang lebih jujur.

---

## 6. Inline Schema vs Component Schema

Tidak semua schema harus masuk `components`.

### 6.1 Inline Schema Cocok Untuk

1. Bentuk yang sangat lokal.
2. Struktur kecil yang tidak punya nama domain penting.
3. Response envelope khusus satu operation.
4. Eksperimen API yang belum stabil.
5. Payload yang tidak ingin dipakai ulang.

Contoh inline sederhana:

```yaml
responses:
  '200':
    description: Health status
    content:
      application/json:
        schema:
          type: object
          required: [status]
          properties:
            status:
              type: string
              enum: [UP, DOWN]
```

Tidak perlu membuat `HealthStatusResponse` jika hanya dipakai sekali dan jelas.

### 6.2 Component Schema Cocok Untuk

1. Model domain/API yang stabil.
2. Error standard.
3. Pagination metadata.
4. Reusable identifiers.
5. Value objects.
6. Shared response item shapes.
7. Request/response model yang dipakai lintas operation dengan makna sama.
8. Security-sensitive shape yang perlu standardisasi.

Contoh:

```yaml
components:
  schemas:
    PageMetadata:
      type: object
      required:
        - limit
        - hasNext
      properties:
        limit:
          type: integer
          minimum: 1
          maximum: 500
        nextCursor:
          type: string
        hasNext:
          type: boolean
```

---

## 7. Reusable Responses

`components.responses` dipakai untuk response object yang sering muncul.

Contoh:

```yaml
components:
  responses:
    Unauthorized:
      description: Authentication is missing or invalid
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
          examples:
            missingToken:
              summary: Missing bearer token
              value:
                type: https://api.example.com/problems/authentication-required
                title: Authentication required
                status: 401
                detail: A valid bearer token is required.

    Forbidden:
      description: Caller is authenticated but not allowed to perform this operation
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
```

Dipakai dari operation:

```yaml
responses:
  '401':
    $ref: '#/components/responses/Unauthorized'
  '403':
    $ref: '#/components/responses/Forbidden'
```

Ini bagus jika organisasi punya error model yang konsisten.

Namun hati-hati: reusable response terlalu generic bisa menutupi konteks.

### 7.1 Response Reuse Yang Buruk

```yaml
components:
  responses:
    Error:
      description: Error
```

Ini tidak membantu.

Atau:

```yaml
components:
  responses:
    BadRequest:
      description: Bad request
      content:
        application/json:
          schema:
            type: object
```

Masalah:

- Tidak ada shape jelas.
- Tidak ada contoh.
- Tidak membedakan validation error, malformed JSON, invalid parameter, business rule error.

### 7.2 Response Reuse Yang Lebih Baik

```yaml
components:
  responses:
    ValidationFailed:
      description: The request was syntactically valid but failed validation rules
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ValidationProblemDetails'
          examples:
            invalidEmail:
              summary: Invalid email value
              value:
                type: https://api.example.com/problems/validation-failed
                title: Validation failed
                status: 422
                detail: One or more fields failed validation.
                errors:
                  - field: email
                    code: EMAIL_INVALID
                    message: Email must be a valid address.
```

Lebih spesifik, lebih executable, lebih berguna untuk consumer.

---

## 8. Reusable Parameters

Reusable parameters sangat berguna untuk:

- pagination,
- sorting,
- filtering standar,
- correlation ID,
- tenant ID,
- API version header,
- idempotency key,
- path IDs yang konsisten.

Contoh:

```yaml
components:
  parameters:
    LimitQueryParam:
      name: limit
      in: query
      required: false
      description: Maximum number of items to return.
      schema:
        type: integer
        minimum: 1
        maximum: 500
        default: 50

    CursorQueryParam:
      name: cursor
      in: query
      required: false
      description: Cursor returned by a previous list response.
      schema:
        type: string

    CorrelationIdHeader:
      name: X-Correlation-Id
      in: header
      required: false
      description: Optional caller-provided correlation identifier for tracing.
      schema:
        type: string
        minLength: 1
        maxLength: 128
```

Dipakai:

```yaml
parameters:
  - $ref: '#/components/parameters/LimitQueryParam'
  - $ref: '#/components/parameters/CursorQueryParam'
```

### 8.1 Kapan Parameter Jangan Di-Reuse

Jangan reuse parameter hanya karena namanya sama.

Contoh `status`:

```text
GET /cases?status=OPEN
GET /payments?status=SETTLED
GET /users?status=ACTIVE
```

Ketiganya punya nama query parameter `status`, tetapi enum dan maknanya berbeda.

Jangan buat:

```yaml
components:
  parameters:
    StatusQueryParam:
      name: status
      in: query
      schema:
        type: string
```

Lebih baik:

```yaml
components:
  parameters:
    CaseStatusQueryParam:
      name: status
      in: query
      schema:
        $ref: '#/components/schemas/CaseStatus'

    PaymentStatusQueryParam:
      name: status
      in: query
      schema:
        $ref: '#/components/schemas/PaymentStatus'
```

Nama wire sama, konsep berbeda.

---

## 9. Reusable Request Bodies

`components.requestBodies` berguna jika body yang sama memang dipakai oleh banyak operation.

Contoh legitimate:

```yaml
components:
  requestBodies:
    CreateEvidenceRequestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/CreateEvidenceRequest'
```

Namun sering kali request body lebih baik direferensikan langsung dari schema, bukan dibuat sebagai reusable request body, kecuali media type, examples, dan encoding juga ingin dipakai bersama.

### 9.1 Gunakan `requestBodies` Saat Reuse Mencakup Media Type Semantics

Contoh multipart:

```yaml
components:
  requestBodies:
    EvidenceUploadMultipartBody:
      required: true
      content:
        multipart/form-data:
          schema:
            type: object
            required:
              - file
              - metadata
            properties:
              file:
                type: string
                contentEncoding: binary
              metadata:
                $ref: '#/components/schemas/EvidenceUploadMetadata'
          encoding:
            metadata:
              contentType: application/json
```

Di sini request body bukan hanya schema; ada media type dan encoding semantics. Layak masuk `requestBodies` jika dipakai berulang.

### 9.2 Jangan Gunakan Request Body Reuse Untuk Menyamarkan Perbedaan Operation

Buruk:

```yaml
components:
  requestBodies:
    GenericCommand:
      content:
        application/json:
          schema:
            type: object
            additionalProperties: true
```

Ini menghilangkan manfaat OpenAPI.

---

## 10. Reusable Headers

`components.headers` berguna untuk response headers yang konsisten.

Contoh:

```yaml
components:
  headers:
    RateLimitLimit:
      description: Maximum number of requests allowed in the current window.
      schema:
        type: integer
        minimum: 0

    RateLimitRemaining:
      description: Remaining number of requests in the current window.
      schema:
        type: integer
        minimum: 0

    RetryAfter:
      description: Time to wait before retrying the request.
      schema:
        oneOf:
          - type: integer
            minimum: 0
          - type: string
```

Dipakai di response:

```yaml
responses:
  '429':
    description: Too many requests
    headers:
      Retry-After:
        $ref: '#/components/headers/RetryAfter'
```

Catatan penting: header di OpenAPI response tidak memakai `in: header`; itu hanya untuk Parameter Object. Header Object punya struktur mirip parameter tetapi konteksnya berbeda.

---

## 11. Reusable Examples

Examples bisa berada di beberapa tempat:

- inline pada media type,
- inline pada parameter,
- dalam `components.examples`,
- dalam schema `example` atau examples tergantung versi/tooling.

Reusable examples berguna jika contoh yang sama dipakai dalam docs, mocks, tests, dan onboarding.

Contoh:

```yaml
components:
  examples:
    CustomerDetailActive:
      summary: Active customer
      value:
        id: 1fbad8d2-9e02-4ec7-8801-25eeb9c24355
        name: Jane Doe
        email: jane.doe@example.com
        status: ACTIVE
        createdAt: '2026-01-12T10:15:30Z'
```

Dipakai:

```yaml
content:
  application/json:
    schema:
      $ref: '#/components/schemas/CustomerDetailResponse'
    examples:
      active:
        $ref: '#/components/examples/CustomerDetailActive'
```

### 11.1 Example Harus Valid

Example yang invalid lebih berbahaya daripada tidak ada example.

Kenapa?

- Consumer copy-paste example.
- Mock server bisa menghasilkan payload salah.
- Test fixture jadi misleading.
- Generated docs tampak benar padahal kontraknya salah.

Rule:

> Treat examples as executable documentation.

Jika CI tidak memvalidasi examples terhadap schema, example akan membusuk.

---

## 12. Reusable Security Schemes

`components.securitySchemes` adalah tempat mendefinisikan authentication/security mechanism.

Contoh bearer token:

```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

Dipakai global:

```yaml
security:
  - BearerAuth: []
```

Atau operation-level:

```yaml
paths:
  /public-status:
    get:
      operationId: getPublicStatus
      security: []
      responses:
        '200':
          description: Public status
```

Security scheme reuse biasanya baik karena auth mechanism memang lintas API. Namun jangan salah kaprah: OpenAPI security scheme hanya mendeskripsikan mekanisme autentikasi/otorisasi pada level kontrak. Ia tidak membuktikan policy enforcement benar.

### 12.1 Scope Reuse

OAuth2 scopes bisa dideskripsikan:

```yaml
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/oauth/token
          scopes:
            cases:read: Read cases
            cases:write: Create and update cases
            evidence:write: Upload evidence
```

Operation:

```yaml
security:
  - OAuth2:
      - cases:read
```

Ini bagus, tetapi scopes harus stabil dan jelas. Jangan jadikan scope sebagai label UI atau nama role internal yang sering berubah.

---

## 13. Reusable Links, Callbacks, and Path Items

Bagian ini lebih advanced, dan akan dibahas lebih dalam di part async/hypermedia. Namun secara components, penting memahami bahwa reuse bukan hanya schema.

### 13.1 Links

Links mendeskripsikan hubungan dari satu response ke operation lain.

Contoh: setelah membuat customer, consumer bisa mengambil detail customer.

```yaml
components:
  links:
    GetCustomerById:
      operationId: getCustomerById
      parameters:
        customerId: '$response.body#/id'
```

Dipakai di response:

```yaml
responses:
  '201':
    description: Customer created
    links:
      GetCustomerById:
        $ref: '#/components/links/GetCustomerById'
```

### 13.2 Callbacks

Callbacks berguna untuk API yang memanggil balik URL consumer.

```yaml
components:
  callbacks:
    CaseDecisionCallback:
      '{$request.body#/callbackUrl}':
        post:
          operationId: notifyCaseDecision
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CaseDecisionNotification'
          responses:
            '204':
              description: Notification accepted
```

### 13.3 Path Items

Reusable `pathItems` bisa berguna untuk standard path fragments atau shared patterns, tetapi harus digunakan hati-hati. Terlalu banyak path item reuse bisa membuat spec sulit dibaca.

---

## 14. Naming Strategy Untuk Components

Nama component adalah bagian dari public contract, terutama jika digunakan untuk code generation.

Nama buruk menghasilkan generated code buruk.

### 14.1 Nama Yang Buruk

```yaml
components:
  schemas:
    Response:
    Request:
    Data:
    Item:
    Object:
    Base:
    Common:
    ApiResponse:
    Result:
    Model1:
```

Masalah:

- Tidak punya makna domain.
- Bentrok dengan class/framework names.
- Generated SDK sulit dibaca.
- Review tidak bisa memahami intent.

### 14.2 Nama Yang Baik

Gunakan pola:

```text
<DomainConcept><Role>
<DomainConcept><LifecycleStage><Role>
<OperationIntent><Request|Response>
<ValueObjectName>
<ErrorType>ProblemDetails
```

Contoh:

```yaml
components:
  schemas:
    CaseSummaryResponse:
    CaseDetailResponse:
    CreateCaseRequest:
    UpdateCaseAssigneeRequest:
    EvidenceUploadMetadata:
    EnforcementActionDecision:
    ValidationProblemDetails:
    ConflictProblemDetails:
    CursorPageMetadata:
    MoneyAmount:
```

### 14.3 Suffix Bukan Sekadar Gaya

Suffix membantu membedakan role:

- `Request`
- `Response`
- `Summary`
- `Detail`
- `Metadata`
- `Command`
- `Event`
- `Notification`
- `ProblemDetails`

Contoh:

```text
Case
```

terlalu ambigu.

```text
CaseDetailResponse
```

lebih jelas.

---

## 15. Component Granularity

Granularity adalah keputusan seberapa kecil/besar schema reusable.

### 15.1 Terlalu Kasar

```yaml
CaseDetailResponse:
  type: object
  properties:
    id:
      type: string
    complainantName:
      type: string
    respondentName:
      type: string
    assignedOfficerName:
      type: string
    decisionOutcome:
      type: string
    penaltyAmount:
      type: number
    penaltyCurrency:
      type: string
```

Semua flat. Sulit memahami struktur domain.

### 15.2 Terlalu Halus

```yaml
CaseIdWrapper:
OfficerNameWrapper:
PenaltyAmountWrapper:
PenaltyCurrencyWrapper:
```

Terlalu banyak wrapper tanpa manfaat.

### 15.3 Granularity Yang Sehat

```yaml
CaseDetailResponse:
  type: object
  required:
    - id
    - parties
    - assignment
    - status
  properties:
    id:
      type: string
      format: uuid
    status:
      $ref: '#/components/schemas/CaseStatus'
    parties:
      $ref: '#/components/schemas/CaseParties'
    assignment:
      $ref: '#/components/schemas/CaseAssignmentSummary'
    decision:
      $ref: '#/components/schemas/CaseDecisionSummary'
```

Ini membantu karena sub-object punya konsep domain nyata:

- parties,
- assignment,
- decision.

Rule:

> Extract component when the extracted thing has independent meaning, independent constraints, or independent evolution pressure.

---

## 16. Bounded Context Dalam Components

Pada API besar, `components.schemas` bisa menjadi “global namespace chaos”. Semua tim menaruh schema di satu tempat, lalu reuse tanpa sadar lintas bounded context.

Contoh buruk:

```yaml
components:
  schemas:
    User:
    Account:
    Status:
    Type:
    Address:
    Comment:
    Document:
```

Masalah:

- `Status` status apa?
- `Type` type apa?
- `Document` di context evidence, legal notice, identity document, atau attachment?
- `Account` akun user, billing account, atau regulated entity account?

Lebih baik gunakan nama context-aware:

```yaml
components:
  schemas:
    IdentityDocumentSummary:
    EvidenceDocumentMetadata:
    LegalNoticeDocument:
    BillingAccountSummary:
    UserAccountProfile:
    EnforcementCaseStatus:
```

OpenAPI tidak punya namespace schema native seperti Java package. Karena itu, nama schema harus membawa konteks.

### 16.1 Simulasi Namespace Dengan Naming

```yaml
components:
  schemas:
    Cases_CaseSummary:
    Cases_CaseDetail:
    Evidence_EvidenceSummary:
    Evidence_EvidenceUploadRequest:
```

Ini kadang dipakai di organisasi besar, tetapi hati-hati karena generated code bisa menjadi kurang natural. Alternatifnya, pecah spec per API/bounded context, lalu bundle saat publish.

---

## 17. Shared Components Across Services

Dalam microservices/platform environment, muncul godaan membuat shared OpenAPI components package:

```text
api-standards/components.yaml
```

Isinya:

- `ProblemDetails`
- `ValidationProblemDetails`
- `CorrelationIdHeader`
- `LimitQueryParam`
- `CursorQueryParam`
- `PageMetadata`
- `BearerAuth`

Ini bisa sangat berguna.

Tetapi jangan taruh semua domain schema di shared package.

### 17.1 Yang Layak Shared Lintas Service

Biasanya:

1. Error model.
2. Pagination model.
3. Tracing/correlation headers.
4. Security schemes.
5. Common scalar/value constraints jika sangat stabil.
6. Metadata envelope yang benar-benar standar.
7. Standard problem types.

### 17.2 Yang Biasanya Tidak Layak Shared Lintas Service

1. Domain aggregate schema.
2. Internal enum bisnis.
3. Request/response DTO spesifik service.
4. Workflow state machine spesifik domain.
5. Persistence-derived model.

### 17.3 Risiko Shared Components

Shared components menciptakan dependency.

Jika 20 service memakai `CommonPageResponse`, perubahan kecil bisa berdampak ke semua service.

Maka shared components perlu:

- versioning,
- changelog,
- compatibility policy,
- semantic ownership,
- CI validation,
- deprecation process.

Kalau tidak, shared components menjadi distributed coupling mechanism.

---

## 18. `$ref` Discipline

`components` hampir selalu dipakai melalui `$ref`.

Contoh:

```yaml
schema:
  $ref: '#/components/schemas/CustomerDetailResponse'
```

Hal penting:

> `$ref` means “use that object here”, not “copy some fields and tweak later”.

Dalam banyak kasus, ketika object adalah Reference Object, sibling fields bisa diabaikan atau punya aturan terbatas tergantung versi/jenis object. Praktiknya, jangan menulis seperti ini:

```yaml
schema:
  $ref: '#/components/schemas/CustomerDetailResponse'
  description: Special version for admin
```

Jika butuh variasi, buat schema baru atau gunakan composition dengan sadar.

### 18.1 Hindari `$ref` Yang Terlalu Dalam

Buruk:

```yaml
CaseResponse
  -> CaseCore
    -> CaseBase
      -> CaseShared
        -> EntityBase
          -> Timestamped
```

Ini membuat spec sulit dibaca dan sulit dipahami oleh reviewer.

OpenAPI bukan object-oriented inheritance tree.

Gunakan `$ref` untuk clarity, bukan untuk membangun hierarki rumit.

---

## 19. `allOf` Untuk Reuse: Berguna Tapi Berbahaya

Banyak engineer memakai `allOf` untuk “extend schema” seperti inheritance:

```yaml
CustomerDetailResponse:
  allOf:
    - $ref: '#/components/schemas/CustomerSummaryResponse'
    - type: object
      properties:
        email:
          type: string
          format: email
        createdAt:
          type: string
          format: date-time
```

Ini bisa valid, tetapi mental model-nya harus tepat: `allOf` berarti instance harus valid terhadap semua schema, bukan class inheritance.

Risiko:

- required field interaction membingungkan,
- generated code bisa menghasilkan inheritance yang tidak diinginkan,
- validation semantics bisa tidak sesuai harapan,
- perubahan parent schema bisa memecahkan child schema.

Untuk detail mendalam, composition akan dibahas di Part 010. Di Part 008, cukup pegang rule ini:

> Jangan gunakan `allOf` hanya supaya schema terlihat DRY. Gunakan jika composition memang merepresentasikan constraint yang benar.

Kadang explicit duplicate field lebih aman daripada inheritance-style reuse.

---

## 20. Reuse vs Evolvability

Reuse mengurangi duplikasi, tetapi menambah coupling.

Duplikasi menambah maintenance cost, tetapi memberi kebebasan evolusi.

Trade-off ini harus eksplisit.

### 20.1 Matrix Keputusan

| Situasi | Rekomendasi |
|---|---|
| Field sama, makna sama, constraint sama, evolusi sama | Reuse |
| Field sama, makna mirip, constraint beda | Jangan reuse langsung |
| Field sama hari ini, roadmap berbeda | Pisahkan |
| Error model organisasi | Reuse |
| Pagination standard organisasi | Reuse |
| Request create dan response detail | Biasanya pisahkan |
| Summary dan detail response | Pisahkan atau compose sangat hati-hati |
| Internal enum volatile | Jangan shared luas |
| Identifier value object stabil | Reuse boleh |

### 20.2 Pertanyaan Review

Sebelum approve reuse, tanyakan:

1. Apakah dua usage ini punya lifecycle perubahan yang sama?
2. Apakah consumer akan menganggap ini tipe yang sama?
3. Jika satu endpoint butuh field baru, apakah endpoint lain juga butuh?
4. Jika satu endpoint butuh constraint lebih ketat, apakah endpoint lain ikut?
5. Apakah generated SDK naming tetap masuk akal?
6. Apakah reuse ini mengurangi clarity?
7. Apakah ada risiko security/data exposure?

Jika jawaban banyak yang tidak jelas, pisahkan.

---

## 21. Java Mapping: Components vs Classes

Java engineer sering ingin membuat mapping 1:1:

```text
components.schemas.CustomerDetailResponse
    -> CustomerDetailResponse.java
```

Ini wajar, terutama kalau pakai OpenAPI Generator.

Tetapi jangan lupa: OpenAPI schema adalah **wire contract**, bukan domain model.

Layer yang sehat:

```text
HTTP JSON payload
    <-> OpenAPI schema / generated API DTO
    <-> controller boundary
    <-> application command/query model
    <-> domain model
    <-> persistence model
```

Jangan langsung:

```text
OpenAPI schema == JPA entity == domain aggregate == generated client model
```

Itu menggabungkan empat alasan perubahan berbeda:

1. API consumer contract.
2. Domain behavior.
3. Persistence structure.
4. Client SDK ergonomics.

### 21.1 Generated Models Sebagai Boundary DTO

Jika menggunakan generator, generated class sebaiknya hidup di boundary layer:

```text
com.example.api.generated.model
com.example.api.generated.controller
```

Lalu map ke application model:

```java
public CreateCaseCommand toCommand(CreateCaseRequest request) {
    return new CreateCaseCommand(
        request.getComplainantId(),
        request.getAllegationSummary(),
        request.getReceivedAt()
    );
}
```

Jangan biarkan domain core bergantung pada generated OpenAPI model.

### 21.2 Springdoc/Annotation Generated Components

Jika memakai code-first dengan Spring annotations, components sering muncul dari DTO classes.

Masalah yang umum:

- DTO reuse di Java otomatis menjadi schema reuse di OpenAPI.
- Jackson annotations memengaruhi contract tanpa review.
- Bean Validation constraints tercermin sebagian tetapi tidak semua semantics tertangkap.
- Generic wrapper menghasilkan schema buruk.
- Lombok/records/inheritance bisa menghasilkan schema yang tidak sesuai intent.

Karena itu, walaupun code-first, tetap review output OpenAPI sebagai artifact kontrak.

---

## 22. Anti-Pattern: `ApiResponse<T>` Everywhere

Banyak Java backend punya wrapper:

```java
class ApiResponse<T> {
    boolean success;
    String message;
    T data;
}
```

Lalu semua endpoint mengembalikan:

```json
{
  "success": true,
  "message": "OK",
  "data": { ... }
}
```

Di OpenAPI menjadi:

```yaml
components:
  schemas:
    ApiResponseCustomer:
      type: object
      properties:
        success:
          type: boolean
        message:
          type: string
        data:
          $ref: '#/components/schemas/CustomerDetailResponse'
```

Masalah:

1. HTTP status code jadi kurang bermakna.
2. Error dan success sering dicampur dalam shape yang sama.
3. Consumer harus cek `success` selain status code.
4. Generated clients mendapat banyak wrapper noise.
5. Streaming/file response sulit masuk pola ini.
6. Pagination envelope bercampur dengan generic wrapper.

Bukan berarti envelope selalu salah. Tetapi generic `ApiResponse<T>` sering menyembunyikan contract yang buruk.

Lebih baik desain response berdasarkan semantic kebutuhan:

```yaml
CustomerDetailResponse:
  type: object
  required: [id, name, status]
  properties:
    id:
      type: string
      format: uuid
    name:
      type: string
    status:
      $ref: '#/components/schemas/CustomerStatus'
```

Untuk list:

```yaml
CustomerListResponse:
  type: object
  required: [items, page]
  properties:
    items:
      type: array
      items:
        $ref: '#/components/schemas/CustomerSummaryResponse'
    page:
      $ref: '#/components/schemas/CursorPageMetadata'
```

Untuk error:

```yaml
ProblemDetails:
  type: object
  required: [type, title, status]
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

---

## 23. Anti-Pattern: `BaseDto`

Di Java, common base classes terasa nyaman:

```java
class BaseDto {
    UUID id;
    Instant createdAt;
    Instant updatedAt;
}
```

Lalu semua DTO extend itu.

Dalam OpenAPI, ini sering muncul sebagai:

```yaml
BaseDto:
  type: object
  properties:
    id:
      type: string
      format: uuid
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
```

Kemudian:

```yaml
CustomerResponse:
  allOf:
    - $ref: '#/components/schemas/BaseDto'
    - type: object
      properties:
        name:
          type: string
```

Masalah:

- Tidak semua resources punya lifecycle timestamp yang sama.
- `updatedAt` bisa tidak relevan untuk immutable resource.
- `id` bisa bukan UUID untuk semua resource.
- Audit fields bisa punya security implications.
- Generated SDK inheritance bisa mengganggu ergonomics.

Lebih baik explicit pada schema yang memang punya fields tersebut, atau buat value object domain yang benar-benar bermakna:

```yaml
ResourceTimestamps:
  type: object
  required: [createdAt]
  properties:
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
```

Tetap gunakan dengan sadar, bukan default inheritance.

---

## 24. Anti-Pattern: Mega Shared Enums

Enum tampak reusable, tetapi sangat berisiko.

Contoh buruk:

```yaml
Status:
  type: string
  enum:
    - ACTIVE
    - INACTIVE
    - PENDING
    - CLOSED
    - CANCELLED
```

Dipakai untuk user, case, payment, subscription, evidence, appeal.

Masalah:

- `CLOSED` untuk case berbeda dengan `CLOSED` untuk account.
- `PENDING` di payment berbeda dengan `PENDING` di investigation.
- Menambah enum untuk satu domain memengaruhi consumer domain lain.
- Generated SDK menghasilkan `Status` yang terlalu generic.

Lebih baik:

```yaml
UserAccountStatus:
  type: string
  enum: [ACTIVE, SUSPENDED, CLOSED]

EnforcementCaseStatus:
  type: string
  enum: [DRAFT, SUBMITTED, UNDER_REVIEW, DECIDED, CLOSED]

PaymentStatus:
  type: string
  enum: [PENDING, SETTLED, FAILED, REFUNDED]
```

Enum harus bounded-context aware.

---

## 25. Anti-Pattern: Components Sebagai Tempat Sampah

Gejala:

```yaml
components:
  schemas:
    CommonResponse:
    Error:
    Error2:
    NewError:
    User:
    UserDTO:
    UserResponse:
    UserResponseV2:
    UserModel:
    UserModelNew:
    TmpCase:
    CaseOld:
```

Ini biasanya terjadi karena tidak ada ownership dan review.

Konsekuensi:

- Tidak ada yang tahu schema mana masih dipakai.
- Refactor jadi menakutkan.
- Generated SDK penuh model sampah.
- API catalog terlihat tidak profesional.
- Governance sulit karena vocabulary kacau.

Solusi:

1. Naming convention.
2. Lint rule.
3. Unused component detection.
4. Ownership metadata via extensions.
5. Review checklist.
6. Deprecation policy.

Contoh extension:

```yaml
components:
  schemas:
    CaseDetailResponse:
      x-owner-team: enforcement-platform
      x-lifecycle: stable
      x-data-classification: confidential
      type: object
      properties:
        id:
          type: string
          format: uuid
```

Extensions harus dipakai hati-hati, tetapi sangat berguna untuk governance.

---

## 26. Organisasi File Untuk Components

Untuk spec kecil, single file cukup:

```text
openapi.yaml
```

Untuk spec besar, multi-file lebih sehat:

```text
openapi/
  openapi.yaml
  paths/
    cases.yaml
    evidence.yaml
    decisions.yaml
  components/
    schemas/
      case.yaml
      evidence.yaml
      problem.yaml
      pagination.yaml
    parameters/
      pagination.yaml
      tracing.yaml
    responses/
      errors.yaml
    security-schemes.yaml
```

Kemudian bundle untuk publish:

```text
dist/openapi.yaml
```

### 26.1 Prinsip Struktur

Struktur file harus membantu review.

Jika reviewer ingin menilai perubahan error model, ia harus tahu file mana yang dilihat.

Jika reviewer ingin menilai perubahan case schema, ia tidak boleh harus scroll 10.000 baris.

### 26.2 Hindari Fragmentasi Berlebihan

Terlalu banyak file kecil juga buruk:

```text
schemas/
  case-id.yaml
  case-status.yaml
  case-title.yaml
  case-created-at.yaml
```

Gunakan modularity pada level konsep, bukan tiap field.

---

## 27. Components dan API Review

Saat review OpenAPI PR, `components` changes harus diperlakukan serius.

Checklist review:

### 27.1 Untuk Schema Baru

1. Apakah namanya jelas?
2. Apakah role-nya jelas: request, response, summary, detail, metadata, problem?
3. Apakah schema ini terlalu generic?
4. Apakah ini bocor dari entity/internal model?
5. Apakah required fields benar?
6. Apakah nullable/optional semantics benar?
7. Apakah examples tersedia jika schema penting?
8. Apakah schema ini akan dipakai ulang dengan makna sama?
9. Apakah security/data classification jelas?
10. Apakah generated SDK name bagus?

### 27.2 Untuk Schema Modification

1. Apakah perubahan breaking?
2. Siapa consumer yang terdampak?
3. Apakah field baru optional atau required?
4. Apakah enum berubah?
5. Apakah constraint diperketat?
6. Apakah format berubah?
7. Apakah meaning berubah tanpa shape berubah?
8. Apakah examples diperbarui?
9. Apakah tests diperbarui?
10. Apakah changelog perlu update?

### 27.3 Untuk Shared Component

1. Berapa operation yang memakai component ini?
2. Apakah semua usage masih benar?
3. Apakah perlu versioning/deprecation?
4. Apakah ada service lain yang mengimpor component ini?
5. Apakah perubahan perlu approval lebih luas?

---

## 28. Components dan Breaking Changes

Perubahan pada component bisa berdampak luas karena banyak operation mereferensikannya.

Contoh:

```yaml
CustomerSummaryResponse:
  required:
    - id
    - displayName
```

Jika ditambah:

```yaml
required:
  - id
  - displayName
  - status
```

Pada response, ini biasanya additive untuk server jika server memang selalu mengirim `status`, tetapi bisa menjadi masalah untuk mock, generated models, tests, dan consumers yang melakukan strict validation.

Pada request schema, menambah required field hampir selalu breaking.

### 28.1 Perubahan Component Harus Dilihat Dari Semua Reference Sites

Satu schema bisa dipakai di:

- request body,
- response body,
- callback payload,
- example,
- link parameter,
- generated SDK model.

Makna breaking change bergantung pada konteks penggunaan.

Karena itu, komponen reusable perlu tooling diff yang memahami reference graph.

---

## 29. Reference Graph Thinking

Untuk spec kecil, kita bisa lihat `$ref` manual. Untuk spec besar, pikirkan seperti graph.

```text
CustomerStatus
  <- CustomerDetailResponse
  <- CustomerSummaryResponse
  <- CustomerListResponse
  <- GET /customers
  <- GET /customers/{customerId}
```

Jika `CustomerStatus` berubah, dampaknya menyebar.

Review pertanyaan:

> Apa blast radius perubahan component ini?

Top-tier OpenAPI workflow biasanya punya automation untuk:

- detect unused components,
- list references,
- detect circular references,
- detect breaking diffs,
- validate examples,
- generate impact reports.

---

## 30. Practical Design Exercise: Case Management Components

Bayangkan kita mendesain enforcement case API.

### 30.1 Bad Version

```yaml
components:
  schemas:
    Case:
      type: object
      properties:
        id:
          type: string
        status:
          type: string
        user:
          type: string
        data:
          type: object
        created:
          type: string
        updated:
          type: string
```

Masalah:

- `user` siapa? complainant, officer, respondent?
- `data` apa?
- `status` enum tidak jelas.
- timestamps tidak punya format.
- request/response/lifecycle tidak dibedakan.
- tidak ada regulated/audit semantics.

### 30.2 Better Version

```yaml
components:
  schemas:
    EnforcementCaseStatus:
      type: string
      description: Lifecycle state of an enforcement case visible to API consumers.
      enum:
        - DRAFT
        - SUBMITTED
        - TRIAGE
        - UNDER_INVESTIGATION
        - DECISION_PENDING
        - DECIDED
        - CLOSED

    EnforcementCaseSummaryResponse:
      type: object
      required:
        - id
        - referenceNumber
        - status
        - createdAt
      properties:
        id:
          type: string
          format: uuid
        referenceNumber:
          type: string
          example: CASE-2026-000184
        status:
          $ref: '#/components/schemas/EnforcementCaseStatus'
        createdAt:
          type: string
          format: date-time

    EnforcementCaseDetailResponse:
      type: object
      required:
        - id
        - referenceNumber
        - status
        - parties
        - createdAt
      properties:
        id:
          type: string
          format: uuid
        referenceNumber:
          type: string
        status:
          $ref: '#/components/schemas/EnforcementCaseStatus'
        parties:
          $ref: '#/components/schemas/CasePartiesSummary'
        assignment:
          $ref: '#/components/schemas/CaseAssignmentSummary'
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time

    CreateEnforcementCaseRequest:
      type: object
      required:
        - complainant
        - allegationSummary
      properties:
        complainant:
          $ref: '#/components/schemas/CreateComplainantInput'
        allegationSummary:
          type: string
          minLength: 20
          maxLength: 4000
```

Lebih panjang, tetapi makna jauh lebih kuat.

---

## 31. Components Untuk Regulatory-Grade API

Dalam sistem regulated, components membantu menjaga standar:

1. Error shape konsisten.
2. Data classification terdokumentasi.
3. Audit response shape stabil.
4. Sensitive fields diberi metadata.
5. Lifecycle state jelas.
6. Decision/action payload tidak ambigu.
7. Evidence metadata konsisten.
8. Redaction/disclosure semantics eksplisit.

Contoh extension:

```yaml
EvidenceMetadataResponse:
  x-data-classification: restricted
  x-retention-category: enforcement-evidence
  type: object
  required:
    - id
    - filename
    - contentType
    - uploadedAt
  properties:
    id:
      type: string
      format: uuid
    filename:
      type: string
    contentType:
      type: string
    uploadedAt:
      type: string
      format: date-time
```

OpenAPI extension `x-*` bukan standar enforcement by itself, tetapi bisa dipakai oleh tooling internal untuk linting, cataloging, risk review, dan audit traceability.

---

## 32. Component Lifecycle

Component juga punya lifecycle.

Status yang berguna:

```text
experimental -> stable -> deprecated -> removed
```

Dalam OpenAPI, schema property dan operation bisa diberi `deprecated`, tetapi governance sering butuh metadata tambahan:

```yaml
OldCaseStatus:
  deprecated: true
  x-deprecation-date: '2026-09-01'
  x-removal-not-before: '2027-03-01'
  x-replacement: '#/components/schemas/EnforcementCaseStatus'
  type: string
  enum: [OPEN, CLOSED]
```

Tooling bisa memanfaatkan metadata ini untuk:

- API catalog warning,
- generated docs warning,
- consumer migration report,
- CI rule.

---

## 33. Review: Good Components Smell

Komponen yang sehat biasanya punya ciri:

1. Namanya domain-specific.
2. Role-nya jelas.
3. Constraints-nya eksplisit.
4. Examples valid.
5. Tidak membocorkan entity/persistence model.
6. Tidak terlalu generic.
7. Tidak terlalu fragmented.
8. Reference graph masuk akal.
9. Cocok untuk generated SDK.
10. Evolusi masa depan bisa diprediksi.
11. Security/data sensitivity dipikirkan.
12. Tidak dipakai ulang hanya karena bentuk mirip.

---

## 34. Review: Bad Components Smell

Komponen yang bermasalah biasanya punya ciri:

1. Nama seperti `Common`, `Base`, `Data`, `Object`, `Payload`.
2. Dipakai di request dan response sekaligus tanpa alasan kuat.
3. Dipakai lintas bounded context.
4. Punya banyak optional field karena harus cocok untuk semua endpoint.
5. Punya enum terlalu luas.
6. Mengandung field internal.
7. Tidak punya required fields yang jelas.
8. Tidak punya examples.
9. Tidak diketahui owner-nya.
10. Banyak schema lama tidak terpakai.
11. Banyak `V2`, `New`, `Old`, `Temp`.
12. Menghasilkan SDK model yang memalukan.

---

## 35. Practical Checklist Untuk Membuat Components

Saat membuat component baru, gunakan langkah ini:

### Step 1 — Beri Nama Konsep

Tulis dalam kalimat:

```text
Schema ini merepresentasikan ____ untuk consumer ____ pada konteks ____.
```

Jika tidak bisa mengisi kalimat itu, nama/konsep belum matang.

### Step 2 — Tentukan Role

Apakah ini:

- request,
- response,
- summary,
- detail,
- metadata,
- error,
- command,
- notification,
- value object?

### Step 3 — Tentukan Scope Reuse

Apakah component ini:

- operation-local,
- API-local,
- service-local,
- platform-wide,
- public standard?

Semakin luas scope, semakin ketat governance.

### Step 4 — Tentukan Evolution Pressure

Apakah component ini sering berubah?

Jika sering berubah, jangan terlalu banyak reuse.

### Step 5 — Tentukan Consumer Impact

Apakah generated client akan mengekspos type ini?

Apakah nama dan field-nya ergonomic?

### Step 6 — Tambahkan Constraints

Jangan hanya `type: string` jika ada constraint domain.

### Step 7 — Tambahkan Examples

Untuk schema penting, berikan example valid.

### Step 8 — Jalankan Validation/Linting

Pastikan:

- OpenAPI valid,
- examples valid,
- no unused components,
- no circular references yang tidak disengaja,
- naming rule terpenuhi.

---

## 36. Mini Case Study: Refactoring Bad Components

### 36.1 Initial Spec

```yaml
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: string
        message:
          type: string
        data:
          type: object

    User:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        email:
          type: string
        password:
          type: string
        createdAt:
          type: string

    Status:
      type: string
      enum: [ACTIVE, INACTIVE, PENDING, CLOSED]
```

### 36.2 Problems

1. `ApiResponse.data` tidak typed.
2. `User.password` muncul di schema publik.
3. `createdAt` tidak punya `format`.
4. `Status` terlalu generic.
5. Request/response tidak dipisah.
6. Error tidak menggunakan shape jelas.

### 36.3 Refactored Spec

```yaml
components:
  schemas:
    CreateUserRequest:
      type: object
      required: [name, email, password]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 200
        email:
          type: string
          format: email
        password:
          type: string
          format: password
          minLength: 12
          writeOnly: true

    UserAccountStatus:
      type: string
      enum: [ACTIVE, SUSPENDED, CLOSED]

    UserDetailResponse:
      type: object
      required: [id, name, email, status, createdAt]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        email:
          type: string
          format: email
        status:
          $ref: '#/components/schemas/UserAccountStatus'
        createdAt:
          type: string
          format: date-time

    ProblemDetails:
      type: object
      required: [type, title, status]
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
          minimum: 100
          maximum: 599
        detail:
          type: string
        instance:
          type: string
          format: uri
```

Hasil:

- Contract lebih aman.
- Generated SDK lebih jelas.
- Password tidak muncul di response.
- Error standard bisa di-reuse.
- Status punya bounded context.

---

## 37. What Top 1% Engineers Do Differently

Engineer biasa:

```text
Ada duplikasi field -> buat common schema.
```

Engineer kuat:

```text
Apakah ini konsep yang sama? Apakah lifecycle evolusinya sama? Apakah consumer harus melihat ini sebagai tipe yang sama?
```

Engineer biasa:

```text
DTO Java sudah ada -> generate OpenAPI schema.
```

Engineer kuat:

```text
OpenAPI schema adalah public wire contract. DTO Java hanya salah satu cara implementasi boundary.
```

Engineer biasa:

```text
Components bikin spec rapi.
```

Engineer kuat:

```text
Components membentuk vocabulary dan dependency graph API. Reuse adalah keputusan arsitektur.
```

Engineer biasa:

```text
CommonResponse biar konsisten.
```

Engineer kuat:

```text
Consistency harus meningkatkan semantic clarity, bukan menyamarkan perbedaan response.
```

---

## 38. Summary

`components` adalah salah satu bagian paling kuat di OpenAPI, tetapi juga salah satu sumber technical debt paling halus.

Hal terpenting dari part ini:

1. `components` bukan folder `common`.
2. Reuse harus berdasarkan semantic sameness, bukan structural similarity.
3. Schema request dan response biasanya perlu dipisah.
4. Shared schema menciptakan coupling dan blast radius.
5. Naming component adalah bagian dari API design.
6. Component granularity harus mengikuti konsep domain.
7. Reusable parameters, responses, headers, examples, and security schemes sangat berguna jika distandarkan dengan benar.
8. `$ref` harus dipakai untuk clarity, bukan inheritance fantasy.
9. Java classes tidak boleh otomatis menentukan public contract.
10. Good components membuat API lebih stabil, reviewable, generate-able, dan auditable.

Jika harus diringkas menjadi satu kalimat:

> Reusable components are not about eliminating duplication; they are about defining a stable API vocabulary without accidentally coupling things that should evolve independently.

---

## 39. Latihan Mandiri

### Exercise 1 — Identify Bad Reuse

Ambil satu OpenAPI spec yang pernah kamu lihat. Cari schema yang dipakai di request dan response sekaligus.

Tanyakan:

1. Apakah semua field valid untuk request?
2. Apakah semua field valid untuk response?
3. Apakah ada server-generated fields?
4. Apakah ada sensitive fields?
5. Apakah update semantics berbeda dari create semantics?

Refactor menjadi schema berbeda jika perlu.

### Exercise 2 — Design Shared Error Components

Buat components untuk:

- `ProblemDetails`
- `ValidationProblemDetails`
- `ConflictProblemDetails`
- reusable `Unauthorized` response
- reusable `Forbidden` response
- reusable `ValidationFailed` response

Pastikan examples valid.

### Exercise 3 — Component Naming Review

Rename component berikut menjadi lebih baik:

```text
User
Data
Status
CommonResponse
Request
Document
Error
Page
```

Gunakan konteks domain yang spesifik.

### Exercise 4 — Reference Graph Analysis

Ambil satu component penting, lalu daftar semua operation yang menggunakannya.

Tentukan:

1. Apa blast radius jika component berubah?
2. Apakah semua usage masih semantik sama?
3. Apakah component terlalu shared?

---

## 40. Preview Part Berikutnya

Part berikutnya adalah:

```text
Part 009 — Schema Object Deep Dive: Types, Constraints, Formats, and Validation Semantics
```

Kita akan masuk lebih dalam ke `Schema Object`:

- type system,
- required vs optional,
- nullable semantics,
- string/numeric/array/object constraints,
- enum,
- default,
- readOnly/writeOnly,
- format,
- Bean Validation mapping di Java,
- dan kenapa `type: string` tanpa constraint sering menjadi contract smell.

---

## 41. Status Seri

```text
Current part: 008 / 030
Status: In progress
Series complete: No
Remaining parts: 22
Next: Part 009 — Schema Object Deep Dive: Types, Constraints, Formats, and Validation Semantics
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-007.md">⬅️ OpenAPI Mastery for Java Engineers — Part 007</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-009.md">OpenAPI Mastery for Java Engineers — Part 009 ➡️</a>
</div>
