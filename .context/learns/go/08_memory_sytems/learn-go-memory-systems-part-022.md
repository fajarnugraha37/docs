# learn-go-memory-systems-part-022.md

# Go Memory Systems — Part 022  
# Unsafe String/Slice Conversion: Validity, Corruption Risk, and Go 1.20+ APIs

> Target audience: Java software engineer yang sedang membangun mental model Go sampai level production-grade.  
> Seri: `learn-go-memory-systems`  
> Part: `022`  
> Status seri: belum selesai.  
> Fokus part ini: konversi `string`/`[]byte` tanpa copy menggunakan `unsafe`, kapan valid, kapan corrupt, dan bagaimana API Go modern mengurangi ketergantungan pada layout internal.

---

## 0. Posisi Part Ini Dalam Seri

Sebelumnya kita sudah membangun fondasi berikut:

1. value representation,
2. pointer,
3. stack vs heap,
4. escape analysis,
5. allocator,
6. struct/slice/string/interface representation,
7. buffer dan stream,
8. copy semantics,
9. zero-copy,
10. `unsafe` fundamentals.

Part ini adalah lanjutan langsung dari `unsafe` fundamentals, tetapi jauh lebih sempit dan lebih tajam: **konversi antara `string` dan `[]byte` tanpa copy**.

Topik ini terlihat kecil, tetapi di production sering menjadi sumber bug paling mahal karena bentuk bug-nya bukan hanya panic. Bug-nya bisa berupa:

- data corruption,
- log salah,
- cache key berubah diam-diam,
- security leak,
- race condition,
- payload HTTP rusak,
- parser terlihat benar di benchmark tetapi salah saat concurrency,
- memory retention besar karena view menahan backing array,
- crash karena pointer lifetime salah,
- bug yang hanya muncul di versi compiler/runtime tertentu.

Karena itu, part ini tidak akan mengajarkan `unsafe` sebagai trik performa. Part ini mengajarkan `unsafe` sebagai **boundary engineering**.

---

## 1. Inti Mental Model

Kalimat paling penting:

> `string` dan `[]byte` bisa menunjuk byte memory yang sama, tetapi kontrak semantic keduanya berbeda total.

`string` berarti:

- immutable,
- byte sequence,
- safe sebagai map key,
- safe dibagikan antar goroutine selama tidak ada sumber mutable di belakangnya,
- caller secara mental menganggap isi string tidak akan berubah.

`[]byte` berarti:

- mutable,
- view ke backing array,
- length/capacity,
- bisa berubah melalui index assignment, append, reuse buffer, pool, read ulang, decode ulang,
- ownership-nya harus jelas.

Unsafe conversion mencoba membuat dua dunia ini berbagi memory.

Itu hanya aman jika invariant semantic-nya dipertahankan secara manual.

---

## 2. Konversi Normal: Aman Tapi Copy

Go menyediakan konversi built-in:

```go
b := []byte("hello")
s := string([]byte{'h', 'e', 'l', 'l', 'o'})
```

Secara semantic:

- `[]byte(s)` membuat byte slice baru yang dapat dimodifikasi tanpa mengubah string asli.
- `string(b)` membuat string immutable baru dari isi byte saat itu.

Konversi normal ini adalah pilihan default untuk production code.

### 2.1 Kenapa Ada Copy?

Karena kontrak `string` dan `[]byte` berbeda.

Kalau `string(b)` tidak copy, maka string hasilnya bisa berubah ketika `b` dimodifikasi.

Contoh semantic yang Go ingin jaga:

```go
b := []byte("admin")
s := string(b)

b[0] = 'x'

fmt.Println(s) // harus tetap "admin", bukan "xdmin"
```

Tanpa copy, string tidak lagi immutable secara observable.

### 2.2 Copy Itu Bukan Selalu Buruk

Untuk payload kecil, copy sering lebih murah daripada:

- bug lifetime,
- retention array besar,
- race condition,
- invalid cache key,
- API contract yang rumit,
- future maintenance cost.

Rule awal:

> Untuk data kecil dan boundary umum, copy adalah harga yang sangat murah untuk correctness.

---

## 3. Kenapa Engineer Tergoda Unsafe Conversion?

Biasanya karena profil menunjukkan alokasi dari:

```go
string(b)
```

atau:

```go
[]byte(s)
```

Contoh kasus:

- parsing HTTP headers,
- parsing binary protocol,
- tokenization log,
- custom router,
- JSON-ish parser,
- database wire protocol,
- cache key generation,
- high-throughput ingestion,
- metrics label generation,
- message broker codec.

Di hot path, konversi copy bisa terlihat mahal.

Tetapi pertanyaan yang benar bukan:

> “Bagaimana membuat conversion ini zero-copy?”

Pertanyaan yang benar:

> “Apakah boundary ini membutuhkan string, atau hanya butuh view byte sementara?”

Sering kali solusi terbaik bukan unsafe conversion, melainkan desain API ulang agar hot path tetap di `[]byte` sampai benar-benar butuh string owned.

---

## 4. API Modern Go 1.20+: Kenapa Penting?

Sebelum Go 1.20, banyak kode memakai hack berbasis `reflect.StringHeader` dan `reflect.SliceHeader`.

Contoh lama yang harus dihindari:

```go
func bytesToStringOld(b []byte) string {
    return *(*string)(unsafe.Pointer(&b))
}
```

atau:

```go
func stringToBytesOld(s string) []byte {
    sh := (*reflect.StringHeader)(unsafe.Pointer(&s))
    bh := reflect.SliceHeader{
        Data: sh.Data,
        Len:  sh.Len,
        Cap:  sh.Len,
    }
    return *(*[]byte)(unsafe.Pointer(&bh))
}
```

Masalahnya:

- bergantung pada layout internal,
- menggunakan `uintptr` untuk pointer data,
- bisa kehilangan referensi GC,
- tidak portable,
- raw header tidak menjamin lifetime backing data,
- rentan salah saat runtime/compiler berubah.

Go 1.20 menambahkan API di package `unsafe`:

- `unsafe.String(ptr *byte, len IntegerType) string`
- `unsafe.StringData(str string) *byte`
- `unsafe.Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType`
- `unsafe.SliceData(slice []ArbitraryType) *ArbitraryType`

Ini bukan membuat operasi tersebut “safe”.

Ini hanya memberikan cara yang lebih explicit dan lebih implementation-independent dibanding mengarang header sendiri.

---

## 5. The Core Invariants

Semua unsafe string/slice conversion harus lulus invariant berikut.

### 5.1 Lifetime Invariant

Memory yang ditunjuk harus tetap hidup selama view dipakai.

Salah:

```go
func bad() string {
    b := make([]byte, 5)
    copy(b, "hello")
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

Ini terlihat mungkin aman karena `b` kemungkinan escape ke heap, tetapi contract-nya buruk: string result bergantung pada backing array mutable yang tidak lagi punya owner jelas.

Lebih buruk lagi jika memory berasal dari pool atau off-heap yang bisa direuse.

### 5.2 Immutability Invariant

Jika byte memory sudah dilihat sebagai `string`, byte itu tidak boleh dimodifikasi selama string masih mungkin dipakai.

Salah:

```go
b := []byte("token=abc")
s := unsafe.String(unsafe.SliceData(b), len(b))

b[6] = 'x'
fmt.Println(s) // string berubah secara observable
```

Ini melanggar semantic `string`.

### 5.3 Ownership Invariant

Harus jelas siapa yang punya memory.

Pertanyaan wajib:

- Siapa boleh mutate?
- Siapa boleh retain?
- Kapan memory boleh dikembalikan ke pool?
- Apakah caller boleh menyimpan string/slice hasil conversion?
- Apakah conversion hanya valid sampai function return?
- Apakah conversion melewati goroutine boundary?

Jika jawabannya tidak jelas, unsafe conversion tidak valid.

### 5.4 Concurrency Invariant

Tidak boleh ada mutation bersamaan terhadap byte yang sedang dibaca melalui string/slice view.

Unsafe conversion tidak menghilangkan data race.

Contoh:

```go
b := []byte("hello")
s := unsafe.String(unsafe.SliceData(b), len(b))

go func() {
    b[0] = 'x'
}()

fmt.Println(s)
```

Ini bukan sekadar “string berubah”. Ini concurrency bug.

### 5.5 Capacity Invariant

Saat membuat `[]byte` dari pointer, length harus benar.

Jika membuat slice terlalu panjang:

```go
p := unsafe.StringData(s)
b := unsafe.Slice(p, len(s)+10) // invalid
```

Anda membaca memory di luar string.

### 5.6 Empty Value Invariant

`unsafe.StringData("")` dapat mengembalikan pointer yang nil atau tidak ditentukan untuk empty string. Jangan dereference pointer dari empty string tanpa guard.

```go
func viewStringData(s string) *byte {
    if len(s) == 0 {
        return nil
    }
    return unsafe.StringData(s)
}
```

### 5.7 Escape/Retention Invariant

View zero-copy bisa membuat memory besar tetap hidup.

```go
buf := make([]byte, 10<<20) // 10 MiB
small := unsafe.String(&buf[100], 5)
cache["x"] = small
```

Jika string view menahan backing array, maka 5 byte bisa membuat 10 MiB tetap retained.

Copy kecil sering lebih baik:

```go
small := string(buf[100:105]) // owned 5-byte string
cache["x"] = small
```

---

## 6. Diagram: Safe Copy vs Unsafe View

```mermaid
flowchart TD
    A[[]byte mutable buffer] -->|string(b)| B[owned immutable string copy]
    A -->|unsafe.String(SliceData(b), len(b))| C[string view to same bytes]

    B --> D[Safe if buffer later mutates]
    C --> E[Invalid if buffer mutates or is reused]

    A --> F[Buffer pool / read next packet / append]
    F --> E
```

---

## 7. Unsafe `[]byte` to `string`

### 7.1 Safe Copy Version

```go
func BytesToStringCopy(b []byte) string {
    return string(b)
}
```

Properties:

- correct,
- owned result,
- result safe to store,
- result safe as map key,
- result safe after buffer reuse,
- allocation/copy cost proportional to length.

### 7.2 Unsafe View Version

```go
func BytesToStringView(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

This is valid only if:

- `b` will not be mutated while string is used,
- `b` will not be returned to pool while string is used,
- `b` will not be appended in a way that changes visible bytes,
- string does not escape beyond buffer lifetime,
- all callers understand borrowed semantics.

### 7.3 Where It Can Be Reasonable

Potentially reasonable:

```go
func parseKeyword(b []byte) bool {
    s := unsafe.String(unsafe.SliceData(b), len(b))
    switch s {
    case "GET", "POST", "PUT", "DELETE":
        return true
    default:
        return false
    }
}
```

Why this might be acceptable:

- string used locally,
- not stored,
- not returned,
- not passed to async goroutine,
- buffer not mutated during switch,
- function boundary is small.

Even here, benchmark against safe alternatives:

```go
func parseKeywordSafe(b []byte) bool {
    return bytes.Equal(b, []byte("GET")) ||
        bytes.Equal(b, []byte("POST")) ||
        bytes.Equal(b, []byte("PUT")) ||
        bytes.Equal(b, []byte("DELETE"))
}
```

For small constants, safe byte comparison may be fast enough.

---

## 8. Unsafe `string` to `[]byte`

This direction is far more dangerous.

### 8.1 Safe Copy Version

```go
func StringToBytesCopy(s string) []byte {
    return []byte(s)
}
```

Properties:

- mutable copy,
- safe to modify,
- safe to pass to APIs that mutate,
- allocation/copy cost proportional to length.

### 8.2 Unsafe Read-Only View Version

```go
func StringToBytesReadOnlyView(s string) []byte {
    if len(s) == 0 {
        return nil
    }
    p := unsafe.StringData(s)
    return unsafe.Slice(p, len(s))
}
```

This slice **must be treated as read-only**.

But Go type system cannot express read-only `[]byte`.

That is the core problem.

Any caller can do:

```go
b := StringToBytesReadOnlyView("hello")
b[0] = 'x' // invalid behavior; may crash or corrupt
```

String literals may live in read-only memory. Mutating bytes derived from a string literal can crash.

### 8.3 Why This API Is Usually Bad

A function returning `[]byte` communicates mutability.

So this API lies:

```go
func Bytes(s string) []byte
```

Even if documented as read-only, it invites misuse.

Better designs:

```go
func WithStringBytes(s string, fn func([]byte) error) error
```

But even this still passes mutable type.

Often better:

```go
func WriteStringTo(w io.Writer, s string) (int, error) {
    return io.WriteString(w, s)
}
```

or simply keep the API string-based.

---

## 9. The `reflect.StringHeader` / `reflect.SliceHeader` Trap

Old unsafe snippets often use:

```go
type StringHeader struct {
    Data uintptr
    Len  int
}

type SliceHeader struct {
    Data uintptr
    Len  int
    Cap  int
}
```

The problem is not only that they are old.

The problem is they encode pointer data as `uintptr`.

`uintptr` is an integer.

GC does not treat it as a pointer root.

### 9.1 Bad Pattern

```go
func badStringData(s string) uintptr {
    h := (*reflect.StringHeader)(unsafe.Pointer(&s))
    return h.Data
}
```

The returned `uintptr` does not keep the string data alive.

If later converted back to pointer, you may have a dangling pointer.

### 9.2 Better Pattern

```go
func firstBytePtr(s string) *byte {
    if len(s) == 0 {
        return nil
    }
    return unsafe.StringData(s)
}
```

A typed pointer is visible to GC as pointer-like data where appropriate.

### 9.3 Still Not Automatically Safe

Even with `unsafe.StringData`, you must respect immutability and lifetime.

Modern API reduces representation dependency. It does not remove responsibility.

---

## 10. Java Comparison: `String`, `byte[]`, `ByteBuffer`, Direct Buffer

A Java engineer may think:

- Java `String` immutable,
- Java `byte[]` mutable,
- `ByteBuffer` can be heap/direct/read-only,
- `String.getBytes()` copies with charset encoding,
- `new String(byte[])` copies/decodes.

Go differs:

- Go `string` is bytes, not UTF-16 characters.
- Go `string` does not carry charset; convention is UTF-8 for text.
- `[]byte(s)` copies raw bytes.
- `string(b)` copies raw bytes into immutable string.
- Unsafe can make views, but no read-only slice type exists.

Important mental shift:

> Java makes mutation boundary more explicit through different object types; Go makes many views cheap, so ownership contract becomes more important.

---

## 11. Case Study: Parser Token Lookup

Imagine parsing a protocol:

```text
CMD key value\n
```

Naive implementation:

```go
func parseCommand(line []byte) string {
    i := bytes.IndexByte(line, ' ')
    if i < 0 {
        return string(line)
    }
    return string(line[:i])
}
```

This copies command token.

If this happens millions of times per second, allocation may show in profile.

### 11.1 Unsafe Local Switch

```go
func isKnownCommand(line []byte) bool {
    i := bytes.IndexByte(line, ' ')
    if i < 0 {
        i = len(line)
    }
    token := line[:i]

    if len(token) == 0 {
        return false
    }

    s := unsafe.String(unsafe.SliceData(token), len(token))
    switch s {
    case "GET", "SET", "DEL", "PING":
        return true
    default:
        return false
    }
}
```

This can be valid because:

- token is used locally,
- result is bool,
- string view does not escape,
- buffer not mutated during switch.

### 11.2 Unsafe Return Is Dangerous

```go
func commandView(line []byte) string {
    i := bytes.IndexByte(line, ' ')
    if i < 0 {
        i = len(line)
    }
    token := line[:i]
    return unsafe.String(unsafe.SliceData(token), len(token))
}
```

This is dangerous unless documented as borrowed and caller cannot outlive/mutate `line`.

But string return type suggests owned immutable data.

Better:

```go
type TokenView struct {
    data []byte
}

func (t TokenView) EqualString(s string) bool {
    return bytes.Equal(t.data, []byte(s))
}

func (t TokenView) StringCopy() string {
    return string(t.data)
}
```

This makes ownership explicit.

---

## 12. Case Study: Logging Corruption

Bad code:

```go
var pool = sync.Pool{
    New: func() any { return make([]byte, 0, 4096) },
}

func handle(msg []byte) {
    buf := pool.Get().([]byte)[:0]
    buf = append(buf, msg...)

    text := unsafe.String(unsafe.SliceData(buf), len(buf))
    go asyncLog(text)

    pool.Put(buf[:0])
}
```

Problem:

- `text` points to pooled buffer.
- buffer returned to pool before async log runs.
- another request reuses buffer.
- log output becomes unrelated request data.

Correct:

```go
func handle(msg []byte) {
    buf := pool.Get().([]byte)[:0]
    buf = append(buf, msg...)

    text := string(buf) // copy before async retention
    go asyncLog(text)

    clear(buf)
    pool.Put(buf[:0])
}
```

Copy is required because retention crosses async/lifetime boundary.

---

## 13. Case Study: Map Key Corruption

Unsafe string used as map key:

```go
b := []byte("customer:123")
k := unsafe.String(unsafe.SliceData(b), len(b))

m := map[string]int{k: 1}

b[9] = '9'
```

This breaks the assumption that string map key is immutable.

Depending on implementation details, this can lead to impossible behavior:

- map lookup fails,
- key prints changed,
- hash bucket no longer matches visible key,
- corruption-like symptoms.

Never use unsafe view string as map key unless backing bytes are immutable forever.

Correct:

```go
k := string(b)
m[k] = 1
```

---

## 14. Case Study: HTTP Header Parsing

Temptation:

```go
func headerName(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

Risk:

- request buffer may be reused,
- header map stores string,
- middleware may retain string,
- logging may happen asynchronously,
- tracing labels may outlive request.

Better:

- compare hot headers using `bytes.EqualFold`,
- copy only when storing,
- canonicalize at ownership boundary.

Example:

```go
func isContentType(name []byte) bool {
    return bytes.EqualFold(name, []byte("Content-Type"))
}

func storeHeader(dst map[string]string, name, value []byte) {
    dst[string(name)] = string(value)
}
```

The hot compare avoids allocation; the storage boundary copies.

---

## 15. Case Study: Metrics Labels

Bad:

```go
func labelFromPath(buf []byte) string {
    return unsafe.String(unsafe.SliceData(buf), len(buf))
}
```

Metrics systems retain labels for a long time.

If label string points to request buffer:

- label can change,
- cardinality can explode,
- memory retention can grow,
- data race can appear.

Correct:

```go
label := string(buf) // owned string
```

Also: normalize labels to avoid high cardinality.

---

## 16. Decision Matrix

| Scenario | Unsafe view? | Better default |
|---|---:|---|
| Local switch on token | Maybe | `bytes.Equal` or local `unsafe.String` after benchmark |
| Return string to caller | Usually no | `string(b)` |
| Store map key | No unless backing immutable forever | `string(b)` |
| Async logging | No | `string(b)` |
| Metrics label | No | `string(b)` |
| Read-only slice view over string | Rare | avoid exposing `[]byte` |
| Passing to mutating API | Never | `[]byte(s)` |
| Parser internal non-escaping compare | Maybe | byte compare first |
| Large immutable mmap region | Maybe with strong lifetime owner | explicit view type |
| Pooled buffer | Very dangerous | copy before retention |

---

## 17. API Design Pattern: Borrowed vs Owned

Unsafe conversion becomes safer when API names reveal ownership.

### 17.1 Bad API

```go
func ToString(b []byte) string
```

This hides whether it copies.

### 17.2 Better API

```go
func StringCopy(b []byte) string {
    return string(b)
}

func BorrowedStringView(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

But even `BorrowedStringView` should usually be `internal`.

### 17.3 Best Pattern: No Escape of Unsafe View

```go
func WithBorrowedString(b []byte, fn func(string) error) error {
    if len(b) == 0 {
        return fn("")
    }
    s := unsafe.String(unsafe.SliceData(b), len(b))
    return fn(s)
}
```

This limits lifetime to callback duration, but still assumes callback does not retain string.

Document:

```go
// WithBorrowedString calls fn with a string view of b.
// The string passed to fn is borrowed and must not be retained after fn returns.
// The caller must not mutate b while fn is executing.
```

In many teams, this contract is still too subtle.

---

## 18. Better Pattern: View Type Instead of Lying String

```go
type ByteToken struct {
    b []byte
}

func (t ByteToken) Equal(s string) bool {
    if len(t.b) != len(s) {
        return false
    }
    for i := range t.b {
        if t.b[i] != s[i] {
            return false
        }
    }
    return true
}

func (t ByteToken) String() string {
    return string(t.b)
}
```

This says:

- internally borrowed bytes,
- convert to owned string only on demand,
- no fake immutable string view leaks out.

For parsers, this is often better than unsafe conversion.

---

## 19. `runtime.KeepAlive` and Lifetime

When dealing with unsafe pointer from Go object, you may need to make lifetime explicit.

Example pattern:

```go
func useStringData(s string) {
    if len(s) == 0 {
        return
    }

    p := unsafe.StringData(s)
    doSomethingWithPointer(p, len(s))

    runtime.KeepAlive(s)
}
```

`runtime.KeepAlive(s)` ensures `s` is considered live until that point.

This matters when pointer is passed to code/compiler cannot see usage clearly, especially around syscall/cgo-like boundaries.

Do not sprinkle `KeepAlive` everywhere. Use it when pointer lifetime crosses an unsafe boundary.

---

## 20. Unsafe Conversion and Escape Analysis

Unsafe conversion can affect escape in non-obvious ways.

Example:

```go
func local(b []byte) bool {
    s := unsafe.String(unsafe.SliceData(b), len(b))
    return s == "OK"
}
```

Likely no string allocation.

But:

```go
func retained(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

Now returned string retains dependence on `b`'s backing array.

The compiler may not allocate a new string, but you created a lifetime coupling.

This is the key trap:

> Removing allocation often transfers lifetime burden to the programmer.

---

## 21. Unsafe Conversion and GC

GC sees Go heap objects and typed pointers.

But unsafe can create relationships that are not obvious from normal code.

Consider:

```go
s := unsafe.String(unsafe.SliceData(b), len(b))
```

Now string data points into `b` backing array.

If `s` survives, backing array must survive. The runtime string data pointer can keep underlying object alive because it points into heap memory, but your semantic ownership may be wrong.

The GC may keep memory alive correctly, but your application may be incorrect because the bytes are mutable/reused.

GC safety is not semantic safety.

---

## 22. Unsafe Conversion and Memory Retention

Suppose you parse one small ID from a huge buffer:

```go
func extractID(packet []byte) string {
    id := packet[100:116]
    return unsafe.String(unsafe.SliceData(id), len(id))
}
```

If caller stores the returned string, the whole packet backing array may be retained.

Correct for stored ID:

```go
func extractID(packet []byte) string {
    id := packet[100:116]
    return string(id)
}
```

This copies 16 bytes and frees potentially large packet memory.

Important lesson:

> Zero-copy can increase memory usage by extending lifetime of large buffers.

---

## 23. Unsafe Conversion and Security

### 23.1 Secret Retention

If a string view points to pooled buffer containing secrets, secret bytes can survive longer than intended.

### 23.2 Secret Mutation

If you convert secret string to `[]byte` view and try to zero it:

```go
b := StringToBytesReadOnlyView(password)
clear(b) // invalid; may corrupt/crash
```

You cannot safely zero a Go string.

If you need zeroable secrets, keep them as owned `[]byte` from the beginning.

### 23.3 Logging Leak

Unsafe views into reused buffers can log data from another request.

This creates cross-request data exposure.

---

## 24. Unsafe Conversion and Testing

Normal unit tests often miss unsafe lifetime bugs.

You need targeted tests:

1. mutate backing buffer after conversion,
2. reuse pooled buffer after conversion,
3. store result in map,
4. call async goroutine after conversion,
5. run with race detector,
6. run fuzz tests,
7. run under high concurrency,
8. force GC between steps,
9. vary input sizes,
10. test empty values.

Example mutation test:

```go
func TestBorrowedStringMutates(t *testing.T) {
    b := []byte("abc")
    s := BorrowedStringView(b)
    b[0] = 'x'

    if s != "xbc" {
        t.Fatalf("expected borrowed view to observe mutation")
    }
}
```

This test documents the dangerous behavior. It should scare callers away from retaining it.

Example copy test:

```go
func TestStringCopyStable(t *testing.T) {
    b := []byte("abc")
    s := string(b)
    b[0] = 'x'

    if s != "abc" {
        t.Fatalf("copy string changed: %q", s)
    }
}
```

---

## 25. Benchmarking Correctly

Benchmark both allocation and correctness boundary.

```go
func BenchmarkStringCopy(b *testing.B) {
    data := []byte("GET")
    b.ReportAllocs()
    for b.Loop() {
        _ = string(data)
    }
}

func BenchmarkStringView(b *testing.B) {
    data := []byte("GET")
    b.ReportAllocs()
    for b.Loop() {
        _ = unsafe.String(unsafe.SliceData(data), len(data))
    }
}
```

But do not stop there.

Benchmark the real operation:

```go
func BenchmarkSwitchCopy(b *testing.B) {
    data := []byte("GET")
    b.ReportAllocs()
    for b.Loop() {
        switch string(data) {
        case "GET", "POST":
        }
    }
}
```

The compiler may optimize some conversions in specific cases.

Always inspect:

```bash
go test -bench=. -benchmem
```

and optionally:

```bash
go test -run=^$ -bench=. -benchmem -gcflags=-m=2
```

---

## 26. Production Review Checklist

Before approving unsafe string/slice conversion, require answers to all questions.

### 26.1 Necessity

- Is there a profile proving copy allocation is material?
- Is this path hot enough?
- Was a safe byte-based API considered?
- Was `bytes.Equal`, `bytes.Cut`, `bytes.HasPrefix`, or parser view considered?
- Was allocation caused by bad API design instead?

### 26.2 Lifetime

- Who owns the backing memory?
- Can result escape function?
- Can result be stored?
- Can result cross goroutine boundary?
- Can backing memory be returned to pool?
- Can backing memory be reused by next read?

### 26.3 Mutation

- Can any code mutate the backing bytes while view exists?
- Can append change visible bytes?
- Is there a data race?
- Is the view over string exposed as mutable `[]byte`?

### 26.4 Retention

- Could small view retain large buffer?
- Is copy actually better because it shortens lifetime?
- Is result used as cache key/map key/metric label/log field?

### 26.5 Encapsulation

- Is unsafe code isolated in `internal` package?
- Is the function name explicit: `Borrowed`, `View`, `Unsafe`?
- Is there a safe alternative nearby?
- Are invariants documented near the code?

### 26.6 Testing

- Is there mutation test?
- Is there pool reuse test?
- Is there async retention test?
- Is there race detector coverage?
- Is there fuzz coverage for parser boundary?
- Is there benchmark evidence?

If any answer is weak, reject unsafe conversion.

---

## 27. Mermaid: Unsafe Conversion Review Flow

```mermaid
flowchart TD
    A[Need string/slice conversion in hot path] --> B{Profile proves copy is material?}
    B -- No --> C[Use normal safe conversion]
    B -- Yes --> D{Can API stay in []byte/string without conversion?}
    D -- Yes --> E[Redesign API]
    D -- No --> F{Will result escape or be retained?}
    F -- Yes --> G[Use copy]
    F -- No --> H{Backing memory immutable during use?}
    H -- No --> G
    H -- Yes --> I{Can backing memory be pooled/reused concurrently?}
    I -- Yes --> G
    I -- No --> J[Consider unsafe view inside small internal boundary]
    J --> K[Add tests, benchmark, docs, review checklist]
```

---

## 28. Recommended Internal Package Design

If a team really needs unsafe views, isolate them.

```go
package bytex

import "unsafe"

// BorrowedString returns a string view over b without copying.
//
// The returned string is valid only while b remains alive and unchanged.
// The caller must not retain the returned string after the owner of b may mutate,
// reuse, or release b. Do not use the result as a map key, cache key, log field,
// metric label, or cross-goroutine value unless b is immutable for the same lifetime.
func BorrowedString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}

// StringCopy returns an owned string copy of b.
func StringCopy(b []byte) string {
    return string(b)
}
```

Notice the explicit naming.

Never call the unsafe function `ToString`.

---

## 29. Avoid Returning Mutable Slice From String

If you absolutely need read-only bytes from string for local function call, prefer callback and do not export it.

```go
func withStringBytes(s string, fn func([]byte)) {
    if len(s) == 0 {
        fn(nil)
        return
    }
    b := unsafe.Slice(unsafe.StringData(s), len(s))
    fn(b)
    runtime.KeepAlive(s)
}
```

But this is still risky because `fn` can mutate `b`.

A safer pattern is to adapt the downstream API to accept string or `io.StringReader`/`strings.Reader` where possible.

---

## 30. Safer Alternatives Catalog

### 30.1 Compare Byte to String Without Allocation

```go
func equalBytesString(b []byte, s string) bool {
    if len(b) != len(s) {
        return false
    }
    for i := range b {
        if b[i] != s[i] {
            return false
        }
    }
    return true
}
```

### 30.2 Write String Without `[]byte`

```go
io.WriteString(w, s)
```

### 30.3 Build String Efficiently

```go
var sb strings.Builder
sb.Grow(128)
sb.WriteString("prefix")
sb.WriteByte(':')
s := sb.String()
```

### 30.4 Build Bytes Efficiently

```go
buf := make([]byte, 0, 128)
buf = append(buf, "prefix"...)
buf = append(buf, ':')
```

### 30.5 Copy Only At Ownership Boundary

```go
func parseThenStore(packet []byte, cache map[string]Value) {
    keyView := parseKeyView(packet)
    cache[string(keyView)] = parseValue(packet)
}
```

This keeps parser allocation-free internally, but copies when storing.

---

## 31. Anti-Pattern Catalog

### Anti-pattern 1: Unsafe everywhere

```go
func FastString(b []byte) string { ... }
```

Used broadly without contract.

### Anti-pattern 2: Unsafe map key

```go
m[unsafe.String(unsafe.SliceData(buf), len(buf))] = v
```

### Anti-pattern 3: Unsafe async log

```go
go log.Println(unsafe.String(...))
```

### Anti-pattern 4: Unsafe string-to-bytes then mutate

```go
b := unsafe.Slice(unsafe.StringData(s), len(s))
b[0] = 'x'
```

### Anti-pattern 5: Header hack

```go
(*reflect.StringHeader)(unsafe.Pointer(&s))
```

### Anti-pattern 6: Pool reuse after borrowed conversion

```go
s := borrowed(buf)
pool.Put(buf)
use(s)
```

### Anti-pattern 7: Return borrowed string from public API

```go
func Token() string // actually borrowed
```

### Anti-pattern 8: Zero-copy tiny data

Unsafe used to avoid copying 5 bytes while adding semantic complexity.

### Anti-pattern 9: Hide unsafe in innocent helper

```go
func b2s(b []byte) string
```

### Anti-pattern 10: Assume benchmark equals production safety

Microbenchmark proves allocation improvement, but not lifetime correctness.

---

## 32. Incident Playbook

Symptoms that may point to unsafe conversion bug:

- logs contain data from wrong request,
- map lookup fails for visible key,
- cache miss rate spikes after optimization,
- metric label cardinality explodes,
- response body contains mixed payload,
- race detector reports mutation in parser/logging,
- rare SIGSEGV around unsafe/cgo/mmap,
- heap retention unexpectedly tied to small strings,
- pprof shows huge buffers retained by strings.

Investigation steps:

1. Search for `unsafe.String`, `unsafe.StringData`, `unsafe.Slice`, `unsafe.SliceData`.
2. Search for `reflect.StringHeader` and `reflect.SliceHeader`.
3. Identify whether result is returned/stored/async.
4. Find backing buffer owner.
5. Check pool reuse.
6. Run with `-race`.
7. Add mutation-after-conversion test.
8. Temporarily replace unsafe with safe copy.
9. Compare whether corruption disappears.
10. Inspect heap profile for retained large buffers.

---

## 33. Mini Lab

### Lab 1: Observe Mutation Through Borrowed String

```go
package main

import (
    "fmt"
    "unsafe"
)

func borrowed(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func main() {
    b := []byte("hello")
    s := borrowed(b)
    fmt.Println(s)

    b[0] = 'x'
    fmt.Println(s)
}
```

Expected lesson: string view changes when backing bytes change.

### Lab 2: Compare With Safe Copy

```go
func copied(b []byte) string {
    return string(b)
}
```

Repeat mutation and observe stable string.

### Lab 3: Pooled Buffer Corruption

Create `sync.Pool`, borrow string from buffer, return buffer to pool, reuse buffer, print borrowed string.

Expected lesson: unsafe view can observe unrelated data.

### Lab 4: Retention

Create large buffer, return small unsafe string view, store it globally, inspect heap profile.

Expected lesson: small view can retain large object.

### Lab 5: Replace Unsafe With Byte Compare

Benchmark:

- `switch unsafe string`,
- `string(b)` switch,
- `bytes.Equal`,
- manual compare.

Expected lesson: unsafe is not automatically the best solution.

---

## 34. Deep Mental Model: Copy Removes Coupling

A copy is not merely a cost.

A copy is a boundary.

Copy creates:

- independent lifetime,
- independent mutability,
- smaller retained memory,
- safer map key,
- safe async use,
- safe logging,
- simpler API contract.

Unsafe zero-copy removes the allocation by preserving coupling.

That means you pay with:

- stronger invariants,
- harder review,
- harder testing,
- more subtle bugs,
- weaker type-system protection.

Top-level principle:

> Copy at ownership boundaries. Borrow only inside tightly controlled synchronous scopes.

---

## 35. Production Rules of Thumb

1. Default to safe conversions.
2. Avoid unsafe string-to-bytes views in public APIs.
3. Never mutate bytes derived from string data.
4. Never use borrowed unsafe string as long-lived map/cache/metric/log key.
5. Never return borrowed string from public API unless contract is extremely explicit and justified.
6. Never combine unsafe borrowed string with pooled mutable buffer unless usage is strictly synchronous and non-retained.
7. Use byte-based comparisons before reaching for unsafe.
8. Copy small tokens at storage boundary.
9. Treat unsafe conversion as an optimization requiring benchmark, tests, and design review.
10. Keep unsafe code isolated, named, documented, and small.

---

## 36. Summary

Unsafe string/slice conversion in Go is not primarily about syntax. It is about preserving semantic contracts manually.

The core facts:

- `string` is immutable byte sequence.
- `[]byte` is mutable view over backing array.
- Normal conversions copy to preserve semantic isolation.
- Go 1.20+ provides `unsafe.String`, `unsafe.StringData`, `unsafe.Slice`, and `unsafe.SliceData` to avoid old header hacks.
- These APIs are still unsafe.
- `reflect.StringHeader` and `reflect.SliceHeader` style code should be avoided for new code.
- Zero-copy may reduce allocation but increase lifetime coupling and memory retention.
- Copy is often the correct production boundary.

The mature engineering posture:

> Unsafe view is acceptable only when the lifetime, mutation, ownership, concurrency, and retention invariants are explicitly known, tested, and localized.

---

## 37. What Comes Next

Next part:

```text
learn-go-memory-systems-part-023.md
```

Topic:

```text
Off-heap in Go: cgo, mmap, syscall memory, unmanaged memory, ownership model
```

Part 023 will move from unsafe view over Go-managed memory into memory not directly managed as ordinary Go heap data: cgo allocations, mmap, syscall memory, and external/native ownership.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-memory-systems-part-021.md">⬅️ Part 021 — `unsafe` Fundamentals: Valid Pointer Patterns, `uintptr` Hazards, `unsafe.Add`, `unsafe.Slice`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-memory-systems-part-023.md">Go Memory Systems — Part 023 ➡️</a>
</div>
