# learn-java-eclipse-glassfish-runtime-server-engineering-part-030  
# Part 30 — GlassFish Source Code, Modules, Build, dan Contribution-Level Understanding

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 30 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang ingin memahami GlassFish bukan hanya sebagai runtime, tetapi sebagai codebase enterprise application server  
> Fokus part ini: **membaca, membangun, men-debug, dan memahami source code GlassFish pada level contribution/maintainer**: repository, modules, Maven build, HK2, Grizzly, Jersey, EclipseLink, deployment, containers, admin, tests, dan workflow analisis bug

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami GlassFish sebagai **large modular application server codebase**, bukan black box;
2. membaca struktur repository Eclipse GlassFish;
3. memahami relasi antara GlassFish dan project ecosystem lain:
   - Jakarta EE APIs;
   - Grizzly;
   - Jersey;
   - EclipseLink;
   - HK2;
   - OpenMQ;
   - Mojarra;
   - JAXB/JAX-WS related components;
4. memahami build system Maven multi-module GlassFish;
5. memahami module layering:
   - nucleus/core;
   - admin/config;
   - deployment;
   - web container;
   - EJB container;
   - CDI integration;
   - persistence;
   - security;
   - transaction;
   - resources/connectors;
   - distributions;
6. menjalankan build/test dari source secara rasional;
7. men-debug GlassFish runtime dari source;
8. membaca stack trace dan mencari source module yang relevan;
9. memahami contribution workflow:
   - issue;
   - branch;
   - tests;
   - PR;
   - style;
   - compatibility;
   - TCK/regression thinking;
10. membangun mental model untuk memperbaiki bug atau membuat patch internal secara aman.

Part ini adalah transisi dari **runtime operator** menuju **runtime engineer/contributor**.

---

## 1. Mental Model: GlassFish adalah Platform, Bukan Library Tunggal

Aplikasi biasa:

```text
my-app.jar
  |
  |-- business code
  |-- dependencies
```

GlassFish:

```text
GlassFish distribution
  |
  |-- admin server
  |-- config system
  |-- deployment system
  |-- classloading
  |-- web container
  |-- EJB container
  |-- CDI integration
  |-- JPA integration
  |-- transaction manager
  |-- security services
  |-- resource management
  |-- monitoring
  |-- logging
  |-- clustering/HA pieces
  |-- packaging/distribution
  |-- integration with Jakarta EE specifications
```

GlassFish is a **container-of-containers**.

Mental model:

```text
GlassFish kernel / nucleus
  |
  |-- services registered and injected
  |-- containers plugged in
  |-- applications deployed into managed runtime
  |-- resources exposed via naming/config/admin
```

Membaca source GlassFish berarti memahami:

```text
Where does this service live?
Who initializes it?
How is it injected?
Which module owns the behavior?
Which Jakarta spec contract is being implemented?
Which integration project provides the underlying implementation?
```

---

## 2. Kenapa Perlu Membaca Source GlassFish?

Tidak semua engineer perlu menjadi GlassFish contributor. Tetapi engineer top-level perlu bisa membaca source saat:

```text
- stack trace masuk ke org.glassfish.*
- documentation tidak cukup
- runtime behavior ambigu
- deployment failure nested terlalu dalam
- classloading issue aneh
- admin command gagal tanpa pesan jelas
- performance issue di container layer
- security/realm behavior perlu dipahami
- Jakarta migration break
- vendor support lambat
- perlu patch/workaround internal
```

Source reading memberi kemampuan:

```text
black box -> gray box -> white box
```

---

## 3. Repository dan Ecosystem

Project GlassFish berada di Eclipse EE4J ecosystem.

Repository utama:

```text
eclipse-ee4j/glassfish
```

Project terkait:

```text
eclipse-ee4j/jersey
eclipse-ee4j/grizzly
eclipse-ee4j/eclipselink
eclipse-ee4j/glassfish-hk2
eclipse-ee4j/mojarra
eclipse-ee4j/openmq
eclipse-ee4j/jaxb-ri
eclipse-ee4j/metro-jax-ws
```

Konsekuensi:

```text
Bug yang muncul di GlassFish belum tentu berasal dari module GlassFish core.
Bisa berasal dari integration layer atau project dependency.
```

Contoh:

```text
JAX-RS behavior
  -> Jersey

HTTP network runtime
  -> Grizzly

JPA behavior
  -> EclipseLink

DI/service locator
  -> HK2

JMS broker
  -> OpenMQ

JSF
  -> Mojarra
```

---

## 4. High-Level Module Map

GlassFish source adalah Maven multi-module besar.

Mental grouping:

```text
nucleus/
  core runtime, HK2 services, admin, config, deployment base

appserver/
  Jakarta EE containers and services:
  web, ejb, transaction, security, resources, persistence, connectors, etc.

extras/
  optional integrations / extras depending version

nucleus/admin/
  asadmin/admin infrastructure

nucleus/deployment/
  deployment framework

appserver/web/
  web container integration

appserver/ejb/
  EJB container

appserver/persistence/
  JPA integration

appserver/connectors/
  JCA/resources

appserver/security/
  security runtime

appserver/transaction/
  transaction service

distributions/
  build final GlassFish distributions
```

Exact directory names can evolve, but this mental map is useful.

---

## 5. Nucleus: Core Runtime

`nucleus` is the core foundation.

It includes concerns like:

- service lifecycle;
- HK2 integration;
- configuration model;
- admin infrastructure;
- logging;
- deployment framework base;
- kernel/boot;
- classloading support;
- common utilities;
- command infrastructure;
- monitoring/config support.

Mental model:

```text
nucleus = minimal application server foundation
```

Without containers, nucleus provides the base runtime in which modules/services plug in.

---

## 6. HK2: Service Locator and Dependency Injection Inside GlassFish

GlassFish uses HK2 heavily internally.

HK2 provides:

- service registry;
- dependency injection;
- lifecycle;
- descriptors;
- service lookup;
- dynamic service binding.

Example conceptual:

```java
@Service
public class SomeRuntimeService {
    @Inject
    private ConfigService configService;
}
```

GlassFish internal services are not wired like Spring Boot apps. They often use HK2 service locator patterns.

Mental model:

```text
GlassFish boots HK2.
Modules register services.
Services inject each other.
Admin/deployment/runtime calls resolve services from HK2.
```

When reading source, search for:

```text
@Service
@Inject
@Contract
@ServiceLocator
```

---

## 7. Boot Sequence at Source Level

Simplified source-level boot:

```text
main/bootstrap
  |
  v
create runtime environment
  |
  v
initialize HK2 service locator
  |
  v
load configuration/domain
  |
  v
register core services
  |
  v
start admin/runtime services
  |
  v
start network listeners
  |
  v
load deployed applications
  |
  v
runtime ready
```

When debugging startup:

```text
Look for bootstrap classes, startup services, domain/config loading, lifecycle hooks.
```

Key evidence:

- server.log startup sequence;
- stack trace during startup;
- service initialization failure;
- missing service injection;
- config parsing failure.

---

## 8. Admin Command Architecture

`asadmin` commands map to server-side command implementations.

Mental model:

```text
asadmin CLI
  |
  v
admin command request
  |
  v
DAS/admin runtime
  |
  v
command implementation service
  |
  v
config/runtime mutation
```

Source patterns:

```text
AdminCommand
@ExecuteOn
@TargetType
@Service(name = "command-name")
```

A command like:

```bash
asadmin create-jdbc-resource
```

has corresponding Java command implementation.

When command behavior is unclear:

```text
Search command name in source.
```

Example search:

```bash
grep -R "create-jdbc-resource" -n .
grep -R "@Service(name = \"create-jdbc-resource\")" -n .
```

---

## 9. Configuration Model

GlassFish config is represented in `domain.xml` and internal config beans.

Source concepts:

- config interfaces/classes;
- config transactions;
- `ConfigSupport`;
- dynamic reconfiguration;
- target configs;
- domain/cluster/server config tree.

Mental model:

```text
domain.xml text
  |
  v
config model objects
  |
  v
admin command modifies config model
  |
  v
runtime services observe/apply config
```

Do not think of `domain.xml` as just raw XML. GlassFish treats it as managed configuration model.

---

## 10. Deployment Framework

Deployment is not simply unzip WAR.

Pipeline:

```text
receive artifact
  |
archive abstraction
  |
sniffers identify type
  |
deployment descriptors parsed
  |
classloaders created
  |
containers prepare app
  |
resources/naming wired
  |
modules started
  |
application registered
```

Key concepts:

- deployment archive;
- sniffer;
- deployer;
- container;
- application info;
- classloader hierarchy;
- lifecycle events.

When deployment fails, identify phase:

```text
archive open
descriptor parse
sniffer
classloading
CDI
JPA
EJB
web startup
resource lookup
security role mapping
```

---

## 11. Sniffers

GlassFish uses sniffers to detect application/module type.

Example:

```text
WAR sniffer
EJB sniffer
JPA sniffer
CDI sniffer
Connector/RAR sniffer
```

Mental model:

```text
Sniffer says:
  this archive needs web container
  this archive needs EJB container
  this archive contains persistence unit
```

A WAR with `WEB-INF/web.xml` triggers web container. A persistence unit triggers JPA integration.

If app unexpectedly activates a subsystem, sniffers may be involved.

---

## 12. Containers

GlassFish contains multiple containers:

```text
Web container
EJB container
Application client container
Connector container
CDI integration layer
JPA/persistence integration
```

Each container has:

- deployment preparation;
- runtime start;
- injection/resource integration;
- lifecycle callbacks;
- request/invocation handling;
- undeploy cleanup.

Source reading question:

```text
Which container owns this failure?
```

Example:

```text
Servlet init failure -> web container
Unsatisfied CDI dependency -> CDI/Weld integration
EJB timer failure -> EJB container
JPA PU deploy failure -> persistence integration
RAR failure -> connector container
```

---

## 13. Web Container and Grizzly

GlassFish HTTP stack involves Grizzly and web container integration.

Simplified:

```text
Network socket
  |
  v
Grizzly transport/filter chain
  |
  v
HTTP service
  |
  v
web container
  |
  v
Servlet/filter/listener
  |
  v
application
```

When debugging:

- connection issue;
- listener issue;
- TLS issue;
- request parsing;
- thread pool;
- access log;
- servlet dispatch;

look at Grizzly integration and web container modules.

But many servlet semantics come from Jakarta Servlet implementation layer in GlassFish.

---

## 14. Jersey Integration

JAX-RS runtime in GlassFish is Jersey.

If failure involves:

```text
@Path
@Provider
ExceptionMapper
MessageBodyReader/Writer
JAX-RS client
JSON binding integration
multipart provider
```

Then source may be in Jersey or GlassFish-Jersey integration.

GlassFish source may wire Jersey into deployment/runtime. Jersey source owns much JAX-RS behavior.

Troubleshooting approach:

```text
1. Identify whether failure is integration or Jersey core.
2. Check stack trace package names:
   org.glassfish.jersey.*
   org.glassfish.jersey.server.*
   org.glassfish.jersey.inject.*
```

---

## 15. EclipseLink Integration

JPA provider commonly EclipseLink.

If failure involves:

```text
persistence.xml
entity weaving
lazy loading
query parsing
cache
transactions
database platform
DDL generation
```

Stack may involve:

```text
org.eclipse.persistence.*
```

GlassFish source owns:

- persistence unit discovery;
- JTA datasource integration;
- classloader integration;
- provider bootstrap.

EclipseLink source owns:

- JPA behavior;
- query engine;
- mapping;
- cache;
- weaving internals.

---

## 16. EJB Container

EJB source concerns:

- session bean lifecycle;
- pooling;
- interceptors;
- transactions;
- security;
- timers;
- MDB;
- remote/local invocation;
- passivation;
- naming.

Search patterns:

```text
StatelessSessionContainer
EjbContainerUtil
EJBTimerService
MessageBeanContainer
```

Exact names vary, but stack traces guide you.

EJB failures often involve cross-cutting systems:

```text
EJB + transaction + security + naming + injection
```

---

## 17. CDI Integration

GlassFish integrates CDI provider/runtime.

Failure examples:

```text
UnsatisfiedResolutionException
AmbiguousResolutionException
DeploymentException
proxy generation failure
interceptor/decorator failure
```

Source boundary:

```text
Weld/CDI implementation
GlassFish CDI integration
HK2/CDI bridge
```

Do not confuse:

```text
HK2 internal injection
```

with:

```text
CDI application injection
```

They are related at integration boundaries but not identical.

---

## 18. Security Modules

Security source includes:

- realms;
- authentication service;
- authorization;
- role mapping;
- admin security;
- SSL/TLS integration;
- JASPIC/Jakarta Authentication integration;
- Jakarta Security integration.

When debugging 403/401:

```text
1. app security annotations/descriptors
2. realm group/principal
3. role mapping
4. GlassFish security service
5. Jakarta Security/JASPIC integration if used
```

Stack traces may be sparse because security failures can be handled as normal control flow.

Use logs and config.

---

## 19. Resource Management Modules

Resources include:

- JDBC pools;
- JMS resources;
- connector/JCA resources;
- mail sessions;
- custom resources;
- admin objects.

Source concerns:

- config beans;
- pool creation;
- resource naming/JNDI;
- validation;
- runtime pool metrics;
- admin commands.

If `create-jdbc-connection-pool` behaves unexpectedly, source command/config/pool module matters.

---

## 20. Transaction Service

Transaction service concerns:

- JTA integration;
- transaction manager;
- resource enlistment;
- timeout;
- recovery;
- XA;
- synchronization callbacks;
- EJB/JPA/JMS integration.

Transaction failure stack traces often wrap root causes.

Read source to understand:

```text
where timeout is applied
where rollback-only set
where resource enlistment happens
where recovery logs stored
```

---

## 21. Naming/JNDI Source

JNDI/naming source handles:

- global/app/module/component namespace;
- resource reference resolution;
- portable JNDI names;
- injection lookup;
- cross-module binding.

If `NameNotFoundException` occurs:

```text
Is name not registered?
Wrong namespace?
Wrong target?
Wrong deployment phase?
Wrong descriptor mapping?
```

Source can help identify lookup path.

---

## 22. Build System Overview

GlassFish uses Maven multi-module build.

Typical source build commands may look like:

```bash
git clone https://github.com/eclipse-ee4j/glassfish.git
cd glassfish
mvn -version
mvn install -DskipTests
```

Actual build requirements depend on branch/version:

- JDK version;
- Maven version;
- environment variables;
- profiles;
- generated artifacts;
- test dependencies.

Always read:

```text
README
CONTRIBUTING
BUILDING
pom.xml
CI workflow files
```

Do not assume one Maven command works for every branch.

---

## 23. Build from Source: Practical Steps

Suggested workflow:

```text
1. Clone repository.
2. Checkout tag/branch matching target GlassFish.
3. Read build instructions.
4. Install required JDK/Maven.
5. Build without tests to verify compilation.
6. Build selected module.
7. Run relevant tests.
8. Build distribution.
9. Run local domain from built distribution.
10. Reproduce issue.
```

Example conceptual:

```bash
git checkout 8.0.0
mvn -DskipTests install
```

If build fails:

- check JDK version;
- check Maven version;
- check network/proxy;
- check generated sources;
- check dependency repositories;
- check OS-specific issues.

---

## 24. Building Only a Module

Maven multi-module supports:

```bash
mvn -pl module-path -am test
```

Meaning:

```text
-pl selected project
-am also make dependencies
```

Example conceptual:

```bash
mvn -pl appserver/web -am test
```

Use when iterating on specific area.

But beware:

- module path/name must match actual Maven project;
- integration tests may require environment;
- distribution build may need more modules.

---

## 25. Running Tests

Types of tests:

```text
unit tests
integration tests
admin command tests
deployment tests
TCK-related tests
smoke tests
quicklook tests
```

Large app server projects often have test profiles.

Contribution-quality change requires:

- targeted unit/integration test;
- existing relevant test suite;
- no regressions;
- possibly TCK awareness.

If tests are heavy, start with targeted module tests and expand.

---

## 26. Quicklook / Smoke Testing

GlassFish historically uses quicklook-style tests for broad sanity.

Purpose:

```text
does server start?
can deploy basic app?
does core feature still work?
```

For local source changes:

```text
run quick sanity before deeper test
```

Do not rely only on compile.

---

## 27. Debugging GlassFish from IDE

Approach:

```text
1. Import Maven project into IDE.
2. Build distribution.
3. Start GlassFish with debug port.
4. Attach debugger.
5. Set breakpoints in relevant module.
6. Reproduce via app/asadmin.
```

JVM debug option:

```text
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

Production warning:

```text
Never expose debug port in production.
```

For local source debugging, it is essential.

---

## 28. Finding Source from Stack Trace

Stack trace:

```text
org.glassfish.deployment.common.DeploymentException
  at ...
Caused by: ...
```

Workflow:

```text
1. Identify deepest meaningful cause.
2. Note package names.
3. Search class in repository.
4. Identify module via file path.
5. Read surrounding method.
6. Search callers.
7. Understand config/spec contract.
8. Create minimal reproduction.
```

Commands:

```bash
grep -R "class DeploymentException" -n .
grep -R "methodName" -n appserver nucleus
```

Or use IDE “Go to class”.

---

## 29. Reading Source Efficiently

Do not read entire repository linearly.

Use targeted reading:

```text
1. Start from stack trace.
2. Find module.
3. Read public interfaces/contracts.
4. Read lifecycle entrypoint.
5. Read tests.
6. Read admin command if config-related.
7. Read related docs/spec.
```

Tests often reveal intended behavior faster than implementation.

Search for:

```text
class name
command name
config attribute
log message
exception message
message id
descriptor element
JNDI name
```

---

## 30. Log Message as Source Anchor

If server.log has:

```text
SEVERE: XYZ failed because ABC
```

Search exact message or message id in source.

```bash
grep -R "XYZ failed because" -n .
```

GlassFish may use localized message bundles.

Search:

```text
message key
logger name
resource bundle
```

This often leads directly to source path.

---

## 31. Admin Command Source Analysis

For command bug:

```bash
asadmin create-connector-resource ...
```

Search:

```bash
grep -R "create-connector-resource" -n .
```

Then inspect:

- command class;
- injected services;
- config transaction;
- validation;
- target handling;
- error messages.

Ask:

```text
Does command mutate config only?
Does it also touch runtime service?
Is it dynamic or needs restart?
How does target work?
```

---

## 32. Deployment Bug Analysis

If app deploy fails:

```text
1. Identify deployment phase.
2. Identify container/sniffer.
3. Find exception source.
4. Check descriptor parsing.
5. Check classloader.
6. Check container prepare/start.
7. Check cleanup/rollback path.
```

Source modules involved:

```text
deployment framework
archive abstraction
sniffers
container deployers
classloading
naming/resources
CDI/JPA/EJB/Web integration
```

Deployment bugs are often cross-module.

---

## 33. Classloading Source Analysis

Classloading behavior lives in classloader modules and deployment runtime.

Questions:

```text
Who creates classloader?
What is parent?
What libraries are added?
Is delegation parent-first or child-first?
Where are app libs scanned?
How are EAR/lib and WEB-INF/lib handled?
```

Source reading helps explain:

- duplicate class issue;
- library visibility;
- `ClassCastException`;
- `NoSuchMethodError`.

---

## 34. Performance Bug Source Analysis

If performance issue seems inside GlassFish:

```text
1. Use profiler/JFR to find hot method.
2. Map method to module.
3. Check algorithm/lock/IO.
4. Check if config can tune behavior.
5. Search issues/PRs.
6. Create benchmark/repro.
```

Do not patch performance by guess.

Evidence:

- JFR;
- thread dump;
- allocation profile;
- flamegraph;
- microbenchmark if isolated;
- integration load test if runtime-level.

---

## 35. Security Bug Source Analysis

For security behavior:

```text
1. Reproduce with minimal app.
2. Identify spec contract.
3. Identify GlassFish security module.
4. Check role mapping/auth flow.
5. Verify expected vs actual.
6. Search existing CVE/issues carefully.
7. Avoid public disclosure if vulnerability.
```

If vulnerability suspected:

```text
follow responsible disclosure process
```

Do not publish exploit details casually.

---

## 36. Contribution Workflow

Typical open-source contribution flow:

```text
1. Search existing issues.
2. Create issue or comment with reproduction.
3. Fork repository.
4. Create branch.
5. Implement fix.
6. Add/adjust tests.
7. Run relevant tests.
8. Sign commits if required by project policy.
9. Submit PR.
10. Respond to review.
```

Read project contribution guidelines.

Open-source maintainers value:

- minimal reproducible case;
- clear problem statement;
- spec references;
- tests;
- small focused PR;
- backward compatibility awareness.

---

## 37. Spec Compliance Thinking

GlassFish implements Jakarta EE specifications.

When changing behavior, ask:

```text
What does the Jakarta spec require?
Is current behavior non-compliant?
Is proposed behavior allowed?
Does it break compatibility?
Does TCK cover this?
```

Spec compliance matters more than personal preference.

A bug may be:

```text
GlassFish implementation bug
Jersey/EclipseLink/HK2 bug
Application misuse
Spec ambiguity
Documentation gap
```

Classify correctly.

---

## 38. TCK Awareness

Jakarta EE implementations are validated by TCKs.

Contributor mindset:

```text
A change is not good if it fixes one app but breaks spec/TCK behavior.
```

Even if you cannot run full TCK locally, you should understand:

- spec contract;
- compatibility;
- existing tests;
- release impact.

---

## 39. Patch Management for Internal Forks

Sometimes organization patches GlassFish internally.

Risks:

- divergence from upstream;
- future upgrade pain;
- security patch merge difficulty;
- unsupported behavior;
- hidden operational burden.

If internal fork unavoidable:

```text
1. Keep patch minimal.
2. Document reason.
3. Add test/repro.
4. Track upstream issue/PR.
5. Rebase regularly.
6. Maintain patch inventory.
7. Plan removal.
```

Prefer upstream contribution where possible.

---

## 40. Building a Minimal Reproducer

For bug report:

```text
minimal app
minimal config
exact GlassFish version
exact JDK version
steps to reproduce
expected behavior
actual behavior
logs/stack trace
```

Example:

```text
reproducer/
  pom.xml
  src/main/java/...
  src/main/webapp/WEB-INF/web.xml
  README.md
```

Avoid sending huge enterprise app unless necessary.

---

## 41. Source-Level Debugging Case Study: JNDI Missing

Symptom:

```text
NameNotFoundException: jdbc/case/main
```

Workflow:

```text
1. Check app resource-ref.
2. Check GlassFish resource target.
3. Check deployment descriptors.
4. Search source for naming lookup path.
5. Breakpoint in naming manager.
6. Observe namespace and resource registry.
7. Identify missing target binding.
```

Likely root:

```text
resource created on server target, app deployed to cluster target.
```

Source reading helps confirm lookup mechanism.

---

## 42. Source-Level Debugging Case Study: Admin Command Target Bug

Symptom:

```text
asadmin set-log-levels works on server but not cluster instance.
```

Workflow:

```text
1. Search command source.
2. Check target annotation.
3. Check config mutation path.
4. Check runtime dynamic application.
5. Check whether restart required.
6. Check server.log on instance.
```

This teaches difference between config update and runtime reconfiguration.

---

## 43. Source-Level Debugging Case Study: Deployment Rollback Leak

Symptom:

```text
Failed deployment leaves partially registered resources.
Next deployment behaves strangely.
```

Workflow:

```text
1. Reproduce with failing app.
2. Trace deployment prepare/start.
3. Trace exception handling.
4. Trace cleanup/undeploy code.
5. Check application registry/naming/classloader cleanup.
6. Add regression test.
```

App servers must handle partial failure robustly.

---

## 44. Navigating Large Codebase Without Getting Lost

Use this process:

```text
1. Write the question.
2. Identify symptom/log/stack.
3. Identify package/module.
4. Read nearest tests.
5. Read public interfaces.
6. Read implementation.
7. Draw call path.
8. Validate with debugger/log.
9. Form hypothesis.
10. Prove with minimal repro/test.
```

Do not wander randomly.

---

## 45. Important Search Patterns

```bash
# Find command
grep -R "command-name" -n .

# Find log message
grep -R "message text" -n .

# Find service
grep -R "@Service" -n module

# Find injected contract
grep -R "interface SomeService" -n .

# Find config element
grep -R "jdbc-connection-pool" -n .

# Find tests
find . -path "*test*" -name "*SomeFeature*"
```

IDE indexing is very helpful for GlassFish.

---

## 46. Local Developer Environment Tips

Recommended:

```text
- use JDK required by branch
- use Maven version compatible with project
- allocate enough RAM
- use fast SSD
- import selectively if IDE struggles
- build from command line first
- keep clean checkout
- use separate local domain for experiments
```

Avoid:

```text
editing generated distribution manually without tracking
debugging against wrong source/tag
mixing JDK versions
assuming main branch matches production version
```

---

## 47. Reading Release Branches and Tags

If production uses:

```text
GlassFish 7.0.x
```

Do not debug against:

```text
main branch for GlassFish 8/9
```

Always match:

- exact version tag;
- patch release;
- JDK baseline;
- dependency versions.

Then check if bug fixed later:

```text
git log
release notes
issues/PRs
diff between tags
```

---

## 48. Understanding Distribution Build

GlassFish distribution is assembled from many modules.

Artifacts:

```text
glassfish.zip
appserver distributions
modules/*.jar
lib/*.jar
bin/asadmin
domains/domain1 template
```

If you change one module jar, distribution must include it.

For local patch testing:

- rebuild distribution; or
- replace module jar carefully in test domain;
- verify version/class loaded.

Be careful with OSGi/module cache.

---

## 49. Runtime Module Cache

Application servers may cache generated/runtime artifacts.

When testing patched jars:

```text
clean domain generated directories
clear OSGi/module cache if needed
restart domain
verify class source/version
```

Otherwise you may think patch failed when old artifact is still loaded.

---

## 50. Contribution-Level Checklist

Before submitting/finalizing a fix:

```text
[Problem]
- issue clearly described
- minimal reproduction exists
- expected vs actual defined
- spec/documentation checked

[Code]
- fix minimal and focused
- no unrelated formatting churn
- backward compatibility considered
- logging/error messages appropriate
- security implications considered

[Tests]
- regression test added
- relevant existing tests run
- manual smoke test done
- failure path tested if applicable

[Build]
- module builds
- distribution builds if needed
- no dependency leakage
- license headers consistent

[Docs]
- release note/doc update if behavior/config changes
```

---

## 51. Anti-Patterns

### Anti-pattern 1 — Debugging Main Branch for Production Issue on Old Version

Version mismatch wastes time.

### Anti-pattern 2 — Reading Random Source Without Stack Trace/Question

Large codebase overwhelms.

### Anti-pattern 3 — Patching Without Test

Regression likely.

### Anti-pattern 4 — Fixing Application Misuse in Server

Understand spec contract first.

### Anti-pattern 5 — Internal Fork with No Upstream Plan

Long-term maintenance burden.

### Anti-pattern 6 — Ignoring Integration Project Boundary

Bug may be in Jersey/EclipseLink/Grizzly/HK2, not GlassFish core.

### Anti-pattern 7 — Replacing One Module Jar in Prod Manually

Drift and support nightmare.

---

## 52. Top 1% Takeaways

1. **GlassFish is a modular platform, not one jar.**
2. **Nucleus/HK2/admin/config/deployment form the core runtime.**
3. **Many behaviors belong to ecosystem projects: Jersey, Grizzly, EclipseLink, HK2, OpenMQ, Mojarra.**
4. **Source reading starts from a question, stack trace, log message, or command name.**
5. **Admin commands are discoverable by searching command names.**
6. **Deployment failures should be mapped to deployment phases and containers.**
7. **Spec compliance matters; do not “fix” behavior against Jakarta EE contract.**
8. **Tests and minimal repros are the currency of contribution.**
9. **Internal forks must be minimized, tracked, and upstreamed if possible.**
10. **Contribution-level understanding turns GlassFish from black box into inspectable runtime.**

---

## 53. Mini Exercise

You see this production stack trace:

```text
jakarta.naming.NameNotFoundException: jdbc/payment/main
  at ...
  at org.glassfish.javaee.services.ResourceManager...
  at org.glassfish.deployment...
```

Task:

1. What exact production version/tag of GlassFish do you inspect?
2. What source modules are likely involved?
3. What search terms do you use?
4. What runtime config do you check?
5. What deployment descriptor do you check?
6. What minimal reproducer do you build?
7. How do you prove whether it is config issue or GlassFish bug?
8. What test would you add if it is a bug?
9. What workaround is safest?
10. What should not be patched manually in production?

---

## 54. Referensi

Referensi utama:

- Eclipse GlassFish source repository  
  https://github.com/eclipse-ee4j/glassfish

- Eclipse GlassFish README / build instructions  
  https://github.com/eclipse-ee4j/glassfish/blob/master/README.md

- Eclipse GlassFish Contributing Guide  
  https://github.com/eclipse-ee4j/glassfish/blob/master/CONTRIBUTING.md

- Eclipse GlassFish HK2 repository  
  https://github.com/eclipse-ee4j/glassfish-hk2

- Eclipse Jersey repository  
  https://github.com/eclipse-ee4j/jersey

- Eclipse Grizzly repository  
  https://github.com/eclipse-ee4j/grizzly

- EclipseLink repository  
  https://github.com/eclipse-ee4j/eclipselink

- Eclipse OpenMQ repository  
  https://github.com/eclipse-ee4j/openmq

- Eclipse Mojarra repository  
  https://github.com/eclipse-ee4j/mojarra

- Jakarta EE Specifications  
  https://jakarta.ee/specifications/

---

## 55. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - selesai
Part 28 - selesai
Part 29 - selesai
Part 30 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 31 — Comparative Engineering: GlassFish vs Payara vs WildFly vs Liberty vs Spring Boot
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-029.md">⬅️ Part 29 — Security Hardening dan Production Baseline</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-031.md">Part 31 — Comparative Engineering: GlassFish vs Payara vs WildFly vs Liberty vs Spring Boot ➡️</a>
</div>
