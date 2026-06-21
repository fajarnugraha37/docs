# learn-linux-kernel-mastery-for-java-engineers-part-017.md

# Part 017 — Network Stack II: TCP Internals for Backend Engineers

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `017`  
> Topik: TCP internals untuk backend engineer: handshake, sequence/ACK, flow control, congestion control, retransmission, timeout, FIN/RST, TIME_WAIT, keepalive, Nagle, delayed ACK, socket options, dan implikasi ke Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 016, kita membahas socket API dari sudut aplikasi:

- `socket`
- `bind`
- `listen`
- `accept`
- `connect`
- socket sebagai file descriptor
- send/receive buffer
- blocking vs non-blocking socket
- backlog
- error seperti `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `EMFILE`
- observability dengan `ss`, `lsof`, `/proc`, `strace`

Part 017 masuk ke lapisan berikutnya:

> Apa yang sebenarnya dilakukan TCP setelah socket dibuat dan koneksi dianggap established?

Ini penting karena banyak masalah backend terlihat sebagai:

```text
timeout
connection reset
slow request
stale connection
broken pipe
connection pool error
load balancer idle timeout
random p99 spike
```

Tetapi akar masalahnya sering berada di TCP behavior:

- retransmission
- packet loss
- flow control
- congestion control
- send/receive buffer
- idle timeout
- half-open connection
- FIN/RST semantics
- TIME_WAIT
- delayed ACK
- Nagle
- keepalive

Tujuan part ini bukan membuat kamu menjadi kernel networking maintainer, tetapi membuat kamu bisa membaca gejala produksi secara struktural.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan TCP sebagai reliable byte stream, bukan message protocol.
2. Memahami TCP connection lifecycle:
   - SYN
   - SYN-ACK
   - ACK
   - ESTABLISHED
   - FIN
   - RST
   - TIME_WAIT
3. Memahami sequence number dan ACK secara praktis.
4. Membedakan:
   - flow control
   - congestion control
   - application backpressure
5. Memahami retransmission dan kenapa packet loss menjadi latency.
6. Memahami `FIN` vs `RST`.
7. Memahami `TIME_WAIT` dan kenapa ia normal.
8. Memahami `CLOSE_WAIT` sebagai sinyal aplikasi belum close.
9. Memahami keepalive:
   - TCP keepalive
   - application heartbeat
   - HTTP keep-alive
   - load balancer idle timeout
10. Memahami Nagle algorithm dan delayed ACK secara praktis.
11. Memahami socket options:
    - `TCP_NODELAY`
    - `SO_KEEPALIVE`
    - `SO_REUSEADDR`
    - `SO_REUSEPORT`
    - `SO_LINGER`
    - buffer options
12. Membaca `ss -ti` untuk melihat TCP internal state.
13. Menghubungkan TCP behavior dengan Java:
    - HTTP client/server
    - JDBC connection
    - Redis/cache client
    - gRPC/HTTP2
    - Netty
    - connection pooling
14. Mendiagnosis failure:
    - retransmission storm
    - stale pooled connection
    - connection reset
    - idle timeout mismatch
    - ephemeral port exhaustion
    - half-open connection
    - slow receiver
    - zero window
    - blackhole connection

---

## 2. TCP dalam Satu Kalimat

TCP adalah protokol transport yang menyediakan:

```text
reliable, ordered, bidirectional byte stream between two endpoints
```

Kata-kata penting:

### 2.1 Reliable

TCP berusaha memastikan byte sampai, atau koneksi dianggap gagal.

Jika packet hilang, TCP melakukan retransmission.

### 2.2 Ordered

Byte dikirim ke aplikasi penerima dalam urutan yang benar.

Jika segment datang out-of-order, kernel menahan sampai gap terisi.

### 2.3 Bidirectional

Kedua sisi bisa mengirim dan menerima.

Setiap arah punya sequence number dan flow control sendiri.

### 2.4 Byte stream

TCP tidak tahu message boundary aplikasi.

Jika aplikasi mengirim:

```text
"hello"
"world"
```

Penerima bisa membaca:

```text
"hell"
"oworld"
```

atau:

```text
"helloworld"
```

Protocol aplikasi harus punya framing:

- HTTP header/content-length/chunked
- length-prefixed protocol
- delimiter
- protobuf/gRPC framing
- custom binary framing

---

## 3. TCP Bukan HTTP

HTTP request/response adalah protocol aplikasi.

TCP hanya stream byte.

Kesalahan mental model:

```text
1 write() == 1 packet == 1 HTTP request
```

Yang benar:

```text
application writes bytes
TCP may segment/coalesce/retransmit
receiver reads arbitrary chunks
application parser reconstructs messages
```

Implikasi Java:

- Jangan mengasumsikan satu `read()` menghasilkan satu message.
- Jangan mengasumsikan satu `write()` dikirim sebagai satu packet.
- Parser harus handle partial data.
- Non-blocking framework harus punya buffer/framing.
- Protocol correctness tidak boleh bergantung pada packet boundary.

---

## 4. TCP Connection Tuple

Satu koneksi TCP diidentifikasi oleh 4-tuple:

```text
source IP
source port
destination IP
destination port
```

Contoh:

```text
10.0.0.5:52344 -> 10.0.0.10:443
```

Dua koneksi bisa punya destination sama tetapi source port berbeda.

Ephemeral port penting karena client membutuhkan source port unik untuk koneksi outbound.

---

## 5. Three-Way Handshake

TCP connection establishment klasik:

```text
Client                              Server
------                              ------
SYN          -------------------->
             <--------------------  SYN-ACK
ACK          -------------------->

Connection ESTABLISHED
```

### 5.1 Client side

Client mengirim `SYN`.

State:

```text
SYN-SENT
```

### 5.2 Server side

Server menerima `SYN`, mengirim `SYN-ACK`.

State:

```text
SYN-RECV
```

### 5.3 Client final ACK

Client mengirim ACK final.

Koneksi established.

### 5.4 Application visibility

Server application tidak selalu melihat koneksi saat SYN pertama datang.

Kernel menyelesaikan handshake, lalu completed connection masuk accept queue, lalu application `accept()` mengambilnya.

---

## 6. Handshake Failure Patterns

### 6.1 Fast refuse

Jika remote host reachable tetapi port tidak listening:

```text
SYN ->
<- RST
```

Client melihat:

```text
ECONNREFUSED
```

Java:

```text
java.net.ConnectException: Connection refused
```

### 6.2 Timeout/blackhole

Jika SYN tidak dijawab:

```text
SYN ->
(no response)
SYN retransmit
(no response)
...
timeout
```

Client melihat:

```text
ETIMEDOUT
```

atau Java connect timeout.

### 6.3 SYN backlog pressure

Server menerima banyak SYN dan queue tertekan.

Efek:

- SYN drop
- retransmission
- connect latency naik
- load balancer health check gagal
- kernel counters naik

### 6.4 Accept queue full

Handshake completed tetapi application lambat accept.

Efek:

- completed connection queue penuh
- connect latency/error naik
- listen overflow counters bisa naik

---

## 7. Sequence Number

TCP memberi nomor pada byte stream.

Jika client mengirim byte:

```text
A B C D E
```

TCP melihat sebagai sequence of bytes.

Misal initial sequence number = 1000:

```text
A -> seq 1000
B -> seq 1001
C -> seq 1002
D -> seq 1003
E -> seq 1004
```

ACK dari receiver biasanya berarti:

```text
next byte expected
```

Jika receiver ACK 1005:

```text
Saya sudah menerima sampai byte 1004, berikutnya saya harap 1005.
```

Sequence number memungkinkan:

- ordering
- retransmission
- duplicate detection
- loss detection
- stream reconstruction

---

## 8. ACK

ACK adalah konfirmasi penerimaan byte.

ACK bersifat cumulative.

Jika receiver ACK 5000:

```text
semua byte sebelum 5000 sudah diterima berurutan
```

TCP juga bisa memakai selective acknowledgment jika enabled, tetapi mental model cumulative ACK cukup untuk dasar.

ACK bukan berarti aplikasi remote sudah memproses data.

ACK berarti kernel remote menerima data ke TCP receive path/buffer.

Jadi:

```text
write() success
  != remote app processed

ACK received
  != remote app processed

HTTP response received
  = remote application/proxy produced response at application layer
```

---

## 9. TCP Receive Buffer dan Flow Control

Receiver punya receive buffer.

Jika application lambat membaca:

```text
kernel receive buffer fills
```

Receiver mengiklankan window lebih kecil kepada sender.

Ini disebut flow control.

Flow control menjawab:

```text
seberapa banyak data boleh dikirim sender agar receiver buffer tidak overflow?
```

Jika receive window menjadi 0:

```text
zero window
```

Sender berhenti mengirim data baru dan melakukan probe.

### 9.1 Backend implication

Jika service tidak membaca socket cepat:

- remote sender melambat
- latency naik
- send buffer remote penuh
- upstream thread bisa block
- event loop bisa backlog
- connection terlihat established tetapi throughput rendah

Misalnya server Java melakukan CPU-heavy work sebelum membaca request body, client bisa tertahan.

---

## 10. TCP Send Buffer

Sender punya send buffer.

Ketika aplikasi memanggil `write()`:

```text
application bytes -> kernel send buffer
```

Jika send buffer punya ruang, `write()` bisa return.

Jika send buffer penuh:

- blocking socket: `write()` bisa block
- non-blocking socket: partial write atau `EAGAIN`
- event-driven framework harus menunggu writable

Data di send buffer tetap tanggung jawab kernel sampai:

- dikirim
- di-ACK
- retransmitted if needed
- connection fails
- socket closed/reset

### 10.1 Backend implication

Slow remote receiver bisa membuat send buffer penuh.

Jika server memakai blocking write di request thread, thread bisa tertahan.

Jika event loop menyimpan outbound bytes tanpa limit, memory bisa naik.

---

## 11. Flow Control vs Congestion Control

Dua konsep ini sering tercampur.

### 11.1 Flow control

Melindungi receiver.

Pertanyaan:

```text
Apakah receiver mampu menerima data lebih banyak?
```

Mechanism:

```text
receive window
```

Bottleneck:

- remote app lambat read
- remote receive buffer kecil/penuh
- downstream processing lambat

### 11.2 Congestion control

Melindungi network path.

Pertanyaan:

```text
Apakah network path mampu membawa data lebih banyak tanpa congestion?
```

Mechanism:

- congestion window
- slow start
- congestion avoidance
- loss signal
- RTT
- algorithms like CUBIC/BBR depending host

Bottleneck:

- packet loss
- queueing in network
- overloaded link
- cross traffic
- path capacity

### 11.3 Application backpressure

Melindungi aplikasi.

Pertanyaan:

```text
Apakah application layer mampu memproses lebih banyak work?
```

Mechanism:

- bounded queue
- rate limit
- reject
- pause read
- reactive demand
- connection pool limit
- HTTP/2 flow control
- broker flow control

Ketiganya berbeda tetapi saling berinteraksi.

---

## 12. Congestion Control secara Praktis

TCP tidak langsung mengirim unlimited data.

Ia memperkirakan kapasitas network.

Konsep penting:

- congestion window (`cwnd`)
- round-trip time (`RTT`)
- packet loss/retransmission
- pacing
- slow start
- congestion avoidance

Jika packet loss terjadi:

- TCP menganggap mungkin congestion
- retransmits missing data
- bisa mengurangi sending rate
- latency naik
- throughput turun

Bagi backend engineer:

```text
packet loss is latency
```

Bukan hanya “beberapa packet hilang”.

Satu packet loss pada request/response kecil bisa menyebabkan tail latency besar jika retransmission timeout terlibat.

---

## 13. Retransmission

TCP retransmits segment yang dianggap hilang.

Loss detection bisa melalui:

- duplicate ACK
- timeout
- selective ACK info
- RTO

### 13.1 Gejala produksi

Retransmission dapat muncul sebagai:

- random latency spike
- HTTP timeout
- gRPC deadline exceeded
- database query tiba-tiba lambat
- connection reset setelah lama
- throughput turun
- p99/p999 buruk

### 13.2 Observability

Lihat dengan:

```bash
ss -ti
```

Contoh output bisa menunjukkan field seperti:

```text
rto
rtt
cwnd
retrans
bytes_acked
bytes_sent
```

Counter system:

```bash
nstat -az | grep -i retrans
netstat -s | grep -i retrans
```

Packet capture:

```bash
tcpdump -i any host <ip> and tcp
```

---

## 14. RTT dan RTO

RTT = round-trip time.

RTO = retransmission timeout.

TCP memperkirakan RTT dan variasinya untuk menentukan kapan retransmit jika ACK tidak datang.

Jika network jitter/loss tinggi:

- RTO bisa naik
- retransmission delay makin terasa
- connection terlihat “stuck” sementara
- application timeout bisa terjadi sebelum TCP menyatakan gagal

Java timeout harus dirancang di atas realitas ini.

Jangan hanya mengandalkan TCP default timeout yang bisa jauh lebih lama dari user deadline.

---

## 15. FIN: Graceful TCP Close

FIN berarti:

```text
Saya selesai mengirim data pada arah ini.
```

TCP close bersifat half-close.

Satu sisi bisa mengirim FIN tetapi masih menerima data.

Simplified graceful close:

```text
A                                  B
-                                  -
FIN ----------------------------->
   <----------------------------- ACK

   <----------------------------- FIN
ACK ----------------------------->
```

State yang muncul:

- `FIN-WAIT-1`
- `FIN-WAIT-2`
- `CLOSE-WAIT`
- `LAST-ACK`
- `TIME-WAIT`

### 15.1 Application meaning

Jika remote mengirim FIN, local read biasanya mendapat EOF:

```text
read returns -1
```

Application harus close socket ketika selesai.

Jika tidak, socket bisa berada di `CLOSE_WAIT`.

---

## 16. RST: Abrupt Reset

RST berarti:

```text
Connection is reset/aborted.
```

RST bukan graceful close.

Penyebab umum:

- peer process crash/restart
- application closes abortively
- write to connection that peer no longer has
- firewall/load balancer reset
- protocol error
- `SO_LINGER` configured to reset on close
- connection pool uses stale closed connection
- service closes idle connection and client writes later

Java symptom:

```text
java.net.SocketException: Connection reset
```

atau:

```text
Broken pipe
```

Tergantung arah operasi.

### 16.1 FIN vs RST

| FIN | RST |
|---|---|
| graceful close | abrupt abort |
| peer says no more data | peer says connection invalid |
| read EOF | read/write error |
| normal lifecycle | often error/abort/policy |

---

## 17. Half-Open Connection

Half-open connection bisa berarti beberapa hal secara informal. Dalam production biasanya:

```text
one side thinks connection is alive,
other side is gone or unreachable
```

Penyebab:

- network partition
- NAT/LB state expired
- peer crashed without FIN/RST reaching
- firewall silently drops
- idle connection through middlebox
- laptop/client sleep
- container killed abruptly

TCP may not detect immediately if no traffic.

Application sees issue only when:

- sends data
- keepalive probes fail
- application heartbeat fails
- read/write timeout occurs

---

## 18. TCP Keepalive

TCP keepalive adalah kernel-level mechanism untuk mendeteksi idle dead peers.

Biasanya disabled by default per socket unless enabled.

Option:

```text
SO_KEEPALIVE
```

Linux sysctls:

```bash
sysctl net.ipv4.tcp_keepalive_time
sysctl net.ipv4.tcp_keepalive_intvl
sysctl net.ipv4.tcp_keepalive_probes
```

Defaults sering sangat panjang, misalnya jam, bukan detik.

### 18.1 Keepalive is not application timeout

TCP keepalive berguna untuk idle dead connection detection, tetapi:

- terlalu lambat untuk request deadline
- tidak mengganti read timeout
- tidak mengganti application heartbeat
- tidak mengganti pool validation
- bisa tidak cukup melewati middlebox policy

### 18.2 Java implication

Untuk Java Socket:

```java
socket.setKeepAlive(true);
```

Tetapi interval/probes sering OS-level unless library exposes TCP keepalive tuning.

Netty/native transports mungkin expose lebih banyak option.

---

## 19. HTTP Keep-Alive vs TCP Keepalive

Nama mirip, makna berbeda.

### 19.1 HTTP keep-alive

Application-layer connection reuse.

Artinya:

```text
gunakan koneksi TCP yang sama untuk banyak HTTP request/response
```

### 19.2 TCP keepalive

Kernel-level idle probe.

Artinya:

```text
cek apakah peer TCP masih reachable setelah idle lama
```

HTTP keep-alive tidak otomatis mengirim TCP keepalive probes.

TCP keepalive tidak membuat HTTP request.

---

## 20. Application Heartbeat

Application heartbeat adalah protocol-level ping.

Contoh:

- WebSocket ping/pong
- gRPC HTTP/2 PING
- database protocol heartbeat
- custom ping frame
- broker heartbeat

Keuntungan:

- lebih cepat dari TCP keepalive
- semantik aplikasi jelas
- bisa mengukur liveness pada protocol layer
- bisa melewati beberapa middlebox jika traffic valid

Risiko:

- heartbeat terlalu agresif meningkatkan traffic
- false positive saat GC/throttling
- heartbeat handler bisa blocked
- heartbeat tidak membuktikan full service health

---

## 21. Idle Timeout Mismatch

Ini failure umum.

Misal:

```text
Client connection pool idle timeout: 10 minutes
Load balancer idle timeout:         60 seconds
Server idle timeout:                75 seconds
```

Client menyimpan koneksi idle 10 menit.

LB menutup koneksi setelah 60 detik.

Client mencoba reuse koneksi setelah 5 menit.

Hasil:

- connection reset
- broken pipe
- first request after idle fails
- retry may hide but increases latency
- p99 spike

Fix:

```text
client idle timeout < LB/server idle timeout
```

Atau validate connection before reuse, plus retry idempotent operations.

---

## 22. TIME_WAIT

TIME_WAIT adalah state TCP normal setelah close aktif pada sisi tertentu.

Tujuan:

1. memastikan delayed packets dari koneksi lama tidak mengganggu koneksi baru
2. memungkinkan retransmission final ACK jika perlu

TIME_WAIT sering terlihat banyak pada client yang membuat short-lived connection.

Cek:

```bash
ss -tan state time-wait | wc -l
```

TIME_WAIT bukan otomatis masalah.

Masalah jika:

- ephemeral port exhausted
- connection churn tinggi
- no pooling
- NAT table pressure
- system resource pressure

### 22.1 Siapa yang masuk TIME_WAIT?

Biasanya sisi yang melakukan active close.

Dalam HTTP client short-lived connection, client sering masuk TIME_WAIT.

Dalam server closing idle keepalive, server bisa punya TIME_WAIT.

---

## 23. CLOSE_WAIT

CLOSE_WAIT berarti:

```text
remote sent FIN,
local kernel delivered EOF,
local application has not closed socket yet.
```

Banyak `CLOSE_WAIT` sering menandakan bug aplikasi.

Cek:

```bash
ss -tan state close-wait
ss -tanp state close-wait
```

Java causes:

- not closing response/body/socket
- connection pool bug/misuse
- stream not closed on exception
- server handler not closing
- stuck thread holding socket
- protocol not finishing close path

Fix aplikasi, bukan sysctl.

---

## 24. FIN_WAIT_2

FIN_WAIT_2 berarti local sudah mengirim FIN dan menerima ACK, tetapi menunggu FIN dari remote.

Jika banyak:

- remote tidak close
- protocol close mismatch
- long half-close
- peer bug
- timeout tuning issue

Perlu konteks.

---

## 25. Nagle Algorithm

Nagle algorithm mencoba mengurangi tiny packets.

Simplified:

```text
If there is unacknowledged data in flight,
buffer small writes until ACK or enough data accumulates.
```

Tujuan:

- mengurangi overhead packet kecil
- meningkatkan efisiensi jaringan

Masalah:

- bisa menambah latency untuk request/response kecil interaktif
- bisa berinteraksi buruk dengan delayed ACK

Disable dengan:

```text
TCP_NODELAY
```

Java:

```java
socket.setTcpNoDelay(true);
```

Netty:

```java
ChannelOption.TCP_NODELAY
```

Banyak framework low-latency mengaktifkan TCP_NODELAY.

Tetapi jangan cargo cult. Untuk streaming bulk, Nagle bisa membantu efisiensi.

---

## 26. Delayed ACK

Receiver bisa menunda ACK sebentar dengan harapan dapat mengirim ACK bersama data balik atau mengurangi ACK packet.

Interaksi buruk:

```text
sender uses Nagle
receiver delays ACK
sender waits ACK before sending small next segment
receiver waits before ACK
latency spike
```

Ini klasik small-message latency issue.

Untuk request/response kecil, `TCP_NODELAY` sering membantu.

Namun di aplikasi modern, buffering di application/framework/TLS/HTTP2 juga berpengaruh.

---

## 27. `TCP_NODELAY`

`TCP_NODELAY` menonaktifkan Nagle.

Gunakan ketika:

- low-latency small messages
- RPC
- interactive protocol
- request/response kecil
- event-driven server dengan explicit batching

Hati-hati:

- bisa meningkatkan packet count
- bisa menambah CPU/network overhead
- jika aplikasi melakukan banyak tiny writes, sebaiknya perbaiki batching/framing juga

Better:

```text
write complete frame at once
```

Bukan:

```text
write 1 byte many times and rely only on TCP_NODELAY
```

---

## 28. `SO_REUSEADDR`

`SO_REUSEADDR` sering dipakai server agar bind lebih fleksibel.

Di Linux, semantics harus dipahami dengan hati-hati.

Use cases:

- restart server setelah close
- bind address behavior
- avoid some TIME_WAIT bind issues

Tetapi:

- tidak berarti dua process bebas bind port sama untuk listen yang sama
- behavior berbeda antar OS
- security/ambiguity jika salah paham

Untuk Java server/framework, biasanya diatur oleh framework.

Jangan pakai sebagai solusi semua `EADDRINUSE`.

Jika port dipakai process lain, tetap konflik.

---

## 29. `SO_REUSEPORT`

`SO_REUSEPORT` memungkinkan beberapa socket bind ke address/port sama dan kernel mendistribusikan incoming connection.

Use cases:

- multi-process server scaling
- rolling restart pattern tertentu
- load distribution di kernel

Risiko:

- distribution semantics harus dipahami
- observability lebih kompleks
- multiple server versions bisa menerima traffic
- security if unintended process binds same port

Untuk Java backend biasa, jarang perlu manual kecuali framework/runtime tertentu.

---

## 30. `SO_LINGER`

`SO_LINGER` mengubah behavior close.

Jika diset dengan timeout tertentu, close bisa block menunggu data terkirim.

Jika diset dengan linger 0, close dapat mengirim RST, bukan FIN graceful.

Ini berbahaya jika tidak dipahami.

Common consequence:

```text
peer sees connection reset
```

Rule praktis:

> Jangan set `SO_LINGER` manual kecuali benar-benar memahami TCP close semantics dan konsekuensi aplikasi.

---

## 31. Socket Buffer Options

Options:

```text
SO_SNDBUF
SO_RCVBUF
```

Mengatur send/receive buffer size.

Linux juga punya autotuning.

Sysctls terkait:

```bash
sysctl net.ipv4.tcp_rmem
sysctl net.ipv4.tcp_wmem
sysctl net.core.rmem_max
sysctl net.core.wmem_max
```

Tuning buffer berguna untuk:

- high bandwidth-delay product paths
- streaming throughput
- high-latency network
- special workloads

Tetapi untuk kebanyakan Java API service, masalah sering bukan buffer size, melainkan:

- app queue
- timeout
- connection pool
- GC
- CPU throttling
- slow dependency
- packet loss
- event loop blocking

---

## 32. Reading TCP Internals with `ss -ti`

Command:

```bash
ss -ti dst <ip>
ss -ti sport = :8080
ss -tanpi
```

Example output conceptually:

```text
ESTAB 0 0 10.0.0.5:52344 10.0.0.10:443
 cubic wscale:7,7 rto:204 rtt:3.2/0.4 ato:40 mss:1448 pmtu:1500
 cwnd:10 bytes_acked:123456 bytes_received:7890 segs_out:100 segs_in:95
 retrans:0/2
```

Fields vary by kernel.

Useful ideas:

| Field | Meaning |
|---|---|
| `rtt` | estimated round-trip time |
| `rto` | retransmission timeout |
| `cwnd` | congestion window |
| `mss` | maximum segment size |
| `pmtu` | path MTU |
| `retrans` | retransmission info |
| `bytes_acked` | bytes acknowledged |
| `bytes_received` | bytes received |

Use for clue, not single-source truth.

---

## 33. Retransmission Counters

System-wide:

```bash
nstat -az | grep -i retrans
netstat -s | grep -i retrans
```

Per socket:

```bash
ss -ti
```

Packet capture:

```bash
tcpdump -i any tcp and host <ip>
```

If retransmissions rise during latency spike:

- suspect packet loss
- congestion
- overloaded node/network
- MTU issue
- bad NIC/driver
- CNI overlay issue
- noisy neighbor
- cross-AZ/region instability

Correlate with:

- app p99
- dependency latency
- node network metrics
- retrans counters
- TCP resets
- load balancer metrics

---

## 34. MTU and Fragmentation Preview

MTU = maximum transmission unit.

If path MTU issues occur:

- large packets fail
- small packets succeed
- TLS/gRPC large response weird timeout
- connection established but data transfer stalls
- retransmissions
- blackhole behavior

This is more advanced and will be revisited in packet path section, but remember:

```text
connect success does not prove data path works for all packet sizes
```

---

## 35. Java Connection Pooling and TCP State

Connection pool state and TCP state can diverge.

Pool may think:

```text
connection idle and reusable
```

Kernel/network reality:

```text
peer closed
LB expired
NAT state gone
connection half-open
```

First reuse can fail.

Mitigations:

- idle timeout lower than infrastructure
- validation on borrow where appropriate
- keepalive/heartbeat
- max lifetime
- retry idempotent requests
- remove broken connection on error
- monitor pool stale/evict stats

---

## 36. JDBC and TCP

Database connection is usually TCP socket under the driver.

DB connection pool issue can be TCP issue.

Symptoms:

- stale connection
- connection reset
- broken pipe
- query timeout
- socket read timeout
- connect timeout
- pool exhaustion

Important:

- DB query timeout and socket read timeout differ.
- Pool acquisition timeout differs from TCP connect timeout.
- Connection lifetime must align with DB/server/LB timeout.
- Validation query/ping has cost.
- Too many DB connections overload DB.

Kernel view:

```bash
ss -tanp | grep <db-port>
```

---

## 37. HTTP Client and TCP

HTTP clients have multiple timeout types:

- DNS timeout
- connect timeout
- TLS handshake timeout
- connection pool acquisition timeout
- write timeout
- response header timeout
- read timeout
- overall call timeout
- idle timeout
- keepalive timeout

TCP only covers part of this.

Good design uses:

```text
overall deadline
+ per-stage timeout
+ pool limits
+ retry policy
+ idempotency
+ connection reuse
```

---

## 38. gRPC/HTTP2 and TCP

gRPC usually runs over HTTP/2 over TCP.

HTTP/2 multiplexes streams over one TCP connection.

Benefits:

- fewer TCP connections
- less handshake churn
- better reuse
- stream multiplexing

Risks:

- one TCP connection packet loss can affect all streams on that connection
- flow control at HTTP/2 layer and TCP layer both matter
- keepalive ping must align with LB/server policy
- too aggressive ping can be rejected
- connection-level backpressure affects many streams

This is why p99 spikes can affect many concurrent RPCs sharing one TCP connection.

---

## 39. TLS and TCP

TLS sits above TCP.

TLS impacts:

- handshake latency
- CPU usage
- record framing
- buffering
- connection reuse importance
- session resumption
- observability complexity

TCP connection established does not mean TLS handshake complete.

Timeout stages:

```text
TCP connect
TLS handshake
application request
application response
```

Different failures:

- TCP refused
- TCP timeout
- TLS alert
- certificate validation failure
- application 5xx
- idle reset

Do not collapse all into “network error”.

---

## 40. Load Balancers and TCP

Load balancers can:

- accept client TCP and open backend TCP
- proxy bytes
- terminate TLS
- enforce idle timeout
- send RST/FIN
- health check backend
- reuse backend connections
- drain connections during deploy
- have connection limits

Common issue:

```text
LB idle timeout < client pool idle timeout
```

Another:

```text
pod termination closes backend while LB still routing
```

Another:

```text
long-lived connections not drained cleanly
```

Need align:

- server keepalive timeout
- client idle timeout
- LB idle timeout
- Kubernetes termination grace
- readiness drain
- connection pool max lifetime

---

## 41. TCP Reset During Deploy

During rolling update:

1. Pod receives SIGTERM.
2. App closes server socket or accepted sockets.
3. LB/service may still send traffic briefly.
4. Existing connections may be closed abruptly.
5. Clients see reset/broken pipe.

Mitigation:

- readiness false before close
- drain in-flight
- close idle keepalive carefully
- align LB deregistration delay
- client retry idempotent requests
- graceful shutdown timeout

This connects Part 014 with TCP semantics.

---

## 42. Blackhole Connections

Blackhole means packets disappear silently.

Examples:

- firewall drops
- route issue
- security group drop
- broken overlay network
- peer gone without RST/FIN
- MTU blackhole

Symptoms:

- connect timeout
- read timeout
- SYN-SENT
- retransmissions
- no RST
- long wait if app timeout missing

Debug:

```bash
ss -tan state syn-sent
tcpdump -i any host <ip>
ip route get <ip>
```

Application must have explicit timeouts.

---

## 43. TCP User Timeout

Linux has `TCP_USER_TIMEOUT`, which controls how long transmitted data may remain unacknowledged before TCP closes connection.

This can be useful for some low-latency systems.

But:

- not always exposed by high-level Java APIs
- library/native transport may expose
- must be tuned carefully
- not a replacement for application deadline

For most Java service, first fix:

- connect timeout
- read/write timeout
- overall deadline
- connection pool config
- keepalive/heartbeat
- retry/backoff

---

## 44. Observability: Mapping Java Exception to TCP Hypothesis

### `Connection refused`

Hypothesis:

- no listener
- wrong port/address
- service down
- firewall reject
- bind localhost only
- pod not ready/endpoint stale

Commands:

```bash
ss -ltnp
nc -vz host port
```

### `Connection timed out`

Hypothesis:

- packet drop
- route/firewall blackhole
- SYN retransmit
- remote unreachable
- overloaded network

Commands:

```bash
ss -tan state syn-sent
tcpdump
ip route get
```

### `Connection reset`

Hypothesis:

- peer closed abruptly
- stale pooled connection
- LB idle timeout
- server restart
- protocol error
- RST from middlebox

Commands:

```bash
ss -tan
tcpdump 'tcp[tcpflags] & tcp-rst != 0'
check peer/LB logs
```

### `Broken pipe`

Hypothesis:

- local wrote after peer closed
- peer reset
- stale connection
- slow close race

### `Read timed out`

Hypothesis:

- request reached peer but response not received in time
- peer app slow
- network loss/retrans
- flow control
- response queued
- application timeout too low/high

---

## 45. Production Triage: TCP Latency Spike

When latency spikes:

```text
Step 1: Is it connect latency, request latency, read latency, or pool wait?
Step 2: Are retransmissions increasing?
Step 3: Are resets increasing?
Step 4: Are socket queues growing?
Step 5: Are many sockets in SYN-SENT/CLOSE_WAIT/TIME_WAIT?
Step 6: Is CPU throttling/event loop lag present?
Step 7: Is LB idle timeout/deploy involved?
Step 8: Is connection pool reusing stale connections?
```

Commands:

```bash
ss -s
ss -tanp
ss -ti
nstat -az | grep -i retrans
nstat -az | grep -i reset
cat /sys/fs/cgroup/cpu.stat
jcmd <pid> Thread.print
```

Metrics:

- connect duration
- TLS handshake duration
- pool acquisition wait
- request write duration
- time to first byte
- response read duration
- retry count
- reset/refused/timeout count
- connection pool active/idle
- TCP retransmission
- event loop lag

---

## 46. Lab 1 — Observe TCP Handshake

Terminal 1:

```bash
python3 -m http.server 8080
```

Terminal 2:

```bash
tcpdump -i lo tcp port 8080
```

Terminal 3:

```bash
curl http://127.0.0.1:8080/
```

Observe:

- SYN
- SYN-ACK
- ACK
- HTTP data
- FIN/ACK

If `tcpdump` unavailable or permission denied, use:

```bash
ss -tanp | grep :8080
```

during connection.

---

## 47. Lab 2 — ECONNREFUSED vs Timeout

Refused:

```bash
time nc -vz 127.0.0.1 65534
```

Usually fast.

Timeout requires a blackhole IP/environment. Example may vary:

```bash
time nc -vz -w 3 10.255.255.1 81
```

Do not assume this IP blackholes in every network.

Observe difference:

```text
refused = fast
timeout = waits
```

---

## 48. Lab 3 — TIME_WAIT

Make many short connections:

```bash
for i in $(seq 1 100); do
  curl -s http://127.0.0.1:8080/ > /dev/null
done
```

Check:

```bash
ss -tan state time-wait | wc -l
```

Observe TIME_WAIT growth.

Then compare with HTTP keep-alive/client reuse using a proper client if available.

---

## 49. Lab 4 — CLOSE_WAIT Demonstration Concept

CLOSE_WAIT requires local app not closing after remote close.

A toy program can intentionally hold socket open after EOF.

Concept:

```java
Socket s = server.accept();
InputStream in = s.getInputStream();

while (in.read() != -1) {
    // read until remote closes
}

// Intentionally do not close s
Thread.sleep(Long.MAX_VALUE);
```

Remote connects then closes.

Check:

```bash
ss -tanp state close-wait
```

Lesson:

```text
CLOSE_WAIT usually means local application close bug.
```

Do only in lab.

---

## 50. Lab 5 — Inspect TCP Details with ss

Open a connection:

```bash
curl http://example.com/
```

For long-lived local connection, use a server/client that stays open.

Inspect:

```bash
ss -ti
ss -tanpi
```

Look for:

- rtt
- rto
- cwnd
- retrans
- bytes_acked
- state

This builds habit of reading TCP as stateful system, not black box.

---

## 51. Failure Mode 1 — Stale Connection in Pool

### Gejala

- First request after idle fails.
- Retry succeeds.
- Error: connection reset/broken pipe.
- Happens every few minutes.
- Load balancer idle timeout known.

### Penyebab

- Client pool keeps idle connection longer than LB/server.
- LB closes idle connection.
- Client reuses stale socket.

### Evidence

- Errors after idle duration.
- LB idle timeout < client idle timeout.
- TCP RST packet if captured.
- Pool logs show reuse.

### Fix

- Set client idle timeout lower than LB.
- Enable validation/health check where appropriate.
- Set max connection lifetime.
- Retry idempotent requests.
- Align keepalive policy.

---

## 52. Failure Mode 2 — Packet Loss Causes p99 Spike

### Gejala

- p50 fine.
- p99/p999 bad.
- Retransmission counters rise.
- No CPU/GC issue.
- Dependency sometimes slow from network view.

### Penyebab

- packet loss
- congestion
- bad node/network path
- CNI overlay issue
- overloaded NIC/queue
- cross-zone instability

### Evidence

```bash
ss -ti
nstat -az | grep -i retrans
tcpdump
node network metrics
```

### Fix

- investigate node/network/CNI
- avoid problematic path/node
- reduce burst
- tune retry/backoff
- increase timeout if appropriate but do not mask persistent loss
- coordinate with platform/network team

---

## 53. Failure Mode 3 — Many CLOSE_WAIT

### Gejala

- FD count grows.
- Many `CLOSE_WAIT`.
- Eventually `Too many open files`.
- Remote peer closed normally.

### Penyebab

- local app not closing socket after EOF/error.
- response body not closed.
- client library misuse.
- exception path leaks stream.
- stuck request handler.

### Evidence

```bash
ss -tanp state close-wait
lsof -p <pid>
jcmd <pid> Thread.print
```

### Fix

- close resources in finally/try-with-resources.
- close HTTP response body.
- configure pool eviction.
- fix stuck handler.
- add FD/socket state alert.

---

## 54. Failure Mode 4 — TIME_WAIT/Ephemeral Port Exhaustion

### Gejala

- outbound connect fails.
- `Cannot assign requested address`.
- many TIME_WAIT.
- no connection reuse.
- traffic spike/retry storm.

### Penyebab

- new TCP connection per request.
- high QPS to same destination.
- source port range exhausted.
- short-lived connections.
- NAT bottleneck.

### Evidence

```bash
cat /proc/sys/net/ipv4/ip_local_port_range
ss -tan state time-wait | wc -l
ss -tan | awk '{print $1}' | sort | uniq -c
```

### Fix

- connection pooling.
- keep-alive.
- HTTP/2 multiplexing.
- reduce retry storm.
- scale clients/source IPs.
- tune port range only with understanding.

---

## 55. Failure Mode 5 — Nagle/Delayed ACK Small Message Latency

### Gejala

- Small request/response protocol has strange 40ms/200ms delays.
- Low throughput but latency spikes.
- Tiny writes.
- TCP_NODELAY disabled.

### Penyebab

- Nagle waits for ACK.
- Receiver delays ACK.
- Small writes not batched.

### Evidence

- packet capture.
- application writes tiny chunks.
- improvement with TCP_NODELAY or batching.

### Fix

- enable TCP_NODELAY for latency-sensitive small messages.
- write complete frame at once.
- reduce tiny writes.
- validate with packet capture/benchmark.

---

## 56. Failure Mode 6 — Slow Receiver / Zero Window

### Gejala

- Sender write blocks or send queue grows.
- Receiver app CPU high or blocked.
- `ss` shows send queue.
- tcpdump may show zero window.

### Penyebab

- receiver not reading fast enough.
- receiver receive buffer full.
- receiver app overloaded.
- downstream backpressure.

### Evidence

```bash
ss -tanp
ss -ti
tcpdump
receiver app metrics
```

### Fix

- fix receiver processing bottleneck.
- add application backpressure.
- limit response size.
- tune buffers only if appropriate.
- close slow clients where acceptable.

---

## 57. Design Checklist: TCP-Aware Java Client

```text
[ ] Connect timeout explicit.
[ ] Read/response timeout explicit.
[ ] Overall deadline exists.
[ ] Pool acquisition timeout explicit.
[ ] Connection pool max size bounded.
[ ] Idle timeout aligned with LB/server.
[ ] Max connection lifetime set if infrastructure rotates.
[ ] Retry only for retryable/idempotent operations.
[ ] Retry uses backoff + jitter + deadline.
[ ] Response body always consumed/closed.
[ ] Metrics separate connect, pool wait, TLS, TTFB, read.
[ ] Stale connection handling tested.
[ ] HTTP/2 multiplexing behavior understood if used.
```

---

## 58. Design Checklist: TCP-Aware Java Server

```text
[ ] Bind address deliberate.
[ ] Backlog configured consciously.
[ ] FD limit sized.
[ ] Accepted sockets closed on all paths.
[ ] Keepalive/idle timeout aligned with LB/client.
[ ] Slow clients handled.
[ ] Write buffer bounded.
[ ] Event loop not blocked.
[ ] TCP_NODELAY decision deliberate.
[ ] Graceful shutdown drains connections.
[ ] Connection reset during deploy measured.
[ ] Metrics include active connections, socket errors, queue, event loop lag.
```

---

## 59. Common Misinterpretations

### Misinterpretation 1

```text
TCP is reliable, so it cannot cause latency.
```

Correction:

```text
Reliability is achieved with retransmission, ordering, and flow control. These can add latency.
```

### Misinterpretation 2

```text
ACK means remote application processed my request.
```

Correction:

```text
ACK means remote TCP stack received bytes. Application may not have read or processed them.
```

### Misinterpretation 3

```text
TIME_WAIT is always bad.
```

Correction:

```text
TIME_WAIT is normal TCP correctness behavior. It becomes a problem mainly with connection churn/resource exhaustion.
```

### Misinterpretation 4

```text
CLOSE_WAIT can be fixed by kernel tuning.
```

Correction:

```text
Many CLOSE_WAIT sockets usually mean local application did not close sockets.
```

### Misinterpretation 5

```text
TCP keepalive is enough for request timeout.
```

Correction:

```text
TCP keepalive is idle dead-peer detection, often slow. Request deadlines/read timeouts are still needed.
```

### Misinterpretation 6

```text
Connection reset always means network is broken.
```

Correction:

```text
RST can come from peer app, load balancer, stale pool reuse, abortive close, protocol mismatch, or deployment.
```

---

## 60. Invariant yang Harus Diingat

1. TCP is a reliable ordered byte stream, not a message protocol.
2. Application protocol must define framing.
3. Three-way handshake establishes connection state before data exchange.
4. ACK means bytes reached TCP receiver, not application processing.
5. Flow control protects receiver buffer.
6. Congestion control protects network path.
7. Application backpressure protects service capacity.
8. Packet loss becomes latency via retransmission.
9. FIN is graceful close.
10. RST is abrupt reset.
11. Half-open connections may not be detected until traffic/keepalive.
12. TCP keepalive is not HTTP keep-alive.
13. TCP keepalive is not request deadline.
14. Idle timeout mismatch causes stale pooled connection failures.
15. TIME_WAIT is normal.
16. Many CLOSE_WAIT usually means local application close leak.
17. Nagle reduces tiny packets but can add latency.
18. TCP_NODELAY can help small-message latency but does not fix bad batching.
19. `write()` success does not mean remote processed data.
20. Connection pooling reduces churn but must be bounded and aligned with infrastructure.
21. Load balancers are active participants in TCP lifecycle.
22. TCP metrics must be correlated with application metrics.

---

## 61. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa request bisa timeout walaupun TCP adalah reliable protocol?

Jawaban:

- TCP reliability uses retransmission and ordering.
- Packet loss/retransmission adds delay.
- TCP may wait longer than application deadline.
- Reliable delivery does not guarantee bounded latency.
- Application needs explicit timeout/deadline.

### Q2

Apa bedanya FIN dan RST?

Jawaban:

- FIN adalah graceful half-close: peer selesai mengirim.
- RST adalah abrupt reset: connection aborted/invalid.
- FIN biasanya terlihat sebagai EOF.
- RST biasanya terlihat sebagai connection reset/broken pipe.

### Q3

Kenapa banyak CLOSE_WAIT sering dianggap bug aplikasi lokal?

Jawaban:

- CLOSE_WAIT berarti remote sudah close.
- Local app sudah diberi EOF/error.
- Local app belum close socket.
- Jadi resource tertahan di sisi lokal.

### Q4

Kenapa stale pooled connection sering gagal pada request pertama setelah idle?

Jawaban:

- Infrastruktur seperti LB/server menutup idle connection.
- Client pool masih menyimpan socket.
- Saat dipakai ulang, socket sudah tidak valid.
- Client melihat reset/broken pipe.
- Fix dengan idle timeout alignment/validation/retry idempotent.

### Q5

Kenapa ACK bukan bukti remote application telah memproses request?

Jawaban:

- ACK berasal dari TCP stack.
- Data bisa masih di receive buffer kernel.
- Application remote mungkin belum read.
- Application-level response/ack diperlukan untuk semantic processing.

### Q6

Kapan TCP_NODELAY berguna?

Jawaban:

- Low-latency small-message protocols.
- RPC/request-response kecil.
- Menghindari Nagle/delayed ACK interaction.
- Tetap perlu batching frame dengan benar agar tidak mengirim tiny writes berlebihan.

---

## 62. Ringkasan

TCP adalah fondasi hampir semua komunikasi backend, tetapi ia bukan sekadar “koneksi berhasil/gagal”.

TCP adalah stateful protocol dengan:

- handshake
- sequence numbers
- ACK
- send/receive buffer
- flow control
- congestion control
- retransmission
- close semantics
- keepalive
- TIME_WAIT/CLOSE_WAIT
- socket options

Untuk Java backend engineer, skill pentingnya adalah menerjemahkan gejala aplikasi ke hipotesis TCP:

```text
Connection refused -> no listener/reject
Connect timeout    -> drop/blackhole/SYN issue
Connection reset   -> RST from peer/middlebox/stale socket
Broken pipe        -> write after peer closed/reset
Read timeout       -> app/network/flow/retransmission delay
CLOSE_WAIT         -> local close leak
TIME_WAIT          -> connection churn/normal close behavior
Retransmission     -> packet loss/congestion/tail latency
```

Mental model utama:

```text
TCP is reliable but not latency-bounded.
TCP is byte stream, not message stream.
TCP ACK is transport-level, not business-level.
Connection pools are application objects over kernel TCP state.
Infrastructure timeouts must be aligned with client/server pools.
```

---

## 63. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `tcp(7)`  
   `https://man7.org/linux/man-pages/man7/tcp.7.html`

2. Linux man-pages — `socket(7)`  
   `https://man7.org/linux/man-pages/man7/socket.7.html`

3. Linux man-pages — `connect(2)`  
   `https://man7.org/linux/man-pages/man2/connect.2.html`

4. Linux man-pages — `send(2)`  
   `https://man7.org/linux/man-pages/man2/send.2.html`

5. Linux man-pages — `recv(2)`  
   `https://man7.org/linux/man-pages/man2/recv.2.html`

6. Linux man-pages — `setsockopt(2)`  
   `https://man7.org/linux/man-pages/man2/setsockopt.2.html`

7. Linux Kernel Documentation — networking  
   `https://docs.kernel.org/networking/`

8. RFC 9293 — Transmission Control Protocol (TCP)  
   `https://www.rfc-editor.org/rfc/rfc9293`

9. RFC 5681 — TCP Congestion Control  
   `https://www.rfc-editor.org/rfc/rfc5681`

10. Java Platform Documentation — `java.net.Socket`, `java.nio.channels.SocketChannel`  
   `https://docs.oracle.com/en/java/javase/`

11. Netty Documentation — transport and channel options  
   `https://netty.io/wiki/`

---

## 64. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 017 — Network Stack II: TCP Internals for Backend Engineers
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-018.md
Part 018 — Network Stack III: epoll, Event Loops, and High-Concurrency Servers
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Network Stack I: From Socket API to Kernel</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-018.md">Part 018 — Network Stack III: epoll, Event Loops, and High-Concurrency Servers ➡️</a>
</div>
