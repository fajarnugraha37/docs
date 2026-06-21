# learn-java-eclipse-jersey-deployment-models-part-030  
# Part 30 — Migration Playbook: Jersey 2 → 3 → 4

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 30 dari 32**  
> Target pembaca: engineer Java backend yang ingin memigrasikan aplikasi Jersey secara aman dari Jersey 2.x ke 3.x lalu 4.x tanpa mencampur generasi runtime yang tidak kompatibel.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: `javax.*` → `jakarta.*`, Jakarta EE 8/9/10/11, Servlet container compatibility, Java version compatibility, dependency audit, BOM, provider migration, deployment descriptors, testing matrix, rollout strategy, dan anti-pattern migration.

---

## 1. Mengapa Migration Jersey Tidak Boleh Dianggap Search-Replace?

Banyak engineer melihat migration Jersey 2 ke Jersey 3 seperti ini:

```text
javax.ws.rs.* -> jakarta.ws.rs.*
javax.servlet.* -> jakarta.servlet.*
mvn test
selesai
```

Ini berbahaya.

Migration Jersey adalah migration lintas ekosistem:

```text
Jersey 2.x:
  Java EE / Jakarta EE 8 style
  javax.* API namespace

Jersey 3.x:
  Jakarta EE 9/10 generation
  jakarta.* API namespace

Jersey 4.x:
  Jakarta EE 11 / Jakarta REST 4.0 generation
  jakarta.* namespace with newer platform assumptions
```

Yang ikut berubah:

```text
Servlet container
Jakarta EE server
dependency coordinates
transitive libraries
JAX-RS/Jakarta REST API
CDI/HK2 integration
Bean Validation
JSON-B/Jackson/MOXy providers
JAXB availability
deployment descriptors
web.xml namespace
test libraries
mock frameworks
build plugins
Docker base image
Java runtime version
```

Top-tier mental model:

> Jersey migration is not package renaming.  
> It is **generation alignment** across API namespace, server runtime, dependency graph, build, artifact, and deployment model.

---

## 2. Version Generation Map

Simplified map:

| Jersey | API Generation | Namespace | Typical Platform |
|---|---|---|---|
| Jersey 2.x | JAX-RS 2.x / Jakarta REST 2.x era | `javax.*` | Java EE 8 / Jakarta EE 8 |
| Jersey 3.0.x | Jakarta EE 9 era | `jakarta.*` | Jakarta EE 9 |
| Jersey 3.1.x | Jakarta EE 10 era | `jakarta.*` | Jakarta EE 10 |
| Jersey 4.x | Jakarta EE 11 era | `jakarta.*` | Jakarta EE 11 / Jakarta REST 4.0 |

Important:

```text
Jersey 3.x is not compatible with old javax application code.
Jersey 2.x is not compatible with jakarta application code.
```

The big break is namespace.

The next breaks are platform/server/runtime versions.

---

## 3. The Core Invariant

Never mix generations.

Bad combinations:

```text
Jersey 2.x + jakarta.ws.rs imports
Jersey 3.x + javax.ws.rs imports
Tomcat 9 + jakarta.servlet app
Tomcat 10+ + javax.servlet app
Jakarta EE 10 server + Java EE 8 application libraries
WAR contains both javax.ws.rs-api and jakarta.ws.rs-api
WAR contains Jersey 2 and Jersey 3 modules
JSON provider uses javax but app uses jakarta
```

Migration success depends on generation coherence.

Rule:

```text
One app artifact must have one API generation.
```

---

## 4. Official Breaking Change: `javax` → `jakarta`

Jersey 3 migration documentation states that the most fundamental change in Jersey 3.0.0 and later is the namespace change: since Jakarta EE 9, the `jakarta.` namespace replaces the Java EE `javax` namespace.

This means source code changes:

```java
// Jersey 2.x
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;
```

becomes:

```java
// Jersey 3.x/4.x
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

Also:

```java
javax.inject.Inject
javax.annotation.PostConstruct
javax.validation.Valid
javax.servlet.*
javax.enterprise.context.*
```

become corresponding Jakarta packages where applicable:

```java
jakarta.inject.Inject
jakarta.annotation.PostConstruct
jakarta.validation.Valid
jakarta.servlet.*
jakarta.enterprise.context.*
```

But not every `javax.*` package moves.

---

## 5. Not All `javax.*` Moves to `jakarta.*`

Important examples that remain Java SE:

```text
javax.crypto
javax.net
javax.net.ssl
javax.imageio
javax.xml.parsers
javax.xml.transform
javax.management
javax.naming
javax.sql
javax.security.auth
```

Do not blindly replace every `javax`.

Move only Java EE/Jakarta EE APIs.

Common migration target packages:

```text
javax.ws.rs -> jakarta.ws.rs
javax.servlet -> jakarta.servlet
javax.annotation -> jakarta.annotation
javax.inject -> jakarta.inject
javax.validation -> jakarta.validation
javax.persistence -> jakarta.persistence
javax.transaction -> jakarta.transaction
javax.enterprise -> jakarta.enterprise
javax.json -> jakarta.json
javax.json.bind -> jakarta.json.bind
javax.xml.bind -> jakarta.xml.bind
javax.mail -> jakarta.mail
```

Use automated tools, but review carefully.

---

## 6. Server Compatibility Matrix

### Tomcat

Apache Tomcat migration guide states that between Tomcat 9 and Tomcat 10 there is a significant breaking change: specification API packages changed from `javax.*` to `jakarta.*`, and web applications need to be recompiled against the new APIs.

Simplified:

```text
Tomcat 9:
  javax Servlet
  works with Jersey 2.x servlet deployments

Tomcat 10.0:
  jakarta Servlet 5
  works with Jersey 3.0 generation

Tomcat 10.1:
  Jakarta Servlet 6
  Java 11+
  works with Jersey 3.1 generation

Tomcat 11:
  Jakarta Servlet 6.1 / Jakarta EE 11 era
  aligns with newer Jakarta generation
```

Do not deploy Jersey 2 WAR to Tomcat 10 without migration/transform.

### Jetty

Simplified:

```text
Jetty 9/10:
  legacy javax era depending configuration

Jetty 11:
  Jakarta EE 9 namespace

Jetty 12:
  multi-environment support for EE 8/9/10/11 with modules
```

Jetty 12 is more flexible, but module/environment selection must match your app generation.

### Jakarta EE Servers

```text
Jakarta EE 8 server:
  javax generation

Jakarta EE 9/10/11 server:
  jakarta generation
```

GlassFish/Payara/Open Liberty/WildFly generation must match application generation.

---

## 7. Migration Strategy Options

### Big Bang Migration

```text
Jersey 2 + javax + old server
  ↓
Jersey 3/4 + jakarta + new server
```

Pros:

- clean,
- one migration project,
- no long dual support.

Cons:

- high risk,
- large diff,
- harder rollback,
- many moving parts.

### Stepwise Migration

```text
1. stabilize Jersey 2 latest
2. clean dependency graph
3. remove deprecated APIs
4. migrate source namespace
5. upgrade server/container
6. upgrade Jersey 3
7. test
8. later upgrade Jersey 4/platform
```

Pros:

- safer,
- easier diagnosis,
- smaller changes.

Cons:

- longer timeline,
- more intermediate builds.

Recommended for production systems.

---

## 8. Recommended High-Level Path

For most production apps:

```text
Phase 0:
  inventory and baseline tests

Phase 1:
  upgrade to latest compatible Jersey 2.x within javax generation

Phase 2:
  clean dependency graph and scopes

Phase 3:
  migrate source/config from javax to jakarta

Phase 4:
  upgrade server/container to jakarta generation

Phase 5:
  upgrade Jersey to 3.x aligned with target platform

Phase 6:
  test final artifact and deployment model

Phase 7:
  rollout with observability and rollback plan

Phase 8:
  later evaluate Jersey 4/Jakarta EE 11
```

Do not start by editing imports blindly.

Start with inventory.

---

## 9. Phase 0 — Inventory

Create migration inventory:

```text
Java version
Jersey version
Servlet container/server version
JAX-RS/Jakarta REST API dependency
Servlet API dependency
CDI/HK2 usage
Bean Validation version
JSON provider
JAXB usage
JPA usage
Security/auth library
Multipart provider
Test dependencies
Docker image
Kubernetes manifests
web.xml
deployment descriptors
server config
```

Commands:

```bash
mvn dependency:tree
mvn help:effective-pom
gradle dependencies
gradle dependencyInsight --dependency jersey
jar tf target/app.war
```

Search:

```bash
grep -R "javax\.ws\.rs" src
grep -R "javax\.servlet" src
grep -R "javax\." src
grep -R "javax\." pom.xml build.gradle
grep -R "javax\." src/main/webapp WEB-INF
```

Inventory before migration.

---

## 10. Phase 0 — Baseline Tests

Before changing code, establish behavior.

Tests:

```text
unit tests
resource tests
integration tests
container tests
JSON serialization tests
validation error tests
auth/security tests
exception mapper tests
multipart tests
deployment smoke test
health/readiness test
proxy path test
```

Golden endpoints:

```text
GET health
GET JSON
POST JSON
validation failure
auth failure
authorization failure
not found
exception mapper
multipart upload if used
```

If baseline is weak, migration risk is high.

---

## 11. Phase 1 — Stabilize Jersey 2

Before migrating to Jersey 3, get to a clean Jersey 2 baseline:

```text
use Jersey BOM
align all Jersey modules
remove duplicate versions
remove old transitive overrides
fix warnings
update tests
pin dependencies
```

Example Maven:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.glassfish.jersey</groupId>
      <artifactId>jersey-bom</artifactId>
      <version>${jersey2.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Do not migrate from messy dependency graph.

---

## 12. Phase 2 — Dependency Scope Cleanup

For WAR deployment:

```text
servlet-api:
  provided

Jersey on Tomcat/Jetty:
  packaged

Jersey on full Jakarta EE server:
  usually server-owned/provided
```

For embedded:

```text
server/container adapter packaged
Jersey runtime packaged
```

Clean up:

```text
duplicate javax.ws.rs-api
duplicate jakarta.ws.rs-api
old jersey modules
old hk2 modules
conflicting JSON providers
servlet API packaged incorrectly
```

Use:

```text
maven-enforcer-plugin
dependency convergence
duplicate class checker
```

---

## 13. Phase 3 — Namespace Migration

Change source imports:

```text
javax.ws.rs -> jakarta.ws.rs
javax.servlet -> jakarta.servlet
javax.validation -> jakarta.validation
javax.inject -> jakarta.inject
```

Change annotations:

```java
// Before
import javax.ws.rs.Path;
import javax.validation.Valid;
import javax.inject.Inject;

// After
import jakarta.ws.rs.Path;
import jakarta.validation.Valid;
import jakarta.inject.Inject;
```

Change fully qualified names in:

```text
source code
tests
web.xml
beans.xml if schema references
persistence.xml
validation.xml
JSP/tag files if any
reflection string constants
configuration files
documentation/examples
```

Do not forget tests.

---

## 14. Automated Migration Tools

Options:

```text
OpenRewrite recipes
Apache Tomcat Jakarta EE migration tool
IDE refactoring
custom scripts
build-time transformers for temporary compatibility
```

Apache Tomcat Jakarta EE migration tool states that it migrates Java EE 8 packages in `javax.*` namespace to Jakarta EE 9 replacements, including package references in classes, string constants, configuration files, JSPs, and TLDs.

Tools help, but:

```text
review every change
run tests
inspect artifact
do not blindly replace Java SE javax packages
```

For source-controlled long-term migration, source migration is preferable to runtime transformation.

---

## 15. Phase 4 — Build Dependencies Migration

Maven examples.

Before Jersey 2:

```xml
<dependency>
  <groupId>org.glassfish.jersey.containers</groupId>
  <artifactId>jersey-container-servlet-core</artifactId>
</dependency>

<dependency>
  <groupId>javax.ws.rs</groupId>
  <artifactId>javax.ws.rs-api</artifactId>
  <scope>provided</scope>
</dependency>
```

After Jersey 3/4:

```xml
<dependency>
  <groupId>org.glassfish.jersey.containers</groupId>
  <artifactId>jersey-container-servlet-core</artifactId>
</dependency>

<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Use Jersey BOM for target version.

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

---

## 16. Phase 5 — Deployment Descriptor Migration

`web.xml` may need Jakarta schema version.

Old Java EE style:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         version="3.1">
</web-app>
```

Jakarta style:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.0">
</web-app>
```

Version depends on target Servlet/Jakarta EE generation.

Also update:

```text
web-fragment.xml
beans.xml
persistence.xml
validation.xml
faces-config.xml if applicable
JSP taglib references
TLDs
deployment descriptors
```

If using annotations only, descriptor migration may be smaller, but still inspect.

---

## 17. Phase 6 — Server Runtime Migration

Match server generation.

Examples:

```text
Jersey 2.x javax WAR:
  Tomcat 9
  Jetty 9/10 javax config
  Jakarta EE 8 server

Jersey 3.0 jakarta WAR:
  Tomcat 10.0
  Jetty 11 / Jakarta EE 9 environment
  Jakarta EE 9 server

Jersey 3.1 jakarta WAR:
  Tomcat 10.1
  Jetty 12 EE10 environment
  Jakarta EE 10 server

Jersey 4 jakarta WAR:
  Jakarta EE 11 compatible runtime
```

Do not upgrade app but leave server old.

Do not upgrade server but leave app old.

Test target runtime early.

---

## 18. Phase 7 — JSON Provider Migration

Common providers:

```text
jersey-media-json-jackson
jersey-media-json-binding
jersey-media-moxy
```

Risks:

```text
provider missing
provider uses wrong namespace
Jackson module versions incompatible
JSON-B version mismatch
JAXB dependency changes
date/time format changes
unknown property handling
polymorphic behavior changes
```

Tests:

```text
serialize DTO
deserialize request
validation + JSON error body
date/time format
null behavior
unknown property
exception mapper JSON
```

Do not assume JSON remains identical.

---

## 19. Phase 8 — Bean Validation Migration

Old:

```java
import javax.validation.Valid;
import javax.validation.constraints.NotNull;
```

New:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
```

Also provider changes:

```text
Hibernate Validator generation
Jakarta Validation API
server-provided provider
```

Test:

```text
request body validation
path/query param validation
constraint violation exception mapping
message interpolation
custom validators
```

Custom validators need migration too:

```java
import jakarta.validation.ConstraintValidator;
```

---

## 20. Phase 9 — CDI/HK2 Migration

Jersey may use HK2 injection or CDI integration.

Migration risks:

```text
javax.inject -> jakarta.inject
javax.enterprise -> jakarta.enterprise
HK2 bridge compatibility
CDI feature missing
server-managed CDI changes
custom Binder using old types
```

Test:

```text
resource injection
provider injection
singleton/request scopes
filters
exception mappers
background services
```

If using Jakarta EE server, decide:

```text
CDI owns services?
Jersey/HK2 owns services?
both integrated?
```

Do not leave ownership ambiguous.

---

## 21. Phase 10 — JAXB and XML

Java 11 removed Java EE modules from JDK.

Jersey migration docs for older versions note that dependencies formerly taken from JDK, such as JAXB, become external dependencies in modern Java/Jakarta contexts.

If app uses:

```text
XML payloads
JAXB annotations
SOAP integration
legacy XML binding
```

Migrate:

```text
javax.xml.bind -> jakarta.xml.bind
JAXB API/runtime dependencies
XML provider compatibility
```

Note:

```text
javax.xml.parsers remains Java SE
javax.xml.transform remains Java SE
```

Do not migrate Java SE XML packages.

---

## 22. Phase 11 — Multipart Migration

If using multipart:

```text
jersey-media-multipart
```

Need target Jersey version.

Imports may change if using Jakarta APIs.

Test:

```text
file upload
form data
large file limit
content disposition
temp file cleanup
validation
```

Multipart often touches:

```text
request body limits
proxy limits
server temp dir
memory/disk buffering
```

Migration can expose hidden size/temp issues.

---

## 23. Phase 12 — Security Migration

Security code often touches:

```text
ContainerRequestFilter
SecurityContext
RolesAllowed
Servlet security
Jakarta Security
JWT libraries
CORS filter
cookies
```

Imports:

```text
javax.annotation.security.RolesAllowed
```

to:

```text
jakarta.annotation.security.RolesAllowed
```

Test:

```text
401 unauthenticated
403 unauthorized
role mapping
object-level authorization
CORS preflight
secure cookie behavior
JWT validation
gateway identity headers
```

Do not treat compilation as security validation.

---

## 24. Phase 13 — Tests Migration

Test dependencies may still use `javax`.

Update:

```text
Jersey Test Framework
Servlet test APIs
Mockito/JUnit if old
Arquillian/Testcontainers if used
server test container
JSON assertion libraries
```

Test code imports too:

```text
javax.ws.rs.client.Client
javax.ws.rs.core.Response
```

become:

```text
jakarta.ws.rs.client.Client
jakarta.ws.rs.core.Response
```

Make tests run against final deployment model, not just in-memory.

---

## 25. Phase 14 — Docker/Kubernetes Migration

Update Docker base images:

```text
Tomcat 9 -> Tomcat 10.1/11 depending target
Java 8/11 -> Java 17/21 depending target
Open Liberty feature set
Payara/GlassFish generation
```

Update Kubernetes probes:

```text
context path may change
server port may change
startup time may change
resource usage may change
```

Update resources:

```text
memory may change
startup CPU may change
thread count may change
JVM version may change
```

Test in cluster-like environment.

---

## 26. Phase 15 — Artifact Inspection

Inspect final WAR/JAR.

Commands:

```bash
jar tf target/app.war | sort > contents.txt
```

Check:

```text
no javax.ws.rs-api jar in jakarta app
no jakarta.ws.rs-api jar in javax app
no Jersey 2 modules in Jersey 3/4 app
no mixed servlet API
JSON provider correct
META-INF/services correct
deployment descriptors migrated
no duplicate classes
```

Search artifact contents:

```bash
jar tf target/app.war | grep -E "javax|jakarta"
```

For fat jar:

```bash
jar tf target/app-all.jar | grep "META-INF/services"
```

---

## 27. Phase 16 — Smoke Test Matrix

Minimum smoke tests:

```text
GET /health/live
GET /health/ready
GET JSON endpoint
POST JSON endpoint
validation error endpoint
auth required endpoint
authorization denied endpoint
not found endpoint
exception mapper endpoint
multipart endpoint if applicable
OpenAPI endpoint if applicable
```

Run against:

```text
local target server
Docker image
Kubernetes deployment if target
through reverse proxy/ingress
```

Many migration bugs appear only behind final deployment.

---

## 28. Phase 17 — Behavior Compatibility

Compare old vs new:

```text
status codes
headers
JSON fields/order if clients depend
date/time format
error body format
validation messages
CORS headers
cookies
Location headers
OpenAPI output
pagination behavior
security decisions
```

Use contract tests.

Do not assume behavior unchanged.

Migration can change defaults.

---

## 29. Phase 18 — Rollout Strategy

For production:

```text
deploy to DEV
run automated smoke/contract tests
deploy to UAT
run regression/performance/security tests
canary or blue/green if possible
monitor p95/p99/error rate
rollout gradually
keep rollback image/artifact
```

If migrating namespace/server generation, rollback may require:

```text
old server image
old WAR
old config
old DB compatibility
```

Plan rollback before rollout.

---

## 30. Phase 19 — Schema and Message Compatibility

If migration changes code only, DB may be unchanged.

But often migration includes dependency/framework changes.

Ensure compatibility for:

```text
DB schema
serialized JSON in cache
messages in broker
idempotency records
session cookies
JWT/cookie format
distributed cache values
```

If old and new run together during rolling update:

```text
both must read/write compatible data
```

Do not deploy new serialization format without compatibility plan.

---

## 31. Jersey 2 → 3 Common Errors

### Error: `ClassNotFoundException: javax.ws.rs...`

Cause:

```text
old javax import/dependency remains
```

Fix:

```text
migrate source/dependency to jakarta
```

### Error: `ClassNotFoundException: jakarta.ws.rs...`

Cause:

```text
running jakarta app on javax server/deps
```

Fix:

```text
upgrade server/deps to Jakarta generation
```

### Error: `NoSuchMethodError`

Cause:

```text
mixed Jersey module versions
mixed API versions
old provider
```

Fix:

```text
BOM, dependency tree, duplicate class check
```

### Error: JSON provider missing

Cause:

```text
provider dependency not migrated
service descriptor lost
```

Fix:

```text
target provider dependency
explicit registration
fat jar services merge
```

---

## 32. Jersey 3 → 4 Considerations

Jersey site indicates Jersey 4.0.x is the Jakarta EE 11/Jakarta REST 4.0 compatible release line.

Jakarta RESTful Web Services 4.0 page states the release is for Jakarta EE 11 and notes goals including removing JAXB dependency and ManagedBean support while maintaining backward compatibility with earlier releases.

Migration to Jersey 4 should consider:

```text
Jakarta EE 11 compatible runtime
Jakarta REST 4.0 API
Java runtime requirements
server compatibility
removed/deprecated API behavior
JAXB-related assumptions
ManagedBean-related assumptions
dependency versions
test framework compatibility
```

If you do not need Jakarta EE 11 yet, do not rush to Jersey 4 without platform readiness.

---

## 33. Java Runtime Migration

Jersey migration often coincides with Java runtime migration.

Examples:

```text
Java 8 -> Java 11
Java 11 -> Java 17
Java 17 -> Java 21
Java 21 -> Java 25
```

Watch:

```text
removed Java EE modules after Java 8
strong encapsulation
illegal reflective access
TLS defaults
GC defaults
container awareness
bytecode target
dependencies using JDK internals
```

Use:

```text
--release
jdeps
CI matrix
Docker image pinning
runtime smoke tests
```

---

## 34. Build Plugin Migration

Update:

```text
maven-compiler-plugin
maven-surefire-plugin
maven-failsafe-plugin
maven-war-plugin
maven-shade-plugin
maven-enforcer-plugin
dependency plugin
jacoco
spotbugs/checkstyle if needed
```

Old plugins may not handle:

```text
new Java bytecode
module path
Jakarta descriptors
multi-release jars
modern test engines
```

Pin plugin versions.

Do not rely on old Maven defaults.

---

## 35. JPMS/Module Path Considerations

Most enterprise Jersey apps still run on classpath.

If using JPMS:

```text
module-info.java
requires jakarta.ws.rs
requires org.glassfish.jersey.server
```

Risks:

```text
split packages
automatic modules
reflection access
Jersey/HK2/CDI injection
ServiceLoader
fat jar shading
```

Migration is simpler on classpath.

If adopting JPMS, treat it as separate migration workstream.

---

## 36. Fat Jar/Shaded Jar Migration

If app uses shaded jar:

Migration risks:

```text
META-INF/services overwritten
old javax services remain
relocation breaks providers
signature files invalid
duplicate classes hidden
```

After migration:

```text
inspect META-INF/services
merge service descriptors
test JSON/provider discovery
test ExceptionMapper/Feature registration
```

Thin distribution is easier to inspect during migration.

---

## 37. OpenRewrite Example Strategy

OpenRewrite can automate many `javax` to `jakarta` migrations.

But best use:

```text
create branch
run recipe
review diff
run tests
inspect generated changes
manually fix non-standard code
```

Do not use automation as a substitute for understanding.

Automation can migrate source text.

It cannot guarantee:

```text
server compatibility
provider behavior
runtime config
authorization correctness
dependency convergence
```

---

## 38. Temporary Binary Transformation

Some tools can transform `javax` bytecode/resources to `jakarta`.

Use case:

```text
third-party WAR migration
temporary bridge
legacy app deployment
```

Risks:

```text
harder debugging
source and runtime differ
tool coverage limits
reflection strings
third-party library incompatibility
```

For long-term maintainability:

```text
migrate source and dependencies.
```

---

## 39. Dependency Audit Checklist

Search for old generation:

```text
javax.ws.rs-api
javax.servlet-api
javax.annotation-api
javax.inject
javax.validation
javax.persistence
javax.transaction
javax.json
javax.json.bind
javax.xml.bind
javax.mail
```

Search for new generation:

```text
jakarta.ws.rs-api
jakarta.servlet-api
jakarta.annotation-api
jakarta.inject-api
jakarta.validation-api
jakarta.persistence-api
jakarta.transaction-api
jakarta.json-api
jakarta.json.bind-api
jakarta.xml.bind-api
jakarta.mail-api
```

In final app, you usually should not have both old and new versions of the same spec generation.

---

## 40. Runtime Ownership Checklist

For each dependency, decide owner:

```text
app packages it
server provides it
JDK provides it
proxy/gateway owns it
platform secret manager owns it
```

Examples:

```text
Servlet API:
  server-owned

Jakarta REST API:
  server-owned in full EE server, app-owned in Tomcat embedded model depending packaging

Jersey implementation:
  server-owned in some full EE servers, app-owned in Tomcat

Jackson:
  app-owned usually, unless server integration says otherwise

JDBC driver:
  app-owned or server-owned depending datasource model
```

Migration fails when ownership is ambiguous.

---

## 41. Migration Testing Matrix

| Test | Jersey 2 baseline | Jersey 3/4 candidate |
|---|---:|---:|
| Unit tests | yes | yes |
| Resource tests | yes | yes |
| JSON contract | yes | yes |
| Validation errors | yes | yes |
| Auth/security | yes | yes |
| Docker startup | yes | yes |
| Target server deploy | yes | yes |
| Proxy path | yes | yes |
| K8s readiness | yes | yes |
| Load smoke | yes | yes |
| Thread/memory sanity | yes | yes |
| Rollback test | yes | yes |

Compare behavior.

---

## 42. Performance Regression Testing

Migration can affect performance.

Measure:

```text
startup time
readiness time
steady p95/p99
allocation rate
heap usage
thread count
JSON serialization time
DB pool behavior
CPU usage
image size
```

Why performance may change:

```text
new server
new Java
new Jersey
new JSON provider
new validation provider
new CDI behavior
new security library
new GC defaults
```

Do not assume same resource requests/limits remain valid.

---

## 43. Security Regression Testing

Migration can affect:

```text
JWT validation
RolesAllowed package
CORS filter
servlet filter dispatch
cookie behavior
CSRF handling
exception mapping
auth headers
TLS config
```

Test:

```text
unauthenticated
expired token
wrong audience
wrong role
object forbidden
CORS preflight
secure cookie
gateway identity header
```

Security regression is as important as functional regression.

---

## 44. Observability Regression Testing

Check:

```text
logs still structured
requestId filter works
MDC clears
metrics endpoint works
route labels still correct
traces still emitted
health endpoints correct
exception mapper logs correctly
access logs still include status/duration
```

Migration often breaks instrumentation because package/class names changed.

---

## 45. Rollback Plan

Rollback must include:

```text
old app artifact/image
old server image if changed
old config
DB backward compatibility
message/cache compatibility
old Kubernetes manifests
traffic routing plan
```

If migration includes Tomcat 9 → 10, rollback may require old container image.

If DB migration not backward compatible, rollback is blocked.

Plan before deployment.

---

## 46. Coexistence Strategy

Sometimes you need old and new versions running side by side.

Options:

```text
separate paths:
  /api-v1 javax service
  /api-v2 jakarta service

separate services:
  case-api-v1
  case-api-v2

blue/green:
  one active at a time

canary:
  small percentage to new

strangler:
  migrate endpoints gradually
```

Important:

```text
same database/cache/message compatibility
auth/session compatibility
client routing
observability by version
```

---

## 47. Common Anti-Patterns

### Anti-Pattern 1 — Blind `javax` Replacement

Breaks Java SE packages.

### Anti-Pattern 2 — Mixing Jersey 2 and 3 Modules

Runtime chaos.

### Anti-Pattern 3 — Upgrading Server but Not App

Tomcat 10 cannot run old javax servlet app without migration/transform.

### Anti-Pattern 4 — Compiles Locally, Not Tested in Target Server

Deployment model matters.

### Anti-Pattern 5 — Ignoring Tests and JSON Contract

Clients break.

### Anti-Pattern 6 — Fat Jar Without Service Merge

Provider discovery breaks.

### Anti-Pattern 7 — No Rollback Server Image

Rollback impossible.

### Anti-Pattern 8 — Assuming Gateway/Auth Still Works

Security boundary can change.

### Anti-Pattern 9 — Migrating Framework and Business Feature Together

Hard to debug.

### Anti-Pattern 10 — No Dependency Tree Review

Transitive old APIs remain.

---

## 48. Practical Migration Checklist

```text
[ ] Inventory Java/Jersey/server/dependencies.
[ ] Establish Jersey 2 baseline tests.
[ ] Upgrade to clean latest Jersey 2 baseline if feasible.
[ ] Import Jersey BOM.
[ ] Enforce dependency convergence.
[ ] Remove duplicate javax/jakarta APIs.
[ ] Decide target generation: Jersey 3.0, 3.1, or 4.
[ ] Choose compatible server/container.
[ ] Migrate source imports carefully.
[ ] Do not migrate Java SE javax packages.
[ ] Migrate descriptors/config files.
[ ] Migrate tests.
[ ] Migrate JSON provider.
[ ] Migrate Bean Validation.
[ ] Migrate CDI/HK2 integration.
[ ] Migrate security annotations/filters.
[ ] Migrate Docker/server images.
[ ] Update Kubernetes probes/resources if needed.
[ ] Inspect final artifact.
[ ] Smoke test final artifact.
[ ] Run contract/security/performance tests.
[ ] Verify observability.
[ ] Plan canary/blue-green/rollback.
[ ] Roll out with monitoring.
```

---

## 49. Decision Matrix

| Current State | Target | Preferred Path |
|---|---|---|
| Jersey 2 + Tomcat 9 | Jakarta/Tomcat 10.1 | migrate source to jakarta + Jersey 3.1 + Tomcat 10.1 |
| Jersey 2 + Java EE 8 server | Jakarta EE 10 server | migrate app namespace + dependencies + descriptors |
| Jersey 2 embedded Grizzly | Jersey 3 embedded | migrate imports + dependencies + Java/runtime |
| Jersey 3.1 stable | Jersey 4 | verify Jakarta EE 11/Jakarta REST 4.0 compatibility |
| Large legacy app | Jakarta | stepwise migration + tests + tool-assisted refactor |
| Weak test coverage | Any migration | build baseline tests first |
| Fat jar app | Jersey 3/4 | service descriptor merge + artifact inspection |
| WAR hot redeploy | Jakarta migration | prefer full process/image replacement |

---

## 50. Top-Tier Engineering Perspective

A basic engineer says:

```text
Replace javax with jakarta.
```

A senior engineer asks:

```text
Which server version supports the target namespace?
```

A top-tier engineer defines:

```text
- generation map
- dependency ownership
- source/config/test migration
- server/runtime compatibility
- provider discovery validation
- artifact inspection
- behavior contract comparison
- rollout and rollback design
- performance/security/observability regression testing
```

Migration is behavior-preserving system evolution.

---

## 51. Summary

Jersey 2 → 3 → 4 migration is fundamentally about generation alignment.

Core truths:

```text
Jersey 2.x is javax generation.
Jersey 3.x is jakarta generation.
Jersey 4.x aligns with Jakarta EE 11/Jakarta REST 4.0.
Tomcat 9 vs 10 is a namespace boundary.
Not every javax package migrates.
Dependency graph must not mix generations.
Target runtime must match target API generation.
Final artifact must be inspected and smoke-tested.
```

A safe migration is:

```text
inventory
baseline
dependency cleanup
namespace migration
server migration
provider/security/config/test migration
artifact inspection
behavior comparison
controlled rollout
```

Top-tier conclusion:

> The hard part of Jersey migration is not changing imports.  
> The hard part is proving that the deployed system still behaves correctly in the new generation.

---

## 52. How This Part Connects to the Next Part

This part covered migration.

Next:

```text
Part 31 — Production Deployment Patterns and Decision Framework
```

We will synthesize everything into decision patterns:

- when to choose WAR vs embedded,
- Tomcat vs Jetty vs Liberty vs Payara vs Netty,
- Docker/Kubernetes patterns,
- security/observability/performance trade-offs,
- team maturity,
- operational ownership,
- and a final decision framework for real-world Jersey deployments.

---

## References

- Jersey 3.x Migration Guide: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/migration.html
- Jersey 3.1.x Migration Guide: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/migration.html
- Jersey project site and release lines: https://jersey.github.io/
- Eclipse Jersey 4.0.0 release page: https://projects.eclipse.org/projects/ee4j.jersey/releases/4.0.0-0
- Jakarta RESTful Web Services 4.0: https://jakarta.ee/specifications/restful-ws/4.0/
- Apache Tomcat 10 Migration Guide: https://tomcat.apache.org/migration-10.html
- Apache Tomcat 10.1 Migration Guide: https://tomcat.apache.org/migration-10.1.html
- Apache Tomcat Jakarta EE migration tool: https://github.com/apache/tomcat-jakartaee-migration
- OpenRewrite Jakarta migration recipe: https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-029.md">⬅️ Part 29 — Performance Engineering for Deployment Models</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-031.md">Part 31 — Production Deployment Patterns and Decision Framework ➡️</a>
</div>
