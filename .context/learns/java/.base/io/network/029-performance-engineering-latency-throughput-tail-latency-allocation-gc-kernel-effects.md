# Part 29 — Performance Engineering: Latency, Throughput, Tail Latency, Allocation, GC, and Kernel Effects

> Series: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `029-performance-engineering-latency-throughput-tail-latency-allocation-gc-kernel-effects.md`  
> Scope: Java 8–25, HTTP/1.1, HTTP/2, gRPC, Netty, JDK `HttpClient`, blocking I/O, async I/O, reactive/event-loop runtimes, virtual threads, production distributed systems.

---

## 0. Why this part matters

Most engineers can make a Java service pass functional tests.
Fewer can make it survive realistic load.
Even fewer can explain **why p99 latency exploded while average CPU looked fine**.

Performance engineering for networked Java systems is not about memorizing JVM flags or choosing a faster JSON library. It is about understanding the full path:

```text
caller workload
  -> client concurrency
  -> queueing
  -> connection pool / HTTP2 stream capacity / gRPC channel
  -> DNS / connect / TLS
  -> serialization
  -> kernel socket buffers
  -> remote service queue
  -> remote dependency
  -> response body handling
  -> allocation / GC / scheduler / context switching
  -> observability and measurement accuracy
```

The key shift:

```text
Performance is not a single number.
Performance is a shape under load.
```

A top-tier Java network engineer does not ask only:

```text
How fast is it?
```

They ask:

```text
At what concurrency?
With what payload?
With what connection reuse?
With what timeout?
With what retry policy?
With what downstream capacity?
With what GC behavior?
With what p99 and p999?
With what measurement method?
Under what failure mode?
```

---

## 1. Learning objectives

After this part, you should be able to:

1. Distinguish latency, throughput, concurrency, saturation, utilization, queueing, and capacity.
2. Explain why average latency is often misleading.
3. Interpret p50, p95, p99, p999, max, and histogram data.
4. Recognize coordinated omission and why it hides real tail latency.
5. Design realistic Java HTTP/gRPC benchmarks.
6. Explain how allocation, GC, JIT warmup, kernel buffers, TLS, compression, and serialization affect network performance.
7. Diagnose whether performance degradation comes from client, pool, network, proxy, server, database, GC, CPU, or measurement error.
8. Choose performance strategies for Java 8–25, including virtual threads and event-loop runtimes.
9. Build a production checklist for performance-sensitive Java network clients/services.

---

## 2. The wrong mental model

A common weak mental model:

```text
The service is slow because the code is slow.
```

Sometimes true.
Often false.

In networked systems, a service can be slow because:

```text
DNS resolution is slow
TCP connect is slow
TLS handshake is expensive
connection pool is saturated
HTTP/2 concurrent stream limit is reached
request body is buffered too eagerly
response body is not consumed
remote service queue is saturated
retry multiplies load
GC pauses increase tail latency
CPU throttling creates scheduler delay
kernel socket buffers fill up
proxy buffers response
load balancer closes idle connections
client benchmark hides coordinated omission
```

Performance is usually an emergent property of many queues.

---

## 3. The core performance vocabulary

### 3.1 Latency

Latency is the time taken for one operation.

For a network call:

```text
latency = time from attempt start to attempt completion/failure
```

But this hides sub-phases:

```text
queue waiting
DNS resolution
connection pool acquisition
TCP connect
TLS handshake
request serialization
request write
server queue
server processing
server dependency calls
response first byte
response body download
deserialization
post-processing
```

A good latency measurement answers:

```text
Which phase consumed the time?
```

---

### 3.2 Throughput

Throughput is completed work per unit time.

Examples:

```text
requests/sec
messages/sec
bytes/sec
RPC/sec
files/minute
```

Throughput alone is dangerous.

A system may achieve high throughput by allowing latency to explode:

```text
Throughput: 10,000 req/s
p50: 20 ms
p99: 9 seconds
```

That is not healthy for interactive or deadline-bound workflows.

---

### 3.3 Concurrency

Concurrency is the number of in-flight operations.

Approximate relationship:

```text
concurrency ~= throughput * latency
```

This is Little's Law in practical form.

Example:

```text
throughput = 1,000 req/s
average latency = 200 ms = 0.2 s
in-flight concurrency ~= 1,000 * 0.2 = 200
```

If latency increases while throughput remains the same, concurrency rises.
This means more memory, more threads/virtual threads/tasks, more pending futures, more open streams, and more pressure on pools.

---

### 3.4 Utilization

Utilization is how busy a resource is.

Examples:

```text
CPU utilization
connection pool utilization
HTTP/2 stream utilization
thread pool utilization
event-loop utilization
DB connection utilization
network bandwidth utilization
```

High utilization often increases queueing delay non-linearly.

At low utilization, adding work may have little effect.
Near saturation, tiny increases in load can cause massive latency spikes.

---

### 3.5 Saturation

Saturation means demand exceeds available capacity.

Symptoms:

```text
queue length grows
pool acquisition timeout increases
p99/p999 latency jumps
timeouts increase
retry volume increases
CPU run queue grows
GC pressure increases
server returns 429/503
client receives DEADLINE_EXCEEDED / UNAVAILABLE
```

A saturated system is not just “busy”; it is unstable unless it sheds load or applies backpressure.

---

## 4. Average latency is not enough

Average latency compresses reality into one number.

Example:

```text
Request latencies:
10 ms, 10 ms, 10 ms, 10 ms, 10 ms, 10 ms, 10 ms, 10 ms, 10 ms, 10,000 ms
```

Average:

```text
(9 * 10 + 10000) / 10 = 1009 ms
```

But 90% of users saw 10 ms and 10% saw 10 seconds.

Another example:

```text
System A average: 100 ms
System B average: 100 ms
```

They may be very different:

```text
System A: stable around 90–110 ms
System B: most requests 10 ms, some requests 10 seconds
```

For networked systems, tail latency often matters more than average.

---

## 5. Percentiles and histograms

### 5.1 Percentile intuition

```text
p50  = 50% of requests completed at or below this value
p95  = 95% of requests completed at or below this value
p99  = 99% of requests completed at or below this value
p999 = 99.9% of requests completed at or below this value
```

If p99 is 2 seconds, then 1 out of 100 requests is slower than 2 seconds.

At scale, this matters:

```text
1,000,000 requests/day
1% slow = 10,000 slow requests/day
0.1% slow = 1,000 slow requests/day
```

---

### 5.2 Why p99 matters in composed systems

Suppose one user journey calls 10 services sequentially.

If each service has 99% chance of being fast:

```text
probability all 10 are fast = 0.99^10 = 0.904
```

So roughly 9.6% of journeys encounter at least one tail event.

This is why local p99 becomes user-visible much more often in distributed systems.

---

### 5.3 Histograms beat averages

Use histograms for latency because they preserve distribution shape.

A useful histogram shows:

```text
how many requests completed <= 5 ms
how many <= 10 ms
how many <= 25 ms
how many <= 50 ms
how many <= 100 ms
how many <= 250 ms
how many <= 500 ms
how many <= 1 s
how many <= 2.5 s
how many <= 5 s
how many <= 10 s
how many > 10 s
```

For networked Java systems, fixed buckets should reflect SLO boundaries and timeout boundaries.

Example:

```text
SLO: p99 < 800 ms
request timeout: 2 s
retry deadline: 3 s
```

Then buckets should give clarity around:

```text
100 ms, 250 ms, 500 ms, 800 ms, 1 s, 2 s, 3 s, 5 s
```

---

## 6. Coordinated omission

Coordinated omission happens when the load generator unintentionally stops sending requests while the system is slow, thereby failing to measure the latency that real users would have experienced.

Bad test pattern:

```text
send request
wait for response
send next request
wait for response
send next request
```

If the service freezes for 5 seconds, this client sends no requests during the freeze.
Then the test records only one slow request instead of many delayed arrivals.

Better pattern:

```text
send requests according to a schedule
record latency from scheduled start time, not only actual send time
```

Why this matters:

```text
A benchmark can report excellent p99 while real users suffer.
```

Top-tier rule:

```text
Closed-loop load tests measure client behavior.
Open-loop or arrival-rate tests measure service behavior under demand.
```

Closed-loop tests are still useful, but you must know what they measure.

---

## 7. Performance model for one outbound Java HTTP/gRPC call

A network call has several possible time components:

```text
T_total = T_queue_client
        + T_pool_acquire
        + T_dns
        + T_tcp_connect
        + T_tls
        + T_request_encode
        + T_request_write
        + T_remote_queue
        + T_remote_compute
        + T_remote_dependencies
        + T_first_byte
        + T_response_read
        + T_response_decode
        + T_postprocess
```

For reused connections:

```text
T_dns + T_tcp_connect + T_tls may be near zero per request
```

For a cold connection or stale pool:

```text
T_dns + T_tcp_connect + T_tls can dominate
```

For large payload:

```text
T_request_write + T_response_read + T_encode/decode can dominate
```

For saturated remote service:

```text
T_remote_queue dominates
```

For saturated local pool:

```text
T_pool_acquire dominates
```

For poor benchmark methodology:

```text
T_total may be incorrectly measured
```

---

## 8. Queueing: the hidden source of tail latency

Most performance incidents are queueing incidents.

Queues exist at many layers:

```text
application request queue
executor queue
virtual thread scheduler queue
connection pool pending queue
HTTP/2 stream pending queue
Netty event-loop tasks
kernel accept queue
kernel socket send buffer
kernel socket receive buffer
proxy queue
load balancer queue
server thread pool queue
database pool queue
message broker queue
GC pending allocation pressure
CPU run queue
```

Queues are not free.
They trade immediate rejection for delayed failure.

A queue is useful when it absorbs short bursts.
A queue is harmful when it hides sustained overload.

Top-tier rule:

```text
Every queue needs a bound, timeout, owner, metric, and overload behavior.
```

---

## 9. Capacity thinking: the bottleneck moves

Improving one layer may expose another bottleneck.

Example:

```text
Before:
HTTP client max connections = 20
remote service can handle 200 concurrent requests
```

Bottleneck: client pool.

After changing:

```text
HTTP client max connections = 200
remote DB pool = 30
```

New bottleneck: remote DB pool.

After adding DB pool:

```text
DB CPU saturates
```

New bottleneck: database CPU.

Performance work is not just making one component faster.
It is moving, exposing, and controlling bottlenecks.

---

## 10. Java-specific performance factors

### 10.1 JIT warmup

The JVM does not run all code at final optimized speed from process start.

There is:

```text
class loading
bytecode interpretation
profiling
C1 compilation
C2 compilation
deoptimization
recompilation
inline cache behavior
branch profile stabilization
```

Benchmark implication:

```text
Cold-start latency and steady-state latency are different metrics.
```

For long-running backend services, steady-state matters.
For serverless/batch/CLI tools, cold-start matters.

---

### 10.2 Allocation rate

Allocation is often the bridge between application code and GC pressure.

Network-heavy Java applications allocate in:

```text
request DTOs
response DTOs
JSON parser tokens
byte arrays
String creation
header maps
logging parameters
exception stack traces
CompletableFuture chains
reactive operators
Netty buffers if misused
protobuf builders
compression buffers
```

High allocation may not show as CPU bottleneck immediately.
It may show as:

```text
more frequent young GC
larger live set
promotion pressure
old generation growth
longer GC pauses
increased p99/p999 latency
```

---

### 10.3 GC and tail latency

GC does not need to cause long stop-the-world pauses to affect performance.

It can affect:

```text
allocation stalls
CPU competition
cache locality
memory bandwidth
object promotion
reference processing
finalizer/cleaner behavior
direct buffer cleanup
```

For network systems, GC often appears as tail latency spikes.

A useful diagnostic question:

```text
Do latency spikes align with GC events, allocation spikes, or heap occupancy changes?
```

---

### 10.4 Direct memory

Network runtimes often use direct memory because it can reduce copying between Java heap and native I/O operations.

Common users:

```text
Netty ByteBuf direct buffers
NIO direct ByteBuffer
TLS engine buffers
compression libraries
file transfer paths
```

Direct memory is outside normal Java heap, but it still belongs to process memory.

Failure symptoms:

```text
OutOfMemoryError: Direct buffer memory
container OOM kill
increasing RSS while heap looks stable
Netty leak detector warnings
```

Top-tier rule:

```text
Heap metrics are not process memory metrics.
```

Always observe:

```text
heap
non-heap
direct memory
metaspace
thread stacks
native memory
container memory limit
RSS
```

---

### 10.5 Exceptions as performance cost

Exceptions are expensive when used for expected control flow.

Costs include:

```text
object allocation
stack trace capture
log volume
lock/contention in logging backend
I/O pressure
observability cardinality
```

For high-volume network paths:

```text
Do not throw stack-heavy exceptions for normal 404/409/429 mapping.
Do not log full stack trace for every timeout during known dependency outage.
Do not convert every gRPC status into a unique exception type with huge context.
```

Use structured outcome models when errors are expected.

---

## 11. Kernel and OS effects

### 11.1 Context switching

Context switching occurs when CPU changes from one runnable thread/task to another.

Heavy context switching can come from:

```text
too many platform threads
oversized thread pools
blocking in event loops
high lock contention
logging contention
CPU throttling
container limits
```

Virtual threads reduce the cost of blocking waits but do not eliminate CPU scheduling constraints.
CPU-bound work still needs CPU.

---

### 11.2 Syscalls

Network operations eventually use kernel syscalls.

Examples:

```text
connect
accept
read
write
sendfile
epoll_wait
kevent
close
```

Performance impact:

```text
many tiny writes -> more syscalls
write without batching -> overhead
flush per message -> poor throughput
small TCP packets -> overhead
```

Netty and HTTP clients often optimize by batching writes/flushes.

---

### 11.3 Socket buffers

TCP has send and receive buffers.

If receiver is slow:

```text
receiver application does not read
receiver kernel receive buffer fills
tcp window shrinks
sender kernel send buffer fills
sender write blocks or async write becomes non-writable
```

At application level this appears as:

```text
slow write
blocked flush
Netty channel not writable
backpressure signal
large pending outbound bytes
```

---

### 11.4 Ephemeral ports

Outbound TCP connections use local ephemeral ports.

If an application creates too many short-lived connections, it may exhaust ephemeral ports or accumulate `TIME_WAIT` sockets.

Symptoms:

```text
connect failures
Cannot assign requested address
high TIME_WAIT count
latency spikes due to connection churn
```

Mitigation:

```text
connection reuse
pooling
HTTP/2 multiplexing
gRPC channel reuse
avoid per-request client construction
avoid disabling keep-alive blindly
```

---

## 12. Protocol-level performance factors

### 12.1 HTTP/1.1

Performance characteristics:

```text
one in-flight response per connection unless pipelining, which is rarely used
connection pool size directly limits concurrency
head-of-line blocking per connection
keep-alive reduces connection setup cost
chunked response supports streaming
large response can occupy connection for long time
```

Tuning focus:

```text
max connections per route
idle timeout
connection TTL
response body consumption
pool acquisition timeout
large payload isolation
```

---

### 12.2 HTTP/2

Performance characteristics:

```text
many streams over one connection
lower connection count
stream multiplexing
header compression
flow control
max concurrent streams
TCP-level head-of-line still possible
```

Tuning focus:

```text
max concurrent streams
connection-level flow control
stream-level flow control
large stream interference
GOAWAY behavior
proxy support
load balancing with long-lived connections
```

---

### 12.3 gRPC

Performance characteristics:

```text
HTTP/2 based
binary protobuf payload
long-lived channel
multiplexed streams
metadata/trailers
streaming support
flow control
channel/subchannel state
```

Tuning focus:

```text
channel reuse
stream concurrency
message size
compression
deadline
keepalive
manual flow control for streaming
load balancing policy
name resolution
```

---

### 12.4 TLS

TLS performance cost appears in:

```text
handshake latency
CPU cost
certificate validation
ALPN negotiation
session resumption
mTLS client certificate handling
```

Connection reuse matters because it amortizes TLS handshake cost.

Bad pattern:

```text
create new HTTPS connection per request
```

Better pattern:

```text
reuse client and connections
use pool/channel lifecycle intentionally
```

---

### 12.5 Compression

Compression trades CPU for bandwidth.

Useful when:

```text
payload is large
payload compresses well
network bandwidth is constrained
latency saved by fewer bytes > CPU cost
```

Harmful when:

```text
payload is small
payload is already compressed/encrypted/random
CPU is bottleneck
compression delays streaming chunks
```

Measure before enabling globally.

---

## 13. Serialization performance

Serialization cost includes:

```text
encode CPU
decode CPU
allocation
payload size
schema evolution overhead
validation
canonicalization
string handling
numeric conversion
```

### JSON

Strengths:

```text
human-readable
ubiquitous
browser/native API fit
flexible
```

Costs:

```text
text parsing
large object allocation
String creation
number/date ambiguity
larger payload
```

### Protobuf

Strengths:

```text
compact binary
schema-driven
fast for many RPC shapes
good gRPC integration
unknown field compatibility
```

Costs:

```text
less human-readable
schema discipline required
field number permanence
conversion layer needed
```

### XML

Strengths:

```text
legacy enterprise compatibility
schema/canonicalization/signature ecosystems
```

Costs:

```text
verbose
parser complexity
security risks if parser is unsafe
namespace complexity
```

Top-tier rule:

```text
Serialization choice is not only speed. It is speed + evolvability + tooling + security + debugging + compatibility.
```

---

## 14. Benchmarking levels

### 14.1 Microbenchmark

Measures a small unit:

```text
JSON parsing method
Protobuf encode/decode
header normalization
idempotency key hashing
ByteBuffer copy routine
```

Use JMH for JVM microbenchmarks because it handles many JVM benchmarking pitfalls such as warmup, forks, and dead-code elimination protection.

Microbenchmark limits:

```text
may not represent full application profile
may overfit JIT behavior
may ignore allocation interactions
may ignore network/kernel/proxy effects
```

---

### 14.2 Component benchmark

Measures a component in isolation:

```text
HTTP client wrapper against local mock server
Netty protocol codec
serialization + compression pipeline
gRPC client/server pair on loopback
```

Useful for:

```text
regression detection
relative comparison
local bottleneck discovery
```

Limits:

```text
loopback is not real network
mock server may not model remote behavior
no realistic proxy/LB/DNS/TLS chain
```

---

### 14.3 Integration benchmark

Measures several real components:

```text
client -> gateway -> service -> database
client -> service mesh -> gRPC service
batch worker -> external API simulator
```

Useful for:

```text
pool sizing
timeout tuning
retry behavior
proxy/LB interactions
capacity envelope
```

---

### 14.4 Load test

Measures behavior under controlled load.

Key dimensions:

```text
arrival rate
concurrency
payload distribution
data cardinality
think time
connection reuse
TLS mode
failure injection
ramp-up/ramp-down
steady-state duration
```

---

### 14.5 Stress test

Pushes beyond expected capacity.

Goal:

```text
Find breaking point and overload behavior.
```

Questions:

```text
Does the system shed load?
Do queues grow unbounded?
Does p99 explode before throughput plateaus?
Do retries amplify load?
Does recovery happen after load drops?
```

---

### 14.6 Soak test

Runs for a long time.

Goal:

```text
Find leaks, fragmentation, slow memory growth, stale connections, DNS drift, token refresh bugs, file descriptor leaks.
```

Network systems often pass short load tests but fail soak tests.

---

### 14.7 Chaos/fault test

Injects failure:

```text
latency
packet loss
connection reset
DNS failure
TLS failure
HTTP 429
HTTP 503
gRPC UNAVAILABLE
slow response body
half-open connection
proxy idle close
```

Goal:

```text
Validate resilience and observability.
```

---

## 15. Designing a realistic Java network benchmark

A useful benchmark specifies:

```text
protocol: HTTP/1.1, HTTP/2, gRPC
client library: JDK HttpClient, Apache, OkHttp, Netty, gRPC Java
JDK version
GC
heap and container limits
TLS on/off
connection reuse mode
payload size distribution
request mix
arrival rate
concurrency limit
retry policy
timeout/deadline
server behavior
proxy/LB path
metrics collected
warmup duration
steady-state duration
failure injection
success criteria
```

Bad benchmark:

```text
Run 100 requests locally and compare average latency.
```

Better benchmark:

```text
Run 15 min warmup + 30 min steady-state.
Use realistic payload distribution.
Use TLS and connection reuse.
Measure p50/p95/p99/p999.
Measure allocation, GC, CPU, pool usage, errors, retries.
Inject 1% slow responses.
Validate deadline behavior.
```

---

## 16. The performance budget model

For a user journey with 1 second SLO:

```text
frontend/network: 100 ms
API gateway: 50 ms
service A: 250 ms
service B: 250 ms
database: 200 ms
buffer: 150 ms
```

For service A calling three dependencies:

```text
service A total budget: 250 ms
local processing: 30 ms
outbound dep 1: 80 ms
outbound dep 2: 80 ms
outbound dep 3: 40 ms
margin: 20 ms
```

This implies:

```text
request timeout cannot be 30 seconds
retry cannot blindly add 3 attempts
pool acquisition cannot wait forever
queue cannot be unbounded
```

Performance budget and timeout engineering are the same design conversation.

---

## 17. Tail latency amplification patterns

### 17.1 Fan-out

If one request calls many downstream services in parallel:

```text
latency = max(child latencies) + aggregation cost
```

The slowest child dominates.

If any child has bad tail latency, parent p99 gets worse.

---

### 17.2 Sequential dependency chain

If one request calls services sequentially:

```text
latency = sum(child latencies)
```

Small delays accumulate.

---

### 17.3 Retry amplification

If each layer retries:

```text
client retry 3x
gateway retry 2x
service retry 3x
```

Possible attempts:

```text
3 * 2 * 3 = 18
```

This can turn a partial outage into a full outage.

---

### 17.4 Queue amplification

A request may wait in multiple queues:

```text
client executor queue
connection pool queue
gateway queue
server worker queue
DB pool queue
```

Each queue may look “acceptable” alone.
Together they exceed deadline.

---

## 18. Virtual threads and network performance

Virtual threads make blocking I/O more scalable from the Java thread-management perspective.
They are excellent for code that spends most time waiting for I/O.

But they do not remove these limits:

```text
remote service capacity
connection pool size
HTTP/2 max concurrent streams
DB pool size
memory per in-flight request
payload buffering
rate limits
CPU for serialization/compression/TLS
kernel socket buffers
bandwidth
```

Bad virtual-thread design:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : millionRequests) {
        executor.submit(() -> httpClient.send(buildRequest(r), BodyHandlers.ofString()));
    }
}
```

Problem:

```text
Virtual threads are cheap, but one million in-flight network attempts are not.
```

Better design:

```text
virtual threads + explicit concurrency limit + deadline + bounded queue + per-dependency bulkhead
```

Example skeleton:

```java
Semaphore bulkhead = new Semaphore(200);

<T> T callWithBulkhead(Callable<T> task) throws Exception {
    if (!bulkhead.tryAcquire(50, TimeUnit.MILLISECONDS)) {
        throw new RejectedExecutionException("dependency bulkhead saturated");
    }
    try {
        return task.call();
    } finally {
        bulkhead.release();
    }
}
```

---

## 19. Event-loop performance rules

Event-loop runtimes like Netty rely on a small number of threads doing many I/O tasks.

The main rule:

```text
Never block the event loop.
```

Do not do this inside event-loop handler:

```text
blocking DB call
blocking HTTP call
large JSON processing
expensive compression
file I/O
sleep
lock waiting
synchronous logging under pressure
```

If CPU/blocking work is required:

```text
offload to bounded worker pool
preserve backpressure
propagate cancellation/deadline
avoid unbounded handoff queue
```

Event-loop metrics to observe:

```text
event-loop pending tasks
event-loop execution delay
channel writability
outbound buffer size
ByteBuf leaks
direct memory usage
```

---

## 20. Allocation optimization without premature optimization

Top-tier engineers do not optimize every allocation blindly.
They first identify hot allocation paths.

Good process:

```text
measure allocation rate
identify top allocating methods
classify allocation as essential/accidental
reduce accidental allocation in hot path
re-test latency distribution and GC behavior
```

Common accidental allocations:

```text
creating new HTTP client per request
creating ObjectMapper per request
creating SSLContext per request
copying byte arrays repeatedly
converting byte[] -> String -> byte[]
logging huge payloads
building full response in memory when streaming would do
throwing exceptions for expected branch
using regex in hot path unnecessarily
```

High-value improvements:

```text
reuse clients
reuse mappers
stream large bodies
avoid full buffering
use protobuf for internal high-volume RPC
use bounded buffers
avoid unnecessary copies
avoid high-cardinality logging
```

---

## 21. Large payload performance

Large payloads change the performance model.

Small request model:

```text
latency dominated by network round trip and remote processing
```

Large payload model:

```text
latency dominated by bytes transferred, buffering, disk I/O, checksum, compression, parsing, memory pressure
```

Rules:

```text
stream instead of full buffering
separate large payload client pool
use range/resume when possible
use checksum/hash for integrity
apply content length limits
avoid logging bodies
protect slow consumer path
measure bytes/sec, not only req/sec
```

---

## 22. CPU profiling vs latency profiling

CPU profiling answers:

```text
Where is CPU time spent?
```

Latency profiling answers:

```text
Where is wall-clock time spent?
```

Network calls often spend wall-clock time waiting, not CPU.

A CPU profile may show nothing suspicious while p99 is terrible.

You need:

```text
CPU profile
allocation profile
GC logs
thread dump
async profiler / JFR
client metrics
server metrics
trace spans
pool metrics
kernel/network metrics
```

---

## 23. Java Flight Recorder and production diagnostics

JFR is useful because it captures low-overhead runtime events such as:

```text
CPU samples
allocation events
GC events
thread park/block/sleep
socket read/write
file I/O
TLS/security events depending on version/configuration
exceptions
monitor contention
virtual thread events in modern JDKs
```

For network performance, correlate:

```text
latency spike timestamp
GC event
allocation spike
thread park/block
socket read latency
CPU saturation
container throttling
connection pool pending queue
remote service errors
```

---

## 24. Performance metrics for Java network clients

Every important outbound dependency should expose:

```text
request count by method/endpoint/dependency/status/outcome
latency histogram
error count by exception/status
retry count
hedged request count
timeout count
deadline exceeded count
pool leased/idle/pending/max
pool acquisition latency
connection creation count
connection close count
TLS handshake failure count
DNS resolution failure/latency if available
payload size histogram
response body read duration
in-flight request gauge
bulkhead usage
rate limiter allowed/rejected
circuit breaker state
```

Avoid labels that explode cardinality:

```text
raw URL with IDs
user ID
case ID
full exception message with dynamic values
full query string
raw host if unbounded
```

Use route templates:

```text
/applications/{id}/approval
/cases/{caseId}/documents/{documentId}
```

Not:

```text
/applications/12345/approval
/cases/998877/documents/556677
```

---

## 25. Performance metrics for Java servers

Every inbound service should expose:

```text
request rate
latency histogram
active requests
queue depth
rejected requests
status code distribution
error category
payload size
response size
thread pool active/queue/rejection
virtual thread count / pinned events if relevant
event-loop delay if Netty/reactive
gRPC method latency and status
HTTP/2 stream concurrency
GC pause/allocation/heap/direct memory
CPU utilization and throttling
DB pool metrics
outbound dependency metrics
```

Server latency without outbound dependency metrics is incomplete.

---

## 26. Performance anti-patterns

### 26.1 Creating client per request

Bad:

```java
HttpClient client = HttpClient.newHttpClient();
client.send(request, BodyHandlers.ofString());
```

Why bad:

```text
poor connection reuse
uncontrolled resource lifecycle
more TLS handshakes
more connection churn
harder observability
```

Better:

```text
one shared client per configuration/dependency
explicit lifecycle
instrumented wrapper
```

---

### 26.2 Unbounded concurrency

Bad:

```text
submit all jobs at once
let futures accumulate
let virtual threads grow without dependency budget
```

Better:

```text
bounded concurrency per dependency
bounded queue
deadline
load shedding
```

---

### 26.3 Average-only dashboards

Bad dashboard:

```text
average latency
request count
CPU average
```

Better dashboard:

```text
p50/p95/p99/p999
error rate
timeout rate
retry rate
pool pending
in-flight
queue depth
GC allocation and pause
CPU throttling
remote dependency status
```

---

### 26.4 Benchmarking only localhost

Localhost removes many real costs:

```text
network RTT
packet loss
TLS path complexity
proxy behavior
load balancer idle timeout
DNS behavior
remote queueing
bandwidth limits
```

Localhost is fine for component tests, not final capacity claims.

---

### 26.5 Ignoring response body consumption

If a client does not consume or close the response body, the connection may not be reusable.

Symptoms:

```text
pool exhaustion
connection leak
increasing pending acquisition
low throughput
high connection churn
```

---

### 26.6 Retrying large non-replayable bodies

Retries require replayability.

Danger:

```text
streaming upload partially sent
server may have processed partial/complete body
client retries without idempotency key
side effect duplicates
```

---

## 27. Performance diagnosis playbook

When p99 latency increases, do not guess. Partition the problem.

### Step 1: Is it local or remote?

Check:

```text
client-side pool acquisition time
connect/TLS time
server-side processing time
trace spans
proxy/gateway logs
```

### Step 2: Is throughput up or latency up?

Cases:

```text
throughput up + latency up = capacity/saturation issue likely
throughput flat + latency up = dependency/queue/GC/network issue likely
throughput down + error up = outage/rejection likely
```

### Step 3: Is there queueing?

Check:

```text
pool pending
executor queue
event-loop delay
DB pool pending
server active requests
load balancer target response time
```

### Step 4: Are retries amplifying load?

Check:

```text
attempts per logical request
retry count by status/exception
retry delay distribution
deadline exceeded after retries
```

### Step 5: Is GC involved?

Check:

```text
GC pause timestamps
allocation rate
heap occupancy
promotion rate
direct memory
container memory
```

### Step 6: Is CPU truly available?

Check:

```text
CPU utilization
container CPU throttling
run queue
context switches
event-loop delay
thread dumps
```

### Step 7: Is the network path changing?

Check:

```text
DNS changes
LB target health
proxy logs
TLS certificate/handshake failures
connection reset count
HTTP/2 GOAWAY/RST_STREAM
gRPC UNAVAILABLE
```

### Step 8: Is the measurement lying?

Check:

```text
closed-loop load generator?
coordinated omission?
wrong percentile aggregation?
client saturation?
observer overhead?
logging overhead?
```

---

## 28. Case study: p99 jumps after enabling retry

### Context

A Java service calls external API.

Before retry:

```text
p50 = 80 ms
p95 = 250 ms
p99 = 700 ms
error rate = 0.5%
```

After retry 3x:

```text
p50 = 90 ms
p95 = 900 ms
p99 = 4 s
error rate = 0.2%
```

Superficial conclusion:

```text
Retry improved reliability because error rate dropped.
```

Better analysis:

```text
Retry reduced visible errors but increased tail latency.
Each failed attempt consumed deadline and pool capacity.
During external slowness, retries increased load.
Some successful responses arrived too late for user journey.
```

Better design:

```text
retry only idempotent operations
use retry budget
use deadline-aware retry
use backoff+jitter
respect Retry-After
cap attempts by remaining deadline
observe attempts per logical request
```

---

## 29. Case study: virtual threads make throughput worse

### Context

Service migrates from fixed thread pool to virtual thread per request.

Before:

```text
max worker threads = 200
outbound pool max = 100
```

After:

```text
virtual thread per request
no explicit outbound concurrency limit
```

Result:

```text
more in-flight outbound requests
remote dependency saturates
latency increases
retry increases
memory increases
p99 worsens
```

Lesson:

```text
Virtual threads remove one bottleneck, then expose the next bottleneck.
```

Fix:

```text
keep virtual threads
add per-dependency semaphore
set deadlines
bound queues
reduce retry amplification
observe dependency saturation
```

---

## 30. Case study: HTTP/2 improves average but worsens p999

### Context

Client moves from HTTP/1.1 pool of 50 connections to HTTP/2 single connection.

Improvement:

```text
fewer TLS handshakes
better connection reuse
lower average latency
```

Problem:

```text
one large streaming response consumes connection-level flow-control window
small requests experience tail latency spikes
single connection receives GOAWAY
many streams affected
```

Better design:

```text
separate large streaming traffic
use multiple channels/connections if library supports it
observe HTTP/2 stream concurrency and flow-control stalls
set max inbound message/body size
use deadline and cancellation
```

---

## 31. Case study: benchmark says fast, production says slow

### Context

Benchmark:

```text
local mock server
no TLS
small fixed payload
closed-loop 20 threads
average latency only
```

Production:

```text
TLS
proxy
variable payload
real DNS
connection reuse
remote queueing
p99 required
retry enabled
```

Benchmark result:

```text
average 15 ms
```

Production:

```text
p99 2.5 s
```

Reason:

```text
benchmark measured an unrealistic path and hid tail latency
```

Better benchmark:

```text
TLS enabled
proxy path included
payload distribution realistic
arrival-rate load
histogram percentiles
pool metrics
fault injection
longer duration
```

---

## 32. Java 8–25 performance evolution lens

### Java 8

Typical choices:

```text
HttpURLConnection
Apache HttpClient
OkHttp
Netty
CompletableFuture
platform thread pools
manual GC tuning
```

Concerns:

```text
thread-per-blocking-call expensive at high concurrency
limited built-in HTTP/2 client story
more reliance on external libraries
```

### Java 11+

Adds standard `java.net.http.HttpClient` with HTTP/1.1 and HTTP/2 support.

Implication:

```text
standard client option for modern HTTP workloads
async CompletableFuture API
body handlers/publishers
```

### Java 17/21 LTS era

Modern production baseline for many teams.

Java 21 finalizes virtual threads.

Implication:

```text
blocking style becomes scalable for I/O-heavy workloads
but resource limits still need explicit design
```

### Java 25

Java 25 continues the modern concurrency direction with virtual threads and structured concurrency/scoped values in preview/incubating/final states depending on feature.

Implication:

```text
better structure for fan-out calls
clearer cancellation/deadline handling
better context propagation model
```

Performance strategy:

```text
Use modern concurrency to simplify code.
Use bounded capacity controls to protect systems.
Use measurement to validate assumptions.
```

---

## 33. Practical tuning hierarchy

Do not start with JVM flags.

A better hierarchy:

```text
1. Define SLO and workload shape.
2. Fix timeout/deadline/retry behavior.
3. Bound concurrency and queues.
4. Reuse connections/channels/clients.
5. Stream large payloads.
6. Remove accidental buffering and client leaks.
7. Improve serialization/payload size.
8. Tune pool/channel sizes.
9. Observe and reduce allocation hot spots.
10. Tune GC/JVM/container resources.
11. Tune kernel/network only after evidence.
```

JVM tuning cannot compensate for unbounded queues, retry storms, or broken connection reuse.

---

## 34. Production checklist

For every critical Java network dependency, verify:

```text
[ ] Shared client/channel lifecycle is defined.
[ ] Connection pooling or channel reuse is enabled.
[ ] Pool/channel capacity is explicitly chosen.
[ ] Pool acquisition timeout exists.
[ ] Request deadline exists.
[ ] Retry policy is deadline-aware and idempotency-aware.
[ ] Retry budget exists.
[ ] Large payload path is isolated or streamed.
[ ] Response body is always consumed/closed/cancelled.
[ ] TLS handshake/certificate failures are observable.
[ ] DNS behavior is understood.
[ ] p50/p95/p99/p999 are measured.
[ ] Histograms align with SLO and timeout values.
[ ] Allocation and GC are observed.
[ ] Direct memory is observed if Netty/NIO/direct buffers are used.
[ ] Event-loop delay is observed if Netty/reactive is used.
[ ] Virtual-thread concurrency is bounded by dependency capacity.
[ ] Load test includes realistic payload and arrival pattern.
[ ] Fault injection covers timeout/reset/429/503/slow body.
[ ] Dashboard separates logical request from retry attempts.
[ ] Alerts distinguish latency, error, saturation, and rejection.
```

---

## 35. Exercises

### Exercise 1 — Latency decomposition

Take one existing outbound HTTP/gRPC call in your system.

Create a table:

```text
Phase                  Observable?     Current metric/log/trace?     Missing?
queue wait
pool acquisition
DNS
connect
TLS
write
remote processing
first byte
body read
decode
retry
```

Goal:

```text
Identify which phases are invisible today.
```

---

### Exercise 2 — Retry impact analysis

For one dependency, compute:

```text
logical requests/sec
average attempts per logical request
max attempts
retryable status/exceptions
retry delay
deadline
pool capacity
```

Question:

```text
During 20% dependency failure, how many actual attempts/sec can be generated?
```

---

### Exercise 3 — Connection pool capacity

Given:

```text
throughput = 500 req/s
p95 latency = 200 ms
p99 latency = 800 ms
HTTP/1.1 dependency
```

Estimate minimum concurrency need:

```text
concurrency ~= throughput * latency
```

At average 200 ms:

```text
500 * 0.2 = 100
```

At tail 800 ms:

```text
500 * 0.8 = 400
```

Question:

```text
What happens if max connections = 50?
```

---

### Exercise 4 — Benchmark critique

Given this benchmark:

```text
1000 requests
localhost mock server
no TLS
single payload
average latency
closed-loop client
```

List at least 10 reasons it cannot justify production capacity claims.

---

### Exercise 5 — Virtual-thread safety design

Design a virtual-thread based HTTP batch worker that processes 100,000 records.

Include:

```text
per-dependency concurrency limit
deadline
retry budget
bounded result queue
cancellation
metrics
backpressure
```

---

## 36. Key takeaways

Performance engineering for Java network systems is about **shape, not speed slogans**.

The most important ideas:

```text
Latency distribution matters more than average.
Tail latency compounds across distributed calls.
Queues are everywhere.
Every queue needs a bound and metric.
Connection reuse is a performance feature.
Retry is a load multiplier.
Virtual threads reduce thread-management pain but not remote capacity limits.
Event loops are powerful but fragile if blocked.
Allocation and GC often appear as tail latency.
Benchmark methodology can lie.
Production observability must expose phase, resource, and attempt-level behavior.
```

A top 1% engineer does not merely ask:

```text
Which client is fastest?
```

They ask:

```text
Fast under what workload, resource limit, payload distribution, failure mode, concurrency model, and measurement method?
```

---

## 37. What comes next

Next part:

```text
Part 30 — Large Payload and File Transfer: Upload, Download, Multipart, Range, Resume, Checksums, and Memory Safety
```

Part 30 will focus on network data movement where payload size dominates: streaming upload/download, multipart, range/resume, checksum, temporary files, direct buffers, slow clients, antivirus/scanning pipeline, memory safety, and object storage integration.
