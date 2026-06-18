# learn-java-dsa-part-003.md

# Part 003 — Arrays, Dynamic Arrays, `ArrayList`, dan Cost Model-nya

> Seri: **Java Data Structure and Algorithm Advanced**  
> Posisi: **Part 003 dari 030**  
> Prasyarat seri sebelumnya: Java object/reference/equality/hash basics, complexity analysis realistis, Java Collections mental model.  
> Fokus bagian ini: memahami **array-backed structure** secara mendalam: bukan hanya bagaimana memakai `ArrayList`, tetapi bagaimana berpikir tentang indexed storage, capacity, shifting, memory retention, snapshot, binary search, dan failure mode di sistem nyata.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan perbedaan antara **array**, **dynamic array**, dan **`ArrayList`** dari sisi invariant, cost, dan memory.
2. Membaca operasi list bukan hanya sebagai API, tetapi sebagai konsekuensi dari layout penyimpanan.
3. Menentukan kapan array lebih tepat daripada `ArrayList`, kapan `ArrayList` cukup, dan kapan struktur lain lebih cocok.
4. Menghindari bug umum seperti:
   - accidental `O(n^2)`,
   - memory retention karena backing array,
   - salah paham `subList`,
   - remove sambil iterasi,
   - binary search pada data tidak sorted,
   - mengandalkan capacity sebagai size,
   - mutasi list yang diekspos keluar.
5. Mendesain struktur data kecil berbasis array untuk kasus nyata: batch buffer, snapshot, ring-like append buffer, validation result, dan sorted lookup.
6. Menganalisis `ArrayList` dengan sudut pandang engineering: **operation frequency**, **growth policy**, **allocation spikes**, **copy cost**, **cache locality**, dan **GC pressure**.

---

## 1. Mental Model Utama

Array-backed structure adalah struktur data yang menyimpan elemen di dalam slot-slot berindeks:

```text
index:   0    1    2    3    4    5
value:  [A]  [B]  [C]  [D]  [ ]  [ ]
              ^ logical elements       ^ reserved capacity
```

Ada dua konsep yang harus selalu dipisahkan:

| Konsep | Makna |
|---|---|
| **size** | jumlah elemen yang secara logis menjadi isi collection |
| **capacity** | jumlah slot fisik yang sudah dialokasikan untuk menampung elemen |

Pada array biasa, size fisik tetap. Pada dynamic array seperti `ArrayList`, kapasitas bisa bertambah ketika size melewati capacity.

Mental model paling penting:

> **Array-backed structure menukar biaya insert/delete tengah yang mahal dengan random access yang sangat murah dan locality yang bagus.**

Artinya:

- membaca `list.get(i)` murah,
- append biasanya murah,
- insert di tengah mahal,
- delete di tengah mahal,
- resize kadang mahal,
- traversal umumnya sangat cache-friendly dibanding node chain.

---

## 2. Array sebagai Struktur Data Paling Dasar

Di Java, array adalah object khusus dengan panjang tetap.

Contoh:

```java
int[] numbers = new int[5];
String[] names = new String[3];
```

Untuk `int[]`, slot menyimpan nilai primitive secara langsung:

```text
int[]
+---+---+---+---+
| 1 | 2 | 3 | 4 |
+---+---+---+---+
```

Untuk `String[]`, slot menyimpan reference ke object:

```text
String[]
+-----+-----+-----+
| ref | ref | ref |
+--|--+--|--+--|--+
   v     v     v
 "A"   "B"   "C"
```

Ini penting karena cost-nya berbeda:

| Array | Isi slot | Dampak |
|---|---|---|
| `int[]` | value langsung | compact, locality bagus, tanpa boxing |
| `Integer[]` | reference ke `Integer` | pointer chasing, object overhead, potensi cache miss |
| `Object[]` | reference polymorphic | fleksibel, tetapi lebih mahal dari primitive array |

---

## 3. Fixed Size vs Dynamic Size

Array biasa punya panjang tetap:

```java
int[] a = new int[3];
a[0] = 10;
a[1] = 20;
a[2] = 30;
// a[3] = 40; // ArrayIndexOutOfBoundsException
```

Jika ingin “menambah” elemen, sebenarnya kita harus membuat array baru dan menyalin isi lama:

```java
int[] oldArray = {10, 20, 30};
int[] newArray = new int[oldArray.length + 1];
System.arraycopy(oldArray, 0, newArray, 0, oldArray.length);
newArray[3] = 40;
```

Dynamic array mengotomatiskan pola tersebut:

```text
append until full
if full:
    allocate bigger array
    copy old elements
    append new element
```

`ArrayList` adalah dynamic array untuk object references.

---

## 4. `ArrayList` sebagai Dynamic Array

`ArrayList<E>` adalah implementasi `List` berbasis array resizable. Dokumentasi Java menyatakan bahwa `ArrayList` adalah **resizable-array implementation** dari `List`, mendukung semua optional list operations, menerima `null`, dan menyediakan method untuk memanipulasi ukuran array internal yang digunakan untuk menyimpan list.

Secara konseptual:

```java
public class ArrayList<E> {
    private Object[] elementData; // backing array
    private int size;             // logical element count
}
```

Diagram:

```text
ArrayList object
+-------------------+
| elementData  ---- |----> Object[] capacity = 10
| size = 4          |      +-----+-----+-----+-----+------+------+...
+-------------------+      | ref | ref | ref | ref | null | null |
                           +--|--+--|--+--|--+--|--+------+------+...
                              v     v     v     v
                              A     B     C     D
```

Ingat:

- `size()` bukan panjang backing array.
- capacity bukan bagian dari public `List` contract.
- `ensureCapacity` dan `trimToSize` adalah API spesifik `ArrayList`, bukan `List`.

---

## 5. Invariant `ArrayList`

Untuk memahami operasi `ArrayList`, pegang invariant ini:

```text
0 <= size <= elementData.length

Elemen valid berada pada index:
0 <= i < size

Slot di luar size bukan bagian dari list logis:
size <= i < elementData.length
```

Contoh:

```text
size = 3
capacity = 6

index:       0      1      2      3      4      5
slot:       [A]    [B]    [C]   [ ]    [ ]    [ ]
logical:     yes    yes    yes    no     no     no
```

Implikasi:

- `get(2)` valid.
- `get(3)` invalid meskipun backing array punya slot index 3.
- `add(D)` dapat menaruh `D` di index 3 tanpa resize.
- `set(3, D)` invalid jika `size == 3`, karena `set` mengganti elemen yang sudah ada, bukan menambah elemen baru.

---

## 6. Operation Cost Dasar

### 6.1 `get(index)`

```java
E value = list.get(i);
```

Cost:

```text
O(1)
```

Kenapa?

Karena alamat slot bisa dihitung langsung dari base address + offset index. Secara high-level:

```text
slotAddress = base + index * referenceSize
```

Di Java detail alamat sebenarnya disembunyikan oleh JVM, tetapi mental model indexed access tetap berlaku.

### 6.2 `set(index, value)`

```java
list.set(i, value);
```

Cost:

```text
O(1)
```

Karena mengganti isi slot tertentu.

### 6.3 `add(value)` di akhir

```java
list.add(value);
```

Jika masih ada capacity:

```text
O(1)
```

Jika capacity penuh:

```text
O(n)
```

karena harus allocate array baru dan copy elemen lama.

Secara amortized:

```text
O(1) amortized
```

Artinya, jika dilakukan banyak append, rata-rata biaya per append tetap konstan, walaupun beberapa append tertentu mahal.

### 6.4 `add(index, value)` di tengah

```java
list.add(i, value);
```

Harus menggeser elemen dari `i` sampai `size - 1` ke kanan.

```text
before:
index: 0  1  2  3
value: A  B  C  D

add(1, X)

shift:
D -> index 4
C -> index 3
B -> index 2

result:
index: 0  1  2  3  4
value: A  X  B  C  D
```

Cost:

```text
O(n - i)
```

Worst-case:

```text
O(n)
```

### 6.5 `remove(index)` di tengah

```java
list.remove(i);
```

Harus menggeser elemen setelah `i` ke kiri.

```text
before:
index: 0  1  2  3
value: A  B  C  D

remove(1)

shift:
C -> index 1
D -> index 2

result:
index: 0  1  2
value: A  C  D
```

Cost:

```text
O(n - i)
```

Worst-case:

```text
O(n)
```

### 6.6 `contains(value)`

```java
list.contains(value);
```

Harus scan dari awal sampai ketemu.

Cost:

```text
O(n)
```

Dan setiap comparison memakai `equals`.

Jika `equals` mahal, maka cost sebenarnya:

```text
O(n * costOfEquals)
```

---

## 7. Kenapa Append `ArrayList` Disebut Amortized O(1)

Dynamic array biasanya tidak tumbuh satu slot demi satu slot. Jika setiap append ketika penuh hanya menambah capacity +1, maka setiap append setelah penuh akan copy hampir seluruh array. Itu buruk.

Strategi umum dynamic array:

```text
grow by factor, not by one
```

Misalnya capacity bertumbuh seperti:

```text
10 -> 15 -> 22 -> 33 -> 49 -> ...
```

atau secara umum:

```text
newCapacity ≈ oldCapacity * growthFactor
```

Akibatnya, resize tidak terjadi setiap append. Resize terjadi sesekali, dan biaya copy besar tersebar ke banyak operasi append murah.

Contoh sederhana:

```text
capacity 4
add 1: cheap
add 2: cheap
add 3: cheap
add 4: cheap
add 5: resize copy 4 + add
add 6: cheap
add 7: cheap
add 8: cheap
...
```

Total biaya untuk banyak append tetap linear terhadap jumlah elemen, sehingga rata-rata per append konstan.

Namun, di production, jangan berhenti di “amortized O(1)”. Tanyakan:

1. Apakah resize spike bisa mengganggu latency?
2. Apakah list besar membuat copy mahal?
3. Apakah allocation array baru memicu GC pressure?
4. Apakah append terjadi di hot path request?
5. Apakah ukuran akhir sudah bisa diprediksi?

Jika ukuran akhir bisa diprediksi, gunakan initial capacity.

```java
List<String> ids = new ArrayList<>(expectedCount);
```

Atau jika variabel bertipe konkret:

```java
ArrayList<String> ids = new ArrayList<>();
ids.ensureCapacity(expectedCount);
```

---

## 8. Initial Capacity: Optimasi yang Sering Diremehkan

Misalnya kita tahu akan menampung 50.000 ID:

```java
List<Long> ids = new ArrayList<>();
for (long id : sourceIds) {
    ids.add(id);
}
```

Secara fungsional benar. Tapi secara performa, list mungkin mengalami beberapa kali resize dan copy.

Lebih baik:

```java
List<Long> ids = new ArrayList<>(sourceIds.size());
for (long id : sourceIds) {
    ids.add(id);
}
```

Atau jika sumber bukan collection tetapi count diketahui:

```java
ArrayList<Long> ids = new ArrayList<>(expectedCount);
```

Manfaat:

- mengurangi allocation backing array baru,
- mengurangi copy elemen lama,
- mengurangi temporary garbage,
- mengurangi latency spike.

Namun jangan juga over-allocate sembarangan.

```java
new ArrayList<>(10_000_000)
```

Jika ternyata hanya isi 10 elemen, kamu membuang memory besar.

Rule of thumb:

| Situasi | Initial capacity? |
|---|---|
| Ukuran kecil/tidak diketahui | tidak wajib |
| Ukuran diketahui dari input collection | ya |
| Batch besar | ya |
| Hot path latency-sensitive | ya, jika bisa diprediksi |
| Data sangat sparse/tidak pasti | hati-hati |

---

## 9. `trimToSize`: Bukan Magic Memory Fix

`trimToSize()` mengecilkan capacity `ArrayList` agar mendekati size logis.

Contoh:

```java
ArrayList<String> list = new ArrayList<>(1_000_000);
list.add("A");
list.add("B");

list.trimToSize();
```

Secara konseptual:

```text
before:
size = 2
capacity = 1_000_000

after trim:
size = 2
capacity = 2
```

Kapan berguna?

- list besar selesai dibangun,
- setelah itu mostly read-only,
- list akan disimpan lama,
- capacity jauh lebih besar dari size.

Kapan tidak berguna atau malah merugikan?

- list masih akan sering ditambah,
- list short-lived,
- list segera eligible for GC,
- trimming menyebabkan allocation/copy tambahan.

`trimToSize()` juga bukan guarantee instant memory returned ke OS. Ia membuat backing array lama tidak lagi direferensikan oleh list, tetapi reclamation tetap bergantung pada GC dan JVM memory management.

---

## 10. Memory Retention Problem

Salah satu failure mode penting: list kecil bisa tetap menahan backing array besar.

Contoh:

```java
ArrayList<byte[]> buffers = new ArrayList<>(100_000);

for (int i = 0; i < 100_000; i++) {
    buffers.add(new byte[1024]);
}

buffers.clear();
```

Setelah `clear()`:

- semua element reference dihapus dari slot logis,
- object `byte[]` lama bisa eligible for GC,
- tetapi backing array `Object[]` milik `buffers` tetap punya capacity besar.

Jika `buffers` sendiri long-lived, backing array tetap tertahan.

Pola masalah:

```java
class ReusableBuffer {
    private final ArrayList<Object> items = new ArrayList<>();

    void processHugeBatch(List<Object> input) {
        items.clear();
        items.addAll(input);
        // process
        items.clear();
    }
}
```

Jika suatu saat input sangat besar, `items` bisa mempertahankan capacity besar untuk waktu lama.

Solusi tergantung konteks:

### 10.1 Recreate list jika batch sangat besar

```java
class Processor {
    private ArrayList<Object> items = new ArrayList<>();

    void resetAfterBatch() {
        if (items.size() > 10_000) {
            items = new ArrayList<>();
        } else {
            items.clear();
        }
    }
}
```

### 10.2 Trim jika list akan dipakai lagi tapi mostly kecil

```java
items.clear();
items.trimToSize();
```

Namun trimming setiap request bisa mahal.

### 10.3 Gunakan local variable untuk batch temporary

```java
void process(List<Input> input) {
    ArrayList<Result> results = new ArrayList<>(input.size());
    // use results
} // eligible for GC after method returns
```

---

## 11. `subList`: View, Bukan Copy

`List.subList(from, to)` mengembalikan view terhadap list asal, bukan copy independen.

Contoh:

```java
List<String> names = new ArrayList<>(List.of("A", "B", "C", "D"));
List<String> middle = names.subList(1, 3);

System.out.println(middle); // [B, C]

middle.set(0, "X");
System.out.println(names);  // [A, X, C, D]
```

Ini bisa berguna karena murah: tidak copy elemen.

Tapi bisa berbahaya:

```java
List<String> names = new ArrayList<>(List.of("A", "B", "C", "D"));
List<String> middle = names.subList(1, 3);

names.add("E");

System.out.println(middle); // bisa ConcurrentModificationException
```

Kenapa?

Karena view mengandalkan struktur list asal. Jika list asal berubah secara struktural di luar view, view bisa menjadi invalid.

### 11.1 `subList` dan memory retention

Masalah lain: sublist bisa menahan referensi ke parent list/backing storage.

Jika kamu mengambil potongan kecil dari list besar dan menyimpannya lama:

```java
List<BigObject> huge = loadHugeList();
List<BigObject> smallView = huge.subList(0, 10);
storeForLongTime(smallView);
```

Secara konseptual, `smallView` bisa membuat list besar tetap tertahan karena ia view terhadap parent.

Jika butuh potongan independen, copy:

```java
List<BigObject> smallCopy = new ArrayList<>(huge.subList(0, 10));
```

Atau immutable snapshot:

```java
List<BigObject> smallSnapshot = List.copyOf(huge.subList(0, 10));
```

---

## 12. `List.of`, `List.copyOf`, `Collections.unmodifiableList`, dan `ArrayList`

Banyak bug muncul karena orang mencampur konsep:

| API | Makna umum |
|---|---|
| `new ArrayList<>()` | mutable dynamic array |
| `List.of(...)` | unmodifiable list, tidak menerima `null` |
| `List.copyOf(collection)` | unmodifiable copy/snapshot, tidak menerima `null` |
| `Collections.unmodifiableList(list)` | unmodifiable view terhadap list asal |

Contoh view:

```java
List<String> mutable = new ArrayList<>();
mutable.add("A");

List<String> readonlyView = Collections.unmodifiableList(mutable);

mutable.add("B");
System.out.println(readonlyView); // [A, B]
```

Readonly view tidak bisa dimutasi lewat `readonlyView`, tetapi tetap berubah jika backing list berubah.

Snapshot:

```java
List<String> mutable = new ArrayList<>();
mutable.add("A");

List<String> snapshot = List.copyOf(mutable);

mutable.add("B");
System.out.println(snapshot); // [A]
```

Untuk API design, bedakan:

```java
// Exposes mutable internal list: dangerous
public List<Item> items() {
    return items;
}

// Read-only view, still live
public List<Item> itemsView() {
    return Collections.unmodifiableList(items);
}

// Snapshot, safer for external consumers
public List<Item> itemsSnapshot() {
    return List.copyOf(items);
}
```

---

## 13. Iteration dan Fail-Fast Behavior

`ArrayList` iterator bersifat fail-fast secara best-effort: jika list dimodifikasi secara struktural di luar iterator saat iterasi, iterator dapat melempar `ConcurrentModificationException`.

Contoh salah:

```java
List<String> items = new ArrayList<>(List.of("A", "B", "C"));

for (String item : items) {
    if (item.equals("B")) {
        items.remove(item); // dangerous during enhanced-for
    }
}
```

Solusi 1: gunakan iterator remove:

```java
Iterator<String> iterator = items.iterator();
while (iterator.hasNext()) {
    String item = iterator.next();
    if (item.equals("B")) {
        iterator.remove();
    }
}
```

Solusi 2: gunakan `removeIf`:

```java
items.removeIf(item -> item.equals("B"));
```

Solusi 3: buat list baru jika transformasi lebih kompleks:

```java
List<String> filtered = new ArrayList<>(items.size());
for (String item : items) {
    if (!item.equals("B")) {
        filtered.add(item);
    }
}
```

Pilih berdasarkan intent:

| Intent | Pilihan |
|---|---|
| Hapus elemen berdasarkan predicate | `removeIf` |
| Hapus sambil butuh kontrol iterator | `Iterator.remove` |
| Transform/filter menjadi output baru | list baru |
| Butuh snapshot saat source berubah | `List.copyOf` lebih dulu |

---

## 14. Accidental `O(n²)` dengan `ArrayList`

### 14.1 `contains` di nested loop

Contoh buruk:

```java
List<Long> allowedIds = loadAllowedIds();
List<Request> requests = loadRequests();

for (Request request : requests) {
    if (allowedIds.contains(request.userId())) {
        process(request);
    }
}
```

Jika:

```text
requests = 100_000
allowedIds = 100_000
```

Worst-case comparison:

```text
10,000,000,000 comparisons
```

Solusi:

```java
Set<Long> allowedIdSet = new HashSet<>(allowedIds);

for (Request request : requests) {
    if (allowedIdSet.contains(request.userId())) {
        process(request);
    }
}
```

Namun ini baru benar jika:

- equality/hash contract benar,
- memory untuk set cukup,
- order allowed IDs tidak dibutuhkan untuk keputusan.

### 14.2 Remove dari depan berulang

Contoh buruk:

```java
while (!list.isEmpty()) {
    Item item = list.remove(0);
    process(item);
}
```

Setiap `remove(0)` menggeser semua elemen kiri.

Cost total:

```text
O(n²)
```

Solusi:

```java
for (Item item : list) {
    process(item);
}
list.clear();
```

Jika memang butuh queue:

```java
Deque<Item> queue = new ArrayDeque<>(list);
while (!queue.isEmpty()) {
    Item item = queue.removeFirst();
    process(item);
}
```

Atau gunakan index cursor:

```java
for (int i = 0; i < list.size(); i++) {
    process(list.get(i));
}
list.clear();
```

### 14.3 Insert di depan berulang

Contoh buruk:

```java
List<Item> result = new ArrayList<>();
for (Item item : input) {
    result.add(0, item);
}
```

Cost total:

```text
O(n²)
```

Solusi:

```java
List<Item> result = new ArrayList<>(input.size());
for (Item item : input) {
    result.add(item);
}
Collections.reverse(result);
```

Atau gunakan `ArrayDeque` jika operasi memang dominan di depan.

---

## 15. Binary Search pada Array/List

Binary search membutuhkan data sorted berdasarkan ordering yang sama dengan search.

```java
int[] numbers = {1, 3, 5, 7, 9};
int index = Arrays.binarySearch(numbers, 7); // 3
```

Jika tidak ditemukan:

```java
int index = Arrays.binarySearch(numbers, 6);
```

Return value negatif:

```text
-(insertionPoint) - 1
```

Decode:

```java
static int insertionPoint(int binarySearchResult) {
    if (binarySearchResult >= 0) {
        return binarySearchResult;
    }
    return -binarySearchResult - 1;
}
```

Contoh:

```java
int[] numbers = {1, 3, 5, 7, 9};
int result = Arrays.binarySearch(numbers, 6); // -4
int ip = -result - 1; // 3
```

Artinya `6` seharusnya disisipkan di index 3:

```text
1, 3, 5, 6, 7, 9
         ^ insertion point
```

### 15.1 Undefined result jika tidak sorted

Ini sangat penting: binary search pada array/list yang tidak sorted hasilnya tidak valid secara semantik.

```java
int[] numbers = {10, 1, 7, 3};
int index = Arrays.binarySearch(numbers, 7); // meaningless
```

Tidak harus error. Justru itu bahayanya. Ia bisa mengembalikan hasil yang tampak “masuk akal” tapi salah.

### 15.2 Duplicates

Jika ada duplicate, binary search tidak menjamin menemukan duplicate pertama atau terakhir.

```java
int[] numbers = {1, 3, 3, 3, 5};
int index = Arrays.binarySearch(numbers, 3);
```

`index` bisa menunjuk salah satu `3`, bukan guaranteed first/last.

Jika butuh first occurrence, gunakan lower bound.

```java
static int lowerBound(int[] a, int target) {
    int left = 0;
    int right = a.length;

    while (left < right) {
        int mid = left + ((right - left) >>> 1);
        if (a[mid] < target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    return left;
}
```

Upper bound:

```java
static int upperBound(int[] a, int target) {
    int left = 0;
    int right = a.length;

    while (left < right) {
        int mid = left + ((right - left) >>> 1);
        if (a[mid] <= target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    return left;
}
```

Range of equal elements:

```java
int lo = lowerBound(numbers, 3);
int hi = upperBound(numbers, 3);
int count = hi - lo;
```

---

## 16. Sorted Array vs `HashMap` vs `TreeMap`

Misalnya kita punya lookup by ID.

Pilihan:

1. sorted array/list + binary search,
2. `HashMap`,
3. `TreeMap`.

| Struktur | Lookup | Insert | Iterasi sorted | Memory | Cocok untuk |
|---|---:|---:|---:|---:|---|
| Sorted array/list | `O(log n)` | `O(n)` | bagus | rendah | mostly read, batch build, compact |
| `HashMap` | `O(1)` average | `O(1)` average | tidak sorted | lebih tinggi | frequent lookup by exact key |
| `TreeMap` | `O(log n)` | `O(log n)` | sorted/range query | tinggi | dynamic sorted map/range query |

Jika data dibangun sekali lalu dibaca berkali-kali, sorted array bisa sangat menarik.

Contoh:

```java
record Rule(String code, int priority) {}

final class RuleIndex {
    private final Rule[] rules;

    RuleIndex(List<Rule> input) {
        this.rules = input.toArray(Rule[]::new);
        Arrays.sort(this.rules, Comparator.comparing(Rule::code));
    }

    Rule findByCode(String code) {
        int left = 0;
        int right = rules.length - 1;

        while (left <= right) {
            int mid = left + ((right - left) >>> 1);
            int cmp = rules[mid].code().compareTo(code);
            if (cmp < 0) {
                left = mid + 1;
            } else if (cmp > 0) {
                right = mid - 1;
            } else {
                return rules[mid];
            }
        }

        return null;
    }
}
```

Kenapa bisa menarik?

- compact,
- immutable snapshot mudah,
- traversal cepat,
- tidak ada hash overhead,
- deterministic order.

Tapi jika banyak insert/delete dinamis, sorted array menjadi mahal.

---

## 17. Array-backed Snapshot untuk Read-heavy Workload

Dalam sistem enterprise, sering ada config/rule/reference data yang:

- dibaca sangat sering,
- diupdate jarang,
- harus konsisten per versi,
- tidak boleh berubah saat request sedang berjalan.

Contoh:

```java
final class RuleSnapshot {
    private final Rule[] byPriority;

    RuleSnapshot(Collection<Rule> rules) {
        this.byPriority = rules.toArray(Rule[]::new);
        Arrays.sort(this.byPriority, Comparator.comparingInt(Rule::priority));
    }

    List<Rule> applicableRules(Request request) {
        ArrayList<Rule> result = new ArrayList<>();
        for (Rule rule : byPriority) {
            if (rule.matches(request)) {
                result.add(rule);
            }
        }
        return result;
    }
}
```

Snapshot replacement:

```java
final class RuleService {
    private volatile RuleSnapshot snapshot;

    void reload(Collection<Rule> rules) {
        this.snapshot = new RuleSnapshot(rules);
    }

    List<Rule> evaluate(Request request) {
        RuleSnapshot current = snapshot;
        return current.applicableRules(request);
    }
}
```

Ini bukan pembahasan concurrency detail, tetapi poin DSA-nya:

- array cocok untuk immutable read-heavy snapshot,
- update dilakukan dengan membangun array baru,
- pembaca tidak melihat struktur setengah berubah,
- traversal sangat murah.

---

## 18. Batch Buffer Pattern

ArrayList sangat cocok sebagai buffer batch.

Contoh:

```java
final class BatchBuffer<T> {
    private final int maxBatchSize;
    private final ArrayList<T> items;

    BatchBuffer(int maxBatchSize) {
        if (maxBatchSize <= 0) {
            throw new IllegalArgumentException("maxBatchSize must be positive");
        }
        this.maxBatchSize = maxBatchSize;
        this.items = new ArrayList<>(maxBatchSize);
    }

    boolean add(T item) {
        items.add(item);
        return items.size() >= maxBatchSize;
    }

    List<T> drainSnapshot() {
        List<T> snapshot = List.copyOf(items);
        items.clear();
        return snapshot;
    }

    int size() {
        return items.size();
    }
}
```

Kenapa `ArrayList` cocok?

- append dominan,
- size max diketahui,
- iterasi batch cepat,
- clear murah,
- memory reusable.

Kapan perlu hati-hati?

- jika batch size bisa tiba-tiba sangat besar,
- jika object besar tertahan,
- jika buffer long-lived dan pernah grow terlalu besar,
- jika digunakan concurrent tanpa proteksi.

---

## 19. Validation Result Collector

Kasus umum di enterprise app:

- menjalankan banyak validasi,
- mengumpulkan error/warning,
- preserve order,
- return snapshot.

```java
record ValidationMessage(
        String field,
        String code,
        String message
) {}

final class ValidationResult {
    private final ArrayList<ValidationMessage> messages = new ArrayList<>();

    void add(String field, String code, String message) {
        messages.add(new ValidationMessage(field, code, message));
    }

    boolean isValid() {
        return messages.isEmpty();
    }

    List<ValidationMessage> messages() {
        return List.copyOf(messages);
    }
}
```

Kenapa `ArrayList` cocok?

- append-only selama proses validasi,
- order penting,
- jumlah biasanya kecil-sedang,
- result bisa disnapshot.

Optimasi jika jumlah validasi besar dan estimasi diketahui:

```java
final class ValidationResult {
    private final ArrayList<ValidationMessage> messages;

    ValidationResult(int expectedMessages) {
        this.messages = new ArrayList<>(expectedMessages);
    }
}
```

Tapi jangan premature. Untuk validation result biasa, default constructor sering cukup.

---

## 20. Index Cursor: Alternatif Remove dari Depan

Jika kamu memproses list secara FIFO tapi tidak perlu benar-benar menghapus elemen satu per satu, gunakan cursor.

```java
final class CursorQueue<T> {
    private final ArrayList<T> items = new ArrayList<>();
    private int cursor;

    void add(T item) {
        items.add(item);
    }

    boolean hasNext() {
        return cursor < items.size();
    }

    T next() {
        if (!hasNext()) {
            throw new NoSuchElementException();
        }
        return items.get(cursor++);
    }

    void reset() {
        items.clear();
        cursor = 0;
    }
}
```

Keuntungan:

- tidak ada shifting,
- traversal `O(n)`,
- append tetap murah.

Kekurangan:

- item yang sudah lewat cursor tetap direferensikan sampai reset,
- bukan queue umum,
- tidak cocok untuk long-running unbounded stream.

Untuk queue sejati, gunakan `ArrayDeque`.

---

## 21. Array Copying: `System.arraycopy`, `Arrays.copyOf`, Manual Loop

Ada tiga pola copy umum.

### 21.1 `System.arraycopy`

```java
System.arraycopy(src, srcPos, dest, destPos, length);
```

Cocok untuk copy range ke array yang sudah ada.

### 21.2 `Arrays.copyOf`

```java
int[] bigger = Arrays.copyOf(old, newLength);
```

Cocok untuk membuat array baru dengan length baru.

### 21.3 Manual loop

```java
for (int i = 0; i < source.length; i++) {
    target[i] = transform(source[i]);
}
```

Cocok jika ada transformasi per elemen.

Rule:

| Kebutuhan | Pilihan |
|---|---|
| copy mentah range | `System.arraycopy` |
| resize array | `Arrays.copyOf` |
| transform | loop |
| convert collection ke array | `toArray` |

---

## 22. Primitive Arrays vs `ArrayList<Integer>`

Ini salah satu Java-specific cost paling penting.

```java
int[] values = new int[1_000_000];
```

vs

```java
List<Integer> values = new ArrayList<>(1_000_000);
```

`int[]`:

```text
array object + 1,000,000 int values
```

`ArrayList<Integer>`:

```text
ArrayList object
+ Object[] of references
+ many Integer objects, unless values are cached/autoboxed in special cases
```

Masalah `ArrayList<Integer>`:

- boxing,
- object overhead,
- pointer chasing,
- cache miss,
- more GC pressure,
- `null` possible,
- arithmetic butuh unboxing.

Contoh:

```java
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    numbers.add(i); // boxing
}
```

Jika workload numeric-heavy, primitive array sering jauh lebih cocok.

```java
int[] numbers = new int[1_000_000];
for (int i = 0; i < numbers.length; i++) {
    numbers[i] = i;
}
```

Tapi primitive array punya trade-off:

- fixed length,
- tidak implement `List<Integer>`,
- manual resizing jika dynamic,
- tidak bisa menyimpan absent value kecuali sentinel atau parallel bitmap.

---

## 23. Membuat Dynamic Primitive Array Sendiri

Untuk memahami `ArrayList`, buat versi primitive sederhana.

```java
public final class IntArray {
    private int[] elements;
    private int size;

    public IntArray() {
        this(10);
    }

    public IntArray(int initialCapacity) {
        if (initialCapacity < 0) {
            throw new IllegalArgumentException("initialCapacity must be >= 0");
        }
        this.elements = new int[initialCapacity];
    }

    public int size() {
        return size;
    }

    public boolean isEmpty() {
        return size == 0;
    }

    public int get(int index) {
        rangeCheck(index);
        return elements[index];
    }

    public void set(int index, int value) {
        rangeCheck(index);
        elements[index] = value;
    }

    public void add(int value) {
        ensureCapacity(size + 1);
        elements[size++] = value;
    }

    public void add(int index, int value) {
        if (index < 0 || index > size) {
            throw new IndexOutOfBoundsException("index=" + index + ", size=" + size);
        }
        ensureCapacity(size + 1);
        System.arraycopy(elements, index, elements, index + 1, size - index);
        elements[index] = value;
        size++;
    }

    public int removeAt(int index) {
        rangeCheck(index);
        int removed = elements[index];
        int moved = size - index - 1;
        if (moved > 0) {
            System.arraycopy(elements, index + 1, elements, index, moved);
        }
        size--;
        return removed;
    }

    public int[] toArray() {
        return Arrays.copyOf(elements, size);
    }

    private void ensureCapacity(int minCapacity) {
        if (minCapacity <= elements.length) {
            return;
        }

        int oldCapacity = elements.length;
        int newCapacity = oldCapacity + (oldCapacity >> 1) + 1;
        if (newCapacity < minCapacity) {
            newCapacity = minCapacity;
        }
        elements = Arrays.copyOf(elements, newCapacity);
    }

    private void rangeCheck(int index) {
        if (index < 0 || index >= size) {
            throw new IndexOutOfBoundsException("index=" + index + ", size=" + size);
        }
    }
}
```

Pelajaran dari implementasi ini:

1. `size` dan `elements.length` berbeda.
2. `add` butuh ensure capacity.
3. Insert tengah butuh shifting kanan.
4. Remove tengah butuh shifting kiri.
5. `toArray` harus copy hanya bagian logis.
6. Jika array object references, slot setelah remove perlu di-null-kan agar object lama tidak tertahan.

Untuk object array:

```java
// setelah remove
size--;
elements[size] = null; // help GC
```

---

## 24. Sorting Array dan List

### 24.1 Primitive array sort

```java
int[] numbers = {5, 1, 4, 2, 3};
Arrays.sort(numbers);
```

### 24.2 Object array sort

```java
String[] names = {"Charlie", "Alice", "Bob"};
Arrays.sort(names);
```

### 24.3 List sort

```java
List<User> users = new ArrayList<>();
users.sort(Comparator.comparing(User::name));
```

Atau:

```java
users.sort(
        Comparator.comparing(User::department)
                .thenComparing(User::name)
                .thenComparingInt(User::age)
);
```

### 24.4 Comparator overflow trap

Buruk:

```java
users.sort((a, b) -> a.age() - b.age());
```

Masalah:

- overflow untuk angka besar,
- tidak jelas untuk nullable,
- lebih raw daripada API pembanding.

Lebih baik:

```java
users.sort(Comparator.comparingInt(User::age));
```

Atau:

```java
users.sort((a, b) -> Integer.compare(a.age(), b.age()));
```

---

## 25. API Design: Jangan Bocorkan Mutable Array/List Internal

Contoh buruk:

```java
final class CaseTimeline {
    private final List<Event> events = new ArrayList<>();

    public List<Event> events() {
        return events;
    }
}
```

Caller bisa merusak invariant:

```java
timeline.events().clear();
```

Lebih baik:

```java
final class CaseTimeline {
    private final ArrayList<Event> events = new ArrayList<>();

    public void addEvent(Event event) {
        Objects.requireNonNull(event, "event");
        events.add(event);
    }

    public List<Event> eventsSnapshot() {
        return List.copyOf(events);
    }
}
```

Jika copy terlalu mahal dan caller trusted/read-only:

```java
public List<Event> eventsView() {
    return Collections.unmodifiableList(events);
}
```

Tapi dokumentasikan bahwa itu live view.

Untuk array:

Buruk:

```java
public byte[] payload() {
    return payload;
}
```

Lebih aman:

```java
public byte[] payload() {
    return Arrays.copyOf(payload, payload.length);
}
```

Constructor juga harus defensive copy:

```java
public Document(byte[] payload) {
    this.payload = Arrays.copyOf(payload, payload.length);
}
```

---

## 26. Choosing: Array vs `ArrayList` vs `ArrayDeque` vs `LinkedList`

| Kebutuhan | Pilihan default |
|---|---|
| Fixed-size primitive numeric data | primitive array |
| Fixed-size object data | object array atau immutable list |
| Append + random access | `ArrayList` |
| FIFO/LIFO/deque operations | `ArrayDeque` |
| Frequent insert/delete at both ends | `ArrayDeque` |
| Frequent insert/delete in middle with iterator | jarang; pertimbangkan linked/custom/tree |
| Need `List` API mutable | `ArrayList` |
| Need compact read-only sorted lookup | sorted array/list |
| Need exact lookup by key | `HashMap` |
| Need range query | `TreeMap`/sorted array depending mutation pattern |

`LinkedList` bukan default untuk “banyak insert/delete”. Ia hanya masuk akal jika kamu sudah punya posisi node/iterator dan operasi dominan di sekitar posisi itu. Untuk banyak workload, pointer chasing dan memory overhead membuatnya kalah dari `ArrayList`/`ArrayDeque`.

---

## 27. Production Scenario 1: Pagination Buffer

Misalnya mengambil data dari repository lalu return page response.

```java
record Page<T>(List<T> items, int page, int size, long total) {}
```

Jika repository sudah return list, jangan copy berlebihan kecuali perlu snapshot.

```java
Page<CaseDto> loadPage(int page, int size) {
    List<CaseDto> rows = repository.findCases(page, size);
    long total = repository.countCases();
    return new Page<>(List.copyOf(rows), page, size, total);
}
```

Kenapa snapshot?

- response object tidak berubah setelah dibuat,
- aman dari mutasi accidental,
- invariant page stabil.

Jika performance critical dan repository sudah return immutable list, copy bisa redundant. Tapi jangan asumsi tanpa contract.

---

## 28. Production Scenario 2: External API Batch Request

Misalnya perlu mengirim maksimal 100 item per batch.

```java
static <T> List<List<T>> partitionCopy(List<T> input, int batchSize) {
    if (batchSize <= 0) {
        throw new IllegalArgumentException("batchSize must be positive");
    }

    List<List<T>> batches = new ArrayList<>((input.size() + batchSize - 1) / batchSize);

    for (int from = 0; from < input.size(); from += batchSize) {
        int to = Math.min(from + batchSize, input.size());
        batches.add(List.copyOf(input.subList(from, to)));
    }

    return List.copyOf(batches);
}
```

Kenapa copy setiap sublist?

- batch independen dari input,
- tidak menahan parent list besar,
- aman jika input dimutasi setelah partition.

Jika hanya dipakai langsung dan input tidak dimutasi, view `subList` bisa lebih murah. Tapi untuk API boundary, copy sering lebih defensible.

---

## 29. Production Scenario 3: Deadline Sorted Lookup

Misalnya punya escalation rules berdasarkan threshold hari.

```java
record EscalationRule(int minDaysOverdue, String action) {}
```

Kita bisa simpan sorted array:

```java
final class EscalationRuleIndex {
    private final EscalationRule[] rules;

    EscalationRuleIndex(Collection<EscalationRule> input) {
        this.rules = input.toArray(EscalationRule[]::new);
        Arrays.sort(this.rules, Comparator.comparingInt(EscalationRule::minDaysOverdue));
    }

    EscalationRule findRule(int daysOverdue) {
        int left = 0;
        int right = rules.length;

        while (left < right) {
            int mid = left + ((right - left) >>> 1);
            if (rules[mid].minDaysOverdue() <= daysOverdue) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        int index = left - 1;
        return index >= 0 ? rules[index] : null;
    }
}
```

Makna:

- cari rule dengan threshold terbesar yang masih <= `daysOverdue`,
- sorted array cukup karena rules jarang berubah,
- lookup `O(log n)`,
- memory compact.

---

## 30. Production Scenario 4: Dedup dengan Preserve Order

Jika ingin dedup tapi tetap menjaga insertion order:

```java
static <T> List<T> deduplicatePreserveOrder(List<T> input) {
    Set<T> seen = new HashSet<>(Math.max(16, input.size() * 2));
    List<T> result = new ArrayList<>(input.size());

    for (T item : input) {
        if (seen.add(item)) {
            result.add(item);
        }
    }

    return List.copyOf(result);
}
```

Kenapa bukan `input.contains`?

Karena akan menjadi `O(n²)`.

Kenapa result `ArrayList`?

- append-only,
- preserve order,
- expected max size diketahui.

Kenapa return `List.copyOf`?

- hasil immutable snapshot,
- caller tidak bisa merusak result.

Catatan: ini bergantung pada `equals/hashCode` benar.

---

## 31. Production Scenario 5: Stable Error Ordering

Dalam validation pipeline, urutan error sering penting untuk UX dan test determinism.

```java
final class ErrorCollector {
    private final ArrayList<ValidationMessage> errors = new ArrayList<>();

    void reject(String field, String code, String message) {
        errors.add(new ValidationMessage(field, code, message));
    }

    void rejectAll(Collection<ValidationMessage> messages) {
        errors.ensureCapacity(errors.size() + messages.size());
        errors.addAll(messages);
    }

    List<ValidationMessage> toList() {
        return List.copyOf(errors);
    }
}
```

Catatan:

- `ensureCapacity` di sini masuk akal karena jumlah tambahan diketahui.
- `ArrayList` menjaga order.
- Snapshot membuat result aman untuk dipakai lintas layer.

---

## 32. Common Mistakes Checklist

### 32.1 Mengira capacity adalah size

Salah:

```java
ArrayList<String> list = new ArrayList<>(100);
System.out.println(list.size()); // 0, bukan 100
```

### 32.2 Menggunakan `set` untuk index yang belum ada

Salah:

```java
List<String> list = new ArrayList<>(10);
list.set(0, "A"); // IndexOutOfBoundsException
```

Benar:

```java
list.add("A");
```

Jika butuh fixed-size initialized list:

```java
List<String> list = new ArrayList<>(Collections.nCopies(10, null));
list.set(0, "A");
```

### 32.3 Remove by index vs remove by object

```java
List<Integer> numbers = new ArrayList<>(List.of(1, 2, 3));

numbers.remove(1);          // remove index 1 -> removes 2
numbers.remove(Integer.valueOf(1)); // remove object 1
```

Ini bug klasik.

### 32.4 Binary search sebelum sort

Salah:

```java
List<Integer> values = List.of(3, 1, 2);
Collections.binarySearch(values, 2); // invalid assumption
```

Benar:

```java
List<Integer> values = new ArrayList<>(List.of(3, 1, 2));
values.sort(Integer::compareTo);
Collections.binarySearch(values, 2);
```

### 32.5 Menyimpan `subList` long-lived

Salah jika parent besar:

```java
this.items = hugeList.subList(0, 10);
```

Lebih aman:

```java
this.items = List.copyOf(hugeList.subList(0, 10));
```

### 32.6 Exposing mutable list

Salah:

```java
public List<Event> events() {
    return events;
}
```

Lebih aman:

```java
public List<Event> events() {
    return List.copyOf(events);
}
```

### 32.7 Menggunakan `ArrayList` sebagai queue

Salah:

```java
while (!list.isEmpty()) {
    process(list.remove(0));
}
```

Benar:

```java
Deque<Item> queue = new ArrayDeque<>(list);
while (!queue.isEmpty()) {
    process(queue.removeFirst());
}
```

---

## 33. Decision Framework: Cara Memilih Array-backed Structure

Tanyakan berurutan:

### 33.1 Apakah jumlah elemen fixed?

Jika ya:

- primitive numeric: primitive array,
- object: object array atau immutable list.

### 33.2 Apakah butuh append dinamis?

Jika ya:

- `ArrayList` untuk random access + append,
- `ArrayDeque` untuk queue/deque.

### 33.3 Apakah sering insert/delete tengah?

Jika ya:

- evaluasi ulang model data,
- mungkin butuh tree/index/custom structure,
- jangan otomatis pilih `LinkedList`.

### 33.4 Apakah lookup by exact key dominan?

Jika ya:

- gunakan `HashMap`/`HashSet`, bukan scan list.

### 33.5 Apakah data mostly read-only dan sorted lookup?

Jika ya:

- sorted array/list + binary search bisa bagus.

### 33.6 Apakah mutation harus aman dari caller?

Jika ya:

- return snapshot,
- defensive copy,
- immutable wrapper dengan pemahaman view vs copy.

### 33.7 Apakah workload memory-sensitive?

Jika ya:

- hindari boxing besar,
- pertimbangkan primitive arrays,
- hati-hati capacity retention,
- ukur footprint.

---

## 34. Complexity Table

| Operation | Array fixed | `ArrayList` | Notes |
|---|---:|---:|---|
| get by index | `O(1)` | `O(1)` | Sangat kuat untuk random access |
| set by index | `O(1)` | `O(1)` | Index harus valid |
| append | tidak bisa tanpa array baru | amortized `O(1)` | Worst-case resize `O(n)` |
| insert at front | `O(n)` via copy/shift | `O(n)` | Shifting semua elemen |
| insert at middle | `O(n)` | `O(n)` | Shifting suffix |
| remove last | manual | `O(1)` | Untuk object ref perlu null slot |
| remove front | `O(n)` | `O(n)` | Jangan jadikan queue |
| contains | `O(n)` | `O(n)` | Bergantung `equals` |
| sort | `O(n log n)` | `O(n log n)` | Detail algoritma tergantung tipe/API |
| binary search | `O(log n)` | `O(log n)` | Hanya jika sorted |
| iteration | `O(n)` | `O(n)` | Locality bagus |

---

## 35. Testing Strategy untuk Array-backed Logic

Jika kamu membuat logic berbasis array/list, test bukan hanya happy path.

### 35.1 Boundary size

Test:

- empty,
- one element,
- two elements,
- exactly capacity,
- capacity + 1,
- large input.

### 35.2 Index boundary

Test:

- index `0`,
- index `size - 1`,
- index `size`,
- index `-1`.

### 35.3 Mutation semantics

Test:

- insert front,
- insert middle,
- insert end,
- remove front,
- remove middle,
- remove end.

### 35.4 Snapshot/view semantics

Test apakah return value berubah setelah source dimutasi.

```java
@Test
void snapshotShouldNotChangeWhenOriginalMutates() {
    ArrayList<String> source = new ArrayList<>();
    source.add("A");

    List<String> snapshot = List.copyOf(source);
    source.add("B");

    assertEquals(List.of("A"), snapshot);
}
```

### 35.5 Sorted invariant

Jika menggunakan binary search, test bahwa constructor/index builder selalu sort.

```java
@Test
void shouldFindRuleAfterSortingInput() {
    List<EscalationRule> input = List.of(
            new EscalationRule(10, "A"),
            new EscalationRule(1, "B"),
            new EscalationRule(5, "C")
    );

    EscalationRuleIndex index = new EscalationRuleIndex(input);

    assertEquals("C", index.findRule(7).action());
}
```

---

## 36. Performance Notes

### 36.1 Jangan benchmark dengan intuisi

Contoh asumsi yang sering salah:

- “LinkedList lebih cepat untuk insert.”
- “ArrayList pasti boros karena resize.”
- “HashMap selalu lebih cepat dari binary search.”
- “Primitive array tidak perlu, JVM pasti optimize boxing.”

Semua harus divalidasi berdasarkan workload.

### 36.2 Yang perlu diukur

Untuk array/list-heavy code:

1. Throughput.
2. P99 latency.
3. Allocation rate.
4. GC frequency.
5. Object count.
6. Memory footprint.
7. Input distribution.
8. Hot-path operation mix.

### 36.3 JMH/JOL mindset

- Gunakan JMH untuk microbenchmark yang benar.
- Gunakan JOL untuk melihat footprint/layout object.
- Jangan pakai `System.nanoTime` loop sederhana untuk kesimpulan serius.
- Warmup penting karena JIT.
- Hindari dead-code elimination.

Detail tooling akan dibahas lebih dalam di Part 028.

---

## 37. Mini Exercise

### Exercise 1 — Detect accidental `O(n²)`

Kode:

```java
List<String> existingCodes = repository.findExistingCodes();
List<String> incomingCodes = request.codes();

List<String> duplicates = new ArrayList<>();
for (String code : incomingCodes) {
    if (existingCodes.contains(code)) {
        duplicates.add(code);
    }
}
```

Pertanyaan:

1. Complexity-nya apa?
2. Kapan ini masih acceptable?
3. Kapan harus diganti?
4. Struktur data apa yang lebih cocok?

Jawaban ringkas:

- Complexity: `O(incomingCodes.size() * existingCodes.size() * equalsCost)`.
- Acceptable jika list sangat kecil dan bukan hot path.
- Harus diganti jika ukuran besar atau path sering dipanggil.
- Gunakan `HashSet` untuk `existingCodes`, kecuali ordering/range matching diperlukan.

### Exercise 2 — Safe partition

Implementasikan partition list menjadi batch size 100 dengan output yang tidak terpengaruh jika input berubah setelah partition.

Jawaban:

```java
static <T> List<List<T>> partitionSnapshot(List<T> input, int batchSize) {
    if (batchSize <= 0) {
        throw new IllegalArgumentException("batchSize must be positive");
    }

    ArrayList<List<T>> result = new ArrayList<>((input.size() + batchSize - 1) / batchSize);
    for (int from = 0; from < input.size(); from += batchSize) {
        int to = Math.min(from + batchSize, input.size());
        result.add(List.copyOf(input.subList(from, to)));
    }
    return List.copyOf(result);
}
```

### Exercise 3 — Lower bound

Implementasikan function yang mencari index pertama dengan value >= target.

Jawaban:

```java
static int lowerBound(int[] values, int target) {
    int left = 0;
    int right = values.length;

    while (left < right) {
        int mid = left + ((right - left) >>> 1);
        if (values[mid] < target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    return left;
}
```

---

## 38. Engineering Heuristics

Pegang heuristic ini:

1. **Jika operasi dominan adalah append + iterate + get by index, gunakan `ArrayList`.**
2. **Jika jumlah fixed dan primitive-heavy, gunakan primitive array.**
3. **Jika sering remove dari depan, jangan gunakan `ArrayList` sebagai queue.**
4. **Jika sering `contains`, pertimbangkan `HashSet`.**
5. **Jika data read-heavy dan sorted, sorted array + binary search bisa sangat kuat.**
6. **Jika return collection dari domain object, jangan bocorkan mutable internal state.**
7. **Jika menggunakan `subList`, sadar bahwa itu view. Copy jika melewati boundary method/layer.**
8. **Jika ukuran besar bisa diprediksi, set initial capacity.**
9. **Jika list pernah sangat besar dan long-lived, pikirkan capacity retention.**
10. **Jika performance penting, ukur allocation dan latency spike, bukan hanya Big-O.**

---

## 39. Ringkasan Mental Model

Array-backed structure unggul karena:

- indexed access murah,
- traversal cepat,
- memory relatif compact,
- append amortized murah,
- snapshot mudah dibuat,
- cocok untuk read-heavy ordered data.

Array-backed structure lemah karena:

- insert/delete tengah mahal,
- remove depan mahal,
- resize bisa memicu latency spike,
- capacity bisa menahan memory,
- object list terkena boxing/pointer chasing,
- `subList` view bisa menahan parent,
- API mutable bisa merusak invariant jika bocor.

Cara berpikir top-tier:

```text
Jangan tanya: “Pakai ArrayList atau LinkedList?”

Tanya:
- operasi dominannya apa?
- ukuran data berapa?
- mutation pattern-nya bagaimana?
- apakah order penting?
- apakah lookup exact/range?
- apakah data read-heavy atau write-heavy?
- apakah memory/latency sensitif?
- apakah collection melewati API boundary?
```

---

## 40. Referensi

1. Oracle Java SE 25 API — `ArrayList`: resizable-array implementation, capacity-related operations, fail-fast iterator notes.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html`

2. Oracle Java SE 25 API — `Arrays`: sorting, binary search, copy utilities.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html`

3. Oracle Java SE API — `List`: positional access semantics, `subList`, indexed operations.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html`

4. Oracle Java SE 25 Collections Framework Overview.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html`

5. OpenJDK JOL — Java Object Layout, untuk memahami object layout/footprint secara empiris.  
   `https://openjdk.org/projects/code-tools/jol/`

6. OpenJDK JMH — Java Microbenchmark Harness, untuk benchmark JVM yang lebih benar.  
   `https://openjdk.org/projects/code-tools/jmh/`

---

## 41. Status Seri

Bagian ini adalah **Part 003 dari 030**.

Seri **belum selesai**.

Bagian berikutnya:

```text
Part 004 — Linked Structures: LinkedList, Node Chain, Pointer Chasing
```

Fokus berikutnya: membongkar linked list secara realistis: node chain, pointer chasing, memory overhead, iterator mutation, kapan linked structure benar-benar masuk akal, dan kenapa `LinkedList` sering disalahgunakan.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dsa-part-002.md">⬅️ Part 002 — Java Object, Array, Reference, Equality, Hashing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dsa-part-004.md">Part 004 — Linked Structures: LinkedList, Node Chain, Pointer Chasing ➡️</a>
</div>
