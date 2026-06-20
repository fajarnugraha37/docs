# OpenAPI Mastery for Java Engineers — Part 012
# API Design with OpenAPI: Design-First, Code-First, Contract-First, and Hybrid Workflows

> Filename: `learn-openapi-mastery-for-java-engineers-part-012.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `012 / 030`  
> Previous: `Part 011 — Modelling Domain Resources Without Leaking Persistence Models`  
> Next: `Part 013 — Java/Spring OpenAPI Ecosystem: Springdoc, Swagger Core, OpenAPI Generator, and Build Integration`

---

## 0. Why This Part Matters

At this point in the series, we already understand OpenAPI as a structural description of an HTTP API:

- paths,
- operations,
- parameters,
- request bodies,
- responses,
- components,
- schemas,
- composition,
- domain resource boundaries.

But a harder question remains:

> Where does the OpenAPI document come from, and who is allowed to change it?

That question sounds procedural, but it is actually architectural.

The workflow you choose determines:

- whether the API is designed before implementation or merely documented after implementation,
- whether consumers can review the API before it exists,
- whether contract changes are intentional or accidental,
- whether generated clients are stable or constantly broken,
- whether your OpenAPI document is evidence or decoration,
- whether contract drift is detected early or discovered by angry consumers,
- whether Java annotations become the source of truth or merely one projection of a deeper contract.

Most teams do not fail with OpenAPI because they cannot write YAML.

They fail because they never decide what role OpenAPI plays in the engineering system.

This part is about that decision.

---

## 1. The Core Problem: Source of Truth

Every API has multiple possible descriptions:

1. What product or business stakeholders believe the API does.
2. What consumers believe the API does.
3. What the OpenAPI document says.
4. What Java controllers accept.
5. What validation rules enforce.
6. What the service actually returns at runtime.
7. What production traffic reveals.
8. What generated clients assume.
9. What tests assert.
10. What documentation examples show.

When these descriptions diverge, the API becomes unreliable.

The real question is:

> Which artifact is authoritative enough that other artifacts should be checked against it?

That is the source-of-truth problem.

OpenAPI workflow selection is mostly a source-of-truth decision.

---

## 2. Four Major OpenAPI Workflows

There are four practical workflow families:

1. **Code-first**
2. **Design-first**
3. **Contract-first**
4. **Hybrid**

They overlap, but they optimize for different things.

| Workflow | Primary Source | Best For | Main Risk |
|---|---|---|---|
| Code-first | Implementation code | Fast internal development | Spec becomes accidental output |
| Design-first | Human-designed API description | Consumer usability, early review | Spec may drift from implementation |
| Contract-first | Contract artifact as release boundary | Partner/public/regulatory APIs | Higher process discipline required |
| Hybrid | Controlled combination | Real organizations | Source of truth becomes ambiguous |

A top-tier engineer does not ask, “Which one is best?”

A better question is:

> Which workflow makes contract risk visible earliest for this API?

---

## 3. Code-First Workflow

## 3.1 Definition

In a code-first workflow, developers implement the API in application code first, then generate the OpenAPI document from that code.

In Java/Spring, this often means:

- controllers define routes,
- method parameters define request parameters,
- DTO classes define schemas,
- annotations enrich documentation,
- tools such as `springdoc-openapi` infer an OpenAPI document from runtime Spring configuration, class structure, and annotations.

The official springdoc description is explicit about this: it examines Spring configuration, class structure, and annotations to infer API semantics and automatically generate JSON/YAML and HTML documentation.

## 3.2 Typical Java Example

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @PostMapping
    @Operation(summary = "Create a case")
    ResponseEntity<CaseResponse> createCase(
        @Valid @RequestBody CreateCaseRequest request
    ) {
        CaseResponse response = service.createCase(request);
        return ResponseEntity
            .created(URI.create("/cases/" + response.id()))
            .body(response);
    }
}
```

The OpenAPI document is generated from:

- `@PostMapping`,
- `@RequestBody`,
- `@Valid`,
- `CreateCaseRequest`,
- `CaseResponse`,
- `@Operation`,
- Jackson metadata,
- Bean Validation annotations,
- Spring response type inference.

This is convenient.

It is also dangerous if treated as design.

---

## 4. What Code-First Is Good At

Code-first is useful when:

1. The API is internal.
2. Consumers are close to the provider team.
3. The API changes frequently.
4. Delivery speed matters more than external review.
5. The implementation already exists.
6. The team wants documentation from actual code.
7. The API surface is small.
8. There is little formal compatibility requirement.
9. Generated docs are mainly for discovery.
10. The team has strong tests to catch behavior drift.

Code-first reduces duplicated effort.

The implementation is already there; generating a spec from it avoids hand-maintaining a separate document.

For many internal Spring services, this is a pragmatic starting point.

---

## 5. Code-First Failure Modes

Code-first becomes weak when the generated OpenAPI document is treated as if it were intentionally designed.

### 5.1 The DTO Dump Problem

Java DTOs are implementation artifacts.

They often contain:

- framework annotations,
- validation compromises,
- serialization quirks,
- internal naming,
- historical fields,
- backward-compatible implementation hacks,
- persistence-adjacent structure.

If OpenAPI is generated directly from those DTOs, the API contract becomes whatever the DTO currently looks like.

That is not design.

That is exposure.

### 5.2 Annotation Soup

Developers often compensate for poor generated docs by adding many annotations:

```java
@Schema(description = "...", example = "...")
@Parameter(description = "...")
@ApiResponse(responseCode = "400", description = "...")
@ApiResponse(responseCode = "409", description = "...")
```

Annotations are not inherently bad.

The problem appears when annotations become scattered fragments of contract logic across controllers and DTO classes.

Then the contract is difficult to review as a whole.

### 5.3 Runtime-Only Documentation

Some generated OpenAPI documents are only available when the application runs:

```text
GET /v3/api-docs
GET /swagger-ui.html
```

That is fine for exploration.

It is weak as a release artifact unless the generated spec is also:

- exported during build,
- versioned,
- diffed,
- linted,
- reviewed,
- published,
- attached to release metadata.

A runtime endpoint is not automatically a governed contract.

### 5.4 Inference Is Not Intent

A tool may infer:

- path,
- method,
- request body type,
- response type,
- parameter names,
- field types,
- validation annotations.

But it may not know:

- business meaning,
- semantic invariants,
- error taxonomy,
- authorization boundary,
- state transition rules,
- compatibility intent,
- consumer expectations,
- deprecation lifecycle,
- hidden constraints enforced downstream.

Generated OpenAPI can be syntactically correct while semantically incomplete.

### 5.5 Accidental Breaking Changes

In code-first systems, harmless-looking Java refactors can become API changes:

- rename a DTO field,
- change `Integer` to `Long`,
- change enum name,
- remove a validation annotation,
- add `@NotNull`,
- change response wrapper,
- change controller return type,
- change exception handler format,
- rename operation method used for generated `operationId`.

If the generated spec is not diffed against the previous released spec, the team may ship a breaking change without noticing.

---

## 6. Design-First Workflow

## 6.1 Definition

In a design-first workflow, the API is designed before the implementation is complete.

The OpenAPI document is often created manually or semi-manually, then reviewed by stakeholders before code is written.

The main goal is not merely generating code.

The goal is making the API interface explicit early enough to be challenged.

## 6.2 Typical Design-First Flow

```text
1. Identify consumer use cases
2. Draft resource and operation model
3. Write initial OpenAPI description
4. Add examples and error cases
5. Review with frontend/mobile/partner/QA/security
6. Generate mock server or documentation preview
7. Refine contract
8. Implement provider
9. Validate implementation against contract
10. Publish contract artifact
```

## 6.3 Why Design-First Matters

APIs are expensive to change after consumers integrate.

Design-first moves feedback earlier.

It allows consumers to say:

- “This response shape is hard to use.”
- “This pagination model does not support our screen.”
- “This error does not tell us whether retry is safe.”
- “This operation is too coarse.”
- “This field name is ambiguous.”
- “This enum will break us if you add values.”
- “This endpoint needs idempotency.”
- “This workflow needs async status polling.”

Those conversations are cheaper before implementation.

---

## 7. What Design-First Is Good At

Design-first is strong when:

1. The API has multiple consumers.
2. Consumer ergonomics matter.
3. Frontend/mobile development should start before backend completion.
4. External partners need early review.
5. QA needs test scenarios early.
6. Security needs to inspect exposure before implementation.
7. Platform teams need consistency.
8. Regulatory teams need traceability.
9. API behavior is part of product design.
10. The provider team wants to avoid implementation-leaking contracts.

Design-first prevents one of the most common API mistakes:

> Designing from the database outward instead of from consumer capability inward.

---

## 8. Design-First Failure Modes

Design-first is not automatically better.

It fails differently.

### 8.1 Beautiful Spec, Different Implementation

A manually written OpenAPI document can drift from the implementation.

Example:

The OpenAPI contract says:

```yaml
responses:
  '409':
    description: Case already exists
```

But the implementation returns:

```json
{
  "timestamp": "2026-06-20T09:00:00Z",
  "status": 500,
  "error": "Internal Server Error"
}
```

The design was good.

The system is still broken.

Design-first needs provider validation.

### 8.2 Spec as Wishful Thinking

A design may describe behavior the system cannot implement safely:

- filtering on fields that are not indexed,
- synchronous operation for long-running process,
- arbitrary sorting on expensive fields,
- transactionally impossible bulk update,
- response data requiring cross-service joins,
- authorization rule too vague to enforce,
- pagination inconsistent with data churn.

Design-first must include implementation feasibility review.

### 8.3 Over-Design

Some design-first teams create elaborate API contracts before they understand the problem.

Symptoms:

- too many generic abstractions,
- excessive polymorphism,
- speculative fields,
- premature versioning model,
- generic error codes disconnected from domain,
- huge reusable schemas before real usage emerges.

A good design-first workflow is iterative, not ceremonial.

---

## 9. Contract-First Workflow

## 9.1 Definition

Contract-first is stricter than design-first.

In contract-first, the OpenAPI document is treated as a versioned, released contract artifact.

Implementation, tests, generated clients, documentation, and release gates revolve around that artifact.

The contract is not merely a design draft.

It is a controlled boundary.

## 9.2 Contract-First Flow

```text
1. Contract proposal
2. Contract review
3. Lint and structural validation
4. Example validation
5. Breaking-change analysis
6. Contract version approval
7. Mock/server/client generation as needed
8. Provider implementation
9. Provider contract tests
10. Consumer contract tests
11. Contract artifact publication
12. Release traceability
13. Deprecation and evolution governance
```

## 9.3 Contract-First Invariant

The central invariant is:

> A provider must not claim conformance to a contract it cannot satisfy.

This means the contract must be testable.

A contract-first team usually asks:

- Is the OpenAPI valid?
- Does it pass style guide rules?
- Are examples valid against schemas?
- Are all operations owned?
- Are errors documented?
- Is the change backward compatible?
- Does the provider pass request/response validation tests?
- Can generated clients still compile?
- Are deprecations represented?
- Is the release artifact published?

---

## 10. What Contract-First Is Good At

Contract-first is strongest when:

1. The API is public.
2. The API has external partners.
3. SDK generation is important.
4. Compatibility is contractual.
5. Consumers are not under provider control.
6. Release evidence matters.
7. Regulatory auditability matters.
8. Breaking changes are expensive.
9. Multi-team coordination is required.
10. API governance exists.

For regulated systems, contract-first is often the most defensible approach because it creates an explicit trail:

```text
Requirement -> Contract -> Review -> Implementation -> Tests -> Release -> Published Artifact
```

---

## 11. Contract-First Failure Modes

Contract-first also has risks.

### 11.1 Process Without Feedback

If contract review becomes a rubber stamp, it adds ceremony without quality.

A contract-first workflow must produce better decisions, not just more approvals.

### 11.2 Contract as Bottleneck

If every minor internal change requires heavyweight central review, teams will bypass the process.

Good governance is risk-based.

Not every internal endpoint needs the same formality as a public financial API.

### 11.3 Generated Code Dominates Architecture

Some teams use contract-first and generate everything:

- controllers,
- models,
- clients,
- validators,
- documentation.

Generation is useful, but dangerous if generated artifacts invade the domain core.

The OpenAPI contract should shape the boundary, not replace the architecture.

---

## 12. Hybrid Workflow

## 12.1 Definition

Hybrid workflow combines approaches.

Most real organizations are hybrid whether they admit it or not.

Examples:

- design-first for public APIs, code-first for internal admin APIs,
- code-first during early prototype, contract-first after API stabilizes,
- generate OpenAPI from Spring code, then export, lint, diff, and publish it as a contract artifact,
- write OpenAPI manually for external surface, generate implementation interfaces from it,
- use annotations for enrichment but keep governance outside code,
- use contract-first for request/response schemas but code-first for internal-only operations.

Hybrid is not a compromise by itself.

It can be excellent.

But only if the source-of-truth rules are explicit.

## 12.2 The Hybrid Trap

Hybrid becomes dangerous when nobody knows which artifact wins.

Example conversation:

```text
Consumer: The OpenAPI says this field is optional.
Backend: The Java DTO has @NotNull.
QA: The Swagger UI example omits it.
Mobile: The generated client accepts null.
Security: The gateway rejects missing field.
Product: The field should only be required for corporate accounts.
```

This is not a tooling problem.

This is a source-of-truth failure.

---

## 13. Source-of-Truth Models

There are several source-of-truth models.

## 13.1 Implementation-as-Truth

```text
Java code -> generated OpenAPI -> docs/clients/tests
```

Useful for:

- internal services,
- early-stage products,
- low-risk APIs.

Required controls:

- generated spec exported in CI,
- diff against previous release,
- contract tests,
- explicit annotation review,
- stable operation IDs.

Risk:

- accidental design leakage.

## 13.2 Spec-as-Truth

```text
OpenAPI -> generated interfaces/clients/docs/tests -> implementation conforms
```

Useful for:

- public APIs,
- partner APIs,
- regulated APIs,
- SDK-first products.

Required controls:

- strict linting,
- review workflow,
- provider validation,
- consumer validation,
- release artifact publication.

Risk:

- spec can become detached from runtime if tests are weak.

## 13.3 Contract-Baseline-as-Truth

```text
Current released OpenAPI baseline -> proposed diff -> compatibility review -> new baseline
```

Useful for:

- long-lived APIs,
- large API portfolios,
- multi-consumer systems.

Required controls:

- versioned contract repository,
- semantic diff,
- breaking change policy,
- migration/deprecation process.

Risk:

- change process may become slow if not risk-tiered.

## 13.4 Runtime-as-Truth

```text
Observed traffic -> inferred contract -> documentation/testing
```

Useful for:

- legacy discovery,
- brownfield audit,
- migration,
- shadow documentation.

Risk:

- observed behavior may include bugs,
- unused valid behavior may be missed,
- invalid accepted behavior may become documented accidentally.

Runtime discovery is useful for archaeology, not ideal as primary design authority.

---

## 14. Workflow Selection Matrix

Use this as a practical decision table.

| Context | Recommended Workflow | Why |
|---|---|---|
| Small internal CRUD API | Code-first with CI export | Fast and pragmatic |
| Internal API with many consumers | Hybrid or contract-first baseline | Consumer impact matters |
| Public API | Contract-first | Compatibility and documentation are product commitments |
| Partner integration API | Contract-first | External dependency and review cycle |
| Regulated case-management API | Contract-first with traceability | Auditability and defensibility |
| Experimental prototype | Code-first or lightweight design-first | Learning speed matters |
| Mobile backend API | Design-first or hybrid | Client release cycles make breaking changes expensive |
| SDK-driven platform API | Contract-first | Generated clients depend on stable operation/schema semantics |
| Legacy Spring API with no spec | Code-first extraction, then baseline contract | Start from reality, then govern |
| API gateway migration | Hybrid | Need current behavior and target contract alignment |

---

## 15. Key Distinction: Design-First vs Contract-First

These terms are often used interchangeably.

They should not be.

## 15.1 Design-First

Design-first answers:

> What should the API look like before we build it?

Primary concern:

- usability,
- clarity,
- feedback,
- modelling.

Output:

- draft OpenAPI,
- examples,
- mock server,
- review notes.

## 15.2 Contract-First

Contract-first answers:

> What API behavior are we willing to version, test, publish, and support?

Primary concern:

- compatibility,
- governance,
- release integrity,
- conformance,
- consumer trust.

Output:

- approved OpenAPI artifact,
- versioned baseline,
- generated clients/stubs if needed,
- validation tests,
- release evidence.

Design-first can evolve into contract-first.

But a design draft is not yet a contract.

---

## 16. A Mature Hybrid Workflow for Java Teams

For many Java/Spring teams, the best practical workflow is not pure.

A mature hybrid looks like this:

```text
1. Draft OpenAPI for important external/consumer-facing API surfaces.
2. Review contract before implementation.
3. Generate Java interfaces or client stubs only where useful.
4. Implement Spring controllers against application services.
5. Use explicit API DTOs, not JPA entities.
6. Export actual generated OpenAPI from application build.
7. Compare exported spec with approved contract.
8. Run provider tests that validate responses against contract.
9. Run diff checks against last released contract.
10. Publish approved OpenAPI artifact with release.
```

This combines:

- design-first thinking,
- contract-first release discipline,
- code-first reality check.

The invariant:

> The human-approved contract and the runtime-produced contract must converge before release.

---

## 17. OpenAPI Artifact Lifecycle

A production-grade OpenAPI document should have a lifecycle.

## 17.1 Draft

Used for:

- exploration,
- API review,
- consumer feedback,
- mock server,
- design alternatives.

Allowed to change freely.

## 17.2 Proposed

Used for:

- pull request review,
- architecture review,
- security review,
- compatibility check.

Changes should be deliberate.

## 17.3 Approved

Used as:

- implementation target,
- test target,
- generation source,
- documentation source.

Should be versioned.

## 17.4 Released

Used as:

- consumer-facing contract,
- SDK baseline,
- changelog input,
- audit artifact.

Should be immutable or at least historically preserved.

## 17.5 Deprecated

Used when:

- operation still exists,
- consumers should migrate,
- replacement exists,
- sunset date may be planned.

## 17.6 Retired

Used when:

- operation is removed from active API surface,
- old docs archived,
- consumers migrated or support ended.

---

## 18. Workflow Artifacts

A serious OpenAPI workflow usually produces more than one file.

Example repository layout:

```text
api-contracts/
  cases-api/
    openapi.yaml
    README.md
    examples/
      create-case.request.json
      create-case.response.201.json
      create-case.response.409.json
    rules/
      spectral.yaml
    changelog.md
    generated/
      bundled.yaml
      dereferenced.yaml
    tests/
      contract-cases.md
```

Or inside a service repository:

```text
case-service/
  src/main/java/...
  src/test/java/...
  api/
    openapi.yaml
    examples/
    changelog.md
  build.gradle
```

The right layout depends on ownership.

The wrong layout is the one where no one knows which spec is current.

---

## 19. Pull Request Review Model

OpenAPI changes should be reviewed like code.

A useful PR template:

```md
## API Change Summary

What changed?

## Change Type

- [ ] Additive
- [ ] Potentially breaking
- [ ] Breaking with migration plan
- [ ] Documentation-only

## Consumer Impact

Who consumes this API?

## Compatibility Analysis

Why is this safe?

## Examples Updated

- [ ] Request examples
- [ ] Success response examples
- [ ] Error response examples

## Tests Updated

- [ ] Provider tests
- [ ] Consumer tests
- [ ] Generated client compile check

## Deprecation/Migration

Is anything deprecated or replaced?
```

This is not bureaucracy.

It forces API thinking to happen before release.

---

## 20. OpenAPI Change Types

Not every spec change has the same risk.

## 20.1 Low-Risk Changes

Usually safe:

- improving descriptions,
- adding examples,
- adding new optional response field if consumers tolerate unknown fields,
- adding new endpoint,
- adding new non-required query parameter,
- documenting existing error response more accurately.

But even “safe” changes can break weak consumers.

For example, adding enum values may break generated clients with exhaustive switches.

## 20.2 Medium-Risk Changes

Need review:

- adding new response fields with ambiguous semantics,
- adding enum values,
- loosening validation,
- adding new media type,
- changing examples significantly,
- adding optional request fields,
- adding new error codes.

## 20.3 High-Risk Changes

Likely breaking:

- removing operation,
- changing path,
- changing method,
- removing response field,
- making optional field required,
- tightening constraints,
- changing field type,
- changing error schema,
- changing authentication requirement,
- renaming operation ID,
- changing pagination format,
- changing discriminator mapping,
- changing enum value names.

Part 015 will go deeper into breaking changes.

For now, remember:

> Compatibility is a consumer property, not just a schema property.

---

## 21. Code-First With Discipline

If you choose code-first, do not make it casual.

A disciplined code-first workflow:

```text
1. Implement controller and DTOs.
2. Add explicit operation IDs.
3. Add explicit response documentation, especially non-2xx.
4. Add schema descriptions for non-obvious fields.
5. Export OpenAPI during CI.
6. Validate exported OpenAPI.
7. Lint exported OpenAPI.
8. Diff against previous released OpenAPI.
9. Fail build on breaking changes unless approved.
10. Publish exported OpenAPI artifact.
```

This transforms code-first from:

```text
“Swagger appears when app runs.”
```

to:

```text
“The implementation produces a contract artifact that is validated and governed.”
```

That difference matters.

---

## 22. Design-First With Discipline

A disciplined design-first workflow:

```text
1. Start from use cases, not controllers.
2. Draft operations and schemas manually.
3. Add realistic examples.
4. Add error scenarios.
5. Review with consumers.
6. Review with implementers.
7. Validate and lint OpenAPI.
8. Generate mock server.
9. Use mock in consumer development.
10. Implement provider.
11. Validate provider against spec.
12. Diff implementation-generated spec against design spec if applicable.
```

The critical control is provider validation.

Design-first without conformance testing produces beautiful lies.

---

## 23. Contract-First With Discipline

A disciplined contract-first workflow:

```text
1. Maintain OpenAPI in version control.
2. Treat changes as API contract PRs.
3. Validate syntax and references.
4. Lint against organizational style guide.
5. Validate examples.
6. Run semantic diff against released baseline.
7. Require compatibility decision.
8. Generate clients/server interfaces if useful.
9. Implement provider.
10. Run provider contract tests.
11. Run generated client compatibility checks.
12. Publish immutable contract artifact.
13. Record changelog and migration notes.
```

Contract-first is not “write YAML first.”

It is “govern the boundary first.”

---

## 24. OpenAPI in the Java Build

For Java engineers, workflow quality often depends on build integration.

Useful build-stage concepts:

```text
validateOpenApi
lintOpenApi
bundleOpenApi
diffOpenApi
generateServerInterfaces
generateClientSdk
runContractTests
publishOpenApiArtifact
```

In Maven or Gradle, OpenAPI tasks should be part of normal CI.

Avoid workflows where generating or validating the spec is a manual developer action.

Manual OpenAPI discipline does not survive long in active systems.

---

## 25. Generated Code: Boundary Tool, Not Architecture

OpenAPI Generator can generate client libraries, server stubs, documentation, and configuration from an OpenAPI spec. Its official project description emphasizes generation of API client libraries, server stubs, documentation, and configuration from OpenAPI specifications.

That is powerful.

But generated code should be placed carefully.

## 25.1 Good Uses

Good uses:

- generated API interfaces,
- generated clients for consumers,
- generated DTOs at boundary,
- generated documentation,
- generated mocks,
- generated validation scaffolding.

## 25.2 Dangerous Uses

Dangerous uses:

- domain model generated from OpenAPI,
- persistence entity generated from OpenAPI,
- business service depends directly on generated DTOs,
- manual edits inside generated code,
- generated code dictates package architecture,
- generator templates become undocumented platform magic.

The correct architecture boundary:

```text
OpenAPI DTO <-> API Mapper <-> Application Command/Query <-> Domain Model <-> Persistence Model
```

Not:

```text
OpenAPI DTO == Domain Model == JPA Entity
```

---

## 26. OperationId as Workflow Glue

`operationId` is often underestimated.

In workflow terms, it can connect:

- generated client method names,
- generated server interface methods,
- test names,
- documentation anchors,
- changelog entries,
- gateway policy references,
- analytics dashboards,
- ownership metadata.

Bad:

```yaml
operationId: getUsingGET
```

Better:

```yaml
operationId: getCaseById
```

For workflow stability, operation IDs should be:

- unique,
- stable,
- meaningful,
- implementation-independent,
- consumer-readable.

Changing `operationId` can break generated SDK consumers even if path and schema remain unchanged.

---

## 27. Examples as Workflow Artifacts

Examples are not decoration.

They are executable understanding.

A mature workflow uses examples for:

- documentation,
- mock server behavior,
- contract tests,
- QA scenarios,
- consumer onboarding,
- SDK examples,
- regression fixtures.

Bad workflow:

```text
Examples are written after implementation for Swagger UI prettiness.
```

Good workflow:

```text
Examples are reviewed during design and validated during CI.
```

At minimum, maintain examples for:

- main success request,
- main success response,
- validation failure,
- authorization failure,
- conflict,
- not found,
- async accepted if relevant.

---

## 28. Workflow for Brownfield APIs

Many Java teams already have APIs and want to introduce OpenAPI.

Do not pretend you are greenfield.

A realistic brownfield path:

```text
1. Generate or extract current OpenAPI from implementation.
2. Compare generated spec with actual production behavior if possible.
3. Manually clean up operation IDs, schemas, descriptions, errors.
4. Identify undocumented behavior.
5. Decide what behavior is officially supported.
6. Publish v1 baseline contract.
7. Add CI diff checks from that baseline onward.
8. Gradually improve schema quality.
9. Add examples and error models.
10. Move high-risk API surfaces toward design/contract-first.
```

Brownfield OpenAPI adoption should start with truth discovery.

Do not start by designing an ideal spec that does not match production.

---

## 29. Workflow for Greenfield APIs

For greenfield API development:

```text
1. Start with use cases and consumers.
2. Sketch capability map.
3. Draft OpenAPI paths and operations.
4. Model request/response schemas separately.
5. Add errors and examples early.
6. Generate mock server.
7. Let consumers integrate with mock.
8. Implement provider.
9. Validate provider behavior.
10. Publish contract with first release.
```

The biggest greenfield mistake is starting with entity classes.

Instead, start with consumer tasks:

- What is the consumer trying to accomplish?
- What information do they have?
- What decision will they make from the response?
- What failure modes must they handle?
- What state transition do they trigger?
- What permissions apply?
- What idempotency/concurrency concerns exist?

Then write the contract.

---

## 30. Workflow for Regulated Case-Management APIs

For enforcement lifecycle, compliance, audit, or high-risk systems, workflow should be more deliberate.

A strong pattern:

```text
1. Requirement or policy rule identified.
2. API capability proposed.
3. OpenAPI operation drafted.
4. Data classification reviewed.
5. Authorization boundary reviewed.
6. Error disclosure reviewed.
7. State transition semantics reviewed.
8. Examples include normal, conflict, forbidden, and audit-relevant cases.
9. Contract linked to tests.
10. Release stores immutable contract version.
```

Why?

Because in regulated systems, an API is not merely integration plumbing.

It is often part of evidence:

- who could do what,
- when behavior changed,
- what data was exposed,
- what errors were possible,
- how state transitions were represented,
- what consumers were told.

For these systems, casual code-first OpenAPI is usually insufficient unless wrapped in strong governance.

---

## 31. Contract Drift

Contract drift happens when implementation and OpenAPI diverge.

There are several types.

## 31.1 Structural Drift

The OpenAPI says one shape, implementation returns another.

Example:

```yaml
status:
  type: string
  enum: [OPEN, CLOSED]
```

Runtime:

```json
{
  "status": "REOPENED"
}
```

## 31.2 Behavioral Drift

The schema matches, but meaning changes.

Example:

```json
{
  "status": "CLOSED"
}
```

Previously meant:

```text
Case has final decision and no pending appeal.
```

Now means:

```text
Case is administratively closed but may reopen automatically.
```

Schema did not change.

Contract changed.

## 31.3 Error Drift

Spec says:

```text
409 for duplicate case
```

Runtime returns:

```text
400 with generic validation error
```

Consumers lose recovery semantics.

## 31.4 Security Drift

Spec says operation requires `case:write`.

Gateway requires `case:admin`.

Implementation allows broader access.

All are dangerous.

## 31.5 Example Drift

Examples no longer validate or no longer represent real behavior.

This hurts onboarding and tests.

---

## 32. Drift Control Techniques

Use multiple controls.

No single tool catches all drift.

| Drift Type | Control |
|---|---|
| Invalid OpenAPI | Spec validation |
| Style inconsistency | Linting |
| Breaking changes | OpenAPI diff |
| Response mismatch | Provider contract tests |
| Request mismatch | Request validation tests |
| Example mismatch | Example validation |
| Generated client breakage | Client compile tests |
| Runtime mismatch | Traffic sampling/observability |
| Semantic drift | Human review, changelog, domain tests |
| Security drift | Auth policy tests and gateway comparison |

Top-tier teams combine automation with focused human review.

---

## 33. API Review Checklist

Before approving an OpenAPI change, ask:

### Consumer Fit

- Does the operation match a real consumer task?
- Is the request shape easy to produce?
- Is the response shape easy to consume?
- Are errors actionable?
- Are examples realistic?

### Contract Precision

- Are required fields correct?
- Are nullable fields intentional?
- Are constraints explicit?
- Are enum values stable?
- Is pagination/filtering documented?
- Are media types correct?

### Compatibility

- Is this additive, breaking, or ambiguous?
- Does it change generated client behavior?
- Does it change operation ID?
- Does it change error handling?
- Does it require migration notes?

### Security

- Is authentication documented?
- Are authorization assumptions clear?
- Are sensitive fields exposed?
- Are error messages safe?
- Are examples free of secrets?

### Implementation Reality

- Can this be implemented efficiently?
- Does it require impossible transactional guarantees?
- Does it imply hidden cross-service joins?
- Can it be tested?
- Can it be observed?

### Governance

- Is ownership clear?
- Is lifecycle status clear?
- Are deprecations represented?
- Is the changelog updated?
- Is the artifact publishable?

---

## 34. Anti-Patterns

## 34.1 “We Have Swagger, So We Have a Contract”

Swagger UI is a presentation layer.

It does not prove:

- compatibility,
- correctness,
- implementation conformance,
- governance,
- consumer approval,
- release integrity.

## 34.2 “The Java Code Is the API Design”

Java code is implementation.

It may reflect design decisions, but it does not automatically represent good API design.

## 34.3 “We Generate Clients, So Consumers Are Safe”

Generated clients can make consumers more fragile if:

- operation IDs change,
- enum values are not forward-compatible,
- nullability is wrong,
- errors are poorly modelled,
- generated models leak into business code.

## 34.4 “Internal APIs Do Not Need Contracts”

Internal does not mean low risk.

An internal API can have:

- many consumers,
- critical workflows,
- difficult deployment coordination,
- strong compatibility needs.

The relevant question is not public vs internal.

The relevant question is consumer impact.

## 34.5 “Contract-First Means Generate the Whole Server”

No.

Contract-first means the contract is authoritative.

It does not require generated architecture.

## 34.6 “OpenAPI Diff Catches All Breaking Changes”

No.

Diff tools catch structural changes.

They may not catch semantic changes such as:

- changed business meaning,
- new authorization behavior,
- changed retry semantics,
- changed sort stability,
- changed side effects.

Human review remains necessary.

---

## 35. Practical Recommendation for Java Software Engineers

Use this rule of thumb.

### For small internal APIs

Use code-first, but export and diff the spec in CI.

```text
Code-first + CI governance
```

### For APIs consumed by multiple teams

Use hybrid.

```text
Design important changes first, generate/export from code, diff against baseline.
```

### For public, partner, SDK, or regulated APIs

Use contract-first.

```text
OpenAPI as versioned contract artifact, implementation conforms to it.
```

### For legacy APIs

Start code-first extraction, then establish a contract baseline.

```text
Discover reality first, govern evolution next.
```

---

## 36. Mental Model: OpenAPI Workflow as Control System

Think of OpenAPI workflow as a control system.

```text
Desired API behavior -> Contract -> Implementation -> Runtime behavior -> Feedback -> Contract evolution
```

If there is no feedback loop, drift grows.

Controls:

- review,
- lint,
- validate,
- test,
- diff,
- publish,
- observe.

The goal is not to eliminate change.

The goal is to make change intentional.

---

## 37. Mini Case Study: Case Creation API

Suppose we need:

```text
Create a regulatory case from an incoming complaint.
```

## 37.1 Naive Code-First

A developer writes:

```java
record ComplaintEntity(
    UUID id,
    String reporterName,
    String reporterEmail,
    String internalRiskScore,
    String status,
    Instant createdAt
) {}
```

Then exposes it as request/response.

Bad result:

- persistence leakage,
- internal risk score exposed,
- ambiguous status,
- no idempotency,
- no conflict response,
- no authorization model,
- no validation examples.

## 37.2 Design-First Thinking

Consumer task:

```text
Submit complaint intake data and receive a case identifier plus intake status.
```

Better request:

```yaml
CreateCaseRequest:
  type: object
  required: [complaintType, narrative, reporter]
  properties:
    complaintType:
      type: string
      enum: [MISCONDUCT, FRAUD, SAFETY, OTHER]
    narrative:
      type: string
      minLength: 20
      maxLength: 10000
    reporter:
      $ref: '#/components/schemas/ReporterInput'
    externalReference:
      type: string
      maxLength: 100
```

Better response:

```yaml
CreateCaseResponse:
  type: object
  required: [caseId, status, createdAt]
  properties:
    caseId:
      type: string
      format: uuid
    status:
      type: string
      enum: [INTAKE_RECEIVED]
    createdAt:
      type: string
      format: date-time
```

Better errors:

```yaml
responses:
  '201':
    description: Case created
  '400':
    description: Invalid intake data
  '401':
    description: Authentication required
  '403':
    description: Not allowed to create cases
  '409':
    description: Duplicate external reference
```

## 37.3 Contract-First Controls

Before release:

- examples validate,
- generated client method name is stable,
- duplicate case scenario tested,
- authorization documented,
- response validation passes,
- baseline diff reviewed,
- contract artifact published.

This is how OpenAPI becomes engineering discipline.

---

## 38. Common Interview/Architecture Discussion Points

If asked “Should we use code-first or contract-first?”, a strong answer is:

```text
It depends on consumer impact and compatibility risk.

For low-risk internal APIs, code-first with CI export, validation, linting, and diff checks may be pragmatic.

For public, partner, SDK-driven, or regulated APIs, contract-first is safer because the API boundary must be reviewed, versioned, tested, and published as an explicit artifact.

For most real Java organizations, a hybrid model works best: design important API changes before implementation, use code generation or annotation generation carefully, validate provider behavior against the contract, and diff every release against the previous contract baseline.
```

That answer shows maturity because it avoids dogma.

---

## 39. Part 012 Checklist

You should now be able to explain:

- why OpenAPI workflow is a source-of-truth decision,
- what code-first means,
- what design-first means,
- what contract-first means,
- why hybrid workflows are common,
- how Java/Spring teams often accidentally create DTO-dump specs,
- why generated OpenAPI is not automatically a governed contract,
- how to prevent drift,
- how to select workflow by API risk,
- why public/partner/regulated APIs need stronger contract discipline,
- why generated code should stay at the boundary,
- why operation IDs and examples matter to workflow stability.

---

## 40. Key Takeaways

1. OpenAPI workflow is not a tooling preference; it is an architectural control decision.
2. Code-first is fast but can expose accidental implementation details.
3. Design-first improves API usability by moving feedback earlier.
4. Contract-first treats OpenAPI as a versioned, testable, supportable boundary.
5. Hybrid is realistic, but only safe when source-of-truth rules are explicit.
6. Java/Spring annotation generation is useful, but inference is not intent.
7. Generated code should support the boundary, not become the domain architecture.
8. Contract drift must be controlled through validation, linting, diffing, tests, and review.
9. The best workflow depends on consumer impact, not ideology.
10. A mature OpenAPI process makes API change intentional, reviewable, testable, and publishable.

---

## 41. References

- OpenAPI Specification v3.2.0 — official specification: https://spec.openapis.org/oas/v3.2.0.html
- OpenAPI Initiative — official site: https://www.openapis.org/
- springdoc-openapi official documentation: https://springdoc.org/
- OpenAPI Generator official documentation: https://openapi-generator.tech/docs/overview
- OpenAPI Generator Java generator documentation: https://openapi-generator.tech/docs/generators/java/
- OpenAPI Generator Spring generator documentation: https://openapi-generator.tech/docs/generators/spring/

---

# End of Part 012

Next part:

`learn-openapi-mastery-for-java-engineers-part-013.md` — Java/Spring OpenAPI Ecosystem: Springdoc, Swagger Core, OpenAPI Generator, and Build Integration

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-011.md">⬅️ OpenAPI Mastery for Java Engineers — Part 011</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-013.md">Part 013 — Java/Spring OpenAPI Ecosystem: Springdoc, Swagger Core, OpenAPI Generator, and Build Integration ➡️</a>
</div>
