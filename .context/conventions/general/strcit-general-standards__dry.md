# Strict General Standards: DRY

> File: `strcit-general-standards__dry.md`  
> Category: General Engineering Standard  
> Principle: DRY — Don't Repeat Yourself  
> Status: Mandatory for LLM-assisted code generation, implementation, refactoring, and review

---

## 1. Purpose

This standard defines how an LLM code agent MUST apply the DRY principle when writing, modifying, reviewing, or refactoring software.

DRY is not merely "avoid copy-paste". DRY is about avoiding duplicated **knowledge**, **intent**, **business rules**, **state rules**, **contracts**, **configuration meaning**, and **decision logic** across a system.

The goal is to prevent systems where a single conceptual change requires coordinated edits in multiple unrelated places, which creates inconsistency, regressions, stale documentation, broken tests, and hidden operational risk.

---

## 2. Canonical Definition

DRY means:

> Every piece of knowledge must have a single, unambiguous, authoritative representation within a system.

For this standard, "knowledge" includes, but is not limited to:

- business rules;
- validation rules;
- workflow/state transition rules;
- authorization rules;
- mapping rules;
- schema definitions;
- API contracts;
- database constraints;
- error code semantics;
- retry/backoff policy;
- timeout policy;
- feature flag meaning;
- configuration defaults;
- domain terminology;
- documentation claims;
- test expectations;
- infrastructure topology assumptions;
- generated code source definitions.

---

## 3. Core Interpretation

### 3.1 DRY is about knowledge, not text

Identical code is not automatically a DRY violation. Similar-looking code may represent different domain concepts.

Different-looking code may still violate DRY if it encodes the same rule in two places.

The LLM MUST distinguish between:

| Situation                              |             DRY meaning | Required action                           |
| -------------------------------------- | ----------------------: | ----------------------------------------- |
| Same text, same reason to change       |        Real duplication | Consolidate or create one source of truth |
| Same text, different reasons to change |   Coincidental sameness | Keep separate                             |
| Different text, same rule              |    Semantic duplication | Consolidate the rule                      |
| Generated copies from one schema       |  Controlled duplication | Keep generated files read-only            |
| Cached derived value                   | Intentional duplication | Localize and enforce invalidation         |

### 3.2 The correct question

Before abstracting, the LLM MUST ask:

> If this rule changes, how many places must change, and are those places logically related?

If the answer is "multiple unrelated places", the design violates DRY.

### 3.3 DRY does not mean premature abstraction

The LLM MUST NOT create abstractions only because two code blocks look similar.

A bad abstraction is worse than local duplication when it couples unrelated concepts, hides intent, or makes future change harder.

---

## 4. Mandatory Rules

### DRY-001: Business rules MUST have one authoritative location

A business rule MUST NOT be independently reimplemented in controllers, services, validators, UI logic, SQL, jobs, and tests.

Bad:

```text
Controller checks: amount <= 100000
Service checks: amount <= 100000
Frontend checks: amount <= 100000
SQL job checks: amount <= 100000
```

Good:

```text
Limit rule is defined once as a domain policy, schema, rule table, or configuration-backed domain service.
Other layers call, reference, generate from, or validate against that source.
```

Client-side validation MAY duplicate server-side validation only as a user-experience optimization. The server-side/domain rule remains authoritative.

---

### DRY-002: State transition logic MUST be centralized

Workflow and lifecycle rules MUST NOT be scattered across handlers, controllers, buttons, scheduled jobs, and database scripts.

For any stateful domain object, the LLM MUST identify or create a single authoritative transition model.

Required state model information:

- allowed source state;
- target state;
- triggering command/event;
- actor/role constraints;
- guard conditions;
- side effects;
- audit requirements;
- idempotency behavior;
- illegal transition behavior.

Bad:

```java
if (caseStatus.equals("OPEN")) {
    caseStatus = "ESCALATED";
}
```

Good:

```java
caseWorkflow.transition(caseId, EscalateCase.command(actor, reason));
```

---

### DRY-003: Authorization rules MUST NOT be duplicated casually

Permission checks MUST NOT be copied into every endpoint or UI action.

The LLM MUST prefer one of:

- centralized authorization policy;
- declarative permission annotation backed by one evaluator;
- policy engine;
- role-capability matrix;
- domain method that enforces authorization close to the protected action.

UI permission checks are presentation hints only. Backend authorization remains mandatory and authoritative.

---

### DRY-004: API contracts MUST have a single source of truth

The LLM MUST NOT manually maintain multiple inconsistent request/response definitions.

Preferred sources of truth:

- OpenAPI specification;
- protobuf/IDL;
- GraphQL schema;
- typed contract package;
- JSON Schema;
- shared generated client/server models;
- schema-first validation.

Generated artifacts MUST NOT be manually edited.

If generated code is modified manually, the LLM MUST stop and report a standards violation.

---

### DRY-005: Database schema knowledge MUST NOT be manually mirrored unnecessarily

The LLM MUST avoid manually duplicating database schema constraints in disconnected code unless the duplication has a clear purpose.

Examples of duplicated schema knowledge:

- column length repeated in DTO annotations;
- enum values repeated in frontend constants;
- foreign key rules repeated in service code;
- nullable rules repeated in custom validators;
- table names repeated as raw strings;
- migration rules repeated in documentation only.

Allowed approaches:

- generate types from schema;
- generate schema from code model;
- centralize constants;
- use migration files as the authoritative schema history;
- use integration tests to verify code-schema alignment.

---

### DRY-006: Constants and magic values MUST be named once

Repeated literals that carry domain meaning MUST be extracted into an authoritative named construct.

Examples:

- timeout values;
- retry counts;
- status codes;
- queue names;
- topic names;
- role names;
- permission keys;
- date/time formats;
- currency codes;
- regulatory thresholds;
- storage paths;
- external system identifiers.

Exception: trivial local literals with no domain meaning MAY remain inline.

Bad:

```java
if (days > 14) { ... }
if (appealWindow <= 14) { ... }
```

Good:

```java
private static final int APPEAL_WINDOW_DAYS = 14;
```

Better when rule is business-owned:

```java
appealPolicy.isWithinAppealWindow(submissionDate, decisionDate);
```

---

### DRY-007: Derived data MUST be computed, generated, or explicitly synchronized

If value B can be derived from value A, the LLM MUST NOT store both casually.

Examples:

- storing `age` when `dateOfBirth` exists;
- storing `lineTotal` when `quantity * unitPrice` exists;
- storing `fullName` when `firstName + lastName` exists;
- storing `caseAgeDays` when `createdAt` exists.

Derived storage is allowed only when justified by:

- performance;
- reporting snapshot requirements;
- audit/legal immutability;
- external integration contract;
- denormalized read model;
- historical correctness.

When derived data is stored, the LLM MUST define:

- source fields;
- recomputation trigger;
- invalidation strategy;
- consistency guarantees;
- repair/rebuild path;
- test coverage.

---

### DRY-008: Documentation MUST NOT repeat implementation details that will drift

Comments and documentation MUST NOT restate code line-by-line.

Bad:

```java
// Add 1 to retry count
retryCount = retryCount + 1;
```

Good:

```java
// Retry count is incremented before dispatch so timeout recovery can detect duplicate attempts.
retryCount = retryCount + 1;
```

Documentation SHOULD explain:

- why the rule exists;
- external constraints;
- regulatory rationale;
- non-obvious trade-offs;
- operational assumptions;
- failure behavior;
- examples that are hard to infer from code.

Documentation MUST be updated when it is the authoritative source or when it explains behavior changed by code.

---

### DRY-009: Tests MUST avoid duplicating production logic

Tests MUST NOT compute expected results by copying the same algorithm under test.

Bad:

```java
var expected = service.calculateFee(input); // same production logic
assertEquals(expected, service.calculateFee(input));
```

Also bad:

```java
var expected = input.getAmount().multiply(rate).add(extra).subtract(discount);
// identical formula copied from production without independent meaning
```

Good:

```java
assertEquals(Money.of("105.00"), feeCalculator.calculate(sampleCase));
```

Tests may duplicate examples and expected outcomes because tests act as executable specification. They MUST NOT duplicate the implementation mechanism.

---

### DRY-010: Error semantics MUST be centralized

The LLM MUST NOT create scattered ad-hoc error messages, error codes, and exception mappings.

Required source of truth SHOULD include:

- stable error code;
- user-safe message;
- developer/debug message;
- HTTP/gRPC/message status mapping;
- retryability;
- audit severity;
- logging level;
- localization key;
- remediation hint.

---

### DRY-011: Configuration meaning MUST be defined once

Configuration names, defaults, valid ranges, and operational meaning MUST be defined in one authoritative place.

The LLM MUST NOT repeat config defaults across:

- application code;
- deployment manifests;
- Helm charts;
- README files;
- tests;
- scripts;
- runbooks.

If duplication is unavoidable, the LLM MUST state which representation is authoritative.

---

### DRY-012: Mapping logic MUST not sprawl

Entity-to-DTO, DTO-to-command, external-contract-to-domain, and persistence-model-to-domain mapping MUST be centralized per boundary.

The LLM MUST avoid repeated hand-written mapping in controllers and handlers.

Acceptable approaches:

- dedicated mapper;
- assembler;
- translation layer;
- code generation;
- declarative mapping library;
- explicit factory when business semantics are involved.

Mapping is not always "dumb". If mapping changes meaning, validates invariants, applies defaults, or resolves references, it belongs in a named boundary component.

---

## 5. DRY Decision Algorithm for LLMs

Before adding or changing code, the LLM MUST follow this sequence:

1. Identify the knowledge being represented.
2. Search the existing codebase for equivalent knowledge, not merely identical text.
3. Determine the authoritative source, if one already exists.
4. If no source exists, create the smallest clear source of truth.
5. Replace dependent representations with calls, references, generation, or validation against the source.
6. Avoid abstracting coincidental sameness.
7. Add tests that verify the source of truth and at least one consuming path.
8. Update documentation only where it explains durable intent or external behavior.
9. Mention any intentional duplication in the implementation notes.

The LLM MUST NOT skip this process when the task touches rules, workflows, permissions, schemas, or integration contracts.

---

## 6. Acceptable Duplication

Duplication is allowed when it is intentional, bounded, and safer than abstraction.

### 6.1 Coincidental sameness

Two concepts may temporarily have identical implementation but different reasons to change.

Example:

```text
Age must be positive.
Quantity must be positive.
```

These are not necessarily the same rule. A legal age rule and an order quantity rule may evolve independently.

### 6.2 Boundary isolation

A domain model and an external API model may look similar but represent different ownership boundaries.

The LLM MUST NOT collapse them into one shared type if that creates coupling between internal domain evolution and external contract stability.

### 6.3 Tests as independent specification

Tests may repeat expected values, examples, and domain scenarios. This is often desirable because tests verify behavior independently from implementation.

### 6.4 Generated duplication

Multiple generated artifacts are acceptable when they come from one source definition.

Rules:

- source file is authoritative;
- generated files are reproducible;
- generated files are not manually edited;
- generation command is documented;
- CI can detect stale generated output where practical.

### 6.5 Performance cache or read model

A cache, materialized view, projection, search index, reporting table, or denormalized read model is allowed when it has explicit synchronization rules.

The LLM MUST document consistency behavior:

- strongly consistent;
- eventually consistent;
- rebuildable;
- best-effort;
- snapshot-based;
- audit-preserving.

### 6.6 Migration bridge

Temporary duplication is allowed during migration when it includes:

- migration reason;
- owner;
- removal condition;
- expiry date or milestone;
- compatibility tests;
- observability for mismatch detection.

---

## 7. Forbidden Anti-Patterns

### 7.1 Copy-paste business logic

Copying business logic to "quickly support another endpoint" is forbidden.

### 7.2 Shared utility dumping ground

Creating `CommonUtils`, `Helper`, `GenericService`, or `BaseManager` as a dumping ground is forbidden.

A shared abstraction must have a coherent domain or technical responsibility.

### 7.3 False DRY abstraction

The LLM MUST NOT merge unrelated concepts into one abstraction merely because the code looks similar.

Symptoms:

- boolean flags controlling unrelated behavior;
- abstract base class with many optional hooks;
- generic method names that hide domain meaning;
- consumers passing lambdas to patch semantic differences;
- one change for module A breaks module B.

### 7.4 Comment-code duplication

Comments that restate what code already expresses are forbidden unless needed for generated documentation or public API clarity.

### 7.5 Parallel enum definitions

The same enum MUST NOT be independently maintained in backend, frontend, database, workflow engine, and documentation.

Use a contract, schema, generated code, or clearly assigned source of truth.

### 7.6 Duplicated validation with no authority

Validation duplicated across frontend, backend, database, and batch jobs without declaring the authoritative layer is forbidden.

### 7.7 Hidden duplication through naming drift

The same concept MUST NOT appear under multiple names unless the difference is intentional and documented.

Examples:

```text
userId, accountId, loginId, principalId
caseStatus, statusCode, lifecycleState
createdDate, submittedAt, lodgementDate
```

If meanings differ, define them. If meanings are the same, unify them.

---

## 8. Required Review Checklist

Before finalizing code, the LLM MUST verify:

- [ ] Did I introduce repeated business rules?
- [ ] Did I introduce repeated state transition logic?
- [ ] Did I duplicate authorization logic?
- [ ] Did I repeat magic values or domain constants?
- [ ] Did I manually mirror schema or API contract knowledge?
- [ ] Did I duplicate production logic inside tests?
- [ ] Did I create a premature abstraction from coincidental sameness?
- [ ] Did I create a shared utility with unclear ownership?
- [ ] Did I update the authoritative source rather than a copy?
- [ ] Did I identify intentional duplication and document why it is safe?
- [ ] Did I avoid manually editing generated files?
- [ ] Did I preserve boundary isolation where shared types would create coupling?

If any answer reveals a violation, the LLM MUST fix the design before completion or explicitly report the unresolved violation.

---

## 9. LLM Implementation Protocol

When implementing a task, the LLM MUST include this reasoning in its private or explicit implementation plan:

```text
DRY analysis:
- What knowledge/rule is being represented?
- Where is the current authoritative source?
- Is there existing similar knowledge in the codebase?
- Is similarity semantic or coincidental?
- Will a future change require edits in multiple places?
- What abstraction/source of truth is the smallest safe one?
- What intentional duplication remains and why?
```

The LLM MUST NOT claim compliance with DRY unless it has performed this analysis.

---

## 10. Refactoring Guidance

### 10.1 Refactor when the same reason to change appears multiple times

Refactor duplicated logic when the same business reason, policy, protocol, or invariant appears in multiple places.

### 10.2 Do not refactor before understanding ownership

Before extracting shared code, determine who owns the knowledge:

- domain layer;
- application layer;
- API contract;
- persistence layer;
- integration boundary;
- UI layer;
- infrastructure/platform layer.

Incorrect ownership creates a worse DRY violation because the source of truth becomes unclear.

### 10.3 Prefer domain language over generic reuse

Bad:

```java
CommonValidator.validatePositive(value);
```

Better:

```java
appealPeriodPolicy.validateWithinAllowedWindow(decisionDate, appealDate);
```

Generic reuse is acceptable for technical mechanics. Domain rules should remain named in domain language.

---

## 11. Severity Levels

| Severity | Violation                                                                       | Example                                                |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Critical | Duplicated rule can cause legal, financial, security, or workflow inconsistency | authorization rule copied differently in two endpoints |
| High     | Duplicated business logic or state transition                                   | status update rules scattered across services          |
| Medium   | Duplicated constants/config/mapping                                             | same queue name repeated in code and deployment        |
| Low      | Cosmetic/local duplication                                                      | repeated local formatting with no domain impact        |

Critical and High violations MUST be fixed before merge unless explicitly accepted by a human reviewer with rationale.

---

## 12. DRY vs Other Principles

### DRY vs KISS

DRY must not produce complex abstractions. If removing duplication makes the code harder to understand, the abstraction is probably wrong or premature.

### DRY vs YAGNI

Do not create an abstraction for imagined future reuse. Create it when the same knowledge already exists or when the requirement clearly establishes one source of truth.

### DRY vs SRP

A single source of truth should have one reason to change. Do not centralize unrelated responsibilities into one class just to avoid duplication.

### DRY vs bounded contexts

Different bounded contexts may intentionally duplicate similar concepts because they own different meanings. Forcing one shared model across contexts can create harmful coupling.

---

## 13. Examples

### 13.1 Bad: duplicated status logic

```java
if (status.equals("DRAFT") || status.equals("RETURNED")) {
    allowEdit = true;
}
```

Repeated in controller, UI, batch job, and service.

### 13.2 Good: centralized policy

```java
boolean allowEdit = applicationPolicy.canEdit(application, actor);
```

The policy owns the rule. UI and backend consume the policy or generated permission view.

---

### 13.3 Bad: duplicated validation in test

```java
Money expected = base.add(base.multiply(rate)).subtract(discount);
assertEquals(expected, calculator.calculate(input));
```

The test repeats the algorithm.

### 13.4 Good: example-based expectation

```java
assertEquals(Money.of("97.50"), calculator.calculate(exampleInput));
```

The test asserts known behavior from a domain scenario.

---

### 13.5 Bad: premature shared abstraction

```java
abstract class AbstractSubmissionProcessor<T> {
    protected abstract boolean shouldNotify(T item);
    protected abstract boolean shouldAudit(T item);
    protected abstract boolean shouldEscalate(T item);
}
```

This may hide unrelated workflows behind one generic lifecycle.

### 13.6 Better: separate concepts until shared knowledge is proven

```java
LicenceRenewalSubmissionProcessor
ComplaintSubmissionProcessor
AppealSubmissionProcessor
```

Extract only a specific shared policy when the same reason to change is proven.

---

## 14. Minimum Acceptance Criteria

A code change satisfies this standard only if:

1. every business rule has one authoritative source;
2. duplicated text has been assessed for semantic duplication;
3. coincidental sameness has not been abstracted prematurely;
4. generated code is not manually edited;
5. derived data has synchronization rules;
6. tests specify behavior without copying implementation;
7. intentional duplication is documented;
8. review checklist has no unresolved Critical or High violations.

---

## 15. Sources Consulted

- The Pragmatic Programmer, DRY excerpt: `https://media.pragprog.com/titles/tpp20/dry.pdf`
- Pragmatic Programmer Tips: `https://pragprog.com/tips/`
- Don't Repeat Yourself overview: `https://en.wikipedia.org/wiki/Don%27t_repeat_yourself`

---

## 16. Enforcement Snippet for LLM Agents

Use this snippet in agent instructions:

```text
When implementing code, apply DRY strictly as knowledge de-duplication, not superficial text de-duplication. Before creating new rules, constants, validators, mappings, status transitions, authorization checks, schemas, config defaults, or error semantics, search for the existing authoritative representation. Do not duplicate business knowledge. Do not create premature abstractions for coincidental sameness. Generated duplication is allowed only from one source of truth. Intentional duplication must be explicitly documented with rationale, owner, and synchronization strategy.
```
