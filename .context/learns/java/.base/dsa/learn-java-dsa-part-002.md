# learn-java-dsa-part-002.md

# Part 002 — Java Object, Array, Reference, Equality, Hashing

> Seri: **Java Data Structure and Algorithm**  
> Status: **Part 002 dari 030**  
> Prasyarat: sudah memahami Java basic, Collections Framework dasar, concurrency dasar, dan Part 000–001 seri ini.  
> Fokus: fondasi semantik object, array, reference, equality, dan hashing yang menentukan benar/salahnya struktur data Java.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bukan hanya tahu cara override `equals()` dan `hashCode()`, tetapi mampu menjawab pertanyaan engineering seperti:

1. Kenapa dua object yang “isinya sama” belum tentu dianggap sama oleh `HashMap`?
2. Kenapa object mutable bisa menghancurkan invariant map/set?
3. Kenapa `int[]` dan `Integer[]` berbeda drastis dari sisi memory dan performance?
4. Kenapa `Arrays.asList(array)` bisa mengejutkan?
5. Kenapa array sering menjadi struktur data paling cepat, tetapi juga paling mudah disalahgunakan?
6. Kenapa hash yang buruk membuat `O(1)` berubah menjadi latency spike?
7. Bagaimana mendesain key object yang aman untuk map, cache, deduplication, indexing, dan graph traversal?
8. Bagaimana membedakan identity, equality, ordering, dan hashing sebagai contract yang berbeda?

Materi ini adalah fondasi untuk `HashMap`, `HashSet`, `TreeMap`, `ArrayList`, graph adjacency structure, cache key, visited set, deduplication index, rule engine, workflow state index, dan hampir semua struktur data Java yang akan kita bahas berikutnya.

---

## 1. Mental Model Utama

Di Java, struktur data tidak menyimpan “nilai abstrak” secara polos. Mayoritas struktur data menyimpan **reference ke object**.

Artinya, saat kamu menulis:

```java
List<Customer> customers = new ArrayList<>();
customers.add(customer);
```

`ArrayList` tidak menyimpan seluruh isi `Customer` sebagai salinan. Ia menyimpan reference menuju object `Customer` di heap.

Mental model sederhananya:

```text
customers
   |
   v
ArrayList object
   |
   v
elementData[]  ----> Customer object
                 |
                 +--> fields: id, name, status, ...
```

Konsekuensinya:

1. Jika object `Customer` dimutasi dari tempat lain, isi yang terlihat dari list juga berubah.
2. Jika `Customer` dipakai sebagai key map, perubahan field yang dipakai oleh `equals/hashCode` dapat membuat map rusak secara logis.
3. Jika kamu copy list dengan `new ArrayList<>(oldList)`, yang disalin adalah container-nya, bukan object element-nya.
4. Jika kamu membandingkan dua array dengan `equals`, default-nya identity comparison, bukan element-wise comparison.

Inilah sebabnya DSA di Java harus dimulai dari object/reference semantics.

---

## 2. Object Identity vs Logical Equality

Java punya dua konsep “sama” yang sering tercampur:

| Konsep | Makna | Operator / Method | Contoh |
|---|---|---|---|
| Identity | Apakah dua reference menunjuk object yang sama di memory | `==` | `a == b` |
| Logical equality | Apakah dua object dianggap sama menurut definisi domain | `equals()` | `a.equals(b)` |

Contoh:

```java
record CustomerId(String value) {}

CustomerId a = new CustomerId("C-001");
CustomerId b = new CustomerId("C-001");

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

`a` dan `b` adalah dua object berbeda, tetapi secara domain sama karena memiliki nilai `value` yang sama.

### 2.1 Identity Cocok Untuk Apa?

Identity cocok ketika object benar-benar merepresentasikan instance unik, bukan value.

Contoh:

```java
Object lock = new Object();
```

Untuk lock object, identity penting. Dua lock dengan isi kosong tetap bukan lock yang sama.

Contoh lain:

1. Sentinel object.
2. Internal marker.
3. Object graph traversal berdasarkan instance fisik.
4. Caching metadata per instance, bukan per logical value.
5. Cycle detection pada graph object di memory.

### 2.2 Logical Equality Cocok Untuk Apa?

Logical equality cocok ketika object merepresentasikan value/domain identity.

Contoh:

```java
record CaseId(String value) {}
record UserId(String value) {}
record PostalCode(String value) {}
record RuleCode(String value) {}
```

Untuk value object seperti ini, dua instance berbeda dengan nilai sama seharusnya dianggap sama.

---

## 3. `equals()` Contract

`equals()` bukan sekadar method biasa. Ia adalah contract yang dipakai oleh banyak struktur data.

Contract utama `equals()`:

1. **Reflexive**: `x.equals(x)` harus `true`.
2. **Symmetric**: jika `x.equals(y)` true, maka `y.equals(x)` juga harus true.
3. **Transitive**: jika `x.equals(y)` true dan `y.equals(z)` true, maka `x.equals(z)` harus true.
4. **Consistent**: hasilnya stabil selama data yang dibandingkan tidak berubah.
5. **Non-null**: `x.equals(null)` harus false.

Contoh implementasi manual:

```java
public final class CaseId {
    private final String value;

    public CaseId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId must not be blank");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof CaseId that)) {
            return false;
        }
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Dengan Java `record`, implementasi value-object sederhana bisa jauh lebih aman:

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId must not be blank");
        }
    }
}
```

`record` secara otomatis membuat `equals`, `hashCode`, dan `toString` berdasarkan component record.

---

## 4. `hashCode()` Contract

`hashCode()` adalah integer representation yang dipakai struktur data hash-based untuk mencari bucket.

Contract utamanya:

1. Jika `a.equals(b)` true, maka `a.hashCode() == b.hashCode()` harus true.
2. Jika `a.equals(b)` false, hash boleh sama, tetapi collision lebih banyak berarti performa lebih buruk.
3. Hash harus stabil selama object dipakai sebagai key di hash-based collection.

Yang sering dilupakan:

```text
equals true  => hashCode harus sama
hashCode sama => equals belum tentu true
```

Contoh collision valid:

```java
String a = "FB";
String b = "Ea";

System.out.println(a.equals(b));    // false
System.out.println(a.hashCode());   // historically same in many JDKs
System.out.println(b.hashCode());   // historically same in many JDKs
```

Collision tidak melanggar contract. Collision hanya memaksa map melakukan pemeriksaan tambahan menggunakan `equals()`.

---

## 5. Kenapa `equals` dan `hashCode` Harus Satu Paket

Bayangkan `HashSet` sebagai struktur:

```text
HashSet
  -> HashMap internal
       bucket[hash(key)] -> candidate entries -> equals check
```

Ketika kamu menambahkan object:

```java
set.add(x);
```

Hash set kira-kira melakukan:

1. Hitung `x.hashCode()`.
2. Tentukan bucket.
3. Cari object existing di bucket yang `equals(x)`.
4. Jika ada, jangan tambah duplicate.
5. Jika tidak ada, tambahkan.

Jika dua object equal tetapi hash berbeda, mereka masuk bucket berbeda. Akibatnya set gagal mendeteksi duplicate.

Contoh buruk:

```java
public final class BadUserId {
    private final String value;

    public BadUserId(String value) {
        this.value = value;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof BadUserId that
                && value.equals(that.value);
    }

    // BUG: hashCode tidak dioverride.
}
```

Pemakaian:

```java
Set<BadUserId> ids = new HashSet<>();
ids.add(new BadUserId("U-001"));
ids.add(new BadUserId("U-001"));

System.out.println(ids.size()); // bisa 2, padahal logical duplicate
```

Bug seperti ini berbahaya karena tidak selalu langsung kelihatan. Ia muncul sebagai duplicate record, cache miss, authorization mismatch, visited-set gagal, atau deduplication gagal.

---

## 6. Mutable Key Problem

Ini salah satu failure mode paling penting dalam Java DSA.

Contoh:

```java
public final class MutableCaseKey {
    private String caseNo;

    public MutableCaseKey(String caseNo) {
        this.caseNo = caseNo;
    }

    public void setCaseNo(String caseNo) {
        this.caseNo = caseNo;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof MutableCaseKey that
                && Objects.equals(caseNo, that.caseNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(caseNo);
    }
}
```

Lalu:

```java
MutableCaseKey key = new MutableCaseKey("CASE-001");
Map<MutableCaseKey, String> map = new HashMap<>();

map.put(key, "stored");

key.setCaseNo("CASE-999");

System.out.println(map.get(key)); // likely null
```

Map tidak benar-benar kehilangan entry. Entry masih ada di bucket lama. Tetapi saat lookup, hash baru mengarah ke bucket baru. Secara struktur internal, entry menjadi “tersesat”.

Mental model:

```text
put key(CASE-001)
  hash(CASE-001) -> bucket 5
  entry disimpan di bucket 5

mutate key -> CASE-999

get key(CASE-999)
  hash(CASE-999) -> bucket 12
  cari di bucket 12
  tidak ketemu

entry lama masih di bucket 5, tetapi sekarang key-nya sudah berubah.
```

### 6.1 Rule Praktis

Object yang dipakai sebagai key dalam `HashMap`, element dalam `HashSet`, key cache, key deduplication, atau key visited-set harus memenuhi salah satu dari dua kondisi:

1. Immutable sepenuhnya.
2. Field yang dipakai oleh `equals/hashCode` immutable dan tidak berubah selama object berada dalam collection.

Lebih aman: gunakan value object immutable.

```java
public record CaseKey(String agencyCode, String caseNo) {
    public CaseKey {
        Objects.requireNonNull(agencyCode);
        Objects.requireNonNull(caseNo);
    }
}
```

---

## 7. Identity-Based Structure: `IdentityHashMap`

Normalnya, map memakai logical equality:

```java
Map<CaseId, String> map = new HashMap<>();
```

Tetapi Java juga punya `IdentityHashMap`, yang membandingkan key dengan `==`, bukan `equals()`.

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

### 7.1 Kapan `IdentityHashMap` Masuk Akal?

1. Object graph traversal berdasarkan instance.
2. Serialization/deserialization reference tracking.
3. Deep copy dengan cycle handling.
4. Proxy/wrapper tracking per instance.
5. Debugging object aliasing.

### 7.2 Kapan Berbahaya?

Hampir semua domain key biasa tidak cocok dengan `IdentityHashMap`.

Jangan pakai untuk:

1. `UserId`.
2. `CaseId`.
3. `String` domain key.
4. Cache key external API.
5. Deduplication logical entity.

Jika domain mengatakan “dua case dengan nomor sama adalah case yang sama”, maka identity semantics salah.

---

## 8. Array sebagai Struktur Data Fundamental

Array adalah blok storage dengan ukuran tetap dan indexed access.

```java
int[] numbers = new int[5];
numbers[0] = 10;
```

Mental model:

```text
int[] length=5
index:  0   1   2   3   4
value: 10   0   0   0   0
```

Untuk object array:

```java
Customer[] customers = new Customer[3];
```

Mental model:

```text
Customer[] length=3
index:      0      1      2
value:    null   null   null
```

Setiap slot menyimpan reference, bukan object inline.

Jika diisi:

```java
customers[0] = new Customer("C-001");
```

Model:

```text
Customer[]
  [0] ----> Customer("C-001")
  [1] ----> null
  [2] ----> null
```

---

## 9. Primitive Array vs Object Array

Perbedaan besar:

```java
int[] a = new int[1_000_000];
Integer[] b = new Integer[1_000_000];
```

`int[]` menyimpan nilai primitive secara langsung di array.

```text
int[]
[1][2][3][4]...
```

`Integer[]` menyimpan reference ke object `Integer`.

```text
Integer[]
[ref][ref][ref][ref]...
   |    |    |    |
   v    v    v    v
 Integer objects scattered on heap
```

Konsekuensi:

| Aspek | `int[]` | `Integer[]` |
|---|---|---|
| Storage | nilai langsung | reference ke object |
| Locality | bagus | buruk jika object tersebar |
| Nullability | tidak bisa null | bisa null |
| Boxing | tidak ada | ada/autoboxing |
| Memory overhead | rendah | tinggi |
| Cache friendliness | tinggi | lebih rendah |
| Cocok untuk numeric-heavy algorithm | sangat cocok | sering buruk |

Untuk algoritma seperti DP, graph dengan node integer, prefix sum, heap numeric, bitmask, counting, dan dense index, primitive array biasanya jauh lebih efisien.

---

## 10. Array Equality Trap

Array di Java adalah object. Jika kamu memanggil `equals()` pada array, default-nya berasal dari `Object`, yaitu identity equality.

```java
int[] a = {1, 2, 3};
int[] b = {1, 2, 3};

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // false
```

Untuk element-wise comparison:

```java
System.out.println(Arrays.equals(a, b)); // true
```

Untuk nested array:

```java
int[][] x = {{1, 2}, {3, 4}};
int[][] y = {{1, 2}, {3, 4}};

System.out.println(Arrays.equals(x, y));     // false, shallow for nested arrays
System.out.println(Arrays.deepEquals(x, y)); // true
```

### 10.1 Hashing Array

Sama juga dengan hash:

```java
int[] a = {1, 2, 3};
int[] b = {1, 2, 3};

System.out.println(a.hashCode() == b.hashCode()); // usually false
System.out.println(Arrays.hashCode(a) == Arrays.hashCode(b)); // true
```

Jangan jadikan array mentah sebagai key `HashMap` kecuali kamu memang ingin identity semantics.

Buruk:

```java
Map<int[], String> map = new HashMap<>();
map.put(new int[]{1, 2}, "value");

System.out.println(map.get(new int[]{1, 2})); // null
```

Lebih aman:

```java
public record IntPair(int a, int b) {}

Map<IntPair, String> map = new HashMap<>();
map.put(new IntPair(1, 2), "value");

System.out.println(map.get(new IntPair(1, 2))); // value
```

Atau buat wrapper immutable yang memakai `Arrays.equals/hashCode`.

---

## 11. Copying: Reference Copy, Shallow Copy, Deep Copy

Misal:

```java
List<Customer> a = new ArrayList<>();
a.add(new Customer("C-001", "ACTIVE"));

List<Customer> b = new ArrayList<>(a);
```

`b` adalah list baru, tetapi element di dalamnya masih object yang sama.

```text
a ---> ArrayList A ---> [ref] ----+
                                  |
b ---> ArrayList B ---> [ref] ----+
                                  v
                           Customer object
```

Jika customer dimutasi:

```java
a.get(0).setStatus("SUSPENDED");

System.out.println(b.get(0).getStatus()); // SUSPENDED
```

Ini bukan bug Java. Ini konsekuensi reference semantics.

### 11.1 Shallow Copy

Container baru, element sama.

```java
List<Customer> copy = new ArrayList<>(original);
```

### 11.2 Deep Copy

Container baru, element baru.

```java
List<Customer> copy = original.stream()
        .map(Customer::copy)
        .toList();
```

### 11.3 Defensive Copy

Defensive copy digunakan agar internal collection tidak bisa dimutasi dari luar.

Buruk:

```java
public final class RuleSet {
    private final List<Rule> rules;

    public RuleSet(List<Rule> rules) {
        this.rules = rules;
    }

    public List<Rule> rules() {
        return rules;
    }
}
```

Caller masih bisa mengubah list internal:

```java
List<Rule> external = new ArrayList<>();
RuleSet rs = new RuleSet(external);
external.add(new Rule(...)); // internal RuleSet berubah
```

Lebih aman:

```java
public final class RuleSet {
    private final List<Rule> rules;

    public RuleSet(List<Rule> rules) {
        this.rules = List.copyOf(rules);
    }

    public List<Rule> rules() {
        return rules;
    }
}
```

Catatan penting: `List.copyOf` membuat list unmodifiable, tetapi tidak otomatis deep-copy element. Jika `Rule` mutable, isi rule masih bisa berubah dari reference lain.

---

## 12. `Arrays.asList` Trap

`Arrays.asList(array)` mengembalikan fixed-size list backed by array.

```java
String[] arr = {"A", "B"};
List<String> list = Arrays.asList(arr);

list.set(0, "X");
System.out.println(Arrays.toString(arr)); // [X, B]

list.add("C"); // UnsupportedOperationException
```

Kenapa?

Karena list tersebut view di atas array. Ukurannya fixed mengikuti array. `set` boleh, `add/remove` tidak.

Jika butuh mutable independent list:

```java
List<String> list = new ArrayList<>(Arrays.asList(arr));
```

Jika butuh immutable/unmodifiable snapshot:

```java
List<String> list = List.of(arr);      // hati-hati: varargs behavior
List<String> copy = List.copyOf(Arrays.asList(arr));
```

Untuk primitive array:

```java
int[] arr = {1, 2, 3};
List<int[]> list = Arrays.asList(arr);

System.out.println(list.size()); // 1, bukan 3
```

Karena `int[]` adalah satu object, bukan varargs `Integer` element.

---

## 13. Array Covariance Trap

Java array bersifat covariant.

```java
String[] strings = new String[1];
Object[] objects = strings;
objects[0] = 123; // ArrayStoreException at runtime
```

Secara compile-time, `String[]` bisa dianggap `Object[]`. Tetapi saat runtime, array tetap tahu bahwa element type-nya `String`, sehingga memasukkan `Integer` gagal.

Generic collection tidak covariant seperti itu:

```java
List<String> strings = new ArrayList<>();
// List<Object> objects = strings; // compile error
```

Ini salah satu alasan generic collection lebih type-safe daripada array untuk banyak API umum.

---

## 14. Reference Aliasing

Aliasing terjadi ketika beberapa variable menunjuk object yang sama.

```java
List<String> a = new ArrayList<>();
List<String> b = a;

b.add("X");
System.out.println(a); // [X]
```

Dalam struktur data, aliasing bisa menyebabkan bug yang sulit:

1. Shared mutable list antar aggregate.
2. Shared builder state antar request.
3. Cache value yang dimutasi caller.
4. Internal collection bocor melalui getter.
5. Snapshot yang sebenarnya bukan snapshot.

Contoh domain:

```java
CaseView view = cache.get(caseId);
view.getDocuments().clear();
```

Jika cache mengembalikan object mutable internal, caller bisa merusak cache global.

Solusi:

1. Immutable object.
2. Defensive copy on write/read.
3. Unmodifiable view dengan catatan element tetap bisa mutable.
4. Clear ownership rule: siapa boleh mutate, kapan, dan lewat API apa.

---

## 15. Hashing sebagai Indexing Strategy

Hashing bukan magic. Ia adalah strategi indexing.

Tanpa hash:

```java
boolean contains(List<CaseId> ids, CaseId target) {
    for (CaseId id : ids) {
        if (id.equals(target)) {
            return true;
        }
    }
    return false;
}
```

Cost: `O(n)`.

Dengan hash set:

```java
Set<CaseId> ids = new HashSet<>();
ids.contains(target);
```

Expected cost: mendekati `O(1)` jika hash distribution baik.

Mental model:

```text
key -> hashCode -> bucket index -> candidates -> equals check
```

Hash structure mempercepat pencarian dengan mengurangi search space dari seluruh collection menjadi bucket kecil.

---

## 16. Hash Quality

Hash yang baik menyebarkan key secara merata.

Buruk:

```java
@Override
public int hashCode() {
    return 1;
}
```

Secara contract valid, tetapi semua key masuk bucket yang sama.

```text
bucket[0] -> empty
bucket[1] -> key1 -> key2 -> key3 -> key4 -> ...
bucket[2] -> empty
```

Akibatnya lookup mendekati linear scan.

Lebih baik:

```java
@Override
public int hashCode() {
    return Objects.hash(agencyCode, caseNo);
}
```

Namun `Objects.hash(...)` memakai varargs dan bisa punya overhead allocation kecil. Untuk hot-path key yang sangat sering dipakai, implementasi manual kadang lebih baik:

```java
@Override
public int hashCode() {
    int result = agencyCode.hashCode();
    result = 31 * result + caseNo.hashCode();
    return result;
}
```

Untuk sebagian besar business code, `record` sudah cukup baik dan lebih aman.

---

## 17. Designing Key Objects

Key object yang baik harus:

1. Immutable.
2. Valid sejak construction.
3. Mengandung field minimal yang menentukan identity.
4. Tidak mengandung field volatile/transient seperti timestamp update, status, display name, atau mutable metadata kecuali memang bagian dari identity.
5. Memiliki `equals/hashCode` konsisten.
6. Tidak terlalu besar.
7. Tidak bergantung pada object graph mutable.

Contoh buruk:

```java
public record CaseCacheKey(
        String agency,
        String caseNo,
        String currentStatus,
        Instant lastUpdatedAt
) {}
```

Jika cache seharusnya lookup berdasarkan case identity saja, `currentStatus` dan `lastUpdatedAt` tidak boleh masuk key. Key ini akan menyebabkan cache miss setelah status berubah.

Lebih baik:

```java
public record CaseCacheKey(String agency, String caseNo) {
    public CaseCacheKey {
        agency = normalize(agency);
        caseNo = normalize(caseNo);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("key part must not be blank");
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }
}
```

### 17.1 Normalization Harus Sebelum Hashing

Jika domain key case-insensitive, normalize di constructor.

Buruk:

```java
new CaseKey("cea", "case-001")
new CaseKey("CEA", "CASE-001")
```

Jika tidak dinormalisasi, dua object bisa dianggap berbeda padahal domain menganggap sama.

---

## 18. Equality vs Ordering

Equality dan ordering adalah contract berbeda.

Equality:

```java
boolean equals(Object other)
```

Ordering:

```java
int compareTo(T other)
int compare(T a, T b)
```

Hash-based structure memakai `equals/hashCode`.

Sorted structure seperti `TreeSet` dan `TreeMap` memakai comparator/order.

Masalah muncul jika comparator tidak konsisten dengan equals.

Contoh:

```java
record Person(String id, String name) {}

Comparator<Person> byName = Comparator.comparing(Person::name);
Set<Person> set = new TreeSet<>(byName);

set.add(new Person("1", "Alice"));
set.add(new Person("2", "Alice"));

System.out.println(set.size()); // 1
```

Menurut comparator, dua person dengan name sama dianggap setara, meskipun id berbeda.

Ini bukan bug `TreeSet`. Ini karena comparator mendefinisikan uniqueness untuk sorted set.

Rule:

```text
HashSet uniqueness -> equals/hashCode
TreeSet uniqueness -> comparator compare == 0
```

Bagian ordering akan dibahas lebih dalam di Part 008. Untuk sekarang, cukup pegang invariant ini.

---

## 19. Value Object vs Entity Object

Dalam domain-driven modeling, biasanya ada dua jenis object:

### 19.1 Value Object

Identity ditentukan oleh nilai.

```java
record Money(BigDecimal amount, Currency currency) {}
record CaseId(String value) {}
record PostalCode(String value) {}
```

Jika nilainya sama, object dianggap sama.

Cocok sebagai key jika immutable.

### 19.2 Entity Object

Identity ditentukan oleh id, bukan seluruh field.

```java
public final class Case {
    private final CaseId id;
    private String status;
    private String assignedOfficer;

    // equals/hashCode? hati-hati
}
```

Untuk entity mutable, sering lebih aman **tidak menjadikan entity object langsung sebagai key**. Gunakan id-nya.

Buruk:

```java
Map<Case, WorkflowState> states = new HashMap<>();
```

Lebih baik:

```java
Map<CaseId, WorkflowState> states = new HashMap<>();
```

Kenapa?

Karena entity biasanya berubah. Jika `equals/hashCode` entity melibatkan field mutable, map bisa rusak. Jika hanya berdasarkan id, mungkin aman, tetapi masih sering lebih jelas memakai id sebagai key.

---

## 20. Object Layout dan Memory Footprint

Dalam Java, object biasanya memiliki:

1. Object header.
2. Field data.
3. Padding/alignment.
4. Reference ke object lain.

Spesifik layout bergantung JVM, architecture, compressed ordinary object pointers, alignment, dan runtime options. Karena itu, jangan menebak terlalu percaya diri. Gunakan alat seperti JOL untuk inspeksi.

Contoh JOL:

```java
import org.openjdk.jol.info.ClassLayout;

public class LayoutDemo {
    static final class Point {
        int x;
        int y;
    }

    public static void main(String[] args) {
        System.out.println(ClassLayout.parseClass(Point.class).toPrintable());
    }
}
```

Tujuan bukan menghafal byte-size absolut, karena bisa berbeda antar JVM. Tujuannya memahami bahwa:

1. Object kecil tetap punya overhead.
2. Banyak node object berarti banyak overhead.
3. `LinkedList<Integer>` sangat mahal dibanding `int[]`.
4. `HashMap<K,V>` menyimpan entry/node tambahan, bukan hanya key dan value.
5. Nested object graph punya retained size jauh lebih besar daripada shallow size.

### 20.1 Shallow Size vs Retained Size

Shallow size: ukuran object itu sendiri.

Retained size: ukuran object plus object lain yang hanya bisa dijangkau melalui object tersebut.

Contoh:

```text
ArrayList object shallow kecil
backing Object[] bisa besar
objects yang direferensikan bisa jauh lebih besar
```

Jika kamu hanya melihat shallow size `ArrayList`, kamu akan salah memahami memory cost.

---

## 21. Object Graph Thinking

Setiap struktur data Java bisa dilihat sebagai graph reference.

Contoh `Map<CaseId, CaseView>`:

```text
HashMap
  table[]
    bucket node
      key ----> CaseId
      value --> CaseView
                  documents --> List
                                  elementData[] -> DocumentView
```

Pertanyaan engineering:

1. Siapa owner object ini?
2. Apakah value boleh dimutasi setelah masuk map?
3. Apakah key immutable?
4. Apakah map mencegah object di-GC?
5. Apakah ada cycle?
6. Apakah copy operation hanya copy reference?
7. Apakah exposed getter membocorkan internal graph?

Object graph thinking sangat penting untuk cache, indexing, snapshot, graph traversal, dan memory leak analysis.

---

## 22. Null Semantics

Null adalah state tambahan yang harus diputuskan secara eksplisit.

Array object default-nya null:

```java
String[] names = new String[3];
System.out.println(names[0]); // null
```

Primitive array default-nya zero-like:

```java
int[] nums = new int[3];
System.out.println(nums[0]); // 0
```

HashMap memperbolehkan null key dan null value, tetapi tidak semua map begitu.

Masalah dengan null value:

```java
Map<String, String> map = new HashMap<>();
map.put("A", null);

System.out.println(map.get("A")); // null
System.out.println(map.get("B")); // null
```

`get` tidak bisa membedakan key absent vs key present dengan null value.

Solusi:

```java
if (map.containsKey(key)) {
    String value = map.get(key);
}
```

Atau hindari null value dan gunakan object representasi eksplisit.

Untuk cache, null semantics lebih serius:

1. Absent berarti belum pernah dicari.
2. Present-null berarti hasil pencarian memang tidak ada.
3. Expired berarti dulu ada/tidak ada, tetapi perlu refresh.

Karena itu banyak cache menggunakan sentinel atau `Optional` secara hati-hati.

---

## 23. Practical Pattern: Safe Deduplication

Misal kamu menerima daftar application dari external system dan ingin deduplicate berdasarkan agency + applicationNo.

Buruk:

```java
Set<Application> seen = new HashSet<>();
for (Application app : apps) {
    if (!seen.add(app)) {
        // duplicate
    }
}
```

Ini hanya benar jika `Application.equals/hashCode` memang berdasarkan agency + applicationNo dan field tersebut immutable.

Lebih eksplisit:

```java
record ApplicationKey(String agency, String applicationNo) {
    ApplicationKey {
        agency = normalize(agency);
        applicationNo = normalize(applicationNo);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("blank key");
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }
}

Set<ApplicationKey> seen = new HashSet<>();
List<Application> duplicates = new ArrayList<>();

for (Application app : apps) {
    ApplicationKey key = new ApplicationKey(app.agency(), app.applicationNo());
    if (!seen.add(key)) {
        duplicates.add(app);
    }
}
```

Kelebihan:

1. Identity dedup jelas.
2. Tidak bergantung pada equality entity besar.
3. Normalization terkonsentrasi.
4. Lebih mudah dites.
5. Lebih aman terhadap mutation di `Application`.

---

## 24. Practical Pattern: Index by ID

Jika operation sering lookup by id, jangan linear scan.

Buruk:

```java
Case findById(List<Case> cases, CaseId id) {
    for (Case c : cases) {
        if (c.id().equals(id)) {
            return c;
        }
    }
    return null;
}
```

Jika dipanggil berkali-kali, bisa menjadi `O(n*m)`.

Lebih baik:

```java
Map<CaseId, Case> byId = new HashMap<>();
for (Case c : cases) {
    Case previous = byId.put(c.id(), c);
    if (previous != null) {
        throw new IllegalStateException("Duplicate case id: " + c.id());
    }
}
```

Sekarang lookup:

```java
Case c = byId.get(id);
```

Tetapi invariant-nya harus jelas:

1. `CaseId` immutable.
2. Tidak boleh duplicate id.
3. Jika `Case.id()` bisa berubah, index menjadi stale.
4. Jika list berubah, index harus ikut di-update atau dibuat snapshot.

Top-tier engineer tidak hanya membuat map. Ia mendefinisikan ownership dan lifecycle index.

---

## 25. Practical Pattern: Snapshot Index

Kadang data sering dibaca tetapi jarang berubah, misalnya workflow definition atau rule config.

Kita bisa buat immutable snapshot:

```java
public final class WorkflowSnapshot {
    private final Map<State, List<Transition>> transitionsByState;

    public WorkflowSnapshot(List<Transition> transitions) {
        Map<State, List<Transition>> mutable = new EnumMap<>(State.class);

        for (Transition t : transitions) {
            mutable.computeIfAbsent(t.from(), ignored -> new ArrayList<>())
                    .add(t);
        }

        Map<State, List<Transition>> frozen = new EnumMap<>(State.class);
        for (Map.Entry<State, List<Transition>> entry : mutable.entrySet()) {
            frozen.put(entry.getKey(), List.copyOf(entry.getValue()));
        }

        this.transitionsByState = Collections.unmodifiableMap(frozen);
    }

    public List<Transition> transitionsFrom(State state) {
        return transitionsByState.getOrDefault(state, List.of());
    }
}
```

Keuntungan:

1. Read path cepat.
2. Tidak perlu lock untuk pembacaan jika snapshot dipublikasikan dengan aman.
3. Internal collection tidak bisa dimutasi sembarangan.
4. Invariant dibangun sekali di constructor.

Catatan: `Transition` juga sebaiknya immutable.

---

## 26. Practical Pattern: Graph Visited Set

Saat traversal graph, visited set menentukan correctness.

Jika node punya stable id:

```java
Set<NodeId> visited = new HashSet<>();
```

Jika traversal berdasarkan object identity karena graph object bisa memiliki dua node logical equal tetapi instance berbeda:

```java
Set<Node> visited = Collections.newSetFromMap(new IdentityHashMap<>());
```

Pilihannya harus sadar.

Contoh cycle detection object graph serializer:

```java
Set<Object> visiting = Collections.newSetFromMap(new IdentityHashMap<>());
```

Contoh workflow state graph:

```java
Set<State> visited = EnumSet.noneOf(State.class);
```

Untuk enum, `EnumSet` sering jauh lebih efisien daripada `HashSet<Enum>` karena secara konseptual bisa direpresentasikan sebagai bit vector.

---

## 27. Checklist Mendesain Equality dan Hashing

Gunakan checklist ini sebelum membuat object yang akan masuk map/set/cache/index.

### 27.1 Untuk Value Object

1. Apakah semua field identity immutable?
2. Apakah constructor memvalidasi null/blank/range?
3. Apakah normalization dilakukan sebelum disimpan?
4. Apakah `equals/hashCode` memakai field yang sama?
5. Apakah ada array field? Jika ada, apakah memakai defensive copy dan `Arrays.equals/hashCode`?
6. Apakah ada collection field? Jika ada, apakah collection immutable?
7. Apakah field order penting?
8. Apakah case-sensitive/case-insensitive sudah jelas?
9. Apakah timezone/locale memengaruhi identity?
10. Apakah object terlalu besar untuk dijadikan key?

### 27.2 Untuk Entity

1. Apakah entity perlu override `equals/hashCode`?
2. Jika iya, apakah cukup berdasarkan immutable id?
3. Apakah id bisa null sebelum persist?
4. Apakah entity akan dipakai sebagai key map/set?
5. Apakah lifecycle entity membuat equality berubah?
6. Apakah lebih aman memakai `EntityId` sebagai key?

### 27.3 Untuk Array

1. Apakah array dipakai sebagai value sementara atau key?
2. Jika key, apakah sudah dibungkus immutable wrapper?
3. Apakah array akan dimutasi setelah disimpan?
4. Apakah comparison butuh `Arrays.equals` atau `Arrays.deepEquals`?
5. Apakah copy perlu shallow atau deep?

---

## 28. Common Failure Modes

### 28.1 Override `equals` Tanpa `hashCode`

Gejala:

1. `HashSet` berisi duplicate logical object.
2. `HashMap.get` gagal padahal key “sama”.
3. Deduplication gagal.

### 28.2 Mutable Key

Gejala:

1. Entry map tidak bisa ditemukan setelah field key berubah.
2. Cache miss misterius.
3. Memory leak karena entry tidak pernah terhapus dengan key baru.

### 28.3 Array sebagai Key

Gejala:

1. `map.get(new int[]{...})` selalu null.
2. Duplicate key logical masuk map.

### 28.4 Comparator Tidak Konsisten dengan Domain Uniqueness

Gejala:

1. `TreeSet` menghapus data yang dianggap berbeda oleh domain.
2. `TreeMap.put` overwrite value tanpa disadari.

### 28.5 Exposed Mutable Internal Collection

Gejala:

1. Invariant object rusak dari luar.
2. Cache value berubah setelah dikembalikan ke caller.
3. Snapshot ternyata bukan snapshot.

### 28.6 Hash Buruk

Gejala:

1. Expected `O(1)` lookup menjadi lambat.
2. Latency spike saat banyak collision.
3. CPU tinggi di map/set operation.

---

## 29. Mini Case Study: Cache Key External API

Misal ada external postal-code API. Request:

```text
postalCode=123456
country=SG
```

Kita ingin cache response.

Buruk:

```java
Map<Map<String, String>, ApiResponse> cache = new HashMap<>();
```

Masalah:

1. Key map mutable.
2. Normalization tidak jelas.
3. Field optional bisa tidak konsisten.
4. Sulit dites.

Lebih baik:

```java
public record AddressLookupKey(String country, String postalCode) {
    public AddressLookupKey {
        country = normalizeCountry(country);
        postalCode = normalizePostalCode(postalCode);
    }

    private static String normalizeCountry(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("country must not be blank");
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }

    private static String normalizePostalCode(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("postalCode must not be blank");
        }
        return value.trim();
    }
}
```

Pemakaian:

```java
Map<AddressLookupKey, ApiResponse> cache = new HashMap<>();
AddressLookupKey key = new AddressLookupKey("sg", "123456");
ApiResponse response = cache.get(key);
```

Jika cache concurrent, struktur map-nya berubah, tetapi key design tetap sama pentingnya.

---

## 30. Mini Case Study: Workflow Transition Index

Misal workflow memiliki transition:

```java
record Transition(State from, State to, Action action) {}
```

Kita butuh mencari transition valid dari state tertentu.

Buruk:

```java
List<Transition> transitions = ...;

List<Transition> findFrom(State state) {
    return transitions.stream()
            .filter(t -> t.from() == state)
            .toList();
}
```

Jika dipanggil sering, linear scan terus-menerus.

Lebih baik:

```java
public final class TransitionIndex {
    private final Map<State, List<Transition>> byFrom;

    public TransitionIndex(List<Transition> transitions) {
        EnumMap<State, List<Transition>> temp = new EnumMap<>(State.class);

        for (Transition transition : transitions) {
            temp.computeIfAbsent(transition.from(), ignored -> new ArrayList<>())
                    .add(transition);
        }

        EnumMap<State, List<Transition>> frozen = new EnumMap<>(State.class);
        for (Map.Entry<State, List<Transition>> entry : temp.entrySet()) {
            frozen.put(entry.getKey(), List.copyOf(entry.getValue()));
        }

        this.byFrom = Collections.unmodifiableMap(frozen);
    }

    public List<Transition> from(State state) {
        return byFrom.getOrDefault(state, List.of());
    }
}
```

Kenapa `EnumMap`?

Karena key `State` adalah enum. `EnumMap` dirancang untuk enum key dan biasanya lebih compact/efficient daripada `HashMap` untuk kasus ini.

DSA thinking-nya:

1. Operation dominan: lookup by `from` state.
2. Key domain: enum.
3. Mutation: workflow definition jarang berubah.
4. Solution: immutable snapshot index.
5. Failure prevention: no external mutation.

---

## 31. Implementation Exercise

### Exercise 1 — Safe Pair Key

Buat `record PairKey(String left, String right)` dengan aturan:

1. `left` dan `right` tidak boleh null/blank.
2. Trim whitespace.
3. Case-insensitive.
4. Cocok dipakai sebagai key `HashMap`.

Expected direction:

```java
public record PairKey(String left, String right) {
    public PairKey {
        left = normalize(left);
        right = normalize(right);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("key part must not be blank");
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }
}
```

### Exercise 2 — Array Wrapper Key

Buat wrapper immutable untuk `int[]` agar bisa dipakai sebagai key map.

Expected direction:

```java
public final class IntArrayKey {
    private final int[] values;

    public IntArrayKey(int[] values) {
        this.values = Objects.requireNonNull(values).clone();
    }

    public int[] values() {
        return values.clone();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof IntArrayKey that
                && Arrays.equals(values, that.values);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(values);
    }

    @Override
    public String toString() {
        return Arrays.toString(values);
    }
}
```

Kenapa clone di constructor dan getter?

1. Constructor clone mencegah caller mengubah array setelah key dibuat.
2. Getter clone mencegah caller mengubah internal array.

### Exercise 3 — Detect Mutable Key Bug

Analisis kode ini:

```java
record UserKey(String tenant, String username) {}

class User {
    private UserKey key;
    private String displayName;

    // getter/setter
}

Map<User, Session> sessions = new HashMap<>();
```

Pertanyaan:

1. Apakah aman memakai `User` sebagai key?
2. Apa syarat agar aman?
3. Apa desain yang lebih baik?

Jawaban yang diharapkan:

1. Tidak aman jika `User.equals/hashCode` melibatkan field mutable atau tidak jelas.
2. Aman hanya jika equality berdasarkan immutable stable identity dan tidak berubah selama berada di map.
3. Lebih baik `Map<UserKey, Session>`.

---

## 32. Testing Strategy

Untuk object yang menjadi key, test minimal:

```java
@Test
void equalObjectsMustHaveSameHashCode() {
    CaseKey a = new CaseKey("cea", "case-001");
    CaseKey b = new CaseKey("CEA", "CASE-001");

    assertEquals(a, b);
    assertEquals(a.hashCode(), b.hashCode());
}
```

Test map behavior:

```java
@Test
void keyMustWorkInHashMap() {
    CaseKey a = new CaseKey("cea", "case-001");
    CaseKey b = new CaseKey("CEA", "CASE-001");

    Map<CaseKey, String> map = new HashMap<>();
    map.put(a, "value");

    assertEquals("value", map.get(b));
}
```

Test defensive copy:

```java
@Test
void arrayKeyMustBeImmutableAgainstCallerMutation() {
    int[] raw = {1, 2, 3};
    IntArrayKey key = new IntArrayKey(raw);

    Map<IntArrayKey, String> map = new HashMap<>();
    map.put(key, "value");

    raw[0] = 999;

    assertEquals("value", map.get(new IntArrayKey(new int[]{1, 2, 3})));
}
```

Testing equality bukan formalitas. Ia adalah regression guard untuk semua struktur data hash-based.

---

## 33. Design Heuristics

Gunakan heuristik berikut:

1. Untuk key map, default ke immutable value object.
2. Untuk entity mutable, pakai id sebagai key, bukan entity object.
3. Untuk enum key, pertimbangkan `EnumMap` atau `EnumSet`.
4. Untuk array key, jangan pakai array langsung; wrap dengan immutable class.
5. Untuk deduplication, buat key eksplisit sesuai domain uniqueness.
6. Untuk cache, bedakan identity key, query key, dan response value.
7. Untuk snapshot, copy container dan pastikan element juga aman.
8. Untuk hot numeric algorithm, gunakan primitive array jika memungkinkan.
9. Untuk object graph traversal, tentukan apakah visited berdasarkan identity atau logical equality.
10. Untuk performance, jangan hanya lihat Big-O; lihat allocation, object count, reference chasing, dan hash quality.

---

## 34. Ringkasan

Fondasi DSA Java adalah pemahaman bahwa collection menyimpan reference, bukan value abstrak. Dari situ muncul banyak konsekuensi:

1. `==` mengecek identity, `equals()` mengecek logical equality.
2. `equals()` dan `hashCode()` adalah contract utama hash-based structure.
3. Object mutable berbahaya sebagai key jika field equality/hash bisa berubah.
4. Array punya identity equality secara default; gunakan `Arrays.equals/hashCode` untuk element-wise semantics.
5. Primitive array jauh lebih compact dan cache-friendly dibanding object array untuk numeric-heavy workload.
6. Copy collection biasanya shallow copy.
7. Defensive copy penting untuk menjaga invariant.
8. Hashing adalah indexing strategy, bukan magic `O(1)` guarantee.
9. Key design harus eksplisit, immutable, normalized, dan sesuai domain uniqueness.
10. Top-tier engineer tidak hanya bertanya “pakai map atau list?”, tetapi juga “apa identity-nya, siapa owner-nya, kapan berubah, bagaimana invariant dijaga, dan apa failure mode-nya?”

---

## 35. Checklist Cepat Sebelum Lanjut

Sebelum masuk Part 003, pastikan kamu bisa menjelaskan:

1. Perbedaan identity dan equality.
2. Kenapa `equals true` harus imply `hashCode sama`.
3. Kenapa mutable key membuat `HashMap` gagal lookup.
4. Kenapa `int[]` tidak cocok langsung sebagai key map.
5. Perbedaan shallow copy dan deep copy.
6. Kenapa `Arrays.asList(intArray)` menghasilkan list berukuran 1.
7. Kenapa `TreeSet` uniqueness ditentukan comparator, bukan `equals` saja.
8. Kenapa entity mutable lebih aman di-index dengan id object.
9. Kenapa object count penting untuk memory dan performance.
10. Bagaimana mendesain cache key yang benar.

---

## 36. Referensi

Referensi utama untuk bagian ini:

1. Java SE API Specification — `Object.equals` dan `Object.hashCode` contract.
2. Java SE API Specification — `Map` contract dan hash-based collection behavior.
3. Java SE API Specification — `Arrays` utility untuk array manipulation, equality, hashing, sorting, dan searching.
4. OpenJDK JOL — Java Object Layout tooling untuk menganalisis object layout, footprint, dan reference graph.
5. Java Collections Framework documentation untuk memahami hubungan antara collection interface, implementation, equality, hashing, dan algorithmic behavior.

---

## Status Seri

Part ini adalah **Part 002 dari 030**.

Seri **belum selesai**. Berikutnya:

**Part 003 — Arrays, Dynamic Arrays, ArrayList, dan Cost Model-nya**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 001 — Complexity Analysis yang Realistis di Java](./learn-java-dsa-part-001.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 003 — Arrays, Dynamic Arrays, `ArrayList`, dan Cost Model-nya](./learn-java-dsa-part-003.md)
