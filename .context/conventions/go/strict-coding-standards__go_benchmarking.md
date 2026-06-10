# Strict Coding Standards — Go Benchmarking

Status: Mandatory for all Go benchmark implementation, review, refactoring, and generated performance claims.  
Audience: LLM coding agents, reviewers, maintainers, performance engineers, and service owners.  
Scope: Go `testing.B` benchmarks, microbenchmarks, macrobenchmarks, allocation benchmarks, CPU/memory profiling, throughput measurement, regression gates, and performance reporting.

This standard is a merge gate. Any benchmark or performance claim that violates these rules must be rejected or marked as non-actionable.

---

## 1. Source authority

Use these sources as the primary authority when resolving ambiguity:

- Go `testing` package documentation.
- Go 1.24+ release notes for `testing.B.Loop`.
- Go diagnostics documentation for profiling and tracing.
- Go `runtime/pprof`, `runtime/trace`, `runtime/metrics`, `testing`, `benchstat`, and `pprof` guidance.
- Project-specific performance SLOs, telemetry standards, and capacity planning documents.

When this document conflicts with local production performance policy, the stricter rule wins.

---

## 2. Non-negotiable benchmarking principles

LLM-generated Go benchmarks MUST obey these principles:

1. Benchmarks must answer a specific performance question.
2. Benchmarks must define input size, data shape, environment assumptions, and metric of interest.
3. Benchmarks must not make production claims without representative workload evidence.
4. Benchmarks must prevent dead-code elimination and accidental compiler optimization artifacts.
5. Benchmarks must separate setup cost from measured operation cost.
6. Benchmarks must report allocations when allocation behavior matters.
7. Benchmarks must be deterministic enough for comparison.
8. Benchmarks must not hide correctness checks; measured code must still produce valid results.
9. Benchmark results must be compared statistically, preferably with `benchstat` or equivalent.
10. Any optimization must include before/after benchmark evidence and correctness tests.

---

## 3. Benchmark naming

Benchmark names MUST describe operation and scenario.

Preferred:

```go
func BenchmarkDecodeCommand_JSON_1KB(b *testing.B) {}
func BenchmarkAuthorizePolicy_CrossTenantDeny(b *testing.B) {}
func BenchmarkNormalizePath_LongUnicodeInput(b *testing.B) {}
```

Avoid:

```go
func BenchmarkFast(b *testing.B) {}
func BenchmarkService(b *testing.B) {}
func BenchmarkNew(b *testing.B) {}
```

Use sub-benchmarks for size or scenario matrices.

```go
func BenchmarkIndexLookup(b *testing.B) {
    for _, size := range []int{100, 1_000, 10_000} {
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            // benchmark
        })
    }
}
```

---

## 4. `B.Loop` rule

For Go 1.24+, new benchmarks SHOULD prefer `b.Loop()` over manual `b.N` loops unless compatibility with older Go versions is required.

Preferred:

```go
func BenchmarkEncode(b *testing.B) {
    payload := buildPayload()

    for b.Loop() {
        _, err := Encode(payload)
        if err != nil {
            b.Fatal(err)
        }
    }
}
```

Rules:

1. Do not mix `b.Loop()` and manual `b.N` loops in the same benchmark body.
2. Put expensive setup outside `b.Loop()`.
3. Put the operation being measured inside `b.Loop()`.
4. Keep result handling inside the loop when needed to prevent invalid optimization.
5. Do not use `b.ResetTimer()` reflexively with `b.Loop()` unless there is a documented reason.

Manual `b.N` benchmarks remain allowed for compatibility or specialized measurement.

```go
func BenchmarkEncodeLegacy(b *testing.B) {
    payload := buildPayload()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = Encode(payload)
    }
}
```

---

## 5. Setup, teardown, and timer control

### 5.1 Setup outside measured path

Setup must be excluded unless setup is the operation under test.

Examples of setup:

- building fixture data;
- opening test database;
- parsing templates;
- generating random input;
- compiling regex;
- initializing clients;
- loading config.

### 5.2 Timer controls for legacy loops

When using `b.N` loops:

- call `b.ResetTimer()` after setup;
- use `b.StopTimer()` / `b.StartTimer()` only for unavoidable per-iteration setup that must not be measured;
- do not hide expensive measured behavior in stopped sections.

### 5.3 Cleanup

Use `b.Cleanup` for benchmark resources.

```go
func BenchmarkDBQuery(b *testing.B) {
    db := openBenchmarkDB(b)
    b.Cleanup(func() { _ = db.Close() })

    for b.Loop() {
        // measured query
    }
}
```

---

## 6. Dead-code elimination and result sinks

Benchmarks MUST ensure the compiler cannot remove the work.

Preferred options:

- use returned values in a way the compiler cannot eliminate;
- validate result inside the loop when cheap;
- assign to a package-level sink only when needed;
- use `b.Loop()` where available.

Example:

```go
var benchmarkSink int

func BenchmarkCount(b *testing.B) {
    input := []byte("abcabcabc")
    for b.Loop() {
        benchmarkSink = Count(input)
    }
}
```

Do not benchmark empty loops, constant-foldable expressions, or code whose result is unused.

---

## 7. Allocation measurement

Benchmarks for hot paths SHOULD call `b.ReportAllocs()`.

Required for:

- parsers/decoders;
- serializers;
- mappers;
- logging paths;
- request handlers;
- worker pool queues;
- caches;
- cryptographic envelope processing;
- code intended to reduce memory usage.

Example:

```go
func BenchmarkMapDTOToDomain(b *testing.B) {
    b.ReportAllocs()
    dto := validDTO()

    for b.Loop() {
        _, err := MapDTOToDomain(dto)
        if err != nil {
            b.Fatal(err)
        }
    }
}
```

Allocation reductions must not trade away correctness, readability, security, or boundary validation without review.

---

## 8. Input modelling

Benchmark input MUST be representative of the performance question.

Define:

- input size;
- distribution;
- cardinality;
- valid/invalid ratio;
- Unicode/ASCII ratio for text;
- object depth for JSON/XML;
- payload size for network/event code;
- concurrency level;
- cache hit/miss ratio;
- tenant/entity counts;
- state-machine complexity.

Forbidden:

- benchmarking only tiny happy-path payloads when production uses large mixed payloads;
- using random data generated inside the measured loop;
- claiming scalability from a single input size;
- using unrealistic all-cache-hit workloads unless explicitly stated.

---

## 9. Correctness inside benchmarks

Benchmarks must not measure broken code.

Required:

- validate output once after setup or during iteration if cheap;
- fail benchmark with `b.Fatal` on unexpected error;
- keep a separate unit test for detailed correctness;
- ensure optimized implementation matches baseline when replacing algorithms.

Preferred:

```go
func BenchmarkNormalize(b *testing.B) {
    input := "../safe/../case-123"
    got, err := NormalizePath(input)
    if err != nil {
        b.Fatal(err)
    }
    if got != "case-123" {
        b.Fatalf("NormalizePath() = %q", got)
    }

    for b.Loop() {
        _, _ = NormalizePath(input)
    }
}
```

---

## 10. Benchmark matrix design

Use sub-benchmarks to represent meaningful dimensions.

Examples:

```go
func BenchmarkValidateCommand(b *testing.B) {
    cases := []struct {
        name string
        cmd  Command
    }{
        {"valid-small", validSmallCommand()},
        {"valid-large", validLargeCommand()},
        {"invalid-missing-required", invalidCommand()},
    }

    for _, tc := range cases {
        b.Run(tc.name, func(b *testing.B) {
            b.ReportAllocs()
            for b.Loop() {
                _ = ValidateCommand(tc.cmd)
            }
        })
    }
}
```

Matrix dimensions SHOULD be small and meaningful. Do not create massive benchmark matrices that obscure signal.

---

## 11. Concurrency benchmarks

### 11.1 Parallel benchmarks

Use `b.RunParallel` for CPU/concurrency-sensitive code where parallelism is the subject.

Rules:

1. State accessed by workers must be concurrency-safe or intentionally read-only.
2. Per-worker setup must be separated from measured operation when possible.
3. The benchmark must declare `GOMAXPROCS`, worker count, and shared resource assumptions in result notes.
4. Do not use `RunParallel` to hide unsafely shared mutable state.

Example:

```go
func BenchmarkCacheGet_Parallel(b *testing.B) {
    cache := buildReadOnlyCache()
    b.ReportAllocs()

    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _, _ = cache.Get("case-123")
        }
    })
}
```

### 11.2 Contention benchmarks

When measuring locks, channels, queues, or worker pools, report:

- goroutine count;
- buffer size;
- contention ratio;
- read/write mix;
- critical section shape;
- cancellation behavior if relevant.

---

## 12. I/O and network benchmarks

Microbenchmarks for real network, disk, DNS, external APIs, or databases are often misleading.

Rules:

1. Use in-memory fakes for pure CPU serialization/parsing benchmarks.
2. Use explicit integration/performance tests for real I/O.
3. Do not benchmark public internet endpoints.
4. Do not make production latency claims from local loopback only.
5. Include timeout and resource configuration in benchmark notes.
6. Separate latency, throughput, and allocation goals.

For HTTP benchmarks, use `httptest` only for handler overhead; do not confuse it with real network capacity.

---

## 13. Database benchmarks

Database benchmarks must declare:

- database engine and version;
- schema/migration version;
- index state;
- dataset size;
- connection pool settings;
- transaction isolation;
- warm/cold cache assumption;
- query parameters;
- row count returned;
- container/host resources.

Do not compare SQL implementations using empty tables or unrealistic indexes unless the benchmark question is specifically about empty-table overhead.

---

## 14. Profiling and diagnostics

When benchmark results are unexpected or optimization is non-trivial, collect profiles.

Useful commands:

```bash
go test -bench=. -benchmem -run=^$ ./...
go test -bench=BenchmarkName -benchmem -cpuprofile cpu.out -memprofile mem.out ./pkg

go tool pprof cpu.out
go tool pprof mem.out
```

Use runtime tracing for scheduler/goroutine/blocking investigations:

```bash
go test -run=^$ -bench=BenchmarkPipeline -trace trace.out ./pkg
go tool trace trace.out
```

Profiling evidence is required for changes involving:

- complex concurrency optimization;
- allocation reduction in hot paths;
- unsafe usage;
- pooling;
- custom parser/serializer;
- cache design;
- replacing standard library behavior.

---

## 15. Statistical comparison

Benchmark results must be compared across multiple runs.

Preferred:

```bash
go test -bench=. -benchmem -count=10 ./pkg > old.txt
go test -bench=. -benchmem -count=10 ./pkg > new.txt
benchstat old.txt new.txt
```

Rules:

1. Do not claim improvement from a single noisy run.
2. Report ns/op, B/op, allocs/op, and relevant custom metrics.
3. Include machine/OS/Go version when performance evidence matters.
4. Explain trade-offs: memory vs CPU, latency vs throughput, readability vs complexity.
5. If results are statistically insignificant, say so.

---

## 16. Custom metrics

Benchmarks may report custom metrics with `b.ReportMetric`.

Examples:

- bytes/sec;
- rows/sec;
- events/sec;
- cases/sec;
- validations/sec;
- cache hit ratio;
- compressed bytes/op.

Rules:

- metric unit must be clear;
- denominator must match operation semantics;
- do not duplicate standard metrics confusingly;
- do not report business metrics from unrealistic input.

---

## 17. Benchmark environment notes

For actionable benchmark reports, include:

- Go version;
- OS/architecture;
- CPU model or container CPU limit;
- memory limit;
- `GOMAXPROCS`;
- relevant environment variables;
- dependency versions;
- test command;
- input dataset description.

For containerized benchmarks, include CPU quota awareness and whether the benchmark ran under the same constraints as production.

---

## 18. Optimization rules

Optimization is allowed only when it preserves:

- correctness;
- security;
- maintainability;
- observability;
- cancellation behavior;
- boundary validation;
- stable API contract.

Forbidden optimization shortcuts:

- removing validation without proof it is redundant;
- using `unsafe` without reviewed invariant and tests;
- pooling objects that retain secrets or large buffers unsafely;
- sacrificing authorization checks for speed;
- removing context checks in loops that can run long;
- reducing logs/metrics required for auditability without approval.

---

## 19. Performance regression gates

Projects with performance-sensitive code SHOULD define thresholds.

Examples:

- max allocations per operation;
- max latency per operation under benchmark conditions;
- min throughput for parser/mapper/event processor;
- max memory retained after workload;
- no statistically significant regression greater than agreed percentage.

Regression gates must be realistic. A noisy benchmark is not a reliable merge gate until stabilized.

---

## 20. Anti-patterns

The following are forbidden unless explicitly approved:

- Benchmarks with no clear question.
- Benchmarks that ignore errors.
- Benchmarks whose results can be optimized away.
- Random data generation inside measured loop.
- Network/database benchmark with undocumented environment.
- Single-run performance claims.
- Comparing benchmark outputs across different machines without saying so.
- Microbenchmarking code while claiming whole-system performance.
- Using `time.Now()` manually around operations when `testing.B` is appropriate.
- Removing safety checks only to win benchmark numbers.
- Pooling everything by default.
- Using `unsafe` based only on microbenchmark improvement.

---

## 21. LLM implementation checklist

Before producing or modifying Go benchmarks, the LLM MUST verify:

- [ ] Benchmark has a clear performance question.
- [ ] Benchmark name describes operation and scenario.
- [ ] Input size and data shape are explicit.
- [ ] Setup is outside the measured path.
- [ ] `b.Loop()` is used for new Go 1.24+ benchmarks unless compatibility requires `b.N`.
- [ ] Result is used or validated to avoid dead-code elimination.
- [ ] Errors are checked.
- [ ] `b.ReportAllocs()` is used where allocation matters.
- [ ] Sub-benchmarks cover meaningful size/scenario dimensions.
- [ ] Concurrency benchmarks declare shared state and parallelism assumptions.
- [ ] I/O/database benchmarks document environment and do not overclaim.
- [ ] Benchmark result comparison uses multiple runs and statistical tooling.
- [ ] Optimization claims include before/after evidence.
- [ ] Correctness tests exist separately for optimized behavior.
- [ ] No security, validation, cancellation, or audit logic is removed for speed without explicit approval.
