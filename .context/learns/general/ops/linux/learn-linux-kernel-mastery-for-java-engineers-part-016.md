# learn-linux-kernel-mastery-for-java-engineers-part-016.md

# Part 016 — Network Stack I: From Socket API to Kernel

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `016`  
> Topik: Linux socket API, TCP socket lifecycle, bind/listen/accept/connect, backlog, socket buffer, blocking vs non-blocking I/O, Java Socket/NIO/Netty mapping, dan failure production dasar  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 015, kita membahas IPC lokal:

- pipe
- FIFO
- Unix domain socket
- shared memory
- mmap IPC
- futex
- subprocess deadlock
- lock contention
- wait/wake behavior

Part 016 mulai masuk ke salah satu subsystem kernel yang paling penting untuk backend engineer:

> network stack.

Bagian ini belum membahas TCP internals secara dalam seperti congestion control, retransmission, TIME_WAIT, Nagle, atau keepalive detail. Itu akan dibahas di part berikutnya.

Fokus part ini adalah:

```text
Bagaimana aplikasi Java sampai bisa menerima dan membuat koneksi network melalui socket API Linux?
```

Kita akan mulai dari mental model:

```text
Java code
  -> JVM/native library
  -> syscall socket/bind/listen/accept/connect/read/write
  -> kernel socket object
  -> TCP/IP stack
  -> network device / loopback
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan socket sebagai file descriptor yang menunjuk ke kernel socket object.
2. Memahami lifecycle server socket:
   - `socket`
   - `setsockopt`
   - `bind`
   - `listen`
   - `accept`
   - `read/recv`
   - `write/send`
   - `close`
3. Memahami lifecycle client socket:
   - `socket`
   - `connect`
   - `send`
   - `recv`
   - `close`
4. Membedakan:
   - listening socket
   - accepted/connected socket
   - client socket
5. Memahami backlog:
   - SYN backlog
   - accept queue
   - application accept rate
6. Memahami socket buffer:
   - send buffer
   - receive buffer
   - kernel buffer vs application buffer
7. Memahami blocking dan non-blocking socket.
8. Menghubungkan Java:
   - `java.net.ServerSocket`
   - `java.net.Socket`
   - Java NIO `ServerSocketChannel`, `SocketChannel`, `Selector`
   - Netty event loop
9. Membaca observability:
   - `ss`
   - `/proc/net/tcp`
   - `lsof`
   - `strace`
   - `tcpdump` secara pengantar
10. Mendiagnosis error umum:
    - `ECONNREFUSED`
    - `ECONNRESET`
    - `ETIMEDOUT`
    - `EADDRINUSE`
    - `EADDRNOTAVAIL`
    - `EMFILE`
11. Memahami failure produksi:
    - accept queue penuh
    - too many open files
    - ephemeral port exhaustion
    - socket leak
    - slow accept loop
    - blocking call di event loop
    - backlog tuning salah
    - connection storm

---

## 2. Mental Model Utama

Socket bukan “koneksi” secara abstrak di aplikasi saja.

Di Linux, socket adalah kernel object yang diakses melalui file descriptor.

```text
Java Socket object
      |
JVM/native code
      |
file descriptor integer
      |
kernel struct file
      |
kernel socket object
      |
TCP/IP stack
      |
NIC/loopback/network
```

Socket mirip file dalam arti:

- punya file descriptor
- bisa di-`read`
- bisa di-`write`
- bisa di-`close`
- bisa di-poll/epoll
- punya flags seperti blocking/non-blocking

Tetapi socket bukan file biasa.

Socket punya:

- address
- port
- protocol
- state
- send buffer
- receive buffer
- error state
- queue
- TCP state machine
- socket options

---

## 3. Socket as File Descriptor

Ketika aplikasi memanggil syscall:

```c
socket(AF_INET, SOCK_STREAM, 0)
```

Kernel membuat socket object dan mengembalikan integer file descriptor:

```text
fd = 3
```

Dari sudut process:

```text
fd table:
0 -> stdin
1 -> stdout
2 -> stderr
3 -> socket:[12345]
```

Cek:

```bash
ls -l /proc/<pid>/fd
```

Contoh:

```text
3 -> socket:[402653279]
```

Lihat dengan `lsof`:

```bash
lsof -p <pid> -a -i
```

Atau:

```bash
ss -tanp
```

### 3.1 Implikasi untuk Java

Java object bukan resource kernel itu sendiri.

```java
Socket socket = new Socket();
```

Pada akhirnya, jika terkoneksi, ia punya underlying file descriptor.

Jika Java object tidak ditutup dengan benar:

```text
FD tetap terbuka sampai close/finalization/GC/exit
```

FD leak pada socket bisa menyebabkan:

- `Too many open files`
- accept gagal
- connect gagal
- memory kernel naik
- connection tetap terbuka
- downstream resource leak

---

## 4. Internet Socket Address

Socket TCP/IP memakai address:

```text
IP address + port + protocol
```

Contoh server:

```text
0.0.0.0:8080
127.0.0.1:8080
10.0.1.5:8080
[::]:8080
```

Makna:

| Address | Makna |
|---|---|
| `127.0.0.1` | loopback lokal saja |
| `0.0.0.0` | semua IPv4 interface lokal |
| `::` | semua IPv6 interface lokal |
| specific IP | hanya interface/address itu |

Bug umum:

```text
App bind 127.0.0.1 di container, service lain tidak bisa connect.
```

Atau:

```text
App bind 0.0.0.0, admin endpoint ikut terekspos.
```

Bind address adalah keputusan security dan routing.

---

## 5. Server Socket Lifecycle

Server TCP biasa menjalankan sequence:

```text
socket()
setsockopt()
bind()
listen()
accept()
read()/write()
close()
```

Diagram:

```text
Application Server
------------------
socket()
   |
setsockopt(SO_REUSEADDR, ...)
   |
bind(0.0.0.0:8080)
   |
listen(backlog)
   |
accept() loop
   |
for each accepted connection:
    read request
    write response
    close or keep alive
```

### 5.1 `socket()`

Membuat socket object.

```text
domain: AF_INET / AF_INET6
type:   SOCK_STREAM
proto:  TCP
```

### 5.2 `setsockopt()`

Mengatur option.

Contoh:

- `SO_REUSEADDR`
- `SO_REUSEPORT`
- `SO_RCVBUF`
- `SO_SNDBUF`
- `TCP_NODELAY`
- keepalive options

### 5.3 `bind()`

Mengikat socket ke local address/port.

Contoh:

```text
0.0.0.0:8080
```

Jika port sudah dipakai:

```text
EADDRINUSE
```

### 5.4 `listen()`

Mengubah socket menjadi listening socket.

Kernel mulai menerima incoming connection untuk address/port tersebut.

Parameter backlog memengaruhi queue koneksi yang menunggu di-accept.

### 5.5 `accept()`

Mengambil koneksi yang sudah siap dari accept queue.

Penting:

```text
listening socket != accepted socket
```

`accept()` mengembalikan file descriptor baru.

Contoh:

```text
fd 3 = listening socket on 0.0.0.0:8080
fd 7 = accepted connection from 10.0.0.5:51514
fd 8 = accepted connection from 10.0.0.6:51515
```

### 5.6 `read/write`

Setelah accept, aplikasi membaca dan menulis pada connected socket.

### 5.7 `close`

Menutup FD.

Pada TCP, close memicu TCP connection termination semantics, yang akan dibahas lebih dalam di part TCP berikutnya.

---

## 6. Client Socket Lifecycle

Client TCP biasa:

```text
socket()
connect()
write/send()
read/recv()
close()
```

Diagram:

```text
Client Application
------------------
socket()
   |
connect(server_ip:server_port)
   |
send request
   |
recv response
   |
close
```

### 6.1 `connect()`

`connect()` memulai koneksi ke remote address.

Untuk TCP, ini melibatkan handshake.

Jika server tidak listening:

```text
ECONNREFUSED
```

Jika network blackhole atau packet drop:

```text
ETIMEDOUT
```

Jika local ephemeral port tidak tersedia:

```text
EADDRNOTAVAIL
```

Jika non-blocking socket:

```text
connect() -> EINPROGRESS
```

Lalu aplikasi menunggu socket writable dan mengecek hasil connect.

---

## 7. Listening Socket vs Connected Socket

Ini penting.

### 7.1 Listening socket

- Dibuat server.
- Di-bind ke local address/port.
- Dipakai untuk menerima koneksi.
- Tidak dipakai untuk data request/response.
- `accept()` dipanggil pada socket ini.

### 7.2 Connected socket

- Hasil `accept()` di server.
- Hasil `connect()` di client.
- Dipakai untuk `read/write`.
- Mewakili satu koneksi TCP.

Diagram:

```text
Server Process

fd=3  LISTEN  0.0.0.0:8080
  |
  | accept()
  v
fd=7  ESTABLISHED  10.0.0.10:8080 <-> 10.0.0.50:51234
fd=8  ESTABLISHED  10.0.0.10:8080 <-> 10.0.0.51:51235
fd=9  ESTABLISHED  10.0.0.10:8080 <-> 10.0.0.52:51236
```

Jika FD accepted socket leak, jumlah connection naik.

Jika listening socket tertutup, server tidak menerima koneksi baru.

---

## 8. Backlog: Kenapa Server Bisa Refuse/Drop Saat App Lambat Accept

Ketika client connect ke server, tidak semua langsung sampai ke application handler.

Ada queue di kernel.

Secara simplified:

```text
Incoming SYN
   |
SYN backlog / half-open queue
   |
TCP handshake complete
   |
accept queue
   |
application accept()
   |
connected socket returned to app
```

Dua queue penting:

1. SYN backlog untuk koneksi setengah jadi.
2. Accept queue untuk koneksi completed yang belum di-accept aplikasi.

Detail implementasi dan tuning bisa berbeda tergantung kernel/config, tetapi mental modelnya cukup:

```text
Kernel can complete connection before application calls accept.
Accepted-ready connections wait in accept queue.
If app accepts too slowly and queue fills, new connections suffer.
```

---

## 9. `listen(backlog)`

Application memanggil:

```c
listen(fd, backlog)
```

Backlog adalah hint/limit untuk queue completed connection yang menunggu `accept`, dibatasi juga oleh kernel setting seperti:

```bash
cat /proc/sys/net/core/somaxconn
```

Jika app/framework set backlog kecil, accept queue bisa penuh saat burst.

Jika kernel `somaxconn` kecil, backlog besar di app bisa dipotong.

Cek:

```bash
sysctl net.core.somaxconn
```

Untuk SYN backlog:

```bash
sysctl net.ipv4.tcp_max_syn_backlog
```

Catatan:

- jangan tuning sysctl buta
- backlog bukan solusi untuk app yang tidak mampu memproses request
- backlog hanya buffer burst
- queue penuh tetap harus dilihat bersama accept rate, CPU, FD limit, dan app threads

---

## 10. Accept Queue Full

Jika accept queue penuh, akibatnya tergantung kondisi/kernel/settings:

- koneksi baru bisa di-drop
- client bisa retry SYN
- client connect bisa timeout
- server bisa mencatat overflow/drop
- latency connect naik
- load balancer health check bisa gagal

Cek indikasi:

```bash
ss -ltn
```

Output:

```text
State   Recv-Q Send-Q Local Address:Port
LISTEN  128    128    0.0.0.0:8080
```

Untuk listening socket, `Recv-Q` dapat menunjukkan current queue dan `Send-Q` backlog limit tergantung tool/kernel.

Cek kernel counters:

```bash
netstat -s | grep -i listen
```

Atau:

```bash
nstat -az | grep -E 'Listen|TCP'
```

Cari counter seperti listen queue overflow/drop tergantung environment.

---

## 11. Socket Buffer

Setiap TCP socket punya buffer di kernel:

- receive buffer
- send buffer

### 11.1 Receive buffer

Data yang sudah diterima kernel dari network tetapi belum dibaca aplikasi.

```text
network -> kernel receive buffer -> application read()
```

Jika app lambat membaca:

- receive buffer penuh
- TCP flow control mengecilkan window
- sender diperlambat
- latency naik
- memory kernel naik

### 11.2 Send buffer

Data yang sudah ditulis aplikasi tetapi belum dikirim/di-ACK sepenuhnya.

```text
application write() -> kernel send buffer -> network
```

Jika network/receiver lambat:

- send buffer penuh
- blocking write bisa block
- non-blocking write return partial/EAGAIN
- event loop harus menunggu writable

### 11.3 Java implication

Ketika Java memanggil:

```java
outputStream.write(bytes);
```

Itu tidak selalu berarti bytes sudah sampai ke remote application.

Sering artinya:

```text
bytes copied into kernel send buffer
```

Jika buffer penuh, write bisa block atau return partial di non-blocking mode.

---

## 12. Application Buffer vs Kernel Buffer

Jangan bingung antara:

```text
ByteBuffer / byte[] in Java
```

dan:

```text
kernel socket buffer
```

Data flow:

```text
Java byte[] / ByteBuffer
     |
JVM/native write syscall
     |
kernel send buffer
     |
TCP/IP stack
     |
NIC/network
     |
remote kernel receive buffer
     |
remote application read
```

Ada banyak tempat data bisa menunggu.

Latency bisa muncul di:

- app queue sebelum write
- Java buffer aggregation
- kernel send buffer
- TCP retransmission
- NIC queue
- remote receive buffer
- remote app queue

---

## 13. Blocking Socket

Blocking socket berarti syscall bisa menunggu sampai operasi bisa dilakukan.

Contoh:

```text
accept() blocks until connection available
read() blocks until data available or EOF/error
write() blocks until buffer space available enough
connect() blocks until connected/error/timeout
```

Java classic blocking I/O:

```java
ServerSocket server = new ServerSocket(8080);

while (true) {
    Socket socket = server.accept(); // blocks
    handle(socket);
}
```

Jika handle dilakukan di thread yang sama, server hanya bisa menangani satu connection secara serial.

Biasanya:

```java
Socket socket = server.accept();
executor.submit(() -> handle(socket));
```

Tetapi model thread-per-connection punya limit:

- thread memory
- context switch
- blocking under high concurrency
- FD limit
- scheduler overhead

---

## 14. Non-Blocking Socket

Non-blocking socket berarti operasi tidak menunggu lama jika belum bisa dilakukan.

Jika tidak ada data:

```text
read() -> EAGAIN / EWOULDBLOCK
```

Jika send buffer penuh:

```text
write() -> partial write or EAGAIN
```

Jika connect belum selesai:

```text
connect() -> EINPROGRESS
```

Non-blocking I/O perlu readiness notification:

- `select`
- `poll`
- `epoll`

Java NIO memakai Selector yang di Linux biasanya berbasis epoll.

Model:

```text
set socket non-blocking
register interest read/write/accept/connect
event loop waits for readiness
on readiness, perform non-blocking operation
```

---

## 15. Readiness Is Not Completion

Dengan epoll/readiness model:

```text
socket readable
```

Artinya:

```text
a read operation might make progress now
```

Bukan:

```text
full application message is available
```

```text
socket writable
```

Artinya:

```text
some send buffer space may be available
```

Bukan:

```text
all your response can be written without partial write
```

Aplikasi harus siap:

- partial read
- partial write
- EAGAIN even after readiness
- message framing
- backpressure
- connection close
- error state

Ini sangat penting untuk Netty/NIO.

---

## 16. Java Blocking I/O Mapping

Classic Java:

```java
ServerSocket server = new ServerSocket(8080);
Socket client = server.accept();
InputStream in = client.getInputStream();
OutputStream out = client.getOutputStream();
```

Mapping konseptual:

```text
ServerSocket() -> socket/bind/listen
accept()       -> accept syscall
read()         -> read/recv syscall
write()        -> write/send syscall
close()        -> close syscall
```

Thread yang melakukan blocking call bisa tidur di kernel.

Observability:

```bash
strace -f -p <pid> -e trace=accept,read,write,recvfrom,sendto
```

Thread dump:

```text
RUNNABLE in native socketRead
WAITING/TIMED_WAITING depending implementation
```

Jangan selalu artikan Java `RUNNABLE` sebagai sedang menggunakan CPU. Bisa saja sedang blocked di native I/O.

---

## 17. Java NIO Mapping

Java NIO:

```java
ServerSocketChannel server = ServerSocketChannel.open();
server.configureBlocking(false);
server.bind(new InetSocketAddress(8080));

Selector selector = Selector.open();
server.register(selector, SelectionKey.OP_ACCEPT);
```

Mapping konseptual:

```text
socket()
fcntl(O_NONBLOCK)
bind()
listen()
epoll_create()
epoll_ctl(ADD)
epoll_wait()
accept4()
read()
write()
```

Java NIO memisahkan:

- readiness detection
- actual read/write
- application message parsing
- worker dispatch

Non-blocking I/O tidak otomatis berarti lebih cepat. Ia memberi model concurrency berbeda.

Jika callback/event loop melakukan blocking work, manfaatnya hilang.

---

## 18. Netty Mapping

Netty di Linux biasanya menggunakan:

1. Java NIO selector transport, atau
2. native epoll transport jika dikonfigurasi.

Mental model:

```text
Boss event loop:
  accept connections

Worker event loop:
  read/write socket events
  run channel pipeline callbacks
```

Penting:

- Event loop thread tidak boleh blocking.
- Handler CPU-heavy harus offload ke worker executor.
- Backpressure harus diterapkan.
- Partial writes harus dikelola.
- Write buffer high/low watermark penting.
- Event loop lag adalah sinyal runtime/network processing delay.

Failure:

```text
blocking database call in Netty event loop
```

Efek:

- event loop tidak membaca socket lain
- accept/read/write terlambat
- timeout naik
- connection backlog bisa naik
- p99 latency buruk

---

## 19. Socket Errors: Overview

Socket error sering muncul sebagai Java exception, tetapi akarnya errno/kernel/network.

| Errno | Makna umum | Java-level symptom |
|---|---|---|
| `ECONNREFUSED` | remote actively refused, no listener/RST | `ConnectException: Connection refused` |
| `ECONNRESET` | connection reset by peer | `SocketException: Connection reset` |
| `ETIMEDOUT` | operation timed out | timeout exception |
| `EADDRINUSE` | local address/port already in use | bind failed |
| `EADDRNOTAVAIL` | local address/port unavailable | connect/bind failed |
| `EMFILE` | process FD limit reached | too many open files |
| `ENFILE` | system-wide FD table limit | system too many open files |
| `EPIPE` | write to closed pipe/socket | broken pipe |
| `EAGAIN` | non-blocking would block | retry later |

---

## 20. `ECONNREFUSED`

Meaning:

```text
Client attempted connect, remote host responded that port is closed/no listener,
often via TCP RST.
```

Common causes:

- service not running
- wrong port
- bound to localhost only
- firewall/reject
- container port mismatch
- pod not ready but still targeted
- process crashed/restarting
- wrong service discovery target

Debug:

```bash
ss -ltnp | grep :8080
curl -v http://host:8080/
nc -vz host 8080
```

Inside container:

```bash
ss -ltnp
```

Check bind address:

```text
127.0.0.1:8080 vs 0.0.0.0:8080
```

---

## 21. `ETIMEDOUT`

Meaning:

```text
Operation did not complete within timeout.
```

For connect timeout:

- packets dropped
- network blackhole
- firewall drop
- routing issue
- SYN not answered
- remote overloaded/drop
- security group drop
- wrong IP

Contrast:

```text
ECONNREFUSED = fast negative answer
ETIMEDOUT = no useful answer in time
```

Debug:

```bash
ip route get <ip>
ping <ip>          # not always allowed/meaningful
traceroute <ip>    # if available
tcpdump            # if permitted
ss -tan state syn-sent
```

In Java, connect timeout must be explicitly configured.

---

## 22. `ECONNRESET`

Meaning:

```text
Connection reset by peer.
```

Remote side or middlebox sent RST.

Common causes:

- remote process closed abruptly
- application closed socket with unread data under some conditions
- load balancer reset idle connection
- protocol mismatch
- server crash/restart
- client writes after server closed
- timeout policy
- connection pool reusing stale connection

Java symptom:

```text
java.net.SocketException: Connection reset
```

Diagnosis:

- check remote logs
- check load balancer idle timeout
- check keepalive
- check connection pool validation
- packet capture if necessary
- correlate with deployment/restart

---

## 23. `EADDRINUSE`

Meaning:

```text
Cannot bind because address/port already in use.
```

Common causes:

- another process listening on same port
- previous instance not stopped
- binding same address/port without proper reuse semantics
- dual-stack IPv4/IPv6 interaction
- TIME_WAIT confusion in client/local port reuse scenarios

Debug:

```bash
ss -ltnp | grep :8080
lsof -i :8080
```

For Java service:

- check duplicate process
- check systemd restart overlap
- check Kubernetes hostPort conflict
- check test suite not releasing port
- use random port in tests if needed

---

## 24. `EADDRNOTAVAIL`

Meaning:

```text
Requested address is not available.
```

Server bind causes:

- binding to IP not assigned to host/container
- wrong interface
- IPv4/IPv6 mismatch

Client connect causes:

- local ephemeral port exhaustion
- source address issue
- local address binding wrong

Debug:

```bash
ip addr
ip route
ss -tan
cat /proc/sys/net/ipv4/ip_local_port_range
```

If many outgoing connections:

```bash
ss -tan state time-wait | wc -l
ss -tan state established | wc -l
```

---

## 25. `EMFILE`: Too Many Open Files

Meaning:

```text
Process reached FD limit.
```

For network server, symptoms:

- accept fails
- new connections fail
- file open fails
- logs show `Too many open files`
- health check may fail
- app can degrade strangely

Check limits:

```bash
cat /proc/<pid>/limits | grep "open files"
ulimit -n
```

Check FD count:

```bash
ls /proc/<pid>/fd | wc -l
lsof -p <pid> | wc -l
```

Find sockets:

```bash
lsof -p <pid> -a -i
ss -tanp | grep <pid>
```

Fix:

- close sockets/streams
- connection pool bounds
- idle timeout
- leak detection
- raise limit if justified
- reserve emergency FD for logging/accept mitigation in advanced servers

---

## 26. Ephemeral Ports

Client outgoing TCP connections use local ephemeral ports.

Connection tuple:

```text
src_ip:src_port -> dst_ip:dst_port
```

Ephemeral port range:

```bash
cat /proc/sys/net/ipv4/ip_local_port_range
```

Example:

```text
32768 60999
```

That gives about 28k ports per source IP for a given destination tuple, simplified.

If app creates many short-lived outgoing connections to same destination:

- ephemeral ports can be exhausted
- many sockets in TIME_WAIT
- connect can fail with `EADDRNOTAVAIL`
- latency increases

Mitigation:

- connection pooling
- keep-alive
- HTTP/2 multiplexing where appropriate
- increase ephemeral range carefully
- scale source IPs/nodes
- avoid connection churn
- fix client pool misconfiguration

---

## 27. Connection Pooling

For Java HTTP/DB/cache clients, connection pooling is essential.

Without pooling:

```text
each request -> new TCP connection -> handshake -> request -> close
```

Problems:

- CPU overhead
- latency overhead
- ephemeral port churn
- TIME_WAIT growth
- connection storm
- TLS handshake cost
- downstream accept pressure

With pooling:

```text
reuse established connections
```

But pooling has failure modes:

- stale connection reuse
- pool too small -> queueing
- pool too large -> downstream overload
- idle timeout mismatch
- no max lifetime
- no validation
- leak if response body not closed
- retry over closed connection

---

## 28. Socket Leak

Socket leak means application opens/accepts/connects socket and does not close it.

In Java:

```java
Socket s = new Socket(host, port);
// exception before close
```

Better:

```java
try (Socket s = new Socket(host, port)) {
    // use socket
}
```

For HTTP clients, closing response body matters.

Example bug:

```java
Response response = client.newCall(request).execute();
// forget response.close()
```

This can leak connection/resource or prevent reuse depending client.

Symptoms:

- FD count grows
- established connections grow
- CLOSE_WAIT grows
- downstream sees idle connections
- eventually EMFILE

Cek:

```bash
ls /proc/<pid>/fd | wc -l
ss -tanp | grep <pid> | awk '{print $1}' | sort | uniq -c
```

---

## 29. TCP States Basic View

Part ini belum masuk TCP internals penuh, tetapi kamu harus kenal state dasar:

| State | Meaning |
|---|---|
| `LISTEN` | server listening |
| `SYN-SENT` | client sent SYN, waiting |
| `SYN-RECV` | server received SYN, handshake not complete |
| `ESTAB` | connection established |
| `FIN-WAIT-1/2` | closing sequence from local side |
| `CLOSE-WAIT` | remote closed, local app not closed yet |
| `LAST-ACK` | local app closed after remote close |
| `TIME-WAIT` | wait after close to handle delayed packets |
| `CLOSED` | no connection |

Cek:

```bash
ss -tan
```

Count:

```bash
ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c
```

### 29.1 CLOSE_WAIT is often app issue

Many `CLOSE_WAIT` sockets usually mean:

```text
remote closed connection,
local kernel notified app,
but local application has not closed socket.
```

Often socket/resource leak.

### 29.2 TIME_WAIT is not automatically bad

TIME_WAIT is normal TCP behavior.

But excessive TIME_WAIT can indicate:

- connection churn
- no pooling
- wrong keep-alive
- short-lived client connections

---

## 30. Observability with `ss`

Show listening TCP:

```bash
ss -ltnp
```

Show all TCP:

```bash
ss -tanp
```

Show summary:

```bash
ss -s
```

Show process:

```bash
ss -tanp | grep java
```

Show queues:

```bash
ss -ltn
```

Example:

```text
State  Recv-Q Send-Q Local Address:Port Peer Address:Port
LISTEN 0      4096   0.0.0.0:8080      0.0.0.0:*
```

For established sockets, `Recv-Q` and `Send-Q` can show queued bytes.

High `Recv-Q`:

```text
app not reading fast enough
```

High `Send-Q`:

```text
remote/network not accepting fast enough or app wrote faster than send
```

Interpret with care.

---

## 31. Observability with `lsof`

List network files:

```bash
lsof -Pan -p <pid> -i
```

Options:

- `-P` avoid port name resolution
- `-n` avoid DNS lookup

Find port owner:

```bash
lsof -Pan -iTCP:8080 -sTCP:LISTEN
```

FD leak:

```bash
lsof -p <pid> | wc -l
```

But `lsof` can be heavy on large systems; use carefully.

---

## 32. Observability with `/proc/net/tcp`

Kernel exposes socket info:

```bash
cat /proc/net/tcp
cat /proc/net/tcp6
```

This is lower-level and encoded in hex.

Usually `ss` is easier.

But `/proc/net/tcp` matters when:

- minimal container lacks tools
- building custom diagnostics
- understanding kernel source/tooling
- namespace-specific view

Inside container, network namespace affects what you see.

---

## 33. Observability with `strace`

Trace server startup:

```bash
strace -f -e trace=socket,setsockopt,bind,listen,accept4 java -jar app.jar
```

Attach to running process:

```bash
strace -f -p <pid> -e trace=network -ttT
```

Trace common network syscalls:

```bash
strace -f -p <pid> \
  -e trace=socket,connect,accept,accept4,bind,listen,recvfrom,sendto,sendmsg,recvmsg,read,write,close \
  -ttT
```

What to look for:

- `EADDRINUSE`
- `ECONNREFUSED`
- long `connect`
- long `accept`
- `EAGAIN`
- repeated failed connect
- `EMFILE`
- partial writes
- resets/errors

Be careful: `strace` can add overhead.

---

## 34. Observability with `tcpdump`

`tcpdump` sees packets.

Useful for:

- is SYN leaving?
- is SYN-ACK returning?
- is RST sent?
- are retransmissions happening?
- is traffic reaching interface?
- is DNS query sent?

Examples:

```bash
tcpdump -i any tcp port 8080
tcpdump -i any host 10.0.0.5 and tcp
```

In container/Kubernetes, packet capture can be tricky:

- network namespace
- permissions/capabilities
- CNI
- host vs pod interface
- service NAT

Use carefully and avoid capturing sensitive payload.

---

## 35. Blocking Accept Loop Failure

Bad server:

```java
ServerSocket server = new ServerSocket(8080);

while (true) {
    Socket s = server.accept();
    handleRequestFully(s); // blocks for long time
}
```

Problem:

- while handling one connection, not accepting new ones
- accept queue fills
- clients timeout/refused under load

Better:

```java
while (true) {
    Socket s = server.accept();
    executor.submit(() -> handleRequestFully(s));
}
```

Still needs:

- bounded executor
- backpressure
- timeout
- socket close
- graceful shutdown
- max connections

Best in real production: use mature server/framework.

---

## 36. Unbounded Thread-per-Connection Failure

Naive:

```java
while (true) {
    Socket s = server.accept();
    new Thread(() -> handle(s)).start();
}
```

Failure:

- too many threads
- stack memory explosion
- context switch overhead
- scheduler contention
- CPU throttling
- OOM
- no backpressure

Better:

- bounded thread pool
- event-driven model
- max connection limit
- queue/rejection policy
- load shedding
- connection timeout

---

## 37. Non-Blocking Write Failure

In non-blocking I/O, write can be partial.

Wrong mental model:

```text
socket writable -> write entire response
```

Reality:

```text
write may write only N bytes
remaining bytes must be queued and written later
```

Frameworks like Netty handle this, but custom NIO code often gets it wrong.

Bug:

- response truncated
- busy loop writing
- memory grows unbounded
- no backpressure
- event loop spins on OP_WRITE

Correct:

- maintain outbound buffer
- register OP_WRITE only when needed
- unregister OP_WRITE when queue empty
- enforce high/low watermark
- close slow clients if necessary

---

## 38. Slow Client Problem

A slow client reads response slowly.

Server writes response:

```text
app -> kernel send buffer -> client slowly reads
```

If server keeps producing data:

- send buffer fills
- write blocks or pending outbound queue grows
- memory pressure
- worker/event loop stuck
- other clients affected

Mitigation:

- write timeout
- response size limit
- backpressure
- per-connection outbound buffer limit
- close slow clients
- avoid blocking event loop
- streaming with flow control

---

## 39. Connection Storm

Connection storm:

```text
many clients connect at once
```

Can happen during:

- deployment
- autoscaling
- cache restart
- downstream restart
- client retry storm
- load balancer rebalancing
- DNS change
- outage recovery

Effects:

- SYN backlog pressure
- accept queue pressure
- TLS handshake CPU
- FD spike
- ephemeral port use
- GC allocation spike
- application thread surge

Mitigation:

- connection pooling
- jitter reconnect
- backoff
- server backlog
- accept performance
- TLS offload/session reuse
- max connection limits
- load shedding
- readiness gating

---

## 40. Lab 1 — Inspect Listening Socket

Run simple Java server:

```java
import java.net.ServerSocket;
import java.net.Socket;

public class SimpleServer {
    public static void main(String[] args) throws Exception {
        ServerSocket server = new ServerSocket(8080);
        System.out.println("pid=" + ProcessHandle.current().pid());
        while (true) {
            Socket s = server.accept();
            System.out.println("accepted " + s);
            s.getOutputStream().write("hello\n".getBytes());
            s.close();
        }
    }
}
```

Compile/run:

```bash
javac SimpleServer.java
java SimpleServer
```

Inspect:

```bash
ss -ltnp | grep :8080
lsof -Pan -p <pid> -i
ls -l /proc/<pid>/fd
```

Connect:

```bash
nc 127.0.0.1 8080
```

Observe accepted connection.

---

## 41. Lab 2 — Bind Address

Modify server to bind localhost:

```java
import java.net.*;

public class BindLocalhost {
    public static void main(String[] args) throws Exception {
        ServerSocket server = new ServerSocket();
        server.bind(new InetSocketAddress("127.0.0.1", 8080));
        System.out.println("pid=" + ProcessHandle.current().pid());
        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Check:

```bash
ss -ltnp | grep :8080
```

Compare with binding:

```java
server.bind(new InetSocketAddress("0.0.0.0", 8080));
```

Understand:

- localhost only
- all interfaces
- container implications
- security implications

---

## 42. Lab 3 — EADDRINUSE

Run one server on port 8080.

Run second server same port.

Expected:

```text
java.net.BindException: Address already in use
```

Check owner:

```bash
ss -ltnp | grep :8080
lsof -Pan -iTCP:8080 -sTCP:LISTEN
```

---

## 43. Lab 4 — ECONNREFUSED

Try connect to unused local port:

```bash
nc -vz 127.0.0.1 65534
```

Java:

```java
import java.net.Socket;

public class ConnectRefused {
    public static void main(String[] args) throws Exception {
        new Socket("127.0.0.1", 65534);
    }
}
```

Expected:

```text
Connection refused
```

This is fast failure.

---

## 44. Lab 5 — FD Count Growth

Write a toy leaky client/server only in isolated lab.

Example client that opens sockets and does not close immediately:

```java
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;

public class SocketLeakLab {
    public static void main(String[] args) throws Exception {
        System.out.println("pid=" + ProcessHandle.current().pid());
        List<Socket> sockets = new ArrayList<>();

        while (true) {
            sockets.add(new Socket("127.0.0.1", 8080));
            System.out.println("open sockets=" + sockets.size());
            Thread.sleep(100);
        }
    }
}
```

Observe:

```bash
ls /proc/<pid>/fd | wc -l
ss -tanp | grep <pid> | wc -l
cat /proc/<pid>/limits | grep "open files"
```

Do not run against real services.

---

## 45. Lab 6 — strace Socket Calls

Run server under strace:

```bash
strace -f -e trace=socket,setsockopt,bind,listen,accept4,read,write,close java SimpleServer
```

Connect with `nc`.

Observe:

- socket creation
- bind
- listen
- accept
- write
- close

This builds syscall intuition.

---

## 46. Failure Mode 1 — Server Bind to Localhost in Container

### Gejala

- App logs “started on port 8080”.
- Health check from inside container works.
- Service from outside cannot connect.
- Kubernetes Service routes fail.

### Penyebab

App bind:

```text
127.0.0.1:8080
```

But should bind:

```text
0.0.0.0:8080
```

for container service exposure.

### Evidence

```bash
kubectl exec <pod> -- ss -ltnp
```

Look for:

```text
127.0.0.1:8080
```

### Fix

Configure server address:

```text
0.0.0.0
```

But keep admin/private endpoints protected.

---

## 47. Failure Mode 2 — Accept Queue Full

### Gejala

- Clients see connect timeout/refused under burst.
- App CPU high or stuck.
- Server port listening.
- Latency spikes during traffic burst.
- Kernel listen overflow counters increase.

### Penyebab

- application accept loop too slow
- event loop blocked
- worker pool exhausted
- backlog too small
- CPU throttling
- TLS handshake overload
- FD exhaustion

### Evidence

```bash
ss -ltn
nstat -az | grep -i listen
netstat -s | grep -i listen
jcmd <pid> Thread.print
cat /sys/fs/cgroup/cpu.stat
```

### Fix

- unblock accept/event loop
- increase CPU headroom
- tune backlog carefully
- increase `somaxconn` if justified
- bound expensive handshake/work
- load shed
- scale out
- fix thread pool bottleneck

---

## 48. Failure Mode 3 — Too Many Open Files

### Gejala

- `java.io.IOException: Too many open files`
- accept/connect/file open fail
- FD count near limit
- many sockets in `ESTAB`/`CLOSE_WAIT`

### Penyebab

- socket leak
- response body not closed
- connection pool too large
- no idle timeout
- FD limit too low
- logging/file leak
- accepted sockets not closed on error path

### Evidence

```bash
cat /proc/<pid>/limits | grep "open files"
ls /proc/<pid>/fd | wc -l
lsof -p <pid> | awk '{print $5}' | sort | uniq -c
ss -tanp | grep <pid> | awk '{print $1}' | sort | uniq -c
```

### Fix

- close resources
- use try-with-resources
- fix client response close
- cap connection pool
- close idle connections
- raise `ulimit -n` only after fixing leak/capacity model
- alert on FD usage

---

## 49. Failure Mode 4 — Ephemeral Port Exhaustion

### Gejala

- client errors connecting out
- `Cannot assign requested address`
- many TIME_WAIT
- high outbound connection churn
- no connection reuse

### Penyebab

- no pooling
- very high request rate to same destination
- short-lived TCP connections
- retry storm
- low ephemeral port range
- NAT/source IP bottleneck

### Evidence

```bash
cat /proc/sys/net/ipv4/ip_local_port_range
ss -tan state time-wait | wc -l
ss -tan state syn-sent | wc -l
ss -tan | awk '{print $1}' | sort | uniq -c
```

### Fix

- enable pooling/keep-alive
- use HTTP/2 multiplexing if suitable
- reduce retry storm
- increase source IPs/scale clients
- tune ephemeral range carefully
- avoid per-request connection creation

---

## 50. Failure Mode 5 — Event Loop Blocked

### Gejala

- Netty/WebFlux/gRPC latency spike
- event loop lag high
- accept/read/write delayed
- CPU maybe normal or throttled
- thread dump shows event loop doing blocking work

### Penyebab

- blocking DB/HTTP/file call in event loop
- CPU-heavy serialization in event loop
- lock contention
- synchronous logging
- large compression/encryption
- GC/safepoint/throttling

### Evidence

```bash
jcmd <pid> Thread.print
pidstat -t -p <pid> 1
cat /sys/fs/cgroup/cpu.stat
ss -tanp
```

App metrics:

- event loop lag
- pending tasks
- outbound buffer
- request p99

### Fix

- move blocking work to bounded worker pool
- reduce CPU-heavy handler logic
- apply backpressure
- monitor event loop
- increase CPU headroom if justified
- avoid synchronous logging in event loop

---

## 51. Failure Mode 6 — Slow Client Consumes Server Resources

### Gejala

- many established connections
- high Send-Q
- memory grows
- write latency high
- worker threads blocked on write
- event loop outbound buffer grows

### Penyebab

- clients read slowly
- server sends large responses
- no write timeout
- no outbound buffer limit
- blocking writes
- no backpressure

### Evidence

```bash
ss -tanp | grep <pid>
```

Look at Send-Q.

Application:

- response size
- write duration
- outbound buffer metrics
- connection age

### Fix

- write timeout
- close slow clients
- streaming with backpressure
- response size limits
- non-blocking writes
- outbound high/low watermarks

---

## 52. Production Network Debugging Checklist

When Java service has connection issue:

```text
[ ] Is process listening?
[ ] On which address: 127.0.0.1, 0.0.0.0, specific IP, IPv6?
[ ] Is port correct?
[ ] Is service inside correct network namespace/container?
[ ] Are clients seeing refused or timeout?
[ ] Is accept queue full?
[ ] Is FD limit reached?
[ ] Are many sockets in CLOSE_WAIT/TIME_WAIT/SYN-SENT?
[ ] Is client using connection pooling?
[ ] Is event loop blocked?
[ ] Is CPU throttling affecting accept/read/write?
[ ] Are socket buffers/queues growing?
[ ] Are load balancer idle timeouts involved?
[ ] Are DNS/service discovery targets correct?
```

Commands:

```bash
ss -ltnp
ss -tanp
ss -s
lsof -Pan -p <pid> -i
ls /proc/<pid>/fd | wc -l
cat /proc/<pid>/limits
cat /sys/fs/cgroup/cpu.stat
jcmd <pid> Thread.print
strace -f -p <pid> -e trace=network -ttT
```

---

## 53. Design Checklist untuk Java Network Service

```text
[ ] Bind address deliberate.
[ ] Public/admin ports separated.
[ ] Server backlog configured consciously.
[ ] Kernel somaxconn understood if tuning backlog.
[ ] FD limit sized for max connections + files + margin.
[ ] Connection pool bounded.
[ ] Client timeouts explicit.
[ ] Response bodies always closed.
[ ] Event loop never blocks on I/O/CPU-heavy work.
[ ] Slow client handling exists.
[ ] Keep-alive/idle timeout aligned with load balancer.
[ ] Metrics include active connections, accept errors, connection errors.
[ ] p99 latency correlated with socket queues and CPU throttling.
[ ] Graceful shutdown drains connections.
[ ] Retry/backoff prevents connection storm.
```

---

## 54. Common Misinterpretations

### Misinterpretation 1

```text
Server is listening, so network is fine.
```

Correction:

```text
Listening only proves bind/listen. Accept queue, app threads, FD, CPU, routing, LB, and protocol can still fail.
```

### Misinterpretation 2

```text
write() returned, so remote received the data.
```

Correction:

```text
Usually write copied data into kernel send buffer. Remote application may not have read it yet.
```

### Misinterpretation 3

```text
Connection refused and timeout are same.
```

Correction:

```text
Refused is active negative response. Timeout often means no response/drop/blackhole.
```

### Misinterpretation 4

```text
CLOSE_WAIT is a network problem.
```

Correction:

```text
Many CLOSE_WAIT sockets usually mean local application did not close after remote closed.
```

### Misinterpretation 5

```text
Non-blocking I/O means no waiting anywhere.
```

Correction:

```text
It means syscalls return if they would block. Data can still wait in buffers/queues, and event loop can lag.
```

### Misinterpretation 6

```text
Backlog solves overload.
```

Correction:

```text
Backlog buffers bursts. It does not create processing capacity.
```

---

## 55. Invariant yang Harus Diingat

1. Socket is a file descriptor referencing a kernel socket object.
2. Listening socket and accepted socket are different FDs.
3. `bind` attaches local address/port.
4. `listen` creates a listening socket and accept queue.
5. `accept` returns a new connected socket.
6. `connect` starts client-side connection establishment.
7. Backlog absorbs bursts, not sustained overload.
8. Accept queue can fill if application accepts too slowly.
9. Socket send/receive buffers are kernel buffers.
10. `write` success does not mean remote app processed data.
11. Blocking socket can park thread in kernel.
12. Non-blocking socket requires readiness/event loop logic.
13. Readiness is not completion.
14. Partial reads/writes are normal.
15. `ECONNREFUSED` differs from `ETIMEDOUT`.
16. `EADDRINUSE` usually means bind conflict.
17. `EADDRNOTAVAIL` can indicate ephemeral port exhaustion or bad local address.
18. `EMFILE` means process FD limit reached.
19. Many `CLOSE_WAIT` often implicates local close leak.
20. Many `TIME_WAIT` often indicates connection churn.
21. Event loop must not block.
22. Connection pooling prevents churn but needs bounds.
23. Slow clients require backpressure/write limits.
24. Network diagnosis must combine kernel socket state and application state.

---

## 56. Pertanyaan Senior-Level Reasoning

### Q1

Apa perbedaan listening socket dan accepted socket?

Jawaban:

- Listening socket menerima koneksi baru lewat `accept`.
- Accepted socket adalah FD baru untuk satu koneksi established.
- Data request/response terjadi pada accepted socket, bukan listening socket.

### Q2

Kenapa `write()` ke socket tidak berarti remote sudah menerima data?

Jawaban:

- `write()` biasanya hanya menyalin data ke kernel send buffer.
- Data masih harus dikirim via TCP, di-ACK, masuk receive buffer remote, lalu dibaca aplikasi remote.
- Network/remote bisa lambat atau gagal setelah write.

### Q3

Apa kemungkinan penyebab banyak `CLOSE_WAIT`?

Jawaban:

- Remote sudah close.
- Local kernel memberi tahu aplikasi.
- Aplikasi lokal belum close socket.
- Biasanya resource leak atau lifecycle bug di aplikasi.

### Q4

Kenapa server bisa timeout/refuse koneksi walau process masih hidup?

Jawaban:

- accept queue penuh
- app lambat accept
- event loop blocked
- FD limit habis
- CPU throttling
- backlog kecil
- SYN backlog/drop
- firewall/LB behavior

### Q5

Apa bedanya `ECONNREFUSED` dan `ETIMEDOUT`?

Jawaban:

- `ECONNREFUSED`: remote/stack memberi respons aktif bahwa koneksi ditolak.
- `ETIMEDOUT`: tidak ada respons cukup sampai timeout; sering drop/blackhole/routing/firewall.

### Q6

Kenapa non-blocking I/O masih bisa menyebabkan latency tinggi?

Jawaban:

- Event loop bisa blocked.
- App queue bisa penuh.
- Socket buffers bisa penuh.
- Partial writes perlu antre.
- CPU throttling bisa menunda event loop.
- Backpressure bisa menahan data.
- Non-blocking hanya mengubah syscall behavior, bukan menghapus bottleneck.

---

## 57. Ringkasan

Network socket di Linux adalah file descriptor ke kernel socket object.

Untuk Java backend engineer, pemahaman ini mengubah cara membaca masalah network:

```text
Java exception
  -> errno/socket state
  -> kernel queue/buffer
  -> application lifecycle
  -> network path
```

Mental model penting:

```text
server startup:
  socket -> bind -> listen -> accept

client connection:
  socket -> connect -> send/recv

runtime:
  socket fd
  send buffer
  receive buffer
  accept queue
  blocking/non-blocking mode
  TCP state
```

Production diagnosis tidak boleh berhenti di:

```text
"network error"
```

Harus diturunkan menjadi pertanyaan spesifik:

```text
Is it refused, timed out, reset, queued, throttled, leaked, full, blocked, or misbound?
```

Dengan tools seperti:

```text
ss
lsof
/proc/<pid>/fd
/proc/net/tcp
strace
jcmd Thread.print
tcpdump
```

kamu bisa menghubungkan dunia Java dengan kernel socket state.

---

## 58. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `socket(2)`  
   `https://man7.org/linux/man-pages/man2/socket.2.html`

2. Linux man-pages — `bind(2)`  
   `https://man7.org/linux/man-pages/man2/bind.2.html`

3. Linux man-pages — `listen(2)`  
   `https://man7.org/linux/man-pages/man2/listen.2.html`

4. Linux man-pages — `accept(2)`  
   `https://man7.org/linux/man-pages/man2/accept.2.html`

5. Linux man-pages — `connect(2)`  
   `https://man7.org/linux/man-pages/man2/connect.2.html`

6. Linux man-pages — `send(2)`  
   `https://man7.org/linux/man-pages/man2/send.2.html`

7. Linux man-pages — `recv(2)`  
   `https://man7.org/linux/man-pages/man2/recv.2.html`

8. Linux man-pages — `tcp(7)`  
   `https://man7.org/linux/man-pages/man7/tcp.7.html`

9. Linux man-pages — `ip(7)`  
   `https://man7.org/linux/man-pages/man7/ip.7.html`

10. Linux Kernel Documentation — networking  
   `https://docs.kernel.org/networking/`

11. Java Platform Documentation — `java.net`, `java.nio.channels`  
   `https://docs.oracle.com/en/java/javase/`

12. Netty Documentation — transport/event loop concepts  
   `https://netty.io/wiki/`

---

## 59. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 016 — Network Stack I: From Socket API to Kernel
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-017.md
Part 017 — Network Stack II: TCP Internals for Backend Engineers
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — IPC: Pipes, Unix Sockets, Shared Memory, Futex</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-017.md">Part 017 — Network Stack II: TCP Internals for Backend Engineers ➡️</a>
</div>
