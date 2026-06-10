# Strict Coding Standards — Go Modularize

> Mandatory engineering conventions for LLM-assisted package design, module layout, dependency direction, public API boundaries, and codebase modularization in Go.
>
> This document is a merge gate for structure. It is not a generic folder-layout preference document.

---

## 0. Scope

This document defines strict rules for organizing Go code into packages, modules, commands, internal libraries, adapters, domain areas, and test boundaries.

It applies to:

- new Go services;
- existing service refactoring;
- monolith-to-module decomposition;
- microservice repository layout;
- shared library extraction;
- command-line tools;
- background workers;
- generated code;
- API clients;
- testing utilities;
- LLM-generated code changes.

The goal is to prevent these common failures:

1. package names that describe technical layers but hide domain meaning;
2. circular dependencies caused by poor boundary design;
3. global `pkg` or `utils` dumping grounds;
4. external DTOs leaking into domain code;
5. infrastructure importing application/domain incorrectly;
6. modules split too early and versioned without need;
7. shared libraries becoming distributed monoliths;
8. LLMs adding files wherever compilation is easiest rather than where ownership belongs.

---

## 1. Source Baseline

Use this document together with these canonical references:

- Go language specification: <https://go.dev/ref/spec>
- Effective Go: <https://go.dev/doc/effective_go>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- Go Doc Comments: <https://go.dev/doc/comment>
- How to Write Go Code: <https://go.dev/doc/code>
- Organizing a Go module: <https://go.dev/doc/modules/layout>
- Go Modules Reference: <https://go.dev/ref/mod>
- go.mod file reference: <https://go.dev/doc/modules/gomod-ref>
- Managing dependencies: <https://go.dev/doc/modules/managing-dependencies>
- Workspaces tutorial: <https://go.dev/doc/tutorial/workspaces>
- Go workspaces blog: <https://go.dev/blog/get-familiar-with-workspaces>
- Package names: <https://go.dev/blog/package-names>
- Organizing Go code: <https://go.dev/blog/organizing-go-code>
- Type aliases: <https://go.dev/blog/alias-names>
- Go doc comment syntax: <https://go.dev/doc/comment>
- `cmd/go`: <https://pkg.go.dev/cmd/go>

If this document conflicts with official Go documentation, official Go documentation wins.

---

## 2. Normative Language

- **MUST** means required.
- **MUST NOT** means forbidden.
- **SHOULD** means expected unless documented otherwise.
- **MAY** means permitted with judgment.
- **LLM MUST** means the code agent must enforce the rule before writing, editing, or reviewing code.

---

## 3. Core Modularization Principle

A Go package is not a folder for related files. A Go package is a compilation unit and API boundary.

Therefore every package MUST have:

- one clear responsibility;
- one clear owner concept;
- a package name that callers can read naturally;
- minimal exported API;
- no circular dependencies;
- tests at the correct boundary;
- dependency direction that can be explained.

The LLM MUST NOT add a file to an existing package just because it avoids import work.

---

## 4. Package Design Rules

### 4.1 Package name must describe purpose, not layer jargon

Good package names are short, lower-case, and meaningful at call site.

Good:

```go
import "example.com/app/caseflow"
import "example.com/app/approval"
import "example.com/app/identity"
import "example.com/app/outbox"
```

Bad:

```go
import "example.com/app/common"
import "example.com/app/utils"
import "example.com/app/helpers"
import "example.com/app/managers"
import "example.com/app/services"
```

Forbidden package names unless narrowly justified:

- `common`
- `shared`
- `utils`
- `helper`
- `misc`
- `base`
- `core` with no precise domain meaning
- `service` as a catch-all
- `manager` as a catch-all
- `models` as a mixed DTO/domain/persistence dump

### 4.2 Package name must work at call site

The LLM MUST check how exported symbols read with package name.

Bad:

```go
user.UserService
user.UserRepository
```

Better:

```go
identity.Service
identity.Store
```

Bad:

```go
validation.ValidateApplication
```

Better:

```go
application.Validate
```

### 4.3 One package should not contain unrelated roles

A package MUST NOT mix:

- HTTP handlers;
- database rows;
- domain entities;
- migration code;
- external API clients;
- business workflow;
- tests/fakes;
- generated API code;

unless the package is intentionally tiny and private at an application edge.

---

## 5. Module Layout Standards

### 5.1 Default service layout

A typical Go service SHOULD use this structure unless project constraints differ:

```text
service-root/
  go.mod
  go.sum
  README.md
  cmd/
    service-name/
      main.go
  internal/
    app/
    config/
    httpapi/
    grpcapi/
    worker/
    domain-or-capability/
    persistence/
    integration/
    telemetry/
  migrations/
  testdata/
```

Rules:

- `cmd/<name>/main.go` wires the application and starts processes.
- `internal/` contains code not intended as public module API.
- package names under `internal/` should still be meaningful.
- `migrations/` contains DB migration files, not runtime SQL access code.
- `testdata/` is for test fixtures recognized by Go tooling.

### 5.2 Command packages

Each executable command MUST live under `cmd/<command-name>` and use `package main`.

`main.go` MUST remain thin:

- parse config;
- initialize logger/telemetry;
- initialize dependencies;
- call `Run(ctx)` or equivalent;
- handle shutdown;
- map final error to process exit.

`main.go` MUST NOT contain domain logic, SQL queries, HTTP handler logic, retry policy, or workflow transitions.

### 5.3 Internal packages

Use `internal/` to enforce private implementation boundaries at compile time.

Code inside `internal/` MUST NOT be imported by external modules outside the parent tree.

LLM MUST prefer `internal/` for service-specific packages that are not intended to be reusable public libraries.

### 5.4 Public packages

A package outside `internal/` is a public API of the module.

Before creating or modifying a public package, the LLM MUST verify:

- exported names are stable;
- doc comments exist;
- compatibility impact is acceptable;
- tests cover public behavior;
- package does not expose implementation details;
- semantic versioning expectations are understood.

Do not create public packages for convenience.

---

## 6. Dependency Direction

### 6.1 Default dependency direction

Use this direction for application services:

```text
cmd/main
  -> app/bootstrap
    -> transport adapters: httpapi/grpcapi/worker
      -> application/usecase
        -> domain/capability
      -> ports/interfaces declared by consumer
    -> infrastructure adapters: persistence/integration/cache/queue
```

Domain code MUST NOT import:

- `net/http`;
- gRPC generated server types;
- database drivers;
- ORM types;
- cloud SDKs;
- Kafka/RabbitMQ clients;
- logging framework unless explicitly accepted;
- telemetry implementation;
- config loader;
- environment variables.

Application/usecase code MAY import domain packages and consumer-owned ports.

Infrastructure code MAY import application/domain interfaces it implements only when needed.

### 6.2 No circular dependencies

Circular dependency is a design failure.

LLM MUST NOT solve circular imports by:

- moving everything into one package;
- creating `common` dumping ground;
- adding global interfaces in a central package;
- using reflection;
- using `any` to avoid imports.

Instead, solve by:

- moving interface to consumer package;
- extracting a smaller value type package;
- splitting command/query concerns;
- moving orchestration upward;
- introducing an adapter boundary;
- consolidating packages that were split too early.

---

## 7. Domain Package Standards

Domain package MUST contain business concepts, invariants, and transitions.

Allowed:

- value objects;
- entity methods;
- domain errors;
- state machine logic;
- policy/specification;
- domain events as pure values;
- validation of domain invariants.

Forbidden in domain package:

- HTTP request/response structs;
- SQL row structs;
- JSON tags unless domain type is intentionally also wire contract;
- ORM tags;
- external vendor DTOs;
- logger dependencies;
- direct DB calls;
- direct network calls;
- environment variable access;
- goroutine lifecycle unless domain explicitly models concurrency.

Example:

```go
package caseflow

type Case struct {
    id      ID
    status  Status
    version int64
}

func (c Case) CanSubmit(actor Actor) Decision { /* ... */ }
```

---

## 8. Application / Use Case Package Standards

Application package orchestrates domain, persistence ports, authorization, transaction, and events.

It MAY contain:

- command handlers;
- query handlers;
- use-case services;
- consumer-owned interfaces;
- transaction/unit-of-work boundary;
- idempotency orchestration;
- outbox orchestration;
- error mapping to application-level errors.

It MUST NOT contain:

- HTTP framework details;
- gRPC generated server details;
- SQL string construction unless intentionally small and documented;
- external provider DTOs;
- HTML template rendering;
- global config reads.

Application package SHOULD define input commands in application terms, not transport terms.

```go
type SubmitCaseCommand struct {
    Actor  Actor
    CaseID caseflow.ID
    Reason string
}
```

---

## 9. Transport Adapter Standards

Transport adapter packages include HTTP, gRPC, CLI, worker, message consumers.

Transport package MUST:

- decode/parse transport input;
- validate syntactic constraints;
- authenticate and extract actor;
- call application use case;
- map application/domain errors to transport responses;
- produce response DTO;
- emit transport telemetry.

Transport package MUST NOT:

- contain domain state transition logic;
- open database transactions directly for business operations;
- publish business events directly;
- bypass application authorization;
- expose persistence rows.

Example package names:

```text
internal/httpapi
internal/grpcapi
internal/worker
internal/consumer
```

---

## 10. Persistence Adapter Standards

Persistence package MUST own database implementation details.

It MAY contain:

- SQL query code;
- row structs;
- scan helpers;
- repository/store implementation;
- DB-specific error translation;
- transaction implementation;
- migration runner integration if runtime-managed.

It MUST NOT expose:

- `sql.Rows`;
- SQL query strings to domain/application;
- database row structs as domain models;
- driver-specific error types across boundary;
- transaction implementation details unless part of a defined port.

Preferred structure:

```text
internal/persistence/
  db.go
  tx.go
  case_store.go
  case_row.go
  errors.go
```

Mapping between row and domain MUST be explicit.

---

## 11. Integration Adapter Standards

Integration packages wrap external systems.

They MUST:

- hide vendor SDK/client types;
- accept context;
- set timeout/deadline;
- validate response;
- map external errors;
- implement retry only when safe;
- redact secrets;
- expose stable internal interface;
- include contract tests or fake server tests.

External DTOs MUST NOT leak into domain/application packages.

Suggested structure:

```text
internal/integration/onemap/
internal/integration/keycloak/
internal/integration/email/
internal/integration/storage/
```

---

## 12. Configuration Package Standards

Config package MAY parse environment variables, files, and flags.

Config package MUST:

- expose typed config structs;
- validate required values;
- avoid global mutable config;
- keep secrets redacted in string/log output;
- distinguish default vs explicit value;
- support test construction without environment mutation where possible.

Forbidden:

```go
var Config GlobalConfig
```

Preferred:

```go
type Config struct {
    HTTP HTTPConfig
    DB   DBConfig
}

func Load() (Config, error) { /* ... */ }
```

Runtime packages receive config via constructor, not global reads.

---

## 13. Telemetry Package Standards

Telemetry package MAY centralize creation of logger, tracer, meter, pprof endpoints, and runtime metrics.

Telemetry package MUST NOT become a dependency sink.

Domain package SHOULD NOT import telemetry implementation.

Application package MAY accept logger/tracer abstractions when useful, but should avoid telemetry coupling in pure domain logic.

Telemetry fields MUST use shared constants only when they prevent drift. Do not create a `common/constants` package for all strings.

---

## 14. Shared Code Standards

### 14.1 Shared code extraction gate

Before extracting shared code, the LLM MUST verify:

- at least two real callers need it;
- the abstraction is stable;
- it does not mix domain concepts from multiple bounded contexts;
- versioning and ownership are clear;
- dependency footprint is small;
- tests cover public behavior;
- extraction does not increase coupling more than duplication would.

Prefer duplication over premature shared abstraction when business rules are still evolving.

### 14.2 Shared module rules

A shared Go module MUST be small and boring.

Good shared module candidates:

- logging field helpers;
- error code primitives;
- pagination value object;
- ID generation;
- crypto wrapper with strict policy;
- telemetry setup standard;
- test containers helper if stable.

Bad shared module candidates:

- generic `common`;
- cross-service domain models;
- giant company SDK that imports every dependency;
- shared repository interfaces;
- global config loader with service-specific assumptions;
- framework that hides service lifecycle.

---

## 15. `pkg/` Directory Policy

`pkg/` is not required in Go.

LLM MUST NOT create `pkg/` automatically.

Use `pkg/` only when:

- the module intentionally exposes reusable public packages;
- API stability is expected;
- docs and tests are present;
- consumers outside the module are intended.

If code is service-private, use `internal/`, not `pkg/`.

---

## 16. `internal/` Directory Policy

Use `internal/` for implementation that should not be imported externally.

Common valid layout:

```text
internal/
  app/
  domain/
  httpapi/
  persistence/
  integration/
```

However, avoid a generic `internal/domain` when multiple bounded contexts exist. Prefer meaningful capability packages:

```text
internal/caseflow/
internal/licensing/
internal/enforcement/
internal/notification/
```

The directory name must communicate ownership.

---

## 17. Generated Code Policy

Generated code MUST live in clearly marked packages or files.

Rules:

- generated files MUST include standard generated-code header;
- generated code MUST NOT be manually edited;
- generated code package should not contain hand-written business logic;
- generated DTOs should be mapped at boundary;
- generated clients should be wrapped by integration adapters;
- generation command should be documented.

Suggested layout:

```text
internal/gen/proto/...
internal/gen/openapi/...
internal/httpapi/mapper.go
internal/integration/vendorclient/adapter.go
```

Do not put hand-written domain logic beside generated files if regeneration can overwrite or confuse ownership.

---

## 18. Interface Placement Standards

Interfaces MUST be placed where they are consumed unless there is a stable public abstraction intentionally exported.

Consumer-owned interface:

```go
package submitcase

type Store interface {
    Load(ctx context.Context, id caseflow.ID) (caseflow.Case, error)
    Save(ctx context.Context, c caseflow.Case) error
}
```

Implementation:

```go
package persistence

type CaseStore struct { db *sql.DB }
```

Forbidden central interface package:

```text
internal/interfaces/
  repositories.go
  services.go
  clients.go
```

This usually creates an anemic abstraction dump.

---

## 19. DTO / Domain / Persistence Separation

A modular codebase MUST separate:

- transport DTO;
- application command/query;
- domain model;
- persistence row/document;
- event payload;
- external provider DTO.

Same struct may cross multiple boundaries only when:

- the boundary is intentionally identical;
- lifecycle is stable;
- tags do not leak unwanted semantics;
- tests prove compatibility;
- reviewers agree.

Forbidden:

```go
type Case struct {
    ID string `json:"id" db:"id" xml:"id"`
    Status string `json:"status" db:"status"`
}
```

Preferred:

```go
type caseResponse struct { /* transport */ }
type caseRow struct { /* persistence */ }
type Case struct { /* domain */ }
```

---

## 20. Error Package Standards

Do not create one giant `errors` package for the entire repository.

Errors should live near the package that owns the semantics.

Allowed shared error primitives:

- code type;
- classification helpers;
- transport mapper;
- sentinel for generic infrastructure condition.

Domain errors should remain in domain/capability package.

```go
var ErrInvalidTransition = errors.New("invalid transition")
```

Transport error mapping belongs at transport edge.

---

## 21. Test Package Structure

### 21.1 Black-box tests

Use external test package when testing public API as a consumer.

```go
package caseflow_test
```

### 21.2 White-box tests

Use same package when testing internal unexported behavior that is part of package correctness.

```go
package caseflow
```

### 21.3 Test helpers

Test helpers MUST be close to the tests that use them.

Avoid global test helper packages unless stable and widely reused.

Allowed:

```text
internal/caseflow/testdata/
internal/caseflow/caseflow_test.go
internal/testsupport/dbtest/
```

`testsupport` package MUST NOT become production dependency.

---

## 22. Import Boundary Rules

LLM MUST run or reason as if running:

```bash
go list ./...
go test ./...
go vet ./...
```

For each new import, LLM MUST verify:

- dependency direction is valid;
- package does not introduce cycle;
- external dependency is necessary;
- dependency is not imported into domain accidentally;
- import does not create startup side effects;
- import name is idiomatic;
- no blank import unless driver/plugin registration is explicit.

Blank imports MUST be accompanied by comment or obvious driver registration context.

```go
import _ "github.com/lib/pq" // registers postgres driver
```

---

## 23. Monorepo and Multi-Module Standards

### 23.1 Single module default

Prefer single module per service/repository unless there is a clear release/versioning boundary.

Do not split modules just because packages are many.

### 23.2 Multi-module use

Use multiple modules only when:

- independent versioning is required;
- independent release lifecycle exists;
- dependency footprints differ significantly;
- separate consumers need separate APIs;
- repository intentionally hosts multiple products/libraries.

### 23.3 Workspace use

`go.work` MAY be used for local multi-module development.

Rules:

- `go.work` should not hide missing module requirements in CI;
- CI should verify modules build without accidental local replace dependencies;
- `replace` directives must be temporary and documented;
- workspace should not become production dependency mechanism.

---

## 24. Versioning and Compatibility

Public module/package API changes MUST follow compatibility discipline.

LLM MUST treat these as breaking or potentially breaking:

- removing exported identifier;
- changing function signature;
- changing interface method set;
- changing struct field names/types;
- changing JSON/protobuf/db contract exposed publicly;
- changing error sentinel or classification;
- changing package import path;
- changing behavior not documented but relied on by tests.

Use type aliases only for migration compatibility when identity preservation is intended.

Do not use aliases to avoid proper design boundaries.

---

## 25. Build Tags and Platform Packages

Platform-specific code MUST be isolated with build tags and file suffixes when needed.

Examples:

```text
file_unix.go
file_windows.go
```

Rules:

- build constraints must be minimal and documented;
- platform-specific behavior must have tests where possible;
- public API should remain stable across supported platforms;
- unsupported platforms should fail clearly.

---

## 26. Dependency Management Standards

New third-party dependency requires justification.

LLM MUST check:

- standard library alternative;
- maintenance status;
- security risk;
- transitive dependency footprint;
- license compatibility;
- API stability;
- testability;
- context support;
- observability hooks;
- whether dependency leaks into public API.

Do not add a framework to solve a small package-organization problem.

`go mod tidy` MUST be run after dependency changes.

---

## 27. File Organization Inside Package

Package files SHOULD be grouped by responsibility.

Good:

```text
case.go
state.go
policy.go
events.go
errors.go
store.go
```

Bad:

```text
models.go
services.go
helpers.go
common.go
```

A file named `types.go` is allowed only for small packages. In large packages it becomes a dumping ground.

A file named `interfaces.go` is usually a smell unless the package is explicitly defining a stable public abstraction.

---

## 28. Package Size and Split Criteria

A package SHOULD be split when:

- it has multiple unrelated reasons to change;
- tests require many unrelated fixtures;
- imports show conflicting dependency directions;
- package name becomes vague;
- public API mixes several audiences;
- domain concepts are independent;
- initialization becomes complex;
- generated code mixes with handwritten logic.

A package SHOULD NOT be split when:

- split would create circular dependencies;
- types are tightly coupled and always change together;
- split only follows class-per-file habit;
- split introduces anemic packages with one trivial file each;
- split hides business flow behind excessive indirection.

---

## 29. Bootstrapping and Dependency Injection Layout

Bootstrap belongs near the command or app wiring package.

Suggested:

```text
cmd/service/main.go
internal/bootstrap/app.go
internal/bootstrap/http.go
internal/bootstrap/worker.go
```

Bootstrap MAY import many packages because it wires the graph.

Business packages MUST NOT import bootstrap.

Dependency construction MUST be explicit.

Forbidden:

```go
func init() {
    RegisterGlobalService(...)
}
```

Avoid `init()` except for package-level unavoidable registration with no runtime failure.

---

## 30. Initialization Rules

`init()` MUST NOT:

- read environment configuration;
- open DB/network connections;
- start goroutines;
- register business services globally;
- panic for normal configuration errors;
- perform migration;
- emit logs as normal startup workflow.

`init()` MAY:

- initialize immutable lookup tables;
- register database drivers via blank import;
- validate compile-time constants in rare cases.

Prefer explicit `New` or `Run` functions.

---

## 31. Configuration of LLM Code Changes

When adding code, LLM MUST place it according to ownership:

| Code being added     | Correct location                                               |
| -------------------- | -------------------------------------------------------------- |
| HTTP route/handler   | `internal/httpapi` or equivalent transport package             |
| gRPC server method   | `internal/grpcapi` or generated server adapter package         |
| Use case             | application/capability package                                 |
| Domain state rule    | domain/capability package                                      |
| SQL query            | persistence adapter                                            |
| External REST client | integration adapter                                            |
| Event publisher      | outbox/messaging adapter                                       |
| Config parsing       | config package                                                 |
| Logger/tracer setup  | telemetry/bootstrap                                            |
| CLI flags            | command package                                                |
| Test fixture files   | nearest `testdata/`                                            |
| Reusable test helper | local test file first, `internal/testsupport` only if repeated |

LLM MUST NOT create a new package if an existing package clearly owns the concept.

LLM MUST NOT put new code in a package solely because that package already imports a needed dependency.

---

## 32. Regulatory / Workflow System Modularization

For workflow-heavy systems, module boundaries SHOULD preserve lifecycle concepts.

Prefer packages aligned to capabilities such as:

- `application` or `licensing`;
- `caseflow`;
- `enforcement`;
- `approval`;
- `correspondence`;
- `auditlog`;
- `notification`;
- `deadline`;
- `escalation`.

State-machine and audit rules MUST not be spread across transport and persistence packages.

Cross-entity impact logic SHOULD live in an application/policy package that explicitly depends on required stores.

Regulatory defensibility requires:

- explicit transition functions;
- auditable decision records;
- stable event schemas;
- deterministic ordering where required;
- clear ownership of deadline/escalation calculations.

---

## 33. Modularization Anti-Patterns

Forbidden or strongly discouraged:

1. `internal/common` that imports half the codebase.
2. `pkg/utils` with string/date/http/db helpers mixed together.
3. `models` package containing DTO, row, event, and domain structs.
4. `services` package with every use case.
5. `repositories` package with all DB access for every aggregate.
6. `interfaces` package with all interfaces.
7. `constants` package for unrelated constants.
8. `init()`-based service registration.
9. global DI container.
10. framework module that all services import and cannot escape.
11. public package created before a real external consumer exists.
12. circular dependency solved by moving code to `common`.
13. domain importing transport or persistence.
14. infrastructure calling HTTP handlers/use cases indirectly through globals.
15. generated code mixed with hand-written business logic.
16. tests importing internal production state only because package boundary is wrong.
17. shared module containing business rules for multiple bounded contexts.
18. package split based only on file count, not ownership.
19. package merge based only on import inconvenience.
20. LLM-created `helper.go` without clear ownership.

---

## 34. Modularization Review Checklist

Before finalizing a modularization/code-placement change, the LLM MUST verify:

- [ ] Package name is short, lowercase, and meaningful at call site.
- [ ] Package has one clear responsibility.
- [ ] New code is placed where ownership belongs, not where imports are convenient.
- [ ] No `common`, `utils`, `helper`, `models`, `services`, or `interfaces` dumping ground was created.
- [ ] Domain does not import transport, persistence, vendor SDK, config loader, or framework.
- [ ] DTO/domain/persistence/event/external-provider structs are separated unless intentionally identical.
- [ ] Interfaces are declared by consumers.
- [ ] Public package/exported API is intentional and documented.
- [ ] `internal/` is used for private service implementation.
- [ ] `pkg/` is not used unless external reuse is intended.
- [ ] No circular dependency exists.
- [ ] Transaction and lifecycle ownership are clear.
- [ ] Generated code is isolated from hand-written logic.
- [ ] Tests live at the right boundary.
- [ ] Shared code extraction is justified by real reuse and stable abstraction.
- [ ] Multi-module/workspace usage is justified by versioning/release boundaries.
- [ ] `go test ./...`, `go vet ./...`, and `go mod tidy` expectations are satisfied.

---

## 35. LLM Refactoring Procedure

For a structural refactor, the LLM MUST follow this order:

1. identify current package graph;
2. identify domain/application/transport/persistence/integration ownership;
3. find cycles or dependency inversions;
4. define target package graph;
5. move pure value types first;
6. move interfaces to consumers;
7. move adapters behind interfaces;
8. update constructors/bootstrap;
9. update tests near package boundaries;
10. run formatting, tests, vet, and dependency cleanup;
11. document any compatibility changes.

The LLM MUST avoid big-bang moves when a staged refactor is safer.

---

## 36. Minimal Acceptance Standard

A Go codebase is modularized correctly only if:

1. a new engineer can predict where code belongs;
2. imports reveal dependency direction;
3. package names make caller code readable;
4. domain logic is protected from transport/persistence/vendor details;
5. public API surface is small and intentional;
6. tests can exercise boundaries without global state;
7. shared code does not couple unrelated domains;
8. lifecycle and initialization are explicit;
9. no package exists only because the LLM needed somewhere to put code;
10. `go list ./...` and `go test ./...` can run without circular dependency hacks.
