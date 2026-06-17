# learn-java-memory-byte-bit-buffer-offheap-gc-part-011.md

# Part 011 — `ByteBuffer` Deep Dive: Heap Buffer, Direct Buffer, Slice, Duplicate, View

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `011`  
> Topik: `ByteBuffer` sebagai state machine memory, heap/direct buffer, slicing, duplication, view buffer, byte order, dan desain buffer-safe API  
> Target Java: 8 sampai 25

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membangun fondasi tentang:

- bit dan byte,
- primitive representation,
- object layout,
- reference graph,
- stack/heap/native memory,
- allocation mechanics,
- object lifetime,
- reference strength,
- array/string footprint,
- bit manipulation untuk sistem nyata.

Sekarang kita masuk ke salah satu abstraksi paling penting untuk sistem Java yang dekat dengan I/O, binary protocol, file format, networking, memory mapping, dan off-heap memory:

```java
java.nio.ByteBuffer
```

Namun bagian ini **bukan mengulang seri I/O/NIO**. Fokus kita bukan `SocketChannel`, `FileChannel`, atau API I/O umum. Fokus kita adalah memahami `ByteBuffer` sebagai **abstraksi memory region + cursor state machine**.

Setelah bagian ini, target pemahamanmu:

1. Bisa melihat `ByteBuffer` bukan sebagai “array byte modern”, tetapi sebagai **bounded mutable memory window**.
2. Bisa membedakan `capacity`, `position`, `limit`, `mark` secara presisi.
3. Bisa menjelaskan kenapa `flip()`, `clear()`, `compact()`, `rewind()` sering menjadi sumber bug.
4. Bisa membedakan heap buffer dan direct buffer dari sisi memory, GC, copy path, dan lifecycle.
5. Bisa memakai `slice()`, `duplicate()`, `asReadOnlyBuffer()`, dan view buffer tanpa corrupt state.
6. Bisa mendesain API berbasis buffer yang aman dari accidental mutation, shared-position bug, dan boundary confusion.
7. Bisa membaca bug produksi seperti:
   - data binary terpotong,
   - buffer dikirim kosong,
   - stale bytes ikut terkirim,
   - endian mismatch,
   - memory leak direct buffer,
   - race karena buffer dishare antar thread.

---

## 1. Mental Model Utama: `ByteBuffer` adalah Memory + Cursor + Boundary

`ByteBuffer` bukan hanya container byte. Ia adalah gabungan dari tiga hal:

```text
ByteBuffer
  = memory storage
  + cursor state
  + access policy
```

Secara mental:

```text
+---------------------------------------------------+
| underlying memory                                 |
| byte[0] byte[1] byte[2] ... byte[capacity - 1]    |
+---------------------------------------------------+
      ^                    ^
      |                    |
   position              limit
```

State utama buffer:

| State | Makna |
|---|---|
| `capacity` | ukuran total storage buffer; fixed setelah buffer dibuat |
| `position` | index byte berikutnya yang akan dibaca/ditulis oleh operasi relatif |
| `limit` | index pertama yang tidak boleh dibaca/ditulis |
| `mark` | bookmark opsional untuk kembali ke posisi tertentu |

Invariant penting:

```text
0 <= mark <= position <= limit <= capacity
```

`mark` bisa tidak terdefinisi. Tetapi jika terdefinisi, ia tidak boleh lebih besar dari `position`.

Oracle Java SE API mendefinisikan `Buffer` sebagai container data fixed-size yang memiliki position dan limit; `position` adalah index elemen berikutnya untuk read/write, sedangkan `limit` adalah index pertama yang tidak boleh dibaca/ditulis. `flip()`, `clear()`, `rewind()`, `mark()`, dan `reset()` adalah operasi state di atas model ini.

---

## 2. `ByteBuffer` Bukan “Byte Array dengan Method Tambahan”

Banyak bug `ByteBuffer` berasal dari asumsi ini:

```text
ByteBuffer = byte[] + utility methods
```

Lebih akurat:

```text
ByteBuffer = bounded memory window with mutable cursor
```

Perbedaan penting:

| Aspek | `byte[]` | `ByteBuffer` |
|---|---|---|
| Storage | selalu heap array | bisa heap atau direct/native |
| Cursor | tidak ada | punya `position`, `limit`, `mark` |
| Boundary aktif | selalu `0..length` | `position..limit` untuk operasi relatif |
| Byte order | manual | punya `ByteOrder` untuk multi-byte primitive |
| View | manual offset/length | bisa `slice`, `duplicate`, typed view |
| Channel integration | perlu wrapping/copy | native NIO API menerima buffer |
| Mutability state | hanya isi array | isi + cursor berubah |

Konsekuensinya: dua bug besar yang tidak ada pada `byte[]` sering muncul di `ByteBuffer`:

1. **Content benar, cursor salah.**
2. **Cursor benar, content stale.**

Contoh:

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
buffer.putInt(42);

// Lupa flip()
while (buffer.hasRemaining()) {
    // Tidak membaca data yang baru ditulis karena position sudah berada setelah data.
}
```

Isi buffer sebenarnya ada. Tetapi state buffer tidak sedang berada dalam mode read.

---

## 3. Dua Mode Mental: Write Mode dan Read Mode

Secara API, `ByteBuffer` tidak punya flag `mode = READ` atau `mode = WRITE`.

Tetapi secara mental, kita hampir selalu menggunakannya dalam dua fase:

```text
WRITE MODE:
  position = tempat menulis berikutnya
  limit    = capacity atau boundary write

READ MODE:
  position = tempat membaca berikutnya
  limit    = akhir data valid
```

### 3.1 Saat Baru Dialokasikan

```java
ByteBuffer buffer = ByteBuffer.allocate(16);
```

State awal:

```text
capacity = 16
position = 0
limit    = 16
```

Artinya cocok untuk menulis sampai 16 byte.

```text
[ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ ]
  ^                               ^
  position                        limit/capacity
```

### 3.2 Setelah Menulis Data

```java
buffer.put((byte) 10);
buffer.put((byte) 20);
buffer.put((byte) 30);
```

State:

```text
capacity = 16
position = 3
limit    = 16
```

```text
[10 20 30 _ _ _ _ _ _ _ _ _ _ _ _ _]
          ^                         ^
          position                  limit
```

Masalah: data valid hanya `0..2`, tetapi `limit` masih 16. Kalau langsung dibaca relatif, tidak mulai dari 0.

### 3.3 `flip()` Mengubah Write Mode ke Read Mode

```java
buffer.flip();
```

Efek:

```text
limit    = old position
position = 0
mark     = discarded
```

State:

```text
capacity = 16
position = 0
limit    = 3
```

```text
[10 20 30 _ _ _ _ _ _ _ _ _ _ _ _ _]
 ^        ^                         ^
 position limit                     capacity
```

Sekarang operasi relatif `get()` membaca byte valid saja.

### 3.4 Setelah Membaca Sebagian

```java
byte a = buffer.get(); // 10
byte b = buffer.get(); // 20
```

State:

```text
position = 2
limit    = 3
```

```text
[10 20 30 _ _ _ _ _ _ _ _ _ _ _ _ _]
       ^  ^
       |  limit
       position
```

Sisa data:

```java
buffer.remaining(); // 1
```

### 3.5 `clear()` Bukan Menghapus Isi

```java
buffer.clear();
```

Efek:

```text
position = 0
limit    = capacity
mark     = discarded
```

`clear()` tidak men-zero-kan memory.

Setelah `clear()`:

```text
[10 20 30 _ _ _ _ _ _ _ _ _ _ _ _ _]
 ^                                      ^
 position                               limit/capacity
```

Byte lama masih mungkin ada di storage, tetapi dianggap boleh ditimpa.

Ini sangat penting untuk security dan correctness:

```text
clear() means "forget current cursor state and prepare for writing"
not "wipe sensitive content"
```

Jika buffer berisi secret, token, password, key material, atau data sensitif, `clear()` **bukan sanitization**.

---

## 4. Empat Operasi State Paling Penting

### 4.1 `flip()`

Gunakan ketika selesai menulis dan ingin membaca data yang baru ditulis.

```java
buffer.put(payload);
buffer.flip();
channel.write(buffer);
```

Efek:

```text
limit = position
position = 0
```

Mental model:

```text
"Data valid adalah dari awal sampai posisi tulis terakhir. Sekarang baca dari awal."
```

### 4.2 `clear()`

Gunakan ketika selesai membaca/menulis dan ingin memakai buffer lagi untuk menulis dari awal.

```java
buffer.clear();
channel.read(buffer);
```

Efek:

```text
position = 0
limit = capacity
```

Mental model:

```text
"Saya tidak peduli data lama. Saya ingin mengisi buffer lagi."
```

Bukan:

```text
"hapus isi buffer"
```

### 4.3 `rewind()`

Gunakan untuk membaca ulang data yang sama dari awal, tanpa mengubah limit.

```java
buffer.flip();
parse(buffer);
buffer.rewind();
hash(buffer);
```

Efek:

```text
position = 0
limit unchanged
```

Mental model:

```text
"Baca ulang region valid yang sama."
```

### 4.4 `compact()`

Gunakan ketika sebagian data sudah dibaca, tetapi masih ada sisa data yang perlu dipertahankan, lalu ingin melanjutkan menulis setelah sisa data itu.

Contoh kasus streaming parser:

```text
read bytes from socket
parse complete messages
some bytes remain because last message incomplete
compact remaining bytes to front
read more bytes after them
```

Efek konseptual:

```text
remaining bytes [position..limit) copied to beginning
position = number of remaining bytes
limit = capacity
```

Contoh:

```text
Before compact in read mode:

[ A B C D E F _ _ ]
      ^     ^     ^
      pos   limit capacity

Remaining = C D E F

After compact:

[ C D E F E F _ _ ]
        ^         ^
        pos       limit/capacity
```

Isi setelah `position` tidak relevan dan boleh dianggap stale.

Mental model:

```text
"Simpan unread bytes, geser ke depan, lalu lanjut tulis setelahnya."
```

---

## 5. State Transition Cheat Sheet

Misalkan:

```java
ByteBuffer b = ByteBuffer.allocate(10);
```

| Operation | position | limit | capacity | Makna |
|---|---:|---:|---:|---|
| after allocate | 0 | 10 | 10 | siap menulis |
| put 4 bytes | 4 | 10 | 10 | 4 byte valid, tapi masih write mode |
| flip | 0 | 4 | 10 | siap membaca 4 byte valid |
| get 2 bytes | 2 | 4 | 10 | 2 byte tersisa |
| rewind | 0 | 4 | 10 | baca ulang 4 byte valid |
| clear | 0 | 10 | 10 | siap menulis ulang dari awal |
| after get 2 then compact | 2 | 10 | 10 | 2 byte sisa dipindah ke depan, siap lanjut menulis |

---

## 6. Relative vs Absolute Access

`ByteBuffer` memiliki dua gaya akses:

1. Relative access.
2. Absolute access.

### 6.1 Relative Access

Relative access memakai dan mengubah `position`.

```java
byte b1 = buffer.get();
byte b2 = buffer.get();
buffer.put((byte) 99);
```

Setiap `get()`/`put()` relatif menggeser `position`.

Mental model:

```text
relative operation = use current cursor, then advance cursor
```

Cocok untuk:

- sequential parser,
- sequential writer,
- protocol encoder/decoder,
- streaming loop.

### 6.2 Absolute Access

Absolute access memakai index eksplisit dan tidak mengubah `position`.

```java
byte first = buffer.get(0);
int length = buffer.getInt(4);
buffer.put(8, (byte) 1);
```

Mental model:

```text
absolute operation = random access within boundary, cursor unchanged
```

Cocok untuk:

- membaca header fixed-offset,
- patching length field setelah body ditulis,
- checksum field,
- binary format dengan offset table,
- debugging.

Contoh pattern encoding length-prefixed message:

```java
ByteBuffer out = ByteBuffer.allocate(1024);

int lengthPos = out.position();
out.putInt(0); // placeholder length

int bodyStart = out.position();
out.put((byte) 1); // type
out.putLong(123456789L);
out.put("hello".getBytes(StandardCharsets.UTF_8));

int bodyEnd = out.position();
int bodyLength = bodyEnd - bodyStart;

out.putInt(lengthPos, bodyLength); // absolute patch; position tetap bodyEnd
out.flip();
```

Tanpa absolute access, kita sering harus simpan/restore position manual, yang rawan bug.

---

## 7. Heap Buffer vs Direct Buffer

Ada dua kategori besar `ByteBuffer`:

```java
ByteBuffer heap = ByteBuffer.allocate(1024);
ByteBuffer direct = ByteBuffer.allocateDirect(1024);
```

### 7.1 Heap ByteBuffer

Heap buffer menyimpan content di Java heap.

Biasanya backing storage-nya adalah `byte[]`.

```java
ByteBuffer heap = ByteBuffer.allocate(1024);
heap.hasArray(); // true untuk heap buffer biasa
byte[] arr = heap.array();
```

Kelebihan:

- allocation murah relatif,
- dikelola GC sebagai object heap biasa,
- mudah diakses sebagai array,
- cocok untuk data kecil/menengah,
- lifecycle sederhana.

Kekurangan:

- saat dipakai untuk I/O native, JVM/OS mungkin perlu copy ke native buffer sementara,
- array backing bisa bocor secara API jika diekspos,
- object heap menambah GC pressure.

### 7.2 Direct ByteBuffer

Direct buffer menyimpan content di luar Java heap, pada native memory.

```java
ByteBuffer direct = ByteBuffer.allocateDirect(1024);
direct.isDirect(); // true
```

Kelebihan:

- lebih cocok untuk I/O native,
- bisa mengurangi copy pada channel/native path,
- tidak menambah heap occupancy sebesar content-nya,
- sering dipakai pada high-throughput networking/storage.

Kekurangan:

- allocation/deallocation lebih mahal,
- lifecycle lebih sulit,
- cleanup bergantung pada reachability/Cleaner implementation detail,
- bisa menyebabkan `OutOfMemoryError: Direct buffer memory`,
- heap dump tidak menunjukkan content native memory secara normal,
- RSS process naik walau heap terlihat stabil.

### 7.3 Perbandingan Praktis

| Dimensi | Heap Buffer | Direct Buffer |
|---|---|---|
| Storage | Java heap | native/off-heap memory |
| GC melihat content | ya, sebagai heap array | tidak sebagai heap content biasa |
| Object wrapper | tetap heap object | tetap ada heap wrapper kecil |
| Allocation cost | relatif murah | relatif mahal |
| Deallocation | GC heap biasa | Cleaner/native free setelah unreachable |
| `hasArray()` | biasanya true | false |
| Cocok untuk | parsing kecil, application payload, temporary bytes | I/O intensif, long-lived reusable buffer, native interop |
| Risiko | heap pressure | native memory pressure/RSS/OOMKilled |

### 7.4 Rule of Thumb

Gunakan heap buffer jika:

- data kecil,
- lifecycle pendek,
- sering diakses sebagai Java array,
- tidak ada kebutuhan I/O native intensif,
- simplicity lebih penting.

Gunakan direct buffer jika:

- buffer reusable,
- dipakai intensif dengan channel/native I/O,
- ukuran cukup besar,
- ingin mengurangi copy path,
- lifecycle bisa dikontrol dengan jelas,
- observability native memory tersedia.

Jangan memakai direct buffer hanya karena terdengar “lebih cepat”. Dalam banyak kasus aplikasi biasa, direct buffer yang dialokasikan sering-sering justru lebih buruk.

---

## 8. `wrap()` vs `allocate()` vs `allocateDirect()`

### 8.1 `allocate()`

```java
ByteBuffer b = ByteBuffer.allocate(1024);
```

Membuat heap buffer baru dengan capacity fixed.

State awal:

```text
position = 0
limit = capacity
```

### 8.2 `allocateDirect()`

```java
ByteBuffer b = ByteBuffer.allocateDirect(1024);
```

Membuat direct buffer di native memory.

State awal sama, tetapi storage berbeda.

### 8.3 `wrap(byte[])`

```java
byte[] data = new byte[1024];
ByteBuffer b = ByteBuffer.wrap(data);
```

Membuat buffer view di atas array yang sudah ada.

Perubahan lewat buffer terlihat di array, dan perubahan array terlihat di buffer.

```java
byte[] data = new byte[] {1, 2, 3};
ByteBuffer b = ByteBuffer.wrap(data);

b.put(0, (byte) 9);
System.out.println(data[0]); // 9

data[1] = 8;
System.out.println(b.get(1)); // 8
```

### 8.4 `wrap(byte[], offset, length)`

```java
ByteBuffer b = ByteBuffer.wrap(data, 10, 20);
```

Ini sering disalahpahami.

`wrap(array, offset, length)` tidak membuat buffer dengan capacity `length`. Ia membuat buffer di atas seluruh array, dengan:

```text
capacity = array.length
position = offset
limit = offset + length
```

Jika kamu ingin buffer yang benar-benar tampak sebagai window `0..length`, biasanya lebih jelas pakai:

```java
ByteBuffer b = ByteBuffer.wrap(data)
                         .position(offset)
                         .limit(offset + length)
                         .slice();
```

Dengan `slice()`, buffer baru punya position 0 dan capacity = remaining window.

---

## 9. `slice()`: Membuat Window Baru atas Storage yang Sama

`slice()` membuat buffer baru yang content-nya berbagi storage dengan buffer asli, tetapi state cursor-nya independen.

```java
ByteBuffer original = ByteBuffer.allocate(10);
original.position(2);
original.limit(7);

ByteBuffer slice = original.slice();
```

`slice` melihat region original dari `[position..limit)`.

State konseptual:

```text
original storage:
index:    0 1 2 3 4 5 6 7 8 9
          . . A B C D E . . .
              ^         ^
              pos       limit

slice storage view:
index:        0 1 2 3 4
              A B C D E
              ^         ^
              pos=0     limit=capacity=5
```

Perubahan content shared:

```java
slice.put(0, (byte) 99);
System.out.println(original.get(2)); // 99
```

Tetapi position/limit independen:

```java
slice.position(3);
System.out.println(original.position()); // tetap 2
```

### 9.1 Kapan `slice()` Berguna?

- Membuat frame payload dari buffer network.
- Membatasi parser ke satu message.
- Membuat view atas header/body.
- Memberikan sub-buffer ke API lain tanpa menyalin.
- Menghindari offset arithmetic manual.

Contoh:

```java
ByteBuffer packet = receivePacket();

int type = packet.get() & 0xFF;
int length = packet.getShort() & 0xFFFF;

ByteBuffer payload = packet.slice(packet.position(), length);
processPayload(payload);

packet.position(packet.position() + length);
```

Di Java modern ada overload `slice(int index, int length)`, yang lebih eksplisit dan mengurangi manipulasi state parent.

### 9.2 Risiko `slice()`

`slice()` tidak copy content. Jadi:

```text
slice is not ownership transfer
slice is shared mutable memory window
```

Risiko:

1. Parent buffer direuse dan menimpa data slice.
2. Slice disimpan terlalu lama sehingga buffer besar tertahan di memory.
3. Caller mengubah content slice dan memengaruhi parent.
4. Developer mengira slice independen secara content.
5. Slice dari direct buffer mempertahankan native memory parent tetap reachable.

Anti-pattern:

```java
List<ByteBuffer> messages = new ArrayList<>();

ByteBuffer readBuffer = ByteBuffer.allocateDirect(1024 * 1024);

// parse banyak message kecil
ByteBuffer msg = readBuffer.slice(offset, length);
messages.add(msg); // menahan seluruh 1 MB buffer walau message cuma 50 byte
```

Jika message harus hidup lebih lama dari read buffer, copy ke buffer/array terpisah:

```java
byte[] copy = new byte[length];
ByteBuffer view = readBuffer.slice(offset, length);
view.get(copy);
messages.add(ByteBuffer.wrap(copy));
```

---

## 10. `duplicate()`: State Independen, Region Sama

`duplicate()` membuat buffer baru yang berbagi content dengan buffer asli dan memiliki state awal sama:

```java
ByteBuffer a = ByteBuffer.allocate(10);
a.position(2);
a.limit(8);

ByteBuffer b = a.duplicate();
```

State awal `b`:

```text
position = 2
limit = 8
capacity = 10
```

Tetapi setelah itu position/limit independen.

Gunakan `duplicate()` ketika:

- ingin membaca buffer tanpa mengubah position caller,
- ingin multiple cursor atas storage yang sama,
- ingin pass buffer ke method yang akan mengubah position,
- ingin membuat read-only projection setelah duplicate.

Contoh pattern aman:

```java
static int checksum(ByteBuffer input) {
    ByteBuffer b = input.duplicate(); // tidak mengganggu caller
    int sum = 0;
    while (b.hasRemaining()) {
        sum += b.get() & 0xFF;
    }
    return sum;
}
```

Tanpa `duplicate()`, method `checksum()` akan menghabiskan `position` buffer caller.

### 10.1 `duplicate()` Bukan Copy

```java
ByteBuffer a = ByteBuffer.allocate(4);
ByteBuffer b = a.duplicate();

b.put(0, (byte) 7);
System.out.println(a.get(0)); // 7
```

Content tetap shared.

---

## 11. `asReadOnlyBuffer()`: Read-only View, Bukan Immutable Data

```java
ByteBuffer readOnly = buffer.asReadOnlyBuffer();
```

Read-only buffer tidak mengizinkan modification lewat view tersebut:

```java
readOnly.put((byte) 1); // ReadOnlyBufferException
```

Tetapi content bisa tetap berubah lewat buffer asli:

```java
ByteBuffer mutable = ByteBuffer.allocate(4);
ByteBuffer ro = mutable.asReadOnlyBuffer();

mutable.put(0, (byte) 42);
System.out.println(ro.get(0)); // 42
```

Jadi:

```text
read-only view != immutable snapshot
```

Gunakan untuk:

- mencegah callee menulis lewat buffer yang diberikan,
- membuat API contract lebih jelas,
- melindungi dari accidental modification.

Jangan gunakan sebagai snapshot keamanan jika owner asli masih bisa mengubah data.

---

## 12. Typed View Buffers: `asIntBuffer()`, `asLongBuffer()`, dan Teman-temannya

`ByteBuffer` bisa membuat view sebagai buffer primitive lain:

```java
ByteBuffer bytes = ByteBuffer.allocate(16);
IntBuffer ints = bytes.asIntBuffer();
```

Jika byte buffer punya 16 byte, `IntBuffer` view punya capacity 4 integer.

View buffer:

- berbagi content dengan byte buffer,
- punya position/limit/mark independen,
- membaca/menulis primitive berdasarkan byte order saat view dibuat.

Contoh:

```java
ByteBuffer bytes = ByteBuffer.allocate(8);
bytes.order(ByteOrder.BIG_ENDIAN);

IntBuffer ints = bytes.asIntBuffer();
ints.put(0, 0x01020304);

System.out.printf("%02x %02x %02x %02x%n",
        bytes.get(0), bytes.get(1), bytes.get(2), bytes.get(3));
// 01 02 03 04
```

### 12.1 View Buffer untuk Homogeneous Binary Data

Typed view cocok jika data format berisi sequence homogeneous:

```text
int int int int int
long long long
float float float
```

Contoh:

```java
ByteBuffer bytes = ByteBuffer.allocate(4 * 1000)
                             .order(ByteOrder.LITTLE_ENDIAN);
IntBuffer ints = bytes.asIntBuffer();

for (int i = 0; i < ints.capacity(); i++) {
    ints.put(i, i * 10);
}
```

### 12.2 Jangan Campur Cursor ByteBuffer dan View Buffer Sembarangan

Karena cursor independen, ini bisa membingungkan:

```java
ByteBuffer bytes = ByteBuffer.allocate(16);
IntBuffer ints = bytes.asIntBuffer();

ints.put(123);
System.out.println(ints.position());  // 1
System.out.println(bytes.position()); // 0
```

`ints.put(123)` menulis 4 byte ke storage, tetapi `bytes.position()` tetap 0.

Jika setelah itu kamu melakukan:

```java
bytes.put((byte) 9);
```

Maka byte pertama dari integer tadi tertimpa.

Rule:

```text
Jangan menggunakan dua cursor berbeda untuk menulis region yang sama kecuali boundary-nya didesain eksplisit.
```

---

## 13. Byte Order: Big-endian, Little-endian, Native Order

Multi-byte primitive perlu urutan byte.

```java
ByteBuffer b = ByteBuffer.allocate(4);
b.order(ByteOrder.BIG_ENDIAN);
b.putInt(0x01020304);
```

Big-endian:

```text
01 02 03 04
```

Little-endian:

```text
04 03 02 01
```

### 13.1 Default Byte Order

Default `ByteBuffer` adalah big-endian.

Ini sesuai tradisi network byte order, tetapi tidak selalu sesuai format file/native platform.

Selalu set byte order secara eksplisit untuk binary format:

```java
ByteBuffer b = ByteBuffer.wrap(data)
                         .order(ByteOrder.LITTLE_ENDIAN);
```

Jangan bergantung pada default jika format eksternal memiliki spesifikasi endian.

### 13.2 `ByteOrder.nativeOrder()`

```java
ByteOrder nativeOrder = ByteOrder.nativeOrder();
```

Gunakan untuk performance-sensitive direct buffer yang akan dipakai bersama native code/hardware order.

Tetapi untuk protocol/file format, gunakan order yang ditentukan spec, bukan native order.

```text
Protocol/file format order = compatibility concern
Native order = local performance concern
```

### 13.3 View Buffer dan Byte Order

Byte order view buffer ditentukan dari byte buffer saat view dibuat.

Aman secara desain:

```java
ByteBuffer bytes = ByteBuffer.allocate(1024)
                             .order(ByteOrder.LITTLE_ENDIAN);
IntBuffer ints = bytes.asIntBuffer();
```

Jangan ubah order parent buffer setelah view dibuat dan berharap view ikut berubah. Treat order sebagai bagian dari construction contract.

---

## 14. Boundary Discipline: `remaining()`, `hasRemaining()`, dan Length Check

`ByteBuffer` memberi boundary aktif lewat `position` dan `limit`.

Gunakan:

```java
buffer.remaining();
buffer.hasRemaining();
```

Untuk parser binary, jangan langsung `getInt()` tanpa memastikan cukup byte:

```java
if (buffer.remaining() < Integer.BYTES) {
    return NEED_MORE_DATA;
}
int value = buffer.getInt();
```

Jika tidak cukup, operasi relatif akan melempar `BufferUnderflowException`.

Untuk writer:

```java
if (buffer.remaining() < requiredBytes) {
    throw new BufferOverflowException();
}
buffer.putInt(value);
```

### 14.1 Parser Harus Transactional terhadap Position

Saat parsing format yang bisa incomplete, hati-hati dengan partial consumption.

Anti-pattern:

```java
int len = buffer.getInt();
if (buffer.remaining() < len) {
    return NEED_MORE; // position sudah maju 4 byte, state rusak
}
```

Pattern lebih aman:

```java
if (buffer.remaining() < Integer.BYTES) {
    return NEED_MORE;
}

buffer.mark();
int len = buffer.getInt();

if (buffer.remaining() < len) {
    buffer.reset(); // kembali sebelum length
    return NEED_MORE;
}

ByteBuffer payload = buffer.slice(buffer.position(), len);
buffer.position(buffer.position() + len);
return parse(payload);
```

Atau gunakan absolute access:

```java
if (buffer.remaining() < Integer.BYTES) {
    return NEED_MORE;
}

int pos = buffer.position();
int len = buffer.getInt(pos);

if (buffer.remaining() < Integer.BYTES + len) {
    return NEED_MORE;
}

buffer.position(pos + Integer.BYTES);
ByteBuffer payload = buffer.slice(buffer.position(), len);
buffer.position(buffer.position() + len);
```

Absolute access sering lebih aman untuk peeking header.

---

## 15. Buffer as a State Machine

Untuk benar-benar menguasai `ByteBuffer`, pikirkan sebagai state machine:

```text
ALLOCATED_WRITE_MODE
  -- put/read-channel --> PARTIALLY_FILLED_WRITE_MODE
  -- flip ------------> READ_MODE

READ_MODE
  -- get/write-channel --> PARTIALLY_CONSUMED_READ_MODE
  -- rewind -----------> READ_MODE_FROM_START
  -- clear ------------> WRITE_MODE_EMPTY
  -- compact ----------> WRITE_MODE_WITH_UNREAD_PREFIX
```

Diagram:

```text
                 put()/channel.read()
        +--------------------------------+
        |                                v
+----------------+               +-------------------+
| write mode     |               | partially filled  |
| pos=0 lim=cap  |               | pos>0 lim=cap     |
+----------------+               +-------------------+
        ^                                |
        | clear()                        | flip()
        |                                v
+----------------+               +-------------------+
| after compact  |<-- compact()--| read mode         |
| unread at head |               | pos=0 lim=dataEnd |
+----------------+               +-------------------+
                                        |
                                        | get()/channel.write()
                                        v
                                +-------------------+
                                | partially read    |
                                | pos>0 lim=dataEnd |
                                +-------------------+
```

Bug terjadi saat state machine dilanggar.

Contoh:

| Bug | Pelanggaran State |
|---|---|
| write channel mengirim 0 byte | lupa `flip()` setelah `put()` |
| parser membaca stale data | lupa set `limit` ke data valid |
| data incomplete hilang | pakai `clear()` bukan `compact()` |
| message kecil menahan buffer besar | menyimpan `slice()` long-lived |
| checksum mengubah position caller | tidak pakai `duplicate()` |
| endian salah | tidak set `order()` eksplisit |
| corrupt shared data | dua view menulis region sama |

---

## 16. Channel I/O Pattern: Read, Flip, Drain, Compact

Walau kita tidak mengulang NIO, pattern ini wajib dipahami karena membentuk lifecycle buffer.

Streaming read loop umum:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(8192);

while (running) {
    int n = channel.read(buffer); // write mode: channel writes into buffer
    if (n == -1) {
        break;
    }

    buffer.flip(); // read mode: application reads from buffer

    while (true) {
        ParseResult result = tryParseOneMessage(buffer);
        if (result == ParseResult.NEED_MORE_DATA) {
            break;
        }
        handle(result.message());
    }

    buffer.compact(); // preserve incomplete bytes, return to write mode
}
```

Kenapa bukan `clear()`?

Karena di akhir parse mungkin masih ada bytes incomplete:

```text
[length=100][only 30 bytes payload available]
```

Jika `clear()`, 30 byte hilang.

Kenapa bukan selalu `rewind()`?

Karena `rewind()` akan membaca ulang data lama tanpa memberi ruang untuk data baru.

---

## 17. Write Loop Pattern: Partial Writes

Channel write tidak selalu menghabiskan seluruh buffer dalam satu call.

Pattern:

```java
ByteBuffer out = encodeMessage(message);

while (out.hasRemaining()) {
    channel.write(out);
}
```

`write()` akan membaca dari `position` sampai `limit`, lalu memajukan position sejumlah byte yang berhasil ditulis.

Jika non-blocking channel, write bisa 0. Maka loop harus dikelola oleh selector/event loop, bukan busy spin.

Bug umum:

```java
channel.write(out);
out.clear(); // BUG: mungkin belum semua bytes terkirim
```

Correct principle:

```text
Buffer boleh clear/reuse hanya setelah !hasRemaining() untuk data yang harus dikirim.
```

---

## 18. Designing API with `ByteBuffer`

Masalah besar dalam API berbasis buffer: siapa yang memiliki cursor? siapa yang memiliki content? siapa yang boleh mutate?

### 18.1 Jangan Ambigu: Apakah Method Mengonsumsi Position?

Bad API:

```java
void parse(ByteBuffer buffer);
```

Tidak jelas:

- apakah method membaca dari current position?
- apakah position caller akan berubah?
- apakah method boleh mengubah limit?
- apakah method menyimpan buffer?
- apakah method boleh menulis content?

Lebih baik dokumentasikan contract:

```java
/**
 * Parses one message from buffer.position() to buffer.limit().
 * On success, advances buffer.position() past the parsed message.
 * On NEED_MORE_DATA, leaves buffer.position() unchanged.
 * Does not retain the buffer after returning.
 */
ParseResult parseOne(ByteBuffer buffer);
```

### 18.2 Jika Method Hanya Membaca, Pertimbangkan `duplicate()`

```java
static boolean hasMagic(ByteBuffer input) {
    ByteBuffer b = input.duplicate();
    if (b.remaining() < 4) return false;
    return b.get() == 'M'
        && b.get() == 'A'
        && b.get() == 'G'
        && b.get() == 'C';
}
```

### 18.3 Jika Tidak Boleh Mutate, Terima Read-only View atau Buat Defensive View

```java
void send(ByteBuffer payload) {
    ByteBuffer readOnly = payload.asReadOnlyBuffer();
    queue.add(readOnly);
}
```

Tetapi ingat: read-only bukan immutable snapshot. Jika caller bisa mutate buffer asli setelah `send()`, data queue bisa berubah.

Untuk async boundary, copy sering lebih aman:

```java
static ByteBuffer copyRemaining(ByteBuffer source) {
    ByteBuffer src = source.duplicate();
    ByteBuffer copy = ByteBuffer.allocate(src.remaining());
    copy.put(src);
    copy.flip();
    return copy;
}
```

### 18.4 Synchronous Boundary vs Asynchronous Boundary

| Boundary | Bisa pakai shared buffer? | Catatan |
|---|---|---|
| synchronous parse langsung | biasanya bisa | jangan retain buffer |
| synchronous read-only utility | bisa dengan duplicate | jangan ubah caller position |
| async queue | berbahaya | copy atau ownership transfer eksplisit |
| cross-thread | berbahaya | buffer bukan thread-safe |
| cache | sangat berbahaya | copy/snapshot lebih aman |

---

## 19. Thread Safety dan Shared Mutable Buffer

`ByteBuffer` bukan abstraction thread-safe untuk concurrent mutation.

Ada dua jenis shared state:

1. Content memory.
2. Cursor state: position/limit/mark.

Walau dua thread hanya membaca content, kalau memakai operasi relatif, mereka sama-sama mengubah `position`.

Anti-pattern:

```java
ByteBuffer shared = ...;

// Thread A
byte a = shared.get();

// Thread B
byte b = shared.get();
```

Race bukan hanya pada content, tetapi pada cursor.

Pattern lebih aman untuk read-only parallel read:

```java
ByteBuffer base = data.asReadOnlyBuffer();
ByteBuffer aView = base.duplicate();
ByteBuffer bView = base.duplicate();
```

Tetapi content tetap shared. Jika ada writer, perlu synchronization atau immutable snapshot.

---

## 20. Direct Buffer Lifecycle dan GC Interaction

Direct buffer punya dua bagian:

```text
Heap object wrapper: DirectByteBuffer object
Native memory region: actual byte storage
```

GC melihat wrapper object. Native memory dilepas ketika wrapper tidak reachable dan cleanup berjalan.

Konsekuensi:

```text
Direct buffer memory pressure can exist even when Java heap looks normal.
```

Misalnya:

```java
List<ByteBuffer> buffers = new ArrayList<>();
for (int i = 0; i < 10_000; i++) {
    buffers.add(ByteBuffer.allocateDirect(1024 * 1024));
}
```

Heap mungkin hanya berisi banyak wrapper object kecil, tetapi native memory bisa mencapai gigabyte.

### 20.1 Jangan Allocate Direct Buffer per Request

Bad:

```java
ByteBuffer b = ByteBuffer.allocateDirect(requestSize);
encode(request, b);
write(b);
```

Jika request rate tinggi, allocation native memory dan delayed cleanup bisa merusak latency/RSS.

Lebih baik:

- gunakan heap buffer untuk short-lived small payload,
- gunakan pooled direct buffer untuk I/O hot path,
- batasi total pool memory,
- instrument direct memory/RSS.

### 20.2 Direct Buffer Pool Harus Punya Ownership Discipline

Pool buffer bug umum:

1. Buffer dikembalikan ke pool saat masih dipakai async write.
2. Buffer dipakai ulang sebelum write selesai.
3. Buffer dikembalikan dua kali.
4. Buffer tidak dikembalikan pada exception path.
5. Caller menyimpan slice dari pooled buffer setelah parent dikembalikan.

Minimal contract:

```text
borrow -> exclusive mutable ownership
flip -> publish to writer
release -> only after all consumers done
never retain slice after release
```

---

## 21. Buffer Pooling: Kapan Berguna, Kapan Berbahaya

Pooling bukan magic performance.

### 21.1 Pooling Berguna Jika

- buffer besar,
- allocation rate tinggi,
- direct buffer,
- lifecycle jelas,
- high-throughput I/O,
- thread/event-loop ownership jelas,
- ada backpressure.

### 21.2 Pooling Berbahaya Jika

- buffer kecil,
- heap allocation murah,
- ownership tidak jelas,
- async boundary rumit,
- banyak exception path,
- data sensitif tidak dihapus,
- pool unbounded,
- retention bug lebih mahal dari allocation.

### 21.3 Pool Harus Bounded

Unbounded pool = memory leak yang diberi nama bagus.

Bad:

```java
Queue<ByteBuffer> pool = new ConcurrentLinkedQueue<>();
```

Tanpa limit, pool bisa tumbuh mengikuti traffic spike dan tidak pernah turun.

Lebih baik:

```text
max buffers
max total bytes
metrics: borrowed, available, allocated, rejected
leak detection / timeout
clear owner state on release
```

---

## 22. Security Note: `clear()` Tidak Menghapus Sensitive Bytes

Jika buffer berisi secret:

- password,
- token,
- private key,
- session secret,
- decrypted payload,
- PII sensitif,

jangan menganggap `clear()` aman.

```java
buffer.clear(); // hanya reset cursor
```

Untuk wiping, tulis nol ke region relevan:

```java
static void zero(ByteBuffer buffer) {
    ByteBuffer b = buffer.duplicate();
    b.clear();
    while (b.hasRemaining()) {
        b.put((byte) 0);
    }
}
```

Untuk hanya region active:

```java
static void zeroRemaining(ByteBuffer buffer) {
    ByteBuffer b = buffer.duplicate();
    while (b.hasRemaining()) {
        b.put((byte) 0);
    }
}
```

Namun bahkan wiping punya caveat:

- data mungkin sudah tersalin ke buffer lain,
- JIT/optimizer concerns untuk beberapa pola memory clearing,
- OS/page cache/native copies bisa ada,
- immutable `String` untuk secret tetap buruk.

Tetap, poin utama di bagian ini:

```text
clear != wipe
```

---

## 23. Error dan Exception yang Harus Dipahami

### 23.1 `BufferOverflowException`

Terjadi saat relative put butuh ruang lebih dari `remaining()`.

```java
ByteBuffer b = ByteBuffer.allocate(4);
b.putLong(1L); // BufferOverflowException
```

Pencegahan:

```java
if (b.remaining() < Long.BYTES) {
    growOrFail();
}
```

### 23.2 `BufferUnderflowException`

Terjadi saat relative get butuh data lebih dari `remaining()`.

```java
ByteBuffer b = ByteBuffer.allocate(4);
b.flip();
b.getInt(); // underflow karena limit=0
```

Pencegahan:

```java
if (b.remaining() < Integer.BYTES) {
    return NEED_MORE;
}
```

### 23.3 `ReadOnlyBufferException`

Terjadi saat menulis ke read-only buffer.

```java
ByteBuffer ro = ByteBuffer.allocate(4).asReadOnlyBuffer();
ro.put((byte) 1);
```

### 23.4 `InvalidMarkException`

Terjadi saat `reset()` dipanggil tapi mark tidak valid/undefined.

```java
ByteBuffer b = ByteBuffer.allocate(4);
b.reset(); // InvalidMarkException
```

Mark bisa invalid jika position/limit diubah ke bawah mark.

---

## 24. Practical Patterns

### 24.1 Safe Copy of Remaining Bytes

```java
static byte[] toByteArray(ByteBuffer source) {
    ByteBuffer b = source.duplicate();
    byte[] out = new byte[b.remaining()];
    b.get(out);
    return out;
}
```

Tidak mengubah position source.

### 24.2 Safe Hex Dump Without Mutating Caller

```java
static String hex(ByteBuffer source) {
    ByteBuffer b = source.duplicate();
    StringBuilder sb = new StringBuilder(b.remaining() * 3);
    while (b.hasRemaining()) {
        sb.append(String.format("%02x", b.get() & 0xFF));
        if (b.hasRemaining()) sb.append(' ');
    }
    return sb.toString();
}
```

Catatan performance: `String.format` mahal; untuk production hot path gunakan lookup table. Tetapi untuk debug utility, ini jelas.

### 24.3 Length-prefixed Decoder dengan Incomplete Handling

```java
enum Status { NEED_MORE, DECODED }

record DecodeResult(Status status, ByteBuffer payload) {}

static DecodeResult tryDecode(ByteBuffer buffer) {
    if (buffer.remaining() < Integer.BYTES) {
        return new DecodeResult(Status.NEED_MORE, null);
    }

    int start = buffer.position();
    int length = buffer.getInt(start);

    if (length < 0) {
        throw new IllegalArgumentException("negative length: " + length);
    }

    if (buffer.remaining() < Integer.BYTES + length) {
        return new DecodeResult(Status.NEED_MORE, null);
    }

    buffer.position(start + Integer.BYTES);
    ByteBuffer payload = buffer.slice(buffer.position(), length).asReadOnlyBuffer();
    buffer.position(buffer.position() + length);

    return new DecodeResult(Status.DECODED, payload);
}
```

Karakteristik:

- peeking length tidak mengubah position,
- incomplete data tidak corrupt cursor,
- payload dibatasi dengan slice,
- payload read-only terhadap callee,
- parent buffer tetap harus hidup selama payload dipakai.

Jika payload harus async/long-lived, copy.

### 24.4 Encode dengan Placeholder Length

```java
static ByteBuffer encodeMessage(byte type, byte[] body) {
    int size = Integer.BYTES + 1 + body.length;
    ByteBuffer out = ByteBuffer.allocate(size);

    int lengthPos = out.position();
    out.putInt(0); // placeholder

    int bodyStart = out.position();
    out.put(type);
    out.put(body);
    int bodyEnd = out.position();

    out.putInt(lengthPos, bodyEnd - bodyStart);
    out.flip();
    return out;
}
```

### 24.5 Guarded Put

```java
static void putUtf8(ByteBuffer out, String s) {
    byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
    if (bytes.length > 65_535) {
        throw new IllegalArgumentException("string too long");
    }
    if (out.remaining() < Short.BYTES + bytes.length) {
        throw new BufferOverflowException();
    }
    out.putShort((short) bytes.length);
    out.put(bytes);
}
```

Dalam hot path, hindari intermediate `byte[]` dengan encoder streaming, tetapi pattern boundary check tetap sama.

---

## 25. Common Production Bugs

### 25.1 Lupa `flip()`

```java
ByteBuffer b = ByteBuffer.allocate(4);
b.putInt(123);
channel.write(b); // kemungkinan menulis 0 byte karena position=4 limit=4
```

Fix:

```java
b.flip();
channel.write(b);
```

### 25.2 Pakai `clear()` Saat Ada Partial Message

```java
buffer.flip();
tryParse(buffer);
buffer.clear(); // incomplete bytes hilang
```

Fix:

```java
buffer.compact();
```

### 25.3 Menyimpan Slice dari Buffer Besar

```java
ByteBuffer small = big.slice(offset, 20);
cache.put(id, small); // big buffer ikut tertahan
```

Fix jika long-lived:

```java
byte[] copy = new byte[20];
big.duplicate().position(offset).limit(offset + 20).slice().get(copy);
cache.put(id, ByteBuffer.wrap(copy).asReadOnlyBuffer());
```

### 25.4 Method Utility Mengubah Position Caller

```java
static boolean startsWithMagic(ByteBuffer b) {
    return b.get() == 'M' && b.get() == 'G';
}
```

Fix:

```java
static boolean startsWithMagic(ByteBuffer input) {
    ByteBuffer b = input.duplicate();
    return b.remaining() >= 2 && b.get() == 'M' && b.get() == 'G';
}
```

### 25.5 Endianness Default Salah

```java
int len = ByteBuffer.wrap(header).getInt(); // default big-endian
```

Fix:

```java
int len = ByteBuffer.wrap(header)
                    .order(ByteOrder.LITTLE_ENDIAN)
                    .getInt();
```

### 25.6 Direct Buffer per Message

```java
ByteBuffer b = ByteBuffer.allocateDirect(payload.length);
```

Di traffic tinggi ini bisa menyebabkan native memory pressure.

Fix:

- gunakan heap buffer,
- reuse direct buffer,
- pool bounded,
- pakai framework buffer allocator yang mature jika sesuai.

### 25.7 `array()` pada Direct/Read-only Buffer

```java
byte[] arr = buffer.array();
```

Bisa gagal jika buffer direct atau read-only.

Safer:

```java
byte[] arr = new byte[buffer.remaining()];
buffer.duplicate().get(arr);
```

---

## 26. `ByteBuffer` dan Memory Footprint

`ByteBuffer` object sendiri tetap object heap. Untuk heap buffer, content juga heap. Untuk direct buffer, content native.

### 26.1 Heap Buffer Footprint

```java
ByteBuffer b = ByteBuffer.allocate(1024);
```

Secara konseptual:

```text
Heap:
  HeapByteBuffer object
  byte[1024] backing array
```

### 26.2 Direct Buffer Footprint

```java
ByteBuffer b = ByteBuffer.allocateDirect(1024);
```

Secara konseptual:

```text
Heap:
  DirectByteBuffer wrapper object

Native memory:
  1024-byte memory region
```

Heap dump bisa menunjukkan wrapper, tetapi tidak selalu membuat native content terlihat sebagai dominator besar.

Untuk direct buffer/native memory investigation, gunakan tool seperti:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
```

Dengan JVM dijalankan memakai Native Memory Tracking jika diperlukan:

```bash
-XX:NativeMemoryTracking=summary
# atau
-XX:NativeMemoryTracking=detail
```

NMT overhead perlu dipertimbangkan di production.

---

## 27. ByteBuffer vs `byte[]` vs `MemorySegment`

Kita akan membahas `MemorySegment` lebih dalam di part 014, tetapi peta awalnya penting.

| Abstraksi | Cocok untuk | Kelemahan |
|---|---|---|
| `byte[]` | payload kecil, simple API, heap data | tidak punya cursor/bounds active, copy untuk native I/O bisa terjadi |
| Heap `ByteBuffer` | parser/writer dengan cursor, API NIO, heap lifecycle | GC pressure content tetap ada |
| Direct `ByteBuffer` | I/O native intensif, reusable buffer | native memory lifecycle sulit |
| `MappedByteBuffer` | memory-mapped file | unmap/lifecycle/page cache complexity |
| `MemorySegment` | modern foreign/off-heap memory dengan lifetime safety | API lebih eksplisit, butuh model Arena/Layout |

`ByteBuffer` tetap penting dari Java 8 sampai 25 karena:

- API NIO sudah lama berbasis Buffer,
- banyak framework networking/storage memakai konsep serupa,
- direct/mapped buffer menjadi jembatan ke native/OS memory,
- FFM pun menyediakan interop dengan ByteBuffer dalam beberapa skenario.

---

## 28. Review Mental Model

Pegang lima kalimat ini:

```text
1. ByteBuffer is memory plus cursor state.
2. position and limit define the active window, not the whole storage.
3. flip changes write-mode data into read-mode data.
4. clear does not erase bytes; it resets state for writing.
5. slice/duplicate/read-only views share content, but have independent cursor state.
```

Untuk top-level engineering, tambahkan:

```text
6. Direct buffer moves content pressure from heap to native memory, not to nowhere.
7. Shared buffer means shared ownership risk.
8. Async boundary usually requires copy or explicit ownership transfer.
9. Byte order must be part of protocol/file contract.
10. Buffer API correctness is mostly state-machine correctness.
```

---

## 29. Checklist Desain `ByteBuffer` untuk Production

Sebelum memakai `ByteBuffer` dalam API, jawab pertanyaan ini:

### Storage

- Apakah butuh heap atau direct?
- Apakah buffer akan sering dialokasikan?
- Apakah buffer akan dipakai untuk I/O native intensif?
- Apakah direct memory sudah dimonitor?

### Lifetime

- Siapa owner buffer?
- Siapa yang boleh release/reuse?
- Apakah buffer melintasi async boundary?
- Apakah slice disimpan long-lived?

### Cursor

- Apakah method boleh mengubah position?
- Apakah method boleh mengubah limit?
- Apakah method transactional saat parse incomplete?
- Apakah utility read-only memakai duplicate?

### Boundary

- Apakah semua `getInt/getLong/getShort` dicek `remaining()`?
- Apakah length field divalidasi negatif/terlalu besar?
- Apakah ada max frame size?
- Apakah endian eksplisit?

### Security

- Apakah buffer menyimpan secret?
- Apakah `clear()` disalahanggap sebagai wipe?
- Apakah data stale bisa ikut terkirim?

### Observability

- Apakah direct memory/RSS dipantau?
- Apakah allocation rate buffer diketahui?
- Apakah pool bounded dan punya metric?

---

## 30. Latihan Mandiri

### Latihan 1 — State Trace

Trace state berikut:

```java
ByteBuffer b = ByteBuffer.allocate(8);
b.put((byte) 1);
b.put((byte) 2);
b.putInt(100);
b.flip();
b.get();
b.compact();
b.put((byte) 9);
b.flip();
```

Tuliskan `position`, `limit`, `capacity`, dan content relevan setelah tiap operasi.

### Latihan 2 — Fix Decoder Bug

Buggy decoder:

```java
static ByteBuffer decode(ByteBuffer b) {
    int len = b.getInt();
    if (b.remaining() < len) {
        return null;
    }
    ByteBuffer payload = b.slice();
    payload.limit(len);
    b.position(b.position() + len);
    return payload;
}
```

Masalah yang harus ditemukan:

- position rusak saat incomplete,
- negative length tidak dicek,
- max length tidak dicek,
- slice limit manipulation rawan,
- payload shared dengan parent,
- lifecycle tidak jelas.

### Latihan 3 — API Contract

Tulis contract Javadoc untuk method:

```java
ParseResult parse(ByteBuffer input);
```

Contract harus menjelaskan:

- apakah position berubah,
- apa yang terjadi saat incomplete,
- apakah content dimutasi,
- apakah buffer disimpan setelah return,
- apakah endian tertentu digunakan.

### Latihan 4 — Direct Buffer Policy

Desain policy untuk service high-throughput yang memakai direct buffer:

- max total direct memory,
- pool size,
- buffer size class,
- ownership rule,
- release rule,
- metric,
- leak detection,
- fallback behavior saat pool exhausted.

---

## 31. Ringkasan

`ByteBuffer` adalah salah satu API Java yang tampak kecil, tetapi sangat dalam. Banyak engineer memakai `ByteBuffer` hanya dengan hafalan `put -> flip -> get -> clear`, tetapi pemahaman top-level membutuhkan model yang lebih kuat:

```text
ByteBuffer = memory region + cursor + active boundary + sharing semantics
```

Kesalahan `ByteBuffer` jarang karena Java tidak mampu mengelola memory. Kesalahan biasanya karena ownership, cursor, dan boundary tidak didesain eksplisit.

Heap buffer memberi lifecycle sederhana tetapi menambah heap pressure. Direct buffer mengurangi sebagian copy path dan cocok untuk I/O tertentu, tetapi memindahkan risiko ke native memory, RSS, cleanup delay, dan observability.

`slice()`, `duplicate()`, dan typed view buffer adalah alat kuat untuk zero-copy design, tetapi semuanya berbagi content. Maka zero-copy selalu datang bersama pertanyaan ownership:

```text
Siapa yang boleh mutate?
Siapa yang boleh reuse?
Berapa lama view hidup?
Apa yang terjadi saat parent buffer berubah?
```

Jika pertanyaan itu tidak dijawab, zero-copy sering berubah menjadi zero-correctness.

---

## 32. Status Seri

```text
Part 011 selesai.
Seri belum selesai.
Masih lanjut ke part 012 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-012.md
```

Topik berikutnya:

```text
Direct Buffer and Native Memory: What Actually Happens
```

Di part berikutnya kita akan masuk lebih dalam ke direct buffer sebagai native memory: `MaxDirectMemorySize`, Cleaner-backed deallocation, RSS vs heap, native allocation cost, pooling, fragmentation, copy path, dan kenapa `OutOfMemoryError: Direct buffer memory` bisa muncul ketika heap terlihat sehat.
