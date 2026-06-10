# Strict General Standards: OpenAPI

> File: `strict-general-standards__open_api.md`  
> Category: General Engineering Standard  
> Principle: OpenAPI Contract Quality  
> Status: Mandatory for LLM-assisted API design, implementation, documentation, generation, testing, and review

---

## 1. Purpose

This standard defines how an LLM code agent MUST create, modify, validate, and maintain OpenAPI specifications.

OpenAPI is not decorative documentation. It is a machine-readable API contract used by humans, code generators, client SDKs, contract tests, API gateways, security scanners, documentation portals, and LLM agents.

A low-quality OpenAPI file creates false confidence. Therefore, every OpenAPI change MUST be treated as a contract change with compatibility, validation, generation, and runtime implications.

---

## 2. Source Baseline

The LLM MUST align OpenAPI work with:

- the official OpenAPI Specification;
- JSON Schema semantics used by OpenAPI 3.1+;
- HTTP semantics for methods, status codes, headers, media types, and content negotiation;
- standardized Problem Details error responses;
- the local RESTful API standard of the repository.

References are listed at the end of this document.

---

## 3. Version Policy

### 3.1 Default OpenAPI version

The default enterprise baseline SHOULD be OpenAPI `3.1.x` unless the repository/toolchain explicitly supports OpenAPI `3.2.0`.

Reason:

- OpenAPI `3.2.0` is the latest published version as of this standard.
- OpenAPI `3.1.x` is still a strong compatibility baseline for many validators, generators, gateways, and documentation tools.
- New projects MAY use `3.2.0` only after CI validators, code generators, documentation tools, and gateway tooling are confirmed compatible.

Mandatory rule:

```yaml
openapi: 3.1.0
```

or:

```yaml
openapi: 3.1.1
```

or, when toolchain-approved:

```yaml
openapi: 3.2.0
```

The LLM MUST NOT create new Swagger/OpenAPI `2.0` specifications unless maintaining a legacy contract.

### 3.2 Version upgrade rule

The LLM MUST NOT upgrade the OpenAPI version casually.

Before upgrading from 3.0 to 3.1 or from 3.1 to 3.2, verify:

- schema semantics compatibility;
- validator support;
- code generator support;
- API gateway/import support;
- documentation renderer support;
- CI lint rule support;
- downstream client impact.

---

## 4. Core Interpretation

### 4.1 OpenAPI is the external API contract

The OpenAPI document MUST describe what clients can rely on, not what the server happens to do internally.

The LLM MUST NOT document:

- internal DTOs that are not public;
- database schemas as public schemas;
- debug-only endpoints as normal public endpoints;
- framework-generated endpoints unless intentionally exposed;
- fields that may appear accidentally due to serialization leakage.

### 4.2 Implementation and OpenAPI MUST stay synchronized

Any API implementation change MUST update OpenAPI in the same change set.

Any OpenAPI change MUST be reflected by implementation and tests.

The LLM MUST NOT leave TODO placeholders such as:

```yaml
description: TODO
schema:
  type: object
```

Unless the task is explicitly only a placeholder draft and clearly marked as non-production.

### 4.3 OpenAPI must be precise enough for generation and testing

A valid OpenAPI file is not automatically a useful OpenAPI file.

The specification MUST be precise enough to support:

- client generation;
- server stub generation where applicable;
- contract testing;
- example validation;
- schema validation;
- security review;
- API documentation;
- breaking-change detection.

---

## 5. Mandatory Document Structure

### OPENAPI-001: Use a stable file location and name

The repository MUST have a predictable OpenAPI location.

Preferred:

```text
api/openapi.yaml
```

or:

```text
openapi/openapi.yaml
```

For multiple APIs:

```text
api/public/openapi.yaml
api/internal/openapi.yaml
api/admin/openapi.yaml
```

The LLM MUST follow existing repository conventions if already established.

### OPENAPI-002: Use YAML by default, JSON only when tooling requires it

Preferred source format:

```text
openapi.yaml
```

Generated JSON MAY exist but MUST be marked generated.

The LLM MUST NOT manually maintain both YAML and JSON copies unless the repository has an explicit generation pipeline.

### OPENAPI-003: Required top-level fields

Every OpenAPI file MUST define:

```yaml
openapi: 3.1.0
info:
  title: Example API
  version: 1.0.0
  description: Public contract for Example API.
servers:
  - url: https://api.example.com
paths: {}
components: {}
```

Required `info` fields:

- `title`;
- `version`;
- `description`;
- contact/license where organization policy requires it.

The `info.version` MUST represent the API contract version, not necessarily the application build version.

### OPENAPI-004: Servers MUST not leak internal infrastructure

Bad:

```yaml
servers:
  - url: http://case-service.default.svc.cluster.local:8080
```

Good:

```yaml
servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://staging-api.example.com/v1
    description: Staging
```

Internal specs MAY use internal URLs only if the API is explicitly internal.

---

## 6. Paths and Operations

### OPENAPI-005: Paths MUST follow RESTful resource standards

The LLM MUST align OpenAPI paths with the RESTful API standard.

Good:

```yaml
paths:
  /cases/{caseId}:
    get:
      summary: Get case by ID
```

Bad:

```yaml
paths:
  /getCaseById:
    post:
      summary: Gets a case
```

### OPENAPI-006: Every operation MUST have stable operationId

Each operation MUST include a stable, unique `operationId`.

Recommended format:

```yaml
operationId: getCase
operationId: listCases
operationId: createCase
operationId: updateCase
operationId: approveCase
operationId: exportReport
```

Rules:

- operation IDs MUST be unique across the document;
- operation IDs MUST be stable because generators use them for method names;
- do not include HTTP method redundantly if naming convention already implies it, unless local standard requires it;
- do not include version numbers unless multiple versions exist in the same spec;
- do not rename operation IDs without checking generated clients.

Bad:

```yaml
operationId: caseControllerGetCaseUsingGET
operationId: getCase_1
operationId: apiV1CasesCaseIdGet
```

### OPENAPI-007: Every operation MUST have summary and useful description

`summary` MUST be short and action-oriented.

`description` MUST explain behavior, constraints, and domain impact when non-obvious.

Bad:

```yaml
summary: API
operationId: doAction
```

Good:

```yaml
summary: Approve a case
operationId: approveCase
description: |
  Creates an approval decision for the case. The case must be in PENDING_REVIEW state.
  The operation is idempotent when the same Idempotency-Key is reused with the same request body.
```

### OPENAPI-008: Tags MUST be meaningful and consistent

Each operation MUST have at least one tag.

Tags SHOULD represent API domains/resources, not controller classes.

Good:

```yaml
tags:
  - Cases
```

Bad:

```yaml
tags:
  - CaseController
  - com.example.case.web.CaseRestController
```

For OpenAPI 3.2.0, hierarchical/structured tags MAY be used only if tooling supports them.

### OPENAPI-009: Path parameters MUST be declared once per path when shared

Good:

```yaml
paths:
  /cases/{caseId}:
    parameters:
      - $ref: "#/components/parameters/CaseIdPathParam"
    get:
      operationId: getCase
```

Rules:

- path parameter names MUST match path template exactly;
- path parameters MUST be `required: true`;
- path parameters MUST have schema, description, and example;
- IDs SHOULD be strings in public contracts unless there is a strong reason otherwise.

---

## 7. Parameters

### OPENAPI-010: Query parameters MUST be explicit and bounded

Every query parameter MUST define:

- name;
- location;
- required flag;
- schema;
- description;
- allowed values or constraints;
- example when useful.

Good:

```yaml
parameters:
  - name: limit
    in: query
    required: false
    description: Maximum number of items to return. Defaults to 50. Maximum is 200.
    schema:
      type: integer
      minimum: 1
      maximum: 200
      default: 50
    example: 50
```

The LLM MUST NOT define unbounded or ambiguous query parameters:

```yaml
- name: query
  in: query
  schema:
    type: string
```

Unless the semantics are fully described.

### OPENAPI-011: Pagination parameters MUST be standardized

Preferred cursor pagination parameters:

```yaml
- $ref: "#/components/parameters/PageTokenQueryParam"
- $ref: "#/components/parameters/LimitQueryParam"
```

Preferred response schema:

```yaml
CaseListResponse:
  type: object
  required:
    - items
    - limit
  properties:
    items:
      type: array
      items:
        $ref: "#/components/schemas/Case"
    nextPageToken:
      type:
        - string
        - "null"
    limit:
      type: integer
```

The LLM MUST NOT document collection responses as raw arrays for potentially paginated endpoints.

Bad:

```yaml
schema:
  type: array
  items:
    $ref: "#/components/schemas/Case"
```

For unbounded collections, this is forbidden.

### OPENAPI-012: Header parameters MUST be documented when part of contract

Headers such as these MUST be documented when used:

- `Idempotency-Key`;
- `If-Match`;
- `If-None-Match`;
- `X-Request-Id`;
- `Traceparent`;
- `Accept-Language`;
- rate limit response headers;
- deprecation/sunset headers.

Example:

```yaml
IdempotencyKeyHeader:
  name: Idempotency-Key
  in: header
  required: false
  description: Unique key used to safely retry non-idempotent requests.
  schema:
    type: string
    minLength: 8
    maxLength: 255
```

---

## 8. Request Bodies

### OPENAPI-013: Request bodies MUST be explicit

Every operation with body MUST define `requestBody`.

Good:

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/CreateCaseRequest"
      examples:
        default:
          value:
            applicantId: applicant_123
            caseType: LICENSE_RENEWAL
```

The LLM MUST NOT use vague request bodies:

```yaml
requestBody:
  content:
    application/json:
      schema:
        type: object
```

### OPENAPI-014: Use separate schemas for create, update, patch, and response

The LLM MUST NOT reuse one schema for all directions if required fields differ.

Good:

```text
CreateCaseRequest
UpdateCaseRequest
PatchCaseRequest
CaseResponse
CaseSummary
```

Bad:

```text
CaseDto used for create, update, response, database, and events
```

Reason:

- server-generated fields should not be accepted from clients;
- required-on-create fields may be optional-on-update;
- response fields may include read-only computed data;
- request validation differs from response representation.

### OPENAPI-015: File upload schemas MUST be precise

Multipart upload example:

```yaml
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
          documentType:
            type: string
            enum:
              - NOTICE
              - EVIDENCE
```

The LLM MUST define size/type restrictions in description if OpenAPI cannot express them fully.

---

## 9. Responses

### OPENAPI-016: Every operation MUST define all expected success responses

Good:

```yaml
responses:
  "201":
    description: Case created.
    headers:
      Location:
        schema:
          type: string
        description: URI of the created case.
    content:
      application/json:
        schema:
          $ref: "#/components/schemas/CaseResponse"
```

The LLM MUST NOT define only:

```yaml
responses:
  "200":
    description: OK
```

### OPENAPI-017: Every operation MUST define standard error responses

At minimum, define applicable errors:

- `400` malformed request;
- `401` unauthenticated;
- `403` forbidden;
- `404` not found;
- `409` conflict;
- `412` precondition failed;
- `415` unsupported media type;
- `422` validation error;
- `429` rate limited;
- `500` unexpected error;
- `503` unavailable.

Use reusable Problem Details schemas.

Example:

```yaml
responses:
  "422":
    $ref: "#/components/responses/ValidationError"
```

### OPENAPI-018: Response content types MUST be explicit

Good:

```yaml
content:
  application/json:
    schema:
      $ref: "#/components/schemas/CaseResponse"
```

Problem Details:

```yaml
content:
  application/problem+json:
    schema:
      $ref: "#/components/schemas/ProblemDetails"
```

Binary:

```yaml
content:
  application/pdf:
    schema:
      type: string
      format: binary
```

The LLM MUST NOT omit media types for responses with bodies.

### OPENAPI-019: Empty responses MUST not define fake bodies

For `204 No Content`:

```yaml
"204":
  description: Case deleted.
```

Do not define:

```yaml
"204":
  description: OK
  content:
    application/json:
      schema:
        type: object
```

---

## 10. Schema Standards

### OPENAPI-020: Component schemas MUST be named by contract role

Good schema names:

```text
CaseResponse
CaseSummary
CreateCaseRequest
UpdateCaseRequest
CaseListResponse
ProblemDetails
ValidationProblemDetails
```

Bad schema names:

```text
CaseDto
CaseEntity
CaseModel
Response1
ObjectMap
Payload
```

The schema name MUST communicate contract role.

### OPENAPI-021: Required fields MUST be explicit

Every object schema MUST define `required` unless all fields are intentionally optional.

Good:

```yaml
CaseResponse:
  type: object
  required:
    - id
    - status
    - createdAt
  properties:
    id:
      type: string
    status:
      $ref: "#/components/schemas/CaseStatus"
    createdAt:
      type: string
      format: date-time
```

The LLM MUST NOT rely on readers guessing optionality.

### OPENAPI-022: Nullability MUST follow OpenAPI 3.1+ JSON Schema style

For OpenAPI 3.1+:

```yaml
middleName:
  type:
    - string
    - "null"
```

Avoid old OpenAPI 3.0 style in 3.1+ specs:

```yaml
nullable: true
```

Unless maintaining a 3.0 spec.

The LLM MUST define whether a field can be absent, null, or empty.

### OPENAPI-023: Avoid vague open objects

The LLM MUST NOT use unrestricted objects unless truly necessary.

Bad:

```yaml
metadata:
  type: object
```

Better:

```yaml
metadata:
  type: object
  additionalProperties:
    type: string
```

Best when known:

```yaml
metadata:
  type: object
  properties:
    source:
      type: string
    importedAt:
      type: string
      format: date-time
  additionalProperties: false
```

Rules:

- use `additionalProperties: false` where strict contracts are desired;
- allow additional properties only when extension is intentional;
- document extension semantics.

### OPENAPI-024: Format, pattern, min/max, and length constraints MUST be used

The LLM MUST express validation constraints in schema when known.

Good:

```yaml
email:
  type: string
  format: email
  maxLength: 254

caseReferenceNo:
  type: string
  pattern: "^[A-Z]{3}-[0-9]{8}$"
  example: LIC-20260001

limit:
  type: integer
  minimum: 1
  maximum: 200
```

The LLM MUST NOT hide important validation only in prose or implementation code.

### OPENAPI-025: Enumerations MUST be centralized

Good:

```yaml
CaseStatus:
  type: string
  description: Current lifecycle state of a case.
  enum:
    - DRAFT
    - SUBMITTED
    - PENDING_REVIEW
    - APPROVED
    - REJECTED
```

Rules:

- define enum meaning;
- avoid duplicate enum definitions;
- document whether clients must tolerate unknown values;
- do not rename enum values without migration.

### OPENAPI-026: oneOf/anyOf/allOf MUST be used carefully

The LLM MAY use composition only when it improves correctness.

Rules:

- use `oneOf` for mutually exclusive alternatives;
- include discriminator when useful and supported;
- avoid deep inheritance-like schemas for simple DTO reuse;
- avoid `allOf` chains that code generators handle poorly;
- test generated clients when using polymorphism.

Bad:

```yaml
allOf:
  - $ref: "#/components/schemas/BaseEntity"
  - $ref: "#/components/schemas/AuditableEntity"
  - $ref: "#/components/schemas/CaseEntity"
```

This exposes internal inheritance instead of API contract.

### OPENAPI-027: Read-only and write-only fields MUST be marked

Good:

```yaml
id:
  type: string
  readOnly: true

password:
  type: string
  writeOnly: true
```

Rules:

- server-generated fields SHOULD be `readOnly`;
- secrets SHOULD be `writeOnly`;
- do not put `readOnly` fields in create request schemas unless generator behavior is understood;
- prefer separate request/response schemas for clarity.

---

## 11. Problem Details Standard Components

The OpenAPI specification MUST define reusable problem schemas.

```yaml
components:
  schemas:
    ProblemDetails:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri-reference
          description: Stable problem type identifier.
        title:
          type: string
          description: Short human-readable summary.
        status:
          type: integer
          format: int32
          minimum: 400
          maximum: 599
        detail:
          type: string
          description: Human-readable detail specific to this occurrence.
        instance:
          type: string
          format: uri-reference
          description: URI reference identifying this occurrence.
        traceId:
          type: string
          description: Request or trace identifier for support.
      additionalProperties: true

    ValidationProblemDetails:
      allOf:
        - $ref: "#/components/schemas/ProblemDetails"
        - type: object
          required:
            - errors
          properties:
            errors:
              type: array
              items:
                $ref: "#/components/schemas/FieldError"

    FieldError:
      type: object
      required:
        - field
        - code
        - message
      properties:
        field:
          type: string
        code:
          type: string
        message:
          type: string
```

The LLM MUST reuse these schemas for error responses instead of inventing per-endpoint error shapes.

---

## 12. Security Schemes

### OPENAPI-028: Security schemes MUST be defined centrally

Example Bearer JWT:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

Example OAuth2 authorization code:

```yaml
components:
  securitySchemes:
    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/oauth2/authorize
          tokenUrl: https://auth.example.com/oauth2/token
          scopes:
            cases.read: Read cases
            cases.write: Create and update cases
```

### OPENAPI-029: Every operation MUST declare security behavior

Global security MAY be declared:

```yaml
security:
  - bearerAuth: []
```

Public endpoints MUST override explicitly:

```yaml
security: []
```

The LLM MUST NOT leave security ambiguous.

### OPENAPI-030: Authorization scopes/roles MUST be documented

If OAuth scopes are used, operations MUST list required scopes:

```yaml
security:
  - oauth2:
      - cases.read
```

If role-based authorization is used outside OAuth scopes, document it in operation description or an extension such as:

```yaml
x-required-roles:
  - CASE_OFFICER
```

Extensions MUST be standardized within the repository.

---

## 13. Examples

### OPENAPI-031: Examples MUST be valid and realistic

The LLM MUST provide examples for important requests and responses.

Rules:

- examples MUST match schemas;
- examples MUST not contain real secrets or PII;
- examples SHOULD include realistic IDs and timestamps;
- examples SHOULD cover validation errors and conflict errors for complex operations;
- examples MUST be updated when schema changes.

Bad:

```yaml
example:
  foo: bar
```

Good:

```yaml
example:
  id: case_01HXZ7N6M4K1S9V2Z7R2K3A8BC
  status: PENDING_REVIEW
  createdAt: "2026-06-10T09:30:00Z"
```

### OPENAPI-032: Do not duplicate large examples unnecessarily

For repeated examples, use reusable examples:

```yaml
components:
  examples:
    ValidationErrorExample:
      value:
        type: https://api.example.com/problems/validation-error
        title: Validation failed
        status: 422
```

---

## 14. Reuse and Components

### OPENAPI-033: Shared concepts MUST be reusable components

The LLM MUST define reusable components for:

- common parameters;
- common headers;
- common responses;
- common schemas;
- common examples;
- security schemes.

Good:

```yaml
components:
  parameters:
    CaseIdPathParam:
      name: caseId
      in: path
      required: true
      schema:
        type: string
```

Bad: redefining `caseId` differently across many endpoints.

### OPENAPI-034: Reuse MUST not create fake abstraction

The LLM MUST NOT over-reuse generic schemas that hide endpoint-specific meaning.

Bad:

```yaml
GenericResponse:
  type: object
  properties:
    data:
      type: object
    message:
      type: string
```

Good:

```yaml
CaseResponse
CaseListResponse
CreateCaseResponse
```

Reuse common concepts, not vague wrappers.

---

## 15. Compatibility and Breaking Change Rules

### OPENAPI-035: The LLM MUST classify every OpenAPI change

Classify as:

- non-contractual documentation change;
- backward-compatible additive change;
- potentially breaking change;
- definitely breaking change.

### OPENAPI-036: Breaking changes MUST be explicit

Breaking changes include:

- removing path/operation;
- changing method;
- changing path parameter name;
- removing request/response field;
- changing field type/format;
- changing required field set;
- making optional request field required;
- changing enum values;
- changing default pagination or sorting behavior;
- changing success/error status code semantics;
- changing security requirements;
- changing media type;
- changing operationId used by generated clients;
- changing schema names consumed by generated clients.

The LLM MUST NOT perform breaking changes silently.

### OPENAPI-037: Additive changes still require caution

Adding response fields is usually compatible, but clients may fail if they use strict deserialization.

Adding enum values may be breaking for clients with exhaustive enum handling.

Adding validation constraints may be breaking for clients currently sending values that used to work.

The LLM MUST mention these risks in review notes.

---

## 16. Deprecation

### OPENAPI-038: Deprecated operations and fields MUST be marked

Operation:

```yaml
deprecated: true
description: |
  Deprecated since 2026-06-10. Use GET /cases/{caseId} instead.
  This endpoint will be removed after 2026-12-31.
```

Field:

```yaml
oldStatus:
  type: string
  deprecated: true
  description: Use status instead.
```

The LLM MUST include replacement and timeline when known.

### OPENAPI-039: Deprecated contract MUST remain documented while supported

The LLM MUST NOT remove deprecated endpoints from OpenAPI while they still exist and are supported.

Removal from documentation is itself a contract signal and may break clients.

---

## 17. Validation and CI Gates

### OPENAPI-040: OpenAPI MUST pass structural validation

CI MUST validate that the OpenAPI document is syntactically and structurally valid.

Examples of acceptable tooling:

- OpenAPI parser/validator;
- Spectral or equivalent linter;
- generator dry-run;
- documentation build;
- contract test framework;
- breaking-change checker.

The LLM MUST not create specs that only "look right".

### OPENAPI-041: Lint rules SHOULD enforce local standards

Recommended lint checks:

- operationId required and unique;
- tags required;
- summary required;
- descriptions required for public APIs;
- no undocumented error responses;
- no raw array response for paginated collections;
- no undefined path parameters;
- no unused components above threshold;
- no `type: object` without properties/additionalProperties decision;
- no undocumented security;
- no internal server URLs in public specs;
- examples must validate;
- schema names must match naming convention.

### OPENAPI-042: Generated artifacts MUST be deterministic

If clients, server stubs, docs, or typed models are generated from OpenAPI:

- generation command MUST be documented;
- generated files MUST be clearly marked;
- generated output SHOULD be deterministic;
- manual edits to generated files MUST be forbidden;
- CI SHOULD fail when generated output is stale.

---

## 18. LLM OpenAPI Workflow

Before editing OpenAPI, the LLM MUST follow this sequence:

```text
1. Identify whether the change is new endpoint, schema change, behavior change, error change, or documentation-only change.
2. Check existing API conventions in the repository.
3. Determine OpenAPI version and tooling constraints.
4. Update paths and operations.
5. Update schemas and reusable components.
6. Update request/response examples.
7. Update security requirements.
8. Update standard error responses.
9. Check backward compatibility.
10. Check generated client/stub impact.
11. Validate OpenAPI syntax and linter rules if tools are available.
12. Update implementation/tests or flag missing implementation explicitly.
```

The LLM MUST NOT edit OpenAPI in isolation when implementation behavior changes.

---

## 19. Anti-Patterns

The LLM MUST reject or refactor these patterns.

### 19.1 Vague universal object

```yaml
schema:
  type: object
```

Without properties, constraints, or additional property rules.

### 19.2 Missing errors

```yaml
responses:
  "200":
    description: OK
```

Only one happy-path response.

### 19.3 Framework-generated operation IDs

```yaml
operationId: caseControllerFindByIdUsingGET
```

### 19.4 Public schema exposes entity names

```yaml
CaseJpaEntity:
  type: object
```

### 19.5 Duplicated inline schemas

Repeating the same object structure across endpoints instead of defining a component.

### 19.6 Generic response envelope everywhere

```yaml
ApiResponseObject:
  type: object
  properties:
    code:
      type: string
    data:
      type: object
```

Without typed schemas.

### 19.7 Security omitted

No global security and no operation-level security declaration.

### 19.8 Examples that do not validate

Example fields differ from schema fields.

### 19.9 Unversioned breaking change

Changing schema or operation ID without compatibility review.

### 19.10 Documentation-only fantasy endpoint

OpenAPI describes behavior not implemented by the service.

---

## 20. Minimal Production-Quality Template

```yaml
openapi: 3.1.0
info:
  title: Case API
  version: 1.0.0
  description: API for case lifecycle management.
servers:
  - url: https://api.example.com/v1
    description: Production
security:
  - bearerAuth: []
tags:
  - name: Cases
    description: Case resources and lifecycle operations.
paths:
  /cases/{caseId}:
    parameters:
      - $ref: "#/components/parameters/CaseIdPathParam"
    get:
      tags:
        - Cases
      summary: Get case
      description: Returns a case by ID if the caller is authorized to view it.
      operationId: getCase
      responses:
        "200":
          description: Case found.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CaseResponse"
              examples:
                default:
                  value:
                    id: case_123
                    status: PENDING_REVIEW
                    createdAt: "2026-06-10T09:30:00Z"
        "401":
          $ref: "#/components/responses/UnauthorizedError"
        "403":
          $ref: "#/components/responses/ForbiddenError"
        "404":
          $ref: "#/components/responses/NotFoundError"
        "500":
          $ref: "#/components/responses/InternalServerError"
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  parameters:
    CaseIdPathParam:
      name: caseId
      in: path
      required: true
      description: Stable case identifier.
      schema:
        type: string
      example: case_123
  responses:
    UnauthorizedError:
      description: Authentication is missing or invalid.
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/ProblemDetails"
    ForbiddenError:
      description: Caller is authenticated but not authorized.
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/ProblemDetails"
    NotFoundError:
      description: Resource was not found or is not visible to the caller.
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/ProblemDetails"
    InternalServerError:
      description: Unexpected server error.
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/ProblemDetails"
  schemas:
    CaseResponse:
      type: object
      required:
        - id
        - status
        - createdAt
      properties:
        id:
          type: string
          example: case_123
        status:
          $ref: "#/components/schemas/CaseStatus"
        createdAt:
          type: string
          format: date-time
          example: "2026-06-10T09:30:00Z"
      additionalProperties: false
    CaseStatus:
      type: string
      description: Current lifecycle state of a case.
      enum:
        - DRAFT
        - SUBMITTED
        - PENDING_REVIEW
        - APPROVED
        - REJECTED
    ProblemDetails:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri-reference
        title:
          type: string
        status:
          type: integer
          minimum: 400
          maximum: 599
        detail:
          type: string
        instance:
          type: string
          format: uri-reference
        traceId:
          type: string
      additionalProperties: true
```

---

## 21. OpenAPI Review Checklist

A specification change is acceptable only if all relevant checks pass.

### Structure

- [ ] Correct OpenAPI version is used.
- [ ] File location follows repository convention.
- [ ] `info`, `servers`, `paths`, and `components` are present.
- [ ] Public specs do not expose internal servers.

### Operations

- [ ] Paths follow RESTful API standard.
- [ ] Every operation has unique stable `operationId`.
- [ ] Every operation has useful `summary`.
- [ ] Complex behavior has `description`.
- [ ] Tags are meaningful.
- [ ] Path parameters match templates exactly.

### Parameters

- [ ] Query parameters have constraints.
- [ ] Pagination parameters are standardized.
- [ ] Header parameters are documented where contractually relevant.
- [ ] Unsupported filter/sort behavior is documented.

### Requests

- [ ] Request body is explicit.
- [ ] Create/update/patch/response schemas are separated where needed.
- [ ] Media types are correct.
- [ ] Examples validate.

### Responses

- [ ] Success responses are complete.
- [ ] Error responses use Problem Details.
- [ ] `204` responses have no body.
- [ ] Binary responses are documented correctly.
- [ ] Headers such as `Location`, `ETag`, `Retry-After`, and rate limit headers are documented where used.

### Schemas

- [ ] Required fields are explicit.
- [ ] Nullability is explicit.
- [ ] Constraints are encoded in schema.
- [ ] Enums are centralized and documented.
- [ ] No vague object schemas unless intentional.
- [ ] `additionalProperties` behavior is intentional.
- [ ] Read-only/write-only fields are marked.

### Security

- [ ] Security schemes are defined.
- [ ] Global or operation-level security is explicit.
- [ ] Public endpoints are explicitly marked with `security: []`.
- [ ] Scopes/roles are documented.

### Compatibility

- [ ] Change is classified as compatible or breaking.
- [ ] Breaking changes are versioned or approved.
- [ ] Deprecated operations/fields are marked with replacement.
- [ ] Operation IDs and schema names are not renamed casually.

### Tooling

- [ ] OpenAPI validates.
- [ ] Linter passes.
- [ ] Generated code/docs are updated if applicable.
- [ ] Contract tests are updated.
- [ ] Examples validate against schemas.

---

## 22. Acceptance Criteria

An OpenAPI document satisfies this standard only if:

1. It is valid against the selected OpenAPI version.
2. It accurately reflects implemented API behavior.
3. It follows the repository RESTful API standard.
4. Every operation is documented with stable identifiers, parameters, request bodies, responses, errors, and security.
5. Schemas are precise enough for validation and generation.
6. Error responses are standardized using Problem Details.
7. Examples are realistic and schema-valid.
8. Compatibility impact is reviewed.
9. CI can validate, lint, and optionally generate/test from the contract.
10. No internal implementation details leak into the public contract.

---

## 23. References

- OpenAPI Specification latest: `https://spec.openapis.org/oas/latest.html`
- OpenAPI Specification v3.2.0: `https://spec.openapis.org/oas/v3.2.0.html`
- OpenAPI Specification v3.1.1: `https://spec.openapis.org/oas/v3.1.1.html`
- OpenAPI Initiative release announcement for v3.2: `https://www.openapis.org/blog/2025/09/23/announcing-openapi-v3-2`
- RFC 9110, HTTP Semantics: `https://www.rfc-editor.org/rfc/rfc9110.html`
- RFC 9457, Problem Details for HTTP APIs: `https://www.rfc-editor.org/rfc/rfc9457.html`
- JSON Schema: `https://json-schema.org/`
- Spectral OpenAPI linter: `https://docs.stoplight.io/docs/spectral/`
