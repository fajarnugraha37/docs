# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-020.md

# Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: menerapkan Makefile sebagai workflow facade untuk Java projects: Maven, Gradle, Docker, local run, CI parity, metadata, OpenAPI/codegen, test profiles, dan release-prep tanpa menggantikan build tool utama.

---

## 0. Posisi Part Ini dalam Seri

Part 018 membangun mental model Make sebagai dependency graph engine.

Part 019 memperdalam syntax dan execution semantics:

- Make vs shell expansion;
- variables;
- recipes;
- `.PHONY`;
- pattern/static pattern rules;
- target-specific variables;
- includes;
- GNU Make portability;
- debugging.

Part 020 menerapkan semua itu ke Java project.

Tujuan utama:

> Makefile di Java project sebaiknya menjadi facade workflow yang stabil, bukan pengganti Maven/Gradle.

Maven/Gradle tetap memegang:

- Java compilation;
- dependency resolution;
- test lifecycle;
- plugin lifecycle;
- artifact packaging;
- build cache/incrementality;
- multi-module project model.

Make memegang:

- standardized entrypoints;
- cross-tool orchestration;
- local/CI parity;
- Docker wrapper;
- safe cleanup wrapper;
- codegen triggers;
- metadata generation;
- release/deploy facade;
- discoverability via `make help`.

---

## 1. Mental Model: Make as Outer Control Plane

Java service workflow biasanya melibatkan banyak tool:

```text
Maven/Gradle
Docker
Docker Compose
OpenAPI generator
database migration tool
local env scripts
curl/healthcheck
shell scripts
PowerShell scripts
CI YAML
artifact registry
container registry
```

Tanpa facade, developer harus tahu banyak command:

```bash
./mvnw -P integration verify
docker build -t service:local .
docker compose up -d postgres redis
./scripts/run-local.sh
./scripts/generate-openapi-client.sh
./scripts/clean.sh --target all
```

Dengan Makefile:

```bash
make help
make verify
make run
make docker/build
make local/up
make generate
make clean
```

Make bukan menggantikan tool. Make memberi satu pintu masuk konsisten.

---

## 2. Rule of Thumb

Untuk Java projects:

```text
Maven/Gradle owns Java build.
Make owns workflow names.
Scripts own complex imperative logic.
CI owns scheduling/permissions.
```

Jangan menulis Makefile yang mencoba:

- compile `.java` secara manual;
- resolve Maven dependencies manual;
- mengatur classpath manual;
- menjalankan unit test satu per satu;
- mengganti Gradle task graph;
- mengimplementasikan deployment logic kompleks langsung di recipe.

Make target sebaiknya tipis:

```make
test:
	./mvnw test
```

atau:

```make
deploy:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)"
```

---

## 3. Recommended Target Surface

Target umum untuk Java service:

```text
help
verify
test
test/unit
test/integration
build
package
run
clean
format
lint
generate
metadata
docker/build
docker/run
docker/push
local/up
local/down
local/logs
ci/verify
release/check
```

Tidak semua project butuh semua.

Prinsip:

- target umum stabil;
- target destructive explicit;
- target deploy/release tidak default;
- target names discoverable;
- variables documented.

---

## 4. Maven Wrapper vs Maven Installed

Prefer wrapper:

```bash
./mvnw
```

Benefits:

- consistent Maven version;
- no local Maven install requirement;
- repo-controlled build experience.

Make variable:

```make
MVN := ./mvnw
```

Fallback to `mvn`? Bisa, tapi wrapper lebih deterministic.

```make
MVN ?= ./mvnw
```

Then user can override:

```bash
make test MVN=mvn
```

But default should be wrapper.

On Windows, wrapper can be `mvnw.cmd`. If Make is running in WSL/Git Bash/Linux CI, `./mvnw` is fine. For native Windows PowerShell, Make may not be primary facade.

---

## 5. Gradle Wrapper

For Gradle:

```make
GRADLE := ./gradlew
```

Targets:

```make
test:
	$(GRADLE) test

build:
	$(GRADLE) build

clean:
	$(GRADLE) clean
```

Allow override:

```make
GRADLE ?= ./gradlew
```

Gradle already has rich task graph, so Make is even more clearly facade.

---

## 6. Maven Basic Makefile

```make
# Requires GNU Make.
ifndef MAKE_VERSION
$(error GNU Make is required)
endif

.DEFAULT_GOAL := help

MVN ?= ./mvnw
PROFILE ?= unit
ENV ?= dev

.PHONY: help verify test build run clean

help:
	@echo "Available targets:"
	@echo "  verify       Run full verification"
	@echo "  test         Run tests with PROFILE=$(PROFILE)"
	@echo "  build        Build package"
	@echo "  run          Run locally with ENV=$(ENV)"
	@echo "  clean        Clean Maven artifacts"
	@echo ""
	@echo "Variables:"
	@echo "  MVN=$(MVN)"
	@echo "  PROFILE=$(PROFILE)"
	@echo "  ENV=$(ENV)"

verify: test build

test:
	$(MVN) -P "$(PROFILE)" test

build:
	$(MVN) -P "$(PROFILE)" package

run:
	APP_ENV="$(ENV)" ./scripts/run-local.sh

clean:
	$(MVN) clean
```

This is simple and useful.

---

## 7. Gradle Basic Makefile

```make
.DEFAULT_GOAL := help

GRADLE ?= ./gradlew
ENV ?= dev

.PHONY: help verify test build run clean

help:
	@echo "Available targets:"
	@echo "  verify       Run full verification"
	@echo "  test         Run tests"
	@echo "  build        Build project"
	@echo "  run          Run locally"
	@echo "  clean        Clean Gradle artifacts"
	@echo ""
	@echo "Variables:"
	@echo "  GRADLE=$(GRADLE)"
	@echo "  ENV=$(ENV)"

verify: test build

test:
	$(GRADLE) test

build:
	$(GRADLE) build

run:
	APP_ENV="$(ENV)" ./scripts/run-local.sh

clean:
	$(GRADLE) clean
```

Gradle tasks can be more specific:

```make
test/integration:
	$(GRADLE) integrationTest
```

---

## 8. Profiles and Test Categories

Maven profile:

```make
PROFILE ?= unit

test:
	$(MVN) -P "$(PROFILE)" test
```

Dedicated targets:

```make
.PHONY: test/unit test/integration

test/unit:
	$(MVN) -P unit test

test/integration:
	$(MVN) -P integration verify
```

Alias:

```make
test: test/unit
```

For Gradle:

```make
test/unit:
	$(GRADLE) test

test/integration:
	$(GRADLE) integrationTest
```

Make target names can encode intent better than raw Maven profile.

---

## 9. `verify` Target Semantics

`verify` should mean:

```text
Run the checks expected before pushing/merging.
```

But exact scope depends project.

Examples:

Small service:

```make
verify: format/check lint test build
```

Larger service:

```make
verify: test/unit test/integration docker/build
```

Be careful with slow checks. You may split:

```make
verify: test/unit build
verify/full: format/check lint test/unit test/integration docker/build
```

Document.

Avoid changing `verify` semantics casually once team relies on it.

---

## 10. CI Facade

CI YAML should be thin:

```yaml
- run: make ci/verify
```

Makefile:

```make
.PHONY: ci/verify
ci/verify:
	$(MVN) --batch-mode verify
```

Why separate `ci/verify`?

CI often wants:

- batch mode;
- no interactive prompts;
- stricter flags;
- full checks;
- deterministic output;
- no local dev shortcuts.

Maven:

```make
MVN_CI_FLAGS := --batch-mode --no-transfer-progress

ci/verify:
	$(MVN) $(MVN_CI_FLAGS) verify
```

Gradle:

```make
GRADLE_CI_FLAGS := --no-daemon --stacktrace

ci/verify:
	$(GRADLE) $(GRADLE_CI_FLAGS) build
```

---

## 11. Local vs CI Parity

Do not duplicate logic in CI YAML and Makefile differently.

Bad:

```yaml
# CI
./mvnw --batch-mode verify
```

while local:

```make
verify:
	./mvnw test
```

Now CI and local differ.

Better:

```make
verify:
	$(MVN) verify

ci/verify:
	$(MVN) $(MVN_CI_FLAGS) verify
```

CI calls `make ci/verify`.

Local can run:

```bash
make verify
```

Differences are explicit.

---

## 12. Docker Image Build

Variables:

```make
APP_NAME ?= my-service
IMAGE_REGISTRY ?= local
IMAGE_TAG ?= dev
IMAGE := $(IMAGE_REGISTRY)/$(APP_NAME):$(IMAGE_TAG)
```

But if `IMAGE_REGISTRY=local`, image becomes `local/my-service:dev`. Maybe you want:

```make
IMAGE_NAME ?= my-service
IMAGE_TAG ?= local
IMAGE ?= $(IMAGE_NAME):$(IMAGE_TAG)
```

Target:

```make
.PHONY: docker/build
docker/build:
	docker build -t "$(IMAGE)" .
```

Run:

```bash
make docker/build IMAGE=my-service:abc123
```

Document variables.

---

## 13. Docker Build Depends on JAR?

Two approaches.

### 13.1 Dockerfile builds app itself

Dockerfile:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
COPY . .
RUN ./mvnw package
...
```

Make:

```make
docker/build:
	docker build -t "$(IMAGE)" .
```

### 13.2 Make/Maven builds jar first

```make
APP_JAR := target/my-service.jar

docker/build: build
	docker build -t "$(IMAGE)" .
```

where:

```make
build:
	$(MVN) package
```

Use whichever matches Dockerfile design.

For reproducibility, Dockerfile multi-stage build is often better for image build, but slower if not cached well. Local developer workflow may build outside Docker.

---

## 14. Docker Run

```make
PORT ?= 8080
ENV ?= dev

.PHONY: docker/run
docker/run:
	docker run --rm \
	  -p "$(PORT):8080" \
	  -e APP_ENV="$(ENV)" \
	  "$(IMAGE)"
```

Caveat: line continuation shell syntax. Fine for POSIX sh.

For complex docker run with volumes/secrets, use script:

```make
docker/run:
	./scripts/docker-run.sh --env "$(ENV)" --image "$(IMAGE)"
```

---

## 15. Docker Compose / Local Dependencies

Targets:

```make
.PHONY: local/up local/down local/logs local/ps

local/up:
	docker compose up -d

local/down:
	docker compose down

local/logs:
	docker compose logs -f

local/ps:
	docker compose ps
```

If project supports both old `docker-compose` and new `docker compose`, handle in script or variable:

```make
DOCKER_COMPOSE ?= docker compose
```

But Make variable with space can be okay:

```make
local/up:
	$(DOCKER_COMPOSE) up -d
```

User override:

```bash
make local/up DOCKER_COMPOSE=docker-compose
```

---

## 16. Health Check Target

```make
HEALTH_URL ?= http://localhost:8080/actuator/health

.PHONY: health
health:
	curl --fail --show-error --silent "$(HEALTH_URL)"
```

But for cross-platform/no curl, use script/PowerShell.

Better for Bash/Linux:

```make
health:
	./scripts/check-health.sh --url "$(HEALTH_URL)"
```

PowerShell:

```make
health:
	pwsh -NoProfile -File ./scripts/Test-Health.ps1 -Uri "$(HEALTH_URL)"
```

Choose project runtime.

---

## 17. Metadata Target

Build metadata useful for CI/release:

```make
.PHONY: metadata
metadata:
	./scripts/build-metadata.sh --json
```

or PowerShell:

```make
metadata:
	pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -Output Json
```

Make can save to file:

```make
build/metadata.json: | build
	./scripts/build-metadata.sh --json > $@

build:
	mkdir -p $@
```

Now metadata is real file target.

---

## 18. Version Variables

Common:

```make
VERSION ?= $(shell git describe --tags --always --dirty)
COMMIT ?= $(shell git rev-parse --short HEAD)
```

But top-level `$(shell ...)` runs even for `make help`.

Better:

```make
.PHONY: version
version:
	git describe --tags --always --dirty
```

or compute in script.

If version needed for image:

```make
IMAGE_TAG ?= local
```

CI can pass:

```bash
make docker/build IMAGE_TAG="$GITHUB_SHA"
```

Avoid expensive/fragile top-level version computation.

---

## 19. Code Generation

OpenAPI example:

```make
OPENAPI_SPEC := openapi/service.yaml
OPENAPI_STAMP := build/stamps/openapi-client.stamp

.PHONY: generate generate/openapi

generate: generate/openapi

generate/openapi: $(OPENAPI_STAMP)

$(OPENAPI_STAMP): $(OPENAPI_SPEC) | build/stamps
	./scripts/generate-openapi-client.sh "$(OPENAPI_SPEC)" generated/client
	touch $@

build/stamps:
	mkdir -p $@
```

Clean should remove stamp:

```make
clean/generated:
	rm -rf generated/client build/stamps/openapi-client.stamp
```

But safer:

```make
clean/generated:
	./scripts/clean-generated.sh
```

---

## 20. Database Migration Wrapper

Targets:

```make
ENV ?= dev

.PHONY: db/migrate db/status

db/status:
	./scripts/db-status.sh --env "$(ENV)"

db/migrate:
	./scripts/db-migrate.sh --env "$(ENV)"
```

Do not put migration logic in Make recipe.

Migration scripts should:

- validate env;
- avoid default prod;
- handle credentials;
- support dry-run/status;
- log safely;
- fail clearly.

Make passes explicit variables.

---

## 21. Release Check Target

```make
VERSION ?=

.PHONY: release/check
release/check:
	@test -n "$(VERSION)" || { echo "VERSION is required"; exit 2; }
	./scripts/release-check.sh --version "$(VERSION)"
```

But better: script validates:

```make
release/check:
	./scripts/release-check.sh --version "$(VERSION)"
```

If `VERSION` empty, script prints better usage.

Make should avoid duplicating validation unless simple.

---

## 22. Deploy Target

Use caution.

```make
ENV ?=
VERSION ?=

.PHONY: deploy
deploy:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)"
```

Do not default deploy env to prod.

Do not put secrets in Makefile.

Do not make deploy default.

Consider:

```make
deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

This mirrors safe CLI design.

---

## 23. Dangerous Targets Need Explicit Names

Bad:

```make
reset:
	rm -rf ...
```

Better:

```make
clean:
	./scripts/clean.sh --target build

clean/all:
	./scripts/clean.sh --target all --dry-run

clean/all/apply:
	./scripts/clean.sh --target all --apply
```

For deploy:

```make
deploy/plan
deploy/apply
```

For database:

```make
db/migrate/plan
db/migrate/apply
```

Make target names are UX.

---

## 24. Formatting and Linting

Java formatting:

```make
.PHONY: format format/check lint

format:
	$(MVN) spotless:apply

format/check:
	$(MVN) spotless:check

lint:
	$(MVN) checkstyle:check
```

Gradle:

```make
format:
	$(GRADLE) spotlessApply

format/check:
	$(GRADLE) spotlessCheck

lint:
	$(GRADLE) check
```

Be careful: Gradle `check` may include tests. Define clearly.

---

## 25. Script Quality Targets

From previous parts:

```make
.PHONY: scripts/check scripts/format

scripts/check:
	./scripts/check-scripts.sh

scripts/format:
	shfmt -w scripts
```

PowerShell:

```make
powershell/check:
	pwsh -NoProfile -File ./scripts/Check-PowerShell.ps1
```

Then:

```make
verify: scripts/check powershell/check test build
```

Only include if relevant.

---

## 26. Multi-Module Maven Project

Top-level Makefile:

```make
MVN ?= ./mvnw
MODULE ?=

test:
	$(MVN) test

test/module:
	@test -n "$(MODULE)" || { echo "MODULE is required"; exit 2; }
	$(MVN) -pl "$(MODULE)" test
```

Better script for validation:

```make
test/module:
	./scripts/test-module.sh --module "$(MODULE)"
```

Targets for common modules:

```make
test/api:
	$(MVN) -pl api test

test/worker:
	$(MVN) -pl worker test
```

Avoid making Makefile a full Maven module model.

---

## 27. Multi-Service Repository

Structure:

```text
services/api
services/worker
Makefile
```

Targets:

```make
SERVICE ?= api

.PHONY: service/test service/build

service/test:
	$(MAKE) -C services/$(SERVICE) test

service/build:
	$(MAKE) -C services/$(SERVICE) build
```

Validate service:

```make
SERVICES := api worker scheduler

service/test:
	@test "$(filter $(SERVICE),$(SERVICES))" = "$(SERVICE)" || { echo "Invalid SERVICE=$(SERVICE)"; exit 2; }
	$(MAKE) -C services/$(SERVICE) test
```

But validation in shell is clunky. Script may be better.

---

## 28. Monorepo Orchestration

Make can orchestrate high-level monorepo workflows:

```make
.PHONY: verify api/verify worker/verify

verify: api/verify worker/verify

api/verify:
	$(MAKE) -C services/api verify

worker/verify:
	$(MAKE) -C services/worker verify
```

With `make -j verify`, `api` and `worker` can run in parallel if independent.

Use `$(MAKE)` for sub-make.

If dependencies exist, encode them:

```make
worker/verify: api/build
```

But complex monorepo dependency graph may be better in Gradle/Bazel/Nx/etc.

---

## 29. CI Matrix Generation

Make can expose metadata:

```make
.PHONY: ci/matrix
ci/matrix:
	pwsh -NoProfile -File ./scripts/Generate-CiMatrix.ps1
```

or:

```make
ci/matrix:
	./scripts/generate-ci-matrix.sh
```

CI step consumes JSON.

Avoid generating complex JSON directly with echo in Make.

---

## 30. Variables as Public API

Common variables:

```make
ENV ?= dev
PROFILE ?= unit
IMAGE ?= my-service:local
VERSION ?=
SERVICE ?=
PORT ?= 8080
```

Document them in help.

Do not create ambiguous variables:

```make
TARGET ?= prod
```

Target means too many things.

Prefer:

```make
ENV
IMAGE_TAG
SERVICE
PROFILE
```

Make variables are CLI-like API:

```bash
make run ENV=staging PORT=9090
```

Treat them as stable.

---

## 31. Help Target Should Show Variables and Examples

```make
help:
	@echo "Usage:"
	@echo "  make <target> [VAR=value]"
	@echo ""
	@echo "Targets:"
	@echo "  verify             Run local verification"
	@echo "  test               Run tests"
	@echo "  docker/build       Build Docker image"
	@echo "  deploy/plan        Plan deployment"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=$(ENV)         dev|staging|prod"
	@echo "  PROFILE=$(PROFILE) Maven profile"
	@echo "  IMAGE=$(IMAGE)     Docker image"
	@echo "  VERSION=$(VERSION) Release version"
	@echo ""
	@echo "Examples:"
	@echo "  make test PROFILE=integration"
	@echo "  make docker/build IMAGE=my-service:abc123"
```

This is onboarding documentation.

---

## 32. Using `.env` with Make

Do not blindly:

```make
include .env
export
```

Problems:

- `.env` syntax may not be Make syntax;
- secrets can leak;
- Make parse errors;
- accidental variable export;
- untrusted local overrides.

If needed:

```make
-include local.mk
```

where `local.mk` is explicitly Make syntax and gitignored.

For application `.env`, let scripts/app load it.

Better:

```make
run:
	./scripts/run-local.sh --env "$(ENV)"
```

The script can load `.env` safely/explicitly.

---

## 33. Secrets in Make

Do not put secrets in Makefile:

```make
TOKEN := abc123
```

Do not print env dump in help.

Do not pass secrets as command-line variables if avoidable:

```bash
make deploy TOKEN=secret
```

Command-line vars can appear in shell history/process logs.

Prefer CI secret injection to env var consumed by script:

```make
deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

Script reads `DEPLOY_TOKEN` and avoids logging.

---

## 34. Make and Docker Build Args

Build args:

```make
docker/build:
	docker build \
	  --build-arg APP_VERSION="$(VERSION)" \
	  -t "$(IMAGE)" .
```

Do not pass secrets as Docker build args. They can leak into image layers/history.

For secrets, use BuildKit secrets if needed, but keep Make thin:

```make
docker/build:
	./scripts/docker-build.sh --image "$(IMAGE)" --version "$(VERSION)"
```

Script handles BuildKit semantics.

---

## 35. Make and Artifact Publishing

```make
.PHONY: publish/artifact

publish/artifact:
	./scripts/publish-artifact.sh --version "$(VERSION)"
```

Publish script should:

- validate version;
- check artifact exists;
- compute checksum;
- avoid overwrite unless explicit;
- use credentials securely;
- fail clearly.

Make should not implement upload logic inline.

---

## 36. Make and Container Push

```make
.PHONY: docker/push

docker/push:
	docker push "$(IMAGE)"
```

For production:

```make
docker/push:
	./scripts/docker-push.sh --image "$(IMAGE)"
```

Script can validate registry allowlist and auth.

Make variable:

```make
IMAGE ?=
```

No default production registry.

---

## 37. Real File Targets for Generated Artifacts

Example build metadata:

```make
BUILD_DIR := build
METADATA_JSON := $(BUILD_DIR)/metadata.json

.PHONY: metadata
metadata: $(METADATA_JSON)

$(METADATA_JSON): pom.xml | $(BUILD_DIR)
	./scripts/build-metadata.sh --json > $@

$(BUILD_DIR):
	mkdir -p $@
```

This gives incrementality.

But if metadata includes current timestamp or Git commit dirty state, prerequisite set may be incomplete. In such case, phony target may be more honest.

```make
.PHONY: metadata
metadata:
	./scripts/build-metadata.sh --json
```

Choose truth over fake incrementality.

---

## 38. When Not to Use Real Targets

Do not use timestamp targets if output depends on hidden state:

- current Git commit;
- current time;
- environment variables;
- network API;
- installed tool version;
- secrets;
- database state;
- Docker daemon state;
- Maven dependency cache state.

For these, use phony target or include hidden dependencies explicitly.

Example Docker image is not a normal file target. Use phony:

```make
.PHONY: docker/build
docker/build:
	docker build -t "$(IMAGE)" .
```

---

## 39. `.DELETE_ON_ERROR` for Real Artifacts

At top:

```make
.DELETE_ON_ERROR:
```

If a real target recipe fails, Make deletes partially updated target.

Useful for:

```make
build/metadata.json: ...
	./scripts/build-metadata.sh --json > $@
```

But `>` can truncate existing file before command completes. Safer:

```make
build/metadata.json: ...
	./scripts/build-metadata.sh --json > $@.tmp
	mv $@.tmp $@
```

Better atomic write in script.

---

## 40. CI Target Contract

Define:

```make
.PHONY: ci/verify ci/package ci/publish

ci/verify:
	$(MVN) $(MVN_CI_FLAGS) verify

ci/package:
	$(MVN) $(MVN_CI_FLAGS) package

ci/publish:
	./scripts/ci-publish.sh
```

CI uses `ci/*`.

Local uses regular targets.

This avoids local target semantics being distorted by CI-specific flags.

---

## 41. Complete Maven Service Makefile

```make
# Requires GNU Make.
ifndef MAKE_VERSION
$(error GNU Make is required)
endif

.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

APP_NAME := payment-service
MVN ?= ./mvnw
MVN_CI_FLAGS := --batch-mode --no-transfer-progress
ENV ?= dev
PROFILE ?= unit
PORT ?= 8080
IMAGE_TAG ?= local
IMAGE ?= $(APP_NAME):$(IMAGE_TAG)
VERSION ?=

.PHONY: help verify verify/full ci/verify test test/unit test/integration build run clean \
        docker/build docker/run docker/push local/up local/down local/logs \
        generate generate/openapi metadata deploy/plan deploy/apply print-%

help:
	@echo "Usage:"
	@echo "  make <target> [VAR=value]"
	@echo ""
	@echo "Targets:"
	@echo "  verify             Run standard local verification"
	@echo "  verify/full        Run slower/full verification"
	@echo "  ci/verify          Run CI verification"
	@echo "  test               Run unit tests"
	@echo "  test/integration   Run integration tests"
	@echo "  build              Build Maven package"
	@echo "  run                Run service locally"
	@echo "  clean              Clean build artifacts safely"
	@echo "  docker/build       Build Docker image"
	@echo "  docker/run         Run Docker image"
	@echo "  local/up           Start local dependencies"
	@echo "  local/down         Stop local dependencies"
	@echo "  generate           Run code generation"
	@echo "  metadata           Print build metadata JSON"
	@echo "  deploy/plan        Plan release deployment"
	@echo "  deploy/apply       Apply release deployment"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=$(ENV)"
	@echo "  PROFILE=$(PROFILE)"
	@echo "  PORT=$(PORT)"
	@echo "  IMAGE=$(IMAGE)"
	@echo "  VERSION=$(VERSION)"
	@echo "  MVN=$(MVN)"
	@echo ""
	@echo "Examples:"
	@echo "  make test PROFILE=integration"
	@echo "  make docker/build IMAGE_TAG=$$(git rev-parse --short HEAD)"
	@echo "  make deploy/plan ENV=staging VERSION=1.2.3"

verify: test build

verify/full: test/integration docker/build

ci/verify:
	$(MVN) $(MVN_CI_FLAGS) verify

test: test/unit

test/unit:
	$(MVN) -P unit test

test/integration:
	$(MVN) -P integration verify

build:
	$(MVN) -P "$(PROFILE)" package

run:
	APP_ENV="$(ENV)" SERVER_PORT="$(PORT)" ./scripts/run-local.sh

clean:
	./scripts/clean.sh --target all

docker/build:
	docker build -t "$(IMAGE)" .

docker/run:
	docker run --rm -p "$(PORT):8080" -e APP_ENV="$(ENV)" "$(IMAGE)"

docker/push:
	./scripts/docker-push.sh --image "$(IMAGE)"

local/up:
	docker compose up -d

local/down:
	docker compose down

local/logs:
	docker compose logs -f

generate: generate/openapi

generate/openapi:
	./scripts/generate-openapi-client.sh

metadata:
	./scripts/build-metadata.sh --json

deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply

print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
	@echo 'flavor=$(flavor $*)'
```

This is intentionally a facade. Complex safety lives in scripts.

---

## 42. Complete Gradle Service Makefile

```make
ifndef MAKE_VERSION
$(error GNU Make is required)
endif

.DEFAULT_GOAL := help

APP_NAME := payment-service
GRADLE ?= ./gradlew
GRADLE_CI_FLAGS := --no-daemon --stacktrace
ENV ?= dev
PORT ?= 8080
IMAGE_TAG ?= local
IMAGE ?= $(APP_NAME):$(IMAGE_TAG)
VERSION ?=

.PHONY: help verify verify/full ci/verify test test/integration build run clean \
        docker/build docker/run local/up local/down metadata deploy/plan deploy/apply print-%

help:
	@echo "Targets:"
	@echo "  verify             Run standard local verification"
	@echo "  verify/full        Run full verification"
	@echo "  ci/verify          Run CI verification"
	@echo "  test               Run unit tests"
	@echo "  test/integration   Run integration tests"
	@echo "  build              Build project"
	@echo "  run                Run service locally"
	@echo "  clean              Clean artifacts"
	@echo "  docker/build       Build Docker image"
	@echo "  metadata           Print build metadata"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=$(ENV)"
	@echo "  PORT=$(PORT)"
	@echo "  IMAGE=$(IMAGE)"
	@echo "  VERSION=$(VERSION)"
	@echo "  GRADLE=$(GRADLE)"

verify: test build

verify/full: test/integration docker/build

ci/verify:
	$(GRADLE) $(GRADLE_CI_FLAGS) build

test:
	$(GRADLE) test

test/integration:
	$(GRADLE) integrationTest

build:
	$(GRADLE) build

run:
	APP_ENV="$(ENV)" SERVER_PORT="$(PORT)" ./scripts/run-local.sh

clean:
	$(GRADLE) clean
	./scripts/clean.sh --target generated

docker/build:
	docker build -t "$(IMAGE)" .

docker/run:
	docker run --rm -p "$(PORT):8080" -e APP_ENV="$(ENV)" "$(IMAGE)"

local/up:
	docker compose up -d

local/down:
	docker compose down

metadata:
	pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -Output Json

deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply

print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
	@echo 'flavor=$(flavor $*)'
```

Gradle tasks may already cover more. Keep Make thin.

---

## 43. CI YAML Example

GitHub Actions style:

```yaml
name: verify

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
          cache: maven
      - name: Verify
        run: make ci/verify
```

The point: CI calls Make target. Make target calls build tool. Build tool owns Java graph.

---

## 44. Makefile Review for Java Projects

Ask:

### Java build ownership

- Does Maven/Gradle still own Java build?
- Are Make targets thin?
- Are profiles/tasks mapped clearly?

### Developer UX

- Does `make help` onboard?
- Are variables documented?
- Are common workflows stable?

### CI parity

- Does CI call Make?
- Are CI-specific flags explicit?
- Are local and CI targets intentionally different?

### Docker

- Is image naming explicit?
- Are secrets not passed as build args?
- Is Docker complexity delegated if needed?

### Safety

- Are deploy/release targets explicit?
- No default prod?
- Cleanup delegated to safe script?
- Version/env validation in scripts?

### Maintainability

- Is Makefile readable?
- Are complex shell fragments avoided?
- Are target names consistent?

---

## 45. Anti-Patterns

### 45.1 Make replaces Maven

Manual classpath, javac, test discovery. Bad unless educational.

### 45.2 CI has separate hidden command

Local:

```bash
make verify
```

CI:

```bash
./mvnw verify -DsomeHiddenFlag
```

Drift risk.

### 45.3 Secrets in variables

```bash
make deploy TOKEN=secret
```

Bad for history/process/logs.

### 45.4 Default target mutates

`make` deploys/builds/pushes. Bad. Default should usually be help.

### 45.5 Too much validation in Make

Make syntax becomes unreadable. Validate in scripts.

### 45.6 Docker tag from top-level `$(shell git ...)` everywhere

`make help` becomes Git-dependent. Compute lazily or pass from CI.

### 45.7 Overusing real targets for hidden-state outputs

Timestamp graph lies when output depends on env/network/time.

---

## 46. Mini Lab

### Lab 1 — Maven Facade

Create Makefile with:

```text
help
test
build
verify
clean
```

Use `./mvnw`.

---

### Lab 2 — Profiles

Add:

```make
PROFILE ?= unit
```

Run:

```bash
make test PROFILE=integration
```

---

### Lab 3 — Docker Target

Add:

```make
IMAGE ?= my-service:local
docker/build
docker/run
```

---

### Lab 4 — CI Target

Add:

```make
MVN_CI_FLAGS := --batch-mode --no-transfer-progress
ci/verify
```

---

### Lab 5 — Deploy Plan

Add:

```make
deploy/plan
deploy/apply
```

that call script, not inline deploy logic.

---

## 47. Design Exercise: Production-Ready Java Makefile

Design Makefile for a Java service with:

```text
Maven wrapper
unit/integration tests
Docker build/run/push
local dependencies via docker compose
OpenAPI generation
build metadata
deploy plan/apply
CI verify
safe clean
help
print-%
```

Constraints:

- no secrets in Makefile;
- default target is help;
- deploy env/version explicit;
- Maven owns Java build;
- scripts own complex logic;
- CI target uses batch mode;
- Docker image variable documented;
- no top-level slow `$(shell ...)`;
- `make -j verify` must not create race conditions.

Review it with the checklist.

---

## 48. Part 020 Summary

For Java projects, Make is most valuable as a stable workflow facade.

Key takeaways:

1. Maven/Gradle should own Java build graph.
2. Make should provide stable, discoverable targets.
3. `make help` is onboarding documentation.
4. Use Maven/Gradle wrappers by default.
5. Separate local targets from `ci/*` targets when needed.
6. Map test profiles/tasks clearly.
7. Docker targets should be explicit and variable-driven.
8. Local dependency targets can wrap Docker Compose.
9. Generated artifacts can use Make graph/stamps when dependencies are honest.
10. Hidden-state outputs should remain phony.
11. Deploy/release targets should be explicit and safe.
12. Do not put secrets or complex validation in Make.
13. Delegate imperative safety to Bash/PowerShell scripts.
14. Treat Make variables and targets as public team API.
15. CI should call the same facade where practical to reduce drift.

Part 021 will discuss Makefile as workflow orchestrator, not build system replacement, and how to decide boundaries between Make, scripts, Maven/Gradle, CI, and real CLIs.

---

## 49. Referensi Resmi dan Bacaan Lanjutan

- GNU Make Manual — Phony Targets, Variables, Recipes, Recursive Make.
- Maven Wrapper documentation.
- Maven lifecycle documentation.
- Gradle Wrapper documentation.
- Gradle task graph and lifecycle documentation.
- Docker build documentation.
- Docker Compose documentation.
- OpenAPI Generator documentation.
- CI provider documentation for build matrix and shell execution.
- Twelve-Factor App config principles for env-driven workflow.

---

## 50. Status Seri

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
- [ ] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Practical Makefile Syntax and Execution Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-021.md">Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement ➡️</a>
</div>
