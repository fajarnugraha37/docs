# Strict Coding Standards — Java Modularization

> **Purpose**: define non-negotiable rules for LLM coding agents and human reviewers when modularizing Java applications, libraries, monoliths, or service codebases.
>
> This file is an **overlay standard**. It must be used together with:
>
> - `strict-coding-standards__java_module_and_package_management.md`
> - `strict-coding-standards__java_oop.md`
> - `strict-coding-standards__design_pattern_in_java.md`
> - `strict-coding-standards__java_spring.md` / `strict-coding-standards__java_quarkus.md` where relevant
> - the active Java baseline file: Java 11, 17, 21, or 25

---

## 1. Core Principle

Modularization is not file movement.

A module is a **change boundary**, **ownership boundary**, **dependency boundary**, and **runtime/build boundary** when applicable.

LLM agents must not modularize by mechanically grouping classes by technical type such as:

```text
controller/
service/
repository/
dto/
util/
```

That layout may be acceptable **inside** a module, but it is not itself modular design.

A modularization change is only valid when it makes at least one boundary clearer:

- domain capability boundary
- lifecycle boundary
- ownership/team boundary
- security/trust boundary
- deployment/runtime boundary
- dependency direction boundary
- data ownership boundary
- API contract boundary
- testing boundary
- failure/isolation boundary

---

## 2. Mandatory LLM Behavior

Before changing module/package structure, an LLM agent MUST produce a short **modularization decision note**:

```md
## Modularization Decision

### Existing problem

- ...

### Proposed boundary

- Module/package name:
- Responsibility:
- Public API:
- Internal implementation:
- Data ownership:
- External dependencies:

### Dependency rule

- May depend on:
- Must not depend on:

### Migration impact

- Moved classes:
- Public API impact:
- Reflection/scanning impact:
- Serialization/persistence impact:
- Test impact:

### Rejected alternatives

- ...
```

If the agent cannot explain the boundary, it MUST NOT modularize.

---

## 3. Modularization Levels

### 3.1 Package-Level Modularization

Use when the codebase is small/medium or when JPMS/build modules would add operational friction.

Rules:

- Each package cluster MUST have one clear responsibility.
- Package names MUST express business/domain capability when possible.
- Cross-package access MUST flow in one direction.
- Internal implementation packages MUST not be referenced by unrelated packages.
- Package-private visibility SHOULD be used for internal collaborators.
- Public classes inside package modules MUST represent intentional API.

Allowed:

```text
com.acme.enforcement.casefile
com.acme.enforcement.casefile.api
com.acme.enforcement.casefile.application
com.acme.enforcement.casefile.domain
com.acme.enforcement.casefile.infrastructure.persistence
```

Forbidden:

```text
com.acme.common
com.acme.util
com.acme.shared
com.acme.manager
com.acme.helpers
```

unless the package has a strict, narrow, documented contract.

### 3.2 Build-Module Modularization

Use Maven/Gradle modules when boundaries need independent build, test, dependency, ownership, or publication.

A build module MUST have:

- stable responsibility
- explicit dependencies
- independent test suite
- no cyclic dependency with sibling modules
- no hidden runtime dependency through classpath scanning
- clear artifact ownership

Allowed examples:

```text
case-domain
case-application
case-persistence-jpa
case-rest-api
case-event-adapter
```

Forbidden examples:

```text
common-utils
shared-everything
all-models
core
base
framework
```

unless justified by an architecture decision record.

### 3.3 JPMS Modularization

Use Java Platform Module System only when strong encapsulation, reliable configuration, or explicit Java module boundaries are beneficial.

JPMS is not mandatory for all services.

When JPMS is used:

- `module-info.java` MUST be minimal.
- `exports` MUST expose only stable API packages.
- `opens` MUST be targeted and justified.
- `requires transitive` MUST be used only when exported public API exposes dependency types.
- split packages are forbidden.
- accidental automatic-module dependency is forbidden for stable libraries.
- `--add-opens` and `--add-exports` are temporary migration tools, not design solutions.

---

## 4. Boundary Types

### 4.1 Domain Capability Boundary

Prefer business capability modules over technical-layer modules.

Good:

```text
enforcement-case/
licensing-application/
document-management/
notification/
audit-log/
```

Weak:

```text
controllers/
services/
repositories/
dtos/
```

Reason: technical-layer grouping often creates cross-cutting dependency soup and makes every business change touch every layer module.

### 4.2 Application Use-Case Boundary

Application services/use cases should coordinate domain logic, transactions, persistence ports, and external adapters.

Rules:

- Application layer may depend on domain.
- Application layer may depend on ports/interfaces.
- Application layer MUST NOT depend directly on infrastructure implementation unless project intentionally follows a simpler architecture.
- Use-case classes MUST not become god services.

Allowed:

```java
final class ApproveCaseUseCase {
    private final CaseRepository cases;
    private final AuthorizationPolicy authorization;
    private final DomainEventPublisher events;
}
```

Forbidden:

```java
final class CaseService {
    // 4,000 lines: persistence + auth + HTTP + email + state machine + reporting
}
```

### 4.3 Data Ownership Boundary

A module that owns data must define:

- aggregate/entity ownership
- table/collection ownership
- migration ownership
- read model exposure
- event/API exposure

Forbidden:

- multiple modules writing the same table without explicit ownership rule
- shared entity model across unrelated modules
- direct repository access across module boundaries
- DTO used as persistence entity and API request/response at the same time

### 4.4 Security Boundary

Security-sensitive code must have explicit module boundaries.

Examples:

- authentication
- authorization policy
- token validation
- cryptography
- secrets access
- audit logging
- tenant isolation

Rules:

- Security policy modules MUST expose narrow API.
- Callers MUST not bypass policy by importing internal classes.
- Security decisions MUST not be duplicated across controllers/services.
- Security-sensitive modules MUST have negative tests.

### 4.5 Integration Boundary

External systems must be isolated behind adapters/gateways.

Rules:

- HTTP/gRPC/message/database clients MUST not leak into domain layer.
- External DTOs MUST not become domain objects.
- Retry/timeout/error mapping MUST live near adapter boundary.
- Integration adapters MUST document failure modes.

Allowed:

```text
case-application -> notification-port
notification-smtp-adapter -> notification-port
```

Forbidden:

```text
case-domain -> jakarta.mail.Transport
case-domain -> okhttp3.OkHttpClient
case-domain -> SqsClient
```

---

## 5. Dependency Direction Rules

### 5.1 Default Direction

```text
api/adapters  -> application -> domain
infrastructure -> application/domain ports
```

or, in simple layered systems:

```text
controller -> service -> repository
```

but dependencies MUST not point backward.

Forbidden:

```text
domain -> application
domain -> controller
domain -> repository implementation
application -> REST controller
repository -> service
```

### 5.2 Cycles Are Forbidden

Cyclic dependencies between packages/modules are forbidden.

Examples:

```text
case -> document -> case
application -> infrastructure -> application
api -> service -> api
```

Fix strategies:

- introduce an interface/port
- extract a third module containing stable shared abstraction
- move behavior to the true owner
- use domain event instead of direct synchronous dependency
- split read model from write model

Do not “fix” cycles by creating `common` and dumping everything into it.

### 5.3 Stable API Before Shared Module

Shared module creation requires all of the following:

- at least two consumers
- stable contract
- explicit semantic versioning/change policy
- no dependency on consuming modules
- tests for public API
- owner responsible for compatibility

Forbidden shared modules:

- `common-utils`
- `shared-models`
- `base-service`
- `framework-utils`
- `constants`

unless narrowly scoped and reviewed.

---

## 6. Package Naming Rules

### 6.1 Names Must Express Ownership

Good:

```text
com.company.enforcement.casefile.domain
com.company.enforcement.casefile.application
com.company.enforcement.casefile.adapter.jpa
com.company.enforcement.casefile.adapter.rest
```

Bad:

```text
com.company.service.impl
com.company.business.logic
com.company.common.utils
com.company.newpackage
com.company.temp
```

### 6.2 Do Not Use Generic Names

Forbidden package/class fragments unless justified:

- `util`
- `helper`
- `manager`
- `processor`
- `handler`
- `common`
- `shared`
- `base`
- `core`
- `misc`
- `generic`
- `framework`

These names usually hide missing domain vocabulary.

### 6.3 Internal Package Rule

If a package/module has internal implementation, use an explicit marker:

```text
com.acme.casefile.internal
com.acme.casefile.infrastructure.internal
```

Rules:

- No external module may import `.internal.*`.
- If JPMS is used, internal packages MUST NOT be exported.
- Test code may access internals only through package-private tests or explicit test fixtures.

---

## 7. API Surface Rules

A module public API must be intentionally small.

Public API may include:

- use-case interface
- command/query DTO
- domain event type
- repository port
- policy interface
- exception/error type
- configuration property type

Public API must not include:

- persistence entity unless persistence is the module purpose
- framework-specific controller classes
- mutable internal model
- generated mapper implementation
- cache implementation
- raw client object
- internal exception type

Public API changes require review for:

- binary/source compatibility
- serialization compatibility
- API docs
- tests
- migration impact

---

## 8. Layering Inside a Module

Recommended internal structure for complex modules:

```text
casefile/
  api/                  # stable public API for other modules
  application/          # use cases, commands, transactions
  domain/               # aggregate, policy, value object, domain events
  infrastructure/       # persistence, messaging, external adapters
  presentation/         # REST/RPC/UI if colocated
```

For simple modules, do not over-split. A smaller package structure is acceptable.

Forbidden:

- one class per artificial layer when there is no behavior
- abstraction before actual variation
- interface for every class
- package explosion with no dependency rule
- domain package that only contains anemic getters/setters

---

## 9. Modularization and Framework Scanning

When moving packages, check framework scanning impact.

Affected mechanisms:

- Spring component scanning
- Quarkus build-time indexing
- CDI bean discovery
- JPA entity scanning
- MyBatis mapper scanning
- Jackson subtype scanning
- Bean Validation constraint discovery
- ServiceLoader providers
- reflection/native-image config
- XML/JAXB/Jakarta binding packages
- test slice scanning

LLM agents MUST NOT move packages without updating scanning configuration and tests.

---

## 10. Modularization and Persistence

Persistence boundaries must be explicit.

Rules:

- Entity classes belong to the module that owns persistence state.
- Repository interfaces belong to application/domain boundary only if they are ports.
- Repository implementations belong to infrastructure.
- Cross-module access to persistence tables must use API/query/read-model, not direct entity/repository import.
- Database migration files must be owned by the module/team that owns the schema.

Forbidden:

- central `entities` module imported everywhere
- central `repositories` module imported everywhere
- module A updating module B table without an owned interface/event contract
- shared mutable entity object across bounded contexts

---

## 11. Modularization and Transactions

Transaction boundaries belong to use cases, not repositories/controllers by default.

Rules:

- One application use case should define one clear transaction boundary where possible.
- Cross-module transaction coordination must be explicit.
- Do not hide distributed transaction assumptions behind modularization.
- If operation crosses service/data boundary, prefer saga/process manager/outbox/eventual consistency where appropriate.

Forbidden:

- nested transaction behavior not documented
- transaction annotation on random helper methods
- database transaction spanning slow external network call
- module boundary that forces every use case into distributed transaction

---

## 12. Modularization and Error Handling

Each module must define error boundary rules:

- internal exceptions
- public exceptions/error codes
- retryable vs non-retryable failures
- validation failure vs conflict vs invariant violation
- adapter failure mapping

Internal exception classes must not leak across module boundaries unless they are part of public API.

Example:

```text
S3TimeoutException -> DocumentStorageUnavailable -> HTTP 503 / retryable=true
DuplicateCaseNumberException -> CaseConflict -> HTTP 409 / retryable=false
```

---

## 13. Modularization and Events

Use events to decouple modules only when eventual consistency is acceptable.

Rules:

- Events must have schema/version/owner.
- Events must represent business facts, not internal method calls.
- Consumers must be idempotent.
- Ordering assumptions must be documented.
- Failure handling must be explicit.

Forbidden event names:

```text
ProcessEvent
DataChanged
EntityUpdated
SomethingHappened
SyncEvent
```

Allowed event names:

```text
CaseApproved
LicenseApplicationSubmitted
DocumentArchived
PaymentReconciled
```

---

## 14. Modularization and Tests

Every modularization change must include tests showing boundary correctness.

Required where applicable:

- unit tests for moved behavior
- integration tests for framework scanning
- architecture tests for dependency direction
- API compatibility tests if public API changed
- serialization compatibility tests if DTO/event changed
- persistence tests if entity/repository moved
- negative tests for security boundary

Recommended tools:

- ArchUnit for package/layer rules
- Maven/Gradle dependency analysis
- `jdeps` for module/class dependencies
- Spring/Quarkus test slices for scanning

---

## 15. Architecture Test Rules

For mature codebases, add ArchUnit or equivalent rules:

```text
controllers must not access repositories directly
application must not depend on presentation
infrastructure must not be imported by domain
internal packages must not be accessed from outside owner package
modules must not have cycles
```

LLM agents modifying modular structure SHOULD add/update architecture tests when the project already uses architecture tests.

---

## 16. Migration Strategy

### 16.1 Strangler Modularization

For legacy monoliths, prefer incremental extraction:

1. identify capability slice
2. define public API/port
3. move behavior behind package boundary
4. isolate data access
5. add tests
6. introduce build module only when package boundary is stable
7. introduce JPMS only when build-module boundary is stable and ecosystem supports it

### 16.2 No Big Bang Refactor

Forbidden unless explicitly requested:

- moving hundreds of classes in one step
- rewriting architecture without behavior tests
- renaming packages while changing business logic
- extracting modules before dependency cycles are understood
- mixing formatting-only changes with modularization

### 16.3 Transitional Adapters

Temporary compatibility adapters are allowed only with:

- deprecation marker
- removal plan
- tests
- no new dependency cycle
- no silent behavior change

---

## 17. JPMS-Specific Guardrails

### 17.1 `exports`

Use only for packages intended as compile-time API.

```java
module com.acme.casefile {
    exports com.acme.casefile.api;
}
```

Do not export implementation packages.

### 17.2 `opens`

Use only for reflection frameworks and preferably target a specific module.

```java
opens com.acme.casefile.adapter.jpa to org.hibernate.orm.core;
```

Forbidden:

```java
open module com.acme.casefile { }
```

unless the module is explicitly a framework/integration module with documented reason.

### 17.3 `requires transitive`

Use only when public exported API exposes types from another module.

Forbidden:

```java
requires transitive com.fasterxml.jackson.databind;
```

just because implementation uses Jackson internally.

### 17.4 Automatic Modules

Automatic modules are allowed only as transitional dependencies.

Rules:

- document dependency
- track replacement/upgrade
- do not build stable public module contract around unstable automatic module name

---

## 18. Modularization Anti-Patterns

### 18.1 Technical-Layer Module Split

Bad:

```text
app-controllers
app-services
app-repositories
app-dtos
```

This often forces every feature to touch every module and creates high coupling.

### 18.2 Common Module Sinkhole

Bad:

```text
common/
  DateUtils
  JsonUtils
  AuthUtils
  CaseStatus
  CustomerDto
  EmailClient
```

Fix:

- move behavior to owning capability
- create narrow module only when API is stable
- prefer dependency inversion instead of shared dumping ground

### 18.3 Interface-for-Every-Class

Bad:

```java
interface UserService { }
class UserServiceImpl implements UserService { }
```

without alternate implementation, port boundary, mock need, or stable external API.

### 18.4 Package-by-Framework

Bad:

```text
spring/
jackson/
hibernate/
kafka/
```

unless the module is truly a framework adapter module.

### 18.5 Circular Modularization

Bad:

```text
case depends on document
document depends on notification
notification depends on case
```

Fix by extracting a stable abstraction, changing ownership, or converting to event contract.

### 18.6 API Leaks Infrastructure

Bad:

```java
public interface CaseApi {
    JpaCaseEntity getCase(UUID id);
}
```

Public API must not expose infrastructure entity.

---

## 19. LLM Refactoring Protocol

When asked to modularize, the LLM MUST follow this sequence:

1. map current dependency graph from files/imports/build descriptors
2. identify current cycles and hidden framework scanning
3. propose smallest boundary-preserving move
4. separate pure move from behavior change
5. update package declarations/imports/build config
6. update scanning/reflection/configuration
7. update tests and architecture rules
8. provide migration note

The LLM MUST NOT:

- invent modules not requested by evidence
- move files without updating imports/tests
- add dependency to “make compile pass” without dependency-direction justification
- create `common`/`shared` module as a shortcut
- change public package names casually
- remove tests because packages changed

---

## 20. Reviewer Checklist

A modularization change is acceptable only if all relevant answers are “yes”:

- Is the module/package responsibility clear?
- Is the owner of data/API/error/event contract clear?
- Are dependency directions acyclic?
- Are public APIs minimal and intentional?
- Are internal packages protected from external imports?
- Are framework scanning/reflection configs updated?
- Are persistence/entity/migration ownership rules preserved?
- Are transactions still correctly bounded?
- Are security boundaries preserved or improved?
- Are tests updated for moved behavior?
- Are architecture tests added/updated where appropriate?
- Is the change small enough to review?
- Is the migration impact documented?

---

## 21. Source References

Use these as authoritative anchors when updating this standard:

- OpenJDK JEP 261 — Module System
- OpenJDK JEP 396 — Strongly Encapsulate JDK Internals by Default
- dev.java — Modules learning path
- Oracle Java package naming conventions
- JDK `jdeps` documentation
- Google Java Style Guide
- Project-specific architecture decision records
