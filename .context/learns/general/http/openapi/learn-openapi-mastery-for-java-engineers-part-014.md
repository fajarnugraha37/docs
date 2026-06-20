# OpenAPI Mastery for Java Engineers — Part 014
# Contract Testing: Validating Providers and Consumers Against OpenAPI

> Filename: `learn-openapi-mastery-for-java-engineers-part-014.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `014 / 030`  
> Status: In Progress  
> Previous: Part 013 — Java/Spring OpenAPI Ecosystem  
> Next: Part 015 — Breaking Changes and Compatibility

---

## 0. Why This Part Matters

Di part sebelumnya kita membahas Java/Spring ecosystem: `springdoc-openapi`, Swagger annotations, OpenAPI Generator, Maven/Gradle integration, dan build artifact.

Masalahnya: punya file OpenAPI yang kelihatan bagus **tidak otomatis berarti sistem mematuhi contract tersebut**.

OpenAPI document bisa valid secara syntax, Swagger UI bisa tampil indah, generated client bisa compile, tetapi implementasi tetap bisa salah:

- response runtime tidak sama dengan schema,
- field wajib kadang tidak muncul,
- enum runtime mengirim value yang tidak terdokumentasi,
- error response berbeda bentuk per endpoint,
- API menerima input yang contract-nya melarang,
- API menolak input yang contract-nya mengizinkan,
- example di dokumentasi tidak valid,
- consumer diam-diam bergantung pada behavior yang tidak tercantum,
- deployment baru mengubah contract tanpa sadar.

**Contract testing adalah disiplin untuk menutup gap antara “contract yang tertulis” dan “behavior yang benar-benar terjadi”.**

Untuk Java engineer, bagian ini penting karena kebanyakan bug integrasi bukan berasal dari HTTP dasar, tetapi dari mismatch kecil:

- `amount` di contract `number`, runtime mengirim string,
- `status` di contract enum `OPEN | CLOSED`, runtime mengirim `CANCELLED`,
- response `404` tidak punya body, tapi consumer mengharapkan Problem Details,
- endpoint create mengembalikan `200`, contract bilang `201`,
- field `id` optional di spec, tapi generated client menganggap nullable,
- server menerima unknown field dan diam-diam mengabaikannya,
- generated SDK berubah karena `operationId` berubah.

Top 1% engineer tidak memperlakukan OpenAPI sebagai dokumentasi. Mereka memperlakukannya sebagai **testable boundary**.

---

## 1. Core Mental Model

### 1.1 OpenAPI Contract Is a Promise

OpenAPI contract menjawab pertanyaan:

> “Apa yang boleh dikirim consumer, apa yang akan diterima consumer, dan dalam kondisi apa?”

Contract testing menjawab pertanyaan berbeda:

> “Apakah implementasi dan consumer benar-benar mematuhi janji itu?”

Jadi:

```text
OpenAPI document
  = declared promise

Implementation behavior
  = actual provider behavior

Consumer behavior
  = actual dependency expectation

Contract testing
  = mechanisms that continuously compare declared promise, provider behavior, and consumer expectations
```

Tanpa contract testing, OpenAPI sering menjadi artifact statis:

```text
Controller changes
  ↓
Runtime behavior changes
  ↓
OpenAPI spec not updated
  ↓
Consumer breaks later
```

Dengan contract testing:

```text
Controller changes
  ↓
Contract validation fails in CI
  ↓
Engineer sees mismatch before release
```

---

## 2. Three Different Things People Confuse

Banyak tim mencampuradukkan tiga kategori test berikut.

### 2.1 Schema Validation

Schema validation memeriksa apakah payload sesuai schema.

Contoh pertanyaan:

- Apakah response punya field wajib?
- Apakah tipe field benar?
- Apakah enum value valid?
- Apakah string mengikuti pattern?
- Apakah object punya additional fields yang tidak boleh ada?

Schema validation penting, tapi belum cukup.

### 2.2 Contract Testing

Contract testing memeriksa apakah interaksi antar service sesuai kesepakatan.

Contoh pertanyaan:

- Apakah provider menerima request yang dijanjikan?
- Apakah provider mengembalikan response yang dijanjikan?
- Apakah consumer hanya bergantung pada hal yang contract izinkan?
- Apakah perubahan contract aman untuk consumer yang ada?

### 2.3 End-to-End Testing

End-to-end test memeriksa flow lengkap lintas banyak sistem.

Contoh:

```text
User submits case
  → case is assigned
  → evidence is uploaded
  → supervisor approves
  → enforcement notice is issued
```

E2E test berguna, tetapi mahal dan rapuh. Contract testing tidak menggantikan E2E, tetapi mengurangi kebutuhan E2E untuk memeriksa hal-hal mekanis antar boundary.

---

## 3. Testing Pyramid for API Contracts

Model yang lebih berguna untuk OpenAPI:

```text
                  ┌──────────────────────────────┐
                  │ Few end-to-end journeys       │
                  │ Business-critical flows       │
                  └──────────────▲───────────────┘
                                 │
                  ┌──────────────┴───────────────┐
                  │ Consumer-driven contracts     │
                  │ Provider verification         │
                  │ OpenAPI diff compatibility    │
                  └──────────────▲───────────────┘
                                 │
                  ┌──────────────┴───────────────┐
                  │ Request/response validation   │
                  │ Schema validation             │
                  │ Example validation            │
                  │ Linting                       │
                  └──────────────▲───────────────┘
                                 │
                  ┌──────────────┴───────────────┐
                  │ Unit tests                    │
                  │ Controller tests              │
                  │ Serialization tests           │
                  │ Validation tests              │
                  └──────────────────────────────┘
```

OpenAPI biasanya berada di tengah:

- lebih kuat dari unit test karena memeriksa external boundary,
- lebih murah dari E2E karena tidak perlu semua sistem hidup,
- lebih eksplisit dari integration test biasa karena punya oracle formal.

---

## 4. Contract Testing Is Not One Tool

Contract testing bukan satu produk. Ini adalah kombinasi beberapa checks.

Untuk OpenAPI, pipeline ideal minimal terdiri dari:

```text
1. Spec validation
2. Spec linting
3. Example validation
4. Provider request validation
5. Provider response validation
6. Negative tests
7. Contract diffing
8. Consumer compatibility checks
9. Mock contract verification
10. Release gate
```

Setiap check menangkap kelas error berbeda.

---

## 5. Validation Axis #1 — Is the OpenAPI Document Itself Valid?

Ini level paling dasar.

Pertanyaan:

- Apakah dokumen valid sesuai OpenAPI version?
- Apakah `$ref` resolve?
- Apakah schema valid?
- Apakah path template cocok dengan path parameters?
- Apakah operation punya response?
- Apakah media type didefinisikan benar?

Contoh error:

```yaml
paths:
  /cases/{caseId}:
    get:
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
```

Path memakai `{caseId}`, tetapi parameter bernama `id`.

Secara mental:

```text
Spec validation catches malformed contract.
It does not prove implementation correctness.
```

---

## 6. Validation Axis #2 — Does the Spec Follow Organizational Rules?

Spec bisa valid secara OpenAPI, tapi buruk secara organisasi.

Contoh valid tapi buruk:

```yaml
paths:
  /doThing:
    post:
      operationId: doThing
      responses:
        '200':
          description: ok
```

OpenAPI mungkin menerima ini. Tapi organisasi yang serius akan menolak karena:

- path tidak jelas,
- operationId generic,
- response tidak punya schema,
- error responses tidak terdokumentasi,
- tidak ada security requirement,
- tidak ada tag,
- tidak ada examples.

Inilah peran linting.

### 6.1 Example Lint Rules

```text
Every operation must have operationId.
Every operationId must be unique.
Every operation must declare 4xx response.
Every error response must use Problem Details schema.
Every paginated list must use standard pagination envelope.
No query parameter may be named `q` without description.
No response schema may be an unconstrained free-form object.
No enum may be undocumented.
Every public operation must have examples.
```

Spec validation memastikan dokumen bisa dibaca tool. Linting memastikan dokumen bisa dipakai organisasi.

---

## 7. Validation Axis #3 — Are Examples Valid?

Examples sering dianggap kosmetik. Dalam OpenAPI mastery, examples adalah **test fixtures**.

Contoh schema:

```yaml
components:
  schemas:
    CaseStatus:
      type: string
      enum: [OPEN, UNDER_REVIEW, CLOSED]
```

Bad example:

```yaml
example: IN_PROGRESS
```

Ini bukan sekadar dokumentasi salah. Ini sinyal bahwa:

- domain vocabulary belum stabil,
- implementation mungkin punya enum berbeda,
- frontend mungkin memakai value yang tidak valid,
- test fixture mungkin tidak sesuai contract.

### 7.1 Example Validation Rule

Setiap example harus divalidasi terhadap schema yang dia klaim wakili.

```text
If an example cannot pass the schema, the example is not documentation.
It is misinformation.
```

---

## 8. Validation Axis #4 — Provider Request Validation

Provider request validation memeriksa apakah server menerima/menolak request sesuai contract.

Pertanyaan:

- Kalau OpenAPI bilang field wajib, apakah server menolak request tanpa field itu?
- Kalau OpenAPI bilang enum hanya tiga value, apakah server menolak value keempat?
- Kalau OpenAPI bilang `amount` minimum `0`, apakah server menolak `-1`?
- Kalau OpenAPI bilang query param `limit` maximum `100`, apakah server menolak `1000`?

### 8.1 Example Contract

```yaml
post:
  operationId: createCase
  requestBody:
    required: true
    content:
      application/json:
        schema:
          type: object
          required: [subjectId, allegationType]
          properties:
            subjectId:
              type: string
              minLength: 1
            allegationType:
              type: string
              enum: [FRAUD, MISCONDUCT, NON_COMPLIANCE]
```

### 8.2 Provider Must Reject Invalid Request

Invalid:

```json
{
  "subjectId": "S-123",
  "allegationType": "UNKNOWN"
}
```

Expected:

```text
400 or 422, depending on organizational error standard
```

Bad runtime behavior:

```text
201 Created
```

That means the provider is more permissive than the contract.

Is permissiveness always bad? Tidak selalu. Tapi kalau contract bilang enum terbatas dan provider menerima value lain, maka contract tidak lagi menjadi sumber kebenaran.

---

## 9. Validation Axis #5 — Provider Response Validation

Provider response validation memeriksa apakah response runtime sesuai OpenAPI.

Ini biasanya lebih penting daripada request validation, karena consumer paling sering rusak karena response mismatch.

### 9.1 Example Schema

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
      type: string
      enum: [OPEN, UNDER_REVIEW, CLOSED]
    createdAt:
      type: string
      format: date-time
```

Runtime response:

```json
{
  "id": "CASE-1001",
  "status": "IN_REVIEW"
}
```

Problems:

- `createdAt` missing,
- `status` value invalid.

A human might miss this. Generated client might not. A strict consumer might break.

### 9.2 Response Validation Should Happen in Tests

At minimum:

```text
Controller/integration tests should assert that actual responses conform to OpenAPI schemas.
```

Better:

```text
CI should run a suite that exercises documented operations and validates actual responses against OpenAPI.
```

---

## 10. Validation Axis #6 — Negative Testing

Most teams test happy paths. Contract bugs hide in invalid inputs.

Negative contract tests ask:

- What happens if required field is missing?
- What happens if field type is wrong?
- What happens if enum value is unknown?
- What happens if string too long?
- What happens if query parameter is malformed?
- What happens if unsupported media type is sent?
- What happens if Accept header requests unsupported representation?
- What happens if authentication is missing?
- What happens if authorization is insufficient?

### 10.1 Why Negative Testing Matters

A contract is not only about what works. It is also about what is rejected.

```text
A boundary that accepts anything is not a boundary.
```

In regulated systems, rejection behavior is part of defensibility:

- invalid evidence upload should be rejected predictably,
- unauthorized case access should be denied consistently,
- invalid state transition should produce conflict error,
- malformed request should not produce vague 500.

---

## 11. Validation Axis #7 — Contract Diffing

Contract diffing compares previous OpenAPI with new OpenAPI.

```text
old-openapi.yaml
       │
       ▼
   diff tool
       ▲
       │
new-openapi.yaml
```

The key question:

> Is this change backward-compatible?

### 11.1 Changes That Are Usually Breaking

```text
Remove path
Remove operation
Change operationId
Remove response field
Add required request field
Remove enum value
Add stricter validation constraint
Change field type
Change media type
Change security requirement
Remove response status code
Change error schema
```

### 11.2 Changes That Are Usually Additive

```text
Add new optional response field
Add new endpoint
Add new optional query parameter
Add new response example
Add new documented error response
Add less restrictive validation constraint
```

But “usually” is dangerous. Some additive-looking changes are breaking.

### 11.3 Enum Expansion Trap

Adding enum value looks additive:

```diff
 enum:
   - OPEN
   - CLOSED
+  - ESCALATED
```

But generated clients may create exhaustive switch statements:

```java
switch (caseStatus) {
  case OPEN -> ...;
  case CLOSED -> ...;
}
```

A new enum value may break runtime deserialization or business logic.

So for response enums:

```text
Adding enum values can be breaking for strict consumers.
```

This is why compatibility is not just schema math. It includes consumer behavior.

---

## 12. Validation Axis #8 — Consumer Compatibility

Provider-centric teams often ask:

> “Does our server match the OpenAPI?”

But consumer safety asks:

> “Do existing consumers remain compatible with the new provider contract?”

OpenAPI alone may not know all consumer expectations.

Example:

Spec says:

```yaml
createdAt:
  type: string
  format: date-time
```

Consumer assumes:

```text
createdAt is always UTC and ends with Z
```

Spec did not say that. Consumer depends on undocumented behavior.

There are two possible fixes:

1. update contract to explicitly document UTC invariant,
2. update consumer to not assume that invariant.

Contract testing reveals hidden assumptions.

---

## 13. Provider Contract Testing vs Consumer-Driven Contract Testing

### 13.1 Provider Contract Testing

Provider contract testing starts from provider spec.

```text
OpenAPI spec
  ↓
Generate tests or validate test responses
  ↓
Check provider conforms
```

Good for:

- public API,
- partner API,
- central API governance,
- generated SDK safety,
- schema correctness,
- documentation trust.

Weakness:

- does not prove consumers only rely on documented behavior,
- may miss undocumented consumer expectations.

### 13.2 Consumer-Driven Contract Testing

Consumer-driven contract testing starts from consumer expectations.

```text
Consumer test describes expected interaction
  ↓
Contract published
  ↓
Provider verified against consumer expectation
```

Good for:

- microservices,
- internal service dependencies,
- many consumers,
- avoiding over-testing all provider behavior,
- preventing provider changes from breaking known consumers.

Weakness:

- may fragment contract understanding if not reconciled with OpenAPI,
- consumer expectations can encode bad API design,
- requires discipline and broker/workflow.

### 13.3 OpenAPI and Pact Are Complementary

OpenAPI answers:

```text
What is the provider's declared interface?
```

Pact-style CDC answers:

```text
What interactions do consumers actually depend on?
```

A mature platform can use both:

```text
OpenAPI = provider contract / public surface / documentation / generation source
CDC     = consumer expectation safety net
Diff    = release compatibility gate
```

---

## 14. OpenAPI as Test Oracle

A test oracle is the thing that decides whether test output is correct.

In ordinary tests:

```java
assertEquals("OPEN", response.status());
```

The expected value is hardcoded in the test.

With OpenAPI:

```text
Validate response against operation response schema.
```

The expected structure comes from the contract.

This is powerful because:

- tests and documentation share source,
- examples can be reused,
- response validation becomes broad,
- CI can detect drift.

But it is also risky if the OpenAPI is wrong.

```text
A wrong contract makes wrong tests look correct.
```

Therefore contract review remains essential.

---

## 15. Practical Java Testing Architecture

A realistic Java/Spring architecture can layer tests like this:

```text
src/test/java
  ├── contract
  │   ├── OpenApiSpecValidationTest.java
  │   ├── OpenApiExampleValidationTest.java
  │   ├── OpenApiResponseValidationTest.java
  │   └── OpenApiBreakingChangeTest.java
  │
  ├── web
  │   ├── CaseControllerTest.java
  │   └── EvidenceControllerTest.java
  │
  ├── application
  │   └── CaseWorkflowServiceTest.java
  │
  └── domain
      └── CaseStateMachineTest.java
```

OpenAPI contract tests should not replace domain tests.

They check boundary correctness.

---

## 16. Boundary Test Design

For each operation, think in terms of boundary cases.

Example operation:

```text
POST /cases/{caseId}/assignments
```

Possible contract test matrix:

| Scenario | Expected Contract Behavior |
|---|---|
| Valid assignment request | `201 Created` with assignment representation |
| Missing body | `400` or `422` Problem Details |
| Missing assigneeId | validation error |
| Unknown caseId | `404` Problem Details |
| Closed case | `409 Conflict` Problem Details |
| Unauthorized user | `403` Problem Details |
| Missing auth | `401` with auth challenge if applicable |
| Unsupported media type | `415` |
| Unsupported accept type | `406` if negotiated strictly |

OpenAPI should document these responses.

If implementation returns them but OpenAPI does not document them, consumer cannot rely on them.

If OpenAPI documents them but implementation does not return them, contract is misleading.

---

## 17. Testing Request Validation in Spring

Assume request schema:

```yaml
CreateCaseRequest:
  type: object
  required:
    - subjectId
    - allegationType
  properties:
    subjectId:
      type: string
      minLength: 1
    allegationType:
      type: string
      enum: [FRAUD, MISCONDUCT, NON_COMPLIANCE]
```

Java DTO:

```java
public record CreateCaseRequest(
    @NotBlank String subjectId,
    @NotNull AllegationType allegationType
) {}
```

Controller:

```java
@PostMapping("/cases")
ResponseEntity<CaseResponse> createCase(
    @Valid @RequestBody CreateCaseRequest request
) {
    CaseResponse response = service.createCase(request);
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
}
```

Test:

```java
@Test
void createCaseRejectsUnknownAllegationType() throws Exception {
    mockMvc.perform(post("/cases")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "subjectId": "SUB-123",
                  "allegationType": "UNKNOWN"
                }
                """))
        .andExpect(status().isBadRequest());
}
```

This test validates runtime behavior, but not necessarily OpenAPI alignment.

To make it contract-aware, add checks:

- OpenAPI schema defines enum values,
- invalid value rejected,
- error response matches documented error schema.

---

## 18. Testing Response Validation

Suppose your controller returns:

```java
public record CaseResponse(
    String id,
    CaseStatus status,
    Instant createdAt
) {}
```

OpenAPI says:

```yaml
CaseResponse:
  type: object
  required: [id, status, createdAt]
  properties:
    id:
      type: string
    status:
      type: string
      enum: [OPEN, UNDER_REVIEW, CLOSED]
    createdAt:
      type: string
      format: date-time
```

A boundary test should validate actual response body against the schema for:

```text
GET /cases/{caseId} 200 application/json
```

Pseudo-flow:

```text
1. Load OpenAPI document.
2. Find operation: GET /cases/{caseId}.
3. Find response: 200 application/json.
4. Execute test request.
5. Validate actual body against response schema.
```

This catches issues unit assertions may miss.

---

## 19. Avoid Assertion Duplication

Bad:

```java
assertThat(json.status()).isEqualTo("OPEN");
assertThat(json.createdAt()).isNotNull();
assertThat(json.id()).isNotNull();
```

Also separately:

```yaml
required: [id, status, createdAt]
```

This duplicates contract in test code.

Better:

```text
Use OpenAPI schema to validate generic structural expectations.
Use explicit assertions only for business-specific expectations.
```

Example:

```text
Schema validation checks:
- id exists
- status enum valid
- createdAt date-time shaped

Business assertion checks:
- status is OPEN after creation
- id starts with expected prefix if domain requires it
- createdAt is within test clock range
```

This keeps tests maintainable.

---

## 20. Mock Servers and Contract Testing

Mock servers generated from OpenAPI help consumers develop before provider exists.

But mock servers can create false confidence.

### 20.1 Good Use of Mock Servers

- frontend development before backend readiness,
- partner onboarding sandbox,
- example validation,
- early UX testing,
- generated SDK smoke tests,
- contract-first design feedback.

### 20.2 Bad Use of Mock Servers

- treating mock behavior as proof of provider behavior,
- using unrealistic examples,
- not validating mock examples against schema,
- never replacing mocks with provider verification,
- mock returns only happy path.

A mock proves:

```text
A consumer can interact with a simulated contract.
```

It does not prove:

```text
The real provider obeys the contract.
```

---

## 21. Property-Based API Testing

Property-based testing generates many inputs from schema constraints instead of hand-writing a few examples.

For OpenAPI:

```text
OpenAPI schema
  ↓
Generate valid and invalid requests
  ↓
Send to API
  ↓
Check status codes, crashes, response schema, invariants
```

Tools like Schemathesis are designed for this style: generating test cases from OpenAPI/GraphQL schemas and exercising edge cases.

### 21.1 What Property-Based Testing Finds

- server 500 on weird but valid input,
- invalid input accepted,
- undocumented status code,
- response schema mismatch,
- serialization edge case,
- boundary bug around min/max,
- path/query encoding issue,
- stateful sequence bug.

### 21.2 Example Cases Generated

From:

```yaml
limit:
  type: integer
  minimum: 1
  maximum: 100
```

Generated tests may include:

```text
limit=1
limit=100
limit=0
limit=101
limit=-1
limit=999999999
limit=abc
limit=
```

Manual tests often cover only `limit=20`.

---

## 22. Stateful API Testing

Some APIs cannot be tested operation-by-operation only.

Example enforcement lifecycle:

```text
Create case
  → assign investigator
  → upload evidence
  → submit finding
  → issue notice
  → close case
```

A single operation schema does not fully express valid state transitions.

OpenAPI can document operations, but domain state machine rules live partly outside schema.

Contract tests should combine:

```text
OpenAPI validation
+ state machine tests
+ workflow integration tests
```

Example state rule:

```text
A CLOSED case cannot accept new evidence.
```

OpenAPI can document `409 Conflict`, but only domain tests prove the rule is implemented.

---

## 23. What OpenAPI Can Validate vs Cannot Validate

### 23.1 OpenAPI Can Validate Well

```text
Path shape
Method availability
Parameter presence
Parameter type
Request body structure
Response body structure
Media type
Status code presence
Header shape
Security scheme declaration
Examples
```

### 23.2 OpenAPI Cannot Fully Validate Alone

```text
Business authorization
Cross-field business rules
Temporal rules
State machine correctness
Database consistency
Side effects
SLA adherence
Audit log completeness
Regulatory interpretation
Fraud detection logic
Actual permission enforcement
```

Example:

```yaml
amount:
  type: number
  minimum: 0
```

OpenAPI can validate non-negative amount.

It cannot know:

```text
Penalty amount must be below statutory maximum for this violation type.
```

That is domain logic.

---

## 24. Common Provider Drift Scenarios

### 24.1 Response Field Removed Accidentally

Refactor:

```java
public record CaseResponse(
    String id,
    CaseStatus status
) {}
```

Old contract required `createdAt`.

Without response validation, this reaches production.

### 24.2 Error Handler Changes Shape

Old error:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "errors": []
}
```

New error:

```json
{
  "message": "Validation failed"
}
```

Swagger UI still works. Consumers break.

### 24.3 Enum Serialization Changes

Java enum:

```java
UNDER_REVIEW
```

Old serialization:

```json
"UNDER_REVIEW"
```

New serialization due to Jackson annotation:

```json
"under_review"
```

Contract diff may not detect this if spec did not change. Response validation will.

### 24.4 Nullability Drift

Spec says:

```yaml
closedAt:
  type:
    - string
    - 'null'
  format: date-time
```

Runtime sometimes omits field entirely.

Depending on contract, omission and null may not be equivalent.

---

## 25. Common Consumer Drift Scenarios

### 25.1 Consumer Depends on Undocumented Field

Provider response includes extra field:

```json
{
  "id": "CASE-1",
  "status": "OPEN",
  "internalPriorityScore": 97
}
```

Spec does not document it.

Frontend uses it anyway.

Later provider removes it. Frontend breaks.

Lesson:

```text
Consumers should not depend on undocumented fields.
Providers should avoid exposing accidental fields.
```

### 25.2 Consumer Assumes Error Message Text

Consumer logic:

```java
if (error.message().contains("already closed")) {
    showClosedCaseUI();
}
```

Better contract:

```json
{
  "type": "https://api.example.com/problems/invalid-case-state",
  "title": "Invalid case state",
  "status": 409,
  "code": "CASE_ALREADY_CLOSED"
}
```

Consumer should depend on stable error code/type, not prose.

### 25.3 Consumer Assumes Sort Order

Spec does not say default sorting.

Consumer assumes newest first.

Provider changes DB query. Consumer UI changes behavior.

Fix:

```text
Document default sort order or require explicit sort parameter.
```

---

## 26. Contract Testing for Generated Clients

Generated clients create another compatibility surface.

OpenAPI change can break generated SDK even if HTTP remains similar.

### 26.1 SDK Breakage Sources

```text
operationId change
schema name change
enum change
nullable change
oneOf/allOf change
required field change
date-time mapping change
package name change
generator version change
template change
```

### 26.2 SDK Smoke Test

For each generated client release:

```text
1. Generate SDK from OpenAPI.
2. Compile SDK.
3. Run serialization/deserialization tests.
4. Call mock server examples.
5. Call provider test environment.
6. Verify common workflows.
```

Do not assume generation success means SDK usability.

---

## 27. CI/CD Contract Gate

A serious OpenAPI CI pipeline can look like this:

```text
Pull Request
  ↓
Validate OpenAPI syntax
  ↓
Lint style guide
  ↓
Validate examples
  ↓
Bundle multi-file spec
  ↓
Diff against main/released spec
  ↓
Classify breaking changes
  ↓
Run provider tests with response validation
  ↓
Run generated client smoke tests
  ↓
Publish preview docs/mock
  ↓
Human review for semantic changes
  ↓
Merge
```

### 27.1 Release Pipeline

```text
Release tag
  ↓
Publish OpenAPI artifact
  ↓
Publish documentation
  ↓
Generate SDKs
  ↓
Publish SDK artifacts
  ↓
Notify consumers
  ↓
Record compatibility report
```

---

## 28. Pull Request Contract Review Checklist

For every OpenAPI change, reviewers should ask:

### 28.1 Surface Area

```text
Did this add/remove/rename path?
Did this change method semantics?
Did this change operationId?
Did this change tags or ownership metadata?
```

### 28.2 Request Contract

```text
Did this add required input?
Did this tighten validation?
Did this change parameter serialization?
Did this change request media type?
Did this change default behavior?
```

### 28.3 Response Contract

```text
Did this remove field?
Did this add enum value?
Did this change nullable/optional semantics?
Did this change error response?
Did this change status code?
Did this change headers?
```

### 28.4 Consumer Impact

```text
Which consumers use this operation?
Are generated clients impacted?
Is there a migration guide?
Is this change backward-compatible?
If breaking, what is the deprecation timeline?
```

### 28.5 Testing

```text
Are examples valid?
Are provider tests updated?
Are negative tests updated?
Is response validation in place?
Did diff tooling classify the change?
```

---

## 29. Example: Contract Test Failure Analysis

Suppose CI fails:

```text
GET /cases/{caseId} 200 application/json
Response body does not match schema CaseResponse

Error:
  required property 'createdAt' is missing
```

Do not immediately “fix” by making `createdAt` optional.

Ask:

1. Is `createdAt` truly required by API semantics?
2. Did implementation accidentally stop returning it?
3. Do consumers depend on it?
4. Is there a migration/deprecation plan?
5. Is this field sometimes unavailable due to domain reason?
6. Should the schema model multiple states?

Possible outcomes:

### 29.1 Implementation Bug

Contract is correct. Restore field.

```text
Fix provider.
```

### 29.2 Contract Too Strict

Field not always available by design.

```text
Update contract carefully.
Check breaking impact.
Maybe introduce state-specific schema.
```

### 29.3 Domain Ambiguity

Team does not know whether field is required.

```text
Resolve domain invariant.
Then update implementation and contract.
```

Contract test failure is not only a technical failure. It is often a design clarification opportunity.

---

## 30. Example: Error Contract Validation

Standard error schema:

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
      format: uri-reference
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
      format: uri-reference
    code:
      type: string
```

Operation:

```yaml
responses:
  '409':
    description: Case is not in a state that allows this transition.
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
        examples:
          caseAlreadyClosed:
            value:
              type: https://api.example.com/problems/invalid-case-state
              title: Invalid case state
              status: 409
              detail: Case CASE-1001 is already closed.
              code: CASE_ALREADY_CLOSED
```

Test invalid transition:

```text
Given a CLOSED case
When POST /cases/{caseId}/assignments is called
Then status is 409
And response Content-Type is application/problem+json
And response body conforms to Problem schema
And code is CASE_ALREADY_CLOSED
```

The schema validates structure. The explicit assertion validates domain-specific code.

---

## 31. How Strict Should Contract Tests Be?

Strictness has trade-offs.

### 31.1 Too Loose

```text
Only status code checked.
Response body ignored.
Examples not validated.
No diff gate.
```

Result:

```text
Drift reaches production.
```

### 31.2 Too Strict

```text
Every undocumented field fails.
Every harmless order change fails.
Every example difference blocks release.
No override process.
```

Result:

```text
Engineers bypass tests or stop evolving API.
```

### 31.3 Good Strictness

Be strict about:

```text
required fields
types
enums
media types
status codes
error shape
operationId stability
security schemes
breaking changes
```

Be careful about:

```text
object property order
prose description changes
examples where intentionally illustrative
additional response fields depending on policy
format validation when tooling support varies
```

---

## 32. Additional Properties Policy

A major compatibility decision:

```yaml
additionalProperties: false
```

vs

```yaml
additionalProperties: true
```

or omitted.

### 32.1 Strict Response Objects

Pros:

- prevents accidental field leaks,
- catches internal data exposure,
- keeps contract exact,
- useful for regulated APIs.

Cons:

- adding response fields becomes breaking for strict validators,
- consumers may be less tolerant.

### 32.2 Open Response Objects

Pros:

- easier additive evolution,
- clients can ignore unknown fields,
- more web-friendly.

Cons:

- accidental exposure easier,
- contract less precise,
- generated clients may not represent unknown fields.

### 32.3 Practical Policy

For public/regulated APIs:

```text
Prefer explicit response schemas.
Control unknown fields at serialization boundary.
Be very deliberate about extension maps.
```

For internal APIs:

```text
Allow additive response fields only if consumers are required to ignore unknown fields.
Still prevent accidental sensitive field leakage.
```

---

## 33. Contract Testing and Security

OpenAPI can document security schemes, but tests must verify enforcement.

For each protected operation:

```text
No credential        → 401
Invalid credential   → 401
Valid but no access  → 403
Valid with access    → expected success
```

Contract should define these responses.

Security contract tests should check:

- authentication required where documented,
- public endpoints truly public,
- forbidden resources not exposed as success,
- error shape consistent,
- no sensitive data in error responses,
- no stack traces,
- no internal authorization reason leakage.

Example bad error:

```json
{
  "message": "User investigator-17 lacks CASE_READ on tenant ACME because policy row missing"
}
```

Better:

```json
{
  "type": "https://api.example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "ACCESS_DENIED"
}
```

---

## 34. Contract Testing for Regulatory Systems

In regulatory/case-management domains, API contract tests should cover more than CRUD.

Important boundary invariants:

```text
Case state transitions are explicit.
Unauthorized roles cannot access restricted operations.
Evidence upload validates metadata and content type.
Redacted fields do not leak.
Audit operations return stable, complete shapes.
Decision endpoints distinguish validation error, conflict, and forbidden.
Bulk operations report partial success consistently.
Long-running operations expose trackable job state.
```

### 34.1 Example: State Transition Contract

Operation:

```text
POST /cases/{caseId}/submit-for-review
```

Contract tests:

| Current State | Expected |
|---|---|
| DRAFT | `202` or `200` depending on async/sync design |
| UNDER_REVIEW | `409` already under review |
| CLOSED | `409` invalid state |
| Unknown case | `404` |
| No permission | `403` |
| Missing auth | `401` |

OpenAPI should document these responses. Domain tests should prove state machine correctness.

---

## 35. Contract Test Data Strategy

Contract tests need stable data.

Options:

### 35.1 Fixed Fixtures

```text
CASE-OPEN-001
CASE-CLOSED-001
USER-INVESTIGATOR-001
USER-SUPERVISOR-001
```

Pros:

- predictable,
- easy to debug,
- good for CI.

Cons:

- can become stale,
- shared state can make tests flaky.

### 35.2 Test Data Builders

```java
CaseFixture.openCase()
CaseFixture.closedCase()
UserFixture.supervisor()
```

Pros:

- expressive,
- isolated,
- maps to domain states.

Cons:

- more setup code.

### 35.3 Ephemeral Environments

Each PR creates isolated environment with seeded data.

Pros:

- closer to production,
- supports provider verification.

Cons:

- expensive,
- slower,
- needs infra maturity.

### 35.4 Recommended

For Java service boundary tests:

```text
Use test data builders for controller/integration tests.
Use stable fixtures for generated client smoke tests.
Use ephemeral environments for release-level provider verification.
```

---

## 36. Contract Testing with Multi-File OpenAPI

If spec is split:

```text
openapi.yaml
paths/
  cases.yaml
  evidence.yaml
components/
  schemas/
    case.yaml
    problem.yaml
```

CI should:

```text
1. Validate source files.
2. Resolve refs.
3. Bundle into single artifact.
4. Run tests against bundled artifact.
5. Publish bundled artifact.
```

Why bundle before testing?

Because many tools operate more reliably on a single resolved document.

But do not manually edit generated bundle.

```text
Source files are authored.
Bundle is artifact.
```

---

## 37. Contract Testing and Versioning

Contract tests must know what version they are validating.

Bad:

```text
Tests always validate against latest local openapi.yaml.
```

This can hide breaking changes.

Better:

```text
Provider tests validate implementation against current branch spec.
Diff tests compare current branch spec against last released spec.
Consumer tests validate against the provider version they claim to support.
Generated SDK tests validate generated SDK version against matching spec version.
```

Version matrix:

| Artifact | Should Match |
|---|---|
| Provider implementation | current service spec |
| Released documentation | released spec tag |
| Generated SDK | exact spec version used for generation |
| Consumer compatibility | supported provider versions |
| Diff gate | last released stable spec |

---

## 38. Contract Testing Failure Taxonomy

When contract tests fail, classify the failure.

### 38.1 Spec Bug

The spec is wrong; implementation is correct.

Action:

```text
Fix spec.
Evaluate whether published contract was misleading.
Notify consumers if already released.
```

### 38.2 Implementation Bug

Spec is correct; implementation violates it.

Action:

```text
Fix implementation.
Add regression test.
```

### 38.3 Test Bug

Test setup or assumption wrong.

Action:

```text
Fix test.
Do not weaken contract unnecessarily.
```

### 38.4 Compatibility Bug

Change may be intentional but breaking.

Action:

```text
Require versioning/deprecation/migration approval.
```

### 38.5 Domain Ambiguity

No one knows correct behavior.

Action:

```text
Resolve domain decision.
Encode result in contract and tests.
```

---

## 39. Golden Contract Tests

Golden tests compare known examples against expected outputs.

Example:

```text
Given example request from OpenAPI
When sent to provider
Then response matches documented example class/schema
```

Golden tests are good for:

- canonical examples,
- partner-facing flows,
- onboarding scenarios,
- generated documentation trust.

But avoid overusing exact response body snapshots for dynamic fields.

Bad snapshot:

```json
{
  "id": "CASE-1001",
  "createdAt": "2026-06-20T10:00:00Z"
}
```

If `createdAt` changes every test, snapshot becomes fragile.

Better:

```text
Validate schema + assert stable domain invariants.
```

---

## 40. Contract Testing and Observability

Runtime observability can detect contract drift after deployment.

Examples:

```text
Log undocumented status codes.
Sample response schema violations.
Track validation error codes.
Track consumer user-agents or SDK versions.
Monitor deprecated endpoint usage.
Monitor unknown enum values sent/received.
```

This does not replace CI, but helps discover:

- consumers still using deprecated operation,
- provider returning unexpected error spike,
- real payloads not covered by examples,
- partner using undocumented behavior.

Advanced platform teams combine:

```text
OpenAPI contract
+ CI validation
+ runtime traffic sampling
+ API catalog ownership
+ compatibility reporting
```

---

## 41. Minimal Practical Toolchain

A small team can start with:

```text
1. OpenAPI validation in CI.
2. Lint rules for required operationId, errors, security, examples.
3. Contract diff against last release.
4. MockMvc/WebTestClient response validation for key operations.
5. Example validation.
6. Generated client smoke test for public/partner APIs.
```

Do not start by building a huge governance platform.

Start by catching real drift.

---

## 42. Mature Toolchain

A mature organization may add:

```text
API catalog
Consumer ownership map
Contract registry
Consumer-driven contract broker
Breaking change approval workflow
Automated migration guides
SDK publishing pipeline
Runtime schema sampling
Security policy validation
Compliance traceability reports
```

But these are useful only after the basic loop works.

```text
A sophisticated contract platform built on unreviewed specs is theater.
```

---

## 43. Common Anti-Patterns

### 43.1 “Swagger UI Looks Fine”

Swagger UI rendering does not prove contract correctness.

### 43.2 Only Testing 200 Responses

Most integration pain comes from errors, conflicts, validation failures, and edge cases.

### 43.3 Examples Not Validated

Invalid examples teach consumers wrong behavior.

### 43.4 No Diff Against Released Contract

You cannot know whether a change is breaking if you do not compare against baseline.

### 43.5 Generated Spec Is Never Reviewed

Code-first generation can produce a spec, but not necessarily a good contract.

### 43.6 Consumer Tests Mock Provider Too Much

If consumer mocks do not come from contract, they can drift into fantasy APIs.

### 43.7 Provider Tests Ignore Error Body

Checking `status().isBadRequest()` is not enough if error schema is part of contract.

### 43.8 Contract Test Failures Are “Fixed” by Weakening Schema

Making fields optional to pass tests can destroy contract value.

---

## 44. Step-by-Step Implementation Plan for a Java Team

### Step 1 — Establish Contract Artifact

```text
Ensure OpenAPI spec is committed, versioned, and reproducible.
```

Avoid runtime-only `/v3/api-docs` as the only source.

### Step 2 — Add Spec Validation

```text
CI fails if OpenAPI is invalid.
```

### Step 3 — Add Lint Rules

Start with minimum rules:

```text
operationId required
operationId unique
4xx response required
error schema standard
no undocumented security on protected endpoints
examples required for public API
```

### Step 4 — Validate Examples

```text
Every request/response example must match schema.
```

### Step 5 — Add Response Validation for Critical Operations

Start with:

```text
GET detail
POST create
PATCH/PUT update
DELETE/close/cancel operation
main list/search endpoint
main error scenarios
```

### Step 6 — Add Negative Tests

Focus on:

```text
missing required fields
invalid enum
invalid state transition
unauthorized/forbidden
unsupported media type
```

### Step 7 — Add Diff Gate

Compare against:

```text
last released OpenAPI artifact
```

### Step 8 — Add Consumer Signal

For internal microservices:

```text
Map consumers to operations.
Add CDC where coupling is high.
```

For public APIs:

```text
Add SDK smoke tests and migration docs.
```

---

## 45. Deep Example: Case Assignment Endpoint

### 45.1 Contract

```yaml
paths:
  /cases/{caseId}/assignments:
    post:
      operationId: createCaseAssignment
      summary: Assign a case to an investigator
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
            minLength: 1
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCaseAssignmentRequest'
            examples:
              assignInvestigator:
                value:
                  assigneeId: usr_123
                  role: INVESTIGATOR
      responses:
        '201':
          description: Assignment created.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseAssignmentResponse'
        '400':
          description: Malformed request.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '403':
          description: Caller is not allowed to assign this case.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '404':
          description: Case not found.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '409':
          description: Case state does not allow assignment.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
```

### 45.2 Test Matrix

| Test | Contract Aspect |
|---|---|
| valid request returns 201 | success response documented |
| response body validates | schema conformance |
| missing assigneeId rejected | request validation |
| invalid role rejected | enum validation |
| closed case returns 409 | domain conflict |
| unknown case returns 404 | not found error |
| unauthorized caller returns 403 | security boundary |
| error body validates Problem | standard error contract |

### 45.3 Why This Is Better Than Normal Controller Tests

Normal controller tests might check only:

```text
valid request → 201
closed case → 409
```

Contract-aware tests check:

```text
valid request → 201 + documented media type + documented response schema
closed case → 409 + documented problem schema + stable code
```

The difference matters for consumers.

---

## 46. Contract Testing Strategy by API Type

### 46.1 Internal Single Consumer API

Minimum:

```text
OpenAPI validation
response validation for key flows
consumer integration tests
```

### 46.2 Internal Multi-Consumer API

Add:

```text
consumer ownership map
breaking change diff
consumer-driven contracts for critical consumers
```

### 46.3 Public API

Add:

```text
strict docs review
example validation
SDK smoke tests
deprecation policy
versioned artifacts
migration guides
```

### 46.4 Partner API

Add:

```text
sandbox mocks
golden examples
compatibility certification
contract change notification
partner-specific test suites
```

### 46.5 Regulated API

Add:

```text
audit traceability
security negative tests
redaction tests
field classification checks
contract history retention
approval evidence
```

---

## 47. Key Design Principle: Contract Tests Should Encode Boundary Truth, Not Implementation Detail

Bad contract test:

```text
Response contains exactly fields in Java record order.
```

Good contract test:

```text
Response conforms to documented schema and domain invariants.
```

Bad:

```text
Error message equals exact English sentence.
```

Good:

```text
Error type/code/status conforms to documented Problem Details contract.
```

Bad:

```text
Database row count changed.
```

Good:

```text
API returns documented state transition result.
```

Contract tests should care about external promises.

---

## 48. How to Think Like a Senior Reviewer

When reviewing OpenAPI contract tests, ask:

1. What kind of drift would this test catch?
2. What kind of breaking change would still escape?
3. Is this testing contract or implementation detail?
4. Is the test too brittle for harmless changes?
5. Is the test too loose for real consumer safety?
6. Does the test prove error shape, not just status code?
7. Does this operation have negative scenarios?
8. Does this test validate examples?
9. Does this test compare against released baseline?
10. Does this protect generated clients?

---

## 49. Summary

OpenAPI contract testing is the discipline of continuously checking that:

```text
Declared contract
Actual provider behavior
Actual consumer expectations
Released compatibility baseline
```

remain aligned.

The most important ideas:

1. OpenAPI validity is necessary but not sufficient.
2. Linting enforces organizational quality beyond spec syntax.
3. Examples should be validated and treated as test fixtures.
4. Provider responses must be validated against schemas.
5. Negative tests are essential for boundary correctness.
6. Contract diffing prevents accidental breaking changes.
7. Consumer-driven contracts complement OpenAPI, not replace it.
8. Generated clients need smoke tests.
9. Contract failures should trigger design analysis, not automatic schema weakening.
10. In regulated systems, contract tests become evidence of boundary discipline.

The main mindset shift:

```text
OpenAPI is not done when Swagger UI renders.
OpenAPI is useful when it can fail a bad change before production.
```

---

## 50. Practical Exercises

### Exercise 1 — Validate Existing Contract

Take one OpenAPI document and answer:

```text
Does every operation have operationId?
Does every operation document non-2xx responses?
Are error responses consistent?
Are examples valid?
Are response schemas specific enough?
```

### Exercise 2 — Build Response Validation

Choose one endpoint:

```text
GET /cases/{caseId}
```

Write a test that:

```text
1. Calls the endpoint.
2. Validates status code.
3. Validates Content-Type.
4. Validates response body against OpenAPI schema.
5. Asserts one domain invariant.
```

### Exercise 3 — Add Negative Tests

For one create endpoint, test:

```text
missing required field
invalid enum
invalid type
unsupported media type
unauthorized request
```

### Exercise 4 — Diff Two Contract Versions

Take two OpenAPI versions and classify changes:

```text
breaking
non-breaking
uncertain semantic change
```

### Exercise 5 — Review Error Contract

For every operation, verify:

```text
400/401/403/404/409/422/429 are documented where relevant.
Each uses standard error schema.
Each has at least one useful example.
```

---

## 51. References

- OpenAPI Specification v3.2.0 — official specification.  
  `https://spec.openapis.org/oas/v3.2.0.html`

- OpenAPI Initiative — official project site and API lifecycle framing.  
  `https://www.openapis.org/`

- OpenAPI Generator — official usage documentation.  
  `https://openapi-generator.tech/docs/usage/`

- Pact Documentation — contract testing introduction and consumer-driven contract testing concepts.  
  `https://docs.pact.io/`

- Schemathesis Documentation — property-based API testing from OpenAPI/GraphQL schemas.  
  `https://schemathesis.readthedocs.io/`

---

## 52. Part 014 Completion Checklist

You have completed this part if you can explain:

- why OpenAPI validation is not the same as contract testing,
- how provider request validation differs from provider response validation,
- why examples should be validated,
- how negative tests protect boundary semantics,
- why diffing is essential for API evolution,
- when to use OpenAPI provider testing vs consumer-driven contracts,
- how generated clients can break from contract changes,
- how to design a CI contract gate,
- how to classify contract test failures,
- how contract testing supports regulatory defensibility.

---

# Next Part

Part 015 — Breaking Changes and Compatibility: The Hardest Part of API Evolution

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Java/Spring OpenAPI Ecosystem: Springdoc, Swagger Core, OpenAPI Generator, and Build Integration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-015.md">OpenAPI Mastery for Java Engineers — Part 015 ➡️</a>
</div>
