# Part 021 — NIO Networking: `SocketChannel`, `ServerSocketChannel`, `Selector`, dan Event Loop

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-021.md`  
> Status: Part 021 dari 030  
> Prasyarat langsung: Part 007, Part 008, Part 019, Part 020

---

## 0. Tujuan Pembelajaran

Di part sebelumnya kita sudah membahas bahwa TCP adalah **byte stream**, bukan message stream. Kita juga sudah membahas framing, partial read/write, timeout, slow peer, dan backpressure pada socket blocking.

Part ini melangkah ke model yang berbeda: **NIO networking**.

Target setelah menyelesaikan part ini:

1. Memahami mengapa `SocketChannel`, `ServerSocketChannel`, dan `Selector` ada.
2. Memahami perbedaan **blocking socket** dan **non-blocking channel**.
3. Memahami event loop sebagai arsitektur, bukan sekadar loop `while(true)`.
4. Bisa menjelaskan lifecycle sebuah connection dalam server NIO.
5. Bisa mendesain per-connection state untuk:
   - read buffer
   - frame decoder
   - outbound write queue
   - timeout
   - close state
6. Bisa menghindari bug klasik:
   - busy loop
   - lupa remove selected key
   - write interest selalu aktif
   - partial write dianggap selesai
   - `read() == 0` dianggap EOF
   - blocking operation di event loop
   - shared buffer antar connection
7. Bisa membuat mental bridge ke framework seperti Netty, Undertow, Reactor Netty, dan server HTTP modern.

---

## 1. Kenapa Perlu NIO Networking?

### 1.1 Model blocking tradisional

Pada blocking socket server klasik, pola umumnya:

```java
ServerSocket serverSocket = new ServerSocket(8080);

while (true) {
    Socket socket = serverSocket.accept(); // blocking
    new Thread(() -> handle(socket)).start();
}
```

Lalu tiap handler melakukan:

```java
int n = inputStream.read(buffer); // blocking
outputStream.write(response);     // blocking
```

Model ini mudah dipahami karena flow program linear:

```text
accept -> read -> process -> write -> close
```

Masalahnya muncul saat jumlah connection besar.

Misalnya:

```text
10 connection       -> fine
100 connection      -> still okay
1.000 connection    -> thread overhead mulai terasa
10.000 connection   -> thread stack, context switching, scheduling, memory, dan coordination menjadi mahal
```

Blocking I/O membuat thread park/menunggu sampai socket siap. Jika setiap connection butuh thread sendiri, maka banyak thread hanya hidup untuk menunggu network.

### 1.2 NIO mengubah pertanyaan

Blocking model bertanya:

```text
"Thread ini sedang menangani connection mana?"
```

NIO model bertanya:

```text
"Connection mana yang saat ini siap melakukan operasi I/O?"
```

Ini perubahan besar.

Alih-alih:

```text
1 thread per connection
```

NIO memungkinkan:

```text
1 thread mengawasi banyak connection
```

Dengan `Selector`, satu thread bisa menunggu readiness dari banyak `SelectableChannel`.

### 1.3 Readiness, bukan completion

Hal paling penting:

```text
Selector memberi tahu readiness, bukan completion.
```

Artinya:

```text
OP_READ  -> channel kemungkinan bisa dibaca tanpa blocking
OP_WRITE -> channel kemungkinan bisa ditulis tanpa blocking
OP_ACCEPT -> server socket kemungkinan punya incoming connection
OP_CONNECT -> non-blocking connect kemungkinan selesai
```

Bukan berarti:

```text
OP_READ  -> semua message lengkap tersedia
OP_WRITE -> semua response pasti terkirim
```

Ini mirip “pintu sedang bisa dilewati”, bukan “barang sudah selesai dipindahkan”.

---

## 2. API Besar dalam NIO Networking

NIO networking ada di package:

```java
java.nio.channels
```

Konsep utama:

| API | Peran |
|---|---|
| `SocketChannel` | TCP client/accepted connection channel |
| `ServerSocketChannel` | TCP listening server channel |
| `DatagramChannel` | UDP channel |
| `Selector` | Multiplexer readiness banyak channel |
| `SelectionKey` | Relasi antara channel dan selector |
| `ByteBuffer` | Buffer baca/tulis |
| `SelectableChannel` | Channel yang bisa non-blocking dan registered ke selector |

Pola dasarnya:

```text
create channel
configure non-blocking
register to selector
wait select
iterate ready keys
handle accept/read/write/connect
update interest ops
repeat
```

---

## 3. `ServerSocketChannel`

`ServerSocketChannel` adalah channel untuk listening socket TCP.

Blocking equivalent:

```java
ServerSocket serverSocket = new ServerSocket(port);
Socket socket = serverSocket.accept();
```

NIO equivalent:

```java
ServerSocketChannel server = ServerSocketChannel.open();
server.bind(new InetSocketAddress(port));
server.configureBlocking(false);
server.register(selector, SelectionKey.OP_ACCEPT);
```

### 3.1 Important invariant

Sebelum register ke selector:

```java
server.configureBlocking(false);
```

Jika channel masih blocking, register ke selector akan gagal.

Invariant:

```text
SelectableChannel yang didaftarkan ke Selector harus berada dalam non-blocking mode.
```

### 3.2 `accept()` pada non-blocking server

Pada blocking server:

```java
Socket socket = serverSocket.accept(); // wait sampai ada connection
```

Pada non-blocking server:

```java
SocketChannel client = server.accept(); // bisa return null
```

Meskipun key ready untuk accept, kode tetap harus siap jika `accept()` return `null`, karena readiness adalah signal yang bisa berubah.

Pola aman:

```java
if (key.isAcceptable()) {
    ServerSocketChannel server = (ServerSocketChannel) key.channel();

    SocketChannel client;
    while ((client = server.accept()) != null) {
        client.configureBlocking(false);
        client.register(selector, SelectionKey.OP_READ, new ConnectionState(client));
    }
}
```

Kenapa `while`?

Karena bisa ada lebih dari satu incoming connection yang sudah menunggu.

---

## 4. `SocketChannel`

`SocketChannel` mewakili TCP connection.

Bisa muncul dari:

1. Client side:

```java
SocketChannel.open(new InetSocketAddress(host, port));
```

2. Server side accepted connection:

```java
SocketChannel client = serverSocketChannel.accept();
```

### 4.1 Non-blocking read

```java
int n = channel.read(buffer);
```

Return value:

| Return | Makna |
|---:|---|
| `> 0` | jumlah byte yang dibaca |
| `0` | belum ada byte tersedia sekarang |
| `-1` | peer melakukan orderly shutdown / EOF |

Bug umum:

```java
if (n <= 0) close();
```

Ini salah.

Yang benar:

```java
if (n == -1) {
    closeConnection();
} else if (n == 0) {
    // nothing available now
} else {
    // process bytes
}
```

### 4.2 Non-blocking write

```java
int n = channel.write(buffer);
```

Return value:

| Return | Makna |
|---:|---|
| `> 0` | sejumlah byte berhasil ditulis ke socket buffer |
| `0` | socket send buffer sedang penuh |
| exception | connection error, broken pipe, reset, closed |

Bug umum:

```java
channel.write(buffer);
buffer.clear(); // salah jika belum semua terkirim
```

Yang benar:

```java
while (buffer.hasRemaining()) {
    int n = channel.write(buffer);
    if (n == 0) {
        break;
    }
}
```

Jika `buffer.hasRemaining()` masih true, berarti response belum selesai dikirim dan harus disimpan di outbound queue.

---

## 5. `Selector`

`Selector` adalah multiplexer.

Mental model:

```text
Banyak channel -> satu selector -> satu event loop
```

Kamu register channel ke selector dengan interest tertentu.

```java
SelectionKey key = channel.register(selector, SelectionKey.OP_READ);
```

Lalu event loop memanggil:

```java
selector.select();
```

`select()` memblok thread sampai ada channel siap, timeout, interrupt, atau `wakeup()`.

### 5.1 Selected keys

Setelah `select()` return:

```java
Set<SelectionKey> selectedKeys = selector.selectedKeys();
```

Set ini berisi key yang ready.

Pola penting:

```java
Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();

while (iterator.hasNext()) {
    SelectionKey key = iterator.next();
    iterator.remove(); // wajib

    if (!key.isValid()) {
        continue;
    }

    if (key.isAcceptable()) handleAccept(key);
    if (key.isReadable()) handleRead(key);
    if (key.isWritable()) handleWrite(key);
}
```

Kenapa `iterator.remove()` wajib?

Karena selected-key set tidak otomatis dibersihkan. Jika tidak di-remove, event yang sama bisa diproses berulang.

---

## 6. `SelectionKey`

`SelectionKey` adalah “registration record” antara channel dan selector.

Isinya:

1. Channel.
2. Selector.
3. Interest ops.
4. Ready ops.
5. Attachment.

### 6.1 Interest ops vs ready ops

Interest ops:

```text
Operasi apa yang ingin kita pantau?
```

Ready ops:

```text
Operasi apa yang saat ini ready menurut selector?
```

Contoh:

```java
key.interestOps(SelectionKey.OP_READ);
```

Maksudnya:

```text
Saya ingin diberi tahu saat channel siap dibaca.
```

Jika ada data:

```java
key.isReadable()
```

bisa true.

### 6.2 Attachment

Attachment sangat penting untuk menyimpan state connection.

```java
ConnectionState state = new ConnectionState(channel);
SelectionKey key = channel.register(selector, SelectionKey.OP_READ, state);
```

Nanti:

```java
ConnectionState state = (ConnectionState) key.attachment();
```

Attachment biasanya menyimpan:

```text
read buffer
decoder state
pending frames
write queue
last read timestamp
last write timestamp
connection id
remote address
authentication/session context
close state
```

Jangan menyimpan state connection di global map jika tidak perlu. Attachment membuat state dekat dengan registration.

---

## 7. Event Loop sebagai State Machine

Event loop bukan sekadar:

```java
while (true) selector.select();
```

Event loop adalah mesin yang menggerakkan banyak connection state machine.

### 7.1 High-level loop

```text
while running:
    wait for ready channels
    for each ready key:
        if acceptable -> accept new connections
        if connectable -> finish connection
        if readable -> read available bytes into state buffer
        if writable -> flush pending outbound bytes
    run scheduled tasks
    close expired connections
```

### 7.2 Event loop harus cepat

Rule penting:

```text
Event loop tidak boleh melakukan pekerjaan blocking atau berat.
```

Jangan lakukan ini di event loop:

```text
database query blocking
HTTP call blocking
file read besar blocking
compression besar CPU-heavy
JSON parse besar tanpa batas
sleep
wait
future.get()
synchronized lock lama
logging sink yang blocking
```

Event loop harus menangani I/O readiness, bukan semua business logic berat.

Pola umum:

```text
event loop:
    read bytes
    decode frame
    dispatch task ke worker
worker:
    process business logic
    produce response
event loop:
    write response
```

Namun dispatch ke worker juga harus bounded, karena queue tidak boleh tumbuh tanpa batas.

---

## 8. Per-Connection State

NIO server yang benar selalu punya state per connection.

Minimal:

```java
final class ConnectionState {
    final SocketChannel channel;
    final ByteBuffer readBuffer = ByteBuffer.allocate(64 * 1024);
    final Deque<ByteBuffer> writeQueue = new ArrayDeque<>();

    long lastReadNanos = System.nanoTime();
    long lastWriteNanos = System.nanoTime();

    boolean closingAfterWrite;
    boolean closed;

    ConnectionState(SocketChannel channel) {
        this.channel = channel;
    }
}
```

Kenapa perlu state?

Karena dalam NIO, satu event tidak berarti satu request lengkap.

Read bisa terjadi seperti ini:

```text
read event 1 -> hanya header parsial
read event 2 -> header lengkap, body parsial
read event 3 -> body lengkap, request 1 selesai + request 2 parsial
```

Write bisa terjadi seperti ini:

```text
write event 1 -> terkirim 2 KB dari response 100 KB
write event 2 -> terkirim 40 KB
write event 3 -> sisanya selesai
```

Tanpa state, server akan korup.

---

## 9. Read Path

### 9.1 Basic read handler

```java
private static void handleRead(SelectionKey key) throws IOException {
    SocketChannel channel = (SocketChannel) key.channel();
    ConnectionState state = (ConnectionState) key.attachment();

    ByteBuffer buffer = state.readBuffer;

    int totalRead = 0;

    while (true) {
        int n = channel.read(buffer);

        if (n > 0) {
            totalRead += n;
            state.lastReadNanos = System.nanoTime();
            continue;
        }

        if (n == 0) {
            break;
        }

        if (n == -1) {
            closeKey(key);
            return;
        }
    }

    if (totalRead > 0) {
        buffer.flip();
        decodeAvailableFrames(state, buffer);
        buffer.compact();
    }
}
```

### 9.2 Kenapa `flip()` lalu `compact()`?

`readBuffer` berada dalam mode write saat `channel.read(buffer)`.

Setelah baca:

```java
buffer.flip();
```

Sekarang buffer siap dibaca oleh decoder.

Setelah decoder mengambil frame lengkap, mungkin masih ada bytes parsial yang belum cukup menjadi frame.

```java
buffer.compact();
```

`compact()` memindahkan remaining bytes ke awal buffer dan mengubah buffer kembali ke mode write.

Ini pola utama untuk stream decoder:

```text
read into buffer
flip
decode as much as possible
compact leftover
```

### 9.3 Jangan `clear()` setelah decode parsial

Jika kamu melakukan:

```java
buffer.clear();
```

maka byte parsial akan hilang.

Contoh frame length-prefix:

```text
[00 00 10 00 ... body 4096 bytes ...]
```

Jika baru masuk 100 bytes, decoder belum bisa menyelesaikan frame. Byte itu harus dipertahankan.

---

## 10. Frame Decoder di NIO

Kita pakai contoh protocol sederhana:

```text
4-byte big-endian length
N-byte payload UTF-8
```

Invariant:

```text
length >= 0
length <= MAX_FRAME_SIZE
payload harus tersedia lengkap sebelum diproses
```

Decoder:

```java
private static final int MAX_FRAME_SIZE = 1024 * 1024; // 1 MB

private static void decodeAvailableFrames(ConnectionState state, ByteBuffer buffer) {
    while (true) {
        if (buffer.remaining() < Integer.BYTES) {
            return;
        }

        buffer.mark();

        int length = buffer.getInt();

        if (length < 0 || length > MAX_FRAME_SIZE) {
            throw new ProtocolException("Invalid frame length: " + length);
        }

        if (buffer.remaining() < length) {
            buffer.reset();
            return;
        }

        byte[] payload = new byte[length];
        buffer.get(payload);

        handleFrame(state, payload);
    }
}
```

Kenapa `mark/reset`?

Karena jika header length sudah dibaca tapi body belum lengkap, kita harus mengembalikan posisi buffer ke sebelum header. Jika tidak, header hilang dan parsing berikutnya rusak.

### 10.1 Decoder yang lebih advanced

Untuk throughput tinggi, hindari membuat `byte[]` untuk setiap frame jika memungkinkan.

Opsi:

1. Process langsung dari `ByteBuffer` slice.
2. Pakai pooled buffer.
3. Pakai parser incremental.
4. Pakai off-heap/direct buffer untuk network layer.
5. Decode ke object hanya setelah frame lengkap.

Tapi untuk correctness, desain di atas sudah cukup sebagai mental model.

---

## 11. Write Path

### 11.1 Why write queue exists

NIO write bisa partial.

Misalnya response 1 MB:

```java
channel.write(buffer);
```

Mungkin hanya menulis 32 KB karena kernel send buffer penuh.

Maka sisanya harus disimpan.

State:

```java
Deque<ByteBuffer> writeQueue = new ArrayDeque<>();
```

Saat ada response:

```java
state.writeQueue.add(encodedFrame);
enableWriteInterest(key);
```

### 11.2 Write handler

```java
private static void handleWrite(SelectionKey key) throws IOException {
    SocketChannel channel = (SocketChannel) key.channel();
    ConnectionState state = (ConnectionState) key.attachment();

    while (!state.writeQueue.isEmpty()) {
        ByteBuffer current = state.writeQueue.peek();

        int n = channel.write(current);

        if (n > 0) {
            state.lastWriteNanos = System.nanoTime();
        }

        if (current.hasRemaining()) {
            // socket send buffer full
            break;
        }

        state.writeQueue.remove();
    }

    if (state.writeQueue.isEmpty()) {
        disableWriteInterest(key);

        if (state.closingAfterWrite) {
            closeKey(key);
        }
    }
}
```

### 11.3 OP_WRITE trap

`OP_WRITE` biasanya ready hampir terus saat socket send buffer punya ruang.

Jika kamu selalu register `OP_WRITE`, event loop bisa busy loop.

Salah:

```java
key.interestOps(SelectionKey.OP_READ | SelectionKey.OP_WRITE);
```

Benar:

```text
Enable OP_WRITE hanya saat ada data pending.
Disable OP_WRITE setelah queue kosong.
```

Implementation:

```java
private static void enableWriteInterest(SelectionKey key) {
    key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
}

private static void disableWriteInterest(SelectionKey key) {
    key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);
}
```

---

## 12. Accept Path

```java
private static void handleAccept(SelectionKey key, Selector selector) throws IOException {
    ServerSocketChannel server = (ServerSocketChannel) key.channel();

    while (true) {
        SocketChannel client = server.accept();

        if (client == null) {
            break;
        }

        client.configureBlocking(false);
        client.setOption(StandardSocketOptions.TCP_NODELAY, true);
        client.setOption(StandardSocketOptions.SO_KEEPALIVE, true);

        ConnectionState state = new ConnectionState(client);

        client.register(selector, SelectionKey.OP_READ, state);
    }
}
```

Catatan:

1. Jangan langsung read di accept handler kecuali kamu tahu datanya sudah available.
2. Set socket option sebelum traffic berjalan.
3. Pastikan setiap accepted channel punya state sendiri.
4. Limit jumlah connection jika perlu.
5. Gunakan timeout idle untuk mencegah connection menggantung.

---

## 13. Connect Path untuk Non-Blocking Client

NIO juga bisa dipakai untuk client.

```java
SocketChannel channel = SocketChannel.open();
channel.configureBlocking(false);

boolean connected = channel.connect(new InetSocketAddress(host, port));

if (!connected) {
    channel.register(selector, SelectionKey.OP_CONNECT, state);
} else {
    channel.register(selector, SelectionKey.OP_READ, state);
}
```

Handle connect:

```java
private static void handleConnect(SelectionKey key) throws IOException {
    SocketChannel channel = (SocketChannel) key.channel();

    if (channel.finishConnect()) {
        key.interestOps(SelectionKey.OP_READ);
    }
}
```

Jika `finishConnect()` gagal, exception akan dilempar.

State transition:

```text
CONNECTING -> CONNECTED -> READING/WRITING -> CLOSING -> CLOSED
```

---

## 14. Full Minimal NIO Echo Server

Contoh ini bukan production-ready, tapi cukup untuk memahami mechanics.

```java
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.StandardSocketOptions;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;

public final class NioEchoServer {
    private static final int READ_BUFFER_SIZE = 64 * 1024;

    static final class ConnectionState {
        final SocketChannel channel;
        final ByteBuffer readBuffer = ByteBuffer.allocate(READ_BUFFER_SIZE);
        final Deque<ByteBuffer> writeQueue = new ArrayDeque<>();

        boolean closingAfterWrite;

        ConnectionState(SocketChannel channel) {
            this.channel = channel;
        }
    }

    public static void main(String[] args) throws IOException {
        int port = 8080;

        try (Selector selector = Selector.open();
             ServerSocketChannel server = ServerSocketChannel.open()) {

            server.configureBlocking(false);
            server.setOption(StandardSocketOptions.SO_REUSEADDR, true);
            server.bind(new InetSocketAddress(port), 1024);
            server.register(selector, SelectionKey.OP_ACCEPT);

            System.out.println("NIO echo server listening on port " + port);

            while (true) {
                selector.select();

                Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();

                while (iterator.hasNext()) {
                    SelectionKey key = iterator.next();
                    iterator.remove();

                    if (!key.isValid()) {
                        continue;
                    }

                    try {
                        if (key.isAcceptable()) {
                            handleAccept(selector, key);
                        }

                        if (key.isReadable()) {
                            handleRead(key);
                        }

                        if (key.isWritable()) {
                            handleWrite(key);
                        }
                    } catch (IOException | RuntimeException ex) {
                        closeKey(key);
                    }
                }
            }
        }
    }

    private static void handleAccept(Selector selector, SelectionKey key) throws IOException {
        ServerSocketChannel server = (ServerSocketChannel) key.channel();

        while (true) {
            SocketChannel client = server.accept();

            if (client == null) {
                return;
            }

            client.configureBlocking(false);
            client.setOption(StandardSocketOptions.TCP_NODELAY, true);

            ConnectionState state = new ConnectionState(client);
            client.register(selector, SelectionKey.OP_READ, state);
        }
    }

    private static void handleRead(SelectionKey key) throws IOException {
        SocketChannel channel = (SocketChannel) key.channel();
        ConnectionState state = (ConnectionState) key.attachment();
        ByteBuffer buffer = state.readBuffer;

        int totalRead = 0;

        while (true) {
            int n = channel.read(buffer);

            if (n > 0) {
                totalRead += n;
                continue;
            }

            if (n == 0) {
                break;
            }

            if (n == -1) {
                closeKey(key);
                return;
            }
        }

        if (totalRead == 0) {
            return;
        }

        buffer.flip();

        ByteBuffer echo = ByteBuffer.allocate(buffer.remaining());
        echo.put(buffer);
        echo.flip();

        buffer.clear();

        state.writeQueue.add(echo);
        key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
    }

    private static void handleWrite(SelectionKey key) throws IOException {
        SocketChannel channel = (SocketChannel) key.channel();
        ConnectionState state = (ConnectionState) key.attachment();

        while (!state.writeQueue.isEmpty()) {
            ByteBuffer current = state.writeQueue.peek();

            channel.write(current);

            if (current.hasRemaining()) {
                break;
            }

            state.writeQueue.remove();
        }

        if (state.writeQueue.isEmpty()) {
            key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);

            if (state.closingAfterWrite) {
                closeKey(key);
            }
        }
    }

    private static void closeKey(SelectionKey key) {
        try {
            key.cancel();
            key.channel().close();
        } catch (IOException ignored) {
            // closing path should not throw further
        }
    }
}
```

### 14.1 Apa yang contoh ini belum tangani?

Contoh echo server di atas belum production-grade karena:

1. Tidak punya frame protocol.
2. Tidak punya max input size.
3. Tidak punya idle timeout.
4. Tidak punya write queue limit.
5. Tidak punya backpressure ke reader.
6. Tidak punya metrics.
7. Tidak punya TLS.
8. Tidak punya graceful shutdown.
9. Tidak punya bounded worker pool.
10. Tidak punya per-client rate limiting.

Tetapi mechanics NIO-nya sudah terlihat.

---

## 15. Production-Grade NIO Server Architecture

### 15.1 Komponen

```text
NioServer
├── Acceptor/EventLoop
├── Selector
├── ConnectionRegistry
├── ProtocolDecoder
├── ProtocolEncoder
├── WorkerPool
├── TimeoutManager
├── BackpressurePolicy
├── Metrics
└── ShutdownCoordinator
```

### 15.2 Flow

```text
client connects
    ↓
ServerSocketChannel OP_ACCEPT
    ↓
accept SocketChannel
    ↓
register OP_READ with ConnectionState
    ↓
read bytes into buffer
    ↓
decode frames
    ↓
dispatch request to worker
    ↓
worker produce response
    ↓
enqueue response to connection state
    ↓
enable OP_WRITE
    ↓
flush queue
    ↓
disable OP_WRITE when queue empty
```

### 15.3 Thread ownership

A clean design defines ownership:

| Resource | Owner |
|---|---|
| Selector | Event loop thread |
| SelectionKey interest ops | Event loop thread, or via safe task queue + wakeup |
| SocketChannel read/write | Event loop thread |
| ConnectionState I/O buffers | Event loop thread |
| Business processing | Worker thread |
| Response enqueue | Usually event loop task queue |
| Metrics counters | thread-safe counters |

Do not let random worker threads write directly to `SocketChannel` unless you deliberately design synchronization and wakeup behavior.

---

## 16. Cross-Thread Communication dengan Event Loop

Misalnya worker selesai memproses request dan ingin mengirim response.

Jangan langsung:

```java
state.channel.write(response); // from worker thread
```

Lebih aman:

```java
eventLoop.execute(() -> {
    state.writeQueue.add(response);
    key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
});
```

Event loop punya task queue:

```java
final Queue<Runnable> pendingTasks = new ConcurrentLinkedQueue<>();

void execute(Runnable task) {
    pendingTasks.add(task);
    selector.wakeup();
}
```

Di loop:

```java
selector.select();
runPendingTasks();
processSelectedKeys();
```

Kenapa `selector.wakeup()`?

Karena event loop mungkin sedang blocking di `select()`. `wakeup()` membuatnya bangun untuk memproses task baru.

---

## 17. Backpressure di NIO

### 17.1 Problem

Jika peer lambat membaca, write queue bisa membesar.

Contoh:

```text
client A: cepat baca
client B: lambat baca
server tetap produce response untuk client B
writeQueue client B tumbuh
heap naik
GC pressure naik
OOM
```

### 17.2 Policy

Setiap connection perlu limit:

```java
final long maxQueuedBytes = 8L * 1024 * 1024; // 8 MB
long queuedBytes;
```

Saat enqueue:

```java
if (state.queuedBytes + response.remaining() > maxQueuedBytes) {
    closeConnectionOrApplyBackpressure(state);
}
```

Opsi policy:

| Policy | Cocok untuk |
|---|---|
| Close slow client | protocol sederhana, public edge |
| Stop reading | peer-specific backpressure |
| Drop message | telemetry/non-critical stream |
| Fail request | request-response protocol |
| Apply rate limit | fairness antar client |
| Move to disk spool | large transfer tertentu |

### 17.3 Stop reading strategy

Jika write queue terlalu besar:

```java
key.interestOps(key.interestOps() & ~SelectionKey.OP_READ);
```

Artinya:

```text
Jangan baca request baru dari client ini sampai queue turun.
```

Saat queue turun:

```java
key.interestOps(key.interestOps() | SelectionKey.OP_READ);
```

Ini backpressure internal.

---

## 18. Timeout dan Idle Connection

Non-blocking server tidak otomatis timeout.

Kamu harus track waktu:

```java
long lastReadNanos;
long lastWriteNanos;
long createdNanos;
```

Periodically:

```java
long now = System.nanoTime();

for (ConnectionState state : connections) {
    if (now - state.lastReadNanos > idleTimeoutNanos) {
        close(state);
    }
}
```

Jenis timeout:

| Timeout | Makna |
|---|---|
| Accept overload timeout | backlog terlalu penuh |
| Connect timeout | client connect tidak selesai |
| Read idle timeout | client tidak mengirim data |
| Frame assembly timeout | client kirim header/body terlalu lambat |
| Write timeout | peer tidak membaca response |
| Total request timeout | request terlalu lama |
| Graceful close timeout | menunggu flush terlalu lama |

Slowloris defense terutama membutuhkan:

```text
max frame size
read idle timeout
minimum read progress
frame assembly timeout
max connection count
max queued bytes
```

---

## 19. Error Handling

### 19.1 Error bukan selalu bug

Di networking, error normal:

```text
Connection reset by peer
Broken pipe
EOF
Timeout
Cancelled key
Closed channel
Protocol violation
Malformed frame
```

### 19.2 Rule

Connection-level error jangan menjatuhkan server.

Pola:

```java
try {
    handleKey(key);
} catch (ProtocolException ex) {
    closeKey(key);
} catch (IOException ex) {
    closeKey(key);
} catch (RuntimeException ex) {
    closeKey(key);
}
```

Tetapi bug internal serius harus tetap terlihat via logs/metrics.

### 19.3 Close path harus idempotent

```java
private static void closeKey(SelectionKey key) {
    if (key == null) {
        return;
    }

    try {
        key.cancel();
    } catch (RuntimeException ignored) {
    }

    try {
        key.channel().close();
    } catch (IOException ignored) {
    }
}
```

`cancel()` menandai key tidak valid. Channel close juga membuat key invalid.

---

## 20. Interest Ops State Machine

Interest ops harus berubah sesuai state.

### 20.1 Typical server connection

```text
OPEN
  interest: OP_READ

READING_REQUEST
  interest: OP_READ

PROCESSING
  interest: optional OP_READ off if only one in-flight request allowed

HAS_RESPONSE
  interest: OP_READ | OP_WRITE
  or OP_WRITE only if backpressure to reader

WRITE_QUEUE_EMPTY
  interest: OP_READ

CLOSING_AFTER_WRITE
  interest: OP_WRITE

CLOSED
  key cancelled, channel closed
```

### 20.2 Why not always read?

Jika protocol hanya mengizinkan satu request aktif per connection:

```text
read request -> process -> respond -> read next request
```

Maka selama `PROCESSING`, kamu bisa disable `OP_READ` untuk mencegah pipelining yang tidak didukung.

Jika protocol mendukung pipelining/multiplexing, desain state harus lebih kompleks.

---

## 21. NIO dan HTTP Server Framework

Framework seperti Netty menyembunyikan banyak detail, tapi mental modelnya mirip:

| Raw NIO | Netty-like concept |
|---|---|
| `Selector` | EventLoop |
| `SocketChannel` | Channel |
| `SelectionKey` | Channel registration |
| `ByteBuffer` | ByteBuf |
| Attachment state | Channel attributes / pipeline context |
| Decoder function | ChannelInboundHandler decoder |
| Encoder function | ChannelOutboundHandler encoder |
| Write queue | outbound buffer |
| Worker pool | event executor group |
| `OP_READ` toggling | auto-read/backpressure |

Jika kamu paham raw NIO, kamu akan lebih mudah memahami kenapa Netty punya:

```text
EventLoopGroup
ChannelPipeline
ByteBuf
ChannelFuture
ChannelHandler
autoRead
writeAndFlush
```

---

## 22. NIO vs Virtual Threads

Sejak virtual threads, banyak orang bertanya:

```text
Apakah NIO selector masih perlu?
```

Jawaban realistis:

```text
Masih perlu untuk beberapa kasus, tetapi tidak selalu perlu.
```

### 22.1 Blocking I/O + virtual threads

Dengan virtual threads:

```java
try (Socket socket = serverSocket.accept()) {
    handle(socket);
}
```

bisa scalable untuk banyak blocking I/O karena virtual thread murah dibanding platform thread.

Cocok jika:

```text
protocol sederhana
logic linear
connection count moderate/high
ingin maintainability tinggi
tidak butuh event-loop level control
```

### 22.2 Raw NIO selector

Cocok jika:

```text
connection sangat banyak
latency jitter penting
perlu explicit backpressure
perlu custom protocol high-throughput
ingin mengontrol buffer dan write queue detail
membangun framework/server/proxy/gateway
```

### 22.3 Framework event loop

Cocok jika:

```text
butuh production-grade network stack
tidak ingin implement selector sendiri
butuh TLS, HTTP, pooling, codec, metrics
```

Prinsip:

```text
Raw NIO adalah ilmu fondasi.
Untuk production, sering lebih baik memakai framework matang.
```

---

## 23. Scattering dan Gathering I/O

`SocketChannel` mendukung:

```java
long read(ByteBuffer[] dsts)
long write(ByteBuffer[] srcs)
```

### 23.1 Scattering read

Membaca ke banyak buffer:

```java
ByteBuffer header = ByteBuffer.allocate(8);
ByteBuffer body = ByteBuffer.allocate(1024);

long n = channel.read(new ByteBuffer[]{header, body});
```

Use case:

```text
header fixed-size
body separate buffer
```

### 23.2 Gathering write

Menulis dari banyak buffer:

```java
ByteBuffer header = encodeHeader(payloadLength);
ByteBuffer body = ByteBuffer.wrap(payload);

channel.write(new ByteBuffer[]{header, body});
```

Use case:

```text
hindari copy header + body ke buffer gabungan
```

Tetap harus handle partial write:

```text
gathering write tidak menjamin semua buffer habis tertulis.
```

---

## 24. Socket Options yang Relevan

Beberapa socket options umum:

| Option | Makna |
|---|---|
| `SO_REUSEADDR` | reuse local address |
| `SO_RCVBUF` | receive buffer size |
| `SO_SNDBUF` | send buffer size |
| `TCP_NODELAY` | disable Nagle |
| `SO_KEEPALIVE` | TCP keepalive |
| `SO_LINGER` | close behavior |

Contoh:

```java
client.setOption(StandardSocketOptions.TCP_NODELAY, true);
client.setOption(StandardSocketOptions.SO_KEEPALIVE, true);
```

Catatan:

1. Socket option bukan magic performance fix.
2. OS bisa membatasi nilai buffer.
3. `TCP_NODELAY` mengurangi latency untuk small writes, tapi bisa meningkatkan packet overhead.
4. `SO_KEEPALIVE` bukan pengganti application heartbeat.
5. Read/write timeout lebih kompleks pada NIO karena operation non-blocking; biasanya kamu implement sendiri via timestamp.

---

## 25. NIO Selector Performance Notes

### 25.1 Jangan allocate terus di event loop

Buruk:

```java
ByteBuffer buffer = ByteBuffer.allocate(8192); // tiap read event
channel.read(buffer);
```

Baik:

```java
state.readBuffer
```

Reuse buffer per connection.

### 25.2 Jangan parse terlalu berat di event loop

Jika parse JSON besar dilakukan di event loop:

```text
semua connection lain ikut tertahan.
```

Solusi:

```text
event loop hanya decode frame
worker parse/process
```

Namun hati-hati: worker handoff juga cost.

### 25.3 Jangan log berlebihan

Synchronous logging di event loop bisa menghancurkan latency.

Gunakan:

```text
async logging
sampling
metrics counter
structured compact logs
```

### 25.4 Jangan selalu wakeup

`selector.wakeup()` terlalu sering juga overhead.

Gunakan task queue dengan batching.

### 25.5 Jangan pakai satu event loop untuk semua jika workload besar

Architecture umum:

```text
boss event loop: accept
worker event loops: read/write accepted channels
business worker pool: CPU/blocking work
```

Raw implementation multi-selector lebih rumit, tapi konsepnya penting.

---

## 26. Multi-Reactor Pattern

Single reactor:

```text
1 selector handles accept + all I/O
```

Cocok untuk:

```text
learning
small server
low connection count
```

Multi-reactor:

```text
boss selector:
    accept

worker selector 1:
    client subset A

worker selector 2:
    client subset B

worker selector N:
    client subset N
```

Flow:

```text
boss accepts connection
assign to worker event loop
worker registers channel to its selector
worker handles read/write
```

Important invariant:

```text
Channel should be registered and accessed by its owning event loop thread.
```

Untuk transfer antar thread, gunakan task queue + `selector.wakeup()`.

---

## 27. Protocol State Machine Example

Misalnya protocol request-response:

```text
Client sends:
    length + command

Server responds:
    length + result
```

State per connection:

```java
enum ConnPhase {
    READING_HEADER,
    READING_BODY,
    PROCESSING,
    WRITING_RESPONSE,
    CLOSING,
    CLOSED
}
```

Transition:

```text
READING_HEADER
    enough 4 bytes -> READING_BODY

READING_BODY
    enough body -> PROCESSING

PROCESSING
    worker result ready -> WRITING_RESPONSE

WRITING_RESPONSE
    queue empty -> READING_HEADER

any state
    EOF/error/protocol violation -> CLOSING/CLOSED
```

Kenapa explicit state penting?

Karena bugs di network server sering terjadi saat implicit assumption:

```text
"Setelah read pasti request lengkap"
"Setelah write pasti response selesai"
"Client pasti tidak pipelining"
"Client pasti tidak kirim frame terlalu besar"
"Connection close pasti bersih"
```

---

## 28. Testing NIO Server

### 28.1 Unit test decoder

Decoder harus dites terpisah dari socket.

Test cases:

```text
header partial
body partial
multiple frames in one buffer
invalid negative length
length too large
zero-length frame
frame split byte-by-byte
random chunking
```

### 28.2 Integration test socket

Test:

```text
single client
many clients
slow client
client sends partial frame slowly
client closes mid-frame
server sends large response
client does not read response
invalid protocol
concurrent clients
```

### 28.3 Fault injection

Simulate:

```text
connection reset
partial write
selector wakeup race
worker queue full
timeout
large payload
GC pressure
```

### 28.4 Soak test

Run long enough to catch:

```text
memory leak
file descriptor leak
write queue growth
selector busy loop
unbounded task queue
connection leak
```

---

## 29. Observability

Minimal metrics:

```text
active_connections
accepted_connections_total
closed_connections_total
read_bytes_total
written_bytes_total
frames_in_total
frames_out_total
protocol_errors_total
io_errors_total
write_queue_bytes
event_loop_iteration_duration
selector_selected_keys
worker_queue_depth
idle_timeouts_total
backpressure_events_total
```

Useful logs:

```text
connection accepted
connection closed with reason
protocol violation
timeout
write queue exceeded
event loop fatal error
worker task rejected
```

Avoid logging:

```text
full payload body
password/token/session
binary data unbounded
one log per packet at high traffic
```

Tracing:

```text
connection id
request id
correlation id
remote address
protocol command
frame length
processing duration
queue duration
write duration
```

---

## 30. Security Notes

NIO tidak otomatis membuat server aman.

Checklist:

1. Limit max frame size.
2. Limit active connections.
3. Limit per-IP connections.
4. Limit queued write bytes.
5. Apply idle timeout.
6. Apply frame assembly timeout.
7. Validate protocol version.
8. Validate command type.
9. Do not deserialize untrusted Java objects.
10. Do not allocate buffer based solely on client-provided length.
11. Avoid logging sensitive payload.
12. Close on protocol violation.
13. Use TLS if network boundary untrusted.
14. Handle slowloris.
15. Handle malformed frames.
16. Backpressure worker queue.

Dangerous code:

```java
int length = buffer.getInt();
ByteBuffer body = ByteBuffer.allocate(length);
```

Safe approach:

```java
if (length < 0 || length > MAX_FRAME_SIZE) {
    throw new ProtocolException("Invalid frame length");
}
```

---

## 31. Failure Model

| Failure | Cause | Symptom | Defense |
|---|---|---|---|
| Busy loop | `OP_WRITE` always enabled | CPU 100% | enable write only when queue non-empty |
| Connection leak | close path incomplete | active connection grows | idempotent close and registry cleanup |
| Buffer corruption | shared buffer between clients | random protocol errors | per-connection buffer |
| Lost partial frame | `clear()` after partial decode | decode failure | `compact()` remaining bytes |
| OOM | unbounded write queue | heap grows | queue byte limit |
| Slowloris | client sends very slowly | connection occupied | idle/frame timeout |
| Event loop stall | blocking work in loop | all clients slow | worker pool handoff |
| Key repeated | selected key not removed | repeated processing | `iterator.remove()` |
| Race condition | worker mutates key directly | inconsistent ops | event loop task queue |
| Protocol abuse | huge length field | allocation spike | max frame size |
| Partial write bug | assumes write complete | truncated response | preserve buffer until consumed |
| EOF bug | treats `0` as close | random disconnect | close only on `-1` |
| Backpressure failure | read continues despite slow write | queue grows | disable OP_READ or close |

---

## 32. Decision Matrix

| Situation | Better option |
|---|---|
| Simple internal tool with few connections | Blocking socket |
| Many connections, simple request-response, maintainability priority | Virtual threads + blocking I/O |
| Custom high-throughput protocol | NIO/event loop |
| Building gateway/proxy/server framework | NIO or mature framework |
| HTTP server/client production | Use established framework/client |
| Need TLS, HTTP/2, pooling, metrics | Framework |
| Need raw protocol learning/control | Raw NIO |
| Need one thread per many sockets | Selector |
| CPU-heavy per request | Event loop + worker pool |
| Blocking DB call per request | Virtual threads or worker pool, not event loop |

---

## 33. Anti-Patterns

### 33.1 One global buffer

```java
static final ByteBuffer BUFFER = ByteBuffer.allocate(8192);
```

Salah untuk banyak connection karena buffer state mutable.

### 33.2 Always `OP_WRITE`

```java
channel.register(selector, OP_READ | OP_WRITE);
```

Bisa menyebabkan busy loop.

### 33.3 Decode assumes complete message

```java
int len = buffer.getInt();
byte[] body = new byte[len];
buffer.get(body);
```

Tanpa cek `remaining()`.

### 33.4 Blocking inside event loop

```java
String data = Files.readString(path);
```

Jika file besar atau storage lambat, semua connection tertahan.

### 33.5 Unbounded queue

```java
writeQueue.add(response);
```

Tanpa limit.

### 33.6 Worker writes directly

```java
workerPool.submit(() -> channel.write(buffer));
```

Bisa race dengan event loop.

### 33.7 Treating `select()` return as event count guarantee

`select()` return jumlah key ready, tetapi readiness bisa berubah. Tetap handle `0`, null accept, partial operations, invalid key.

---

## 34. Practical Checklist

Sebelum membuat NIO server production-grade, pastikan:

### API Mechanics

- [ ] Semua selectable channel di `configureBlocking(false)`.
- [ ] Selected key selalu di-remove dari selected set.
- [ ] `SelectionKey.isValid()` dicek sebelum operasi.
- [ ] `OP_WRITE` hanya enabled saat write queue tidak kosong.
- [ ] `read() == -1` close, `read() == 0` bukan close.
- [ ] Partial write ditangani.
- [ ] Partial frame ditangani.
- [ ] `ByteBuffer.flip/compact` benar.

### State

- [ ] Per-connection state jelas.
- [ ] Buffer tidak dishare antar connection.
- [ ] Write queue bounded.
- [ ] Close state idempotent.
- [ ] Timeout timestamp tersedia.

### Protocol

- [ ] Frame size dibatasi.
- [ ] Protocol violation close connection.
- [ ] Decoder tahan fragmented input.
- [ ] Decoder tahan multiple frames dalam satu read.
- [ ] Payload validation jelas.

### Concurrency

- [ ] Event loop tidak blocking.
- [ ] Worker handoff bounded.
- [ ] Cross-thread update via event-loop task queue.
- [ ] `selector.wakeup()` digunakan saat perlu.

### Operations

- [ ] Metrics tersedia.
- [ ] Logs punya close reason.
- [ ] Slow client terlihat.
- [ ] Backpressure event terlihat.
- [ ] Graceful shutdown tersedia.
- [ ] Soak test dilakukan.

---

## 35. Latihan

### Latihan 1 — Implement Length-Prefix Echo Server

Buat server NIO yang menerima frame:

```text
4-byte length + UTF-8 payload
```

Server mengembalikan:

```text
4-byte length + uppercase(payload)
```

Rules:

1. Max frame size 1 MB.
2. Partial frame harus aman.
3. Multiple frame dalam satu read harus diproses.
4. Partial write harus aman.
5. `OP_WRITE` hanya aktif saat queue tidak kosong.

---

### Latihan 2 — Slow Client Defense

Tambahkan:

1. Idle timeout 30 detik.
2. Frame assembly timeout 10 detik.
3. Write queue max 8 MB.
4. Close reason logging.

---

### Latihan 3 — Worker Pool Handoff

Ubah server agar:

1. Event loop hanya decode frame.
2. Business logic berjalan di bounded worker pool.
3. Worker tidak langsung menulis ke channel.
4. Worker enqueue response lewat event-loop task queue.
5. Jika worker queue penuh, request ditolak atau connection ditutup.

---

### Latihan 4 — Backpressure

Jika write queue > 4 MB:

```text
disable OP_READ
```

Jika write queue < 1 MB:

```text
enable OP_READ
```

Uji dengan client yang tidak membaca response.

---

### Latihan 5 — Protocol Fuzzing

Buat test yang mengirim:

1. Header 1 byte per write.
2. Body 1 byte per write.
3. Frame length negatif.
4. Frame length terlalu besar.
5. 10 frame dalam satu write.
6. Close connection di tengah frame.

---

## 36. Ringkasan

NIO networking bukan sekadar API alternatif untuk socket. Ia adalah model arsitektur berbeda.

Blocking socket:

```text
thread waits for connection I/O
```

NIO selector:

```text
event loop waits for readiness across many channels
```

Konsep kunci:

1. `ServerSocketChannel` menerima connection.
2. `SocketChannel` membaca/menulis TCP stream.
3. `Selector` memultiplex readiness banyak channel.
4. `SelectionKey` menyimpan registration, interest ops, ready ops, dan attachment.
5. TCP tetap byte stream, sehingga framing wajib.
6. Read bisa partial.
7. Write bisa partial.
8. `OP_WRITE` harus dinyalakan hanya saat ada pending data.
9. Event loop tidak boleh blocking.
10. State per connection adalah pusat correctness.
11. Backpressure dan timeout harus didesain eksplisit.
12. Raw NIO memberi kontrol tinggi, tapi production server sering lebih aman memakai framework matang.

Jika Part 020 mengajarkan cara mendesain protocol TCP yang benar, Part 021 mengajarkan bagaimana menjalankan banyak protocol connection dalam satu atau beberapa event loop tanpa kehilangan correctness.

---

## 37. Koneksi ke Part Berikutnya

Part berikutnya membahas UDP dan datagram.

TCP/NIO yang kita bahas di part ini punya karakter:

```text
connection-oriented
ordered
reliable byte stream
requires framing
```

UDP berbeda:

```text
connectionless
message/datagram boundary preserved
loss possible
reordering possible
duplication possible
no built-in reliability
```

Di Part 022 kita akan membahas:

```text
UDP, Datagram, Multicast, dan Kapan Tidak Boleh Memakai TCP
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 020 — Networking II: TCP Framing, Protocol Design, Partial Read/Write, dan Backpressure](./learn-java-io-nio-networking-data-transfer-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 022 — UDP, Datagram, Multicast, dan Kapan Tidak Boleh Memakai TCP](./learn-java-io-nio-networking-data-transfer-part-022.md)
