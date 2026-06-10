# Strict Coding Standards — Go Module and Package Management

> Mandatory conventions for LLM-assisted Go module, dependency, workspace, and package-boundary management.
>
> This document is a merge gate. It is not optional advice. If an implementation conflicts with this standard, the LLM/code agent MUST either fix the implementation or explicitly report the conflict.

---

## 0. Scope

This standard applies to all Go repositories that use modules, including:

- single-service repositories;
- multi-command repositories;
- libraries;
- CLI tools;
- worker services;
- monorepo modules;
- multi-module workspaces;
- generated-code modules;
- internal shared modules;
- integration adapters;
- test-only helper modules.

It covers:

- `go.mod` and `go.sum` rules;
- package boundaries;
- import direction;
- dependency addition/removal;
- `replace`, `exclude`, `retract`, `toolchain`, `tool`, and workspace usage;
- `go.work` policy;
- vendoring;
- private modules;
- generated code organization;
- module versioning;
- dependency security;
- LLM/code-agent behavior when changing module structure.

It does **not** define detailed domain package layout. For that, use `strict-coding-standards__go_modularize.md`.

---

## 1. Source Baseline

Use this document together with these canonical references:

- Go Modules Reference: <https://go.dev/ref/mod>
- `go.mod` reference: <https://go.dev/doc/modules/gomod-ref>
- Managing dependencies: <https://go.dev/doc/modules/managing-dependencies>
- Organizing a Go module: <https://go.dev/doc/modules/layout>
- How to Write Go Code: <https://go.dev/doc/code>
- Go toolchains: <https://go.dev/doc/toolchain>
- Go workspaces tutorial: <https://go.dev/doc/tutorial/workspaces>
- Get familiar with workspaces: <https://go.dev/blog/get-familiar-with-workspaces>
- Package names: <https://go.dev/blog/package-names>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- Go vulnerability management: <https://go.dev/doc/security/vuln/>
- Go security best practices: <https://go.dev/doc/security/best-practices>
- `cmd/go`: <https://pkg.go.dev/cmd/go>

If this standard conflicts with official Go documentation, official Go documentation wins.

---

## 2. Normative Language

- **MUST** means required.
- **MUST NOT** means forbidden.
- **SHOULD** means expected unless a documented reason exists.
- **MAY** means permitted with judgment.
- **LLM MUST** means the code agent must enforce the rule before generating or modifying code.

---

## 3. Core Principles

Go module and package management MUST optimize for:

1. deterministic builds;
2. minimal dependency surface;
3. clear package ownership;
4. stable public API boundaries;
5. safe upgrade path;
6. low supply-chain risk;
7. simple import graph;
8. fast local and CI feedback;
9. reproducible development tooling;
10. compatibility with production release automation.

LLM-generated changes MUST NOT treat dependency management as a mechanical side effect of compiling code.

Every module/package decision MUST answer:

```text
What owns this code?
Who imports it?
What contract does it expose?
What dependencies does it force onto its consumers?
How will it be versioned, tested, and upgraded?
```

---

## 4. Module Boundary Rules

### 4.1 One module by default

A repository SHOULD start with one Go module unless there is a strong reason to split.

Acceptable reasons for multiple modules:

- independently versioned public libraries;
- generated SDK separated from server implementation;
- very large monorepo with independent release cadence;
- separate dependency lifecycle that would otherwise pollute production code;
- shared internal module used by multiple deployables;
- integration test module that must avoid cyclic dependency with production module.

Forbidden reasons:

- “clean architecture needs many modules”;
- “each package should be a module”;
- “LLM created a new module to avoid import-cycle errors”;
- “module split hides bad dependency direction”;
- “dependency conflict was avoided by randomly creating another `go.mod`”.

### 4.2 A module is a release/versioning unit

Every module MUST be treated as a unit of release and dependency versioning.

LLM MUST NOT create a new module unless it can document:

- module path;
- owner;
- release cadence;
- importers;
- public API policy;
- dependency policy;
- CI command;
- tagging/versioning policy;
- security scanning policy.

### 4.3 Module path must be stable

Module path MUST be stable and importable.

Good:

```go
module example.com/acme/payment
module github.com/acme/platform/identity
```

Bad:

```go
module payment
module backend
module local
module test
module github.com/tmp/new-service
```

LLM MUST NOT invent placeholder module paths in production code.

---

## 5. `go.mod` Rules

### 5.1 `go` directive

`go.mod` MUST include an explicit `go` directive.

For projects standardized on Go 1.26:

```go
module example.com/acme/service

go 1.26
```

Project policy MAY require a patch version:

```go
go 1.26.4
```

The selected form MUST be consistent across the repository or workspace.

LLM MUST NOT downgrade the `go` directive to make code compile.

### 5.2 `toolchain` directive

A `toolchain` directive MAY be used to suggest the expected Go toolchain for the main module.

Example:

```go
toolchain go1.26.4
```

Rules:

- `toolchain` MUST NOT be lower than the `go` directive.
- `toolchain` MUST match the project’s CI image/toolchain policy.
- `toolchain` MUST NOT be changed casually during feature implementation.
- LLM MUST NOT add `toolchain` only to satisfy a local environment mismatch.

If a build requires a newer toolchain, update the project toolchain policy and CI together.

### 5.3 `require` directive

Dependencies MUST be explicit and minimal.

LLM MUST NOT add a dependency if the standard library is sufficient and simpler.

Before adding a dependency, LLM MUST evaluate:

- Is this needed at runtime or only for tests/tools?
- Is the module actively maintained?
- Is the license acceptable?
- Does it pull a large transitive dependency tree?
- Does it duplicate an existing project dependency?
- Does it introduce crypto/auth/parsing/network behavior that needs security review?
- Can the behavior be implemented safely with standard library code?

### 5.4 Indirect dependencies

Indirect dependencies MUST be managed by `go mod tidy`, not manually guessed.

LLM MUST NOT edit indirect requirements by hand unless there is a documented module-resolution reason.

### 5.5 `replace` directive

`replace` is dangerous in shared code because it changes dependency resolution.

Allowed:

```go
replace example.com/acme/lib => ../lib
```

only when:

- used in local workspace/development only; or
- required for temporary emergency patch; and
- documented with owner and removal plan.

Forbidden:

```go
replace github.com/vendor/lib => ../random-local-copy
replace github.com/vendor/lib => github.com/some-fork/lib v0.0.0
```

unless approved as an explicit fork policy.

LLM MUST NOT commit local `replace` directives accidentally.

### 5.6 `exclude` directive

`exclude` MAY be used only to block a known-bad version.

It MUST include rationale in a nearby comment or issue reference.

LLM MUST NOT use `exclude` as a trial-and-error dependency resolver.

### 5.7 `retract` directive

Public modules MAY use `retract` for versions that must not be consumed.

LLM MUST NOT add `retract` without release-owner approval because it affects downstream consumers.

### 5.8 `tool` directive

Go 1.24+ supports `tool` directives for executable tool dependencies.

Allowed tools:

- code generators;
- linters;
- mock generators;
- migration CLIs;
- protobuf/buf generators;
- OpenAPI generators;
- vulnerability scanners;
- internal build helpers.

Rules:

```go
tool golang.org/x/tools/cmd/stringer
```

- Tool dependencies MUST be pinned through module resolution.
- Tools MUST be run through `go tool` where project policy requires it.
- Tool dependencies SHOULD be separated if they cause runtime dependency pollution.
- LLM MUST NOT use legacy `tools.go` unless the project deliberately supports older Go versions.
- LLM MUST NOT add globally installed tools as implicit build requirements.

### 5.9 `ignore` directive

If a Go version supports an `ignore` directive in `go.mod`, it MUST be used only according to official Go module semantics and project policy.

LLM MUST NOT invent `ignore` usage to hide broken packages or failed tests.

If code should be excluded from normal builds, prefer correct package layout, build tags, or separate modules.

---

## 6. `go.sum` Rules

`go.sum` MUST be committed for modules that build with external dependencies.

LLM MUST NOT delete `go.sum` to “fix” dependency errors.

Rules:

- `go.sum` MUST be updated by Go commands, not manually edited.
- Unexpected large `go.sum` churn MUST be reviewed.
- `go mod tidy` MUST be run after dependency changes.
- CI MUST fail if `go.mod` or `go.sum` is dirty after tidy.

Recommended CI gate:

```bash
go mod tidy
git diff --exit-code -- go.mod go.sum
```

For workspaces, run the appropriate tidy command per module.

---

## 7. Dependency Addition Gate

Before adding any dependency, LLM MUST produce or encode this decision:

```text
Dependency: <module>
Purpose: <runtime/test/tool>
Used by package(s): <packages>
Alternatives considered: <stdlib/existing dependency/custom>
Security impact: <network/crypto/parser/auth/filesystem/etc>
Transitive risk: <low/medium/high>
License concern: <yes/no/unknown>
Upgrade owner: <team/person/module owner>
```

LLM MUST prefer:

1. standard library;
2. existing approved dependency;
3. small well-maintained library;
4. large framework only with explicit architecture decision.

LLM MUST NOT add dependencies for:

- trivial string helpers;
- basic slices/maps utilities when `slices`, `maps`, or simple loops suffice;
- generic validation without project decision;
- logging when `log/slog` is sufficient;
- HTTP routing without project routing standard;
- cryptography wrappers without security review;
- date/time convenience that hides timezone rules;
- “clean architecture framework” scaffolding.

---

## 8. Dependency Upgrade Rules

Dependency upgrades MUST be intentional.

LLM MUST NOT run broad upgrades like this unless explicitly requested:

```bash
go get -u ./...
```

Preferred targeted upgrade:

```bash
go get example.com/module@v1.2.3
go mod tidy
go test ./...
```

Security patch upgrade:

```bash
govulncheck ./...
go get example.com/vulnerable/module@fixed-version
go mod tidy
go test ./...
govulncheck ./...
```

Every dependency upgrade MUST check:

- release notes/changelog if behavior-sensitive;
- public API compatibility;
- generated-code compatibility;
- vulnerability status;
- test pass;
- binary size or transitive dependency change if relevant.

---

## 9. Major Version Rules

Go modules use semantic import versioning for major versions `v2+`.

Correct:

```go
require example.com/acme/lib/v2 v2.3.0

import "example.com/acme/lib/v2/client"
```

Incorrect:

```go
require example.com/acme/lib v2.3.0
```

LLM MUST NOT “fix” import errors by removing `/v2`, `/v3`, etc.

Major-version upgrades require migration review because APIs and semantics may change.

---

## 10. Private Module Rules

Private modules MUST be configured explicitly in developer and CI environments.

Allowed environment policy:

```bash
go env -w GOPRIVATE=example.com/acme/*
go env -w GONOSUMDB=example.com/acme/*
```

Rules:

- Private module credentials MUST NOT be embedded in `go.mod`.
- Private repository URLs MUST NOT include tokens.
- CI MUST use secure credential injection.
- LLM MUST NOT replace private modules with public forks.
- LLM MUST NOT disable checksum validation globally.

Forbidden:

```bash
go env -w GOSUMDB=off
```

unless an approved enterprise module-proxy policy requires it.

---

## 11. Proxy and Checksum Rules

The default Go module proxy/checksum behavior SHOULD be preserved unless enterprise policy overrides it.

LLM MUST NOT change these casually:

- `GOPROXY`;
- `GOSUMDB`;
- `GONOSUMDB`;
- `GOPRIVATE`;
- `GOINSECURE`.

`GOINSECURE` MUST NOT be used for production module fetching except under a documented internal network policy.

---

## 12. Workspace Rules (`go.work`)

### 12.1 Workspace purpose

`go.work` is for local multi-module development and controlled monorepo workflows.

It MUST NOT be used to hide broken module boundaries.

Allowed:

```bash
go work init ./service-a ./shared ./tools
```

Allowed use cases:

- develop multiple local modules together;
- test cross-module changes before release;
- monorepo CI that intentionally builds multiple modules;
- local replacement without committing `replace` into each module.

### 12.2 Commit policy

Project MUST define whether `go.work` is committed.

Recommended:

- commit `go.work` only for monorepos with official workspace build;
- do not commit personal local `go.work` files in polyrepo development.

LLM MUST check existing repository policy before creating or editing `go.work`.

### 12.3 `go.work.sum`

If workspace commands generate `go.work.sum`, it MUST be treated like a checksum file and reviewed.

LLM MUST NOT delete it blindly.

### 12.4 Workspace vendor

If the project vendors workspace dependencies, use official workspace vendor flow.

LLM MUST NOT manually copy modules into `vendor/`.

---

## 13. Vendoring Rules

Vendoring MAY be used for:

- restricted build environments;
- regulated deployments;
- air-gapped builds;
- reproducibility requirements;
- strict supply-chain review.

Rules:

```bash
go mod vendor
go test -mod=vendor ./...
```

or, for workspace policy:

```bash
go work vendor
go test -mod=vendor ./...
```

LLM MUST NOT edit files under `vendor/` manually.

`vendor/` changes MUST correspond to `go.mod`/`go.sum` changes.

---

## 14. Package Naming Rules

Package names MUST be:

- short;
- lowercase;
- meaningful;
- singular when practical;
- not stuttered with import path;
- not generic dumping grounds.

Good:

```go
package invoice
package policy
package postgres
package httpapi
package audit
```

Bad:

```go
package utils
package common
package helpers
package models
package services
package impl
package manager
package base
```

LLM MUST NOT create `utils`, `common`, or `helpers` packages unless the repository already has a reviewed policy for them.

### 14.1 Avoid package stutter

Bad:

```go
import "example.com/acme/audit"

audit.AuditEvent{}
```

Better:

```go
import "example.com/acme/audit"

audit.Event{}
```

Exported names SHOULD read well with the package name.

---

## 15. Package Boundary Rules

Each package MUST have a clear reason to exist.

A package should own one cohesive concept:

```text
package = cohesive API boundary + implementation + tests
```

LLM MUST NOT create a package for every type or every layer mechanically.

Bad:

```text
internal/domain/entity/user.go
internal/domain/valueobject/email.go
internal/domain/repository/user_repository.go
internal/domain/service/user_service.go
```

if each package contains one tiny type and creates import friction.

Better:

```text
internal/user/
  account.go
  email.go
  policy.go
  repository.go
  service.go
  account_test.go
```

when those concepts change together.

---

## 16. `internal/` Rules

Use `internal/` to enforce import boundaries.

Allowed:

```text
/internal/app
/internal/domain
/internal/postgres
/internal/httpapi
```

Rules:

- internal packages MUST NOT be imported by external modules.
- internal code MAY expose exported identifiers for sibling packages, but those identifiers are not public API outside the parent tree.
- LLM SHOULD prefer `internal/` for application/service implementation packages.
- Public reusable library packages SHOULD live outside `internal/` only with deliberate API commitment.

---

## 17. `cmd/` Rules

Command entrypoints SHOULD live under `cmd/<name>`.

Example:

```text
cmd/api/main.go
cmd/worker/main.go
cmd/migrate/main.go
```

`main.go` MUST remain thin:

- load config;
- wire dependencies;
- start application;
- handle signal/shutdown;
- return exit code.

LLM MUST NOT place business logic in `cmd/.../main.go`.

---

## 18. Public API Package Rules

Packages outside `internal/` are API commitments.

LLM MUST NOT export packages or identifiers casually.

Before creating public API, answer:

```text
Who imports this?
What compatibility promise exists?
What is the minimal public surface?
Can this remain internal?
```

Public package changes MUST avoid breaking downstream consumers unless major-version policy permits it.

---

## 19. Import Direction Rules

Dependency direction MUST be acyclic and intentional.

Recommended application direction:

```text
cmd -> app/bootstrap -> transport -> application -> domain
                         infrastructure -> application/domain interfaces
```

Domain packages MUST NOT import:

- HTTP frameworks;
- gRPC generated server implementations;
- SQL drivers;
- Kafka clients;
- environment/config packages;
- logging infrastructure;
- telemetry SDKs;
- CLI frameworks.

Application packages MAY depend on domain interfaces and infrastructure abstractions.

Infrastructure packages MAY depend inward on domain/application contracts.

LLM MUST NOT solve import cycles by moving code into `common`.

---

## 20. Interface Placement Rules

Interfaces SHOULD be defined by consumers, not providers.

Bad:

```go
package postgres

type UserRepository interface {
    Find(ctx context.Context, id string) (User, error)
}
```

Better:

```go
package user

type Store interface {
    Find(ctx context.Context, id ID) (Account, error)
}
```

Rules:

- Avoid one-method interfaces unless they create a real boundary.
- Avoid “just in case” interfaces.
- Do not export provider-side interfaces only for mocking.
- Use concrete types internally when no abstraction is needed.

---

## 21. Generated Code Rules

Generated code MUST be isolated.

Recommended:

```text
internal/gen/proto/...
internal/gen/openapi/...
internal/gen/sqlc/...
```

or project-specific generated package layout.

Rules:

- Generated files MUST include the generated-code marker.
- Manual edits to generated files are forbidden.
- Generator versions MUST be pinned via `tool` directive, tool module, or build image.
- Generated DTOs MUST NOT become domain models by default.
- Mapping between generated types and domain types MUST be explicit.

LLM MUST NOT edit generated code to fix business behavior.

---

## 22. Test Package Rules

Use internal or external test package intentionally.

Same package tests:

```go
package user
```

Allowed for internal behavior and unexported helpers.

External package tests:

```go
package user_test
```

Preferred for public API behavior.

Rules:

- Do not expose production identifiers only to make tests easier.
- Prefer testing through public behavior where possible.
- Shared test helpers MUST live close to tests unless genuinely reusable.
- `testutil` packages MUST avoid becoming a second framework.

---

## 23. Build Tag Package Rules

Build tags MUST be explicit and documented.

Allowed:

```go
//go:build integration
```

```go
//go:build linux
```

```go
//go:build cgo
```

Rules:

- Every build-tagged file MUST have a clear counterpart or documented build path.
- CI MUST test required build-tag combinations.
- LLM MUST NOT hide broken code behind build tags.
- Build tags MUST NOT encode environment secrets.

---

## 24. Tool Dependency Management

Development tools MUST be version-controlled.

Preferred Go 1.24+ style:

```bash
go get -tool golang.org/x/tools/cmd/stringer@v0.31.0
go tool stringer -type=Status
```

For projects needing separate tool dependency graph:

```text
tools/go.mod
tools/go.sum
```

or a documented `-modfile` policy.

Rules:

- Do not require unpinned globally installed tools.
- Do not install tools with `@latest` in CI.
- Do not mix tool upgrades with feature changes unless required.
- Tool output MUST be checked into source only if project policy requires it.

---

## 25. `go generate` Rules

`go generate` MAY be used for deterministic code generation.

Rules:

- Generation commands MUST be deterministic.
- Tool versions MUST be pinned.
- Generated output MUST be stable across machines.
- `go generate ./...` SHOULD work or documentation MUST say which packages to generate.
- Generation MUST NOT require network access unless explicitly documented.
- Generation MUST NOT depend on local absolute paths.

Bad:

```go
//go:generate sh -c "curl https://example.com/schema | generator"
```

Better:

```go
//go:generate go tool oapi-codegen -config openapi.yaml api.yaml
```

---

## 26. Import Hygiene Rules

LLM MUST ensure imports are:

- used;
- grouped by standard library, third-party, internal;
- `gofmt`/`goimports` formatted;
- not renamed unnecessarily;
- not dot-imported except special test cases;
- not blank-imported unless for side-effect registration with comment.

Allowed blank import with comment:

```go
import (
    "database/sql"

    _ "github.com/jackc/pgx/v5/stdlib" // register pgx database/sql driver
)
```

Forbidden:

```go
import . "github.com/acme/project/internal/testutil"
```

unless a very narrow test convention allows it.

---

## 27. Circular Dependency Rules

Import cycles MUST be resolved by design, not hacks.

Acceptable fixes:

- move shared domain type to the owning package;
- invert dependency through consumer-owned interface;
- split transport DTO from domain model;
- extract stable small package with real cohesion;
- move orchestration to application layer.

Forbidden fixes:

- create `common` package dumping ground;
- move everything into one giant package;
- use reflection to avoid imports;
- use global callbacks;
- create a new module to bypass cycle;
- use `init()` registration to hide dependency direction.

---

## 28. Package Documentation Rules

Exported packages SHOULD have package comments.

For public packages:

```go
// Package audit records immutable security and regulatory events.
package audit
```

For internal packages, comments SHOULD exist when package purpose is not obvious.

LLM MUST NOT generate vague comments:

```go
// Package utils contains utility functions.
```

---

## 29. Versioning Rules for Public Modules

Public modules MUST follow semantic versioning.

Rules:

- `v0` means unstable but still should not break casually.
- `v1` means stable compatibility promise.
- `v2+` requires semantic import version suffix.
- Breaking changes MUST be intentional and documented.
- Deprecated APIs SHOULD include doc comments and migration path.

Deprecation format:

```go
// Deprecated: Use NewStore instead.
func NewRepository(...) *Repository { ... }
```

---

## 30. Minimal Version Selection Awareness

Go uses module version selection rules. LLM MUST NOT assume dependency resolution works like npm/Maven.

Rules:

- Upgrading one module may select newer transitive versions.
- Downgrades must be deliberate.
- `go mod why -m <module>` SHOULD be used to understand dependency paths.
- `go list -m all` SHOULD be used for dependency inventory.

Useful commands:

```bash
go list -m all
go mod why -m example.com/module
go mod graph
go mod tidy
```

---

## 31. Security Gate

Every module MUST be scanned for reachable vulnerabilities.

Required:

```bash
govulncheck ./...
```

Rules:

- Vulnerability findings MUST be triaged.
- Do not suppress findings without documented rationale.
- Do not pin known-vulnerable versions unless mitigation is documented.
- Do not replace with untrusted forks.
- Security-sensitive dependency changes require review.

LLM MUST treat dependencies in these categories as security-sensitive:

- crypto;
- auth;
- JWT/OIDC/OAuth;
- XML/HTML/template parsing;
- compression/archive;
- filesystem/path;
- network clients;
- SQL drivers;
- serialization formats;
- policy engines;
- sandboxing/process execution.

---

## 32. License and Compliance Gate

LLM SHOULD NOT add dependencies with unknown license status.

For production projects, dependency addition SHOULD include license review through the project’s approved tool/process.

LLM MUST NOT assume all GitHub modules are license-safe.

---

## 33. Large Dependency and Framework Gate

Adding large frameworks MUST require architecture justification.

Examples requiring review:

- web frameworks;
- dependency injection frameworks;
- ORM frameworks;
- workflow engines;
- policy engines;
- code generation frameworks;
- distributed tracing/metrics SDK changes;
- cloud provider SDKs;
- Kubernetes clients.

LLM MUST NOT add a framework to avoid writing small explicit code.

---

## 34. Multi-Service Shared Module Rules

Shared modules are dangerous because they create cross-service coupling.

Allowed shared modules:

- stable API client;
- generated contract types;
- observability wrapper;
- security policy primitives;
- domain-neutral utility with strong ownership;
- internal platform client.

Forbidden shared modules:

- shared domain model across bounded contexts;
- shared mutable config objects;
- shared database row structs;
- shared business service interfaces;
- common error package with every possible error;
- generic helper package for unrelated functions.

Every shared module MUST have an owner and versioning policy.

---

## 35. DTO/Domain Package Separation

Transport/generated DTO packages MUST NOT be imported deeply into domain code.

Bad:

```go
package domain

import "example.com/acme/service/internal/gen/openapi"
```

Better:

```text
transport/openapi DTO -> mapper -> domain command/value object
```

Rules:

- Domain owns domain language.
- Transport owns wire contract.
- Persistence owns row/document contract.
- Event packages own event contract.
- Mapper packages translate explicitly.

---

## 36. Package Size and Cohesion Rules

A package is too large if:

- it has unrelated reasons to change;
- tests require huge setup for small behavior;
- importers depend on many unrelated symbols;
- package name no longer describes contents;
- changes frequently create merge conflicts.

A package is too small if:

- it contains one tiny type with no independent behavior;
- imports become noisy;
- users must jump across many packages to understand one workflow;
- it exists only to mirror Java/C# folder conventions.

LLM MUST optimize for cohesion, not folder count.

---

## 37. `init()` Rules

`init()` MUST be avoided except for narrow package initialization needs.

Allowed:

- generated registration required by a tool;
- test-only setup;
- unavoidable driver registration via blank import;
- constant lookup table initialization that cannot be expressed as var literal.

Forbidden:

- dependency injection;
- reading config/env;
- starting goroutines;
- opening network connections;
- registering business handlers globally;
- mutating global application state.

LLM MUST NOT create `init()` to avoid explicit wiring.

---

## 38. Environment-Specific Package Rules

Environment differences MUST be handled through explicit configuration and build/deployment settings, not divergent package graphs.

Forbidden:

```text
internal/prod
internal/dev
internal/uat
```

when these duplicate application logic.

Allowed:

```text
internal/config
internal/bootstrap
```

with environment values injected at startup.

---

## 39. CI Commands

Minimum module management CI gate:

```bash
gofmt -w .
go mod tidy
git diff --exit-code -- go.mod go.sum
go test ./...
go vet ./...
govulncheck ./...
```

If workspace:

```bash
go work sync
go test ./...
```

If vendored:

```bash
go mod vendor
git diff --exit-code -- vendor go.mod go.sum
go test -mod=vendor ./...
```

---

## 40. LLM Dependency Change Protocol

When LLM changes dependencies, it MUST report:

```text
Changed go.mod/go.sum: yes/no
Added modules: <list>
Removed modules: <list>
Updated modules: <list>
Runtime vs tool/test dependency: <classification>
Why needed: <reason>
Commands run: <commands>
Security scan status: <pass/fail/not run>
```

LLM MUST NOT silently modify dependency files.

---

## 41. Forbidden Patterns

LLM MUST NOT:

- create `utils`, `common`, `helpers` as dumping grounds;
- commit local `replace` accidentally;
- add `@latest` dependency in reproducible builds;
- run broad dependency upgrades without request;
- delete `go.sum`;
- disable checksum database globally;
- hide broken packages with build tags;
- split modules to avoid fixing dependency direction;
- expose internal implementation as public package;
- use generated DTO as domain model by default;
- use `go.work` to mask broken module release boundaries;
- add unowned shared modules;
- add large frameworks without architecture decision;
- add tool dependency as runtime dependency without reason;
- require globally installed tools without pinned version;
- edit generated files manually;
- rely on `init()` for application wiring.

---

## 42. Preferred Patterns

LLM SHOULD prefer:

- one module per deployable/release unit;
- `internal/` for implementation packages;
- thin `cmd/<name>/main.go`;
- consumer-owned interfaces;
- explicit dependency injection;
- small cohesive packages;
- standard library where sufficient;
- pinned tool dependencies;
- targeted dependency upgrades;
- `go mod tidy` after dependency edits;
- `govulncheck` in CI;
- clear package docs for exported packages;
- explicit mapper between generated/wire/domain/persistence types;
- workspace only for deliberate multi-module development.

---

## 43. Review Checklist

Before merging Go module/package changes, verify:

- [ ] `go.mod` has correct module path.
- [ ] `go` directive matches project policy.
- [ ] `toolchain` directive, if present, matches CI policy.
- [ ] New dependencies are justified.
- [ ] No accidental `replace` exists.
- [ ] `go.sum` was updated by Go tooling.
- [ ] `go mod tidy` produces no diff.
- [ ] No broad dependency upgrade was mixed into feature work.
- [ ] Private module settings are documented outside source.
- [ ] `go.work` usage follows repository policy.
- [ ] No new `utils/common/helpers` dumping-ground package exists.
- [ ] Package names are short, lower-case, and meaningful.
- [ ] Import graph is acyclic and directionally correct.
- [ ] Public packages are intentional API commitments.
- [ ] Generated code is isolated.
- [ ] Tool versions are pinned.
- [ ] `govulncheck ./...` was run or explicitly deferred.
- [ ] CI commands are documented.

---

## 44. Agent Refusal Conditions

LLM MUST refuse or ask for human decision before doing any of the following:

- adding unreviewed auth/crypto dependency;
- disabling TLS or module checksum verification;
- replacing dependency with unknown fork;
- committing personal local workspace/replace config;
- deleting `go.sum`;
- creating a new module without release/versioning reason;
- moving domain model into generated DTO package;
- hiding failing code behind build tags;
- introducing framework-level dependency without architecture decision.

The refusal should include the safer alternative.
