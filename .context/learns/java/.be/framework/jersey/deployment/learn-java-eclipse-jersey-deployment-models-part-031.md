# learn-java-eclipse-jersey-deployment-models-part-031  
# Part 31 — Production Deployment Patterns and Decision Framework

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 31 dari 32**  
> Target pembaca: engineer Java backend yang ingin mengambil keputusan deployment Jersey secara rasional, bukan berdasarkan preferensi framework/server semata.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: decision framework, WAR vs embedded, Tomcat vs Jetty vs Grizzly vs Netty vs Open Liberty vs Payara/GlassFish, Docker/Kubernetes, operational ownership, security, observability, performance, migration risk, dan production pattern selection.

---

## 1. Mengapa Decision Framework Dibutuhkan?

Setelah mempelajari banyak deployment model, pertanyaan akhirnya bukan:

```text
Mana yang terbaik?
```

Tetapi:

```text
Mana yang paling tepat untuk constraints kita?
```

Karena deployment Jersey dipengaruhi oleh:

```text
team skill
ops maturity
runtime ownership
security policy
Jakarta EE requirements
container/Kubernetes adoption
startup time
throughput/latency SLO
dependency model
migration path
debugging capability
organizational standard
cloud/platform constraints
```

Satu runtime bisa excellent untuk satu organisasi, tetapi buruk untuk organisasi lain.

Top-tier mental model:

> Deployment model adalah trade-off architecture.  
> Pilihan terbaik adalah yang membuat ownership, lifecycle, security, observability, performance, dan migration risk paling jelas untuk konteks tertentu.

---

## 2. The Big Decision: Who Owns the Runtime?

Pertanyaan pertama:

```text
Siapa yang memiliki HTTP runtime dan platform services?
```

Pilihan besar:

### Application-Owned Runtime

Aplikasi membawa server sendiri.

Examples:

```text
Embedded Grizzly
Embedded Jetty
Netty
JDK HTTP Server
fat jar / thin jar
```

App owns:

```text
server version
Jersey version
threading
TLS/proxy assumptions
startup/shutdown
dependency versions
```

### Container-Owned Runtime

External server menjalankan WAR.

Examples:

```text
Tomcat
Jetty external
GlassFish/Payara
Open Liberty
WildFly
```

Server owns:

```text
HTTP connector
servlet runtime
thread pool
resources
classloader
deployment lifecycle
some Jakarta APIs
```

### Platform-Owned Runtime

Kubernetes/cloud/gateway/mesh owns more lifecycle.

Examples:

```text
Docker image
Kubernetes Deployment
Ingress/Gateway
Service mesh
managed platform
```

Platform owns:

```text
replicas
rollout
probes
traffic routing
resource limits
secrets/config
network policy
```

Most production systems combine all three in different degrees.

---

## 3. Decision Axis 1 — Runtime Ownership

Ask:

```text
Do we want to own server version in the app?
Do platform teams standardize Tomcat/Liberty/Payara?
Do we need Jakarta EE server-managed resources?
Do we want one jar per service?
Do we need app server admin model?
```

If app team is strong and platform is container-first:

```text
embedded/thin jar + Docker/Kubernetes can be ideal
```

If organization standardizes server runtime:

```text
WAR on Tomcat/Liberty/Payara may be better
```

If app needs full Jakarta EE:

```text
Open Liberty/Payara/GlassFish/WildFly style deployment may fit
```

If app needs low-level network control:

```text
Netty or embedded Jetty may fit
```

---

## 4. Decision Axis 2 — Jakarta EE Feature Need

Do you need:

```text
CDI
JTA transactions
JPA integration
server-managed datasource
Jakarta Security
Bean Validation integration
JMS
Batch
Concurrency
Mail
full platform services
```

If yes, consider:

```text
Open Liberty
Payara/GlassFish
WildFly
other Jakarta EE server
```

If no, and app is mostly REST + DB + HTTP clients:

```text
Tomcat + Jersey
Embedded Jersey
Jetty
Docker/Kubernetes
```

Avoid full Jakarta EE server if you only need simple REST and it increases operational overhead.

Avoid plain embedded runtime if you actually need managed platform services.

---

## 5. Decision Axis 3 — Servlet Requirement

Jersey can run:

```text
inside Servlet container
outside Servlet container
```

Servlet helps with:

```text
standard WAR deployment
filters
servlet security
server session/cookie handling
traditional app server integration
Tomcat/Jetty/Liberty/Payara support
```

Non-servlet/embedded helps with:

```text
simple executable service
custom lifecycle
smaller footprint
app-owned runtime
cloud-native packaging
Netty/JDK HTTP/Grizzly-specific model
```

If your organization already has servlet filters/security/infrastructure:

```text
Servlet deployment may reduce integration work
```

If you want microservice executable image:

```text
embedded may reduce server ops complexity
```

---

## 6. Decision Axis 4 — Operational Maturity

Ask:

```text
Can the team debug thread dumps?
Can the team tune JVM in containers?
Can the team manage Docker/Kubernetes manifests?
Can the team operate app server resources?
Can the team interpret gateway logs?
Can the team patch base images/server runtimes?
Can the team handle mTLS/secret rotation?
```

A technically elegant model can fail if ops maturity is missing.

Examples:

```text
Netty:
  powerful but requires event-loop discipline

Payara/GlassFish:
  powerful but requires server/admin/resource knowledge

Kubernetes:
  powerful but requires probes/resources/rollout knowledge

Embedded jar:
  simple packaging but app team owns everything
```

Choose what your team can operate during incidents.

---

## 7. Decision Axis 5 — Security Ownership

Who owns:

```text
TLS termination
mTLS
authentication
JWT validation
authorization
CORS
rate limiting
WAF
secret management
network policy
audit
```

If gateway owns auth, app must still own domain authorization.

If app trusts gateway identity headers, platform must prevent bypass and spoofing.

If server owns security realm, app must integrate with it.

If embedded app owns everything, app must implement/validate everything.

Security ownership must be explicit.

---

## 8. Decision Axis 6 — Observability Requirements

Ask:

```text
Do we need JMX?
Do we need MicroProfile Metrics?
Do we use OpenTelemetry?
Do we need server-managed metrics?
Do we need platform dashboards?
Do we need event-loop metrics?
Do we need audit logs?
```

Observability by deployment model:

```text
Tomcat:
  access logs/JMX/connectors

Jetty:
  request logs/thread pool metrics/JMX if configured

Open Liberty:
  MicroProfile Health/Metrics friendly

Payara/GlassFish:
  server-managed monitoring/admin tooling

Embedded:
  must add app metrics explicitly

Netty:
  must add event-loop/direct memory metrics

Kubernetes:
  pod/probe/resource events
```

Choose runtime whose observability matches ops environment.

---

## 9. Decision Axis 7 — Performance Profile

Performance-sensitive questions:

```text
Startup time important?
p99 latency strict?
High connection count?
Blocking DB-heavy REST?
Large uploads/downloads?
Streaming/SSE/WebSocket?
CPU-heavy JSON/reporting?
Memory-constrained containers?
```

Common mapping:

```text
Simple blocking REST + DB:
  Tomcat/Jetty/Liberty/embedded Grizzly all viable

High connection/event-driven:
  Netty or Jetty may fit, but avoid blocking event loops

Full Jakarta EE transaction/resource use:
  Liberty/Payara/WildFly

Minimal internal service:
  embedded Grizzly/JDK HTTP may fit if ops added

Kubernetes-native service:
  thin jar or WAR in server image, with probes/resources
```

Measure with realistic workload.

Do not choose by benchmark folklore.

---

## 10. Decision Axis 8 — Deployment Frequency

If app deploys frequently:

```text
immutable Docker image
rolling update
fast startup
clear readiness
same artifact promotion
```

becomes important.

If app deploys rarely but many apps share server:

```text
WAR on managed app server may be acceptable
```

Hot redeploy can be convenient, but classloader leak risk exists.

Cloud-native pattern prefers:

```text
replace process/pod rather than hot-redeploy in same JVM
```

For high-frequency deployment, process replacement often wins.

---

## 11. Decision Axis 9 — Migration Risk

Current state matters.

Examples:

```text
Legacy Jersey 2 javax WAR on Tomcat 9:
  Tomcat 9 WAR may be best short-term.
  Jersey 3 migration requires jakarta/server shift.

Existing Payara app with JPA/JTA/JMS:
  embedded migration is high risk.

Simple Jersey 2 embedded Grizzly:
  Jersey 3/4 embedded upgrade easier.

Org moving to Kubernetes:
  Docker image + probes/resources is required regardless runtime.
```

Decision framework must include transition cost, not only target elegance.

---

## 12. Decision Axis 10 — Standardization vs Specialization

Standardization benefits:

```text
shared ops knowledge
shared dashboards
shared base images
shared security controls
simpler onboarding
faster incident response
```

Specialization benefits:

```text
optimized runtime
better fit for unusual workload
more control
less unnecessary platform overhead
```

Rule:

```text
Default to platform standard unless strong workload/ownership reason exists.
```

Special runtimes need special runbooks.

---

## 13. Pattern 1 — Classic WAR on Tomcat

### Shape

```text
Jersey WAR
  ↓
Tomcat
  ↓
Docker/VM/Kubernetes optional
```

### Best When

```text
simple REST API
servlet filters/security needed
Tomcat is org standard
team knows Tomcat
app does not need full Jakarta EE
```

### Strengths

```text
mature
simple servlet model
wide operational knowledge
good tooling/logging
clear WAR packaging
```

### Risks

```text
dependency scope mistakes
javax/jakarta generation mismatch
thread pool exhaustion
limited Jakarta EE platform services
hot redeploy leaks if used
```

### Production Checklist

```text
Tomcat version matches namespace
RemoteIpValve/proxy configured
maxThreads/acceptCount tuned
access logs enabled
Jersey dependencies packaged correctly
servlet API provided
context path explicit
```

---

## 14. Pattern 2 — WAR on External Jetty

### Shape

```text
Jersey WAR
  ↓
Jetty
```

### Best When

```text
team prefers Jetty
need flexible server config
need modern Jetty deployment environments
want standalone server but lighter than full EE
```

Jetty 12 documentation states it supports deployment of Jakarta EE 9 to 11 web applications using `jakarta.*` packages and Java EE 8 web applications using `javax.*` packages.

### Strengths

```text
flexible
efficient
modern threading options
good embedded/external story
```

### Risks

```text
module/environment configuration complexity
thread pool tuning required
less common than Tomcat in some orgs
```

### Production Checklist

```text
EE environment selected correctly
JETTY_BASE versioned
thread pool metrics enabled
request logs configured
context path explicit
```

---

## 15. Pattern 3 — Embedded Grizzly Jersey Service

### Shape

```text
java -jar app.jar
  ↓
Grizzly HTTP server
  ↓
Jersey
```

### Best When

```text
Jersey-native app
small/medium REST service
app team wants simple executable
no full Servlet/Jakarta EE need
containerized microservice
```

### Strengths

```text
simple
Jersey-friendly
small runtime
easy local run
no external app server
```

### Risks

```text
app owns server lifecycle
less standard ops tooling
must add metrics/logging/shutdown
thread/worker tuning required
```

### Production Checklist

```text
explicit lifecycle
health endpoints
graceful shutdown
metrics added
thread pool sized
Docker/Kubernetes probes configured
```

---

## 16. Pattern 4 — Embedded Jetty Service

### Shape

```text
java -jar app.jar
  ↓
Jetty embedded
  ↓
Jersey servlet or handler integration
```

### Best When

```text
need servlet features but executable service
want Jetty flexibility
want app-owned runtime
possibly virtual-thread experiments
```

### Strengths

```text
powerful embedded server
servlet support
flexible config
mature HTTP stack
```

### Risks

```text
embedding complexity
must own configuration
thread pool tuning
lifecycle/shutdown responsibility
```

### Production Checklist

```text
explicit QueuedThreadPool config
request logs/metrics
servlet mapping tested
graceful shutdown
server config not hidden in code
```

---

## 17. Pattern 5 — Netty-Based Jersey

### Shape

```text
Netty event loops
  ↓
Jersey Netty container
  ↓
resources
```

### Best When

```text
high connection concurrency
event-driven integration
Netty expertise exists
custom network behavior needed
```

### Strengths

```text
efficient I/O
fine-grained network control
high concurrency potential
```

### Risks

```text
blocking on event loop catastrophic
harder debugging
offload executor required for blocking code
direct memory/event-loop metrics needed
less typical Jersey production path
```

### Production Checklist

```text
prove resource execution thread
no blocking event loop
bounded offload executor
event-loop lag metric
direct memory budget
thread dumps practiced
```

---

## 18. Pattern 6 — JDK HTTP Server Minimal Service

### Shape

```text
JDK HttpServer
  ↓
Jersey adapter
```

### Best When

```text
small internal tools
test utilities
lightweight admin endpoints
controlled low-traffic services
```

### Strengths

```text
minimal dependency
simple
JDK-provided
```

### Risks

```text
limited production features
must configure executor
observability manual
not ideal for complex public APIs
```

### Production Checklist

```text
explicit executor
bounded queue
health/logging/metrics added
timeouts considered
not used accidentally for high-risk public service
```

---

## 19. Pattern 7 — Open Liberty Feature-Based Runtime

### Shape

```text
WAR
  ↓
Open Liberty server.xml features
  ↓
Jakarta EE/MicroProfile runtime
```

Open Liberty documentation states Jakarta EE support can be added through Web Profile or Jakarta EE Platform convenience features in `server.xml`, and Liberty features are the units of functionality controlling pieces of runtime loaded into a server.

### Best When

```text
need Jakarta EE/MicroProfile
want feature-based lightweight server
Kubernetes/cloud-native server packaging
want MicroProfile Health/Metrics/Config
enterprise support/standardization
```

### Strengths

```text
feature-based
cloud-friendly
MicroProfile integration
good health/metrics model
server config as code
```

### Risks

```text
feature selection/versioning
server.xml ownership
startup/config complexity
platform learning curve
```

### Production Checklist

```text
server.xml versioned
only needed features enabled
health/metrics endpoints configured
datasource/security explicit
Docker image hardened
Kubernetes probes aligned
```

---

## 20. Pattern 8 — Payara/GlassFish Full Jakarta EE Runtime

### Shape

```text
WAR/EAR
  ↓
Payara/GlassFish domain/server
  ↓
Jakarta EE platform services
```

### Best When

```text
full Jakarta EE platform needed
JTA/JPA/JMS/CDI/server resources
org standardizes Payara/GlassFish
admin/domain model desired
```

### Strengths

```text
complete platform
server-managed resources
Jakarta EE alignment
admin tooling
enterprise patterns
```

### Risks

```text
heavier runtime
domain config drift
server dependency ownership
admin console/manual config risk
startup/resource complexity
```

### Production Checklist

```text
domain/asadmin config as code
JDBC/JMS resources scripted
secure admin
server logs/monitoring configured
dependency scopes provided correctly
Docker/Kubernetes image strategy clear
```

---

## 21. Pattern 9 — Dockerized Embedded Service

### Shape

```text
JRE image
  ↓
thin distribution or fat jar
  ↓
embedded Jersey runtime
```

### Best When

```text
microservice model
app team owns runtime
Kubernetes/cloud deployment
simple service boundary
CI/CD image promotion
```

### Strengths

```text
immutable artifact
same image across environments
app-owned dependencies
simple rollout
good with Kubernetes
```

### Risks

```text
JVM cgroup tuning
image security
signal handling
non-root filesystem
probes/resources
app owns observability/security/lifecycle
```

### Production Checklist

```text
non-root
exec entrypoint
MaxRAMPercentage tuned
health/readiness
stdout logs
SBOM/image scan
resource limits tested
same image promoted
```

---

## 22. Pattern 10 — Dockerized WAR Server Image

### Shape

```text
Tomcat/Jetty/Liberty/Payara image
  ↓
WAR
```

### Best When

```text
server runtime standard exists
WAR deployment desired
Kubernetes deployment needed
platform team owns server base image
```

### Strengths

```text
server standardization
container immutability
familiar WAR model
platform-managed patching possible
```

### Risks

```text
base image/server drift
context path/probe mistakes
server config hidden in image
dependency ownership confusion
```

### Production Checklist

```text
server image pinned
WAR context explicit
server config versioned
health path tested
logs to stdout
non-root if possible
resource limits tested
```

---

## 23. Pattern 11 — Kubernetes-Orchestrated Jersey Service

### Shape

```text
Container image
  ↓
Deployment
  ↓
Service
  ↓
Ingress/Gateway
```

### Best When

```text
org has Kubernetes platform
need rolling updates/scaling
need declarative config/secrets
need service discovery
need standardized deployment
```

### Strengths

```text
orchestration
replicas
rollouts
self-healing
config/secrets integration
resource control
```

### Risks

```text
probe misconfiguration
resource limit mistakes
DB pool * replicas overload
shutdown issues
HPA scaling bottleneck downstream
Kubernetes complexity
```

### Production Checklist

```text
startup/liveness/readiness correct
resources sized
termination tested
PDB/topology considered
HPA capacity validated
ConfigMap/Secret rollout strategy
NetworkPolicy/RBAC/securityContext
```

---

## 24. Pattern 12 — Serverless/Function-Like Jersey

Jersey is not usually ideal as a function runtime, but sometimes wrapped in platform-specific serverless/container environments.

Best when:

```text
low/irregular traffic
startup acceptable
platform constraints force it
API surface small
```

Risks:

```text
cold start
JVM startup
connection pooling across invocations
runtime lifecycle mismatch
observability constraints
vendor-specific integration
```

Usually consider:

```text
lighter framework/runtime
native image-ready stack
or container service instead
```

for heavy Jersey apps.

---

## 25. Decision Tree — First Pass

Start:

```text
Do you need full Jakarta EE server services?
```

If yes:

```text
Open Liberty / Payara / GlassFish / WildFly
```

If no:

```text
Do you need Servlet/WAR ecosystem?
```

If yes:

```text
Tomcat or Jetty
```

If no:

```text
Do you want app-owned executable service?
```

If yes:

```text
Embedded Grizzly/Jetty/JDK/Netty
```

Then:

```text
Are you deploying to Kubernetes?
```

If yes:

```text
Docker image + probes/resources/security/observability
```

Then:

```text
Do you need high event-driven connection handling?
```

If yes and team has expertise:

```text
Netty/Jetty advanced
```

Otherwise:

```text
Servlet/Grizzly/Liberty patterns are likely safer
```

---

## 26. Decision Tree — Namespace Generation

Ask:

```text
Are you on javax or jakarta?
```

If `javax`:

```text
Jersey 2.x
Tomcat 9
Java EE/Jakarta EE 8 generation
Jetty EE8 environment
```

If `jakarta`:

```text
Jersey 3.x/4.x
Tomcat 10+
Jakarta EE 9/10/11 generation
Jetty EE9/10/11 environment
modern Liberty/Payara/GlassFish
```

Never mix.

If migration planned:

```text
treat namespace as deployment generation boundary
```

---

## 27. Decision Tree — Artifact Shape

Ask:

```text
External server?
```

If yes:

```text
WAR
```

Ask:

```text
Embedded executable?
```

If yes:

```text
thin distribution or fat jar
```

For production embedded:

```text
thin distribution often better for dependency transparency and Docker layering
```

For simple tool/demo:

```text
fat jar acceptable if services merged correctly
```

For Docker:

```text
layer dependencies and app separately where possible
```

For full server:

```text
server config + WAR + resource provisioning must be release artifact
```

---

## 28. Decision Tree — Team Ownership

If app team owns everything:

```text
embedded + Docker/Kubernetes can be fast and clear
```

If platform team owns server runtime:

```text
WAR on standardized server image can be better
```

If security team owns gateway/auth:

```text
document identity propagation and app authorization boundary
```

If DBA owns server datasources:

```text
server-managed datasource may be required
```

Deployment choice must match organizational ownership.

Architecture that ignores ownership fails operationally.

---

## 29. Runtime Comparison Table

| Runtime | Best Fit | Avoid When |
|---|---|---|
| Tomcat | simple Servlet REST, org standard | need full Jakarta EE |
| Jetty | flexible servlet/embedded, modern server tuning | team lacks Jetty ops knowledge |
| Grizzly | Jersey-native embedded service | need rich app-server ops features |
| JDK HTTP | simple internal/minimal service | public complex production API |
| Netty | high connection/event-driven workloads | blocking DB-heavy app without offload expertise |
| Open Liberty | Jakarta EE/MicroProfile cloud-native | team wants zero server config |
| Payara/GlassFish | full Jakarta EE/domain model | simple microservice with no EE features |
| Docker embedded | app-owned microservice | app team cannot own JVM/container ops |
| Docker WAR | standardized server image | dependency/server ownership unclear |
| Kubernetes | orchestrated services | team lacks probe/resource/rollout maturity |

---

## 30. Pattern Selection Examples

### Example A — Simple Internal REST + DB

Context:

```text
small team
Kubernetes available
no full Jakarta EE
blocking DB calls
```

Recommended:

```text
Embedded Grizzly or Tomcat WAR in Docker
```

Avoid:

```text
Netty unless team has event-loop expertise
full Payara unless platform standard
```

### Example B — Enterprise App with JTA/JPA/JMS

Context:

```text
transactions
JMS
server-managed resources
Jakarta EE standard
```

Recommended:

```text
Open Liberty or Payara/GlassFish/WildFly
```

Avoid:

```text
plain embedded app unless replacing platform services deliberately
```

### Example C — High-Concurrency Streaming Gateway

Context:

```text
many connections
streaming/low-level network handling
custom protocol behavior
```

Recommended:

```text
Netty or Jetty advanced
```

Requires:

```text
no blocking event loop
strong observability
direct memory/event loop metrics
```

### Example D — Legacy Jersey 2 WAR

Context:

```text
javax app
Tomcat 9
stable production
migration not urgent
```

Recommended short-term:

```text
stabilize Tomcat 9 + Jersey 2
build migration plan
```

Avoid:

```text
drop into Tomcat 10 without namespace migration
```

### Example E — Cloud-Native Jakarta REST with MicroProfile

Context:

```text
Kubernetes
health/metrics/config standard
Jakarta APIs
```

Recommended:

```text
Open Liberty with required features
```

---

## 31. Production Pattern: Stable Servlet Service

```text
Tomcat/Jetty
WAR
Jersey servlet
Docker image
Kubernetes Deployment
Ingress
```

Use when:

```text
team wants servlet maturity
app is ordinary REST
platform supports server image
```

Key design:

```text
context path explicit
servlet mapping explicit
RemoteIp/forwarded headers configured
thread pool + DB pool aligned
access logs + metrics
readiness/liveness
```

---

## 32. Production Pattern: Cloud-Native Embedded Service

```text
thin jar
embedded Grizzly/Jetty
JRE Docker image
Kubernetes
OpenTelemetry
```

Use when:

```text
app team owns runtime
simple service boundary
fast CI/CD
no server-managed EE need
```

Key design:

```text
explicit config
health endpoints
graceful shutdown
non-root container
JVM cgroup tuning
thread/pool/backpressure controls
```

---

## 33. Production Pattern: Managed Jakarta EE Runtime

```text
WAR/EAR
Open Liberty/Payara
server config as code
server-managed datasource/security/transactions
Kubernetes or VM
```

Use when:

```text
Jakarta EE services are valuable
enterprise governance
server-managed resources
MicroProfile/Jakarta standards
```

Key design:

```text
feature/resource config versioned
dependency scopes correct
server monitoring
admin/security hardened
deployment descriptors migrated
```

---

## 34. Production Pattern: High-Control Network Runtime

```text
Netty/Jetty advanced
custom routing/streaming/backpressure
special observability
```

Use when:

```text
network model is core requirement
team has expertise
blocking boundaries are controlled
```

Key design:

```text
event loop not blocked
offload executor bounded
direct memory tuned
event loop lag monitored
```

---

## 35. Production Pattern: Transitional Migration Architecture

```text
old Jersey 2 javax service
new Jersey 3/4 jakarta service
gateway routes gradually
shared DB with compatibility
```

Use when:

```text
large migration risk
need gradual endpoint migration
clients cannot switch instantly
```

Key design:

```text
versioned routes
contract tests
old/new DB compatibility
observability by version
rollback
```

---

## 36. Production Pattern: Shared Server Multi-App

```text
one app server
multiple WARs
shared platform config
```

Use cautiously.

Pros:

```text
resource sharing
central admin
legacy enterprise model
```

Risks:

```text
blast radius
classloader complexity
resource contention
hot redeploy leak
upgrade coordination
one app affects server
```

Modern recommendation:

```text
prefer one app per process/container for isolation
```

unless organization has strong shared-server operations.

---

## 37. Choosing WAR vs Embedded

Choose WAR when:

```text
server/runtime standard exists
Servlet integration needed
app-server resources needed
multiple teams share server skill
deployment toolchain expects WAR
```

Choose embedded when:

```text
app owns runtime
container-native executable service
simpler deployment desired
no full server needed
more control over lifecycle
```

WAR is not old-fashioned.

Embedded is not automatically modern.

The correct choice depends on ownership and constraints.

---

## 38. Choosing Tomcat vs Jetty

Tomcat:

```text
default safe choice for Servlet REST
widely known
simple operational model
large ecosystem
```

Jetty:

```text
more flexible
strong embedded story
modern multi-environment Jetty 12
advanced threading options
```

Choose Tomcat if:

```text
org standard and app needs standard Servlet
```

Choose Jetty if:

```text
team wants Jetty flexibility or embedded/external symmetry
```

Both need correct tuning.

---

## 39. Choosing Liberty vs Payara/GlassFish

Open Liberty:

```text
feature-based
cloud-friendly
MicroProfile integration
server.xml as code
```

Payara/GlassFish:

```text
full platform/domain/admin model
Jakarta EE reference lineage
server-managed resource model
```

Choose Liberty if:

```text
feature-based cloud-native Jakarta runtime is desired
```

Choose Payara/GlassFish if:

```text
organization standardizes it or full server/domain model is desired
```

Do not choose full server if you only need REST and it adds unnecessary operational burden.

---

## 40. Choosing Netty

Choose Netty only if you can answer:

```text
Which thread executes resource code?
Where are blocking calls offloaded?
How is event loop lag measured?
How is direct memory configured?
What is backpressure strategy?
How are thread dumps interpreted?
```

If answers are unclear:

```text
Netty is probably not the right Jersey deployment model for that team.
```

Netty is excellent when used intentionally.

It is risky when used as “faster server”.

---

## 41. Kubernetes Decision Rules

Kubernetes is valuable if you need:

```text
replicas
rolling update
self-healing
service discovery
declarative config
autoscaling
standard platform controls
```

But Kubernetes requires:

```text
probes
resource requests/limits
graceful shutdown
config/secret lifecycle
observability
ingress/gateway understanding
DB pool by max replicas
security context/RBAC/network policy
```

If team lacks Kubernetes maturity, use managed platform or improve platform support before pushing complexity to app team.

---

## 42. Operational Ownership Matrix

| Concern | App Team | Platform Team | Security Team | DBA |
|---|---:|---:|---:|---:|
| Jersey version | yes | maybe | no | no |
| Server base image | maybe | yes | maybe | no |
| DB pool size | yes | maybe | no | yes |
| TLS edge | no | yes | yes | no |
| JWT issuer/audience | yes | maybe | yes | no |
| Object authorization | yes | no | review | no |
| Kubernetes probes | yes | yes | no | no |
| Resource limits | yes | yes | no | no |
| Secrets | yes | yes | yes | maybe |
| Audit requirements | yes | maybe | yes | maybe |
| Dependency patching | yes | yes | security review | no |

Decide ownership before incident.

---

## 43. Risk Scoring

Score candidate deployment model:

```text
1 = low risk
5 = high risk
```

Dimensions:

```text
team familiarity
runtime complexity
security complexity
observability availability
performance risk
migration risk
operational tooling
platform fit
debuggability
dependency ownership clarity
```

Example:

| Model | Familiarity | Complexity | Observability | Migration | Total Risk |
|---|---:|---:|---:|---:|---:|
| Tomcat WAR | 1 | 2 | 2 | 2 | low |
| Netty | 4 | 4 | 4 | 3 | high |
| Open Liberty | 3 | 3 | 2 | 3 | medium |
| Embedded Grizzly | 2 | 2 | 3 | 2 | medium |

Choose based on risk and benefit.

---

## 44. Decision Record Template

Use Architecture Decision Record.

```markdown
# ADR: Jersey Deployment Model for Case API

## Status
Accepted

## Context
- Java version:
- Jersey version:
- Namespace:
- Runtime constraints:
- Platform:
- Security:
- Observability:
- Performance target:
- Team ownership:

## Options
1. Tomcat WAR
2. Embedded Grizzly thin jar
3. Open Liberty WAR
4. Netty

## Decision
We choose ...

## Rationale
...

## Consequences
Positive:
- ...

Negative:
- ...

## Operational Requirements
- health endpoints
- metrics
- logs
- thread dump
- shutdown
- config
- security
```

Decisions should be auditable.

---

## 45. Minimum Production Baseline for Any Model

Regardless of runtime:

```text
health/readiness
structured logs
request ID
metrics
trace support if distributed
config validation
secret externalization
dependency timeouts
pool limits
graceful shutdown
security headers/authz
artifact inspection
SBOM/scanning
runbook
```

If a model cannot support baseline, do not use it for production.

---

## 46. Red Flags

Avoid a deployment choice if:

```text
nobody can debug it
security ownership unclear
no metrics/logs for runtime
classpath ownership unclear
no rollback plan
no test environment matching production
runtime not compatible with namespace
team cannot patch base/server quickly
deployment requires manual admin console changes
failure mode is unknown
```

Red flags do not always forbid a model, but require mitigation.

---

## 47. Production Readiness Gate

Before accepting model:

```text
[ ] Can start locally.
[ ] Can build artifact reproducibly.
[ ] Can run in target runtime.
[ ] Can deploy to target platform.
[ ] Can pass smoke tests.
[ ] Can expose health/readiness.
[ ] Can be observed.
[ ] Can be secured.
[ ] Can handle SIGTERM.
[ ] Can roll back.
[ ] Can be patched.
[ ] Can be debugged during incident.
```

Deployment is not production-ready until all pass.

---

## 48. Common Decision Anti-Patterns

### Anti-Pattern 1 — Choosing by Benchmark Blog

Workload mismatch.

### Anti-Pattern 2 — Choosing by Familiarity Only

May ignore platform/security constraints.

### Anti-Pattern 3 — Choosing Full Server for Simple REST

Operational overhead.

### Anti-Pattern 4 — Choosing Netty for “Speed”

Without event-loop discipline.

### Anti-Pattern 5 — Choosing Embedded to Avoid Ops

Embedded means app team owns ops.

### Anti-Pattern 6 — Choosing Kubernetes Without Probes/Resources

Kubernetes misused as process runner.

### Anti-Pattern 7 — Ignoring Migration Path

Target good, transition impossible.

### Anti-Pattern 8 — Manual Server Config

Not reproducible.

### Anti-Pattern 9 — No Runtime Ownership

Patch/security responsibility unclear.

### Anti-Pattern 10 — No Decision Record

Future team repeats debate.

---

## 49. Recommended Defaults

If you need a practical default:

### For simple production REST service in Kubernetes

```text
Embedded Grizzly/Jetty thin jar
or Tomcat WAR image

Choose based on team standard.
```

### For organization with Servlet standard

```text
Tomcat WAR
```

### For Jakarta EE/MicroProfile needs

```text
Open Liberty
```

### For full Jakarta EE enterprise server model

```text
Payara/GlassFish/WildFly depending org standard
```

### For high-network-control specialized workload

```text
Netty, only with expertise
```

### For legacy Jersey 2 javax app

```text
stabilize current javax runtime first
then plan Jakarta migration
```

Defaults are not laws.

They are starting points.

---

## 50. Final Decision Framework

Use these questions:

```text
1. Is the app javax or jakarta?
2. What server/runtime generation matches?
3. Do we need full Jakarta EE services?
4. Do we need Servlet/WAR integration?
5. Who owns runtime patching?
6. Who owns TLS/auth/proxy?
7. Where will config/secrets live?
8. How will health/readiness work?
9. What are p95/p99/SLO targets?
10. What is the bottleneck: CPU, DB, network, startup, memory?
11. What observability does runtime provide?
12. How will shutdown/rollout work?
13. How will rollback work?
14. What can the team debug at 2 AM?
15. What is migration risk from current state?
```

If you cannot answer these, the deployment model is not decided.

---

## 51. Summary

Production deployment pattern selection is not about framework popularity.

It is about fit.

The right Jersey deployment model aligns:

```text
API generation
runtime ownership
team skills
platform standard
security boundary
observability
performance profile
configuration model
migration path
incident response
```

Key lessons:

```text
WAR is still valid.
Embedded is powerful but shifts ownership to app team.
Full Jakarta EE server is valuable when you use platform services.
Netty is specialized, not default.
Docker/Kubernetes add lifecycle power but require maturity.
Namespace generation must match runtime.
Observability/security/shutdown are non-negotiable.
```

Top-tier conclusion:

> The best deployment model is the one your organization can operate safely, observe clearly, secure correctly, tune realistically, and migrate deliberately.

---

## 52. How This Part Connects to the Final Part

This part gave the decision framework.

Next:

```text
Part 32 — Capstone: Designing a Top-Tier Jersey Deployment Architecture
```

The final part will synthesize the entire series into a full end-to-end architecture:

- requirements,
- runtime choice,
- artifact layout,
- Docker/Kubernetes deployment,
- proxy/gateway,
- config/secrets,
- security,
- observability,
- performance,
- failure modes,
- migration readiness,
- and final production checklist.

---

## References

- Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/2.28/deployment.html
- Apache Tomcat 10.1 documentation index: https://tomcat.apache.org/tomcat-10.1-doc/
- Apache Tomcat Servlet 6.0 API documentation: https://tomcat.apache.org/tomcat-10.1-doc/servletapi/index.html
- Jetty 12.1 Operations Guide: https://jetty.org/docs/jetty/12.1/operations-guide/index.html
- Jetty 12.1 Web Application Deployment: https://jetty.org/docs/jetty/12.1/operations-guide/deploy/index.html
- Open Liberty Jakarta EE overview: https://openliberty.io/docs/latest/jakarta-ee.html
- Open Liberty feature overview: https://openliberty.io/docs/latest/reference/feature/feature-overview.html
- IBM Liberty features documentation: https://www.ibm.com/docs/en/was-liberty/base?topic=management-liberty-features


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-030.md">⬅️ Part 30 — Migration Playbook: Jersey 2 → 3 → 4</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-032.md">Part 32 — Capstone: Designing a Top-Tier Jersey Deployment Architecture ➡️</a>
</div>
