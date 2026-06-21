# learn-java-eclipse-jersey-deployment-models-part-020  
# Part 20 — Docker Deployment Model for Jersey

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 20 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey dalam Docker/container secara production-grade.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: container image design, base image, JVM ergonomics under cgroups, WAR vs jar image, signal handling, health checks, memory/CPU limits, secrets/config, image scanning, SBOM, non-root user, read-only filesystem, dan runtime diagnostics.

---

## 1. Mengapa Docker Deployment Perlu Dibahas Terpisah?

Docker bukan sekadar cara membungkus aplikasi.

Untuk aplikasi Jersey, Docker mengubah cara kita berpikir tentang:

```text
- runtime ownership
- file system layout
- dependency layering
- JVM memory sizing
- cgroup CPU/memory limits
- process signal handling
- health checks
- logs
- config/secrets injection
- base image patching
- image scanning
- artifact immutability
- reproducible release
- rollback by digest
```

Aplikasi Jersey yang sama bisa berjalan sebagai:

```text
WAR inside Tomcat image
WAR inside Jetty image
WAR inside Open Liberty image
WAR inside Payara image
fat jar with embedded Grizzly
thin jar with embedded Jetty
Netty server jar
JDK HTTP server jar
```

Docker bukan deployment model tunggal. Docker adalah packaging/runtime boundary yang bisa membungkus deployment model lain.

Top-tier mental model:

> Docker image adalah **runtime filesystem snapshot + process contract**.  
> Untuk Java/Jersey, image harus menjawab: Java mana, server mana, dependency mana, config dari mana, port mana, user siapa, signal bagaimana, memory berapa, health bagaimana.

---

## 2. Container Bukan VM

Container berbagi kernel host.

Ia memberi isolasi melalui:

```text
namespaces
cgroups
filesystem layers
network namespace
process namespace
capabilities
seccomp/apparmor depending runtime
```

Konsekuensi untuk Java:

```text
JVM berjalan sebagai process di dalam cgroup.
Memory limit bukan RAM host penuh.
CPU quota bukan CPU host penuh.
PID 1 behavior penting.
Filesystem bisa ephemeral/read-only.
Logs sebaiknya ke stdout/stderr.
```

Kesalahan umum:

```text
Aplikasi berjalan baik di VM,
lalu OOMKilled di container.
```

Karena di VM:

```text
JVM melihat resource yang sesuai machine.
```

Di container:

```text
JVM harus container-aware dan dikonfigurasi sesuai limit.
```

Modern JVM sudah jauh lebih container-aware, tetapi tetap perlu konfigurasi sadar produksi.

---

## 3. Image vs Container

```text
Image:
  immutable filesystem template + metadata

Container:
  running instance of image
```

Image berisi:

```text
base OS/filesystem
Java runtime
server runtime if any
application artifact
config defaults
entrypoint/cmd
user metadata
exposed ports metadata
```

Container menambahkan:

```text
runtime env vars
mounted secrets/config
writable layer
network identity
resource limits
signals
logs
health state
```

Production rule:

```text
Build once, run many.
```

Jangan rebuild image untuk setiap environment jika yang berubah hanya config.

---

## 4. Docker Image untuk Jersey: Dua Keluarga Besar

### 4.1 Server Image + WAR

Examples:

```text
Tomcat image + ROOT.war
Jetty image + app.war
Open Liberty image + server.xml + app.war
Payara image + deployed app
```

Topology:

```text
container process:
  server starts
  deploys WAR
  Jersey runs inside server
```

Image owns:

```text
server version
Java runtime
server config
WAR
```

### 4.2 Java Runtime Image + Executable App

Examples:

```text
Temurin JRE + app-fat.jar
Temurin JRE + thin distribution
custom jlink runtime + app
```

Topology:

```text
container process:
  java -jar app.jar
```

or:

```text
java -cp app.jar:lib/* com.example.Main
```

Image owns:

```text
Java runtime
application server code if embedded
Jersey dependencies
startup command
```

---

## 5. Choosing the Right Docker Shape

| Jersey Deployment | Docker Shape |
|---|---|
| Tomcat WAR | Tomcat base image + WAR |
| External Jetty WAR | Jetty base image + WAR/config |
| Open Liberty | Open Liberty image + server.xml + WAR |
| Payara/GlassFish | Server image + domain/app |
| Embedded Grizzly | JRE image + jar/thin distribution |
| Embedded Jetty | JRE image + jar/thin distribution |
| Netty | JRE image + jar/thin distribution |
| JDK HTTP Server | JRE/custom runtime + jar |
| Thin production distro | JRE image + app/lib layers |
| Highly minimized runtime | jlink image + app |

Decision factors:

```text
Who owns server runtime?
Do you need WAR/server lifecycle?
Do you need image layer caching?
Do you need minimal attack surface?
Do you need ops-standard server?
Do you need app-local server config?
```

---

## 6. Base Image Selection

Common choices:

```text
eclipse-temurin:<version>-jre
eclipse-temurin:<version>-jdk
openliberty/open-liberty...
tomcat:<version>-jre...
jetty:<version>...
payara/server...
distroless/java...
custom jlink runtime
```

Questions:

```text
Which Java version?
JDK or JRE?
glibc or musl?
Debian/Ubuntu/Alpine/UBI?
x86_64 or ARM64?
How are CVEs patched?
Is image officially maintained?
Does org approve it?
Does it include shell/debug tools?
Does it run as non-root?
```

Eclipse Temurin Docker Hub page notes that JRE images are available, while recommending custom JRE-like runtime via `jlink` for some use cases.

Practical baseline:

```text
Use official, maintained, pinned Java/server image.
Avoid latest tag.
Pin major/minor or digest where production requires reproducibility.
```

---

## 7. JDK vs JRE vs jlink

### JDK Image

Contains compiler/tools.

Good for build stage.

Bad for final runtime if not needed:

```text
larger attack surface
larger image
more tools than necessary
```

### JRE Image

Contains runtime.

Good for final image.

### jlink Runtime

Custom runtime containing only needed modules.

Pros:

```text
smaller
controlled modules
less runtime surface
```

Cons:

```text
harder dependency/module analysis
may omit needed modules
debugging harder
requires tests on final image
```

Example jlink concept:

```bash
jlink \
  --add-modules java.base,java.logging,jdk.httpserver \
  --strip-debug \
  --no-man-pages \
  --no-header-files \
  --compress=zip-6 \
  --output /opt/runtime
```

For Jersey with Jackson, TLS, logging, XML, JNDI, etc., required module list can be larger.

Rule:

```text
Use jlink when you can test final runtime image thoroughly.
```

---

## 8. Multi-Stage Builds

Docker multi-stage build separates build environment from runtime environment.

Conceptual Maven example:

```Dockerfile
FROM eclipse-temurin:21-jdk AS build

WORKDIR /workspace
COPY pom.xml .
COPY src ./src

RUN ./mvnw -DskipTests package

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=build /workspace/target/app.jar /app/app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Better in CI:

```text
Build artifact in CI pipeline.
Test it.
Then Docker image only copies tested artifact.
```

This avoids Docker build becoming the only build pipeline.

Two valid models:

```text
Model A:
  Docker builds app.

Model B:
  CI builds app, Docker packages artifact.
```

For enterprise reproducibility, Model B is often clearer.

---

## 9. Dockerfile for Embedded Jersey Fat Jar

Example:

```Dockerfile
FROM eclipse-temurin:21-jre

RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app

COPY target/case-api-all.jar /app/app.jar

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

This is simple.

But ensure:

```text
fat jar has merged META-INF/services
Main-Class exists
bind host is 0.0.0.0
health endpoint exists
SIGTERM handled
logs go to stdout/stderr
```

---

## 10. Dockerfile for Thin Jersey Distribution

Layout:

```text
build/docker/
├─ app/case-api.jar
├─ lib/*.jar
└─ bin/start.sh
```

Dockerfile:

```Dockerfile
FROM eclipse-temurin:21-jre

RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app

COPY lib/ /app/lib/
COPY app/case-api.jar /app/app.jar

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", "-cp", "/app/app.jar:/app/lib/*", "com.example.Main"]
```

Benefits:

```text
dependency layer cached
easier inspect jars
no shade merge risk
SBOM maps to jar files
```

Thin distribution is often excellent for production Jersey embedded apps.

---

## 11. Dockerfile for Tomcat + Jersey WAR

Example:

```Dockerfile
FROM tomcat:10.1-jre21

RUN rm -rf /usr/local/tomcat/webapps/*

COPY target/case-api.war /usr/local/tomcat/webapps/ROOT.war

EXPOSE 8080
```

If WAR name is:

```text
ROOT.war
```

context path:

```text
/
```

If:

```text
case-api.war
```

context path:

```text
/case-api
```

That changes probe paths.

If Jersey servlet mapping is `/api/*`, health path:

```text
ROOT.war:
  /api/health/ready

case-api.war:
  /case-api/api/health/ready
```

---

## 12. Dockerfile for Open Liberty

Conceptual:

```Dockerfile
FROM icr.io/appcafe/open-liberty:kernel-slim-java21-openj9-ubi

COPY --chown=1001:0 src/main/liberty/config/server.xml /config/
COPY --chown=1001:0 target/case-api.war /config/apps/

RUN features.sh

EXPOSE 9080 9443
```

Open Liberty image workflows often copy `server.xml` and WAR into `/config`, then install/cache features.

Important:

```text
server.xml is part of image/runtime contract
features must match app
health endpoints must be enabled/tested
secrets must not be baked into image
```

---

## 13. Dockerfile for Payara/GlassFish

Conceptual:

```Dockerfile
FROM payara/server-full:some-version

COPY target/case-api.war /opt/payara/deployments/case-api.war
```

But real production often needs:

- domain config,
- JDBC resource creation,
- admin password/secure admin policy,
- JVM options,
- JDBC driver placement,
- health path,
- logging,
- startup scripts.

For managed servers, image should include:

```text
server runtime
server config as code
app artifact
resource provisioning strategy
```

Do not rely on manual admin console changes after container starts.

---

## 14. Non-Root User

Running as root in container increases risk.

Use non-root:

```Dockerfile
RUN useradd --system --create-home --uid 10001 appuser
USER 10001
```

Need to ensure:

```text
/app readable
temp directory writable if needed
logs not written to root-only path
server work dirs writable
WAR extraction dir writable
```

Common bug:

```text
App runs as non-root but cannot write temp/upload/log directory.
```

Fix:

```Dockerfile
RUN mkdir -p /app/tmp && chown -R 10001:10001 /app
```

or avoid writing to filesystem.

---

## 15. File System Strategy

Containers should be mostly immutable.

Writable surfaces:

```text
/tmp
server work dir
upload temp dir
cache dir if needed
logs if file-based
```

Production preference:

```text
write logs to stdout/stderr
write temp only to known dir
mount volumes only when needed
support read-only root filesystem where possible
```

Kubernetes security context may set:

```yaml
readOnlyRootFilesystem: true
```

Then app/server must have writable mounts for required temp dirs.

Jersey upload/multipart endpoints may need temp storage.

Plan it.

---

## 16. ENTRYPOINT vs CMD

Dockerfile reference defines `ENTRYPOINT` and `CMD` as ways to specify container process behavior.

For Java services, use exec-form ENTRYPOINT:

```Dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Avoid shell-form:

```Dockerfile
ENTRYPOINT java -jar /app/app.jar
```

unless you understand signal behavior.

Exec form avoids an extra shell and improves signal delivery.

If using script:

```Dockerfile
ENTRYPOINT ["/app/bin/start.sh"]
```

Script should end with:

```bash
exec java ...
```

so JVM becomes process receiving signals.

---

## 17. PID 1 and Signal Handling

In containers, your process may run as PID 1.

PID 1 has special signal behavior.

If a shell script is PID 1 and does not forward SIGTERM, JVM may not shut down gracefully.

Bad:

```bash
#!/usr/bin/env bash
java -jar /app/app.jar
```

Good:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec java -jar /app/app.jar
```

For Jersey embedded:

```text
SIGTERM should trigger JVM shutdown hook
server should mark readiness false
server should stop accepting new requests
in-flight requests should drain
resources should close
```

Docker stop sends SIGTERM then after timeout SIGKILL.

---

## 18. Healthcheck in Docker vs Kubernetes

Dockerfile supports `HEALTHCHECK`.

Example:

```Dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health/live || exit 1
```

However, in Kubernetes, prefer Kubernetes probes:

```text
startupProbe
livenessProbe
readinessProbe
```

Do not rely only on Dockerfile HEALTHCHECK if Kubernetes is orchestrating.

For local Docker Compose, HEALTHCHECK can be useful.

Production Kubernetes:

```text
define probes in manifests/Helm/Kustomize
```

---

## 19. Bind Host in Container

Inside container, app must bind to:

```text
0.0.0.0
```

not:

```text
127.0.0.1
localhost
```

unless intentionally local-only.

Bad:

```java
URI.create("http://localhost:8080/")
```

Symptom:

```text
app logs "started"
docker port exposed
but host/Kubernetes cannot connect
```

Good:

```text
APP_BIND_HOST=0.0.0.0
APP_PORT=8080
```

Docker `EXPOSE` is metadata. It does not make app listen on that port.

The app must bind correctly.

---

## 20. Port Strategy

Do not hardcode port unless app is intentionally fixed.

Use env:

```text
APP_PORT=8080
```

In Docker:

```Dockerfile
EXPOSE 8080
```

In Kubernetes:

```yaml
ports:
  - containerPort: 8080
```

In Open Liberty default:

```text
9080 / 9443
```

In Tomcat default:

```text
8080
```

In app code, use config.

Path and port must align:

```text
Dockerfile EXPOSE
application bind port
Kubernetes containerPort
Service targetPort
Ingress route
health probes
```

---

## 21. JVM Memory in Containers

Java memory is more than heap.

JVM memory surfaces:

```text
heap
metaspace
thread stacks
direct buffers
code cache
GC structures
JNI/native memory
class data
JIT/compiler memory
mapped files
Netty direct memory
TLS buffers
OS page cache
```

If container memory limit is 512 MiB and heap is 512 MiB, process can exceed limit and be OOMKilled.

Use heap percentage:

```text
-XX:MaxRAMPercentage=70
```

or explicit heap:

```text
-Xmx384m
```

But account for non-heap.

For Netty:

```text
direct memory can be significant
```

For many threads:

```text
thread stacks can be significant
```

Rule:

```text
Container memory limit must cover total process memory, not only heap.
```

---

## 22. MaxRAMPercentage

Modern JVMs support container-aware heap sizing with flags like:

```text
-XX:MaxRAMPercentage
-XX:InitialRAMPercentage
-XX:MinRAMPercentage
```

Example:

```Dockerfile
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

This says:

```text
max heap roughly 75% of container memory limit
```

But not all memory.

Use lower percentage if:

- many threads,
- Netty/direct buffers,
- large metaspace,
- large off-heap cache,
- heavy native memory,
- sidecar/memory overhead,
- small container memory limit.

For memory debugging:

```text
-Xlog:os+container=info
-Xlog:gc*
-XX:NativeMemoryTracking=summary
```

Native Memory Tracking has overhead; use carefully.

---

## 23. CPU Limits and JVM

Containers may have CPU quota.

JVM uses available processors to size:

- GC threads,
- JIT compiler threads,
- ForkJoinPool,
- parallelism defaults,
- framework pools.

If CPU limit is small but JVM sees many CPUs incorrectly, thread counts may be too high.

Modern JVMs are container-aware, but verify.

Diagnostic:

```bash
java -XshowSettings:system -version
```

or logs:

```text
-Xlog:os+container=info
```

App tuning:

```text
ActiveProcessorCount
GC thread tuning if needed
server thread pools
DB pool
HTTP client pool
```

Do not set Tomcat/Jetty/Netty threads without considering container CPU quota.

---

## 24. GC Strategy

For Java 21/25 Jersey services, common choices:

```text
G1GC default
ZGC for low-latency/high-memory use cases
Generational ZGC in modern JDKs
```

Do not tune GC before measuring.

Container concerns:

```text
memory limit
pause SLO
allocation rate
heap size
CPU quota
startup time
```

Enable GC logs in non-prod/performance test:

```text
-Xlog:gc*:stdout:time,uptime,level,tags
```

In production, GC logging can be useful but manage volume.

---

## 25. Thread Counts Under Container Limits

Jersey app may have:

```text
server request threads
DB pool threads
HTTP client dispatcher threads
scheduler threads
GC threads
JIT threads
ForkJoinPool
telemetry exporter threads
logging async threads
```

In a 1 CPU / 512 MiB container, too many threads cause:

- memory pressure,
- context switching,
- latency,
- OOMKilled due thread stacks.

Tune:

```text
server threads
DB pool
worker executors
scheduler sizes
```

Based on limits.

Top-tier invariant:

```text
Thread budgets must match CPU/memory/downstream capacity.
```

---

## 26. OOMKilled vs Java OOM

Two different failures:

### Java OOM

JVM throws:

```text
OutOfMemoryError
```

Logs may show stack trace.

### Container OOMKilled

Kernel kills process because cgroup memory exceeded.

Kubernetes shows:

```text
reason: OOMKilled
exitCode: 137
```

JVM may not log Java OOM.

If you see OOMKilled:

```text
heap may not be the only issue
check direct memory, threads, metaspace, native memory
```

Use metrics and memory budget.

---

## 27. Config Injection

Do not bake environment config into image.

Use:

```text
environment variables
mounted config files
Kubernetes ConfigMap
Kubernetes Secret
external secret manager
server.xml variables
MicroProfile Config
system properties
```

Example:

```Dockerfile
ENTRYPOINT ["java", "-Dconfig.file=/config/application.conf", "-jar", "/app/app.jar"]
```

Kubernetes:

```yaml
volumeMounts:
  - name: config
    mountPath: /config
```

Rule:

```text
Image immutable.
Config external.
Secrets external and protected.
```

---

## 28. Secrets

Never put secrets in:

```text
Dockerfile
image layers
git repo
application.properties inside jar
server.xml committed with passwords
environment logs
command-line args if exposed in process list
```

Prefer:

- secret manager,
- Kubernetes Secret mounted as file,
- environment variables with controlled exposure,
- platform-specific secret injection.

Be careful:

```text
env vars can leak through diagnostics
command-line args can leak in process listings
logs can leak values
```

For high-sensitivity secrets, mounted files or secret manager client may be preferable.

---

## 29. Logs

Container logging best practice:

```text
write application logs to stdout/stderr
platform collects logs
```

Avoid:

```text
writing only to /var/log/app.log inside container
```

unless log collector reads it.

Structured logs recommended:

```json
{
  "timestamp": "...",
  "level": "INFO",
  "requestId": "...",
  "module": "case",
  "message": "case created"
}
```

For Jersey:

- request correlation filter,
- access log strategy,
- error mapper logs,
- safe principal/user id,
- no raw tokens/secrets.

---

## 30. Access Logs in Container

Depending model:

```text
Tomcat access log
Jetty access log
Open Liberty access log
Payara access log
application request filter
reverse proxy access log
```

In Kubernetes, prefer logs routed to stdout or collected from known files.

Access log should include:

```text
request id
method
path
status
duration
client ip/forwarded
bytes
user agent
```

If reverse proxy handles access logs, app still needs request-level application logs.

---

## 31. Time Zone and Locale

Containers may have minimal timezone data.

Decide:

```text
use UTC internally
format user-facing times by user locale/timezone
logs in UTC
database timestamps consistent
```

Set if needed:

```Dockerfile
ENV TZ=UTC
```

But for Java, prefer:

```text
-Duser.timezone=UTC
```

if you need strong consistency.

Do not rely on host timezone.

---

## 32. CA Certificates

Java HTTPS clients need trusted CA certificates.

Base images usually include CA certs, but minimal/distroless/custom jlink images may need care.

Symptoms:

```text
SSLHandshakeException
unable to find valid certification path
```

Ensure:

```text
CA certificates installed
Java truststore present
corporate CA imported if needed
```

Do not disable certificate validation.

---

## 33. Read-Only Root Filesystem

Security hardening may set root filesystem read-only.

App/server must write only to allowed mounts:

```text
/tmp
work dir
upload temp dir
cache dir
server temp/extract dir
```

For WAR server images:

- Tomcat may unpack WAR,
- Jetty may extract WAR,
- Liberty may write workarea,
- Payara may write domain files.

If root FS is read-only, configure writable volumes.

Checklist:

```text
[ ] server temp dir writable
[ ] upload temp dir writable
[ ] logs to stdout or writable
[ ] no runtime mutation of app directory
```

---

## 34. Image Scanning and SBOM

Container image includes:

```text
OS packages
Java runtime
server runtime
app jars
native libs
config files
```

Security scanning must cover all layers.

Generate SBOM for:

```text
application dependencies
container image packages
server runtime
```

Attach image digest and SBOM to release.

If CVE appears in:

```text
Jackson
Netty
Tomcat
OpenSSL
glibc
base image OS package
```

you need to know whether your image contains it.

---

## 35. Pinning Image Tags

Bad:

```Dockerfile
FROM eclipse-temurin:latest
```

Better:

```Dockerfile
FROM eclipse-temurin:21-jre
```

Even better for strict reproducibility:

```text
pin by digest
```

Example concept:

```Dockerfile
FROM eclipse-temurin:21-jre@sha256:...
```

Trade-off:

```text
tag pin:
  easier updates

digest pin:
  stronger reproducibility
```

Production release process should include base image update scanning.

---

## 36. Image Layer Hygiene

Avoid:

```Dockerfile
RUN apt-get update
RUN apt-get install -y curl
```

without cleanup/versioning.

Better:

```Dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
```

But do not install tools you do not need.

Debug tools increase attack surface.

For production minimal images, keep runtime lean.

For debug, use ephemeral debug containers or separate debug image.

---

## 37. Build Cache Strategy

For Maven/Gradle builds inside Docker:

```Dockerfile
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package
```

This caches dependency download when source changes.

But in CI, external build cache may be better.

For thin app image:

```Dockerfile
COPY lib/ /app/lib/
COPY app.jar /app/app.jar
```

Dependency layer remains cached when only app code changes.

---

## 38. Health Endpoint Design

Jersey app should expose:

```text
/health/live
/health/ready
```

or use MicroProfile Health if runtime supports it.

Semantics:

```text
liveness:
  should process be restarted?

readiness:
  should traffic be sent?

startup:
  has app completed startup?
```

Docker/Kubernetes must use correct path after context/mapping.

Examples:

```text
embedded:
  /health/ready

Tomcat ROOT.war + /api/*:
  /api/health/ready

Tomcat case-api.war + /api/*:
  /case-api/api/health/ready

Open Liberty MP Health:
  /health/ready
```

Verify actual image.

---

## 39. Graceful Shutdown in Container

For embedded Jersey:

```text
SIGTERM
  ↓
shutdown hook
  ↓
readiness false
  ↓
server stop/drain
  ↓
resources close
```

For Tomcat/Jetty/Liberty/Payara:

```text
SIGTERM
  ↓
server shutdown script/runtime
  ↓
contexts stop
  ↓
app lifecycle cleanup
  ↓
process exits
```

Kubernetes:

```text
terminationGracePeriodSeconds
preStop hook if used
load balancer endpoint removal
```

Do not depend on `preStop sleep` only.

App should handle SIGTERM correctly.

---

## 40. preStop Hook

Sometimes used:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 5"]
```

Purpose:

```text
allow readiness removal/load balancer drain
```

But do not use it as a substitute for graceful shutdown.

Better:

```text
readiness false on shutdown
server drains
termination grace enough
```

preStop can help but should be part of a tested shutdown design.

---

## 41. Resource Limits and Requests

Kubernetes resources:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

Requests affect scheduling.

Limits affect cgroup enforcement.

For JVM:

```text
memory limit influences heap sizing
CPU limit influences effective processors/throughput
```

Do not set memory limit without heap/non-heap budget.

Do not set CPU limit too low without testing GC/request latency.

---

## 42. Example Memory Budget

Container memory:

```text
1 GiB
```

Potential budget:

```text
heap:
  650 MiB

metaspace:
  80 MiB

thread stacks:
  80 MiB

direct buffers:
  80 MiB

code cache/native/GC:
  80 MiB

headroom:
  54 MiB
```

Then:

```text
-XX:MaxRAMPercentage=65
```

may be safer than 80.

For Netty:

```text
increase direct memory budget
```

For many Tomcat threads:

```text
increase thread stack budget or reduce threads
```

---

## 43. JVM Diagnostics in Container

Useful flags:

```text
-Xlog:os+container=info
-Xlog:gc*:stdout:time,uptime,level,tags
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

But heap dumps can be large and contain sensitive data.

If enabling heap dumps:

```text
mount secure volume
protect access
avoid filling container filesystem
define retention
```

Thread dumps:

```bash
jcmd <pid> Thread.print
```

In minimal images, `jcmd` may not exist if using JRE/jlink.

Decide whether diagnostics tools are needed.

---

## 44. Debuggability vs Minimalism

Minimal images improve security/size but reduce debugging tools.

Trade-off:

```text
minimal production image:
  fewer tools, smaller attack surface

debug image/ephemeral container:
  tools available for investigation
```

Production strategy:

```text
keep runtime image minimal
enable logs/metrics/traces
use ephemeral debug containers if platform allows
```

Do not install curl/bash/jcmd only because debugging might happen, unless your ops model requires it.

---

## 45. Docker Compose for Local Development

Example:

```yaml
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      APP_BIND_HOST: "0.0.0.0"
      APP_PORT: "8080"
      DB_URL: "jdbc:postgresql://db:5432/app"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: example
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Compose is useful for local parity but not production orchestration.

Do not confuse Compose health with Kubernetes readiness.

---

## 46. Image Promotion

Preferred pipeline:

```text
build artifact
run tests
build image
scan image
push image by immutable tag/digest
deploy same image to DEV
promote same image to UAT
promote same image to PROD
```

Bad:

```text
rebuild image separately for each environment
```

unless carefully controlled.

Promotion preserves artifact identity.

---

## 47. Common Docker Failure Modes

### 47.1 App Binds to localhost

Symptom:

```text
container starts
port mapping exists
connection refused from outside
```

Fix:

```text
bind 0.0.0.0
```

### 47.2 OOMKilled

Symptom:

```text
exit code 137
Kubernetes reason OOMKilled
```

Fix:

```text
heap percentage
non-heap budget
direct memory
thread count
memory limit sizing
```

### 47.3 SIGTERM Not Handled

Cause:

```text
shell script not using exec
server shutdown not configured
```

Fix:

```text
exec-form ENTRYPOINT
shutdown hooks/lifecycle
```

### 47.4 Health Probe Path Wrong

Cause:

```text
context path / servlet mapping mismatch
```

Fix:

```text
compose final path correctly
test image
```

### 47.5 Permission Denied

Cause:

```text
non-root user cannot write temp/work dir
```

Fix:

```text
chown needed dirs
use writable mounts
avoid writing to app dir
```

### 47.6 Missing CA Certificates

Cause:

```text
minimal image lacks CA trust
```

Fix:

```text
install CA certificates
import corporate CA
```

### 47.7 Different Java Version in Image

Cause:

```text
CI uses Java 25
image uses Java 21
or reverse
```

Fix:

```text
align build --release and runtime
log Java version at startup
```

---

## 48. Anti-Patterns

### Anti-Pattern 1 — `latest` Base Image

Not reproducible.

### Anti-Pattern 2 — Running as Root

Avoid unless justified.

### Anti-Pattern 3 — Baking Secrets Into Image

Secrets remain in layers.

### Anti-Pattern 4 — No Memory Budget

Heap uses most memory, container kills process.

### Anti-Pattern 5 — Shell Entrypoint Without `exec`

SIGTERM not delivered properly.

### Anti-Pattern 6 — Healthcheck Only Checks Port

Port open is not app ready.

### Anti-Pattern 7 — Rebuilding Per Environment

Destroys promotion confidence.

### Anti-Pattern 8 — Installing Debug Tools in Production Image by Default

Increases attack surface.

### Anti-Pattern 9 — Writing Logs Only to File

Platform may not collect them.

### Anti-Pattern 10 — Ignoring Image CVEs

Base image is part of your app.

---

## 49. Decision Matrix

| Concern | Good Docker Practice |
|---|---|
| Java version | pinned base image |
| Runtime ownership | choose server image or JRE image deliberately |
| User | non-root |
| Config | externalized |
| Secrets | secret manager/K8s Secret, not image |
| Logs | stdout/stderr |
| Health | app-level ready/live/startup |
| Memory | heap + non-heap budget |
| CPU | thread pools aligned with quota |
| Signal | exec entrypoint, graceful shutdown |
| Filesystem | immutable, known writable dirs |
| Security | SBOM + image scan |
| Rollback | immutable tag/digest |
| Reproducibility | no `latest`, pinned deps, same image promoted |

---

## 50. Recommended Defaults by Jersey Deployment

### Embedded Jersey

```text
Base:
  eclipse-temurin:21-jre or approved Java image

Artifact:
  thin distribution or correctly shaded fat jar

Run:
  non-root
  exec-form ENTRYPOINT
  bind 0.0.0.0
  MaxRAMPercentage tuned
  health endpoints
```

### Tomcat + Jersey WAR

```text
Base:
  pinned Tomcat + JRE image

Artifact:
  ROOT.war or named context deliberately

Config:
  connector/server.xml if needed

Probe:
  final context + servlet mapping health path
```

### Open Liberty

```text
Base:
  pinned Open Liberty Java image

Artifact:
  server.xml + WAR

Features:
  installed/cached at build time

Health:
  MicroProfile Health endpoints
```

### Payara/GlassFish

```text
Base:
  pinned server image

Artifact:
  WAR/EAR + domain/resource config

Config:
  scripted resource provisioning

Probe:
  app health endpoint, not only server root
```

---

## 51. Top-Tier Engineering Perspective

A basic engineer writes:

```Dockerfile
FROM openjdk
COPY app.jar app.jar
CMD java -jar app.jar
```

A senior engineer asks:

```text
Which Java version?
Which port?
Which user?
Which memory flags?
Where are logs?
```

A top-tier engineer defines:

```text
- runtime ownership
- base image governance
- artifact layout
- dependency layering
- memory and CPU budget
- non-root filesystem permissions
- signal handling
- health semantics
- config/secrets injection
- SBOM/scanning
- logging/observability
- reproducible tags/digests
- rollback process
- Kubernetes probe/shutdown behavior
```

Docker deployment is not only “containerize app”.

It is production runtime engineering.

---

## 52. Production Readiness Checklist

```text
[ ] Base image pinned.
[ ] Java runtime version logged at startup.
[ ] Build --release aligns with runtime Java.
[ ] Non-root user configured.
[ ] App binds to 0.0.0.0.
[ ] Exposed port matches app port.
[ ] ENTRYPOINT uses exec form or script with exec.
[ ] SIGTERM graceful shutdown tested.
[ ] Health live/ready/startup endpoints tested.
[ ] Probe paths match context/mapping.
[ ] JVM memory budget defined.
[ ] MaxRAMPercentage or Xmx configured.
[ ] Non-heap/direct/thread memory considered.
[ ] CPU quota considered for thread pools.
[ ] Logs go to stdout/stderr or collector.
[ ] Config externalized.
[ ] Secrets not baked into image.
[ ] Writable dirs known and permissioned.
[ ] Read-only root filesystem tested if required.
[ ] CA certificates available.
[ ] Image scanned for CVEs.
[ ] SBOM generated.
[ ] Base image update process exists.
[ ] Artifact/image digest recorded.
[ ] Same image promoted across environments.
[ ] Rollback image available.
[ ] Docker stop tested.
[ ] Kubernetes rolling update tested.
[ ] OOMKilled diagnostics plan exists.
```

---

## 53. Summary

Docker deployment for Jersey is not a single model.

It can wrap:

```text
WAR-based server deployment
embedded jar deployment
thin distribution
Open Liberty feature runtime
Payara/GlassFish domain runtime
```

The key questions are:

```text
What exactly is inside the image?
Who owns server runtime?
Which Java version runs?
How is memory sized?
How are signals handled?
How are health checks exposed?
Where do config and secrets come from?
How is the image scanned and promoted?
```

Top-tier insight:

> Docker makes deployment reproducible only if the image, config, runtime, and release process are disciplined.  
> Otherwise, it simply makes broken deployment portable.

---

## 54. How This Part Connects to the Next Part

This part covered Docker deployment.

Next:

```text
Part 21 — Kubernetes Deployment Model
```

Kubernetes builds on Docker/container fundamentals but adds:

- pods,
- deployments,
- services,
- ingress,
- probes,
- rolling updates,
- resource requests/limits,
- config maps/secrets,
- service discovery,
- horizontal scaling,
- termination lifecycle,
- readiness gates,
- autoscaling,
- observability integration.

We will focus specifically on what changes when a Jersey application moves from “container image” to “orchestrated service”.

---

## References

- Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Eclipse Temurin official Docker image: https://hub.docker.com/_/eclipse-temurin
- Eclipse Adoptium container images: https://adoptium.net/installation/containers
- Open Liberty Docker guide: https://openliberty.io/guides/docker.html
- Dockerfile reference — HEALTHCHECK instruction: https://docs.docker.com/reference/dockerfile/#healthcheck
- Dockerfile reference — USER instruction: https://docs.docker.com/reference/dockerfile/#user
- Dockerfile reference — ENTRYPOINT instruction: https://docs.docker.com/reference/dockerfile/#entrypoint
- Red Hat Developers — OpenJDK containers memory tuning: https://developers.redhat.com/articles/2023/03/07/overhauling-memory-tuning-openjdk-containers-updates
- OpenJDK bug JDK-8230305 — cgroups v2 container awareness: https://bugs.openjdk.org/browse/JDK-8230305


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-019.md">⬅️ Part 19 — Fat Jar, Uber Jar, Thin Jar, dan Distribution Layout</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-021.md">Part 21 — Kubernetes Deployment Model ➡️</a>
</div>
