# OpenAPI Mastery for Java Engineers — Part 002
# OpenAPI Specification Landscape: Swagger, OAS 2.0, 3.0, 3.1, 3.2

> **Series:** `learn-openapi-mastery-for-java-engineers`  
> **Part:** `002 / 030`  
> **Filename:** `learn-openapi-mastery-for-java-engineers-part-002.md`  
> **Audience:** Java software engineer, tech lead, backend/platform/API engineer  
> **Focus:** Understanding the OpenAPI version landscape deeply enough to make architecture, tooling, governance, compatibility, and migration decisions.

---

## 0. Why This Part Matters

Most engineers encounter OpenAPI through a generated `/v3/api-docs` endpoint, Swagger UI, or a YAML file in a repository. That is useful, but incomplete.

The serious engineering question is not:

> “How do I enable Swagger in Spring Boot?”

The serious question is:

> “Which OpenAPI version, modelling semantics, and tooling lifecycle should this organization standardize on so API contracts stay reliable for years?”

That question is harder because **OpenAPI is not one static thing**. It has a history:

- Swagger 1.x and 2.0 shaped the early ecosystem.
- OpenAPI 3.0 changed the structure significantly.
- OpenAPI 3.1 aligned schema modelling with JSON Schema 2020-12.
- OpenAPI 3.2 introduced newer modelling features while aiming for backward compatibility with 3.1.

A top-tier engineer does not treat version numbers as decoration. Version choice affects:

- schema validity,
- nullable semantics,
- generated Java models,
- generated TypeScript clients,
- validation behavior,
- API lint rules,
- gateway compatibility,
- documentation rendering,
- contract diffing,
- mock server behavior,
- long-term migration cost.

This part gives you the map.

---

## 1. Core Mental Model

OpenAPI has two layers you must keep separate.

```text
OpenAPI ecosystem
├── Specification
│   ├── OAS 2.0
│   ├── OAS 3.0.x
│   ├── OAS 3.1.x
│   └── OAS 3.2.x
│
├── Description documents
│   ├── openapi.yaml
│   ├── openapi.json
│   ├── bundled specs
│   ├── multi-file specs
│   └── generated specs
│
└── Tools
    ├── Swagger UI
    ├── Swagger Editor
    ├── Swagger Core
    ├── springdoc-openapi
    ├── OpenAPI Generator
    ├── validators
    ├── linters
    ├── diff tools
    ├── mock servers
    ├── API gateways
    └── API catalogs
```

The **specification** defines what an OpenAPI document means.

A **description document** is your concrete API contract.

A **tool** reads, writes, validates, renders, generates, or enforces something based on that document.

The critical failure mode is assuming these three evolve at the same speed. They do not.

A spec version can be official before every tool supports it well. A tool can accept a document syntactically while misunderstanding a newer semantic. A generated document can be valid but still useless as a consumer contract.

---

## 2. Terminology That Must Be Untangled

### 2.1 Swagger

Historically, **Swagger** was the original API description ecosystem. It included a specification and tools.

Today, people still say “Swagger” loosely to mean any of these:

- OpenAPI document,
- Swagger UI,
- Swagger Editor,
- Swagger annotations,
- generated REST documentation,
- API docs page.

That looseness is common, but architecturally dangerous.

When someone says:

> “Have we updated Swagger?”

A precise engineer asks:

```text
Do you mean:
- the OpenAPI document?
- the generated endpoint exposed by the service?
- the Swagger UI page?
- the generated client?
- the source annotations?
- the published API catalog entry?
- the API contract version used by consumers?
```

### 2.2 Swagger UI

Swagger UI is a documentation renderer and interactive API explorer.

It is not the specification.

```text
OpenAPI YAML/JSON  ──read by──>  Swagger UI  ──renders──>  interactive docs
```

Swagger UI can make a bad contract look polished. Good UI does not imply good API design.

### 2.3 Swagger Editor

Swagger Editor helps edit and validate OpenAPI/Swagger descriptions.

It is useful during authoring, but it does not replace:

- organizational style guide,
- compatibility diff checks,
- security review,
- example validation,
- generated client testing,
- consumer feedback.

### 2.4 Swagger Codegen

Swagger Codegen is an older code generation ecosystem historically associated with Swagger/OpenAPI.

Many organizations now prefer **OpenAPI Generator**, which originated as a fork and has a broad generator ecosystem. But the correct choice depends on language targets, template control, stability, and organizational standardization.

### 2.5 OpenAPI Generator

OpenAPI Generator generates:

- Java clients,
- Spring server stubs,
- TypeScript clients,
- Kotlin clients,
- Go clients,
- Python clients,
- documentation,
- models,
- test scaffolding,
- many other targets.

But code generation is not magic. It amplifies contract quality.

```text
Good OpenAPI contract  -> useful generated client
Bad OpenAPI contract   -> mechanically generated pain
```

### 2.6 OpenAPI Specification

The OpenAPI Specification, or OAS, is the standard that defines the structure and semantics of OpenAPI descriptions.

This series focuses primarily on OAS, not on one vendor’s UI or framework.

---

## 3. Historical Timeline

Approximate high-level timeline:

```text
2010–2011     Swagger begins around REST API description tooling
2015          Swagger Specification donated to OpenAPI Initiative
2016          Swagger Specification renamed OpenAPI Specification
2017          OpenAPI 3.0.0 released
2021          OpenAPI 3.1.0 released, aligned with JSON Schema 2020-12
2025          OpenAPI 3.2.0 released
```

The practical consequence:

- `swagger: '2.0'` documents are still found in mature enterprises.
- `openapi: 3.0.x` is still very common in Java/Spring systems.
- `openapi: 3.1.x` is increasingly preferred for better schema correctness.
- `openapi: 3.2.x` is current, but tooling support may vary depending on ecosystem.

---

## 4. Version Recognition by the Root Field

You can identify the family quickly.

### Swagger / OpenAPI 2.0

```yaml
swagger: '2.0'
info:
  title: Example API
  version: '1.0.0'
paths: {}
```

### OpenAPI 3.x

```yaml
openapi: 3.0.3
info:
  title: Example API
  version: '1.0.0'
paths: {}
```

or:

```yaml
openapi: 3.1.0
info:
  title: Example API
  version: '1.0.0'
paths: {}
```

or:

```yaml
openapi: 3.2.0
info:
  title: Example API
  version: '1.0.0'
paths: {}
```

Do not confuse:

```yaml
openapi: 3.1.0
```

with:

```yaml
info:
  version: '1.0.0'
```

They mean different things.

```text
openapi field     = version of the OpenAPI Specification used by the document
info.version      = version of your API/product/contract artifact
```

Example:

```yaml
openapi: 3.1.0
info:
  title: Enforcement Case API
  version: '2026.06.20'
```

This means:

- the document uses OpenAPI Specification 3.1.0,
- the API contract version is `2026.06.20`.

They should not be coupled.

---

## 5. OAS 2.0 / Swagger 2.0

### 5.1 What It Looks Like

```yaml
swagger: '2.0'
info:
  title: Customer API
  version: '1.0.0'
host: api.example.com
basePath: /v1
schemes:
  - https
paths:
  /customers/{id}:
    get:
      operationId: getCustomer
      parameters:
        - name: id
          in: path
          required: true
          type: string
      responses:
        '200':
          description: Customer found
          schema:
            $ref: '#/definitions/Customer'
definitions:
  Customer:
    type: object
    required:
      - id
      - name
    properties:
      id:
        type: string
      name:
        type: string
```

### 5.2 Main Characteristics

OAS 2.0 has:

- `swagger: '2.0'` instead of `openapi: 3.x.x`,
- `host`, `basePath`, and `schemes` instead of `servers`,
- `definitions` instead of `components.schemas`,
- `parameters` and `responses` as top-level reusable sections,
- `consumes` and `produces` for media types,
- body parameters instead of `requestBody`,
- weaker modelling for multiple content types,
- weaker request/response body structure compared with 3.x,
- no top-level `webhooks`,
- no modern JSON Schema alignment.

### 5.3 Why It Still Exists

You may still see OAS 2.0 because:

- old API gateways imported Swagger 2.0 early,
- legacy clients were generated from it,
- large enterprises standardized before OAS 3.0 matured,
- internal APIs were never migrated,
- some vendor tools still provide decent 2.0 support,
- teams fear changing contract artifacts used by consumers.

### 5.4 Strengths

OAS 2.0 is:

- widely recognized,
- simple enough for basic APIs,
- still supported by many tools,
- familiar to older codegen pipelines.

### 5.5 Weaknesses

OAS 2.0 struggles with:

- multiple content types per operation,
- request body modelling,
- callbacks/webhooks,
- complex schema semantics,
- modern JSON Schema features,
- nuanced content negotiation,
- clearer component organization.

### 5.6 When You Might Keep It

Keep OAS 2.0 temporarily if:

- a critical gateway only supports it,
- external consumers depend on generated SDKs from it,
- migration cost is high and API is stable,
- you are maintaining, not evolving, an old API.

But for new Java/Spring systems, choosing OAS 2.0 is usually hard to justify unless constrained by a vendor or platform.

---

## 6. OAS 3.0.x

### 6.1 What It Looks Like

```yaml
openapi: 3.0.3
info:
  title: Customer API
  version: '1.0.0'
servers:
  - url: https://api.example.com/v1
paths:
  /customers/{id}:
    get:
      operationId: getCustomer
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Customer found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Customer'
components:
  schemas:
    Customer:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: string
        name:
          type: string
```

### 6.2 Main Improvements Over 2.0

OAS 3.0 introduced a better document model:

- `servers` replaces `host` / `basePath` / `schemes`,
- `components` consolidates reusable definitions,
- `requestBody` separates body payloads from parameters,
- `content` allows media-type-specific request/response schemas,
- callbacks are supported,
- links are supported,
- security schemes are improved,
- examples are better structured.

### 6.3 Why OAS 3.0.x Is Still Very Common

For Java engineers, OAS 3.0.x is often the default because:

- many Spring/OpenAPI integrations matured around it,
- many enterprise tools adopted 3.0 before 3.1,
- many validators and generators handle 3.0 predictably,
- API gateways often support it well,
- teams prefer tooling maturity over newer schema semantics.

### 6.4 The Important Limitation: Schema Is Not Full JSON Schema

OAS 3.0 uses a Schema Object that is inspired by JSON Schema but not fully aligned with modern JSON Schema.

That means some JSON Schema expectations do not hold.

For example, in OAS 3.0, nullable is usually represented as:

```yaml
schema:
  type: string
  nullable: true
```

But in JSON Schema 2020-12 style, nullability is represented differently:

```yaml
schema:
  type:
    - string
    - 'null'
```

This difference matters for:

- validators,
- generators,
- Java boxed types,
- TypeScript union types,
- database null semantics,
- contract diffing,
- compatibility analysis.

### 6.5 When OAS 3.0.x Is a Good Choice

OAS 3.0.x is a reasonable standard if:

- your ecosystem already has stable 3.0 tooling,
- your APIs are mostly conventional JSON request/response APIs,
- you rely on API gateways with stronger 3.0 than 3.1 support,
- your generated clients behave predictably under 3.0,
- your organization is not ready to standardize JSON Schema 2020-12 semantics.

### 6.6 When OAS 3.0.x Becomes Limiting

It becomes limiting when:

- you need modern JSON Schema semantics,
- you need better schema reuse/dialect clarity,
- you want less OpenAPI-specific schema weirdness,
- you need stronger validation expressiveness,
- you want clearer null handling,
- you are designing a long-lived API platform from scratch.

---

## 7. OAS 3.1.x

### 7.1 Why 3.1 Matters

OAS 3.1 is a major conceptual milestone because it aligns the Schema Object with JSON Schema 2020-12.

That is not a cosmetic change.

It changes how you should think about schema modelling.

```text
OAS 3.0 schema mental model:
OpenAPI-specific schema dialect inspired by JSON Schema

OAS 3.1 schema mental model:
OpenAPI uses JSON Schema 2020-12 for schema modelling
```

### 7.2 Example: Nullability

OAS 3.0:

```yaml
schema:
  type: string
  nullable: true
```

OAS 3.1:

```yaml
schema:
  type:
    - string
    - 'null'
```

This is cleaner because `null` becomes part of the actual type system, not an OpenAPI-specific modifier.

### 7.3 Example: Boolean Schemas

JSON Schema supports boolean schemas.

```yaml
schema: true
```

means anything is valid.

```yaml
schema: false
```

means nothing is valid.

This can be useful in advanced composition and constraints, though it should be used carefully in API contracts because many humans find it less readable.

### 7.4 Example: Better JSON Schema Features

OAS 3.1 unlocks modern JSON Schema features such as:

- `if` / `then` / `else`,
- `const`,
- improved composition semantics,
- schema dialect declaration,
- tuple validation,
- more precise object modelling.

This is powerful, but also dangerous when overused.

A consumer contract should be understandable by humans and reliably supported by tooling. Expressive power does not automatically mean better contract design.

### 7.5 Webhooks

OAS 3.1 added a top-level `webhooks` element for describing incoming webhooks managed out of band.

Simplified example:

```yaml
openapi: 3.1.0
info:
  title: Case Notification API
  version: '1.0.0'
paths: {}
webhooks:
  caseStatusChanged:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - caseId
                - status
              properties:
                caseId:
                  type: string
                status:
                  type: string
      responses:
        '204':
          description: Webhook received
```

This is useful when your API provider calls consumer endpoints.

### 7.6 `$schema`

OAS 3.1 allows the JSON Schema dialect to be declared.

Example:

```yaml
openapi: 3.1.0
info:
  title: Example API
  version: '1.0.0'
jsonSchemaDialect: https://spec.openapis.org/oas/3.1/dialect/base
paths: {}
```

This matters for validators and tooling.

### 7.7 When OAS 3.1.x Is a Good Choice

OAS 3.1.x is often the best practical choice when:

- you are starting a new API program,
- you care about schema correctness,
- your tooling supports 3.1 well enough,
- you want JSON Schema 2020-12 alignment,
- you need webhooks,
- your governance platform can validate 3.1 reliably,
- your generated clients handle 3.1 correctly.

### 7.8 When You Should Be Careful With OAS 3.1.x

Be careful if:

- your API gateway imports only 3.0,
- your documentation portal partially supports 3.1,
- your code generator mishandles `type: ['string', 'null']`,
- your existing style guide assumes `nullable: true`,
- your diff tool incorrectly classifies 3.1 schema changes,
- your teams do not understand JSON Schema composition.

---

## 8. OAS 3.2.x

### 8.1 What OAS 3.2 Represents

OAS 3.2 is the latest major step in the 3.x family. It introduces new functionality while maintaining compatibility with OAS 3.1 as a design goal.

Major themes include:

- newer HTTP method support,
- richer tag structure,
- streaming media type support,
- OAuth device flow support,
- additional refinements to improve expressiveness and clarity.

Because 3.2 is newer, the key architectural question is not only:

> “Is 3.2 better?”

It is:

> “Does our tooling chain understand 3.2 well enough for the workflows we rely on?”

### 8.2 Why 3.2 Is Attractive

OAS 3.2 is attractive for:

- greenfield API platforms,
- organizations that want current standard alignment,
- teams building future-facing API catalogs,
- streaming-response APIs,
- richer API organization through tag improvements,
- newer authentication documentation needs,
- teams already comfortable with 3.1.

### 8.3 Why 3.2 May Not Be the Immediate Enterprise Default

A spec can be official before the ecosystem is uniformly mature.

For many organizations, the bottleneck is not the spec. It is the toolchain:

```text
Authoring tool
  -> validator
  -> linter
  -> bundler
  -> diff checker
  -> mock server
  -> Java server generator
  -> TypeScript client generator
  -> documentation portal
  -> API gateway importer
  -> API catalog
  -> security scanner
```

If any one of these silently misinterprets 3.2, your pipeline may become unreliable.

### 8.4 Practical 3.2 Adoption Strategy

A safe approach:

```text
1. Use OAS 3.1.x as the compatibility baseline if your ecosystem is not fully 3.2-ready.
2. Evaluate 3.2 in a sandbox API.
3. Run all lifecycle tools against the same document.
4. Test generated Java and TypeScript clients.
5. Test documentation rendering.
6. Test diff/breaking-change detection.
7. Test gateway import if relevant.
8. Adopt 3.2 features only where they provide real value.
9. Update governance rules.
10. Then standardize.
```

### 8.5 A Reasonable Rule

For this series:

```text
Conceptual baseline: OAS 3.2.0
Practical enterprise fallback: OAS 3.1.x or 3.0.x depending on toolchain
Legacy awareness: OAS 2.0
```

That means we will teach modern semantics, but we will repeatedly call out where older tooling behaves differently.

---

## 9. Version Comparison Matrix

| Dimension | OAS 2.0 | OAS 3.0.x | OAS 3.1.x | OAS 3.2.x |
|---|---:|---:|---:|---:|
| Root field | `swagger` | `openapi` | `openapi` | `openapi` |
| Body modelling | Body parameter | `requestBody` | `requestBody` | `requestBody` |
| Server modelling | `host`, `basePath`, `schemes` | `servers` | `servers` | `servers` |
| Reusable schemas | `definitions` | `components.schemas` | `components.schemas` | `components.schemas` |
| Media-type-specific content | Limited | Strong | Strong | Strong |
| JSON Schema alignment | Old/limited | Partial/special dialect | JSON Schema 2020-12 aligned | 3.1-compatible foundation with new refinements |
| Nullable style | Vendor/limited patterns | `nullable: true` | `type: ['x', 'null']` | Same general 3.1-style model |
| Webhooks | No | No top-level `webhooks` | Yes | Yes |
| Tooling maturity | Legacy but stable | Very mature | Increasingly mature | Newer; verify carefully |
| Best for | Legacy APIs | Mature enterprise support | Modern schema correctness | Forward-looking platforms |

---

## 10. Version Choice Is an Architecture Decision

Choosing an OpenAPI version is not just a documentation decision.

It affects at least eight architectural surfaces.

### 10.1 Schema Semantics

Nullability, composition, constraints, and validation differ across versions.

A schema that looks similar can behave differently.

### 10.2 Java Type Mapping

The same contract can generate different Java types depending on version and generator.

Example concern:

```yaml
# OAS 3.0
nullable: true
```

vs:

```yaml
# OAS 3.1+
type:
  - string
  - 'null'
```

Potential generated Java outcomes:

```java
private String name;
```

or:

```java
private JsonNullable<String> name;
```

or:

```java
private Optional<String> name;
```

or custom nullable wrapper.

Each has different semantics.

### 10.3 TypeScript Mapping

OAS schema choices affect whether clients generate:

```ts
name?: string;
```

or:

```ts
name: string | null;
```

or:

```ts
name?: string | null;
```

Those three are not equivalent.

```text
name?: string         -> field may be absent; if present, string
name: string | null   -> field required; value may be string or null
name?: string | null  -> field may be absent; if present, string or null
```

Contract precision matters.

### 10.4 Validation Behavior

Validators may differ on:

- unknown fields,
- nullable fields,
- formats,
- `oneOf`,
- `anyOf`,
- discriminator,
- additional properties,
- examples.

A document being “valid OpenAPI” does not mean every runtime validator enforces it equally.

### 10.5 API Gateway Import

Some gateways import OAS 2.0 and 3.0 well, but lag on 3.1/3.2.

Gateway import may use the contract for:

- routing,
- auth policy,
- request validation,
- documentation,
- developer portal publishing,
- quota plans.

If the gateway truncates or ignores unsupported schema details, the runtime policy may diverge from the actual contract.

### 10.6 Documentation Rendering

Swagger UI, Redoc-like tools, API catalogs, and developer portals may render the same document differently.

Newer schema constructs can render poorly even when valid.

A contract must be machine-readable and human-readable.

### 10.7 Contract Diffing

Breaking change detection depends on semantic understanding.

If your diff tool does not understand 3.1/3.2 schema rules, it can produce:

- false positives,
- false negatives,
- missed breaking changes,
- noisy reviews.

False negatives are especially dangerous.

### 10.8 Governance Rules

Style guides and lint rules must match version semantics.

A rule written for OAS 3.0 may not make sense for 3.1.

Example:

```text
Old rule:
Use nullable: true for nullable fields.

New 3.1+ rule:
Use explicit null type in schema type union.
```

---

## 11. Practical Decision Framework

### 11.1 Greenfield Internal Java Microservice

Recommended default:

```text
OAS 3.1.x, unless the platform is already 3.2-ready.
```

Reasoning:

- modern schema semantics,
- strong enough tooling in many ecosystems,
- better future migration path,
- avoids starting new work on 3.0-specific schema quirks.

Use OAS 3.2 if:

- all relevant lifecycle tools support it,
- your organization intentionally standardizes on it,
- you need 3.2 features.

### 11.2 Greenfield Public API

Recommended:

```text
OAS 3.1.x or 3.2.x after full consumer-tooling validation.
```

For public APIs, generated client compatibility matters more than internal preference.

Before choosing 3.2, test:

- Java client generation,
- TypeScript client generation,
- Python client generation if relevant,
- documentation portal,
- examples,
- Postman/import tools,
- gateway/developer portal,
- SDK release pipeline.

### 11.3 Existing Spring Boot API With springdoc Generating 3.0

Recommended:

```text
Stay on 3.0 temporarily if the pipeline is stable, but plan a 3.1 migration.
```

Do not migrate just by changing the version field.

Migration requires checking:

- nullable fields,
- schema generation,
- examples,
- validation,
- codegen,
- diff tool,
- documentation rendering,
- consumer impact.

### 11.4 Legacy Swagger 2.0 API

Recommended:

```text
Migrate to at least OAS 3.0.x if the API is actively evolving.
```

If the API is frozen, you may leave it temporarily, but document the risk.

Migration is valuable when:

- request/response modelling is unclear,
- generated clients are fragile,
- API gateway policy needs richer metadata,
- docs are poor,
- consumer confusion is high,
- new endpoints are still being added.

### 11.5 Regulated or Auditable API

Recommended:

```text
OAS 3.1.x as a conservative modern baseline; OAS 3.2.x only after toolchain validation.
```

The priority is not newest version. The priority is:

- stable contract evidence,
- reproducible validation,
- precise schema semantics,
- reviewable changes,
- reliable diffing,
- durable audit trail.

### 11.6 API Platform / Organization-Wide Standard

Recommended:

```text
Define a staged standard:
- Accepted legacy: OAS 2.0
- Minimum for active APIs: OAS 3.0.x
- Preferred for new APIs: OAS 3.1.x
- Experimental/current: OAS 3.2.x until certified by platform tooling
```

Do not mandate one version blindly for every existing service.

Use lifecycle classification.

---

## 12. Migration: Swagger 2.0 to OpenAPI 3.x

### 12.1 Main Structural Changes

Swagger 2.0:

```yaml
swagger: '2.0'
host: api.example.com
basePath: /v1
schemes:
  - https
```

OpenAPI 3.x:

```yaml
openapi: 3.0.3
servers:
  - url: https://api.example.com/v1
```

Swagger 2.0:

```yaml
definitions:
  Customer:
    type: object
```

OpenAPI 3.x:

```yaml
components:
  schemas:
    Customer:
      type: object
```

Swagger 2.0 body parameter:

```yaml
parameters:
  - name: body
    in: body
    required: true
    schema:
      $ref: '#/definitions/CreateCustomerRequest'
```

OpenAPI 3.x request body:

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CreateCustomerRequest'
```

Swagger 2.0 response schema:

```yaml
responses:
  '200':
    description: OK
    schema:
      $ref: '#/definitions/Customer'
```

OpenAPI 3.x response content:

```yaml
responses:
  '200':
    description: OK
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Customer'
```

### 12.2 Migration Checklist

```text
1. Convert root version field.
2. Convert host/basePath/schemes to servers.
3. Move definitions to components.schemas.
4. Move reusable parameters/responses to components.
5. Convert body parameters to requestBody.
6. Convert consumes/produces to content media types.
7. Review file upload modelling.
8. Review auth schemes.
9. Review examples.
10. Validate generated clients.
11. Validate documentation rendering.
12. Run contract diff against old behavior.
13. Confirm gateway compatibility.
14. Communicate consumer impact.
```

### 12.3 Common Migration Mistake

Bad migration:

```text
Run automatic converter -> commit result -> declare done
```

Better migration:

```text
Run converter
-> inspect semantic changes
-> fix request/response media types
-> validate examples
-> regenerate clients
-> run compatibility tests
-> review with consumers
-> publish migration notes
```

Automatic conversion handles structure. It does not guarantee contract quality.

---

## 13. Migration: OAS 3.0 to 3.1

### 13.1 The Main Conceptual Shift

The biggest migration is schema semantics.

OAS 3.0:

```yaml
schema:
  type: object
  nullable: true
```

OAS 3.1:

```yaml
schema:
  type:
    - object
    - 'null'
```

### 13.2 `$ref` Sibling Behavior

In older OpenAPI usage, `$ref` often behaved as if sibling properties were ignored or discouraged depending on location and tooling.

OAS 3.1’s JSON Schema alignment makes schema composition and reference behaviour more aligned with JSON Schema expectations. But tooling may still vary.

Practical rule:

```text
Avoid clever $ref sibling usage unless your toolchain supports it consistently.
Prefer explicit composition when clarity matters.
```

### 13.3 Format Behavior

Do not assume `format` is always strict validation.

Example:

```yaml
createdAt:
  type: string
  format: date-time
```

This communicates expected representation, but actual enforcement depends on tooling.

For high-risk APIs, validate at runtime explicitly.

### 13.4 Migration Checklist

```text
1. Inventory all nullable fields.
2. Replace nullable modelling with JSON Schema null type where appropriate.
3. Review oneOf/anyOf/allOf usage.
4. Review additionalProperties semantics.
5. Review examples against 3.1 validators.
6. Check generated Java model output.
7. Check generated TypeScript model output.
8. Update lint rules.
9. Update style guide.
10. Update diff/breaking-change tooling.
11. Confirm API gateway support.
12. Confirm documentation renderer support.
13. Publish migration notes.
```

### 13.5 Migration Risk: Null vs Optional

This is one of the most common contract bugs.

```yaml
# Required but nullable
required:
  - middleName
properties:
  middleName:
    type:
      - string
      - 'null'
```

Meaning:

```json
{
  "middleName": null
}
```

is valid, but the field must exist.

```yaml
# Optional but not nullable
properties:
  middleName:
    type: string
```

Meaning:

```json
{}
```

is valid, but if `middleName` exists it must be a string.

```yaml
# Optional and nullable
properties:
  middleName:
    type:
      - string
      - 'null'
```

Meaning:

```json
{}
```

and:

```json
{
  "middleName": null
}
```

are both valid.

These three are different contracts.

---

## 14. Migration: OAS 3.1 to 3.2

### 14.1 General Strategy

OAS 3.2 is intended to be a compatible evolution from 3.1, but a serious engineering team still validates the entire lifecycle.

Migration is not simply:

```yaml
openapi: 3.1.0
```

changed to:

```yaml
openapi: 3.2.0
```

A safer process:

```text
1. Change a copy of the document, not the release artifact.
2. Validate with official-compatible validators.
3. Render docs in your chosen documentation portal.
4. Generate Java clients.
5. Generate TypeScript clients.
6. Generate or validate server stubs if used.
7. Run contract tests.
8. Run diff tools.
9. Import into gateway/catalog if used.
10. Evaluate new 3.2 features intentionally.
```

### 14.2 Use New Features Only When They Solve a Real Problem

Do not upgrade just to use every new feature.

Good reason:

```text
We need to describe streaming responses accurately, and 3.2 improves this.
```

Weak reason:

```text
It is newer, therefore better.
```

### 14.3 Governance Implication

If your organization adopts 3.2, update:

- style guide,
- linter rules,
- example patterns,
- training material,
- compatibility policy,
- code generation baselines,
- API review checklist.

Otherwise, teams will mix 3.1 and 3.2 styles inconsistently.

---

## 15. Version Compatibility and Tooling Reality

### 15.1 The Compatibility Stack

For an OpenAPI version to be safe in production, you need more than parser support.

```text
Can parse document?                 necessary but insufficient
Can validate document?              necessary but insufficient
Can render docs correctly?          necessary but insufficient
Can generate clients correctly?     necessary but insufficient
Can detect breaking changes?        necessary but insufficient
Can enforce governance rules?       necessary but insufficient
Can be understood by consumers?     necessary and often overlooked
```

### 15.2 Tool Support Levels

A tool may claim “supports OpenAPI 3.1” but mean one of several things:

```text
Level 1: Can load the document without crashing.
Level 2: Can validate basic structure.
Level 3: Can render documentation.
Level 4: Can understand schema semantics correctly.
Level 5: Can generate correct code.
Level 6: Can participate safely in CI/CD governance.
```

When evaluating tools, ask for level 4–6 behavior, not marketing claims.

### 15.3 Java Toolchain Evaluation

For a Java organization, test at least:

- Spring Boot runtime docs generation,
- OpenAPI Generator Java client,
- OpenAPI Generator Spring server if used,
- Jackson serialization mapping,
- Bean Validation mapping,
- nullable/optional handling,
- enum generation,
- date/time generation,
- polymorphism/discriminator mapping,
- Maven/Gradle reproducibility,
- CI validation.

---

## 16. Java-Specific Consequences of Version Choice

### 16.1 DTO Generation

Schema version affects generated DTOs.

Example contract intent:

```text
A field may be absent.
A field may be explicitly null.
A field may be present with value.
```

Java has no native single built-in type that cleanly represents all three states using a plain field.

Possible generated patterns:

```java
private String value;
```

This cannot distinguish absent from explicit null after deserialization unless additional tracking exists.

```java
private Optional<String> value;
```

This is controversial for DTO fields and often awkward with Jackson.

```java
private JsonNullable<String> value;
```

This can represent undefined vs null vs value, but introduces generator/library dependency.

The OpenAPI version and generator configuration influence which pattern appears.

### 16.2 Bean Validation Mapping

OpenAPI constraints can map to Bean Validation annotations:

```yaml
name:
  type: string
  minLength: 1
  maxLength: 100
```

Potential Java:

```java
@Size(min = 1, max = 100)
private String name;
```

But not every schema constraint maps perfectly to Bean Validation.

Advanced JSON Schema constraints may require custom validators.

### 16.3 Jackson Mapping

Schema composition can interact badly with Jackson polymorphism.

Example OpenAPI:

```yaml
oneOf:
  - $ref: '#/components/schemas/ManualReviewDecision'
  - $ref: '#/components/schemas/AutomatedDecision'
discriminator:
  propertyName: decisionType
```

Java/Jackson may need:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "decisionType")
@JsonSubTypes({
    @JsonSubTypes.Type(value = ManualReviewDecision.class, name = "MANUAL"),
    @JsonSubTypes.Type(value = AutomatedDecision.class, name = "AUTOMATED")
})
public sealed interface Decision permits ManualReviewDecision, AutomatedDecision {}
```

The contract and Java model must agree.

### 16.4 Spring Annotation Generation

Code-first tools may generate OpenAPI 3.0 or 3.1 depending on library/version/configuration.

Do not assume your runtime endpoint emits the version your organization standard requires.

Add CI checks:

```bash
# pseudo-check
assert openapi field matches allowed versions
assert no forbidden keywords
assert required governance metadata exists
assert examples validate
```

---

## 17. How to Read an Unknown OpenAPI File Quickly

When you receive an unknown spec, inspect in this order.

### Step 1: Identify Version

```yaml
swagger: '2.0'
```

or:

```yaml
openapi: 3.0.3
```

or:

```yaml
openapi: 3.1.0
```

or:

```yaml
openapi: 3.2.0
```

### Step 2: Identify Generation Source

Look for clues:

```yaml
x-generated-by: springdoc-openapi
```

or descriptions that look like class names:

```yaml
operationId: getUsingGET
```

or schemas like:

```yaml
CustomerDto:
```

Generated specs are not bad, but they require closer review for contract quality.

### Step 3: Inspect Schema Modelling

Look for:

- `nullable`,
- `oneOf`,
- `allOf`,
- `anyOf`,
- `discriminator`,
- `additionalProperties`,
- unconstrained objects,
- generic `ApiResponse` wrappers,
- entity-like schema names.

### Step 4: Inspect Error Responses

A mature spec documents non-200 responses.

Weak sign:

```yaml
responses:
  '200':
    description: OK
```

Better sign:

```yaml
responses:
  '200':
    description: Success
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
  '422':
    $ref: '#/components/responses/ValidationError'
```

### Step 5: Inspect Operation IDs

Bad sign:

```yaml
operationId: getCaseUsingGET
```

Better:

```yaml
operationId: getCaseById
```

Best for large portfolios:

```yaml
operationId: Case_getById
```

or a consistent naming standard.

### Step 6: Inspect Examples

No examples means weak consumer onboarding.

Invalid examples mean contract quality is low.

### Step 7: Inspect Security

A contract should say how authentication works.

Weak:

```yaml
description: Requires login
```

Better:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
security:
  - bearerAuth: []
```

### Step 8: Inspect Governance Metadata

For an organization-level API, useful extensions may include:

```yaml
x-api-owner: enforcement-platform-team
x-api-lifecycle: active
x-data-classification: confidential
x-review-status: approved
```

Extensions are not standard semantics, but they can be valuable for governance.

---

## 18. OpenAPI Version Smells

### Smell 1: “We Use Swagger”

This is ambiguous.

Ask:

```text
Which spec version?
Which tool?
Which generated artifact?
Which source of truth?
```

### Smell 2: `openapi: 3.1.0` But Uses 3.0 Nullable Style Everywhere

Example:

```yaml
openapi: 3.1.0
schema:
  type: string
  nullable: true
```

This suggests superficial migration or confused tooling.

### Smell 3: OAS 3.0 Contract With JSON Schema 2020-12 Keywords

Example:

```yaml
openapi: 3.0.3
schema:
  if:
    properties:
      type:
        const: BUSINESS
```

A 3.0 tool may not understand this.

### Smell 4: Generated `operationId`s

Example:

```yaml
operationId: createCaseUsingPOST
```

This leaks implementation framework style and can produce ugly generated clients.

### Smell 5: Version Field Confusion

Bad:

```yaml
openapi: 1.2.3
```

because someone thought it was API version.

Correct:

```yaml
openapi: 3.1.0
info:
  version: 1.2.3
```

### Smell 6: Tooling Claims Without Lifecycle Testing

Statement:

```text
Our tool supports OpenAPI 3.1.
```

Question:

```text
Does it validate, render, generate, diff, mock, and gateway-import correctly for our actual specs?
```

---

## 19. Version Strategy for This Series

This series will use the following approach.

### 19.1 Conceptual Target

```text
OpenAPI 3.2.0 as the latest specification baseline.
```

This keeps the mental model current.

### 19.2 Practical Examples

Most examples will be written to be understandable for:

```text
OAS 3.1-style modern schema thinking
```

When something is version-sensitive, it will be called out.

### 19.3 Enterprise Compatibility Notes

Where appropriate, we will include notes like:

```text
In OAS 3.0, use nullable: true.
In OAS 3.1+, model null with type union including 'null'.
```

or:

```text
Some gateway/documentation tools may not fully support this construct.
Validate your toolchain before standardizing it.
```

### 19.4 Java Bias

The series will repeatedly map OpenAPI choices to Java concerns:

- Spring controllers,
- request DTOs,
- response DTOs,
- Jackson serialization,
- Bean Validation,
- generated clients,
- records,
- sealed interfaces,
- enums,
- nullability,
- API boundary mapping,
- CI/CD.

---

## 20. Recommended Organizational Policy

A mature organization should not simply say:

```text
All APIs must use OpenAPI 3.2 immediately.
```

A better policy is tiered.

```yaml
openapiPolicy:
  acceptedLegacy:
    - 2.0
  minimumForActiveDevelopment:
    - 3.0.3
    - 3.0.4
  preferredForNewApis:
    - 3.1.0
    - 3.1.1
  currentEvaluationTrack:
    - 3.2.0
  migrationRequiredWhen:
    - public API receives major new endpoints
    - generated clients are being redesigned
    - gateway contract import is being replaced
    - schema correctness issues block consumers
    - regulatory audit requires stronger contract evidence
```

Then define certification criteria.

```text
An OpenAPI version is approved for production use only when:
1. validator supports it,
2. linter supports it,
3. bundler supports it,
4. diff tool supports it,
5. documentation renderer supports it,
6. mock tool supports it,
7. Java client generation supports it,
8. server generation supports it if used,
9. gateway/catalog supports it if used,
10. style guide and examples are updated.
```

---

## 21. Practical Lab: Classify Specs

### 21.1 Spec A

```yaml
swagger: '2.0'
info:
  title: Payment API
  version: '1.0.0'
host: payments.example.com
basePath: /api
schemes:
  - https
definitions:
  Payment:
    type: object
```

Classification:

```text
Swagger / OAS 2.0
```

Likely concerns:

- legacy structure,
- body parameters likely used,
- migration needed for richer modelling.

### 21.2 Spec B

```yaml
openapi: 3.0.3
info:
  title: Case API
  version: '2.4.0'
paths: {}
components:
  schemas:
    Case:
      type: object
      properties:
        closedAt:
          type: string
          format: date-time
          nullable: true
```

Classification:

```text
OAS 3.0.x
```

Nullability style is normal for 3.0.

### 21.3 Spec C

```yaml
openapi: 3.1.0
info:
  title: Case API
  version: '2.5.0'
paths: {}
components:
  schemas:
    Case:
      type: object
      properties:
        closedAt:
          type:
            - string
            - 'null'
          format: date-time
```

Classification:

```text
OAS 3.1.x
```

Nullability style is JSON Schema-aligned.

### 21.4 Spec D

```yaml
openapi: 3.1.0
info:
  title: Case API
  version: '2.5.0'
paths: {}
components:
  schemas:
    Case:
      type: object
      properties:
        closedAt:
          type: string
          format: date-time
          nullable: true
```

Classification:

```text
Nominally OAS 3.1, but modelling style suggests 3.0 carryover.
```

Action:

```text
Review migration quality and toolchain behavior.
```

---

## 22. Practical Lab: Choose a Version

### Scenario 1: New Internal Spring Boot Service

Context:

- internal consumers,
- Spring Boot,
- generated TypeScript client,
- no gateway import,
- modern CI/CD available.

Recommended:

```text
OAS 3.1.x
```

Reason:

- good modern baseline,
- avoids 3.0 schema limitations,
- less risky than immediate 3.2 if toolchain is not certified.

### Scenario 2: Public Partner API Through Legacy Gateway

Context:

- external partners,
- gateway imports OAS 3.0 only,
- generated Java and C# clients,
- strict SLAs.

Recommended:

```text
OAS 3.0.x for published contract, with internal plan to evaluate 3.1.
```

Reason:

- gateway and partner tooling compatibility matter more than newest version,
- public API breakage is expensive.

### Scenario 3: API Platform Greenfield in 2026

Context:

- central platform team,
- modern API catalog,
- custom linting,
- generator validation pipeline,
- new standards being created.

Recommended:

```text
Evaluate OAS 3.2.x as current target, certify toolchain, provide 3.1 fallback.
```

Reason:

- platform can invest in certification,
- current standard is valuable,
- fallback protects delivery.

### Scenario 4: Regulated Enforcement Case API

Context:

- audit trail,
- high-risk data,
- external review,
- long lifecycle,
- consumer stability important.

Recommended:

```text
OAS 3.1.x unless 3.2 is fully certified in the organization.
```

Reason:

- modern schema correctness,
- mature enough for careful governance,
- avoid unvalidated novelty in high-risk contract lifecycle.

---

## 23. What a Top 1% Engineer Does Differently

A normal engineer asks:

```text
Can Swagger UI display it?
```

A stronger engineer asks:

```text
Can our entire API lifecycle rely on this contract?
```

A top 1% engineer asks:

```text
What semantic promises does this version let us express,
which promises can our tools enforce,
and which promises must remain human-governed?
```

That last question is the important one.

OpenAPI is powerful, but it is not omnipotent.

It can describe:

- shape,
- media types,
- parameters,
- status codes,
- auth schemes,
- examples,
- links,
- callbacks,
- schemas.

It cannot fully guarantee:

- business rule correctness,
- authorization correctness,
- performance,
- idempotency correctness,
- state machine correctness,
- semantic compatibility,
- consumer migration readiness,
- implementation honesty.

Those require design discipline, tests, reviews, observability, and governance.

---

## 24. Key Takeaways

1. **Swagger and OpenAPI are not identical terms anymore.** Be precise.
2. **Swagger UI is a renderer, not the contract itself.**
3. **OAS 2.0 is legacy but still common.** Know how to recognize and migrate it.
4. **OAS 3.0.x is mature and widely supported.** It is still a practical enterprise baseline.
5. **OAS 3.1.x matters because of JSON Schema 2020-12 alignment.** This changes schema modelling deeply.
6. **OAS 3.2.x is current and forward-looking.** Adopt it intentionally after toolchain validation.
7. **Version choice affects Java generated types, validation, docs, gateway import, and diffing.**
8. **Do not migrate by changing only the root version field.** Migration is semantic.
9. **Tool support must be tested across the whole lifecycle.** Parser support is not enough.
10. **A mature organization uses a tiered version policy, not a one-size-fits-all mandate.**

---

## 25. References

- OpenAPI Specification v3.2.0: https://spec.openapis.org/oas/v3.2.0.html
- OpenAPI Initiative announcement for OpenAPI v3.2: https://www.openapis.org/blog/2025/09/23/announcing-openapi-v3-2
- OpenAPI Initiative guide, upgrading from 3.1 to 3.2: https://learn.openapis.org/upgrading/v3.1-to-v3.2.html
- OpenAPI Initiative guide, upgrading from 3.0 to 3.1: https://learn.openapis.org/upgrading/v3.0-to-v3.1.html
- OpenAPI Specification 3.1.0 release announcement: https://www.openapis.org/blog/2021/02/18/openapi-specification-3-1-released
- OpenAPI Initiative About page: https://www.openapis.org/about
- Swagger/OpenAPI 2.0 Specification: https://swagger.io/specification/v2/

---

## 26. Series Progress

```text
Current part: 002 / 030
Status: In progress
Series complete: No
Remaining parts: 28
Next: Part 003 — Anatomy of an OpenAPI Document
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-001.md">⬅️ OpenAPI Mastery for Java Engineers — Part 001</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-003.md">Part 003 — Anatomy of an OpenAPI Document ➡️</a>
</div>
