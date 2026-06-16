# learn-java-dsa-part-026 — Persistent, Immutable, Copy-on-Write, and Snapshot Structures

> Seri: **Java Data Structure and Algorithm**  
> Bagian: **026 dari 030**  
> Topik: **Persistent, Immutable, Copy-on-Write, and Snapshot Structures**  
> Target: engineer yang ingin memahami struktur data bukan hanya dari sisi API, tetapi dari sisi *correctness*, *safe sharing*, *versioning*, *latency*, *memory cost*, dan desain sistem produksi.

---

## 0. Posisi Materi Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membahas struktur data yang umumnya diasumsikan **mutable**:

- array dan dynamic array,
- linked structure,
- stack/queue/deque,
- hash table,
- ordered structure,
- tree,
- heap,
- graph,
- string index,
- recursion/backtracking,
- dynamic programming,
- greedy,
- sliding window,
- bitset,
- disjoint set,
- cache,
- concurrent data structures.

Bagian ini membahas sudut yang berbeda:

> Bagaimana mendesain struktur data yang bisa dibaca banyak pihak dengan aman, bisa dibagikan tanpa defensive copy berlebihan, bisa memiliki versi, dan bisa dipakai sebagai snapshot state yang konsisten?

Ini penting karena dalam sistem nyata, bug struktur data sering bukan karena algoritmanya salah, tetapi karena **state berubah pada waktu yang salah**.

Contoh nyata:

```java
class RuleEngine {
    private final List<Rule> rules;

    RuleEngine(List<Rule> rules) {
        this.rules = rules; // bug: external mutable reference retained
    }

    boolean evaluate(Request request) {
        for (Rule rule : rules) {
            if (!rule.matches(request)) {
                return false;
            }
        }
        return true;
    }
}
```

Kode di atas tampak sederhana. Masalahnya: caller masih bisa mengubah `rules` setelah `RuleEngine` dibuat. Hasil evaluasi bisa berubah tanpa event eksplisit, tanpa audit trail, dan tanpa transisi state yang terlihat.

Bagian ini akan membangun mental model untuk menghindari class of bugs seperti itu.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **unmodifiable**, **immutable**, **persistent**, **copy-on-write**, dan **snapshot**.
2. Memahami kenapa `final` tidak otomatis membuat object graph immutable.
3. Mendesain API yang tidak membocorkan mutable internal state.
4. Memilih antara defensive copy, unmodifiable view, immutable copy, copy-on-write, dan structural sharing.
5. Memahami trade-off read-heavy vs write-heavy workload.
6. Mendesain versioned configuration snapshot.
7. Mendesain rule/workflow definition yang aman dibaca paralel.
8. Menghindari memory leak karena snapshot lama tertahan.
9. Menguji immutability dan snapshot semantics.
10. Membuat keputusan data structure berdasarkan invariants, bukan sekadar convenience API.

---

## 2. Masalah yang Hendak Diselesaikan

Struktur data mutable mudah dipahami, tetapi berbahaya ketika:

- object dibagikan ke banyak komponen,
- data dibaca saat ada update,
- konfigurasi perlu diganti atomically,
- hasil komputasi harus reproducible,
- audit/debug memerlukan versi data yang konsisten,
- workflow definition tidak boleh berubah saat case sedang diproses,
- ruleset perlu hot reload tanpa menghentikan sistem,
- cache/config/index perlu dipublish ke banyak thread.

Masalah utamanya bukan hanya thread safety. Bahkan dalam single-threaded flow, mutability bisa membuat reasoning sulit.

Contoh:

```java
List<String> permissions = new ArrayList<>();
permissions.add("CASE_READ");

UserSession session = new UserSession(userId, permissions);

permissions.clear(); // session ikut berubah bila menyimpan reference langsung
```

Jika `UserSession` menyimpan reference list tersebut, maka sesi pengguna berubah tanpa operasi pada sesi itu sendiri.

Ini melanggar prinsip penting:

> Object yang sudah dibuat seharusnya tidak berubah kecuali melalui operasi yang secara eksplisit merepresentasikan perubahan state object tersebut.

---

## 3. Vocabulary yang Harus Presisi

Banyak developer mencampuradukkan beberapa istilah berikut. Padahal bedanya sangat penting.

---

### 3.1 Mutable Structure

Mutable structure adalah struktur data yang bisa berubah setelah dibuat.

Contoh:

```java
List<String> list = new ArrayList<>();
list.add("A");
list.add("B");
list.remove("A");
```

Ciri:

- operasi update mengubah object yang sama,
- semua pemegang reference melihat perubahan,
- efisien untuk update lokal,
- berisiko bila reference dibagikan.

Mutable structure cocok ketika ownership jelas.

Contoh ownership jelas:

```java
class Parser {
    List<Token> parse(String source) {
        List<Token> tokens = new ArrayList<>();
        // mutable hanya selama proses parse
        return List.copyOf(tokens);
    }
}
```

Mutable list dipakai sebagai builder internal, lalu hasil akhirnya dipublish sebagai immutable/unmodifiable result.

---

### 3.2 Unmodifiable View

Unmodifiable view adalah wrapper yang mencegah mutation melalui reference wrapper tersebut, tetapi data di belakangnya bisa tetap berubah bila ada reference lain ke backing collection.

Contoh:

```java
List<String> backing = new ArrayList<>();
backing.add("A");

List<String> view = Collections.unmodifiableList(backing);

backing.add("B");

System.out.println(view); // [A, B]
```

`view` tidak bisa dipakai untuk `add`, tetapi tetap melihat perubahan `backing`.

Ini bukan immutable snapshot.

Mental model:

```text
unmodifiable view = read-only window to potentially mutable backing data
```

Kapan berguna:

- exposing internal collection dalam object yang tetap mengontrol semua mutation,
- read-only facade,
- backward-compatible API.

Kapan berbahaya:

- ketika caller mengira view adalah snapshot,
- ketika backing collection masih bisa dimutasi oleh pihak lain,
- ketika dipakai untuk security/authorization data,
- ketika dipakai untuk audit/versioned config.

---

### 3.3 Unmodifiable Copy

Unmodifiable copy adalah collection baru yang tidak mendukung mutation melalui API collection tersebut.

Contoh:

```java
List<String> input = new ArrayList<>();
input.add("A");

List<String> snapshot = List.copyOf(input);

input.add("B");

System.out.println(snapshot); // [A]
```

`List.copyOf` menghasilkan list unmodifiable yang tidak ikut berubah ketika source collection berubah.

Namun ada batas penting:

> Collection-nya tidak bisa dimutasi, tetapi elemen di dalamnya bisa saja mutable.

Contoh:

```java
record Holder(StringBuilder value) {}

StringBuilder sb = new StringBuilder("A");
List<Holder> list = List.of(new Holder(sb));

sb.append("B");

System.out.println(list.get(0).value()); // AB
```

List-nya unmodifiable, tetapi object graph-nya belum tentu immutable.

---

### 3.4 Immutable Structure

Immutable structure adalah struktur yang state-nya tidak bisa berubah setelah dibuat.

Namun ada dua level:

#### Shallow immutability

Collection tidak bisa berubah, tetapi elemen bisa mutable.

```java
List<StringBuilder> list = List.of(new StringBuilder("A"));
list.get(0).append("B"); // collection tetap sama, element berubah
```

#### Deep immutability

Seluruh reachable object graph tidak berubah.

```java
record Rule(String id, String expression) {}

record RuleSet(List<Rule> rules) {
    RuleSet {
        rules = List.copyOf(rules);
    }
}
```

Jika `Rule` juga immutable, maka `RuleSet` lebih dekat ke deep immutable.

Deep immutability lebih sulit ketika object graph kompleks:

- list berisi map,
- map berisi list,
- object berisi mutable date/time lama,
- object berisi array,
- object berisi third-party mutable object.

---

### 3.5 Copy-on-Write

Copy-on-write adalah strategi di mana data dibaca dari snapshot yang stabil, sedangkan setiap mutation membuat copy baru.

Contoh Java built-in:

```java
CopyOnWriteArrayList<String> listeners = new CopyOnWriteArrayList<>();

listeners.add("A"); // copy array internal
listeners.add("B"); // copy array internal lagi

for (String listener : listeners) {
    // iteration melihat snapshot stabil
}
```

Copy-on-write cocok untuk:

- read sangat sering,
- write jarang,
- ukuran collection tidak terlalu besar,
- iteration harus aman dari concurrent modification,
- event listener registry,
- subscriber list,
- plugin list,
- routing table kecil.

Tidak cocok untuk:

- write-heavy workload,
- large list,
- high-frequency mutation,
- queue,
- cache dengan update sering.

---

### 3.6 Persistent Data Structure

Persistent data structure adalah struktur data yang mempertahankan versi lama ketika versi baru dibuat.

Persistent di sini bukan berarti disimpan ke database. Artinya:

> Update menghasilkan versi baru, versi lama tetap valid.

Contoh konseptual:

```text
v1 = [A, B, C]
v2 = append(v1, D)

v1 tetap [A, B, C]
v2 menjadi [A, B, C, D]
```

Persistent structure biasanya memakai **structural sharing** agar tidak menyalin seluruh data.

Contoh konseptual linked list persistent:

```text
list1: A -> B -> C
list2: X -> A -> B -> C
```

`list2` hanya membuat node `X`, lalu berbagi tail dengan `list1`.

Java standard library tidak menyediakan full persistent collection seperti beberapa bahasa functional, tetapi mental model persistent tetap penting untuk desain:

- immutable snapshot,
- versioned config,
- event-sourced state,
- workflow definition versioning,
- rollback/debug state.

---

### 3.7 Snapshot Structure

Snapshot structure adalah struktur yang merepresentasikan state pada satu titik waktu.

Contoh:

```java
record RuleSnapshot(
        long version,
        Instant loadedAt,
        Map<String, Rule> rulesById,
        Map<State, List<Rule>> rulesByState
) {
    RuleSnapshot {
        rulesById = Map.copyOf(rulesById);
        rulesByState = copyRulesByState(rulesByState);
    }

    private static Map<State, List<Rule>> copyRulesByState(Map<State, List<Rule>> input) {
        Map<State, List<Rule>> copy = new EnumMap<>(State.class);
        for (var entry : input.entrySet()) {
            copy.put(entry.getKey(), List.copyOf(entry.getValue()));
        }
        return Collections.unmodifiableMap(copy);
    }
}
```

Snapshot structure cocok untuk:

- rule engine,
- feature flag,
- workflow definition,
- routing table,
- permission matrix,
- reference data,
- compiled validation config.

---

## 4. Perbedaan Penting dalam Satu Tabel

| Konsep | Bisa berubah melalui reference itu? | Ikut berubah jika source berubah? | Versi lama tetap ada? | Cocok untuk |
|---|---:|---:|---:|---|
| Mutable collection | Ya | Ya | Tidak | Builder, local mutation |
| Unmodifiable view | Tidak | Ya | Tidak | Read-only facade |
| Unmodifiable copy | Tidak | Tidak untuk struktur top-level | Tidak otomatis | API result, defensive copy |
| Deep immutable object graph | Tidak | Tidak | Bisa, jika dirancang | Config, value object, ruleset |
| Copy-on-write | Mutation membuat copy internal | Iterator snapshot stabil | Snapshot iterator ya | Read-heavy registry |
| Persistent structure | Update menghasilkan versi baru | Tidak | Ya | Versioned state, functional update |
| Snapshot structure | Tidak setelah publish | Tidak | Ya, selama retained | Hot reload config, rule engine |

---

## 5. `final` Tidak Sama dengan Immutable

Ini salah satu kesalahan paling umum.

```java
final class UserProfile {
    private final List<String> roles;

    UserProfile(List<String> roles) {
        this.roles = roles;
    }

    List<String> roles() {
        return roles;
    }
}
```

`roles` adalah field final. Tapi object list yang direferensikan tetap bisa berubah.

Contoh bug:

```java
List<String> roles = new ArrayList<>();
roles.add("USER");

UserProfile profile = new UserProfile(roles);

roles.add("ADMIN");
System.out.println(profile.roles()); // [USER, ADMIN]

profile.roles().clear();
System.out.println(profile.roles()); // []
```

`final` hanya berarti field `roles` tidak bisa diarahkan ke object lain setelah construction. `final` tidak membekukan object yang direferensikan.

Versi lebih aman:

```java
final class UserProfile {
    private final List<String> roles;

    UserProfile(List<String> roles) {
        this.roles = List.copyOf(roles);
    }

    List<String> roles() {
        return roles;
    }
}
```

Sekarang:

- caller tidak bisa mengubah internal list lewat source lama,
- caller tidak bisa mutate list dari accessor,
- object lebih mudah dipahami.

Namun deep immutability tetap bergantung pada element type.

---

## 6. Defensive Copy

Defensive copy adalah teknik membuat salinan untuk memutus aliasing.

Aliasing terjadi ketika dua reference menunjuk object mutable yang sama.

```text
caller.roles ─────┐
                  ▼
              ArrayList
                  ▲
profile.roles ────┘
```

Dengan defensive copy:

```text
caller.roles ───► ArrayList original

profile.roles ──► copied unmodifiable list
```

---

### 6.1 Defensive Copy on Input

```java
record PermissionSet(List<String> permissions) {
    PermissionSet {
        permissions = List.copyOf(permissions);
    }
}
```

Compact constructor pada record bisa dipakai untuk normalize/copy input.

---

### 6.2 Defensive Copy on Output

Jika internal masih mutable:

```java
class MutablePermissionSet {
    private final List<String> permissions = new ArrayList<>();

    List<String> permissions() {
        return List.copyOf(permissions);
    }
}
```

Ini aman tetapi setiap call membuat copy baru.

Alternatif:

```java
class MutablePermissionSet {
    private final List<String> permissions = new ArrayList<>();
    private final List<String> readOnlyPermissions = Collections.unmodifiableList(permissions);

    List<String> permissions() {
        return readOnlyPermissions;
    }
}
```

Ini tidak membuat copy setiap call, tetapi view ikut berubah ketika internal berubah. Aman hanya jika perubahan internal memang bagian dari lifecycle object dan caller tidak mengharapkan snapshot.

---

### 6.3 Defensive Copy untuk Array

Array selalu mutable.

Buruk:

```java
record Payload(byte[] bytes) {}
```

Caller bisa mutate:

```java
byte[] bytes = {1, 2, 3};
Payload payload = new Payload(bytes);
bytes[0] = 99;
```

Accessor record juga mengembalikan array asli.

Lebih aman:

```java
final class Payload {
    private final byte[] bytes;

    Payload(byte[] bytes) {
        this.bytes = Arrays.copyOf(bytes, bytes.length);
    }

    byte[] bytes() {
        return Arrays.copyOf(bytes, bytes.length);
    }
}
```

Untuk byte payload besar, copy bisa mahal. Desain alternatif:

- gunakan `ByteBuffer.asReadOnlyBuffer()` dengan hati-hati,
- gunakan immutable wrapper,
- gunakan streaming API,
- simpan content-addressed blob,
- expose read-only operation, bukan raw bytes.

---

## 7. Java Built-in: `List.of`, `Set.of`, `Map.of`, `copyOf`

Java modern menyediakan factory method untuk membuat collection unmodifiable.

Contoh:

```java
List<String> roles = List.of("USER", "ADMIN");
Set<String> scopes = Set.of("case:read", "case:write");
Map<String, Integer> priority = Map.of(
        "LOW", 1,
        "HIGH", 10
);
```

Untuk input dinamis:

```java
List<String> snapshot = List.copyOf(inputList);
Set<String> uniqueSnapshot = Set.copyOf(inputSet);
Map<String, Rule> rules = Map.copyOf(inputMap);
```

Poin penting:

1. Collection hasilnya tidak mendukung mutation.
2. Ini bukan deep immutable jika elemen mutable.
3. `List.of` dan `Set.of` tidak menerima `null`.
4. `Map.of` tidak menerima null key/value.
5. `Set.of` dan `Map.of` tidak menerima duplicate element/key.
6. Untuk nested structure, setiap level perlu dicopy.

Contoh nested copy:

```java
static Map<State, List<Rule>> immutableRuleIndex(Map<State, List<Rule>> input) {
    Map<State, List<Rule>> copy = new EnumMap<>(State.class);
    for (var entry : input.entrySet()) {
        copy.put(entry.getKey(), List.copyOf(entry.getValue()));
    }
    return Collections.unmodifiableMap(copy);
}
```

Kenapa tidak langsung `Map.copyOf(input)`?

Karena `Map.copyOf` hanya membuat top-level map unmodifiable. Value list di dalamnya tetap list yang sama jika tidak dicopy.

---

## 8. `Collections.unmodifiableX` vs `X.copyOf`

Ini perbedaan besar.

### 8.1 `Collections.unmodifiableList`

```java
List<String> source = new ArrayList<>();
source.add("A");

List<String> view = Collections.unmodifiableList(source);
source.add("B");

System.out.println(view); // [A, B]
```

`view` adalah wrapper atas source.

### 8.2 `List.copyOf`

```java
List<String> source = new ArrayList<>();
source.add("A");

List<String> snapshot = List.copyOf(source);
source.add("B");

System.out.println(snapshot); // [A]
```

`snapshot` tidak ikut berubah.

### 8.3 Rule of Thumb

Gunakan:

- `List.copyOf` untuk constructor input, API result, snapshot, config, ruleset.
- `Collections.unmodifiableList` untuk read-only view atas internal mutable state yang memang lifecycle-nya dikontrol object.
- `CopyOnWriteArrayList` untuk read-heavy concurrent registry.
- persistent/structural sharing library bila update immutable state besar perlu efisien.

---

## 9. Structural Sharing

Masalah utama immutable update adalah copy cost.

Jika setiap update list ukuran 1 juta menyalin semua elemen, biaya memory dan CPU besar.

Structural sharing mencoba menghindari full copy dengan berbagi bagian yang tidak berubah.

Contoh sederhana: persistent linked list.

```java
sealed interface PList<E> permits PNil, PCons {
    boolean isEmpty();
}

record PNil<E>() implements PList<E> {
    @Override
    public boolean isEmpty() {
        return true;
    }
}

record PCons<E>(E head, PList<E> tail) implements PList<E> {
    @Override
    public boolean isEmpty() {
        return false;
    }
}
```

Pemakaian:

```java
PList<String> empty = new PNil<>();
PList<String> list1 = new PCons<>("C", empty);
PList<String> list2 = new PCons<>("B", list1);
PList<String> list3 = new PCons<>("A", list2);

PList<String> list4 = new PCons<>("X", list3);
```

`list4` berbagi seluruh `list3` sebagai tail.

```text
list3: A -> B -> C -> NIL
list4: X -> A -> B -> C -> NIL
```

Kelebihan:

- update prepend `O(1)`,
- versi lama tetap valid,
- safe sharing mudah,
- cocok untuk recursive algorithms.

Kekurangan:

- random access buruk,
- node allocation banyak,
- cache locality buruk,
- traversal bisa lebih lambat daripada array,
- tidak cocok untuk semua workload Java.

---

## 10. Persistent Map/Vector Concept

Full persistent collection yang efisien biasanya tidak memakai linked list sederhana. Banyak implementasi modern memakai tree berbasis branching factor besar, misalnya vector trie/HAMT-style structure.

Mental model sederhananya:

```text
root
 ├── branch 0
 ├── branch 1
 │    ├── leaf A
 │    └── leaf B
 └── branch 2
```

Ketika satu leaf berubah, hanya path dari root ke leaf yang dicopy.

```text
version 1: root1 -> branch1 -> leaf_old
version 2: root2 -> branch1' -> leaf_new
```

Bagian lain tetap dishare.

Konsekuensi:

- update bukan `O(n)`, tetapi kira-kira `O(log_b n)` dengan branching factor besar,
- versi lama tetap ada,
- memory overhead lebih rendah daripada full copy,
- read sedikit lebih mahal daripada array/map mutable,
- bagus untuk snapshot/versioning.

Di Java standard library, ini bukan default. Jika butuh persistent collection production-grade, biasanya menggunakan library khusus. Namun untuk banyak sistem enterprise, immutable snapshot dengan `copyOf` sudah cukup karena update config/ruleset tidak terlalu sering.

---

## 11. Copy-on-Write secara Mendalam

Copy-on-write adalah desain yang tampak seperti immutable snapshot, tetapi internalnya mengelola snapshot array baru saat mutation.

Contoh tipikal: listener registry.

```java
final class DomainEventBus {
    private final CopyOnWriteArrayList<DomainEventListener> listeners = new CopyOnWriteArrayList<>();

    void register(DomainEventListener listener) {
        listeners.add(Objects.requireNonNull(listener));
    }

    void publish(DomainEvent event) {
        for (DomainEventListener listener : listeners) {
            listener.onEvent(event);
        }
    }
}
```

Kenapa ini bagus?

- publish sering,
- register jarang,
- iteration aman tanpa lock eksplisit,
- listener yang ditambahkan saat publish tidak merusak iteration yang sedang berjalan,
- tidak ada `ConcurrentModificationException`.

Kenapa tidak pakai untuk queue?

Karena setiap enqueue/dequeue akan menyalin array. Itu bencana untuk write-heavy workload.

---

### 11.1 Cost Model Copy-on-Write

Misal list berisi `n` elemen.

| Operation | Cost |
|---|---:|
| read by index | `O(1)` |
| iteration | `O(n)` over stable array |
| add | `O(n)` copy |
| remove | `O(n)` copy/search |
| memory per write | array baru |

Copy-on-write adalah trade-off ekstrem:

> Membuat write mahal supaya read/iteration sederhana, aman, dan stabil.

---

### 11.2 Copy-on-Write Iterator Semantics

Iterator copy-on-write melihat snapshot array pada saat iterator dibuat.

Contoh:

```java
CopyOnWriteArrayList<String> list = new CopyOnWriteArrayList<>();
list.add("A");
list.add("B");

Iterator<String> it = list.iterator();

list.add("C");

while (it.hasNext()) {
    System.out.println(it.next());
}
```

Output:

```text
A
B
```

Iterator tidak melihat `C` karena `C` masuk ke array baru setelah iterator dibuat.

Ini sangat berguna untuk event listener, tetapi bisa mengejutkan jika developer mengharapkan iterator melihat update terbaru.

---

## 12. Snapshot Publication dengan `AtomicReference`

Salah satu pattern paling kuat di Java adalah:

```text
build mutable structure privately
          ↓
freeze/copy into immutable snapshot
          ↓
publish snapshot atomically
          ↓
readers use snapshot without locking
```

Contoh:

```java
final class RuleRepository {
    private final AtomicReference<RuleSnapshot> current = new AtomicReference<>(RuleSnapshot.empty());

    RuleSnapshot currentSnapshot() {
        return current.get();
    }

    void reload(List<RuleDefinition> definitions) {
        RuleSnapshot next = RuleSnapshot.compile(definitions);
        current.set(next);
    }
}
```

Reader:

```java
RuleSnapshot snapshot = repository.currentSnapshot();
Decision decision = snapshot.evaluate(request);
```

Kelebihan:

- reader tidak perlu lock,
- setiap request memakai snapshot konsisten,
- reload tidak mengganggu request berjalan,
- rollback mudah jika snapshot lama disimpan,
- audit bisa mencatat `snapshot.version()`.

Risiko:

- snapshot besar bisa membuat memory spike saat reload,
- request lama bisa menahan snapshot lama,
- compile harus selesai sebelum publish,
- publish partial structure harus dihindari.

---

## 13. Mendesain Snapshot Rule Engine

Kita buat contoh yang dekat dengan sistem enterprise/regulatory.

Problem:

- Ada banyak rule.
- Rule berlaku untuk state tertentu.
- Rule punya priority.
- Rule dapat di-hot-reload.
- Request berjalan harus melihat ruleset konsisten.
- Kita perlu audit rule version yang dipakai.

---

### 13.1 Model Awal

```java
enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}

record RuleId(String value) {
    RuleId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("rule id must not be blank");
        }
    }
}

record Rule(
        RuleId id,
        CaseState appliesTo,
        int priority,
        String expression
) {
    Rule {
        Objects.requireNonNull(id);
        Objects.requireNonNull(appliesTo);
        Objects.requireNonNull(expression);
    }
}
```

`Rule` dibuat immutable dengan record. Field-nya juga harus immutable atau diperlakukan immutable.

---

### 13.2 Snapshot Structure

```java
record RuleSnapshot(
        long version,
        Instant loadedAt,
        Map<RuleId, Rule> byId,
        Map<CaseState, List<Rule>> byState
) {
    RuleSnapshot {
        if (version < 0) {
            throw new IllegalArgumentException("version must be non-negative");
        }
        Objects.requireNonNull(loadedAt);
        byId = Map.copyOf(byId);
        byState = freezeByState(byState);
    }

    static RuleSnapshot empty() {
        return new RuleSnapshot(0, Instant.EPOCH, Map.of(), Map.of());
    }

    static RuleSnapshot compile(long version, Collection<Rule> rules) {
        Map<RuleId, Rule> byId = new HashMap<>();
        Map<CaseState, List<Rule>> mutableByState = new EnumMap<>(CaseState.class);

        for (Rule rule : rules) {
            Rule previous = byId.put(rule.id(), rule);
            if (previous != null) {
                throw new IllegalArgumentException("duplicate rule id: " + rule.id().value());
            }
            mutableByState
                    .computeIfAbsent(rule.appliesTo(), ignored -> new ArrayList<>())
                    .add(rule);
        }

        for (List<Rule> stateRules : mutableByState.values()) {
            stateRules.sort(Comparator
                    .comparingInt(Rule::priority)
                    .thenComparing(rule -> rule.id().value()));
        }

        return new RuleSnapshot(version, Instant.now(), byId, mutableByState);
    }

    List<Rule> rulesFor(CaseState state) {
        return byState.getOrDefault(state, List.of());
    }

    private static Map<CaseState, List<Rule>> freezeByState(Map<CaseState, List<Rule>> input) {
        Map<CaseState, List<Rule>> copy = new EnumMap<>(CaseState.class);
        for (var entry : input.entrySet()) {
            copy.put(entry.getKey(), List.copyOf(entry.getValue()));
        }
        return Collections.unmodifiableMap(copy);
    }
}
```

Perhatikan beberapa invariant:

1. `version >= 0`.
2. `loadedAt != null`.
3. `byId` top-level map unmodifiable.
4. `byState` top-level map unmodifiable.
5. Setiap list rule di `byState` juga unmodifiable.
6. Rule per state sorted deterministic.
7. Duplicate rule ID ditolak.
8. Snapshot dipublish hanya setelah compile selesai.

---

### 13.3 Repository dengan Atomic Publication

```java
final class RuleSnapshotRepository {
    private final AtomicLong versionGenerator = new AtomicLong();
    private final AtomicReference<RuleSnapshot> current = new AtomicReference<>(RuleSnapshot.empty());

    RuleSnapshot current() {
        return current.get();
    }

    RuleSnapshot reload(Collection<Rule> rules) {
        long version = versionGenerator.incrementAndGet();
        RuleSnapshot next = RuleSnapshot.compile(version, rules);
        current.set(next);
        return next;
    }
}
```

Desain ini membuat reload atomic dari perspektif reader.

Reader tidak pernah melihat state setengah compile.

---

### 13.4 Evaluasi Request dengan Snapshot Konsisten

```java
record EvaluationResult(
        long ruleVersion,
        boolean accepted,
        List<RuleId> matchedRules,
        List<String> messages
) {
    EvaluationResult {
        matchedRules = List.copyOf(matchedRules);
        messages = List.copyOf(messages);
    }
}

final class RuleEvaluator {
    private final RuleSnapshotRepository repository;

    RuleEvaluator(RuleSnapshotRepository repository) {
        this.repository = Objects.requireNonNull(repository);
    }

    EvaluationResult evaluate(CaseState state, Map<String, Object> facts) {
        RuleSnapshot snapshot = repository.current();

        List<RuleId> matched = new ArrayList<>();
        List<String> messages = new ArrayList<>();

        for (Rule rule : snapshot.rulesFor(state)) {
            // placeholder: expression evaluation intentionally simplified
            if (facts.containsKey(rule.expression())) {
                matched.add(rule.id());
            } else {
                messages.add("Rule not matched: " + rule.id().value());
            }
        }

        return new EvaluationResult(
                snapshot.version(),
                messages.isEmpty(),
                matched,
                messages
        );
    }
}
```

Setiap evaluation mencatat `ruleVersion`. Ini penting untuk audit:

```text
Case C-123 evaluated using RuleSnapshot v42 at 2026-06-16T...
```

Tanpa versioned snapshot, debugging rule behavior historis menjadi sulit.

---

## 14. Snapshot untuk Workflow Definition

Workflow definition idealnya immutable per versi.

Contoh problem:

- Case sedang berada di `UNDER_REVIEW`.
- Workflow definition direload.
- Transition `UNDER_REVIEW -> APPROVED` dihapus.
- Apa yang terjadi pada case yang sedang diproses?

Jika workflow runtime membaca mutable global map langsung, behavior bisa berubah di tengah request.

Desain lebih aman:

```java
record WorkflowVersion(long value) {}

record Transition(State from, State to, String action) {}

record WorkflowDefinition(
        WorkflowVersion version,
        Set<State> states,
        Map<State, List<Transition>> transitionsFrom
) {
    WorkflowDefinition {
        states = Set.copyOf(states);
        transitionsFrom = freeze(transitionsFrom);
    }

    List<Transition> outgoing(State state) {
        return transitionsFrom.getOrDefault(state, List.of());
    }

    private static Map<State, List<Transition>> freeze(Map<State, List<Transition>> input) {
        Map<State, List<Transition>> copy = new HashMap<>();
        for (var entry : input.entrySet()) {
            copy.put(entry.getKey(), List.copyOf(entry.getValue()));
        }
        return Map.copyOf(copy);
    }
}
```

Runtime:

```java
WorkflowDefinition definition = workflowRepository.current();
List<Transition> allowed = definition.outgoing(currentState);
```

Jika request dimulai dengan version `v10`, sebaiknya seluruh request memakai `v10`, bukan sebagian `v10` dan sebagian `v11`.

---

## 15. API Design: Jangan Bocorkan Mutability

API yang membocorkan mutable internal collection membuat invariant class tidak bisa dijaga.

Buruk:

```java
class CaseDraft {
    private final List<Document> documents = new ArrayList<>();

    List<Document> documents() {
        return documents;
    }
}
```

Caller bisa:

```java
caseDraft.documents().clear();
```

Lebih baik:

```java
class CaseDraft {
    private final List<Document> documents = new ArrayList<>();

    List<Document> documents() {
        return List.copyOf(documents);
    }

    void attach(Document document) {
        documents.add(validate(document));
    }

    void remove(DocumentId id) {
        documents.removeIf(document -> document.id().equals(id));
    }
}
```

Lebih baik lagi jika lifecycle-nya immutable:

```java
record CaseDraft(CaseId id, List<Document> documents) {
    CaseDraft {
        Objects.requireNonNull(id);
        documents = List.copyOf(documents);
    }

    CaseDraft attach(Document document) {
        List<Document> next = new ArrayList<>(documents);
        next.add(validate(document));
        return new CaseDraft(id, next);
    }
}
```

Ini functional update style. Cocok untuk state yang tidak terlalu besar atau update tidak terlalu sering.

---

## 16. Functional Update Pattern

Functional update berarti operasi tidak mengubah object lama, tetapi mengembalikan object baru.

```java
record CaseStateData(
        CaseId id,
        Status status,
        List<Document> documents
) {
    CaseStateData {
        documents = List.copyOf(documents);
    }

    CaseStateData withStatus(Status nextStatus) {
        return new CaseStateData(id, nextStatus, documents);
    }

    CaseStateData attach(Document document) {
        List<Document> nextDocuments = new ArrayList<>(documents);
        nextDocuments.add(document);
        return new CaseStateData(id, status, nextDocuments);
    }
}
```

Kelebihan:

- object lama tetap valid,
- rollback/debug lebih mudah,
- event-sourced thinking lebih natural,
- concurrency reasoning lebih sederhana,
- testing lebih mudah.

Kekurangan:

- copy cost,
- allocation lebih banyak,
- butuh disiplin untuk nested structures,
- tidak cocok untuk high-frequency mutation pada object besar tanpa structural sharing.

---

## 17. Builder + Freeze Pattern

Untuk object besar, membangun immutable object langsung bisa tidak ergonomis.

Pattern umum:

```text
mutable builder during construction
          ↓
validate invariants
          ↓
freeze to immutable snapshot
```

Contoh:

```java
final class WorkflowBuilder {
    private final Set<State> states = new HashSet<>();
    private final Map<State, List<Transition>> transitionsFrom = new HashMap<>();

    WorkflowBuilder addState(State state) {
        states.add(Objects.requireNonNull(state));
        return this;
    }

    WorkflowBuilder addTransition(Transition transition) {
        states.add(transition.from());
        states.add(transition.to());
        transitionsFrom
                .computeIfAbsent(transition.from(), ignored -> new ArrayList<>())
                .add(transition);
        return this;
    }

    WorkflowDefinition build(WorkflowVersion version) {
        validateNoUnknownState();
        validateNoDuplicateActionPerState();
        return new WorkflowDefinition(version, states, transitionsFrom);
    }

    private void validateNoUnknownState() {
        // placeholder
    }

    private void validateNoDuplicateActionPerState() {
        // placeholder
    }
}
```

Kunci:

- builder boleh mutable,
- hasil build harus independent dari builder,
- builder tidak boleh disimpan di runtime path sebagai source of truth,
- hasil build harus divalidasi sebelum publish.

---

## 18. Versioned Snapshot Registry

Kadang tidak cukup menyimpan current snapshot. Kita perlu beberapa versi.

Contoh:

- request lama masih memakai versi lama,
- audit butuh lookup versi lama,
- rollback perlu versi sebelumnya,
- distributed rollout memakai versi berbeda.

Desain sederhana:

```java
final class VersionedRegistry<T> {
    private final int maxVersions;
    private final NavigableMap<Long, T> versions = new TreeMap<>();
    private volatile long currentVersion;

    VersionedRegistry(int maxVersions) {
        if (maxVersions <= 0) {
            throw new IllegalArgumentException("maxVersions must be positive");
        }
        this.maxVersions = maxVersions;
    }

    synchronized void publish(long version, T snapshot) {
        if (!versions.isEmpty() && version <= versions.lastKey()) {
            throw new IllegalArgumentException("version must be increasing");
        }
        versions.put(version, Objects.requireNonNull(snapshot));
        currentVersion = version;
        evictOldVersions();
    }

    synchronized Optional<T> get(long version) {
        return Optional.ofNullable(versions.get(version));
    }

    synchronized T current() {
        T snapshot = versions.get(currentVersion);
        if (snapshot == null) {
            throw new IllegalStateException("no current snapshot");
        }
        return snapshot;
    }

    private void evictOldVersions() {
        while (versions.size() > maxVersions) {
            versions.pollFirstEntry();
        }
    }
}
```

Catatan:

- Ini contoh sederhana, bukan lock-free registry.
- Jika read sangat sering, bisa dikombinasikan dengan `AtomicReference<T> current`.
- Jika snapshot lama masih dipakai request aktif, eviction perlu reference counting atau retention policy berbasis waktu.

---

## 19. Memory Risk pada Snapshot

Snapshot membuat correctness lebih baik, tetapi punya risiko memory.

Masalah umum:

### 19.1 Snapshot lama tertahan

```java
class RequestContext {
    private final RuleSnapshot snapshot;
}
```

Jika request context masuk queue lama, snapshot lama juga tertahan.

### 19.2 Lambda menangkap snapshot besar

```java
RuleSnapshot snapshot = repository.current();
executor.submit(() -> processLater(snapshot));
```

Task tertunda bisa menahan snapshot lama.

### 19.3 Cache menyimpan snapshot per version tanpa eviction

```java
Map<Long, RuleSnapshot> allVersions = new ConcurrentHashMap<>(); // unbounded
```

Ini memory leak jika version terus bertambah.

### 19.4 Copy saat reload menyebabkan peak memory tinggi

Saat reload:

```text
old snapshot masih hidup
new snapshot sedang dibangun
intermediate mutable structures masih hidup
```

Peak memory bisa jauh lebih tinggi daripada ukuran final snapshot.

Mitigasi:

- batasi jumlah retained version,
- compile secara efisien,
- buang intermediate reference setelah publish,
- gunakan primitive/dense representation bila perlu,
- ukur retained size,
- monitor allocation rate dan GC pause,
- hindari menyimpan snapshot di task asynchronous jangka panjang tanpa alasan.

---

## 20. Immutable Tidak Berarti Selalu Lebih Cepat

Immutable/snapshot design sering membuat correctness lebih baik, tetapi tidak selalu lebih cepat.

Trade-off:

| Approach | Read | Write | Memory | Reasoning |
|---|---:|---:|---:|---|
| Mutable local | Cepat | Cepat | Rendah | Mudah jika ownership jelas |
| Defensive copy | Cepat setelah copy | Copy mahal | Medium | Aman untuk boundary |
| Unmodifiable view | Cepat | Backing mutable | Rendah | Bisa membingungkan |
| Copy-on-write | Cepat read | Mahal write | Bisa tinggi | Bagus read-heavy |
| Persistent structure | Medium | Medium | Medium | Bagus versioning |
| Full snapshot copy | Cepat read | Mahal reload | Tinggi saat reload | Bagus config/ruleset |

Rule praktis:

> Gunakan mutability di area kecil dengan ownership jelas. Gunakan immutability/snapshot di boundary antar-komponen, antar-thread, antar-versi, dan untuk data yang memengaruhi correctness/audit.

---

## 21. Equality dan Hashing pada Immutable Object

Immutable object lebih aman sebagai key map/set karena hash-nya stabil.

Baik:

```java
record RuleKey(String agency, String ruleCode, int version) {}
```

Buruk:

```java
final class MutableRuleKey {
    private String agency;
    private String ruleCode;

    // equals/hashCode based on mutable fields
}
```

Jika key berubah setelah dimasukkan ke `HashMap`, lookup bisa gagal.

Immutable key adalah default terbaik untuk:

- map index,
- cache key,
- dedup key,
- correlation key,
- rule key,
- permission key.

---

## 22. Snapshot and Determinism

Snapshot yang baik bukan hanya immutable, tetapi juga deterministic.

Contoh masalah:

```java
Map<String, Rule> rules = new HashMap<>();
for (Rule rule : rules.values()) {
    evaluate(rule);
}
```

Jika evaluation order memengaruhi hasil, memakai `HashMap.values()` tanpa sorting adalah bug desain.

Snapshot compile sebaiknya membuat order eksplisit:

```java
List<Rule> ordered = new ArrayList<>(rules);
ordered.sort(Comparator
        .comparingInt(Rule::priority)
        .thenComparing(rule -> rule.id().value()));
```

Determinism penting untuk:

- audit,
- reproducible bug,
- test stability,
- distributed consistency,
- approval/escalation rule ordering.

---

## 23. Testing Immutability dan Snapshot Semantics

Testing tidak cukup hanya happy path.

---

### 23.1 Test Constructor Defensive Copy

```java
@Test
void constructorMustDefensivelyCopyRules() {
    List<Rule> input = new ArrayList<>();
    input.add(rule("R1"));

    RuleSnapshot snapshot = RuleSnapshot.compile(1, input);

    input.add(rule("R2"));

    assertEquals(1, snapshot.byId().size());
}
```

---

### 23.2 Test Accessor Tidak Mutable

```java
@Test
void returnedRuleListMustBeUnmodifiable() {
    RuleSnapshot snapshot = RuleSnapshot.compile(1, List.of(rule("R1")));

    List<Rule> rules = snapshot.rulesFor(CaseState.SUBMITTED);

    assertThrows(UnsupportedOperationException.class, () -> rules.add(rule("R2")));
}
```

---

### 23.3 Test Nested Mutability

```java
@Test
void nestedListsMustNotBeAffectedBySourceMutation() {
    Map<CaseState, List<Rule>> byState = new EnumMap<>(CaseState.class);
    List<Rule> submittedRules = new ArrayList<>();
    submittedRules.add(rule("R1"));
    byState.put(CaseState.SUBMITTED, submittedRules);

    RuleSnapshot snapshot = new RuleSnapshot(1, Instant.now(), Map.of(), byState);

    submittedRules.add(rule("R2"));

    assertEquals(1, snapshot.rulesFor(CaseState.SUBMITTED).size());
}
```

---

### 23.4 Test Version Consistency During Evaluation

```java
@Test
void evaluationMustUseSingleSnapshotVersion() {
    RuleSnapshotRepository repo = new RuleSnapshotRepository();
    repo.reload(List.of(rule("R1")));

    RuleEvaluator evaluator = new RuleEvaluator(repo);

    EvaluationResult result = evaluator.evaluate(CaseState.SUBMITTED, Map.of());

    assertTrue(result.ruleVersion() > 0);
}
```

Untuk test yang lebih kuat, bisa inject fake repository yang berubah setelah first access, lalu pastikan evaluator mengambil snapshot sekali di awal.

---

## 24. API Checklist

Saat membuat class yang menyimpan collection, tanyakan:

1. Siapa owner collection ini?
2. Apakah caller boleh mutate setelah diberikan ke constructor?
3. Apakah accessor boleh mengembalikan internal reference?
4. Apakah collection top-level saja yang harus immutable, atau nested juga?
5. Apakah element type immutable?
6. Apakah iteration order penting?
7. Apakah snapshot perlu version?
8. Apakah snapshot lama perlu retained?
9. Berapa ukuran data?
10. Seberapa sering update?
11. Seberapa sering read?
12. Apakah update harus atomic bagi reader?
13. Apakah ada audit/debug requirement?
14. Apakah memory spike saat reload bisa diterima?
15. Apakah perlu rollback?

---

## 25. Decision Matrix

### 25.1 Local Temporary Computation

Gunakan mutable collection.

```java
List<Result> results = new ArrayList<>();
// build locally
return List.copyOf(results);
```

Alasan:

- mutability tidak bocor,
- efisien,
- hasil aman.

---

### 25.2 Constructor Boundary

Gunakan `copyOf`.

```java
this.items = List.copyOf(items);
```

Alasan:

- memutus aliasing,
- sederhana,
- aman untuk API boundary.

---

### 25.3 Accessor untuk Immutable Internal State

Return langsung boleh jika internal sudah unmodifiable dan element immutable.

```java
List<Rule> rules() {
    return rules;
}
```

---

### 25.4 Accessor untuk Mutable Internal State

Return copy atau unmodifiable view, tergantung semantics.

```java
List<Item> snapshotItems() {
    return List.copyOf(items);
}
```

atau:

```java
List<Item> liveReadOnlyItems() {
    return Collections.unmodifiableList(items);
}
```

Nama method harus jelas: `snapshotItems` vs `liveReadOnlyItems`.

---

### 25.5 Read-Heavy Concurrent Registry

Gunakan `CopyOnWriteArrayList`.

```java
private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
```

---

### 25.6 Hot Reload Config

Gunakan immutable snapshot + `AtomicReference`.

```java
private final AtomicReference<ConfigSnapshot> current = new AtomicReference<>();
```

---

### 25.7 Versioned Workflow/Ruleset

Gunakan snapshot dengan version field.

```java
record WorkflowDefinition(WorkflowVersion version, ...) {}
```

---

### 25.8 High-Frequency Large Immutable Updates

Pertimbangkan persistent collection/structural sharing library atau ubah desain.

Jika update besar dan sering, `List.copyOf` setiap update bisa mahal.

---

## 26. Anti-Patterns

### 26.1 `final List` Dianggap Immutable

```java
private final List<String> roles;
```

Ini hanya membuat reference final, bukan list immutable.

---

### 26.2 `Collections.unmodifiableList` Dianggap Snapshot

```java
this.roles = Collections.unmodifiableList(input);
```

Jika `input` berubah, `roles` ikut berubah.

---

### 26.3 Top-Level Copy Saja untuk Nested Structure

```java
this.rulesByState = Map.copyOf(rulesByState);
```

Value list di dalam map masih bisa mutable.

---

### 26.4 Exposing Mutable Array

```java
byte[] payload() {
    return payload;
}
```

Array harus dicopy atau tidak diekspos langsung.

---

### 26.5 Copy-on-Write untuk Write-Heavy Data

```java
CopyOnWriteArrayList<Event> queue = new CopyOnWriteArrayList<>(); // bad queue
```

Gunakan queue yang sesuai.

---

### 26.6 Snapshot Tanpa Version

```java
record RuleSnapshot(Map<String, Rule> rules) {}
```

Untuk audit, version hampir selalu perlu.

---

### 26.7 Snapshot Tanpa Deterministic Ordering

Jika order rule penting, jangan mengandalkan `HashMap` iteration.

---

### 26.8 Retain Semua Snapshot Selamanya

```java
Map<Long, Snapshot> history = new ConcurrentHashMap<>();
```

Tanpa retention policy, ini memory leak.

---

### 26.9 Mutable Element dalam Immutable Collection

```java
List<MutableRule> rules = List.copyOf(input);
```

Collection tidak mutable, tetapi rule-nya mutable.

---

## 27. Production Design Example: Feature Flag Snapshot

Problem:

- Feature flag dibaca sangat sering.
- Update jarang.
- Evaluation harus cepat.
- Semua flag harus konsisten dalam satu request.
- Perlu audit version.

Desain:

```java
record FeatureFlagKey(String value) {}

record FeatureFlag(
        FeatureFlagKey key,
        boolean enabled,
        Set<String> allowedTenants
) {
    FeatureFlag {
        Objects.requireNonNull(key);
        allowedTenants = Set.copyOf(allowedTenants);
    }

    boolean enabledFor(String tenantId) {
        return enabled && (allowedTenants.isEmpty() || allowedTenants.contains(tenantId));
    }
}

record FeatureFlagSnapshot(
        long version,
        Instant loadedAt,
        Map<FeatureFlagKey, FeatureFlag> byKey
) {
    FeatureFlagSnapshot {
        loadedAt = Objects.requireNonNull(loadedAt);
        byKey = Map.copyOf(byKey);
    }

    boolean isEnabled(FeatureFlagKey key, String tenantId) {
        FeatureFlag flag = byKey.get(key);
        return flag != null && flag.enabledFor(tenantId);
    }
}

final class FeatureFlagService {
    private final AtomicReference<FeatureFlagSnapshot> current =
            new AtomicReference<>(new FeatureFlagSnapshot(0, Instant.EPOCH, Map.of()));

    boolean isEnabled(FeatureFlagKey key, String tenantId) {
        FeatureFlagSnapshot snapshot = current.get();
        return snapshot.isEnabled(key, tenantId);
    }

    void publish(FeatureFlagSnapshot snapshot) {
        current.set(Objects.requireNonNull(snapshot));
    }
}
```

Read path:

- one volatile/atomic read,
- one map lookup,
- one set lookup.

Write path:

- build new snapshot,
- publish atomically.

This is a strong read-heavy design.

---

## 28. Production Design Example: Immutable Validation Result

Validation result sering dibagikan ke multiple layer:

- controller,
- service,
- audit,
- response mapper,
- logging,
- test assertion.

Jangan mutable.

```java
record Violation(String field, String code, String message) {}

record ValidationResult(List<Violation> violations) {
    ValidationResult {
        violations = List.copyOf(violations);
    }

    boolean valid() {
        return violations.isEmpty();
    }

    static ValidationResult validResult() {
        return new ValidationResult(List.of());
    }

    static ValidationResult invalid(List<Violation> violations) {
        return new ValidationResult(violations);
    }
}
```

Builder internal:

```java
final class ValidationResultBuilder {
    private final List<Violation> violations = new ArrayList<>();

    void add(String field, String code, String message) {
        violations.add(new Violation(field, code, message));
    }

    ValidationResult build() {
        return new ValidationResult(violations);
    }
}
```

Ini pattern yang sangat baik:

```text
mutable builder internally
immutable result externally
```

---

## 29. Production Design Example: Case State Snapshot

Dalam sistem workflow/case management, state case bisa punya banyak derived index:

- current state,
- assigned officer,
- pending documents,
- deadlines,
- applicable transitions,
- risk flags.

Daripada membagikan mutable aggregate, buat snapshot untuk read model.

```java
record CaseReadSnapshot(
        CaseId caseId,
        Status status,
        OfficerId assignedOfficer,
        List<DocumentSummary> documents,
        List<Transition> allowedTransitions,
        Set<RiskFlag> riskFlags,
        Instant generatedAt
) {
    CaseReadSnapshot {
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(status);
        documents = List.copyOf(documents);
        allowedTransitions = List.copyOf(allowedTransitions);
        riskFlags = Set.copyOf(riskFlags);
        generatedAt = Objects.requireNonNull(generatedAt);
    }
}
```

Snapshot ini cocok untuk:

- response DTO internal,
- audit comparison,
- UI read model,
- debugging,
- deterministic tests.

---

## 30. Latency Model untuk Snapshot Reload

Snapshot reload punya beberapa fase:

```text
fetch raw data
    ↓
parse/validate
    ↓
build mutable indexes
    ↓
sort/deduplicate
    ↓
freeze immutable snapshot
    ↓
publish atomic reference
```

Yang perlu diukur:

- waktu fetch,
- waktu parse,
- waktu build index,
- waktu freeze/copy,
- allocation rate,
- retained size snapshot,
- peak heap saat reload,
- GC impact.

Jangan hanya ukur read path.

Snapshot design sering membuat read path sangat cepat, tetapi reload path bisa mahal.

---

## 31. When Not to Use Immutable/Snapshot Everywhere

Jangan menjadikan immutability sebagai dogma.

Tidak semua data perlu immutable.

Mutable lebih cocok untuk:

- local algorithm buffer,
- parser internal state,
- tight loop numeric computation,
- dynamic programming table,
- graph traversal visited set,
- queue/stack runtime,
- object pool internal structure,
- high-frequency counters.

Immutable/snapshot lebih cocok untuk:

- API boundary,
- config,
- rule definition,
- workflow definition,
- permission set,
- security-sensitive data,
- cache key,
- result object,
- audit object,
- published read model.

Prinsipnya:

> Mutability is fine when ownership is local. Immutability is valuable when ownership is shared.

---

## 32. Hubungan dengan Concurrency

Bagian ini bukan mengulang concurrency, tetapi ada satu hubungan penting:

Immutable object yang dipublish dengan benar jauh lebih mudah dibaca oleh banyak thread karena tidak ada mutation setelah publish.

Pattern:

```java
private final AtomicReference<Snapshot> current = new AtomicReference<>();
```

Reader:

```java
Snapshot snapshot = current.get();
```

Jika `Snapshot` benar-benar immutable, reader tidak butuh lock untuk melindungi isi snapshot.

Namun hati-hati:

- immutable top-level belum tentu deep immutable,
- object mutable di dalam snapshot tetap bisa race,
- safe publication tetap penting,
- reference update harus atomic/volatile/synchronized sesuai kebutuhan.

---

## 33. Mini Exercise

### Exercise 1 — Defensive Copy Bug

Diberikan kode:

```java
final class ReportConfig {
    private final Map<String, List<String>> columnsBySection;

    ReportConfig(Map<String, List<String>> columnsBySection) {
        this.columnsBySection = Map.copyOf(columnsBySection);
    }

    List<String> columns(String section) {
        return columnsBySection.getOrDefault(section, List.of());
    }
}
```

Pertanyaan:

1. Apakah class ini immutable?
2. Bug apa yang masih mungkin terjadi?
3. Perbaiki constructor-nya.

Jawaban inti:

`Map.copyOf` hanya copy top-level map. List sebagai value masih bisa mutable jika source list mutable. Perlu copy setiap nested list.

---

### Exercise 2 — Copy-on-Write Decision

Kamu punya collection berisi active WebSocket sessions. Setiap detik ada ribuan broadcast. Session join/leave terjadi ratusan kali per detik.

Apakah `CopyOnWriteArrayList` cocok?

Jawaban inti:

Kemungkinan tidak. Broadcast read memang sering, tetapi join/leave ratusan kali per detik membuat copy array terlalu mahal. Pertimbangkan concurrent set/map, partitioned registry, atau snapshot periodic tergantung consistency requirement.

---

### Exercise 3 — Rule Snapshot Versioning

Rule engine membaca current snapshot dua kali dalam satu request:

```java
RuleSnapshot s1 = repo.current();
validateA(s1, request);

RuleSnapshot s2 = repo.current();
validateB(s2, request);
```

Apa masalahnya?

Jawaban inti:

Jika reload terjadi di antara dua call, satu request bisa memakai dua versi ruleset berbeda. Ambil snapshot sekali di awal request dan teruskan sebagai parameter.

---

## 34. Ringkasan Mental Model

1. `final` membuat reference stabil, bukan object graph immutable.
2. `Collections.unmodifiableX` adalah view, bukan snapshot.
3. `List.copyOf`, `Set.copyOf`, `Map.copyOf` membuat top-level unmodifiable copy.
4. Nested structure harus dicopy per level.
5. Element mutable tetap bisa membuat immutable collection tidak deep immutable.
6. Copy-on-write cocok untuk read-heavy, write-rare workload.
7. Persistent structure mempertahankan versi lama dengan structural sharing.
8. Snapshot structure merepresentasikan state konsisten pada titik waktu tertentu.
9. Versioned snapshot penting untuk audit dan debugging.
10. Atomic snapshot publication adalah pattern kuat untuk hot reload config/ruleset.
11. Immutability meningkatkan reasoning, tetapi bisa menambah allocation dan memory peak.
12. Mutability tetap baik jika ownership lokal dan tidak bocor.

---

## 35. Checklist Praktis untuk Engineer

Sebelum memilih desain immutable/snapshot/copy-on-write, jawab:

```text
[ ] Apakah data ini dibagikan ke luar class?
[ ] Apakah caller masih memegang reference source?
[ ] Apakah accessor membocorkan mutable internal state?
[ ] Apakah element type immutable?
[ ] Apakah nested collection sudah dicopy?
[ ] Apakah order hasil deterministic?
[ ] Apakah snapshot butuh version?
[ ] Apakah update harus atomic untuk reader?
[ ] Apakah read jauh lebih sering daripada write?
[ ] Apakah copy-on-write write cost masih masuk akal?
[ ] Apakah snapshot lama perlu disimpan?
[ ] Apakah retention policy sudah jelas?
[ ] Apakah reload menyebabkan peak memory berbahaya?
[ ] Apakah test membuktikan source mutation tidak memengaruhi snapshot?
[ ] Apakah audit bisa menjawab versi mana yang dipakai?
```

---

## 36. Koneksi ke Part Berikutnya

Bagian ini memberi fondasi untuk **Part 027 — Algorithm Design for Domain Workflows and State Machines**.

Di part berikutnya, kita akan memakai banyak konsep dari sini:

- workflow definition sebagai immutable graph snapshot,
- transition table sebagai indexed structure,
- state machine reachability,
- illegal transition detection,
- escalation priority,
- dependency impact propagation,
- auditability melalui versioned definition,
- deterministic rule/transition ordering.

Dengan kata lain, Part 026 adalah jembatan dari struktur data umum menuju desain algoritmik untuk sistem domain yang stateful.

---

## 37. Referensi

1. Oracle Java SE 25 API — `List`: `List.of` dan `List.copyOf` untuk unmodifiable lists.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html>
2. Oracle Java SE 25 API — `Map`: `Map.of`, `Map.ofEntries`, dan `Map.copyOf` untuk unmodifiable maps.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html>
3. Oracle Java SE 25 API — `CopyOnWriteArrayList`: thread-safe `ArrayList` variant dengan mutative operations yang membuat fresh copy underlying array.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html>
4. Oracle Java SE 25 API — `CopyOnWriteArraySet`: set berbasis internal `CopyOnWriteArrayList`.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArraySet.html>
5. Oracle Java SE 25 API — `Collections`: static methods, collection wrappers, dan algorithms.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html>
6. Oracle Java Tutorial — Creating Unmodifiable Lists, Sets, and Maps.  
   <https://docs.oracle.com/en/java/javase/24/core/creating-immutable-lists-sets-and-maps.html>
7. OpenJDK JOL — Java Object Layout untuk object layout, footprint, dan reference graph analysis.  
   <https://openjdk.org/projects/code-tools/jol/>
