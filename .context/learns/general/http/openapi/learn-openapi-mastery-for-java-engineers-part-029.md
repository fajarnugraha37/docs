# learn-openapi-mastery-for-java-engineers-part-029.md

# Part 029 — Building a Production-Grade OpenAPI from Scratch: End-to-End Case Study

> Seri: OpenAPI Mastery for Java Engineers  
> Part: 029 / 030  
> Fokus: membangun OpenAPI production-grade dari requirement mentah sampai contract, examples, Java alignment, tests, governance, dan release pipeline.  
> Baseline: OpenAPI Specification 3.2.x sebagai model utama, dengan catatan tooling ecosystem tertentu mungkin masih lebih matang di 3.0/3.1.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya, kita mempelajari potongan-potongan OpenAPI secara terpisah:

- anatomy dokumen,
- paths dan operations,
- parameters,
- request body,
- responses,
- components,
- schema,
- composition,
- domain modelling,
- workflow,
- Java/Spring integration,
- contract testing,
- breaking changes,
- examples,
- security,
- pagination,
- callbacks,
- governance,
- CI/CD,
- SDK/client generation,
- server stub generation,
- microservices/platform usage,
- gateway/runtime policy,
- regulated systems,
- schema evolution,
- anti-patterns.

Bagian ini menyatukan semua itu ke dalam satu case study end-to-end.

Targetnya bukan menghasilkan OpenAPI paling panjang. Targetnya adalah membangun cara berpikir:

```text
Requirement mentah
  -> capability map
  -> API boundary
  -> resource model
  -> operation model
  -> schema vocabulary
  -> examples
  -> validation rules
  -> Java implementation alignment
  -> contract tests
  -> CI/CD gates
  -> review checklist
  -> release artifact
```

Setelah bagian ini, kamu harus bisa duduk di depan requirement ambigu dan mengubahnya menjadi API contract yang:

- usable oleh consumer,
- stabil untuk evolusi,
- jelas untuk implementer,
- bisa diuji otomatis,
- bisa direview,
- bisa dipublish,
- bisa dijadikan bukti perubahan,
- tidak membocorkan entity/database/internal workflow sembarangan.

---

## 1. Case Study Domain

Kita akan memakai domain semi-regulated yang cukup kompleks tetapi masih manageable:

> **Complaint Intake and Review API**

Sistem ini menerima laporan/complaint dari user eksternal, melakukan validasi awal, menyediakan status tracking, dan memungkinkan officer internal melakukan review awal.

Kita sengaja memilih domain ini karena mengandung banyak aspek API nyata:

- create resource,
- retrieve resource,
- list/search,
- status lifecycle,
- evidence/document attachment,
- actor berbeda,
- validation error,
- conflict,
- async processing,
- audit trail,
- sensitive data,
- public vs internal API,
- idempotency,
- compatibility concern,
- Java implementation boundary.

Namun kita tidak akan masuk terlalu jauh ke detail database, queue, Kubernetes, gateway, atau IAM internal karena itu sudah menjadi wilayah seri lain.

---

## 2. Requirement Mentah

Misalnya product/legal/operations memberikan requirement seperti ini:

```text
Users can submit complaints. A complaint includes complainant information,
subject information, category, description, incident date, and optional evidence.

After submission, the user receives a reference number and can check the status.

Internal officers can search complaints, view details, assign a complaint for review,
request more information, accept it for investigation, or reject it.

The system must be auditable and support future extension for appeals and enforcement.
```

Ini terlihat sederhana. Tetapi API engineer yang kuat harus langsung melihat ambiguity:

1. Siapa “users”?
2. Apakah submitter harus login?
3. Apakah anonymous complaint diperbolehkan?
4. Apakah evidence diupload bersamaan atau terpisah?
5. Apakah complaint langsung dibuat, atau masuk pending validation?
6. Apa status lifecycle-nya?
7. Apakah reference number sama dengan internal ID?
8. Apa yang boleh dilihat public user?
9. Apa yang boleh dilihat internal officer?
10. Apakah subject adalah person, organization, atau keduanya?
11. Apakah category enum stabil atau configurable?
12. Apa arti reject?
13. Apakah officer action harus idempotent?
14. Apakah ada optimistic concurrency?
15. Apakah status change harus punya reason?
16. Bagaimana modelling audit trail?
17. Bagaimana error response distandardisasi?
18. Apakah consumer boleh bergantung pada exact enum list?
19. Apakah API public dan internal sebaiknya satu spec atau terpisah?
20. Apa yang berubah kalau nanti ada appeal/enforcement module?

Lesson pertama:

```text
OpenAPI production-grade tidak dimulai dari YAML.
OpenAPI production-grade dimulai dari ambiguity reduction.
```

---

## 3. System Boundary

Sebelum menulis endpoint, tentukan boundary.

Dalam case ini kita punya dua API surface:

1. **Public Complaint API**
   - submit complaint,
   - upload evidence,
   - check status by public reference,
   - respond to information request.

2. **Internal Complaint Review API**
   - search/list complaints,
   - view full detail,
   - assign complaint,
   - transition review state,
   - view audit trail.

Kita bisa menaruh keduanya dalam satu OpenAPI document dengan tags berbeda, tetapi dalam organisasi besar biasanya lebih baik dipisah:

```text
complaint-public-api.yaml
complaint-internal-api.yaml
```

Namun untuk case study ini, kita akan memakai satu dokumen agar hubungan antar bagian terlihat.

Prinsip boundary:

```text
Public API exposes consumer-safe facts.
Internal API exposes operational capabilities.
Neither API exposes persistence implementation.
```

---

## 4. Capability Map

Jangan mulai dari CRUD. Mulai dari capability.

```text
Public capabilities:
- Submit a complaint.
- Retrieve complaint status using public reference.
- Upload evidence for a submitted complaint.
- List evidence metadata visible to submitter.
- Respond to request for more information.

Internal capabilities:
- Search complaints.
- Retrieve complaint detail.
- Assign complaint to officer.
- Request more information.
- Accept complaint for investigation.
- Reject complaint.
- Retrieve complaint audit trail.
```

Capability map membantu kita membedakan antara:

- resource operation,
- workflow command,
- query/search,
- document upload,
- state transition.

Kalau langsung CRUD, kita akan tergoda membuat endpoint seperti:

```text
POST /complaints
GET /complaints/{id}
PUT /complaints/{id}
DELETE /complaints/{id}
```

Itu buruk untuk domain lifecycle karena `PUT /complaints/{id}` tidak menjelaskan apakah user sedang mengubah description, officer sedang menerima complaint, atau sistem sedang menutup complaint.

Untuk workflow domain, command endpoint sering lebih jelas:

```text
POST /internal/complaints/{complaintId}/assignments
POST /internal/complaints/{complaintId}/review-actions/request-more-information
POST /internal/complaints/{complaintId}/review-actions/accept
POST /internal/complaints/{complaintId}/review-actions/reject
```

Ini bukan anti-REST. Ini modelling capability secara eksplisit.

---

## 5. First Draft Path Catalogue

Katalog endpoint awal:

```text
Public:
POST   /complaints
GET    /complaints/{publicReference}
POST   /complaints/{publicReference}/evidence
GET    /complaints/{publicReference}/evidence
POST   /complaints/{publicReference}/information-responses

Internal:
GET    /internal/complaints
GET    /internal/complaints/{complaintId}
POST   /internal/complaints/{complaintId}/assignment
POST   /internal/complaints/{complaintId}/review-actions/request-more-information
POST   /internal/complaints/{complaintId}/review-actions/accept
POST   /internal/complaints/{complaintId}/review-actions/reject
GET    /internal/complaints/{complaintId}/audit-events
```

Tapi ada issue:

```text
GET /complaints/{publicReference}
```

Apakah public reference cukup aman untuk lookup? Kalau reference predictable, bisa terjadi enumeration. Kita bisa butuh:

- public reference + access token,
- login session,
- one-time tracking code,
- email verification,
- signed retrieval token.

Untuk case study, kita pilih:

```text
GET /complaints/{publicReference}
Header: X-Complaint-Access-Token
```

Namun header custom untuk access token perlu hati-hati. Dalam production, bisa jadi bearer token atau signed URL. Di OpenAPI, yang penting adalah contract eksplisit.

---

## 6. Resource Model

Kita punya beberapa konsep:

```text
Complaint
Complainant
ComplaintSubject
EvidenceDocument
ReviewAssignment
InformationRequest
InformationResponse
AuditEvent
Problem/Error
```

Sekarang bedakan representation berdasarkan consumer:

```text
PublicComplaintStatus
InternalComplaintDetail
ComplaintSummary
CreateComplaintRequest
ComplaintCreatedResponse
UploadEvidenceResponse
ReviewActionResponse
AuditEvent
```

Jangan pakai satu schema `Complaint` untuk semua.

Kenapa?

Karena public consumer tidak boleh melihat:

- internal ID,
- assigned officer,
- internal notes,
- risk score,
- triage flags,
- audit metadata,
- sensitive subject data tertentu.

Internal consumer mungkin butuh detail itu.

Prinsip:

```text
Schema name should describe role in API contract, not Java class name or table name.
```

---

## 7. Lifecycle State Model

Complaint status untuk public user tidak harus sama dengan internal workflow state.

Internal state mungkin:

```text
RECEIVED
VALIDATING
PENDING_INFORMATION
READY_FOR_REVIEW
ASSIGNED
ACCEPTED_FOR_INVESTIGATION
REJECTED
CLOSED
```

Public status sebaiknya lebih stabil dan tidak terlalu membocorkan operasi internal:

```text
SUBMITTED
UNDER_REVIEW
WAITING_FOR_YOUR_RESPONSE
ACCEPTED
NOT_ACCEPTED
CLOSED
```

Mapping internal ke public:

```text
RECEIVED                    -> SUBMITTED
VALIDATING                  -> SUBMITTED
READY_FOR_REVIEW            -> UNDER_REVIEW
ASSIGNED                    -> UNDER_REVIEW
PENDING_INFORMATION         -> WAITING_FOR_YOUR_RESPONSE
ACCEPTED_FOR_INVESTIGATION  -> ACCEPTED
REJECTED                    -> NOT_ACCEPTED
CLOSED                      -> CLOSED
```

Ini penting untuk evolusi. Internal workflow bisa berubah tanpa mengubah public contract.

---

## 8. First Production-Grade OpenAPI Skeleton

Berikut skeleton yang akan kita kembangkan.

```yaml
openapi: 3.2.0
info:
  title: Complaint Intake and Review API
  version: 1.0.0
  summary: API for submitting, tracking, and reviewing complaints.
  description: |
    This API supports public complaint submission and internal complaint review workflows.
    It separates public-facing status representations from internal review state.
  contact:
    name: API Platform Team
    email: api-platform@example.gov
  license:
    name: Internal Use Only
servers:
  - url: https://api.example.gov/complaint/v1
    description: Production
  - url: https://sandbox-api.example.gov/complaint/v1
    description: Sandbox

tags:
  - name: Public Complaints
    description: Public complaint submission and tracking operations.
  - name: Public Evidence
    description: Evidence upload and evidence metadata visible to complaint submitters.
  - name: Internal Complaints
    description: Internal complaint search and review operations.
  - name: Internal Audit
    description: Internal audit trail operations.

paths: {}
components: {}
```

Catatan:

- `info.version` adalah version dari API description/artifact, bukan selalu sama dengan service runtime version.
- `servers` jangan di-hardcode ke localhost untuk published spec.
- Tags dipakai sebagai navigasi capability, bukan sekadar nama controller.

---

## 9. Security Model

Kita punya dua skema:

1. Public tracking access token.
2. Internal OAuth2 bearer token dengan scopes.

```yaml
components:
  securitySchemes:
    ComplaintTrackingToken:
      type: apiKey
      in: header
      name: X-Complaint-Access-Token
      description: |
        Token issued at complaint submission time and required to retrieve
        public complaint status or upload additional evidence.

    InternalOAuth2:
      type: oauth2
      description: Internal workforce OAuth2 authentication.
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.gov/oauth2/authorize
          tokenUrl: https://auth.example.gov/oauth2/token
          scopes:
            complaint:read: Read internal complaint data.
            complaint:review: Perform complaint review actions.
            complaint:audit: Read complaint audit events.
```

Security requirements nanti dipasang operation-level.

Jangan pakai global security kalau public dan internal API punya auth berbeda.

---

## 10. Standard Error Model

Gunakan Problem Details style.

```yaml
components:
  schemas:
    Problem:
      type: object
      additionalProperties: true
      required:
        - type
        - title
        - status
        - traceId
      properties:
        type:
          type: string
          format: uri
          examples:
            - https://api.example.gov/problems/validation-error
        title:
          type: string
          examples:
            - Validation failed
        status:
          type: integer
          minimum: 400
          maximum: 599
          examples:
            - 400
        detail:
          type: string
          examples:
            - One or more request fields are invalid.
        instance:
          type: string
          format: uri-reference
          examples:
            - /complaints
        traceId:
          type: string
          examples:
            - 01J8Z7Q8G9W3K4M5N6P7Q8R9ST
        errors:
          type: array
          items:
            $ref: '#/components/schemas/FieldError'

    FieldError:
      type: object
      required:
        - field
        - code
        - message
      properties:
        field:
          type: string
          examples:
            - complainant.email
        code:
          type: string
          examples:
            - EMAIL_INVALID
        message:
          type: string
          examples:
            - Email address is invalid.
```

Kenapa `additionalProperties: true`?

Karena Problem Details sering diperluas dengan extension members. Tetapi perlu governance agar tidak liar.

---

## 11. Shared Responses

```yaml
components:
  responses:
    BadRequest:
      description: Request is malformed or fails structural validation.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'

    Unauthorized:
      description: Authentication is missing or invalid.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'

    Forbidden:
      description: Authenticated principal does not have permission for this operation.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'

    NotFound:
      description: The requested resource was not found or is not visible to the caller.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'

    Conflict:
      description: Operation conflicts with current resource state.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'

    PreconditionFailed:
      description: Resource version precondition failed.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
```

Shared responses bagus selama semantic-nya konsisten.

Jangan membuat satu `GenericError` tanpa arti operasional.

---

## 12. Parameters

```yaml
components:
  parameters:
    PublicReference:
      name: publicReference
      in: path
      required: true
      description: Public complaint reference returned after submission.
      schema:
        type: string
        pattern: '^CMP-[0-9]{8}-[A-Z0-9]{6}$'
        examples:
          - CMP-20260620-A1B2C3

    ComplaintId:
      name: complaintId
      in: path
      required: true
      description: Internal complaint identifier.
      schema:
        type: string
        format: uuid

    PageSize:
      name: pageSize
      in: query
      required: false
      description: Maximum number of items to return.
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 25

    Cursor:
      name: cursor
      in: query
      required: false
      description: Opaque pagination cursor from a previous response.
      schema:
        type: string
```

Perhatikan:

- public reference punya pattern,
- internal ID pakai UUID,
- cursor opaque,
- page size constrained.

---

## 13. Core Public Schemas

```yaml
components:
  schemas:
    CreateComplaintRequest:
      type: object
      additionalProperties: false
      required:
        - complainant
        - subject
        - category
        - description
        - incidentDate
      properties:
        complainant:
          $ref: '#/components/schemas/ComplainantInput'
        subject:
          $ref: '#/components/schemas/ComplaintSubjectInput'
        category:
          $ref: '#/components/schemas/ComplaintCategory'
        description:
          type: string
          minLength: 20
          maxLength: 5000
        incidentDate:
          type: string
          format: date
        idempotencyKey:
          type: string
          minLength: 16
          maxLength: 128
          description: |
            Client-generated key to safely retry complaint submission.
            If omitted, duplicate submissions may create multiple complaints.

    ComplainantInput:
      type: object
      additionalProperties: false
      required:
        - fullName
        - email
      properties:
        fullName:
          type: string
          minLength: 1
          maxLength: 200
        email:
          type: string
          format: email
          maxLength: 320
        phone:
          type: string
          maxLength: 50

    ComplaintSubjectInput:
      type: object
      additionalProperties: false
      required:
        - subjectType
        - displayName
      properties:
        subjectType:
          type: string
          enum:
            - PERSON
            - ORGANIZATION
            - UNKNOWN
        displayName:
          type: string
          minLength: 1
          maxLength: 300
        externalReference:
          type: string
          maxLength: 100
          description: Optional reference known by the complainant.

    ComplaintCategory:
      type: string
      enum:
        - MISCONDUCT
        - FRAUD
        - SAFETY
        - PRIVACY
        - OTHER
```

Catatan penting tentang enum:

- Kalau kategori sering berubah, enum di contract bisa menjadi beban compatibility.
- Untuk case ini, kita anggap kategori public stabil dan hanya high-level.
- Internal classification yang lebih volatile sebaiknya bukan public enum.

---

## 14. Created Response

```yaml
components:
  schemas:
    ComplaintCreatedResponse:
      type: object
      additionalProperties: false
      required:
        - publicReference
        - accessToken
        - status
        - submittedAt
      properties:
        publicReference:
          type: string
          examples:
            - CMP-20260620-A1B2C3
        accessToken:
          type: string
          description: Token required for public follow-up operations.
        status:
          $ref: '#/components/schemas/PublicComplaintStatusValue'
        submittedAt:
          type: string
          format: date-time

    PublicComplaintStatusValue:
      type: string
      enum:
        - SUBMITTED
        - UNDER_REVIEW
        - WAITING_FOR_YOUR_RESPONSE
        - ACCEPTED
        - NOT_ACCEPTED
        - CLOSED
```

Security note:

Returning access token in creation response is acceptable only if transport, logging, and storage are handled carefully. In many systems, a follow-up email or account-based access may be better.

OpenAPI can document it, but architecture must still secure it.

---

## 15. Public Status Response

```yaml
components:
  schemas:
    PublicComplaintStatus:
      type: object
      additionalProperties: false
      required:
        - publicReference
        - status
        - submittedAt
        - lastUpdatedAt
      properties:
        publicReference:
          type: string
        status:
          $ref: '#/components/schemas/PublicComplaintStatusValue'
        submittedAt:
          type: string
          format: date-time
        lastUpdatedAt:
          type: string
          format: date-time
        nextAction:
          type: string
          enum:
            - NONE
            - PROVIDE_MORE_INFORMATION
        message:
          type: string
          maxLength: 1000
```

Kita sengaja tidak expose:

- internal complaint ID,
- officer name,
- internal queue,
- exact internal state,
- audit details.

---

## 16. Public Submit Operation

```yaml
paths:
  /complaints:
    post:
      tags:
        - Public Complaints
      operationId: submitComplaint
      summary: Submit a complaint.
      description: |
        Creates a new complaint submission and returns a public reference.
        Clients may provide an idempotency key to safely retry submission.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateComplaintRequest'
            examples:
              misconductComplaint:
                summary: Misconduct complaint
                value:
                  complainant:
                    fullName: Jane Doe
                    email: jane.doe@example.com
                    phone: '+6281234567890'
                  subject:
                    subjectType: ORGANIZATION
                    displayName: Example Services Ltd
                    externalReference: EXT-9981
                  category: MISCONDUCT
                  description: The organization repeatedly failed to respond to formal complaints and may have falsified service records.
                  incidentDate: '2026-06-01'
                  idempotencyKey: 01J9A8K2P4Q6R8S0T2V4W6X8Y0
      responses:
        '201':
          description: Complaint submitted.
          headers:
            Location:
              description: URL for retrieving public complaint status.
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ComplaintCreatedResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '409':
          $ref: '#/components/responses/Conflict'
```

Kenapa `201`?

Karena resource public complaint tracking dibuat.

Kenapa ada `Location`?

Karena consumer butuh tahu URL status tracking.

Kenapa `409`?

Untuk idempotency conflict atau duplicate semantic conflict.

---

## 17. Public Status Operation

```yaml
  /complaints/{publicReference}:
    get:
      tags:
        - Public Complaints
      operationId: getPublicComplaintStatus
      summary: Retrieve public complaint status.
      security:
        - ComplaintTrackingToken: []
      parameters:
        - $ref: '#/components/parameters/PublicReference'
      responses:
        '200':
          description: Public complaint status.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PublicComplaintStatus'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '404':
          $ref: '#/components/responses/NotFound'
```

`404` description intentionally says resource not found or not visible. Ini mencegah leakage.

---

## 18. Evidence Upload Model

Evidence upload sering salah dimodelkan.

Pilihan:

1. Upload file langsung via multipart.
2. Request pre-signed upload URL lalu upload ke object storage.
3. Upload metadata dulu, file belakangan.
4. Streaming binary langsung.

Untuk API public sederhana, kita pilih multipart.

```yaml
components:
  schemas:
    EvidenceMetadata:
      type: object
      additionalProperties: false
      required:
        - evidenceId
        - fileName
        - contentType
        - sizeBytes
        - uploadedAt
      properties:
        evidenceId:
          type: string
          format: uuid
        fileName:
          type: string
        contentType:
          type: string
        sizeBytes:
          type: integer
          format: int64
          minimum: 1
        uploadedAt:
          type: string
          format: date-time
```

```yaml
  /complaints/{publicReference}/evidence:
    post:
      tags:
        - Public Evidence
      operationId: uploadComplaintEvidence
      summary: Upload evidence for a complaint.
      security:
        - ComplaintTrackingToken: []
      parameters:
        - $ref: '#/components/parameters/PublicReference'
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required:
                - file
              properties:
                file:
                  type: string
                  format: binary
                description:
                  type: string
                  maxLength: 1000
      responses:
        '201':
          description: Evidence uploaded.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EvidenceMetadata'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '404':
          $ref: '#/components/responses/NotFound'
        '413':
          description: Evidence file is too large.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
```

Catatan:

- OpenAPI bisa menyatakan binary upload.
- Ukuran maksimal file biasanya juga perlu documented di description atau vendor extension.
- Content scanning/virus scanning adalah behavior runtime, bukan hanya schema.

---

## 19. Internal Search Schema

Search/list response harus stabil.

```yaml
components:
  schemas:
    ComplaintSearchResponse:
      type: object
      additionalProperties: false
      required:
        - items
        - page
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/ComplaintSummary'
        page:
          $ref: '#/components/schemas/CursorPage'

    CursorPage:
      type: object
      additionalProperties: false
      required:
        - pageSize
        - hasMore
      properties:
        pageSize:
          type: integer
        hasMore:
          type: boolean
        nextCursor:
          type: string

    ComplaintSummary:
      type: object
      additionalProperties: false
      required:
        - complaintId
        - publicReference
        - internalState
        - category
        - submittedAt
        - lastUpdatedAt
      properties:
        complaintId:
          type: string
          format: uuid
        publicReference:
          type: string
        internalState:
          $ref: '#/components/schemas/InternalComplaintState'
        category:
          $ref: '#/components/schemas/ComplaintCategory'
        submittedAt:
          type: string
          format: date-time
        lastUpdatedAt:
          type: string
          format: date-time
        assignedOfficerId:
          type: string
          format: uuid

    InternalComplaintState:
      type: string
      enum:
        - RECEIVED
        - VALIDATING
        - PENDING_INFORMATION
        - READY_FOR_REVIEW
        - ASSIGNED
        - ACCEPTED_FOR_INVESTIGATION
        - REJECTED
        - CLOSED
```

Notice:

- internal state boleh lebih detail,
- response punya envelope,
- cursor opaque,
- optional `assignedOfficerId` bisa absent.

---

## 20. Internal Search Operation

```yaml
  /internal/complaints:
    get:
      tags:
        - Internal Complaints
      operationId: searchComplaints
      summary: Search complaints for internal review.
      security:
        - InternalOAuth2:
            - complaint:read
      parameters:
        - name: state
          in: query
          required: false
          schema:
            $ref: '#/components/schemas/InternalComplaintState'
        - name: category
          in: query
          required: false
          schema:
            $ref: '#/components/schemas/ComplaintCategory'
        - name: submittedFrom
          in: query
          required: false
          schema:
            type: string
            format: date
        - name: submittedTo
          in: query
          required: false
          schema:
            type: string
            format: date
        - $ref: '#/components/parameters/PageSize'
        - $ref: '#/components/parameters/Cursor'
      responses:
        '200':
          description: Complaint search results.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ComplaintSearchResponse'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
```

Search filters harus explicit. Jangan dokumentasikan “supports flexible query string” tanpa grammar.

---

## 21. Internal Detail Schema

```yaml
components:
  schemas:
    InternalComplaintDetail:
      type: object
      additionalProperties: false
      required:
        - complaintId
        - publicReference
        - internalState
        - publicStatus
        - complainant
        - subject
        - category
        - description
        - incidentDate
        - submittedAt
        - version
      properties:
        complaintId:
          type: string
          format: uuid
        publicReference:
          type: string
        internalState:
          $ref: '#/components/schemas/InternalComplaintState'
        publicStatus:
          $ref: '#/components/schemas/PublicComplaintStatusValue'
        complainant:
          $ref: '#/components/schemas/InternalComplainant'
        subject:
          $ref: '#/components/schemas/InternalComplaintSubject'
        category:
          $ref: '#/components/schemas/ComplaintCategory'
        description:
          type: string
        incidentDate:
          type: string
          format: date
        assignedOfficerId:
          type: string
          format: uuid
        submittedAt:
          type: string
          format: date-time
        lastUpdatedAt:
          type: string
          format: date-time
        version:
          type: integer
          format: int64
          description: Version used for optimistic concurrency.

    InternalComplainant:
      type: object
      additionalProperties: false
      required:
        - fullName
        - email
      properties:
        fullName:
          type: string
        email:
          type: string
          format: email
        phone:
          type: string

    InternalComplaintSubject:
      type: object
      additionalProperties: false
      required:
        - subjectType
        - displayName
      properties:
        subjectType:
          type: string
          enum:
            - PERSON
            - ORGANIZATION
            - UNKNOWN
        displayName:
          type: string
        externalReference:
          type: string
        normalizedSubjectId:
          type: string
          format: uuid
          description: Internal linked subject identity when available.
```

Perhatikan `version`.

Ini akan dipakai untuk transition commands.

---

## 22. Internal Detail Operation

```yaml
  /internal/complaints/{complaintId}:
    get:
      tags:
        - Internal Complaints
      operationId: getInternalComplaintDetail
      summary: Retrieve internal complaint detail.
      security:
        - InternalOAuth2:
            - complaint:read
      parameters:
        - $ref: '#/components/parameters/ComplaintId'
      responses:
        '200':
          description: Internal complaint detail.
          headers:
            ETag:
              description: Entity tag representing the current complaint version.
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InternalComplaintDetail'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
```

Kita expose `ETag` untuk concurrency, tapi juga menyediakan `version` field. Dalam production, pilih satu model secara konsisten. Untuk case study, kita tunjukkan keduanya sebagai trade-off:

- `ETag` bagus untuk HTTP-native precondition.
- `version` eksplisit bagus untuk domain/application command.

Jangan memakai dua-duanya tanpa policy jelas.

---

## 23. Review Action Commands

Command request base:

```yaml
components:
  schemas:
    ReviewActionBase:
      type: object
      additionalProperties: false
      required:
        - reason
        - expectedVersion
      properties:
        reason:
          type: string
          minLength: 5
          maxLength: 1000
        expectedVersion:
          type: integer
          format: int64
          minimum: 0

    AssignmentRequest:
      type: object
      additionalProperties: false
      required:
        - officerId
        - expectedVersion
      properties:
        officerId:
          type: string
          format: uuid
        expectedVersion:
          type: integer
          format: int64
          minimum: 0

    RequestMoreInformationRequest:
      allOf:
        - $ref: '#/components/schemas/ReviewActionBase'
        - type: object
          additionalProperties: false
          required:
            - requestedInformation
          properties:
            requestedInformation:
              type: string
              minLength: 10
              maxLength: 2000

    AcceptComplaintRequest:
      allOf:
        - $ref: '#/components/schemas/ReviewActionBase'

    RejectComplaintRequest:
      allOf:
        - $ref: '#/components/schemas/ReviewActionBase'
        - type: object
          additionalProperties: false
          required:
            - rejectionCode
          properties:
            rejectionCode:
              type: string
              enum:
                - OUT_OF_SCOPE
                - INSUFFICIENT_INFORMATION
                - DUPLICATE
                - NOT_ACTIONABLE
```

Potential issue:

`allOf` with `additionalProperties: false` can be tricky depending on dialect/tooling. For maximum compatibility, especially with generators, you might choose explicit duplicated command schemas instead of composition.

Production judgement:

```text
Readable reuse is good.
Generator-compatible explicitness is often better.
```

---

## 24. Review Action Response

```yaml
components:
  schemas:
    ReviewActionResponse:
      type: object
      additionalProperties: false
      required:
        - complaintId
        - previousState
        - currentState
        - version
        - changedAt
      properties:
        complaintId:
          type: string
          format: uuid
        previousState:
          $ref: '#/components/schemas/InternalComplaintState'
        currentState:
          $ref: '#/components/schemas/InternalComplaintState'
        version:
          type: integer
          format: int64
        changedAt:
          type: string
          format: date-time
```

Response tidak perlu mengembalikan seluruh complaint detail kalau consumer hanya butuh transition result. Tapi bisa juga return full detail untuk mengurangi round-trip.

Decision rule:

```text
Return small transition result if command callers already manage local state.
Return updated resource representation if clients need immediate reconciliation.
```

---

## 25. Assignment Operation

```yaml
  /internal/complaints/{complaintId}/assignment:
    post:
      tags:
        - Internal Complaints
      operationId: assignComplaint
      summary: Assign a complaint to an officer.
      security:
        - InternalOAuth2:
            - complaint:review
      parameters:
        - $ref: '#/components/parameters/ComplaintId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AssignmentRequest'
      responses:
        '200':
          description: Complaint assigned.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ReviewActionResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          $ref: '#/components/responses/Conflict'
        '412':
          $ref: '#/components/responses/PreconditionFailed'
```

`409` vs `412`:

- `409`: state conflict, e.g. complaint is closed.
- `412`: version precondition failed.

---

## 26. Request More Information Operation

```yaml
  /internal/complaints/{complaintId}/review-actions/request-more-information:
    post:
      tags:
        - Internal Complaints
      operationId: requestMoreInformationForComplaint
      summary: Request more information from the complainant.
      security:
        - InternalOAuth2:
            - complaint:review
      parameters:
        - $ref: '#/components/parameters/ComplaintId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RequestMoreInformationRequest'
      responses:
        '200':
          description: Complaint moved to pending information state.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ReviewActionResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          $ref: '#/components/responses/Conflict'
        '412':
          $ref: '#/components/responses/PreconditionFailed'
```

Good operation IDs are verbose enough to be stable and meaningful.

Avoid:

```text
postAction
review
updateStatus
```

---

## 27. Audit Events

Audit events are not the same as domain events.

For API contract, audit event representation should answer:

- who,
- did what,
- when,
- why,
- from what state,
- to what state,
- trace/correlation.

```yaml
components:
  schemas:
    AuditEvent:
      type: object
      additionalProperties: false
      required:
        - auditEventId
        - complaintId
        - eventType
        - occurredAt
        - actor
        - traceId
      properties:
        auditEventId:
          type: string
          format: uuid
        complaintId:
          type: string
          format: uuid
        eventType:
          type: string
          enum:
            - COMPLAINT_SUBMITTED
            - EVIDENCE_UPLOADED
            - COMPLAINT_ASSIGNED
            - MORE_INFORMATION_REQUESTED
            - COMPLAINT_ACCEPTED
            - COMPLAINT_REJECTED
            - STATUS_VIEWED
        occurredAt:
          type: string
          format: date-time
        actor:
          $ref: '#/components/schemas/AuditActor'
        previousState:
          $ref: '#/components/schemas/InternalComplaintState'
        newState:
          $ref: '#/components/schemas/InternalComplaintState'
        reason:
          type: string
        traceId:
          type: string

    AuditActor:
      type: object
      additionalProperties: false
      required:
        - actorType
      properties:
        actorType:
          type: string
          enum:
            - PUBLIC_USER
            - INTERNAL_USER
            - SYSTEM
        actorId:
          type: string
        displayName:
          type: string

    AuditEventPage:
      type: object
      additionalProperties: false
      required:
        - items
        - page
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/AuditEvent'
        page:
          $ref: '#/components/schemas/CursorPage'
```

Audit events may contain sensitive data. Do not blindly expose full snapshots.

---

## 28. Audit Operation

```yaml
  /internal/complaints/{complaintId}/audit-events:
    get:
      tags:
        - Internal Audit
      operationId: listComplaintAuditEvents
      summary: List audit events for a complaint.
      security:
        - InternalOAuth2:
            - complaint:audit
      parameters:
        - $ref: '#/components/parameters/ComplaintId'
        - $ref: '#/components/parameters/PageSize'
        - $ref: '#/components/parameters/Cursor'
      responses:
        '200':
          description: Audit events for the complaint.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuditEventPage'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
```

---

## 29. Assemble a Complete Minimal Spec

A real file would be longer, but the shape should look like this:

```yaml
openapi: 3.2.0
info:
  title: Complaint Intake and Review API
  version: 1.0.0
  summary: API for submitting, tracking, and reviewing complaints.
servers:
  - url: https://api.example.gov/complaint/v1
tags:
  - name: Public Complaints
  - name: Public Evidence
  - name: Internal Complaints
  - name: Internal Audit
paths:
  /complaints:
    post:
      operationId: submitComplaint
      tags: [Public Complaints]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateComplaintRequest'
      responses:
        '201':
          description: Complaint submitted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ComplaintCreatedResponse'
        '400':
          $ref: '#/components/responses/BadRequest'

  /complaints/{publicReference}:
    get:
      operationId: getPublicComplaintStatus
      tags: [Public Complaints]
      security:
        - ComplaintTrackingToken: []
      parameters:
        - $ref: '#/components/parameters/PublicReference'
      responses:
        '200':
          description: Public complaint status.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PublicComplaintStatus'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '404':
          $ref: '#/components/responses/NotFound'

components:
  securitySchemes:
    ComplaintTrackingToken:
      type: apiKey
      in: header
      name: X-Complaint-Access-Token
    InternalOAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.gov/oauth2/authorize
          tokenUrl: https://auth.example.gov/oauth2/token
          scopes:
            complaint:read: Read complaint data.
            complaint:review: Perform complaint review actions.
            complaint:audit: Read complaint audit events.
  parameters:
    PublicReference:
      name: publicReference
      in: path
      required: true
      schema:
        type: string
        pattern: '^CMP-[0-9]{8}-[A-Z0-9]{6}$'
  responses:
    BadRequest:
      description: Bad request.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
    Unauthorized:
      description: Unauthorized.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
    NotFound:
      description: Not found.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
  schemas:
    Problem:
      type: object
      required: [type, title, status, traceId]
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
        traceId:
          type: string
    CreateComplaintRequest:
      type: object
      required: [complainant, subject, category, description, incidentDate]
      properties:
        complainant:
          $ref: '#/components/schemas/ComplainantInput'
        subject:
          $ref: '#/components/schemas/ComplaintSubjectInput'
        category:
          $ref: '#/components/schemas/ComplaintCategory'
        description:
          type: string
          minLength: 20
          maxLength: 5000
        incidentDate:
          type: string
          format: date
    ComplainantInput:
      type: object
      required: [fullName, email]
      properties:
        fullName:
          type: string
        email:
          type: string
          format: email
    ComplaintSubjectInput:
      type: object
      required: [subjectType, displayName]
      properties:
        subjectType:
          type: string
          enum: [PERSON, ORGANIZATION, UNKNOWN]
        displayName:
          type: string
    ComplaintCategory:
      type: string
      enum: [MISCONDUCT, FRAUD, SAFETY, PRIVACY, OTHER]
    ComplaintCreatedResponse:
      type: object
      required: [publicReference, accessToken, status, submittedAt]
      properties:
        publicReference:
          type: string
        accessToken:
          type: string
        status:
          $ref: '#/components/schemas/PublicComplaintStatusValue'
        submittedAt:
          type: string
          format: date-time
    PublicComplaintStatusValue:
      type: string
      enum: [SUBMITTED, UNDER_REVIEW, WAITING_FOR_YOUR_RESPONSE, ACCEPTED, NOT_ACCEPTED, CLOSED]
    PublicComplaintStatus:
      type: object
      required: [publicReference, status, submittedAt, lastUpdatedAt]
      properties:
        publicReference:
          type: string
        status:
          $ref: '#/components/schemas/PublicComplaintStatusValue'
        submittedAt:
          type: string
          format: date-time
        lastUpdatedAt:
          type: string
          format: date-time
```

This is not the final full spec. It is the minimal coherent nucleus.

In a real repository, we would split it:

```text
openapi/
  complaint-api.yaml
  paths/
    public-complaints.yaml
    public-evidence.yaml
    internal-complaints.yaml
    internal-audit.yaml
  components/
    schemas/
      complaint.yaml
      problem.yaml
      audit.yaml
    parameters.yaml
    responses.yaml
    security-schemes.yaml
```

---

## 30. Example Strategy

Every important operation should include examples.

Minimum example set:

```text
submitComplaint:
- valid misconduct complaint
- valid privacy complaint
- invalid missing email
- duplicate idempotency key conflict

getPublicComplaintStatus:
- submitted
- waiting for response
- not accepted

searchComplaints:
- empty results
- first page with next cursor
- filtered by state

review actions:
- successful assignment
- conflict due to closed complaint
- precondition failed due to version mismatch
```

Examples should be:

- valid against schema,
- realistic enough for consumer,
- stable in CI,
- useful as mock fixtures,
- useful for documentation.

Bad example:

```json
{
  "foo": "bar"
}
```

Good example:

```json
{
  "publicReference": "CMP-20260620-A1B2C3",
  "status": "WAITING_FOR_YOUR_RESPONSE",
  "submittedAt": "2026-06-20T08:30:00Z",
  "lastUpdatedAt": "2026-06-21T10:15:00Z",
  "nextAction": "PROVIDE_MORE_INFORMATION",
  "message": "Please provide supporting evidence for the reported incident."
}
```

---

## 31. Linting Rules for This API

Base rules:

```yaml
extends:
  - spectral:oas
```

Custom policy examples:

```yaml
rules:
  operation-operationId-required:
    description: Every operation must define operationId.
    given: $.paths[*][*]
    severity: error
    then:
      field: operationId
      function: truthy

  operation-summary-required:
    description: Every operation must define a summary.
    given: $.paths[*][*]
    severity: error
    then:
      field: summary
      function: truthy

  no-default-only-errors:
    description: Operations must document specific 4xx errors, not only default.
    given: $.paths[*][*].responses
    severity: warn
    then:
      function: schema
      functionOptions:
        schema:
          type: object
          anyOf:
            - required: ['400']
            - required: ['401']
            - required: ['403']
            - required: ['404']
            - required: ['409']
            - required: ['422']
```

Governance rule examples:

```text
- Every operation must have operationId.
- Every operation must have at least one success response.
- Every protected operation must declare security explicitly.
- Public endpoints must not expose fields ending in InternalId.
- Error responses must use application/problem+json.
- Pagination responses must use CursorPage.
- List operations must define pageSize and cursor.
- Request schemas must not use additionalProperties true unless justified.
- Enum additions require compatibility review.
```

---

## 32. Contract Tests

Provider-side tests:

```text
For every implemented endpoint:
- request validates against OpenAPI schema,
- response validates against OpenAPI schema,
- documented error responses are produced by negative tests,
- examples validate,
- unsupported fields are rejected when additionalProperties false,
- authorization failures match documented responses.
```

Consumer-side tests:

```text
For generated or handwritten clients:
- can deserialize documented examples,
- can tolerate additive fields where policy allows,
- handles problem+json errors,
- handles enum unknowns according to SDK strategy,
- does not depend on undocumented internal fields.
```

Breaking-change tests:

```text
main branch spec
  vs
PR branch spec
  -> oasdiff breaking
  -> fail if breaking unless approved
```

---

## 33. Java Implementation Alignment

Recommended package boundary:

```text
com.example.complaint.api.generated
  - generated interfaces/models from OpenAPI

com.example.complaint.api.web
  - controllers/delegates
  - request/response mappers

com.example.complaint.application
  - commands
  - queries
  - use cases

com.example.complaint.domain
  - domain entities/value objects/state machine

com.example.complaint.persistence
  - JPA entities/repositories
```

Dependency rule:

```text
web layer may depend on generated API models.
application layer should not depend on generated API models.
domain layer must not depend on generated API models.
persistence layer must not leak into API schemas.
```

Controller pattern:

```java
@RestController
@RequiredArgsConstructor
class ComplaintController implements ComplaintsApi {

    private final ComplaintSubmissionUseCase submitComplaint;
    private final ComplaintApiMapper mapper;

    @Override
    public ResponseEntity<ComplaintCreatedResponse> submitComplaint(
            CreateComplaintRequest request) {

        var command = mapper.toCommand(request);
        var result = submitComplaint.handle(command);
        var response = mapper.toCreatedResponse(result);

        return ResponseEntity
                .created(URI.create("/complaints/" + response.getPublicReference()))
                .body(response);
    }
}
```

Mapper is not boilerplate waste. Mapper is the contract boundary.

---

## 34. State Machine Alignment

Internal state machine:

```text
RECEIVED
  -> VALIDATING
  -> READY_FOR_REVIEW
  -> ASSIGNED
  -> PENDING_INFORMATION
  -> READY_FOR_REVIEW
  -> ACCEPTED_FOR_INVESTIGATION
  -> CLOSED

ASSIGNED
  -> REJECTED
  -> CLOSED
```

API command must enforce allowed transitions:

```text
requestMoreInformation allowed from ASSIGNED only.
accept allowed from ASSIGNED only.
reject allowed from ASSIGNED or READY_FOR_REVIEW depending policy.
assign allowed from READY_FOR_REVIEW or ASSIGNED.
```

OpenAPI cannot fully express state transition rules. It can document possible responses:

```text
409 Conflict if transition is not allowed from current state.
```

But implementation and tests must enforce it.

---

## 35. CI/CD Pipeline

Recommended pipeline:

```text
1. Validate YAML/JSON syntax.
2. Validate OpenAPI document.
3. Bundle multi-file spec.
4. Lint with base + organization rules.
5. Validate examples.
6. Diff against previous released spec.
7. Fail on unapproved breaking changes.
8. Generate server interfaces/models.
9. Compile Java project.
10. Run provider contract tests.
11. Generate documentation preview.
12. Generate SDK/client artifacts if needed.
13. Publish bundled OpenAPI artifact.
14. Publish docs/catalog entry.
```

Example GitHub Actions shape:

```yaml
name: openapi-contract

on:
  pull_request:
    paths:
      - 'openapi/**'
      - 'src/**'

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install tools
        run: |
          npm install -g @stoplight/spectral-cli

      - name: Lint OpenAPI
        run: spectral lint openapi/complaint-api.yaml

      - name: Generate Spring interfaces
        run: |
          ./mvnw openapi-generator:generate

      - name: Build and test
        run: ./mvnw clean verify
```

Actual tool versions should be pinned in production.

---

## 36. Review Checklist

Before approving the API contract, ask:

### Capability

- Does every endpoint represent a real consumer capability?
- Are workflow actions explicit?
- Are public and internal capabilities separated?

### Contract Clarity

- Are operation IDs stable and meaningful?
- Are request and response schemas role-specific?
- Are status codes documented beyond 200?
- Are errors standardized?

### Security

- Is each protected operation explicitly secured?
- Are scopes meaningful?
- Are sensitive fields excluded from public responses?
- Does `404` avoid leaking invisible resources?

### Evolution

- Are public enums stable enough?
- Are internal states hidden from public contract?
- Are schema names future-proof?
- Are fields constrained but not over-constrained?

### Java Alignment

- Are generated models isolated from domain core?
- Are mappers explicit?
- Does implementation validate request/response contract?
- Are domain state transitions tested independently?

### Governance

- Does lint pass?
- Do examples validate?
- Does diff show no unapproved breaking changes?
- Is ownership clear?
- Is deprecation policy defined?

---

## 37. Common Wrong Turns in This Case Study

### Wrong Turn 1: One `ComplaintDto` Everywhere

Bad:

```text
Create request, public status, internal detail, search summary all reuse ComplaintDto.
```

Why bad:

- too much exposure,
- impossible to evolve independently,
- fields become ambiguous,
- public contract leaks internal lifecycle.

Better:

```text
CreateComplaintRequest
ComplaintCreatedResponse
PublicComplaintStatus
ComplaintSummary
InternalComplaintDetail
```

---

### Wrong Turn 2: `PUT /complaints/{id}` for Every State Change

Bad:

```text
PUT /complaints/{id}
{
  "status": "REJECTED"
}
```

Why bad:

- no explicit action,
- no reason semantics,
- weak auditability,
- hard authorization,
- unclear allowed transitions.

Better:

```text
POST /internal/complaints/{id}/review-actions/reject
{
  "reason": "Out of scope",
  "rejectionCode": "OUT_OF_SCOPE",
  "expectedVersion": 7
}
```

---

### Wrong Turn 3: Internal State Exposed to Public

Bad:

```json
{
  "state": "READY_FOR_REVIEW"
}
```

Why bad:

- reveals internal workflow,
- creates consumer dependency,
- makes operations changes breaking.

Better:

```json
{
  "status": "UNDER_REVIEW"
}
```

---

### Wrong Turn 4: No Concurrency Model

Bad:

```text
Two officers assign/reject simultaneously.
Last write wins.
```

Better:

```text
expectedVersion or If-Match.
412 Precondition Failed on stale update.
```

---

### Wrong Turn 5: Examples Are Decorative

Bad:

```yaml
example:
  id: 123
  name: test
```

Better:

- examples match schema,
- examples cover success and failure,
- examples are used in contract tests,
- examples are used by mock server/docs.

---

## 38. Production-Grade Definition

A production-grade OpenAPI contract is not defined by file size.

It is production-grade when:

```text
1. Consumers can understand capabilities without reading source code.
2. Implementers can implement without guessing hidden semantics.
3. QA can generate meaningful tests.
4. Security reviewers can see authentication expectations.
5. Platform can lint, diff, publish, and catalog it.
6. Breaking changes are detected before release.
7. Examples are valid and useful.
8. Domain model, persistence model, and API model are not accidentally the same.
9. Public contract remains stable while internal implementation evolves.
10. The document is maintained as a first-class artifact.
```

---

## 39. Mental Model Recap

This part should leave you with the following mental model:

```text
OpenAPI is a negotiated system boundary.

Paths expose capabilities.
Operations define commitments.
Parameters define access shape.
Request bodies define acceptable input.
Responses define observable outcomes.
Schemas define structural constraints.
Examples define executable understanding.
Security schemes define authentication expectations.
Errors define failure contracts.
Diffs define evolution risk.
Lint rules define organizational standards.
Tests define implementation accountability.
CI/CD defines repeatability.
```

If you can move from requirement to this structure, you are no longer “writing Swagger”.

You are engineering API contracts.

---

## 40. Practical Exercise

Take an existing API in your Java/Spring system and answer:

1. What capability does each endpoint expose?
2. Which endpoints are actually commands, not CRUD updates?
3. Which schemas are reused too aggressively?
4. Which response errors are undocumented?
5. Which public responses leak internal fields?
6. Which enums are likely to evolve?
7. Which operations need idempotency?
8. Which operations need optimistic concurrency?
9. Which examples are invalid or unrealistic?
10. Which breaking changes could happen unnoticed today?

Then create:

```text
openapi/<service-name>-api.yaml
.spectral.yaml
openapi/examples/
openapi/CHANGELOG.md
```

Add CI gates:

```text
validate -> lint -> bundle -> diff -> generate -> test -> publish
```

---

## 41. References

Primary references to consult when implementing this case study in a real project:

- OpenAPI Specification 3.2.x.
- OpenAPI Initiative learning resources.
- OpenAPI Generator documentation for Java/Spring generation.
- Spectral documentation for OpenAPI linting and custom rulesets.
- oasdiff documentation for breaking-change detection.
- RFC 9110 for HTTP semantics.
- RFC 9457 for Problem Details.
- OAuth2 and OpenID Connect documentation for auth modelling.

---

## 42. What Comes Next

Part 030 is the capstone.

In Part 030, we will take the same OpenAPI skillset into a more complex domain:

```text
Enforcement Lifecycle API Contract
```

That final part will include:

- complaint,
- investigation,
- subject,
- evidence,
- allegation,
- finding,
- enforcement action,
- appeal,
- closure,
- state machine modelling,
- permission model,
- auditability,
- redaction/disclosure,
- long-running operations,
- compatibility strategy,
- governance rules,
- final architecture review.

At that point, the series reaches the final integration layer.

---

# Status

```text
Current part: 029 / 030
Status: In progress
Series complete: No
Remaining parts: 1
Next: Part 030 — OpenAPI Mastery Capstone: Designing an Enforcement Lifecycle API Contract
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-028.md">⬅️ OpenAPI Mastery for Java Engineers — Part 028</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-030.md">OpenAPI Mastery for Java Engineers — Part 030 ➡️</a>
</div>
