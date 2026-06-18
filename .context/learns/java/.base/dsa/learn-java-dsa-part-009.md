# Learn Java DSA — Part 009: Binary Search, Sorted Data, Navigable Structures

> Seri: `learn-java-dsa`  
> Part: `009 / 030`  
> Topik: Binary Search, Sorted Data, Navigable Structures  
> Target: Java Software Engineer yang ingin memahami DSA sebagai alat desain sistem, bukan hanya template algoritma.

---

## 0. Posisi Materi Ini dalam Seri

Sebelumnya kita sudah membahas:

- array dan dynamic array,
- linked structure,
- stack/queue/deque/ring buffer,
- hash table fundamentals,
- keluarga `HashMap`/`HashSet`,
- ordering, sorting, `Comparator`, dan `Comparable`.

Part ini berada tepat setelah sorting karena **binary search dan navigable structure hanya masuk akal jika data memiliki ordering yang valid**.

Hash structure menjawab pertanyaan:

> “Apakah key ini ada?”  
> “Berikan value untuk key persis ini.”

Sorted structure menjawab pertanyaan yang lebih kaya:

> “Berikan item tepat sebelum/sesudah key ini.”  
> “Berikan semua data dalam range tertentu.”  
> “Cari rule yang berlaku untuk tanggal ini.”  
> “Cari threshold terdekat yang tidak melebihi nilai ini.”  
> “Cari SLA bucket yang cocok untuk deadline ini.”

Itulah kenapa part ini penting untuk sistem nyata, terutama sistem yang banyak berurusan dengan:

- effective-date configuration,
- policy/rule versioning,
- SLA deadline,
- threshold matching,
- range query,
- ordered event timeline,
- deterministic processing,
- dependency ordering,
- escalation priority.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami binary search sebagai **boundary-finding algorithm**, bukan sekadar pencarian exact match.
2. Mengimplementasikan binary search dengan benar tanpa off-by-one bug.
3. Memahami konsep:
   - exact match,
   - insertion point,
   - lower bound,
   - upper bound,
   - floor,
   - ceiling,
   - predecessor,
   - successor.
4. Memilih antara:
   - sorted array/list,
   - `HashMap`,
   - `TreeMap`,
   - `TreeSet`,
   - `NavigableMap`,
   - `NavigableSet`.
5. Memahami kapan sorted array lebih baik daripada tree dan kapan tree lebih baik daripada sorted array.
6. Menggunakan `TreeMap`/`TreeSet` untuk range query dan nearest-key query.
7. Mendesain lookup berbasis effective date, threshold, SLA, dan rule range.
8. Menghindari failure mode umum:
   - binary search pada data tidak sorted,
   - comparator inconsistent,
   - mutable key dalam tree,
   - range view yang dimodifikasi tanpa sadar,
   - salah memahami inclusive/exclusive boundary.

---

## 2. Mental Model: Sorted Data adalah Index, Bukan Sekadar Urutan

Banyak developer melihat sorting sebagai tahap kosmetik:

> “Urutkan supaya tampilannya rapi.”

Di DSA, sorted data adalah **index**.

Jika data sudah sorted, kita mendapat kemampuan untuk **membuang sebagian besar ruang pencarian**.

Contoh array sorted:

```text
[3, 7, 12, 19, 24, 31, 45, 58, 70]
```

Jika mencari `45`, kita tidak perlu scan dari kiri. Kita bisa cek tengah:

```text
mid = 24
45 > 24, maka semua data kiri 24 pasti tidak mungkin.
```

Lalu cari di kanan:

```text
[31, 45, 58, 70]
```

Setiap langkah membuang sekitar separuh search space.

Namun di sistem nyata, exact match bukan satu-satunya kebutuhan.

Sering kali pertanyaannya adalah:

```text
Cari effective config yang berlaku pada tanggal 2026-06-15.
```

Data:

```text
2025-01-01 -> Config A
2025-07-01 -> Config B
2026-01-01 -> Config C
2026-09-01 -> Config D
```

Untuk tanggal `2026-06-15`, tidak ada key exact. Yang benar adalah:

```text
floor(2026-06-15) = 2026-01-01 -> Config C
```

Jadi sorted structure bukan hanya untuk mencari key. Ia berguna untuk mencari **boundary**.

---

## 3. Binary Search sebagai Boundary-Finding Algorithm

Versi populer binary search biasanya ditulis seperti ini:

```java
static int binarySearchExact(int[] a, int target) {
    int lo = 0;
    int hi = a.length - 1;

    while (lo <= hi) {
        int mid = lo + ((hi - lo) >>> 1);

        if (a[mid] == target) {
            return mid;
        }
        if (a[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return -1;
}
```

Ini valid untuk exact match. Tapi top-tier engineer biasanya melihat binary search secara lebih general:

> Binary search mencari titik batas tempat predicate berubah dari false ke true, atau dari true ke false.

Misalnya kita punya predicate:

```text
a[i] >= target
```

Pada sorted ascending array:

```text
a = [3, 7, 12, 19, 24, 31]
target = 20
```

Predicate per index:

```text
3  >= 20 ? false
7  >= 20 ? false
12 >= 20 ? false
19 >= 20 ? false
24 >= 20 ? true
31 >= 20 ? true
```

Pattern:

```text
false false false false true true
```

Binary search bisa mencari index pertama yang `true`.

Itulah lower bound.

---

## 4. Lower Bound dan Upper Bound

### 4.1 Lower Bound

Lower bound adalah:

> index pertama dengan nilai `>= target`.

Contoh:

```text
a = [10, 20, 20, 20, 30, 40]
target = 20
```

Lower bound `20` adalah index `1`.

```text
[10, 20, 20, 20, 30, 40]
     ^
```

Implementasi:

```java
static int lowerBound(int[] a, int target) {
    int lo = 0;
    int hi = a.length; // exclusive

    while (lo < hi) {
        int mid = lo + ((hi - lo) >>> 1);

        if (a[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    return lo;
}
```

Invariants:

```text
Semua index < lo diketahui < target.
Semua index >= hi diketahui >= target.
Search space aktif: [lo, hi).
```

Ketika loop selesai:

```text
lo == hi
```

Maka `lo` adalah boundary pertama untuk `>= target`.

Jika semua elemen lebih kecil dari target, `lo == a.length`.

---

### 4.2 Upper Bound

Upper bound adalah:

> index pertama dengan nilai `> target`.

Contoh:

```text
a = [10, 20, 20, 20, 30, 40]
target = 20
```

Upper bound `20` adalah index `4`.

```text
[10, 20, 20, 20, 30, 40]
                 ^
```

Implementasi:

```java
static int upperBound(int[] a, int target) {
    int lo = 0;
    int hi = a.length; // exclusive

    while (lo < hi) {
        int mid = lo + ((hi - lo) >>> 1);

        if (a[mid] <= target) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    return lo;
}
```

---

### 4.3 Menghitung Jumlah Kemunculan dengan Boundary

Jika array sorted dan kita ingin menghitung jumlah `target`:

```java
static int countOccurrences(int[] a, int target) {
    return upperBound(a, target) - lowerBound(a, target);
}
```

Contoh:

```text
a = [10, 20, 20, 20, 30]
lowerBound(20) = 1
upperBound(20) = 4
count = 4 - 1 = 3
```

Complexity:

```text
O(log n)
```

Tanpa sorted data, kita perlu scan:

```text
O(n)
```

---

## 5. Binary Search Exact Match vs Insertion Point

Java `Arrays.binarySearch` dan `Collections.binarySearch` mengembalikan:

```text
index >= 0 jika ditemukan
negative value jika tidak ditemukan
```

Jika tidak ditemukan, return value adalah:

```text
-(insertionPoint) - 1
```

Maka insertion point bisa dihitung dengan:

```java
int insertionPoint = -result - 1;
```

Atau lebih aman secara idiomatik:

```java
int insertionPoint = ~result;
```

Karena:

```text
~x == -x - 1
```

Contoh:

```java
int[] a = {10, 20, 30, 40};
int r = Arrays.binarySearch(a, 25);

System.out.println(r);      // -3
System.out.println(-r - 1); // 2
System.out.println(~r);     // 2
```

Artinya `25` tidak ditemukan dan seharusnya disisipkan di index `2`:

```text
[10, 20, 25, 30, 40]
         ^
```

### Kenapa return value dibuat `-(insertionPoint) - 1`, bukan `-insertionPoint`?

Karena insertion point bisa `0`.

Jika return value `-insertionPoint`, maka insertion point `0` menghasilkan `0`, padahal `0` juga bisa berarti elemen ditemukan di index `0`.

Dengan formula `-(insertionPoint) - 1`:

```text
insertionPoint = 0 -> return -1
insertionPoint = 1 -> return -2
insertionPoint = 2 -> return -3
```

Tidak ada konflik dengan index valid.

---

## 6. Binary Search Bug Paling Umum

### 6.1 Data Tidak Sorted

Binary search mensyaratkan data sorted sesuai ordering yang dipakai.

Salah:

```java
int[] a = {30, 10, 20};
int index = Arrays.binarySearch(a, 20); // hasil tidak reliable
```

Benar:

```java
int[] a = {30, 10, 20};
Arrays.sort(a);
int index = Arrays.binarySearch(a, 20);
```

### 6.2 Sort Pakai Comparator A, Search Pakai Comparator B

Salah:

```java
List<String> names = new ArrayList<>(List.of("b", "A", "c"));

names.sort(String.CASE_INSENSITIVE_ORDER);

int index = Collections.binarySearch(names, "a"); // natural ordering, bukan case-insensitive
```

Benar:

```java
Comparator<String> cmp = String.CASE_INSENSITIVE_ORDER;

List<String> names = new ArrayList<>(List.of("b", "A", "c"));
names.sort(cmp);

int index = Collections.binarySearch(names, "a", cmp);
```

Rule:

> Ordering untuk sort dan search harus sama.

### 6.3 Overflow saat Menghitung Mid

Buruk:

```java
int mid = (lo + hi) / 2;
```

Jika `lo + hi` overflow, hasil bisa negatif.

Lebih aman:

```java
int mid = lo + ((hi - lo) >>> 1);
```

Atau:

```java
int mid = (lo + hi) >>> 1;
```

Namun bentuk pertama lebih jelas menjaga jarak dari overflow pada `lo + hi`.

### 6.4 Infinite Loop Karena Boundary Tidak Bergerak

Salah:

```java
while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (a[mid] < target) {
        lo = mid; // bug: mid bisa sama dengan lo
    } else {
        hi = mid;
    }
}
```

Jika `lo + 1 == hi`, maka `mid == lo`, dan `lo = mid` tidak mengubah state.

Benar untuk lower bound:

```java
if (a[mid] < target) {
    lo = mid + 1;
} else {
    hi = mid;
}
```

### 6.5 Salah Memilih Inclusive/Exclusive Boundary

Ada dua gaya umum:

```text
[lo, hi]   // inclusive hi
[lo, hi)   // exclusive hi
```

Untuk boundary search, `[lo, hi)` biasanya lebih mudah karena:

```text
empty range ketika lo == hi
hi boleh bernilai a.length
return lo langsung menjadi insertion point
```

---

## 7. Sorted Array vs Tree: Trade-Off yang Sering Salah Dipahami

Sorted array/list dan tree sama-sama mendukung ordered lookup, tapi cost profile-nya berbeda.

| Kebutuhan | Sorted Array/List | TreeMap/TreeSet |
|---|---:|---:|
| Exact lookup | O(log n) | O(log n) |
| Lower/upper bound | O(log n) | O(log n) |
| Range iteration | O(log n + k) | O(log n + k) |
| Insert/delete single item | O(n) shifting | O(log n) |
| Memory locality | Bagus | Lebih buruk karena node/reference |
| Memory overhead | Rendah | Lebih tinggi |
| Batch build | Sort O(n log n) | Repeated insert O(n log n) |
| Read-heavy static data | Sangat bagus | Bisa overkill |
| Mutation-heavy ordered data | Buruk | Cocok |
| Duplicate keys | Natural via array | Map tidak; Set tidak; perlu value collection |

### Mental Model

Gunakan sorted array/list jika:

```text
Data banyak dibaca, jarang berubah, dan bisa dibangun secara batch.
```

Gunakan tree jika:

```text
Data sering berubah dan tetap perlu ordered/range/nearest-key operation.
```

### Contoh Read-Heavy Config

Misalnya rule threshold dimuat dari database saat startup:

```text
[0, 10, 20, 50, 100]
```

Lalu dipakai ribuan kali per detik untuk lookup threshold.

Jika datanya immutable selama runtime, sorted array lebih baik daripada `TreeMap` karena:

- memory lebih compact,
- pointer chasing lebih sedikit,
- cache locality lebih baik,
- lookup tetap `O(log n)`.

### Contoh Mutation-Heavy Timeline

Misalnya ada event timeline yang bisa menerima insert real-time dan query range:

```text
put(eventTime, event)
range(from, to)
floorEntry(now)
```

Di sini `TreeMap` lebih natural.

---

## 8. `TreeMap` dan `TreeSet`: Ordered Structure di Java

`TreeMap` adalah implementasi `NavigableMap` berbasis red-black tree. Secara API, ia menjaga key dalam urutan natural ordering atau comparator yang diberikan saat construction.

Contoh:

```java
NavigableMap<Integer, String> thresholds = new TreeMap<>();
thresholds.put(0, "LOW");
thresholds.put(50, "MEDIUM");
thresholds.put(80, "HIGH");
thresholds.put(95, "CRITICAL");
```

Lookup exact:

```java
String level = thresholds.get(80); // HIGH
```

Nearest lower-or-equal:

```java
Map.Entry<Integer, String> entry = thresholds.floorEntry(87);
System.out.println(entry.getValue()); // HIGH
```

Nearest higher-or-equal:

```java
Map.Entry<Integer, String> entry = thresholds.ceilingEntry(87);
System.out.println(entry.getValue()); // CRITICAL
```

Predecessor strict:

```java
thresholds.lowerEntry(80); // 50 -> MEDIUM
```

Successor strict:

```java
thresholds.higherEntry(80); // 95 -> CRITICAL
```

---

## 9. Floor, Ceiling, Lower, Higher

Empat operasi ini penting sekali.

Misalnya key sorted:

```text
10, 20, 30, 40
```

Untuk query `30`:

| Operation | Meaning | Result |
|---|---|---:|
| `floorKey(30)` | greatest key `<= 30` | 30 |
| `ceilingKey(30)` | least key `>= 30` | 30 |
| `lowerKey(30)` | greatest key `< 30` | 20 |
| `higherKey(30)` | least key `> 30` | 40 |

Untuk query `25`:

| Operation | Meaning | Result |
|---|---|---:|
| `floorKey(25)` | greatest key `<= 25` | 20 |
| `ceilingKey(25)` | least key `>= 25` | 30 |
| `lowerKey(25)` | greatest key `< 25` | 20 |
| `higherKey(25)` | least key `> 25` | 30 |

### Practical Meaning

- `floor` cocok untuk effective-date lookup.
- `ceiling` cocok untuk next scheduled point.
- `lower` cocok untuk previous strictly-before value.
- `higher` cocok untuk next strictly-after value.

---

## 10. Effective-Date Configuration dengan `TreeMap`

Problem:

> Sistem memiliki konfigurasi yang berlaku mulai tanggal tertentu. Untuk tanggal request tertentu, cari konfigurasi terbaru yang start date-nya tidak melebihi tanggal request.

Data:

```text
2025-01-01 -> Config V1
2025-07-01 -> Config V2
2026-01-01 -> Config V3
2026-09-01 -> Config V4
```

Query:

```text
2026-06-15 -> Config V3
```

Implementasi:

```java
import java.time.LocalDate;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Optional;
import java.util.TreeMap;

public final class EffectiveDateConfigRegistry<C> {
    private final NavigableMap<LocalDate, C> configsByEffectiveDate;

    public EffectiveDateConfigRegistry(Map<LocalDate, C> configsByEffectiveDate) {
        if (configsByEffectiveDate.isEmpty()) {
            throw new IllegalArgumentException("configs must not be empty");
        }
        this.configsByEffectiveDate = new TreeMap<>(configsByEffectiveDate);
    }

    public Optional<C> findConfigFor(LocalDate date) {
        Map.Entry<LocalDate, C> entry = configsByEffectiveDate.floorEntry(date);
        return entry == null ? Optional.empty() : Optional.of(entry.getValue());
    }
}
```

Usage:

```java
Map<LocalDate, String> configs = Map.of(
    LocalDate.of(2025, 1, 1), "Config V1",
    LocalDate.of(2025, 7, 1), "Config V2",
    LocalDate.of(2026, 1, 1), "Config V3",
    LocalDate.of(2026, 9, 1), "Config V4"
);

EffectiveDateConfigRegistry<String> registry = new EffectiveDateConfigRegistry<>(configs);

System.out.println(registry.findConfigFor(LocalDate.of(2026, 6, 15)).orElseThrow());
// Config V3
```

### Invariant

```text
For any query date D, selected config must have max effectiveDate E such that E <= D.
```

Dalam `TreeMap`, ini persis operasi `floorEntry(D)`.

### Failure Mode

Jika developer memakai `HashMap`, ia harus scan semua key:

```java
LocalDate best = null;
for (LocalDate effectiveDate : map.keySet()) {
    if (!effectiveDate.isAfter(queryDate)) {
        if (best == null || effectiveDate.isAfter(best)) {
            best = effectiveDate;
        }
    }
}
```

Complexity:

```text
O(n)
```

Dengan `TreeMap`:

```text
O(log n)
```

Namun jika config static dan banyak query, sorted array juga bisa menjadi pilihan.

---

## 11. Effective-Date Lookup dengan Sorted Array

Jika config bersifat immutable setelah load, kita bisa gunakan sorted array/list.

```java
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

public final class StaticEffectiveDateConfigRegistry<C> {
    private final List<Entry<C>> entries;

    public StaticEffectiveDateConfigRegistry(List<Entry<C>> entries) {
        if (entries.isEmpty()) {
            throw new IllegalArgumentException("entries must not be empty");
        }
        ArrayList<Entry<C>> copy = new ArrayList<>(entries);
        copy.sort(Comparator.comparing(Entry::effectiveDate));
        this.entries = List.copyOf(copy);
    }

    public Optional<C> findConfigFor(LocalDate date) {
        int index = floorIndex(date);
        if (index < 0) {
            return Optional.empty();
        }
        return Optional.of(entries.get(index).config());
    }

    private int floorIndex(LocalDate date) {
        int lo = 0;
        int hi = entries.size();

        while (lo < hi) {
            int mid = lo + ((hi - lo) >>> 1);
            if (!entries.get(mid).effectiveDate().isAfter(date)) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        return lo - 1;
    }

    public record Entry<C>(LocalDate effectiveDate, C config) {}
}
```

### Apa yang Dicari?

Kita mencari index terakhir dengan:

```text
effectiveDate <= queryDate
```

Itu sama dengan:

```text
upperBound(queryDate) - 1
```

### Trade-Off

| Aspek | Sorted List Registry | TreeMap Registry |
|---|---:|---:|
| Build | O(n log n) | O(n log n) kalau insert satu per satu |
| Query | O(log n) | O(log n) |
| Insert setelah build | O(n) | O(log n) |
| Memory locality | Lebih baik | Lebih buruk |
| API simplicity | Perlu custom binary search | API sudah tersedia |
| Immutability | Mudah | Bisa, tapi perlu wrapper/copy |

---

## 12. Range Query dengan `NavigableMap`

Problem:

> Ambil semua event dalam rentang waktu tertentu.

```java
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.NavigableMap;
import java.util.TreeMap;

public final class EventTimeline<E> {
    private final NavigableMap<Instant, List<E>> eventsByTime = new TreeMap<>();

    public void add(Instant time, E event) {
        eventsByTime.computeIfAbsent(time, ignored -> new ArrayList<>()).add(event);
    }

    public List<E> findBetween(Instant fromInclusive, Instant toExclusive) {
        return eventsByTime
            .subMap(fromInclusive, true, toExclusive, false)
            .values()
            .stream()
            .flatMap(List::stream)
            .toList();
    }
}
```

### Kenapa value `List<E>`?

Karena banyak event bisa terjadi di timestamp yang sama.

`TreeMap<Instant, E>` akan menimpa event lama jika key sama.

Jadi untuk key yang tidak unique, pilih:

```java
NavigableMap<K, List<V>>
```

atau:

```java
NavigableMap<K, Set<V>>
```

tergantung semantics.

---

## 13. Range View: `subMap`, `headMap`, `tailMap`

`NavigableMap` menyediakan view:

```java
subMap(fromKey, fromInclusive, toKey, toInclusive)
headMap(toKey, inclusive)
tailMap(fromKey, inclusive)
```

Contoh:

```java
NavigableMap<Integer, String> map = new TreeMap<>();
map.put(10, "A");
map.put(20, "B");
map.put(30, "C");
map.put(40, "D");
map.put(50, "E");

NavigableMap<Integer, String> middle = map.subMap(20, true, 50, false);
System.out.println(middle); // {20=B, 30=C, 40=D}
```

### View Bukan Copy

Ini sangat penting.

```java
middle.clear();
System.out.println(map); // {10=A, 50=E}
```

`subMap` adalah view backed by original map.

Artinya:

- perubahan di view memengaruhi original map,
- perubahan di original map terlihat di view,
- insert ke view harus berada dalam range view.

Contoh:

```java
middle.put(25, "X"); // OK
middle.put(60, "Y"); // IllegalArgumentException
```

### Production Rule

Jika butuh snapshot, copy explicit:

```java
NavigableMap<Integer, String> snapshot = new TreeMap<>(
    map.subMap(20, true, 50, false)
);
```

Atau immutable snapshot:

```java
Map<Integer, String> snapshot = Map.copyOf(
    map.subMap(20, true, 50, false)
);
```

Catatan: `Map.copyOf` tidak menjamin sorted/navigable semantics. Jika sorted behavior tetap dibutuhkan, gunakan `new TreeMap<>(...)` lalu expose secara tidak mutable sesuai kebutuhan.

---

## 14. Threshold Matching

Problem:

> Ada threshold score dan label. Untuk score tertentu, pilih threshold terbesar yang tidak melebihi score.

Data:

```text
0  -> LOW
50 -> MEDIUM
80 -> HIGH
95 -> CRITICAL
```

Query:

```text
87 -> HIGH
```

Implementasi:

```java
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

public final class ThresholdClassifier<T> {
    private final NavigableMap<Integer, T> thresholds;

    public ThresholdClassifier(Map<Integer, T> thresholds) {
        if (thresholds.isEmpty()) {
            throw new IllegalArgumentException("thresholds must not be empty");
        }
        this.thresholds = new TreeMap<>(thresholds);
    }

    public T classify(int score) {
        Map.Entry<Integer, T> entry = thresholds.floorEntry(score);
        if (entry == null) {
            throw new IllegalArgumentException("score below minimum threshold: " + score);
        }
        return entry.getValue();
    }
}
```

Usage:

```java
ThresholdClassifier<String> classifier = new ThresholdClassifier<>(Map.of(
    0, "LOW",
    50, "MEDIUM",
    80, "HIGH",
    95, "CRITICAL"
));

System.out.println(classifier.classify(87)); // HIGH
```

### Invariant

```text
selected threshold = max(threshold <= score)
```

---

## 15. Interval Matching: Ketika Floor Saja Tidak Cukup

Ada kasus di mana range bukan hanya start point.

Contoh:

```text
0..49    -> LOW
50..79   -> MEDIUM
80..94   -> HIGH
95..100  -> CRITICAL
```

Jika range menutupi semua angka tanpa gap dan overlap, floor threshold cukup.

Namun jika ada range seperti:

```text
10..20 -> A
30..40 -> B
50..60 -> C
```

Query `25` tidak boleh menghasilkan `A`, karena `25` di luar `10..20`.

Solusi:

```java
import java.util.Map;
import java.util.NavigableMap;
import java.util.Optional;
import java.util.TreeMap;

public final class IntervalIndex<V> {
    private final NavigableMap<Integer, Interval<V>> byStart = new TreeMap<>();

    public void add(int startInclusive, int endInclusive, V value) {
        if (startInclusive > endInclusive) {
            throw new IllegalArgumentException("start must be <= end");
        }

        // Minimal overlap validation with previous interval.
        Map.Entry<Integer, Interval<V>> previous = byStart.floorEntry(startInclusive);
        if (previous != null && previous.getValue().endInclusive >= startInclusive) {
            throw new IllegalArgumentException("overlap with previous interval");
        }

        // Minimal overlap validation with next interval.
        Map.Entry<Integer, Interval<V>> next = byStart.ceilingEntry(startInclusive);
        if (next != null && endInclusive >= next.getKey()) {
            throw new IllegalArgumentException("overlap with next interval");
        }

        byStart.put(startInclusive, new Interval<>(startInclusive, endInclusive, value));
    }

    public Optional<V> find(int point) {
        Map.Entry<Integer, Interval<V>> candidate = byStart.floorEntry(point);
        if (candidate == null) {
            return Optional.empty();
        }

        Interval<V> interval = candidate.getValue();
        if (point <= interval.endInclusive) {
            return Optional.of(interval.value);
        }
        return Optional.empty();
    }

    private record Interval<V>(int startInclusive, int endInclusive, V value) {}
}
```

### Key Insight

`floorEntry(point)` memberikan interval dengan start terbesar yang tidak melebihi point.

Tapi kita masih harus validasi:

```text
point <= interval.end
```

Tanpa validasi itu, gap akan salah diklasifikasikan.

---

## 16. `TreeSet` dan `NavigableSet`

`TreeSet` mirip `TreeMap`, tetapi hanya menyimpan element, bukan key-value pair.

Contoh deadline set:

```java
import java.time.Instant;
import java.util.NavigableSet;
import java.util.TreeSet;

NavigableSet<Instant> deadlines = new TreeSet<>();
deadlines.add(Instant.parse("2026-06-15T10:00:00Z"));
deadlines.add(Instant.parse("2026-06-15T12:00:00Z"));
deadlines.add(Instant.parse("2026-06-15T14:00:00Z"));

Instant now = Instant.parse("2026-06-15T11:00:00Z");

Instant previousOrCurrent = deadlines.floor(now);
Instant nextOrCurrent = deadlines.ceiling(now);
Instant strictlyNext = deadlines.higher(now);
```

Use case:

- next scheduled execution,
- next deadline,
- nearest known timestamp,
- ordered unique ID,
- missing sequence detection.

### Set Tidak Menyimpan Duplicate

Jika banyak case punya deadline sama, `TreeSet<Instant>` tidak cukup.

Gunakan:

```java
NavigableMap<Instant, List<CaseId>> casesByDeadline = new TreeMap<>();
```

---

## 17. Composite Key untuk Sorted Structure

Kadang ordering butuh lebih dari satu field.

Contoh:

```text
order by deadline asc, severity desc, caseId asc
```

Gunakan record sebagai key:

```java
import java.time.Instant;
import java.util.Comparator;

public record EscalationKey(
    Instant deadline,
    int severity,
    String caseId
) {
    public static final Comparator<EscalationKey> ORDERING =
        Comparator.comparing(EscalationKey::deadline)
            .thenComparing(Comparator.comparingInt(EscalationKey::severity).reversed())
            .thenComparing(EscalationKey::caseId);
}
```

Map:

```java
NavigableMap<EscalationKey, CaseWorkItem> queue = new TreeMap<>(EscalationKey.ORDERING);
```

### Why `caseId` di akhir?

Agar ordering total dan deterministic.

Jika comparator hanya memakai deadline dan severity, dua case dengan deadline dan severity sama akan dianggap key yang sama oleh `TreeMap`.

Contoh bug:

```java
Comparator<EscalationKey> bad = Comparator
    .comparing(EscalationKey::deadline)
    .thenComparing(Comparator.comparingInt(EscalationKey::severity).reversed());
```

Jika dua key berbeda tetapi comparator mengembalikan `0`, `TreeMap` menganggap mereka key yang sama.

Akibatnya item bisa tertimpa.

Rule:

> Comparator untuk key map/set harus membentuk identity ordering yang sesuai dengan uniqueness semantics.

---

## 18. Mutable Key dalam `TreeMap`/`TreeSet`

Sama seperti `HashMap` rusak jika hash key berubah, `TreeMap`/`TreeSet` rusak jika ordering key berubah setelah dimasukkan.

Buruk:

```java
final class MutableDeadline {
    Instant deadline;

    MutableDeadline(Instant deadline) {
        this.deadline = deadline;
    }
}
```

```java
Comparator<MutableDeadline> cmp = Comparator.comparing(d -> d.deadline);
TreeSet<MutableDeadline> set = new TreeSet<>(cmp);

MutableDeadline d = new MutableDeadline(Instant.parse("2026-06-15T10:00:00Z"));
set.add(d);

d.deadline = Instant.parse("2027-01-01T00:00:00Z"); // corrupt logical ordering
```

Set internal tree tidak otomatis reposition node.

Akibat:

- lookup bisa gagal,
- iteration order bisa salah,
- duplicate logical element bisa terjadi,
- range query bisa salah.

Benar:

- gunakan immutable key,
- jika perlu update key, remove old key lalu insert new key.

```java
queue.remove(oldKey);
queue.put(newKey, item);
```

---

## 19. Range Query dengan Composite Key

Misalnya kita ingin ambil semua item dengan deadline sebelum waktu tertentu.

Key:

```java
public record EscalationKey(
    Instant deadline,
    int severity,
    String caseId
) {
    public static final Comparator<EscalationKey> ORDERING =
        Comparator.comparing(EscalationKey::deadline)
            .thenComparing(Comparator.comparingInt(EscalationKey::severity).reversed())
            .thenComparing(EscalationKey::caseId);
}
```

Untuk query semua `deadline <= cutoff`, kita butuh upper bound key.

Cara aman adalah membuat sentinel key.

```java
EscalationKey upper = new EscalationKey(
    cutoff,
    Integer.MIN_VALUE,
    Character.toString(Character.MAX_VALUE)
);
```

Namun sentinel seperti ini rawan jika domain tidak jelas.

Alternatif lebih bersih:

- pisahkan index utama berdasarkan `Instant`, value list/secondary structure,
- atau gunakan `NavigableMap<Instant, List<CaseWorkItem>>` jika query utama adalah waktu.

```java
NavigableMap<Instant, List<CaseWorkItem>> byDeadline = new TreeMap<>();
```

Lalu:

```java
List<CaseWorkItem> due = byDeadline
    .headMap(cutoff, true)
    .values()
    .stream()
    .flatMap(List::stream)
    .toList();
```

### Design Lesson

Composite key bagus, tapi jangan paksakan jika query utama sebenarnya hanya satu dimensi.

Pertanyaan desain:

```text
Apa access pattern dominan?
```

Jika dominan `by deadline`, index by deadline.

Jika dominan `by state + deadline`, mungkin gunakan:

```java
EnumMap<State, NavigableMap<Instant, List<CaseId>>>
```

---

## 20. Multi-Index Design

Dalam sistem nyata, satu struktur data jarang cukup.

Misalnya case management perlu query:

1. by case ID,
2. by state,
3. by deadline range,
4. by owner,
5. by severity.

Satu `Map` tidak bisa optimal untuk semua.

Kita bisa buat beberapa index:

```java
final class CaseIndex {
    private final Map<String, CaseRecord> byId = new HashMap<>();
    private final EnumMap<CaseState, Set<String>> byState = new EnumMap<>(CaseState.class);
    private final NavigableMap<Instant, Set<String>> byDeadline = new TreeMap<>();
    private final Map<String, Set<String>> byOwner = new HashMap<>();
}
```

### Tapi Multi-Index Membawa Risiko Konsistensi

Saat insert/update/delete, semua index harus berubah konsisten.

Contoh update deadline:

```java
void updateDeadline(String caseId, Instant newDeadline) {
    CaseRecord old = byId.get(caseId);
    if (old == null) {
        throw new IllegalArgumentException("case not found: " + caseId);
    }

    removeFromDeadlineIndex(old.deadline(), caseId);

    CaseRecord updated = old.withDeadline(newDeadline);
    byId.put(caseId, updated);

    addToDeadlineIndex(newDeadline, caseId);
}
```

### Invariant

```text
For every case in byId:
- caseId must appear exactly once in byState[state]
- caseId must appear exactly once in byDeadline[deadline]
- caseId must appear exactly once in byOwner[owner]
```

### Failure Mode

Jika update `byId` berhasil tetapi update `byDeadline` gagal, index menjadi inconsistent.

Untuk in-memory structure, gunakan operation yang kecil dan fail-fast.

Untuk persistent/database-backed system, jadikan index maintenance bagian dari transaction atau rebuildable projection.

---

## 21. Binary Search di List of Objects

Misalnya kita punya list sorted by `createdAt`.

```java
record AuditEntry(long id, Instant createdAt, String action) {}
```

Kita ingin mencari lower bound berdasarkan `createdAt`.

```java
static int lowerBoundByCreatedAt(List<AuditEntry> entries, Instant target) {
    int lo = 0;
    int hi = entries.size();

    while (lo < hi) {
        int mid = lo + ((hi - lo) >>> 1);
        if (entries.get(mid).createdAt().compareTo(target) < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    return lo;
}
```

Range query:

```java
static List<AuditEntry> between(
    List<AuditEntry> entries,
    Instant fromInclusive,
    Instant toExclusive
) {
    int from = lowerBoundByCreatedAt(entries, fromInclusive);
    int to = lowerBoundByCreatedAt(entries, toExclusive);
    return entries.subList(from, to);
}
```

### Catatan Penting tentang `subList`

`subList` adalah view, bukan copy.

Jika list asal berubah secara struktural, view bisa menjadi invalid.

Untuk snapshot:

```java
return List.copyOf(entries.subList(from, to));
```

---

## 22. Binary Search dengan Predicate

Bentuk paling general:

```java
static int firstTrue(int lo, int hi, java.util.function.IntPredicate predicate) {
    while (lo < hi) {
        int mid = lo + ((hi - lo) >>> 1);
        if (predicate.test(mid)) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return lo;
}
```

Contoh:

```java
int index = firstTrue(0, a.length, i -> a[i] >= target);
```

Ini lower bound.

Untuk upper bound:

```java
int index = firstTrue(0, a.length, i -> a[i] > target);
```

### Requirement

Predicate harus monotonic.

Artinya pattern-nya harus seperti:

```text
false false false true true true
```

atau kebalikannya jika desain search berbeda.

Binary search tidak valid untuk predicate acak:

```text
false true false true false
```

---

## 23. Binary Search di Answer Space

Binary search tidak hanya untuk array. Bisa juga untuk mencari jawaban minimum/maksimum yang memenuhi constraint.

Contoh problem:

> Ada daftar pekerjaan dengan durasi. Cari kapasitas minimum worker per hari agar semua pekerjaan selesai dalam maksimal `D` hari, dengan urutan pekerjaan tetap.

Kita bisa binary search pada kapasitas.

```java
static int minCapacity(int[] jobs, int maxDays) {
    int lo = 0;
    int hi = 0;

    for (int job : jobs) {
        lo = Math.max(lo, job); // capacity minimal harus muat job terbesar
        hi += job;              // capacity maksimal semua job dalam 1 hari
    }

    while (lo < hi) {
        int mid = lo + ((hi - lo) >>> 1);
        if (canFinish(jobs, maxDays, mid)) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }

    return lo;
}

static boolean canFinish(int[] jobs, int maxDays, int capacity) {
    int days = 1;
    int current = 0;

    for (int job : jobs) {
        if (current + job <= capacity) {
            current += job;
        } else {
            days++;
            current = job;
        }
    }

    return days <= maxDays;
}
```

### Monotonic Predicate

Jika capacity `C` cukup, maka capacity lebih besar juga cukup.

Pattern:

```text
capacity:  10 11 12 13 14 15 16 17
canFinish:  F  F  F  T  T  T  T  T
```

Kita mencari first true.

Ini sangat umum dalam optimization problem.

---

## 24. Sorted Data untuk SLA Deadline Lookup

Misalnya sistem punya SLA policy:

```text
Severity LOW      -> 10 working days
Severity MEDIUM   -> 5 working days
Severity HIGH     -> 2 working days
Severity CRITICAL -> 4 hours
```

Lalu case perlu di-index berdasarkan computed deadline.

Structure:

```java
import java.time.Instant;
import java.util.*;

public final class SlaDeadlineIndex {
    private final NavigableMap<Instant, Set<String>> caseIdsByDeadline = new TreeMap<>();

    public void add(String caseId, Instant deadline) {
        caseIdsByDeadline
            .computeIfAbsent(deadline, ignored -> new LinkedHashSet<>())
            .add(caseId);
    }

    public void remove(String caseId, Instant deadline) {
        Set<String> ids = caseIdsByDeadline.get(deadline);
        if (ids == null) {
            return;
        }
        ids.remove(caseId);
        if (ids.isEmpty()) {
            caseIdsByDeadline.remove(deadline);
        }
    }

    public List<String> dueAtOrBefore(Instant cutoff) {
        return caseIdsByDeadline
            .headMap(cutoff, true)
            .values()
            .stream()
            .flatMap(Set::stream)
            .toList();
    }

    public Optional<Instant> nextDeadlineAfter(Instant now) {
        return Optional.ofNullable(caseIdsByDeadline.higherKey(now));
    }
}
```

### Important Design Choice

`headMap(cutoff, true)` returns all deadlines `<= cutoff`.

This is perfect for:

- overdue detection,
- scheduled escalation,
- reminder job,
- next due calculation.

---

## 25. `TreeMap` vs `PriorityQueue` untuk Deadline

Deadline scheduling bisa memakai `TreeMap` atau `PriorityQueue`.

| Operation | PriorityQueue | TreeMap |
|---|---:|---:|
| Peek earliest | O(1) | O(log n) or O(1)-ish via firstEntry depending implementation path, treat as O(log n)/documented navigation |
| Pop earliest | O(log n) | O(log n) |
| Remove arbitrary item | O(n) | O(log n) if key known |
| Range query due <= cutoff | Repeated pop/peek | `headMap` view |
| Multiple items same deadline | Need wrapper/list | Natural with map value collection |
| Update priority/deadline | Usually remove+add, remove costly | remove old key + add new key |
| Ordered iteration | Not sorted iteration | Sorted iteration |

Use `PriorityQueue` if:

```text
You mostly need next item by priority.
```

Use `TreeMap` if:

```text
You need range query, arbitrary removal/update by deadline, or grouped keys.
```

Use both if:

```text
You need fast next-item scheduling plus secondary indexes.
```

But then maintain consistency carefully.

---

## 26. Sorted Structure and Determinism

Hash-based structure does not guarantee sorted order.

If deterministic output matters, sorted structure may be required.

Examples:

- report generation,
- audit export,
- reconciliation result,
- deterministic test snapshot,
- migration diff,
- conflict resolution.

Bad:

```java
Map<String, Integer> counts = new HashMap<>();
```

Then output iteration order may not be meaningful.

Better if sorted by key:

```java
Map<String, Integer> counts = new TreeMap<>();
```

Or sort only at boundary:

```java
counts.entrySet().stream()
    .sorted(Map.Entry.comparingByKey())
    .forEach(System.out::println);
```

### Design Rule

If ordering is only needed for output, do not necessarily store data in sorted structure internally.

```text
Maintain fast write/read structure internally.
Sort at output boundary.
```

But if ordering is needed for core operation, use sorted index.

---

## 27. `NavigableMap` as Rule Engine Index

Suppose a rule engine needs to select rule by amount threshold:

```text
amount >= 0       -> STANDARD
amount >= 10_000  -> REVIEW
amount >= 50_000  -> SENIOR_REVIEW
amount >= 100_000 -> DIRECTOR_APPROVAL
```

Implementation:

```java
import java.math.BigDecimal;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

public final class AmountRuleIndex<R> {
    private final NavigableMap<BigDecimal, R> rulesByMinimumAmount;

    public AmountRuleIndex(Map<BigDecimal, R> rulesByMinimumAmount) {
        if (rulesByMinimumAmount.isEmpty()) {
            throw new IllegalArgumentException("rules must not be empty");
        }
        this.rulesByMinimumAmount = new TreeMap<>(rulesByMinimumAmount);
    }

    public R ruleFor(BigDecimal amount) {
        Map.Entry<BigDecimal, R> entry = rulesByMinimumAmount.floorEntry(amount);
        if (entry == null) {
            throw new IllegalArgumentException("amount below minimum: " + amount);
        }
        return entry.getValue();
    }
}
```

### BigDecimal Comparator Concern

`BigDecimal.compareTo` treats `1.0` and `1.00` as equal in comparison, while `BigDecimal.equals` does not.

For `TreeMap`, uniqueness follows comparator/natural ordering, not necessarily `equals`.

So these two keys collide in `TreeMap` natural ordering:

```java
new BigDecimal("1.0")
new BigDecimal("1.00")
```

In many financial threshold cases, that is acceptable. But it must be deliberate.

---

## 28. `EnumMap` + `TreeMap`: Nested Index Pattern

For domain systems, index often has categories.

Example:

```text
For each case state, find deadlines due before cutoff.
```

Design:

```java
import java.time.Instant;
import java.util.*;

public final class StateDeadlineIndex {
    private final EnumMap<CaseState, NavigableMap<Instant, Set<String>>> index =
        new EnumMap<>(CaseState.class);

    public StateDeadlineIndex() {
        for (CaseState state : CaseState.values()) {
            index.put(state, new TreeMap<>());
        }
    }

    public void add(CaseState state, Instant deadline, String caseId) {
        index.get(state)
            .computeIfAbsent(deadline, ignored -> new LinkedHashSet<>())
            .add(caseId);
    }

    public List<String> dueCases(CaseState state, Instant cutoff) {
        return index.get(state)
            .headMap(cutoff, true)
            .values()
            .stream()
            .flatMap(Set::stream)
            .toList();
    }

    public enum CaseState {
        DRAFT,
        SUBMITTED,
        UNDER_REVIEW,
        ESCALATED,
        CLOSED
    }
}
```

### Why This Is Good

- `EnumMap` is efficient for enum keys.
- `TreeMap` gives ordered deadline query.
- Query is scoped by state first, reducing search space.

Complexity:

```text
O(log m + k)
```

where:

```text
m = number of distinct deadlines for that state
k = number of returned case IDs
```

---

## 29. Sorted Array as Compact Index

For static data, sorted array can be turned into compact index.

Example threshold table:

```java
public final class StaticThresholdTable<T> {
    private final int[] thresholds;
    private final Object[] values;

    public StaticThresholdTable(Map<Integer, T> input) {
        if (input.isEmpty()) {
            throw new IllegalArgumentException("input must not be empty");
        }

        int size = input.size();
        this.thresholds = new int[size];
        this.values = new Object[size];

        int i = 0;
        for (Integer threshold : input.keySet().stream().sorted().toList()) {
            thresholds[i] = threshold;
            values[i] = input.get(threshold);
            i++;
        }
    }

    @SuppressWarnings("unchecked")
    public T find(int score) {
        int index = upperBound(thresholds, score) - 1;
        if (index < 0) {
            throw new IllegalArgumentException("score below minimum threshold: " + score);
        }
        return (T) values[index];
    }

    private static int upperBound(int[] a, int target) {
        int lo = 0;
        int hi = a.length;
        while (lo < hi) {
            int mid = lo + ((hi - lo) >>> 1);
            if (a[mid] <= target) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }
}
```

### Why Use Parallel Arrays?

Because for hot read-heavy path:

```text
int[] thresholds
Object[] values
```

can be more compact than many tree nodes.

This is not always worth it, but it is a valid optimization when:

- data is immutable,
- lookup is extremely frequent,
- memory footprint matters,
- profiling shows map/tree overhead is significant.

---

## 30. Choosing the Right Structure

### 30.1 Exact Lookup Only

Use:

```java
HashMap<K, V>
HashSet<E>
```

When:

```text
Need exact key lookup and no ordering.
```

### 30.2 Exact Lookup + Deterministic Insertion Order

Use:

```java
LinkedHashMap<K, V>
LinkedHashSet<E>
```

When:

```text
Need predictable iteration by insertion/access order.
```

### 30.3 Ordered Lookup, Range Query, Nearest Key

Use:

```java
TreeMap<K, V>
TreeSet<E>
NavigableMap<K, V>
NavigableSet<E>
```

When:

```text
Need floor/ceiling/lower/higher/subMap/headMap/tailMap.
```

### 30.4 Static Sorted Lookup

Use:

```java
sorted array/list + binary search
```

When:

```text
Data changes rarely, query is frequent, and compact memory/read locality matters.
```

### 30.5 Next Priority Only

Use:

```java
PriorityQueue<E>
```

When:

```text
Need repeated min/max extraction, not range queries.
```

---

## 31. Case Study: Effective Rule Registry

Let’s design a small production-style effective rule registry.

Requirements:

1. Rule belongs to a rule type.
2. Rule has effective date.
3. For `(ruleType, date)`, find rule active at that date.
4. Rule type is enum.
5. Rules are loaded on startup and rarely updated.
6. Query is frequent.

### Option A: `EnumMap<RuleType, TreeMap<LocalDate, Rule>>`

```java
import java.time.LocalDate;
import java.util.*;

public final class EffectiveRuleRegistry {
    private final EnumMap<RuleType, NavigableMap<LocalDate, Rule>> rules;

    public EffectiveRuleRegistry(List<Rule> input) {
        EnumMap<RuleType, NavigableMap<LocalDate, Rule>> mutable = new EnumMap<>(RuleType.class);
        for (RuleType type : RuleType.values()) {
            mutable.put(type, new TreeMap<>());
        }

        for (Rule rule : input) {
            Rule previous = mutable.get(rule.type()).put(rule.effectiveDate(), rule);
            if (previous != null) {
                throw new IllegalArgumentException(
                    "duplicate rule for type=" + rule.type() + ", date=" + rule.effectiveDate()
                );
            }
        }

        this.rules = mutable;
    }

    public Optional<Rule> find(RuleType type, LocalDate date) {
        NavigableMap<LocalDate, Rule> byDate = rules.get(type);
        if (byDate == null) {
            return Optional.empty();
        }
        Map.Entry<LocalDate, Rule> entry = byDate.floorEntry(date);
        return entry == null ? Optional.empty() : Optional.of(entry.getValue());
    }

    public enum RuleType {
        ELIGIBILITY,
        ESCALATION,
        FEE,
        SLA
    }

    public record Rule(
        RuleType type,
        LocalDate effectiveDate,
        String code,
        String expression
    ) {}
}
```

### Complexity

```text
find(type, date): O(1) enum lookup + O(log m) floorEntry
```

where:

```text
m = number of versions for that rule type
```

### Option B: Static Sorted Array per Rule Type

If truly read-only and extremely hot, replace inner `TreeMap` with sorted list/array.

But start with `TreeMap` unless profiling says otherwise.

Design rule:

```text
Prefer clarity first. Optimize representation after measurement.
```

---

## 32. Failure Model Checklist

### 32.1 Wrong Ordering

Symptom:

```text
binarySearch returns wrong result
TreeMap missing expected key
TreeSet drops distinct item
```

Possible causes:

- data not sorted,
- wrong comparator used,
- comparator not transitive,
- comparator inconsistent with desired uniqueness,
- key mutated after insertion.

### 32.2 Range Boundary Bug

Symptom:

```text
SLA job processes too many/few cases
report excludes boundary date
config selected one version too early/late
```

Possible causes:

- inclusive vs exclusive boundary mistake,
- `floor` vs `lower` confusion,
- `ceiling` vs `higher` confusion,
- timezone/date conversion issue,
- range represented as end-inclusive but queried as end-exclusive.

### 32.3 View Mutation Bug

Symptom:

```text
Clearing subMap unexpectedly deletes original data
Modifying range result corrupts index
```

Cause:

```text
subMap/headMap/tailMap are views backed by original map.
```

### 32.4 Duplicate Key Bug

Symptom:

```text
Only one case appears for shared deadline
Only one rule remains for same threshold
```

Cause:

```text
TreeMap key is unique. If multiple values share key, value must be collection.
```

### 32.5 Performance Surprise

Symptom:

```text
TreeMap slower than expected for read-heavy static config
```

Cause:

- pointer chasing,
- node allocation overhead,
- poor locality,
- unnecessary generality.

Possible fix:

```text
Use sorted arrays/lists for immutable hot data.
```

---

## 33. Testing Strategy

### 33.1 Boundary Tests for Binary Search

Test:

```text
empty array
single element
all less than target
all greater than target
target at first
target at last
duplicates
negative values
large values
```

Example:

```java
import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

final class BoundsTest {
    @Test
    void lowerBoundHandlesDuplicates() {
        int[] a = {10, 20, 20, 20, 30};
        assertEquals(1, Bounds.lowerBound(a, 20));
    }

    @Test
    void upperBoundHandlesDuplicates() {
        int[] a = {10, 20, 20, 20, 30};
        assertEquals(4, Bounds.upperBound(a, 20));
    }

    @Test
    void lowerBoundReturnsLengthWhenAllLess() {
        int[] a = {10, 20, 30};
        assertEquals(3, Bounds.lowerBound(a, 99));
    }

    @Test
    void lowerBoundReturnsZeroWhenAllGreater() {
        int[] a = {10, 20, 30};
        assertEquals(0, Bounds.lowerBound(a, 1));
    }
}
```

### 33.2 Property-Like Tests

For random sorted arrays:

```text
lowerBound result i must satisfy:
- all elements before i are < target
- all elements from i onward are >= target
```

```java
static void assertLowerBoundProperty(int[] a, int target, int index) {
    for (int i = 0; i < index; i++) {
        if (!(a[i] < target)) {
            throw new AssertionError("element before lower bound is not < target");
        }
    }
    for (int i = index; i < a.length; i++) {
        if (!(a[i] >= target)) {
            throw new AssertionError("element at/after lower bound is not >= target");
        }
    }
}
```

### 33.3 Range Index Tests

Test inclusivity explicitly:

```text
from inclusive included
to exclusive excluded
empty range works
same timestamp multiple values returned
boundary with no matching key
```

---

## 34. Design Checklist

Before choosing sorted structure, ask:

1. Is exact lookup enough?
2. Do I need nearest key?
3. Do I need range query?
4. Do I need deterministic iteration?
5. Is data mostly static or frequently mutated?
6. Are duplicate keys possible?
7. Is ordering natural or custom?
8. Is comparator total, transitive, and stable?
9. Are keys immutable after insertion?
10. Are range boundaries inclusive or exclusive?
11. Are returned views safe to expose?
12. Is memory overhead acceptable?
13. Is read locality important?
14. Can the structure be rebuilt from source of truth if corrupted?
15. Is this an index that must be kept consistent with another index?

---

## 35. Summary Mental Model

Binary search is not just:

```text
Find target in sorted array.
```

It is:

```text
Find a boundary in an ordered search space.
```

Sorted structures are not just:

```text
Collections that iterate in order.
```

They are:

```text
Indexes that support nearest-key and range operations.
```

`HashMap` is ideal for exact lookup.

`TreeMap`/`NavigableMap` are ideal for ordered lookup:

```text
floor
ceiling
lower
higher
subMap
headMap
tailMap
```

Sorted arrays/lists are ideal for read-heavy immutable data.

The engineering skill is not memorizing that binary search is `O(log n)`.

The engineering skill is recognizing this pattern:

```text
I have ordered data.
My question is about a boundary.
Therefore I need binary search or a navigable index.
```

---

## 36. References

- Oracle Java SE 25 API — `Arrays`
- Oracle Java SE 25 API — `Collections`
- Oracle Java SE 25 API — `NavigableMap`
- Oracle Java SE 25 API — `NavigableSet`
- Oracle Java SE 25 API — `TreeMap`
- Oracle Java SE 25 API — `TreeSet`
- Oracle Java SE 25 API — `Comparator`
- Oracle Java SE 25 Collections Framework Overview
- Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, for binary search, balanced trees, and red-black tree foundations

---

## 37. Status Seri

Part ini adalah:

```text
Part 009 dari 030
```

Seri **belum selesai**.

Berikutnya:

```text
Part 010 — Trees I: Tree Fundamentals, Traversal, Recursion
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-dsa-part-008 — Ordering, Sorting, Comparator, Comparable](./learn-java-dsa-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-010 — Trees I: Tree Fundamentals, Traversal, Recursion](./learn-java-dsa-part-010.md)

</div>