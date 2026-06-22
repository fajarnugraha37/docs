# Learn Java Microservices Patterns — Advanced Engineering
## Part 30 — Governance, Ownership, and Socio-Technical Architecture

**Filename:** `learn-java-microservices-patterns-advanced-engineering-30-governance-ownership-socio-technical-architecture.md`  
**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 30 of 35  
**Target level:** Advanced / staff / principal engineering  
**Java scope:** Java 8 through Java 25  

---

## 0. Why This Part Exists

Up to this point, we have discussed many technical patterns:

- service boundaries
- domain modeling
- synchronous and asynchronous communication
- event-driven architecture
- saga and compensation
- outbox/inbox
- consistency and invariants
- data ownership
- API gateway and BFF
- runtime topology
- resilience
- backpressure
- idempotency
- workflow
- state machines
- service-to-service security
- multi-tenancy
- observability
- testing
- compatibility
- deployment safety
- Kubernetes, service mesh, and Java runtime
- performance
- caching
- migration and strangler fig

But there is a deeper truth:

> Microservices fail less often because engineers do not know REST, Kafka, Redis, Kubernetes, or Spring Boot. They fail because nobody truly owns the service, nobody owns the contract, nobody owns the runtime, nobody owns the incidents, nobody owns the lifecycle, and nobody has a clear decision process when trade-offs conflict.

A microservice architecture is not only a technical structure. It is a **socio-technical system**.

That means the system's shape is produced by both:

1. the technical architecture, and
2. the organization that builds, deploys, supports, and evolves it.

If the organizational model is unclear, the architecture eventually becomes unclear too.

If the ownership model is fragmented, the service boundary eventually becomes fragmented too.

If governance is too centralized, teams cannot move.

If governance is too weak, every team invents its own HTTP conventions, retry strategy, event naming style, security model, observability labels, deployment pipeline, and data ownership interpretation.

The top engineering skill here is not memorizing another pattern. It is learning to answer:

> What should be standardized, what should be left autonomous, who owns what, who decides what, and how do we keep the system evolvable without letting it become chaos?

---

## 1. Learning Objectives

After this part, you should be able to:

1. Explain why microservices are socio-technical, not purely technical.
2. Design a service ownership model that includes code, runtime, data, contract, observability, incident, and lifecycle ownership.
3. Distinguish between central governance, decentralized governance, and federated governance.
4. Decide which parts of a Java microservices platform should be standardized.
5. Decide which parts should remain team-autonomous.
6. Understand Team Topologies concepts and apply them to microservice ownership.
7. Define interaction modes between stream-aligned teams, platform teams, enabling teams, and complicated subsystem teams.
8. Design a golden path for Java services without creating a rigid framework prison.
9. Write useful Architecture Decision Records.
10. Design API, event, data, security, testing, observability, and release governance.
11. Detect governance anti-patterns.
12. Review microservice architecture from a staff/principal engineering perspective.

---

## 2. The Core Mental Model

Microservices are often sold as:

```text
small services + independent deployment + independent teams
```

But the more accurate model is:

```text
microservices = technical boundaries + ownership boundaries + decision boundaries
```

A service is not truly autonomous only because it has its own repository.

A service is autonomous when the owning team can safely make and release changes without requiring constant coordination with every other team.

That requires:

```text
clear domain boundary
+ clear data ownership
+ clear contract ownership
+ clear runtime ownership
+ clear operational ownership
+ clear decision rights
+ clear platform support
+ clear governance constraints
```

Without these, the result is not microservices.

It is a distributed negotiation system.

---

## 3. Microservices as a Socio-Technical Architecture

A purely technical architecture diagram may show this:

```text
[Gateway] -> [Application Service] -> [Case Service] -> [Document Service]
                         |                 |                 |
                       DB-A              DB-C              DB-D
```

A socio-technical view asks different questions:

```text
Who owns Application Service?
Who owns Case Service?
Who owns Document Service?
Who owns each database?
Who owns each API contract?
Who approves breaking changes?
Who handles incidents at 2 AM?
Who pays the operational complexity cost?
Who decides when to split or merge services?
Who defines logging standards?
Who defines event naming standards?
Who manages shared libraries?
Who owns production runbooks?
Who is accountable for stale read models?
Who owns cross-service workflow failure?
```

If those questions are unanswered, the architecture is incomplete.

The boxes in the diagram are only the visible part.

The real architecture includes:

```text
people
teams
ownership
communication paths
decision rights
standards
exceptions
incident response
release flow
operational responsibility
platform constraints
business accountability
```

---

## 4. Conway's Law and Why It Matters

Conway's Law is often summarized as:

> organizations design systems that mirror their communication structures.

For microservices, this is not just an observation. It is a design constraint.

If five teams must coordinate every release, the architecture is not independently deployable, even if each service has its own deployment pipeline.

If one central team owns all database schemas, then database-per-service is mostly symbolic.

If one architecture board must approve every minor API field addition, team autonomy is fictional.

If every service depends on a shared `common-domain.jar`, then the system mirrors a centralized domain model, not independent bounded contexts.

If one platform team owns every production incident, stream-aligned teams do not truly own their services.

The architecture will follow the communication structure whether you intend it or not.

So the real question is:

> What organizational shape makes the desired architecture natural?

---

## 5. The Dangerous Myth: “Microservices Let Teams Work Independently”

Microservices can enable independent work.

They do not guarantee it.

Independence requires strong foundations:

| Foundation | Without It |
|---|---|
| Stable contracts | Every change becomes a meeting |
| Data ownership | Teams fight over schemas |
| Backward compatibility | Deployments require lockstep coordination |
| Observability | Incidents become blame games |
| Platform support | Every team reinvents infrastructure |
| Clear standards | Ecosystem becomes inconsistent |
| Clear ownership | Nobody fixes cross-cutting decay |
| Automated testing | Integration risk moves to production |
| Operational accountability | Services become abandoned after delivery |

A microservice with unclear ownership is worse than a module in a monolith.

A module in a monolith at least shares one process and usually one release lifecycle.

A microservice with unclear ownership has distributed failure, distributed data, distributed contracts, and distributed blame.

---

## 6. Ownership Is the First Governance Primitive

Governance often starts with standards:

- coding standards
- API standards
- logging standards
- deployment standards
- testing standards

But before standards, you need ownership.

Because every standard requires someone to:

1. define it,
2. maintain it,
3. explain it,
4. enforce it,
5. evolve it,
6. grant exceptions,
7. absorb feedback,
8. retire outdated rules.

Without ownership, standards become stale documents.

A production-grade service ownership model should cover at least:

```text
Domain ownership
Code ownership
Data ownership
API ownership
Event ownership
Runtime ownership
Security ownership
Observability ownership
Incident ownership
Cost ownership
Lifecycle ownership
Deprecation ownership
```

If a service lacks an owner for any of these, the gap will eventually appear as production risk.

---

## 7. Service Ownership Model

A mature ownership model should answer this for every service:

```text
Service name:
Business capability:
Owning team:
Primary product owner/domain owner:
Technical owner:
Operational owner:
Repository:
Runtime namespace:
Database/schema:
Published APIs:
Published events:
Consumed APIs/events:
SLO:
On-call responsibility:
Runbook:
Dashboard:
Incident channel:
Cost center:
Deprecation policy:
Security classification:
Data classification:
Compliance obligations:
```

This may look bureaucratic, but it prevents a worse form of bureaucracy: endless meetings caused by ambiguity.

A good ownership record reduces coordination cost.

---

## 8. Ownership Dimensions

### 8.1 Code Ownership

Code ownership means the team can change the service code safely.

But code ownership alone is weak.

A team may own the repository but still depend on:

- central database team for schema changes
- platform team for deployment changes
- architecture board for API changes
- security team for token changes
- QA team for integration environment setup
- operations team for production incidents

That is not full service ownership.

It is repository ownership.

### 8.2 Runtime Ownership

Runtime ownership means the team understands and can influence:

- CPU request/limit
- memory request/limit
- JVM options
- GC selection
- thread pool configuration
- connection pool configuration
- autoscaling behavior
- readiness/liveness/startup probes
- deployment strategy
- logs, metrics, traces
- alerts
- runbooks

A team that cannot explain why its service is OOMKilled does not fully own the service.

A team that cannot explain its readiness probe does not fully own production behavior.

### 8.3 Data Ownership

Data ownership means the team owns:

- schema evolution
- write model correctness
- published read model
- retention
- archival
- deletion
- data quality
- migration
- reconciliation
- access control
- data classification

A team that owns the API but not the database is not fully autonomous.

### 8.4 Contract Ownership

Contract ownership means the team owns:

- API compatibility
- event compatibility
- schema evolution
- deprecation policy
- documentation
- consumer communication
- contract tests
- versioning decisions

A service's consumers should know who to talk to when a contract is unclear or broken.

### 8.5 Incident Ownership

Incident ownership means the team owns:

- detection
- triage
- mitigation
- communication
- post-incident analysis
- reliability backlog

If incidents are always thrown to a separate operations team, developers lose feedback from production.

The service becomes something built by one group and suffered by another.

That is a common failure mode.

### 8.6 Cost Ownership

Microservices make cost more granular but also easier to hide.

A service owner should understand:

- compute cost
- database cost
- messaging cost
- observability cost
- cache cost
- storage cost
- network transfer cost
- engineering maintenance cost

Cost governance should not only ask:

```text
Can we reduce CPU?
```

It should ask:

```text
Is this service worth existing separately?
Is this projection worth maintaining?
Is this event fan-out worth the operational cost?
Is this duplicate data worth the query performance benefit?
```

---

## 9. Products, Not Projects

A common enterprise failure mode is treating services as projects.

Project mindset:

```text
build feature
pass UAT
deploy
handover
move team away
```

Product/service mindset:

```text
own capability
operate service
evolve contract
manage incidents
track SLO
observe cost
support consumers
retire obsolete behavior
```

Microservices need long-lived ownership.

A service is not done when code is deployed.

A service is alive as long as it has consumers, data, operational risk, and business responsibility.

This is why microservices pair naturally with product-aligned teams, not temporary project teams.

---

## 10. Team Topologies Lens

Team Topologies provides a useful vocabulary for designing team structures around software flow.

The four team types are:

1. stream-aligned team
2. platform team
3. enabling team
4. complicated subsystem team

The three interaction modes are:

1. collaboration
2. X-as-a-Service
3. facilitating

This vocabulary is useful because microservices are not only about cutting software into services. They are also about deciding which teams own which value streams, platforms, enabling capabilities, and specialist subsystems.

### 10.1 Stream-Aligned Team

A stream-aligned team owns a flow of business value.

In a regulatory platform, examples might be:

```text
Application Processing Team
Case Management Team
Compliance Inspection Team
Appeal Management Team
Revenue/Payment Team
Document and Correspondence Team
```

A stream-aligned team should own services aligned to a domain capability.

It should not need to coordinate with many other teams for every small release.

### 10.2 Platform Team

A platform team provides internal services that reduce cognitive load for stream-aligned teams.

Examples:

```text
Java service template
CI/CD pipeline
Kubernetes deployment abstraction
observability baseline
centralized logging/tracing setup
secrets integration
authentication integration
service catalog
contract registry
event catalog
standard local dev environment
```

A platform team's job is not to own all services.

Its job is to make owning services easier.

A good platform team reduces repeated infrastructure decisions.

A bad platform team becomes a ticket queue bottleneck.

### 10.3 Enabling Team

An enabling team helps other teams learn or adopt capabilities.

Examples:

```text
help teams adopt contract testing
help teams migrate to Java 21/25
help teams implement outbox pattern
help teams improve SLO and alerting
help teams conduct threat modeling
help teams adopt OpenTelemetry
```

The key point: enabling teams should not become permanent owners of other teams' services.

They raise capability, then move on.

### 10.4 Complicated Subsystem Team

Some domains are legitimately complex and require specialist ownership.

Examples:

```text
rule engine
eligibility engine
screening engine
identity broker
cryptographic signing subsystem
workflow engine platform
high-performance search/indexing subsystem
payment settlement subsystem
```

A complicated subsystem team owns a hard technical/domain area so stream-aligned teams do not all need deep specialist knowledge.

But this can become dangerous if every shared service is labeled “complicated”.

Use this category carefully.

---

## 11. Team Interaction Modes

### 11.1 Collaboration

Collaboration means two teams work closely for a limited period.

Good for:

```text
new boundary discovery
major migration
complex integration
new platform capability design
incident response involving multiple domains
```

Bad when it becomes permanent.

Permanent collaboration often means the boundary is wrong or the platform is incomplete.

### 11.2 X-as-a-Service

One team provides something consumed by another through a clear interface.

Examples:

```text
Identity-as-a-Service
Notification-as-a-Service
Document Rendering-as-a-Service
Observability Platform-as-a-Service
CI/CD Pipeline-as-a-Service
```

This mode requires strong contract, documentation, SLO, support, and evolution policy.

### 11.3 Facilitating

One team helps another team build capability.

Examples:

```text
Security team facilitates threat modeling
Platform team facilitates service template adoption
Architecture team facilitates ADR writing
Observability team facilitates dashboard design
```

Facilitating should increase local ownership, not create dependency.

---

## 12. Governance Spectrum

Governance can be imagined as a spectrum.

```text
No governance        Federated governance        Centralized governance
     |----------------------|-----------------------------|
chaos              balanced autonomy             bottleneck
```

### 12.1 No Governance

Symptoms:

- every service has different logging style
- every team invents its own error response format
- no consistent correlation ID
- no contract compatibility rule
- no consistent authentication model
- no event naming convention
- no SLO standard
- no incident process
- no dependency ownership
- no API lifecycle

This feels fast early.

It becomes expensive later.

### 12.2 Over-Centralized Governance

Symptoms:

- architecture board approves trivial changes
- platform team must approve every deployment
- security approval blocks every release
- one shared library dictates all teams' domain model
- only central team can create topics, schemas, dashboards, or secrets
- developers avoid change because process is too heavy

This feels safe.

It becomes slow and brittle.

### 12.3 Federated Governance

Federated governance means:

```text
central standards for things that must be consistent
local autonomy for things that can vary safely
transparent exception process
feedback loop from teams
standards maintained as products
```

This is usually the healthiest model for large microservice ecosystems.

---

## 13. What Should Be Standardized?

Not everything should be standardized.

But some things must be standardized because inconsistency creates systemic risk.

Good candidates for standardization:

```text
service naming convention
repository layout baseline
build pipeline minimum gates
container image baseline
health endpoint contract
logging format
trace propagation headers
correlation ID policy
error response format
API compatibility policy
event envelope metadata
security/token validation baseline
secret handling
SLO template
incident severity model
runbook template
ADR template
OpenAPI/AsyncAPI publication
contract testing expectation
dependency vulnerability policy
release metadata labels
```

These standards reduce cognitive load and make services easier to operate.

---

## 14. What Should Remain Autonomous?

Some decisions should remain with the owning team.

Good candidates for team autonomy:

```text
domain model internals
aggregate design
local database schema design
internal package structure
local implementation strategy
choice of synchronous vs asynchronous inside owned boundary
team-specific dashboard details
local performance optimizations
local algorithm choices
feature design within domain capability
```

But autonomy does not mean secrecy.

A team can be autonomous while still publishing contracts, metrics, and ADRs.

---

## 15. The Standardization Decision Test

Before standardizing something, ask:

```text
1. Does inconsistency create production risk?
2. Does inconsistency increase cognitive load across many teams?
3. Does inconsistency make incident response harder?
4. Does inconsistency break security/compliance posture?
5. Does inconsistency make automation difficult?
6. Is this decision repeated often enough to justify standardization?
7. Can the standard be expressed as a reusable platform/golden path?
8. Can teams safely opt out with justification?
```

If the answer is mostly yes, standardize it.

If not, document guidance but allow team autonomy.

---

## 16. Golden Path

A golden path is an opinionated, supported way to build and operate services.

It should provide:

```text
service scaffold
build pipeline
containerization
security baseline
observability baseline
health checks
configuration pattern
secrets integration
contract publication
standard error response
standard logging
OpenTelemetry setup
local development environment
test strategy template
runbook template
ADR template
sample dashboards
sample alerts
```

A golden path should reduce friction.

It should not become an inflexible prison.

The best golden paths are:

- opinionated
- automated
- documented
- observable
- versioned
- actively maintained
- easy to adopt
- possible to override with ADR

Bad golden paths become internal frameworks that nobody can debug.

---

## 17. Internal Developer Platform

An Internal Developer Platform, or IDP, provides self-service capabilities to engineering teams.

Examples:

```text
create new service
provision database
create Kubernetes namespace
configure CI/CD
publish OpenAPI contract
publish AsyncAPI/event contract
create dashboard
create alert
manage secrets
request certificate
create topic/queue
view service ownership
view dependency graph
view runtime health
```

The point of an IDP is not to hide everything.

The point is to make the safe path easy.

A good IDP has three effects:

1. teams move faster,
2. standards are applied automatically,
3. platform complexity is reduced for product teams.

A bad IDP is just a web UI over ticket creation.

---

## 18. Architecture Decision Records

An Architecture Decision Record captures one important architectural decision and its rationale.

A good ADR explains:

```text
Context
Decision
Consequences
Alternatives considered
Status
Owner
Date
Links to related decisions
```

The goal is not documentation for its own sake.

The goal is architectural memory.

Without ADRs, teams repeatedly re-litigate old decisions:

```text
Why did we choose outbox instead of direct publish?
Why are we using database-per-service here?
Why is the gateway not allowed to contain business logic?
Why did we choose choreography for this process?
Why did we reject shared library X?
Why is this service still on Java 11?
Why is this API not versioned by URL?
```

ADRs prevent knowledge evaporation.

They also make trade-offs explicit.

### 18.1 ADR Template

```markdown
# ADR-0007: Use Transactional Outbox for ApplicationSubmitted Events

## Status
Accepted

## Date
2026-06-19

## Context
Application submission updates the Application aggregate and must publish an
ApplicationSubmitted integration event. Directly writing the database and then
publishing to the broker creates a dual-write failure mode.

## Decision
We will persist the Application state and an outbox record in the same local
database transaction. A relay will publish outbox records to the broker. Consumers
must be idempotent.

## Alternatives Considered
1. Direct publish after DB commit
2. Broker transaction only
3. Distributed transaction / 2PC
4. CDC-based outbox

## Consequences
Positive:
- avoids DB/message dual-write inconsistency
- supports replay and audit
- enables decoupled publishing

Negative:
- adds outbox table and relay complexity
- requires cleanup policy
- consumers must handle duplicates

## Follow-up
- Define outbox retention policy
- Add metrics for unpublished outbox age
- Add alert for relay lag
```

### 18.2 What Makes an ADR Bad?

Bad ADRs are:

- too long
- written after the fact to justify politics
- missing alternatives
- missing consequences
- too abstract
- never updated
- not linked to code/repo/service
- not discoverable
- not owned

A useful ADR is short enough to read and concrete enough to guide future decisions.

---

## 19. Architecture Review Without Becoming a Bottleneck

Architecture review should improve decision quality.

It should not become a centralized permission ceremony.

A good review process asks:

```text
What decision is being made?
What are the trade-offs?
What are the failure modes?
What is the ownership model?
What is the compatibility model?
What is the rollback/roll-forward plan?
What is the observability plan?
What is the security model?
What is the data ownership model?
What is the cost/complexity impact?
What assumptions could be wrong?
How will we know if the decision failed?
```

### 19.1 Review by Risk Level

Not all changes need the same review.

| Change Type | Review Level |
|---|---|
| Internal refactor | Team review |
| Additive API field | Contract check + team review |
| New service | Architecture review |
| New database ownership boundary | Architecture + data review |
| New external integration | Architecture + security review |
| Breaking contract change | Architecture + consumer approval |
| New authentication flow | Security architecture review |
| New event platform pattern | Architecture + platform review |
| Cross-service workflow change | Architecture + reliability review |

The goal is proportional governance.

Heavy governance for high-risk decisions.

Light governance for low-risk decisions.

---

## 20. API Governance

API governance should define:

```text
API style
naming convention
resource modeling guidance
error response format
pagination standard
filtering/sorting convention
idempotency requirement
correlation header
authentication/authorization expectation
OpenAPI publication
backward compatibility policy
deprecation/sunset policy
contract testing expectation
```

API governance should not dictate every controller method implementation.

It should define the consumer-facing contract rules.

### 20.1 API Governance Checklist

```text
Is the API owner clear?
Is the API published in a catalog?
Is there an OpenAPI spec?
Is the API backward compatible?
Are errors standardized?
Are timeouts documented?
Are idempotency rules documented?
Are auth scopes/audiences documented?
Are rate limits documented?
Are deprecated fields marked?
Are consumers known?
Are contract tests in CI?
```

---

## 21. Event Governance

Event governance should define:

```text
event naming convention
event owner
event envelope metadata
schema publication
schema compatibility policy
topic naming convention
partition key guidance
retention policy
replay policy
PII/security classification
consumer registration
DLQ policy
deprecation policy
```

Event governance is often weaker than API governance because events feel internal.

That is dangerous.

Events create hidden dependencies.

A poorly governed event ecosystem becomes event soup.

### 21.1 Event Governance Checklist

```text
Is the event a fact, not a command?
Who owns the event?
Who owns the schema?
Who owns the topic?
Who are the consumers?
What compatibility rules apply?
Can the event be replayed safely?
Does it contain sensitive data?
What is the partition key?
What is the retention period?
What is the deprecation process?
```

---

## 22. Data Governance in Microservices

Data governance must balance local ownership with enterprise correctness.

It should define:

```text
data owner
system of record
published data products
reference data ownership
master data ownership
data classification
retention policy
archival policy
deletion policy
reconciliation responsibility
cross-service reporting strategy
data quality metrics
access control
PII handling
audit requirements
```

The dangerous mistake is assuming database-per-service means no data governance.

Actually, database-per-service requires stronger data governance because data becomes duplicated and distributed.

---

## 23. Security Governance

Security governance should define:

```text
service identity standard
token validation rules
audience validation
scope/permission model
mTLS policy
secret storage
secret rotation
certificate rotation
security logging
security incident process
vulnerability scanning
container image scanning
dependency scanning
threat modeling expectations
```

Security governance must be embedded into the golden path as much as possible.

If security is only a late approval gate, teams will experience it as friction.

If security is baked into service templates, CI/CD, runtime policy, and platform defaults, security becomes normal engineering.

---

## 24. Observability Governance

Observability governance should define:

```text
log format
required log fields
trace propagation
span naming conventions
metric naming conventions
cardinality limits
service labels
team ownership labels
SLO template
alert severity model
runbook template
dashboard baseline
retention policy
PII redaction rules
```

Without observability governance, incidents become slow because every service emits different signals.

The goal is not identical dashboards everywhere.

The goal is enough consistency that engineers can move across services during incidents.

---

## 25. Testing Governance

Testing governance should define minimum confidence gates:

```text
unit test expectation
component test expectation
contract test expectation
integration test expectation
security test expectation
performance regression threshold
migration test expectation
E2E ownership
flaky test policy
coverage interpretation
release blocking rules
```

Do not use coverage percentage as the only quality gate.

A system can have high coverage and still break every contract.

For microservices, compatibility and contract confidence often matter more than raw line coverage.

---

## 26. Release Governance

Release governance should answer:

```text
Who can deploy?
When can deploy happen?
What checks are required?
What is the rollback/roll-forward policy?
What is the canary policy?
What is the feature flag policy?
How are breaking changes handled?
How are database migrations sequenced?
How are consumers notified?
What telemetry is checked after release?
```

Good release governance enables frequent safe release.

Bad release governance either blocks everything or permits unsafe chaos.

---

## 27. Dependency Governance

Microservices have dependency graphs.

Those graphs need governance.

Governance should track:

```text
service-to-service dependencies
API consumers
event consumers
shared library usage
database dependencies
runtime dependencies
third-party integrations
Java version usage
framework version usage
vulnerability status
```

Dependency governance helps answer:

```text
If this API changes, who breaks?
If this topic schema changes, who breaks?
If this library has CVE, who is affected?
If this service is down, what business flows fail?
If this service is deprecated, who must migrate?
```

A service catalog is one tool for this.

But the catalog must stay fresh.

A stale catalog is worse than none because it creates false confidence.

---

## 28. Shared Libraries Governance

Shared libraries are dangerous in microservice ecosystems.

They can reduce duplication.

They can also recreate a distributed monolith.

### 28.1 Good Shared Library Candidates

```text
logging helper
trace context propagation
error response utilities
security token validation adapter
OpenTelemetry instrumentation helper
idempotency infrastructure
outbox infrastructure
common test utilities
client generator runtime
```

### 28.2 Bad Shared Library Candidates

```text
shared domain model
shared JPA entities
shared business rules across bounded contexts
shared enum controlling multiple domains
shared workflow status model
shared service implementation base class with hidden behavior
```

The rule:

> Share infrastructure behavior carefully. Avoid sharing domain meaning across bounded contexts unless it is an intentional shared kernel with explicit ownership.

### 28.3 Shared Library Versioning

Shared libraries require:

```text
semantic versioning
changelog
compatibility policy
CVE tracking
migration guide
owner
release cadence
backward compatibility expectation
```

A shared library without ownership becomes ecosystem debt.

---

## 29. Java 8–25 Governance Considerations

A Java microservices ecosystem often spans multiple Java versions.

You may have:

```text
legacy Java 8 services
Java 11 migrated services
Java 17 baseline services
Java 21 services using virtual threads
Java 25 early/latest runtime services
```

Governance must define:

```text
minimum supported Java version
target Java version
LTS migration policy
allowed framework versions
security patch policy
container base image policy
GC defaults
JVM flag baseline
observability agent compatibility
build tool version policy
language feature usage policy
```

### 29.1 Java Version Policy Example

```text
Current strategic baseline: Java 21
Legacy supported baseline: Java 8 and 11 only for existing services
New services: Java 21 unless exception approved
Java 25: allowed for pilot services after platform validation
Virtual threads: allowed for IO-heavy services after load test
Preview features: not allowed in production services unless explicitly approved
```

The purpose is not to chase the newest version blindly.

The purpose is to avoid uncontrolled fragmentation.

### 29.2 Framework Version Governance

For Java microservices, governance should track:

```text
Spring Boot versions
Spring Cloud versions
Quarkus versions
Jakarta EE versions
MicroProfile versions
Maven/Gradle versions
container base image versions
OpenTelemetry agent versions
logging framework versions
serialization library versions
HTTP client versions
Kafka/RabbitMQ/Redis client versions
```

Why?

Because an ecosystem with 80 services and 30 framework combinations is hard to patch, operate, and support.

---

## 30. Golden Path for Java Microservices

A Java microservice golden path might include:

```text
Java 21 or approved Java baseline
Spring Boot or Quarkus service template
standard Gradle/Maven build
standard Dockerfile
standard Kubernetes manifests/Helm/Kustomize abstraction
standard health endpoints
standard OpenTelemetry instrumentation
standard JSON error model
standard correlation ID filter
standard request logging
standard security filter
standard OpenAPI generation
standard contract test setup
standard Testcontainers setup
standard readiness/liveness/startup probe
standard graceful shutdown
standard dashboard
standard alert pack
standard runbook
standard ADR folder
standard dependency scanning
standard SBOM generation
```

The golden path should answer:

```text
How do I create a new service safely?
How do I expose an API safely?
How do I consume an API safely?
How do I publish an event safely?
How do I consume an event safely?
How do I deploy safely?
How do I observe safely?
How do I handle secrets safely?
How do I test safely?
How do I document decisions safely?
```

---

## 31. Service Catalog

A service catalog should show:

```text
service name
owner
repository
runtime namespace
language/runtime version
framework version
business capability
APIs published
APIs consumed
events published
events consumed
database ownership
SLO
runbook
dashboard
alerts
on-call rotation
security classification
data classification
cost
lifecycle status
```

Lifecycle status examples:

```text
proposed
active
deprecated
migrating
retiring
retired
```

The catalog is useful only if integrated into engineering flow.

For example:

- service creation updates catalog
- contract publication updates catalog
- deployment metadata updates catalog
- ownership changes update catalog
- deprecation updates catalog

Manual-only catalogs decay quickly.

---

## 32. Ownership Matrix

A simple ownership matrix can clarify responsibility.

| Area | Service Team | Platform Team | Security Team | Architecture Group | Operations/SRE |
|---|---:|---:|---:|---:|---:|
| Domain model | A/R | C | C | C | I |
| API contract | A/R | C | C | C | I |
| Event schema | A/R | C | C | C | I |
| Database schema | A/R | C | C | C | I |
| CI/CD template | C | A/R | C | I | C |
| Runtime platform | C | A/R | C | I | C |
| Secret policy | R | C | A | I | C |
| SLO definition | A/R | C | C | C | C |
| Alert response | A/R | C | C | I | C |
| Incident process | R | C | C | I | A/R depending model |
| Service code | A/R | I | I | I | I |

Legend:

```text
A = Accountable
R = Responsible
C = Consulted
I = Informed
```

Avoid shared accountability.

When everyone is accountable, nobody is accountable.

---

## 33. On-Call and Operational Ownership

Microservices without operational ownership become fragile.

A mature on-call model should define:

```text
service owner
primary on-call
secondary on-call
escalation path
incident severity
response expectations
runbook
dashboards
known failure modes
rollback/roll-forward instructions
communication channel
post-incident review process
```

### 33.1 Build It, Run It?

“Build it, run it” is powerful but must be applied carefully.

It works when teams have:

- enough people
- platform support
- good observability
- clear escalation path
- reasonable alert quality
- training
- sustainable rotation

It fails when:

- too few engineers carry too many services
- alerts are noisy
- platform is immature
- teams have responsibility without authority
- management treats on-call as invisible labor

Operational ownership must come with operational capability.

---

## 34. Cognitive Load

Cognitive load is one of the most important concepts in microservice governance.

A team cannot own infinite services, infinite workflows, infinite frameworks, and infinite runtime details.

A team has limited cognitive budget.

Governance should reduce unnecessary cognitive load.

Bad microservice ecosystems increase cognitive load through:

```text
too many services
inconsistent conventions
unclear ownership
manual deployments
weak observability
unclear contracts
too many frameworks
too many shared libraries
poor documentation
complex local setup
```

Good governance reduces cognitive load through:

```text
standard templates
golden paths
service catalog
clear ownership
consistent telemetry
contract-first discipline
self-service platform
training
enabling teams
clear escalation paths
```

---

## 35. Architecture Governance Artifacts

Useful governance artifacts include:

```text
service ownership record
service catalog
API catalog
event catalog
ADR repository
architecture principles
engineering standards
golden path documentation
reference architecture
threat model template
runbook template
SLO template
incident review template
compatibility policy
release policy
data ownership map
dependency graph
lifecycle/deprecation register
```

The trap is producing documents nobody uses.

Every artifact should answer:

```text
Who uses this?
When do they use this?
What decision does this improve?
How does it stay current?
Who owns it?
```

If you cannot answer those, the artifact is probably governance theater.

---

## 36. Architecture Principles for Microservices Governance

Example principles:

```text
1. Services are owned as long-lived products, not temporary projects.
2. Every service has one accountable owning team.
3. Service boundaries follow business capability and data ownership.
4. Databases are private to owning services unless explicitly approved.
5. Published contracts must be backward compatible by default.
6. Breaking changes require consumer migration plan.
7. Events are facts and must have owners, schemas, and lifecycle policy.
8. All services must emit standard logs, metrics, and traces.
9. All services must have SLOs, runbooks, and dashboards.
10. Platform standards should be automated through golden paths.
11. Teams may deviate from standards through explicit ADR and review.
12. Operational responsibility must come with authority and support.
13. Security controls should be embedded in platform defaults.
14. Governance should be proportional to risk.
15. Complexity must be justified by business value.
```

Principles are useful only if they are used in real decisions.

---

## 37. Governance Anti-Patterns

### 37.1 Architecture Police

Architecture group only says no.

Symptoms:

- teams avoid architecture review
- decisions happen secretly
- reviews happen too late
- standards are imposed without support
- architecture team has no production accountability

Better model:

```text
architecture as enabling function
architecture as decision quality improvement
architecture as shared learning
architecture as risk review
```

### 37.2 Platform Bottleneck

Every team needs platform team tickets for basic work.

Symptoms:

- new service creation takes weeks
- environment changes wait in queue
- dashboard creation requires platform request
- secret creation requires manual ticket
- teams work around platform

Better model:

```text
self-service platform
golden path automation
clear paved road
observable platform SLO
```

### 37.3 Standardization Theater

Many standards exist but nobody follows them.

Symptoms:

- outdated wiki pages
- no automation
- no CI checks
- no owner
- exceptions undocumented
- standards conflict with reality

Better model:

```text
small number of enforced standards
automated checks
active ownership
clear exception process
```

### 37.4 Autonomy Without Accountability

Teams can choose anything but do not own consequences.

Symptoms:

- many frameworks
- inconsistent operations
- weak observability
- no on-call ownership
- no compatibility discipline
- production incidents handled by someone else

Better model:

```text
autonomy + production ownership + platform baseline
```

### 37.5 Accountability Without Authority

Teams are blamed for services but cannot change runtime, deployment, database, or security policy.

Symptoms:

- teams own incidents but not infrastructure
- teams cannot tune resources
- teams cannot fix pipeline issues
- teams cannot change alert thresholds
- teams depend on central teams for all remediation

Better model:

```text
responsibility must match authority
```

### 37.6 Shared Domain Library

All services import shared business entities.

Symptoms:

- one enum change impacts many services
- one domain class has many meanings
- teams coordinate releases around shared library
- bounded contexts collapse

Better model:

```text
explicit contracts
context-specific models
anti-corruption layer
intentional shared kernel only when justified
```

### 37.7 The Common Service Trap

A “common” service accumulates unrelated responsibilities.

Symptoms:

```text
Common Service handles user lookup, dropdown data, email template, document sequence,
reference data, audit helper, notification preference, feature flag, and random utility APIs.
```

This service becomes a hidden monolith.

Better model:

```text
separate by ownership and capability
platform concerns go to platform
reference data gets explicit ownership
utility behavior becomes library only if infrastructure-level
```

### 37.8 Governance by Meeting

Every decision requires synchronous meetings.

Symptoms:

- slow approvals
- undocumented decisions
- same debates repeated
- decision ownership unclear

Better model:

```text
asynchronous ADRs
risk-based review
clear principles
default standards
lightweight exception process
```

---

## 38. Governance Maturity Model

### Level 0 — Accidental

```text
No clear ownership
No service catalog
No contract policy
No standard observability
No runbooks
Manual release coordination
```

### Level 1 — Documented

```text
Ownership exists in documents
API standards exist
Some runbooks exist
Some dashboards exist
Architecture review exists
```

Problem: much is still manual and stale.

### Level 2 — Standardized

```text
Common templates
Standard logging/tracing
Contract publication
Release checklist
Basic service catalog
Security baseline
```

Problem: adoption may still depend on discipline.

### Level 3 — Automated

```text
Golden path scaffolding
CI/CD policy checks
Automatic service catalog updates
Contract compatibility checks
Automated dependency scanning
Automated telemetry baseline
```

### Level 4 — Federated and Adaptive

```text
Teams own services end-to-end
Platform reduces cognitive load
Governance is risk-based
Standards evolve through feedback
Architecture decisions are transparent
SLO/cost/reliability inform decisions
```

This is the target for a mature microservice ecosystem.

---

## 39. Practical Governance Design Process

When designing governance for a Java microservice ecosystem, proceed step by step.

### Step 1 — Map Services and Owners

Create a list:

```text
service
business capability
owner
repository
runtime
published contracts
database
on-call
status
```

Find orphan services.

An orphan service is a production risk.

### Step 2 — Map Dependencies

Map:

```text
API calls
event flows
database dependencies
shared libraries
external systems
runtime dependencies
```

Look for:

```text
cycles
fan-out hubs
hidden critical services
unowned contracts
shared database access
unknown consumers
```

### Step 3 — Define Non-Negotiable Standards

Start small.

For example:

```text
correlation ID
standard error response
health endpoints
OpenAPI publication
owner label
dashboard/runbook
security token validation
backward compatible API changes
event envelope metadata
```

### Step 4 — Build Golden Path

Automate the standards.

A standard that is hard to follow will be bypassed.

### Step 5 — Define Exception Process

Teams need a safe way to say:

```text
This standard does not fit our case because...
```

The exception should be documented with an ADR.

### Step 6 — Create Review Process by Risk

Low-risk decisions stay local.

High-risk decisions get review.

### Step 7 — Measure Governance Health

Track:

```text
services with owner
services with runbook
services with SLO
services with dashboard
services with published contracts
services using supported Java version
services with outdated dependencies
services with unknown consumers
incidents caused by contract breakage
incidents caused by ownership gap
mean time to create new service
mean time to onboard developer
```

Governance should be measured by reduced friction and reduced risk, not by number of documents.

---

## 40. Case Study: Regulatory Case Management Platform

Imagine a regulatory platform with these domains:

```text
Application Management
Case Management
Compliance Inspection
Appeal Management
Document Management
Correspondence
Payment/Revenue
Screening Engine
Notification
User/Profile
Reporting
Audit
```

### 40.1 Bad Ownership Model

```text
All backend services owned by Backend Team
All frontend owned by Frontend Team
All DB changes owned by DBA Team
All deployments owned by DevOps Team
All incidents owned by Operations Team
All architecture decisions owned by Architecture Team
```

This looks organized but creates bottlenecks.

Every meaningful change crosses many ownership boundaries.

### 40.2 Better Ownership Model

```text
Application Processing Team
- owns Application Service
- owns Application DB/schema
- owns Application API/event contracts
- owns Application worklist projection
- owns Application SLO/runbook

Case Management Team
- owns Case Service
- owns Case lifecycle state machine
- owns Case DB/schema
- owns Case APIs/events
- owns Case incident response

Document Platform Team
- owns document storage/rendering/scanning capabilities
- provides Document-as-a-Service
- publishes clear APIs/SLOs

Platform Team
- owns golden path
- owns Kubernetes/platform baseline
- owns CI/CD templates
- owns observability baseline
- owns service catalog automation

Security/Identity Team
- owns identity broker and policy standards
- facilitates threat modeling
- defines token/certificate policy

Architecture Group
- owns principles and high-risk reviews
- facilitates ADR discipline
- does not approve every small change
```

### 40.3 Governance Records

Each service has:

```text
owner
contract
runbook
SLO
dashboard
data classification
security classification
ADR folder
consumer list
incident history
lifecycle status
```

### 40.4 Example Decision

Question:

```text
Should Application Service directly query Case Service database for worklist filtering?
```

Governance response:

```text
No by default.
Database ownership rule prohibits cross-service DB access.
Alternative: Application Worklist Projection consumes Application and Case events.
If direct DB access is proposed, it requires ADR and architecture/data governance review.
```

This is governance enabling architecture integrity.

---

## 41. Staff/Principal Engineer Review Questions

Ask these during architecture review:

### Ownership

```text
Who owns this service end-to-end?
Who owns incidents?
Who owns data?
Who owns API/event contracts?
Who owns the runbook?
Who owns deprecation?
```

### Autonomy

```text
Can the team deploy independently?
What coordination is required?
Is coordination caused by business reality or architecture weakness?
```

### Governance

```text
Which standards apply?
Which exceptions are requested?
Are exceptions documented?
Is governance proportional to risk?
```

### Platform

```text
Is there a golden path for this service type?
Is the team fighting the platform?
Does the platform reduce cognitive load?
```

### Contracts

```text
Are APIs/events published?
Are compatibility rules clear?
Are consumers known?
Are contract tests present?
```

### Operations

```text
Does the service have SLO?
Does it have dashboard?
Does it have alerts?
Does it have runbook?
Can the owner diagnose production failure?
```

### Evolution

```text
How will this service evolve?
How will it be deprecated?
What happens if ownership changes?
What happens if the team disappears?
```

---

## 42. Production Readiness Checklist

A microservice is not production-ready unless governance and ownership are clear.

```text
[ ] Service has one accountable owning team
[ ] Business capability is documented
[ ] Repository is known
[ ] Runtime namespace/environment is known
[ ] Database/data ownership is clear
[ ] API contracts are published
[ ] Event contracts are published if applicable
[ ] Consumers are discoverable
[ ] SLO is defined
[ ] Dashboard exists
[ ] Alerts exist
[ ] Runbook exists
[ ] On-call/escalation path exists
[ ] Security classification is known
[ ] Data classification is known
[ ] Secret handling follows standard
[ ] Deployment path follows golden path or ADR exception
[ ] Java/runtime version follows policy or ADR exception
[ ] Contract compatibility policy is followed
[ ] Breaking changes have migration plan
[ ] Incident process is defined
[ ] Cost ownership is clear
[ ] Deprecation/lifecycle status is documented
```

---

## 43. Practical Exercises

### Exercise 1 — Ownership Audit

Take 10 services in your system and create this table:

```text
Service | Owner | DB Owner | API Owner | Event Owner | Runtime Owner | SLO | Runbook | On-call | Status
```

Find gaps.

Any blank cell is a risk.

### Exercise 2 — Governance Classification

Pick 20 engineering decisions and classify them:

```text
team-local
golden path default
architecture review
security review
data governance review
```

Then ask:

```text
Are we over-reviewing low-risk decisions?
Are we under-reviewing high-risk decisions?
```

### Exercise 3 — Golden Path Design

Design a Java service golden path:

```text
service scaffold
build
container
config
secret
health
observability
security
OpenAPI
contract tests
deployment
runbook
```

Then identify which pieces can be automated.

### Exercise 4 — ADR Practice

Write an ADR for one of these decisions:

```text
Use database-per-service for Case Service
Use transactional outbox for ApplicationSubmitted event
Adopt Java 21 as baseline for new services
Use BFF for officer worklist UI
Reject shared domain model library
Adopt OpenTelemetry baseline
```

### Exercise 5 — Anti-Pattern Hunt

Find examples of:

```text
shared database
shared domain library
god gateway
common service trap
platform bottleneck
architecture police
autonomy without accountability
accountability without authority
```

For each, write:

```text
symptom
risk
root cause
migration path
```

---

## 44. Key Takeaways

1. Microservices are socio-technical systems.
2. Service boundaries and team boundaries influence each other.
3. Ownership is more important than repository separation.
4. A service must be owned across code, data, contract, runtime, incident, cost, and lifecycle.
5. Governance should not mean central control of everything.
6. Good governance standardizes systemic risks and leaves safe choices autonomous.
7. Platform teams should reduce cognitive load, not become bottlenecks.
8. Golden paths are better than wiki-only standards.
9. ADRs preserve architectural memory and decision rationale.
10. API, event, data, security, observability, testing, and release governance are all necessary at scale.
11. Autonomy without accountability creates chaos.
12. Accountability without authority creates frustration.
13. The best microservice ecosystems combine clear ownership, strong platform support, and federated governance.

---

## 45. References

- Martin Fowler and James Lewis, **Microservices** — https://martinfowler.com/articles/microservices.html
- Martin Fowler, **Microservices Guide** — https://martinfowler.com/microservices/
- Martin Fowler, **Architecture Decision Record** — https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
- Michael Nygard, **Documenting Architecture Decisions** — https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- ADR GitHub Organization, **Architectural Decision Records** — https://adr.github.io/
- Team Topologies, **Key Concepts** — https://teamtopologies.com/key-concepts
- Team Topologies, **Organizing for Fast Flow of Value** — https://teamtopologies.com/
- Atlassian, **Team Topologies** — https://www.atlassian.com/devops/frameworks/team-topologies
- Thoughtworks, **Engineering Platforms and Golden Paths** — https://www.thoughtworks.com/insights/podcasts/technology-podcasts/engineering-platforms-golden-paths-building-better-developer-experiences
- Martin Fowler / Zhamak Dehghani, **Data Mesh Principles and Logical Architecture** — https://martinfowler.com/articles/data-mesh-principles.html

---

# End of Part 30

Seri belum selesai. Lanjut ke Part 31: **Incident, Failure Analysis, and Reliability Operations**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-29-migration-monolith-decomposition-strangler-fig.md">⬅️ Part 29 — Data Migration, Monolith Decomposition, and Strangler Fig</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-31-incident-failure-analysis-reliability-operations.md">Learn Java Microservices Patterns — Advanced Engineering ➡️</a>
</div>
