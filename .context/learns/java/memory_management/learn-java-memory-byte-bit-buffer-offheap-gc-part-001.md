# learn-java-memory-byte-bit-buffer-offheap-gc-part-001.md

# Part 001 — Bits, Bytes, Words, Alignment, Endianness: Fondasi Representasi Data

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `001 / 030`  
> Topik utama: bit, byte, word, signedness, two's complement, masking, shifting, byte order, alignment, dan cara membaca data biner secara benar di Java 8–25.

---

## 0. Tujuan Bagian Ini

Setelah bagian ini, targetnya bukan sekadar bisa memakai operator `&`, `|`, `^`, `~`, `<<`, `>>`, `>>>`.

Target yang lebih penting adalah kamu punya mental model yang cukup kuat untuk menjawab pertanyaan seperti:

1. Kenapa `byte` Java bernilai `-128..127`, padahal byte sering dipakai untuk data biner `0..255`?
2. Kenapa `(byte) 0xFF` menjadi `-1`, tetapi tetap merepresentasikan bit pattern `11111111`?
3. Kenapa `b & 0xFF` sering muncul ketika membaca network/file binary format?
4. Apa bedanya `>>` dan `>>>`, dan kenapa bug sign extension sering terjadi?
5. Kenapa `ByteBuffer` punya `ByteOrder`, dan kenapa default-nya penting?
6. Apa arti big-endian dan little-endian secara memory layout?
7. Kenapa protocol/network/file format harus eksplisit soal byte order?
8. Kenapa object alignment, word size, dan cache line penting walaupun Java menyembunyikan pointer?
9. Bagaimana cara berpikir ketika mendesain binary protocol, packed flags, bitmap, storage record, hash, compression, atau serialization?

Bagian ini adalah fondasi bawah sebelum masuk ke primitive layout, object layout, buffer, off-heap, memory-mapped file, FFM API, dan GC.

---

## 1. Mental Model Besar: Data Itu Bukan Angka, Data Itu Bit Pattern + Interpretasi

Kesalahan paling umum ketika membahas binary/memory adalah menganggap angka adalah sesuatu yang “ada begitu saja”.

Padahal pada level bawah:

```text
memory hanya menyimpan bit pattern
```

Contoh 8 bit:

```text
11111111
```

Bit pattern ini bisa diinterpretasikan sebagai:

| Interpretasi | Nilai |
|---|---:|
| unsigned 8-bit integer | 255 |
| signed 8-bit two's complement | -1 |
| bit mask | semua flag aktif |
| byte data mentah | 0xFF |
| bagian dari UTF-8 sequence | tergantung konteks |
| bagian dari checksum/hash | tergantung algoritma |

Jadi yang menentukan makna bukan hanya bit-nya, tetapi kontrak interpretasinya.

```text
same bits + different interpretation = different meaning
```

Ini penting di Java karena Java punya primitive signed untuk `byte`, `short`, `int`, dan `long`, tetapi banyak data dunia nyata memakai representasi unsigned:

- IPv4 octet: `0..255`
- TCP/UDP port: `0..65535`
- binary file header
- image format
- checksum
- hash
- compression block
- cryptographic byte stream
- protocol flags
- bitmap index
- off-heap record

Java tidak punya `unsigned byte` sebagai primitive tersendiri. Maka engineer Java harus fasih memisahkan:

```text
bit pattern fisik
vs
interpretasi numerik di Java
```

---

## 2. Unit Dasar: Bit, Nibble, Byte, Word, Cache Line

### 2.1 Bit

Bit adalah unit terkecil bernilai:

```text
0 atau 1
```

Satu bit bisa berarti:

- boolean flag
- sign bit
- part of integer magnitude
- permission bit
- compression marker
- parity bit
- bitmap membership
- state flag

Contoh bit flags:

```text
0000_0001 = CREATED
0000_0010 = VALIDATED
0000_0100 = APPROVED
0000_1000 = REJECTED
```

Satu byte bisa menyimpan banyak boolean state jika didesain sebagai bitset.

---

### 2.2 Nibble

Nibble adalah 4 bit.

```text
1 nibble = 4 bit
```

Satu digit hexadecimal merepresentasikan satu nibble:

```text
0x0 = 0000
0x1 = 0001
0x2 = 0010
...
0xA = 1010
0xF = 1111
```

Karena itu hexadecimal sangat cocok untuk membaca data biner. Dua digit hex = satu byte.

```text
0xAF = 1010_1111
       A    F
```

---

### 2.3 Byte

Secara praktis di platform modern:

```text
1 byte = 8 bit
```

Di Java, `byte` adalah signed 8-bit integer dengan range:

```text
-128 sampai 127
```

Tetapi sebagai storage, `byte` tetap menyimpan 8 bit.

Contoh:

```java
byte b = (byte) 0xFF;
System.out.println(b);          // -1
System.out.println(b & 0xFF);   // 255
```

Kedua output itu membaca bit yang sama:

```text
11111111
```

Bedanya:

```text
b sebagai signed byte       -> -1
b & 0xFF sebagai unsigned   -> 255
```

---

### 2.4 Word

“Word” berarti ukuran natural yang nyaman diproses CPU/arsitektur tertentu. Pada mesin modern, sering berkaitan dengan 32-bit atau 64-bit register dan pointer width.

Namun jangan menganggap word selalu sama di semua konteks. Istilah word bisa berarti:

| Konteks | Arti Umum |
|---|---|
| CPU architecture | register natural size |
| JVM object layout | alignment/pointer/object header concern |
| binary protocol | field 16-bit/32-bit tergantung spec |
| documentation lama | kadang 16-bit |

Dalam engineering Java modern, ketika membahas word, biasanya yang penting adalah:

1. apakah runtime 32-bit atau 64-bit,
2. apakah pointer/object reference dikompresi,
3. alignment object,
4. atomicity access,
5. CPU cache line interaction.

---

### 2.5 Cache Line

Cache line adalah unit transfer antara memory dan CPU cache. Banyak CPU modern memakai cache line 64 byte.

Java tidak mengekspos cache line secara langsung, tetapi efeknya terasa pada:

- false sharing,
- memory locality,
- array traversal performance,
- object graph pointer chasing,
- padding,
- data-oriented design,
- GC compaction locality.

Contoh mental model:

```text
CPU jarang mengambil 1 byte saja dari RAM.
CPU mengambil blok, misalnya 64 byte.
```

Maka membaca array primitive berurutan biasanya cache-friendly:

```java
long sum = 0;
for (int i = 0; i < values.length; i++) {
    sum += values[i];
}
```

Sedangkan membaca linked object graph sering buruk untuk cache:

```java
Node n = head;
while (n != null) {
    sum += n.value;
    n = n.next;
}
```

Karena tiap `Node` bisa berada di lokasi heap yang berjauhan.

Kita akan bahas locality lebih dalam di part CPU cache dan object layout. Di bagian ini cukup pegang satu invariant:

```text
layout data memengaruhi biaya akses data
```

---

## 3. Binary, Decimal, Hexadecimal: Tiga Cara Melihat Nilai yang Sama

Nilai yang sama bisa ditulis dalam base berbeda.

| Decimal | Binary | Hex |
|---:|---|---|
| 0 | `0000_0000` | `0x00` |
| 1 | `0000_0001` | `0x01` |
| 2 | `0000_0010` | `0x02` |
| 3 | `0000_0011` | `0x03` |
| 10 | `0000_1010` | `0x0A` |
| 15 | `0000_1111` | `0x0F` |
| 16 | `0001_0000` | `0x10` |
| 127 | `0111_1111` | `0x7F` |
| 128 unsigned | `1000_0000` | `0x80` |
| 255 unsigned | `1111_1111` | `0xFF` |

Hex lebih ringkas karena 1 digit hex = 4 bit.

```text
0xCAFE_BABE
```

Dibaca sebagai:

```text
CA FE BA BE
```

atau dalam bit:

```text
1100_1010 1111_1110 1011_1010 1011_1110
```

Di Java, underscore boleh dipakai dalam numeric literal untuk readability:

```java
int magic = 0xCAFE_BABE;
int mask  = 0b1111_0000;
long bits = 0xFFFF_FFFF_FFFF_FFFFL;
```

Gunakan hex ketika maksudnya bit pattern. Gunakan decimal ketika maksudnya angka domain biasa.

Contoh:

```java
int maxRetries = 3;        // domain number
int lowerByteMask = 0xFF;  // bit mask
```

---

## 4. Signed vs Unsigned: Masalah Interpretasi

### 4.1 Unsigned Integer

Unsigned integer memakai semua bit untuk magnitude.

Untuk 8 bit:

```text
0000_0000 = 0
0000_0001 = 1
0111_1111 = 127
1000_0000 = 128
1111_1111 = 255
```

Range unsigned N-bit:

```text
0 sampai 2^N - 1
```

Untuk 8 bit:

```text
0 sampai 255
```

Untuk 16 bit:

```text
0 sampai 65_535
```

Untuk 32 bit:

```text
0 sampai 4_294_967_295
```

---

### 4.2 Signed Integer Two's Complement

Java menggunakan two's complement untuk integer signed. Untuk N-bit signed integer, range-nya:

```text
-2^(N-1) sampai 2^(N-1)-1
```

Contoh 8-bit signed:

```text
-128 sampai 127
```

Bit paling kiri disebut sign bit secara interpretasi:

```text
0xxx_xxxx = non-negative
1xxx_xxxx = negative
```

Contoh:

| Bit Pattern | Signed 8-bit | Unsigned 8-bit |
|---|---:|---:|
| `0000_0000` | 0 | 0 |
| `0000_0001` | 1 | 1 |
| `0111_1111` | 127 | 127 |
| `1000_0000` | -128 | 128 |
| `1111_1111` | -1 | 255 |
| `1111_1110` | -2 | 254 |

---

### 4.3 Kenapa Two's Complement Dipakai?

Two's complement membuat operasi aritmetika hardware menjadi sederhana.

Contoh 8-bit:

```text
  0000_0001   1
+ 1111_1111  -1
-----------
1_0000_0000
```

Jika hanya simpan 8 bit terakhir:

```text
0000_0000 = 0
```

Aritmetika modulo ini sangat cocok dengan register fixed-width.

---

### 4.4 Cara Menghitung Nilai Negatif Two's Complement

Untuk mengetahui nilai signed dari bit negatif:

```text
1111_1010
```

Langkah manual:

1. invert semua bit:

```text
0000_0101
```

2. tambah 1:

```text
0000_0110 = 6
```

3. beri tanda negatif:

```text
-6
```

Jadi:

```text
1111_1010 = -6 sebagai signed 8-bit
```

---

## 5. Java Primitive Integer dan Range

Java integral primitive:

| Type | Width | Signed? | Range |
|---|---:|---|---:|
| `byte` | 8 bit | signed | -128..127 |
| `short` | 16 bit | signed | -32_768..32_767 |
| `char` | 16 bit | unsigned-like code unit | 0..65_535 |
| `int` | 32 bit | signed | -2^31..2^31-1 |
| `long` | 64 bit | signed | -2^63..2^63-1 |

Catatan penting:

1. `char` bukan integer signed; ia 16-bit UTF-16 code unit.
2. Java tidak punya unsigned `byte`, unsigned `short`, unsigned `int`, unsigned `long` sebagai primitive type terpisah.
3. Java menyediakan helper unsigned untuk beberapa operasi, misalnya `Integer.toUnsignedLong`, `Integer.compareUnsigned`, `Long.compareUnsigned`, `parseUnsignedInt`, dan lain-lain.
4. Untuk raw bytes, jangan berpikir `byte` sebagai angka domain. Pikirkan sebagai 8-bit container.

---

## 6. Literal dan Promosi Tipe: Sumber Bug Kecil tapi Mahal

### 6.1 Integer Literal Default adalah `int`

Di Java:

```java
0xFF
```

literal ini bertipe `int`, bukan `byte`.

Maka:

```java
byte b = 0x7F;        // valid, 127 muat ke byte
byte c = (byte) 0x80; // perlu cast, hasil bit pattern 1000_0000, nilai signed -128
byte d = (byte) 0xFF; // hasil bit pattern 1111_1111, nilai signed -1
```

---

### 6.2 Operasi pada `byte` dan `short` Dipromosikan ke `int`

Contoh:

```java
byte a = 1;
byte b = 2;
// byte c = a + b; // compile error
byte c = (byte) (a + b);
```

Karena `a + b` dipromosikan menjadi `int`.

Ini penting untuk bit operation:

```java
byte b = (byte) 0xF0;
int x = b >> 4;
```

`b` dipromosikan ke `int` dengan sign extension dulu.

Jika `b = 0xF0`, sebagai signed byte nilainya `-16`. Saat dipromosikan ke int:

```text
byte: 1111_0000
int : 1111_1111 1111_1111 1111_1111 1111_0000
```

Maka:

```java
int x = b >> 4; // -1, bukan 15
```

Cara benar jika ingin unsigned byte:

```java
int x = (b & 0xFF) >> 4; // 15
```

Invariant penting:

```text
mask dulu, baru shift, jika sumbernya byte signed tapi maksudnya unsigned byte
```

---

## 7. Sign Extension dan Zero Extension

### 7.1 Sign Extension

Sign extension terjadi ketika signed value dengan width lebih kecil diperluas ke width lebih besar sambil mempertahankan nilai signed.

Contoh `byte` ke `int`:

```java
byte b = (byte) 0x80; // -128
int i = b;
```

Bit-nya:

```text
byte b = 1000_0000
int i  = 1111_1111 1111_1111 1111_1111 1000_0000
```

Karena sign bit `1`, bit atas diisi `1`.

---

### 7.2 Zero Extension

Zero extension mengisi bit atas dengan `0`.

Di Java, untuk byte unsigned, pattern umum:

```java
int unsigned = b & 0xFF;
```

Contoh:

```text
b promoted to int:
1111_1111 1111_1111 1111_1111 1000_0000

mask 0xFF:
0000_0000 0000_0000 0000_0000 1111_1111

result:
0000_0000 0000_0000 0000_0000 1000_0000 = 128
```

---

### 7.3 Mask Berdasarkan Width

| Raw Width | Mask | Java Result Type Umum |
|---:|---:|---|
| 8 bit | `0xFF` | `int` |
| 16 bit | `0xFFFF` | `int` |
| 32 bit | `0xFFFF_FFFFL` | `long` |

Contoh:

```java
byte rawByte = (byte) 0xFE;
int u8 = rawByte & 0xFF; // 254

short rawShort = (short) 0xFFFE;
int u16 = rawShort & 0xFFFF; // 65534

int rawInt = 0xFFFF_FFFE;
long u32 = rawInt & 0xFFFF_FFFFL; // 4294967294
```

Perhatikan suffix `L` pada mask 32-bit unsigned. Tanpa `L`, `0xFFFF_FFFF` adalah `int -1`.

---

## 8. Bitwise Operators di Java

Java menyediakan operator bitwise untuk integral types.

| Operator | Nama | Fungsi |
|---|---|---|
| `&` | AND | bit 1 jika kedua sisi 1 |
| `|` | OR | bit 1 jika salah satu sisi 1 |
| `^` | XOR | bit 1 jika berbeda |
| `~` | NOT | invert semua bit |
| `<<` | left shift | geser kiri, isi kanan dengan 0 |
| `>>` | arithmetic right shift | geser kanan, pertahankan sign |
| `>>>` | logical right shift | geser kanan, isi kiri dengan 0 |

---

### 8.1 AND `&`

Dipakai untuk masking/testing.

```java
int flags = 0b1010;
boolean bitSet = (flags & 0b0010) != 0; // true
```

Tabel:

```text
0 & 0 = 0
0 & 1 = 0
1 & 0 = 0
1 & 1 = 1
```

---

### 8.2 OR `|`

Dipakai untuk menyalakan bit.

```java
int flags = 0;
flags |= 0b0100;
```

Tabel:

```text
0 | 0 = 0
0 | 1 = 1
1 | 0 = 1
1 | 1 = 1
```

---

### 8.3 XOR `^`

Dipakai untuk toggle, difference, parity, hash mixing.

```java
int flags = 0b0100;
flags ^= 0b0100; // menjadi 0
```

Tabel:

```text
0 ^ 0 = 0
0 ^ 1 = 1
1 ^ 0 = 1
1 ^ 1 = 0
```

---

### 8.4 NOT `~`

Invert semua bit.

```java
int x = 0b0000_1111;
int y = ~x;
```

Hati-hati: `~x` menginvert seluruh 32 bit untuk `int`, bukan hanya 8 bit yang terlihat.

Jika ingin membatasi ke 8 bit:

```java
int y8 = (~x) & 0xFF;
```

---

## 9. Shift Operators: `<<`, `>>`, `>>>`

### 9.1 Left Shift `<<`

```java
int x = 1 << 3; // 8
```

Bit:

```text
0000_0001 << 3 = 0000_1000
```

Secara umum, untuk angka positif dan tidak overflow:

```text
x << n ≈ x * 2^n
```

Tetapi jangan gunakan ini sebagai “optimisasi” sembarangan. JIT modern sudah pintar. Gunakan shift saat maksudnya bit manipulation, bukan supaya terlihat low-level.

---

### 9.2 Arithmetic Right Shift `>>`

`>>` mempertahankan sign bit.

```java
int x = -8;
int y = x >> 1; // -4
```

Untuk nilai negatif, bit kiri diisi `1`.

```text
1111_1000 >> 1 = 1111_1100
```

---

### 9.3 Logical Right Shift `>>>`

`>>>` mengisi bit kiri dengan `0`.

```java
int x = -1;
int y = x >>> 1;
```

Bit:

```text
1111_1111 1111_1111 1111_1111 1111_1111
>>>
0111_1111 1111_1111 1111_1111 1111_1111
```

Nilainya menjadi:

```text
2147483647
```

Gunakan `>>>` ketika yang kamu proses adalah bit pattern unsigned/logical, misalnya hash, checksum, encoding, bitmap, atau binary parser.

---

### 9.4 Shift Distance Dimasking oleh Java

Untuk `int`, Java hanya memakai 5 bit terbawah dari shift distance. Artinya shift distance efektif modulo 32.

```java
1 << 32 // sama seperti 1 << 0
1 << 33 // sama seperti 1 << 1
```

Untuk `long`, Java memakai 6 bit terbawah. Artinya efektif modulo 64.

```java
1L << 64 // sama seperti 1L << 0
```

Ini sering menjadi bug ketika membuat mask.

Bug:

```java
long mask = (1L << bits) - 1;
```

Jika `bits == 64`, hasilnya:

```text
(1L << 64) - 1
= (1L << 0) - 1
= 1 - 1
= 0
```

Padahal mungkin yang dimaksud:

```text
0xFFFF_FFFF_FFFF_FFFFL
```

Versi aman:

```java
static long lowBitsMask(int bits) {
    if (bits < 0 || bits > 64) {
        throw new IllegalArgumentException("bits must be 0..64");
    }
    if (bits == 0) return 0L;
    if (bits == 64) return -1L;
    return (1L << bits) - 1L;
}
```

---

## 10. Packing dan Unpacking Bytes

### 10.1 Membaca 4 Byte Big-Endian menjadi `int`

Misal byte:

```text
CA FE BA BE
```

Big-endian berarti byte paling signifikan muncul dulu.

```java
static int readIntBigEndian(byte[] a, int offset) {
    return ((a[offset]     & 0xFF) << 24)
         | ((a[offset + 1] & 0xFF) << 16)
         | ((a[offset + 2] & 0xFF) << 8)
         |  (a[offset + 3] & 0xFF);
}
```

Kenapa setiap byte dimask `& 0xFF`?

Karena `byte` Java signed. Tanpa mask, byte dengan bit tertinggi `1` akan sign-extend saat dipromosikan ke `int`.

Bug:

```java
static int broken(byte[] a, int offset) {
    return (a[offset] << 24)
         | (a[offset + 1] << 16)
         | (a[offset + 2] << 8)
         |  a[offset + 3];
}
```

Jika `a[offset + 1]` negatif, hasilnya korup karena sign extension.

---

### 10.2 Membaca 4 Byte Little-Endian menjadi `int`

Little-endian berarti byte paling rendah muncul dulu.

```java
static int readIntLittleEndian(byte[] a, int offset) {
    return  (a[offset]     & 0xFF)
          | ((a[offset + 1] & 0xFF) << 8)
          | ((a[offset + 2] & 0xFF) << 16)
          | ((a[offset + 3] & 0xFF) << 24);
}
```

Byte yang sama bisa menghasilkan nilai berbeda tergantung endian.

```text
bytes: 01 02 03 04

big-endian    -> 0x01020304
little-endian -> 0x04030201
```

---

### 10.3 Menulis `int` ke 4 Byte Big-Endian

```java
static void writeIntBigEndian(byte[] a, int offset, int value) {
    a[offset]     = (byte) (value >>> 24);
    a[offset + 1] = (byte) (value >>> 16);
    a[offset + 2] = (byte) (value >>> 8);
    a[offset + 3] = (byte) value;
}
```

Gunakan `>>>` karena maksudnya logical extraction.

---

### 10.4 Menulis `int` ke 4 Byte Little-Endian

```java
static void writeIntLittleEndian(byte[] a, int offset, int value) {
    a[offset]     = (byte) value;
    a[offset + 1] = (byte) (value >>> 8);
    a[offset + 2] = (byte) (value >>> 16);
    a[offset + 3] = (byte) (value >>> 24);
}
```

---

## 11. Endianness: Urutan Byte untuk Multi-Byte Value

Endianness hanya relevan saat sebuah value memakai lebih dari 1 byte.

Contoh value 32-bit:

```text
0x12_34_56_78
```

### 11.1 Big-Endian

Byte paling signifikan disimpan dulu.

```text
address:  +0  +1  +2  +3
bytes:    12  34  56  78
```

Big-endian sering disebut network byte order.

---

### 11.2 Little-Endian

Byte paling rendah disimpan dulu.

```text
address:  +0  +1  +2  +3
bytes:    78  56  34  12
```

Banyak hardware populer memakai little-endian secara native.

---

### 11.3 Kenapa Endianness Penting?

Karena jika producer dan consumer berbeda interpretasi, data rusak secara senyap.

Contoh field length 4 byte:

```text
00 00 04 00
```

Big-endian:

```text
1024
```

Little-endian:

```text
262144
```

Satu field length salah bisa menyebabkan:

- parser membaca terlalu banyak,
- buffer overflow di native side,
- OOM karena allocate size salah,
- protocol desync,
- corrupt record boundary,
- checksum mismatch,
- vulnerability di parser native/non-Java.

Invariant desain:

```text
semua binary format harus eksplisit soal byte order
```

Jangan pernah mengandalkan “native order” untuk format yang disimpan atau dikirim lintas mesin.

---

## 12. ByteBuffer dan ByteOrder: Preview Mental Model

`ByteBuffer` akan dibahas detail di part 011. Di sini cukup pahami kaitannya dengan endian.

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
buffer.order(ByteOrder.BIG_ENDIAN);
buffer.putInt(0x01020304);
```

Jika big-endian, byte-nya:

```text
01 02 03 04
```

Jika little-endian:

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
buffer.order(ByteOrder.LITTLE_ENDIAN);
buffer.putInt(0x01020304);
```

Byte-nya:

```text
04 03 02 01
```

`ByteOrder.nativeOrder()` berguna untuk performance-sensitive direct buffer/native interop, tetapi bukan pilihan otomatis untuk protocol/file format portable.

Rule praktis:

| Use Case | Byte Order Recommendation |
|---|---|
| Network protocol | explicit, commonly big-endian unless spec says otherwise |
| File format | explicit in spec/header |
| Internal off-heap structure single platform | native order may be acceptable |
| Cross-language persisted data | explicit and versioned |
| Debugging binary dump | always annotate endian |

---

## 13. Alignment: Kenapa Lokasi Data Bisa Berpengaruh

Alignment berarti alamat data berada pada boundary tertentu.

Contoh konseptual:

```text
4-byte int aligned at address divisible by 4
8-byte long aligned at address divisible by 8
```

Di Java biasa, kamu tidak mengatur alamat object secara langsung. Namun alignment tetap relevan karena:

1. HotSpot melakukan object alignment.
2. Field layout bisa menghasilkan padding.
3. Array primitive biasanya compact dan aligned.
4. Direct/off-heap memory punya alignment concern untuk native interop.
5. MemorySegment/FFM layout bisa eksplisit soal alignment.
6. CPU bisa lebih efisien membaca aligned data.
7. Atomicity dan vectorization bisa dipengaruhi alignment.

Contoh struct konseptual:

```text
byte  a;  // 1 byte
long  b;  // 8 byte
byte  c;  // 1 byte
```

Jika layout naif, bisa ada padding besar agar `long b` aligned.

Di Java object layout, JVM dapat mengatur urutan field internal untuk efisiensi, tetapi engineer tetap perlu sadar bahwa:

```text
field size + alignment + object header + padding = actual object footprint
```

Ini akan dibahas detail di part object layout.

---

## 14. Binary Protocol Mental Model

Binary protocol biasanya terdiri dari field-field fixed width atau variable length.

Contoh record:

```text
+---------+---------+----------+------------+--------------+
| magic   | version | flags    | length     | payload      |
| 2 bytes | 1 byte  | 1 byte   | 4 bytes    | length bytes |
+---------+---------+----------+------------+--------------+
```

Spec yang baik harus menjawab:

1. magic number-nya apa?
2. version berapa?
3. byte order apa?
4. field signed atau unsigned?
5. length termasuk header atau payload saja?
6. maximum length berapa?
7. flags bit mana yang valid?
8. reserved bits harus 0 atau boleh diabaikan?
9. checksum dihitung dari bagian mana?
10. bagaimana parser menangani unknown version?

Contoh parser minimal:

```java
record FrameHeader(int version, int flags, int length) {}

static FrameHeader parseHeader(byte[] input) {
    if (input.length < 8) {
        throw new IllegalArgumentException("header too short");
    }

    int magic = ((input[0] & 0xFF) << 8)
              | (input[1] & 0xFF);

    if (magic != 0xCAFE) {
        throw new IllegalArgumentException("invalid magic: 0x" + Integer.toHexString(magic));
    }

    int version = input[2] & 0xFF;
    int flags = input[3] & 0xFF;

    int length = ((input[4] & 0xFF) << 24)
               | ((input[5] & 0xFF) << 16)
               | ((input[6] & 0xFF) << 8)
               |  (input[7] & 0xFF);

    if (length < 0 || length > 16 * 1024 * 1024) {
        throw new IllegalArgumentException("invalid length: " + length);
    }

    return new FrameHeader(version, flags, length);
}
```

Catatan:

- semua byte dimask,
- magic divalidasi,
- length dibatasi,
- flags dibaca sebagai unsigned,
- parser fail-fast.

Ini bukan sekadar correctness. Ini reliability dan security boundary.

---

## 15. Bit Flags: Compact, Cepat, tapi Harus Disiplin

Bit flags cocok saat kamu punya banyak boolean kecil dalam satu field.

```java
final class CaseFlags {
    static final int CREATED   = 1 << 0;
    static final int VALIDATED = 1 << 1;
    static final int APPROVED  = 1 << 2;
    static final int REJECTED  = 1 << 3;

    static boolean has(int flags, int mask) {
        return (flags & mask) != 0;
    }

    static int add(int flags, int mask) {
        return flags | mask;
    }

    static int remove(int flags, int mask) {
        return flags & ~mask;
    }
}
```

Usage:

```java
int flags = 0;
flags = CaseFlags.add(flags, CaseFlags.CREATED);
flags = CaseFlags.add(flags, CaseFlags.VALIDATED);

if (CaseFlags.has(flags, CaseFlags.VALIDATED)) {
    // proceed
}
```

### 15.1 Reserved Bits

Jika flags disimpan dalam protocol/database/file, sisakan reserved bits.

```text
bit 0: created
bit 1: validated
bit 2: approved
bit 3: rejected
bit 4..7: reserved, must be zero
```

Parser harus memilih strategi:

1. strict: reject jika reserved bit aktif,
2. forward-compatible: ignore unknown bit,
3. negotiate by version.

Untuk sistem regulasi/case management, strictness sering lebih defensible jika data harus predictable.

---

## 16. Bit Packing: Menyimpan Banyak Field dalam Satu Integer

Kadang beberapa field kecil dipack ke satu `int`/`long`.

Contoh 32-bit packed ID:

```text
bits 31..28 : type      (4 bits)
bits 27..16 : region    (12 bits)
bits 15..0  : sequence  (16 bits)
```

Packing:

```java
static int pack(int type, int region, int sequence) {
    if ((type & ~0xF) != 0) throw new IllegalArgumentException("type out of range");
    if ((region & ~0xFFF) != 0) throw new IllegalArgumentException("region out of range");
    if ((sequence & ~0xFFFF) != 0) throw new IllegalArgumentException("sequence out of range");

    return (type << 28)
         | (region << 16)
         | sequence;
}
```

Unpacking:

```java
static int type(int packed) {
    return (packed >>> 28) & 0xF;
}

static int region(int packed) {
    return (packed >>> 16) & 0xFFF;
}

static int sequence(int packed) {
    return packed & 0xFFFF;
}
```

Kenapa `>>>`?

Karena kita memindahkan bit secara logical, bukan arithmetic signed value.

---

## 17. Overflow: Fixed Width Arithmetic Itu Modulo

Java integer arithmetic overflow tidak otomatis throw exception.

```java
int x = Integer.MAX_VALUE;
int y = x + 1;
System.out.println(y); // -2147483648
```

Bit-nya wrap around.

```text
0111_1111 1111_1111 1111_1111 1111_1111
+ 1
1000_0000 0000_0000 0000_0000 0000_0000
```

Untuk operasi yang harus detect overflow:

```java
int z = Math.addExact(a, b);
long w = Math.multiplyExact(x, y);
```

Jika overflow adalah bagian dari algoritma, misalnya hash, checksum, PRNG, maka wrap-around bisa valid.

Contoh:

```java
int h = 1;
h = 31 * h + value;
```

Hash computation sering sengaja membiarkan overflow.

Rule:

```text
overflow boleh hanya jika memang bagian dari kontrak algoritma
```

---

## 18. Unsigned Operations di Java

Java tetap bisa melakukan operasi unsigned dengan helper.

Contoh unsigned int ke long:

```java
int raw = 0xFFFF_FFFE;
long unsigned = Integer.toUnsignedLong(raw); // 4294967294
```

Compare unsigned:

```java
int a = 0xFFFF_FFFE;
int b = 1;

System.out.println(a > b); // false, signed compare
System.out.println(Integer.compareUnsigned(a, b) > 0); // true
```

Parse unsigned:

```java
int value = Integer.parseUnsignedInt("4294967295");
System.out.println(Integer.toUnsignedString(value)); // 4294967295
```

Prinsip:

```text
storage tetap int 32-bit, tetapi operasi interpretasinya unsigned
```

---

## 19. Membaca Binary Dump: Skill Praktis

Misal kamu melihat dump:

```text
CA FE 01 05 00 00 04 00
```

Dengan spec:

```text
magic   : 2 bytes, big-endian
version : 1 byte
flags   : 1 byte
length  : 4 bytes, big-endian
```

Bacanya:

```text
magic   = CA FE = 0xCAFE
version = 01    = 1
flags   = 05    = 0000_0101 = bit 0 and bit 2 set
length  = 00 00 04 00 = 1024
```

Jika length dibaca little-endian:

```text
00 00 04 00 = 0x00040000 = 262144
```

Ini menunjukkan kenapa endian bukan detail sepele.

---

## 20. Byte/Bit Bugs yang Sering Terjadi di Java

### 20.1 Lupa Mask Byte

Bug:

```java
int x = bytes[i];
```

Jika `bytes[i] = (byte) 0xFF`, maka `x = -1`.

Benar jika maksudnya unsigned:

```java
int x = bytes[i] & 0xFF;
```

---

### 20.2 Shift Sebelum Mask

Bug:

```java
int high = bytes[i] << 8;
```

Jika `bytes[i]` negatif, sign extension terjadi.

Lebih aman:

```java
int high = (bytes[i] & 0xFF) << 8;
```

---

### 20.3 Menggunakan `>>` untuk Logical Bits

Bug:

```java
int topByte = value >> 24;
```

Jika ingin byte atas sebagai unsigned:

```java
int topByte = (value >>> 24) & 0xFF;
```

---

### 20.4 Menganggap `~mask` Hanya Mengubah Bit yang Terlihat

Bug konseptual:

```java
int low = 0b0000_1111;
int inverted = ~low;
```

`inverted` bukan `0000_0000`, tetapi semua 32 bit di-invert.

Jika hanya mau 8 bit:

```java
int inverted8 = (~low) & 0xFF;
```

---

### 20.5 Tidak Membatasi Length dari Data Biner

Bug:

```java
byte[] payload = new byte[length];
```

Jika `length` berasal dari input eksternal dan salah endian/korup/malicious, bisa OOM.

Benar:

```java
if (length < 0 || length > MAX_FRAME_SIZE) {
    throw new ProtocolException("invalid length");
}
```

---

### 20.6 Tidak Mendefinisikan Reserved Bits

Bug desain:

```text
flags = 0xFF accepted tanpa validasi
```

Akibat:

- future version sulit,
- state invalid masuk sistem,
- audit/debug sulit,
- protocol ambigu.

---

## 21. Relationship ke Memory Management dan GC

Mungkin terlihat bagian ini “terlalu rendah” untuk GC, tetapi justru ini fondasi.

Kenapa bit/byte penting untuk memory management?

### 21.1 Compact Representation Mengurangi Allocation

Contoh 1 juta boolean sebagai object wrapper buruk sekali:

```java
Boolean[] flags = new Boolean[1_000_000];
```

Lebih compact:

```java
BitSet flags = new BitSet(1_000_000);
```

Lebih sedikit object berarti:

- lebih sedikit allocation,
- lebih kecil live set,
- lebih sedikit pointer chasing,
- marking GC lebih ringan,
- cache locality lebih baik.

---

### 21.2 Binary Parsing Bisa Menghindari Materialisasi Object

Parser yang langsung membaca primitive dari `byte[]`/`ByteBuffer` bisa menghindari DTO sementara.

Bad pattern:

```text
bytes -> String -> JSON object -> Map -> DTO -> domain
```

Untuk high-throughput binary systems:

```text
bytes -> validate header -> read primitive fields -> act
```

Lebih sedikit intermediate object.

---

### 21.3 Endianness dan Length Bug Bisa Menjadi OOM

Salah membaca length bisa membuat program allocate buffer besar.

```text
00 00 04 00
```

Jika harusnya 1024 tapi dibaca 262144, masih mungkin aman. Tetapi field lain bisa berubah dari beberapa KB menjadi ratusan MB/GB.

Maka binary correctness adalah memory safety boundary.

---

### 21.4 Off-Heap dan Native Memory Butuh Layout Eksplisit

Saat masuk ke direct buffer, mapped buffer, atau FFM API, kamu tidak lagi hidup di dunia object Java murni.

Kamu harus memikirkan:

- byte offset,
- field width,
- byte order,
- alignment,
- bounds,
- lifetime,
- memory ownership.

Part ini adalah bahasa dasarnya.

---

## 22. Design Principles untuk Binary/Bit-Level Java

### Principle 1 — Selalu Pisahkan Storage dan Meaning

```text
byte = 8-bit storage
bukan selalu angka domain signed
```

Gunakan nama yang jelas:

```java
byte rawStatus;
int unsignedStatus = rawStatus & 0xFF;
```

---

### Principle 2 — Mask Sebelum Shift untuk Raw Bytes

```java
int value = (raw[i] & 0xFF) << 8;
```

Bukan:

```java
int value = raw[i] << 8;
```

---

### Principle 3 — Endian Harus Bagian dari Kontrak

Jangan menulis spec seperti:

```text
length: int
```

Tulis:

```text
length: unsigned 32-bit integer, big-endian, payload length only, max 16 MiB
```

---

### Principle 4 — Validasi Width dan Range Sebelum Packing

```java
if ((region & ~0xFFF) != 0) {
    throw new IllegalArgumentException("region out of range");
}
```

Jangan membiarkan overflow/truncation diam-diam kecuali memang bagian dari kontrak.

---

### Principle 5 — Jangan Menggunakan Native Order untuk Persisted/Network Format

`ByteOrder.nativeOrder()` boleh untuk native interop internal/performance-sensitive direct buffer.

Untuk file/protocol:

```text
explicit order > native order
```

---

### Principle 6 — Binary Parser Harus Defensif

Validasi:

- minimum header size,
- magic,
- version,
- flags,
- length,
- checksum jika ada,
- remaining bytes,
- maximum allocation.

---

### Principle 7 — Optimisasi Bit-Level Harus Membeli Sesuatu

Bit packing membuat data compact, tetapi mengurangi readability dan evolvability.

Gunakan jika mendapat keuntungan nyata:

- memory footprint besar,
- wire format stabil,
- file format compact,
- cache locality,
- bitmap indexing,
- high-throughput parsing.

Jangan gunakan bit trick hanya agar kode terlihat pintar.

---

## 23. Mini Exercise

### Exercise 1

Apa output kode ini?

```java
byte b = (byte) 0xFF;
System.out.println(b);
System.out.println(b & 0xFF);
```

Jawaban:

```text
-1
255
```

---

### Exercise 2

Apa nilai `x`?

```java
byte b = (byte) 0xF0;
int x = b >> 4;
```

Jawaban:

```text
-1
```

Karena `b` dipromosikan ke `int` dengan sign extension sebelum shift.

Versi untuk hasil `15`:

```java
int x = (b & 0xFF) >> 4;
```

---

### Exercise 3

Decode:

```text
01 02 03 04
```

Sebagai 32-bit integer big-endian:

```text
0x01020304 = 16909060
```

Sebagai 32-bit integer little-endian:

```text
0x04030201 = 67305985
```

---

### Exercise 4

Kenapa fungsi ini bug?

```java
static int readU16(byte[] a, int offset) {
    return (a[offset] << 8) | a[offset + 1];
}
```

Karena `byte` signed dipromosikan ke `int` dengan sign extension.

Versi benar:

```java
static int readU16(byte[] a, int offset) {
    return ((a[offset] & 0xFF) << 8)
         |  (a[offset + 1] & 0xFF);
}
```

---

## 24. Checklist Praktis

Gunakan checklist ini ketika menulis kode binary/bit-level:

```text
[ ] Apakah field signed atau unsigned?
[ ] Berapa width field? 8, 16, 32, 64 bit?
[ ] Apakah byte order eksplisit?
[ ] Apakah byte Java sudah dimask dengan 0xFF sebelum shift?
[ ] Apakah shift memakai >> atau >>> dengan sengaja?
[ ] Apakah shift distance bisa 32/64 dan menyebabkan wrap?
[ ] Apakah length divalidasi sebelum allocation?
[ ] Apakah reserved bits didefinisikan?
[ ] Apakah packing/unpacking punya range check?
[ ] Apakah overflow diharapkan atau bug?
[ ] Apakah format perlu forward compatibility?
[ ] Apakah binary dump bisa dibaca ulang oleh manusia/debug tool?
```

---

## 25. Ringkasan Mental Model

Inti bagian ini:

```text
memory menyimpan bit pattern
program memberi interpretasi
```

Di Java, tantangan utamanya:

```text
byte/short/int/long signed
banyak data eksternal unsigned
operasi byte dipromosikan ke int
sign extension bisa merusak parser
byte order harus eksplisit
```

Rule paling penting:

```java
int u8 = b & 0xFF;
```

Dan untuk multi-byte field:

```java
int value = ((a[i]     & 0xFF) << 24)
          | ((a[i + 1] & 0xFF) << 16)
          | ((a[i + 2] & 0xFF) << 8)
          |  (a[i + 3] & 0xFF);
```

Kamu akan terus memakai fondasi ini saat membahas:

- primitive memory representation,
- object layout,
- compact strings,
- ByteBuffer,
- direct buffer,
- mapped memory,
- FFM API,
- off-heap record layout,
- GC live set reduction,
- cache locality,
- memory-aware system design.

---

## 26. Referensi Resmi untuk Pendalaman

1. Java Language Specification Java SE 25 — Types, Values, and Variables, primitive types, integral types, numeric operations, and shift operators.  
   <https://docs.oracle.com/javase/specs/jls/se25/html/index.html>

2. Java SE 25 API — `java.nio.ByteBuffer`.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html>

3. Java SE 25 API — `java.nio.ByteOrder`.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteOrder.html>

4. Java SE 25 API — `java.lang.Integer`, unsigned parsing/comparison/string conversion helpers.  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Integer.html>

---

## 27. Status Seri

```text
Part 001 selesai.
Seri belum selesai.
Masih lanjut ke part 002 sampai part 030.
```

Part berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-002.md
```

Topik berikutnya:

```text
Java Primitive Memory Semantics: Dari boolean sampai double
```
