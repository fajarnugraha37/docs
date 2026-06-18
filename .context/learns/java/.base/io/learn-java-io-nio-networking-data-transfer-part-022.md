# Part 022 — UDP, Datagram, Multicast, dan Kapan Tidak Boleh Memakai TCP

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-022.md`  
> Level: Advanced / Production Engineering  
> Prasyarat: Part 019–021, terutama TCP stream, framing, socket lifecycle, `SocketChannel`, dan `Selector`.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan secara tajam antara **TCP sebagai byte stream** dan **UDP sebagai datagram transport**.
2. Memahami konsekuensi UDP terhadap reliability: packet loss, duplication, reordering, truncation, MTU, fragmentation, dan lack of backpressure.
3. Menggunakan API Java untuk UDP:
   - `DatagramSocket`
   - `DatagramPacket`
   - `DatagramChannel`
   - `MulticastSocket`
   - `MulticastChannel`
   - `NetworkInterface`
4. Mendesain protokol UDP yang tidak naif:
   - sequence number
   - timestamp
   - TTL/expiry
   - message id
   - checksum/HMAC
   - deduplication
   - bounded packet size
   - retry/ack jika diperlukan
5. Memahami kapan UDP cocok:
   - telemetry ringan
   - discovery
   - heartbeat
   - multicast/broadcast lokal
   - real-time signal yang lebih baik drop daripada delay
6. Memahami kapan UDP berbahaya:
   - transaksi finansial
   - upload dokumen
   - command penting
   - audit trail
   - workflow regulatory
   - state transition yang wajib durable
7. Menyusun mental model production-grade untuk UDP di Java.

---

## 2. Big Picture: UDP Bukan “TCP yang Lebih Cepat”

Kesalahan paling umum adalah menganggap UDP sebagai versi TCP yang lebih cepat. Itu framing yang salah.

TCP dan UDP bukan sekadar berbeda performa. Mereka menyediakan **abstraksi transport yang berbeda**.

| Aspek | TCP | UDP |
|---|---|---|
| Model | byte stream | datagram/message packet |
| Connection | connection-oriented | connectionless secara protokol |
| Ordering | dijamin | tidak dijamin |
| Delivery | retransmission otomatis | tidak dijamin |
| Duplication | TCP menyembunyikan duplicate segment | aplikasi bisa menerima duplicate datagram |
| Flow control | ada | tidak ada di protokol UDP |
| Congestion control | ada | tidak ada secara default di aplikasi UDP mentah |
| Boundary pesan | tidak ada | ada per datagram |
| Overhead | lebih tinggi | lebih rendah |
| Cocok untuk | reliable stream | low-latency message, discovery, telemetry, multicast |

Mental model:

```text
TCP:
  Aplikasi menulis bytes -> TCP mengirim stream -> aplikasi lain membaca bytes.
  Pesan harus dibuat sendiri lewat framing.

UDP:
  Aplikasi mengirim satu datagram -> receiver menerima satu datagram utuh atau tidak sama sekali.
  Boundary datagram ada, tetapi delivery tidak dijamin.
```

Jadi:

```text
TCP problem:
  Bagaimana membagi stream menjadi message?

UDP problem:
  Bagaimana menghadapi message yang hilang, terlambat, duplicate, reorder, atau terlalu besar?
```

---

## 3. Datagram sebagai Unit Semantik

Dalam UDP, satu `send()` biasanya merepresentasikan satu datagram. Receiver memanggil `receive()` dan menerima satu datagram.

Artinya, berbeda dari TCP:

```text
UDP sender:
  send(packet A)
  send(packet B)
  send(packet C)

UDP receiver mungkin melihat:
  C, A

Atau:
  A, A, B, C

Atau:
  A saja

Atau:
  tidak ada sama sekali
```

Boundary packet tetap ada:

```text
Jika sender mengirim datagram 100 bytes,
receiver tidak akan membaca 20 bytes dulu lalu 80 bytes kemudian
seperti di TCP stream.
```

Tetapi ada detail penting:

```text
Jika buffer receiver lebih kecil dari datagram,
datagram dapat terpotong/truncated tergantung API/platform behavior.
```

Karena itu, dalam desain UDP, ukuran packet harus eksplisit dan bounded.

---

## 4. Java UDP API Landscape

Java menyediakan dua kelompok API utama.

### 4.1 Classic `java.net`

```text
java.net.DatagramSocket
java.net.DatagramPacket
java.net.MulticastSocket
java.net.InetAddress
java.net.InetSocketAddress
java.net.NetworkInterface
```

Model ini cocok untuk blocking UDP sederhana.

### 4.2 NIO `java.nio.channels`

```text
java.nio.channels.DatagramChannel
java.nio.channels.MulticastChannel
java.nio.channels.MembershipKey
java.nio.ByteBuffer
```

Model ini cocok jika kamu ingin:

- memakai `ByteBuffer`
- non-blocking mode
- integrasi dengan `Selector`
- desain event loop
- multicast dengan API yang lebih modern

Dokumentasi Java menyebut `DatagramChannel` sebagai selectable channel untuk socket berorientasi datagram. `DatagramChannel` juga mengimplementasikan `MulticastChannel`, sehingga dapat dipakai untuk multicast dengan API NIO.

---

## 5. UDP Dengan `DatagramSocket`

### 5.1 Sender Sederhana

```java
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

public final class UdpSender {
    public static void main(String[] args) throws Exception {
        byte[] payload = "hello-udp".getBytes(StandardCharsets.UTF_8);

        InetAddress address = InetAddress.getByName("127.0.0.1");
        int port = 9999;

        try (DatagramSocket socket = new DatagramSocket()) {
            DatagramPacket packet = new DatagramPacket(
                    payload,
                    payload.length,
                    address,
                    port
            );

            socket.send(packet);
        }
    }
}
```

Catatan:

- `DatagramSocket()` tanpa port eksplisit akan bind ke ephemeral local port.
- UDP tidak membuat connection TCP-style.
- `send()` tidak berarti remote menerima packet.
- Tidak ada exception jika packet hilang di network.

### 5.2 Receiver Sederhana

```java
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.nio.charset.StandardCharsets;

public final class UdpReceiver {
    public static void main(String[] args) throws Exception {
        int port = 9999;
        byte[] buffer = new byte[1024];

        try (DatagramSocket socket = new DatagramSocket(port)) {
            while (true) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                socket.receive(packet);

                String message = new String(
                        packet.getData(),
                        packet.getOffset(),
                        packet.getLength(),
                        StandardCharsets.UTF_8
                );

                System.out.printf(
                        "from=%s:%d length=%d body=%s%n",
                        packet.getAddress().getHostAddress(),
                        packet.getPort(),
                        packet.getLength(),
                        message
                );
            }
        }
    }
}
```

Hal penting:

```java
new String(packet.getData(), packet.getOffset(), packet.getLength(), UTF_8)
```

Jangan begini:

```java
new String(buffer, UTF_8)
```

Karena buffer mungkin lebih besar dari packet aktual dan masih mengandung data lama.

---

## 6. UDP Timeout

`receive()` blocking dapat menggantung selamanya jika tidak ada packet.

Gunakan timeout:

```java
socket.setSoTimeout(3_000);
```

Contoh:

```java
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.SocketTimeoutException;

public final class UdpTimeoutExample {
    public static void main(String[] args) throws Exception {
        byte[] buffer = new byte[512];

        try (DatagramSocket socket = new DatagramSocket(9999)) {
            socket.setSoTimeout(3_000);

            while (true) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                    System.out.println("received length=" + packet.getLength());
                } catch (SocketTimeoutException e) {
                    System.out.println("no packet within timeout; performing periodic task");
                }
            }
        }
    }
}
```

Timeout di UDP sering dipakai untuk:

- heartbeat expiry
- discovery wait window
- retry request
- loop shutdown polling
- periodic reconciliation

---

## 7. `connect()` pada UDP: Bukan TCP Connect

`DatagramSocket` memiliki method `connect()`.

Ini sering membingungkan karena tidak berarti membuat koneksi TCP-like.

Pada UDP, `connect(remoteAddress, remotePort)` biasanya berarti:

1. Socket dikaitkan dengan remote default.
2. `send()` bisa tanpa address per packet.
3. Socket hanya menerima datagram dari remote tersebut.
4. OS dapat memberikan error ICMP tertentu ke aplikasi dalam beberapa kondisi.

Contoh:

```java
try (DatagramSocket socket = new DatagramSocket()) {
    socket.connect(InetAddress.getByName("127.0.0.1"), 9999);

    byte[] data = "ping".getBytes(StandardCharsets.UTF_8);
    DatagramPacket packet = new DatagramPacket(data, data.length);
    socket.send(packet);
}
```

Ingat:

```text
UDP connect != handshake
UDP connect != reliable session
UDP connect != delivery guarantee
```

---

## 8. UDP Dengan `DatagramChannel`

`DatagramChannel` adalah versi NIO yang memakai `ByteBuffer` dan dapat dibuat blocking atau non-blocking.

### 8.1 Blocking Send/Receive

```java
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.channels.DatagramChannel;

public final class UdpChannelExample {
    public static void main(String[] args) throws Exception {
        try (DatagramChannel channel = DatagramChannel.open()) {
            channel.bind(new InetSocketAddress("127.0.0.1", 9999));

            ByteBuffer buffer = ByteBuffer.allocate(1024);

            while (true) {
                buffer.clear();
                InetSocketAddress remote = (InetSocketAddress) channel.receive(buffer);

                buffer.flip();
                String message = StandardCharsets.UTF_8.decode(buffer).toString();

                System.out.printf("from=%s message=%s%n", remote, message);
            }
        }
    }
}
```

### 8.2 Sender Dengan `DatagramChannel`

```java
try (DatagramChannel channel = DatagramChannel.open()) {
    ByteBuffer buffer = StandardCharsets.UTF_8.encode("hello-channel");
    channel.send(buffer, new InetSocketAddress("127.0.0.1", 9999));
}
```

Hal yang harus diperhatikan:

- `ByteBuffer` tetap punya state machine: `position`, `limit`, `capacity`.
- Untuk receive, biasanya `clear()` sebelum receive dan `flip()` sebelum decode/read.
- Untuk send, pastikan buffer berada di read mode.

---

## 9. Non-Blocking UDP Dengan Selector

`DatagramChannel` bisa dipakai dengan `Selector`.

```java
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.DatagramChannel;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public final class NonBlockingUdpServer {
    public static void main(String[] args) throws Exception {
        try (Selector selector = Selector.open();
             DatagramChannel channel = DatagramChannel.open()) {

            channel.configureBlocking(false);
            channel.bind(new InetSocketAddress("127.0.0.1", 9999));
            channel.register(selector, SelectionKey.OP_READ);

            ByteBuffer buffer = ByteBuffer.allocate(2048);

            while (true) {
                selector.select();

                Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();
                while (iterator.hasNext()) {
                    SelectionKey key = iterator.next();
                    iterator.remove();

                    if (!key.isValid()) {
                        continue;
                    }

                    if (key.isReadable()) {
                        DatagramChannel datagramChannel = (DatagramChannel) key.channel();

                        buffer.clear();
                        InetSocketAddress remote = (InetSocketAddress) datagramChannel.receive(buffer);

                        if (remote == null) {
                            continue;
                        }

                        buffer.flip();
                        String message = StandardCharsets.UTF_8.decode(buffer).toString();

                        System.out.printf("from=%s message=%s%n", remote, message);
                    }
                }
            }
        }
    }
}
```

Dalam non-blocking UDP:

```text
receive() dapat return null jika tidak ada datagram.
```

Ini berbeda dari blocking mode yang menunggu packet.

---

## 10. UDP Failure Model

UDP memindahkan sebagian besar tanggung jawab reliability ke aplikasi.

### 10.1 Packet Loss

Packet bisa hilang karena:

- network congestion
- router drop
- receive buffer penuh
- firewall
- process receiver terlalu lambat
- OS socket buffer overflow
- Wi-Fi/intermittent network
- multicast filtering

Konsekuensi:

```text
Tidak ada exception otomatis di sender.
Tidak ada retransmission otomatis.
Receiver tidak tahu ada packet hilang kecuali protocol menyediakan sequence number.
```

### 10.2 Reordering

Packet dapat datang tidak sesuai urutan.

```text
Sender: A, B, C
Receiver: B, A, C
```

Jika urutan penting, protocol harus punya sequence number.

### 10.3 Duplication

Receiver bisa menerima duplicate packet.

```text
Sender: A
Receiver: A, A
```

Jika duplicate berbahaya, protocol harus punya message id dan dedup store/window.

### 10.4 Truncation

Jika datagram lebih besar dari buffer receive, data bisa terpotong.

Karena itu:

```text
Receiver buffer size harus >= max datagram size protocol.
Protocol harus punya max packet size.
```

### 10.5 No Backpressure

TCP memiliki flow control. UDP tidak.

Sender dapat mengirim terlalu cepat sampai:

- receiver socket buffer penuh
- OS drop packet
- network drop packet
- receiver CPU saturated

Karena itu aplikasi UDP yang serius perlu rate limit sendiri.

### 10.6 Fragmentation

IP layer dapat melakukan fragmentation jika datagram lebih besar dari MTU.

Masalahnya:

```text
Jika satu fragment hilang, seluruh UDP datagram gagal.
```

Dalam production, hindari datagram besar.

Rule of thumb praktis:

```text
Untuk payload UDP internet/public network:
  jaga payload kecil, sering kali <= 1200 bytes.

Untuk LAN terkontrol:
  masih tetap hati-hati, jangan asal kirim 60 KB.
```

Kenapa 1200 bytes sering dipakai?

- Aman terhadap banyak path MTU modern.
- Dipakai sebagai konservatif size di banyak protokol modern.
- Mengurangi risiko fragmentation.

Bukan angka sakral. Ini batas desain konservatif.

---

## 11. Mendesain UDP Message Format

UDP datagram sebaiknya self-contained.

Contoh header sederhana:

```text
0               1               2               3
+---------------+---------------+---------------+---------------+
| magic(2)      | version(1)    | type(1)       | flags(1)      |
+---------------+---------------+---------------+---------------+
| headerLen(1)  | sequence(4)                                   |
+---------------+---------------+---------------+---------------+
| timestampMillis(8)                                             |
+---------------------------------------------------------------+
| payloadLength(2)              | checksum(4)                    |
+---------------------------------------------------------------+
| payload ...                                                   |
+---------------------------------------------------------------+
```

Field yang umum:

| Field | Fungsi |
|---|---|
| magic | validasi bahwa packet milik protocol kita |
| version | evolusi format |
| type | heartbeat, data, ack, discovery, response |
| flags | compression, encryption, ack-required |
| sequence | ordering/loss detection |
| timestamp | expiry, latency measurement |
| payloadLength | validasi ukuran payload |
| checksum | deteksi corruption level aplikasi |
| messageId | deduplication |
| tenant/system id | filtering jika multi-system |

Prinsip:

```text
Datagram harus cukup lengkap untuk diproses sendiri.
Jangan bergantung pada packet sebelumnya kecuali protocol memang punya session state.
```

---

## 12. Contoh Binary UDP Protocol Dengan `ByteBuffer`

Kita buat format sederhana:

```text
magic:       2 bytes  0xCAFE
version:     1 byte   1
messageType: 1 byte
sequence:    4 bytes
payloadLen:  2 bytes
payload:     N bytes UTF-8
```

### 12.1 Encoder

```java
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

public final class UdpMessageCodec {
    private static final short MAGIC = (short) 0xCAFE;
    private static final byte VERSION = 1;
    private static final int HEADER_SIZE = 2 + 1 + 1 + 4 + 2;
    private static final int MAX_PAYLOAD_SIZE = 1000;

    public static ByteBuffer encode(byte type, int sequence, String payloadText) {
        byte[] payload = payloadText.getBytes(StandardCharsets.UTF_8);

        if (payload.length > MAX_PAYLOAD_SIZE) {
            throw new IllegalArgumentException("payload too large: " + payload.length);
        }

        ByteBuffer buffer = ByteBuffer.allocate(HEADER_SIZE + payload.length);
        buffer.order(ByteOrder.BIG_ENDIAN);

        buffer.putShort(MAGIC);
        buffer.put(VERSION);
        buffer.put(type);
        buffer.putInt(sequence);
        buffer.putShort((short) payload.length);
        buffer.put(payload);
        buffer.flip();

        return buffer;
    }

    public static DecodedMessage decode(ByteBuffer buffer) {
        buffer.order(ByteOrder.BIG_ENDIAN);

        if (buffer.remaining() < HEADER_SIZE) {
            throw new IllegalArgumentException("packet too short");
        }

        short magic = buffer.getShort();
        if (magic != MAGIC) {
            throw new IllegalArgumentException("invalid magic");
        }

        byte version = buffer.get();
        if (version != VERSION) {
            throw new IllegalArgumentException("unsupported version: " + version);
        }

        byte type = buffer.get();
        int sequence = buffer.getInt();
        int payloadLength = Short.toUnsignedInt(buffer.getShort());

        if (payloadLength > MAX_PAYLOAD_SIZE) {
            throw new IllegalArgumentException("payload too large in header: " + payloadLength);
        }

        if (buffer.remaining() != payloadLength) {
            throw new IllegalArgumentException(
                    "payload length mismatch: expected=" + payloadLength +
                            " actual=" + buffer.remaining()
            );
        }

        byte[] payload = new byte[payloadLength];
        buffer.get(payload);

        return new DecodedMessage(
                type,
                sequence,
                new String(payload, StandardCharsets.UTF_8)
        );
    }

    public record DecodedMessage(byte type, int sequence, String payload) {
    }
}
```

### 12.2 Sender

```java
try (DatagramChannel channel = DatagramChannel.open()) {
    ByteBuffer packet = UdpMessageCodec.encode((byte) 1, 42, "temperature=31.2");
    channel.send(packet, new InetSocketAddress("127.0.0.1", 9999));
}
```

### 12.3 Receiver

```java
try (DatagramChannel channel = DatagramChannel.open()) {
    channel.bind(new InetSocketAddress("127.0.0.1", 9999));

    ByteBuffer buffer = ByteBuffer.allocate(1200);

    while (true) {
        buffer.clear();
        InetSocketAddress remote = (InetSocketAddress) channel.receive(buffer);
        buffer.flip();

        try {
            UdpMessageCodec.DecodedMessage message = UdpMessageCodec.decode(buffer);
            System.out.printf("from=%s sequence=%d payload=%s%n",
                    remote,
                    message.sequence(),
                    message.payload());
        } catch (IllegalArgumentException invalidPacket) {
            System.err.println("drop invalid packet from " + remote + ": " + invalidPacket.getMessage());
        }
    }
}
```

Production note:

```text
Drop invalid packet.
Jangan biarkan satu packet rusak mematikan receiver loop.
```

---

## 13. Sequence Number dan Loss Detection

Jika packet loss penting untuk diketahui, gunakan sequence number.

Receiver dapat menyimpan sequence terakhir per sender.

```java
import java.net.SocketAddress;
import java.util.HashMap;
import java.util.Map;

public final class SequenceTracker {
    private final Map<SocketAddress, Integer> lastSequenceBySender = new HashMap<>();

    public void observe(SocketAddress sender, int sequence) {
        Integer previous = lastSequenceBySender.put(sender, sequence);

        if (previous == null) {
            return;
        }

        int expected = previous + 1;
        if (sequence == expected) {
            return;
        }

        if (sequence <= previous) {
            System.out.printf("duplicate or old packet sender=%s previous=%d current=%d%n",
                    sender, previous, sequence);
        } else {
            System.out.printf("packet gap sender=%s expected=%d actual=%d lost=%d%n",
                    sender, expected, sequence, sequence - expected);
        }
    }
}
```

Caveat:

- Sequence number bisa wrap around.
- Harus dipisahkan per sender/session.
- Reordering bisa terlihat seperti gap sementara.
- Untuk high-volume, gunakan sliding window, bukan single last sequence.

---

## 14. Deduplication Window

Untuk command/event yang tidak boleh diproses dua kali, gunakan message id.

Contoh sederhana:

```java
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public final class DedupWindow {
    private final Duration ttl;
    private final int maxEntries;
    private final Map<UUID, Instant> seen = new LinkedHashMap<>();

    public DedupWindow(Duration ttl, int maxEntries) {
        this.ttl = ttl;
        this.maxEntries = maxEntries;
    }

    public synchronized boolean firstTime(UUID id) {
        Instant now = Instant.now();
        cleanup(now);

        if (seen.containsKey(id)) {
            return false;
        }

        seen.put(id, now);
        return true;
    }

    private void cleanup(Instant now) {
        seen.entrySet().removeIf(entry -> entry.getValue().plus(ttl).isBefore(now));

        while (seen.size() > maxEntries) {
            UUID oldest = seen.keySet().iterator().next();
            seen.remove(oldest);
        }
    }
}
```

Namun untuk production serius:

- gunakan bounded cache seperti Caffeine jika dependency diperbolehkan
- gunakan persistent dedup jika duplicate setelah restart berbahaya
- gunakan database unique constraint jika efeknya durable
- jangan hanya mengandalkan memory jika command mengubah state penting

---

## 15. UDP Acknowledgement dan Retry

UDP tidak punya ACK bawaan. Jika butuh delivery confirmation, aplikasi harus membuat sendiri.

Contoh message types:

```text
DATA = 1
ACK  = 2
NACK = 3
```

Flow:

```text
Sender:
  send DATA(seq=10, id=abc)
  wait ACK(id=abc) up to timeout
  retry up to N times
  if still no ACK -> failed/unknown

Receiver:
  receive DATA(id=abc)
  if duplicate -> resend ACK, do not reprocess side effect
  if new -> process, then send ACK
```

Poin penting:

```text
ACK juga bisa hilang.
```

Maka receiver harus idempotent.

Failure case:

```text
1. Receiver menerima DATA.
2. Receiver memproses side effect.
3. Receiver mengirim ACK.
4. ACK hilang.
5. Sender retry DATA.
6. Receiver harus mengenali duplicate dan tidak mengulang side effect.
```

Tanpa dedup/idempotency, retry UDP bisa membuat kerusakan data.

---

## 16. Heartbeat Dengan UDP

UDP cocok untuk heartbeat ringan karena:

- message kecil
- stateless
- loss satu packet tidak selalu fatal
- periodic signal lebih penting daripada guaranteed delivery

Contoh format heartbeat:

```json
{
  "nodeId": "worker-7",
  "sequence": 918273,
  "timestamp": 1730000000000,
  "status": "UP",
  "load": 0.72
}
```

Tetapi untuk UDP, JSON bisa terlalu besar. Binary kecil sering lebih cocok.

Receiver logic:

```text
on heartbeat(nodeId, timestamp):
  lastSeen[nodeId] = now

periodic check:
  if now - lastSeen[nodeId] > expiry:
      mark SUSPECT
  if now - lastSeen[nodeId] > hardExpiry:
      mark DOWN
```

Jangan langsung mark DOWN karena satu packet hilang.

Gunakan state:

```text
UNKNOWN -> ALIVE -> SUSPECT -> DOWN -> ALIVE
```

---

## 17. Discovery Protocol Dengan UDP Broadcast

UDP sering dipakai untuk local network discovery.

Flow:

```text
Client broadcast:
  WHO_IS_SERVICE_X?

Server reply unicast:
  SERVICE_X_HERE host=10.0.0.12 port=8080 version=3
```

Sender broadcast:

```java
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

public final class BroadcastDiscoveryClient {
    public static void main(String[] args) throws Exception {
        byte[] payload = "DISCOVER_MY_SERVICE_V1".getBytes(StandardCharsets.UTF_8);

        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true);
            socket.setSoTimeout(2_000);

            DatagramPacket packet = new DatagramPacket(
                    payload,
                    payload.length,
                    InetAddress.getByName("255.255.255.255"),
                    9999
            );

            socket.send(packet);
        }
    }
}
```

Caveat broadcast:

- sering dibatasi router
- bisa diblok firewall
- tidak cocok lintas subnet tanpa konfigurasi
- bisa noisy jika terlalu sering
- raw broadcast di cloud/container sering tidak tersedia

---

## 18. Multicast: Satu Sender, Banyak Receiver

Multicast memungkinkan sender mengirim ke group address, lalu host yang join group dapat menerima packet.

Use case:

- service discovery di LAN
- market data distribution
- cluster membership tertentu
- telemetry lokal
- media streaming internal

Multicast bukan broadcast.

```text
Broadcast:
  kirim ke semua host di network segment.

Multicast:
  kirim ke group address; host yang join group menerima.
```

### 18.1 Multicast Dengan `MulticastSocket`

```java
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;

public final class MulticastReceiver {
    public static void main(String[] args) throws Exception {
        InetAddress group = InetAddress.getByName("230.0.0.1");
        int port = 4446;

        NetworkInterface networkInterface = NetworkInterface.getByInetAddress(
                InetAddress.getLocalHost()
        );

        byte[] buffer = new byte[1024];

        try (MulticastSocket socket = new MulticastSocket(port)) {
            socket.joinGroup(new InetSocketAddress(group, port), networkInterface);

            while (true) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                socket.receive(packet);

                String message = new String(
                        packet.getData(),
                        packet.getOffset(),
                        packet.getLength(),
                        StandardCharsets.UTF_8
                );

                System.out.println("multicast: " + message);
            }
        }
    }
}
```

Sender:

```java
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.nio.charset.StandardCharsets;

public final class MulticastSender {
    public static void main(String[] args) throws Exception {
        InetAddress group = InetAddress.getByName("230.0.0.1");
        int port = 4446;
        byte[] payload = "hello multicast".getBytes(StandardCharsets.UTF_8);

        try (MulticastSocket socket = new MulticastSocket()) {
            socket.setTimeToLive(1);
            DatagramPacket packet = new DatagramPacket(payload, payload.length, group, port);
            socket.send(packet);
        }
    }
}
```

TTL penting:

```text
TTL rendah membatasi seberapa jauh multicast packet dapat melewati network.
TTL=1 biasanya hanya local network.
```

### 18.2 Multicast Dengan `DatagramChannel`

Dokumentasi Java menyarankan mempertimbangkan `DatagramChannel` untuk multicasting karena ia mengimplementasikan `MulticastChannel` dan mendukung any-source serta source-specific multicast.

```java
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.ByteBuffer;
import java.nio.channels.DatagramChannel;
import java.nio.channels.MembershipKey;
import java.nio.charset.StandardCharsets;
import java.net.StandardProtocolFamily;
import java.net.StandardSocketOptions;

public final class NioMulticastReceiver {
    public static void main(String[] args) throws Exception {
        InetAddress group = InetAddress.getByName("230.0.0.1");
        int port = 4446;

        NetworkInterface networkInterface = NetworkInterface.getByName("eth0");

        try (DatagramChannel channel = DatagramChannel.open(StandardProtocolFamily.INET)) {
            channel.setOption(StandardSocketOptions.SO_REUSEADDR, true);
            channel.bind(new InetSocketAddress(port));
            channel.setOption(StandardSocketOptions.IP_MULTICAST_IF, networkInterface);

            MembershipKey key = channel.join(group, networkInterface);

            ByteBuffer buffer = ByteBuffer.allocate(1024);
            while (key.isValid()) {
                buffer.clear();
                channel.receive(buffer);
                buffer.flip();

                String message = StandardCharsets.UTF_8.decode(buffer).toString();
                System.out.println(message);
            }
        }
    }
}
```

Caveat:

- nama interface `eth0` tidak portable
- di Windows/macOS/container bisa berbeda
- production code harus memilih interface secara eksplisit berdasarkan config
- multicast behavior sangat tergantung network, router, firewall, cloud provider, dan container runtime

---

## 19. NetworkInterface Selection

Untuk multicast, pemilihan network interface sangat penting.

Contoh enumerasi interface:

```java
import java.net.NetworkInterface;
import java.util.Collections;

public final class ListNetworkInterfaces {
    public static void main(String[] args) throws Exception {
        for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            System.out.printf(
                    "name=%s display=%s up=%s loopback=%s multicast=%s%n",
                    ni.getName(),
                    ni.getDisplayName(),
                    ni.isUp(),
                    ni.isLoopback(),
                    ni.supportsMulticast()
            );
        }
    }
}
```

Production rule:

```text
Jangan pilih NetworkInterface secara implicit/random.
Buat config eksplisit: interface name atau bind address.
```

Karena host modern bisa punya:

- loopback
- Wi-Fi
- Ethernet
- VPN
- Docker bridge
- Kubernetes CNI
- IPv6 interface
- cloud metadata interface

---

## 20. MTU, Packet Size, dan Fragmentation

UDP datagram memiliki theoretical maximum sekitar 65 KB, tetapi itu bukan ukuran yang aman untuk production.

Masalahnya ada pada MTU.

```text
Ethernet MTU umum: 1500 bytes
IPv4 header:       20 bytes minimum
UDP header:         8 bytes
Payload aman kasar: 1472 bytes sebelum IP fragmentation di Ethernet biasa
```

Namun public internet, VPN, tunnel, cloud overlay, IPv6, dan network path lain dapat menurunkan effective MTU.

Prinsip desain:

```text
Jangan desain UDP payload mendekati 65 KB.
Gunakan packet kecil.
Jika data besar, pecah sendiri atau gunakan TCP/HTTP.
```

Untuk data besar, pilih:

- TCP
- HTTP streaming
- file transfer dengan resume
- object storage signed URL
- message broker
- QUIC/library khusus jika memang perlu UDP-based reliable transport

---

## 21. Rate Limiting Untuk UDP Sender

Karena UDP tidak punya flow control, sender harus bertanggung jawab.

Contoh simple token bucket:

```java
public final class SimpleRateLimiter {
    private final long intervalNanos;
    private long nextAllowedTime;

    public SimpleRateLimiter(int permitsPerSecond) {
        if (permitsPerSecond <= 0) {
            throw new IllegalArgumentException("permitsPerSecond must be positive");
        }
        this.intervalNanos = 1_000_000_000L / permitsPerSecond;
        this.nextAllowedTime = System.nanoTime();
    }

    public void acquire() throws InterruptedException {
        long now = System.nanoTime();
        long waitNanos = nextAllowedTime - now;

        if (waitNanos > 0) {
            Thread.sleep(waitNanos / 1_000_000L, (int) (waitNanos % 1_000_000L));
        }

        nextAllowedTime = Math.max(nextAllowedTime + intervalNanos, System.nanoTime());
    }
}
```

Pemakaian:

```java
SimpleRateLimiter limiter = new SimpleRateLimiter(500);

for (int i = 0; i < 10_000; i++) {
    limiter.acquire();
    // send UDP packet
}
```

Untuk production, gunakan rate limiter yang lebih matang, tetapi mental model-nya sama:

```text
UDP sender harus dibatasi agar tidak menghancurkan receiver/network.
```

---

## 22. UDP dan Security

UDP sering menjadi target abuse karena connectionless dan mudah dipalsukan dalam beberapa skenario network.

Risiko:

- spoofed source address
- amplification attack
- reflection attack
- unauthenticated command
- packet injection
- replay attack
- information leakage via discovery
- denial of service via packet flood

### 22.1 Jangan Terima Command Penting Tanpa Authentication

Buruk:

```text
UDP packet:
  DELETE_CASE 123
```

Sangat berbahaya.

Lebih aman:

- jangan gunakan UDP untuk command penting
- gunakan TLS-authenticated channel
- jika tetap UDP, gunakan HMAC/signature, nonce, timestamp, replay protection, dan allowlist source

### 22.2 HMAC untuk Packet Integrity dan Authentication

Konsep header:

```text
messageId
timestamp
payload
hmac = HMAC-SHA256(secret, messageId || timestamp || payload)
```

Receiver:

1. Validasi timestamp dalam window.
2. Validasi HMAC constant-time compare.
3. Validasi message id belum pernah dipakai.
4. Validasi payload schema.
5. Baru proses.

Untuk internal LAN sekalipun, jangan menganggap network selalu trusted.

---

## 23. UDP Untuk Telemetry

UDP bisa cocok untuk telemetry karena:

- event kecil
- frekuensi tinggi
- kehilangan sebagian data masih acceptable
- latency lebih penting daripada reliability sempurna

Contoh:

```text
metric packet:
  service=payment-api
  metric=request.count
  value=1
  timestamp=...
```

Tetapi tetap ada rule:

- metrics harus aggregatable
- jangan kirim audit trail penting via UDP-only
- jangan kirim PII tanpa encryption
- receiver harus tolerate drop dan duplicate
- sampling harus eksplisit
- monitoring harus tahu data bisa lossy

Anti-pattern:

```text
Mengirim regulatory audit event via UDP lalu menganggapnya durable.
```

---

## 24. UDP Untuk Workflow dan State Machine: Hampir Selalu Salah

Untuk domain regulatory/case management/enforcement lifecycle, UDP mentah hampir tidak pernah cocok untuk command/state transition.

Contoh state transition:

```text
CASE_SUBMITTED -> UNDER_REVIEW
NOTICE_DRAFTED -> NOTICE_SENT
PAYMENT_PENDING -> PAYMENT_CONFIRMED
APPEAL_OPEN -> APPEAL_CLOSED
```

Ini membutuhkan:

- durability
- ordering
- idempotency
- auditability
- causality
- access control
- retry semantics
- reconciliation
- exactly-once illusion management

UDP tidak menyediakan itu.

Jika memakai UDP untuk trigger, jadikan hanya signal:

```text
UDP signal:
  "something may have changed"

System of record:
  database / durable queue / event log

Consumer:
  fetch actual state from durable source
```

Pattern aman:

```text
UDP = notification hint
DB/Kafka/RabbitMQ/HTTP = source of truth
```

---

## 25. Kapan UDP Cocok

Gunakan UDP jika sebagian besar benar:

1. Payload kecil.
2. Data self-contained.
3. Loss dapat diterima atau ditangani aplikasi.
4. Ordering tidak wajib atau ditangani aplikasi.
5. Duplicate dapat diterima atau ditangani aplikasi.
6. Latency lebih penting daripada guaranteed delivery.
7. Ada rate limiting.
8. Ada authentication jika di boundary tidak trusted.
9. Ada observability untuk drop/loss.
10. Ada fallback/reconciliation jika informasi penting.

Contoh cocok:

| Use Case | Kenapa Cocok |
|---|---|
| heartbeat | packet periodik, loss kecil acceptable |
| service discovery LAN | request/response ringan, retry bisa dilakukan |
| telemetry sampling | sebagian loss acceptable |
| realtime position update | data lama tidak berguna |
| multicast market data | fan-out tinggi, aplikasi punya sequence/loss handling |
| local control signal non-critical | low overhead |

---

## 26. Kapan Jangan Memakai UDP

Jangan memakai UDP mentah untuk:

| Use Case | Alasan |
|---|---|
| file upload/download besar | perlu reliability, resume, checksum, flow control |
| payment command | perlu durability dan exactly-once-like semantics |
| legal/regulatory audit | tidak boleh silently lost |
| state transition case | perlu ordering dan auditability |
| document transfer | perlu integrity dan completeness |
| user-facing critical request | failure semantics sulit |
| cross-internet enterprise integration | NAT/firewall/reliability/security sulit |
| large JSON event | fragmentation/drop risk |
| anything requiring transaction | UDP tidak transactional |

Rule kuat:

```text
Jika kamu tidak bisa menjelaskan apa yang terjadi saat packet hilang,
jangan gunakan UDP.
```

---

## 27. UDP vs TCP vs HTTP vs Broker

| Requirement | UDP | TCP | HTTP | Broker/Event Log |
|---|---:|---:|---:|---:|
| Small lossy signal | excellent | okay | overkill | overkill |
| Reliable stream | poor | excellent | good | depends |
| Request/response API | poor | custom | excellent | poor-medium |
| Large file transfer | poor | medium | excellent | poor |
| Durable event | poor | custom | medium | excellent |
| Multicast LAN | good | poor | poor | medium with fanout |
| Auditability | poor | custom | medium | excellent |
| Browser/client compatibility | poor | poor | excellent | poor |
| NAT/firewall friendliness | medium-poor | medium | excellent | medium |
| Backpressure | app only | built-in | built on TCP | built-in depending broker |

Decision heuristic:

```text
Need durable business event? Use broker/event log.
Need external API? Use HTTP/gRPC.
Need large file? Use HTTP/object storage/TCP protocol.
Need low-latency lossy signal? Consider UDP.
Need multicast local distribution? Consider UDP multicast.
```

---

## 28. Production UDP Receiver Checklist

Sebuah UDP receiver production-grade minimal harus punya:

```text
[ ] Explicit bind address and port
[ ] Explicit receive buffer size
[ ] Max datagram size
[ ] Packet schema validation
[ ] Magic/version/type validation
[ ] Source validation if needed
[ ] Authentication/integrity if not fully trusted
[ ] Timestamp/TTL validation
[ ] Replay protection if command-like
[ ] Deduplication if side effect possible
[ ] Sequence tracking if loss/reorder matters
[ ] Drop policy for invalid packet
[ ] Rate limit / flood protection
[ ] Metrics for received/dropped/invalid/duplicate/out-of-order
[ ] Logging with sampling
[ ] Graceful shutdown
[ ] Periodic reconciliation if packet loss matters
```

---

## 29. Production UDP Sender Checklist

```text
[ ] Explicit destination config
[ ] Bounded payload size
[ ] Encoding/versioning stable
[ ] Sequence number if needed
[ ] Message id if dedup needed
[ ] Timestamp if expiry needed
[ ] HMAC/signature if untrusted boundary
[ ] Rate limiting
[ ] Retry only if receiver idempotent
[ ] ACK handling if confirmation required
[ ] Metrics for sent/retried/failed/ack timeout
[ ] Avoid sending huge datagrams
[ ] Avoid unbounded queue before sender
[ ] Clear failure semantics: delivered, maybe delivered, unknown
```

---

## 30. Common Anti-Patterns

### 30.1 Mengirim File Lewat UDP Mentah

Buruk:

```text
Split file menjadi UDP packets lalu berharap semuanya sampai.
```

Akan bermasalah dengan:

- loss
- reordering
- duplicate
- congestion
- resume
- integrity
- flow control
- NAT/firewall

Jika benar-benar ingin reliable UDP, kamu sedang membangun ulang sebagian TCP/QUIC.

### 30.2 Tidak Punya Max Packet Size

Buruk:

```java
byte[] buffer = new byte[65535];
```

dan membiarkan payload arbitrarily besar.

Lebih baik:

```text
Protocol max datagram size: 1200 bytes
Drop packet > max
```

### 30.3 Menganggap `send()` Berarti Delivered

Buruk:

```java
socket.send(packet);
markAsDelivered();
```

Benar:

```text
send() hanya berarti packet diserahkan ke local socket/network stack sejauh API berhasil.
Remote delivery tetap unknown.
```

### 30.4 Memproses Command Tanpa Dedup

Buruk:

```text
UDP packet: APPROVE_CASE caseId=123
receiver langsung update DB
```

Jika packet duplicate, state transition bisa kacau.

### 30.5 Discovery Tanpa Authentication

Discovery bisa membocorkan:

- hostname
- internal IP
- service version
- environment
- port
- topology

Gunakan boundary control.

---

## 31. Failure Scenario Table

| Scenario | Gejala | Root Cause | Mitigasi |
|---|---|---|---|
| packet hilang | sequence gap | network/receiver buffer drop | sequence tracking, retry, reconciliation |
| packet duplicate | side effect double | retry/dup network | message id, dedup, idempotency |
| packet reorder | sequence mundur/maju | routing/network scheduling | sliding window, reorder buffer |
| packet truncated | parse error/length mismatch | receive buffer kecil | fixed max size, validate length |
| flood | CPU tinggi/drop tinggi | sender terlalu cepat/attack | rate limit, firewall, drop policy |
| multicast tidak diterima | receiver silent | interface salah/router/firewall | explicit NetworkInterface, TTL, network config |
| broadcast tidak bekerja | tidak ada response | subnet/cloud blocks broadcast | config/static discovery/registry |
| ACK hilang | sender retry padahal receiver sudah proses | UDP lossy | idempotent receiver, duplicate ACK |
| old packet diterima | stale update | delayed/replayed datagram | timestamp TTL, nonce/replay protection |
| huge datagram drop | sporadic missing data | fragmentation loss | small payload, TCP for large data |

---

## 32. Testing UDP

UDP testing harus sengaja memasukkan failure.

### 32.1 Unit Test Codec

Test:

- valid packet
- wrong magic
- unsupported version
- payload length mismatch
- oversized payload
- truncated header
- invalid UTF-8 jika text

### 32.2 Integration Test Localhost

Test:

- sender -> receiver
- timeout
- duplicate packet
- packet reorder simulation
- invalid packet ignored

### 32.3 Fault Injection

Simulasikan:

- random drop
- duplicate
- reorder
- delay
- corruption

Contoh wrapper test:

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

public final class DatagramFaultInjector<T> {
    private final Random random = new Random(42);

    public List<T> transmit(List<T> packets) {
        List<T> result = new ArrayList<>();

        for (T packet : packets) {
            if (random.nextDouble() < 0.10) {
                continue; // drop
            }

            result.add(packet);

            if (random.nextDouble() < 0.05) {
                result.add(packet); // duplicate
            }
        }

        Collections.shuffle(result, random); // reorder
        return result;
    }
}
```

### 32.4 Observability Test

Pastikan metric tersedia:

```text
udp_packets_received_total
udp_packets_sent_total
udp_packets_dropped_total
udp_packets_invalid_total
udp_packets_duplicate_total
udp_packets_out_of_order_total
udp_packet_gap_total
udp_receive_bytes_total
udp_send_bytes_total
udp_ack_timeout_total
udp_retry_total
```

---

## 33. Operational Runbook

### 33.1 Receiver Tidak Menerima Packet

Check:

1. Bind address benar?
2. Port benar?
3. Firewall/security group membuka UDP, bukan hanya TCP?
4. Process listen di expected port?
5. Interface benar?
6. Sender mengirim ke IP/subnet yang benar?
7. Container/Kubernetes mapping mendukung UDP?
8. Multicast/broadcast didukung network?
9. Packet terlalu besar dan drop?
10. Receiver buffer penuh?

### 33.2 Packet Loss Tinggi

Check:

1. Sender rate terlalu tinggi?
2. Receiver CPU saturated?
3. Socket receive buffer terlalu kecil?
4. GC pause receiver?
5. Network congestion?
6. Packet size terlalu besar?
7. Fragmentation?
8. Firewall/rate-limit device?
9. Logs terlalu banyak di receiver loop?
10. Single-thread receiver tidak cukup?

### 33.3 Multicast Tidak Bekerja

Check:

1. Group address valid?
2. Port sama?
3. TTL cukup?
4. Network interface benar?
5. Interface mendukung multicast?
6. Router/switch mendukung multicast?
7. IGMP snooping behavior?
8. Firewall OS?
9. Container network mode?
10. Cloud provider support?

---

## 34. Mental Model Final

UDP memberikan:

```text
message boundary + low overhead + optional multicast/broadcast
```

Tetapi tidak memberikan:

```text
reliable delivery
ordering
deduplication
flow control
congestion control
transactionality
auditability
```

Karena itu keputusan memakai UDP harus dimulai dari failure semantics:

```text
Apa yang terjadi jika packet hilang?
Apa yang terjadi jika packet duplicate?
Apa yang terjadi jika packet datang terlambat?
Apa yang terjadi jika packet reorder?
Apa yang terjadi jika sender lebih cepat dari receiver?
Apa yang terjadi jika packet dipalsukan?
```

Jika jawabanmu belum jelas, desain belum siap.

---

## 35. Ringkasan

1. UDP adalah datagram transport, bukan byte stream.
2. UDP menjaga boundary message, tetapi tidak menjamin delivery, ordering, atau uniqueness.
3. Java menyediakan `DatagramSocket`/`DatagramPacket` untuk model klasik dan `DatagramChannel` untuk NIO/non-blocking/multicast modern.
4. Multicast berguna untuk fan-out lokal, tetapi sangat tergantung network/interface/router/firewall.
5. UDP cocok untuk signal kecil, lossy, low-latency, dan self-contained.
6. UDP buruk untuk file besar, command penting, audit, state transition, dan workflow yang butuh durability.
7. Production UDP butuh protocol discipline: max packet size, versioning, sequence, timestamp, dedup, auth, rate limit, metrics, dan reconciliation.
8. Jika kamu mulai membangun reliability kompleks di atas UDP, evaluasi ulang apakah TCP, HTTP, broker, atau QUIC/library khusus lebih tepat.

---

## 36. Latihan

### Latihan 1 — UDP Echo

Buat UDP echo server dengan `DatagramSocket`:

- menerima datagram
- print address sender
- kirim balik payload yang sama
- timeout setiap 5 detik untuk print heartbeat server

### Latihan 2 — Binary Packet Codec

Buat codec dengan header:

```text
magic: 2 bytes
version: 1 byte
type: 1 byte
messageId: 16 bytes UUID
sequence: 4 bytes
payloadLength: 2 bytes
payload: bytes
```

Tambahkan validasi:

- magic salah
- version tidak didukung
- payload terlalu besar
- length mismatch

### Latihan 3 — Loss Detection

Buat sender yang mengirim sequence 1 sampai 10_000.

Receiver harus menghitung:

- received count
- duplicate count
- gap count
- out-of-order count

### Latihan 4 — Discovery

Buat local discovery:

- client broadcast `DISCOVER_X`
- server reply `X_HERE host port version`
- client menunggu response 2 detik

### Latihan 5 — Design Exercise

Desain heartbeat service untuk 500 worker node:

- heartbeat interval
- expiry threshold
- packet format
- sequence handling
- duplicate handling
- metrics
- failure state machine
- apa yang terjadi saat network partition

---

## 37. Checklist Pemahaman

Kamu siap lanjut jika bisa menjawab:

```text
[ ] Apa perbedaan utama TCP stream dan UDP datagram?
[ ] Kenapa UDP tidak butuh framing seperti TCP tetapi tetap butuh packet schema?
[ ] Apa yang terjadi jika UDP packet hilang?
[ ] Apa yang terjadi jika packet duplicate?
[ ] Kenapa datagram besar berbahaya?
[ ] Apa fungsi sequence number?
[ ] Apa fungsi message id?
[ ] Apa fungsi timestamp/TTL?
[ ] Kenapa ACK UDP tetap tidak cukup tanpa idempotency?
[ ] Kapan multicast lebih tepat daripada broadcast?
[ ] Kenapa UDP tidak cocok untuk audit trail?
[ ] Kapan `DatagramChannel` lebih tepat daripada `DatagramSocket`?
```

---

## 38. Transisi ke Part Berikutnya

Di part ini kita membahas UDP, datagram, dan multicast sebagai transport low-level.

Part berikutnya akan naik ke protokol aplikasi modern:

```text
Part 023 — HTTP Data Transfer: Java HTTP Client, Streaming Body, Timeout, Redirect, Proxy, dan TLS
```

Di sana fokusnya bukan lagi packet datagram, tetapi data transfer berbasis HTTP:

- `java.net.http.HttpClient`
- streaming upload/download
- body publisher/body handler
- timeout
- redirect
- proxy
- TLS
- large payload
- range request
- retry safety
- idempotency
- checksum verification

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 021 — NIO Networking: `SocketChannel`, `ServerSocketChannel`, `Selector`, dan Event Loop](./learn-java-io-nio-networking-data-transfer-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 023 — HTTP Data Transfer: Java HTTP Client, Streaming Body, Timeout, Redirect, Proxy, dan TLS](./learn-java-io-nio-networking-data-transfer-part-023.md)

</div>