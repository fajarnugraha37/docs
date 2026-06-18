# learn-java-collections-and-streams-part-060.md

# Java Collections and Streams — Part 060  
# Production Failure Case Studies: N+1 Stream Mapping, Mutable Collection Leaks, Unbounded Caches, Duplicate Key Data Loss, Parallel Stream Races, Pagination Drift, Queue Backlog, Collector Bugs, and Memory Retention

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **060**  
> Fokus: membahas failure case production yang sering terjadi akibat penggunaan Collections dan Streams yang kurang hati-hati. Setiap case disusun dengan format: symptom, konteks, kode bermasalah, root cause, diagnosis, fix, preventive guardrail, dan lesson learned.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Production Failure = Contract yang Tidak Eksplisit Bertemu Data Nyata](#2-mental-model-production-failure--contract-yang-tidak-eksplisit-bertemu-data-nyata)
3. [Format Studi Kasus](#3-format-studi-kasus)
4. [Case 01 — N+1 Query dari Stream DTO Mapping](#4-case-01--n1-query-dari-stream-dto-mapping)
5. [Case 02 — Data Hilang karena `toMap` Latest-Wins](#5-case-02--data-hilang-karena-tomap-latest-wins)
6. [Case 03 — Memory Leak dari Static Map Cache](#6-case-03--memory-leak-dari-static-map-cache)
7. [Case 04 — Privilege Escalation dari Mutable Roles Set](#7-case-04--privilege-escalation-dari-mutable-roles-set)
8. [Case 05 — Parallel Stream Race dengan Shared `ArrayList`](#8-case-05--parallel-stream-race-dengan-shared-arraylist)
9. [Case 06 — Pagination Drift karena Ordering Tidak Stabil](#9-case-06--pagination-drift-karena-ordering-tidak-stabil)
10. [Case 07 — Queue Backlog karena Unbounded `ConcurrentLinkedQueue`](#10-case-07--queue-backlog-karena-unbounded-concurrentlinkedqueue)
11. [Case 08 — Collector Combiner Salah di Parallel Stream](#11-case-08--collector-combiner-salah-di-parallel-stream)
12. [Case 09 — `subList` Retains Huge Backing List](#12-case-09--sublist-retains-huge-backing-list)
13. [Case 10 — `ConcurrentModificationException` dari Mutasi Saat Iterasi](#13-case-10--concurrentmodificationexception-dari-mutasi-saat-iterasi)
14. [Case 11 — Batch Import OOM karena Error List Tidak Dibatasi](#14-case-11--batch-import-oom-karena-error-list-tidak-dibatasi)
15. [Case 12 — `ThreadLocal<List<...>>` Leak di Thread Pool](#15-case-12--threadlocallist-leak-di-thread-pool)
16. [Case 13 — Hidden Security Leak dari Filter-After-Fetch](#16-case-13--hidden-security-leak-dari-filter-after-fetch)
17. [Case 14 — Wrong Report karena Time Bucket Tanpa Time Zone](#17-case-14--wrong-report-karena-time-bucket-tanpa-time-zone)
18. [Case 15 — Listener Registry Leak](#18-case-15--listener-registry-leak)
19. [Case 16 — `HashSet` Broken karena Mutable `equals/hashCode`](#19-case-16--hashset-broken-karena-mutable-equalshashcode)
20. [Case 17 — `peek` Dipakai untuk Business Side Effect](#20-case-17--peek-dipakai-untuk-business-side-effect)
21. [Case 18 — Resource Stream Tidak Ditutup](#21-case-18--resource-stream-tidak-ditutup)
22. [Case 19 — High-Cardinality Metrics Map Leak](#22-case-19--high-cardinality-metrics-map-leak)
23. [Case 20 — `groupingBy` pada Dataset Besar Menyebabkan OOM](#23-case-20--groupingby-pada-dataset-besar-menyebabkan-oom)
24. [Cross-Case Patterns](#24-cross-case-patterns)
25. [Incident Response Playbook](#25-incident-response-playbook)
26. [Preventive Engineering Guardrails](#26-preventive-engineering-guardrails)
27. [Code Review Checklist](#27-code-review-checklist)
28. [Observability Checklist](#28-observability-checklist)
29. [Testing Checklist](#29-testing-checklist)
30. [Best Practices](#30-best-practices)
31. [Latihan](#31-latihan)
32. [Ringkasan](#32-ringkasan)
33. [Referensi](#33-referensi)

---

# 1. Tujuan Bagian Ini

Bagian-bagian sebelumnya banyak membahas konsep dan pattern. Bagian ini mengubah konsep tersebut menjadi **failure case thinking**.

Di production, masalah Collections/Streams jarang muncul sebagai error yang jelas sejak awal. Seringnya muncul sebagai:

- latency naik perlahan;
- memory naik selama jam/hari;
- data report salah;
- data duplicate/hilang;
- query count meledak;
- CPU tinggi;
- GC makin sering;
- user tidak melihat data yang seharusnya;
- user melihat data yang tidak boleh dilihat;
- retry batch menyebabkan side effect ganda;
- hasil parallel stream kadang salah;
- response order berubah setelah deploy;
- OOM hanya muncul untuk tenant tertentu.

Tujuan bagian ini:

- mengenali pola failure umum;
- melihat bagaimana bug kecil di collection/stream menjadi incident;
- memahami cara diagnosis;
- memahami fix teknis;
- membuat guardrail agar bug tidak terulang;
- membangun mental model incident review untuk collection-heavy code.

---

# 2. Mental Model: Production Failure = Contract yang Tidak Eksplisit Bertemu Data Nyata

Banyak incident terjadi bukan karena developer tidak tahu syntax, tetapi karena kontrak tidak eksplisit.

Contoh kontrak yang tidak eksplisit:

```text
Apakah duplicate boleh?
Apakah order stabil?
Apakah collection bounded?
Apakah lazy collection aman diakses?
Apakah result mutable?
Apakah stream harus ditutup?
Apakah batch partial success?
Apakah null element valid?
Apakah aggregation di Java aman untuk 10 juta row?
```

Saat data nyata lebih besar, lebih kotor, lebih concurrent, lebih dynamic, atau lebih multi-tenant daripada test data, kontrak ambigu berubah menjadi bug.

## 2.1 Main rule

```text
Production does not forgive accidental collection semantics.
```

---

# 3. Format Studi Kasus

Setiap case menggunakan format:

## 3.1 Symptom

Apa yang terlihat?

## 3.2 Context

Sistem/kode sedang melakukan apa?

## 3.3 Problematic Code

Kode atau pola yang bermasalah.

## 3.4 Root Cause

Penyebab inti.

## 3.5 Diagnosis

Cara menemukan masalah.

## 3.6 Fix

Perbaikan.

## 3.7 Prevention

Guardrail agar tidak terulang.

## 3.8 Lesson

Mental model yang harus diingat.

---

# 4. Case 01 — N+1 Query dari Stream DTO Mapping

## Symptom

Endpoint `/orders/recent` tiba-tiba lambat saat jumlah order meningkat.

```text
p95 latency: 300 ms -> 8 s
DB CPU naik
connection pool hampir habis
```

## Context

Service mengambil 500 order terakhir dan map ke DTO.

## Problematic Code

```java
@Transactional(readOnly = true)
public List<OrderDto> recentOrders() {
    return orderRepository.findRecent(500).stream()
        .map(order -> new OrderDto(
            order.id(),
            order.status(),
            order.lines().stream()
                .map(OrderLineDto::from)
                .toList()
        ))
        .toList();
}
```

## Root Cause

`order.lines()` lazy. Untuk 500 orders:

```text
1 query find orders
500 queries find lines
```

Stream chain menyembunyikan akses DB.

## Diagnosis

- Enable SQL logging/query counter.
- Hit endpoint dengan 10/100/500 orders.
- Query count naik linear dengan jumlah parent.
- Trace menunjukkan mapper memicu lazy loading.

## Fix

Option 1: fetch required association upfront.

```java
@Transactional(readOnly = true)
public List<OrderDto> recentOrders() {
    List<Order> orders = orderRepository.findRecentWithLines(500);

    return orders.stream()
        .map(OrderDto::from)
        .toList();
}
```

Option 2: projection query.

```java
List<OrderLineProjection> rows = orderRepository.findRecentOrderLineProjection(500);
return OrderDtoAssembler.assemble(rows);
```

## Prevention

- Query-count test dengan beberapa parent.
- DTO mapping entity harus direview untuk lazy access.
- Jangan expose entity ke controller.
- Gunakan projection untuk read-heavy endpoint.

## Lesson

```text
A stream mapper over entities may be a hidden SQL loop.
```

---

# 5. Case 02 — Data Hilang karena `toMap` Latest-Wins

## Symptom

Sebagian order line hilang dari invoice. Tidak ada exception.

## Context

Order line dikelompokkan berdasarkan product ID.

## Problematic Code

```java
Map<ProductId, OrderLine> lineByProduct = lines.stream()
    .collect(Collectors.toMap(
        OrderLine::productId,
        Function.identity(),
        (oldLine, newLine) -> newLine
    ));
```

## Root Cause

Duplicate product ID silently latest-wins. Padahal business rule harus merge quantity.

## Diagnosis

- Compare raw input line count vs map size.
- Cari duplicate product ID.
- Reproduce dengan dua line product sama.

## Fix

Merge quantity:

```java
Map<ProductId, Quantity> quantityByProduct = new LinkedHashMap<>();

for (OrderLine line : lines) {
    quantityByProduct.merge(
        line.productId(),
        line.quantity(),
        Quantity::add
    );
}
```

Atau jika duplicate tidak valid:

```java
(oldLine, newLine) -> {
    throw new DuplicateProductLineException(oldLine.productId());
}
```

## Prevention

- Wajib define duplicate policy untuk semua `toMap`.
- Test duplicate input.
- Hindari latest-wins tanpa nama eksplisit.

## Lesson

```text
A merge function is business policy, not boilerplate.
```

---

# 6. Case 03 — Memory Leak dari Static Map Cache

## Symptom

Service OOM setelah 2 hari. Restart menyelesaikan sementara.

## Context

Cache hasil parsing config per tenant.

## Problematic Code

```java
final class ConfigParser {
    private static final Map<String, ParsedConfig> CACHE = new ConcurrentHashMap<>();

    static ParsedConfig parse(String rawConfig) {
        return CACHE.computeIfAbsent(rawConfig, ConfigParser::doParse);
    }
}
```

## Root Cause

Key adalah raw config string user-controlled dan unbounded. Static map tidak pernah evict.

## Diagnosis

- Heap dump.
- Dominator tree: `ConcurrentHashMap` static retains millions of `ParsedConfig`.
- Keys are long strings.
- Entry count grows over time.

## Fix

Use bounded cache with TTL/size or remove cache.

```java
// Conceptual: bounded cache with maximum size and expiration.
```

Better key:

```java
record ConfigCacheKey(TenantId tenantId, ConfigVersion version) {}
```

## Prevention

- No static mutable cache without eviction.
- Cache metrics: size, hit/miss, eviction.
- Key cardinality review.
- Load test with many tenants/configs.

## Lesson

```text
A Map without eviction is not a cache; it is a memory leak.
```

---

# 7. Case 04 — Privilege Escalation dari Mutable Roles Set

## Symptom

User biasa mendapat role admin setelah plugin internal memodifikasi object principal.

## Context

Security principal menyimpan roles.

## Problematic Code

```java
final class UserPrincipal {
    private final Set<Role> roles;

    UserPrincipal(UserId id, Set<Role> roles) {
        this.roles = roles;
    }

    Set<Role> roles() {
        return roles;
    }
}
```

Caller:

```java
principal.roles().add(Role.ADMIN);
```

## Root Cause

Mutable set internal terekspos. Tidak ada defensive copy.

## Diagnosis

- Audit menemukan role admin tidak berasal dari DB.
- Object principal yang sama dipakai lintas layer.
- Breakpoint pada `roles().add`.

## Fix

```java
final class UserPrincipal {
    private final Set<Role> roles;

    UserPrincipal(UserId id, Collection<Role> roles) {
        this.roles = Set.copyOf(roles);
    }

    Set<Role> roles() {
        return roles;
    }

    boolean hasRole(Role role) {
        return roles.contains(role);
    }
}
```

## Prevention

- Security-sensitive collections must be immutable.
- Tests mutate constructor input and returned collection.
- Avoid raw role set getter if method `hasRole` is enough.

## Lesson

```text
Mutable collection exposure can become a security vulnerability.
```

---

# 8. Case 05 — Parallel Stream Race dengan Shared `ArrayList`

## Symptom

Generated report sometimes missing rows or throws weird exceptions.

## Context

Developer changed stream to parallel for speed.

## Problematic Code

```java
List<ReportRow> rows = new ArrayList<>();

items.parallelStream()
    .map(this::buildRow)
    .forEach(rows::add);

return rows;
```

## Root Cause

`ArrayList` is not thread-safe. Multiple threads mutate it concurrently.

## Diagnosis

- Bug only happens under high data volume.
- Reproduced with repeated test.
- Race disappears when using sequential stream.

## Fix

```java
List<ReportRow> rows = items.parallelStream()
    .map(this::buildRow)
    .toList();
```

If order needed, verify encounter order.

## Prevention

- Ban shared mutable collection mutation in parallel streams.
- Sequential vs parallel equivalence tests.
- Code review rule: no `forEach(shared::add)` in parallel stream.

## Lesson

```text
Parallel stream requires pure/stateless functions and safe collectors.
```

---

# 9. Case 06 — Pagination Drift karena Ordering Tidak Stabil

## Symptom

Client sees duplicate/missing items between pages.

## Context

Search endpoint uses offset pagination sorted by `createdAt desc`.

## Problematic Code

```sql
select *
from ticket
where tenant_id = ?
order by created_at desc
limit ? offset ?
```

Many tickets share same timestamp.

## Root Cause

Sort key not unique. DB can return tied rows in different order between requests.

## Diagnosis

- Duplicate IDs across page 1/page 2.
- Missing IDs after inserts.
- Rows have same `created_at`.

## Fix

Stable tie-breaker:

```sql
order by created_at desc, id desc
```

For dynamic data, prefer cursor pagination:

```text
cursor = lastCreatedAt + lastId
```

## Prevention

- Pagination tests with tied timestamps.
- API docs define stable ordering.
- Cursor pagination for large/changing datasets.

## Lesson

```text
Pagination requires deterministic ordering.
```

---

# 10. Case 07 — Queue Backlog karena Unbounded `ConcurrentLinkedQueue`

## Symptom

Memory rises during traffic spike. CPU okay, DB okay. OOM after queue grows.

## Context

Async notification worker.

## Problematic Code

```java
Queue<NotificationTask> queue = new ConcurrentLinkedQueue<>();

void submit(NotificationTask task) {
    queue.add(task);
}
```

Consumers cannot keep up.

## Root Cause

Unbounded queue hides overload and retains all tasks.

## Diagnosis

- Queue size metric absent initially.
- Heap dump shows many `NotificationTask`.
- Producer rate > consumer rate.

## Fix

Use bounded queue and backpressure/rejection.

```java
BlockingQueue<NotificationTask> queue = new ArrayBlockingQueue<>(10_000);

boolean accepted = queue.offer(task, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    throw new ServiceOverloadedException();
}
```

## Prevention

- Queue depth metrics.
- Bounded buffers.
- Rate limiting.
- Consumer lag alerts.

## Lesson

```text
An unbounded queue is deferred failure.
```

---

# 11. Case 08 — Collector Combiner Salah di Parallel Stream

## Symptom

Summary report correct in dev, wrong in production after enabling parallel processing.

## Context

Custom collector calculates count and total amount.

## Problematic Code

```java
Collector<Order, SummaryAcc, Summary> collector = Collector.of(
    SummaryAcc::new,
    SummaryAcc::add,
    (left, right) -> left,
    SummaryAcc::finish
);
```

## Root Cause

Combiner drops `right`.

Sequential stream never exercises combiner meaningfully.

## Diagnosis

- Sequential test passes.
- Parallel test fails.
- Direct combiner test reveals lost accumulator.

## Fix

```java
(left, right) -> left.merge(right)
```

## Prevention

- Every custom collector has combiner unit test.
- Sequential vs parallel equivalence test.
- Do not enable parallel unless collector supports it.

## Lesson

```text
A collector that works sequentially can still be wrong.
```

---

# 12. Case 09 — `subList` Retains Huge Backing List

## Symptom

Small response object retains hundreds of MB.

## Context

Service loads large list then keeps first 10 for cache.

## Problematic Code

```java
List<Item> all = loadAllItems();
List<Item> top10 = all.subList(0, 10);
cache.put(key, top10);
```

## Root Cause

`subList` is a view that may retain backing list.

## Diagnosis

- Heap dump: cached small list retains huge `ArrayList`.
- Dominator tree shows sublist -> parent list.

## Fix

```java
List<Item> top10 = List.copyOf(all.subList(0, 10));
cache.put(key, top10);
```

## Prevention

- Copy views before long-term storage.
- Avoid caching collection views.
- Heap retained-size review.

## Lesson

```text
A small view can retain a large backing collection.
```

---

# 13. Case 10 — `ConcurrentModificationException` dari Mutasi Saat Iterasi

## Symptom

Occasional `ConcurrentModificationException` during cleanup.

## Context

Remove expired sessions.

## Problematic Code

```java
for (Session session : sessions) {
    if (session.expired()) {
        sessions.remove(session);
    }
}
```

## Root Cause

Structural modification during enhanced-for iteration.

## Diagnosis

Stack trace points to iterator.

## Fix

```java
sessions.removeIf(Session::expired);
```

or:

```java
Iterator<Session> iterator = sessions.iterator();
while (iterator.hasNext()) {
    if (iterator.next().expired()) {
        iterator.remove();
    }
}
```

## Prevention

- Use `removeIf` for filtering mutable collections.
- Prefer building new immutable list if mutation not needed.

## Lesson

```text
Iterator contract matters when mutating collections.
```

---

# 14. Case 11 — Batch Import OOM karena Error List Tidak Dibatasi

## Symptom

Import invalid file causes OOM.

## Context

System collects all validation errors for every row and field.

## Problematic Code

```java
List<ValidationError> errors = new ArrayList<>();

for (Row row : rows) {
    errors.addAll(validate(row));
}
```

Invalid 5M-row file generates millions of errors.

## Root Cause

Unbounded error collection.

## Diagnosis

- Heap dump shows `ArrayList<ValidationError>`.
- Invalid file creates many errors per row.

## Fix

Cap errors and summarize.

```java
if (errors.size() < MAX_ERRORS) {
    errors.add(error);
} else {
    suppressedErrorCount++;
}
```

Result:

```java
record ValidationReport(
    List<ValidationError> errors,
    long suppressedErrorCount
) {}
```

## Prevention

- Max file size/row count.
- Max errors.
- Streaming validation.
- Reject obviously invalid format early.

## Lesson

```text
Diagnostics collections need limits too.
```

---

# 15. Case 12 — `ThreadLocal<List<...>>` Leak di Thread Pool

## Symptom

Memory grows under steady traffic. Data from previous request appears in logs.

## Context

Request diagnostic list stored in ThreadLocal.

## Problematic Code

```java
static final ThreadLocal<List<String>> EVENTS =
    ThreadLocal.withInitial(ArrayList::new);

void record(String event) {
    EVENTS.get().add(event);
}
```

No cleanup.

## Root Cause

Thread pool reuses threads. ThreadLocal value survives request.

## Diagnosis

- Heap dump: worker threads retain ArrayLists.
- Logs contain previous request data.

## Fix

```java
try {
    chain.doFilter(request, response);
} finally {
    EVENTS.remove();
}
```

## Prevention

- Always cleanup ThreadLocal in finally.
- Prefer request-scoped context object.
- Avoid ThreadLocal collections unless necessary.

## Lesson

```text
ThreadLocal in pooled threads is process-lifetime unless removed.
```

---

# 16. Case 13 — Hidden Security Leak dari Filter-After-Fetch

## Symptom

Audit shows service accessed records from other tenant even though response filtered them out.

## Context

Repository fetches by status, service filters tenant.

## Problematic Code

```java
List<Document> documents = repository.findByStatus(status);

return documents.stream()
    .filter(doc -> doc.tenantId().equals(currentTenant))
    .map(DocumentDto::from)
    .toList();
```

## Root Cause

Unauthorized data fetched before filtering. It can leak through logs/cache/timing/debug.

## Diagnosis

- DB audit shows cross-tenant rows read.
- Repository query lacks tenant predicate.

## Fix

```java
List<Document> documents =
    repository.findByTenantIdAndStatus(currentTenant, status);
```

Keep defense-in-depth service check if needed.

## Prevention

- Tenant predicate mandatory in repository methods.
- Security tests assert no cross-tenant query.
- Code review: no fetch-all-then-filter for authorization.

## Lesson

```text
Do not fetch data the caller is not authorized to see.
```

---

# 17. Case 14 — Wrong Report karena Time Bucket Tanpa Time Zone

## Symptom

Monthly report differs between users in different regions.

## Context

Aggregation by month.

## Problematic Code

```java
YearMonth month = YearMonth.from(order.createdAt());
```

If `createdAt` is `Instant`, conversion to month without explicit zone is wrong/impossible conceptually.

## Root Cause

Business month depends on business time zone.

## Diagnosis

- Orders near midnight UTC appear in wrong month for Asia/Jakarta.
- Tests did not include boundary time.

## Fix

```java
YearMonth month = YearMonth.from(order.createdAt().atZone(businessZoneId));
```

## Prevention

- Time bucket tests around midnight/month boundary.
- Define business timezone in report contract.
- Avoid system default zone.

## Lesson

```text
Time aggregation without explicit zone is a bug waiting to happen.
```

---

# 18. Case 15 — Listener Registry Leak

## Symptom

Old UI sessions still receive events; memory grows.

## Context

Session registers listener but never unregisters.

## Problematic Code

```java
listeners.add(session::sendEvent);
```

## Root Cause

Lambda captures session. Registry keeps listener forever.

## Diagnosis

- Heap dump: listener list retains old sessions.
- Event sent to closed session.

## Fix

Return subscription:

```java
AutoCloseable subscribe(Listener listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
}
```

Caller:

```java
try (AutoCloseable subscription = bus.subscribe(listener)) {
    ...
}
```

or unregister on session close.

## Prevention

- Registration APIs require lifecycle.
- Metrics for listener count.
- Tests for unregister.

## Lesson

```text
Every listener registration needs deregistration.
```

---

# 19. Case 16 — `HashSet` Broken karena Mutable `equals/hashCode`

## Symptom

`set.contains(user)` returns false for object that seems present.

## Context

User equality based on email. Email can change.

## Problematic Code

```java
class User {
    private String email;

    public boolean equals(Object o) {
        return o instanceof User other && Objects.equals(email, other.email);
    }

    public int hashCode() {
        return Objects.hash(email);
    }
}
```

Then:

```java
Set<User> users = new HashSet<>();
users.add(user);
user.changeEmail("new@example.com");
users.contains(user); // false
```

## Root Cause

Hash code changed after insertion.

## Diagnosis

- Debug hash before/after mutation.
- Set bucket no longer matches.

## Fix

- Use immutable key fields.
- Use stable ID for equality.
- Avoid mutable entity in hash set.
- Use `Map<UserId, User>`.

## Prevention

- Tests for mutable key fields.
- Code review equals/hashCode for entities.
- Prefer value objects as map keys.

## Lesson

```text
Hash-based collections require stable equality while contained.
```

---

# 20. Case 17 — `peek` Dipakai untuk Business Side Effect

## Symptom

Audit records missing for some processed orders.

## Context

Audit written in stream `peek`.

## Problematic Code

```java
boolean hasLargeOrder = orders.stream()
    .peek(audit::recordSeen)
    .anyMatch(order -> order.amountCents() > 10_000_000);
```

## Root Cause

`anyMatch` short-circuits. `peek` only runs until first match.

## Diagnosis

- Number of audit records less than number of orders.
- Missing audit after first matching order.

## Fix

If all orders must be audited:

```java
orders.forEach(audit::recordSeen);

boolean hasLargeOrder = orders.stream()
    .anyMatch(order -> order.amountCents() > 10_000_000);
```

or explicit loop.

## Prevention

- Ban business side effects in `peek`.
- Use `peek` only for temporary debug.

## Lesson

```text
Stream laziness and short-circuiting make peek unsafe for required side effects.
```

---

# 21. Case 18 — Resource Stream Tidak Ditutup

## Symptom

File descriptor exhaustion under batch jobs.

## Context

Many files processed using `Files.lines`.

## Problematic Code

```java
long count(Path path) throws IOException {
    return Files.lines(path)
        .filter(line -> line.contains("ERROR"))
        .count();
}
```

## Root Cause

Stream from `Files.lines` must be closed.

## Diagnosis

- OS reports too many open files.
- File handles remain open.
- Reproduced by processing many files.

## Fix

```java
long count(Path path) throws IOException {
    try (Stream<String> lines = Files.lines(path)) {
        return lines
            .filter(line -> line.contains("ERROR"))
            .count();
    }
}
```

## Prevention

- try-with-resources for resource-backed streams.
- Static analysis/code review.
- Load test many files.

## Lesson

```text
Some streams are resource owners; close them.
```

---

# 22. Case 19 — High-Cardinality Metrics Map Leak

## Symptom

Memory and metrics backend cost rise. Metrics query becomes slow.

## Context

Metric label uses user ID.

## Problematic Code

```java
metrics.counter("login.success", "userId", userId.toString())
    .increment();
```

## Root Cause

Each user creates unique time series. Metrics registries/backends retain label maps.

## Diagnosis

- Metrics cardinality analysis.
- Huge number of series for same metric.
- Heap has many meter IDs/tags.

## Fix

Use bounded labels:

```java
metrics.counter("login.success", "result", "success")
    .increment();
```

or aggregate by tenant tier/status.

## Prevention

- Metrics label allowlist.
- Cardinality review.
- Alerts on series count.

## Lesson

```text
Metric labels are keys in long-lived maps.
```

---

# 23. Case 20 — `groupingBy` pada Dataset Besar Menyebabkan OOM

## Symptom

Daily report job OOM.

## Context

Job loads millions of events and groups by user.

## Problematic Code

```java
Map<UserId, List<Event>> eventsByUser = events.stream()
    .collect(Collectors.groupingBy(Event::userId));
```

## Root Cause

Stores every event in memory grouped by user. Report only needs counts.

## Diagnosis

- Heap dump: `HashMap<UserId, ArrayList<Event>>`.
- Retained Event graph huge.
- Business output only count per user.

## Fix

Use downstream counting:

```java
Map<UserId, Long> countByUser = events.stream()
    .collect(Collectors.groupingBy(
        Event::userId,
        Collectors.counting()
    ));
```

Better: aggregate in DB/stream processor if data source large.

```sql
select user_id, count(*)
from events
where event_date = ?
group by user_id
```

## Prevention

- Do not group raw records if summary is enough.
- Memory cost review for `groupingBy`.
- Large data tests.

## Lesson

```text
The downstream collector determines whether grouping stores details or summaries.
```

---

# 24. Cross-Case Patterns

Across cases, repeated root causes appear.

## 24.1 Unclear duplicate policy

Data loss or exception.

## 24.2 Unclear ordering contract

Pagination drift and flaky responses.

## 24.3 Unbounded collection

OOM, cache leak, queue backlog.

## 24.4 Mutable exposure

Security and state corruption.

## 24.5 Lazy hidden work

N+1, file handles, late exceptions.

## 24.6 Side effects in stream

Missing audit, duplicate side effects, race.

## 24.7 Parallel without correctness proof

Wrong results.

## 24.8 Persistence context hidden collection

Memory growth.

## 24.9 Metrics/logging as collection storage

High-cardinality leaks.

## 24.10 Rule

Most production collection bugs are contract/lifecycle bugs.

---

# 25. Incident Response Playbook

When a collection/stream incident happens:

## 25.1 Identify symptom class

Latency, memory, correctness, security, concurrency, resource.

## 25.2 Capture evidence

- logs;
- metrics;
- heap dump;
- thread dump;
- SQL query count;
- GC logs;
- request sample;
- input size/cardinality.

## 25.3 Locate collection owner

Which collection retains/processes/mutates data?

## 25.4 Check contract

Null, duplicate, order, boundedness, mutability, lifecycle.

## 25.5 Reproduce small

Create minimal input with edge case.

## 25.6 Patch safely

Prefer explicit fix over clever rewrite.

## 25.7 Add guardrail

Test, metric, review rule, static check, limit.

---

# 26. Preventive Engineering Guardrails

## 26.1 Code review checklist

For every map/list/set crossing boundary.

## 26.2 Test templates

Null, duplicate, order, immutability, pagination.

## 26.3 Metrics

Collection sizes, queue depth, cache size, query count.

## 26.4 Limits

Max batch size, max errors, max page size.

## 26.5 Static analysis

Ban dangerous patterns:

- `parallelStream().forEach(list::add)`;
- `peek(repository::save)`;
- static mutable map without clear owner;
- raw `findAll().stream()` on repository.

## 26.6 Documentation

API contracts for collections.

---

# 27. Code Review Checklist

Ask:

## 27.1 What is collection lifecycle?

## 27.2 Is it bounded?

## 27.3 Can it contain null?

## 27.4 Can it contain duplicates?

## 27.5 Is order defined?

## 27.6 Is it mutable?

## 27.7 Is defensive copy needed?

## 27.8 Is it thread-safe?

## 27.9 Is it persistence-backed/lazy?

## 27.10 Can it trigger N+1?

## 27.11 Does stream have side effects?

## 27.12 Is resource stream closed?

## 27.13 Is collector parallel-safe?

## 27.14 Are map keys stable?

## 27.15 Is aggregation location correct?

---

# 28. Observability Checklist

Track:

## 28.1 Input size

## 28.2 Output size

## 28.3 Filtered count

## 28.4 Duplicate count

## 28.5 Null rejection count

## 28.6 Queue depth

## 28.7 Cache size

## 28.8 Eviction count

## 28.9 SQL query count

## 28.10 Processing duration

## 28.11 Heap usage

## 28.12 Error list suppressed count

## 28.13 Metrics cardinality

## 28.14 Listener count

---

# 29. Testing Checklist

Test:

## 29.1 Empty input

## 29.2 Single input

## 29.3 Multiple input

## 29.4 Null collection

## 29.5 Null element

## 29.6 Duplicate key

## 29.7 Order and tie-breaker

## 29.8 Mutable input mutation

## 29.9 Returned collection mutation

## 29.10 Snapshot vs live

## 29.11 Sequential vs parallel

## 29.12 Query count

## 29.13 Pagination boundary

## 29.14 Max size/cap

## 29.15 Resource close

---

# 30. Best Practices

## 30.1 Make collection contracts explicit

## 30.2 Treat merge functions as business rules

## 30.3 Prefer immutable snapshots at boundaries

## 30.4 Bound long-lived collections

## 30.5 Use stable ordering for pagination

## 30.6 Keep authorization in query predicates

## 30.7 Avoid side effects inside stream intermediate ops

## 30.8 Test custom collectors in parallel

## 30.9 Use DTO/projection for read APIs

## 30.10 Monitor collection sizes and cardinality

---

# 31. Latihan

## Latihan 1 — N+1 Incident Review

Given stream DTO mapping over lazy entity collection, write diagnosis and fix.

## Latihan 2 — Duplicate Merge Incident

Given `toMap(..., (a,b)->b)`, decide whether fix is reject, first-wins, latest-wins, or merge.

## Latihan 3 — Static Cache Leak

Design bounded cache policy for a static map replacement.

## Latihan 4 — Mutable Roles Leak

Write tests proving roles cannot be mutated from outside.

## Latihan 5 — Parallel Stream Race

Create failing repeated test for shared `ArrayList`, then fix.

## Latihan 6 — Pagination Drift

Create data with same timestamp and prove unstable order without tie-breaker.

## Latihan 7 — Queue Backlog

Add queue depth metric and bounded offer timeout.

## Latihan 8 — Collector Combiner

Find bug in collector combiner and write parallel equivalence test.

## Latihan 9 — Error List Cap

Implement validation report with suppressed count.

## Latihan 10 — Incident Checklist

Take one collection-heavy method and apply the code review checklist.

---

# 32. Ringkasan

Production failures around Collections and Streams usually come from implicit contracts.

Core lessons:

- Stream mapping over entities can hide N+1.
- `toMap` merge function is business policy.
- Unbounded maps/queues/error lists leak memory.
- Mutable collection exposure can become security bug.
- Parallel streams require safe collectors and no shared mutable state.
- Pagination requires stable ordering.
- `subList` and views can retain large backing data.
- ThreadLocal collections must be cleaned.
- Filter-after-fetch can be a security leak.
- Time aggregation needs explicit zone.
- Listener registries need unsubscribe lifecycle.
- Hash collections require stable equality/hashCode.
- `peek` is unsafe for required side effects.
- Resource-backed streams must be closed.
- Metrics labels can create map/cardinality leaks.
- `groupingBy` raw records can OOM if only summary needed.

Main rule:

```text
Every production collection must have a contract:
ownership, size, ordering, duplicates, nulls, mutability,
concurrency, lifecycle, security visibility, and observability.
```

---

# 33. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `Collectors.toMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#toMap(java.util.function.Function,java.util.function.Function)

3. Java SE 25 — `Collectors.groupingBy`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#groupingBy(java.util.function.Function)

4. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

5. Java SE 25 — `ConcurrentLinkedQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentLinkedQueue.html

6. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

7. Java SE 25 — `List.subList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#subList(int,int)

8. Java SE 25 — `ThreadLocal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html

9. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

10. OpenJDK jcstress  
    https://openjdk.org/projects/code-tools/jcstress/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-059.md](./learn-java-collections-and-streams-part-059.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-061.md](./learn-java-collections-and-streams-part-061.md)

</div>