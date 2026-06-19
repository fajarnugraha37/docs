# OpenAPI Mastery for Java Engineers — Part 025
# OpenAPI and API Gateways: Policies, Routing Metadata, and Runtime Reality

> Seri: `learn-openapi-mastery-for-java-engineers`  
> Part: `025 / 030`  
> File: `learn-openapi-mastery-for-java-engineers-part-025.md`  
> Target pembaca: Java software engineer / tech lead yang ingin memakai OpenAPI sebagai contract artifact dalam sistem API production-grade.  
> Fokus: hubungan antara OpenAPI contract dan API gateway/runtime policy tanpa mencampuradukkan keduanya.

---

## 0. Executive Summary

API gateway sering menjadi titik tempat OpenAPI terasa “operational”: spec di-import ke gateway, route dibuat, auth policy ditempel, request divalidasi, rate limit diaktifkan, documentation portal dipublish, dan traffic diarahkan ke backend.

Tetapi kesalahan besar banyak tim adalah menganggap:

> “Kalau gateway sudah punya OpenAPI, berarti contract API sudah benar.”

Itu tidak cukup.

OpenAPI mendeskripsikan **interface contract**. Gateway menjalankan **runtime mediation**. Keduanya berhubungan erat, tetapi bukan hal yang sama.

OpenAPI menjawab:

- endpoint apa yang tersedia,
- request apa yang diterima,
- response apa yang dijanjikan,
- security scheme apa yang diharapkan,
- error shape apa yang bisa diandalkan,
- bagaimana consumer seharusnya berinteraksi.

Gateway menjawab:

- route publik dipetakan ke upstream mana,
- policy apa yang dijalankan sebelum/atau sesudah backend,
- auth/token/rate limit/quota apa yang diterapkan,
- header apa yang ditambahkan/dihapus,
- request/response apa yang divalidasi atau ditransformasi,
- traffic mana yang diblokir, diteruskan, di-cache, di-throttle, atau di-log.

Hubungannya:

```text
Consumer
   |
   | public API contract
   v
API Gateway
   |
   | runtime policy + routing + mediation
   v
Backend Service
   |
   | implementation behavior
   v
Domain / Data / Workflow
```

OpenAPI yang matang harus cukup jelas untuk consumer, cukup ketat untuk automation, dan cukup eksplisit untuk mengurangi drift antara gateway, backend, generated client, test suite, dan documentation.

---

## 1. The Core Distinction: Contract vs Runtime Mediation

### 1.1 OpenAPI is not gateway configuration

OpenAPI bukan file konfigurasi gateway universal.

OpenAPI bisa dipakai oleh gateway, tetapi spec-nya sendiri bukan pengganti:

- route table,
- upstream service discovery,
- TLS settings,
- WAF rules,
- OAuth introspection configuration,
- JWT issuer configuration,
- rate limiting implementation,
- quota storage,
- circuit breaker,
- retry policy,
- load balancing,
- observability pipeline,
- deployment config.

OpenAPI adalah **description of an HTTP API interface**. Gateway config adalah **runtime enforcement and mediation plan**.

Official OpenAPI positioning sendiri menekankan bahwa OpenAPI menyediakan standar formal untuk mendeskripsikan HTTP API agar orang dan tool bisa memahami cara kerja API, generate code, create tests, dan apply design standards. Itu bukan sama dengan menyatakan seluruh runtime behavior gateway otomatis tercakup oleh spec.

### 1.2 Gateway is not the API either

Gateway juga bukan API secara keseluruhan.

Gateway adalah perimeter/control plane/data plane component. Ia bisa:

- menerima request,
- mengecek policy,
- memodifikasi request,
- meneruskan ke upstream,
- memodifikasi response,
- menghasilkan error sebelum backend dipanggil.

Tetapi “API” yang dialami consumer adalah gabungan dari:

```text
Published contract
+ Gateway behavior
+ Backend behavior
+ Data/state behavior
+ Operational failure behavior
+ Documentation expectation
```

Kalau salah satu berubah tanpa sinkronisasi, consumer merasakan API berubah.

### 1.3 Contract truth vs deployment truth

Dalam organisasi matang, setidaknya ada dua kebenaran yang harus dijaga:

| Truth Type | Artifact | Risiko jika drift |
|---|---|---|
| Contract truth | OpenAPI spec | Consumer salah membangun integration |
| Runtime truth | Gateway + backend config | Request valid diblokir, request invalid lolos, response berbeda |
| Implementation truth | Controller/service code | Spec menjanjikan sesuatu yang tidak terjadi |
| Governance truth | style guide, policy, review history | Perubahan tidak konsisten dan tidak defensible |
| Release truth | versioned artifact, changelog | Consumer tidak tahu perubahan apa yang terjadi |

Top 1% engineer tidak bertanya “mana yang benar?” secara abstrak. Ia membangun pipeline agar artifact-artifact ini saling memverifikasi.

---

## 2. Gateway Capabilities That Commonly Intersect With OpenAPI

Tidak semua gateway sama, tetapi capability berikut sering muncul.

### 2.1 Route import

Banyak gateway bisa membuat route dari OpenAPI:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
```

Gateway bisa mengubah ini menjadi:

```text
GET /cases/{caseId} -> case-service /internal/cases/{caseId}
```

Tetapi mapping upstream sering butuh metadata tambahan yang bukan bagian dari portable OpenAPI standard.

Contoh:

- AWS API Gateway memakai OpenAPI extensions untuk AWS-specific authorization dan API Gateway-specific integrations.
- Apigee dapat membuat API proxy dari OpenAPI spec template.
- Kong menyediakan plugin validasi request/response terhadap OpenAPI spec pada versi/spec tertentu.

Artinya, OpenAPI bisa menjadi input runtime platform, tetapi vendor biasanya butuh extension atau konfigurasi tambahan.

### 2.2 Request validation

Gateway request validation dapat mengecek:

- path parameter,
- query parameter,
- header,
- request body schema,
- required fields,
- type,
- enum,
- constraints tertentu.

Contoh mental model:

```text
Client request
   |
   v
Gateway validates against OpenAPI
   |
   | valid -> backend
   | invalid -> 400 from gateway
```

Keuntungan:

- backend tidak menerima request rusak,
- error lebih cepat,
- traffic invalid tidak membebani service,
- contract enforcement lebih konsisten.

Risiko:

- gateway validator tidak mendukung seluruh JSON Schema/OAS dialect,
- gateway menghasilkan error shape berbeda dari backend,
- request yang sebenarnya backend toleransi bisa diblokir gateway,
- spec terlalu ketat sehingga deployment memutus consumer.

### 2.3 Response validation

Response validation lebih jarang diaktifkan di gateway production karena:

- overhead,
- risiko latency,
- risiko blocking response sah akibat bug spec,
- response besar,
- streaming/binary payload.

Tetapi response validation sangat berguna di:

- staging,
- canary,
- shadow mode,
- CI integration test,
- regulated APIs,
- partner certification.

Prinsipnya:

```text
Do not blindly enforce response validation in production before you have confidence in spec quality.
```

### 2.4 Authentication and authorization enforcement

OpenAPI bisa mendeskripsikan security scheme:

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

Gateway bisa menjalankan:

- JWT validation,
- OAuth2 token introspection,
- API key check,
- mTLS verification,
- session/cookie validation,
- scope check,
- consumer app plan check.

Tetapi OpenAPI tidak cukup untuk membuktikan business authorization benar.

OpenAPI bisa mengatakan:

```yaml
/cases/{caseId}/decision:
  post:
    security:
      - oauth2:
          - cases:decide
```

Tetapi ia tidak otomatis membuktikan:

- user boleh memutus kasus tersebut,
- case berada di jurisdiction user,
- user bukan conflicted reviewer,
- case state mengizinkan decision,
- delegated authority masih aktif,
- segregation-of-duties rules terpenuhi.

Ini harus ditegakkan oleh backend/domain authorization logic atau policy engine.

### 2.5 Rate limit, quota, and plan enforcement

Gateway sering menangani:

- rate limit per token/client/IP,
- quota per subscription plan,
- burst control,
- concurrent request limit,
- monetization/product plan,
- retry-after response.

OpenAPI standard tidak memiliki model lengkap universal untuk rate-limit policy.

Yang bisa dilakukan dalam OpenAPI:

- dokumentasikan possible `429` response,
- dokumentasikan `Retry-After`, `RateLimit-*`, atau vendor-specific headers,
- gunakan extension internal untuk plan/quota metadata,
- sinkronkan dengan gateway config lewat linting/pipeline.

Contoh:

```yaml
responses:
  '429':
    description: Too many requests.
    headers:
      Retry-After:
        description: Seconds to wait before retrying.
        schema:
          type: integer
          minimum: 1
```

### 2.6 Transformation

Gateway bisa melakukan transformasi:

- rename header,
- add/remove header,
- rewrite path,
- change query parameter,
- map public payload ke upstream payload,
- wrap/unwrap response envelope,
- convert XML/JSON,
- redact fields,
- normalize error.

Ini area berbahaya.

Kalau transformasi mengubah surface yang consumer lihat, OpenAPI harus mendeskripsikan **public API**, bukan upstream internal API.

Jika backend mengembalikan:

```json
{
  "case_id": "C-1001",
  "internal_status": "PENDING_SUPERVISOR_REVIEW"
}
```

Gateway mungkin mengubah menjadi:

```json
{
  "caseId": "C-1001",
  "status": "UNDER_REVIEW"
}
```

OpenAPI publik harus mendeskripsikan response kedua, bukan response upstream.

Rule:

```text
The OpenAPI contract must match what the consumer observes at the contract boundary.
```

Kalau boundary-nya public gateway, dokumentasikan public gateway behavior. Kalau boundary-nya internal service, dokumentasikan internal service behavior. Jangan mencampur dua boundary dalam satu spec tanpa naming/layering jelas.

---

## 3. API Gateway as Boundary Layer

### 3.1 Public route vs backend route

Dalam sistem production, path publik sering tidak sama dengan path backend.

Public:

```text
GET /v1/cases/{caseId}
```

Backend:

```text
GET /internal/case-management/cases/{id}
```

Public contract harus stabil. Backend route boleh berubah.

```text
Consumer -> /v1/cases/C-1001
Gateway  -> /internal/case-management/cases/C-1001
Service  -> handler/controller
```

OpenAPI untuk consumer sebaiknya menggunakan public route.

OpenAPI untuk internal service dapat menggunakan backend route jika dipakai untuk service-to-service contract.

Jangan gunakan satu spec untuk dua realitas ini tanpa eksplisit.

### 3.2 External API vs internal upstream API

Ada dua pendekatan.

#### Approach A — One public OpenAPI only

Cocok ketika:

- backend route tidak relevan untuk consumer,
- gateway transformation minimal,
- API owner hanya publish external contract,
- backend service punya test internal sendiri.

#### Approach B — Two specs

```text
public-api.openapi.yaml
upstream-service.openapi.yaml
```

Cocok ketika:

- gateway banyak transformasi,
- backend dipakai langsung oleh internal consumers,
- public API adalah product facade,
- upstream API punya lifecycle berbeda,
- regulated systems butuh traceability boundary.

#### Approach C — One spec with vendor/internal extensions

Cocok ketika:

- gateway import butuh integration metadata,
- organization punya standard extensions,
- pipeline dapat strip extension untuk public publication.

Contoh:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      x-gateway-upstream:
        service: case-service
        path: /internal/cases/{caseId}
        timeoutMs: 3000
```

Kelemahan:

- spec bisa menjadi terlalu platform-specific,
- public artifact perlu sanitization,
- vendor lock-in meningkat.

---

## 4. OpenAPI Extensions for Gateway Metadata

### 4.1 What are extensions?

OpenAPI mengizinkan specification extensions dengan prefix `x-`.

Contoh:

```yaml
x-owner: case-platform-team
x-risk-level: high
x-data-classification: restricted
```

Vendor gateway juga memakai extension. AWS API Gateway, misalnya, memiliki OpenAPI extensions untuk authorization dan integration configuration.

### 4.2 Good uses of extensions

Extension berguna untuk metadata yang tidak portable, misalnya:

```yaml
x-gateway:
  upstreamService: case-service
  timeoutMs: 3000
  retryPolicy: none
  rateLimitPlan: partner-standard
  requireClientCertificate: true
```

Atau governance:

```yaml
x-api-owner: enforcement-platform
x-lifecycle: stable
x-audit-critical: true
x-pii: true
```

Atau routing:

```yaml
x-internal-route:
  cluster: case-service
  path: /internal/v3/cases/{caseId}
```

### 4.3 Bad uses of extensions

Extension buruk jika:

- menggantikan standard OpenAPI field yang sudah ada,
- menyembunyikan behavior penting dari consumer,
- menjadi dumping ground policy,
- tidak divalidasi linting,
- tidak terdokumentasi,
- berbeda antar service tanpa governance.

Bad:

```yaml
x-returns: Case details if allowed, otherwise maybe error
```

Bad:

```yaml
x-auth: true
```

Bad:

```yaml
x-errors: standard
```

Lebih baik gunakan standard field untuk behavior contract, lalu extension hanya untuk runtime/platform metadata.

---

## 5. Request Validation at Gateway

### 5.1 Validation layers

Validasi request punya beberapa layer.

```text
Layer 1: Transport / protocol
- TLS
- method
- path
- headers
- content length

Layer 2: Gateway structural validation
- required params
- body schema
- media type
- auth token presence

Layer 3: Application boundary validation
- DTO validation
- cross-field rules
- command validity

Layer 4: Domain validation
- state transition
- actor permission
- business invariant
```

Gateway cocok untuk layer 1 dan sebagian layer 2.

Backend harus tetap menangani layer 2, 3, dan 4 sesuai risiko.

Jangan berpikir:

```text
Gateway validates schema, so backend can trust everything.
```

Lebih aman:

```text
Gateway rejects obvious invalid traffic.
Backend remains authoritative for application and domain correctness.
```

### 5.2 What gateway validation can catch well

Gateway validation biasanya efektif untuk:

- missing required body,
- invalid content type,
- wrong primitive type,
- missing required query/path/header,
- enum mismatch,
- max/min length,
- basic object structure,
- obvious malformed JSON.

### 5.3 What gateway validation cannot reliably catch

Gateway biasanya tidak cukup untuk:

- cross-field condition,
- database-backed uniqueness,
- state machine rule,
- entitlement rule,
- “user can only access cases assigned to region X”,
- temporal business rule,
- duplicate command detection,
- semantic validation of identifiers,
- all JSON Schema dialect details depending on gateway support.

### 5.4 Validation mismatch failure

Misalnya OpenAPI bilang:

```yaml
priority:
  type: string
  enum: [LOW, MEDIUM, HIGH]
```

Backend sudah menerima nilai baru:

```text
CRITICAL
```

Jika gateway masih pakai spec lama, request valid menurut backend ditolak gateway.

Atau sebaliknya:

OpenAPI longgar:

```yaml
comment:
  type: string
```

Backend membatasi 500 karakter.

Gateway meloloskan request 10.000 karakter, backend menolak.

Kesimpulan:

```text
Gateway validation quality depends on contract accuracy and deployment synchronization.
```

---

## 6. Gateway-Generated Errors Must Be Part of the Contract

### 6.1 Gateway can generate responses before backend

Consumer tidak peduli apakah error berasal dari gateway atau backend. Mereka hanya melihat HTTP response.

Gateway dapat menghasilkan:

- `400` validation error,
- `401` missing/invalid authentication,
- `403` blocked by policy,
- `404` route not found,
- `413` payload too large,
- `415` unsupported media type,
- `429` rate limit exceeded,
- `502` bad gateway,
- `503` upstream unavailable,
- `504` gateway timeout.

Jika public contract tidak mendokumentasikan ini, consumer akan gagal menangani error real.

### 6.2 Standardizing gateway and backend errors

Idealnya gateway dan backend menghasilkan shape error yang sama.

Contoh `application/problem+json`:

```json
{
  "type": "https://api.example.gov/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "The client exceeded the allowed request rate.",
  "instance": "/v1/cases/C-1001",
  "correlationId": "01JZ..."
}
```

OpenAPI:

```yaml
components:
  schemas:
    Problem:
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
        correlationId:
          type: string
```

### 6.3 The gateway error normalization problem

Some gateways return proprietary error shapes by default:

```json
{
  "message": "Unauthorized"
}
```

While backend returns:

```json
{
  "type": "...",
  "title": "Unauthorized",
  "status": 401
}
```

This inconsistency leaks runtime origin to consumers.

Mature API platform standardizes:

- gateway error templates,
- backend error library,
- OpenAPI shared error schema,
- CI contract examples,
- observability correlation.

---

## 7. Auth Policy: What OpenAPI Can and Cannot Express

### 7.1 Security schemes are contract declarations

OpenAPI can express:

```yaml
components:
  securitySchemes:
    oauth2:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.gov/oauth2/token
          scopes:
            cases:read: Read case data
            cases:write: Modify case data
```

And operation requirements:

```yaml
security:
  - oauth2: [cases:read]
```

This tells consumer:

- what auth mechanism is needed,
- which scope is needed,
- whether auth is global or per operation.

### 7.2 Gateway can enforce token-level rules

Gateway can enforce:

- token present,
- signature valid,
- issuer valid,
- audience valid,
- expiry valid,
- required scope exists,
- client certificate valid,
- API key valid.

### 7.3 Backend still owns domain authorization

Backend should enforce:

- user owns resource,
- role matches action,
- case state allows action,
- assignment exists,
- delegation applies,
- conflict-of-interest rule,
- jurisdiction boundary,
- time-window rule,
- supervisory approval state.

OpenAPI can document expectation, but not fully encode domain authorization logic.

### 7.4 Operation-level security override

Public endpoint:

```yaml
/cases/public-search:
  get:
    security: []
```

Protected endpoint:

```yaml
/cases/{caseId}:
  get:
    security:
      - oauth2: [cases:read]
```

High-risk endpoint:

```yaml
/cases/{caseId}/decision:
  post:
    security:
      - oauth2: [cases:decide]
```

High-risk operations should also have explicit error responses:

```yaml
responses:
  '401':
    $ref: '#/components/responses/Unauthorized'
  '403':
    $ref: '#/components/responses/Forbidden'
  '409':
    $ref: '#/components/responses/InvalidCaseState'
```

---

## 8. Rate Limits, Quotas, and Product Plans

### 8.1 Rate limit is part of consumer experience

Even if rate limiting is enforced by gateway, consumers must know:

- that rate limit exists,
- what response they receive,
- whether `Retry-After` is present,
- whether quota headers are present,
- what retry strategy is safe,
- whether failed requests count against quota.

OpenAPI should include at least `429`.

```yaml
'429':
  description: Request rate limit exceeded.
  headers:
    Retry-After:
      description: Number of seconds before retrying.
      schema:
        type: integer
        minimum: 1
  content:
    application/problem+json:
      schema:
        $ref: '#/components/schemas/Problem'
```

### 8.2 Vendor-neutral vs vendor-specific headers

There are several rate-limit header conventions. Your organization should choose one standard and document it.

Example:

```yaml
headers:
  RateLimit-Limit:
    description: Maximum requests allowed in the current window.
    schema:
      type: integer
  RateLimit-Remaining:
    description: Remaining requests in the current window.
    schema:
      type: integer
  RateLimit-Reset:
    description: Time until the rate limit window resets.
    schema:
      type: integer
```

### 8.3 Product plans via extension

OpenAPI standard does not fully model product subscription plans. Use extensions carefully:

```yaml
x-api-plan:
  default:
    rateLimit: 1000/hour
    burst: 100/minute
  premium:
    rateLimit: 10000/hour
    burst: 1000/minute
```

But ensure the true gateway policy is generated from or checked against this metadata. Otherwise it becomes another stale document.

---

## 9. Transformations: The Most Dangerous Gateway Feature for Contract Integrity

### 9.1 Transformations create hidden APIs

When gateway transforms payloads, there are at least two APIs:

```text
Public API seen by consumer
Gateway-to-backend API seen by upstream service
```

If these are not documented separately, engineers start debugging ghost behavior.

### 9.2 Safe transformation categories

Relatively safe:

- add correlation ID header,
- normalize tracing headers,
- remove internal hop-by-hop headers,
- rewrite path internally,
- inject verified identity metadata header to backend,
- map public host/path to upstream route.

Still needs documentation for platform teams.

### 9.3 Risky transformation categories

Risky:

- change payload shape,
- rename fields,
- hide required backend fields,
- synthesize default values,
- convert error bodies,
- merge multiple upstream responses,
- remove response fields,
- convert status codes,
- transform auth semantics.

These affect contract and must be reviewed like API implementation.

### 9.4 Status code transformation trap

Backend returns:

```text
409 Conflict
```

Gateway maps to:

```text
400 Bad Request
```

Consumer loses ability to distinguish:

- malformed request,
- invalid state transition,
- duplicate command,
- optimistic lock conflict.

This is not cosmetic. It breaks error-handling semantics.

### 9.5 Error body transformation trap

Backend returns structured validation error:

```json
{
  "type": "https://api.example.gov/problems/validation-error",
  "status": 422,
  "violations": [
    {
      "field": "decision.effectiveDate",
      "code": "MUST_BE_FUTURE_DATE"
    }
  ]
}
```

Gateway transforms to:

```json
{
  "message": "Invalid request"
}
```

The consumer loses actionable details.

Rule:

```text
Gateway transformations must not degrade contract semantics unless explicitly designed and documented.
```

---

## 10. Gateway Validation vs Backend Validation: A Practical Policy

A practical policy for teams:

| Validation type | Gateway | Backend | Notes |
|---|---:|---:|---|
| TLS / protocol enforcement | Yes | Partial | Usually perimeter concern |
| Auth token signature | Yes | Maybe | Backend may verify identity context too |
| Required auth scope | Yes | Yes for high-risk | Gateway scope check is not enough for domain auth |
| Required field | Yes | Yes | Defense in depth |
| Basic schema type | Yes | Yes | Gateway can reject obvious bad traffic |
| Cross-field rule | No/limited | Yes | Application boundary |
| State transition | No | Yes | Domain logic |
| Resource ownership | No | Yes | Authorization/domain |
| Idempotency key replay | Maybe | Yes | Requires storage/command semantics |
| Rate limit | Yes | Maybe | Usually gateway/platform |
| Payload size | Yes | Yes | Gateway protects service; backend protects itself |
| Business uniqueness | No | Yes | Domain/data layer |

A mature posture:

```text
Gateway validation is a guardrail.
Backend validation is authority.
OpenAPI is the shared contract that both should align to.
```

---

## 11. Public/Private Endpoint Exposure

### 11.1 OpenAPI as exposure map

OpenAPI can act as a list of public capabilities. For gateway review, it helps answer:

- which paths are exposed,
- which operations are deprecated,
- which operations are internal-only,
- which operations require strong auth,
- which operations return sensitive data,
- which operations are audit critical.

### 11.2 Internal-only metadata

Use extension:

```yaml
x-visibility: public
```

or:

```yaml
x-visibility: internal
```

But do not publish internal operations in public docs unless they are filtered out.

### 11.3 Spec splitting by audience

Better for high-risk systems:

```text
openapi/
  public/enforcement-api.yaml
  partner/enforcement-partner-api.yaml
  internal/enforcement-admin-api.yaml
```

Or use build-time filtering:

```text
source spec -> filtered public spec -> public portal
            -> full internal spec -> internal catalog
```

### 11.4 Dangerous exposure failure

A backend has internal endpoint:

```text
POST /internal/cases/{caseId}/force-close
```

Gateway accidentally exposes it.

If your OpenAPI pipeline and gateway config are separate, this can happen silently.

Mitigation:

- gateway config generated from approved OpenAPI,
- route exposure diff in CI,
- lint rule requiring `x-visibility`,
- security review for sensitive operations,
- external scan comparing runtime routes vs published contract.

---

## 12. Servers Object and Gateway Environments

### 12.1 `servers` communicates base URLs

Example:

```yaml
servers:
  - url: https://api.example.gov/v1
    description: Production
  - url: https://sandbox-api.example.gov/v1
    description: Sandbox
```

`servers` is consumer-facing. Do not put internal upstream hosts in public spec:

Bad public spec:

```yaml
servers:
  - url: http://case-service.default.svc.cluster.local:8080
```

Good public spec:

```yaml
servers:
  - url: https://api.example.gov/v1
```

### 12.2 Environment-specific build problem

If server URLs differ by environment, avoid manually editing specs.

Options:

- use templated `servers`,
- generate environment-specific publication artifact,
- keep canonical contract environment-neutral,
- inject server URLs at documentation publishing stage.

Example:

```yaml
servers:
  - url: https://{environment}.api.example.gov/v1
    variables:
      environment:
        default: sandbox
        enum:
          - sandbox
          - api
```

But be careful: not all documentation/gateway tools handle variables equally well.

---

## 13. Importing OpenAPI Into Gateways

### 13.1 Import modes

Gateways usually support one or more modes:

```text
Mode A: Import routes only
Mode B: Import routes + request validation
Mode C: Import route + integration metadata extensions
Mode D: Import as documentation/catalog only
Mode E: Import into API product/developer portal
```

Know exactly which mode your platform uses.

### 13.2 Route-only import risk

If gateway imports only routes, then:

- schemas may not be enforced,
- auth may be configured separately,
- rate limits may be configured separately,
- responses may not be validated,
- operation metadata may be ignored.

OpenAPI then becomes a convenience for route creation, not contract enforcement.

### 13.3 Validation import risk

If gateway imports validation, then spec changes can become runtime-breaking.

Changing this:

```yaml
required: [name]
```

To this:

```yaml
required: [name, effectiveDate]
```

May immediately cause gateway to reject existing clients.

So OpenAPI diff must be a deployment gate.

### 13.4 Extension-driven import risk

If gateway integration metadata lives inside OpenAPI, then:

- platform engineers must review OpenAPI changes,
- API designers may accidentally change runtime routing,
- public spec must strip sensitive config,
- vendor extension syntax must be linted.

---

## 14. OpenAPI, Gateways, and Observability

### 14.1 Operation ID as observability dimension

If gateway can tag traffic by operation, use `operationId`.

Example labels:

```text
api.name=enforcement-api
api.version=v1
api.operation=getCase
http.route=/cases/{caseId}
consumer.app=partner-portal
```

This enables:

- per-operation latency,
- per-operation error rate,
- per-operation auth failures,
- per-operation rate limit hits,
- per-consumer impact analysis.

### 14.2 Route template vs raw path

Never aggregate metrics by raw path:

Bad:

```text
/cases/C-1001
/cases/C-1002
/cases/C-1003
```

Good:

```text
/cases/{caseId}
```

OpenAPI gives route template vocabulary.

### 14.3 Correlation IDs

Gateway should ensure a correlation/request ID exists and is propagated.

OpenAPI should document relevant headers:

```yaml
components:
  headers:
    CorrelationId:
      description: Correlation identifier for support and audit tracing.
      schema:
        type: string
```

Responses:

```yaml
headers:
  X-Correlation-Id:
    $ref: '#/components/headers/CorrelationId'
```

### 14.4 Audit-critical operations

Use extensions:

```yaml
x-audit:
  critical: true
  eventType: CASE_DECISION_SUBMITTED
```

But ensure this drives or verifies logging policy.

If OpenAPI says audit critical but gateway/backend do not log, the extension is false confidence.

---

## 15. Caching and Gateway Behavior

### 15.1 Gateway caching changes API semantics

If gateway caches responses, consumer-visible behavior changes:

- stale data possible,
- conditional request behavior matters,
- cache invalidation matters,
- auth-specific cache key matters,
- privacy risk increases.

OpenAPI should document cache-relevant headers when part of contract:

```yaml
headers:
  Cache-Control:
    schema:
      type: string
  ETag:
    schema:
      type: string
```

### 15.2 Dangerous cache failure

A gateway caches:

```text
GET /cases/{caseId}
```

But cache key omits user identity. User B receives User A’s case data.

This is not an OpenAPI-only problem, but OpenAPI can mark sensitive operations:

```yaml
x-cache-policy: no-store
x-data-classification: restricted
```

Then governance can check gateway config.

### 15.3 Cache contract

For public APIs, document:

- whether response is cacheable,
- cache control headers,
- ETag behavior,
- conditional requests,
- stale tolerance,
- invalidation guarantees.

Do not let gateway caching silently change freshness semantics.

---

## 16. Timeouts, Retries, and Idempotency

### 16.1 Gateway timeout can produce responses backend did not produce

Backend might continue processing after gateway returns `504`.

For command operations, this is dangerous.

Example:

```text
POST /cases/{caseId}/decision
Gateway timeout after 30s
Backend completes decision at 35s
Client retries
Duplicate decision attempt
```

OpenAPI should document:

- idempotency key support,
- `202 Accepted` patterns if operation is long-running,
- conflict response,
- retry safety.

### 16.2 Idempotency key header

```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: true
    schema:
      type: string
      minLength: 16
      maxLength: 128
    description: Required for command operations to safely retry after timeout or network failure.
```

### 16.3 Gateway retries

Gateway retries are risky for non-idempotent methods.

Safe-ish:

- retry `GET` under strict conditions,
- retry idempotent `PUT` with care,
- avoid retrying `POST` unless idempotency key semantics exist.

Extension example:

```yaml
x-gateway-policy:
  retry:
    enabled: false
```

But again: lint it and verify against gateway config.

---

## 17. API Gateway and Versioning

### 17.1 Gateway often owns version routing

Public versions:

```text
/v1/cases
/v2/cases
```

Gateway maps to:

```text
case-service-v1
case-service-v2
```

or:

```text
case-service with version header
```

OpenAPI should clearly represent each public API version.

### 17.2 One spec per major version

Recommended:

```text
openapi/enforcement-api-v1.yaml
openapi/enforcement-api-v2.yaml
```

Avoid one giant spec with ambiguous versioning unless tooling and docs are built for it.

### 17.3 Gateway compatibility trap

Gateway can support v1 and v2 routes while backend only supports v2 behavior due to transformation.

This creates fake compatibility.

Compatibility must be tested from the public gateway boundary.

```text
Contract test should hit the same boundary as real consumers.
```

---

## 18. Gateway Drift Scenarios

### 18.1 Drift type 1 — Spec says route exists, gateway does not expose it

Consumer sees docs:

```text
GET /cases/{caseId}/timeline
```

Runtime returns:

```text
404 Not Found
```

Causes:

- route import missed,
- environment mismatch,
- gateway deployment failed,
- route disabled.

Mitigation:

- smoke tests generated from OpenAPI,
- runtime route inventory diff,
- deployment artifact checks.

### 18.2 Drift type 2 — Gateway exposes route not in spec

Runtime has:

```text
POST /internal/reindex
```

Spec does not.

Risk:

- shadow API,
- security exposure,
- undocumented operation,
- compliance gap.

Mitigation:

- external route scan,
- gateway config diff against approved OpenAPI,
- deny-by-default exposure.

### 18.3 Drift type 3 — Gateway validates stricter than spec

Spec says optional field.

Gateway plugin config requires it.

Consumer follows spec and gets `400`.

Mitigation:

- generate gateway validation from spec,
- avoid hand-written divergent validators,
- contract tests through gateway.

### 18.4 Drift type 4 — Backend stricter than gateway/spec

Gateway passes request. Backend rejects.

Mitigation:

- backend validation annotations reflected into spec or contract-first definitions,
- provider contract tests,
- negative tests.

### 18.5 Drift type 5 — Error shapes differ by origin

Gateway `401` differs from backend `403` differs from validation `400`.

Mitigation:

- gateway error template standard,
- backend error library,
- OpenAPI examples for every major error.

### 18.6 Drift type 6 — Auth policy differs from spec

Spec says `cases:read`.

Gateway requires `case.admin`.

Consumer cannot use API as documented.

Mitigation:

- lint scopes,
- generate gateway policy from OpenAPI security requirements,
- security tests per operation.

---

## 19. CI/CD Architecture for Gateway-OpenAPI Alignment

### 19.1 Minimum pipeline

```text
1. Validate OpenAPI syntax
2. Lint style/security rules
3. Bundle multi-file spec
4. Diff against previous release
5. Detect breaking changes
6. Generate gateway artifact or verify gateway config
7. Run contract tests through gateway
8. Publish docs/catalog
9. Tag release artifact
```

### 19.2 Gateway artifact generation

Possible outputs:

```text
openapi.yaml
kong.yaml
aws-apigateway.yaml
apigee-proxy-bundle
terraform module inputs
helm values
gateway route manifest
```

Key principle:

```text
Do not manually re-enter the same contract information into gateway config.
```

Manual duplication creates drift.

### 19.3 Contract tests through gateway

Run tests against:

```text
https://gateway.dev.example.gov/v1
```

not only:

```text
http://case-service:8080
```

Because real consumer sees gateway behavior.

Test categories:

- route exists,
- auth required,
- invalid auth rejected,
- valid request accepted,
- invalid schema rejected consistently,
- documented error shape returned,
- rate limit response shape correct,
- correlation ID present,
- CORS if browser clients exist,
- payload size limit documented.

---

## 20. OpenAPI and CORS at Gateway

CORS is often configured at gateway for browser-facing APIs.

OpenAPI does not model full CORS behavior as a first-class portable contract.

But consumer-facing docs should clarify:

- allowed origins,
- allowed methods,
- allowed headers,
- credentials support,
- exposed headers,
- preflight behavior.

If browser clients consume API, gateway CORS behavior is part of integration reality.

Use extensions or external docs:

```yaml
x-cors:
  allowedOrigins:
    - https://portal.example.gov
  allowedHeaders:
    - Authorization
    - Content-Type
    - Idempotency-Key
  exposedHeaders:
    - X-Correlation-Id
    - Retry-After
```

But ensure sensitive origins are not accidentally published if inappropriate.

---

## 21. API Product Packaging

Gateway platforms often package APIs into products/plans.

An operation may be:

- public sandbox,
- partner-only,
- premium tier,
- internal agency-only,
- admin-only,
- deprecated.

OpenAPI can capture product metadata via extensions:

```yaml
x-api-product:
  name: Enforcement Partner API
  plan: partner-standard
  visibility: partner
```

Operation-level:

```yaml
x-availability:
  sandbox: true
  production: true
  partnerPlans:
    - standard
    - premium
```

For regulated systems, product packaging is not just commercial. It encodes who is allowed to integrate.

---

## 22. Practical Design Pattern: Public Facade Spec + Internal Upstream Spec

For complex Java/platform organizations, a strong pattern is:

```text
public-api.yaml
  - consumer-facing routes
  - public schemas
  - public error model
  - public auth scopes
  - public examples

upstream-api.yaml
  - gateway-to-service routes
  - internal headers
  - service DTO shapes
  - internal error model if different
  - service-level auth/trust model

gateway-policy.yaml / extensions
  - route mapping
  - timeout
  - retry
  - validation mode
  - rate limit
  - auth provider
```

This avoids forcing one artifact to represent everything.

But it introduces the need for mapping tests:

```text
public contract -> gateway transform -> upstream contract -> backend behavior
```

---

## 23. Practical Design Pattern: Contract-Driven Gateway Deployment

A mature flow:

```text
Developer edits OpenAPI
      |
      v
CI validates/lints/diffs
      |
      v
Gateway manifest generated
      |
      v
Platform policy checks
      |
      v
Deploy to gateway dev
      |
      v
Contract tests hit gateway
      |
      v
Publish docs/catalog
      |
      v
Promote to staging/prod
```

Important gates:

- no undocumented public route,
- no public route without security classification,
- no high-risk operation without explicit 401/403/409/429/5xx responses,
- no operation without stable `operationId`,
- no gateway transformation without review,
- no rate-limited operation without `429`,
- no command operation without idempotency policy decision,
- no sensitive response with cacheable policy.

---

## 24. Practical Design Pattern: Gateway Shadow Validation

For existing APIs, immediately enforcing validation at gateway can break clients.

Safer rollout:

```text
Phase 1: Observe only
- gateway logs validation violations
- does not block

Phase 2: Warn
- response header or partner notification
- dashboards by consumer

Phase 3: Block new clients
- old clients grandfathered temporarily

Phase 4: Enforce globally
- after migration window
```

This is especially useful when OpenAPI was generated after implementation and may be incomplete.

---

## 25. Case Study: Enforcement API Behind Gateway

Imagine public partner API:

```text
POST /v1/cases/{caseId}/evidence
GET  /v1/cases/{caseId}
POST /v1/cases/{caseId}/decision
```

Gateway responsibilities:

- mTLS for partner agency,
- OAuth2 JWT validation,
- scope check,
- request size limit for evidence metadata,
- route to case-service,
- inject verified partner ID header,
- rate limit by partner agency,
- normalize gateway errors,
- add correlation ID,
- log audit-critical operations.

Backend responsibilities:

- verify partner can access that case,
- validate case state,
- validate evidence classification,
- enforce decision authority,
- persist audit record,
- handle idempotency,
- return domain-specific conflicts.

OpenAPI responsibilities:

- describe public endpoints,
- describe security schemes and scopes,
- document required headers,
- document request/response schemas,
- document error responses,
- document idempotency key,
- document rate limit response,
- mark audit-critical operations via extension,
- provide examples.

Example snippet:

```yaml
paths:
  /cases/{caseId}/decision:
    post:
      operationId: submitCaseDecision
      summary: Submit a decision for a case.
      x-audit:
        critical: true
        eventType: CASE_DECISION_SUBMITTED
      x-gateway-policy:
        rateLimitPlan: partner-high-risk-command
        retry:
          enabled: false
        timeoutMs: 10000
      security:
        - oauth2: [cases:decide]
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
            minLength: 16
            maxLength: 128
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SubmitDecisionRequest'
      responses:
        '202':
          description: Decision submission accepted for processing.
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '409':
          $ref: '#/components/responses/InvalidCaseState'
        '429':
          $ref: '#/components/responses/RateLimited'
        '504':
          $ref: '#/components/responses/GatewayTimeout'
```

Note the split:

- OpenAPI documents the public operation.
- Gateway extension hints runtime policy.
- Backend still owns domain authorization and state transition.

---

## 26. Review Checklist: OpenAPI + Gateway

Use this checklist in pull requests.

### 26.1 Boundary clarity

- [ ] Is this spec public, internal, upstream, partner, or admin?
- [ ] Does `servers` point to consumer-facing base URL?
- [ ] Are internal upstream URLs hidden from public docs?
- [ ] Are public and internal contracts separated if transformations exist?

### 26.2 Routing

- [ ] Does every public gateway route exist in OpenAPI?
- [ ] Does every OpenAPI path exist in gateway deployment?
- [ ] Are route templates consistent?
- [ ] Are path variables named consistently?

### 26.3 Security

- [ ] Does every protected operation declare security requirements?
- [ ] Are scopes accurate?
- [ ] Are public endpoints intentionally marked `security: []`?
- [ ] Are gateway auth policies aligned with OpenAPI?
- [ ] Is domain authorization documented where relevant?

### 26.4 Validation

- [ ] Is gateway validation mode known?
- [ ] Does gateway support the OpenAPI/JSON Schema features used?
- [ ] Are validation errors standardized?
- [ ] Are backend validations aligned with schema constraints?

### 26.5 Errors

- [ ] Are gateway-originated errors documented?
- [ ] Are `401`, `403`, `404`, `413`, `415`, `429`, `502`, `503`, `504` considered where relevant?
- [ ] Does gateway error body match API error standard?
- [ ] Is correlation ID included in errors?

### 26.6 Rate limits and quotas

- [ ] Is `429` documented?
- [ ] Is `Retry-After` documented if emitted?
- [ ] Are rate-limit headers documented?
- [ ] Are plan/quota metadata aligned with gateway config?

### 26.7 Transformations

- [ ] Does gateway transform request/response payloads?
- [ ] If yes, is public contract documented at the correct boundary?
- [ ] Are status code transformations reviewed?
- [ ] Are error body transformations reviewed?

### 26.8 Reliability

- [ ] Are timeout behaviors documented?
- [ ] Are command operations idempotent or explicitly non-retryable?
- [ ] Is `Idempotency-Key` required where appropriate?
- [ ] Are gateway retries disabled for unsafe operations?

### 26.9 Observability

- [ ] Does every operation have stable `operationId`?
- [ ] Does gateway tag metrics/logs by route template or operation ID?
- [ ] Is correlation ID documented?
- [ ] Are audit-critical operations marked and logged?

### 26.10 Publication

- [ ] Are vendor extensions stripped or safe for public docs?
- [ ] Are internal-only operations filtered out?
- [ ] Is docs publication tied to deployment artifact?
- [ ] Is runtime smoke test run after gateway deployment?

---

## 27. Common Anti-Patterns

### Anti-pattern 1 — “The gateway imported the spec, so we are contract-first”

Importing routes is not contract-first.

Contract-first means the contract drives design, review, tests, compatibility checks, and implementation alignment.

### Anti-pattern 2 — Public spec generated from backend while gateway transforms public behavior

The generated backend spec describes upstream behavior, not consumer-visible API.

### Anti-pattern 3 — Gateway validation enabled without compatibility review

Spec change becomes runtime rejection.

### Anti-pattern 4 — Gateway errors undocumented

Consumer handles backend errors but fails on gateway-originated `429`, `502`, or `504`.

### Anti-pattern 5 — Security scheme documented vaguely

```yaml
security:
  - bearerAuth: []
```

But no scopes, no `401`, no `403`, no authorization explanation.

### Anti-pattern 6 — Vendor extensions become the real undocumented contract

All important behavior lives in `x-*` fields that only platform engineers understand.

### Anti-pattern 7 — Gateway transforms status codes for convenience

This destroys error semantics and makes clients less correct.

### Anti-pattern 8 — Rate limit exists only in gateway portal text

`429` is not in OpenAPI, generated clients/tests do not know it exists.

### Anti-pattern 9 — Internal route accidentally published

Gateway route config exposes endpoint not in approved OpenAPI.

### Anti-pattern 10 — Backend trusts gateway too much

A misconfigured gateway or internal bypass path exposes backend to invalid or unauthorized requests.

---

## 28. Mental Model: Five Contracts at the Gateway Boundary

For gateway-backed APIs, there are five contracts.

```text
1. Consumer contract
   What external users are promised.

2. Gateway contract
   What gateway enforces, transforms, and emits.

3. Upstream contract
   What backend service receives from gateway.

4. Domain contract
   What business invariants allow.

5. Operational contract
   What happens under timeout, overload, retry, failure, quota, and deployment.
```

OpenAPI primarily captures contract 1. With extensions and related artifacts, it can help connect to contracts 2 and 3. It cannot fully replace contracts 4 and 5.

Top-tier API engineering is making these contracts explicit and testable.

---

## 29. Java Engineer Implementation Guidance

### 29.1 In Spring Boot behind gateway

Even if gateway validates:

- keep Bean Validation at controller boundary,
- keep method-level authorization where needed,
- keep domain authorization in service/application layer,
- normalize errors consistently,
- include correlation ID in logs/responses,
- implement idempotency for high-risk commands,
- test through gateway-like layer in integration tests.

### 29.2 Controller should not assume gateway-only identity headers are trustworthy

If gateway injects:

```text
X-Authenticated-Subject: user-123
X-Partner-Agency: agency-456
```

Backend must ensure:

- only gateway can call backend,
- headers cannot be spoofed by external clients,
- mTLS/network policy/service mesh enforces trust boundary,
- local/dev/test modes do not accidentally bypass auth assumptions.

### 29.3 Avoid leaking gateway concerns into domain core

Bad:

```java
class CaseDecisionService {
    void decide(String xGatewayClientPlan, String xRateLimitBucket, ...)
}
```

Better:

```java
class CaseDecisionCommand {
    CaseId caseId;
    Actor actor;
    Decision decision;
    IdempotencyKey idempotencyKey;
}
```

Gateway metadata is translated at boundary. Domain receives meaningful concepts.

### 29.4 Generated OpenAPI from Spring behind gateway

If using springdoc/code-first, generated spec likely reflects backend route, not public gateway route, unless carefully configured.

Be careful with:

- base path,
- forwarded headers,
- server URL,
- hidden/internal endpoints,
- gateway-transformed errors,
- security scheme differences,
- route rewriting.

For public API, contract-first or curated generated spec is often safer.

---

## 30. Final Takeaways

1. OpenAPI and API gateway are related but not identical.
2. OpenAPI is the interface contract; gateway is runtime mediation and enforcement.
3. Gateway request validation is useful but not enough for domain correctness.
4. Gateway-originated errors must be part of the contract.
5. Public OpenAPI must describe what consumers observe, not necessarily upstream backend behavior.
6. Vendor extensions are useful but must be governed and linted.
7. Gateway transformations are high-risk because they create hidden APIs.
8. Contract tests should run through the same boundary real consumers use.
9. Rate limits, timeouts, idempotency, correlation, and gateway failures are part of API reality.
10. A mature platform keeps OpenAPI, gateway config, backend behavior, documentation, and tests aligned through CI/CD.

The goal is not to make OpenAPI become gateway config. The goal is to make gateway behavior impossible to drift silently from the API contract.

---

## References

- OpenAPI Initiative — OpenAPI provides a formal standard for describing HTTP APIs so people and tools can understand API behavior, generate code, create tests, and apply design standards.
- OpenAPI Specification v3.2.0 — official specification for OpenAPI Description structure, operations, servers, security, responses, extensions, and schema usage.
- AWS API Gateway OpenAPI Extensions — AWS-specific extensions support API Gateway authorization and integrations for REST APIs and HTTP APIs.
- AWS API Gateway HTTP APIs with OpenAPI — HTTP APIs can be defined using OpenAPI 3.0 definition files and imported into API Gateway.
- Kong Request Validator Plugin — validates request body and parameters before upstream handling and returns `400 Bad Request` on validation failure.
- Kong OAS Validation Plugin — validates HTTP requests and responses against Swagger/OpenAPI descriptions and documents supported OAS versions.
- Google Apigee API Proxy documentation — API proxies define how client apps consume APIs and attach policies for security, quotas, access control, and rate limiting.
- Google Apigee OpenAPI proxy creation documentation — API proxies can be created from OpenAPI specifications.

---

## Series Progress

```text
Current part: 025 / 030
Status: In progress
Series complete: No
Remaining parts: 5
Next: Part 026 — OpenAPI for Regulated, Auditable, and High-Risk Systems
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-024.md">⬅️ OpenAPI Mastery for Java Engineers — Part 024</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-026.md">OpenAPI Mastery for Java Engineers — Part 026 ➡️</a>
</div>
