# Strict Coding Standards — Go Docker

> Mandatory standards for LLM/code-agent generated Go container images.  
> This document is a merge gate, not a style suggestion.

## 0. Purpose

This standard governs Dockerfile, `.dockerignore`, container image layout, runtime defaults, and build/release behavior for Go services, CLIs, workers, and jobs.

The goal is not merely to "make a Docker image". The goal is to produce an image that is:

- reproducible enough to debug and release safely;
- minimal enough to reduce attack surface;
- secure by default;
- observable at runtime;
- compatible with Kubernetes/container orchestration;
- aligned with Go runtime behavior, especially CPU, memory, signal handling, and static/dynamic linking.

## 1. Source authority

When this file conflicts with casual blog patterns, follow these sources first:

1. Docker official build best practices.
2. Docker multi-stage build documentation.
3. Docker BuildKit secrets documentation.
4. Go release notes and Go runtime documentation, especially container-aware `GOMAXPROCS` behavior in Go 1.25+.
5. Project-specific security, base-image, SBOM, and registry policies.

## 2. Non-negotiable LLM rules

The agent MUST NOT generate or modify a Dockerfile unless it can answer these questions in the change summary:

- What artifact is copied into the runtime image?
- Which user does the container run as?
- What files are intentionally present in the final image?
- How are build secrets prevented from leaking into image layers?
- Which port, health endpoint, and shutdown behavior does the app expose?
- Is the binary static or dynamically linked?
- Which OS packages are needed at runtime and why?
- How is the image scanned, tagged, and released?

If any answer is unknown, the agent MUST choose the safest default and mark the assumption explicitly.

## 3. Required Dockerfile shape for Go services

A production Go Dockerfile MUST use a multi-stage build unless there is a documented exception.

Required stages:

1. `base` or `deps` stage for module download/cache.
2. `build` stage for compile/test-relevant build inputs.
3. `runtime` stage containing only runtime artifacts.

Preferred shape:

```Dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.26 AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags='-s -w' \
      -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /
COPY --from=build /out/app /app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app"]
```

This example is not universal. The agent MUST adjust base image, CGO, certificates, timezone data, UID/GID, and runtime filesystem based on actual project requirements.

## 4. Base image rules

### 4.1 Builder image

The builder image MUST be explicit and pinned at least by Go minor version.

Allowed:

```Dockerfile
FROM golang:1.26 AS build
```

Preferred for regulated or reproducible pipelines:

```Dockerfile
FROM golang:1.26.4-bookworm AS build
```

For strict supply-chain control, digest pinning SHOULD be used in CI/release images:

```Dockerfile
FROM golang:1.26.4-bookworm@sha256:<digest> AS build
```

The agent MUST NOT use `latest`.

### 4.2 Runtime image

The runtime image MUST be minimal and justified.

Common choices:

| Runtime image      | Use when                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `scratch`          | fully static binary, no shell, no CA/timezone requirement unless copied explicitly          |
| distroless static  | static Go service needing CA certs/nonroot baseline                                         |
| distroless base    | dynamic linking or basic runtime files needed                                               |
| Alpine             | only when musl compatibility is acceptable and shell/package tools are intentionally needed |
| Debian/Ubuntu slim | when glibc or runtime OS packages are required                                              |

The agent MUST NOT choose Alpine only because it is small. Musl/glibc behavior, CGO, DNS resolution, and native dependencies must be considered.

## 5. `.dockerignore` is mandatory

Every Go Docker build context MUST include `.dockerignore`.

Minimum baseline:

```gitignore
.git
.github
.gitlab
.idea
.vscode
.DS_Store
*.log
coverage.out
bin/
dist/
build/
tmp/
.env
.env.*
*.pem
*.key
*.crt
node_modules/
vendor/ # only ignore if project does not intentionally vendor
```

Rules:

- The agent MUST NOT send secrets, local caches, test reports, or editor metadata into the build context.
- If `vendor/` is used intentionally, it MUST NOT be ignored.
- `.dockerignore` changes MUST be reviewed with Dockerfile changes.

## 6. Build cache and dependency rules

The agent MUST separate dependency download from source copy:

```Dockerfile
COPY go.mod go.sum ./
RUN go mod download
COPY . .
```

For BuildKit builds, cache mounts SHOULD be used:

```Dockerfile
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build ./...
```

Forbidden:

```Dockerfile
COPY . .
RUN go mod download
```

unless the project has a documented reason, because it invalidates module cache on every source change.

## 7. Build secrets

Build secrets MUST NOT be passed through `ARG`, `ENV`, committed config files, or shell echo.

Forbidden:

```Dockerfile
ARG GITHUB_TOKEN
RUN git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
```

Required pattern for private dependencies:

```Dockerfile
RUN --mount=type=secret,id=git_token \
    GIT_TOKEN="$(cat /run/secrets/git_token)" && \
    git config --global url."https://${GIT_TOKEN}@github.com/".insteadOf "https://github.com/" && \
    go mod download && \
    git config --global --unset-all url."https://${GIT_TOKEN}@github.com/".insteadOf
```

Better: use SSH mount or private module proxy according to project policy.

Rules:

- Secrets MUST be mounted only for the command that needs them.
- Secrets MUST NOT be copied to files in layers.
- Build logs MUST NOT print secrets.
- `go env -w GOPRIVATE=...` inside image layer MUST be avoided unless the value is non-sensitive and intentional.

## 8. Go build flags

Production builds SHOULD use:

```sh
CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/app ./cmd/app
```

Use `-ldflags` only for clear reasons:

```sh
-ldflags "-s -w -X 'main.version=${VERSION}' -X 'main.commit=${COMMIT}' -X 'main.buildTime=${BUILD_TIME}'"
```

Rules:

- `-s -w` MAY be used for smaller binaries, but debug symbol strategy MUST be known.
- Build metadata MUST NOT include secrets or local filesystem paths.
- `-trimpath` SHOULD be used for release artifacts.
- `CGO_ENABLED=0` is preferred for simple service binaries, but MUST NOT be forced if dependencies require CGO.
- If CGO is enabled, runtime image MUST contain required shared libraries.

## 9. Static vs dynamic linking

The agent MUST explicitly decide:

- static binary: simpler runtime image, easier distroless/scratch, fewer runtime dependencies;
- dynamic binary: required for CGO/native libraries, must include shared libs and compatible libc.

Validation command in builder stage or CI:

```sh
file /out/app
ldd /out/app || true
```

If `ldd` shows dynamic dependencies, the runtime image MUST include them.

## 10. Runtime user and filesystem

Containers MUST NOT run as root unless there is a documented exception.

Required:

```Dockerfile
USER 65532:65532
```

or an approved named non-root user.

Runtime filesystem rules:

- App MUST write only to explicitly declared writable paths such as `/tmp`, `/var/run/app`, or mounted volumes.
- App MUST NOT require writing to `/`, `/app`, or source directories.
- Container should be compatible with read-only root filesystem when deployed to Kubernetes.
- Directories required for writable data MUST be created with correct ownership in the image or mounted at runtime.

Example:

```Dockerfile
RUN mkdir -p /var/run/app && chown 65532:65532 /var/run/app
USER 65532:65532
```

## 11. CA certificates, timezone, and locale

The agent MUST verify whether the app needs:

- CA certificates for outbound HTTPS/TLS;
- timezone database for named time zones;
- system user/group files;
- locale files;
- DNS resolver behavior compatible with runtime image.

For `scratch`, required files must be copied explicitly when needed:

```Dockerfile
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=build /etc/passwd /etc/passwd
```

The agent MUST NOT assume `scratch` contains certificates or timezone data.

## 12. Entrypoint and process behavior

Use exec-form entrypoint:

```Dockerfile
ENTRYPOINT ["/app"]
```

Forbidden:

```Dockerfile
ENTRYPOINT /app
CMD /app
```

unless a shell wrapper is required and signal forwarding is implemented correctly.

Rules:

- The Go process MUST run as PID 1 safely.
- The app MUST handle `SIGTERM` and `SIGINT`.
- Graceful shutdown timeout MUST be less than the orchestration termination grace period.
- Startup must fail fast on invalid config.

## 13. Health and runtime endpoints

Dockerfile `HEALTHCHECK` is optional in Kubernetes-heavy environments because Kubernetes probes usually own health policy.

If Docker healthcheck is used:

- it MUST not require shell if runtime image has no shell;
- it MUST not create load or depend on external dependencies unless intentionally checking readiness;
- it MUST have bounded timeout.

For Go HTTP services, expose separate semantics:

- `/livez`: process alive; avoid dependency checks.
- `/readyz`: ready to serve; may include critical local readiness and dependency readiness where appropriate.
- `/startupz` or startup probe endpoint for long initialization.

## 14. Ports

`EXPOSE` SHOULD document intended port, but it is not security control.

Rules:

- Do not expose admin/debug ports in production image unless protected and documented.
- `pprof`, Prometheus, health, and app traffic ports must be explicitly documented.
- Do not bind to `localhost` inside container if Kubernetes Service must reach it; bind to `0.0.0.0` or configurable address.

## 15. Environment variables and config

Docker image MUST contain no environment-specific secrets.

Allowed:

```Dockerfile
ENV APP_ENV=production
```

only if safe and truly default.

Forbidden:

```Dockerfile
ENV DB_PASSWORD=...
ENV AWS_SECRET_ACCESS_KEY=...
```

Rules:

- Secrets must come from runtime secret manager, Kubernetes Secret, mounted files, or cloud identity.
- Config schema must be validated at startup.
- Required env vars must be documented in README or deployment manifest.

## 16. Image tags and labels

Release images MUST have immutable tags and SHOULD have OCI labels.

Example:

```Dockerfile
LABEL org.opencontainers.image.source="https://example.com/repo" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION"
```

Rules:

- `latest` MUST NOT be used for deployment manifests.
- Tags MUST include version or commit digest.
- Image digest SHOULD be used for production deployment when supported.

## 17. Supply-chain and vulnerability gate

Before merge/release, the pipeline SHOULD run:

```sh
go test ./...
govulncheck ./...
docker buildx build ...
# image scanner: trivy/grype/vendor scanner
# SBOM: syft/docker buildx sbom/vendor tool
```

Rules:

- Critical/high vulnerabilities must follow project exception policy.
- Base image updates must be part of regular maintenance.
- Dependencies copied from builder into runtime must be intentional and visible.
- SBOM/checksum/signature policy should be applied to release images.

## 18. Container resource awareness for Go

For Go 1.25+, the runtime is container-aware for `GOMAXPROCS` when CPU limits are set.

Rules:

- Do not blindly set `GOMAXPROCS` in Dockerfile.
- If project sets `GOMAXPROCS`, it MUST explain why overriding runtime default is necessary.
- Load tests MUST be run with realistic CPU/memory limits.
- Memory limit must account for Go heap, stacks, mmap/native memory, file buffers, TLS buffers, and observability overhead.
- For latency-sensitive Go services, CPU throttling impact must be considered.

Forbidden default:

```Dockerfile
ENV GOMAXPROCS=1
```

unless this is intentional and measured.

## 19. Logging and stdout/stderr

Containerized Go applications MUST write structured logs to stdout/stderr.

Rules:

- Do not write application logs only to local files.
- Do not depend on logrotate inside the container.
- Do not include secrets or raw tokens in logs.
- Log startup config only as redacted effective config.
- Panic output must not leak secrets.

## 20. Debug and admin tooling

Production runtime images SHOULD NOT include:

- shell;
- package manager;
- curl/wget;
- compiler;
- git;
- cloud CLI;
- test fixtures;
- source code;
- credentials.

Debug images MAY exist separately and MUST be tagged separately.

## 21. Go CLI/job image rules

For Go CLIs and Kubernetes Jobs:

- Exit code must represent success/failure accurately.
- SIGTERM must stop work safely if job can be interrupted.
- Partial output must be recoverable or written atomically.
- Retry behavior must be idempotent.
- Timeouts must be configurable.
- Job image must not assume interactive TTY.

## 22. Docker Compose rules for local development

Compose files for local dev MUST NOT become production authority.

Rules:

- Compose may mount source code for local dev only.
- Compose secrets/env files must not be committed with real values.
- Local ports must not imply production exposure.
- Local dependency images must be version-pinned enough for reproducibility.

## 23. Forbidden anti-patterns

The agent MUST NOT introduce:

```Dockerfile
FROM golang:latest
COPY . .
RUN go build -o app
CMD ./app
```

```Dockerfile
FROM ubuntu
RUN apt-get update && apt-get install -y golang git curl
COPY . .
RUN go build
CMD ["./app"]
```

```Dockerfile
ARG PASSWORD
ENV PASSWORD=$PASSWORD
```

```Dockerfile
USER root
```

without documented exception.

Other forbidden patterns:

- installing build tools in runtime stage;
- using `latest` for base images;
- no `.dockerignore`;
- copying entire repo into runtime image;
- assuming root filesystem is writable;
- shell-form entrypoint for Go services;
- no graceful shutdown handling;
- using Dockerfile env vars for secrets;
- relying on Kubernetes to fix broken container behavior.

## 24. Required review checklist

A Go Docker change is mergeable only if:

- [ ] Dockerfile uses multi-stage build or exception is documented.
- [ ] Runtime image contains only required runtime artifacts.
- [ ] `.dockerignore` excludes secrets, VCS, build output, and local files.
- [ ] Build secrets use BuildKit secret/SSH mounts or approved private module mechanism.
- [ ] Image does not run as root.
- [ ] Entrypoint uses exec form.
- [ ] App handles SIGTERM/SIGINT.
- [ ] Runtime image includes CA/timezone/native libs only if required.
- [ ] No secret is present in Dockerfile, image layer, label, env, or build log.
- [ ] Go binary linking mode is known.
- [ ] Image tag/version/revision strategy is documented.
- [ ] Vulnerability scan and `govulncheck` are part of release gate.
- [ ] Resource behavior is tested under realistic CPU/memory limits.
- [ ] Logs go to stdout/stderr and are structured/redacted.
- [ ] Debug tooling is not present in production image.

## 25. LLM final response requirement

When the agent creates or modifies Docker support for a Go project, it MUST summarize:

- final image base and why;
- builder image and Go version;
- whether CGO is enabled;
- runtime user;
- exposed ports;
- config/secrets source;
- shutdown behavior;
- scan/build commands that should be run.
