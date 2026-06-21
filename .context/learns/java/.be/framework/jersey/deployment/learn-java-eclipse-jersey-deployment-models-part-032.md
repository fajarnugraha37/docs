# learn-java-eclipse-jersey-deployment-models-part-032  
# Part 32 — Capstone: Designing a Top-Tier Jersey Deployment Architecture

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 32 dari 32 — FINAL**  
> Target pembaca: engineer Java backend yang ingin menyatukan seluruh konsep deployment Jersey menjadi desain arsitektur produksi yang matang, aman, observable, scalable, maintainable, dan migration-ready.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: end-to-end architecture, runtime selection, artifact design, Docker/Kubernetes, ingress/API gateway, config/secrets, security, observability, performance, failure handling, rollback, migration readiness, dan final production checklist.

---

## 1. Tujuan Capstone

Seluruh seri ini membahas banyak model:

```text
WAR
ServletContainer
Servlet Filter
ResourceConfig
Classpath/JPMS
Embedded Grizzly
Embedded Jetty
JDK HTTP Server
Netty
Jakarta EE servers
Tomcat
Jetty external
GlassFish/Payara
Open Liberty
fat jar / thin jar
Docker
Kubernetes
Reverse proxy/API Gateway
Threading
Connection/timeout/backpressure
Configuration
Security
Observability
Failure modes
Performance
Migration
Decision framework
```

Capstone ini menyatukan semuanya menjadi satu pertanyaan:

```text
Bagaimana mendesain deployment Jersey production-grade dari nol?
```

Bukan hanya:

```text
Bagaimana menjalankan Jersey?
```

Tetapi:

```text
Bagaimana membuat Jersey service yang bisa di-build, dideploy, diamankan, diamati, dituning, di-upgrade, di-rollback, dan didiagnosis saat incident?
```

Top-tier mental model:

> Production deployment architecture adalah kontrak end-to-end antara code, runtime, artifact, infrastructure, security, observability, dan operational ownership.

---

## 2. Scenario Capstone

Kita akan mendesain service:

```text
case-api
```

Karakteristik:

```text
REST API untuk case management
Java 21
Jersey 3.1.x
jakarta.* namespace
JSON API
PostgreSQL/Oracle-style relational DB
HTTP downstream document-service
Redis cache optional
Docker + Kubernetes deployment
Ingress/API gateway in front
OpenTelemetry
non-root container
structured logs
request ID
health/readiness
rolling update
rollback support
```

Target:

```text
p95 latency:
  < 200ms for case detail read

p99 latency:
  < 750ms for normal CRUD

availability:
  99.9%

startup readiness:
  < 60s

graceful shutdown:
  finish short in-flight requests within 30s

security:
  JWT/OIDC validated
  domain authorization in service layer
  no secrets in image/logs

operability:
  thread dump possible
  metrics/traces/logs correlated
  rollback by image digest
```

---

## 3. Architecture Overview

End-to-end:

```text
Client
  ↓ HTTPS
API Gateway / Ingress
  ↓ HTTP or mTLS depending policy
Kubernetes Service
  ↓
Pod: case-api container
  ↓
Embedded Jersey runtime or Tomcat WAR runtime
  ↓
Jersey filters/resources
  ↓
Service layer
  ↓
DB pool / HTTP client pool / Redis
  ↓
Database / document-service / cache
```

For this capstone, we choose:

```text
Deployment style:
  Dockerized embedded Jersey service using thin distribution

Runtime:
  Embedded Grizzly or embedded Jetty style

Reason:
  app team owns runtime
  simple REST API
  no full Jakarta EE server requirement
  Kubernetes-native deployment
  transparent dependency layout
```

But we will also note alternatives.

---

## 4. Architectural Decision Record

```markdown
# ADR: case-api Jersey Deployment Architecture

## Status
Accepted

## Context
- Java 21 runtime
- Jersey 3.1.x / jakarta namespace
- Kubernetes platform available
- API Gateway/Ingress in front
- REST + DB + HTTP downstream
- No requirement for full Jakarta EE server features
- App team owns runtime and CI/CD
- Platform team owns Kubernetes, Ingress, image registry, secret integration

## Decision
Use embedded Jersey runtime packaged as thin distribution in a Docker image, deployed as Kubernetes Deployment behind Service and Ingress/API Gateway.

## Rationale
- Avoid external app server dependency for simple REST service.
- Keep runtime ownership clear.
- Thin distribution improves dependency visibility and Docker layering.
- Kubernetes handles rollout, self-healing, config/secrets, probes, and scaling.
- App controls health/readiness, security filters, metrics, and shutdown.

## Consequences
Positive:
- One image contains exact app runtime.
- Same image promoted DEV → UAT → PROD.
- Easy dependency inspection and SBOM.
- Clear JVM/container tuning.

Negative:
- App team owns server lifecycle, metrics, shutdown, thread/pool tuning.
- No server-managed Jakarta EE services.
- Must implement/operate auth/config/observability carefully.
```

---

## 5. Runtime Selection

Chosen:

```text
Embedded Jersey runtime with thin distribution
```

Possible implementation:

```text
Jersey + Grizzly
```

or:

```text
Jersey + embedded Jetty servlet container
```

For capstone, either is acceptable, but choose one explicitly.

### Option A — Embedded Grizzly

Pros:

```text
Jersey-native
simple
small runtime
easy executable service
```

Cons:

```text
less standard servlet ecosystem
ops metrics must be added
```

### Option B — Embedded Jetty

Pros:

```text
Servlet capabilities
mature HTTP runtime
flexible thread pool
good observability options
```

Cons:

```text
more server config complexity
embedding code/config ownership
```

Capstone recommendation:

```text
If you do not need Servlet features:
  Grizzly is simple.

If you want Servlet filter compatibility or Jetty ops familiarity:
  embedded Jetty is strong.
```

We choose:

```text
Embedded Jetty or Grizzly based on team familiarity.
```

The architecture remains similar.

---

## 6. Version Generation Decision

Because target is Java 21 and modern Jakarta namespace:

```text
Jersey:
  3.1.x

Namespace:
  jakarta.*

Platform alignment:
  Jakarta EE 10 generation

Java:
  21 runtime

Container:
  JRE 21 base image
```

Important invariant:

```text
No javax.ws.rs-api in artifact.
No Jersey 2 modules.
No mixed jakarta/javax REST APIs.
```

Future migration:

```text
Jersey 4 / Jakarta EE 11 can be evaluated later after runtime/dependency compatibility check.
```

---

## 7. Project Structure

Recommended:

```text
case-api/
├─ pom.xml
├─ src/
│  ├─ main/
│  │  ├─ java/
│  │  │  └─ com/example/caseapi/
│  │  │     ├─ Main.java
│  │  │     ├─ config/
│  │  │     ├─ health/
│  │  │     ├─ security/
│  │  │     ├─ observability/
│  │  │     ├─ resources/
│  │  │     ├─ services/
│  │  │     ├─ repositories/
│  │  │     └─ clients/
│  │  └─ resources/
│  │     ├─ application-defaults.properties
│  │     └─ logback.xml
│  └─ test/
├─ docker/
│  └─ Dockerfile
├─ k8s/
│  ├─ deployment.yaml
│  ├─ service.yaml
│  ├─ ingress.yaml
│  ├─ configmap.yaml
│  ├─ secret-template.yaml
│  └─ pdb.yaml
├─ scripts/
│  ├─ run-local.sh
│  └─ smoke-test.sh
└─ docs/
   ├─ ADR-deployment.md
   ├─ RUNBOOK.md
   └─ OPERATIONS.md
```

This separates:

```text
source
runtime config
Docker packaging
Kubernetes manifests
runbooks
```

---

## 8. Maven Dependency Model

Use Jersey BOM.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.glassfish.jersey</groupId>
      <artifactId>jersey-bom</artifactId>
      <version>${jersey.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Dependencies for embedded Grizzly example:

```xml
<dependencies>
  <dependency>
    <groupId>org.glassfish.jersey.core</groupId>
    <artifactId>jersey-server</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-grizzly2-http</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
  </dependency>
</dependencies>
```

Compile target:

```xml
<properties>
  <maven.compiler.release>21</maven.compiler.release>
</properties>
```

---

## 9. Thin Distribution Layout

Build output:

```text
case-api-dist/
├─ app/
│  └─ case-api.jar
├─ lib/
│  ├─ jersey-server.jar
│  ├─ jersey-hk2.jar
│  ├─ jersey-container-grizzly2-http.jar
│  ├─ jackson-databind.jar
│  └─ ...
├─ conf/
│  └─ application-defaults.properties
└─ bin/
   └─ start.sh
```

Why thin distribution?

```text
dependency inspection easier
SBOM mapping easier
Docker layering better
no shaded META-INF/services merge risk
debug classpath clearer
```

Production default:

```text
thin distribution > fat jar
```

unless strong single-jar reason exists.

---

## 10. Main Bootstrap

Conceptual bootstrap:

```java
public final class Main {

    public static void main(String[] args) throws Exception {
        AppConfig config = AppConfigLoader.load();
        config.validate();

        ResourceConfig resourceConfig = new ResourceConfig()
            .register(new DependencyBinder(config))
            .register(CorrelationIdFilter.class)
            .register(SecurityFilter.class)
            .register(RequestLogFilter.class)
            .register(GlobalExceptionMapper.class)
            .register(HealthResource.class)
            .register(CaseResource.class)
            .register(DocumentResource.class);

        Server server = ServerFactory.start(config.server(), resourceConfig);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.initiateGracefulShutdown();
        }, "shutdown-hook"));

        server.awaitTermination();
    }
}
```

Important:

```text
load config once
validate before serving
register resources/providers explicitly
install observability/security filters
support graceful shutdown
```

---

## 11. ResourceConfig Strategy

Use explicit registration for production clarity:

```java
new ResourceConfig()
    .register(CaseResource.class)
    .register(HealthResource.class)
    .register(GlobalExceptionMapper.class)
    .register(CorrelationIdFilter.class)
    .register(SecurityFilter.class);
```

Avoid broad scanning over huge packages:

```java
.packages("com.example")
```

unless team accepts startup cost and discovery ambiguity.

Benefits:

```text
predictable startup
easier migration
less accidental provider registration
better startup performance
```

---

## 12. Configuration Architecture

Sources:

```text
1. system properties
2. environment variables
3. mounted config file
4. packaged defaults
```

Config schema:

```text
APP_ENV
APP_PORT
APP_BIND_HOST
PUBLIC_BASE_URL
DB_URL
DB_USERNAME
DB_PASSWORD_FILE
DB_POOL_MAX
DB_POOL_CONNECTION_TIMEOUT_MS
DOCUMENT_SERVICE_BASE_URL
DOCUMENT_SERVICE_TIMEOUT_MS
JWT_ISSUER
JWT_AUDIENCE
JWKS_URL
CORS_ALLOWED_ORIGINS
LOG_LEVEL
```

Validation:

```text
required values present
port valid
URL valid
timeouts positive
prod forbids localhost DB/downstream
prod public URL must be HTTPS
CORS wildcard+credentials rejected
DB pool max within allowed budget
```

Startup should fail fast if invalid.

---

## 13. Secret Handling

Secrets:

```text
DB password
JWT client secret if any
private keys
API keys
truststore password
```

Do not put in:

```text
image
source code
ConfigMap
logs
command-line args
effective config response
```

Recommended:

```text
Kubernetes Secret mounted as file
or external secret manager integration
```

Example:

```text
DB_PASSWORD_FILE=/var/run/secrets/case-api/db-password
```

App reads:

```java
String password = Files.readString(Path.of(config.dbPasswordFile()));
```

Log only:

```text
DB_PASSWORD: PRESENT
```

---

## 14. Dockerfile

Thin distribution image:

```Dockerfile
FROM eclipse-temurin:21-jre

RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app

COPY lib/ /app/lib/
COPY app/case-api.jar /app/app.jar

RUN mkdir -p /app/tmp \
 && chown -R 10001:10001 /app

USER 10001

EXPOSE 8080

ENTRYPOINT [
  "java",
  "-XX:MaxRAMPercentage=65",
  "-Xlog:os+container=info",
  "-cp",
  "/app/app.jar:/app/lib/*",
  "com.example.caseapi.Main"
]
```

Production improvements:

```text
pin image tag/digest
SBOM
image scan
non-root
read-only root filesystem support
no secrets
stdout logs
```

---

## 15. Kubernetes Deployment

Core Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-api
  labels:
    app: case-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: case-api
        version: "1.0.0"
    spec:
      terminationGracePeriodSeconds: 45
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: app
          image: registry.example.com/case-api:1.0.0
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: case-api-config
          env:
            - name: DB_PASSWORD_FILE
              value: /var/run/secrets/case-api/db-password
          volumeMounts:
            - name: db-password
              mountPath: /var/run/secrets/case-api
              readOnly: true
            - name: tmp
              mountPath: /tmp
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
          startupProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 3
            failureThreshold: 60
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
      volumes:
        - name: db-password
          secret:
            secretName: case-api-secret
            items:
              - key: db-password
                path: db-password
        - name: tmp
          emptyDir:
            sizeLimit: 512Mi
```

---

## 16. Kubernetes Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-api
spec:
  selector:
    app: case-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

Service gives stable internal name:

```text
case-api.<namespace>.svc.cluster.local
```

Ensure selector matches Pod labels.

---

## 17. Ingress/API Gateway Contract

External route:

```text
https://api.example.com/case-api
```

Internal app route:

```text
/
```

Pattern:

```text
gateway strips /case-api prefix
backend receives /...
```

or preserve prefix.

Choose one.

For capstone:

```text
preserve external prefix at gateway?
```

We choose:

```text
gateway strips /case-api
app runs at root
PUBLIC_BASE_URL=https://api.example.com/case-api
```

Contract:

```text
external:
  /case-api/cases/{id}

backend:
  /cases/{id}

public URL generation:
  uses PUBLIC_BASE_URL
```

This avoids app needing internal context path but requires proxy rewrite correctness.

Document it.

---

## 18. Forwarded Headers

Gateway must set:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Request-ID
```

Gateway must strip incoming spoofed headers from external clients.

App behavior:

```text
trust forwarded headers only from gateway path
or use explicit PUBLIC_BASE_URL for external links
```

Audit:

```text
store direct peer and trusted client IP if needed
```

Do not trust raw `X-Forwarded-For` from internet.

---

## 19. Security Architecture

Authentication:

```text
API gateway validates JWT/OIDC at edge
app also validates token claims or receives signed identity assertion depending risk
```

Capstone recommendation:

```text
gateway performs coarse auth
app validates Authorization JWT for high assurance
```

App validates:

```text
signature
issuer
audience
expiry
algorithm
required scopes/claims
```

Authorization:

```text
@RolesAllowed for function-level guard
domain service enforces object-level authorization
DTO mapper enforces property-level authorization
```

Security boundary:

```text
Gateway auth does not replace domain authorization.
```

---

## 20. CORS and CSRF

If browser SPA calls API:

```text
CORS owner:
  gateway or app, choose one
```

Capstone choice:

```text
gateway handles CORS
app rejects unexpected origins only if needed
```

Rules:

```text
allowlist origins
no wildcard with credentials
OPTIONS preflight allowed
Authorization header allowed
```

CSRF:

```text
If using Authorization bearer header:
  CSRF risk lower

If using cookies:
  SameSite + CSRF token/origin checks needed
```

---

## 21. Request Security Limits

Set at gateway and app/server:

```text
max request body
max header size
timeout
rate limit
auth
```

Example:

```text
JSON body max:
  1MiB

upload endpoint:
  separate route/service or higher limit with explicit controls

page size:
  max 100/500

sort fields:
  allowlist
```

Prevent unrestricted resource consumption.

---

## 22. Threading Model

For embedded Grizzly/Jetty:

```text
request handled by server worker/request thread
blocking DB calls occupy request thread
```

Set:

```text
server worker/request threads:
  aligned with CPU and DB pool

DB pool:
  e.g. 20 per pod

HTTP client pool:
  per dependency

custom executors:
  bounded
```

Avoid:

```text
unbounded queue
common pool for blocking work
long synchronous reports
```

Long operations:

```text
convert to async job
```

---

## 23. Connection, Timeout, Backpressure Design

Timeout budget:

```text
gateway:
  14s

app request budget:
  12s

DB query:
  5s

DB connection acquisition:
  250ms

document-service call:
  2s

queue wait:
  <= 100ms
```

DB pool:

```text
DB_POOL_MAX=20
max replicas=10
total max DB connections=200
DBA-approved budget required
```

Downstream document-service:

```text
max connections per pod:
  20

circuit breaker:
  opens on high failure/slow-call rate

retry:
  at most 1 retry for idempotent GET with jitter
```

Overload response:

```text
503 SERVICE_OVERLOADED
Retry-After if appropriate
```

---

## 24. Observability Architecture

Signals:

```text
structured logs
access logs at gateway
request ID
OpenTelemetry traces
HTTP metrics
JVM metrics
DB pool metrics
HTTP client metrics
circuit breaker metrics
Kubernetes events
business metrics
audit logs
```

Log fields:

```text
service
version
environment
requestId
traceId
spanId
method
route
status
durationMs
errorCode
safePrincipal
```

Metrics:

```text
http.server.requests
db.pool.active
db.pool.pending
document.client.latency
jvm.memory.used
jvm.gc.pause
executor.queue.size
circuit.state
k8s.restarts
```

Traces:

```text
gateway span
server span
resource/service span
DB span
document-service span
```

Dashboards:

```text
service overview
endpoint latency/errors
dependencies
JVM
Kubernetes
security/auth
business workflows
```

---

## 25. Health Architecture

Endpoints:

```text
GET /health/live
GET /health/ready
GET /health/started
```

Liveness:

```text
process/event loop/server responsive
does not check ordinary DB outage
```

Readiness:

```text
config valid
app initialized
critical local resources ready
not shutting down
maybe DB available if every request requires DB
```

Startup:

```text
boot completed
```

Readiness should go false during shutdown.

Do not expose sensitive details publicly.

---

## 26. Graceful Shutdown

Sequence:

```text
SIGTERM received
  ↓
mark readiness false
  ↓
stop accepting new requests
  ↓
drain in-flight requests
  ↓
close server
  ↓
close DB pool
  ↓
close HTTP clients
  ↓
flush telemetry/logs
  ↓
exit before terminationGracePeriodSeconds
```

Kubernetes:

```text
terminationGracePeriodSeconds=45
maxUnavailable=0
maxSurge=1
```

Test:

```text
kubectl delete pod under load
rolling update under load
docker stop
```

---

## 27. Failure Mode Readiness

Startup failure controls:

```text
Java version log
config validation
dependency artifact inspection
provider smoke tests
startupProbe
clear error logs
```

Runtime failure controls:

```text
timeouts
bulkheads
circuit breakers
bounded queues
load shedding
metrics/alerts
```

Redeploy failure controls:

```text
immutable image rollout
old/new DB compatibility
no hot redeploy in same JVM
rollback image
```

Shutdown failure controls:

```text
SIGTERM
readiness false
drain
bounded shutdown
thread dump if stuck
```

---

## 28. Performance Architecture

Targets:

```text
p95 < 200ms case detail
p99 < 750ms normal CRUD
startup readiness < 60s
```

Performance design:

```text
explicit resource registration
thin distribution
Java 21 JRE
MaxRAMPercentage=65
DB pool=20 per pod
server threads sized by load test
JSON DTOs only
pagination max enforced
no entity serialization
structured logs without body logging
OpenTelemetry sampled traces
```

Test:

```text
cold start
warm steady-state
burst
slow DB
downstream timeout
rolling update under load
CPU throttling
memory pressure
```

---

## 29. Artifact and Supply Chain

Build:

```text
reproducible artifact
dependency lock/BOM
SBOM
checksums
image scan
artifact inspection
```

Artifact checks:

```text
no javax.ws.rs in jakarta app
no duplicate Jersey versions
no secrets
META-INF/services okay
JSON provider present
Main class present
```

Release metadata:

```text
app version
git commit
build time
image digest
SBOM reference
config version
```

Promotion:

```text
same image DEV → UAT → PROD
different config/secrets
```

---

## 30. Kubernetes Availability

Replicas:

```text
min replicas:
  3
```

PDB:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: case-api
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: case-api
```

Topology spread:

```text
spread across nodes/zones where possible
```

HPA:

```text
start with CPU/RPS
consider custom queue/latency metrics
ensure max replicas does not exceed DB/downstream budgets
```

Autoscaling cannot fix database bottleneck.

---

## 31. Network and Platform Security

Security context:

```text
runAsNonRoot
allowPrivilegeEscalation=false
readOnlyRootFilesystem=true
drop capabilities
```

NetworkPolicy:

```text
ingress only from gateway/ingress namespace
egress only DB, DNS, document-service, telemetry collector
```

Service account:

```text
automountServiceAccountToken=false
```

unless Kubernetes API access needed.

Secrets:

```text
mounted files
RBAC restricted
rotation procedure
```

---

## 32. Database Integration

Use DataSource pool.

Config:

```text
DB_URL
DB_USERNAME
DB_PASSWORD_FILE
DB_POOL_MAX
DB_POOL_CONNECTION_TIMEOUT_MS
DB_QUERY_TIMEOUT_MS
```

Rules:

```text
pool size by max replicas
connection acquisition timeout short
query timeout set
transactions bounded
no long report query in request thread
migration outside app or controlled job
```

Observability:

```text
active
idle
pending
acquire duration
query latency
transaction duration
```

---

## 33. Downstream HTTP Integration

Document-service client:

```text
base URL from config
connect timeout 500ms
call timeout 2s
max connections 20
circuit breaker
retry only idempotent GET
request ID propagated
trace propagated
```

Security:

```text
TLS verification on
audience-specific token or service credential
no user token forwarded blindly
```

Observability:

```text
latency
status
timeout
retry
circuit state
pool wait
```

---

## 34. DTO and API Contract

External API uses DTOs:

```text
request DTO
response DTO
error DTO
```

Never expose:

```text
JPA entities
internal exceptions
security-sensitive fields
```

Error format:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "requestId": "..."
}
```

Version API deliberately:

```text
/case-api/v1/...
```

or gateway versioning if chosen.

OpenAPI generated/maintained with correct public server URL.

---

## 35. Audit Architecture

Audit actions:

```text
case viewed
case created
case updated
case approved
case exported
authorization denied
admin config/security change
```

Audit fields:

```text
timestamp
principal
action
object type/id
outcome
reason
requestId
trusted client IP
version
```

Audit storage:

```text
separate append-oriented store/table/log pipeline
retention policy
tamper-resistance if required
```

Audit is not debug logging.

---

## 36. CI/CD Pipeline

Pipeline:

```text
1. compile
2. unit tests
3. static checks
4. dependency convergence
5. vulnerability scan
6. package thin distribution
7. artifact inspection
8. integration tests
9. build image
10. image scan/SBOM
11. smoke test image
12. push immutable image
13. deploy DEV
14. run smoke/contract tests
15. promote UAT
16. promote PROD via canary/rolling update
```

Quality gates:

```text
no critical CVE without exception
tests pass
artifact generation clean
no secret scan finding
image startup smoke passes
```

---

## 37. Smoke Test Script

Minimum smoke:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"

curl -fsS "$BASE_URL/health/live"
curl -fsS "$BASE_URL/health/ready"

curl -fsS "$BASE_URL/cases/test-id" \
  -H "Authorization: Bearer $TEST_TOKEN"

curl -fsS -X POST "$BASE_URL/cases" \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Smoke Test"}'
```

In real systems:

```text
avoid creating permanent business data
use test tenant/environment
cleanup or idempotent test endpoint
```

---

## 38. Runbook

Runbook sections:

```text
startup failure
readiness failure
500 spike
503 spike
504 spike
OOMKilled
thread pool exhaustion
DB pool exhaustion
downstream outage
auth/JWKS failure
rollback
secret rotation
certificate expiry
thread dump
heap dump
JFR capture
```

Every section should include:

```text
symptoms
commands
dashboards
likely causes
safe actions
escalation owner
```

Runbook is part of deployment architecture.

---

## 39. Rollback Plan

Rollback requires:

```text
previous image digest
previous config version
DB backward compatibility
message/cache compatibility
gateway route rollback
Kubernetes rollout undo or redeploy old spec
```

Command:

```bash
kubectl rollout undo deployment/case-api
```

But this is insufficient if DB/config incompatible.

Design migrations:

```text
expand-contract
backward-compatible writes
feature flags
```

---

## 40. Migration Readiness

Current target:

```text
Jersey 3.1.x
jakarta.*
Java 21
```

Future:

```text
Jersey 4 / Jakarta EE 11
```

Prepare:

```text
BOM centralized
no direct dependency version sprawl
no mixed javax/jakarta
artifact inspection
contract tests
server/runtime documented
source imports clean
deployment descriptors minimal
```

Future migration should be deliberate, not emergency.

---

## 41. Alternative Architecture: Tomcat WAR

If organization standardizes Tomcat:

```text
case-api.war
  ↓
Tomcat 10.1 image
  ↓
Kubernetes
```

Changes:

```text
Servlet API provided
Jersey servlet container packaged
Tomcat connector/thread config
RemoteIpValve
Tomcat access logs
WAR context path
```

Still same principles:

```text
config validation
security
observability
timeouts
backpressure
probes
shutdown
artifact inspection
```

Only runtime ownership changes.

---

## 42. Alternative Architecture: Open Liberty

If organization wants Jakarta EE/MicroProfile:

```text
case-api.war
server.xml
Open Liberty image
Kubernetes
```

Benefits:

```text
MicroProfile Health/Config/Metrics
feature-based runtime
server-managed datasource
Jakarta EE integration
```

Design changes:

```text
server.xml as code
features selected
datasource defined in server config
health/metrics endpoint protection
server logs/FFDC handling
```

Same capstone principles apply.

---

## 43. Alternative Architecture: Payara/GlassFish

If full Jakarta EE server needed:

```text
domain config
JDBC/JMS resources
WAR/EAR
Payara/GlassFish image
```

Requirements:

```text
asadmin provisioning
secure admin
server monitoring
resource ownership
dependency scopes
domain config drift control
```

Use when platform services are valuable.

Avoid for simple microservice unless org standard.

---

## 44. Architecture Review Checklist

Before approval:

```text
[ ] Runtime choice documented.
[ ] Namespace generation coherent.
[ ] Artifact layout documented.
[ ] Dependency ownership clear.
[ ] Docker image secure and reproducible.
[ ] Kubernetes probes/resources defined.
[ ] Proxy path rewrite contract documented.
[ ] Forwarded header trust model defined.
[ ] Config schema and precedence documented.
[ ] Secrets externalized.
[ ] Auth/authz model documented.
[ ] Observability signals defined.
[ ] Timeout/backpressure design defined.
[ ] Performance SLO and test plan defined.
[ ] Failure modes/runbook defined.
[ ] Rollback plan defined.
[ ] Migration readiness documented.
```

---

## 45. Final Production Checklist

```text
BUILD & ARTIFACT
[ ] Java --release set.
[ ] Jersey BOM used.
[ ] Dependency convergence enforced.
[ ] No mixed javax/jakarta.
[ ] Final artifact inspected.
[ ] SBOM generated.
[ ] Image scanned.
[ ] No secrets in artifact/image.

RUNTIME
[ ] Runtime choice documented.
[ ] Server version pinned.
[ ] JVM flags defined.
[ ] Non-root container.
[ ] Resource requests/limits set.
[ ] Graceful shutdown tested.

CONFIG
[ ] Config schema documented.
[ ] Config validation fail-fast.
[ ] Secrets mounted/managed safely.
[ ] Effective config redacted/logged.
[ ] Config rollout/rollback defined.

NETWORK
[ ] Service/Ingress path contract documented.
[ ] Forwarded headers configured safely.
[ ] TLS boundary defined.
[ ] Timeout chain aligned.
[ ] Body/header limits set.

SECURITY
[ ] JWT/OIDC validation correct.
[ ] Domain authorization enforced.
[ ] CORS/CSRF/cookies handled.
[ ] NetworkPolicy/RBAC/securityContext applied.
[ ] Audit logging implemented.

OBSERVABILITY
[ ] Structured logs.
[ ] Request ID and trace context.
[ ] HTTP metrics.
[ ] JVM metrics.
[ ] DB/HTTP client metrics.
[ ] Traces.
[ ] Dashboards.
[ ] Alerts.
[ ] Thread dump/JFR procedure.

RELIABILITY
[ ] Health/live/ready/started.
[ ] Startup/liveness/readiness probes.
[ ] DB pool sized by max replicas.
[ ] Downstream bulkheads.
[ ] Circuit breaker/retry policy.
[ ] Load shedding.
[ ] Graceful termination.
[ ] Rolling update tested.

PERFORMANCE
[ ] SLO defined.
[ ] Load test realistic.
[ ] Cold/warm behavior measured.
[ ] p95/p99 monitored.
[ ] CPU/memory limits tested.
[ ] GC/allocation profiled if needed.

OPERATIONS
[ ] Runbook complete.
[ ] Rollback tested.
[ ] Secret rotation documented.
[ ] Cert expiry monitored.
[ ] Incident diagnostics available.
[ ] Ownership matrix documented.
```

---

## 46. What “Top-Tier Jersey Deployment” Means

It does **not** mean:

```text
using the fastest server
using the newest Java
using Kubernetes
using Netty
using every security feature
using the biggest app server
```

It means:

```text
the deployment model matches the problem
runtime ownership is clear
artifact is reproducible
configuration is validated
secrets are protected
traffic path is explicit
security boundaries are correct
observability is complete
performance is measured
failure modes are controlled
rollback is possible
migration path is known
team can operate it under pressure
```

That is the standard.

---

## 47. Final Mental Model of the Whole Series

A Jersey deployment is the composition of:

```text
API namespace:
  javax or jakarta

runtime:
  Servlet, embedded, Netty, Jakarta EE server

artifact:
  WAR, thin jar, fat jar, image

classpath:
  dependency ownership, provider discovery

server:
  threads, connections, lifecycle

platform:
  Docker/Kubernetes/proxy/gateway

configuration:
  typed, validated, externalized

security:
  TLS, auth, authorization, secrets

observability:
  logs, metrics, traces, health, diagnostics

reliability:
  timeouts, pools, backpressure, shutdown

performance:
  workload, p99, GC, CPU/memory, profiling

migration:
  generation alignment and compatibility
```

Every production incident usually comes from one of these contracts being unclear or broken.

---

## 48. Series Completion

This is the final part:

```text
Part 32 — Capstone: Designing a Top-Tier Jersey Deployment Architecture
```

The series is now complete.

Recommended next step after finishing this series:

```text
Build a complete hands-on lab:
  1. Jersey 3.1 embedded service
  2. Thin distribution
  3. Docker image
  4. Kubernetes manifests
  5. Ingress path rewrite
  6. JWT validation
  7. DB pool
  8. OpenTelemetry
  9. Load test
  10. Failure injection
  11. Migration checklist
```

This turns conceptual mastery into operational skill.

---

## References

- Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Jersey 3.x Migration Guide: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/migration.html
- Kubernetes documentation — Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes documentation — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Kubernetes documentation — Configure a Security Context for a Pod or Container: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
- OpenTelemetry Java documentation: https://opentelemetry.io/docs/languages/java/
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP TLS Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
- Apache Tomcat 10.1 HTTP Connector Configuration Reference: https://tomcat.apache.org/tomcat-10.1-doc/config/http.html
- Open Liberty Jakarta EE overview: https://openliberty.io/docs/latest/jakarta-ee.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-031.md">⬅️ Part 31 — Production Deployment Patterns and Decision Framework</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<span></span>
</div>
