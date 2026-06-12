# learn-jaxrs-advanced-part-034.md

# Bagian 034 — OpenAPI and Documentation Strategy: Contract Artifact, Code-First vs Spec-First, MicroProfile OpenAPI, Schema Design, Examples, Error Docs, Versioned Specs, Governance, CI Validation, Codegen, and Docs-as-Product

> Target pembaca: Java/Jakarta engineer yang ingin memakai **OpenAPI sebagai API contract artifact**, bukan sekadar halaman Swagger UI. Fokus bagian ini adalah strategi dokumentasi API production-grade: OpenAPI 3.x, spec-first vs code-first, MicroProfile OpenAPI, annotation strategy, static spec, schema design, examples, Problem Details, pagination/filtering docs, auth docs, versioned specs, deprecation, CI linting, breaking-change diff, consumer docs, SDK/codegen, governance, dan “docs-as-product”.
>
> Namespace utama: `org.eclipse.microprofile.openapi.annotations.*`, `@OpenAPIDefinition`, `@Operation`, `@APIResponse`, `@Schema`, `@Parameter`, `@RequestBody`, `@SecurityScheme`, `@Tag`, `@Server`, serta Jakarta REST annotations seperti `@Path`, `@GET`, `@POST`, `@Produces`, `@Consumes`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: OpenAPI adalah Contract Artifact](#2-mental-model-openapi-adalah-contract-artifact)
3. [OpenAPI: Apa yang Bisa dan Tidak Bisa Dijelaskan](#3-openapi-apa-yang-bisa-dan-tidak-bisa-dijelaskan)
4. [OAS 3.0 vs 3.1 vs 3.2](#4-oas-30-vs-31-vs-32)
5. [JSON Schema Relationship](#5-json-schema-relationship)
6. [MicroProfile OpenAPI in Jakarta REST](#6-microprofile-openapi-in-jakarta-rest)
7. [Code-First Strategy](#7-code-first-strategy)
8. [Spec-First Strategy](#8-spec-first-strategy)
9. [Hybrid Strategy](#9-hybrid-strategy)
10. [Recommended Enterprise Baseline](#10-recommended-enterprise-baseline)
11. [OpenAPI Document Anatomy](#11-openapi-document-anatomy)
12. [`info`, `servers`, `tags`, `paths`, `components`](#12-info-servers-tags-paths-components)
13. [Operation Design](#13-operation-design)
14. [OperationId Strategy](#14-operationid-strategy)
15. [Tags and Grouping](#15-tags-and-grouping)
16. [Path and Parameter Documentation](#16-path-and-parameter-documentation)
17. [Request Body Documentation](#17-request-body-documentation)
18. [Response Documentation](#18-response-documentation)
19. [Schema Design](#19-schema-design)
20. [DTO vs Domain Schema](#20-dto-vs-domain-schema)
21. [Required, Nullable, Optional, ReadOnly, WriteOnly](#21-required-nullable-optional-readonly-writeonly)
22. [Enum Documentation](#22-enum-documentation)
23. [Date/Time, Decimal, ID, Money, and Precision](#23-datetime-decimal-id-money-and-precision)
24. [Examples: The Most Underused API Documentation Feature](#24-examples-the-most-underused-api-documentation-feature)
25. [Error Documentation and Problem Details](#25-error-documentation-and-problem-details)
26. [Pagination Documentation](#26-pagination-documentation)
27. [Filtering/Sorting/Search Documentation](#27-filteringsortingsearch-documentation)
28. [Conditional Requests and ETag Documentation](#28-conditional-requests-and-etag-documentation)
29. [PATCH Documentation](#29-patch-documentation)
30. [Async Operation Documentation](#30-async-operation-documentation)
31. [SSE and Streaming Documentation](#31-sse-and-streaming-documentation)
32. [Multipart Upload Documentation](#32-multipart-upload-documentation)
33. [File Download Documentation](#33-file-download-documentation)
34. [Security Documentation](#34-security-documentation)
35. [OAuth2/OIDC/JWT Scopes](#35-oauth2oidcjwt-scopes)
36. [Versioned OpenAPI Specs](#36-versioned-openapi-specs)
37. [Deprecation and Sunset in OpenAPI](#37-deprecation-and-sunset-in-openapi)
38. [MicroProfile OpenAPI Annotation Examples](#38-microprofile-openapi-annotation-examples)
39. [Static OpenAPI Files](#39-static-openapi-files)
40. [OpenAPI Filters and Model Readers](#40-openapi-filters-and-model-readers)
41. [Generated Docs: Swagger UI, Redoc, Scalar, Developer Portal](#41-generated-docs-swagger-ui-redoc-scalar-developer-portal)
42. [CI Validation](#42-ci-validation)
43. [OpenAPI Linting Rules](#43-openapi-linting-rules)
44. [Breaking Change Detection](#44-breaking-change-detection)
45. [Contract Testing](#45-contract-testing)
46. [Mock Servers](#46-mock-servers)
47. [SDK / Client Code Generation](#47-sdk--client-code-generation)
48. [Server Stub Generation](#48-server-stub-generation)
49. [OpenAPI and API Gateway](#49-openapi-and-api-gateway)
50. [OpenAPI and Security Scanning](#50-openapi-and-security-scanning)
51. [Docs-as-Product](#51-docs-as-product)
52. [Governance Model](#52-governance-model)
53. [Ownership and Review Workflow](#53-ownership-and-review-workflow)
54. [Observability and Documentation Drift](#54-observability-and-documentation-drift)
55. [Testing Documentation Quality](#55-testing-documentation-quality)
56. [Runtime Differences: SmallRye, Open Liberty, Helidon, Payara, Quarkus](#56-runtime-differences-smallrye-open-liberty-helidon-payara-quarkus)
57. [Common Failure Modes](#57-common-failure-modes)
58. [Best Practices](#58-best-practices)
59. [Anti-Patterns](#59-anti-patterns)
60. [Production Checklist](#60-production-checklist)
61. [Latihan](#61-latihan)
62. [Referensi Resmi](#62-referensi-resmi)
63. [Penutup](#63-penutup)

---

# 1. Tujuan Part Ini

Banyak tim memperlakukan OpenAPI seperti dokumentasi otomatis:

```text
Tambahkan Swagger UI.
Selesai.
```

Itu belum cukup.

OpenAPI yang baik adalah:

```text
machine-readable API contract
human-readable documentation base
test input
mock-server input
gateway/security policy source
SDK/codegen source
change management artifact
```

## 1.1 Masalah umum

OpenAPI sering buruk karena:

- auto-generated dari code tanpa review;
- schema tidak menjelaskan nullability;
- enum tidak punya unknown handling;
- error response tidak terdokumentasi;
- examples tidak ada;
- auth scopes tidak jelas;
- pagination/filtering tidak terdokumentasi;
- file upload/download salah;
- operationId berubah-ubah;
- versioning tidak jelas;
- docs tidak diuji di CI;
- Swagger UI ada tapi consumer tetap bertanya ke developer.

## 1.2 Target akhir

Setelah bagian ini, kamu bisa:

- memperlakukan OpenAPI sebagai contract artifact;
- memilih code-first/spec-first/hybrid;
- memakai MicroProfile OpenAPI dengan Jakarta REST;
- mendesain schema yang jelas;
- menulis examples yang membantu consumer;
- mendokumentasikan Problem Details, pagination, auth, file upload/download, SSE;
- menjalankan lint/diff/contract testing di CI;
- mengelola versioned specs;
- memakai OpenAPI untuk governance dan developer experience.

## 1.3 Prinsip utama

```text
OpenAPI is not “generated docs”.
OpenAPI is the executable description of your API contract.
```

---

# 2. Mental Model: OpenAPI adalah Contract Artifact

OpenAPI describes HTTP API capabilities.

It should answer:

```text
Endpoint apa tersedia?
Method apa?
Parameter apa?
Request body apa?
Response status apa?
Response body apa?
Error apa?
Auth apa?
Header apa?
Media type apa?
Contoh request/response seperti apa?
```

## 2.1 Contract artifact means

OpenAPI is versioned, reviewed, validated, diffed, published, and tested.

## 2.2 Not only UI

Swagger UI/Redoc/Scalar are views over the contract.

The source of truth is the OpenAPI document.

## 2.3 Top-tier rule

```text
If it is not in OpenAPI or linked docs, consumers cannot reliably depend on it.
```

---

# 3. OpenAPI: Apa yang Bisa dan Tidak Bisa Dijelaskan

## 3.1 Bisa dijelaskan

- paths and methods;
- parameters;
- request body schema;
- response schema;
- headers;
- media types;
- auth schemes;
- examples;
- deprecation;
- server URLs;
- tags;
- callbacks/webhooks;
- links;
- reusable components.

## 3.2 Sulit dijelaskan penuh

- complex business rules;
- ordering consistency;
- detailed authorization matrix;
- eventual consistency;
- rate limit algorithm;
- async process state machine;
- side effects;
- performance/SLA;
- retry/idempotency semantics;
- security threat model.

## 3.3 Solusi

Gunakan OpenAPI + narrative docs.

OpenAPI menjelaskan contract mechanics.

Narrative docs menjelaskan behavior, workflows, decision tables, migration guides.

## 3.4 Rule

OpenAPI is necessary but not sufficient for excellent API documentation.

---

# 4. OAS 3.0 vs 3.1 vs 3.2

## 4.1 OAS 3.0

Masih sangat banyak tooling support.

Beberapa fitur JSON Schema tidak sepenuhnya selaras.

## 4.2 OAS 3.1

Menyelaraskan Schema Object dengan JSON Schema 2020-12 secara lebih kuat.

Good modern target jika tooling kamu mendukung.

## 4.3 OAS 3.2

Spesifikasi terbaru pada lifecycle modern OpenAPI.

Namun adopsi tool bisa tertinggal dari rilis spec.

## 4.4 Practical recommendation

```text
Use the newest OAS version that your runtime, docs tool, CI, gateway, and codegen ecosystem support reliably.
```

Untuk banyak enterprise, OAS 3.1 menjadi pilihan modern yang stabil; OAS 3.2 perlu cek tooling.

## 4.5 Rule

Spec version choice is an ecosystem compatibility decision.

---

# 5. JSON Schema Relationship

OpenAPI schemas describe data shapes.

## 5.1 OAS 3.1+

Lebih dekat dengan JSON Schema.

## 5.2 Why it matters

- `type`;
- `format`;
- `oneOf`/`anyOf`/`allOf`;
- `nullable` differences;
- `$ref`;
- validation behavior;
- tooling compatibility.

## 5.3 Rule

Know your OAS version before writing schemas and nullable rules.

---

# 6. MicroProfile OpenAPI in Jakarta REST

MicroProfile OpenAPI provides Java APIs/annotations and runtime behavior to expose OpenAPI documents from Jakarta REST applications.

## 6.1 Common endpoint

Runtime often exposes:

```text
/openapi
```

depending server configuration.

## 6.2 Sources

MicroProfile OpenAPI can combine:

- Jakarta REST annotations;
- MicroProfile OpenAPI annotations;
- static OpenAPI file;
- model reader;
- filter.

## 6.3 Good for code-first/hybrid

You can annotate resource methods and DTOs.

## 6.4 Rule

MicroProfile OpenAPI is generation mechanism; contract quality still requires design/review.

---

# 7. Code-First Strategy

Code-first means implementation code generates OpenAPI.

## 7.1 Flow

```text
JAX-RS resource + DTO annotations
  ↓
runtime/scanner
  ↓
OpenAPI document
  ↓
docs/codegen/tests
```

## 7.2 Pros

- less duplicate effort;
- docs close to code;
- easy for internal APIs;
- good for existing codebase.

## 7.3 Cons

- generated docs can reflect implementation accidents;
- hard to express behavior;
- annotation noise;
- difficult review before implementation;
- risk of exposing internal DTO shape.

## 7.4 Rule

Code-first is acceptable if generated spec is reviewed and validated like hand-written contract.

---

# 8. Spec-First Strategy

Spec-first means OpenAPI is designed before implementation.

## 8.1 Flow

```text
OpenAPI design
  ↓
review with consumers/security/platform
  ↓
mock server/contract tests
  ↓
implementation
  ↓
verify implementation matches spec
```

## 8.2 Pros

- consumer-focused design;
- early feedback;
- mocks before code;
- governance easier;
- stable contract before implementation.

## 8.3 Cons

- requires discipline;
- spec/code drift risk;
- developers may duplicate schema annotations;
- generated stubs may be awkward.

## 8.4 Rule

Spec-first is best for public/partner APIs and major enterprise contracts.

---

# 9. Hybrid Strategy

Hybrid combines both.

## 9.1 Example

- static OpenAPI file contains authoritative high-level contract;
- annotations fill operation details;
- model reader injects global metadata;
- filter removes internal endpoints;
- CI compares generated spec with committed spec.

## 9.2 Good for

- Jakarta REST teams that want code proximity but contract governance;
- internal enterprise APIs;
- gradually improving legacy APIs.

## 9.3 Rule

Hybrid is often the most pragmatic enterprise strategy.

---

# 10. Recommended Enterprise Baseline

Recommended baseline:

```text
1. Treat OpenAPI as committed artifact.
2. Generate from code or maintain static spec, but validate in CI.
3. Publish versioned specs.
4. Require examples for every important operation.
5. Document Problem Details errors.
6. Lint spec.
7. Run breaking-change diff.
8. Use contract tests against implementation.
9. Publish docs in developer portal.
```

## 10.1 For JAX-RS

Use MicroProfile OpenAPI annotations where helpful, but keep final OpenAPI spec in build artifact.

## 10.2 Rule

The final spec must be reviewable, reproducible, and version-controlled.

---

# 11. OpenAPI Document Anatomy

A typical OpenAPI document:

```yaml
openapi: 3.1.0
info:
  title: Customer API
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
tags:
  - name: Customers
paths:
  /customers/{customerId}:
    get:
      operationId: getCustomer
      ...
components:
  schemas:
    CustomerResponse:
      ...
  responses:
    Problem:
      ...
  securitySchemes:
    OAuth2:
      ...
```

## 11.1 Rule

Keep OpenAPI structure consistent across services.

---

# 12. `info`, `servers`, `tags`, `paths`, `components`

## 12.1 `info`

Include:

- title;
- version;
- description;
- contact;
- license if relevant.

## 12.2 `servers`

Define server URLs.

For versioned APIs, include version base.

## 12.3 `tags`

Group operations by domain capability.

## 12.4 `paths`

Define operations.

## 12.5 `components`

Reusable schemas, parameters, responses, headers, examples, security schemes.

## 12.6 Rule

Use components aggressively to avoid inconsistent docs.

---

# 13. Operation Design

Each operation should document:

- summary;
- description;
- operationId;
- tags;
- parameters;
- requestBody;
- responses;
- security;
- examples;
- deprecation;
- headers.

## 13.1 Example checklist

```text
Does operation show 200/201/202/204?
Does it show 400/401/403/404/409/412/415/422/429/500?
Does it explain idempotency?
Does it document ETag?
Does it include example request/response?
```

## 13.2 Rule

An operation without error docs is incomplete.

---

# 14. OperationId Strategy

`operationId` should be stable and unique.

## 14.1 Good

```text
getCustomer
createCustomer
updateCustomerAddress
searchCustomerApplications
```

## 14.2 Bad

```text
get
post
CustomerResource_get_1
```

## 14.3 Why important

Code generators use operationId for method names.

Changing it can break generated clients.

## 14.4 Rule

Treat operationId as public contract if clients generate code.

---

# 15. Tags and Grouping

## 15.1 Good tags

Business/domain-oriented:

```text
Customers
Applications
Documents
Operations
```

## 15.2 Bad tags

Implementation-oriented:

```text
CustomerResource
ControllerV2
```

## 15.3 Multiple tags

Use sparingly.

## 15.4 Rule

Tags should help consumers navigate, not reveal package structure.

---

# 16. Path and Parameter Documentation

## 16.1 Path parameter

```yaml
parameters:
  - name: customerId
    in: path
    required: true
    schema:
      type: string
      pattern: '^C[0-9]{6}$'
    description: Stable customer identifier.
```

## 16.2 Query parameter

Document:

- type;
- allowed values;
- default;
- min/max;
- repeated values;
- encoding;
- examples.

## 16.3 Header parameter

Document required headers like:

- `If-Match`;
- `Idempotency-Key`;
- `X-Correlation-ID`.

## 16.4 Rule

Undocumented parameters are not contract.

---

# 17. Request Body Documentation

Document:

- content type;
- schema;
- examples;
- required fields;
- validation rules;
- null/missing semantics;
- idempotency behavior.

## 17.1 Multiple media types

```yaml
requestBody:
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CreateCustomerRequest'
```

## 17.2 Required request body

```yaml
requestBody:
  required: true
```

## 17.3 Rule

Request body docs must match server validation.

---

# 18. Response Documentation

Document every meaningful response.

## 18.1 Success

```yaml
'200':
  description: Customer found.
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CustomerResponse'
```

## 18.2 Created

Include `Location` header.

## 18.3 Accepted

Include operation/status resource link.

## 18.4 No content

No body schema.

## 18.5 Rule

Status-specific response docs prevent wrong client assumptions.

---

# 19. Schema Design

Schema should express:

- type;
- format;
- required fields;
- description;
- examples;
- min/max;
- patterns;
- enum values;
- readOnly/writeOnly;
- deprecated fields.

## 19.1 Avoid vague object

Bad:

```yaml
type: object
additionalProperties: true
```

unless truly dynamic.

## 19.2 Use explicit schemas

```yaml
CustomerResponse:
  type: object
  required: [id, displayName, status]
```

## 19.3 Rule

Schema should be precise enough for validation and codegen.

---

# 20. DTO vs Domain Schema

OpenAPI schema should describe API DTOs.

## 20.1 Do not expose entity fields

Avoid:

- tenantId internal;
- deleted flag;
- risk score;
- audit internals;
- relationships not in API.

## 20.2 Domain concepts can appear

But representation should be consumer-oriented.

## 20.3 Rule

OpenAPI documents API shape, not database shape.

---

# 21. Required, Nullable, Optional, ReadOnly, WriteOnly

## 21.1 Required

Field must appear.

## 21.2 Optional

Field may be absent.

## 21.3 Nullable

Field may be `null`.

OAS version affects exact notation.

## 21.4 `readOnly`

Returned by server, not accepted in request.

## 21.5 `writeOnly`

Accepted in request, not returned.

Useful for passwords/secrets.

## 21.6 Rule

Do not leave nullability/required behavior ambiguous.

---

# 22. Enum Documentation

## 22.1 Example

```yaml
CustomerStatus:
  type: string
  enum: [ACTIVE, SUSPENDED, CLOSED]
  description: >
    Consumers must handle unknown values defensively.
```

## 22.2 Explain transitions

If status is workflow state, link to state machine docs.

## 22.3 Unknown value policy

Document whether new enum values may be added.

## 22.4 Rule

Enums are behavior contracts, not just strings.

---

# 23. Date/Time, Decimal, ID, Money, and Precision

## 23.1 Date/time

Use ISO 8601/RFC 3339 style for `date-time`.

```yaml
type: string
format: date-time
example: "2026-06-12T10:00:00Z"
```

## 23.2 Decimal

For money, avoid floating-point ambiguity.

Consider string decimal:

```yaml
type: string
pattern: '^[0-9]+(\.[0-9]{2})$'
```

or document precision carefully.

## 23.3 IDs

Use string IDs even if internal DB uses numeric.

## 23.4 Rule

Precision and format are contract details.

---

# 24. Examples: The Most Underused API Documentation Feature

Examples help more than abstract schema.

## 24.1 Request example

```yaml
examples:
  createCustomer:
    value:
      displayName: "Fajar"
      email: "fajar@example.com"
```

## 24.2 Response example

```yaml
examples:
  activeCustomer:
    value:
      id: "C000001"
      displayName: "Fajar"
      status: "ACTIVE"
```

## 24.3 Error example

```yaml
examples:
  duplicateEmail:
    value:
      type: "https://api.example.com/problems/resource-conflict"
      title: "Resource conflict"
      status: 409
      code: "CUSTOMER_EMAIL_ALREADY_EXISTS"
```

## 24.4 Rule

Every operation should have realistic examples for success and common errors.

---

# 25. Error Documentation and Problem Details

Document Problem Details as reusable schema.

## 25.1 Schema

```yaml
ProblemDetails:
  type: object
  required: [type, title, status, code]
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
    code:
      type: string
    correlationId:
      type: string
```

## 25.2 Reusable responses

```yaml
components:
  responses:
    Unauthorized:
      description: Authentication required.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
```

## 25.3 Operation-specific error codes

Document possible `code` values per operation.

## 25.4 Rule

If clients branch on error codes, error codes must be documented.

---

# 26. Pagination Documentation

Document pagination model.

## 26.1 Offset

- `page`;
- `size`;
- max size;
- default sort;
- total count behavior.

## 26.2 Cursor

- `cursor`;
- `limit`;
- opaque cursor;
- stable ordering;
- next/prev links;
- expiration.

## 26.3 Headers/links

Document `Link` header if used.

## 26.4 Rule

Pagination docs must explain consistency and ordering.

---

# 27. Filtering/Sorting/Search Documentation

## 27.1 Allowlisted fields

Document allowed sort/filter fields.

## 27.2 Operators

```text
eq
in
gte
lte
contains
```

## 27.3 Search behavior

Explain:

- case sensitivity;
- tokenization;
- partial match;
- ranking;
- index limitations;
- max query length.

## 27.4 Rule

Do not leave query DSL to guesswork.

---

# 28. Conditional Requests and ETag Documentation

Document:

- response `ETag`;
- request `If-Match`;
- `If-None-Match`;
- 304;
- 412;
- 428 if required.

## 28.1 Example

```yaml
parameters:
  - name: If-Match
    in: header
    required: true
    schema:
      type: string
    description: Required ETag from latest representation.
```

## 28.2 Rule

If update requires ETag, OpenAPI must say so.

---

# 29. PATCH Documentation

PATCH must document media type.

## 29.1 JSON Merge Patch

```yaml
content:
  application/merge-patch+json:
    schema:
      type: object
```

## 29.2 JSON Patch

```yaml
content:
  application/json-patch+json:
    schema:
      type: array
      items:
        type: object
```

## 29.3 Field authorization

OpenAPI may not fully express field permission; link narrative docs.

## 29.4 Rule

PATCH docs must explain null vs missing and supported paths/fields.

---

# 30. Async Operation Documentation

For `202 Accepted`:

Document:

- `Location` header;
- `Retry-After`;
- operation status schema;
- state machine;
- cancellation endpoint;
- result link;
- expiration;
- error model.

## 30.1 Example statuses

```text
accepted
queued
running
succeeded
failed
cancelled
expired
```

## 30.2 Rule

Async API docs must include lifecycle, not only initial POST.

---

# 31. SSE and Streaming Documentation

## 31.1 SSE

OpenAPI can describe endpoint response content type:

```yaml
text/event-stream
```

But detailed event stream semantics often need narrative docs.

Document:

- event names;
- event data schema;
- id/retry behavior;
- reconnect;
- Last-Event-ID;
- heartbeat;
- auth expiry.

## 31.2 Streaming response

Document:

- content type;
- content length availability;
- range support;
- Content-Disposition;
- errors before streaming;
- checksum.

## 31.3 Rule

For streaming protocols, OpenAPI plus narrative docs is required.

---

# 32. Multipart Upload Documentation

OpenAPI supports multipart/form-data.

## 32.1 Example

```yaml
requestBody:
  required: true
  content:
    multipart/form-data:
      schema:
        type: object
        required: [metadata, file]
        properties:
          metadata:
            $ref: '#/components/schemas/UploadMetadata'
          file:
            type: string
            format: binary
```

## 32.2 Document

- max file size;
- allowed media types;
- scanning lifecycle;
- status codes;
- malware rejection code.

## 32.3 Rule

Multipart docs must include operational/security constraints.

---

# 33. File Download Documentation

Document binary response:

```yaml
responses:
  '200':
    description: PDF document.
    headers:
      Content-Disposition:
        schema:
          type: string
      ETag:
        schema:
          type: string
    content:
      application/pdf:
        schema:
          type: string
          format: binary
```

## 33.1 Range

Document:

- `Accept-Ranges`;
- `Range`;
- `Content-Range`;
- 206;
- 416.

## 33.2 Rule

Download docs must document headers, not only binary schema.

---

# 34. Security Documentation

OpenAPI supports security schemes.

## 34.1 Bearer JWT

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

## 34.2 OAuth2

```yaml
securitySchemes:
  oauth2:
    type: oauth2
    flows:
      authorizationCode:
        authorizationUrl: ...
        tokenUrl: ...
        scopes:
          customer:read: Read customers.
```

## 34.3 Per operation

```yaml
security:
  - oauth2: [customer:read]
```

## 34.4 Rule

Document auth scheme and scopes per operation.

---

# 35. OAuth2/OIDC/JWT Scopes

## 35.1 Scope naming

Use stable, meaningful scopes:

```text
customers:read
customers:write
documents:upload
documents:download
```

## 35.2 Operation-specific

Do not document generic “authenticated” if scope matters.

## 35.3 Claims

If tenant/user claims matter, describe in narrative security docs.

## 35.4 Rule

Auth docs must match actual authorization implementation.

---

# 36. Versioned OpenAPI Specs

## 36.1 Per major version

```text
openapi-v1.yaml
openapi-v2.yaml
```

## 36.2 Publish URLs

```text
/docs/v1/openapi.yaml
/docs/v2/openapi.yaml
```

## 36.3 Info version

```yaml
info:
  version: "1.4.0"
```

## 36.4 Rule

Version OpenAPI specs like product artifacts.

---

# 37. Deprecation and Sunset in OpenAPI

## 37.1 Deprecated operations

```yaml
deprecated: true
```

## 37.2 Deprecated fields

```yaml
oldName:
  type: string
  deprecated: true
```

## 37.3 Sunset

OpenAPI has no universal first-class sunset date field for all cases.

Use description and vendor extension:

```yaml
x-sunset: "2026-12-31T23:59:59Z"
```

## 37.4 Rule

Combine OpenAPI deprecation with runtime Deprecation/Sunset headers.

---

# 38. MicroProfile OpenAPI Annotation Examples

## 38.1 Class-level

```java
@Tag(name = "Customers", description = "Customer management APIs")
@Path("/v1/customers")
@RequestScoped
public class CustomerResource { ... }
```

## 38.2 Operation

```java
@GET
@Path("/{customerId}")
@Operation(
    operationId = "getCustomer",
    summary = "Get customer by ID",
    description = "Returns the customer representation for the given ID."
)
@APIResponse(
    responseCode = "200",
    description = "Customer found",
    content = @Content(
        mediaType = "application/json",
        schema = @Schema(implementation = CustomerResponse.class)
    )
)
@APIResponse(
    responseCode = "404",
    description = "Customer not found",
    content = @Content(
        mediaType = "application/problem+json",
        schema = @Schema(implementation = ProblemDetails.class)
    )
)
public CustomerResponse getCustomer(
    @Parameter(description = "Customer ID", required = true)
    @PathParam("customerId") String customerId
) {
    ...
}
```

## 38.3 Rule

Use annotations to enrich contract, not just restate code.

---

# 39. Static OpenAPI Files

MicroProfile OpenAPI supports static OpenAPI documents under configured locations in many runtimes.

## 39.1 Good for

- spec-first;
- hand-crafted docs;
- examples;
- gateway import;
- governance.

## 39.2 Risk

Static spec can drift from implementation.

## 39.3 Mitigation

Contract tests and generated-vs-static comparison.

## 39.4 Rule

Static spec is authoritative only if tested against implementation.

---

# 40. OpenAPI Filters and Model Readers

MicroProfile OpenAPI defines extension points such as model reader/filter.

## 40.1 Model reader

Programmatically builds or augments OpenAPI model.

## 40.2 Filter

Can remove/modify operations/schemas.

Use cases:

- hide internal endpoints;
- inject common error responses;
- add servers;
- add security schemes;
- add global headers.

## 40.3 Rule

Use filters/model readers for systematic modifications, not one-off hacks.

---

# 41. Generated Docs: Swagger UI, Redoc, Scalar, Developer Portal

## 41.1 Swagger UI

Interactive testing.

Good for developers.

## 41.2 Redoc/Scalar

Good for polished documentation.

## 41.3 Developer portal

Adds:

- guides;
- onboarding;
- auth instructions;
- changelog;
- SDKs;
- tutorials;
- migration docs.

## 41.4 Rule

Generated reference docs are not enough; pair with task-oriented guides.

---

# 42. CI Validation

CI should validate:

- OpenAPI syntax;
- schema references;
- lint rules;
- examples match schemas;
- no breaking changes;
- operationId uniqueness;
- security documented;
- error responses present;
- docs generated successfully.

## 42.1 Rule

A PR that changes API must update and pass OpenAPI validation.

---

# 43. OpenAPI Linting Rules

Example rules:

```text
operationId required and unique
tags required
summary required
description required for public APIs
4xx/5xx error responses required
application/problem+json required for errors
security required unless explicitly public
no anonymous object schemas for public DTOs
no undocumented query params
no deprecated operations without x-sunset
examples required for core operations
```

## 43.1 Tools

Use tools such as Spectral or platform-specific linters.

## 43.2 Rule

Linting turns API style guide into enforceable policy.

---

# 44. Breaking Change Detection

Use OpenAPI diff tools to detect:

- removed endpoint;
- removed field;
- changed field type;
- added required request field;
- changed enum;
- changed response status;
- changed media type.

## 44.1 Caveat

Tools cannot catch all behavioral breaking changes.

## 44.2 Combine

- schema diff;
- behavior tests;
- review checklist.

## 44.3 Rule

Breaking-change detection is safety net, not replacement for review.

---

# 45. Contract Testing

Contract testing verifies implementation matches OpenAPI.

## 45.1 Provider-side tests

Send requests from examples and assert responses match schema.

## 45.2 Consumer-driven contracts

Consumers express expectations.

## 45.3 Runtime validation

In lower env, validate traffic against OpenAPI.

## 45.4 Rule

OpenAPI is only useful if implementation conforms.

---

# 46. Mock Servers

OpenAPI can power mock servers.

## 46.1 Uses

- frontend development before backend ready;
- consumer integration tests;
- API design review;
- demo.

## 46.2 Example quality matters

Mock server is only as good as examples/schemas.

## 46.3 Rule

Spec-first APIs should offer mock server early.

---

# 47. SDK / Client Code Generation

OpenAPI can generate clients.

## 47.1 Benefits

- faster consumer integration;
- type-safe DTOs;
- consistent auth;
- less boilerplate.

## 47.2 Risks

- operationId instability;
- poor enum unknown handling;
- huge generated code;
- bad nullable semantics;
- breaking generated method names;
- generated client hides HTTP details.

## 47.3 Recommendation

Provide SDK wrapper, not only raw generated code, for important public APIs.

## 47.4 Rule

If consumers generate clients, OpenAPI quality becomes source-code quality.

---

# 48. Server Stub Generation

Spec-first can generate server stubs.

## 48.1 Pros

- contract-first implementation;
- consistent route signatures.

## 48.2 Cons

- generated code can be awkward;
- regeneration conflicts;
- business logic placement issues;
- framework mismatch.

## 48.3 Rule

Use generated stubs carefully; keep business logic outside generated code.

---

# 49. OpenAPI and API Gateway

Gateways can use OpenAPI for:

- route import;
- request validation;
- auth policy;
- rate limit policy;
- docs publishing;
- mocking;
- threat detection.

## 49.1 Risk

Gateway validation may differ from app validation.

## 49.2 Rule

OpenAPI used by gateway must match deployed app version.

---

# 50. OpenAPI and Security Scanning

Security tools can use OpenAPI to:

- discover endpoints;
- generate tests;
- detect undocumented APIs;
- validate auth requirements;
- fuzz parameters;
- find shadow APIs.

## 50.1 Shadow API

Endpoint exists but not in OpenAPI.

## 50.2 Zombie API

Deprecated/removed docs but still accessible.

## 50.3 Rule

OpenAPI is security inventory.

---

# 51. Docs-as-Product

Consumer docs should include:

- quickstart;
- authentication guide;
- concepts;
- endpoint reference;
- examples;
- errors;
- webhooks/events;
- rate limits;
- changelog;
- migration guide;
- SDK guide;
- troubleshooting.

## 51.1 Developer experience

Good docs reduce support load.

## 51.2 Rule

Docs are part of API product, not afterthought.

---

# 52. Governance Model

API governance defines quality gates.

## 52.1 Roles

- API owner;
- platform reviewer;
- security reviewer;
- consumer representative;
- documentation owner.

## 52.2 Gates

- design review;
- OpenAPI lint;
- security review;
- breaking change review;
- docs review;
- release approval.

## 52.3 Rule

Governance should prevent bad APIs without blocking useful delivery unnecessarily.

---

# 53. Ownership and Review Workflow

## 53.1 PR checklist

- Does OpenAPI change?
- Is it breaking?
- Are examples updated?
- Are errors documented?
- Are auth scopes documented?
- Is changelog updated?
- Are contract tests updated?

## 53.2 Ownership

Each API should have accountable owner.

## 53.3 Rule

No orphan APIs.

---

# 54. Observability and Documentation Drift

Compare runtime traffic to OpenAPI.

## 54.1 Drift examples

- undocumented endpoint receives traffic;
- documented endpoint never used;
- response has extra/changed field;
- error status not documented;
- old version still used.

## 54.2 Tools

- gateway logs;
- API security tools;
- contract validation;
- schema inference.

## 54.3 Rule

Documentation drift is production risk.

---

# 55. Testing Documentation Quality

Ask:

- Can a new consumer call API using docs only?
- Are examples copy-pasteable?
- Are error cases clear?
- Are auth/scopes clear?
- Are pagination and filtering clear?
- Are version/deprecation rules clear?

## 55.1 Dogfood

Use generated docs to write tests/client.

## 55.2 Rule

Documentation quality is tested through consumer success.

---

# 56. Runtime Differences: SmallRye, Open Liberty, Helidon, Payara, Quarkus

## 56.1 Differences

- MicroProfile OpenAPI version supported;
- endpoint path/config;
- annotation scanning;
- static file merge behavior;
- filter/model reader config;
- schema generation details;
- Jackson/JSON-B influence;
- native image reflection;
- UI integration.

## 56.2 Rule

Test final generated OpenAPI in your runtime, not only source annotations.

---

# 57. Common Failure Modes

## 57.1 Swagger UI exists but specs are wrong

False confidence.

## 57.2 No error responses documented

Consumers cannot handle failures.

## 57.3 operationId changes every build

Generated clients break.

## 57.4 Entity classes used as schemas

Persistence leakage.

## 57.5 Examples absent

Docs technically correct but unusable.

## 57.6 No CI diff

Breaking changes slip.

## 57.7 OpenAPI generated only at runtime, not versioned

No reviewable contract.

## 57.8 Security schemes incomplete

Consumers misuse auth.

## 57.9 Multipart/binary modeled incorrectly

Codegen/client broken.

## 57.10 Docs not aligned with gateway version

Consumers hit wrong behavior.

---

# 58. Best Practices

## 58.1 Treat OpenAPI as source artifact

Commit it or reproducibly generate it.

## 58.2 Use DTO schemas, not entities

Boundary clarity.

## 58.3 Stable operationId

For codegen.

## 58.4 Document common errors

Problem Details.

## 58.5 Add examples

Success and errors.

## 58.6 Lint in CI

Enforce style.

## 58.7 Diff in CI

Detect breaking changes.

## 58.8 Version specs

Per major version.

## 58.9 Publish docs

Developer portal.

## 58.10 Test implementation against spec

Avoid drift.

---

# 59. Anti-Patterns

## 59.1 “Swagger UI means documented”

No.

## 59.2 Generated spec never reviewed

Danger.

## 59.3 One giant anonymous schema

Poor codegen/docs.

## 59.4 No examples

Consumer friction.

## 59.5 Error body undocumented

Operational pain.

## 59.6 OpenAPI only for public endpoints, internal undocumented

Internal consumers still need contract.

## 59.7 Spec-first but no implementation conformance test

Drift.

## 59.8 Code-first but no diff

Accidental breaking changes.

## 59.9 Hiding auth requirements in prose only

Tooling cannot enforce.

## 59.10 No owner/changelog

API becomes unmanaged.

---

# 60. Production Checklist

## 60.1 Contract

- [ ] OpenAPI version chosen.
- [ ] Spec committed or reproducibly generated.
- [ ] Info/servers/tags complete.
- [ ] Stable operationId.
- [ ] Request/response schemas explicit.
- [ ] Nullability/required semantics clear.
- [ ] Error responses documented.
- [ ] Examples included.
- [ ] Auth schemes/scopes documented.

## 60.2 Advanced API behavior

- [ ] Pagination documented.
- [ ] Filtering/sorting documented.
- [ ] ETag/preconditions documented.
- [ ] PATCH semantics documented.
- [ ] Async status lifecycle documented.
- [ ] SSE/stream docs linked.
- [ ] Multipart upload documented.
- [ ] Binary download headers documented.

## 60.3 Governance

- [ ] Lint in CI.
- [ ] OpenAPI diff in CI.
- [ ] Contract tests.
- [ ] Versioned specs.
- [ ] Deprecation docs.
- [ ] Changelog.
- [ ] API owner assigned.
- [ ] Security review.

## 60.4 Publishing

- [ ] Developer portal/reference generated.
- [ ] Quickstart guide.
- [ ] Auth guide.
- [ ] Migration guide if versioned.
- [ ] SDK/codegen tested if offered.
- [ ] Runtime spec matches deployed app.

---

# 61. Latihan

## Latihan 1 — OpenAPI Baseline

Buat `openapi-v1.yaml` untuk Customer API.

Harus punya:

- GET customer;
- POST customer;
- PATCH customer;
- Problem Details;
- auth scheme;
- examples.

## Latihan 2 — MicroProfile OpenAPI Annotations

Tambahkan annotation:

- `@Operation`;
- `@APIResponse`;
- `@Schema`;
- `@Parameter`;
- `@SecurityRequirement`.

Generate `/openapi`.

## Latihan 3 — Error Docs

Buat reusable responses:

- 400;
- 401;
- 403;
- 404;
- 409;
- 412;
- 429;
- 500.

Semua pakai `application/problem+json`.

## Latihan 4 — Multipart Docs

Dokumentasikan upload:

```text
metadata: application/json
file: binary
```

Tambahkan max size dan scanning lifecycle di description.

## Latihan 5 — Binary Download Docs

Dokumentasikan:

- 200 PDF;
- 206 partial;
- Range;
- Content-Disposition;
- ETag;
- 416.

## Latihan 6 — Lint Rules

Tambahkan CI rule:

- operationId wajib;
- 4xx/5xx wajib;
- security wajib;
- examples wajib.

## Latihan 7 — Breaking Diff

Ubah response field type dari string ke integer.

Pastikan CI diff gagal.

## Latihan 8 — Mock Server

Gunakan OpenAPI examples untuk mock server.

Frontend bisa memanggil mock sebelum backend selesai.

## Latihan 9 — Developer Portal Review

Minta engineer lain memakai docs untuk membuat client tanpa bertanya.

Catat pertanyaan yang muncul dan perbaiki docs.

---

# 62. Referensi Resmi

Referensi utama:

1. OpenAPI Specification 3.2.0  
   https://spec.openapis.org/oas/v3.2.0.html

2. OpenAPI Specification 3.1.1  
   https://spec.openapis.org/oas/v3.1.1.html

3. OpenAPI Initiative — Announcement of OAS 3.0.4 and 3.1.1  
   https://www.openapis.org/blog/2024/10/25/announcing-openapi-specification-patch-releases

4. MicroProfile OpenAPI  
   https://microprofile.io/specifications/open-api/

5. MicroProfile OpenAPI 4.1  
   https://microprofile.io/specifications/open-api/

6. MicroProfile OpenAPI 3.1.1 Specification  
   https://download.eclipse.org/microprofile/microprofile-open-api-3.1.1/microprofile-openapi-spec-3.1.1.html

7. Open Liberty Guide — Documenting RESTful APIs using MicroProfile OpenAPI  
   https://openliberty.io/guides/microprofile-openapi.html

8. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

---

# 63. Penutup

OpenAPI yang baik membuat API lebih mudah dipakai, diuji, diamankan, dan dikelola.

Mental model final:

```text
OpenAPI = executable API contract
Swagger UI = one visualization of that contract
Developer portal = product experience around that contract
CI lint/diff/test = governance around that contract
```

Prinsip final:

```text
Document the contract before consumers suffer.
Examples are part of documentation quality.
Errors are part of the contract.
Security is part of the contract.
Versioning is part of the contract.
OpenAPI without validation will drift.
```

Top-tier JAX-RS engineer memastikan:

- OpenAPI bukan afterthought;
- MicroProfile OpenAPI dipakai dengan strategi, bukan hanya auto-scan;
- schema berasal dari API DTO;
- operationId stabil;
- error dan examples lengkap;
- pagination/filtering/PATCH/upload/download/async terdokumentasi;
- spec versioned dan dipublish;
- CI menjalankan lint, diff, dan conformance tests;
- docs diperlakukan sebagai produk untuk consumer.

Part berikutnya:

```text
Bagian 035 — Testing JAX-RS Server
```

Kita akan membahas testing server-side JAX-RS secara mendalam: unit test resource/service boundary, integration test runtime pipeline, filters/providers/mappers, JSON contract, validation, security, async, streaming, multipart, and contract tests.
