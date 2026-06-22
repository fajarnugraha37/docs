# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-022.md

# Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memilih substrate automation yang tepat—POSIX sh, Bash, PowerShell, Make, Java/Go/Python CLI, Maven/Gradle, atau CI native—berdasarkan portability, OS target, data shape, safety, team skill, dan lifecycle.

---

## 0. Posisi Part Ini dalam Seri

Sampai sekarang kita sudah membahas:

- Bash dan POSIX shell;
- PowerShell;
- Makefile;
- error handling;
- filesystem/process/data/security;
- Make sebagai workflow facade.

Part 022 adalah bagian pemilihan alat.

Pertanyaan yang sering muncul:

```text
Saya harus menulis ini di Bash, POSIX sh, PowerShell, Makefile, Java, Python, atau Gradle?
```

Jawaban yang baik bukan dogma.

Jawaban yang baik melihat:

- target OS;
- runtime availability;
- data format;
- error model;
- safety requirement;
- complexity;
- expected lifetime;
- testability;
- team familiarity;
- CI/runtime context;
- security boundary;
- future maintainability.

Tujuan part ini:

> Memberikan decision matrix agar kamu tidak memakai Bash untuk JSON API client kompleks, PowerShell untuk minimal Alpine entrypoint, Make untuk business logic, atau Java untuk command 5 baris yang cukup shell.

---

## 1. Automation Substrates

Substrates yang sering dipilih:

1. **POSIX sh**
2. **Bash**
3. **PowerShell**
4. **Makefile**
5. **Maven/Gradle tasks**
6. **Java CLI**
7. **Python/Go/Node CLI**
8. **CI native YAML**
9. **Dockerfile / entrypoint**
10. **Dedicated platform tool**

Masing-masing punya kekuatan dan kelemahan.

---

## 2. Mental Model Singkat

| Tool | Mental Model |
|---|---|
| POSIX sh | minimal shell portable untuk Unix-like |
| Bash | richer Unix shell untuk process/text orchestration |
| PowerShell | object pipeline + .NET automation |
| Make | dependency graph + workflow facade |
| Maven/Gradle | Java build lifecycle/task graph |
| Java CLI | typed domain automation dengan JVM ecosystem |
| Python CLI | quick general-purpose scripting/tooling |
| Go CLI | single-binary operational tool |
| Node CLI | JS ecosystem/tooling |
| CI YAML | orchestration of jobs, permissions, matrix |
| Dockerfile | image construction |
| Entrypoint script | process startup contract |

---

## 3. The Core Decision Question

Before choosing language/tool, ask:

```text
Am I orchestrating existing tools,
or implementing logic?
```

If orchestrating:

- Make;
- Bash;
- PowerShell;
- CI YAML.

If implementing complex logic:

- Java/Go/Python/Node CLI;
- Gradle/Maven plugin/task;
- application code.

Then ask:

```text
Is data mostly text/process output,
structured object/JSON/CSV/REST,
or Java build model?
```

Text/process:

- Bash/POSIX sh.

Structured JSON/CSV/REST:

- PowerShell;
- Python;
- Java/Go CLI;
- `jq` + Bash if small.

Java build model:

- Maven/Gradle.

Workflow naming:

- Make.

---

## 4. POSIX sh

### Best for

- minimal container entrypoints;
- Alpine/BusyBox images;
- `/bin/sh` only environments;
- simple env validation;
- starting one process;
- tiny portable Unix scripts;
- install scripts for Unix-like systems.

### Avoid for

- arrays;
- complex parsing;
- JSON;
- heavy string manipulation;
- concurrency;
- complex error handling;
- multi-platform Windows support;
- large scripts.

### Example good use

```sh
#!/bin/sh
set -eu

: "${APP_ENV:?APP_ENV is required}"

exec java -jar /app/app.jar
```

This is excellent POSIX sh.

### Example bad use

A 400-line deploy script with JSON parsing and retries in POSIX sh.

---

## 5. Bash

### Best for

- Linux/macOS developer automation;
- process orchestration;
- text stream pipelines;
- local scripts;
- CI scripts on Linux runners;
- file operations with arrays;
- glue around Unix tools;
- simple deploy/release wrappers;
- diagnostics scripts.

### Avoid for

- Windows-native automation;
- complex JSON/CSV/XML transformations;
- rich API clients;
- long-term domain tools;
- large business logic;
- untrusted input without careful validation;
- scripts needing strong types.

### Example good use

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

mvn test
docker build -t "$IMAGE" .
```

### Example bad use

Parsing nested JSON with grep/sed/awk and constructing API payloads by string concatenation.

---

## 6. PowerShell

### Best for

- Windows automation;
- cross-platform scripts where `pwsh` is available;
- object pipeline workflows;
- JSON/CSV/XML/REST automation;
- admin scripts;
- Azure/Microsoft ecosystem;
- structured output;
- module-based reusable automation;
- scripts needing rich parameters and validation.

### Avoid for

- minimal Linux containers without `pwsh`;
- POSIX-only entrypoints;
- teams with no PowerShell runtime;
- very large domain tools better as real CLI;
- replacing Bash in Unix text-heavy tasks when Bash is simpler.

### Example good use

```powershell
$response = Invoke-RestMethod -Uri $Uri -TimeoutSec 30
$response.status
```

### Example bad use

Installing PowerShell into a 20MB Alpine runtime image just to validate `APP_ENV` before launching Java.

---

## 7. Makefile

### Best for

- stable workflow facade;
- `make help`;
- local/CI parity;
- composing coarse targets;
- dependency graph for generated files;
- standard target names across repos;
- wrapping Maven/Gradle/Docker/scripts.

### Avoid for

- complex logic;
- JSON/API clients;
- secret-heavy workflows;
- deployment transaction semantics;
- replacing Maven/Gradle;
- cross-platform Windows-native primary UX unless team supports Make.

### Example good use

```make
verify: test build

test:
	./mvnw test

build:
	./mvnw package
```

### Example bad use

200-line inline shell deploy logic with curl, jq, sed, kubectl, retries, and prod branching.

---

## 8. Maven/Gradle

### Best for

- Java compile/test/package;
- dependency resolution;
- plugin lifecycle;
- test reports;
- coverage;
- generated sources integrated into build;
- artifact publishing;
- Java-specific quality checks;
- multi-module Java graph.

### Avoid for

- OS-level admin;
- Docker runtime orchestration beyond plugin use;
- deployment approval/permission logic;
- shell process diagnostics;
- general platform automation not related to build.

### Example good use

```bash
./mvnw verify
./gradlew build
```

### Example bad use

A Gradle task that becomes an entire cloud deployment platform with API calls, approval logic, and secret handling.

---

## 9. Java CLI

### Best for

- typed domain automation;
- complex business rules;
- reuse application libraries;
- API clients with auth/retry/pagination;
- schema validation;
- strong tests;
- long-lived internal tool;
- cross-platform JVM environments;
- integration with existing Java ecosystem.

### Avoid for

- tiny process wrappers;
- minimal containers with no JRE except app runtime constraints;
- quick one-off file cleanup;
- simple command aliases;
- scripts where startup time matters.

### Example good use

```bash
java -jar platform-cli.jar deploy plan --env staging --version 1.2.3
```

### Example bad use

A Java CLI just to run:

```bash
mvn test && docker build ...
```

when Make/Bash is enough.

---

## 10. Python CLI

### Best for

- quick general-purpose scripting;
- JSON/YAML/CSV manipulation;
- API clients;
- text processing beyond shell comfort;
- cross-platform scripting if Python available;
- internal tools with moderate complexity.

### Avoid for

- environments without Python;
- dependency-heavy scripts without packaging strategy;
- Java-only teams that do not maintain Python runtime;
- production automation without dependency pinning.

Python is often pragmatic but introduces runtime/package management concerns.

---

## 11. Go CLI

### Best for

- single static-ish binary distribution;
- operational tools;
- fast startup;
- cross-platform binary releases;
- cloud/Kubernetes tooling ecosystem;
- robust CLI UX;
- long-lived platform tools.

### Avoid for

- Java team unwilling to maintain Go;
- tiny scripts;
- tasks that need JVM/application libraries;
- quick ad-hoc automation.

Go is strong when the tool becomes a product.

---

## 12. Node CLI

### Best for

- frontend/tooling ecosystem;
- JS/TS monorepos;
- npm package distribution;
- OpenAPI/frontend generation;
- developer tooling in Node-heavy teams.

### Avoid for

- Java backend-only teams with no Node runtime;
- OS-level automation;
- security-sensitive scripts with unmanaged dependency sprawl;
- minimal containers.

---

## 13. CI Native YAML

### Best for

- triggers;
- matrix;
- permissions;
- secrets;
- protected environments;
- job dependencies;
- artifacts;
- caching;
- concurrency groups;
- scheduled jobs.

### Avoid for

- complex shell logic;
- business rules;
- local developer workflows;
- duplicated build logic;
- large scripts embedded in YAML.

CI YAML should orchestrate jobs and call scripts/Make/build tools.

---

## 14. Dockerfile and Entrypoint

### Dockerfile best for

- image build;
- runtime filesystem;
- installed dependencies;
- user/permissions;
- entrypoint/cmd;
- image labels.

### Entrypoint best for

- minimal startup validation;
- env-to-argument mapping;
- one-time startup setup;
- signal-safe `exec`.

Entrypoint should be small.

Good:

```sh
#!/bin/sh
set -eu
: "${APP_ENV:?APP_ENV is required}"
exec java -jar /app/app.jar
```

Bad:

A giant deploy/control-plane script inside container entrypoint.

---

## 15. Decision Matrix by Task

| Task | Recommended |
|---|---|
| Minimal container startup | POSIX sh |
| Linux CI process orchestration | Bash |
| Windows server admin | PowerShell |
| REST + JSON automation | PowerShell / Python / real CLI |
| Java build/test/package | Maven/Gradle |
| Workflow facade | Make |
| Production deploy transaction | Script or real CLI + CI gates |
| Complex cloud API client | Java/Go/Python CLI |
| OpenAPI generated source in Java build | Maven/Gradle plugin, maybe Make wrapper |
| Local dev dependencies | Make + Docker Compose |
| File cleanup with safety | Bash/PowerShell script, Make target wrapper |
| Cross-repo standard command names | Make |
| CI matrix | CI YAML |
| Artifact publishing | Maven/Gradle or script/CLI |
| Secrets management | CI/secret manager/platform |
| Diagnostics collection | Bash/PowerShell script |
| Windows/Linux/macOS structured script | PowerShell 7+ |
| Alpine image tiny script | POSIX sh |
| Kubernetes operational CLI | Go/Python/Java CLI or kubectl wrapper script |

---

## 16. Decision Matrix by Data Shape

| Data Shape | Good Choice |
|---|---|
| Raw text lines | Bash, POSIX sh for simple |
| Null-delimited filenames | Bash |
| JSON small/simple | PowerShell, Bash+jq |
| JSON complex | PowerShell/Python/Java/Go |
| CSV | PowerShell/Python |
| XML | PowerShell/.NET, Java/Python |
| Java project model | Maven/Gradle |
| Dependency graph of files | Make |
| Domain entities | Java/Go/Python CLI |
| Process status/exit code | Bash/PowerShell |
| Windows registry/certs | PowerShell |
| Kubernetes YAML | kubectl/kustomize/helm + script/Make facade |

---

## 17. Decision Matrix by Runtime Environment

| Environment | Good Choice |
|---|---|
| BusyBox/Alpine minimal | POSIX sh |
| Ubuntu CI | Bash, Make, PowerShell if installed |
| Windows CI | PowerShell, Maven/Gradle |
| macOS dev | Bash/zsh scripts, Make, PowerShell if installed |
| JVM-only toolchain | Maven/Gradle, Java CLI |
| Polyglot devcontainer | Make + scripts |
| Enterprise Windows admin | PowerShell |
| Kubernetes job container | POSIX sh/Bash + app tool |
| GitHub Actions | YAML + Make/scripts |
| Jenkins agent Linux | Make/Bash/Maven/Gradle |
| Air-gapped controlled env | whatever runtime is preapproved |

---

## 18. Decision Matrix by Risk

| Risk Level | Recommended Approach |
|---|---|
| Read-only local helper | Make/Bash/PowerShell fine |
| Local cleanup | Script with dry-run, Make wrapper |
| CI verification | Make + build tool |
| Artifact publish | Build tool or script with checks |
| Staging deploy | Script/CLI + CI secret handling |
| Production deploy | Script/CLI + CI approvals + IAM |
| DB migration | Migration tool + script wrapper + approval |
| Secret rotation | Dedicated tool/platform, not Make |
| Cloud infra changes | Terraform/Pulumi/CDK + CI gates |
| Data deletion | Real tool with strong validation/audit |

The higher the risk, the less logic should live in Make or ad-hoc shell.

---

## 19. Decision Matrix by Lifetime

| Lifetime | Suitable |
|---|---|
| One-off local command | shell one-liner |
| Repeated personal helper | Bash/PowerShell script |
| Team workflow | Make target + script |
| CI-critical workflow | Make/script + tests/lint |
| Cross-repo standard | module/package/shared CLI |
| Long-lived platform capability | real CLI/application |
| Regulated production operation | platform tool + audit + approval |

Do not over-engineer a one-off. Do not under-engineer production control plane.

---

## 20. Team Skill and Ownership

Best tool is also the one your team can maintain.

Ask:

- Who will review this?
- Who will debug it at 3 AM?
- Is runtime available?
- Does team know the language?
- Is there lint/test support?
- Is there a style guide?
- Is ownership clear?

A technically elegant PowerShell module is bad if nobody can maintain PowerShell.

A Bash script is bad if target is Windows fleet.

A Java CLI is bad if it takes 30 seconds to start for a tiny task.

---

## 21. Portability Levels

Define portability honestly.

### Level 0 — Single machine

Works on author laptop.

### Level 1 — Team OS

Works on agreed dev OS/devcontainer.

### Level 2 — CI OS

Works in CI runner.

### Level 3 — Unix portable

Works on Linux/macOS with POSIX assumptions.

### Level 4 — Cross-platform PowerShell

Works on Windows/Linux/macOS with `pwsh`.

### Level 5 — Packaged CLI

Distributed with versioned runtime/binary.

### Level 6 — Platform-managed

Runs as part of controlled platform with IAM/audit.

State the level in docs.

---

## 22. POSIX sh vs Bash

Choose POSIX sh when:

- `/bin/sh` is guaranteed, Bash is not;
- container minimality matters;
- script simple;
- portability to BusyBox/dash matters.

Choose Bash when:

- arrays needed;
- safer argument arrays;
- better error handling/traps;
- process substitution/mapfile/etc. useful;
- Linux/macOS environment has Bash.

Example:

```text
entrypoint.sh -> POSIX sh
deploy-release.sh -> Bash
```

Do not write Bash and label it sh.

---

## 23. Bash vs PowerShell

Choose Bash when:

- Unix-native process/text tools;
- Linux CI;
- container scripting;
- team Unix-heavy;
- mostly command orchestration.

Choose PowerShell when:

- Windows support;
- object/JSON/CSV/REST;
- strong parameters/validation;
- module reuse;
- cross-platform with `pwsh`;
- Microsoft ecosystem.

Example:

```text
scripts/collect-linux-diagnostics.sh -> Bash
scripts/Build-Metadata.ps1 -> PowerShell
```

---

## 24. Make vs Bash/PowerShell

Choose Make when:

- naming workflows;
- help target;
- composing coarse targets;
- real file generation graph;
- local/CI facade.

Choose Bash/PowerShell when:

- parsing args;
- complex conditionals;
- retries;
- cleanup;
- safety checks;
- API calls;
- JSON/CSV;
- secret handling.

Pattern:

```make
deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan
```

Make names. Script implements.

---

## 25. Make vs Maven/Gradle

Choose Make when:

- exposing `make verify`;
- wrapping Docker/local dependencies;
- composing tools around build;
- cross-repo command convention.

Choose Maven/Gradle when:

- Java build lifecycle;
- generated sources;
- test tasks;
- artifact publishing;
- dependency graph.

Pattern:

```make
build:
	./mvnw package
```

Not:

```make
javac ...
```

---

## 26. Script vs Real CLI

Stay script when:

- <200 lines;
- simple dependencies;
- simple args;
- team can review;
- no complex domain model;
- not many consumers;
- failure modes simple.

Move to real CLI when:

- many subcommands;
- typed config/schema;
- API complexity;
- retries/pagination/auth;
- many tests;
- multiple teams;
- long lifetime;
- packaging/versioning needed.

Transition path:

```text
Make target -> Bash/PowerShell script -> module/shared script -> real CLI
```

---

## 27. Java CLI vs Python/Go CLI

Choose Java CLI when:

- reuse Java libraries/domain models;
- team is Java-heavy;
- JVM already available;
- integration with existing code;
- strong type system desired.

Choose Python CLI when:

- fast scripting;
- data manipulation;
- Python available/owned;
- packaging acceptable.

Choose Go CLI when:

- single binary distribution;
- ops/platform tool;
- fast startup;
- cross-platform release.

For Java software engineer, Java CLI is often underrated for internal platform tooling if startup and packaging are acceptable.

---

## 28. Hybrid Architecture Examples

### Example 1 — Java service repo

```text
Makefile: help, verify, docker/build, deploy/plan
Maven: build/test/package
Bash: Linux deploy script
PowerShell: metadata JSON script
CI: approvals/secrets/matrix
Dockerfile: image
```

### Example 2 — Windows enterprise admin

```text
PowerShell module: reusable admin functions
PowerShell scripts: entrypoints
CI: signed script release
Make: maybe none
```

### Example 3 — Minimal container

```text
Dockerfile
entrypoint.sh: POSIX sh
Java app
No Bash/PowerShell/Make in runtime image
```

### Example 4 — Platform CLI

```text
Go/Java CLI: deploy/release
Makefile: local facade
CI: protected deploy jobs
Scripts: small wrappers only
```

---

## 29. Compatibility Documentation Template

```markdown
## Automation Compatibility

| Entry Point | Runtime | OS | Purpose |
|---|---|---|---|
| Makefile | GNU Make | Linux/devcontainer/CI | Workflow facade |
| scripts/entrypoint.sh | POSIX sh | Linux containers | Runtime startup |
| scripts/deploy-release.sh | Bash 4+ | Linux CI | Release deploy |
| scripts/Build-Metadata.ps1 | PowerShell 7+ | Windows/Linux/macOS | Structured metadata |
| ./mvnw | Java + Maven Wrapper | All dev/CI | Java build |

## Rules

- Maven owns Java build.
- Make owns workflow names.
- Scripts own imperative safety.
- CI owns secrets and approvals.
```

This makes boundary explicit.

---

## 30. Tool Selection Checklist

Before writing automation, answer:

1. What OS/runtime must run this?
2. Is this local, CI, production, or runtime container?
3. Is input trusted?
4. Are secrets involved?
5. Is operation destructive?
6. Is data text or structured?
7. Does it need typed schema?
8. Does it need retries/timeouts?
9. Does it call external APIs?
10. Does it need to be tested?
11. Who owns maintenance?
12. How long will it live?
13. Does this duplicate Maven/Gradle/CI?
14. What is the simplest tool that is still safe?
15. How will users discover it?

---

## 31. Example: Choose Tool for Build Metadata

Task:

```text
Generate JSON with service, version, commit, dirty flag, timestamp, artifact hash.
```

Options:

### Bash + jq

Good if Linux CI and jq installed.

### PowerShell

Good cross-platform structured output.

### Java CLI

Good if metadata logic uses project model or must be reused.

### Make

Bad as primary implementation. Make can wrap.

Recommended:

```make
metadata:
	pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -Output Json
```

or:

```make
metadata:
	./scripts/build-metadata.sh --json
```

depending team/runtime.

---

## 32. Example: Choose Tool for Container Entrypoint

Task:

```text
Validate APP_ENV and exec Java.
```

Recommended: POSIX sh.

```sh
#!/bin/sh
set -eu
: "${APP_ENV:?APP_ENV is required}"
exec java -jar /app/app.jar
```

Do not use PowerShell or Java CLI for this unless runtime already requires it and tradeoff is justified.

---

## 33. Example: Choose Tool for Production Deploy

Task:

```text
Deploy version to prod, call API, verify health, rollback if needed.
```

Make alone: bad.

Bash script: okay if simple and Linux-only, but careful.

PowerShell: okay if structured REST-heavy and `pwsh` available.

Java/Go CLI: better if complex, long-lived, multi-team.

CI: must own approval/secrets.

Recommended architecture:

```text
Make target -> deploy CLI/script -> CI protected environment -> cloud/platform
```

Make:

```make
deploy/plan:
	platform-cli deploy plan --env "$(ENV)" --version "$(VERSION)"

deploy/apply:
	platform-cli deploy apply --env "$(ENV)" --version "$(VERSION)"
```

---

## 34. Example: Choose Tool for OpenAPI Client Generation

Task:

```text
Generate Java client from OpenAPI spec.
```

Options:

- Maven/Gradle plugin if generated sources part of Java build.
- Make stamp target if generation is external workflow.
- Script if generator invocation complex.

Recommended:

If part of compile:

```text
Maven/Gradle plugin
```

If developer workflow:

```make
generate/openapi: build/stamps/openapi-client.stamp
```

with script:

```make
build/stamps/openapi-client.stamp: openapi/service.yaml
	./scripts/generate-openapi-client.sh
	touch $@
```

---

## 35. Example: Choose Tool for Local Dependencies

Task:

```text
Start Postgres, Redis, Kafka for local dev.
```

Recommended:

```make
local/up:
	docker compose up -d

local/down:
	docker compose down
```

If additional validation/seed logic:

```make
local/bootstrap:
	./scripts/local-bootstrap.sh
```

Docker Compose owns containers. Make owns entrypoint. Script owns bootstrap flow.

---

## 36. Example: Choose Tool for Diagnostics

Task:

```text
Collect logs, JVM info, disk, ports, Docker status.
```

Linux-only: Bash.

Windows/cross-platform: PowerShell.

Complex/multi-platform with rich output: PowerShell or Go/Java CLI.

Make:

```make
diagnostics:
	./scripts/collect-diagnostics.sh --output build/diagnostics
```

or:

```make
diagnostics:
	pwsh -NoProfile -File ./scripts/Collect-Diagnostics.ps1
```

---

## 37. Example: Choose Tool for Config Validation

Task:

```text
Validate YAML/JSON config before deploy.
```

Simple JSON: PowerShell or jq.

Complex schema: JSON Schema validator, Java/Python/Node tool.

Make wraps:

```make
config/validate:
	./scripts/validate-config.sh
```

Do not write validation in Make conditionals.

---

## 38. Anti-Pattern Catalog

### 38.1 Bash pretending to be parser

```bash
grep version config.json | cut -d...
```

Use JSON parser.

### 38.2 PowerShell in minimal container

Adds huge runtime for simple env validation.

### 38.3 Make as deployment engine

Long recipe with prod logic and secrets.

### 38.4 CI YAML as shell script

Hundreds of lines under `run:`.

### 38.5 Java CLI for tiny wrapper

Overkill for `mvn test`.

### 38.6 Gradle as cloud platform

Build tool task doing full deploy platform logic.

### 38.7 Duplicated logic

Same version computation in Make, Bash, CI, and Java.

### 38.8 False portability

Script claims cross-platform but calls `grep`, `/bin/bash`, `sed -i`, or registry.

---

## 39. Refactoring Wrong Tool Choices

### Bash script too complex

Move parsing/API logic to PowerShell/Python/Java/Go.

### Makefile too large

Extract scripts; keep Make facade.

### CI YAML too complex

Move logic to scripts/Make; keep CI job orchestration.

### PowerShell not available everywhere

Use Bash/POSIX or containerize runtime.

### Java CLI too heavy

Keep as script if no domain complexity.

### Duplicate Bash and PowerShell drift

Define one source of truth, or generate wrappers around shared CLI.

---

## 40. Practical Architecture Patterns

### Pattern A — Unix-first Java service

```text
Makefile
scripts/*.sh
mvnw/gradlew
Dockerfile
CI calls make ci/verify
```

### Pattern B — Cross-platform enterprise Java service

```text
Makefile optional
scripts/*.ps1 primary
PowerShell module
mvnw/gradlew
CI Windows/Linux matrix
```

### Pattern C — Minimal containerized app

```text
Makefile for dev
entrypoint.sh POSIX sh
Dockerfile multi-stage
CI calls Maven/Docker
```

### Pattern D — Platform tool

```text
platform-cli in Java/Go
Makefile wraps common commands
CI handles release
scripts minimal
```

---

## 41. Portability Matrix Table

| Capability | POSIX sh | Bash | PowerShell | Make | Java CLI |
|---|---:|---:|---:|---:|---:|
| Minimal Unix availability | Excellent | Good | Poor | Mixed | Poor |
| Windows native | Poor | Poor/Mixed | Excellent | Mixed | Excellent if JRE |
| Text pipeline | Basic | Excellent | Good | Poor | Needs code |
| Object/JSON automation | Poor | With jq | Excellent | Poor | Excellent |
| File dependency graph | Poor | Poor | Poor | Excellent | Needs code |
| Java build lifecycle | Poor | Poor | Poor | Facade only | Maven/Gradle better |
| Strong typing | Poor | Poor | Medium | Poor | Excellent |
| Secret-safe complex workflow | Poor | Medium | Medium/Good | Poor | Good |
| Testability | Medium | Medium | Good | Poor/Medium | Excellent |
| Runtime footprint | Tiny | Small | Large | Small/Mixed | Medium/Large |
| Team workflow facade | Medium | Medium | Medium | Excellent | Medium |
| Long-lived platform tool | Poor | Poor/Medium | Medium | Poor | Excellent |

This table is not universal truth. It is a practical heuristic.

---

## 42. Common Recommendations for Java Teams

For most Java backend teams:

1. Use **Maven/Gradle wrapper** for Java build.
2. Use **Makefile** as optional workflow facade on Unix/devcontainer.
3. Use **Bash** for Linux CI/local process orchestration.
4. Use **POSIX sh** for minimal container entrypoints.
5. Use **PowerShell** for Windows/cross-platform structured automation where `pwsh` is accepted.
6. Use **Java/Go/Python CLI** when automation becomes product.
7. Use **CI YAML** for job orchestration, matrix, secrets, approvals.
8. Document compatibility honestly.

---

## 43. Mini Lab

### Lab 1 — Choose Tool

For each task choose tool and explain:

1. Validate `APP_ENV` in Docker entrypoint.
2. Generate deployment JSON from Git/Maven metadata.
3. Run unit tests locally.
4. Start local Postgres/Redis.
5. Deploy to production with approval.
6. Parse CSV of environments and call health endpoints.
7. Compile Java modules.
8. Publish Maven artifact.
9. Collect Linux diagnostics.
10. Create cross-platform Windows/Linux bootstrap.

---

### Lab 2 — Rewrite Wrong Tool

Take a Make target with inline JSON/curl deploy. Refactor:

```text
Make -> script/CLI -> CI protection
```

---

### Lab 3 — Portability Declaration

Write a compatibility table for your repo automation.

---

### Lab 4 — Decision Record

Write ADR for why your team chooses:

```text
Make + Bash
```

or:

```text
PowerShell-first
```

or:

```text
Make + Java CLI
```

---

## 44. Design Exercise: Automation Substrate Policy

Create policy for a Java organization:

```markdown
# Automation Substrate Policy

## Defaults
- Java build: Maven/Gradle wrapper.
- Workflow facade: Makefile in Linux/devcontainer repos.
- Container entrypoint: POSIX sh.
- Linux CI scripts: Bash.
- Windows/cross-platform structured automation: PowerShell 7.
- Complex platform automation: Java or Go CLI.

## Rules
- No secrets in Makefile.
- No JSON parsing with grep/sed.
- No deploy logic inline in Make.
- Production deploy requires CI protected environment.
- Scripts must have strict mode and lint/test where feasible.
- Compatibility must be documented.

## Exceptions
Document reason, owner, review date.
```

This turns individual judgment into team standard.

---

## 45. Part 022 Summary

Choosing the right automation substrate is an engineering design decision.

Key takeaways:

1. POSIX sh is for minimal Unix portability and tiny entrypoints.
2. Bash is for Unix process/text orchestration.
3. PowerShell is for object/structured/cross-platform Windows-friendly automation.
4. Make is for workflow facade and file dependency graph.
5. Maven/Gradle own Java build lifecycle.
6. CI owns triggers, matrix, secrets, permissions, and approvals.
7. Real CLIs own complex long-lived domain automation.
8. Data shape strongly influences tool choice.
9. Risk level should push logic toward stronger tools and platform controls.
10. Team skill and runtime availability matter.
11. False portability is worse than honest platform-specific tooling.
12. Avoid duplicating logic across Make, scripts, CI, and build tools.
13. Use Make to name workflows; use scripts/CLIs to implement logic.
14. Document compatibility and ownership.
15. Tool choice should minimize accidental complexity while preserving safety.

Part 023 will cover environment management and configuration contracts.

---

## 46. Referensi Resmi dan Bacaan Lanjutan

- POSIX Shell Command Language.
- Bash Reference Manual.
- PowerShell documentation.
- GNU Make Manual.
- Maven and Gradle lifecycle documentation.
- CI/CD provider documentation for secrets, permissions, matrix, environments.
- Dockerfile and container entrypoint best practices.
- Twelve-Factor App configuration.
- Internal developer platform and paved-road engineering practices.
- Release engineering safety patterns.

---

## 47. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [x] Part 004 — Bash Fundamentals Without Toy Examples
- [x] Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe
- [x] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [x] Part 007 — Filesystem Automation: Safe File Operations
- [x] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [x] Part 009 — CLI Design for Internal Tools
- [x] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [x] Part 011 — Security Model for Shell Scripts
- [x] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [x] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [x] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [x] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [x] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [x] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [x] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
- [x] Part 019 — Practical Makefile Syntax and Execution Semantics
- [x] Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade
- [x] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
- [x] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [ ] Part 023 — Environment Management and Configuration Contracts
- [ ] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-023.md">Part 023 — Environment Management and Configuration Contracts ➡️</a>
</div>
