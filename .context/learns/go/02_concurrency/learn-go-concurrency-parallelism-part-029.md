# learn-go-concurrency-parallelism-part-029.md

# Part 029 — Designing Concurrent APIs: Ownership, Lifecycle, Context, Backpressure, and Compatibility

> Target pembaca: Java software engineer yang ingin mampu merancang API Go yang aman dipakai secara concurrent oleh tim lain: jelas ownership-nya, jelas lifecycle-nya, jelas cancellation/backpressure-nya, tidak bocor goroutine, tidak mengekspos mutable state, dan tidak membuat caller menebak-nebak.
>
> Fokus part ini: API concurrency contract, context-first design, Start/Stop/Wait lifecycle, channel ownership, callback under lock, iterator/snapshot semantics, worker pool API, streaming API, cache API, repository/transaction API, goroutine ownership, idempotency, backpressure, versioning, and documentation.

---

## 0. Posisi Part Ini dalam Seri

Sebelumnya:

- Part 012: ownership models.
- Part 013: worker pools.
- Part 017: concurrent data structures.
- Part 020–021: network/database boundaries.
- Part 024–025: bug hunting/testing.
- Part 028: failure modes.

Part ini masuk ke level desain API.

Banyak bug concurrency bukan berasal dari implementasi primitive yang salah, tetapi dari API yang ambigu.

Contoh API buruk:

```go
func Start()
func Stop()
func Events() chan Event
func GetConfig() *Config
func Process(job Job)
func Register(fn func(Event))
```

Pertanyaan yang tidak terjawab:
- Apakah `Start` boleh dipanggil dua kali?
- Apakah `Stop` menunggu goroutine selesai?
- Siapa yang menutup channel dari `Events`?
- Bolehkah caller mengirim ke channel?
- Apakah `*Config` boleh dimutasi?
- Apakah `Process` blocking?
- Apa yang terjadi kalau queue penuh?
- Apakah callback dipanggil di bawah lock?
- Apakah callback boleh memanggil balik API yang sama?
- Apakah `Stop` membatalkan job berjalan atau drain?
- Apakah API safe for concurrent use?

Concurrent API yang baik membuat jawaban-jawaban ini eksplisit.

---

## 1. Tujuan Pembelajaran

Setelah part ini, Anda harus mampu:

1. Mendesain API dengan concurrency contract eksplisit.
2. Mendokumentasikan apakah type safe for concurrent use.
3. Menentukan ownership:
   - caller owns,
   - callee owns,
   - ownership transfer,
   - immutable snapshot.
4. Mendesain lifecycle:
   - Start,
   - Stop,
   - Close,
   - Wait,
   - Shutdown,
   - Drain.
5. Mendesain context contract:
   - request work,
   - background work,
   - cleanup,
   - cancellation,
   - deadline.
6. Mendesain backpressure API:
   - blocking submit,
   - try submit,
   - bounded wait,
   - rejection reason.
7. Menghindari mengekspos mutable internal state.
8. Mendesain channel-returning API yang aman.
9. Mendesain callback API tanpa deadlock.
10. Mendesain iterator/range API dengan snapshot semantics.
11. Mendesain worker pool/pipeline/streaming/cache/repository APIs.
12. Menjaga compatibility ketika concurrency semantics berubah.
13. Membuat documentation checklist untuk concurrent API.

---

## 2. Mental Model: API adalah Contract, Bukan Hanya Function Signature

Function signature hanya sebagian kecil.

```go
func (p *Pool) Submit(ctx context.Context, job Job) error
```

Contract sebenarnya:
- Apakah `Submit` blocking?
- Apakah `ctx` membatalkan menunggu admission saja atau juga job execution?
- Jika `Submit` return nil, apakah job pasti akan dijalankan?
- Apa error jika pool stopped?
- Apa error jika queue full?
- Apakah job boleh dimutasi setelah submit?
- Apakah job diproses exactly once, at least once, atau best effort?
- Apakah order dijaga?
- Apakah safe dipanggil concurrent?
- Apa yang terjadi saat `Stop` berjalan bersamaan dengan `Submit`?

API concurrent yang baik menjawab ini dalam bentuk:
- type design,
- method names,
- return values,
- error types,
- docs,
- tests.

---

## 3. Java Translation

Java API concurrency contract sering muncul sebagai:
- `ExecutorService.shutdown()` vs `shutdownNow()`,
- `Future.cancel`,
- `BlockingQueue.offer` vs `put`,
- `CompletableFuture`,
- `AutoCloseable`,
- `@ThreadSafe`,
- `@NotThreadSafe`,
- immutable DTOs,
- `ConcurrentHashMap` docs,
- Reactor/Publisher backpressure.

Go equivalents:
- `context.Context`,
- `io.Closer`,
- `Shutdown(ctx)`,
- `Close() error`,
- `Wait() error`,
- channel direction,
- immutable value/copy,
- `TrySubmit`,
- `Submit(ctx)`,
- documented safe concurrent use,
- ownership transfer through channels.

Go has fewer annotations, so documentation and API shape matter more.

---

## 4. Core API Questions

For every concurrent API, answer:

1. Is it safe for concurrent use?
2. Who owns the data passed in?
3. Can caller mutate input after call?
4. Who owns returned data?
5. Is returned data a snapshot or live view?
6. Does method block?
7. What can it block on?
8. How does cancellation work?
9. What does context cancel?
10. What happens during shutdown?
11. Is order guaranteed?
12. Is work at-most-once, at-least-once, or best-effort?
13. What backpressure policy exists?
14. What errors are possible?
15. Are callbacks called concurrently?
16. Are callbacks called under lock?
17. Who closes channels?
18. Is `Close` idempotent?
19. Does `Close` wait?
20. Are resources released on error?

If docs do not say, users will infer incorrectly.

---

## 5. Documenting Safe Concurrent Use

Standard phrase:

```go
// Cache is safe for concurrent use by multiple goroutines.
type Cache struct {
    // ...
}
```

Or:

```go
// Builder is not safe for concurrent use.
type Builder struct {
    // ...
}
```

Or nuanced:

```go
// Client is safe for concurrent use. Its configuration must not be mutated
// after the first request.
type Client struct {
    // ...
}
```

This matters because Go users expect some types to be safe if they look like clients/pools, but not builders/encoders.

Examples:
- `*http.Client` is intended for reuse/concurrent use.
- `bytes.Buffer` is not safe for concurrent use.
- Your API should be equally clear.

---

## 6. Ownership of Input

### 6.1 Caller Retains Ownership

```go
func Process(data []byte) error
```

If function does not retain data after return, caller can reuse after return.

Doc:
```go
// Process reads data during the call and does not retain it after returning.
```

### 6.2 Callee Retains Reference

If function stores data:

```go
func (c *Cache) Set(key string, value []byte)
```

Danger: caller may mutate value after Set.

Options:

#### Copy on Set

```go
func (c *Cache) Set(key string, value []byte) {
    copied := append([]byte(nil), value...)
    // store copied
}
```

Doc:
```go
// Set copies value before storing it.
```

#### Ownership Transfer

```go
// Set takes ownership of value. The caller must not modify value after calling Set.
func (c *Cache) Set(key string, value []byte)
```

This is faster but risky. Use only where performance matters and users are trusted.

#### Immutable Type

Use string or immutable struct where possible.

---

## 7. Ownership of Returned Data

Bad:

```go
func (c *Cache) Get(key string) ([]byte, bool) {
    return c.items[key], true
}
```

Caller can mutate internal cache.

Options:

### 7.1 Copy on Get

```go
func (c *Cache) Get(key string) ([]byte, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()

    v, ok := c.items[key]
    if !ok {
        return nil, false
    }

    return append([]byte(nil), v...), true
}
```

### 7.2 Read-Only Convention

```go
// Get returns a value owned by the cache. The caller must not modify it.
```

But Go cannot enforce read-only slice.

### 7.3 Value Object

Return immutable value struct.

### 7.4 Borrow API

```go
func (c *Cache) WithValue(key string, fn func([]byte) error) error
```

But callback under lock risk. You can copy before callback or document callback must not retain/mutate. Usually copy is safer.

---

## 8. Context Contract

A method accepting context must document what cancellation means.

```go
func (p *Pool) Submit(ctx context.Context, job Job) error
```

Possible meanings:
1. ctx only controls waiting to enqueue.
2. ctx controls job execution too.
3. ctx controls both enqueue and execution.
4. ctx is copied into job and may cancel later.
5. ctx deadline becomes job deadline.
6. ctx is ignored after Submit returns.

Ambiguous context semantics cause bugs.

Better API:

```go
type Job struct {
    Context context.Context
    Payload Payload
}

func (p *Pool) Submit(ctx context.Context, job Job) error
```

But now two contexts? Avoid confusion.

Alternative:

```go
// Submit enqueues job. ctx controls only waiting for queue capacity.
// Once Submit returns nil, job execution is controlled by job.Context.
func (p *Pool) Submit(ctx context.Context, job Job) error
```

Or:

```go
// Submit runs job using ctx. If ctx is cancelled before job starts,
// the job may be skipped. If cancelled during execution, handler receives ctx.
func (p *Pool) Submit(ctx context.Context, payload Payload) error
```

Choose and document.

---

## 9. Do Not Store Request Context for Background Work

Bad API:

```go
func (s *Service) StartBackground(ctx context.Context, req Request)
```

If caller passes request context, background may be cancelled when request ends.

Better:

```go
func (s *Service) Enqueue(ctx context.Context, req Request) error
```

Where:
- `ctx` controls enqueue.
- background uses service context.
- job has its own deadline/idempotency.

Doc:
```go
// ctx controls admission only. Background execution uses the service lifecycle context.
```

---

## 10. Lifecycle API: Start, Stop, Wait

Bad:

```go
func Start()
func Stop()
```

Better:

```go
type Service struct {
    // ...
}

func (s *Service) Start(ctx context.Context) error
func (s *Service) Stop(ctx context.Context) error
func (s *Service) Wait() error
```

But define semantics.

### 10.1 Start

Questions:
- Can Start be called multiple times?
- Does Start block?
- Does Start spawn goroutines?
- Does Start return after ready?
- What does ctx control?
  - startup only?
  - service lifetime?

Possible contract:
```go
// Start starts background workers and returns after they are ready.
// ctx controls startup only. Use Stop to stop the service.
```

Or:
```go
// Run runs the service until ctx is cancelled and blocks until all workers exit.
func (s *Service) Run(ctx context.Context) error
```

`Run(ctx)` often gives cleaner ownership.

### 10.2 Stop

Questions:
- Is Stop idempotent?
- Does Stop wait?
- Does Stop drain or cancel?
- What if ctx expires?
- What happens to queued work?
- Can Submit run during Stop?

Use names:
- `Shutdown(ctx)` often means graceful drain.
- `Close()` often means release immediately/idempotently.
- `Stop()` ambiguous unless documented.
- `Run(ctx)` avoids separate Stop for simple services.

---

## 11. Close vs Shutdown vs Stop

Suggested semantics:

| Method | Typical meaning |
|---|---|
| `Close() error` | release resource, usually idempotent, may not take ctx |
| `Shutdown(ctx) error` | graceful stop with deadline |
| `Stop()` | generic; document carefully |
| `Run(ctx) error` | run until ctx cancelled |
| `Wait() error` | wait for background goroutines to exit |
| `Drain(ctx) error` | finish accepted work |
| `Cancel()` | stop work promptly |

Examples:

```go
func (p *Pool) Shutdown(ctx context.Context) error // drain accepted jobs
func (p *Pool) Cancel(ctx context.Context) error   // cancel running/queued jobs
```

Explicit names reduce surprises.

---

## 12. Idempotent Close

Concurrent API usually benefits from idempotent Close/Stop.

```go
func (s *Service) Close() error {
    s.once.Do(func() {
        close(s.done)
    })
    return nil
}
```

But idempotency must handle:
- multiple callers,
- concurrent Submit,
- Wait,
- errors from first close.

If Close returns error, what happens on second call?
- return same error?
- return nil?
- return ErrClosed?

Document.

---

## 13. Channel API Design

Returning bidirectional channel is usually too much power.

Bad:

```go
func (s *Stream) Events() chan Event
```

Caller can send or close.

Better:

```go
func (s *Stream) Events() <-chan Event
```

Receive-only.

For input:

```go
func (s *Sink) Input() chan<- Event
```

Send-only.

But even directional channel has lifecycle questions:
- Who closes it?
- Is it closed on Stop?
- Does send block?
- What if receiver is slow?
- Is buffer bounded?
- Are values immutable?

Often method API is clearer:

```go
func (s *Sink) Submit(ctx context.Context, e Event) error
```

This can return queue full/cancelled errors.

---

## 14. Channel Close Contract

If API returns `<-chan T`:
```go
// Events returns a channel that is closed when the stream ends or the context
// passed to Watch is cancelled. The caller must not attempt to close it.
func (c *Client) Watch(ctx context.Context, topic string) (<-chan Event, error)
```

If caller provides channel:
```go
// Run sends events to out until ctx is cancelled. Run does not close out.
func Run(ctx context.Context, out chan<- Event) error
```

Why not close caller-provided channel?
- caller may have multiple producers,
- caller owns channel lifecycle.

---

## 15. Callback API Design

Bad:

```go
func (c *Cache) Range(fn func(string, Value) bool) {
    c.mu.Lock()
    defer c.mu.Unlock()

    for k, v := range c.m {
        if !fn(k, v) {
            return
        }
    }
}
```

Problems:
- callback under lock,
- callback may call cache again and deadlock,
- callback may be slow,
- callback may panic,
- lock held long.

Better:

```go
func (c *Cache) Snapshot() map[string]Value {
    c.mu.Lock()
    defer c.mu.Unlock()

    out := make(map[string]Value, len(c.m))
    for k, v := range c.m {
        out[k] = v
    }
    return out
}
```

Then caller iterates.

If Range is needed:
```go
// Range calls fn for each snapshot entry. fn is not called while c's lock is held.
func (c *Cache) Range(fn func(string, Value) bool) {
    snapshot := c.Snapshot()
    for k, v := range snapshot {
        if !fn(k, v) {
            return
        }
    }
}
```

Trade-off: copy cost.

---

## 16. Iterator Semantics

Define:
- snapshot iterator,
- live iterator,
- weakly consistent iterator,
- blocking iterator.

For concurrent map:
```go
// Snapshot returns a point-in-time copy.
func (m *Map[K,V]) Snapshot() map[K]V
```

For stream:
```go
// Next blocks until an item is available, the iterator is closed, or ctx is cancelled.
func (it *Iterator[T]) Next(ctx context.Context) (T, bool, error)
```

Avoid hidden goroutines unless lifecycle clear.

---

## 17. Error Design for Concurrency

Use stable sentinel/wrapped errors:

```go
var (
    ErrClosed    = errors.New("closed")
    ErrQueueFull = errors.New("queue full")
    ErrStopped   = errors.New("stopped")
    ErrExpired   = errors.New("expired")
)
```

Return errors that caller can classify:

```go
err := pool.Submit(ctx, job)
switch {
case err == nil:
case errors.Is(err, ErrQueueFull):
case errors.Is(err, context.Canceled):
case errors.Is(err, context.DeadlineExceeded):
}
```

Do not return string-only errors for core control flow.

---

## 18. Backpressure API

Expose policy explicitly.

### 18.1 Blocking Submit

```go
func (p *Pool) Submit(ctx context.Context, job Job) error
```

Blocks until:
- enqueued,
- ctx cancelled,
- pool stopped.

### 18.2 Try Submit

```go
func (p *Pool) TrySubmit(job Job) error
```

Returns immediately:
- nil,
- ErrQueueFull,
- ErrStopped.

### 18.3 Bounded Wait

```go
func (p *Pool) SubmitTimeout(job Job, d time.Duration) error
```

But context is usually better:

```go
ctx, cancel := context.WithTimeout(parent, d)
defer cancel()
err := p.Submit(ctx, job)
```

### 18.4 Drop Policy

If drop allowed:

```go
type DropPolicy int

const (
    DropNewest DropPolicy = iota
    DropOldest
    DropLowestPriority
)
```

But dropping should be explicit and observable.

---

## 19. Worker Pool API Example

```go
type Pool[J any] struct {
    // ...
}

// NewPool creates a pool. handler may be called concurrently by up to workers goroutines.
// handler must respect ctx. Pool is safe for concurrent use.
func NewPool[J any](workers int, queueSize int, handler func(context.Context, J) error) *Pool[J]

// Submit enqueues job. ctx controls waiting for queue capacity.
// If Submit returns nil, the job has been accepted for at-least-once in-process execution.
// Submit returns ErrQueueFull only for non-blocking variants, ErrStopped after shutdown,
// or ctx error if ctx ends before admission.
func (p *Pool[J]) Submit(ctx context.Context, job J) error

// TrySubmit attempts to enqueue without blocking.
func (p *Pool[J]) TrySubmit(job J) error

// Shutdown stops accepting new jobs and waits for accepted jobs to complete or ctx to expire.
func (p *Pool[J]) Shutdown(ctx context.Context) error

// Cancel stops accepting new jobs, cancels running handlers, and discards queued jobs.
func (p *Pool[J]) Cancel(ctx context.Context) error
```

This API tells caller what happens.

---

## 20. Streaming API Example

Channel-style:

```go
func (c *Client) Watch(ctx context.Context, topic string) (<-chan Event, error)
```

Contract:
- returned channel closed on ctx cancel, server close, or error.
- errors? Need separate error channel or iterator.

Better iterator:

```go
type Stream[T any] struct {
    // ...
}

func (s *Stream[T]) Next(ctx context.Context) (T, bool, error)
func (s *Stream[T]) Close() error
```

Semantics:
- `ok=false, err=nil`: normal end.
- `err!=nil`: stream error.
- ctx controls waiting for next item.
- Close releases resources.

Iterator avoids separate error channel complexity.

---

## 21. Error Channel Pattern

If using channels:

```go
type WatchResult[T any] struct {
    Events <-chan T
    Errors <-chan error
}
```

Problems:
- caller must drain both,
- error channel close semantics,
- possible goroutine leak if caller ignores Errors.

Alternative:

```go
type EventOrError[T any] struct {
    Event T
    Err   error
}
```

Single channel:

```go
<-chan EventResult
```

But then after error do you close? Document.

Iterator is often cleaner for request/stream APIs.

---

## 22. Cache API Example

```go
type Cache[K comparable, V any] struct {
    // safe for concurrent use
}

// Get returns a copy/immutable value depending contract.
func (c *Cache[K,V]) Get(key K) (V, bool)

// Set stores value. If V is mutable, caller must not mutate it after Set,
// or Cache must copy it. Choose one and document.
func (c *Cache[K,V]) Set(key K, value V, ttl time.Duration)

// GetOrLoad deduplicates concurrent loads per key.
// ctx controls waiting and load execution according to documented policy.
func (c *Cache[K,V]) GetOrLoad(ctx context.Context, key K, loader func(context.Context) (V, error)) (V, error)
```

Important:
- loader may be called concurrently for different keys.
- loader should be idempotent.
- loader must not call cache recursively unless safe.
- errors may be negative-cached? document.
- stale behavior? document.

---

## 23. Repository and Transaction API

Bad:
```go
func (r *Repo) CreateUser(ctx context.Context, u User) error
func (r *Repo) CreateOrder(ctx context.Context, o Order) error
```

Hard to compose transaction.

Better:
```go
type Querier interface {
    ExecContext(context.Context, string, ...any) (sql.Result, error)
    QueryContext(context.Context, string, ...any) (*sql.Rows, error)
    QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (r *UserRepo) Create(ctx context.Context, q Querier, u User) error
```

Transaction helper:
```go
func WithTx(ctx context.Context, db *sql.DB, fn func(context.Context, *sql.Tx) error) error
```

Contract:
- fn may be retried? If yes, must be idempotent and no external side effects.
- context controls transaction begin/query/commit.
- tx not safe for concurrent use unless documented otherwise.
- fn must not retain tx after return.

---

## 24. HTTP Client API

Good client API:

```go
type UserClient struct {
    // safe for concurrent use
}

func (c *UserClient) GetUser(ctx context.Context, id string) (User, error)
```

Contract:
- ctx controls full request.
- client reuses internal HTTP client.
- method safe concurrent.
- error classes stable.
- response body closed internally.
- retries? document.
- idempotency? document.
- timeout? caller context or internal cap? document.

Avoid:
```go
func GetUser(id string) (User, error)
```
because no cancellation/deadline.

---

## 25. Functional Options and Concurrency

Builder/config should usually not be mutated after start.

```go
type Options struct {
    Workers int
    QueueSize int
}

func NewPool(opts Options) *Pool
```

Avoid:
```go
func (p *Pool) SetWorkers(n int)
```
unless dynamic resizing is carefully implemented.

If config reload needed:
- use atomic snapshot,
- document concurrent update semantics,
- validate consistency.

---

## 26. Immutability as API Strategy

Go does not enforce immutable structs, but API can encourage:

```go
type Config struct {
    Timeout time.Duration
    Limits  Limits
}
```

Do not expose maps/slices directly:

Bad:
```go
type Config struct {
    Headers map[string]string
}
```

If returned:
- caller can mutate.

Better:
- copy maps/slices,
- unexported fields with accessors,
- document immutable after construction,
- use snapshot.

---

## 27. Avoid Hidden Goroutines

Bad:
```go
func NewClient() *Client {
    go backgroundRefresh()
    return c
}
```

Who stops it?

Better:
```go
func NewClient(opts Options) *Client
func (c *Client) Start(ctx context.Context) error
func (c *Client) Close() error
```

Or:
```go
func (c *Client) Run(ctx context.Context) error
```

If constructor starts goroutine, type must implement Close and docs must be clear.

---

## 28. Avoid Package-Level Global Concurrency

Bad:
```go
var defaultPool = NewPool(...)
```

Problems:
- tests interfere,
- lifecycle unclear,
- config difficult,
- shutdown unclear.

Better:
- explicit dependency injection.
- main constructs pool.
- pass to services.

Globals okay for immutable constants or truly process-wide metrics/logger if safe.

---

## 29. API for Optional Background Work

If request triggers background work:

```go
func (s *Service) TriggerRefresh(ctx context.Context, key string) error
```

Contract:
- ctx controls trigger/admission only.
- refresh deduplicated?
- if already running, return nil or ErrAlreadyRunning?
- refresh uses service context.
- errors observed where?
- can caller wait?

Maybe provide:

```go
func (s *Service) Refresh(ctx context.Context, key string) error      // synchronous
func (s *Service) RefreshAsync(ctx context.Context, key string) error // admission only
```

Names clarify.

---

## 30. API Compatibility and Concurrency Semantics

Changing concurrency behavior can be breaking even if signature same.

Breaking changes:
- method used to block, now async.
- returned slice used to be copy, now live.
- Stop used to drain, now cancels.
- callbacks used to be serial, now concurrent.
- order used to be preserved, now unordered.
- retry added causing duplicate side effects.
- context meaning changed.

Document changes carefully.

Semantic versioning should consider concurrency contract.

---

## 31. Documentation Template

For a concurrent type:

```go
// Pool executes jobs with bounded concurrency.
//
// Pool is safe for concurrent use by multiple goroutines.
//
// Submit blocks until a job is accepted, ctx is cancelled, or the pool is
// shutting down. ctx controls admission only; accepted jobs run with the
// pool's service context.
//
// Shutdown stops accepting new jobs and waits for accepted jobs to complete
// until ctx expires. Cancel stops accepting new jobs, cancels running jobs,
// and discards queued jobs.
//
// Jobs are processed at least once in-process after successful Submit unless
// Cancel is called. Processing order is not guaranteed.
type Pool[J any] struct { ... }
```

This is the level of clarity expected for production API.

---

## 32. Testing API Contracts

For every contract line, write a test:
- safe concurrent Submit,
- Submit blocks when full,
- Submit returns ctx error,
- TrySubmit returns ErrQueueFull,
- Shutdown drains,
- Cancel cancels,
- Submit after Shutdown returns ErrStopped,
- job order not assumed,
- handler concurrency <= workers,
- Stop idempotent.

Docs without tests drift.

---

## 33. Anti-Pattern Catalog

### 33.1 Returning `chan T`

Bidirectional channel lets caller close/send.

### 33.2 Context Accepted But Ignored

False safety.

### 33.3 Ambiguous Stop

Nobody knows drain vs cancel.

### 33.4 Returning Internal Mutable Slice/Map

Caller corrupts state.

### 33.5 Callback Under Lock

Deadlock risk.

### 33.6 Hidden Goroutine Without Close

Leak by API design.

### 33.7 Queue Full Behavior Undocumented

Caller cannot handle overload.

### 33.8 Retrying Inside API Without Idempotency Contract

Duplicate side effects.

### 33.9 Safe Concurrent Use Not Documented

Users guess.

### 33.10 Start Callable Twice Without Defined Behavior

Lifecycle race.

### 33.11 Error Strings Instead of Classifiable Errors

Caller cannot branch.

### 33.12 API Changes Ordering Semantics Silently

Subtle breaking change.

---

## 34. Design Review Checklist

For concurrent API:

1. Is safe concurrent use documented?
2. Is input ownership documented?
3. Is returned data ownership documented?
4. Are mutable maps/slices copied or protected?
5. Does method block?
6. What can it block on?
7. Is context accepted where blocking occurs?
8. What does context cancellation mean?
9. Is background work using correct lifecycle context?
10. Are goroutines hidden? If yes, who stops them?
11. Is Start idempotent or guarded?
12. Is Stop/Close/Shutdown semantics clear?
13. Is Stop idempotent?
14. Does Stop wait?
15. Drain or cancel?
16. What happens to queued work?
17. Are channels directional?
18. Who closes channels?
19. Are callbacks called under lock?
20. Are callbacks concurrent?
21. Is ordering guaranteed?
22. Is processing at-most/at-least/exactly once?
23. Is backpressure behavior explicit?
24. Are errors classifiable?
25. Are retries documented?
26. Is idempotency required?
27. Are metrics/hooks available?
28. Are contracts tested?
29. Are concurrency semantics versioned?
30. Would a new team member use this safely from docs alone?

---

## 35. Mini Lab 1: Redesign Bad API

Given:

```go
type Processor struct{}

func (p *Processor) Start()
func (p *Processor) Stop()
func (p *Processor) Jobs() chan Job
func (p *Processor) Results() chan Result
```

Redesign with:
- context,
- directional channels or Submit method,
- Shutdown/Cancel,
- documented ownership,
- error handling,
- tests.

---

## 36. Mini Lab 2: Cache Ownership

Implement cache variants:
1. copy on Set/Get,
2. ownership transfer,
3. immutable value.

Write tests showing mutation after Set/Get cannot corrupt cache for safe variant.

Benchmark copy overhead.

---

## 37. Mini Lab 3: Callback Deadlock

Implement Range that calls callback under lock.
Write callback that calls Get.
Observe deadlock.
Fix with Snapshot-based Range.

---

## 38. Mini Lab 4: Worker Pool Contract Tests

Write docs for Pool.
Then write tests for every doc sentence:
- safe concurrent submit,
- full queue,
- stop,
- cancel,
- error,
- order,
- idempotent shutdown.

---

## 39. Mini Lab 5: Streaming Iterator

Implement:

```go
type Stream[T any] struct {}
func (s *Stream[T]) Next(ctx context.Context) (T, bool, error)
func (s *Stream[T]) Close() error
```

Test:
- normal end,
- error,
- ctx cancel,
- close,
- no goroutine leak.

---

## 40. Mini Lab 6: API Compatibility Review

Take an existing API and identify concurrency semantics that would be breaking if changed:
- sync to async,
- order guarantee,
- callback concurrency,
- ownership copy,
- retry behavior,
- shutdown behavior.

Write release note style warning.

---

## 41. Top 1% Heuristics

1. Concurrency safety starts at API boundary.
2. Safe for concurrent use must be documented.
3. Ownership must be explicit for slices/maps/buffers.
4. Context semantics must be precise.
5. Stop/Shutdown/Close are not interchangeable.
6. Directional channels reduce misuse.
7. Method API often beats exposing channel.
8. Callbacks under lock are dangerous by default.
9. Hidden goroutines require Close/Stop/Wait.
10. Backpressure behavior is part of API.
11. Errors must be classifiable.
12. Retrying inside API requires idempotency contract.
13. Ordering guarantees are part of compatibility.
14. Docs need tests.
15. A concurrent API is good when misuse is hard and correct use is obvious.

---

## 42. Source Notes

Primary concepts behind this part:

1. Go API design:
   - context conventions,
   - Close/Shutdown lifecycle,
   - channel direction,
   - error wrapping/classification,
   - documentation.

2. Go concurrency:
   - ownership,
   - goroutine lifecycle,
   - channel close,
   - locks/callbacks,
   - backpressure.

3. Production reliability:
   - graceful shutdown,
   - idempotency,
   - retries,
   - compatibility,
   - testable contracts.

---

## 43. Summary

Concurrent APIs must communicate more than type signatures.

They must define:
- safety,
- ownership,
- lifecycle,
- cancellation,
- blocking,
- backpressure,
- ordering,
- error classification,
- shutdown,
- retry/idempotency,
- channel close,
- callback behavior.

The core rule:

> If a caller can misuse your concurrent API accidentally, the API is incomplete.

Production-grade concurrent API design makes the safe path obvious, the unsafe path difficult, and the lifecycle testable.

---

## 44. Status Seri

Selesai:
- Part 000 — Orientation
- Part 001 — Foundations
- Part 002 — Goroutine Internals
- Part 003 — Go Scheduler Deep Dive
- Part 004 — GOMAXPROCS, CPU Quotas, Containers
- Part 005 — Go Memory Model
- Part 006 — Synchronization Primitives
- Part 007 — Atomic Operations
- Part 008 — Channels Deep Dive
- Part 009 — Select Semantics
- Part 010 — WaitGroup, ErrGroup, Task Groups, and Structured Concurrency
- Part 011 — Context as Concurrency Contract
- Part 012 — Ownership Models
- Part 013 — Worker Pools
- Part 014 — Fan-Out/Fan-In, Pipelines, Stages, and Stream Processing
- Part 015 — Backpressure End-to-End
- Part 016 — Semaphores, Rate Limiters, Token Buckets, and Bulkheads
- Part 017 — Concurrent Data Structures
- Part 018 — Singleflight, Deduplication, Idempotency, and Stampede Prevention
- Part 019 — Timers, Tickers, Deadlines, Scheduling, and Time-Based Concurrency
- Part 020 — Network Concurrency
- Part 021 — Database Concurrency
- Part 022 — Parallel CPU Work
- Part 023 — Memory, Allocation, GC, and Concurrency Pressure
- Part 024 — Race Detection, Static Analysis, and Concurrency Bug Hunting
- Part 025 — Testing Concurrent Code
- Part 026 — Observability for Concurrent Systems
- Part 027 — Performance Engineering for Concurrent Go
- Part 028 — Failure Modes in Concurrent Go Systems
- Part 029 — Designing Concurrent APIs

Belum selesai:
- Part 030 sampai Part 034.

Seri belum mencapai bagian terakhir.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-concurrency-parallelism-part-028.md">⬅️ Part 028 — Failure Modes in Concurrent Go Systems: Deadlocks, Leaks, Starvation, Cascades, and Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-concurrency-parallelism-part-030.md">Part 030 — Runtime-Aware Service Design: Building Go Services That Cooperate with Scheduler, GC, Containers, and Dependencies ➡️</a>
</div>
