# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-021.md

# Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: menentukan boundary yang tepat antara Make, Bash, PowerShell, Maven, Gradle, CI/CD, Docker, dan real CLI/application agar automation tidak berubah menjadi “mini platform” yang rapuh.

---

## 0. Posisi Part Ini dalam Seri

Part 018–020 membahas Makefile:

- Make sebagai dependency graph;
- syntax dan execution semantics;
- Makefile untuk Java projects dengan Maven/Gradle/Docker/CI facade.

Part 021 membahas hal yang lebih arsitektural:

> Makefile sebaiknya menjadi workflow orchestrator, bukan pengganti build system, deployment platform, scripting language, atau application runtime.

Banyak Makefile buruk bukan buruk karena syntax. Ia buruk karena boundary salah.

Contoh boundary salah:

```make
deploy:
	if [ "$(ENV)" = "prod" ]; then \
	  curl ...; \
	  kubectl ...; \
	  aws ...; \
	  sed ...; \
	  jq ...; \
	  docker ...; \
	fi
```

Makefile berubah menjadi shell script besar yang tersembunyi dalam tab-indented recipe.

Contoh boundary lebih baik:

```make
deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

Make menjadi facade. Script memegang logic. CI memegang permission dan scheduling. Maven/Gradle memegang Java build graph.

---

## 1. Automation Layering Model

Pikirkan automation sebagai beberapa layer:

```text
Human / CI invokes stable workflow entrypoint
  -> Makefile target as facade
    -> Bash/PowerShell script for imperative workflow
      -> Maven/Gradle/Docker/kubectl/aws/git/native tools
        -> external systems
```

Atau:

```text
Make target
  - names the workflow
  - documents variables
  - composes coarse steps
  - delegates complex logic
```

Script:

```text
Bash/PowerShell
  - validates inputs
  - handles safety
  - parses data
  - performs imperative control flow
  - manages retries/timeouts/errors
```

Build tool:

```text
Maven/Gradle
  - compiles/tests/packages Java
  - resolves dependencies
  - runs plugins/tasks
  - handles Java build lifecycle
```

CI:

```text
CI/CD platform
  - triggers
  - secrets
  - permissions
  - approvals
  - runner identity
  - artifacts
  - matrix
  - scheduling
```

Real CLI/application:

```text
Java/Go/Python/Node tool
  - complex domain logic
  - typed API clients
  - complex parsing/schema
  - advanced tests
  - long-lived product
```

The skill is choosing the right layer.

---

## 2. Why Boundary Matters

Boundary mistakes cause:

- hidden complexity;
- inconsistent local/CI behavior;
- unsafe deploys;
- impossible testing;
- fragile quoting;
- duplicate validation;
- hard-to-debug failures;
- Make-specific string bugs;
- parallel execution races;
- inability to reuse logic outside Make;
- CI YAML becoming a second Makefile;
- scripts that work only on one machine.

Good boundary creates:

- stable commands;
- small readable Makefile;
- testable scripts;
- build tool doing build work;
- CI doing permission work;
- easier onboarding;
- safer production operations.

---

## 3. Make's Strengths

Make is good at:

1. **Naming workflows**
   ```bash
   make verify
   make run
   make docker/build
   ```

2. **Discoverability**
   ```bash
   make help
   ```

3. **Simple orchestration**
   ```make
   verify: lint test build
   ```

4. **File timestamp graph**
   ```make
   build/output: input
   	generate input build/output
   ```

5. **Calling existing tools**
   ```make
   test:
   	./mvnw test
   ```

6. **Local/CI facade**
   ```make
   ci/verify:
   	./mvnw --batch-mode verify
   ```

7. **Coarse composition**
   ```make
   release/check: verify docker/build
   ```

8. **Team convention**
   ```text
   Every repo supports make help, make verify, make run.
   ```

Make is not primarily a safe imperative programming language.

---

## 4. Make's Weaknesses

Make is weak at:

- complex argument parsing;
- robust validation;
- structured JSON manipulation;
- secret handling;
- interactive prompts;
- complex retries/timeouts;
- API clients;
- cross-platform shell semantics;
- quoting untrusted input;
- complex loops/conditionals;
- rich error context;
- unit testing business logic;
- long scripts embedded in recipes;
- domain modeling.

If your Make recipe needs:

```make
if ...; then \
  for ...; do \
    jq ... | sed ...; \
  done; \
fi
```

consider moving to script.

If script grows too complex, consider real CLI/application.

---

## 5. Maven/Gradle Boundary

Maven/Gradle should own Java build concerns:

- compile;
- test;
- package;
- dependency resolution;
- annotation processing;
- code quality plugins;
- Java source sets;
- multi-module dependency graph;
- test reports;
- coverage;
- publishing Java artifacts;
- build cache;
- plugin lifecycle.

Make should not manually replace:

```bash
javac
jar
java -cp ...
```

in normal Java projects.

Good:

```make
test:
	./mvnw test

build:
	./mvnw package
```

Bad:

```make
classes:
	find src/main/java -name '*.java' | xargs javac -d target/classes
```

unless for educational/simple non-Maven project.

---

## 6. Docker Boundary

Dockerfile should own image construction details:

- base image;
- build stages;
- dependencies installed in image;
- runtime user;
- entrypoint;
- filesystem layout;
- image labels.

Make should invoke:

```make
docker/build:
	docker build -t "$(IMAGE)" .
```

If Docker command becomes complex:

```make
docker/build:
	./scripts/docker-build.sh --image "$(IMAGE)" --version "$(VERSION)"
```

Script can handle:

- BuildKit secrets;
- labels;
- build args;
- registry allowlist;
- metadata;
- retry;
- validation.

Do not place sensitive or complex Docker logic directly in Make.

---

## 7. CI Boundary

CI/CD should own:

- triggers;
- schedules;
- permissions;
- secrets;
- protected environments;
- approvals;
- runner images;
- artifact retention;
- cache config;
- matrix strategy;
- concurrency control;
- deployment gates.

Make should not pretend it can enforce all CI permission boundaries.

Example:

```make
deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

This target can validate input, but production permission should still be enforced by CI environment protection, cloud IAM, deployment platform, and credentials.

Make target names are not a security boundary.

---

## 8. Script Boundary

Bash/PowerShell scripts should own imperative workflow logic:

- parse CLI flags;
- validate env/version/path;
- handle secrets safely;
- call APIs;
- parse JSON/CSV/XML;
- implement retry/timeout;
- handle traps/cleanup;
- check native exit codes;
- provide dry-run/plan/apply;
- log safely;
- be tested/linted.

Make should call scripts.

```make
deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan
```

This is much better than writing deployment control flow in Make.

---

## 9. Real CLI/Application Boundary

Move to Java/Go/Python/Node CLI when:

- domain logic complex;
- API client complex;
- schema validation complex;
- concurrency needed;
- many subcommands;
- strong tests needed;
- multiple teams use tool;
- you need typed models;
- performance matters;
- error handling grows;
- config merging complex;
- cross-platform packaging needed;
- auditing/security requirements increase.

Example:

```bash
java -jar platform-cli.jar deploy plan --env staging --version 1.2.3
```

Make can still wrap:

```make
deploy/plan:
	platform deploy plan --env "$(ENV)" --version "$(VERSION)"
```

Make remains facade.

---

## 10. Boundary Decision Matrix

| Concern | Best Layer |
|---|---|
| Name common workflow | Make |
| Show help targets | Make |
| Java compile/test/package | Maven/Gradle |
| Complex shell control flow | Bash/PowerShell |
| Windows admin/certs/registry | PowerShell |
| POSIX container entrypoint | POSIX sh |
| Structured JSON/CSV/REST automation | PowerShell or real CLI |
| Production deploy permissions | CI/CD + IAM |
| Docker image layout | Dockerfile |
| Docker build invocation | Make/script |
| Secret storage | CI/secret manager |
| Complex API client | Real CLI/app |
| Local dev dependency start/stop | Make + Docker Compose |
| Tool version install | Devcontainer/asdf/sdkman/CI image |
| Generated file graph | Make if dependencies honest |
| Complex build graph | Maven/Gradle/Bazel/etc. |

---

## 11. Smell: Makefile Has Business Logic

Bad:

```make
calculate-price:
	@if [ "$(REGION)" = "us" ]; then \
	  TAX=0.08; \
	elif [ "$(REGION)" = "eu" ]; then \
	  TAX=0.2; \
	fi; \
	...
```

Business/domain logic should not be in Make.

Use application/test/tool.

Makefile should orchestrate:

```make
calculate-price:
	./scripts/calculate-price.sh --region "$(REGION)"
```

Even then, if domain logic matters, script may be wrong layer; use real app code.

---

## 12. Smell: Makefile Parses JSON

Bad:

```make
VERSION := $(shell cat package.json | grep version | sed ...)
```

Better:

```make
metadata:
	./scripts/build-metadata.sh --json
```

If simple and robust enough:

```make
VERSION := $(shell jq -r '.version' package.json)
```

But be careful:

- `make help` now requires jq and package.json;
- top-level parse can fail early;
- JSON parsing belongs in script if important.

Rule:

> Make may call JSON-aware tools, but should not become JSON transformation logic.

---

## 13. Smell: Makefile Controls Secrets

Bad:

```make
DEPLOY_TOKEN := secret
deploy:
	curl -H "Authorization: Bearer $(DEPLOY_TOKEN)" ...
```

Better:

```make
deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

Script reads secret from environment/secret manager and does not log.

CI injects secret only in protected deploy job.

Makefile should never contain secrets.

---

## 14. Smell: Makefile Has Long Recipes

If recipe is longer than ~5–10 lines and has conditionals/loops, consider script.

Bad:

```make
deploy:
	@set -e; \
	if [ -z "$(ENV)" ]; then echo "ENV required"; exit 2; fi; \
	if [ "$(ENV)" = "prod" ]; then ...; fi; \
	payload=$$(jq -n ...); \
	curl ...; \
	kubectl ...; \
	...
```

Better:

```make
deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

Long Make recipes are hard to test, lint, and secure.

---

## 15. Smell: CI YAML Duplicates Makefile

Bad:

```make
verify:
	./mvnw verify
```

CI:

```yaml
- run: ./mvnw verify
- run: docker build ...
- run: ./scripts/check.sh
```

Local and CI drift.

Better:

```make
ci/verify:
	./mvnw --batch-mode verify
	./scripts/check.sh
```

CI:

```yaml
- run: make ci/verify
```

But avoid hiding CI-specific permission/approval logic inside Make. Use Make for commands, CI for orchestration gates.

---

## 16. Smell: Makefile Reimplements Gradle

If using Gradle, and Makefile has many task dependencies:

```make
compile:
	...
test:
	...
jar:
	...
publish:
	...
```

ask:

> Should these be Gradle tasks?

Gradle is already a build system. Make should expose simple entrypoints:

```make
build:
	./gradlew build

publish:
	./gradlew publish
```

Use Make to unify repo conventions, not replace Gradle.

---

## 17. Smell: Over-Generalized Makefile

Bad:

```make
COMMAND ?=
ARGS ?=
run-command:
	$(COMMAND) $(ARGS)
```

This adds little value and unsafe abstraction.

Better to define explicit targets:

```make
test:
	./mvnw test

docker/build:
	docker build -t "$(IMAGE)" .
```

Make targets should encode domain intent.

---

## 18. Makefile as Product Interface

For a team, Makefile is part of developer experience.

Target contract:

```bash
make help
make verify
make run
make clean
```

These should be stable.

Do not casually change:

```make
verify
```

from “unit tests” to “unit + integration + docker + deploy check” if it significantly changes time/cost.

Instead add:

```make
verify/full
```

or document.

Make target names should communicate cost/risk:

- `test/unit`
- `test/integration`
- `verify/full`
- `deploy/plan`
- `deploy/apply`
- `clean/generated`
- `clean/all`

---

## 19. Target Naming Strategy

Recommended style:

```text
help
verify
verify/full
test
test/unit
test/integration
build
run
clean
format
format/check
lint
docker/build
docker/run
docker/push
local/up
local/down
local/logs
generate
metadata
release/check
deploy/plan
deploy/apply
```

Use `/` namespaces for categories.

Alternative hyphen style:

```text
docker-build
docker-run
deploy-plan
deploy-apply
```

Either is okay. Be consistent.

Namespaced `/` targets make help easier to group.

---

## 20. Variables Naming Strategy

Good:

```make
ENV ?= dev
PROFILE ?= unit
SERVICE ?= api
IMAGE ?= my-service:local
IMAGE_TAG ?= local
VERSION ?=
PORT ?= 8080
```

Avoid ambiguous:

```make
TARGET
NAME
MODE
TYPE
VALUE
```

unless context is obvious.

For risky vars, no dangerous defaults:

```make
ENV ?=
VERSION ?=
```

For local run, safe default okay:

```make
ENV ?= dev
PORT ?= 8080
```

For deploy, script should reject empty/prod without confirmation.

---

## 21. Make and Dry-Run

`make -n` shows recipe commands, but it is not domain dry-run.

For deploy, prefer explicit:

```make
deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

`make -n deploy/apply` can show command, but only script `--plan` can validate domain-specific changes.

---

## 22. Make and Safety

Makefile safety practices:

- default target `help`;
- destructive targets explicit;
- no default prod;
- no secrets;
- deploy split plan/apply;
- clean delegates to safe script;
- phony targets declared;
- real targets only when dependencies honest;
- target names communicate risk;
- help shows examples;
- CI protects production.

Make can improve safety through UX, but deeper safety belongs in scripts/platform/IAM.

---

## 23. Make and Testing

Testing Makefile itself can be lightweight:

```bash
make help
make -n verify
make print-ENV
```

For important targets:

- smoke test `make help`;
- CI runs `make ci/verify`;
- use `make -n deploy/apply ENV=staging VERSION=1.2.3` to inspect command;
- test scripts separately.

Do not try to unit-test complex logic in Make. Move logic out.

---

## 24. Make and Observability

Good Make target logs:

```make
test:
	@echo "==> Running unit tests"
	$(MVN) test
```

But avoid too much custom logging.

If script handles workflow, script should log.

Make target should be clear enough in CI:

```text
==> Running unit tests
./mvnw test
```

Command echo can help.

Avoid hiding all commands with `@` unless output becomes noisy.

---

## 25. Make and Parallelism as Orchestration

Make can parallelize independent coarse tasks:

```make
verify: lint test docker/build
```

With:

```bash
make -j verify
```

But only if tasks independent.

If `docker/build` needs `build`, encode:

```make
docker/build: build
	docker build ...
```

Make dependency graph should reflect reality.

Do not rely on prerequisite order.

---

## 26. When Make Helps More Than CI YAML

Make is useful when same workflow needed:

- locally;
- in CI;
- in devcontainer;
- by pre-commit;
- by release engineer;
- across repositories.

CI YAML is platform-specific. Make is local executable convention.

Example:

```bash
make verify
```

works anywhere with Make and dependencies.

CI can call it.

This reduces duplication.

But CI YAML still handles:

- permissions;
- matrix;
- services;
- cache;
- artifacts;
- approvals.

---

## 27. When CI YAML Should Own It

CI should own:

```yaml
strategy:
  matrix:
    java: [17, 21]
    os: [ubuntu-latest, windows-latest]
```

Make should not simulate CI matrix locally with complex loops.

CI should own:

```yaml
environment: production
permissions:
  id-token: write
  contents: read
```

Make cannot enforce these.

Make target can be:

```make
ci/deploy:
	./scripts/deploy-release.sh ...
```

But CI decides when/with what identity it runs.

---

## 28. When Maven/Gradle Should Own It

If workflow is part of Java lifecycle, prefer Maven/Gradle.

Examples:

- test task;
- integration test source set;
- code coverage;
- static analysis plugin;
- dependency update plugin;
- Java artifact publishing;
- generated sources integrated into compilation;
- annotation processing;
- application packaging.

Make target can call:

```make
coverage:
	./mvnw verify jacoco:report
```

But configuration belongs in `pom.xml`/`build.gradle`.

---

## 29. When Script Should Own It

Script should own:

- cross-tool imperative flow;
- safe cleanup;
- deploy/release sequence;
- diagnostics collection;
- local environment bootstrap;
- shell-specific handling;
- JSON payload construction;
- input validation;
- secret-safe logging.

Make target:

```make
diagnostics:
	./scripts/collect-diagnostics.sh --output build/diagnostics
```

Script can be tested/linted.

---

## 30. When Real CLI Should Own It

Create real CLI when automation becomes product.

Signals:

- multiple subcommands;
- many flags;
- config files;
- API retries/auth/pagination;
- complex schema;
- plugin model;
- multiple teams;
- long-term compatibility;
- typed domain model;
- sophisticated tests;
- release distribution.

Make target can become:

```make
platform/deploy:
	platform-cli deploy --env "$(ENV)" --version "$(VERSION)"
```

Make remains stable entrypoint while implementation evolves.

---

## 31. Case Study: Bad Makefile

```make
ENV ?= prod
VERSION := $(shell git describe --tags)
TOKEN := abc123

deploy:
	if [ "$(ENV)" = "prod" ]; then \
	  echo "Deploying prod"; \
	fi; \
	curl -H "Authorization: Bearer $(TOKEN)" \
	  -d "{\"version\":\"$(VERSION)\"}" \
	  https://deploy.example.com/$(ENV); \
	kubectl apply -f k8s/$(ENV).yaml

clean:
	rm -rf $(DIR)
```

Problems:

- prod default;
- secret in Makefile;
- top-level Git command;
- JSON string construction;
- curl deploy inline;
- kubectl context not validated;
- path injection through `ENV`;
- unsafe clean;
- no help;
- no phony;
- no plan/apply;
- no CI permission boundary;
- poor testability.

---

## 32. Better Boundary Design

```make
.DEFAULT_GOAL := help

ENV ?=
VERSION ?=

.PHONY: help deploy/plan deploy/apply clean

help:
	@echo "Targets:"
	@echo "  deploy/plan   Plan deployment"
	@echo "  deploy/apply  Apply deployment"
	@echo "  clean         Safe cleanup"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=staging|prod"
	@echo "  VERSION=x.y.z"

deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply

clean:
	./scripts/clean.sh --target all
```

Deploy script handles:

- env validation;
- version validation;
- token from env/secret manager;
- JSON via jq/PowerShell;
- API errors;
- kubectl context;
- prod confirmation;
- logging;
- tests.

CI handles:

- secret injection;
- approval;
- production environment protection;
- runner identity.

---

## 33. Case Study: Make + Maven + Script

Makefile:

```make
.PHONY: release/check release/package release/publish

release/check:
	./scripts/release-check.sh --version "$(VERSION)"

release/package:
	./mvnw --batch-mode package

release/publish:
	./scripts/publish-artifact.sh --version "$(VERSION)"
```

Potential chain:

```make
release/publish: release/check release/package
```

But if publish must happen only after package and check sequentially, encode carefully:

```make
release/publish:
	$(MAKE) release/check VERSION="$(VERSION)"
	$(MAKE) release/package
	./scripts/publish-artifact.sh --version "$(VERSION)"
```

Or script owns whole release:

```make
release/publish:
	./scripts/release-publish.sh --version "$(VERSION)"
```

Choose based on need for graph parallelism vs sequential transaction.

---

## 34. Orchestration Transaction Boundaries

Some workflows are transactional/ordered:

```text
validate -> build -> upload -> tag -> notify
```

If failure handling/rollback matters, Make is weak.

Better:

```make
release/apply:
	./scripts/release-apply.sh --version "$(VERSION)"
```

Script can:

- stop on failure;
- record state;
- rollback;
- avoid partial publish;
- handle retries;
- produce summary.

Make can orchestrate coarse prerequisites, but not robust transaction semantics.

---

## 35. Makefile Size Heuristic

Approximate guidance:

- <50 lines: facade likely fine.
- 50–150 lines: okay if structured/helpful.
- 150–300 lines: consider splitting includes/scripts.
- >300 lines: likely too much logic or too many responsibilities.

Not strict. A generated Makefile can be long. But human-maintained project Makefile should stay readable.

If Makefile has many shell conditionals, reduce.

---

## 36. Include File Boundary

If Makefile grows:

```text
Makefile
make/java.mk
make/docker.mk
make/local.mk
make/release.mk
```

Top-level:

```make
include make/java.mk
include make/docker.mk
include make/local.mk
include make/release.mk
```

Use includes for organization, not hiding complexity.

Each include should own a domain.

But if include has imperative logic, scripts still better.

---

## 37. Make vs Task Runners

Alternatives:

- Just scripts in `scripts/`;
- Maven/Gradle tasks;
- npm scripts;
- Taskfile;
- Justfile;
- mage;
- invoke;
- custom CLI;
- CI YAML only.

Make advantages:

- ubiquitous on Unix;
- simple;
- graph/timestamp semantics;
- familiar;
- no extra dependency in many Linux environments.

Make disadvantages:

- Windows friction;
- quirky syntax;
- tab sensitivity;
- shell portability;
- limited data structures;
- not user-friendly for complex args.

Use Make if it fits team/runtime.

---

## 38. Make and Windows Teams

If many developers are Windows-native:

Options:

1. Use PowerShell scripts as primary facade.
2. Use Gradle/Maven tasks.
3. Require WSL/devcontainer for Make.
4. Provide both Makefile and PowerShell entrypoints.
5. Use cross-platform task runner.

A Makefile that only works in Linux should say so.

Example README:

```text
Makefile targets are supported in Linux/devcontainer/CI.
Windows users should run scripts/*.ps1 or use devcontainer.
```

Honest compatibility beats false portability.

---

## 39. Dual Facade Pattern

For cross-platform teams:

```text
Makefile
scripts/Verify.ps1
scripts/verify.sh
```

Make:

```make
verify:
	./scripts/verify.sh
```

Windows docs:

```powershell
pwsh ./scripts/Verify.ps1
```

Or Make calls PowerShell if `pwsh` is standard:

```make
verify:
	pwsh -NoProfile -File ./scripts/Verify.ps1
```

Then Make can be cross-platform if Make + pwsh available.

Choose one primary path to avoid drift.

---

## 40. Single Source of Truth

Avoid implementing same logic in:

- Makefile;
- Bash script;
- PowerShell script;
- CI YAML;
- Maven profile;
- Gradle task.

Pick owner.

Example:

Build metadata:

```text
Owner: scripts/build-metadata.sh
Make target: metadata calls script
CI: make metadata
```

or:

```text
Owner: PowerShell Build-Metadata.ps1
Make target: metadata calls pwsh
CI: make metadata
```

Do not duplicate metadata computation in Make and CI.

---

## 41. Documentation Boundary

Make help should be quick reference.

README should explain:

- prerequisites;
- common workflows;
- compatibility;
- target philosophy;
- variables;
- examples;
- troubleshooting.

Scripts should have `--help`.

Maven/Gradle tasks documented in build files or docs.

CI documented where needed.

Make help is not full documentation; it is entrypoint map.

---

## 42. Observability Boundary

Make can print:

```make
@echo "==> Running tests"
```

Scripts should print detailed step logs.

CI should capture logs/artifacts.

Application should produce app logs.

Do not force Make to become logging framework.

If target fails, user should know which command failed and where to look.

---

## 43. Error Boundary

Make stops when recipe exits non-zero.

It does not know domain semantics.

Script should turn domain failures into meaningful exit codes/messages.

Build tool should fail build with reports.

CI should mark job failed and store artifacts.

Make should not swallow errors with `-` unless intentional.

---

## 44. Security Boundary

Make is not security boundary.

Bad assumptions:

```text
Only people who know make deploy can deploy.
```

No.

Security lives in:

- credentials;
- IAM/RBAC;
- CI environment protection;
- code review;
- signed artifacts;
- registry permissions;
- deploy platform;
- audit logs.

Make can reduce accidental misuse via naming/help/defaults, but cannot enforce authorization.

---

## 45. Boundary Review Questions

When adding a Make target, ask:

1. Is this target a workflow name or actual logic?
2. Should Maven/Gradle own this?
3. Should a script own this?
4. Is there domain validation?
5. Are secrets involved?
6. Is operation destructive?
7. Does it need dry-run?
8. Does it require CI permissions?
9. Can this run locally?
10. Is output file dependency graph honest?
11. Can `make -j` break it?
12. Is Windows support claimed?
13. How will it be tested?
14. Is this target now public API?
15. Does help explain it?

---

## 46. Good Makefile Architecture Template

```make
# Requires GNU Make.
ifndef MAKE_VERSION
$(error GNU Make is required)
endif

.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

# ---- Configuration ---------------------------------------------------------

APP_NAME := my-service
ENV ?= dev
VERSION ?=
IMAGE_TAG ?= local
IMAGE ?= $(APP_NAME):$(IMAGE_TAG)
MVN ?= ./mvnw
MVN_CI_FLAGS := --batch-mode --no-transfer-progress

# ---- Public targets --------------------------------------------------------

.PHONY: help verify ci/verify test build run clean docker/build deploy/plan deploy/apply print-%

help:
	@echo "Usage: make <target> [VAR=value]"
	@echo ""
	@echo "Targets:"
	@echo "  verify       Local verification"
	@echo "  ci/verify    CI verification"
	@echo "  test         Run tests"
	@echo "  build        Build package"
	@echo "  run          Run locally"
	@echo "  clean        Safe cleanup"
	@echo "  docker/build Build image"
	@echo "  deploy/plan  Plan deployment"
	@echo "  deploy/apply Apply deployment"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=$(ENV)"
	@echo "  VERSION=$(VERSION)"
	@echo "  IMAGE=$(IMAGE)"

verify: test build

ci/verify:
	$(MVN) $(MVN_CI_FLAGS) verify

test:
	$(MVN) test

build:
	$(MVN) package

run:
	APP_ENV="$(ENV)" ./scripts/run-local.sh

clean:
	./scripts/clean.sh --target all

docker/build:
	docker build -t "$(IMAGE)" .

deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply

print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
	@echo 'flavor=$(flavor $*)'
```

This is boring. Boring is good.

---

## 47. Bad vs Good Examples

### Bad: inline API call

```make
notify:
	curl -X POST -H "Authorization: Bearer $(TOKEN)" -d '{"text":"done"}' $(URL)
```

### Good

```make
notify:
	./scripts/notify.sh --message "done"
```

Script reads token safely.

---

### Bad: inline JSON

```make
payload:
	echo "{\"version\":\"$(VERSION)\"}"
```

### Good

```make
payload:
	./scripts/build-payload.sh --version "$(VERSION)"
```

or PowerShell object conversion.

---

### Bad: hidden prod default

```make
ENV ?= prod
deploy:
	./scripts/deploy.sh --env "$(ENV)"
```

### Good

```make
ENV ?=
deploy/plan:
	./scripts/deploy.sh --env "$(ENV)" --plan
```

Script rejects empty and requires explicit prod confirmation.

---

## 48. Mini Lab

### Lab 1 — Boundary Classification

For each task, choose owner: Make, script, Maven/Gradle, CI, Dockerfile, real CLI.

1. Compile Java.
2. Start local Postgres.
3. Validate release version.
4. Protect production deploy approval.
5. Build Docker image layers.
6. Generate JSON deployment payload.
7. Publish artifact with retry.
8. Run unit tests.
9. Create CI OS matrix.
10. Print list of available workflows.

---

### Lab 2 — Refactor Long Recipe

Take a Make target with 10-line shell recipe. Extract to `scripts/*.sh` or `.ps1`, then Make calls script.

---

### Lab 3 — Define Target API

Write `make help` for a service with:

```text
verify
verify/full
test/unit
test/integration
docker/build
deploy/plan
deploy/apply
```

Include variables and examples.

---

### Lab 4 — CI Boundary

Write CI YAML that calls `make ci/verify` but keeps environment protection in CI config.

---

### Lab 5 — Hidden State

Decide whether these should be real file targets or phony:

- `build/metadata.json` containing current timestamp;
- generated OpenAPI client from spec file;
- Docker image build;
- Maven test;
- downloaded dependency file with checksum;
- API health report.

Explain.

---

## 49. Design Exercise: Automation Architecture Decision Record

Write an ADR:

```markdown
# ADR: Java Service Automation Boundaries

## Context
We need local and CI automation for build, test, Docker, release, deploy.

## Decision
- Makefile provides workflow facade.
- Maven owns Java build/test/package.
- Bash scripts own Linux-oriented release/deploy logic.
- PowerShell scripts own cross-platform metadata/REST data automation.
- CI owns secrets, approvals, matrix, artifact retention.
- Dockerfile owns image construction.

## Consequences
- Developers use make help / make verify.
- CI calls make ci/verify.
- Deploy requires CI protected environment.
- Complex logic is tested in scripts.
- Makefile remains small.
```

This exercise trains architectural thinking beyond syntax.

---

## 50. Part 021 Summary

Makefile is most valuable as workflow orchestrator and team interface, not as replacement for proper tools.

Key takeaways:

1. Make should name and compose workflows.
2. Maven/Gradle should own Java build graph.
3. Scripts should own imperative logic and safety.
4. CI/CD should own permissions, secrets, triggers, approvals, and matrix.
5. Dockerfile should own image construction.
6. Real CLI/application should own complex domain logic.
7. Long Make recipes are a design smell.
8. Inline secrets, JSON, API calls, and deploy logic in Make are risky.
9. Make targets and variables become public API.
10. Target names should communicate cost and risk.
11. `make -n` is not a domain dry-run.
12. Make can reduce local/CI drift when CI calls Make.
13. Make cannot enforce security boundaries.
14. Keep Makefiles boring, explicit, and discoverable.
15. Boundary decisions should be documented for mature teams.

Part 022 will compare portability across Bash, POSIX sh, PowerShell, Make, and Java so you can choose the right automation substrate deliberately.

---

## 51. Referensi Resmi dan Bacaan Lanjutan

- GNU Make Manual — recursive make, phony targets, recipes, variables.
- Maven lifecycle documentation.
- Gradle task graph and build lifecycle documentation.
- Dockerfile best practices.
- Docker Compose documentation.
- CI/CD provider docs for environments, secrets, permissions, matrix, artifacts.
- Twelve-Factor App configuration principles.
- Release engineering and deployment safety patterns.
- Internal developer platform / paved road architecture discussions.

---

## 52. Status Seri

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
- [ ] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [ ] Part 023 — Environment Management and Configuration Contracts
- [ ] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-022.md">Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java ➡️</a>
</div>
