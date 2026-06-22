# learn-java-dsa-part-001.md

# Part 001 — Complexity Analysis yang Realistis di Java

> Seri: **Java Data Structure and Algorithm Advanced**  
> Bagian: **001 dari 030**  
> Status seri: **belum selesai**  
> Fokus: memahami complexity bukan sebagai hafalan Big-O, tetapi sebagai **model biaya engineering** untuk memilih, mendesain, mengukur, dan mempertahankan struktur data/algoritma di Java production system.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membaca complexity tidak hanya sebagai `O(n)`, `O(log n)`, atau `O(1)`, tetapi sebagai **prediksi biaya nyata**.
2. Membedakan:
   - asymptotic complexity,
   - amortized complexity,
   - average-case,
   - worst-case,
   - practical latency,
   - memory complexity,
   - allocation pressure.
3. Menjelaskan kenapa algoritma dengan Big-O lebih baik belum tentu lebih cepat di Java untuk ukuran data tertentu.
4. Mengidentifikasi hidden cost Java:
   - object allocation,
   - pointer chasing,
   - boxing/unboxing,
   - GC pressure,
   - cache locality,
   - comparator overhead,
   - hash computation,
   - resize/rehash,
   - branch behavior,
   - JIT warmup.
5. Mengubah pertanyaan “struktur data mana paling cepat?” menjadi pertanyaan yang lebih benar:
   > “Untuk operation mix, ukuran data, pola akses, mutability, concurrency, dan memory budget ini, struktur data mana yang mempertahankan invariant paling murah dan paling aman?”
6. Membuat reasoning performa yang defensible, bukan sekadar opini.

---

## 1. Kenapa Bagian Ini Penting

Banyak engineer tahu bahwa:

- lookup `HashMap` rata-rata `O(1)`,
- lookup `TreeMap` `O(log n)`,
- search di `ArrayList` `O(n)`,
- sorting `O(n log n)`.

Itu benar, tapi belum cukup.

Di production Java, pertanyaan sebenarnya lebih kompleks:

- Apakah `O(1)` itu benar-benar konstan jika hash function buruk?
- Apakah `O(log n)` lebih lambat jika `n` kecil?
- Apakah `ArrayList.contains` yang `O(n)` bisa lebih cepat dari `HashSet.contains` untuk 10 elemen?
- Apakah `HashMap` yang cepat masih cepat jika key-nya object besar dengan expensive `hashCode()`?
- Apakah `List<Integer>` masih masuk akal jika berisi 50 juta angka?
- Apakah resize `HashMap` bisa menciptakan latency spike?
- Apakah penggunaan `Stream` membuat allocation tambahan?
- Apakah `LinkedList` benar-benar cocok untuk frequent insert/delete?

Complexity analysis adalah **peta**, bukan medan. Big-O memberi arah kasar, tetapi Java runtime menentukan banyak detail medan: object layout, GC, JIT, CPU cache, allocation rate, dan implementation detail library.

Seorang engineer top-tier tidak berhenti pada:

```java
// O(1), therefore fast
map.get(id);
```

Ia bertanya:

```text
- Seberapa besar map-nya?
- Apakah key immutable?
- Apakah hashCode murah dan stabil?
- Apakah map sudah di-sizing?
- Apakah terjadi resize di hot path?
- Apakah map read-heavy atau write-heavy?
- Apakah iteration order dibutuhkan?
- Apakah ada memory pressure?
- Apakah lookup ini berada di request path latency-sensitive?
- Apakah ada concurrency?
```

---

## 2. Complexity adalah Model Biaya, Bukan Label

Complexity adalah cara untuk menjawab:

> Ketika ukuran input bertambah, bagaimana biaya algoritma bertumbuh?

Biaya bisa berarti:

- waktu CPU,
- jumlah operasi,
- jumlah perbandingan,
- jumlah hash computation,
- jumlah allocation,
- jumlah memory,
- jumlah pointer dereference,
- jumlah network/database call,
- jumlah lock contention,
- latency tail.

Dalam DSA textbook, biasanya biaya direduksi menjadi jumlah operasi abstrak. Dalam Java production system, biaya lebih realistis:

```text
actual cost ≈ algorithmic work
            + object allocation
            + memory access pattern
            + GC side effect
            + virtual dispatch
            + boxing/unboxing
            + cache misses
            + branch misprediction
            + synchronization/visibility cost
            + runtime warmup/profile effect
```

Big-O tetap penting, tetapi ia hanya salah satu lapisan.

---

## 3. Big-O, Big-Theta, Big-Omega

### 3.1 Big-O

Big-O memberi batas atas pertumbuhan biaya.

Contoh:

```text
Linear scan: O(n)
Binary search: O(log n)
Hash lookup average: O(1)
Sorting comparison-based: O(n log n)
```

`O(n)` bukan berarti operasi persis `n`. Ia berarti biaya tumbuh proporsional terhadap ukuran input.

Contoh:

```java
boolean containsUserId(List<Long> ids, long target) {
    for (Long id : ids) {
        if (id == target) {
            return true;
        }
    }
    return false;
}
```

Worst-case: target tidak ada atau berada di akhir list.

Biaya tumbuh linear terhadap jumlah elemen.

### 3.2 Big-Theta

Big-Theta memberi batas ketat.

Jika sebuah algoritma selalu melakukan scan seluruh input, maka complexity-nya `Θ(n)`.

Contoh:

```java
long sum(int[] values) {
    long total = 0;
    for (int value : values) {
        total += value;
    }
    return total;
}
```

Selalu membaca seluruh elemen. Best-case, average-case, worst-case sama-sama linear.

### 3.3 Big-Omega

Big-Omega memberi batas bawah.

Contoh: comparison-based sorting memiliki lower bound `Ω(n log n)` untuk general case. Artinya, tidak ada algoritma sorting berbasis comparison yang bisa menjamin lebih baik dari itu untuk semua input.

Tetapi jika datanya memiliki constraint khusus, misalnya integer dalam range kecil, kita bisa memakai counting sort atau bucket-based technique dengan cost berbeda.

---

## 4. Best-Case, Average-Case, Worst-Case

### 4.1 Best-case sering tidak berguna untuk production guarantee

Contoh:

```java
boolean contains(List<String> names, String target) {
    for (String name : names) {
        if (name.equals(target)) {
            return true;
        }
    }
    return false;
}
```

Best-case: target ada di elemen pertama, `O(1)`.

Tapi untuk desain sistem, best-case jarang menjadi dasar keputusan. Yang lebih penting:

- apakah worst-case dapat diterima?
- apakah average-case merepresentasikan distribusi data nyata?
- apakah tail latency aman?

### 4.2 Average-case bergantung pada distribusi input

`HashMap.get` sering disebut average `O(1)`, tetapi average terhadap asumsi:

- hash tersebar baik,
- key equality murah,
- load factor sehat,
- collision tidak ekstrem,
- map tidak sedang resize,
- tidak ada mutasi key setelah insertion.

Jika asumsi rusak, “average” yang kamu bayangkan bisa tidak berlaku.

### 4.3 Worst-case adalah kontrak risiko

Worst-case sering menentukan apakah sistem aman.

Contoh:

- API request harus selesai < 200 ms.
- Data input berasal dari user tidak terpercaya.
- Ada potensi hash flooding.
- Queue bisa tumbuh tak terbatas.
- Recursive traversal bisa terkena depth ekstrem.

Dalam sistem critical, worst-case lebih penting daripada happy path.

---

## 5. Complexity Berdasarkan Operation Mix

Kesalahan umum: memilih struktur data hanya dari satu operasi.

Misalnya:

```text
HashMap lookup O(1), maka pakai HashMap.
```

Padahal struktur data harus dipilih berdasarkan operation mix.

Contoh operation mix:

```text
- 80% lookup by id
- 10% insert
- 5% delete
- 5% iteration sorted by deadline
```

`HashMap` bagus untuk lookup by id, tetapi tidak menjaga sorted order. Jika operasi sorted iteration penting, mungkin perlu:

- `HashMap<ID, Entity>` untuk lookup,
- plus `TreeMap<Deadline, Set<ID>>` untuk range query,
- atau heap untuk priority by deadline,
- atau database index jika datanya persistent dan besar.

### 5.1 Jangan tanya: “mana paling cepat?”

Tanya:

```text
1. Operasi apa yang sering?
2. Operasi apa yang latency-sensitive?
3. Operasi apa yang boleh mahal?
4. Apakah data mostly-read atau mostly-write?
5. Apakah ordering dibutuhkan?
6. Apakah range query dibutuhkan?
7. Apakah duplicate diperbolehkan?
8. Apakah key immutable?
9. Apakah data bounded?
10. Apakah struktur ini hidup lama di heap?
```

### 5.2 Contoh: memilih collection untuk active case registry

Misal domain:

```text
Case memiliki:
- caseId
- state
- assignedOfficer
- dueDate
- severity
```

Required operations:

```text
- find by caseId
- list by state
- find overdue cases
- process highest severity first
- remove closed case
```

Satu struktur data jarang cukup.

Desain yang lebih masuk akal:

```java
Map<CaseId, CaseRecord> byId;
EnumMap<CaseState, Set<CaseId>> byState;
NavigableMap<Instant, Set<CaseId>> byDueDate;
PriorityQueue<CaseId> bySeverity;
```

Tapi ini membawa konsekuensi:

- setiap insert harus update semua index,
- setiap delete harus remove dari semua index,
- setiap mutation field indexed harus reindex,
- invariant antar-index harus dijaga.

Complexity bukan hanya per struktur data, tetapi per **consistency protocol**.

---

## 6. Big-O Tidak Melihat Constant Factor

Dua algoritma bisa sama-sama `O(n)`, tetapi berbeda jauh secara nyata.

Contoh:

```java
long sumArray(int[] values) {
    long total = 0;
    for (int value : values) {
        total += value;
    }
    return total;
}
```

vs

```java
long sumList(List<Integer> values) {
    long total = 0;
    for (Integer value : values) {
        total += value;
    }
    return total;
}
```

Keduanya `O(n)`, tetapi cost model berbeda:

| Aspek | `int[]` | `List<Integer>` |
|---|---|---|
| Storage | contiguous primitive | references ke boxed objects |
| Access | direct array load | load reference lalu object load |
| Memory | compact | jauh lebih besar |
| CPU cache | lebih ramah | pointer chasing |
| Allocation | satu array | banyak `Integer` object, kecuali cached/sudah ada |
| Unboxing | tidak ada | ada |

Big-O sama. Runtime behavior bisa sangat berbeda.

---

## 7. Constant Factor yang Sering Tersembunyi di Java

### 7.1 Boxing dan unboxing

```java
List<Integer> values = new ArrayList<>();
values.add(42); // int -> Integer
```

Boxing dapat menciptakan object tambahan, kecuali untuk beberapa cached boxed values dan optimisasi tertentu. Untuk data besar, ini bisa signifikan.

Contoh buruk:

```java
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 10_000_000; i++) {
    numbers.add(i);
}
```

Risiko:

- banyak allocation,
- memory footprint besar,
- GC pressure,
- cache locality buruk.

Alternatif:

```java
int[] numbers = new int[10_000_000];
for (int i = 0; i < numbers.length; i++) {
    numbers[i] = i;
}
```

Atau gunakan primitive-specialized collection library jika memang perlu dynamic primitive collection.

### 7.2 Comparator overhead

Sorting object dengan comparator bukan sekadar `O(n log n)`. Setiap comparison bisa mahal.

Buruk:

```java
users.sort((a, b) -> {
    String left = a.getProfile().getAddress().getCountry().toLowerCase();
    String right = b.getProfile().getAddress().getCountry().toLowerCase();
    return left.compareTo(right);
});
```

Masalah:

- nested access berulang,
- allocation dari `toLowerCase`,
- locale issue,
- comparison function dipanggil berkali-kali.

Lebih baik untuk dataset besar:

```java
record SortKey(User user, String normalizedCountry) {}

List<SortKey> keyed = users.stream()
    .map(user -> new SortKey(user, user.getProfile().getAddress().getCountry().toLowerCase(Locale.ROOT)))
    .toList();

List<User> sorted = keyed.stream()
    .sorted(Comparator.comparing(SortKey::normalizedCountry))
    .map(SortKey::user)
    .toList();
```

Trade-off:

- ada allocation `SortKey`,
- tapi normalisasi dilakukan sekali,
- comparator menjadi murah.

Untuk data kecil, versi pertama mungkin cukup. Untuk hot path besar, versi kedua bisa lebih stabil.

### 7.3 Hash computation

`HashMap.get(key)` bukan magic. Minimal ada:

1. hitung hash,
2. cari bucket,
3. bandingkan key jika collision,
4. return value.

Jika `hashCode()` mahal, lookup “O(1)” tetap mahal.

Contoh key mahal:

```java
record LargeKey(List<String> fields) {}
```

`record` default `hashCode()` akan mempertimbangkan component. Jika `fields` besar, hash bisa mahal.

Solusi tergantung konteks:

- gunakan key yang lebih kecil dan immutable,
- precompute hash jika aman,
- canonicalize key,
- gunakan ID stable,
- hindari mutable nested structure sebagai key.

---

## 8. Memory Complexity: Lebih dari `O(n)`

Memory complexity sering ditulis sederhana:

```text
Array: O(n)
HashMap: O(n)
TreeMap: O(n)
```

Tapi `O(n)` tidak menjelaskan berapa byte per elemen.

Contoh:

```text
int[1_000_000]          -> relatif compact
Integer[1_000_000]      -> array references + Integer objects
ArrayList<Integer>      -> backing Object[] + Integer objects
HashMap<Integer,User>   -> table array + node objects + keys + values
TreeMap<Integer,User>   -> tree entries + keys + values + references
```

Sama-sama `O(n)`, tetapi memory footprint sangat berbeda.

### 8.1 Shallow size vs retained size

- **Shallow size**: ukuran object itu sendiri.
- **Retained size**: ukuran object plus semua object yang hanya bisa dicapai melalui object tersebut.

Contoh:

```java
List<User> users = new ArrayList<>();
```

Shallow size list kecil. Retained size bisa besar karena mencakup backing array dan semua object `User` jika tidak direferensikan dari tempat lain.

### 8.2 Object graph matters

Struktur data Java umumnya adalah graph of objects.

Contoh konseptual `HashMap<K,V>`:

```text
HashMap object
  -> table array
       -> Node
           -> key
           -> value
           -> next Node
```

Setiap pointer traversal berpotensi memory access tambahan.

### 8.3 JOL untuk validasi footprint

JOL dapat digunakan untuk melihat object layout, footprint, dan references pada JVM aktual. Ini penting karena asumsi ukuran object dapat berbeda berdasarkan JVM, compressed references, alignment, dan konfigurasi runtime.

Contoh penggunaan konseptual:

```java
import org.openjdk.jol.info.GraphLayout;

import java.util.ArrayList;
import java.util.List;

public class FootprintDemo {
    public static void main(String[] args) {
        List<Integer> values = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            values.add(i);
        }

        System.out.println(GraphLayout.parseInstance(values).toFootprint());
    }
}
```

Gunanya bukan untuk menghafal angka, tetapi untuk membentuk intuisi:

```text
- object overhead nyata
- reference graph nyata
- boxed primitive mahal
- node-based structure mahal
- array-backed structure biasanya lebih compact
```

---

## 9. Cache Locality dan Pointer Chasing

CPU jauh lebih cepat daripada memory access. Struktur data yang tampak bagus secara Big-O bisa lambat karena memory access pattern.

### 9.1 Array-backed structure

```text
[ e0 ][ e1 ][ e2 ][ e3 ][ e4 ]
```

Keuntungan:

- data berdekatan,
- CPU cache friendly,
- prefetching lebih efektif,
- traversal cepat.

### 9.2 Node-based structure

```text
nodeA -> nodeB -> nodeC -> nodeD
```

Setiap node bisa berada di lokasi heap berbeda.

Risiko:

- cache miss,
- pointer chasing,
- memory overhead tinggi,
- GC traversal lebih mahal.

### 9.3 Kenapa `LinkedList` sering kalah

Secara teori:

```text
insert/delete jika node sudah diketahui: O(1)
```

Tapi dalam praktik:

- mencari posisi tetap `O(n)`,
- setiap node object terpisah,
- pointer chasing buruk,
- memory overhead besar,
- random access buruk.

Karena itu, untuk banyak kasus, `ArrayList` lebih cepat walaupun insert/delete tengah membutuhkan shifting.

Mental model:

```text
Big-O melihat jumlah langkah abstrak.
CPU melihat memory movement dan cache misses.
```

---

## 10. Amortized Complexity

Amortized complexity menjawab:

> Jika satu operasi kadang mahal, tetapi jarang terjadi, berapa biaya rata-ratanya dalam sequence panjang?

### 10.1 Dynamic array growth

`ArrayList.add` umumnya dianggap amortized `O(1)`.

Kenapa?

- Jika backing array masih cukup, add murah.
- Jika penuh, perlu allocate array baru dan copy elemen lama.
- Resize mahal, tetapi tidak terjadi setiap add.

Contoh konseptual:

```java
List<Integer> values = new ArrayList<>();
for (int i = 0; i < n; i++) {
    values.add(i);
}
```

Sebagian besar `add` murah. Beberapa `add` mahal karena growth.

### 10.2 Amortized bukan berarti tidak ada latency spike

Ini penting.

```text
Amortized O(1) does not mean every operation is O(1).
```

Dalam request path latency-sensitive, satu resize besar bisa menyebabkan spike.

Solusi:

```java
List<Event> events = new ArrayList<>(expectedSize);
```

Atau untuk `HashMap`:

```java
Map<String, User> usersById = new HashMap<>(expectedCapacity);
```

Sizing awal bukan micro-optimization jika:

- data besar,
- hot path,
- low latency,
- resize bisa muncul saat traffic tinggi.

### 10.3 HashMap resize dan rehash

`HashMap` memiliki capacity dan load factor. Ketika jumlah entry melewati threshold tertentu, table perlu diperbesar dan entry didistribusikan ulang.

Efek:

- operation yang memicu resize menjadi mahal,
- latency spike,
- allocation besar,
- temporary memory pressure.

Mental model:

```text
put normally: cheap
put causing resize: expensive
many maps resizing together: dangerous
```

---

## 11. Average `O(1)` pada HashMap: Apa Syaratnya?

`HashMap` sering disebut `O(1)` untuk get/put. Lebih tepat:

```text
Expected average O(1), under good hash distribution and healthy table state.
```

Syarat penting:

1. `hashCode()` stabil.
2. `equals()` benar.
3. Key tidak dimutasi setelah dimasukkan.
4. Hash distribution cukup baik.
5. Load factor tidak terlalu tinggi.
6. Capacity cukup.
7. Collision tidak parah.
8. Key comparison murah.

### 11.1 Mutable key problem

Buruk:

```java
final class UserKey {
    private String tenantId;
    private String userId;

    // equals/hashCode use tenantId and userId

    void setUserId(String userId) {
        this.userId = userId;
    }
}
```

Jika object ini dipakai sebagai key lalu dimutasi:

```java
UserKey key = new UserKey("tenant-a", "u-1");
map.put(key, user);

key.setUserId("u-2");

map.get(key); // bisa gagal menemukan entry
```

Kenapa?

- Entry awal masuk bucket berdasarkan hash lama.
- Setelah key berubah, hash baru menunjuk bucket berbeda.
- Map secara internal tidak tahu key berubah.

Complexity bukan lagi masalah utama. Correctness hancur.

### 11.2 Hash collision

Jika banyak key jatuh ke bucket sama, lookup harus membandingkan beberapa key.

Modern `HashMap` memiliki mekanisme tree bin untuk collision tertentu, tetapi kamu tetap tidak boleh mendesain dengan asumsi collision gratis.

Prinsip:

```text
HashMap is fast when hash contract and key design are healthy.
```

---

## 12. `O(log n)` Tidak Selalu Lambat

`TreeMap` memiliki operasi utama `O(log n)`. Sering dianggap kalah dari `HashMap`.

Tapi `TreeMap` memberi kemampuan yang `HashMap` tidak punya:

- sorted iteration,
- floor key,
- ceiling key,
- range query,
- nearest match,
- ordered navigation.

Contoh:

```java
NavigableMap<Instant, List<CaseId>> byDeadline = new TreeMap<>();

NavigableMap<Instant, List<CaseId>> overdue =
    byDeadline.headMap(Instant.now(), true);
```

Dengan `HashMap`, range query seperti ini tidak natural. Kamu mungkin harus scan semua entry `O(n)`.

Jadi:

```text
HashMap get by exact key: usually better
TreeMap range/navigation query: often better
```

Complexity harus dibandingkan terhadap operasi yang benar.

---

## 13. `O(n)` Kadang Lebih Baik dari `O(1)`

Untuk `n` kecil, linear scan bisa lebih murah daripada hash table.

Contoh:

```java
private static final List<String> ALLOWED_STATES = List.of(
    "DRAFT", "SUBMITTED", "APPROVED", "REJECTED"
);

boolean isAllowed(String state) {
    return ALLOWED_STATES.contains(state);
}
```

`contains` di list adalah linear, tetapi hanya 4 elemen.

Mengganti menjadi `HashSet` mungkin tidak memberi manfaat berarti dan bisa menambah overhead.

Prinsip:

```text
For tiny bounded data, simplicity often wins.
```

Tetapi jika state list menjadi ratusan/ribuan dan dipanggil di hot path, pertimbangkan set atau enum.

---

## 14. Data Size Threshold Thinking

Daripada berpikir binary:

```text
HashSet always better than ArrayList for contains.
```

Berpikir threshold:

```text
For n <= small constant, list scan may be fine.
For n large or contains frequent, set becomes better.
```

Threshold tidak universal. Ia bergantung pada:

- ukuran data,
- tipe key,
- cost hash,
- cost equals,
- CPU cache,
- JVM,
- data distribution,
- frequency operasi,
- allocation pattern.

Karena itu, untuk keputusan penting, ukur dengan workload representatif.

---

## 15. Latency Tail dan Spike

Average performance bisa menipu.

Misalnya:

```text
99 operasi: 1 ms
1 operasi: 200 ms
average: ~3 ms
```

Average terlihat bagus, tetapi p99 buruk.

Dalam sistem backend, p95/p99 sering lebih penting daripada average.

Sumber spike DSA di Java:

1. `ArrayList` growth besar.
2. `HashMap` resize besar.
3. Sorting list besar di request path.
4. Recursive traversal depth ekstrem.
5. Cache eviction besar sekaligus.
6. Full scan karena index tidak tersedia.
7. Boxing allocation besar.
8. GC akibat temporary object banyak.
9. Lock contention pada shared structure.
10. Comparator atau `equals` mahal.

Prinsip:

```text
Average complexity tells growth tendency.
Tail latency tells user-visible risk.
```

---

## 16. Allocation Rate sebagai Complexity Tersembunyi

Dua algoritma bisa sama-sama `O(n)`, tetapi salah satunya allocate object per elemen.

Contoh:

```java
List<String> normalize(List<String> names) {
    return names.stream()
        .map(String::trim)
        .map(s -> s.toLowerCase(Locale.ROOT))
        .toList();
}
```

Complexity waktu `O(n)`, memory tambahan `O(n)`. Tapi ada detail:

- `trim` bisa membuat string baru jika berubah,
- `toLowerCase` bisa membuat string baru,
- stream pipeline punya overhead tertentu,
- result list baru dibuat.

Untuk batch kecil, ini baik. Untuk jutaan item di hot path, allocation rate harus diperhatikan.

### 16.1 Allocation pressure memicu GC pressure

Jika algoritma membuat banyak temporary object:

```text
higher allocation rate -> young GC more frequent -> possible latency impact
```

Solusi bukan selalu “hindari object”. Java modern sangat baik mengelola short-lived object. Tetapi engineer harus tahu kapan allocation menjadi bottleneck.

### 16.2 Contoh hidden allocation dalam loop

Buruk:

```java
for (User user : users) {
    String key = user.tenantId() + ":" + user.userId();
    result.put(key, user);
}
```

Setiap iterasi membuat string key baru.

Jika key dipakai lama, mungkin benar. Jika hanya temporary lookup, mungkin mahal.

Alternatif tergantung konteks:

- gunakan composite key record,
- precompute key,
- pakai nested map,
- gunakan ID canonical.

```java
Map<String, Map<String, User>> byTenantThenUser = new HashMap<>();
```

Trade-off:

- nested map lebih kompleks,
- bisa menghindari string concatenation,
- tetapi menambah map object.

Tidak ada jawaban universal. Yang ada adalah cost model.

---

## 17. Complexity dari API Call Collections

Java Collections Framework menyediakan interface dan implementasi. Namun complexity bergantung pada implementasi.

Contoh:

```java
List<String> list = ...;
list.get(i);
```

Jika `list` adalah `ArrayList`, `get(i)` murah. Jika `list` adalah `LinkedList`, `get(i)` linear.

### 17.1 Interface menyembunyikan cost

```java
void process(List<Order> orders) {
    for (int i = 0; i < orders.size(); i++) {
        Order order = orders.get(i);
        process(order);
    }
}
```

Aman untuk `ArrayList`, buruk untuk `LinkedList`.

Lebih aman:

```java
void process(List<Order> orders) {
    for (Order order : orders) {
        process(order);
    }
}
```

Atau jika butuh random access:

```java
if (orders instanceof RandomAccess) {
    for (int i = 0; i < orders.size(); i++) {
        process(orders.get(i));
    }
} else {
    for (Order order : orders) {
        process(order);
    }
}
```

### 17.2 API contract harus dibaca

Beberapa method terlihat sederhana tetapi bisa mahal:

- `contains` pada `List`: linear.
- `remove(Object)` pada `ArrayList`: search + shift.
- `remove(0)` pada `ArrayList`: shift semua elemen setelahnya.
- `size()` biasanya murah, tapi jangan selalu diasumsikan untuk semua custom collection.
- `toArray()` allocate array baru.
- `stream().sorted()` materialisasi/sort data.
- `distinct()` membutuhkan state untuk dedup.
- `groupingBy()` membuat map dan collection internal.

Prinsip:

```text
Interface tells what operation means.
Implementation determines what operation costs.
```

---

## 18. Nested Loop dan Accidental `O(n²)`

Salah satu performance bug paling umum: nested loop dengan lookup linear.

Buruk:

```java
List<User> users = getUsers();
List<Order> orders = getOrders();

for (User user : users) {
    for (Order order : orders) {
        if (order.userId().equals(user.id())) {
            attach(user, order);
        }
    }
}
```

Complexity:

```text
O(users * orders)
```

Jika 10.000 users dan 100.000 orders, itu 1 miliar comparison.

Lebih baik:

```java
Map<UserId, List<Order>> ordersByUserId = new HashMap<>();

for (Order order : orders) {
    ordersByUserId
        .computeIfAbsent(order.userId(), ignored -> new ArrayList<>())
        .add(order);
}

for (User user : users) {
    List<Order> userOrders = ordersByUserId.getOrDefault(user.id(), List.of());
    attach(user, userOrders);
}
```

Complexity:

```text
O(users + orders)
```

Tapi ada trade-off:

- memory tambahan `O(orders)`,
- hash quality penting,
- grouping allocation,
- harus menjaga key equality benar.

Top-tier thinking:

```text
We traded memory for time by building an index.
```

---

## 19. Indexing sebagai Transformasi Complexity

Banyak optimisasi DSA adalah membangun index.

Tanpa index:

```text
Find order by id: scan list -> O(n)
```

Dengan index:

```text
Map<OrderId, Order> -> expected O(1)
```

Tapi index bukan gratis.

Biaya index:

1. Memory tambahan.
2. Build time.
3. Update cost.
4. Consistency risk.
5. Stale data risk.
6. More complex mutation protocol.

### 19.1 Example: case management index

```java
final class CaseIndex {
    private final Map<CaseId, CaseRecord> byId = new HashMap<>();
    private final EnumMap<CaseState, Set<CaseId>> byState = new EnumMap<>(CaseState.class);

    void add(CaseRecord record) {
        byId.put(record.id(), record);
        byState.computeIfAbsent(record.state(), ignored -> new HashSet<>()).add(record.id());
    }

    void transition(CaseId id, CaseState newState) {
        CaseRecord old = byId.get(id);
        if (old == null) {
            throw new IllegalArgumentException("Unknown case: " + id);
        }

        Set<CaseId> oldBucket = byState.get(old.state());
        if (oldBucket != null) {
            oldBucket.remove(id);
        }

        CaseRecord updated = old.withState(newState);
        byId.put(id, updated);
        byState.computeIfAbsent(newState, ignored -> new HashSet<>()).add(id);
    }
}
```

Invariant:

```text
For every case in byId, byState[case.state] must contain case.id.
```

Complexity:

```text
add: expected O(1)
find by id: expected O(1)
find by state: expected O(k), where k is cases in that state
transition: expected O(1), but updates multiple indexes
```

Failure mode:

- update `byId` berhasil tapi `byState` gagal,
- mutable record state berubah tanpa reindex,
- duplicate ID,
- stale state bucket.

DSA engineering berarti menjaga invariant, bukan hanya memilih map.

---

## 20. Precomputation vs Lazy Computation

Kadang kita menghitung sesuatu setiap kali dibutuhkan. Kadang kita precompute.

### 20.1 Lazy computation

```java
boolean isOverdue(CaseRecord record, Instant now) {
    return record.dueDate().isBefore(now);
}
```

Murah jika dipanggil sedikit.

### 20.2 Precomputed index

```java
NavigableMap<Instant, Set<CaseId>> byDueDate;
```

Membuat query overdue murah:

```java
byDueDate.headMap(now, true)
```

Trade-off:

| Approach | Read Cost | Write Cost | Memory | Risk |
|---|---:|---:|---:|---|
| Lazy scan | tinggi | rendah | rendah | simple tapi lambat untuk query besar |
| Precomputed index | rendah | lebih tinggi | lebih tinggi | stale index jika mutation salah |

Prinsip:

```text
Precompute when reads are frequent, data is stable enough, and index consistency is manageable.
```

---

## 21. Space-Time Trade-off

DSA sering berupa pertukaran:

```text
More memory -> faster lookup
Less memory -> slower lookup
More preprocessing -> faster query
Less preprocessing -> cheaper write
More indexes -> flexible query
Fewer indexes -> simpler consistency
```

Contoh:

```java
Map<UserId, User> byId;
Map<Email, UserId> idByEmail;
Map<TenantId, Set<UserId>> idsByTenant;
```

Makin banyak index, makin cepat query tertentu. Tapi mutation makin mahal dan rawan.

Pertanyaan desain:

```text
- Apakah semua index benar-benar dipakai?
- Apakah index bisa dibangun ulang?
- Apakah index harus strongly consistent?
- Apakah index boleh eventually consistent?
- Apakah index transient atau persistent?
- Apakah index hidup di memory atau database?
```

---

## 22. Complexity dan Mutability

Mutability bisa mengubah complexity dan correctness.

### 22.1 Mutable value biasanya aman

```java
Map<UserId, UserProfile> profiles;
```

Jika value berubah, map masih bisa menemukan entry karena key tetap.

### 22.2 Mutable key berbahaya

```java
Map<UserProfile, Permission> permissions;
```

Jika `UserProfile.equals/hashCode` bergantung pada field mutable, map bisa rusak secara logis.

### 22.3 Mutable sorted field berbahaya

```java
TreeSet<Task> tasks = new TreeSet<>(Comparator.comparing(Task::deadline));
```

Jika `deadline` task berubah setelah masuk set, posisi dalam tree tidak otomatis berubah.

Solusi:

```java
// remove old, mutate/copy, reinsert
set.remove(task);
task.setDeadline(newDeadline);
set.add(task);
```

Lebih aman:

```java
Task updated = task.withDeadline(newDeadline);
```

Lalu reindex dengan explicit protocol.

---

## 23. Recursion Complexity dan Stack Cost

Recursive algorithm sering tampak elegan.

Contoh DFS:

```java
void dfs(Node node, Set<Node> visited) {
    if (!visited.add(node)) {
        return;
    }
    for (Node next : node.children()) {
        dfs(next, visited);
    }
}
```

Time complexity:

```text
O(V + E)
```

Space complexity:

```text
O(V) for visited
O(depth) for call stack
```

Di Java, call stack bukan infinite. Untuk graph/tree dengan depth besar, recursion bisa menyebabkan `StackOverflowError`.

Iterative alternative:

```java
void dfsIterative(Node start) {
    Set<Node> visited = new HashSet<>();
    Deque<Node> stack = new ArrayDeque<>();
    stack.push(start);

    while (!stack.isEmpty()) {
        Node node = stack.pop();
        if (!visited.add(node)) {
            continue;
        }
        for (Node next : node.children()) {
            stack.push(next);
        }
    }
}
```

Trade-off:

- explicit stack lebih verbose,
- tapi lebih aman untuk input depth besar,
- memory lebih bisa dikontrol,
- lebih mudah diberi limit.

---

## 24. Complexity di Graph: Jangan Salah Definisi `n`

Graph algorithm biasanya memakai:

```text
V = number of vertices
E = number of edges
```

BFS/DFS:

```text
O(V + E)
```

Tapi representasi mempengaruhi cost.

### 24.1 Adjacency list

```java
Map<Node, List<Node>> graph;
```

Traversal:

```text
O(V + E)
```

Memory:

```text
O(V + E)
```

### 24.2 Adjacency matrix

```java
boolean[][] connected;
```

Check edge:

```text
O(1)
```

Iterate neighbors:

```text
O(V)
```

Memory:

```text
O(V²)
```

Untuk graph sparse, adjacency list lebih efisien. Untuk graph dense kecil, matrix bisa masuk akal.

Prinsip:

```text
Complexity must include representation.
```

---

## 25. Complexity dan Data Distribution

Input distribution sering lebih penting dari ukuran rata-rata.

Contoh:

```text
Most users have 5 orders.
One enterprise tenant has 5 million orders.
```

Jika sistem diuji dengan tenant kecil, algoritma `O(n)` terlihat aman. Saat tenant besar masuk, sistem runtuh.

Pertanyaan penting:

```text
- Apakah data skewed?
- Apakah ada super-tenant?
- Apakah ada hot key?
- Apakah ada state yang menumpuk terlalu banyak item?
- Apakah ada deadline sama untuk jutaan item?
- Apakah hash key tersebar merata?
```

Contoh problem:

```java
Map<CaseState, List<CaseRecord>> byState;
```

Jika 90% case berada di state `PENDING_REVIEW`, query state itu tetap besar.

Solusi mungkin butuh index tambahan:

```text
state + dueDate
state + officer
state + severity
```

Tapi makin banyak index, makin banyak invariant.

---

## 26. Complexity dan Boundedness

Pertanyaan penting:

```text
Apakah ukuran data bounded?
```

Jika bounded kecil:

```java
EnumSet<Permission> permissions;
```

Maka banyak operasi efektif sangat murah.

Jika unbounded:

```java
Queue<Event> events = new ArrayDeque<>();
```

Tanpa limit, queue bisa menjadi memory leak.

### 26.1 Unbounded collection adalah risk boundary

```java
private final List<Event> events = new ArrayList<>();
```

Pertanyaan:

- kapan dibersihkan?
- apa maksimal ukurannya?
- apakah ada TTL?
- apakah ada backpressure?
- apakah event duplicate?
- apakah growth bisa dikendalikan?

Banyak incident bukan karena Big-O salah, tetapi karena collection tidak bounded.

---

## 27. Complexity dan Concurrency

Pembahasan concurrency detail ada di seri sebelumnya, jadi di sini hanya dari sisi DSA.

Struktur data single-threaded bisa murah. Begitu concurrent, cost berubah:

- lock contention,
- memory visibility,
- CAS retry,
- false sharing,
- snapshot copy,
- blocking behavior.

Contoh:

```java
Map<String, User> map = Collections.synchronizedMap(new HashMap<>());
```

Operasi individual synchronized, tetapi compound operation belum tentu aman:

```java
if (!map.containsKey(id)) {
    map.put(id, user);
}
```

Untuk concurrent map:

```java
users.computeIfAbsent(id, this::loadUser);
```

Tapi `computeIfAbsent` juga punya contract dan caveat. Function harus tidak sembarangan melakukan side effect berat atau reentrant mutation berbahaya.

Prinsip:

```text
Concurrent data structure changes the cost model and the correctness model.
```

---

## 28. Complexity dan I/O Boundary

Kadang engineer sibuk mengoptimalkan `O(n)` di memory, padahal bottleneck sebenarnya database atau network.

Contoh:

```java
for (CaseId id : caseIds) {
    CaseRecord record = repository.findById(id);
    process(record);
}
```

Secara kode terlihat `O(n)`, tetapi cost sebenarnya:

```text
O(n database calls)
```

Ini jauh lebih buruk daripada scan memory biasa.

Solusi:

```java
List<CaseRecord> records = repository.findAllById(caseIds);
for (CaseRecord record : records) {
    process(record);
}
```

DSA thinking di sistem nyata harus memasukkan boundary:

```text
CPU operation << memory access << disk/network/database call
```

Jangan mengoptimalkan collection sambil membiarkan N+1 query.

---

## 29. Benchmarking: Jangan Menebak, Tapi Juga Jangan Mudah Percaya Benchmark

Java runtime punya JIT, tiered compilation, profiling, GC, escape analysis. Microbenchmark manual sering salah.

Buruk:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    doSomething();
}
long end = System.nanoTime();
System.out.println(end - start);
```

Masalah:

- warmup tidak cukup,
- dead code elimination,
- constant folding,
- unrealistic branch profile,
- GC interference,
- input tidak representatif,
- benchmark mengukur hal yang salah.

JMH adalah harness yang didesain untuk benchmark JVM. Tapi bahkan dengan JMH, hasil tetap harus dibaca dalam konteks workload nyata.

### 29.1 Prinsip benchmark DSA

1. Gunakan data distribution yang mirip production.
2. Ukur ukuran kecil, sedang, besar.
3. Pisahkan build cost dan query cost.
4. Ukur allocation rate.
5. Ukur p95/p99 jika relevan.
6. Jangan benchmark hanya happy path.
7. Cek correctness sebelum performance.
8. Bandingkan alternatif yang sama-sama valid secara domain.
9. Dokumentasikan environment.
10. Jangan generalisasi di luar konteks.

### 29.2 Contoh JMH skeleton

```java
import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.annotations.Fork;
import org.openjdk.jmh.annotations.Measurement;
import org.openjdk.jmh.annotations.Scope;
import org.openjdk.jmh.annotations.Setup;
import org.openjdk.jmh.annotations.State;
import org.openjdk.jmh.annotations.Warmup;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@State(Scope.Thread)
@Warmup(iterations = 5)
@Measurement(iterations = 5)
@Fork(2)
public class ContainsBenchmark {
    private List<String> list;
    private Set<String> set;
    private String target;

    @Setup
    public void setup() {
        list = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            list.add("id-" + i);
        }
        set = new HashSet<>(list);
        target = "id-999";
    }

    @Benchmark
    public boolean listContains() {
        return list.contains(target);
    }

    @Benchmark
    public boolean setContains() {
        return set.contains(target);
    }
}
```

Tapi benchmark ini hanya menjawab pertanyaan sempit:

```text
Untuk 1000 String tertentu, lookup target tertentu, dalam environment tertentu, mana lebih cepat?
```

Ia tidak otomatis menjawab semua workload.

---

## 30. Practical Complexity Checklist

Sebelum memilih struktur data atau algoritma, gunakan checklist ini.

### 30.1 Input dan data shape

```text
- Berapa ukuran minimum, rata-rata, maksimum?
- Apakah data bounded?
- Apakah distribusi skewed?
- Apakah ada hot key?
- Apakah input trusted?
- Apakah graph/tree bisa cyclic?
```

### 30.2 Operation mix

```text
- Operasi apa yang paling sering?
- Operasi apa yang paling latency-sensitive?
- Apakah read-heavy atau write-heavy?
- Apakah delete sering?
- Apakah range query dibutuhkan?
- Apakah sorted iteration dibutuhkan?
- Apakah duplicate allowed?
```

### 30.3 Correctness invariants

```text
- Apa invariant utama struktur ini?
- Apakah key immutable?
- Apakah comparator consistent?
- Apakah index harus sync dengan source of truth?
- Bagaimana remove/update dilakukan?
- Apa yang terjadi jika partial update gagal?
```

### 30.4 Runtime cost

```text
- Apakah ada boxing?
- Apakah ada object allocation per item?
- Apakah ada resize/rehash?
- Apakah memory locality buruk?
- Apakah equals/hashCode mahal?
- Apakah comparator mahal?
- Apakah recursion depth aman?
```

### 30.5 Operational risk

```text
- Apakah collection bisa tumbuh tanpa batas?
- Apakah ada eviction?
- Apakah ada backpressure?
- Apakah ada p99 spike?
- Apakah struktur shared across threads?
- Apakah benchmark representatif?
```

---

## 31. Decision Framework: Dari Requirement ke Struktur Data

Gunakan alur berikut.

### Step 1 — Definisikan operasi

Buruk:

```text
Saya butuh menyimpan case.
```

Baik:

```text
Saya butuh:
- find case by id
- list case by officer
- find overdue case
- process highest priority case
- transition state
- audit mutation
```

### Step 2 — Definisikan frequency dan criticality

```text
find by id: very frequent, request path
list by officer: frequent, UI query
find overdue: scheduled job every minute
process highest priority: worker loop
transition state: moderate, must be strongly consistent
```

### Step 3 — Pilih candidate structure

```text
byId: HashMap
byOfficer: HashMap<OfficerId, Set<CaseId>>
byDueDate: TreeMap<Instant, Set<CaseId>>
byPriority: PriorityQueue<CaseId>
state: EnumMap<CaseState, Set<CaseId>>
```

### Step 4 — Tulis invariant

```text
Every case in byId must appear exactly once in byState according to its current state.
Every open case with dueDate must appear in byDueDate.
Closed cases must not appear in byPriority.
```

### Step 5 — Tulis mutation protocol

```text
addCase:
  validate unique id
  insert into byId
  insert into byState
  insert into byDueDate if applicable
  insert into byPriority if applicable

transitionCase:
  load old
  validate transition
  remove from old indexes
  create updated record
  insert into new indexes
```

### Step 6 — Tulis complexity table

| Operation | Structure | Expected Cost | Notes |
|---|---|---:|---|
| find by id | `HashMap` | `O(1)` avg | depends on key hash |
| list by state | `EnumMap + Set` | `O(k)` | k = cases in state |
| find overdue | `TreeMap.headMap` | `O(log n + k)` | k = overdue buckets/items |
| process next priority | `PriorityQueue` | `O(log n)` | priority mutation needs care |
| transition | multiple indexes | `O(log n)` or avg `O(1)` parts | must preserve invariants |

### Step 7 — Define failure model

```text
- Duplicate case id
- Missing index entry
- Stale priority queue entry
- Mutable key corruption
- Due date changed without reindex
- Large overdue bucket
- Unbounded growth
```

Ini cara DSA menjadi engineering design, bukan sekadar coding challenge.

---

## 32. Case Study: `contains` dalam Validation Rule Engine

### 32.1 Problem

Kita punya validation rule:

```text
Jika application status termasuk salah satu dari allowed statuses, rule boleh dieksekusi.
```

### 32.2 Option A: List

```java
private static final List<ApplicationStatus> ALLOWED = List.of(
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.PENDING_CLARIFICATION
);

boolean allowed(ApplicationStatus status) {
    return ALLOWED.contains(status);
}
```

Complexity:

```text
O(k), k = jumlah allowed status
```

Karena k kecil dan bounded, ini baik.

### 32.3 Option B: EnumSet

```java
private static final EnumSet<ApplicationStatus> ALLOWED = EnumSet.of(
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.PENDING_CLARIFICATION
);

boolean allowed(ApplicationStatus status) {
    return ALLOWED.contains(status);
}
```

Keuntungan:

- compact,
- cepat,
- semantically tepat untuk enum,
- scalable jika enum bertambah.

Trade-off:

- mutable `EnumSet` jika diekspos.

Lebih aman:

```java
private static final Set<ApplicationStatus> ALLOWED =
    Set.copyOf(EnumSet.of(
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.UNDER_REVIEW,
        ApplicationStatus.PENDING_CLARIFICATION
    ));
```

Atau jaga encapsulation.

### 32.4 Top-tier conclusion

Untuk enum membership, `EnumSet` biasanya struktur yang paling semantically cocok. Tapi untuk 3 status, list juga mungkin cukup. Keputusan tergantung:

- apakah status count bounded?
- apakah dipanggil di hot path?
- apakah readability penting?
- apakah set diekspos keluar?

---

## 33. Case Study: N+1 Lookup di Memory

### 33.1 Problem

```java
List<Application> applications = getApplications();
List<Officer> officers = getOfficers();

for (Application app : applications) {
    Officer officer = officers.stream()
        .filter(o -> o.id().equals(app.officerId()))
        .findFirst()
        .orElse(null);
    app.assignOfficer(officer);
}
```

Jika ada `A` applications dan `O` officers:

```text
O(A * O)
```

### 33.2 Build index

```java
Map<OfficerId, Officer> officersById = officers.stream()
    .collect(Collectors.toMap(Officer::id, Function.identity()));

for (Application app : applications) {
    Officer officer = officersById.get(app.officerId());
    app.assignOfficer(officer);
}
```

Complexity:

```text
Build index: O(O)
Attach: O(A)
Total: O(A + O)
```

### 33.3 Hidden issue: duplicate key

`Collectors.toMap` akan gagal jika duplicate key dan merge function tidak diberikan.

Itu bisa baik, karena duplicate officer id mungkin data corruption.

Lebih explicit:

```java
Map<OfficerId, Officer> officersById = new HashMap<>();
for (Officer officer : officers) {
    Officer previous = officersById.putIfAbsent(officer.id(), officer);
    if (previous != null) {
        throw new IllegalStateException("Duplicate officer id: " + officer.id());
    }
}
```

Top-tier thinking:

```text
Optimization also surfaced an invariant: officer id must be unique.
```

---

## 34. Case Study: Deadline Query

### 34.1 Problem

Find all open cases due before now.

Naive:

```java
List<CaseRecord> overdue = cases.stream()
    .filter(c -> c.status().isOpen())
    .filter(c -> c.dueDate().isBefore(now))
    .toList();
```

Complexity:

```text
O(n)
```

For scheduled job every minute over small data, fine.

For large in-memory registry queried frequently, maybe expensive.

### 34.2 Sorted index

```java
NavigableMap<Instant, Set<CaseId>> openCasesByDueDate = new TreeMap<>();
```

Query:

```java
NavigableMap<Instant, Set<CaseId>> dueBuckets =
    openCasesByDueDate.headMap(now, true);
```

Cost:

```text
O(log n + k)
```

Where `k` is number of returned buckets/items.

### 34.3 Hidden complexity

Mutation now more complex:

- case opened -> add to due index,
- case closed -> remove from due index,
- due date changed -> remove old due date, insert new due date,
- state changed open/closed -> update index.

Conclusion:

```text
Use index when query cost matters enough to justify mutation complexity.
```

---

## 35. Common Misreadings of Complexity

### 35.1 “HashMap is O(1), so it is always fastest”

Wrong.

Better:

```text
HashMap gives expected constant-time exact-key lookup under healthy hash/equality conditions, with memory overhead and no sorted order.
```

### 35.2 “TreeMap is O(log n), so avoid it”

Wrong.

Better:

```text
TreeMap is useful when ordered navigation or range query is part of the required operation mix.
```

### 35.3 “LinkedList insert is O(1), so it is good for many inserts”

Incomplete.

Better:

```text
Insertion is O(1) only when the insertion position/node is already known. Finding that position may be O(n), and node memory locality is poor.
```

### 35.4 “Streams are slow”

Too broad.

Better:

```text
Streams can be expressive and sufficiently fast for many cases. In hot paths or allocation-sensitive loops, measure and inspect allocation/dispatch cost.
```

### 35.5 “Big-O does not matter because hardware is fast”

Wrong.

Better:

```text
Big-O may not dominate for small n, but it dominates when n grows, when operation is repeated, or when data distribution has large outliers.
```

---

## 36. Production Review Checklist

Saat code review, cari tanda-tanda berikut.

### 36.1 Potential accidental quadratic

```java
for (A a : listA) {
    if (listB.contains(a.key())) {
        ...
    }
}
```

Pertanyaan:

```text
How large can listB be?
Should listB be a Set?
```

### 36.2 Repeated sorting

```java
for (Request request : requests) {
    rules.sort(comparator);
    apply(rules, request);
}
```

Pertanyaan:

```text
Can rules be sorted once?
Are rules immutable during loop?
```

### 36.3 Repeated parsing/normalization

```java
for (Rule rule : rules) {
    if (normalize(input).equals(rule.normalizedValue())) {
        ...
    }
}
```

Pertanyaan:

```text
Can normalize(input) be computed once?
```

### 36.4 Unbounded accumulation

```java
events.add(event);
```

Pertanyaan:

```text
Who removes it?
What is the maximum size?
Is there TTL or eviction?
```

### 36.5 Expensive comparator

```java
items.sort((a, b) -> expensive(a).compareTo(expensive(b)));
```

Pertanyaan:

```text
Should we precompute sort keys?
```

### 36.6 Mutable indexed field

```java
caseRecord.setDueDate(newDueDate);
```

Pertanyaan:

```text
Is this case present in a dueDate index?
Was it reindexed?
```

---

## 37. Mini Exercise

### Exercise 1

Given:

```java
boolean hasAnyRole(User user, List<Role> requiredRoles) {
    for (Role role : user.roles()) {
        if (requiredRoles.contains(role)) {
            return true;
        }
    }
    return false;
}
```

Questions:

1. What is the complexity?
2. When is this acceptable?
3. When should `requiredRoles` become a `Set`?
4. If `Role` is enum, what structure may be better?

Expected reasoning:

```text
Complexity: O(U * R), where U = user role count, R = required role count.
Acceptable if both are tiny and bounded.
Use Set if R can grow or method is hot.
Use EnumSet if Role is enum.
```

### Exercise 2

Given:

```java
Map<RequestKey, Response> cache = new HashMap<>();
```

`RequestKey` contains mutable `Map<String, String> headers`.

Questions:

1. What can go wrong?
2. What complexity assumption breaks?
3. What design alternatives exist?

Expected reasoning:

```text
If headers participate in equals/hashCode and mutate after insertion, lookup can fail.
Expected O(1) lookup is irrelevant if key correctness is broken.
Use immutable canonical key, copy headers defensively, normalize to stable fields, or use explicit cache key string/record.
```

### Exercise 3

Given:

```java
List<CaseRecord> cases;
```

Need:

```text
- frequent lookup by id
- frequent query by state
- occasional full export sorted by created date
```

Design candidate:

```text
HashMap<CaseId, CaseRecord> byId
EnumMap<CaseState, Set<CaseId>> byState
Sort on export, or maintain TreeMap if export/query sorted is frequent
```

Explain trade-off:

```text
Maintaining TreeMap all the time improves sorted query but increases write complexity and memory. If export is occasional, sorting snapshot may be simpler and safer.
```

---

## 38. Mental Model Summary

Complexity analysis di Java harus dilihat sebagai multi-layer model.

```text
Layer 1: Asymptotic growth
Layer 2: Operation mix
Layer 3: Data distribution
Layer 4: Java implementation detail
Layer 5: Memory and allocation
Layer 6: Runtime/JIT/GC behavior
Layer 7: Tail latency and operational risk
Layer 8: Domain invariants and consistency
```

Seorang engineer biasa berkata:

```text
Use HashMap because O(1).
```

Engineer yang lebih matang berkata:

```text
Use HashMap for exact-key lookup because reads dominate, key is immutable, hash is cheap and stable, ordering is not required, expected size is known so we can pre-size, and index consistency is simple.
```

Engineer top-tier menambahkan:

```text
But if range query by deadline becomes frequent, we need a secondary ordered index; this changes mutation complexity, so we must define reindexing invariants and test them.
```

---

## 39. Practical Rules of Thumb

1. `O(1)` is not automatically fast.
2. `O(n)` is not automatically bad for tiny bounded `n`.
3. `O(log n)` is often excellent when it buys ordering/range query.
4. Amortized `O(1)` can still produce latency spikes.
5. Object allocation is part of algorithm cost in Java.
6. Boxing can dominate memory and cache behavior.
7. HashMap performance depends on key design.
8. Comparator cost matters in sorting and tree structures.
9. Indexes trade write complexity and memory for read speed.
10. Every secondary index creates consistency obligations.
11. Tail latency matters more than average in request paths.
12. Measure important decisions with representative workloads.
13. Do not optimize away clarity without evidence.
14. Do not hide bad algorithms behind more hardware.
15. Always define maximum size or lifecycle for long-lived collections.

---

## 40. References

1. Oracle Java SE 25 Documentation — Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

2. Oracle Java SE 25 Documentation — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

3. OpenJDK Code Tools — Java Object Layout / JOL  
   https://openjdk.org/projects/code-tools/jol/

4. OpenJDK Code Tools — Java Microbenchmark Harness / JMH  
   https://openjdk.org/projects/code-tools/jmh/

5. OpenJDK JOL GitHub Repository  
   https://github.com/openjdk/jol

6. OpenJDK JMH GitHub Repository  
   https://github.com/openjdk/jmh

---

## 41. Closing

Bagian ini membentuk fondasi untuk semua part berikutnya.

Mulai Part 002, kita akan masuk ke fondasi Java yang lebih konkret:

```text
Java Object, Array, Reference, Equality, Hashing
```

Di sana kita akan membedah kenapa `equals`, `hashCode`, object identity, array layout, mutability, dan reference semantics adalah dasar dari hampir semua struktur data Java.

---

# Status Seri

```text
Seri: Java Data Structure and Algorithm Advanced
Progress: Part 001 dari 030 selesai
Status: Belum selesai
Berikutnya: Part 002 — Java Object, Array, Reference, Equality, Hashing
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dsa-part-000.md">⬅️ Part 000 — Orientation: Cara Berpikir Data Structure & Algorithm untuk Engineer Top-Tier</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dsa-part-002.md">Part 002 — Java Object, Array, Reference, Equality, Hashing ➡️</a>
</div>
