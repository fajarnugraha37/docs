# learn-java-dsa-part-007 — HashMap, HashSet, LinkedHashMap, IdentityHashMap, WeakHashMap

> Seri: Java Data Structure and Algorithm Advanced  
> Part: 007 dari 030  
> Status seri: belum selesai  
> Fokus: memilih dan menggunakan keluarga hash-based collection Java berdasarkan semantics, invariant, lifecycle reference, ordering, memory, dan failure mode production.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan tidak hanya bisa memakai `HashMap` atau `HashSet`, tetapi mampu menjawab pertanyaan engineering seperti:

1. Mengapa `HashMap` adalah default map, tetapi bukan selalu map terbaik?
2. Kapan `HashSet` cukup, kapan perlu `LinkedHashSet`, kapan perlu `TreeSet`, dan kapan perlu struktur custom?
3. Mengapa `LinkedHashMap` bisa menjadi fondasi sederhana untuk LRU cache, tetapi tetap bukan full production cache?
4. Mengapa `IdentityHashMap` sengaja melanggar ekspektasi umum `Map` berbasis `equals`?
5. Mengapa `WeakHashMap` bukan cache umum, tetapi struktur untuk association yang mengikuti lifecycle key?
6. Bagaimana memilih initial capacity dan load factor secara benar?
7. Bagaimana bug `equals/hashCode`, mutable key, comparator/order assumption, dan reference retention bisa membuat sistem salah atau memory leak?
8. Bagaimana membangun mental model map/set sebagai index, bukan sekadar container?

Part ini melanjutkan Part 006. Jadi kita tidak mengulang teori hashing dari nol. Kita akan fokus pada keluarga implementasi Java dan cara berpikir production-grade.

---

## 1. Mental Model: Map dan Set sebagai Index

Banyak developer melihat `Map` sebagai "tempat menyimpan key-value". Itu benar, tetapi terlalu dangkal.

Mental model yang lebih kuat:

> `Map<K, V>` adalah index dari domain key `K` menuju fakta, object, state, aggregate, atau metadata `V`.

Sedangkan:

> `Set<E>` adalah index keberadaan dari element `E`.

Artinya, ketika kamu memilih `Map`/`Set`, kamu sebenarnya sedang mendesain:

1. Definisi identitas data.
2. Cara lookup.
3. Cara deduplication.
4. Cara mempertahankan atau mengabaikan urutan.
5. Cara data hidup dan mati di memory.
6. Cara collection bereaksi terhadap mutasi.
7. Cara sistem mempertahankan invariant.

Contoh:

```java
Map<CaseId, CaseSnapshot> casesById;
Set<DocumentHash> uploadedDocuments;
Map<UserSession, SecurityContext> contextBySession;
Map<Node, VisitState> traversalState;
Map<RuleCode, RuleDefinition> activeRules;
```

Nama variable di atas menyatakan index. Ini jauh lebih informatif daripada:

```java
Map<String, Object> map;
Set<String> set;
```

Map yang baik biasanya menjawab pertanyaan berikut:

```text
Untuk operasi utama sistem ini, apa key lookup yang paling sering terjadi?
```

Jika jawabannya jelas, map bisa sangat kuat. Jika tidak jelas, map sering berubah menjadi dumping ground.

---

## 2. Keluarga Struktur yang Dibahas

Part ini membahas lima struktur utama:

| Struktur | Semantics utama | Ordering | Reference behavior | Use case utama |
|---|---|---|---|---|
| `HashMap` | key equality via `equals/hashCode` | tidak dijamin | strong key/value | index umum |
| `HashSet` | element uniqueness via `equals/hashCode` | tidak dijamin | strong element | dedup / membership |
| `LinkedHashMap` | hash map + linked encounter order | insertion/access order | strong key/value | deterministic order, simple LRU |
| `IdentityHashMap` | key equality via `==` | tidak dijamin | strong key/value | object identity metadata |
| `WeakHashMap` | key weakly referenced | tidak stabil karena GC | weak key, strong value | lifecycle-bound association |

Perhatikan tiga dimensi penting:

1. **Equality semantics**  
   Apakah dua key dianggap sama karena `equals`, karena `==`, atau karena sesuatu yang lain?

2. **Order semantics**  
   Apakah iterasi harus deterministik? Apakah berdasarkan insertion order? Access order? Sorted order?

3. **Lifecycle semantics**  
   Apakah map boleh membuat key tetap hidup? Apakah entry hilang ketika key tidak lagi strongly reachable?

Top-tier engineer jarang bertanya "pakai Map apa?". Mereka bertanya:

```text
Semantics apa yang harus dijaga oleh index ini?
```

---

## 3. `HashMap`: Default Associative Array di Java

`HashMap<K, V>` adalah implementasi hash-table dari `Map`.

Karakter utama:

1. Menyimpan mapping dari key ke value.
2. Key unik menurut `equals/hashCode`.
3. Mendukung satu `null` key.
4. Mendukung `null` value.
5. Tidak menjamin iteration order.
6. Tidak thread-safe untuk concurrent mutation tanpa sinkronisasi eksternal.
7. Expected average `O(1)` untuk `get`, `put`, `remove`, dengan asumsi hash distribution cukup baik.

Contoh dasar:

```java
Map<String, Integer> countByStatus = new HashMap<>();

countByStatus.put("OPEN", 10);
countByStatus.put("CLOSED", 5);

int openCount = countByStatus.getOrDefault("OPEN", 0);
```

Tetapi pemahaman production-grade dimulai dari struktur konseptualnya.

---

## 4. Struktur Konseptual `HashMap`

Secara konseptual:

```text
HashMap
  table: array of buckets

bucket[index]
  -> node(key, value, hash, next)
  -> node(key, value, hash, next)
  -> ...
```

Untuk `put(k, v)`:

1. Hitung hash dari key.
2. Sebarkan/hash-mix nilai hash.
3. Tentukan index bucket.
4. Jika bucket kosong, simpan node baru.
5. Jika bucket berisi node:
   - cari key yang sama,
   - replace value jika ditemukan,
   - append node jika tidak ditemukan.
6. Jika bucket terlalu padat, bucket dapat berubah menjadi tree bin pada implementasi modern.
7. Jika size melewati threshold, table di-resize.

Pseudo flow:

```text
put(key, value):
  h = hash(key)
  i = indexFor(h, table.length)

  if table[i] is empty:
      table[i] = new Node(key, value, h)
  else:
      find node with same hash and equal key
      if found:
          replace value
      else:
          append new node or insert into tree bin

  if size > threshold:
      resize()
```

Hal penting: `HashMap` bukan satu object kecil. Ia adalah graph object:

```text
HashMap object
  -> bucket array
       -> Node
            -> key object
            -> value object
            -> next node
```

Karena itu, `HashMap` punya overhead memory cukup signifikan, terutama untuk jumlah entry kecil tetapi banyak map.

---

## 5. Capacity, Load Factor, Threshold

`HashMap` punya tiga konsep penting:

| Konsep | Arti |
|---|---|
| capacity | jumlah bucket pada internal table |
| load factor | batas kepadatan sebelum resize |
| threshold | `capacity * loadFactor` |

Default load factor Java `HashMap` adalah `0.75`.

Artinya secara konseptual:

```text
capacity = 16
loadFactor = 0.75
threshold = 12
```

Ketika jumlah entry melewati threshold, map resize.

### 5.1 Kenapa Load Factor 0.75?

Load factor lebih rendah:

1. Lebih banyak bucket.
2. Lebih sedikit collision.
3. Lookup lebih cepat.
4. Memory lebih boros.

Load factor lebih tinggi:

1. Lebih sedikit bucket.
2. Memory lebih hemat.
3. Collision lebih banyak.
4. Lookup/put bisa lebih lambat.

`0.75` adalah kompromi umum antara memory dan speed.

### 5.2 Initial Capacity Bukan Jumlah Entry

Ini kesalahan umum:

```java
Map<String, User> users = new HashMap<>(1_000_000);
```

Banyak developer mengira ini berarti "untuk 1 juta data". Lebih tepatnya ini adalah initial capacity request untuk bucket table, bukan jumlah entry final secara langsung.

Jika kamu ingin menampung `expectedSize` tanpa resize, estimasi capacity minimal:

```text
neededCapacity = ceil(expectedSize / loadFactor)
```

Untuk load factor `0.75`:

```text
expectedSize = 1_000_000
neededCapacity = ceil(1_000_000 / 0.75)
               = 1_333_334
```

Implementasi akan menyesuaikan ke power-of-two capacity.

Utility:

```java
static int capacityForExpectedSize(int expectedSize) {
    if (expectedSize < 0) {
        throw new IllegalArgumentException("expectedSize must not be negative");
    }
    if (expectedSize < 3) {
        return expectedSize + 1;
    }
    return (int) Math.ceil(expectedSize / 0.75d);
}
```

Namun jangan asal over-size. Over-sizing membuat iteration lebih mahal karena iterasi map juga dipengaruhi oleh bucket capacity, bukan hanya size.

---

## 6. `HashMap` Operation Cost

| Operation | Expected | Worst-case konseptual | Catatan |
|---|---:|---:|---|
| `get` | `O(1)` | `O(n)` / lebih baik pada tree bin | tergantung collision |
| `put` | `O(1)` amortized | `O(n)` + resize | resize menyebabkan spike |
| `remove` | `O(1)` | `O(n)` | collision-sensitive |
| `containsKey` | `O(1)` | `O(n)` | sama seperti get |
| iteration | `O(capacity + size)` | `O(capacity + size)` | oversized map membuat iterasi lambat |

Catatan penting:

1. `O(1)` adalah expected, bukan garansi mutlak.
2. Resize adalah amortized cost, tetapi tetap bisa menjadi latency spike.
3. Collision buruk bisa menghancurkan performa.
4. Key yang mahal `hashCode()` atau `equals()`-nya membuat map mahal.
5. Key object yang banyak allocation dapat meningkatkan GC pressure.

---

## 7. Null Key dan Null Value

`HashMap` mengizinkan:

```java
Map<String, String> map = new HashMap<>();
map.put(null, "root");
map.put("x", null);
```

Masalahnya bukan boleh atau tidak, tetapi ambiguity.

```java
String value = map.get("missing");
```

Jika hasilnya `null`, artinya bisa dua kemungkinan:

1. Key tidak ada.
2. Key ada, tetapi value-nya `null`.

Untuk membedakan:

```java
if (map.containsKey("missing")) {
    String value = map.get("missing");
}
```

Dalam production code, pertimbangkan guideline:

```text
Hindari null value dalam Map kecuali benar-benar ada semantics yang jelas.
```

Lebih baik:

```java
Map<String, Optional<User>> maybeUserById;
```

Tetapi ini juga tidak selalu ideal karena `Optional` sebagai field/value collection punya overhead dan bisa membuat API noisy. Alternatif umum:

1. Tidak menyimpan key jika value absent.
2. Gunakan sentinel object internal.
3. Gunakan dedicated result type.
4. Pisahkan map sukses dan failure.

Contoh sentinel internal:

```java
final class LookupCache {
    private static final User NOT_FOUND = new User("__not_found__");

    private final Map<String, User> cache = new HashMap<>();

    User getOrLoad(String id) {
        User cached = cache.get(id);
        if (cached != null) {
            return cached == NOT_FOUND ? null : cached;
        }

        User loaded = loadUser(id);
        cache.put(id, loaded == null ? NOT_FOUND : loaded);
        return loaded;
    }

    private User loadUser(String id) {
        // load from database or external system
        return null;
    }
}

record User(String id) {}
```

Tetapi sentinel harus private dan tidak bocor ke caller.

---

## 8. The Biggest HashMap Bug: Mutable Key

Mutable key adalah sumber bug yang sangat berbahaya.

Contoh buruk:

```java
final class UserKey {
    private String tenantId;
    private String userId;

    UserKey(String tenantId, String userId) {
        this.tenantId = tenantId;
        this.userId = userId;
    }

    void setUserId(String userId) {
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof UserKey other)) return false;
        return Objects.equals(tenantId, other.tenantId)
            && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tenantId, userId);
    }
}
```

Penggunaan:

```java
Map<UserKey, String> map = new HashMap<>();

UserKey key = new UserKey("T1", "U1");
map.put(key, "Alice");

key.setUserId("U2");

System.out.println(map.get(key)); // kemungkinan null
```

Secara mental model:

```text
Saat put:
  hash(key with U1) -> bucket A

Setelah key dimutasi:
  hash(key with U2) -> bucket B

get mencari di bucket B,
padahal node lama masih ada di bucket A.
```

Map terlihat "kehilangan" data, padahal entry masih ada.

Solusi:

```java
record UserKey(String tenantId, String userId) {}
```

Gunakan immutable key.

Guideline:

```text
Object yang dipakai sebagai key HashMap harus immutable terhadap field yang ikut equals/hashCode.
```

Boleh object mutable menjadi key hanya jika field identity-nya immutable dan `equals/hashCode` hanya memakai field tersebut. Namun ini tetap butuh disiplin tinggi.

---

## 9. Key Design: Jangan Asal String

Banyak codebase memakai `String` sebagai key universal:

```java
Map<String, Case> cases;
Map<String, Rule> rules;
Map<String, User> users;
```

Ini mudah, tetapi rawan salah domain.

Contoh bug:

```java
Case caseData = cases.get(userId); // compile, tapi salah domain
```

Lebih baik gunakan value object:

```java
record CaseId(String value) {
    CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId must not be blank");
        }
    }
}

record UserId(String value) {
    UserId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("UserId must not be blank");
        }
    }
}
```

Lalu:

```java
Map<CaseId, Case> casesById = new HashMap<>();
Map<UserId, User> usersById = new HashMap<>();
```

Sekarang compiler membantu mencegah salah key.

Trade-off:

1. Lebih banyak class/record kecil.
2. Sedikit overhead object jika dibuat masif.
3. Lebih aman secara domain.
4. Lebih self-documenting.

Untuk sistem enterprise, value object key sering worth it.

---

## 10. `HashSet`: Map yang Value-nya Tidak Penting

`HashSet<E>` adalah struktur untuk uniqueness/membership.

Secara konseptual, ia bisa dipahami sebagai:

```text
HashSet<E> ≈ HashMap<E, PRESENT>
```

Artinya:

1. Element adalah key.
2. Tidak ada value yang bermakna.
3. `contains(e)` menggunakan `hashCode/equals`.
4. Duplicate dicegah berdasarkan equality.

Contoh:

```java
Set<String> processedIds = new HashSet<>();

if (processedIds.add(messageId)) {
    process(messageId);
} else {
    skipDuplicate(messageId);
}
```

Pattern penting:

```java
if (set.add(x)) {
    // first time seen
} else {
    // duplicate
}
```

Jangan lakukan ini jika tidak perlu:

```java
if (!set.contains(x)) {
    set.add(x);
}
```

Karena itu melakukan lookup dua kali. `add` sudah memberi tahu apakah element baru.

---

## 11. `HashSet` Use Cases

### 11.1 Deduplication

```java
List<String> input = List.of("A", "B", "A", "C");
Set<String> unique = new HashSet<>(input);
```

Jika order tidak penting, `HashSet` cukup.

Jika order input perlu dipertahankan:

```java
Set<String> uniqueInInputOrder = new LinkedHashSet<>(input);
```

### 11.2 Membership Test

Buruk:

```java
List<String> allowedStatuses = List.of("OPEN", "PENDING", "CLOSED");

if (allowedStatuses.contains(status)) {
    // O(n)
}
```

Untuk list kecil, ini tidak masalah. Untuk repeated lookup besar:

```java
private static final Set<String> ALLOWED_STATUSES = Set.of(
    "OPEN", "PENDING", "CLOSED"
);
```

`Set.of` berguna untuk small immutable set.

### 11.3 Visited Set

```java
Set<NodeId> visited = new HashSet<>();
Deque<NodeId> stack = new ArrayDeque<>();

stack.push(start);

while (!stack.isEmpty()) {
    NodeId current = stack.pop();
    if (!visited.add(current)) {
        continue;
    }

    for (NodeId next : graph.neighborsOf(current)) {
        stack.push(next);
    }
}
```

Visited set adalah salah satu penggunaan `HashSet` paling penting dalam graph traversal.

---

## 12. `HashMap` vs `HashSet`

Gunakan `HashSet` jika pertanyaannya:

```text
Apakah X sudah ada?
```

Gunakan `HashMap` jika pertanyaannya:

```text
Untuk X, data terkaitnya apa?
```

Contoh:

```java
Set<CaseId> escalatedCases;
Map<CaseId, EscalationDetail> escalationByCaseId;
```

Jika kamu mulai membuat parallel structures seperti:

```java
Set<CaseId> escalatedCases;
Map<CaseId, LocalDateTime> escalationTimeByCase;
Map<CaseId, String> escalationReasonByCase;
```

Mungkin seharusnya:

```java
Map<CaseId, EscalationDetail> escalationByCaseId;

record EscalationDetail(
    LocalDateTime escalatedAt,
    String reason,
    Severity severity
) {}
```

Parallel collection sering menjadi tanda desain yang rapuh karena invariant tersebar.

---

## 13. `LinkedHashMap`: HashMap + Encounter Order

`LinkedHashMap<K, V>` adalah hash map yang juga mempertahankan linked list antar entry.

Dua mode utama:

1. Insertion order.
2. Access order.

### 13.1 Insertion Order

Default constructor memakai insertion order.

```java
Map<String, Integer> map = new LinkedHashMap<>();
map.put("B", 2);
map.put("A", 1);
map.put("C", 3);

System.out.println(map.keySet()); // [B, A, C]
```

Ini berguna saat kamu ingin deterministic output.

Use case:

1. Report generation.
2. JSON serialization order.
3. Deterministic validation error order.
4. Preserve user input order.
5. Reproducible test result.

### 13.2 Re-insert Existing Key

Jika key yang sudah ada di-`put` lagi, insertion order tidak dianggap berubah dalam insertion-order map.

```java
Map<String, Integer> map = new LinkedHashMap<>();
map.put("A", 1);
map.put("B", 2);
map.put("A", 10);

System.out.println(map.keySet()); // [A, B]
```

Value berubah, posisi tetap.

---

## 14. `LinkedHashMap` Access Order

Constructor ini mengaktifkan access order:

```java
Map<String, Integer> map = new LinkedHashMap<>(16, 0.75f, true);
```

Dalam access order, entry yang diakses akan dipindah ke akhir.

```java
Map<String, Integer> map = new LinkedHashMap<>(16, 0.75f, true);
map.put("A", 1);
map.put("B", 2);
map.put("C", 3);

map.get("A");

System.out.println(map.keySet()); // [B, C, A]
```

Ini fondasi LRU:

```text
head = least recently used
 tail = most recently used
```

---

## 15. Simple LRU dengan `LinkedHashMap`

Contoh bounded LRU sederhana:

```java
public final class LruCache<K, V> extends LinkedHashMap<K, V> {
    private final int maxEntries;

    public LruCache(int maxEntries) {
        super(capacityFor(maxEntries), 0.75f, true);
        if (maxEntries <= 0) {
            throw new IllegalArgumentException("maxEntries must be positive");
        }
        this.maxEntries = maxEntries;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > maxEntries;
    }

    private static int capacityFor(int maxEntries) {
        return (int) Math.ceil(maxEntries / 0.75d) + 1;
    }
}
```

Penggunaan:

```java
Map<String, String> cache = new LruCache<>(3);
cache.put("A", "value-A");
cache.put("B", "value-B");
cache.put("C", "value-C");
cache.get("A");
cache.put("D", "value-D");

System.out.println(cache.keySet()); // [C, A, D] atau B ter-evict
```

### 15.1 Kapan Ini Cukup?

Cukup untuk:

1. Single-threaded utility.
2. Small in-memory helper cache.
3. Bounded memoization lokal.
4. Test/support code.
5. Deterministic small cache.

### 15.2 Kapan Tidak Cukup?

Tidak cukup untuk production cache serius yang butuh:

1. Concurrent access tinggi.
2. TTL expiration.
3. Refresh after write/access.
4. Size by weight, bukan jumlah entry.
5. Metrics.
6. Async loading.
7. Stampede protection.
8. Eviction listener.
9. Maximum memory control.
10. Distributed invalidation.

Untuk itu biasanya gunakan library cache seperti Caffeine. Namun konsep LRU tetap wajib dipahami karena ia adalah dasar mental model eviction.

---

## 16. `LinkedHashMap` Cost Model

Dibanding `HashMap`, `LinkedHashMap` menambah pointer untuk linked order.

Secara konseptual node punya tambahan:

```text
before
 after
```

Trade-off:

| Aspek | `HashMap` | `LinkedHashMap` |
|---|---:|---:|
| Lookup expected | `O(1)` | `O(1)` |
| Insert expected | `O(1)` | `O(1)` + maintain links |
| Remove expected | `O(1)` | `O(1)` + unlink |
| Memory | lebih rendah | lebih tinggi |
| Iteration order | tidak dijamin | predictable |
| Iteration cost | capacity + size | umumnya size-order traversal |

Gunakan `LinkedHashMap` ketika order memang bagian dari requirement, bukan karena "lebih rapi".

---

## 17. `HashMap` Iteration Order Trap

Jangan pernah bergantung pada order `HashMap`.

Contoh buruk:

```java
Map<String, Rule> rules = new HashMap<>();

for (Rule rule : rules.values()) {
    apply(rule);
}
```

Jika urutan rule memengaruhi hasil, ini bug.

Solusi:

1. Gunakan `LinkedHashMap` jika insertion order adalah rule.
2. Gunakan `TreeMap` jika sorted order adalah rule.
3. Simpan explicit priority dan sort.
4. Gunakan `List<Rule>` jika order lebih penting daripada lookup.
5. Gunakan dua index jika butuh lookup dan order.

Contoh dua index:

```java
final class RuleRegistry {
    private final Map<RuleCode, Rule> byCode;
    private final List<Rule> evaluationOrder;

    RuleRegistry(Collection<Rule> rules) {
        Map<RuleCode, Rule> map = new HashMap<>();
        List<Rule> ordered = new ArrayList<>(rules);
        ordered.sort(Comparator.comparingInt(Rule::priority));

        for (Rule rule : ordered) {
            Rule previous = map.put(rule.code(), rule);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate rule code: " + rule.code());
            }
        }

        this.byCode = Map.copyOf(map);
        this.evaluationOrder = List.copyOf(ordered);
    }

    Rule get(RuleCode code) {
        return byCode.get(code);
    }

    List<Rule> evaluationOrder() {
        return evaluationOrder;
    }
}

record RuleCode(String value) {}
record Rule(RuleCode code, int priority) {}
```

Ini lebih jelas daripada memaksa satu map memenuhi semua kebutuhan.

---

## 18. `IdentityHashMap`: Equality Berdasarkan `==`

`IdentityHashMap<K, V>` adalah map yang membandingkan key berdasarkan reference identity, bukan `equals`.

Normal `HashMap`:

```text
k1 equals k2 -> dianggap key sama
```

`IdentityHashMap`:

```text
k1 == k2 -> dianggap key sama
```

Contoh:

```java
String a = new String("X");
String b = new String("X");

Map<String, Integer> normal = new HashMap<>();
normal.put(a, 1);
normal.put(b, 2);
System.out.println(normal.size()); // 1

Map<String, Integer> identity = new IdentityHashMap<>();
identity.put(a, 1);
identity.put(b, 2);
System.out.println(identity.size()); // 2
```

Karena `a.equals(b)` true, tetapi `a == b` false.

---

## 19. Kapan `IdentityHashMap` Berguna?

`IdentityHashMap` bukan untuk domain normal. Ia berguna ketika object identity adalah fakta yang ingin dilacak.

Use case tepat:

1. Traversal object graph.
2. Detect cycle berdasarkan object instance.
3. Serialization/deserialization identity table.
4. Deep copy object graph.
5. Proxy/wrapper metadata per object instance.
6. Debugging identity aliasing.

Contoh cycle-safe object graph traversal:

```java
final class ObjectGraphWalker {
    private final Set<Object> visited = Collections.newSetFromMap(new IdentityHashMap<>());

    void visit(Object root) {
        if (root == null) {
            return;
        }
        if (!visited.add(root)) {
            return;
        }

        // inspect fields, walk references, etc.
    }
}
```

Mengapa bukan `HashSet` biasa?

Karena dua object berbeda bisa `equals`, tetapi dalam traversal object graph kita peduli instance yang sama atau tidak.

---

## 20. Kapan `IdentityHashMap` Berbahaya?

Berbahaya jika dipakai untuk domain key yang seharusnya logical equality.

Contoh buruk:

```java
Map<String, User> users = new IdentityHashMap<>();
users.put(new String("U1"), new User("Alice"));

User user = users.get(new String("U1")); // null
```

Secara domain, dua string `"U1"` sama. Tapi secara identity, object berbeda.

Guideline:

```text
Gunakan IdentityHashMap hanya jika kamu bisa menyelesaikan kalimat:
"Saya sengaja ingin membedakan dua object yang equals() true tetapi instance-nya berbeda."
```

Jika tidak bisa, jangan gunakan.

---

## 21. `WeakHashMap`: Key yang Tidak Menahan Object Tetap Hidup

`WeakHashMap<K, V>` menyimpan key melalui weak reference.

Normal `HashMap`:

```text
map -> key
```

Reference dari map ke key adalah strong. Selama entry ada di map, key tidak bisa di-GC.

`WeakHashMap`:

```text
map -> weak reference -> key
```

Jika key tidak lagi strongly reachable dari tempat lain, GC boleh membersihkannya, lalu entry dapat hilang dari map.

Contoh mental model:

```java
Map<Object, String> map = new WeakHashMap<>();
Object key = new Object();

map.put(key, "metadata");

key = null;

// setelah GC suatu saat, entry dapat hilang
```

Perhatikan kata **dapat** dan **suatu saat**. GC tidak deterministic.

---

## 22. `WeakHashMap` Bukan General Purpose Cache

Ini sangat penting.

Banyak orang berpikir:

```text
WeakHashMap = cache yang otomatis bersih
```

Ini terlalu sederhana dan sering salah.

Masalah:

1. Entry hilang berdasarkan reachability key, bukan berdasarkan memory pressure secara meaningful bagi aplikasi.
2. GC timing tidak deterministic.
3. Value tetap strong reference.
4. Jika value mereferensikan key, key bisa tetap hidup.
5. Tidak ada TTL.
6. Tidak ada size limit meaningful.
7. Tidak ada eviction policy seperti LRU/LFU.
8. Tidak thread-safe.

Bug besar:

```java
Map<Key, Value> map = new WeakHashMap<>();

final class Value {
    private final Key key;

    Value(Key key) {
        this.key = key;
    }
}
```

Reference graph:

```text
WeakHashMap -> value strong -> key strong
WeakHashMap -> weak key -> key
```

Karena value menahan key secara strong, key tidak eligible untuk GC. Entry tidak hilang seperti yang diharapkan.

---

## 23. Use Case Tepat `WeakHashMap`

`WeakHashMap` cocok untuk association tambahan yang lifecycle-nya mengikuti key.

Contoh:

```text
Selama object X hidup di tempat lain,
saya ingin menyimpan metadata untuk X.
Saat X tidak lagi dipakai,
metadata boleh hilang otomatis.
```

Use case:

1. Metadata untuk object eksternal yang tidak kamu miliki lifecycle-nya.
2. Canonical side table.
3. Listener/adapter metadata dengan hati-hati.
4. Framework-level association.
5. Classloader-sensitive metadata jika didesain benar.

Contoh:

```java
final class MetadataRegistry {
    private final Map<Object, Metadata> metadataByOwner = new WeakHashMap<>();

    synchronized Metadata metadataFor(Object owner) {
        return metadataByOwner.computeIfAbsent(owner, ignored -> new Metadata());
    }
}

final class Metadata {
    private long lastAccessNanos;

    void touch() {
        lastAccessNanos = System.nanoTime();
    }
}
```

Catatan:

1. Method dibuat synchronized karena `WeakHashMap` tidak thread-safe.
2. `Metadata` tidak boleh menyimpan strong reference balik ke `owner`.
3. Jangan mengandalkan kapan entry hilang.

---

## 24. `WeakHashMap` dan String Key Trap

Contoh berbahaya:

```java
Map<String, String> map = new WeakHashMap<>();
map.put("USER:1", "Alice");
```

String literal biasanya interned dan strongly reachable dari string pool/class metadata. Entry mungkin tidak hilang.

Jangan gunakan `WeakHashMap<String, ...>` untuk cache biasa.

Jika kamu butuh cache string-keyed:

1. Gunakan bounded cache.
2. Gunakan TTL.
3. Gunakan explicit invalidation.
4. Gunakan library cache.

---

## 25. Comparison Matrix

| Requirement | Struktur kandidat |
|---|---|
| lookup by logical key | `HashMap` |
| unique membership by logical equality | `HashSet` |
| preserve insertion order | `LinkedHashMap` / `LinkedHashSet` |
| simple LRU order | `LinkedHashMap` access-order |
| sorted key/range query | `TreeMap` / `NavigableMap` |
| enum key | `EnumMap` |
| enum set | `EnumSet` |
| identity-based metadata | `IdentityHashMap` |
| lifecycle-bound weak key association | `WeakHashMap` |
| concurrent mutation | `ConcurrentHashMap` |
| immutable small map/set | `Map.of`, `Set.of` |

Walau `TreeMap`, `EnumMap`, `ConcurrentHashMap`, dan immutable factories bukan fokus utama part ini, mereka penting sebagai pembanding.

---

## 26. Practical Selection Guide

### 26.1 Pilih `HashMap` jika:

1. Butuh key-value lookup.
2. Logical equality adalah semantics yang benar.
3. Order tidak penting.
4. Tidak butuh range query.
5. Tidak ada concurrent mutation tanpa proteksi.

Contoh:

```java
Map<CaseId, CaseSnapshot> caseById = new HashMap<>();
```

### 26.2 Pilih `HashSet` jika:

1. Butuh membership.
2. Butuh dedup.
3. Tidak butuh value.
4. Order tidak penting.

Contoh:

```java
Set<DocumentHash> seenDocuments = new HashSet<>();
```

### 26.3 Pilih `LinkedHashMap` jika:

1. Butuh lookup.
2. Butuh deterministic iteration order.
3. Insertion order atau access order adalah requirement.

Contoh:

```java
Map<FieldName, ValidationError> errorsByField = new LinkedHashMap<>();
```

### 26.4 Pilih `IdentityHashMap` jika:

1. Object identity adalah semantics utama.
2. Kamu membangun object graph traversal, identity table, atau side metadata per instance.

Contoh:

```java
Map<Object, Integer> objectIds = new IdentityHashMap<>();
```

### 26.5 Pilih `WeakHashMap` jika:

1. Key dimiliki oleh pihak lain.
2. Metadata harus hilang ketika key tidak lagi hidup.
3. GC-driven cleanup memang acceptable.
4. Value tidak mereferensikan key.

Contoh:

```java
Map<Object, Metadata> metadata = new WeakHashMap<>();
```

---

## 27. API Methods yang Harus Dikuasai

### 27.1 `getOrDefault`

```java
int count = counts.getOrDefault(status, 0);
```

Bagus untuk read default. Tapi tidak menyimpan default ke map.

### 27.2 `putIfAbsent`

```java
User existing = users.putIfAbsent(user.id(), user);
if (existing != null) {
    throw new IllegalArgumentException("Duplicate user: " + user.id());
}
```

Bagus untuk enforce uniqueness.

### 27.3 `computeIfAbsent`

```java
List<Event> events = eventsByCase.computeIfAbsent(caseId, ignored -> new ArrayList<>());
events.add(event);
```

Pattern grouping.

Hati-hati:

1. Mapping function jangan punya side effect berat.
2. Jangan melakukan recursive mutation ke map yang sama secara sembarangan.
3. Untuk concurrent map, semantics-nya berbeda dan perlu dipahami terpisah.

### 27.4 `merge`

```java
counts.merge(status, 1, Integer::sum);
```

Bagus untuk counting.

### 27.5 `compute`

```java
counts.compute(status, (key, oldValue) -> oldValue == null ? 1 : oldValue + 1);
```

Lebih general, tetapi lebih mudah disalahgunakan.

### 27.6 `replaceAll`

```java
scores.replaceAll((userId, score) -> Math.min(score, 100));
```

### 27.7 `entrySet` untuk Iterasi Efisien

Buruk:

```java
for (CaseId id : cases.keySet()) {
    CaseSnapshot snapshot = cases.get(id);
    process(id, snapshot);
}
```

Lebih baik:

```java
for (Map.Entry<CaseId, CaseSnapshot> entry : cases.entrySet()) {
    process(entry.getKey(), entry.getValue());
}
```

---

## 28. Grouping Pattern dengan Map

Contoh: group cases by status.

```java
Map<CaseStatus, List<CaseSnapshot>> byStatus = new EnumMap<>(CaseStatus.class);

for (CaseSnapshot snapshot : cases) {
    byStatus.computeIfAbsent(snapshot.status(), ignored -> new ArrayList<>())
            .add(snapshot);
}
```

Karena key adalah enum, `EnumMap` lebih tepat daripada `HashMap`. Namun mental model grouping tetap sama.

Jika tidak ingin mutable list bocor:

```java
Map<CaseStatus, List<CaseSnapshot>> immutableByStatus = new EnumMap<>(CaseStatus.class);

for (Map.Entry<CaseStatus, List<CaseSnapshot>> entry : byStatus.entrySet()) {
    immutableByStatus.put(entry.getKey(), List.copyOf(entry.getValue()));
}

immutableByStatus = Collections.unmodifiableMap(immutableByStatus);
```

Atau desain builder khusus.

---

## 29. Index Building Pattern

Salah satu pattern paling penting dalam DSA production adalah membangun index.

Contoh:

```java
static Map<CaseId, CaseSnapshot> indexById(Collection<CaseSnapshot> cases) {
    Map<CaseId, CaseSnapshot> index = new HashMap<>(capacityForExpectedSize(cases.size()));

    for (CaseSnapshot snapshot : cases) {
        CaseSnapshot previous = index.put(snapshot.id(), snapshot);
        if (previous != null) {
            throw new IllegalArgumentException("Duplicate case id: " + snapshot.id());
        }
    }

    return Map.copyOf(index);
}
```

Kenapa ini bagus?

1. Initial capacity direncanakan.
2. Duplicate dideteksi.
3. Output immutable.
4. Nama method menyatakan index semantics.
5. Invariant dibangun sekali di boundary.

Data structure yang baik sering dibangun di boundary, lalu dibaca berkali-kali secara aman.

---

## 30. Multi-Index Pattern

Satu collection sering tidak cukup untuk semua operasi.

Misal sistem case butuh:

1. Lookup by ID.
2. Query by status.
3. Query by owner.
4. Query by deadline.

Jangan memaksa satu list dan scan terus.

```java
final class CaseIndex {
    private final Map<CaseId, CaseSnapshot> byId;
    private final Map<CaseStatus, List<CaseSnapshot>> byStatus;
    private final Map<UserId, List<CaseSnapshot>> byOwner;

    CaseIndex(Collection<CaseSnapshot> cases) {
        Map<CaseId, CaseSnapshot> idIndex = new HashMap<>(capacityForExpectedSize(cases.size()));
        Map<CaseStatus, List<CaseSnapshot>> statusIndex = new EnumMap<>(CaseStatus.class);
        Map<UserId, List<CaseSnapshot>> ownerIndex = new HashMap<>();

        for (CaseSnapshot c : cases) {
            CaseSnapshot previous = idIndex.put(c.id(), c);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate case id: " + c.id());
            }

            statusIndex.computeIfAbsent(c.status(), ignored -> new ArrayList<>()).add(c);
            ownerIndex.computeIfAbsent(c.ownerId(), ignored -> new ArrayList<>()).add(c);
        }

        this.byId = Map.copyOf(idIndex);
        this.byStatus = freeze(statusIndex);
        this.byOwner = freeze(ownerIndex);
    }

    CaseSnapshot get(CaseId id) {
        return byId.get(id);
    }

    List<CaseSnapshot> byStatus(CaseStatus status) {
        return byStatus.getOrDefault(status, List.of());
    }

    List<CaseSnapshot> byOwner(UserId ownerId) {
        return byOwner.getOrDefault(ownerId, List.of());
    }

    private static <K, V> Map<K, List<V>> freeze(Map<K, List<V>> input) {
        Map<K, List<V>> copy = new HashMap<>(capacityForExpectedSize(input.size()));
        for (Map.Entry<K, List<V>> entry : input.entrySet()) {
            copy.put(entry.getKey(), List.copyOf(entry.getValue()));
        }
        return Map.copyOf(copy);
    }

    private static int capacityForExpectedSize(int expectedSize) {
        if (expectedSize < 3) {
            return expectedSize + 1;
        }
        return (int) Math.ceil(expectedSize / 0.75d);
    }
}

record CaseId(String value) {}
record UserId(String value) {}
enum CaseStatus { OPEN, PENDING, CLOSED }
record CaseSnapshot(CaseId id, CaseStatus status, UserId ownerId) {}
```

Trade-off multi-index:

| Benefit | Cost |
|---|---|
| Query cepat | memory lebih besar |
| Invariant eksplisit | update lebih kompleks |
| Cocok untuk read-heavy snapshot | write-heavy butuh strategi sinkronisasi |
| Menghindari repeated scan | risiko index inconsistency jika mutable |

Untuk read-heavy config/rule/snapshot, multi-index sangat powerful.

Untuk write-heavy mutable state, kamu butuh desain update atomic atau rebuild snapshot.

---

## 31. Memory Retention Failure

Map adalah salah satu sumber memory leak paling umum.

Contoh:

```java
private final Map<String, SessionData> sessions = new HashMap<>();
```

Jika entry tidak pernah dihapus, map tumbuh tanpa batas.

Leak pattern:

1. Key terus bertambah.
2. Value mereferensikan object graph besar.
3. Map global/static/singleton.
4. Tidak ada eviction/invalidation.
5. Traffic normal dianggap aman sampai memory naik perlahan.

Contoh buruk:

```java
final class RequestTracker {
    private static final Map<String, RequestContext> contexts = new HashMap<>();

    static void register(String correlationId, RequestContext context) {
        contexts.put(correlationId, context);
    }
}
```

Jika tidak ada `remove`, ini leak.

Lebih aman:

```java
final class RequestTracker {
    private final Map<String, RequestContext> contexts = new HashMap<>();

    void withContext(String correlationId, RequestContext context, Runnable action) {
        contexts.put(correlationId, context);
        try {
            action.run();
        } finally {
            contexts.remove(correlationId);
        }
    }
}
```

Namun untuk concurrent request, ini juga perlu thread-safety dan isolation. Intinya: map ownership dan cleanup harus jelas.

---

## 32. Static Map: Useful or Dangerous?

Static map bisa valid untuk immutable registry:

```java
private static final Map<String, CaseStatus> STATUS_BY_CODE = Map.of(
    "O", CaseStatus.OPEN,
    "P", CaseStatus.PENDING,
    "C", CaseStatus.CLOSED
);
```

Berbahaya untuk mutable cache:

```java
private static final Map<String, Object> CACHE = new HashMap<>();
```

Pertanyaan wajib untuk static map:

1. Apakah isinya immutable?
2. Apakah jumlah key bounded?
3. Siapa yang membersihkan?
4. Apakah classloader lifecycle relevan?
5. Apakah thread-safe?
6. Apakah value menyimpan resource?

Jika jawabannya tidak jelas, static mutable map adalah red flag.

---

## 33. Thread-Safety Warning

`HashMap`, `HashSet`, `LinkedHashMap`, `IdentityHashMap`, dan `WeakHashMap` tidak thread-safe untuk concurrent mutation.

Buruk:

```java
Map<String, Integer> counts = new HashMap<>();

// multiple threads
counts.merge(status, 1, Integer::sum);
```

Ini data race.

Pilihan:

1. Confine map ke satu thread.
2. Build immutable map lalu publish.
3. Gunakan lock.
4. Gunakan `ConcurrentHashMap`.
5. Gunakan message passing/queue.
6. Gunakan snapshot rebuild.

Contoh immutable snapshot:

```java
final class RuleStore {
    private volatile Map<RuleCode, Rule> current = Map.of();

    Rule get(RuleCode code) {
        return current.get(code);
    }

    void replaceAll(Collection<Rule> rules) {
        Map<RuleCode, Rule> next = new HashMap<>();
        for (Rule rule : rules) {
            Rule previous = next.put(rule.code(), rule);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate rule: " + rule.code());
            }
        }
        current = Map.copyOf(next);
    }
}

record RuleCode(String value) {}
record Rule(RuleCode code) {}
```

Read path tidak butuh lock. Write path membangun snapshot baru.

---

## 34. Fail-Fast Iteration

Iterator collection biasa umumnya fail-fast secara best-effort ketika collection dimodifikasi secara struktural di luar iterator.

Contoh:

```java
Map<String, Integer> map = new HashMap<>();
map.put("A", 1);
map.put("B", 2);

for (String key : map.keySet()) {
    if (key.equals("A")) {
        map.remove(key); // ConcurrentModificationException
    }
}
```

Cara benar:

```java
Iterator<Map.Entry<String, Integer>> iterator = map.entrySet().iterator();
while (iterator.hasNext()) {
    Map.Entry<String, Integer> entry = iterator.next();
    if (entry.getKey().equals("A")) {
        iterator.remove();
    }
}
```

Atau:

```java
map.entrySet().removeIf(entry -> entry.getKey().equals("A"));
```

Jangan mengandalkan `ConcurrentModificationException` sebagai correctness mechanism. Ia adalah bug detector, bukan synchronization guarantee.

---

## 35. Views: `keySet`, `values`, `entrySet`

`Map` views biasanya backed by map.

```java
Map<String, Integer> map = new HashMap<>();
map.put("A", 1);
map.put("B", 2);

Set<String> keys = map.keySet();
keys.remove("A");

System.out.println(map.containsKey("A")); // false
```

Ini berguna, tetapi bisa mengejutkan.

Guideline:

1. Jangan expose live view dari internal mutable map.
2. Gunakan copy jika keluar dari boundary.
3. Dokumentasikan jika view memang live.

Buruk:

```java
class Registry {
    private final Map<String, Rule> rules = new HashMap<>();

    Set<String> ruleCodes() {
        return rules.keySet(); // caller bisa remove
    }
}
```

Lebih aman:

```java
class Registry {
    private final Map<String, Rule> rules = new HashMap<>();

    Set<String> ruleCodes() {
        return Set.copyOf(rules.keySet());
    }
}
```

Atau jika butuh stable order:

```java
List<String> ruleCodesInOrder() {
    return List.copyOf(rules.keySet());
}
```

---

## 36. `Map.copyOf`, `Map.of`, dan Immutability Boundary

`Map.of` cocok untuk small fixed maps:

```java
Map<String, Integer> priorities = Map.of(
    "HIGH", 3,
    "MEDIUM", 2,
    "LOW", 1
);
```

`Map.copyOf` cocok untuk freeze hasil build:

```java
Map<String, Rule> mutable = new HashMap<>();
// build
Map<String, Rule> immutable = Map.copyOf(mutable);
```

Catatan:

1. Immutable map tidak berarti key/value object immutable.
2. Struktur map tidak bisa diubah, tetapi object value masih bisa mutable.
3. `Map.of` dan `Map.copyOf` tidak menerima null key/value.

Contoh shallow immutability:

```java
Map<String, List<String>> map = Map.of(
    "A", new ArrayList<>(List.of("x"))
);

map.get("A").add("y"); // map structure immutable, value list mutable
```

Lebih aman:

```java
Map<String, List<String>> map = Map.of(
    "A", List.copyOf(List.of("x"))
);
```

---

## 37. Designing Map Values

Value dalam map sebaiknya bukan `Object`, bukan loose `Map<String, Object>`, dan bukan parallel mutable container tanpa invariant.

Buruk:

```java
Map<String, Object> userData = new HashMap<>();
userData.put("name", "Alice");
userData.put("age", 30);
```

Lebih baik:

```java
record UserProfile(String name, int age) {}
Map<UserId, UserProfile> profilesByUserId = new HashMap<>();
```

Jika value punya lifecycle:

```java
record CachedValue<V>(
    V value,
    long loadedAtNanos,
    long expiresAtNanos
) {
    boolean isExpired(long nowNanos) {
        return nowNanos >= expiresAtNanos;
    }
}
```

Map menjadi:

```java
Map<CacheKey, CachedValue<Response>> cache;
```

Semantics lebih eksplisit daripada:

```java
Map<String, Object> cache;
```

---

## 38. Production Pattern: Deduplicate While Preserving Order

Requirement:

```text
Terima list user IDs dari request.
Hilangkan duplicate.
Tetap pertahankan urutan pertama kali muncul.
```

Solusi:

```java
static List<UserId> deduplicatePreservingOrder(List<UserId> input) {
    return List.copyOf(new LinkedHashSet<>(input));
}
```

Jika butuh validasi duplicate:

```java
static List<UserId> validateUniquePreservingOrder(List<UserId> input) {
    Set<UserId> seen = new HashSet<>(capacityForExpectedSize(input.size()));
    List<UserId> result = new ArrayList<>(input.size());

    for (UserId id : input) {
        if (!seen.add(id)) {
            throw new IllegalArgumentException("Duplicate user id: " + id);
        }
        result.add(id);
    }

    return List.copyOf(result);
}
```

Gunakan `LinkedHashSet` jika duplicate boleh dihapus. Gunakan explicit loop jika duplicate adalah error.

---

## 39. Production Pattern: Counting Frequency

```java
static Map<String, Integer> frequency(List<String> values) {
    Map<String, Integer> counts = new HashMap<>();
    for (String value : values) {
        counts.merge(value, 1, Integer::sum);
    }
    return Map.copyOf(counts);
}
```

Untuk high-volume primitive counts, `Integer` boxing bisa menjadi overhead. Nanti di part performance, kita bahas primitive-specialized structures.

Untuk enum key:

```java
static Map<CaseStatus, Integer> countByStatus(List<CaseSnapshot> cases) {
    Map<CaseStatus, Integer> counts = new EnumMap<>(CaseStatus.class);
    for (CaseSnapshot c : cases) {
        counts.merge(c.status(), 1, Integer::sum);
    }
    return Collections.unmodifiableMap(counts);
}
```

---

## 40. Production Pattern: Detect Conflicting Mapping

Requirement:

```text
Setiap external ID harus map ke tepat satu internal ID.
Jika external ID yang sama muncul dengan internal ID berbeda, itu conflict.
```

```java
static Map<ExternalId, InternalId> buildMapping(List<Pair> pairs) {
    Map<ExternalId, InternalId> map = new HashMap<>(capacityForExpectedSize(pairs.size()));

    for (Pair pair : pairs) {
        InternalId previous = map.putIfAbsent(pair.externalId(), pair.internalId());
        if (previous != null && !previous.equals(pair.internalId())) {
            throw new IllegalArgumentException(
                "Conflicting mapping for " + pair.externalId()
                    + ": " + previous + " vs " + pair.internalId()
            );
        }
    }

    return Map.copyOf(map);
}

record ExternalId(String value) {}
record InternalId(String value) {}
record Pair(ExternalId externalId, InternalId internalId) {}
```

Ini contoh map sebagai invariant enforcement.

---

## 41. Production Pattern: First Error Per Field

Requirement:

```text
Validasi form.
Simpan error pertama per field.
Pertahankan urutan field sesuai input.
```

```java
final class ValidationErrors {
    private final Map<String, String> firstErrorByField = new LinkedHashMap<>();

    void addError(String field, String message) {
        firstErrorByField.putIfAbsent(field, message);
    }

    Map<String, String> asMap() {
        return Map.copyOf(firstErrorByField);
    }

    boolean hasErrors() {
        return !firstErrorByField.isEmpty();
    }
}
```

Kenapa `LinkedHashMap`?

1. Lookup per field cepat.
2. Error pertama per field dipertahankan.
3. Output deterministic.
4. Cocok untuk UI/API response.

---

## 42. Production Pattern: Access-Order Local Cache

```java
final class LocalLruMemoizer<K, V> {
    private final Map<K, V> cache;
    private final Function<K, V> loader;

    LocalLruMemoizer(int maxEntries, Function<K, V> loader) {
        if (maxEntries <= 0) {
            throw new IllegalArgumentException("maxEntries must be positive");
        }
        this.loader = Objects.requireNonNull(loader, "loader");
        this.cache = new LinkedHashMap<K, V>(capacityForExpectedSize(maxEntries), 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > maxEntries;
            }
        };
    }

    synchronized V get(K key) {
        V value = cache.get(key);
        if (value != null || cache.containsKey(key)) {
            return value;
        }
        V loaded = loader.apply(key);
        cache.put(key, loaded);
        return loaded;
    }

    private static int capacityForExpectedSize(int expectedSize) {
        if (expectedSize < 3) {
            return expectedSize + 1;
        }
        return (int) Math.ceil(expectedSize / 0.75d) + 1;
    }
}
```

Catatan:

1. `synchronized` membuatnya aman sederhana, tetapi bukan scalable untuk high concurrency.
2. Mengizinkan null value dengan `containsKey` check.
3. Tidak ada TTL.
4. Tidak ada stampede control antar thread selain lock global.
5. Cocok sebagai local helper, bukan distributed production cache.

---

## 43. Decision Checklist

Sebelum memilih map/set, jawab:

### 43.1 Equality

```text
Apakah key dibandingkan dengan equals/hashCode, identity, enum ordinal, sorted comparator, atau custom normalization?
```

### 43.2 Mutability

```text
Apakah field yang menentukan equality/hash bisa berubah setelah masuk map/set?
```

Jika ya, desain ulang.

### 43.3 Order

```text
Apakah iteration order memengaruhi correctness, test, response, report, atau user experience?
```

Jika ya, jangan pakai plain `HashMap` untuk order-sensitive logic.

### 43.4 Lifecycle

```text
Siapa yang memiliki key dan value?
Kapan entry dihapus?
Apakah map bisa tumbuh tanpa batas?
```

### 43.5 Concurrency

```text
Apakah ada concurrent read/write?
Apakah map immutable snapshot, lock-protected, atau concurrent collection?
```

### 43.6 Size

```text
Berapa expected size?
Apakah perlu initial capacity?
Apakah memory overhead acceptable?
```

### 43.7 Operation Mix

```text
Dominan get, put, remove, iteration, grouping, rebuild, atau range query?
```

### 43.8 Failure Behavior

```text
Apa yang terjadi jika duplicate key muncul?
Replace silently, reject, merge, atau collect conflict?
```

---

## 44. Anti-Patterns

### 44.1 Silent Replacement

```java
map.put(user.id(), user);
```

Jika duplicate adalah bug, jangan silent replace.

Lebih baik:

```java
User previous = map.put(user.id(), user);
if (previous != null) {
    throw new IllegalArgumentException("Duplicate user: " + user.id());
}
```

### 44.2 `containsKey` lalu `put` untuk uniqueness

```java
if (!map.containsKey(key)) {
    map.put(key, value);
}
```

Lebih baik:

```java
map.putIfAbsent(key, value);
```

Atau jika perlu conflict handling:

```java
Value previous = map.putIfAbsent(key, value);
if (previous != null) {
    handleDuplicate(previous, value);
}
```

### 44.3 `List.contains` dalam Loop Besar

Buruk:

```java
for (User user : users) {
    if (allowedUserIds.contains(user.id())) {
        result.add(user);
    }
}
```

Jika `allowedUserIds` adalah list besar, ini `O(n*m)`.

Lebih baik:

```java
Set<UserId> allowed = new HashSet<>(allowedUserIds);
for (User user : users) {
    if (allowed.contains(user.id())) {
        result.add(user);
    }
}
```

### 44.4 Exposing Mutable Map

Buruk:

```java
Map<CaseId, CaseSnapshot> cases() {
    return casesById;
}
```

Lebih baik:

```java
Map<CaseId, CaseSnapshot> cases() {
    return Map.copyOf(casesById);
}
```

Atau return immutable internal jika sudah immutable.

### 44.5 Using `WeakHashMap` as Cache

Buruk:

```java
Map<String, Response> cache = new WeakHashMap<>();
```

Lebih baik gunakan bounded/TTL cache yang eksplisit.

### 44.6 Relying on `HashMap` Order

Buruk:

```java
return new ArrayList<>(map.values()); // assumed deterministic business order
```

Lebih baik explicit order.

### 44.7 Mutable Key

Sudah dibahas. Ini salah satu bug paling fatal.

---

## 45. Testing Strategy untuk Map/Set-Based Logic

Test yang baik bukan hanya happy path.

### 45.1 Duplicate Key Test

```java
@Test
void rejectsDuplicateCaseId() {
    CaseId id = new CaseId("C1");
    List<CaseSnapshot> cases = List.of(
        new CaseSnapshot(id, CaseStatus.OPEN, new UserId("U1")),
        new CaseSnapshot(id, CaseStatus.CLOSED, new UserId("U2"))
    );

    assertThrows(IllegalArgumentException.class, () -> new CaseIndex(cases));
}
```

### 45.2 Order Test

Jika order adalah requirement, test order.

```java
@Test
void preservesFirstSeenOrderWhenDeduplicating() {
    List<UserId> input = List.of(
        new UserId("U2"),
        new UserId("U1"),
        new UserId("U2")
    );

    List<UserId> result = deduplicatePreservingOrder(input);

    assertEquals(List.of(new UserId("U2"), new UserId("U1")), result);
}
```

### 45.3 Null Behavior Test

Jika null tidak boleh:

```java
@Test
void rejectsNullKey() {
    assertThrows(NullPointerException.class, () -> new UserId(null));
}
```

### 45.4 Mutation Safety Test

Jika API mengembalikan collection, pastikan caller tidak bisa mutate internal state.

```java
@Test
void returnedMapCannotMutateRegistry() {
    Registry registry = new Registry();
    Map<String, Rule> rules = registry.rules();

    assertThrows(UnsupportedOperationException.class,
        () -> rules.put("X", new Rule(new RuleCode("X"))));
}
```

### 45.5 Collision-Resilience Test

Untuk logic yang harus tetap benar walau hash collision terjadi:

```java
record BadHashKey(String value) {
    @Override
    public int hashCode() {
        return 1;
    }
}

@Test
void worksDespiteHashCollisions() {
    Map<BadHashKey, String> map = new HashMap<>();
    map.put(new BadHashKey("A"), "alpha");
    map.put(new BadHashKey("B"), "bravo");

    assertEquals("alpha", map.get(new BadHashKey("A")));
    assertEquals("bravo", map.get(new BadHashKey("B")));
}
```

Tujuannya bukan mengetes `HashMap`, tetapi mengetes key equality benar.

---

## 46. Mini Case Study: Rule Registry

### 46.1 Requirement

Kita punya rules:

1. Setiap rule punya code unik.
2. Rule dievaluasi berdasarkan priority ascending.
3. API perlu lookup by code.
4. Output diagnostic harus deterministic.
5. Setelah registry dibuat, rule tidak boleh berubah.

### 46.2 Desain Buruk

```java
List<Rule> rules;

Rule find(String code) {
    return rules.stream()
        .filter(r -> r.code().equals(code))
        .findFirst()
        .orElse(null);
}
```

Masalah:

1. Lookup `O(n)`.
2. Duplicate code mungkin tidak terdeteksi.
3. Order tergantung input tanpa validasi.
4. Mutability list tidak jelas.

### 46.3 Desain Lebih Baik

```java
public final class RuleRegistry {
    private final Map<RuleCode, Rule> byCode;
    private final List<Rule> byEvaluationOrder;

    public RuleRegistry(Collection<Rule> rules) {
        Objects.requireNonNull(rules, "rules");

        List<Rule> ordered = new ArrayList<>(rules);
        ordered.sort(
            Comparator.comparingInt(Rule::priority)
                      .thenComparing(rule -> rule.code().value())
        );

        Map<RuleCode, Rule> map = new LinkedHashMap<>(capacityForExpectedSize(ordered.size()));
        for (Rule rule : ordered) {
            Rule previous = map.put(rule.code(), rule);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate rule code: " + rule.code());
            }
        }

        this.byCode = Map.copyOf(map);
        this.byEvaluationOrder = List.copyOf(ordered);
    }

    public Rule get(RuleCode code) {
        return byCode.get(code);
    }

    public List<Rule> evaluationOrder() {
        return byEvaluationOrder;
    }

    private static int capacityForExpectedSize(int expectedSize) {
        if (expectedSize < 3) {
            return expectedSize + 1;
        }
        return (int) Math.ceil(expectedSize / 0.75d);
    }
}

public record RuleCode(String value) {
    public RuleCode {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("RuleCode must not be blank");
        }
    }
}

public record Rule(RuleCode code, int priority) {}
```

### 46.4 Kenapa Ini Bagus?

1. `Map` untuk lookup by code.
2. `List` untuk evaluation order.
3. Duplicate ditolak.
4. Ordering deterministic.
5. Snapshot immutable.
6. Invariant ada di constructor.
7. Struktur data mencerminkan operasi.

Ini adalah contoh cara berpikir DSA sebagai desain, bukan sekadar API usage.

---

## 47. Mini Case Study: Identity-Based Deep Copy

Requirement:

```text
Deep copy object graph.
Jika object yang sama muncul dari beberapa path,
hasil copy harus mempertahankan sharing yang sama.
```

Kenapa `IdentityHashMap`?

Karena kita harus tahu apakah instance yang sama sudah dicopy, bukan apakah object lain `equals`.

Skeleton:

```java
final class DeepCopier {
    private final Map<Object, Object> copies = new IdentityHashMap<>();

    @SuppressWarnings("unchecked")
    <T> T copy(T source) {
        if (source == null) {
            return null;
        }

        Object existing = copies.get(source);
        if (existing != null) {
            return (T) existing;
        }

        Object target = allocateCopyShell(source);
        copies.put(source, target);

        copyFields(source, target);
        return (T) target;
    }

    private Object allocateCopyShell(Object source) {
        // simplified placeholder
        throw new UnsupportedOperationException("allocate copy shell");
    }

    private void copyFields(Object source, Object target) {
        // simplified placeholder
        throw new UnsupportedOperationException("copy fields");
    }
}
```

Jika memakai `HashMap`, dua object berbeda tetapi `equals` bisa dianggap sama, sehingga graph copy salah.

---

## 48. Mini Case Study: Weak Metadata Registry

Requirement:

```text
Framework ingin menyimpan metadata untuk object milik user.
Framework tidak boleh membuat object user tetap hidup hanya karena metadata registry.
```

Solusi:

```java
public final class WeakMetadataRegistry {
    private final Map<Object, Metadata> metadataByOwner = new WeakHashMap<>();

    public synchronized Metadata metadataFor(Object owner) {
        Objects.requireNonNull(owner, "owner");
        return metadataByOwner.computeIfAbsent(owner, ignored -> new Metadata());
    }

    public synchronized int approximateSize() {
        return metadataByOwner.size();
    }
}

public final class Metadata {
    private final Map<String, Object> attributes = new HashMap<>();

    public void put(String name, Object value) {
        attributes.put(name, value);
    }

    public Object get(String name) {
        return attributes.get(name);
    }
}
```

Design rules:

1. `Metadata` jangan menyimpan `owner`.
2. Jangan mengandalkan size sebagai exact lifecycle count.
3. Synchronize jika diakses multi-thread.
4. Jangan gunakan untuk cache response biasa.

---

## 49. Engineering Heuristics

### 49.1 Default yang Sehat

```text
HashMap untuk lookup.
HashSet untuk membership.
LinkedHashMap jika order observable.
IdentityHashMap jika object identity adalah requirement.
WeakHashMap jika lifecycle key harus weak.
```

### 49.2 Jangan Optimasi Terlalu Awal, Tapi Desain Semantics dari Awal

Tidak perlu langsung primitive map custom untuk semua kasus. Tetapi jangan salah semantics.

Salah semantics lebih mahal daripada constant factor buruk.

Contoh:

1. `HashMap` untuk rule order-sensitive adalah salah semantics.
2. `IdentityHashMap` untuk user ID adalah salah semantics.
3. `WeakHashMap` untuk TTL cache adalah salah semantics.
4. Mutable key adalah invariant violation.

### 49.3 Map Harus Punya Owner

Tentukan:

1. Siapa membuat map?
2. Siapa boleh mutate?
3. Siapa membaca?
4. Kapan map dibersihkan?
5. Apakah map snapshot atau live state?
6. Apakah map boleh keluar dari class?

### 49.4 Duplicate Harus Disengaja

Saat `put` key existing:

1. Replace?
2. Reject?
3. Merge?
4. Ignore first?
5. Keep first?
6. Keep latest?

Jangan biarkan default `put` silently replace jika duplicate adalah domain error.

---

## 50. Latihan

### Latihan 1 — Build Index

Diberikan:

```java
record Employee(EmployeeId id, DepartmentId departmentId, String name) {}
record EmployeeId(String value) {}
record DepartmentId(String value) {}
```

Bangun:

1. `Map<EmployeeId, Employee> byId`
2. `Map<DepartmentId, List<Employee>> byDepartment`
3. Duplicate employee ID harus error.
4. Output immutable.

Pertanyaan:

1. Struktur apa yang kamu pilih?
2. Bagaimana memastikan caller tidak bisa mutate list internal?
3. Bagaimana jika department order harus sesuai urutan pertama muncul?

### Latihan 2 — Validate Rule Codes

Diberikan list rule code dari config.

Requirement:

1. Duplicate harus error.
2. Urutan error mengikuti urutan input.
3. Blank code harus error.

Desain struktur data dan implementasi.

### Latihan 3 — Simple LRU

Implementasikan LRU cache dengan `LinkedHashMap`.

Requirement:

1. Max entries.
2. Access memperbarui recency.
3. Thread-safe sederhana dengan `synchronized`.
4. Tidak menerima null key.
5. Jelaskan kenapa ini bukan cache production lengkap.

### Latihan 4 — Identity Visited Set

Buat traversal untuk node object graph.

Requirement:

1. Dua node yang `equals` true tetapi instance berbeda tetap dianggap berbeda.
2. Traversal harus cycle-safe.
3. Gunakan `Collections.newSetFromMap(new IdentityHashMap<>())`.

### Latihan 5 — Weak Metadata

Buat registry metadata dengan `WeakHashMap`.

Requirement:

1. Metadata tidak boleh mereferensikan owner.
2. Access synchronized.
3. Dokumentasikan bahwa cleanup tergantung GC.

---

## 51. Checklist Review Code

Saat review code yang memakai `Map`/`Set`, tanyakan:

```text
[ ] Apakah key type domain-specific atau raw String/Object tanpa alasan?
[ ] Apakah key immutable terhadap equals/hashCode?
[ ] Apakah duplicate behavior eksplisit?
[ ] Apakah iteration order diperlukan tetapi tidak dijamin?
[ ] Apakah map bisa tumbuh tanpa batas?
[ ] Apakah null key/value punya semantics jelas?
[ ] Apakah internal mutable map diekspos?
[ ] Apakah concurrent access aman?
[ ] Apakah initial capacity perlu direncanakan?
[ ] Apakah value mereferensikan key dalam WeakHashMap?
[ ] Apakah IdentityHashMap benar-benar butuh identity semantics?
[ ] Apakah LinkedHashMap dipakai karena order requirement, bukan cosmetic?
```

---

## 52. Ringkasan

1. `HashMap` adalah default map untuk logical key lookup, tetapi tidak menjamin order dan tidak thread-safe untuk concurrent mutation.
2. `HashSet` adalah struktur membership/dedup berbasis equality.
3. `LinkedHashMap` menambah deterministic encounter order dan bisa memakai access order untuk LRU sederhana.
4. `IdentityHashMap` memakai `==`, bukan `equals`, sehingga cocok untuk object graph identity table, bukan domain lookup normal.
5. `WeakHashMap` memakai weak key dan cocok untuk lifecycle-bound metadata, bukan cache umum.
6. Initial capacity dan load factor memengaruhi resize, memory, collision, dan iteration cost.
7. Mutable key adalah salah satu failure mode paling berbahaya dalam hash-based collection.
8. Jangan mengandalkan `HashMap` iteration order.
9. Jangan expose mutable internal collection.
10. Map/set yang baik merepresentasikan invariant domain dan operation mix, bukan sekadar tempat menyimpan data.

---

## 53. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
learn-java-dsa-part-008 — Ordering, Sorting, Comparator, Comparable
```

Kenapa setelah hash-based map/set kita masuk ordering?

Karena banyak bug DSA Java muncul dari salah memahami dua bentuk identity/ordering:

1. Hash equality: `equals/hashCode`.
2. Sort equality/order: `Comparator` / `Comparable`.

Jika hash contract rusak, `HashMap`/`HashSet` rusak.
Jika comparator contract rusak, `TreeMap`/`TreeSet`/sorting bisa rusak.

Di Part 008, kita akan membahas ordering sebagai contract formal, bukan sekadar cara mengurutkan list.

---

## 54. Status Seri

```text
Part 000 selesai — Orientation
Part 001 selesai — Complexity Analysis yang Realistis di Java
Part 002 selesai — Java Object, Array, Reference, Equality, Hashing
Part 003 selesai — Arrays, Dynamic Arrays, ArrayList
Part 004 selesai — Linked Structures
Part 005 selesai — Stack, Queue, Deque, Ring Buffer
Part 006 selesai — Hash Table Fundamentals
Part 007 selesai — HashMap, HashSet, LinkedHashMap, IdentityHashMap, WeakHashMap
Part 008 berikutnya — Ordering, Sorting, Comparator, Comparable
```

Seri belum selesai. Kita baru menyelesaikan Part 007 dari 030.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java DSA — Part 006: Hash Table Fundamentals](./learn-java-dsa-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-008 — Ordering, Sorting, Comparator, Comparable](./learn-java-dsa-part-008.md)
