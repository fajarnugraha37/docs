# learn-java-collections-and-streams-part-061.md

# Java Collections and Streams — Part 061  
# Collections and Streams Design Review Checklist: Contracts, Nulls, Duplicates, Ordering, Mutability, Concurrency, Persistence, Security, Performance, Testing, and Observability

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **061**  
> Fokus: menyediakan checklist review desain dan kode untuk semua penggunaan Collections dan Streams di production-grade Java systems. Bagian ini merangkum pola-pola dari seluruh seri menjadi alat review yang bisa dipakai saat desain API, code review, refactoring, incident prevention, dan readiness check sebelum release.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Review Collections sebagai Contract, State, dan Dataflow](#2-mental-model-review-collections-sebagai-contract-state-dan-dataflow)
3. [Checklist 00 — Context dan Ownership](#3-checklist-00--context-dan-ownership)
4. [Checklist 01 — API Contract](#4-checklist-01--api-contract)
5. [Checklist 02 — Null, Missing, Empty](#5-checklist-02--null-missing-empty)
6. [Checklist 03 — Duplicate Semantics](#6-checklist-03--duplicate-semantics)
7. [Checklist 04 — Ordering Semantics](#7-checklist-04--ordering-semantics)
8. [Checklist 05 — Mutability and Defensive Copy](#8-checklist-05--mutability-and-defensive-copy)
9. [Checklist 06 — Equality, Hashing, and Keys](#9-checklist-06--equality-hashing-and-keys)
10. [Checklist 07 — Map Design](#10-checklist-07--map-design)
11. [Checklist 08 — Set Design](#11-checklist-08--set-design)
12. [Checklist 09 — List Design](#12-checklist-09--list-design)
13. [Checklist 10 — Stream Design](#13-checklist-10--stream-design)
14. [Checklist 11 — Collector Design](#14-checklist-11--collector-design)
15. [Checklist 12 — Performance Cost Model](#15-checklist-12--performance-cost-model)
16. [Checklist 13 — Memory and Lifecycle](#16-checklist-13--memory-and-lifecycle)
17. [Checklist 14 — Concurrency](#17-checklist-14--concurrency)
18. [Checklist 15 — Persistence/ORM](#18-checklist-15--persistenceorm)
19. [Checklist 16 — Security](#19-checklist-16--security)
20. [Checklist 17 — Pagination and Large Data](#20-checklist-17--pagination-and-large-data)
21. [Checklist 18 — Batch APIs](#21-checklist-18--batch-apis)
22. [Checklist 19 — Aggregation](#22-checklist-19--aggregation)
23. [Checklist 20 — Functional Style](#23-checklist-20--functional-style)
24. [Checklist 21 — Debuggability](#24-checklist-21--debuggability)
25. [Checklist 22 — Testing](#25-checklist-22--testing)
26. [Checklist 23 — Observability](#26-checklist-23--observability)
27. [Checklist 24 — Error Handling](#27-checklist-24--error-handling)
28. [Checklist 25 — Code Smell Triggers](#28-checklist-25--code-smell-triggers)
29. [Review Templates](#29-review-templates)
30. [Example Review 1 — REST Search Endpoint](#30-example-review-1--rest-search-endpoint)
31. [Example Review 2 — Batch Import Endpoint](#31-example-review-2--batch-import-endpoint)
32. [Example Review 3 — Repository Stream Export](#32-example-review-3--repository-stream-export)
33. [Example Review 4 — In-Memory Cache](#33-example-review-4--in-memory-cache)
34. [Example Review 5 — Aggregation Report](#34-example-review-5--aggregation-report)
35. [Release Readiness Checklist](#35-release-readiness-checklist)
36. [Incident Prevention Guardrails](#36-incident-prevention-guardrails)
37. [Best Practices](#37-best-practices)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Bagian ini bukan membahas API baru atau syntax baru. Ini adalah **review tool**.

Saat melihat kode seperti:

```java
Map<ProductId, OrderLine> lineByProduct = lines.stream()
    .collect(Collectors.toMap(
        OrderLine::productId,
        Function.identity(),
        (oldLine, newLine) -> newLine
    ));
```

reviewer harus langsung bertanya:

```text
Apakah duplicate product ID valid?
Kenapa latest-wins?
Apakah quantity harus digabung?
Apakah order line hilang?
Apakah ada test duplicate?
```

Saat melihat:

```java
return entity.getChildren().stream()
    .map(ChildDto::from)
    .toList();
```

reviewer harus bertanya:

```text
Apakah children lazy?
Apakah transaction masih hidup?
Apakah ini memicu N+1?
Apakah DTO mapping terjadi di service boundary?
```

Saat melihat:

```java
private static final Map<String, Value> CACHE = new ConcurrentHashMap<>();
```

reviewer harus bertanya:

```text
Bounded?
Eviction?
Key cardinality?
Metrics?
Lifecycle?
```

Tujuan utama:

- membuat checklist review yang repeatable;
- mengurangi reliance pada “feeling”;
- menemukan bug sebelum production;
- menjaga consistency team;
- membuat Collections/Streams design eksplisit.

---

# 2. Mental Model: Review Collections sebagai Contract, State, dan Dataflow

Setiap penggunaan collection/stream bisa dilihat dari tiga lensa.

## 2.1 Contract

Collection yang melewati boundary adalah kontrak.

```text
null?
empty?
duplicates?
order?
max size?
mutable?
```

## 2.2 State

Collection yang disimpan adalah state.

```text
owner?
lifecycle?
thread-safe?
bounded?
evicted?
retained?
```

## 2.3 Dataflow

Stream adalah dataflow.

```text
source?
lazy?
one-shot?
terminal?
side effect?
materialization?
```

## 2.4 Main rule

```text
Review collections by asking:
What contract does it expose?
What state does it retain?
What dataflow does it execute?
```

---

# 3. Checklist 00 — Context dan Ownership

Gunakan ini sebelum checklist lain.

## Pertanyaan

- Collection ini local variable, field, static, request DTO, response DTO, entity field, cache, queue, atau intermediate result?
- Siapa pemilik collection?
- Siapa boleh membaca?
- Siapa boleh mutate?
- Berapa lama collection hidup?
- Apakah collection melewati trust boundary?
- Apakah collection melewati thread boundary?
- Apakah collection melewati transaction boundary?
- Apakah data di dalamnya sensitive?
- Apakah size dapat dikontrol user?
- Apakah element punya lifecycle sendiri?

## Red flags

```java
static final Map<...> cache = new ConcurrentHashMap<>();
```

```java
private final List<...> results = new ArrayList<>();
```

di singleton service.

```java
public List<Item> getItems() {
    return items;
}
```

## Review outcome

Setiap collection harus punya owner dan lifecycle jelas.

---

# 4. Checklist 01 — API Contract

Untuk request/response/internal API.

## Pertanyaan

- Apakah field collection required?
- Apakah boleh missing?
- Apakah boleh null?
- Apakah empty valid?
- Apakah null element valid?
- Apakah duplicate valid?
- Apakah order dijamin?
- Apakah max size ditentukan?
- Apakah response selalu mengembalikan empty array, bukan null?
- Apakah pagination diperlukan?
- Apakah partial failure mungkin?
- Apakah per-item error punya index/client ID?
- Apakah collection result mutable atau immutable?
- Apakah API docs menyebut semantics ini?

## Red flags

```java
List<Item> items; // no validation
```

```json
"items": null
```

untuk response collection biasa.

## Review outcome

Collection API contract harus tertulis dan dites.

---

# 5. Checklist 02 — Null, Missing, Empty

## Pertanyaan

- Apa beda missing/null/empty?
- Untuk PATCH, apakah missing berarti no-change?
- Apakah null berarti clear atau invalid?
- Apakah empty berarti clear-all, no-op, atau invalid?
- Apakah element null ditolak?
- Apakah `List.of`, `Set.copyOf`, `Map.copyOf` dipakai untuk reject null?
- Apakah mapper bisa menghasilkan null?
- Apakah null disembunyikan oleh filter tanpa report?

## Red flags

```java
if (items == null) {
    items = List.of();
}
```

tanpa contract.

```java
.map(this::toDtoOrNull)
```

## Review outcome

Null/missing/empty harus menjadi explicit policy, bukan accident.

---

# 6. Checklist 03 — Duplicate Semantics

## Pertanyaan

- Apakah duplicates valid?
- Jika duplicate valid, apakah dipreserve, merge, atau count?
- Jika duplicate invalid, apakah reject?
- Untuk `toMap`, merge function policy apa?
- Apakah first-wins/latest-wins benar-benar business rule?
- Apakah duplicate key test ada?
- Apakah DB unique constraint juga ada jika ini invariant?
- Apakah duplicate batch command idempotent?

## Red flags

```java
(oldValue, newValue) -> newValue
```

tanpa komentar/test.

```java
Set.copyOf(list)
```

dipakai untuk silently dedup request yang harusnya error.

## Review outcome

Duplicate handling harus sesuai domain dan diuji.

---

# 7. Checklist 04 — Ordering Semantics

## Pertanyaan

- Apakah order penting?
- Apakah source collection menjamin order?
- Apakah map/set implementation menjaga order?
- Apakah response order terdokumentasi?
- Apakah sorting punya tie-breaker?
- Apakah pagination memakai stable order?
- Apakah parallel stream mengubah order?
- Apakah collector menghasilkan ordered map/list?
- Apakah tests assert exact order?

## Red flags

```java
new HashMap<>().values().stream().toList()
```

untuk response ordered.

```sql
order by created_at desc
```

tanpa `id` tie-breaker untuk pagination.

## Review outcome

Jika order penting, harus eksplisit di query/collection/sort/test.

---

# 8. Checklist 05 — Mutability and Defensive Copy

## Pertanyaan

- Apakah collection field private?
- Apakah constructor defensively copies input?
- Apakah getter return snapshot/unmodifiable view/live view?
- Apakah nested collections juga dicopy?
- Apakah element immutable?
- Apakah collection security-sensitive?
- Apakah caller bisa mutate internal state?
- Apakah result object immutable?
- Apakah using `Collections.unmodifiableList` over mutable backing aman?
- Apakah `List.copyOf`/`Set.copyOf`/`Map.copyOf` lebih tepat?

## Red flags

```java
return internalList;
```

```java
this.roles = roles;
```

tanpa copy.

## Review outcome

Boundary objects harus menggunakan immutable snapshots atau domain methods.

---

# 9. Checklist 06 — Equality, Hashing, and Keys

## Pertanyaan

- Apakah object digunakan sebagai `Map` key atau `Set` element?
- Apakah `equals/hashCode` stabil selama object berada di collection?
- Apakah key immutable?
- Apakah entity ID null sebelum persist?
- Apakah mutable field dipakai dalam hashCode?
- Apakah comparator konsisten dengan equals?
- Apakah composite key memakai record/value object?
- Apakah key terlalu besar dan menahan object graph?
- Apakah key canonical/normalized?

## Red flags

```java
record CacheKey(User user, Request request) {}
```

```java
hashCode() based on mutable email
```

## Review outcome

Keys harus compact, immutable, normalized, dan equality-stable.

---

# 10. Checklist 07 — Map Design

## Pertanyaan

- Apa arti key dan value?
- Apakah missing key valid?
- Apakah null value valid?
- Apakah duplicate key policy jelas?
- Apakah map ordered?
- Apakah map long-lived?
- Apakah map bounded?
- Apakah map thread-safe?
- Apakah map exposed langsung?
- Apakah map mewakili cache/index/registry/aggregation?
- Apakah `Map<String,Object>` bisa diganti typed DTO?
- Apakah dynamic keys divalidasi/whitelisted?

## Red flags

```java
Map<String, Object> context
```

lintas banyak layer.

```java
cache.computeIfAbsent(userInput, ...)
```

tanpa bound.

## Review outcome

Map harus punya key/value/missing/duplicate/order/concurrency/lifecycle policy.

---

# 11. Checklist 08 — Set Design

## Pertanyaan

- Apakah uniqueness berdasarkan equals benar?
- Apakah duplicates harus ditolak atau collapsed?
- Apakah order penting? Jika ya, apakah `LinkedHashSet`/sort dibutuhkan?
- Apakah element immutable?
- Apakah Set digunakan untuk roles/permissions/security?
- Apakah Set output perlu stable order?
- Apakah DB unique constraint juga ada?

## Red flags

```java
HashSet<EntityWithMutableHash>
```

```java
roles().add(ADMIN)
```

possible from outside.

## Review outcome

Set semantics harus intentional, bukan sekadar “biar unique”.

---

# 12. Checklist 09 — List Design

## Pertanyaan

- Apakah index/order punya arti domain?
- Apakah duplicate allowed?
- Apakah list bisa besar?
- Apakah random access diperlukan?
- Apakah insertion order cukup atau harus persisted/query order?
- Apakah list exposed mutable?
- Apakah subList/view disimpan long-term?
- Apakah list dipakai untuk membership lookup yang seharusnya Set?

## Red flags

```java
list.contains(x)
```

di nested loop besar.

```java
cache.put(key, hugeList.subList(0, 10))
```

## Review outcome

List harus dipakai saat order/sequence memang penting.

---

# 13. Checklist 10 — Stream Design

## Pertanyaan

- Apakah stream punya terminal operation?
- Apakah stream digunakan sekali?
- Apakah stream source resource-backed?
- Apakah stream perlu ditutup?
- Apakah pipeline pure?
- Apakah ada side effect di `map/filter/peek`?
- Apakah `peek` hanya debug?
- Apakah stream bisa infinite?
- Apakah stateful ops (`sorted`, `distinct`, `groupingBy`) aman untuk size?
- Apakah parallel stream benar-benar dibutuhkan?
- Apakah source order jelas?
- Apakah exception timing dipahami?

## Red flags

```java
stream.peek(repository::save)
```

```java
Files.lines(path).filter(...).count()
```

tanpa try-with-resources.

```java
parallelStream().forEach(list::add)
```

## Review outcome

Stream harus jelas sebagai lazy one-shot dataflow dengan side effect minimal.

---

# 14. Checklist 11 — Collector Design

## Pertanyaan

- Apakah collector result mutable atau immutable?
- Apakah combiner benar?
- Apakah collector parallel-safe?
- Apakah duplicate key policy benar?
- Apakah downstream collector menyimpan raw list padahal hanya butuh count?
- Apakah grouping cardinality bisa besar?
- Apakah finisher copy nested collections?
- Apakah collector characteristics benar?
- Apakah sequential vs parallel equivalence diuji?

## Red flags

```java
(left, right) -> left
```

combiner.

```java
groupingBy(..., toList())
```

untuk dataset besar padahal hanya perlu count.

## Review outcome

Collector harus diuji sebagai mini-algorithm, bukan dianggap boilerplate.

---

# 15. Checklist 12 — Performance Cost Model

## Pertanyaan

- Apakah operasi O(n), O(n log n), O(n²)?
- Apakah nested stream melakukan repeated scan?
- Apakah map index bisa mengubah O(n²) ke O(n)?
- Apakah boxing besar terjadi?
- Apakah sorting semua data perlu?
- Apakah top-N bisa pakai bounded heap?
- Apakah contains pada List besar harus jadi Set?
- Apakah `distinct`/`sorted`/`groupingBy` memory-heavy?
- Apakah parallel stream overhead lebih besar dari benefit?
- Apakah benchmark realistis tersedia?

## Red flags

```java
orders.stream()
    .map(order -> customers.stream()
        .filter(c -> c.id().equals(order.customerId()))
        .findFirst())
```

## Review outcome

Collection performance harus punya cost model sesuai data size dan cardinality.

---

# 16. Checklist 13 — Memory and Lifecycle

## Pertanyaan

- Apakah collection bisa tumbuh tanpa batas?
- Apakah ada max size?
- Apakah ada eviction/TTL?
- Apakah ada cleanup/remove?
- Apakah queue bounded?
- Apakah ThreadLocal removed?
- Apakah listener unregistered?
- Apakah static map dibersihkan?
- Apakah subList/view disimpan?
- Apakah values/keys retain large object graph?
- Apakah error list capped?
- Apakah metrics label cardinality bounded?

## Red flags

```java
static final List<Event> EVENTS = new ArrayList<>();
```

```java
ThreadLocal.withInitial(ArrayList::new)
```

tanpa `remove`.

## Review outcome

Long-lived collection harus punya growth policy.

---

# 17. Checklist 14 — Concurrency

## Pertanyaan

- Apakah collection shared antar thread?
- Apakah collection mutable?
- Apakah safe publication ada?
- Apakah final/volatile/synchronized/concurrent utility dipakai?
- Apakah compound action atomic?
- Apakah iteration fail-fast, snapshot, atau weakly consistent?
- Apakah synchronized wrapper diiterasi dalam synchronized block?
- Apakah map update pakai `computeIfAbsent`/`merge`?
- Apakah parallel stream memakai shared mutable state?
- Apakah queue punya shutdown/interruption strategy?

## Red flags

```java
private final Map<K,V> map = new HashMap<>();
```

di singleton accessed by requests.

```java
if (!map.containsKey(k)) map.put(k, v);
```

di concurrent context.

## Review outcome

Shared mutable collections membutuhkan concurrency design eksplisit.

---

# 18. Checklist 15 — Persistence/ORM

## Pertanyaan

- Apakah collection entity lazy?
- Apakah access terjadi dalam transaction?
- Apakah DTO mapping memicu N+1?
- Apakah repository return Stream ditutup?
- Apakah collection fetch join dengan pagination aman?
- Apakah large child collection di-load?
- Apakah dirty checking bergantung pada collection replacement/mutation?
- Apakah cascade/orphan sesuai ownership?
- Apakah order persisted/query-defined?
- Apakah entity equality aman untuk Set/Map?

## Red flags

```java
entity.children().stream().map(...).toList()
```

tanpa fetch strategy jelas.

```java
repository.findAll().stream()
```

di table besar.

## Review outcome

Persistence-backed collection harus direview sebagai database operation.

---

# 19. Checklist 16 — Security

## Pertanyaan

- Apakah collection berisi sensitive data?
- Apakah response least-privilege?
- Apakah roles/permissions immutable?
- Apakah collection input size dibatasi?
- Apakah per-item authorization dilakukan?
- Apakah authorization difilter di query, bukan setelah fetch?
- Apakah map keys/sort/filter whitelisted?
- Apakah duplicates bisa menyebabkan repeated side effect?
- Apakah collection logging redacted?
- Apakah parallel/lazy stream memakai immutable security context?

## Red flags

```java
repository.findAll().stream().filter(canRead)
```

```java
log.info("users={}", users)
```

with PII.

## Review outcome

Collection crossing trust boundary harus validated, bounded, authorized, and redacted.

---

# 20. Checklist 17 — Pagination and Large Data

## Pertanyaan

- Apakah result bisa besar?
- Apakah API punya page size max?
- Apakah ordering deterministic?
- Apakah tie-breaker ada?
- Apakah offset pagination cukup atau cursor perlu?
- Apakah total count sensitive/expensive?
- Apakah no duplicates/no missing across pages tested?
- Apakah request batch size max?
- Apakah export menggunakan stream/batch dengan resource lifecycle?
- Apakah backpressure ada?

## Red flags

```java
List<T> findAll()
```

untuk endpoint.

```sql
order by created_at desc
```

tanpa tie-breaker.

## Review outcome

Large data harus dipaginate, dibatch, atau distream dengan batas dan lifecycle.

---

# 21. Checklist 18 — Batch APIs

## Pertanyaan

- Apakah max batch size ditentukan?
- Apakah empty batch valid?
- Apakah duplicate item ID valid?
- Apakah idempotency key ada?
- Apakah per-item authorization?
- Apakah all-or-nothing atau partial success?
- Apakah per-item response punya index/client ID?
- Apakah error list capped?
- Apakah transaction scope jelas?
- Apakah retry behavior aman?

## Red flags

```java
process(List<Command> commands)
```

tanpa size/idempotency/partial failure contract.

## Review outcome

Batch collection API harus punya abuse, failure, and retry design.

---

# 22. Checklist 19 — Aggregation

## Pertanyaan

- Apa input scope?
- Apa grouping key?
- Apa null bucket policy?
- Apa duplicate policy?
- Apa metrics?
- Apakah zero buckets harus tampil?
- Apakah result typed atau raw nested map?
- Apakah aggregation di Java tepat atau harus di DB?
- Apakah grouping stores raw lists unnecessarily?
- Apakah time bucket punya timezone?
- Apakah custom collector combiner benar?
- Apakah output immutable?

## Red flags

```java
Map<A, Map<B, Map<C, Long>>>
```

sebagai public contract.

```java
groupingBy(..., toList())
```

when only counts needed.

## Review outcome

Aggregation adalah business logic dan butuh contract/model/test.

---

# 23. Checklist 20 — Functional Style

## Pertanyaan

- Apakah stream chain readable?
- Apakah lambda terlalu panjang?
- Apakah predicate/mapper perlu diberi nama?
- Apakah function pure?
- Apakah side effect tersembunyi?
- Apakah Optional interop memakai `Optional::stream`?
- Apakah error expected dimodelkan sebagai data?
- Apakah functional style menyembunyikan workflow?
- Apakah loop lebih jelas?

## Red flags

```java
.map(x -> { save(x); audit(x); return toDto(x); })
```

## Review outcome

Functional style harus memperjelas transformation, bukan menyembunyikan workflow.

---

# 24. Checklist 21 — Debuggability

## Pertanyaan

- Apakah pipeline bisa dipecah untuk debug?
- Apakah lambdas bernama?
- Apakah error message menyebut key/index/path?
- Apakah duplicate conflicts mudah dilacak?
- Apakah logs aman dan cukup?
- Apakah metrics size/count ada?
- Apakah tests bisa mereproduksi edge case kecil?
- Apakah result object mudah diinspect?

## Red flags

```java
.filter(x -> complex condition 1)
.map(x -> complex mapping 40 lines)
.collect(custom complicated collector)
```

tanpa named methods/tests.

## Review outcome

Kode collection-heavy harus mudah diobservasi dan dipecah.

---

# 25. Checklist 22 — Testing

## Pertanyaan

- Empty input tested?
- Single element tested?
- Multiple elements tested?
- Null collection tested?
- Null element tested?
- Duplicate tested?
- Order tested?
- Tie-breaker tested?
- Defensive copy tested?
- Immutability tested?
- Snapshot/live semantics tested?
- Collector combiner tested?
- Sequential vs parallel tested?
- Query count tested?
- Pagination boundary tested?
- Max size/cap tested?
- Concurrency invariant tested?

## Red flags

```java
assertEquals(3, result.size());
```

as only assertion.

## Review outcome

Test harus assert collection contract secara lengkap.

---

# 26. Checklist 23 — Observability

## Pertanyaan

- Input size metric?
- Output size metric?
- Filtered count?
- Duplicate count?
- Null reject count?
- Batch size?
- Queue depth?
- Cache size?
- Eviction count?
- Listener count?
- Query count?
- Group cardinality?
- Error suppressed count?
- Processing duration?
- Memory/GC trend?
- Metrics cardinality bounded?

## Red flags

No metric for unbounded cache/queue.

## Review outcome

Collection size/cardinality/lifecycle harus visible.

---

# 27. Checklist 24 — Error Handling

## Pertanyaan

- Apakah error per item punya index/path/id?
- Apakah duplicate key error informative tapi tidak bocorkan sensitive data?
- Apakah validation failures accumulated atau fail-fast?
- Apakah exception timing stream lazy dipahami?
- Apakah resource closed on exception?
- Apakah partial failure response clear?
- Apakah retry safe?
- Apakah expected errors dimodelkan sebagai data?

## Red flags

```java
throw new RuntimeException("bad item")
```

tanpa index/key.

## Review outcome

Collection errors harus actionable dan correlated.

---

# 28. Checklist 25 — Code Smell Triggers

Jika melihat pola ini, lakukan review ekstra:

## Smells

```java
findAll().stream()
```

```java
parallelStream()
```

```java
peek(...)
```

```java
Collectors.toMap(..., ..., (a,b) -> b)
```

```java
groupingBy(..., toList())
```

untuk dataset besar.

```java
static Map
```

```java
ThreadLocal<List<...>>
```

```java
subList(...)
```

yang disimpan.

```java
Map<String, Object>
```

```java
return internalCollection;
```

```java
Collections.unmodifiableList(mutable)
```

untuk boundary security.

```java
new HashSet<Entity>()
```

dengan mutable entity.

```java
queue.add(...)
```

ke unbounded queue.

```java
Files.lines(...)
```

tanpa try-with-resources.

## Review outcome

Smell bukan selalu bug, tetapi wajib ada alasan/test/guardrail.

---

# 29. Review Templates

## 29.1 Short review comment template

```text
Collection contract belum jelas:
- duplicate behavior?
- ordering guarantee?
- null/empty semantics?
- max size?
- mutability of returned result?
Tolong tambahkan contract + tests.
```

## 29.2 Map merge review comment

```text
Merge function `(old, new) -> new` berarti latest-wins dan bisa drop data.
Apakah ini business rule?
Jika duplicate invalid, throw.
Jika duplicate combinable, merge explicitly.
Tambahkan test duplicate.
```

## 29.3 Stream side effect review comment

```text
Pipeline ini punya side effect di intermediate operation.
Karena stream lazy/short-circuit/parallel-sensitive, side effect bisa tidak predictable.
Sebaiknya pisahkan transformation dan imperative side effect.
```

## 29.4 Persistence review comment

```text
DTO mapping ini mengakses lazy collection.
Perlu bukti tidak N+1: fetch strategy/projection + query-count test.
```

## 29.5 Memory review comment

```text
Collection ini long-lived/unbounded.
Perlu max size/TTL/eviction/cleanup + metrics.
```

---

# 30. Example Review 1 — REST Search Endpoint

Code:

```java
@GetMapping("/tickets")
List<TicketDto> search(SearchRequest request) {
    return ticketService.search(request);
}
```

Service:

```java
List<TicketDto> search(SearchRequest request) {
    return repository.findByStatus(request.status()).stream()
        .filter(ticket -> ticket.tenantId().equals(currentTenant.id()))
        .map(TicketDto::from)
        .toList();
}
```

## Review findings

- Return list unbounded.
- Authorization/tenant filter after fetch.
- No pagination.
- Order unspecified.
- Potential lazy mapping.
- No max page size.
- No query count test.

## Better design

```java
Page<TicketDto> search(SearchRequest request, PageRequest pageRequest) {
    return repository.searchVisibleTickets(
        currentTenant.id(),
        request.status(),
        pageRequest.withSort(Sort.by("createdAt").descending().and(Sort.by("id").descending()))
    );
}
```

## Required tests

- tenant isolation;
- pagination order/tie;
- empty result;
- max page size;
- no N+1 if mapping associations.

---

# 31. Example Review 2 — Batch Import Endpoint

Code:

```java
@PostMapping("/users/import")
ImportResult importUsers(@RequestBody List<UserImportDto> users) {
    return importService.importUsers(users);
}
```

## Review findings

- No max batch size.
- Null list/element policy unclear.
- Duplicate email policy unclear.
- Partial failure unclear.
- Error cap unclear.
- Idempotency unclear.
- Per-item authorization not mentioned.

## Better contract

```text
Max 500 users.
Null list invalid.
Null elements invalid.
Duplicate email rejected.
Partial success allowed.
Each result includes request index and clientRowId.
Max 1000 validation errors returned.
```

## Required tests

- null input;
- empty input;
- 501 rows rejected;
- duplicate email;
- invalid rows aggregated;
- partial success response order/correlation.

---

# 32. Example Review 3 — Repository Stream Export

Code:

```java
Stream<Order> exportOrders() {
    return repository.streamAll();
}
```

## Review findings

- Stream close ownership unclear.
- Transaction boundary unclear.
- DB cursor leak risk.
- Caller can consume outside transaction.
- N+1 risk during mapping.
- No backpressure/export sink.

## Better design

```java
@Transactional(readOnly = true)
void exportOrders(OrderExportSink sink) {
    try (Stream<OrderProjection> orders = repository.openOrderExportStream()) {
        orders.forEach(sink::write);
    }
}
```

## Required tests

- stream closed on success/error;
- query count controlled;
- large export does not materialize all;
- transaction boundary valid.

---

# 33. Example Review 4 — In-Memory Cache

Code:

```java
private final Map<String, Result> cache = new ConcurrentHashMap<>();

Result get(String key) {
    return cache.computeIfAbsent(key, this::load);
}
```

## Review findings

- No max size.
- No TTL.
- User-controlled key?
- No eviction metrics.
- `load` failure behavior unclear.
- `computeIfAbsent` side effect/latency unclear.

## Better design

- Use bounded cache library or explicit cache policy.
- Key normalized and compact.
- Metrics: size/hit/miss/eviction/load failures.
- Define negative caching behavior.

## Required tests

- key normalization;
- failure not cached unless intended;
- eviction/TTL behavior;
- max size.

---

# 34. Example Review 5 — Aggregation Report

Code:

```java
Map<TenantId, Map<YearMonth, Map<Status, Long>>> report = orders.stream()
    .collect(groupingBy(Order::tenantId,
        groupingBy(order -> YearMonth.from(order.createdAt()),
            groupingBy(Order::status, counting()))));
```

## Review findings

- Raw nested map hard as contract.
- Time zone missing.
- Zero buckets missing.
- Authorization scope unclear.
- Large dataset maybe should aggregate in DB.
- Result mutability unclear.

## Better design

```java
record TenantMonthlyStatusRow(
    TenantId tenantId,
    YearMonth month,
    long paid,
    long cancelled,
    long refunded
) {}
```

Use explicit zone:

```java
YearMonth.from(order.createdAt().atZone(businessZone))
```

## Required tests

- time zone boundary;
- zero bucket;
- duplicate policy;
- authorization scope;
- immutable result;
- DB aggregation decision for large data.

---

# 35. Release Readiness Checklist

Before release, ensure:

## API

- Collection contracts documented.
- Null/empty/duplicate/order semantics clear.
- Pagination/max size enforced.

## Code

- No unbounded long-lived collections.
- No dangerous stream side effects.
- No resource streams unclosed.
- No shared mutable collections without concurrency design.
- No entity lazy collection mapping without fetch/query strategy.

## Tests

- Edge cases tested.
- Duplicate/order/null tests present.
- Query-count tests for ORM mapping.
- Parallel collector tests if applicable.
- Max size/boundary tests.

## Observability

- Sizes/cardinality measured.
- Queue/cache metrics present.
- SQL query counts/traces available.
- Error suppressed counts visible.

---

# 36. Incident Prevention Guardrails

## 36.1 Team standards

- Return empty collections, not null.
- Do not expose mutable collections.
- Define duplicate policy for every `toMap`.
- Stable ordering for pagination.
- Bound long-lived collections.
- Close resource-backed streams.
- No side effects in `peek`.

## 36.2 Automation ideas

- Static analysis regex for `parallelStream().forEach(.*add`.
- Code search for `static.*Map`.
- Code search for `ThreadLocal<.*List`.
- Code search for `Files.lines` without try-with-resources.
- Code search for `Collectors.toMap` with latest-wins.
- Code search for `findAll().stream`.

## 36.3 Review culture

Every collection-heavy PR must answer:

```text
What can go wrong with size, order, duplicates, nulls,
mutability, concurrency, persistence, and security?
```

---

# 37. Best Practices

## 37.1 Treat collection choices as design decisions

`List`, `Set`, `Map`, `Stream` are contracts.

## 37.2 Write down semantics

Especially for API and batch operations.

## 37.3 Prefer immutable boundaries

Copy input/output.

## 37.4 Use typed models over raw maps

Improve maintainability.

## 37.5 Bound growth

Caches, queues, errors, metrics.

## 37.6 Keep stream transformations pure

Side effects explicit.

## 37.7 Test edge cases

Null, empty, duplicate, order, size.

## 37.8 Observe cardinality

Size metrics prevent surprises.

## 37.9 Push work to right layer

DB for DB aggregations, stream processor for continuous windows.

## 37.10 Review lifecycle

Who adds, who removes, who closes, who owns?

---

# 38. Latihan

## Latihan 1 — Review `toMap`

Review code with `(a,b)->b` merge. Write review comment and tests.

## Latihan 2 — Review REST List Response

Given endpoint returning `List<T>`, identify pagination/order/null/empty issues.

## Latihan 3 — Review Mutable Getter

Find mutation leak in class exposing internal list. Fix and test.

## Latihan 4 — Review Static Cache

Design cache policy and metrics for static map replacement.

## Latihan 5 — Review Entity Mapping

Find N+1 risk in stream mapper accessing lazy collection.

## Latihan 6 — Review Batch API

Define contract for max size, duplicates, partial failure, idempotency.

## Latihan 7 — Review Aggregation

Replace nested map report with typed result and timezone policy.

## Latihan 8 — Review Parallel Stream

Find unsafe shared mutable state in parallel stream.

## Latihan 9 — Review Resource Stream

Ensure repository/file stream is closed on success/error.

## Latihan 10 — Build Team Checklist

Create a short code-review checklist your team can paste into PR template.

---

# 39. Ringkasan

Design review is where many collection/stream bugs should die before production.

Core lessons:

- Review collection as contract, state, and dataflow.
- Every collection needs owner/lifecycle.
- API collections need null/empty/duplicate/order/max-size semantics.
- Duplicates require business policy.
- Ordering must be explicit if observable.
- Defensive copy protects boundaries.
- Keys must be immutable and equality-stable.
- Maps need key/value/missing/duplicate/order/concurrency/lifecycle policy.
- Streams are lazy one-shot dataflows; side effects are risky.
- Collectors need duplicate/combiner/memory review.
- Performance requires cost model.
- Long-lived collections need growth policy.
- Shared collections need concurrency design.
- ORM collections can trigger SQL and N+1.
- Security requires bounded, authorized, least-privilege collections.
- Pagination needs stable order.
- Batch APIs need size/idempotency/partial failure design.
- Aggregation is business logic, not just `groupingBy`.
- Tests and observability should prove the contract.

Main rule:

```text
Before approving collection-heavy code, verify:
contract, ownership, lifecycle, size, order, duplicates, nulls,
mutability, concurrency, persistence behavior, security, tests, and metrics.
```

---

# 40. Referensi

1. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

2. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

3. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

4. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

5. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

6. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

7. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

8. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

9. OpenAPI Specification  
   https://spec.openapis.org/oas/latest.html

10. OpenJDK jcstress  
    https://openjdk.org/projects/code-tools/jcstress/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 060](./learn-java-collections-and-streams-part-060.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 062](./learn-java-collections-and-streams-part-062.md)
