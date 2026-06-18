# learn-java-collections-and-streams-part-047.md

# Java Collections and Streams — Part 047  
# Domain Modeling with Collections: Invariants, Value Objects, Aggregate Boundaries, Ordering, Uniqueness, Identity, Immutability, Encapsulation, and Production-Grade Collection Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **047**  
> Fokus: memahami collections bukan hanya sebagai data structure, tetapi sebagai bagian dari domain model. Kita akan membahas kapan `List`, `Set`, `Map`, `Deque`, atau custom collection type merepresentasikan business meaning; bagaimana menjaga invariants; kapan collection harus immutable; kapan jangan expose internal collection; bagaimana modeling ordered/unique items; bagaimana value objects, aggregate boundaries, domain events, persistence, API contracts, dan performance bertemu dalam collection design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Collection Adalah Bahasa Domain, Bukan Sekadar Container](#2-mental-model-collection-adalah-bahasa-domain-bukan-sekadar-container)
3. [Collection Choice = Domain Statement](#3-collection-choice--domain-statement)
4. [`List` dalam Domain](#4-list-dalam-domain)
5. [`Set` dalam Domain](#5-set-dalam-domain)
6. [`Map` dalam Domain](#6-map-dalam-domain)
7. [`Queue`/`Deque` dalam Domain](#7-queuedeque-dalam-domain)
8. [Custom Collection Value Object](#8-custom-collection-value-object)
9. [Encapsulating Collections](#9-encapsulating-collections)
10. [Do Not Expose Mutable Internals](#10-do-not-expose-mutable-internals)
11. [Invariants](#11-invariants)
12. [Uniqueness Rules](#12-uniqueness-rules)
13. [Ordering Rules](#13-ordering-rules)
14. [Cardinality Rules](#14-cardinality-rules)
15. [Null Rules](#15-null-rules)
16. [Duplicate Rules](#16-duplicate-rules)
17. [Identity vs Equality in Domain Collections](#17-identity-vs-equality-in-domain-collections)
18. [Entity Collections](#18-entity-collections)
19. [Value Object Collections](#19-value-object-collections)
20. [Aggregate Boundaries](#20-aggregate-boundaries)
21. [Bidirectional Relationships](#21-bidirectional-relationships)
22. [Derived Collections](#22-derived-collections)
23. [Snapshot vs Live View](#23-snapshot-vs-live-view)
24. [Immutable Domain Collections](#24-immutable-domain-collections)
25. [Defensive Copying](#25-defensive-copying)
26. [Domain Methods Instead of Collection Setters](#26-domain-methods-instead-of-collection-setters)
27. [Collection as State Machine](#27-collection-as-state-machine)
28. [Modeling Ordered Line Items](#28-modeling-ordered-line-items)
29. [Modeling Unique Roles/Permissions](#29-modeling-unique-rolespermissions)
30. [Modeling Lookup Tables](#30-modeling-lookup-tables)
31. [Modeling History and Audit Trail](#31-modeling-history-and-audit-trail)
32. [Modeling Work Queues](#32-modeling-work-queues)
33. [Collections and Persistence](#33-collections-and-persistence)
34. [Collections and API DTOs](#34-collections-and-api-dtos)
35. [Collections and Domain Events](#35-collections-and-domain-events)
36. [Validation Strategies](#36-validation-strategies)
37. [Performance and Memory Considerations](#37-performance-and-memory-considerations)
38. [Common Anti-Patterns](#38-common-anti-patterns)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices](#40-best-practices)
41. [Decision Matrix](#41-decision-matrix)
42. [Latihan](#42-latihan)
43. [Ringkasan](#43-ringkasan)
44. [Referensi](#44-referensi)

---

# 1. Tujuan Bagian Ini

Sampai bagian sebelumnya kita banyak membahas:

- Collection API;
- List/Set/Map internals;
- Stream operations;
- collectors;
- spliterators;
- performance;
- concurrency.

Sekarang kita naik ke level desain domain.

Pertanyaan penting:

```text
Apakah collection di domain model hanya List/Set/Map biasa?
Atau ia mewakili aturan bisnis?
```

Contoh buruk:

```java
class Order {
    private List<OrderLine> lines;

    public List<OrderLine> getLines() {
        return lines;
    }

    public void setLines(List<OrderLine> lines) {
        this.lines = lines;
    }
}
```

Masalah:

- caller bisa mengganti seluruh lines;
- order line null bisa masuk;
- duplicate product bisa masuk;
- quantity negatif bisa masuk;
- line order bisa rusak;
- total order tidak konsisten;
- business rule tidak punya tempat;
- persistence/API bisa bocor ke domain.

Contoh lebih baik:

```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    public void addLine(Product product, Quantity quantity) {
        requireOpen();
        requireAvailable(product);
        mergeOrAppendLine(product, quantity);
        recalculateTotal();
        registerEvent(new OrderLineAdded(id, product.id(), quantity));
    }

    public List<OrderLine> lines() {
        return List.copyOf(lines);
    }
}
```

Di sini collection tidak lagi “container bebas”, tetapi bagian dari aggregate behavior.

Tujuan bagian ini:

- memilih collection berdasarkan business semantics;
- menjaga invariants;
- menghindari mutable internal exposure;
- membuat custom collection value object;
- memahami ordering/uniqueness/cardinality/null rules;
- memahami relationship dengan persistence/API/event;
- membuat collection design yang tahan production bugs.

---

# 2. Mental Model: Collection Adalah Bahasa Domain, Bukan Sekadar Container

Collection dalam domain menjawab:

```text
Apa arti kumpulan ini?
Apakah urutan penting?
Apakah duplicate boleh?
Apakah lookup by key penting?
Apakah perubahan harus lewat rule?
Apakah collection ini bagian aggregate?
Apakah collection ini snapshot atau live state?
```

## 2.1 Example

```java
List<OrderLine>
```

mengatakan:

```text
Ada urutan.
Duplicate mungkin boleh.
Index mungkin bermakna.
```

```java
Set<Role>
```

mengatakan:

```text
Role unik.
Urutan tidak menjadi semantics utama.
```

```java
Map<ProductId, InventoryReservation>
```

mengatakan:

```text
Lookup berdasarkan ProductId adalah operasi utama.
Satu product id punya satu reservation entry.
```

## 2.2 Main rule

```text
Every collection type choice communicates domain semantics.
```

---

# 3. Collection Choice = Domain Statement

Choosing collection type is design decision.

## 3.1 `List`

Use when:

- order matters;
- duplicate may matter;
- position/index matters;
- append sequence matters.

## 3.2 `Set`

Use when:

- uniqueness matters;
- membership matters;
- duplicate should collapse/reject;
- order usually not main semantics.

## 3.3 `Map`

Use when:

- key-based lookup matters;
- key uniqueness matters;
- association key -> value is primary.

## 3.4 `Queue`/`Deque`

Use when:

- processing order matters;
- FIFO/LIFO semantics;
- pending work;
- state transitions.

## 3.5 Custom collection

Use when:

- invariants are important;
- ubiquitous language has a named concept;
- operations are domain-specific;
- raw collection exposes too much.

## 3.6 Rule

Pick the collection that matches the business invariant, not the one you habitually type first.

---

# 4. `List` dalam Domain

`List` means ordered sequence.

## 4.1 Good use cases

- order lines in display/order entry order;
- workflow steps;
- audit events;
- ordered comments;
- ranked results;
- timeline entries.

## 4.2 Questions

- Is order insertion order, business sort order, or user-defined order?
- Can duplicate elements exist?
- Can caller reorder?
- Is index stable?
- Is list append-only?
- Is list max size limited?

## 4.3 Example

```java
class ApprovalChain {
    private final List<Approver> approvers;

    ApprovalChain(List<Approver> approvers) {
        if (approvers.isEmpty()) {
            throw new IllegalArgumentException("Approval chain cannot be empty");
        }
        this.approvers = List.copyOf(approvers);
    }

    Approver firstApprover() {
        return approvers.getFirst();
    }

    List<Approver> approvers() {
        return approvers;
    }
}
```

## 4.4 Rule

Use `List` only when order is meaningful or duplicates are meaningful.

---

# 5. `Set` dalam Domain

`Set` means uniqueness.

## 5.1 Good use cases

- roles;
- permissions;
- tags;
- feature flags;
- selected options;
- participants by identity;
- unique business capabilities.

## 5.2 Equality matters

Set uniqueness depends on `equals`/`hashCode` or comparator for sorted sets.

## 5.3 Danger

If entity equality is mutable or wrong, Set behavior breaks.

## 5.4 Example

```java
class UserRoles {
    private final Set<Role> roles;

    UserRoles(Collection<Role> roles) {
        if (roles.isEmpty()) {
            throw new IllegalArgumentException("User must have at least one role");
        }
        this.roles = Set.copyOf(roles);
    }

    boolean has(Role role) {
        return roles.contains(role);
    }

    UserRoles add(Role role) {
        Set<Role> copy = new HashSet<>(roles);
        copy.add(Objects.requireNonNull(role));
        return new UserRoles(copy);
    }
}
```

## 5.5 Rule

Use `Set` when uniqueness is a rule, not just convenience.

---

# 6. `Map` dalam Domain

`Map` means key-based association.

## 6.1 Good use cases

- product id -> order line;
- currency -> exchange rate;
- permission -> grant details;
- field name -> validation errors;
- account id -> balance;
- locale -> translation.

## 6.2 Questions

- What is the key?
- Is key stable?
- Is missing key allowed?
- Are null keys/values allowed?
- What is duplicate key policy?
- Does map preserve order?

## 6.3 Example

```java
class OrderLinesByProduct {
    private final Map<ProductId, OrderLine> linesByProduct;

    OrderLinesByProduct(Collection<OrderLine> lines) {
        Map<ProductId, OrderLine> map = new LinkedHashMap<>();
        for (OrderLine line : lines) {
            OrderLine previous = map.putIfAbsent(line.productId(), line);
            if (previous != null) {
                throw new IllegalArgumentException(
                    "Duplicate product in order: " + line.productId()
                );
            }
        }
        this.linesByProduct = Map.copyOf(map);
    }

    Optional<OrderLine> find(ProductId productId) {
        return Optional.ofNullable(linesByProduct.get(productId));
    }
}
```

## 6.4 Rule

Use `Map` when lookup/association is central to the domain behavior.

---

# 7. `Queue`/`Deque` dalam Domain

Queue/deque express processing order.

## 7.1 Good use cases

- pending tasks;
- retry queue;
- workflow inbox;
- command buffer;
- event replay;
- undo/redo stack;
- BFS traversal.

## 7.2 Queue semantics

```text
offer -> poll -> peek
```

## 7.3 Deque semantics

Both ends:

```text
addFirst/addLast
pollFirst/pollLast
```

## 7.4 Example

```java
class RetryPlan {
    private final Deque<RetryAttempt> attempts = new ArrayDeque<>();

    void schedule(RetryAttempt attempt) {
        attempts.addLast(attempt);
    }

    Optional<RetryAttempt> next() {
        return Optional.ofNullable(attempts.pollFirst());
    }
}
```

## 7.5 Rule

Use queue/deque when processing order is not incidental but part of behavior.

---

# 8. Custom Collection Value Object

Raw collection often does not express domain rule.

Instead of:

```java
List<OrderLine>
```

create:

```java
final class OrderLines {
    private final List<OrderLine> lines;

    private OrderLines(List<OrderLine> lines) {
        this.lines = List.copyOf(lines);
    }

    static OrderLines of(Collection<OrderLine> lines) {
        validate(lines);
        return new OrderLines(new ArrayList<>(lines));
    }

    Money total() {
        return lines.stream()
            .map(OrderLine::subtotal)
            .reduce(Money.zero(), Money::add);
    }

    List<OrderLine> asList() {
        return lines;
    }
}
```

## 8.1 Benefits

- invariants centralized;
- methods named by domain;
- raw mutation hidden;
- equality can be domain-specific;
- persistence/API mapping separated.

## 8.2 Rule

If collection has business rules, consider wrapping it in a domain type.

---

# 9. Encapsulating Collections

Encapsulation means domain object controls collection mutation.

Bad:

```java
public List<OrderLine> getLines() {
    return lines;
}
```

Good:

```java
public List<OrderLine> lines() {
    return List.copyOf(lines);
}
```

Better:

```java
public void addLine(Product product, Quantity quantity) {
    // business rules
}
```

## 9.1 Rule

Expose behavior, not mutable collection internals.

---

# 10. Do Not Expose Mutable Internals

Bad:

```java
class Cart {
    private final List<CartItem> items = new ArrayList<>();

    List<CartItem> items() {
        return items;
    }
}
```

Caller can:

```java
cart.items().clear();
cart.items().add(null);
```

## 10.1 Fix snapshot

```java
List<CartItem> items() {
    return List.copyOf(items);
}
```

## 10.2 Fix unmodifiable view?

```java
Collections.unmodifiableList(items)
```

This is a view; internal changes reflect.

Snapshot is safer at boundary.

## 10.3 Rule

Never expose mutable internal collections unless mutation is intentionally part of API.

---

# 11. Invariants

Invariants are rules that must always be true.

Examples:

```text
Order must have at least one line before submission.
Order line quantity must be positive.
User roles cannot be empty.
Cart cannot contain duplicate product options.
Workflow steps must be in valid order.
```

## 11.1 Collection invariant example

```java
class Permissions {
    private final Set<Permission> permissions;

    Permissions(Collection<Permission> permissions) {
        if (permissions == null || permissions.isEmpty()) {
            throw new IllegalArgumentException("permissions required");
        }
        if (permissions.contains(null)) {
            throw new IllegalArgumentException("permission cannot be null");
        }
        this.permissions = Set.copyOf(permissions);
    }
}
```

## 11.2 Rule

Put invariants at construction and mutation boundaries.

---

# 12. Uniqueness Rules

Uniqueness can be modeled by:

## 12.1 Set

```java
Set<Role>
```

## 12.2 Map key

```java
Map<ProductId, OrderLine>
```

## 12.3 Explicit validation

```java
boolean duplicate = ...
```

## 12.4 Domain merge

If duplicate product added, merge quantity.

```java
addLine(product, qty)
```

does not append duplicate; it increases existing line.

## 12.5 Rule

Uniqueness rule should be explicit: reject, merge, replace, or ignore.

---

# 13. Ordering Rules

Ordering types:

## 13.1 Insertion order

Use `List` or `LinkedHashSet`/`LinkedHashMap`.

## 13.2 Sorted order

Use `TreeSet`/`TreeMap` or sort view.

## 13.3 User-defined order

Use explicit position field.

## 13.4 Domain sequence

Use value object:

```java
ApprovalStepNumber
```

## 13.5 Rule

Do not rely on accidental order of HashMap/HashSet.

---

# 14. Cardinality Rules

Cardinality examples:

```text
0..*
1..*
0..1
exactly 3
max 10
```

## 14.1 Encode in constructor

```java
if (items.size() > 10) {
    throw new TooManyItemsException();
}
```

## 14.2 Better type

```java
final class ApprovalChain {
    // guarantees at least one approver
}
```

## 14.3 Rule

Collection size constraints are domain rules, not UI-only validations.

---

# 15. Null Rules

Domain collections should usually reject null.

## 15.1 Constructor

```java
if (items.stream().anyMatch(Objects::isNull)) {
    throw new IllegalArgumentException("items cannot contain null");
}
```

## 15.2 Copy factories

`List.copyOf`, `Set.copyOf`, `Map.copyOf` reject nulls.

This can help enforce policy.

## 15.3 Rule

Null in domain collections should be rare and explicit.

---

# 16. Duplicate Rules

Duplicates can mean:

- allowed meaningful repetition;
- invalid duplicate;
- merge required;
- replace previous;
- latest wins;
- first wins.

## 16.1 Example: order line duplicate product

Policy options:

```text
reject duplicate product
merge quantities
allow duplicate lines because options differ
```

## 16.2 Rule

Never leave duplicate policy accidental.

---

# 17. Identity vs Equality in Domain Collections

Entity identity and value equality differ.

## 17.1 Entity

```java
User(id, name)
```

Identity by `id`.

## 17.2 Value object

```java
Money(amount, currency)
```

Equality by all value fields.

## 17.3 Set danger

If entity `equals/hashCode` includes mutable fields, set membership breaks after mutation.

## 17.4 Rule

Be careful using mutable entities inside hash-based sets/maps.

---

# 18. Entity Collections

Entity collections often use ID-based uniqueness.

Example:

```java
Map<UserId, User>
```

rather than:

```java
Set<User>
```

if equality semantics are unclear.

## 18.1 Aggregate child entity

```java
OrderLineId -> OrderLine
```

## 18.2 Rule

For entities, map by stable identity is often clearer than set by object equality.

---

# 19. Value Object Collections

Value objects are naturally good for sets/lists.

Example:

```java
Set<Permission>
List<Money>
List<Address>
```

## 19.1 Immutability helps

Value objects should be immutable, making set/hash behavior stable.

## 19.2 Rule

Sets of immutable value objects are safer than sets of mutable entities.

---

# 20. Aggregate Boundaries

In DDD, aggregate controls consistency boundary.

Collections inside aggregate should be modified through aggregate methods.

Bad:

```java
order.lines().add(line)
```

Good:

```java
order.addLine(product, quantity)
```

## 20.1 Why

Aggregate enforces invariants.

## 20.2 Rule

Collection mutation inside aggregate should go through aggregate behavior.

---

# 21. Bidirectional Relationships

Bidirectional collection relationships are tricky.

Example:

```java
Order has List<OrderLine>
OrderLine has Order
```

## 21.1 Danger

One side updated, other not.

## 21.2 Encapsulate mutation

```java
void addLine(OrderLine line) {
    lines.add(line);
    line.assignTo(this);
}
```

## 21.3 Rule

Bidirectional relationships require controlled helper methods, not public collection mutation.

---

# 22. Derived Collections

Derived collection is computed from primary state.

Example:

```java
List<OrderLine> expensiveLines() {
    return lines.stream()
        .filter(line -> line.subtotal().isGreaterThan(Money.of(100)))
        .toList();
}
```

## 22.1 Do not store if cheap

Compute on demand.

## 22.2 Store/cache if expensive

But invalidate carefully.

## 22.3 Rule

Avoid duplicating collection state unless caching is justified and invalidation is correct.

---

# 23. Snapshot vs Live View

## 23.1 Snapshot

```java
List.copyOf(lines)
```

Caller sees current state only.

## 23.2 Live view

```java
Collections.unmodifiableList(lines)
```

Caller cannot mutate via view, but sees future internal changes.

## 23.3 Which is better?

At domain boundary, snapshot is often safer.

For internal high-performance code, live view may be okay with clear contract.

## 23.4 Rule

Know whether returned collection is snapshot or live view.

---

# 24. Immutable Domain Collections

Immutable domain collections are easier to reason about.

## 24.1 Example

```java
record Permissions(Set<Permission> values) {
    public Permissions {
        values = Set.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("permissions cannot be empty");
        }
    }
}
```

## 24.2 Benefit

Thread-safety, stable equality, no hidden mutation.

## 24.3 Cost

Updates create copies.

## 24.4 Rule

Use immutable collections for value objects and API boundaries unless mutation is core behavior.

---

# 25. Defensive Copying

## 25.1 Constructor

```java
this.items = List.copyOf(items);
```

## 25.2 Getter

```java
return List.copyOf(items);
```

## 25.3 For mutable elements

Copying collection does not copy elements.

If elements mutable, mutation can still leak.

## 25.4 Rule

Defensive copy protects collection structure, not necessarily element state.

---

# 26. Domain Methods Instead of Collection Setters

Bad:

```java
setRoles(Set<Role> roles)
```

Better:

```java
grant(Role role)
revoke(Role role)
has(Role role)
```

## 26.1 Why

Domain methods encode rules.

Example:

```java
void revoke(Role role) {
    if (roles.size() == 1 && roles.contains(role)) {
        throw new CannotRemoveLastRoleException();
    }
    roles.remove(role);
}
```

## 26.2 Rule

Replace generic collection setters with intention-revealing methods.

---

# 27. Collection as State Machine

Sometimes collection state evolves through valid transitions.

Example workflow:

```text
draft lines -> submitted lines -> fulfilled lines
```

## 27.1 Avoid arbitrary mutation

Use methods:

```java
submit()
cancelLine(lineId)
fulfillLine(lineId)
```

## 27.2 Rule

If collection state has lifecycle, model lifecycle explicitly.

---

# 28. Modeling Ordered Line Items

Order line items often require:

- insertion order;
- line number;
- product uniqueness maybe;
- quantity > 0;
- subtotal calculation;
- cannot mutate after submission.

## 28.1 Model

```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    void addLine(Product product, Quantity quantity) {
        requireDraft();
        lines.add(OrderLine.create(nextLineNumber(), product, quantity));
    }

    List<OrderLine> lines() {
        return List.copyOf(lines);
    }
}
```

## 28.2 If product uniqueness required

Use map internally:

```java
Map<ProductId, OrderLine>
```

but expose ordered list if display order matters.

## 28.3 Rule

Internal structure can differ from exposed domain view.

---

# 29. Modeling Unique Roles/Permissions

Roles are naturally set-like.

```java
final class UserRoles {
    private final Set<Role> roles;
}
```

## 29.1 Invariant

At least one role.

## 29.2 Methods

```java
grant
revoke
has
```

## 29.3 Avoid

```java
setRoles
getRolesMutable
```

## 29.4 Rule

Permission collections should enforce uniqueness and minimum security invariants.

---

# 30. Modeling Lookup Tables

If lookup is primary, map is domain model.

Example:

```java
final class PriceBook {
    private final Map<ProductId, Money> priceByProduct;

    Money priceOf(ProductId productId) {
        Money price = priceByProduct.get(productId);
        if (price == null) {
            throw new MissingPriceException(productId);
        }
        return price;
    }
}
```

## 30.1 Null values

Avoid null map values.

## 30.2 Missing key

Return Optional or throw domain exception depending semantics.

## 30.3 Rule

A map-backed domain object should hide raw `get` ambiguity.

---

# 31. Modeling History and Audit Trail

History is usually append-only ordered list.

```java
final class CaseHistory {
    private final List<CaseEvent> events = new ArrayList<>();

    void append(CaseEvent event) {
        if (!event.caseId().equals(caseId)) {
            throw new IllegalArgumentException();
        }
        events.add(event);
    }

    List<CaseEvent> snapshot() {
        return List.copyOf(events);
    }
}
```

## 31.1 Invariants

- append-only;
- timestamp monotonic maybe;
- event belongs to aggregate;
- no null.

## 31.2 Rule

History collection should prevent arbitrary insert/remove/reorder.

---

# 32. Modeling Work Queues

Work queue domain:

```java
class PendingTasks {
    private final Deque<Task> tasks = new ArrayDeque<>();

    void enqueue(Task task) {
        tasks.addLast(task);
    }

    Optional<Task> dequeue() {
        return Optional.ofNullable(tasks.pollFirst());
    }
}
```

## 32.1 Persistent vs in-memory

Domain queue is not same as distributed queue.

## 32.2 Rule

Use collection queue semantics only for in-memory/domain state, not as substitute for messaging infrastructure.

---

# 33. Collections and Persistence

ORMs complicate collection modeling.

## 33.1 JPA/Hibernate

May require mutable collections, proxies, lazy loading.

## 33.2 Domain purity vs persistence convenience

Options:

- persistence entity separate from domain;
- protected no-arg constructor;
- encapsulated mutable collection;
- defensive getters;
- domain methods mutate internal collection.

## 33.3 Beware

- lazy collection outside transaction;
- `equals/hashCode` on entities;
- orphan removal rules;
- cascade semantics;
- collection replacement vs mutation.

## 33.4 Rule

Do not let ORM collection requirements dictate public domain API.

---

# 34. Collections and API DTOs

API DTO collection semantics must be explicit.

## 34.1 Request DTO

Validate:

- null list;
- empty list;
- null element;
- duplicate element;
- max size;
- order.

## 34.2 Response DTO

Decide:

- empty list vs null;
- order;
- immutability;
- pagination;
- partial results.

## 34.3 Rule

Normalize API collections before entering domain.

---

# 35. Collections and Domain Events

Collection mutation often produces domain events.

Example:

```java
void addRole(Role role) {
    if (roles.add(role)) {
        registerEvent(new RoleGranted(userId, role));
    }
}
```

## 35.1 Avoid event spam

If duplicate grant ignored, should event be emitted?

Depends policy.

## 35.2 Rule

Domain collection changes should produce events according to business meaning, not raw method calls.

---

# 36. Validation Strategies

## 36.1 Fail-fast

Constructor throws on invalid collection.

Good for domain invariants.

## 36.2 Accumulate errors

Good for request validation/import.

## 36.3 Normalize

Convert null to empty only if semantically correct.

## 36.4 Rule

Use fail-fast for impossible domain state; accumulate errors at boundary.

---

# 37. Performance and Memory Considerations

Domain modeling should not ignore cost.

## 37.1 Small collections

Immutability/copying usually fine.

## 37.2 Large collections

Copying on every getter can be costly.

Options:

- return unmodifiable view internally;
- expose iterator/stream carefully;
- pagination;
- query service;
- specialized data structure.

## 37.3 Map vs List

For frequent lookup, map internally.

For ordered display, keep list or linked map.

## 37.4 Rule

Choose domain-correct structure first, then optimize with measured constraints.

---

# 38. Common Anti-Patterns

## 38.1 Public mutable collection getter

Breaks invariants.

## 38.2 Generic setter replacing collection

Bypasses rules.

## 38.3 Null collection fields

Use empty.

## 38.4 Null elements in domain collection

Usually invalid.

## 38.5 HashSet of mutable entities

Danger.

## 38.6 Relying on HashMap order

Bug.

## 38.7 Duplicate policy accidental

Bug.

## 38.8 ORM entity collection as public domain API

Leaky.

## 38.9 Returning live mutable subList

Danger.

## 38.10 Filtering invalid domain data silently

Hides corruption.

---

# 39. Production Failure Modes

## 39.1 Order total wrong

Caller mutated order lines via getter.

## 39.2 Security role removed accidentally

Public set exposed.

## 39.3 Duplicate order lines

No uniqueness/merge rule.

## 39.4 Missing audit event

Raw collection mutation bypassed domain method.

## 39.5 Lazy loading exception

Collection exposed outside transaction.

## 39.6 HashSet cannot find entity

Mutable hash fields changed.

## 39.7 API returns null list

Client crash.

## 39.8 Pagination unstable

Order not specified.

## 39.9 Concurrent modification

Internal mutable collection exposed to multiple callers.

## 39.10 Memory spike

Defensive copying huge collections repeatedly.

---

# 40. Best Practices

## 40.1 Let collection type express domain semantics

List for order, Set for uniqueness, Map for lookup.

## 40.2 Wrap important collections

Use custom value object if rules exist.

## 40.3 Keep collections private

Expose behavior/snapshots.

## 40.4 Replace setters with domain methods

Grant, revoke, addLine, removeLine, appendEvent.

## 40.5 Enforce invariants at boundaries

Constructor and mutation methods.

## 40.6 Reject null by default

Unless domain explicitly allows.

## 40.7 Decide duplicate policy

Reject, merge, replace, ignore.

## 40.8 Be explicit about ordering

Insertion, sorted, user-defined.

## 40.9 Separate domain from persistence/API constraints

Map DTO/entity carefully.

## 40.10 Measure before optimizing copies

Correctness first.

---

# 41. Decision Matrix

| Domain Requirement | Collection Design |
|---|---|
| ordered sequence | `List` or custom ordered collection |
| uniqueness | `Set` or `Map<Key, Value>` |
| lookup by stable ID | `Map<Id, Entity>` |
| append-only history | private `List` + append method + snapshot |
| FIFO work | `Queue` |
| stack/undo | `Deque` |
| no empty allowed | custom value object/enforced constructor |
| max size | custom value object/enforced method |
| duplicate product should merge | domain method + map/list hybrid |
| duplicate should fail | constructor/mutation validation |
| null invalid | `Objects.requireNonNull`, copy factories |
| unknown bucket valid | sentinel enum/value |
| order must be stable in API | explicit sort or ordered collection |
| public mutation forbidden | defensive copy/snapshot |
| large collection | avoid repeated copies; design read model/pagination |
| ORM mutable collection needed | hide behind domain methods |
| API request list nullable | normalize/validate at boundary |
| entity equality unstable | map by ID, not set by entity |
| value object immutable | set/list safe |
| domain events on changes | mutate through methods only |

---

# 42. Latihan

## Latihan 1 — OrderLines Value Object

Create `OrderLines` that rejects null, rejects empty on submit, and computes total.

## Latihan 2 — UserRoles

Create `UserRoles` with grant/revoke/has and cannot remove last role.

## Latihan 3 — Duplicate Product Policy

Implement two designs: reject duplicate product vs merge quantity.

## Latihan 4 — Snapshot vs Live View

Show difference between `List.copyOf(lines)` and `Collections.unmodifiableList(lines)`.

## Latihan 5 — Entity Set Bug

Create mutable entity in HashSet, mutate hash field, observe contains failure.

## Latihan 6 — PriceBook

Implement map-backed `PriceBook` with explicit missing price behavior.

## Latihan 7 — CaseHistory

Implement append-only history that rejects events for different case ID.

## Latihan 8 — DTO Boundary

Validate request DTO list: null list, empty list, null elements, duplicate ids.

## Latihan 9 — ORM Leak

Explain why exposing JPA collection directly can break invariants.

## Latihan 10 — Design Review

For an existing domain class with `List` getter/setter, refactor into domain methods.

---

# 43. Ringkasan

Collections are domain modeling tools.

Core lessons:

- Collection choice communicates semantics.
- `List` means order/sequence.
- `Set` means uniqueness/membership.
- `Map` means key-based association/lookup.
- `Queue`/`Deque` means processing order.
- Custom collection value objects encode domain rules.
- Keep collection fields private.
- Do not expose mutable internals.
- Enforce invariants at construction and mutation boundaries.
- Decide uniqueness, ordering, cardinality, null, and duplicate policies explicitly.
- Entity collections often work better as map by stable ID.
- Value object collections are safer when immutable.
- Aggregate should control collection mutation.
- Snapshot and live view are different contracts.
- Domain methods are better than generic setters.
- Persistence/API concerns should not leak into domain collection API.
- Collection mutation can produce domain events.
- Performance matters, but correctness and explicit semantics come first.

Main rule:

```text
Do not ask only “which Java collection should I use?”
Ask “what business rule does this collection represent,
and how will the type/API prevent invalid states?”
```

---

# 44. Referensi

1. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

2. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

3. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

4. Java SE 25 — `Queue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html

5. Java SE 25 — `Deque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html

6. Java SE 25 — `List.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection)

7. Java SE 25 — `Set.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html#copyOf(java.util.Collection)

8. Java SE 25 — `Map.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html#copyOf(java.util.Map)

9. Java SE 25 — `Collections.unmodifiableList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableList(java.util.List)

10. Java SE 25 — `Objects.requireNonNull`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html#requireNonNull(T)

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 046](./learn-java-collections-and-streams-part-046.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 048](./learn-java-collections-and-streams-part-048.md)
