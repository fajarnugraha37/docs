# Strict Coding Standards — Java Benchmarking and Performance Evidence

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when creating, modifying, running, or interpreting Java benchmarks and performance measurements.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases using JMH, JFR/JDK Mission Control, async-profiler, application load tests, GC logs, container metrics, database/network metrics, Maven, Gradle, and CI performance gates.
>
> **Mode**: Strict. A benchmark is evidence, not decoration. Performance claims must be reproducible, scoped, measured, and tied to a real performance question.

---

## 0. Core Principle

Do not benchmark unless there is a question.

Every benchmark must declare:

1. what decision it supports;
2. what unit/system is being measured;
3. what metric matters;
4. what workload represents;
5. what environment was used;
6. what JVM/JDK/GC/options were used;
7. what warmup/measurement design was used;
8. what variance/noise was observed;
9. what would invalidate the result.

If a benchmark cannot answer these, it is not acceptable evidence.

---

## 1. Benchmark Taxonomy

| Type | Purpose | Tooling | Typical scope | Strict rule |
|---|---|---|---|---|
| Microbenchmark | Measure small code path/method | JMH | Method/class | Must use JMH; no handmade loops |
| Component benchmark | Measure module behavior | JMH or custom harness | Parser, repository, serializer | Must control dependencies and data size |
| Application load test | Measure service under workload | k6, Gatling, JMeter, wrk, custom | HTTP/gRPC service | Must include server/client/system metrics |
| Soak test | Detect leak/degradation over time | Load tool + metrics | Service/runtime | Must run long enough for leak/GC signals |
| Stress test | Find breaking point | Load tool + autoscaling metrics | Service/platform | Must isolate test environment |
| Profiling session | Explain where time/memory goes | JFR/JMC, async-profiler | Runtime execution | Must be attached to a specific hypothesis |
| Regression benchmark | Compare before/after | JMH or controlled workload | PR/release delta | Must use same environment and workload |

Forbidden:

- calling a unit test a benchmark;
- using `System.currentTimeMillis()` loops as microbenchmarks;
- reporting one run as truth;
- optimizing based only on intuition;
- optimizing cold paths without evidence;
- mixing benchmark and correctness test responsibilities.

---

## 2. Performance Question Protocol

Before adding or changing performance-related code, the agent must produce:

```text
Performance Question:
Current Evidence:
Hypothesis:
Metric:
Workload:
Baseline Version:
Candidate Version:
Environment:
Acceptance Threshold:
Risk/Trade-off:
```

Example:

```text
Performance Question: Does streaming parser reduce peak heap for 5GB input without lowering throughput by >10%?
Metric: MB/s, peak heap, allocation rate, GC pause.
Workload: 1GB/5GB/10GB generated text with long-token and no-newline cases.
Baseline: commit abc123.
Candidate: branch parser-buffer-reuse.
Environment: Java 21, G1, Windows 11, NVMe SSD, -Xmx96m.
Acceptance: peak heap <100MB and throughput regression <=10%.
```

---

## 3. JMH Rules for Microbenchmarks

### 3.1 Mandatory JMH usage

All JVM microbenchmarks must use JMH or an approved harness with equivalent safeguards.

JMH is required because JVM performance is affected by:

- warmup;
- tiered compilation;
- JIT inlining;
- dead-code elimination;
- escape analysis;
- constant folding;
- GC behavior;
- fork isolation;
- CPU frequency and OS noise.

### 3.2 Basic benchmark structure

Required:

```java
@State(Scope.Thread)
public class ParserBenchmark {
    private byte[] input;

    @Param({"1024", "1048576"})
    int size;

    @Setup(Level.Trial)
    public void setup() {
        input = TestInputs.randomUtf8(size, 12345L);
    }

    @Benchmark
    public int parse(Blackhole blackhole) {
        int count = Parser.parse(input);
        blackhole.consume(count);
        return count;
    }
}
```

Rules:

- benchmark class must be separate from unit tests;
- benchmark must include state setup;
- benchmark must consume results or return value;
- benchmark must use realistic input distribution;
- benchmark must document parameter meaning;
- benchmark must not allocate test data inside measured method unless allocation is the target;
- benchmark must run with multiple forks unless there is a documented reason.

### 3.3 Required JMH annotations

Every benchmark must explicitly choose or inherit from benchmark suite configuration:

```java
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(value = 3)
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
```

Rules:

- warmup must be present;
- measurement iterations must be present;
- fork count must be justified;
- benchmark mode must match the question;
- output unit must be readable and stable;
- parameters must cover expected boundary sizes.

### 3.4 Benchmark modes

| Mode | Use when | Avoid when |
|---|---|---|
| `Throughput` | Operations per time matter | Single operation latency is the question |
| `AverageTime` | Average operation cost matters | Tail latency matters |
| `SampleTime` | Distribution sample matters | You need service-level percentiles |
| `SingleShotTime` | Cold start/one-shot cost matters | Normal warm steady-state path |
| `All` | Exploration only | CI gate or report |

### 3.5 State scope

| Scope | Meaning | Rule |
|---|---|---|
| `Scope.Thread` | one state instance per benchmark thread | Default for mutable state |
| `Scope.Benchmark` | shared state across all threads | Requires thread-safety justification |
| `Scope.Group` | shared per benchmark group | Restricted; concurrency benchmarks only |

Forbidden:

- shared mutable state without thread-safety explanation;
- static mutable state as benchmark input;
- hidden global caches unless cache behavior is being measured.

### 3.6 Setup/teardown levels

| Level | Use for | Rule |
|---|---|---|
| Trial | expensive immutable setup | Default for input fixtures |
| Iteration | reset state per measurement iteration | Use when state drifts |
| Invocation | reset per invocation | Restricted; can distort results |

A code agent must justify any `Level.Invocation` setup because it can dominate measured cost.

---

## 4. Microbenchmark Pitfalls

Forbidden benchmark patterns:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    methodUnderTest();
}
System.out.println(System.nanoTime() - start);
```

```java
@Benchmark
public void benchmark() {
    expensiveMethod(); // result unused; may be optimized away
}
```

```java
@Benchmark
public int constantFolded() {
    return hash("constant");
}
```

```java
@Benchmark
public void includesSetup() {
    List<String> input = loadFile(); // setup included accidentally
    parse(input);
}
```

Every benchmark must defend against:

- dead-code elimination;
- constant folding;
- unrealistic branch profile;
- unrealistic object lifetime;
- measuring setup instead of target;
- measuring logging/debug mode;
- measuring test framework overhead;
- tiny input that fits entirely in CPU cache when production does not;
- measuring cold path but reporting as steady-state;
- comparing algorithms with different correctness semantics.

---

## 5. Benchmark Inputs

### 5.1 Input realism

Inputs must represent real workload characteristics:

- size distribution;
- cardinality;
- null/empty values;
- Unicode/non-ASCII if text processing;
- malformed input if parser/validator;
- sorted/unsorted distribution;
- duplicate rate;
- cache hit/miss ratio;
- branch distribution;
- payload compression if applicable.

### 5.2 Parameterized sizes

Use `@Param` for scale-sensitive benchmarks.

```java
@Param({"100", "10000", "1000000"})
int elementCount;
```

Rules:

- include small, medium, and production-relevant size;
- include boundary cases;
- avoid only toy-size benchmarks;
- avoid only huge benchmarks that hide algorithmic differences behind I/O.

### 5.3 Data generation

Data generation must be deterministic and outside measured method unless generation itself is the target.

Required:

- seed fixed and documented;
- generated data shape documented;
- generated data can be regenerated;
- test data does not contain secrets/PII.

---

## 6. Allocation and Memory Benchmarks

### 6.1 Allocation measurement

When optimizing memory, report:

- allocation rate;
- object count if available;
- retained heap if relevant;
- peak live heap;
- GC count/pause;
- direct/mapped memory if used;
- native memory if JNI/Netty/direct buffers are involved.

### 6.2 JVM flags

Memory-sensitive benchmarks must record:

```text
java -version
-Xms / -Xmx
GC algorithm
container memory limit
MaxRAMPercentage / InitialRAMPercentage if used
Direct memory limit if relevant
```

### 6.3 Allocation pitfalls

Forbidden:

- claiming “zero allocation” without allocation profiler/JMH GC profiler evidence;
- ignoring boxing caused by streams/generics;
- measuring memory on a warmed process but reporting as startup memory;
- ignoring direct buffers, mapped files, metaspace, thread stacks, and native memory;
- comparing with different heap sizes.

---

## 7. Profiling Rules

### 7.1 Profiling before optimizing

For non-trivial performance work, profile before changing code.

Accepted tools:

- JFR/JDK Mission Control for broad runtime evidence;
- async-profiler for CPU/allocation/wall-clock flame graphs;
- GC logs for GC behavior;
- database query plans and DB metrics for database-bound paths;
- OS/container metrics for CPU throttling, I/O, memory pressure.

### 7.2 Profiling output requirements

A profiling report must include:

```text
Scenario:
Duration:
JDK/JVM flags:
Load shape:
CPU usage:
Allocation rate:
GC summary:
Top hot methods:
Blocking/waiting evidence:
Conclusion:
```

### 7.3 Profiling interpretation

A code agent must not conclude from one signal alone.

Examples:

- High latency with low CPU may indicate blocking, I/O, lock contention, or downstream latency.
- High CPU with low allocation may indicate algorithmic inefficiency.
- High allocation with frequent GC may indicate object churn.
- Low throughput in container may be CPU throttling, not Java code.
- Slow database endpoint may be query plan/index/network, not Java mapper.

---

## 8. Load Test Rules

### 8.1 Load-test scope

Load tests are for service/system behavior, not method-level micro-optimization.

Required metrics:

- request rate;
- latency percentiles p50/p90/p95/p99;
- error rate;
- timeout rate;
- CPU usage;
- memory/heap/direct memory;
- GC pause and frequency;
- thread count;
- connection pool usage;
- database pool usage;
- queue depth/backlog;
- downstream latency;
- container CPU throttling;
- pod restarts/OOM kills if Kubernetes.

### 8.2 Load shape

Every load test must define:

- warmup/ramp-up;
- steady-state duration;
- ramp-down;
- concurrency/arrival-rate model;
- data distribution;
- cache state;
- authentication behavior;
- think time if simulating users;
- failure injection if relevant.

### 8.3 Acceptance criteria

Performance gates must be explicit.

Example:

```text
p95 latency <= 250ms at 200 RPS for 15 minutes
error rate <= 0.1%
CPU <= 70% average, no sustained throttling
GC pause p99 <= 50ms
no OOM/restart
```

Forbidden:

- “looks faster” as acceptance;
- average latency only;
- ignoring error rate;
- comparing load tests with different data sizes/cache states;
- running load tests against shared unstable environment and reporting as definitive.

---

## 9. Regression Benchmarking

### 9.1 Before/after rules

Before/after comparison must use:

- same machine or equivalent controlled environment;
- same JDK distribution/version unless testing JDK change;
- same JVM flags;
- same input data;
- same benchmark configuration;
- same container resource limits;
- same dependency versions unless testing dependency change;
- multiple runs/forks;
- variance reporting.

### 9.2 Result reporting

A benchmark result must include:

```text
Benchmark:
Baseline commit/version:
Candidate commit/version:
Environment:
JDK:
JVM flags:
Input/workload:
Metric:
Baseline result:
Candidate result:
Delta:
Variance/confidence:
Interpretation:
Trade-off:
```

### 9.3 Performance PR rule

A PR claiming performance improvement must include evidence.

Forbidden PR claims:

```text
This should be faster.
Optimized performance.
Reduced memory usage.
```

Required PR claim:

```text
Reduced allocation rate in ParserBenchmark.parse_5MB from 420 MB/op to 85 MB/op (-79.8%) on Java 21.0.x, G1, -Xmx512m, JMH 3 forks x 10 iterations. Throughput unchanged within ±3%.
```

---

## 10. JVM, GC, and JIT Rules

### 10.1 JDK/JVM identity

Always record:

```text
java -version
JDK vendor/distribution
OS/kernel
CPU model/core count
container runtime/resource limits
JVM flags
GC algorithm
```

### 10.2 GC-specific claims

A code agent must not claim GC improvement without GC evidence.

Required:

- GC algorithm;
- heap size;
- allocation rate;
- pause summary;
- old/young collection behavior;
- humongous/direct/mapped memory if relevant;
- comparison under same heap and workload.

### 10.3 JIT-specific caution

JIT behavior may differ by:

- JDK version;
- CPU architecture;
- warmup length;
- branch profile;
- class hierarchy;
- method size/inlining;
- exception path frequency;
- reflection/dynamic dispatch;
- virtual threads vs platform threads.

Do not generalize JIT observations beyond measured scope.

---

## 11. Container and Kubernetes Benchmarking

### 11.1 Container resource controls

When benchmarking in containers, record:

- CPU request/limit;
- memory request/limit;
- cgroup version;
- CPU throttling metrics;
- heap sizing strategy;
- direct memory limit;
- pod/node placement;
- node pressure;
- autoscaling state.

### 11.2 Java heap in containers

Do not set heap blindly.

A performance report must account for:

- Java heap;
- metaspace;
- thread stacks;
- direct buffers;
- mapped files;
- code cache;
- native libraries;
- profiler overhead;
- container memory limit.

### 11.3 Kubernetes noise

Kubernetes benchmark results must account for:

- noisy neighbors;
- CPU throttling;
- network policy/proxy overhead;
- service mesh overhead;
- pod startup/warmup;
- HPA scaling delay;
- node disk/network constraints.

---

## 12. Database and Network Performance

### 12.1 Database-bound code

If endpoint is database-bound, Java-only benchmark is insufficient.

Required evidence:

- SQL query text/shape;
- query plan;
- index usage;
- row count/cardinality;
- connection pool wait time;
- transaction time;
- lock wait/deadlock evidence;
- fetch size/batching behavior;
- network round-trip count.

### 12.2 Network-bound code

Required evidence:

- connection reuse;
- DNS behavior;
- TLS handshake cost;
- request/response payload size;
- timeout/retry behavior;
- downstream p95/p99 latency;
- error/timeout rate;
- backpressure/queue behavior.

---

## 13. Benchmark Code Quality

Benchmark code must be reviewed like production code.

Rules:

- no magic constants without explanation;
- no hidden external dependencies;
- no external internet calls;
- no production secrets/PII;
- deterministic setup;
- clear parameter names;
- clear output artifact location;
- benchmark results ignored by normal unit test lifecycle unless intentionally configured;
- benchmark module dependencies minimal.

Recommended structure:

```text
src/jmh/java/...              // Gradle JMH plugin style if used
src/benchmark/java/...        // custom benchmark source set
benchmarks/...                // separate Maven module
```

---

## 14. CI Policy

### 14.1 Do not run unstable benchmarks as normal unit tests

Microbenchmarks and load tests must not run in the default unit-test phase unless explicitly designed as lightweight smoke checks.

Recommended CI stages:

```text
PR fast path:
  compile
  unit tests
  static analysis
  small performance smoke tests only if deterministic

Nightly/scheduled:
  JMH regression suite
  integration performance suite
  mutation tests
  leak/soak tests

Release candidate:
  full load test
  soak test
  baseline comparison
```

### 14.2 Performance gates

A performance gate must tolerate normal variance.

Required:

- stable benchmark;
- historical baseline;
- variance threshold;
- retry/rerun policy;
- failure diagnostics;
- owner for triage.

Forbidden:

- hard-failing PR on noisy single-run benchmark;
- gating on average latency only;
- comparing against stale baseline after hardware/JDK change.

---

## 15. Optimization Rules

### 15.1 Correctness first

Performance optimization must not weaken:

- correctness;
- security;
- transactionality;
- durability;
- auditability;
- observability;
- maintainability;
- API compatibility.

### 15.2 Optimization hierarchy

Prefer improvements in this order:

1. remove unnecessary work;
2. choose better algorithm/data structure;
3. reduce I/O/database round trips;
4. batch safely;
5. stream instead of materializing when appropriate;
6. reduce allocation/object churn;
7. tune concurrency/backpressure;
8. tune JVM/container resources;
9. micro-optimize hot path only after profiling.

### 15.3 Premature optimization guardrail

A code agent must not introduce complex optimization unless:

- path is measured hot;
- expected gain is material;
- correctness tests cover behavior;
- benchmark proves improvement;
- code remains understandable;
- trade-off is documented.

---

## 16. LLM Code Agent Protocol

Before modifying code for performance, the agent must state:

```text
Performance hypothesis:
Measured bottleneck:
Benchmark/profiling evidence:
Proposed change:
Correctness risk:
Benchmark plan:
Rollback condition:
```

After modifying code, the agent must provide:

```text
Benchmark command:
Environment:
Baseline result:
Candidate result:
Delta:
Variance:
Interpretation:
Trade-offs:
```

The agent must not:

- claim performance improvement without measurement;
- write handmade microbenchmarks;
- optimize by removing validation/security checks;
- hide benchmark failures;
- compare different workloads/environments;
- use profiler output without explaining workload.

---

## 17. Reviewer Checklist

A reviewer must reject the benchmark/performance change if any answer is “no”:

- Is there a clear performance question?
- Is the benchmark type appropriate?
- Is the workload realistic enough for the claim?
- Is JMH used for microbenchmarks?
- Are warmup, measurement, forks, and mode explicit?
- Are benchmark inputs deterministic and parameterized?
- Are results consumed to prevent elimination?
- Are setup costs excluded unless intentionally measured?
- Is the environment recorded?
- Are JVM flags and JDK version recorded?
- Is variance reported?
- Are before/after comparisons fair?
- Are correctness/security/maintainability preserved?
- Is profiling evidence included for non-trivial optimization?
- Are CI gates stable and not noise-sensitive?

---

## 18. Result Template

```markdown
# Performance Result — <feature/change>

## Question

## Hypothesis

## Environment
- OS:
- CPU:
- Memory:
- Disk:
- Container/Kubernetes limits:
- JDK:
- JVM flags:
- GC:

## Workload
- Dataset:
- Size:
- Distribution:
- Warmup:
- Measurement:

## Command

```bash
# exact command
```

## Result

| Metric | Baseline | Candidate | Delta | Notes |
|---|---:|---:|---:|---|
| Throughput | | | | |
| p95 latency | | | | |
| Allocation rate | | | | |
| Peak heap | | | | |
| GC pause | | | | |

## Interpretation

## Risks / Trade-offs

## Decision
```

---

## 19. References

- OpenJDK JMH: https://openjdk.org/projects/code-tools/jmh/
- JMH source and samples: https://github.com/openjdk/jmh
- JDK Flight Recorder: https://dev.java/learn/jvm/jfr/
- JDK Mission Control: https://docs.oracle.com/en/java/java-components/jdk-mission-control/
- async-profiler: https://github.com/async-profiler/async-profiler
- Java GC logging and JVM tools: https://docs.oracle.com/en/java/javase/
- Kubernetes resource management: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
