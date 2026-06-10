# Strict Coding Standards — Go I/O

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, CLIs, workers, stream processors, adapters, import/export jobs, regulatory workflow systems  
Baseline: Go 1.24–1.26+, standard library first

---

## 1. Purpose

I/O code is a boundary between deterministic business logic and unreliable external reality.

The LLM MUST treat every I/O operation as potentially partial, slow, blocking, cancelled, malformed, truncated, duplicated, reordered, or resource-exhausting. I/O code MUST be explicit about ownership, limits, deadlines, cancellation, retryability, observability, and cleanup.

This document covers general I/O rules. Use the specialized standards for concrete boundaries:

- `strict-coding-standards__go_io_network.md` for network I/O.
- `strict-coding-standards__go_io_file.md` for filesystem I/O.
- `strict-coding-standards__go_bit_byte_buffer.md` for byte buffers and binary framing.
- `strict-coding-standards__go_context.md` for cancellation and deadline propagation.
- `strict-coding-standards__go_error_handling.md` for error taxonomy.
- `strict-coding-standards__go_telemetry.md` for metrics, tracing, and profiling.

---

## 2. Source authority

Primary references:

- Go `io` package documentation: https://pkg.go.dev/io
- Go `bufio` package documentation: https://pkg.go.dev/bufio
- Go `bytes` package documentation: https://pkg.go.dev/bytes
- Go `strings` package documentation: https://pkg.go.dev/strings
- Go `compress/*` package documentation: https://pkg.go.dev/compress
- Go `archive/*` package documentation: https://pkg.go.dev/archive
- Go `encoding/binary` package documentation: https://pkg.go.dev/encoding/binary
- Go `context` package documentation: https://pkg.go.dev/context
- Go diagnostics documentation: https://go.dev/doc/diagnostics
- Go fuzzing documentation: https://go.dev/doc/security/fuzz

If this document conflicts with a stronger project-specific protocol, schema, security policy, or runtime SLO, the stronger rule wins. The LLM MUST report the conflict.

---

## 3. I/O boundary taxonomy

Before writing I/O code, the LLM MUST classify the boundary.

| Boundary                | Main risk                                            | Required design decision              |
| ----------------------- | ---------------------------------------------------- | ------------------------------------- |
| In-memory reader/writer | hidden aliasing, fake success in tests               | test with partial readers/writers too |
| File reader/writer      | partial write, permission, atomicity, path traversal | use file-specific standard            |
| Network connection      | timeout, cancellation, backpressure, half-close      | use network-specific standard         |
| HTTP body               | unbounded payload, slowloris, connection reuse       | bound and close body                  |
| Pipe                    | deadlock, goroutine leak                             | define close/error ownership          |
| Compression stream      | zip bomb, decompression bomb                         | bound decompressed bytes and entries  |
| Archive stream          | path traversal, symlink confusion                    | validate entries before write         |
| Crypto stream           | nonce/key/tag misuse                                 | use crypto-specific standard          |
| CSV/JSON/XML stream     | malformed record, schema drift                       | strict decoder and row-level errors   |
| External process stdio  | deadlock on stderr/stdout                            | drain pipes and wait safely           |

---

## 4. Non-negotiable rules

### 4.1 Never assume `Read` fills the buffer

`io.Reader.Read` may return fewer bytes than requested. The LLM MUST use `io.ReadFull`, `io.ReadAtLeast`, a loop, or a higher-level decoder when exact length is required.

Forbidden:

```go
buf := make([]byte, 32)
_, err := r.Read(buf) // assumes all 32 bytes were read
if err != nil {
	return err
}
parseHeader(buf)
```

Required:

```go
buf := make([]byte, 32)
if _, err := io.ReadFull(r, buf); err != nil {
	return fmt.Errorf("read header: %w", err)
}
parseHeader(buf)
```

### 4.2 Always process `n > 0` before handling `err`

A reader may return both bytes and an error. The LLM MUST process the bytes first, then handle the error.

Required:

```go
for {
	n, err := r.Read(buf)
	if n > 0 {
		if writeErr := consume(buf[:n]); writeErr != nil {
			return writeErr
		}
	}
	if err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return fmt.Errorf("read stream: %w", err)
	}
}
```

### 4.3 Never assume `Write` writes everything

`io.Writer.Write` may return `n < len(p)` with an error. The LLM MUST use `io.Copy`, `io.CopyBuffer`, `io.WriteString`, or a `writeFull` helper when complete writes are required.

Required helper:

```go
func writeFull(w io.Writer, p []byte) error {
	for len(p) > 0 {
		n, err := w.Write(p)
		if n > 0 {
			p = p[n:]
		}
		if err != nil {
			return fmt.Errorf("write: %w", err)
		}
		if n == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}
```

### 4.4 Bound all untrusted input

The LLM MUST NOT call `io.ReadAll`, `bytes.Buffer.ReadFrom`, JSON/XML decode, archive extraction, or decompression over untrusted input without an explicit byte limit.

Forbidden:

```go
body, err := io.ReadAll(r.Body)
```

Required:

```go
const maxBodyBytes = 1 << 20 // 1 MiB; must be domain justified
body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
if err != nil {
	return fmt.Errorf("read body: %w", err)
}
if len(body) > maxBodyBytes {
	return ErrPayloadTooLarge
}
```

### 4.5 Close resources exactly once and at the owner boundary

The function that creates or accepts ownership of an `io.Closer` MUST close it. The LLM MUST document ownership transfer when returning closers.

Required:

```go
resp, err := client.Do(req)
if err != nil {
	return err
}
defer resp.Body.Close()
```

### 4.6 Do not hide close errors on write paths

For write streams, close may flush buffered data or finalize trailers. The LLM MUST return close errors when they can indicate data loss.

Required:

```go
func writeCompressed(dst io.Writer, payload []byte) (err error) {
	zw := gzip.NewWriter(dst)
	defer func() {
		if closeErr := zw.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("close gzip writer: %w", closeErr)
		}
	}()
	_, err = zw.Write(payload)
	return err
}
```

### 4.7 Flush buffered writers explicitly

The LLM MUST call and check `Flush` on `bufio.Writer`, CSV writers, gzip writers, and protocol encoders where flushing is explicit.

Forbidden:

```go
w := bufio.NewWriter(dst)
w.WriteString(line)
return nil // missing Flush
```

Required:

```go
w := bufio.NewWriter(dst)
if _, err := w.WriteString(line); err != nil {
	return fmt.Errorf("write line: %w", err)
}
if err := w.Flush(); err != nil {
	return fmt.Errorf("flush line: %w", err)
}
```

### 4.8 Do not use `bufio.Scanner` for arbitrary large records

`bufio.Scanner` is acceptable for bounded token sizes. For large or adversarial records, use `bufio.Reader`, custom parsing, or explicitly configure and validate the maximum token size.

Required when using scanner:

```go
scanner := bufio.NewScanner(r)
scanner.Buffer(make([]byte, 64*1024), maxRecordBytes)
for scanner.Scan() {
	if err := consume(scanner.Bytes()); err != nil {
		return err
	}
}
if err := scanner.Err(); err != nil {
	return fmt.Errorf("scan records: %w", err)
}
```

### 4.9 Do not assume I/O abstractions are safe for concurrent use

Unless a type explicitly documents concurrent safety, the LLM MUST serialize access or create separate instances.

Forbidden:

```go
go io.Copy(w, r1)
go io.Copy(w, r2) // shared writer without synchronization or framing
```

Required:

```go
type SafeWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *SafeWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}
```

### 4.10 Do not conflate EOF with failure

`io.EOF` is often normal stream termination. `io.ErrUnexpectedEOF` indicates truncation when a complete structure was expected. The LLM MUST distinguish them.

Required:

```go
n, err := io.ReadFull(r, header[:])
if err != nil {
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return fmt.Errorf("truncated header after %d bytes: %w", n, err)
	}
	return fmt.Errorf("read header: %w", err)
}
```

---

## 5. API design rules

### 5.1 Accept interfaces at boundaries

Functions that consume data SHOULD accept the narrowest useful interface.

Preferred:

```go
func DecodeCase(r io.Reader) (CaseCommand, error)
func EncodeCase(w io.Writer, c CaseView) error
```

Avoid requiring concrete types:

```go
func DecodeCase(f *os.File) (CaseCommand, error) // too specific unless file-specific behavior is needed
```

### 5.2 Return closers only when streaming is required

A function MUST NOT return `io.ReadCloser` merely to avoid loading bytes when the caller has no streaming need.

Acceptable:

```go
func OpenEvidence(ctx context.Context, id EvidenceID) (io.ReadCloser, EvidenceMeta, error)
```

The ownership rule MUST be documented: caller must close the returned stream.

### 5.3 Prefer streaming for large data

The LLM SHOULD prefer streaming pipelines over full materialization when data can exceed memory budget.

Preferred:

```go
func CopyEvidence(ctx context.Context, dst io.Writer, src io.Reader, limit int64) error {
	lr := &io.LimitedReader{R: src, N: limit + 1}
	n, err := io.Copy(dst, lr)
	if err != nil {
		return fmt.Errorf("copy evidence: %w", err)
	}
	if n > limit || lr.N == 0 {
		return ErrEvidenceTooLarge
	}
	return nil
}
```

### 5.4 Do not return borrowed mutable buffers without contract

If a function returns `[]byte`, it MUST specify whether the caller owns the slice. For public APIs, return owned copies unless performance contract explicitly says otherwise.

Required:

```go
func CloneBytes(b []byte) []byte {
	return append([]byte(nil), b...)
}
```

---

## 6. Copying and buffering rules

### 6.1 `io.Copy` is preferred for simple stream copy

Use `io.Copy` or `io.CopyBuffer` instead of manual loops unless the loop applies validation, progress accounting, throttling, hashing, metrics, or cancellation checks.

### 6.2 Reusable buffers must not escape across operations

A pooled or reused buffer MUST NOT be stored, returned, logged, or used after being returned to a pool.

Forbidden:

```go
buf := pool.Get().([]byte)
defer pool.Put(buf)
return buf[:n], nil // returned slice aliases pooled memory
```

### 6.3 Buffer size must be justified

The LLM MUST NOT introduce arbitrary large buffers. Buffer sizes SHOULD be tied to protocol frame size, filesystem block behavior, memory budget, benchmark result, or workload profile.

Default starting points:

- 32 KiB for generic copy buffer.
- 64 KiB for scan buffer only if record size is bounded.
- Protocol-specific frame size when defined.
- Smaller buffers for high-concurrency services where per-request memory matters.

### 6.4 Avoid double buffering

The LLM MUST NOT stack redundant buffers without reason.

Example smell:

```go
br := bufio.NewReader(bytes.NewReader(b)) // usually pointless
```

---

## 7. Cancellation and timeout rules

### 7.1 Plain `io.Reader` has no cancellation contract

A generic `io.Reader` cannot be cancelled by context unless its implementation observes context. The LLM MUST NOT pretend `context.Context` cancels arbitrary blocking `Read` or `Write`.

Required design choices:

1. Use APIs that accept context, such as HTTP, DB, or network dial operations.
2. Set deadlines for network connections.
3. Run blocking I/O in an owned goroutine only if there is a safe close/unblock mechanism.
4. Document that cancellation is best-effort when the underlying reader cannot be interrupted.

### 7.2 Do not leak goroutines when bridging context and blocking I/O

Forbidden:

```go
func readWithContext(ctx context.Context, r io.Reader, p []byte) error {
	done := make(chan error, 1)
	go func() { _, err := r.Read(p); done <- err }()
	select {
	case <-ctx.Done():
		return ctx.Err() // goroutine may be stuck forever
	case err := <-done:
		return err
	}
}
```

Required if unavoidable:

```go
func readConnWithContext(ctx context.Context, c net.Conn, p []byte) (int, error) {
	if deadline, ok := ctx.Deadline(); ok {
		if err := c.SetReadDeadline(deadline); err != nil {
			return 0, fmt.Errorf("set read deadline: %w", err)
		}
	}
	return c.Read(p)
}
```

### 7.3 Propagate context through higher-level I/O APIs

Public I/O functions in services MUST accept context unless they are purely in-memory and guaranteed non-blocking.

Required:

```go
func ImportCases(ctx context.Context, r io.Reader) error
func ExportCases(ctx context.Context, w io.Writer, filter CaseFilter) error
```

---

## 8. Compression and archive rules

### 8.1 Bound decompressed data

The LLM MUST treat compressed input as adversarial. Compressed size is not enough.

Required:

```go
gr, err := gzip.NewReader(src)
if err != nil {
	return fmt.Errorf("open gzip: %w", err)
}
defer gr.Close()

lr := &io.LimitedReader{R: gr, N: maxDecompressedBytes + 1}
n, err := io.Copy(dst, lr)
if err != nil {
	return fmt.Errorf("decompress: %w", err)
}
if n > maxDecompressedBytes || lr.N == 0 {
	return ErrDecompressedPayloadTooLarge
}
```

### 8.2 Validate archive entries before extraction

Archive handling MUST validate:

- maximum entry count;
- maximum total uncompressed bytes;
- maximum per-entry bytes;
- normalized relative path;
- no absolute path;
- no parent directory traversal;
- symlink/hardlink policy;
- file mode policy;
- overwrite policy.

### 8.3 Never trust metadata inside archives

Archive filenames, timestamps, permissions, ownership, MIME type, and size metadata are untrusted until validated.

---

## 9. Error handling rules

### 9.1 Wrap errors with operation context

I/O errors MUST include operation and boundary. Do not return raw errors from deep I/O layers unless the caller already has context.

Required:

```go
if _, err := io.Copy(dst, src); err != nil {
	return fmt.Errorf("copy evidence stream %s: %w", evidenceID, err)
}
```

### 9.2 Preserve error identity

Use `%w` and `errors.Is`/`errors.As` so callers can distinguish EOF, timeout, permission, not-exist, and context cancellation.

### 9.3 Classify retryability explicitly

The LLM MUST NOT infer retryability from string matching. Retry decisions belong to typed errors, domain policy, or infrastructure-specific classification.

---

## 10. Observability rules

### 10.1 Instrument long-running I/O

For long-running copy/import/export operations, record at least:

- operation name;
- boundary type;
- bytes read/written;
- records processed;
- elapsed time;
- cancellation status;
- final error class;
- backpressure/wait time when observable.

### 10.2 Do not log raw payloads by default

Payload logging MUST be disabled by default. Debug payload logging requires:

- size cap;
- redaction;
- safe encoding;
- sampling;
- non-production guard or explicit security approval.

### 10.3 Use progress reporting without corrupting output

CLIs MUST send progress logs to stderr, not stdout, when stdout is data output.

---

## 11. Testing rules

### 11.1 Test with hostile readers and writers

The LLM SHOULD include test doubles for:

- one-byte-at-a-time reader;
- short writer;
- reader returning `n > 0` with `io.EOF`;
- reader returning `io.ErrUnexpectedEOF`;
- writer returning `io.ErrShortWrite`;
- slow reader;
- context cancellation;
- oversized input;
- malformed framing;
- flush/close error.

Example:

```go
type shortWriter struct {
	max int
	buf bytes.Buffer
}

func (w *shortWriter) Write(p []byte) (int, error) {
	if len(p) > w.max {
		p = p[:w.max]
	}
	return w.buf.Write(p)
}
```

### 11.2 Fuzz decoders and parsers

Any custom parser over `io.Reader` or `[]byte` MUST have fuzz tests unless it is trivial and delegated entirely to a standard library parser.

### 11.3 Benchmark large and small payloads

The LLM MUST benchmark I/O paths that process large files, uploads, exports, or event replays. Benchmark output MUST include allocation count and bytes allocated per operation.

---

## 12. Forbidden patterns

The LLM MUST NOT introduce these patterns:

```go
// Unbounded read.
b, _ := io.ReadAll(r)

// Ignores partial read.
r.Read(buf)
parse(buf)

// Ignores partial write.
w.Write(payload)

// Ignores flush error.
bufio.NewWriter(w).Flush()

// Treats any read error as fatal before processing bytes.
n, err := r.Read(buf)
if err != nil { return err }
consume(buf[:n])

// Leaks response body.
resp, _ := http.Get(url)
return io.ReadAll(resp.Body)

// Logs unbounded body.
slog.Info("body", "payload", string(body))

// Stores context in reader struct to fake cancellation.
type Reader struct { ctx context.Context }
```

---

## 13. Preferred patterns

### 13.1 Bounded read helper

```go
func ReadBounded(r io.Reader, max int64) ([]byte, error) {
	if max < 0 {
		return nil, fmt.Errorf("max must be non-negative")
	}
	lr := &io.LimitedReader{R: r, N: max + 1}
	b, err := io.ReadAll(lr)
	if err != nil {
		return nil, fmt.Errorf("read bounded: %w", err)
	}
	if int64(len(b)) > max || lr.N == 0 {
		return nil, ErrPayloadTooLarge
	}
	return b, nil
}
```

### 13.2 Hash while copying

```go
func CopyWithSHA256(dst io.Writer, src io.Reader) ([32]byte, int64, error) {
	h := sha256.New()
	mw := io.MultiWriter(dst, h)
	n, err := io.Copy(mw, src)
	if err != nil {
		return [32]byte{}, n, fmt.Errorf("copy and hash: %w", err)
	}
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum, n, nil
}
```

### 13.3 Tee for audit-safe metadata only

Use `io.TeeReader` for hashing, counting, or limited sampling. Do not tee full sensitive payloads into logs.

---

## 14. LLM implementation checklist

Before committing I/O code, the LLM MUST verify:

- [ ] The I/O boundary is classified.
- [ ] All untrusted input is size-bounded.
- [ ] Partial reads are handled.
- [ ] Partial writes are handled.
- [ ] `n > 0` with `err != nil` is handled correctly.
- [ ] EOF is distinguished from truncation.
- [ ] All resources are closed by the owner.
- [ ] Close/flush errors are checked where data loss is possible.
- [ ] Context/deadline behavior is real, not imaginary.
- [ ] No goroutine can be leaked by blocking I/O.
- [ ] Buffers do not escape ownership accidentally.
- [ ] Compression/archive handling has decompressed limits.
- [ ] Errors are wrapped with operation context.
- [ ] Payloads are not logged unsafely.
- [ ] Tests cover hostile readers/writers.
- [ ] Benchmarks exist for large-data paths.

---

## 15. Review rejection triggers

A reviewer or LLM reviewer MUST reject code when:

- it uses unbounded `io.ReadAll` on untrusted input;
- it assumes `Read` fills the buffer;
- it assumes `Write` writes the entire buffer;
- it ignores `Close`/`Flush` errors on write paths;
- it leaks `resp.Body`, `os.File`, gzip writer/reader, pipe endpoint, or process pipe;
- it fakes context cancellation for non-cancellable I/O;
- it extracts archives without path and size validation;
- it logs raw payloads or secrets;
- it lacks tests for partial I/O where custom loops exist.
