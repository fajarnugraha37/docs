# Strict General Standards: Docker

> Mandatory conventions for LLMs, code agents, and engineers when creating or modifying Dockerfiles, container images, Docker Compose files, and container runtime instructions.

---

## 1. Purpose

This standard defines how container images must be designed, built, secured, and operated.

Docker usage is acceptable only when it produces a **small, reproducible, secure, observable, and environment-agnostic runtime artifact**. A Dockerfile is not just a packaging script. It is part of the production supply chain.

An LLM/code agent must treat every Dockerfile as infrastructure code with security, operational, and reproducibility consequences.

---

## 2. Scope

This standard applies to:

- `Dockerfile`
- `.dockerignore`
- Docker build commands
- Docker Compose files used for local/dev/test environments
- CI/CD image build pipelines
- Runtime container options
- Container image metadata, tags, labels, SBOM, and vulnerability scanning

This standard does not replace Kubernetes standards. Docker defines the image and local container behavior; Kubernetes defines orchestration behavior.

---

## 3. Core Principles

### 3.1 Container image is an immutable runtime artifact

A container image must contain exactly what is required to run the application. It must not depend on manual shell steps after startup.

**MUST:**

- Build the image fully during CI/CD.
- Treat the image as immutable once published.
- Use the same image artifact across environments.
- Inject environment-specific configuration at runtime.

**MUST NOT:**

- Build different images for dev, UAT, staging, and production when only configuration changes.
- Run `apt install`, `npm install`, `mvn package`, `pip install`, or migration generation at container startup.
- SSH into containers as part of normal operations.

---

### 3.2 Small image is a security and operations requirement

Smaller images reduce attack surface, pull time, storage, scan noise, and cold-start latency.

**MUST:**

- Use multi-stage builds for compiled languages and frontend builds.
- Copy only final artifacts into runtime images.
- Remove package manager caches in the same layer where packages are installed.
- Exclude unnecessary files using `.dockerignore`.

**SHOULD:**

- Prefer slim, minimal, distroless, or runtime-only base images when compatible.
- Avoid shell, package manager, compiler, VCS tools, and test tools in runtime images.

**MUST NOT:**

- Copy the whole repository into the final runtime stage unless the application genuinely needs it.
- Ship test data, `.git`, source maps with secrets, local config, private keys, `.env`, or build caches.

---

### 3.3 Reproducibility is mandatory

The same source revision and dependency lockfiles should produce functionally equivalent images.

**MUST:**

- Commit dependency lockfiles where the ecosystem supports them.
- Use deterministic package install commands such as `npm ci`, `pnpm install --frozen-lockfile`, `yarn --immutable`, `pip install -r requirements.txt` with pinned versions, `poetry install --sync`, `go mod download`, `mvn -B`, or equivalent.
- Pin base images by meaningful version tag at minimum.
- Pin by digest for production-critical images when the registry and pipeline support it.
- Record image provenance in labels.

**MUST NOT:**

- Use floating `latest` tags for production images.
- Use unpinned OS package installs in production-critical builds without a patching policy.
- Fetch executable scripts from the internet and pipe them directly to shell.

---

### 3.4 Secrets must never enter image layers

Secrets in Docker layers remain recoverable through image history, cache, registry, or SBOM metadata.

**MUST:**

- Use BuildKit secret mounts for build-time secrets.
- Use runtime secret injection through orchestrator secrets, mounted files, or secure environment injection.
- Keep `.env`, keys, certificates, tokens, and credentials out of build context.
- Validate `.dockerignore` includes secret-bearing files.

**MUST NOT:**

- Put secrets in `ARG`, `ENV`, `RUN echo`, `COPY`, or committed config files.
- Use private package registry credentials directly in Dockerfile instructions.
- Bake production credentials into images.

**Allowed BuildKit pattern:**

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

---

### 3.5 Runtime must use least privilege

Containers are not a security boundary by themselves. Runtime privileges must be minimized.

**MUST:**

- Run as a non-root user unless a documented exception exists.
- Avoid privileged containers.
- Avoid host PID, host IPC, host network, and host filesystem mounts unless explicitly justified.
- Use least-capability runtime configuration.
- Ensure application directories are owned by the runtime user.

**MUST NOT:**

- Use `USER root` in final runtime stage without justification.
- Write application data into image-owned directories that require root permissions.
- Depend on writable root filesystem unless required.

---

## 4. Dockerfile Decision Gate

Before generating or modifying a Dockerfile, the LLM/code agent must identify:

1. Application language/runtime.
2. Build system and dependency manager.
3. Required runtime artifact.
4. Required ports.
5. Required environment variables.
6. Required filesystem write paths.
7. Required OS/native packages.
8. Required startup command.
9. Signal handling and graceful shutdown behavior.
10. Health/readiness endpoint, if any.
11. Target CPU architecture.
12. Whether image is for local-only, CI test, or production.
13. Whether secrets are needed during build.
14. Whether the final image requires shell/debug tooling.
15. Whether Kubernetes will supply probes and security context.

If these are unknown, the generated Dockerfile must use safe defaults and mark assumptions explicitly in comments or accompanying notes.

---

## 5. Mandatory Dockerfile Structure

### 5.1 Use explicit syntax directive when using BuildKit features

**MUST:**

```dockerfile
# syntax=docker/dockerfile:1
```

Use this when relying on cache mounts, secret mounts, heredocs, or modern Dockerfile checks.

---

### 5.2 Use multi-stage build by default

**MUST for compiled/build-step applications:**

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
RUN ./gradlew --no-daemon dependencies
COPY src ./src
RUN ./gradlew --no-daemon clean bootJar

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN useradd --system --uid 10001 appuser
COPY --from=build /src/build/libs/*.jar /app/app.jar
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

**MUST NOT:**

```dockerfile
FROM eclipse-temurin:21-jdk
COPY . .
RUN ./gradlew bootJar
CMD java -jar build/libs/app.jar
```

The second example ships build tools, source, caches, and unnecessary attack surface.

---

### 5.3 Optimize layer ordering

**MUST:**

- Copy dependency definition files before application source.
- Install dependencies before copying frequently changing source files.
- Keep stable expensive layers early.
- Keep volatile application code later.

**Node example:**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM nginx:stable-alpine AS runtime
COPY --from=build /src/dist /usr/share/nginx/html
```

**MUST NOT:**

```dockerfile
COPY . .
RUN npm install
```

This invalidates dependency cache whenever source changes and may install non-lockfile dependency versions.

---

### 5.4 Use `.dockerignore`

Every Docker build context must have an explicit `.dockerignore`.

**Minimum baseline:**

```gitignore
.git
.gitignore
.env
.env.*
*.pem
*.key
*.crt
*.p12
*.jks
node_modules
target
build
dist
coverage
.cache
.tmp
tmp
logs
*.log
.DS_Store
.idea
.vscode
```

**MUST:**

- Exclude VCS metadata.
- Exclude local dependencies.
- Exclude build artifacts not required by the Dockerfile.
- Exclude secrets and environment files.
- Use Dockerfile-specific ignore files when multiple Dockerfiles need different contexts.

---

### 5.5 Prefer `COPY` over `ADD`

**MUST:**

- Use `COPY` for local files.
- Use `ADD` only when its special behavior is explicitly required and documented.

**MUST NOT:**

- Use `ADD` to download remote URLs.

---

### 5.6 Use exec-form entrypoint and command

**MUST:**

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

**MUST NOT:**

```dockerfile
CMD java -jar /app/app.jar
```

Shell-form commands can interfere with signal forwarding and graceful shutdown.

**SHOULD:**

- Use an init process only when the application needs child process reaping.
- Ensure the main process handles `SIGTERM` gracefully.

---

### 5.7 Avoid mutable startup scripts unless necessary

Startup scripts are allowed only when they do deterministic runtime composition.

**Allowed:**

- Render config from environment variables.
- Wait for required local files.
- Start exactly one application process.
- Validate required runtime configuration.

**Forbidden:**

- Install packages.
- Download dependencies.
- Generate application code.
- Perform schema migrations without explicit deployment coordination.
- Run multiple unrelated daemons.

---

## 6. Base Image Standards

### 6.1 Base image selection

**MUST prefer:**

1. Official image from trusted publisher.
2. Runtime-only image.
3. Minimal image compatible with the application.
4. Image with active maintenance and security update policy.
5. Image compatible with scanning and SBOM generation.

**MUST evaluate:**

- glibc vs musl compatibility.
- timezone/locale needs.
- CA certificate needs.
- native library requirements.
- debug access requirements.
- JVM/container support or runtime-specific container awareness.

**MUST NOT:**

- Use random community images for production without ownership and update policy.
- Use EOL operating system or runtime images.
- Use heavyweight OS images when a runtime image is sufficient.

---

### 6.2 Tag and digest policy

**MUST:**

- Use explicit major/minor tags for base images.
- Use digest pinning for regulated, production-critical, or high-security workloads.
- Keep an automated dependency update workflow for pinned images.

**Example:**

```dockerfile
FROM eclipse-temurin:21.0.7_6-jre-jammy@sha256:<digest>
```

**MUST NOT:**

```dockerfile
FROM ubuntu:latest
```

---

## 7. Dependency Installation Standards

### 7.1 OS packages

**MUST:**

- Install only required packages.
- Use `--no-install-recommends` for Debian/Ubuntu where appropriate.
- Clean package indexes in the same `RUN` instruction.
- Combine update/install/cleanup into one layer.

**Example:**

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*
```

**MUST NOT:**

```dockerfile
RUN apt-get update
RUN apt-get install -y curl vim git build-essential
```

---

### 7.2 Application dependencies

**MUST:**

- Use lockfile-based installs.
- Fail when lockfiles are out of sync.
- Keep dev/test dependencies out of runtime images unless needed.

**Examples:**

```dockerfile
RUN npm ci --omit=dev
RUN pnpm install --frozen-lockfile --prod
RUN pip install --no-cache-dir -r requirements.txt
RUN go mod download
RUN mvn -B -DskipTests package
```

---

### 7.3 Build cache

**SHOULD:**

- Use BuildKit cache mounts for package managers.
- Avoid persisting dependency caches in final runtime layers.

**Examples:**

```dockerfile
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests package
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon build
RUN --mount=type=cache,target=/root/.npm npm ci
```

---

## 8. Runtime Configuration Standards

### 8.1 Environment variables

**MUST:**

- Use environment variables only for non-secret runtime configuration or secret references.
- Document required environment variables.
- Validate required variables at startup.
- Keep defaults safe.

**MUST NOT:**

- Put secrets in Dockerfile `ENV`.
- Put environment-specific URLs, credentials, or tenant IDs into image layers.

---

### 8.2 Filesystem

**MUST:**

- Define expected writable directories.
- Ensure writable directories are owned by the non-root runtime user.
- Avoid writing to the application directory unless required.
- Prefer `/tmp`, `/var/tmp`, or explicit mounted volumes for temporary data.

**SHOULD:**

- Design the application to work with a read-only root filesystem.

---

### 8.3 Ports

`EXPOSE` is documentation, not an access control rule.

**MUST:**

- Expose only application ports that are intended to receive traffic.
- Avoid exposing debug, admin, JMX, actuator, profiler, or database ports from production images.

---

### 8.4 Healthcheck

**MUST:**

- Provide a healthcheck for standalone Docker/Compose services where the runtime platform uses it.
- Avoid duplicate or conflicting healthchecks when Kubernetes probes are the source of truth.

**SHOULD:**

- Make healthchecks cheap, deterministic, and non-mutating.
- Use application-level health endpoints for readiness-like checks.

**MUST NOT:**

- Use healthchecks that require external dependencies unless the semantics explicitly require dependency readiness.
- Use healthchecks that mutate state.

---

## 9. Security Standards

### 9.1 User and permissions

**MUST:**

- Create or use a non-root user in the final image.
- Use numeric UID/GID where Kubernetes/OpenShift compatibility matters.
- Own only the directories that must be writable.

**Example:**

```dockerfile
RUN addgroup --system --gid 10001 app \
    && adduser --system --uid 10001 --ingroup app app
USER 10001:10001
```

---

### 9.2 Capabilities and privileged mode

Dockerfile cannot fully define runtime capabilities, but generated run/Compose/Kubernetes examples must follow least privilege.

**MUST NOT generate runtime examples with:**

- `--privileged`
- `--network host`
- `--pid host`
- broad hostPath mounts
- Docker socket mounts
- `SYS_ADMIN` capability

unless the use case explicitly requires it and documents the risk.

---

### 9.3 Image scanning and SBOM

**MUST:**

- Scan images in CI/CD before deployment.
- Fail builds on critical/high vulnerabilities according to the project policy.
- Generate SBOM for production images where the toolchain supports it.
- Store image digest and scan result as deployment evidence.

**SHOULD:**

- Sign images using the organization-approved signing mechanism.
- Verify signatures before deployment.

---

### 9.4 Supply chain metadata

**SHOULD add OCI labels:**

```dockerfile
LABEL org.opencontainers.image.title="example-service" \
      org.opencontainers.image.description="Example service runtime image" \
      org.opencontainers.image.source="https://example.com/repo" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.created="$BUILD_DATE"
```

**MUST NOT:**

- Put secrets, internal credentials, or sensitive infrastructure names in labels.

---

## 10. Docker Compose Standards

Docker Compose is acceptable for local development, integration testing, and sandbox environments. It must not become an undocumented production orchestrator.

**MUST:**

- Keep Compose files deterministic.
- Use named networks and volumes.
- Use healthchecks for dependency ordering where useful.
- Avoid binding services to `0.0.0.0` unless external host access is required.
- Separate dev-only overrides into `compose.override.yml` or profile-based config.

**MUST NOT:**

- Put production secrets in Compose files.
- Depend on `depends_on` alone as an application readiness guarantee.
- Use Compose to hide missing application-level retry/backoff logic.

**Recommended local pattern:**

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      APP_ENV: local
    ports:
      - "8080:8080"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app-local-only
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 20
```

---

## 11. Language-Specific Rules

### 11.1 Java / Spring Boot

**MUST:**

- Use JRE/runtime image for final stage unless JDK is required.
- Configure memory based on container limits.
- Use exec-form `ENTRYPOINT`.
- Avoid writing logs to files inside the container; write to stdout/stderr.

**SHOULD:**

- Use layered jars or buildpacks if standardized by the project.
- Enable graceful shutdown in the application.

**Example:**

```dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY . .
RUN ./gradlew --no-daemon clean bootJar

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 appuser
COPY --from=build /src/build/libs/*.jar /app/app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

---

### 11.2 Node.js

**MUST:**

- Use `npm ci`, `pnpm --frozen-lockfile`, or equivalent.
- Build TypeScript/frontend assets in build stage.
- Avoid shipping dev dependencies in runtime.
- Run as non-root.

**MUST NOT:**

- Run `npm install` without lockfile in production builds.
- Run frontend dev server in production image.

---

### 11.3 Go

**MUST:**

- Build static or minimal runtime binary where feasible.
- Copy only the binary and required CA certificates/timezone data.
- Use non-root runtime user.

**Example:**

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/app /app
USER 10001:10001
ENTRYPOINT ["/app"]
```

---

### 11.4 Python

**MUST:**

- Pin dependencies.
- Avoid installing compilers in final runtime image.
- Use virtual environment or wheelhouse pattern when needed.
- Avoid running as root.

**SHOULD:**

- Use `PYTHONDONTWRITEBYTECODE=1` when bytecode cache is not needed.
- Use `PYTHONUNBUFFERED=1` for log visibility.

---

## 12. Anti-Patterns

The LLM/code agent must reject or flag these patterns:

1. `FROM latest` for production.
2. Single-stage build containing compiler and runtime.
3. `COPY . .` before dependency installation.
4. No `.dockerignore`.
5. Secrets in `ARG`, `ENV`, or copied files.
6. Root runtime user.
7. Shell-form `CMD` for long-running service.
8. `apt-get update` and `apt-get install` in separate layers.
9. Installing debug tools in runtime image by default.
10. Running database migrations blindly at container startup.
11. Multiple unrelated processes in one container.
12. Writing logs only to files inside the container.
13. Depending on mutable tags without update policy.
14. Docker socket mounted into application container.
15. Production Compose with secrets in plain YAML.
16. Image build depending on undeclared local machine state.
17. Image build downloading arbitrary scripts and executing them.
18. Shipping `.git`, `node_modules`, build caches, or test reports.
19. Using `EXPOSE` as if it were security control.
20. Ignoring target platform/architecture.

---

## 13. Review Checklist

A Docker change is acceptable only if all relevant items are true:

- [ ] Dockerfile has clear build and runtime stages when applicable.
- [ ] Final image contains only runtime artifacts and required runtime dependencies.
- [ ] Base image is explicit, maintained, and not `latest`.
- [ ] Production-critical base images are digest-pinned or covered by automated update policy.
- [ ] `.dockerignore` exists and excludes secrets, VCS, local dependencies, and build artifacts.
- [ ] Dependency installation uses lockfile/frozen mode.
- [ ] Build does not leak secrets into layers.
- [ ] Runtime user is non-root or exception is documented.
- [ ] Entrypoint/CMD uses exec form.
- [ ] Signal handling and graceful shutdown are considered.
- [ ] Writable directories are explicit and permissioned.
- [ ] Runtime config is injected at runtime, not baked into image.
- [ ] Healthcheck/probe strategy is defined for the runtime environment.
- [ ] Image scan/SBOM/signing policy is addressed.
- [ ] Logs go to stdout/stderr.
- [ ] No unnecessary debug tools are shipped.
- [ ] Compose files are local/dev/test safe and do not contain production secrets.

---

## 14. Acceptance Criteria for LLM Output

When an LLM generates Docker-related code, it must include:

1. A Dockerfile that follows least-privilege and reproducible build rules.
2. A `.dockerignore` recommendation when missing.
3. A statement of assumed runtime, port, env vars, and health endpoint.
4. No embedded secrets.
5. No use of `latest` for production examples.
6. No root final runtime user unless justified.
7. Build command example using BuildKit when cache/secrets are used.
8. Notes for Kubernetes integration when relevant.

---

## 15. Enforcement Snippet for LLM/Code Agent

Use this before producing Docker code:

```text
Before generating Docker artifacts, identify runtime, build system, lockfile, artifact path, runtime user, ports, env vars, writable paths, secrets, health endpoint, and target platform.
Generate a minimal multi-stage Dockerfile when applicable.
Never use latest, never bake secrets, never run final image as root unless justified, and always recommend .dockerignore.
Prefer reproducibility, small runtime image, explicit entrypoint, stdout logs, and least privilege.
```

---

## 16. References

- Docker Docs — Building best practices: https://docs.docker.com/build/building/best-practices/
- Docker Docs — Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Docker Docs — Multi-stage builds: https://docs.docker.com/build/building/multi-stage/
- Docker Docs — Build secrets: https://docs.docker.com/build/building/secrets/
- Docker Docs — Build context and `.dockerignore`: https://docs.docker.com/build/concepts/context/
- Docker Docs — Optimize cache usage in builds: https://docs.docker.com/build/cache/optimize/
- Docker Docs — Build checks: https://docs.docker.com/build/checks/
- Open Containers Initiative image spec: https://github.com/opencontainers/image-spec
