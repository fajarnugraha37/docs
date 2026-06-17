# Part 020 — Networking II: TCP Framing, Protocol Design, Partial Read/Write, dan Backpressure

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-020.md`  
> Level: Advance  
> Prasyarat: Part 000–019, terutama mental model byte/stream, buffering, binary framing, dan socket dasar.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa TCP adalah **byte stream**, bukan message transport.
2. Mendesain framing protocol sendiri di atas TCP secara aman dan evolvable.
3. Menangani partial read, partial write, EOF, timeout, dan connection close secara eksplisit.
4. Membedakan application protocol boundary dari network packet boundary.
5. Mendesain request/response protocol sederhana dengan state machine.
6. Menerapkan max frame size, timeout, heartbeat, dan backpressure untuk mencegah resource exhaustion.
7. Memahami kenapa bug networking sering bukan bug socket, tetapi bug protocol.
8. Membedakan blocking I/O sederhana, non-blocking I/O, dan virtual-thread-friendly blocking I/O dari sisi desain protocol.
9. Membuat kerangka implementasi TCP protocol yang tidak bergantung pada asumsi “sekali read pasti dapat satu message”.
10. Menghasilkan decision framework untuk memilih delimiter framing, length-prefix framing, fixed-size framing, atau format hybrid.

---

## 2. Referensi Resmi dan Catatan Versi

Materi ini mengacu pada dokumentasi resmi Java/JDK untuk:

- `java.net.Socket`
- `java.net.ServerSocket`
- `java.net.SocketOptions`
- `java.io.InputStream`
- `java.io.OutputStream`
- `java.nio.ByteBuffer`
- `java.nio.channels.SocketChannel`
- `java.nio.channels.ServerSocketChannel`
- `java.nio.channels.Selector`

Dalam dokumentasi resmi Java, `Socket` adalah endpoint komunikasi antara dua mesin dan mengimplementasikan `Closeable`/`AutoCloseable`. `ServerSocket` menunggu connection request lalu menghasilkan `Socket` hasil accept. Dari sisi aplikasi, socket memberikan stream input/output, tetapi semantik message tetap harus didefinisikan oleh protocol aplikasi.

Prinsip penting:

> Java memberi kamu byte stream. Java tidak memberi kamu message boundary. Message boundary adalah tanggung jawab protocol-mu.

---

## 3. Mental Model Utama: TCP adalah Conveyor Belt Byte

Bayangkan TCP sebagai conveyor belt panjang yang membawa byte secara berurutan.

Aplikasi A menulis:

```text
HELLO
WORLD
```

Aplikasi B tidak dijamin membaca dalam potongan yang sama. B bisa melihat:

```text
HEL
LOWORLD
```

atau:

```text
HELLOWORLD
```

atau:

```text
H
E
L
L
O
W
O
R
L
D
```

Semua itu valid.

Kenapa?

Karena TCP menjamin hal-hal ini:

1. byte dikirim secara ordered;
2. byte yang diterima tidak corrupt secara TCP-level;
3. byte stream reliable selama connection hidup;
4. retransmission dilakukan oleh TCP stack.

TCP tidak menjamin:

1. satu `write()` di sender sama dengan satu `read()` di receiver;
2. satu request aplikasi sama dengan satu packet;
3. satu packet sama dengan satu message;
4. receiver tahu kapan satu message selesai tanpa protocol;
5. receiver tahu ukuran message kecuali diberi tahu;
6. aplikasi bebas dari timeout, deadlock, overload, atau memory exhaustion.

---

## 4. Kesalahan Fundamental: “Sticky Packet” Misconception

Di banyak pembahasan networking, orang sering berkata “TCP sticky packet problem”. Istilah ini kurang tepat.

Yang sebenarnya terjadi:

> TCP tidak pernah menjanjikan packet boundary ke aplikasi. Jadi ketika beberapa message terlihat “menempel”, itu bukan TCP melanggar kontrak. Itu aplikasi yang salah menganggap TCP membawa message.

Contoh salah:

```java
byte[] buffer = new byte[1024];
int n = in.read(buffer);
String message = new String(buffer, 0, n, StandardCharsets.UTF_8);
handle(message);
```

Kode ini salah jika protocol mengharapkan satu `read()` = satu message.

Karena `read()` bisa menghasilkan:

- setengah message;
- satu message penuh;
- satu setengah message;
- beberapa message sekaligus;
- 0 byte pada beberapa abstraction tertentu;
- `-1` saat EOF.

Correctness-nya bukan ditentukan oleh ukuran buffer, tetapi oleh framing protocol.

---

## 5. Protocol Boundary vs Transport Boundary

Ada beberapa boundary yang harus dibedakan:

| Boundary | Siapa yang menentukan | Contoh |
|---|---:|---|
| Application message boundary | Protocol aplikasi | satu request login, satu frame telemetry |
| Encoding boundary | Format data | UTF-8, JSON, binary, protobuf |
| Buffer boundary | Program/JVM | `byte[8192]`, `ByteBuffer` |
| TCP segment boundary | OS/TCP stack | segment 1460 bytes, MSS |
| IP packet boundary | Network layer | packet network |
| Ethernet frame boundary | Link layer | frame NIC |

Aplikasi Java hanya boleh bergantung pada **application protocol boundary** yang ia definisikan sendiri.

Jangan bergantung pada:

- packet boundary;
- segment boundary;
- ukuran `read()`;
- timing network;
- `flush()` sebagai end-of-message;
- connection close sebagai framing, kecuali protocol memang one-shot.

---

## 6. Empat Keluarga Framing Protocol

Framing adalah cara protocol memberi tahu receiver: “satu message selesai di sini.”

Ada empat pendekatan besar:

1. fixed-size frame;
2. delimiter-based frame;
3. length-prefix frame;
4. header-body frame.

Masing-masing punya trade-off.

---

## 7. Fixed-Size Frame

Fixed-size frame berarti setiap message memiliki ukuran tetap.

Contoh:

```text
[32 bytes command]
[32 bytes command]
[32 bytes command]
```

Kelebihan:

- parsing mudah;
- tidak perlu delimiter;
- tidak perlu membaca length field;
- cocok untuk protocol sangat sederhana;
- predictable memory.

Kekurangan:

- boros jika payload kecil;
- tidak fleksibel;
- sulit evolusi;
- field variable-length menjadi awkward;
- message besar tidak cocok.

Use case:

- sensor frame kecil;
- binary telemetry tetap;
- embedded protocol;
- fixed record file/network hybrid.

Contoh desain:

```text
offset  size  field
0       4     magic
4       1     version
5       1     type
6       2     flags
8       8     timestamp
16      16    payload fixed
```

Parsing fixed frame:

```java
static byte[] readExactly(InputStream in, int size) throws IOException {
    byte[] data = new byte[size];
    int offset = 0;
    while (offset < size) {
        int n = in.read(data, offset, size - offset);
        if (n == -1) {
            throw new EOFException("connection closed while reading frame");
        }
        offset += n;
    }
    return data;
}
```

Invariant:

> Jika frame berukuran tetap 32 byte, parser tidak boleh memanggil handler sebelum tepat 32 byte terkumpul.

---

## 8. Delimiter-Based Frame

Delimiter framing berarti message berakhir ketika delimiter tertentu ditemukan.

Contoh umum:

```text
COMMAND arg1 arg2\n
COMMAND arg1 arg2\n
```

Kelebihan:

- manusia mudah membaca;
- cocok untuk CLI-like protocol;
- mudah debug via telnet/netcat;
- cocok untuk line-based text protocol.

Kekurangan:

- payload tidak boleh mengandung delimiter kecuali escaping;
- delimiter bisa terpotong di antara read;
- perlu max line length;
- raw binary payload sulit;
- encoding boundary harus jelas.

Protocol seperti SMTP/Redis text mode/HTTP header historically banyak memakai line-oriented parsing.

Contoh sederhana:

```java
static String readLineUtf8(InputStream in, int maxBytes) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    while (true) {
        int b = in.read();
        if (b == -1) {
            if (out.size() == 0) {
                return null;
            }
            throw new EOFException("connection closed before newline");
        }
        if (b == '\n') {
            break;
        }
        if (b != '\r') {
            out.write(b);
        }
        if (out.size() > maxBytes) {
            throw new IOException("line too long: " + out.size());
        }
    }
    return out.toString(StandardCharsets.UTF_8);
}
```

Hal penting:

- `readLine()` bawaan `BufferedReader` bisa berguna, tetapi kamu tetap perlu batas ukuran;
- jangan membiarkan attacker mengirim line tanpa newline sepanjang 10 GB;
- delimiter framing perlu aturan escaping jika payload bisa mengandung delimiter;
- untuk text protocol, charset harus eksplisit.

Anti-pattern:

```java
BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
String line = reader.readLine(); // tanpa max length, charset default, timeout tidak jelas
```

Masalah:

- charset default bisa beda environment;
- line terlalu panjang bisa menghabiskan memory;
- `readLine()` bisa block lama tanpa timeout;
- EOF sebelum newline perlu dibedakan dari empty line.

---

## 9. Length-Prefix Frame

Length-prefix framing adalah pendekatan paling umum untuk binary protocol.

Format:

```text
[4 bytes length][payload length bytes]
[4 bytes length][payload length bytes]
```

Contoh:

```text
00 00 00 05 48 45 4C 4C 4F
```

Artinya:

- length = 5;
- payload = `HELLO`.

Kelebihan:

- payload boleh binary apa pun;
- parsing jelas;
- tidak perlu escaping delimiter;
- receiver tahu berapa byte harus dibaca;
- cocok untuk JSON, Protobuf, Avro, CBOR, custom binary.

Kekurangan:

- harus memvalidasi length;
- length field bisa corrupt atau malicious;
- perlu endianness jelas;
- payload besar butuh streaming/chunking, jangan selalu allocate utuh;
- satu frame besar bisa menyebabkan head-of-line blocking.

Basic implementation:

```java
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

final class LengthPrefixedProtocol {
    private static final int HEADER_SIZE = 4;
    private static final int MAX_FRAME_SIZE = 16 * 1024 * 1024; // 16 MiB

    static void writeFrame(OutputStream out, byte[] payload) throws IOException {
        if (payload.length > MAX_FRAME_SIZE) {
            throw new IOException("payload too large: " + payload.length);
        }

        byte[] header = ByteBuffer.allocate(HEADER_SIZE)
                .order(ByteOrder.BIG_ENDIAN)
                .putInt(payload.length)
                .array();

        out.write(header);
        out.write(payload);
        out.flush();
    }

    static byte[] readFrame(InputStream in) throws IOException {
        byte[] header = readExactly(in, HEADER_SIZE);

        int length = ByteBuffer.wrap(header)
                .order(ByteOrder.BIG_ENDIAN)
                .getInt();

        if (length < 0 || length > MAX_FRAME_SIZE) {
            throw new IOException("invalid frame length: " + length);
        }

        return readExactly(in, length);
    }

    static byte[] readExactly(InputStream in, int size) throws IOException {
        byte[] data = new byte[size];
        int offset = 0;
        while (offset < size) {
            int n = in.read(data, offset, size - offset);
            if (n == -1) {
                throw new EOFException("connection closed: expected " + size + " bytes, got " + offset);
            }
            offset += n;
        }
        return data;
    }

    static void main(String[] args) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        writeFrame(out, "hello".getBytes(StandardCharsets.UTF_8));

        ByteArrayInputStream in = new ByteArrayInputStream(out.toByteArray());
        byte[] payload = readFrame(in);
        System.out.println(new String(payload, StandardCharsets.UTF_8));
    }
}
```

Critical invariant:

> Never trust length field from network.

Jika attacker mengirim:

```text
FF FF FF FF
```

`getInt()` menghasilkan `-1`. Jika parser tidak validasi, behavior bisa kacau.

Jika attacker mengirim:

```text
7F FF FF FF
```

Itu sekitar 2 GB. Jika kode langsung `new byte[length]`, process bisa OOM.

---

## 10. Header-Body Frame

Header-body framing adalah evolusi length-prefix yang lebih production-grade.

Format contoh:

```text
+----------------+----------------+
| magic 4 bytes  | version 1 byte |
+----------------+----------------+
| type 1 byte    | flags 2 bytes  |
+----------------+----------------+
| requestId 8 b  | length 4 bytes |
+----------------+----------------+
| checksum 4 b   | payload ...    |
+----------------+----------------+
```

Contoh layout:

| Field | Size | Purpose |
|---|---:|---|
| magic | 4 | validasi bahwa stream sesuai protocol |
| version | 1 | evolusi protocol |
| type | 1 | request, response, error, ping, pong |
| flags | 2 | compression, encryption marker, reserved |
| requestId | 8 | correlation/multiplexing sederhana |
| length | 4 | payload size |
| checksum | 4 | payload integrity application-level |
| payload | variable | encoded body |

Kenapa header berguna?

Karena saat protocol berkembang, kamu butuh:

- message type;
- versioning;
- request correlation;
- error frame;
- heartbeat;
- compression flag;
- checksum;
- feature negotiation;
- compatibility handling.

Contoh frame type:

```java
enum FrameType {
    REQUEST(1),
    RESPONSE(2),
    ERROR(3),
    PING(4),
    PONG(5),
    GOAWAY(6);

    final int code;

    FrameType(int code) {
        this.code = code;
    }
}
```

---

## 11. Partial Read

Partial read berarti receiver hanya mendapat sebagian byte yang dibutuhkan.

Contoh:

Sender menulis 100 bytes.

Receiver:

```java
byte[] buffer = new byte[100];
int n = in.read(buffer);
```

`n` bisa saja 17.

Bukan error. Itu normal.

Karena itu, jika kamu perlu tepat 100 bytes, buat loop:

```java
static void readFully(InputStream in, byte[] buffer, int offset, int length) throws IOException {
    int total = 0;
    while (total < length) {
        int n = in.read(buffer, offset + total, length - total);
        if (n == -1) {
            throw new EOFException("expected " + length + " bytes, got " + total);
        }
        total += n;
    }
}
```

Tetapi hati-hati: `readFully` bisa block selamanya jika peer tidak pernah mengirim cukup byte dan tidak menutup connection.

Karena itu perlu:

- socket read timeout;
- protocol timeout;
- max frame size;
- idle timeout;
- heartbeat;
- cancellation.

---

## 12. Partial Write

Pada blocking `OutputStream`, `write(byte[])` biasanya tampak seperti “menulis semua atau exception”. Namun secara konseptual di level OS/socket, write bisa partial, terutama di non-blocking channel.

Pada `SocketChannel` non-blocking:

```java
int written = channel.write(buffer);
```

`written` bisa:

- 0;
- sebagian dari remaining bytes;
- semua remaining bytes;
- exception jika connection bermasalah.

Karena itu, non-blocking write harus menyimpan sisa buffer.

Contoh pola:

```java
while (buffer.hasRemaining()) {
    int n = channel.write(buffer);
    if (n == 0) {
        // socket send buffer penuh; tunggu OP_WRITE
        break;
    }
}
```

Dalam event loop, jangan spin loop tanpa batas saat `write()` return 0. Itu CPU burn.

Invariant:

> Handler aplikasi hanya boleh menganggap frame terkirim setelah seluruh byte frame berhasil ditulis, bukan setelah satu kali pemanggilan `write()`.

---

## 13. EOF, Close, Half-Close, dan Abrupt Reset

Saat `InputStream.read()` return `-1`, artinya end-of-stream: peer sudah menutup sisi output-nya secara orderly.

Namun itu tidak selalu sama dengan “seluruh request valid sudah selesai”.

Contoh:

Jika protocol membutuhkan length 100 bytes dan baru 40 bytes diterima lalu EOF:

```text
expected: 100
received: 40
```

Itu **truncated frame**, bukan normal close.

Close semantics perlu dibedakan:

| Kondisi | Arti |
|---|---|
| EOF di boundary frame | peer selesai secara normal |
| EOF di tengah frame | data truncated/protocol error |
| SocketException: connection reset | peer/network abortive close |
| timeout | peer idle/slow/network stalled |
| application GOAWAY | graceful protocol shutdown |

Half-close:

- `shutdownOutput()` berarti local side selesai mengirim, tetapi masih bisa membaca;
- `shutdownInput()` berarti local side tidak akan membaca lagi;
- tidak semua protocol memakai half-close;
- banyak application protocol lebih baik memakai explicit frame seperti `GOAWAY`/`END`.

Jangan menggunakan connection close sebagai message delimiter untuk protocol long-lived.

Close-as-delimiter hanya masuk akal untuk one-shot transfer:

```text
client connects
client sends request
server sends all bytes
server closes connection
client treats EOF as end body
```

Itu pun punya risiko jika connection putus di tengah dan tidak ada length/checksum.

---

## 14. Timeout: Connect, Read, Write, Idle, Protocol

Timeout bukan detail optional. Timeout adalah bagian dari correctness.

Jenis timeout:

| Timeout | Tujuan |
|---|---|
| connect timeout | membatasi waktu membangun connection |
| read timeout | membatasi blocking read |
| write timeout | membatasi blocking write/flush |
| request timeout | membatasi total request lifecycle |
| idle timeout | menutup connection yang diam terlalu lama |
| handshake timeout | membatasi fase protocol awal |
| frame timeout | membatasi waktu menyelesaikan satu frame |

Di blocking `Socket`, read timeout bisa diatur dengan:

```java
socket.setSoTimeout(10_000);
```

Jika read timeout terjadi, Java melempar `SocketTimeoutException`.

Contoh:

```java
try {
    byte[] frame = readFrame(socket.getInputStream());
} catch (SocketTimeoutException e) {
    // peer terlalu lambat atau tidak mengirim data
    closeAsProtocolTimeout(socket, e);
}
```

Namun `setSoTimeout` bukan total request timeout. Ia biasanya berlaku untuk blocking read operation. Jika peer mengirim 1 byte setiap beberapa detik, read bisa terus maju sedikit demi sedikit. Untuk mencegah slowloris, perlu deadline total.

Contoh deadline:

```java
static byte[] readExactlyWithDeadline(InputStream in, int size, long deadlineNanos) throws IOException {
    byte[] data = new byte[size];
    int offset = 0;

    while (offset < size) {
        if (System.nanoTime() > deadlineNanos) {
            throw new SocketTimeoutException("deadline exceeded while reading frame");
        }
        int n = in.read(data, offset, size - offset);
        if (n == -1) {
            throw new EOFException("connection closed while reading");
        }
        offset += n;
    }
    return data;
}
```

Catatan: untuk real production, deadline perlu dikombinasikan dengan socket timeout agar thread tidak stuck lama dalam satu blocking read.

---

## 15. Slowloris Defense

Slowloris adalah pola serangan/masalah ketika peer membuka connection lalu mengirim data sangat lambat agar resource server tertahan.

Contoh:

```text
connect
send 1 byte
wait 30 seconds
send 1 byte
wait 30 seconds
...
```

Jika server punya thread-per-connection dan tidak punya timeout/batas frame, sedikit client bisa menghabiskan banyak thread.

Defense:

1. connect limit per IP/client;
2. max header/frame size;
3. read timeout;
4. request deadline;
5. idle timeout;
6. min data rate;
7. bounded connection pool;
8. bounded per-connection buffer;
9. close connection on protocol violation;
10. metrics untuk open connection dan slow read.

Protocol invariant:

> Satu connection tidak boleh bisa menahan resource tak terbatas hanya dengan mengirim byte sangat lambat.

---

## 16. Max Frame Size dan Memory Safety

Jika protocol memakai length-prefix, `maxFrameSize` wajib.

Contoh buruk:

```java
int length = in.readInt();
byte[] payload = new byte[length];
in.readFully(payload);
```

Masalah:

- length negatif;
- length sangat besar;
- allocation OOM;
- attacker bisa mengirim length besar tanpa payload;
- server menunggu selamanya.

Contoh lebih aman:

```java
static int validateLength(int length, int maxFrameSize) throws IOException {
    if (length < 0) {
        throw new IOException("negative frame length: " + length);
    }
    if (length > maxFrameSize) {
        throw new IOException("frame too large: " + length + " > " + maxFrameSize);
    }
    return length;
}
```

Tetapi untuk payload besar, lebih baik jangan satu frame raksasa. Gunakan chunking.

Contoh chunk protocol:

```text
START fileId totalSize checksum
CHUNK offset length checksum payload
CHUNK offset length checksum payload
END fileId checksum
```

Dengan chunking:

- memory bounded;
- resume bisa dilakukan;
- checksum per chunk;
- progress bisa dilaporkan;
- retry lebih murah.

---

## 17. Backpressure: Masalah yang Sering Tidak Terlihat di Happy Path

Backpressure adalah mekanisme agar producer tidak mengirim lebih cepat daripada consumer bisa memproses.

Tanpa backpressure:

```text
client sends 1 GB/s
server processes 20 MB/s
buffer grows
memory grows
GC pressure grows
latency grows
process dies
```

Backpressure bisa terjadi di beberapa layer:

1. OS receive buffer penuh;
2. TCP window mengecil;
3. application read melambat;
4. parsing queue penuh;
5. worker pool penuh;
6. downstream storage lambat;
7. response queue menumpuk;
8. socket send buffer penuh.

Dalam blocking I/O, backpressure kadang “terasa otomatis” karena `write()` bisa block. Namun itu bukan solusi lengkap, karena:

- thread bisa tertahan banyak;
- timeout belum tentu ada;
- memory queue bisa tetap tumbuh sebelum write;
- deadlock bisa terjadi jika dua sisi sama-sama menunggu.

Dalam non-blocking I/O, backpressure harus eksplisit:

- jangan selalu register `OP_WRITE` untuk semua connection;
- hanya register `OP_WRITE` saat ada pending outbound data;
- punya bounded outbound queue;
- stop reading saat queue penuh;
- resume reading saat queue turun;
- close connection jika peer terlalu lambat.

---

## 18. Bounded Queue sebagai Invariant

Setiap queue dalam data transfer harus bounded atau punya alasan kuat kenapa tidak.

Contoh buruk:

```java
Queue<byte[]> outbound = new ConcurrentLinkedQueue<>();
```

Jika producer lebih cepat daripada socket write, queue tumbuh tanpa batas.

Lebih aman:

```java
BlockingQueue<byte[]> outbound = new ArrayBlockingQueue<>(1024);
```

Tetapi bounded queue memaksa kamu menentukan behavior saat penuh:

1. block producer;
2. reject request;
3. drop message;
4. close connection;
5. apply priority;
6. spill to disk;
7. signal upstream.

Tidak ada pilihan universal. Pilihan tergantung domain.

Untuk regulatory/case-management style system, biasanya data loss tidak boleh diam-diam. Maka drop tanpa audit hampir selalu salah. Lebih baik:

- reject dengan error eksplisit;
- persist ke durable queue;
- mark retryable;
- emit audit trail;
- apply rate limiting.

---

## 19. Protocol State Machine

Protocol yang benar bukan sekadar loop `read -> handle -> write`.

Ia punya state.

Contoh simple request-response protocol:

```text
CONNECTED
  -> HANDSHAKE_REQUIRED
  -> READY
  -> READING_HEADER
  -> READING_PAYLOAD
  -> PROCESSING
  -> WRITING_RESPONSE
  -> READY
  -> CLOSING
  -> CLOSED
```

State machine membantu menjawab:

- apakah frame type ini valid di state ini?
- apakah request boleh dikirim sebelum handshake?
- apakah response boleh datang tanpa request?
- apakah payload boleh dikirim setelah error?
- apakah connection harus ditutup setelah protocol violation?
- apakah heartbeat valid saat upload berlangsung?

Contoh enum:

```java
enum ConnectionState {
    CONNECTED,
    HANDSHAKING,
    READY,
    READING_HEADER,
    READING_PAYLOAD,
    PROCESSING,
    WRITING,
    CLOSING,
    CLOSED
}
```

Contoh validation:

```java
static void requireState(ConnectionState actual, ConnectionState expected) throws IOException {
    if (actual != expected) {
        throw new IOException("protocol state violation: expected " + expected + ", got " + actual);
    }
}
```

Invariant:

> Protocol violation harus menghasilkan error deterministic, bukan parser masuk state ambigu.

---

## 20. Request/Response Correlation

Jika satu connection hanya memproses satu request pada satu waktu, correlation sederhana.

Tetapi jika protocol mengizinkan pipelining atau multiplexing, perlu request id.

Tanpa request id:

```text
REQ A
REQ B
RESP ?
RESP ?
```

Dengan request id:

```text
REQ id=101
REQ id=102
RESP id=102
RESP id=101
```

Header field `requestId` berguna untuk:

- correlation log;
- pipelining;
- out-of-order response;
- tracing;
- timeout per request;
- cancellation.

Namun multiplexing membuat backpressure lebih kompleks:

- satu slow response tidak boleh menahan semua response lain;
- outbound queue harus fairness-aware;
- per-request memory harus bounded;
- cancellation harus jelas.

Jika tidak benar-benar butuh multiplexing, protocol sequential request-response lebih sederhana dan lebih mudah benar.

---

## 21. Heartbeat, Ping/Pong, dan Idle Detection

Heartbeat digunakan untuk mendeteksi connection yang kelihatan hidup tapi sebenarnya tidak berguna.

Frame contoh:

```text
PING timestamp
PONG timestamp
```

Tujuan:

- mendeteksi idle connection;
- menjaga NAT/firewall mapping;
- mengukur round-trip time;
- memastikan event loop/worker masih responsif.

Namun heartbeat bukan pengganti timeout.

Common mistake:

- terlalu sering heartbeat → noise;
- heartbeat tetap dikirim walau connection overload;
- tidak ada max missed heartbeat;
- heartbeat masuk queue di belakang payload besar sehingga terlambat;
- heartbeat dianggap bukti end-to-end business operation sehat.

Rule praktis:

```text
idle timeout > heartbeat interval * missed threshold
```

Contoh:

```text
heartbeat interval: 30s
missed threshold: 3
idle timeout: 100s
```

Untuk protocol dengan transfer besar, heartbeat perlu dipikirkan hati-hati. Jika satu frame besar 2 GB sedang dikirim, ping bisa tertahan. Itu salah satu alasan chunking lebih sehat.

---

## 22. Framing untuk Text Payload: JSON di Atas TCP

JSON tidak punya boundary saat dikirim sebagai stream TCP.

Misalnya sender menulis:

```json
{"type":"A"}{"type":"B"}
```

Receiver tidak otomatis tahu boundary object kecuali parser streaming yang mampu menghitung brace, string escaping, dan nested object. Itu rumit dan rawan bug jika dibuat manual.

Pilihan framing JSON:

### 22.1 Newline-delimited JSON / NDJSON

```text
{"type":"A"}\n
{"type":"B"}\n
```

Kelebihan:

- mudah;
- readable;
- cocok untuk logs/events;
- bisa diproses line-by-line.

Syarat:

- satu JSON object per line;
- newline dalam string harus escaped sebagai `\n`, bukan raw newline;
- max line size wajib.

### 22.2 Length-prefixed JSON

```text
[4-byte length][UTF-8 JSON bytes]
```

Kelebihan:

- payload bisa pretty JSON dengan newline;
- parsing jelas;
- cocok untuk request/response protocol.

Rekomendasi:

- untuk internal binary-safe protocol, pilih length-prefix;
- untuk log/event stream manusia-readable, NDJSON bisa masuk akal;
- untuk HTTP, gunakan HTTP framing yang sudah ada, jangan buat framing TCP sendiri kecuali memang membangun protocol custom.

---

## 23. Framing untuk Binary Payload Besar

Untuk file/data besar, jangan selalu:

```text
[4 bytes length][entire 2GB file]
```

Masalah:

- length field int terbatas;
- memory pressure;
- retry mahal;
- checksum hanya diketahui di akhir;
- progress sulit;
- timeout panjang;
- satu frame memblokir heartbeat.

Gunakan chunked transfer:

```text
FILE_START
  fileId
  fileName
  totalSize
  expectedSha256

FILE_CHUNK
  fileId
  offset
  length
  chunkChecksum
  payload

FILE_END
  fileId
  finalChecksum
```

Invariant:

- offset harus monotonic atau explicit random-access;
- chunk length <= max chunk size;
- total received <= declared total size;
- checksum chunk diverifikasi sebelum commit;
- final checksum diverifikasi sebelum publish;
- temp file digunakan sampai finalization berhasil;
- duplicate chunk harus idempotent;
- missing chunk harus terdeteksi.

Ini akan dibahas lebih dalam pada Part 025 dan Part 026, tetapi fondasinya dimulai dari framing.

---

## 24. Blocking Server: Correct Simplicity

Blocking server sederhana masih valid untuk banyak use case, terutama dengan virtual threads modern. Tetapi protocol tetap harus benar.

Contoh server blocking minimal:

```java
import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public final class BlockingLengthPrefixedServer {
    private static final int PORT = 9000;
    private static final int MAX_FRAME_SIZE = 1024 * 1024;

    public static void main(String[] args) throws IOException {
        ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

        try (ServerSocket server = new ServerSocket(PORT)) {
            server.setReuseAddress(true);
            System.out.println("listening on " + PORT);

            while (true) {
                Socket socket = server.accept();
                executor.submit(() -> handle(socket));
            }
        } finally {
            executor.shutdown();
        }
    }

    private static void handle(Socket socket) {
        try (socket) {
            socket.setSoTimeout(10_000);
            socket.setTcpNoDelay(true);

            InputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());

            while (!socket.isClosed()) {
                byte[] request;
                try {
                    request = readFrame(in);
                } catch (EOFException eof) {
                    return; // orderly close at frame boundary or no more data
                }

                String text = new String(request, StandardCharsets.UTF_8);
                byte[] response = ("echo: " + text).getBytes(StandardCharsets.UTF_8);
                writeFrame(out, response);
            }
        } catch (SocketTimeoutException e) {
            // close slow/idle connection
        } catch (IOException e) {
            // log with remote address in real service
        }
    }

    private static byte[] readFrame(InputStream in) throws IOException {
        byte[] header = readExactly(in, 4);
        int length = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN).getInt();
        if (length < 0 || length > MAX_FRAME_SIZE) {
            throw new IOException("invalid frame length: " + length);
        }
        return readExactly(in, length);
    }

    private static void writeFrame(OutputStream out, byte[] payload) throws IOException {
        if (payload.length > MAX_FRAME_SIZE) {
            throw new IOException("payload too large: " + payload.length);
        }
        byte[] header = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(payload.length).array();
        out.write(header);
        out.write(payload);
        out.flush();
    }

    private static byte[] readExactly(InputStream in, int size) throws IOException {
        byte[] data = new byte[size];
        int offset = 0;
        while (offset < size) {
            int n = in.read(data, offset, size - offset);
            if (n == -1) {
                if (offset == 0) {
                    throw new EOFException("eof");
                }
                throw new EOFException("truncated frame: expected " + size + ", got " + offset);
            }
            offset += n;
        }
        return data;
    }
}
```

Catatan desain:

- `MAX_FRAME_SIZE` wajib;
- `setSoTimeout` mencegah read block selamanya;
- `try (socket)` memastikan close;
- virtual thread membuat blocking model lebih scalable dibanding platform thread klasik;
- protocol tetap sequential request-response;
- tidak ada unbounded queue.

Namun ini belum cukup untuk production high-throughput:

- belum ada connection limit;
- belum ada rate limit;
- belum ada graceful shutdown;
- belum ada observability;
- belum ada request deadline total;
- belum ada structured error frame;
- belum ada authentication/TLS.

---

## 25. Client Implementation: Jangan Lupa Deadline dan Close

Contoh client:

```java
import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

public final class BlockingLengthPrefixedClient {
    private static final int MAX_FRAME_SIZE = 1024 * 1024;

    public static void main(String[] args) throws Exception {
        InetSocketAddress address = new InetSocketAddress("127.0.0.1", 9000);

        try (Socket socket = new Socket()) {
            socket.connect(address, 3_000);
            socket.setSoTimeout(10_000);
            socket.setTcpNoDelay(true);

            InputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());

            writeFrame(out, "hello".getBytes(StandardCharsets.UTF_8));
            byte[] response = readFrame(in);
            System.out.println(new String(response, StandardCharsets.UTF_8));
        }
    }

    static void writeFrame(OutputStream out, byte[] payload) throws IOException {
        if (payload.length > MAX_FRAME_SIZE) {
            throw new IOException("payload too large");
        }
        out.write(ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(payload.length).array());
        out.write(payload);
        out.flush();
    }

    static byte[] readFrame(InputStream in) throws IOException {
        byte[] header = readExactly(in, 4);
        int length = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN).getInt();
        if (length < 0 || length > MAX_FRAME_SIZE) {
            throw new IOException("invalid frame length: " + length);
        }
        return readExactly(in, length);
    }

    static byte[] readExactly(InputStream in, int size) throws IOException {
        byte[] data = new byte[size];
        int offset = 0;
        while (offset < size) {
            int n = in.read(data, offset, size - offset);
            if (n == -1) {
                throw new EOFException("connection closed while reading frame");
            }
            offset += n;
        }
        return data;
    }
}
```

Client-side correctness:

- connect timeout wajib;
- read timeout wajib;
- close socket saat selesai;
- validate frame length response;
- jangan retry request non-idempotent tanpa idempotency key;
- jangan log payload sensitif.

---

## 26. Error Frame vs Connection Close

Protocol perlu menentukan apa yang terjadi saat error.

Pilihan:

1. close connection langsung;
2. kirim error frame lalu close;
3. kirim error frame dan lanjutkan connection;
4. kirim GOAWAY untuk graceful shutdown.

Contoh error frame:

```text
ERROR
  requestId
  errorCode
  messageLength
  message
```

Error taxonomy:

| Error | Close connection? | Reason |
|---|---:|---|
| malformed header | yes | parser state unreliable |
| unsupported version | usually yes | incompatible protocol |
| frame too large | yes or no | depends whether stream can resync |
| invalid command | no | application-level error |
| auth failed | yes | security |
| rate limit | maybe no | client can retry later |
| server overloaded | maybe yes | shed load |

Important:

> Jika parser tidak bisa menentukan boundary frame berikutnya dengan aman, close connection.

Contoh: length field corrupt. Receiver tidak tahu payload selesai di mana. Mencoba “lanjut” bisa membuat stream desynchronized.

---

## 27. Resynchronization: Hampir Selalu Jangan

Sebagian binary protocol memakai magic number untuk mencoba resync setelah corruption.

Contoh:

```text
MAGIC VERSION TYPE LENGTH PAYLOAD
```

Jika parsing gagal, receiver scan byte berikutnya sampai menemukan MAGIC.

Masalah:

- magic bisa muncul di payload;
- attacker bisa memaksa scanning mahal;
- state menjadi kompleks;
- false positive;
- security risk.

Untuk TCP application protocol internal, biasanya lebih aman:

```text
protocol violation -> close connection -> reconnect cleanly
```

Magic number tetap berguna untuk validasi awal dan debugging, bukan harus untuk resync.

---

## 28. Nagle, Flush, dan TCP_NODELAY

`flush()` pada `OutputStream` mendorong buffered data dari Java wrapper ke underlying stream. Tetapi ia bukan jaminan “packet langsung sampai ke peer”.

Layer yang terlibat:

1. `BufferedOutputStream` buffer;
2. JVM/native socket write;
3. OS send buffer;
4. TCP stack;
5. network;
6. peer receive buffer;
7. peer application read.

`TCP_NODELAY` mengontrol Nagle algorithm. Dengan Nagle enabled, TCP bisa menunda packet kecil untuk mengurangi overhead. Dengan `setTcpNoDelay(true)`, latency message kecil bisa lebih rendah, tetapi packet overhead lebih tinggi.

Kapan `TCP_NODELAY` sering berguna:

- request-response kecil;
- low-latency RPC;
- interactive protocol;
- command protocol.

Kapan tidak selalu perlu:

- bulk transfer;
- large streaming payload;
- throughput lebih penting dari latency kecil.

Rule:

> Jangan gunakan `flush()` sebagai message boundary. Gunakan framing.

---

## 29. Deadlock Protocol: Dua Sisi Sama-Sama Menunggu

Contoh deadlock:

Client:

```text
send request header
wait response
```

Server:

```text
wait full request body based on declared length
```

Jika client tidak mengirim body tetapi menunggu response, server menunggu body. Keduanya diam.

Contoh lain:

- dua sisi sama-sama menulis frame besar tanpa membaca;
- send buffer penuh di kedua arah;
- application worker menunggu response yang hanya bisa diproses oleh worker yang sedang blocked;
- event loop melakukan blocking write.

Defense:

- protocol state machine jelas;
- timeout/deadline;
- bounded frame;
- separate read/write loops jika perlu;
- jangan block event loop;
- dokumentasikan siapa bicara dulu;
- handshake explicit;
- untuk bidirectional protocol, desain flow control.

---

## 30. Flow Control di Application Layer

TCP punya flow control, tetapi aplikasi kadang perlu flow control sendiri.

Contoh:

```text
client can send at most 10 outstanding requests
server sends WINDOW_UPDATE when capacity available
```

Atau:

```text
receiver advertises credit: 64 chunks
sender sends up to 64 chunks
receiver acknowledges processed chunks
sender sends more
```

Application-level flow control berguna saat:

- processing cost jauh lebih mahal dari receiving byte;
- downstream storage lambat;
- perlu fairness antar client;
- connection multiplexing;
- long-running transfer;
- message besar.

Sederhana:

```text
MAX_IN_FLIGHT_REQUESTS = 8
MAX_OUTBOUND_BYTES = 16 MiB
MAX_UNACKED_CHUNKS = 32
```

Invariant:

> Network receive bukan berarti business processing sudah sanggup.

---

## 31. Framing Parser sebagai State Machine

Untuk non-blocking parser, kamu tidak bisa memakai `readExactly` blocking. Parser harus incremental.

State:

```text
READ_HEADER
READ_PAYLOAD
EMIT_FRAME
```

Contoh skeleton:

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;

final class IncrementalFrameDecoder {
    private static final int HEADER_SIZE = 4;
    private final int maxFrameSize;

    private final ByteBuffer header = ByteBuffer.allocate(HEADER_SIZE).order(ByteOrder.BIG_ENDIAN);
    private ByteBuffer payload;

    IncrementalFrameDecoder(int maxFrameSize) {
        this.maxFrameSize = maxFrameSize;
    }

    List<byte[]> feed(ByteBuffer input) throws IOException {
        List<byte[]> frames = new ArrayList<>();

        while (input.hasRemaining()) {
            if (payload == null) {
                copy(input, header);
                if (header.hasRemaining()) {
                    break;
                }

                header.flip();
                int length = header.getInt();
                header.clear();

                if (length < 0 || length > maxFrameSize) {
                    throw new IOException("invalid frame length: " + length);
                }

                payload = ByteBuffer.allocate(length);
            }

            copy(input, payload);
            if (payload.hasRemaining()) {
                break;
            }

            payload.flip();
            byte[] frame = new byte[payload.remaining()];
            payload.get(frame);
            frames.add(frame);
            payload = null;
        }

        return frames;
    }

    private static void copy(ByteBuffer src, ByteBuffer dst) {
        int n = Math.min(src.remaining(), dst.remaining());
        int originalLimit = src.limit();
        src.limit(src.position() + n);
        dst.put(src);
        src.limit(originalLimit);
    }
}
```

Kelebihan model ini:

- bisa menerima setengah header;
- bisa menerima header + setengah payload;
- bisa menerima beberapa frame sekaligus;
- tidak mengasumsikan satu read = satu frame;
- cocok untuk `SocketChannel` non-blocking.

Kekurangan:

- allocation per frame masih ada;
- payload besar tetap allocate utuh;
- belum ada pooling;
- belum ada streaming payload;
- belum ada checksum.

Namun sebagai mental model, ini sangat penting.

---

## 32. Testing Framing Protocol

Protocol parser harus dites dengan fragmentasi ekstrem.

Jika frame bytes adalah:

```text
[00 00 00 05 H E L L O]
```

Test input split:

1. semua byte sekaligus;
2. satu byte per feed;
3. header terpisah dari payload;
4. dua frame sekaligus;
5. satu setengah frame;
6. EOF di tengah header;
7. EOF di tengah payload;
8. length negatif;
9. length > max;
10. zero-length frame;
11. random noise;
12. slow feed.

Contoh unit test idea:

```java
// Pseudocode
feed(bytes(0, 0));
assertNoFrame();
feed(bytes(0, 5, 'H'));
assertNoFrame();
feed(bytes('E', 'L', 'L', 'O'));
assertFrame("HELLO");
```

Property-style invariant:

> Untuk frame sequence valid, hasil decoding harus sama terlepas dari cara byte di-split.

Ini invariant sangat kuat.

---

## 33. Observability untuk Protocol TCP

Metrics minimal:

| Metric | Tujuan |
|---|---|
| active connections | kapasitas dan leak |
| accepted connections/sec | traffic masuk |
| closed connections/sec | churn |
| read bytes/sec | throughput input |
| written bytes/sec | throughput output |
| frames in/sec | message rate |
| frames out/sec | response rate |
| protocol errors/sec | bad client/bug |
| frame too large count | attack/misconfig |
| read timeout count | slow peer/network |
| write timeout count | slow receiver |
| outbound queue size | backpressure |
| request latency | service health |
| processing time | business/CPU cost |
| idle timeout count | idle connection cleanup |

Logs harus memuat:

- connection id;
- remote address;
- protocol version;
- frame type;
- request id;
- state transition penting;
- error code;
- close reason.

Jangan log:

- raw credential;
- token;
- password;
- PII;
- payload binary besar;
- full frame tanpa redaction.

Contoh close reason:

```text
CLOSE_NORMAL
CLOSE_IDLE_TIMEOUT
CLOSE_READ_TIMEOUT
CLOSE_FRAME_TOO_LARGE
CLOSE_PROTOCOL_ERROR
CLOSE_AUTH_FAILED
CLOSE_SERVER_SHUTDOWN
CLOSE_BACKPRESSURE_OVERFLOW
CLOSE_IO_EXCEPTION
```

---

## 34. Security Model

Protocol TCP custom membuka banyak permukaan serangan:

1. oversized frame;
2. negative length;
3. indefinite blocking;
4. slowloris;
5. unbounded connection;
6. unbounded queue;
7. decompression bomb jika payload compressed;
8. deserialization attack jika payload Java serialization;
9. log injection;
10. path traversal jika payload berisi filename;
11. replay jika tidak ada auth/session/idempotency;
12. downgrade jika version negotiation lemah;
13. plaintext sensitive data jika tanpa TLS.

Security checklist:

- TLS untuk data sensitif;
- authentication sebelum command berbahaya;
- authorize per operation;
- max frame size;
- max request rate;
- max connection per client;
- timeout;
- bounded memory;
- reject unsupported version;
- never deserialize untrusted Java object;
- validate all lengths, flags, types;
- sanitize logs;
- do not trust filename/path from client;
- checksum untuk integrity application-level jika perlu;
- audit important transfer.

---

## 35. Decision Matrix Framing

| Kebutuhan | Framing yang Cocok | Catatan |
|---|---|---|
| command text sederhana | delimiter/line | max line length wajib |
| JSON event stream | NDJSON | cocok log/event; satu object per line |
| JSON request-response | length-prefix JSON | charset UTF-8 eksplisit |
| binary payload kecil | length-prefix | max frame size wajib |
| binary payload besar | chunked header-body | checksum/resume lebih baik |
| fixed telemetry | fixed-size | mudah tapi kurang fleksibel |
| evolvable protocol | header-body | version/type/flags/requestId |
| high throughput custom RPC | binary header-body | butuh flow control |
| file transfer reliable | chunk manifest protocol | state machine wajib |
| public internet API | biasanya HTTP/gRPC | jangan custom TCP kecuali ada alasan kuat |

---

## 36. Anti-Pattern Penting

### 36.1 Menganggap `read()` Menghasilkan Satu Message

Salah:

```java
int n = in.read(buffer);
handle(buffer, n);
```

Benar:

```java
appendToDecoder(buffer, n);
while (decoder.hasCompleteFrame()) {
    handle(decoder.nextFrame());
}
```

---

### 36.2 Tidak Memvalidasi Length

Salah:

```java
int len = dataIn.readInt();
byte[] payload = new byte[len];
```

Benar:

```java
int len = dataIn.readInt();
if (len < 0 || len > maxFrameSize) {
    throw new IOException("invalid length");
}
```

---

### 36.3 Tidak Ada Timeout

Salah:

```java
readFully(in, payload);
```

Benar:

```java
socket.setSoTimeout(readTimeoutMillis);
readFullyWithDeadline(in, payload, deadline);
```

---

### 36.4 Unbounded Outbound Queue

Salah:

```java
outbound.add(response);
```

Benar:

```java
if (!outbound.offer(response)) {
    closeOrRejectDueToBackpressure();
}
```

---

### 36.5 Menggunakan Java Serialization sebagai Payload Public Protocol

Salah:

```java
ObjectInputStream ois = new ObjectInputStream(socket.getInputStream());
Object obj = ois.readObject();
```

Risiko:

- gadget chain;
- remote code execution class of vulnerability;
- compatibility rapuh;
- format Java-specific;
- sulit audit.

Lebih aman:

- explicit binary format;
- JSON with schema validation;
- Protobuf/Avro/CBOR;
- allowlist deserialization jika benar-benar internal dan unavoidable.

---

## 37. Production Pattern: Minimal Reliable TCP Protocol

Jika harus membuat custom TCP protocol, baseline minimal:

```text
Header:
  magic: 4 bytes
  version: 1 byte
  type: 1 byte
  flags: 2 bytes
  requestId: 8 bytes
  length: 4 bytes
  checksum: 4 bytes optional

Payload:
  bytes length
```

Rules:

1. magic wajib cocok;
2. version harus supported;
3. type harus dikenal;
4. flags unknown harus ditolak kecuali explicitly marked optional;
5. length harus `0 <= length <= maxFrameSize`;
6. checksum diverifikasi jika flag checksum aktif;
7. parser state machine deterministic;
8. protocol violation menutup connection;
9. timeout diterapkan per fase;
10. outbound queue bounded;
11. connection close reason logged;
12. metrics dikumpulkan.

---

## 38. Checklist Implementasi

Sebelum custom TCP protocol dianggap siap, jawab ini:

### Framing

- [ ] Bagaimana receiver tahu satu message selesai?
- [ ] Apakah payload boleh mengandung delimiter?
- [ ] Apakah length field divalidasi?
- [ ] Berapa max frame size?
- [ ] Bagaimana zero-length frame diperlakukan?
- [ ] Bagaimana unsupported version diperlakukan?

### Partial I/O

- [ ] Apakah parser benar jika header datang 1 byte per read?
- [ ] Apakah parser benar jika dua frame datang dalam satu read?
- [ ] Apakah EOF di tengah frame dideteksi?
- [ ] Apakah non-blocking write menangani partial write?

### Timeout

- [ ] Connect timeout?
- [ ] Read timeout?
- [ ] Request deadline?
- [ ] Idle timeout?
- [ ] Slowloris defense?

### Backpressure

- [ ] Apakah outbound queue bounded?
- [ ] Apa behavior saat queue penuh?
- [ ] Apakah server bisa stop reading sementara?
- [ ] Apakah ada per-client limit?

### Security

- [ ] TLS/auth jika data sensitif?
- [ ] Tidak ada untrusted Java deserialization?
- [ ] Payload size dibatasi?
- [ ] Rate limit?
- [ ] Log redaction?

### Observability

- [ ] Connection id?
- [ ] Request id?
- [ ] Close reason?
- [ ] Protocol error metrics?
- [ ] Queue size metrics?
- [ ] Latency metrics?

---

## 39. Latihan

### Latihan 1 — Fragmentation Test

Buat decoder length-prefix yang bisa menerima byte secara incremental. Test dengan semua variasi split:

- semua byte sekaligus;
- satu byte per feed;
- header terpotong;
- payload terpotong;
- beberapa frame sekaligus.

Target:

> Output frame harus sama terlepas dari cara input byte dipecah.

---

### Latihan 2 — Max Frame Size

Modifikasi decoder agar menolak frame lebih dari 1 MiB.

Test:

- length = -1;
- length = 0;
- length = 1 MiB;
- length = 1 MiB + 1;
- length = Integer.MAX_VALUE.

---

### Latihan 3 — Protocol State Machine

Desain state machine untuk protocol:

```text
HELLO
AUTH
REQUEST
RESPONSE
PING
PONG
GOAWAY
```

Tentukan frame mana yang valid di state mana.

---

### Latihan 4 — Backpressure Simulation

Buat server yang menerima request cepat tetapi response dikirim lambat. Tambahkan bounded outbound queue.

Tentukan behavior saat queue penuh:

- reject;
- close;
- block;
- drop.

Jelaskan trade-off masing-masing.

---

### Latihan 5 — File Transfer Chunk Protocol

Rancang frame untuk upload file 10 GB dengan chunk 4 MiB.

Wajib ada:

- file id;
- offset;
- chunk length;
- chunk checksum;
- final checksum;
- resume support;
- idempotency.

---

## 40. Ringkasan

TCP memberi Java aplikasi sebuah ordered byte stream. Itu kuat, tetapi juga sering disalahpahami. TCP tidak tahu message aplikasimu. Karena itu, protocol harus mendefinisikan framing.

Hal paling penting dari Part 020:

1. Satu `write()` tidak sama dengan satu `read()`.
2. TCP adalah byte stream, bukan message queue.
3. Framing wajib untuk protocol long-lived.
4. Length-prefix framing harus selalu punya max frame size.
5. Delimiter framing harus selalu punya max line length dan escaping rule.
6. Partial read/write adalah kondisi normal.
7. EOF di tengah frame adalah truncation/protocol error.
8. Timeout adalah bagian dari correctness, bukan tuning tambahan.
9. Backpressure harus eksplisit saat ada queue, worker, atau non-blocking I/O.
10. Protocol yang sehat adalah state machine, bukan sekadar loop baca/tulis.
11. Observability harus mencatat connection, frame, request id, error, dan close reason.
12. Untuk public API, custom TCP sering kalah aman dan kalah operasional dibanding HTTP/gRPC kecuali ada alasan kuat.

Mental model akhirnya:

```text
TCP gives ordered bytes.
Your protocol creates messages.
Your parser enforces boundaries.
Your timeout prevents waiting forever.
Your backpressure prevents memory death.
Your state machine prevents ambiguity.
Your observability makes failure explainable.
```

---

## 41. Koneksi ke Part Berikutnya

Part ini masih memakai mental model blocking socket dan framing umum. Part berikutnya akan masuk ke **NIO Networking**:

```text
Part 021 — NIO Networking: SocketChannel, ServerSocketChannel, Selector, dan Event Loop
```

Di sana kita akan membahas bagaimana framing, partial read, partial write, dan backpressure berubah ketika modelnya bukan lagi satu thread blocking per connection, melainkan event loop dan selector.

