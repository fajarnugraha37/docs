# Learn Java Part 007 — Collections, Data Structures, dan Performance Semantics

> Target: Java hingga versi 25  
> Audience: Software engineer yang ingin memahami Java Collections bukan sebagai daftar class, tetapi sebagai **model desain data + cost model + correctness model + production failure model**.

---

## 0. Posisi Bagian Ini dalam Kurikulum

Pada bagian sebelumnya kita sudah membangun fondasi:

- syntax dan semantics Java;
- object model;
- type system dan generics;
- modern Java language features;
- functional programming dan Stream API.

Sekarang kita masuk ke salah satu area paling sering dipakai dalam semua aplikasi Java: **Collections Framework**.

Kesalahan umum engineer adalah menganggap collection hanya sebagai “container data”. Dalam sistem production, collection adalah keputusan arsitektural kecil yang berdampak ke:

- correctness;
- memory usage;
- latency;
- throughput;
- concurrency safety;
- determinisme ordering;
- observability;
- API stability;
- domain invariant.

Contoh sederhana:

```java
List<Approval> approvals;
Set<Approval> approvals;
Map<ApprovalStage, Approval> approvalsByStage;
Deque<ApprovalTask> pendingApprovals;
PriorityQueue<ApprovalTask> escalations;
ConcurrentHashMap<CaseId, CaseSnapshot> cache;
```

Masing-masing bukan hanya “tipe data”. Masing-masing mengandung klaim desain:

- `List` berarti posisi/urutan penting dan duplikasi mungkin valid.
- `Set` berarti uniqueness penting.
- `Map` berarti lookup berdasarkan key adalah operasi dominan.
- `Deque` berarti operasi di ujung depan/belakang penting.
- `PriorityQueue` berarti urutan proses ditentukan prioritas, bukan insertion order.
- `ConcurrentHashMap` berarti shared mutable access lintas thread perlu dikontrol di level struktur data.

Top-tier Java engineer tidak hanya bertanya:

> “Collection apa yang bisa menyimpan data ini?”

Tetapi bertanya:

> “Invariant apa yang harus dijaga, operasi apa yang paling sering, ordering apa yang dijanjikan, mutation pattern seperti apa, dan failure mode apa yang mungkin muncul?”

---

## 1. Learning Objectives

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan hierarchy Java Collections Framework.
2. Membedakan contract interface dan behavior implementation.
3. Memilih `List`, `Set`, `Map`, `Queue`, `Deque`, `Sorted*`, `Navigable*`, dan `Concurrent*` secara sadar.
4. Memahami cost model `ArrayList`, `LinkedList`, `HashSet`, `TreeSet`, `HashMap`, `LinkedHashMap`, `TreeMap`, `ConcurrentHashMap`, `EnumMap`, `WeakHashMap`, `IdentityHashMap`, dan `ArrayDeque`.
5. Memahami equality dan hash semantics pada collection.
6. Mengetahui failure mode mutable key, bad comparator, duplicate key, fail-fast iterator, shallow immutability, accidental aliasing, dan unsafe publication.
7. Memahami Java 21+ **Sequenced Collections** yang tersedia di Java 25.
8. Membedakan unmodifiable view, immutable snapshot, defensive copy, dan persistent collection.
9. Menghubungkan pilihan data structure dengan performance: Big-O, constant factor, cache locality, allocation, boxing, resizing, comparator cost, locking cost.
10. Mendesain API Java yang aman menggunakan collection.

---

## 2. Sumber Resmi yang Digunakan

Materi ini disusun mengacu ke sumber resmi berikut:

- Java SE 25 API — Java Collections Framework  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-index.html
- Java SE 25 API — Collections Framework Outline  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-reference.html
- Java SE 25 API — `Collection`, `List`, `Set`, `Queue`, `Deque`, `Map`, `SequencedCollection`, `SequencedSet`, `SequencedMap`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/package-summary.html
- Java SE 25 API — `Collections`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html
- Java SE 25 API — `HashMap`, `ArrayList`, `ConcurrentHashMap`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html
- JEP 431 — Sequenced Collections  
  https://openjdk.org/jeps/431

Catatan: Java 25 tidak “mengganti” Collections Framework secara radikal. Banyak konsep utama sudah stabil lama. Yang penting untuk Java modern adalah memahami **Sequenced Collections** yang diperkenalkan di Java 21 dan tetap menjadi bagian platform Java 25.

---

# Bab 1 — Mental Model Utama Java Collections

## 1.1 Collection adalah contract, bukan implementation

Kesalahan pertama adalah berpikir seperti ini:

```java
ArrayList<String> names = new ArrayList<>();
```

Kode ini sering valid, tetapi secara desain lebih baik bertanya:

> “Yang dibutuhkan consumer adalah operasi apa?”

Mungkin consumer hanya perlu membaca sequence:

```java
List<String> names = new ArrayList<>();
```

Mungkin consumer hanya perlu iterasi:

```java
Iterable<String> names = new ArrayList<>();
```

Mungkin consumer tidak boleh memodifikasi:

```java
List<String> names = List.copyOf(inputNames);
```

Mungkin uniqueness adalah invariant:

```java
Set<String> uniqueNames = new HashSet<>();
```

Mungkin lookup berdasarkan ID adalah operasi dominan:

```java
Map<UserId, User> usersById = new HashMap<>();
```

Interface menyatakan **apa yang dijanjikan**. Implementation menentukan **bagaimana biaya dan behavior-nya**.

### Mental model

```text
Collection decision = contract + invariant + operation pattern + cost model + mutation model
```

Bukan:

```text
Collection decision = class yang paling familiar
```

---

## 1.2 Empat pertanyaan sebelum memilih collection

Sebelum memilih collection, jawab empat pertanyaan ini.

### Pertanyaan 1 — Apakah elemen boleh duplikat?

Jika boleh:

```java
List<CaseEvent> events;
```

Jika tidak boleh:

```java
Set<Permission> permissions;
```

Jika unik berdasarkan key tertentu:

```java
Map<PermissionCode, Permission> permissionsByCode;
```

### Pertanyaan 2 — Apakah urutan penting?

Ada beberapa jenis urutan:

| Jenis Urutan | Makna | Contoh |
|---|---|---|
| insertion order | urutan masuk | audit event |
| encounter order | urutan observasi saat iterasi | stream/list/linked set |
| sorted order | urutan berdasarkan comparator/natural order | ranking, schedule |
| access order | urutan berdasarkan akses terakhir | LRU cache |
| priority order | urutan berdasarkan prioritas | escalation queue |
| no specified order | tidak dijanjikan | plain hash set/map |

### Pertanyaan 3 — Operasi dominan apa?

| Operasi dominan | Biasanya cocok |
|---|---|
| append dan indexed read | `ArrayList` |
| uniqueness check | `HashSet` |
| lookup by key | `HashMap` |
| sorted traversal | `TreeSet` / `TreeMap` |
| FIFO processing | `Queue` / `ArrayDeque` / `BlockingQueue` |
| LIFO stack | `Deque` / `ArrayDeque` |
| priority processing | `PriorityQueue` |
| concurrent lookup/update | `ConcurrentHashMap` |
| enum-keyed mapping | `EnumMap` |

### Pertanyaan 4 — Siapa yang boleh mutate?

Ada beberapa model:

1. Internal mutable, external immutable.
2. Fully mutable, owner jelas.
3. Shared mutable dengan lock/concurrent collection.
4. Snapshot immutable.
5. Persistent immutable collection dari library eksternal.

Contoh API aman:

```java
public final class CaseRecord {
    private final List<CaseEvent> events;

    public CaseRecord(List<CaseEvent> events) {
        this.events = List.copyOf(events);
    }

    public List<CaseEvent> events() {
        return events;
    }
}
```

Ini bukan sekadar “rapi”. Ini mencegah caller mengubah internal state setelah object dibuat.

---

# Bab 2 — Hierarchy Java Collections Framework

## 2.1 Dua keluarga besar: `Collection` dan `Map`

Di Java, `Map` **bukan subtype** dari `Collection`.

```text
Iterable
  └── Collection
        ├── List
        ├── Set
        │     ├── SortedSet
        │     │     └── NavigableSet
        ├── Queue
        │     └── Deque
        └── SequencedCollection

Map
  ├── SortedMap
  │     └── NavigableMap
  └── SequencedMap
```

Kenapa `Map` bukan `Collection`?

Karena `Map` bukan kumpulan elemen tunggal. `Map` adalah kumpulan mapping key-value dengan invariant:

```text
one key maps to at most one value
```

Namun `Map` menyediakan collection view:

```java
Set<K> keySet();
Collection<V> values();
Set<Map.Entry<K, V>> entrySet();
```

View ini penting karena **backed by map**. Artinya perubahan pada view bisa tercermin pada map, dan perubahan pada map bisa terlihat pada view.

---

## 2.2 `Iterable`

`Iterable<T>` adalah contract paling minimal untuk object yang bisa di-loop:

```java
for (CaseEvent event : events) {
    process(event);
}
```

Method utamanya:

```java
Iterator<T> iterator();
```

Gunakan `Iterable<T>` sebagai parameter jika consumer hanya butuh iterasi satu arah.

```java
void publishAll(Iterable<DomainEvent> events) {
    for (DomainEvent event : events) {
        publisher.publish(event);
    }
}
```

Keuntungan:

- API lebih fleksibel;
- caller bisa memberi `List`, `Set`, generator, atau custom lazy collection;
- tidak mengikat consumer pada operasi yang tidak dibutuhkan.

Kelemahan:

- tidak punya `size()`;
- tidak menjamin repeatable iteration;
- tidak menjamin order;
- tidak menjamin mutability/immutability.

---

## 2.3 `Collection`

`Collection<E>` adalah root interface untuk kumpulan elemen.

Pertanyaan yang dijawab oleh `Collection`:

- berapa jumlah elemen? `size()`
- kosong atau tidak? `isEmpty()`
- mengandung elemen? `contains()`
- bisa ditambah? `add()`
- bisa dihapus? `remove()`
- bisa diiterasi? `iterator()`

Namun `Collection` tidak menjanjikan:

- urutan;
- uniqueness;
- positional access;
- thread safety;
- mutability penuh;
- null policy universal.

Contoh parameter yang cukup general:

```java
void validatePermissions(Collection<Permission> permissions) {
    if (permissions.isEmpty()) {
        throw new IllegalArgumentException("At least one permission is required");
    }
}
```

Jangan pakai `Collection` jika API kamu butuh ordering, indexed access, uniqueness, atau map lookup.

---

## 2.4 `List`

`List<E>` adalah ordered collection atau sequence. Biasanya duplicate diperbolehkan.

Contract penting:

- positional access: `get(index)`;
- insertion at index;
- order visible;
- duplicate allowed;
- equality berdasarkan urutan dan elemen.

```java
List<String> a = List.of("A", "B");
List<String> b = List.of("B", "A");

System.out.println(a.equals(b)); // false
```

Gunakan `List` jika:

- urutan adalah bagian dari makna;
- elemen boleh muncul lebih dari sekali;
- kamu perlu akses index;
- kamu perlu sequence hasil query;
- kamu memodelkan audit trail, timeline, ordered steps, ordered rules.

Jangan pakai `List` jika uniqueness adalah invariant utama.

Buruk:

```java
List<String> permissionCodes = new ArrayList<>();

if (!permissionCodes.contains(code)) {
    permissionCodes.add(code);
}
```

Lebih tepat:

```java
Set<String> permissionCodes = new HashSet<>();
permissionCodes.add(code);
```

---

## 2.5 `Set`

`Set<E>` adalah collection tanpa duplicate element.

Contract penting:

- tidak ada duplicate menurut `equals`;
- equality set tidak bergantung pada urutan;
- `contains` biasanya menjadi operasi utama.

```java
Set<String> a = Set.of("A", "B");
Set<String> b = Set.of("B", "A");

System.out.println(a.equals(b)); // true
```

Gunakan `Set` jika:

- uniqueness adalah invariant;
- membership check penting;
- order tidak penting atau order jenis tertentu dipilih via implementation.

Contoh domain:

```java
record Role(String code) {}

final class UserAccess {
    private final Set<Role> roles;

    UserAccess(Set<Role> roles) {
        this.roles = Set.copyOf(roles);
    }

    boolean hasRole(Role role) {
        return roles.contains(role);
    }
}
```

---

## 2.6 `Queue`

`Queue<E>` adalah collection untuk menampung elemen sebelum diproses.

Ada tiga jenis operasi queue:

| Operasi | Throw exception jika gagal | Return special value jika gagal |
|---|---|---|
| insert | `add(e)` | `offer(e)` |
| remove head | `remove()` | `poll()` |
| inspect head | `element()` | `peek()` |

Di production, biasanya lebih aman memakai `offer`, `poll`, `peek` karena failure bisa diperlakukan eksplisit tanpa exception control flow.

```java
Queue<Task> queue = new ArrayDeque<>();

queue.offer(task);
Task next = queue.poll();
if (next != null) {
    process(next);
}
```

Gunakan `Queue` untuk:

- work queue;
- breadth-first traversal;
- producer-consumer model;
- staged processing;
- buffering.

---

## 2.7 `Deque`

`Deque<E>` adalah double-ended queue. Elemen bisa ditambah/dihapus dari depan maupun belakang.

Operasi penting:

```java
addFirst(e)
addLast(e)
offerFirst(e)
offerLast(e)
removeFirst()
removeLast()
pollFirst()
pollLast()
peekFirst()
peekLast()
```

`Deque` bisa dipakai sebagai:

- queue FIFO;
- stack LIFO;
- sliding window;
- task scheduling sederhana;
- undo/redo stack.

Gunakan `ArrayDeque` sebagai default `Deque` non-concurrent.

```java
Deque<String> stack = new ArrayDeque<>();
stack.push("A");
stack.push("B");
System.out.println(stack.pop()); // B
```

Jangan memakai `Stack` legacy untuk code baru. `Stack` mewarisi `Vector`, membawa synchronized legacy behavior, dan API-nya kurang sesuai Java modern.

---

## 2.8 `Map`

`Map<K,V>` menyimpan mapping dari key ke value.

Contract penting:

```text
A map cannot contain duplicate keys.
Each key can map to at most one value.
```

Contoh:

```java
Map<CaseId, CaseRecord> casesById = new HashMap<>();
```

Gunakan `Map` jika:

- lookup by key adalah operasi utama;
- kamu perlu index in-memory;
- kamu ingin deduplicate berdasarkan key;
- kamu ingin aggregate/grouping;
- kamu ingin memoization/cache.

Jangan memakai `Map` jika key tidak punya equality semantics yang stabil.

Buruk:

```java
record MutableKey(List<String> parts) {}

Map<MutableKey, String> map = new HashMap<>();
List<String> parts = new ArrayList<>(List.of("A"));
MutableKey key = new MutableKey(parts);

map.put(key, "value");
parts.add("B");

System.out.println(map.get(key)); // bisa null / behavior tidak sesuai ekspektasi
```

Kenapa? Karena `hashCode` key berubah setelah masuk ke `HashMap`.

---

# Bab 3 — Sequenced Collections di Java Modern

## 3.1 Masalah sebelum Sequenced Collections

Sebelum Java 21, banyak collection punya encounter order, tetapi tidak ada interface umum yang merepresentasikan operasi “first/last/reversed”.

Contoh:

- `List` punya urutan;
- `LinkedHashSet` punya insertion order;
- `SortedSet` punya sorted order;
- `LinkedHashMap` punya insertion/access order;
- `TreeMap` punya sorted key order.

Namun API umumnya terfragmentasi.

Misalnya untuk ambil first:

```java
list.get(0);
set.iterator().next();
treeSet.first();
linkedHashMap.entrySet().iterator().next();
```

Ini tidak uniform.

---

## 3.2 `SequencedCollection`

Java 21 memperkenalkan `SequencedCollection`, dan ini tersedia di Java 25.

Konsepnya:

> Collection yang memiliki encounter order terdefinisi dari first sampai last.

Operasi penting:

```java
E getFirst();
E getLast();
E removeFirst();
E removeLast();
void addFirst(E e);
void addLast(E e);
SequencedCollection<E> reversed();
```

Contoh:

```java
SequencedCollection<String> names = new ArrayList<>(List.of("A", "B", "C"));

System.out.println(names.getFirst()); // A
System.out.println(names.getLast());  // C

SequencedCollection<String> reversed = names.reversed();
System.out.println(reversed); // view reversed
```

Poin penting: `reversed()` mengembalikan reversed view, bukan selalu copy baru.

Artinya mutation bisa saling terlihat tergantung implementation.

---

## 3.3 `SequencedSet`

`SequencedSet<E>` adalah set yang punya encounter order.

Contoh implementation:

```java
SequencedSet<String> ordered = new LinkedHashSet<>();
ordered.add("A");
ordered.add("B");
ordered.add("C");

System.out.println(ordered.getFirst()); // A
System.out.println(ordered.getLast());  // C
```

Gunakan untuk domain seperti:

- unique rules dengan urutan evaluasi;
- unique approvers dengan order assignment;
- unique tags dengan display order;
- unique escalation recipients dengan insertion order.

---

## 3.4 `SequencedMap`

`SequencedMap<K,V>` adalah map dengan encounter order untuk entries.

Operasi penting:

```java
Map.Entry<K,V> firstEntry();
Map.Entry<K,V> lastEntry();
Map.Entry<K,V> pollFirstEntry();
Map.Entry<K,V> pollLastEntry();
V putFirst(K k, V v);
V putLast(K k, V v);
SequencedMap<K,V> reversed();
SequencedSet<K> sequencedKeySet();
SequencedCollection<V> sequencedValues();
SequencedSet<Map.Entry<K,V>> sequencedEntrySet();
```

Contoh:

```java
SequencedMap<String, Integer> ranking = new LinkedHashMap<>();
ranking.put("gold", 1);
ranking.put("silver", 2);
ranking.put("bronze", 3);

System.out.println(ranking.firstEntry());
System.out.println(ranking.lastEntry());
```

Gunakan ketika:

- map adalah index sekaligus ordered list;
- kamu perlu “first inserted” atau “last inserted”;
- kamu butuh LRU-style structure;
- kamu butuh deterministic API response order.

---

## 3.5 Design impact Sequenced Collections

Sebelum Java modern:

```java
void process(List<Event> events) {
    Event first = events.get(0);
    Event last = events.get(events.size() - 1);
}
```

Masalah:

- terlalu spesifik ke `List`;
- padahal yang dibutuhkan hanya ordered first/last;
- tidak butuh indexed access.

Dengan `SequencedCollection`:

```java
void process(SequencedCollection<Event> events) {
    Event first = events.getFirst();
    Event last = events.getLast();
}
```

API menjadi lebih presisi.

Namun jangan overuse. Jika consumer umum hanya butuh iteration, tetap gunakan `Iterable` atau `Collection`. Gunakan `SequencedCollection` saat first/last/reversed order memang bagian dari contract.

---

# Bab 4 — List Deep Dive

## 4.1 `ArrayList`

`ArrayList` adalah resizable array implementation dari `List`.

Mental model:

```text
ArrayList = object wrapper + Object[] backing array + size
```

Saat kamu menulis:

```java
List<String> list = new ArrayList<>();
list.add("A");
list.add("B");
```

Secara konseptual:

```text
backing array: ["A", "B", null, null, ...]
size: 2
```

### Cost model umum

| Operasi | Biaya umum |
|---|---:|
| `get(i)` | O(1) |
| `set(i, e)` | O(1) |
| `add(e)` di akhir | amortized O(1) |
| `add(i, e)` di tengah | O(n) |
| `remove(i)` di tengah | O(n) |
| `contains(e)` | O(n) |
| iteration | O(n), cache-friendly |

Kenapa `add(e)` di akhir amortized O(1)?

Karena tidak setiap `add` menyebabkan resize. Ketika capacity penuh, backing array baru dibuat dan elemen lama disalin. Biaya resize mahal, tetapi tersebar ke banyak operasi add.

### Kapan `ArrayList` cocok?

Gunakan sebagai default `List` jika:

- append dominan;
- indexed read diperlukan;
- iteration sering;
- mutation di tengah jarang;
- data tidak terlalu sering remove dari awal/tengah;
- single-thread ownership jelas.

Contoh:

```java
List<CaseEvent> events = new ArrayList<>();
events.add(new CaseCreated(...));
events.add(new CaseAssigned(...));
events.add(new CaseClosed(...));
```

### Pre-sizing

Jika kamu tahu kira-kira jumlah elemen:

```java
List<CaseEvent> events = new ArrayList<>(expectedSize);
```

Ini mengurangi reallocation.

Buruk untuk batch besar:

```java
List<Row> rows = new ArrayList<>();
for (Row row : input) {
    rows.add(row);
}
```

Lebih baik:

```java
List<Row> rows = new ArrayList<>(estimatedRows);
for (Row row : input) {
    rows.add(row);
}
```

Namun jangan over-optimize untuk list kecil.

### `ensureCapacity`

Untuk list yang sudah dibuat:

```java
ArrayList<Row> rows = new ArrayList<>();
rows.ensureCapacity(100_000);
```

Gunakan saat kamu benar-benar tahu volume besar akan masuk.

### Fail-fast iterator

`ArrayList` iterator fail-fast: jika list dimodifikasi secara struktural setelah iterator dibuat selain lewat iterator itu sendiri, iterator dapat melempar `ConcurrentModificationException`.

```java
List<String> names = new ArrayList<>(List.of("A", "B", "C"));

for (String name : names) {
    if (name.equals("B")) {
        names.remove(name); // problem
    }
}
```

Lebih benar:

```java
Iterator<String> it = names.iterator();
while (it.hasNext()) {
    if (it.next().equals("B")) {
        it.remove();
    }
}
```

Atau:

```java
names.removeIf(name -> name.equals("B"));
```

Catatan penting: fail-fast bukan mekanisme thread safety. Ini best-effort bug detection.

---

## 4.2 `LinkedList`

`LinkedList` adalah doubly-linked list implementation dari `List` dan `Deque`.

Mental model:

```text
LinkedList = chain of Node(prev, item, next)
```

Setiap elemen adalah node object terpisah.

### Cost model umum

| Operasi | Biaya umum |
|---|---:|
| add/remove di head/tail jika node diketahui | O(1) |
| `get(i)` | O(n) |
| iteration | O(n), cache-unfriendly |
| add/remove via iterator | O(1) setelah posisi ditemukan |
| contains | O(n) |

### Mitos umum: LinkedList lebih cepat untuk insert/delete

Pernyataan ini setengah benar dan sering menyesatkan.

`LinkedList` cepat untuk insert/delete **jika posisi node sudah diketahui**. Tetapi jika kamu harus mencari posisi via index atau value, pencarian tetap O(n), dan overhead node allocation serta poor cache locality sering membuatnya lebih lambat daripada `ArrayList`.

Buruk:

```java
List<String> list = new LinkedList<>();
for (int i = 0; i < list.size(); i++) {
    process(list.get(i)); // O(n^2)
}
```

Jika pakai `LinkedList`, iterasi dengan iterator/enhanced for:

```java
for (String value : list) {
    process(value);
}
```

### Kapan `LinkedList` masuk akal?

Jarang sebagai `List`. Lebih masuk akal sebagai `Deque`, tetapi untuk `Deque` default modern biasanya `ArrayDeque` lebih baik.

Gunakan `LinkedList` hanya jika:

- kamu butuh frequent insertion/removal di tengah dengan iterator yang sudah berada di posisi;
- node-based semantics benar-benar diperlukan;
- profiling membuktikan lebih baik.

Dalam banyak aplikasi backend, `LinkedList` hampir tidak pernah menjadi pilihan pertama.

---

## 4.3 `CopyOnWriteArrayList`

`CopyOnWriteArrayList` berada di `java.util.concurrent`.

Mental model:

```text
read: lock-free snapshot array read
write: copy entire array, mutate copy, publish new array
```

Cocok untuk:

- read sangat sering;
- write sangat jarang;
- listener list;
- configuration snapshot;
- subscriber registry kecil.

Contoh:

```java
class EventBus {
    private final CopyOnWriteArrayList<EventListener> listeners = new CopyOnWriteArrayList<>();

    void register(EventListener listener) {
        listeners.add(listener);
    }

    void publish(Event event) {
        for (EventListener listener : listeners) {
            listener.onEvent(event);
        }
    }
}
```

Jangan gunakan untuk high-write workload.

Buruk:

```java
CopyOnWriteArrayList<Order> orders = new CopyOnWriteArrayList<>();
for (Order order : highVolumeOrders) {
    orders.add(order); // copy array setiap add
}
```

---

## 4.4 `Vector` dan `Stack`

`Vector` dan `Stack` adalah legacy synchronized classes.

Jangan gunakan untuk code baru kecuali integrasi dengan API lama.

Alternatif:

- `ArrayList` untuk list non-concurrent;
- `Collections.synchronizedList(...)` jika benar-benar perlu wrapper sederhana;
- `CopyOnWriteArrayList` untuk read-mostly;
- `Deque`/`ArrayDeque` untuk stack;
- `ConcurrentLinkedDeque` atau blocking queue untuk concurrent producer-consumer.

---

# Bab 5 — Set Deep Dive

## 5.1 `HashSet`

`HashSet` adalah general-purpose set berbasis hash table. Secara konseptual, `HashSet` menggunakan `HashMap` di belakang layar, di mana elemen set menjadi key.

Mental model:

```text
HashSet<E> ≈ HashMap<E, PRESENT>
```

Cost model umum:

| Operasi | Biaya expected |
|---|---:|
| `add(e)` | O(1) expected |
| `contains(e)` | O(1) expected |
| `remove(e)` | O(1) expected |
| iteration | O(n + capacity-related cost) |

Gunakan `HashSet` jika:

- uniqueness penting;
- order tidak penting;
- membership check sering;
- equality/hashCode elemen stabil.

Contoh:

```java
Set<String> seenCaseNumbers = new HashSet<>();

for (CaseRecord record : records) {
    if (!seenCaseNumbers.add(record.caseNumber())) {
        throw new DuplicateCaseNumberException(record.caseNumber());
    }
}
```

`Set.add` mengembalikan `false` jika elemen sudah ada. Ini idiom yang bagus untuk deduplication.

---

## 5.2 `LinkedHashSet`

`LinkedHashSet` menjaga insertion order.

Gunakan jika:

- uniqueness penting;
- iteration order harus deterministic;
- ingin order mengikuti input;
- output API/test snapshot perlu stabil.

Contoh:

```java
Set<String> tags = new LinkedHashSet<>();
tags.add("urgent");
tags.add("regulatory");
tags.add("urgent");

System.out.println(tags); // [urgent, regulatory]
```

Ini sering lebih baik daripada `HashSet` untuk API response yang perlu deterministic ordering.

Trade-off:

- memory lebih besar karena maintain linked order;
- sedikit overhead update.

---

## 5.3 `TreeSet`

`TreeSet` adalah sorted set berbasis red-black tree.

Gunakan jika:

- elemen harus selalu sorted;
- kamu perlu range query;
- kamu perlu nearest lookup;
- kamu butuh `first`, `last`, `lower`, `floor`, `ceiling`, `higher`.

Contoh:

```java
NavigableSet<Integer> scores = new TreeSet<>();
scores.addAll(List.of(10, 30, 20));

System.out.println(scores.first());   // 10
System.out.println(scores.last());    // 30
System.out.println(scores.floor(25)); // 20
System.out.println(scores.ceiling(25)); // 30
```

Cost model umum:

| Operasi | Biaya |
|---|---:|
| add | O(log n) |
| contains | O(log n) |
| remove | O(log n) |
| iteration sorted | O(n) |

### Comparator consistency problem

`TreeSet` menentukan uniqueness berdasarkan comparator/natural ordering, bukan langsung `equals`.

Problem:

```java
record Person(String name, int age) {}

Set<Person> people = new TreeSet<>(Comparator.comparing(Person::name));
people.add(new Person("Ayu", 20));
people.add(new Person("Ayu", 30));

System.out.println(people.size()); // 1
```

Menurut comparator, dua orang dengan name sama dianggap “sama” untuk tujuan set.

Ini bisa benar jika invariant-nya uniqueness by name. Tapi bisa bug jika kamu mengira uniqueness berdasarkan semua field.

Rule:

> Comparator untuk `TreeSet` harus mencerminkan semantic uniqueness yang kamu inginkan.

---

## 5.4 `EnumSet`

`EnumSet` adalah high-performance set khusus untuk enum.

Mental model:

```text
EnumSet = bit vector over enum ordinal
```

Contoh:

```java
enum Permission {
    READ, WRITE, APPROVE, REJECT
}

EnumSet<Permission> permissions = EnumSet.of(Permission.READ, Permission.APPROVE);

if (permissions.contains(Permission.APPROVE)) {
    approve();
}
```

Gunakan `EnumSet` untuk set of enum. Hampir selalu lebih baik daripada `HashSet<Enum>`.

Cocok untuk:

- feature flags kecil;
- permissions;
- status flags;
- supported transitions;
- allowed actions.

Contoh domain state machine:

```java
enum CaseAction {
    ASSIGN, APPROVE, REJECT, CLOSE, ESCALATE
}

record StatePolicy(EnumSet<CaseAction> allowedActions) {
    boolean allows(CaseAction action) {
        return allowedActions.contains(action);
    }
}
```

---

# Bab 6 — Map Deep Dive

## 6.1 `HashMap`

`HashMap` adalah general-purpose hash table implementation dari `Map`.

Mental model:

```text
HashMap = array of buckets
bucket = zero or more entries
entry = key + value + hash + next/tree link
```

Operasi lookup:

```text
key.hashCode()
  -> spread/mix hash
  -> bucket index
  -> compare candidate key via equals
  -> return value
```

### Cost model umum

| Operasi | Expected cost |
|---|---:|
| `put(k, v)` | O(1) expected |
| `get(k)` | O(1) expected |
| `containsKey(k)` | O(1) expected |
| `remove(k)` | O(1) expected |
| iteration | O(size + capacity-related overhead) |

### Initial capacity dan load factor

`HashMap` punya dua parameter performance utama:

- capacity: jumlah bucket;
- load factor: seberapa penuh map sebelum resize.

Default load factor biasanya 0.75 sebagai trade-off antara space dan time.

Jika kamu tahu jumlah entry besar, pre-size map.

Buruk untuk 1 juta entry:

```java
Map<String, Row> rowsById = new HashMap<>();
for (Row row : rows) {
    rowsById.put(row.id(), row);
}
```

Lebih baik:

```java
int expectedSize = rows.size();
int capacity = (int) (expectedSize / 0.75f) + 1;
Map<String, Row> rowsById = new HashMap<>(capacity);

for (Row row : rows) {
    rowsById.put(row.id(), row);
}
```

Namun jangan obsess untuk map kecil.

### Duplicate key behavior

```java
Map<String, Integer> map = new HashMap<>();
map.put("A", 1);
map.put("A", 2);

System.out.println(map.get("A")); // 2
```

`put` mengganti value lama.

Jika duplicate adalah error, jangan diam-diam overwrite.

```java
Integer previous = map.put(key, value);
if (previous != null) {
    throw new DuplicateKeyException(key);
}
```

Tapi jika value boleh `null`, gunakan:

```java
if (map.containsKey(key)) {
    throw new DuplicateKeyException(key);
}
map.put(key, value);
```

Atau:

```java
V previous = map.putIfAbsent(key, value);
if (previous != null) {
    throw new DuplicateKeyException(key);
}
```

### `computeIfAbsent`

Sangat berguna untuk grouping/indexing:

```java
Map<CaseStatus, List<CaseRecord>> byStatus = new HashMap<>();

for (CaseRecord record : records) {
    byStatus.computeIfAbsent(record.status(), ignored -> new ArrayList<>())
            .add(record);
}
```

Hati-hati:

- mapping function sebaiknya tidak punya side effect kompleks;
- jangan melakukan recursive update ke map yang sama dengan cara yang membingungkan;
- pada `ConcurrentHashMap`, mapping function harus cepat dan aman.

### Mutable key failure

Ini salah satu bug paling mahal.

```java
final class CaseKey {
    private String tenant;
    private String caseNumber;

    // equals/hashCode pakai tenant dan caseNumber

    void changeCaseNumber(String caseNumber) {
        this.caseNumber = caseNumber;
    }
}
```

Jika object `CaseKey` dimasukkan ke `HashMap`, lalu field yang dipakai `hashCode` berubah, key bisa “hilang” di bucket salah.

Rule:

> Key untuk hash-based collection harus immutable atau setidaknya field yang dipakai `equals/hashCode` tidak boleh berubah selama key berada di collection.

### `HashMap` order

Jangan mengandalkan order `HashMap`.

Buruk:

```java
Map<String, String> response = new HashMap<>();
response.put("code", "OK");
response.put("message", "Success");
response.put("timestamp", "...");

// Jangan berasumsi JSON field order mengikuti insertion order.
```

Jika order penting:

```java
Map<String, String> response = new LinkedHashMap<>();
```

---

## 6.2 `LinkedHashMap`

`LinkedHashMap` adalah hash table + linked list untuk menjaga order.

Order mode:

1. insertion order;
2. access order.

Insertion order:

```java
Map<String, Integer> map = new LinkedHashMap<>();
map.put("A", 1);
map.put("B", 2);
map.put("C", 3);

System.out.println(map.keySet()); // [A, B, C]
```

Access order bisa dipakai untuk LRU-style cache:

```java
class LruCache<K, V> extends LinkedHashMap<K, V> {
    private final int maxEntries;

    LruCache(int maxEntries) {
        super(16, 0.75f, true); // accessOrder = true
        this.maxEntries = maxEntries;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > maxEntries;
    }
}
```

Catatan production:

- ini bukan concurrent cache;
- untuk production-grade cache biasanya gunakan Caffeine;
- tetapi memahami `LinkedHashMap` penting karena konsep LRU-nya sederhana.

---

## 6.3 `TreeMap`

`TreeMap` adalah sorted map berbasis red-black tree.

Gunakan jika:

- key harus sorted;
- range query penting;
- nearest key lookup penting;
- order by comparator harus selalu terjaga.

Contoh:

```java
NavigableMap<LocalDate, List<CaseRecord>> casesByDate = new TreeMap<>();

LocalDate today = LocalDate.now();
Map.Entry<LocalDate, List<CaseRecord>> beforeToday = casesByDate.floorEntry(today);
```

Cost model:

| Operasi | Biaya |
|---|---:|
| put | O(log n) |
| get | O(log n) |
| remove | O(log n) |
| first/last/floor/ceiling | O(log n) |
| sorted iteration | O(n) |

### Comparator vs equals

Sama seperti `TreeSet`, comparator menentukan identity key menurut tree.

Jika comparator tidak konsisten dengan equals, behavior bisa mengejutkan.

```java
Map<String, Integer> map = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
map.put("abc", 1);
map.put("ABC", 2);

System.out.println(map.size()); // 1
System.out.println(map.get("abc")); // 2
```

Ini bisa benar untuk case-insensitive lookup. Tapi harus disengaja.

---

## 6.4 `EnumMap`

`EnumMap` adalah map khusus enum key.

Mental model:

```text
EnumMap = array indexed by enum ordinal
```

Gunakan untuk:

- state transition table;
- permission matrix;
- status-to-handler mapping;
- enum-keyed configuration.

Contoh:

```java
enum CaseStatus {
    DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED
}

Map<CaseStatus, Set<CaseStatus>> transitions = new EnumMap<>(CaseStatus.class);
transitions.put(CaseStatus.DRAFT, EnumSet.of(CaseStatus.SUBMITTED));
transitions.put(CaseStatus.SUBMITTED, EnumSet.of(CaseStatus.UNDER_REVIEW));
transitions.put(CaseStatus.UNDER_REVIEW, EnumSet.of(CaseStatus.APPROVED, CaseStatus.REJECTED));
```

Ini lebih semantik dan lebih efisien daripada `HashMap<CaseStatus, ...>`.

---

## 6.5 `IdentityHashMap`

`IdentityHashMap` memakai reference identity (`==`) sebagai equality, bukan `equals`.

Contoh:

```java
String a = new String("x");
String b = new String("x");

Map<String, Integer> normal = new HashMap<>();
normal.put(a, 1);
normal.put(b, 2);
System.out.println(normal.size()); // 1

Map<String, Integer> identity = new IdentityHashMap<>();
identity.put(a, 1);
identity.put(b, 2);
System.out.println(identity.size()); // 2
```

Gunakan sangat jarang:

- object graph traversal;
- cycle detection berdasarkan identity;
- serialization internals;
- proxy/instrumentation internals.

Jangan gunakan untuk domain map biasa.

---

## 6.6 `WeakHashMap`

`WeakHashMap` menyimpan key menggunakan weak reference. Entry bisa hilang ketika key tidak lagi strongly reachable di tempat lain.

Gunakan untuk:

- metadata cache yang tidak boleh mencegah object di-GC;
- association eksternal ke object lifecycle;
- framework/internal cache tertentu.

Contoh konseptual:

```java
Map<Object, Metadata> metadataByObject = new WeakHashMap<>();
```

Hati-hati:

- entry bisa hilang “kapan saja” setelah GC;
- bukan cache umum yang predictable;
- value yang mereferensikan key secara strong bisa mencegah key collected;
- tidak thread-safe.

Untuk application cache biasa, gunakan library cache seperti Caffeine, bukan `WeakHashMap` mentah.

---

## 6.7 `ConcurrentHashMap`

`ConcurrentHashMap` adalah concurrent hash table.

Mental model:

```text
ConcurrentHashMap = thread-safe map for high concurrency retrievals and updates
```

Poin penting:

- retrieval seperti `get` umumnya tidak blocking;
- update bisa concurrent;
- tidak ada lock global untuk seluruh map seperti `Hashtable`;
- iterators bersifat weakly consistent, bukan fail-fast;
- tidak mengizinkan null key/value.

Kenapa null tidak diizinkan?

Karena di concurrent map, `get(key) == null` harus jelas berarti “tidak ada mapping”, bukan “ada mapping ke null”. Ini penting untuk atomic/concurrent semantics.

Contoh counter idiom:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();

void increment(String key) {
    counts.computeIfAbsent(key, ignored -> new LongAdder())
          .increment();
}
```

Ini lebih scalable untuk high contention counter daripada `AtomicLong` per key pada beberapa workload.

### Atomic operation penting

```java
putIfAbsent
computeIfAbsent
computeIfPresent
compute
merge
replace
remove(key, value)
```

Gunakan atomic operation, jangan split check-then-act.

Buruk:

```java
if (!map.containsKey(key)) {
    map.put(key, value); // race
}
```

Benar:

```java
map.putIfAbsent(key, value);
```

Atau:

```java
map.computeIfAbsent(key, this::loadValue);
```

### Hati-hati dengan mapping function

Buruk:

```java
map.computeIfAbsent(key, k -> {
    callRemoteService(); // lama, blocking, bisa memperparah contention
    return value;
});
```

Lebih baik desain ulang:

- load di luar bila perlu;
- gunakan cache library;
- gunakan `CompletableFuture` value dengan hati-hati;
- gunakan timeout dan cancellation.

---

# Bab 7 — Queue, Deque, dan Priority Structures

## 7.1 `ArrayDeque`

`ArrayDeque` adalah resizable-array implementation dari `Deque`.

Gunakan sebagai default untuk:

- stack non-concurrent;
- queue non-concurrent;
- BFS traversal;
- sliding window;
- local work buffer.

Contoh queue:

```java
Deque<Task> queue = new ArrayDeque<>();
queue.offerLast(task1);
queue.offerLast(task2);

Task next = queue.pollFirst();
```

Contoh stack:

```java
Deque<Node> stack = new ArrayDeque<>();
stack.push(root);

while (!stack.isEmpty()) {
    Node node = stack.pop();
    visit(node);
}
```

Jangan masukkan `null`. Banyak queue/deque API memakai `null` sebagai special return value dari `poll`/`peek`.

---

## 7.2 `PriorityQueue`

`PriorityQueue` adalah unbounded priority queue berbasis heap.

Mental model:

```text
head = smallest/highest-priority element according to natural order or comparator
```

Contoh:

```java
record EscalationTask(String caseId, int priority) {}

PriorityQueue<EscalationTask> queue = new PriorityQueue<>(
    Comparator.comparingInt(EscalationTask::priority)
);

queue.offer(new EscalationTask("C-1", 10));
queue.offer(new EscalationTask("C-2", 1));

System.out.println(queue.poll()); // C-2 priority 1
```

Poin penting:

- iteration order `PriorityQueue` bukan sorted order penuh;
- hanya `peek`/`poll` menjamin head berdasarkan priority;
- tidak thread-safe;
- comparator harus stabil selama elemen ada dalam queue.

Buruk:

```java
for (Task task : priorityQueue) {
    // Jangan anggap ini sorted order.
}
```

Jika perlu sorted snapshot:

```java
List<Task> sorted = new ArrayList<>(priorityQueue);
sorted.sort(comparator);
```

Atau poll satu per satu jika queue boleh dikosongkan.

---

## 7.3 Blocking queues

Blocking queues berada di `java.util.concurrent`.

Contoh:

- `ArrayBlockingQueue`
- `LinkedBlockingQueue`
- `PriorityBlockingQueue`
- `DelayQueue`
- `SynchronousQueue`
- `LinkedTransferQueue`

Gunakan untuk producer-consumer.

Contoh bounded queue:

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(1000);

// producer
queue.put(task); // blocks if full

// consumer
Task task = queue.take(); // blocks if empty
```

Production warning:

- bounded queue memberi backpressure;
- unbounded queue bisa menyebabkan memory growth;
- blocking operation harus punya shutdown/cancellation strategy;
- virtual threads membuat blocking lebih murah, tapi bukan berarti queue boleh unbounded.

---

# Bab 8 — Mutability, Immutability, dan Defensive Copy

## 8.1 Mutable collection

Mutable collection bisa berubah setelah dibuat.

```java
List<String> names = new ArrayList<>();
names.add("A");
```

Mutable collection aman jika ownership jelas.

Masalah muncul ketika mutable collection dibagikan lintas boundary.

Buruk:

```java
final class CaseRecord {
    private final List<CaseEvent> events;

    CaseRecord(List<CaseEvent> events) {
        this.events = events; // aliasing bug
    }

    List<CaseEvent> events() {
        return events; // internal state leak
    }
}
```

Caller bisa melakukan:

```java
List<CaseEvent> events = new ArrayList<>();
CaseRecord record = new CaseRecord(events);
events.clear(); // record ikut berubah
```

---

## 8.2 Unmodifiable view vs immutable snapshot

### Unmodifiable view

```java
List<String> mutable = new ArrayList<>(List.of("A", "B"));
List<String> view = Collections.unmodifiableList(mutable);

mutable.add("C");
System.out.println(view); // [A, B, C]
```

`view` tidak bisa dimodifikasi lewat view, tapi backing collection masih bisa berubah.

### Immutable snapshot / unmodifiable copy

```java
List<String> mutable = new ArrayList<>(List.of("A", "B"));
List<String> snapshot = List.copyOf(mutable);

mutable.add("C");
System.out.println(snapshot); // [A, B]
```

Untuk API boundary, biasanya lebih aman gunakan `copyOf`.

---

## 8.3 `List.of`, `Set.of`, `Map.of`

Factory methods ini membuat unmodifiable collections.

```java
List<String> names = List.of("A", "B");
Set<String> codes = Set.of("READ", "WRITE");
Map<String, Integer> scores = Map.of("A", 1, "B", 2);
```

Karakteristik penting:

- unmodifiable;
- tidak menerima null;
- `Set.of` tidak menerima duplicate;
- `Map.of` tidak menerima duplicate key;
- shallow immutability: elemen di dalamnya masih bisa mutable.

Shallow immutability:

```java
List<StringBuilder> builders = List.of(new StringBuilder("A"));
builders.getFirst().append("B");

System.out.println(builders.getFirst()); // AB
```

Collection-nya tidak bisa ditambah/dihapus, tetapi object elemennya bisa berubah.

---

## 8.4 Defensive copy pattern

Pattern untuk domain object:

```java
public record CaseTimeline(List<CaseEvent> events) {
    public CaseTimeline {
        events = List.copyOf(events);
    }
}
```

Pattern untuk class biasa:

```java
public final class CaseTimeline {
    private final List<CaseEvent> events;

    public CaseTimeline(List<CaseEvent> events) {
        this.events = List.copyOf(events);
    }

    public List<CaseEvent> events() {
        return events;
    }
}
```

Jika elemen juga mutable, perlu deep copy atau immutable element type.

---

# Bab 9 — Equality, Hashing, dan Comparator Semantics

## 9.1 `equals` dan `hashCode`

Hash-based collection bergantung pada dua method:

```java
boolean equals(Object other)
int hashCode()
```

Contract utama:

```text
Jika a.equals(b) true, maka a.hashCode() harus sama dengan b.hashCode().
```

Jika contract ini dilanggar, `HashMap`/`HashSet` bisa gagal menemukan elemen.

Records membantu karena `equals/hashCode` otomatis berdasarkan component.

```java
record CaseId(String value) {}
```

Ini jauh lebih aman daripada memakai raw `String` di semua tempat jika domain ID berbeda-beda.

---

## 9.2 Bad hashCode

Buruk:

```java
@Override
public int hashCode() {
    return 1;
}
```

Secara contract benar jika equals benar, tetapi performance buruk karena semua key masuk bucket yang sama.

Buruk juga:

```java
@Override
public int hashCode() {
    return new Random().nextInt();
}
```

Ini melanggar stability. Hash code harus stabil selama field equality tidak berubah.

---

## 9.3 Comparator contract

Comparator harus konsisten:

- antisymmetric;
- transitive;
- consistent untuk operasi berulang;
- idealnya konsisten dengan equals jika dipakai pada sorted set/map, kecuali disengaja.

Buruk:

```java
Comparator<Task> randomComparator = (a, b) -> ThreadLocalRandom.current().nextInt(-1, 2);
```

Ini bisa merusak sorted collection.

Buruk:

```java
Comparator<Integer> bad = (a, b) -> a > b ? 1 : -1; // tidak handle equal
```

Benar:

```java
Comparator<Integer> good = Integer::compare;
```

---

# Bab 10 — Null Policy

Java Collections tidak punya null policy universal.

Contoh umum:

| Collection | Null policy umum |
|---|---|
| `ArrayList` | boleh null |
| `HashSet` | boleh null |
| `HashMap` | satu null key, banyak null values |
| `TreeSet` | tergantung comparator/natural order; null sering problem |
| `ConcurrentHashMap` | tidak boleh null key/value |
| `List.of` / `Set.of` / `Map.of` | tidak boleh null |
| `ArrayDeque` | tidak boleh null |

Design rule:

> Jangan jadikan null sebagai elemen collection kecuali benar-benar ada alasan kuat.

Lebih baik:

```java
List<ValidationError> errors = validate(input);
```

Bukan:

```java
List<ValidationError> errors = Arrays.asList(null, error1, null);
```

Untuk map, hindari value null karena membingungkan:

```java
Map<String, User> users = new HashMap<>();
User user = users.get(id);

if (user == null) {
    // Apakah tidak ada key, atau key ada dengan value null?
}
```

Lebih baik jangan simpan null value, atau gunakan explicit wrapper jika benar-benar perlu.

---

# Bab 11 — Collections Algorithms

## 11.1 `Collections` utility class

`java.util.Collections` menyediakan static methods untuk:

- sorting;
- searching;
- reversing;
- shuffling;
- filling;
- copying;
- min/max;
- frequency;
- disjoint;
- synchronized wrappers;
- unmodifiable wrappers;
- checked wrappers.

Contoh:

```java
List<Integer> numbers = new ArrayList<>(List.of(3, 1, 2));
Collections.sort(numbers);
Collections.reverse(numbers);
```

Java modern lebih sering memakai:

```java
numbers.sort(Comparator.naturalOrder());
```

Atau stream untuk menghasilkan list baru:

```java
List<Integer> sorted = numbers.stream()
    .sorted()
    .toList();
```

Ingat: `stream().toList()` menghasilkan unmodifiable list sejak Java 16 behavior API-nya, sedangkan `Collectors.toList()` tidak menjamin mutability/type tertentu.

---

## 11.2 Sorting

Untuk object domain:

```java
List<CaseRecord> cases = new ArrayList<>(input);

cases.sort(
    Comparator.comparing(CaseRecord::priority)
              .thenComparing(CaseRecord::createdAt)
              .thenComparing(CaseRecord::caseNumber)
);
```

Sorting harus deterministic jika output dipakai untuk:

- pagination;
- audit;
- report;
- reconciliation;
- external API response;
- test snapshot.

Jangan sort hanya by non-unique field jika deterministic order penting.

Buruk:

```java
cases.sort(Comparator.comparing(CaseRecord::priority));
```

Jika banyak case priority sama, order antar case bisa bergantung input.

Lebih baik:

```java
cases.sort(
    Comparator.comparing(CaseRecord::priority)
              .thenComparing(CaseRecord::createdAt)
              .thenComparing(CaseRecord::id)
);
```

---

## 11.3 Binary search

`Collections.binarySearch` hanya benar jika list sudah sorted dengan comparator yang sama.

Buruk:

```java
List<Integer> values = List.of(10, 1, 5);
int index = Collections.binarySearch(values, 5); // undefined logical expectation
```

Benar:

```java
List<Integer> values = new ArrayList<>(List.of(10, 1, 5));
values.sort(Integer::compareTo);
int index = Collections.binarySearch(values, 5);
```

Rule:

> Binary search correctness bergantung pada invariant sorted order.

---

# Bab 12 — Performance Semantics

## 12.1 Big-O itu perlu, tetapi tidak cukup

Big-O memberi gambaran pertumbuhan biaya, tetapi production performance juga dipengaruhi:

- constant factor;
- memory allocation;
- cache locality;
- branch prediction;
- boxing/unboxing;
- comparator cost;
- hash quality;
- resizing;
- synchronization;
- GC pressure;
- data distribution.

Contoh:

`LinkedList.add/remove` bisa O(1) pada posisi node, tetapi dalam workload nyata sering kalah dari `ArrayList` karena:

- setiap node object terpisah;
- pointer chasing buruk untuk CPU cache;
- lebih banyak allocation;
- lebih banyak GC pressure.

---

## 12.2 Cost table ringkas

| Structure | Lookup | Insert end | Insert middle | Remove | Ordered? | Unique? |
|---|---:|---:|---:|---:|---|---|
| `ArrayList` | `get(i)` O(1), contains O(n) | amortized O(1) | O(n) | O(n) | yes | no |
| `LinkedList` | O(n) | O(1) tail | O(1) if node known | O(1) if node known | yes | no |
| `HashSet` | O(1) expected | O(1) expected | n/a | O(1) expected | no | yes |
| `LinkedHashSet` | O(1) expected | O(1) expected | n/a | O(1) expected | insertion | yes |
| `TreeSet` | O(log n) | O(log n) | n/a | O(log n) | sorted | yes |
| `HashMap` | O(1) expected | O(1) expected | n/a | O(1) expected | no | key unique |
| `LinkedHashMap` | O(1) expected | O(1) expected | n/a | O(1) expected | insertion/access | key unique |
| `TreeMap` | O(log n) | O(log n) | n/a | O(log n) | sorted key | key unique |
| `ArrayDeque` | end operations O(1) amortized | O(1) | n/a | O(1) ends | encounter | no |
| `PriorityQueue` | head O(1), contains O(n) | O(log n) | n/a | poll O(log n) | priority head | no |

---

## 12.3 Boxing cost

Java standard collections store objects, not primitives.

```java
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    numbers.add(i); // boxing int -> Integer
}
```

Costs:

- object allocation for many values outside cache range;
- memory overhead;
- GC pressure;
- pointer indirection;
- worse cache locality.

For numeric-heavy workloads, consider:

- primitive arrays: `int[]`, `long[]`;
- `IntStream` carefully;
- third-party primitive collections;
- off-heap/native/vector approaches for specialized systems.

For business systems, boxing often acceptable. For high-volume processing, it can dominate.

---

## 12.4 Cache locality

`ArrayList` stores references in contiguous array.

```text
Object[]: [ref, ref, ref, ref, ...]
```

`LinkedList` stores nodes scattered across heap.

```text
Node -> Node -> Node -> Node
```

CPU likes contiguous memory. This is why `ArrayList` often wins even when theoretical Big-O looks similar or worse for some operations.

---

## 12.5 Resizing cost

Dynamic structures resize.

Examples:

- `ArrayList` grows backing array;
- `HashMap` grows bucket table;
- `ArrayDeque` grows circular buffer.

If you know expected size, pre-sizing can help.

But bad pre-sizing wastes memory.

Buruk:

```java
new HashMap<>(10_000_000); // padahal biasanya 100 entry
```

This increases memory footprint and iteration overhead.

---

## 12.6 Comparator cost

Sorted structures call comparator often.

Buruk:

```java
Comparator<CaseRecord> comparator = Comparator.comparing(record -> {
    return expensiveRemoteLookup(record.id());
});
```

Comparator harus pure, fast, deterministic.

Jika sorting berdasarkan expensive derived value, precompute key:

```java
record SortableCase(CaseRecord record, int score) {}

List<SortableCase> sortable = cases.stream()
    .map(c -> new SortableCase(c, computeScore(c)))
    .toList();

List<CaseRecord> sorted = sortable.stream()
    .sorted(Comparator.comparingInt(SortableCase::score))
    .map(SortableCase::record)
    .toList();
```

---

# Bab 13 — Concurrency Semantics

## 13.1 Collection biasa tidak thread-safe

`ArrayList`, `HashMap`, `HashSet`, `LinkedHashMap`, `TreeMap` tidak thread-safe untuk concurrent mutation.

Buruk:

```java
Map<String, Integer> counts = new HashMap<>();

// multiple threads
counts.put(key, counts.getOrDefault(key, 0) + 1);
```

Masalah:

- lost update;
- internal corruption risk;
- visibility problem;
- non-deterministic behavior.

Gunakan:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();
counts.computeIfAbsent(key, ignored -> new LongAdder()).increment();
```

---

## 13.2 `Collections.synchronizedXxx`

Utility wrappers:

```java
List<String> syncList = Collections.synchronizedList(new ArrayList<>());
Map<String, String> syncMap = Collections.synchronizedMap(new HashMap<>());
```

Ini membuat method individual synchronized.

Namun compound operation tetap perlu external synchronization.

Buruk:

```java
if (!syncList.contains(value)) {
    syncList.add(value); // race sebagai compound action
}
```

Benar:

```java
synchronized (syncList) {
    if (!syncList.contains(value)) {
        syncList.add(value);
    }
}
```

Untuk iteration juga perlu synchronized block sesuai dokumentasi wrapper.

Dalam Java modern, sering lebih baik memilih concurrent collection yang memang sesuai use case.

---

## 13.3 Fail-fast vs weakly consistent iterator

Fail-fast iterator:

- typical `ArrayList`, `HashMap`, `HashSet`;
- mendeteksi structural modification best-effort;
- melempar `ConcurrentModificationException`;
- bukan jaminan thread-safety.

Weakly consistent iterator:

- typical `ConcurrentHashMap`;
- tidak melempar `ConcurrentModificationException`;
- bisa melihat sebagian update, tidak selalu semua;
- cocok untuk concurrent traversal approximate.

Snapshot iterator:

- `CopyOnWriteArrayList`;
- iterator melihat snapshot saat iterator dibuat;
- mutation setelahnya tidak terlihat oleh iterator.

---

## 13.4 Safe publication

Collection immutable pun perlu dipublish dengan benar jika dibuat lalu dibaca thread lain.

Aman:

```java
final class Registry {
    private final Map<String, Handler> handlers;

    Registry(Map<String, Handler> handlers) {
        this.handlers = Map.copyOf(handlers);
    }
}
```

`final` field membantu safe publication object state setelah constructor selesai dengan benar.

Buruk:

```java
class Registry {
    Map<String, Handler> handlers;

    void init() {
        handlers = new HashMap<>();
        handlers.put("A", new Handler());
    }
}
```

Jika object dibaca thread lain tanpa synchronization, visibility bisa bermasalah.

---

# Bab 14 — API Design dengan Collections

## 14.1 Return interface, bukan implementation

Biasanya:

```java
public List<CaseEvent> events() { ... }
```

Bukan:

```java
public ArrayList<CaseEvent> events() { ... }
```

Kecuali caller memang membutuhkan method khusus `ArrayList`, yang hampir tidak pernah diperlukan.

---

## 14.2 Parameter harus sesuai kebutuhan minimal

Jika hanya iterasi:

```java
void publish(Iterable<Event> events)
```

Jika butuh `size` dan membership:

```java
void validate(Collection<Permission> permissions)
```

Jika butuh urutan dan positional semantics:

```java
void reorder(List<Step> steps)
```

Jika butuh uniqueness:

```java
void grant(Set<Permission> permissions)
```

Jika butuh lookup:

```java
void configure(Map<String, String> properties)
```

Jika butuh first/last/reversed:

```java
void analyze(SequencedCollection<Event> events)
```

---

## 14.3 Jangan expose mutable internal state

Buruk:

```java
class Workflow {
    private final List<Step> steps = new ArrayList<>();

    public List<Step> steps() {
        return steps;
    }
}
```

Consumer bisa:

```java
workflow.steps().clear();
```

Lebih baik:

```java
class Workflow {
    private final List<Step> steps = new ArrayList<>();

    public List<Step> steps() {
        return List.copyOf(steps);
    }

    public void addStep(Step step) {
        steps.add(step);
    }
}
```

Jika dipanggil sangat sering dan list besar, copying setiap getter mahal. Alternatif:

- simpan immutable list dan update via copy-on-write domain operation;
- return unmodifiable view jika lifecycle backing collection aman;
- pisahkan command/query model;
- expose stream/iterator read-only dengan hati-hati.

---

## 14.4 Empty collection, bukan null

Buruk:

```java
List<Error> validate(Input input) {
    if (valid) {
        return null;
    }
    return errors;
}
```

Benar:

```java
List<Error> validate(Input input) {
    if (valid) {
        return List.of();
    }
    return errors;
}
```

Keuntungan:

- caller lebih sederhana;
- no null check;
- chain operation lebih aman;
- domain semantics lebih jelas.

---

## 14.5 `Optional<List<T>>` biasanya smell

Buruk:

```java
Optional<List<CaseRecord>> findCases(Filter filter);
```

Apa arti `Optional.empty()` vs `Optional.of(List.of())`?

Biasanya lebih baik:

```java
List<CaseRecord> findCases(Filter filter);
```

Return empty list jika tidak ada hasil.

`Optional<Collection>` masuk akal hanya jika ada perbedaan semantic jelas antara:

- data tidak diminta/tidak tersedia;
- data diminta dan hasilnya kosong.

---

# Bab 15 — Domain Modeling Patterns

## 15.1 Set untuk invariant uniqueness

Misalnya satu case tidak boleh memiliki duplicate active assignment user.

```java
record OfficerId(String value) {}

final class AssignmentGroup {
    private final Set<OfficerId> officers;

    AssignmentGroup(Collection<OfficerId> officers) {
        this.officers = Set.copyOf(officers);
    }

    boolean contains(OfficerId officerId) {
        return officers.contains(officerId);
    }
}
```

Jika order assignment juga penting:

```java
private final SequencedSet<OfficerId> officers;
```

Dengan implementation:

```java
SequencedSet<OfficerId> ordered = new LinkedHashSet<>(input);
```

Namun hati-hati: `Set.copyOf` tidak menjamin mempertahankan insertion order sebagai `SequencedSet`. Jika order adalah contract, gunakan explicit ordered implementation dan expose sesuai kebutuhan.

---

## 15.2 Map untuk index dan deduplication

```java
record CaseId(String value) {}
record CaseRecord(CaseId id, String title) {}

Map<CaseId, CaseRecord> indexById(List<CaseRecord> records) {
    Map<CaseId, CaseRecord> index = new HashMap<>((int) (records.size() / 0.75f) + 1);

    for (CaseRecord record : records) {
        CaseRecord previous = index.put(record.id(), record);
        if (previous != null) {
            throw new IllegalArgumentException("Duplicate case id: " + record.id());
        }
    }

    return Map.copyOf(index);
}
```

Pattern ini eksplisit:

- index by ID;
- duplicate ID adalah error;
- hasil immutable.

---

## 15.3 EnumMap untuk state machine

```java
enum State {
    DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED
}

final class TransitionPolicy {
    private final EnumMap<State, EnumSet<State>> transitions;

    TransitionPolicy() {
        this.transitions = new EnumMap<>(State.class);
        transitions.put(State.DRAFT, EnumSet.of(State.SUBMITTED));
        transitions.put(State.SUBMITTED, EnumSet.of(State.UNDER_REVIEW));
        transitions.put(State.UNDER_REVIEW, EnumSet.of(State.APPROVED, State.REJECTED));
        transitions.put(State.APPROVED, EnumSet.noneOf(State.class));
        transitions.put(State.REJECTED, EnumSet.noneOf(State.class));
    }

    boolean canMove(State from, State to) {
        return transitions.getOrDefault(from, EnumSet.noneOf(State.class)).contains(to);
    }
}
```

Ini jauh lebih jelas daripada nested `if` atau raw `Map<String, List<String>>`.

---

## 15.4 PriorityQueue untuk escalation

```java
record Escalation(
    String caseId,
    int severity,
    Instant createdAt
) {}

Comparator<Escalation> escalationOrder =
    Comparator.comparingInt(Escalation::severity).reversed()
              .thenComparing(Escalation::createdAt);

PriorityQueue<Escalation> queue = new PriorityQueue<>(escalationOrder);
```

Gunakan jika process order berdasarkan priority.

Jangan gunakan jika kamu perlu stable full sorted iteration tanpa polling/sorting.

---

## 15.5 LinkedHashMap untuk deterministic API response

```java
Map<String, Object> response = new LinkedHashMap<>();
response.put("caseId", caseId.value());
response.put("status", status.name());
response.put("lastUpdatedAt", lastUpdatedAt);
response.put("links", links);
```

Banyak JSON library bisa mempertahankan map iteration order. Jika order response/test snapshot penting, `LinkedHashMap` membuat niat lebih jelas daripada `HashMap`.

---

# Bab 16 — Common Production Failure Modes

## 16.1 Mutable key di `HashMap`

Gejala:

- `map.containsKey(key)` false padahal object yang sama pernah dimasukkan;
- cache miss misterius;
- duplicate logical key;
- memory leak karena entry tidak bisa ditemukan/dihapus normal.

Pencegahan:

- gunakan immutable key;
- gunakan record untuk value-based key;
- jangan pakai entity JPA mutable sebagai key hash map jika equality berubah sebelum/after persistence;
- jangan pakai collection mutable sebagai component key kecuali dicopy immutable.

---

## 16.2 Comparator inconsistent

Gejala:

- `TreeSet` “menghapus” object berbeda;
- `TreeMap` overwrite value tidak terduga;
- sorted order aneh;
- binary search gagal.

Pencegahan:

- comparator harus deterministic;
- comparator harus mencerminkan uniqueness jika dipakai di sorted set/map;
- tambahkan tie-breaker unik jika perlu.

---

## 16.3 Accidental O(n²)

Buruk:

```java
for (Order order : orders) {
    Customer customer = customers.stream()
        .filter(c -> c.id().equals(order.customerId()))
        .findFirst()
        .orElseThrow();
}
```

Jika `orders` dan `customers` besar, ini O(n*m).

Lebih baik:

```java
Map<CustomerId, Customer> customersById = customers.stream()
    .collect(Collectors.toMap(Customer::id, Function.identity()));

for (Order order : orders) {
    Customer customer = customersById.get(order.customerId());
}
```

---

## 16.4 Unbounded collection growth

Gejala:

- memory meningkat terus;
- GC makin sering;
- latency naik;
- OOM.

Contoh:

```java
static final Map<String, Session> sessions = new HashMap<>();
```

Tanpa eviction/removal.

Pencegahan:

- gunakan bounded cache;
- eviction policy;
- TTL;
- weak references bila sesuai;
- observability: size gauge;
- backpressure;
- cleanup job.

---

## 16.5 Concurrent modification bug

Gejala:

- `ConcurrentModificationException`;
- lost update;
- random behavior;
- data corruption.

Pencegahan:

- single ownership;
- copy before iterate;
- iterator remove;
- concurrent collection;
- immutable snapshot;
- explicit lock.

---

## 16.6 Returning internal mutable collection

Gejala:

- object invariant rusak dari luar;
- test sulit dipahami;
- bug muncul jauh dari penyebab;
- thread safety makin buruk.

Pencegahan:

- `List.copyOf` di constructor;
- return immutable view/snapshot;
- domain method untuk mutation;
- records dengan compact constructor defensive copy.

---

# Bab 17 — Practical Decision Framework

## 17.1 Pilih berdasarkan invariant

| Invariant | Struktur awal |
|---|---|
| Ordered sequence, duplicate allowed | `List` / `ArrayList` |
| Unique elements, order irrelevant | `Set` / `HashSet` |
| Unique elements, insertion order | `SequencedSet` / `LinkedHashSet` |
| Unique sorted elements | `NavigableSet` / `TreeSet` |
| Lookup by key | `Map` / `HashMap` |
| Lookup by key + insertion order | `SequencedMap` / `LinkedHashMap` |
| Lookup by key + sorted key | `NavigableMap` / `TreeMap` |
| Enum key | `EnumMap` |
| Enum set | `EnumSet` |
| FIFO/LIFO local buffer | `Deque` / `ArrayDeque` |
| Priority processing | `PriorityQueue` |
| Concurrent key-value access | `ConcurrentHashMap` |
| Read-mostly concurrent list | `CopyOnWriteArrayList` |
| Producer-consumer bounded queue | `ArrayBlockingQueue` |

---

## 17.2 Pilih berdasarkan operasi dominan

| Dominan | Hindari | Gunakan |
|---|---|---|
| Banyak `contains` pada data unik | `ArrayList` | `HashSet` |
| Banyak lookup by ID | scan list | `HashMap` |
| Banyak sorted range query | sort berulang | `TreeMap` |
| Banyak append + iterate | `LinkedList` | `ArrayList` |
| Banyak remove head/tail | `ArrayList` | `ArrayDeque` |
| Banyak concurrent count | synchronized map | `ConcurrentHashMap` + `LongAdder` |
| Banyak read, jarang write listener | synchronized list | `CopyOnWriteArrayList` |

---

## 17.3 Pilih berdasarkan API contract

```java
// Terlalu spesifik
void process(ArrayList<Event> events)

// Lebih baik jika butuh order dan index
void process(List<Event> events)

// Lebih baik jika hanya butuh iterasi
void process(Iterable<Event> events)

// Lebih baik jika butuh first/last/reversed
void process(SequencedCollection<Event> events)
```

---

# Bab 18 — Code Review Checklist

Gunakan checklist ini saat review code Java yang memakai collections.

## 18.1 Correctness

- Apakah collection type sesuai invariant domain?
- Apakah duplicate boleh?
- Apakah order dijanjikan?
- Apakah key immutable?
- Apakah `equals/hashCode` benar?
- Apakah comparator konsisten?
- Apakah null element/key/value disengaja?
- Apakah duplicate key ditangani eksplisit?

## 18.2 Encapsulation

- Apakah constructor melakukan defensive copy?
- Apakah getter membocorkan mutable internal collection?
- Apakah return empty collection, bukan null?
- Apakah API menerima interface minimal?
- Apakah mutability contract jelas?

## 18.3 Performance

- Apakah ada nested scan yang seharusnya map index?
- Apakah list besar perlu pre-sizing?
- Apakah map besar perlu initial capacity?
- Apakah `LinkedList` dipakai tanpa alasan kuat?
- Apakah boxing primitive menjadi bottleneck?
- Apakah comparator mahal?
- Apakah sorted collection lebih tepat daripada sort berulang?

## 18.4 Concurrency

- Apakah collection dimutate lintas thread?
- Apakah check-then-act atomic?
- Apakah iterator semantics dipahami?
- Apakah queue bounded?
- Apakah unbounded cache/map punya eviction?
- Apakah safe publication sudah benar?

## 18.5 Production readiness

- Apakah collection bisa tumbuh tanpa batas?
- Apakah ada metric size/cache hit/miss/queue depth?
- Apakah memory footprint masuk akal?
- Apakah ordering deterministic untuk API/report/audit?
- Apakah failure behavior jelas jika duplicate/null/invalid key?

---

# Bab 19 — Latihan Bertahap

## Latihan 1 — Collection selection

Untuk setiap case berikut, pilih collection dan jelaskan alasannya:

1. Daftar audit event case, urutan harus sesuai waktu masuk, duplicate event mungkin ada.
2. Daftar permission user, tidak boleh duplicate, order tidak penting.
3. Mapping `CaseId -> CaseRecord` untuk lookup cepat.
4. Mapping `CaseStatus -> allowed actions`.
5. Queue task escalation berdasarkan severity tertinggi.
6. Listener list yang dibaca sangat sering dan jarang berubah.
7. API response field order harus deterministic.
8. In-memory cache shared lintas thread.

Expected reasoning:

1. `List<CaseEvent>` / `ArrayList`, atau `SequencedCollection` jika first/last penting.
2. `Set<Permission>` / `HashSet`, atau `EnumSet` jika permission enum.
3. `Map<CaseId, CaseRecord>` / `HashMap`.
4. `EnumMap<CaseStatus, EnumSet<Action>>`.
5. `PriorityQueue<EscalationTask>`.
6. `CopyOnWriteArrayList<Listener>`.
7. `LinkedHashMap<String, Object>`.
8. `ConcurrentHashMap<K,V>` atau cache library.

---

## Latihan 2 — Refactor O(n²)

Refactor kode ini:

```java
List<OrderView> views = new ArrayList<>();

for (Order order : orders) {
    Customer customer = customers.stream()
        .filter(c -> c.id().equals(order.customerId()))
        .findFirst()
        .orElseThrow();

    views.add(new OrderView(order.id(), customer.name()));
}
```

Solusi:

```java
Map<CustomerId, Customer> customersById = new HashMap<>((int) (customers.size() / 0.75f) + 1);

for (Customer customer : customers) {
    Customer previous = customersById.put(customer.id(), customer);
    if (previous != null) {
        throw new IllegalStateException("Duplicate customer id: " + customer.id());
    }
}

List<OrderView> views = new ArrayList<>(orders.size());

for (Order order : orders) {
    Customer customer = customersById.get(order.customerId());
    if (customer == null) {
        throw new IllegalStateException("Missing customer: " + order.customerId());
    }
    views.add(new OrderView(order.id(), customer.name()));
}
```

Poin pembelajaran:

- index upfront;
- duplicate key eksplisit;
- missing reference eksplisit;
- output pre-sized.

---

## Latihan 3 — Mutable key bug

Jalankan dan jelaskan output:

```java
import java.util.*;

public class MutableKeyDemo {
    static final class Key {
        String value;

        Key(String value) {
            this.value = value;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key other && Objects.equals(value, other.value);
        }

        @Override
        public int hashCode() {
            return Objects.hash(value);
        }

        @Override
        public String toString() {
            return "Key[" + value + "]";
        }
    }

    public static void main(String[] args) {
        Map<Key, String> map = new HashMap<>();
        Key key = new Key("A");

        map.put(key, "value");
        System.out.println(map.get(key));

        key.value = "B";
        System.out.println(map.get(key));
        System.out.println(map.containsKey(key));
        System.out.println(map);
    }
}
```

Lalu refactor `Key` menjadi record immutable:

```java
record Key(String value) {}
```

---

## Latihan 4 — SequencedCollection API

Buat function:

```java
static <E> List<E> firstAndLast(SequencedCollection<E> input)
```

Rules:

- jika kosong, return `List.of()`;
- jika size 1, return satu elemen;
- jika lebih dari 1, return first dan last;
- jangan gunakan index.

Contoh solusi:

```java
static <E> List<E> firstAndLast(SequencedCollection<E> input) {
    if (input.isEmpty()) {
        return List.of();
    }

    E first = input.getFirst();
    E last = input.getLast();

    if (Objects.equals(first, last) && input.size() == 1) {
        return List.of(first);
    }

    return List.of(first, last);
}
```

Catatan: jika collection bisa berisi duplicate first/last value yang equal tetapi size > 1, function tetap mengembalikan dua elemen. Karena semantic-nya posisi, bukan uniqueness.

---

# Bab 20 — Mini Project: Case Collection Modeling

## 20.1 Requirement

Buat model in-memory untuk case management sederhana.

Domain:

- `CaseId`
- `OfficerId`
- `CaseStatus`
- `CaseAction`
- `CaseEvent`
- `CaseRecord`
- `CaseRepositoryInMemory`
- `TransitionPolicy`
- `EscalationQueue`

Rules:

1. `CaseId` harus unique.
2. `CaseRecord` punya ordered audit events.
3. Officer assignment tidak boleh duplicate, tetapi order assignment harus dipertahankan.
4. Transition policy berdasarkan enum status.
5. Escalation diproses berdasarkan severity tertinggi, lalu created time terlama.
6. Repository harus safe untuk concurrent read/write sederhana.

## 20.2 Suggested structures

| Requirement | Structure |
|---|---|
| unique case id lookup | `ConcurrentHashMap<CaseId, CaseRecord>` |
| audit events ordered | `List<CaseEvent>` / immutable copy |
| assignment unique + ordered | `LinkedHashSet<OfficerId>` / `SequencedSet` |
| transition table | `EnumMap<CaseStatus, EnumSet<CaseAction>>` |
| escalation priority | `PriorityBlockingQueue<EscalationTask>` or `PriorityQueue` local |

## 20.3 Skeleton

```java
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

record CaseId(String value) {}
record OfficerId(String value) {}

enum CaseStatus {
    DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, CLOSED
}

enum CaseAction {
    SUBMIT, ASSIGN, APPROVE, REJECT, CLOSE, ESCALATE
}

record CaseEvent(CaseId caseId, String type, Instant occurredAt) {}

final class CaseRecord {
    private final CaseId id;
    private final CaseStatus status;
    private final List<CaseEvent> events;
    private final SequencedSet<OfficerId> assignedOfficers;

    CaseRecord(
        CaseId id,
        CaseStatus status,
        Collection<CaseEvent> events,
        Collection<OfficerId> assignedOfficers
    ) {
        this.id = Objects.requireNonNull(id);
        this.status = Objects.requireNonNull(status);
        this.events = List.copyOf(events);
        this.assignedOfficers = new LinkedHashSet<>(assignedOfficers);
    }

    CaseId id() {
        return id;
    }

    CaseStatus status() {
        return status;
    }

    List<CaseEvent> events() {
        return events;
    }

    SequencedSet<OfficerId> assignedOfficers() {
        return Collections.unmodifiableSequencedSet(assignedOfficers);
    }
}

final class TransitionPolicy {
    private final EnumMap<CaseStatus, EnumSet<CaseAction>> allowed;

    TransitionPolicy() {
        allowed = new EnumMap<>(CaseStatus.class);
        allowed.put(CaseStatus.DRAFT, EnumSet.of(CaseAction.SUBMIT));
        allowed.put(CaseStatus.SUBMITTED, EnumSet.of(CaseAction.ASSIGN));
        allowed.put(CaseStatus.UNDER_REVIEW, EnumSet.of(CaseAction.APPROVE, CaseAction.REJECT, CaseAction.ESCALATE));
        allowed.put(CaseStatus.APPROVED, EnumSet.of(CaseAction.CLOSE));
        allowed.put(CaseStatus.REJECTED, EnumSet.of(CaseAction.CLOSE));
        allowed.put(CaseStatus.CLOSED, EnumSet.noneOf(CaseAction.class));
    }

    boolean allows(CaseStatus status, CaseAction action) {
        return allowed.getOrDefault(status, EnumSet.noneOf(CaseAction.class)).contains(action);
    }
}

record EscalationTask(CaseId caseId, int severity, Instant createdAt) {}

final class EscalationQueue {
    private static final Comparator<EscalationTask> ORDER =
        Comparator.comparingInt(EscalationTask::severity).reversed()
                  .thenComparing(EscalationTask::createdAt);

    private final PriorityBlockingQueue<EscalationTask> queue = new PriorityBlockingQueue<>(11, ORDER);

    void submit(EscalationTask task) {
        queue.offer(task);
    }

    EscalationTask take() throws InterruptedException {
        return queue.take();
    }
}

final class CaseRepositoryInMemory {
    private final ConcurrentHashMap<CaseId, CaseRecord> cases = new ConcurrentHashMap<>();

    void insert(CaseRecord record) {
        CaseRecord previous = cases.putIfAbsent(record.id(), record);
        if (previous != null) {
            throw new IllegalArgumentException("Duplicate case id: " + record.id());
        }
    }

    Optional<CaseRecord> findById(CaseId id) {
        return Optional.ofNullable(cases.get(id));
    }

    List<CaseRecord> snapshot() {
        return List.copyOf(cases.values());
    }
}
```

## 20.4 Review questions

1. Kenapa `CaseId` dibuat record?
2. Kenapa repository memakai `ConcurrentHashMap`?
3. Kenapa `insert` memakai `putIfAbsent`, bukan `containsKey` lalu `put`?
4. Kenapa audit events memakai `List.copyOf`?
5. Kenapa officer assignment memakai `LinkedHashSet`/`SequencedSet`?
6. Apa risiko `snapshot()` dari `ConcurrentHashMap.values()`?
7. Apakah order `snapshot()` deterministic?
8. Jika API butuh sorted snapshot by case ID, struktur apa yang perlu ditambahkan?

---

# Bab 21 — Ringkasan Mental Model

Java Collections harus dipahami sebagai kombinasi:

```text
interface contract
+ implementation behavior
+ equality/comparator semantics
+ ordering semantics
+ mutability semantics
+ concurrency semantics
+ cost model
+ domain invariant
```

Default yang baik:

- `ArrayList` untuk list umum;
- `HashSet` untuk uniqueness tanpa order;
- `LinkedHashSet` untuk uniqueness + deterministic insertion order;
- `HashMap` untuk lookup umum;
- `LinkedHashMap` untuk lookup + deterministic order;
- `TreeMap`/`TreeSet` untuk sorted/range behavior;
- `EnumMap`/`EnumSet` untuk enum;
- `ArrayDeque` untuk stack/queue lokal;
- `PriorityQueue` untuk priority processing non-concurrent;
- `ConcurrentHashMap` untuk concurrent key-value;
- `CopyOnWriteArrayList` untuk read-mostly listener/config list;
- `List.copyOf` / `Set.copyOf` / `Map.copyOf` untuk boundary snapshot;
- `List.of` / `Set.of` / `Map.of` untuk small constants.

Red flags:

- `LinkedList` dipakai sebagai default list;
- `HashMap` order diandalkan;
- mutable object dipakai sebagai key;
- `Optional<List<T>>` tanpa semantic jelas;
- returning mutable internal collection;
- unbounded map/cache/queue;
- `contains` di list besar dalam loop;
- comparator tidak deterministic;
- concurrent mutation pada non-concurrent collection;
- duplicate key overwrite diam-diam;
- null element/value tanpa alasan jelas.

Top-tier Java engineer memilih collection bukan karena familiar, tetapi karena collection tersebut membuat invariant sistem menjadi eksplisit, operasi utama menjadi efisien, dan failure mode menjadi terkendali.

---

# Referensi

1. Oracle Java SE 25 API — Java Collections Framework  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-index.html
2. Oracle Java SE 25 API — Collections Framework Outline  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-reference.html
3. Oracle Java SE 25 API — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html
4. Oracle Java SE 25 API — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html
5. Oracle Java SE 25 API — `ArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html
6. Oracle Java SE 25 API — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html
7. Oracle Java SE 25 API — `Collections`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html
8. OpenJDK JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-006.md">⬅️ Learn Java Part 006 — Functional Programming di Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../index.md">🏠 Home</a>
<a href="./learn-java-part-008.md">Learn Java Part 008 — Error Handling, Exceptions, dan Reliability Engineering ➡️</a>
</div>
