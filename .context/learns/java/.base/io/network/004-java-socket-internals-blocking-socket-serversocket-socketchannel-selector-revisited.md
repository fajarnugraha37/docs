# Part 4 — Java Socket Internals: Blocking Socket, ServerSocket, SocketChannel, and Selector Revisited

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `004-java-socket-internals-blocking-socket-serversocket-socketchannel-selector-revisited.md`  
Scope: Java 8–25  
Status: Part 4 of 35

---

## 0. Why This Part Exists

You have already learned Java I/O, NIO, networking basics, Servlet/WebSocket, JAX-RS, and higher-level Jakarta APIs. This part is not meant to teach `Socket` from zero.

The goal here is different:

> To understand how Java socket abstractions behave under real load, partial failure, cancellation, backpressure, thread pressure, kernel limits, and protocol design constraints.

A top-tier Java network engineer does not merely know that:

```java
Socket socket = new Socket(host, port);
InputStream in = socket.getInputStream();
OutputStream out = socket.getOutputStream();
```

They know what this implies:

- a TCP connection is created;
- DNS may already have happened before connection;
- connect has its own timeout behavior;
- the connection consumes a local ephemeral port and file descriptor;
- reads and writes are byte-stream operations, not message operations;
- `write()` may block because the peer, kernel buffer, network, or TCP congestion window cannot accept more data;
- `read()` may block forever unless bounded by timeout, deadline, cancellation, or protocol framing;
- close semantics can become FIN, RST, EOF, `SocketException`, or leaked `CLOSE_WAIT` depending on timing;
- thread-per-connection may be simple but expensive on platform threads;
- selector-based multiplexing is powerful but harder because readiness is not completion;
- virtual threads change the economics of blocking I/O but do not remove network, memory, socket, file descriptor, or remote dependency limits.

This part builds the mental model needed before going deeper into HTTP clients, gRPC, Netty, flow control, backpressure, and production incident diagnosis.

---

## 1. The Core Mental Model

At the Java API level, you usually see one of these models:

```text
Blocking model:
  Socket / ServerSocket
  one blocking call waits until progress or failure
  often one thread per active connection/request

Selectable non-blocking model:
  SocketChannel / ServerSocketChannel / Selector
  one thread can watch many channels for readiness
  application must handle partial progress explicitly

Framework event-loop model:
  Netty / Undertow / gRPC Netty transport / async HTTP stack
  application code is invoked by event loops
  blocking inside the event loop can damage the whole runtime

Virtual-thread blocking model:
  same blocking style as Socket/HttpClient/etc.
  but blocking virtual thread can unmount from carrier thread
  simpler code shape, different scalability trade-off
```

The trap is to think these are merely different APIs.

They are different **resource ownership models**.

| Model | Who waits? | Who owns progress? | Main risk |
|---|---:|---:|---|
| Classic blocking socket | A Java thread | The blocked call | Thread exhaustion, unbounded wait |
| Selector NIO | Event loop/select loop | Your state machine | Complexity, fairness bugs, partial I/O bugs |
| Netty/event loop | Framework event loop | Framework pipeline | Blocking handler, buffer leak, event-loop starvation |
| Virtual thread blocking | Virtual thread runtime | Blocking call + scheduler | Too many sockets/remote calls, missing backpressure |

The top-level invariant:

> Network programming is not about choosing blocking vs non-blocking. It is about bounding waiting, memory, connection count, queue depth, retry pressure, and failure propagation.

---

## 2. Socket API Family in Java

Java exposes several network I/O families.

### 2.1 `Socket`

`java.net.Socket` represents one client-side TCP connection.

Typical lifecycle:

```text
create socket
configure options
connect to remote address
obtain input/output streams
exchange bytes
shutdown input/output optionally
close
```

Example:

```java
SocketAddress address = new InetSocketAddress("example.com", 443);

try (Socket socket = new Socket()) {
    socket.setTcpNoDelay(true);
    socket.setKeepAlive(true);
    socket.connect(address, 2_000);       // connect timeout
    socket.setSoTimeout(5_000);           // read timeout

    OutputStream out = socket.getOutputStream();
    InputStream in = socket.getInputStream();

    out.write("ping\n".getBytes(StandardCharsets.UTF_8));
    out.flush();

    byte[] buf = new byte[1024];
    int n = in.read(buf);

    if (n == -1) {
        // peer closed its output side; EOF
    }
}
```

Important: `Socket` is not an HTTP client. It is not a message client. It is a TCP byte-stream handle.

### 2.2 `ServerSocket`

`java.net.ServerSocket` listens for inbound TCP connections.

Lifecycle:

```text
bind local address/port
listen with backlog
accept connection
return Socket for accepted connection
hand off Socket to worker
continue accepting
```

Example:

```java
ExecutorService workers = Executors.newFixedThreadPool(200);

try (ServerSocket server = new ServerSocket()) {
    server.setReuseAddress(true);
    server.bind(new InetSocketAddress("0.0.0.0", 9000), 1024);

    while (!Thread.currentThread().isInterrupted()) {
        Socket client = server.accept();
        workers.submit(() -> handle(client));
    }
}
```

At small scale, this is easy to reason about. At high scale, the problems become:

- how many concurrent accepted sockets are allowed;
- how many worker threads are allowed;
- how large the accept backlog should be;
- what happens if workers are saturated;
- whether accepted sockets are closed when rejected;
- how slow clients are handled;
- how read/write timeouts are enforced;
- whether shutdown is graceful.

### 2.3 `SocketChannel`

`java.nio.channels.SocketChannel` can operate in blocking or non-blocking mode.

Blocking mode resembles `Socket`, but with `ByteBuffer`:

```java
try (SocketChannel channel = SocketChannel.open()) {
    channel.configureBlocking(true);
    channel.connect(new InetSocketAddress("example.com", 80));

    ByteBuffer request = StandardCharsets.US_ASCII.encode(
        "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n"
    );

    while (request.hasRemaining()) {
        channel.write(request);
    }

    ByteBuffer response = ByteBuffer.allocate(8192);
    while (channel.read(response) != -1) {
        response.clear();
    }
}
```

Non-blocking mode requires explicit progress tracking:

```java
SocketChannel channel = SocketChannel.open();
channel.configureBlocking(false);
boolean connected = channel.connect(address);

if (!connected) {
    // wait for OP_CONNECT using Selector
}
```

The most important conceptual shift:

> With non-blocking channels, a method returning `0` is not necessarily failure. It may simply mean “no progress now; try later when ready.”

### 2.4 `ServerSocketChannel`

`ServerSocketChannel` is the selectable variant of server-side listening.

```java
ServerSocketChannel server = ServerSocketChannel.open();
server.configureBlocking(false);
server.bind(new InetSocketAddress(9000));
server.register(selector, SelectionKey.OP_ACCEPT);
```

When accept readiness arrives:

```java
SocketChannel client = server.accept();
if (client != null) {
    client.configureBlocking(false);
    client.register(selector, SelectionKey.OP_READ, new ConnectionState());
}
```

In non-blocking mode, `accept()` can return `null`. Code must tolerate this.

### 2.5 `Selector`

A `Selector` is a readiness multiplexer.

It answers questions like:

```text
Which registered channels appear ready for accept/connect/read/write?
```

It does not say:

```text
Your full application message is ready.
Your full write has completed.
Your HTTP request is valid.
Your remote peer is healthy.
```

This distinction is critical.

---

## 3. Blocking Socket Is Simple but Not Naive

Blocking I/O has a clean mental model:

```text
call method
thread waits
method returns progress or throws
```

That simplicity is valuable. Many systems should prefer it, especially with modern virtual threads, if resource bounds are explicit.

### 3.1 Blocking Read

```java
int n = in.read(buffer);
```

Possible outcomes:

| Outcome | Meaning |
|---|---|
| `n > 0` | Some bytes were read |
| `n == -1` | Peer closed its output side; EOF |
| throws `SocketTimeoutException` | No data before read timeout |
| throws `SocketException` | Connection-level issue, often reset/closed |
| blocks | No bytes available yet and no timeout/deadline fired |

Common mistake:

```java
int n = in.read(buffer);
String msg = new String(buffer, 0, n, UTF_8);
process(msg); // WRONG if assuming one read == one complete message
```

TCP is a stream. One application message can arrive as multiple reads, and multiple application messages can arrive in one read.

Correct thinking:

```text
read bytes
append to protocol buffer
parse zero or more complete frames/messages
keep leftover bytes for next read
```

### 3.2 Blocking Write

```java
out.write(bytes);
out.flush();
```

Possible outcomes:

| Outcome | Meaning |
|---|---|
| returns | Bytes accepted by local stack/output stream abstraction |
| blocks | Local send buffer/backpressure prevents progress |
| throws | Socket closed/reset/broken pipe/other failure |

Important: return from `write()` does not mean the remote application has processed the data. It usually means Java/native/kernel accepted it for transmission.

### 3.3 Blocking Connect

```java
socket.connect(address, connectTimeoutMillis);
```

This only bounds the TCP connect phase, not DNS unless DNS resolution was done before or inside address construction depending on API path.

Separate phases:

```text
name resolution
TCP connect
TLS handshake
application protocol negotiation
request write
response first byte
response full body
```

Do not collapse them into one vague timeout.

### 3.4 Timeouts in Blocking Socket

`connect(address, timeout)` bounds connect.

`setSoTimeout(ms)` bounds blocking reads.

It does not necessarily bound:

- DNS resolution;
- write blocking duration in all cases;
- total request deadline;
- full response duration;
- thread pool queue wait before the socket code starts;
- time spent waiting for an available connection from a pool;
- TLS handshake unless implemented by higher-level socket/SSLSocket behavior with configured timeouts.

A production-grade client should think in **deadline**, not only per-operation timeout.

---

## 4. Thread-Per-Connection Server

A classic Java server pattern:

```java
while (running) {
    Socket socket = server.accept();
    executor.submit(() -> handle(socket));
}
```

This is easy to reason about because each connection has its own sequential code path.

### 4.1 The Hidden Queues

Even this simple server has many queues:

```text
client-side retry queue
network packets
kernel accept queue
ServerSocket backlog
accepted sockets waiting for worker
Executor queue
application parsing queue
database/message/cache downstream queue
response write buffer
kernel send buffer
client receive buffer
```

If you do not bound them, the system becomes an accidental buffer.

### 4.2 Minimum Safe Pattern

A safer server skeleton:

```java
public final class BoundedTcpServer implements AutoCloseable {
    private final ServerSocket server;
    private final ThreadPoolExecutor workers;
    private volatile boolean running = true;

    public BoundedTcpServer(int port, int maxWorkers, int queueSize) throws IOException {
        this.server = new ServerSocket();
        this.server.setReuseAddress(true);
        this.server.bind(new InetSocketAddress(port), 1024);

        this.workers = new ThreadPoolExecutor(
            maxWorkers,
            maxWorkers,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(queueSize),
            new ThreadFactory() {
                private final AtomicInteger seq = new AtomicInteger();
                @Override public Thread newThread(Runnable r) {
                    return new Thread(r, "tcp-worker-" + seq.incrementAndGet());
                }
            },
            new ThreadPoolExecutor.AbortPolicy()
        );
    }

    public void start() throws IOException {
        while (running) {
            Socket socket = server.accept();
            configure(socket);
            try {
                workers.execute(() -> handleAndClose(socket));
            } catch (RejectedExecutionException rejected) {
                closeQuietly(socket); // critical: do not leak accepted sockets
            }
        }
    }

    private void configure(Socket socket) throws SocketException {
        socket.setTcpNoDelay(true);
        socket.setSoTimeout(10_000);
        socket.setKeepAlive(true);
    }

    private void handleAndClose(Socket socket) {
        try (socket) {
            handle(socket);
        } catch (IOException e) {
            // log at appropriate level with remote address and phase
        }
    }

    private void handle(Socket socket) throws IOException {
        // parse protocol, apply deadline, enforce max payload, write response
    }

    private static void closeQuietly(Socket socket) {
        try { socket.close(); } catch (IOException ignored) {}
    }

    @Override public void close() throws IOException {
        running = false;
        server.close();
        workers.shutdown();
    }
}
```

Notice the invariants:

- accepted socket is either handed to a worker or closed;
- worker queue is bounded;
- socket read timeout is configured;
- max concurrency is explicit;
- overload is rejected instead of silently accumulating;
- connection cleanup is guaranteed by `try-with-resources`.

### 4.3 What Platform Threads Change

On Java 8–20, one platform thread per active connection can become expensive if many connections are mostly idle.

Risks:

- high memory from thread stacks;
- context switching;
- thread scheduling overhead;
- blocked threads hiding dependency slowness;
- executor saturation;
- poor shutdown behavior.

But this model can still be excellent when:

- connection count is bounded;
- protocol is simple;
- latency is moderate;
- each request performs blocking downstream I/O;
- simplicity and debuggability matter more than maximum connection density.

---

## 5. Virtual Threads and Blocking Socket I/O

Java 21 introduced virtual threads as a final feature, and Java 25 continues this model. A virtual thread is still a `Thread`, but it is not permanently tied to one OS thread. When a virtual thread performs many supported blocking operations, including blocking I/O, the runtime can suspend it and free the carrier OS thread for other work.

This changes the shape of server/client code.

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor();
     var server = new ServerSocket(9000)) {

    while (true) {
        Socket socket = server.accept();
        executor.submit(() -> handleAndClose(socket));
    }
}
```

This can support far more concurrent blocking tasks than classic platform-thread-per-connection.

But the critical warning:

> Virtual threads make waiting cheaper. They do not make the remote system faster, the network infinite, socket buffers infinite, file descriptors infinite, database pools infinite, or rate limits irrelevant.

### 5.1 What Virtual Threads Solve

They help with:

- simpler blocking code style;
- high concurrency for I/O-bound tasks;
- avoiding callback/reactive complexity for many workloads;
- reducing pressure to rewrite simple request/response code into event-loop style;
- improving stack traces and debuggability compared with callback chains.

### 5.2 What Virtual Threads Do Not Solve

They do not automatically solve:

- unbounded concurrent remote calls;
- retry storms;
- connection pool exhaustion;
- per-service concurrency limits;
- memory pressure from per-request buffers;
- file descriptor limits;
- accept overload;
- slow consumer write blocking;
- missing deadlines;
- absence of backpressure;
- protocol parsing bugs.

A bad virtual-thread server:

```java
while (true) {
    Socket socket = server.accept();
    Thread.startVirtualThread(() -> handle(socket)); // unbounded, no admission control
}
```

A better version has admission control:

```java
Semaphore permits = new Semaphore(10_000);

while (true) {
    Socket socket = server.accept();

    if (!permits.tryAcquire()) {
        socket.close();
        continue;
    }

    Thread.startVirtualThread(() -> {
        try (socket) {
            handle(socket);
        } catch (IOException e) {
            // log
        } finally {
            permits.release();
        }
    });
}
```

Virtual threads should make code clearer, not remove capacity planning.

---

## 6. Selector-Based Non-Blocking I/O

The selector model is different.

Instead of:

```text
one connection blocks one thread
```

You get:

```text
one or few threads repeatedly ask: which channels can make progress now?
```

Basic loop:

```java
Selector selector = Selector.open();

while (running) {
    selector.select();

    Iterator<SelectionKey> it = selector.selectedKeys().iterator();
    while (it.hasNext()) {
        SelectionKey key = it.next();
        it.remove();

        if (!key.isValid()) continue;

        if (key.isAcceptable()) handleAccept(key);
        if (key.isConnectable()) handleConnect(key);
        if (key.isReadable()) handleRead(key);
        if (key.isWritable()) handleWrite(key);
    }
}
```

### 6.1 Readiness Is Not Completion

`OP_READ` means reading may make progress.

It does not mean:

- a full application frame is ready;
- a full HTTP request is ready;
- a full protobuf message is ready;
- the peer will not close mid-read.

`OP_WRITE` means writing may make progress.

It does not mean:

- all pending bytes can be written;
- the peer application has consumed data;
- the network is healthy;
- you should always keep OP_WRITE enabled.

### 6.2 Partial Read

```java
int n = channel.read(buffer);
```

Possible outcomes in non-blocking mode:

| Outcome | Meaning |
|---|---|
| `n > 0` | Some bytes read |
| `n == 0` | No bytes available now |
| `n == -1` | Peer closed output; EOF |
| exception | connection failure |

You need connection state:

```java
final class ConnectionState {
    final ByteBuffer readBuffer = ByteBuffer.allocateDirect(16 * 1024);
    final Deque<ByteBuffer> pendingWrites = new ArrayDeque<>();
    final ProtocolDecoder decoder = new ProtocolDecoder();
    long lastProgressNanos = System.nanoTime();
}
```

### 6.3 Partial Write

```java
while (!pending.isEmpty()) {
    ByteBuffer head = pending.peek();
    channel.write(head);

    if (head.hasRemaining()) {
        // socket cannot accept more now
        enableWriteInterest(key);
        return;
    }

    pending.remove();
}

disableWriteInterest(key);
```

A common bug is assuming `channel.write(buffer)` writes the full buffer. It may write only part of it.

### 6.4 `OP_WRITE` Trap

A socket is often writable most of the time.

If you register every connection for `OP_WRITE` permanently, your selector loop can spin constantly on writable events and starve reads/accepts.

Correct pattern:

```text
enable OP_WRITE only when there are pending bytes that could not be fully written
disable OP_WRITE once pending write queue is empty
```

### 6.5 Interest Ops vs Ready Ops

`interestOps` = what you want to be notified about.  
`readyOps` = what the selector observed as ready.

Changing `interestOps` is how your state machine expresses demand.

Example:

```java
key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
```

and later:

```java
key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);
```

### 6.6 Selector Wakeup

If another thread enqueues data to be written by the selector thread, the selector may be blocked in `select()`.

You need:

```java
selector.wakeup();
```

But `wakeup()` is not a queue. It only wakes the selector. You still need thread-safe handoff of tasks/events.

---

## 7. A Minimal Non-Blocking Server Skeleton

This is intentionally simplified. The goal is mental model, not production-ready Netty replacement.

```java
public final class MiniNioServer implements AutoCloseable {
    private final Selector selector;
    private final ServerSocketChannel server;
    private volatile boolean running = true;

    public MiniNioServer(int port) throws IOException {
        this.selector = Selector.open();
        this.server = ServerSocketChannel.open();
        this.server.configureBlocking(false);
        this.server.bind(new InetSocketAddress(port));
        this.server.register(selector, SelectionKey.OP_ACCEPT);
    }

    public void run() throws IOException {
        while (running) {
            selector.select(1_000);
            closeIdleConnections();

            Iterator<SelectionKey> it = selector.selectedKeys().iterator();
            while (it.hasNext()) {
                SelectionKey key = it.next();
                it.remove();

                try {
                    if (!key.isValid()) continue;
                    if (key.isAcceptable()) accept(key);
                    if (key.isReadable()) read(key);
                    if (key.isWritable()) write(key);
                } catch (IOException e) {
                    closeKey(key);
                }
            }
        }
    }

    private void accept(SelectionKey key) throws IOException {
        ServerSocketChannel server = (ServerSocketChannel) key.channel();

        while (true) {
            SocketChannel client = server.accept();
            if (client == null) return;

            client.configureBlocking(false);
            client.setOption(StandardSocketOptions.TCP_NODELAY, true);
            client.setOption(StandardSocketOptions.SO_KEEPALIVE, true);

            ConnectionState state = new ConnectionState();
            client.register(selector, SelectionKey.OP_READ, state);
        }
    }

    private void read(SelectionKey key) throws IOException {
        SocketChannel channel = (SocketChannel) key.channel();
        ConnectionState state = (ConnectionState) key.attachment();
        ByteBuffer buffer = state.readBuffer;

        int n = channel.read(buffer);
        if (n == -1) {
            closeKey(key);
            return;
        }
        if (n == 0) {
            return;
        }

        state.lastProgressNanos = System.nanoTime();
        buffer.flip();

        List<ByteBuffer> responses = state.decoder.decode(buffer);
        buffer.compact();

        for (ByteBuffer response : responses) {
            state.pendingWrites.add(response);
        }

        if (!state.pendingWrites.isEmpty()) {
            key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
        }
    }

    private void write(SelectionKey key) throws IOException {
        SocketChannel channel = (SocketChannel) key.channel();
        ConnectionState state = (ConnectionState) key.attachment();

        while (!state.pendingWrites.isEmpty()) {
            ByteBuffer head = state.pendingWrites.peek();
            channel.write(head);

            if (head.hasRemaining()) {
                return;
            }

            state.pendingWrites.remove();
        }

        key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);
        state.lastProgressNanos = System.nanoTime();
    }

    private void closeIdleConnections() {
        // iterate keys and close connections whose lastProgressNanos exceeded policy
    }

    private void closeKey(SelectionKey key) {
        try { key.channel().close(); } catch (IOException ignored) {}
        key.cancel();
    }

    @Override public void close() throws IOException {
        running = false;
        selector.wakeup();
        server.close();
        selector.close();
    }

    static final class ConnectionState {
        final ByteBuffer readBuffer = ByteBuffer.allocateDirect(16 * 1024);
        final Deque<ByteBuffer> pendingWrites = new ArrayDeque<>();
        final ProtocolDecoder decoder = new ProtocolDecoder();
        long lastProgressNanos = System.nanoTime();
    }

    static final class ProtocolDecoder {
        List<ByteBuffer> decode(ByteBuffer input) {
            // parse complete frames; leave incomplete bytes in buffer
            return List.of();
        }
    }
}
```

Key lessons:

- each connection needs explicit state;
- read buffers must handle incomplete messages;
- write queues must handle partial writes;
- `OP_WRITE` must be dynamic;
- idle timeout must be explicit;
- errors must close channels and cancel keys;
- protocol parsing must be incremental.

---

## 8. Blocking vs Selector vs Framework: Decision Model

### 8.1 Use Blocking Socket When

Use direct blocking socket code when:

- connection count is low/moderate;
- protocol is simple;
- you need quick internal tooling;
- you can bound threads or use virtual threads;
- simplicity and debugging matter;
- performance requirement is not extreme;
- you are implementing a small adapter, test harness, or controlled internal service.

### 8.2 Use Selector/NIO Directly When

Use direct selector code only when:

- you need to deeply understand networking internals;
- you are building infrastructure/framework-level code;
- you need custom protocol handling without adopting Netty;
- you can invest in state machine correctness;
- you can test partial I/O, slow clients, cancellation, and overload thoroughly.

For most business applications, direct selector code is not worth it.

### 8.3 Use Netty or Existing Framework When

Use Netty/framework transport when:

- you need high connection density;
- you need HTTP/2, gRPC, TLS, backpressure, native transport, pooling, codec pipelines;
- you need mature buffer management;
- you need battle-tested event loop behavior;
- you are building gateways, proxies, streaming systems, or high-throughput RPC services.

But framework use does not remove the need to understand the model. It just moves many responsibilities into the framework.

### 8.4 Use Virtual Threads When

Use virtual-thread blocking design when:

- request/response code is easier to express sequentially;
- most blocking is I/O-bound;
- you need high concurrency but not necessarily event-loop-level low-level control;
- you can enforce bounded concurrency and deadlines;
- you want simple stack traces and simpler cancellation model;
- you are on Java 21+.

Virtual threads are not a license for unlimited fan-out.

---

## 9. Socket Options That Matter

### 9.1 `TCP_NODELAY`

Disables Nagle's algorithm.

Useful for latency-sensitive small writes.

```java
socket.setTcpNoDelay(true);
channel.setOption(StandardSocketOptions.TCP_NODELAY, true);
```

Trade-off:

- lower latency for small messages;
- possibly more packets;
- can reduce batching efficiency.

For RPC-like traffic, it is commonly enabled.

### 9.2 `SO_KEEPALIVE`

Enables TCP keepalive probes.

```java
socket.setKeepAlive(true);
channel.setOption(StandardSocketOptions.SO_KEEPALIVE, true);
```

But OS defaults are often too slow for application-level failure detection. TCP keepalive is not the same as:

- HTTP keep-alive;
- gRPC keepalive ping;
- application heartbeat;
- request deadline.

It is a low-level stale connection detection aid, not a full reliability strategy.

### 9.3 `SO_TIMEOUT`

Read timeout for blocking socket reads.

```java
socket.setSoTimeout(5_000);
```

This does not mean total request timeout. It means a blocking read waits at most this long for data before throwing `SocketTimeoutException`.

### 9.4 Receive and Send Buffers

```java
socket.setReceiveBufferSize(256 * 1024);
socket.setSendBufferSize(256 * 1024);
```

Buffers influence throughput and memory behavior, but they do not solve slow consumer problems.

Bigger buffer:

- may improve throughput for high bandwidth-delay product links;
- may increase memory usage;
- may hide backpressure longer;
- may worsen tail latency under overload.

### 9.5 `SO_REUSEADDR`

Often used on server sockets to allow rebinding after restart, depending on OS semantics.

```java
server.setReuseAddress(true);
```

Do not treat it as a magic fix for port conflicts. Understand OS behavior.

### 9.6 Backlog

```java
server.bind(new InetSocketAddress(port), backlog);
```

Backlog influences how many pending inbound connections can wait before `accept()`.

But effective behavior depends on OS limits and TCP queues. A large backlog does not protect an overloaded application if accepted connections cannot be processed.

---

## 10. Cancellation and Shutdown

### 10.1 Blocking Socket Cancellation

Common ways to unblock blocking socket operations:

- set read timeout and check shutdown flag;
- close the socket from another thread;
- close the server socket to unblock `accept()`;
- use interrupt where supported by the abstraction, but do not assume every legacy blocking path reacts the same way;
- use higher-level clients with cancellation/deadline support.

Example server shutdown:

```java
class Server implements AutoCloseable {
    private final ServerSocket server;
    private volatile boolean running = true;

    void run() throws IOException {
        while (running) {
            try {
                Socket socket = server.accept();
                // handle
            } catch (SocketException e) {
                if (!running) return; // server socket closed during shutdown
                throw e;
            }
        }
    }

    @Override
    public void close() throws IOException {
        running = false;
        server.close(); // unblocks accept
    }
}
```

### 10.2 Selector Shutdown

For selector loops:

```java
running = false;
selector.wakeup();
```

Then close channels and selector on loop exit.

Do not close channels from random threads unless the design accounts for selector key cancellation and concurrent state mutation.

### 10.3 Graceful Close vs Abrupt Close

TCP supports half-close:

```java
socket.shutdownOutput();
```

This says: “I will not send more bytes, but I may still read.”

Useful for protocols where one side sends request then signals EOF.

But many application protocols avoid raw half-close and use explicit message framing because connection reuse and multiplexing make EOF-based message boundaries unsuitable.

---

## 11. ByteBuffer: The State Machine Container

With NIO, `ByteBuffer` is central.

Basic lifecycle:

```text
write into buffer
flip for reading from buffer
read from buffer
compact remaining bytes for more writing
```

Example:

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);

int n = channel.read(buffer); // writes bytes into buffer
buffer.flip();               // prepare to read bytes from buffer

while (buffer.hasRemaining()) {
    byte b = buffer.get();
    // parse
}

buffer.compact();            // keep leftovers, prepare for next read
```

Common bugs:

- forgetting `flip()`;
- using `clear()` and losing incomplete frame bytes;
- assuming buffer contains one message;
- growing buffer unboundedly for malicious payloads;
- mixing character decoding and byte framing incorrectly;
- using direct buffers without understanding allocation cost/lifecycle.

### 11.1 Heap vs Direct Buffer

Heap buffer:

```java
ByteBuffer.allocate(size)
```

Direct buffer:

```java
ByteBuffer.allocateDirect(size)
```

Direct buffers can reduce copying for native I/O paths but have different allocation/deallocation behavior. Do not allocate direct buffers per small request in hot paths without measurement.

### 11.2 Buffer Sizing

A mature protocol parser separates:

```text
read buffer size
maximum frame size
maximum message size
maximum pending write bytes per connection
maximum total pending bytes across server
```

Without these, slow clients or malicious clients can turn your server into a memory sink.

---

## 12. Error Semantics: What Java Exceptions Often Mean

Do not overfit exception names. Map them to phase and context.

| Symptom | Common interpretation | Questions to ask |
|---|---|---|
| `ConnectException: Connection refused` | Remote host reachable but port not accepting | Is service running? LB target healthy? Wrong port? |
| `SocketTimeoutException: connect timed out` | Connect did not complete before timeout | Firewall? dropped SYN? wrong route? overloaded SYN backlog? |
| `SocketTimeoutException: Read timed out` | No bytes arrived during read timeout | Remote slow? lost response? protocol deadlock? timeout too low? |
| `SocketException: Connection reset` | Peer or middlebox sent RST | Did peer crash/close abruptly? LB idle timeout? protocol violation? |
| `SocketException: Broken pipe` | Local write after peer closed/reset | Is peer timing out? Are writes delayed? Slow client? |
| EOF `read() == -1` | Peer closed output cleanly | Is this expected by protocol? premature close? |
| Many `CLOSE_WAIT` | App did not close socket after peer close | Leak in close path? blocked worker? missing finally? |
| Many `TIME_WAIT` | Many recently closed outbound connections | No pooling? high churn? client closes first? |

Important discipline:

> Always log the phase: DNS, connect, TLS, request-write, response-read, streaming-read, response-write, close.

Without phase, network errors are ambiguous.

---

## 13. Production Failure Patterns

### 13.1 One Read Equals One Message

Bug:

```java
int n = in.read(buf);
handle(buf, n);
```

Failure:

- works locally;
- fails under real network fragmentation;
- corrupts messages when multiple messages arrive together;
- creates intermittent parsing bugs.

Fix:

- implement framing;
- parse incrementally;
- retain leftover bytes.

### 13.2 Unbounded Worker Queue

Bug:

```java
Executors.newFixedThreadPool(200)
```

This creates an unbounded queue by default.

Failure:

- latency grows silently;
- memory grows;
- timeouts fire after work is already obsolete;
- shutdown becomes slow;
- clients retry and amplify load.

Fix:

- bounded queue;
- explicit rejection;
- admission control;
- metrics for active, queued, rejected.

### 13.3 Permanent `OP_WRITE`

Bug:

```java
client.register(selector, OP_READ | OP_WRITE);
```

Failure:

- selector loop continuously wakes for writable sockets;
- CPU spikes;
- read fairness degrades;
- accept/read events starve.

Fix:

- enable write interest only when pending write buffer exists.

### 13.4 Slow Consumer Memory Leak

Bug:

```java
pendingWrites.add(response); // no bound
```

Failure:

- client reads slowly;
- server accumulates response buffers;
- memory grows;
- GC pressure rises;
- eventually OOM.

Fix:

- per-connection pending byte limit;
- global pending byte limit;
- timeout;
- drop/close slow connection;
- backpressure upstream.

### 13.5 Missing Close on Rejected Worker

Bug:

```java
Socket s = server.accept();
executor.execute(() -> handle(s)); // may throw RejectedExecutionException
```

Failure:

- accepted socket remains open;
- file descriptor leak;
- clients hang;
- server degrades further.

Fix:

- catch rejection and close socket immediately.

### 13.6 No Deadline, Only Read Timeout

Bug:

```java
socket.setSoTimeout(10_000);
```

But protocol does many reads. Each read can take 10 seconds.

Failure:

- total request lasts far beyond intended SLA;
- retry budgets become meaningless;
- upstream callers time out while server still works.

Fix:

- absolute deadline;
- pass remaining time into each blocking operation;
- cancel work when deadline expires.

---

## 14. Resource Accounting

A socket-heavy Java system consumes:

```text
file descriptors
local ports
kernel socket memory
JVM heap buffers
JVM direct buffers
threads or virtual threads
task queue slots
connection pool slots
TLS session/cache state
application protocol state
observability cardinality
remote server capacity
```

Top 1% engineering requires asking:

```text
What is the max number of concurrent sockets?
What is max pending bytes per socket?
What is max pending bytes globally?
What is max accepted-but-unprocessed connections?
What is max time a socket can be idle?
What is max time a request can exist?
What happens when each limit is reached?
How is it measured?
How is it tested?
```

---

## 15. Java 8–25 Perspective

### Java 8

Common production reality:

- `Socket`, `ServerSocket`, NIO channels;
- Apache HttpClient/OkHttp/Netty often used for serious HTTP;
- CompletableFuture exists but no standard JDK HTTP/2 client;
- no virtual threads;
- thread-per-blocking-operation must be carefully bounded.

### Java 11

Major shift:

- standard `java.net.http.HttpClient` arrives;
- supports HTTP/1.1 and HTTP/2;
- supports sync and async request models;
- still requires careful executor, timeout, body handling, and connection behavior understanding.

### Java 17

LTS baseline for many enterprises:

- mature JDK runtime;
- still no final virtual threads;
- many teams use Netty, Spring WebClient, Apache HttpClient 5, OkHttp, gRPC Java.

### Java 21

Major shift:

- virtual threads final;
- blocking I/O becomes much more scalable for many I/O-bound workloads;
- structured concurrency appears as preview/incubator-style evolving API depending on release path.

### Java 25

Modern baseline in this series:

- virtual-thread style is a serious architectural option;
- `HttpClient` remains standard JDK HTTP client;
- structured concurrency is part of modern Java design discussions/API evolution;
- low-level socket/NIO understanding remains necessary because frameworks still sit on these primitives.

---

## 16. Diagnostic Lens

When a socket issue occurs, avoid starting with the exception. Start with phase and resource.

### 16.1 Phase Questions

```text
Did failure happen before connect?
During connect?
During TLS handshake?
During first write?
During request body streaming?
Waiting for first response byte?
During response body streaming?
During close?
After idle reuse?
```

### 16.2 Resource Questions

```text
Are file descriptors exhausted?
Are local ephemeral ports exhausted?
Are worker threads exhausted?
Are virtual threads exploding without admission control?
Is connection pool saturated?
Are pending write buffers growing?
Are direct buffers growing?
Is DNS stale?
Is load balancer closing idle connections?
Is remote service overloaded?
```

### 16.3 Commands You Should Know

Linux examples:

```bash
ss -tanp
ss -s
lsof -p <pid>
netstat -s
cat /proc/<pid>/limits
cat /proc/sys/net/ipv4/ip_local_port_range
cat /proc/sys/net/ipv4/tcp_fin_timeout
jcmd <pid> Thread.print
jcmd <pid> VM.native_memory summary
```

Kubernetes examples:

```bash
kubectl exec -it <pod> -- ss -tanp
kubectl exec -it <pod> -- cat /etc/resolv.conf
kubectl top pod
kubectl describe pod <pod>
kubectl logs <pod>
```

Application metrics:

```text
active connections
accepted connections/sec
closed connections/sec
connection age
read timeout count
write failure count
pending write bytes
worker active/queued/rejected
selector loop duration
selector selected key count
connection state distribution
file descriptor usage
request deadline exceeded count
```

---

## 17. Design Invariants for Raw Socket Code

If you ever write raw socket code, enforce these invariants.

### Invariant 1: Every Accepted Socket Has an Owner

After `accept()`, exactly one component owns the socket.

```text
accepted -> configured -> handed off OR closed
```

No limbo.

### Invariant 2: Every Blocking Wait Has a Bound

No indefinite read unless protocol explicitly allows it and there is external cancellation.

```text
connect timeout
read timeout
idle timeout
total deadline
shutdown cancellation
```

### Invariant 3: Every Buffer Has a Bound

```text
max frame size
max message size
max read buffer
max pending write bytes
max global pending bytes
```

### Invariant 4: Every Queue Has a Bound

```text
accept backlog
executor queue
selector task queue
write queue
application work queue
retry queue
```

### Invariant 5: Every Protocol Has Framing

Do not rely on TCP packet boundaries. They do not exist at the application layer.

### Invariant 6: Every Failure Has a Phase

Log phase and remote/local endpoint.

```text
phase=connect remote=10.0.1.10:443 timeoutMs=2000 error=ConnectTimeout
```

### Invariant 7: Overload Is a First-Class State

A robust server intentionally rejects, sheds, or closes. It does not merely queue until death.

---

## 18. How This Connects to HTTP and gRPC

Everything here appears later in HTTP and gRPC.

HTTP client pool issue?

```text
Socket connections + pooling + idle close + stale reuse
```

gRPC deadline exceeded?

```text
HTTP/2 stream + TCP connection + flow control + deadline propagation
```

HTTP/2 multiplexing stall?

```text
one TCP connection + many streams + flow control + head-of-line at TCP layer
```

Netty event loop blocked?

```text
selector/event loop progress ownership violated
```

Slow SSE/WebSocket client?

```text
pending writes + slow consumer + memory bound
```

TLS handshake timeout?

```text
socket connect succeeded, but secure protocol establishment did not complete
```

So this part is foundational. Higher-level frameworks hide these mechanics until something fails.

---

## 19. Practical Exercises

### Exercise 1 — Build a Length-Prefixed Echo Server

Implement a TCP echo server where each message is:

```text
4-byte big-endian length
N-byte payload
```

Requirements:

- max frame size: 1 MB;
- read timeout: 10 seconds;
- total connection idle timeout: 60 seconds;
- bounded worker pool;
- close socket on overload;
- log remote address and phase.

Then test:

- one message split across many writes;
- many messages in one write;
- payload larger than max;
- client connects and sends nothing;
- client sends length but not full body;
- server overload.

### Exercise 2 — Implement the Same Protocol with Selector

Requirements:

- one selector thread;
- per-connection state;
- partial read support;
- partial write support;
- dynamic `OP_WRITE`;
- max pending write bytes per connection;
- close idle connections.

Observe how much complexity appears when you move from blocking to non-blocking.

### Exercise 3 — Virtual Thread Variant

Rebuild the blocking version using virtual threads.

Add:

- semaphore admission control;
- max active connections metric;
- deadline propagation;
- graceful shutdown.

Compare code clarity and resource behavior.

### Exercise 4 — Failure Injection

Use a test client that can:

- send slowly;
- read slowly;
- close abruptly;
- half-close output;
- send malformed frames;
- open many idle connections;
- send huge declared length.

Document the observed server behavior.

---

## 20. Interview-Level Questions

1. Why is TCP a byte stream and why does that matter for protocol design?
2. What is the difference between `read()` returning `-1`, throwing `SocketTimeoutException`, and throwing `SocketException: Connection reset`?
3. Why is `OP_WRITE` dangerous if always enabled?
4. What does `Socket.setSoTimeout()` actually bound?
5. Why can one `SocketChannel.write()` call write only part of a buffer?
6. What resource leak causes many sockets in `CLOSE_WAIT`?
7. What problem do virtual threads solve for blocking I/O, and what do they not solve?
8. Why can thread-per-connection be acceptable in one system and disastrous in another?
9. How would you prevent slow clients from causing server memory growth?
10. When should you choose Netty instead of writing direct NIO selector code?
11. What is the difference between TCP keepalive, HTTP keep-alive, and gRPC keepalive?
12. How do you design graceful shutdown for a socket server?
13. How does a connection pool change raw socket lifecycle assumptions?
14. Why must every queue and buffer be bounded?
15. How do you diagnose whether a timeout happened during connect, TLS, write, or read?

---

## 21. Common Anti-Patterns

```text
ANTI-PATTERN: One read equals one message
BETTER: Explicit framing and incremental parser

ANTI-PATTERN: Unbounded executor queue
BETTER: Bounded queue + rejection + metrics

ANTI-PATTERN: No read timeout
BETTER: Read timeout + total deadline + idle timeout

ANTI-PATTERN: Permanent OP_WRITE registration
BETTER: Enable OP_WRITE only when pending bytes exist

ANTI-PATTERN: Ignoring partial write
BETTER: Maintain pending write queue

ANTI-PATTERN: Closing socket paths not centralized
BETTER: Single ownership and try-with-resources/finally

ANTI-PATTERN: Virtual thread per task with no admission control
BETTER: Virtual threads + semaphore/bulkhead/rate limit

ANTI-PATTERN: Direct buffers allocated per request
BETTER: Reuse/pool carefully or use framework buffer management

ANTI-PATTERN: Logging only exception message
BETTER: Log phase, endpoint, timeout, connection age, attempt id
```

---

## 22. Summary

The key lesson of Part 4:

> Java socket programming is not primarily about API calls. It is about progress ownership, resource bounds, failure semantics, and protocol state.

Blocking sockets give simple sequential code but require bounded threads, timeouts, and cleanup.

Selectors give high connection density but require explicit state machines, partial I/O handling, fairness, and buffer discipline.

Virtual threads make blocking I/O practical at much higher concurrency, but they do not remove the need for admission control, deadlines, bounded buffers, and remote capacity protection.

Frameworks like Netty, HTTP clients, and gRPC hide many socket details, but when production incidents occur, the root cause often returns to these primitives:

```text
connection lifecycle
read/write progress
buffer pressure
selector/event-loop fairness
timeout semantics
close/reset behavior
resource exhaustion
```

Mastering this part gives you the vocabulary and mental model to understand the later parts on HTTP/1.1, HTTP/2, gRPC, Netty, streaming, backpressure, and production failure diagnosis.

---

## 23. References

- Oracle Java SE 25 API — `java.nio.channels` package: selectable channels and selectors.
- Oracle Java SE 25 API — `Socket`, `ServerSocket`, `SocketChannel`, `ServerSocketChannel`, `Selector`, `SelectionKey`, `ByteBuffer`, `StandardSocketOptions`.
- Oracle Java SE 25 documentation — Virtual Threads.
- gRPC Java documentation and Javadocs — Netty transport and channel concepts.
- Linux socket diagnostics: `ss`, `/proc`, file descriptor and TCP state inspection.

---

## 24. Series Progress

```text
Part 4 of 35 complete.
Series is not complete yet.
Next: Part 5 — Protocol Design Fundamentals: Framing, Length Prefix, Delimiters, Streaming, and Compatibility
```
