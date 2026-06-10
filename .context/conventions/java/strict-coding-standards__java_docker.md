# Strict Coding Standards — Java Docker

> **Purpose**: This document defines strict, enforceable standards for LLM-assisted implementation of Docker images for Java applications.
>
> It is not a Docker tutorial. It is a production guardrail for code agents, reviewers, CI systems, and platform teams.

---

## 1. Scope

This standard applies to all Java applications packaged as container images, including:

- Spring Boot, Quarkus, Micronaut, Jakarta EE, JAX-RS, gRPC, batch workers, CLI jobs, schedulers.
- Java 11, 17, 21, and 25 runtimes.
- Maven and Gradle builds.
- JVM-based services deployed to Docker, Kubernetes, ECS, OpenShift, Nomad, or similar platforms.

This standard covers:

- Dockerfile structure.
- Runtime image selection.
- JVM flags in containers.
- Security posture.
- Reproducibility.
- Build caching.
- Secrets handling.
- Image metadata.
- Health checks.
- Observability.
- CI/CD expectations.

This standard does **not** replace:

- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_network.md`
- `strict-coding-standards__gradle.md`
- `strict-coding-standards__maven.md`
- `strict-coding-standards__java_kubernetes.md`

---

## 2. Core Principle

A Java Docker image must be:

1. **Minimal** — contains only what is required at runtime.
2. **Reproducible** — the same source and dependency lock should produce the same behavior.
3. **Non-root** — the application process must not run as root.
4. **Observable** — logs, metrics, health, and diagnostics must work without shell access.
5. **Configurable** — runtime behavior must be driven by environment/config, not rebuilt images.
6. **Fail-fast** — invalid config must fail container startup clearly.
7. **Safe by default** — no secrets, credentials, debug ports, or admin tools embedded by default.

---

## 3. LLM Agent Contract

When an LLM creates or modifies Docker support for a Java application, it MUST:

1. Identify the Java baseline: 11, 17, 21, or 25.
2. Identify the build tool: Maven, Gradle, or other.
3. Identify the packaging type: fat JAR, thin JAR, layered JAR, native image, WAR, or exploded app.
4. Explain the runtime base image choice.
5. Use multi-stage build unless explicitly unnecessary.
6. Use a non-root runtime user.
7. Avoid embedding secrets.
8. Pin or justify base image tags.
9. Include a `.dockerignore` recommendation.
10. Include JVM container memory policy.
11. Avoid interactive shells as a runtime dependency.
12. Avoid debug ports by default.
13. Ensure PID 1 signal handling works.
14. Add CI build/test commands if requested.
15. Document assumptions.

The agent MUST NOT silently generate a Dockerfile that works only on the author's machine.

---

## 4. Required Files

A Java service that supports Docker SHOULD have:

```text
repo-root/
  Dockerfile
  .dockerignore
  docker/
    README.md                    # optional, if runtime details are complex
  build.gradle(.kts) or pom.xml
```

For Kubernetes-based services, do not overload `Dockerfile` with deployment concerns. Keep cluster configuration in manifests, Helm, Kustomize, or platform templates.

---

## 5. Dockerfile Baseline Rules

### 5.1 Must Use Multi-Stage Build

Allowed:

```Dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY . .
RUN ./gradlew clean test bootJar --no-daemon

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/build/libs/app.jar /app/app.jar
USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Forbidden by default:

```Dockerfile
FROM eclipse-temurin:21-jdk
COPY . .
RUN ./gradlew build
CMD java -jar build/libs/app.jar
```

Reason: build tools, source code, dependency caches, and compilers must not be present in the runtime image unless explicitly justified.

### 5.2 Build Stage and Runtime Stage Must Be Separate

Build stage MAY contain:

- JDK.
- Maven/Gradle wrapper.
- Build cache mounts.
- Test dependencies.
- Compilation tools.

Runtime stage SHOULD contain only:

- JRE or minimal Java runtime.
- Application artifact.
- Required runtime config defaults.
- Required CA certificates/timezone data if applicable.
- Non-root user/group.

Runtime stage MUST NOT contain:

- Source code.
- `.git` directory.
- Maven local repository.
- Gradle caches.
- Build scripts unless required at runtime.
- SSH keys.
- Cloud credentials.
- Test reports.
- Debug-only tools.

---

## 6. Base Image Policy

### 6.1 Approved Base Image Categories

Preferred categories:

1. Organization-approved base image.
2. Eclipse Temurin official image.
3. Vendor-supported JDK/JRE image approved by platform/security.
4. Distroless Java image if operational constraints are understood.
5. Minimal OS image with custom JRE produced by `jlink`, if maintained.

Allowed examples:

```Dockerfile
FROM eclipse-temurin:21-jre
FROM eclipse-temurin:17-jre
FROM gcr.io/distroless/java21-debian12
```

### 6.2 Avoid `latest`

Forbidden:

```Dockerfile
FROM eclipse-temurin:latest
FROM openjdk:latest
```

Required:

```Dockerfile
FROM eclipse-temurin:21.0.5_11-jre
# or organization-approved moving tag with image scanning and patch policy
FROM eclipse-temurin:21-jre
```

Rules:

- Use immutable digest pinning for high-compliance workloads.
- Use semver/minor tags only when CI rebuild + scan policy exists.
- Do not use `latest` in production Dockerfiles.
- Base image update process must be explicit.

### 6.3 Alpine Policy

`alpine` images are **restricted**, not default.

Allowed only when:

- musl/glibc behavior is tested.
- Native dependencies are compatible.
- DNS/TLS behavior is tested.
- Timezone/locale requirements are satisfied.
- Performance impact is measured.

Forbidden assumption:

> “Alpine is always better because it is smaller.”

Smaller image is not automatically safer or more stable.

---

## 7. Java Runtime Artifact Policy

### 7.1 Fat JAR

Allowed when:

- Simple deployment is preferred.
- Startup time and layer caching are acceptable.
- Artifact includes exactly the intended dependencies.

Example:

```Dockerfile
COPY --from=build /workspace/target/app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 7.2 Layered JAR

Preferred for large Spring Boot applications when layer cache matters.

Rules:

- Dependencies should be separated from application code if framework supports it.
- Do not manually explode JAR without understanding classpath order.
- Cache benefit must not compromise clarity.

### 7.3 Thin JAR

Restricted.

Allowed only when:

- Dependency resolution happens during build or image assembly.
- Runtime does not download arbitrary dependencies.
- Classpath is explicit and reproducible.

Forbidden:

- Runtime dependency download from Maven Central.
- Mutable `/app/lib` populated at startup.

### 7.4 WAR

Allowed only for servlet container deployment.

Rules:

- Container version must be pinned.
- Servlet/Jakarta namespace compatibility must be verified.
- Do not embed full app server unless required.

---

## 8. `.dockerignore` Required Standard

Every repository with Docker build support MUST have `.dockerignore`.

Baseline:

```dockerignore
.git
.gitignore
.idea
.vscode
*.iml
*.log
.DS_Store
node_modules
build
target
.gradle
.mvn/wrapper/maven-wrapper.jar.tmp
**/target
**/build
**/.gradle
.env
.env.*
*.pem
*.key
*.p12
*.jks
coverage
reports
tmp
```

Rules:

- Do not send secrets into Docker build context.
- Do not send local build output unless intentionally copied.
- Do not send entire monorepo if service context can be narrowed.
- Do not ignore wrapper scripts required for build.
- Do not ignore files needed for dependency version locks.

---

## 9. Docker Build Caching Rules

### 9.1 Copy Dependency Metadata Before Source

Preferred Gradle pattern:

```Dockerfile
COPY gradlew settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle ./gradle
RUN ./gradlew dependencies --no-daemon || true
COPY src ./src
RUN ./gradlew clean test bootJar --no-daemon
```

Preferred Maven pattern:

```Dockerfile
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -DskipTests dependency:go-offline
COPY src ./src
RUN ./mvnw -B clean verify package
```

Rules:

- Optimize cache without hiding build failure.
- Avoid fake dependency warmup if it makes CI misleading.
- Keep test execution in build stage unless CI already verifies it separately.

### 9.2 Use BuildKit Cache Mounts Carefully

Allowed:

```Dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/root/.gradle ./gradlew build --no-daemon
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B package
```

Rules:

- Cache mounts must not be required for correctness.
- Cache mounts must not contain secrets.
- CI must still work on cold cache.

---

## 10. Non-Root Runtime User

Runtime container MUST run as non-root.

Allowed:

```Dockerfile
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
USER 10001:10001
```

For images without shell/package manager, use existing non-root user if documented.

Forbidden:

```Dockerfile
USER root
```

unless explicitly required for a one-time build stage operation.

Rules:

- Runtime user must not require write access to application binaries.
- Writable directories must be explicit.
- Avoid world-writable directories.
- Prefer numeric UID/GID for Kubernetes compatibility.

---

## 11. Filesystem Layout

Preferred runtime layout:

```text
/app/
  app.jar
  config/                 # optional read-only defaults
/var/log/app/             # optional; prefer stdout instead
/tmp/                     # temporary files only
```

Rules:

- Application artifact should be read-only at runtime.
- Mutable state must not be written inside `/app`.
- Temporary files must use bounded size and cleanup strategy.
- Persistent data must use mounted volume or external storage.
- Logs must go to stdout/stderr by default.

---

## 12. JVM Container Memory Policy

### 12.1 Do Not Assume Host Memory

Java services in containers MUST define memory behavior.

Allowed options:

```Dockerfile
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:InitialRAMPercentage=25 -XX:+ExitOnOutOfMemoryError"
```

or platform-injected equivalent.

Rules:

- JVM heap must leave room for metaspace, threads, direct buffers, code cache, native memory, agent overhead, and OS margin.
- Do not set `-Xmx` blindly equal to container memory limit.
- Use `MaxRAMPercentage` when memory limits vary by environment.
- Use explicit `-Xmx` only when sizing is intentionally fixed.
- Add `-XX:+ExitOnOutOfMemoryError` for service workloads unless platform policy says otherwise.

### 12.2 Direct Memory

If application uses Netty, gRPC, NIO, compression, off-heap cache, or large buffers, direct memory must be considered.

Restricted:

```text
-XX:MaxDirectMemorySize=...
```

Allowed only with measured requirement.

### 12.3 Thread Stack

If high thread count exists, thread stack memory must be considered.

Rules:

- Do not tune `-Xss` without test evidence.
- Virtual threads do not eliminate all memory pressure.
- Native threads, connection pools, scheduler threads, and JVM internal threads still matter.

---

## 13. JVM CPU Policy

Rules:

- Do not assume `availableProcessors()` equals physical node CPU.
- Respect container CPU quota/cpuset behavior.
- Size worker pools based on container CPU and workload type.
- Do not set `ActiveProcessorCount` unless platform requires override.

Allowed when justified:

```text
-XX:ActiveProcessorCount=2
```

Forbidden by default:

- Hardcoding large thread pools in the image.
- Tuning GC threads without measurement.
- Assuming CPU throttling is application latency only.

---

## 14. Entrypoint and Signal Handling

### 14.1 Exec Form Required

Allowed:

```Dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Forbidden:

```Dockerfile
ENTRYPOINT java -jar /app/app.jar
CMD java -jar /app/app.jar
```

Reason: shell form can interfere with signal propagation.

### 14.2 Startup Scripts

Startup scripts are restricted.

Allowed only when:

- They are small.
- They use `exec` to replace shell with Java process.
- They fail fast on missing config.
- They do not fetch dependencies/secrets dynamically.

Required pattern:

```sh
#!/bin/sh
set -eu
exec java ${JAVA_OPTS:-} -jar /app/app.jar
```

Forbidden:

- Long bash orchestration scripts.
- Backgrounding Java process.
- `tail -f /dev/null` to keep container alive.
- Runtime `chmod`, `chown`, or package install.

---

## 15. Environment Variable Policy

Allowed:

```Dockerfile
ENV APP_HOME=/app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
```

Rules:

- Use environment variables for deployment-specific config.
- Do not bake environment-specific endpoints into image.
- Do not store secrets in Dockerfile `ENV`.
- Do not log all environment variables at startup.
- Validate required variables at startup.

Forbidden:

```Dockerfile
ENV DB_PASSWORD=secret
ENV AWS_SECRET_ACCESS_KEY=...
```

---

## 16. Secret Handling

Secrets MUST NOT be copied into image layers.

Forbidden:

```Dockerfile
COPY id_rsa /root/.ssh/id_rsa
COPY prod.env /app/.env
ARG DB_PASSWORD
ENV DB_PASSWORD=$DB_PASSWORD
```

Allowed for build-time private dependency access only with BuildKit secret mounts:

```Dockerfile
RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    ./mvnw -B package
```

Rules:

- Build secrets must not remain in final layers.
- Runtime secrets must be injected by orchestrator/secret manager.
- Do not echo secrets in build logs.
- Do not persist secret-derived config in generated files.

---

## 17. Network Port Policy

`EXPOSE` is documentation, not security.

Allowed:

```Dockerfile
EXPOSE 8080
```

Rules:

- Exposed port must match application config.
- Do not expose debug/admin ports by default.
- Management port must be explicitly separated if used.
- TLS termination location must be documented.

Forbidden by default:

```Dockerfile
EXPOSE 5005
```

unless debug image/profile only.

---

## 18. Health Check Policy

Docker `HEALTHCHECK` is optional when Kubernetes probes are used, but allowed for standalone Docker runtime.

Allowed:

```Dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
```

Rules:

- Health check must not require external dependencies for liveness.
- Readiness belongs to orchestrator more than image.
- Do not install curl/wget only for health check unless justified.
- Distroless images often should rely on platform probes.

Forbidden:

- Health check that mutates state.
- Health check that calls downstream payment/email/external systems.
- Health check with no timeout.

---

## 19. Logging Policy

Rules:

- Application logs MUST go to stdout/stderr by default.
- Do not write logs only to internal file path.
- Do not require shell access to retrieve logs.
- Do not log secrets, tokens, passwords, cookies, private keys, or full PII payloads.
- Log timestamps should be ISO-8601 or platform-standard.
- Prefer structured JSON logs where platform expects it.

Forbidden:

```Dockerfile
CMD java -jar app.jar > app.log
```

---

## 20. Debugging Policy

Debugging is forbidden in production images by default.

Forbidden:

```Dockerfile
ENV JAVA_TOOL_OPTIONS="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"
EXPOSE 5005
```

Allowed only in separate debug profile/image:

- Clearly named debug image tag.
- Non-production deployment only.
- Auth/network restrictions.
- Explicit approval.

---

## 21. Package Installation Policy

Runtime image package installation is restricted.

Allowed in build stage:

```Dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
```

Rules:

- Install only required packages.
- Use `--no-install-recommends` for Debian/Ubuntu unless justified.
- Clean package manager cache in the same layer.
- Do not install compilers/tools into runtime image.
- Prefer base image with required runtime assets already present.

Forbidden in runtime stage by default:

- `curl`, `wget`, `bash`, `vim`, `netcat`, `telnet`, `gcc`, `make`.

Exception: operational image profile with documented need.

---

## 22. Image Metadata

Recommended labels:

```Dockerfile
LABEL org.opencontainers.image.title="my-service"
LABEL org.opencontainers.image.description="Java service"
LABEL org.opencontainers.image.source="https://example.com/repo"
LABEL org.opencontainers.image.revision="$VCS_REF"
LABEL org.opencontainers.image.version="$APP_VERSION"
```

Rules:

- Version/revision labels should be set by CI.
- Do not place secrets in labels.
- Labels must not be hand-maintained if CI can inject them.

---

## 23. Reproducibility Rules

Required:

- Use Maven/Gradle wrapper.
- Pin dependency versions or use lockfiles/BOMs.
- Pin plugin versions.
- Avoid `SNAPSHOT` dependencies in production images unless explicitly allowed.
- Avoid `apt-get upgrade` in Dockerfile.
- Avoid downloading scripts from internet and piping to shell.
- Use CI-controlled build args for version metadata.

Forbidden:

```Dockerfile
RUN curl https://example.com/install.sh | bash
RUN apt-get update && apt-get upgrade -y
```

---

## 24. Image Scanning and SBOM

Production images MUST be compatible with:

- Vulnerability scanning.
- SBOM generation.
- License scanning.
- Base image tracking.

Rules:

- Do not hide dependencies by downloading at runtime.
- Do not vendor unknown binaries without provenance.
- CI should fail on critical vulnerabilities according to organization policy.
- Suppressions must have expiry and justification.

---

## 25. Java Framework-Specific Notes

### 25.1 Spring Boot

Rules:

- Prefer layered JAR when image layer caching matters.
- Use actuator readiness/liveness only if endpoints are secured and separated correctly.
- Do not expose all actuator endpoints by default.
- Do not rely on `SPRING_PROFILES_ACTIVE=prod` baked into image.

### 25.2 Quarkus

Rules:

- JVM mode and native mode require different image strategy.
- Native image must use matching runtime base.
- Do not mix JVM flags into native image runtime.

### 25.3 gRPC / Netty

Rules:

- Account for direct memory.
- Account for event loop threads.
- Expose only intended port.
- Ensure graceful shutdown.

### 25.4 Batch Jobs

Rules:

- Exit code must represent job success/failure.
- Do not run infinite loop unless service semantics require it.
- Logs must include job instance/correlation ID.

---

## 26. Graceful Shutdown

Java container must handle SIGTERM.

Rules:

- Use exec-form entrypoint.
- Application must stop accepting new requests during shutdown.
- In-flight work must complete or be cancelled within platform grace period.
- Shutdown timeout must be less than orchestrator termination grace period.
- Do not ignore interrupts.

Required for services:

- HTTP server graceful shutdown.
- DB pool close.
- Message consumer pause/commit policy.
- Executor shutdown.
- Metrics/log flushing.

---

## 27. Filesystem Security

Rules:

- Runtime root filesystem should be read-only where platform supports it.
- Writable locations must be explicit.
- Upload/temp directories must have size limits.
- File permissions must be least privilege.
- Do not run with root-owned writable application directory.

Recommended:

```Dockerfile
RUN mkdir -p /tmp/app \
 && chown -R 10001:10001 /tmp/app
USER 10001:10001
```

---

## 28. Timezone and Locale

Rules:

- Services should store timestamps in UTC.
- Timezone assumptions must not be hidden in image.
- If timezone data is required, ensure runtime image contains it.
- Avoid depending on system default timezone for business logic.
- Use `java.time` and explicit `ZoneId`.

Allowed:

```Dockerfile
ENV TZ=UTC
```

only as runtime default, not as replacement for correct application time handling.

---

## 29. CA Certificates and TLS

Rules:

- Runtime image must include trusted CA certificates when outbound TLS is required.
- Custom CA injection must be documented.
- Do not disable TLS verification in application to fix certificate issues.
- Do not bake private keys into image.
- Java truststore changes must be reproducible and reviewed.

Restricted:

```Dockerfile
RUN keytool -importcert ...
```

Allowed only with documented CA source and non-secret certificate.

---

## 30. Native Libraries

If application depends on native libraries:

- Runtime base image must match architecture and libc expectations.
- Libraries must be copied intentionally.
- License/provenance must be known.
- Multi-architecture build must be tested.
- Loading path must be explicit.

Forbidden:

- Random `.so` copied from developer machine.
- Architecture-specific dependency without platform constraint.

---

## 31. Multi-Architecture Build

If image is published for multiple architectures:

- Test `linux/amd64` and `linux/arm64` separately.
- Ensure native dependencies support both.
- Ensure JVM image supports both.
- Do not assume performance equivalence.
- CI must publish manifest list intentionally.

---

## 32. Docker Compose Policy

Docker Compose files are allowed for local development only unless explicitly approved for deployment.

Rules:

- Compose must not contain production secrets.
- Ports must be local-development appropriate.
- Volumes must not hide container runtime behavior.
- Local DB/cache config must not be confused with production HA config.

---

## 33. Forbidden Docker Anti-Patterns

LLM MUST NOT generate:

```Dockerfile
FROM openjdk:latest
```

```Dockerfile
COPY . /app
```

without `.dockerignore` and stage separation.

```Dockerfile
RUN chmod -R 777 /app
```

```Dockerfile
USER root
```

in runtime stage without justification.

```Dockerfile
ADD https://example.com/tool.sh /tmp/tool.sh
RUN /tmp/tool.sh
```

```Dockerfile
CMD ["sh", "-c", "java -jar app.jar"]
```

unless shell behavior is intentional and justified.

```Dockerfile
ENV PASSWORD=...
```

```Dockerfile
RUN apt-get update && apt-get install -y curl vim netcat
```

in runtime stage without operational justification.

---

## 34. Required Review Checklist

A Docker change is acceptable only if all applicable answers are “yes”:

### Build

- [ ] Uses multi-stage build or documented exception.
- [ ] Uses Maven/Gradle wrapper.
- [ ] Does not require local machine state.
- [ ] Does not copy unnecessary files.
- [ ] `.dockerignore` exists and excludes secrets/build artifacts.
- [ ] Dependencies are reproducible.

### Runtime

- [ ] Runtime image does not contain build tools.
- [ ] Runs as non-root.
- [ ] Uses exec-form entrypoint.
- [ ] Handles SIGTERM.
- [ ] Logs to stdout/stderr.
- [ ] Exposes only intended ports.
- [ ] Does not bake environment-specific config.

### Security

- [ ] No secrets in image layers, args, env, labels, or logs.
- [ ] Base image is approved and not `latest`.
- [ ] Image scan/SBOM is supported.
- [ ] Debug ports disabled by default.
- [ ] TLS trust is not bypassed.
- [ ] Writable filesystem is minimized.

### Java

- [ ] Java version matches project baseline.
- [ ] JVM memory policy fits container memory limit.
- [ ] CPU/thread assumptions are documented.
- [ ] GC/logging flags are appropriate.
- [ ] Native/direct memory is considered if relevant.

---

## 35. LLM Prompt Contract

Use this prompt fragment for Docker-related code generation:

```text
You are modifying Docker support for a Java service.
Follow strict-coding-standards__java_docker.md.
Before changing files, identify:
1. Java baseline.
2. Build tool.
3. Packaging type.
4. Runtime base image choice.
5. Non-root user strategy.
6. JVM container memory policy.
7. Required ports and health endpoints.
8. Secret/config injection strategy.

Do not use latest tags, root runtime user, shell-form entrypoint, embedded secrets, runtime dependency download, or debug ports by default.
If a rule must be violated, document the reason, risk, and safer alternative.
```

---

## 36. References

- Docker Docs — Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Docker Docs — Building best practices: https://docs.docker.com/build/building/best-practices/
- Docker Docs — Writing a Dockerfile: https://docs.docker.com/get-started/docker-concepts/building-images/writing-a-dockerfile/
- OpenJDK / JVM container behavior should be verified against the target JDK distribution and runtime.
- OWASP Docker Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
```

---

## 37. Final Rule

A Dockerfile is production code.

Treat it with the same discipline as Java source code: explicit inputs, least privilege, deterministic behavior, testable failure modes, and clear operational ownership.
