# learn-java-collections-and-streams-part-062.md

# Java Collections and Streams — Part 062  
# Capstone: Case Workflow Query and Aggregation Engine — End-to-End Design with Collections, Streams, Indexing, Filtering, Aggregation, Pagination, Security, Persistence Boundaries, Testing, and Production Review

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **062 — Final Part**  
> Fokus: membangun capstone project konseptual dan implementatif: **Case Workflow Query and Aggregation Engine**. Bagian ini menggabungkan seluruh konsep dari seri Collections and Streams: collection contracts, map indexes, stream pipelines, collectors, pagination, DTO projections, authorization filtering, aggregation, immutable results, testing, performance, persistence boundaries, observability, dan design review checklist.

---

## Daftar Isi

1. [Tujuan Capstone](#1-tujuan-capstone)
2. [Problem Statement](#2-problem-statement)
3. [Domain Context](#3-domain-context)
4. [Target Capability](#4-target-capability)
5. [High-Level Architecture](#5-high-level-architecture)
6. [Data Model](#6-data-model)
7. [API Contract](#7-api-contract)
8. [Request Semantics](#8-request-semantics)
9. [Response Semantics](#9-response-semantics)
10. [Security and Authorization Model](#10-security-and-authorization-model)
11. [Persistence Boundary](#11-persistence-boundary)
12. [Repository Projection Strategy](#12-repository-projection-strategy)
13. [Core Collection Design](#13-core-collection-design)
14. [Indexing Strategy](#14-indexing-strategy)
15. [Filtering Strategy](#15-filtering-strategy)
16. [Sorting Strategy](#16-sorting-strategy)
17. [Pagination Strategy](#17-pagination-strategy)
18. [Aggregation Requirements](#18-aggregation-requirements)
19. [Aggregation Result Model](#19-aggregation-result-model)
20. [Collector Design](#20-collector-design)
21. [Top-N Design](#21-top-n-design)
22. [Validation and Error Model](#22-validation-and-error-model)
23. [DTO Mapping](#23-dto-mapping)
24. [Immutable Result Construction](#24-immutable-result-construction)
25. [Implementation Walkthrough](#25-implementation-walkthrough)
26. [Code: Domain Value Objects](#26-code-domain-value-objects)
27. [Code: Query Request and Response](#27-code-query-request-and-response)
28. [Code: Projection Model](#28-code-projection-model)
29. [Code: Predicate Builder](#29-code-predicate-builder)
30. [Code: Comparator Builder](#30-code-comparator-builder)
31. [Code: Aggregation Accumulator](#31-code-aggregation-accumulator)
32. [Code: Engine](#32-code-engine)
33. [Performance Cost Model](#33-performance-cost-model)
34. [Memory Cost Model](#34-memory-cost-model)
35. [Concurrency Model](#35-concurrency-model)
36. [Persistence/ORM Pitfalls Avoided](#36-persistenceorm-pitfalls-avoided)
37. [Security Pitfalls Avoided](#37-security-pitfalls-avoided)
38. [Testing Strategy](#38-testing-strategy)
39. [Observability Strategy](#39-observability-strategy)
40. [Failure Modes and Mitigations](#40-failure-modes-and-mitigations)
41. [Design Review Checklist Applied](#41-design-review-checklist-applied)
42. [Extensions](#42-extensions)
43. [What This Capstone Teaches](#43-what-this-capstone-teaches)
44. [Series Completion Summary](#44-series-completion-summary)
45. [Latihan Final](#45-latihan-final)
46. [Referensi](#46-referensi)

---

# 1. Tujuan Capstone

Tujuan capstone ini adalah menyatukan seluruh materi seri menjadi satu desain realistis.

Kita akan membangun konsep engine:

```text
Case Workflow Query and Aggregation Engine
```

Engine ini menerima query untuk daftar case/workflow items, menerapkan authorization, filtering, sorting, pagination, dan aggregation.

Output-nya bukan hanya list, tetapi juga summary:

- total matching cases;
- count by status;
- count by assignee;
- count by priority;
- count by workflow state;
- monthly trend;
- top N overdue assignees;
- paginated case rows;
- validation warnings.

Capstone ini sengaja dipilih karena mirip problem production backend:

- banyak entity;
- banyak filter;
- multi-tenant;
- security;
- pagination;
- aggregation;
- DTO;
- N+1 risk;
- memory/performance risk;
- API contract risk;
- stream/collector design risk.

---

# 2. Problem Statement

Kita punya sistem case management.

User ingin melihat daftar case dengan filter:

```text
tenant
status
priority
workflow state
assignee
created date range
updated date range
overdue only
keyword
```

Response harus mengembalikan:

1. Page of case rows.
2. Aggregation summary.
3. Stable ordering.
4. Security-safe result.
5. No N+1 queries.
6. Bounded memory.
7. Deterministic API contract.
8. Testable behavior.

---

# 3. Domain Context

Entity konseptual:

```text
Case
CaseStatus
WorkflowState
Priority
Assignee
Team
Tenant
SLA
```

Use case:

```text
A supervisor opens dashboard.
They filter cases by tenant, workflow state, priority, and date.
They need list of cases plus summary counts.
They must only see cases they are authorized to view.
The system must support large datasets.
```

---

# 4. Target Capability

Engine harus bisa:

## 4.1 Query

```java
CaseQueryRequest request
```

## 4.2 Validate request

- page size max;
- date range valid;
- allowed sort fields;
- allowed filters;
- duplicate filter values handled;
- tenant required.

## 4.3 Fetch projection

Repository returns projection rows, not entity graph.

## 4.4 Apply authorization

Prefer query-level authorization.

## 4.5 Sort and paginate

Stable deterministic order.

## 4.6 Aggregate

Summary from matching dataset.

## 4.7 Return immutable response

No mutable internals leaked.

---

# 5. High-Level Architecture

```text
Controller
  -> Application Service
      -> Request Validator
      -> Authorization Context Builder
      -> Repository Projection Query
      -> Query Engine
          -> Predicate Builder
          -> Comparator Builder
          -> Pagination
          -> Aggregation Collector
          -> DTO Mapper
      -> Response
```

Important boundary:

```text
Repository returns flat read projection.
Engine operates on in-memory projections.
Response is immutable DTO.
```

For very large datasets, aggregation should move to DB. But capstone demonstrates Java collection/stream design with explicit bounds.

---

# 6. Data Model

Conceptual read projection:

```java
record CaseRowProjection(
    CaseId caseId,
    TenantId tenantId,
    String caseNo,
    CaseStatus status,
    WorkflowState workflowState,
    Priority priority,
    UserId assigneeId,
    String assigneeName,
    TeamId teamId,
    Instant createdAt,
    Instant updatedAt,
    Instant dueAt,
    boolean confidential,
    Set<Permission> requiredPermissions
) {}
```

Why projection?

- avoids lazy entity collection;
- avoids N+1;
- fetches exactly needed fields;
- safer for read API;
- easier to test;
- no ORM-managed collection leak.

---

# 7. API Contract

Request:

```json
{
  "tenantId": "tenant-a",
  "statuses": ["OPEN", "IN_PROGRESS"],
  "priorities": ["HIGH", "CRITICAL"],
  "workflowStates": ["REVIEW", "APPROVAL"],
  "assigneeIds": ["u-1", "u-2"],
  "createdFrom": "2026-01-01T00:00:00Z",
  "createdTo": "2026-02-01T00:00:00Z",
  "overdueOnly": true,
  "keyword": "license",
  "sort": [
    { "field": "priority", "direction": "DESC" },
    { "field": "updatedAt", "direction": "DESC" },
    { "field": "caseId", "direction": "DESC" }
  ],
  "page": {
    "size": 50,
    "cursor": null
  }
}
```

Response:

```json
{
  "items": [],
  "summary": {
    "total": 0,
    "byStatus": {},
    "byPriority": {},
    "byWorkflowState": {},
    "topOverdueAssignees": []
  },
  "page": {
    "size": 50,
    "nextCursor": null,
    "hasNext": false
  }
}
```

---

# 8. Request Semantics

## 8.1 Missing filter

Missing optional filter means no filter for that dimension.

## 8.2 Null filter

Null collection field is invalid for fields that are present.

## 8.3 Empty filter list

Empty list means no values match or invalid?

Capstone decision:

```text
For filter fields, empty list is invalid.
Use missing field to mean “no filter”.
```

Reason:

- avoids ambiguity;
- prevents accidental “return nothing” confusion;
- clear client behavior.

## 8.4 Duplicate values

Duplicate filter values are rejected.

Reason:

- duplicates indicate client bug;
- avoids hidden silent normalization.

## 8.5 Page size

Max page size: 100.

## 8.6 Sort

Allowed sort fields only:

```text
priority
updatedAt
createdAt
dueAt
caseNo
caseId
```

Always append `caseId` tie-breaker if not provided.

---

# 9. Response Semantics

## 9.1 `items`

Always present.

Empty result:

```json
"items": []
```

not null.

## 9.2 Summary maps

Always present.

If no data:

```json
"byStatus": {}
```

or if UI wants zero buckets:

```json
"byStatus": {"OPEN":0, ...}
```

Capstone decision:

```text
Summary includes all enum buckets with zero counts.
```

## 9.3 Order

Items are returned in stable sorted order.

## 9.4 Mutability

Java response records defensively copy nested collections.

---

# 10. Security and Authorization Model

Authorization context:

```java
record ViewerContext(
    UserId userId,
    TenantId tenantId,
    Set<Permission> permissions,
    Set<TeamId> visibleTeamIds,
    boolean canViewConfidential
) {}
```

Security rules:

- viewer can only see same tenant;
- confidential cases require permission;
- team-restricted cases require team visibility;
- required permissions must be subset of viewer permissions.

Important:

```text
Authorization should be pushed into repository query where possible.
In-memory filtering is defense-in-depth, not primary tenant isolation.
```

---

# 11. Persistence Boundary

Repository method:

```java
List<CaseRowProjection> findCaseRows(CaseRepositoryQuery query);
```

Repository query includes:

- tenantId;
- rough date range;
- allowed statuses/priorities/states;
- authorization predicates possible in SQL;
- maximum raw result cap if Java-side aggregation is used.

For huge data:

```text
DB should perform pagination and aggregation.
```

In this capstone, we assume bounded result set for in-memory processing.

---

# 12. Repository Projection Strategy

Avoid this:

```java
List<CaseEntity> cases = caseRepository.findAll();
cases.stream()
    .map(case -> CaseDto.from(case, case.getWorkflowHistory()))
```

Use projection:

```java
List<CaseRowProjection> rows = caseRepository.findCaseRows(query);
```

Benefits:

- no entity lazy collections;
- no `LazyInitializationException`;
- no N+1 from mapping;
- explicit data shape;
- easier memory estimate.

---

# 13. Core Collection Design

Engine uses:

## 13.1 `List<CaseRowProjection>`

Input rows from repository.

## 13.2 `Predicate<CaseRowProjection>`

Filter pipeline.

## 13.3 `Comparator<CaseRowProjection>`

Stable sort.

## 13.4 `Map<Enum, Long>`

Summary counts.

## 13.5 `PriorityQueue`

Top-N overdue assignees.

## 13.6 Immutable response records

Output boundary.

---

# 14. Indexing Strategy

If engine needs repeated lookup, build maps:

```java
Map<UserId, AssigneeSummary> assigneeById
Map<TeamId, TeamSummary> teamById
```

But for capstone basic aggregation, direct grouping is enough.

Rule:

```text
Build index maps when repeated lookup would otherwise scan collections.
```

---

# 15. Filtering Strategy

Filtering is composed from predicates.

```text
tenant predicate
authorization predicate
status predicate
priority predicate
workflow state predicate
assignee predicate
date range predicate
overdue predicate
keyword predicate
```

Each predicate is small and testable.

Do not put DB/network calls in predicates.

---

# 16. Sorting Strategy

Sort must be:

- stable;
- deterministic;
- allowed-field only;
- tie-breaker included;
- null policy explicit.

Comparator builder validates sort specs.

If client omits sort:

```text
priority desc, updatedAt desc, caseId desc
```

---

# 17. Pagination Strategy

Capstone uses cursor concept.

For in-memory demo:

```java
List<Row> sorted = ...
List<Row> page = sorted.stream()
    .filter(afterCursor(cursor))
    .limit(size + 1)
    .toList();
```

Take `size + 1` to determine `hasNext`.

In real DB:

```text
Cursor pagination should be pushed into SQL query.
```

---

# 18. Aggregation Requirements

Summary includes:

- total;
- count by status;
- count by priority;
- count by workflow state;
- count by assignee;
- count overdue;
- top N overdue assignees;
- oldest open case age;
- last updated timestamp.

---

# 19. Aggregation Result Model

Typed summary:

```java
record CaseQuerySummary(
    long total,
    Map<CaseStatus, Long> byStatus,
    Map<Priority, Long> byPriority,
    Map<WorkflowState, Long> byWorkflowState,
    Map<UserId, AssigneeCount> byAssignee,
    List<AssigneeOverdueCount> topOverdueAssignees,
    long overdueCount,
    Optional<Instant> latestUpdatedAt
) {}
```

Why not raw nested map?

- better API contract;
- easier docs;
- easier tests;
- safer evolution.

---

# 20. Collector Design

Use accumulator:

```java
final class CaseSummaryAccumulator {
    ...
    void add(CaseRowProjection row) { ... }
    CaseSummaryAccumulator merge(CaseSummaryAccumulator other) { ... }
    CaseQuerySummary finish() { ... }
}
```

Why custom accumulator?

- multiple metrics;
- immutable finisher;
- zero buckets;
- top-N logic;
- clear merge behavior.

---

# 21. Top-N Design

Top overdue assignees:

1. Count overdue by assignee.
2. Sort counts desc, tie by assignee name/id.
3. Limit N.

For small cardinality, simple sort after aggregation is okay.

For huge cardinality, bounded heap.

Capstone uses simple sort for clarity.

---

# 22. Validation and Error Model

Request validation error:

```java
record ValidationError(
    String path,
    String code,
    String message
) {}
```

Examples:

- `/statuses/1` duplicate value;
- `/page/size` exceeds max;
- `/sort/0/field` unsupported;
- `/createdTo` before createdFrom.

Validation returns all errors, not fail at first, unless request too large.

---

# 23. DTO Mapping

Row DTO:

```java
record CaseRowDto(
    String caseId,
    String caseNo,
    String status,
    String workflowState,
    String priority,
    String assigneeName,
    Instant createdAt,
    Instant updatedAt,
    Instant dueAt,
    boolean overdue
) {}
```

Mapping pure:

```java
CaseRowDto from(CaseRowProjection row, Instant now)
```

No DB calls, no security lookup, no side effects.

---

# 24. Immutable Result Construction

All response records copy nested collections:

```java
record CaseQueryResponse(
    List<CaseRowDto> items,
    CaseQuerySummary summary,
    PageInfo page
) {
    CaseQueryResponse {
        items = List.copyOf(items);
    }
}
```

Nested maps/lists in summary also copied.

---

# 25. Implementation Walkthrough

Processing flow:

```text
1. Validate request.
2. Build ViewerContext.
3. Build repository query with tenant/security/filter pushdown.
4. Fetch projections.
5. Build in-memory predicate for defense-in-depth filters.
6. Filter rows.
7. Aggregate filtered rows.
8. Sort filtered rows.
9. Apply cursor/page limit.
10. Map page rows to DTO.
11. Build immutable response.
12. Emit metrics.
```

Key design decision:

```text
Aggregation is over all matching filtered rows, not only page rows.
```

This must be documented.

---

# 26. Code: Domain Value Objects

```java
import java.time.Instant;
import java.time.YearMonth;
import java.util.*;
import java.util.function.*;
import java.util.stream.*;

record TenantId(String value) {
    TenantId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) throw new IllegalArgumentException("tenant id must not be blank");
    }
}

record CaseId(String value) implements Comparable<CaseId> {
    CaseId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) throw new IllegalArgumentException("case id must not be blank");
    }

    @Override
    public int compareTo(CaseId other) {
        return this.value.compareTo(other.value);
    }
}

record UserId(String value) implements Comparable<UserId> {
    UserId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) throw new IllegalArgumentException("user id must not be blank");
    }

    @Override
    public int compareTo(UserId other) {
        return this.value.compareTo(other.value);
    }
}

record TeamId(String value) {}

enum CaseStatus {
    OPEN,
    IN_PROGRESS,
    RESOLVED,
    CLOSED,
    CANCELLED
}

enum WorkflowState {
    DRAFT,
    REVIEW,
    APPROVAL,
    ACTION_REQUIRED,
    COMPLETED
}

enum Priority {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

enum Permission {
    VIEW_CASE,
    VIEW_CONFIDENTIAL_CASE,
    VIEW_TEAM_CASES
}
```

---

# 27. Code: Query Request and Response

```java
record CaseQueryRequest(
    TenantId tenantId,
    Set<CaseStatus> statuses,
    Set<Priority> priorities,
    Set<WorkflowState> workflowStates,
    Set<UserId> assigneeIds,
    Instant createdFrom,
    Instant createdTo,
    Boolean overdueOnly,
    String keyword,
    List<SortSpec> sort,
    PageRequest page
) {
    CaseQueryRequest {
        Objects.requireNonNull(tenantId, "tenantId");
        statuses = statuses == null ? Set.of() : Set.copyOf(statuses);
        priorities = priorities == null ? Set.of() : Set.copyOf(priorities);
        workflowStates = workflowStates == null ? Set.of() : Set.copyOf(workflowStates);
        assigneeIds = assigneeIds == null ? Set.of() : Set.copyOf(assigneeIds);
        sort = sort == null ? List.of() : List.copyOf(sort);
        page = page == null ? new PageRequest(50, Optional.empty()) : page;
    }
}

enum SortDirection {
    ASC,
    DESC
}

record SortSpec(String field, SortDirection direction) {
    SortSpec {
        Objects.requireNonNull(field, "field");
        Objects.requireNonNull(direction, "direction");
    }
}

record PageRequest(int size, Optional<String> cursor) {
    PageRequest {
        if (size <= 0) throw new IllegalArgumentException("page size must be positive");
        if (size > 100) throw new IllegalArgumentException("page size must be <= 100");
        cursor = cursor == null ? Optional.empty() : cursor;
    }
}

record PageInfo(
    int size,
    Optional<String> nextCursor,
    boolean hasNext
) {
    PageInfo {
        nextCursor = nextCursor == null ? Optional.empty() : nextCursor;
    }
}
```

Important note:

```text
The compact constructor above normalizes null optional filter sets to empty sets
as internal representation. API layer should still distinguish missing/null if needed.
```

For external API, validation should happen before constructing this normalized request.

---

# 28. Code: Projection Model

```java
record CaseRowProjection(
    CaseId caseId,
    TenantId tenantId,
    String caseNo,
    CaseStatus status,
    WorkflowState workflowState,
    Priority priority,
    UserId assigneeId,
    String assigneeName,
    TeamId teamId,
    Instant createdAt,
    Instant updatedAt,
    Instant dueAt,
    boolean confidential,
    Set<Permission> requiredPermissions
) {
    CaseRowProjection {
        Objects.requireNonNull(caseId, "caseId");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(caseNo, "caseNo");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(workflowState, "workflowState");
        Objects.requireNonNull(priority, "priority");
        Objects.requireNonNull(assigneeId, "assigneeId");
        Objects.requireNonNull(assigneeName, "assigneeName");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(updatedAt, "updatedAt");
        requiredPermissions = requiredPermissions == null
            ? Set.of()
            : Set.copyOf(requiredPermissions);
    }

    boolean isOverdue(Instant now) {
        return dueAt != null && dueAt.isBefore(now) && status != CaseStatus.CLOSED;
    }
}

record ViewerContext(
    UserId userId,
    TenantId tenantId,
    Set<Permission> permissions,
    Set<TeamId> visibleTeamIds,
    boolean canViewConfidential
) {
    ViewerContext {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(tenantId, "tenantId");
        permissions = Set.copyOf(permissions);
        visibleTeamIds = Set.copyOf(visibleTeamIds);
    }
}
```

---

# 29. Code: Predicate Builder

```java
final class CasePredicates {
    private CasePredicates() {}

    static Predicate<CaseRowProjection> matches(
        CaseQueryRequest request,
        ViewerContext viewer,
        Instant now
    ) {
        return sameTenant(viewer.tenantId())
            .and(authorizedFor(viewer))
            .and(inStatuses(request.statuses()))
            .and(inPriorities(request.priorities()))
            .and(inWorkflowStates(request.workflowStates()))
            .and(inAssignees(request.assigneeIds()))
            .and(createdFrom(request.createdFrom()))
            .and(createdTo(request.createdTo()))
            .and(overdueOnly(request.overdueOnly(), now))
            .and(keyword(request.keyword()));
    }

    static Predicate<CaseRowProjection> sameTenant(TenantId tenantId) {
        return row -> row.tenantId().equals(tenantId);
    }

    static Predicate<CaseRowProjection> authorizedFor(ViewerContext viewer) {
        return row -> {
            if (row.confidential() && !viewer.canViewConfidential()) {
                return false;
            }

            if (row.teamId() != null && !viewer.visibleTeamIds().contains(row.teamId())) {
                return false;
            }

            return viewer.permissions().containsAll(row.requiredPermissions());
        };
    }

    static Predicate<CaseRowProjection> inStatuses(Set<CaseStatus> statuses) {
        return row -> statuses.isEmpty() || statuses.contains(row.status());
    }

    static Predicate<CaseRowProjection> inPriorities(Set<Priority> priorities) {
        return row -> priorities.isEmpty() || priorities.contains(row.priority());
    }

    static Predicate<CaseRowProjection> inWorkflowStates(Set<WorkflowState> states) {
        return row -> states.isEmpty() || states.contains(row.workflowState());
    }

    static Predicate<CaseRowProjection> inAssignees(Set<UserId> assigneeIds) {
        return row -> assigneeIds.isEmpty() || assigneeIds.contains(row.assigneeId());
    }

    static Predicate<CaseRowProjection> createdFrom(Instant from) {
        return row -> from == null || !row.createdAt().isBefore(from);
    }

    static Predicate<CaseRowProjection> createdTo(Instant to) {
        return row -> to == null || row.createdAt().isBefore(to);
    }

    static Predicate<CaseRowProjection> overdueOnly(Boolean overdueOnly, Instant now) {
        return row -> !Boolean.TRUE.equals(overdueOnly) || row.isOverdue(now);
    }

    static Predicate<CaseRowProjection> keyword(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return row -> true;
        }

        String normalized = keyword.trim().toLowerCase(Locale.ROOT);

        return row -> row.caseNo().toLowerCase(Locale.ROOT).contains(normalized)
            || row.assigneeName().toLowerCase(Locale.ROOT).contains(normalized);
    }
}
```

Design notes:

- predicates are pure;
- authorization context immutable;
- no DB calls in predicates;
- no logging/side effects;
- each predicate testable.

---

# 30. Code: Comparator Builder

```java
final class CaseComparators {
    private static final Set<String> ALLOWED_FIELDS = Set.of(
        "priority",
        "updatedAt",
        "createdAt",
        "dueAt",
        "caseNo",
        "caseId"
    );

    private CaseComparators() {}

    static Comparator<CaseRowProjection> build(List<SortSpec> specs) {
        List<SortSpec> normalized = normalizeSort(specs);

        Comparator<CaseRowProjection> comparator = null;

        for (SortSpec spec : normalized) {
            Comparator<CaseRowProjection> next = comparatorFor(spec.field());

            if (spec.direction() == SortDirection.DESC) {
                next = next.reversed();
            }

            comparator = comparator == null ? next : comparator.thenComparing(next);
        }

        return comparator;
    }

    private static List<SortSpec> normalizeSort(List<SortSpec> specs) {
        List<SortSpec> result = new ArrayList<>();

        if (specs == null || specs.isEmpty()) {
            result.add(new SortSpec("priority", SortDirection.DESC));
            result.add(new SortSpec("updatedAt", SortDirection.DESC));
        } else {
            result.addAll(specs);
        }

        boolean hasCaseId = result.stream()
            .anyMatch(spec -> spec.field().equals("caseId"));

        if (!hasCaseId) {
            result.add(new SortSpec("caseId", SortDirection.DESC));
        }

        for (SortSpec spec : result) {
            if (!ALLOWED_FIELDS.contains(spec.field())) {
                throw new IllegalArgumentException("Unsupported sort field: " + spec.field());
            }
        }

        return List.copyOf(result);
    }

    private static Comparator<CaseRowProjection> comparatorFor(String field) {
        return switch (field) {
            case "priority" -> Comparator.comparing(CaseRowProjection::priority);
            case "updatedAt" -> Comparator.comparing(CaseRowProjection::updatedAt);
            case "createdAt" -> Comparator.comparing(CaseRowProjection::createdAt);
            case "dueAt" -> Comparator.comparing(
                CaseRowProjection::dueAt,
                Comparator.nullsLast(Comparator.naturalOrder())
            );
            case "caseNo" -> Comparator.comparing(CaseRowProjection::caseNo);
            case "caseId" -> Comparator.comparing(CaseRowProjection::caseId);
            default -> throw new IllegalArgumentException("Unsupported sort field: " + field);
        };
    }
}
```

Design notes:

- allowed sort fields whitelist;
- deterministic tie-breaker;
- null handling for `dueAt`;
- no dynamic SQL string concat here;
- comparator builder testable.

---

# 31. Code: Aggregation Accumulator

```java
record AssigneeCount(
    UserId assigneeId,
    String assigneeName,
    long count
) {}

record AssigneeOverdueCount(
    UserId assigneeId,
    String assigneeName,
    long overdueCount
) {}

record CaseQuerySummary(
    long total,
    Map<CaseStatus, Long> byStatus,
    Map<Priority, Long> byPriority,
    Map<WorkflowState, Long> byWorkflowState,
    Map<UserId, AssigneeCount> byAssignee,
    List<AssigneeOverdueCount> topOverdueAssignees,
    long overdueCount,
    Optional<Instant> latestUpdatedAt
) {
    CaseQuerySummary {
        byStatus = Map.copyOf(byStatus);
        byPriority = Map.copyOf(byPriority);
        byWorkflowState = Map.copyOf(byWorkflowState);
        byAssignee = Map.copyOf(byAssignee);
        topOverdueAssignees = List.copyOf(topOverdueAssignees);
        latestUpdatedAt = latestUpdatedAt == null ? Optional.empty() : latestUpdatedAt;
    }
}

final class CaseSummaryAccumulator {
    private long total;
    private long overdueCount;
    private Instant latestUpdatedAt;

    private final EnumMap<CaseStatus, Long> byStatus =
        new EnumMap<>(CaseStatus.class);

    private final EnumMap<Priority, Long> byPriority =
        new EnumMap<>(Priority.class);

    private final EnumMap<WorkflowState, Long> byWorkflowState =
        new EnumMap<>(WorkflowState.class);

    private final Map<UserId, MutableAssigneeCount> byAssignee =
        new HashMap<>();

    private final Map<UserId, MutableAssigneeCount> overdueByAssignee =
        new HashMap<>();

    private final Instant now;

    CaseSummaryAccumulator(Instant now) {
        this.now = Objects.requireNonNull(now, "now");

        for (CaseStatus status : CaseStatus.values()) {
            byStatus.put(status, 0L);
        }

        for (Priority priority : Priority.values()) {
            byPriority.put(priority, 0L);
        }

        for (WorkflowState state : WorkflowState.values()) {
            byWorkflowState.put(state, 0L);
        }
    }

    void add(CaseRowProjection row) {
        total++;

        byStatus.merge(row.status(), 1L, Long::sum);
        byPriority.merge(row.priority(), 1L, Long::sum);
        byWorkflowState.merge(row.workflowState(), 1L, Long::sum);

        byAssignee
            .computeIfAbsent(
                row.assigneeId(),
                ignored -> new MutableAssigneeCount(row.assigneeId(), row.assigneeName())
            )
            .increment();

        if (row.isOverdue(now)) {
            overdueCount++;
            overdueByAssignee
                .computeIfAbsent(
                    row.assigneeId(),
                    ignored -> new MutableAssigneeCount(row.assigneeId(), row.assigneeName())
                )
                .increment();
        }

        if (latestUpdatedAt == null || row.updatedAt().isAfter(latestUpdatedAt)) {
            latestUpdatedAt = row.updatedAt();
        }
    }

    CaseSummaryAccumulator merge(CaseSummaryAccumulator other) {
        this.total += other.total;
        this.overdueCount += other.overdueCount;

        other.byStatus.forEach((k, v) -> this.byStatus.merge(k, v, Long::sum));
        other.byPriority.forEach((k, v) -> this.byPriority.merge(k, v, Long::sum));
        other.byWorkflowState.forEach((k, v) -> this.byWorkflowState.merge(k, v, Long::sum));

        other.byAssignee.forEach((userId, count) ->
            this.byAssignee
                .computeIfAbsent(userId, ignored -> new MutableAssigneeCount(userId, count.assigneeName))
                .add(count.count)
        );

        other.overdueByAssignee.forEach((userId, count) ->
            this.overdueByAssignee
                .computeIfAbsent(userId, ignored -> new MutableAssigneeCount(userId, count.assigneeName))
                .add(count.count)
        );

        if (other.latestUpdatedAt != null &&
            (this.latestUpdatedAt == null || other.latestUpdatedAt.isAfter(this.latestUpdatedAt))) {
            this.latestUpdatedAt = other.latestUpdatedAt;
        }

        return this;
    }

    CaseQuerySummary finish() {
        Map<UserId, AssigneeCount> assigneeCounts = byAssignee.entrySet().stream()
            .collect(Collectors.toUnmodifiableMap(
                Map.Entry::getKey,
                e -> e.getValue().toImmutable()
            ));

        List<AssigneeOverdueCount> topOverdue = overdueByAssignee.values().stream()
            .map(MutableAssigneeCount::toOverdueImmutable)
            .sorted(
                Comparator.comparingLong(AssigneeOverdueCount::overdueCount)
                    .reversed()
                    .thenComparing(AssigneeOverdueCount::assigneeName)
                    .thenComparing(AssigneeOverdueCount::assigneeId)
            )
            .limit(10)
            .toList();

        return new CaseQuerySummary(
            total,
            byStatus,
            byPriority,
            byWorkflowState,
            assigneeCounts,
            topOverdue,
            overdueCount,
            Optional.ofNullable(latestUpdatedAt)
        );
    }

    private static final class MutableAssigneeCount {
        private final UserId assigneeId;
        private final String assigneeName;
        private long count;

        private MutableAssigneeCount(UserId assigneeId, String assigneeName) {
            this.assigneeId = assigneeId;
            this.assigneeName = assigneeName;
        }

        void increment() {
            count++;
        }

        void add(long value) {
            count += value;
        }

        AssigneeCount toImmutable() {
            return new AssigneeCount(assigneeId, assigneeName, count);
        }

        AssigneeOverdueCount toOverdueImmutable() {
            return new AssigneeOverdueCount(assigneeId, assigneeName, count);
        }
    }
}
```

Collector factory:

```java
static Collector<CaseRowProjection, CaseSummaryAccumulator, CaseQuerySummary>
summarizingCases(Instant now) {
    return Collector.of(
        () -> new CaseSummaryAccumulator(now),
        CaseSummaryAccumulator::add,
        CaseSummaryAccumulator::merge,
        CaseSummaryAccumulator::finish
    );
}
```

Design notes:

- accumulator mutable internally;
- result immutable;
- zero enum buckets included;
- combiner implemented;
- top-N after aggregation;
- no external side effects.

---

# 32. Code: Engine

```java
record CaseRowDto(
    String caseId,
    String caseNo,
    String status,
    String workflowState,
    String priority,
    String assigneeName,
    Instant createdAt,
    Instant updatedAt,
    Instant dueAt,
    boolean overdue
) {}

record CaseQueryResponse(
    List<CaseRowDto> items,
    CaseQuerySummary summary,
    PageInfo page
) {
    CaseQueryResponse {
        items = List.copyOf(items);
        Objects.requireNonNull(summary, "summary");
        Objects.requireNonNull(page, "page");
    }
}

final class CaseQueryEngine {
    CaseQueryResponse execute(
        List<CaseRowProjection> sourceRows,
        CaseQueryRequest request,
        ViewerContext viewer,
        Instant now
    ) {
        Objects.requireNonNull(sourceRows, "sourceRows");
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(viewer, "viewer");
        Objects.requireNonNull(now, "now");

        Predicate<CaseRowProjection> predicate =
            CasePredicates.matches(request, viewer, now);

        Comparator<CaseRowProjection> comparator =
            CaseComparators.build(request.sort());

        List<CaseRowProjection> filtered = sourceRows.stream()
            .filter(predicate)
            .toList();

        CaseQuerySummary summary = filtered.stream()
            .collect(summarizingCases(now));

        List<CaseRowProjection> sorted = filtered.stream()
            .sorted(comparator)
            .toList();

        PageSlice<CaseRowProjection> pageSlice = slice(sorted, request.page());

        List<CaseRowDto> items = pageSlice.items().stream()
            .map(row -> toDto(row, now))
            .toList();

        return new CaseQueryResponse(
            items,
            summary,
            new PageInfo(
                request.page().size(),
                pageSlice.nextCursor(),
                pageSlice.hasNext()
            )
        );
    }

    private static CaseRowDto toDto(CaseRowProjection row, Instant now) {
        return new CaseRowDto(
            row.caseId().value(),
            row.caseNo(),
            row.status().name(),
            row.workflowState().name(),
            row.priority().name(),
            row.assigneeName(),
            row.createdAt(),
            row.updatedAt(),
            row.dueAt(),
            row.isOverdue(now)
        );
    }

    private static <T> PageSlice<T> slice(List<T> sorted, PageRequest pageRequest) {
        int size = pageRequest.size();

        // Simplified in-memory cursor example.
        // Real implementation should encode/decode last sort key values.
        int start = pageRequest.cursor()
            .map(Integer::parseInt)
            .orElse(0);

        int endExclusive = Math.min(start + size + 1, sorted.size());
        List<T> window = sorted.subList(start, endExclusive);

        boolean hasNext = window.size() > size;
        List<T> pageItems = hasNext ? window.subList(0, size) : window;

        Optional<String> nextCursor = hasNext
            ? Optional.of(String.valueOf(start + size))
            : Optional.empty();

        return new PageSlice<>(List.copyOf(pageItems), nextCursor, hasNext);
    }

    private static Collector<CaseRowProjection, CaseSummaryAccumulator, CaseQuerySummary>
    summarizingCases(Instant now) {
        return Collector.of(
            () -> new CaseSummaryAccumulator(now),
            CaseSummaryAccumulator::add,
            CaseSummaryAccumulator::merge,
            CaseSummaryAccumulator::finish
        );
    }
}

record PageSlice<T>(
    List<T> items,
    Optional<String> nextCursor,
    boolean hasNext
) {
    PageSlice {
        items = List.copyOf(items);
        nextCursor = nextCursor == null ? Optional.empty() : nextCursor;
    }
}
```

Important simplification:

```text
The cursor shown above is index-based for teaching.
Production cursor should be based on stable sort key values, opaque to clients,
and validated against request filters.
```

---

# 33. Performance Cost Model

For `n` source rows:

## 33.1 Filter

```text
O(n)
```

## 33.2 Aggregation

```text
O(n)
```

## 33.3 Sort

```text
O(n log n)
```

## 33.4 Pagination slice

```text
O(page size)
```

## 33.5 DTO map

```text
O(page size)
```

Total:

```text
O(n log n)
```

because sorting dominates.

For large `n`, push sorting/pagination to DB.

---

# 34. Memory Cost Model

Memory retained:

- source rows from repository;
- filtered list;
- sorted list;
- aggregation maps;
- page DTOs.

This may duplicate references.

Optimization:

```text
If source rows are already filtered by repository,
avoid extra filtered list by collecting in one pass.
```

But clarity first.

For very large datasets:

- DB aggregation;
- DB pagination;
- streaming export;
- batch processing.

---

# 35. Concurrency Model

Engine is stateless.

```text
No shared mutable fields.
All collections are local variables.
Result is immutable.
```

Therefore:

- safe for singleton service;
- no synchronization needed;
- no shared `ArrayList`;
- no global cache;
- no ThreadLocal.

If caching is added later, it must have bounds and concurrency policy.

---

# 36. Persistence/ORM Pitfalls Avoided

Avoided:

## 36.1 Lazy loading

Projection has fields already loaded.

## 36.2 N+1

No `entity.children()` access in stream.

## 36.3 Entity leak

Response uses DTO.

## 36.4 Transaction leak

Engine works on projections after repository returns.

## 36.5 Dirty checking

Read-only projection, no managed entity mutation.

---

# 37. Security Pitfalls Avoided

Avoided:

## 37.1 Cross-tenant leak

Tenant predicate in repository and in-memory defense.

## 37.2 Mutable permissions

ViewerContext copies permission sets.

## 37.3 Filter-after-fetch as primary security

Repository query should enforce security first.

## 37.4 Sort injection

Allowed sort whitelist.

## 37.5 Sensitive logging

Metrics should log counts, not full rows.

## 37.6 Side effects in stream

No audit/save/email in pipeline.

---

# 38. Testing Strategy

## 38.1 Request validation tests

- null tenant rejected;
- page size > 100 rejected;
- unsupported sort rejected;
- duplicate filter values rejected at API validation layer;
- createdTo before createdFrom rejected.

## 38.2 Predicate tests

- tenant filter;
- status filter;
- priority filter;
- overdue filter;
- keyword filter;
- confidential authorization;
- team authorization.

## 38.3 Comparator tests

- default sort;
- custom sort;
- tie-breaker by caseId;
- null dueAt.

## 38.4 Aggregation tests

- empty input;
- zero enum buckets;
- counts by status/priority/state;
- top overdue assignees;
- latestUpdatedAt;
- combiner direct test;
- sequential vs parallel equivalence.

## 38.5 Pagination tests

- empty page;
- exact page size;
- hasNext;
- nextCursor;
- stable order.

## 38.6 Immutability tests

- response items cannot mutate;
- summary maps cannot mutate;
- nested lists cannot mutate.

## 38.7 Security tests

- unauthorized confidential cases excluded;
- wrong tenant excluded;
- missing permission excluded.

## 38.8 Persistence tests

- repository projection query count stable;
- no N+1 in integration test.

---

# 39. Observability Strategy

Metrics:

```text
case_query.source_rows
case_query.filtered_rows
case_query.page_size
case_query.returned_items
case_query.group_status_count
case_query.duration
case_query.validation_errors
case_query.rejected_page_size
case_query.unsupported_sort
case_query.query_count
```

Logs:

- request correlation ID;
- tenant ID;
- page size;
- filter count;
- result count;
- duration;
- validation error codes.

Do not log full case rows.

---

# 40. Failure Modes and Mitigations

## 40.1 Too many rows fetched

Mitigation:

- DB pagination;
- raw result cap;
- query filters;
- reject broad query.

## 40.2 Sort unstable

Mitigation:

- append caseId tie-breaker;
- tests.

## 40.3 Summary expensive

Mitigation:

- DB aggregation;
- precomputed materialized view;
- cache with TTL and bounds.

## 40.4 N+1 query

Mitigation:

- projection query;
- query count tests.

## 40.5 Unauthorized data

Mitigation:

- tenant/security predicate in repository;
- defense-in-depth predicate;
- security tests.

## 40.6 Memory spike

Mitigation:

- page in DB;
- avoid full list duplication;
- cap result;
- stream export for large data.

## 40.7 Duplicate filter values

Mitigation:

- API validation rejects duplicates.

## 40.8 Error response unclear

Mitigation:

- structured validation errors with path/code.

---

# 41. Design Review Checklist Applied

## Contract

- items always present;
- summary always present;
- page info always present;
- empty lists/maps not null;
- stable ordering.

## Null

- value objects reject null where required;
- optional fields represented clearly;
- null dueAt has comparator policy.

## Duplicate

- filters should reject duplicates at API layer;
- aggregation counts all matching rows;
- no accidental `toMap` overwrite.

## Ordering

- comparator whitelist;
- tie-breaker caseId.

## Mutability

- request/response copies collections;
- summary copies maps/lists;
- viewer context copies permissions.

## Concurrency

- engine stateless;
- no shared mutable collections.

## Persistence

- projection avoids lazy entity graph.

## Security

- authorization predicate;
- tenant context;
- sort whitelist.

## Performance

- O(n log n) acknowledged;
- DB pushdown recommended for large n.

## Testing

- predicate/comparator/collector/pagination/security tests planned.

## Observability

- source/filter/page/duration metrics.

---

# 42. Extensions

## 42.1 DB-backed pagination

Move comparator and cursor to SQL.

## 42.2 DB-backed aggregation

Use SQL group by for status/priority/state.

## 42.3 Materialized dashboard

Precompute summary by tenant/status/month.

## 42.4 Stream processor

Use Kafka Streams/Flink for continuous case event aggregation.

## 42.5 Caching

Cache summary by normalized query, with TTL/size/cardinality bounds.

## 42.6 Export

Use repository stream with try-with-resources and sink writer.

## 42.7 Explain endpoint

Return query plan/debug info for admin:

- filters applied;
- sort;
- estimated row count;
- query duration;
- aggregation duration.

---

# 43. What This Capstone Teaches

This capstone combines:

## Collections

- List for ordered rows;
- Set for filters/permissions;
- Map for summaries;
- EnumMap for enum buckets;
- Priority/top-N concept;
- immutable response collections.

## Streams

- predicate composition;
- mapping;
- sorting;
- collecting;
- custom collector;
- no side effects;
- no unsafe parallel assumptions.

## API contracts

- null/empty/duplicate/order/pagination semantics.

## Persistence

- projection over entity graph.

## Security

- tenant and permission filtering.

## Performance

- cost model and DB pushdown decision.

## Testing

- contract, edge case, collector, pagination, security.

## Production

- observability, failure modes, review checklist.

---

# 44. Series Completion Summary

Dengan part 062 ini, seri **Java Collections and Streams** selesai.

Kita telah membahas:

1. peta besar Collections and Streams;
2. hierarchy collection;
3. List/Set/Map/Queue/Deque;
4. Sequenced Collections;
5. Iterator/Spliterator;
6. equality/hash/order;
7. mutability/immutability/defensive copy;
8. factories/utilities/generics/null;
9. performance cost model;
10. HashMap/ArrayList/tree internals;
11. Enum collections;
12. concurrent collections;
13. blocking queues/backpressure;
14. copy-on-write/snapshot collections;
15. weak/soft/identity maps;
16. stream mental model/sources/ops/terminal;
17. primitive streams;
18. reduction/collectors/built-in collectors;
19. grouping/toMap/order/laziness/side effects;
20. parallel streams correctness/performance;
21. resource management;
22. streams vs loops;
23. exception/null handling;
24. mapMulti;
25. custom collectors/spliterators;
26. domain modeling/API design;
27. persistence/API contracts/security/concurrency/memory leaks;
28. advanced map/aggregation/functional patterns;
29. debugging/testing/failure case studies;
30. design review checklist;
31. capstone engine.

Jika kamu memahami dan dapat menerapkan seluruh seri ini, kamu bukan hanya “bisa pakai Collections dan Streams”, tetapi bisa mendesain, mereview, mengoptimasi, mengamankan, dan mendiagnosis collection-heavy Java systems seperti senior/principal engineer.

---

# 45. Latihan Final

## Latihan 1 — Implement Minimal Engine

Implementasikan `CaseQueryEngine` dengan:

- filter by tenant/status/priority;
- sort by updatedAt desc + caseId desc;
- pagination;
- summary by status.

## Latihan 2 — Add Authorization

Tambahkan:

- confidential permission;
- visible team IDs;
- required permissions.

## Latihan 3 — Add Request Validation

Reject:

- page size > 100;
- unsupported sort;
- duplicate status;
- createdTo before createdFrom.

## Latihan 4 — Add Aggregation

Tambahkan:

- by priority;
- by workflow state;
- overdue count;
- top 5 overdue assignees.

## Latihan 5 — Test Collector

Test:

- empty input;
- multiple statuses;
- combiner;
- sequential vs parallel equivalence;
- immutable result.

## Latihan 6 — Test Pagination

Test:

- exact page size;
- hasNext;
- nextCursor;
- stable tie-breaker.

## Latihan 7 — Test Security

Test:

- wrong tenant excluded;
- confidential excluded without permission;
- team hidden excluded.

## Latihan 8 — Move Aggregation to SQL

Desain SQL query untuk count by status/priority/state.

## Latihan 9 — Observability

Tambahkan metrics:

- source row count;
- filtered row count;
- page size;
- duration;
- validation error codes.

## Latihan 10 — Design Review

Pakai checklist part 061 untuk review implementasi final.

---

# 46. Referensi

1. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

2. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

3. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

4. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

5. Java SE 25 — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

6. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

7. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

8. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

9. Java SE 25 — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

10. OpenAPI Specification  
    https://spec.openapis.org/oas/latest.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-061.md](./learn-java-collections-and-streams-part-061.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-000.md](../concurrency/learn-java-concurrency-and-reactive-part-000.md)

</div>