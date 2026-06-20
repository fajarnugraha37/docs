# OpenAPI Mastery for Java Engineers — Part 018
# Pagination, Filtering, Sorting, Search, and Bulk Operations

> Filename: `learn-openapi-mastery-for-java-engineers-part-018.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `018 / 030`  
> Status: `In Progress`  
> Previous: `Part 017 — Security Schemes: Auth Modelling, OAuth2, JWT, API Keys, and Authorization Boundaries`  
> Next: `Part 019 — Hypermedia, Links, Callbacks, Webhooks, and Asynchronous Interaction Modelling`

---

## 0. Why This Part Matters

Most API examples show a simple endpoint like this:

```http
GET /users
```

Then they add:

```http
GET /users?page=1&size=20
```

That looks easy.

In real production systems, list/search endpoints are often where API contracts become fragile:

- consumers assume ordering that was never documented,
- pagination breaks when records are inserted during traversal,
- filters behave inconsistently across endpoints,
- sorting accepts arbitrary fields and leaks persistence model details,
- search syntax becomes an undocumented mini-language,
- bulk operations produce partial failure but return only a vague `400`,
- idempotency is not modelled,
- generated SDKs produce bad method signatures,
- frontend teams reverse-engineer conventions from examples,
- reporting or reconciliation jobs miss or duplicate records,
- partner integrations depend on incidental behavior.

For a Java engineer, this is especially important because many frameworks make list endpoints deceptively easy:

```java
@GetMapping("/cases")
Page<CaseDto> listCases(Pageable pageable) { ... }
```

That method may work internally, but as an OpenAPI contract it leaves many questions unanswered:

- Is pagination offset-based, page-based, cursor-based, or keyset-based?
- Is ordering stable?
- What happens when data changes between pages?
- Are `page` indexes zero-based or one-based?
- What is the maximum page size?
- Is the total count exact, estimated, or omitted?
- Can consumers sort by any field?
- Are filters AND-ed or OR-ed?
- Are date ranges inclusive or exclusive?
- Can clients request only selected fields?
- How are bulk failures represented?

OpenAPI can describe these decisions clearly, but only if the API designer first understands the contract semantics.

This part teaches how to model **pagination, filtering, sorting, search, and bulk operations as explicit contracts**.

---

## 1. Core Mental Model

A list/search/bulk API is not simply a collection endpoint.

It is a contract over:

1. **Selection** — which records are eligible?
2. **Ordering** — in what deterministic order are they returned?
3. **Windowing** — which slice of the ordered result is returned?
4. **Shape** — what representation is returned?
5. **Continuity** — how does the client continue traversal?
6. **Stability** — what happens while the data changes?
7. **Limits** — what cost boundaries exist?
8. **Failure semantics** — what can fail and how is it represented?

A weak contract says:

```http
GET /cases?page=1&size=20
```

A strong contract says:

```text
Return cases visible to the authenticated user, filtered by optional status and openedAt range,
ordered by openedAt descending and id descending as a stable tie-breaker, using cursor-based
pagination. The server returns at most 100 items. The `nextCursor` represents the next stable
position in that ordered result. Cursor values are opaque and must not be parsed by clients.
```

OpenAPI should capture as much of that as possible structurally, and the remaining semantics should be documented in descriptions, examples, and governance rules.

---

## 2. The Main API Shapes

There are several common operation categories:

| Category | Example | Primary contract risk |
|---|---|---|
| Basic list | `GET /cases` | unstable ordering, vague pagination |
| Filtered list | `GET /cases?status=OPEN` | ambiguous filter semantics |
| Search | `GET /cases/search?q=fraud` | undocumented query grammar |
| Advanced search | `POST /cases/search` | request body complexity |
| Bulk command | `POST /cases:bulkClose` | partial failure, idempotency |
| Bulk fetch | `POST /cases:batchGet` | ordering and missing IDs |
| Bulk mutation | `PATCH /cases` | per-item validation and transaction boundary |
| Export | `POST /cases/export` | async lifecycle, long-running operation |

The first design decision is to identify what kind of operation you are actually modelling.

Do not force everything into `GET /resources`.

---

## 3. Pagination as Contract

Pagination exists because result sets can be large.

But pagination is not just a performance trick. It affects correctness.

A pagination contract defines:

- how the client asks for a slice,
- how the server decides the slice,
- how the server communicates continuation,
- whether the traversal is stable under concurrent changes,
- what cost limits apply,
- whether total count is available.

There are four common families:

1. offset pagination,
2. page-number pagination,
3. cursor pagination,
4. keyset pagination.

They are not interchangeable.

---

## 4. Offset Pagination

Offset pagination uses `offset` and `limit`:

```http
GET /cases?offset=40&limit=20
```

Meaning:

```text
Skip 40 records from the ordered result and return up to 20 records.
```

### 4.1 OpenAPI Example

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      summary: List cases using offset pagination
      parameters:
        - name: offset
          in: query
          required: false
          description: |
            Zero-based number of records to skip before returning results.
            Defaults to 0. Offset pagination is intended for low-churn result sets.
          schema:
            type: integer
            minimum: 0
            default: 0
        - name: limit
          in: query
          required: false
          description: |
            Maximum number of records to return. The server may return fewer records.
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
      responses:
        '200':
          description: A page of cases.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseListPage'
components:
  schemas:
    CaseListPage:
      type: object
      required:
        - items
        - offset
        - limit
        - hasMore
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        offset:
          type: integer
          minimum: 0
        limit:
          type: integer
          minimum: 1
        totalCount:
          type: integer
          minimum: 0
          description: |
            Total number of matching records, if calculated by the server.
            This count may be omitted for expensive queries.
        hasMore:
          type: boolean
```

### 4.2 Strengths

Offset pagination is simple:

- easy to understand,
- easy to implement with SQL `OFFSET`/`LIMIT`,
- easy for admin tables,
- convenient for jumping to page-like positions.

### 4.3 Weaknesses

Offset pagination can be unstable for high-churn data.

Suppose the first request is:

```http
GET /cases?offset=0&limit=20&sort=openedAt:desc
```

Then a new case is inserted at the top.

The next request:

```http
GET /cases?offset=20&limit=20&sort=openedAt:desc
```

may duplicate or skip records because the list shifted.

Offset pagination can also become expensive for large offsets because databases may still need to scan skipped rows.

### 4.4 When Offset Pagination Is Acceptable

Use offset pagination when:

- data is low-churn,
- result sets are small or bounded,
- use case is human browsing,
- exact page number navigation matters,
- performance is acceptable,
- duplicates/skips are tolerable.

Examples:

- admin configuration lists,
- reference data,
- small audit categories,
- static lookup tables.

### 4.5 When Offset Pagination Is Dangerous

Avoid it for:

- event feeds,
- transaction logs,
- enforcement case queues,
- high-volume search results,
- reconciliation jobs,
- partner sync APIs,
- anything where missed records are unacceptable.

---

## 5. Page-Number Pagination

Page-number pagination uses `page` and `size`:

```http
GET /cases?page=3&size=20
```

This is common in Spring because of `Pageable`.

But page-number APIs are ambiguous unless documented carefully.

Questions:

- Is `page=0` the first page or is `page=1`?
- Does `size` mean requested size or actual returned size?
- Is `totalPages` exact?
- What happens if `page` exceeds the last page?
- Does sorting have a stable tie-breaker?

### 5.1 OpenAPI Example

```yaml
parameters:
  - name: page
    in: query
    required: false
    description: |
      Zero-based page index. `0` is the first page.
      Page-number pagination is intended for UI browsing, not reliable synchronization.
    schema:
      type: integer
      minimum: 0
      default: 0
  - name: size
    in: query
    required: false
    description: |
      Requested page size. Maximum allowed value is 100.
    schema:
      type: integer
      minimum: 1
      maximum: 100
      default: 20
```

Response schema:

```yaml
components:
  schemas:
    PagedCaseResponse:
      type: object
      required:
        - items
        - page
        - size
        - hasNext
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        page:
          type: integer
          minimum: 0
          description: Current zero-based page index.
        size:
          type: integer
          minimum: 1
          description: Requested page size.
        returnedCount:
          type: integer
          minimum: 0
          description: Actual number of items returned in this page.
        totalElements:
          type: integer
          minimum: 0
          description: Exact total number of matching elements, when available.
        totalPages:
          type: integer
          minimum: 0
          description: Exact total pages, when totalElements is available.
        hasNext:
          type: boolean
```

### 5.2 Spring Warning

Spring's `Page<T>` and `Pageable` are implementation conveniences, not automatically good external contracts.

A raw Spring page response often leaks implementation details:

```json
{
  "content": [],
  "pageable": {
    "sort": {
      "sorted": true,
      "unsorted": false,
      "empty": false
    },
    "offset": 0,
    "pageNumber": 0,
    "pageSize": 20,
    "paged": true,
    "unpaged": false
  },
  "last": true,
  "totalPages": 1,
  "totalElements": 5,
  "size": 20,
  "number": 0,
  "sort": {},
  "first": true,
  "numberOfElements": 5,
  "empty": false
}
```

This may be acceptable for internal APIs, but for serious API contracts it is usually too framework-shaped.

Prefer an explicit API envelope.

---

## 6. Cursor Pagination

Cursor pagination uses an opaque continuation token:

```http
GET /cases?limit=50
```

Response:

```json
{
  "items": [ ... ],
  "nextCursor": "eyJvcGVuZWRBdCI6IjIwMjYtMDYtMjBUMTA6MTU6MDBaIiwiaWQiOiJDQVNFLS...",
  "hasMore": true
}
```

Next request:

```http
GET /cases?cursor=eyJvcGVuZWRBdCI6IjIwMjYtMDYtMjBUMTA6MTU6MDBaIiwiaWQiOiJDQVNFLS...&limit=50
```

The cursor represents a position in the result set.

The client must treat it as opaque.

### 6.1 OpenAPI Example

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      summary: List cases using cursor pagination
      description: |
        Returns cases visible to the authenticated user using cursor pagination.
        Results are ordered by `openedAt` descending and `id` descending as a stable tie-breaker.
        The `cursor` value is opaque and must not be parsed or modified by clients.
      parameters:
        - name: cursor
          in: query
          required: false
          description: |
            Opaque cursor returned from a previous response. Omit for the first page.
          schema:
            type: string
            minLength: 1
        - name: limit
          in: query
          required: false
          description: Maximum number of items to return.
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 50
      responses:
        '200':
          description: A cursor-paginated page of cases.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CursorPageOfCaseSummary'
components:
  schemas:
    CursorPageOfCaseSummary:
      type: object
      required:
        - items
        - hasMore
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        nextCursor:
          type: string
          description: |
            Opaque cursor to retrieve the next page. Absent when there are no more results.
        hasMore:
          type: boolean
          description: Whether another page may be available.
```

### 6.2 Cursor Contract Rules

A good cursor contract states:

- cursor is opaque,
- cursor may expire,
- cursor is bound to the original filter/sort context,
- changing filters while reusing a cursor is invalid,
- order is stable and documented,
- max page size is bounded,
- missing `nextCursor` means traversal is complete,
- server may return fewer than `limit`,
- invalid cursor returns a specific error.

### 6.3 Invalid Cursor Error

```yaml
components:
  schemas:
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
        code:
          type: string

paths:
  /cases:
    get:
      responses:
        '400':
          description: Invalid request parameters or cursor.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
              examples:
                invalidCursor:
                  summary: Cursor is invalid or expired
                  value:
                    type: "https://api.example.com/problems/invalid-cursor"
                    title: "Invalid cursor"
                    status: 400
                    detail: "The supplied cursor is invalid, expired, or incompatible with the current filters."
                    code: "INVALID_CURSOR"
```

### 6.4 Cursor Pagination Strengths

Cursor pagination is good for:

- feeds,
- high-churn data,
- infinite scroll,
- synchronization,
- large datasets,
- stable traversal without expensive offsets.

### 6.5 Cursor Pagination Weaknesses

Cursor pagination is less good for:

- jumping to arbitrary page numbers,
- displaying `Page 5 of 100`,
- ad-hoc SQL-like browsing,
- clients that need random access into the result set.

---

## 7. Keyset Pagination

Keyset pagination is closely related to cursor pagination, but the position is expressed using ordered key values.

Example:

```http
GET /cases?openedBefore=2026-06-20T10:15:00Z&idBefore=CASE-123&limit=50
```

This means:

```text
Return the next items after the tuple `(openedAt, id)` in the documented sort order.
```

### 7.1 Public Keyset Parameters

```yaml
parameters:
  - name: openedBefore
    in: query
    required: false
    schema:
      type: string
      format: date-time
  - name: idBefore
    in: query
    required: false
    schema:
      type: string
```

### 7.2 Opaque Cursor Usually Preferred

For public or partner APIs, opaque cursor is usually better than exposing keyset internals.

Why?

- You can change internal ordering later.
- You avoid teaching clients persistence details.
- You prevent clients from forging arbitrary traversal states.
- You can encode filter/sort context.
- You can include cursor versioning.

Keyset pagination is an implementation strategy; cursor pagination is often the better external contract.

---

## 8. Ordering Must Be Stable

Pagination without deterministic ordering is broken.

Bad:

```text
Return cases ordered by openedAt descending.
```

If many cases have the same `openedAt`, their relative order may change.

Better:

```text
Return cases ordered by openedAt descending, then id descending as a stable tie-breaker.
```

OpenAPI can document this in the operation description:

```yaml
description: |
  Results are ordered by `openedAt` descending and `id` descending as a stable tie-breaker.
  Consumers must not assume any other ordering.
```

For sorting APIs, tie-breakers should be documented too.

---

## 9. Total Count: Useful but Expensive

Many APIs include:

```json
{
  "totalCount": 123456
}
```

This is convenient for UI pagination, but it can be expensive or misleading.

Questions:

- Is it exact?
- Is it approximate?
- Is it calculated at query time?
- Is it capped?
- Is it omitted for large queries?
- Does it reflect authorization filtering?
- Does it change between pages?

### 9.1 Exact Count Contract

```yaml
totalCount:
  type: integer
  minimum: 0
  description: |
    Exact number of records matching the current filters at the time this page was produced.
```

### 9.2 Optional Count Contract

```yaml
totalCount:
  type: integer
  minimum: 0
  description: |
    Total number of matching records when the server chooses to calculate it.
    This field may be absent for expensive queries.
```

### 9.3 Approximate Count Contract

```yaml
estimatedTotalCount:
  type: integer
  minimum: 0
  description: |
    Approximate number of matching records. This value is intended for UI display only
    and must not be used for reconciliation or billing.
```

### 9.4 Top 1% Rule

Do not include `totalCount` casually.

If you include it, document its accuracy and cost semantics.

---

## 10. List Envelope Design

A list endpoint should usually return an envelope, not a bare array.

Bare array:

```json
[
  { "id": "CASE-1" },
  { "id": "CASE-2" }
]
```

Envelope:

```json
{
  "items": [
    { "id": "CASE-1" },
    { "id": "CASE-2" }
  ],
  "nextCursor": "abc",
  "hasMore": true
}
```

### 10.1 Why Envelope Is Better

An envelope allows:

- pagination metadata,
- links,
- warnings,
- total count,
- request echo,
- sorting metadata,
- partial result metadata,
- future extension.

### 10.2 Bare Arrays Are Hard to Evolve

If you start with:

```json
[]
```

and later need:

```json
{
  "items": [],
  "nextCursor": "..."
}
```

that is a breaking response shape change.

Prefer envelopes from the start for list/search APIs.

---

## 11. Filtering Patterns

Filtering answers:

```text
Which records should be included?
```

There are several levels of complexity.

---

## 12. Simple Query Filters

Example:

```http
GET /cases?status=OPEN&priority=HIGH
```

OpenAPI:

```yaml
parameters:
  - name: status
    in: query
    required: false
    schema:
      type: string
      enum:
        - OPEN
        - UNDER_REVIEW
        - CLOSED
  - name: priority
    in: query
    required: false
    schema:
      type: string
      enum:
        - LOW
        - MEDIUM
        - HIGH
```

### 12.1 Filter Combination Semantics

Always document whether filters are combined with AND or OR.

```yaml
description: |
  Filters are combined using logical AND. For example,
  `status=OPEN&priority=HIGH` returns cases that are both open and high priority.
```

Without this, clients may guess.

---

## 13. Repeated Query Parameters

For multi-value filters:

```http
GET /cases?status=OPEN&status=UNDER_REVIEW
```

OpenAPI:

```yaml
parameters:
  - name: status
    in: query
    required: false
    description: |
      Filter by one or more case statuses. When multiple statuses are supplied,
      cases matching any supplied status are returned.
    style: form
    explode: true
    schema:
      type: array
      items:
        type: string
        enum:
          - OPEN
          - UNDER_REVIEW
          - CLOSED
      uniqueItems: true
```

This means repeated query params with `explode: true`.

### 13.1 Alternative: Comma-Separated Values

```http
GET /cases?status=OPEN,UNDER_REVIEW
```

OpenAPI:

```yaml
parameters:
  - name: status
    in: query
    required: false
    style: form
    explode: false
    schema:
      type: array
      items:
        type: string
        enum:
          - OPEN
          - UNDER_REVIEW
          - CLOSED
```

Both are valid design choices.

But do not leave the serialization implicit.

### 13.2 Recommendation

For public APIs, repeated params are often clearer:

```http
?status=OPEN&status=UNDER_REVIEW
```

For internal APIs, comma-separated values are often convenient.

The important part is consistency.

---

## 14. Range Filters

Date/time and numeric ranges need explicit boundary semantics.

Bad:

```http
GET /cases?from=2026-01-01&to=2026-02-01
```

Better:

```http
GET /cases?openedAtFrom=2026-01-01T00:00:00Z&openedAtTo=2026-02-01T00:00:00Z
```

Document:

```text
`openedAtFrom` is inclusive. `openedAtTo` is exclusive.
```

OpenAPI:

```yaml
parameters:
  - name: openedAtFrom
    in: query
    required: false
    description: Inclusive lower bound for case opening timestamp.
    schema:
      type: string
      format: date-time
  - name: openedAtTo
    in: query
    required: false
    description: Exclusive upper bound for case opening timestamp.
    schema:
      type: string
      format: date-time
```

### 14.1 Why Exclusive Upper Bound Is Often Better

Use:

```text
[from, to)
```

rather than:

```text
[from, to]
```

Because exclusive upper bounds avoid precision problems:

```text
2026-02-01T00:00:00Z
```

cleanly represents the start of February.

Inclusive end dates often lead to hacks like:

```text
2026-01-31T23:59:59.999Z
```

which break when precision changes.

---

## 15. Boolean Filters

Boolean filters can be ambiguous.

Example:

```http
GET /cases?overdue=false
```

Does absence mean false?

Usually no.

There are three states:

1. filter absent — do not filter by overdue,
2. `overdue=true` — only overdue,
3. `overdue=false` — only not overdue.

OpenAPI:

```yaml
parameters:
  - name: overdue
    in: query
    required: false
    description: |
      When omitted, both overdue and non-overdue cases are returned.
      When true, only overdue cases are returned.
      When false, only non-overdue cases are returned.
    schema:
      type: boolean
```

Do not treat absent boolean as false unless explicitly documented.

---

## 16. Null and Missing Filters

Filtering for missing fields is tricky.

Bad ambiguous API:

```http
GET /cases?assignedTo=null
```

Better:

```http
GET /cases?assignmentStatus=UNASSIGNED
```

Or:

```http
GET /cases?assigned=false
```

OpenAPI:

```yaml
parameters:
  - name: assignmentStatus
    in: query
    required: false
    schema:
      type: string
      enum:
        - ASSIGNED
        - UNASSIGNED
```

Prefer semantic filters over pseudo-null strings.

---

## 17. Deep Object Filters

OpenAPI supports `deepObject` for query object-style parameters.

Example:

```http
GET /cases?filter[status]=OPEN&filter[priority]=HIGH
```

OpenAPI:

```yaml
parameters:
  - name: filter
    in: query
    required: false
    style: deepObject
    explode: true
    schema:
      type: object
      properties:
        status:
          type: string
          enum: [OPEN, UNDER_REVIEW, CLOSED]
        priority:
          type: string
          enum: [LOW, MEDIUM, HIGH]
```

### 17.1 When Deep Object Helps

It can help when:

- filters are grouped,
- many filters exist,
- you want to avoid cluttering top-level query params,
- frontend frameworks naturally encode nested query objects.

### 17.2 When Deep Object Hurts

It can hurt because:

- not all clients encode it consistently,
- generated SDK support may vary,
- documentation UIs may render it poorly,
- server binding may need custom parsing.

For broad public APIs, simple explicit query params are often more interoperable.

---

## 18. Search Endpoints

Filtering and search are different.

Filtering usually applies exact structured conditions:

```http
GET /cases?status=OPEN&priority=HIGH
```

Search often uses relevance, text, fuzzy matching, or more flexible criteria:

```http
GET /cases/search?q=license fraud
```

### 18.1 GET Search

Use GET when:

- criteria are simple,
- request is safe and idempotent,
- query fits URL limits,
- results can be cached/bookmarked,
- criteria are not sensitive.

Example:

```yaml
paths:
  /cases/search:
    get:
      operationId: searchCases
      summary: Search cases by text query
      parameters:
        - name: q
          in: query
          required: true
          description: |
            Search query. The server may match case ID, subject name, allegation text,
            or other indexed fields according to the documented search behavior.
          schema:
            type: string
            minLength: 2
            maxLength: 200
        - name: cursor
          in: query
          required: false
          schema:
            type: string
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 50
            default: 20
      responses:
        '200':
          description: Search results.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseSearchResultPage'
```

### 18.2 POST Search

Use POST when:

- criteria are complex,
- URL would be too long,
- nested boolean logic is needed,
- search criteria include sensitive data,
- request body is more expressive,
- you need a stable schema for advanced search.

Example:

```yaml
paths:
  /case-searches:
    post:
      operationId: searchCasesAdvanced
      summary: Search cases using structured criteria
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CaseSearchRequest'
      responses:
        '200':
          description: Search results.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseSearchResultPage'
components:
  schemas:
    CaseSearchRequest:
      type: object
      properties:
        text:
          type: string
          minLength: 2
          maxLength: 200
        statuses:
          type: array
          items:
            type: string
            enum: [OPEN, UNDER_REVIEW, CLOSED]
          uniqueItems: true
        openedAt:
          $ref: '#/components/schemas/DateTimeRange'
        assignedToUserIds:
          type: array
          items:
            type: string
          maxItems: 50
        limit:
          type: integer
          minimum: 1
          maximum: 50
          default: 20
        cursor:
          type: string
```

### 18.3 Is POST Search RESTful?

Yes, it can be acceptable.

A POST search operation can still be safe in behavior, even if HTTP does not classify POST as safe by method semantics. The important point is to document behavior clearly and avoid pretending it creates a persisted resource unless it actually does.

Alternative pattern:

```http
POST /case-searches
```

could create a search job/resource for expensive searches.

Then:

```http
GET /case-searches/{searchId}/results
```

That is useful for long-running searches and exports.

---

## 19. Search Query Grammar

If `q` supports advanced syntax, document it.

Bad:

```text
q: Search query.
```

Better:

```yaml
parameters:
  - name: q
    in: query
    required: true
    description: |
      Search query. Supports plain text terms and quoted phrases.
      Operators such as `AND`, `OR`, field-specific syntax, wildcards, and negation
      are not supported. The server performs case-insensitive token matching.
    schema:
      type: string
      minLength: 2
      maxLength: 200
```

Or, if you do support syntax:

```yaml
description: |
  Search query using the case search syntax:

  - `license fraud` searches for both terms using default relevance ranking.
  - `"license fraud"` searches for the phrase.
  - `subject:john` searches subject fields.
  - `-closed` excludes closed cases.

  Unsupported syntax returns `400` with code `INVALID_SEARCH_QUERY`.
```

### 19.1 Avoid Accidental Search DSLs

A common failure mode:

1. API starts with simple `q`.
2. Frontend asks for `status:open`.
3. Partner asks for `created>2024-01-01`.
4. Search syntax grows informally.
5. Nobody has a grammar.
6. Compatibility becomes impossible.

If search syntax is complex, define it as a versioned contract.

---

## 20. Sorting

Sorting answers:

```text
In what order should eligible records be returned?
```

Sorting is deceptively dangerous because it can leak persistence model details.

Bad:

```http
GET /cases?sort=created_at
```

Better:

```http
GET /cases?sort=openedAt:desc
```

### 20.1 Single Sort Parameter

```yaml
parameters:
  - name: sort
    in: query
    required: false
    description: |
      Sort order. Supported values:

      - `openedAt:desc` newest opened cases first
      - `openedAt:asc` oldest opened cases first
      - `priority:desc` highest priority first

      If omitted, defaults to `openedAt:desc`.
      Results always include `id:desc` as an implicit stable tie-breaker.
    schema:
      type: string
      enum:
        - openedAt:desc
        - openedAt:asc
        - priority:desc
      default: openedAt:desc
```

This is simple and safe.

### 20.2 Multiple Sort Fields

Option 1: comma-separated:

```http
GET /cases?sort=priority:desc,openedAt:asc
```

OpenAPI:

```yaml
parameters:
  - name: sort
    in: query
    required: false
    description: |
      Comma-separated sort fields. Each item has format `{field}:{direction}`.
      Supported fields are `priority`, `openedAt`, and `id`.
      Supported directions are `asc` and `desc`.
    schema:
      type: string
      pattern: '^[A-Za-z][A-Za-z0-9]*(:(asc|desc))?(,[A-Za-z][A-Za-z0-9]*(:(asc|desc))?)*$'
```

Option 2: repeated parameter:

```http
GET /cases?sort=priority:desc&sort=openedAt:asc
```

OpenAPI:

```yaml
parameters:
  - name: sort
    in: query
    required: false
    style: form
    explode: true
    schema:
      type: array
      items:
        type: string
        enum:
          - priority:desc
          - priority:asc
          - openedAt:desc
          - openedAt:asc
          - id:desc
          - id:asc
      maxItems: 3
```

### 20.3 Sorting Recommendations

Prefer enumerated sort options when possible.

Do not allow arbitrary sort fields unless you intentionally want to expose a query interface.

Why?

- arbitrary sorting may expose internal fields,
- database indexes may not support all fields,
- performance may become unpredictable,
- generated docs are less clear,
- clients may depend on accidental fields.

### 20.4 Sort Stability Rule

Every sortable result should have a stable tie-breaker.

Usually:

```text
id asc/desc
```

Document whether tie-breaker is explicit or implicit.

---

## 21. Field Selection

Field selection lets clients request only certain fields.

Example:

```http
GET /cases?fields=id,status,openedAt
```

OpenAPI:

```yaml
parameters:
  - name: fields
    in: query
    required: false
    description: |
      Comma-separated list of top-level fields to include in each returned case summary.
      If omitted, the default case summary representation is returned.
      Unsupported fields return `400` with code `UNSUPPORTED_FIELD`.
    style: form
    explode: false
    schema:
      type: array
      items:
        type: string
        enum:
          - id
          - status
          - priority
          - openedAt
          - subjectSummary
      uniqueItems: true
```

### 21.1 Field Selection Trade-Off

Benefits:

- reduced payload size,
- better mobile performance,
- consumer-specific efficiency.

Costs:

- more cache variants,
- harder documentation,
- harder authorization checks,
- harder response validation,
- generated SDKs may still model all fields optional,
- client complexity increases.

### 21.2 Strong Recommendation

Use predefined representations before arbitrary fields.

Example:

```http
GET /cases?view=summary
GET /cases?view=detail
```

OpenAPI:

```yaml
parameters:
  - name: view
    in: query
    required: false
    schema:
      type: string
      enum:
        - summary
        - detail
      default: summary
```

This is often better for enterprise APIs.

---

## 22. Include / Expand

Sometimes clients need related data.

Example:

```http
GET /cases/CASE-123?include=subject,latestDecision
```

OpenAPI:

```yaml
parameters:
  - name: include
    in: query
    required: false
    description: |
      Related resources to include in the response. Included resources are returned only
      when the authenticated user is authorized to view them.
    style: form
    explode: false
    schema:
      type: array
      items:
        type: string
        enum:
          - subject
          - latestDecision
          - assignedOfficer
      uniqueItems: true
      maxItems: 3
```

### 22.1 Include Contract Risks

Includes can cause:

- accidental N+1 queries,
- unauthorized nested data exposure,
- response shape explosion,
- cache fragmentation,
- unclear generated models.

Use include/expand only with clear limits.

---

## 23. Bulk Operations

Bulk operations are APIs where one request acts on many items.

Examples:

```http
POST /cases:bulkAssign
POST /cases:bulkClose
POST /cases:batchGet
PATCH /cases
```

Bulk APIs are high-risk because they raise questions about:

- transaction boundary,
- partial success,
- ordering,
- idempotency,
- per-item authorization,
- per-item validation,
- retry safety,
- result correlation.

---

## 24. Bulk Fetch / Batch Get

Example:

```http
POST /cases:batchGet
```

Request:

```json
{
  "ids": ["CASE-001", "CASE-002", "CASE-404"]
}
```

Response:

```json
{
  "items": [
    { "id": "CASE-001", "status": "OPEN" },
    { "id": "CASE-002", "status": "CLOSED" }
  ],
  "missingIds": ["CASE-404"]
}
```

OpenAPI:

```yaml
paths:
  /cases:batchGet:
    post:
      operationId: batchGetCases
      summary: Retrieve multiple cases by ID
      description: |
        Retrieves cases by ID. The response may omit cases that do not exist or that the
        authenticated user is not authorized to view. The response order is not guaranteed;
        clients must correlate results by `id`.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/BatchGetCasesRequest'
      responses:
        '200':
          description: Batch get result.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BatchGetCasesResponse'
components:
  schemas:
    BatchGetCasesRequest:
      type: object
      required:
        - ids
      properties:
        ids:
          type: array
          minItems: 1
          maxItems: 100
          uniqueItems: true
          items:
            type: string
    BatchGetCasesResponse:
      type: object
      required:
        - items
        - missingIds
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        missingIds:
          type: array
          items:
            type: string
          description: |
            IDs not returned because they do not exist or are not visible to the caller.
```

### 24.1 Missing vs Forbidden

For sensitive systems, you may intentionally avoid distinguishing:

- does not exist,
- exists but forbidden.

That prevents enumeration.

Document that choice.

---

## 25. Bulk Mutation Patterns

Bulk mutation example:

```http
POST /cases:bulkAssign
```

Request:

```json
{
  "caseIds": ["CASE-001", "CASE-002"],
  "assigneeUserId": "USER-123",
  "reason": "Rebalancing workload"
}
```

The key design question:

```text
Is the operation atomic across all items, or can individual items succeed/fail independently?
```

---

## 26. Atomic Bulk Operation

Atomic means all-or-nothing.

Either every item is assigned, or none are.

OpenAPI description:

```yaml
description: |
  Assigns all specified cases to a user as one atomic operation.
  If any case cannot be assigned, no cases are assigned and the operation returns an error.
```

Response:

```yaml
responses:
  '204':
    description: All cases were assigned successfully.
  '409':
    description: One or more cases cannot be assigned; no changes were applied.
```

Atomic bulk operation is simpler for clients but harder for servers at scale.

Use it when consistency matters more than throughput.

---

## 27. Partial-Success Bulk Operation

Partial success means each item may independently succeed or fail.

Response:

```json
{
  "results": [
    {
      "caseId": "CASE-001",
      "status": "SUCCEEDED"
    },
    {
      "caseId": "CASE-002",
      "status": "FAILED",
      "error": {
        "code": "CASE_ALREADY_CLOSED",
        "message": "Closed cases cannot be reassigned."
      }
    }
  ]
}
```

OpenAPI:

```yaml
components:
  schemas:
    BulkAssignCasesRequest:
      type: object
      required:
        - caseIds
        - assigneeUserId
        - reason
      properties:
        caseIds:
          type: array
          minItems: 1
          maxItems: 100
          uniqueItems: true
          items:
            type: string
        assigneeUserId:
          type: string
        reason:
          type: string
          minLength: 1
          maxLength: 500
    BulkAssignCasesResponse:
      type: object
      required:
        - results
      properties:
        results:
          type: array
          minItems: 1
          items:
            $ref: '#/components/schemas/BulkAssignCaseResult'
    BulkAssignCaseResult:
      type: object
      required:
        - caseId
        - status
      properties:
        caseId:
          type: string
        status:
          type: string
          enum:
            - SUCCEEDED
            - FAILED
        error:
          $ref: '#/components/schemas/ItemError'
    ItemError:
      type: object
      required:
        - code
        - message
      properties:
        code:
          type: string
        message:
          type: string
```

Operation:

```yaml
paths:
  /cases:bulkAssign:
    post:
      operationId: bulkAssignCases
      summary: Assign multiple cases to a user
      description: |
        Attempts to assign each specified case independently.
        A `200` response means the bulk request was processed, not that every item succeeded.
        Clients must inspect each item result.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/BulkAssignCasesRequest'
      responses:
        '200':
          description: Bulk assignment results.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BulkAssignCasesResponse'
```

### 27.1 Critical Contract Rule

For partial success, `200` means:

```text
The bulk request was processed.
```

It does not mean:

```text
Every item succeeded.
```

Document this explicitly.

---

## 28. Bulk Result Correlation

Each item result must include a stable correlation key.

Bad:

```json
{
  "results": [
    { "status": "SUCCEEDED" },
    { "status": "FAILED" }
  ]
}
```

Better:

```json
{
  "results": [
    { "caseId": "CASE-001", "status": "SUCCEEDED" },
    { "caseId": "CASE-002", "status": "FAILED" }
  ]
}
```

Even if order is preserved, include the ID.

Do not make clients correlate by array position unless there is a strong reason.

---

## 29. Idempotency for Bulk Commands

Bulk mutations often need idempotency.

Example:

```http
POST /cases:bulkAssign
Idempotency-Key: 7b89e7e2-6db1-44c0-88fc-a4a6a6fd91f7
```

OpenAPI:

```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: false
    description: |
      Unique key supplied by the client to make retries safe. When the same key is reused
      with the same request body, the server returns the original result. Reusing the same
      key with a different request body returns `409`.
    schema:
      type: string
      minLength: 8
      maxLength: 200
```

### 29.1 Idempotency Semantics to Document

Document:

- whether idempotency key is required,
- key retention period,
- scope of key uniqueness,
- behavior when body differs,
- behavior after expiration,
- whether response is replayed,
- whether partial results are replayed.

Example:

```yaml
description: |
  Idempotency keys are scoped to the authenticated client and retained for 24 hours.
  Reusing a key with an identical request returns the original response. Reusing a key
  with a different request returns `409 IDEMPOTENCY_KEY_REUSED`.
```

---

## 30. Bulk Limits

Bulk APIs need explicit limits.

```yaml
caseIds:
  type: array
  minItems: 1
  maxItems: 100
  uniqueItems: true
  items:
    type: string
```

Why?

- protects server resources,
- makes client behavior predictable,
- supports validation before execution,
- helps generated SDK users,
- prevents accidental huge requests.

Do not leave bulk size unlimited.

---

## 31. Synchronous vs Asynchronous Bulk Operations

Some bulk operations should not complete synchronously.

If processing can exceed normal request timeout, use async pattern:

```http
POST /case-bulk-assignments
```

Response:

```http
202 Accepted
Location: /case-bulk-assignments/JOB-123
```

Body:

```json
{
  "jobId": "JOB-123",
  "status": "ACCEPTED"
}
```

OpenAPI:

```yaml
paths:
  /case-bulk-assignments:
    post:
      operationId: createCaseBulkAssignment
      summary: Start a bulk case assignment job
      responses:
        '202':
          description: Bulk assignment job accepted.
          headers:
            Location:
              description: URL of the created bulk assignment job.
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BulkAssignmentJobAccepted'
```

Part 019 will go deeper into long-running operations, callbacks, and webhooks.

For now, the rule is simple:

```text
If bulk operation may be long-running, model it as a job/resource, not as a pretending-to-be-fast POST.
```

---

## 32. Status Codes for List/Search/Bulk APIs

### 32.1 List/Search

Common responses:

| Status | Meaning |
|---|---|
| `200` | Request succeeded and result set returned, possibly empty |
| `400` | Invalid parameter, invalid filter, invalid cursor, invalid sort |
| `401` | Authentication required or invalid |
| `403` | Caller not authorized to list/search this collection |
| `422` | Structurally valid but semantically invalid search request |
| `429` | Rate limit exceeded |
| `500` | Unexpected server failure |

Empty result is usually `200` with empty `items`, not `404`.

```json
{
  "items": [],
  "hasMore": false
}
```

### 32.2 Bulk Mutation

Common responses:

| Status | Meaning |
|---|---|
| `200` | Bulk request processed; inspect item results |
| `202` | Bulk request accepted for async processing |
| `204` | Atomic bulk operation succeeded with no body |
| `400` | Invalid request shape |
| `401` | Authentication required |
| `403` | Caller not allowed to perform bulk operation |
| `409` | Conflict, idempotency conflict, state conflict |
| `413` | Payload too large |
| `422` | Semantically invalid command |
| `429` | Rate limit exceeded |

### 32.3 Do Not Use `207 Multi-Status` Casually

`207 Multi-Status` comes from WebDAV contexts. Some APIs use it for partial success, but many generic clients and API consumers do not expect it.

For most JSON HTTP APIs, a `200` response with explicit per-item results is easier to consume.

Use `207` only if your organization has standardized on it and your consumers understand it.

---

## 33. OpenAPI Reusable Components for Pagination

You may want reusable parameters:

```yaml
components:
  parameters:
    Cursor:
      name: cursor
      in: query
      required: false
      description: Opaque cursor returned from a previous response. Omit for the first page.
      schema:
        type: string
        minLength: 1
    Limit:
      name: limit
      in: query
      required: false
      description: Maximum number of items to return.
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 50
```

Use:

```yaml
parameters:
  - $ref: '#/components/parameters/Cursor'
  - $ref: '#/components/parameters/Limit'
```

### 33.1 Reusable Page Envelopes Are Hard

OpenAPI does not have true generics like Java.

You might be tempted to define:

```yaml
Page:
  type: object
  properties:
    items:
      type: array
      items: {}
```

This is weak.

Prefer explicit envelopes:

```yaml
CursorPageOfCaseSummary:
  type: object
  properties:
    items:
      type: array
      items:
        $ref: '#/components/schemas/CaseSummary'
    nextCursor:
      type: string
    hasMore:
      type: boolean
```

Yes, it is more verbose.

But it is clearer for docs, validation, generated clients, and review.

---

## 34. Java/Spring Implementation Considerations

### 34.1 Avoid Exposing `Page<T>` Directly

Do not let framework response objects define your external contract by accident.

Instead:

```java
public record CaseListResponse(
    List<CaseSummaryDto> items,
    String nextCursor,
    boolean hasMore
) {}
```

Controller:

```java
@GetMapping("/cases")
public CaseListResponse listCases(
    @RequestParam(required = false) String cursor,
    @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
    @RequestParam(required = false) List<CaseStatus> status
) {
    return caseQueryService.listCases(cursor, limit, status);
}
```

### 34.2 Keep API Filter Model Separate

Bad:

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {
    Page<CaseEntity> findAll(Specification<CaseEntity> spec, Pageable pageable);
}
```

and exposing all entity fields as filters.

Better:

```java
public record CaseListCriteria(
    Set<CaseStatus> statuses,
    Instant openedAtFrom,
    Instant openedAtTo,
    CaseSort sort,
    int limit,
    Optional<String> cursor
) {}
```

Then map API criteria to persistence queries internally.

### 34.3 Do Not Let Sort Fields Equal Entity Fields

Bad:

```java
Sort.by(request.getParameter("sort"))
```

Better:

```java
enum CaseSortOption {
    OPENED_AT_ASC,
    OPENED_AT_DESC,
    PRIORITY_DESC
}
```

Map each public sort option to known safe query logic.

### 34.4 Validate Before Querying

Validation layers:

1. OpenAPI schema constraints,
2. Bean Validation annotations,
3. application-level semantic validation,
4. repository/query-level safety.

Example:

```java
if (openedAtFrom != null && openedAtTo != null && !openedAtFrom.isBefore(openedAtTo)) {
    throw new InvalidFilterException("openedAtFrom must be before openedAtTo");
}
```

OpenAPI can document this, but schema alone may not express all cross-field constraints.

---

## 35. Case Management Example: Production-Grade List API

### 35.1 Operation

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      tags:
        - Cases
      summary: List cases visible to the authenticated user
      description: |
        Returns cases visible to the authenticated user.

        Filtering:
        - Filters are combined using logical AND.
        - Multiple `status` values are combined using logical OR.
        - `openedAtFrom` is inclusive.
        - `openedAtTo` is exclusive.

        Ordering:
        - Results are ordered by `openedAt` descending and `id` descending by default.
        - `id` is always used as a stable tie-breaker.

        Pagination:
        - Uses cursor pagination.
        - `cursor` is opaque and must not be parsed by clients.
        - The cursor is bound to the original filter and sort context.
      parameters:
        - $ref: '#/components/parameters/CaseStatusFilter'
        - $ref: '#/components/parameters/OpenedAtFrom'
        - $ref: '#/components/parameters/OpenedAtTo'
        - $ref: '#/components/parameters/CaseSort'
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: A page of cases.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseListResponse'
              examples:
                firstPage:
                  summary: First page with continuation
                  value:
                    items:
                      - id: CASE-2026-0001
                        status: OPEN
                        priority: HIGH
                        openedAt: '2026-06-20T09:30:00Z'
                      - id: CASE-2026-0002
                        status: UNDER_REVIEW
                        priority: MEDIUM
                        openedAt: '2026-06-19T15:10:00Z'
                    nextCursor: eyJ2IjoxLCJzb3J0Ijoib3BlbmVkQXQ6ZGVzYyxpZDpkZXNjIn0
                    hasMore: true
        '400':
          description: Invalid filter, sort, cursor, or pagination parameter.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '401':
          description: Authentication required.
        '403':
          description: Caller is not authorized to list cases.
```

### 35.2 Parameters

```yaml
components:
  parameters:
    CaseStatusFilter:
      name: status
      in: query
      required: false
      description: |
        Filter by one or more case statuses. Multiple values are combined using OR.
      style: form
      explode: true
      schema:
        type: array
        uniqueItems: true
        items:
          $ref: '#/components/schemas/CaseStatus'
    OpenedAtFrom:
      name: openedAtFrom
      in: query
      required: false
      description: Inclusive lower bound for case opening timestamp.
      schema:
        type: string
        format: date-time
    OpenedAtTo:
      name: openedAtTo
      in: query
      required: false
      description: Exclusive upper bound for case opening timestamp.
      schema:
        type: string
        format: date-time
    CaseSort:
      name: sort
      in: query
      required: false
      description: |
        Sort order. If omitted, defaults to `openedAt:desc`.
        `id` is always applied as a stable tie-breaker.
      schema:
        type: string
        enum:
          - openedAt:desc
          - openedAt:asc
          - priority:desc
        default: openedAt:desc
    Cursor:
      name: cursor
      in: query
      required: false
      description: Opaque cursor returned from a previous response. Omit for the first page.
      schema:
        type: string
        minLength: 1
    Limit:
      name: limit
      in: query
      required: false
      description: Maximum number of cases to return.
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 50
```

### 35.3 Schemas

```yaml
components:
  schemas:
    CaseListResponse:
      type: object
      required:
        - items
        - hasMore
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        nextCursor:
          type: string
          description: Opaque cursor for the next page. Absent when there are no more results.
        hasMore:
          type: boolean
    CaseSummary:
      type: object
      required:
        - id
        - status
        - priority
        - openedAt
      properties:
        id:
          type: string
          example: CASE-2026-0001
        status:
          $ref: '#/components/schemas/CaseStatus'
        priority:
          type: string
          enum: [LOW, MEDIUM, HIGH]
        openedAt:
          type: string
          format: date-time
    CaseStatus:
      type: string
      enum:
        - OPEN
        - UNDER_REVIEW
        - CLOSED
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
        code:
          type: string
```

This is much stronger than simply exposing:

```yaml
GET /cases
```

with undocumented `page`, `size`, and `sort`.

---

## 36. Case Management Example: Bulk Assignment API

```yaml
paths:
  /cases:bulkAssign:
    post:
      operationId: bulkAssignCases
      tags:
        - Cases
      summary: Assign multiple cases to a user
      description: |
        Attempts to assign each specified case independently.
        A `200` response means the bulk request was processed, not that every item succeeded.
        Clients must inspect each item result.

        Idempotency:
        - Clients may supply `Idempotency-Key` to make retries safe.
        - Keys are scoped to the authenticated client and retained for 24 hours.
        - Reusing a key with a different request body returns `409`.
      parameters:
        - name: Idempotency-Key
          in: header
          required: false
          schema:
            type: string
            minLength: 8
            maxLength: 200
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/BulkAssignCasesRequest'
      responses:
        '200':
          description: Per-case assignment results.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BulkAssignCasesResponse'
        '400':
          description: Invalid request shape.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '409':
          description: Idempotency conflict or request-level state conflict.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
components:
  schemas:
    BulkAssignCasesRequest:
      type: object
      required:
        - caseIds
        - assigneeUserId
        - reason
      properties:
        caseIds:
          type: array
          minItems: 1
          maxItems: 100
          uniqueItems: true
          items:
            type: string
        assigneeUserId:
          type: string
        reason:
          type: string
          minLength: 1
          maxLength: 500
    BulkAssignCasesResponse:
      type: object
      required:
        - results
      properties:
        results:
          type: array
          minItems: 1
          items:
            $ref: '#/components/schemas/BulkAssignCaseResult'
    BulkAssignCaseResult:
      type: object
      required:
        - caseId
        - status
      properties:
        caseId:
          type: string
        status:
          type: string
          enum:
            - SUCCEEDED
            - FAILED
        error:
          $ref: '#/components/schemas/ItemError'
    ItemError:
      type: object
      required:
        - code
        - message
      properties:
        code:
          type: string
          enum:
            - CASE_NOT_FOUND
            - CASE_NOT_ASSIGNABLE
            - ASSIGNEE_NOT_AUTHORIZED
            - CASE_ALREADY_CLOSED
        message:
          type: string
```

---

## 37. Governance Rules for List/Search/Bulk APIs

A strong API style guide should define rules like:

### 37.1 Pagination Rules

1. List endpoints must use an envelope response.
2. Public high-volume list endpoints should prefer cursor pagination.
3. Cursor values must be opaque.
4. All paginated endpoints must document default ordering.
5. All paginated endpoints must use stable tie-breakers.
6. `limit`/`size` must have minimum, maximum, and default values.
7. Empty results must return `200` with empty `items`, not `404`.

### 37.2 Filtering Rules

1. Filter combination semantics must be documented.
2. Multi-value filter serialization must be explicit.
3. Date/time ranges must document inclusive/exclusive boundaries.
4. Boolean filters must distinguish omitted from false.
5. Unsupported filters must return deterministic errors.
6. Public filter names must not leak database column names.

### 37.3 Sorting Rules

1. Supported sort fields must be enumerated or documented.
2. Arbitrary sort fields are disallowed unless approved.
3. Sorting must be stable.
4. Public sort names must not leak persistence field names.
5. Unsupported sort values must return `400` with a standard error code.

### 37.4 Search Rules

1. Search query syntax must be documented.
2. Search query length must be bounded.
3. Complex search should use request body schema.
4. Long-running search/export must use async job pattern.
5. Sensitive search criteria should not be placed in URLs.

### 37.5 Bulk Operation Rules

1. Bulk request size must be bounded.
2. Transaction boundary must be documented.
3. Partial success must use per-item result objects.
4. Per-item results must include correlation IDs.
5. Idempotency behavior must be documented for retryable mutations.
6. Async bulk operations must expose job/status resources.

---

## 38. Common Anti-Patterns

### 38.1 Bare List Response

```yaml
schema:
  type: array
  items:
    $ref: '#/components/schemas/CaseSummary'
```

This is hard to evolve.

Prefer envelope.

---

### 38.2 Undocumented Page Indexing

```http
GET /cases?page=1
```

But nobody knows whether `1` means first page or second page.

Always document.

---

### 38.3 Arbitrary Sort Field

```http
GET /cases?sort=internalRiskScore
```

If the API accepts arbitrary entity fields, consumers may couple themselves to internals.

---

### 38.4 Offset Pagination for Sync

A partner integration loops:

```http
GET /events?offset=0&limit=100
GET /events?offset=100&limit=100
GET /events?offset=200&limit=100
```

Meanwhile new events arrive.

The partner misses records.

Use cursor/keyset/change token pattern instead.

---

### 38.5 Vague Search Query

```yaml
q:
  type: string
  description: Search query.
```

This creates undocumented behavior.

---

### 38.6 Bulk Success Ambiguity

```json
{
  "success": true
}
```

For bulk operations, this is usually useless.

Which items succeeded?

Which failed?

Can the client retry safely?

---

### 38.7 Partial Success Hidden as Error

Returning `400` because one item failed can be misleading if other items succeeded.

Either use atomic all-or-nothing semantics or return per-item results.

---

### 38.8 Leaking Spring `Page<T>`

Returning framework-shaped pagination to external consumers creates noisy, unstable contracts.

---

### 38.9 Unlimited Bulk Request

```yaml
caseIds:
  type: array
  items:
    type: string
```

No `maxItems`.

This is a production incident waiting to happen.

---

## 39. Design Checklist

Before approving a list/search/bulk OpenAPI operation, ask:

### Pagination

- Is the pagination strategy explicit?
- Is ordering deterministic?
- Is there a stable tie-breaker?
- Are page size limits specified?
- Is cursor opacity documented?
- Is invalid cursor behavior documented?
- Is empty result behavior clear?

### Filtering

- Are filter semantics clear?
- Are multi-value filters serialized explicitly?
- Are date/time range boundaries clear?
- Are boolean and missing-value filters unambiguous?
- Are unsupported filters handled consistently?

### Sorting

- Are supported sort fields listed?
- Are sort directions clear?
- Are internal field names hidden?
- Is performance risk bounded?

### Search

- Is search syntax documented?
- Is query length bounded?
- Is GET vs POST justified?
- Are sensitive criteria kept out of URLs when needed?

### Bulk

- Is max item count specified?
- Is transaction boundary clear?
- Is partial success modelled?
- Is result correlation explicit?
- Is idempotency documented?
- Is async job pattern needed?

---

## 40. Practical Exercises

### Exercise 1 — Fix Weak Pagination

Given:

```yaml
/cases:
  get:
    parameters:
      - name: page
        in: query
        schema:
          type: integer
      - name: size
        in: query
        schema:
          type: integer
```

Improve it by adding:

- default values,
- min/max constraints,
- indexing semantics,
- ordering description,
- response envelope,
- error behavior.

### Exercise 2 — Design Cursor Pagination

Design an OpenAPI contract for:

```text
GET /case-events
```

Requirements:

- cursor pagination,
- limit max 500,
- ordered by `occurredAt asc`, `id asc`,
- used by partner synchronization,
- invalid cursor should return problem response.

### Exercise 3 — Filter Semantics

Design filters for:

- status multi-select,
- assigned user,
- opened date range,
- overdue true/false,
- unassigned cases.

Document AND/OR semantics.

### Exercise 4 — Bulk Close Cases

Design:

```http
POST /cases:bulkClose
```

Requirements:

- max 100 cases,
- reason required,
- each case may independently fail,
- idempotency key supported,
- per-item errors include code and message,
- response must be easy to correlate.

---

## 41. Key Takeaways

1. Pagination is a correctness contract, not just a performance feature.
2. Offset/page pagination is simple but unstable for high-churn data.
3. Cursor pagination is often better for large or changing result sets.
4. Every paginated API needs deterministic ordering and stable tie-breakers.
5. List responses should usually use envelopes, not bare arrays.
6. Filters must document combination semantics, serialization, and boundary behavior.
7. Sorting must be bounded and should not expose persistence internals.
8. Search syntax is an API contract; do not let it grow accidentally.
9. Bulk operations must define transaction boundary and partial success behavior.
10. Idempotency is essential for retry-safe bulk mutations.
11. Java framework convenience types like `Page<T>` are not automatically good external contracts.
12. A top-tier OpenAPI designer treats list/search/bulk APIs as long-lived integration surfaces.

---

## 42. How This Connects to the Next Part

Part 018 focused on APIs where the client requests collections, searches, or bulk commands.

Part 019 moves into APIs where the interaction is not simply synchronous request-response:

- links,
- hypermedia-style operation discovery,
- callbacks,
- webhooks,
- long-running jobs,
- polling,
- async acceptance,
- workflow state transitions.

That matters because many real systems cannot honestly complete everything inside one HTTP response.

---

# End of Part 018

Series status: `018 / 030` complete.  
Next file: `learn-openapi-mastery-for-java-engineers-part-019.md`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-017.md">⬅️ OpenAPI Mastery for Java Engineers — Part 017</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-019.md">OpenAPI Mastery for Java Engineers — Part 019 ➡️</a>
</div>
