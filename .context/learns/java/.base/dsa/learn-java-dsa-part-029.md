# learn-java-dsa-part-029.md

# Part 029 — DSA Anti-Patterns and Failure Modes in Java Systems

> Seri: **Java Data Structure and Algorithm Advanced**  
> Bagian: **029 dari 030**  
> Status seri: **belum selesai**  
> Berikutnya: **Part 030 — Capstone: Designing a Production-Grade Rule, Workflow, and Case Indexing Engine**

---

## 0. Tujuan Bagian Ini

Bagian ini membahas sisi yang sering lebih menentukan kualitas engineer daripada sekadar kemampuan mengimplementasikan algoritma: **mendeteksi struktur data yang salah sebelum menjadi incident**.

Pada level pemula, DSA sering dipahami sebagai daftar teknik:

- array,
- list,
- map,
- set,
- heap,
- tree,
- graph,
- dynamic programming,
- greedy,
- sliding window.

Pada level engineer production, pertanyaannya berubah:

> “Apakah struktur data ini masih benar, cepat, hemat memori, deterministik, aman terhadap mutasi, dan bisa dipahami ketika sistem tumbuh?”

DSA anti-pattern biasanya tidak terlihat sebagai bug langsung. Ia sering muncul sebagai:

- endpoint lambat hanya pada data besar,
- CPU naik saat traffic tertentu,
- memory leak perlahan,
- hasil sorting tidak konsisten,
- cache berisi data stale,
- deduplication gagal,
- workflow transition salah,
- retry queue tidak pernah habis,
- rule engine menghasilkan keputusan berbeda antar-run,
- job batch tiba-tiba berubah dari menit menjadi jam.

Bagian ini tidak mengulang teori struktur data dari part sebelumnya. Kita akan fokus pada **failure mode**, yaitu bagaimana pilihan DSA yang terlihat wajar bisa menjadi sumber masalah nyata di Java system.

---

## 1. Mental Model: DSA Failure Hampir Selalu Berasal dari Mismatch

Anti-pattern DSA biasanya muncul karena ada mismatch antara **karakter problem** dan **karakter struktur data**.

| Problem Butuh | Tapi Dipakai | Akibat |
|---|---|---|
| Lookup cepat by key | `List` + loop | `O(n)`, lalu accidental `O(n²)` |
| Range query | `HashMap` | Harus scan semua entry |
| Deterministic order | `HashMap` | Output berubah/tidak boleh diandalkan |
| Priority processing | `List.sort()` berulang | Mahal, unstable under load |
| Bounded buffering | Unbounded queue | Memory growth, delayed failure |
| Key stable | Mutable object key | Entry “hilang” dari map/set |
| Logical uniqueness | Identity equality | Duplicate logic lolos |
| Snapshot read | Shared mutable collection | Race, inconsistent view |
| Cache bounded | Plain `HashMap` | Memory leak |
| Deep traversal | Recursive DFS | `StackOverflowError` |
| Numeric comparator | `a - b` | Integer overflow |

Top-tier engineer tidak hanya bertanya:

> “Apa Big-O-nya?”

Tapi juga:

> “Apa invariant yang diasumsikan struktur data ini, dan apakah domain saya benar-benar menjaga invariant itu?”

---

## 2. Anti-Pattern #1 — Menggunakan `List` untuk Lookup yang Seharusnya `Map`

### 2.1 Bentuk Salah yang Umum

```java
record User(String id, String name) {}

User findUserById(List<User> users, String id) {
    for (User user : users) {
        if (user.id().equals(id)) {
            return user;
        }
    }
    return null;
}
```

Kode ini tidak selalu salah. Untuk list kecil dan jarang dipanggil, ini bisa cukup. Anti-pattern muncul ketika:

- list tumbuh besar,
- lookup dipanggil berkali-kali,
- lookup ada di nested loop,
- function terlihat “simple” sehingga luput dari review,
- data sebenarnya punya unique key yang stabil.

### 2.2 Failure Mode

Misalnya kita punya:

```java
for (Case c : cases) {
    User owner = findUserById(users, c.ownerId());
    enrich(c, owner);
}
```

Jika:

- jumlah case = `n`,
- jumlah user = `m`,

maka kompleksitasnya menjadi:

```text
O(n * m)
```

Jika `n = 100_000` dan `m = 100_000`, ini bisa menjadi 10 miliar comparison.

### 2.3 Perbaikan

Bangun index sekali:

```java
Map<String, User> usersById = new HashMap<>(users.size() * 2);
for (User user : users) {
    User previous = usersById.put(user.id(), user);
    if (previous != null) {
        throw new IllegalStateException("Duplicate user id: " + user.id());
    }
}

for (Case c : cases) {
    User owner = usersById.get(c.ownerId());
    enrich(c, owner);
}
```

Kompleksitas berubah menjadi:

```text
Build index: O(m)
Lookup all cases: O(n)
Total: O(n + m)
```

### 2.4 Invariant yang Harus Ditetapkan

Saat memakai `Map`, jangan hanya berpikir “lebih cepat”. Tetapkan invariant:

```text
For every user id, there must be at most one User.
```

Jika duplicate seharusnya illegal, gunakan `put` dengan check. Jangan diam-diam overwrite.

### 2.5 Rule of Thumb

Gunakan `List` jika operasi utama adalah:

- preserve sequence,
- append,
- iterate all,
- random access by index.

Gunakan `Map` jika operasi utama adalah:

- lookup by key,
- dedup by key,
- join antar collection,
- existence check by identifier.

---

## 3. Anti-Pattern #2 — Menggunakan `Map` Padahal Butuh Sorted/Range Semantics

### 3.1 Bentuk Salah

```java
Map<LocalDate, PolicyRate> rates = new HashMap<>();
```

Lalu kebutuhan berubah:

> “Cari policy rate yang berlaku pada tanggal tertentu, yaitu effective date paling baru yang <= target date.”

Dengan `HashMap`, kita terpaksa scan semua key:

```java
PolicyRate findEffectiveRate(Map<LocalDate, PolicyRate> rates, LocalDate target) {
    LocalDate bestDate = null;
    for (LocalDate date : rates.keySet()) {
        if (!date.isAfter(target) && (bestDate == null || date.isAfter(bestDate))) {
            bestDate = date;
        }
    }
    return bestDate == null ? null : rates.get(bestDate);
}
```

Kompleksitas:

```text
O(n) per lookup
```

### 3.2 Perbaikan dengan `NavigableMap`

```java
NavigableMap<LocalDate, PolicyRate> rates = new TreeMap<>();

PolicyRate findEffectiveRate(NavigableMap<LocalDate, PolicyRate> rates, LocalDate target) {
    Map.Entry<LocalDate, PolicyRate> entry = rates.floorEntry(target);
    return entry == null ? null : entry.getValue();
}
```

Kompleksitas umumnya:

```text
O(log n) per lookup
```

### 3.3 Kapan Ini Penting

Range/sorted semantics muncul di banyak sistem:

- effective-date configuration,
- SLA threshold,
- tax/rate bracket,
- escalation rule by aging,
- historical version lookup,
- nearest timestamp,
- calendar interval,
- price tier,
- validity period.

### 3.4 Invariant yang Harus Jelas

```text
Keys are ordered according to a comparator that is stable and consistent for all lookups.
```

Jika comparator berubah, atau key mutable, sorted map bisa rusak secara diam-diam.

---

## 4. Anti-Pattern #3 — Mengandalkan Iteration Order dari Struktur yang Tidak Menjamin Order

### 4.1 Bentuk Salah

```java
Map<String, Rule> rules = new HashMap<>();

for (Rule rule : rules.values()) {
    evaluate(rule);
}
```

Jika hasil evaluasi rule bergantung pada urutan, ini berbahaya.

`HashMap` tidak boleh dipakai untuk menyatakan urutan business rule. Meski pada dataset kecil terlihat konsisten, itu bukan contract yang aman.

### 4.2 Failure Mode

Bug yang muncul biasanya sulit ditelusuri:

- hasil berbeda setelah upgrade JDK,
- hasil berbeda setelah jumlah data berubah,
- hasil berbeda setelah resize map,
- hasil berbeda antar environment,
- unit test pass, production gagal.

### 4.3 Perbaikan

Jika butuh insertion order:

```java
Map<String, Rule> rules = new LinkedHashMap<>();
```

Jika butuh sorted order:

```java
Map<String, Rule> rules = new TreeMap<>();
```

Jika order adalah business concept, lebih baik eksplisit:

```java
record Rule(String id, int priority, String expression) {}

List<Rule> orderedRules = rules.stream()
        .sorted(Comparator.comparingInt(Rule::priority)
                .thenComparing(Rule::id))
        .toList();
```

### 4.4 Rule of Thumb

Jika order memengaruhi hasil, maka order harus menjadi bagian dari model, bukan efek samping struktur data.

---

## 5. Anti-Pattern #4 — Mutable Key di `HashMap` / `HashSet`

### 5.1 Bentuk Salah

```java
final class CaseKey {
    String agency;
    String caseNo;

    CaseKey(String agency, String caseNo) {
        this.agency = agency;
        this.caseNo = caseNo;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof CaseKey other)) return false;
        return Objects.equals(agency, other.agency)
                && Objects.equals(caseNo, other.caseNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(agency, caseNo);
    }
}
```

Lalu:

```java
Map<CaseKey, String> map = new HashMap<>();
CaseKey key = new CaseKey("CEA", "C-001");
map.put(key, "open");

key.caseNo = "C-999";

System.out.println(map.get(key)); // sering null
```

Entry bukan benar-benar hilang, tetapi map tidak bisa menemukannya lewat hash baru.

### 5.2 Kenapa Ini Terjadi

`HashMap` menempatkan key berdasarkan hash saat insertion. Jika field yang menentukan `hashCode()` berubah setelah key masuk map, maka lookup memakai hash baru dan pergi ke bucket yang salah.

### 5.3 Perbaikan

Gunakan immutable key:

```java
record CaseKey(String agency, String caseNo) {
    CaseKey {
        Objects.requireNonNull(agency);
        Objects.requireNonNull(caseNo);
    }
}
```

Atau gunakan key sederhana yang sudah immutable:

```java
String key = agency + ":" + caseNo;
```

Namun composite string juga punya trade-off:

- rawan delimiter collision jika tidak didesain,
- menghilangkan type safety,
- bisa menambah allocation.

Untuk domain penting, `record` biasanya lebih jelas.

### 5.4 Checklist Key yang Aman

Sebuah key map/set harus:

- immutable untuk field yang dipakai `equals/hashCode`,
- tidak bergantung pada waktu,
- tidak bergantung pada external mutable state,
- punya equality semantics yang sesuai domain,
- tidak terlalu mahal dihitung,
- tidak menghasilkan collision berlebihan.

---

## 6. Anti-Pattern #5 — `equals` dan `hashCode` Tidak Konsisten

### 6.1 Bentuk Salah

```java
final class Person {
    private final String nationalId;
    private final String name;

    // equals hanya pakai nationalId
    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Person other)) return false;
        return Objects.equals(nationalId, other.nationalId);
    }

    // hashCode pakai name juga — salah
    @Override
    public int hashCode() {
        return Objects.hash(nationalId, name);
    }
}
```

Jika dua object dianggap equal, hash code wajib sama. Jika tidak, `HashMap`/`HashSet` bisa berperilaku salah.

### 6.2 Perbaikan

```java
@Override
public int hashCode() {
    return Objects.hash(nationalId);
}
```

### 6.3 Anti-Pattern Lain

#### Equality terlalu luas

```java
// equals pakai semua field termasuk displayName, status, updatedAt
```

Akibat:

- object yang secara domain sama dianggap berbeda,
- dedup gagal,
- set membengkak,
- cache miss.

#### Equality terlalu sempit

```java
// equals hanya pakai type, bukan id
```

Akibat:

- object berbeda dianggap sama,
- data overwrite,
- set kehilangan elemen valid.

### 6.4 Rule of Thumb

Tentukan equality dari pertanyaan:

> “Dalam konteks collection ini, dua object dianggap sama jika apa?”

Kadang domain object tidak cocok menjadi key langsung. Lebih aman buat key object khusus.

---

## 7. Anti-Pattern #6 — Comparator Rusak

### 7.1 Comparator dengan Subtraction

```java
Comparator<Case> byPriority = (a, b) -> a.priority() - b.priority();
```

Ini terlihat ringkas, tetapi bisa overflow.

Contoh:

```java
int a = Integer.MAX_VALUE;
int b = -1;
System.out.println(a - b); // overflow
```

### 7.2 Perbaikan

```java
Comparator<Case> byPriority = Comparator.comparingInt(Case::priority);
```

Atau:

```java
Comparator<Case> byPriority = (a, b) -> Integer.compare(a.priority(), b.priority());
```

### 7.3 Non-Transitive Comparator

Comparator harus transitive. Jika tidak, sort/tree/priority structure bisa menghasilkan perilaku tidak stabil.

Salah:

```java
Comparator<Task> unstable = (a, b) -> {
    if (a.isUrgent()) return -1;
    if (b.isUrgent()) return 1;
    return 0;
};
```

Comparator ini tidak memberi order total yang baik ketika banyak field sama/berbeda. Lebih baik eksplisit:

```java
Comparator<Task> stable = Comparator
        .comparing(Task::isUrgent, Comparator.reverseOrder())
        .thenComparing(Task::deadline)
        .thenComparing(Task::id);
```

### 7.4 Comparator Inconsistent with Equals

Jika `compare(a, b) == 0`, sorted set/map akan menganggap keduanya equivalent untuk ordering. Jika `equals` mengatakan berbeda, hasilnya bisa mengejutkan.

Contoh:

```java
record Person(String id, String name) {}

Set<Person> people = new TreeSet<>(Comparator.comparing(Person::name));

people.add(new Person("1", "Alex"));
people.add(new Person("2", "Alex"));

System.out.println(people.size()); // 1, bukan 2
```

Jika name bukan unique identity, comparator ini salah untuk `TreeSet`.

Perbaikan:

```java
Set<Person> people = new TreeSet<>(
        Comparator.comparing(Person::name)
                .thenComparing(Person::id)
);
```

### 7.5 Rule of Thumb

Comparator untuk sorted collection harus:

- deterministic,
- transitive,
- anti-symmetric,
- total untuk domain yang disimpan,
- tidak bergantung pada mutable state,
- tidak mengembalikan `0` kecuali elemen memang equivalent dalam collection tersebut.

---

## 8. Anti-Pattern #7 — Accidental `O(n²)` dari `contains` di Nested Loop

### 8.1 Bentuk Salah

```java
List<String> selectedIds = request.selectedIds();

for (Case c : allCases) {
    if (selectedIds.contains(c.id())) {
        process(c);
    }
}
```

Jika `selectedIds` adalah `ArrayList`, `contains` melakukan linear search.

Jika:

- `allCases = n`,
- `selectedIds = m`,

kompleksitas:

```text
O(n * m)
```

### 8.2 Perbaikan

```java
Set<String> selectedIdSet = new HashSet<>(selectedIds);

for (Case c : allCases) {
    if (selectedIdSet.contains(c.id())) {
        process(c);
    }
}
```

Kompleksitas rata-rata:

```text
O(m + n)
```

### 8.3 Tapi Jangan Membabi Buta

Jika `selectedIds` selalu sangat kecil, misalnya maksimum 3, membuat `HashSet` bisa tidak perlu.

Decision rule:

| Kondisi | Pilihan |
|---|---|
| Collection kecil dan sekali pakai | `List.contains` bisa cukup |
| Collection sedang/besar | `HashSet` |
| Butuh preserve order dan membership | `LinkedHashSet` |
| Butuh sorted membership/range | `TreeSet` |
| Enum membership | `EnumSet` |
| Dense integer domain | `BitSet`/boolean array |

---

## 9. Anti-Pattern #8 — Boxing Explosion

### 9.1 Bentuk Salah

```java
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 10_000_000; i++) {
    numbers.add(i);
}
```

Setiap `Integer` adalah object wrapper, kecuali sebagian kecil nilai cached. Untuk data besar, ini menyebabkan:

- allocation tinggi,
- memory footprint besar,
- GC pressure,
- pointer chasing,
- cache locality buruk.

### 9.2 Perbaikan

Gunakan primitive array jika ukuran diketahui:

```java
int[] numbers = new int[10_000_000];
for (int i = 0; i < numbers.length; i++) {
    numbers[i] = i;
}
```

Jika butuh dynamic primitive collection, pertimbangkan library specialized seperti:

- fastutil,
- HPPC,
- Eclipse Collections primitive collections,
- Agrona.

### 9.3 Kapan Boxing Masih Oke

Boxing bukan dosa jika:

- data kecil,
- clarity lebih penting,
- API memang object-based,
- bukan hot path,
- bukan large batch,
- bukan struktur long-lived.

### 9.4 Rule of Thumb

Jika collection berisi ratusan ribu sampai jutaan primitive value, jangan default ke `List<Integer>` tanpa pengukuran.

---

## 10. Anti-Pattern #9 — Memory Leak Lewat Collection yang Terus Menahan Reference

### 10.1 Bentuk Salah

```java
private final Map<String, SessionData> sessions = new HashMap<>();

void put(String token, SessionData data) {
    sessions.put(token, data);
}
```

Jika tidak ada removal/expiration, ini bukan cache. Ini adalah memory leak yang diberi nama map.

### 10.2 Failure Mode

- heap perlahan naik,
- GC makin sering,
- latency spike,
- OOM setelah beberapa hari,
- restart “menyelesaikan” masalah sementara.

### 10.3 Perbaikan Minimal dengan TTL

```java
record CacheEntry<V>(V value, long expiresAtMillis) {}

final class TtlMap<K, V> {
    private final Map<K, CacheEntry<V>> map = new HashMap<>();
    private final long ttlMillis;

    TtlMap(long ttlMillis) {
        this.ttlMillis = ttlMillis;
    }

    void put(K key, V value) {
        map.put(key, new CacheEntry<>(value, System.currentTimeMillis() + ttlMillis));
    }

    V get(K key) {
        CacheEntry<V> entry = map.get(key);
        if (entry == null) return null;
        if (entry.expiresAtMillis() <= System.currentTimeMillis()) {
            map.remove(key);
            return null;
        }
        return entry.value();
    }
}
```

Namun ini masih minimal. Production cache biasanya perlu:

- max size,
- eviction policy,
- TTL/TTI,
- refresh policy,
- concurrency control,
- metrics,
- stampede protection.

### 10.4 Rule of Thumb

Jika data bisa bertambah tanpa upper bound, harus ada salah satu:

- size limit,
- time limit,
- lifecycle owner,
- explicit removal,
- weak/soft reference dengan pemahaman konsekuensi,
- external storage.

---

## 11. Anti-Pattern #10 — Unbounded Queue sebagai Shock Absorber Palsu

### 11.1 Bentuk Salah

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>();
```

Constructor default `LinkedBlockingQueue` membuat queue dengan kapasitas sangat besar (`Integer.MAX_VALUE`). Dalam praktik, ini sering berarti “unbounded”.

### 11.2 Failure Mode

Queue unbounded terlihat menyelesaikan masalah karena producer tidak tertahan. Tapi sebenarnya ia memindahkan masalah ke memory dan latency.

Gejala:

- backlog makin panjang,
- consumer tertinggal,
- data makin stale,
- memory naik,
- GC pressure,
- request masih diterima padahal sistem sudah overload,
- failure terjadi terlambat dan lebih parah.

### 11.3 Perbaikan

Gunakan bounded queue:

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(10_000);
```

Lalu tentukan policy ketika penuh:

```java
boolean accepted = queue.offer(job, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    throw new RejectedExecutionException("Job queue is full");
}
```

### 11.4 Policy yang Harus Dipilih

| Policy | Cocok untuk | Risiko |
|---|---|---|
| Block producer | Internal pipeline | Thread exhaustion jika salah tempat |
| Reject | API/request boundary | Client harus handle retry |
| Drop latest | Telemetry non-critical | Data hilang |
| Drop oldest | Streaming/windowed data | Bisa hilang context |
| Spill to disk | Batch durable | Kompleksitas naik |
| Backpressure upstream | Reactive/pipeline | Butuh desain end-to-end |

### 11.5 Rule of Thumb

Queue bukan solusi overload. Queue hanya buffer sementara untuk mismatch kecil antara producer dan consumer.

Jika producer rate > consumer rate dalam waktu lama, queue sebesar apa pun akan kalah.

---

## 12. Anti-Pattern #11 — Cache Tanpa Key Design

### 12.1 Bentuk Salah

```java
Map<String, Result> cache = new HashMap<>();

String key = request.getUserId();
cache.put(key, result);
```

Padahal result juga dipengaruhi oleh:

- role,
- agency,
- locale,
- effective date,
- feature flag,
- permission scope,
- request parameter.

### 12.2 Failure Mode

- user melihat data user lain,
- result stale,
- authorization bypass,
- rule decision salah,
- bug sulit direproduce karena cache-dependent.

### 12.3 Perbaikan

Buat cache key eksplisit:

```java
record EligibilityCacheKey(
        String userId,
        String agency,
        String role,
        LocalDate effectiveDate,
        String policyVersion
) {}
```

Gunakan sebagai key:

```java
Map<EligibilityCacheKey, EligibilityResult> cache = new HashMap<>();
```

### 12.4 Checklist Cache Key

Cache key harus mencakup semua input yang memengaruhi output:

- identity,
- scope,
- permissions,
- version,
- time/effective date,
- locale jika output localized,
- feature flag jika mengubah behavior,
- tenant/agency,
- query/filter parameter.

### 12.5 Rule of Thumb

Cache correctness lebih penting daripada cache hit-rate.

Cache yang salah lebih buruk daripada tidak ada cache.

---

## 13. Anti-Pattern #12 — Recursive Traversal pada Data Tidak Dipercaya

### 13.1 Bentuk Salah

```java
void dfs(Node node) {
    for (Node child : node.children()) {
        dfs(child);
    }
}
```

Ini aman untuk tree kecil. Tapi jika depth tidak dikontrol, recursion bisa menyebabkan `StackOverflowError`.

### 13.2 Failure Mode

- input user membentuk nested structure sangat dalam,
- migration data punya hierarchy panjang,
- supposed tree ternyata chain 100k node,
- production request crash.

### 13.3 Perbaikan Iterative

```java
void dfsIterative(Node root) {
    Deque<Node> stack = new ArrayDeque<>();
    stack.push(root);

    while (!stack.isEmpty()) {
        Node node = stack.pop();
        visit(node);

        List<Node> children = node.children();
        for (int i = children.size() - 1; i >= 0; i--) {
            stack.push(children.get(i));
        }
    }
}
```

### 13.4 Tambahkan Cycle Detection Jika Data Tidak Dijamin Tree

```java
void traverse(Node root) {
    Set<String> visited = new HashSet<>();
    Deque<Node> stack = new ArrayDeque<>();
    stack.push(root);

    while (!stack.isEmpty()) {
        Node node = stack.pop();
        if (!visited.add(node.id())) {
            continue;
        }

        visit(node);
        for (Node child : node.children()) {
            stack.push(child);
        }
    }
}
```

### 13.5 Rule of Thumb

Recursive traversal hanya aman jika:

- depth kecil,
- data trusted,
- ada invariant depth,
- failure bisa diterima.

Untuk production data yang besar/tidak dipercaya, gunakan iterative traversal dan limit eksplisit.

---

## 14. Anti-Pattern #13 — Exposing Mutable Internal Collection

### 14.1 Bentuk Salah

```java
final class CaseAggregate {
    private final List<Document> documents = new ArrayList<>();

    List<Document> documents() {
        return documents;
    }
}
```

Caller bisa melakukan:

```java
aggregate.documents().clear();
```

Invariant aggregate rusak dari luar.

### 14.2 Perbaikan dengan Unmodifiable View atau Copy

```java
List<Document> documents() {
    return Collections.unmodifiableList(documents);
}
```

Atau snapshot:

```java
List<Document> documents() {
    return List.copyOf(documents);
}
```

Perbedaannya penting:

- unmodifiable view masih melihat perubahan internal setelahnya,
- copy menghasilkan snapshot saat method dipanggil.

### 14.3 Mutasi Harus Lewat Behavior

```java
void addDocument(Document document) {
    Objects.requireNonNull(document);
    if (documents.stream().anyMatch(d -> d.id().equals(document.id()))) {
        throw new IllegalArgumentException("Duplicate document: " + document.id());
    }
    documents.add(document);
}
```

### 14.4 Rule of Thumb

Jika collection adalah bagian dari invariant object, jangan expose mutable reference-nya.

---

## 15. Anti-Pattern #14 — Menggunakan `PriorityQueue` Seolah-olah Iterasinya Sorted

### 15.1 Bentuk Salah

```java
PriorityQueue<Task> queue = new PriorityQueue<>(Comparator.comparing(Task::deadline));

for (Task task : queue) {
    send(task);
}
```

`PriorityQueue` menjamin elemen prioritas tertinggi/rendah tersedia melalui `peek()`/`poll()`, bukan menjamin iterator sorted.

### 15.2 Perbaikan

Jika ingin memproses berdasarkan priority:

```java
while (!queue.isEmpty()) {
    Task task = queue.poll();
    send(task);
}
```

Jika ingin melihat snapshot sorted tanpa mengosongkan queue:

```java
List<Task> snapshot = new ArrayList<>(queue);
snapshot.sort(Comparator.comparing(Task::deadline).thenComparing(Task::id));
for (Task task : snapshot) {
    sendPreview(task);
}
```

### 15.3 Rule of Thumb

Heap bukan sorted list. Heap hanya menjamin root adalah elemen terbaik menurut comparator.

---

## 16. Anti-Pattern #15 — Mutating Priority Setelah Masuk `PriorityQueue`

### 16.1 Bentuk Salah

```java
Task task = new Task("A", deadline1);
queue.add(task);

task.setDeadline(deadline2);
```

Priority queue tidak otomatis re-heapify ketika field priority object berubah.

### 16.2 Failure Mode

- task dengan deadline baru tidak diproses sesuai prioritas,
- retry schedule kacau,
- escalation terlambat,
- queue tampak “random”.

### 16.3 Perbaikan

Gunakan immutable task entry:

```java
record ScheduledTask(String id, Instant runAt, Runnable action) {}
```

Jika perlu reschedule, masukkan entry baru dan abaikan entry lama saat keluar:

```java
record ScheduledTask(String id, long version, Instant runAt) {}

Map<String, Long> latestVersion = new HashMap<>();
PriorityQueue<ScheduledTask> queue = new PriorityQueue<>(
        Comparator.comparing(ScheduledTask::runAt)
                .thenComparing(ScheduledTask::id)
                .thenComparingLong(ScheduledTask::version)
);

void schedule(String id, Instant runAt) {
    long version = latestVersion.merge(id, 1L, Long::sum);
    queue.add(new ScheduledTask(id, version, runAt));
}

ScheduledTask pollValid() {
    while (!queue.isEmpty()) {
        ScheduledTask task = queue.poll();
        if (latestVersion.getOrDefault(task.id(), -1L) == task.version()) {
            return task;
        }
    }
    return null;
}
```

Ini disebut lazy invalidation/deletion.

---

## 17. Anti-Pattern #16 — Menggunakan `Stream` untuk Hot Path yang Butuh Kontrol Alokasi

### 17.1 Bentuk yang Sering Terlihat

```java
List<String> ids = cases.stream()
        .filter(c -> c.status() == Status.OPEN)
        .map(Case::id)
        .distinct()
        .sorted()
        .toList();
```

Kode ini expressive dan sering baik. Anti-pattern muncul jika berada di hot path besar dan menyebabkan:

- allocation pipeline,
- boxing,
- intermediate object,
- comparator cost,
- hidden `HashSet`/sort cost,
- sulit memasukkan early exit/custom invariant.

### 17.2 Alternatif Imperative untuk Hot Path

```java
Set<String> uniqueIds = new HashSet<>();
for (Case c : cases) {
    if (c.status() == Status.OPEN) {
        uniqueIds.add(c.id());
    }
}

List<String> ids = new ArrayList<>(uniqueIds);
ids.sort(Comparator.naturalOrder());
```

Ini tidak selalu lebih cepat, tetapi lebih eksplisit dalam struktur data yang dipakai.

### 17.3 Rule of Thumb

Stream baik untuk readability. Tetapi untuk hot path, batch besar, atau memory-sensitive code, tanyakan:

- Collection sementara apa yang dibuat?
- Ada boxing?
- Ada sort?
- Ada distinct?
- Ada nested stream?
- Bisa early terminate?
- Apakah lebih mudah diukur dengan JMH jika imperative?

---

## 18. Anti-Pattern #17 — Nested Stream yang Menyembunyikan Nested Loop

### 18.1 Bentuk Salah

```java
List<Result> results = cases.stream()
        .map(c -> users.stream()
                .filter(u -> u.id().equals(c.ownerId()))
                .findFirst()
                .map(u -> new Result(c.id(), u.name()))
                .orElse(null))
        .filter(Objects::nonNull)
        .toList();
```

Ini tampak functional, tetapi sebenarnya nested loop `O(n * m)`.

### 18.2 Perbaikan

```java
Map<String, User> usersById = users.stream()
        .collect(Collectors.toMap(
                User::id,
                Function.identity(),
                (a, b) -> {
                    throw new IllegalStateException("Duplicate user id: " + a.id());
                }
        ));

List<Result> results = cases.stream()
        .map(c -> {
            User u = usersById.get(c.ownerId());
            return u == null ? null : new Result(c.id(), u.name());
        })
        .filter(Objects::nonNull)
        .toList();
```

### 18.3 Rule of Thumb

Nested stream tetap nested loop. Jangan biarkan syntax yang elegan menyembunyikan cost model.

---

## 19. Anti-Pattern #18 — Menggunakan Data Structure General-Purpose untuk Domain Khusus

### 19.1 Contoh: Status Enum sebagai `HashSet`

```java
Set<Status> terminalStatuses = new HashSet<>();
terminalStatuses.add(Status.CLOSED);
terminalStatuses.add(Status.REJECTED);
```

Untuk enum, `EnumSet` lebih tepat:

```java
Set<Status> terminalStatuses = EnumSet.of(Status.CLOSED, Status.REJECTED);
```

`EnumSet` compact dan jelas secara domain.

### 19.2 Contoh: Enum Key sebagai `HashMap`

```java
Map<Status, List<Transition>> transitions = new HashMap<>();
```

Lebih tepat:

```java
Map<Status, List<Transition>> transitions = new EnumMap<>(Status.class);
```

### 19.3 Contoh: Boolean Flags sebagai `Set<String>`

```java
Set<String> permissions = Set.of("READ", "WRITE", "APPROVE");
```

Jika permission fixed dan internal, bisa lebih baik:

```java
enum Permission { READ, WRITE, APPROVE }
EnumSet<Permission> permissions = EnumSet.of(Permission.READ, Permission.WRITE);
```

Untuk ultra-compact internal representation, bit mask bisa dipakai, tetapi harus hati-hati agar tidak mengorbankan clarity.

### 19.4 Rule of Thumb

Gunakan struktur data yang memodelkan domain constraint, bukan hanya yang familiar.

---

## 20. Anti-Pattern #19 — Tidak Menentukan Duplicate Semantics Saat Build Index

### 20.1 Bentuk Salah

```java
Map<String, Rule> rulesByCode = new HashMap<>();
for (Rule rule : rules) {
    rulesByCode.put(rule.code(), rule);
}
```

Jika duplicate code terjadi, rule sebelumnya tertimpa diam-diam.

### 20.2 Perbaikan Fail-Fast

```java
Map<String, Rule> rulesByCode = new HashMap<>();
for (Rule rule : rules) {
    Rule previous = rulesByCode.putIfAbsent(rule.code(), rule);
    if (previous != null) {
        throw new IllegalStateException(
                "Duplicate rule code: " + rule.code()
                        + ", previous=" + previous.id()
                        + ", current=" + rule.id()
        );
    }
}
```

### 20.3 Jika Duplicate Valid

Gunakan multimap pattern:

```java
Map<String, List<Rule>> rulesByCode = new HashMap<>();
for (Rule rule : rules) {
    rulesByCode.computeIfAbsent(rule.code(), ignored -> new ArrayList<>())
            .add(rule);
}
```

### 20.4 Rule of Thumb

Saat membangun index, selalu jawab:

> “Jika key duplicate, apakah itu error, overwrite, merge, atau list?”

Jangan biarkan default `put` menentukan business behavior.

---

## 21. Anti-Pattern #20 — Tidak Membatasi Graph Traversal

### 21.1 Bentuk Salah

```java
void impact(String entityId, Map<String, List<String>> graph) {
    for (String next : graph.getOrDefault(entityId, List.of())) {
        impact(next, graph);
    }
}
```

Jika graph punya cycle, traversal tidak selesai.

### 21.2 Perbaikan dengan State

```java
enum VisitState {
    VISITING,
    VISITED
}

void dfs(String node,
         Map<String, List<String>> graph,
         Map<String, VisitState> state) {
    VisitState current = state.get(node);
    if (current == VisitState.VISITING) {
        throw new IllegalStateException("Cycle detected at " + node);
    }
    if (current == VisitState.VISITED) {
        return;
    }

    state.put(node, VisitState.VISITING);
    for (String next : graph.getOrDefault(node, List.of())) {
        dfs(next, graph, state);
    }
    state.put(node, VisitState.VISITED);
}
```

### 21.3 Production Failure

Graph traversal tanpa batas bisa terjadi pada:

- workflow transition,
- dependency resolver,
- document reference,
- entity relationship,
- rule include/import,
- approval delegation,
- service dependency.

### 21.4 Rule of Thumb

Untuk graph yang berasal dari config/user/data eksternal, selalu punya:

- visited set,
- cycle detection,
- max depth atau max node guard,
- error reporting path,
- deterministic traversal order jika output penting.

---

## 22. Anti-Pattern #21 — Tidak Memisahkan Data Structure untuk Write Model dan Read Model

### 22.1 Masalah

Kadang satu struktur data dipaksa melayani semua kebutuhan:

```java
List<Case> cases = new ArrayList<>();
```

Lalu dipakai untuk:

- insert case,
- lookup by id,
- query by status,
- query by deadline,
- count by owner,
- group by agency,
- escalation priority.

Akhirnya semua operasi menjadi scan.

### 22.2 Perbaikan: Maintain Multiple Indexes

```java
final class CaseIndex {
    private final Map<String, Case> byId = new HashMap<>();
    private final Map<Status, Set<String>> idsByStatus = new EnumMap<>(Status.class);
    private final NavigableMap<Instant, Set<String>> idsByDeadline = new TreeMap<>();

    void add(Case c) {
        if (byId.putIfAbsent(c.id(), c) != null) {
            throw new IllegalArgumentException("Duplicate case id: " + c.id());
        }

        idsByStatus.computeIfAbsent(c.status(), ignored -> new LinkedHashSet<>())
                .add(c.id());

        idsByDeadline.computeIfAbsent(c.deadline(), ignored -> new LinkedHashSet<>())
                .add(c.id());
    }
}
```

### 22.3 Trade-off

Multiple indexes membuat read cepat, tapi write lebih kompleks.

Harus ada invariant:

```text
Every index must be updated atomically with the source record mutation.
```

Jika tidak, index menjadi stale.

### 22.4 Rule of Thumb

Jika query pattern sudah jelas dan sering, jangan takut membuat read index khusus. Tapi bungkus dalam abstraction agar update invariant terkendali.

---

## 23. Anti-Pattern #22 — Mengabaikan Deletion dari Secondary Index

### 23.1 Bentuk Salah

```java
void updateStatus(String caseId, Status newStatus) {
    Case old = byId.get(caseId);
    Case updated = old.withStatus(newStatus);
    byId.put(caseId, updated);

    idsByStatus.computeIfAbsent(newStatus, ignored -> new HashSet<>()).add(caseId);
}
```

Bug: case id masih tertinggal di status lama.

### 23.2 Perbaikan

```java
void updateStatus(String caseId, Status newStatus) {
    Case old = byId.get(caseId);
    if (old == null) {
        throw new NoSuchElementException(caseId);
    }

    if (old.status() == newStatus) {
        return;
    }

    Set<String> oldSet = idsByStatus.get(old.status());
    if (oldSet != null) {
        oldSet.remove(caseId);
        if (oldSet.isEmpty()) {
            idsByStatus.remove(old.status());
        }
    }

    Case updated = old.withStatus(newStatus);
    byId.put(caseId, updated);

    idsByStatus.computeIfAbsent(newStatus, ignored -> new LinkedHashSet<>())
            .add(caseId);
}
```

### 23.3 Rule of Thumb

Setiap secondary index harus punya operasi:

- add,
- remove,
- update/move,
- rebuild,
- validate consistency.

---

## 24. Anti-Pattern #23 — Tidak Punya Rebuild Strategy untuk Derived Structure

### 24.1 Masalah

Derived structure bisa corrupt karena:

- bug update,
- partial failure,
- migration,
- concurrent mutation,
- data repair manual,
- version change.

Jika tidak ada rebuild strategy, kita tidak bisa memulihkan confidence.

### 24.2 Perbaikan

```java
final class CaseIndex {
    static CaseIndex rebuild(Collection<Case> cases) {
        CaseIndex index = new CaseIndex();
        for (Case c : cases) {
            index.add(c);
        }
        index.validate();
        return index;
    }

    void validate() {
        for (Case c : byId.values()) {
            if (!idsByStatus.getOrDefault(c.status(), Set.of()).contains(c.id())) {
                throw new IllegalStateException("Missing status index for " + c.id());
            }
        }
    }
}
```

### 24.3 Rule of Thumb

Untuk setiap derived index, buat minimal:

```text
source of truth -> rebuild derived structure -> validate invariant
```

Ini sangat penting untuk production support.

---

## 25. Anti-Pattern #24 — Overusing General HashMap untuk Composite Multi-Dimensional Query

### 25.1 Bentuk Sederhana Tapi Bermasalah

```java
Map<String, List<Rule>> rules = new HashMap<>();

String key = agency + ":" + product + ":" + status;
rules.computeIfAbsent(key, ignored -> new ArrayList<>()).add(rule);
```

Masalah:

- delimiter collision,
- field ordering implicit,
- null handling tidak jelas,
- sulit range/prefix query,
- sulit partial query,
- tidak type-safe.

### 25.2 Perbaikan dengan Record Key

```java
record RuleKey(String agency, String product, Status status) {}

Map<RuleKey, List<Rule>> rules = new HashMap<>();
```

### 25.3 Jika Butuh Query Parsial

Misalnya sering query by agency saja, buat index berbeda:

```java
Map<String, List<Rule>> rulesByAgency = new HashMap<>();
Map<RuleKey, List<Rule>> rulesByFullKey = new HashMap<>();
```

Atau nested map jika akses hierarchical penting:

```java
Map<String, Map<String, Map<Status, List<Rule>>>> index = new HashMap<>();
```

Namun nested map bisa sulit dirawat. Bungkus dalam abstraction.

### 25.4 Rule of Thumb

Composite key harus explicit, typed, immutable, dan sesuai query pattern.

---

## 26. Anti-Pattern #25 — Optimizing Algorithm Tapi Mengabaikan Data Distribution

### 26.1 Masalah

Struktur data yang optimal di benchmark random bisa buruk di data production.

Contoh:

- hash key semua punya prefix sama,
- graph hampir selalu chain panjang,
- priority queue sering berisi jutaan expired entries,
- trie punya branching kecil tapi depth besar,
- cache hit-rate rendah karena key terlalu granular,
- batch selalu sorted sehingga algorithm tertentu lebih cepat/lambat dari asumsi.

### 26.2 Pertanyaan yang Harus Ditanyakan

Sebelum memilih struktur data, tanya:

- Berapa ukuran data tipikal?
- Berapa p95/p99 ukuran data?
- Apakah data sorted?
- Apakah key skewed?
- Apakah ada hot key?
- Apakah mutation sering?
- Apakah read lebih sering dari write?
- Apakah query exact, range, prefix, atau priority?
- Apakah output harus deterministic?
- Apakah data long-lived atau short-lived?

### 26.3 Rule of Thumb

Complexity analysis tanpa data distribution hanya separuh analisis.

---

## 27. Anti-Pattern #26 — Menganggap “Lebih Advanced” Selalu Lebih Baik

### 27.1 Contoh Overengineering

Menggunakan segment tree untuk dataset 200 item yang di-query sekali.

Menggunakan trie untuk daftar 100 kode statis yang cukup di-scan.

Menggunakan custom lock-free structure padahal `ArrayBlockingQueue` cukup.

Menggunakan graph engine untuk workflow linear sederhana.

### 27.2 Cost dari Struktur Data Advanced

Struktur data advanced membawa biaya:

- lebih sulit dipahami,
- bug invariant lebih subtle,
- testing lebih kompleks,
- maintenance lebih mahal,
- onboarding lebih lambat,
- performance belum tentu lebih baik untuk data kecil.

### 27.3 Rule of Thumb

Pilih struktur data paling sederhana yang memenuhi:

- correctness,
- performance target,
- memory budget,
- determinism,
- maintainability,
- evolution path.

Sederhana bukan berarti naive. Sederhana berarti **cukup kuat dengan invariant yang jelas**.

---

## 28. Failure Mode Matrix

| Anti-Pattern | Gejala | Root Cause | Fix Utama |
|---|---|---|---|
| `List` untuk lookup | Endpoint lambat | Linear search berulang | Build `Map`/`Set` index |
| `Map` untuk range query | Scan semua entry | Tidak ada ordering | `NavigableMap`/sorted index |
| Rely on `HashMap` order | Output tidak deterministik | Order bukan contract | `LinkedHashMap`, `TreeMap`, explicit sort |
| Mutable key | Entry tidak bisa ditemukan | Hash/equality berubah | Immutable key |
| Bad equals/hashCode | Dedup/cache salah | Contract rusak | Align equality/hash fields |
| Bad comparator | Sort/tree kacau | Non-transitive/inconsistent order | Comparator chain jelas |
| Nested `contains` | CPU tinggi | Accidental `O(n²)` | Convert membership to `Set` |
| Boxing explosion | Memory/GC tinggi | Wrapper object massal | Primitive array/specialized collection |
| Unbounded map/cache | OOM perlahan | Tidak ada eviction | TTL/max size/removal |
| Unbounded queue | Latency/memory naik | No backpressure | Bounded queue + reject/backpressure |
| Recursive traversal | Stack overflow | Depth tidak dibatasi | Iterative traversal |
| Expose mutable list | Invariant rusak | Reference bocor | Defensive copy/unmodifiable view |
| Priority mutation | Queue salah urutan | Heap tidak reheapify | Immutable entry/lazy invalidation |
| Hidden nested stream | Batch lambat | Nested loop tersamar | Pre-index data |
| Stale secondary index | Query salah | Update tidak lengkap | Atomic index move/remove |
| No rebuild | Sulit recover | Derived data tidak bisa diverifikasi | Rebuild + validate |

---

## 29. Review Checklist untuk DSA di Code Review

Gunakan checklist ini saat review PR.

### 29.1 Operation Pattern

- Apa operasi paling sering?
- Lookup, insert, delete, range, prefix, priority, traversal, atau aggregation?
- Apakah struktur data sesuai operasi utama?
- Ada nested loop tersembunyi?
- Ada `contains` dalam loop besar?
- Ada sorting berulang?

### 29.2 Correctness Contract

- Apakah key immutable?
- Apakah `equals/hashCode` konsisten?
- Apakah comparator transitive?
- Apakah comparator mengembalikan `0` hanya untuk equivalent element?
- Apakah duplicate semantics eksplisit?
- Apakah iteration order dibutuhkan dan dijamin?

### 29.3 Memory

- Apakah data bisa tumbuh tanpa bound?
- Ada eviction/removal?
- Ada boxing massal?
- Ada collection long-lived yang menahan reference besar?
- Ada defensive copy yang terlalu sering?
- Ada snapshot besar di hot path?

### 29.4 Concurrency

- Apakah collection dimutasi dari banyak thread?
- Apakah iterator semantics dipahami?
- Apakah snapshot dibutuhkan?
- Apakah queue bounded?
- Apakah cache initialization aman dari stampede?

### 29.5 Domain Invariant

- Apa invariant utama struktur ini?
- Apakah invariant dites?
- Apakah ada method `validate()` untuk struktur kompleks?
- Apakah derived index bisa rebuild?
- Apakah stale data bisa terdeteksi?

### 29.6 Failure Boundary

- Apa yang terjadi jika input sangat besar?
- Apa yang terjadi jika graph cyclic?
- Apa yang terjadi jika queue penuh?
- Apa yang terjadi jika duplicate key muncul?
- Apa yang terjadi jika comparator field null?
- Apa yang terjadi jika cache miss/hit-rate rendah?

---

## 30. Testing Strategy untuk Mencegah DSA Failure

### 30.1 Test Duplicate Behavior

```java
@Test
void shouldRejectDuplicateRuleCode() {
    List<Rule> rules = List.of(
            new Rule("1", "R001"),
            new Rule("2", "R001")
    );

    assertThrows(IllegalStateException.class, () -> RuleIndex.build(rules));
}
```

### 30.2 Test Ordering Determinism

```java
@Test
void shouldOrderRulesByPriorityThenId() {
    List<Rule> rules = List.of(
            new Rule("B", 1),
            new Rule("A", 1),
            new Rule("C", 0)
    );

    List<String> ids = RuleOrdering.sort(rules).stream()
            .map(Rule::id)
            .toList();

    assertEquals(List.of("C", "A", "B"), ids);
}
```

### 30.3 Test Mutable Key Trap by Design

Lebih baik test bahwa key object immutable secara desain:

```java
record CaseKey(String agency, String caseNo) {}
```

Untuk class biasa, gunakan static analysis atau review rule agar key fields `final`.

### 30.4 Test Graph Cycle

```java
@Test
void shouldRejectWorkflowCycle() {
    WorkflowGraph graph = new WorkflowGraph();
    graph.addTransition("A", "B");
    graph.addTransition("B", "C");
    graph.addTransition("C", "A");

    assertThrows(CycleDetectedException.class, graph::validateAcyclic);
}
```

### 30.5 Test Secondary Index Consistency

```java
@Test
void shouldMoveCaseBetweenStatusIndexes() {
    CaseIndex index = new CaseIndex();
    index.add(new Case("C1", Status.OPEN));

    index.updateStatus("C1", Status.CLOSED);

    assertFalse(index.idsByStatus(Status.OPEN).contains("C1"));
    assertTrue(index.idsByStatus(Status.CLOSED).contains("C1"));
    index.validate();
}
```

### 30.6 Test Boundaries

Tambahkan test untuk:

- empty input,
- one item,
- duplicate item,
- null if allowed/forbidden,
- large input,
- sorted input,
- reverse sorted input,
- skewed key distribution,
- deep graph/tree,
- cyclic graph,
- queue full,
- cache expired.

---

## 31. Production Observability untuk DSA Structures

DSA yang penting di production harus observable.

### 31.1 Metrics yang Berguna

Untuk cache:

- hit rate,
- miss rate,
- eviction count,
- load duration,
- size,
- stale served count,
- refresh failure.

Untuk queue:

- queue size,
- offer rejection count,
- enqueue rate,
- dequeue rate,
- oldest item age,
- processing latency,
- retry count.

Untuk graph/workflow:

- node count,
- edge count,
- cycle detection failure,
- max traversal depth,
- unreachable state count,
- invalid transition count.

Untuk index:

- index size,
- rebuild duration,
- validation failure,
- duplicate key count,
- stale index correction count.

### 31.2 Log yang Berguna

Log harus menyertakan context:

- key,
- operation,
- size,
- expected invariant,
- actual violation,
- sample path untuk graph cycle,
- duplicate existing/current id,
- queue capacity/current size.

Contoh:

```text
Duplicate rule code detected: code=R001 existingRuleId=12 newRuleId=98 policyVersion=2026-06
```

Lebih berguna daripada:

```text
Duplicate key
```

---

## 32. How Top-Tier Engineers Think About DSA Anti-Patterns

Engineer yang kuat tidak hanya bisa menulis algoritma. Ia bisa membaca kode dan langsung bertanya:

1. Struktur data ini mengasumsikan apa?
2. Apakah domain benar-benar menjaga asumsi itu?
3. Operasi paling sering apa?
4. Apakah complexity cocok dengan ukuran data p95/p99?
5. Apakah output harus deterministic?
6. Apakah key bisa berubah?
7. Apakah comparator benar?
8. Apakah collection bisa tumbuh tanpa batas?
9. Apakah traversal bisa cycle/deep?
10. Apakah index bisa stale?
11. Apakah derived structure bisa rebuild?
12. Apakah behavior ketika overload eksplisit?
13. Apakah ini harus diukur, bukan ditebak?

DSA mastery bukan berarti selalu memakai struktur data paling canggih. DSA mastery berarti **struktur data, invariant, workload, dan failure boundary selaras**.

---

## 33. Ringkasan

Bagian ini membahas failure mode DSA yang paling sering terjadi di Java system:

- `List` dipakai untuk lookup yang seharusnya `Map`/`Set`.
- `HashMap` dipakai untuk kebutuhan range/sorted query.
- Order diandalkan dari struktur yang tidak menjamin order.
- Mutable key merusak hash-based collection.
- `equals/hashCode` tidak konsisten.
- Comparator tidak transitive atau inconsistent with equals.
- `contains` di nested loop menciptakan accidental `O(n²)`.
- Boxing massal menciptakan memory/GC pressure.
- Map/cache tanpa eviction menjadi memory leak.
- Unbounded queue menyembunyikan overload.
- Recursive traversal gagal pada deep/untrusted data.
- Mutable collection bocor dari object dan merusak invariant.
- `PriorityQueue` disalahpahami sebagai sorted list.
- Priority object dimutasi setelah masuk heap.
- Nested stream menyembunyikan nested loop.
- Secondary index stale karena update/remove tidak lengkap.
- Derived structure tidak punya rebuild/validate strategy.

Inti dari semua anti-pattern ini:

> Struktur data bukan hanya container. Struktur data adalah kontrak correctness, performance, memory, ordering, mutation, dan failure behavior.

---

## 34. Latihan

### Latihan 1 — Detect Accidental `O(n²)`

Cari contoh kode yang melakukan loop terhadap satu collection dan memakai `contains`, `findFirst`, atau search terhadap collection lain di dalamnya.

Tugas:

1. Hitung complexity awal.
2. Ubah dengan pre-built index.
3. Tentukan duplicate behavior.
4. Tulis test untuk duplicate.

### Latihan 2 — Build Safe Case Index

Buat `CaseIndex` dengan:

- `Map<String, Case> byId`,
- `EnumMap<Status, Set<String>> idsByStatus`,
- `NavigableMap<Instant, Set<String>> idsByDeadline`.

Support operasi:

- add,
- remove,
- update status,
- update deadline,
- find by id,
- find by status,
- find overdue,
- validate.

### Latihan 3 — Comparator Audit

Ambil comparator yang pernah kamu tulis. Audit:

- apakah pakai subtraction?
- apakah transitive?
- apakah deterministic?
- apakah null-safe?
- apakah tie-breaker cukup?
- apakah cocok untuk `TreeSet`/`TreeMap`?

### Latihan 4 — Cache Key Correctness

Pilih satu cache di sistem nyata.

Tugas:

1. Tuliskan semua input yang memengaruhi output.
2. Bandingkan dengan field cache key saat ini.
3. Identifikasi potensi false hit.
4. Buat `record CacheKey(...)` yang benar.

### Latihan 5 — Queue Overload Policy

Desain queue untuk job processing.

Tentukan:

- kapasitas,
- offer timeout,
- rejection behavior,
- retry behavior,
- metric,
- alert,
- oldest item age threshold.

---

## 35. Referensi

- Oracle Java SE Documentation — Collections Framework Overview.
- Oracle Java SE Documentation — `ArrayList`.
- Oracle Java SE Documentation — `HashMap`.
- Oracle Java SE Documentation — `Map`.
- Oracle Java SE Documentation — `Comparator`.
- Oracle Java SE Documentation — `PriorityQueue`.
- Oracle Java SE Documentation — `ArrayDeque`.
- Oracle Java SE Documentation — `EnumSet` and `EnumMap`.
- Oracle Java SE Documentation — `StackOverflowError`.
- OpenJDK JOL — Java Object Layout.
- OpenJDK JMH — Java Microbenchmark Harness.

---

## 36. Status Seri

Bagian ini adalah **Part 029 dari 030**.

Seri **belum selesai**.

Bagian berikutnya adalah bagian terakhir:

```text
Part 030 — Capstone: Designing a Production-Grade Rule, Workflow, and Case Indexing Engine
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java DSA — Part 028](./learn-java-dsa-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 030 — Capstone: Designing a Production-Grade Rule, Workflow, and Case Indexing Engine](./learn-java-dsa-part-030.md)
