# Part 25 — Netty for Java Network Engineers: Event Loop, Channel Pipeline, ByteBuf, and Zero-Copy

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `025-netty-for-java-network-engineers-event-loop-channel-pipeline-bytebuf-zero-copy.md`  
Target Java: 8–25  
Level: Advanced / production engineering

---

## 0. Why This Part Exists

You can build network systems in Java without writing Netty code directly.

You may use:

- Spring WebFlux.
- Reactor Netty.
- gRPC Java.
- Vert.x.
- Async HTTP clients.
- WebSocket gateways.
- Redis/Kafka/database clients that internally depend on Netty.
- Custom TCP servers.
- High-volume protocol bridges.

But if you operate serious Java backend systems, Netty eventually appears in stack traces, memory leaks, thread dumps, latency profiles, or incident reports.

Netty is not just a networking library. It is a runtime model:

```text
few event-loop threads
+ many connections
+ non-blocking I/O
+ channel pipeline
+ explicit buffer lifecycle
+ asynchronous futures/listeners
+ transport-specific optimizations
```

A top-tier Java engineer does not merely know that Netty is “fast.” They understand why it is fast, what assumptions must be preserved, and how it fails when those assumptions are violated.

This part is not about memorizing Netty APIs. It is about building a mental model strong enough to reason about:

- why blocking inside an event loop is catastrophic;
- why one leaked `ByteBuf` pattern can become direct-memory exhaustion;
- why `write()` without `flush()` behaves differently from `writeAndFlush()`;
- why backpressure is not automatic just because the library is async;
- why gRPC, HTTP/2, WebSocket, and custom binary protocols often rely on Netty-style event-driven execution;
- why virtual threads do not replace Netty for every workload;
- why Netty performance bugs are usually lifecycle bugs, not syntax bugs.

Officially, Netty describes itself as an asynchronous event-driven network application framework for building high-performance protocol servers and clients. That sentence is accurate, but incomplete. The deeper truth is: **Netty gives you a disciplined way to turn network events into application state transitions without dedicating one platform thread per connection**.

---

## 1. What We Will Not Repeat

We will not repeat earlier material about:

- basic `Socket` / `ServerSocket` usage;
- basic `SocketChannel` / `Selector` usage;
- TCP fundamentals already covered in Part 2;
- HTTP/1.1 and HTTP/2 semantics already covered in Parts 8–9;
- gRPC fundamentals already covered in Parts 21–24;
- generic Java concurrency basics;
- basic NIO `ByteBuffer` mechanics.

Instead, this part focuses on Netty-specific engineering invariants.

---

## 2. Learning Outcomes

After this part, you should be able to:

1. Explain Netty's reactor-style execution model.
2. Distinguish `Channel`, `EventLoop`, `EventLoopGroup`, `ChannelPipeline`, `ChannelHandler`, and `ChannelHandlerContext`.
3. Explain why Netty handlers normally run on event-loop threads.
4. Explain why event-loop blocking destroys tail latency.
5. Design a safe inbound pipeline for a custom TCP protocol.
6. Design a safe outbound pipeline with bounded writes.
7. Understand `ByteBuf` lifecycle, reference counting, and leak detection.
8. Know when to use pooled/direct buffers and when not to.
9. Understand Netty's futures/listeners model.
10. Understand zero-copy file transfer and its constraints.
11. Recognize production symptoms of blocked event loops, buffer leaks, unbounded queues, and incorrect handler ownership.
12. Know when Netty is a good fit and when it is unnecessary complexity.

---

## 3. The Core Mental Model

Traditional blocking server:

```text
connection A -> thread A -> read -> parse -> process -> write
connection B -> thread B -> read -> parse -> process -> write
connection C -> thread C -> read -> parse -> process -> write
...
```

Netty-style event-driven server:

```text
many connections
    -> small number of event-loop threads
        -> read readiness events
        -> decode bytes into messages
        -> invoke handlers
        -> schedule writes
        -> flush bytes when socket can accept them
```

The essential shift:

```text
Blocking model:
  thread waits for connection progress.

Event-driven model:
  connection progress produces events handled by a small number of threads.
```

This changes almost every engineering assumption.

In a blocking model, a slow connection mostly wastes one thread.

In a Netty model, one blocked event-loop thread can delay thousands of connections assigned to that loop.

That is the price of high scalability: **each event-loop thread is more valuable than a normal request worker thread**.

---

## 4. Netty's Main Building Blocks

### 4.1 `Channel`

A `Channel` is Netty's abstraction for an open connection or I/O endpoint.

Examples:

- TCP client socket channel.
- TCP server listening channel.
- Accepted TCP connection channel.
- UDP datagram channel.
- Local/in-process channel.

A `Channel` owns or is associated with:

- a transport-specific socket/resource;
- a `ChannelPipeline`;
- an assigned `EventLoop`;
- configuration/options;
- local and remote addresses;
- lifecycle events.

Mental model:

```text
Channel = one I/O endpoint + its event pipeline + its assigned event-loop executor
```

A server has at least two categories of channels:

```text
Server listening channel:
  accepts new connections.

Child connection channels:
  handle each accepted client connection.
```

---

### 4.2 `EventLoop`

An `EventLoop` is a single-threaded executor responsible for handling I/O events and scheduled tasks for one or more channels.

Mental model:

```text
EventLoop = I/O thread + task queue + selector/native polling loop
```

A channel is registered to one event loop. Once registered, that channel's I/O events are usually handled by that same event-loop thread.

This gives Netty an important property:

```text
For a single Channel, handler callbacks are usually serialized on one event-loop thread.
```

That reduces synchronization complexity inside channel handlers. But it also means blocking the event loop blocks all channels assigned to it.

---

### 4.3 `EventLoopGroup`

An `EventLoopGroup` is a group of event loops.

Typical TCP server shape:

```text
boss EventLoopGroup:
  accepts new connections

worker EventLoopGroup:
  handles read/write events for accepted connections
```

Example conceptual layout:

```text
BossGroup
  boss-loop-1 -> ServerSocketChannel accept events

WorkerGroup
  worker-loop-1 -> channels 1, 5, 9, 13, ...
  worker-loop-2 -> channels 2, 6, 10, 14, ...
  worker-loop-3 -> channels 3, 7, 11, 15, ...
  worker-loop-4 -> channels 4, 8, 12, 16, ...
```

Each worker loop may own many client channels.

This is why sizing is not “one thread per client.” It is closer to:

```text
number of event loops ~= CPU / workload / blocking risk / transport behavior
```

---

### 4.4 `ChannelPipeline`

A `ChannelPipeline` is an ordered chain of handlers attached to a channel.

Inbound events flow generally from head to tail:

```text
socket read
  -> bytes received
  -> decoder
  -> protocol validator
  -> auth/session handler
  -> business handler
```

Outbound events flow generally from tail to head:

```text
business handler writes response object
  -> encoder
  -> compression/encryption/protocol framing
  -> socket write
```

Pipeline mental model:

```text
ChannelPipeline = protocol processing state machine composed as ordered handlers
```

This is one of Netty's most powerful abstractions. It lets you separate:

- byte framing;
- decoding;
- validation;
- business routing;
- encoding;
- compression;
- TLS;
- logging;
- metrics;
- backpressure;
- close behavior.

But it also creates lifecycle responsibilities: every handler must understand whether it owns, forwards, transforms, or releases messages.

---

### 4.5 `ChannelHandler`

A `ChannelHandler` processes events in the pipeline.

Common categories:

```text
Inbound handler:
  reacts to read, active, inactive, exception, user events.

Outbound handler:
  intercepts write, flush, connect, close, bind.

Duplex handler:
  handles both inbound and outbound events.
```

Typical inbound custom protocol pipeline:

```text
[LengthFieldBasedFrameDecoder]
  -> [MessageDecoder]
  -> [ProtocolValidationHandler]
  -> [RequestDispatchHandler]
```

Typical outbound path:

```text
[RequestDispatchHandler writes Response]
  -> [MessageEncoder]
  -> [LengthFieldPrepender]
  -> socket
```

---

### 4.6 `ChannelHandlerContext`

A `ChannelHandlerContext` connects a handler to its pipeline and channel.

It can:

- pass inbound events to the next handler;
- write outbound messages;
- close the channel;
- access the channel;
- access the executor/event loop;
- attach attributes.

Important distinction:

```java
ctx.write(msg)
```

starts outbound traversal from the current handler position.

```java
ctx.channel().write(msg)
```

starts outbound traversal from the pipeline tail.

This distinction matters when you build complex pipelines. Many production bugs come from writing at the wrong position and accidentally skipping outbound handlers.

---

## 5. Netty Execution Invariants

### 5.1 Event-loop callbacks must be fast

Inside handlers, you should assume:

```text
This code may run on an event-loop thread.
Blocking here can block many connections.
```

Dangerous operations inside event loops:

- JDBC calls.
- REST calls.
- gRPC blocking stub calls.
- Synchronous file I/O.
- `Thread.sleep`.
- Lock acquisition with uncertain wait time.
- Large CPU-heavy JSON/XML/protobuf transformations.
- Password hashing.
- Long compression tasks.
- Waiting on `Future.get()` / `CompletableFuture.join()`.
- Calling `.sync()` from an event-loop callback.

The key invariant:

```text
Event-loop thread should orchestrate I/O, not perform slow business work.
```

---

### 5.2 Channel callbacks are serialized, but your application may not be

For one channel, Netty usually serializes handler callbacks through the assigned event loop.

This is useful:

```text
No two reads for the same channel normally mutate handler state concurrently.
```

But this does not mean your whole application is single-threaded.

Across channels:

```text
channel A -> worker-loop-1
channel B -> worker-loop-2
channel C -> worker-loop-3
```

Shared state across channels still needs concurrency control.

Bad:

```java
private final HashMap<String, Session> sessions = new HashMap<>();
```

if accessed by many event loops.

Better:

```java
private final ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();
```

or shard ownership by event loop / actor / session partition.

---

### 5.3 Async does not mean unlimited

Netty removes the need for one thread per connection, but it does not remove limits:

- file descriptors;
- direct memory;
- kernel socket buffers;
- outbound queue size;
- remote service capacity;
- CPU;
- TLS handshake cost;
- serialization cost;
- per-channel pending writes;
- event-loop task queue;
- application-level queues.

A common mistake:

```text
We use Netty, so we can handle unlimited clients.
```

Correct:

```text
Netty lets a bounded number of threads manage many connections efficiently, but every connection and every queued message still consumes finite resources.
```

---

## 6. The Event Loop in Detail

A simplified event-loop iteration:

```text
while running:
  1. wait for I/O readiness events
  2. process selected keys / native events
  3. run scheduled tasks
  4. run immediate task queue
  5. flush pending writes when possible
```

This means event-loop latency can be caused by:

- too many ready sockets;
- handler code doing CPU-heavy work;
- blocking handler code;
- too many scheduled tasks;
- unbounded task submission to event loop;
- excessive writes/flushes;
- GC pauses;
- OS scheduling;
- native transport issues;
- selector wakeup storms.

Production symptom:

```text
CPU not maxed, database healthy, remote service healthy, but all network responses become slow.
```

Possible cause:

```text
event-loop starvation
```

The event loop is the heartbeat of a Netty application.

---

## 7. Blocking Hazard: The Most Important Netty Rule

### 7.1 Bad example

```java
public final class BadHandler extends SimpleChannelInboundHandler<Request> {
    private final UserRepository repository;

    public BadHandler(UserRepository repository) {
        this.repository = repository;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, Request request) {
        // BAD: JDBC call on event-loop thread.
        User user = repository.findById(request.userId());

        ctx.writeAndFlush(Response.ok(user));
    }
}
```

Why this is bad:

```text
One slow database call blocks the event-loop thread.
All channels assigned to that event loop are delayed.
Tail latency explodes.
Timeouts propagate.
Retries increase load.
The incident looks like a network problem but starts as blocking work in an I/O thread.
```

---

### 7.2 Safer pattern: offload business work

```java
public final class DispatchHandler extends SimpleChannelInboundHandler<Request> {
    private final ExecutorService businessExecutor;
    private final UserService userService;

    public DispatchHandler(ExecutorService businessExecutor, UserService userService) {
        this.businessExecutor = businessExecutor;
        this.userService = userService;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, Request request) {
        businessExecutor.submit(() -> {
            Response response;
            try {
                response = userService.handle(request);
            } catch (Exception e) {
                response = Response.error("INTERNAL_ERROR");
            }

            // Return to the channel's event loop before writing if necessary.
            ctx.executor().execute(() -> ctx.writeAndFlush(response));
        });
    }
}
```

This is better, but still incomplete unless the executor is bounded.

A safe production version also needs:

- bounded queue;
- rejection handling;
- timeout/deadline;
- cancellation if channel closes;
- per-dependency isolation;
- metrics for queue depth and execution latency.

---

### 7.3 Better mental model

```text
Event loop:
  accepts bytes, decodes frames, validates protocol, schedules work, writes result.

Business pool:
  performs blocking or CPU-heavy work under bounded capacity.
```

Do not move unlimited work from event loop to an unlimited executor. That only moves the failure.

---

## 8. Channel Pipeline as Protocol State Machine

A custom TCP protocol should rarely parse everything in one handler.

Bad pipeline:

```text
[GodHandler]
  - reads ByteBuf
  - parses framing
  - validates header
  - authenticates
  - executes business logic
  - serializes response
  - handles errors
  - manages metrics
```

Better pipeline:

```text
[ConnectionMetricsHandler]
  -> [LengthFieldBasedFrameDecoder]
  -> [ProtocolHeaderDecoder]
  -> [MessageDecoder]
  -> [AuthenticationHandler]
  -> [RequestValidationHandler]
  -> [BusinessDispatchHandler]
  -> [ResponseEncoder]
  -> [LengthFieldPrepender]
```

Each handler has a focused responsibility.

### 8.1 Example: inbound protocol stages

```text
Raw bytes
  -> frame boundary
  -> message object
  -> authenticated request
  -> validated command
  -> business dispatch
```

### 8.2 Example: outbound protocol stages

```text
Response object
  -> encoded payload
  -> envelope/header
  -> length prefix
  -> bytes
```

This separation matters because failures differ by layer:

```text
bad frame length       -> protocol error, close channel
bad schema            -> request error, maybe keep channel
unauthenticated       -> auth error, maybe close channel
business conflict     -> domain error, keep channel
encoder failure       -> internal error, likely close channel
write failure         -> transport error, close channel
```

A mature protocol server does not treat every exception as `500` or `close`.

---

## 9. Inbound vs Outbound Event Direction

Netty pipelines have directional flow.

Inbound events:

```text
Channel active
Channel read
Channel read complete
Exception caught
User event triggered
Channel inactive
```

Outbound operations:

```text
Bind
Connect
Write
Flush
Close
Disconnect
```

Conceptual flow:

```text
Inbound:
  Head -> handler1 -> handler2 -> handler3 -> Tail

Outbound:
  Tail -> handler3 -> handler2 -> handler1 -> Head
```

Why this matters:

- An inbound decoder should propagate decoded messages using `ctx.fireChannelRead(decoded)`.
- An outbound encoder should intercept `write()` and transform objects to bytes.
- Writing from the wrong context can skip expected outbound handlers.
- Handler order determines whether TLS, compression, framing, and logging see plaintext or encoded bytes.

---

## 10. `ByteBuf`: Netty's Buffer Model

Java NIO gives you `ByteBuffer`.

Netty gives you `ByteBuf`.

`ByteBuf` improves ergonomics and performance for network workloads:

- separate reader/writer indexes;
- dynamic capacity;
- pooled allocation;
- direct memory support;
- slicing/duplication;
- composite buffers;
- reference counting;
- efficient protocol parsing.

Mental model:

```text
ByteBuf = mutable byte storage + reader index + writer index + reference count
```

Typical state:

```text
+-------------------+-------------------+-------------------+
| discarded bytes   | readable bytes    | writable bytes    |
+-------------------+-------------------+-------------------+
0              readerIndex         writerIndex          capacity
```

This is more natural for network parsers than constantly flipping `ByteBuffer`.

---

## 11. Reader and Writer Indexes

Example:

```java
ByteBuf buf = Unpooled.buffer(16);

buf.writeInt(42);
buf.writeByte(7);

int number = buf.readInt();
byte flag = buf.readByte();
```

The buffer tracks:

```text
readerIndex: what has already been consumed
writerIndex: what has already been produced
```

This lets decoders handle partial frames:

```java
if (in.readableBytes() < 4) {
    return; // need more data for length prefix
}

in.markReaderIndex();
int length = in.readInt();

if (in.readableBytes() < length) {
    in.resetReaderIndex();
    return; // full frame not yet available
}

ByteBuf frame = in.readRetainedSlice(length);
```

Important: manual decoders are easy to get wrong. Prefer battle-tested decoders like `LengthFieldBasedFrameDecoder` when the protocol shape fits.

---

## 12. Reference Counting: The Sharpest Edge

Netty uses reference counting for some objects, most notably `ByteBuf`.

Why?

Because high-performance networking allocates and releases many buffers. Waiting for GC to reclaim every network buffer can increase latency and memory pressure, especially for direct memory.

Reference counting means:

```text
someone owns the buffer
owner must release it when done
retained copies must also be released
```

Common operations:

```java
buf.refCnt();   // current reference count
buf.retain();   // increment
buf.release();  // decrement; deallocate when zero
```

If you release too early:

```text
IllegalReferenceCountException / corrupted behavior
```

If you never release:

```text
direct memory leak / ResourceLeakDetector warnings / OutOfDirectMemoryError
```

---

## 13. Ownership Rules for `ByteBuf`

A practical rule:

```text
If your handler consumes a reference-counted message and does not pass it onward, release it.
If your handler passes it onward unchanged, do not release it.
If your handler stores it beyond the callback, retain it and release it later.
If your handler creates a derived retained buffer, release that retained buffer when done.
```

### 13.1 Consuming and releasing

```java
@Override
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    ByteBuf buf = (ByteBuf) msg;
    try {
        // consume bytes
    } finally {
        buf.release();
    }
}
```

### 13.2 Passing onward

```java
@Override
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    // Do not release if passing ownership to next handler.
    ctx.fireChannelRead(msg);
}
```

### 13.3 Storing asynchronously

```java
@Override
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    ByteBuf buf = (ByteBuf) msg;
    ByteBuf retained = buf.retain();

    asyncExecutor.submit(() -> {
        try {
            process(retained);
        } finally {
            retained.release();
        }
    });

    // Current handler still needs to release original if it consumed it.
    buf.release();
}
```

This pattern is subtle. Mistakes are common.

In many cases, decode `ByteBuf` into immutable domain objects before offloading to business executors. That reduces buffer ownership complexity.

---

## 14. `SimpleChannelInboundHandler` and Auto Release

`SimpleChannelInboundHandler<T>` can automatically release inbound messages after `channelRead0` returns, depending on constructor settings.

This is convenient:

```java
public final class RequestHandler extends SimpleChannelInboundHandler<Request> {
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, Request request) {
        ctx.writeAndFlush(handle(request));
    }
}
```

But be careful when `T` is `ByteBuf` or a reference-counted object.

Bad:

```java
public final class AsyncHandler extends SimpleChannelInboundHandler<ByteBuf> {
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf msg) {
        asyncExecutor.submit(() -> process(msg)); // BAD: msg may be auto-released
    }
}
```

Better:

```java
public final class AsyncHandler extends SimpleChannelInboundHandler<ByteBuf> {
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf msg) {
        ByteBuf retained = msg.retainedDuplicate();
        asyncExecutor.submit(() -> {
            try {
                process(retained);
            } finally {
                retained.release();
            }
        });
    }
}
```

Even better for most business logic:

```java
public final class DecodeThenDispatchHandler extends SimpleChannelInboundHandler<ByteBuf> {
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf msg) {
        Request request = decodeToImmutableRequest(msg);
        businessExecutor.submit(() -> handle(ctx, request));
    }
}
```

---

## 15. Direct Memory, Heap Memory, and Pooled Buffers

Netty often uses direct buffers for I/O efficiency.

Heap buffer:

```text
managed by JVM heap
visible to GC
may require copy to native socket buffer
```

Direct buffer:

```text
allocated outside normal Java heap
better for native I/O
limited by direct memory budget
leaks may not show as normal heap growth
```

Pooled buffer:

```text
reused to reduce allocation overhead
requires correct lifecycle handling
```

Unpooled buffer:

```text
simpler ownership in some contexts
potentially more allocation overhead
```

Production consequence:

```text
Your heap graph may look fine while the JVM dies from direct memory exhaustion.
```

Common symptom:

```text
io.netty.util.internal.OutOfDirectMemoryError
LEAK: ByteBuf.release() was not called before it's garbage-collected
```

---

## 16. Resource Leak Detection

Netty has leak detection levels for reference-counted objects.

Typical levels:

```text
DISABLED  -> no leak detection
SIMPLE    -> sampled leak detection, default in many configurations
ADVANCED  -> sampled leak detection with access records
PARANOID  -> checks every buffer; useful in tests, expensive in production
```

Useful JVM option during investigation:

```bash
-Dio.netty.leakDetection.level=advanced
```

For tests:

```bash
-Dio.netty.leakDetection.level=paranoid
```

Operational rule:

```text
Never ignore Netty leak detector messages.
One visible sampled leak often implies many hidden leaks.
```

---

## 17. Write, Flush, and Backpressure

Netty distinguishes `write()` and `flush()`.

```java
ctx.write(response1);
ctx.write(response2);
ctx.write(response3);
ctx.flush();
```

This batches writes.

```java
ctx.writeAndFlush(response);
```

This writes and flushes immediately.

Batching can improve throughput. But delayed flush can increase latency if misused.

### 17.1 Outbound buffer

Writing does not mean bytes are already sent over the network.

The channel has an outbound buffer. If the peer is slow or the socket cannot accept more bytes, pending outbound data grows.

Danger:

```text
fast producer + slow client + unbounded writes = memory explosion
```

---

## 18. Channel Writability

Netty exposes channel writability based on high/low watermarks.

Conceptual model:

```text
if pending outbound bytes > high watermark:
  channel becomes not writable

if pending outbound bytes < low watermark:
  channel becomes writable again
```

Handler hook:

```java
@Override
public void channelWritabilityChanged(ChannelHandlerContext ctx) {
    if (ctx.channel().isWritable()) {
        resumeProducing(ctx);
    } else {
        pauseProducing(ctx);
    }
    ctx.fireChannelWritabilityChanged();
}
```

This is a foundation for application-level backpressure.

Important:

```text
Netty tells you when channel writability changes.
It does not automatically make your business producer stop.
Your application must respect the signal.
```

---

## 19. Auto Read and Manual Read

By default, Netty may automatically continue reading from the socket.

For some protocols, you may disable auto-read to apply backpressure.

Conceptual pattern:

```java
channel.config().setAutoRead(false);
```

Then explicitly request more reads:

```java
ctx.read();
```

This can be useful when:

- downstream queues are full;
- business executor is saturated;
- server needs strict per-channel flow control;
- client streaming needs bounded memory.

But manual read is advanced. If done wrong, channels can stall forever.

---

## 20. Futures and Listeners

Netty operations are asynchronous and return `ChannelFuture`.

Bad inside event loop:

```java
ctx.writeAndFlush(response).sync(); // may block event-loop thread
```

Better:

```java
ctx.writeAndFlush(response).addListener(future -> {
    if (!future.isSuccess()) {
        Throwable cause = future.cause();
        // log and close or handle
    }
});
```

Why listeners are preferred:

```text
They preserve non-blocking execution.
They run when operation completes.
They avoid waiting on the event-loop thread.
```

Netty's own API docs emphasize that adding a listener is non-blocking and lets the I/O thread notify completion listeners later.

---

## 21. Connection Lifecycle Events

Important events:

```text
channelRegistered
channelActive
channelRead
channelReadComplete
channelWritabilityChanged
userEventTriggered
exceptionCaught
channelInactive
channelUnregistered
```

Practical use:

```text
channelActive:
  initialize per-connection state, register session, maybe send handshake.

channelRead:
  receive inbound data/messages.

channelReadComplete:
  flush batched writes, update metrics.

channelWritabilityChanged:
  pause/resume producers.

exceptionCaught:
  classify transport/protocol/application exception.

channelInactive:
  cleanup session, cancel pending work, release retained buffers.
```

A mature server treats lifecycle events as state transitions, not logging callbacks.

---

## 22. Exception Handling

Bad:

```java
@Override
public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
    cause.printStackTrace();
    ctx.close();
}
```

Better:

```java
@Override
public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
    ErrorClassification classification = classify(cause);

    metrics.increment("netty.exception", "type", classification.type());

    if (classification.isProtocolError()) {
        ctx.writeAndFlush(ErrorFrame.protocolError(classification.code()))
           .addListener(ChannelFutureListener.CLOSE);
        return;
    }

    if (classification.isTransportError()) {
        ctx.close();
        return;
    }

    ctx.writeAndFlush(ErrorFrame.internalError())
       .addListener(ChannelFutureListener.CLOSE);
}
```

Exception taxonomy matters:

```text
Malformed frame        -> protocol error
Invalid message        -> request error
Unauthorized           -> auth error
Business conflict      -> domain response
Encoder bug            -> internal error
Peer reset             -> transport close
Write timeout          -> transport close
```

---

## 23. Timeouts in Netty Pipelines

Netty has handlers for idle and timeout behavior, such as:

- read idle;
- write idle;
- all idle;
- read timeout;
- write timeout.

Conceptual pipeline:

```text
[IdleStateHandler]
  -> [HeartbeatHandler]
  -> [FrameDecoder]
  -> [MessageDecoder]
  -> [BusinessHandler]
```

Example behavior:

```text
No inbound data for 60s:
  send ping or close channel.

No outbound write progress for configured time:
  close slow/stuck channel.
```

Be careful:

```text
Idle timeout is not the same as request deadline.
Heartbeat is not the same as TCP keepalive.
Write timeout is not the same as remote processing timeout.
```

---

## 24. Decoders: Avoiding Frame Bugs

TCP is a byte stream. Netty does not magically know your message boundaries.

You need framing.

Common decoders:

```text
FixedLengthFrameDecoder
DelimiterBasedFrameDecoder
LineBasedFrameDecoder
LengthFieldBasedFrameDecoder
HttpServerCodec
HttpObjectAggregator
WebSocketFrame decoder/encoder
ProtobufVarint32FrameDecoder
```

The framing rule from Part 5 still applies:

```text
Never parse application messages directly from arbitrary socket reads.
First recover frame boundaries.
Then decode payload.
```

Bad:

```java
@Override
protected void channelRead0(ChannelHandlerContext ctx, ByteBuf in) {
    Request request = parseAssumingFullMessage(in); // BAD
}
```

Better:

```text
[LengthFieldBasedFrameDecoder]
  -> [RequestDecoder]
```

---

## 25. Encoders: Outbound Contract

An encoder transforms application objects into bytes.

Example conceptual encoder:

```java
public final class ResponseEncoder extends MessageToByteEncoder<Response> {
    @Override
    protected void encode(ChannelHandlerContext ctx, Response msg, ByteBuf out) {
        byte[] payload = serialize(msg);
        out.writeInt(payload.length);
        out.writeBytes(payload);
    }
}
```

In production, consider:

- max payload size;
- serialization exceptions;
- compression threshold;
- checksum/signature;
- protocol version;
- correlation id;
- response code;
- metrics.

Outbound encoding is part of protocol compatibility.

---

## 26. Zero-Copy in Netty

Zero-copy means avoiding unnecessary copies between kernel space and user space.

Typical file download without zero-copy:

```text
disk -> kernel buffer -> user-space byte[]/ByteBuf -> kernel socket buffer -> NIC
```

With zero-copy file transfer:

```text
disk/kernel page cache -> kernel socket buffer/NIC path
```

Netty exposes this through concepts such as `FileRegion` / `DefaultFileRegion` for supported channels.

Conceptual use:

```java
FileRegion region = new DefaultFileRegion(fileChannel, 0, fileLength);
ctx.writeAndFlush(region);
```

Benefits:

- lower CPU usage;
- lower memory copying;
- better large file throughput.

Constraints:

- not always compatible with TLS because TLS encryption usually needs user-space processing;
- transport support matters;
- OS/JDK behavior matters;
- backpressure still matters;
- file lifecycle must be managed;
- error handling is still required.

Zero-copy is not “free performance.” It is a specialized tool for the correct workload.

---

## 27. Native Transports: NIO vs epoll/kqueue/io_uring Direction

Netty can use Java NIO transport or native transports.

Common transports:

```text
NIO       -> cross-platform Java NIO
Epoll     -> Linux native transport
KQueue    -> macOS/BSD native transport
```

Native transports may provide better performance or platform-specific features.

Conceptual replacement:

```text
NioEventLoopGroup        -> EpollEventLoopGroup / KQueueEventLoopGroup
NioServerSocketChannel   -> EpollServerSocketChannel / KQueueServerSocketChannel
NioSocketChannel         -> EpollSocketChannel / KQueueSocketChannel
```

Production guidance:

```text
Use NIO as a portable baseline.
Use native transport when you have measured benefit or need platform-specific features.
Keep deployment OS, classifier dependencies, container base image, and architecture in sync.
```

Do not switch transport casually in critical systems without load testing.

---

## 28. Netty and gRPC Java

gRPC Java commonly uses Netty as its main HTTP/2 transport for server and non-Android client use cases.

That means many gRPC production symptoms are Netty symptoms wearing gRPC names:

```text
gRPC symptom:
  DEADLINE_EXCEEDED
Possible Netty cause:
  blocked event loop, saturated outbound buffer, flow control stall

 गRPC symptom:
  UNAVAILABLE / connection reset
Possible Netty cause:
  channel close, TLS failure, GOAWAY, RST_STREAM, LB idle timeout

 gRPC symptom:
  memory growth
Possible Netty cause:
  direct buffer pressure, pending writes, streaming consumer too slow
```

If you operate gRPC Java at scale, knowing Netty helps you read:

- thread names;
- event-loop stack traces;
- direct memory errors;
- HTTP/2 frame issues;
- keepalive behavior;
- flow-control stalls.

---

## 29. Netty and Reactor Netty / Spring WebFlux

Spring WebFlux commonly runs on Reactor Netty by default.

This means WebFlux applications inherit event-loop rules:

```text
Do not block event-loop threads.
Do not call blocking repositories unless moved to a bounded scheduler.
Do not perform CPU-heavy work in the event loop.
Do not assume reactive means infinite capacity.
```

Classic pitfall:

```java
Mono<User> handler(ServerRequest request) {
    User user = jdbcRepository.findById(id); // BAD if on event loop
    return ServerResponse.ok().bodyValue(user);
}
```

Correct direction:

```text
Use non-blocking driver
or offload blocking work to bounded elastic/custom scheduler
and preserve timeout/backpressure semantics.
```

The same mental model applies even when Netty is hidden under framework abstractions.

---

## 30. Netty and Virtual Threads

Java virtual threads make blocking I/O cheaper from a thread scalability perspective.

This changes the design space:

```text
For many request/response services:
  virtual threads + blocking APIs may be simpler and good enough.

For many long-lived high-concurrency protocol servers:
  Netty remains valuable because connection/event multiplexing and buffer control are central.
```

Virtual threads reduce the cost of blocking a thread.

They do not eliminate:

- socket limits;
- connection limits;
- bandwidth limits;
- downstream capacity limits;
- memory limits;
- queue limits;
- payload buffering;
- TLS cost;
- protocol framing;
- backpressure.

Do not frame this as:

```text
Virtual threads vs Netty
```

Frame it as:

```text
Which execution model best fits this workload and operational complexity?
```

### 30.1 When virtual threads may be simpler

- typical HTTP request/response service;
- moderate concurrency;
- blocking JDBC/client libraries;
- simpler code is more valuable than maximum connection density;
- framework support is mature.

### 30.2 When Netty remains a strong fit

- very high connection count;
- custom TCP protocol;
- HTTP/2 multiplexing internals;
- gRPC transport;
- WebSocket gateway;
- low-level protocol bridge;
- backpressure-sensitive streaming;
- direct memory / zero-copy optimization;
- event-driven framework integration.

---

## 31. Production Sizing Mental Model

Netty sizing is not only thread count.

Think in budgets:

```text
connections
file descriptors
event-loop threads
business worker threads
business queue size
direct memory
heap memory
outbound buffer per channel
inbound frame size
max request size
max response size
TLS handshakes/sec
messages/sec
bytes/sec
flushes/sec
pending writes
```

A safe Netty server has bounded budgets at multiple layers.

Example:

```text
max connections: 20,000
worker event loops: 8
business executor: 64 threads
business queue: 5,000 tasks
max frame size: 1 MiB
high write watermark: 1 MiB/channel
low write watermark: 512 KiB/channel
idle timeout: 60s
request deadline: 5s
max pending requests/channel: 32
```

Every number should be linked to:

- expected traffic;
- memory budget;
- CPU budget;
- latency SLO;
- downstream capacity;
- failure behavior.

---

## 32. Backpressure Design Pattern

A production-grade Netty server should answer:

```text
What happens when input rate > processing rate?
```

Bad answer:

```text
We keep accepting and queueing everything.
```

Better answer:

```text
We bound every queue and apply backpressure or reject early.
```

Example backpressure chain:

```text
socket read
  -> frame decoder max frame size
  -> per-channel pending request limit
  -> bounded business queue
  -> deadline-aware rejection
  -> outbound writability check
  -> slow-client close policy
```

Potential policies:

```text
pause reads when queue high
reject request with overload response
close abusive connection
shed low-priority traffic
apply per-tenant/session limit
apply token bucket per client
```

---

## 33. Flush Strategy

Too many flushes:

```text
low latency per message
but high syscall overhead and poor batching
```

Too few flushes:

```text
better batching
but increased latency and possible stalls
```

Common strategy:

```text
write multiple messages
flush on readComplete
flush on batch size
flush on time threshold
flush before waiting for response
flush on channel close
```

Example:

```java
@Override
public void channelReadComplete(ChannelHandlerContext ctx) {
    ctx.flush();
}
```

This batches writes produced during one read loop.

But interactive protocols may need more aggressive flushing.

The correct answer depends on latency/throughput trade-off.

---

## 34. Handler State and Sharability

Handlers can be stateful or stateless.

A handler annotated as sharable must be safe for use across channels.

Bad sharable handler:

```java
@ChannelHandler.Sharable
public final class BadStatefulHandler extends ChannelInboundHandlerAdapter {
    private int requestCount; // shared across all channels, unsafe
}
```

Better:

```java
public final class PerChannelHandler extends ChannelInboundHandlerAdapter {
    private int requestCount; // one handler instance per channel
}
```

or use channel attributes:

```java
private static final AttributeKey<SessionState> SESSION = AttributeKey.valueOf("session");

ctx.channel().attr(SESSION).set(new SessionState());
```

Sharability is a concurrency contract.

---

## 35. Channel Attributes

Channel attributes let you attach per-channel state.

Examples:

- authenticated user/session;
- tenant id;
- correlation context;
- protocol version;
- pending request count;
- rate limiter;
- last heartbeat timestamp.

Use carefully:

```text
Attributes are convenient, but they can become hidden global-ish state attached to connections.
Clean them on channelInactive.
Avoid storing large objects.
Avoid storing request-scoped data as connection-scoped data unless intended.
```

---

## 36. Graceful Shutdown

A Netty server shutdown should not be:

```text
kill process immediately
```

Better lifecycle:

```text
1. stop accepting new connections
2. signal draining/readiness false
3. allow active requests/streams to complete until deadline
4. reject or close idle channels
5. flush pending writes
6. close channels
7. shutdown event loop groups gracefully
8. stop business executors
```

Conceptual code:

```java
bossGroup.shutdownGracefully();
workerGroup.shutdownGracefully();
businessExecutor.shutdown();
```

But production shutdown also needs Kubernetes/load balancer coordination:

```text
readiness probe false
preStop hook
connection draining period
terminationGracePeriodSeconds
LB deregistration delay
client retry/deadline behavior
```

---

## 37. Observability for Netty Systems

Minimum metrics:

```text
active connections
accepted connections/sec
closed connections/sec
connection duration
inbound bytes/sec
outbound bytes/sec
messages/sec
decode errors
encode errors
protocol errors
auth failures
pending outbound bytes
channel not-writable duration
business queue depth
business executor active threads
event-loop task queue delay
request latency
write latency
flush count
TLS handshake latency
idle timeout closes
reset/close causes
direct memory usage
ByteBuf leak detector warnings
```

Minimum logs:

```text
connection id
remote address
protocol version
authenticated principal/tenant if safe
correlation id
request id
frame/message type
close reason
exception classification
bytes in/out
latency
```

Tracing:

```text
connection-level traces are usually too expensive
request/message-level spans may be useful
sample carefully
propagate trace context in protocol metadata when appropriate
```

---

## 38. Thread Dump Reading

Netty thread names often reveal event loops.

Examples:

```text
nioEventLoopGroup-3-1
epollEventLoopGroup-4-2
grpc-default-worker-ELG-1-3
reactor-http-nio-4
```

Bad sign in thread dump:

```text
reactor-http-nio-3 waiting on JDBC
nioEventLoopGroup-2-1 blocked on FutureTask.get
epollEventLoopGroup-4-1 sleeping
```

Event-loop stack traces should usually show:

```text
select / epoll wait
runAllTasks
processSelectedKeys
channelRead
write/flush
```

They should not spend long time in:

```text
SQL driver
HTTP blocking client
file read
synchronized lock contention
JSON mega-serialization
sleep
Future.get
```

---

## 39. Production Failure Catalogue

### 39.1 Blocked event loop

Symptoms:

```text
all connections on some event-loop threads slow
p99/p999 latency spike
timeouts despite low CPU
WebFlux/gRPC/Netty stack traces show blocking calls
```

Likely causes:

```text
blocking database call in handler
blocking HTTP call in handler
large CPU-heavy encode/decode
lock contention
sync()/await() on event loop
```

Fix:

```text
remove blocking work from event loop
use bounded business executor
use non-blocking drivers
measure event-loop latency
add BlockHound-like detection in reactive stacks when appropriate
```

---

### 39.2 Direct memory leak

Symptoms:

```text
heap normal
RSS/direct memory grows
OutOfDirectMemoryError
Netty leak detector warnings
```

Likely causes:

```text
ByteBuf not released
retained slice never released
async handler uses buffer after auto-release
custom decoder leaks on exception path
```

Fix:

```text
enable advanced/paranoid leak detection in test/investigation
review ownership rules
prefer SimpleChannelInboundHandler for decoded non-refcounted messages
release in finally
avoid retaining buffers across async boundaries when possible
```

---

### 39.3 Slow client memory growth

Symptoms:

```text
pending outbound bytes grow
channel becomes non-writable
memory pressure
latency rises
```

Likely causes:

```text
producer ignores channel writability
unbounded outbound queue
large streaming response to slow client
no slow-client close policy
```

Fix:

```text
respect isWritable
set watermarks
pause producer
drop/reject/close slow clients
chunk large responses
monitor pending outbound bytes
```

---

### 39.4 Decoder memory attack

Symptoms:

```text
large frame causes memory pressure
malformed length prefix creates huge allocation
server OOM from few clients
```

Likely causes:

```text
no max frame length
custom decoder trusts length field
no auth before large payload
```

Fix:

```text
set max frame size
validate length before allocation
close protocol violators
apply rate limits
require auth before expensive payload
```

---

### 39.5 Too many flushes

Symptoms:

```text
high syscall rate
CPU overhead
poor throughput
small packet explosion
```

Likely causes:

```text
writeAndFlush for every tiny message
no batching
chatty protocol
```

Fix:

```text
batch writes
flush on readComplete or batch threshold
coalesce messages
measure latency trade-off
```

---

### 39.6 Unbounded executor offload

Symptoms:

```text
event loop no longer blocked
but process memory grows
business latency explodes
shutdown slow
queue depth huge
```

Likely causes:

```text
unbounded LinkedBlockingQueue
no rejection policy
no deadline awareness
```

Fix:

```text
bounded executor
deadline-aware rejection
backpressure to channel reads
per-dependency bulkhead
metrics
```

---

## 40. Design Example: Safe Length-Prefixed TCP Service

### 40.1 Protocol

```text
Frame:
  int32 length
  byte[length] payload

Payload:
  protobuf/JSON/CBOR message envelope

Envelope:
  protocolVersion
  messageType
  correlationId
  deadlineMillis
  payload
```

### 40.2 Pipeline

```java
public final class ServerInitializer extends ChannelInitializer<SocketChannel> {
    private final ExecutorService businessExecutor;

    public ServerInitializer(ExecutorService businessExecutor) {
        this.businessExecutor = businessExecutor;
    }

    @Override
    protected void initChannel(SocketChannel ch) {
        ChannelPipeline p = ch.pipeline();

        p.addLast("idle", new IdleStateHandler(60, 30, 0));
        p.addLast("frameDecoder", new LengthFieldBasedFrameDecoder(
            1024 * 1024, // max frame length
            0,           // length field offset
            4,           // length field length
            0,           // length adjustment
            4            // bytes to strip
        ));
        p.addLast("messageDecoder", new RequestDecoder());
        p.addLast("auth", new AuthenticationHandler());
        p.addLast("business", new BusinessDispatchHandler(businessExecutor));
        p.addLast("messageEncoder", new ResponseEncoder());
        p.addLast("frameEncoder", new LengthFieldPrepender(4));
        p.addLast("exception", new ExceptionMappingHandler());
    }
}
```

### 40.3 Safety properties

```text
LengthFieldBasedFrameDecoder:
  prevents unbounded frame memory.

IdleStateHandler:
  closes dead/idle connections.

AuthenticationHandler:
  prevents unauthenticated expensive requests.

BusinessDispatchHandler:
  offloads blocking work.

Bounded business executor:
  prevents unlimited task queue.

ResponseEncoder:
  centralizes wire compatibility.

ExceptionMappingHandler:
  classifies failure instead of blindly closing.
```

---

## 41. Bounded Business Executor Pattern

```java
public final class BoundedExecutors {
    public static ThreadPoolExecutor businessPool() {
        int threads = 64;
        int queueSize = 5_000;

        return new ThreadPoolExecutor(
            threads,
            threads,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(queueSize),
            new ThreadFactory() {
                private final AtomicInteger seq = new AtomicInteger();

                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "netty-business-" + seq.incrementAndGet());
                    t.setDaemon(false);
                    return t;
                }
            },
            new ThreadPoolExecutor.AbortPolicy()
        );
    }
}
```

In handler:

```java
try {
    businessExecutor.execute(task);
} catch (RejectedExecutionException rejected) {
    ctx.writeAndFlush(Response.overloaded())
       .addListener(f -> {
           if (!f.isSuccess()) {
               ctx.close();
           }
       });
}
```

Better still:

```text
reject based on remaining deadline
pause AutoRead when queue high
resume AutoRead when queue low
emit overload metrics
```

---

## 42. Netty Testing Strategy

Test categories:

```text
unit test decoder with ByteBuf inputs
unit test encoder output bytes
test fragmented frames
test multiple frames in one buffer
test malformed length
test oversized frame
test auth failure
test idle timeout
test slow consumer
leak detection test
test business executor rejection
test graceful close
test reconnect/client behavior
```

Use `EmbeddedChannel` for pipeline testing.

Conceptual test:

```java
EmbeddedChannel channel = new EmbeddedChannel(
    new LengthFieldBasedFrameDecoder(1024, 0, 4, 0, 4),
    new RequestDecoder()
);

ByteBuf input = Unpooled.buffer();
input.writeInt(payload.length);
input.writeBytes(payload);

assertTrue(channel.writeInbound(input));
Request request = channel.readInbound();
assertEquals(expected, request.id());
```

Enable leak detection in tests:

```bash
-Dio.netty.leakDetection.level=paranoid
```

---

## 43. Security Checklist for Netty Protocols

Minimum controls:

```text
max frame length
max header length
max metadata size
max string length
max nested object depth
max messages per second
max connection count
max unauthenticated requests
auth before expensive work
idle timeout
slow-client handling
TLS/mTLS where appropriate
certificate rotation
protocol version validation
input validation
safe logging
no secrets in protocol logs
no unbounded decompression
compression bomb protection
per-client/tenant rate limit
```

Netty gives you the primitives. It does not automatically secure your protocol design.

---

## 44. Choosing Netty vs Higher-Level Frameworks

Use Netty directly when:

- building a custom protocol;
- implementing a protocol gateway;
- building high-volume WebSocket/TCP service;
- needing precise control over buffers/backpressure;
- integrating low-level transport behavior;
- building reusable network infrastructure.

Prefer higher-level frameworks when:

- standard HTTP REST service is enough;
- team does not need low-level protocol control;
- maintainability is more important than low-level optimization;
- framework observability/security conventions are valuable;
- business delivery speed matters more than custom transport behavior.

The top 1% answer is not “always use Netty.”

The top 1% answer is:

```text
Use the lowest-level abstraction that is necessary, and no lower.
```

---

## 45. Practical Review Checklist

When reviewing Netty code, ask:

```text
Execution model:
  Which code runs on event loop?
  Any blocking call in handler?
  Any Future.get/join/sync/await in event loop?

Buffer lifecycle:
  Who owns each ByteBuf?
  Are retained buffers released?
  Are exception paths releasing buffers?
  Is leak detection enabled in tests?

Framing:
  Is max frame size enforced?
  Can fragmented input be parsed safely?
  Can multiple frames in one read be parsed safely?

Backpressure:
  Is channel writability respected?
  Is outbound queue bounded?
  Is business executor bounded?
  Can reads be paused?

Timeouts:
  Is idle timeout configured?
  Is request deadline enforced?
  Are slow clients closed?

Shutdown:
  Are channels drained?
  Are event-loop groups shutdown gracefully?
  Are business tasks cancelled or bounded?

Observability:
  Can we see active connections, pending writes, decode errors, event-loop delay, direct memory?

Security:
  Are payload sizes bounded?
  Is unauthenticated work limited?
  Are protocol errors classified?
```

---

## 46. Mini Case Study: “gRPC Timeout but Database Is Fine”

### Situation

A Java gRPC service starts returning `DEADLINE_EXCEEDED` during peak traffic.

Database metrics are normal.

CPU is only 45%.

No obvious GC pause.

### Observed facts

```text
p99 latency spikes every few minutes
grpc-default-worker event-loop threads appear in thread dump
one event-loop thread shows JSON serialization of large audit metadata
pending outbound bytes increase
clients retry after deadline
```

### Wrong conclusion

```text
The database is slow.
Increase deadline.
```

### Better analysis

The service is blocking or CPU-saturating Netty event-loop threads with large serialization work. Because gRPC Java uses Netty transport, delayed event loops delay multiple HTTP/2 streams. Clients hit deadlines, retry, and amplify load.

### Fix direction

```text
move large serialization off event loop
bound response size
stream large payloads instead of building one huge response
respect HTTP/2/gRPC flow control
add event-loop delay metrics
add pending outbound bytes metrics
set retry budget client-side
```

### Lesson

A gRPC timeout can be a Netty event-loop health problem, not a database problem.

---

## 47. Exercises

### Exercise 1 — Thread dump classification

Given a thread named:

```text
reactor-http-nio-5
```

and stack trace showing:

```text
java.sql.PreparedStatement.executeQuery
```

Answer:

1. What is likely wrong?
2. Why is this worse than blocking a normal request thread?
3. What remediation options exist?

---

### Exercise 2 — ByteBuf ownership

Given this handler:

```java
@Override
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    ByteBuf buf = (ByteBuf) msg;
    if (isValid(buf)) {
        ctx.fireChannelRead(buf);
    }
}
```

Questions:

1. What happens when `isValid(buf)` returns `false`?
2. Is there a leak?
3. How would you fix it?

---

### Exercise 3 — Slow consumer

A WebSocket gateway sends live updates to 10,000 clients. Some clients are on poor networks. Memory grows slowly until the pod is killed.

Design:

1. outbound queue policy;
2. channel writability handling;
3. slow-client close policy;
4. metrics;
5. client reconnect behavior.

---

### Exercise 4 — Custom protocol decoder

Design a decoder for:

```text
magic: 2 bytes
version: 1 byte
flags: 1 byte
length: 4 bytes
payload: length bytes
crc32: 4 bytes
```

Include:

- max length;
- partial frame handling;
- bad magic handling;
- checksum failure behavior;
- compatibility strategy.

---

### Exercise 5 — Direct memory incident

A service shows:

```text
Heap: stable at 2 GB
RSS: growing to 8 GB
Logs: LEAK: ByteBuf.release() was not called
```

Create an investigation plan:

- JVM flags;
- code review targets;
- pipeline handlers to inspect;
- test strategy;
- fix verification.

---

## 48. Key Takeaways

1. Netty is an asynchronous event-driven network framework, but the deeper model is event-loop ownership of many channels.
2. Event-loop threads must not block.
3. Pipelines are protocol state machines.
4. `ByteBuf` gives performance and control but requires correct ownership.
5. Reference counting mistakes become direct-memory leaks or early-release bugs.
6. `write()` is not the same as bytes sent.
7. Backpressure requires application cooperation.
8. Native transports and zero-copy can help, but only when workload and environment fit.
9. gRPC Java and Reactor Netty expose Netty failure modes even when Netty is hidden.
10. Virtual threads simplify many blocking workloads, but they do not eliminate the need for Netty in event-driven high-connection protocol systems.
11. A production Netty system needs budgets, metrics, lifecycle discipline, and failure classification.

---

## 49. References

- Netty, “User guide for 4.x.” https://netty.io/wiki/user-guide-for-4.x.html
- Netty, “Reference counted objects.” https://netty.io/wiki/reference-counted-objects.html
- Netty API, `ChannelPipeline`. https://netty.io/4.1/api/io/netty/channel/ChannelPipeline.html
- Netty API, `ChannelFuture`. https://netty.io/4.1/api/io/netty/channel/ChannelFuture.html
- Netty, “Native transports.” https://netty.io/wiki/native-transports.html
- Netty API, `FileRegion`. https://netty.io/4.0/api/io/netty/channel/FileRegion.html
- gRPC Java GitHub README. https://github.com/grpc/grpc-java
- gRPC Java Javadocs, `io.grpc.netty`. https://grpc.github.io/grpc-java/javadoc/io/grpc/netty/package-summary.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 24 — gRPC Streaming and Backpressure: Designing High-Volume Bidirectional Systems](./024-grpc-streaming-and-backpressure-designing-high-volume-bidirectional-systems.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 26 — Reactive, Async, Virtual Threads, and Blocking I/O: Choosing the Right Concurrency Model](./026-reactive-async-virtual-threads-blocking-io-choosing-right-concurrency-model.md)

</div>