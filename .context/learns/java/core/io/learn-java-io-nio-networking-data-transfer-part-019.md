# Part 019 — Networking I: `java.net` Foundation, Address, DNS, URI, URL, Socket Basics

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-019.md`  
> Status seri: **belum selesai**  
> Part sebelumnya: Part 018 — Compression: ZIP, GZIP, Deflater, Inflater, Tar Concept, dan Streaming Compression  
> Part berikutnya: Part 020 — Networking II: TCP Framing, Protocol Design, Partial Read/Write, dan Backpressure

---

## 1. Tujuan Pembelajaran

Bagian ini membangun fondasi networking Java dari level paling dasar:

- apa itu address;
- apa itu endpoint;
- bagaimana hostname di-resolve menjadi IP;
- perbedaan `URI` dan `URL`;
- bagaimana `Socket` dan `ServerSocket` bekerja;
- apa arti timeout;
- kenapa TCP adalah byte stream, bukan message stream;
- bagaimana lifecycle koneksi terjadi;
- bagaimana masalah production seperti DNS cache, `TIME_WAIT`, ephemeral port exhaustion, half-close, dan socket leak muncul.

Target akhir part ini bukan sekadar bisa menulis:

```java
Socket socket = new Socket("example.com", 80);
```

Tetapi mampu berpikir seperti engineer yang memahami boundary:

```text
application
  -> Java API
    -> JVM socket abstraction
      -> operating system socket
        -> TCP/IP stack
          -> network
            -> remote endpoint
```

Dan mampu bertanya:

- Apakah hostname ini sudah di-resolve?
- Apakah IP yang dipakai stale karena DNS cache?
- Apakah timeout yang diset hanya connect timeout atau juga read timeout?
- Apakah socket ditutup dengan benar?
- Apakah protocol punya framing?
- Apakah koneksi bisa half-open?
- Apakah retry bisa menyebabkan duplicate request?
- Apakah masalahnya di aplikasi, JVM, OS, DNS, NAT, load balancer, firewall, atau remote server?

---

## 2. Mental Model Besar: Networking Adalah I/O ke Endpoint Jauh

Networking pada dasarnya adalah **I/O terhadap resource yang tidak lokal**.

Pada file I/O, resource yang dibaca/ditulis adalah file atau filesystem.

Pada network I/O, resource yang dibaca/ditulis adalah connection atau datagram endpoint.

Secara konseptual:

```text
File I/O:
  process -> file descriptor -> filesystem -> disk/page cache

Network I/O:
  process -> socket descriptor -> kernel TCP/IP stack -> network -> remote process
```

Java menyembunyikan sebagian detail OS melalui class seperti:

- `InetAddress`
- `InetSocketAddress`
- `Socket`
- `ServerSocket`
- `DatagramSocket`
- `URI`
- `URL`
- `NetworkInterface`

Tetapi abstraction Java tidak menghilangkan realitas penting:

- DNS bisa berubah.
- IP bisa reachable atau tidak.
- Firewall bisa menolak koneksi.
- NAT bisa memutus idle connection.
- TCP bisa menerima partial data.
- Read bisa blocking selamanya jika tidak ada timeout.
- Write bisa tertahan karena remote lambat.
- Connection bisa half-open.
- Close bisa graceful atau abrupt.
- Timeout bukan bukti server tidak memproses request.
- Retry bukan operasi netral.

Networking adalah domain di mana **ketidakpastian adalah kondisi normal**, bukan edge case.

---

## 3. Package `java.net`: Peta Besar

Package `java.net` menyediakan class untuk networking application. Secara besar, isinya bisa dikelompokkan menjadi beberapa area.

```text
java.net
├── address abstraction
│   ├── InetAddress
│   ├── Inet4Address
│   ├── Inet6Address
│   └── InetSocketAddress
│
├── local network interface
│   └── NetworkInterface
│
├── URI/URL abstraction
│   ├── URI
│   ├── URL
│   ├── URLConnection
│   └── HttpURLConnection
│
├── TCP socket
│   ├── Socket
│   ├── ServerSocket
│   └── SocketAddress
│
├── UDP datagram
│   ├── DatagramSocket
│   ├── DatagramPacket
│   └── MulticastSocket
│
├── proxy/cookie/authenticator
│   ├── Proxy
│   ├── ProxySelector
│   ├── CookieManager
│   └── Authenticator
│
└── exception hierarchy
    ├── UnknownHostException
    ├── ConnectException
    ├── SocketTimeoutException
    ├── SocketException
    ├── BindException
    └── NoRouteToHostException
```

Part ini fokus pada fondasi:

- address;
- DNS;
- URI/URL;
- TCP socket;
- connection lifecycle;
- timeout;
- production failure model.

UDP akan dibahas khusus di Part 022. HTTP modern dengan `java.net.http.HttpClient` akan dibahas di Part 023.

---

## 4. Address, Hostname, IP, dan Endpoint

### 4.1 Hostname Bukan IP

Hostname adalah nama:

```text
api.example.com
database.internal
localhost
```

IP address adalah alamat jaringan:

```text
93.184.216.34
127.0.0.1
::1
2001:db8::1
```

Hostname harus di-resolve menjadi satu atau lebih IP melalui DNS atau mekanisme resolver lain.

```text
hostname
  -> resolver
    -> one or more IP addresses
```

Contoh:

```java
import java.net.InetAddress;
import java.util.Arrays;

public class ResolveHostExample {
    public static void main(String[] args) throws Exception {
        InetAddress[] addresses = InetAddress.getAllByName("example.com");

        Arrays.stream(addresses)
                .forEach(address -> System.out.println(address.getHostAddress()));
    }
}
```

Output bisa berbeda antar waktu, jaringan, region, atau konfigurasi DNS.

Implikasinya:

- Jangan menganggap hostname selalu menunjuk ke satu IP.
- Jangan menganggap urutan IP selalu sama.
- Jangan menganggap hasil DNS tidak berubah.
- Jangan cache IP sendiri tanpa policy.
- Jangan menyimpan resolved IP sebagai konfigurasi kecuali memang sengaja bypass DNS.

---

### 4.2 `InetAddress`

`InetAddress` adalah abstraction Java untuk IP address.

Subclass-nya:

```text
InetAddress
├── Inet4Address
└── Inet6Address
```

Contoh:

```java
import java.net.InetAddress;

public class InetAddressExample {
    public static void main(String[] args) throws Exception {
        InetAddress local = InetAddress.getLocalHost();
        InetAddress loopback = InetAddress.getLoopbackAddress();
        InetAddress remote = InetAddress.getByName("example.com");

        System.out.println("local    = " + local);
        System.out.println("loopback = " + loopback);
        System.out.println("remote   = " + remote);
        System.out.println("hostAddress = " + remote.getHostAddress());
        System.out.println("hostName    = " + remote.getHostName());
    }
}
```

Poin penting:

- `getByName()` bisa melakukan DNS resolution.
- `getAllByName()` bisa mengembalikan beberapa address.
- `getHostName()` bisa melakukan reverse lookup tergantung kondisi.
- Reverse lookup bisa lambat atau gagal.
- IP literal tidak selalu membutuhkan DNS forward lookup.
- `InetAddress` bisa merepresentasikan IPv4 atau IPv6.

---

### 4.3 `InetSocketAddress`

`InetSocketAddress` merepresentasikan endpoint socket:

```text
IP/hostname + port
```

Contoh:

```java
import java.net.InetSocketAddress;

public class InetSocketAddressExample {
    public static void main(String[] args) {
        InetSocketAddress resolved =
                new InetSocketAddress("example.com", 443);

        InetSocketAddress unresolved =
                InetSocketAddress.createUnresolved("example.com", 443);

        System.out.println("resolved?   " + !resolved.isUnresolved());
        System.out.println("unresolved? " + unresolved.isUnresolved());
    }
}
```

Poin penting:

- Port valid berada pada range `0..65535`.
- Port `0` saat bind berarti meminta OS memilih ephemeral port.
- `createUnresolved()` membuat address tanpa langsung melakukan DNS resolution.
- Resolved vs unresolved penting pada proxy, custom resolver, lazy connection, dan error attribution.

Mental model:

```text
InetAddress       = address
InetSocketAddress = endpoint address + port
Socket            = connection object
```

---

## 5. Port, Ephemeral Port, dan Bind

Port adalah angka 16-bit yang mengidentifikasi endpoint transport pada host.

```text
IP address identifies host/interface.
Port identifies process/service endpoint.
```

Contoh:

```text
203.0.113.10:443
127.0.0.1:8080
[::1]:5432
```

### 5.1 Server Bind

Server biasanya bind ke local address dan port.

```java
import java.net.ServerSocket;

public class SimpleBindExample {
    public static void main(String[] args) throws Exception {
        try (ServerSocket server = new ServerSocket(8080)) {
            System.out.println("Listening on " + server.getLocalSocketAddress());
            Thread.sleep(60_000);
        }
    }
}
```

Jika port sudah dipakai, biasanya muncul:

```text
java.net.BindException: Address already in use
```

### 5.2 Bind ke Wildcard vs Specific Address

Bind ke semua interface:

```java
new ServerSocket(8080);
```

Atau explicit:

```java
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;

public class SpecificBindExample {
    public static void main(String[] args) throws Exception {
        InetAddress loopback = InetAddress.getLoopbackAddress();

        try (ServerSocket server = new ServerSocket()) {
            server.bind(new InetSocketAddress(loopback, 8080));
            System.out.println("Listening only on loopback: " + server.getLocalSocketAddress());
            Thread.sleep(60_000);
        }
    }
}
```

Perbedaan:

```text
0.0.0.0:8080      -> listen on all IPv4 interfaces
127.0.0.1:8080    -> listen only on local loopback
specific IP:8080  -> listen only on that interface/address
```

Di production, bind address menentukan exposure:

- `127.0.0.1` cocok untuk local-only service.
- `0.0.0.0` membuka service ke semua interface yang diizinkan firewall/security group.
- Di container, `0.0.0.0` sering diperlukan agar port bisa diakses dari luar container.
- Salah bind bisa menyebabkan service tidak reachable atau terlalu terbuka.

### 5.3 Client Ephemeral Port

Saat client connect ke server:

```text
client_ip:ephemeral_port -> server_ip:server_port
```

Contoh:

```text
10.0.1.20:51842 -> 203.0.113.10:443
```

OS memilih ephemeral port untuk sisi client.

Masalah production:

- Terlalu banyak koneksi baru bisa menghabiskan ephemeral port.
- Connection leak bisa menahan port.
- `TIME_WAIT` bisa menumpuk.
- NAT gateway/load balancer juga punya limit connection tracking.
- Retry agresif bisa memperburuk port exhaustion.

---

## 6. DNS Resolution dan Caching

### 6.1 DNS Adalah Dependency

Saat aplikasi connect ke hostname:

```text
api.example.com:443
```

Biasanya flow-nya:

```text
1. JVM/application menerima hostname.
2. Resolver mencari IP.
3. Hasil DNS dikembalikan.
4. Socket connect ke IP tertentu.
5. TCP handshake terjadi.
```

Jika DNS gagal:

```text
UnknownHostException
```

Contoh:

```java
import java.net.InetAddress;
import java.net.UnknownHostException;

public class UnknownHostExample {
    public static void main(String[] args) {
        try {
            InetAddress.getByName("not-a-real-domain.invalid");
        } catch (UnknownHostException e) {
            System.err.println("DNS/host resolution failed: " + e.getMessage());
        }
    }
}
```

### 6.2 DNS Cache JVM

JVM dapat cache hasil DNS lookup.

Dua property penting:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

Konsep:

- positive cache TTL: berapa lama hasil sukses disimpan;
- negative cache TTL: berapa lama kegagalan lookup disimpan.

Risiko:

- TTL terlalu lama dapat membuat aplikasi tetap memakai IP lama setelah DNS berubah.
- TTL terlalu pendek dapat membebani DNS/resolver.
- Negative TTL terlalu lama dapat membuat recovery lambat setelah DNS sempat gagal.
- Dalam environment cloud/Kubernetes/load balancer, DNS bisa berubah lebih sering daripada asumsi enterprise lama.

Pola berpikir:

```text
DNS is not just startup config.
DNS is runtime dependency.
```

### 6.3 DNS Tidak Sama dengan Health Check

DNS resolve sukses tidak berarti service sehat.

```text
DNS success only means:
  hostname -> IP mapping exists

It does not mean:
  port open
  TLS valid
  application healthy
  request will succeed
```

Layer failure:

```text
DNS lookup success
  but TCP connect fails

TCP connect success
  but TLS handshake fails

TLS success
  but HTTP 503

HTTP 200
  but body invalid/corrupt
```

Setiap layer perlu observability dan error classification sendiri.

---

## 7. `NetworkInterface`: Melihat Interface Lokal

`NetworkInterface` merepresentasikan network interface di host lokal.

Contoh:

```java
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

public class NetworkInterfaceExample {
    public static void main(String[] args) throws Exception {
        for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            System.out.println("Interface: " + ni.getName());
            System.out.println("  displayName = " + ni.getDisplayName());
            System.out.println("  up          = " + ni.isUp());
            System.out.println("  loopback    = " + ni.isLoopback());
            System.out.println("  virtual     = " + ni.isVirtual());

            for (InetAddress address : Collections.list(ni.getInetAddresses())) {
                System.out.println("  address     = " + address.getHostAddress());
            }
        }
    }
}
```

Use case:

- memilih interface untuk multicast;
- debugging container/pod address;
- mengetahui apakah aplikasi bind ke interface yang benar;
- membedakan loopback vs external;
- memahami dual-stack IPv4/IPv6 behavior;
- observability startup.

Caveat:

- Output sangat environment-specific.
- Di container, interface bisa berbeda dari host.
- Di Kubernetes, pod IP, node IP, service IP, dan external IP adalah hal berbeda.
- Jangan jadikan interface enumeration sebagai logic bisnis kecuali benar-benar perlu.

---

## 8. URI vs URL: Identifier vs Locator

### 8.1 `URI`

`URI` adalah identifier.

Contoh:

```text
https://example.com/path?q=1
urn:isbn:9780134685991
mailto:user@example.com
```

Di Java:

```java
import java.net.URI;

public class UriExample {
    public static void main(String[] args) throws Exception {
        URI uri = new URI("https://example.com:443/api/users?id=10#section");

        System.out.println("scheme   = " + uri.getScheme());
        System.out.println("host     = " + uri.getHost());
        System.out.println("port     = " + uri.getPort());
        System.out.println("path     = " + uri.getPath());
        System.out.println("query    = " + uri.getQuery());
        System.out.println("fragment = " + uri.getFragment());
    }
}
```

`URI` cocok untuk:

- parsing;
- validation;
- normalization;
- building request target;
- configuration;
- identifier storage.

`URI` tidak otomatis membuka koneksi.

### 8.2 `URL`

`URL` adalah locator dan historically terkait kemampuan membuka resource.

Contoh:

```java
import java.net.URL;

public class UrlExample {
    public static void main(String[] args) throws Exception {
        URL url = new URL("https://example.com/");
        System.out.println(url.getProtocol());
        System.out.println(url.getHost());
        System.out.println(url.getPath());
    }
}
```

`URL` punya method seperti:

```java
openConnection()
openStream()
```

Caveat:

- `URL` lebih tua.
- `URL.equals()` historically dapat melibatkan name resolution; ini bisa mengejutkan.
- Untuk parsing/representasi, biasanya `URI` lebih aman.
- Untuk HTTP modern, gunakan `java.net.http.HttpClient`, bukan `URL.openStream()`.

### 8.3 Rule of Thumb

```text
Need to identify/parse/build a resource name?
  Use URI.

Need modern HTTP request?
  Use HttpClient with URI.

Need legacy URLConnection integration?
  Use URL/URLConnection carefully.
```

Anti-pattern:

```java
// Anti-pattern untuk production HTTP:
// - tidak eksplisit timeout
// - error handling minim
// - tidak jelas connection behavior
// - sulit observability
try (var in = new java.net.URL("https://example.com").openStream()) {
    in.transferTo(System.out);
}
```

Lebih baik untuk modern HTTP:

```java
// Detail HttpClient dibahas di Part 023.
```

---

## 9. TCP Socket Mental Model

TCP adalah connection-oriented byte stream.

Artinya:

```text
TCP gives you an ordered stream of bytes.
TCP does not preserve application message boundaries.
```

Jika sender melakukan:

```text
write("HELLO")
write("WORLD")
```

Receiver bisa membaca:

```text
"HELLOWORLD"
```

atau:

```text
"HEL"
"LOWOR"
"LD"
```

atau variasi lain.

Ini sangat penting.

TCP bukan:

```text
message queue
record transport
packet API
RPC framework
```

TCP adalah:

```text
ordered reliable byte stream
```

Aplikasi harus membuat protocol sendiri di atasnya:

- delimiter;
- length-prefix;
- fixed-size frame;
- header/body;
- higher-level protocol seperti HTTP.

Framing akan dibahas detail di Part 020.

---

## 10. Client Socket Basic

Contoh minimal client TCP:

```java
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class MinimalTcpClient {
    public static void main(String[] args) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("example.com", 80), 3_000);
            socket.setSoTimeout(5_000);

            OutputStream out = socket.getOutputStream();
            InputStream in = socket.getInputStream();

            byte[] request = """
                    GET / HTTP/1.1\r
                    Host: example.com\r
                    Connection: close\r
                    \r
                    """.replace("\n", "").getBytes(StandardCharsets.US_ASCII);

            out.write(request);
            out.flush();

            in.transferTo(System.out);
        }
    }
}
```

Yang terjadi:

```text
1. Socket dibuat.
2. connect dilakukan ke remote host:port.
3. TCP handshake terjadi.
4. OutputStream mengirim byte.
5. InputStream membaca byte.
6. Socket ditutup oleh try-with-resources.
```

Catatan:

- Ini hanya demonstrasi raw HTTP/1.1.
- Jangan membangun HTTP client production dari raw socket kecuali untuk pembelajaran/protocol khusus.
- HTTP modern akan dibahas di Part 023.

---

## 11. ServerSocket Basic

Contoh server TCP sederhana:

```java
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class MinimalTcpServer {
    public static void main(String[] args) throws Exception {
        try (ServerSocket server = new ServerSocket(8080)) {
            System.out.println("Listening on " + server.getLocalSocketAddress());

            while (true) {
                Socket client = server.accept();

                Thread.startVirtualThread(() -> handle(client));
            }
        }
    }

    private static void handle(Socket client) {
        try (client) {
            client.setSoTimeout(10_000);

            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();

            byte[] buffer = new byte[1024];
            int n = in.read(buffer);

            if (n == -1) {
                return;
            }

            String received = new String(buffer, 0, n, StandardCharsets.UTF_8);
            System.out.println("Received: " + received);

            out.write("OK\n".getBytes(StandardCharsets.UTF_8));
            out.flush();
        } catch (Exception e) {
            System.err.println("Client handling failed: " + e);
        }
    }
}
```

Poin penting:

- `accept()` blocking menunggu koneksi baru.
- Setiap accepted `Socket` adalah connection baru.
- Server harus menutup accepted socket.
- Server harus melindungi diri dari client yang lambat/tidak mengirim data.
- `read()` bisa return kurang dari jumlah data yang diharapkan.
- `read()` return `-1` berarti EOF.

Catatan: contoh memakai virtual thread untuk simplicity. Model concurrency I/O akan dibahas detail di Part 028.

---

## 12. Socket Lifecycle

Lifecycle sederhana TCP client:

```text
create socket
  -> connect
    -> get input/output stream
      -> write request
        -> read response
          -> close
```

Lifecycle server:

```text
create server socket
  -> bind
    -> listen
      -> accept connection
        -> handle socket
          -> close accepted socket
```

Lifecycle TCP secara network:

```text
client SYN
  -> server SYN-ACK
    -> client ACK
      -> established
        -> data exchange
          -> FIN/ACK or RST
```

Java tidak membuat semua detail TCP terlihat langsung, tetapi efeknya muncul sebagai:

- blocking connect;
- connect timeout;
- read timeout;
- EOF;
- connection reset;
- broken pipe;
- socket closed;
- bind exception;
- no route to host.

---

## 13. Timeout: Connect Timeout vs Read Timeout

Timeout adalah bagian dari correctness, bukan hanya performance.

### 13.1 Connect Timeout

Connect timeout membatasi waktu membangun koneksi.

```java
Socket socket = new Socket();
socket.connect(new InetSocketAddress("example.com", 80), 3_000);
```

Jika gagal dalam waktu tersebut, dapat muncul timeout atau exception koneksi lain.

Connect timeout menjawab:

```text
Berapa lama saya mau menunggu TCP connection established?
```

### 13.2 Read Timeout

Read timeout membatasi waktu blocking saat membaca data dari socket.

```java
socket.setSoTimeout(5_000);
int n = socket.getInputStream().read(buffer);
```

Jika tidak ada data hingga timeout, `SocketTimeoutException` dapat terjadi.

Read timeout menjawab:

```text
Berapa lama saya mau menunggu byte berikutnya?
```

### 13.3 Connect Timeout Tidak Menggantikan Read Timeout

Anti-pattern:

```java
Socket socket = new Socket();
socket.connect(new InetSocketAddress("api.example.com", 443), 3_000);

// Lupa read timeout.
// read() bisa blocking sangat lama.
InputStream in = socket.getInputStream();
int n = in.read();
```

Rule:

```text
Always think in phases:
  DNS timeout?
  connect timeout?
  TLS handshake timeout?
  write timeout?
  first byte timeout?
  between bytes timeout?
  whole operation timeout?
```

Java classic socket memiliki direct support untuk connect timeout dan read timeout. Write timeout lebih rumit dan sering perlu desain higher-level, non-blocking I/O, async I/O, atau framework/protocol client yang mendukung timeout lebih granular.

---

## 14. Blocking Behavior

Classic `Socket` bersifat blocking.

```text
connect() blocks until connected/fails/timeout.
accept() blocks until client connects.
read() blocks until data/EOF/error/timeout.
write() may block if OS send buffer penuh.
```

Blocking tidak selalu buruk.

Blocking I/O bisa sangat sederhana dan maintainable, terutama jika:

- jumlah connection tidak terlalu besar;
- setiap connection punya deadline jelas;
- thread model aman;
- memakai virtual threads;
- protocol sederhana;
- observability cukup.

Blocking menjadi berbahaya jika:

- tidak ada timeout;
- thread pool terbatas habis oleh read blocking;
- remote lambat;
- client malicious;
- connection leak;
- tidak ada backpressure;
- retry storm terjadi.

---

## 15. EOF, Close, Half-Close, dan Reset

### 15.1 EOF

Pada `InputStream.read()`:

```text
return -1 means end of stream
```

Contoh:

```java
byte[] buffer = new byte[8192];

while (true) {
    int n = in.read(buffer);
    if (n == -1) {
        break;
    }
    process(buffer, 0, n);
}
```

EOF berarti remote side telah menutup output side-nya secara graceful.

### 15.2 Close

`socket.close()` menutup socket.

Dengan try-with-resources:

```java
try (Socket socket = new Socket("example.com", 80)) {
    // use socket
}
```

Menutup socket juga menutup stream terkait.

### 15.3 Half-Close

TCP mendukung half-close:

```text
client closes output side
but still reads input side
```

Di Java:

```java
socket.shutdownOutput();
socket.shutdownInput();
```

Use case:

- client mengirim request sampai selesai;
- memberi sinyal EOF ke server;
- masih membaca response.

Contoh konseptual:

```java
socket.getOutputStream().write(payload);
socket.shutdownOutput(); // tells remote: no more request bytes

socket.getInputStream().transferTo(System.out);
```

Caveat:

- Tidak semua protocol/application mengharapkan half-close.
- Load balancer/proxy dapat punya behavior berbeda.
- HTTP punya aturan sendiri.
- Gunakan dengan pemahaman protocol.

### 15.4 Reset

Connection reset biasanya berarti koneksi ditutup secara abrupt.

Gejala:

```text
java.net.SocketException: Connection reset
```

atau saat write:

```text
Broken pipe
```

Penyebab umum:

- remote process crash;
- remote close socket tanpa membaca sisa data;
- firewall/load balancer reset;
- protocol violation;
- idle timeout;
- client/server timeout;
- TLS layer failure;
- container/pod restart.

---

## 16. Socket Options Dasar

`Socket` memiliki beberapa option yang sering ditemui.

### 16.1 `SO_TIMEOUT`

Read timeout:

```java
socket.setSoTimeout(5_000);
```

### 16.2 `TCP_NODELAY`

Mengatur Nagle algorithm.

```java
socket.setTcpNoDelay(true);
```

Konsep:

- Nagle mencoba mengurangi small packet dengan menggabungkan data.
- Bagus untuk throughput pada small writes.
- Bisa menambah latency pada request/response kecil.
- Banyak protocol latency-sensitive memilih `TCP_NODELAY=true`.

Caveat:

- Jangan set berdasarkan mitos.
- Ukur efeknya.
- Jika aplikasi sering `write()` byte kecil satu per satu, problem utama mungkin desain buffering/framing.

### 16.3 `SO_KEEPALIVE`

TCP keepalive:

```java
socket.setKeepAlive(true);
```

Caveat:

- TCP keepalive default OS bisa sangat lama.
- Bukan pengganti application heartbeat.
- Tidak cukup untuk SLA request timeout.
- Berguna untuk mendeteksi dead peer jangka panjang.

### 16.4 Receive/Send Buffer Size

```java
socket.setReceiveBufferSize(64 * 1024);
socket.setSendBufferSize(64 * 1024);
```

Caveat:

- Ini hint ke OS.
- OS bisa menyesuaikan.
- Terlalu kecil membatasi throughput.
- Terlalu besar meningkatkan memory footprint.
- Untuk banyak koneksi, total buffer OS bisa signifikan.

### 16.5 `SO_REUSEADDR`

Pada server:

```java
server.setReuseAddress(true);
```

Caveat:

- Semantics berbeda antar OS.
- Bisa membantu bind setelah restart.
- Jangan menggunakannya tanpa memahami risiko port sharing/platform behavior.

---

## 17. Exception Taxonomy

Networking exception harus diklasifikasikan agar retry, alert, dan diagnosis tepat.

### 17.1 `UnknownHostException`

Hostname tidak dapat di-resolve.

Kemungkinan:

- DNS down;
- typo hostname;
- search domain issue;
- resolver config salah;
- network policy;
- negative DNS cache.

Retry?

- Bisa retry jika DNS transient.
- Tetapi typo/config salah tidak akan sembuh dengan retry agresif.

### 17.2 `ConnectException`

Koneksi ditolak atau gagal.

Contoh pesan:

```text
Connection refused
```

Kemungkinan:

- port tidak listen;
- service down;
- target IP benar tapi process tidak aktif;
- security group/firewall reject.

Retry?

- Bisa jika service sedang restart.
- Perlu backoff.

### 17.3 `SocketTimeoutException`

Timeout saat connect atau read.

Kemungkinan:

- network lambat;
- target tidak merespons;
- firewall drop;
- server lambat;
- protocol deadlock;
- timeout terlalu kecil.

Retry?

- Hati-hati. Timeout tidak membuktikan remote tidak memproses request.

### 17.4 `NoRouteToHostException`

Tidak ada route ke host.

Kemungkinan:

- routing issue;
- VPN issue;
- subnet/security route;
- network unreachable.

### 17.5 `BindException`

Gagal bind local port.

Kemungkinan:

- port sudah dipakai;
- permission issue;
- address tidak tersedia;
- ephemeral port exhaustion pada client side tertentu.

### 17.6 `SocketException`

General socket error.

Contoh:

- connection reset;
- broken pipe;
- socket closed;
- network unreachable.

Perlu lihat message, timing, phase, dan metric.

---

## 18. TCP Stream: Partial Read dan Partial Write

Part ini hanya pengantar; detail framing ada di Part 020.

### 18.1 Partial Read

Anti-pattern:

```java
byte[] header = new byte[16];
int n = in.read(header);

// Salah: n belum tentu 16.
parseHeader(header);
```

Correct pattern:

```java
static void readFully(InputStream in, byte[] buffer, int offset, int length) throws IOException {
    int read = 0;

    while (read < length) {
        int n = in.read(buffer, offset + read, length - read);
        if (n == -1) {
            throw new EOFException("Unexpected EOF after " + read + " bytes");
        }
        read += n;
    }
}
```

### 18.2 Partial Write

`OutputStream.write(byte[])` pada classic blocking stream biasanya mencoba menulis seluruh byte atau melempar exception. Tetapi secara OS/network, write dapat tertahan jika send buffer penuh. Pada NIO non-blocking, partial write terlihat eksplisit.

Meski classic `OutputStream` menyederhanakan, application-level tetap perlu memikirkan:

- apakah payload terlalu besar;
- apakah write bisa blocking lama;
- apakah remote membaca;
- apakah timeout operasi total ada;
- apakah cancellation bisa menutup socket.

---

## 19. Backlog dan Accept Queue

Saat server membuat `ServerSocket`, ada konsep backlog.

```java
import java.net.InetSocketAddress;
import java.net.ServerSocket;

public class BacklogExample {
    public static void main(String[] args) throws Exception {
        try (ServerSocket server = new ServerSocket()) {
            int backlog = 100;
            server.bind(new InetSocketAddress("0.0.0.0", 8080), backlog);

            while (true) {
                var socket = server.accept();
                Thread.startVirtualThread(() -> handle(socket));
            }
        }
    }

    private static void handle(java.net.Socket socket) {
        try (socket) {
            socket.getInputStream().transferTo(socket.getOutputStream());
        } catch (Exception e) {
            // log
        }
    }
}
```

Backlog bukan “maximum concurrent connections” application.

Backlog berkaitan dengan queue koneksi pending di OS.

Jika application lambat `accept()`:

- queue bisa penuh;
- client connect bisa timeout;
- connection bisa ditolak;
- load balancer melihat target tidak sehat.

Production concern:

```text
accept loop must be fast.
connection handling should not block accept loop.
```

---

## 20. Localhost, Loopback, Wildcard, dan Container Reality

### 20.1 `localhost`

`localhost` biasanya resolve ke:

```text
127.0.0.1
::1
```

Tergantung OS/config.

Caveat:

- `localhost` bisa memilih IPv6 dulu.
- Service yang bind hanya IPv4 mungkin tidak reachable via `::1`.
- Gunakan explicit address saat debugging.

### 20.2 Loopback

Loopback berarti koneksi hanya dalam host/network namespace yang sama.

Dalam container:

```text
localhost inside container != localhost on host
```

Jika service A di container mencoba connect ke `localhost:8080`, ia mengarah ke dirinya sendiri, bukan container lain.

### 20.3 Wildcard Address

Bind ke:

```text
0.0.0.0
```

berarti listen pada semua IPv4 interface.

Di container, aplikasi web biasanya perlu bind `0.0.0.0`, bukan `127.0.0.1`, agar port mapping/service routing bisa masuk.

---

## 21. IPv4 dan IPv6

Java `InetAddress` bisa menangani IPv4 dan IPv6.

Contoh IPv4:

```text
192.168.1.10
127.0.0.1
```

Contoh IPv6:

```text
::1
2001:db8::1
```

Endpoint IPv6 dengan port biasanya ditulis:

```text
[::1]:8080
```

Caveat:

- DNS bisa mengembalikan A dan AAAA record.
- Environment bisa IPv4-only, IPv6-only, atau dual-stack.
- Firewall/security rule untuk IPv4 dan IPv6 bisa berbeda.
- Log parser sering salah parsing IPv6 karena banyak colon.
- Config `host:port` sederhana bisa rusak untuk IPv6 jika tidak memakai bracket.

Untuk parsing endpoint, jangan asal `split(":")`.

Anti-pattern:

```java
String[] parts = endpoint.split(":");
String host = parts[0];
int port = Integer.parseInt(parts[1]);
```

Lebih aman menggunakan URI-like format atau config terpisah:

```text
host=::1
port=8080
```

atau:

```text
http://[::1]:8080
```

---

## 22. Proxy, Firewall, NAT, dan Load Balancer

Aplikasi Java sering tidak langsung connect ke remote service. Di tengah bisa ada:

```text
client
  -> local firewall
  -> corporate proxy
  -> NAT gateway
  -> load balancer
  -> service mesh proxy
  -> ingress
  -> pod/service
```

Implikasi:

- IP remote yang terlihat aplikasi bisa bukan real backend.
- Connection idle bisa diputus oleh load balancer.
- TLS bisa terminate di proxy/load balancer.
- Source IP bisa berubah karena NAT.
- DNS mengarah ke load balancer, bukan host final.
- `Connection reset` bisa berasal dari middlebox.
- Retry storm bisa membebani NAT/load balancer, bukan hanya backend.

Saat debugging, tanyakan:

```text
Apakah gagal sebelum DNS?
Apakah gagal saat TCP connect?
Apakah gagal saat TLS?
Apakah gagal saat request write?
Apakah gagal saat menunggu response?
Apakah gagal setelah idle?
Apakah hanya dari subnet tertentu?
Apakah hanya IPv6/IPv4?
Apakah hanya setelah deployment?
Apakah ada proxy/env var?
```

---

## 23. Resource Lifecycle dan Socket Leak

Socket adalah resource OS.

Jika tidak ditutup:

- file descriptor leak;
- memory/kernel resource leak;
- port exhaustion;
- connection leak;
- remote side menunggu;
- thread blocking;
- degraded service over time.

Correct pattern:

```java
try (Socket socket = new Socket()) {
    socket.connect(new InetSocketAddress("example.com", 80), 3_000);
    socket.setSoTimeout(5_000);

    // use socket
}
```

Server accepted socket juga harus ditutup:

```java
while (true) {
    Socket socket = server.accept();

    Thread.startVirtualThread(() -> {
        try (socket) {
            handle(socket);
        } catch (IOException e) {
            // log
        }
    });
}
```

Anti-pattern:

```java
Socket socket = server.accept();
handle(socket); // if handle throws, socket may leak
```

Checklist lifecycle:

- Who owns the socket?
- Who closes it?
- What happens on exception?
- Is close idempotent?
- Is the input stream handed to another component?
- Does wrapper close underlying socket?
- Is there a timeout?
- Is cancellation implemented by closing socket?

---

## 24. `URL.openConnection()` dan Legacy Networking

Sebelum `HttpClient`, banyak kode Java memakai:

```java
URL url = new URL("https://example.com");
URLConnection connection = url.openConnection();
```

Atau:

```java
HttpURLConnection connection = (HttpURLConnection) url.openConnection();
```

Contoh lebih aman dengan timeout:

```java
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;

public class LegacyHttpUrlConnectionExample {
    public static void main(String[] args) throws Exception {
        var url = URI.create("https://example.com/").toURL();
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();

        conn.setConnectTimeout(3_000);
        conn.setReadTimeout(5_000);
        conn.setRequestMethod("GET");

        int status = conn.getResponseCode();

        try (InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream()) {
            if (in != null) {
                String body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                System.out.println(body.substring(0, Math.min(body.length(), 200)));
            }
        } finally {
            conn.disconnect();
        }
    }
}
```

Caveat:

- Untuk HTTP modern, prefer `java.net.http.HttpClient`.
- `HttpURLConnection` masih ada di banyak codebase legacy.
- Jangan lupa set timeout.
- Jangan `readAllBytes()` untuk response besar.
- Pahami error stream.
- Pahami connection reuse behavior.
- Observability dan control lebih terbatas dibanding HTTP client modern.

---

## 25. Secure vs Plain Socket

`Socket` adalah TCP plain socket.

Untuk TLS, Java menyediakan `javax.net.ssl.SSLSocket` dan higher-level HTTPS APIs.

Konsep:

```text
Socket     = TCP
SSLSocket  = TCP + TLS
HTTPS      = HTTP over TLS
```

Jangan mengirim credential/token melalui plain socket di network tidak tepercaya.

TLS detail akan dibahas di Part 024.

---

## 26. Production Failure Model

Networking failure harus dipikirkan berdasarkan phase.

### 26.1 Phase-Based Failure Table

| Phase | Contoh Failure | Exception/Gejala | Kemungkinan Penyebab |
|---|---|---|---|
| Config | hostname salah | `UnknownHostException` | typo, config salah |
| DNS | resolver gagal | `UnknownHostException` | DNS down, network policy |
| Connect | timeout | `SocketTimeoutException` | firewall drop, remote unreachable |
| Connect | refused | `ConnectException` | port tidak listen |
| Connect | no route | `NoRouteToHostException` | routing/subnet/VPN |
| Bind | address in use | `BindException` | port sudah dipakai |
| Write | broken pipe | `SocketException` | remote close/reset |
| Read | timeout | `SocketTimeoutException` | remote lambat, protocol deadlock |
| Read | EOF | `read() == -1` | remote graceful close |
| Runtime | reset | `SocketException` | remote crash, middlebox reset |
| Idle | sudden close | EOF/reset | LB/NAT idle timeout |

### 26.2 Retry Decision

Tidak semua failure boleh langsung retry.

| Failure | Retry? | Catatan |
|---|---:|---|
| DNS transient | Ya, dengan backoff | Tapi config typo tidak akan sembuh |
| Connect refused | Kadang | Mungkin service restart |
| Connect timeout | Kadang | Bisa memperburuk jika network drop |
| Read timeout after request sent | Hati-hati | Server mungkin sudah memproses |
| Broken pipe while sending | Tergantung | Payload mungkin belum diterima penuh |
| Connection reset before request | Biasanya aman | Jika belum ada side effect |
| Connection reset after request | Hati-hati | Side effect tidak diketahui |
| Protocol parse error | Biasanya tidak | Bisa bug/corruption/version mismatch |

Rule:

```text
Retry safety depends on operation semantics, not just exception type.
```

---

## 27. Observability untuk Networking

Log minimal untuk error networking:

```text
operation
remote host
remote port
resolved IP if available
phase: dns/connect/tls/write/read/parse
timeout value
duration
attempt number
correlation id
exception class
exception message
```

Contoh structured log fields:

```text
event=outbound_connection_failed
operation=document-transfer
remote_host=api.partner.example
remote_port=443
phase=connect
connect_timeout_ms=3000
duration_ms=3002
attempt=2
exception=java.net.SocketTimeoutException
message=Connect timed out
correlation_id=...
```

Metrics:

- DNS resolution latency.
- Connect latency.
- Connection success/failure count.
- Timeout count by phase.
- Bytes sent/received.
- Active connections.
- Connection pool saturation, jika pakai client pool.
- Retry count.
- Error classification.
- Remote endpoint availability.
- Idle connection close count.

Without observability, semua error networking terlihat seperti:

```text
java.net.SocketException: Connection reset
```

Padahal akar masalah bisa sangat berbeda.

---

## 28. Testing Networking Code

### 28.1 Unit Test

Unit test cocok untuk:

- parsing endpoint;
- retry decision;
- timeout config validation;
- protocol encoder/decoder;
- error classification;
- state machine.

### 28.2 Integration Test dengan Local Server

Contoh local echo server test:

```java
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public final class LocalEchoServer implements AutoCloseable {
    private final ServerSocket serverSocket;
    private final Thread thread;

    public LocalEchoServer() throws IOException {
        this.serverSocket = new ServerSocket(0);
        this.thread = Thread.ofPlatform().start(this::run);
    }

    public int port() {
        return serverSocket.getLocalPort();
    }

    private void run() {
        while (!serverSocket.isClosed()) {
            try {
                Socket socket = serverSocket.accept();
                Thread.startVirtualThread(() -> {
                    try (socket) {
                        socket.getInputStream().transferTo(socket.getOutputStream());
                    } catch (IOException ignored) {
                    }
                });
            } catch (IOException e) {
                if (!serverSocket.isClosed()) {
                    e.printStackTrace();
                }
            }
        }
    }

    public String echo(String value) throws IOException {
        try (Socket socket = new Socket("127.0.0.1", port())) {
            socket.setSoTimeout(3_000);
            socket.getOutputStream().write(value.getBytes(StandardCharsets.UTF_8));
            socket.shutdownOutput();

            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Override
    public void close() throws IOException {
        serverSocket.close();
    }
}
```

### 28.3 Fault Injection

Test juga harus mencakup:

- server accepts but never responds;
- server closes immediately;
- server sends partial response;
- server sends invalid data;
- slow response;
- connection reset;
- DNS failure simulation;
- port unavailable;
- large payload;
- many concurrent connections.

Networking code yang hanya dites happy path biasanya gagal di production.

---

## 29. Design Pattern: Safe TCP Client Skeleton

Contoh skeleton raw TCP client untuk protocol sederhana.

```java
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.time.Duration;
import java.util.Objects;

public final class SafeTcpClient {
    private final String host;
    private final int port;
    private final Duration connectTimeout;
    private final Duration readTimeout;

    public SafeTcpClient(
            String host,
            int port,
            Duration connectTimeout,
            Duration readTimeout
    ) {
        this.host = Objects.requireNonNull(host, "host");
        this.port = validatePort(port);
        this.connectTimeout = Objects.requireNonNull(connectTimeout, "connectTimeout");
        this.readTimeout = Objects.requireNonNull(readTimeout, "readTimeout");
    }

    public byte[] request(byte[] payload, int expectedResponseLength) throws IOException {
        Objects.requireNonNull(payload, "payload");

        if (expectedResponseLength < 0) {
            throw new IllegalArgumentException("expectedResponseLength must be >= 0");
        }

        try (Socket socket = new Socket()) {
            socket.connect(
                    new InetSocketAddress(host, port),
                    Math.toIntExact(connectTimeout.toMillis())
            );
            socket.setSoTimeout(Math.toIntExact(readTimeout.toMillis()));
            socket.setTcpNoDelay(true);

            OutputStream out = socket.getOutputStream();
            InputStream in = socket.getInputStream();

            out.write(payload);
            out.flush();

            byte[] response = new byte[expectedResponseLength];
            readFully(in, response, 0, response.length);
            return response;
        }
    }

    private static int validatePort(int port) {
        if (port < 0 || port > 65_535) {
            throw new IllegalArgumentException("Invalid port: " + port);
        }
        return port;
    }

    private static void readFully(
            InputStream in,
            byte[] buffer,
            int offset,
            int length
    ) throws IOException {
        int read = 0;

        while (read < length) {
            int n = in.read(buffer, offset + read, length - read);
            if (n == -1) {
                throw new EOFException(
                        "Unexpected EOF after " + read + " of " + length + " bytes"
                );
            }
            read += n;
        }
    }
}
```

Kelebihan skeleton:

- explicit timeout;
- explicit port validation;
- explicit read fully;
- resource closed;
- avoids assuming one read equals full response.

Kekurangan:

- belum punya framing general;
- belum punya retry;
- belum punya operation deadline total;
- belum punya metrics;
- belum punya TLS;
- belum menangani response variable length;
- belum punya cancellation selain close;
- belum punya write timeout granular.

Itu sebabnya Part 020 akan masuk ke protocol/framing.

---

## 30. Design Pattern: Minimal Production Server Checklist

Untuk raw TCP server production, minimal tanyakan:

### 30.1 Binding

- Bind address benar?
- Port configurable?
- Tidak expose ke public interface tanpa sengaja?
- IPv4/IPv6 behavior jelas?

### 30.2 Accept Loop

- Accept loop cepat?
- Handling connection dipisah?
- Ada limit concurrent connection?
- Ada graceful shutdown?

### 30.3 Timeout

- Read timeout?
- Idle timeout?
- Handshake timeout?
- Whole request timeout?

### 30.4 Protocol

- Ada framing?
- Ada max frame size?
- Ada version?
- Ada validation?
- Ada handling partial read?
- Ada handling invalid payload?

### 30.5 Resource

- Socket selalu ditutup?
- Thread bounded atau virtual thread strategy jelas?
- Buffer memory bounded?
- File descriptor limit dipantau?

### 30.6 Security

- Plain TCP atau TLS?
- Authentication?
- Rate limit?
- Slowloris defense?
- Input size limit?
- Logging tidak bocorkan payload sensitif?

### 30.7 Observability

- Active connections?
- Accepted connections?
- Rejected connections?
- Read timeout?
- Protocol error?
- Bytes in/out?
- Per-client error?
- Latency distribution?

---

## 31. Common Anti-Patterns

### 31.1 Tanpa Timeout

```java
Socket socket = new Socket("api.example.com", 443);
socket.getInputStream().read();
```

Problem:

- connect timeout default tidak eksplisit;
- read bisa blocking lama;
- thread bisa habis.

### 31.2 Menganggap `read()` Mengembalikan Message Lengkap

```java
int n = in.read(buffer);
String message = new String(buffer, 0, n, UTF_8);
handle(message);
```

Problem:

- TCP tidak preserve message boundary;
- message bisa partial;
- bisa ada multiple message dalam satu read;
- UTF-8 bisa terpotong di tengah sequence.

### 31.3 Membuka Koneksi Baru untuk Setiap Small Operation Tanpa Pool/Reuse

Problem:

- latency tinggi;
- TCP handshake overhead;
- TLS handshake overhead;
- ephemeral port pressure;
- `TIME_WAIT` tinggi.

### 31.4 Retry Agresif Tanpa Backoff

Problem:

- memperburuk outage;
- menyebabkan retry storm;
- duplicate side effect;
- membebani DNS/NAT/LB/backend.

### 31.5 Menyembunyikan Semua Exception sebagai “Network Error”

Problem:

- tidak bisa membedakan DNS, connect, read, protocol, TLS;
- retry salah;
- alert tidak actionable.

### 31.6 Menggunakan `URL.openStream()` untuk Production Transfer Besar

Problem:

- timeout tidak jelas;
- error handling minim;
- sulit observability;
- tidak ada checksum/resume;
- memory risk jika langsung `readAllBytes()`.

### 31.7 Parsing `host:port` dengan `split(":")`

Problem:

- IPv6 rusak;
- empty host tidak jelas;
- port invalid tidak tervalidasi;
- URI escaping tidak ditangani.

---

## 32. Decision Matrix

| Kebutuhan | API/Approach |
|---|---|
| Parse identifier/resource | `URI` |
| Modern HTTP | `java.net.http.HttpClient` |
| Legacy HTTP simple | `HttpURLConnection`, hati-hati |
| Raw TCP client sederhana | `Socket` |
| Raw TCP server sederhana | `ServerSocket` |
| Banyak blocking connection sederhana | `Socket` + virtual threads |
| Event loop non-blocking | `SocketChannel` + `Selector` |
| UDP datagram | `DatagramSocket` / `DatagramChannel` |
| TLS socket low-level | `SSLSocket` |
| Local interface inspection | `NetworkInterface` |
| Endpoint representation | `InetSocketAddress` |
| Hostname/IP abstraction | `InetAddress` |

---

## 33. Debugging Checklist

Saat networking error terjadi, jangan langsung menyimpulkan “server down”.

Checklist:

```text
1. Apa endpoint yang dipakai?
   - scheme?
   - host?
   - port?
   - path?
   - proxy?

2. Hostname resolve ke IP apa?
   - dari host aplikasi?
   - dari container/pod?
   - dari node?
   - dari laptop?

3. Apakah connect berhasil?
   - refused?
   - timeout?
   - no route?

4. Apakah TLS berhasil?
   - cert expired?
   - hostname mismatch?
   - truststore?

5. Apakah request terkirim penuh?
   - broken pipe?
   - reset saat write?

6. Apakah response diterima?
   - read timeout?
   - EOF?
   - partial body?

7. Apakah protocol valid?
   - frame lengkap?
   - length benar?
   - charset benar?
   - checksum benar?

8. Apakah hanya terjadi setelah idle?
   - LB idle timeout?
   - NAT timeout?
   - keepalive?

9. Apakah hanya terjadi pada load tinggi?
   - ephemeral port?
   - file descriptor?
   - accept backlog?
   - thread pool exhausted?

10. Apakah retry memperburuk?
    - retry storm?
    - duplicate?
    - no backoff?
```

---

## 34. Latihan

### Latihan 1 — Endpoint Parser Aman

Buat parser konfigurasi endpoint yang menerima:

```text
host=...
port=...
```

Bukan string `host:port`.

Validasi:

- host tidak blank;
- port `1..65535` untuk remote service;
- port `0..65535` untuk bind local;
- error message jelas.

### Latihan 2 — TCP Echo Server dengan Timeout

Buat echo server yang:

- bind ke configurable port;
- memakai virtual thread per connection;
- set read timeout;
- menolak payload lebih dari 1 MB;
- menutup socket pada semua path;
- log remote address.

### Latihan 3 — TCP Client dengan Read Fully

Buat client untuk protocol fixed-response:

- connect timeout 3 detik;
- read timeout 5 detik;
- kirim 16-byte request;
- baca 32-byte response;
- jika EOF sebelum 32 byte, throw `EOFException`.

### Latihan 4 — DNS Diagnostic Tool

Buat CLI kecil:

```text
java DnsDiag example.com
```

Output:

- all IP addresses;
- canonical host name;
- lookup duration;
- error classification.

### Latihan 5 — Failure Injection

Buat server test yang bisa mode:

```text
--close-immediately
--accept-but-sleep
--send-partial
--echo
--reset-ish
```

Lalu amati behavior client.

---

## 35. Ringkasan

Networking Java dimulai dari beberapa abstraction sederhana:

```text
InetAddress        -> IP address abstraction
InetSocketAddress  -> IP/host + port endpoint
URI                -> resource identifier
URL                -> resource locator legacy abstraction
Socket             -> TCP client connection
ServerSocket       -> TCP listener
NetworkInterface   -> local network interface
```

Tetapi production networking tidak sederhana karena melibatkan banyak boundary:

```text
DNS
TCP connect
TLS
write
read
protocol parse
remote processing
proxy/load balancer/NAT
timeout
retry
resource lifecycle
```

Invariant penting:

1. Hostname bukan IP.
2. DNS adalah runtime dependency.
3. TCP adalah byte stream, bukan message stream.
4. `read()` tidak berarti satu message.
5. `connect timeout` bukan `read timeout`.
6. Timeout tidak membuktikan remote tidak melakukan side effect.
7. Socket harus selalu ditutup.
8. Retry safety tergantung semantics operasi.
9. Observability harus memisahkan phase failure.
10. Raw socket membutuhkan protocol framing yang eksplisit.

Part berikutnya akan masuk ke inti protocol di atas TCP:

```text
Part 020 — Networking II: TCP Framing, Protocol Design, Partial Read/Write, dan Backpressure
```

---

## 36. Referensi

Referensi utama:

- Oracle Java SE Documentation — `java.net` package summary.
- Oracle Java SE Documentation — `InetAddress`.
- Oracle Java SE Documentation — `InetSocketAddress`.
- Oracle Java SE Documentation — `Socket`.
- Oracle Java SE Documentation — `ServerSocket`.
- Oracle Java SE Documentation — `URI`.
- Oracle Java SE Documentation — `URL`.
- Oracle Java SE Documentation — networking properties related to DNS cache.
- Oracle Java SE Documentation — `NetworkInterface`.

Catatan: detail behavior networking dapat berbeda antar OS, resolver, firewall, proxy, NAT, load balancer, container runtime, dan cloud provider. Java API memberi abstraction, tetapi correctness production tetap membutuhkan pemahaman sistem di bawahnya.
