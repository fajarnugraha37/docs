# learn-jaxrs-advanced-part-041.md

# Bagian 041 — Performance Engineering JAX-RS: Request Pipeline Cost, JSON Serialization, Filters/Providers Overhead, Thread and Connection Pools, Blocking vs Async, Streaming, Multipart, Database/Downstream Latency, Benchmarking, Profiling, GC/Memory, and Capacity Planning

> Target pembaca: Java/Jakarta engineer yang ingin melakukan **performance engineering Jakarta REST/JAX-RS API** secara production-grade. Fokus bagian ini bukan “tips cepat” seperti “pakai async” atau “pakai cache”, tetapi cara berpikir sistematis: mendefinisikan SLO, mengukur baseline, memahami request pipeline, menemukan bottleneck dengan metrics/tracing/profiling, melakukan benchmark yang benar, mengoptimasi JSON/filters/providers/thread pools/connection pools/DB/downstream, menangani streaming/upload, membaca GC/memory profile, dan membuat capacity plan.
>
> Prinsip utama:
>
> ```text
> Performance engineering is not guessing.
> It is measurement-guided trade-off management.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Performance is a System Property](#2-mental-model-performance-is-a-system-property)
3. [Performance vs Scalability vs Efficiency](#3-performance-vs-scalability-vs-efficiency)
4. [Latency, Throughput, Saturation, Tail Latency](#4-latency-throughput-saturation-tail-latency)
5. [SLO-Driven Performance](#5-slo-driven-performance)
6. [JAX-RS Request Pipeline Cost](#6-jax-rs-request-pipeline-cost)
7. [Where Time Goes in a REST Request](#7-where-time-goes-in-a-rest-request)
8. [Baseline Before Optimization](#8-baseline-before-optimization)
9. [Instrumentation for Performance](#9-instrumentation-for-performance)
10. [HTTP Metrics for Performance](#10-http-metrics-for-performance)
11. [Tracing for Bottleneck Localization](#11-tracing-for-bottleneck-localization)
12. [Profiling: CPU, Allocation, Lock, IO](#12-profiling-cpu-allocation-lock-io)
13. [JFR / Java Flight Recorder](#13-jfr--java-flight-recorder)
14. [async-profiler](#14-async-profiler)
15. [JMH Microbenchmarking](#15-jmh-microbenchmarking)
16. [Macrobenchmarking REST APIs](#16-macrobenchmarking-rest-apis)
17. [Load Testing Methodology](#17-load-testing-methodology)
18. [Avoiding Benchmark Lies](#18-avoiding-benchmark-lies)
19. [Request Matching Performance](#19-request-matching-performance)
20. [Parameter Binding and Conversion Cost](#20-parameter-binding-and-conversion-cost)
21. [Validation Cost](#21-validation-cost)
22. [JSON Serialization/Deserialization Performance](#22-json-serializationdeserialization-performance)
23. [JSON-B vs Jackson vs Custom Provider](#23-json-b-vs-jackson-vs-custom-provider)
24. [DTO Shape and Payload Size](#24-dto-shape-and-payload-size)
25. [MessageBodyReader/Writer Performance](#25-messagebodyreaderwriter-performance)
26. [Filters and Interceptors Overhead](#26-filters-and-interceptors-overhead)
27. [Exception Mapping Performance](#27-exception-mapping-performance)
28. [Security Filter Performance](#28-security-filter-performance)
29. [Compression Trade-Offs](#29-compression-trade-offs)
30. [Caching and Conditional Requests](#30-caching-and-conditional-requests)
31. [Thread Pools and Execution Model](#31-thread-pools-and-execution-model)
32. [Blocking vs Async](#32-blocking-vs-async)
33. [AsyncResponse and CompletionStage Performance](#33-asyncresponse-and-completionstage-performance)
34. [Event Loop / Reactive Runtime Caveat](#34-event-loop--reactive-runtime-caveat)
35. [Connection Pools: Server and Client](#35-connection-pools-server-and-client)
36. [JAX-RS Client Performance](#36-jax-rs-client-performance)
37. [Timeout, Retry, and Performance](#37-timeout-retry-and-performance)
38. [Database Latency](#38-database-latency)
39. [N+1 Query and REST Performance](#39-n1-query-and-rest-performance)
40. [Pagination and Search Performance](#40-pagination-and-search-performance)
41. [Downstream Dependency Latency](#41-downstream-dependency-latency)
42. [Streaming Download Performance](#42-streaming-download-performance)
43. [Multipart Upload Performance](#43-multipart-upload-performance)
44. [SSE Performance](#44-sse-performance)
45. [Memory and Allocation Optimization](#45-memory-and-allocation-optimization)
46. [GC Performance](#46-gc-performance)
47. [Object Allocation Hotspots](#47-object-allocation-hotspots)
48. [Reflection, Annotation Scanning, and Startup](#48-reflection-annotation-scanning-and-startup)
49. [Warmup and JIT Effects](#49-warmup-and-jit-effects)
50. [JVM and Container Resource Limits](#50-jvm-and-container-resource-limits)
51. [Capacity Planning](#51-capacity-planning)
52. [Performance Regression Testing](#52-performance-regression-testing)
53. [Performance Review Checklist per Endpoint](#53-performance-review-checklist-per-endpoint)
54. [Common Failure Modes](#54-common-failure-modes)
55. [Best Practices](#55-best-practices)
56. [Anti-Patterns](#56-anti-patterns)
57. [Production Checklist](#57-production-checklist)
58. [Latihan](#58-latihan)
59. [Referensi Resmi](#59-referensi-resmi)
60. [Penutup](#60-penutup)

---

# 1. Tujuan Part Ini

Performance problem di REST API sering salah didiagnosis.

Contoh gejala:

```text
GET /applications lambat
PATCH /cases kadang timeout
upload file memory spike
SSE connection bocor
CPU tinggi setelah deploy
p99 latency naik tapi p50 normal
DB pool penuh
downstream retry bikin traffic melonjak
GC pause tinggi
```

Reaksi umum yang keliru:

```text
"Pakai async saja."
"Tambah thread."
"Tambah replica."
"Tambah cache."
"Naikkan timeout."
"Naikkan heap."
```

Kadang benar, sering salah.

Performance engineering yang benar dimulai dengan pertanyaan:

```text
Apa SLO-nya?
Bottleneck ada di mana?
Apakah CPU, memory, DB, network, downstream, lock, GC, serialization, atau queue?
Apakah masalah terjadi di average latency atau tail latency?
Apakah optimasi memperbaiki user impact atau hanya microbenchmark?
```

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memahami request pipeline JAX-RS;
- membedakan latency, throughput, saturation, dan efficiency;
- membuat baseline performance;
- memakai metrics/traces/profiling untuk mencari bottleneck;
- benchmark dengan benar;
- mengoptimasi JSON, filters, providers, validation, security, compression;
- tuning thread/connection pools;
- memilih blocking vs async dengan benar;
- mengatasi DB/downstream bottleneck;
- menangani streaming/upload/SSE performance;
- membaca allocation/GC symptoms;
- membuat capacity plan.

---

# 2. Mental Model: Performance is a System Property

REST endpoint bukan hanya method Java.

Satu request melewati:

```text
client
  ↓ network/gateway/load balancer
server socket
  ↓ HTTP parser
JAX-RS request matching
  ↓ filters
parameter conversion
  ↓ validation
resource method
  ↓ service layer
DB/downstream/cache
  ↓ DTO mapping
message body writer
  ↓ response filters
network/gateway/client
```

Performance ditentukan oleh keseluruhan chain.

## 2.1 Bottleneck moves

Jika DB dioptimasi, bottleneck mungkin pindah ke JSON serialization.

Jika JSON dioptimasi, bottleneck pindah ke downstream HTTP.

Jika thread pool dinaikkan, DB pool mungkin saturate.

## 2.2 Rule

```text
Optimize the current bottleneck, then remeasure.
```

---

# 3. Performance vs Scalability vs Efficiency

## 3.1 Performance

Seberapa cepat satu operasi selesai.

```text
GET /customers/{id} p95 = 80ms
```

## 3.2 Scalability

Seberapa baik sistem menangani peningkatan load.

```text
RPS naik 10x, latency masih dalam SLO
```

## 3.3 Efficiency

Berapa resource untuk melayani load.

```text
1000 RPS dengan 2 vCPU vs 8 vCPU
```

## 3.4 Trade-off

Bisa saja performance cepat tapi boros CPU.

Bisa saja scalable tapi latency per request tinggi.

## 3.5 Rule

Tentukan objective: latency, throughput, cost, atau resilience.

---

# 4. Latency, Throughput, Saturation, Tail Latency

## 4.1 Latency

Durasi request.

Gunakan percentiles:

```text
p50, p90, p95, p99
```

Average sering menipu.

## 4.2 Throughput

Request per second.

## 4.3 Saturation

Seberapa penuh resource:

- CPU;
- thread pool;
- DB pool;
- HTTP client pool;
- queue;
- disk/network.

## 4.4 Tail latency

p99 penting karena user sering merasakan slowest path.

## 4.5 Rule

Perhatikan p95/p99, bukan hanya average.

---

# 5. SLO-Driven Performance

Performance target sebaiknya berdasarkan SLO.

## 5.1 Example

```text
99% of GET /customers/{id} complete under 300ms over 30 days.
99% of POST /documents complete under 2s excluding malware scan async stage.
99.9% of health endpoint under 50ms.
```

## 5.2 Endpoint classes

Tidak semua endpoint sama.

- simple read;
- search/list;
- write;
- upload;
- download;
- async submit;
- admin report.

## 5.3 Rule

Do not optimize without knowing what "fast enough" means.

---

# 6. JAX-RS Request Pipeline Cost

JAX-RS pipeline has cost:

1. request parse by server;
2. route matching;
3. filters;
4. interceptors;
5. parameter injection/conversion;
6. entity reading;
7. validation;
8. method invocation;
9. response construction;
10. entity writing;
11. response filters;
12. network write.

## 6.1 Usually small but not always

For DB-heavy endpoints, JAX-RS overhead may be tiny.

For ultra-low-latency endpoints, filters/JSON/providers can dominate.

## 6.2 Rule

Measure pipeline components before optimizing framework overhead.

---

# 7. Where Time Goes in a REST Request

Typical breakdown:

```text
gateway      5ms
server queue 2ms
auth filter  8ms
JSON read    3ms
service      10ms
DB           80ms
DTO map      2ms
JSON write   6ms
network      4ms
```

If endpoint is slow at 120ms, optimizing JSON from 6ms to 3ms helps little compared to DB 80ms.

## 7.1 Rule

Target largest controllable contributor first.

---

# 8. Baseline Before Optimization

Baseline should include:

- hardware/container limits;
- JVM version;
- runtime/framework version;
- GC;
- heap;
- deployment replicas;
- DB/downstream versions;
- test data size;
- endpoint mix;
- load pattern;
- latency percentiles;
- CPU/memory/GC;
- DB/client pool metrics.

## 8.1 Baseline artifact

Write benchmark report:

```text
commit SHA
config
test scenario
RPS
p50/p95/p99
CPU
heap/GC
bottleneck hypothesis
```

## 8.2 Rule

If you cannot reproduce baseline, you cannot prove improvement.

---

# 9. Instrumentation for Performance

Need at least:

- HTTP server metrics;
- HTTP client metrics;
- DB query metrics;
- thread/connection pool metrics;
- GC/JVM metrics;
- traces;
- profiler snapshots.

## 9.1 Metrics first

Metrics tell where to look.

## 9.2 Traces second

Traces show request path and dependency spans.

## 9.3 Profiling third

Profilers show CPU/allocation/lock hotspots.

## 9.4 Rule

Metrics locate symptoms; traces localize paths; profilers identify code hotspots.

---

# 10. HTTP Metrics for Performance

Track:

```text
http.server.request.duration
http.client.request.duration
http.server.active_requests
http.client.active_requests
```

Custom:

```text
app.request.queue.duration
app.validation.duration
app.json.serialization.duration
app.db.query.duration
app.downstream.retry.count
```

## 10.1 Attributes

Use route template:

```text
http.route=/customers/{customerId}
```

not raw path.

## 10.2 Rule

Route-based metrics are essential for endpoint-level performance.

---

# 11. Tracing for Bottleneck Localization

A good trace shows:

```text
HTTP server span
  service span
    DB query span
    downstream HTTP client span
    JSON mapping span if manual/important
```

## 11.1 Useful trace attributes

- route;
- status;
- error code;
- DB statement name;
- downstream operation;
- retry attempt;
- cache hit/miss.

## 11.2 Rule

If trace only has one giant server span, it is not enough for performance debugging.

---

# 12. Profiling: CPU, Allocation, Lock, IO

Profiling answers:

- CPU hot methods?
- allocation hotspots?
- lock contention?
- thread states?
- blocking IO?
- GC pressure?
- native/kernel time?

## 12.1 CPU profile

Find code consuming CPU.

## 12.2 Allocation profile

Find object churn causing GC pressure.

## 12.3 Lock profile

Find synchronization contention.

## 12.4 Wall-clock profile

Find blocking/wait time.

## 12.5 Rule

Use the profiling mode that matches symptom.

---

# 13. JFR / Java Flight Recorder

JDK Flight Recorder is built into HotSpot JVM and provides low-overhead monitoring/profiling data.

## 13.1 Good for

- production-safe recordings;
- CPU samples;
- allocation events;
- GC events;
- thread states;
- lock events;
- socket/file IO;
- JVM/compiler info.

## 13.2 Commands

Example:

```bash
jcmd <pid> JFR.start name=perf settings=profile duration=120s filename=recording.jfr
```

Analyze with JDK Mission Control.

## 13.3 Use in incident

Record during latency/CPU/GC spike.

## 13.4 Rule

Use JFR as first-line profiler in production-like environments.

---

# 14. async-profiler

async-profiler is low-overhead sampling profiler for Java/HotSpot-based JVMs.

## 14.1 Good for

- CPU flame graphs;
- allocation profiling;
- wall-clock profiling;
- lock profiling;
- native/kernel frames;
- avoiding safepoint bias.

## 14.2 Example

```bash
./profiler.sh -d 60 -e cpu -f cpu.html <pid>
./profiler.sh -d 60 -e alloc -f alloc.html <pid>
./profiler.sh -d 60 -e wall -f wall.html <pid>
```

## 14.3 Rule

Use flame graphs to find real hotspots, not guessed hotspots.

---

# 15. JMH Microbenchmarking

JMH is OpenJDK's Java harness for building and running micro/milli/macro benchmarks on the JVM.

## 15.1 Use for

- mapper performance;
- JSON serializer comparison;
- parameter converter;
- validation function;
- hashing/signature logic;
- small pure functions.

## 15.2 Do not use JMH for

- full HTTP endpoint performance;
- DB query performance;
- network call performance;
- end-to-end latency.

## 15.3 Example

```java
@Benchmark
public byte[] serializeCustomer() {
    return objectMapper.writeValueAsBytes(customer);
}
```

## 15.4 Rule

Use JMH for isolated code paths, not whole-system conclusions.

---

# 16. Macrobenchmarking REST APIs

Macrobenchmark tests full endpoint.

Tools:

- k6;
- Gatling;
- wrk;
- hey;
- Locust;
- JMeter.

## 16.1 What to capture

- latency percentiles;
- throughput;
- error rate;
- CPU;
- memory;
- GC;
- DB pool;
- client pool;
- downstream latency.

## 16.2 Rule

Macrobenchmark tells user-visible behavior; microbenchmark tells local code cost.

---

# 17. Load Testing Methodology

## 17.1 Test types

- smoke test;
- baseline test;
- load test;
- stress test;
- soak test;
- spike test;
- capacity test.

## 17.2 Warmup

JVM needs warmup.

Run warmup before measuring.

## 17.3 Realistic workload

Use realistic:

- payload size;
- data distribution;
- auth;
- DB size;
- endpoint mix;
- think time;
- cache state.

## 17.4 Rule

Unrealistic load tests produce misleading confidence.

---

# 18. Avoiding Benchmark Lies

Common lies:

- benchmark localhost only;
- no TLS/gateway;
- empty database;
- single user token;
- no warmup;
- average latency only;
- ignored errors;
- benchmark client bottleneck;
- GC/logging disabled differently from prod;
- no downstream dependency;
- no think time;
- unrealistic payload.

## 18.1 Rule

Benchmark environment should represent the performance question.

---

# 19. Request Matching Performance

JAX-RS route matching is usually not bottleneck.

But can become cost if:

- huge number of resources;
- ambiguous paths;
- complex regex;
- excessive subresource locators;
- runtime scanning at startup.

## 19.1 Optimize

- avoid unnecessary regex;
- keep paths clear;
- avoid catch-all path patterns;
- test route ambiguity;
- use build-time/runtime optimizations if platform supports.

## 19.2 Rule

Do not over-optimize request matching unless profiler/trace shows it matters.

---

# 20. Parameter Binding and Conversion Cost

Param converters can be hot on high-RPS endpoints.

## 20.1 Expensive converters

Bad converter:

```java
public CustomerId fromString(String value) {
    remoteService.validate(value); // bad
}
```

## 20.2 Good converter

- parse;
- validate format;
- create value object;
- no DB/network.

## 20.3 Rule

Parameter conversion should be cheap and deterministic.

---

# 21. Validation Cost

Jakarta Validation is valuable but has cost.

## 21.1 Cost drivers

- deep object graph;
- complex regex;
- custom validators with DB/network;
- large collections;
- cross-field validations.

## 21.2 Optimize

- keep boundary validation simple;
- move business invariants to service/domain;
- avoid DB calls in constraint validators;
- validate only needed groups.

## 21.3 Rule

Validation should reject bad input cheaply.

---

# 22. JSON Serialization/Deserialization Performance

JSON often dominates CPU for API-heavy services.

## 22.1 Cost drivers

- large payloads;
- deeply nested DTOs;
- reflection;
- date/time formatting;
- BigDecimal;
- polymorphism;
- generic types;
- unknown fields;
- custom serializers;
- pretty printing.

## 22.2 Optimize

- reduce payload;
- use DTO projections;
- avoid unnecessary fields;
- avoid recursive graphs;
- benchmark provider config;
- reuse configured mapper/provider;
- prefer streaming for huge output.

## 22.3 Rule

The fastest JSON is the JSON you do not send.

---

# 23. JSON-B vs Jackson vs Custom Provider

## 23.1 JSON-B

Standards-oriented.

## 23.2 Jackson

Feature-rich and common.

## 23.3 Custom provider

For specialized formats:

- CSV;
- NDJSON;
- protobuf;
- binary;
- specialized streaming.

## 23.4 Performance decision

Do not assume. Benchmark with your DTOs and runtime.

## 23.5 Rule

JSON provider choice affects both contract and performance.

---

# 24. DTO Shape and Payload Size

Payload size affects:

- serialization CPU;
- network latency;
- memory allocation;
- client parsing;
- cache efficiency.

## 24.1 Techniques

- sparse fieldsets if needed;
- separate detail/list DTOs;
- pagination;
- links instead of embedding huge child collections;
- compression for large text payloads;
- avoid base64 large binary in JSON.

## 24.2 Rule

DTO design is performance design.

---

# 25. MessageBodyReader/Writer Performance

Custom providers can be performance-critical.

## 25.1 Avoid

- creating heavy serializer per call;
- reading whole stream into string unnecessarily;
- unbounded buffering;
- synchronized global state;
- non-thread-safe shared formatter;
- poor charset handling.

## 25.2 Prefer

- streaming APIs;
- cached immutable configuration;
- bounded buffers;
- thread-safe formatters;
- clear media type matching.

## 25.3 Rule

Entity providers should be stateless, thread-safe, and allocation-aware.

---

# 26. Filters and Interceptors Overhead

Filters run on every matched request or globally.

## 26.1 Common overhead

- logging body;
- JWT introspection;
- DB tenant lookup;
- remote auth check;
- regex per request;
- MDC manipulation;
- metrics labels computed with raw URI parsing.

## 26.2 Optimize

- do cheap checks first;
- cache key/JWK metadata;
- avoid body logging;
- avoid DB/network in global filter unless necessary;
- use route template from runtime if available;
- keep filters stateless.

## 26.3 Rule

Global filters are multiplied by every request. Keep them lean.

---

# 27. Exception Mapping Performance

Exception-heavy code is slow and noisy.

## 27.1 Avoid exceptions for normal control flow

Bad:

```java
try {
    repo.get(id);
} catch (NotFoundException e) { ... }
```

If not found is frequent, use `Optional` in lower layer and map once at boundary.

## 27.2 But do not over-optimize rare errors

Correctness/readability matters.

## 27.3 Rule

Expected high-volume outcomes should not rely on expensive stack traces deep in hot path.

---

# 28. Security Filter Performance

Security checks can dominate latency.

## 28.1 Token validation

JWT local signature validation is usually faster than remote introspection.

Remote introspection needs cache/resilience.

## 28.2 Authorization

Object-level authorization may require DB lookup.

Optimize by:

- combining tenant-safe load + authorization;
- caching static policy;
- avoiding repeated checks.

## 28.3 Rule

Security must be correct first, then measured and optimized.

---

# 29. Compression Trade-Offs

Compression reduces bytes but costs CPU.

## 29.1 Good for

- large JSON/text;
- slow network;
- cross-region;
- mobile clients.

## 29.2 Bad for

- tiny payloads;
- already compressed files;
- CPU-bound services;
- latency-sensitive small responses.

## 29.3 Config

Use threshold:

```text
compress only > 1KB/2KB/etc.
```

## 29.4 Rule

Benchmark compression with real payload and network assumptions.

---

# 30. Caching and Conditional Requests

Caching improves performance by avoiding work.

## 30.1 Server-side cache

- reference data;
- computed projections;
- auth metadata;
- downstream responses.

## 30.2 HTTP caching

- `Cache-Control`;
- `ETag`;
- `Last-Modified`;
- `If-None-Match`;
- `304 Not Modified`.

## 30.3 Conditional writes

`If-Match` avoids lost update and wasted write.

## 30.4 Rule

Correct caching is both performance and correctness feature.

---

# 31. Thread Pools and Execution Model

Performance depends on concurrency model.

## 31.1 Traditional blocking server

Each request uses worker thread.

Blocking DB/downstream consumes thread.

## 31.2 Async server

Request thread can be released while work continues elsewhere.

But work still needs executor.

## 31.3 Reactive/event-loop server

Event loop must not block.

Blocking work must be offloaded.

## 31.4 Rule

Know your runtime execution model before tuning threads.

---

# 32. Blocking vs Async

## 32.1 Blocking is fine when

- simple service;
- concurrency moderate;
- thread/DB pools sized;
- latency acceptable;
- operations mostly CPU/light DB.

## 32.2 Async helps when

- long waits;
- external async APIs;
- long polling;
- SSE;
- freeing request threads matters;
- runtime supports it well.

## 32.3 Async hurts when

- blocking work just moved to another unbounded pool;
- context propagation broken;
- code complexity increases;
- bottleneck is DB not request thread.

## 32.4 Rule

Async is not a performance magic wand; it changes resource usage.

---

# 33. AsyncResponse and CompletionStage Performance

## 33.1 Benefits

- releases container request thread;
- can compose async downstream calls;
- useful for long-running wait.

## 33.2 Costs

- executor scheduling;
- context capture;
- more allocations;
- harder error handling;
- lifecycle leaks if not cleaned.

## 33.3 Rule

Use async to remove waiting from scarce threads, not to make CPU work faster.

---

# 34. Event Loop / Reactive Runtime Caveat

In event-loop runtimes, blocking is dangerous.

## 34.1 Bad

- JDBC call on event loop;
- file IO on event loop;
- blocking HTTP call on event loop;
- heavy JSON/crypto on event loop.

## 34.2 Fix

- mark blocking endpoint;
- offload to worker;
- use reactive/non-blocking client;
- bound workers.

## 34.3 Rule

Event-loop performance requires non-blocking discipline.

---

# 35. Connection Pools: Server and Client

## 35.1 Server

Important:

- max connections;
- keep-alive;
- request queue;
- worker threads;
- accept backlog.

## 35.2 Client

Important:

- max total connections;
- max per route;
- connection TTL;
- idle eviction;
- acquisition timeout;
- DNS;
- TLS reuse.

## 35.3 Rule

Pool saturation causes tail latency before obvious CPU saturation.

---

# 36. JAX-RS Client Performance

## 36.1 Reuse Client

`Client` is heavyweight and should be reused.

## 36.2 Avoid per-request ClientBuilder

Bad:

```java
ClientBuilder.newClient().target(...).request().get()
```

per request.

## 36.3 Tune connector

Connection pool settings are implementation-specific.

## 36.4 Rule

Outbound client performance starts with lifecycle and pool management.

---

# 37. Timeout, Retry, and Performance

## 37.1 Too high timeout

Threads/pools stuck.

## 37.2 Too aggressive retry

Amplifies load.

## 37.3 Retry without jitter

Thundering herd.

## 37.4 Retry budget

Limit retry volume.

## 37.5 Rule

Resilience policy affects performance under failure more than under normal load.

---

# 38. Database Latency

Most enterprise REST latency is DB-bound.

## 38.1 Watch

- query duration;
- connection pool wait;
- lock wait;
- transaction duration;
- rows scanned;
- indexes;
- result set size.

## 38.2 Fix

- indexes;
- query projection;
- keyset pagination;
- batch queries;
- reduce transaction scope;
- avoid N+1;
- cache reference data.

## 38.3 Rule

Do not tune JAX-RS framework while DB query spends 90% of latency.

---

# 39. N+1 Query and REST Performance

Classic REST list problem:

```text
GET /customers
1 query customers
N queries addresses/status/roles
```

## 39.1 Detection

- SQL count per request;
- tracing spans;
- Hibernate statistics;
- DB logs.

## 39.2 Fix

- projection query;
- fetch join carefully;
- batch fetching;
- separate detail endpoint;
- read model.

## 39.3 Rule

List endpoint should have predictable query count.

---

# 40. Pagination and Search Performance

## 40.1 Offset problem

Large offset can be slow.

## 40.2 Cursor/keyset

More efficient for large datasets with stable sort.

## 40.3 Search

Search endpoint can be expensive due to:

- wildcard;
- unindexed filter;
- sort on unindexed field;
- huge result count;
- full count query.

## 40.4 Rule

Query API must be index-aware.

---

# 41. Downstream Dependency Latency

Outbound calls often dominate.

## 41.1 Watch

- downstream p95/p99;
- timeouts;
- retries;
- circuit state;
- bulkhead wait;
- rate limit.

## 41.2 Parallelization

Can reduce latency if calls independent.

But increases load.

## 41.3 Batching

Can reduce round-trips.

But increases payload and tail latency if batch too large.

## 41.4 Rule

Optimize dependency topology, not only code.

---

# 42. Streaming Download Performance

## 42.1 Benefits

Avoid loading whole file into memory.

## 42.2 Watch

- time to first byte;
- throughput;
- client abort;
- response buffer;
- proxy buffering;
- range support;
- checksum cost.

## 42.3 Avoid

```java
byte[] all = Files.readAllBytes(file);
```

for large file.

## 42.4 Rule

Large download performance is IO/backpressure/proxy problem.

---

# 43. Multipart Upload Performance

## 43.1 Watch

- max request size;
- memory threshold;
- temp disk usage;
- file scan time;
- object storage upload time;
- metadata DB transaction;
- client abort.

## 43.2 Pipeline

```text
stream → validate size/type → temp/quarantine → checksum → scan → metadata/outbox
```

## 43.3 Rule

Upload performance must be designed as pipeline, not “read all bytes then save”.

---

# 44. SSE Performance

## 44.1 Watch

- open connections;
- events/sec;
- send failures;
- slow clients;
- heartbeat cost;
- broadcaster fan-out;
- memory per connection.

## 44.2 Slow clients

Need policy:

- drop event;
- coalesce;
- disconnect;
- backpressure queue limit.

## 44.3 Rule

SSE scale is connection lifecycle + fan-out management.

---

# 45. Memory and Allocation Optimization

Allocation hotspots cause GC pressure.

## 45.1 Common hotspots

- JSON serialization;
- DTO mapping;
- logging string creation;
- regex;
- per-request ObjectMapper;
- byte[] buffering;
- exception stack traces;
- copying streams.

## 45.2 Optimize

- reuse configured objects;
- avoid body buffering;
- reduce DTO size;
- avoid unnecessary collections;
- use streaming;
- avoid debug log string construction.

## 45.3 Rule

Allocation reduction often improves tail latency through lower GC pressure.

---

# 46. GC Performance

GC symptoms:

- high allocation rate;
- frequent young GC;
- long pause;
- humongous allocations;
- heap too small/large;
- memory leak;
- off-heap/direct buffer pressure.

## 46.1 Measure

- GC logs;
- JFR;
- JVM metrics;
- allocation profile.

## 46.2 Do not guess GC flags first

First reduce allocation or fix leak if possible.

## 46.3 Rule

GC tuning comes after understanding allocation behavior.

---

# 47. Object Allocation Hotspots

## 47.1 Per-request object churn

Examples:

- building multiple maps/lists;
- parsing same header repeatedly;
- creating regex patterns;
- creating JSON mapper per call;
- copying byte arrays;
- MDC map churn.

## 47.2 Use allocation profiler

Find top allocating stack traces.

## 47.3 Rule

Optimize allocations based on profiling, not code aesthetics.

---

# 48. Reflection, Annotation Scanning, and Startup

Startup cost matters for autoscaling/serverless-like deployments.

## 48.1 Cost sources

- classpath scanning;
- annotation scanning;
- CDI bootstrap;
- reflection metadata;
- JSON provider initialization;
- OpenAPI generation;
- JPA metamodel;
- warm caches.

## 48.2 Optimization

- reduce classpath;
- explicit registration;
- build-time optimized runtime;
- lazy/non-lazy decisions;
- native image if appropriate;
- precompute OpenAPI if heavy.

## 48.3 Rule

Startup optimization differs from steady-state latency optimization.

---

# 49. Warmup and JIT Effects

JVM performance changes after warmup.

## 49.1 Effects

- JIT compilation;
- class loading;
- caches;
- DB pool warmup;
- TLS session;
- branch profiling;
- profile-guided JIT decisions.

## 49.2 Benchmark

Separate warmup from measurement.

## 49.3 Rule

Do not use cold-start numbers as steady-state performance numbers.

---

# 50. JVM and Container Resource Limits

## 50.1 Container memory

Heap is not all memory.

Also:

- metaspace;
- thread stacks;
- direct buffers;
- code cache;
- native libs;
- JFR/profiler overhead.

## 50.2 CPU limits

CPU quota affects GC/JIT/thread scheduling.

## 50.3 Thread count

Each thread uses stack memory.

## 50.4 Rule

Tune JVM with container limits in mind.

---

# 51. Capacity Planning

Capacity planning estimates resources needed for target load.

## 51.1 Inputs

- target RPS;
- latency SLO;
- CPU per request;
- memory per instance;
- DB connections per instance;
- downstream limits;
- peak factor;
- retry overhead;
- safety headroom.

## 51.2 Little's Law

Roughly:

```text
concurrency = throughput × latency
```

If 500 RPS and average latency 200ms:

```text
concurrency ≈ 500 × 0.2 = 100 in-flight
```

## 51.3 Headroom

Plan for:

- traffic spikes;
- deploy overlap;
- dependency slowdown;
- GC;
- noisy neighbor.

## 51.4 Rule

Capacity plan must include downstream and DB capacity, not only app CPU.

---

# 52. Performance Regression Testing

## 52.1 What to track

- p95/p99 latency;
- throughput;
- CPU per request;
- allocation per request;
- DB query count;
- response size;
- GC pause;
- startup time.

## 52.2 CI strategy

- microbenchmarks for hot functions;
- performance smoke on PR/nightly;
- full load test before release;
- compare against baseline.

## 52.3 Rule

Performance regressions should be caught before users see them.

---

# 53. Performance Review Checklist per Endpoint

For each endpoint ask:

```text
What is SLO?
What payload size?
What query count?
What downstream calls?
Can it be cached?
Can response be paginated?
What is max concurrency?
What are timeouts?
What is p95/p99 under realistic load?
What is CPU/allocation hotspot?
What happens under dependency slowdown?
```

## 53.1 Rule

Endpoint performance review should happen before production incident.

---

# 54. Common Failure Modes

## 54.1 Optimizing without measurement

Wasted effort.

## 54.2 Average latency only

Tail latency ignored.

## 54.3 Per-request Client creation

No connection reuse.

## 54.4 Body logging

Huge CPU/memory/security cost.

## 54.5 Large JSON instead of pagination/streaming

Memory and latency blow-up.

## 54.6 Async over blocking DB with unbounded executor

Thread explosion.

## 54.7 Retry storm

Failure amplified.

## 54.8 N+1 query

DB bottleneck.

## 54.9 Compression on tiny responses

Wasted CPU.

## 54.10 Metric label raw URL

Observability system slowdown/cost.

## 54.11 Load test with empty DB

False confidence.

## 54.12 GC tuning before allocation analysis

Wrong order.

---

# 55. Best Practices

## 55.1 Define SLO

Know target.

## 55.2 Measure baseline

Before change.

## 55.3 Use route metrics and traces

Find bottleneck.

## 55.4 Profile under realistic load

Use JFR/async-profiler.

## 55.5 Optimize payloads

DTO design, pagination, projection.

## 55.6 Keep filters/providers lean

No heavy global work.

## 55.7 Reuse clients and tune pools

Outbound matters.

## 55.8 Avoid unbounded async

Bound executors/queues.

## 55.9 Fix DB/query problems

Often biggest win.

## 55.10 Regression test performance

Guard improvements.

---

# 56. Anti-Patterns

## 56.1 “Use async for performance” blindly

Wrong.

## 56.2 “Increase timeout” for slow dependency

Hides issue and increases saturation.

## 56.3 “Add more threads” for DB-bound service

May worsen DB saturation.

## 56.4 “Cache everything”

Correctness risk.

## 56.5 “Benchmark one endpoint on localhost”

Incomplete.

## 56.6 “No profiler needed”

Guessing.

## 56.7 “JSON provider default is fine”

Maybe, but contract/performance unknown.

## 56.8 “One Client per request”

Bad.

## 56.9 “Load test only happy path”

Failure path performance unknown.

## 56.10 “Ignore p99”

Users notice tail.

---

# 57. Production Checklist

## 57.1 Measurement

- [ ] SLO defined per endpoint class.
- [ ] Baseline benchmark captured.
- [ ] HTTP server/client metrics exist.
- [ ] Route template labels used.
- [ ] Traces include DB/downstream spans.
- [ ] JFR/profiler workflow documented.

## 57.2 API/pipeline

- [ ] Payload size bounded.
- [ ] Pagination for lists.
- [ ] JSON provider configured/tested.
- [ ] Filters/interceptors lean.
- [ ] Validation cheap.
- [ ] Error path not excessive.
- [ ] Compression threshold configured.

## 57.3 Resources

- [ ] Server thread pool understood.
- [ ] Async executor bounded.
- [ ] DB pool sized.
- [ ] Client connection pool sized.
- [ ] Timeouts configured.
- [ ] Retry budget configured.
- [ ] Queue saturation metrics.

## 57.4 Advanced endpoints

- [ ] Streaming does not buffer whole file.
- [ ] Multipart uses size limits/temp/quarantine.
- [ ] SSE has heartbeat/backpressure metrics.
- [ ] Download/upload tested under realistic size.
- [ ] Proxy/gateway behavior tested.

## 57.5 JVM/container

- [ ] Heap/container memory aligned.
- [ ] GC logs/metrics available.
- [ ] Allocation hotspots profiled.
- [ ] CPU limits understood.
- [ ] Startup/warmup measured.

## 57.6 Release

- [ ] Performance smoke test in CI/nightly.
- [ ] Full load test before major release.
- [ ] Regression threshold defined.
- [ ] Capacity plan updated.
- [ ] Rollback criteria defined.

---

# 58. Latihan

## Latihan 1 — Baseline Endpoint

Pilih endpoint `GET /customers/{id}`.

Ukur:

- p50/p95/p99;
- RPS;
- CPU;
- allocation;
- DB time;
- response size.

Buat baseline report.

## Latihan 2 — JSON Benchmark

Gunakan JMH untuk membandingkan serialization DTO list 100 item.

Bandingkan provider/config.

Pastikan benchmark punya warmup.

## Latihan 3 — Trace Bottleneck

Tambahkan tracing untuk:

```text
resource → service → repository → downstream
```

Cari span paling lambat.

## Latihan 4 — N+1 Test

Buat endpoint list yang sengaja N+1.

Ukur query count.

Refactor ke projection.

Bandingkan p95.

## Latihan 5 — Client Pool Test

Buat outbound gateway.

Bandingkan:

- Client per request;
- singleton Client dengan pool.

Ukur latency dan connection count.

## Latihan 6 — Async Misuse

Buat endpoint async dengan unbounded executor.

Load test.

Kemudian ubah ke bounded executor + rejection policy.

Bandingkan saturation.

## Latihan 7 — Streaming Download

Bandingkan:

- `byte[]`;
- `StreamingOutput`.

File 500MB.

Ukur heap dan time to first byte.

## Latihan 8 — Upload Pipeline

Upload file besar.

Ukur:

- memory;
- temp disk;
- scan queue;
- object storage latency.

## Latihan 9 — JFR Incident Drill

Saat load test, ambil JFR 2 menit.

Identifikasi:

- CPU hotspot;
- allocation hotspot;
- GC;
- blocked threads.

---

# 59. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `StreamingOutput` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/streamingoutput

3. Jakarta RESTful Web Services 4.0 — Client API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/package-summary

4. OpenTelemetry Semantic Conventions for HTTP  
   https://opentelemetry.io/docs/specs/semconv/http/

5. OpenTelemetry Semantic Conventions for HTTP Metrics  
   https://opentelemetry.io/docs/specs/semconv/http/http-metrics/

6. OpenJDK JMH  
   https://openjdk.org/projects/code-tools/jmh/

7. JMH GitHub Repository  
   https://github.com/openjdk/jmh

8. JDK Flight Recorder  
   https://dev.java/learn/jvm/jfr/

9. JDK Mission Control — Using JDK Flight Recorder  
   https://docs.oracle.com/en/java/java-components/jdk-mission-control/8/user-guide/using-jdk-flight-recorder.html

10. async-profiler  
    https://github.com/async-profiler/async-profiler

11. Quarkus REST Guide  
    https://quarkus.io/guides/rest

---

# 60. Penutup

Performance engineering JAX-RS adalah disiplin mengelola trade-off berdasarkan data.

Mental model final:

```text
SLO
  ↓
baseline
  ↓
metrics/traces
  ↓
profile
  ↓
identify bottleneck
  ↓
optimize one layer
  ↓
remeasure
  ↓
capacity plan
  ↓
regression guard
```

Prinsip final:

```text
Measure before optimizing.
Optimize bottleneck, not favorite code.
Async changes resource usage, not total work.
JSON and DTO design affect performance.
DB/downstream often dominate latency.
Tail latency matters.
Profiling beats guessing.
Capacity includes dependencies.
```

Top-tier JAX-RS engineer memastikan:

- endpoint punya SLO dan baseline;
- metrics/tracing/profiling tersedia;
- JSON/filter/provider/security overhead terukur;
- thread/client/DB pools disetel berdasarkan load;
- async/reactive dipakai sesuai execution model;
- streaming/upload/SSE tidak membocorkan memory;
- DB/downstream bottleneck diprioritaskan;
- GC/allocation dianalisis dengan JFR/profiler;
- performance regression diuji sebelum release.

Part berikutnya:

```text
Bagian 042 — Production Security Hardening for JAX-RS APIs
```

Kita akan membahas hardening production API: authentication, authorization, JWT/OIDC, token validation, CORS/CSRF, input limits, headers, rate limit, request smuggling, SSRF, deserialization safety, file upload security, audit, and security testing.
