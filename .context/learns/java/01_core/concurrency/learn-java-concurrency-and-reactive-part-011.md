# learn-java-concurrency-and-reactive-part-011.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 011  
# Immutability, Thread Confinement, and Safe Sharing: Designing Concurrent Java by Avoiding Shared Mutable State

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **011**  
> Fokus: memahami strategi concurrency paling kuat: **jangan share mutable state jika tidak perlu**. Bagian ini membahas immutability, final fields, safe construction, defensive copying, immutable snapshots, copy-on-write, thread confinement, stack confinement, object confinement, actor/thread ownership, request confinement, transaction confinement, safe publication, safe sharing, ownership transfer, dan desain object model yang concurrency-friendly.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Big Idea: Concurrency Safety by Design](#2-big-idea-concurrency-safety-by-design)
3. [Shared Mutable State sebagai Sumber Masalah](#3-shared-mutable-state-sebagai-sumber-masalah)
4. [Tiga Strategi Besar](#4-tiga-strategi-besar)
5. [Immutability](#5-immutability)
6. [Shallow vs Deep Immutability](#6-shallow-vs-deep-immutability)
7. [`final` Fields and Initialization Safety](#7-final-fields-and-initialization-safety)
8. [Safe Construction](#8-safe-construction)
9. [`this` Escape](#9-this-escape)
10. [Defensive Copying](#10-defensive-copying)
11. [Unmodifiable View vs Immutable Copy](#11-unmodifiable-view-vs-immutable-copy)
12. [Records as Immutable-ish Data Carriers](#12-records-as-immutable-ish-data-carriers)
13. [Immutable Snapshot Pattern](#13-immutable-snapshot-pattern)
14. [Copy-On-Write Pattern](#14-copy-on-write-pattern)
15. [Persistent/Functional Data Structure Mental Model](#15-persistentfunctional-data-structure-mental-model)
16. [Thread Confinement](#16-thread-confinement)
17. [Stack Confinement](#17-stack-confinement)
18. [Object Confinement](#18-object-confinement)
19. [Thread Ownership and Actor-Like Design](#19-thread-ownership-and-actor-like-design)
20. [Request Confinement](#20-request-confinement)
21. [Transaction Confinement](#21-transaction-confinement)
22. [Ownership Transfer](#22-ownership-transfer)
23. [Safe Sharing](#23-safe-sharing)
24. [Safe Publication Mechanisms](#24-safe-publication-mechanisms)
25. [Publishing Immutable Objects](#25-publishing-immutable-objects)
26. [Publishing Mutable Objects Safely](#26-publishing-mutable-objects-safely)
27. [Mutable Internals Behind Immutable API](#27-mutable-internals-behind-immutable-api)
28. [Thread-Safe Collections vs Immutable Collections](#28-thread-safe-collections-vs-immutable-collections)
29. [Avoiding Shared Entity Objects](#29-avoiding-shared-entity-objects)
30. [DTOs, Commands, Events, and Snapshots](#30-dtos-commands-events-and-snapshots)
31. [Immutability and Virtual Threads](#31-immutability-and-virtual-threads)
32. [Immutability and Reactive Programming](#32-immutability-and-reactive-programming)
33. [Performance Trade-Offs](#33-performance-trade-offs)
34. [Production Design Patterns](#34-production-design-patterns)
35. [Common Bugs](#35-common-bugs)
36. [Mini Case Study: Shared Mutable Config](#36-mini-case-study-shared-mutable-config)
37. [Mini Case Study: Request Object Captured by Async Task](#37-mini-case-study-request-object-captured-by-async-task)
38. [Mini Case Study: Mutable List in Record](#38-mini-case-study-mutable-list-in-record)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Setelah membahas JMM, `volatile`, atomics, locks, dan coordination primitives, kita perlu mundur satu langkah dan bertanya:

```text
Apakah state ini memang harus shared dan mutable?
```

Banyak concurrency bug bukan karena kita kurang canggih memakai lock, melainkan karena desain object model terlalu banyak membagikan mutable state.

Contoh:

```java
class UserSession {
    Map<String, Object> attributes = new HashMap<>();
}
```

Jika object ini dipegang oleh banyak thread:

- controller thread;
- async task;
- scheduler;
- event listener;
- websocket sender;

maka kita harus menjawab:

```text
Siapa owner attributes?
Siapa boleh mutate?
Kapan perubahan terlihat?
Apakah iteration aman?
Apakah state snapshot konsisten?
Apakah task async melihat state lama atau baru?
```

Strategi terbaik sering bukan menambah lock, tetapi mengubah desain:

```text
make data immutable
confine mutable state to one thread/owner
publish snapshots safely
transfer ownership explicitly
```

Target bagian ini:

- memahami immutability sebagai concurrency primitive;
- memahami thread confinement;
- memahami safe sharing;
- memahami safe publication;
- memahami defensive copying;
- memahami snapshot/copy-on-write;
- memahami ownership transfer;
- bisa mendesain object model concurrent yang minim lock.

Main rule:

```text
The safest shared object is an immutable object.
The safest mutable object is one that is not shared.
```

---

# 2. Big Idea: Concurrency Safety by Design

Ada dua cara besar membuat concurrent code benar.

## 2.1 Control sharing with synchronization

Gunakan:

- lock;
- volatile;
- atomics;
- concurrent collections;
- semaphores;
- latches.

Ini penting, tetapi menambah reasoning complexity.

## 2.2 Reduce sharing by design

Gunakan:

- immutable objects;
- local variables;
- per-request objects;
- per-thread ownership;
- message passing;
- snapshots;
- copy-on-write;
- ownership transfer.

Ini sering lebih scalable secara mental.

## 2.3 Why top engineers care

Production system besar sulit dianalisis jika semua object bisa berubah dari mana saja.

Concurrency yang baik sering terasa membosankan:

```text
data masuk sebagai immutable command
diproses dalam confined transaction
hasil keluar sebagai immutable event/snapshot
```

## 2.4 Main rule

```text
The best synchronization is often no synchronization because no mutable state is shared.
```

---

# 3. Shared Mutable State sebagai Sumber Masalah

Shared mutable state punya tiga kata berbahaya.

## 3.1 Shared

Lebih dari satu thread bisa akses.

## 3.2 Mutable

Nilainya bisa berubah.

## 3.3 State

Perubahan punya efek terhadap behavior berikutnya.

Jika ketiganya ada, kita butuh discipline.

## 3.4 Example

```java
class Cart {
    private final List<Item> items = new ArrayList<>();

    void add(Item item) {
        items.add(item);
    }

    List<Item> items() {
        return items;
    }
}
```

Masalah:

- list internal diekspos;
- caller bisa mutate tanpa lock;
- iteration bisa fail;
- state bisa berubah saat diproses async;
- tidak ada happens-before.

## 3.5 Main rule

```text
Shared mutable state must have an owner and a synchronization policy.
If not, it is a bug waiting for timing.
```

---

# 4. Tiga Strategi Besar

Untuk setiap state, pilih salah satu.

## 4.1 Immutable and shared

Object tidak berubah setelah dibuat.

```java
record UserSnapshot(String id, String name) {}
```

Aman dibagikan.

## 4.2 Mutable but confined

Object bisa berubah, tetapi hanya satu thread/owner yang akses.

```text
local variable
request-scoped object
actor-owned state
transaction-local entity
```

## 4.3 Mutable and synchronized

Object shared dan mutable, tetapi semua akses dilindungi.

```java
synchronized
Lock
ConcurrentHashMap
AtomicReference
```

## 4.4 Main rule

```text
For every object, decide:
immutable shared, mutable confined, or mutable synchronized.
Never “mutable shared by accident”.
```

---

# 5. Immutability

Immutable object tidak berubah setelah construction selesai.

Example:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        this.amount = amount;
        this.currency = currency;
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }
}
```

## 5.1 Benefits

- thread-safe by design;
- no locks for reads;
- easier reasoning;
- safe for caching;
- safe as map keys if equals/hashCode stable;
- safe for async handoff;
- easier testing.

## 5.2 Requirements

- no setters;
- fields final where possible;
- no mutable internals exposed;
- constructor completes safely;
- referenced objects immutable or copied;
- class not extendable in unsafe way.

## 5.3 Main rule

```text
Immutable objects turn concurrency from coordination problem into data flow problem.
```

---

# 6. Shallow vs Deep Immutability

## 6.1 Shallow immutability

Reference cannot change, but object behind reference can mutate.

```java
public final class UserGroup {
    private final List<String> members;

    public UserGroup(List<String> members) {
        this.members = members;
    }

    public List<String> members() {
        return members;
    }
}
```

Field `members` is final, but list is mutable.

## 6.2 Deep/effective immutability

```java
public final class UserGroup {
    private final List<String> members;

    public UserGroup(List<String> members) {
        this.members = List.copyOf(members);
    }

    public List<String> members() {
        return members;
    }
}
```

Now caller cannot mutate internal list through original list or returned list.

## 6.3 Main rule

```text
final reference is not enough.
The reachable object graph must also be immutable or protected.
```

---

# 7. `final` Fields and Initialization Safety

JLS final field semantics memberi special guarantees untuk properly constructed objects.

Jika:

- final fields assigned in constructor;
- object does not escape during construction;

then other threads that obtain reference after construction get stronger visibility guarantees for final fields.

## 7.1 Example

```java
final class UserSnapshot {
    private final String id;
    private final String name;

    UserSnapshot(String id, String name) {
        this.id = id;
        this.name = name;
    }
}
```

## 7.2 Not magic for mutable internals

```java
private final List<String> roles;
```

The reference is final, not necessarily the list contents.

## 7.3 Main rule

```text
final fields are the foundation of immutable object safety,
but safe construction and deep immutability still matter.
```

---

# 8. Safe Construction

Safe construction means object becomes visible to other threads only after constructor finishes.

Good:

```java
UserSnapshot snapshot = new UserSnapshot(id, name);
registry.publish(snapshot);
```

Bad:

```java
class Service {
    Service(EventBus bus) {
        bus.register(this); // escape before fully constructed
        initializeFields();
    }
}
```

## 8.1 Do not start thread in constructor

Bad:

```java
class Worker {
    Worker() {
        new Thread(this::run).start();
    }
}
```

The new thread can observe partially constructed object.

## 8.2 Use factory/start method

```java
class Worker {
    static Worker createAndStart() {
        Worker worker = new Worker();
        worker.start();
        return worker;
    }

    private Worker() {
        initialize();
    }

    void start() {
        Thread.ofPlatform().start(this::run);
    }
}
```

## 8.3 Main rule

```text
Construct first, publish/start/register later.
```

---

# 9. `this` Escape

`this` escapes when reference to current object becomes visible before constructor completes.

Common escapes:

## 9.1 Register listener

```java
eventBus.register(this);
```

## 9.2 Start thread

```java
new Thread(this::run).start();
```

## 9.3 Submit task

```java
executor.submit(this::run);
```

## 9.4 Call overridable method

```java
class Base {
    Base() {
        init(); // overridden method may see subclass before initialized
    }

    void init() {}
}
```

## 9.5 Publish to static field

```java
Global.instance = this;
```

## 9.6 Main rule

```text
Do not let this escape from constructor.
```

---

# 10. Defensive Copying

Defensive copying prevents caller from mutating internal state.

## 10.1 Copy input

Bad:

```java
final class Order {
    private final List<Item> items;

    Order(List<Item> items) {
        this.items = items;
    }
}
```

Caller can mutate original list.

Good:

```java
Order(List<Item> items) {
    this.items = List.copyOf(items);
}
```

## 10.2 Copy output if mutable

If internal is mutable:

```java
List<Item> items() {
    return new ArrayList<>(items);
}
```

Better: internal immutable.

```java
List<Item> items() {
    return items;
}
```

if `items` is immutable copy.

## 10.3 Main rule

```text
Never store or expose mutable objects without deciding ownership.
```

---

# 11. Unmodifiable View vs Immutable Copy

These are different.

## 11.1 Unmodifiable view

```java
List<String> view = Collections.unmodifiableList(original);
```

The view blocks mutation through the view, but if `original` changes, view reflects changes.

## 11.2 Immutable copy

```java
List<String> copy = List.copyOf(original);
```

The copy does not reflect later mutation of original.

## 11.3 Example bug

```java
List<String> original = new ArrayList<>();
List<String> view = Collections.unmodifiableList(original);

original.add("admin");

System.out.println(view); // contains admin
```

## 11.4 Main rule

```text
For safe sharing, prefer immutable copy over unmodifiable view of mutable backing data.
```

---

# 12. Records as Immutable-ish Data Carriers

Records are great for data carriers:

```java
record UserDto(String id, String name) {}
```

Record fields are final, but record is only as immutable as its components.

## 12.1 Mutable component bug

```java
record UserRoles(String userId, List<String> roles) {}
```

Caller can mutate list.

## 12.2 Compact constructor fix

```java
record UserRoles(String userId, List<String> roles) {
    UserRoles {
        roles = List.copyOf(roles);
    }
}
```

## 12.3 Main rule

```text
Records reduce boilerplate but do not automatically make mutable components deeply immutable.
```

---

# 13. Immutable Snapshot Pattern

Use one immutable aggregate representing current state.

```java
record RoutingTable(
    Map<String, URI> routes,
    long version
) {
    RoutingTable {
        routes = Map.copyOf(routes);
    }
}
```

Holder:

```java
final class RoutingRegistry {
    private volatile RoutingTable current;

    RoutingRegistry(RoutingTable initial) {
        this.current = initial;
    }

    RoutingTable current() {
        return current;
    }

    void reload(RoutingTable next) {
        current = next;
    }
}
```

## 13.1 Benefits

- readers lock-free;
- consistent snapshot;
- no partial update;
- simple rollback;
- versioning possible.

## 13.2 Use cases

- feature flags;
- routing table;
- config;
- permissions snapshot;
- pricing rules;
- cached reference data.

## 13.3 Main rule

```text
For read-mostly shared state, immutable snapshot + volatile/atomic reference is often ideal.
```

---

# 14. Copy-On-Write Pattern

Copy-on-write means writes create new copy, then atomically publish.

```java
final class ListenerRegistry {
    private final AtomicReference<List<Listener>> listeners =
        new AtomicReference<>(List.of());

    void add(Listener listener) {
        listeners.updateAndGet(current -> {
            ArrayList<Listener> next = new ArrayList<>(current);
            next.add(listener);
            return List.copyOf(next);
        });
    }

    void publish(Event event) {
        for (Listener listener : listeners.get()) {
            listener.onEvent(event);
        }
    }
}
```

## 14.1 Good when

- reads frequent;
- writes rare;
- list/map moderate size;
- iteration must be stable.

## 14.2 Bad when

- writes frequent;
- collection huge;
- copy cost too high.

## 14.3 Built-in example

```java
CopyOnWriteArrayList
```

## 14.4 Main rule

```text
Copy-on-write trades write cost for simple, safe, fast reads.
```

---

# 15. Persistent/Functional Data Structure Mental Model

Persistent data structures preserve previous versions when updated.

Conceptually:

```text
old version remains valid
new version shares structure where safe
```

Java standard library does not provide full persistent collections like some functional languages, but the mental model is valuable.

## 15.1 Snapshot thinking

Instead of mutating:

```java
current.rules().put(...)
```

create:

```java
new RulesSnapshot(...)
```

## 15.2 Benefits

- stable reads;
- easy rollback;
- safer async use;
- easier audit/versioning.

## 15.3 Main rule

```text
Prefer versioned snapshots over in-place mutation for shared read-mostly data.
```

---

# 16. Thread Confinement

Thread confinement means object is only accessed by one thread.

If object never crosses thread boundary, it does not need synchronization.

## 16.1 Examples

- local variables;
- request-local data;
- parser buffer inside one worker;
- entity manager bound to one transaction thread;
- actor state owned by one event loop;
- batch chunk state inside one worker.

## 16.2 Danger

Confinement is a discipline, not compiler-enforced by default.

If reference leaks, confinement breaks.

## 16.3 Main rule

```text
Mutable state is safe without locks only when it is truly confined.
```

---

# 17. Stack Confinement

Local variables are naturally confined to the thread executing the method, unless their referenced objects escape.

```java
void process() {
    List<String> rows = new ArrayList<>();
    rows.add("a");
    rows.add("b");
    validate(rows);
}
```

If `rows` does not escape to another thread, safe.

## 17.1 Escape bug

```java
void process() {
    List<String> rows = new ArrayList<>();
    executor.submit(() -> use(rows));
    rows.add("later");
}
```

Now rows is shared.

## 17.2 Main rule

```text
Local variable references are thread-confined only until you publish them elsewhere.
```

---

# 18. Object Confinement

Object confinement means mutable state is encapsulated and only accessed under controlled methods.

Example:

```java
final class CounterService {
    private final Counter counter = new Counter();

    synchronized void increment() {
        counter.increment();
    }

    synchronized long value() {
        return counter.value();
    }
}
```

`Counter` itself may not be thread-safe, but it is confined behind synchronized service.

## 18.1 Collection confinement

```java
private final List<Item> items = new ArrayList<>();
```

Safe if:

- private;
- never returned directly;
- all access under lock or one thread.

## 18.2 Main rule

```text
Encapsulation is a concurrency tool.
Do not expose mutable internals.
```

---

# 19. Thread Ownership and Actor-Like Design

Actor-like design:

```text
one owner thread owns mutable state
other threads send messages/tasks
owner processes sequentially
```

Example:

```java
final class CaseActor {
    private final ExecutorService singleThread;
    private final Map<CaseId, CaseState> states = new HashMap<>();

    void submit(Command command) {
        singleThread.execute(() -> handle(command));
    }

    private void handle(Command command) {
        // only owner thread mutates states
    }
}
```

## 19.1 Benefits

- no locks inside actor state;
- sequential reasoning;
- preserves per-owner order.

## 19.2 Costs

- single-thread bottleneck;
- queue latency;
- failure handling;
- backpressure required.

## 19.3 Main rule

```text
Thread ownership turns shared mutable state into message-passing state.
```

---

# 20. Request Confinement

Request-local state should live and die with request.

Example:

```java
void handle(Request request) {
    RequestContext context = new RequestContext(request.id());
    service.process(context);
}
```

Safe if not shared beyond request threads.

## 20.1 Async danger

```java
executor.submit(() -> use(context));
```

Now context may outlive request.

## 20.2 Better

Pass immutable snapshot:

```java
record RequestSnapshot(String requestId, UserId userId, Instant deadline) {}
```

## 20.3 Main rule

```text
Do not pass mutable request objects to async tasks.
Pass immutable request snapshots.
```

---

# 21. Transaction Confinement

ORM entities are often meant to be used within transaction/persistence context.

Bad:

```java
Order order = repository.find(id);

executor.submit(() -> {
    order.setStatus(SHIPPED);
    repository.save(order);
});
```

Problems:

- entity detached;
- lazy loading;
- transaction context missing;
- concurrent mutation;
- stale state.

Better:

```java
record ShipOrderCommand(OrderId orderId, UserId userId) {}

executor.submit(() -> shippingService.ship(command));
```

The async service opens its own transaction and reloads entity.

## 21.1 Main rule

```text
Do not share mutable ORM entities across thread/transaction boundaries.
Share IDs/commands/snapshots.
```

---

# 22. Ownership Transfer

Ownership transfer means after handoff, sender no longer mutates object.

Example:

```java
List<Row> rows = new ArrayList<>();
// build rows

queue.put(rows);

// sender must not mutate rows after put
```

Better:

```java
queue.put(List.copyOf(rows));
```

## 22.1 Message passing

Ownership transfer works well when message is immutable.

## 22.2 Mutable transfer discipline

If mutable transfer is necessary, enforce:

```text
after transfer, original owner cannot touch it
```

Hard to guarantee in Java without discipline.

## 22.3 Main rule

```text
Ownership transfer is safest when transferred object is immutable.
```

---

# 23. Safe Sharing

Safe sharing means object can be accessed by multiple threads correctly.

Ways:

## 23.1 Immutable object

Share freely after safe construction/publication.

## 23.2 Thread-safe object

Internally synchronized/concurrent.

## 23.3 Effectively immutable object

Mutable during construction, then never mutated after publication.

## 23.4 Guarded object

Access only under lock.

## 23.5 Confined object

Not actually shared.

## 23.6 Main rule

```text
Shared object must be immutable, thread-safe, effectively immutable, or guarded.
```

---

# 24. Safe Publication Mechanisms

Safe publication creates happens-before relationship for object visibility.

Mechanisms include:

- static initialization;
- volatile reference write/read;
- AtomicReference set/get;
- synchronized write/read under same lock;
- concurrent collection handoff;
- BlockingQueue put/take;
- Executor submission;
- Future completion/get;
- Thread.start;
- Thread.join;
- CountDownLatch/Semaphore/synchronizers.

`java.util.concurrent` package docs specify memory consistency effects for concurrent collections, executors, futures, and synchronizers; actions before placing objects into concurrent collections happen-before actions after access/removal in another thread, and actions before submitting a task to an executor happen-before task execution.

## 24.1 Main rule

```text
Object construction must be followed by safe publication before cross-thread access.
```

---

# 25. Publishing Immutable Objects

Immutable objects are easy to publish safely.

Example:

```java
record AppConfig(Map<String, String> values) {
    AppConfig {
        values = Map.copyOf(values);
    }
}
```

Publication:

```java
private volatile AppConfig current;

void reload(AppConfig next) {
    current = next;
}

AppConfig current() {
    return current;
}
```

## 25.1 If initialized statically

```java
static final AppConfig DEFAULT = new AppConfig(Map.of());
```

Static initialization is safe.

## 25.2 Main rule

```text
Immutable object + safe publication = safe sharing.
```

---

# 26. Publishing Mutable Objects Safely

Sometimes objects must be mutable and shared.

Options:

## 26.1 Internal synchronization

```java
class SharedCache {
    private final Object lock = new Object();
    private final Map<Key, Value> map = new HashMap<>();

    Value get(Key key) {
        synchronized (lock) {
            return map.get(key);
        }
    }
}
```

## 26.2 Concurrent collection

```java
ConcurrentHashMap<Key, Value> map = new ConcurrentHashMap<>();
```

## 26.3 External lock

Less preferred because ownership is unclear.

## 26.4 Main rule

```text
Publishing a mutable object safely does not make all future mutations safe.
Future access still needs synchronization.
```

---

# 27. Mutable Internals Behind Immutable API

Sometimes class uses mutable internals but exposes immutable behavior.

Example caching hash:

```java
public final class ExpensiveValue {
    private final String value;
    private volatile int cachedHash;

    public int hashCode() {
        int h = cachedHash;
        if (h == 0) {
            h = value.hashCode();
            cachedHash = h;
        }
        return h;
    }
}
```

This can be safe if benign race is acceptable and invariant not broken.

## 27.1 Be careful

Benign races must truly be benign.

If race can expose invalid state, use synchronization.

## 27.2 Main rule

```text
Mutable internals are acceptable only when external observable state remains safely immutable/thread-safe.
```

---

# 28. Thread-Safe Collections vs Immutable Collections

## 28.1 Thread-safe collection

Example:

```java
ConcurrentHashMap
CopyOnWriteArrayList
BlockingQueue
```

Allows concurrent operations.

## 28.2 Immutable collection

Example:

```java
List.copyOf(...)
Map.copyOf(...)
```

Cannot be mutated.

## 28.3 Different use cases

Use concurrent collection when collection is shared and changes over time.

Use immutable collection when publishing stable snapshot.

## 28.4 Compound actions

Even with concurrent collections, compound actions may need atomic methods.

Bad:

```java
if (!map.containsKey(k)) {
    map.put(k, v);
}
```

Better:

```java
map.putIfAbsent(k, v);
```

## 28.5 Main rule

```text
Thread-safe collection protects individual operations.
Immutable collection removes mutation altogether.
```

---

# 29. Avoiding Shared Entity Objects

Entity objects often carry mutable state and persistence context assumptions.

Avoid:

```java
executor.submit(() -> process(orderEntity));
```

Prefer:

```java
executor.submit(() -> process(new ProcessOrderCommand(orderId)));
```

## 29.1 Why

- avoids detached entity bugs;
- avoids lazy loading across threads;
- avoids stale mutable state;
- creates clear transaction boundary;
- easier retry/idempotency.

## 29.2 Main rule

```text
Pass identity and immutable command across async boundaries, not live mutable entities.
```

---

# 30. DTOs, Commands, Events, and Snapshots

Good concurrent systems use explicit immutable data shapes.

## 30.1 DTO

Data transfer shape.

```java
record UserDto(String id, String name) {}
```

## 30.2 Command

Request to change state.

```java
record ApproveCaseCommand(CaseId caseId, UserId approverId, String idempotencyKey) {}
```

## 30.3 Event

Fact that happened.

```java
record CaseApprovedEvent(CaseId caseId, Instant approvedAt, long version) {}
```

## 30.4 Snapshot

Point-in-time state.

```java
record CaseSnapshot(CaseId id, CaseStatus status, long version) {}
```

## 30.5 Main rule

```text
Immutable messages make thread boundaries explicit and safe.
```

---

# 31. Immutability and Virtual Threads

Virtual threads make it easy to create many concurrent tasks.

That increases the importance of safe sharing.

Bad:

```java
List<Result> results = new ArrayList<>();

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Task task : tasks) {
        executor.submit(() -> results.add(process(task)));
    }
}
```

`ArrayList` not thread-safe.

Better:

```java
List<Future<Result>> futures = new ArrayList<>();

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Task task : tasks) {
        futures.add(executor.submit(() -> process(task)));
    }

    List<Result> results = new ArrayList<>();
    for (Future<Result> future : futures) {
        results.add(future.get());
    }
}
```

Or use concurrent collection if needed.

## 31.1 Main rule

```text
More concurrency makes shared mutable state bugs easier to trigger.
Virtual threads do not make mutable state safe.
```

---

# 32. Immutability and Reactive Programming

Reactive pipelines often pass data across threads/operators.

Immutable signals are easier.

Bad:

```java
Flux.just(mutableOrder)
    .publishOn(scheduler)
    .doOnNext(order -> order.setStatus(...));
```

Better:

```java
Flux.just(orderSnapshot)
    .map(snapshot -> snapshot.withStatus(...));
```

## 32.1 Reactive context

Reactive context should carry immutable metadata.

## 32.2 Main rule

```text
Reactive systems strongly benefit from immutable event/data objects.
```

---

# 33. Performance Trade-Offs

Immutability has costs and benefits.

## 33.1 Costs

- allocation;
- copying;
- GC pressure;
- large snapshot rebuild;
- memory for versions.

## 33.2 Benefits

- no locks for reads;
- simpler concurrency;
- stable snapshots;
- less defensive locking;
- easier caching;
- fewer heisenbugs;
- better async safety.

## 33.3 Optimization choices

- copy only on write;
- structural sharing libraries if needed;
- keep snapshots coarse enough;
- avoid unnecessary deep copies of immutable objects;
- use profiling.

## 33.4 Main rule

```text
The cost of copying is often cheaper than the cost of debugging shared mutable state.
Measure before sacrificing immutability.
```

---

# 34. Production Design Patterns

## 34.1 Immutable command into async boundary

```java
executor.submit(() -> handler.handle(command));
```

## 34.2 Immutable event out of transaction

```java
eventPublisher.publish(new CaseApprovedEvent(...));
```

## 34.3 Immutable config snapshot

```java
volatile Config current;
```

## 34.4 Confined mutable builder

```java
var builder = new ArrayList<Row>();
// local only
return List.copyOf(builder);
```

## 34.5 Actor-owned mutable state

Single-thread executor owns map.

## 34.6 Concurrent map with immutable values

```java
ConcurrentHashMap<Key, ImmutableValue>
```

## 34.7 Main rule

```text
Prefer mutable builders locally, immutable values globally.
```

---

# 35. Common Bugs

## 35.1 Final field with mutable collection

```java
private final List<Item> items;
```

without copy.

## 35.2 Returning mutable internal collection

```java
return items;
```

## 35.3 Unmodifiable view over mutable backing list

Caller cannot mutate view, but owner mutation leaks.

## 35.4 Capturing mutable request object in async task

Task sees changed/invalid state.

## 35.5 Sharing ORM entity across thread

Transaction/context bugs.

## 35.6 Mutating object after queue handoff

Consumer sees race.

## 35.7 Publishing object before constructor completes

`this` escape.

## 35.8 Assuming record means deep immutable

Mutable components remain mutable.

## 35.9 Mutating value inside `AtomicReference`

Reference atomic, internals unsafe.

## 35.10 Mixing confinement and sharing accidentally

Local object passed to callback/thread.

---

# 36. Mini Case Study: Shared Mutable Config

## 36.1 Broken

```java
final class ConfigRegistry {
    private final Map<String, String> config = new HashMap<>();

    void reload(Map<String, String> next) {
        config.clear();
        config.putAll(next);
    }

    String get(String key) {
        return config.get(key);
    }
}
```

Problems:

- `HashMap` not thread-safe;
- partial reload visible;
- no happens-before;
- readers can observe inconsistent state.

## 36.2 Better

```java
record Config(Map<String, String> values, long version) {
    Config {
        values = Map.copyOf(values);
    }
}

final class ConfigRegistry {
    private volatile Config current;

    ConfigRegistry(Config initial) {
        this.current = initial;
    }

    Config current() {
        return current;
    }

    void reload(Config next) {
        current = next;
    }
}
```

## 36.3 Lesson

```text
Read-mostly shared config should be immutable snapshot + safe publication.
```

---

# 37. Mini Case Study: Request Object Captured by Async Task

## 37.1 Broken

```java
void handle(HttpServletRequest request) {
    executor.submit(() -> {
        audit(request.getHeader("User-Agent"));
    });
}
```

Problems:

- request object may be recycled/invalid;
- not thread-safe;
- task outlives request;
- context unclear.

## 37.2 Better

```java
record AuditCommand(
    String userAgent,
    String requestId,
    Instant receivedAt
) {}

void handle(HttpServletRequest request) {
    AuditCommand command = new AuditCommand(
        request.getHeader("User-Agent"),
        requestId(),
        Instant.now()
    );

    executor.submit(() -> audit(command));
}
```

## 37.3 Lesson

```text
Async tasks should receive immutable snapshots, not live request objects.
```

---

# 38. Mini Case Study: Mutable List in Record

## 38.1 Broken

```java
record Report(List<Row> rows) {}
```

Caller:

```java
List<Row> rows = new ArrayList<>();
Report report = new Report(rows);

rows.clear(); // report changed
```

## 38.2 Fix

```java
record Report(List<Row> rows) {
    Report {
        rows = List.copyOf(rows);
    }
}
```

If `Row` is mutable, also make/copy Row immutable.

## 38.3 Lesson

```text
Records are not deeply immutable unless their components are immutable or copied.
```

---

# 39. Best Practices

## 39.1 Prefer immutable shared objects

Especially across async boundaries.

## 39.2 Use final fields

For object construction safety.

## 39.3 Avoid `this` escape

No registering/submitting/starting in constructor.

## 39.4 Defensively copy mutable inputs

Use `List.copyOf`, `Map.copyOf`, `Set.copyOf`.

## 39.5 Do not expose mutable internals

Return immutable copy/view backed by immutable state.

## 39.6 Prefer snapshots for read-mostly state

Atomic/volatile reference swap.

## 39.7 Confine mutable builders

Build locally, publish immutable result.

## 39.8 Pass commands/IDs across thread boundaries

Not live entities/request objects.

## 39.9 Use concurrent collections intentionally

Know whether values are immutable or mutable.

## 39.10 Document ownership

Who may mutate? Who may read? When transferred?

---

# 40. Decision Matrix

| Situation | Recommended Strategy |
|---|---|
| Data passed to async task | immutable command/snapshot |
| Read-mostly config | immutable snapshot + volatile/AtomicReference |
| Mutable local accumulation | stack confinement, then immutable result |
| Shared mutable map with ongoing updates | ConcurrentHashMap or lock |
| Map values are complex | immutable values preferred |
| Multiple fields invariant | immutable aggregate snapshot or lock |
| ORM entity async processing | pass ID/command; reload in transaction |
| Request context async | immutable request snapshot |
| Event payload | immutable event record |
| Frequent reads, rare writes list | CopyOnWriteArrayList or snapshot |
| Huge frequent mutation | confinement/lock/concurrent structure |
| Actor-like component | single owner thread + message passing |
| Need safe one-time global init | static final holder |
| Need cross-thread handoff | queue immutable message or ownership transfer |

---

# 41. Latihan

## Latihan 1 — Deep Immutable Record

Buat record `UserRoles(String userId, List<String> roles)` yang aman dari mutasi external.

## Latihan 2 — Config Snapshot

Implementasikan `ConfigRegistry` dengan `AtomicReference<Config>`.

## Latihan 3 — Defensive Copy Bug

Tunjukkan bug saat constructor menyimpan `ArrayList` langsung tanpa copy.

## Latihan 4 — Request Snapshot

Refactor async audit yang menangkap request object menjadi immutable command.

## Latihan 5 — Entity Boundary

Jelaskan kenapa JPA entity tidak ideal dikirim ke async task.

## Latihan 6 — Ownership Transfer

Buat contoh producer-consumer yang salah karena producer mutate object setelah `put`, lalu perbaiki dengan immutable copy.

## Latihan 7 — Thread Confinement

Identifikasi object mana yang thread-confined dalam batch worker.

## Latihan 8 — Actor Ownership

Desain simple actor dengan single-thread executor yang memiliki mutable map.

## Latihan 9 — Immutable vs Concurrent Collection

Kapan memilih `ConcurrentHashMap` dan kapan memilih `Map.copyOf` snapshot?

## Latihan 10 — This Escape

Buat contoh `this` escape via listener registration dan refactor dengan factory.

---

# 42. Ringkasan

Bagian ini membahas concurrency safety by design melalui immutability, confinement, dan safe sharing.

Core lessons:

- Shared mutable state adalah sumber utama bug concurrency.
- Tiga strategi besar: immutable shared, mutable confined, mutable synchronized.
- Immutable object aman dibagikan jika dibangun dan dipublish dengan benar.
- `final` fields membantu initialization safety, tetapi bukan deep immutability.
- Jangan biarkan `this` escape dari constructor.
- Defensive copying penting untuk mutable inputs/outputs.
- Unmodifiable view berbeda dari immutable copy.
- Record tidak otomatis deep immutable.
- Immutable snapshot + volatile/AtomicReference sangat cocok untuk read-mostly state.
- Copy-on-write cocok untuk frequent reads dan rare writes.
- Thread confinement membuat mutable state aman tanpa lock selama tidak escape.
- Request/transaction confinement rusak jika object dikirim ke async task sembarangan.
- Ownership transfer harus eksplisit; immutable message lebih aman.
- Safe publication wajib untuk object cross-thread.
- Publishing mutable object safely tidak membuat future mutation otomatis aman.
- Thread-safe collection dan immutable collection menyelesaikan masalah berbeda.
- Hindari membagikan live ORM entities/request objects; gunakan IDs/commands/snapshots.
- Virtual threads meningkatkan jumlah concurrency, sehingga shared mutable state bugs makin mudah muncul.

Main rule:

```text
Before adding synchronization, ask:
Can this data be immutable?
Can this mutation be confined?
Can this handoff be a snapshot?
Only share mutable state when ownership and synchronization are explicit.
```

---

# 43. Referensi

1. Java Language Specification — Chapter 17: Threads and Locks  
   https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html

2. Java SE 25 — `java.util.concurrent` Package Summary, Memory Consistency Properties  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

3. Java SE 25 — `ThreadLocal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html

4. Java SE 25 — `AtomicReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html

5. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

6. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

7. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

8. Java SE 25 — `Future`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html

9. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

10. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

11. OpenJDK JEP 506 — Scoped Values  
    https://openjdk.org/jeps/506

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-concurrency-and-reactive-part-010.md">⬅️ Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 010</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-concurrency-and-reactive-part-012.md">Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 012 ➡️</a>
</div>
