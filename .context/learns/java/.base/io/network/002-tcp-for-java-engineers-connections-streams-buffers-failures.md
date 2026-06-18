# Part 2 — TCP for Java Engineers: Connections, Streams, Buffers, and Failure Semantics

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `002-tcp-for-java-engineers-connections-streams-buffers-failures.md`  
Scope: Java 8–25, production network engineering, HTTP/gRPC foundations

---

## 1. Why This Part Exists

Most Java backend engineers meet TCP indirectly.

They do not usually write raw `Socket` code every day. They use:

- `java.net.http.HttpClient`
- Apache HttpClient
- OkHttp
- Netty
- Spring `RestTemplate`, `WebClient`, `RestClient`
- gRPC Java
- JDBC drivers
- Redis clients
- RabbitMQ/Kafka clients
- Elasticsearch/OpenSearch clients
- service mesh sidecars

But under many of those stacks sits the same core abstraction:

```text
A long-lived bidirectional byte stream between two endpoints.
```

When that stream behaves well, the application looks simple.

When it behaves badly, the application sees symptoms like:

```text
java.net.SocketTimeoutException: Read timed out
java.net.ConnectException: Connection refused
java.net.ConnectException: Connection timed out
java.net.SocketException: Connection reset
java.net.SocketException: Broken pipe
java.net.NoRouteToHostException
java.net.BindException: Address already in use
java.net.BindException: Cannot assign requested address
javax.net.ssl.SSLException: Connection reset
io.grpc.StatusRuntimeException: UNAVAILABLE
io.grpc.StatusRuntimeException: DEADLINE_EXCEEDED
HTTP 502 / 503 / 504 from gateway
```

A top-tier engineer does not treat these as random errors. They ask:

```text
Which phase of the connection lifecycle failed?
Was this before connect, during TLS, during write, while waiting for response, during read, or during close?
Is this a local resource issue, remote dependency issue, middlebox issue, or protocol misuse?
Is it safe to retry?
Will retry make things better or worse?
Which metric would prove the hypothesis?
```

This part builds the TCP mental model needed before going deeper into HTTP, gRPC, Netty, streaming, backpressure, and production failure modelling.

---

## 2. What This Part Will Not Repeat

This part assumes you already understand basic Java I/O and NIO concepts:

- `InputStream` / `OutputStream`
- `Reader` / `Writer`
- `Socket` / `ServerSocket`
- `SocketChannel`
- `Selector`
- blocking vs non-blocking I/O
- byte buffers
- basic client/server socket examples

We will not spend time on toy echo servers.

Instead, this part explains what those abstractions mean under production load.

---

## 3. TCP in One Sentence

TCP gives each side the illusion of a reliable ordered byte stream, built on top of unreliable packets.

That sentence hides many important consequences:

1. TCP is not message-based.
2. TCP does not know HTTP, JSON, gRPC, Protobuf, or business requests.
3. TCP can split one application write into many packets.
4. TCP can merge many application writes into fewer packets.
5. TCP can deliver bytes slowly even when the connection is alive.
6. TCP can be alive from the OS point of view but useless from the application point of view.
7. TCP reliability is not the same as application-level success.
8. TCP ordering can create head-of-line blocking.
9. TCP backpressure eventually becomes application backpressure if buffers fill.
10. TCP close semantics are more subtle than “connection closed”.

The most important correction is this:

```text
TCP does not transport requests.
TCP transports bytes.
Your protocol defines where requests begin and end.
```

HTTP/1.1, HTTP/2, WebSocket, gRPC, PostgreSQL wire protocol, Redis RESP, AMQP, and custom protocols all sit above TCP and define their own framing.

---

## 4. The Core Mental Model

A TCP connection is not just a pipe. It is state on both sides and in the network path.

```text
Client process
  JVM object
  file descriptor
  local socket buffer
  local IP:ephemeral_port
        |
        | packets
        v
  network path
  NAT / firewall / load balancer / proxy / service mesh
        |
        v
Server process
  listening socket
  accepted socket
  file descriptor
  receive/send buffers
  remote IP:port view
```

A single connection has identity:

```text
source IP
source port
destination IP
destination port
protocol = TCP
```

This is often called the 5-tuple:

```text
(src_ip, src_port, dst_ip, dst_port, protocol)
```

For outbound Java clients, the destination port is usually stable:

```text
443 for HTTPS
80 for HTTP
5432 for PostgreSQL
1521 for Oracle
6379 for Redis
5672 for RabbitMQ
```

But the local source port is usually an ephemeral port chosen by the OS.

That matters because high-churn clients can run out of ephemeral ports or accumulate many connections in `TIME_WAIT`.

---

## 5. TCP Lifecycle at Production Level

A simplified TCP lifecycle:

```text
1. DNS resolution, if connecting by name
2. Local ephemeral port allocation
3. SYN sent
4. SYN-ACK received
5. ACK sent
6. Connection established
7. Optional TLS handshake above TCP
8. Application writes bytes
9. Peer reads bytes
10. Peer writes response bytes
11. Application reads response bytes
12. One side initiates close
13. FIN/ACK or RST sequence
14. Socket eventually disappears from active table
```

From Java, these phases are often collapsed into a few calls:

```java
Socket socket = new Socket();
socket.connect(new InetSocketAddress(host, port), connectTimeoutMs);
socket.getOutputStream().write(bytes);
int n = socket.getInputStream().read(buffer);
socket.close();
```

But operationally, each phase can fail differently.

| Phase | Common failure | Java symptom | Typical cause |
|---|---:|---|---|
| DNS | name cannot resolve | `UnknownHostException` | bad DNS, stale resolver, CoreDNS issue |
| Local bind | no local port | `BindException` | ephemeral port exhaustion |
| Connect SYN | no response | `ConnectException`, timeout | firewall drop, route issue, remote down |
| Connect SYN-ACK | refused | `Connection refused` | no listener, rejected by host |
| TLS handshake | cert/protocol issue | `SSLHandshakeException` | truststore, cert, SNI, ALPN |
| Write | peer closed/reset | `Broken pipe`, `Connection reset` | stale pooled connection, remote restart |
| Read | no bytes before timeout | `SocketTimeoutException` | slow server, network stall, bad timeout |
| Close | active close tracking | `TIME_WAIT` | normal TCP close state |

A good incident analysis identifies the failed phase first.

---

## 6. TCP Is a Stream, Not a Message Queue

This is one of the most important ideas in the whole series.

Suppose Java writes this:

```java
out.write("HELLO".getBytes(StandardCharsets.UTF_8));
out.write("WORLD".getBytes(StandardCharsets.UTF_8));
```

The peer is not guaranteed to receive two separate reads:

```text
read 1: HELLO
read 2: WORLD
```

It may receive:

```text
read 1: H
read 2: ELLOWORLD
```

or:

```text
read 1: HELLOWORLD
```

or:

```text
read 1: HE
read 2: LLO
read 3: WOR
read 4: LD
```

TCP preserves byte order, not application write boundaries.

Therefore every protocol above TCP needs framing.

Examples:

```text
HTTP/1.1:
  headers end with CRLF CRLF
  body length from Content-Length or chunked encoding

HTTP/2:
  binary frames with length and type

gRPC:
  HTTP/2 stream + gRPC message framing + Protobuf payload

Redis RESP:
  explicit type markers and lengths

Custom binary protocol:
  usually magic/version/type/length/body/checksum
```

If an engineer forgets this, they create fragile protocols that pass tests locally and fail under real network behavior.

---

## 7. The Java Read Contract

A common beginner mistake is assuming this:

```java
int n = in.read(buffer);
```

means:

```text
Read a complete message.
```

It does not.

It means approximately:

```text
Read up to buffer.length bytes, blocking until at least one byte is available, EOF occurs, or an exception/timeout happens.
```

Important cases:

```text
n > 0   some bytes were read
n == -1 peer performed orderly shutdown and EOF is reached
exception timeout/reset/other failure
```

For protocol design, this means you usually need a loop:

```java
static byte[] readExactly(InputStream in, int length) throws IOException {
    byte[] result = new byte[length];
    int offset = 0;
    while (offset < length) {
        int n = in.read(result, offset, length - offset);
        if (n == -1) {
            throw new EOFException("connection closed before reading full message");
        }
        offset += n;
    }
    return result;
}
```

This is why frameworks exist: getting this correct under timeouts, cancellation, compression, TLS, pooling, and backpressure is hard.

---

## 8. The Java Write Contract

For classic blocking `OutputStream`, `write(byte[])` attempts to write all bytes or fail. But that does not mean the remote application has received or processed the request.

A successful write usually means:

```text
The bytes were accepted into some local/runtime/kernel/network buffer.
```

It does not guarantee:

```text
remote application read the bytes
remote application understood the request
remote application committed the operation
remote response will arrive
operation is safe from duplication
```

This matters for retry.

Consider a payment-like operation:

```text
client writes request body
server receives request
server commits transaction
server crashes before response
client read times out
```

From the client view:

```text
read timeout
```

From the server view:

```text
operation succeeded
```

If the client blindly retries without idempotency protection, it may duplicate the operation.

This is why TCP reliability is not enough. Application protocols need idempotency keys, correlation ids, business operation ids, and safe retry semantics.

---

## 9. FIN, RST, EOF, and Why “Connection Closed” Is Ambiguous

TCP has multiple ways a connection can end.

### 9.1 Orderly close with FIN

One side says:

```text
I am done sending bytes.
```

This is an orderly close. The other side may still send bytes for a while depending on protocol and socket behavior.

In Java input stream terms, an orderly remote close eventually appears as:

```java
int n = in.read(buffer);
// n == -1
```

### 9.2 Abrupt close with RST

RST means the connection is reset. This is more abrupt.

In Java it may appear as:

```text
java.net.SocketException: Connection reset
```

or sometimes during write:

```text
java.net.SocketException: Broken pipe
```

Common reasons:

- remote process crashed
- remote process closed socket with unread data
- load balancer reset idle connection
- firewall/NAT state disappeared
- protocol violation
- client reused a stale pooled connection
- server rejected traffic abruptly

### 9.3 EOF is not always an error

For some protocols, EOF means normal response end.

For others, EOF means incomplete message.

Example:

```text
HTTP/1.0 without Content-Length:
  EOF may mark response body end

Length-prefixed binary protocol:
  EOF before full length is protocol failure
```

Therefore Java cannot decide if EOF is business-successful. The protocol layer decides.

---

## 10. Half-Open Connections

A half-open connection occurs when one side believes the connection is alive, while the other side is gone or unreachable.

This can happen when:

- host crashes without sending FIN/RST
- NAT/firewall drops idle state
- network partition occurs
- container/pod is killed abruptly
- load balancer silently expires idle connection
- mobile/client network changes

From Java, the socket may look fine until you try to read or write.

This explains a common production pattern:

```text
Application has a connection pool.
Connection has been idle for 20 minutes.
Load balancer idle timeout is 10 minutes.
Pool reuses the connection.
First request fails with connection reset.
Second retry on fresh connection succeeds.
```

The bug is not necessarily the remote service. It can be idle timeout mismatch between client pool and middlebox.

Production lesson:

```text
Client idle connection lifetime should usually be shorter than the shortest middlebox idle timeout in the path.
```

---

## 11. TIME_WAIT, CLOSE_WAIT, FIN_WAIT, and What They Tell You

TCP state is diagnostic gold.

Useful states:

| State | Meaning | Typical interpretation |
|---|---|---|
| `ESTABLISHED` | active connection | normal if bounded |
| `SYN_SENT` | trying to connect | high count suggests connect delay/drop |
| `SYN_RECV` | server received SYN | backlog or handshake pressure |
| `TIME_WAIT` | recently closed connection retained | normal, but high churn can exhaust ports |
| `CLOSE_WAIT` | peer closed, local app has not closed | often application/resource leak |
| `FIN_WAIT1/2` | local close in progress | can indicate stuck close path |
| `LAST_ACK` | waiting final ACK | close completion state |

### 11.1 TIME_WAIT

`TIME_WAIT` is not automatically bad. It is part of normal TCP close behavior.

It exists so late packets from an old connection do not get confused with a future connection using the same 5-tuple.

But `TIME_WAIT` becomes operationally relevant when a service rapidly opens and closes many outbound connections.

Symptoms:

```text
Cannot assign requested address
Address already in use
connect failures under high request rate
large TIME_WAIT count
low connection reuse
```

Usually the fix is not “kill TIME_WAIT”. Better fixes:

```text
reuse connections via pooling
reduce connection churn
increase ephemeral port range when appropriate
scale client source IPs/nodes
align keep-alive and idle timeout
avoid per-request new client construction
```

### 11.2 CLOSE_WAIT

`CLOSE_WAIT` often means the remote side closed, but the local application has not closed its socket.

High or growing `CLOSE_WAIT` is suspicious.

It commonly indicates:

```text
application did not close response body
stream not closed
connection leak
thread stuck before cleanup
bug in protocol handling
```

In Java HTTP clients, this can happen when code fails to consume/close response streams, depending on client implementation.

---

## 12. Ephemeral Ports: The Hidden Limit of Outbound Clients

When Java connects outbound to a remote server, the local OS chooses a source port from the ephemeral port range.

Example:

```text
local: 10.0.2.15:49152
remote: 10.0.8.20:443
```

Each simultaneous connection to the same destination needs a unique local source port.

If an application creates too many short-lived connections, ephemeral ports can become the bottleneck.

### 12.1 Failure shape

You may see:

```text
java.net.BindException: Cannot assign requested address
java.net.BindException: Address already in use
connect failures despite remote being healthy
many TIME_WAIT sockets
```

### 12.2 Common causes

```text
creating new HTTP client per request
connection pooling disabled
server closes connections aggressively
client closes after every call
load test with unrealistic connection churn
very high fan-out to same destination
NAT gateway port exhaustion
container/node with limited source port capacity
```

### 12.3 Correct mental model

Throughput is not only limited by CPU and threads.

It is also limited by:

```text
available connections
available ephemeral ports
connection lifetime
TIME_WAIT duration
remote max connections
NAT/firewall/load balancer state tables
```

A top-tier engineer asks:

```text
How many new connections per second are we creating?
How many connections are reused?
How long do connections stay idle?
How many are in TIME_WAIT?
Is the bottleneck inside the JVM, kernel, NAT, LB, or remote server?
```

---

## 13. Socket Buffers and Backpressure

TCP has send and receive buffers.

Simplified path:

```text
Java writes bytes
  -> JVM/native socket call
  -> kernel send buffer
  -> TCP packets
  -> network
  -> peer kernel receive buffer
  -> peer application reads bytes
```

If the peer application reads slowly, the peer receive buffer fills.

Then TCP advertises a smaller receive window.

Eventually the sender slows down.

If the sender keeps writing, its own send buffer fills.

Then Java write may block or async writes may queue.

This is backpressure.

### 13.1 Important implication

Backpressure is not optional. It happens somewhere.

Either it is explicit and controlled:

```text
bounded queue
rate limiter
stream demand
flow control
semaphore
connection limit
```

Or it is implicit and dangerous:

```text
unbounded memory growth
thread pileup
socket buffer pressure
GC pressure
event loop queue growth
latency explosion
connection reset
```

### 13.2 Java-specific symptoms

```text
blocked writer threads
Netty outbound buffer growth
high direct memory usage
large pending write queue
high p99 latency
client read timeout
server slow consumer logs
gRPC stream stalls
HTTP response streaming hangs
```

---

## 14. Nagle, Delayed ACK, and TCP_NODELAY

TCP tries to balance latency and network efficiency.

Nagle's algorithm can coalesce small writes to reduce tiny packets.

Delayed ACK can wait briefly before acknowledging, hoping to piggyback ACKs with outgoing data.

Together, they can sometimes increase latency for request/response protocols with small messages.

Java exposes `TCP_NODELAY`, usually through socket options.

Conceptually:

```text
TCP_NODELAY = true
  disable Nagle
  send small packets more immediately
  lower latency for small interactive messages
  potentially more packets

TCP_NODELAY = false
  allow coalescing
  potentially better network efficiency
  can add latency for small writes
```

For many RPC/HTTP stacks, low-latency configurations often enable `TCP_NODELAY`, but the correct choice depends on workload and framework defaults.

Important warning:

```text
TCP_NODELAY is not a magic performance switch.
```

If the real issue is remote slowness, oversized payload, connection pool saturation, TLS handshake churn, or GC pressure, `TCP_NODELAY` will not fix it.

---

## 15. TCP Keepalive vs Application Keepalive vs HTTP/gRPC Keepalive

The word “keepalive” is overloaded.

### 15.1 TCP keepalive

TCP keepalive is an OS-level mechanism to detect dead idle connections.

In Java socket options, `SO_KEEPALIVE` enables TCP keepalive behavior, but exact semantics are system dependent.

Problems:

```text
default OS keepalive intervals may be very long
not designed as fast application health checking
may not align with load balancer idle timeout
behavior varies by OS and environment
```

### 15.2 HTTP keep-alive

HTTP keep-alive usually means connection reuse across multiple requests.

It is about efficiency:

```text
avoid repeated TCP/TLS setup
reduce latency
reduce CPU
reduce ephemeral port churn
```

### 15.3 HTTP/2 or gRPC keepalive

gRPC uses HTTP/2 PING-based keepalive to keep a connection alive or detect broken connections. But aggressive client keepalive can be harmful and may be rejected by servers or gateways.

### 15.4 Application heartbeat

Application heartbeat is part of business/protocol logic.

Example:

```text
WebSocket ping/pong
custom protocol heartbeat
stream keepalive message
consumer session heartbeat
```

### 15.5 Mental model

Do not say “enable keepalive” without specifying the layer.

Ask:

```text
Do we need connection reuse?
Do we need dead peer detection?
Do we need middlebox idle prevention?
Do we need business session liveness?
Do we need stream-level heartbeat?
Which timeout are we trying to beat?
```

---

## 16. Connection Refused vs Connection Timed Out

These two errors mean very different things.

### 16.1 Connection refused

Usually means:

```text
SYN reached the destination host
host replied that no process is listening or connection is rejected
```

Possible causes:

```text
service down
wrong port
pod/container not ready
security rule actively rejects
listener bound only to localhost
server backlog behavior depending on system
```

### 16.2 Connection timed out

Usually means:

```text
client sent SYN but did not receive usable response before timeout
```

Possible causes:

```text
firewall drop
route problem
security group drop
network ACL drop
remote host unreachable
packet loss
load balancer blackhole
DNS points to dead IP
```

### 16.3 Operational difference

Refused is often a fast negative signal.

Timeout consumes time budget and threads/connections while waiting.

In high-volume clients, connect timeout must be bounded aggressively enough to avoid resource pileup.

---

## 17. Read Timeout vs Request Timeout vs Deadline

A read timeout is not the same as an end-to-end deadline.

### 17.1 Read timeout

Usually means:

```text
No bytes were read within configured socket read timeout.
```

But a long response that sends one byte periodically may avoid read timeout while still violating business latency.

### 17.2 Request timeout

Means:

```text
The whole HTTP/RPC operation must complete within a maximum duration.
```

### 17.3 Deadline

Means:

```text
The operation has an absolute time budget that should propagate downstream.
```

Example:

```text
User request budget: 2 seconds
Service A spends 300 ms
Service A calls Service B with remaining ~1.7 seconds
Service B calls DB with remaining ~1.2 seconds
```

A top-tier network engineer prefers deadline thinking over isolated timeout thinking.

---

## 18. Why Connection Reuse Matters

Creating a new secure connection is expensive.

For HTTPS:

```text
DNS resolution
TCP handshake
TLS handshake
HTTP request write
server processing
response read
```

Connection reuse avoids repeated setup cost.

Benefits:

```text
lower latency
less CPU from TLS handshakes
less ephemeral port churn
fewer TIME_WAIT sockets
less load on load balancer/firewall/NAT
better throughput under steady traffic
```

But connection reuse also creates statefulness:

```text
stale idle connections
load imbalance
long-lived connection to bad backend
connection pool saturation
interaction with DNS changes
interaction with deployment rolling restart
```

Therefore connection pooling must be managed as a production subsystem, not a hidden library detail.

---

## 19. Stale Pooled Connections

A stale connection is a connection that the client pool thinks is reusable but the network/remote side has already closed or invalidated.

Common scenario:

```text
Client pool idle timeout: 30 minutes
Load balancer idle timeout: 5 minutes
Connection idle for 10 minutes
Client reuses connection
LB has already dropped it
First write/read fails
```

Mitigations:

```text
client idle timeout shorter than LB idle timeout
connection validation where supported
retry once for safe idempotent operation
pool eviction
HTTP/2/gRPC keepalive carefully configured
server graceful shutdown settings
```

Do not blindly retry all operations.

Retry safety depends on application semantics.

---

## 20. Server Backlog and Accept Queue

On the server side, incoming connections wait in kernel queues before the application accepts them.

Simplified:

```text
SYN queue
accept queue
application accept()
worker/event loop handles connection
```

If the server is overloaded and cannot accept fast enough, clients may see:

```text
connect timeout
connection refused
connection reset
high SYN backlog
high accept queue pressure
```

Java server frameworks hide this, but the behavior still exists.

Relevant causes:

```text
server CPU saturated
event loop blocked
acceptor thread stuck
process max file descriptors reached
container CPU throttling
TLS handshake overload
load balancer surge
```

Good server engineering includes:

```text
bounded accept and worker capacity
load shedding
graceful degradation
connection limits
TLS offload or tuning
readiness checks that reflect actual capacity
```

---

## 21. File Descriptors: Every Socket Is an OS Resource

Each TCP socket uses a file descriptor.

If a Java process opens too many sockets, files, pipes, or event handles, it can hit OS limits.

Symptoms:

```text
java.io.IOException: Too many open files
failed to accept connection
failed to open socket
random client failures
CLOSE_WAIT growth
connection leak
```

Common causes:

```text
response bodies not closed
streams not closed
client created per request
missing try-with-resources
connection pool leak
unbounded inbound connections
long-lived idle clients
```

Production checks:

```bash
ulimit -n
lsof -p <pid> | wc -l
ss -tanp | grep <pid>
ls /proc/<pid>/fd | wc -l
```

Java-level prevention:

```java
try (InputStream in = socket.getInputStream()) {
    // consume stream
}
```

For higher-level clients, always follow the client library's response-body closing contract.

---

## 22. TCP and TLS Are Separate Layers

TCP connection establishment and TLS handshake are different phases.

For HTTPS:

```text
TCP connect succeeds
TLS handshake starts
certificate validation happens
ALPN may negotiate HTTP/2
then HTTP request is sent
```

If TLS fails, the TCP connection may have succeeded.

Common TLS-related failures:

```text
unknown certificate authority
expired certificate
hostname mismatch
missing intermediate certificate
unsupported protocol/cipher
mTLS client certificate missing
SNI mismatch
ALPN negotiation failure for HTTP/2
```

Why this matters:

```text
connect timeout does not cover all TLS failure modes
connection pool may pool post-TLS connections
HTTP/2 depends on ALPN in common TLS deployments
mTLS adds operational rotation concerns
```

TLS is covered deeply later, but TCP mental model must separate:

```text
Can I reach the port?
Can I establish encrypted identity?
Can I speak the application protocol?
```

---

## 23. TCP and HTTP/2/gRPC: One Connection, Many Streams

HTTP/1.1 often maps roughly to:

```text
one connection handles one active request at a time
```

with connection reuse for future requests.

HTTP/2 changes this:

```text
one TCP connection can carry many concurrent streams
```

gRPC commonly runs over HTTP/2, so one gRPC channel may multiplex many RPCs over fewer TCP connections.

This is powerful but creates new failure modes:

```text
one bad TCP connection affects many streams
TCP-level packet loss can affect all multiplexed streams
HTTP/2 flow control can stall streams
connection-level GOAWAY impacts many RPCs
max concurrent streams becomes a bottleneck
long-lived channels interact with DNS/load balancing
```

Mental model:

```text
HTTP/2 removes HTTP/1.1 application-level head-of-line blocking,
but it does not remove TCP-level head-of-line behavior.
```

---

## 24. TCP Head-of-Line Blocking

TCP guarantees ordered delivery.

If one packet is lost, later bytes cannot be delivered to the application until the missing bytes are recovered.

This can affect protocols above TCP.

For HTTP/2:

```text
multiple streams share one TCP connection
packet loss at TCP layer can delay bytes for all streams
```

For gRPC:

```text
many RPCs may share a channel/connection
network loss can increase latency for unrelated RPCs
```

This does not mean HTTP/2 or gRPC are bad. It means connection count, stream concurrency, network quality, and load balancer behavior matter.

---

## 25. NAT, Firewall, Load Balancer, and Idle State

TCP is end-to-end in theory.

Production networks often insert stateful middleboxes:

```text
NAT gateway
firewall
security appliance
load balancer
reverse proxy
API gateway
service mesh sidecar
```

These devices track connections and may expire idle state.

Common issue:

```text
TCP connection is idle.
Middlebox forgets it.
Application still holds socket.
Next write fails or hangs.
```

This is why you must know path-level timeouts:

```text
client pool idle timeout
server keep-alive timeout
load balancer idle timeout
proxy idle timeout
firewall idle timeout
NAT idle timeout
gRPC keepalive policy
HTTP/2 max connection age
```

The shortest meaningful timeout in the path often dominates behavior.

---

## 26. Java Blocking I/O, Virtual Threads, and the TCP Reality

Java virtual threads change the economics of blocking I/O.

With platform threads, many blocked socket reads can consume many OS threads.

With virtual threads, blocking-style code can scale to many concurrent waiting operations more naturally.

But virtual threads do not remove TCP or resource limits.

They do not create:

```text
unlimited remote capacity
unlimited connections
unlimited ephemeral ports
unlimited DB pool
unlimited bandwidth
unlimited file descriptors
unlimited load balancer state
safe retry semantics
```

Bad mental model:

```text
Virtual threads make blocking I/O free.
```

Better mental model:

```text
Virtual threads make blocking code composition cheaper,
but network resources and downstream capacity remain bounded.
```

Therefore, even with Java 21–25 virtual-thread-friendly designs, you still need:

```text
connection pools
semaphores
rate limits
timeouts
deadlines
bulkheads
bounded queues
backpressure
observability
```

---

## 27. Java Socket Options You Should Understand

Socket options are not usually tuned first, but a strong engineer knows what they mean.

### 27.1 `SO_KEEPALIVE`

Enables TCP keepalive behavior where supported.

Use carefully. OS defaults may be too slow for application failover.

### 27.2 `TCP_NODELAY`

Disables Nagle's algorithm.

Useful for small latency-sensitive messages, but not a universal fix.

### 27.3 `SO_RCVBUF` and `SO_SNDBUF`

Receive and send buffer hints.

Useful for high-bandwidth or high-latency paths, but wrong tuning can waste memory or hide backpressure.

### 27.4 `SO_REUSEADDR`

Allows address reuse in certain states and scenarios. Semantics vary by platform and socket type.

Often misunderstood. Do not use as a blind fix for port exhaustion.

### 27.5 `SO_LINGER`

Controls behavior when closing a socket with unsent data.

Can cause abrupt reset behavior if misused.

Most application code should avoid custom linger settings unless it has a precise reason.

---

## 28. How TCP Failure Maps to HTTP/gRPC Symptoms

| TCP/network condition | HTTP symptom | gRPC symptom | Likely handling |
|---|---|---|---|
| connect refused | fast client exception | `UNAVAILABLE` | retry only if safe; check readiness/listener |
| connect timeout | slow failure | `UNAVAILABLE`/deadline | bound timeout; check route/firewall |
| stale pooled connection | first request fails | `UNAVAILABLE` | retry idempotent; fix idle timeout |
| remote slow read | upload stalls | stream stall | backpressure, upload timeout |
| remote slow response | read/request timeout | `DEADLINE_EXCEEDED` | deadline, server profiling |
| RST from LB | 502/503/reset | `UNAVAILABLE` | inspect LB idle/target health |
| packet loss | high tail latency | high tail latency | network metrics, retransmits |
| port exhaustion | connect failures | channel failures | pooling, reduce churn, OS/NAT capacity |
| file descriptor leak | accept/connect failure | transport failure | close resources, raise limits carefully |

---

## 29. Diagnostic Commands for Java Engineers

These commands are not a replacement for observability, but they are powerful during incident response.

### 29.1 Socket state summary

```bash
ss -s
```

### 29.2 Connections to a specific destination

```bash
ss -tan dst <ip>:<port>
```

### 29.3 Count TCP states

```bash
ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c | sort -nr
```

### 29.4 Show process sockets

```bash
ss -tanp | grep java
```

### 29.5 Check file descriptor count

```bash
ls /proc/<pid>/fd | wc -l
```

### 29.6 Check ephemeral port range on Linux

```bash
cat /proc/sys/net/ipv4/ip_local_port_range
```

### 29.7 Check TCP keepalive defaults on Linux

```bash
cat /proc/sys/net/ipv4/tcp_keepalive_time
cat /proc/sys/net/ipv4/tcp_keepalive_intvl
cat /proc/sys/net/ipv4/tcp_keepalive_probes
```

### 29.8 Capture packets carefully

```bash
sudo tcpdump -i any host <ip> and port <port>
```

Packet capture is powerful but must be used carefully because it may expose sensitive data unless traffic is encrypted and metadata-only filtering is applied.

---

## 30. What Metrics Should Exist

For every serious Java network client, you want metrics like:

```text
request count by target/method/status
request duration histogram
connect duration
TLS handshake duration
pool acquired count
pool acquisition latency
active connections
idle connections
pending connection acquisitions
connection creation rate
connection close rate
timeout count by type
retry count
retry success/failure
bytes sent/received
in-flight requests
error count by exception class
DNS resolution latency/failure
```

For servers:

```text
accepted connections
active connections
connection lifetime
request concurrency
request duration histogram
read timeout/write timeout
request body size
response body size
slow client count
reset count
TLS handshake failures
file descriptor usage
thread/event-loop queue pressure
```

For gRPC:

```text
RPC count by service/method/status
RPC duration histogram
deadline exceeded count
cancelled count
message size
stream duration
active streams
channel state
keepalive failure
flow-control stalls if exposed
```

Without these, teams guess.

Top-tier engineers replace guessing with phase-specific evidence.

---

## 31. Common Anti-Patterns

### Anti-pattern 1: Creating a new HTTP client per request

Bad:

```java
HttpClient client = HttpClient.newHttpClient();
client.send(request, BodyHandlers.ofString());
```

inside every business request.

Why bad:

```text
poor connection reuse
more TLS handshakes
more ephemeral port churn
more TIME_WAIT
worse latency
harder observability
```

Better:

```text
create long-lived configured clients per target/profile
reuse them safely
instrument them
close resources when the application shuts down if the library requires it
```

### Anti-pattern 2: No timeout

No timeout means the system lets the network decide how long to wait.

Production systems should define:

```text
connect timeout
request timeout/deadline
read/write timeout when applicable
pool acquisition timeout
retry budget
```

### Anti-pattern 3: Retrying everything

Retries can amplify outages.

Bad retry policy:

```text
retry all exceptions
retry immediately
retry many times
no jitter
no idempotency check
no budget
```

Better:

```text
retry only safe transient failures
use bounded attempts
use exponential backoff + jitter
respect deadlines
use idempotency key for side-effecting operations
measure retry amplification
```

### Anti-pattern 4: Infinite or unbounded streaming

Streaming without backpressure eventually fails.

You need:

```text
bounded buffers
flow control
heartbeat
idle timeout
max stream duration
cancellation handling
slow consumer strategy
```

### Anti-pattern 5: Treating “connection reset” as always remote fault

Connection reset may be caused by:

```text
remote app
load balancer
firewall
idle timeout mismatch
client stale connection reuse
protocol error
server graceful shutdown bug
```

Do not blame the remote service before checking the path.

---

## 32. Mini Case Study 1: The 10-Minute Idle Reset

### Situation

A Java service calls an internal REST API.

Symptoms:

```text
first call after idle period fails with SocketException: Connection reset
retry succeeds
only happens in production
```

### Naive conclusion

```text
The remote API is unstable.
```

### Better analysis

Ask:

```text
Is the failure only after idle?
Does it happen on reused connections?
What is client pool idle timeout?
What is ALB/proxy/firewall idle timeout?
Does retry create a fresh connection?
```

### Likely root cause

```text
Client pool keeps idle connection longer than load balancer.
Load balancer drops idle state.
Client reuses stale connection.
First request fails.
Retry opens new connection and succeeds.
```

### Fix

```text
set client idle eviction below LB idle timeout
optionally validate idle connections
retry once for idempotent requests
monitor stale connection failures
```

### Lesson

The root cause was not business logic. It was connection lifecycle mismatch.

---

## 33. Mini Case Study 2: Port Exhaustion During Load Test

### Situation

A load test creates 2,000 requests per second to the same HTTPS endpoint.

Symptoms:

```text
Cannot assign requested address
connect failures
many TIME_WAIT sockets
remote API healthy
CPU not saturated
```

### Naive conclusion

```text
Need more CPU.
```

### Better analysis

Ask:

```text
Are clients reusing connections?
How many new TCP connections per second?
How large is ephemeral port range?
How many sockets in TIME_WAIT?
Is NAT gateway involved?
Is the load test creating a new client per request?
```

### Likely root cause

```text
Connection churn exhausted local/NAT port capacity.
```

### Fix

```text
enable/reuse connection pool
avoid creating new client per request
increase concurrency over fewer persistent connections
scale source nodes/IPs if necessary
review OS ephemeral range and NAT limits
```

### Lesson

Throughput failed because of connection lifecycle, not Java method execution speed.

---

## 34. Mini Case Study 3: CLOSE_WAIT Leak

### Situation

A Java service slowly degrades over days.

Symptoms:

```text
Too many open files
many CLOSE_WAIT sockets
restart fixes temporarily
```

### Naive conclusion

```text
OS limit too low.
```

### Better analysis

Ask:

```text
Which remote endpoints are in CLOSE_WAIT?
Are response bodies always closed?
Are streams closed on exception path?
Does client library require explicit response close?
Are there stuck threads holding resources?
```

### Likely root cause

```text
Application receives remote close but does not close local socket/resource.
```

### Fix

```text
fix response/stream lifecycle
use try-with-resources where applicable
add leak detection tests
monitor fd count and CLOSE_WAIT count
only increase ulimit after fixing leak
```

### Lesson

OS tuning cannot fix a resource lifecycle bug.

---

## 35. Java 8–25 Evolution Through the TCP Lens

### Java 8

Typical network stack choices:

```text
HttpURLConnection
Apache HttpClient
OkHttp
Netty
Servlet containers
JAX-RS clients
custom NIO frameworks
```

Concurrency model usually:

```text
platform threads
executor pools
callbacks/futures
reactive/event-loop frameworks
```

Engineering concern:

```text
blocking I/O consumes platform threads
thread pools need strict bounds
async frameworks improve scalability but increase cognitive complexity
```

### Java 11+

JDK `HttpClient` becomes standard.

Important properties:

```text
immutable reusable client
HTTP/1.1 and HTTP/2 support
sync and async APIs
configurable redirects/proxy/authenticator/executor
```

Engineering concern:

```text
still need timeouts, lifecycle, pooling awareness, observability, and safe retry semantics
```

### Java 21+

Virtual threads become a mainstream option.

Engineering concern:

```text
blocking-style code becomes easier to scale,
but TCP/network/downstream limits remain bounded.
```

### Java 25

Modern Java continues strengthening structured concurrency and maintainable concurrent code models.

Engineering concern:

```text
group related network calls as one operation
propagate deadlines/cancellation
avoid orphaned work
make failure and cancellation explicit
```

---

## 36. A Practical TCP Review Checklist for Java Services

When reviewing a Java service that calls remote systems, ask:

### Connection lifecycle

```text
Is the client reused?
Is connection pooling enabled/configured?
What is max connection count?
What is max per route/target?
What is idle timeout?
What is connection TTL/max age?
Does it align with LB/proxy/firewall timeout?
```

### Timeout and deadline

```text
Is connect timeout configured?
Is request/deadline timeout configured?
Is pool acquisition timeout configured?
Are read/write timeouts configured where relevant?
Do retries respect the original deadline?
```

### Retry safety

```text
Which failures are retried?
Are side-effecting operations protected with idempotency keys?
Is there jitter?
Is retry count bounded?
Is retry amplification measured?
```

### Resource limits

```text
How many active connections?
How many idle connections?
How many pending acquisitions?
How many file descriptors?
Any CLOSE_WAIT growth?
Any TIME_WAIT explosion?
Any ephemeral port pressure?
```

### Payload and stream behavior

```text
Are large uploads/downloads streamed?
Are response bodies closed?
Are max payload sizes enforced?
Is slow consumer handled?
Is cancellation handled?
```

### Observability

```text
Can we distinguish DNS/connect/TLS/write/read/request timeout?
Are exception classes tagged?
Are pool metrics visible?
Are p95/p99/p999 available?
Can we correlate client failure with server logs?
```

---

## 37. Exercises

### Exercise 1 — Classify the failure

For each error, identify the likely lifecycle phase:

```text
UnknownHostException
ConnectException: Connection refused
ConnectException: Connection timed out
SocketTimeoutException: Read timed out
SocketException: Broken pipe
SocketException: Connection reset
BindException: Cannot assign requested address
IOException: Too many open files
```

Then answer:

```text
Is retry likely safe?
What metric would prove the hypothesis?
What path component could be responsible?
```

### Exercise 2 — Draw your production call path

Choose one real service call and draw:

```text
Java service
HTTP/gRPC client
DNS
proxy/service mesh if any
load balancer
target service
remote DB/dependency if relevant
```

Annotate:

```text
connect timeout
request timeout
pool size
idle timeout
LB timeout
retry policy
observability fields
```

### Exercise 3 — Find hidden connection churn

Review one codebase and search for:

```text
new HttpClient
new OkHttpClient
new RestTemplate
new WebClient
new ManagedChannelBuilder
new Socket
```

Ask:

```text
Is this created once, per target, or per request?
What is the lifecycle?
Who owns shutdown?
Where are metrics attached?
```

### Exercise 4 — Diagnose a stale connection

Create a written incident hypothesis for:

```text
First request after 15 minutes idle fails.
Immediate retry succeeds.
Only happens through production load balancer.
```

Include:

```text
probable root cause
proof required
safe mitigation
long-term fix
```

---

## 38. Key Takeaways

1. TCP transports ordered bytes, not application messages.
2. Java `read()` does not mean “read one full request/response.”
3. A successful write does not mean the remote operation succeeded.
4. FIN, RST, EOF, timeout, and reset have different meanings.
5. Connection pooling improves performance but introduces lifecycle state.
6. Stale pooled connections are often caused by idle timeout mismatch.
7. `TIME_WAIT` is normal but can expose connection churn.
8. Growing `CLOSE_WAIT` usually suggests local resource cleanup problems.
9. Ephemeral ports and file descriptors are real capacity limits.
10. TCP keepalive, HTTP keep-alive, gRPC keepalive, and application heartbeat are different tools.
11. Virtual threads reduce thread-scaling pain but do not remove network/resource limits.
12. Top-tier Java network engineering starts by identifying the failed lifecycle phase.

---

## 39. References

- Oracle Java SE 25, `StandardSocketOptions`: `SO_KEEPALIVE`, `TCP_NODELAY`, socket option semantics.  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/StandardSocketOptions.html

- Oracle Java SE 25, `SocketOptions`.  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/SocketOptions.html

- Oracle Java SE 25, `java.net.http.HttpClient`: reusable immutable HTTP client supporting HTTP/1.1 and HTTP/2.  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html

- Oracle Java SE 25, `java.net.http` module summary.  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/module-summary.html

- gRPC documentation, Keepalive: HTTP/2 PING-based keepalive and configuration warnings.  
  https://grpc.io/docs/guides/keepalive/

- Red Hat documentation, Linux TCP connection states.  
  https://docs.redhat.com/

- Linux TCP Keepalive HOWTO.  
  https://tldp.org/HOWTO/TCP-Keepalive-HOWTO/usingkeepalive.html

---

## 40. Completion Status

```text
Part 2 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 3 — DNS, Name Resolution, and Endpoint Discovery in Java
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 1 — Mental Model Network Stack: Application Code to Wire](./001-network-stack-mental-model-application-code-to-wire.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 3 — DNS, Name Resolution, and Endpoint Discovery in Java](./003-dns-name-resolution-endpoint-discovery-java.md)
