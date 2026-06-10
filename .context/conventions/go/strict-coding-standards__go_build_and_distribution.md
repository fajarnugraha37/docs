# Strict Coding Standards — Go Build and Distribution

> Mandatory conventions for LLM-assisted Go build, packaging, release artifact, and distribution work.
>
> This document is a merge gate. It is not optional advice. If an implementation conflicts with this standard, the LLM/code agent MUST either fix the implementation or explicitly report the conflict.

---

## 0. Scope

This standard applies to Go projects that produce:

- service binaries;
- worker binaries;
- CLI binaries;
- migration runners;
- sidecar utilities;
- libraries with generated artifacts;
- Docker/container images;
- release archives;
- SBOM/provenance artifacts;
- internal distribution packages.

It covers:

- `go build`, `go install`, `go run` usage;
- build flags;
- version metadata injection;
- cross-compilation;
- CGO policy;
- reproducibility;
- container builds;
- generated code in builds;
- test-before-build gates;
- release artifact naming;
- checksums/signing/SBOM;
- binary hardening and debug metadata;
- distribution and rollback expectations.

---

## 1. Source Baseline

Use this document together with these canonical references:

- `cmd/go`: <https://pkg.go.dev/cmd/go>
- Go Modules Reference: <https://go.dev/ref/mod>
- Go toolchains: <https://go.dev/doc/toolchain>
- Perfectly Reproducible, Verified Go Toolchains: <https://go.dev/blog/rebuild>
- Go vulnerability management: <https://go.dev/doc/security/vuln/>
- Go security best practices: <https://go.dev/doc/security/best-practices>
- Data race detector: <https://go.dev/doc/articles/race_detector>
- Go diagnostics: <https://go.dev/doc/diagnostics>
- Build constraints: <https://pkg.go.dev/cmd/go#hdr-Build_constraints>
- `runtime/debug`: <https://pkg.go.dev/runtime/debug>
- `debug/buildinfo`: <https://pkg.go.dev/debug/buildinfo>

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

Go build and distribution MUST optimize for:

1. correctness before packaging;
2. deterministic output where practical;
3. explicit target platform;
4. minimal runtime image;
5. traceable version metadata;
6. supply-chain integrity;
7. secure defaults;
8. simple rollback;
9. operational diagnosability;
10. CI/CD repeatability.

Every release artifact MUST answer:

```text
What source revision produced it?
What Go toolchain built it?
What dependencies are included?
What target OS/architecture is it for?
How can it be verified?
How can it be debugged?
How can it be rolled back?
```

---

## 4. Build Entry Point Rules

Production binaries SHOULD have explicit `cmd/<name>` entrypoints.

Example:

```text
cmd/api/main.go
cmd/worker/main.go
cmd/migrate/main.go
```

Build commands MUST target commands explicitly:

```bash
go build -o dist/api ./cmd/api
```

Forbidden:

```bash
go build ./...
```

as a release build command when multiple packages/commands exist and artifact identity matters.

`go build ./...` MAY be used as a compile gate, not as the release artifact builder.

---

## 5. Pre-Build Quality Gate

Before building release artifacts, CI MUST run or explicitly document exception for:

```bash
gofmt -w .
go mod tidy
git diff --exit-code
go test ./...
go vet ./...
govulncheck ./...
```

For concurrency-sensitive code:

```bash
go test -race ./...
```

For generated-code projects:

```bash
go generate ./...
git diff --exit-code
```

LLM MUST NOT create a release build path that bypasses tests and vulnerability scanning.

---

## 6. `go build` Rules

### 6.1 Basic build command

Recommended base:

```bash
CGO_ENABLED=0 go build -trimpath -o dist/<name> ./cmd/<name>
```

Rules:

- `-o` MUST be explicit for release artifacts.
- `-trimpath` SHOULD be enabled for reproducibility and path hygiene.
- target package MUST be explicit.
- build output directory SHOULD be outside source packages, e.g. `dist/` or `bin/`.

### 6.2 No implicit local state

Release build MUST NOT depend on:

- local uncommitted files;
- absolute local paths;
- globally installed tools;
- machine hostname;
- developer-specific environment variables;
- network calls during compilation except controlled module download in CI;
- generated files not committed or generated in build pipeline.

---

## 7. Version Metadata Injection

Release binaries SHOULD expose build metadata through a command or endpoint.

Recommended fields:

```text
version
commit
buildTime
goVersion
osArch
```

Example package:

```go
package buildinfo

var (
    Version   = "dev"
    Commit    = "unknown"
    BuildTime = "unknown"
)
```

Build command:

```bash
go build \
  -trimpath \
  -ldflags "-X 'example.com/acme/service/internal/buildinfo.Version=${VERSION}' -X 'example.com/acme/service/internal/buildinfo.Commit=${COMMIT}' -X 'example.com/acme/service/internal/buildinfo.BuildTime=${BUILD_TIME}'" \
  -o dist/api ./cmd/api
```

Rules:

- Metadata variable paths MUST be stable.
- Metadata MUST NOT include secrets.
- `BuildTime` reduces strict reproducibility; if reproducibility is mandatory, use source-date policy or omit dynamic timestamp.
- LLM MUST NOT inject metadata into unrelated packages.

---

## 8. Build Info Inspection

Go binaries include build information for module-aware builds.

Rules:

- Release process SHOULD preserve build info unless there is a strong security reason to strip it.
- Operators SHOULD be able to inspect artifact provenance.
- If binary is stripped, build metadata endpoint/command MUST still provide enough traceability.

Example runtime access:

```go
info, ok := debug.ReadBuildInfo()
```

Example external inspection:

```bash
go version -m ./dist/api
```

---

## 9. `ldflags` Rules

Allowed:

```bash
-ldflags "-s -w"
```

for reducing binary size when debug symbols are not needed in the shipped artifact.

Rules:

- Do not strip all diagnostic capability without alternate debug artifact retention.
- Keep unstripped binary or symbol mapping for incident investigation when required.
- `-X` MUST only inject string variables.
- `-X` paths MUST match full import path.
- LLM MUST NOT use `ldflags` to alter program behavior that should be config.

Forbidden:

```bash
-ldflags "-X main.DatabasePassword=secret"
```

---

## 10. Reproducible Build Rules

Reproducible builds SHOULD be pursued for release artifacts.

Recommended for pure Go binaries:

```bash
CGO_ENABLED=0 go build -trimpath -buildvcs=true -o dist/api ./cmd/api
```

Rules:

- Disable CGO when not required.
- Use `-trimpath`.
- Pin Go toolchain.
- Pin module dependencies through `go.mod` and `go.sum`.
- Avoid dynamic build timestamps unless controlled.
- Use clean source checkout.
- Keep build environment documented.

If CGO is required, reproducibility must include C compiler, libc, headers, and external library versions.

---

## 11. VCS Metadata Rules

`go build` may embed VCS metadata in module-aware builds.

Rules:

- Release builds SHOULD keep VCS metadata unless policy disables it.
- Dirty-tree builds MUST NOT be promoted as clean releases.
- CI SHOULD fail if source tree is dirty before release build.

Recommended:

```bash
git diff --exit-code
git status --short
```

If using `-buildvcs=false`, project MUST provide equivalent metadata through other means.

---

## 12. CGO Policy

CGO MUST be disabled by default for service/CLI builds unless explicitly required.

Default:

```bash
CGO_ENABLED=0
```

CGO allowed when needed for:

- SQLite drivers requiring C;
- OS-specific integrations;
- native crypto/FIPS requirements;
- legacy libraries;
- performance-critical native dependency;
- platform-specific system APIs.

If CGO is enabled, build documentation MUST include:

- required C compiler;
- OS/libc target;
- external library versions;
- container build image;
- vulnerability scan strategy;
- runtime shared library requirements;
- cross-compile strategy.

LLM MUST NOT enable CGO accidentally by importing packages that require it without documenting runtime impact.

---

## 13. Cross-Compilation Rules

Cross-compilation MUST specify target explicitly.

Example:

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o dist/api-linux-amd64 ./cmd/api
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -o dist/api-linux-arm64 ./cmd/api
```

Rules:

- Artifact names MUST include OS and architecture.
- CI MUST test at least the primary deployment target.
- Do not claim a target is supported unless it is built and tested.
- CGO cross-compilation requires dedicated toolchain and must be documented.

---

## 14. Build Tags Rules

Build tags MUST define intentional variants.

Allowed examples:

```go
//go:build integration
```

```go
//go:build linux
```

```go
//go:build fips
```

Rules:

- Build tags MUST be documented in build scripts/README.
- CI MUST compile every supported build-tag combination.
- Build tags MUST NOT hide failing production code.
- Build tags MUST NOT select secrets.
- Build tags MUST NOT create incompatible public APIs unless intentionally platform-specific.

Release command with tag:

```bash
go build -tags=fips -trimpath -o dist/api ./cmd/api
```

---

## 15. Race Builds

Race detector builds are for testing, not production distribution unless explicitly required for diagnostics.

Required gate for concurrency-sensitive code:

```bash
go test -race ./...
```

Optional diagnostic binary:

```bash
go build -race -o dist/api-race ./cmd/api
```

Rules:

- Race binary MUST NOT be used for normal production due to overhead.
- Race gate SHOULD run in CI for supported platforms.

---

## 16. Test Binary Rules

Test binaries MAY be built for controlled environments.

Example:

```bash
go test -c -o dist/service.test ./internal/service
```

Rules:

- Test binaries MUST NOT be shipped as production artifacts.
- Test-only build tags MUST NOT affect production binary.
- Test binaries may include debug-only dependencies; do not mix with release packaging.

---

## 17. `go install` Rules

Use `go install pkg@version` for installing external commands in developer setup only when project tool policy permits it.

CI/release SHOULD prefer pinned tools through `go.mod` `tool` directive or controlled build image.

Forbidden in CI release build:

```bash
go install example.com/tool@latest
```

Allowed with pin:

```bash
go install example.com/tool@v1.2.3
```

Preferred Go 1.24+ tool flow:

```bash
go tool stringer -type=Status
```

---

## 18. `go run` Rules

`go run` SHOULD NOT be used in release build scripts for production artifacts.

Allowed:

- local development;
- code generation with pinned tool/module;
- one-off migration in controlled environment;
- examples.

Forbidden:

```bash
go run ./cmd/api
```

as a production deployment mode.

Release artifacts MUST be built once and promoted, not rebuilt ad hoc in each environment.

---

## 19. Generated Code Build Rules

If generated code is required, build pipeline MUST define one of two policies.

Policy A — generated code committed:

```bash
go generate ./...
git diff --exit-code
```

Policy B — generated code produced during build:

```bash
go generate ./...
go test ./...
go build ...
```

Rules:

- Tool versions MUST be pinned.
- Generation MUST be deterministic.
- Network-dependent generation is forbidden unless explicitly controlled.
- LLM MUST NOT edit generated files manually.

---

## 20. Container Build Rules

### 20.1 Multi-stage build

Preferred Dockerfile shape:

```dockerfile
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go test ./...
RUN CGO_ENABLED=0 go build -trimpath -o /out/app ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
ENTRYPOINT ["/app"]
```

Rules:

- Build stage MUST use pinned Go version/image digest when release reproducibility matters.
- Runtime image SHOULD be minimal.
- Runtime image MUST NOT contain source code or build cache.
- Container MUST run as non-root unless explicit reason.
- Healthcheck/readiness behavior MUST be implemented by the app/platform.

### 20.2 Scratch/distroless caveats

If using `scratch` or static distroless:

- include CA certificates if making HTTPS outbound calls;
- include timezone data only if needed;
- ensure user/group setup if non-root;
- verify DNS resolution behavior;
- verify file path expectations.

LLM MUST NOT switch to `scratch` blindly.

---

## 21. Runtime Configuration Rules

Build artifacts MUST be environment-agnostic.

Forbidden:

- compile database URLs into binary;
- compile secrets into binary;
- build separate binary for dev/staging/prod only to change config;
- use build tags to choose environment behavior.

Allowed:

- feature build tags for real compile-time capability differences;
- runtime config through environment/files/secret manager;
- version metadata injection.

---

## 22. Artifact Naming Rules

Release artifact names MUST be deterministic and informative.

Recommended:

```text
<app>_<version>_<goos>_<goarch>.tar.gz
<app>_<version>_<goos>_<goarch>.zip
<app>_<version>_<goos>_<goarch>.sha256
```

Examples:

```text
case-api_1.8.3_linux_amd64.tar.gz
case-api_1.8.3_linux_arm64.tar.gz
```

Rules:

- Include OS/architecture.
- Include semantic version or immutable build ID.
- Include checksum.
- Avoid `latest` as artifact identity.

---

## 23. Checksums and Signing Rules

Release artifacts SHOULD have checksums.

Example:

```bash
sha256sum dist/* > dist/checksums.txt
```

For regulated/high-trust environments, artifacts SHOULD be signed using approved signing tooling.

Rules:

- Checksums MUST be generated after final packaging.
- Checksums MUST be distributed through trusted channel.
- Signing keys MUST NOT be available to normal build steps unless required.
- LLM MUST NOT invent signing keys or embed keys in scripts.

---

## 24. SBOM and Provenance Rules

Release pipeline SHOULD produce SBOM/provenance artifacts when project policy requires supply-chain traceability.

SBOM SHOULD include:

- application module;
- dependency modules and versions;
- Go toolchain version;
- container base image;
- OS packages if containerized;
- generated artifacts/tools where relevant.

Provenance SHOULD include:

- source commit;
- repository URL;
- builder identity;
- build command;
- timestamp policy;
- artifact digest.

LLM MUST NOT claim supply-chain compliance without generated evidence.

---

## 25. Binary Size Rules

Binary size optimization MUST be evidence-based.

Allowed:

```bash
go build -trimpath -ldflags "-s -w" -o dist/app ./cmd/app
```

Rules:

- Measure before and after.
- Do not remove debug capability without an incident-debug plan.
- Avoid adding large dependencies for minor convenience.
- Keep separate debug artifacts if stripping production binary.

Useful inspection:

```bash
go tool nm dist/app
go version -m dist/app
```

---

## 26. Startup and Shutdown Distribution Gate

Release binary MUST support operational lifecycle:

- starts with explicit config validation;
- fails fast on invalid required config;
- logs version/build metadata at startup;
- handles SIGTERM/SIGINT gracefully;
- closes network listeners;
- drains in-flight requests where applicable;
- stops workers;
- flushes logs/telemetry;
- exits non-zero on startup failure.

LLM MUST NOT create binaries that only work through `go run` behavior.

---

## 27. CLI Distribution Rules

CLI binaries MUST support:

- `--version` or equivalent;
- clear exit codes;
- `--help`;
- no panic stack trace for normal user error;
- context/signal cancellation;
- no secrets in error output;
- predictable config file search path.

CLI release archives SHOULD include:

```text
binary
README or usage link
LICENSE/NOTICE when required
checksums
```

---

## 28. Service Distribution Rules

Service artifacts MUST define:

- executable path;
- config contract;
- ports;
- health/readiness endpoints;
- required file mounts;
- required capabilities;
- resource expectations;
- signal handling;
- log output format;
- telemetry endpoints/exporters.

Containerized services MUST NOT require mutable local filesystem unless explicitly documented.

---

## 29. Migration Binary Rules

Database migration commands MUST be packaged carefully.

Rules:

- Migration binary MUST be versioned with application release.
- Migration execution MUST be separated from normal app startup unless project policy requires startup migration.
- Migration command MUST support dry-run/status where feasible.
- Migration command MUST fail safely and report dirty state.
- Migration image MUST include migration files.
- Migration artifact MUST be traceable to source commit.

LLM MUST NOT silently run migrations as part of normal binary startup without architecture decision.

---

## 30. Static Assets and Embedding Rules

If using `embed`, embedded files are part of the binary contract.

Rules:

- Embedded paths MUST be stable.
- Do not embed secrets.
- Do not embed environment-specific config.
- Large embedded files require size review.
- Embedded templates/static assets MUST have tests verifying presence.

Example:

```go
//go:embed templates/*.html
var templatesFS embed.FS
```

---

## 31. File Permissions in Archives

Release archives MUST preserve executable bit for binaries.

Rules:

- Unix binaries in `.tar.gz` SHOULD have mode `0755`.
- Config/examples SHOULD have mode `0644`.
- Secrets MUST NOT be included.
- Windows releases SHOULD use `.zip` when appropriate.

---

## 32. Windows Distribution Rules

When targeting Windows:

- binary name SHOULD include `.exe`;
- path handling MUST be tested;
- service behavior differs from Unix signal handling;
- archive format SHOULD be `.zip`;
- shell scripts MUST have PowerShell equivalents if project supports Windows developers.

Example:

```bash
GOOS=windows GOARCH=amd64 go build -trimpath -o dist/app_windows_amd64.exe ./cmd/app
```

---

## 33. Linux Distribution Rules

When targeting Linux services:

- target libc/static policy MUST be explicit;
- container base image MUST match runtime needs;
- CA certificates/timezone data must be present if needed;
- non-root execution must be verified;
- file descriptors and ulimits should be documented if relevant.

---

## 34. Build Cache Rules

Build caches are allowed for CI speed but MUST NOT affect artifact correctness.

Rules:

- Cache keys SHOULD include Go version and `go.sum` hash.
- Do not cache source-generated outputs without invalidation rules.
- Do not promote artifacts from untrusted cache.
- Clean release builds SHOULD be possible.

---

## 35. Module Download Rules in CI

CI SHOULD download dependencies in a controlled step:

```bash
go mod download
```

Rules:

- Private module credentials must be injected securely.
- Do not use `GOINSECURE` unless approved.
- Do not disable checksum database globally.
- Use module proxy policy defined by organization.

---

## 36. Build Script Rules

Build scripts SHOULD be simple and auditable.

Allowed files:

```text
Makefile
scripts/build.sh
scripts/build.ps1
Taskfile.yml
```

Rules:

- Scripts MUST fail on errors.
- Scripts MUST echo or document build inputs.
- Scripts MUST support clean rebuild.
- Scripts MUST not hide dependency upgrades.
- Scripts MUST not download arbitrary remote scripts.
- Scripts MUST not require interactive input in CI.

Shell script baseline:

```bash
set -euo pipefail
```

PowerShell baseline:

```powershell
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
```

---

## 37. Makefile Rules

If using Makefile, targets MUST be explicit and safe.

Recommended:

```makefile
.PHONY: tidy test vet vuln build clean

tidy:
	go mod tidy

generate:
	go generate ./...

test:
	go test ./...

vet:
	go vet ./...

vuln:
	govulncheck ./...

build:
	CGO_ENABLED=0 go build -trimpath -o dist/app ./cmd/app

clean:
	rm -rf dist
```

Rules:

- `make build` MUST not mutate dependencies.
- `make release` MUST not use `@latest`.
- `make clean` MUST not delete source/config.

---

## 38. Release Pipeline Stages

Recommended release pipeline:

```text
checkout clean source
verify toolchain
restore safe cache
mod download
generate check
tidy check
format check
unit tests
race tests
vet/static analysis
vulnerability scan
build binaries
package artifacts
scan binaries/images
produce checksum/SBOM/provenance
publish immutable artifacts
deploy/promote
smoke test
```

LLM MUST NOT collapse all stages into one opaque script.

---

## 39. Container Image Tagging Rules

Container images MUST use immutable tags for deployment.

Allowed:

```text
registry.example.com/acme/case-api:1.8.3
registry.example.com/acme/case-api:git-<sha>
registry.example.com/acme/case-api@sha256:<digest>
```

Forbidden as deployment identity:

```text
latest
main
dev
```

`latest` MAY be published as convenience tag but MUST NOT be used by production deployment manifests.

---

## 40. Container Security Rules

Container images MUST:

- run as non-root where possible;
- use minimal runtime base;
- include only required files;
- avoid shell/package manager in runtime image if not needed;
- not include credentials;
- not include source code unless required;
- expose only intended ports;
- set read-only filesystem if platform supports it;
- be scanned by approved image scanner.

LLM MUST NOT create Dockerfiles that copy the entire build context into runtime image.

Bad:

```dockerfile
FROM golang:1.26
COPY . /app
CMD ["go", "run", "./cmd/api"]
```

---

## 41. Runtime Base Image Rules

Choose base image based on runtime needs.

| Need                        | Candidate                                    |
| --------------------------- | -------------------------------------------- |
| pure static binary          | `scratch`, distroless static                 |
| HTTPS outbound              | distroless with CA certs or copied certs     |
| timezone local calculations | include tzdata or avoid local-zone reliance  |
| CGO/glibc                   | Debian/Ubuntu/distroless base matching libc  |
| shell debugging             | separate debug image, not production default |

LLM MUST document why a base image is chosen.

---

## 42. Secrets in Build Rules

Secrets MUST NOT be baked into binaries or images.

Forbidden:

- `ARG DB_PASSWORD` copied into image;
- `ENV API_KEY=...` in Dockerfile;
- `-ldflags -X ...Secret=...`;
- committing `.env` into image;
- storing private module token in `go env -w` inside image layer.

Use secret mounts or CI secret injection for build-time credentials.

---

## 43. Network Access During Build

Build steps SHOULD minimize network access.

Allowed controlled network access:

- module download from approved proxy;
- OS package install from pinned base image policy;
- artifact upload to approved registry.

Forbidden:

```dockerfile
RUN curl https://example.com/install.sh | sh
```

unless project has explicitly reviewed the source and pinning strategy.

---

## 44. Release Notes and Changelog Rules

Release artifacts SHOULD link to release notes/changelog.

Release notes SHOULD include:

- version;
- commit/tag;
- migration notes;
- config changes;
- dependency/security fixes;
- breaking changes;
- rollback notes;
- artifact checksums.

LLM MUST NOT generate release notes claiming tests/scans passed unless evidence exists.

---

## 45. Rollback Rules

Every distributed artifact MUST support rollback through immutable identity.

Rules:

- previous artifact must remain available;
- database migrations must define rollback/recovery policy;
- feature flags/config migration must be compatible;
- image tags must not be overwritten for released versions;
- build pipeline must not mutate published artifacts.

LLM MUST NOT design release flow that rebuilds “same version” differently during rollback.

---

## 46. Observability in Built Artifacts

Release binaries MUST support operational introspection:

- version/build info;
- health/readiness endpoint or command;
- structured logs;
- metrics/tracing if service policy requires;
- pprof only if secured and explicitly enabled;
- clear startup config validation errors.

LLM MUST NOT enable public unauthenticated pprof in production by default.

---

## 47. Debug Artifact Rules

For production incident response, project SHOULD retain:

- unstripped binary or debug symbols;
- source commit;
- dependency list;
- build command;
- container digest;
- config schema version.

If production artifact is stripped, debug artifact MUST correspond exactly to the same source/toolchain/dependencies.

---

## 48. Performance Build Rules

Performance-sensitive builds MUST document:

- target CPU architecture;
- CGO/static policy;
- Go version;
- GC/runtime env assumptions;
- benchmark evidence;
- pprof baseline if relevant.

LLM MUST NOT add compiler flags or runtime environment variables for performance without benchmark evidence.

Forbidden as blind defaults:

```bash
GOGC=off
GOMAXPROCS=1
```

unless workload-specific benchmark justifies them.

---

## 49. FIPS/Crypto Build Rules

If project requires FIPS or regulated crypto behavior:

- build must use approved Go version and crypto policy;
- build tags/env flags must be documented;
- runtime verification should be available;
- dependency crypto usage must be reviewed;
- non-approved crypto packages must be blocked.

LLM MUST NOT claim FIPS compliance from package names alone.

---

## 50. Database Driver Build Rules

Database drivers may affect build/distribution.

Rules:

- pure-Go drivers are preferred for static containers when acceptable;
- CGO drivers require runtime library policy;
- driver registration through blank import must be documented;
- migration binaries must include driver dependencies;
- driver upgrade must be tested against target DB version.

---

## 51. Asset, Config, and Schema Distribution

Release packaging MUST include all runtime-required non-secret files:

- migrations;
- templates;
- static assets;
- CA bundles if custom;
- policy files;
- schema files;
- default config examples.

Rules:

- Do not include local `.env` secrets.
- Validate asset presence at startup.
- Prefer embedding small immutable assets when operationally simpler.
- Large mutable assets should be mounted/configured externally.

---

## 52. Dependency Vulnerability Scan of Artifacts

Source scan:

```bash
govulncheck ./...
```

Binary scan, when supported by tooling:

```bash
govulncheck -mode=binary ./dist/app
```

Rules:

- Source and artifact scans complement each other.
- Container images must be scanned for OS package vulnerabilities too.
- LLM MUST NOT mark an artifact secure based only on `go test`.

---

## 53. Release Build Matrix

Every project SHOULD define supported targets.

Example:

```text
linux/amd64: supported, production
linux/arm64: supported, production
windows/amd64: supported, CLI only
darwin/arm64: supported, developer CLI only
```

LLM MUST NOT add cross-build targets without test/support expectation.

---

## 54. Distribution of Libraries

Libraries are distributed by module version, not binary packaging.

Rules:

- public library releases MUST use git tags matching module version;
- `v2+` modules MUST use semantic import version path;
- generated docs/examples should compile;
- breaking change requires major version policy;
- retracted versions must include rationale.

LLM MUST NOT treat library release like service binary release.

---

## 55. Distribution of Tools

Internal Go tools SHOULD be distributed as:

- module-pinned `go tool` dependency;
- versioned binary artifact;
- container image;
- project-managed install script with pinned version.

Forbidden:

```bash
go install example.com/acme/tool@latest
```

as a required CI setup step.

---

## 56. Build Failure Handling

Build scripts MUST fail loudly and early.

Rules:

- Do not ignore errors with `|| true`.
- Do not continue packaging after failed tests.
- Do not publish partial artifacts.
- Clean up temporary credentials.
- Print enough diagnostics to debug failure.

LLM MUST NOT suppress errors to make CI green.

---

## 57. Local Developer Build Rules

Developer convenience builds MAY be simpler, but must not be confused with release builds.

Allowed:

```bash
go run ./cmd/api
```

for local dev.

Required distinction:

```text
make dev      # local convenience
make build    # release-like local build
make release  # CI/release artifact build
```

LLM MUST preserve the distinction.

---

## 58. Example Release Script

Minimal Unix release script:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP="case-api"
CMD="./cmd/api"
VERSION="${VERSION:?VERSION is required}"
COMMIT="$(git rev-parse --short=12 HEAD)"
BUILD_TIME="${SOURCE_DATE_EPOCH:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

mkdir -p dist

git diff --exit-code

go mod tidy
git diff --exit-code -- go.mod go.sum

go test ./...
go vet ./...
govulncheck ./...

for target in linux/amd64 linux/arm64; do
  GOOS="${target%/*}"
  GOARCH="${target#*/}"
  OUT="dist/${APP}_${VERSION}_${GOOS}_${GOARCH}"

  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build \
    -trimpath \
    -ldflags "-X 'example.com/acme/case-api/internal/buildinfo.Version=${VERSION}' -X 'example.com/acme/case-api/internal/buildinfo.Commit=${COMMIT}' -X 'example.com/acme/case-api/internal/buildinfo.BuildTime=${BUILD_TIME}'" \
    -o "$OUT" "$CMD"
done

sha256sum dist/* > dist/checksums.txt
```

This is an example. Projects MUST adjust import paths and policy.

---

## 59. Example PowerShell Build Script

Minimal Windows-friendly build script:

```powershell
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$App = "case-api"
$Cmd = "./cmd/api"
$Version = $env:VERSION
if ([string]::IsNullOrWhiteSpace($Version)) { throw "VERSION is required" }
$Commit = (git rev-parse --short=12 HEAD).Trim()
$BuildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

New-Item -ItemType Directory -Force -Path dist | Out-Null

git diff --exit-code

go mod tidy
git diff --exit-code -- go.mod go.sum

go test ./...
go vet ./...
govulncheck ./...

$targets = @(
  @{ GOOS = "linux"; GOARCH = "amd64"; EXT = "" },
  @{ GOOS = "linux"; GOARCH = "arm64"; EXT = "" },
  @{ GOOS = "windows"; GOARCH = "amd64"; EXT = ".exe" }
)

foreach ($target in $targets) {
  $env:CGO_ENABLED = "0"
  $env:GOOS = $target.GOOS
  $env:GOARCH = $target.GOARCH

  $Out = "dist/$App`_$Version`_$($target.GOOS)`_$($target.GOARCH)$($target.EXT)"
  go build `
    -trimpath `
    -ldflags "-X 'example.com/acme/case-api/internal/buildinfo.Version=$Version' -X 'example.com/acme/case-api/internal/buildinfo.Commit=$Commit' -X 'example.com/acme/case-api/internal/buildinfo.BuildTime=$BuildTime'" `
    -o $Out $Cmd
}

Get-FileHash dist/* -Algorithm SHA256 | Format-Table -AutoSize | Out-File dist/checksums.txt
```

---

## 60. Forbidden Patterns

LLM MUST NOT:

- deploy with `go run`;
- build from dirty source without marking artifact dirty;
- use `@latest` in release builds;
- compile secrets into binary;
- copy source tree into runtime container image;
- run container as root without reason;
- use `latest` as production deployment identity;
- skip tests/scans in release pipeline;
- delete `go.sum` to fix build;
- disable checksum verification globally;
- enable CGO without documenting runtime impact;
- use dynamic build timestamp when strict reproducibility is required;
- strip binaries without retaining debug strategy;
- hide production code behind untested build tags;
- publish artifacts without checksums;
- claim SBOM/signing/provenance without generated evidence;
- rebuild the “same version” differently for rollback.

---

## 61. Preferred Patterns

LLM SHOULD prefer:

- explicit `cmd/<name>` build targets;
- `CGO_ENABLED=0` for pure-Go service binaries;
- `-trimpath` for release builds;
- pinned Go toolchain;
- pinned tool dependencies;
- version metadata injection without secrets;
- immutable artifact names;
- checksums;
- minimal non-root runtime containers;
- clean pre-build gates;
- generated-code verification;
- vulnerability scanning;
- target OS/architecture matrix;
- separate dev/build/release commands;
- release notes with rollback notes.

---

## 62. Review Checklist

Before merging build/distribution changes, verify:

- [ ] Build targets are explicit.
- [ ] Release build does not use `go run`.
- [ ] `go test ./...` passes before build.
- [ ] `go vet ./...` passes or exceptions are documented.
- [ ] `govulncheck ./...` is run or explicitly deferred.
- [ ] Generated code is deterministic and checked.
- [ ] `go.mod`/`go.sum` are tidy.
- [ ] Go toolchain version is pinned/controlled.
- [ ] `CGO_ENABLED` policy is explicit.
- [ ] `-trimpath` is used where appropriate.
- [ ] Build metadata contains version and commit.
- [ ] No secrets are injected at build time.
- [ ] Cross-compile targets are named and tested.
- [ ] Container runtime image is minimal and non-root.
- [ ] Artifacts are immutable and include OS/arch.
- [ ] Checksums are produced.
- [ ] SBOM/provenance policy is followed.
- [ ] Rollback path exists.
- [ ] Debug strategy exists for stripped binaries.
- [ ] Production image does not contain source/build cache.

---

## 63. Agent Refusal Conditions

LLM MUST refuse or request human decision before:

- embedding secrets in binary/image;
- disabling checksum verification;
- deploying using `go run`;
- publishing mutable `latest`-only artifacts;
- enabling CGO without runtime documentation;
- removing tests/scans from release pipeline;
- signing artifacts without approved key process;
- claiming compliance/provenance without evidence;
- introducing unpinned remote install scripts;
- modifying release tags after publication;
- hiding build failures with shell suppression.

The response MUST include the safer alternative.
