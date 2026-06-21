# learn-java-eclipse-glassfish-runtime-server-engineering-part-031  
# Part 31 — Comparative Engineering: GlassFish vs Payara vs WildFly vs Liberty vs Spring Boot

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 31 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang ingin mampu memilih runtime secara engineering, bukan fanboy/fear-driven  
> Fokus part ini: **membandingkan GlassFish dengan Payara, WildFly, Open Liberty, dan Spring Boot** dari sisi runtime architecture, Jakarta EE compliance, production support, operations, cloud-native, performance, migration, dan decision framework

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. membandingkan GlassFish, Payara, WildFly, Open Liberty, dan Spring Boot secara objektif;
2. memahami bahwa “mana yang terbaik” bergantung pada workload, governance, skill, dan operasi;
3. membedakan:
   - reference implementation;
   - commercially supported runtime;
   - full Jakarta EE app server;
   - modular app server;
   - lightweight microservice runtime;
   - embedded application framework;
4. memahami trade-off GlassFish sebagai Jakarta EE compatible implementation;
5. memahami Payara sebagai GlassFish-derived enterprise/serverless/cloud-oriented platform;
6. memahami WildFly sebagai modular Jakarta EE runtime dari Red Hat ecosystem;
7. memahami Open Liberty sebagai lightweight modular runtime dari IBM/WebSphere lineage;
8. memahami Spring Boot sebagai application framework/embedded runtime, bukan traditional Jakarta EE full app server;
9. membuat decision matrix untuk migration/greenfield/legacy modernization;
10. memilih runtime berdasarkan constraint nyata: support, skill, spec, cloud, memory, deployment, ops, ecosystem, dan risk.

Part ini bukan promosi salah satu runtime. Fokusnya adalah **comparative engineering**.

---

## 1. Mental Model: Runtime adalah Operating Model

Memilih runtime bukan hanya memilih API.

Runtime menentukan:

```text
How application is packaged
How it is configured
How it is deployed
How it is observed
How it handles resources
How it scales
How it upgrades
How it fails
How teams operate it
```

Pilihan runtime mempengaruhi:

- developer productivity;
- production operations;
- release pipeline;
- incident response;
- compliance;
- patching;
- hiring;
- cloud strategy;
- vendor support;
- migration path.

Pertanyaan penting:

```text
Apakah kita butuh full Jakarta EE server?
Apakah kita butuh commercial support?
Apakah app legacy Java EE/Jakarta EE?
Apakah target Kubernetes?
Apakah app stateful?
Apakah team lebih kuat Spring?
Apakah dependency ecosystem compatible?
Apakah runtime harus certified Jakarta EE?
```

---

## 2. Jangan Bandingkan Secara Dangkal

Perbandingan buruk:

```text
Spring Boot lebih modern.
WildFly lebih enterprise.
GlassFish cuma reference.
Payara lebih production.
Liberty lebih cloud.
```

Itu slogan.

Perbandingan engineering harus mencakup:

```text
Specification support
Runtime architecture
Deployment model
Configuration model
Operational tooling
Performance characteristics
Memory footprint
Startup time
Cloud-native fit
Commercial support
Security patching
Migration cost
Ecosystem maturity
Team skill
Long-term roadmap
```

---

## 3. Kategori Runtime

### 3.1 Full Jakarta EE Application Server

Menyediakan banyak Jakarta EE APIs dan container services:

- Servlet;
- CDI;
- EJB;
- JPA integration;
- JTA;
- JMS;
- JAX-RS;
- Bean Validation;
- Security;
- WebSocket;
- Batch;
- Connectors;
- Mail;
- JSON-P/B;
- etc.

Examples:

```text
GlassFish
Payara Server
WildFly
Open Liberty
```

### 3.2 MicroProfile / Cloud-Native Jakarta Runtime

Menambahkan focus pada:

- config;
- health;
- metrics;
- fault tolerance;
- JWT;
- OpenAPI;
- REST client;
- telemetry.

Examples:

```text
Payara
WildFly
Open Liberty
Quarkus
Helidon
```

### 3.3 Embedded Application Framework

Application packages runtime with app.

Example:

```text
Spring Boot executable jar
```

Runtime is part of application process, not external app server.

---

## 4. GlassFish Positioning

GlassFish is Eclipse implementation of Jakarta EE and historically acts as reference/compatible implementation.

Strengths:

```text
- close to Jakarta EE specification work
- clean Jakarta EE implementation learning runtime
- open source under Eclipse governance
- good for spec compatibility and learning
- official docs and release notes align with Jakarta EE
- useful baseline for understanding Jakarta EE behavior
```

Weaknesses/risks:

```text
- production support ecosystem may be weaker than commercial runtimes
- fewer enterprise operational add-ons than Payara/Liberty/WildFly ecosystem
- community/support expectations must be understood
- some enterprise features may require more custom ops discipline
- less popular than Spring Boot in modern hiring market
```

Best fit:

```text
- learning Jakarta EE deeply
- standards-based apps
- teams comfortable operating app servers
- environments where Eclipse GlassFish is accepted
- migration validation against Jakarta EE behavior
- development/testing of Jakarta EE 11 apps
```

Official GlassFish 8 line corresponds to Jakarta EE 11 and requires JDK 21 or higher.

---

## 5. Payara Positioning

Payara originated as a GlassFish-derived platform with enterprise support, production hardening, MicroProfile, Payara Micro, and commercial offerings.

Strengths:

```text
- familiar migration path for GlassFish users
- enterprise support options
- Payara Server and Payara Micro models
- MicroProfile/cloud features
- production-oriented documentation/support
- tooling/features around deployment and operations
```

Weaknesses/risks:

```text
- licensing/support model must be evaluated
- Community vs Enterprise lifecycle differs
- some features are Payara-specific extensions
- migration from GlassFish is easier but not zero-cost
- organization must accept vendor/commercial model if needed
```

Best fit:

```text
- existing GlassFish apps needing commercial support
- Jakarta EE apps requiring production support
- teams wanting GlassFish-like runtime with operational additions
- enterprise workloads needing support SLA
```

Payara Platform Community documentation states Payara Server Community supports Jakarta EE/Java EE applications across on-prem, cloud, or hybrid environments, while Payara Enterprise emphasizes long-term support for mission-critical workloads. Payara 7 has moved into Jakarta EE 11 commercial runtime territory in 2026.

---

## 6. WildFly Positioning

WildFly is a modular Jakarta EE application server from the JBoss/Red Hat ecosystem.

Architecture concepts:

```text
- modular services
- subsystems
- management model
- CLI
- domain/standalone modes
- Undertow web server
- Elytron security
- IronJacamar connectors
- Narayana transactions
- Hibernate integration
```

Strengths:

```text
- mature enterprise app server ecosystem
- strong management CLI/model
- Red Hat lineage and EAP commercial path
- modular subsystem architecture
- good for Jakarta EE enterprise workloads
- strong transaction/security ecosystem
- active releases
```

Weaknesses/risks:

```text
- different configuration/admin model from GlassFish
- migration effort for GlassFish-specific descriptors/resources
- learning curve for subsystems/Elytron/CLI
- production support usually via Red Hat EAP, not community WildFly
```

Best fit:

```text
- enterprise Jakarta EE apps
- teams with JBoss/Red Hat experience
- apps needing strong management/subsystem model
- organizations aligned with Red Hat support ecosystem
```

WildFly 40 was released in May 2026; release notes state its variants run well on Java 25, 21, and 17, while advising Java 21 or 17 where EE TCK-passed SE versions matter.

---

## 7. Open Liberty Positioning

Open Liberty is IBM's lightweight, modular, cloud-optimized runtime from the WebSphere Liberty lineage.

Architecture concepts:

```text
- feature-based runtime
- fast startup
- small footprint
- config-driven server.xml
- Jakarta EE / MicroProfile features enabled selectively
- strong cloud/container focus
```

Strengths:

```text
- modular features: enable only what you need
- lightweight runtime profile
- strong MicroProfile support
- good container/cloud-native story
- IBM commercial path via WebSphere Liberty
- mature enterprise support lineage
```

Weaknesses/risks:

```text
- config model differs from GlassFish/WildFly
- migration from GlassFish descriptors/resources requires work
- enterprise support/licensing considerations
- feature selection requires discipline
```

Best fit:

```text
- cloud-native Jakarta EE/MicroProfile apps
- organizations with IBM/WebSphere/Liberty ecosystem
- workloads needing small footprint and modular runtime
- teams valuing standardized Jakarta EE with modern ops
```

---

## 8. Spring Boot Positioning

Spring Boot is not a traditional full Jakarta EE application server.

It is an application framework and embedded runtime model:

```text
application.jar
  |
  |-- embedded Tomcat/Jetty/Undertow/Netty
  |-- Spring container
  |-- app code
  |-- dependencies
```

Strengths:

```text
- huge ecosystem
- strong developer productivity
- embedded deployment model
- popular in microservices
- rich integrations
- actuator/observability
- strong testing support
- cloud-native familiarity
- large hiring market
```

Weaknesses/risks:

```text
- not full Jakarta EE container
- EJB/JTA/JCA/JMS semantics differ or require alternatives
- migration from Java EE app can be significant rewrite
- annotation/config model differs
- dependency graph can become large
- governance needed to avoid framework sprawl
```

Best fit:

```text
- greenfield microservices
- REST/event-driven services
- teams standardized on Spring
- apps not depending heavily on EJB/JCA/full Jakarta EE
- modern cloud/Kubernetes deployments
```

Spring Boot can use many Jakarta APIs, but it is not the same as deploying an EAR into a Jakarta EE server.

---

## 9. Comparison Table: High-Level

| Dimension | GlassFish | Payara | WildFly | Open Liberty | Spring Boot |
|---|---|---|---|---|---|
| Runtime type | Jakarta EE app server | GlassFish-derived Jakarta EE platform | Jakarta EE app server | Modular Jakarta EE/MicroProfile runtime | Embedded app framework |
| Commercial support | Limited/community-oriented | Strong Payara/Azul commercial path | Red Hat EAP path | IBM WebSphere Liberty path | VMware/Broadcom ecosystem + community |
| Jakarta EE fit | Very strong/spec-close | Strong | Strong | Strong | Partial/uses Jakarta APIs but not full EE server |
| Legacy Java EE migration | Good if GlassFish legacy | Very good for GlassFish lineage | Possible but descriptor/config migration | Possible but config migration | Often rewrite/refactor |
| Cloud-native | Improving, needs discipline | Stronger with Payara Micro/platform | Good with modern tooling | Strong | Very strong |
| Admin/config style | `asadmin`, domain.xml | GlassFish-like + Payara features | CLI/subsystems/XML | server.xml/features | app config/properties |
| Full EAR/EJB/JCA | Yes | Yes | Yes | Yes depending features | No traditional full EE container |
| Learning value for Jakarta EE | Excellent | Good | Good | Good | Good for Spring, not EE container internals |
| Operational simplicity | moderate | moderate | moderate/advanced | relatively modular | simple per-service, complex ecosystem |

---

## 10. Jakarta EE Compatibility vs Practical Compatibility

A runtime can be Jakarta EE compatible, but app migration can still fail due to:

- vendor-specific descriptors;
- non-portable JNDI names;
- server-specific classloading;
- custom realms;
- proprietary resources;
- JPA provider differences;
- JMS provider differences;
- transaction behavior edge cases;
- EJB remote behavior;
- security mapping;
- admin scripts;
- deployment pipeline.

Compatibility at spec level means:

```text
portable Jakarta EE app should run
```

But real enterprise apps are often not fully portable.

---

## 11. GlassFish vs Payara

Payara is the closest conceptual neighbor.

### Similarities

```text
- GlassFish lineage
- Jakarta EE application server model
- asadmin/domain concepts familiarity
- deployment model similar
- easier migration than to WildFly/Liberty/Spring
```

### Payara Advantages

```text
- enterprise support options
- production hardening/support positioning
- Payara Micro
- MicroProfile features
- operational additions
- commercial lifecycle
```

### GlassFish Advantages

```text
- Eclipse upstream/reference-like implementation
- clean spec learning
- open community baseline
- useful for Jakarta EE compatibility validation
```

### Decision

Choose Payara if:

```text
You have GlassFish apps and need production support/SLA.
```

Choose GlassFish if:

```text
You need open Jakarta EE implementation, learning, development, or accepted community runtime.
```

---

## 12. GlassFish vs WildFly

### GlassFish Strengths

```text
- spec-close Jakarta EE learning
- simpler conceptual model for Jakarta EE baseline
- good for GlassFish legacy apps
```

### WildFly Strengths

```text
- mature modular architecture
- strong management CLI
- Red Hat/EAP commercial path
- Elytron security
- Undertow
- Narayana transaction manager
- strong enterprise ecosystem
```

### Migration Effort

GlassFish → WildFly requires:

```text
- descriptor/resource migration
- JNDI differences
- security realm migration
- datasource/JMS config rewrite
- admin scripts rewrite
- testing classloading differences
```

Choose WildFly if:

```text
You align with Red Hat ecosystem or need EAP support path.
```

Choose GlassFish if:

```text
You want continuity/spec baseline and GlassFish-native config.
```

---

## 13. GlassFish vs Open Liberty

### GlassFish Strengths

```text
- full app server model familiar to GlassFish users
- Jakarta EE implementation learning
- straightforward for GlassFish-centered teams
```

### Open Liberty Strengths

```text
- feature-based lightweight runtime
- strong container/cloud story
- MicroProfile maturity
- IBM support path
- fast startup/small footprint focus
```

### Migration Effort

GlassFish → Liberty requires:

```text
- server.xml feature/config model
- datasource/JMS/security resource rewrite
- descriptor testing
- JPA/provider behavior validation
- deployment pipeline changes
```

Choose Liberty if:

```text
You want Jakarta EE/MicroProfile with lightweight feature-driven runtime and IBM support path.
```

---

## 14. GlassFish/Payara/WildFly/Liberty vs Spring Boot

This is the biggest architectural shift.

### Traditional App Server Model

```text
Server exists independently.
Applications deployed into server.
Server provides containers/resources.
```

### Spring Boot Model

```text
Application owns runtime.
App packaged as executable jar/container.
Infrastructure provides platform, not EE container.
```

Migration from full Java EE to Spring Boot often requires replacing:

```text
EJB -> Spring services/scheduling/transactions
JTA/EJB tx -> Spring transaction management
JPA integration -> Spring Data/JPA config
JMS -> Spring JMS/Kafka/Rabbit etc.
JAX-RS -> Spring MVC/WebFlux
CDI -> Spring DI
JCA -> custom integration/service
Jakarta Security -> Spring Security
asadmin/domain resources -> app properties/K8s config
```

This can be worth it, but it is not “runtime switch”; it is usually application modernization.

---

## 15. Decision: Legacy EAR with EJB/JCA/JMS

If application has:

```text
EAR
EJBs
MDB
JCA resource adapters
JTA/XA
server-managed JDBC/JMS resources
GlassFish descriptors
```

Best candidates:

```text
Payara
GlassFish
WildFly
Open Liberty
```

Spring Boot likely means substantial rewrite.

Decision factors:

```text
Need commercial support?
Existing GlassFish-specific config?
Team skill?
JCA adapter compatibility?
Jakarta EE version target?
Cloud migration plan?
```

---

## 16. Decision: Stateless REST Service

If application is:

```text
REST API
JPA
no EJB
no JCA
no heavy server resources
Kubernetes target
```

Candidates:

```text
Spring Boot
Open Liberty
Payara Micro
WildFly Bootable JAR
GlassFish container
Quarkus/Helidon
```

Spring Boot/Open Liberty/Payara Micro may be operationally simpler than full GlassFish server.

---

## 17. Decision: Regulated Enterprise System

If requirements:

```text
standard Jakarta EE
auditability
long support
vendor SLA
strict patching
formal support
```

Strong candidates:

```text
Payara Enterprise
Red Hat EAP
IBM WebSphere Liberty
```

GlassFish can work if organization accepts community/open-source support model and builds strong internal ops capability.

---

## 18. Decision: Learning Jakarta EE Deeply

Best:

```text
GlassFish
```

Why:

- close to Jakarta EE ecosystem;
- docs/spec alignment;
- source available;
- good baseline for understanding app server internals;
- less vendor abstraction.

Then compare with:

```text
WildFly and Liberty for alternative architectures.
```

---

## 19. Decision: Cloud-Native Microservices

If goal:

```text
fast startup
small footprint
independent deployable services
Kubernetes
observability
config/health/metrics
```

Best candidates:

```text
Spring Boot
Open Liberty
Payara Micro
Quarkus
Helidon
WildFly bootable/runtime variants
```

Full traditional GlassFish cluster may be heavier unless app already depends on it.

---

## 20. Configuration Model Comparison

### GlassFish / Payara

```text
domain.xml
asadmin
admin console
resources managed by server
```

### WildFly

```text
standalone.xml/domain.xml
CLI
management model
subsystems
```

### Liberty

```text
server.xml
features
configDropins
environment/config variables
```

### Spring Boot

```text
application.yml/properties
environment variables
Spring configuration
Kubernetes config/secrets
```

Migration difficulty often lies here, not in Java code.

---

## 21. Deployment Model Comparison

| Runtime | Deployment Model |
|---|---|
| GlassFish | deploy WAR/EAR/RAR to server/domain/cluster |
| Payara | similar; Server/Micro models |
| WildFly | deploy archives; CLI; bootable options |
| Liberty | dropins/apps config; container images; server package |
| Spring Boot | executable jar/container image |

Spring Boot aligns naturally with immutable image per app.

Traditional app servers can also run containerized, but need discipline to avoid mutable server anti-pattern.

---

## 22. Operations Comparison

### GlassFish

```text
asadmin, domain logs, admin console, JMX, monitoring service
```

### Payara

```text
GlassFish-like + Payara admin/monitoring features
```

### WildFly

```text
jboss-cli, management API, subsystems, domain/standalone
```

### Liberty

```text
server.xml, feature manager, logs, metrics/health, container-friendly config
```

### Spring Boot

```text
Actuator, app logs, metrics, config, platform orchestration
```

Spring Boot operational model is usually more app-centric. App servers are more server-centric.

---

## 23. Performance Comparison: Avoid Fake Benchmarks

Do not choose runtime based on random benchmark.

Performance depends on:

- workload;
- APIs used;
- DB/external latency;
- serialization;
- GC;
- thread model;
- configuration;
- resource pools;
- deployment packaging;
- container limits;
- app code.

Instead benchmark your workload:

```text
startup time
memory RSS
p50/p95/p99 latency
throughput
GC pause
DB pool wait
CPU
deployment time
scale-out behavior
```

A runtime faster for hello-world may not matter if your bottleneck is DB lock.

---

## 24. Memory Footprint Comparison

General tendencies:

```text
Full app servers:
  larger baseline, more services available

Modular runtimes:
  can reduce footprint by enabling features selectively

Spring Boot:
  per-app embedded runtime; small for simple app, can grow with starters/dependencies
```

But measure.

Spring Boot with many starters can be heavier than expected. A feature-tuned Liberty app can be small. A full GlassFish domain with all services can be heavier.

---

## 25. Startup Time Comparison

Startup depends on:

- runtime bootstrap;
- app size;
- CDI scanning;
- JPA entity scanning;
- classpath size;
- bytecode enhancement;
- reflection;
- deployment descriptors;
- cache warmup;
- external checks.

Cloud-native runtimes emphasize startup. Traditional EAR deployments may have longer startup.

But for long-running enterprise systems, startup may be less critical than runtime stability and support.

---

## 26. Standards vs Ecosystem

Jakarta EE benefits:

```text
standard APIs
portable concepts
container-managed resources
JTA/JPA/JMS/EJB/JCA integration
enterprise consistency
```

Spring ecosystem benefits:

```text
rich integrations
fast ecosystem evolution
developer familiarity
excellent testing/dev experience
wide adoption
```

Trade-off:

```text
standards/governance vs ecosystem/productivity
```

Not mutually exclusive: Spring uses Jakarta APIs in many areas, but programming model differs.

---

## 27. Vendor Support and Risk

Production critical workloads often need support.

Questions:

```text
Who do we call during sev1?
What is patch SLA?
Who provides CVE fixes?
Is runtime certified?
Is our version supported?
What is upgrade path?
What is license/commercial cost?
```

Possible support paths:

```text
GlassFish:
  community/Eclipse ecosystem, internal expertise

Payara:
  Payara/Azul commercial support

WildFly:
  Red Hat EAP commercial support path

Open Liberty:
  IBM WebSphere Liberty commercial support path

Spring Boot:
  VMware/Broadcom Tanzu ecosystem, community, third-party support
```

---

## 28. Migration Cost Matrix

| From / To | GlassFish | Payara | WildFly | Liberty | Spring Boot |
|---|---:|---:|---:|---:|---:|
| GlassFish 5 Java EE | medium/high to GF 8 due Jakarta | medium | high | high | very high |
| Payara 5 | medium/high to Jakarta | medium | high | high | very high |
| WildFly legacy | high | high | medium | high | very high |
| Liberty legacy | high | high | high | medium | very high |
| Spring Boot app | high | high | high | medium/high | low |

This is rough. Real cost depends on app portability.

---

## 29. Runtime Lock-In

Lock-in sources:

```text
server descriptors
admin CLI scripts
resource config
security realm
JNDI naming
JPA provider-specific features
JMS provider-specific behavior
JCA adapters
monitoring tooling
deployment pipeline
operational knowledge
```

Even with Jakarta EE standards, operational lock-in exists.

Mitigation:

- keep app code portable;
- isolate vendor descriptors;
- document resource config;
- use standard APIs where possible;
- avoid internal server APIs;
- test on alternate runtime if portability matters.

---

## 30. Spring Boot Migration Decision

Move Java EE app to Spring Boot if:

```text
- app is mostly REST/service layer
- EJB/JCA/full EE usage low
- team standardized on Spring
- cloud-native deployment is priority
- rewrite/refactor budget exists
- tests are strong
```

Avoid or delay if:

```text
- app deeply uses EJB/JTA/JCA/MDB/session state
- business risk high
- no test coverage
- team lacks migration time
- current app server can be modernized more safely
```

Sometimes best path:

```text
Modernize Java EE -> Jakarta EE first.
Then gradually extract services.
```

---

## 31. Payara Migration Decision from GlassFish

Choose Payara if:

```text
- you have GlassFish apps
- need commercial support
- want minimal conceptual migration
- want MicroProfile/Payara features
- can accept vendor/platform model
```

Check:

- version compatibility;
- Java/Jakarta namespace;
- descriptors/resources;
- Payara-specific config;
- licensing/support lifecycle.

---

## 32. WildFly Migration Decision

Choose WildFly/EAP if:

```text
- organization uses Red Hat stack
- wants strong enterprise support
- app is Jakarta EE portable enough
- team can learn CLI/subsystems/Elytron
- EAP support lifecycle matters
```

Migration requires careful config translation.

---

## 33. Liberty Migration Decision

Choose Liberty/WebSphere Liberty if:

```text
- organization uses IBM stack
- wants modular cloud-friendly Jakarta EE/MicroProfile
- wants commercial support
- app can adapt to server.xml/features
- lightweight runtime matters
```

Good for enterprise standards with cloud focus.

---

## 34. GlassFish Staying Decision

Stay on GlassFish if:

```text
- app already stable on GlassFish
- organization accepts support model
- internal team has expertise
- Jakarta EE 11 compatibility desired
- migration cost to other runtime not justified
- workload is well understood
```

But strengthen:

- patching;
- hardening;
- observability;
- release pipeline;
- container strategy if needed;
- internal runbooks.

---

## 35. Comparative Architecture Summary

```text
GlassFish:
  best for Jakarta EE spec learning and open implementation baseline

Payara:
  best for GlassFish-like production platform with support

WildFly:
  best for Red Hat/JBoss enterprise Jakarta EE ecosystem

Open Liberty:
  best for modular lightweight Jakarta EE/MicroProfile with IBM path

Spring Boot:
  best for app-centric microservice framework and broad ecosystem
```

No universal winner.

---

## 36. Decision Framework

Score each option 1–5:

```text
Jakarta EE compatibility
legacy migration effort
commercial support
team skill
cloud-native fit
operational tooling
performance evidence
security/patch lifecycle
cost/license
long-term roadmap
```

Example:

```text
Runtime      Compat  Migration  Support  Team  Cloud  Ops  Total
GlassFish    5       5          2        4     3      3    ...
Payara       5       5          4        4     4      4    ...
WildFly      5       3          5        3     4      5    ...
Liberty      5       3          5        2     5      4    ...
SpringBoot   2       1          4        5     5      5    ...
```

Weights matter more than raw score.

---

## 37. Scenario A: Existing GlassFish 5 Monolith

Situation:

```text
EAR with EJB/JMS/JPA/JSF
GlassFish descriptors
JDK 8
needs production support
```

Recommended shortlist:

```text
Payara 6/7
GlassFish 7/8
WildFly/EAP
Liberty
```

Spring Boot only if rewrite budget exists.

Decision:

- fastest support path likely Payara;
- standards modernization path GlassFish/Payara;
- enterprise vendor path WildFly/EAP or Liberty;
- rewrite path Spring Boot.

---

## 38. Scenario B: New REST Microservice

Situation:

```text
REST + DB + messaging
Kubernetes
small team
no EJB/JCA
```

Shortlist:

```text
Spring Boot
Open Liberty
Payara Micro
WildFly bootable/runtime
Quarkus
```

Full GlassFish server is possible but may not be operationally optimal.

---

## 39. Scenario C: Government/Regulated Jakarta EE System

Situation:

```text
long lifecycle
audit/compliance
standard APIs
stable support
formal vendor support preferred
```

Shortlist:

```text
Payara Enterprise
Red Hat EAP
IBM WebSphere Liberty
```

GlassFish possible if internal support model is approved.

---

## 40. Scenario D: Learning Top 1% Jakarta EE Runtime Internals

Best path:

```text
GlassFish first
then compare WildFly and Liberty
then understand Spring Boot contrast
```

Why:

- GlassFish source/spec alignment;
- Jakarta EE reference-like history;
- easier to map spec to implementation;
- foundational for understanding app server architecture.

---

## 41. Checklist Before Runtime Migration

```text
[Application]
- EJB usage
- JCA usage
- JMS/MDB usage
- JPA provider-specific features
- Servlet/JSF/JSP usage
- security realms/role mapping
- server descriptors

[Operations]
- deployment pipeline
- admin scripts
- monitoring
- logs
- support model
- patch process

[Dependencies]
- Jakarta namespace compatibility
- provider versions
- vendor SDKs
- resource adapters

[Runtime]
- target JDK
- memory/performance baseline
- TLS/security baseline
- clustering/session strategy

[Business]
- downtime tolerance
- rollback path
- compliance
- support contract
- team skill
```

---

## 42. Anti-Patterns

### Anti-pattern 1 — Choosing Runtime by Popularity Only

Popularity doesn't migrate your EJB/JCA app.

### Anti-pattern 2 — Choosing Runtime by Benchmark Only

Your bottleneck may be DB, not runtime.

### Anti-pattern 3 — Assuming Jakarta EE Portability Means Zero Migration

Vendor descriptors/config matter.

### Anti-pattern 4 — Rewriting to Spring Boot Without Business Case

Rewrite risk can exceed runtime modernization risk.

### Anti-pattern 5 — Staying on Old Runtime Forever

No patch/support = accumulating risk.

### Anti-pattern 6 — Ignoring Team Skill

Runtime nobody can operate becomes production risk.

### Anti-pattern 7 — Mixing Support Models Unclear

Community runtime for mission-critical app may be unacceptable unless internal support is strong.

---

## 43. Top 1% Takeaways

1. **Runtime choice is operating model choice.**
2. **GlassFish is excellent for Jakarta EE understanding and spec-close implementation.**
3. **Payara is the closest production/support-oriented path for many GlassFish users.**
4. **WildFly/EAP is strong for Red Hat enterprise Jakarta EE environments.**
5. **Open Liberty is strong for modular, cloud-friendly Jakarta EE/MicroProfile with IBM support path.**
6. **Spring Boot is not a full Jakarta EE app server; migrating deep Java EE apps is often a rewrite.**
7. **Spec compatibility does not remove operational/config migration.**
8. **Benchmark your workload, not hello-world.**
9. **Commercial support matters for mission-critical systems.**
10. **The best runtime is the one that matches app shape, team skill, ops model, and risk profile.**

---

## 44. Mini Exercise

You own this system:

```text
Current:
- GlassFish 5
- Java 8
- EAR app
- EJB stateless services
- MDB consumers
- JMS/OpenMQ
- JPA/EclipseLink
- JSF admin UI
- custom LDAP realm
- Oracle DB
- mission-critical

Goal:
- modernize runtime within 12 months
- reduce support risk
- eventually Kubernetes
```

Answer:

1. Which runtimes do you shortlist?
2. Which runtime is lowest migration cost?
3. Which runtime is best if vendor support is mandatory?
4. Is Spring Boot a runtime switch or rewrite here?
5. What migration tests are needed?
6. What operational scripts must be rewritten for WildFly/Liberty?
7. What support/licensing questions must be asked?
8. What performance baseline do you collect?
9. What rollback strategy do you require?
10. What decision matrix weights do you choose?

---

## 45. Referensi

Referensi utama:

- Eclipse GlassFish 8 Downloads — Jakarta EE 11 and JDK 21+ note  
  https://glassfish.org/download_gf8.html

- Eclipse GlassFish Release Notes, Release 8  
  https://glassfish.org/docs/latest/release-notes.html

- Payara Platform Community  
  https://payara.fish/products/payara-platform-community/

- Payara Server Enterprise  
  https://payara.fish/products/payara-server/

- Azul Payara 7 announcement  
  https://www.azul.com/blog/azul-payara-7-is-available-now-the-first-commercially-supported-jakarta-ee-11-runtime/

- WildFly 40 Release Announcement  
  https://www.wildfly.org/news/2026/05/21/WildFly-40-is-released/

- WildFly Application Server repository  
  https://github.com/wildfly/wildfly

- Open Liberty Documentation  
  https://openliberty.io/docs/latest/

- Spring Boot Reference Documentation  
  https://docs.spring.io/spring-boot/

- Jakarta EE Platform 11  
  https://jakarta.ee/specifications/platform/11/

---

## 46. Status Seri

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
Part 31 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 32 — Production Architecture Patterns dengan GlassFish
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-030.md">⬅️ Part 30 — GlassFish Source Code, Modules, Build, dan Contribution-Level Understanding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-032.md">Part 32 — Production Architecture Patterns dengan GlassFish ➡️</a>
</div>
