# learn-java-memory-byte-bit-buffer-offheap-gc-part-010.md

# Part 010 — Bit Manipulation Patterns for Real Systems

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Topik besar: Java Memory Management, Byte & Bit, Buffer, Off-Heap, dan Garbage Collection  
> Bagian: 010 / 030  
> Target Java: 8 sampai 25

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas bagaimana array, string, compact string, charset, dan representasi teks dapat memengaruhi footprint memory secara signifikan.

Bagian ini turun ke level yang lebih kecil: **bit sebagai unit representasi state**.

Tujuannya bukan supaya kita menulis kode “low-level” di semua tempat. Tujuannya adalah supaya kita memiliki keluwesan ketika harus membaca, menulis, mengompresi, mengemas, mengirim, atau mendiagnosis data yang secara alami berbentuk bit.

Contoh nyata:

- permission flags
- feature toggles
- compact status/state flags
- bitmap index
- Bloom filter
- binary protocol
- network packet field
- file format
- compression metadata
- checksum/hash formatting
- bitmask-based filtering
- dirty-field tracking
- sparse/dense boolean state
- database-style column nullability bitmap
- event flags
- scheduler availability slot
- seat reservation map
- access-control matrix
- efficient set representation

Mental model utama:

```text
Bit manipulation is not about being clever.
It is about representing many boolean or small integer states compactly,
predictably, and with clear invariants.
```

Jika tidak disiplin, bit manipulation mudah berubah menjadi kode yang tidak bisa dibaca, rawan bug, dan sulit diaudit.

Jika disiplin, bit manipulation bisa menjadi alat yang sangat kuat untuk membangun sistem memory-efficient dan protocol-aware.

---

## 1. Kapan Bit Manipulation Layak Dipakai?

Bit manipulation layak dipakai ketika minimal satu dari kondisi berikut benar:

1. Kita perlu merepresentasikan banyak boolean state secara padat.
2. Kita perlu mengikuti format binary eksternal.
3. Kita perlu menghindari overhead object/collection.
4. Kita perlu melakukan operasi set secara cepat.
5. Kita perlu encode/decode field kecil ke dalam integer/long.
6. Kita perlu membuat struktur data seperti bitmap, Bloom filter, atau bit index.
7. Kita berada di hot path dengan memory locality penting.
8. Kita perlu interoperabilitas dengan C, network protocol, file format, atau hardware-oriented format.

Bit manipulation tidak layak dipakai hanya karena terlihat “lebih pintar”.

Contoh keputusan:

| Masalah | Representasi sederhana | Representasi bit-level | Kapan bit-level masuk akal |
|---|---|---|---|
| 5 permission flag | `EnumSet<Permission>` | `int mask` | jika disimpan jutaan record / protocol compact |
| 1000 boolean per object | `boolean[]` | `BitSet` / `long[]` | hampir selalu layak dipertimbangkan |
| Status domain business | enum biasa | bit flags | hanya jika status bisa dikombinasikan dan invariant jelas |
| Network header | POJO field | packed bits | wajib jika protocol binary |
| Dirty fields DTO | `Set<String>` | bit mask | jika field count tetap dan throughput tinggi |
| Access matrix | `Set<Pair<User,Resource>>` | bitmap/roaring bitmap | jika query set operation dominan |

Prinsip desain:

```text
Use bit-level representation when the data is naturally bit-like,
not merely because bit-level code is possible.
```

---

## 2. Operator Bitwise Java: Inti Semantik

Java menyediakan operator bitwise untuk integral types:

```java
&   // bitwise AND
|   // bitwise OR
^   // bitwise XOR
~   // bitwise complement
<<  // left shift
>>  // signed right shift
>>> // unsigned right shift
```

Operator tersebut bekerja pada tipe integral:

- `byte`
- `short`
- `char`
- `int`
- `long`

Namun ada detail penting:

```text
Untuk operasi bitwise umum, byte/short/char akan dipromosikan ke int.
```

Contoh:

```java
byte b = (byte) 0b1111_0000;
int x = b & 0xFF;
```

Kenapa `& 0xFF` penting?

Karena `byte` Java signed. Saat `byte` dipromosikan ke `int`, sign extension bisa terjadi.

Contoh:

```java
byte b = (byte) 0xFF; // -1 sebagai byte signed
int wrong = b;        // -1, yaitu 0xFFFF_FFFF
int right = b & 0xFF; // 255, yaitu 0x0000_00FF
```

Invariant praktis:

```text
Whenever interpreting byte as unsigned data, mask with 0xFF.
```

Untuk `short`:

```java
short s = (short) 0xFFFF;
int unsignedShort = s & 0xFFFF;
```

Untuk `char`, karena `char` adalah unsigned 16-bit code unit, kasusnya berbeda, tetapi tetap perlu hati-hati saat dipakai untuk binary data. `char` adalah tipe teks UTF-16 code unit, bukan tipe byte buffer.

---

## 3. Binary Literal dan Readability

Java mendukung binary literal sejak Java 7:

```java
int mask = 0b0000_0001;
int high = 0b1000_0000;
```

Underscore boleh dipakai untuk readability:

```java
int flags = 0b0000_0000_0000_0000_0000_0000_1010_0101;
long word = 0b1111_0000_1010_0101_0000_1111_0101_1010L;
```

Dalam kode produksi, literal binary sangat berguna untuk field layout kecil.

Contoh:

```java
// 8-bit header
// bit 7: encrypted
// bit 6: compressed
// bit 5..4: priority
// bit 3..0: type
static final int FLAG_ENCRYPTED  = 0b1000_0000;
static final int FLAG_COMPRESSED = 0b0100_0000;
static final int PRIORITY_MASK   = 0b0011_0000;
static final int TYPE_MASK       = 0b0000_1111;
```

Namun untuk mask besar, hexadecimal sering lebih ringkas:

```java
int lowerByte = 0xFF;
int lowerWord = 0xFFFF;
long unsignedIntMask = 0xFFFF_FFFFL;
```

Guideline:

| Format | Cocok untuk |
|---|---|
| binary literal | menjelaskan posisi bit |
| hexadecimal | mask byte/word dan protocol field |
| decimal | nilai domain biasa |

---

## 4. Operasi Dasar: Set, Clear, Toggle, Test

Misalkan kita punya flag:

```java
static final int READ    = 1 << 0; // 0001
static final int WRITE   = 1 << 1; // 0010
static final int EXECUTE = 1 << 2; // 0100
static final int DELETE  = 1 << 3; // 1000
```

### 4.1 Set Bit

```java
int flags = 0;
flags |= READ;
flags |= WRITE;
```

Makna:

```text
OR dengan mask membuat bit tersebut menjadi 1 tanpa mengubah bit lain.
```

### 4.2 Clear Bit

```java
flags &= ~WRITE;
```

Makna:

```text
~WRITE membalik semua bit.
AND dengan mask tersebut membuat bit WRITE menjadi 0 dan membiarkan bit lain tetap.
```

### 4.3 Toggle Bit

```java
flags ^= EXECUTE;
```

Makna:

```text
XOR membuat bit berubah: 0 menjadi 1, 1 menjadi 0.
```

Toggle berguna untuk UI/debug/internal state, tetapi sering berbahaya untuk business state karena bisa mengubah state tanpa eksplisit.

Untuk business logic, lebih baik gunakan `set`/`clear` eksplisit.

### 4.4 Test Bit

```java
boolean canRead = (flags & READ) != 0;
```

Makna:

```text
Jika bit READ aktif, hasil AND tidak nol.
```

### 4.5 Test Semua Bit

```java
boolean canReadAndWrite = (flags & (READ | WRITE)) == (READ | WRITE);
```

Makna:

```text
Semua bit yang diminta harus aktif.
```

### 4.6 Test Salah Satu Bit

```java
boolean hasAnyWriteOrDelete = (flags & (WRITE | DELETE)) != 0;
```

Makna:

```text
Minimal satu bit aktif.
```

---

## 5. Membungkus Flag agar Tidak Menjadi “Magic Int”

Anti-pattern umum:

```java
user.setPermission(13);
```

Nilai `13` tidak menjelaskan apa-apa.

Lebih baik:

```java
final class Permissions {
    static final int READ    = 1 << 0;
    static final int WRITE   = 1 << 1;
    static final int EXECUTE = 1 << 2;
    static final int DELETE  = 1 << 3;

    private Permissions() {}

    static int grant(int flags, int permission) {
        return flags | permission;
    }

    static int revoke(int flags, int permission) {
        return flags & ~permission;
    }

    static boolean has(int flags, int permission) {
        return (flags & permission) != 0;
    }

    static boolean hasAll(int flags, int required) {
        return (flags & required) == required;
    }

    static boolean hasAny(int flags, int candidates) {
        return (flags & candidates) != 0;
    }
}
```

Pemakaian:

```java
int permissions = 0;
permissions = Permissions.grant(permissions, Permissions.READ | Permissions.WRITE);

if (Permissions.has(permissions, Permissions.READ)) {
    // allowed
}
```

Namun untuk domain yang kompleks, `int` saja masih rawan salah karena semua `int` bisa masuk.

Alternatif lebih aman:

```java
public final class PermissionMask {
    private final int value;

    private PermissionMask(int value) {
        this.value = value;
    }

    public static PermissionMask none() {
        return new PermissionMask(0);
    }

    public PermissionMask grant(int permission) {
        return new PermissionMask(value | permission);
    }

    public PermissionMask revoke(int permission) {
        return new PermissionMask(value & ~permission);
    }

    public boolean has(int permission) {
        return (value & permission) != 0;
    }

    public int raw() {
        return value;
    }
}
```

Trade-off:

| Bentuk | Kelebihan | Kekurangan |
|---|---|---|
| raw `int` | cepat, compact | mudah salah, tidak self-documenting |
| utility class | cukup readable | masih bisa campur mask domain lain |
| value object | type-safe, domain-friendly | ada object allocation jika tidak dioptimasi |
| enum/EnumSet | paling readable | overhead lebih besar daripada primitive mask |

Guideline:

```text
For public/domain API, prefer type safety.
For internal hot compact representation, primitive mask is acceptable if wrapped by clear operations.
```

---

## 6. Shift: `<<`, `>>`, dan `>>>`

Shift adalah sumber bug yang sangat umum.

### 6.1 Left Shift `<<`

```java
int bit = 1 << 5; // 32
```

Makna:

```text
Geser bit ke kiri, sama seperti mengalikan dengan 2^n jika tidak overflow.
```

Contoh:

```text
0000_0001 << 3 = 0000_1000
```

Hati-hati:

```java
int x = 1 << 31;
System.out.println(x); // negative int
```

Karena bit paling tinggi adalah sign bit untuk `int`.

Jika perlu bit ke-63:

```java
long highest = 1L << 63;
```

Tetap nilainya negatif sebagai signed long, tetapi bit pattern valid.

### 6.2 Signed Right Shift `>>`

```java
int x = -8;
int y = x >> 1;
```

`>>` mempertahankan sign bit.

Contoh konseptual 8-bit:

```text
1111_1000 >> 1 = 1111_1100
```

Untuk angka negatif, bit kiri diisi `1`.

### 6.3 Unsigned Right Shift `>>>`

```java
int x = -8;
int y = x >>> 1;
```

`>>>` mengisi bit kiri dengan `0`.

Contoh konseptual 8-bit:

```text
1111_1000 >>> 1 = 0111_1100
```

`>>>` sangat penting untuk:

- parsing binary protocol
- hash function
- unsigned interpretation
- extracting high bits
- avoiding sign propagation

### 6.4 Shift Count Masking

Java melakukan masking terhadap jumlah shift.

Untuk `int`, shift count menggunakan 5 bit bawah, sehingga efektif modulo 32.

```java
int a = 1 << 32; // sama efektifnya dengan 1 << 0
```

Untuk `long`, shift count menggunakan 6 bit bawah, sehingga efektif modulo 64.

```java
long b = 1L << 64; // sama efektifnya dengan 1L << 0
```

Ini sering mengejutkan.

Invariant:

```text
Never assume shifting by type width produces zero in Java.
```

Jika ingin validasi field width, validasi manual:

```java
static long bit(int index) {
    if (index < 0 || index >= Long.SIZE) {
        throw new IllegalArgumentException("bit index out of range: " + index);
    }
    return 1L << index;
}
```

---

## 7. Masking dan Extracting Field

Bit manipulation sering dipakai untuk mengemas beberapa field kecil ke satu integer.

Misalkan 32-bit layout:

```text
31          24 23          16 15           8 7            0
+-------------+--------------+--------------+--------------+
| version     | type         | status       | flags        |
+-------------+--------------+--------------+--------------+
```

Setiap field 8-bit.

Encoding:

```java
static int pack(int version, int type, int status, int flags) {
    return ((version & 0xFF) << 24)
         | ((type    & 0xFF) << 16)
         | ((status  & 0xFF) << 8)
         |  (flags   & 0xFF);
}
```

Decoding:

```java
static int version(int word) {
    return (word >>> 24) & 0xFF;
}

static int type(int word) {
    return (word >>> 16) & 0xFF;
}

static int status(int word) {
    return (word >>> 8) & 0xFF;
}

static int flags(int word) {
    return word & 0xFF;
}
```

Kenapa `>>>` lebih aman daripada `>>`?

Karena saat field paling atas memiliki bit sign aktif, `>>` akan mengisi bit kiri dengan `1`. Walaupun sering diikuti `& 0xFF`, menggunakan `>>>` lebih jelas secara intensi: kita sedang memperlakukan bit pattern sebagai unsigned word.

---

## 8. Validasi Field Sebelum Packing

Anti-pattern:

```java
static int packType(int type) {
    return type << 16;
}
```

Jika `type` lebih dari 8 bit, ia akan merusak field lain.

Lebih aman:

```java
static int requireUInt8(String name, int value) {
    if ((value & ~0xFF) != 0) {
        throw new IllegalArgumentException(name + " must fit in 8 bits: " + value);
    }
    return value;
}

static int pack(int version, int type, int status, int flags) {
    version = requireUInt8("version", version);
    type    = requireUInt8("type", type);
    status  = requireUInt8("status", status);
    flags   = requireUInt8("flags", flags);

    return (version << 24)
         | (type << 16)
         | (status << 8)
         | flags;
}
```

Catatan:

```java
(value & ~0xFF) != 0
```

Artinya ada bit di luar 8 bit terbawah.

Untuk signed field, validasinya berbeda.

Misalkan field signed 8-bit harus berada di rentang -128..127:

```java
static int requireInt8(String name, int value) {
    if (value < Byte.MIN_VALUE || value > Byte.MAX_VALUE) {
        throw new IllegalArgumentException(name + " must fit in signed 8 bits: " + value);
    }
    return value;
}
```

Guideline:

```text
Masking is not validation.
Masking silently truncates.
Validation rejects invalid values.
```

Contoh bug:

```java
int userType = 999;
int packed = (userType & 0xFF) << 16; // silently becomes 231
```

Dalam protocol internal yang strict, silent truncation adalah bug serius.

---

## 9. Packing Signed Field

Misalkan kita ingin menyimpan signed 8-bit delta ke dalam byte paling bawah:

```java
static int packDelta(int delta) {
    if (delta < -128 || delta > 127) {
        throw new IllegalArgumentException("delta out of int8 range: " + delta);
    }
    return delta & 0xFF;
}
```

Decode kembali ke signed int:

```java
static int unpackDelta(int word) {
    byte b = (byte) (word & 0xFF);
    return b; // sign-extended to int
}
```

Contoh:

```java
int packed = packDelta(-1);    // 0xFF
int delta = unpackDelta(packed); // -1
```

Mental model:

```text
The same 8-bit pattern can mean 255 unsigned or -1 signed.
Meaning comes from interpretation, not from the bits alone.
```

---

## 10. Unsigned Values di Java

Java tidak punya unsigned primitive umum selain `char` sebagai 16-bit unsigned code unit.

Namun Java menyediakan helper sejak Java 8 untuk beberapa operasi unsigned pada `Integer` dan `Long`.

Contoh:

```java
int signed = -1;
long unsigned = Integer.toUnsignedLong(signed); // 4294967295
```

String unsigned:

```java
String text = Integer.toUnsignedString(-1); // "4294967295"
```

Compare unsigned:

```java
int a = -1; // unsigned 4294967295
int b = 1;

boolean result = Integer.compareUnsigned(a, b) > 0; // true
```

Divide unsigned:

```java
int quotient = Integer.divideUnsigned(-1, 2);
```

Guideline:

```text
Use Java's unsigned helper methods when comparing, dividing, parsing, or formatting unsigned int/long values.
Do not reinvent them casually.
```

Untuk byte unsigned:

```java
int u8 = b & 0xFF;
```

Untuk short unsigned:

```java
int u16 = s & 0xFFFF;
```

Untuk int unsigned:

```java
long u32 = i & 0xFFFF_FFFFL;
// or
long u32b = Integer.toUnsignedLong(i);
```

---

## 11. `EnumSet`: Bit Vector yang Type-Safe

Untuk enum berukuran kecil sampai sedang, `EnumSet` sering menjadi pilihan terbaik.

Contoh:

```java
enum Permission {
    READ,
    WRITE,
    EXECUTE,
    DELETE
}

EnumSet<Permission> permissions = EnumSet.of(Permission.READ, Permission.WRITE);

if (permissions.contains(Permission.READ)) {
    // allowed
}
```

`EnumSet` internally menggunakan bit vector yang compact dan efisien untuk enum, tetapi API-nya tetap type-safe dan readable.

Kelebihan:

- readable
- type-safe
- tidak bisa mencampur enum domain lain
- operasi set jelas
- lebih aman untuk API/domain layer

Kekurangan:

- bukan primitive raw mask
- perlu object wrapper
- tergantung ordinal enum
- kurang cocok untuk persistent binary format jika ordinal bisa berubah

Peringatan penting:

```text
Do not persist enum ordinal blindly.
```

Jika `EnumSet` perlu disimpan sebagai bitmask, definisikan bit value eksplisit.

Contoh:

```java
enum Permission {
    READ(1 << 0),
    WRITE(1 << 1),
    EXECUTE(1 << 2),
    DELETE(1 << 3);

    final int bit;

    Permission(int bit) {
        this.bit = bit;
    }
}
```

Konversi:

```java
static int toMask(EnumSet<Permission> set) {
    int mask = 0;
    for (Permission permission : set) {
        mask |= permission.bit;
    }
    return mask;
}

static EnumSet<Permission> fromMask(int mask) {
    EnumSet<Permission> set = EnumSet.noneOf(Permission.class);
    for (Permission permission : Permission.values()) {
        if ((mask & permission.bit) != 0) {
            set.add(permission);
        }
    }
    return set;
}
```

Invariant:

```text
Enum ordinal is an implementation detail for ordering.
Explicit bit value is a stable protocol/storage contract.
```

---

## 12. `BitSet`: Dense Boolean Vector

`java.util.BitSet` adalah struktur data untuk vector bit yang dapat tumbuh sesuai kebutuhan.

Contoh:

```java
BitSet seats = new BitSet(10_000);

seats.set(42);      // seat 42 occupied
seats.clear(42);    // seat 42 free
boolean occupied = seats.get(42);
```

Operasi range:

```java
seats.set(100, 200);     // set bits [100, 200)
seats.clear(120, 150);   // clear bits [120, 150)
```

Operasi set:

```java
BitSet a = new BitSet();
a.set(1);
a.set(3);

BitSet b = new BitSet();
b.set(3);
b.set(4);

BitSet intersection = (BitSet) a.clone();
intersection.and(b); // only bit 3

BitSet union = (BitSet) a.clone();
union.or(b); // bits 1, 3, 4
```

Kapan `BitSet` cocok:

- banyak boolean indexed by integer
- dense enough
- perlu operasi set cepat
- index non-negative
- cardinality/counting dibutuhkan

Contoh:

```java
int selectedCount = seats.cardinality();
int firstFree = seats.nextClearBit(0);
int firstOccupied = seats.nextSetBit(0);
```

Kapan `BitSet` kurang cocok:

- index sangat sparse dan sangat besar
- butuh compressed bitmap format
- butuh thread-safe mutation tanpa external synchronization
- persistent format harus cross-language stabil tanpa dokumentasi tambahan

Untuk sparse large integer set, pertimbangkan compressed bitmap seperti Roaring Bitmap, tetapi itu di luar JDK standard.

---

## 13. `boolean[]` vs `BitSet` vs `long[]`

Misalkan kita perlu menyimpan 1 juta boolean.

Pilihan:

```java
boolean[] flags = new boolean[1_000_000];
BitSet bitSet = new BitSet(1_000_000);
long[] words = new long[(1_000_000 + 63) / 64];
```

Secara konseptual:

| Representasi | Approx data bits | Ergonomi | Kontrol | Catatan |
|---|---:|---|---|---|
| `boolean[]` | sering 1 byte/entry secara praktis | tinggi | rendah | simple tapi boros dibanding bit packing |
| `BitSet` | 1 bit/entry + overhead | tinggi | sedang | JDK standard, operasi set tersedia |
| `long[]` manual | 1 bit/entry + array overhead | rendah | tinggi | fastest/custom, rawan bug |

Manual `long[]`:

```java
final class LongBitMap {
    private final long[] words;

    LongBitMap(int size) {
        this.words = new long[(size + Long.SIZE - 1) / Long.SIZE];
    }

    void set(int index) {
        words[wordIndex(index)] |= bitMask(index);
    }

    void clear(int index) {
        words[wordIndex(index)] &= ~bitMask(index);
    }

    boolean get(int index) {
        return (words[wordIndex(index)] & bitMask(index)) != 0;
    }

    private static int wordIndex(int index) {
        if (index < 0) {
            throw new IndexOutOfBoundsException(index);
        }
        return index >>> 6; // divide by 64
    }

    private static long bitMask(int index) {
        return 1L << (index & 63);
    }
}
```

Kenapa `index >>> 6`?

```text
index / 64
```

Kenapa `index & 63`?

```text
index modulo 64
```

Namun hati-hati: kode di atas belum memvalidasi upper bound. Untuk library produksi, simpan `size` dan validasi `index < size`.

---

## 14. Bitmask sebagai Compact State Machine

Bitmask bisa dipakai untuk merepresentasikan state kombinatif.

Contoh lifecycle dokumen:

```java
static final int CREATED     = 1 << 0;
static final int VALIDATED   = 1 << 1;
static final int APPROVED    = 1 << 2;
static final int PUBLISHED   = 1 << 3;
static final int ARCHIVED    = 1 << 4;
static final int DELETED     = 1 << 5;
```

Namun ini berbahaya jika state sebenarnya saling eksklusif.

Contoh buruk:

```java
int state = APPROVED | DELETED | PUBLISHED;
```

Apakah valid? Mungkin tidak.

Bitmask cocok untuk **attributes/flags**, bukan selalu cocok untuk **exclusive state**.

Bedakan:

```text
Exclusive state:
  exactly one state is active.
  Better represented by enum/state machine.

Combinable flags:
  many flags can be active together.
  Bitmask is natural.
```

Contoh yang cocok:

```java
static final int NEEDS_REVIEW       = 1 << 0;
static final int HAS_ATTACHMENT     = 1 << 1;
static final int EXTERNAL_VISIBLE   = 1 << 2;
static final int REQUIRES_SIGNATURE = 1 << 3;
```

Jika kombinasi tertentu dilarang, encode invariant:

```java
static void validateDocumentFlags(int flags) {
    boolean external = (flags & EXTERNAL_VISIBLE) != 0;
    boolean needsReview = (flags & NEEDS_REVIEW) != 0;

    if (external && needsReview) {
        throw new IllegalStateException("document cannot be externally visible while still needing review");
    }
}
```

Prinsip:

```text
Bitmask compresses representation.
It does not remove the need for domain invariants.
```

---

## 15. Dirty Field Tracking dengan Bitmask

Dalam sistem enterprise, sering ada kebutuhan melacak field mana yang berubah.

Pendekatan umum:

```java
Set<String> dirtyFields = new HashSet<>();
```

Ini readable, tetapi mahal untuk hot path.

Jika field count tetap, bitmask bisa lebih efisien.

Contoh:

```java
final class UserPatch {
    private static final int NAME_BIT  = 1 << 0;
    private static final int EMAIL_BIT = 1 << 1;
    private static final int PHONE_BIT = 1 << 2;

    private int dirty;

    private String name;
    private String email;
    private String phone;

    public void setName(String name) {
        this.name = name;
        dirty |= NAME_BIT;
    }

    public void setEmail(String email) {
        this.email = email;
        dirty |= EMAIL_BIT;
    }

    public void setPhone(String phone) {
        this.phone = phone;
        dirty |= PHONE_BIT;
    }

    public boolean hasName() {
        return (dirty & NAME_BIT) != 0;
    }

    public boolean hasEmail() {
        return (dirty & EMAIL_BIT) != 0;
    }

    public boolean hasPhone() {
        return (dirty & PHONE_BIT) != 0;
    }
}
```

Use case:

- PATCH DTO
- audit change tracking
- partial update SQL
- event field mask
- validation only changed fields
- serialization field presence

Namun pastikan perbedaan ini jelas:

```text
field absent
field present with null
field present with value
```

Bitmask bisa merepresentasikan presence, sementara value bisa null.

Contoh:

```java
patch.setEmail(null);
```

Artinya email field present dan ingin dihapus, bukan field tidak dikirim.

---

## 16. Nullability Bitmap

Banyak binary format dan database engine memakai null bitmap.

Misalkan ada 8 kolom:

```text
bit 0: column 0 is null
bit 1: column 1 is null
...
bit 7: column 7 is null
```

Contoh:

```java
static boolean isNull(byte nullBitmap, int columnIndex) {
    if (columnIndex < 0 || columnIndex >= 8) {
        throw new IllegalArgumentException("column index out of range");
    }
    int mask = 1 << columnIndex;
    return ((nullBitmap & 0xFF) & mask) != 0;
}
```

Untuk banyak kolom:

```java
static boolean isNull(byte[] bitmap, int columnIndex) {
    if (columnIndex < 0) {
        throw new IllegalArgumentException("negative column index");
    }
    int byteIndex = columnIndex >>> 3; // / 8
    int bitIndex = columnIndex & 7;    // % 8

    if (byteIndex >= bitmap.length) {
        throw new IllegalArgumentException("column index outside bitmap");
    }

    return ((bitmap[byteIndex] & 0xFF) & (1 << bitIndex)) != 0;
}
```

Catatan penting:

```text
Bit order must be documented.
```

Apakah kolom pertama disimpan di least significant bit atau most significant bit?

Dua format berbeda:

```text
LSB-first:
  column 0 => bit 0 => 0000_0001

MSB-first:
  column 0 => bit 7 => 1000_0000
```

Jangan anggap semua protocol sama.

---

## 17. Bit Order vs Byte Order

Ini sering tertukar.

```text
Byte order / endianness:
  urutan byte dalam multi-byte value.

Bit order:
  penomoran bit di dalam byte/word.
```

Contoh 16-bit value `0x1234`:

Big-endian byte order:

```text
12 34
```

Little-endian byte order:

```text
34 12
```

Tetapi bit numbering dalam satu byte masih perlu didefinisikan oleh protocol jika field bit-level dipakai.

Contoh:

```text
byte = 0b1000_0000
```

Apakah bit ini disebut bit 7 atau bit 0?

Di kebanyakan kode Java, kita biasanya memakai LSB indexing:

```java
1 << 0 // least significant bit
1 << 7 // most significant bit in byte
```

Namun dalam beberapa protocol/documentation, bit numbering bisa dimulai dari MSB.

Guideline:

```text
Always translate protocol bit numbering into code-level constants.
Never scatter raw shifts from protocol diagrams directly into business code.
```

---

## 18. Binary Protocol Header Example

Misalkan kita punya 1-byte header:

```text
bit 7      : encrypted
bit 6      : compressed
bits 5..4  : priority, 0..3
bits 3..0  : message type, 0..15
```

Implementasi:

```java
public final class MessageHeader {
    private static final int ENCRYPTED_MASK  = 0b1000_0000;
    private static final int COMPRESSED_MASK = 0b0100_0000;
    private static final int PRIORITY_MASK   = 0b0011_0000;
    private static final int TYPE_MASK       = 0b0000_1111;

    private static final int PRIORITY_SHIFT = 4;

    private final int value; // unsigned byte, 0..255

    private MessageHeader(int value) {
        if ((value & ~0xFF) != 0) {
            throw new IllegalArgumentException("header must fit in one byte: " + value);
        }
        this.value = value;
    }

    public static MessageHeader of(boolean encrypted, boolean compressed, int priority, int type) {
        if ((priority & ~0b11) != 0) {
            throw new IllegalArgumentException("priority must be 0..3: " + priority);
        }
        if ((type & ~0b1111) != 0) {
            throw new IllegalArgumentException("type must be 0..15: " + type);
        }

        int value = 0;
        if (encrypted) {
            value |= ENCRYPTED_MASK;
        }
        if (compressed) {
            value |= COMPRESSED_MASK;
        }
        value |= priority << PRIORITY_SHIFT;
        value |= type;

        return new MessageHeader(value);
    }

    public static MessageHeader fromByte(byte b) {
        return new MessageHeader(b & 0xFF);
    }

    public boolean encrypted() {
        return (value & ENCRYPTED_MASK) != 0;
    }

    public boolean compressed() {
        return (value & COMPRESSED_MASK) != 0;
    }

    public int priority() {
        return (value & PRIORITY_MASK) >>> PRIORITY_SHIFT;
    }

    public int type() {
        return value & TYPE_MASK;
    }

    public byte toByte() {
        return (byte) value;
    }

    public int unsignedValue() {
        return value;
    }
}
```

Kenapa `value` disimpan sebagai `int`, bukan `byte`?

Karena Java `byte` signed. Dengan `int` 0..255, operasi lebih jelas.

Guideline:

```text
When representing unsigned byte semantics in Java, store as int with invariant 0..255 at boundaries.
```

---

## 19. Bit Flags untuk Authorization: Jangan Kehilangan Auditability

Bitmask permission sering menggoda:

```java
int permissions = READ | WRITE | DELETE;
```

Masalahnya bukan performa, tetapi auditability.

Dalam sistem regulatory/enterprise, kita sering perlu menjawab:

- siapa memberi permission?
- kapan berubah?
- permission mana yang implied?
- permission mana yang inherited?
- permission mana yang denied eksplisit?
- permission mana yang berasal dari role vs override?

Bitmask raw bisa menyembunyikan provenance.

Desain yang lebih sehat:

```text
Domain layer:
  Role, Permission, Grant, Deny, Inheritance, AuditRecord

Optimization/internal layer:
  computed effective permission mask
```

Contoh:

```java
record EffectivePermissionMask(int value) {
    boolean canRead() {
        return (value & Permissions.READ) != 0;
    }

    boolean canWrite() {
        return (value & Permissions.WRITE) != 0;
    }
}
```

Mask digunakan sebagai hasil komputasi, bukan sumber kebenaran tunggal.

Prinsip:

```text
A bitmask can answer "is this permission active?"
It usually cannot answer "why is this permission active?"
```

---

## 20. Bloom Filter Concept

Bloom filter adalah struktur probabilistik untuk menjawab:

```text
"Mungkin ada" atau "pasti tidak ada".
```

Ia menggunakan bit array dan beberapa hash function.

Konsep:

```text
insert(value):
  hash value ke beberapa posisi bit
  set semua posisi tersebut

mightContain(value):
  cek semua posisi bit
  jika ada yang 0 => pasti tidak ada
  jika semua 1 => mungkin ada
```

Pseudo Java sederhana:

```java
final class SimpleBloomFilter {
    private final BitSet bits;
    private final int size;

    SimpleBloomFilter(int size) {
        this.bits = new BitSet(size);
        this.size = size;
    }

    void add(String value) {
        bits.set(index(hash1(value)));
        bits.set(index(hash2(value)));
    }

    boolean mightContain(String value) {
        return bits.get(index(hash1(value)))
            && bits.get(index(hash2(value)));
    }

    private int index(int hash) {
        return Math.floorMod(hash, size);
    }

    private static int hash1(String value) {
        return value.hashCode();
    }

    private static int hash2(String value) {
        int h = value.hashCode();
        h ^= (h >>> 16);
        h *= 0x7FEB_352D;
        h ^= (h >>> 15);
        return h;
    }
}
```

Catatan: ini contoh edukatif, bukan Bloom filter produksi.

Use case:

- menghindari lookup mahal ketika data pasti tidak ada
- cache penetration guard
- pre-check membership
- large deny/allow approximate set

Trade-off:

| Aspek | Bloom filter |
|---|---|
| false negative | tidak ada, jika implementasi benar |
| false positive | ada |
| delete | tidak didukung oleh Bloom filter standar |
| memory | sangat compact |
| correctness | cocok hanya jika false positive bisa diterima |

Invariant:

```text
Never use a plain Bloom filter where false positives are not acceptable.
```

---

## 21. Bitmap Index Concept

Bitmap index merepresentasikan membership sebagai bit.

Misalkan ada 8 user:

```text
user id: 0 1 2 3 4 5 6 7
```

Role ADMIN:

```text
ADMIN bitmap:  1 0 0 1 0 0 0 1
```

Role ACTIVE:

```text
ACTIVE bitmap: 1 1 0 1 1 0 0 1
```

Query:

```text
ADMIN and ACTIVE
```

Dapat dilakukan dengan AND:

```text
10010001
AND 11011001
=   10010001
```

Di Java:

```java
BitSet admin = new BitSet();
BitSet active = new BitSet();

BitSet result = (BitSet) admin.clone();
result.and(active);
```

Bitmap index kuat untuk:

- set intersection
- set union
- filtering multi-criteria
- columnar analytics
- ACL expansion
- precomputed eligibility

Namun raw `BitSet` cocok jika index dense. Jika ID sangat sparse, perlu mapping ID ke dense ordinal atau compressed bitmap.

Mental model:

```text
Bitmap turns filtering into word-level boolean algebra.
One CPU operation can process many logical records.
```

---

## 22. Counting Bits

Java menyediakan helper:

```java
int count = Integer.bitCount(mask);
int longCount = Long.bitCount(word);
```

Use case:

- count active flags
- count occupied seats
- Hamming weight
- bitmap cardinality
- validation exactly one bit

Exactly one bit:

```java
static boolean hasExactlyOneBit(int value) {
    return value != 0 && (value & (value - 1)) == 0;
}
```

Kenapa bekerja?

Jika value adalah power of two, hanya satu bit aktif.

Contoh:

```text
0100
0011  // value - 1
---- AND
0000
```

Jika lebih dari satu bit:

```text
0110
0101
---- AND
0100
```

Validasi enum-like bit field:

```java
static void requireSingleMode(int modeMask) {
    if (!hasExactlyOneBit(modeMask)) {
        throw new IllegalArgumentException("exactly one mode required");
    }
}
```

---

## 23. Align Up dan Align Down

Alignment sering muncul dalam memory layout, buffer, mmap, allocator, dan protocol.

Jika alignment power of two, kita bisa memakai bit operation.

Align up:

```java
static long alignUp(long value, long alignment) {
    if (alignment <= 0 || (alignment & (alignment - 1)) != 0) {
        throw new IllegalArgumentException("alignment must be power of two");
    }
    return (value + alignment - 1) & -alignment;
}
```

Align down:

```java
static long alignDown(long value, long alignment) {
    if (alignment <= 0 || (alignment & (alignment - 1)) != 0) {
        throw new IllegalArgumentException("alignment must be power of two");
    }
    return value & -alignment;
}
```

Contoh:

```java
alignUp(13, 8)   // 16
alignDown(13, 8) // 8
```

Kenapa `-alignment`?

Untuk power-of-two alignment, two's complement `-alignment` menghasilkan mask yang membersihkan bit bawah.

Contoh alignment 8:

```text
alignment = 0000_1000
-alignment = 1111_1000
```

Maka:

```text
13 = 0000_1101
&    1111_1000
=    0000_1000
```

Catatan:

- hati-hati overflow pada `value + alignment - 1`
- untuk API umum, gunakan `Math.addExact` atau validasi batas

---

## 24. Rounding ke Power of Two

Banyak struktur internal menggunakan capacity power-of-two karena modulo bisa diganti mask.

Jika capacity = 16:

```java
index = hash & (capacity - 1);
```

Karena `capacity - 1` menjadi mask bit bawah:

```text
16 - 1 = 15 = 0b1111
```

Namun ini hanya benar jika capacity power of two.

Check:

```java
static boolean isPowerOfTwo(int value) {
    return value > 0 && (value & (value - 1)) == 0;
}
```

Round up ke power of two:

```java
static int nextPowerOfTwo(int value) {
    if (value <= 0) {
        return 1;
    }
    if (value > (1 << 30)) {
        throw new IllegalArgumentException("too large: " + value);
    }
    return 1 << (Integer.SIZE - Integer.numberOfLeadingZeros(value - 1));
}
```

Contoh:

```java
nextPowerOfTwo(1)  // 1
nextPowerOfTwo(2)  // 2
nextPowerOfTwo(3)  // 4
nextPowerOfTwo(17) // 32
```

Use case:

- ring buffer
- hash table capacity
- bitmap word sizing
- allocator block class

---

## 25. Ring Buffer Indexing dengan Mask

Jika ring buffer capacity power-of-two, wrap-around bisa memakai mask.

```java
final class IntRingBuffer {
    private final int[] elements;
    private final int mask;
    private long head;
    private long tail;

    IntRingBuffer(int capacityPowerOfTwo) {
        if (!isPowerOfTwo(capacityPowerOfTwo)) {
            throw new IllegalArgumentException("capacity must be power of two");
        }
        this.elements = new int[capacityPowerOfTwo];
        this.mask = capacityPowerOfTwo - 1;
    }

    void add(int value) {
        if (tail - head == elements.length) {
            throw new IllegalStateException("full");
        }
        elements[(int) tail & mask] = value;
        tail++;
    }

    int remove() {
        if (tail == head) {
            throw new IllegalStateException("empty");
        }
        int value = elements[(int) head & mask];
        head++;
        return value;
    }

    private static boolean isPowerOfTwo(int value) {
        return value > 0 && (value & (value - 1)) == 0;
    }
}
```

Catatan:

- Ini contoh single-threaded edukatif.
- Jangan langsung dipakai sebagai lock-free concurrent ring buffer tanpa memory ordering yang benar.
- `head` dan `tail` memakai `long` agar tidak cepat overflow.

Mental model:

```text
Power-of-two capacity converts modulo indexing into bit masking.
```

---

## 26. XOR Patterns

XOR memiliki properti:

```text
a ^ a = 0
a ^ 0 = a
a ^ b ^ b = a
```

Use case:

### 26.1 Toggle Flag

```java
flags ^= DEBUG_ENABLED;
```

### 26.2 Difference Mask

```java
int changed = oldFlags ^ newFlags;
```

Lalu cek bit mana berubah:

```java
boolean readChanged = (changed & READ) != 0;
```

### 26.3 Simple Parity/Checksum-like Reasoning

XOR sering muncul dalam checksum sederhana, parity, RAID parity, dan hash mixing.

Namun jangan gunakan XOR sederhana sebagai security checksum.

```text
XOR is useful for bit algebra.
XOR is not cryptographic integrity.
```

---

## 27. Bit Manipulation dan Hashing

Hash mixing sering memakai shift, rotate, xor, dan multiply.

Contoh sederhana:

```java
static int mix(int x) {
    x ^= x >>> 16;
    x *= 0x7FEB_352D;
    x ^= x >>> 15;
    x *= 0x846C_A68B;
    x ^= x >>> 16;
    return x;
}
```

Poin utama:

- `>>>` mencegah sign extension.
- XOR menggabungkan high bits ke low bits.
- multiplication membantu avalanche.

Namun dalam kode produksi, gunakan hash function/library yang sesuai. Jangan mendesain hash sendiri untuk security atau distributed partitioning kritis tanpa validasi serius.

Use case yang lebih aman:

```java
int bucket = mix(keyHash) & (capacity - 1);
```

Jika capacity power-of-two, low bits sangat penting. Hash yang buruk pada low bits akan menghasilkan bucket distribution buruk.

---

## 28. Common Bit Bugs di Java

### 28.1 Lupa Mask Byte

Bug:

```java
byte b = (byte) 0xFE;
int x = b; // -2
```

Fix:

```java
int x = b & 0xFF; // 254
```

### 28.2 Memakai `>>` Saat Butuh `>>>`

Bug:

```java
int high = value >> 24;
```

Jika `value` negatif, `high` bisa sign-extended.

Fix:

```java
int high = (value >>> 24) & 0xFF;
```

### 28.3 `1 << 31` Disangka Positif

Bug:

```java
int flag = 1 << 31;
System.out.println(flag > 0); // false
```

Fix tergantung kebutuhan:

```java
int flag = 1 << 31;     // valid bit pattern, signed negative
long flagLong = 1L << 31; // positive long 2147483648
```

### 28.4 Shift by 32/64 Disangka Zero

Bug:

```java
int x = 1 << 32; // actually 1
```

Fix:

```java
if (shift < 0 || shift >= Integer.SIZE) {
    throw new IllegalArgumentException();
}
```

### 28.5 Masking Bukannya Validasi

Bug:

```java
int priority = input & 0b11;
```

Jika input 99, diam-diam menjadi 3.

Fix:

```java
if ((input & ~0b11) != 0) {
    throw new IllegalArgumentException("priority must be 0..3");
}
```

### 28.6 Mencampur Domain Mask

Bug:

```java
int userPermissions = ORDER_STATUS_CANCELLED | READ;
```

Karena keduanya `int`, compiler tidak bisa mencegah.

Fix:

- gunakan wrapper type
- gunakan enum/domain-specific class
- jangan expose raw mask sembarangan

### 28.7 Persist Ordinal Enum

Bug:

```java
int mask = 1 << permission.ordinal();
```

Jika enum direorder, storage rusak.

Fix:

```java
enum Permission {
    READ(1 << 0),
    WRITE(1 << 1);

    final int bit;
    Permission(int bit) { this.bit = bit; }
}
```

### 28.8 Signed Byte dalam Protocol

Bug:

```java
byte type = buffer.get();
if (type == 200) { // compile issue / impossible semantics
}
```

Fix:

```java
int type = buffer.get() & 0xFF;
if (type == 200) {
    // ok
}
```

---

## 29. Debugging Bit-Level Code

Helper formatting sangat penting.

```java
static String binary8(int value) {
    return String.format("%8s", Integer.toBinaryString(value & 0xFF)).replace(' ', '0');
}

static String binary32(int value) {
    return String.format("%32s", Integer.toBinaryString(value)).replace(' ', '0');
}
```

Contoh:

```java
int header = 0b1011_0010;
System.out.println(binary8(header));
```

Output:

```text
10110010
```

Untuk debugging protocol:

```java
static void printHeader(int header) {
    System.out.println("raw       = " + binary8(header));
    System.out.println("encrypted = " + ((header & 0b1000_0000) != 0));
    System.out.println("compressed= " + ((header & 0b0100_0000) != 0));
    System.out.println("priority  = " + ((header & 0b0011_0000) >>> 4));
    System.out.println("type      = " + (header & 0b0000_1111));
}
```

Guideline:

```text
For every non-trivial packed format, write debug printers and golden tests.
```

---

## 30. Testing Bit-Level Code

Bit-level code harus dites dengan boundary values.

Untuk 8-bit field:

- 0
- 1
- max valid: 255
- invalid: -1
- invalid: 256
- random valid values

Contoh test manual:

```java
static void assertEquals(int expected, int actual) {
    if (expected != actual) {
        throw new AssertionError("expected=" + expected + ", actual=" + actual);
    }
}

public static void main(String[] args) {
    int word = pack(1, 2, 3, 4);

    assertEquals(1, version(word));
    assertEquals(2, type(word));
    assertEquals(3, status(word));
    assertEquals(4, flags(word));
}
```

Property-like invariant:

```java
for (int version = 0; version <= 255; version++) {
    for (int type = 0; type <= 255; type++) {
        int word = pack(version, type, 0, 0);
        assertEquals(version, version(word));
        assertEquals(type, type(word));
    }
}
```

Untuk format packed:

```text
unpack(pack(x)) == x
```

adalah invariant utama.

Untuk flags:

```text
has(grant(flags, bit), bit) == true
has(revoke(flags, bit), bit) == false
```

Untuk toggle:

```text
toggle(toggle(flags, bit), bit) == flags
```

---

## 31. Bit-Level API Design Checklist

Saat membuat bit-level API, jawab pertanyaan ini:

1. Apakah bit numbering sudah jelas?
2. Apakah byte order sudah jelas?
3. Apakah field signed atau unsigned?
4. Apakah masking dilakukan hanya setelah validasi?
5. Apakah invalid value ditolak atau ditruncate?
6. Apakah raw integer diekspos ke domain layer?
7. Apakah enum ordinal dipakai untuk persistent format?
8. Apakah ada helper debug binary/hex?
9. Apakah ada golden test dengan contoh byte nyata?
10. Apakah ada test boundary?
11. Apakah ada invariant untuk kombinasi flag yang dilarang?
12. Apakah operasi thread-safe dibutuhkan?
13. Apakah memory saving sepadan dengan complexity?
14. Apakah format perlu backward/forward compatibility?
15. Apakah field reserved disimpan dan tidak dirusak saat reserialize?

---

## 32. Reserved Bits dan Compatibility

Protocol yang baik sering menyisakan reserved bits.

Contoh:

```text
bit 7      : encrypted
bit 6      : compressed
bits 5..4  : reserved
bits 3..0  : type
```

Saat membaca data dari masa depan, reserved bits mungkin sudah memiliki makna baru.

Ada dua strategi:

### Strict Strategy

Tolak jika reserved bits aktif.

```java
static final int RESERVED_MASK = 0b0011_0000;

if ((header & RESERVED_MASK) != 0) {
    throw new IllegalArgumentException("reserved bits must be zero");
}
```

Cocok untuk:

- protocol internal strict
- security-sensitive format
- mencegah silent misinterpretation

### Preserve Strategy

Simpan reserved bits dan tulis balik tanpa mengubah.

Cocok untuk:

- proxy
- gateway
- forward-compatible intermediary

Contoh:

```java
final class Header {
    private final int raw;

    Header(int raw) {
        this.raw = raw & 0xFF;
    }

    Header withType(int type) {
        if ((type & ~0xF) != 0) {
            throw new IllegalArgumentException();
        }
        int updated = (raw & ~0x0F) | type;
        return new Header(updated);
    }
}
```

Di sini bits lain tetap dipertahankan.

Prinsip:

```text
Reserved bits are part of compatibility design, not unused trash.
```

---

## 33. Memory Perspective: Kenapa Bit Packing Bisa Signifikan?

Misalkan 10 juta object masing-masing memiliki 8 boolean field.

Jika setiap field menjadi boolean instance field, layout object tetap dipengaruhi:

- object header
- field packing
- alignment
- padding
- reference graph jika boolean disimpan di object terpisah/collection

Jika state disimpan sebagai satu `int flags`, footprint bisa lebih predictable.

Contoh:

```java
final class UserStateA {
    boolean active;
    boolean locked;
    boolean verified;
    boolean deleted;
    boolean external;
    boolean privileged;
    boolean migrated;
    boolean risky;
}

final class UserStateB {
    int flags;
}
```

Bukan berarti `UserStateB` selalu jauh lebih kecil, karena HotSpot field layout dan alignment bisa membuat beberapa boolean cukup padat. Namun `int flags` memberi:

- operasi atomic-ish lebih sederhana untuk snapshot immutable
- serialization lebih compact
- database/protocol mapping lebih kecil
- fewer fields
- easier changed-mask diff

Dalam jumlah kecil, perbedaan tidak penting.

Dalam jutaan object atau high-throughput binary representation, perbedaan bisa signifikan.

---

## 34. Bit Manipulation dan GC

Bit-level representation dapat mengurangi tekanan GC karena:

1. Mengurangi jumlah object.
2. Mengurangi reference graph depth.
3. Mengurangi pointer chasing.
4. Mengurangi allocation temporary collection.
5. Meningkatkan locality.
6. Membuat data lebih compact sehingga live set lebih kecil.

Contoh boros:

```java
Set<Permission> permissions = new HashSet<>();
```

Untuk jutaan entity, ini dapat menghasilkan banyak object:

- HashSet
- HashMap internal
- Node/table
- references
- enum references

Alternatif compact:

```java
int permissionMask;
```

Namun jangan salah:

```text
Lower memory is not automatically better design.
```

Jika bitmask membuat domain logic kabur, bug correctness bisa lebih mahal daripada memory saving.

Pattern sehat:

```text
External/domain-facing API: readable and type-safe.
Internal/storage/hot-path representation: compact bitmask.
```

---

## 35. Bit Manipulation dan Concurrency

Bit flags kadang dipakai bersama atomic operation.

Contoh dengan `AtomicInteger`:

```java
final class AtomicFlags {
    private final AtomicInteger flags = new AtomicInteger();

    void set(int mask) {
        flags.getAndUpdate(current -> current | mask);
    }

    void clear(int mask) {
        flags.getAndUpdate(current -> current & ~mask);
    }

    boolean has(int mask) {
        return (flags.get() & mask) != 0;
    }
}
```

Ini berguna untuk state flags concurrent sederhana.

Namun hati-hati:

```text
Atomic bit update does not automatically make the whole state machine correct.
```

Jika invariant melibatkan banyak field, bitmask atomic saja tidak cukup.

Contoh masalah:

```text
flag A and flag B must not both be active.
```

Maka update harus mempertimbangkan invariant dalam satu CAS loop.

```java
void enableAOnly() {
    flags.getAndUpdate(current -> (current | A) & ~B);
}
```

Untuk invariant lebih kompleks, gunakan lock atau state object immutable dengan atomic reference.

---

## 36. Case Study: Compact Event Metadata

Misalkan event memiliki metadata:

- source: 0..15
- priority: 0..3
- retryable: boolean
- encrypted: boolean
- schema version: 0..255

Naive object:

```java
final class EventMetadataNaive {
    int source;
    int priority;
    boolean retryable;
    boolean encrypted;
    int schemaVersion;
}
```

Packed 32-bit:

```text
31..24 schemaVersion
23..20 source
19..18 priority
17     retryable
16     encrypted
15..0  reserved
```

Implementation:

```java
public final class EventMetadata {
    private static final int SCHEMA_SHIFT = 24;
    private static final int SOURCE_SHIFT = 20;
    private static final int PRIORITY_SHIFT = 18;
    private static final int RETRYABLE_BIT = 1 << 17;
    private static final int ENCRYPTED_BIT = 1 << 16;

    private static final int SCHEMA_MASK = 0xFF << SCHEMA_SHIFT;
    private static final int SOURCE_MASK = 0x0F << SOURCE_SHIFT;
    private static final int PRIORITY_MASK = 0x03 << PRIORITY_SHIFT;

    private final int raw;

    private EventMetadata(int raw) {
        this.raw = raw;
    }

    public static EventMetadata of(int schemaVersion, int source, int priority,
                                   boolean retryable, boolean encrypted) {
        requireFits("schemaVersion", schemaVersion, 8);
        requireFits("source", source, 4);
        requireFits("priority", priority, 2);

        int raw = 0;
        raw |= schemaVersion << SCHEMA_SHIFT;
        raw |= source << SOURCE_SHIFT;
        raw |= priority << PRIORITY_SHIFT;
        if (retryable) {
            raw |= RETRYABLE_BIT;
        }
        if (encrypted) {
            raw |= ENCRYPTED_BIT;
        }
        return new EventMetadata(raw);
    }

    public int schemaVersion() {
        return (raw & SCHEMA_MASK) >>> SCHEMA_SHIFT;
    }

    public int source() {
        return (raw & SOURCE_MASK) >>> SOURCE_SHIFT;
    }

    public int priority() {
        return (raw & PRIORITY_MASK) >>> PRIORITY_SHIFT;
    }

    public boolean retryable() {
        return (raw & RETRYABLE_BIT) != 0;
    }

    public boolean encrypted() {
        return (raw & ENCRYPTED_BIT) != 0;
    }

    public int raw() {
        return raw;
    }

    private static void requireFits(String name, int value, int bits) {
        if (bits <= 0 || bits >= Integer.SIZE) {
            throw new IllegalArgumentException("invalid bit width");
        }
        int max = (1 << bits) - 1;
        if (value < 0 || value > max) {
            throw new IllegalArgumentException(name + " must fit in " + bits + " bits: " + value);
        }
    }
}
```

Perhatikan design discipline:

- raw constructor private
- field width divalidasi
- constants diberi nama
- decode method eksplisit
- reserved bits tersedia
- raw value bisa dipersist/ditransmisikan

---

## 37. Performance Perspective: Jangan Over-Optimize Prematur

Bit manipulation sering diasosiasikan dengan performance. Tetapi performa modern tidak sesederhana “bit operation pasti cepat”.

Yang sering lebih menentukan:

- allocation rate
- memory bandwidth
- cache locality
- branch prediction
- object graph shape
- false sharing
- GC live set
- vectorization opportunity
- clarity of invariant

Contoh:

```java
boolean hasRead = permissions.contains(Permission.READ);
```

Bisa cukup cepat jika tidak di hot path.

Mengganti semuanya dengan:

```java
(flags & 0x04_00_00_00) != 0
```

bisa memperburuk maintainability tanpa manfaat nyata.

Guideline:

```text
Use bit manipulation first for representation correctness/compactness,
then for performance only when profiling supports it.
```

---

## 38. Practical Design Patterns

### Pattern 1 — Internal Mask, External EnumSet

```java
final class PermissionModel {
    private final int mask;

    PermissionModel(EnumSet<Permission> permissions) {
        this.mask = toMask(permissions);
    }

    EnumSet<Permission> permissions() {
        return fromMask(mask);
    }
}
```

Cocok untuk API yang butuh readability tetapi storage compact.

### Pattern 2 — Packed Header Value Object

```java
record Header(int raw) {
    Header {
        if ((raw & ~0xFF) != 0) {
            throw new IllegalArgumentException();
        }
    }
}
```

Cocok untuk protocol parsing.

### Pattern 3 — Dirty Mask

```java
int dirtyMask;
```

Cocok untuk patch/update/audit.

### Pattern 4 — BitSet for Dense Index

```java
BitSet activeUsers;
```

Cocok untuk large boolean indexed state.

### Pattern 5 — Word Array for Custom Layout

```java
long[] bitmap;
```

Cocok jika butuh kontrol penuh dan operasi khusus.

---

## 39. Review Checklist untuk Code Review

Saat review bit manipulation code, cek:

1. Apakah setiap mask punya nama?
2. Apakah tidak ada magic number tanpa komentar?
3. Apakah signed/unsigned interpretation eksplisit?
4. Apakah `byte` dimask dengan `0xFF` saat perlu unsigned?
5. Apakah `>>>` digunakan saat extract unsigned high bits?
6. Apakah shift count divalidasi?
7. Apakah field width divalidasi?
8. Apakah masking tidak menyembunyikan invalid input?
9. Apakah bit numbering sesuai spec/protocol?
10. Apakah endian dan bit order tidak tertukar?
11. Apakah ada tests untuk boundary?
12. Apakah reserved bits ditangani sadar?
13. Apakah raw mask tidak bocor ke layer yang salah?
14. Apakah enum ordinal tidak dipakai sebagai storage contract?
15. Apakah concurrency invariant benar jika mask diupdate bersama?

---

## 40. Ringkasan Mental Model

Bit manipulation di Java harus dipahami sebagai kombinasi dari tiga hal:

```text
1. Bit pattern
2. Interpretation
3. Invariant
```

Bit pattern sendiri tidak punya makna.

Contoh:

```text
1111_1111
```

Bisa berarti:

- unsigned byte 255
- signed byte -1
- all flags active
- invalid reserved field
- bitmask permission
- part of UTF-8 byte sequence
- protocol marker

Makna datang dari konteks.

Karena itu, kode bit-level yang baik harus:

1. Memberi nama pada mask.
2. Menjelaskan layout.
3. Memvalidasi field width.
4. Membedakan signed vs unsigned.
5. Memisahkan domain API dari raw representation.
6. Menyediakan tests dan debug helpers.
7. Menghindari magic numbers.
8. Mempertahankan compatibility contract.

---

## 41. Koneksi ke Bagian Berikutnya

Bagian ini membahas representasi bit-level secara praktikal.

Bagian berikutnya akan naik satu layer ke struktur yang sangat penting dalam Java I/O dan memory engineering:

```text
ByteBuffer
```

Kita akan membahas:

- `capacity`
- `position`
- `limit`
- `mark`
- `flip`
- `clear`
- `compact`
- heap buffer
- direct buffer
- slice
- duplicate
- view buffer
- byte order
- absolute vs relative access
- state machine mental model
- bug umum dalam penggunaan buffer

Bit manipulation yang kita pelajari di bagian ini akan sering muncul saat membaca/menulis field binary melalui `ByteBuffer`.

---

# Status Seri

```text
Part 010 selesai.
Seri belum selesai.
Masih lanjut ke part 011 sampai part 030.
```

Part berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-011.md
```

Topik berikutnya:

```text
ByteBuffer Deep Dive: Heap Buffer, Direct Buffer, Slice, Duplicate, View
```
