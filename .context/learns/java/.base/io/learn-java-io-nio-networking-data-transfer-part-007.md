# Part 007 — NIO Core: Buffer, Channel, Selector, dan Perubahan Mental Model dari Stream

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-007.md`  
> Target: Java software engineer yang ingin memahami Java I/O pada level arsitektur, OS boundary, failure model, dan production decision-making.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bukan hanya tahu bahwa Java punya `ByteBuffer`, `Channel`, dan `Selector`, tetapi memahami **mengapa NIO mengubah cara berpikir I/O**.

Di part sebelumnya kita sudah membahas `java.io` dengan model:

```text
Source/Sink -> Stream -> read/write -> byte[]/char[] -> blocking call
```

Di NIO, model berpikirnya berubah menjadi:

```text
Source/Sink -> Channel -> Buffer -> state transition -> optional multiplexing
```

Target pemahaman part ini:

1. Memahami perbedaan fundamental antara **stream-oriented I/O** dan **buffer/channel-oriented I/O**.
2. Memahami `Buffer` sebagai **state machine**, bukan hanya array pembungkus.
3. Memahami `Channel` sebagai koneksi ke entity I/O: file, socket, pipe, datagram, dan lain-lain.
4. Memahami `Selector` sebagai mekanisme **multiplexed non-blocking I/O**.
5. Memahami kapan NIO tepat, kapan tidak, dan kapan justru membuat desain lebih kompleks.
6. Mampu membaca dan menulis loop NIO dengan benar tanpa bug klasik seperti lupa `flip()`, salah `clear()`, kehilangan data karena `compact()` tidak dipahami, atau infinite loop saat `read()` mengembalikan `0`.

---

## 2. Referensi Resmi yang Menjadi Fondasi

Dokumentasi resmi Java menyatakan bahwa package `java.nio` mendefinisikan buffer sebagai container data, dan menjelaskan abstraksi inti NIO: **buffers**, **charsets**, **channels**, dan **selectors**. `java.nio.channels` mendefinisikan channel sebagai koneksi ke entity yang mampu melakukan operasi I/O, serta selector untuk multiplexed non-blocking I/O.

Sumber utama:

- Oracle Java SE 25 `java.nio` package summary.
- Oracle Java SE 25 `java.nio.channels` package summary.
- Oracle Java SE 25 `Selector` documentation.
- Oracle Java SE 21/25 `ByteBuffer` documentation.
- Oracle Java NIO guide untuk Java 21.

Catatan penting: materi ini tidak mengulang semua class satu per satu secara katalog. Kita fokus pada **mental model**, **invariant**, **failure mode**, dan **decision framework**.

---

## 3. Mengapa NIO Ada?

Sebelum NIO, `java.io` sudah cukup untuk banyak kasus:

```java
try (InputStream in = new FileInputStream("input.bin")) {
    byte[] buffer = new byte[8192];
    int n;
    while ((n = in.read(buffer)) != -1) {
        process(buffer, 0, n);
    }
}
```

Model ini sederhana dan sangat berguna. Tapi ada beberapa keterbatasan konseptual:

1. Stream biasanya berpikir **linear**.
2. Stream menyembunyikan state internal buffering.
3. Stream API klasik tidak secara eksplisit memodelkan buffer sebagai objek stateful.
4. Untuk networking skala besar, thread-per-connection tradisional dapat menjadi mahal jika memakai platform thread dalam jumlah sangat besar.
5. Sulit melakukan multiplexing banyak koneksi dalam sedikit thread.
6. Sulit melakukan operasi seperti random access file, memory mapping, zero-copy transfer, atau readiness-based I/O memakai model stream murni.

NIO memperkenalkan model yang lebih dekat ke OS:

```text
Application memory buffer <-> OS/kernel <-> file/socket/device
```

Di NIO, data tidak “mengalir begitu saja” ke aplikasi. Data biasanya:

1. dibaca dari channel ke buffer,
2. buffer diubah mode dari write mode ke read mode,
3. aplikasi membaca buffer,
4. buffer dibersihkan/di-compact,
5. proses diulang.

Ini membuat I/O lebih eksplisit, lebih powerful, tetapi juga lebih mudah salah jika state-nya tidak dipahami.

---

## 4. Stream vs Channel: Perubahan Mental Model

### 4.1 Model `java.io` Stream

Stream adalah abstraction yang mewakili aliran data satu arah:

```text
InputStream:  source -> application
OutputStream: application -> sink
```

Contoh:

```java
InputStream in = socket.getInputStream();
OutputStream out = socket.getOutputStream();
```

Karakteristik:

| Aspek | Stream |
|---|---|
| Orientasi | Aliran byte/char |
| Arah | Biasanya satu arah |
| Data container | `byte[]`, `char[]` |
| State buffer | Sering tersembunyi dalam wrapper |
| Blocking | Umumnya blocking |
| Multiplexing | Tidak natural |
| Cocok untuk | Sederhana, sequential, banyak API legacy |

Stream cocok ketika operasi kamu sederhana:

```text
read sequentially -> process -> write sequentially
```

Misalnya:

- baca file konfigurasi kecil,
- copy file sederhana,
- proses CSV line-by-line,
- upload/download blocking sederhana,
- interaksi library yang memakai `InputStream`/`OutputStream`.

### 4.2 Model NIO Channel

Channel adalah koneksi ke entity I/O. Channel dapat membaca/menulis melalui buffer.

```text
Channel <-> Buffer <-> Application logic
```

Contoh:

```java
try (FileChannel channel = FileChannel.open(Path.of("input.bin"), StandardOpenOption.READ)) {
    ByteBuffer buffer = ByteBuffer.allocate(8192);
    int n = channel.read(buffer);
}
```

Karakteristik:

| Aspek | Channel |
|---|---|
| Orientasi | Buffer-oriented |
| Arah | Bisa readable, writable, atau dua arah |
| Data container | `Buffer`, terutama `ByteBuffer` |
| State buffer | Eksplisit: position, limit, capacity |
| Blocking | Bisa blocking atau non-blocking tergantung channel |
| Multiplexing | Natural untuk selectable channel |
| Cocok untuk | File channel, socket non-blocking, zero-copy, mmap, event loop |

### 4.3 Perbedaan Paling Penting

Pada stream:

```text
read(byte[]) -> array langsung berisi data -> process
```

Pada channel:

```text
channel.read(buffer) -> buffer position berubah -> flip -> process -> clear/compact
```

Jadi, pada NIO kamu harus memikirkan state buffer secara eksplisit.

---

## 5. Buffer sebagai State Machine

Kesalahan terbesar saat belajar NIO adalah menganggap `ByteBuffer` sekadar `byte[]` modern.

`ByteBuffer` adalah **stateful cursor over memory**.

Sebuah buffer memiliki minimal tiga properti penting:

```text
capacity: ukuran maksimum buffer
position: indeks operasi berikutnya
limit: batas operasi saat ini
```

Secara invariant:

```text
0 <= mark <= position <= limit <= capacity
```

`mark` opsional. Untuk awal, fokus pada `position`, `limit`, dan `capacity`.

---

## 6. Buffer State: Capacity, Position, Limit

Misalnya:

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
```

Awal state:

```text
capacity = 8
position = 0
limit    = 8
```

Visual:

```text
index:    0 1 2 3 4 5 6 7
content:  . . . . . . . .
          ^               ^
          position        limit/capacity
```

### 6.1 Write Mode

Ketika buffer baru dibuat, ia siap untuk ditulis.

```java
buffer.put((byte) 'A');
buffer.put((byte) 'B');
buffer.put((byte) 'C');
```

State:

```text
capacity = 8
position = 3
limit    = 8
```

Visual:

```text
index:    0 1 2 3 4 5 6 7
content:  A B C . . . . .
                ^         ^
                position  limit
```

Artinya:

- data valid ada di indeks `0..2`,
- posisi berikutnya untuk `put` adalah `3`,
- masih bisa menulis sampai sebelum `limit`.

### 6.2 Flip ke Read Mode

Untuk membaca data yang sudah ditulis ke buffer, harus memanggil:

```java
buffer.flip();
```

Setelah `flip()`:

```text
limit    = old position = 3
position = 0
capacity = 8
```

Visual:

```text
index:    0 1 2 3 4 5 6 7
content:  A B C . . . . .
          ^     ^         ^
          pos   limit     capacity
```

Artinya:

- baca dari position `0`,
- berhenti di limit `3`,
- data valid hanya `0..2`.

Inilah alasan `flip()` sering dianggap “magic”. Sebenarnya ia hanya mengubah buffer dari mode menulis ke mode membaca.

---

## 7. Operasi Dasar Buffer

### 7.1 `put()`

Menulis ke buffer pada current position lalu menaikkan position.

```java
ByteBuffer buffer = ByteBuffer.allocate(4);
buffer.put((byte) 10);
buffer.put((byte) 20);
```

State:

```text
position = 2
limit    = 4
capacity = 4
```

Jika `position == limit`, `put()` akan gagal dengan `BufferOverflowException`.

### 7.2 `get()`

Membaca dari current position lalu menaikkan position.

```java
buffer.flip();
byte a = buffer.get();
byte b = buffer.get();
```

Jika `position == limit`, `get()` akan gagal dengan `BufferUnderflowException`.

### 7.3 Relative vs Absolute Access

Relative access memakai dan mengubah `position`:

```java
byte value = buffer.get();
buffer.put((byte) 42);
```

Absolute access memakai index eksplisit dan tidak mengubah `position`:

```java
byte first = buffer.get(0);
buffer.put(1, (byte) 99);
```

Kapan absolute access berguna?

- membaca header pada offset tertentu,
- patch length field setelah body selesai ditulis,
- parsing binary protocol,
- random access di buffer.

Contoh pattern patch length:

```java
ByteBuffer frame = ByteBuffer.allocate(1024);

int lengthPosition = frame.position();
frame.putInt(0); // placeholder length

int bodyStart = frame.position();
frame.put("hello".getBytes(StandardCharsets.UTF_8));
int bodyEnd = frame.position();

int bodyLength = bodyEnd - bodyStart;
frame.putInt(lengthPosition, bodyLength); // absolute put, tidak mengubah current position

frame.flip();
```

---

## 8. `flip()`, `clear()`, `compact()`, `rewind()`: Empat Operasi yang Wajib Dipahami

### 8.1 `flip()`

Gunakan setelah menulis data ke buffer, sebelum membaca data dari buffer.

```text
write mode -> read mode
```

```java
buffer.flip();
```

Efek:

```text
limit = position
position = 0
mark = discarded
```

Contoh:

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
channel.read(buffer);  // writes into buffer
buffer.flip();         // prepare to read from buffer
while (buffer.hasRemaining()) {
    process(buffer.get());
}
```

### 8.2 `clear()`

Gunakan setelah data di buffer sudah tidak dibutuhkan dan kamu ingin menulis dari awal lagi.

```java
buffer.clear();
```

Efek:

```text
position = 0
limit = capacity
mark = discarded
```

Penting: `clear()` **tidak menghapus isi memory**. Ia hanya mengubah cursor state.

Contoh:

```text
Before clear:
content:  A B C . . . . .
position = 3
limit    = 3

After clear:
content:  A B C . . . . .  // bytes lama masih ada secara fisik
position = 0
limit    = 8
```

Jangan pakai `clear()` jika masih ada data yang belum diproses.

### 8.3 `compact()`

Gunakan ketika sebagian data sudah dibaca, tetapi masih ada sisa data yang belum diproses, dan kamu ingin membaca data baru dari channel tanpa kehilangan sisa tersebut.

```java
buffer.compact();
```

Efek konseptual:

```text
unread data dipindahkan ke awal buffer
position = jumlah unread data
limit = capacity
```

Contoh kasus:

- parsing protocol TCP,
- satu read menghasilkan 1.5 frame,
- frame pertama selesai diproses,
- setengah frame berikutnya harus disimpan sampai read berikutnya.

Visual:

```text
Buffer read mode:
index:    0 1 2 3 4 5 6 7
content:  A B C D E F . .
              ^     ^
              pos   limit

Data unread = C D E F

After compact:
index:    0 1 2 3 4 5 6 7
content:  C D E F ? ? ? ?
                  ^       ^
                  pos     limit/capacity
```

Setelah `compact()`, buffer kembali ke write mode dan data unread aman di awal.

### 8.4 `rewind()`

Gunakan jika ingin membaca ulang data dari awal read window yang sama.

```java
buffer.rewind();
```

Efek:

```text
position = 0
limit tetap
```

Contoh:

```java
buffer.flip();
parseHeader(buffer);
buffer.rewind();
logRawFrame(buffer);
```

Hati-hati: `rewind()` bukan pengganti `flip()`.

---

## 9. Buffer Lifecycle Pattern

### 9.1 Simple Read Pattern

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);

while (channel.read(buffer) != -1) {
    buffer.flip();

    while (buffer.hasRemaining()) {
        byte b = buffer.get();
        process(b);
    }

    buffer.clear();
}
```

Pattern ini aman jika:

- semua data yang masuk buffer selalu diproses habis sebelum read berikutnya,
- tidak ada partial frame yang harus disimpan.

### 9.2 Parsing dengan Partial Data

Jika data adalah frame, record, atau message, tidak selalu bisa diproses habis.

Misalnya format:

```text
[length:int][payload bytes]
```

Satu read bisa menghasilkan:

```text
read #1: [length][half payload]
read #2: [remaining payload][next frame]
```

Pattern-nya:

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);

while (channel.read(buffer) != -1) {
    buffer.flip();

    while (true) {
        if (!tryParseOneFrame(buffer)) {
            break;
        }
    }

    buffer.compact();
}
```

Kenapa `compact()` bukan `clear()`?

Karena saat parser berhenti, mungkin masih ada data partial frame yang belum lengkap. Kalau `clear()`, data itu akan dianggap tidak penting dan akan tertimpa.

---

## 10. Channel: Koneksi ke Entity I/O

Channel adalah abstraction untuk membaca/menulis data ke entity yang mampu melakukan I/O.

Jenis channel penting:

| Channel | Fungsi |
|---|---|
| `FileChannel` | I/O file, random access, transfer, lock, mmap |
| `SocketChannel` | TCP client socket |
| `ServerSocketChannel` | TCP server accept channel |
| `DatagramChannel` | UDP datagram |
| `Pipe.SourceChannel` | Membaca dari pipe |
| `Pipe.SinkChannel` | Menulis ke pipe |
| `AsynchronousFileChannel` | File I/O asynchronous |
| `AsynchronousSocketChannel` | Socket async completion-style |

Interface penting:

| Interface | Makna |
|---|---|
| `ReadableByteChannel` | Bisa membaca byte ke buffer |
| `WritableByteChannel` | Bisa menulis byte dari buffer |
| `ByteChannel` | Readable + writable |
| `SeekableByteChannel` | Channel dengan posisi dan random access |
| `ScatteringByteChannel` | Read ke banyak buffer |
| `GatheringByteChannel` | Write dari banyak buffer |
| `SelectableChannel` | Bisa dipakai dengan `Selector` |
| `InterruptibleChannel` | Bisa ditutup saat thread interrupt/blocking operation |

---

## 11. Read dan Write pada Channel

### 11.1 Read dari Channel ke Buffer

```java
int bytesRead = channel.read(buffer);
```

Makna:

```text
channel -> buffer
```

Return value:

| Return | Makna |
|---|---|
| `> 0` | sejumlah byte berhasil dibaca |
| `0` | tidak ada byte saat ini; umum pada non-blocking channel |
| `-1` | end-of-stream; peer menutup output atau file EOF |

Kesalahan umum:

```java
while (channel.read(buffer) > 0) {
    // salah jika tidak handle 0 dan -1 dengan benar pada non-blocking mode
}
```

Pada file blocking, `0` jarang kecuali buffer tidak punya remaining. Pada socket non-blocking, `0` normal.

### 11.2 Write dari Buffer ke Channel

```java
int bytesWritten = channel.write(buffer);
```

Makna:

```text
buffer -> channel
```

Write juga bisa partial.

Salah:

```java
channel.write(buffer); // menganggap semua bytes pasti tertulis
```

Benar untuk blocking channel jika memang ingin memastikan semua remaining bytes terkirim:

```java
while (buffer.hasRemaining()) {
    channel.write(buffer);
}
```

Namun pada non-blocking socket, loop seperti ini bisa menjadi busy spin jika `write()` mengembalikan `0`. Pada non-blocking event loop, jika write tidak selesai, sisa buffer harus disimpan ke write queue dan interest `OP_WRITE` harus diaktifkan.

---

## 12. Blocking vs Non-Blocking

### 12.1 Blocking I/O

Pada blocking mode, call akan menunggu sampai operasi bisa lanjut.

Contoh:

```java
int n = socketChannel.read(buffer);
```

Jika tidak ada data, thread bisa terblokir.

Kelebihan:

- sederhana,
- mudah dipahami,
- debugging lebih mudah,
- cocok untuk virtual threads,
- cocok untuk banyak workload enterprise.

Kekurangan:

- platform thread bisa mahal jika connection sangat banyak,
- satu thread blocked tidak bisa melakukan pekerjaan lain,
- perlu timeout/cancellation yang baik.

### 12.2 Non-Blocking I/O

Pada non-blocking mode, operasi segera kembali.

```java
socketChannel.configureBlocking(false);
int n = socketChannel.read(buffer);
```

Jika tidak ada data, `read()` bisa return `0`.

Kelebihan:

- satu thread bisa mengelola banyak connection,
- cocok untuk event loop,
- cocok untuk server network high concurrency,
- menjadi fondasi banyak framework seperti Netty.

Kekurangan:

- kompleksitas state machine meningkat,
- harus handle partial read/write,
- harus simpan state per connection,
- error handling lebih rumit,
- mudah membuat busy loop,
- mudah membuat memory leak pada write queue.

---

## 13. Selector: Multiplexed Non-Blocking I/O

`Selector` memungkinkan satu thread memonitor banyak channel untuk readiness event.

Mental model:

```text
Banyak channel -> daftar interest -> selector menunggu readiness -> event loop memproses event
```

Contoh readiness:

| Operation | Arti |
|---|---|
| `OP_ACCEPT` | Server socket siap menerima koneksi baru |
| `OP_CONNECT` | Koneksi non-blocking selesai/siap diselesaikan |
| `OP_READ` | Channel kemungkinan bisa dibaca tanpa blocking |
| `OP_WRITE` | Channel kemungkinan bisa ditulis tanpa blocking |

Penting: readiness bukan guarantee absolut bahwa read/write pasti sukses penuh. Ia hanya sinyal bahwa operasi kemungkinan dapat dilakukan tanpa blocking saat itu.

---

## 14. Selector Key Sets

Sebuah selector memiliki beberapa set key. Secara konseptual:

| Set | Makna |
|---|---|
| Key set | Semua channel yang registered |
| Selected-key set | Key yang siap diproses setelah selection |
| Cancelled-key set | Key yang dibatalkan dan akan dibersihkan |

Setiap registrasi channel ke selector menghasilkan `SelectionKey`.

`SelectionKey` menyimpan:

1. channel,
2. selector,
3. interest ops,
4. ready ops,
5. attachment opsional.

Attachment sangat penting untuk menyimpan state per connection.

Contoh:

```java
SelectionKey key = socketChannel.register(selector, SelectionKey.OP_READ);
key.attach(new ConnectionState(socketChannel));
```

---

## 15. Event Loop Dasar dengan Selector

Contoh skeleton:

```java
try (Selector selector = Selector.open();
     ServerSocketChannel server = ServerSocketChannel.open()) {

    server.bind(new InetSocketAddress(8080));
    server.configureBlocking(false);
    server.register(selector, SelectionKey.OP_ACCEPT);

    while (true) {
        selector.select();

        Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();
        while (iterator.hasNext()) {
            SelectionKey key = iterator.next();
            iterator.remove();

            if (!key.isValid()) {
                continue;
            }

            if (key.isAcceptable()) {
                handleAccept(selector, key);
            } else if (key.isReadable()) {
                handleRead(key);
            } else if (key.isWritable()) {
                handleWrite(key);
            }
        }
    }
}
```

Kenapa `iterator.remove()` wajib?

Karena selected-key set tidak otomatis dikosongkan setelah diproses. Jika tidak dihapus, event lama bisa diproses berulang.

---

## 16. Accept Connection

```java
private static void handleAccept(Selector selector, SelectionKey key) throws IOException {
    ServerSocketChannel server = (ServerSocketChannel) key.channel();
    SocketChannel client = server.accept();

    if (client == null) {
        return;
    }

    client.configureBlocking(false);

    ConnectionState state = new ConnectionState(client);
    SelectionKey clientKey = client.register(selector, SelectionKey.OP_READ);
    clientKey.attach(state);
}
```

Catatan:

- Pada non-blocking server, `accept()` bisa return `null`.
- Setiap client harus non-blocking jika didaftarkan ke selector.
- State per connection harus eksplisit.

---

## 17. Read dengan Non-Blocking SocketChannel

```java
private static void handleRead(SelectionKey key) throws IOException {
    SocketChannel channel = (SocketChannel) key.channel();
    ConnectionState state = (ConnectionState) key.attachment();

    ByteBuffer input = state.inputBuffer();
    int n = channel.read(input);

    if (n == -1) {
        closeKey(key);
        return;
    }

    if (n == 0) {
        return;
    }

    input.flip();
    while (tryParseAndHandleMessage(input, state)) {
        // process complete messages
    }
    input.compact();
}
```

Poin penting:

- `-1` berarti peer menutup stream.
- `0` bukan error pada non-blocking mode.
- `flip()` sebelum membaca buffer.
- `compact()` untuk mempertahankan partial message.
- Parser harus bisa berhenti jika message belum lengkap.

---

## 18. Write dengan Non-Blocking SocketChannel

Write non-blocking lebih sulit daripada read.

Salah:

```java
channel.write(responseBuffer); // menganggap semua terkirim
```

Benar secara konsep:

```java
private static void handleWrite(SelectionKey key) throws IOException {
    SocketChannel channel = (SocketChannel) key.channel();
    ConnectionState state = (ConnectionState) key.attachment();

    Queue<ByteBuffer> queue = state.outputQueue();

    while (!queue.isEmpty()) {
        ByteBuffer buffer = queue.peek();
        channel.write(buffer);

        if (buffer.hasRemaining()) {
            // socket send buffer penuh; tunggu event OP_WRITE berikutnya
            return;
        }

        queue.remove();
    }

    // Tidak ada lagi yang perlu ditulis; jangan terus interest OP_WRITE
    key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);
}
```

Kenapa `OP_WRITE` tidak boleh selalu aktif?

Karena socket sering dianggap writable hampir sepanjang waktu. Jika selalu interested pada `OP_WRITE`, event loop bisa bangun terus-menerus dan CPU naik walaupun tidak ada data penting untuk dikirim.

Pattern yang benar:

```text
ada data output -> enqueue -> enable OP_WRITE
queue kosong -> disable OP_WRITE
```

---

## 19. Connection State: Hal yang Sering Dilupakan

Stream blocking membuat state sering tersirat dalam call stack:

```java
read request
process
write response
```

NIO non-blocking memecah flow menjadi event-event terpisah. Karena itu state harus eksplisit.

Contoh state:

```java
final class ConnectionState {
    private final SocketChannel channel;
    private final ByteBuffer inputBuffer = ByteBuffer.allocate(8192);
    private final Queue<ByteBuffer> outputQueue = new ArrayDeque<>();

    ConnectionState(SocketChannel channel) {
        this.channel = channel;
    }

    ByteBuffer inputBuffer() {
        return inputBuffer;
    }

    Queue<ByteBuffer> outputQueue() {
        return outputQueue;
    }

    void enqueue(ByteBuffer output) {
        outputQueue.add(output);
    }
}
```

Untuk protocol nyata, state bisa lebih kompleks:

```text
CONNECTING
WAITING_FOR_HEADER
WAITING_FOR_BODY
PROCESSING
WRITING_RESPONSE
CLOSING
CLOSED
```

Tanpa state eksplisit, event loop akan cepat menjadi spaghetti.

---

## 20. Readiness vs Completion

Ini perbedaan yang sangat penting.

Selector model adalah **readiness model**:

```text
Channel mungkin siap untuk read/write sekarang.
```

Bukan:

```text
Operasi read/write sudah selesai.
```

Completion model adalah seperti asynchronous API:

```text
Kamu minta operasi I/O, lalu diberi callback/future saat selesai.
```

Java punya dua keluarga berbeda:

| Model | API |
|---|---|
| Readiness | `Selector`, `SocketChannel`, `ServerSocketChannel` |
| Completion | `AsynchronousSocketChannel`, `AsynchronousFileChannel` |

Part ini fokus pada readiness model. Completion-style async akan dibahas di part concurrency/I/O berikutnya.

---

## 21. Scattering dan Gathering

NIO mendukung operasi read/write dengan banyak buffer.

### 21.1 Scattering Read

```java
ByteBuffer header = ByteBuffer.allocate(16);
ByteBuffer body = ByteBuffer.allocate(1024);

channel.read(new ByteBuffer[] { header, body });
```

Data dibaca berurutan ke header lalu body.

Cocok untuk protocol:

```text
[fixed header][variable body]
```

### 21.2 Gathering Write

```java
ByteBuffer header = createHeader();
ByteBuffer body = createBody();

channel.write(new ByteBuffer[] { header, body });
```

Data ditulis sebagai gabungan logical tanpa harus copy header+body ke satu array besar.

Keuntungan:

- mengurangi copy,
- memudahkan framing,
- cocok untuk response network,
- bisa membantu performance jika dipakai benar.

Namun tetap harus handle partial write:

```java
ByteBuffer[] buffers = { header, body };
while (hasRemaining(buffers)) {
    long written = channel.write(buffers);
    if (written == 0) {
        break;
    }
}
```

---

## 22. Contoh Lengkap: Echo Server NIO Minimal

Contoh ini bukan production-ready, tetapi menunjukkan pola inti.

```java
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.Queue;

public final class NioEchoServer {
    public static void main(String[] args) throws IOException {
        new NioEchoServer().run(8080);
    }

    public void run(int port) throws IOException {
        try (Selector selector = Selector.open();
             ServerSocketChannel server = ServerSocketChannel.open()) {

            server.bind(new InetSocketAddress(port));
            server.configureBlocking(false);
            server.register(selector, SelectionKey.OP_ACCEPT);

            while (true) {
                selector.select();

                Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();
                while (iterator.hasNext()) {
                    SelectionKey key = iterator.next();
                    iterator.remove();

                    try {
                        if (!key.isValid()) {
                            continue;
                        }
                        if (key.isAcceptable()) {
                            accept(selector, key);
                        } else {
                            if (key.isReadable()) {
                                read(key);
                            }
                            if (key.isValid() && key.isWritable()) {
                                write(key);
                            }
                        }
                    } catch (IOException e) {
                        closeKey(key);
                    }
                }
            }
        }
    }

    private static void accept(Selector selector, SelectionKey key) throws IOException {
        ServerSocketChannel server = (ServerSocketChannel) key.channel();
        SocketChannel client = server.accept();
        if (client == null) {
            return;
        }

        client.configureBlocking(false);
        ConnectionState state = new ConnectionState();
        SelectionKey clientKey = client.register(selector, SelectionKey.OP_READ);
        clientKey.attach(state);
    }

    private static void read(SelectionKey key) throws IOException {
        SocketChannel channel = (SocketChannel) key.channel();
        ConnectionState state = (ConnectionState) key.attachment();

        ByteBuffer input = state.input;
        int n = channel.read(input);

        if (n == -1) {
            closeKey(key);
            return;
        }

        if (n == 0) {
            return;
        }

        input.flip();
        ByteBuffer echo = ByteBuffer.allocate(input.remaining());
        echo.put(input);
        echo.flip();
        state.outputs.add(echo);
        input.clear();

        key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
    }

    private static void write(SelectionKey key) throws IOException {
        SocketChannel channel = (SocketChannel) key.channel();
        ConnectionState state = (ConnectionState) key.attachment();

        while (!state.outputs.isEmpty()) {
            ByteBuffer output = state.outputs.peek();
            channel.write(output);

            if (output.hasRemaining()) {
                return;
            }

            state.outputs.remove();
        }

        key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);
    }

    private static void closeKey(SelectionKey key) {
        try {
            key.cancel();
            key.channel().close();
        } catch (IOException ignored) {
            // In real systems, log at debug/trace level if useful.
        }
    }

    private static final class ConnectionState {
        private final ByteBuffer input = ByteBuffer.allocate(8192);
        private final Queue<ByteBuffer> outputs = new ArrayDeque<>();
    }
}
```

Hal yang sengaja disederhanakan:

- tidak ada protocol framing,
- tidak ada max buffer protection,
- tidak ada timeout,
- tidak ada backpressure policy,
- tidak ada metrics,
- tidak ada graceful shutdown,
- tidak ada TLS,
- tidak ada bounded output queue.

Untuk production, semua itu wajib dipikirkan.

---

## 23. Failure Model NIO Core

### 23.1 Lupa `flip()`

Bug:

```java
channel.read(buffer);
while (buffer.hasRemaining()) {
    process(buffer.get());
}
```

Masalah:

Setelah read, buffer masih write mode. `position` sudah di akhir data, `limit` masih capacity. Kamu akan membaca area yang bukan data valid.

Benar:

```java
channel.read(buffer);
buffer.flip();
while (buffer.hasRemaining()) {
    process(buffer.get());
}
buffer.clear();
```

### 23.2 Memakai `clear()` Saat Ada Partial Data

Bug:

```java
buffer.flip();
tryParseFrame(buffer);
buffer.clear();
```

Jika frame belum lengkap, data partial hilang.

Benar:

```java
buffer.flip();
while (tryParseFrame(buffer)) {
    // process full frame
}
buffer.compact();
```

### 23.3 Menganggap `write()` Selalu Menulis Semua Data

Bug:

```java
channel.write(buffer);
buffer.clear();
```

Jika partial write, sisa data hilang.

Benar:

```java
while (buffer.hasRemaining()) {
    channel.write(buffer);
}
```

Untuk non-blocking, jangan busy spin; gunakan output queue dan `OP_WRITE`.

### 23.4 Menganggap `read() == 0` Berarti EOF

Bug:

```java
int n = channel.read(buffer);
if (n <= 0) {
    close();
}
```

Pada non-blocking channel, `0` berarti belum ada data sekarang, bukan EOF.

Benar:

```java
if (n == -1) {
    close();
} else if (n == 0) {
    return;
} else {
    process();
}
```

### 23.5 Tidak Menghapus Selected Key

Bug:

```java
for (SelectionKey key : selector.selectedKeys()) {
    handle(key);
}
```

Masalah:

Selected-key set tidak otomatis dibersihkan.

Benar:

```java
Iterator<SelectionKey> it = selector.selectedKeys().iterator();
while (it.hasNext()) {
    SelectionKey key = it.next();
    it.remove();
    handle(key);
}
```

### 23.6 Selalu Interest `OP_WRITE`

Bug:

```java
client.register(selector, SelectionKey.OP_READ | SelectionKey.OP_WRITE);
```

Masalah:

Socket sering writable. Selector bisa terus bangun dan CPU naik.

Benar:

```text
OP_WRITE hanya diaktifkan ketika output queue tidak kosong.
```

### 23.7 Output Queue Tidak Dibatasi

Bug:

```java
state.outputs.add(response); // unlimited
```

Jika client lambat membaca, output queue membesar sampai OOM.

Benar:

- batasi queue per connection,
- batasi total memory output,
- close slow consumer,
- apply backpressure ke upstream,
- gunakan timeout.

---

## 24. Production Design: NIO Event Loop sebagai State Machine

NIO server yang sehat biasanya punya struktur seperti ini:

```text
[Selector Thread]
    accept connection
    read bytes
    parse frames
    enqueue complete request
    write queued response

[Worker Pool]
    process request
    produce response
    enqueue response to connection
    wakeup selector
```

Kenapa tidak process request berat di selector thread?

Karena selector thread harus cepat kembali ke event loop. Jika blocking di selector thread:

- connection lain telat diproses,
- read buffer penuh,
- latency naik,
- timeout palsu terjadi,
- throughput turun.

Rule:

```text
Selector thread handles I/O readiness and lightweight protocol state.
Worker threads handle expensive business logic.
```

Namun crossing thread juga harus hati-hati:

1. output queue harus thread-safe atau dimodifikasi hanya dengan mekanisme aman,
2. setelah worker menambahkan response, selector perlu dibangunkan dengan `selector.wakeup()`,
3. interest ops harus diubah dengan koordinasi yang benar,
4. connection mungkin sudah closed saat response selesai diproses.

---

## 25. Selector Wakeup

`selector.select()` bisa memblokir menunggu event.

Jika thread lain ingin mengubah interest ops atau menambahkan data output, selector perlu dibangunkan.

Pattern:

```java
state.enqueue(response);
key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
selector.wakeup();
```

Namun desain thread-safety-nya harus rapi. Banyak framework menghindari modifikasi langsung dari worker thread dengan cara mengirim task ke event loop queue.

Contoh mental model:

```text
Worker thread -> eventLoop.execute(task) -> selector.wakeup()
Event loop -> drain task queue -> modify keys safely
```

---

## 26. Kapan Memakai NIO Selector?

Gunakan NIO selector ketika:

1. Kamu membangun server network dengan banyak connection concurrent.
2. Kamu perlu kontrol manual terhadap protocol binary/text custom.
3. Kamu ingin memahami atau membangun event-loop framework.
4. Kamu membuat low-level proxy, gateway, broker, tunnel, atau transport layer.
5. Kamu perlu mengelola ribuan socket dengan sedikit thread.
6. Kamu ingin menerapkan backpressure dan queueing di level connection.

Jangan langsung memakai NIO selector hanya karena “lebih cepat”.

Untuk banyak aplikasi enterprise modern:

- blocking I/O + virtual threads bisa lebih sederhana,
- framework seperti Netty sudah mengelola kompleksitas ini,
- HTTP client/server framework lebih cocok daripada raw selector,
- file I/O sequential tidak otomatis lebih baik dengan selector.

Decision matrix:

| Problem | Pilihan yang sering lebih tepat |
|---|---|
| Baca file kecil | `Files.readString`, `Files.readAllBytes` dengan batas ukuran jelas |
| Baca file besar sequential | `BufferedInputStream`, `BufferedReader`, atau `FileChannel` |
| Copy file besar | `Files.copy` atau `FileChannel.transferTo/transferFrom` |
| TCP server sederhana | Blocking socket, virtual thread, atau framework |
| TCP server custom high-concurrency | NIO selector atau Netty |
| HTTP API | Framework HTTP, bukan raw NIO |
| Binary protocol custom | NIO/Netty dengan framing eksplisit |
| Latency-sensitive gateway | Event loop + bounded queue + metrics |

---

## 27. NIO dan Virtual Threads

Sejak virtual threads menjadi fitur final di Java 21, keputusan antara blocking dan non-blocking perlu lebih matang.

Virtual threads membuat blocking I/O lebih scalable dari sisi programming model karena banyak virtual thread bisa dipark saat blocking tanpa memakai satu platform thread per blocked operation secara permanen.

Namun virtual threads tidak menghapus kebutuhan NIO selector dalam semua kasus.

Perbandingan:

| Aspek | Virtual Thread Blocking I/O | NIO Selector |
|---|---|---|
| Programming model | Sederhana, sequential | Event-driven, stateful |
| Debugging | Lebih mudah | Lebih kompleks |
| Banyak connection idle | Baik | Sangat baik |
| Fine-grained backpressure | Perlu desain tambahan | Natural di event loop |
| Protocol custom high-perf | Bisa, tapi tergantung | Sangat cocok |
| Framework low-level | Tidak selalu | Umum |
| Learning curve | Lebih rendah | Lebih tinggi |

Rule praktis:

```text
Jika sequential blocking code memenuhi kebutuhan dan resource terkendali, jangan memaksakan selector.
Jika kamu butuh multiplexing, protocol state eksplisit, dan kontrol low-level, selector masuk akal.
```

---

## 28. Hubungan NIO Core dengan Part Berikutnya

Part ini adalah fondasi untuk beberapa bagian berikutnya:

```text
Part 008 -> ByteBuffer Deep Dive
Part 009 -> FileChannel
Part 010 -> Memory-Mapped File
Part 021 -> NIO Networking
Part 028 -> Concurrency and I/O
```

Kamu perlu benar-benar memahami:

- `position`, `limit`, `capacity`,
- `flip`, `clear`, `compact`,
- partial read/write,
- `read() == 0`,
- output queue,
- `OP_WRITE` management,
- selector selected-key removal,
- state per connection.

Tanpa itu, topik lanjutan akan terasa seperti kumpulan API yang sulit diprediksi.

---

## 29. Anti-Pattern Checklist

Hindari ini:

- Menganggap NIO selalu lebih cepat dari `java.io`.
- Memakai selector untuk semua masalah I/O.
- Lupa `flip()` setelah read ke buffer.
- Memakai `clear()` padahal ada partial frame.
- Tidak handle partial write.
- Menganggap `read() == 0` sebagai EOF.
- Tidak remove selected key.
- Selalu enable `OP_WRITE`.
- Output queue tidak dibatasi.
- Blocking database/API call di selector thread.
- Tidak punya state machine protocol.
- Parsing message tanpa max frame size.
- Tidak punya timeout untuk idle/slow connection.
- Tidak menutup channel saat error.
- Sharing `ByteBuffer` mutable antar thread tanpa ownership rule.
- Membuat direct buffer baru per request kecil.

---

## 30. Production Checklist

Saat mendesain NIO-based component, jawab pertanyaan ini:

### Buffer

- Berapa ukuran input buffer per connection?
- Apakah buffer heap atau direct?
- Siapa owner buffer?
- Apakah buffer dipakai lintas thread?
- Apa yang terjadi jika message lebih besar dari buffer?
- Apakah partial frame ditangani dengan `compact()` atau state lain?

### Protocol

- Apakah message boundary eksplisit?
- Apakah ada max frame size?
- Apakah parser bisa handle partial read?
- Apakah parser bisa handle multiple frame dalam satu read?
- Apakah invalid frame langsung menutup connection?
- Apakah ada protocol version?

### Write

- Apakah partial write ditangani?
- Apakah output queue bounded?
- Kapan `OP_WRITE` diaktifkan?
- Kapan `OP_WRITE` dimatikan?
- Apa policy untuk slow consumer?

### Selector

- Apakah selected key selalu di-remove?
- Apakah blocking work dihindari dari selector thread?
- Apakah cross-thread wakeup aman?
- Apakah close/cancel key aman?
- Apakah exception per key tidak mematikan seluruh event loop?

### Reliability

- Apakah ada idle timeout?
- Apakah ada read timeout?
- Apakah ada write timeout?
- Apakah ada graceful shutdown?
- Apakah metrics per connection tersedia?
- Apakah memory pressure terukur?

---

## 31. Latihan

### Latihan 1 — Buffer State Trace

Diberikan kode:

```java
ByteBuffer b = ByteBuffer.allocate(10);
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

1. Berapa `position`, `limit`, dan `capacity` setelah setiap operasi?
2. Byte apa yang akan terbaca setelah operasi terakhir?
3. Apa bedanya jika `compact()` diganti `clear()`?

### Latihan 2 — Partial Frame Parser

Buat parser untuk format:

```text
[length:int][payload:utf8]
```

Syarat:

- handle partial header,
- handle partial body,
- handle multiple frame dalam satu buffer,
- reject length negatif,
- reject length > 1 MB,
- gunakan `compact()` setelah parsing.

### Latihan 3 — Non-Blocking Write Queue

Buat `ConnectionState` yang memiliki:

- input buffer,
- output queue,
- max queued bytes,
- method `enqueue(ByteBuffer response)` yang menolak response jika queue penuh.

Diskusikan:

- kapan connection harus ditutup,
- kapan upstream diberi backpressure,
- metric apa yang perlu dicatat.

### Latihan 4 — Selector Bug Hunt

Cari bug pada pseudo-code ini:

```java
selector.select();
for (SelectionKey key : selector.selectedKeys()) {
    if (key.isWritable()) {
        channel.write(buffer);
    }
    if (key.isReadable()) {
        channel.read(buffer);
        buffer.flip();
        process(buffer);
        buffer.clear();
    }
}
```

Minimal temukan 5 bug atau risiko.

---

## 32. Ringkasan

NIO bukan sekadar API yang “lebih modern” dari `java.io`. NIO adalah model I/O yang membuat boundary antara aplikasi, buffer, channel, dan OS menjadi lebih eksplisit.

Hal terpenting dari part ini:

1. `Buffer` adalah state machine dengan `position`, `limit`, dan `capacity`.
2. `flip()` mengubah write mode menjadi read mode.
3. `clear()` membuang state data yang belum diproses secara logical.
4. `compact()` mempertahankan data yang belum dibaca.
5. `Channel` membaca/menulis melalui buffer.
6. Read dan write bisa partial.
7. Pada non-blocking channel, `read() == 0` adalah kondisi normal.
8. `Selector` memungkinkan satu thread memonitor banyak channel.
9. `OP_WRITE` harus dikelola hati-hati agar tidak menyebabkan busy loop.
10. NIO event loop membutuhkan state eksplisit per connection.
11. NIO cocok untuk low-level high-concurrency I/O, tetapi tidak selalu pilihan terbaik untuk semua aplikasi.
12. Dengan virtual threads, blocking I/O kembali menjadi pilihan yang sangat kompetitif untuk banyak use case, tetapi selector tetap penting untuk event-loop dan protocol-level control.

Mental model akhir:

```text
java.io:
  stream hides much of the state
  simple linear blocking flow

java.nio:
  buffer exposes state
  channel exposes I/O boundary
  selector exposes readiness multiplexing
  application must own protocol state
```

Jika kamu memahami ini, kamu sudah punya fondasi kuat untuk masuk ke `ByteBuffer` deep dive, `FileChannel`, memory-mapped file, dan NIO networking yang lebih kompleks.

---

## 33. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

```text
Part 000 — Mental Model Besar Java I/O
Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
Part 002 — Classic java.io: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance
Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil
Part 005 — Character I/O: Reader, Writer, Line Processing, Large Text File, dan Text Pipeline
Part 006 — Console I/O: System.in/out/err, Console, Password Input, dan CLI Interaction
Part 007 — NIO Core: Buffer, Channel, Selector, dan Perubahan Mental Model dari Stream
```

Part berikutnya:

```text
Part 008 — ByteBuffer Deep Dive: Heap, Direct, Mapped, Slice, Duplicate, View Buffer
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 006 — Console I/O: `System.in/out/err`, `Console`, Password Input, dan CLI Interaction](./learn-java-io-nio-networking-data-transfer-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 008 — ByteBuffer Deep Dive: Heap, Direct, Mapped, Slice, Duplicate, View Buffer](./learn-java-io-nio-networking-data-transfer-part-008.md)
