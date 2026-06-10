# Strict Coding Standards — Go Concurrency

**File:** `strict-coding-standards__go_concurrency.md`  
**Scope:** Go goroutines, channels, synchronization, atomics, worker pools, pipelines, timers, cancellation integration, shutdown, testing, observability, and production safety.  
**Audience:** LLM coding agents, reviewers, and engineers implementing or modifying Go code.  
**Status:** Mandatory merge gate.  
**Last updated:** 2026-06-10.

---

## 0. Non-Negotiable Rule

Concurrency is not an optimization detail. In Go it is part of the correctness model.

An LLM coding agent MUST NOT introduce goroutines, channels, shared mutable state, timers, background loops, worker pools, atomics, or asynchronous callbacks unless it can answer all of the following:

1. Who owns the goroutine?
2. Who cancels it?
3. Who waits for it?
4. Who owns and closes each channel?
5. What bounds memory, queue size, goroutine count, and retry rate?
6. How are errors propagated?
7. What happens during shutdown?
8. What happens under timeout, cancellation, panic, partial failure, and slow consumer?
9. What invariant prevents data races?
10. How is the behavior tested without relying on timing luck?

If any answer is missing, the agent MUST NOT implement the concurrent design.

---

## 1. Source Authority

This standard is derived from the official Go memory model, package documentation, Go blog concurrency patterns, Go race detector documentation, and official package docs for `sync`, `sync/atomic`, `context`, and `testing`.

Primary references:

- Go Memory Model: https://go.dev/ref/mem
- Data Race Detector: https://go.dev/doc/articles/race_detector
- Go Concurrency Patterns: Pipelines and cancellation: https://go.dev/blog/pipelines
- Go Concurrency Patterns: Context: https://go.dev/blog/context
- `sync` package: https://pkg.go.dev/sync
- `sync/atomic` package: https://pkg.go.dev/sync/atomic
- `context` package: https://pkg.go.dev/context
- `errgroup` package: https://pkg.go.dev/golang.org/x/sync/errgroup
- Go 1.25 release notes for `WaitGroup.Go` and vet waitgroup analyzer: https://go.dev/doc/go1.25
- Go code review concurrency notes: https://go.dev/wiki/CodeReviewConcurrency

---

## 2. Mental Model Required Before Writing Concurrent Go

### 2.1 Concurrency Is Structure, Not `go` Keyword Usage

The agent MUST treat `go f()` as spawning a new lifetime that requires explicit ownership.

Forbidden:

```go
go doSomething()
```

unless all of these are true:

- the goroutine cannot leak;
- it has a cancellation path;
- its errors are intentionally ignored and documented;
- it cannot panic outside a recovery boundary;
- its completion is not required for correctness;
- it does not mutate shared state unsafely.

Preferred:

```go
g, ctx := errgroup.WithContext(ctx)

g.Go(func() error {
    return worker.Run(ctx)
})

if err := g.Wait(); err != nil {
    return err
}
```

### 2.2 Happens-Before Is the Real Contract

The agent MUST reason in terms of happens-before relationships:

- mutex unlock happens-before a later lock on the same mutex;
- channel send happens-before the corresponding receive;
- channel close happens-before receive observing the close;
- atomic operations synchronize only when used correctly;
- goroutine creation alone is not sufficient to publish future writes;
- `time.Sleep` is never synchronization.

Forbidden:

```go
go func() {
    ready = true
}()

time.Sleep(10 * time.Millisecond)
if ready {
    // race-prone and nondeterministic
}
```

Required:

```go
ready := make(chan struct{})

go func() {
    defer close(ready)
    // publish state here
}()

<-ready
```

### 2.3 No Data Race Is a Hard Requirement

A Go program with a data race is incorrect even if it “works locally”.

The agent MUST assume code is wrong if the same variable can be accessed by multiple goroutines and at least one access is a write, unless every access is protected by one of:

- `sync.Mutex` / `sync.RWMutex`;
- channel ownership transfer;
- `sync/atomic` with a complete documented invariant;
- immutable-after-publication discipline;
- thread-confined actor/owner goroutine.

---

## 3. Goroutine Lifecycle Standard

### 3.1 Every Goroutine Must Have an Owner

Every goroutine MUST be associated with one of these owner types:

| Owner            | Valid Example        | Required Completion Rule                                               |
| ---------------- | -------------------- | ---------------------------------------------------------------------- |
| request scoped   | HTTP handler subtask | must finish before request returns or when request context is canceled |
| component scoped | service worker       | must stop on component shutdown                                        |
| process scoped   | metrics exporter     | must stop on process shutdown or be documented as process lifetime     |
| test scoped      | async test helper    | must be waited or leak-checked before test ends                        |

Forbidden:

```go
func (s *Service) Start() {
    go s.loop()
}
```

Required:

```go
func (s *Service) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return s.loop(ctx) })
    return g.Wait()
}
```

### 3.2 No Fire-and-Forget Without Justification

Fire-and-forget goroutines are forbidden except for truly process-lifetime infrastructure where:

- the lifetime is explicitly documented;
- panic is recovered and logged;
- failure is observable;
- shutdown semantics are intentionally unnecessary or handled elsewhere.

Forbidden in business code:

```go
go auditClient.Send(event)
return nil
```

Required alternatives:

- persist an outbox event transactionally;
- enqueue into a bounded worker owned by the component;
- wait for completion if the result affects correctness.

### 3.3 Goroutines Must Not Outlive Their Inputs

A goroutine MUST NOT capture request-local objects, buffers, database transactions, response writers, or mutable slices/maps if it can outlive the owner.

Forbidden:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        log.Println(r.Body) // request lifetime violation
    }()
}
```

Required:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    reqID := requestIDFrom(r)
    enqueueAudit(reqID)
}
```

### 3.4 Panic Boundary

A goroutine that is started by infrastructure code and not directly waited by the caller MUST have a panic boundary that records the failure.

```go
func runBackground(ctx context.Context, log Logger, fn func(context.Context) error) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Error("background goroutine panic", "panic", r)
            }
        }()
        if err := fn(ctx); err != nil && !errors.Is(err, context.Canceled) {
            log.Error("background goroutine failed", "error", err)
        }
    }()
}
```

Panic recovery MUST NOT be used to hide programmer errors in request-scoped code. Prefer returning errors through `errgroup`.

---

## 4. WaitGroup Standard

### 4.1 Prefer `errgroup` When Errors Matter

If subtasks can fail and failure should cancel siblings, use `errgroup.WithContext`.

Required:

```go
g, ctx := errgroup.WithContext(ctx)

for _, job := range jobs {
    job := job
    g.Go(func() error {
        return processJob(ctx, job)
    })
}

if err := g.Wait(); err != nil {
    return fmt.Errorf("process jobs: %w", err)
}
```

### 4.2 Use `sync.WaitGroup` Only for Completion Coordination

`sync.WaitGroup` MUST only be used when:

- no error propagation is needed;
- no cancellation coupling is needed;
- every task completion is independent;
- panic is impossible or handled elsewhere.

### 4.3 Go 1.25+: `WaitGroup.Go` Rule

For Go 1.25+ code, `wg.Go` MAY be used for fire-and-wait subtasks without error propagation.

Allowed:

```go
var wg sync.WaitGroup

for _, item := range items {
    item := item
    wg.Go(func() {
        process(item)
    })
}

wg.Wait()
```

Mandatory constraints:

- the function passed to `WaitGroup.Go` MUST NOT panic;
- do not use `WaitGroup.Go` when errors must be returned;
- do not use it as a worker-pool substitute;
- do not mutate shared state unless synchronized;
- capture loop variables explicitly.

### 4.4 Pre-Go 1.25 or Manual Pattern

When using manual `Add`/`Done`, `Add` MUST happen before starting the goroutine.

Forbidden:

```go
go func() {
    wg.Add(1) // wrong: race with Wait
    defer wg.Done()
    work()
}()
wg.Wait()
```

Required:

```go
wg.Add(1)
go func() {
    defer wg.Done()
    work()
}()
wg.Wait()
```

### 4.5 WaitGroup Must Not Be Copied

Types containing `sync.WaitGroup`, `sync.Mutex`, `sync.RWMutex`, `sync.Cond`, `sync.Once`, `sync.Pool`, or atomic values MUST NOT be copied after first use.

Forbidden:

```go
type Runner struct {
    wg sync.WaitGroup
}

func (r Runner) Start() { // value receiver copies WaitGroup
    r.wg.Add(1)
}
```

Required:

```go
type Runner struct {
    wg sync.WaitGroup
}

func (r *Runner) Start() {
    r.wg.Add(1)
}
```

---

## 5. Channel Standard

### 5.1 Channel Ownership Must Be Explicit

For every channel, the agent MUST know:

- who sends;
- who receives;
- who closes;
- whether it is buffered;
- why the buffer size is correct;
- how cancellation unblocks senders and receivers.

### 5.2 Only the Sender Owner Closes the Channel

Receivers MUST NOT close channels they do not own.

Forbidden:

```go
func consume(ch chan Job) {
    defer close(ch) // receiver closing producer-owned channel
    for job := range ch {
        process(job)
    }
}
```

Required:

```go
func produce(ctx context.Context, jobs []Job) <-chan Job {
    out := make(chan Job)
    go func() {
        defer close(out)
        for _, job := range jobs {
            select {
            case out <- job:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

### 5.3 Never Send on Possibly Closed Channel

Code MUST be structured so that sends complete before close. Do not “check if closed” because that is inherently racy.

Required pattern:

```go
var wg sync.WaitGroup
out := make(chan Result)

for _, in := range inputs {
    in := in
    wg.Add(1)
    go func() {
        defer wg.Done()
        out <- process(in)
    }()
}

go func() {
    wg.Wait()
    close(out)
}()
```

### 5.4 Buffered Channels Require Capacity Rationale

Every buffered channel MUST have a documented reason for its capacity.

Bad:

```go
queue := make(chan Job, 100000)
```

Better:

```go
// Capacity equals max workers * 2 to allow limited prefetch without hiding backpressure.
queue := make(chan Job, workerCount*2)
```

### 5.5 Channel Is Not a Queue Replacement by Default

For durable business work, a channel is not enough. Use a transactional outbox, message broker, database-backed queue, or persisted work table when work must survive process crash.

Forbidden for regulatory/business-critical dispatch:

```go
events := make(chan EnforcementEvent, 1000)
```

unless event loss on process crash is explicitly acceptable.

### 5.6 Directional Channels in APIs

Function signatures MUST use directional channels when ownership is one-way.

```go
func produce(ctx context.Context) <-chan Event
func consume(ctx context.Context, in <-chan Event) error
func dispatch(ctx context.Context, out chan<- Event, e Event) error
```

### 5.7 Nil Channel Use Must Be Intentional

Using a nil channel to disable a select case is allowed only when documented and local.

```go
var retry <-chan time.Time
if shouldRetry {
    retry = timer.C
}

select {
case <-retry:
    // retry enabled
case <-ctx.Done():
    return ctx.Err()
}
```

Do not store nil channels in struct state unless the state machine is explicit and tested.

---

## 6. Cancellation-Aware Concurrency

### 6.1 Blocking Operations Must Observe Cancellation

Every potentially blocking send, receive, wait, retry, sleep, lock acquisition abstraction, queue operation, network call, DB call, or external call MUST have a cancellation path.

Forbidden:

```go
jobs <- job
```

Required:

```go
select {
case jobs <- job:
    return nil
case <-ctx.Done():
    return ctx.Err()
}
```

Forbidden:

```go
time.Sleep(delay)
```

Required:

```go
timer := time.NewTimer(delay)
defer timer.Stop()

select {
case <-timer.C:
    return nil
case <-ctx.Done():
    return ctx.Err()
}
```

### 6.2 Cancellation Must Unblock Producers and Consumers

Pipeline stages MUST stop consuming and producing when context is canceled.

Required:

```go
func stage(ctx context.Context, in <-chan Item) <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case item, ok := <-in:
                if !ok {
                    return
                }
                result := transform(item)
                select {
                case out <- result:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return out
}
```

### 6.3 Do Not Start Work After Cancellation

Before launching expensive subtasks, check context if cancellation is likely or meaningful.

```go
if err := ctx.Err(); err != nil {
    return err
}
```

This is not a replacement for cancellation-aware blocking operations.

---

## 7. Worker Pool Standard

### 7.1 Worker Pools Must Be Bounded

Unbounded goroutine creation over user input, DB rows, API results, messages, or files is forbidden.

Forbidden:

```go
for _, job := range jobs {
    go process(job)
}
```

Required:

```go
func ProcessAll(ctx context.Context, jobs []Job, workers int) error {
    if workers <= 0 {
        return errors.New("workers must be positive")
    }

    g, ctx := errgroup.WithContext(ctx)
    queue := make(chan Job)

    g.Go(func() error {
        defer close(queue)
        for _, job := range jobs {
            select {
            case queue <- job:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        return nil
    })

    for range workers {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case job, ok := <-queue:
                    if !ok {
                        return nil
                    }
                    if err := process(ctx, job); err != nil {
                        return err
                    }
                }
            }
        })
    }

    return g.Wait()
}
```

### 7.2 Pool Size Must Be Justified

Worker count MUST be derived from workload type:

| Workload     | Worker Count Guideline                                              |
| ------------ | ------------------------------------------------------------------- |
| CPU-bound    | around `runtime.GOMAXPROCS(0)` or measured value                    |
| I/O-bound    | bounded by downstream capacity, connection pool, rate limit, or SLA |
| DB-bound     | not greater than available DB pool budget                           |
| external API | bounded by provider quota and retry policy                          |
| memory-heavy | bounded by memory budget, not CPU count                             |

Do not blindly use `runtime.NumCPU()`.

### 7.3 Backpressure Must Be Explicit

A worker pool MUST define what happens when producers are faster than consumers:

- block producer;
- reject with overload error;
- shed low-priority work;
- persist work durably;
- throttle upstream;
- apply bounded retry.

Unbounded buffering is forbidden.

### 7.4 Worker Pools Must Support Shutdown

Long-lived worker pools MUST provide:

- `Run(ctx context.Context) error` or equivalent;
- `Close`/`Stop` only if needed and idempotent;
- graceful drain policy;
- cancellation policy;
- metrics for queue depth, active workers, failures, and dropped tasks.

---

## 8. Pipeline Standard

### 8.1 Pipeline Stages Must Own Their Output Channel

Each stage that creates an output channel MUST close it.

```go
func mapStage(ctx context.Context, in <-chan A) <-chan B {
    out := make(chan B)
    go func() {
        defer close(out)
        for a := range in {
            b := mapAtoB(a)
            select {
            case out <- b:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

### 8.2 Pipeline Must Handle Early Consumer Exit

If downstream stops early, upstream MUST be canceled or drained. Cancellation is preferred.

Forbidden:

```go
for v := range results {
    if enough(v) {
        return v, nil // upstream goroutines may block forever
    }
}
```

Required:

```go
ctx, cancel := context.WithCancel(ctx)
defer cancel()

for v := range results {
    if enough(v) {
        return v, nil
    }
}
```

### 8.3 Fan-In Must Close Output After All Inputs Finish

```go
func merge[T any](ctx context.Context, inputs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup

    for _, input := range inputs {
        input := input
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range input {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

---

## 9. Shared State Standard

### 9.1 Prefer Ownership Over Shared Mutation

The agent MUST choose one clear state ownership model:

1. immutable data shared freely;
2. state owned by one goroutine, mutated through messages;
3. state guarded by mutex;
4. state updated with atomics;
5. state stored in an external transactional system.

Mixing models without a documented invariant is forbidden.

### 9.2 Mutex Is Often Better Than Channel

Use a mutex when protecting a small critical section of in-memory state.

Required:

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

Do not create an owner goroutine and channel just to increment a counter unless serialization itself is part of the domain model.

### 9.3 Locking Rules

Mandatory:

- keep critical sections small;
- do not hold locks while doing network I/O, database calls, logging with blocking sinks, callbacks, or user-provided functions;
- document lock ordering when multiple locks exist;
- prefer `defer Unlock` unless performance measurement justifies manual unlock;
- do not expose references to protected mutable state.

Forbidden:

```go
s.mu.Lock()
err := s.remote.Call(ctx) // lock held over external I/O
s.mu.Unlock()
return err
```

Required:

```go
s.mu.Lock()
snapshot := s.snapshotLocked()
s.mu.Unlock()

return s.remote.Call(ctx, snapshot)
```

### 9.4 RWMutex Must Be Justified

`sync.RWMutex` MUST only be used when there is measured or obvious read-heavy contention. `sync.Mutex` is the default.

RWMutex is not a free optimization; it can make write latency and complexity worse.

### 9.5 Do Not Return Internal Mutable State

Forbidden:

```go
func (s *Store) Items() map[string]Item {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.items
}
```

Required:

```go
func (s *Store) Items() map[string]Item {
    s.mu.Lock()
    defer s.mu.Unlock()

    out := make(map[string]Item, len(s.items))
    for k, v := range s.items {
        out[k] = v
    }
    return out
}
```

---

## 10. Atomic Standard

### 10.1 Atomic Is Not a Shortcut Around Design

`sync/atomic` MUST only be used for simple, well-documented invariants.

Allowed examples:

- counters;
- gauges;
- flags;
- sequence numbers;
- immutable pointer publication;
- lock-free fast path with strong tests.

Forbidden examples:

- multi-field state transitions without a single atomic owner;
- business workflow transitions requiring validation;
- replacing mutexes for readability-free micro-optimizations;
- mixing atomic and non-atomic access to the same variable.

### 10.2 Use Typed Atomics

Prefer typed atomic values such as `atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]` when available.

```go
type Metrics struct {
    processed atomic.Int64
    closed    atomic.Bool
}
```

### 10.3 Never Mix Atomic and Non-Atomic Access

Forbidden:

```go
var closed atomic.Bool

if closed.Load() {
    return
}

closed = atomic.Bool{} // non-atomic replacement of shared state
```

### 10.4 Atomic Multi-Field State Requires a Snapshot Object

If multiple fields must change consistently, publish an immutable snapshot pointer.

```go
type Config struct {
    Limit int
    Mode  string
}

var current atomic.Pointer[Config]

func LoadConfig() Config {
    cfg := current.Load()
    if cfg == nil {
        return Config{}
    }
    return *cfg
}

func StoreConfig(cfg Config) {
    current.Store(&cfg)
}
```

The pointed-to object MUST be immutable after publication.

---

## 11. `sync.Map` Standard

`sync.Map` is allowed only when its usage matches the documented specialized cases:

- entries are written once and read many times;
- disjoint goroutines operate on disjoint key sets;
- avoiding lock contention is justified.

For ordinary maps, use `map` plus `sync.Mutex`.

Forbidden default:

```go
type Store struct {
    m sync.Map // used because agent wanted to avoid thinking about locking
}
```

Required default:

```go
type Store struct {
    mu sync.Mutex
    m  map[string]Value
}
```

---

## 12. `sync.Once` Standard

`sync.Once` MUST be used only for idempotent one-time initialization.

Rules:

- do not hide retryable initialization behind `Once` unless failure is cached intentionally;
- do not call user callbacks while holding hidden initialization locks without documentation;
- expose failure semantics clearly.

Problematic:

```go
var once sync.Once
var client *Client
var initErr error

func GetClient() (*Client, error) {
    once.Do(func() {
        client, initErr = NewClient()
    })
    return client, initErr
}
```

If `NewClient` fails transiently, all future calls return the same failure. That may be acceptable only when documented.

---

## 13. `sync.Cond` Standard

`sync.Cond` is advanced and MUST NOT be generated casually by an LLM.

Use channels for one-time notification or simple queues. Use `sync.Cond` only when:

- multiple goroutines wait for a predicate;
- the predicate is protected by a lock;
- spurious wakeup/recheck loop is implemented;
- tests cover missed-signal scenarios.

Required pattern:

```go
c.L.Lock()
for !condition() {
    c.Wait()
}
// condition is true while lock is held
c.L.Unlock()
```

---

## 14. `sync.Pool` Standard

`sync.Pool` is a performance optimization, not an ownership mechanism.

Rules:

- never put objects containing secrets into a pool unless securely reset;
- reset all fields before putting back;
- never use an object after `Put`;
- never assume pooled objects remain available;
- benchmark before and after;
- do not pool tiny objects unless allocation profile proves benefit.

Forbidden:

```go
buf := pool.Get().(*bytes.Buffer)
pool.Put(buf)
return buf.String() // use-after-Put pattern risk
```

Required:

```go
buf := pool.Get().(*bytes.Buffer)
buf.Reset()
defer func() {
    buf.Reset()
    pool.Put(buf)
}()
```

---

## 15. Timer and Ticker Standard

### 15.1 Prefer Context-Aware Timer Over Sleep

`time.Sleep` in production workflow code is forbidden unless the delay is not cancelable by design and documented.

Required:

```go
func wait(ctx context.Context, d time.Duration) error {
    timer := time.NewTimer(d)
    defer timer.Stop()

    select {
    case <-timer.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

### 15.2 Tickers Must Be Stopped

Forbidden:

```go
for range time.Tick(time.Minute) {
    collect()
}
```

Required:

```go
ticker := time.NewTicker(time.Minute)
defer ticker.Stop()

for {
    select {
    case <-ticker.C:
        collect()
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

### 15.3 Timer Reset Requires Correct Drain Semantics

If manually resetting timers, the code MUST follow current `time.Timer` documentation and be covered by tests. Prefer creating a new timer in simple code.

LLM agents SHOULD avoid clever reusable timer code unless performance requires it.

---

## 16. Select Standard

### 16.1 Select Must Handle Cancellation

Any `select` inside request/component scoped work SHOULD include `ctx.Done()` unless the operation is intentionally non-cancelable.

```go
select {
case msg := <-messages:
    return handle(msg)
case <-ctx.Done():
    return ctx.Err()
}
```

### 16.2 Default Case Is Dangerous

A `default` case in `select` can create busy loops or dropped work. It MUST be justified.

Forbidden:

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    default:
    }
}
```

Required if polling is intentional:

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-ctx.Done():
        return ctx.Err()
    case <-ticker.C:
        poll()
    }
}
```

### 16.3 Do Not Depend on Select Fairness for Correctness

When multiple cases are ready, Go pseudo-randomly chooses a ready case. Code MUST NOT require strict priority unless encoded explicitly.

---

## 17. Error Propagation Standard

### 17.1 Concurrent Work Must Have an Error Policy

Every concurrent structure MUST choose one:

| Policy             | When Valid                                   |
| ------------------ | -------------------------------------------- |
| fail-fast          | first error cancels siblings                 |
| collect-all        | all tasks finish, all errors returned        |
| best-effort        | errors logged/recorded, result continues     |
| retry              | bounded retry with backoff and observability |
| dead-letter/outbox | durable failure handling                     |

Silent drop is forbidden.

### 17.2 Prefer `errgroup` for Fail-Fast

```go
g, ctx := errgroup.WithContext(ctx)
for _, task := range tasks {
    task := task
    g.Go(func() error {
        return task.Run(ctx)
    })
}
return g.Wait()
```

### 17.3 Best-Effort Must Be Observable

Best-effort concurrent work MUST record failures through metrics, logs, traces, or durable failure records.

Forbidden:

```go
go func() { _ = sendEmail(ctx, msg) }()
```

Required:

```go
g.Go(func() error {
    if err := sendEmail(ctx, msg); err != nil {
        metrics.EmailSendFailures.Add(ctx, 1)
        log.Warn("send email failed", "error", err)
    }
    return nil
})
```

---

## 18. Rate Limit, Retry, and Backoff Standard

Concurrent retry can become an outage amplifier.

Mandatory:

- retry count must be bounded;
- backoff must be bounded;
- jitter SHOULD be used for distributed clients;
- retry must respect context cancellation;
- do not retry non-idempotent operations unless idempotency is guaranteed;
- coordinate retries with worker pool size and downstream rate limits.

Forbidden:

```go
for {
    err := call()
    if err == nil {
        return nil
    }
}
```

Required shape:

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    if err := ctx.Err(); err != nil {
        return err
    }

    err := call(ctx)
    if err == nil {
        return nil
    }
    if !retryable(err) {
        return err
    }

    if err := wait(ctx, backoff(attempt)); err != nil {
        return err
    }
}
```

---

## 19. Deadlock and Leak Prevention

### 19.1 Common Deadlock Patterns Are Forbidden

Forbidden patterns:

- send on unbuffered channel with no guaranteed receiver;
- range over channel that is never closed;
- `Wait` before all `Add` calls have happened;
- lock inversion;
- holding lock while waiting for goroutine that needs the same lock;
- goroutine blocked on send after downstream exits;
- ticker loop without context;
- nil channel accidentally used in select.

### 19.2 Goroutine Leak Tests

Code that starts background goroutines SHOULD include leak-oriented tests.

Acceptable approaches:

- test shutdown with context cancellation and `Wait`;
- use short deadlines only as test guardrails, not correctness mechanism;
- use leak detection library only if project standard allows it;
- use `testing/synctest` for deterministic concurrency where applicable.

### 19.3 No Sleep-Based Tests

Forbidden:

```go
go worker()
time.Sleep(100 * time.Millisecond)
assert.Equal(t, 1, count)
```

Required:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    worker()
}()

select {
case <-done:
case <-time.After(time.Second):
    t.Fatal("worker did not complete")
}
```

Timeouts in tests are only safety nets, not synchronization.

---

## 20. Race Detector Standard

The agent MUST ensure race-sensitive changes can pass:

```bash
go test -race ./...
```

For code introducing concurrency, the agent MUST add or update tests that exercise:

- concurrent read/write paths;
- cancellation while blocked;
- shutdown while work is in progress;
- error path while sibling goroutines are active;
- queue full / slow consumer behavior;
- repeated start/stop if component lifecycle allows it.

The agent MUST NOT dismiss race detector failures as flaky without root cause analysis.

---

## 21. Loop Variable Capture Standard

Even though modern Go versions changed range loop variable semantics, the agent MUST capture loop values explicitly in goroutine code for clarity and compatibility with older code or non-obvious loops.

Required:

```go
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
```

This rule is mandatory for readability and migration safety.

---

## 22. Concurrency and Maps/Slices

### 22.1 Maps Are Not Safe for Concurrent Mutation

Concurrent map access where one goroutine writes is forbidden unless protected.

Forbidden:

```go
m := map[string]int{}
go func() { m["a"]++ }()
go func() { _ = m["a"] }()
```

Required:

```go
type SafeMap struct {
    mu sync.Mutex
    m  map[string]int
}
```

### 22.2 Slices Share Backing Arrays

Passing a slice to another goroutine can share mutable memory.

Forbidden:

```go
go process(buf)
buf = append(buf[:0], next...)
```

Required:

```go
owned := append([]byte(nil), buf...)
go process(owned)
```

Use copying at goroutine boundaries when ownership is not exclusive.

---

## 23. Concurrent I/O Standard

### 23.1 `io.Reader` and `io.Writer` Safety Is Type-Specific

Do not assume readers/writers are safe for concurrent use.

Rules:

- check package docs before concurrent access;
- serialize writes to non-concurrent writers;
- never concurrently write to `bytes.Buffer`;
- do not concurrently use request/response bodies unless documented;
- database connection pools are concurrent-safe, individual transactions are not generally safe for arbitrary concurrent use.

### 23.2 Logging Must Not Become a Blocking Failure

High-volume concurrent logging MUST be bounded and structured. Do not log inside hot locks or tight retry loops without rate limiting.

---

## 24. Graceful Shutdown Standard

Long-running services MUST implement shutdown as a state transition, not a boolean afterthought.

Required stages:

1. stop accepting new work;
2. cancel or close intake channels;
3. wait for in-flight work within budget;
4. flush/commit/rollback resources;
5. release external connections;
6. report unfinished work if any.

Example:

```go
func (s *Server) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    g.Go(func() error { return s.httpServer.Run(ctx) })
    g.Go(func() error { return s.workerPool.Run(ctx) })

    return g.Wait()
}
```

Shutdown MUST be idempotent if exposed publicly.

---

## 25. Observability Standard

Every long-lived concurrent component MUST expose enough signals to diagnose saturation and leaks:

- active goroutines/workers;
- queue depth;
- queue capacity;
- dropped/rejected tasks;
- in-flight jobs;
- cancellation count;
- timeout count;
- retry count;
- processing latency;
- panic/failure count;
- shutdown duration.

Do not add metrics with unbounded labels such as raw user IDs, case IDs, request IDs, filenames, or arbitrary error strings.

---

## 26. Regulatory / Workflow Concurrency Standard

For regulatory systems, enforcement lifecycle systems, case management systems, workflow engines, and escalation logic, concurrency MUST preserve domain invariants.

Mandatory:

- state transitions must be monotonic unless reversal is explicit;
- concurrent commands must be idempotent or conflict-detected;
- version checks or optimistic locking must protect aggregate updates;
- asynchronous side effects must not commit before the authoritative state change unless designed as saga/outbox;
- retries must not duplicate irreversible actions;
- event ordering assumptions must be explicit;
- stale reads must not authorize invalid transitions.

Forbidden:

```go
go notifyOfficer(caseID)
_ = repo.UpdateStatus(ctx, caseID, StatusEscalated)
```

Required:

```go
if err := repo.WithTx(ctx, func(tx Tx) error {
    c, err := tx.GetCaseForUpdate(ctx, caseID)
    if err != nil {
        return err
    }
    if err := c.Escalate(now); err != nil {
        return err
    }
    if err := tx.SaveCase(ctx, c); err != nil {
        return err
    }
    return tx.AppendOutbox(ctx, CaseEscalated{CaseID: caseID, Version: c.Version})
}); err != nil {
    return err
}
```

---

## 27. Testing Matrix

Concurrency changes MUST include tests covering the relevant rows:

| Scenario                                   | Required?                   |
| ------------------------------------------ | --------------------------- |
| normal completion                          | always                      |
| cancellation before start                  | when context is accepted    |
| cancellation while blocked on send/receive | when channels are used      |
| cancellation during external call          | when I/O is used            |
| first worker error cancels siblings        | when using fail-fast policy |
| slow consumer                              | when pipeline/queue exists  |
| full queue                                 | when bounded queue exists   |
| empty input                                | when batch/pipeline exists  |
| panic boundary                             | for background goroutines   |
| shutdown while in-flight                   | for long-lived components   |
| race detector                              | for all concurrency changes |
| repeated start/stop                        | for lifecycle components    |

---

## 28. Anti-Patterns

The agent MUST NOT generate these patterns:

1. naked goroutine with no owner;
2. goroutine started inside library function without caller control;
3. `time.Sleep` as synchronization;
4. unbounded goroutine per item;
5. unbounded channel buffer;
6. receiver closing producer-owned channel;
7. send on possibly closed channel;
8. ignored errors in goroutines;
9. shared map without lock;
10. mixing atomic and non-atomic access;
11. holding mutex during external I/O;
12. context ignored inside worker loop;
13. `time.Tick` in long-running code;
14. retry loop without cancellation;
15. queue as substitute for durable outbox;
16. `sync.Map` as default map;
17. copied lock or WaitGroup;
18. `default` select causing busy loop;
19. race detector failure ignored;
20. test that passes only because of timing luck.

---

## 29. LLM Implementation Checklist

Before producing code that uses concurrency, the LLM MUST verify:

- [ ] Every goroutine has an owner and termination path.
- [ ] Every blocking operation observes cancellation or is intentionally non-cancelable.
- [ ] Every channel has a single close owner.
- [ ] Every buffered channel has capacity rationale.
- [ ] Error policy is explicit.
- [ ] Worker count is bounded and justified.
- [ ] Shared state has a synchronization invariant.
- [ ] No map/slice mutable aliasing crosses goroutine boundary unsafely.
- [ ] No lock is held during external I/O.
- [ ] No `time.Sleep` is used for synchronization.
- [ ] Timers and tickers are stopped.
- [ ] Race-sensitive paths have tests.
- [ ] Shutdown behavior is implemented.
- [ ] Metrics/logs/traces are sufficient for diagnosing leaks and saturation.
- [ ] Regulatory/domain state transitions remain deterministic and defensible.

---

## 30. Reviewer Checklist

A reviewer MUST reject concurrency code if:

- goroutine lifetime is implicit;
- cancellation does not unblock work;
- channel close ownership is unclear;
- shared state is not protected;
- error propagation is missing;
- test uses sleep as correctness proof;
- retry/backoff can amplify outage;
- queue can grow without bound;
- shutdown can hang indefinitely;
- code relies on scheduling luck;
- domain invariants are weakened by async side effects.

---

## 31. Standard Decision Table

| Problem                                  | Preferred Go Pattern                          |
| ---------------------------------------- | --------------------------------------------- |
| parallel subtasks with error propagation | `errgroup.WithContext`                        |
| wait for tasks without errors            | `sync.WaitGroup` / `WaitGroup.Go` in Go 1.25+ |
| protect small shared state               | `sync.Mutex`                                  |
| read-heavy measured shared state         | `sync.RWMutex`                                |
| publish immutable config                 | `atomic.Pointer[T]`                           |
| simple counter/gauge                     | typed atomic                                  |
| bounded parallel processing              | worker pool + context + errgroup              |
| staged data processing                   | pipeline with cancellation                    |
| durable async business event             | transactional outbox, not channel             |
| one-time initialization                  | `sync.Once` with documented error semantics   |
| repeated notification on predicate       | `sync.Cond` only with expert review           |
| temporary object reuse                   | `sync.Pool` only after profiling              |

---

## 32. Final Rule

Concurrent Go code is acceptable only when its lifecycle, ownership, synchronization, cancellation, error propagation, shutdown, and test strategy are explicit.

If the agent cannot prove those properties, it MUST choose a sequential implementation first.
