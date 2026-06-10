# Strict Coding Standards — Java Data Structures

> **File:** `strict-coding-standards__java_data_structure.md`  
> **Scope:** Selection, design, and usage rules for Java arrays, collections, maps, queues, streams, and data-structure-like domain objects generated or modified by LLM/code agents.  
> **Baselines:** Java 11, Java 17, Java 21, and Java 25.  
> **Status:** Mandatory standard. Any violation requires explicit reviewer approval.

---

## 1. Purpose

This document defines strict data-structure conventions for Java implementation work. It is intended for LLM code agents, human implementers, and reviewers who need Java code that is correct, maintainable, performant, memory-aware, and safe under concurrency.

This is not a generic data-structure tutorial. It is an enforceable implementation contract.

A Java data structure is acceptable only when the following properties are explicit:

1. semantic purpose;
2. ordering requirement;
3. uniqueness requirement;
4. key/value identity rule;
5. mutability policy;
6. null policy;
7. concurrency policy;
8. expected size and growth pattern;
9. access pattern;
10. ownership and lifecycle.

An LLM must not choose `ArrayList`, `HashMap`, `Set`, `Optional`, `Stream`, or any collection type merely because it is common. The chosen structure must match the actual semantic and operational requirement.

---

## 2. Applicability

This standard applies to Java code involving:

- arrays;
- primitive arrays;
- object arrays;
- `List`;
- `Set`;
- `Map`;
- `Queue`;
- `Deque`;
- `SortedSet` / `NavigableSet`;
- `SortedMap` / `NavigableMap`;
- `SequencedCollection`, `SequencedSet`, `SequencedMap` where Java 21+ is allowed;
- `Optional`;
- `Stream` pipelines that produce or consume collections;
- concurrent collections;
- immutable/unmodifiable collections;
- DTO collection fields;
- domain aggregate collections;
- cache-like maps;
- lookup indexes;
- deduplication structures;
- top-K/priority structures;
- graph/tree-like in-memory structures.

This standard complements but does not replace:

- `strict-coding-standards__java11.md`;
- `strict-coding-standards__java17.md`;
- `strict-coding-standards__java21.md`;
- `strict-coding-standards__java25.md`;
- `strict-coding-standards__java_oop.md`;
- `strict-coding-standards__java_security.md`;
- `strict-coding-standards__java_io.md`;
- `strict-coding-standards__java_network.md`;
- `strict-coding-standards__jdbc.md`;
- `strict-coding-standards__jpa.md`.

When there is conflict, the stricter rule wins unless the project explicitly overrides it.

---

## 3. Core Principle

A data structure is a design decision, not a container.

Every collection/map/queue/array must answer:

1. Do duplicates matter?
2. Does order matter?
3. Does random access matter?
4. Does lookup by key matter?
5. Is sorting needed at insertion time, at read time, or never?
6. Is the structure mutable after construction?
7. Can it contain `null`?
8. Will it be shared across threads?
9. How large can it grow?
10. Who owns mutation rights?

If those answers are not known, the LLM must choose the simplest safe structure and document the assumption.

---

## 4. Non-Negotiable Rules

### 4.1 Choose by semantics before performance

The LLM MUST choose collection types by semantics first:

| Requirement | Preferred abstraction | Typical implementation |
|---|---:|---|
| ordered sequence with duplicates | `List<T>` | `ArrayList<T>` |
| unique unordered values | `Set<T>` | `HashSet<T>` |
| unique insertion-ordered values | `Set<T>` | `LinkedHashSet<T>` |
| unique sorted values | `NavigableSet<T>` | `TreeSet<T>` |
| key-value lookup | `Map<K,V>` | `HashMap<K,V>` |
| key-value lookup with stable iteration | `Map<K,V>` | `LinkedHashMap<K,V>` |
| key-value sorted lookup/range query | `NavigableMap<K,V>` | `TreeMap<K,V>` |
| FIFO work queue | `Queue<T>` | `ArrayDeque<T>` or `BlockingQueue<T>` |
| stack/LIFO or double-ended queue | `Deque<T>` | `ArrayDeque<T>` |
| priority-based retrieval | `Queue<T>` | `PriorityQueue<T>` |
| thread-safe key-value access | `ConcurrentMap<K,V>` | `ConcurrentHashMap<K,V>` |
| bounded producer-consumer queue | `BlockingQueue<T>` | `ArrayBlockingQueue<T>` |
| high-read low-write listener list | `List<T>` | `CopyOnWriteArrayList<T>` |

The LLM MUST NOT select `List` when uniqueness is a domain invariant.

The LLM MUST NOT select `HashMap` when iteration order is part of behavior.

The LLM MUST NOT select `TreeMap` or `TreeSet` unless sorted/range behavior is required.

---

### 4.2 Program to interfaces, construct concrete types locally

Public APIs SHOULD expose the smallest meaningful abstraction:

```java
public List<OrderLine> lines()
public Set<Role> roles()
public Map<String, Permission> permissionsByCode()
```

Internal construction MAY use concrete types:

```java
List<OrderLine> result = new ArrayList<>(expectedSize);
Map<String, Permission> byCode = new LinkedHashMap<>();
```

Concrete collection types in public method signatures are forbidden unless the concrete type is part of the contract.

Bad:

```java
public ArrayList<OrderLine> getLines()
```

Good:

```java
public List<OrderLine> lines()
```

Exception:

```java
public NavigableMap<Instant, AuditEvent> eventsByTime()
```

`NavigableMap` is acceptable because range/navigation behavior is part of the contract.

---

### 4.3 Always define ownership

Every mutable collection must have a clear owner.

Allowed:

```java
public final class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    public List<OrderLine> lines() {
        return List.copyOf(lines);
    }

    public void addLine(OrderLine line) {
        lines.add(Objects.requireNonNull(line, "line"));
    }
}
```

Forbidden:

```java
public List<OrderLine> getLines() {
    return lines;
}
```

Returning internal mutable collections allows callers to bypass invariants.

---

### 4.4 No accidental mutability

The LLM MUST explicitly decide whether a returned collection is:

1. mutable by caller;
2. unmodifiable view;
3. immutable snapshot;
4. defensive copy;
5. live view.

Default for domain objects and DTO responses: immutable snapshot.

Preferred:

```java
return List.copyOf(items);
```

Restricted:

```java
return Collections.unmodifiableList(items);
```

This is a live view over the backing list. It is allowed only when live-view behavior is intentionally documented.

Forbidden:

```java
return items;
```

---

### 4.5 Null policy must be explicit

Collections MUST NOT contain `null` unless explicitly required by a legacy API.

The LLM MUST validate at boundaries:

```java
this.roles = Set.copyOf(Objects.requireNonNull(roles, "roles"));
```

For collection factory methods such as `List.of`, `Set.of`, `Map.of`, and `copyOf`, null rejection is useful and should be preferred when the null-free invariant is desired.

Forbidden:

```java
list.add(null);
map.put(null, value);
```

Exception: compatibility with a legacy API that requires null as a sentinel. Such usage must be isolated and documented.

---

### 4.6 Empty collection, not null

Public APIs MUST return empty collections instead of `null`.

Bad:

```java
return null;
```

Good:

```java
return List.of();
```

Fields representing collections SHOULD be initialized to empty collections or validated in constructors.

---

### 4.7 No raw types

Raw collection types are forbidden.

Forbidden:

```java
List items = new ArrayList();
Map data = new HashMap();
```

Required:

```java
List<OrderLine> items = new ArrayList<>();
Map<String, Customer> customersById = new HashMap<>();
```

Wildcard use must be intentional:

```java
public void addAll(Collection<? extends OrderLine> source)
public void copyTo(Collection<? super OrderLine> target)
```

Use PECS:

- producer: `? extends T`;
- consumer: `? super T`.

---

### 4.8 No `Vector`, `Stack`, or `Hashtable` in new code

Forbidden for new code:

```java
Vector<T>
Stack<T>
Hashtable<K,V>
```

Use:

```java
List<T> list = new ArrayList<>();
Deque<T> stack = new ArrayDeque<>();
Map<K,V> map = new HashMap<>();
ConcurrentMap<K,V> concurrent = new ConcurrentHashMap<>();
```

Legacy classes may appear only behind compatibility adapters.

---

### 4.9 Do not rely on unspecified iteration order

The LLM MUST NOT assume iteration order for:

```java
HashMap
HashSet
ConcurrentHashMap
```

If order matters, use:

```java
LinkedHashMap
LinkedHashSet
TreeMap
TreeSet
List
SequencedMap // Java 21+
SequencedSet // Java 21+
```

Test expectations MUST NOT accidentally depend on current `HashMap` ordering.

---

### 4.10 Do not mutate collections while iterating unless using safe APIs

Forbidden:

```java
for (OrderLine line : lines) {
    if (line.cancelled()) {
        lines.remove(line);
    }
}
```

Allowed:

```java
lines.removeIf(OrderLine::cancelled);
```

Allowed with iterator:

```java
Iterator<OrderLine> iterator = lines.iterator();
while (iterator.hasNext()) {
    if (iterator.next().cancelled()) {
        iterator.remove();
    }
}
```

Concurrent modification behavior must never be used as control flow.

---

## 5. Decision Matrix

### 5.1 List choice

| Use case | Use | Avoid |
|---|---|---|
| append-heavy, indexed reads | `ArrayList` | `LinkedList` |
| read-only result list | `List.copyOf`, `Stream.toList()` if Java 16+ | mutable leaked list |
| frequent middle insert/remove by iterator | rare; justify `LinkedList` | defaulting to `LinkedList` |
| queue/deque behavior | `ArrayDeque` | `LinkedList` unless null support/legacy required |
| high-read low-write concurrent list | `CopyOnWriteArrayList` | synchronized `ArrayList` by default |

Default: `ArrayList`.

`LinkedList` is restricted. It is often chosen by LLMs because it sounds algorithmically appropriate, but in most application workloads it has poor locality, higher allocation overhead, and slower indexed access.

Allowed `LinkedList` cases:

- true `Deque` requirement with compatibility constraints;
- frequent insert/remove through known iterator positions;
- legacy API requires `LinkedList`.

Otherwise use `ArrayList` or `ArrayDeque`.

---

### 5.2 Set choice

| Requirement | Use |
|---|---|
| uniqueness only | `HashSet` |
| uniqueness + insertion order | `LinkedHashSet` |
| uniqueness + sorted order | `TreeSet` |
| uniqueness + enum keys | `EnumSet` |
| concurrent uniqueness | `ConcurrentHashMap.newKeySet()` |
| immutable unique set | `Set.of(...)` / `Set.copyOf(...)` |

Rules:

- Use `Set` when uniqueness is an invariant.
- Do not use `List` + `contains` for uniqueness on growing collections.
- Use `EnumSet` for enum membership flags.
- Define equality semantics of element type before using `HashSet` or `TreeSet`.
- Do not use mutable fields in `equals/hashCode` for elements stored in a set.

---

### 5.3 Map choice

| Requirement | Use |
|---|---|
| general lookup | `HashMap` |
| lookup + stable insertion order | `LinkedHashMap` |
| LRU-like access order | `LinkedHashMap` with access-order override or real cache library |
| sorted keys/range queries | `TreeMap` |
| enum keys | `EnumMap` |
| weak keys | `WeakHashMap`, restricted |
| identity keys | `IdentityHashMap`, highly restricted |
| concurrent general lookup | `ConcurrentHashMap` |
| concurrent sorted lookup | `ConcurrentSkipListMap` |
| immutable map | `Map.of`, `Map.copyOf` |

Rules:

- Use `EnumMap` when all keys are enum values.
- Use `LinkedHashMap` when deterministic serialization/test order is required.
- Use `TreeMap` only when sorted/range behavior is required.
- Do not use `Map<String, Object>` as a domain model.
- Do not use `HashMap` as a hidden mutable global cache.

---

### 5.4 Queue/deque choice

| Requirement | Use |
|---|---|
| stack/LIFO | `ArrayDeque` |
| FIFO single-thread/in-memory | `ArrayDeque` |
| priority ordering | `PriorityQueue` |
| bounded blocking producer-consumer | `ArrayBlockingQueue` |
| linked blocking queue | `LinkedBlockingQueue`, with explicit capacity |
| delay scheduling | `DelayQueue` |
| handoff | `SynchronousQueue` |
| concurrent non-blocking queue | `ConcurrentLinkedQueue` |

Rules:

- Do not use `Stack`.
- Do not use `LinkedList` as default queue.
- Bounded queues are preferred for producer-consumer systems.
- Unbounded queues require explicit memory-risk justification.
- Queue element processing must define poison-pill/shutdown behavior or lifecycle handling.

---

### 5.5 Arrays

Use arrays only when:

- fixed-size indexed storage is required;
- Java API requires arrays;
- primitive memory efficiency is important;
- performance-critical code has evidence;
- varargs interop is needed;
- binary/protocol code needs byte arrays.

Do not use arrays as default domain collection type.

Forbidden:

```java
private String[] roles;
```

Preferred:

```java
private final Set<Role> roles;
```

Allowed:

```java
byte[] digest;
int[] histogram;
OrderLine[] snapshot;
```

Rules:

- Always defensively copy mutable arrays crossing object boundaries.
- Do not return internal arrays.
- Prefer `Arrays.copyOf` for defensive copy.
- Treat `byte[]` containing secrets as sensitive and clear it when policy requires.

Bad:

```java
public byte[] secret() {
    return secret;
}
```

Good:

```java
public byte[] secret() {
    return Arrays.copyOf(secret, secret.length);
}
```

---

## 6. Java Version Feature Rules

### 6.1 Java 11 baseline

Allowed:

- `List.of`, `Set.of`, `Map.of`;
- `List.copyOf`, `Set.copyOf`, `Map.copyOf`;
- `Collectors.toUnmodifiableList`, `toUnmodifiableSet`, `toUnmodifiableMap`;
- `var` for local variables if the project standard allows it.

Forbidden:

- `Stream.toList()` because it is not Java 11;
- sequenced collection APIs;
- pattern matching feature assumptions.

Java 11 LLM rule:

```text
When baseline is Java 11, use collect(Collectors.toUnmodifiableList()) or List.copyOf(...), not Stream.toList().
```

---

### 6.2 Java 17 baseline

Allowed:

- all Java 11 collection APIs;
- `Stream.toList()` from Java 16;
- records as immutable data carriers;
- pattern matching `instanceof` for cleaner type narrowing.

Rules:

- `Stream.toList()` returns an unmodifiable list; do not replace `collect(Collectors.toList())` blindly if callers mutate the result.
- Use `new ArrayList<>(stream.toList())` only when mutation is explicitly needed.
- Records may contain collection fields only when defensive copying is performed in a compact constructor.

Example:

```java
public record CustomerSnapshot(List<Address> addresses) {
    public CustomerSnapshot {
        addresses = List.copyOf(addresses);
    }
}
```

---

### 6.3 Java 21 baseline

Allowed with restrictions:

- `SequencedCollection`;
- `SequencedSet`;
- `SequencedMap`;
- `List.getFirst()` / `getLast()` where available;
- `reversed()` views;
- pattern matching for switch if project standard allows Java 21 final feature usage.

Rules:

- Use sequenced abstractions when first/last/reversed encounter-order behavior is part of the API contract.
- Do not expose `SequencedMap` just because implementation is `LinkedHashMap`; expose it only if callers need sequencing operations.
- Be careful with reversed views: document whether it is a view or a snapshot.

Example:

```java
public SequencedMap<String, Step> orderedSteps() {
    return new LinkedHashMap<>(stepsByCode);
}
```

---

### 6.4 Java 25 baseline

Java 25 does not change the basic collection decision rules.

Rules:

- Do not use preview/incubator features to implement basic data structures unless project explicitly opts in.
- Keep collection APIs compatible with the declared baseline.
- Avoid depending on experimental VM features for data-structure correctness.

---

## 7. Mutability Standards

### 7.1 Mutation categories

Every collection must fit one of these categories:

| Category | Meaning | Example |
|---|---|---|
| internal mutable | owner mutates, callers cannot | aggregate field |
| caller mutable | caller owns result | builder result or local scratch list |
| immutable snapshot | stable copy | API response snapshot |
| unmodifiable live view | caller cannot mutate, owner can | rare monitoring view |
| persistent/structural sharing | external library only | explicitly justified |

The LLM MUST document unusual mutability decisions.

---

### 7.2 Defensive copy rules

Constructor input collections must be copied unless ownership transfer is explicit and private.

Required:

```java
public UserRoles(Set<Role> roles) {
    this.roles = Set.copyOf(roles);
}
```

Forbidden:

```java
public UserRoles(Set<Role> roles) {
    this.roles = roles;
}
```

Factory methods must copy too:

```java
public static UserRoles of(Collection<Role> roles) {
    return new UserRoles(Set.copyOf(roles));
}
```

---

### 7.3 `copyOf` is shallow

`List.copyOf`, `Set.copyOf`, and `Map.copyOf` create unmodifiable collections, but they do not deep-copy mutable elements.

The LLM MUST NOT claim deep immutability unless element types are also immutable.

Bad assumption:

```java
List.copyOf(mutableOrders) // deep immutable? no
```

Required if element mutation matters:

```java
List<OrderSnapshot> snapshots = orders.stream()
        .map(OrderSnapshot::from)
        .toList();
```

---

### 7.4 Collections in records

Records are shallowly immutable. Collection components are references.

Bad:

```java
public record Report(List<Row> rows) {}
```

Good:

```java
public record Report(List<Row> rows) {
    public Report {
        rows = List.copyOf(rows);
    }
}
```

If `Row` is mutable, use immutable row snapshots.

---

### 7.5 Collections in entities

For JPA entities, follow `strict-coding-standards__jpa.md`.

Rules:

- Do not expose mutable entity collections directly.
- Do not replace ORM-managed collections casually.
- Mutate through domain methods.
- Avoid `Set` for entity collections unless equality semantics are safe.
- Avoid `List` without order column if order matters.

---

## 8. Equality, Hashing, and Ordering

### 8.1 Hash-based collections require stable equality

Before using an object as a `HashMap` key or `HashSet` element, the LLM MUST verify:

1. `equals` is implemented correctly;
2. `hashCode` is implemented consistently;
3. fields used in equality do not mutate while stored;
4. equality matches domain identity/value semantics.

Forbidden:

```java
Set<Order> orders = new HashSet<>(); // if Order equality uses mutable status
```

Required:

```java
Set<OrderId> orderIds = new HashSet<>();
```

or use immutable value keys.

---

### 8.2 Mutable keys are forbidden

Using mutable objects as map keys is forbidden unless the fields used by `equals/hashCode` are immutable.

Bad:

```java
Map<SearchCriteria, Result> cache = new HashMap<>();
criteria.setPage(2);
```

Good:

```java
public record SearchKey(String query, int page, int size) {}
```

---

### 8.3 Comparator must be consistent with equality where required

For `TreeSet` and `TreeMap`, comparator ordering defines uniqueness. If comparator treats two different objects as equal, one may replace or suppress the other.

Bad:

```java
Set<User> users = new TreeSet<>(Comparator.comparing(User::lastName));
```

This treats users with the same last name as duplicates.

Good:

```java
Set<User> users = new TreeSet<>(Comparator
        .comparing(User::lastName)
        .thenComparing(User::firstName)
        .thenComparing(User::id));
```

---

### 8.4 Do not sort by unstable derived values without documenting it

Restricted:

```java
Comparator.comparing(User::currentRiskScore)
```

If risk score changes while stored in a sorted set/map, the structure may become logically corrupted.

Prefer sorting snapshots:

```java
List<UserRiskSnapshot> sorted = users.stream()
        .map(UserRiskSnapshot::from)
        .sorted(comparing(UserRiskSnapshot::riskScore).reversed())
        .toList();
```

---

### 8.5 Use records for stable value keys

For Java 17+, records are preferred for immutable map keys when appropriate.

```java
public record CustomerRegionKey(CustomerId customerId, Region region) {}
```

Rules:

- record components must be immutable or defensively copied;
- do not put mutable collections directly in key records;
- do not use records for entities with lifecycle identity.

---

## 9. Ordering and Sequencing

### 9.1 Encounter order must be explicit

If output order matters, the LLM MUST use an ordered structure or explicitly sort.

Bad:

```java
return new ArrayList<>(usersById.values()); // HashMap order leak
```

Good:

```java
return usersById.values().stream()
        .sorted(Comparator.comparing(User::displayName))
        .toList();
```

or:

```java
Map<UserId, User> usersById = new LinkedHashMap<>();
```

when insertion order is the business contract.

---

### 9.2 Stable API responses

API responses SHOULD have deterministic ordering unless explicitly unordered.

Allowed:

```java
List<RoleDto> roles = rolesByCode.values().stream()
        .sorted(Comparator.comparing(RoleDto::code))
        .toList();
```

Forbidden:

```java
return rolesByCode.values(); // if rolesByCode is HashMap
```

---

### 9.3 Do not use sorting as a hidden business rule

Sorting must be named when it carries business meaning.

Bad:

```java
items.sort(comparing(Item::priority));
```

Good:

```java
items.sort(BusinessPriorityOrder.highestPriorityFirst());
```

---

### 9.4 Locale-sensitive ordering

String sorting for user-visible text MUST define locale/collation requirements.

Default Unicode/lexicographic order is not always user-facing alphabetical order.

Allowed for technical identifiers:

```java
Comparator.comparing(Role::code)
```

Restricted for names:

```java
Comparator.comparing(Customer::displayName)
```

Use `Collator` when locale-sensitive ordering is required.

---

## 10. Performance and Complexity Rules

### 10.1 Big-O is not enough

The LLM MUST consider:

- expected size;
- allocation count;
- cache locality;
- boxing cost;
- hash quality;
- comparator cost;
- memory retention;
- concurrency contention;
- serialization/deserialization cost;
- database/network boundary cost.

Do not justify a structure with Big-O only.

---

### 10.2 Avoid accidental O(n²)

Forbidden pattern:

```java
List<Result> results = new ArrayList<>();
for (Input input : inputs) {
    if (!results.contains(toResult(input))) {
        results.add(toResult(input));
    }
}
```

Use `Set`:

```java
Set<Result> results = new LinkedHashSet<>();
for (Input input : inputs) {
    results.add(toResult(input));
}
return List.copyOf(results);
```

---

### 10.3 Pre-size when size is known and large

When expected size is known and non-trivial, pre-size mutable collections.

```java
List<OrderDto> result = new ArrayList<>(orders.size());
```

For `HashMap`, calculate capacity carefully to avoid resizing:

```java
int capacity = (int) Math.ceil(expectedSize / 0.75d) + 1;
Map<String, Customer> byId = new HashMap<>(capacity);
```

Do not over-size maps blindly. Excess capacity hurts iteration and memory usage.

---

### 10.4 Avoid premature custom data structures

Custom list/map/tree/queue implementations are forbidden unless:

1. JDK collection cannot satisfy the requirement;
2. correctness invariants are documented;
3. complexity is documented;
4. tests cover edge cases;
5. benchmark or profiling evidence exists if performance is the reason.

Most business code must use standard JDK data structures.

---

### 10.5 Primitive-heavy workloads

JDK generic collections box primitives.

For small/medium business collections, boxing is usually acceptable.

For high-volume numeric workloads, telemetry, counters, histograms, parsing, and binary protocols, the LLM MUST evaluate:

- primitive arrays;
- `BitSet`;
- specialized primitive collection library if project allows it;
- streaming aggregation without materializing objects.

Bad for hot path:

```java
List<Integer> histogram = new ArrayList<>();
```

Good:

```java
int[] histogram = new int[bucketCount];
```

---

### 10.6 Use `BitSet` for dense boolean/index membership

Use `BitSet` when:

- values are non-negative integer indexes;
- membership/dense flags are needed;
- memory matters;
- bit operations are useful.

Do not use `Set<Integer>` for dense index membership unless readability outweighs memory/performance.

---

### 10.7 Bounded memory for untrusted input

Collections built from external input MUST enforce limits.

Required:

```java
if (request.items().size() > MAX_ITEMS) {
    throw new BadRequestException("Too many items");
}
```

Forbidden:

```java
List<Item> items = request.items().stream().map(...).toList(); // no limit
```

This is a security and reliability rule.

---

## 11. Streams and Collections

### 11.1 Do not use streams when loop is clearer

Streams are allowed when they improve clarity for transformation/filtering/reduction.

Avoid streams when:

- control flow is complex;
- exception handling is awkward;
- mutation is central;
- debugging clarity suffers;
- operation has important side effects;
- early exit is needed beyond standard stream operations.

Allowed:

```java
List<CustomerDto> result = customers.stream()
        .filter(Customer::active)
        .map(CustomerDto::from)
        .toList();
```

Better as loop:

```java
for (Task task : tasks) {
    try {
        process(task);
    } catch (RetryableException ex) {
        retryQueue.add(task);
    }
}
```

---

### 11.2 `Stream.toList()` mutability rule

For Java 16+:

```java
List<T> result = stream.toList();
```

means unmodifiable result.

Do not mutate it:

```java
result.add(item); // forbidden
```

If mutation is required:

```java
List<T> result = new ArrayList<>(stream.toList());
```

or:

```java
List<T> result = stream.collect(Collectors.toCollection(ArrayList::new));
```

For Java 11:

```java
List<T> result = stream.collect(Collectors.toUnmodifiableList());
```

or:

```java
List<T> result = stream.collect(Collectors.toCollection(ArrayList::new));
```

---

### 11.3 `Collectors.toList()` contract rule

Do not assume `Collectors.toList()` returns `ArrayList` or mutable list.

If mutability/type matters, use:

```java
Collectors.toCollection(ArrayList::new)
```

If immutability matters, use:

```java
Collectors.toUnmodifiableList()
```

or Java 16+:

```java
stream.toList()
```

---

### 11.4 Avoid side effects inside stream pipelines

Forbidden:

```java
List<OrderDto> dtos = orders.stream()
        .map(order -> {
            audit(order);
            return toDto(order);
        })
        .toList();
```

Allowed only when side-effect is the terminal operation:

```java
orders.forEach(auditService::record);
```

Prefer explicit loop if side effects matter.

---

### 11.5 Parallel streams are restricted

`parallelStream()` is forbidden by default in application code.

Allowed only when:

1. workload is CPU-bound;
2. operations are side-effect-free;
3. data size is large enough;
4. shared ForkJoinPool impact is acceptable;
5. benchmark evidence exists;
6. ordering constraints are understood.

Forbidden:

```java
orders.parallelStream().forEach(repository::save);
```

This mixes concurrency, I/O, transactions, and shared pool behavior.

---

### 11.6 Do not materialize unnecessarily

Avoid unnecessary intermediate lists.

Bad:

```java
List<Order> active = orders.stream().filter(Order::active).toList();
List<OrderDto> dtos = active.stream().map(OrderDto::from).toList();
```

Good:

```java
List<OrderDto> dtos = orders.stream()
        .filter(Order::active)
        .map(OrderDto::from)
        .toList();
```

But materialize intentionally when:

- snapshot is needed;
- data is reused multiple times;
- debugging clarity matters;
- expensive source should be consumed once;
- transaction/resource boundary requires detachment.

---

## 12. Optional Standards

### 12.1 Optional is not a collection replacement

`Optional<T>` is allowed for return values where absence is expected.

Allowed:

```java
Optional<Customer> findById(CustomerId id)
```

Forbidden:

```java
private Optional<Customer> customer;
```

Forbidden:

```java
public void update(Optional<Customer> customer)
```

Method parameters should use overloads, explicit nullable policy, or command objects.

---

### 12.2 Do not put Optional inside collections without justification

Restricted:

```java
List<Optional<Result>> results;
```

Prefer modeling success/failure explicitly:

```java
List<ProcessingResult> results;
```

or filtering absent values:

```java
List<Result> results = candidates.stream()
        .map(this::tryBuild)
        .flatMap(Optional::stream)
        .toList();
```

---

### 12.3 Optional must not be identity-sensitive

Do not synchronize on `Optional`.

Do not compare `Optional` using `==`.

Do not store `Optional` in identity-based structures.

---

## 13. Concurrent Data Structures

### 13.1 Thread safety must be explicit

The LLM MUST NOT make a collection shared across threads unless it declares the concurrency model.

Possible models:

1. confined to one thread;
2. immutable snapshot shared across threads;
3. synchronized externally;
4. concurrent collection;
5. copy-on-write;
6. actor/queue ownership;
7. lock-protected mutable structure.

Default: thread confinement or immutable snapshot.

---

### 13.2 Use concurrent collections intentionally

| Requirement | Use |
|---|---|
| concurrent key-value access | `ConcurrentHashMap` |
| concurrent sorted map | `ConcurrentSkipListMap` |
| producer-consumer with blocking | `BlockingQueue` |
| high-read low-write listener registry | `CopyOnWriteArrayList` |
| concurrent set | `ConcurrentHashMap.newKeySet()` |
| work stealing | `ForkJoinPool`/specialized queues only with design evidence |

Rules:

- Do not wrap arbitrary collections in `Collections.synchronizedXxx` unless the locking protocol is clear.
- Do not iterate synchronized collections without holding the required lock.
- Do not assume compound operations are atomic unless API guarantees it.

---

### 13.3 Compound map operations must be atomic

Forbidden:

```java
if (!map.containsKey(key)) {
    map.put(key, createValue());
}
```

Required:

```java
map.computeIfAbsent(key, this::createValue);
```

For counters:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();
counts.computeIfAbsent(code, ignored -> new LongAdder()).increment();
```

---

### 13.4 Be careful with `computeIfAbsent`

The mapping function must be:

- side-effect limited;
- non-blocking or intentionally bounded;
- not recursively modifying the same map in unsafe ways;
- idempotent or safe to retry if implementation calls it under contention.

Forbidden:

```java
cache.computeIfAbsent(id, key -> repository.save(new Entity(key)));
```

A cache lookup must not secretly perform irreversible writes unless explicitly designed.

---

### 13.5 Copy-on-write is restricted

`CopyOnWriteArrayList` is allowed only when:

- reads/iterations are frequent;
- writes are rare;
- snapshot iteration is desirable;
- list size is bounded or small.

Forbidden for high-write paths.

---

### 13.6 Blocking queues must be bounded by default

Forbidden by default:

```java
new LinkedBlockingQueue<>()
```

Required:

```java
new LinkedBlockingQueue<>(capacity)
```

or:

```java
new ArrayBlockingQueue<>(capacity)
```

Unbounded queues require explicit memory-risk approval.

---

### 13.7 Do not use collection synchronization as domain locking

A synchronized collection protects internal structure, not business invariants across multiple structures.

Bad:

```java
Map<AccountId, Account> accounts = Collections.synchronizedMap(new HashMap<>());
```

This does not automatically protect transfer invariants.

Use explicit domain/application locking strategy.

---

## 14. Maps as Indexes, Caches, and Registries

### 14.1 Index map naming

Maps used as indexes MUST be named by key.

Good:

```java
Map<CustomerId, Customer> customersById;
Map<String, Role> rolesByCode;
Map<Instant, List<Event>> eventsByTimestamp;
```

Bad:

```java
Map<String, Object> map;
Map<String, User> data;
```

---

### 14.2 Cache maps are restricted

A plain `HashMap`/`ConcurrentHashMap` is not a complete cache.

Before implementing a cache, define:

1. key;
2. value;
3. max size;
4. TTL/expiry;
5. invalidation trigger;
6. concurrency behavior;
7. memory pressure behavior;
8. stampede control;
9. metrics;
10. failure behavior.

If these are not defined, do not implement a cache.

---

### 14.3 Use cache library when behavior is non-trivial

For production caches requiring eviction, expiration, refresh, statistics, or concurrency control, prefer the project-approved cache library instead of hand-written maps.

Hand-written `LinkedHashMap` LRU is allowed only for small, local, simple caches with tests.

---

### 14.4 Registry maps must be immutable after construction

For strategy registries:

```java
private final Map<CommandType, CommandHandler> handlersByType;

public CommandDispatcher(Collection<CommandHandler> handlers) {
    Map<CommandType, CommandHandler> index = new EnumMap<>(CommandType.class);
    for (CommandHandler handler : handlers) {
        CommandHandler previous = index.put(handler.type(), handler);
        if (previous != null) {
            throw new IllegalArgumentException("Duplicate handler for " + handler.type());
        }
    }
    this.handlersByType = Map.copyOf(index);
}
```

Rules:

- detect duplicate keys;
- fail fast at startup/construction;
- expose no mutation;
- use `EnumMap` for enum keys before freezing if appropriate.

---

## 15. DTO, API, and Serialization Rules

### 15.1 Collection fields in DTOs

DTOs SHOULD expose immutable collection values.

For records:

```java
public record SearchResponse(List<ResultDto> results) {
    public SearchResponse {
        results = List.copyOf(results);
    }
}
```

For classes:

```java
public final class SearchResponse {
    private final List<ResultDto> results;

    public SearchResponse(List<ResultDto> results) {
        this.results = List.copyOf(results);
    }

    public List<ResultDto> results() {
        return results;
    }
}
```

---

### 15.2 API order must be contractually defined

If a DTO contains a list, define the order.

Examples:

- sorted by `createdAt desc`;
- insertion order from workflow definition;
- priority order;
- undefined order, but then use `Set` or document explicitly.

Do not emit unordered `HashSet`/`HashMap` values as lists.

---

### 15.3 Map keys in JSON must be controlled

Map fields in DTOs are restricted.

Allowed:

```java
Map<String, String> labels;
Map<String, ErrorDetail> errorsByField;
```

Restricted:

```java
Map<CustomerId, CustomerDto> customers;
```

Reason: JSON object keys are strings. Non-string keys require explicit serialization rules.

---

### 15.4 Do not use `Map<String,Object>` as DTO by default

Forbidden:

```java
Map<String, Object> response = new HashMap<>();
```

Use typed DTOs.

Allowed only for:

- generic metadata with schema constraints;
- framework integration;
- dynamic forms/rules engines;
- logging context with safe values;
- migration adapter.

Must be isolated and documented.

---

## 16. Domain Modeling Rules

### 16.1 Use collection type to express invariant

Bad:

```java
private final List<Role> roles;
```

If duplicate roles are invalid, use:

```java
private final Set<Role> roles;
```

If order of assignment matters:

```java
private final LinkedHashSet<Role> roles;
```

Expose as:

```java
public Set<Role> roles() {
    return Set.copyOf(roles);
}
```

---

### 16.2 Domain collection methods must preserve invariants

Bad:

```java
public void setLines(List<OrderLine> lines) {
    this.lines = lines;
}
```

Good:

```java
public void addLine(Product product, Quantity quantity) {
    OrderLine line = OrderLine.of(product, quantity);
    if (containsProduct(product.id())) {
        throw new DomainException("Duplicate product");
    }
    lines.add(line);
}
```

---

### 16.3 Avoid exposing data structure implementation as domain concept

Bad:

```java
public HashMap<String, WorkflowState> getStateMap()
```

Good:

```java
public Optional<WorkflowState> stateByCode(String code)
public List<WorkflowState> statesInDisplayOrder()
```

Domain APIs should expose behavior, not raw storage.

---

### 16.4 Use small value types for map keys

Bad:

```java
Map<String, Rule> rulesByCompositeKey; // "country:type:version"
```

Good:

```java
public record RuleKey(CountryCode country, RuleType type, int version) {}
Map<RuleKey, Rule> rulesByKey;
```

Stringly-typed composite keys are forbidden unless interacting with an external protocol.

---

## 17. Security Rules

### 17.1 Limit external collection sizes

External input that becomes a collection must be bounded.

Examples:

- request array length;
- CSV rows;
- uploaded file parsed rows;
- JSON object keys;
- query parameter values;
- batch command items;
- nested child structures.

The LLM MUST include limits in handlers/services that process untrusted input.

---

### 17.2 Avoid hash collision exposure

Do not expose unbounded `HashMap`/`HashSet` construction from attacker-controlled strings without limits.

Required mitigations:

- size limit;
- input validation;
- request body limit;
- timeout;
- rate limit at boundary;
- streaming parser where applicable.

---

### 17.3 Do not store secrets in long-lived collections

Secrets must not be placed in:

- static maps;
- caches;
- logs;
- DTO collections;
- exception data;
- metrics labels;
- debug maps.

If secrets must be temporarily stored, define lifecycle and clearing policy.

---

### 17.4 Do not use identity maps for security decisions

`IdentityHashMap` compares keys by reference identity, not equality.

It is forbidden for authorization, authentication, tenant, permission, or business identity checks.

Allowed only for low-level graph traversal or object identity algorithms with tests.

---

### 17.5 Do not trust collection immutability from caller

A caller may pass mutable collections. Constructors and methods crossing trust boundaries must copy.

Bad:

```java
this.allowedRoles = allowedRoles;
```

Good:

```java
this.allowedRoles = Set.copyOf(allowedRoles);
```

---

## 18. Memory and Lifecycle Rules

### 18.1 No unbounded static collections

Forbidden:

```java
private static final Map<String, Session> SESSIONS = new HashMap<>();
```

Static mutable collections cause leaks, lifecycle bugs, test pollution, and cross-tenant/state contamination.

Allowed static collections:

```java
private static final Set<String> RESERVED_CODES = Set.of("ADMIN", "ROOT");
```

Must be immutable.

---

### 18.2 Remove entries explicitly when lifecycle ends

Maps used for pending requests, locks, futures, or temporary state must remove entries in all paths.

Required:

```java
pending.put(id, future);
try {
    return future.get(timeout.toMillis(), MILLISECONDS);
} finally {
    pending.remove(id);
}
```

---

### 18.3 Weak maps are not cache policy

`WeakHashMap` is restricted.

It is allowed only when weak-key semantics are explicitly required and tested.

Do not use it as a generic memory leak fix.

---

### 18.4 Avoid retaining large source collections accidentally

Do not capture large collections in lambdas, callbacks, futures, or static registries unless lifecycle is clear.

Bad:

```java
executor.submit(() -> process(allRows));
```

when `allRows` is huge and should be streamed.

Prefer bounded batches or streaming.

---

## 19. Data Structures for Common Problems

### 19.1 Deduplication preserving input order

Use `LinkedHashSet`:

```java
List<String> uniqueCodes = new ArrayList<>(new LinkedHashSet<>(codes));
```

For validation with duplicate detection:

```java
Set<String> seen = new HashSet<>();
Set<String> duplicates = new LinkedHashSet<>();
for (String code : codes) {
    if (!seen.add(code)) {
        duplicates.add(code);
    }
}
```

---

### 19.2 Grouping

Use `Map<K, List<V>>` or collectors.

```java
Map<CustomerId, List<Order>> ordersByCustomer = orders.stream()
        .collect(Collectors.groupingBy(Order::customerId));
```

If order matters:

```java
Map<CustomerId, List<Order>> ordersByCustomer = orders.stream()
        .collect(Collectors.groupingBy(
                Order::customerId,
                LinkedHashMap::new,
                Collectors.toList()));
```

If output lists must be immutable:

```java
Map<CustomerId, List<Order>> ordersByCustomer = orders.stream()
        .collect(Collectors.groupingBy(
                Order::customerId,
                Collectors.collectingAndThen(Collectors.toList(), List::copyOf)));
```

---

### 19.3 Counting/frequency map

Single-thread:

```java
Map<String, Long> counts = new HashMap<>();
for (String code : codes) {
    counts.merge(code, 1L, Long::sum);
}
```

Concurrent:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();
for (String code : codes) {
    counts.computeIfAbsent(code, ignored -> new LongAdder()).increment();
}
```

---

### 19.4 Top-K

Use `PriorityQueue` with bounded size.

```java
PriorityQueue<ScoredItem> heap = new PriorityQueue<>(Comparator.comparing(ScoredItem::score));
for (ScoredItem item : items) {
    if (heap.size() < k) {
        heap.offer(item);
    } else if (item.score() > heap.peek().score()) {
        heap.poll();
        heap.offer(item);
    }
}
```

Do not sort the entire dataset if only top-K is needed and dataset is large.

---

### 19.5 Range query

Use `NavigableMap` or `NavigableSet`.

```java
NavigableMap<Instant, Event> eventsByTime = new TreeMap<>();
NavigableMap<Instant, Event> window = eventsByTime.subMap(start, true, end, false);
```

Do not scan `HashMap` for range queries.

---

### 19.6 Graph traversal

Use explicit adjacency representation.

```java
Map<NodeId, Set<NodeId>> outgoingByNode;
```

Rules:

- define directed vs undirected;
- define duplicate edge policy;
- define cycle behavior;
- define traversal order;
- define max nodes/edges for untrusted input;
- use visited set.

---

### 19.7 State machine tables

For finite enum-based transitions, use `EnumMap`.

```java
EnumMap<State, EnumSet<Event>> allowedEventsByState = new EnumMap<>(State.class);
```

For transition lookup:

```java
record TransitionKey(State state, Event event) {}
Map<TransitionKey, State> nextStateByTransition;
```

For dense enum combinations, consider nested `EnumMap`.

---

### 19.8 Multi-map

JDK has no built-in general `Multimap`.

Allowed:

```java
Map<K, List<V>> valuesByKey;
Map<K, Set<V>> uniqueValuesByKey;
```

Rules:

- define value order;
- define duplicate policy;
- hide mutation behind methods;
- do not expose nested mutable collections directly.

---

## 20. Anti-Patterns

### 20.1 `Map<String,Object>` everywhere

Forbidden as general modeling.

Symptoms:

- unclear schema;
- runtime casts;
- typo-prone keys;
- hidden nullability;
- no compiler support;
- weak tests;
- security review difficulty.

Use typed DTO/value objects.

---

### 20.2 List as universal container

Bad:

```java
List<String> roles; // duplicates impossible? order meaningful?
```

Use the structure that encodes the invariant.

---

### 20.3 Set with mutable entity

Bad:

```java
Set<UserEntity> users = new HashSet<>();
```

if equality depends on generated ID or mutable business fields.

Use IDs or stable value objects.

---

### 20.4 Sorting in every caller

Bad:

```java
service.findUsers().stream().sorted(...)
```

repeated across callers.

Good:

```java
service.findUsersOrderedByDisplayName()
```

or domain-specific ordering policy.

---

### 20.5 Accidental live view

Bad:

```java
return map.keySet();
```

This is often a live view backed by the map.

Good:

```java
return Set.copyOf(map.keySet());
```

unless live-view behavior is intentional.

---

### 20.6 Blind conversion between collection types

Bad:

```java
return new ArrayList<>(set);
```

without defining order.

Good:

```java
return set.stream()
        .sorted(Comparator.comparing(Role::code))
        .toList();
```

or use `LinkedHashSet` upstream when insertion order is intentional.

---

### 20.7 `contains` in loop over large list

Bad:

```java
for (String id : ids) {
    if (allowedIds.contains(id)) {
        ...
    }
}
```

when `allowedIds` is a large `List`.

Good:

```java
Set<String> allowedIdSet = Set.copyOf(allowedIds);
for (String id : ids) {
    if (allowedIdSet.contains(id)) {
        ...
    }
}
```

---

### 20.8 Parallel collection mutation

Forbidden:

```java
List<Result> results = new ArrayList<>();
items.parallelStream().forEach(item -> results.add(process(item)));
```

Use collectors, concurrent structures, or explicit concurrency design.

---

## 21. Naming Standards

### 21.1 Collection variable names

Names MUST reveal semantics.

Good:

```java
List<OrderLine> orderLines;
Set<Role> assignedRoles;
Map<CustomerId, Customer> customersById;
Queue<EmailJob> pendingEmailJobs;
Deque<State> traversalStack;
NavigableMap<Instant, Event> eventsByTime;
```

Bad:

```java
List<OrderLine> list;
Map<String, Object> map;
Set<Role> set;
Queue<EmailJob> queue;
```

---

### 21.2 Map names

Map names SHOULD follow:

```text
<values>By<key>
```

Examples:

```java
ordersById
rolesByCode
eventsByTimestamp
handlersByCommandType
permissionsByResource
```

For nested maps:

```java
permissionsByActionByResource
```

But prefer a typed key when nesting becomes unclear.

---

### 21.3 Boolean membership names

For sets used only for membership:

```java
Set<CustomerId> blockedCustomerIds;
Set<String> reservedCodes;
```

Methods:

```java
boolean isBlocked(CustomerId id)
boolean containsReservedCode(String code)
```

---

## 22. Testing Requirements

### 22.1 Collection contract tests

Tests MUST cover:

- empty input;
- single element;
- duplicates;
- null input if boundary allows it;
- order expectation;
- immutability of returned collections;
- large-ish input when complexity matters;
- mutation isolation/defensive copy;
- equality/hash behavior for key/element types.

---

### 22.2 Order tests

If order matters, test exact order.

```java
assertThat(result).containsExactly(first, second, third);
```

If order does not matter, test without order.

```java
assertThat(result).containsExactlyInAnyOrder(a, b, c);
```

Do not accidentally encode arbitrary `HashMap` order in tests.

---

### 22.3 Mutability tests

For returned immutable collections:

```java
assertThrows(UnsupportedOperationException.class, () -> result.add(value));
```

Also test defensive copy:

```java
List<String> source = new ArrayList<>(List.of("A"));
Snapshot snapshot = new Snapshot(source);
source.add("B");
assertThat(snapshot.values()).containsExactly("A");
```

---

### 22.4 Equality/hash tests for keys

Map key/value object tests MUST cover:

- equal objects have equal hash code;
- unequal objects are not overwritten accidentally;
- mutation is impossible or does not affect equality;
- comparator uniqueness behavior for sorted structures.

---

### 22.5 Concurrent collection tests

Concurrent collection tests MUST avoid only happy-path assertions.

Cover:

- duplicate concurrent initialization;
- atomic update semantics;
- bounded queue full behavior;
- shutdown/drain behavior;
- no lost update for counters;
- timeout behavior.

---

## 23. Reviewer Checklist

A reviewer MUST reject data-structure code if any answer is unclear:

1. Why this collection type?
2. Does order matter?
3. Are duplicates allowed?
4. Can it contain `null`?
5. Who owns mutation?
6. Is it safe to expose?
7. Is defensive copy required?
8. Are element/key equality semantics stable?
9. Is the structure shared across threads?
10. Is expected size bounded?
11. Could this become O(n²)?
12. Is the result mutable or immutable?
13. Does API response ordering stay deterministic?
14. Does external input have size limits?
15. Does map naming reveal the key?
16. Are caches bounded and observable?
17. Does stream usage obscure side effects?
18. Is Java baseline respected?
19. Are tests checking duplicates/order/mutability?
20. Is a simpler structure sufficient?

---

## 24. LLM Implementation Protocol

Before creating or changing any collection/map/queue/array, the LLM MUST internally answer:

```text
1. What is the semantic requirement?
2. Is this sequence, set, lookup, queue, stack, priority, range, or graph?
3. Are duplicates allowed?
4. Is order required? If yes, what order?
5. Is mutation required? Who owns it?
6. Is null allowed?
7. Is concurrency involved?
8. What is expected maximum size?
9. Are key/element equality and ordering stable?
10. What tests prove the choice?
```

The LLM MUST NOT introduce data structures without preserving these answers in code clarity, method naming, validation, or tests.

---

## 25. LLM Prompt Contract

Use this snippet when instructing an implementation agent:

```text
When implementing Java data structures, follow strict-coding-standards__java_data_structure.md.

You must not choose ArrayList, HashMap, HashSet, LinkedList, Optional, Stream, ConcurrentHashMap, or any other collection by habit.
For every collection/map/queue/array, choose the type based on semantics: order, uniqueness, lookup, mutability, null policy, concurrency, expected size, and ownership.

Rules:
- Program to interfaces unless concrete behavior is part of the contract.
- Do not expose internal mutable collections.
- Return empty collections, not null.
- Do not allow null elements unless legacy integration requires it.
- Do not rely on HashMap/HashSet iteration order.
- Do not use raw types.
- Do not use Vector, Stack, or Hashtable in new code.
- Use ArrayDeque instead of Stack and usually instead of LinkedList for queue/deque behavior.
- Use Set when uniqueness is an invariant.
- Use LinkedHashMap/LinkedHashSet when deterministic insertion order matters.
- Use TreeMap/TreeSet only for sorted/range behavior.
- Use EnumMap/EnumSet for enum keys/membership.
- Use ConcurrentHashMap/BlockingQueue/CopyOnWriteArrayList only with an explicit concurrency model.
- Make queues bounded by default.
- Use defensive copies for constructor inputs and returned collections.
- For Java 11, do not use Stream.toList().
- For Java 17+, remember Stream.toList() is unmodifiable.
- For Java 21+, use SequencedCollection/SequencedMap only when sequencing is part of the public contract.
- Do not use Map<String,Object> as a domain model or DTO unless explicitly required and documented.
- Test duplicates, ordering, mutability, null policy, defensive copy, and equality/hash behavior.

If a data-structure decision is ambiguous, choose the simplest safe type and document the assumption.
```

---

## 26. Quick Reference

| Problem | Default choice | Notes |
|---|---|---|
| ordered items | `ArrayList` | pre-size if known |
| uniqueness | `HashSet` | equality must be stable |
| uniqueness + order | `LinkedHashSet` | deterministic iteration |
| sorted values | `TreeSet` | comparator defines uniqueness |
| lookup by key | `HashMap` | no order guarantee |
| lookup + deterministic order | `LinkedHashMap` | insertion/access order |
| sorted/range lookup | `TreeMap` | log-time operations |
| enum lookup | `EnumMap` | efficient, clear |
| enum flags | `EnumSet` | efficient, clear |
| stack | `ArrayDeque` | not `Stack` |
| FIFO queue | `ArrayDeque` | for single-thread/non-blocking local use |
| bounded blocking queue | `ArrayBlockingQueue` | producer-consumer |
| concurrent map | `ConcurrentHashMap` | use atomic APIs |
| high-read low-write list | `CopyOnWriteArrayList` | small/rare writes only |
| immutable list | `List.copyOf` / `List.of` / `Stream.toList` | Java baseline matters |
| dense boolean flags | `BitSet` | integer index domain |
| primitive numeric hot path | primitive array | avoid boxing |
| top-K | `PriorityQueue` | bounded heap |
| range query | `NavigableMap` / `NavigableSet` | sorted keys |

---

## 27. Source References

This standard is grounded in the following primary/reference sources:

- Java SE Collections Framework Overview: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/doc-files/coll-overview.html`
- Java SE `Collection`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Collection.html`
- Java SE `List`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/List.html`
- Java SE `Map`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Map.html`
- Java SE `ArrayList`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayList.html`
- Java SE `HashMap`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html`
- Java SE `ConcurrentHashMap`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html`
- Java SE `java.util.concurrent` package: `https://docs.oracle.com/en/java/javase/22/docs/api/java.base/java/util/concurrent/package-summary.html`
- Java SE `Stream`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Stream.html`
- Java SE `Collectors`: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Collectors.html`
- OpenJDK JEP 431 — Sequenced Collections: `https://openjdk.org/jeps/431`

---

## 28. Final Rule

A Java data structure must make invalid states harder to represent.

If a collection choice hides business invariants, exposes accidental mutation, relies on unspecified order, creates unsafe concurrency, or makes performance/memory behavior unpredictable, the LLM must redesign it before implementation.
