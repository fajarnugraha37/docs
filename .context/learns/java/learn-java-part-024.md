# learn-java-part-024.md

# Bagian 24 — Capstone: Java Engineering Mastery dan Production-Grade Decision Making

> Target pembaca: Java software engineer yang sudah melewati fondasi language, JVM, concurrency, GC, observability, security, testing, enterprise backend, cloud/container, performance, framework internals, domain modeling, dan migration.
>
> Target hasil: kamu memiliki kerangka kerja profesional untuk berpikir, mendesain, mengimplementasikan, mereview, mengoperasikan, dan terus meningkatkan sistem Java production-grade seperti engineer senior/top-tier—bukan hanya “bisa coding Java”.

---

## Daftar Isi

1. [Orientasi: Apa Arti “Menguasai Java” di Level Senior](#1-orientasi-apa-arti-menguasai-java-di-level-senior)
2. [Peta Kompetensi Java Engineer Top-Tier](#2-peta-kompetensi-java-engineer-top-tier)
3. [Mental Model Utama: Correctness, Clarity, Operability, Evolvability](#3-mental-model-utama-correctness-clarity-operability-evolvability)
4. [Decision-Making Framework](#4-decision-making-framework)
5. [Architecture Decision Record untuk Java System](#5-architecture-decision-record-untuk-java-system)
6. [Production Readiness Review](#6-production-readiness-review)
7. [Code Review Playbook untuk Java](#7-code-review-playbook-untuk-java)
8. [Design Review Playbook](#8-design-review-playbook)
9. [API Review Playbook](#9-api-review-playbook)
10. [Data and Transaction Review Playbook](#10-data-and-transaction-review-playbook)
11. [Concurrency Review Playbook](#11-concurrency-review-playbook)
12. [Performance Review Playbook](#12-performance-review-playbook)
13. [Security Review Playbook](#13-security-review-playbook)
14. [Observability Review Playbook](#14-observability-review-playbook)
15. [Operational Review: Deploy, Rollback, Incident](#15-operational-review-deploy-rollback-incident)
16. [Quality Gates dan CI/CD](#16-quality-gates-dan-cicd)
17. [Standards untuk Java Codebase](#17-standards-untuk-java-codebase)
18. [Technical Debt Management](#18-technical-debt-management)
19. [Incident Learning dan Postmortem](#19-incident-learning-dan-postmortem)
20. [Mentoring dan Team Enablement](#20-mentoring-dan-team-enablement)
21. [Java Engineer Personal Operating System](#21-java-engineer-personal-operating-system)
22. [Roadmap Belajar Berkelanjutan](#22-roadmap-belajar-berkelanjutan)
23. [Capstone Project: Production-Grade Java Service](#23-capstone-project-production-grade-java-service)
24. [Rubrik Evaluasi Diri](#24-rubrik-evaluasi-diri)
25. [Checklist Final Java Mastery](#25-checklist-final-java-mastery)
26. [Referensi Utama](#26-referensi-utama)

---

# 1. Orientasi: Apa Arti “Menguasai Java” di Level Senior

Menguasai Java di level senior bukan berarti hafal semua API `java.util`, bisa menulis Spring Boot controller, atau tahu fitur baru setiap versi.

Menguasai Java berarti kamu bisa menghubungkan banyak layer:

```text
business requirement
  ↓
domain model
  ↓
API contract
  ↓
application service
  ↓
transaction boundary
  ↓
data model
  ↓
concurrency model
  ↓
error model
  ↓
security model
  ↓
observability model
  ↓
JVM/runtime behavior
  ↓
container/cloud behavior
  ↓
operational lifecycle
```

Java engineer top-tier tidak hanya bertanya:

```text
Bagaimana cara implement ini?
```

Ia bertanya:

```text
Apa invariant-nya?
Apa failure mode-nya?
Apa data consistency boundary-nya?
Apa yang terjadi saat retry?
Apa yang terjadi saat pod mati?
Apa yang terjadi saat DB lambat?
Apa yang terjadi saat dependency upgrade?
Apa yang terjadi saat traffic naik 10x?
Apa yang perlu dilihat operator saat incident?
Apa yang harus tetap backward-compatible?
Apa bukti bahwa solusi ini benar?
```

## 1.1 Dari “coder” ke “engineer”

Coder fokus pada instruksi:

```text
buat endpoint
buat repository
buat service
buat DTO
```

Engineer fokus pada sistem:

```text
endpoint ini mengubah state apa?
state transition mana yang valid?
apakah command idempotent?
apakah transaction boundary benar?
apakah event publish konsisten?
apakah audit trail cukup?
apakah error response stabil?
apakah observability cukup?
apakah rollback aman?
```

## 1.2 Java sebagai platform sistem

Java bukan hanya bahasa. Java adalah platform panjang umur untuk sistem enterprise. Karena itu tanggung jawab engineer Java mencakup:

- language semantics;
- API/library design;
- JVM/runtime;
- memory/GC;
- concurrency;
- networking/I/O;
- security;
- persistence;
- framework behavior;
- testing;
- deployment;
- monitoring;
- migration;
- team standards.

## 1.3 Capstone ini bukan materi baru terpisah

Bagian ini adalah “pengikat” semua bagian sebelumnya.

Jika part sebelumnya menjawab:

```text
Apa itu generics?
Apa itu GC?
Apa itu virtual thread?
Apa itu JFR?
Apa itu domain event?
Apa itu JPMS?
```

Bagian ini menjawab:

```text
Bagaimana memakai semua itu untuk membuat keputusan engineering yang benar?
```

---

# 2. Peta Kompetensi Java Engineer Top-Tier

Java engineer top-tier punya kompetensi berbentuk T:

```text
          broad system understanding
------------------------------------------------
          deep Java/JVM/backend expertise
```

## 2.1 Kompetensi bahasa

Harus paham:

- type system;
- object model;
- generics;
- records;
- sealed types;
- pattern matching;
- exception semantics;
- initialization;
- access control;
- immutability;
- annotations;
- modules.

Pertanyaan evaluasi:

```text
Kapan record cocok dan kapan tidak?
Kapan sealed type lebih baik daripada enum?
Kapan checked exception membantu?
Kapan generics membuat API lebih aman?
Apa risiko reflection terhadap encapsulation?
```

## 2.2 Kompetensi JVM/runtime

Harus paham:

- class loading;
- bytecode;
- JIT;
- profiling feedback;
- safepoint;
- heap/native memory;
- GC;
- JFR/JMC;
- diagnostic tools;
- container ergonomics.

Pertanyaan evaluasi:

```text
Kenapa service lambat hanya saat startup?
Kenapa CPU tinggi tapi throughput rendah?
Kenapa container OOMKilled tanpa Java heap dump?
Kenapa virtual thread tidak menaikkan throughput?
Kenapa JIT warmup membuat latency rollout naik?
```

## 2.3 Kompetensi concurrency

Harus paham:

- Java Memory Model;
- happens-before;
- synchronized;
- volatile;
- final;
- atomics;
- locks;
- executor;
- CompletableFuture;
- virtual threads;
- structured concurrency state;
- cancellation;
- backpressure.

Pertanyaan evaluasi:

```text
Apa perbedaan visibility dan atomicity?
Apa risiko unbounded executor queue?
Apa yang terjadi jika blocking I/O dilakukan di synchronized?
Apa resource nyata yang membatasi virtual threads?
```

## 2.4 Kompetensi backend/domain

Harus paham:

- domain modeling;
- aggregate;
- invariant;
- transaction;
- repository;
- outbox;
- idempotency;
- API contract;
- data migration;
- messaging;
- distributed failure.

Pertanyaan evaluasi:

```text
Apa yang harus konsisten secara atomik?
Apa yang boleh eventual?
Apa event yang harus dipublish?
Apa yang terjadi saat duplicate command?
Apa boundary antara domain event dan integration event?
```

## 2.5 Kompetensi production

Harus paham:

- logging;
- metrics;
- tracing;
- profiling;
- dashboards;
- alerting;
- incident response;
- rollback;
- capacity planning;
- performance testing;
- security scanning;
- dependency management.

Pertanyaan evaluasi:

```text
Jika p99 naik, sinyal apa yang kamu lihat dulu?
Jika deployment gagal, apa rollback plan?
Jika dependency CVE muncul, bagaimana prioritasnya?
Jika memory naik perlahan, bagaimana diagnosis?
```

## 2.6 Kompetensi leadership teknis

Harus bisa:

- menulis ADR;
- memimpin design review;
- membuat coding standards;
- melakukan code review yang mendidik;
- mengelola technical debt;
- membuat runbook;
- membimbing engineer lain;
- menyederhanakan kompleksitas;
- mengomunikasikan risiko.

---

# 3. Mental Model Utama: Correctness, Clarity, Operability, Evolvability

Setiap keputusan teknis bisa dievaluasi dengan empat dimensi:

```text
Correctness
Clarity
Operability
Evolvability
```

## 3.1 Correctness

Correctness berarti sistem melakukan hal yang benar sesuai invariant dan requirement.

Pertanyaan:

- Apakah state legal?
- Apakah transition valid?
- Apakah transaction boundary benar?
- Apakah retry aman?
- Apakah concurrent update aman?
- Apakah data loss mungkin?
- Apakah security rule enforceable?
- Apakah error handling tidak menyembunyikan kegagalan?

Contoh correctness issue:

```java
case.setStatus(CLOSED);
```

tanpa memastikan evidence lengkap, actor berwenang, audit tercatat, dan event dipublish.

## 3.2 Clarity

Clarity berarti solusi bisa dipahami manusia.

Pertanyaan:

- Apakah nama class/method mencerminkan domain?
- Apakah dependency direction jelas?
- Apakah error jelas?
- Apakah code menjelaskan intent?
- Apakah abstraction membantu atau menyembunyikan?
- Apakah reviewer bisa melihat invariant?
- Apakah future engineer bisa safely modify?

Code clarity bukan berarti semua sederhana. Sistem kompleks tetap bisa jelas jika konsepnya eksplisit.

## 3.3 Operability

Operability berarti sistem bisa dioperasikan dalam production.

Pertanyaan:

- Apakah health check benar?
- Apakah shutdown graceful?
- Apakah metric cukup?
- Apakah log punya correlation ID?
- Apakah trace menjelaskan latency?
- Apakah JFR/diagnostic bisa diambil?
- Apakah alert actionable?
- Apakah runbook ada?
- Apakah rollback aman?

Aplikasi yang “benar” tapi tidak bisa di-debug saat incident belum production-grade.

## 3.4 Evolvability

Evolvability berarti sistem bisa berubah tanpa collapse.

Pertanyaan:

- Apakah API versioning jelas?
- Apakah schema evolution aman?
- Apakah domain boundary jelas?
- Apakah dependency coupling rendah?
- Apakah tests melindungi behavior?
- Apakah migration path ada?
- Apakah framework upgrade feasible?
- Apakah technical debt terlihat?

## 3.5 Trade-off

Keempat dimensi kadang bertentangan.

Contoh:

```text
lebih banyak abstraction
  + evolvability mungkin naik
  - clarity bisa turun
  - performance bisa turun
```

Atau:

```text
cache agresif
  + performance naik
  - correctness/invalidation risk naik
  - memory/operability risk naik
```

Engineer senior tidak mencari “best practice” universal. Ia menjelaskan trade-off dan memilih berdasarkan context.

---

# 4. Decision-Making Framework

Gunakan framework ini saat memilih solusi.

## 4.1 Bentuk keputusan

```text
Problem
  ↓
Context
  ↓
Constraints
  ↓
Options
  ↓
Trade-offs
  ↓
Decision
  ↓
Consequences
  ↓
Validation plan
```

## 4.2 Problem

Tuliskan problem dengan jelas.

Buruk:

```text
Service lambat.
```

Baik:

```text
Endpoint POST /cases/{id}/escalate memiliki p99 2.4s pada 250 RPS,
SLO p99 < 800ms, dan trace menunjukkan 70% waktu menunggu DB connection.
```

## 4.3 Context

Context:

- traffic;
- data size;
- team skill;
- deadline;
- compliance;
- existing architecture;
- deployment model;
- operational maturity;
- migration constraints.

Solusi yang baik di startup kecil bisa buruk di sistem regulatori besar.

## 4.4 Constraints

Constraints bisa:

- technical;
- business;
- regulatory;
- security;
- operational;
- cost;
- timeline;
- compatibility.

Contoh:

```text
Must preserve existing API contract.
Must support rollback to previous version.
Must not exceed 100 DB connections.
Must keep audit trail immutable.
```

## 4.5 Options

Minimal bandingkan 2–3 opsi.

Contoh problem DB pool wait:

1. increase DB pool per pod;
2. reduce max replicas;
3. optimize slow query;
4. add read model/cache;
5. add backpressure;
6. scale DB.

Jangan langsung pilih opsi yang paling mudah.

## 4.6 Trade-off matrix

| Option | Pros | Cons | Risk | Evidence needed |
|---|---|---|---|---|
| Increase pool | quick | DB overload risk | high | DB capacity test |
| Optimize query | durable | needs work | medium | query plan |
| Cache result | lower DB load | staleness | medium | cache hit ratio |
| Backpressure | protects DB | rejects users | low/medium | queue metrics |

## 4.7 Decision

Decision harus eksplisit:

```text
We will optimize query and add bounded backpressure.
We will not increase pool until DB capacity test proves safe.
```

## 4.8 Validation plan

Setiap decision butuh cara membuktikan.

```text
Success:
- DB pool pending p95 < 20ms
- endpoint p99 < 800ms
- DB CPU < 70%
- error rate < 0.1%
```

## 4.9 Reversibility

Tanyakan:

```text
Apakah keputusan ini reversible?
```

Reversible:

- config change;
- feature flag;
- new endpoint optional;
- cache TTL.

Hard to reverse:

- schema breaking change;
- public API contract change;
- event schema change;
- database split;
- service decomposition;
- encryption key design.

Irreversible decisions butuh review lebih ketat.

---

# 5. Architecture Decision Record untuk Java System

ADR adalah dokumen kecil yang mencatat keputusan arsitektur penting.

## 5.1 Kapan butuh ADR?

Gunakan ADR untuk keputusan seperti:

- Java version target;
- framework major version;
- database selection;
- transaction strategy;
- eventing/outbox strategy;
- API style;
- concurrency model;
- deployment model;
- observability standard;
- security mechanism;
- migration path;
- module boundary;
- code generation/proxy approach.

Tidak semua hal butuh ADR. Jangan tulis ADR untuk hal trivial.

## 5.2 Template ADR

```markdown
# ADR-<nnn>: <Decision Title>

## Status

Proposed | Accepted | Deprecated | Superseded

## Date

YYYY-MM-DD

## Context

What problem are we solving?
What constraints matter?
What existing conditions influence the decision?

## Decision

What did we decide?

## Options Considered

### Option A
Pros:
Cons:
Risks:

### Option B
Pros:
Cons:
Risks:

## Consequences

Positive:
Negative:
Neutral:

## Validation Plan

How will we prove the decision works?

## Rollback / Reversal Plan

How can this decision be undone if wrong?

## References

Links to docs, issues, benchmarks, incident reports.
```

## 5.3 Example ADR: Java 25 Migration

```markdown
# ADR-014: Adopt Java 25 as Runtime Baseline

## Status

Accepted

## Context

Current services run on Java 17. Java 25 is the target LTS for the next platform cycle.
We need JFR improvements, updated security baseline, and long-term support alignment.
Several services use reflection-heavy libraries and APM agents.

## Decision

Adopt Java 25 as runtime and compile baseline for new services.
Existing services migrate in waves after dependency compatibility checks.

## Options Considered

### Stay on Java 17
Pros:
- stable
- lower migration risk
Cons:
- older LTS
- delayed platform modernization

### Move to Java 21
Pros:
- virtual threads stable
- mature ecosystem
Cons:
- not final target for next cycle

### Move to Java 25
Pros:
- LTS target
- newest diagnostics/security/runtime
Cons:
- tool compatibility must be verified

## Consequences

Positive:
- standardize platform
- better diagnostics
- future-proof migration

Negative:
- upgrade build/test/APM tools
- rebaseline performance

## Validation Plan

- jdeps/jdeprscan clean
- all tests green
- staging load test
- APM/JFR verified
- canary rollout

## Rollback

- keep Java 17 image available
- schema/event compatibility maintained
```

## 5.4 ADR anti-pattern

- ADR terlalu panjang seperti thesis;
- ADR tidak punya consequences;
- ADR dibuat setelah keputusan hanya sebagai formalitas;
- ADR tidak pernah superseded;
- ADR tidak ditemukan saat onboarding;
- ADR berisi opini tanpa evidence.

---

# 6. Production Readiness Review

Production readiness review menjawab:

```text
Apakah service siap menerima traffic production dan siap dioperasikan saat gagal?
```

## 6.1 Scope review

Review harus mencakup:

- domain correctness;
- API contract;
- data model;
- transaction;
- idempotency;
- security;
- performance;
- capacity;
- observability;
- deployment;
- rollback;
- runbook;
- ownership.

## 6.2 Template PRR

```markdown
# Production Readiness Review — <service>

## 1. Ownership

- Service owner:
- On-call owner:
- Domain owner:
- Data owner:

## 2. Criticality

- Tier:
- SLO:
- RTO/RPO:
- Compliance requirements:

## 3. Architecture Summary

- Responsibilities:
- Dependencies:
- Data stores:
- Message topics:
- External APIs:

## 4. Correctness

- Domain invariants:
- Transaction boundaries:
- Idempotency:
- Concurrency conflict handling:
- Data consistency:

## 5. Security

- Authentication:
- Authorization:
- Secrets:
- TLS/mTLS:
- Input validation:
- Audit:
- Dependency scanning:

## 6. Reliability

- Timeout:
- Retry:
- Circuit breaker:
- Bulkhead:
- Backpressure:
- DLQ:
- Graceful shutdown:

## 7. Observability

- Logs:
- Metrics:
- Traces:
- Dashboards:
- Alerts:
- JFR/diagnostics:
- Runbooks:

## 8. Performance and Capacity

- Expected traffic:
- Load test:
- Resource requests/limits:
- DB pool:
- JVM sizing:
- Autoscaling:

## 9. Deployment

- CI/CD:
- Migration:
- Feature flags:
- Canary:
- Rollback:

## 10. Risks

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
```

## 6.3 PRR is not a ceremony

PRR harus menemukan masalah sebelum production.

Contoh finding yang valuable:

```text
DB pool max=30, HPA max=20, database safe connection budget=200.
Risk: app can open 600 connections.
Action: reduce maxPoolSize to 8 or HPA max to 6; add pool metric alert.
```

## 6.4 Minimum production readiness checklist

- [ ] Service owner jelas.
- [ ] SLO jelas.
- [ ] API contract terdokumentasi.
- [ ] Timeouts semua outbound call.
- [ ] Retry bounded dengan jitter.
- [ ] Idempotency untuk command retryable.
- [ ] Transaction boundary jelas.
- [ ] DB pool total dihitung.
- [ ] Resource request/limit dihitung.
- [ ] Graceful shutdown diuji.
- [ ] Readiness/liveness/startup probe benar.
- [ ] Logs punya correlation/trace ID.
- [ ] Metrics dan dashboard ada.
- [ ] Alerts actionable.
- [ ] Runbook ada.
- [ ] Rollback diuji.
- [ ] Security scan bersih atau accepted risk.
- [ ] Dependency licenses/security reviewed.
- [ ] Load test minimal dilakukan.

---

# 7. Code Review Playbook untuk Java

Code review bukan mencari kesalahan kecil. Code review adalah mekanisme menjaga correctness, maintainability, dan shared learning.

## 7.1 Urutan review yang efektif

Jangan mulai dari format.

Urutan:

1. requirement/intent;
2. correctness;
3. domain invariant;
4. error handling;
5. security;
6. concurrency;
7. data/transaction;
8. performance;
9. observability;
10. tests;
11. maintainability;
12. style.

Formatting harus otomatis lewat tool.

## 7.2 Review intent

Pertanyaan:

- Masalah apa yang diselesaikan?
- Apakah solusi sesuai requirement?
- Apakah ada requirement tersembunyi?
- Apakah perubahan terlalu luas?
- Apakah PR bisa diperkecil?

Red flag:

```text
PR 5.000 lines mencampur feature, refactor, dependency upgrade, formatting.
```

## 7.3 Review correctness

Pertanyaan:

- Apakah state transition valid?
- Apakah null/empty/boundary handled?
- Apakah error case handled?
- Apakah timezone/locale/charset explicit?
- Apakah equality/hashCode benar?
- Apakah collection mutability aman?
- Apakah validation berada di layer tepat?

## 7.4 Review domain model

Pertanyaan:

- Apakah domain concept punya nama/type?
- Apakah primitive obsession muncul?
- Apakah setter bypass invariant?
- Apakah value object memvalidasi dirinya?
- Apakah aggregate root mengontrol perubahan?
- Apakah event bernama past tense?
- Apakah command bernama imperative?

## 7.5 Review error handling

Pertanyaan:

- Apakah domain rejection dibedakan dari technical failure?
- Apakah exception terlalu generic?
- Apakah retry bisa memperburuk?
- Apakah error response tidak membocorkan data sensitif?
- Apakah interrupted status dipreserve?
- Apakah cleanup resource aman?

## 7.6 Review security

Pertanyaan:

- Input trusted atau untrusted?
- Authorization ada di boundary tepat?
- Secret tidak dilog?
- TLS/certificate tidak dibypass?
- Deserialization aman?
- SQL injection dicegah?
- Path traversal dicegah?
- SSRF dicegah?
- Dependency baru aman?

## 7.7 Review concurrency

Pertanyaan:

- Apakah shared mutable state aman?
- Apakah executor bounded?
- Apakah CompletableFuture memakai executor eksplisit?
- Apakah virtual threads punya bulkhead?
- Apakah ThreadLocal dibersihkan?
- Apakah lock critical section kecil?
- Apakah timeout/cancellation ada?
- Apakah backpressure ada?

## 7.8 Review performance

Pertanyaan:

- Apakah hot path allocation tinggi?
- Apakah regex/formatter/ObjectMapper dibuat berulang?
- Apakah logging mahal?
- Apakah N+1 query mungkin?
- Apakah data structure sesuai access pattern?
- Apakah batch/streaming diperlukan?
- Apakah cache bounded?
- Apakah performance claim punya benchmark?

## 7.9 Review observability

Pertanyaan:

- Apakah log membantu incident?
- Apakah log punya correlation ID?
- Apakah error log actionable?
- Apakah metric untuk resource penting ada?
- Apakah trace span di boundary penting ada?
- Apakah high-cardinality metric dihindari?
- Apakah audit event cukup?

## 7.10 Review tests

Pertanyaan:

- Apakah happy path saja?
- Apakah invalid state diuji?
- Apakah boundary value diuji?
- Apakah concurrency conflict diuji?
- Apakah serialization contract diuji?
- Apakah integration test pakai dependency real jika perlu?
- Apakah test terlalu mock-heavy?
- Apakah flaky risk?

## 7.11 Cara memberi komentar review

Komentar buruk:

```text
Ini salah.
```

Komentar baik:

```text
Method ini mengubah status langsung via setter sehingga melewati invariant "closed case cannot be escalated".
Bisa dipindahkan ke EnforcementCase#escalate(...) agar transition dan event terjaga?
```

Komentar senior:

- menjelaskan why;
- mengusulkan direction;
- membedakan blocker vs suggestion;
- tidak mempermalukan;
- membantu author belajar.

## 7.12 Label komentar

Gunakan label:

```text
[blocker] correctness/security/data loss
[important] maintainability/reliability
[suggestion] improvement
[question] clarify intent
[nit] minor style
```

---

# 8. Design Review Playbook

Design review dilakukan sebelum implementasi besar.

## 8.1 Input design review

Harus ada:

- problem statement;
- scope;
- non-goals;
- domain model;
- API contract;
- data model;
- state machine;
- transaction boundary;
- failure model;
- observability plan;
- rollout plan.

## 8.2 Pertanyaan design review

### Domain

- Apa aggregate-nya?
- Apa invariant-nya?
- Apa state machine-nya?
- Apa command/event-nya?
- Apa yang harus diaudit?

### Data

- Apa source of truth?
- Apa schema change?
- Apa index?
- Apa transaction boundary?
- Apa isolation/locking?
- Apa data migration?

### API

- Apakah idempotent?
- Apa error contract?
- Apa pagination?
- Apa versioning?
- Apa backward compatibility?

### Reliability

- Timeout?
- Retry?
- Circuit breaker?
- DLQ?
- Backpressure?
- Graceful shutdown?

### Security

- Authentication?
- Authorization?
- PII?
- Audit?
- Secrets?
- Threat model?

### Operations

- Dashboard?
- Alerts?
- Runbook?
- Capacity?
- Deployment?
- Rollback?

## 8.3 State machine required for lifecycle features

Jika feature mengubah status/lifecycle, wajib ada state machine.

Contoh:

```text
DRAFT → SUBMITTED → UNDER_REVIEW → RESOLVED → CLOSED
                       ↓
                    ESCALATED
```

Review:

- valid transitions;
- invalid transitions;
- terminal states;
- retry behavior;
- idempotency;
- audit events.

## 8.4 Sequence diagram untuk distributed flow

Untuk flow multi-service:

```text
Client → API → Service A → DB → Outbox → Kafka → Service B → DB
```

Review:

- what if each arrow fails?
- which operation is atomic?
- duplicate handling?
- ordering?
- timeout?
- rollback/compensation?

## 8.5 Design review output

Output harus berupa:

- approved;
- approved with changes;
- rejected;
- deferred pending evidence.

Evidence bisa:

- prototype;
- benchmark;
- query plan;
- load test;
- security review;
- ADR.

---

# 9. API Review Playbook

API adalah contract. Setelah public, sulit diubah.

## 9.1 REST API checklist

- [ ] Resource naming jelas.
- [ ] HTTP method benar.
- [ ] Status code konsisten.
- [ ] Error response stabil.
- [ ] Idempotency untuk command retryable.
- [ ] Pagination bounded.
- [ ] Filtering/sorting explicit.
- [ ] Versioning strategy.
- [ ] Authentication/authorization.
- [ ] Rate limit/backpressure.
- [ ] Request/response schema documented.
- [ ] Date/time format ISO explicit.
- [ ] Correlation/request ID.
- [ ] No internal field leakage.

## 9.2 Error response

Gunakan stable error shape:

```json
{
  "code": "CASE_INVALID_TRANSITION",
  "message": "Case cannot be escalated from CLOSED status.",
  "correlationId": "4f7c...",
  "details": {
    "caseId": "CASE-123",
    "currentStatus": "CLOSED",
    "action": "ESCALATE"
  }
}
```

Jangan expose:

- stack trace;
- SQL error detail;
- secret/token;
- internal host/path;
- framework class names.

## 9.3 Idempotency

For POST command:

```http
Idempotency-Key: 2b899...
```

Server stores:

```text
key + request fingerprint + result
```

If duplicate same request:

```text
return same result
```

If same key different request:

```text
409 conflict
```

## 9.4 Pagination

Avoid unbounded:

```http
GET /cases
```

Use:

```http
GET /cases?limit=50&cursor=...
```

or page if stable.

## 9.5 API versioning

Options:

- URL version `/v1`;
- header version;
- media type version;
- event schema version.

Choose and document.

## 9.6 Compatibility rules

Safe changes:

- add optional response field;
- add optional request field;
- add new enum only if consumers tolerate unknown;
- add new endpoint.

Breaking changes:

- remove field;
- rename field;
- change type;
- change semantics;
- make optional field required;
- change enum values;
- change error code meaning.

---

# 10. Data and Transaction Review Playbook

## 10.1 Data is harder to rollback than code

Code rollback can be fast. Data rollback often is not.

Review data changes carefully.

## 10.2 Schema migration strategy

Use expand-contract:

```text
1. add nullable column/table
2. deploy app writing old + new
3. backfill
4. switch reads
5. stop writing old
6. drop old later
```

Avoid:

```text
deploy app requiring new non-null column before migration/backfill
```

## 10.3 Transaction boundary checklist

- [ ] What is atomic?
- [ ] What can be eventual?
- [ ] What happens if DB commit succeeds but message publish fails?
- [ ] Is outbox needed?
- [ ] Is optimistic locking needed?
- [ ] Is unique constraint needed for idempotency?
- [ ] Are external calls inside transaction?
- [ ] Is transaction too long?
- [ ] What isolation level?
- [ ] How are deadlocks handled?

## 10.4 External call in transaction

Bad:

```java
@Transactional
public void approve(...) {
    repository.save(...);
    externalClient.notify(...); // waits while transaction open
}
```

Risk:

- holds DB locks;
- slow transaction;
- rollback confusion;
- external side effect cannot rollback.

Better:

- save state + outbox in transaction;
- publish after commit;
- process async.

## 10.5 Database constraints

Domain validation is not enough.

Use DB constraints for:

- unique business key;
- idempotency key;
- non-null required columns;
- foreign key where appropriate;
- check constraints;
- optimistic version.

## 10.6 Query plan review

For new query:

- expected cardinality;
- index usage;
- sort cost;
- pagination;
- join cardinality;
- N+1 risk;
- locking behavior;
- stale stats.

---

# 11. Concurrency Review Playbook

## 11.1 Identify shared state

Ask:

```text
What state is shared across threads?
Who owns it?
How is visibility guaranteed?
How is mutation coordinated?
```

Shared state examples:

- caches;
- static maps;
- singleton fields;
- metrics counters;
- in-memory queues;
- connection pools;
- ThreadLocal;
- schedulers.

## 11.2 Executor review

For every executor:

- name;
- purpose;
- pool size;
- queue type;
- queue bound;
- rejection policy;
- timeout;
- shutdown behavior;
- metrics.

Anti-pattern:

```java
Executors.newFixedThreadPool(100)
```

because queue is unbounded.

Better:

```java
new ThreadPoolExecutor(
    16,
    16,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(1000),
    new NamedThreadFactory("case-worker"),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Choose rejection policy consciously.

## 11.3 CompletableFuture review

Avoid:

```java
CompletableFuture.supplyAsync(() -> blockingCall())
```

without executor.

Use:

```java
CompletableFuture.supplyAsync(() -> blockingCall(), ioExecutor)
```

Review:

- exception handling;
- timeout;
- cancellation;
- executor;
- composition;
- common pool usage.

## 11.4 Virtual thread review

Virtual threads need:

- downstream bulkhead;
- DB pool bound;
- timeout;
- ThreadLocal audit;
- pinning check;
- memory observation;
- structured lifecycle if possible.

## 11.5 Lock review

For each lock:

- what invariant protected?
- lock order?
- critical section duration?
- I/O inside lock?
- contention metric?
- deadlock possibility?
- fairness needed?

## 11.6 Cancellation

Java cancellation is cooperative.

Review:

- interrupt handling;
- `InterruptedException` not swallowed;
- timeouts;
- context cancellation;
- resource cleanup;
- shutdown hooks.

---

# 12. Performance Review Playbook

## 12.1 Performance claim requires evidence

Claim:

```text
This is faster.
```

Needs:

- benchmark;
- workload;
- before/after;
- environment;
- metric;
- trade-off.

## 12.2 Hot path review

Look for:

- repeated object allocation;
- reflection lookup;
- regex compile;
- `String.format`;
- logging payload;
- `ObjectMapper` creation;
- blocking call;
- N+1 query;
- unbounded collection growth;
- inefficient data structure.

## 12.3 Capacity formula

For service:

```text
capacity ≈ min(
  CPU capacity,
  DB connection capacity,
  downstream capacity,
  queue/worker capacity,
  memory/GC capacity,
  network capacity
)
```

Do not optimize non-bottleneck.

## 12.4 Tail latency

Review:

- p95/p99, not only average;
- queue wait;
- GC pause;
- lock contention;
- DB pool pending;
- retry;
- timeout;
- cold start;
- CPU throttling.

## 12.5 JMH vs load test

Use JMH for:

- method/algorithm comparison;
- allocation micro-pattern;
- data structure choice.

Use load test for:

- service behavior;
- DB/downstream;
- concurrency;
- container;
- real latency.

Do not use microbenchmark alone to justify architecture.

---

# 13. Security Review Playbook

Use a structured security review, not only “we use Spring Security”.

## 13.1 Threat modeling questions

- What assets are protected?
- Who are actors?
- What are trust boundaries?
- What input is untrusted?
- What can attacker control?
- What happens if token leaks?
- What happens if dependency compromised?
- What audit is required?
- What are abuse cases?

## 13.2 Java-specific security checklist

- [ ] No insecure deserialization.
- [ ] No trust-all TLS.
- [ ] No disabled hostname verification.
- [ ] No MD5/SHA-1 for security.
- [ ] SecureRandom used for security randomness.
- [ ] Passwords hashed with password hashing algorithm, not plain digest.
- [ ] Secrets not in logs.
- [ ] Input validation and output encoding.
- [ ] SQL injection prevented with parameters.
- [ ] Path traversal prevented.
- [ ] SSRF guarded.
- [ ] XML parsing hardened.
- [ ] Jackson polymorphism safe.
- [ ] Dependency scan.
- [ ] Container image scan.
- [ ] SBOM/provenance where required.

## 13.3 OWASP ASVS mapping

For web/API applications, map relevant requirements to OWASP ASVS areas:

- architecture;
- authentication;
- session/token;
- access control;
- validation/sanitization;
- stored cryptography;
- error/logging;
- data protection;
- communication security;
- malicious code;
- business logic.

Use ASVS as verification checklist, not as decoration.

## 13.4 Supply chain

Supply chain controls:

- dependency pinning;
- internal artifact repository;
- SBOM;
- vulnerability scanning;
- build provenance;
- signed artifacts/images;
- branch protection;
- CI isolation;
- least privilege token;
- reproducible build where possible.

SLSA gives a useful language for integrity controls across source/build/artifact.

---

# 14. Observability Review Playbook

Observability answers:

```text
Can we understand what the system is doing from the outside?
```

## 14.1 Three pillars plus profiling

Traditional:

- logs;
- metrics;
- traces.

For Java, add:

- profiles/JFR;
- thread dumps;
- heap dumps;
- GC logs;
- NMT;
- domain events/audit.

## 14.2 Logs

Logs should answer:

- what happened?
- where?
- for which request/correlation?
- for which domain object?
- what outcome?
- what error?

Bad log:

```text
Error happened
```

Good log:

```json
{
  "level": "ERROR",
  "event": "CASE_ESCALATION_FAILED",
  "caseId": "CASE-123",
  "actorId": "OFFICER-7",
  "errorCode": "CASE_INVALID_TRANSITION",
  "currentStatus": "CLOSED",
  "action": "ESCALATE",
  "traceId": "..."
}
```

## 14.3 Metrics

Metrics should include:

- traffic;
- latency;
- errors;
- saturation;
- JVM heap;
- GC;
- thread count;
- DB pool;
- HTTP client;
- broker lag;
- queue depth;
- domain counters.

Avoid high-cardinality labels:

```text
caseId as metric label = bad
```

## 14.4 Traces

Trace useful for:

- request path;
- downstream latency;
- DB call;
- retry;
- queue/event flow;
- service boundary.

Trace should not leak PII/secrets.

## 14.5 JFR readiness

A production-grade Java service should have a plan for:

- starting JFR;
- dumping JFR;
- storing securely;
- analyzing with JMC;
- using custom JFR events for domain operations if useful.

Oracle's troubleshooting guidance for Java SE 25 recommends modern diagnostics such as JFR/JMC and `jcmd` for diagnosing JVM/application issues.

## 14.6 Alert design

Alerts should be symptom-based:

Good:

```text
p99 latency > SLO for 10 minutes
error rate > threshold
DB pool pending > threshold
Kafka lag growing
pod restart count > threshold
```

Bad:

```text
CPU > 70% once
log contains WARN
```

Alert must have runbook.

---

# 15. Operational Review: Deploy, Rollback, Incident

## 15.1 Deployment checklist

- [ ] Image tagged immutably.
- [ ] Config reviewed.
- [ ] DB migration order safe.
- [ ] Feature flags ready.
- [ ] Readiness/liveness/startup probes correct.
- [ ] Resource requests/limits reviewed.
- [ ] HPA/VPA behavior understood.
- [ ] Canary/rolling strategy.
- [ ] Dashboard open.
- [ ] Rollback command known.

## 15.2 Rollback checklist

- [ ] Previous image available.
- [ ] Config rollback possible.
- [ ] DB schema backward-compatible.
- [ ] Event schema backward-compatible.
- [ ] Feature flag reversible.
- [ ] Data written by new version readable by old version.
- [ ] On-call knows trigger.

## 15.3 Incident triage mental model

When incident occurs:

```text
stabilize first
diagnose second
fix third
learn fourth
```

Stabilize may mean:

- rollback;
- scale out;
- disable feature flag;
- shed load;
- open circuit;
- stop worker;
- pause consumer;
- increase resource temporarily;
- route traffic away.

## 15.4 Evidence collection

Collect before restart if possible:

- logs;
- metrics;
- traces;
- thread dump;
- heap dump if memory issue;
- JFR;
- GC logs;
- pod events;
- DB metrics;
- broker lag;
- deployment history.

## 15.5 Runbook

Runbook should include:

- symptoms;
- dashboards;
- commands;
- likely causes;
- mitigation;
- escalation;
- rollback;
- post-incident tasks.

Example:

```markdown
# Runbook: DB Pool Exhaustion

Symptoms:
- Hikari pending threads high
- p99 latency high
- DB active connections maxed

Immediate mitigation:
1. Check DB CPU/locks.
2. If recent deploy, rollback.
3. If traffic spike, enable load shedding.
4. Do not increase pool before DB capacity check.

Diagnostics:
- dashboard link
- SQL query for active sessions
- thread dump command
- trace query

Long-term:
- query optimization
- pool sizing
- backpressure
```

---

# 16. Quality Gates dan CI/CD

Quality gates should prevent known bad changes.

## 16.1 Build gates

- compile;
- unit tests;
- integration tests;
- static analysis;
- formatting;
- dependency convergence;
- vulnerability scan;
- license scan;
- container scan;
- coverage threshold where useful;
- mutation testing on critical modules;
- contract tests;
- migration checks.

## 16.2 Java-specific gates

- `maven-enforcer-plugin` or Gradle constraints;
- no dependency version ranges;
- no duplicate classes;
- no banned dependencies;
- no internal JDK API via `jdeps`;
- `jdeprscan` for APIs for removal;
- Error Prone/SpotBugs/Sonar;
- Checkstyle/google-java-format/palantir-java-format if adopted;
- JaCoCo compatible with JDK target;
- testcontainers integration tests.

## 16.3 Security gates

- SCA dependency scan;
- SAST;
- secret scanning;
- container image scan;
- SBOM generation;
- provenance/signing where required;
- ASVS mapping for critical web apps.

## 16.4 Performance gates

Not every PR needs full load test, but critical paths need:

- JMH benchmark for performance-sensitive code;
- regression threshold;
- periodic load test;
- canary metrics;
- automatic rollback trigger if platform supports.

## 16.5 Gate anti-pattern

Bad gates:

- slow but low signal;
- flaky tests;
- coverage percentage as vanity;
- warnings ignored for months;
- scans with no owner;
- metrics that block but no remediation path.

Good gates are:

- fast enough;
- actionable;
- owned;
- documented;
- periodically reviewed.

---

# 17. Standards untuk Java Codebase

Standards reduce cognitive load.

## 17.1 What standards should define

- Java version baseline;
- formatter;
- naming conventions;
- package structure;
- exception handling;
- logging format;
- error response format;
- transaction boundary;
- testing conventions;
- dependency policy;
- security policy;
- observability policy;
- migration policy;
- API versioning;
- database migration rules;
- concurrency/executor rules.

## 17.2 Standard example: exception

```text
- Domain rejection must use domain-specific exception or sealed result.
- Technical transient failures must be distinguishable.
- Do not catch Exception unless boundary layer.
- Preserve InterruptedException.
- Do not log and rethrow at same layer unless adding context.
- Public API must map exceptions to stable error codes.
```

## 17.3 Standard example: logging

```text
- Use structured logging.
- Always include traceId/correlationId when available.
- Do not log secrets/token/password.
- Domain events logged with stable event name.
- No debug payload logging in hot path by default.
- Error logs must include actionable context.
```

## 17.4 Standard example: dependency

```text
- All dependencies managed through BOM/version catalog.
- No dynamic versions.
- New dependency requires justification.
- Reflection/bytecode/agent dependencies require senior review.
- Security vulnerabilities must be triaged within SLA.
```

## 17.5 Standard example: concurrency

```text
- No unbounded executor queue.
- No CompletableFuture without explicit executor for blocking work.
- No blocking I/O inside synchronized.
- All queues must expose size metric.
- Virtual threads require downstream bulkhead.
```

## 17.6 Standards must be enforceable

If standard can be automated, automate it.

Examples:

- formatter;
- static analysis;
- dependency ban;
- package dependency check;
- architectural tests;
- OpenRewrite recipes;
- CI checks.

Human review should focus on judgment, not formatting.

---

# 18. Technical Debt Management

Technical debt is not “bad code”. It is a liability: a past decision that now slows or risks future change.

## 18.1 Debt taxonomy

| Debt type | Example |
|---|---|
| design debt | god service |
| domain debt | unclear state machine |
| testing debt | no integration tests |
| data debt | bad schema/no constraints |
| dependency debt | old framework |
| runtime debt | obsolete JVM flags |
| observability debt | no metrics |
| security debt | weak secret handling |
| documentation debt | tribal knowledge |
| migration debt | unsupported Java version |

## 18.2 Debt register

```markdown
# Technical Debt: Case Service

| ID | Debt | Impact | Risk | Cost | Owner | Plan |
|---|---|---|---|---|---|---|
| TD-001 | Case status as string | invalid states | high | medium | Fajar | introduce enum/state machine |
```

## 18.3 Debt must be tied to impact

Bad:

```text
Code ugly.
```

Good:

```text
Case transition rules are duplicated in 7 services, causing inconsistent rejection behavior and making audit explanation unreliable.
```

## 18.4 Pay debt opportunistically but intentionally

Debt can be paid:

- during feature touching same area;
- before major migration;
- after incident;
- as reliability sprint;
- as platform investment.

Avoid endless rewrite.

## 18.5 Boy Scout rule with boundary

Improve code you touch, but do not turn every task into architecture rewrite.

---

# 19. Incident Learning dan Postmortem

## 19.1 Blameless does not mean accountability-free

Blameless means:

```text
focus on system conditions, not personal shame
```

But ownership remains.

## 19.2 Postmortem template

```markdown
# Postmortem: <Incident Title>

## Summary

What happened?

## Impact

- users affected:
- duration:
- data impact:
- financial/regulatory impact:

## Timeline

| Time | Event |
|---|---|

## Detection

How was it detected?
Was alert timely?

## Root Cause

Technical root cause.
Contributing factors.

## What Went Well

## What Went Poorly

## Where We Got Lucky

## Action Items

| Action | Owner | Due | Type |
|---|---|---|---|

## Lessons

What should change in design, testing, observability, process?
```

## 19.3 Java-specific postmortem questions

- Was the issue visible in JFR/metrics?
- Did GC contribute?
- Was CPU throttling involved?
- Was DB pool involved?
- Were thread dumps useful?
- Did retry amplify load?
- Was exception handling hiding root cause?
- Did logging include correlation ID?
- Was rollback blocked by data?
- Did dependency/framework behavior surprise us?

## 19.4 Action item quality

Bad action:

```text
Be more careful.
```

Good action:

```text
Add CI architecture test preventing direct status setter usage outside domain package.
```

Good action:

```text
Add Hikari pending thread alert and dashboard panel.
```

Good action:

```text
Add idempotency key unique constraint for command table.
```

## 19.5 Learning loop

Incident should update:

- code;
- tests;
- runbook;
- dashboards;
- alerts;
- standards;
- training;
- ADR if architecture decision changes.

---

# 20. Mentoring dan Team Enablement

Top-tier engineer multiplies team capability.

## 20.1 Teach mental models, not only answers

Instead of:

```text
Use @Transactional here.
```

Teach:

```text
This use case modifies one aggregate and must save event atomically.
The transaction boundary belongs at application service.
Remember self-invocation does not pass Spring proxy.
```

## 20.2 Review as coaching

Good review explains:

- what is wrong;
- why it matters;
- how to fix;
- what principle applies.

## 20.3 Documentation for reuse

Good docs include:

- decision context;
- examples;
- anti-examples;
- checklist;
- runbook;
- ownership.

## 20.4 Pairing modes

- driver/navigator;
- design pairing;
- debugging pairing;
- test pairing;
- incident pairing;
- code reading session.

## 20.5 Create team assets

Assets:

- project template;
- coding standard;
- ADR template;
- PR checklist;
- incident runbook;
- migration guide;
- performance benchmark template;
- JFR analysis guide;
- domain modeling examples;
- dependency upgrade playbook.

## 20.6 Avoid hero mode

Hero engineer fixes everything alone. Top-tier engineer builds systems so the team can fix things together.

---

# 21. Java Engineer Personal Operating System

A personal operating system is your repeatable way of working.

## 21.1 Before coding

Ask:

```text
What is the domain concept?
What is the invariant?
What are the failure modes?
What is the data boundary?
What is the API contract?
How will I test this?
How will I observe this?
How can it be rolled back?
```

## 21.2 During coding

Habits:

- write small commits;
- keep domain names explicit;
- avoid premature abstraction;
- add tests near behavior;
- keep error messages useful;
- avoid hidden side effects;
- use tools early;
- run tests locally;
- inspect dependency diff.

## 21.3 Before PR

Checklist:

- code formatted;
- tests passing;
- no unrelated changes;
- migration notes included;
- logs/metrics added if needed;
- API contract updated;
- docs/runbook updated if operational behavior changes;
- risk described.

## 21.4 During review

Ask:

- what invariant does this protect?
- what could fail?
- how do we know?
- what is the rollback?
- what is the evidence?

## 21.5 After release

Check:

- deployment health;
- error rate;
- latency;
- resource;
- logs;
- user impact;
- rollback readiness.

## 21.6 Weekly learning loop

Each week:

- read one JDK/JEP/framework doc;
- inspect one production dashboard;
- read one incident/postmortem;
- improve one test/standard/runbook;
- mentor one engineer;
- remove one small technical debt.

---

# 22. Roadmap Belajar Berkelanjutan

## 22.1 Track JDK evolution

Follow:

- OpenJDK JEPs;
- Java release notes;
- Inside Java;
- Oracle/OpenJDK docs;
- vendor JDK notes;
- framework compatibility matrix.

Focus on:

- language;
- JVM/runtime;
- GC;
- security;
- observability;
- tooling;
- deprecations/removals.

## 22.2 Track ecosystem

For backend Java:

- Spring Framework/Boot;
- Jakarta EE;
- Hibernate;
- Jackson;
- Netty/Tomcat/Jetty/Undertow;
- Kafka/RabbitMQ clients;
- Micrometer/OpenTelemetry;
- Testcontainers/JUnit/Mockito;
- Maven/Gradle.

## 22.3 Track security

Use:

- Oracle secure coding guidelines;
- OWASP ASVS;
- OWASP Top 10;
- SLSA;
- dependency vulnerability feeds;
- vendor security advisories.

## 22.4 Track operations

Learn:

- Kubernetes;
- Linux basics;
- networking;
- TLS;
- DNS;
- observability;
- incident response;
- capacity planning;
- chaos/failure testing.

## 22.5 Build labs

Skill grows from deliberate practice.

Recommended labs:

1. write mini DI container;
2. write state machine domain model;
3. write outbox pattern;
4. write bounded executor;
5. write JMH benchmark;
6. analyze JFR recording;
7. cause and fix memory leak;
8. migrate Java 8 app to 25;
9. build Kubernetes-ready service;
10. run incident game day.

---

# 23. Capstone Project: Production-Grade Java Service

## 23.1 Goal

Build a Java service that demonstrates mastery across all layers.

Project:

```text
regulatory-case-platform
```

## 23.2 Architecture

Components:

```text
case-command-service
case-query-service
case-worker
postgres
kafka
outbox-publisher
observability stack
```

## 23.3 Domain

Aggregate:

```text
EnforcementCase
```

Lifecycle:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
ESCALATED
RESOLVED
CLOSED
REJECTED
```

Commands:

- OpenCase;
- SubmitCase;
- AssignCase;
- EscalateCase;
- ResolveCase;
- CloseCase;
- RejectCase.

Events:

- CaseOpened;
- CaseSubmitted;
- CaseAssigned;
- CaseEscalated;
- CaseResolved;
- CaseClosed;
- CaseRejected.

## 23.4 Technical requirements

- Java 25;
- Spring Boot or Jakarta/Quarkus option;
- PostgreSQL;
- Kafka;
- outbox;
- idempotency;
- optimistic locking;
- Flyway/Liquibase;
- structured logging;
- Micrometer/OpenTelemetry;
- JFR profile script;
- Docker image;
- Kubernetes manifests;
- graceful shutdown;
- readiness/liveness/startup probes;
- HPA;
- Testcontainers;
- JMH benchmark for hot component.

## 23.5 Security requirements

- authentication boundary;
- authorization policy;
- input validation;
- no secret logging;
- TLS config documented;
- dependency scan;
- container scan;
- SBOM;
- audit trail.

## 23.6 Observability requirements

Dashboard:

- request rate;
- p50/p95/p99;
- error rate;
- JVM heap;
- GC pause;
- thread count;
- DB pool active/pending;
- Kafka lag;
- outbox backlog;
- pod restarts.

Logs:

- traceId;
- correlationId;
- caseId;
- commandId;
- actorId where allowed;
- stable event name.

Traces:

- HTTP request;
- application use case;
- DB operation;
- Kafka publish/consume.

## 23.7 Reliability requirements

- bounded retry;
- idempotency key;
- outbox;
- DLQ;
- timeout;
- backpressure;
- graceful worker shutdown;
- rollback strategy.

## 23.8 Deliverables

```text
README.md
ARCHITECTURE.md
ADR/
RUNBOOK.md
PRODUCTION_READINESS_REVIEW.md
SECURITY_REVIEW.md
PERFORMANCE_REPORT.md
MIGRATION_NOTES.md
docker/
k8s/
src/
tests/
benchmarks/
```

## 23.9 Evaluation

A capstone is complete when you can answer:

1. What are the invariants?
2. What is the aggregate boundary?
3. What is the transaction boundary?
4. What happens on duplicate command?
5. What happens if DB commit succeeds but Kafka publish fails?
6. What happens if pod receives SIGTERM mid-processing?
7. What happens if DB pool is exhausted?
8. What happens if p99 latency spikes?
9. What happens if event consumer receives duplicate/out-of-order event?
10. What happens if Java version upgrades?
11. What happens if dependency CVE appears?
12. What happens if rollout must be reverted?
13. What evidence exists for audit?
14. What telemetry proves system health?
15. What runbook should on-call follow?

---

# 24. Rubrik Evaluasi Diri

## 24.1 Level 1 — Syntax user

You can:

- write classes/methods;
- use collections;
- write basic REST endpoint;
- use framework by tutorial.

Gaps:

- weak JVM understanding;
- weak concurrency;
- weak production behavior;
- weak design reasoning.

## 24.2 Level 2 — Application developer

You can:

- build CRUD apps;
- write tests;
- use Spring/JPA;
- debug simple errors;
- deploy basic service.

Gaps:

- domain model often anemic;
- transaction/failure not deep;
- performance diagnosis limited;
- observability shallow.

## 24.3 Level 3 — Production engineer

You can:

- design transaction boundaries;
- handle idempotency;
- write meaningful tests;
- use metrics/logs/traces;
- diagnose GC/thread/DB issues;
- do safe deployments;
- migrate JDK/framework with plan.

Gaps:

- may still rely on senior for architecture trade-off;
- may not mentor systematically.

## 24.4 Level 4 — Senior/top-tier engineer

You can:

- model domain complexity clearly;
- lead design review;
- write ADRs;
- predict failure modes;
- design observability;
- tune JVM/container;
- lead incident analysis;
- create standards;
- mentor team;
- balance correctness, clarity, operability, evolvability.

## 24.5 Level 5 — Principal/platform-level

You can:

- set engineering direction across services;
- build reusable platform patterns;
- lead migration programs;
- define quality gates;
- reduce systemic risk;
- align architecture with business/regulatory needs;
- grow other senior engineers.

---

# 25. Checklist Final Java Mastery

## 25.1 Language

- [ ] Understand object model.
- [ ] Understand generics/erasure.
- [ ] Understand records/sealed/pattern matching.
- [ ] Understand exception model.
- [ ] Understand modules/access control.
- [ ] Understand annotations/processing/reflection.

## 25.2 JVM

- [ ] Understand class loading.
- [ ] Understand bytecode basics.
- [ ] Understand JIT/warmup/deopt.
- [ ] Understand heap/native memory.
- [ ] Understand GC choices.
- [ ] Can read GC logs/JFR.
- [ ] Can use `jcmd`.

## 25.3 Concurrency

- [ ] Understand JMM.
- [ ] Understand safe publication.
- [ ] Understand locks/atomics.
- [ ] Understand executors.
- [ ] Understand CompletableFuture.
- [ ] Understand virtual threads.
- [ ] Understand backpressure/cancellation.

## 25.4 Backend/domain

- [ ] Can model entity/value object/aggregate.
- [ ] Can define invariant/state machine.
- [ ] Can design command/event.
- [ ] Can define transaction boundary.
- [ ] Can implement outbox/idempotency.
- [ ] Can separate domain/application/infrastructure.

## 25.5 Testing

- [ ] Unit tests for domain.
- [ ] Integration tests with real dependencies.
- [ ] Contract tests.
- [ ] Concurrency/performance tests when needed.
- [ ] Mutation/property tests for critical logic.
- [ ] CI quality gates.

## 25.6 Security

- [ ] Secure coding basics.
- [ ] Input validation.
- [ ] TLS/cert handling.
- [ ] Crypto API safe usage.
- [ ] Secret management.
- [ ] Dependency/container scanning.
- [ ] Supply chain awareness.

## 25.7 Operations

- [ ] Docker/Kubernetes readiness.
- [ ] Resource sizing.
- [ ] Probe design.
- [ ] Graceful shutdown.
- [ ] Metrics/logs/traces.
- [ ] JFR diagnostics.
- [ ] Runbook/alerts.
- [ ] Rollback strategy.

## 25.8 Leadership

- [ ] ADR writing.
- [ ] Design review.
- [ ] Code review coaching.
- [ ] Technical debt management.
- [ ] Incident postmortem.
- [ ] Team standards.
- [ ] Mentoring.

---

# 26. Referensi Utama

Referensi yang relevan untuk capstone ini:

1. Oracle Java SE 25 Documentation  
   https://docs.oracle.com/en/java/javase/25/

2. Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools  
   https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html

3. Oracle Java SE 25 Troubleshooting Guide — Troubleshoot Performance Issues Using JFR  
   https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshoot-performance-issues-using-jfr.html

4. Oracle Secure Coding Guidelines for Java SE  
   https://www.oracle.com/java/technologies/javase/seccodeguide.html

5. Google Java Style Guide  
   https://google.github.io/styleguide/javaguide.html

6. OWASP Application Security Verification Standard  
   https://owasp.org/www-project-application-security-verification-standard/

7. SLSA — Supply-chain Levels for Software Artifacts  
   https://slsa.dev/

8. DORA Software Delivery Performance Metrics  
   https://dora.dev/guides/dora-metrics/

9. OpenTelemetry  
   https://opentelemetry.io/

10. Java Language Specification SE 25  
    https://docs.oracle.com/javase/specs/jls/se25/html/index.html

11. Java Virtual Machine Specification SE 25  
    https://docs.oracle.com/javase/specs/jvms/se25/html/index.html

12. Spring Framework Documentation  
    https://docs.spring.io/spring-framework/reference/

13. Spring Boot Reference Documentation  
    https://docs.spring.io/spring-boot/

14. Kubernetes Documentation  
    https://kubernetes.io/docs/home/

15. OpenJDK JEP Index  
    https://openjdk.org/jeps/0

---

# Penutup

Setelah 24 bagian, pola besarnya seharusnya jelas:

```text
Java mastery is not memorizing APIs.
Java mastery is the ability to build correct, observable, secure, evolvable systems on top of the Java platform.
```

Engineer Java yang kuat bisa turun ke detail:

```text
JMM, GC, bytecode, JFR, generics, proxy, transaction, serialization
```

tetapi juga bisa naik ke sistem:

```text
domain, API, data consistency, deployment, SLO, incident, migration, team standard
```

Itulah tujuan akhir dari seri ini: bukan membuat kamu “tahu Java”, tetapi membuat kamu mampu memakai Java sebagai alat engineering serius untuk membangun sistem production-grade yang bisa bertahan lama, mudah dijelaskan, aman dioperasikan, dan terus berevolusi.

Jika harus diringkas menjadi satu kalimat:

> Java top-tier engineering adalah disiplin membuat keputusan teknis yang benar, terukur, dapat dijelaskan, dapat dioperasikan, dan dapat diwariskan ke engineer berikutnya.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-023.md">⬅️ Bagian 23 — Migration: Java 8 → 11 → 17 → 21 → 25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../index.md">🏠 Home</a>
<a href="./learn-java-part-025.md">Bagian 25 — Production Case Studies dan Reference Architecture Playbook ➡️</a>
</div>
