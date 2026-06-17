# learn-java-collections-and-streams-part-052.md

# Java Collections and Streams — Part 052  
# Collections and Security: Mutability Leaks, Data Exposure, Authorization Filtering, Mass Assignment, DoS via Large Collections, Injection Surfaces, Deserialization Risks, and Secure Collection API Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **052**  
> Fokus: memahami bagaimana Collections dan Streams dapat menjadi sumber security bugs. Kita akan membahas mutable exposure, defensive copy, authorization filtering, multi-tenant data leaks, insecure batch APIs, mass assignment, over-posting, unbounded collections, algorithmic complexity attacks, `HashMap`/hash collision considerations, deserialization risks, logging leaks, stream side effects, parallelism, and secure API boundaries.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Collection Security = Boundary + Ownership + Visibility](#2-mental-model-collection-security--boundary--ownership--visibility)
3. [Threat Model untuk Collections](#3-threat-model-untuk-collections)
4. [Mutability Leak](#4-mutability-leak)
5. [Defensive Copying as Security Boundary](#5-defensive-copying-as-security-boundary)
6. [Unmodifiable Is Not Deeply Immutable](#6-unmodifiable-is-not-deeply-immutable)
7. [Null and Validation Security](#7-null-and-validation-security)
8. [Mass Assignment and Over-Posting](#8-mass-assignment-and-over-posting)
9. [Batch API Abuse](#9-batch-api-abuse)
10. [Unbounded Collection DoS](#10-unbounded-collection-dos)
11. [Algorithmic Complexity Attacks](#11-algorithmic-complexity-attacks)
12. [Duplicate and Idempotency Attacks](#12-duplicate-and-idempotency-attacks)
13. [Authorization Filtering](#13-authorization-filtering)
14. [Filter-After-Fetch Data Leaks](#14-filter-after-fetch-data-leaks)
15. [Multi-Tenant Collection Leaks](#15-multi-tenant-collection-leaks)
16. [Pagination and Security](#16-pagination-and-security)
17. [Sorting and Security](#17-sorting-and-security)
18. [Map Key Injection Surfaces](#18-map-key-injection-surfaces)
19. [Collection-Based Injection Patterns](#19-collection-based-injection-patterns)
20. [Insecure Deserialization and Collections](#20-insecure-deserialization-and-collections)
21. [Sensitive Data in Collections](#21-sensitive-data-in-collections)
22. [Logging Collections Safely](#22-logging-collections-safely)
23. [Streams and Side-Effect Security](#23-streams-and-side-effect-security)
24. [Parallel Streams and Security Context](#24-parallel-streams-and-security-context)
25. [Lazy Streams and Security Context Drift](#25-lazy-streams-and-security-context-drift)
26. [Resource Exhaustion via Resource-Backed Streams](#26-resource-exhaustion-via-resource-backed-streams)
27. [Secure Collectors](#27-secure-collectors)
28. [Secure DTO Mapping](#28-secure-dto-mapping)
29. [Secure Repository Querying](#29-secure-repository-querying)
30. [Least-Privilege Collection Design](#30-least-privilege-collection-design)
31. [Validation and Normalization Pipeline](#31-validation-and-normalization-pipeline)
32. [Security Testing for Collections](#32-security-testing-for-collections)
33. [Observability and Abuse Detection](#33-observability-and-abuse-detection)
34. [Common Anti-Patterns](#34-common-anti-patterns)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Collections terlihat seperti struktur data biasa:

```java
List<User>
Set<Role>
Map<String, Object>
Stream<Order>
```

Tetapi dalam sistem production, collection sering berada di security boundary:

- request body berisi list command;
- response berisi list data sensitive;
- user punya set roles/permissions;
- repository query mengembalikan collection tenant data;
- map berisi dynamic fields;
- batch API menerima ratusan/ribuan item;
- stream memproses file upload;
- collector menggabungkan data dari banyak source.

Bug kecil pada collection dapat menjadi vulnerability.

Contoh:

```java
class User {
    private final Set<Role> roles = new HashSet<>();

    public Set<Role> roles() {
        return roles;
    }
}
```

Caller dapat:

```java
user.roles().add(Role.ADMIN);
```

Jika object ini dipakai sebagai security principal, ini privilege escalation via mutability leak.

Contoh lain:

```java
orders.stream()
    .filter(order -> canRead(currentUser, order))
    .toList();
```

Jika data sudah di-fetch lintas tenant sebelum filter, query/log/cache/side-channel masih bisa leak.

Tujuan bagian ini:

- melihat collections sebagai security boundary;
- memahami mutability/data exposure risks;
- mendesain authorization filtering yang aman;
- mencegah DoS dari unbounded collections;
- mencegah mass assignment/batch abuse;
- memahami stream/lazy/parallel security risks;
- membuat checklist secure collection API design.

---

# 2. Mental Model: Collection Security = Boundary + Ownership + Visibility

Security collection design bertanya:

```text
Siapa yang boleh melihat element?
Siapa yang boleh mengubah collection?
Siapa pemilik collection?
Berapa besar collection boleh masuk/keluar?
Apakah semua element sudah divalidasi?
Apakah collection bisa mengandung data lintas tenant?
Apakah order/metadata bisa membocorkan informasi?
Apakah lazy traversal terjadi di security context yang benar?
```

## 2.1 Three axes

### Boundary

Di mana data masuk/keluar sistem?

### Ownership

Siapa boleh mutate?

### Visibility

Siapa boleh melihat element?

## 2.2 Main rule

```text
A collection crossing a boundary must have explicit validation,
authorization, size, mutability, and visibility contracts.
```

---

# 3. Threat Model untuk Collections

Potential threats:

## 3.1 Unauthorized mutation

Mutable collection getter lets caller modify roles/permissions/state.

## 3.2 Data exposure

Collection response includes fields/items caller should not see.

## 3.3 DoS

Request list/map too large.

## 3.4 Injection

Collection values become SQL/LDAP/JSONPath/template/query fragments.

## 3.5 Mass assignment

Client sends fields/roles/statuses not allowed.

## 3.6 Tenant leak

Query returns data from other tenant then filters too late.

## 3.7 Resource leak

Unclosed streams/files/cursors.

## 3.8 Side effect duplication

Duplicate batch commands processed repeatedly.

## 3.9 Rule

Security review must include how collections are accepted, transformed, stored, and returned.

---

# 4. Mutability Leak

Mutability leak happens when caller gets reference to internal mutable collection.

Bad:

```java
class Account {
    private final Set<Permission> permissions = new HashSet<>();

    Set<Permission> permissions() {
        return permissions;
    }
}
```

External code can mutate:

```java
account.permissions().add(Permission.TRANSFER_FUNDS);
```

## 4.1 Security impact

- privilege escalation;
- bypass validation;
- bypass audit;
- corrupt domain invariants;
- inconsistent cache/session state.

## 4.2 Fix

```java
Set<Permission> permissions() {
    return Set.copyOf(permissions);
}
```

Better:

```java
boolean hasPermission(Permission permission) {
    return permissions.contains(permission);
}
```

## 4.3 Rule

Never expose mutable security-relevant collections.

---

# 5. Defensive Copying as Security Boundary

Defensive copy protects structure from external mutation.

## 5.1 Input

```java
UserPrincipal(UserId id, Collection<Role> roles) {
    this.id = Objects.requireNonNull(id);
    this.roles = Set.copyOf(roles);
}
```

## 5.2 Output

```java
Set<Role> roles() {
    return Set.copyOf(roles);
}
```

## 5.3 Benefit

Caller cannot mutate principal roles after construction.

## 5.4 Rule

Security-sensitive objects should defensively copy collection inputs and outputs.

---

# 6. Unmodifiable Is Not Deeply Immutable

```java
List<UserDto> users = List.copyOf(source);
```

The list structure is unmodifiable, but elements may still be mutable.

## 6.1 Example

```java
List<MutableUser> snapshot = List.copyOf(users);
snapshot.get(0).setRole(Role.ADMIN);
```

## 6.2 Fix

Use immutable elements:

```java
record UserDto(UserId id, String name, Set<Role> roles) {
    UserDto {
        roles = Set.copyOf(roles);
    }
}
```

## 6.3 Rule

For security boundaries, immutable collection plus immutable elements is the target.

---

# 7. Null and Validation Security

Nulls can bypass validation.

Bad:

```java
if (roles.contains(Role.ADMIN)) {
    requireAdminGrantPermission();
}
user.setRoles(roles);
```

If roles contains null or malformed values, downstream code may fail open.

## 7.1 Reject null elements

```java
roles.forEach(role -> Objects.requireNonNull(role, "role"));
```

## 7.2 Validate allowed values

```java
if (!allowedRoles.contains(role)) {
    throw new ForbiddenRoleException(role);
}
```

## 7.3 Rule

Validate collection itself and every element.

---

# 8. Mass Assignment and Over-Posting

Mass assignment happens when client can set fields not intended.

Example request:

```json
{
  "name": "Alice",
  "roles": ["ADMIN"],
  "status": "ACTIVE"
}
```

If create-user endpoint blindly maps to entity:

```java
mapper.updateEntity(request, user);
```

client may grant admin or activate account.

## 8.1 Collection-specific risk

Collections like roles, permissions, scopes, feature flags are sensitive.

## 8.2 Fix

Use command DTO with only allowed fields.

```java
record CreateUserCommand(String name, String email) {}
```

Admin role assignment separate operation.

## 8.3 Rule

Never bind arbitrary client-provided collections directly into privileged domain fields.

---

# 9. Batch API Abuse

Batch APIs amplify impact.

Example:

```json
{
  "commands": [ ... 100000 items ... ]
}
```

## 9.1 Risks

- CPU/memory DoS;
- database write storm;
- lock contention;
- duplicate side effects;
- rate-limit bypass;
- partial failure complexity.

## 9.2 Controls

- max batch size;
- per-item validation;
- per-user rate limit;
- idempotency keys;
- authorization per item;
- transaction strategy;
- backpressure/queueing.

## 9.3 Rule

Batch collection APIs need explicit abuse controls.

---

# 10. Unbounded Collection DoS

Unbounded collection input is an attack surface.

Bad:

```java
void importUsers(List<UserImportRow> rows)
```

with no max size.

## 10.1 Attack

Client sends huge JSON array.

Effects:

- memory pressure;
- GC overhead;
- DB overload;
- slow validation;
- request thread starvation.

## 10.2 Fix

Define max size:

```java
static final int MAX_ROWS = 1000;

if (rows.size() > MAX_ROWS) {
    throw new PayloadTooLargeException();
}
```

Also enforce at HTTP/body parser/gateway level.

## 10.3 Rule

Every externally supplied collection needs size limits.

---

# 11. Algorithmic Complexity Attacks

Some operations can become expensive with adversarial input.

## 11.1 Nested contains

Bad:

```java
for (String id : requestedIds) {
    if (!allowedIds.contains(id)) { ... } // allowedIds is List
}
```

If both large:

```text
O(n*m)
```

## 11.2 Fix

```java
Set<String> allowed = Set.copyOf(allowedIds);
for (String id : requestedIds) {
    if (!allowed.contains(id)) { ... }
}
```

## 11.3 Sorting expensive comparator

Comparator doing DB/API calls can be abused.

## 11.4 Rule

Review collection algorithms for adversarial input size and complexity.

---

# 12. Duplicate and Idempotency Attacks

Duplicate items can cause repeated side effects.

Example:

```json
{
  "transfers": [
    {"id": "t1", "amount": 100},
    {"id": "t1", "amount": 100}
  ]
}
```

If processed twice, money transfer duplicate.

## 12.1 Fix

- reject duplicate client IDs;
- idempotency table;
- unique constraints;
- exactly-once semantics at business layer.

## 12.2 Rule

Mutating batch operations must define duplicate/idempotency policy.

---

# 13. Authorization Filtering

Authorization filter decides which elements caller may access.

Bad if done too late:

```java
List<Document> docs = repository.findAll();
return docs.stream()
    .filter(doc -> canRead(user, doc))
    .toList();
```

## 13.1 Better

Push authorization to query:

```java
repository.findReadableDocuments(user.id(), user.tenantId(), permissions)
```

## 13.2 Defense in depth

Still check in service if needed, but query must not retrieve unbounded unauthorized data.

## 13.3 Rule

Authorization should be part of data access predicate, not only post-fetch filter.

---

# 14. Filter-After-Fetch Data Leaks

Even if response filters unauthorized data, fetched data can leak via:

- logs;
- cache;
- metrics;
- exceptions;
- timing;
- memory dump;
- debug endpoints;
- object graph serialization;
- audit side effects.

## 14.1 Example

Fetching all tenant data then filtering one tenant is dangerous.

## 14.2 Rule

Do not fetch what caller is not authorized to access.

---

# 15. Multi-Tenant Collection Leaks

Tenant isolation must be enforced in queries.

Bad:

```java
List<Order> orders = orderRepository.findByStatus(status);
```

then:

```java
orders.stream()
    .filter(order -> order.tenantId().equals(currentTenant))
```

Better:

```java
findByTenantIdAndStatus(currentTenant, status)
```

## 15.1 Rule

Tenant predicate belongs in repository/database query.

---

# 16. Pagination and Security

Pagination can leak information.

## 16.1 Total count leak

```json
{
  "total": 923847
}
```

may reveal how many records exist.

## 16.2 Cursor tampering

Cursor should be opaque and signed/encrypted if it carries state.

## 16.3 Authorization per page

Each page must enforce same auth filters.

## 16.4 Rule

Pagination metadata can be sensitive; design it intentionally.

---

# 17. Sorting and Security

User-provided sort fields can become injection or information leak.

Bad:

```java
String sort = request.getSort();
query.append(" order by ").append(sort);
```

## 17.1 Fix whitelist

```java
Map<String, SortSpec> allowedSorts = Map.of(
    "createdAt", SortSpec.CREATED_AT,
    "name", SortSpec.NAME
);
```

## 17.2 Rule

Sort/filter collection parameters must be whitelisted, not concatenated.

---

# 18. Map Key Injection Surfaces

Dynamic maps can carry arbitrary keys.

Example:

```json
{
  "filters": {
    "name; drop table": "x"
  }
}
```

## 18.1 Risks

- SQL injection if keys become column names;
- template injection;
- JSON path injection;
- unexpected field override;
- prototype pollution in JS ecosystems;
- logging/metric cardinality explosion.

## 18.2 Fix

- allowed key whitelist;
- key regex;
- max key count;
- max key length;
- value validation.

## 18.3 Rule

Map keys from clients are untrusted input.

---

# 19. Collection-Based Injection Patterns

Injection can happen through list values too.

## 19.1 SQL IN clause

Bad string concatenation:

```java
"where id in (" + idsCsv + ")"
```

Use bind parameters.

## 19.2 LDAP/filter expressions

Escape values.

## 19.3 Shell command args

Avoid shell, use safe process API.

## 19.4 Template rendering

Escape output.

## 19.5 Rule

Every collection element used in a query/command/template must be treated as untrusted.

---

# 20. Insecure Deserialization and Collections

Deserializing arbitrary collection/object graphs is dangerous.

## 20.1 Risks

- gadget chains;
- huge object graph;
- recursive structures;
- type confusion;
- unexpected implementation classes.

## 20.2 Controls

- avoid native Java deserialization for untrusted data;
- use safe data formats;
- allowlist types;
- limit depth/size;
- validate after parse.

## 20.3 Rule

Untrusted serialized collections must be parsed with strict type and size controls.

---

# 21. Sensitive Data in Collections

Collections often aggregate sensitive data.

Examples:

- emails;
- tokens;
- credentials;
- PII;
- session IDs;
- access scopes;
- audit evidence;
- payment identifiers.

## 21.1 Risk

One accidental `toString()` logs entire collection.

## 21.2 Rule

Treat collections of sensitive items as sensitive as the most sensitive element.

---

# 22. Logging Collections Safely

Bad:

```java
log.info("users={}", users);
```

Could log PII.

## 22.1 Better

```java
log.info("userCount={}", users.size());
```

or redacted:

```java
log.info("userIds={}", users.stream().map(User::id).toList());
```

## 22.2 Large collection log DoS

Logging huge lists can blow logs.

## 22.3 Rule

Log counts, IDs, summaries, or redacted values, not raw collections.

---

# 23. Streams and Side-Effect Security

Streams can hide side effects.

Bad:

```java
requests.stream()
    .filter(this::authorized)
    .peek(repository::save)
    .forEach(notificationService::send);
```

Security review becomes hard.

## 23.1 Better

Use explicit loop/workflow for security-sensitive side effects.

## 23.2 Rule

Security-sensitive side effects should be explicit, auditable, and ordered.

---

# 24. Parallel Streams and Security Context

Security context may be thread-local.

Parallel stream uses different threads.

Bad:

```java
items.parallelStream()
    .filter(item -> securityContext.canRead(item))
```

If security context is thread-local, worker threads may not have correct context.

## 24.1 Fix

Capture immutable authorization data before parallel work.

```java
UserId userId = currentUser.id();
Set<Permission> permissions = Set.copyOf(currentUser.permissions());
```

## 24.2 Rule

Do not rely on thread-local security context inside parallel streams.

---

# 25. Lazy Streams and Security Context Drift

Lazy stream may be consumed after security context changes.

Bad:

```java
Stream<Document> docs = service.documentsFor(currentUser);
```

If `currentUser` mutable/session-bound and stream consumed later, authorization may drift.

## 25.1 Fix

Capture immutable auth snapshot.

## 25.2 Better

Return materialized authorized DTOs or controlled callback.

## 25.3 Rule

Lazy stream authorization must use immutable captured context.

---

# 26. Resource Exhaustion via Resource-Backed Streams

Unclosed streams can leak:

- file descriptors;
- DB cursors;
- sockets;
- directory handles.

## 26.1 Security angle

Attackers can trigger many open streams if API leaks/forgets close.

## 26.2 Fix

try-with-resources and bounded processing.

## 26.3 Rule

Resource leaks are availability vulnerabilities.

---

# 27. Secure Collectors

Collectors can accidentally expose data.

## 27.1 toMap duplicate conflict

Duplicate key can throw and reveal data in error message if not handled.

## 27.2 groupingBy sensitive key

Grouping by sensitive value and logging map can leak.

## 27.3 custom collector external state

Race/security bug.

## 27.4 Rule

Collector output should respect least-data and redaction policies.

---

# 28. Secure DTO Mapping

Do not expose entity collection directly.

Bad:

```java
return users.stream()
    .map(UserDto::fromEntityIncludingAllFields)
    .toList();
```

## 28.1 Use explicit DTO

```java
record PublicUserDto(UserId id, String displayName) {}
```

## 28.2 Filter fields by permission

```java
UserDto from(User user, Viewer viewer)
```

## 28.3 Rule

DTO mapping is a security boundary.

---

# 29. Secure Repository Querying

Secure query should include:

- tenant predicate;
- ownership predicate;
- status/visibility predicate;
- soft-delete predicate;
- authorization scopes;
- pagination limits.

## 29.1 Bad

Fetch all then filter.

## 29.2 Good

Query only authorized rows.

## 29.3 Rule

Data access layer should minimize unauthorized data retrieval.

---

# 30. Least-Privilege Collection Design

Only include data needed by caller.

## 30.1 Example

Admin endpoint:

```json
users: [{id, email, roles}]
```

Public endpoint:

```json
users: [{id, displayName}]
```

## 30.2 Rule

Do not reuse broad collection DTOs for narrow contexts.

---

# 31. Validation and Normalization Pipeline

Secure pipeline order:

```text
parse
size limit
schema validation
element validation
authorization
normalization
dedup/idempotency
business validation
processing
redacted response
```

## 31.1 Avoid normalization before validation if it hides malicious input

Example: silently trimming huge/invalid values may hide abuse.

## 31.2 Rule

Define validation-normalization order intentionally.

---

# 32. Security Testing for Collections

Test:

## 32.1 Oversized collections

## 32.2 Null elements

## 32.3 Duplicates

## 32.4 Unauthorized elements

## 32.5 Cross-tenant IDs

## 32.6 Malicious map keys

## 32.7 Injection strings

## 32.8 Parallel security context

## 32.9 Logging redaction

## 32.10 Stream close/resource leak

---

# 33. Observability and Abuse Detection

Track:

- request collection size;
- rejected oversized payloads;
- duplicate count;
- unauthorized item count;
- validation error codes;
- per-tenant item counts;
- batch processing time;
- memory pressure;
- DB rows scanned vs returned;
- cursor/stream open count.

## 33.1 Rule

Security controls need metrics to detect abuse.

---

# 34. Common Anti-Patterns

## 34.1 Public mutable roles/permissions set

Privilege escalation.

## 34.2 Filter unauthorized data after fetch

Leak risk.

## 34.3 No max batch size

DoS.

## 34.4 Blind DTO/entity mapping

Mass assignment/data exposure.

## 34.5 Logging raw collections

PII leak.

## 34.6 Dynamic map keys used as SQL fields

Injection.

## 34.7 Parallel stream using ThreadLocal security context

Authorization bug.

## 34.8 Lazy stream with mutable security context

Context drift.

## 34.9 Silent duplicate processing

Repeated side effect.

## 34.10 Unclosed resource stream

Availability vulnerability.

---

# 35. Production Failure Modes

## 35.1 Privilege escalation

Mutable roles collection exposed.

## 35.2 Tenant data leak

Query missed tenant predicate and filtered too late.

## 35.3 PII logging incident

Raw response/request collection logged.

## 35.4 Batch DoS

No size limit.

## 35.5 Duplicate transfer

Duplicate command not idempotent.

## 35.6 SQL injection via sort/filter map key

No whitelist.

## 35.7 Security context missing in parallel stream

ThreadLocal not propagated.

## 35.8 Cursor leak under attack

Resource-backed stream not closed.

## 35.9 Over-posting role/status

Client-bound collection mapped directly to entity.

## 35.10 Pagination count leak

Response total reveals sensitive population size.

---

# 36. Best Practices

## 36.1 Keep security collections immutable at boundary

Roles, permissions, scopes.

## 36.2 Defensive copy input/output

Especially principals, claims, ACLs.

## 36.3 Validate collection size and elements

Reject nulls and invalid values.

## 36.4 Define duplicate/idempotency policy

Especially batch mutations.

## 36.5 Push authorization into queries

Do not fetch unauthorized data.

## 36.6 Use least-privilege DTOs

Different views for different audiences.

## 36.7 Whitelist dynamic keys/sorts/filters

Never concatenate untrusted collection values into query strings.

## 36.8 Avoid security-sensitive side effects in streams

Use explicit workflows.

## 36.9 Capture security context immutably

Especially for lazy/parallel processing.

## 36.10 Log summaries/redacted data

Not raw collections.

---

# 37. Decision Matrix

| Situation | Secure Design |
|---|---|
| roles/permissions collection | immutable copy + domain methods |
| request list from client | max size + element validation |
| null elements | reject |
| duplicate mutating commands | reject or idempotency key |
| tenant data query | tenant predicate in DB query |
| authorization filtering | push down to repository/query |
| response with sensitive fields | least-privilege DTO |
| dynamic sort/filter | whitelist allowed keys |
| large response | pagination with safe metadata |
| batch endpoint | size limit, per-item auth, idempotency |
| stream over resource | try-with-resources/callback |
| parallel processing with auth | captured immutable context |
| logging collections | count/IDs/redacted summary |
| map input | key/value validation and max entries |
| deserialization | safe format, allowlist, depth/size limits |
| external side effects | explicit loop/workflow with audit |

---

# 38. Latihan

## Latihan 1 — Mutability Leak

Create `UserPrincipal` exposing mutable roles. Show how caller can add ADMIN. Fix with defensive copy.

## Latihan 2 — Batch Size Limit

Design validation for max 500 commands.

## Latihan 3 — Duplicate Transfer

Design idempotency policy for duplicate transfer commands.

## Latihan 4 — Tenant Query

Refactor fetch-all-then-filter into repository method with tenant predicate.

## Latihan 5 — Safe Logging

Replace raw collection logging with redacted summary.

## Latihan 6 — Dynamic Sort Whitelist

Implement whitelist mapping from API sort keys to safe DB columns/specifications.

## Latihan 7 — Parallel Security Context

Explain why ThreadLocal security context fails inside `parallelStream`.

## Latihan 8 — Map Key Validation

Validate user-provided filter map keys against allowed keys.

## Latihan 9 — DTO Exposure

Create public and admin DTOs from same entity with different fields.

## Latihan 10 — Resource Stream Abuse

Design service method that consumes repository stream safely inside transaction.

---

# 39. Ringkasan

Collections and Streams can become security boundaries and attack surfaces.

Core lessons:

- Mutable collection exposure can become privilege escalation.
- Defensive copy is security control.
- Unmodifiable collection is not deeply immutable.
- Client collections need size, null, duplicate, and value validation.
- Batch APIs amplify abuse and need idempotency/rate limits.
- Authorization should be pushed into repository/query predicates.
- Fetch-after-filter can leak via logs/cache/timing/side effects.
- Tenant isolation belongs in data access.
- Pagination metadata can leak information.
- Dynamic map keys/sort/filter values must be whitelisted.
- Collection elements used in queries/templates/commands are untrusted.
- Raw collection logging can leak sensitive data.
- Parallel streams may lose ThreadLocal security context.
- Lazy streams can suffer security context drift.
- Resource leaks are availability vulnerabilities.
- DTO mapping is a security boundary.
- Least-privilege collection design reduces blast radius.

Main rule:

```text
A collection crossing a trust boundary must be validated, bounded,
authorized, defensively copied, and returned through least-privilege views.
```

---

# 40. Referensi

1. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

2. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

3. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

4. Java SE 25 — `Collections.unmodifiableList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableList(java.util.List)

5. Java SE 25 — `List.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection)

6. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

7. OWASP Cheat Sheet Series — Mass Assignment  
   https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html

8. OWASP Cheat Sheet Series — Input Validation  
   https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html

9. OWASP Cheat Sheet Series — Deserialization  
   https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html

10. OWASP API Security Top 10  
    https://owasp.org/API-Security/
