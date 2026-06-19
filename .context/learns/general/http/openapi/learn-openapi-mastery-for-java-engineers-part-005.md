# learn-openapi-mastery-for-java-engineers-part-005.md

# Part 005 — Parameters: Path, Query, Header, Cookie, Style, Explode, and Encoding

> Series: OpenAPI Mastery for Java Engineers  
> Part: 005 / 030  
> Status: In Progress  
> Previous: Part 004 — Paths and Operations: Modelling API Capabilities Correctly  
> Next: Part 006 — Request Bodies: Media Types, Content Negotiation, Validation, and Semantics

---

## 0. Executive Summary

Parameter modelling looks simple until the first serious integration bug appears.

Most engineers think parameters are only:

```text
/path/{id}?page=1&size=20
```

But in OpenAPI, parameters carry a much deeper responsibility. They define:

1. where input is placed,
2. whether it is required,
3. how it is serialized,
4. how it is parsed,
5. what values are valid,
6. how clients should generate calls,
7. how servers should bind values,
8. how gateways, validators, SDKs, mocks, tests, and documentation interpret the request.

A poorly specified parameter can cause subtle failures even when the endpoint path and method are correct.

Example:

```http
GET /cases?status=OPEN,CLOSED
```

Is this:

```text
status = ["OPEN", "CLOSED"]
```

or:

```text
status = "OPEN,CLOSED"
```

or invalid?

Another example:

```http
GET /cases?status=OPEN&status=CLOSED
```

Is this equivalent to the previous one? Some Java frameworks bind it as a list. Some generated clients may serialize arrays differently. Some gateways may normalize or reorder it. Some API docs may imply one format while the backend accepts another.

OpenAPI parameter modelling exists to remove this ambiguity.

This part teaches parameter modelling as a contract discipline, not as syntax memorization.

---

## 1. Core Mental Model

An OpenAPI parameter is not simply a variable.

It is a declared piece of request input that lives outside the request body.

In OpenAPI, parameters can appear in four locations:

```text
path
query
header
cookie
```

Each location has different semantics.

| Location | Purpose | Typical Examples |
|---|---|---|
| `path` | Identifies a resource or scoped capability | `/cases/{caseId}` |
| `query` | Modifies retrieval, search, filtering, pagination, projection, sorting | `?page=1&size=20&status=OPEN` |
| `header` | Carries request metadata, protocol-ish concerns, client context | `Idempotency-Key`, `If-Match`, `X-Correlation-Id` |
| `cookie` | Carries browser/session-oriented state | `SESSION`, `csrfToken` |

A parameter has two layers of meaning:

```text
contract layer:
  what value exists, what type it has, what constraints apply

serialization layer:
  how that value appears on the wire
```

Many OpenAPI mistakes happen because engineers describe the first layer but forget the second.

For scalar values, this is usually harmless:

```http
GET /cases?status=OPEN
```

But for arrays and objects, serialization is not obvious:

```http
GET /cases?status=OPEN,CLOSED
GET /cases?status=OPEN&status=CLOSED
GET /cases?filter[status]=OPEN&filter[priority]=HIGH
GET /cases?filter=status:OPEN,priority:HIGH
```

All of these may be valid API designs, but they are not the same contract.

---

## 2. Parameter Object Anatomy

A simplified OpenAPI Parameter Object looks like this:

```yaml
parameters:
  - name: status
    in: query
    required: false
    description: Filter cases by lifecycle status.
    schema:
      type: array
      items:
        type: string
        enum: [OPEN, UNDER_REVIEW, CLOSED]
    style: form
    explode: true
```

Important fields:

| Field | Meaning |
|---|---|
| `name` | Name of the parameter as it appears on the wire |
| `in` | Parameter location: `path`, `query`, `header`, or `cookie` |
| `required` | Whether the parameter must be present |
| `description` | Human explanation of semantics |
| `schema` | Structural/type contract |
| `content` | Alternative to `schema` for complex media-type-based parameter content |
| `style` | Serialization style |
| `explode` | Whether arrays/objects are expanded into multiple fields |
| `allowReserved` | Whether reserved characters are allowed unescaped in query parameters |
| `deprecated` | Whether parameter is deprecated |
| `example` | Single example |
| `examples` | Named examples |

Parameter Object rule of thumb:

```text
schema tells what the value is
style/explode tells how the value is represented
```

---

## 3. Parameter Locations

### 3.1 Path Parameters

Path parameters are embedded in URL path templates.

Example path:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      parameters:
        - name: caseId
          in: path
          required: true
          description: Stable identifier of the case.
          schema:
            type: string
            pattern: '^CASE-[0-9]{8}$'
```

Path parameters are always required.

This is not merely a style preference. If the route template is:

```text
/cases/{caseId}
```

then a request cannot match the intended resource without `caseId`.

So this is invalid or misleading:

```yaml
- name: caseId
  in: path
  required: false
```

### Mental model

Path parameters should normally identify one of these:

1. resource identity,
2. parent scope,
3. stable namespace,
4. operation target.

Good examples:

```text
/cases/{caseId}
/cases/{caseId}/evidence/{evidenceId}
/organizations/{organizationId}/users/{userId}
```

Questionable examples:

```text
/reports/{status}
/search/{query}
/users/{sortOrder}
```

Why questionable?

Because these values usually modify retrieval rather than identify resources. They are often better as query parameters.

---

### 3.2 Query Parameters

Query parameters are used to modify the result or behavior of a request without changing the resource identity.

Common use cases:

```text
pagination
filtering
sorting
search
field selection
include/expand
locale
view mode
feature hints
```

Example:

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      parameters:
        - name: status
          in: query
          required: false
          description: Return only cases with one of the supplied statuses.
          schema:
            type: array
            items:
              type: string
              enum: [OPEN, UNDER_REVIEW, CLOSED]
          style: form
          explode: true
        - name: page
          in: query
          required: false
          schema:
            type: integer
            minimum: 0
            default: 0
        - name: size
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
```

Wire representation:

```http
GET /cases?status=OPEN&status=CLOSED&page=0&size=20
```

Query parameters should not be treated as an unstructured dumping ground.

Bad:

```http
GET /cases?q=anything
```

Maybe acceptable for free-text search, but not if `q` secretly contains a full undocumented query language.

Better:

```http
GET /cases?status=OPEN&priority=HIGH&assignedTo=U123&page=0&size=20
```

Or, if a complex filter language is needed, document it explicitly.

---

### 3.3 Header Parameters

Header parameters should model metadata, not ordinary domain input.

Common examples:

```text
Idempotency-Key
If-Match
If-None-Match
X-Correlation-Id
X-Request-Id
Accept-Language
Prefer
```

Example:

```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: false
    description: Client-generated key used to safely retry command requests.
    schema:
      type: string
      minLength: 8
      maxLength: 128
```

Header parameters are useful for cross-cutting protocol concerns:

1. idempotency,
2. concurrency control,
3. tracing,
4. localization,
5. conditional requests,
6. client capability hints.

But avoid putting ordinary business filters in headers.

Bad:

```http
GET /cases
X-Case-Status: OPEN
```

Better:

```http
GET /cases?status=OPEN
```

Why?

Because `status` is part of the resource query semantics, not transport metadata.

---

### 3.4 Cookie Parameters

Cookie parameters are mostly relevant for browser-oriented APIs.

Example:

```yaml
parameters:
  - name: SESSION
    in: cookie
    required: true
    description: Browser session cookie.
    schema:
      type: string
```

For many backend APIs, especially service-to-service APIs, cookie parameters should be rare.

Use cookies when:

1. browser session state is intentionally cookie-based,
2. CSRF mechanisms depend on cookies,
3. compatibility with browser authentication flow requires it.

Avoid cookies when:

1. the API is public partner-facing,
2. the API is service-to-service,
3. bearer token or OAuth2 is the intended model,
4. SDK generation for non-browser clients is important.

---

## 4. Required vs Optional

Parameter requiredness is often misunderstood.

### 4.1 Path Parameters Are Required

Path parameters must be required.

```yaml
- name: caseId
  in: path
  required: true
  schema:
    type: string
```

### 4.2 Query/Header/Cookie Parameters May Be Optional

Example:

```yaml
- name: page
  in: query
  required: false
  schema:
    type: integer
    default: 0
```

But optional does not mean semantically irrelevant.

An optional parameter may still have a default behavior.

Example:

```yaml
- name: sort
  in: query
  required: false
  description: Sort order. Defaults to createdAt descending when omitted.
  schema:
    type: string
    enum: [createdAt,-createdAt,updatedAt,-updatedAt]
    default: -createdAt
```

The contract must answer:

```text
What happens when this parameter is absent?
```

Bad:

```yaml
- name: includeClosed
  in: query
  schema:
    type: boolean
```

Better:

```yaml
- name: includeClosed
  in: query
  required: false
  description: When true, closed cases are included. When omitted or false, only active cases are returned.
  schema:
    type: boolean
    default: false
```

---

## 5. The `schema` Field

The `schema` describes the value after parsing.

Example scalar:

```yaml
- name: page
  in: query
  schema:
    type: integer
    minimum: 0
```

Example array:

```yaml
- name: status
  in: query
  schema:
    type: array
    items:
      type: string
      enum: [OPEN, CLOSED]
```

Example constrained string:

```yaml
- name: caseId
  in: path
  required: true
  schema:
    type: string
    pattern: '^CASE-[0-9]{8}$'
```

Example header:

```yaml
- name: If-Match
  in: header
  required: false
  description: Entity tag expected by the client for optimistic concurrency control.
  schema:
    type: string
```

Schema is where you define:

1. type,
2. enum,
3. min/max,
4. pattern,
5. array item type,
6. object shape,
7. default,
8. examples,
9. deprecation,
10. read/write concerns where relevant.

But schema alone is not always enough. For arrays and objects, you must also care about serialization.

---

## 6. Serialization: The Missing Layer Most Bugs Come From

OpenAPI parameter serialization answers this question:

```text
How does a logical value appear in the URL/header/cookie?
```

For example, this logical array:

```json
["OPEN", "CLOSED"]
```

could appear as:

```http
?status=OPEN&status=CLOSED
?status=OPEN,CLOSED
?status=OPEN|CLOSED
?status=OPEN%20CLOSED
```

These are not interchangeable unless your contract says so.

OpenAPI uses `style` and `explode` to describe serialization.

```yaml
- name: status
  in: query
  schema:
    type: array
    items:
      type: string
  style: form
  explode: true
```

This means:

```http
?status=OPEN&status=CLOSED
```

Change `explode`:

```yaml
style: form
explode: false
```

Now it means:

```http
?status=OPEN,CLOSED
```

This is a huge difference for clients, gateways, frameworks, and generated SDKs.

---

## 7. `style` and `explode` Overview

### 7.1 `style`

`style` defines how a parameter value is serialized depending on its location.

Common styles:

| Style | Usually Used In | Meaning |
|---|---|---|
| `simple` | path, header | comma-separated style |
| `form` | query, cookie | form-style query serialization |
| `matrix` | path | semicolon-prefixed path parameters |
| `label` | path | dot-prefixed path parameters |
| `spaceDelimited` | query | array values separated by spaces |
| `pipeDelimited` | query | array values separated by pipes |
| `deepObject` | query | object represented with bracketed keys |

### 7.2 `explode`

`explode` controls whether array/object values are expanded into separate fields.

Conceptual rule:

```text
explode: false
  compact representation

explode: true
  expanded representation
```

Example array:

```json
["OPEN", "CLOSED"]
```

As query parameter using `form`:

```yaml
style: form
explode: true
```

```http
?status=OPEN&status=CLOSED
```

Using `form` with `explode: false`:

```http
?status=OPEN,CLOSED
```

---

## 8. Default Serialization Rules You Should Know

OpenAPI has defaults, but top-tier API contracts should often be explicit for important parameters.

Common default intuition:

```text
query parameters:
  style: form
  explode: true

path parameters:
  style: simple
  explode: false

header parameters:
  style: simple
  explode: false

cookie parameters:
  style: form
  explode: true
```

Even if defaults exist, explicitly declaring `style` and `explode` for arrays/objects improves readability and avoids generator/tool differences.

Recommended:

```yaml
- name: status
  in: query
  description: Filter by one or more statuses.
  schema:
    type: array
    items:
      type: string
      enum: [OPEN, CLOSED]
  style: form
  explode: true
```

Less clear:

```yaml
- name: status
  in: query
  schema:
    type: array
    items:
      type: string
```

Even if the second one has defaults, a reviewer must remember them. Explicitness is better for cross-team contracts.

---

## 9. Path Parameter Serialization

Path parameters usually use `simple` style.

Example:

```yaml
paths:
  /cases/{caseId}:
    get:
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
          style: simple
          explode: false
```

Wire form:

```http
/cases/CASE-00001234
```

### 9.1 Arrays in Path Parameters

Possible, but use carefully.

```yaml
paths:
  /reports/{ids}:
    get:
      parameters:
        - name: ids
          in: path
          required: true
          schema:
            type: array
            items:
              type: string
          style: simple
          explode: false
```

Wire form:

```http
/reports/A,B,C
```

This is usually less clear than query parameters:

```http
/reports?ids=A&ids=B&ids=C
```

Use path arrays only when the path segment genuinely identifies a compound resource.

### 9.2 Matrix and Label Styles

Matrix style:

```yaml
- name: caseId
  in: path
  required: true
  schema:
    type: string
  style: matrix
  explode: false
```

Possible wire form:

```http
/cases/;caseId=CASE-00001234
```

Label style:

```yaml
- name: caseId
  in: path
  required: true
  schema:
    type: string
  style: label
  explode: false
```

Possible wire form:

```http
/cases/.CASE-00001234
```

These styles exist, but many modern JSON HTTP APIs do not use them. Tool and framework support may vary. In Java/Spring ecosystems, simple path variables are usually the most predictable.

Recommendation:

```text
Use normal simple path parameters unless you have a strong interoperability reason.
```

---

## 10. Query Parameter Serialization

Query parameters are where most serialization complexity lives.

### 10.1 Scalar Query Parameter

```yaml
- name: priority
  in: query
  required: false
  schema:
    type: string
    enum: [LOW, MEDIUM, HIGH]
```

Wire:

```http
?priority=HIGH
```

Simple.

### 10.2 Array Query Parameter — Repeated Form

```yaml
- name: status
  in: query
  required: false
  description: Filter by one or more case statuses.
  schema:
    type: array
    items:
      type: string
      enum: [OPEN, UNDER_REVIEW, CLOSED]
  style: form
  explode: true
```

Wire:

```http
?status=OPEN&status=CLOSED
```

This is often the best default for Java/Spring APIs because it maps naturally to:

```java
@GetMapping("/cases")
public List<CaseSummary> listCases(@RequestParam List<String> status) {
    ...
}
```

### 10.3 Array Query Parameter — Comma-Separated

```yaml
- name: status
  in: query
  required: false
  schema:
    type: array
    items:
      type: string
      enum: [OPEN, UNDER_REVIEW, CLOSED]
  style: form
  explode: false
```

Wire:

```http
?status=OPEN,CLOSED
```

This is compact, but it has trade-offs:

1. values containing commas become tricky,
2. framework binding may need custom conversion,
3. generated clients must agree,
4. logs are less explicit,
5. inconsistent with repeated query param conventions.

Use only if you intentionally standardize on CSV-style query arrays.

### 10.4 Space-Delimited Arrays

```yaml
- name: status
  in: query
  schema:
    type: array
    items:
      type: string
  style: spaceDelimited
  explode: false
```

Wire:

```http
?status=OPEN%20CLOSED
```

This is less common in typical backend APIs. Avoid unless there is a specific standard or legacy requirement.

### 10.5 Pipe-Delimited Arrays

```yaml
- name: status
  in: query
  schema:
    type: array
    items:
      type: string
  style: pipeDelimited
  explode: false
```

Wire:

```http
?status=OPEN|CLOSED
```

This can be readable, but may conflict with URL encoding expectations and tooling assumptions.

### 10.6 Object Query Parameter — Form Exploded

Logical object:

```json
{
  "status": "OPEN",
  "priority": "HIGH"
}
```

OpenAPI:

```yaml
- name: filter
  in: query
  schema:
    type: object
    properties:
      status:
        type: string
      priority:
        type: string
  style: form
  explode: true
```

Possible wire form:

```http
?status=OPEN&priority=HIGH
```

Notice a subtle issue: the object parameter name `filter` disappears from the wire representation when exploded. That may be surprising.

### 10.7 Object Query Parameter — Form Non-Exploded

```yaml
- name: filter
  in: query
  schema:
    type: object
    properties:
      status:
        type: string
      priority:
        type: string
  style: form
  explode: false
```

Wire:

```http
?filter=status,OPEN,priority,HIGH
```

This is compact but usually not ergonomic.

### 10.8 Object Query Parameter — Deep Object

```yaml
- name: filter
  in: query
  schema:
    type: object
    properties:
      status:
        type: string
      priority:
        type: string
  style: deepObject
  explode: true
```

Wire:

```http
?filter[status]=OPEN&filter[priority]=HIGH
```

This is useful when you want grouped filter semantics.

But be careful:

1. framework support varies,
2. generated client support varies,
3. nested deep objects can become unclear,
4. query string length can become a practical limit.

For simple filters, separate query parameters are often clearer.

---

## 11. Header Parameter Serialization

Headers usually use scalar values or simple comma-separated values.

Example:

```yaml
- name: X-Correlation-Id
  in: header
  required: false
  schema:
    type: string
    minLength: 8
    maxLength: 128
```

Wire:

```http
X-Correlation-Id: req-abc-123
```

Header arrays are possible, but be careful because HTTP header behavior has many historical and intermediary-specific details.

Example:

```yaml
- name: X-Client-Capability
  in: header
  required: false
  schema:
    type: array
    items:
      type: string
  style: simple
  explode: false
```

Wire:

```http
X-Client-Capability: feature-a,feature-b
```

Recommendation:

```text
Keep custom header parameters simple.
```

If you need structured business data, use query parameters or request body instead.

---

## 12. Cookie Parameter Serialization

Cookie parameters are represented using cookie syntax.

Example:

```yaml
- name: csrfToken
  in: cookie
  required: true
  schema:
    type: string
```

Wire:

```http
Cookie: csrfToken=abc123
```

Cookie parameters should usually be simple scalar values.

Avoid complex arrays/objects in cookies unless you are modelling an existing browser contract.

---

## 13. `allowReserved`

`allowReserved` applies to query parameters and controls whether reserved characters can be included without percent-encoding.

Reserved characters include characters such as:

```text
:/?#[]@!$&'()*+,;=
```

Example:

```yaml
- name: query
  in: query
  required: false
  description: Search expression. Reserved characters may be used by the query language.
  schema:
    type: string
  allowReserved: true
```

This can matter when you intentionally allow query expressions like:

```http
?query=status:OPEN AND priority:HIGH
```

However, allowing reserved characters can increase ambiguity with URL parsing and intermediaries.

Recommendation:

```text
Avoid custom query languages unless the API genuinely needs them.
If you need one, document grammar, encoding, escaping, and examples precisely.
```

---

## 14. Parameters vs Request Body

A common modelling question:

```text
Should this be a query parameter or request body field?
```

Use parameters when the input is:

1. resource identity,
2. simple retrieval modifier,
3. filtering/sorting/pagination,
4. request metadata,
5. cache-relevant selection input,
6. conditional request metadata.

Use request body when the input is:

1. a command payload,
2. a complex object,
3. large or nested data,
4. create/update state,
5. batch operation body,
6. sensitive structured data that should not appear in URLs/logs.

Example retrieval:

```http
GET /cases?status=OPEN&priority=HIGH&page=0&size=20
```

Example command:

```http
POST /cases/CASE-00001234/escalations
Content-Type: application/json

{
  "reason": "Potential public safety impact",
  "targetQueue": "senior-review"
}
```

Do not force complex command data into query parameters.

Bad:

```http
POST /cases/CASE-00001234/escalate?reason=Potential%20public%20safety%20impact&targetQueue=senior-review
```

Better:

```http
POST /cases/CASE-00001234/escalations
```

with JSON body.

---

## 15. Filtering Parameter Design

Filtering is where many APIs become inconsistent.

### 15.1 Separate Named Filters

```yaml
parameters:
  - name: status
    in: query
    schema:
      type: array
      items:
        type: string
        enum: [OPEN, UNDER_REVIEW, CLOSED]
    style: form
    explode: true
  - name: priority
    in: query
    schema:
      type: string
      enum: [LOW, MEDIUM, HIGH]
  - name: assignedTo
    in: query
    schema:
      type: string
```

Wire:

```http
GET /cases?status=OPEN&status=UNDER_REVIEW&priority=HIGH&assignedTo=U123
```

Best when filters are known and stable.

Benefits:

1. easy to document,
2. easy to validate,
3. easy to bind in Java,
4. easy to generate clients,
5. easy to lint,
6. easy to show in Swagger UI.

### 15.2 Generic Filter Object

```yaml
- name: filter
  in: query
  style: deepObject
  explode: true
  schema:
    type: object
    properties:
      status:
        type: string
      priority:
        type: string
```

Wire:

```http
GET /cases?filter[status]=OPEN&filter[priority]=HIGH
```

Best when you want namespace grouping.

Trade-off: tooling and framework support may be less consistent.

### 15.3 Filter Expression String

```yaml
- name: filter
  in: query
  required: false
  description: |
    Filter expression using the case filter grammar.
    Supported fields: status, priority, assignedTo, createdAt.
    Supported operators: eq, ne, in, gt, gte, lt, lte.
    Example: status in (OPEN,UNDER_REVIEW) and priority eq HIGH.
  schema:
    type: string
```

Wire:

```http
GET /cases?filter=status%20in%20(OPEN,UNDER_REVIEW)%20and%20priority%20eq%20HIGH
```

Use this only if you are prepared to define, parse, validate, version, and document a real query language.

Anti-pattern:

```yaml
- name: filter
  in: query
  schema:
    type: string
```

with no grammar.

That is not a contract. It is a mystery box.

---

## 16. Sorting Parameter Design

Sorting looks easy but has hidden choices.

### 16.1 Single Sort String

```yaml
- name: sort
  in: query
  required: false
  description: |
    Sort expression. Prefix with '-' for descending order.
    Supported fields: createdAt, updatedAt, priority.
  schema:
    type: array
    items:
      type: string
      enum:
        - createdAt
        - -createdAt
        - updatedAt
        - -updatedAt
        - priority
        - -priority
  style: form
  explode: true
```

Wire:

```http
GET /cases?sort=-createdAt&sort=priority
```

This works well for multi-sort.

### 16.2 Separate Sort Field and Direction

```yaml
- name: sortBy
  in: query
  schema:
    type: string
    enum: [createdAt, updatedAt, priority]
- name: sortDirection
  in: query
  schema:
    type: string
    enum: [asc, desc]
    default: desc
```

Wire:

```http
GET /cases?sortBy=createdAt&sortDirection=desc
```

Simpler, but less flexible for multi-field sorting.

### 16.3 Avoid Undocumented Sort Syntax

Bad:

```yaml
- name: sort
  in: query
  schema:
    type: string
```

with backend accepting:

```text
createdAt:desc,priority:asc
```

If you support this syntax, document it.

---

## 17. Pagination Parameters

Pagination parameters are query parameters, but they deserve consistency.

### 17.1 Offset/Page Pagination

```yaml
parameters:
  - name: page
    in: query
    required: false
    description: Zero-based page index.
    schema:
      type: integer
      minimum: 0
      default: 0
  - name: size
    in: query
    required: false
    description: Number of items per page.
    schema:
      type: integer
      minimum: 1
      maximum: 100
      default: 20
```

Wire:

```http
GET /cases?page=0&size=20
```

### 17.2 Cursor Pagination

```yaml
parameters:
  - name: cursor
    in: query
    required: false
    description: Opaque cursor returned by the previous list response.
    schema:
      type: string
  - name: limit
    in: query
    required: false
    description: Maximum number of items to return.
    schema:
      type: integer
      minimum: 1
      maximum: 100
      default: 20
```

Wire:

```http
GET /cases?cursor=eyJvZmZzZXQiOjIwfQ&limit=20
```

Important contract rule:

```text
If a cursor is opaque, say it is opaque.
Consumers must not parse or construct it.
```

### 17.3 Pagination Anti-Patterns

Bad:

```yaml
- name: page
  in: query
  schema:
    type: integer
```

Missing:

1. zero-based or one-based,
2. default,
3. minimum,
4. maximum,
5. stable ordering expectation,
6. response metadata.

Better:

```yaml
- name: page
  in: query
  description: Zero-based page index. Defaults to 0.
  schema:
    type: integer
    minimum: 0
    default: 0
```

---

## 18. Field Selection and Expansion Parameters

APIs often need to control response shape.

### 18.1 Include/Expansion

```yaml
- name: include
  in: query
  required: false
  description: Related resources to include in the response.
  schema:
    type: array
    items:
      type: string
      enum: [subject, assignedOfficer, latestDecision]
  style: form
  explode: true
```

Wire:

```http
GET /cases/CASE-00001234?include=subject&include=latestDecision
```

### 18.2 Sparse Fieldsets

```yaml
- name: fields
  in: query
  required: false
  description: Fields to include in the response. If omitted, the default field set is returned.
  schema:
    type: array
    items:
      type: string
      enum: [id, status, priority, createdAt, updatedAt]
  style: form
  explode: false
```

Wire:

```http
GET /cases?fields=id,status,createdAt
```

This can help performance, but it complicates caching, SDKs, and response typing.

Use cautiously.

---

## 19. Header Parameters for Idempotency

Idempotency keys are a strong example of a good header parameter.

```yaml
components:
  parameters:
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: false
      description: |
        Client-generated key used to make retried command requests safe.
        If the same key is reused with the same request payload, the server returns the original result.
        Reusing the same key with a different payload may produce a conflict error.
      schema:
        type: string
        minLength: 8
        maxLength: 128
```

Use in operation:

```yaml
paths:
  /cases/{caseId}/escalations:
    post:
      operationId: escalateCase
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
```

The parameter alone is not enough. The behavior must be documented.

Key questions:

1. Is the key required?
2. How long is it retained?
3. Is it scoped per endpoint, user, tenant, or global?
4. What happens if same key but different payload?
5. What response is returned on replay?

OpenAPI can describe the parameter. Your API description must explain the semantics.

---

## 20. Header Parameters for Optimistic Concurrency

Concurrency control is another strong header use case.

Example:

```yaml
components:
  parameters:
    IfMatch:
      name: If-Match
      in: header
      required: true
      description: |
        Entity tag representing the version the client intends to update.
        The server rejects the request with 412 Precondition Failed if the resource has changed.
      schema:
        type: string
```

Use:

```http
PATCH /cases/CASE-00001234
If-Match: "case-version-7"
```

This is better than inventing ad-hoc fields like:

```json
{
  "version": 7,
  "status": "CLOSED"
}
```

Both can work, but headers align better with conditional request semantics.

OpenAPI should document expected failure responses too:

```yaml
responses:
  '412':
    description: The supplied precondition did not match the current resource version.
```

---

## 21. Parameter Reuse with Components

Common parameters should be reusable.

```yaml
components:
  parameters:
    Page:
      name: page
      in: query
      required: false
      description: Zero-based page index.
      schema:
        type: integer
        minimum: 0
        default: 0

    Size:
      name: size
      in: query
      required: false
      description: Number of items per page.
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20

    CorrelationId:
      name: X-Correlation-Id
      in: header
      required: false
      description: Correlation identifier used for distributed tracing and support diagnostics.
      schema:
        type: string
        minLength: 8
        maxLength: 128
```

Usage:

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      parameters:
        - $ref: '#/components/parameters/Page'
        - $ref: '#/components/parameters/Size'
        - $ref: '#/components/parameters/CorrelationId'
```

Reuse is good when the semantics are truly shared.

Do not reuse parameters just because they have the same name.

Example problem:

```yaml
components:
  parameters:
    Status:
      name: status
      in: query
      schema:
        type: string
```

This may be too generic. Case status, user status, payment status, and investigation status may not have the same values or semantics.

Better:

```yaml
components:
  parameters:
    CaseStatusFilter:
      name: status
      in: query
      description: Filter cases by lifecycle status.
      schema:
        type: array
        items:
          $ref: '#/components/schemas/CaseStatus'
      style: form
      explode: true
```

---

## 22. Java/Spring Binding Implications

OpenAPI contract and Java binding must agree.

### 22.1 Repeated Query Parameters

Wire:

```http
GET /cases?status=OPEN&status=CLOSED
```

OpenAPI:

```yaml
- name: status
  in: query
  schema:
    type: array
    items:
      type: string
  style: form
  explode: true
```

Spring MVC:

```java
@GetMapping("/cases")
public List<CaseSummary> listCases(
    @RequestParam(required = false) List<String> status
) {
    ...
}
```

This is usually straightforward.

### 22.2 Comma-Separated Query Parameters

Wire:

```http
GET /cases?status=OPEN,CLOSED
```

OpenAPI:

```yaml
style: form
explode: false
```

Spring binding may or may not behave exactly as intended depending on conversion setup and parameter type.

You must verify with tests.

Recommended test:

```java
mockMvc.perform(get("/cases")
        .queryParam("status", "OPEN,CLOSED"))
    .andExpect(status().isOk());
```

And assert the actual parsed values inside your controller/application boundary.

### 22.3 Missing vs Empty Query Parameters

Consider:

```http
GET /cases
GET /cases?status=
GET /cases?status=OPEN
```

These are not necessarily equivalent.

Your contract should define whether empty values are allowed.

Example stricter schema:

```yaml
- name: status
  in: query
  schema:
    type: array
    minItems: 1
    items:
      type: string
      minLength: 1
      enum: [OPEN, CLOSED]
  style: form
  explode: true
```

Still, some validators/frameworks may parse empty strings before schema validation. Test actual behavior.

### 22.4 Primitive vs Boxed Types

Bad Java signature:

```java
public List<CaseSummary> listCases(@RequestParam int page) {
    ...
}
```

If `page` is absent, primitive `int` creates awkward defaults or binding failures.

Better:

```java
public List<CaseSummary> listCases(
    @RequestParam(defaultValue = "0") int page
) {
    ...
}
```

or:

```java
public List<CaseSummary> listCases(
    @RequestParam(required = false) Integer page
) {
    int effectivePage = page == null ? 0 : page;
}
```

OpenAPI should match:

```yaml
- name: page
  in: query
  required: false
  schema:
    type: integer
    minimum: 0
    default: 0
```

### 22.5 Enum Binding

OpenAPI:

```yaml
schema:
  type: string
  enum: [OPEN, CLOSED]
```

Java:

```java
enum CaseStatus {
    OPEN,
    CLOSED
}
```

Be careful with:

1. case sensitivity,
2. unknown enum values,
3. enum evolution,
4. generated clients,
5. custom Jackson naming strategies.

If the server accepts lowercase but OpenAPI says uppercase, the contract and implementation disagree.

---

## 23. Generated Client Implications

Generated clients use parameter definitions to construct requests.

A small contract difference changes generated code behavior.

Example A:

```yaml
style: form
explode: true
```

Generated request:

```http
?status=OPEN&status=CLOSED
```

Example B:

```yaml
style: form
explode: false
```

Generated request:

```http
?status=OPEN,CLOSED
```

If backend only supports one, the other breaks.

Therefore:

```text
Parameter serialization is part of compatibility.
```

Changing `explode` is not a cosmetic spec change. It can be a breaking change.

---

## 24. Compatibility Rules for Parameter Changes

Parameter changes can be breaking or non-breaking depending on direction.

### 24.1 Usually Non-Breaking

Adding an optional query parameter:

```yaml
- name: priority
  in: query
  required: false
```

Usually safe, assuming existing behavior remains unchanged when omitted.

Adding documentation to a parameter:

```yaml
description: Filter by case priority.
```

Safe.

Adding examples:

```yaml
example: HIGH
```

Safe.

### 24.2 Usually Breaking

Making an optional parameter required:

```diff
- required: false
+ required: true
```

Breaking.

Changing parameter name:

```diff
- name: status
+ name: caseStatus
```

Breaking.

Changing parameter location:

```diff
- in: query
+ in: header
```

Breaking.

Changing serialization:

```diff
- explode: true
+ explode: false
```

Breaking for generated clients and consumers.

Tightening constraints:

```diff
- maximum: 1000
+ maximum: 100
```

Potentially breaking.

Removing enum value:

```diff
- enum: [OPEN, CLOSED, ARCHIVED]
+ enum: [OPEN, CLOSED]
```

Breaking.

Changing default behavior:

```diff
- default sort: -createdAt
+ default sort: priority
```

Semantically breaking, even if schema does not change.

### 24.3 Subtle Breaking Changes

Changing optional parameter meaning:

```text
includeClosed=false used to mean active only
includeClosed=false now means active plus archived but not closed
```

This may not show in schema diff, but it is still a contract change.

Changing parsing leniency:

```text
Previously accepted status=open
Now accepts only status=OPEN
```

Potentially breaking.

Changing array parsing:

```text
Previously accepted ?status=OPEN,CLOSED
Now accepts only ?status=OPEN&status=CLOSED
```

Breaking.

---

## 25. Parameter Examples

Examples are not decoration. They clarify wire format.

### 25.1 Array Parameter Example

```yaml
- name: status
  in: query
  description: Filter by one or more statuses.
  schema:
    type: array
    items:
      type: string
      enum: [OPEN, UNDER_REVIEW, CLOSED]
  style: form
  explode: true
  examples:
    oneStatus:
      summary: One status
      value: [OPEN]
    multipleStatuses:
      summary: Multiple statuses
      value: [OPEN, UNDER_REVIEW]
```

Some documentation tools show schema-level values but not full wire representation. Add description when necessary:

```yaml
description: |
  Filter by one or more statuses.
  Serialized as repeated query parameters, for example:
  `?status=OPEN&status=UNDER_REVIEW`.
```

### 25.2 Cursor Example

```yaml
- name: cursor
  in: query
  required: false
  description: |
    Opaque pagination cursor returned by the previous response.
    Clients must not parse or construct this value.
  schema:
    type: string
  example: eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTIwVDEwOjAwOjAwWiIsImlkIjoiQ0FTRS0wMDAwMTIzNCJ9
```

### 25.3 Header Example

```yaml
- name: X-Correlation-Id
  in: header
  required: false
  description: Client-supplied correlation ID for diagnostics.
  schema:
    type: string
  example: req-20260620-8f2a1c
```

---

## 26. `schema` vs `content` in Parameters

Most parameters use `schema`.

But OpenAPI also allows parameter content for more complex media-type-based representations.

Example:

```yaml
- name: filter
  in: query
  required: false
  content:
    application/json:
      schema:
        type: object
        properties:
          status:
            type: string
          priority:
            type: string
```

Possible wire:

```http
GET /cases?filter={"status":"OPEN","priority":"HIGH"}
```

This is powerful but often not the best choice.

Problems:

1. URL encoding becomes ugly,
2. generated client support varies,
3. caching/logging/debugging are harder,
4. query length limits become relevant,
5. many API consumers dislike JSON-in-query.

Recommendation:

```text
Prefer normal query parameters for simple filters.
Use request body for complex commands.
Use JSON-in-query only when there is a strong reason and tooling supports it.
```

---

## 27. Parameter Documentation Quality

A good parameter description answers:

1. What does this parameter mean?
2. What happens when it is omitted?
3. What values are allowed?
4. What serialization format is used?
5. Is it case-sensitive?
6. Is it stable?
7. Does it affect caching?
8. Does it affect authorization?
9. Is it deprecated?
10. What errors occur when invalid?

Weak:

```yaml
- name: status
  in: query
  description: Status.
```

Strong:

```yaml
- name: status
  in: query
  description: |
    Filters cases by lifecycle status.
    May be supplied multiple times, for example `?status=OPEN&status=UNDER_REVIEW`.
    When omitted, cases in all non-archived statuses are returned.
  schema:
    type: array
    items:
      $ref: '#/components/schemas/CaseStatus'
  style: form
  explode: true
```

This is not verbosity for its own sake. It prevents integration ambiguity.

---

## 28. Common Parameter Anti-Patterns

### 28.1 Undocumented Array Serialization

Bad:

```yaml
- name: ids
  in: query
  schema:
    type: array
    items:
      type: string
```

Better:

```yaml
- name: ids
  in: query
  schema:
    type: array
    items:
      type: string
  style: form
  explode: true
```

### 28.2 Boolean Flags That Accumulate

Bad:

```http
GET /cases?includeClosed=true&includeArchived=false&includeDeleted=false&onlyMine=true&withEvidence=true
```

This may become hard to reason about.

Better options:

1. explicit filter parameters,
2. enum view modes,
3. separate endpoints if semantics differ strongly,
4. documented filter object.

Example:

```yaml
- name: visibility
  in: query
  schema:
    type: string
    enum: [active, activeAndClosed, allVisible]
```

### 28.3 Magic String Parameters

Bad:

```yaml
- name: mode
  in: query
  schema:
    type: string
```

with hidden accepted values:

```text
fast
full
debug
compact
legacy
```

Better:

```yaml
- name: mode
  in: query
  schema:
    type: string
    enum: [summary, detail]
```

### 28.4 Header Abuse

Bad:

```http
X-Case-Status: OPEN
X-Case-Priority: HIGH
```

Better:

```http
GET /cases?status=OPEN&priority=HIGH
```

### 28.5 Query Language Without Grammar

Bad:

```yaml
- name: filter
  in: query
  schema:
    type: string
```

Better:

```yaml
description: |
  Filter expression using the documented case filter grammar.
  Grammar:
    expression = condition *(" and " condition)
    condition = field operator value
  Supported fields: status, priority, assignedTo, createdAt.
  Supported operators: eq, ne, in, gt, gte, lt, lte.
```

Or avoid the query language entirely.

### 28.6 Inconsistent Pagination Names

Bad across APIs:

```text
/cases?page=0&size=20
/users?pageNumber=1&pageSize=20
/tasks?offset=0&limit=20
/reports?start=0&count=20
```

Unless there is a reason, standardize.

### 28.7 Optional Parameter With Hidden Mandatory Dependency

Bad:

```yaml
- name: startDate
  in: query
  required: false
- name: endDate
  in: query
  required: false
```

But backend requires both or neither.

Better:

```yaml
description: |
  Start date of the date range. Must be supplied together with `endDate`.
```

And document error response for missing counterpart.

OpenAPI schema alone may not express all cross-parameter constraints. The description and validation behavior matter.

---

## 29. Cross-Parameter Constraints

OpenAPI parameters are individually described. Some constraints involve relationships between parameters.

Examples:

```text
startDate requires endDate
cursor cannot be combined with page
sort field must be compatible with filter mode
include=evidence requires permission
from/to date range cannot exceed 90 days
```

OpenAPI may not fully enforce these relationships at the parameter object level.

Therefore document them clearly.

Example:

```yaml
- name: cursor
  in: query
  required: false
  description: |
    Opaque cursor for cursor-based pagination.
    Must not be combined with `page` or `offset` parameters.
  schema:
    type: string
```

Also document error behavior:

```yaml
responses:
  '400':
    description: Invalid query parameter combination.
```

For top-tier API contracts, include examples of invalid combinations in docs or test cases.

---

## 30. Parameter Governance Rules

A mature organization should not allow every service to invent parameter conventions.

Recommended governance rules:

### 30.1 Naming

Use consistent names:

```text
page
size
cursor
limit
sort
filter
include
fields
locale
```

Avoid synonyms unless intentionally distinct:

```text
pageSize
perPage
count
max
limit
size
```

### 30.2 Array Serialization

Pick a default for query arrays.

Recommended for many Java/Spring APIs:

```yaml
style: form
explode: true
```

Wire:

```http
?status=OPEN&status=CLOSED
```

### 30.3 Pagination

Standardize page/size or cursor/limit.

Do not mix without reason.

### 30.4 Sorting

Standardize syntax.

Example:

```http
?sort=-createdAt&sort=priority
```

### 30.5 Headers

Standardize common headers:

```text
X-Correlation-Id or traceparent
Idempotency-Key
If-Match
Prefer
```

Prefer standards where applicable.

### 30.6 Required Parameter Policy

Adding required parameters to existing operations should trigger breaking-change review.

### 30.7 Constraints

All numeric parameters should have bounds where possible.

Bad:

```yaml
size:
  type: integer
```

Better:

```yaml
size:
  type: integer
  minimum: 1
  maximum: 100
  default: 20
```

### 30.8 Descriptions

Descriptions should explain omission behavior and non-obvious semantics.

---

## 31. Practical Review Checklist

Use this checklist during OpenAPI review.

### Location

- Is each parameter in the correct location?
- Is business filtering in query, not headers?
- Are path parameters truly resource identifiers?
- Are cookies used only when browser/session semantics require them?

### Requiredness

- Are all path parameters required?
- Are optional parameters' omitted behavior documented?
- Are required query/header parameters really necessary?

### Schema

- Is type specified?
- Are constraints specified?
- Are enums explicit?
- Are numeric bounds present?
- Are string formats/patterns used when useful?

### Serialization

- Are array/object parameters explicit about `style` and `explode`?
- Does the documented wire format match Java implementation?
- Do generated clients serialize as expected?
- Are examples consistent with serialization?

### Compatibility

- Would changing this parameter break consumers?
- Is the parameter name stable?
- Is the default behavior stable?
- Are enum values evolvable?

### Documentation

- Does the description explain real semantics?
- Are examples realistic?
- Are invalid combinations documented?
- Are related error responses documented?

### Governance

- Does it follow organization naming standards?
- Does pagination match standard style?
- Does sorting match standard style?
- Does filtering match standard style?

---

## 32. End-to-End Example: List Cases

Below is a production-quality parameter section for a list endpoint.

```yaml
openapi: 3.2.0
info:
  title: Case Management API
  version: 1.0.0
paths:
  /cases:
    get:
      operationId: listCases
      summary: List cases visible to the caller
      description: |
        Returns cases visible to the authenticated caller.
        Results are sorted by creation time descending by default.
      parameters:
        - name: status
          in: query
          required: false
          description: |
            Filters cases by lifecycle status.
            May be supplied multiple times, for example `?status=OPEN&status=UNDER_REVIEW`.
            When omitted, all non-archived statuses are included.
          schema:
            type: array
            items:
              $ref: '#/components/schemas/CaseStatus'
            minItems: 1
          style: form
          explode: true

        - name: priority
          in: query
          required: false
          description: Filters cases by priority.
          schema:
            $ref: '#/components/schemas/CasePriority'

        - name: assignedTo
          in: query
          required: false
          description: Filters cases assigned to the specified user identifier.
          schema:
            type: string
            minLength: 1
            maxLength: 64

        - name: createdFrom
          in: query
          required: false
          description: |
            Includes cases created at or after this timestamp.
            Must be supplied together with `createdTo` when a bounded date range is required by policy.
          schema:
            type: string
            format: date-time

        - name: createdTo
          in: query
          required: false
          description: Includes cases created before this timestamp.
          schema:
            type: string
            format: date-time

        - name: sort
          in: query
          required: false
          description: |
            Sort order. Prefix with '-' for descending order.
            May be supplied multiple times for multi-field sorting.
            Default is `-createdAt`.
          schema:
            type: array
            items:
              type: string
              enum:
                - createdAt
                - -createdAt
                - updatedAt
                - -updatedAt
                - priority
                - -priority
            default: [-createdAt]
          style: form
          explode: true

        - name: page
          in: query
          required: false
          description: Zero-based page index.
          schema:
            type: integer
            minimum: 0
            default: 0

        - name: size
          in: query
          required: false
          description: Number of items per page.
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20

        - name: include
          in: query
          required: false
          description: Related resources to include in each case summary.
          schema:
            type: array
            items:
              type: string
              enum: [subject, assignedOfficer, latestDecision]
          style: form
          explode: true

        - name: X-Correlation-Id
          in: header
          required: false
          description: Client-supplied correlation identifier for diagnostics.
          schema:
            type: string
            minLength: 8
            maxLength: 128

      responses:
        '200':
          description: Cases matching the supplied filters.
        '400':
          description: Invalid query parameter or unsupported parameter combination.
components:
  schemas:
    CaseStatus:
      type: string
      enum: [OPEN, UNDER_REVIEW, ESCALATED, CLOSED]
    CasePriority:
      type: string
      enum: [LOW, MEDIUM, HIGH, CRITICAL]
```

Notice what this contract makes explicit:

1. repeated query array serialization,
2. omitted filter behavior,
3. pagination bounds,
4. default sorting,
5. include semantics,
6. diagnostic header,
7. invalid parameter response.

This is much better than a raw controller signature dumped into OpenAPI.

---

## 33. End-to-End Example: Escalate Case Command

```yaml
paths:
  /cases/{caseId}/escalations:
    post:
      operationId: escalateCase
      summary: Escalate a case for senior review
      parameters:
        - name: caseId
          in: path
          required: true
          description: Stable identifier of the case to escalate.
          schema:
            type: string
            pattern: '^CASE-[0-9]{8}$'

        - name: Idempotency-Key
          in: header
          required: true
          description: |
            Client-generated idempotency key.
            Reusing the same key with the same request body returns the original result.
            Reusing the same key with a different request body returns 409 Conflict.
          schema:
            type: string
            minLength: 8
            maxLength: 128

        - name: If-Match
          in: header
          required: true
          description: |
            Entity tag of the case version the client intends to escalate.
            If the case has changed, the server returns 412 Precondition Failed.
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [reason, targetQueue]
              properties:
                reason:
                  type: string
                  minLength: 10
                  maxLength: 2000
                targetQueue:
                  type: string
                  enum: [senior-review, legal-review, emergency-review]
      responses:
        '201':
          description: Escalation created.
        '409':
          description: Idempotency key conflict or invalid state transition.
        '412':
          description: Case version precondition failed.
```

Notice the split:

```text
caseId:
  path parameter because it identifies target resource

Idempotency-Key:
  header parameter because it controls retry semantics

If-Match:
  header parameter because it controls concurrency semantics

reason/targetQueue:
  request body because they are command payload
```

That is the kind of distinction top engineers make naturally.

---

## 34. How to Think Like a Top 1% Engineer

A beginner asks:

```text
How do I document this query param?
```

A stronger engineer asks:

```text
How will clients serialize this value?
How will the server parse it?
What happens when it is missing?
What values are valid?
Can this change safely later?
Will generated clients behave correctly?
Will this work through gateways and proxies?
Will QA know how to test invalid cases?
Will support understand logs when this parameter is wrong?
```

A top-tier engineer sees parameters as an API's smallest but most common contract surface.

Most requests have parameters. Most integrations touch them. Most generated clients encode them. Most gateway rules inspect them. Most support tickets include them.

So parameter quality has high leverage.

---

## 35. Key Takeaways

1. Parameters are not just variables; they are contract inputs outside the request body.
2. OpenAPI parameters can be in `path`, `query`, `header`, or `cookie`.
3. Path parameters identify resources and are always required.
4. Query parameters should model retrieval modifiers such as filtering, pagination, sorting, search, projection, and includes.
5. Header parameters should model metadata and protocol-ish concerns, not ordinary business filters.
6. Cookie parameters are mostly for browser/session-oriented APIs.
7. `schema` defines the logical value.
8. `style` and `explode` define wire serialization.
9. Array/object query parameters should usually declare `style` and `explode` explicitly.
10. Serialization changes can be breaking changes.
11. Optional parameters need documented omission behavior.
12. Numeric parameters need bounds.
13. Enum parameters need evolution thinking.
14. Cross-parameter constraints must be documented even if schema cannot fully express them.
15. Java/Spring binding must be tested against the OpenAPI wire format.
16. Generated clients depend heavily on parameter serialization details.
17. Good parameter descriptions prevent integration ambiguity.
18. Parameter governance prevents every team from inventing incompatible API styles.

---

## 36. Practical Exercises

### Exercise 1 — Fix Ambiguous Parameters

Given:

```yaml
- name: status
  in: query
  schema:
    type: array
    items:
      type: string
```

Improve it by adding:

1. enum values,
2. style,
3. explode,
4. omitted behavior,
5. example.

### Exercise 2 — Design List Parameters

Design parameters for:

```text
GET /investigations
```

Requirements:

1. filter by status,
2. filter by assigned investigator,
3. filter by date range,
4. sort by created date or priority,
5. support cursor pagination,
6. include related subject summary optionally.

### Exercise 3 — Detect Breaking Changes

Classify each change:

1. Add optional query parameter `priority`.
2. Rename `status` to `caseStatus`.
3. Change `status` from repeated query to comma-separated query.
4. Change default sort from `-createdAt` to `priority`.
5. Add new enum value `SUSPENDED`.
6. Make `Idempotency-Key` required.
7. Reduce `size.maximum` from 500 to 100.

### Exercise 4 — Java Binding Verification

Write MockMvc tests proving whether your Spring controller accepts:

```http
?status=OPEN&status=CLOSED
```

and/or:

```http
?status=OPEN,CLOSED
```

Then align the OpenAPI contract accordingly.

---

## 37. Part 005 Completion Marker

You have completed Part 005 if you can:

1. explain all four parameter locations,
2. design path/query/header/cookie parameters intentionally,
3. explain `schema`, `style`, `explode`, and `allowReserved`,
4. model array query parameters without ambiguity,
5. document pagination/filtering/sorting parameters clearly,
6. identify parameter compatibility risks,
7. align OpenAPI parameter definitions with Java/Spring binding behavior,
8. review parameter sections for production-grade quality.

---

## 38. Next Part

Next:

```text
Part 006 — Request Bodies: Media Types, Content Negotiation, Validation, and Semantics
```

Part 006 will move from request input outside the body into request payloads. We will cover JSON, form data, multipart, binary upload, media types, request/response model separation, validation boundaries, PATCH semantics, and why request body design should not mirror database entities.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-004.md">⬅️ OpenAPI Mastery for Java Engineers — Part 004</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-006.md">OpenAPI Mastery for Java Engineers — Part 006 ➡️</a>
</div>
