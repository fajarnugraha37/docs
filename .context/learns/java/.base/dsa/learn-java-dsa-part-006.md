# Learn Java DSA — Part 006: Hash Table Fundamentals

> Seri: `learn-java-dsa`  
> Part: `006`  
> Topik: Hash Table Fundamentals  
> Target: memahami hash table dari prinsip, invariant, cost model, dan failure mode sebelum memakai `HashMap`, `HashSet`, atau cache berbasis map di sistem nyata.

---

## 0. Posisi Bagian Ini dalam Seri

Pada part sebelumnya kita sudah membahas struktur linear:

- array dan dynamic array,
- linked structure,
- stack, queue, deque, dan ring buffer.

Sekarang kita masuk ke salah satu struktur data paling penting di software engineering: **hash table**.

Hash table terlihat sederhana karena API-nya biasanya hanya seperti ini:

```java
map.put(key, value);
value = map.get(key);
map.containsKey(key);
map.remove(key);
```

Namun secara engineering, hash table adalah sumber banyak bug dan performance issue:

- lookup yang tiba-tiba lambat,
- memory usage membengkak,
- duplicate logical key,
- cache tidak pernah hit,
- data tidak bisa ditemukan padahal “kelihatannya ada”,
- map resize menyebabkan latency spike,
- key mutable membuat entry menjadi “hilang”,
- equality/hash contract rusak,
- serangan hash flooding,
- penggunaan `Map` untuk problem yang seharusnya butuh ordering/range query.

Bagian ini tidak langsung fokus ke `HashMap` detail API. Itu akan dibahas di Part 007. Bagian ini fokus pada fondasi mental model: **apa sebenarnya hash table, invariant apa yang harus dijaga, dan bagaimana membaca trade-off-nya**.

Referensi resmi yang relevan:

- Java Collections Framework mendefinisikan collection framework sebagai arsitektur terpadu untuk merepresentasikan dan memanipulasi collection secara independen dari detail implementasi. Ini penting karena `Map`, `Set`, dan implementasi hash-based adalah bagian dari kontrak besar tersebut.  
  <https://docs.oracle.com/javase/8/docs/technotes/guides/collections/overview.html>
- Dokumentasi `HashMap` menjelaskan bahwa performa dipengaruhi oleh **initial capacity** dan **load factor**; capacity adalah jumlah bucket, dan load factor menentukan seberapa penuh tabel sebelum capacity otomatis ditingkatkan.  
  <https://docs.oracle.com/javase/8/docs/api/java/util/HashMap.html>
- Kontrak `Object.equals` dan `Object.hashCode` adalah fondasi correctness untuk hash-based collection.  
  <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html>
- Source OpenJDK `HashMap` menunjukkan detail implementasi seperti default capacity, power-of-two capacity, threshold, resize, dan tree bin. Detail implementasi dapat berubah, tetapi berguna sebagai referensi engineering.  
  <https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/HashMap.java>

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan hash table tanpa bergantung pada hafalan `HashMap`.
2. Membedakan key identity, key equality, hash code, bucket index, dan collision.
3. Menjelaskan kenapa operasi hash table sering disebut rata-rata `O(1)`, tetapi bisa menjadi `O(n)` atau menghasilkan latency spike.
4. Mendesain key yang benar untuk hash-based structure.
5. Mengenali bug mutable key.
6. Menghitung kebutuhan initial capacity secara rasional.
7. Memahami trade-off load factor.
8. Menjelaskan collision resolution:
   - separate chaining,
   - open addressing.
9. Memahami kenapa hash table bukan struktur yang tepat untuk ordering/range query.
10. Mendiagnosis failure mode umum di production.

---

## 2. Mental Model Utama

Hash table adalah struktur data untuk menjawab pertanyaan:

> “Dari sebuah key, di mana value yang terkait dengannya disimpan?”

Alih-alih mencari satu per satu seperti list:

```text
[key1, key2, key3, key4, key5, ...]
```

hash table menggunakan fungsi hash untuk mengarahkan key ke lokasi tertentu:

```text
key -> hashCode -> bucket index -> bucket -> entry -> value
```

Secara konseptual:

```text
             hash(key)
                │
                ▼
        bucket index calculation
                │
                ▼
+---------+-------------+
| bucket0 | entries ... |
+---------+-------------+
| bucket1 | entries ... |
+---------+-------------+
| bucket2 | entries ... |
+---------+-------------+
| bucket3 | entries ... |
+---------+-------------+
```

Hash table bukan magic `O(1)`. Ia cepat karena mencoba mengubah pencarian linear menjadi pencarian langsung ke bucket kecil.

Kuncinya:

> Hash table bagus jika key tersebar merata ke banyak bucket dan setiap bucket berisi sedikit entry.

---

## 3. Struktur Konseptual Hash Table

Secara umum, hash table berisi:

1. **Array bucket**  
   Array yang menyimpan slot/bucket.

2. **Hash function**  
   Fungsi yang mengubah key menjadi integer/hash value.

3. **Index mapping**  
   Cara mengubah hash value menjadi index bucket.

4. **Collision resolution**  
   Cara menangani lebih dari satu key yang jatuh ke bucket yang sama.

5. **Load factor / resize policy**  
   Aturan kapan tabel perlu diperbesar.

6. **Equality check**  
   Cara memastikan entry yang ditemukan benar-benar key yang sama secara logical.

Contoh kasar:

```java
final class SimpleEntry<K, V> {
    final K key;
    V value;
    SimpleEntry<K, V> next;

    SimpleEntry(K key, V value, SimpleEntry<K, V> next) {
        this.key = key;
        this.value = value;
        this.next = next;
    }
}
```

Dalam separate chaining, bucket array dapat menyimpan head dari linked chain:

```java
SimpleEntry<K, V>[] table;
```

Lookup:

```text
get(key):
  h = hash(key)
  i = bucketIndex(h)
  e = table[i]
  while e != null:
      if equals(e.key, key): return e.value
      e = e.next
  return null
```

Dengan kata lain, `hashCode` membawa kita ke bucket, tetapi `equals` tetap menentukan apakah key benar-benar cocok.

---

## 4. Key, Hash, Bucket, Entry: Jangan Dicampur

Banyak bug muncul karena engineer mencampur konsep berikut.

| Konsep | Arti |
|---|---|
| Key | Objek/logical identifier yang dipakai untuk lookup |
| Hash code | Integer hasil `key.hashCode()` |
| Bucket index | Index array hasil mapping dari hash code |
| Entry | Pair key-value yang benar-benar disimpan |
| Collision | Dua key berbeda jatuh ke bucket yang sama |
| Equality | Pemeriksaan apakah key yang dicari sama dengan key di entry |

Contoh:

```java
record UserId(String value) {}

Map<UserId, String> names = new HashMap<>();
names.put(new UserId("U-001"), "Alice");

String name = names.get(new UserId("U-001"));
```

Agar `get` berhasil:

1. `new UserId("U-001")` yang pertama dan kedua harus dianggap equal.
2. Jika equal, hash code-nya harus sama.
3. Hash code tersebut harus mengarah ke bucket yang sama.
4. Dalam bucket itu, `equals` menemukan entry yang cocok.

Karena `record` otomatis menghasilkan `equals` dan `hashCode` berbasis component, contoh di atas aman.

---

## 5. Invariant Hash Table

Hash table memiliki invariant konseptual:

> Setiap entry harus berada pada bucket yang konsisten dengan hash key-nya pada saat entry tersebut dimasukkan.

Jika key berubah sehingga hash-nya berubah setelah dimasukkan, invariant rusak.

Contoh buruk:

```java
final class MutableCaseKey {
    String caseNo;

    MutableCaseKey(String caseNo) {
        this.caseNo = caseNo;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof MutableCaseKey other)) return false;
        return Objects.equals(this.caseNo, other.caseNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(caseNo);
    }
}
```

Pemakaian:

```java
Map<MutableCaseKey, String> map = new HashMap<>();

MutableCaseKey key = new MutableCaseKey("CASE-001");
map.put(key, "OPEN");

key.caseNo = "CASE-999";

System.out.println(map.get(key));                    // kemungkinan null
System.out.println(map.get(new MutableCaseKey("CASE-001"))); // kemungkinan null/tergantung struktur bucket lama
```

Masalahnya bukan `HashMap` “rusak”. Masalahnya key melanggar invariant.

Dalam sistem production, ini bisa terlihat seperti:

- cache miss misterius,
- duplicate entry logical,
- map size naik terus,
- object ada saat di-iterate tetapi tidak bisa ditemukan lewat `get`,
- deduplication gagal.

Rule penting:

> Key untuk hash table harus immutable, atau minimal field yang dipakai oleh `equals/hashCode` tidak boleh berubah selama object berada di hash-based collection.

---

## 6. Hash Function: Apa yang Kita Butuhkan?

Hash function yang baik untuk hash table bukan harus cryptographically secure.

Yang dibutuhkan:

1. **Deterministic**  
   Key yang sama menghasilkan hash yang sama selama state equality-nya sama.

2. **Consistent with equality**  
   Jika `a.equals(b) == true`, maka `a.hashCode() == b.hashCode()` harus true.

3. **Distribution reasonably good**  
   Key yang berbeda sebaiknya tersebar merata.

4. **Murah dihitung**  
   Hash yang terlalu mahal bisa mengalahkan benefit lookup `O(1)`.

5. **Stable saat disimpan**  
   Nilai yang memengaruhi hash tidak berubah selama menjadi key.

Kontrak `hashCode` tidak mengatakan bahwa dua object berbeda harus punya hash code berbeda. Collision boleh terjadi. Yang wajib adalah:

```text
if a.equals(b), then a.hashCode() == b.hashCode()
```

Sebaliknya:

```text
if a.hashCode() == b.hashCode(), not necessarily a.equals(b)
```

---

## 7. Collision: Kenapa Hash Code Sama Bukan Berarti Salah

Collision terjadi ketika dua key berbeda jatuh ke bucket yang sama.

Ada dua level collision:

### 7.1 Hash Code Collision

Dua key menghasilkan hash code sama.

```text
hash(a) == hash(b)
a != b
```

### 7.2 Bucket Collision

Dua hash berbeda tetapi setelah dimapping ke bucket index, jatuh ke bucket sama.

```text
bucketIndex(hash(a)) == bucketIndex(hash(b))
```

Ini normal karena jumlah kemungkinan key biasanya jauh lebih besar daripada jumlah bucket.

Contoh:

```text
10,000 key
16 bucket
```

Tidak mungkin semua key punya bucket unik. Maka collision resolution adalah bagian fundamental hash table, bukan edge case.

---

## 8. Bucket Index Calculation

Secara naif:

```java
int index = Math.abs(hashCode) % table.length;
```

Namun implementasi real sering lebih hati-hati.

Masalah dengan `Math.abs`:

```java
Math.abs(Integer.MIN_VALUE) == Integer.MIN_VALUE
```

Karena `Integer.MIN_VALUE` tidak punya representasi positif dalam `int`.

Masalah dengan `%`:

- modulo bisa lebih mahal daripada bitmask,
- distribusi bergantung pada table length,
- jika table length power of two, index bisa dihitung dengan bitmask:

```java
int index = hash & (capacity - 1);
```

Karena itu banyak hash table menggunakan capacity power-of-two.

Contoh:

```text
capacity = 16
capacity - 1 = 15 = 0b1111
index = hash & 15
```

Ini mengambil lower bits dari hash. Akibatnya, kualitas penyebaran bit hash menjadi penting.

---

## 9. Separate Chaining

Separate chaining adalah strategi collision resolution paling mudah dipahami.

Setiap bucket menyimpan collection kecil entry yang jatuh ke bucket itu.

```text
bucket[0] -> null
bucket[1] -> (K1,V1) -> (K9,V9) -> null
bucket[2] -> (K2,V2) -> null
bucket[3] -> null
```

Lookup:

1. Hitung bucket.
2. Masuk ke chain bucket.
3. Scan entry di chain.
4. Pakai `equals` untuk menemukan key yang cocok.

### 9.1 Complexity Separate Chaining

Jika distribusi bagus:

```text
average chain length ≈ size / capacity
```

Maka lookup rata-rata mendekati `O(1)`.

Jika semua key jatuh ke bucket sama:

```text
bucket[0] -> K1 -> K2 -> K3 -> ... -> Kn
```

Lookup menjadi `O(n)`.

### 9.2 Kelebihan

- Mudah diimplementasikan.
- Deletion relatif sederhana.
- Load factor bisa lebih dari 1 secara teoritis.
- Collision tidak menyebabkan probing sequence rumit.

### 9.3 Kekurangan

- Extra object/node allocation.
- Pointer chasing.
- Cache locality buruk.
- Memory overhead tinggi.
- Bucket panjang bisa lambat.

---

## 10. Open Addressing

Open addressing menyimpan entry langsung di array. Jika bucket target penuh, cari slot lain menurut probing strategy.

Contoh linear probing:

```text
index = hash(key) % capacity
if table[index] occupied:
    try index + 1
    try index + 2
    ...
```

### 10.1 Linear Probing

```text
h, h+1, h+2, h+3, ...
```

Kelebihan:

- Cache locality bagus.
- Tidak banyak object allocation.
- Sering sangat cepat untuk primitive/specialized map.

Kekurangan:

- Primary clustering.
- Deletion tricky.
- Performance turun drastis saat load tinggi.

### 10.2 Quadratic Probing

```text
h + 1², h + 2², h + 3², ...
```

Mengurangi clustering tertentu, tetapi masih perlu desain hati-hati.

### 10.3 Double Hashing

Menggunakan hash kedua untuk menentukan step.

```text
h1(key) + i * h2(key)
```

Distribusi probing bisa lebih baik, tetapi lebih mahal.

### 10.4 Tombstone Problem

Dalam open addressing, delete tidak bisa selalu langsung mengosongkan slot, karena bisa memutus probing chain.

Maka dipakai tombstone:

```text
EMPTY
OCCUPIED
DELETED
```

Tombstone yang terlalu banyak membuat lookup lambat dan perlu rebuild/rehash.

---

## 11. Separate Chaining vs Open Addressing

| Aspek | Separate Chaining | Open Addressing |
|---|---|---|
| Collision | Bucket berisi chain/tree/list | Cari slot lain di array |
| Memory locality | Lebih buruk | Lebih baik |
| Allocation | Node tambahan | Bisa lebih compact |
| Delete | Lebih mudah | Perlu tombstone/reprobe |
| Load factor | Bisa lebih fleksibel | Biasanya harus dijaga lebih rendah |
| Java object map umum | Banyak memakai node/object | Sering dipakai primitive-specialized map |
| Worst case | Chain panjang | Probe panjang |

Di Java standard `HashMap`, model konseptualnya lebih dekat ke separate chaining dengan bucket table berisi node/tree node. Banyak library high-performance untuk primitive/object specialized map menggunakan variasi open addressing.

---

## 12. Load Factor

Load factor adalah rasio:

```text
load factor = number of entries / number of buckets
```

Misalnya:

```text
size = 12
capacity = 16
load factor = 12 / 16 = 0.75
```

Dalam banyak hash table, ketika size melewati threshold:

```text
threshold = capacity * configuredLoadFactor
```

table diperbesar.

Dokumentasi resmi `HashMap` menyebut initial capacity dan load factor sebagai dua parameter yang memengaruhi performa; load factor mengukur seberapa penuh hash table boleh terisi sebelum capacity otomatis ditingkatkan.

### 12.1 Load Factor Rendah

Kelebihan:

- Lebih sedikit collision.
- Lookup cenderung lebih cepat.
- Chain/probe lebih pendek.

Kekurangan:

- Memori lebih boros.
- Banyak bucket kosong.

### 12.2 Load Factor Tinggi

Kelebihan:

- Memori lebih hemat.

Kekurangan:

- Collision lebih banyak.
- Lookup/insert/delete bisa lebih lambat.
- Resize bisa terjadi di titik yang tidak diinginkan jika sizing salah.

### 12.3 Default Bukan Selalu Optimal

Default seperti `0.75` adalah kompromi umum, bukan hukum alam.

Untuk workload tertentu:

- read-heavy latency-sensitive: load factor lebih rendah bisa masuk akal,
- memory-constrained batch job: load factor lebih tinggi bisa dipertimbangkan,
- small map: default biasanya cukup,
- huge map: sizing perlu dihitung lebih serius.

---

## 13. Resize dan Rehash

Resize terjadi saat jumlah entry melewati threshold.

Secara konseptual:

```text
old table capacity = 16
new table capacity = 32
for each entry in old table:
    recompute/reassign bucket in new table
```

Poin penting:

> Resize bukan operasi murah. Ia bisa menjadi latency spike karena banyak entry harus dipindahkan atau direlasikan ulang.

### 13.1 Kenapa Resize Mahal?

Karena resize dapat melibatkan:

- alokasi array baru,
- iterasi semua bucket lama,
- relinking node,
- update internal table reference,
- peningkatan allocation pressure,
- cache miss,
- potensi GC pressure.

### 13.2 Amortized vs Tail Latency

Secara teori, insert hash table sering dianggap amortized `O(1)`.

Artinya:

- banyak insert murah,
- sesekali insert sangat mahal karena resize,
- jika dirata-ratakan, masih `O(1)`.

Namun dalam production system, user tidak merasakan rata-rata. User bisa merasakan request yang kebetulan kena resize.

Contoh:

```text
request A: put 5 entries -> 1 ms
request B: put 5 entries -> 1 ms
request C: put 5 entries -> resize 1 million entries -> 300 ms
```

Rata-rata bisa terlihat baik, tetapi p99/p999 buruk.

---

## 14. Initial Capacity: Cara Berpikir yang Benar

Jika kamu tahu kira-kira jumlah entry yang akan dimasukkan, set initial capacity dengan benar.

Tujuan:

```text
hindari resize yang tidak perlu
```

Jika expected entries = `n`, load factor = `lf`, maka minimum capacity konseptual:

```text
requiredCapacity >= n / lf
```

Contoh:

```text
expected entries = 1,000,000
load factor = 0.75
required capacity ≈ 1,333,334
```

Jika implementasi memakai power-of-two capacity, capacity aktual akan dibulatkan ke power-of-two terdekat di atasnya.

### 14.1 Kesalahan Umum

Banyak orang menulis:

```java
new HashMap<>(1_000_000);
```

Lalu mengira itu cukup untuk 1 juta entry tanpa resize.

Tapi jika load factor 0.75, threshold pada capacity sekitar 1 juta adalah sekitar 750 ribu. Untuk menampung 1 juta entry tanpa resize, initial capacity harus lebih besar dari jumlah entry yang diharapkan.

Helper konseptual:

```java
static int capacityForExpectedSize(int expectedSize, float loadFactor) {
    if (expectedSize < 0) {
        throw new IllegalArgumentException("expectedSize must be >= 0");
    }
    if (!(loadFactor > 0.0f) || Float.isNaN(loadFactor)) {
        throw new IllegalArgumentException("loadFactor must be positive");
    }
    return (int) Math.ceil(expectedSize / loadFactor);
}
```

Catatan: implementasi standard library memiliki aturan internal sendiri untuk pembulatan, maksimum capacity, dan table allocation lazy. Fungsi di atas hanya mental model sizing.

---

## 15. Average `O(1)` Bukan Guarantee Mutlak

Hash table sering dijelaskan:

| Operation | Average |
|---|---:|
| put | `O(1)` |
| get | `O(1)` |
| remove | `O(1)` |

Namun itu bergantung pada asumsi:

1. Hash function cukup baik.
2. Data tersebar merata.
3. Load factor terkendali.
4. Equality check tidak terlalu mahal.
5. Resize tidak sedang terjadi.
6. Tidak ada adversarial input.
7. Key immutable/stable.

Worst-case bisa:

```text
O(n)
```

Atau untuk implementasi yang mengubah bucket panjang menjadi tree:

```text
O(log n)
```

Tetapi tetap ada biaya konstan dan memory overhead.

---

## 16. Equality Check Cost Bisa Mengubah Realita

Misalnya key adalah object besar:

```java
record LargeKey(String tenantId, String caseNo, String fullPayloadJson) {}
```

Jika `equals` membandingkan payload besar, maka collision kecil pun bisa mahal.

Hash table cost bukan hanya:

```text
O(1)
```

Tetapi lebih realistis:

```text
hash cost + bucket/probe cost + equality cost
```

Contoh:

```text
get(key) ≈ cost(hashCode(key)) + cost(bucket lookup) + k * cost(equals)
```

Jika `equals` mahal, map bisa lambat meskipun collision rendah.

Rule:

> Key harus kecil, immutable, representatif, dan equality/hash-nya murah.

Baik:

```java
record CaseKey(String tenantId, String caseNo) {}
```

Kurang baik:

```java
record CaseKey(String tenantId, String caseNo, String entireRequestBody) {}
```

---

## 17. Hash Code Caching: Kapan Masuk Akal?

Untuk immutable object dengan hash mahal, hash code bisa di-cache.

Contoh `String` di Java secara historis menyimpan/caching hash setelah dihitung, karena string sering dipakai sebagai key.

Untuk object sendiri:

```java
final class RuleKey {
    private final String tenantId;
    private final String module;
    private final String ruleCode;
    private final int hash;

    RuleKey(String tenantId, String module, String ruleCode) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.module = Objects.requireNonNull(module);
        this.ruleCode = Objects.requireNonNull(ruleCode);
        this.hash = Objects.hash(tenantId, module, ruleCode);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof RuleKey other)) return false;
        return tenantId.equals(other.tenantId)
            && module.equals(other.module)
            && ruleCode.equals(other.ruleCode);
    }

    @Override
    public int hashCode() {
        return hash;
    }
}
```

Namun jangan otomatis cache hash untuk semua object.

Trade-off:

- tambah field memory,
- constructor lebih mahal,
- berguna hanya jika key sering di-hash,
- harus immutable.

---

## 18. Hash Flooding

Hash flooding adalah kondisi ketika banyak key sengaja dibuat memiliki collision buruk, sehingga hash table turun performanya.

Dalam sistem yang menerima input eksternal, ini bisa menjadi masalah security/performance.

Contoh konseptual:

```text
attacker sends many parameter names with colliding hashes
server stores them in hash map
lookup/insert becomes very slow
CPU spikes
request latency explodes
```

Modern Java `HashMap` memiliki mitigasi implementasi seperti tree bins untuk bucket yang terlalu padat dalam kondisi tertentu, tetapi engineer tetap tidak boleh mengabaikan:

- input limit,
- request size limit,
- key normalization,
- bounded parsing,
- defensive timeout,
- rate limiting.

Hash table tidak menggantikan boundary protection.

---

## 19. Hash Table Tidak Menjaga Ordering

Hash table menjawab:

```text
key -> value
```

Bukan:

```text
nilai terdekat
range tanggal
urutan prioritas
prefix search
min/max
next greater
```

Jika kamu butuh ordering, mungkin struktur yang lebih tepat:

| Kebutuhan | Struktur Lebih Cocok |
|---|---|
| Lookup exact key | Hash table |
| Sorted iteration | Tree / sorted array |
| Range query | TreeMap / interval tree / segment tree |
| Prefix query | Trie |
| Priority min/max | Heap / priority queue |
| Nearest lower/higher | NavigableMap |
| Top-K | Heap / selection algorithm |

Contoh buruk:

```java
Map<LocalDate, List<Case>> casesByDate = new HashMap<>();
```

Lalu ingin query:

```text
all cases from 2026-01-01 to 2026-01-31
```

Dengan `HashMap`, kamu harus scan key satu per satu.

Lebih cocok:

```java
NavigableMap<LocalDate, List<Case>> casesByDate = new TreeMap<>();
```

Lalu:

```java
var janCases = casesByDate.subMap(
    LocalDate.of(2026, 1, 1), true,
    LocalDate.of(2026, 1, 31), true
);
```

Rule:

> Hash table bagus untuk exact lookup, bukan untuk ordered/range semantics.

---

## 20. Hash Table dan Set

Set berbasis hash pada dasarnya adalah map dari key ke dummy value.

Konsep:

```text
HashSet<E> ≈ HashMap<E, PRESENT>
```

Operasi:

```java
Set<String> visited = new HashSet<>();

if (visited.add(caseId)) {
    // first time seen
} else {
    // duplicate
}
```

Ini sering dipakai untuk:

- deduplication,
- visited set pada graph traversal,
- membership check,
- uniqueness constraint in-memory,
- cycle detection.

Namun `Set` correctness tetap bergantung pada `equals/hashCode` element.

---

## 21. Hash Table as Index

Salah satu cara berpikir paling berguna:

> Map adalah index in-memory.

Contoh list:

```java
List<CaseRecord> records = loadCases();
```

Jika berkali-kali mencari by case number:

```java
CaseRecord findByCaseNo(List<CaseRecord> records, String caseNo) {
    for (CaseRecord record : records) {
        if (record.caseNo().equals(caseNo)) {
            return record;
        }
    }
    return null;
}
```

Jika dilakukan berkali-kali, ini menjadi mahal.

Bangun index:

```java
Map<String, CaseRecord> byCaseNo = new HashMap<>();

for (CaseRecord record : records) {
    CaseRecord previous = byCaseNo.put(record.caseNo(), record);
    if (previous != null) {
        throw new IllegalStateException("Duplicate caseNo: " + record.caseNo());
    }
}
```

Lalu lookup:

```java
CaseRecord record = byCaseNo.get(caseNo);
```

Trade-off:

| Tanpa Index | Dengan Hash Index |
|---|---|
| Memory rendah | Memory lebih tinggi |
| Lookup `O(n)` | Lookup rata-rata `O(1)` |
| Tidak perlu build | Perlu build index |
| Cocok untuk sedikit lookup | Cocok untuk banyak lookup |

Mental model:

```text
Jika data dibaca berkali-kali berdasarkan key yang sama, pertimbangkan membangun index.
```

---

## 22. Duplicate Handling: `put` Bisa Menutupi Data

Masalah umum:

```java
Map<String, User> byEmail = new HashMap<>();

for (User user : users) {
    byEmail.put(user.email(), user);
}
```

Jika ada duplicate email, user sebelumnya tertimpa.

Dalam banyak domain, ini bug.

Lebih aman:

```java
for (User user : users) {
    User previous = byEmail.put(user.email(), user);
    if (previous != null) {
        throw new IllegalStateException("Duplicate email: " + user.email());
    }
}
```

Atau jika duplicate valid:

```java
Map<String, List<User>> usersByEmail = new HashMap<>();

for (User user : users) {
    usersByEmail
        .computeIfAbsent(user.email(), ignored -> new ArrayList<>())
        .add(user);
}
```

Rule:

> Saat membangun map, selalu tentukan apakah duplicate key adalah error, overwrite, merge, atau grouping.

Jangan biarkan default `put` menentukan domain behavior secara diam-diam.

---

## 23. `null` dan Ambiguitas Lookup

Pada map yang memperbolehkan null value, ini ambigu:

```java
V value = map.get(key);
```

Jika hasilnya `null`, artinya bisa:

1. key tidak ada,
2. key ada tetapi value-nya null.

Maka gunakan:

```java
if (map.containsKey(key)) {
    V value = map.get(key);
}
```

Namun ini melakukan lookup dua kali secara konseptual.

Lebih baik dalam banyak desain:

> Hindari menyimpan null value dalam map.

Gunakan:

- tidak ada entry = tidak ada value,
- `Optional` dengan hati-hati,
- sentinel object,
- result type/domain object yang eksplisit.

Contoh:

```java
Map<String, Optional<Rule>> rules = new HashMap<>(); // biasanya kurang ideal
```

Lebih baik:

```java
Map<String, Rule> rules = new HashMap<>();
```

Dan jika rule tidak ada, key tidak dimasukkan.

---

## 24. Composite Key

Sering kita butuh key dari beberapa field.

Buruk:

```java
String key = tenantId + ":" + module + ":" + ruleCode;
```

Masalah:

- delimiter collision,
- normalization tidak jelas,
- type safety hilang,
- parsing ulang,
- bug saat field mengandung delimiter,
- sulit evolve.

Lebih baik:

```java
record RuleKey(String tenantId, String module, String ruleCode) {
    RuleKey {
        tenantId = Objects.requireNonNull(tenantId).trim();
        module = Objects.requireNonNull(module).trim();
        ruleCode = Objects.requireNonNull(ruleCode).trim();

        if (tenantId.isEmpty() || module.isEmpty() || ruleCode.isEmpty()) {
            throw new IllegalArgumentException("RuleKey fields must not be blank");
        }
    }
}
```

Pemakaian:

```java
Map<RuleKey, Rule> rules = new HashMap<>();

RuleKey key = new RuleKey("CEA", "CASE", "ESCALATE_OVERDUE");
rules.put(key, rule);
```

Keuntungan:

- equality benar,
- hash benar,
- type-safe,
- bisa validasi di constructor,
- mudah refactor,
- tidak ada delimiter bug.

---

## 25. Canonicalization dan Normalization

Hash table sangat sensitif terhadap definisi equality.

Contoh:

```text
"ABC"
"abc"
" ABC "
```

Apakah ini key yang sama?

Jawabannya domain-specific.

Jika email:

```java
String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
```

Jika case number mungkin case-sensitive.

Jika postal code mungkin harus remove whitespace.

Jangan campur normalization di banyak tempat:

```java
map.get(input.trim().toLowerCase());
map.put(email.toLowerCase().trim());
map.containsKey(email.strip());
```

Lebih baik jadikan value object:

```java
record EmailKey(String value) {
    EmailKey {
        value = Objects.requireNonNull(value).trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty()) {
            throw new IllegalArgumentException("email must not be blank");
        }
    }
}
```

Dengan begitu, semua key masuk ke map dalam bentuk canonical.

Rule:

> Sebelum memakai hash table, definisikan equality domain-nya.

---

## 26. Memory Cost Hash Table

Hash table biasanya lebih boros memori dibanding array/list.

Sumber overhead:

1. Bucket array.
2. Entry/node object.
3. Key object.
4. Value object.
5. Reference dari bucket ke node.
6. Reference dari node ke key/value/next.
7. Padding/alignment.
8. Load factor menyisakan bucket kosong.

Contoh konseptual separate chaining:

```text
HashMap table array:
  [ref, ref, null, ref, null, ...]

Node:
  int hash
  K key ref
  V value ref
  Node next ref
  object header
  padding
```

Jika kamu punya jutaan entry, overhead ini sangat signifikan.

Untuk key/value primitive, standard `HashMap<Integer, Long>` juga menambah boxing overhead:

```java
Map<Integer, Long> map = new HashMap<>();
```

Ini menyimpan:

- `Integer` objects,
- `Long` objects,
- map nodes,
- bucket array.

Untuk workload sangat besar/performance-sensitive, primitive-specialized collection bisa jauh lebih hemat.

Namun rule engineering tetap:

> Jangan optimasi ke library specialized sebelum workload dan bottleneck jelas. Tetapi pahami bahwa overhead standard hash map nyata.

---

## 27. Hash Table dan GC Pressure

Hash table bisa meningkatkan GC pressure karena:

- banyak entry node,
- banyak boxed keys/values,
- resize menghasilkan array baru,
- temporary map dalam request path,
- grouping besar dalam stream pipeline,
- cache tanpa eviction.

Contoh anti-pattern:

```java
Map<String, List<Event>> grouped = events.stream()
    .collect(Collectors.groupingBy(Event::type));
```

Ini nyaman, tetapi untuk data besar bisa menghasilkan:

- banyak list,
- banyak resizing list,
- banyak map entry,
- allocation spike.

Kadang tetap benar. Tetapi untuk hot path, explicit sizing dan loop bisa lebih predictable.

---

## 28. Hash Table dan Cache

Cache sering diimplementasikan dengan map, tetapi:

```text
cache != map
```

Cache butuh policy:

- eviction,
- TTL,
- max size,
- refresh,
- negative caching,
- stampede control,
- concurrency semantics,
- invalidation.

Map tanpa eviction:

```java
private final Map<String, Response> cache = new HashMap<>();
```

Bisa menjadi memory leak.

Minimal, tanyakan:

1. Berapa maksimum entry?
2. Kapan entry expire?
3. Apakah value boleh stale?
4. Apakah key cardinality bounded?
5. Apakah ada input attacker-controlled?
6. Apa yang terjadi saat cache miss massal?
7. Apakah concurrent access aman?

Part 024 akan membahas cache data structures secara khusus.

---

## 29. Hash Table dalam Domain Engineering

Dalam sistem case management/regulatory workflow, hash table sering muncul sebagai:

### 29.1 Index by ID

```java
Map<CaseId, CaseRecord> casesById;
```

### 29.2 Group by State

```java
Map<CaseState, List<CaseRecord>> casesByState;
```

Untuk enum key, nanti kita akan bahas `EnumMap` sebagai opsi lebih baik dalam banyak kasus.

### 29.3 Deduplication

```java
Set<DocumentChecksum> seenDocuments;
```

### 29.4 Correlation Map

```java
Map<CorrelationId, PendingRequest> pendingRequests;
```

### 29.5 Rule Registry

```java
Map<RuleKey, RuleDefinition> rules;
```

### 29.6 Transition Lookup

```java
Map<TransitionKey, TransitionRule> transitions;
```

Contoh:

```java
record TransitionKey(CaseState from, CaseAction action) {}
```

```java
Map<TransitionKey, CaseState> transitionTable = Map.of(
    new TransitionKey(CaseState.DRAFT, CaseAction.SUBMIT), CaseState.SUBMITTED,
    new TransitionKey(CaseState.SUBMITTED, CaseAction.APPROVE), CaseState.APPROVED,
    new TransitionKey(CaseState.SUBMITTED, CaseAction.REJECT), CaseState.REJECTED
);
```

Di sini hash table menjadi bentuk eksplisit dari state transition table.

---

## 30. Mini Implementation: Simple Chained Hash Table

Implementasi ini bukan untuk production. Tujuannya membangun mental model.

```java
import java.util.Objects;

public final class SimpleHashTable<K, V> {
    private static final int DEFAULT_CAPACITY = 16;
    private static final float DEFAULT_LOAD_FACTOR = 0.75f;

    private Entry<K, V>[] table;
    private int size;
    private int threshold;
    private final float loadFactor;

    @SuppressWarnings("unchecked")
    public SimpleHashTable() {
        this.loadFactor = DEFAULT_LOAD_FACTOR;
        this.table = (Entry<K, V>[]) new Entry[DEFAULT_CAPACITY];
        this.threshold = (int) (DEFAULT_CAPACITY * DEFAULT_LOAD_FACTOR);
    }

    public V put(K key, V value) {
        Objects.requireNonNull(key, "key must not be null");

        if (size + 1 > threshold) {
            resize();
        }

        int hash = spread(key.hashCode());
        int index = indexFor(hash, table.length);

        Entry<K, V> current = table[index];
        while (current != null) {
            if (current.hash == hash && current.key.equals(key)) {
                V oldValue = current.value;
                current.value = value;
                return oldValue;
            }
            current = current.next;
        }

        table[index] = new Entry<>(hash, key, value, table[index]);
        size++;
        return null;
    }

    public V get(K key) {
        Objects.requireNonNull(key, "key must not be null");

        int hash = spread(key.hashCode());
        int index = indexFor(hash, table.length);

        Entry<K, V> current = table[index];
        while (current != null) {
            if (current.hash == hash && current.key.equals(key)) {
                return current.value;
            }
            current = current.next;
        }

        return null;
    }

    public boolean containsKey(K key) {
        Objects.requireNonNull(key, "key must not be null");

        int hash = spread(key.hashCode());
        int index = indexFor(hash, table.length);

        Entry<K, V> current = table[index];
        while (current != null) {
            if (current.hash == hash && current.key.equals(key)) {
                return true;
            }
            current = current.next;
        }

        return false;
    }

    public V remove(K key) {
        Objects.requireNonNull(key, "key must not be null");

        int hash = spread(key.hashCode());
        int index = indexFor(hash, table.length);

        Entry<K, V> current = table[index];
        Entry<K, V> previous = null;

        while (current != null) {
            if (current.hash == hash && current.key.equals(key)) {
                if (previous == null) {
                    table[index] = current.next;
                } else {
                    previous.next = current.next;
                }
                size--;
                return current.value;
            }
            previous = current;
            current = current.next;
        }

        return null;
    }

    public int size() {
        return size;
    }

    @SuppressWarnings("unchecked")
    private void resize() {
        Entry<K, V>[] oldTable = table;
        Entry<K, V>[] newTable = (Entry<K, V>[]) new Entry[oldTable.length * 2];

        for (Entry<K, V> head : oldTable) {
            Entry<K, V> current = head;
            while (current != null) {
                Entry<K, V> next = current.next;
                int newIndex = indexFor(current.hash, newTable.length);
                current.next = newTable[newIndex];
                newTable[newIndex] = current;
                current = next;
            }
        }

        table = newTable;
        threshold = (int) (newTable.length * loadFactor);
    }

    private static int spread(int hash) {
        return hash ^ (hash >>> 16);
    }

    private static int indexFor(int hash, int capacity) {
        return hash & (capacity - 1);
    }

    private static final class Entry<K, V> {
        final int hash;
        final K key;
        V value;
        Entry<K, V> next;

        Entry(int hash, K key, V value, Entry<K, V> next) {
            this.hash = hash;
            this.key = key;
            this.value = value;
            this.next = next;
        }
    }
}
```

### 30.1 Apa yang Bisa Dipelajari dari Implementasi Ini?

1. Bucket array adalah pusat struktur.
2. Hash disimpan di entry agar tidak selalu menghitung ulang.
3. `equals` tetap diperlukan meskipun hash cocok.
4. Resize memindahkan entry ke table baru.
5. Insert di head chain murah, tetapi mengubah order chain.
6. Null key sengaja dilarang untuk menyederhanakan invariant.
7. Capacity diasumsikan power-of-two.
8. `spread` membantu mencampur high bits ke low bits.

### 30.2 Apa yang Tidak Production-Ready?

1. Tidak thread-safe.
2. Tidak punya iterator.
3. Tidak menangani overflow capacity.
4. Tidak punya tree bin.
5. Tidak punya fail-fast behavior.
6. Tidak mendukung null key/value.
7. Tidak mengoptimalkan resize detail.
8. Tidak compatible dengan Java Collections Framework.

Tujuan implementasi ini adalah edukasi, bukan mengganti `HashMap`.

---

## 31. Testing Hash Table Behavior

Untuk menguji hash table, jangan hanya happy path.

### 31.1 Basic Put/Get

```java
SimpleHashTable<String, Integer> table = new SimpleHashTable<>();

table.put("a", 1);
table.put("b", 2);

assert table.get("a") == 1;
assert table.get("b") == 2;
assert table.get("c") == null;
```

### 31.2 Overwrite Existing Key

```java
table.put("a", 1);
Integer old = table.put("a", 99);

assert old == 1;
assert table.get("a") == 99;
assert table.size() == 1;
```

### 31.3 Collision Handling

```java
final class BadHashKey {
    private final String value;

    BadHashKey(String value) {
        this.value = value;
    }

    @Override
    public int hashCode() {
        return 1;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof BadHashKey other)) return false;
        return value.equals(other.value);
    }
}
```

```java
SimpleHashTable<BadHashKey, Integer> table = new SimpleHashTable<>();

table.put(new BadHashKey("a"), 1);
table.put(new BadHashKey("b"), 2);
table.put(new BadHashKey("c"), 3);

assert table.get(new BadHashKey("a")) == 1;
assert table.get(new BadHashKey("b")) == 2;
assert table.get(new BadHashKey("c")) == 3;
```

### 31.4 Resize

```java
SimpleHashTable<Integer, String> table = new SimpleHashTable<>();

for (int i = 0; i < 10_000; i++) {
    table.put(i, "v" + i);
}

for (int i = 0; i < 10_000; i++) {
    assert table.get(i).equals("v" + i);
}
```

### 31.5 Remove Head/Middle/Tail

Collision key bisa dipakai untuk memastikan remove di chain benar.

---

## 32. Production Pattern: Build Index with Duplicate Policy

Misalnya kita punya records:

```java
record CaseRecord(String caseNo, String state, Instant createdAt) {}
```

Kita ingin index by case number.

### 32.1 Strict Unique Index

```java
static Map<String, CaseRecord> indexByCaseNo(List<CaseRecord> records) {
    int capacity = (int) Math.ceil(records.size() / 0.75d);
    Map<String, CaseRecord> index = new HashMap<>(capacity);

    for (CaseRecord record : records) {
        CaseRecord previous = index.put(record.caseNo(), record);
        if (previous != null) {
            throw new IllegalStateException(
                "Duplicate caseNo: " + record.caseNo()
            );
        }
    }

    return Map.copyOf(index);
}
```

Kenapa `Map.copyOf`?

- hasil index tidak bisa dimutasi sembarangan,
- aman dipublish sebagai snapshot,
- invariant uniqueness tidak rusak setelah dibuat.

### 32.2 Grouping Index

Jika satu state punya banyak case:

```java
static Map<String, List<CaseRecord>> groupByState(List<CaseRecord> records) {
    Map<String, List<CaseRecord>> grouped = new HashMap<>();

    for (CaseRecord record : records) {
        grouped
            .computeIfAbsent(record.state(), ignored -> new ArrayList<>())
            .add(record);
    }

    Map<String, List<CaseRecord>> snapshot = new HashMap<>();
    for (Map.Entry<String, List<CaseRecord>> entry : grouped.entrySet()) {
        snapshot.put(entry.getKey(), List.copyOf(entry.getValue()));
    }

    return Map.copyOf(snapshot);
}
```

Di sini kita membedakan:

- unique index: duplicate adalah error,
- grouping index: duplicate adalah domain behavior.

---

## 33. Production Pattern: Correlation Map

Dalam sistem asynchronous:

```java
record CorrelationId(String value) {}

record PendingRequest(
    CorrelationId correlationId,
    Instant createdAt,
    String requester,
    String operation
) {}
```

Kita mungkin punya:

```java
Map<CorrelationId, PendingRequest> pending = new HashMap<>();
```

Risiko:

- entry tidak dihapus setelah response,
- timeout tidak membersihkan pending request,
- correlation ID tidak unique,
- map tumbuh menjadi memory leak.

Lebih defensif:

```java
void register(PendingRequest request) {
    PendingRequest previous = pending.put(request.correlationId(), request);
    if (previous != null) {
        throw new IllegalStateException(
            "Duplicate correlationId: " + request.correlationId()
        );
    }
}

PendingRequest complete(CorrelationId correlationId) {
    PendingRequest request = pending.remove(correlationId);
    if (request == null) {
        throw new IllegalStateException(
            "Unknown or expired correlationId: " + correlationId
        );
    }
    return request;
}
```

Dan harus ada cleanup policy:

```java
void expireOlderThan(Instant cutoff) {
    Iterator<Map.Entry<CorrelationId, PendingRequest>> iterator = pending.entrySet().iterator();
    while (iterator.hasNext()) {
        Map.Entry<CorrelationId, PendingRequest> entry = iterator.next();
        if (entry.getValue().createdAt().isBefore(cutoff)) {
            iterator.remove();
        }
    }
}
```

Hash table menyelesaikan lookup. Ia tidak otomatis menyelesaikan lifecycle.

---

## 34. Production Pattern: Transition Table

Dalam workflow engine kecil, hash table bisa merepresentasikan transition table.

```java
enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}

enum CaseAction {
    SUBMIT,
    START_REVIEW,
    APPROVE,
    REJECT,
    CLOSE
}

record TransitionKey(CaseState from, CaseAction action) {}
```

```java
final class TransitionTable {
    private final Map<TransitionKey, CaseState> transitions;

    TransitionTable(Map<TransitionKey, CaseState> transitions) {
        this.transitions = Map.copyOf(transitions);
    }

    CaseState next(CaseState from, CaseAction action) {
        CaseState next = transitions.get(new TransitionKey(from, action));
        if (next == null) {
            throw new IllegalStateException(
                "Illegal transition: " + from + " + " + action
            );
        }
        return next;
    }
}
```

Kenapa ini bagus?

- lookup exact transition cepat,
- illegal transition eksplisit,
- transition data bisa divalidasi saat startup,
- mudah diuji,
- state machine tidak tersebar dalam `if-else` panjang.

Namun jika butuh analisis reachability, cycle, atau path, hash table saja tidak cukup. Kita perlu graph model. Itu dibahas di Part 013–014 dan Part 027.

---

## 35. Production Pattern: Deduplication

Dedup sederhana:

```java
static List<String> uniquePreserveFirstSeen(List<String> input) {
    Set<String> seen = new HashSet<>();
    List<String> result = new ArrayList<>();

    for (String item : input) {
        if (seen.add(item)) {
            result.add(item);
        }
    }

    return result;
}
```

Poin penting:

- `seen.add(item)` mengembalikan true jika item belum ada.
- Result mempertahankan urutan first-seen karena list terpisah.
- Jika butuh set yang juga menjaga insertion order, gunakan struktur yang mendukung ordering, misalnya `LinkedHashSet`.

Dedup domain object:

```java
record DocumentKey(String checksum, long size) {}
```

```java
Set<DocumentKey> seenDocuments = new HashSet<>();
```

Pastikan checksum dan size benar-benar mendefinisikan equality domain.

---

## 36. Common Failure Modes

### 36.1 Mutable Key

```java
key.field = newValue;
map.get(key); // gagal
```

Solusi:

- gunakan immutable key,
- gunakan record/value object,
- jangan expose setter untuk field equality.

### 36.2 Override `equals` tetapi Tidak Override `hashCode`

```java
class UserId {
    String value;

    @Override
    public boolean equals(Object o) {
        return o instanceof UserId other && value.equals(other.value);
    }
}
```

Bug:

- dua object equal bisa punya hash berbeda,
- lookup gagal.

Solusi:

- override keduanya,
- gunakan `record` jika cocok.

### 36.3 Hash Code Terlalu Lemah

```java
@Override
public int hashCode() {
    return 1;
}
```

Semua key masuk bucket sama.

### 36.4 Equality Terlalu Mahal

Key membawa payload besar sehingga collision scan mahal.

### 36.5 Silent Overwrite

```java
map.put(key, value);
```

Tanpa memeriksa previous value.

### 36.6 Null Value Ambiguity

```java
map.get(key) == null
```

Tidak jelas key tidak ada atau value null.

### 36.7 Wrong Data Structure

Menggunakan `HashMap` untuk range query.

### 36.8 Unbounded Map as Cache

Map tumbuh tanpa batas.

### 36.9 Rebuilding Map Repeatedly

```java
for (Request request : requests) {
    Map<String, Rule> index = buildRuleIndex(rules); // repeated expensive work
    process(request, index);
}
```

Solusi: build sekali, reuse snapshot.

### 36.10 Accidental `O(n²)` with List Contains

```java
List<String> allowed = loadAllowedIds();

for (String id : incomingIds) {
    if (allowed.contains(id)) { // O(n)
        process(id);
    }
}
```

Jika incoming dan allowed besar, ini `O(n*m)`.

Solusi:

```java
Set<String> allowedSet = new HashSet<>(allowed);

for (String id : incomingIds) {
    if (allowedSet.contains(id)) {
        process(id);
    }
}
```

---

## 37. Decision Framework: Kapan Pakai Hash Table?

Gunakan hash table jika:

1. Butuh exact lookup by key.
2. Key equality jelas.
3. Key bisa dibuat immutable/stable.
4. Tidak butuh ordering/range query.
5. Banyak lookup dibanding jumlah data.
6. Memory overhead dapat diterima.
7. Cardinality dapat diperkirakan atau dibatasi.
8. Duplicate policy jelas.

Jangan langsung gunakan hash table jika:

1. Butuh sorted order.
2. Butuh nearest/range query.
3. Key mutable.
4. Key equality belum jelas.
5. Dataset sangat kecil dan lookup sedikit.
6. Memory sangat ketat.
7. Data streaming sekali lewat tanpa lookup ulang.
8. Struktur bisa unbounded tanpa eviction.

---

## 38. Practical Checklist sebelum Membuat `Map`

Sebelum menulis:

```java
Map<K, V> map = new HashMap<>();
```

Tanyakan:

1. Apa key-nya?
2. Apakah key immutable?
3. Apa definisi equality domain-nya?
4. Apakah `equals/hashCode` benar?
5. Apakah duplicate key error, overwrite, merge, atau grouping?
6. Berapa expected size?
7. Perlu initial capacity?
8. Apakah value boleh null?
9. Apakah butuh ordering?
10. Apakah map ini bounded?
11. Siapa pemilik mutasi map?
12. Apakah map perlu thread-safe?
13. Apakah hasilnya sebaiknya immutable snapshot?
14. Apakah key berasal dari input eksternal?
15. Apa failure mode jika lookup miss?

Checklist ini sederhana tetapi sangat efektif mencegah bug production.

---

## 39. Latihan Mental Model

### 39.1 Soal 1

Kamu punya list 200.000 case, dan setiap request melakukan lookup 100 case number. Apakah perlu map?

Jawaban:

Kemungkinan iya. Jika list discan setiap lookup:

```text
100 * 200,000 = 20,000,000 comparisons per request
```

Dengan index:

```text
build once: O(n)
lookup: 100 * O(1) average
```

Jika index bisa reuse antar request sebagai snapshot, benefit besar.

### 39.2 Soal 2

Kamu butuh semua case dengan deadline antara tanggal A dan B. Apakah `HashMap<LocalDate, List<Case>>` ideal?

Jawaban:

Tidak ideal jika range query sering. Gunakan `TreeMap`/`NavigableMap` atau struktur range lain.

### 39.3 Soal 3

Kamu membuat key dari `String tenantId`, `String module`, `String ruleCode`. Mana lebih baik: concat string atau record?

Jawaban:

Record/value object lebih baik karena type-safe, equality jelas, validation terpusat, dan tidak rentan delimiter collision.

### 39.4 Soal 4

Map digunakan sebagai cache response external API tanpa TTL dan tanpa max size. Apa risikonya?

Jawaban:

Memory leak, stale data, unbounded growth, cache stampede saat miss, dan sulit mengontrol lifecycle.

---

## 40. Ringkasan

Hash table adalah struktur data untuk exact key-based lookup. Ia cepat bukan karena magic, tetapi karena:

```text
key -> hash -> bucket -> small search
```

Namun kecepatannya bergantung pada:

- hash quality,
- load factor,
- collision handling,
- resize policy,
- equality cost,
- key immutability,
- memory overhead,
- operation mix.

Ingat invariant paling penting:

> Entry harus tetap berada pada bucket yang sesuai dengan hash/equality key-nya. Karena itu key hash-based collection harus stable.

Hash table sangat kuat untuk:

- index by ID,
- deduplication,
- correlation map,
- exact transition lookup,
- grouping,
- membership check.

Tetapi hash table bukan solusi untuk semua bentuk query. Jika butuh ordering, range, prefix, priority, atau graph traversal, struktur lain lebih tepat.

---

## 41. Checklist Top-Tier Engineer

Saat memilih hash table, engineer kuat tidak hanya bertanya:

```text
Apakah get O(1)?
```

Tetapi bertanya:

1. Apa invariant key-nya?
2. Apakah equality domain benar?
3. Apakah key immutable?
4. Bagaimana duplicate ditangani?
5. Berapa size dan load factor?
6. Apakah resize bisa masuk request path?
7. Apakah memory overhead acceptable?
8. Apakah ordering/range sebenarnya dibutuhkan?
9. Apakah map ini cache? Jika iya, mana eviction policy-nya?
10. Apakah input bisa adversarial?
11. Apakah map akan dipublish sebagai mutable shared state?
12. Apakah benchmark perlu dilakukan?

Jika bisa menjawab pertanyaan itu, kamu tidak sekadar “pakai `HashMap`”, tetapi mendesain index/invariant yang benar.

---

## 42. Koneksi ke Part Berikutnya

Part ini membahas hash table secara konseptual.

Part berikutnya akan masuk ke keluarga implementasi Java:

- `HashMap`,
- `HashSet`,
- `LinkedHashMap`,
- `IdentityHashMap`,
- `WeakHashMap`,
- null behavior,
- iteration order,
- access order,
- memory overhead,
- implementation-specific pitfalls,
- production selection guide.

Dengan fondasi part ini, pembahasan Part 007 tidak akan hanya menjadi daftar API, tetapi analisis trade-off implementasi.

---

## 43. Status Seri

Seri **belum selesai**.

Progress:

- Part 000 — selesai
- Part 001 — selesai
- Part 002 — selesai
- Part 003 — selesai
- Part 004 — selesai
- Part 005 — selesai
- Part 006 — selesai

Berikutnya:

```text
learn-java-dsa-part-007.md
```

Topik:

```text
HashMap, HashSet, LinkedHashMap, IdentityHashMap, WeakHashMap
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dsa-part-005 — Stack, Queue, Deque, Ring Buffer](./learn-java-dsa-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-007 — HashMap, HashSet, LinkedHashMap, IdentityHashMap, WeakHashMap](./learn-java-dsa-part-007.md)
