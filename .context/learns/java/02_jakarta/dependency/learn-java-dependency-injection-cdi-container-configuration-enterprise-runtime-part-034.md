# Part 034 — Migration and Modernization Playbook

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-034.md`  
Status seri: **belum selesai** — setelah bagian ini masih ada **Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton**.

---

## 0. Tujuan Bagian Ini

Bagian ini adalah playbook modernisasi. Setelah memahami dependency graph, container, CDI, scopes, proxy, producers, events, interceptors, decorators, Enterprise Beans, resource injection, JNDI, configuration, profiles, feature flags, concurrency, testing, debugging, dan architecture patterns, sekarang kita membahas cara membawa aplikasi enterprise Java lama menuju runtime modern tanpa merusak behavior produksi.

Modernisasi Java enterprise bukan sekadar:

```text
replace javax.* with jakarta.*
upgrade Java version
replace EJB with CDI
move WAR to container image
```

Modernisasi yang benar adalah **behavior-preserving transformation** pada beberapa lapisan sekaligus:

```text
source code
build graph
runtime container
namespace
configuration
resource binding
transaction semantics
security semantics
classloading
deployment artifact
operational model
test strategy
rollback path
```

Top engineer tidak menilai migration dari “apakah compile berhasil”, tetapi dari:

1. Apakah behavior bisnis tetap sama?
2. Apakah runtime semantics tetap benar?
3. Apakah failure mode dipahami sebelum cutover?
4. Apakah rollback realistis?
5. Apakah perubahan bisa diaudit?
6. Apakah dependency graph menjadi lebih sehat?
7. Apakah modernisasi mengurangi risiko jangka panjang, bukan hanya memindahkan masalah?

---

## 1. Migration Is Not One Problem

Salah satu framing yang lemah adalah menganggap migrasi Java EE/Jakarta EE sebagai satu pekerjaan besar. Sebenarnya migrasi terdiri dari beberapa jenis perubahan yang berbeda.

```text
Migration dimensions:

1. Java language/runtime migration
   Java 8 -> 11 -> 17 -> 21 -> 25

2. Specification namespace migration
   javax.* -> jakarta.*

3. Platform migration
   Java EE 8 -> Jakarta EE 9/10/11

4. Server migration
   WebLogic / WebSphere / JBoss / GlassFish / Payara / WildFly / Liberty / TomEE / Tomcat

5. Packaging migration
   EAR -> WAR -> executable JAR -> container image

6. Component model migration
   EJB -> CDI
   JNDI lookup -> CDI producer/resource abstraction
   deployment descriptor -> annotation/config

7. Configuration migration
   server env-entry -> MicroProfile Config / container env / secret manager

8. Operational migration
   VM/app server -> Kubernetes/container runtime

9. Observability migration
   log-only -> metrics/traces/health/config diagnostics

10. Test migration
    manual smoke -> automated contract/container/regression testing
```

Jika semua dimensi digabung menjadi satu epic tanpa pemisahan, risiko meningkat drastis. Sebaliknya, jika setiap dimensi dipisahkan, kita bisa menentukan urutan yang aman.

---

## 2. Core Principle: Preserve Behavior, Then Improve Structure

Modernisasi yang sehat biasanya punya dua fase besar.

```text
Phase 1 — Make it equivalent
- Same business behavior
- Same transaction boundary
- Same security behavior
- Same external API contract
- Same database schema behavior
- Same resource binding
- Same operational behavior

Phase 2 — Make it better
- Cleaner CDI wiring
- Better config model
- Smaller deployment unit
- Better tests
- Better observability
- Less vendor lock-in
- Better startup/runtime performance
- Better rollback and release mechanism
```

Kesalahan umum adalah langsung melakukan refactor arsitektur ketika aplikasi belum berhasil dipindahkan secara equivalent. Akibatnya, ketika ada bug, tim tidak tahu apakah bug berasal dari:

- namespace change,
- server change,
- JDK change,
- refactor code,
- transaction boundary berubah,
- config berubah,
- atau data/environment issue.

Aturan praktis:

```text
Do not combine semantic refactoring with platform migration unless you have strong tests and rollback.
```

---

## 3. Migration Baseline Matrix

Sebelum migrasi, buat matrix baseline. Jangan mulai dari code search saja.

```text
Application baseline:

Java runtime:
- Current JDK version
- Target JDK version
- Compiler source/target/release
- GC flags
- Illegal reflective access warnings
- Removed/deprecated JVM flags

Platform:
- Current Java EE/Jakarta EE version
- Target Jakarta EE version
- Current namespace: javax or jakarta
- Target namespace

Server:
- Current app server
- Target runtime/server
- Supported spec versions
- Server-provided APIs
- Classloading model
- Deployment format

Packaging:
- EAR/WAR/JAR
- Shared libraries
- Server module dependencies
- Deployment descriptors

Dependency:
- Maven/Gradle dependency tree
- BOM usage
- javax dependencies
- jakarta dependencies
- vendor-specific dependencies
- duplicate APIs
- shaded/transformed libraries

Runtime integration:
- DataSource/JMS/Mail/JCA resources
- JNDI names
- Security realm
- Identity provider
- Transaction manager
- Timer service
- Batch jobs
- Managed executors

Behavior:
- Public API endpoints
- Scheduled jobs
- Async jobs
- External connectors
- DB writes
- Auditing
- Authorization
- Error handling

Configuration:
- Env vars
- System properties
- Server config
- Deployment descriptors
- Property files
- Secret sources
- Runtime mutable config

Tests:
- Unit tests
- Integration tests
- Container tests
- Contract tests
- Smoke tests
- Load tests
```

Tanpa baseline, migration plan akan penuh asumsi.

---

## 4. Java Version Migration: 8 → 11 → 17 → 21 → 25

### 4.1 Why Java Version Migration Is Separate From Jakarta Migration

Java version migration dan Jakarta namespace migration adalah dua hal berbeda.

```text
Java 8 application can use javax.*
Java 17 application can still use javax.* if dependencies/server support it
Jakarta EE 11 requires Java SE 17+
Jakarta namespace does not automatically mean Java 21/25
```

Jadi jangan menyamakan:

```text
javax -> jakarta
```

dengan:

```text
Java 8 -> Java 25
```

Keduanya bisa saling memengaruhi, tetapi failure mode-nya berbeda.

---

### 4.2 Java 8 to 11: First Big Runtime Break

Risiko utama:

- Java EE/Jakarta APIs tidak lagi bundled di JDK.
- JAXB/JAX-WS/CORBA-related modules yang dulu tersedia bisa hilang dari JDK modern.
- Illegal reflective access warnings mulai muncul.
- TLS/security defaults berubah.
- GC flags berubah.
- Some old libraries assume Java 8 internals.

Checklist:

```text
[ ] Use --release instead of only source/target where appropriate.
[ ] Remove reliance on JDK-bundled Java EE APIs.
[ ] Add explicit dependencies for APIs previously included implicitly.
[ ] Run full integration tests on target JDK.
[ ] Check TLS/certificate behavior.
[ ] Check reflection warnings.
[ ] Check old bytecode generation libraries.
[ ] Check application server support for target JDK.
```

---

### 4.3 Java 11 to 17: Modern LTS Baseline

Java 17 is especially important because Jakarta EE 11 requires Java SE 17 or higher.

Risiko utama:

- Stronger encapsulation impact.
- Old reflection-heavy libraries may fail.
- Older app servers may not support Java 17.
- Libraries compiled for newer bytecode cannot run on older runtime.
- Security manager deprecation/removal implications for legacy patterns.

Checklist:

```text
[ ] Confirm server support for Java 17.
[ ] Confirm dependency versions support Java 17.
[ ] Run with production-like JVM flags.
[ ] Remove obsolete JVM options.
[ ] Check reflection/module access errors.
[ ] Validate startup and shutdown hooks.
[ ] Validate classloading behavior.
```

---

### 4.4 Java 17 to 21: Virtual Thread Era, But Not Magic

Java 21 brings virtual threads as a stable platform feature, but enterprise migration should not blindly switch all execution to virtual threads.

Virtual threads are most useful when:

- workload is mostly blocking I/O,
- thread-per-request model causes high platform-thread overhead,
- libraries are virtual-thread friendly,
- container/runtime supports the model safely.

But beware:

- JDBC drivers still perform blocking I/O.
- Connection pool limits still matter.
- Transaction context propagation still matters.
- Request/security/CDI context still matters.
- ThreadLocal usage can still surprise you.
- CPU-bound workload does not become faster just because it uses virtual threads.

Migration rule:

```text
Virtual threads change scheduling cost, not resource capacity.
```

If your bottleneck is database connection pool, remote API rate limit, row lock, or transaction duration, virtual threads may increase pressure instead of solving the bottleneck.

---

### 4.5 Java 21 to 25: Modern Runtime, Same Discipline

Java 25 is a modern long-term Java platform generation, but migration discipline remains the same:

```text
Do not treat latest JDK as a free performance upgrade.
```

Checklist:

```text
[ ] Confirm application server support for Java 25.
[ ] Confirm framework/provider support.
[ ] Confirm build plugins support Java 25 bytecode.
[ ] Confirm CI image and production image parity.
[ ] Run performance regression tests.
[ ] Run memory/GC comparison.
[ ] Check container CPU/memory limits.
[ ] Check reflection/native/agent tooling compatibility.
```

---

## 5. `javax.*` → `jakarta.*`: Namespace Migration Model

### 5.1 What Changed

The breaking change is not conceptual only. Package names changed.

Examples:

```java
// Java EE / Jakarta EE 8 era
import javax.inject.Inject;
import javax.enterprise.context.ApplicationScoped;
import javax.persistence.Entity;
import javax.ws.rs.GET;
import javax.ejb.Stateless;
import javax.annotation.PostConstruct;

// Jakarta EE 9+ era
import jakarta.inject.Inject;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.Entity;
import jakarta.ws.rs.GET;
import jakarta.ejb.Stateless;
import jakarta.annotation.PostConstruct;
```

This affects:

```text
source code
compiled class constant pool
annotations
XML descriptors
JSPs
TLDs
reflection strings
serialized references in rare cases
configuration files
third-party libraries
server APIs
```

That is why text replacement alone is insufficient.

---

### 5.2 Mixed Namespace Trap

A common disaster:

```text
Application code: jakarta.*
Library A: javax.persistence.Entity
Runtime server: Jakarta EE 10/11
Result: class exists but annotations are not recognized as Jakarta annotations
```

Another disaster:

```text
Application code: javax.*
Server: Jakarta EE 10/11 only
Result: runtime cannot satisfy old API types
```

Because `javax.persistence.Entity` and `jakarta.persistence.Entity` are different Java types. They are not aliases.

```text
javax.persistence.Entity != jakarta.persistence.Entity
javax.inject.Inject != jakarta.inject.Inject
javax.enterprise.context.ApplicationScoped != jakarta.enterprise.context.ApplicationScoped
```

Migration invariant:

```text
Inside one runtime boundary, avoid mixing javax and jakarta APIs for the same specification family.
```

There are exceptions at integration edges, but they must be explicit and isolated.

---

### 5.3 Migration Modes

#### Mode A — Source Migration

Change source imports and dependencies.

Pros:

- Clean long-term result.
- Better for active codebase.
- Easier to reason about.
- Test failures map to source.

Cons:

- Requires source availability.
- Requires third-party library compatibility.
- Requires larger code review.

Use when:

```text
You own the source and intend to maintain the code long-term.
```

---

#### Mode B — Binary Transformation

Transform compiled artifacts from `javax` to `jakarta` using tools.

Pros:

- Useful when source is not available.
- Faster for initial compatibility smoke.
- Can help third-party or legacy artifacts.

Cons:

- Can hide technical debt.
- Transformed artifact differs from source.
- Debugging may become confusing.
- Not all semantic issues are solved.

Use when:

```text
You need temporary bridge compatibility or cannot modify source immediately.
```

---

#### Mode C — Runtime Adapter Boundary

Keep legacy code in a separate runtime boundary and communicate via stable protocol.

Example:

```text
Legacy Java EE 8 service (javax)  <---HTTP/JMS/Event/API--->  Modern Jakarta EE service (jakarta)
```

Pros:

- Avoids mixed namespace inside same JVM.
- Allows incremental migration.
- Good for large systems.

Cons:

- Distributed-system complexity.
- More operational overhead.
- Data consistency boundary must be explicit.

Use when:

```text
The application is too large or risky for one-shot migration.
```

---

#### Mode D — Big Bang Migration

Move everything at once.

Pros:

- Simpler final state.
- No long transitional architecture.

Cons:

- High regression risk.
- Hard to isolate failure cause.
- Hard rollback if data/config changed.

Use only when:

```text
Application is small, tests are strong, environment is controlled, and downtime/rollback is acceptable.
```

---

## 6. Dependency Modernization

### 6.1 Start With Dependency Tree, Not Code Search

Before modifying imports, inspect dependency graph.

Maven:

```bash
mvn -DskipTests dependency:tree > dependency-tree.txt
mvn -DskipTests dependency:analyze
```

Gradle:

```bash
./gradlew dependencies > dependencies.txt
./gradlew dependencyInsight --dependency jakarta
./gradlew dependencyInsight --dependency javax
```

Search for both namespaces:

```bash
grep -R "javax\." -n src pom.xml build.gradle* .
grep -R "jakarta\." -n src pom.xml build.gradle* .
```

But remember: compiled JARs can contain `javax.*` references even if source tree does not.

Useful checks:

```bash
jar tf some-library.jar | grep -E "javax|jakarta"

jdeps --multi-release 17 --ignore-missing-deps --recursive target/app.war
```

---

### 6.2 API Dependency Rule

In a full Jakarta EE server deployment, many Jakarta APIs should be `provided`, not bundled.

Example Maven:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Why?

Because server provides the implementation and usually the API. Bundling duplicate API JARs can create classloading conflicts.

For standalone/embedded runtimes, the rule can differ:

```text
Full app server WAR:
- Jakarta API usually provided
- implementation provided by server

Executable JAR / microframework:
- API and implementation often packaged
- runtime owns provider composition
```

---

### 6.3 Use BOMs

A migration without a BOM often ends in version soup.

Maven pattern:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-bom</artifactId>
      <version>11.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Then avoid specifying random versions for every Jakarta API.

For MicroProfile:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.eclipse.microprofile</groupId>
      <artifactId>microprofile-bom</artifactId>
      <version>...</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

But align with runtime support. Do not import latest MicroProfile BOM if the target server only supports older MicroProfile APIs.

---

### 6.4 Enforce Convergence

Use build rules to prevent accidental dependency drift.

Maven Enforcer examples:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <dependencyConvergence />
          <requireJavaVersion>
            <version>[17,)</version>
          </requireJavaVersion>
          <banDuplicateClasses />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Dependency convergence is not bureaucracy. It prevents runtime errors like:

```text
NoSuchMethodError
NoClassDefFoundError
ClassCastException
LinkageError
Annotation not recognized
Provider mismatch
```

---

## 7. Replacing EJB With CDI: When and How

### 7.1 Do Not Replace EJB Blindly

EJB is not just an annotation set. It is a container service model.

EJB may provide:

```text
transaction boundary
pooling
stateful conversation
singleton concurrency
timer service
async invocation
security roles
remote interface
message-driven integration
passivation
container-managed lifecycle
```

If you replace:

```java
@Stateless
public class CaseService { ... }
```

with:

```java
@ApplicationScoped
public class CaseService { ... }
```

you may have changed:

- pooling semantics,
- transaction defaults,
- concurrency semantics,
- proxy behavior,
- security boundary,
- lifecycle behavior.

---

### 7.2 EJB to CDI Mapping Table

| Existing EJB Use | Possible Modern Replacement | Risk |
|---|---|---|
| Stateless service with CMT | CDI bean + `@Transactional` | Check transaction attributes and rollback behavior |
| Stateless service without EJB-specific features | CDI `@ApplicationScoped` or `@Dependent` service | Usually straightforward |
| Singleton EJB with lock semantics | CDI singleton/application bean + explicit concurrency control | Must preserve lock/read/write semantics |
| Stateful session bean | CDI conversation/session scope or explicit state store | High risk; state ownership changes |
| Timer service | Managed scheduler / Jakarta Concurrency / app server timer / external scheduler | Duplicate execution and failover semantics matter |
| `@Asynchronous` | ManagedExecutorService / CompletionStage / MicroProfile Context Propagation | Context propagation differs |
| Remote EJB | REST/gRPC/messaging boundary | API contract and security must be redesigned |
| Message-driven bean | Jakarta Messaging listener / vendor integration / messaging framework | Transaction and redelivery semantics matter |

---

### 7.3 Safe Migration Pattern: Wrap Before Replace

Instead of replacing EJB immediately, create a stable application interface.

Before:

```java
@Stateless
public class LegacyCaseEJB {
    public void approve(CaseId id) { ... }
}
```

Step 1 — introduce interface:

```java
public interface CaseApprovalUseCase {
    void approve(CaseId id);
}
```

Step 2 — let EJB implement it:

```java
@Stateless
public class LegacyCaseEJB implements CaseApprovalUseCase {
    @Override
    public void approve(CaseId id) { ... }
}
```

Step 3 — move callers to interface injection:

```java
@Inject
CaseApprovalUseCase approval;
```

Step 4 — later replace implementation:

```java
@ApplicationScoped
public class CdiCaseApprovalUseCase implements CaseApprovalUseCase {
    @Transactional
    public void approve(CaseId id) { ... }
}
```

Step 5 — switch with qualifier/alternative/profile only after tests pass.

This gives a controlled migration boundary.

---

### 7.4 Preserve Transaction Semantics

EJB transaction attributes do not map one-to-one blindly.

Example EJB:

```java
@Stateless
public class PaymentEJB {
    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void recordAudit(...) { ... }
}
```

CDI/Jakarta Transactions equivalent conceptually:

```java
@ApplicationScoped
public class PaymentAuditService {
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void recordAudit(...) { ... }
}
```

But verify:

- rollback rules,
- checked exception behavior,
- self-invocation behavior,
- proxy invocation path,
- transaction manager integration,
- exception translation.

Migration invariant:

```text
Every method that was an EJB transaction boundary must be explicitly classified during migration.
```

Do not rely on “it probably has same default”.

---

## 8. JNDI to CDI Producer / Config Abstraction

### 8.1 Why Direct JNDI Lookup Ages Poorly

Legacy code often does this:

```java
DataSource ds = (DataSource) new InitialContext()
    .lookup("java:comp/env/jdbc/MainDS");
```

Problems:

- lookup string scattered everywhere,
- difficult to test,
- environment binding hidden,
- harder to migrate runtime,
- failure happens late,
- no typed abstraction.

---

### 8.2 Use Resource Injection or Producer Boundary

Better:

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(lookup = "java:comp/env/jdbc/MainDS")
    private DataSource mainDataSource;

    @Produces
    @MainDatabase
    public DataSource mainDataSource() {
        return mainDataSource;
    }
}
```

Then application code depends on typed injection:

```java
@Inject
@MainDatabase
DataSource dataSource;
```

Now JNDI name is localized to infrastructure boundary.

---

### 8.3 Migration Pattern

```text
Step 1: Inventory all JNDI lookup strings.
Step 2: Classify resources: DataSource, JMS, Mail, env-entry, executor, custom resource.
Step 3: Create typed qualifiers for important resources.
Step 4: Create producer/resource adapter classes.
Step 5: Replace direct lookups in business code.
Step 6: Add startup validation.
Step 7: Add test replacement producer.
Step 8: Move environment-specific names to deployment/config boundary where possible.
```

Example qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface MainDatabase {}
```

---

## 9. Deployment Descriptor to Annotation/Config Migration

Legacy enterprise apps may rely on:

```text
web.xml
ejb-jar.xml
application.xml
persistence.xml
server-specific XML
resource descriptors
security role mapping
```

Do not delete descriptors just because annotations exist.

Descriptor migration checklist:

```text
[ ] Which descriptor entries define behavior?
[ ] Which entries override annotations?
[ ] Which entries bind resources?
[ ] Which entries define roles/security?
[ ] Which entries define servlet/filter/listener order?
[ ] Which entries define transaction/security for EJB?
[ ] Which entries are server-specific?
[ ] Which entries are dead?
```

Safe approach:

```text
1. Inventory descriptor behavior.
2. Convert only low-risk entries first.
3. Keep resource/security bindings explicit.
4. Add tests/smoke checks for startup and auth.
5. Remove descriptors gradually.
```

Annotations are not automatically superior. Descriptors can be useful when deployment environment must override behavior without recompilation. The key is to avoid invisible duplication and contradictory declarations.

---

## 10. EAR to WAR/JAR/Container Image

### 10.1 EAR Modernization

EAR was useful for multi-module enterprise apps:

```text
application.ear
├── web-module.war
├── ejb-module.jar
├── shared-lib.jar
└── META-INF/application.xml
```

Modern deployments often prefer smaller units:

```text
case-api.war
case-worker.jar
notification-service.jar
reporting-service.jar
```

But do not split just because microservices are fashionable.

Ask:

```text
Is there an independent release cadence?
Is there independent scaling need?
Is there a clear data ownership boundary?
Is there a stable API/event boundary?
Can operations handle more deployables?
Can transactions be redesigned safely?
```

If not, modular monolith may be safer.

---

### 10.2 Split Criteria

Good split candidate:

```text
- clear ownership boundary
- stable API contract
- limited shared transaction requirement
- independent scaling or deployment need
- low synchronous chatter
- separate operational risk profile
```

Bad split candidate:

```text
- shares same tables heavily
- requires distributed transaction
- has chatty internal calls
- no separate team ownership
- no independent release need
- split only because package is large
```

---

### 10.3 Container Image Migration

A container image is not just packaging. It changes operational assumptions.

Checklist:

```text
[ ] Externalize config.
[ ] Do not write mutable business state to local filesystem.
[ ] Configure graceful shutdown.
[ ] Ensure readiness/liveness/startup probes.
[ ] Ensure logs go to stdout/stderr or logging sidecar/agent.
[ ] Handle SIGTERM.
[ ] Validate connection pool sizing per replica.
[ ] Validate cluster scheduling and resource limits.
[ ] Do not assume single instance.
[ ] Validate session/state strategy.
[ ] Validate timer/scheduler duplication behavior.
```

---

## 11. Configuration Migration

### 11.1 Classify Existing Config

Before moving config to MicroProfile Config or env vars, classify it.

```text
Config inventory:

- database connection names
- datasource credentials
- external API URLs
- API credentials
- timeout values
- retry counts
- feature toggles
- scheduler cron expressions
- batch sizes
- email templates/path
- filesystem paths
- security roles/mapping
- tenant/agency settings
- logging levels
- cache TTLs
- rate limits
```

Then classify by change timing:

| Type | Example | Change Timing |
|---|---|---|
| Build-time | generated code mode | build only |
| Deploy-time | environment name | deployment |
| Startup-time | base URL, pool size | restart needed |
| Runtime mutable | kill switch, flag | no restart ideally |
| Secret | API key/password | secret rotation model needed |

---

### 11.2 Required vs Optional Config

Bad:

```java
String endpoint = config.getOptionalValue("partner.endpoint", String.class)
    .orElse("http://localhost:8080");
```

This may route production traffic to a wrong default.

Better:

```java
String endpoint = config.getValue("partner.endpoint", String.class);
```

Or explicit safe default only when valid:

```java
int timeoutMs = config.getOptionalValue("partner.timeout.ms", Integer.class)
    .orElse(3000);
```

Rule:

```text
A default is safe only if it is valid in production and does not hide misconfiguration.
```

---

### 11.3 Config Migration Steps

```text
Step 1: Inventory config keys and sources.
Step 2: Mark each key as secret/non-secret.
Step 3: Mark each key as required/defaultable.
Step 4: Mark each key as build/deploy/startup/runtime.
Step 5: Create typed config access layer.
Step 6: Add startup validation.
Step 7: Add safe config diagnostics endpoint/log.
Step 8: Replace scattered config reads.
Step 9: Remove dead keys.
Step 10: Document operational owner and rotation process.
```

Example typed boundary:

```java
@ApplicationScoped
public class PartnerApiConfig {

    @Inject
    @ConfigProperty(name = "partner.api.base-url")
    URI baseUrl;

    @Inject
    @ConfigProperty(name = "partner.api.timeout-ms", defaultValue = "3000")
    int timeoutMs;

    @PostConstruct
    void validate() {
        if (!baseUrl.getScheme().equals("https")) {
            throw new IllegalStateException("partner.api.base-url must be HTTPS");
        }
    }
}
```

---

## 12. Security Migration

Security migration is often underestimated.

Check:

```text
Authentication:
- old realm
- new realm
- OIDC/SAML/form/basic/client cert
- token claims
- session/cookie behavior

Authorization:
- role names
- group mapping
- app server roles
- method-level annotations
- URL constraints
- UI role assumptions

Identity propagation:
- caller principal
- run-as
- async context
- downstream API token
- audit identity

Session:
- timeout
- idle timeout
- remember-me
- logout
- SSO
- cross-app switcher

Audit:
- who did what
- on whose behalf
- source channel
- correlation ID
```

Do not migrate security only by “login works”. Test authorization denial paths.

Security regression tests:

```text
[ ] anonymous denied
[ ] wrong role denied
[ ] correct role allowed
[ ] cross-tenant/agency access denied
[ ] audit principal correct
[ ] async operation preserves correct identity or explicitly drops it
[ ] logout invalidates expected sessions
[ ] token expiry behavior correct
```

---

## 13. Transaction and Persistence Migration

This series already covered JPA elsewhere, so here we only focus on migration risk.

Transaction inventory:

```text
[ ] Which methods start transactions?
[ ] Which methods require existing transaction?
[ ] Which methods suspend transaction?
[ ] Which operations require REQUIRES_NEW?
[ ] Which exceptions trigger rollback?
[ ] Which checked exceptions are expected business outcomes?
[ ] Which operations rely on flush timing?
[ ] Which operations rely on lazy loading after method return?
[ ] Which async/timer operations open transactions?
```

Common migration bug:

```java
public void outer() {
    innerRequiresNew(); // self-invocation: interceptor not applied
}

@Transactional(REQUIRES_NEW)
public void innerRequiresNew() { ... }
```

If `innerRequiresNew()` is called directly on `this`, proxy/interceptor may not apply.

Migration fix:

- split into another bean,
- inject proxy of same service carefully,
- redesign transaction boundary.

Best practice:

```text
Transaction boundaries should be visible at application service boundary, not scattered randomly across helper methods.
```

---

## 14. Timer, Scheduler, and Batch Migration

Legacy EJB timer and batch jobs are high risk because they execute without direct user request.

Inventory:

```text
[ ] All scheduled jobs
[ ] Cron/calendar expressions
[ ] Persistent vs non-persistent timers
[ ] Cluster behavior
[ ] Transaction behavior
[ ] Retry/redelivery behavior
[ ] Idempotency guarantees
[ ] Locking/leader election
[ ] Manual rerun process
[ ] Failure notification
[ ] Audit/logging
```

Container image/Kubernetes risk:

```text
If every replica starts the same scheduler, job may run N times.
```

Mitigation options:

```text
- external scheduler triggers one endpoint/job
- leader election
- DB-based lock
- app-server persistent timer semantics
- Kubernetes CronJob
- messaging queue with competing consumers
```

But choose based on semantics, not convenience.

---

## 15. Observability Upgrade During Migration

Migration without observability is gambling.

Minimum migration observability:

```text
Startup:
- active profile/environment
- server/runtime version
- Java version
- app version/git commit
- loaded config keys except secrets
- datasource/resource binding result
- feature flag provider status

Runtime:
- request correlation ID
- transaction boundary error
- external API latency/error
- DB pool metrics
- thread/executor metrics
- timer/job execution status
- config lookup failure
- feature flag evaluation failure

Deployment:
- readiness health
- liveness health
- startup health
- dependency health
```

Do not log secrets. Do log presence, source class, and safe fingerprint when necessary.

Example safe config diagnostic:

```text
partner.api.base-url = present, source=env, value=https://partner.example.gov
partner.api.token = present, source=secret, value=<redacted>, fingerprint=sha256:ab12...
```

---

## 16. Testing Strategy for Migration

### 16.1 Test Pyramid for Migration

```text
Migration test layers:

1. Compile tests
   - namespace resolved
   - dependency graph valid

2. Unit tests
   - business logic preserved
   - no container needed

3. Component/CDI tests
   - injection graph valid
   - alternatives/producers/config work

4. Container tests
   - transactions
   - security
   - resource injection
   - JNDI
   - interceptors
   - EJB behavior

5. Contract tests
   - external API behavior unchanged
   - request/response/error contract

6. Database integration tests
   - schema compatibility
   - transaction/locking
   - migration scripts

7. Smoke tests
   - deploy, login, key flows

8. Regression tests
   - critical workflows

9. Load/performance tests
   - pool sizing
   - startup time
   - memory
   - latency

10. Failure injection
    - missing config
    - bad credentials
    - downstream timeout
    - DB unavailable
    - feature flag provider down
```

---

### 16.2 Golden Master / Characterization Testing

For legacy systems with weak tests, start by capturing behavior.

```text
Characterization tests do not ask: is old behavior ideal?
They ask: what does current system actually do?
```

Examples:

```text
- API response snapshot for critical endpoints
- audit trail shape
- database side effects
- authorization decisions
- validation error format
- transaction rollback behavior
- scheduled job output
```

Then use those as guardrails during modernization.

---

### 16.3 Migration Test Matrix

Create a matrix.

| Scenario | Old Runtime | New Runtime | Must Match? |
|---|---:|---:|---|
| Login success | ✅ | ✅ | yes |
| Unauthorized role denied | ✅ | ✅ | yes |
| Case approval creates audit | ✅ | ✅ | yes |
| Downstream timeout maps to expected error | ✅ | ✅ | yes |
| Validation error format | ✅ | ✅ | usually yes |
| Timer job runs once per schedule | ✅ | ✅ | yes |
| Missing required config fails startup | maybe no | ✅ | intended improvement |

Not every behavior must match if the old behavior is wrong. But intentional differences must be documented.

---

## 17. Rollback Strategy

Rollback is not only redeploying old artifact.

Rollback dimensions:

```text
Application binary rollback
Database schema rollback
Configuration rollback
Secret rollback
Feature flag rollback
Data migration rollback
Message queue compatibility
External API contract rollback
Session compatibility
Cache compatibility
```

If database migration is not backward-compatible, binary rollback may fail.

Safe DB migration pattern:

```text
Expand -> Migrate -> Contract

1. Expand schema with backward-compatible additions.
2. Deploy application that can read/write both or tolerate old/new shape.
3. Backfill data.
4. Switch behavior.
5. Remove old columns/tables only after safe window.
```

For Jakarta namespace migration, rollback may be easier if:

- database unchanged,
- config keys backward-compatible,
- external API unchanged,
- artifacts deployed side-by-side.

---

## 18. Incremental Strangler Pattern

For a large enterprise system, consider strangler migration.

```text
Legacy runtime                        Modern runtime
(Java EE 8 / javax)                   (Jakarta EE 11 / jakarta)
        |                                      |
        +------------- API gateway ------------+
                       routing
```

Move capability-by-capability:

```text
1. Read-only endpoints
2. Low-risk admin features
3. Independent background jobs
4. Connector adapters
5. New feature modules
6. High-risk transactional workflows last
```

But strangler only works if boundaries are real. If both sides write same tables without coordination, you may create data integrity issues.

Use strangler when:

```text
- application is large
- risk of big bang is unacceptable
- API boundaries can be introduced
- team can operate two runtimes temporarily
```

Avoid strangler when:

```text
- system is small
- data coupling is extreme
- no team capacity for dual operation
- transition would last indefinitely
```

---

## 19. Runtime Compatibility Checklist

Before target runtime selection:

```text
[ ] Supports target Jakarta EE version.
[ ] Supports target Java version.
[ ] Supports required MicroProfile version if used.
[ ] Supports CDI Full/Lite needs.
[ ] Supports Enterprise Beans if still needed.
[ ] Supports JPA provider requirements.
[ ] Supports JMS/resource adapters if needed.
[ ] Supports security integration.
[ ] Supports clustering/session behavior.
[ ] Supports metrics/health/tracing integrations.
[ ] Supports container image deployment style.
[ ] Has vendor support/community maturity.
[ ] Has documented migration path.
```

Do not choose runtime based only on startup time if your app still needs full Enterprise Beans, JTA, JMS, or legacy resource adapters.

---

## 20. Cloud/Kubernetes Readiness Checklist

If modernization includes cloud/container migration:

```text
[ ] App can start with environment-provided config.
[ ] App fails fast on missing required config.
[ ] App handles SIGTERM gracefully.
[ ] DB pool size multiplied by replicas is safe.
[ ] External API rate limit multiplied by replicas is safe.
[ ] Scheduler/timer does not duplicate unexpectedly.
[ ] Session state is externalized or sticky behavior is intentional.
[ ] Local filesystem usage is ephemeral-safe.
[ ] Logs include correlation ID.
[ ] Readiness waits for critical dependencies or explicit degraded mode.
[ ] Startup probe accounts for slow boot.
[ ] Liveness does not kill app during temporary downstream outage.
[ ] Secrets are not in image or logs.
[ ] Image uses supported base JDK/runtime.
```

A common modernization failure:

```text
Old VM: 1 app instance, DB pool max 100
New K8s: 8 replicas, DB pool max 100 each
Total potential DB connections: 800
Database cannot handle it
```

Containerization multiplies resource usage. Always recalculate capacity.

---

## 21. Modernization Anti-Patterns

### 21.1 Namespace Search-and-Replace Only

```text
Symptom:
- imports changed
- compile passes
- runtime fails in provider/library/descriptors

Root cause:
- binary/config/XML/dependency still references javax
```

Fix:

```text
Run dependency scan, descriptor scan, jdeps, integration tests.
```

---

### 21.2 Removing EJB Without Replacing Semantics

```text
Symptom:
- transaction behavior changes
- timers duplicate
- singleton races
- async loses context

Root cause:
- EJB was providing runtime services implicitly
```

Fix:

```text
Inventory EJB services before replacement.
```

---

### 21.3 Treating Config as Strings Everywhere

```text
Symptom:
- missing config discovered during traffic
- defaults hide mistakes
- secrets logged
- environment drift

Root cause:
- no typed config boundary and no startup validation
```

Fix:

```text
Typed config classes, validation, safe diagnostics.
```

---

### 21.4 Big Bang Refactor During Platform Migration

```text
Symptom:
- too many failures
- cannot identify cause
- rollback unclear

Root cause:
- migration and redesign mixed
```

Fix:

```text
Preserve behavior first, improve structure second.
```

---

### 21.5 Ignoring Classloader Boundaries

```text
Symptom:
- ClassCastException X cannot be cast to X
- provider mismatch
- annotation not recognized

Root cause:
- duplicate APIs or server/app classloading conflict
```

Fix:

```text
Align provided dependencies and deployment classloader model.
```

---

## 22. Risk Matrix

| Risk | Probability | Impact | Detection | Mitigation |
|---|---:|---:|---|---|
| Mixed `javax`/`jakarta` dependencies | High | High | dependency tree, jdeps, runtime smoke | align BOM, remove mixed APIs, transform/replace libs |
| Transaction behavior changed | Medium | Critical | integration tests, DB side-effect tests | transaction inventory, explicit annotations |
| Security role mapping changed | Medium | Critical | authorization regression tests | role matrix, deny-path tests |
| JNDI/resource binding fails | Medium | High | startup smoke, resource health | producer boundary, startup validation |
| Timer duplicates in cluster | Medium | High | scheduler tests, logs | leader election/lock/external scheduler |
| Config missing/wrong | High | High | startup validation | typed config, required keys, safe diagnostics |
| Library unsupported on target JDK | Medium | High | CI on target JDK | upgrade dependencies, compatibility matrix |
| Server lacks required spec | Medium | High | runtime compatibility check | choose correct server/profile |
| Performance regression | Medium | Medium/High | load test | pool tuning, profiling, rollback |
| Rollback impossible due DB changes | Medium | Critical | migration review | expand-contract DB migration |

---

## 23. Practical Migration Sequence

A safe sequence for a large Java EE 8 / Java 8 / `javax.*` enterprise app might be:

```text
Phase 0 — Assessment
[ ] Inventory code, dependencies, descriptors, resources, runtime features.
[ ] Build migration matrix.
[ ] Establish critical workflow regression tests.
[ ] Establish startup smoke and deployment automation.

Phase 1 — Build hygiene
[ ] Add BOM/dependency management.
[ ] Add dependency convergence checks.
[ ] Remove duplicate APIs.
[ ] Document provided/runtime dependencies.

Phase 2 — Java runtime step
[ ] Move Java 8 -> 11 or 17 as supported by current runtime.
[ ] Fix removed APIs and illegal reflection.
[ ] Validate tests and production-like smoke.

Phase 3 — Namespace/platform preparation
[ ] Identify all javax dependencies.
[ ] Upgrade libraries with jakarta-compatible versions.
[ ] Transform or isolate unmaintained libraries.
[ ] Update descriptors/XML/config references.

Phase 4 — Runtime target
[ ] Select Jakarta EE 10/11 runtime.
[ ] Create minimal deployment POC.
[ ] Validate DataSource/JMS/security/config.

Phase 5 — Application migration
[ ] Migrate source namespace.
[ ] Align dependencies.
[ ] Deploy to target runtime.
[ ] Run container/integration tests.

Phase 6 — Runtime behavior preservation
[ ] Verify transaction semantics.
[ ] Verify security semantics.
[ ] Verify timers/async/batch.
[ ] Verify audit and external integrations.

Phase 7 — Modernization improvements
[ ] Introduce CDI boundaries where useful.
[ ] Wrap JNDI resources behind producers.
[ ] Move config to typed config model.
[ ] Add feature flags/kill switches where useful.
[ ] Replace EJB only where semantics are understood.

Phase 8 — Operational hardening
[ ] Add health/metrics/tracing/log correlation.
[ ] Load/performance test.
[ ] Validate rollback.
[ ] Document runbook.

Phase 9 — Cutover
[ ] Deploy with rollback plan.
[ ] Monitor startup and key workflows.
[ ] Watch DB pool, latency, errors, jobs, security denials.
[ ] Decide continue/rollback based on predefined criteria.
```

---

## 24. Example: Migrating a Regulatory Case Management Platform

Imagine a legacy regulatory case management system.

Modules:

```text
Application
Case
Appeal
Compliance
Correspondence
Exam
Document
Audit Trail
Notification
Report
External Connector
```

Legacy state:

```text
Java 8
Java EE 8
javax.*
EAR deployment
EJB stateless services
JNDI datasource
server-managed mail
some scheduled timers
manual config in server XML
limited integration tests
```

Target:

```text
Java 17/21 first, Java 25 later when runtime certified
Jakarta EE 11 compatible runtime
jakarta.* namespace
WAR/module-based deployment or modular monolith
CDI application services
typed config
resource producers
health/metrics
safer scheduler semantics
```

Safe migration plan:

```text
1. Do not split business modules into microservices first.
2. First establish critical workflow tests:
   - submit application
   - assign case
   - approve/reject
   - appeal
   - generate correspondence
   - audit event created
   - role denial works
3. Inventory all EJB transaction boundaries.
4. Inventory all JNDI resources.
5. Upgrade dependency graph.
6. Migrate namespace.
7. Deploy to Jakarta runtime.
8. Keep EJB initially if still supported.
9. Move direct JNDI lookup to producers.
10. Introduce typed config.
11. Replace EJB with CDI only service by service.
12. Add feature flag for new connector/workflow behavior.
13. Use expand-contract for DB changes.
14. Add operational dashboard before production cutover.
```

This avoids one of the worst patterns:

```text
namespace migration + EJB rewrite + microservice split + DB redesign + cloud migration
```

all in one release.

---

## 25. Decision Matrix: Keep, Wrap, Migrate, Retire

For every old component, decide explicitly.

| Component Type | Keep | Wrap | Migrate | Retire |
|---|---|---|---|---|
| Stable EJB with complex transaction | yes if supported | yes | later | rarely immediately |
| EJB used only as stateless service | maybe | yes | good candidate | no |
| Direct JNDI lookup | no | yes | yes | eventually |
| Server XML config | maybe | document | typed config | dead entries |
| Vendor-specific API | maybe if needed | yes | if portable alternative exists | if unused |
| Stateful session bean | maybe | yes | carefully | if obsolete |
| Timer job | maybe | yes | external scheduler/managed model | if unused |
| Legacy library no jakarta support | temporary | adapter | replace | if unused |

---

## 26. Migration Readiness Scorecard

Use this before execution.

```text
Readiness scorecard:

[ ] Dependency tree is understood.
[ ] javax/jakarta usage is inventoried.
[ ] Target runtime supports required specs.
[ ] Target JDK is supported by runtime and libraries.
[ ] Critical workflows have automated tests.
[ ] Transaction boundaries are mapped.
[ ] Security roles and denial paths are tested.
[ ] JNDI/resources are inventoried.
[ ] Config keys are inventoried and classified.
[ ] Timers/schedulers/batch jobs are inventoried.
[ ] Rollback plan includes binary, config, DB, data, and queues.
[ ] Observability is in place before cutover.
[ ] Performance baseline exists.
[ ] Stakeholders agree on intentional behavior changes.
```

If many boxes are unchecked, the migration is not ready. It may still proceed as a POC, but not as production migration.

---

## 27. Final Mental Model

Enterprise Java modernization is not about chasing newer annotations. It is about moving a system from one **runtime contract** to another while preserving correctness.

The old system may have hidden contracts:

```text
server provides APIs
EJB starts transactions
JNDI binds resources
classloader hides duplicates
server XML overrides annotation
single VM avoids duplicate timers
manual config exists only in one environment
```

The new system must make those contracts explicit:

```text
BOM controls API versions
container/runtime support is documented
transaction boundaries are visible
typed config validates startup
resource injection has producer boundary
feature flags have lifecycle
scheduler has cluster semantics
observability exposes runtime health
rollback is planned
```

That is the difference between cosmetic migration and engineering-grade modernization.

---

## 28. Part Summary

You should now understand:

- migration is multi-dimensional, not one task;
- Java version migration differs from Jakarta namespace migration;
- `javax.*` and `jakarta.*` cannot be casually mixed;
- dependency graph must be cleaned before runtime migration;
- EJB replacement requires semantic mapping, not annotation replacement;
- direct JNDI lookup should be localized behind resource/producer boundaries;
- configuration migration requires classification and validation;
- security, transaction, timer, and async behavior are high-risk areas;
- rollback must include DB/config/data/queues, not only app binary;
- incremental strangler migration can help large systems but adds operational cost;
- modernization should preserve behavior first, improve structure second.

---

## 29. References

- Jakarta EE Platform 11: https://jakarta.ee/specifications/platform/11/
- Jakarta EE 11 Release: https://jakarta.ee/release/11/
- Jakarta EE 9 Release Plan / namespace transition: https://jakartaee.github.io/platform/jakartaee9/JakartaEE9ReleasePlan
- Jakarta CDI 4.1: https://jakarta.ee/specifications/cdi/4.1/
- Jakarta Enterprise Beans 4.0: https://jakarta.ee/specifications/enterprise-beans/4.0/
- Jakarta Transactions: https://jakarta.ee/specifications/transactions/
- MicroProfile Config: https://microprofile.io/specifications/config/
- Eclipse Transformer: https://github.com/eclipse-transformer/transformer
- Apache Tomcat Migration Tool for Jakarta EE: https://tomcat.apache.org/download-migration.cgi
- Apache Tomcat Jakarta migration repository: https://github.com/apache/tomcat-jakartaee-migration
- OpenRewrite Jakarta migration recipes: https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta

---

## 30. Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
[x] Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
[x] Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
[x] Part 009 — Bean Discovery and Archive Model
[x] Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
[x] Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
[x] Part 012 — Qualifiers, Alternatives, Specialization, and Priority
[x] Part 013 — Producers and Disposers: Programmatic Object Supply
[x] Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
[x] Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
[x] Part 016 — Decorators: Semantic Wrapping of Business Interfaces
[x] Part 017 — Stereotypes and Annotation Composition
[x] Part 018 — Lifecycle Callbacks: Construction, Initialization, Destruction
[x] Part 019 — CDI Extensions and Portable Runtime Customization
[x] Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters
[x] Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics
[x] Part 022 — EJB Transactions, Timers, Async, and Security Boundaries
[x] Part 023 — Jakarta Common Annotations and Resource Injection
[x] Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources
[x] Part 025 — Configuration Fundamentals: Values, Secrets, Environments, and Runtime Contracts
[x] Part 026 — MicroProfile Config Deep Dive
[x] Part 027 — Profiles: Environment-Specific Behavior Without Code Forking
[x] Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery
[x] Part 029 — Conditional Beans and Runtime Selection Patterns
[x] Part 030 — Container Concurrency, Managed Executors, and Context Propagation
[x] Part 031 — Testing CDI, EJB, and Configuration-Heavy Code
[x] Part 032 — Observability and Debugging of Dependency/Container Problems
[x] Part 033 — Architecture Patterns for Enterprise Java Runtime Design
[x] Part 034 — Migration and Modernization Playbook
```

Berikutnya:

```text
[ ] Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton
```

Seri **belum selesai**. Masih ada satu bagian terakhir: **Part 035**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-033.md">⬅️ Part 033 — Architecture Patterns for Enterprise Java Runtime Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-035.md">Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton ➡️</a>
</div>
