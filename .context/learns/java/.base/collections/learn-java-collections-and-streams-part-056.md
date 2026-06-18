# learn-java-collections-and-streams-part-056.md

# Java Collections and Streams — Part 056  
# Advanced Aggregation Patterns: Grouping, Pivoting, Rollups, Top-N per Group, Window-Like Summaries, Multi-Metric Accumulators, Error Aggregation, and Production-Grade Result Modeling

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **056**  
> Fokus: memahami aggregation tingkat lanjut dengan Collections dan Streams. Kita akan membahas grouping multi-level, composite keys, pivot table, rollup, top-N per group, multi-metric summary, histogram, time bucket, window-like aggregation, validation/error aggregation, immutable report objects, parallel correctness, memory/performance, dan batas kapan aggregation sebaiknya dilakukan di database atau stream processor.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Aggregation = Mengubah Banyak Fakta Menjadi Summary Bermakna](#2-mental-model-aggregation--mengubah-banyak-fakta-menjadi-summary-bermakna)
3. [Aggregation Questions](#3-aggregation-questions)
4. [Count Aggregation](#4-count-aggregation)
5. [Sum/Average/Min/Max Aggregation](#5-sumaverageminmax-aggregation)
6. [Multi-Metric Summary](#6-multi-metric-summary)
7. [Grouping by Single Key](#7-grouping-by-single-key)
8. [Grouping by Composite Key](#8-grouping-by-composite-key)
9. [Multi-Level Grouping](#9-multi-level-grouping)
10. [Flattened Grouping vs Nested Grouping](#10-flattened-grouping-vs-nested-grouping)
11. [Pivot Aggregation](#11-pivot-aggregation)
12. [Rollup Aggregation](#12-rollup-aggregation)
13. [Histogram Aggregation](#13-histogram-aggregation)
14. [Time Bucket Aggregation](#14-time-bucket-aggregation)
15. [Top-N Global](#15-top-n-global)
16. [Top-N per Group](#16-top-n-per-group)
17. [Distinct Count](#17-distinct-count)
18. [Approximate Aggregation](#18-approximate-aggregation)
19. [Window-Like Aggregation in Memory](#19-window-like-aggregation-in-memory)
20. [Running Aggregates](#20-running-aggregates)
21. [Error Aggregation](#21-error-aggregation)
22. [Validation Report Aggregation](#22-validation-report-aggregation)
23. [Partial Failure Aggregation](#23-partial-failure-aggregation)
24. [Aggregation Result Modeling](#24-aggregation-result-modeling)
25. [Immutable Aggregation Results](#25-immutable-aggregation-results)
26. [Custom Collector for Aggregation](#26-custom-collector-for-aggregation)
27. [Accumulator Design](#27-accumulator-design)
28. [Combiner Correctness](#28-combiner-correctness)
29. [Ordering in Aggregation](#29-ordering-in-aggregation)
30. [Null and Missing Bucket Policy](#30-null-and-missing-bucket-policy)
31. [Memory Cost Model](#31-memory-cost-model)
32. [Performance Cost Model](#32-performance-cost-model)
33. [When to Aggregate in Database](#33-when-to-aggregate-in-database)
34. [When to Aggregate in Stream Processor](#34-when-to-aggregate-in-stream-processor)
35. [Testing Aggregations](#35-testing-aggregations)
36. [Common Anti-Patterns](#36-common-anti-patterns)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Aggregation adalah salah satu alasan utama kita memakai Collections dan Streams.

Contoh sederhana:

```java
Map<Status, Long> countByStatus = orders.stream()
    .collect(Collectors.groupingBy(Order::status, Collectors.counting()));
```

Tetapi production aggregation sering lebih kompleks:

```text
For each tenant:
  for each month:
    count total orders
    sum revenue
    count paid/cancelled/refunded
    compute average processing time
    top 10 products
    collect validation errors
    expose immutable DTO
```

Aggregation sering menjadi tempat bug:

- key salah;
- bucket null tidak jelas;
- duplicate tidak sengaja dihitung dua kali;
- group result mutable;
- `BigDecimal`/money precision salah;
- average salah karena integer division;
- top-N sorting mahal;
- `groupingBy` memakan memory besar;
- parallel result salah karena combiner;
- aggregation dilakukan di application padahal harusnya di DB;
- aggregation menyembunyikan authorization leak;
- error report terlalu besar.

Tujuan bagian ini:

- memahami pattern aggregation lanjutan;
- memilih bentuk result yang tepat;
- memakai map/grouping/custom collector secara aman;
- memahami memory/performance trade-off;
- menjaga correctness untuk sequential/parallel;
- tahu kapan aggregation harus pindah ke DB/stream processor.

---

# 2. Mental Model: Aggregation = Mengubah Banyak Fakta Menjadi Summary Bermakna

Aggregation mengubah:

```text
many raw facts
```

menjadi:

```text
smaller, meaningful summary
```

Contoh facts:

```java
Order(id, tenantId, customerId, status, amount, createdAt)
```

Summary:

```java
TenantMonthlyRevenue(tenantId, month, totalOrders, totalRevenue)
```

## 2.1 Aggregation is lossy

Setelah aggregate, detail asli mungkin hilang.

Karena itu rules harus jelas:

- apa yang dihitung?
- mana yang dikecualikan?
- bagaimana null diperlakukan?
- apakah duplicate dihitung?
- time zone apa?
- rounding apa?
- authorization apa?

## 2.2 Main rule

```text
Aggregation is business logic, not just data transformation.
```

---

# 3. Aggregation Questions

Sebelum membuat aggregation, jawab:

## 3.1 Input scope

Data apa yang masuk?

```text
all orders?
only authorized?
only paid?
only current tenant?
```

## 3.2 Grouping key

Bucket berdasarkan apa?

```text
status
tenant
tenant+month
customer+product
```

## 3.3 Metrics

Apa yang dihitung?

```text
count
sum
avg
min
max
top-N
distinct count
errors
```

## 3.4 Missing/null policy

Null key masuk bucket `UNKNOWN`, ditolak, atau di-skip?

## 3.5 Duplicate policy

Duplicate event/order dihitung atau dedup?

## 3.6 Result shape

Map, list, DTO, report, nested object?

## 3.7 Ordering

Bucket/result order apa?

## 3.8 Location

Aggregation di Java, DB, cache, atau stream processor?

## 3.9 Rule

Aggregation design starts with business questions, not Stream syntax.

---

# 4. Count Aggregation

Count by key:

```java
Map<OrderStatus, Long> countByStatus = orders.stream()
    .collect(Collectors.groupingBy(
        Order::status,
        Collectors.counting()
    ));
```

## 4.1 Missing bucket

If a status has zero count, should it appear?

Default grouping only includes present statuses.

To include all:

```java
EnumMap<OrderStatus, Long> result = new EnumMap<>(OrderStatus.class);
for (OrderStatus status : OrderStatus.values()) {
    result.put(status, 0L);
}
orders.forEach(order ->
    result.merge(order.status(), 1L, Long::sum)
);
```

## 4.2 Rule

Count aggregation must define whether zero buckets are included.

---

# 5. Sum/Average/Min/Max Aggregation

For primitive amounts:

```java
LongSummaryStatistics stats = orders.stream()
    .mapToLong(Order::amountCents)
    .summaryStatistics();
```

This gives:

```text
count
sum
min
max
average
```

## 5.1 Money caution

Prefer integer minor units or `BigDecimal` with explicit rounding.

## 5.2 Average caution

Average of empty set?

```java
OptionalDouble avg = orders.stream()
    .mapToLong(Order::amountCents)
    .average();
```

## 5.3 Rule

Aggregation must define empty input behavior.

---

# 6. Multi-Metric Summary

Often you need multiple metrics in one pass.

```java
record OrderSummary(
    long count,
    long paidCount,
    long cancelledCount,
    long totalAmountCents,
    long maxAmountCents
) {}
```

Accumulator:

```java
final class OrderSummaryAcc {
    long count;
    long paidCount;
    long cancelledCount;
    long totalAmountCents;
    long maxAmountCents = Long.MIN_VALUE;

    void add(Order order) {
        count++;
        totalAmountCents += order.amountCents();
        maxAmountCents = Math.max(maxAmountCents, order.amountCents());

        if (order.status() == OrderStatus.PAID) {
            paidCount++;
        } else if (order.status() == OrderStatus.CANCELLED) {
            cancelledCount++;
        }
    }

    OrderSummaryAcc merge(OrderSummaryAcc other) {
        count += other.count;
        paidCount += other.paidCount;
        cancelledCount += other.cancelledCount;
        totalAmountCents += other.totalAmountCents;
        maxAmountCents = Math.max(maxAmountCents, other.maxAmountCents);
        return this;
    }

    OrderSummary finish() {
        return new OrderSummary(
            count,
            paidCount,
            cancelledCount,
            totalAmountCents,
            count == 0 ? 0 : maxAmountCents
        );
    }
}
```

## 6.1 Rule

For many metrics, custom accumulator is often clearer than deeply nested collectors.

---

# 7. Grouping by Single Key

Basic grouping:

```java
Map<CustomerId, List<Order>> ordersByCustomer = orders.stream()
    .collect(Collectors.groupingBy(Order::customerId));
```

## 7.1 Downstream summary

```java
Map<CustomerId, Long> countByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.counting()
    ));
```

## 7.2 Rule

Always decide whether grouped values should be raw lists or summarized values.

---

# 8. Grouping by Composite Key

Composite group key:

```java
record TenantMonth(TenantId tenantId, YearMonth month) {}
```

Aggregation:

```java
Map<TenantMonth, Long> countByTenantMonth = orders.stream()
    .collect(Collectors.groupingBy(
        order -> new TenantMonth(
            order.tenantId(),
            YearMonth.from(order.createdAt().atZone(zoneId))
        ),
        Collectors.counting()
    ));
```

## 8.1 Time zone

Month depends on time zone.

## 8.2 Rule

Composite keys should be explicit value objects, not string concatenations.

---

# 9. Multi-Level Grouping

Nested map:

```java
Map<TenantId, Map<YearMonth, Long>> counts = orders.stream()
    .collect(Collectors.groupingBy(
        Order::tenantId,
        Collectors.groupingBy(
            order -> YearMonth.from(order.createdAt().atZone(zoneId)),
            Collectors.counting()
        )
    ));
```

## 9.1 Pros

Natural hierarchy.

## 9.2 Cons

Nested map can be awkward for API/serialization.

## 9.3 Rule

Use nested grouping when hierarchical access is primary.

---

# 10. Flattened Grouping vs Nested Grouping

Flattened:

```java
Map<TenantMonth, Long>
```

Nested:

```java
Map<TenantId, Map<YearMonth, Long>>
```

## 10.1 Flattened good for

- DB-like rows;
- export;
- sorting;
- pagination;
- composite lookup.

## 10.2 Nested good for

- hierarchical reports;
- per-tenant rendering;
- localized traversal.

## 10.3 Rule

Choose result shape based on consumption, not collector convenience.

---

# 11. Pivot Aggregation

Pivot transforms values into columns.

Example:

```text
tenant | PAID | CANCELLED | REFUNDED
```

Domain result:

```java
record StatusPivot(
    TenantId tenantId,
    long paid,
    long cancelled,
    long refunded
) {}
```

Accumulator:

```java
final class StatusPivotAcc {
    long paid;
    long cancelled;
    long refunded;

    void add(Order order) {
        switch (order.status()) {
            case PAID -> paid++;
            case CANCELLED -> cancelled++;
            case REFUNDED -> refunded++;
            default -> {}
        }
    }

    StatusPivotAcc merge(StatusPivotAcc other) {
        paid += other.paid;
        cancelled += other.cancelled;
        refunded += other.refunded;
        return this;
    }
}
```

## 11.1 Rule

Pivot reports are often clearer as typed DTOs than `Map<Status, Long>`.

---

# 12. Rollup Aggregation

Rollup computes subtotals at multiple levels.

Example:

```text
tenant + month
tenant total
grand total
```

## 12.1 Implementation idea

Accumulate into multiple keys:

```java
record RollupKey(TenantId tenantId, YearMonth month, Level level) {}
```

For each order, update:

- tenant-month key;
- tenant-total key;
- grand-total key.

## 12.2 Rule

Rollup aggregation should model subtotal levels explicitly.

---

# 13. Histogram Aggregation

Histogram buckets numeric values.

Example:

```text
0-100
101-500
501-1000
1000+
```

Bucket type:

```java
enum AmountBucket {
    SMALL, MEDIUM, LARGE, ENTERPRISE
}
```

Classifier:

```java
AmountBucket bucket(long amountCents) {
    if (amountCents <= 10_000) return AmountBucket.SMALL;
    if (amountCents <= 50_000) return AmountBucket.MEDIUM;
    if (amountCents <= 100_000) return AmountBucket.LARGE;
    return AmountBucket.ENTERPRISE;
}
```

Aggregation:

```java
Map<AmountBucket, Long> histogram = orders.stream()
    .collect(Collectors.groupingBy(
        order -> bucket(order.amountCents()),
        () -> new EnumMap<>(AmountBucket.class),
        Collectors.counting()
    ));
```

## 13.1 Rule

Bucket boundaries are business rules and should be named/tested.

---

# 14. Time Bucket Aggregation

Time bucket by hour/day/month.

```java
YearMonth month = YearMonth.from(instant.atZone(zoneId));
```

## 14.1 Danger

- time zone;
- daylight saving;
- inclusive/exclusive boundaries;
- late events;
- clock skew.

## 14.2 Rule

Time aggregation must explicitly define zone and boundary semantics.

---

# 15. Top-N Global

Top N by amount:

```java
List<Order> top10 = orders.stream()
    .sorted(Comparator.comparingLong(Order::amountCents).reversed())
    .limit(10)
    .toList();
```

## 15.1 For large input

Sorting all is O(n log n).

Bounded heap is O(n log k).

## 15.2 Rule

Use full sort only when input is small enough or full order is needed.

---

# 16. Top-N per Group

Goal:

```text
top 3 orders per customer
```

Simple but potentially expensive:

```java
Map<CustomerId, List<Order>> topByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.collectingAndThen(
            Collectors.toList(),
            list -> list.stream()
                .sorted(Comparator.comparingLong(Order::amountCents).reversed())
                .limit(3)
                .toList()
        )
    ));
```

## 16.1 Better for large groups

Use downstream custom collector with bounded priority queue.

## 16.2 Rule

Top-N per group should avoid storing/sorting whole group if groups are large.

---

# 17. Distinct Count

Exact distinct count:

```java
Map<CustomerId, Long> distinctProductsByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.mapping(
            Order::productId,
            Collectors.collectingAndThen(Collectors.toSet(), set -> (long) set.size())
        )
    ));
```

## 17.1 Memory

Stores sets per group.

## 17.2 Rule

Exact distinct count can be memory expensive.

---

# 18. Approximate Aggregation

For huge data, approximate algorithms may be better:

- HyperLogLog for distinct count;
- sampling;
- sketches;
- quantile approximation.

## 18.1 Java application caveat

Use proven libraries; do not invent approximate algorithms casually.

## 18.2 Rule

Approximate aggregation needs explicit error bounds and business acceptance.

---

# 19. Window-Like Aggregation in Memory

Window aggregation:

```text
last 5 minutes
last 100 events
per user rolling count
```

In application memory, this needs:

- event time;
- eviction;
- window boundary;
- late event policy;
- memory bound.

## 19.1 Rule

If window aggregation is continuous and high-volume, consider stream processor.

---

# 20. Running Aggregates

Running total:

```java
long running = 0;
for (Order order : orderedOrders) {
    running += order.amountCents();
    ...
}
```

Streams are not always ideal for running state.

## 20.1 Rule

For ordered stateful running aggregation, loop can be clearer and safer.

---

# 21. Error Aggregation

Group validation errors by field:

```java
Map<String, List<ValidationError>> errorsByField = errors.stream()
    .collect(Collectors.groupingBy(ValidationError::field));
```

## 21.1 Better result

```java
record ValidationReport(
    long totalRows,
    long validRows,
    Map<String, List<ValidationError>> errorsByField
) {}
```

## 21.2 Rule

Error aggregation should be bounded or summarized for large inputs.

---

# 22. Validation Report Aggregation

Accumulator:

```java
final class ValidationReportAcc {
    long total;
    long valid;
    final Map<String, List<ValidationError>> errorsByField = new LinkedHashMap<>();

    void add(RowValidationResult result) {
        total++;
        if (result.errors().isEmpty()) {
            valid++;
            return;
        }
        for (ValidationError error : result.errors()) {
            errorsByField
                .computeIfAbsent(error.field(), k -> new ArrayList<>())
                .add(error);
        }
    }

    ValidationReportAcc merge(ValidationReportAcc other) {
        total += other.total;
        valid += other.valid;
        other.errorsByField.forEach((field, errors) ->
            errorsByField
                .computeIfAbsent(field, k -> new ArrayList<>())
                .addAll(errors)
        );
        return this;
    }

    ValidationReport finish() {
        Map<String, List<ValidationError>> copy = new LinkedHashMap<>();
        errorsByField.forEach((field, errors) ->
            copy.put(field, List.copyOf(errors))
        );
        return new ValidationReport(total, valid, Map.copyOf(copy));
    }
}
```

## 22.1 Rule

Validation aggregation should separate row count, valid count, and error details.

---

# 23. Partial Failure Aggregation

Batch result:

```java
record BatchResult(
    long successCount,
    long failureCount,
    List<ItemResult> results
) {}
```

## 23.1 Preserve correlation

Each result should include:

- request index;
- client ID;
- status;
- errors.

## 23.2 Rule

Partial failure aggregation must preserve item correlation.

---

# 24. Aggregation Result Modeling

Avoid returning raw nested maps for complex reports.

Bad:

```java
Map<TenantId, Map<YearMonth, Map<Status, Long>>>
```

Better:

```java
record TenantMonthlyStatusReport(
    TenantId tenantId,
    YearMonth month,
    long paid,
    long cancelled,
    long refunded
) {}
```

## 24.1 Rule

Complex aggregation deserves typed result models.

---

# 25. Immutable Aggregation Results

Aggregation result should usually be immutable.

```java
record Report(List<Row> rows, Map<Key, Summary> summaries) {
    Report {
        rows = List.copyOf(rows);
        summaries = Map.copyOf(summaries);
    }
}
```

## 25.1 For nested collections

Copy nested values too.

## 25.2 Rule

Do not expose mutable accumulator internals as final report.

---

# 26. Custom Collector for Aggregation

Custom collector:

```java
static Collector<Order, OrderSummaryAcc, OrderSummary> summarizingOrders() {
    return Collector.of(
        OrderSummaryAcc::new,
        OrderSummaryAcc::add,
        OrderSummaryAcc::merge,
        OrderSummaryAcc::finish
    );
}
```

## 26.1 Good when

- many metrics;
- reusable;
- downstream grouping;
- immutable result;
- need custom merge.

## 26.2 Rule

Custom collector is ideal for reusable domain aggregation.

---

# 27. Accumulator Design

Good accumulator:

- minimal mutable state;
- explicit `add`;
- explicit `merge`;
- explicit `finish`;
- no external mutation;
- bounded memory when possible.

## 27.1 Rule

Accumulator is internal mutable engine; result is immutable domain object.

---

# 28. Combiner Correctness

Parallel aggregation uses combiner.

Combiner must merge all fields.

Bad:

```java
merge only count but not total
```

## 28.1 Test

```java
assertEquals(
    input.stream().collect(collector),
    input.parallelStream().collect(collector)
);
```

## 28.2 Rule

Every aggregation collector must pass sequential/parallel equivalence if parallel is allowed.

---

# 29. Ordering in Aggregation

Maps may not preserve order.

## 29.1 For output order

Use:

- `LinkedHashMap`;
- `TreeMap`;
- sorted list after aggregation;
- explicit order field.

## 29.2 Rule

If report order matters, make order explicit.

---

# 30. Null and Missing Bucket Policy

Null classifier result in grouping can be problematic.

Policy options:

- reject;
- skip;
- bucket as `UNKNOWN`;
- map to optional key.

## 30.1 Example

```java
Status status = order.status() == null ? Status.UNKNOWN : order.status();
```

## 30.2 Rule

Null bucket policy is part of aggregation correctness.

---

# 31. Memory Cost Model

Memory grows with:

- number of groups;
- size of value lists;
- nested maps;
- distinct sets;
- sorted buffers;
- top-N heaps;
- error lists;
- accumulator state;
- copied immutable results.

## 31.1 Rule

Aggregation memory is often O(number of groups + retained details), not O(1).

---

# 32. Performance Cost Model

Cost drivers:

- classifier cost;
- hash/equality cost;
- map resizing;
- boxing;
- sorting;
- downstream collector;
- combiner cost;
- copying finisher;
- parallel overhead.

## 32.1 Rule

For large data, benchmark with representative cardinality and group distribution.

---

# 33. When to Aggregate in Database

Prefer DB aggregation when:

- data already in DB;
- result is much smaller than raw data;
- filtering/authorization in DB;
- indexes help;
- grouping can be done in SQL;
- data volume large.

Example:

```sql
select status, count(*)
from orders
where tenant_id = ?
group by status
```

## 33.1 Rule

Do not pull millions of rows to Java just to count them.

---

# 34. When to Aggregate in Stream Processor

Use stream processor when:

- continuous event stream;
- windowing;
- late events;
- stateful aggregation;
- replay;
- exactly-once/at-least-once semantics;
- high throughput;
- materialized views.

Examples:

- Kafka Streams;
- Flink;
- ksqlDB.

## 34.1 Rule

Continuous high-volume windowed aggregation usually does not belong in request thread memory.

---

# 35. Testing Aggregations

Test:

## 35.1 Empty input

## 35.2 Single item

## 35.3 Multiple groups

## 35.4 Null/missing keys

## 35.5 Duplicate input

## 35.6 Time zone boundaries

## 35.7 Top-N ties

## 35.8 Parallel equivalence

## 35.9 Result immutability

## 35.10 Large cardinality

---

# 36. Common Anti-Patterns

## 36.1 Giant nested map returned from service

Hard contract.

## 36.2 `groupingBy` huge raw data

Memory spike.

## 36.3 `sorted().limit(n)` for huge top-N

Unnecessary full sort.

## 36.4 Average using integer division

Wrong.

## 36.5 Null bucket accidental

Bug.

## 36.6 Time bucket without zone

Wrong monthly/day report.

## 36.7 Parallel collector with bad combiner

Wrong result.

## 36.8 Mutable report exposed

Caller corrupts report.

## 36.9 Aggregating unauthorized data then filtering

Security leak.

## 36.10 App aggregation when DB aggregation is needed

Slow/OOM.

---

# 37. Production Failure Modes

## 37.1 Revenue report wrong

Duplicate events counted twice.

## 37.2 Monthly report wrong

Time zone boundary ignored.

## 37.3 Top products slow

Sorting all products per group.

## 37.4 Memory OOM

Grouping huge data into lists.

## 37.5 Mutable report corruption

Returned map/list modified by caller.

## 37.6 Parallel mismatch

Combiner missed fields.

## 37.7 Missing zero bucket

Dashboard hides status with zero count.

## 37.8 Security leak

Aggregated across tenants before filtering.

## 37.9 Error report OOM

Collected every error for huge import.

## 37.10 DB overload

Application repeatedly aggregates unindexed raw data.

---

# 38. Best Practices

## 38.1 Treat aggregation as business logic

Name types and rules.

## 38.2 Use typed result models

Avoid unreadable nested maps for public contracts.

## 38.3 Define null/duplicate/empty policies

No accidental behavior.

## 38.4 Use custom accumulators for multi-metric summaries

Cleaner and faster.

## 38.5 Keep results immutable

Copy nested collections.

## 38.6 Avoid materializing raw groups if only summary needed

Use downstream collector.

## 38.7 Use bounded top-N collectors

Avoid full sort when N small.

## 38.8 Push aggregation to DB for large persisted data

Use indexes and SQL.

## 38.9 Use stream processors for continuous/windowed aggregation

Do not overload request threads.

## 38.10 Test edge cases and parallel correctness

Especially combiner and time boundaries.

---

# 39. Decision Matrix

| Need | Recommended Pattern |
|---|---|
| count by enum | `EnumMap` + counts or `groupingBy` |
| multiple metrics | custom accumulator/collector |
| group raw items | `groupingBy` to list |
| group summary only | `groupingBy` with downstream summary |
| composite grouping | record key |
| hierarchical report | nested grouping or typed hierarchy |
| API report | typed DTO/list rows |
| pivot columns | typed pivot record |
| rollup/subtotal | explicit rollup keys/levels |
| histogram | named bucket classifier |
| time bucket | explicit zone/boundary |
| top-N small N | bounded heap collector |
| exact distinct count | set per group, watch memory |
| huge DB data | SQL aggregation |
| continuous windows | stream processor |
| validation report | custom accumulator with capped errors |
| partial batch result | per-item result with correlation |
| ordering required | ordered map/sorted output |
| immutable output | defensive copy finisher |
| parallel stream | correct combiner + test |

---

# 40. Latihan

## Latihan 1 — Count by Status

Count orders by status and include zero buckets for all enum values.

## Latihan 2 — Tenant Month Summary

Use composite key `TenantMonth` and aggregate count + total revenue.

## Latihan 3 — Pivot Report

Create `StatusPivot` per tenant.

## Latihan 4 — Rollup

Compute tenant-month, tenant-total, and grand-total.

## Latihan 5 — Top-N per Group

Implement top 3 products per customer using bounded heap.

## Latihan 6 — Histogram

Create amount buckets and count orders per bucket.

## Latihan 7 — Validation Report

Aggregate errors by field with max 100 errors.

## Latihan 8 — Time Zone Boundary

Test order created near midnight UTC for Asia/Jakarta monthly bucket.

## Latihan 9 — Custom Collector

Build multi-metric `OrderSummaryCollector` and test sequential vs parallel.

## Latihan 10 — DB vs Java

Given 10M orders in DB, decide which aggregation belongs in SQL and why.

---

# 41. Ringkasan

Advanced aggregation is where Collections, Streams, domain modeling, and performance meet.

Core lessons:

- Aggregation is business logic.
- Define input scope, grouping key, metrics, null/duplicate policy, result shape, and ordering.
- Count aggregation must decide zero buckets.
- Multi-metric summaries often deserve custom accumulators.
- Composite keys should be explicit value objects.
- Nested vs flattened grouping depends on consumption.
- Pivot and rollup reports should be modeled explicitly.
- Histograms and time buckets encode business rules.
- Top-N per group needs bounded structures for large groups.
- Exact distinct counts can be memory-heavy.
- Validation/error aggregation needs caps and correlation.
- Immutable result models prevent corruption.
- Parallel aggregation requires correct combiner.
- Stateful operations can consume large memory.
- Large persisted data should often be aggregated in DB.
- Continuous/windowed aggregation often belongs in stream processors.

Main rule:

```text
Before writing groupingBy, define the report contract:
scope, key, metrics, bucket policy, ordering, mutability, size,
and where the aggregation should execute.
```

---

# 42. Referensi

1. Java SE 25 — `Collectors.groupingBy`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#groupingBy(java.util.function.Function)

2. Java SE 25 — `Collectors.partitioningBy`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#partitioningBy(java.util.function.Predicate)

3. Java SE 25 — `Collectors.summarizingLong`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#summarizingLong(java.util.function.ToLongFunction)

4. Java SE 25 — `LongSummaryStatistics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LongSummaryStatistics.html

5. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

6. Java SE 25 — `Map.merge`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html#merge(K,V,java.util.function.BiFunction)

7. Java SE 25 — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

8. Java SE 25 — `PriorityQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html

9. Java SE 25 — `YearMonth`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/YearMonth.html

10. Java SE 25 — `ZoneId`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/ZoneId.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-055.md](./learn-java-collections-and-streams-part-055.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-057.md](./learn-java-collections-and-streams-part-057.md)
