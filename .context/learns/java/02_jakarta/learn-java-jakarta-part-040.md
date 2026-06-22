# learn-java-jakarta-part-040.md

# Bagian 40 — Jakarta EE Production Readiness & Top 1% Engineering Playbook: Reliability, Security, Observability, Performance, Cost, Governance, dan Long-Term Maintainability

> Target pembaca: Java/Jakarta engineer yang ingin naik level dari “bisa membuat aplikasi jalan” menjadi engineer yang bisa **mengoperasikan, mempertahankan, mengamankan, mengukur, memigrasikan, dan mengembangkan aplikasi Jakarta EE production-grade** dalam jangka panjang.
>
> Fokus bagian ini: production readiness end-to-end untuk Jakarta EE 11/modern runtime: SLO, SLA, error budget, health/readiness, graceful shutdown, deployment safety, observability, OpenTelemetry, logs/metrics/traces, security, dependency governance, runtime hardening, performance, virtual threads, GC, database pools, messaging backpressure, batch reliability, config/secrets, cost, incident response, DR/BCP, operational runbooks, architecture governance, and “top 1% engineering behavior”.

---

## Daftar Isi

1. [Orientasi: Production-Ready Bukan “Sudah Bisa Jalan”](#1-orientasi-production-ready-bukan-sudah-bisa-jalan)
2. [Mental Model: Aplikasi Jakarta EE sebagai Socio-Technical System](#2-mental-model-aplikasi-jakarta-ee-sebagai-socio-technical-system)
3. [Top 1% Engineering Bar](#3-top-1-engineering-bar)
4. [Production Readiness Pillars](#4-production-readiness-pillars)
5. [Service Level: SLA, SLO, SLI, Error Budget](#5-service-level-sla-slo-sli-error-budget)
6. [Reliability Architecture](#6-reliability-architecture)
7. [Health, Readiness, Liveness, Startup](#7-health-readiness-liveness-startup)
8. [Graceful Startup dan Graceful Shutdown](#8-graceful-startup-dan-graceful-shutdown)
9. [Deployment Safety: Rolling, Canary, Blue-Green, Feature Flags](#9-deployment-safety-rolling-canary-blue-green-feature-flags)
10. [Rollback, Rollforward, dan Compatibility](#10-rollback-rollforward-dan-compatibility)
11. [Configuration & Secret Readiness](#11-configuration--secret-readiness)
12. [Observability Strategy](#12-observability-strategy)
13. [Logs: Structured, Correlated, Redacted](#13-logs-structured-correlated-redacted)
14. [Metrics: RED, USE, Business Metrics](#14-metrics-red-use-business-metrics)
15. [Tracing: Distributed Causality dan Boundary Instrumentation](#15-tracing-distributed-causality-dan-boundary-instrumentation)
16. [OpenTelemetry Strategy](#16-opentelemetry-strategy)
17. [Dashboards dan Alerting](#17-dashboards-dan-alerting)
18. [Runbooks dan Incident Response](#18-runbooks-dan-incident-response)
19. [Security Readiness](#19-security-readiness)
20. [Authentication, Authorization, and Identity Boundary](#20-authentication-authorization-and-identity-boundary)
21. [Secrets, Key Rotation, Certificates, TLS/mTLS](#21-secrets-key-rotation-certificates-tlsmtls)
22. [Input Validation, Output Encoding, and API Security](#22-input-validation-output-encoding-and-api-security)
23. [Dependency, SBOM, CVE, Container Scan](#23-dependency-sbom-cve-container-scan)
24. [Runtime Hardening](#24-runtime-hardening)
25. [Data Protection, Privacy, Audit, and Retention](#25-data-protection-privacy-audit-and-retention)
26. [Performance Readiness](#26-performance-readiness)
27. [JVM, GC, Memory, Threading, Virtual Threads](#27-jvm-gc-memory-threading-virtual-threads)
28. [Database Pool, Transaction, and Query Readiness](#28-database-pool-transaction-and-query-readiness)
29. [REST/HTTP/API Performance](#29-resthttpapi-performance)
30. [Messaging Backpressure and DLQ Readiness](#30-messaging-backpressure-and-dlq-readiness)
31. [Batch Readiness](#31-batch-readiness)
32. [Mail, SOAP, XML, File Exchange Readiness](#32-mail-soap-xml-file-exchange-readiness)
33. [Cost and Capacity Engineering](#33-cost-and-capacity-engineering)
34. [Resilience Patterns: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency](#34-resilience-patterns-timeout-retry-circuit-breaker-bulkhead-idempotency)
35. [Data Consistency: XA vs Outbox vs Saga](#35-data-consistency-xa-vs-outbox-vs-saga)
36. [Testing Pyramid for Jakarta EE Production](#36-testing-pyramid-for-jakarta-ee-production)
37. [Load, Stress, Soak, Chaos, and Failure Injection](#37-load-stress-soak-chaos-and-failure-injection)
38. [Operational Governance](#38-operational-governance)
39. [Architecture Governance and ADRs](#39-architecture-governance-and-adrs)
40. [Team Practices: PR Review, Quality Gates, Ownership](#40-team-practices-pr-review-quality-gates-ownership)
41. [Legacy Sustainability and Modernization Roadmap](#41-legacy-sustainability-and-modernization-roadmap)
42. [Production Readiness Review Template](#42-production-readiness-review-template)
43. [Top 1% Checklist](#43-top-1-checklist)
44. [Case Study 1: REST + JPA Service Production Readiness](#44-case-study-1-rest--jpa-service-production-readiness)
45. [Case Study 2: Messaging Consumer dengan Backpressure dan Idempotency](#45-case-study-2-messaging-consumer-dengan-backpressure-dan-idempotency)
46. [Case Study 3: Batch Job Gagal di Tengah File Besar](#46-case-study-3-batch-job-gagal-di-tengah-file-besar)
47. [Case Study 4: Jakarta EE Runtime Upgrade Tanpa Observability](#47-case-study-4-jakarta-ee-runtime-upgrade-tanpa-observability)
48. [Latihan Bertahap](#48-latihan-bertahap)
49. [Capstone Project: Jakarta EE Production-Ready Reference System](#49-capstone-project-jakarta-ee-production-ready-reference-system)
50. [Referensi Resmi](#50-referensi-resmi)

---

# 1. Orientasi: Production-Ready Bukan “Sudah Bisa Jalan”

Aplikasi yang “jalan di laptop” belum tentu siap production.

Aplikasi production-ready harus bisa:

- menerima traffic nyata;
- bertahan saat dependency lambat/gagal;
- restart tanpa korupsi data;
- di-debug saat incident;
- diobservasi tanpa membuka payload sensitif;
- di-scale tanpa memecahkan database;
- di-upgrade tanpa downtime besar;
- rollback/rollforward dengan aman;
- menjaga security posture;
- memenuhi compliance;
- menjaga cost;
- dipahami engineer baru.

## 1.1 Jakarta EE memberi banyak fondasi

Jakarta EE menyediakan standar:

- dependency injection;
- REST;
- persistence;
- validation;
- transactions;
- security;
- concurrency;
- messaging;
- batch;
- servlet;
- JSON;
- WebSocket;
- Faces;
- mail;
- connectors.

Namun platform tidak otomatis membuat aplikasimu reliable.

## 1.2 Production readiness adalah desain eksplisit

Misalnya, Jakarta Transactions menyediakan transaction API.

Tapi kamu masih harus menentukan:

- transaction boundary;
- retry behavior;
- idempotency;
- timeout;
- deadlock handling;
- long-running process strategy;
- failure recovery.

## 1.3 Production readiness bukan dokumen checklist mati

Ia adalah capability.

Tanda capability:

```text
Saat incident terjadi, tim tahu apa yang sedang rusak, dampaknya apa,
apa yang harus dilakukan, dan bagaimana mencegahnya terjadi lagi.
```

## 1.4 Prinsip utama

```text
Production-ready software is observable, recoverable, secure, scalable enough,
and understandable by the team that owns it.
```

---

# 2. Mental Model: Aplikasi Jakarta EE sebagai Socio-Technical System

Aplikasi Jakarta EE bukan hanya kode.

Ia terdiri dari:

```text
source code
  + runtime
  + database
  + broker
  + configuration
  + secrets
  + deployment platform
  + observability pipeline
  + CI/CD
  + security controls
  + team process
  + incident response
  + business constraints
```

## 2.1 Technical system

- APIs;
- runtime;
- threads;
- connection pools;
- transactions;
- serialization;
- messages;
- batch jobs;
- caches;
- logs/metrics/traces.

## 2.2 Social system

- ownership;
- on-call;
- review practice;
- standards;
- runbooks;
- knowledge sharing;
- release governance;
- postmortems;
- architecture decision records.

## 2.3 Why socio-technical matters

Bad code can be saved by good operations temporarily.

Good code can still fail if:

- no one owns alerts;
- config unknown;
- rollback untested;
- dependency undocumented;
- logs useless;
- secrets expired silently.

## 2.4 Top engineer behavior

Top engineer asks:

```text
Who will operate this?
How will they know it is broken?
How will they fix it at 3 AM?
How will the next engineer understand it?
```

---

# 3. Top 1% Engineering Bar

“Top 1%” bukan berarti hafal semua API.

It means consistently designing systems that are:

- correct;
- maintainable;
- observable;
- resilient;
- secure;
- cost-aware;
- migration-friendly;
- understandable;
- measurable.

## 3.1 Top 1% does not mean over-engineering

Top engineer tahu kapan cukup simple.

Example:

- tidak perlu XA kalau outbox cukup;
- tidak perlu Full Platform kalau Web Profile cukup;
- tidak perlu custom framework kalau CDI cukup;
- tidak perlu dynamic config service untuk config statis;
- tidak perlu distributed tracing custom kalau OpenTelemetry agent cukup.

## 3.2 Top 1% knows trade-offs

Setiap keputusan punya cost.

```text
More abstraction → flexibility + complexity
More portability → less vendor optimization
More consistency → less immediate convenience
More resilience → more state/retry/idempotency complexity
```

## 3.3 Top 1% makes invisible risks visible

- hidden dependency;
- missing timeout;
- no DLQ;
- transaction too wide;
- unbounded queue;
- missing metric;
- insecure XML parser;
- wrong lifecycle;
- classpath conflict;
- config update behavior.

## 3.4 Top 1% writes runbooks

Because production excellence is transferable knowledge.

---

# 4. Production Readiness Pillars

Use these pillars.

## 4.1 Correctness

Does the app produce correct business outcome?

## 4.2 Reliability

Does it keep working despite common failures?

## 4.3 Operability

Can humans operate it safely?

## 4.4 Observability

Can we understand internal state from external signals?

## 4.5 Security

Can it resist abuse and protect data?

## 4.6 Performance

Can it meet latency/throughput/resource targets?

## 4.7 Scalability

Can it grow within expected demand?

## 4.8 Maintainability

Can engineers modify it safely?

## 4.9 Portability

Can it move runtime/cloud/vendor if needed?

## 4.10 Cost efficiency

Does it meet goals without wasting resources?

## 4.11 Compliance

Does it satisfy audit/regulatory needs?

## 4.12 Evolvability

Can it be upgraded/migrated without trauma?

---

# 5. Service Level: SLA, SLO, SLI, Error Budget

Production readiness should be tied to service levels.

## 5.1 SLA

Service Level Agreement.

External/business/legal commitment.

Example:

```text
99.9% monthly availability
```

## 5.2 SLO

Service Level Objective.

Internal target.

Example:

```text
99.95% successful checkout requests per rolling 30 days
```

## 5.3 SLI

Service Level Indicator.

Measured signal.

Examples:

- successful request ratio;
- P95 latency;
- job completion rate;
- message processing delay;
- error rate.

## 5.4 Error budget

Allowed unreliability.

```text
If SLO is 99.9%, error budget is 0.1%.
```

## 5.5 Why Jakarta engineer should care

Without SLO:

- performance tuning is subjective;
- alerting is noisy;
- reliability investment unclear;
- release risk not measurable.

## 5.6 Example SLOs

REST service:

```text
99.9% of requests return non-5xx within 500ms over 30 days.
```

Batch job:

```text
99% of daily jobs complete before 06:00 local time.
```

Messaging consumer:

```text
99% of messages processed within 2 minutes.
```

SOAP/file integration:

```text
99.5% partner files processed within 30 minutes of receipt.
```

## 5.7 SLO-driven engineering

Design readiness based on SLO, not vague “best practice”.

---

# 6. Reliability Architecture

Reliability starts with assumptions.

## 6.1 Assume dependencies fail

- DB slow;
- broker unavailable;
- SMTP timeout;
- IdP down;
- partner API returns 500;
- DNS stale;
- node killed;
- pod restarted;
- config missing;
- certificate expired.

## 6.2 Design boundaries

For each external call define:

- timeout;
- retry;
- circuit breaker;
- fallback;
- idempotency;
- error classification;
- metric;
- log context;
- trace span.

## 6.3 Avoid unbounded work

Bad:

```text
unbounded thread creation
unbounded queue
unbounded memory buffer
unbounded retry
unbounded result set
```

## 6.4 Backpressure

If downstream slow, upstream must slow/reject/queue predictably.

## 6.5 Fail fast for misconfiguration

If required config invalid, fail startup.

## 6.6 Degrade gracefully

If non-critical dependency fails, app may still serve partial functionality.

## 6.7 Reliability rule

```text
Every boundary needs a failure policy.
```

---

# 7. Health, Readiness, Liveness, Startup

Kubernetes supports liveness, readiness, and startup probes.

## 7.1 Liveness

Answers:

```text
Should this process be restarted?
```

It should not fail just because DB is temporarily down unless process is unrecoverable.

## 7.2 Readiness

Answers:

```text
Should this instance receive traffic?
```

It should fail if app cannot serve requests safely.

Examples:

- DB unavailable for critical API;
- migrations not done;
- cache warming incomplete if required;
- message consumer not ready;
- app initialization incomplete.

## 7.3 Startup probe

Answers:

```text
Has this app finished slow startup?
```

Useful for slow Jakarta runtimes/apps so liveness does not kill startup prematurely.

## 7.4 Common mistake

Liveness checks DB.

If DB fails, Kubernetes restarts all pods, worsening outage.

## 7.5 Jakarta EE implementation

If runtime supports MicroProfile Health, use it.

Otherwise implement health endpoints carefully.

## 7.6 Probe design

Example:

```text
/livez
  cheap process health

/readyz
  app readiness + critical dependencies

/startupz
  startup completion
```

## 7.7 Probe must be cheap

Do not make heavy DB query every second.

Use lightweight validation/cache.

---

# 8. Graceful Startup dan Graceful Shutdown

## 8.1 Startup phases

```text
process start
  ↓ runtime boot
  ↓ app deploy
  ↓ CDI init
  ↓ resource init
  ↓ migration check
  ↓ readiness true
```

## 8.2 Do not accept traffic too early

Readiness should be false until app truly ready.

## 8.3 Shutdown phases

```text
SIGTERM
  ↓ readiness false
  ↓ stop accepting new requests
  ↓ drain in-flight requests
  ↓ stop consumers/schedulers
  ↓ flush telemetry/logs
  ↓ close resources
  ↓ exit before grace period
```

## 8.4 Messaging consumers

On shutdown:

- stop polling/consuming;
- finish or safely abort current message;
- commit/rollback correctly;
- avoid duplicate side effect without idempotency.

## 8.5 Batch jobs

Do not kill without checkpoint/restart semantics.

## 8.6 HTTP requests

Let in-flight requests complete within timeout.

## 8.7 Kubernetes termination

Set terminationGracePeriodSeconds based on real shutdown needs.

## 8.8 Test shutdown

Kill pod during:

- request;
- DB transaction;
- message processing;
- batch job;
- file processing.

---

# 9. Deployment Safety: Rolling, Canary, Blue-Green, Feature Flags

## 9.1 Rolling deploy

Replaces instances gradually.

Requires compatibility across versions.

## 9.2 Canary

Small traffic percentage to new version.

Observe metrics.

## 9.3 Blue-green

Two environments.

Switch traffic.

Good for fast rollback.

## 9.4 Feature flags

Decouple deploy from release.

Useful for risky features.

## 9.5 Flag governance

Feature flags need:

- owner;
- expiry date;
- default;
- kill switch;
- audit.

## 9.6 Jakarta EE considerations

- session compatibility;
- CDI/JPA entity compatibility;
- DB schema compatibility;
- message compatibility;
- API compatibility;
- generated JSON/XML compatibility.

## 9.7 Deployment gate

Before traffic increase, verify:

- error rate;
- latency;
- CPU/memory;
- DB pool;
- logs;
- business metrics;
- security events.

## 9.8 Rule

```text
Deployments should be reversible or safely forward-fixable.
```

---

# 10. Rollback, Rollforward, dan Compatibility

## 10.1 Rollback

Return to previous artifact/config.

## 10.2 Rollforward

Fix forward with new version.

Often safer when DB schema migrated forward.

## 10.3 Compatibility window

During rolling deploy:

```text
old app + new app + old DB schema/new DB schema maybe coexist
```

## 10.4 Expand-contract DB migration

Safe pattern:

1. add new nullable column/table;
2. deploy app writing both old/new;
3. backfill;
4. switch reads;
5. remove old later.

## 10.5 Message compatibility

Consumers should ignore unknown fields if format allows.

Use schema/versioning.

## 10.6 Session compatibility

Avoid serialized server sessions across incompatible versions.

Prefer stateless or external session strategy.

## 10.7 Rollback checklist

- artifact;
- config;
- DB migration;
- message queues;
- cache;
- feature flags;
- external clients;
- observability.

## 10.8 Test rollback

A rollback plan only matters if tested.

---

# 11. Configuration & Secret Readiness

## 11.1 Typed config

Centralize config in typed classes.

## 11.2 Startup validation

Fail fast on:

- missing required config;
- invalid URL;
- invalid timeout range;
- invalid pool size;
- insecure production default;
- secret placeholder value.

## 11.3 Redaction

Never log secrets.

Avoid `toString()` leaking.

## 11.4 Config provenance

Know source:

- default;
- file;
- env;
- secret;
- runtime config;
- system property.

## 11.5 Dynamic vs static

Document whether config change requires restart.

## 11.6 Secret rotation

Plan for:

- DB password;
- API token;
- OAuth client secret;
- TLS cert;
- signing key.

## 11.7 Kubernetes caveat

Env vars from ConfigMap/Secret do not update running process.

## 11.8 Operational rule

Every production config must have owner and audit trail.

---

# 12. Observability Strategy

Observability is the ability to understand system behavior from outputs.

Core signals:

- logs;
- metrics;
- traces;
- events;
- profiles;
- health.

## 12.1 Boundary-first instrumentation

Instrument every boundary:

- REST request;
- DB query/transaction;
- external HTTP/SOAP;
- message consume/publish;
- batch step;
- file import/export;
- mail send;
- cache call;
- authentication flow.

## 12.2 Correlation ID

Every request/job/message should have correlation ID.

## 12.3 Trace context

Propagate trace context across services and messages where possible.

## 12.4 Cardinality control

Avoid high-cardinality labels:

Bad:

```text
metric{userId="123456"}
```

Good:

```text
metric{operation="submitApplication", status="success"}
```

## 12.5 Redaction

Observability must not leak secrets/PII.

## 12.6 Sampling

Trace sampling may be needed.

Always capture errors if possible.

## 12.7 Ownership

Dashboards/alerts need owners.

---

# 13. Logs: Structured, Correlated, Redacted

## 13.1 Structured logs

Use JSON or consistent key-value format.

Fields:

```text
timestamp
level
service
version
environment
traceId
spanId
correlationId
operation
userId/tenantId when safe
status
durationMs
errorType
message
```

## 13.2 Avoid prose-only logs

Bad:

```text
Something went wrong
```

Good:

```text
operation=submitApplication status=failed errorType=ValidationError applicationId=...
```

## 13.3 Log levels

- ERROR: action required or request failed unexpectedly.
- WARN: abnormal but handled.
- INFO: lifecycle/business milestone.
- DEBUG: diagnostic detail.
- TRACE: very detailed, usually off.

## 13.4 Redaction

Never log:

- password;
- token;
- full authorization header;
- private key;
- full PII documents;
- raw SOAP/XML/JSON with sensitive data.

## 13.5 Exception logging

Log stack trace once at boundary.

Avoid duplicate logs at every layer.

## 13.6 Audit logs

Separate audit logs from application debug logs.

## 13.7 Log volume

High log volume increases cost and hides signal.

---

# 14. Metrics: RED, USE, Business Metrics

## 14.1 RED for services

- Rate;
- Errors;
- Duration.

For REST:

```text
http_requests_total
http_request_duration_seconds
http_requests_errors_total
```

## 14.2 USE for resources

- Utilization;
- Saturation;
- Errors.

For DB pool:

- active connections;
- max connections;
- wait queue;
- timeout count.

## 14.3 JVM metrics

- heap/non-heap;
- GC pauses;
- thread count;
- classloading;
- CPU;
- allocation rate.

## 14.4 Jakarta-specific metrics

Track:

- datasource pool;
- transaction count/rollback;
- JPA query latency;
- JMS consumer lag/DLQ;
- batch job duration/failure;
- mail send failures;
- REST endpoint latency.

## 14.5 Business metrics

Examples:

- applications submitted;
- payment success;
- approval rate;
- file import count;
- failed validation count.

## 14.6 Alert on symptoms

Prefer user-impacting alerts:

- elevated 5xx;
- high latency;
- job missed SLA;
- queue lag too high.

Avoid alerting on every internal detail.

## 14.7 SLO dashboards

Dashboards should show SLO burn, not just CPU.

---

# 15. Tracing: Distributed Causality dan Boundary Instrumentation

Tracing shows request path.

## 15.1 Trace

Entire request journey.

## 15.2 Span

One operation within trace.

Examples:

- HTTP inbound;
- DB query;
- REST client call;
- JMS publish;
- batch step;
- XML validation.

## 15.3 Why tracing matters

Logs tell events.

Metrics tell aggregates.

Traces tell causality.

## 15.4 Instrument Jakarta boundaries

- Servlet/JAX-RS;
- CDI service methods if useful;
- JPA/JDBC;
- external HTTP/SOAP;
- messaging;
- batch;
- file processing.

## 15.5 Async tracing

Propagate context across:

- message headers;
- batch job parameters;
- scheduled tasks;
- managed executors.

## 15.6 Avoid over-instrumentation

Too many spans become noise.

Instrument meaningful boundaries.

## 15.7 Sampling strategy

Sample normal traffic.

Always retain errors/high latency if possible.

---

# 16. OpenTelemetry Strategy

OpenTelemetry is a vendor-neutral observability framework for generating, collecting, and exporting telemetry data such as traces, metrics, and logs.

## 16.1 Why use it?

- vendor neutral;
- supported by many tools;
- Java agent support;
- SDK/manual instrumentation;
- collector pipeline;
- standard semantic conventions.

## 16.2 Auto-instrumentation

Java agent can instrument many libraries without code changes.

Good first step.

## 16.3 Manual instrumentation

Add spans/attributes for domain boundaries:

- batch job name;
- message type;
- partner name;
- file ID;
- business operation.

## 16.4 Collector

OpenTelemetry Collector can receive/process/export telemetry.

Use it to:

- filter;
- redact;
- batch;
- route;
- export to backend.

## 16.5 Semantic attributes

Use consistent names for:

- service name;
- environment;
- version;
- operation;
- partner;
- outcome.

## 16.6 Jakarta runtimes

Support varies.

Use Java agent + runtime-specific instrumentation + manual code where needed.

## 16.7 Governance

Instrumentation should be consistent across services.

---

# 17. Dashboards dan Alerting

## 17.1 Dashboard layers

1. Executive/business SLO dashboard.
2. Service health dashboard.
3. Dependency dashboard.
4. JVM/runtime dashboard.
5. Database/broker dashboard.
6. Batch/job dashboard.
7. Security/audit dashboard.

## 17.2 Alert principles

Alert must be:

- actionable;
- owned;
- tied to user impact or imminent risk;
- documented with runbook;
- not noisy.

## 17.3 Good alerts

- SLO burn rate high;
- P95 latency above threshold;
- 5xx error rate elevated;
- queue lag beyond SLA;
- batch job missed deadline;
- DB pool wait timeout;
- certificate expires soon.

## 17.4 Bad alerts

- CPU > 80% for 1 minute with no user impact;
- every exception class;
- every warning log;
- transient single failure.

## 17.5 Runbook link

Every alert should link to runbook.

## 17.6 Alert fatigue

Noisy alerts train team to ignore production.

## 17.7 Review alerts

Post-incident and monthly.

---

# 18. Runbooks dan Incident Response

## 18.1 Runbook contents

For each critical alert:

- symptom;
- severity;
- dashboard link;
- queries;
- likely causes;
- immediate mitigation;
- rollback steps;
- escalation;
- owner;
- validation after fix.

## 18.2 Incident roles

- incident commander;
- communications lead;
- operations lead;
- subject matter experts.

## 18.3 During incident

- stabilize;
- communicate;
- preserve evidence;
- avoid speculative fixes;
- track timeline.

## 18.4 After incident

Blameless postmortem:

- what happened;
- impact;
- detection;
- response;
- root causes;
- contributing factors;
- action items;
- owners/dates.

## 18.5 Jakarta-specific runbooks

Examples:

- DB pool exhausted;
- JPA deadlock;
- JMS DLQ spike;
- batch restart;
- OIDC login failure;
- memory leak;
- classloading conflict;
- certificate expiry;
- SOAP partner failure.

## 18.6 Top engineer behavior

Writes runbooks before incident.

---

# 19. Security Readiness

Security readiness is not a final scan.

It is design.

## 19.1 Threat model

Identify:

- assets;
- actors;
- trust boundaries;
- attack paths;
- mitigations.

## 19.2 Secure defaults

- deny by default;
- least privilege;
- secure cookies;
- TLS;
- no debug endpoints public;
- no default passwords.

## 19.3 Defense in depth

- input validation;
- authn/authz;
- output encoding;
- rate limiting;
- audit logging;
- network policy;
- dependency scanning.

## 19.4 Security testing

- SAST;
- dependency scan;
- container scan;
- DAST;
- penetration testing;
- secrets scan;
- IaC scan.

## 19.5 Security ownership

Each service has security owner/contact.

## 19.6 Runtime security

Harden server and image.

## 19.7 Supply chain

SBOM and provenance.

---

# 20. Authentication, Authorization, and Identity Boundary

## 20.1 Authentication

Who are you?

Options:

- OIDC;
- SAML;
- mTLS;
- API key;
- service account;
- legacy LDAP/container realm.

## 20.2 Authorization

What are you allowed to do?

Levels:

- endpoint;
- method;
- domain action;
- data row/tenant;
- field-level;
- admin operation.

## 20.3 Role mapping

External IdP groups/claims map to app roles/permissions.

## 20.4 Tenant boundary

Never trust tenant ID from request without validation.

## 20.5 Service-to-service

Use:

- mTLS;
- signed JWT;
- workload identity;
- service account.

## 20.6 Audit

Record security decisions:

- login;
- logout;
- failed auth;
- admin action;
- permission denied;
- sensitive data access.

## 20.7 Jakarta Security

Use where it fits.

Runtime/OIDC integration may be vendor/framework-specific.

---

# 21. Secrets, Key Rotation, Certificates, TLS/mTLS

## 21.1 Secrets

Examples:

- DB password;
- API token;
- OAuth client secret;
- private key;
- encryption key;
- SMTP password.

## 21.2 Secret rules

- never commit;
- never bake into image;
- never log;
- rotate;
- limit access;
- audit access.

## 21.3 Certificates

Monitor expiry.

Have rotation runbook.

## 21.4 TLS

Use strong protocols/ciphers.

Terminate at ingress or app depending requirement.

## 21.5 mTLS

For high-trust service-to-service/partner communication.

## 21.6 Key rotation

Plan for old/new keys overlap.

## 21.7 Crypto

Do not invent crypto.

Use proven libraries and platform services.

## 21.8 Emergency

Have procedure to revoke/rotate leaked secret.

---

# 22. Input Validation, Output Encoding, and API Security

## 22.1 Validation

Use Jakarta Validation on DTOs.

But business validation belongs in service/domain.

## 22.2 Output encoding

For HTML/JSP/Faces:

- use proper escaping;
- avoid raw user HTML;
- CSP where possible.

## 22.3 JSON/XML

Do not trust deserialized objects.

Validate.

## 22.4 File uploads

- size limit;
- content type allowlist;
- malware scan;
- storage isolation;
- no path traversal.

## 22.5 XML

Disable XXE/external entities for untrusted XML.

## 22.6 Rate limiting

Protect expensive endpoints.

## 22.7 API abuse

Add:

- pagination limits;
- query complexity limits;
- idempotency keys;
- CSRF for browser session apps;
- CORS correctly.

## 22.8 Error response

Do not leak stack traces.

Use stable error codes.

---

# 23. Dependency, SBOM, CVE, Container Scan

## 23.1 Dependency governance

Use:

- dependency lock/constraints;
- Maven Enforcer;
- Gradle versions catalog;
- Dependabot/Renovate;
- vulnerability scanning.

## 23.2 SBOM

Software Bill of Materials records dependencies.

Useful for vulnerability response.

## 23.3 Container scan

Scan base image and app layers.

## 23.4 License compliance

Track licenses.

## 23.5 Patch policy

Define severity SLA:

```text
Critical CVE: patch within X days
High CVE: patch within Y days
```

## 23.6 Runtime provided dependencies

App server dependencies also need tracking.

## 23.7 Classpath hygiene

Avoid duplicate/old APIs.

## 23.8 Supply chain

Prefer trusted repositories and pinned versions.

---

# 24. Runtime Hardening

## 24.1 Minimize features

Enable only needed Jakarta runtime features.

## 24.2 Remove defaults

Disable sample apps/admin consoles if not needed.

## 24.3 Admin interface

Private network only.

Strong auth.

Audit.

## 24.4 File permissions

Run as non-root.

Read-only filesystem where possible.

## 24.5 Network

Least privilege egress/ingress.

## 24.6 JVM flags

Use safe defaults.

Avoid enabling remote debug in production.

## 24.7 Error pages

No stack traces to users.

## 24.8 Headers

Security headers for web apps.

## 24.9 Patch runtime

Patch app server/base image.

## 24.10 Configuration drift

Detect drift between desired and actual.

---

# 25. Data Protection, Privacy, Audit, and Retention

## 25.1 Data classification

Classify:

- public;
- internal;
- confidential;
- restricted;
- PII;
- secret.

## 25.2 Data minimization

Store only what needed.

## 25.3 Encryption

- in transit;
- at rest;
- field-level where needed.

## 25.4 Audit

Audit sensitive operations.

## 25.5 Retention

Define data retention and deletion policy.

## 25.6 Logs

Logs may contain PII.

Apply retention and redaction.

## 25.7 Access controls

Limit who can access data/logs/backups.

## 25.8 Backups

Encrypted, tested restores.

## 25.9 Compliance

Map controls to regulation/business requirements.

---

# 26. Performance Readiness

## 26.1 Know bottlenecks

Common bottlenecks:

- database;
- connection pool;
- external API;
- serialization;
- GC;
- locks;
- thread pool;
- message broker;
- large payload;
- filesystem/object storage.

## 26.2 Performance budget

Define target:

```text
P95 latency < 300ms
throughput 500 rps
startup < 30s
heap < 512MB
batch completes < 1h
```

## 26.3 Test realistic workload

Synthetic happy path is insufficient.

## 26.4 Monitor saturation

- CPU;
- memory;
- DB pool;
- thread pool;
- queue length;
- broker lag;
- disk IO;
- network.

## 26.5 Tune after measuring

Do not cargo-cult JVM flags.

## 26.6 Regression guard

Add performance benchmarks in release process for critical paths.

---

# 27. JVM, GC, Memory, Threading, Virtual Threads

## 27.1 JVM baseline

Use supported Java version and runtime.

Jakarta EE 11 supports Java 17+, with Java 21 benefits.

## 27.2 GC

Choose based on workload:

- G1 default is often good.
- ZGC/Shenandoah for low pause.
- Parallel for throughput in some cases.

Benchmark.

## 27.3 Heap sizing

In containers, set memory carefully.

Watch native memory too.

## 27.4 Thread pools

Managed executors, servlet container pools, DB pool, HTTP client pool.

Tune together.

## 27.5 Virtual threads

Virtual threads can improve concurrency for blocking workloads.

But they do not remove:

- DB pool limit;
- external service limit;
- transaction contention;
- CPU bottleneck.

## 27.6 Pinning/blocking

Some synchronized/native/blocking operations can reduce virtual thread benefits.

## 27.7 Use managed mechanisms

In Jakarta EE, avoid unmanaged thread creation.

Use runtime-supported concurrency.

## 27.8 Metrics

Track:

- live threads;
- queued tasks;
- rejected tasks;
- pool saturation;
- virtual thread behavior if supported.

---

# 28. Database Pool, Transaction, and Query Readiness

## 28.1 Pool sizing

Pool size must match:

- DB capacity;
- app concurrency;
- request latency;
- transaction duration;
- workload.

More connections are not always better.

## 28.2 Timeouts

Set:

- connection acquisition timeout;
- query timeout;
- transaction timeout;
- lock timeout.

## 28.3 Transaction boundary

Keep transactions short.

Avoid remote calls inside transaction.

## 28.4 N+1

Detect with tests/logging/profiling.

## 28.5 Pagination

Never load unbounded result sets.

## 28.6 Migration

DB schema migration strategy.

## 28.7 Deadlocks

Handle retry for safe transactions.

## 28.8 Observability

Metrics:

- active connections;
- wait time;
- timeouts;
- slow queries;
- rollback count;
- deadlocks.

## 28.9 JPA entity exposure

Do not expose entities directly through REST/JSON.

---

# 29. REST/HTTP/API Performance

## 29.1 Payload size

Limit request/response size.

Compress where useful.

## 29.2 Pagination

Required for collections.

## 29.3 Caching

Use HTTP cache headers where appropriate.

## 29.4 Serialization

JSON-B/Jackson provider behavior matters.

Avoid huge object graphs.

## 29.5 Timeout

Server and client timeouts.

## 29.6 Rate limits

Protect expensive endpoints.

## 29.7 Idempotency

Use idempotency key for unsafe operations that may be retried.

## 29.8 API metrics

Per endpoint:

- rate;
- latency;
- error;
- payload size;
- status code.

## 29.9 Error format

Stable error codes improve client behavior.

---

# 30. Messaging Backpressure and DLQ Readiness

## 30.1 Consumer design

Every consumer needs:

- idempotency;
- retry policy;
- DLQ;
- poison message handling;
- ordering strategy;
- concurrency limit;
- observability.

## 30.2 Backpressure

If processing slower than arrival, queue grows.

Need:

- scaling;
- throttling;
- partitioning;
- load shedding;
- batch processing;
- DLQ for poison messages.

## 30.3 Retry

Avoid infinite immediate retry.

Use backoff and max attempts.

## 30.4 DLQ

DLQ messages need runbook.

Do not let DLQ become graveyard.

## 30.5 Exactly-once myth

Most systems achieve effectively-once via idempotency.

## 30.6 Transaction

DB + message transaction needs careful design.

Outbox often simpler than XA.

## 30.7 Metrics

- consumer lag;
- processing rate;
- failure rate;
- retry count;
- DLQ count;
- processing duration.

---

# 31. Batch Readiness

## 31.1 Batch properties

Batch jobs are:

- long-running;
- stateful;
- restartable;
- data-heavy;
- time-window constrained.

## 31.2 Readiness questions

- checkpoint strategy?
- restart behavior?
- input immutability?
- output idempotency?
- partial failure policy?
- skip/retry limits?
- job repository?
- schedule owner?
- timeout?
- observability?
- rerun process?

## 31.3 Large file

Do not load full file.

Stream/chunk.

## 31.4 Database batch

Use batch writes and transaction chunking.

## 31.5 SLA

Define completion deadline.

## 31.6 Runbook

Batch failure runbook is mandatory.

## 31.7 Metrics

- job duration;
- records processed;
- records failed;
- chunk duration;
- restart count;
- completion status.

---

# 32. Mail, SOAP, XML, File Exchange Readiness

## 32.1 Mail

- SMTP timeout;
- retry/backoff;
- DLQ;
- rate limit;
- bounce handling;
- attachment size;
- DKIM/SPF/DMARC if relevant.

## 32.2 SOAP

- timeout;
- SOAP fault classification;
- WS-Security;
- XML security;
- MTOM streaming;
- golden samples.

## 32.3 XML

- schema validation;
- XXE prevention;
- large XML streaming;
- namespace correctness;
- versioning.

## 32.4 File exchange

- checksum;
- idempotency;
- quarantine;
- replay;
- malware scan;
- retention;
- audit.

## 32.5 External partner

Each partner needs:

- SLA;
- support contact;
- test endpoint;
- certificate rotation plan;
- error code mapping;
- maintenance window.

---

# 33. Cost and Capacity Engineering

## 33.1 Cost drivers

- CPU;
- memory;
- database;
- network egress;
- log volume;
- trace volume;
- metrics cardinality;
- storage;
- broker partitions;
- runtime license/support.

## 33.2 Right-sizing

Measure actual load.

Set resource requests/limits based on data.

## 33.3 Headroom

Maintain capacity headroom.

Example:

```text
normal peak < 60-70% of safe capacity
```

depending criticality.

## 33.4 Autoscaling

Scale based on meaningful metrics:

- CPU for CPU-bound;
- request latency/queue length for service;
- consumer lag for messaging.

## 33.5 Log cost

Over-logging is expensive.

## 33.6 Trace sampling

Control cost.

## 33.7 Runtime footprint

Full platform may cost more than needed.

Use sufficient profile/features.

## 33.8 Cost as engineering signal

Cost regressions are production regressions.

---

# 34. Resilience Patterns: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency

## 34.1 Timeout

Every external call must have timeout.

## 34.2 Retry

Retry only transient errors.

Use backoff/jitter.

## 34.3 Circuit breaker

Stop calling dependency when failing.

Give it time to recover.

## 34.4 Bulkhead

Isolate resources so one dependency doesn't exhaust whole app.

## 34.5 Rate limiter

Protect system from overload.

## 34.6 Idempotency

Make repeated request/message safe.

## 34.7 Fallback

Return cached/partial/degraded response if acceptable.

## 34.8 Failure classification

Define:

- validation;
- business;
- transient;
- permanent;
- auth;
- rate limited;
- timeout.

## 34.9 Pattern interaction

Retry without timeout is dangerous.

Retry without idempotency is dangerous.

Circuit breaker without observability is blind.

---

# 35. Data Consistency: XA vs Outbox vs Saga

## 35.1 XA

Coordinates distributed transaction across resources.

Pros:

- atomicity across XA resources.

Cons:

- complexity;
- performance;
- recovery;
- heuristic failure;
- operational burden.

## 35.2 Outbox

Write domain change and event in same DB transaction.

Separate publisher sends event.

Pros:

- simpler operationally;
- reliable event publishing;
- avoids XA for DB+broker.

## 35.3 Saga

Sequence of local transactions with compensation.

Good for distributed workflows.

## 35.4 Idempotency

Required for outbox/saga consumers.

## 35.5 Decision

Use XA only when:

- resources support it well;
- atomicity requirement is strict;
- team can operate recovery;
- performance acceptable.

Otherwise consider outbox/saga.

## 35.6 Jakarta EE relation

Jakarta Transactions supports JTA/XA, but architecture must decide whether to use it.

---

# 36. Testing Pyramid for Jakarta EE Production

## 36.1 Unit tests

Fast logic tests.

## 36.2 Component tests

CDI/JPA/REST components.

## 36.3 Integration tests

Real DB/broker/runtime when possible.

## 36.4 Contract tests

REST/SOAP/message contracts.

## 36.5 End-to-end tests

Critical flows only.

## 36.6 Security tests

Auth/authz, input validation, dependency scan.

## 36.7 Performance tests

Critical paths.

## 36.8 Chaos/failure tests

Dependency failure, restart, timeout.

## 36.9 Migration tests

Old/new compatibility.

## 36.10 Test strategy rule

The more expensive the failure, the more it deserves automated proof.

---

# 37. Load, Stress, Soak, Chaos, and Failure Injection

## 37.1 Load test

Expected traffic.

## 37.2 Stress test

Beyond expected until break.

Find limit.

## 37.3 Soak test

Long duration.

Find leaks and degradation.

## 37.4 Spike test

Sudden traffic increase.

## 37.5 Chaos test

Kill pods, slow DB, break broker, expire token in controlled env.

## 37.6 Failure injection

Simulate:

- DB timeout;
- partner 500;
- queue poison message;
- disk full;
- DNS failure;
- certificate expiry;
- pod termination.

## 37.7 Safety

Do chaos only with controls.

## 37.8 Learning goal

Know failure mode before production finds it.

---

# 38. Operational Governance

## 38.1 Ownership

Every service has owner.

## 38.2 On-call

If service is critical, define escalation.

## 38.3 Change management

Risk-based change process.

## 38.4 Release notes

Document:

- changes;
- migrations;
- config changes;
- risk;
- rollback.

## 38.5 Dependency governance

Regular upgrades.

## 38.6 Operational review

Periodic review of:

- incidents;
- alerts;
- SLO;
- cost;
- tech debt;
- security findings.

## 38.7 Knowledge base

Keep:

- architecture docs;
- runbooks;
- dashboards;
- ADRs;
- onboarding notes.

## 38.8 Governance goal

Enable safe speed, not bureaucracy.

---

# 39. Architecture Governance and ADRs

## 39.1 ADR topics

- runtime selection;
- profile choice;
- config source;
- transaction strategy;
- outbox vs XA;
- observability stack;
- security model;
- packaging;
- messaging broker;
- database provider.

## 39.2 ADR template

```text
Title
Status
Context
Decision
Consequences
Alternatives
Review date
```

## 39.3 Review triggers

- Java LTS upgrade;
- Jakarta EE upgrade;
- runtime EOL;
- cost spike;
- incident pattern;
- security requirement change;
- scaling change.

## 39.4 Architecture fitness functions

Automated checks:

- no banned dependencies;
- no old `javax` Jakarta APIs;
- config validation exists;
- health endpoint exists;
- critical metrics exist;
- dependency scan gate.

## 39.5 Governance principle

Architecture should be continuously verified, not only discussed.

---

# 40. Team Practices: PR Review, Quality Gates, Ownership

## 40.1 PR review

Review for:

- correctness;
- tests;
- observability;
- security;
- failure handling;
- config;
- performance;
- maintainability.

## 40.2 Quality gates

- unit tests;
- integration tests;
- static analysis;
- dependency scan;
- container scan;
- formatting;
- architecture rules;
- coverage where meaningful.

## 40.3 Definition of Done

Feature is not done until:

- tests pass;
- metrics/logs added;
- errors handled;
- docs/runbook updated if needed;
- security considered;
- config documented;
- rollback considered.

## 40.4 Ownership

Code without owner becomes production risk.

## 40.5 Pairing/mentoring

Spread knowledge.

## 40.6 Blameless learning

Incidents become system improvements.

## 40.7 Engineering culture

Top systems come from consistent practices, not heroics.

---

# 41. Legacy Sustainability and Modernization Roadmap

## 41.1 Legacy is not failure

Legacy means business value survived.

## 41.2 Sustainability

Keep legacy safe:

- tests;
- dependency patching;
- runtime support;
- observability;
- documentation;
- security scans.

## 41.3 Modernization roadmap

Classify:

- leave as-is;
- patch and monitor;
- refactor module;
- replace integration;
- retire feature;
- strangler migration.

## 41.4 Avoid rewrite fantasy

Rewrite only if justified.

## 41.5 Strangler pattern

Put new boundary around old system.

Move capabilities gradually.

## 41.6 Migration debt

Track:

- old `javax`;
- SOAP legacy;
- EJB remote;
- JSP scriptlets;
- vendor lock-in;
- unsupported runtime.

## 41.7 Long-term health

Modernization is continuous.

---

# 42. Production Readiness Review Template

Use this template before go-live.

## 42.1 Service overview

```text
Service:
Owner:
Runtime:
Jakarta EE version/profile:
Java version:
Deployment platform:
Criticality:
SLO:
```

## 42.2 Architecture

```text
Inbound interfaces:
Outbound dependencies:
Database:
Messaging:
Batch:
Files:
Security model:
```

## 42.3 Reliability

```text
Timeouts:
Retries:
Circuit breakers:
Bulkheads:
Idempotency:
Backpressure:
DLQ:
Graceful shutdown:
```

## 42.4 Observability

```text
Logs:
Metrics:
Traces:
Dashboards:
Alerts:
Runbooks:
Correlation ID:
```

## 42.5 Security

```text
AuthN:
AuthZ:
Secrets:
TLS:
Input validation:
Audit:
Dependency scan:
Container scan:
```

## 42.6 Performance

```text
Baseline:
Capacity:
Bottlenecks:
Resource limits:
DB pool:
Load test:
```

## 42.7 Deployment

```text
Strategy:
Rollback:
DB migration:
Feature flags:
Config changes:
Smoke tests:
```

## 42.8 Sign-off

```text
Engineering:
QA:
Security:
Operations:
Product/business:
```

---

# 43. Top 1% Checklist

## 43.1 Code

- [ ] Clear boundaries.
- [ ] No business logic in controllers/views/handlers.
- [ ] DTOs separate from entities.
- [ ] Validation at boundary.
- [ ] Transaction boundaries intentional.
- [ ] External calls isolated.

## 43.2 Reliability

- [ ] Timeout everywhere.
- [ ] Retry only safe.
- [ ] Idempotency for duplicate-prone operations.
- [ ] DLQ for messaging.
- [ ] Batch restartability.
- [ ] Graceful shutdown tested.

## 43.3 Observability

- [ ] Logs structured.
- [ ] Correlation/trace ID.
- [ ] RED/USE metrics.
- [ ] Critical traces.
- [ ] Dashboards.
- [ ] Actionable alerts.
- [ ] Runbooks.

## 43.4 Security

- [ ] Least privilege.
- [ ] Secrets managed.
- [ ] Dependency scan.
- [ ] Container scan.
- [ ] Input validation.
- [ ] Output encoding.
- [ ] Audit logs.
- [ ] Secure XML parser if XML used.

## 43.5 Performance

- [ ] Baseline known.
- [ ] Load test.
- [ ] DB pool tuned.
- [ ] GC/memory monitored.
- [ ] Queue backpressure.
- [ ] Large payload strategy.

## 43.6 Deployment

- [ ] Immutable artifact.
- [ ] Config externalized.
- [ ] Startup validation.
- [ ] Readiness/liveness/startup probes.
- [ ] Rollback plan.
- [ ] Canary/blue-green if critical.

## 43.7 Governance

- [ ] ADRs.
- [ ] Ownership.
- [ ] Review gates.
- [ ] Dependency policy.
- [ ] Incident postmortems.
- [ ] Modernization roadmap.

---

# 44. Case Study 1: REST + JPA Service Production Readiness

## 44.1 Context

Jakarta REST + CDI + JPA service.

## 44.2 Risks

- DB pool exhaustion;
- N+1 query;
- no timeout to external API;
- no readiness;
- entities exposed as JSON;
- no correlation ID.

## 44.3 Readiness work

- DTO boundary;
- validation;
- transaction boundary;
- DB pool metrics;
- slow query logging;
- pagination;
- external client timeout;
- readiness checks;
- structured logs/traces;
- load test.

## 44.4 Result

Service becomes measurable and operable.

## 44.5 Lesson

REST service readiness is mostly boundary discipline.

---

# 45. Case Study 2: Messaging Consumer dengan Backpressure dan Idempotency

## 45.1 Context

Jakarta Messaging consumer processes payment events.

## 45.2 Risks

- duplicate messages;
- poison message;
- DB deadlock;
- downstream timeout;
- infinite retry;
- DLQ ignored.

## 45.3 Readiness work

- idempotency key;
- transactional update;
- retry with backoff;
- DLQ;
- consumer concurrency limit;
- metrics: lag, failure, retry, DLQ;
- runbook for replay.

## 45.4 Lesson

Messaging reliability depends on duplicate handling and failure policy.

---

# 46. Case Study 3: Batch Job Gagal di Tengah File Besar

## 46.1 Context

Nightly Jakarta Batch imports 10GB XML/CSV file.

## 46.2 Risks

- OOM;
- partial import;
- no checkpoint;
- rerun duplicates;
- bad record stops whole job;
- missed SLA.

## 46.3 Readiness work

- chunk processing;
- checkpoint;
- idempotent record key;
- skip/retry policy;
- quarantine bad records;
- job metrics;
- restart runbook;
- completion SLA alert.

## 46.4 Lesson

Batch is production workflow, not background script.

---

# 47. Case Study 4: Jakarta EE Runtime Upgrade Tanpa Observability

## 47.1 Context

Team upgrades runtime and Java version.

Compile and smoke tests pass.

Production sees latency spike.

## 47.2 Problem

No baseline metrics.

No DB pool metrics.

No traces.

No GC dashboard.

## 47.3 Recovery

Add observability after incident.

Find JPA provider SQL change causing worse query plan.

## 47.4 Prevention

Before upgrade:

- baseline performance;
- critical dashboards;
- slow query tracking;
- canary;
- rollback plan.

## 47.5 Lesson

Migration without observability is flying blind.

---

# 48. Latihan Bertahap

## Latihan 1 — SLO

Define SLO for one REST endpoint, one batch job, one messaging consumer.

## Latihan 2 — Boundary map

Draw all inbound/outbound dependencies.

## Latihan 3 — Timeout audit

Find every external call and define timeout.

## Latihan 4 — Metrics plan

Create RED/USE/business metrics list.

## Latihan 5 — Log schema

Define structured log fields.

## Latihan 6 — Probe design

Design liveness/readiness/startup endpoints.

## Latihan 7 — Incident runbook

Write runbook for DB pool exhaustion.

## Latihan 8 — Load test

Build k6/JMeter/Gatling scenario for critical flow.

## Latihan 9 — Security checklist

Run dependency/container/secrets scan.

## Latihan 10 — PRR

Run Production Readiness Review using template.

---

# 49. Capstone Project: Jakarta EE Production-Ready Reference System

## 49.1 Goal

Build a reference system:

```text
jakarta-ee-production-reference/
```

## 49.2 Features

- REST API;
- CDI service layer;
- JPA persistence;
- Jakarta Validation;
- Jakarta Transactions;
- Messaging/outbox;
- Batch job;
- Mail notification;
- typed config;
- OpenTelemetry instrumentation;
- structured logging;
- health probes;
- Docker/Kubernetes deployment;
- security/auth simulation;
- load tests;
- runbooks.

## 49.3 Structure

```text
docs/
  architecture.md
  production-readiness.md
  slo.md
  observability.md
  security.md
  runbooks/
src/
  main/
  test/
deploy/
  docker/
  kubernetes/
load-test/
scripts/
```

## 49.4 Required docs

- ADR runtime selection;
- dependency policy;
- config reference;
- failure mode analysis;
- rollback plan;
- incident runbook;
- performance baseline.

## 49.5 Evaluation

System is complete only if:

- app boots;
- tests pass;
- health works;
- metrics/logs/traces visible;
- DB failure behavior known;
- message duplicate handled;
- batch restart works;
- security scan clean enough;
- rollback documented.

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

2. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

3. Jakarta EE Specifications  
   https://jakarta.ee/specifications/

4. Jakarta EE Compatible Products  
   https://jakarta.ee/compatibility/

5. Kubernetes — Liveness, Readiness, and Startup Probes  
   https://kubernetes.io/docs/concepts/workloads/pods/probes/

6. Kubernetes — Configure Liveness, Readiness and Startup Probes  
   https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

7. OpenTelemetry Documentation  
   https://opentelemetry.io/docs/

8. OpenTelemetry Signals  
   https://opentelemetry.io/docs/concepts/signals/

9. OWASP Application Security Verification Standard  
   https://owasp.org/www-project-application-security-verification-standard/

10. OWASP Top 10  
    https://owasp.org/www-project-top-ten/

11. Google SRE Book  
    https://sre.google/sre-book/table-of-contents/

12. CNCF Cloud Native Trail Map  
    https://github.com/cncf/trailmap

---

# Penutup

Bagian ini menutup rangkaian utama pembelajaran Jakarta EE/Jakarta Package dari fondasi sampai production-grade engineering.

Mental model terakhir:

```text
Jakarta EE knowledge
  ↓
architecture decisions
  ↓
runtime and configuration
  ↓
security and observability
  ↓
reliability and resilience
  ↓
deployment and rollback
  ↓
governance and team ownership
  ↓
long-term maintainability
```

Top 1% Jakarta engineer bukan hanya tahu banyak annotation.

Ia tahu:

```text
what happens at runtime
what fails in production
what must be measured
what must be secured
what must be documented
what can be rolled back
what must be migrated carefully
what should be simplified
```

Prinsip final:

```text
A production Jakarta EE system is not successful because it uses many specifications.
It is successful because every specification is used intentionally,
within clear boundaries, with observable behavior and recoverable failure modes.
```

Dengan ini, rangkaian utama materi **learn-java-jakarta-part-000 sampai learn-java-jakarta-part-040** telah selesai.

Appendix/lanjutan opsional yang masih bisa dibuat setelah ini:

- Appendix A — Jakarta EE Reference Architecture Blueprint.
- Appendix B — Runtime Comparison Matrix.
- Appendix C — Security Hardening Checklist.
- Appendix D — Observability Dashboard & Alert Catalog.
- Appendix E — Migration Automation Scripts.
- Appendix F — Capstone Implementation Plan.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-039.md">⬅️ Bagian 39 — Jakarta EE Migration & Modernization Playbook: Java EE/Jakarta Legacy ke Jakarta EE 11 dan Runtime Modern</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<span></span>
</div>
