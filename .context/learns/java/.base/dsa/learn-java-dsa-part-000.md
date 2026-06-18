# learn-java-dsa-part-000.md

# Part 000 — Orientation: Cara Berpikir Data Structure & Algorithm untuk Engineer Top-Tier

> Seri: **Java Data Structure and Algorithm**  
> Posisi: **Part 000 dari 030**  
> Status seri: **Belum selesai**  
> Fokus: membangun mental model DSA sebagai engineering discipline, bukan sekadar hafalan interview atau kumpulan template algoritma.

---

## 0. Tujuan Part Ini

Bagian ini adalah fondasi cara berpikir.

Kita belum akan langsung masuk ke `ArrayList`, `HashMap`, graph, dynamic programming, atau heap secara detail. Itu akan datang di part berikutnya. Di bagian ini kita membangun kerangka berpikir agar setiap struktur data dan algoritma yang dipelajari setelah ini tidak jatuh menjadi hafalan.

Target setelah menyelesaikan part ini:

1. Kamu bisa melihat DSA sebagai **model biaya dan invariant**, bukan sekadar nama struktur data.
2. Kamu bisa membaca problem dari sisi:
   - operasi dominan,
   - frekuensi akses,
   - mutation pattern,
   - ordering requirement,
   - memory pressure,
   - correctness invariant,
   - concurrency implication,
   - failure mode.
3. Kamu bisa membedakan antara:
   - struktur data sebagai API,
   - struktur data sebagai representasi internal,
   - struktur data sebagai contract performa,
   - struktur data sebagai boundary correctness.
4. Kamu mulai mampu memilih struktur data dengan alasan yang eksplisit, bukan karena “biasanya pakai `HashMap`”.
5. Kamu punya kerangka kerja untuk menganalisis solusi sebelum menulis kode.

DSA untuk engineer senior/top-tier bukan soal “apakah hafal algoritma X”. DSA adalah kemampuan menjawab:

> “Dengan constraint ini, operation mix ini, dan failure mode ini, representasi data apa yang menjaga correctness dengan biaya paling masuk akal?”

---

## 1. Kenapa DSA Masih Penting untuk Engineer Aplikasi Modern?

Banyak engineer aplikasi berpikir DSA hanya penting untuk interview. Dalam pekerjaan sehari-hari, kita lebih sering menulis service, REST API, worker, scheduler, integration, validation, workflow, database query, cache, dan orchestration.

Tetapi justru di situ DSA muncul secara tersembunyi.

Contoh sederhana:

```java
for (Case c : cases) {
    if (allowedCaseIds.contains(c.id())) {
        result.add(c);
    }
}
```

Kode di atas terlihat biasa. Tetapi performanya berubah drastis tergantung `allowedCaseIds` adalah:

```java
List<String> allowedCaseIds;
```

atau:

```java
Set<String> allowedCaseIds;
```

Jika `cases` berisi 100.000 item dan `allowedCaseIds` juga 100.000 item:

- `List.contains` dapat menjadi pencarian linear berulang.
- `HashSet.contains` biasanya jauh lebih cocok untuk membership lookup.

Artinya, satu pilihan representasi mengubah karakter solusi dari “terlihat aman” menjadi “potensi bottleneck”.

Namun DSA bukan hanya soal speed. DSA juga soal correctness.

Misalnya:

```java
Map<CaseKey, CaseData> map = new HashMap<>();
```

Jika `CaseKey` mutable dan field yang dipakai oleh `equals`/`hashCode` berubah setelah key masuk ke `HashMap`, maka entry bisa menjadi “hilang secara logis”. Objeknya masih ada di map, tetapi lookup gagal.

Ini bukan bug syntax. Ini bug invariant.

---

## 2. DSA sebagai Empat Hal Berbeda

Saat mendengar “struktur data”, banyak orang langsung membayangkan bentuk fisik:

- array,
- linked list,
- stack,
- queue,
- tree,
- graph,
- hash table,
- heap.

Itu benar, tapi belum cukup.

Untuk engineer, struktur data perlu dilihat dari empat lapisan.

---

### 2.1 Struktur Data sebagai API

Ini adalah cara caller berinteraksi dengan data.

Contoh:

```java
List<CaseDto> cases;
Set<String> permissions;
Map<String, UserSession> sessionsByToken;
Queue<Job> pendingJobs;
Deque<State> traversalStack;
NavigableMap<Instant, DeadlineRule> rulesByEffectiveTime;
```

API memberi tahu operasi apa yang secara konseptual didukung:

| API | Makna utama |
|---|---|
| `List` | urutan linear, akses berdasarkan posisi |
| `Set` | uniqueness / membership |
| `Map` | lookup berdasarkan key |
| `Queue` | pemrosesan FIFO/prioritas tertentu |
| `Deque` | operasi dua ujung |
| `SortedSet` / `NavigableSet` | uniqueness + ordering + range query |
| `SortedMap` / `NavigableMap` | key-value + ordering + range query |

Namun API tidak selalu cukup untuk memahami biaya.

`List` bisa berarti:

```java
ArrayList<T>
LinkedList<T>
```

Keduanya sama-sama `List`, tapi cost model-nya berbeda.

---

### 2.2 Struktur Data sebagai Representasi Internal

Representasi internal menjawab: data disimpan bagaimana?

Contoh:

| Struktur | Representasi umum |
|---|---|
| Dynamic array | array yang bisa resize |
| Linked list | node yang saling menunjuk |
| Hash table | bucket berdasarkan hash |
| Tree map | balanced binary search tree |
| Heap | array dengan heap invariant |
| Graph adjacency list | map/list dari node ke tetangga |
| Trie | tree berdasarkan karakter/token |

Representasi menentukan biaya nyata:

- Apakah akses random murah?
- Apakah traversal cache-friendly?
- Apakah insert/delete butuh shifting?
- Apakah banyak alokasi objek kecil?
- Apakah ada pointer chasing?
- Apakah resize menyebabkan latency spike?

Contoh mental model:

```text
ArrayList:
[index 0][index 1][index 2][index 3] ...

LinkedList:
[node] -> [node] -> [node] -> [node]
```

Secara teori, linked list unggul untuk insert/delete di tengah jika posisi node sudah diketahui. Tetapi dalam banyak aplikasi Java modern, `ArrayList` sering lebih baik untuk traversal karena data referensinya tersimpan dalam array dan aksesnya lebih cache-friendly dibanding node chain yang tersebar di heap.

Pelajaran penting:

> Big-O memberi arah. Representasi memberi kenyataan.

---

### 2.3 Struktur Data sebagai Performance Contract

Saat memilih struktur data, kita sebenarnya membuat janji performa.

Contoh:

```java
Map<String, Case> casesById = new HashMap<>();
```

Dengan ini kita seolah berkata:

> “Lookup case berdasarkan ID adalah operasi penting dan harus cepat.”

Sedangkan:

```java
List<Case> cases = new ArrayList<>();
```

menyiratkan:

> “Urutan penting, traversal penting, dan lookup by ID mungkin bukan operasi utama.”

Jika ternyata operasi dominan adalah `findById`, tetapi representasinya `List`, maka struktur data tidak selaras dengan kebutuhan.

Contoh buruk:

```java
Case findById(List<Case> cases, String id) {
    for (Case c : cases) {
        if (c.id().equals(id)) {
            return c;
        }
    }
    return null;
}
```

Jika ini dipanggil ribuan kali dalam batch, masalahnya bukan “Java lambat”. Masalahnya adalah representation mismatch.

Solusi biasanya bukan micro-optimization, tetapi membangun index:

```java
Map<String, Case> casesById = cases.stream()
        .collect(Collectors.toMap(Case::id, Function.identity()));
```

Namun index juga punya biaya:

- memory tambahan,
- build time,
- consistency problem saat data berubah,
- duplicate key handling,
- lifecycle management.

Jadi pertanyaan senior bukan hanya:

> “Bagaimana membuat lookup cepat?”

Tapi:

> “Apakah biaya membangun dan menjaga index lebih kecil daripada biaya pencarian berulang?”

---

### 2.4 Struktur Data sebagai Correctness Boundary

Struktur data juga menjaga invariant.

Contoh:

```java
Set<Permission> permissions;
```

`Set` menyatakan bahwa duplicate permission tidak boleh bermakna.

```java
List<Permission> permissions;
```

`List` tidak memberi invariant uniqueness.

Jika sistem authorization menyimpan permission dalam `List`, maka kamu harus menjawab:

- Apakah duplicate boleh?
- Jika duplicate muncul, apakah efeknya harmless?
- Jika duplicate tidak boleh, siapa yang mencegahnya?
- Apakah validasi dilakukan di setiap write path?
- Apakah equality permission sudah benar?

Menggunakan `Set` bukan hanya optimasi. Itu cara menaruh invariant ke dalam representasi.

Contoh lain:

```java
EnumMap<CaseState, List<Case>> casesByState;
```

Ini menyatakan:

- key hanya enum `CaseState`,
- tidak ada arbitrary string state,
- bucket per state eksplisit,
- cocok untuk state machine atau grouping by enum.

Struktur data yang baik membuat illegal state lebih sulit terjadi.

---

## 3. DSA Bukan Sekadar Big-O

Big-O penting, tapi sering disalahgunakan.

Contoh:

```text
HashMap lookup: O(1)
TreeMap lookup: O(log n)
ArrayList get(index): O(1)
LinkedList addFirst: O(1)
```

Pernyataan seperti itu berguna, tetapi tidak cukup untuk desain produksi.

Kita perlu melihat setidaknya tujuh jenis biaya.

---

### 3.1 Asymptotic Complexity

Ini biaya saat ukuran input membesar.

| Complexity | Intuisi |
|---|---|
| `O(1)` | tidak tumbuh terhadap input size |
| `O(log n)` | tumbuh sangat lambat |
| `O(n)` | tumbuh linear |
| `O(n log n)` | umum pada sorting efisien |
| `O(n²)` | nested pairwise comparison |
| `O(2ⁿ)` | eksplorasi subset/choice space |
| `O(n!)` | eksplorasi permutasi |

Namun Big-O menghapus constant factor.

Operasi `O(1)` yang melibatkan hash computation mahal, equality deep compare, alokasi, dan cache miss bisa lebih lambat daripada `O(log n)` untuk ukuran kecil/sedang.

---

### 3.2 Constant Factor

Dua algoritma sama-sama `O(n)` bisa beda jauh.

Contoh:

```java
int sum(int[] values) {
    int total = 0;
    for (int v : values) {
        total += v;
    }
    return total;
}
```

versus:

```java
int sum(List<Integer> values) {
    int total = 0;
    for (Integer v : values) {
        total += v;
    }
    return total;
}
```

Keduanya linear. Tetapi versi `List<Integer>` melibatkan object references dan unboxing. Untuk workload besar, ini berbeda signifikan.

---

### 3.3 Allocation Cost

Di Java, alokasi sering murah tetapi bukan gratis.

Jika algoritma membuat banyak object kecil:

```java
record Pair(int left, int right) {}

List<Pair> pairs = new ArrayList<>();
for (int i = 0; i < n; i++) {
    pairs.add(new Pair(i, i + 1));
}
```

maka kamu membayar:

- object allocation,
- object header,
- reference storage,
- GC tracking,
- possible cache miss.

Kadang solusi berbasis primitive arrays lebih kompleks tetapi jauh lebih efisien:

```java
int[] left = new int[n];
int[] right = new int[n];
```

Ini bukan berarti selalu gunakan primitive arrays. Ini berarti kamu harus sadar biaya representasi.

---

### 3.4 Memory Locality

CPU modern sangat sensitif terhadap locality.

Array cenderung lebih locality-friendly:

```text
[ref][ref][ref][ref][ref]
```

Linked node cenderung pointer-chasing:

```text
node -> node -> node -> node
```

Jika node tersebar di heap, traversal linked structure dapat sering menyebabkan cache miss.

Karena itu, struktur data yang secara teori terlihat bagus belum tentu cepat di JVM nyata.

---

### 3.5 Branching dan Predictability

Algoritma dengan banyak conditional tidak terprediksi bisa lebih mahal daripada yang terlihat.

Contoh:

```java
if (value.status() == ACTIVE) {
    // path A
} else if (value.status() == SUSPENDED) {
    // path B
} else if (value.status() == TERMINATED) {
    // path C
}
```

Jika distribusi status acak, branch prediction bisa buruk. Dalam banyak aplikasi bisnis, ini mungkin bukan bottleneck utama, tetapi untuk loop besar dan low-latency code, ini relevan.

---

### 3.6 Mutation Cost

Struktur data tidak hanya dibaca. Ia berubah.

Pertanyaan penting:

- Apakah insert sering?
- Apakah delete sering?
- Delete dari awal, tengah, atau akhir?
- Apakah update key memengaruhi ordering/hash?
- Apakah perlu snapshot saat mutation berjalan?
- Apakah mutation harus thread-safe?

Contoh:

`ArrayList` bagus untuk append dan random access, tetapi remove dari tengah butuh shifting.

```java
list.remove(i); // elemen setelah i digeser
```

Jika sering remove banyak elemen, strategi yang lebih baik mungkin:

```java
list.removeIf(predicate);
```

atau bangun list baru:

```java
List<Item> filtered = new ArrayList<>();
for (Item item : items) {
    if (!shouldRemove(item)) {
        filtered.add(item);
    }
}
```

---

### 3.7 Tail Latency dan Worst-Case Spike

Dalam sistem produksi, rata-rata tidak cukup.

Contoh operasi yang bisa menyebabkan spike:

- resize `ArrayList`,
- resize `HashMap`,
- sorting batch besar,
- cache eviction besar,
- graph traversal tidak dibatasi,
- recursive traversal stack overflow,
- unbounded queue growth,
- accidental nested lookup.

Engineer top-tier bertanya:

> “Apa operasi yang biasanya cepat tetapi kadang sangat mahal?”

---

## 4. Cara Membaca Problem DSA Secara Engineering

Sebelum memilih struktur data, jangan mulai dari “pakai apa”. Mulai dari “operasi apa yang perlu dijamin”.

Gunakan checklist ini.

---

### 4.1 Entity

Apa unit datanya?

Contoh:

```java
record Case(
        String id,
        CaseState state,
        Instant createdAt,
        Instant dueAt,
        String assignedOfficerId
) {}
```

Pertanyaan:

- Apakah entity punya identity?
- Apakah identity immutable?
- Apakah equality berdasarkan ID atau seluruh field?
- Apakah entity mutable?
- Apakah entity disimpan sebagai object, DTO, projection, atau primitive fields?

---

### 4.2 Operations

Daftar operasi yang harus didukung.

Contoh untuk case management:

1. Lookup case by ID.
2. List cases by officer.
3. List cases by state.
4. Find overdue cases.
5. Pick next escalation candidate.
6. Validate transition from one state to another.
7. Compute impact if a case changes state.
8. Detect duplicate external reference.

Setiap operasi mengarah ke struktur berbeda.

| Operasi | Struktur kandidat |
|---|---|
| lookup by ID | `HashMap<Id, Case>` |
| group by state | `EnumMap<State, List<Case>>` |
| due date range | `NavigableMap<Instant, List<Case>>` |
| next highest priority | `PriorityQueue<Case>` |
| transition validation | graph / transition table |
| dependency impact | graph adjacency list |
| duplicate detection | `HashSet<Key>` |

---

### 4.3 Frequency

Operasi mana yang paling sering?

Misalnya:

```text
write: 1.000/day
read by ID: 5.000.000/day
read by due date: 100.000/day
full scan report: 10/day
```

Dalam kasus ini, index by ID sangat masuk akal.

Tetapi jika data kecil dan operasi jarang, struktur kompleks bisa overengineering.

Prinsip:

> Optimalkan operasi dominan, bukan operasi yang paling menarik secara akademis.

---

### 4.4 Constraint

Constraint bisa berupa:

- jumlah data,
- batas latency,
- batas memory,
- batas concurrency,
- batas consistency,
- input ordering,
- domain invariant,
- SLA,
- failure recovery.

Contoh:

```text
Max active cases in memory: 2 million
Lookup p99 target: < 10 ms
Case state mutation: frequent
Deadline query: every minute
Memory budget: 2 GB heap for this component
```

Dari sini kita tahu bahwa full scan setiap menit mungkin mahal.

---

### 4.5 Ordering Requirement

Apakah urutan penting?

Jenis ordering:

1. Insertion order.
2. Access order.
3. Natural sorted order.
4. Custom priority order.
5. Topological order.
6. Time order.
7. Stable processing order.

Contoh:

```java
Map<String, Case> map = new HashMap<>();
```

Jangan andalkan iteration order dari `HashMap`.

Jika butuh insertion order:

```java
Map<String, Case> map = new LinkedHashMap<>();
```

Jika butuh sorted by key:

```java
NavigableMap<String, Case> map = new TreeMap<>();
```

Jika butuh next highest priority:

```java
PriorityQueue<Case> queue = new PriorityQueue<>(casePriorityComparator);
```

Ordering adalah requirement, bukan detail tampilan.

---

### 4.6 Mutation Pattern

Apakah data:

- append-only?
- sering update?
- sering delete?
- batch replace?
- immutable snapshot?
- concurrent mutation?

Contoh rule configuration:

```text
Read: sangat sering
Write: jarang, via publish new version
```

Representasi yang cocok:

- immutable snapshot,
- replace reference atomically,
- precomputed indexes.

Contoh queue worker:

```text
Write: banyak producer
Read: banyak consumer
Blocking needed
```

Representasi yang cocok:

- `BlockingQueue`,
- bounded queue,
- backpressure policy.

---

### 4.7 Lifetime

Berapa lama data hidup?

- request-scoped,
- batch-scoped,
- cache-scoped,
- application-scoped,
- persistent snapshot,
- temporary index.

Temporary index sering sangat berguna.

Contoh:

```java
Map<String, User> usersById = users.stream()
        .collect(Collectors.toMap(User::id, Function.identity()));

for (Order order : orders) {
    User user = usersById.get(order.userId());
    // process
}
```

Index hanya hidup selama proses join in-memory. Itu valid jika biaya build lebih murah daripada nested lookup.

---

### 4.8 Concurrency

Apakah struktur dibaca/ditulis oleh banyak thread?

Pertanyaan:

- Apakah hanya read setelah publish?
- Apakah ada concurrent write?
- Apakah caller butuh snapshot consistency?
- Apakah iterator boleh melihat perubahan?
- Apakah operasi compound perlu atomic?

Contoh bug:

```java
if (!map.containsKey(key)) {
    map.put(key, createValue());
}
```

Pada concurrent context, ini bukan operasi atomic.

Biasanya perlu:

```java
map.computeIfAbsent(key, k -> createValue());
```

Tetapi bahkan `computeIfAbsent` punya implikasi: mapping function harus aman, tidak terlalu lambat, dan tidak membuat side effect berbahaya.

---

## 5. Java-Specific DSA Mental Model

DSA di Java berbeda dari DSA di C, Rust, Python, atau Go karena bahasa dan runtime punya karakteristik sendiri.

---

### 5.1 Object Identity vs Logical Equality

Java object punya identity.

```java
User a = new User("u1");
User b = new User("u1");

System.out.println(a == b);      // false jika object berbeda
System.out.println(a.equals(b)); // tergantung implementasi equals
```

Dalam DSA, equality menentukan behavior `Set`, `Map`, deduplication, lookup, dan grouping.

Jika `equals` salah, struktur data yang benar pun menghasilkan perilaku salah.

Rule penting:

> Untuk key `HashMap` atau elemen `HashSet`, field yang memengaruhi `equals` dan `hashCode` harus stabil selama object berada di dalam struktur tersebut.

Contoh buruk:

```java
final class CaseKey {
    String caseNo;

    CaseKey(String caseNo) {
        this.caseNo = caseNo;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof CaseKey k && Objects.equals(caseNo, k.caseNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(caseNo);
    }
}
```

Jika setelah dimasukkan ke map:

```java
CaseKey key = new CaseKey("A-001");
map.put(key, caseData);

key.caseNo = "A-002";

map.get(key); // bisa gagal secara logis
```

Solusi:

```java
record CaseKey(String caseNo) {}
```

Record membuat field final secara default dan cocok untuk value-based key jika komponennya juga stabil.

---

### 5.2 Reference Semantics

Collection Java umumnya menyimpan reference ke object, bukan copy object.

```java
List<Case> list = new ArrayList<>();
Case c = new Case("C-1", OPEN);
list.add(c);
```

Jika object mutable dan diubah dari luar, isi list secara efektif berubah.

Ini penting untuk:

- defensive copy,
- immutable DTO,
- snapshot,
- cache correctness,
- event payload safety.

Contoh bahaya:

```java
class CaseBucket {
    private final List<Case> cases = new ArrayList<>();

    List<Case> cases() {
        return cases;
    }
}
```

Caller bisa melakukan:

```java
bucket.cases().clear();
```

Struktur internal rusak.

Lebih aman:

```java
List<Case> cases() {
    return List.copyOf(cases);
}
```

atau expose read-only view dengan hati-hati.

---

### 5.3 Boxing dan Primitive Gap

Java generic collections tidak bisa menyimpan primitive secara langsung.

```java
List<Integer> values = new ArrayList<>();
```

`Integer` adalah object wrapper.

Untuk data besar, ini berarti:

- memory lebih besar,
- pointer chasing,
- allocation/autoboxing risk,
- cache locality lebih buruk.

Bandingkan:

```java
int[] values = new int[n];
```

Untuk algorithm-heavy code, primitive arrays sering lebih efisien.

Namun trade-off-nya:

- kode lebih manual,
- kurang ekspresif,
- resize sendiri,
- tidak punya API collection kaya.

Top-tier engineer tidak dogmatis. Mereka memilih berdasarkan workload.

---

### 5.4 Comparator adalah Contract, Bukan Callback Biasa

Comparator yang salah bisa merusak sorted structure.

Contoh buruk:

```java
Comparator<Case> byPriority = (a, b) -> a.priority() - b.priority();
```

Masalah:

- integer overflow,
- tidak eksplisit tie-breaker,
- bisa inconsistent jika priority berubah,
- bisa tidak konsisten dengan equals.

Lebih baik:

```java
Comparator<Case> byPriority = Comparator
        .comparingInt(Case::priority)
        .thenComparing(Case::id);
```

Untuk `TreeSet`, comparator menentukan uniqueness secara praktis. Jika comparator menganggap dua object sama (`compare(a, b) == 0`), salah satunya bisa dianggap duplicate meskipun `equals` berbeda.

---

### 5.5 Iteration Order Tidak Selalu Contract

Beberapa struktur punya urutan encounter yang jelas, beberapa tidak.

Contoh:

- `ArrayList`: urutan index.
- `LinkedHashMap`: insertion/access order tergantung mode.
- `TreeMap`: sorted key order.
- `HashMap`: jangan jadikan iteration order sebagai business rule.

Java modern juga memperkenalkan keluarga sequenced collections untuk collection dengan encounter order yang jelas serta operasi first/last dan reversed view. Ini penting karena ordering sekarang makin eksplisit di API collection modern.

---

### 5.6 Fail-Fast Iterator Bukan Mekanisme Correctness

Banyak collection Java memiliki iterator yang fail-fast saat mendeteksi concurrent modification struktural.

Contoh:

```java
for (Item item : items) {
    if (item.expired()) {
        items.remove(item); // berpotensi ConcurrentModificationException
    }
}
```

Solusi:

```java
items.removeIf(Item::expired);
```

atau gunakan iterator secara eksplisit:

```java
Iterator<Item> it = items.iterator();
while (it.hasNext()) {
    if (it.next().expired()) {
        it.remove();
    }
}
```

Namun fail-fast bukan jaminan thread-safety. Itu hanya mekanisme deteksi best-effort untuk bug tertentu.

---

## 6. Cara Menentukan Struktur Data: Framework Praktis

Gunakan flow berikut.

```text
1. Apa entity utama?
2. Apa operasi utama?
3. Operasi mana paling sering?
4. Apakah uniqueness dibutuhkan?
5. Apakah ordering dibutuhkan?
6. Apakah range query dibutuhkan?
7. Apakah priority dibutuhkan?
8. Apakah graph/dependency dibutuhkan?
9. Apakah mutation sering?
10. Apakah data perlu concurrent access?
11. Apakah memory menjadi constraint?
12. Apakah perlu snapshot/immutability?
13. Apa failure mode paling berbahaya?
```

Mari gunakan contoh.

---

## 7. Case Study Kecil: Case Management In-Memory Index

Misal kita punya daftar case:

```java
record CaseRecord(
        String id,
        String externalRef,
        CaseState state,
        Instant createdAt,
        Instant dueAt,
        int severity,
        String assignedOfficerId
) {}

enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    CLOSED,
    REJECTED
}
```

Kebutuhan:

1. Lookup case by ID.
2. Cek duplicate external reference.
3. Ambil case berdasarkan state.
4. Ambil case overdue.
5. Ambil case dengan severity tertinggi untuk escalation.
6. Validasi transition antar state.

Jika kita hanya pakai:

```java
List<CaseRecord> cases;
```

semua operasi menjadi scan.

Untuk data kecil, mungkin cukup. Untuk data besar atau operasi sering, tidak cukup.

Kita bisa desain index:

```java
final class CaseIndex {
    private final Map<String, CaseRecord> byId;
    private final Set<String> externalRefs;
    private final EnumMap<CaseState, List<CaseRecord>> byState;
    private final NavigableMap<Instant, List<CaseRecord>> byDueAt;
    private final PriorityQueue<CaseRecord> byEscalationPriority;

    CaseIndex(List<CaseRecord> cases) {
        this.byId = new HashMap<>();
        this.externalRefs = new HashSet<>();
        this.byState = new EnumMap<>(CaseState.class);
        this.byDueAt = new TreeMap<>();
        this.byEscalationPriority = new PriorityQueue<>(
                Comparator.comparingInt(CaseRecord::severity).reversed()
                        .thenComparing(CaseRecord::dueAt)
                        .thenComparing(CaseRecord::id)
        );

        for (CaseState state : CaseState.values()) {
            byState.put(state, new ArrayList<>());
        }

        for (CaseRecord c : cases) {
            add(c);
        }
    }

    private void add(CaseRecord c) {
        CaseRecord previous = byId.putIfAbsent(c.id(), c);
        if (previous != null) {
            throw new IllegalArgumentException("Duplicate case id: " + c.id());
        }

        if (!externalRefs.add(c.externalRef())) {
            throw new IllegalArgumentException("Duplicate external ref: " + c.externalRef());
        }

        byState.get(c.state()).add(c);
        byDueAt.computeIfAbsent(c.dueAt(), ignored -> new ArrayList<>()).add(c);
        byEscalationPriority.add(c);
    }

    CaseRecord getById(String id) {
        return byId.get(id);
    }

    List<CaseRecord> getByState(CaseState state) {
        return List.copyOf(byState.get(state));
    }

    List<CaseRecord> overdueAt(Instant now) {
        return byDueAt.headMap(now, true)
                .values()
                .stream()
                .flatMap(List::stream)
                .toList();
    }

    CaseRecord peekHighestEscalationCandidate() {
        return byEscalationPriority.peek();
    }
}
```

Ini bukan selalu desain terbaik. Tapi contoh ini menunjukkan pemikiran DSA:

| Requirement | Struktur |
|---|---|
| lookup by ID | `HashMap` |
| duplicate external ref | `HashSet` |
| grouping by enum state | `EnumMap<State, List<...>>` |
| overdue range query | `TreeMap` / `NavigableMap` |
| highest priority | `PriorityQueue` |

Namun desain ini punya masalah penting.

---

### 7.1 Masalah Consistency Antar Index

Jika case berubah state, semua index terkait harus update.

Misalnya:

```text
state: SUBMITTED -> ESCALATED
dueAt: berubah
severity: berubah
```

Maka struktur yang perlu diubah:

- `byId`, jika record immutable diganti,
- `byState`, pindah bucket,
- `byDueAt`, pindah due bucket,
- `byEscalationPriority`, priority perlu update.

`PriorityQueue` tidak otomatis reorder jika object di dalamnya berubah.

Ini salah satu lesson terpenting:

> Semakin banyak index, semakin mahal menjaga consistency mutation.

Jadi desain index cocok untuk:

- read-heavy snapshot,
- immutable records,
- rebuild-on-update,
- controlled mutation API.

Jika write-heavy, index strategy harus lebih hati-hati.

---

### 7.2 Alternative: Immutable Snapshot Index

Jika data case dibaca sering dan diupdate dalam batch, kita bisa buat snapshot immutable:

```java
final class CaseIndexSnapshot {
    private final Map<String, CaseRecord> byId;
    private final EnumMap<CaseState, List<CaseRecord>> byState;

    CaseIndexSnapshot(List<CaseRecord> cases) {
        Map<String, CaseRecord> tempById = new HashMap<>();
        EnumMap<CaseState, List<CaseRecord>> tempByState = new EnumMap<>(CaseState.class);

        for (CaseState state : CaseState.values()) {
            tempByState.put(state, new ArrayList<>());
        }

        for (CaseRecord c : cases) {
            if (tempById.putIfAbsent(c.id(), c) != null) {
                throw new IllegalArgumentException("Duplicate id: " + c.id());
            }
            tempByState.get(c.state()).add(c);
        }

        this.byId = Map.copyOf(tempById);

        this.byState = new EnumMap<>(CaseState.class);
        for (Map.Entry<CaseState, List<CaseRecord>> e : tempByState.entrySet()) {
            this.byState.put(e.getKey(), List.copyOf(e.getValue()));
        }
    }

    CaseRecord getById(String id) {
        return byId.get(id);
    }

    List<CaseRecord> byState(CaseState state) {
        return byState.getOrDefault(state, List.of());
    }
}
```

Kelebihan:

- read aman,
- tidak ada partial mutation,
- cocok untuk publish new version,
- mudah dites.

Kekurangan:

- rebuild cost,
- memory spike saat membangun snapshot baru,
- stale snapshot jika update sangat sering.

---

## 8. DSA sebagai Invariant Design

Invariant adalah kondisi yang harus selalu benar.

Contoh invariant:

1. Case ID unik.
2. External reference unik untuk active case.
3. Closed case tidak boleh pindah ke under review.
4. Escalated case harus punya assigned officer.
5. Deadline index harus berisi semua case non-closed.
6. Graph transition tidak boleh punya unreachable mandatory state.
7. Dependency graph tidak boleh cycle jika dependency dimaknai sebagai urutan wajib.

DSA yang baik membuat invariant mudah dijaga.

Contoh transition validation:

```java
enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    CLOSED,
    REJECTED
}

final class CaseTransitions {
    private final EnumMap<CaseState, EnumSet<CaseState>> allowed;

    CaseTransitions() {
        allowed = new EnumMap<>(CaseState.class);
        allowed.put(CaseState.DRAFT, EnumSet.of(CaseState.SUBMITTED));
        allowed.put(CaseState.SUBMITTED, EnumSet.of(CaseState.UNDER_REVIEW, CaseState.REJECTED));
        allowed.put(CaseState.UNDER_REVIEW, EnumSet.of(CaseState.ESCALATED, CaseState.CLOSED, CaseState.REJECTED));
        allowed.put(CaseState.ESCALATED, EnumSet.of(CaseState.CLOSED, CaseState.REJECTED));
        allowed.put(CaseState.CLOSED, EnumSet.noneOf(CaseState.class));
        allowed.put(CaseState.REJECTED, EnumSet.noneOf(CaseState.class));
    }

    boolean canMove(CaseState from, CaseState to) {
        return allowed.getOrDefault(from, EnumSet.noneOf(CaseState.class)).contains(to);
    }
}
```

Kenapa ini bagus?

- Key domain dibatasi oleh enum.
- Transition direpresentasikan eksplisit.
- Lookup murah.
- Invalid transition mudah dites.
- Bisa dianalisis sebagai graph.

DSA di sini bukan “algoritma graph yang rumit”. Ini representasi state machine yang benar.

---

## 9. DSA dan Failure Modeling

Engineer biasa bertanya:

> “Apakah ini jalan?”

Engineer kuat bertanya:

> “Bagaimana ini gagal saat data besar, input buruk, mutation paralel, atau invariant dilanggar?”

Berikut failure mode umum.

---

### 9.1 Accidental Quadratic Complexity

Contoh:

```java
for (Order order : orders) {
    if (vipUserIds.contains(order.userId())) {
        markVip(order);
    }
}
```

Jika `vipUserIds` adalah `List`, ini bisa menjadi `O(n*m)`.

Perbaikan:

```java
Set<String> vipUserIdSet = new HashSet<>(vipUserIds);
for (Order order : orders) {
    if (vipUserIdSet.contains(order.userId())) {
        markVip(order);
    }
}
```

---

### 9.2 Memory Leak via Collection

Collection yang application-scoped bisa menahan object terlalu lama.

```java
static final Map<String, SessionData> sessions = new HashMap<>();
```

Jika entry tidak pernah dihapus, memory akan tumbuh.

Solusi tergantung kebutuhan:

- TTL cache,
- size-bounded cache,
- explicit lifecycle remove,
- weak reference jika semantiknya tepat,
- external cache dengan eviction.

Jangan menyebut semua map sebagai cache jika tidak ada eviction policy.

---

### 9.3 Unbounded Queue

```java
Queue<Job> queue = new ConcurrentLinkedQueue<>();
```

Jika producer lebih cepat dari consumer, queue tumbuh tanpa batas.

Masalahnya bukan queue-nya. Masalahnya tidak ada backpressure.

Solusi bisa berupa:

- bounded queue,
- rejection policy,
- rate limiting,
- load shedding,
- persistence-backed queue,
- partitioned queue.

---

### 9.4 Mutable Object in Sorted/Priority Structure

Jika object di dalam `TreeSet` atau `PriorityQueue` berubah field ordering-nya, struktur tidak otomatis memperbaiki posisinya.

Contoh:

```java
PriorityQueue<Task> queue = new PriorityQueue<>(Comparator.comparing(Task::priority));
Task task = new Task("T1", 10);
queue.add(task);

task.setPriority(1);
```

Queue bisa menjadi tidak valid secara logis.

Solusi:

- jangan mutate field priority setelah insert,
- remove lalu insert ulang,
- gunakan immutable task,
- gunakan lazy deletion/versioning.

---

### 9.5 Hidden Ordering Dependency

Kode tampak bekerja karena order `HashMap` pada dataset tertentu terlihat stabil.

```java
for (Map.Entry<String, Rule> e : rules.entrySet()) {
    apply(e.getValue());
}
```

Jika business logic bergantung pada urutan, gunakan struktur yang menyatakan urutan:

- `List<Rule>` jika rule order eksplisit,
- `LinkedHashMap` jika key lookup + insertion order,
- `TreeMap` jika sorted by key,
- `PriorityQueue` jika priority consumption.

---

## 10. DSA dan API Design

Struktur data internal sebaiknya tidak selalu diekspos langsung.

Contoh buruk:

```java
class RuleRegistry {
    private final Map<String, Rule> rules = new HashMap<>();

    Map<String, Rule> rules() {
        return rules;
    }
}
```

Caller bisa mutate internal state.

Lebih baik:

```java
class RuleRegistry {
    private final Map<String, Rule> rules = new HashMap<>();

    Optional<Rule> findByCode(String code) {
        return Optional.ofNullable(rules.get(code));
    }

    List<Rule> allRules() {
        return List.copyOf(rules.values());
    }
}
```

Lebih baik lagi jika domain operation eksplisit:

```java
boolean isAllowed(String ruleCode, CaseContext context) {
    Rule rule = rules.get(ruleCode);
    return rule != null && rule.evaluate(context);
}
```

Prinsip:

> Jangan expose struktur data jika yang dibutuhkan caller adalah kemampuan domain.

Karena begitu `Map` diekspos, kamu kehilangan kontrol atas:

- mutation,
- invariant,
- ordering,
- null handling,
- concurrency,
- lifecycle.

---

## 11. DSA dan Testing Strategy

Struktur data dan algoritma harus dites dengan cara yang lebih kuat dari happy path.

---

### 11.1 Test Invariant

Contoh:

```java
@Test
void duplicateCaseIdShouldFail() {
    List<CaseRecord> cases = List.of(
            new CaseRecord("C1", "EXT-1", CaseState.SUBMITTED, Instant.now(), Instant.now(), 1, "U1"),
            new CaseRecord("C1", "EXT-2", CaseState.SUBMITTED, Instant.now(), Instant.now(), 1, "U2")
    );

    assertThrows(IllegalArgumentException.class, () -> new CaseIndex(cases));
}
```

---

### 11.2 Test Boundary Size

- empty input,
- one item,
- duplicate item,
- all same state,
- all unique state,
- very large input,
- pathological ordering,
- null if allowed/not allowed.

---

### 11.3 Test Mutation Safety

Jika API mengembalikan list:

```java
List<CaseRecord> result = index.getByState(CaseState.SUBMITTED);
result.clear();
```

Apakah internal index rusak?

Jika tidak boleh, test harus memastikan mutation caller tidak memengaruhi internal state.

---

### 11.4 Test Consistency Antar Index

Jika struktur punya banyak index, setiap update harus menjaga semua index.

Contoh property:

```text
For every case in byId:
- it appears in exactly one state bucket
- it appears in due date index if not closed
- external ref set contains its externalRef
```

Testing seperti ini lebih penting daripada hanya test output satu method.

---

## 12. DSA Decision Table Awal

Gunakan tabel ini sebagai orientasi awal. Detailnya akan dibahas di part masing-masing.

| Kebutuhan | Kandidat awal | Catatan |
|---|---|---|
| Urutan linear dan traversal cepat | `ArrayList` | default list yang sering paling praktis |
| Banyak insert/delete di dua ujung | `ArrayDeque` | stack/queue/deque modern |
| Membership unik | `HashSet` | butuh `equals/hashCode` benar |
| Lookup by key | `HashMap` | sizing dan key stability penting |
| Key enum | `EnumMap` | compact dan jelas secara domain |
| Set enum | `EnumSet` | sangat cocok untuk flags/state kecil |
| Insertion order map | `LinkedHashMap` | juga bisa access-order untuk LRU sederhana |
| Sorted key/range query | `TreeMap` / `NavigableMap` | comparator harus benar |
| Priority processing | `PriorityQueue` | jangan mutate priority in-place |
| Prefix search | Trie | memory trade-off besar |
| Dependency/reachability | Graph adjacency list | cycle handling penting |
| Dynamic grouping | Union-Find | cocok untuk connected components |
| Range aggregation | Segment tree/Fenwick | cocok untuk query numerik tertentu |
| Dense boolean flags | `BitSet` | compact |
| Read-heavy config | immutable snapshot | simple concurrency model |
| Multi-threaded lookup/update | `ConcurrentHashMap` | compound operation tetap perlu hati-hati |
| Producer-consumer | `BlockingQueue` | bounded lebih aman untuk backpressure |

---

## 13. Mental Model: Representasi Mengikuti Pertanyaan

Jangan mulai dari struktur. Mulai dari pertanyaan.

Contoh:

### Pertanyaan 1

> “Apakah ID ini sudah pernah diproses?”

Struktur natural:

```java
Set<String> processedIds;
```

### Pertanyaan 2

> “Ambil data case berdasarkan ID.”

Struktur natural:

```java
Map<String, CaseRecord> byId;
```

### Pertanyaan 3

> “Ambil semua case due sebelum waktu tertentu.”

Struktur natural:

```java
NavigableMap<Instant, List<CaseRecord>> byDueAt;
```

### Pertanyaan 4

> “Ambil next case paling urgent.”

Struktur natural:

```java
PriorityQueue<CaseRecord> queue;
```

### Pertanyaan 5

> “Apakah state A bisa pindah ke state B?”

Struktur natural:

```java
EnumMap<CaseState, EnumSet<CaseState>> transitionTable;
```

### Pertanyaan 6

> “Jika service X gagal, service apa saja terdampak?”

Struktur natural:

```java
Map<ServiceId, List<ServiceId>> dependencyGraph;
```

DSA yang baik lahir dari query pattern.

---

## 14. Cara Mengevaluasi Solusi DSA

Setiap kali kamu membuat solusi, pakai checklist berikut.

### 14.1 Correctness

- Apa invariant utama?
- Apa input invalid?
- Apakah duplicate ditangani?
- Apakah null ditangani?
- Apakah ordering deterministik jika dibutuhkan?
- Apakah mutation bisa merusak struktur?
- Apakah equality/hash/comparator benar?

### 14.2 Complexity

- Build time berapa?
- Lookup time berapa?
- Insert/update/delete berapa?
- Memory tambahan berapa?
- Worst-case apa?
- Apakah ada amortized spike?

### 14.3 Operational Fit

- Cocok untuk data size target?
- Cocok untuk read/write ratio?
- Cocok untuk latency target?
- Cocok untuk heap budget?
- Cocok untuk concurrency model?
- Mudah diobservasi/profiling?

### 14.4 Maintainability

- Apakah struktur terlalu kompleks?
- Apakah invariant terlihat di kode?
- Apakah update path terpusat?
- Apakah mudah dites?
- Apakah future engineer bisa memahami alasan pemilihan struktur?

---

## 15. DSA dan Top 1% Engineering Mindset

Engineer kuat bukan yang selalu memilih algoritma paling canggih.

Engineer kuat memilih solusi yang:

1. cukup cepat,
2. benar secara invariant,
3. hemat memory secara masuk akal,
4. predictable saat data membesar,
5. failure mode-nya diketahui,
6. mudah dites,
7. mudah dipelihara,
8. tidak menyembunyikan complexity di tempat yang salah.

Kadang solusi terbaik adalah `HashMap` sederhana.

Kadang solusi terbaik adalah sorted array + binary search.

Kadang solusi terbaik adalah rebuild immutable snapshot setiap ada config publish.

Kadang solusi terbaik adalah tidak membuat index karena data kecil dan mutation kompleks.

Kadang solusi terbaik adalah memindahkan masalah ke database index, bukan in-memory DSA.

Kuncinya bukan hafal struktur data. Kuncinya adalah tahu trade-off.

---

## 16. Latihan Mental

Jawab sendiri sebelum lanjut ke part berikutnya.

### Latihan 1

Kamu punya 500.000 user ID dan perlu mengecek apakah setiap order dimiliki user valid.

Orders: 2.000.000 item.

Pilihan:

```java
List<String> validUserIds;
Set<String> validUserIds;
```

Pertanyaan:

1. Apa complexity masing-masing?
2. Apa biaya membangun set?
3. Kapan list masih acceptable?
4. Apa risiko memory dari set?

---

### Latihan 2

Kamu punya rule yang harus dievaluasi sesuai priority dan effective date.

Pertanyaan:

1. Apakah `HashMap` cukup?
2. Apakah butuh `List` sorted?
3. Apakah butuh `TreeMap`?
4. Apakah priority berubah runtime?
5. Apakah rule evaluation harus deterministic?

---

### Latihan 3

Kamu punya workflow state:

```text
DRAFT -> SUBMITTED -> REVIEW -> APPROVED -> CLOSED
                         |-> REJECTED
```

Pertanyaan:

1. Representasi apa yang cocok?
2. Bagaimana validasi transition?
3. Bagaimana mendeteksi unreachable state?
4. Bagaimana jika ada transition balik?
5. Apakah ini tree, graph, atau state machine?

---

### Latihan 4

Kamu punya cache response external API.

Pertanyaan:

1. Apakah cukup `HashMap`?
2. Bagaimana eviction?
3. Bagaimana TTL?
4. Bagaimana mencegah cache stampede?
5. Apakah key immutable?
6. Apakah response boleh stale?

---

## 17. Ringkasan Part 000

Poin utama:

1. DSA bukan hanya interview skill.
2. Struktur data adalah API, representasi, performance contract, dan correctness boundary.
3. Big-O penting tetapi tidak cukup.
4. Java punya karakteristik khusus:
   - object identity,
   - `equals/hashCode`,
   - reference semantics,
   - boxing,
   - comparator contract,
   - iteration order,
   - fail-fast iterator.
5. Struktur data harus dipilih berdasarkan:
   - entity,
   - operation,
   - frequency,
   - constraint,
   - ordering,
   - mutation,
   - lifetime,
   - concurrency,
   - failure mode.
6. Index mempercepat read tetapi menambah biaya memory dan consistency.
7. Immutable snapshot sering sangat kuat untuk read-heavy configuration/data.
8. Banyak bug DSA di sistem nyata bukan karena algoritma sulit, tetapi karena invariant tidak eksplisit.
9. Engineer top-tier memilih struktur data berdasarkan trade-off, bukan kebiasaan.

---

## 18. Preview Part Berikutnya

Part berikutnya:

```text
learn-java-dsa-part-001.md
```

Judul:

```text
Part 001 — Complexity Analysis yang Realistis di Java
```

Fokus part berikutnya:

1. Big-O, Big-Theta, Big-Omega secara praktis.
2. Worst-case, average-case, amortized-case.
3. Kenapa `O(1)` tidak selalu cepat.
4. Cost model Java:
   - object allocation,
   - pointer chasing,
   - boxing,
   - JIT warmup,
   - GC pressure,
   - memory locality.
5. Cara menghitung biaya operasi berdasarkan operation mix.
6. Cara melihat hidden `O(n²)` di kode aplikasi.
7. Cara membuat complexity table untuk desain engineering.

---

## 19. Status Seri

Seri **belum selesai**.

Kita baru menyelesaikan:

```text
Part 000 dari 030
```

Masih tersisa:

```text
Part 001 sampai Part 030
```

---

## 20. Referensi Utama

Referensi ini tidak dimaksudkan sebagai bacaan wajib sebelum lanjut, tetapi menjadi basis akurasi untuk konsep Java-specific yang akan muncul berulang di seri ini.

1. Oracle Java Documentation — Java Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

2. Oracle Java Documentation — `java.lang.Object`, especially `equals` / `hashCode` contract  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html

3. Oracle Java Documentation — `java.util.Map` contract  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

4. Oracle Java Documentation — `SequencedCollection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html

5. OpenJDK JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

6. OpenJDK JOL — Java Object Layout  
   https://openjdk.org/projects/code-tools/jol/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering — Part 35](../deployment/learn-java-deployment-runtime-release-delivery-engineering-part-35-final-mastery-review.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-001.md](./learn-java-dsa-part-001.md)

</div>