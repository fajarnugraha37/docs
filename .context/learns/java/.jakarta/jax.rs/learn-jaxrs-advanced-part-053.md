# learn-jaxrs-advanced-part-053.md

# Bagian 053 — Refactoring Legacy JAX-RS API: Strangler Pattern, Endpoint Inventory, Compatibility Preservation, Error Contract Migration, javax→jakarta, DTO Extraction, Security Hardening, Test Harness, OpenAPI Recovery, and Incremental Rollout

> Target pembaca: Java/Jakarta engineer yang harus memperbaiki, memigrasikan, atau memodernisasi **legacy JAX-RS/Jakarta REST API** tanpa menghentikan bisnis. Fokus bagian ini bukan “rewrite total”, tetapi refactor bertahap: endpoint inventory, behavior capture, compatibility contract, strangler pattern, `javax.ws.rs` → `jakarta.ws.rs`, runtime upgrade, DTO extraction, error contract migration, security hardening, observability, test harness, OpenAPI recovery, database safety, rollout, and rollback.
>
> Prinsip utama:
>
> ```text
> Legacy API refactoring is not about making code prettier.
> It is about reducing risk while preserving external behavior and gradually improving internal design.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Legacy API sebagai Contract yang Sudah Dipakai](#2-mental-model-legacy-api-sebagai-contract-yang-sudah-dipakai)
3. [Rewrite vs Refactor vs Strangler](#3-rewrite-vs-refactor-vs-strangler)
4. [Kapan Jangan Rewrite](#4-kapan-jangan-rewrite)
5. [Refactoring Principles](#5-refactoring-principles)
6. [Discovery Phase](#6-discovery-phase)
7. [Endpoint Inventory](#7-endpoint-inventory)
8. [Consumer Inventory](#8-consumer-inventory)
9. [Behavior Inventory](#9-behavior-inventory)
10. [Compatibility Contract](#10-compatibility-contract)
11. [Characterization Tests](#11-characterization-tests)
12. [OpenAPI Recovery](#12-openapi-recovery)
13. [Traffic Shadowing and Capture](#13-traffic-shadowing-and-capture)
14. [Risk Classification](#14-risk-classification)
15. [Refactoring Roadmap](#15-refactoring-roadmap)
16. [Strangler Fig Pattern for APIs](#16-strangler-fig-pattern-for-apis)
17. [Facade / Anti-Corruption Layer](#17-facade--anti-corruption-layer)
18. [`javax.ws.rs` to `jakarta.ws.rs` Migration](#18-javaxwsrs-to-jakartawsrs-migration)
19. [Dependency Alignment](#19-dependency-alignment)
20. [Automated Migration Tools](#20-automated-migration-tools)
21. [Runtime Upgrade Strategy](#21-runtime-upgrade-strategy)
22. [Package and Module Refactoring](#22-package-and-module-refactoring)
23. [Resource Class Refactoring](#23-resource-class-refactoring)
24. [DTO Extraction from Entities](#24-dto-extraction-from-entities)
25. [Validation Migration](#25-validation-migration)
26. [Error Contract Migration](#26-error-contract-migration)
27. [ExceptionMapper Stabilization](#27-exceptionmapper-stabilization)
28. [Security Hardening](#28-security-hardening)
29. [Tenant and Object Authorization Retrofit](#29-tenant-and-object-authorization-retrofit)
30. [Persistence and Transaction Cleanup](#30-persistence-and-transaction-cleanup)
31. [Outbound Client Refactoring](#31-outbound-client-refactoring)
32. [Observability Retrofit](#32-observability-retrofit)
33. [Performance Guardrails](#33-performance-guardrails)
34. [Backward-Compatible Response Evolution](#34-backward-compatible-response-evolution)
35. [Deprecation and Sunset](#35-deprecation-and-sunset)
36. [Versioning During Refactor](#36-versioning-during-refactor)
37. [Database Migration Safety](#37-database-migration-safety)
38. [Rollout Strategy](#38-rollout-strategy)
39. [Rollback Strategy](#39-rollback-strategy)
40. [Governance and Code Review](#40-governance-and-code-review)
41. [Testing Strategy](#41-testing-strategy)
42. [CI/CD Gates](#42-cicd-gates)
43. [Example Refactor Plan](#43-example-refactor-plan)
44. [Common Failure Modes](#44-common-failure-modes)
45. [Best Practices](#45-best-practices)
46. [Anti-Patterns](#46-anti-patterns)
47. [Production Checklist](#47-production-checklist)
48. [Latihan](#48-latihan)
49. [Referensi Resmi](#49-referensi-resmi)
50. [Penutup](#50-penutup)

---

# 1. Tujuan Part Ini

Legacy JAX-RS API biasanya punya ciri:

```text
resource method 300 baris
JPA entity langsung jadi JSON
Map<String,Object> request/response
status code tidak konsisten
error shape campur-campur
security hanya role-level
tenant check manual dan tidak konsisten
javax.ws.rs masih dipakai
library lama tidak support Jakarta namespace
no OpenAPI
no test
no correlation ID
Response tidak ditutup di client
business logic ada di resource
DTO dan entity bercampur
```

Refactor API seperti ini berbahaya karena consumer sudah bergantung pada behavior lama.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membuat inventory endpoint dan consumer;
- menangkap existing behavior;
- membuat characterization tests;
- recover OpenAPI dari legacy API;
- memilih rewrite/refactor/strangler dengan sadar;
- migrasi `javax.ws.rs` ke `jakarta.ws.rs`;
- memisahkan DTO/entity/domain;
- menstabilkan error contract;
- memperkuat security tanpa mematahkan client;
- rollout perubahan bertahap dengan rollback aman.

---

# 2. Mental Model: Legacy API sebagai Contract yang Sudah Dipakai

Legacy API bukan hanya code.

Legacy API adalah kontrak yang sudah dipakai client.

Bahkan bug pun bisa menjadi contract jika client sudah bergantung padanya.

## 2.1 Example

Legacy endpoint:

```http
GET /users/123
```

Return:

```json
{
  "id": 123,
  "name": null,
  "roles": "ADMIN,USER"
}
```

Mungkin buruk, tapi client lama sudah parse `roles` sebagai comma string.

Jika kita ubah langsung menjadi:

```json
{
  "id": "123",
  "displayName": "",
  "roles": ["ADMIN", "USER"]
}
```

client bisa rusak.

## 2.2 Rule

Before changing legacy API, first learn what behavior consumers depend on.

---

# 3. Rewrite vs Refactor vs Strangler

## 3.1 Rewrite

Bangun ulang dari nol.

Pros:

- clean design;
- modern stack;
- remove old debt.

Cons:

- high risk;
- long feedback loop;
- behavior mismatch;
- migration complexity;
- “second system” danger.

## 3.2 Refactor in place

Ubah internal design sambil menjaga external behavior.

Pros:

- incremental;
- less migration;
- faster feedback.

Cons:

- constrained by old design;
- requires tests;
- may be messy temporarily.

## 3.3 Strangler

Gradually route some functionality to new implementation while old remains.

Pros:

- safer migration;
- visible progress;
- partial replacement.

Cons:

- temporary duplication;
- routing complexity;
- data synchronization.

## 3.4 Rule

Prefer incremental refactor/strangler unless rewrite risk is well-controlled and justified.

---

# 4. Kapan Jangan Rewrite

Jangan rewrite total jika:

- domain belum dipahami;
- tidak ada tests;
- consumer banyak dan tidak diketahui;
- behavior lama kompleks;
- deadline pendek;
- team belum menguasai replacement stack;
- data migration belum jelas;
- rollback sulit;
- old and new must run side by side lama.

## 4.1 Rule

Rewrite without behavior capture is gambling.

---

# 5. Refactoring Principles

## 5.1 Preserve external behavior first

Internal design boleh berubah, contract jangan berubah tanpa versioning/deprecation.

## 5.2 Add tests before change

Characterization first.

## 5.3 Slice vertically

Refactor endpoint/use case satu per satu.

## 5.4 Make small reversible changes

Avoid giant PR.

## 5.5 Improve boundaries

DTO, service, repository, mapper.

## 5.6 Observe rollout

Metrics/logs/traces.

## 5.7 Rule

Refactoring legacy API is risk management.

---

# 6. Discovery Phase

Discovery output:

```text
endpoint inventory
consumer inventory
auth model
data model
error model
traffic profile
dependency map
test coverage
runtime/dependency versions
migration blockers
```

## 6.1 Questions

```text
Endpoint mana paling sering dipakai?
Endpoint mana paling critical?
Consumer siapa?
Ada undocumented behavior?
Ada batch/partner integration?
Ada mobile app versi lama?
Ada downstream dependency?
Ada security incident history?
```

## 6.2 Rule

Do not refactor what you have not inventoried.

---

# 7. Endpoint Inventory

Create table:

| Method | Path | Resource Method | Statuses | Consumers | Risk | Notes |
|---|---|---|---|---|---|---|
| GET | `/applications/{id}` | `ApplicationResource#get` | 200/404/500 | UI, batch | High | returns entity |
| POST | `/applications/{id}/submit` | `submit` | 200/400 | UI | High | non-idempotent |
| GET | `/reports` | `listReports` | 200 | admin | Medium | no pagination |

## 7.1 Include

- method/path;
- request body;
- response shape;
- status codes;
- content types;
- auth requirements;
- side effects;
- traffic;
- owner.

## 7.2 Rule

Endpoint inventory is the map for refactor.

---

# 8. Consumer Inventory

Identify:

- frontend apps;
- mobile apps;
- internal services;
- partner systems;
- batch jobs;
- reports;
- SDKs;
- manual users/scripts.

## 8.1 Consumer risk

Some consumers cannot update quickly.

Examples:

- mobile apps;
- partner integrations;
- government/enterprise batch;
- installed on-prem clients.

## 8.2 Rule

Compatibility timeline depends on slowest important consumer.

---

# 9. Behavior Inventory

Capture real behavior:

- example requests;
- example responses;
- headers;
- status codes;
- error shapes;
- null handling;
- enum values;
- date format;
- pagination behavior;
- sorting default;
- auth failures;
- validation failures;
- weird edge cases.

## 9.1 Use traffic/logs

If safe and privacy-compliant, sample production traffic.

## 9.2 Rule

Behavior inventory prevents accidental breaking changes.

---

# 10. Compatibility Contract

Define what must remain stable.

## 10.1 Stable dimensions

- path;
- method;
- status code;
- field names;
- field types;
- date format;
- null vs missing;
- enum values;
- error code/shape;
- headers;
- pagination behavior.

## 10.2 Explicitly document bugs

Some bugs may be preserved temporarily.

```text
Legacy returns 200 with error payload for endpoint X.
Will preserve for v1; fix in v2.
```

## 10.3 Rule

Compatibility contract must be written before refactor.

---

# 11. Characterization Tests

Characterization tests lock current behavior.

## 11.1 Example

```java
@Test
void legacyGetApplicationShape() {
    given()
      .auth().oauth2(token)
    .when()
      .get("/applications/APP-1")
    .then()
      .statusCode(200)
      .body("id", equalTo("APP-1"))
      .body("status", equalTo("SUBMITTED"))
      .body("createdDate", matchesPattern("\\d{2}/\\d{2}/\\d{4}"));
}
```

## 11.2 Purpose

Not to prove behavior is good.

To prove refactor did not accidentally change behavior.

## 11.3 Rule

Characterization tests are safety net for legacy behavior.

---

# 12. OpenAPI Recovery

Legacy APIs often lack docs.

Recover by:

- reading resource annotations;
- sampling traffic;
- inspecting frontend/client code;
- generating from runtime if supported;
- writing OpenAPI manually;
- validating against actual responses.

## 12.1 Start incomplete

Document high-risk endpoints first.

## 12.2 Rule

Recovered OpenAPI is living contract, not perfect first draft.

---

# 13. Traffic Shadowing and Capture

For high-risk refactor, compare old/new implementation.

## 13.1 Shadow mode

Production request goes to old system.

Copy goes to new system.

Compare response internally.

## 13.2 Caution

Do not duplicate side effects.

Only safe for reads or sanitized replay.

## 13.3 Rule

Shadowing is powerful but dangerous for writes.

---

# 14. Risk Classification

Classify endpoints:

## 14.1 Low risk

- low traffic;
- internal only;
- read-only;
- few consumers;
- tests exist.

## 14.2 High risk

- high traffic;
- public/partner;
- write/side effects;
- security sensitive;
- no tests;
- complex response;
- mobile consumers.

## 14.3 Rule

Refactor low-risk/high-value slices first to build confidence.

---

# 15. Refactoring Roadmap

Example phases:

```text
Phase 0: Inventory and tests
Phase 1: Observability and error wrapper
Phase 2: DTO extraction
Phase 3: service layer extraction
Phase 4: security/tenant hardening
Phase 5: javax→jakarta/runtime migration
Phase 6: endpoint redesign/versioning
Phase 7: deprecate old behavior
```

## 15.1 Rule

Plan reversible phases with measurable exit criteria.

---

# 16. Strangler Fig Pattern for APIs

Strangler pattern gradually replaces parts of legacy system.

## 16.1 API strangler

Gateway routes some paths to new implementation:

```text
/applications/{id} → legacy
/applications/{id}/timeline → new
/v2/applications → new
```

## 16.2 Internal strangler

Same service routes use case to new module.

```java
if (featureFlag.enabled("new-submit")) {
    return newSubmitHandler.submit(...);
}
return legacySubmitHandler.submit(...);
```

## 16.3 Rule

Strangler migration needs routing, observability, and rollback.

---

# 17. Facade / Anti-Corruption Layer

Put facade in front of legacy.

```text
JAX-RS Resource
  → ApplicationFacade
    → LegacyServiceAdapter
    → NewDomainService
```

## 17.1 Benefit

Resource does not know old internals.

New code uses clean contract.

## 17.2 Rule

Anti-corruption layer prevents legacy model from infecting new design.

---

# 18. `javax.ws.rs` to `jakarta.ws.rs` Migration

Jakarta EE 9 changed namespace from `javax.*` to `jakarta.*`.

For JAX-RS:

```java
javax.ws.rs.GET
```

becomes:

```java
jakarta.ws.rs.GET
```

## 18.1 Not only imports

Also check:

- dependencies;
- generated sources;
- config files;
- reflection strings;
- deployment descriptors;
- XML;
- OpenAPI/generated clients;
- tests;
- third-party libraries;
- app server/runtime.

## 18.2 Rule

Namespace migration is ecosystem migration, not search-and-replace only.

---

# 19. Dependency Alignment

Align:

- Jakarta REST API version;
- CDI;
- Validation;
- JSON-B/JSON-P/Jackson provider;
- Servlet;
- Persistence;
- Transactions;
- Security;
- MicroProfile;
- runtime/app server.

## 19.1 Mixed dependencies

`javax.*` dependency in Jakarta runtime can break.

## 19.2 Rule

Use dependency tree and ban mixed namespace artifacts.

---

# 20. Automated Migration Tools

Tools can help:

- OpenRewrite recipes;
- Eclipse Transformer;
- IDE migration tools;
- build plugin transformations.

## 20.1 OpenRewrite

Useful for source code/package migration and broader Java/Jakarta recipes.

## 20.2 Eclipse Transformer

Can transform artifacts/resources for Jakarta namespace in some scenarios.

## 20.3 Rule

Automated tools accelerate migration but do not replace tests and dependency review.

---

# 21. Runtime Upgrade Strategy

Upgrade path:

```text
old runtime
  ↓
latest patch old line
  ↓
Jakarta-compatible runtime
  ↓
new major runtime
```

## 21.1 Avoid too many changes at once

Do not combine:

- Java upgrade;
- runtime upgrade;
- namespace migration;
- database migration;
- API redesign;

unless unavoidable.

## 21.2 Rule

Separate mechanical migration from behavioral refactor.

---

# 22. Package and Module Refactoring

Legacy package may be:

```text
resource
service
dao
model
util
```

Refactor toward:

```text
api
application
domain
infrastructure
```

## 22.1 Incremental

Do not move everything at once.

Move per vertical slice.

## 22.2 Rule

Package refactor should follow architecture, not aesthetic sorting.

---

# 23. Resource Class Refactoring

Legacy resource:

```java
@Path("/applications")
public class ApplicationResource {
    @PersistenceContext EntityManager em;

    @POST
    @Path("/{id}/submit")
    public Response submit(String body) {
        // parse JSON manually
        // query DB
        // business rules
        // external call
        // build string response
    }
}
```

Refactor:

```text
Resource
  → Request DTO
  → ApplicationService
  → Domain Policy
  → Repository
  → Mapper
```

## 23.1 Rule

Move business logic out of resource one use case at a time.

---

# 24. DTO Extraction from Entities

## 24.1 Legacy

```java
@GET
public ApplicationEntity get(...) {
    return entityManager.find(ApplicationEntity.class, id);
}
```

## 24.2 Risk

- lazy loading;
- data leak;
- circular reference;
- entity changes break API;
- field-level auth impossible.

## 24.3 Refactor

```java
ApplicationResponse response = mapper.toResponse(domain, actor);
```

## 24.4 Rule

DTO extraction is usually one of the highest-value refactors.

---

# 25. Validation Migration

Legacy validation may be manual/inconsistent.

## 25.1 Add DTO validation

```java
public record CreateApplicationRequest(
    @NotBlank String licenseType,
    @Valid ApplicantRequest applicant
) {}
```

## 25.2 Keep compatibility

If old endpoint accepted weird input, decide:

- preserve in v1;
- warn/deprecate;
- tighten in v2;
- feature flag strict mode.

## 25.3 Rule

Tightening validation can be breaking change.

---

# 26. Error Contract Migration

Legacy errors often inconsistent.

## 26.1 Strategy

Phase 1: wrap unexpected errors safely.

Phase 2: introduce Problem Details for new endpoints.

Phase 3: add opt-in Problem Details for old endpoints via `Accept`.

Phase 4: migrate v2 to Problem Details.

## 26.2 Compatibility

If old clients parse `message`, keep it temporarily.

## 26.3 Rule

Error shape migration must be versioned or negotiated.

---

# 27. ExceptionMapper Stabilization

Add safe mappers:

- validation;
- domain;
- security;
- persistence;
- downstream;
- catch-all.

## 27.1 Risk

Catch-all mapper can change legacy errors.

Apply carefully with characterization tests.

## 27.2 Rule

Introduce mappers with tests for all high-risk endpoints.

---

# 28. Security Hardening

Legacy security gaps:

- no auth on some endpoints;
- role-only;
- tenant checks missing;
- direct object ID access;
- CORS wildcard;
- token logged;
- file upload unsafe.

## 28.1 Hardening strategy

- inventory current auth behavior;
- add observability first;
- add route-level auth;
- add object-level checks;
- add tenant-safe repositories;
- add tests;
- rollout in monitor/block phases if needed.

## 28.2 Rule

Security hardening can break clients; communicate and test.

---

# 29. Tenant and Object Authorization Retrofit

## 29.1 Add CurrentActor

Map token/session to actor.

## 29.2 Add tenant-aware methods

```java
findByTenantAndId(tenantId, id)
```

## 29.3 Ban unsafe methods

Architecture tests.

## 29.4 Rule

BOLA fix requires repository and service design, not only filters.

---

# 30. Persistence and Transaction Cleanup

Legacy issues:

- transaction in resource;
- long transaction;
- external call inside transaction;
- lazy loading in serialization;
- no optimistic lock;
- no migration test.

## 30.1 Refactor

- application service owns transaction;
- repositories isolate persistence;
- DTO mapping inside transaction if needed;
- ETag/version for mutable resources.

## 30.2 Rule

Transaction boundary should be use-case boundary, not accidental resource method body.

---

# 31. Outbound Client Refactoring

Legacy outbound:

```java
ClientBuilder.newClient().target(url).request().get()
```

inside resource.

Refactor:

```text
CustomerGateway
  → configured client
  → timeout
  → error decoder
  → resilience policy
```

## 31.1 Rule

Outbound dependency should be behind gateway/adapter.

---

# 32. Observability Retrofit

Add early:

- correlation ID;
- structured access logs;
- route metrics;
- error code metrics;
- downstream metrics;
- tracing.

## 32.1 Why early

Refactor without telemetry is blind.

## 32.2 Rule

Observability is refactoring safety equipment.

---

# 33. Performance Guardrails

Refactor can change performance.

Guard:

- baseline p95/p99;
- DB query count;
- response size;
- memory allocation;
- startup time;
- downstream call count.

## 33.1 Rule

Compatibility includes performance expectations for critical endpoints.

---

# 34. Backward-Compatible Response Evolution

Safe changes usually:

- add optional response field;
- add link;
- add new endpoint;
- add optional query param;
- add new error code only for new behavior.

Breaking:

- remove field;
- rename field;
- change type;
- change null/missing semantics;
- change status code;
- change date format.

## 34.1 Rule

Legacy clients depend on response quirks.

---

# 35. Deprecation and Sunset

Use headers/policy:

```http
Deprecation: true
Sunset: Tue, 31 Dec 2027 23:59:59 GMT
Link: <https://api.example.com/docs/migration>; rel="deprecation"
```

## 35.1 Rule

Do not remove old behavior without deprecation window and migration path.

---

# 36. Versioning During Refactor

Options:

- keep v1 compatible;
- introduce v2 for breaking fixes;
- media type versioning;
- header versioning;
- gateway route version.

## 36.1 Rule

Use v2 when correctness/security improvements cannot be made compatibly.

---

# 37. Database Migration Safety

Use expand-contract:

## 37.1 Expand

Add new nullable column/table/index.

Deploy code writing both old and new.

## 37.2 Migrate

Backfill.

Verify.

## 37.3 Contract

Remove old after consumers/code migrated.

## 37.4 Rule

Database migration and API rollout must be coordinated.

---

# 38. Rollout Strategy

## 38.1 Feature flag

Enable per endpoint/tenant/user.

## 38.2 Canary

Small traffic percentage.

## 38.3 Shadow

Compare old/new read behavior.

## 38.4 Blue-green

Switch whole deployment.

## 38.5 Rule

Rollout plan should include observability and rollback trigger.

---

# 39. Rollback Strategy

Before rollout, define:

- what can be rolled back;
- database backward compatibility;
- feature flag off switch;
- cache invalidation;
- consumer impact;
- data repair if side effects occurred.

## 39.1 Rule

If you cannot rollback, rollout slower.

---

# 40. Governance and Code Review

Review checklist:

- contract compatibility;
- tests updated;
- OpenAPI diff reviewed;
- security impact;
- tenant safety;
- error shape;
- performance impact;
- migration/rollback plan.

## 40.1 Rule

Legacy refactor PRs need contract review, not only code review.

---

# 41. Testing Strategy

## 41.1 Characterization

Lock old behavior.

## 41.2 Unit

New domain/policies/mappers.

## 41.3 Integration

Resource, persistence, mappers.

## 41.4 Contract

OpenAPI and response examples.

## 41.5 Security

BOLA/tenant/auth.

## 41.6 Regression

Performance and high-risk workflows.

## 41.7 Rule

Tests are the bridge between old behavior and new design.

---

# 42. CI/CD Gates

Add gates gradually:

- compile;
- unit tests;
- characterization tests;
- integration tests;
- OpenAPI diff;
- dependency scan;
- namespace mixed dependency check;
- security tests;
- performance smoke.

## 42.1 Rule

CI is how refactor becomes safe repeatable process.

---

# 43. Example Refactor Plan

## 43.1 Legacy situation

```text
GET /applications/{id}
POST /applications/{id}/submit
returns JPA entity
manual JSON
no tests
javax.ws.rs
role-only auth
```

## 43.2 Plan

Phase 0:

- inventory;
- add characterization tests;
- add access logs/correlation.

Phase 1:

- extract DTO response;
- keep same JSON shape;
- add mapper tests.

Phase 2:

- extract service layer;
- move business rules from resource.

Phase 3:

- add tenant-aware repository;
- BOLA tests.

Phase 4:

- add Problem Details for v2 / opt-in.

Phase 5:

- migrate `javax` to `jakarta`;
- upgrade runtime.

Phase 6:

- introduce `/v2/applications/{id}/submission`;
- deprecate old `/submit`.

## 43.3 Rule

Refactor by safe vertical slices.

---

# 44. Common Failure Modes

## 44.1 No behavior capture

Unexpected client break.

## 44.2 Rewrite too big

Never finishes.

## 44.3 Namespace migration mixed with redesign

Hard to debug.

## 44.4 DTO extraction changes JSON shape

Breaking.

## 44.5 Catch-all mapper changes every error

Breaking.

## 44.6 Security hardening without communication

Consumer outage.

## 44.7 OpenAPI generated but not validated

False docs.

## 44.8 Tests only new behavior

Old compatibility lost.

## 44.9 DB migration not rollback-safe

Deployment trap.

## 44.10 No observability

Canary blind.

---

# 45. Best Practices

## 45.1 Inventory first

Know surface area.

## 45.2 Characterize behavior

Tests before change.

## 45.3 Separate mechanical and semantic changes

Namespace/runtime migration separate from API redesign.

## 45.4 Preserve v1

Create v2 for breaking fixes.

## 45.5 Extract DTOs

High-value boundary.

## 45.6 Add service layer

Move business logic out of resource.

## 45.7 Harden security with tests

BOLA/tenant.

## 45.8 Add observability early

See impact.

## 45.9 Rollout gradually

Feature flags/canary.

## 45.10 Govern API changes

OpenAPI diff + review.

---

# 46. Anti-Patterns

## 46.1 “Just clean it up”

No acceptance criteria.

## 46.2 “Nobody uses this endpoint”

Without evidence.

## 46.3 “We can change error response”

Clients may parse it.

## 46.4 “Use automated javax→jakarta then done”

Incomplete.

## 46.5 “Expose new entity because simpler”

Repeats old mistake.

## 46.6 “One giant PR”

Unreviewable.

## 46.7 “Security fix without migration path”

May be necessary for critical vuln, but plan communication.

## 46.8 “Delete old version immediately”

Consumer break.

## 46.9 “No rollback needed”

Danger.

## 46.10 “Test only happy path”

Legacy bugs live in edges.

---

# 47. Production Checklist

## 47.1 Discovery

- [ ] Endpoint inventory.
- [ ] Consumer inventory.
- [ ] Behavior inventory.
- [ ] Traffic profile.
- [ ] Dependency/runtime inventory.
- [ ] Risk classification.

## 47.2 Safety net

- [ ] Characterization tests.
- [ ] OpenAPI recovered.
- [ ] Access logs/correlation.
- [ ] Error/latency metrics.
- [ ] Rollback plan.

## 47.3 Refactor

- [ ] DTO extracted.
- [ ] Service layer extracted.
- [ ] Domain policies.
- [ ] Tenant-aware repository.
- [ ] Error contract plan.
- [ ] Outbound clients wrapped.
- [ ] Transaction boundaries clarified.

## 47.4 Migration

- [ ] `javax`/`jakarta` dependencies aligned.
- [ ] Automated migration reviewed.
- [ ] Runtime upgraded separately.
- [ ] Third-party compatibility checked.
- [ ] OpenAPI diff reviewed.
- [ ] Canary/feature flag.
- [ ] Deprecation/sunset communication.

---

# 48. Latihan

## Latihan 1 — Endpoint Inventory

Ambil legacy project.

Buat inventory 20 endpoint paling penting.

Tambahkan consumer, risk, response shape, auth.

## Latihan 2 — Characterization Test

Pilih satu endpoint high risk.

Tulis test untuk status, headers, JSON shape, error shape.

## Latihan 3 — DTO Extraction

Refactor endpoint yang return entity menjadi DTO tanpa mengubah JSON external shape.

## Latihan 4 — Error Migration

Tambahkan Problem Details untuk v2 endpoint.

v1 tetap kompatibel.

## Latihan 5 — javax→jakarta Dry Run

Jalankan OpenRewrite/Eclipse Transformer di branch.

Catat semua dependency yang masih `javax`.

## Latihan 6 — BOLA Retrofit

Tambah tenant-aware repository untuk endpoint object access.

Test cross-tenant access.

## Latihan 7 — Strangler Route

Desain gateway routing untuk memindahkan satu endpoint dari legacy ke new implementation.

## Latihan 8 — OpenAPI Recovery

Buat OpenAPI manual dari endpoint inventory dan characterization tests.

## Latihan 9 — Canary Plan

Tentukan metrics, alert, rollback trigger untuk rollout endpoint refactor.

---

# 49. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services  
   https://jakarta.ee/specifications/restful-ws/

2. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

3. OpenRewrite — Javax Migration to Jakarta  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta

4. OpenRewrite — Jakarta Recipes  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta

5. Eclipse Transformer Project  
   https://projects.eclipse.org/projects/technology.transformer

6. Martin Fowler — Strangler Fig Application  
   https://martinfowler.com/bliki/StranglerFigApplication.html

7. Microsoft Azure Architecture Center — Strangler Fig Pattern  
   https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig

8. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

9. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

---

# 50. Penutup

Refactoring legacy JAX-RS API adalah pekerjaan engineering yang menuntut empati terhadap consumer, disiplin terhadap compatibility, dan keberanian memperbaiki boundary secara bertahap.

Mental model final:

```text
inventory
  ↓
characterization tests
  ↓
compatibility contract
  ↓
observability
  ↓
small vertical refactor
  ↓
safe rollout
  ↓
deprecate old behavior
```

Prinsip final:

```text
Do not rewrite blindly.
Capture behavior before changing.
Separate mechanical migration from redesign.
Preserve v1 compatibility.
Use v2 for breaking improvements.
Add DTO/service/policy boundaries gradually.
Harden security with tests.
Observe rollout.
Plan rollback.
```

Top-tier JAX-RS engineer memastikan:

- legacy behavior dipahami sebelum diubah;
- setiap refactor punya safety net;
- `javax`→`jakarta` dilakukan dengan dependency/runtime alignment;
- DTO dan service layer diekstrak tanpa mematahkan contract;
- error/security/tenant hardening dilakukan dengan governance;
- rollout incremental dan observable;
- refactor mengurangi risiko, bukan menambah risiko tersembunyi.

Part berikutnya:

```text
Bagian 054 — Capstone: Top 1% JAX-RS Reference Architecture
```

Kita akan menutup seri dengan reference architecture komprehensif: resource design, domain model, API gateway, security, tenancy, persistence, outbox/events, clients, resilience, observability, testing, CI/CD, deployment, and operational excellence.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-052.md](./learn-jaxrs-advanced-part-052.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-054.md](./learn-jaxrs-advanced-part-054.md)
