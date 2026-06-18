# learn-java-dsa-part-022.md

# Part 022 — Bit Manipulation, `BitSet`, Bloom Filter

> Seri: Java Data Structure and Algorithm Advanced  
> Status seri: **belum selesai** — ini adalah Part 022 dari 030.  
> Fokus: memahami bit-level representation sebagai struktur data compact, bukan sekadar trik low-level.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membahas teknik linear-time seperti sliding window, two pointers, prefix sum, dan difference array. Semua teknik itu punya satu ide besar: **mengubah bentuk data supaya operasi mahal menjadi murah**.

Part ini melanjutkan ide tersebut dari sudut pandang yang lebih rendah: **representasi bit**.

Banyak engineer melihat bit manipulation sebagai “trik interview”. Itu framing yang terlalu sempit. Di production system, bit-level representation muncul dalam bentuk:

- permission flags,
- feature flags,
- eligibility flags,
- compact visited set,
- dense boolean vector,
- bitmap index,
- bloom filter,
- dedup prefilter,
- approximate membership,
- compressed set representation,
- fast set operation seperti intersection/union/difference.

Target part ini bukan membuat kita menghafal trik `x & (x - 1)`. Targetnya adalah membangun mental model:

> Bit-level data structure adalah cara merepresentasikan banyak boolean state secara compact dan operasi set secara word-level, bukan element-level.

Setelah menyelesaikan part ini, kamu harus mampu:

1. membaca integer sebagai kumpulan bit,
2. memakai bit mask secara aman,
3. memahami operasi set berbasis bit,
4. memilih antara `boolean[]`, `Set<Integer>`, `EnumSet`, `BitSet`, dan Bloom filter,
5. memahami false positive pada Bloom filter,
6. menghindari bug Java-specific seperti signed shift, overflow, dan ordinal coupling,
7. mendesain struktur compact untuk visited set, permission flags, dedup, dan prefilter.

---

## 1. Mental Model: Bit sebagai Boolean Slot

Satu bit hanya punya dua nilai:

```text
0 = false / absent / disabled / not visited
1 = true  / present / enabled  / visited
```

Satu `int` punya 32 bit. Satu `long` punya 64 bit.

Artinya, satu `long` bisa menyimpan 64 boolean state.

```text
long mask = 0b0000...0000
              ^ bit 0
             ^  bit 1
            ^   bit 2
```

Jika kita punya 64 permission, tidak wajib memakai:

```java
Set<Permission> permissions;
```

atau:

```java
boolean[] permissions = new boolean[64];
```

Kita bisa memakai:

```java
long permissionsMask;
```

Tetapi ini bukan berarti bit mask selalu lebih baik. Ia lebih compact dan cepat untuk beberapa operasi, tetapi lebih sulit dibaca, lebih mudah salah, dan kurang fleksibel bila domain berubah.

Mental model paling penting:

> Bit mask adalah set kecil yang direpresentasikan sebagai integer.

Jika bit ke-`i` bernilai `1`, berarti elemen `i` ada di dalam set.

---

## 2. Bit Numbering dan Posisi

Untuk integer biner:

```text
value = 13
binary = 1101
```

Dari kanan ke kiri:

```text
bit index: 3 2 1 0
bit value: 1 1 0 1
```

Maka:

```text
13 = 8 + 4 + 1
   = 2^3 + 2^2 + 2^0
```

Bit paling kanan disebut **least significant bit**. Bit paling kiri dalam fixed-width representation disebut **most significant bit**.

Untuk Java:

- `int` = 32-bit signed two's complement,
- `long` = 64-bit signed two's complement,
- operasi bit tetap bekerja pada pola bit,
- tetapi interpretasi numeric bisa menjadi negatif jika sign bit aktif.

Contoh:

```java
int x = 1 << 31;
System.out.println(x); // negative number
```

Ini bukan karena bit operation gagal. Ini karena bit ke-31 adalah sign bit pada `int` signed.

---

## 3. Operasi Bit Dasar

### 3.1 AND `&`

`AND` menghasilkan `1` hanya jika kedua bit `1`.

```text
  1101
& 1011
= 1001
```

Dipakai untuk:

- test bit,
- intersection set,
- masking.

Contoh:

```java
boolean enabled = (flags & FEATURE_X) != 0;
```

### 3.2 OR `|`

`OR` menghasilkan `1` jika salah satu bit `1`.

```text
  1101
| 1011
= 1111
```

Dipakai untuk:

- set bit,
- union set,
- combine flags.

Contoh:

```java
flags = flags | FEATURE_X;
```

atau idiom umum:

```java
flags |= FEATURE_X;
```

### 3.3 XOR `^`

`XOR` menghasilkan `1` jika kedua bit berbeda.

```text
  1101
^ 1011
= 0110
```

Dipakai untuk:

- toggle bit,
- symmetric difference,
- parity,
- beberapa algorithmic trick.

Contoh:

```java
flags ^= FEATURE_X; // toggle
```

### 3.4 NOT `~`

`NOT` membalik semua bit.

```text
~0000...0101 = 1111...1010
```

Di Java, karena integer signed fixed-width, hasil `~x` sering terlihat negatif.

Contoh:

```java
System.out.println(~0); // -1
```

Karena semua bit menjadi `1`, dan pada two's complement itu adalah `-1`.

### 3.5 Shift Left `<<`

Menggeser bit ke kiri.

```java
1 << 3 == 8
```

Secara mental:

```text
0001 << 3 = 1000
```

Dipakai untuk membuat mask:

```java
int mask = 1 << bitIndex;
```

### 3.6 Signed Shift Right `>>`

Menggeser ke kanan sambil mempertahankan sign bit.

```java
int x = -8;
int y = x >> 1;
```

Karena `x` negatif, bit paling kiri tetap diisi `1`.

### 3.7 Unsigned Shift Right `>>>`

Menggeser ke kanan dengan mengisi bit kiri dengan `0`.

```java
int x = -8;
int y = x >>> 1;
```

Ini penting ketika kita ingin memperlakukan `int` sebagai unsigned bit pattern.

---

## 4. Operasi Mask: Set, Clear, Toggle, Test

Misalkan kita punya bit index:

```java
int i = 5;
long bit = 1L << i;
```

### 4.1 Set Bit

```java
mask |= bit;
```

Artinya: aktifkan bit ke-`i`.

### 4.2 Clear Bit

```java
mask &= ~bit;
```

Artinya: matikan bit ke-`i`.

### 4.3 Toggle Bit

```java
mask ^= bit;
```

Artinya: jika bit `0` menjadi `1`, jika `1` menjadi `0`.

### 4.4 Test Bit

```java
boolean isSet = (mask & bit) != 0;
```

### 4.5 Put Bit Berdasarkan Boolean

```java
static long setBit(long mask, int index, boolean value) {
    long bit = 1L << index;
    if (value) {
        return mask | bit;
    }
    return mask & ~bit;
}
```

### 4.6 Validasi Index

Untuk `long`, index valid adalah `0..63`.

```java
static void checkLongBitIndex(int index) {
    if (index < 0 || index >= Long.SIZE) {
        throw new IllegalArgumentException("bit index out of range: " + index);
    }
}
```

Jangan membiarkan index liar masuk ke shift expression. Java melakukan masking pada shift distance untuk `int` dan `long`, sehingga behavior bisa mengejutkan.

Contoh:

```java
1 << 32
```

bukan menghasilkan bit ke-32 pada `int`. Shift distance untuk `int` efektif memakai 5 bit rendah, sehingga `32` efektif menjadi `0`.

Karena itu untuk mask `long`, gunakan `1L << index`, bukan `1 << index`.

---

## 5. Bit Mask sebagai Set Kecil

Katakan kita punya fitur:

```java
enum Feature {
    SEARCH,
    EXPORT,
    APPROVE,
    ARCHIVE
}
```

Satu pendekatan:

```java
EnumSet<Feature> features = EnumSet.of(Feature.SEARCH, Feature.EXPORT);
```

Pendekatan manual bit mask:

```java
final class FeatureBits {
    static final long SEARCH  = 1L << 0;
    static final long EXPORT  = 1L << 1;
    static final long APPROVE = 1L << 2;
    static final long ARCHIVE = 1L << 3;

    private FeatureBits() {}
}
```

Penggunaan:

```java
long features = 0;
features |= FeatureBits.SEARCH;
features |= FeatureBits.EXPORT;

boolean canExport = (features & FeatureBits.EXPORT) != 0;
```

Mental model:

```text
features = {SEARCH, EXPORT}
mask     = 0011
```

Union:

```java
long combined = userFeatures | roleFeatures;
```

Intersection:

```java
long common = userFeatures & requiredFeatures;
```

Difference:

```java
long missing = requiredFeatures & ~userFeatures;
```

Subset check:

```java
boolean hasAllRequired = (userFeatures & requiredFeatures) == requiredFeatures;
```

Any overlap:

```java
boolean hasAnyRequired = (userFeatures & requiredFeatures) != 0;
```

Ini adalah operasi set yang sangat cepat karena bekerja per machine word, bukan per object.

---

## 6. Java-Specific: `EnumSet` Sebelum Manual Bit Mask

Untuk enum, default pilihan yang sangat baik adalah `EnumSet`.

```java
EnumSet<Feature> features = EnumSet.of(Feature.SEARCH, Feature.EXPORT);
```

Kenapa?

Karena `EnumSet`:

- type-safe,
- readable,
- compact,
- internally represented as bit vector,
- lebih mudah dirawat daripada manual mask,
- menghindari coupling eksplisit ke magic bit position.

Manual bit mask layak jika:

- data harus disimpan sebagai numeric mask di database/protocol,
- butuh interop dengan sistem eksternal,
- ingin menghindari object allocation tertentu,
- jumlah flag kecil dan sangat hot-path,
- formatnya sudah fixed.

Tetapi hati-hati: jika memakai enum ordinal sebagai bit position:

```java
long bit = 1L << feature.ordinal();
```

maka perubahan urutan enum dapat mengubah meaning data yang sudah persisted.

Ini berbahaya untuk data yang disimpan di database.

Lebih aman:

```java
enum Feature {
    SEARCH(0),
    EXPORT(1),
    APPROVE(2),
    ARCHIVE(3);

    private final int bitIndex;

    Feature(int bitIndex) {
        this.bitIndex = bitIndex;
    }

    long bit() {
        return 1L << bitIndex;
    }
}
```

Dengan begitu urutan deklarasi bisa berubah tanpa mengubah encoding.

---

## 7. `boolean[]` vs `BitSet` vs `Set<Integer>` vs `long`

Pilihan struktur data sangat tergantung bentuk data.

### 7.1 `long` Mask

Cocok untuk:

- jumlah flag <= 64,
- fixed schema,
- operasi set sederhana,
- domain kecil,
- hot path,
- persistence numeric.

Kelebihan:

- sangat compact,
- tidak ada object per element,
- operasi union/intersection sangat cepat,
- mudah disimpan sebagai `BIGINT`.

Kekurangan:

- kurang self-documenting,
- maksimum 64 flag,
- raw bit manipulation mudah salah,
- schema evolution harus hati-hati.

### 7.2 `boolean[]`

Cocok untuk:

- dense boolean index,
- index kecil/menengah,
- butuh direct access sederhana,
- readability lebih penting daripada compactness.

Kelebihan:

- mudah dipahami,
- akses `O(1)`,
- tidak perlu bit math.

Kekurangan:

- satu boolean array element tidak berarti hanya satu bit secara conceptual memory-level,
- lebih boros daripada bitset,
- tidak punya operasi set word-level bawaan.

### 7.3 `BitSet`

Cocok untuk:

- banyak boolean indexed by non-negative int,
- dense atau semi-dense set,
- butuh operasi `and`, `or`, `xor`, `andNot`,
- visited set compact,
- bitmap index sederhana,
- set operation cepat.

Kelebihan:

- grows as needed,
- compact,
- operasi set tersedia,
- API jelas.

Kekurangan:

- hanya index non-negative integer,
- tidak menyimpan domain key langsung,
- sparse huge index bisa boros jika index maksimum sangat besar,
- tidak thread-safe untuk concurrent mutation tanpa koordinasi eksternal.

### 7.4 `Set<Integer>`

Cocok untuk:

- sparse set,
- index tidak rapat,
- data tidak terlalu besar,
- readability dan fleksibilitas lebih penting,
- tidak butuh operasi bit-level.

Kelebihan:

- mudah dipakai,
- cocok untuk sparse keys,
- tidak tergantung max index.

Kekurangan:

- overhead object/boxing besar,
- hashing overhead,
- operasi set lebih mahal,
- GC pressure lebih tinggi.

### 7.5 Rule of Thumb

| Kondisi | Pilihan Awal |
|---|---|
| <= 64 fixed flags | `long` atau `EnumSet` |
| Enum flags | `EnumSet` |
| Dense non-negative integer set | `BitSet` |
| Sparse integer set | `Set<Integer>` atau primitive specialized set |
| Need persisted numeric permission mask | explicit `long` mask |
| Need readable domain permission set | `EnumSet<Permission>` |
| Need probabilistic prefilter | Bloom filter |

---

## 8. `BitSet` Deep Dive

`BitSet` adalah vector bit yang tumbuh sesuai kebutuhan. Bit-nya di-index dengan non-negative integer. Secara API, bit bisa diperiksa, di-set, di-clear, dan satu `BitSet` dapat digabungkan dengan `BitSet` lain melalui operasi logical seperti AND, OR, dan XOR.

Contoh dasar:

```java
BitSet visited = new BitSet();

visited.set(10);
visited.set(42);

System.out.println(visited.get(10)); // true
System.out.println(visited.get(11)); // false

visited.clear(10);
```

### 8.1 `BitSet` sebagai Set Integer

```java
BitSet set = new BitSet();
set.set(1);
set.set(3);
set.set(5);

for (int i = set.nextSetBit(0); i >= 0; i = set.nextSetBit(i + 1)) {
    System.out.println(i);
}
```

`nextSetBit` penting karena kita tidak perlu scan semua index manual.

### 8.2 Union

```java
BitSet a = new BitSet();
a.set(1);
a.set(3);

BitSet b = new BitSet();
b.set(3);
b.set(4);

BitSet union = (BitSet) a.clone();
union.or(b);

// union = {1, 3, 4}
```

### 8.3 Intersection

```java
BitSet intersection = (BitSet) a.clone();
intersection.and(b);

// intersection = {3}
```

### 8.4 Difference

```java
BitSet difference = (BitSet) a.clone();
difference.andNot(b);

// difference = {1}
```

### 8.5 Symmetric Difference

```java
BitSet symmetric = (BitSet) a.clone();
symmetric.xor(b);

// symmetric = {1, 4}
```

### 8.6 Cardinality

```java
int count = set.cardinality();
```

Ini menghitung jumlah bit yang aktif.

### 8.7 Size vs Length

`BitSet` punya beberapa konsep yang sering membingungkan:

- `length()` = index tertinggi yang set + 1,
- `isEmpty()` = tidak ada bit aktif,
- `cardinality()` = jumlah bit aktif,
- internal capacity bukan hal yang biasanya kita andalkan.

Contoh:

```java
BitSet bits = new BitSet();
bits.set(1000);

System.out.println(bits.length());      // 1001
System.out.println(bits.cardinality()); // 1
```

Artinya hanya satu bit aktif, tetapi posisi tertingginya 1000.

---

## 9. `BitSet` untuk Visited Set

Dalam graph traversal dengan node ID dense `0..n-1`, `BitSet` sering lebih compact daripada `boolean[]` atau `HashSet<Integer>`.

```java
static List<Integer> bfs(List<List<Integer>> graph, int start) {
    int n = graph.size();
    BitSet visited = new BitSet(n);
    ArrayDeque<Integer> queue = new ArrayDeque<>();
    ArrayList<Integer> order = new ArrayList<>();

    visited.set(start);
    queue.addLast(start);

    while (!queue.isEmpty()) {
        int node = queue.removeFirst();
        order.add(node);

        for (int next : graph.get(node)) {
            if (!visited.get(next)) {
                visited.set(next);
                queue.addLast(next);
            }
        }
    }

    return order;
}
```

Jika node ID dense, ini bagus.

Jika node ID sparse seperti:

```text
1000000001, 9000000007, 429496729
```

maka jangan langsung memakai `BitSet` berdasarkan ID asli. Lakukan coordinate compression dulu:

```text
1000000001 -> 0
9000000007 -> 1
429496729  -> 2
```

Lalu pakai index compressed.

---

## 10. Coordinate Compression untuk `BitSet`

`BitSet` bagus untuk index non-negative yang relatif dense. Jika domain key sparse, kita butuh mapping.

```java
final class IdIndex {
    private final Map<Long, Integer> idToIndex = new HashMap<>();
    private final ArrayList<Long> indexToId = new ArrayList<>();

    int indexOf(long id) {
        Integer existing = idToIndex.get(id);
        if (existing != null) {
            return existing;
        }

        int index = indexToId.size();
        idToIndex.put(id, index);
        indexToId.add(id);
        return index;
    }

    long idAt(int index) {
        return indexToId.get(index);
    }

    int size() {
        return indexToId.size();
    }
}
```

Penggunaan:

```java
IdIndex index = new IdIndex();
BitSet selected = new BitSet();

long caseId = 9000000007L;
selected.set(index.indexOf(caseId));
```

Trade-off:

- `BitSet` memberi compact set operation,
- `HashMap` tetap diperlukan untuk mapping dari domain ID ke dense index,
- lifecycle mapping harus jelas.

Untuk snapshot immutable, mapping harus tidak berubah setelah dibangun.

---

## 11. BitSet sebagai Bitmap Index

Misalkan kita punya case records:

```java
record CaseRecord(int id, String state, String officer) {}
```

Kita ingin query cepat:

```text
state = OPEN AND officer = alice
```

Dengan bitmap index:

```text
state:OPEN     -> BitSet of row indexes
state:CLOSED   -> BitSet of row indexes
officer:alice  -> BitSet of row indexes
officer:bob    -> BitSet of row indexes
```

Query `OPEN AND alice`:

```java
BitSet result = (BitSet) stateOpen.clone();
result.and(officerAlice);
```

Ini sangat cepat untuk analytic/filter workload karena operasi `AND` bekerja word-by-word.

Contoh sederhana:

```java
final class CaseBitmapIndex {
    private final Map<String, BitSet> byState = new HashMap<>();
    private final Map<String, BitSet> byOfficer = new HashMap<>();
    private final ArrayList<CaseRecord> rows = new ArrayList<>();

    void add(CaseRecord record) {
        int row = rows.size();
        rows.add(record);

        byState.computeIfAbsent(record.state(), ignored -> new BitSet()).set(row);
        byOfficer.computeIfAbsent(record.officer(), ignored -> new BitSet()).set(row);
    }

    List<CaseRecord> findByStateAndOfficer(String state, String officer) {
        BitSet stateBits = byState.get(state);
        BitSet officerBits = byOfficer.get(officer);

        if (stateBits == null || officerBits == null) {
            return List.of();
        }

        BitSet result = (BitSet) stateBits.clone();
        result.and(officerBits);

        ArrayList<CaseRecord> matches = new ArrayList<>();
        for (int i = result.nextSetBit(0); i >= 0; i = result.nextSetBit(i + 1)) {
            matches.add(rows.get(i));
        }
        return matches;
    }
}
```

Ini bukan pengganti database index. Tapi ini pattern yang sangat berguna untuk:

- in-memory rule engine,
- search filter kecil/menengah,
- eligibility engine,
- snapshot analytics,
- precomputed domain view.

Invariant penting:

> Row index harus stabil selama bitmap index dipakai.

Jika kita menghapus row dari tengah `rows`, semua index setelahnya bergeser dan bitmap menjadi salah.

Solusi:

- gunakan append-only rows,
- gunakan tombstone,
- rebuild snapshot,
- atau pakai stable dense ID.

---

## 12. Bit Operations sebagai Set Algebra

Bitset operations cocok dipikirkan sebagai aljabar set.

Misalkan:

```text
A = eligible by age
B = eligible by license
C = excluded by sanction
```

Maka:

```text
eligible = A ∩ B - C
```

Dengan `BitSet`:

```java
BitSet eligible = (BitSet) ageEligible.clone();
eligible.and(licenseEligible);
eligible.andNot(sanctioned);
```

Ini sering lebih jelas jika diberi nama domain yang baik.

Buruk:

```java
x.and(y);
x.andNot(z);
```

Lebih baik:

```java
BitSet candidates = copy(ageEligibleCases);
candidates.and(casesWithValidLicense);
candidates.andNot(casesUnderSanction);
```

Bit-level code harus dikompensasi dengan naming yang kuat.

---

## 13. Counting Bits

Java menyediakan method untuk operasi bit counting, misalnya pada `Integer` dan `Long`:

```java
int count = Long.bitCount(mask);
int leading = Long.numberOfLeadingZeros(mask);
int trailing = Long.numberOfTrailingZeros(mask);
```

Contoh: menghitung jumlah permission aktif.

```java
int activePermissions = Long.bitCount(permissionMask);
```

Iterasi bit aktif dalam `long`:

```java
static List<Integer> activeBitIndexes(long mask) {
    ArrayList<Integer> result = new ArrayList<>();

    while (mask != 0) {
        int bitIndex = Long.numberOfTrailingZeros(mask);
        result.add(bitIndex);
        mask &= mask - 1; // clear lowest set bit
    }

    return result;
}
```

Idiom:

```java
mask &= mask - 1;
```

menghapus bit `1` paling rendah.

Kenapa bekerja?

Misalnya:

```text
mask       = 10110000
mask - 1   = 10101111
AND        = 10100000
```

Bit `1` paling rendah berubah menjadi `0`, dan bit setelahnya tidak penting karena hasil `AND` membersihkannya.

---

## 14. Power of Two

Cek apakah angka adalah power of two:

```java
static boolean isPowerOfTwo(long x) {
    return x > 0 && (x & (x - 1)) == 0;
}
```

Contoh:

```text
8  = 1000
7  = 0111
&  = 0000
```

Power-of-two sering muncul pada:

- hash table capacity,
- ring buffer capacity,
- masking index,
- memory alignment,
- bucket calculation.

Jika capacity power of two, modulo bisa diganti dengan mask:

```java
int index = hash & (capacity - 1);
```

Tetapi ini hanya benar jika `capacity` adalah power of two.

Jangan membuat optimization ini tanpa invariant jelas.

```java
static int indexFor(int hash, int capacity) {
    if (!isPowerOfTwo(capacity)) {
        throw new IllegalArgumentException("capacity must be power of two");
    }
    return hash & (capacity - 1);
}
```

---

## 15. Java Signed Integer Trap

### 15.1 Sign Bit

```java
int mask = 1 << 31;
System.out.println(mask); // negative
```

Bit pattern valid, tetapi numeric value negatif.

Kalau mask akan dicetak, disimpan, atau dibandingkan secara numeric, hati-hati.

Untuk 64-bit mask, pakai `long`:

```java
long mask = 1L << 63; // still negative as long numeric value
```

Bahkan `long` bit ke-63 tetap sign bit.

### 15.2 Shift Distance Masking

Java tidak melempar error untuk shift distance terlalu besar.

Untuk `int`, shift distance efektif modulo 32. Untuk `long`, modulo 64.

```java
System.out.println(1 << 0);   // 1
System.out.println(1 << 32);  // also 1, surprising
```

Karena itu selalu validasi index.

### 15.3 `1 << i` vs `1L << i`

Bug umum:

```java
long bit = 1 << 40; // wrong
```

`1` adalah `int`, sehingga shift dilakukan sebagai `int` dulu.

Yang benar:

```java
long bit = 1L << 40;
```

### 15.4 Signed vs Unsigned Right Shift

Jika bekerja dengan raw bit pattern, gunakan `>>>` ketika ingin logical shift.

```java
int x = -1;
System.out.println(x >> 1);  // still negative
System.out.println(x >>> 1); // positive large number
```

---

## 16. Permission Flags: Desain yang Aman

Contoh domain:

```java
enum Permission {
    VIEW_CASE(0),
    EDIT_CASE(1),
    APPROVE_CASE(2),
    CLOSE_CASE(3),
    EXPORT_REPORT(4);

    private final int bitIndex;

    Permission(int bitIndex) {
        if (bitIndex < 0 || bitIndex >= Long.SIZE) {
            throw new IllegalArgumentException("bitIndex out of range");
        }
        this.bitIndex = bitIndex;
    }

    long bit() {
        return 1L << bitIndex;
    }
}
```

Wrapper:

```java
public final class PermissionMask {
    private final long value;

    private PermissionMask(long value) {
        this.value = value;
    }

    public static PermissionMask empty() {
        return new PermissionMask(0L);
    }

    public PermissionMask with(Permission permission) {
        return new PermissionMask(value | permission.bit());
    }

    public PermissionMask without(Permission permission) {
        return new PermissionMask(value & ~permission.bit());
    }

    public boolean contains(Permission permission) {
        return (value & permission.bit()) != 0;
    }

    public boolean containsAll(PermissionMask required) {
        return (value & required.value) == required.value;
    }

    public boolean intersects(PermissionMask other) {
        return (value & other.value) != 0;
    }

    public long rawValue() {
        return value;
    }

    public static PermissionMask fromRawValue(long value) {
        return new PermissionMask(value);
    }
}
```

Penggunaan:

```java
PermissionMask officer = PermissionMask.empty()
        .with(Permission.VIEW_CASE)
        .with(Permission.EDIT_CASE);

PermissionMask required = PermissionMask.empty()
        .with(Permission.VIEW_CASE)
        .with(Permission.APPROVE_CASE);

if (!officer.containsAll(required)) {
    throw new SecurityException("missing required permission");
}
```

Kenapa wrapper lebih baik daripada menyebar `long` ke seluruh codebase?

Karena wrapper:

- menyembunyikan bit math,
- memberi nama domain,
- memusatkan validasi,
- memudahkan testing,
- mengurangi bug operator,
- membuat schema evolution lebih terkendali.

---

## 17. Persisted Bit Mask: Schema Evolution Risk

Menyimpan mask ke database terlihat menarik:

```sql
permission_mask BIGINT NOT NULL
```

Tapi ada risiko besar:

1. bit position tidak boleh berubah,
2. bit yang sudah dipakai tidak boleh di-reuse sembarangan,
3. deprecated permission harus tetap dikenali,
4. migration harus jelas,
5. reporting perlu decoding,
6. debugging raw numeric value sulit.

Dokumentasikan mapping:

| Bit | Permission | Status | Since | Notes |
|---:|---|---|---|---|
| 0 | VIEW_CASE | active | v1 | Basic case view |
| 1 | EDIT_CASE | active | v1 | Edit draft/open case |
| 2 | APPROVE_CASE | active | v1 | Approval action |
| 3 | CLOSE_CASE | active | v1 | Terminal close |
| 4 | EXPORT_REPORT | active | v2 | Reporting export |
| 5 | LEGACY_REVIEW | deprecated | v1 | Do not reuse |

Rule penting:

> Setelah data dipersist, bit position adalah bagian dari external contract.

---

## 18. Bloom Filter: Mental Model

Bloom filter adalah struktur data probabilistic untuk membership query.

Ia menjawab:

```text
Apakah key ini mungkin ada di set?
```

Jawaban Bloom filter:

```text
No  -> pasti tidak ada
Yes -> mungkin ada
```

Ia bisa menghasilkan false positive, tetapi tidak menghasilkan false negative selama filter dipakai sesuai aturan insert/query standar.

Artinya:

- jika Bloom filter bilang “not present”, key pasti tidak ada,
- jika Bloom filter bilang “present”, key mungkin ada, perlu check lanjut jika correctness penting.

Ini sangat berguna untuk prefilter.

Contoh use case:

- sebelum query database mahal,
- sebelum call remote service,
- dedup pre-check,
- cache penetration protection,
- checking whether ID may exist in large static set,
- avoiding disk/network lookup for definitely-absent keys.

---

## 19. Cara Kerja Bloom Filter

Bloom filter punya:

- bit array ukuran `m`,
- `k` hash functions,
- insert operation,
- mightContain operation.

### 19.1 Insert

Untuk key `x`:

```text
h1(x), h2(x), ..., hk(x)
```

masing-masing menghasilkan posisi bit.

Set semua posisi itu menjadi `1`.

```text
bit[h1(x)] = 1
bit[h2(x)] = 1
...
bit[hk(x)] = 1
```

### 19.2 Query

Untuk key `x`, hitung posisi yang sama.

Jika ada satu saja bit `0`:

```text
x definitely not present
```

Jika semua bit `1`:

```text
x may be present
```

Kenapa false positive bisa terjadi?

Karena bit-bit untuk key yang belum pernah dimasukkan bisa kebetulan sudah diset oleh key-key lain.

---

## 20. Simple Bloom Filter di Java

Ini implementasi edukatif, bukan production-ready cryptographic-quality hash.

```java
public final class SimpleBloomFilter {
    private final BitSet bits;
    private final int bitSize;
    private final int hashCount;

    public SimpleBloomFilter(int bitSize, int hashCount) {
        if (bitSize <= 0) {
            throw new IllegalArgumentException("bitSize must be positive");
        }
        if (hashCount <= 0) {
            throw new IllegalArgumentException("hashCount must be positive");
        }
        this.bits = new BitSet(bitSize);
        this.bitSize = bitSize;
        this.hashCount = hashCount;
    }

    public void add(String value) {
        for (int i = 0; i < hashCount; i++) {
            bits.set(index(value, i));
        }
    }

    public boolean mightContain(String value) {
        for (int i = 0; i < hashCount; i++) {
            if (!bits.get(index(value, i))) {
                return false;
            }
        }
        return true;
    }

    private int index(String value, int seed) {
        int h = mix(value.hashCode() ^ (seed * 0x9E3779B9));
        return Math.floorMod(h, bitSize);
    }

    private static int mix(int x) {
        x ^= (x >>> 16);
        x *= 0x7feb352d;
        x ^= (x >>> 15);
        x *= 0x846ca68b;
        x ^= (x >>> 16);
        return x;
    }
}
```

Penggunaan:

```java
SimpleBloomFilter filter = new SimpleBloomFilter(1_000_000, 7);

filter.add("CASE-001");
filter.add("CASE-002");

if (!filter.mightContain("CASE-999")) {
    System.out.println("definitely absent");
} else {
    System.out.println("maybe present, verify using source of truth");
}
```

Catatan penting:

> Bloom filter tidak boleh menjadi source of truth untuk keputusan yang membutuhkan kepastian presence.

Ia hanya prefilter.

---

## 21. Bloom Filter Sizing

Parameter utama:

```text
n = expected number of inserted items
m = number of bits
k = number of hash functions
p = false positive probability
```

Rumus umum:

```text
m ≈ -n * ln(p) / (ln(2)^2)
k ≈ (m / n) * ln(2)
```

Contoh:

```text
n = 1,000,000
p = 1% = 0.01
```

Maka kira-kira:

```text
m ≈ 9,585,058 bits ≈ 1.14 MB
k ≈ 7 hash functions
```

Ini menunjukkan kekuatan Bloom filter: satu juta key bisa diprefilter dengan memory kecil, dengan trade-off false positive.

Tetapi jika `n` melebihi estimasi jauh, false positive rate naik.

Rule:

> Bloom filter harus disizing berdasarkan expected cardinality dan target false positive rate.

---

## 22. Bloom Filter Failure Modes

### 22.1 Menganggap `mightContain` sebagai Pasti Ada

Salah:

```java
if (filter.mightContain(id)) {
    approve(id); // dangerous
}
```

Benar:

```java
if (!filter.mightContain(id)) {
    return Optional.empty();
}

return repository.findById(id); // verify source of truth
```

### 22.2 Over Capacity

Bloom filter yang awalnya didesain untuk 1 juta item lalu diisi 10 juta item akan punya false positive rate jauh lebih tinggi.

Mitigasi:

- monitor inserted count,
- rebuild filter,
- scalable Bloom filter,
- partition by time/window,
- rotate filter.

### 22.3 Hash Function Buruk

Jika hash tidak tersebar baik, bit tertentu terlalu sering aktif dan false positive naik.

Untuk production, gunakan hash yang lebih kuat/stabil daripada sekadar `String.hashCode()` jika input adversarial atau distribusi buruk.

### 22.4 Butuh Delete

Bloom filter standar tidak mendukung delete aman.

Jika kita clear bit untuk satu key, mungkin bit itu juga dipakai key lain.

Untuk delete, opsi:

- counting Bloom filter,
- rebuild periodically,
- partitioned time-window Bloom filter,
- gunakan struktur lain.

### 22.5 Concurrent Mutation

`BitSet` mutation tidak boleh diasumsikan aman untuk concurrent write tanpa koordinasi.

Jika Bloom filter diupdate paralel:

- gunakan locking,
- atomic bitset custom,
- shard filter,
- build immutable snapshot lalu publish.

---

## 23. Bloom Filter sebagai Cache Penetration Guard

Masalah:

```text
Banyak request untuk ID yang tidak ada.
Setiap miss menembus cache dan menghantam database.
```

Solusi dengan Bloom filter:

```text
Request ID
   |
   v
Bloom filter says definitely absent?
   | yes -> return not found without DB
   | no  -> check cache / DB
```

Pseudo-code:

```java
Optional<CaseRecord> findCase(String caseId) {
    if (!knownCaseIdFilter.mightContain(caseId)) {
        return Optional.empty();
    }

    CaseRecord cached = cache.get(caseId);
    if (cached != null) {
        return Optional.of(cached);
    }

    return repository.findById(caseId);
}
```

Correctness:

- false positive hanya membuat kita tetap query DB,
- false positive tidak menyebabkan data palsu,
- definitely absent bisa dipakai untuk short-circuit.

Tetapi hati-hati jika data baru bisa muncul:

- filter harus diupdate saat insert,
- atau filter harus dianggap snapshot dengan refresh interval,
- atau fallback rules harus jelas.

---

## 24. Bloom Filter vs HashSet

| Aspek | Bloom Filter | `HashSet` |
|---|---|---|
| Membership absent | pasti benar | pasti benar |
| Membership present | mungkin benar | pasti benar |
| False positive | bisa | tidak |
| False negative | tidak, jika benar penggunaannya | tidak |
| Memory | sangat compact | lebih besar |
| Delete | tidak pada standard Bloom | ya |
| Iterasi isi | tidak bisa | bisa |
| Menyimpan key asli | tidak | ya |
| Source of truth | tidak | bisa |
| Use case | prefilter | exact membership |

Gunakan Bloom filter jika:

- exact presence tidak perlu pada tahap pertama,
- memory sangat penting,
- negative lookup banyak,
- source of truth tetap ada.

Gunakan `HashSet` jika:

- butuh kepastian membership,
- butuh iterasi isi,
- butuh delete,
- data cukup kecil untuk disimpan exact.

---

## 25. Roaring Bitmap: Conceptual Awareness

Selain `BitSet`, ada struktur seperti Roaring Bitmap.

Ide besarnya:

> Representasi bitmap dapat dikompresi dengan membagi integer space menjadi chunk dan memilih encoding terbaik untuk tiap chunk.

Roaring bitmap biasanya unggul untuk integer set yang:

- besar,
- tidak sepenuhnya dense,
- butuh fast union/intersection,
- butuh serialized compact format.

Di Java standard library tidak ada Roaring Bitmap. Tetapi secara konsep penting karena banyak sistem analytics/search/indexing memakai bitmap compressed.

Mental distinction:

| Struktur | Cocok Untuk |
|---|---|
| `BitSet` | dense/semi-dense non-negative int set |
| `HashSet<Integer>` | sparse exact set |
| Roaring Bitmap | large compressed integer set dengan operasi set cepat |
| Bloom Filter | probabilistic membership prefilter |

---

## 26. Case Study 1: Eligibility Flags

Misalkan case punya beberapa eligibility condition:

```text
- has valid license
- has no sanction
- has active registration
- has paid fee
- has completed required document
```

Kita bisa simpan per case sebagai mask:

```java
enum EligibilityFlag {
    VALID_LICENSE(0),
    NO_SANCTION(1),
    ACTIVE_REGISTRATION(2),
    PAID_FEE(3),
    COMPLETE_DOCUMENT(4);

    private final int bitIndex;

    EligibilityFlag(int bitIndex) {
        this.bitIndex = bitIndex;
    }

    long bit() {
        return 1L << bitIndex;
    }
}
```

Required mask:

```java
static long requiredMask() {
    return EligibilityFlag.VALID_LICENSE.bit()
            | EligibilityFlag.NO_SANCTION.bit()
            | EligibilityFlag.ACTIVE_REGISTRATION.bit()
            | EligibilityFlag.PAID_FEE.bit()
            | EligibilityFlag.COMPLETE_DOCUMENT.bit();
}
```

Check:

```java
static boolean isEligible(long actualMask) {
    long required = requiredMask();
    return (actualMask & required) == required;
}
```

Find missing:

```java
static long missingFlags(long actualMask) {
    long required = requiredMask();
    return required & ~actualMask;
}
```

Decode missing:

```java
static List<EligibilityFlag> decode(long mask) {
    ArrayList<EligibilityFlag> result = new ArrayList<>();
    for (EligibilityFlag flag : EligibilityFlag.values()) {
        if ((mask & flag.bit()) != 0) {
            result.add(flag);
        }
    }
    return result;
}
```

Ini cocok jika flags kecil dan fixed.

Kalau rule eligibility dinamis dari database, bit mask fixed bisa terlalu kaku.

---

## 27. Case Study 2: In-Memory Case Filter dengan BitSet

Kita punya 100.000 case dalam snapshot. Kita ingin filter cepat berdasarkan banyak dimensi:

- state,
- assigned officer,
- overdue,
- has appeal,
- high priority.

Build index:

```java
final class CaseFilterIndex {
    private final ArrayList<CaseRecord> rows = new ArrayList<>();
    private final Map<String, BitSet> byState = new HashMap<>();
    private final Map<String, BitSet> byOfficer = new HashMap<>();
    private final BitSet overdue = new BitSet();
    private final BitSet hasAppeal = new BitSet();
    private final BitSet highPriority = new BitSet();

    void add(CaseRecord record) {
        int row = rows.size();
        rows.add(record);

        byState.computeIfAbsent(record.state(), ignored -> new BitSet()).set(row);
        byOfficer.computeIfAbsent(record.officer(), ignored -> new BitSet()).set(row);

        if (record.overdue()) {
            overdue.set(row);
        }
        if (record.hasAppeal()) {
            hasAppeal.set(row);
        }
        if (record.highPriority()) {
            highPriority.set(row);
        }
    }

    List<CaseRecord> search(String state, String officer, boolean onlyOverdue, boolean onlyHighPriority) {
        BitSet result = new BitSet(rows.size());
        result.set(0, rows.size()); // start with all rows

        if (state != null) {
            result.and(byState.getOrDefault(state, new BitSet()));
        }
        if (officer != null) {
            result.and(byOfficer.getOrDefault(officer, new BitSet()));
        }
        if (onlyOverdue) {
            result.and(overdue);
        }
        if (onlyHighPriority) {
            result.and(highPriority);
        }

        ArrayList<CaseRecord> matches = new ArrayList<>();
        for (int i = result.nextSetBit(0); i >= 0; i = result.nextSetBit(i + 1)) {
            matches.add(rows.get(i));
        }
        return matches;
    }
}
```

Important improvement:

Avoid repeated allocation of empty `BitSet` in `getOrDefault` if this is hot path.

Better:

```java
BitSet stateBits = byState.get(state);
if (stateBits == null) {
    return List.of();
}
result.and(stateBits);
```

This pattern is powerful for read-mostly snapshots.

---

## 28. Case Study 3: Permission with `EnumSet`

For readability, `EnumSet` is often better than manual mask.

```java
enum Permission {
    VIEW_CASE,
    EDIT_CASE,
    APPROVE_CASE,
    CLOSE_CASE,
    EXPORT_REPORT
}
```

```java
record UserAccess(EnumSet<Permission> permissions) {
    UserAccess {
        permissions = permissions.clone();
    }

    boolean has(Permission permission) {
        return permissions.contains(permission);
    }

    boolean hasAll(Set<Permission> required) {
        return permissions.containsAll(required);
    }
}
```

But be careful with mutability.

`EnumSet` is mutable.

Safer:

```java
record UserAccess(Set<Permission> permissions) {
    UserAccess {
        permissions = Set.copyOf(permissions);
    }

    boolean has(Permission permission) {
        return permissions.contains(permission);
    }
}
```

Trade-off:

- `EnumSet` gives compact mutable set,
- `Set.copyOf` gives unmodifiable defensive snapshot,
- manual mask gives compact persisted numeric representation.

Choose based on lifecycle.

---

## 29. Testing Bit-Level Code

Bit-level code needs explicit tests because operator bugs are visually subtle.

### 29.1 Test Every Flag

```java
@Test
void containsPermissionAfterAddingIt() {
    for (Permission permission : Permission.values()) {
        PermissionMask mask = PermissionMask.empty().with(permission);
        assertTrue(mask.contains(permission));
    }
}
```

### 29.2 Test No Accidental Overlap

```java
@Test
void permissionBitsDoNotOverlap() {
    long seen = 0L;
    for (Permission permission : Permission.values()) {
        long bit = permission.bit();
        assertEquals(0L, seen & bit, "duplicate bit: " + permission);
        seen |= bit;
    }
}
```

### 29.3 Test Required Subset

```java
@Test
void containsAllRequiresEveryBit() {
    PermissionMask actual = PermissionMask.empty()
            .with(Permission.VIEW_CASE);

    PermissionMask required = PermissionMask.empty()
            .with(Permission.VIEW_CASE)
            .with(Permission.APPROVE_CASE);

    assertFalse(actual.containsAll(required));
}
```

### 29.4 Test Persisted Mapping

If masks are persisted, write tests that protect bit positions.

```java
@Test
void persistedPermissionBitsMustNotChange() {
    assertEquals(1L << 0, Permission.VIEW_CASE.bit());
    assertEquals(1L << 1, Permission.EDIT_CASE.bit());
    assertEquals(1L << 2, Permission.APPROVE_CASE.bit());
}
```

This test looks rigid because it should be rigid. Persisted encoding is a contract.

---

## 30. Performance Notes

### 30.1 BitSet vs HashSet

`BitSet` can be dramatically more memory-efficient than `HashSet<Integer>` for dense integer sets because it does not allocate object nodes per element.

But `BitSet` can be terrible if max index is huge and sparse.

Example:

```java
BitSet bits = new BitSet();
bits.set(1_000_000_000);
```

This logically needs capacity up to that bit position.

If only one ID exists, `HashSet<Integer>` is better.

### 30.2 Word-Level Operations

`BitSet.and` can process many bits per CPU word. This makes intersection of large dense sets fast.

Instead of:

```java
for each element in setA:
    if setB contains element
```

It can do conceptual word-level:

```text
wordA[i] & wordB[i]
```

This is the same reason bitmap indexes are powerful.

### 30.3 Allocation Awareness

Many `BitSet` operations mutate the receiver.

```java
a.and(b); // mutates a
```

If you need non-mutating operation, clone first:

```java
BitSet result = (BitSet) a.clone();
result.and(b);
```

This clone allocates. In hot path, allocation strategy matters.

Options:

- reuse scratch bitsets carefully,
- use immutable snapshot and per-request scratch,
- pool only if proven necessary,
- avoid shared mutable scratch across threads.

### 30.4 Benchmark with Real Distribution

Do not benchmark bitmap with random assumptions only.

Measure:

- dense vs sparse,
- high max index vs low max index,
- cardinality,
- query mix,
- mutation frequency,
- clone frequency,
- number of filter dimensions,
- concurrency model.

---

## 31. Common Anti-Patterns

### 31.1 Magic Numbers

Bad:

```java
if ((mask & 8) != 0) {
    // what is 8?
}
```

Better:

```java
if ((mask & Permission.CLOSE_CASE.bit()) != 0) {
    // clear domain meaning
}
```

### 31.2 Persisting `ordinal()` Without Contract

Bad:

```java
long bit = 1L << permission.ordinal();
```

This is dangerous for persisted data.

### 31.3 Forgetting `1L`

Bad:

```java
long bit = 1 << 40;
```

Correct:

```java
long bit = 1L << 40;
```

### 31.4 Using BitSet for Sparse Huge IDs

Bad:

```java
BitSet users = new BitSet();
users.set(2_000_000_000);
```

If only a few users exist, use set or compression.

### 31.5 Treating Bloom Positive as Truth

Bad:

```java
if (filter.mightContain(id)) {
    return true;
}
```

Better:

```java
if (!filter.mightContain(id)) {
    return false;
}
return sourceOfTruth.exists(id);
```

### 31.6 Mutating Shared BitSet Accidentally

Bad:

```java
BitSet result = cachedStateBits;
result.and(officerBits); // corrupts cached index
```

Correct:

```java
BitSet result = (BitSet) cachedStateBits.clone();
result.and(officerBits);
```

### 31.7 No Schema Documentation

If bit masks cross boundaries, undocumented bit positions become hidden production contracts.

---

## 32. Design Checklist

When considering bit-level structures, ask:

1. Is the domain naturally boolean?
2. Is the key space dense or sparse?
3. Is the max index bounded?
4. Do we need exact membership or approximate membership?
5. Do we need deletion?
6. Do we need iteration over elements?
7. Do we need persistence or wire-format compatibility?
8. Can bit positions evolve safely?
9. Is readability more important than compactness?
10. Is this hot path or normal business code?
11. Is mutation single-threaded, synchronized, or snapshot-based?
12. Do we need union/intersection/difference frequently?
13. Is false positive acceptable?
14. Who owns source of truth?
15. How will we test bit mapping?

---

## 33. Choosing the Right Structure

### Use `EnumSet` when:

- values are enum,
- you need exact set semantics,
- readability matters,
- persistence as bit number is not required.

### Use `long` mask when:

- <= 64 fixed flags,
- numeric persistence/protocol needed,
- hot path matters,
- mapping is stable and documented.

### Use `BitSet` when:

- key is non-negative dense integer,
- many boolean states,
- need fast set operations,
- memory compactness matters.

### Use `HashSet<Integer>` when:

- sparse integer keys,
- exact membership,
- max index huge,
- simplicity matters.

### Use Bloom filter when:

- you need memory-efficient prefilter,
- false positive is acceptable,
- false negative is not acceptable,
- source of truth exists elsewhere.

---

## 34. Production Mental Model

Bit manipulation is not about cleverness.

It is about representation.

A top-tier engineer does not ask:

```text
Can I solve this with bit tricks?
```

They ask:

```text
Is this domain actually a set of boolean facts?
Is the key space dense?
Do I need exactness?
Do I need compactness?
Do I need fast set algebra?
Can this representation evolve safely?
```

That is the difference between trick-based DSA and engineering-grade DSA.

---

## 35. Summary

Key takeaways:

1. A bit can represent a boolean state.
2. A `long` can represent up to 64 flags.
3. Bit masks are compact set representations.
4. `EnumSet` is often the best Java abstraction for enum flags.
5. `BitSet` is a compact indexed set for non-negative integer positions.
6. `BitSet` is excellent for dense visited sets and bitmap indexes.
7. Sparse huge IDs should not be used directly as `BitSet` indexes.
8. Bloom filter is an approximate membership prefilter.
9. Bloom filter positive means “maybe present”, not “present”.
10. Persisted bit positions are long-term contracts.
11. Java shift/sign behavior must be understood to avoid subtle bugs.
12. Bit-level code requires strong naming, wrapper types, and tests.

---

## 36. Practice Tasks

### Task 1 — Permission Mask

Implement `PermissionMask` for these permissions:

```text
VIEW
CREATE
UPDATE
DELETE
APPROVE
EXPORT
```

Requirements:

- immutable wrapper,
- `with`, `without`, `contains`, `containsAll`, `intersects`,
- raw `long` export/import,
- tests to prevent duplicate bits.

### Task 2 — BitSet-Based Visited Set

Given graph with dense integer node IDs, implement BFS using `BitSet` as visited structure.

Compare with:

- `boolean[]`,
- `HashSet<Integer>`.

Explain which one you would choose under different constraints.

### Task 3 — Bitmap Index

Build an in-memory index for records:

```java
record Ticket(int id, String status, String owner, boolean overdue) {}
```

Support query:

```text
status = X AND owner = Y AND overdue = true/false optional
```

Use `BitSet` intersection.

### Task 4 — Bloom Filter

Implement a simple Bloom filter for strings.

Then explain:

- why it can return false positive,
- why it should not return false negative under normal insert/query,
- why delete is unsafe in standard Bloom filter,
- where source of truth must still be checked.

### Task 5 — Schema Evolution

Design a persisted permission bit schema for 10 permissions.

Include:

- bit number,
- permission name,
- status,
- introduced version,
- deprecated version if any,
- migration notes.

---

## 37. References

- Oracle Java SE 25 Documentation — `java.util.BitSet`.
- Oracle Java SE 25 Documentation — `java.util.EnumSet`.
- Oracle Java SE Documentation — `java.lang.Integer` / `java.lang.Long` bit operations.
- Bloom filter literature on false positive probability and approximate membership query structures.
- Java Collections Framework documentation.

---

## 38. Closing

Part ini menyelesaikan pembahasan compact boolean/set representation:

```text
bit mask -> small fixed flag set
EnumSet  -> readable enum-backed bit vector
BitSet   -> indexed dense boolean set
Bloom    -> probabilistic prefilter
```

Berikutnya kita akan masuk ke:

```text
Part 023 — Disjoint Set, Indexing, Sparse vs Dense Data
```

Part berikutnya akan melanjutkan tema representasi, tetapi fokusnya bergeser dari boolean state ke **grouping, connectivity, coordinate compression, sparse/dense indexing, dan Union-Find**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dsa-part-021 — Sliding Window, Two Pointers, Prefix Sum, Difference Array](./learn-java-dsa-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-023 — Disjoint Set, Indexing, Sparse vs Dense Data](./learn-java-dsa-part-023.md)
