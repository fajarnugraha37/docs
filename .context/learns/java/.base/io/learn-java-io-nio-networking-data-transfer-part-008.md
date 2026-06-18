# Part 008 — ByteBuffer Deep Dive: Heap, Direct, Mapped, Slice, Duplicate, View Buffer

> Seri: `learn-java-io-nio-networking-data-transfer`  
> Part: `008`  
> Status: Materi advance lanjutan  
> Fokus: memahami `ByteBuffer` bukan sebagai “array byte dengan API aneh”, tetapi sebagai state machine, memory abstraction, dan boundary antara Java heap, native memory, channel, file, network, dan binary protocol.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami kenapa `ByteBuffer` menjadi salah satu primitive paling penting di Java NIO.
2. Membedakan dengan jelas:
   - heap buffer,
   - direct buffer,
   - mapped buffer,
   - read-only buffer,
   - sliced buffer,
   - duplicated buffer,
   - view buffer.
3. Menguasai state machine `ByteBuffer`:
   - `capacity`,
   - `position`,
   - `limit`,
   - `mark`,
   - `remaining`,
   - `flip`,
   - `clear`,
   - `compact`,
   - `rewind`.
4. Menghindari bug umum:
   - lupa `flip()`,
   - salah `clear()` vs `compact()`,
   - data overwrite,
   - aliasing dari `slice()` dan `duplicate()`,
   - accidental mutation,
   - byte order mismatch,
   - memory leak karena direct buffer berumur panjang.
5. Membuat keputusan engineering kapan memakai:
   - `byte[]`,
   - `ByteBuffer.allocate()`,
   - `ByteBuffer.allocateDirect()`,
   - `FileChannel.map()`.
6. Mendesain binary parser/writer yang lebih aman, reusable, dan performa-friendly.
7. Memahami trade-off performa dan failure mode `ByteBuffer` di aplikasi production.

---

## 2. Kenapa ByteBuffer Penting?

Di Java klasik, banyak I/O bekerja dengan `byte[]`:

```java
byte[] buffer = new byte[8192];
int read = inputStream.read(buffer);
```

Model ini sederhana, tetapi terbatas. Ia tidak punya state eksplisit selain angka `offset` dan `length` yang harus kita kelola sendiri.

NIO memperkenalkan model berbeda:

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);
int read = channel.read(buffer);
```

`ByteBuffer` bukan hanya tempat menaruh byte. Ia membawa informasi posisi baca/tulis, batas operasi, kapasitas, byte order, dan bisa menjadi view ke memory yang berbeda.

Mental model paling penting:

> `ByteBuffer` adalah window terkontrol terhadap sebuah memory region.

Memory region itu bisa berupa:

1. array di heap,
2. native memory di luar heap,
3. memory-mapped file,
4. subset dari buffer lain,
5. view typed seperti `IntBuffer` atau `LongBuffer`.

Karena itu, `ByteBuffer` berada di tengah banyak boundary penting:

```text
Application Object
      |
      v
Binary Encoding / Decoding
      |
      v
ByteBuffer
      |
      +--> Channel
      |      +--> File
      |      +--> Socket
      |      +--> Pipe
      |
      +--> Native / OS / Kernel Boundary
      |
      +--> Memory-Mapped File
```

Jika `InputStream` mengajarkan kita “baca byte dari sumber”, maka `ByteBuffer` mengajarkan kita “kelola region memory secara eksplisit agar bisa dipakai oleh channel”.

---

## 3. Sumber Resmi dan Terminologi

Beberapa definisi penting dari dokumentasi resmi Java:

- `Buffer` memiliki konsep `capacity`, `limit`, `position`, dan `mark`. Operasi seperti `clear()`, `flip()`, `rewind()`, serta `slice()` mengubah atau membuat view berdasarkan state tersebut.
- `ByteBuffer` adalah buffer untuk byte. Ia bisa dibuat dengan allocation, wrapping array, atau mapping file. Buffer bisa direct atau non-direct.
- `duplicate()` membuat buffer baru yang berbagi content dengan buffer asal, tetapi memiliki `position`, `limit`, dan `mark` independen.
- `MappedByteBuffer` adalah direct byte buffer yang isinya adalah region file yang di-map ke memory dan dibuat melalui `FileChannel.map()`.

Referensi resmi:

- Java SE 25 `Buffer`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/Buffer.html
- Java SE 21 `ByteBuffer`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/ByteBuffer.html
- Java SE 25 `MappedByteBuffer`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/MappedByteBuffer.html
- Java SE 21 `FileChannel`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html

---

## 4. Mental Model Inti: Buffer adalah State Machine

Sebelum membahas heap/direct/mapped, kita harus menguasai state machine dasar.

Setiap buffer punya empat angka konseptual:

```text
0 <= mark <= position <= limit <= capacity
```

Walaupun `mark` bisa tidak terdefinisi, invariant pentingnya tetap:

```text
position tidak boleh melewati limit
limit tidak boleh melewati capacity
capacity tetap setelah buffer dibuat
```

### 4.1 Capacity

`capacity` adalah ukuran total memory region yang bisa diakses oleh buffer.

Contoh:

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
System.out.println(buffer.capacity()); // 8
```

Capacity tidak berubah sepanjang umur buffer.

Jika butuh capacity lebih besar, kamu harus membuat buffer baru.

### 4.2 Position

`position` adalah cursor operasi berikutnya.

Saat menulis:

```java
buffer.put((byte) 10);
```

byte ditulis pada `position`, lalu `position` naik satu.

Saat membaca:

```java
byte value = buffer.get();
```

byte dibaca dari `position`, lalu `position` naik satu.

Artinya `position` bukan “jumlah data valid” secara universal. Maknanya tergantung mode:

- dalam write mode: position = jumlah byte yang sudah ditulis,
- dalam read mode: position = jumlah byte yang sudah dibaca dari area readable.

### 4.3 Limit

`limit` adalah batas operasi saat ini.

- Saat write mode, biasanya `limit == capacity`.
- Saat read mode, `limit == jumlah data yang valid untuk dibaca`.

### 4.4 Mark

`mark` adalah checkpoint optional untuk position.

```java
buffer.mark();
// baca beberapa byte
buffer.reset(); // kembali ke posisi mark
```

`mark` berguna untuk parser yang perlu “peek” data lalu rollback.

Tetapi dalam production parser, penggunaan `mark/reset` perlu hati-hati karena state implisit sering membuat kode sulit dibaca. Untuk protocol parser kompleks, sering lebih jelas menyimpan integer offset eksplisit.

---

## 5. Mode Operasi: Write Mode dan Read Mode

`ByteBuffer` tidak punya field bernama `mode`, tetapi secara mental kita harus membedakan:

1. mode mengisi buffer,
2. mode membaca isi buffer.

### 5.1 Write Mode

Saat baru dibuat:

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
```

State-nya:

```text
capacity = 8
position = 0
limit    = 8
```

Diagram:

```text
[ _ _ _ _ _ _ _ _ ]
  ^               ^
  position        limit/capacity
```

Kita tulis 3 byte:

```java
buffer.put((byte) 65);
buffer.put((byte) 66);
buffer.put((byte) 67);
```

State:

```text
capacity = 8
position = 3
limit    = 8
```

Diagram:

```text
[ A B C _ _ _ _ _ ]
        ^         ^
        position  limit/capacity
```

Data valid untuk dibaca sebenarnya berada dari index `0` sampai `position - 1`, tetapi buffer masih dalam write mode.

### 5.2 flip(): Write Mode ke Read Mode

Untuk membaca data yang baru ditulis, panggil:

```java
buffer.flip();
```

`flip()` melakukan dua hal:

```text
limit = position
position = 0
```

State:

```text
capacity = 8
position = 0
limit    = 3
```

Diagram:

```text
[ A B C _ _ _ _ _ ]
  ^     ^         ^
  pos   limit     capacity
```

Sekarang byte valid yang bisa dibaca adalah `[position, limit)` yaitu index 0, 1, 2.

### 5.3 clear(): Kembali ke Write Mode, Data Lama Diabaikan

Setelah selesai membaca, panggil:

```java
buffer.clear();
```

`clear()` tidak menghapus byte secara fisik. Ia hanya mengubah state:

```text
position = 0
limit = capacity
mark = undefined
```

Data lama mungkin masih ada di memory, tetapi dianggap boleh ditimpa.

Inilah bug umum:

> `clear()` bukan secure erase dan bukan zeroing memory.

Jika buffer berisi password, token, key material, atau PII, `clear()` tidak cukup untuk menghapus isi memory.

### 5.4 rewind(): Baca Ulang Data yang Sama

`rewind()` melakukan:

```text
position = 0
limit tetap
mark = undefined
```

Dipakai saat ingin membaca ulang data yang sudah disiapkan.

Contoh:

```java
buffer.flip();
consume(buffer);
buffer.rewind();
consumeAgain(buffer);
```

### 5.5 compact(): Sisakan Data yang Belum Dibaca

`compact()` penting untuk networking dan parser streaming.

Misal buffer punya data 8 byte, tetapi parser baru membaca 5 byte. Masih ada 3 byte incomplete frame yang belum bisa diproses.

Jika kita panggil `clear()`, 3 byte itu akan dianggap boleh ditimpa. Data hilang.

Gunakan:

```java
buffer.compact();
```

`compact()` memindahkan byte yang belum dibaca ke awal buffer, lalu membuat buffer siap ditulis lagi setelah sisa data tersebut.

Mental model:

```text
Before compact in read mode:
[ consumed consumed consumed X Y Z _ _ ]
                          ^     ^
                          pos   limit

After compact:
[ X Y Z _ _ _ _ _ ]
        ^         ^
        pos       limit/capacity
```

`compact()` adalah operasi yang sangat penting untuk protocol parser incremental.

---

## 6. ByteBuffer Lifecycle Paling Umum

### 6.1 File/Socket Read ke Buffer lalu Process

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);

int n = channel.read(buffer); // write mode: channel menulis ke buffer
if (n == -1) {
    // EOF
}

buffer.flip();               // read mode
while (buffer.hasRemaining()) {
    byte b = buffer.get();
    // process byte
}

buffer.clear();              // siap dipakai untuk read berikutnya
```

Flow:

```text
allocate -> channel.read -> flip -> get/process -> clear -> channel.read -> ...
```

### 6.2 Parser Incremental dengan compact()

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);

while (channel.read(buffer) != -1) {
    buffer.flip();

    while (tryParseOneFrame(buffer)) {
        // terus parse selama frame lengkap tersedia
    }

    buffer.compact();
}

buffer.flip();
if (buffer.hasRemaining()) {
    throw new IllegalStateException("truncated final frame");
}
```

Pattern ini penting karena data dari channel bisa datang sebagian.

---

## 7. Relative vs Absolute Access

`ByteBuffer` menyediakan dua gaya akses:

1. relative access,
2. absolute access.

### 7.1 Relative Access

Relative access memakai dan mengubah `position`.

```java
buffer.put((byte) 1);
buffer.put((byte) 2);

buffer.flip();
byte a = buffer.get();
byte b = buffer.get();
```

Kelebihan:

- cocok untuk sequential read/write,
- natural untuk stream/channel,
- state machine sederhana.

Kekurangan:

- parser bisa sulit dipahami jika banyak method mengubah position,
- accidental position movement bisa menyebabkan bug.

### 7.2 Absolute Access

Absolute access memakai index eksplisit dan tidak mengubah `position`.

```java
byte first = buffer.get(0);
buffer.put(4, (byte) 99);
```

Kelebihan:

- cocok untuk membaca header,
- cocok untuk random access,
- tidak mengubah cursor.

Kekurangan:

- harus validasi index sendiri,
- bisa membuat kode campur aduk jika digabung sembarangan dengan relative access.

### 7.3 Rule of Thumb

Gunakan relative access untuk flow sequential.

Gunakan absolute access untuk:

- peek header,
- patch length field setelah body ditulis,
- random-access binary structure,
- membaca metadata di offset tertentu.

Contoh patch length:

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);

int lengthPosition = buffer.position();
buffer.putInt(0); // placeholder length

int bodyStart = buffer.position();
buffer.put("hello".getBytes(StandardCharsets.UTF_8));
int bodyEnd = buffer.position();

int bodyLength = bodyEnd - bodyStart;
buffer.putInt(lengthPosition, bodyLength); // absolute write, position tidak berubah

buffer.flip();
```

---

## 8. Heap ByteBuffer

Heap buffer dibuat dengan:

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);
```

Secara konseptual, heap buffer backed by Java byte array.

Beberapa heap buffer memungkinkan akses ke array:

```java
if (buffer.hasArray()) {
    byte[] array = buffer.array();
    int offset = buffer.arrayOffset();
}
```

### 8.1 Kelebihan Heap Buffer

Heap buffer cocok untuk:

- data kecil sampai sedang,
- parsing application-level,
- integrasi dengan API yang butuh `byte[]`,
- object lifecycle biasa,
- allocation yang sering tetapi kecil,
- debugging lebih mudah.

Kelebihan utama:

1. Allocation relatif murah dibanding direct buffer.
2. Dikelola langsung oleh GC heap.
3. Bisa interoperasi mudah dengan `byte[]`.
4. Cocok untuk transformasi data di level aplikasi.

### 8.2 Kekurangan Heap Buffer

Saat dipakai untuk native I/O, JVM/OS mungkin perlu melakukan copy antara heap dan native buffer.

Simplifikasi:

```text
Heap ByteBuffer
    -> possible copy
Native / Kernel Buffer
    -> OS I/O
```

Kata “possible” penting. Detail implementasi bisa berbeda, tetapi secara engineering, direct buffer lebih ditujukan untuk mengurangi copy pada I/O tertentu.

### 8.3 Kapan Heap Buffer Lebih Baik?

Gunakan heap buffer jika:

- payload kecil,
- operasi dominan di Java code,
- butuh akses `byte[]`,
- buffer sering dialokasi dan dibuang,
- simplicity lebih penting daripada micro-optimization,
- workload bukan bottleneck I/O native.

Contoh:

```java
ByteBuffer payload = ByteBuffer.allocate(1024);
payload.putInt(42);
payload.put("OK".getBytes(StandardCharsets.US_ASCII));
payload.flip();
```

---

## 9. Direct ByteBuffer

Direct buffer dibuat dengan:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(8192);
```

Direct buffer berada di luar Java heap, di native memory.

Dokumentasi Java menyatakan direct byte buffer dapat dibuat dengan `allocateDirect`, dan apakah buffer direct atau tidak dapat diperiksa dengan `isDirect()`.

```java
System.out.println(buffer.isDirect()); // true
```

### 9.1 Mental Model Direct Buffer

```text
Java Object Reference
        |
        v
DirectByteBuffer object di heap
        |
        v
Native memory region di luar heap
```

Object wrapper-nya tetap ada di heap, tetapi content byte-nya berada di native memory.

### 9.2 Kelebihan Direct Buffer

Direct buffer cocok untuk:

- file channel high-throughput,
- socket channel high-throughput,
- long-lived reusable buffer,
- I/O boundary yang intensif,
- mengurangi copy di beberapa operasi native.

### 9.3 Kekurangan Direct Buffer

Direct buffer punya trade-off serius:

1. Allocation lebih mahal.
2. Deallocation tidak langsung intuitif.
3. Memory-nya berada di luar heap sehingga observability berbeda.
4. Bisa menyebabkan native memory pressure.
5. Bisa terkena limit `MaxDirectMemorySize`.
6. Tidak punya accessible backing array.

Contoh:

```java
ByteBuffer direct = ByteBuffer.allocateDirect(1024);
System.out.println(direct.hasArray()); // biasanya false
```

Memanggil `array()` pada direct buffer akan melempar `UnsupportedOperationException`.

### 9.4 Direct Buffer Tidak Selalu Lebih Cepat

Kesalahan umum:

> “NIO direct buffer pasti lebih cepat.”

Tidak selalu.

Direct buffer bisa lebih cepat jika:

- buffer digunakan ulang,
- operasi I/O besar,
- transfer melewati native boundary berkali-kali,
- copy heap-native menjadi bottleneck.

Direct buffer bisa lebih lambat jika:

- buffer kecil,
- sering dialokasi,
- workload CPU-bound parsing,
- data akhirnya tetap harus dikopi ke `byte[]`,
- GC/native memory pressure meningkat.

Rule of thumb:

```text
Short-lived small buffer    -> heap
Long-lived I/O buffer       -> direct bisa dipertimbangkan
Need byte[] interop         -> heap
High-throughput channel I/O -> benchmark direct vs heap
```

### 9.5 Direct Buffer dan Memory Leak

Direct buffer dibebaskan saat object wrapper-nya sudah tidak reachable dan cleaner berjalan. Ini berarti deallocation tidak sejelas `free()` manual.

Anti-pattern:

```java
while (true) {
    ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
    channel.read(buffer);
}
```

Masalah:

- allocation native memory berulang,
- GC belum tentu segera membersihkan wrapper,
- native memory bisa habis sebelum heap terlihat penuh.

Pattern lebih baik:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);

while (running) {
    buffer.clear();
    int n = channel.read(buffer);
    if (n == -1) break;
    buffer.flip();
    process(buffer);
}
```

Atau gunakan bounded buffer pool.

---

## 10. MappedByteBuffer

`MappedByteBuffer` adalah subclass `ByteBuffer` untuk memory-mapped file.

Dibuat melalui:

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    MappedByteBuffer mapped = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
}
```

### 10.1 Mental Model

Memory-mapped file membuat region file tampak seperti memory.

```text
Application
   |
   v
MappedByteBuffer
   |
   v
Virtual Memory Mapping
   |
   v
Page Cache / File
```

Kamu membaca file dengan operasi memory access:

```java
byte b = mapped.get(index);
```

Bukan dengan `read()` eksplisit.

### 10.2 Kapan Mapped Buffer Berguna?

Mapped buffer cocok untuk:

- file besar,
- random access,
- index file,
- read-mostly data,
- binary search di file,
- memory-mapped database/index sederhana,
- scanning file dengan locality baik.

### 10.3 Trade-off Mapped Buffer

Mapped buffer bukan silver bullet.

Risiko dan trade-off:

1. Mapping tetap memakai virtual address space.
2. File mapping valid sampai buffer garbage-collected.
3. Unmap eksplisit historically tidak nyaman di Java standard API lama.
4. Perilaku delete/modify file bisa berbeda antar OS.
5. Page fault bisa muncul saat akses, bukan saat map.
6. Error I/O bisa muncul sebagai runtime failure saat memory access.
7. Tidak cocok untuk semua pola sequential streaming.

Part 010 nanti akan membahas memory-mapped file secara khusus. Di part ini cukup pahami bahwa `MappedByteBuffer` adalah varian `ByteBuffer` dengan backing content berupa file mapping.

---

## 11. Wrapping byte[] Menjadi ByteBuffer

Selain allocation, buffer bisa dibuat dari array:

```java
byte[] bytes = new byte[1024];
ByteBuffer buffer = ByteBuffer.wrap(bytes);
```

Buffer ini backed by array yang sama.

Artinya perubahan dari buffer terlihat di array, dan perubahan dari array terlihat di buffer.

```java
byte[] bytes = {1, 2, 3};
ByteBuffer buffer = ByteBuffer.wrap(bytes);

buffer.put(0, (byte) 99);
System.out.println(bytes[0]); // 99

bytes[1] = 88;
System.out.println(buffer.get(1)); // 88
```

### 11.1 Risiko Aliasing

`wrap()` sering berguna, tetapi membawa risiko aliasing.

Jika array masih dimiliki caller lain, maka buffer tidak punya ownership penuh.

Contoh buruk:

```java
public ByteBuffer payload(byte[] input) {
    return ByteBuffer.wrap(input);
}
```

Caller masih bisa mengubah `input` setelah buffer diberikan.

Untuk immutable boundary, copy data:

```java
public ByteBuffer payload(byte[] input) {
    byte[] copy = Arrays.copyOf(input, input.length);
    return ByteBuffer.wrap(copy).asReadOnlyBuffer();
}
```

---

## 12. Slice: Sub-Buffer yang Berbagi Content

`slice()` membuat buffer baru yang isinya adalah subsequence dari buffer asal.

Contoh:

```java
ByteBuffer original = ByteBuffer.allocate(10);
for (int i = 0; i < 10; i++) {
    original.put((byte) i);
}

original.position(2);
original.limit(6);

ByteBuffer slice = original.slice();
```

`slice` merepresentasikan data original index 2 sampai 5, tetapi di slice index-nya mulai dari 0.

```text
Original content:
index:  0 1 2 3 4 5 6 7 8 9
value:  0 1 2 3 4 5 6 7 8 9
              ^       ^
              pos     limit

Slice content:
index:  0 1 2 3
value:  2 3 4 5
```

### 12.1 Slice Berbagi Content

Perubahan di slice terlihat di original.

```java
slice.put(0, (byte) 99);
System.out.println(original.get(2)); // 99
```

Tetapi state-nya independen:

- position slice berbeda,
- limit slice berbeda,
- mark slice berbeda.

### 12.2 Kapan Slice Berguna?

Slice berguna untuk:

- mengambil view body dari frame,
- membagi buffer besar menjadi segment,
- menghindari copy,
- meneruskan bagian payload ke processor tertentu,
- parsing protocol.

Contoh parsing frame:

```java
int length = buffer.getInt();

if (buffer.remaining() < length) {
    throw new IllegalStateException("incomplete frame");
}

ByteBuffer payload = buffer.slice(buffer.position(), length);
buffer.position(buffer.position() + length);

handlePayload(payload.asReadOnlyBuffer());
```

### 12.3 Risiko Slice

Slice berbahaya jika ownership tidak jelas.

Contoh:

```java
ByteBuffer payload = buffer.slice();
queue.add(payload);
buffer.clear();
channel.read(buffer);
```

Jika `payload` berbagi content dengan `buffer`, lalu buffer dipakai ulang untuk read berikutnya, payload bisa berubah diam-diam.

Rule:

> Jangan menyimpan slice lebih lama dari lifetime backing buffer kecuali backing buffer tidak akan dimutasi lagi.

Jika harus menyimpan, copy:

```java
ByteBuffer copy = ByteBuffer.allocate(payload.remaining());
copy.put(payload.duplicate());
copy.flip();
queue.add(copy.asReadOnlyBuffer());
```

---

## 13. Duplicate: Buffer Baru, Content Sama, Cursor Independen

`duplicate()` membuat buffer baru dengan content sama, tetapi position/limit/mark independen.

```java
ByteBuffer a = ByteBuffer.allocate(10);
a.putInt(123);
a.flip();

ByteBuffer b = a.duplicate();

System.out.println(a.getInt()); // position a maju
System.out.println(b.getInt()); // b masih bisa baca dari posisi awal
```

### 13.1 Duplicate Bukan Copy

Perubahan content tetap terlihat antar duplicate.

```java
ByteBuffer a = ByteBuffer.allocate(4);
ByteBuffer b = a.duplicate();

b.put(0, (byte) 42);
System.out.println(a.get(0)); // 42
```

### 13.2 Kapan Duplicate Berguna?

Duplicate berguna untuk:

- membaca buffer yang sama dari beberapa consumer tanpa mengganggu position satu sama lain,
- logging/debugging tanpa mengubah cursor original,
- retry write tanpa merusak state original,
- passing read-only view.

Contoh aman untuk logging preview:

```java
static String preview(ByteBuffer buffer, int maxBytes) {
    ByteBuffer view = buffer.asReadOnlyBuffer();
    int n = Math.min(view.remaining(), maxBytes);

    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < n; i++) {
        sb.append(String.format("%02x", view.get()));
        if (i + 1 < n) sb.append(' ');
    }
    return sb.toString();
}
```

Original buffer tidak berubah karena kita membaca dari view.

---

## 14. Read-Only Buffer

Read-only buffer dibuat dengan:

```java
ByteBuffer readOnly = buffer.asReadOnlyBuffer();
```

Read-only buffer berbagi content dengan buffer asal tetapi tidak mengizinkan mutation melalui view itu.

```java
readOnly.get();       // boleh
readOnly.put((byte)1); // ReadOnlyBufferException
```

### 14.1 Read-Only Bukan Immutable

Read-only view bukan berarti content immutable.

```java
ByteBuffer original = ByteBuffer.allocate(4);
ByteBuffer readOnly = original.asReadOnlyBuffer();

original.put(0, (byte) 7);
System.out.println(readOnly.get(0)); // 7
```

Jika original masih bisa dimutasi, read-only view akan melihat perubahan.

Untuk immutable payload, perlu:

1. copy content,
2. jangan expose mutable owner,
3. expose `asReadOnlyBuffer()`.

---

## 15. View Buffer: Melihat Byte sebagai Tipe Lain

`ByteBuffer` bisa membuat typed view:

```java
IntBuffer ints = byteBuffer.asIntBuffer();
LongBuffer longs = byteBuffer.asLongBuffer();
CharBuffer chars = byteBuffer.asCharBuffer();
```

View buffer membaca content byte yang sama dengan interpretasi tipe berbeda.

### 15.1 Contoh Int View

```java
ByteBuffer bytes = ByteBuffer.allocate(16);
IntBuffer ints = bytes.asIntBuffer();

ints.put(0, 100);
ints.put(1, 200);

System.out.println(bytes.getInt(0)); // 100
System.out.println(bytes.getInt(4)); // 200
```

Karena `int` 4 byte, index int 1 berada di byte offset 4.

### 15.2 Byte Order Mempengaruhi View

```java
ByteBuffer buffer = ByteBuffer.allocate(4);
buffer.order(ByteOrder.BIG_ENDIAN);
buffer.putInt(0x01020304);
```

Byte layout big-endian:

```text
01 02 03 04
```

Jika little-endian:

```java
buffer.clear();
buffer.order(ByteOrder.LITTLE_ENDIAN);
buffer.putInt(0x01020304);
```

Byte layout:

```text
04 03 02 01
```

### 15.3 Kapan View Buffer Berguna?

View buffer berguna untuk:

- binary file dengan array numerik,
- image/audio/data science primitive data,
- memory-mapped index,
- structured binary layout,
- menghindari manual shifting byte.

Tetapi hati-hati:

- view buffer berbagi content,
- position view dalam unit tipe, bukan byte,
- byte order harus diset sebelum membuat/menggunakan view dengan asumsi tertentu,
- alignment dan format harus jelas.

---

## 16. Byte Order dan Endianness

`ByteBuffer` punya byte order.

```java
ByteOrder order = buffer.order();
buffer.order(ByteOrder.LITTLE_ENDIAN);
```

Default `ByteBuffer` adalah big-endian.

### 16.1 Kenapa Endianness Penting?

Misal angka integer:

```text
0x01020304
```

Big-endian menyimpan byte paling signifikan dulu:

```text
01 02 03 04
```

Little-endian menyimpan byte paling kecil dulu:

```text
04 03 02 01
```

Jika writer dan reader beda endianness, data corrupt secara semantik.

### 16.2 Rule untuk Format Binary

Untuk format binary internal maupun eksternal, selalu tulis spesifikasi:

```text
All multi-byte integers are encoded as unsigned/big-endian unless stated otherwise.
```

Atau:

```text
All numeric fields use little-endian byte order.
```

Jangan mengandalkan default tanpa dokumentasi.

### 16.3 Byte Order dalam Protocol

Network byte order secara tradisional adalah big-endian.

Java `DataInputStream/DataOutputStream` juga memakai big-endian untuk primitive.

Namun banyak format modern atau file format tertentu memakai little-endian karena kompatibilitas ekosistem lain.

Decision rule:

- network protocol baru: big-endian masih reasonable,
- interop dengan format existing: ikuti spesifikasi,
- performance lokal tidak boleh mengalahkan compatibility,
- dokumentasikan eksplisit.

---

## 17. ByteBuffer dan Binary Protocol Parser

Mari buat contoh parser frame sederhana:

```text
Frame:
+------------+-------------+------------------+
| magic u16  | length u32  | payload bytes    |
+------------+-------------+------------------+

magic  = 0xCAFE
length = jumlah byte payload
```

### 17.1 Parser Naif yang Salah

```java
short magic = buffer.getShort();
int length = buffer.getInt();
byte[] payload = new byte[length];
buffer.get(payload);
```

Masalah:

1. Tidak cek apakah header lengkap.
2. Tidak cek apakah payload lengkap.
3. Tidak cek max length.
4. Tidak handle partial read.
5. Position sudah berubah jika ternyata data belum lengkap.

### 17.2 Parser Lebih Aman

```java
static final short MAGIC = (short) 0xCAFE;
static final int HEADER_SIZE = Short.BYTES + Integer.BYTES;
static final int MAX_PAYLOAD_SIZE = 1024 * 1024;

static Optional<ByteBuffer> tryReadFrame(ByteBuffer buffer) {
    if (buffer.remaining() < HEADER_SIZE) {
        return Optional.empty();
    }

    buffer.mark();

    short magic = buffer.getShort();
    int length = buffer.getInt();

    if (magic != MAGIC) {
        throw new IllegalStateException("invalid magic: " + Integer.toHexString(magic & 0xFFFF));
    }

    if (length < 0 || length > MAX_PAYLOAD_SIZE) {
        throw new IllegalStateException("invalid payload length: " + length);
    }

    if (buffer.remaining() < length) {
        buffer.reset();
        return Optional.empty();
    }

    ByteBuffer payload = buffer.slice(buffer.position(), length).asReadOnlyBuffer();
    buffer.position(buffer.position() + length);

    return Optional.of(payload);
}
```

Catatan penting:

- `mark/reset` dipakai agar jika payload belum lengkap, position kembali ke awal frame.
- `length` dibatasi agar tidak terjadi resource exhaustion.
- Payload dibuat read-only view agar consumer tidak memutasi melalui view.
- Tapi payload masih berbagi content dengan backing buffer, jadi lifetime harus dikontrol.

### 17.3 Jika Payload Harus Disimpan Lama

Jika payload akan disimpan setelah buffer dipakai ulang, copy:

```java
static ByteBuffer copyRemaining(ByteBuffer source) {
    ByteBuffer copy = ByteBuffer.allocate(source.remaining());
    copy.put(source.duplicate());
    copy.flip();
    return copy.asReadOnlyBuffer();
}
```

---

## 18. ByteBuffer dan Channel Write

Menulis ke channel dengan buffer juga stateful.

```java
ByteBuffer buffer = ByteBuffer.wrap(data);
while (buffer.hasRemaining()) {
    channel.write(buffer);
}
```

Kenapa loop diperlukan?

Karena `write()` tidak wajib menulis semua byte dalam satu pemanggilan, terutama pada non-blocking channel atau resource yang sedang penuh.

### 18.1 Bug Partial Write

Salah:

```java
channel.write(buffer); // menganggap semua terkirim
```

Benar:

```java
while (buffer.hasRemaining()) {
    int written = channel.write(buffer);
    if (written == 0) {
        // non-blocking channel: harus tunggu readiness atau keluar dari loop sesuai event loop model
        break;
    }
}
```

Untuk blocking channel, loop biasanya akan selesai kecuali error.

Untuk non-blocking channel, `write()` bisa return 0. Maka buffer yang belum habis harus disimpan sebagai pending outbound data.

---

## 19. ByteBuffer dan Channel Read

Membaca dari channel:

```java
int n = channel.read(buffer);
```

Return value:

```text
n > 0   -> sejumlah byte dibaca
n == 0  -> tidak ada byte sekarang, umum pada non-blocking channel
n == -1 -> end-of-stream / peer closed / EOF
```

Bug umum:

```java
while (channel.read(buffer) >= 0) {
    // bisa busy loop jika read() return 0 terus
}
```

Untuk non-blocking channel, `0` bukan EOF.

---

## 20. Buffer Ownership

Di production code, bug `ByteBuffer` sering bukan karena API-nya sulit, tetapi karena ownership tidak jelas.

Pertanyaan ownership:

1. Siapa yang boleh menulis buffer ini?
2. Siapa yang boleh membaca buffer ini?
3. Siapa yang boleh mengubah position/limit?
4. Apakah buffer boleh disimpan setelah method return?
5. Apakah buffer akan dipakai ulang?
6. Apakah view berbagi content dengan buffer lain?
7. Apakah caller boleh menganggap content immutable?

### 20.1 Anti-Pattern: Expose Mutable Internal Buffer

```java
class Packet {
    private final ByteBuffer payload;

    Packet(ByteBuffer payload) {
        this.payload = payload;
    }

    ByteBuffer payload() {
        return payload;
    }
}
```

Masalah:

- caller bisa mengubah position,
- caller bisa mengubah content,
- internal state rusak.

Lebih baik:

```java
class Packet {
    private final ByteBuffer payload;

    Packet(ByteBuffer payload) {
        ByteBuffer copy = ByteBuffer.allocate(payload.remaining());
        copy.put(payload.duplicate());
        copy.flip();
        this.payload = copy.asReadOnlyBuffer();
    }

    ByteBuffer payload() {
        return payload.asReadOnlyBuffer();
    }
}
```

Trade-off: ada copy, tetapi ownership jelas.

### 20.2 Performance-Oriented Variant

Dalam hot path, copy bisa mahal. Maka boleh expose view jika contract eksplisit:

```java
/**
 * Returns a read-only view valid only until the next call to readNext().
 */
ByteBuffer currentPayloadView();
```

Contract seperti ini harus jelas, karena kalau tidak, bug akan sangat sulit dideteksi.

---

## 21. Thread Safety

`ByteBuffer` tidak boleh dianggap thread-safe untuk mutation state.

Masalah utama bukan hanya content, tetapi juga position/limit.

Contoh berbahaya:

```java
ByteBuffer shared = ByteBuffer.allocate(1024);

// Thread A
shared.put((byte) 1);

// Thread B
shared.put((byte) 2);
```

Race terjadi pada:

- position,
- content,
- visibility memory.

### 21.1 Duplicate untuk Cursor Independen Tidak Cukup

```java
ByteBuffer a = shared.duplicate();
ByteBuffer b = shared.duplicate();
```

Position independen, tetapi content tetap shared.

Jika dua thread menulis ke region sama, tetap race.

### 21.2 Pattern Aman

Pattern aman:

1. Single owner per mutable buffer.
2. Read-only duplicate untuk multi-reader setelah publish aman.
3. Copy jika perlu ownership terpisah.
4. Gunakan synchronization/lock jika shared mutation benar-benar diperlukan.
5. Hindari shared mutable `ByteBuffer` di API public.

---

## 22. Buffer Pooling

Allocation buffer besar berulang bisa mahal, terutama direct buffer.

Buffer pool bisa membantu, tetapi juga membawa kompleksitas.

### 22.1 Pool Sederhana

```java
final class ByteBufferPool {
    private final ArrayBlockingQueue<ByteBuffer> pool;
    private final int bufferSize;
    private final boolean direct;

    ByteBufferPool(int poolSize, int bufferSize, boolean direct) {
        this.pool = new ArrayBlockingQueue<>(poolSize);
        this.bufferSize = bufferSize;
        this.direct = direct;

        for (int i = 0; i < poolSize; i++) {
            pool.add(newBuffer());
        }
    }

    ByteBuffer borrow() throws InterruptedException {
        ByteBuffer buffer = pool.take();
        buffer.clear();
        return buffer;
    }

    void release(ByteBuffer buffer) {
        if (buffer.capacity() != bufferSize) {
            throw new IllegalArgumentException("foreign buffer");
        }
        buffer.clear();
        if (!pool.offer(buffer)) {
            throw new IllegalStateException("pool overflow");
        }
    }

    private ByteBuffer newBuffer() {
        return direct ? ByteBuffer.allocateDirect(bufferSize) : ByteBuffer.allocate(bufferSize);
    }
}
```

### 22.2 Pooling Failure Mode

Buffer pooling bisa menyebabkan bug serius:

1. Use-after-release.
2. Double release.
3. Data leak antar request.
4. Buffer dikembalikan saat masih dipakai async operation.
5. Pool starvation.
6. Memory retention.

### 22.3 Secure Release

Jika buffer berisi data sensitif, `clear()` tidak cukup.

```java
static void zero(ByteBuffer buffer) {
    ByteBuffer view = buffer.duplicate();
    view.clear();
    while (view.hasRemaining()) {
        view.put((byte) 0);
    }
}
```

Namun secure memory handling di managed runtime tetap punya batasan. Untuk secrets, hindari menyimpan terlalu lama dan minimalkan copies.

---

## 23. ByteBuffer dan Logging

Jangan sembarangan logging isi buffer.

Anti-pattern:

```java
log.info("payload={}", buffer);
```

Ini hanya print state, bukan content.

Anti-pattern lebih buruk:

```java
byte[] bytes = new byte[buffer.remaining()];
buffer.get(bytes);
log.info("payload={}", Arrays.toString(bytes));
```

Masalah:

- mengubah position,
- bisa logging data sensitif,
- bisa menghasilkan log besar,
- bisa alokasi besar.

Pattern lebih aman:

```java
static String hexPreview(ByteBuffer buffer, int maxBytes) {
    ByteBuffer view = buffer.asReadOnlyBuffer();
    int n = Math.min(view.remaining(), maxBytes);
    StringBuilder sb = new StringBuilder(n * 3);

    for (int i = 0; i < n; i++) {
        sb.append(String.format("%02x", view.get() & 0xFF));
        if (i + 1 < n) sb.append(' ');
    }

    if (view.remaining() > 0) {
        sb.append(" ...");
    }
    return sb.toString();
}
```

Tambahkan guard:

- max bytes,
- redact sensitive payload,
- logging hanya di debug/trace,
- tidak mengubah original position.

---

## 24. ByteBuffer dan Equality/Hashing

`ByteBuffer.equals()` dan `hashCode()` bergantung pada remaining elements, bukan seluruh capacity.

Artinya dua buffer dengan content backing sama tetapi position berbeda bisa tidak equal.

Contoh mental:

```java
ByteBuffer a = ByteBuffer.wrap(new byte[] {1, 2, 3});
ByteBuffer b = ByteBuffer.wrap(new byte[] {0, 1, 2, 3});
b.position(1);

System.out.println(a.equals(b)); // true, remaining sama: 1,2,3
```

Implikasi:

- Jangan jadikan mutable `ByteBuffer` sebagai key map.
- Jangan ubah position buffer setelah dipakai dalam struktur hash.
- Untuk key, copy ke immutable representation.

Contoh:

```java
record BytesKey(byte[] value) {
    BytesKey {
        value = value.clone();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof BytesKey other && Arrays.equals(value, other.value);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(value);
    }
}
```

Atau gunakan library yang menyediakan immutable bytes wrapper.

---

## 25. Exception Penting

Beberapa exception yang sering muncul:

### 25.1 BufferOverflowException

Terjadi saat `put` melebihi limit.

```java
ByteBuffer buffer = ByteBuffer.allocate(1);
buffer.put((byte) 1);
buffer.put((byte) 2); // BufferOverflowException
```

Penyebab umum:

- lupa cek `remaining()`,
- salah hitung length,
- lupa `clear()` sebelum write berikutnya,
- payload lebih besar dari buffer.

### 25.2 BufferUnderflowException

Terjadi saat `get` melebihi limit.

```java
ByteBuffer buffer = ByteBuffer.allocate(4);
buffer.flip();
buffer.get(); // BufferUnderflowException
```

Penyebab umum:

- lupa menulis data,
- salah `flip()`,
- parser tidak cek header/payload lengkap,
- partial read tidak ditangani.

### 25.3 ReadOnlyBufferException

Terjadi saat mutation pada read-only buffer.

```java
ByteBuffer readOnly = ByteBuffer.allocate(4).asReadOnlyBuffer();
readOnly.put((byte) 1); // ReadOnlyBufferException
```

### 25.4 UnsupportedOperationException dari array()

Terjadi saat memanggil `array()` pada buffer tanpa accessible backing array.

```java
ByteBuffer direct = ByteBuffer.allocateDirect(4);
direct.array(); // UnsupportedOperationException
```

Rule:

```java
if (buffer.hasArray()) {
    byte[] array = buffer.array();
}
```

---

## 26. Case Study: Framed TCP Reader dengan ByteBuffer

Kita buat parser length-prefix:

```text
Frame:
+----------------+----------------+
| length: int32  | payload bytes  |
+----------------+----------------+
```

Constraint:

- length big-endian,
- max payload 1 MiB,
- channel bisa partial read,
- buffer reusable,
- payload harus dicopy jika dikirim ke worker async.

### 26.1 Parser

```java
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

public final class LengthPrefixedFrameParser {
    private static final int HEADER_SIZE = Integer.BYTES;
    private final int maxFrameSize;

    public LengthPrefixedFrameParser(int maxFrameSize) {
        if (maxFrameSize <= 0) {
            throw new IllegalArgumentException("maxFrameSize must be positive");
        }
        this.maxFrameSize = maxFrameSize;
    }

    public List<ByteBuffer> parseAvailable(ByteBuffer buffer) {
        List<ByteBuffer> frames = new ArrayList<>();

        while (true) {
            if (buffer.remaining() < HEADER_SIZE) {
                return frames;
            }

            buffer.mark();
            int length = buffer.getInt();

            if (length < 0 || length > maxFrameSize) {
                throw new IllegalStateException("invalid frame length: " + length);
            }

            if (buffer.remaining() < length) {
                buffer.reset();
                return frames;
            }

            ByteBuffer frameView = buffer.slice(buffer.position(), length).asReadOnlyBuffer();
            buffer.position(buffer.position() + length);

            // Copy because frames may be processed after input buffer is reused.
            frames.add(copy(frameView));
        }
    }

    private static ByteBuffer copy(ByteBuffer source) {
        ByteBuffer copy = ByteBuffer.allocate(source.remaining());
        copy.put(source.duplicate());
        copy.flip();
        return copy.asReadOnlyBuffer();
    }
}
```

### 26.2 Reader Loop

```java
ByteBuffer input = ByteBuffer.allocateDirect(64 * 1024);
LengthPrefixedFrameParser parser = new LengthPrefixedFrameParser(1024 * 1024);

while (true) {
    int n = channel.read(input);

    if (n == -1) {
        input.flip();
        List<ByteBuffer> finalFrames = parser.parseAvailable(input);
        handle(finalFrames);

        if (input.hasRemaining()) {
            throw new IllegalStateException("truncated frame at EOF");
        }
        break;
    }

    if (n == 0) {
        continue; // untuk blocking channel jarang; untuk non-blocking jangan busy-loop seperti ini
    }

    input.flip();
    List<ByteBuffer> frames = parser.parseAvailable(input);
    handle(frames);
    input.compact();
}
```

### 26.3 Kenapa Ini Benar?

Karena:

1. Channel menulis ke buffer dalam write mode.
2. `flip()` mengubah buffer ke read mode.
3. Parser membaca sebanyak frame lengkap tersedia.
4. Jika frame belum lengkap, parser reset ke awal frame.
5. `compact()` mempertahankan sisa incomplete frame.
6. Buffer siap menerima data tambahan.
7. Payload dicopy karena akan dipakai setelah buffer input reused.

---

## 27. Case Study: Outbound Queue untuk Non-Blocking Write

Pada non-blocking socket, write bisa partial.

Kita perlu queue buffer outbound.

```java
final class OutboundQueue {
    private final ArrayDeque<ByteBuffer> queue = new ArrayDeque<>();

    void enqueue(ByteBuffer source) {
        ByteBuffer copy = ByteBuffer.allocate(source.remaining());
        copy.put(source.duplicate());
        copy.flip();
        queue.add(copy);
    }

    boolean flushTo(WritableByteChannel channel) throws IOException {
        while (!queue.isEmpty()) {
            ByteBuffer head = queue.peek();
            channel.write(head);

            if (head.hasRemaining()) {
                return false; // belum semua terkirim
            }

            queue.remove();
        }
        return true;
    }

    boolean isEmpty() {
        return queue.isEmpty();
    }
}
```

Kenapa copy saat enqueue?

Karena caller mungkin reuse/mutate buffer original. Dalam framework performa tinggi, copy bisa dihindari dengan ownership contract ketat atau reference-counted buffer, tetapi itu meningkatkan kompleksitas.

---

## 28. Decision Matrix

### 28.1 `byte[]` vs `ByteBuffer`

| Kebutuhan | Pilihan Umum | Alasan |
|---|---:|---|
| Operasi sederhana dengan `InputStream` | `byte[]` | API cocok, sederhana |
| Channel I/O | `ByteBuffer` | API NIO memakai buffer |
| Binary parser sequential | `ByteBuffer` | position/limit membantu |
| Perlu akses array langsung | heap `ByteBuffer` atau `byte[]` | direct tidak punya array |
| Data immutable kecil | `byte[]` copy / read-only heap buffer | ownership jelas |
| Interop library lama | `byte[]` | banyak API lama memakai array |
| High-throughput socket/file channel | direct `ByteBuffer` perlu benchmark | bisa mengurangi copy |
| Random access file besar | `MappedByteBuffer` | mmap bisa efisien |

### 28.2 Heap vs Direct vs Mapped

| Aspek | Heap ByteBuffer | Direct ByteBuffer | MappedByteBuffer |
|---|---|---|---|
| Content location | Java heap | Native memory | Mapped file region |
| Allocation cost | Relatif murah | Lebih mahal | Mapping cost + VM/page behavior |
| GC visibility | Heap terlihat jelas | Wrapper terlihat, content native | Wrapper + mapping |
| `array()` | Bisa jika backed array | Tidak | Tidak |
| Cocok untuk | parsing app, small/medium data | reusable I/O buffer | large random file access |
| Risiko | heap pressure | native memory pressure | unmap/lifetime/page fault |
| Lifetime | GC heap | cleaner/GC wrapper | valid sampai mapping GC/unmapped |
| Performance | bagus untuk app logic | bagus untuk I/O tertentu | bagus untuk workload tertentu |

---

## 29. Performance Notes

### 29.1 Jangan Optimasi Tanpa Bottleneck

Sebelum mengganti semua buffer menjadi direct, ukur dulu:

- throughput bytes/sec,
- latency p50/p95/p99,
- allocation rate,
- GC pause,
- native memory usage,
- CPU usage,
- syscall profile,
- disk/network saturation.

### 29.2 Ukuran Buffer

Ukuran buffer tidak punya angka universal.

Rule awal:

- 8 KiB: default reasonable untuk banyak stream klasik.
- 16–64 KiB: sering baik untuk channel file/socket throughput.
- 1 MiB+: hanya jika workload besar dan concurrency terbatas.

Yang harus dihitung:

```text
memory = bufferSize * concurrentBuffers
```

Contoh:

```text
64 KiB * 10_000 connections = ~640 MiB
1 MiB * 10_000 connections = ~10 GiB
```

Buffer besar bisa meningkatkan throughput tetapi menghancurkan memory footprint.

### 29.3 Allocation di Hot Path

Anti-pattern:

```java
void onRead(SocketChannel channel) {
    ByteBuffer buffer = ByteBuffer.allocateDirect(8192);
    channel.read(buffer);
}
```

Better:

- per-connection buffer,
- bounded pool,
- arena per worker,
- reuse with clear/compact.

### 29.4 Direct Memory Observability

Direct memory tidak muncul sebagai used heap biasa.

Untuk production, monitor:

- process RSS,
- native memory tracking jika enabled,
- direct buffer pool metrics melalui JMX/BufferPoolMXBean,
- GC logs,
- container memory limit.

Contoh:

```java
import java.lang.management.BufferPoolMXBean;
import java.lang.management.ManagementFactory;

for (BufferPoolMXBean bean : ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)) {
    System.out.printf(
        "%s: count=%d, memoryUsed=%d, totalCapacity=%d%n",
        bean.getName(),
        bean.getCount(),
        bean.getMemoryUsed(),
        bean.getTotalCapacity()
    );
}
```

---

## 30. Security Notes

### 30.1 clear() Tidak Menghapus Data

`clear()` hanya reset position/limit.

Jika buffer berisi secret:

```java
zero(buffer);
buffer.clear();
```

Tetapi ingat, mungkin sudah ada copy lain di heap/native/log.

### 30.2 Bound Semua Length

Binary parser wajib punya max size.

Buruk:

```java
int length = buffer.getInt();
byte[] payload = new byte[length];
```

Jika attacker kirim length 2 GB, service bisa OOM.

Benar:

```java
if (length < 0 || length > MAX_FRAME_SIZE) {
    throw new ProtocolException("invalid frame length");
}
```

### 30.3 Jangan Trust Buffer dari Boundary Luar

Jika buffer berasal dari network/file/user input:

- validasi magic/version,
- validasi length,
- validasi checksum jika perlu,
- validasi charset jika decode text,
- validasi field range,
- handle malformed data,
- jangan parse recursive tanpa limit.

### 30.4 Read-Only View Bukan Security Boundary Kuat

`asReadOnlyBuffer()` hanya mencegah mutation lewat view itu. Jika actor lain punya mutable original, content tetap bisa berubah.

---

## 31. Common Anti-Patterns

### 31.1 Lupa flip()

```java
ByteBuffer buffer = ByteBuffer.allocate(10);
buffer.put((byte) 1);
channel.write(buffer); // kemungkinan menulis dari position 1 sampai limit, bukan byte yang tadi ditulis
```

Benar:

```java
buffer.flip();
channel.write(buffer);
```

### 31.2 clear() Saat Masih Ada Data Belum Diproses

```java
buffer.flip();
tryParse(buffer);
buffer.clear(); // data incomplete hilang
```

Benar:

```java
buffer.flip();
tryParse(buffer);
buffer.compact();
```

### 31.3 Menyimpan Slice dari Buffer yang Akan Direuse

```java
ByteBuffer payload = input.slice();
input.clear();
channel.read(input);
processLater(payload); // payload mungkin corrupt
```

Benar:

```java
ByteBuffer stablePayload = copy(payload);
```

Atau contract lifetime eksplisit.

### 31.4 Menganggap duplicate() Melakukan Deep Copy

```java
ByteBuffer copy = original.duplicate(); // bukan copy content
```

Deep copy:

```java
ByteBuffer copy = ByteBuffer.allocate(original.remaining());
copy.put(original.duplicate());
copy.flip();
```

### 31.5 Memakai Direct Buffer untuk Semua Hal

Direct buffer bukan default universal.

Gunakan jika ada alasan:

- I/O boundary intensif,
- buffer reusable,
- terbukti membantu benchmark,
- native memory dimonitor.

### 31.6 Menjadikan ByteBuffer Mutable sebagai Map Key

```java
Map<ByteBuffer, Value> map = new HashMap<>();
map.put(buffer, value);
buffer.get(); // position berubah, hash/equality berubah
```

Gunakan immutable key.

---

## 32. Production Checklist

Sebelum memakai `ByteBuffer` di production code, cek:

### State Management

- [ ] Apakah mode write/read jelas?
- [ ] Apakah semua write-to-read transition memakai `flip()`?
- [ ] Apakah reuse setelah full consumption memakai `clear()`?
- [ ] Apakah reuse dengan sisa data memakai `compact()`?
- [ ] Apakah parser cek `remaining()` sebelum `getInt/getLong/get(payload)`?

### Memory Type

- [ ] Apakah heap/direct/mapped dipilih dengan alasan jelas?
- [ ] Apakah direct buffer dialokasi ulang di hot path?
- [ ] Apakah direct memory dimonitor?
- [ ] Apakah `array()` hanya dipakai setelah `hasArray()`?

### Ownership

- [ ] Siapa owner buffer?
- [ ] Apakah buffer boleh dimutasi caller?
- [ ] Apakah view/slice disimpan melewati lifetime backing buffer?
- [ ] Apakah perlu deep copy?
- [ ] Apakah read-only view cukup atau butuh immutable copy?

### Protocol Safety

- [ ] Apakah byte order eksplisit?
- [ ] Apakah max frame/payload size ada?
- [ ] Apakah partial read/write ditangani?
- [ ] Apakah EOF dengan incomplete frame dianggap error?
- [ ] Apakah malformed data tidak menyebabkan OOM?

### Security

- [ ] Apakah buffer berisi secret di-zero jika perlu?
- [ ] Apakah logging payload dibatasi/redacted?
- [ ] Apakah untrusted length divalidasi?
- [ ] Apakah read-only view tidak dianggap immutable security boundary?

### Performance

- [ ] Apakah ukuran buffer dihitung berdasarkan concurrency?
- [ ] Apakah benchmark dilakukan dengan workload realistis?
- [ ] Apakah allocation rate diamati?
- [ ] Apakah GC dan native memory diamati?
- [ ] Apakah copy di hot path memang diperlukan atau bisa dihindari dengan contract aman?

---

## 33. Latihan

### Latihan 1 — State Machine Trace

Diberikan kode:

```java
ByteBuffer b = ByteBuffer.allocate(8);
b.put((byte) 1);
b.put((byte) 2);
b.put((byte) 3);
b.flip();
b.get();
b.compact();
b.put((byte) 4);
b.flip();
```

Jawab:

1. Berapa `position`, `limit`, `capacity` setelah setiap langkah?
2. Byte apa saja yang readable setelah `flip()` terakhir?
3. Kenapa `compact()` bukan `clear()`?

### Latihan 2 — Parser Length-Prefix

Buat parser untuk format:

```text
version: u8
flags: u8
length: u16
payload: bytes[length]
crc32: u32
```

Requirement:

- big-endian,
- max payload 64 KiB,
- partial frame harus didukung,
- invalid version harus error,
- CRC harus diverifikasi,
- payload tidak boleh berubah setelah frame diterima.

### Latihan 3 — Buffer Ownership

Review API ini:

```java
interface Message {
    ByteBuffer payload();
}
```

Pertanyaan:

1. Apa risiko API ini?
2. Bagaimana contract-nya harus ditulis?
3. Apakah lebih baik return `byte[]`, `ByteBuffer`, atau custom immutable `Bytes`?
4. Bagaimana jika targetnya high-performance networking?

### Latihan 4 — Direct Buffer Pool

Desain buffer pool untuk direct buffer dengan constraint:

- max 128 buffer,
- tiap buffer 64 KiB,
- borrow timeout 100 ms,
- double release harus terdeteksi,
- use-after-release sebisa mungkin mudah dideteksi saat testing.

### Latihan 5 — Debugging Partial Write

Sebuah service mengirim response binary lewat non-blocking `SocketChannel`. Kadang client menerima payload terpotong.

Cari kemungkinan root cause:

1. Apakah `write()` diasumsikan menulis semua byte?
2. Apakah outbound buffer disimpan jika belum habis?
3. Apakah interest `OP_WRITE` diaktifkan saat queue belum kosong?
4. Apakah buffer position berubah oleh logging?
5. Apakah buffer direuse sebelum write selesai?

---

## 34. Ringkasan

`ByteBuffer` adalah salah satu API kecil yang dampaknya besar.

Ia terlihat sederhana, tetapi sebenarnya membawa beberapa konsep penting sekaligus:

1. state machine untuk read/write,
2. memory region abstraction,
3. binary encoding primitive,
4. bridge ke channel,
5. bridge ke native memory,
6. bridge ke file mapping,
7. foundation untuk high-performance I/O.

Hal paling penting untuk dikuasai:

```text
write mode -> flip -> read mode -> clear/compact -> write mode lagi
```

Dan invariant paling penting:

```text
0 <= position <= limit <= capacity
```

Keputusan engineering yang harus selalu eksplisit:

- heap atau direct?
- copy atau view?
- mutable atau read-only?
- short-lived atau pooled?
- sequential atau random access?
- parser bisa partial atau harus full buffer?
- payload trusted atau untrusted?
- buffer boleh disimpan atau hanya valid sampai read berikutnya?

Jika kamu menguasai `ByteBuffer`, maka part berikutnya tentang `FileChannel`, memory-mapped file, NIO networking, selector, dan data transfer reliability akan jauh lebih mudah, karena semuanya memakai mental model yang sama: **stateful byte movement across boundaries**.

---

## 35. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
Part 009 — FileChannel: Random Access, Transfer, Locking, Force, dan Zero-Copy
```

Di sana kita akan memakai `ByteBuffer` sebagai alat utama untuk memahami:

- positional file read/write,
- file channel state,
- `transferTo` dan `transferFrom`,
- zero-copy concept,
- file lock,
- durability dengan `force`,
- partial transfer,
- large file copy,
- append-only file pattern.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 007 — NIO Core: Buffer, Channel, Selector, dan Perubahan Mental Model dari Stream](./learn-java-io-nio-networking-data-transfer-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 009 — FileChannel: Random Access, Transfer, Locking, Force, dan Zero-Copy](./learn-java-io-nio-networking-data-transfer-part-009.md)
