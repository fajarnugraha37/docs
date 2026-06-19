# OpenAPI Mastery for Java Engineers — Part 020
# Governance: Style Guides, Linting, Review, Standards, and API Portfolio Control

> Seri: `learn-openapi-mastery-for-java-engineers`  
> Part: `020 / 030`  
> Fokus: membangun governance OpenAPI yang efektif, otomatis, risk-based, dan tidak berubah menjadi birokrasi yang membunuh delivery.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 019, kita sudah membahas bagaimana OpenAPI mendeskripsikan surface area API: paths, operations, parameters, request body, responses, components, schema, composition, examples, security, pagination, bulk operation, link, callback, webhook, dan async interaction.

Part ini naik satu level.

Kita tidak lagi hanya bertanya:

> “Bagaimana membuat satu OpenAPI document yang benar?”

Tetapi:

> “Bagaimana membuat banyak API di banyak team tetap konsisten, aman, evolvable, bisa direview, bisa diaudit, dan tidak saling menciptakan integrasi buruk?”

Itulah wilayah **API governance**.

Untuk Java engineer, governance sering terdengar seperti urusan arsitek enterprise, committee, approval board, atau dokumen standar yang jauh dari coding. Itu pemahaman yang lemah.

Governance yang baik justru sangat engineering-oriented:

- membuat constraint eksplisit,
- mengurangi keputusan berulang,
- mengotomasi rule yang bisa diotomasi,
- memaksa diskusi hanya pada hal yang benar-benar butuh judgement manusia,
- membuat API lebih mudah dipakai consumer,
- membuat perubahan lebih aman,
- membuat portfolio API dapat dipahami sebagai sistem.

Governance buruk menghasilkan birokrasi.

Governance baik menghasilkan **guardrail**.

---

## 1. Core Mental Model

API governance adalah mekanisme organisasi untuk menjaga agar API tetap:

1. **Consistent** — consumer tidak perlu belajar gaya API baru di setiap service.
2. **Understandable** — contract bisa dibaca oleh manusia dan tool.
3. **Secure by default** — auth, sensitive fields, dan error exposure punya standar.
4. **Evolvable** — perubahan bisa diklasifikasikan, dicegah, atau dimigrasikan.
5. **Observable** — ownership, lifecycle, dan impact bisa dilacak.
6. **Testable** — contract bisa divalidasi otomatis.
7. **Auditable** — keputusan desain dan perubahan penting punya jejak.

Governance bukan berarti semua API harus identik. Governance berarti variasi harus disengaja, bukan kebetulan.

### 1.1 Governance sebagai Control System

Pikirkan governance seperti control system:

```text
API design intent
      ↓
Style guide / standards
      ↓
Machine-checkable rules
      ↓
CI/CD gates
      ↓
Human review for judgement-heavy cases
      ↓
Published contract + catalog metadata
      ↓
Runtime feedback + consumer impact
      ↓
Improved standards
```

Tanpa feedback loop, governance menjadi dokumen mati.

Tanpa automation, governance menjadi review manual yang tidak scalable.

Tanpa exception process, governance menjadi kaku.

Tanpa ownership, governance menjadi nobody's problem.

---

## 2. Governance vs Bureaucracy

Banyak organisasi gagal karena menyamakan governance dengan approval.

Approval hanya satu mekanisme kecil.

Governance yang matang mencakup:

- standard definition,
- automated validation,
- review process,
- exception handling,
- lifecycle management,
- ownership mapping,
- cataloging,
- impact analysis,
- change policy,
- learning loop.

### 2.1 Governance yang Sehat

Ciri governance sehat:

- rule-nya jelas,
- sebagian besar rule bisa dicek otomatis,
- error message dari linting actionable,
- review manusia fokus pada semantic design,
- team tahu kenapa rule ada,
- ada cara meminta exception,
- exception punya expiry atau review ulang,
- standard berubah berdasarkan feedback nyata.

### 2.2 Governance yang Buruk

Ciri governance buruk:

- style guide panjang tapi tidak enforced,
- approval board menjadi bottleneck,
- reviewer memberi komentar subjektif tanpa rule eksplisit,
- API team belajar standard hanya saat PR ditolak,
- semua violation dianggap severity tinggi,
- tidak ada metadata ownership,
- tidak ada breaking-change gate,
- exception disimpan di chat, bukan di artifact.

### 2.3 Prinsip Penting

> Automate what is deterministic. Review what is semantic. Escalate what is risky.

Contoh deterministic:

- `operationId` wajib ada.
- response 4xx harus punya error schema.
- path parameter harus didefinisikan.
- schema name harus PascalCase.
- path tidak boleh mengandung verb tertentu.

Contoh semantic:

- apakah endpoint ini capability yang tepat?
- apakah resource boundary masuk akal?
- apakah field ini bocor dari domain internal?
- apakah state transition aman?
- apakah consumer bisa menangani failure mode?

Contoh risky:

- public API breaking change,
- perubahan auth scheme,
- perubahan error semantics,
- sensitive data exposure,
- migration untuk partner eksternal,
- deprecation field yang dipakai banyak consumer.

---

## 3. Apa yang Harus Digovern?

Governance OpenAPI bukan hanya formatting YAML.

Yang perlu digovern meliputi beberapa layer.

```text
Portfolio layer
  ownership, lifecycle, domain, classification, visibility

Design layer
  resource naming, operation shape, pagination, errors, async pattern

Contract layer
  schema, responses, examples, security, compatibility

Automation layer
  lint, validate, diff, generate, publish

Runtime alignment layer
  gateway policy, implementation conformance, monitoring, drift
```

### 3.1 Portfolio Layer

Pertanyaan:

- API ini milik team mana?
- Siapa technical owner?
- Siapa product/business owner?
- Apakah API ini internal, partner, atau public?
- Apakah API ini experimental, beta, stable, deprecated, atau retired?
- Apakah API membawa PII, financial data, health data, enforcement data, atau confidential data?
- Siapa consumer-nya?
- Apa SLA atau support expectation-nya?

OpenAPI standard tidak mendefinisikan semua metadata organisasi ini secara native. Biasanya organisasi memakai `x-` vendor extensions.

Contoh:

```yaml
x-api-owner:
  team: enforcement-platform
  slack: '#team-enforcement-platform'
  email: enforcement-platform@example.com

x-api-lifecycle: stable
x-api-visibility: internal
x-data-classification: confidential
x-domain: enforcement-case-management
x-consumers:
  - compliance-portal
  - investigation-mobile-app
  - partner-regulator-gateway
```

### 3.2 Design Layer

Hal-hal yang perlu distandarkan:

- path naming,
- resource pluralization,
- operation naming,
- pagination,
- filtering,
- sorting,
- idempotency,
- async job pattern,
- error format,
- correlation ID,
- versioning,
- deprecation,
- rate limit headers,
- authentication pattern,
- authorization scope naming.

### 3.3 Contract Layer

Hal-hal yang perlu divalidasi:

- OpenAPI document valid,
- `$ref` resolve,
- schema tidak ambiguous,
- examples valid terhadap schema,
- required fields jelas,
- nullable semantics benar,
- `operationId` stable,
- non-2xx responses terdokumentasi,
- security requirement jelas,
- breaking change dicek terhadap baseline.

### 3.4 Runtime Alignment Layer

Pertanyaan:

- Apakah implementation benar-benar sesuai OpenAPI?
- Apakah gateway menambahkan behavior yang tidak ada di contract?
- Apakah runtime error response sama dengan documented error model?
- Apakah endpoint yang dipublish di catalog sama dengan yang deploy?
- Apakah contract test memvalidasi response aktual?

Governance tidak boleh berhenti di file YAML.

---

## 4. Style Guide: Standar yang Bisa Dipakai Engineer

API style guide adalah dokumen standar desain API.

Namun style guide yang baik bukan kumpulan opini. Ia harus menjawab:

1. Apa rule-nya?
2. Kenapa rule itu ada?
3. Contoh benar.
4. Contoh salah.
5. Severity.
6. Apakah rule bisa diautomasi?
7. Bagaimana meminta exception?

### 4.1 Style Guide Minimum yang Berguna

Untuk organisasi yang baru mulai, style guide minimum harus mencakup:

- naming convention,
- path convention,
- operationId convention,
- request/response schema convention,
- error response standard,
- pagination standard,
- authentication/security standard,
- versioning/deprecation standard,
- examples requirement,
- lifecycle metadata.

### 4.2 Struktur Style Guide yang Baik

```md
# Rule: Operation IDs must be stable and unique

## Intent
Operation ID dipakai oleh generator, test automation, documentation anchors, dan traceability.
Mengubahnya dapat memutus generated client walaupun path/method tidak berubah.

## Rule
Every operation MUST define a unique `operationId`.
The value SHOULD follow `<verb><Resource>` or `<verb><Resource><Qualifier>`.

## Good
- `getCase`
- `listCases`
- `submitCaseEvidence`
- `approveEnforcementDecision`

## Bad
- `caseUsingGET`
- `getCase_1`
- `apiCasesIdGet`
- `doAction`

## Severity
Error for stable APIs. Warning for experimental APIs.

## Automation
Spectral rule: `operation-operationId` plus custom naming pattern.

## Exception
Allowed only for temporary generated specs during discovery phase.
Exception expires after 30 days.
```

### 4.3 Style Guide Harus Mengandung Reasoning

Rule tanpa reasoning akan dilawan engineer.

Bandingkan:

```text
Jangan pakai verb di path.
```

Dengan:

```text
Hindari verb di path untuk resource-oriented operations karena HTTP method sudah membawa action semantics. Namun domain commands yang bukan resource replacement dapat memakai action sub-resource seperti `/cases/{caseId}/submission` atau `/cases/{caseId}:submit` jika style guide organisasi mengizinkan explicit command pattern.
```

Versi kedua lebih matang karena mengakui trade-off.

---

## 5. Naming Standards

Naming bukan kosmetik. Naming adalah API usability.

Consumer membangun mental model dari nama.

### 5.1 Path Naming

Standar umum:

```yaml
Good:
  /cases
  /cases/{caseId}
  /cases/{caseId}/evidence
  /enforcement-actions/{actionId}

Bad:
  /getCases
  /case
  /case_details
  /api/v1/doCaseAction
  /cases/{id}/getEvidenceList
```

Prinsip:

- gunakan noun/resource,
- gunakan plural untuk collections,
- gunakan kebab-case untuk path segments,
- gunakan parameter name yang spesifik (`caseId`, bukan hanya `id`),
- jangan bocorkan nama table atau service internal,
- jangan menyimpan versioning campur aduk tanpa policy.

### 5.2 Schema Naming

Contoh standar:

```text
CaseSummary
CaseDetail
CreateCaseRequest
UpdateCaseRequest
CaseResponse
CaseEvidence
ValidationError
ProblemDetail
```

Hindari:

```text
CaseDto
CaseEntity
CaseVO
CommonResponse
ApiResponse
BaseModel
Object1
CaseData
```

Alasan:

- `Dto`, `Entity`, `VO` adalah istilah implementation-side.
- `CommonResponse` biasanya terlalu generik.
- `BaseModel` sering menjadi tempat coupling tersembunyi.
- `Object1` muncul dari generator buruk atau desain yang belum selesai.

### 5.3 Field Naming

Pilih satu style dan enforce:

```yaml
camelCase:
  caseId
  createdAt
  enforcementActionId

snake_case:
  case_id
  created_at
  enforcement_action_id
```

Dalam ekosistem Java + JSON modern, `camelCase` sering lebih natural karena cocok dengan Java property naming dan banyak frontend convention. Namun organisasi bisa memilih `snake_case` untuk public API jika itu standar historis. Yang penting konsisten.

### 5.4 Enum Naming

Contoh:

```yaml
CaseStatus:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - UNDER_REVIEW
    - DECIDED
    - CLOSED
```

Governance rule yang perlu dipikirkan:

- apakah enum value uppercase?
- apakah enum boleh berubah?
- bagaimana consumer harus menangani unknown enum value?
- apakah volatile business configuration sebaiknya enum atau reference data endpoint?

Enum adalah area compatibility risk yang besar.

---

## 6. Error Standard

Error model harus distandarkan sedini mungkin.

Kalau tidak, setiap service akan membuat bentuk error sendiri:

```json
{ "message": "Invalid request" }
```

```json
{ "error": "BAD_REQUEST", "details": [] }
```

```json
{ "status": 400, "code": "1002", "msg": "Bad field" }
```

```json
{ "success": false, "data": null, "errorMessage": "Invalid" }
```

Akibatnya consumer harus membuat adapter berbeda untuk setiap API.

### 6.1 Problem Details sebagai Baseline

Untuk HTTP APIs modern, gunakan media type seperti:

```text
application/problem+json
```

Bentuk umum:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request body contains invalid fields.",
  "instance": "/cases/CASE-2026-0001",
  "traceId": "01J...",
  "errors": [
    {
      "field": "subject.dateOfBirth",
      "code": "DATE_IN_FUTURE",
      "message": "Date of birth cannot be in the future."
    }
  ]
}
```

### 6.2 Governance Rules untuk Error

Minimum rule:

- semua operation harus mendokumentasikan error response umum,
- 400 harus memakai validation error schema bila request punya input,
- 401/403 harus jelas bila endpoint protected,
- 404 harus jelas apakah resource tidak ada atau tidak visible,
- 409 harus dipakai untuk conflict/domain state conflict,
- 429 harus mendokumentasikan rate limit bila applicable,
- 5xx boleh generic, tapi harus punya correlation/trace ID,
- error tidak boleh membocorkan stack trace, SQL, class name, internal hostname.

### 6.3 Reusable Error Components

```yaml
components:
  schemas:
    ProblemDetail:
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
        traceId:
          type: string

    ValidationProblemDetail:
      allOf:
        - $ref: '#/components/schemas/ProblemDetail'
        - type: object
          required: [errors]
          properties:
            errors:
              type: array
              items:
                $ref: '#/components/schemas/FieldError'

    FieldError:
      type: object
      required: [field, code]
      properties:
        field:
          type: string
        code:
          type: string
        message:
          type: string
```

### 6.4 Anti-Pattern: Generic Success Wrapper

Banyak Java backend memakai:

```json
{
  "success": true,
  "data": { ... },
  "message": "OK"
}
```

Lalu untuk error:

```json
{
  "success": false,
  "data": null,
  "message": "Invalid request"
}
```

Masalah:

- HTTP status semantics menjadi kabur,
- generated clients kurang berguna,
- error handling tidak standard,
- observability lebih sulit,
- consumer harus parse body untuk tahu success/failure,
- caching/proxy/gateway behavior bisa terganggu.

Governance harus melarang pola ini kecuali ada alasan legacy yang kuat.

---

## 7. Pagination Standard

List endpoint yang tidak distandarkan akan menyusahkan consumer.

### 7.1 Pilih Pattern Berdasarkan Use Case

Offset pagination:

```http
GET /cases?page=0&size=50
```

Cocok untuk:

- data relatif stabil,
- admin UI sederhana,
- low churn dataset,
- internal tooling.

Cursor pagination:

```http
GET /cases?limit=50&cursor=eyJ...
```

Cocok untuk:

- high-churn dataset,
- large dataset,
- infinite scroll,
- event-like ordering,
- public/partner API.

Keyset pagination:

```http
GET /cases?limit=50&afterCreatedAt=2026-06-01T00:00:00Z&afterCaseId=CASE-001
```

Cocok untuk:

- stable sort,
- predictable performance,
- database-friendly pagination.

### 7.2 Governance Rule

Contoh rule:

```text
All collection endpoints MUST use one of the approved pagination profiles:

1. offset-page-profile
2. cursor-page-profile
3. keyset-page-profile

Unpaginated collection responses are prohibited for stable APIs unless the maximum cardinality is contractually bounded and documented.
```

### 7.3 Standard Envelope

Cursor example:

```yaml
CaseListResponse:
  type: object
  required: [items, page]
  properties:
    items:
      type: array
      items:
        $ref: '#/components/schemas/CaseSummary'
    page:
      $ref: '#/components/schemas/CursorPage'

CursorPage:
  type: object
  required: [limit, hasNext]
  properties:
    limit:
      type: integer
      minimum: 1
      maximum: 200
    nextCursor:
      type: string
    hasNext:
      type: boolean
```

### 7.4 Governance Checklist untuk List APIs

- Apakah pagination wajib?
- Apakah default `limit` terdokumentasi?
- Apakah maximum `limit` terdokumentasi?
- Apakah sort order default stabil?
- Apakah cursor opaque?
- Apakah cursor expiry dijelaskan?
- Apakah filtering mempengaruhi cursor validity?
- Apakah response envelope konsisten?

---

## 8. Security Standard

Security governance bukan hanya “semua endpoint harus pakai bearer token”.

Hal yang harus distandarkan:

- authentication scheme,
- authorization scopes,
- public endpoint policy,
- machine-to-machine policy,
- user-context propagation,
- sensitive data annotation,
- error behavior untuk 401/403,
- security examples,
- token audience/issuer expectation,
- operation-level overrides.

### 8.1 Security Scheme Example

```yaml
components:
  securitySchemes:
    OAuth2ClientCredentials:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/oauth2/token
          scopes:
            cases:read: Read case records
            cases:write: Create and update case records
            evidence:write: Upload case evidence

security:
  - OAuth2ClientCredentials: []
```

Operation-level:

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      security:
        - OAuth2ClientCredentials:
            - cases:read
```

### 8.2 Scope Naming

Bad:

```text
read
write
admin
case
user
all
```

Better:

```text
cases:read
cases:write
evidence:upload
enforcement-decisions:approve
audit-events:read
```

### 8.3 Sensitive Field Metadata

OpenAPI tidak punya standard universal untuk data classification per field. Vendor extension dapat dipakai.

```yaml
Subject:
  type: object
  properties:
    nationalId:
      type: string
      x-data-classification: restricted
      x-pii: true
    fullName:
      type: string
      x-data-classification: confidential
      x-pii: true
    publicReference:
      type: string
      x-data-classification: public
```

Governance rule:

- restricted fields harus punya explicit justification,
- restricted fields tidak boleh muncul di list summary kecuali approved,
- examples tidak boleh memakai realistic sensitive data,
- error responses tidak boleh echo sensitive input.

---

## 9. Versioning and Deprecation Standard

Tanpa standard, versioning akan menjadi campuran:

```text
/v1/cases
/v2/cases
/cases?version=2
Accept: application/vnd.example.case.v2+json
X-Api-Version: 2
/cases-new
/casesV2
```

Governance harus menetapkan policy.

### 9.1 Versioning Decision

Tidak ada satu strategi terbaik untuk semua organisasi.

Common options:

1. URL versioning:
   ```http
   /v1/cases
   ```

2. Header versioning:
   ```http
   X-API-Version: 2026-06-01
   ```

3. Media type versioning:
   ```http
   Accept: application/vnd.example.cases.v2+json
   ```

4. No major version until breaking change:
   ```http
   /cases
   ```

5. Capability/date based versioning:
   ```http
   API-Version: 2026-06-01
   ```

### 9.2 Deprecation Governance

Deprecation harus punya lifecycle:

```text
proposed → active → deprecated → sunset-announced → retired
```

Metadata example:

```yaml
paths:
  /legacy-cases/{caseId}:
    get:
      operationId: getLegacyCase
      deprecated: true
      x-sunset-date: '2026-12-31'
      x-replacement-operationId: getCase
      x-deprecation-reason: Legacy case representation leaks internal workflow state.
```

### 9.3 Deprecation Checklist

- Apa replacement endpoint/schema?
- Siapa consumer terdampak?
- Apakah ada migration guide?
- Apakah ada sunset date?
- Apakah runtime mengirim deprecation/sunset signal?
- Apakah monitoring membuktikan consumer lama sudah turun?
- Apakah contract test untuk legacy endpoint tetap ada sampai retired?

---

## 10. Linting: Mengubah Style Guide Menjadi Guardrail

Linting adalah proses mengecek OpenAPI document terhadap rule.

Spectral adalah salah satu tool populer untuk linting JSON/YAML API descriptions dan punya built-in support untuk OpenAPI, AsyncAPI, dan Arazzo. Dokumentasi Spectral menekankan custom rulesets sebagai cara membuat automated style guides.

### 10.1 Jenis Rule

1. Structural validity:
   - OpenAPI document valid.
   - `$ref` bisa resolve.
   - required fields ada.

2. Style consistency:
   - path casing,
   - schema naming,
   - operationId naming,
   - tag description.

3. Design quality:
   - operation harus punya non-2xx response,
   - request body harus punya schema,
   - list endpoint harus punya pagination,
   - error response harus standard.

4. Security quality:
   - protected endpoint harus punya security requirement,
   - no API key in query untuk stable API,
   - examples tidak mengandung fake secrets.

5. Governance metadata:
   - owner wajib ada,
   - lifecycle wajib ada,
   - classification wajib ada,
   - public API harus punya contact.

### 10.2 Severity

Gunakan severity bertingkat:

```text
error   → must fix before merge
warn    → should fix, can merge with justification
info    → advisory
hint    → educational
```

Jangan jadikan semua rule sebagai error. Itu akan membuat engineer mem-bypass linting.

### 10.3 Spectral Ruleset Example

```yaml
extends:
  - spectral:oas

rules:
  operation-operationId-required:
    description: Every operation must have an operationId.
    message: Operation must define a stable operationId for generation, tests, and traceability.
    severity: error
    given: $.paths[*][get,put,post,delete,patch,options,head,trace]
    then:
      field: operationId
      function: truthy

  operation-operationId-format:
    description: operationId should use lower camelCase.
    message: operationId must be lowerCamelCase, e.g. listCases or submitCaseEvidence.
    severity: warn
    given: $.paths[*][get,put,post,delete,patch,options,head,trace].operationId
    then:
      function: pattern
      functionOptions:
        match: '^[a-z][A-Za-z0-9]*$'

  paths-kebab-case:
    description: Path segments should use kebab-case unless they are path parameters.
    severity: warn
    given: $.paths[*]~
    then:
      function: pattern
      functionOptions:
        match: '^(/[a-z0-9{}.-]+(-[a-z0-9{}.-]+)*)+$'

  no-undocumented-default-error-only:
    description: Operations must document specific error responses, not only default.
    severity: warn
    given: $.paths[*][get,put,post,delete,patch]
    then:
      field: responses
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
```

Catatan: rule linting harus diuji terhadap real specs. Jangan mengasumsikan rule pertama langsung benar.

### 10.4 Linting di Local Dev

Developer harus bisa menjalankan linting sebelum push.

Contoh script:

```bash
spectral lint openapi.yaml
```

Dengan npm script:

```json
{
  "scripts": {
    "openapi:lint": "spectral lint api/openapi.yaml"
  }
}
```

Dengan Makefile:

```makefile
openapi-lint:
	spectral lint api/openapi.yaml
```

### 10.5 Linting di CI

CI harus menjalankan:

```text
validate → lint → bundle → diff → publish preview
```

Contoh pseudo pipeline:

```yaml
openapi-check:
  steps:
    - checkout
    - install tools
    - openapi validate api/openapi.yaml
    - spectral lint api/openapi.yaml
    - bundle api/openapi.yaml > dist/openapi.bundle.yaml
    - oasdiff breaking base.yaml dist/openapi.bundle.yaml
    - publish preview docs
```

---

## 11. Rule Design: Jangan Semua Diotomasi Secara Naif

Rule yang buruk bisa lebih merusak daripada tidak ada rule.

### 11.1 Contoh Rule Buruk

```text
All paths must not contain verbs.
```

Masalah:

- command-style API kadang valid,
- workflow transitions kadang lebih jelas sebagai action,
- beberapa domain tidak resource-pure.

Better:

```text
Resource collection and item paths SHOULD use nouns.
Command operations MUST use approved command pattern and justify state transition semantics.
```

### 11.2 Rule Harus Punya Escape Hatch

Contoh:

```yaml
x-governance-exception:
  rule: no-verbs-in-path
  reason: submit is a domain command that initiates irreversible regulatory workflow transition.
  approvedBy: api-governance-board
  approvedAt: '2026-06-20'
  expiresAt: '2026-12-20'
```

Exception bukan kelemahan. Exception yang tercatat adalah governance matang.

### 11.3 Rule Harus Risk-Based

Stable public API:

- strict lint,
- breaking change gate wajib,
- human review wajib untuk new operation,
- security review wajib.

Experimental internal API:

- lint warning boleh,
- breaking change gate bisa soft,
- owner metadata tetap wajib,
- docs preview tetap berguna.

---

## 12. Human Review: Apa yang Tidak Bisa Digantikan Linter

Linter bisa mengecek bentuk. Reviewer mengecek makna.

### 12.1 Review Checklist untuk New Endpoint

Pertanyaan desain:

- Capability apa yang diberikan endpoint ini?
- Apakah operation ini milik resource yang tepat?
- Apakah path mencerminkan domain language, bukan implementation detail?
- Apakah request schema membedakan create/update/command?
- Apakah response cukup untuk consumer melakukan next action?
- Apakah errors membantu consumer recover?
- Apakah endpoint idempotent atau tidak?
- Apakah concurrency conflict dimodelkan?
- Apakah security requirement jelas?
- Apakah field sensitive muncul di tempat yang tepat?
- Apakah endpoint ini perlu pagination?
- Apakah lifecycle state berubah?
- Apakah operation ini akan sulit dievolusi?

### 12.2 Review Checklist untuk Schema

- Apakah schema merepresentasikan API contract, bukan JPA entity?
- Apakah required fields benar-benar required dari perspektif consumer?
- Apakah nullable semantics jelas?
- Apakah enum stable?
- Apakah additionalProperties disengaja?
- Apakah examples valid dan realistis?
- Apakah field readOnly/writeOnly benar?
- Apakah field deprecated punya replacement?

### 12.3 Review Checklist untuk Breaking Change

- Apakah diff tool mendeteksi breaking change?
- Apakah ada semantic breaking change yang tidak terdeteksi tool?
- Siapa consumer terdampak?
- Apakah migration path tersedia?
- Apakah version bump/deprecation diperlukan?
- Apakah release note jelas?
- Apakah generated SDK akan berubah secara breaking?

---

## 13. Pull Request Workflow

Governance yang baik harus dekat dengan workflow engineer.

### 13.1 Recommended PR Flow

```text
Engineer changes OpenAPI
      ↓
Local lint + validation
      ↓
Open PR
      ↓
CI validates OpenAPI
      ↓
CI lints style rules
      ↓
CI bundles spec
      ↓
CI compares against baseline
      ↓
CI publishes docs preview
      ↓
Reviewer checks semantic design
      ↓
Merge
      ↓
Spec artifact published
      ↓
Catalog updated
```

### 13.2 PR Template

```md
## API Change Summary

What changed?

## Change Type

- [ ] New API
- [ ] New operation
- [ ] Additive change
- [ ] Breaking change
- [ ] Deprecation
- [ ] Documentation/example only

## Consumer Impact

Known consumers:

Potential impact:

## Compatibility

- [ ] No breaking change detected
- [ ] Breaking change detected and approved
- [ ] Semantic compatibility reviewed

## Security/Data Classification

- [ ] No new sensitive fields
- [ ] Sensitive fields reviewed
- [ ] Security requirements documented

## Testing

- [ ] OpenAPI validation passed
- [ ] Lint passed
- [ ] Examples validate
- [ ] Contract tests updated

## Governance Exceptions

List exceptions and expiry dates.
```

### 13.3 Docs Preview in PR

Setiap PR OpenAPI sebaiknya menghasilkan preview dokumentasi.

Kenapa?

Karena reviewer manusia lebih mudah menemukan problem desain ketika melihat API seperti consumer melihatnya, bukan hanya YAML diff.

---

## 14. API Catalog

Ketika API bertambah banyak, repository dan Swagger UI per service tidak cukup.

Butuh API catalog.

Catalog menjawab:

- API apa saja yang organisasi punya?
- Siapa owner-nya?
- Apa status lifecycle-nya?
- Bagaimana cara mengaksesnya?
- Apakah internal/partner/public?
- Versi mana yang stable?
- Apa dependency antar API?
- Consumer mana yang memakai API itu?
- API mana yang deprecated?

### 14.1 Metadata yang Wajib Ada

```yaml
info:
  title: Enforcement Case API
  version: 1.8.0
  description: API for managing regulatory enforcement case lifecycle.
  contact:
    name: Enforcement Platform Team
    email: enforcement-platform@example.com

x-api-id: enforcement-case-api
x-api-owner:
  team: enforcement-platform
  system: case-management-platform
x-api-lifecycle: stable
x-api-visibility: internal
x-api-domain: regulatory-enforcement
x-api-criticality: high
x-data-classification: confidential
```

### 14.2 Catalog Quality Rules

- API tanpa owner tidak boleh publish.
- API tanpa lifecycle tidak boleh publish.
- Deprecated API harus punya sunset/migration metadata.
- Public/partner API harus punya contact dan support policy.
- High-criticality API harus punya stricter governance checks.

---

## 15. Ownership Model

Governance gagal kalau semua orang mengira orang lain bertanggung jawab.

### 15.1 Ownership Roles

1. **API Producer Team**
   - membuat dan memelihara implementation,
   - menjaga contract sesuai runtime,
   - menangani consumer support.

2. **API Product Owner**
   - menentukan business capability,
   - memutuskan lifecycle dan consumer policy,
   - menerima/mengelola deprecation.

3. **API Platform Team**
   - menyediakan tools,
   - linting rules,
   - catalog,
   - CI templates,
   - generation pipeline.

4. **API Governance Group**
   - mendefinisikan standard,
   - review exception,
   - memutuskan risky changes,
   - menjaga consistency lintas domain.

5. **Security/Compliance Reviewer**
   - meninjau sensitive data,
   - auth/authorization patterns,
   - audit evidence untuk high-risk systems.

### 15.2 RACI Example

```text
Activity                         Producer  Platform  Governance  Security
Design new endpoint              R/A       C         C           C
Linting rules maintenance         C         R/A       C           C
Breaking change approval          R         C         A           C
Sensitive data exposure review    R         C         C           A
Catalog publishing                R         R         C           C
Deprecation communication          R/A       C         C           C
```

R = Responsible  
A = Accountable  
C = Consulted

---

## 16. Lifecycle Management

API tidak hanya “ada” atau “tidak ada”.

Gunakan lifecycle state.

```text
proposed
  ↓
experimental
  ↓
beta
  ↓
stable
  ↓
deprecated
  ↓
retired
```

### 16.1 Proposed

Ciri:

- belum diimplementasikan,
- dipakai untuk design review,
- mock boleh ada,
- breaking change bebas.

Governance:

- style lint warning cukup,
- semantic review penting,
- no consumer dependency.

### 16.2 Experimental

Ciri:

- bisa dipakai internal terbatas,
- contract belum dijamin stabil,
- consumer harus tahu risiko.

Governance:

- owner wajib,
- lifecycle wajib,
- docs jelas menyatakan experimental.

### 16.3 Beta

Ciri:

- hampir stabil,
- consumer nyata mulai onboard,
- breaking change harus dikontrol.

Governance:

- breaking change warning,
- consumer notification,
- examples wajib.

### 16.4 Stable

Ciri:

- production commitment,
- compatibility policy berlaku,
- deprecation process wajib.

Governance:

- strict lint,
- breaking change gate,
- semantic review,
- catalog publish,
- owner/contact wajib.

### 16.5 Deprecated

Ciri:

- masih berjalan,
- tidak direkomendasikan untuk consumer baru,
- replacement harus ada.

Governance:

- `deprecated: true`,
- sunset date,
- migration guide,
- usage monitoring.

### 16.6 Retired

Ciri:

- endpoint/API sudah tidak tersedia.

Governance:

- catalog record bisa disimpan untuk audit,
- contract archived,
- consumer migration complete.

---

## 17. Exception Process

Tanpa exception process, engineer akan mencari bypass.

Dengan exception process yang sehat, standar tetap kuat tapi realistis.

### 17.1 Exception Harus Berisi

- rule yang dilanggar,
- alasan,
- scope,
- approver,
- tanggal approval,
- expiry date,
- mitigation,
- follow-up action.

Contoh:

```yaml
x-governance-exceptions:
  - rule: cursor-pagination-required
    scope: GET /countries
    reason: Reference data is bounded to ISO country list and cardinality is stable.
    approvedBy: api-governance
    approvedAt: '2026-06-20'
    expiresAt: '2027-06-20'
    mitigation: Maximum cardinality documented in operation description.
```

### 17.2 Exception Harus Bisa Diaudit

Jangan simpan exception hanya di Slack.

Simpan di:

- OpenAPI extension,
- PR discussion,
- governance decision log,
- ADR,
- catalog metadata.

---

## 18. API Scorecards

Scorecard membantu melihat kualitas API secara portfolio-level.

Contoh score dimensions:

```text
Contract completeness        0-100
Style compliance             0-100
Security documentation       0-100
Error model consistency      0-100
Example validity             0-100
Breaking-change discipline   0-100
Ownership metadata           0-100
Lifecycle metadata           0-100
```

### 18.1 Contoh Rule Score

```text
+10 all operations have operationId
+10 all operations have summary
+10 all request bodies have schema
+10 all responses have schema where body exists
+10 all examples validate
+10 all operations document non-2xx responses
+10 security requirement documented
+10 owner metadata exists
+10 lifecycle metadata exists
+10 no unresolved governance exception
```

Scorecard bukan untuk mempermalukan team. Gunakan untuk prioritas improvement.

---

## 19. Cross-Team Consistency

Di microservices environment, masalah bukan satu API jelek. Masalahnya adalah variasi tanpa alasan.

Contoh inkonsistensi:

```text
Service A: /cases/{caseId}/evidence
Service B: /investigations/{id}/evidences
Service C: /api/v1/getEvidenceByInvestigation
Service D: /Evidence/Search
```

Atau error:

```text
Service A returns RFC Problem Details.
Service B returns { errorCode, errorMessage }.
Service C returns 200 with success=false.
Service D returns HTML error from gateway.
```

Governance mengurangi cognitive load consumer.

### 19.1 Platform-Level Reusable Components

Organisasi bisa memiliki shared components:

```yaml
components:
  schemas:
    ProblemDetail: ...
    ValidationProblemDetail: ...
    CursorPage: ...
    OffsetPage: ...
    AuditMetadata: ...
  parameters:
    CorrelationIdHeader: ...
    IdempotencyKeyHeader: ...
  responses:
    BadRequest: ...
    Unauthorized: ...
    Forbidden: ...
    Conflict: ...
    TooManyRequests: ...
```

Tapi hati-hati: shared component harus stabil dan minimal. Jangan membuat mega shared schema yang mengikat semua service.

---

## 20. Governance untuk Regulated Systems

Untuk sistem regulatory, case management, enforcement lifecycle, atau domain high-risk, governance punya fungsi tambahan: defensibility.

Pertanyaan penting:

- Apakah API contract membuktikan field apa yang bisa diakses actor tertentu?
- Apakah state transition operation terdokumentasi?
- Apakah error semantics tidak misleading?
- Apakah sensitive data diklasifikasikan?
- Apakah deprecation/change punya approval trace?
- Apakah contract version yang dipakai saat keputusan tertentu bisa direkonstruksi?
- Apakah evidence upload/download endpoint punya metadata security?
- Apakah audit endpoints membedakan internal audit vs external disclosure?

### 20.1 Example: Enforcement State Transition

```yaml
/cases/{caseId}/submission:
  post:
    operationId: submitCase
    summary: Submit a draft case for formal review.
    description: |
      Transitions a case from DRAFT to SUBMITTED.
      This operation is irreversible for non-admin users and records an audit event.
    x-state-transition:
      from: DRAFT
      to: SUBMITTED
      reversible: false
      auditRequired: true
    responses:
      '202':
        description: Case submission accepted for processing.
      '409':
        description: Case cannot be submitted from its current state.
```

Governance rule:

```text
Any operation that changes regulatory lifecycle state MUST declare x-state-transition metadata and document conflict response.
```

Ini bukan standard OpenAPI native, tapi sangat berguna untuk high-risk internal governance.

---

## 21. Governance Maturity Model

### Level 0 — Ad Hoc

- Swagger UI ada karena framework generate otomatis.
- Tidak ada style guide.
- Tidak ada linting.
- Breaking change diketahui setelah consumer rusak.

### Level 1 — Documented

- Ada style guide.
- Ada contoh spec.
- Review masih manual.
- Compliance bergantung pada goodwill.

### Level 2 — Automated Basics

- OpenAPI validation di CI.
- Basic linting.
- OperationId, schema naming, response presence dicek.
- Docs preview ada.

### Level 3 — Compatibility Governance

- Diff/breaking change detection.
- Lifecycle metadata.
- Deprecation process.
- Consumer notification.
- Catalog mulai dipakai.

### Level 4 — Portfolio Governance

- Ownership jelas.
- API catalog lengkap.
- Scorecards.
- Shared standards.
- Exception process.
- Cross-team review.

### Level 5 — Runtime-Aligned Governance

- Contract tests memastikan implementation sesuai spec.
- Runtime monitoring mendeteksi undocumented behavior.
- Gateway policy sinkron dengan contract.
- API usage memandu deprecation.
- Governance rules diperbaiki berdasarkan incident dan feedback.

Target realistis banyak organisasi: Level 3–4.

Level 5 hanya masuk akal untuk platform besar, public APIs, regulated systems, atau organisasi dengan API sebagai product utama.

---

## 22. Practical Implementation Roadmap

### Phase 1 — Stabilize the Basics

Deliverables:

- choose OpenAPI version baseline,
- define repository layout,
- require valid OpenAPI document,
- require operationId,
- require owner metadata,
- require standard error schema,
- introduce linting.

### Phase 2 — Standardize Common Patterns

Deliverables:

- pagination standard,
- filtering/sorting standard,
- idempotency header standard,
- correlation ID standard,
- security scheme standard,
- schema naming standard,
- examples standard.

### Phase 3 — Add Compatibility Gates

Deliverables:

- baseline spec storage,
- diff tool in CI,
- breaking change classification,
- semantic review checklist,
- versioning and deprecation policy.

### Phase 4 — Publish and Catalog

Deliverables:

- docs preview per PR,
- catalog publishing,
- lifecycle metadata,
- owner/contact metadata,
- consumer mapping.

### Phase 5 — Runtime Alignment

Deliverables:

- provider contract tests,
- response validation in integration tests,
- gateway/spec drift checks,
- runtime API discovery comparison,
- incident feedback into rules.

---

## 23. Concrete Governance Folder Structure

Example repo:

```text
api-governance/
  README.md
  style-guide/
    naming.md
    errors.md
    pagination.md
    security.md
    versioning.md
    deprecation.md
    examples.md
  rulesets/
    spectral.yaml
    spectral-regulated.yaml
    spectral-public-api.yaml
  components/
    common-errors.yaml
    pagination.yaml
    headers.yaml
    security-schemes.yaml
  templates/
    openapi-template.yaml
    pr-template.md
    adr-template.md
  examples/
    good-case-api.yaml
    bad-case-api.yaml
  decisions/
    ADR-0001-api-error-standard.md
    ADR-0002-pagination-standard.md
```

Service repo:

```text
enforcement-case-service/
  api/
    openapi.yaml
    examples/
      create-case-request.json
      validation-error-response.json
  src/
  build.gradle
  .spectral.yaml
  .github/
    workflows/
      openapi-check.yml
```

---

## 24. Example: Minimal Organization Ruleset

```yaml
extends:
  - spectral:oas

rules:
  api-info-contact-required:
    description: APIs must declare contact information.
    severity: error
    given: $.info
    then:
      field: contact
      function: truthy

  api-owner-required:
    description: APIs must declare owning team.
    severity: error
    given: $
    then:
      field: x-api-owner
      function: truthy

  api-lifecycle-required:
    description: APIs must declare lifecycle state.
    severity: error
    given: $
    then:
      field: x-api-lifecycle
      function: enumeration
      functionOptions:
        values:
          - proposed
          - experimental
          - beta
          - stable
          - deprecated
          - retired

  operation-summary-required:
    description: Every operation should have a summary.
    severity: warn
    given: $.paths[*][get,put,post,delete,patch,options,head,trace]
    then:
      field: summary
      function: truthy

  operation-must-have-error-response:
    description: Stable operations should document at least one non-2xx response.
    severity: warn
    given: $.paths[*][get,put,post,delete,patch]
    then:
      field: responses
      function: schema
      functionOptions:
        schema:
          type: object
          patternProperties:
            '^[45][0-9][0-9]$': {}
          minProperties: 2

  no-query-api-key:
    description: API keys in query parameters are not allowed for stable APIs.
    severity: error
    given: $.components.securitySchemes[*]
    then:
      function: schema
      functionOptions:
        schema:
          not:
            type: object
            required: [type, in]
            properties:
              type:
                const: apiKey
              in:
                const: query
```

Catatan: ruleset production biasanya butuh refinement dan test cases. Jangan copy-paste tanpa validasi.

---

## 25. Anti-Patterns

### 25.1 PDF Style Guide Nobody Enforces

Masalah:

- engineer tidak baca,
- reviewer tidak konsisten,
- violation ditemukan terlambat,
- rule tidak bisa diuji.

Solusi:

- ubah rule deterministic menjadi lint,
- sertakan examples,
- hubungkan style guide dengan CI.

### 25.2 Manual Review Only

Masalah:

- reviewer capek,
- komentar berulang,
- subjektif,
- bottleneck.

Solusi:

- automate basic checks,
- reviewer fokus semantic design.

### 25.3 One-Size-Fits-All Governance

Masalah:

- experimental internal API diperlakukan seperti public banking API,
- delivery lambat,
- team mencari bypass.

Solusi:

- risk-based policy,
- lifecycle-aware severity,
- public/partner/internal profile.

### 25.4 Over-Linting

Masalah:

- terlalu banyak warning,
- developer ignore semua,
- noise lebih besar dari signal.

Solusi:

- mulai dari sedikit rule high-value,
- naikkan severity bertahap,
- ukur false positive.

### 25.5 Governance Without Ownership

Masalah:

- API orphan,
- consumer tidak tahu kontak,
- deprecation gagal,
- incident lambat.

Solusi:

- owner metadata wajib,
- catalog enforcement,
- periodic ownership review.

### 25.6 Governance Detached from Runtime

Masalah:

- spec bagus, implementation berbeda,
- gateway transform tidak terdokumentasi,
- runtime error tidak sesuai schema.

Solusi:

- contract test,
- response validation,
- gateway policy review,
- runtime drift detection.

---

## 26. Governance Checklist

### For Every API

- [ ] `info.title` jelas.
- [ ] `info.version` jelas.
- [ ] `info.contact` ada.
- [ ] Owner metadata ada.
- [ ] Lifecycle metadata ada.
- [ ] Visibility metadata ada.
- [ ] Data classification metadata ada jika relevant.
- [ ] OpenAPI document valid.
- [ ] `$ref` resolve.
- [ ] Lint passed.
- [ ] Docs preview tersedia.

### For Every Operation

- [ ] `operationId` stable dan unique.
- [ ] `summary` jelas.
- [ ] `description` menjelaskan semantics bila operation kompleks.
- [ ] Parameters lengkap.
- [ ] Request body schema jelas jika ada.
- [ ] Success response terdokumentasi.
- [ ] Error responses terdokumentasi.
- [ ] Security requirement jelas.
- [ ] Examples ada untuk operation penting.
- [ ] Deprecation metadata ada jika deprecated.

### For Every Schema

- [ ] Nama schema tidak implementation-leaking.
- [ ] Required fields benar.
- [ ] Nullable semantics jelas.
- [ ] Enum stabil atau punya evolution plan.
- [ ] Sensitive field diberi metadata jika diperlukan.
- [ ] No accidental entity exposure.
- [ ] Examples valid.

### For Every Breaking Change

- [ ] Tool diff dijalankan.
- [ ] Semantic impact direview.
- [ ] Consumer terdampak diketahui.
- [ ] Migration path tersedia.
- [ ] Deprecation/versioning policy diikuti.
- [ ] Approval tercatat.

---

## 27. Java Engineer Perspective

Sebagai Java engineer, governance OpenAPI sering terasa jauh dari kode. Padahal banyak problem governance muncul karena kebiasaan Java backend:

### 27.1 Annotation-Generated Spec Tanpa Review

Springdoc bisa sangat membantu, tetapi generated spec dari annotation bukan otomatis good contract.

Risiko:

- DTO internal bocor,
- error response tidak lengkap,
- operationId buruk,
- nullable/required salah,
- examples tidak ada,
- generated schema mengikuti Jackson behavior yang tidak disengaja.

Governance response:

- generated spec tetap harus lint,
- generated spec harus di-bundle dan direview,
- response contract harus diuji,
- annotation harus diperlakukan sebagai contract surface.

### 27.2 JPA Entity Exposure

Bad:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable UUID id) { ... }
```

Governance harus melarang schema yang mencerminkan persistence model.

Better:

```java
@GetMapping("/cases/{caseId}")
public CaseDetailResponse getCase(@PathVariable String caseId) { ... }
```

### 27.3 Generic Response Wrapper

Bad:

```java
ResponseEntity<ApiResponse<CaseDetailResponse>>
```

Governance harus menentukan kapan wrapper boleh, dan biasanya untuk REST/HTTP APIs modern lebih baik menggunakan HTTP semantics dan standard error model.

### 27.4 Bean Validation Mismatch

Java validation annotation tidak selalu cukup untuk OpenAPI semantics.

Contoh:

```java
@NotNull
private String status;
```

Pertanyaan governance:

- Apakah status required di request create?
- Atau readOnly server-generated?
- Apakah enum value stable?
- Apakah null berbeda dari missing?

---

## 28. Mini Case Study: Enforcement Case API Governance

Bayangkan organisasi punya beberapa API:

```text
case-api
evidence-api
decision-api
audit-api
disclosure-api
partner-submission-api
```

Tanpa governance:

- case-api memakai `caseId`, evidence-api memakai `id`, decision-api memakai `case_id`,
- error shape berbeda,
- evidence upload tidak punya file size contract,
- decision approval tidak mendokumentasikan 409 conflict,
- partner API tidak punya sunset policy,
- audit API membocorkan internal actor ID,
- generated clients berubah karena operationId berubah.

Dengan governance:

- semua operation punya stable `operationId`,
- semua lifecycle transition punya `x-state-transition`,
- semua sensitive fields punya classification,
- semua list endpoint pakai pagination profile,
- semua error response pakai Problem Details,
- all breaking changes gated,
- catalog tahu owner dan consumer,
- deprecation punya migration path.

Contoh governance extension:

```yaml
x-api-domain: regulatory-enforcement
x-api-criticality: high
x-api-lifecycle: stable
x-data-classification: confidential
x-required-reviews:
  - api-governance
  - security
  - compliance
```

---

## 29. Practical Exercises

### Exercise 1 — Build a Mini Style Guide

Buat style guide 2 halaman untuk API internal dengan sections:

- path naming,
- operationId,
- errors,
- pagination,
- security,
- lifecycle metadata.

Untuk setiap rule, tulis:

- intent,
- good example,
- bad example,
- severity,
- automatable or not.

### Exercise 2 — Write 5 Spectral Rules

Buat rule untuk:

1. owner metadata required,
2. lifecycle metadata required,
3. operationId required,
4. operationId lowerCamelCase,
5. no query API key.

### Exercise 3 — Review a Bad API

Ambil OpenAPI document yang pernah dibuat. Cari:

- inconsistent naming,
- missing error responses,
- schema leaking implementation,
- invalid examples,
- missing owner/lifecycle,
- missing security requirement.

### Exercise 4 — Define Exception Process

Buat template exception:

```yaml
x-governance-exceptions:
  - rule:
    reason:
    scope:
    approvedBy:
    approvedAt:
    expiresAt:
    mitigation:
```

### Exercise 5 — Design API Scorecard

Tentukan 10 checks yang paling bernilai untuk organisasi Anda. Jangan lebih dari 10 di awal.

---

## 30. Key Takeaways

1. API governance bukan birokrasi; governance yang baik adalah engineering guardrail.
2. Style guide yang tidak diautomasi akan cepat menjadi dokumen mati.
3. Linting harus menangani rule deterministic, bukan menggantikan semantic review.
4. Human review harus fokus pada design meaning, consumer impact, risk, dan evolvability.
5. Governance harus risk-based: public stable API tidak sama dengan experimental internal API.
6. Owner, lifecycle, visibility, dan data classification adalah metadata penting untuk API portfolio.
7. Breaking-change gate adalah salah satu mekanisme governance paling bernilai.
8. Exception process membuat governance realistis dan auditable.
9. Java/Spring generated OpenAPI tetap perlu review; annotation-generated spec bukan otomatis good contract.
10. Untuk regulated systems, OpenAPI governance dapat menjadi bagian dari defensibility dan audit trail.

---

## 31. References

- OpenAPI Specification v3.2.0 — official specification: https://spec.openapis.org/oas/v3.2.0.html
- OpenAPI Initiative — official site: https://www.openapis.org/
- Stoplight Spectral Documentation — overview, rules, and rulesets: https://docs.stoplight.io/docs/spectral
- Stoplight Spectral GitHub repository: https://github.com/stoplightio/spectral
- OpenAPI Initiative Style Guide: https://www.openapis.org/style-guide
- oasdiff — OpenAPI diff and breaking change detection: https://www.oasdiff.com/
- oasdiff GitHub repository: https://github.com/oasdiff/oasdiff

---

## 32. Status Seri

```text
Current part: 020 / 030
Status: In progress
Series complete: No
Remaining parts: 10
Next: Part 021 — CI/CD Pipeline for OpenAPI: Validate, Lint, Bundle, Diff, Publish, Generate
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-019.md">⬅️ OpenAPI Mastery for Java Engineers — Part 019</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-021.md">OpenAPI Mastery for Java Engineers — Part 021 ➡️</a>
</div>
