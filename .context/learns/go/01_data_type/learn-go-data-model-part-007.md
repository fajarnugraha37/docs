# learn-go-data-model-part-007.md
# Text Model II: `strings`, `bytes`, `strings.Builder`, `bytes.Buffer`, dan Boundary Efisiensi

> Seri: `learn-go-data-model`  
> Part: `007 / 034`  
> Target pembaca: Java software engineer yang ingin memahami Go data model di level production engineering.  
> Fokus: text processing sebagai desain data, ownership, allocation, boundary conversion, streaming, dan performa.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya, kita membahas bahwa `string` di Go adalah **immutable byte sequence** yang umumnya berisi UTF-8, bukan array karakter. Kita juga membedakan `byte`, `rune`, code point, grapheme cluster, dan jebakan multilingual system.

Part ini melanjutkan dari pertanyaan yang lebih engineering:

```text
Kalau string adalah immutable byte sequence,
bagaimana cara memproses text secara efisien, aman, dan jelas?
```

Kita akan membahas:

```text
- package strings
- package bytes
- strings.Builder
- bytes.Buffer
- []byte <-> string conversion cost
- allocation behavior
- streaming text processing
- large text payload
- unsafe.String / unsafe.Slice boundary
- API ownership contract
- anti-pattern umum di production
```

Bagian ini bukan sekadar “pakai `strings.Contains` kalau mau search”. Fokusnya adalah **mental model dan trade-off**.

---

## 1. Mental Model Utama: Text di Go Memiliki Dua Bentuk Dominan

Dalam Go, text biasanya muncul dalam dua bentuk:

```go
string // immutable, value-oriented, safe sebagai key/map/log/API domain
[]byte // mutable, buffer-oriented, cocok untuk I/O, parsing, decoding, network
```

Keduanya sama-sama berisi byte, tetapi berbeda kontrak.

| Bentuk | Mutability | Umum dipakai untuk | Konsekuensi |
|---|---:|---|---|
| `string` | immutable | identifier, label, key, config, log, JSON field, SQL query fragment yang sudah valid | aman dishare, bisa jadi map key, conversion dari `[]byte` biasanya copy |
| `[]byte` | mutable | I/O buffer, network frame, file chunk, parser buffer, temporary construction | tidak bisa jadi map key, bisa berubah, ownership harus jelas |

### 1.1 Java Comparison

Di Java:

```java
String s = "abc";          // immutable
StringBuilder b = new StringBuilder();
byte[] data = ...;
```

Di Go:

```go
s := "abc"          // immutable byte sequence
var b strings.Builder
buf := make([]byte, 0, 4096)
```

Namun perbedaannya penting:

```text
Java String historically feels like “text object”.
Go string feels closer to “immutable bytes with UTF-8 convention”.
```

Karena itu, boundary design di Go biasanya bertanya:

```text
Apakah data ini sudah menjadi domain text yang stabil?
Atau masih buffer mentah yang sedang diproses?
```

---

## 2. Diagram Besar: Text Lifecycle di Go

```mermaid
flowchart TD
    A[External Source\nfile/network/db/http] --> B[[]byte buffer]
    B --> C{Need parse/inspect?}
    C -->|byte-level parsing| D[bytes package]
    C -->|text-level search/normalize| E[string conversion]
    E --> F[strings package]
    D --> G[validated domain value]
    F --> G
    G --> H[string domain field]
    H --> I[serialization/logging/database/API]

    B -. mutable .-> B
    H -. immutable .-> H
```

Prinsipnya:

```text
Raw input often starts as []byte.
Stable semantic text should usually become string.
Temporary construction should use Builder/Buffer.
```

---

## 3. `strings` Package: Operasi untuk Immutable Text

Package `strings` menyediakan operasi untuk `string`.

Contoh:

```go
strings.Contains(s, "admin")
strings.HasPrefix(s, "Bearer ")
strings.TrimSpace(s)
strings.Split(s, ",")
strings.Join(parts, ",")
strings.Cut(s, ":")
strings.EqualFold(a, b)
```

### 3.1 Kapan Pakai `strings`

Gunakan `strings` ketika:

```text
- input sudah berupa string
- data dianggap immutable
- output juga domain text
- operasi bersifat logical text operation
- kamu ingin API jelas dan readable
```

Contoh bagus:

```go
func ParseAuthorizationHeader(header string) (scheme string, token string, ok bool) {
    scheme, token, ok = strings.Cut(header, " ")
    if !ok {
        return "", "", false
    }
    if !strings.EqualFold(scheme, "Bearer") {
        return "", "", false
    }
    return scheme, token, token != ""
}
```

Kenapa ini bagus?

```text
- header sudah semantic string
- Cut menghindari Index + manual slicing boilerplate
- EqualFold lebih tepat untuk case-insensitive ASCII/Unicode simple folding dibanding strings.ToLower(a) == strings.ToLower(b)
```

### 3.2 `strings.Cut` vs `strings.Split`

Anti-pattern umum:

```go
parts := strings.Split(header, " ")
if len(parts) != 2 {
    return false
}
```

Masalah:

```text
- Split memproses semua separator
- menghasilkan slice
- lebih banyak allocation/struktur temporer
- kurang menyatakan intent kalau hanya butuh separator pertama
```

Lebih baik:

```go
scheme, token, ok := strings.Cut(header, " ")
if !ok {
    return false
}
```

Mental model:

```text
Split = decompose all
Cut   = separate once
```

### 3.3 `strings.TrimSpace` Bukan Validasi Universal

```go
name := strings.TrimSpace(input)
if name == "" {
    return error
}
```

Ini berguna, tetapi jangan menganggap semua problem text selesai.

Pertanyaan production:

```text
- Apakah whitespace internal boleh?
- Apakah Unicode whitespace boleh?
- Apakah newline boleh?
- Apakah zero-width character boleh?
- Apakah normalization perlu?
- Apakah case-insensitive uniqueness perlu?
```

Untuk domain seperti username, kode regulator, ID dokumen, atau permission name, biasanya perlu policy yang lebih eksplisit.

---

## 4. `bytes` Package: Operasi untuk Mutable/Raw Byte Data

Package `bytes` mirip `strings`, tetapi bekerja pada `[]byte`.

Contoh:

```go
bytes.Contains(data, []byte("\r\n"))
bytes.HasPrefix(data, []byte("HTTP/1.1"))
bytes.TrimSpace(data)
bytes.Split(data, []byte(","))
bytes.Cut(data, []byte(":"))
bytes.EqualFold(a, b)
```

Gunakan `bytes` ketika:

```text
- input masih raw byte buffer
- berasal dari file/network/parser
- kamu ingin menghindari konversi string sementara
- data mungkin binary, bukan valid UTF-8
- kamu sedang membangun parser/protocol/data transfer layer
```

Contoh:

```go
func HasHTTPHeaderEnd(buf []byte) bool {
    return bytes.Contains(buf, []byte("\r\n\r\n"))
}
```

Di sini `[]byte` lebih natural daripada `string` karena data berasal dari network buffer dan mungkin belum lengkap.

---

## 5. `string` dan `[]byte`: Conversion Cost dan Ownership

Konversi eksplisit:

```go
s := string(b)
b2 := []byte(s)
```

Secara konseptual, conversion ini membuat representasi baru agar kontrak immutability/mutability aman.

```text
[]byte -> string: string harus immutable, sehingga runtime tidak boleh membiarkan string berubah ketika []byte berubah.
string -> []byte: []byte mutable, sehingga runtime tidak boleh membiarkan mutasi slice mengubah string asli.
```

### 5.1 Kenapa Copy Itu Feature, Bukan Bug

Bayangkan kalau `string(b)` tidak copy:

```go
b := []byte("admin")
s := string(b)
b[0] = 'x'
fmt.Println(s) // kalau ikut berubah, map key/log/security check bisa rusak
```

Go melindungi invariant:

```text
string is immutable.
```

Jadi conversion copy adalah harga untuk safety.

### 5.2 Ownership Contract

Saat fungsi menerima `[]byte`, harus jelas:

```text
Apakah function hanya membaca selama call?
Apakah function menyimpan slice setelah return?
Apakah caller boleh mutate setelah call?
```

Contoh bahaya:

```go
type TokenStore struct {
    token []byte
}

func (s *TokenStore) Set(token []byte) {
    s.token = token // BUG: caller can mutate later
}
```

Lebih aman:

```go
func (s *TokenStore) Set(token []byte) {
    s.token = append(s.token[:0], token...)
}
```

Atau kalau domain-nya memang immutable text:

```go
type TokenStore struct {
    token string
}

func (s *TokenStore) Set(token []byte) {
    s.token = string(token)
}
```

Prinsip:

```text
Store immutable semantic text as string.
Store mutable working memory as []byte.
Copy when ownership crosses lifetime boundary.
```

---

## 6. `strings.Builder`: Efficient String Construction

`strings.Builder` dipakai untuk membangun string secara incremental.

Contoh:

```go
func BuildCSVLine(fields []string) string {
    var b strings.Builder

    for i, f := range fields {
        if i > 0 {
            b.WriteByte(',')
        }
        b.WriteString(f)
    }

    return b.String()
}
```

### 6.1 Kenapa Bukan `+=` dalam Loop?

Anti-pattern:

```go
s := ""
for _, part := range parts {
    s += part
}
```

Masalahnya:

```text
string immutable → setiap concatenation dapat membuat string baru
loop banyak part → potensi O(n²) copying
allocation banyak
```

Lebih baik:

```go
var b strings.Builder
for _, part := range parts {
    b.WriteString(part)
}
s := b.String()
```

### 6.2 Gunakan `Grow` Kalau Bisa Estimasi Ukuran

```go
func JoinWithPrefix(prefix string, items []string) string {
    var n int
    n += len(prefix)
    for _, item := range items {
        n += len(item) + 1
    }

    var b strings.Builder
    b.Grow(n)

    b.WriteString(prefix)
    for _, item := range items {
        b.WriteByte(':')
        b.WriteString(item)
    }
    return b.String()
}
```

`Grow` mengurangi reallocation ketika ukuran bisa diperkirakan.

### 6.3 `Builder` Jangan Dicopy Setelah Dipakai

`strings.Builder` memiliki constraint penting: jangan copy Builder yang sudah digunakan.

Buruk:

```go
var b strings.Builder
b.WriteString("hello")

b2 := b // wrong: copying non-zero Builder
b2.WriteString(" world")
```

Kenapa?

```text
Builder membawa state internal buffer.
Copy setelah first use dapat membuat aliasing state yang tidak valid.
```

Rule praktis:

```text
Pass *strings.Builder if helper needs to write into existing builder.
Do not store Builder by value in structs that are copied casually.
Do not return Builder; return string.
```

Contoh helper yang baik:

```go
func writeUserLabel(b *strings.Builder, id int64, name string) {
    b.WriteString("user:")
    b.WriteString(strconv.FormatInt(id, 10))
    b.WriteByte(':')
    b.WriteString(name)
}
```

---

## 7. `bytes.Buffer`: Buffer untuk Byte dan I/O

`bytes.Buffer` adalah buffer variable-size untuk byte, dengan method read/write.

Contoh:

```go
var buf bytes.Buffer
buf.WriteString("hello")
buf.WriteByte(' ')
buf.Write([]byte("world"))

out := buf.String()
```

`bytes.Buffer` cocok ketika:

```text
- output akhirnya bisa berupa []byte atau string
- kamu butuh io.Reader / io.Writer behavior
- kamu membangun payload binary/text campuran
- kamu ingin read dari buffer juga, bukan hanya write
```

### 7.1 `strings.Builder` vs `bytes.Buffer`

| Pertanyaan | Pilihan Umum |
|---|---|
| Output akhir pasti `string`? | `strings.Builder` |
| Butuh `[]byte`? | `bytes.Buffer` atau `[]byte` append |
| Butuh `io.Reader`? | `bytes.Buffer` |
| Butuh write-only string construction? | `strings.Builder` |
| Data binary? | `bytes.Buffer` / `[]byte` |
| Butuh minimal abstraction? | `[]byte` + `append` |

Contoh output string:

```go
var b strings.Builder
b.WriteString("SELECT ")
b.WriteString(column)
query := b.String()
```

Contoh output bytes:

```go
var buf bytes.Buffer
buf.Write([]byte{0x01, 0x02})
buf.WriteString("payload")
frame := buf.Bytes()
```

### 7.2 `bytes.Buffer.Bytes()` Ownership Trap

```go
frame := buf.Bytes()
```

`frame` menunjuk ke internal buffer. Jika buffer dimodifikasi lagi, `frame` bisa ikut terdampak.

Aman kalau perlu menyimpan terpisah:

```go
frame := append([]byte(nil), buf.Bytes()...)
```

Prinsip:

```text
Bytes() exposes internal view.
String() returns string view/copy semantics depending implementation, but treat it as immutable result.
If storing bytes beyond buffer lifecycle, copy.
```

---

## 8. `[]byte` + `append`: Primitive yang Sering Lebih Tepat

Untuk format sederhana, `[]byte` dengan `append` sering paling jelas dan efisien.

```go
func EncodeKV(dst []byte, key, value string) []byte {
    dst = append(dst, key...)
    dst = append(dst, '=')
    dst = append(dst, value...)
    dst = append(dst, '\n')
    return dst
}
```

Pattern ini bagus karena:

```text
- caller bisa reuse buffer
- allocation dapat dikontrol
- cocok untuk encoder high-throughput
- tidak memaksa intermediate string
```

Contoh production-style:

```go
func AppendAuditLine(dst []byte, userID, action string, at time.Time) []byte {
    dst = append(dst, "user="...)
    dst = append(dst, userID...)
    dst = append(dst, " action="...)
    dst = append(dst, action...)
    dst = append(dst, " at="...)
    dst = at.AppendFormat(dst, time.RFC3339Nano)
    dst = append(dst, '\n')
    return dst
}
```

Perhatikan `time.Time.AppendFormat`: API `AppendXxx(dst []byte, ...) []byte` adalah pattern efisien untuk menghindari intermediate string.

---

## 9. Streaming Text Processing

Untuk payload besar, jangan selalu baca semua ke memory.

Anti-pattern:

```go
data, err := io.ReadAll(r)
if err != nil {
    return err
}
lines := strings.Split(string(data), "\n")
for _, line := range lines {
    process(line)
}
```

Masalah:

```text
- seluruh payload masuk memory
- []byte -> string copy besar
- Split membuat slice besar
- setiap line mungkin mempertahankan referensi ke string besar
- risk untuk file/network payload tidak terkontrol
```

Lebih baik untuk line-based processing:

```go
scanner := bufio.NewScanner(r)
for scanner.Scan() {
    line := scanner.Text()
    if err := process(line); err != nil {
        return err
    }
}
if err := scanner.Err(); err != nil {
    return err
}
```

Namun `Scanner` memiliki batas token default. Untuk line besar, gunakan buffer custom:

```go
scanner := bufio.NewScanner(r)
scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
```

Atau gunakan `bufio.Reader` untuk kontrol lebih eksplisit.

---

## 10. Large Payload Strategy

Untuk payload besar, desain harus menjawab:

```text
- Apakah perlu full materialization?
- Apakah bisa streaming?
- Apakah perlu random access?
- Apakah perlu normalize seluruh text?
- Apakah output bisa append ke writer?
- Apakah data bisa diproses chunk-by-chunk?
```

### 10.1 Materialize vs Stream

| Situasi | Strategi |
|---|---|
| Payload kecil, perlu random access | materialize sebagai `string` / `[]byte` |
| Payload besar, line-based | `bufio.Scanner` atau `bufio.Reader` |
| Payload besar, transform output | stream `io.Reader` → `io.Writer` |
| Parser binary/text protocol | `[]byte` buffer + state machine |
| JSON besar | streaming decoder jika memungkinkan |

### 10.2 Transform dengan Writer

Buruk:

```go
func RenderReport(rows []Row) string {
    var s string
    for _, row := range rows {
        s += renderRow(row)
    }
    return s
}
```

Lebih baik:

```go
func WriteReport(w io.Writer, rows []Row) error {
    for _, row := range rows {
        if err := writeRow(w, row); err != nil {
            return err
        }
    }
    return nil
}
```

Keuntungan:

```text
- bisa langsung stream ke HTTP response/file/compressor
- memory lebih stabil
- caller memilih destination
- mudah dites dengan bytes.Buffer
```

---

## 11. Allocation Thinking: Where Copies Happen

Diagram umum:

```mermaid
flowchart LR
    A[[]byte input] -->|string(b)| B[string copy]
    B -->|strings.Split| C[[]string headers/views]
    B -->|concatenate loop| D[new strings repeatedly]
    B -->|Builder WriteString| E[builder buffer]
    E -->|String| F[final string]

    A -->|bytes.Cut| G[[]byte views into same array]
    G -->|store without copy| H[aliasing risk]
    G -->|append copy| I[owned bytes]
```

Checklist saat review:

```text
- Apakah conversion string/[]byte terjadi di hot path?
- Apakah loop membangun string dengan +=?
- Apakah Split dipakai padahal hanya butuh Cut?
- Apakah []byte dari buffer disimpan tanpa copy?
- Apakah substring/slice mempertahankan backing besar?
- Apakah builder/buffer dipakai ulang dengan benar?
```

---

## 12. Substring dan Memory Retention

Contoh:

```go
func ExtractToken(large string) string {
    _, token, _ := strings.Cut(large, "token=")
    token, _, _ = strings.Cut(token, "\n")
    return token
}
```

Secara konseptual, substring dapat membuat hasil yang merujuk ke data string besar. Detail implementasi bisa berubah, tetapi sebagai engineer production, pertanyaannya tetap:

```text
Apakah return value kecil ini dapat memperpanjang lifetime payload besar?
```

Kalau token kecil disimpan lama, buat owned copy:

```go
func CloneString(s string) string {
    return strings.Clone(s)
}
```

Contoh:

```go
func ExtractOwnedToken(large string) string {
    _, token, ok := strings.Cut(large, "token=")
    if !ok {
        return ""
    }
    token, _, _ = strings.Cut(token, "\n")
    return strings.Clone(token)
}
```

Prinsip:

```text
Short-lived substring: usually fine.
Long-lived substring extracted from huge payload: consider strings.Clone.
```

Untuk `[]byte`, pattern-nya:

```go
small := append([]byte(nil), view...)
```

---

## 13. `strings.Clone`: Explicit Ownership untuk String

`strings.Clone(s)` mengembalikan copy baru dari string.

Gunakan ketika:

```text
- string kecil diekstrak dari string besar
- string akan disimpan lama
- kamu ingin memutus retention terhadap buffer besar
- ownership perlu eksplisit
```

Jangan gunakan sebagai ritual di semua tempat. Copy selalu punya cost.

Rule:

```text
Clone when lifetime boundary changes and retention risk matters.
Do not clone just because “copy feels safer”.
```

---

## 14. Case Study: Parser Header yang Salah Ownership

Misal kita punya parser header sederhana:

```go
type Header struct {
    Key   []byte
    Value []byte
}

func ParseHeaderLine(line []byte) (Header, bool) {
    key, value, ok := bytes.Cut(line, []byte(":"))
    if !ok {
        return Header{}, false
    }
    return Header{
        Key:   bytes.TrimSpace(key),
        Value: bytes.TrimSpace(value),
    }, true
}
```

Ini cepat, tetapi `Key` dan `Value` adalah view ke `line`.

Kalau caller reuse buffer:

```go
buf := make([]byte, 4096)
// read line into buf
h, _ := ParseHeaderLine(buf[:n])
// later buf reused
```

`h.Key` dan `h.Value` bisa berubah secara tidak sengaja.

Perbaikan 1: simpan sebagai string domain:

```go
type Header struct {
    Key   string
    Value string
}

func ParseHeaderLine(line []byte) (Header, bool) {
    key, value, ok := bytes.Cut(line, []byte(":"))
    if !ok {
        return Header{}, false
    }
    return Header{
        Key:   string(bytes.TrimSpace(key)),
        Value: string(bytes.TrimSpace(value)),
    }, true
}
```

Perbaikan 2: tetap bytes, tetapi copy:

```go
type Header struct {
    Key   []byte
    Value []byte
}

func ParseHeaderLineOwned(line []byte) (Header, bool) {
    key, value, ok := bytes.Cut(line, []byte(":"))
    if !ok {
        return Header{}, false
    }
    key = bytes.TrimSpace(key)
    value = bytes.TrimSpace(value)

    return Header{
        Key:   append([]byte(nil), key...),
        Value: append([]byte(nil), value...),
    }, true
}
```

Design question:

```text
Apakah Header adalah domain object yang hidup lama?
Atau temporary parse view yang hanya valid sampai buffer berikutnya?
```

Kalau temporary view, namai secara eksplisit:

```go
type HeaderView struct {
    Key   []byte
    Value []byte
}
```

Nama `View` membantu reviewer melihat bahwa ownership tidak dimiliki.

---

## 15. `unsafe.String`, `unsafe.Slice`, dan Zero-Copy Boundary

Go menyediakan fungsi unsafe untuk membangun string/slice tanpa bergantung pada representasi internal lama seperti `reflect.StringHeader` atau `reflect.SliceHeader`.

Namun ini bukan tool normal untuk aplikasi business logic.

### 15.1 Problem yang Ingin Dipecahkan

Kadang di hot path, copy `[]byte -> string` mahal.

Contoh parser high-throughput:

```text
network bytes -> parse key -> lookup map[string]handler
```

Naif:

```go
key := string(keyBytes) // copy
handler := handlers[key]
```

Ada godaan memakai zero-copy unsafe string.

### 15.2 Bahaya Utama

Jika string dibuat dari mutable bytes tanpa copy, maka invariant string immutable bisa dilanggar secara logical.

```go
// Pseudocode: do not copy-paste as general app pattern.
s := unsafe.String(&b[0], len(b))
b[0] = 'X'
// s now observes changed memory => violates normal string expectation
```

Masalah:

```text
- mutation after conversion breaks immutability assumption
- lifetime buffer harus lebih panjang dari string usage
- GC visibility and pointer lifetime must be correct
- empty slice edge case harus aman
- future maintainers mudah salah
```

### 15.3 Rule Production

Gunakan unsafe zero-copy hanya jika semua benar:

```text
- hot path terbukti oleh benchmark/profile
- ownership buffer benar-benar immutable selama string hidup
- lifetime buffer jelas
- helper terkapsulasi kecil
- diberi komentar invariant
- ada test dan benchmark
- direview oleh engineer yang paham unsafe
```

Contoh komentar invariant:

```go
// bytesToStringView returns a string view over b without copying.
// Invariant:
//   - b must not be mutated while the returned string is used.
//   - b must remain alive while the returned string is used.
//   - caller must not store the result beyond b's lifetime.
// This function is only for parser hot paths proven by benchmark.
func bytesToStringView(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(&b[0], len(b))
}
```

Di business application, default yang benar adalah:

```go
s := string(b)
```

---

## 16. API Design: Accept `string` or `[]byte`?

Pertanyaan API paling sering:

```text
Should this function accept string or []byte?
```

### 16.1 Terima `string` Jika Domain-nya Text Stabil

```go
func ValidateEmail(email string) error
func ParseUserID(s string) (UserID, error)
func HasPermission(role string, permission string) bool
```

Karena:

```text
- semantic-nya text
- immutable
- bisa berasal dari config/db/json/logical domain
- tidak perlu memberi kesan function akan mutate
```

### 16.2 Terima `[]byte` Jika Domain-nya Raw Input/Encoding/I/O

```go
func DecodeFrame(data []byte) (Frame, error)
func ParsePacket(packet []byte) (Packet, error)
func HashPayload(payload []byte) Digest
```

Karena:

```text
- data mungkin binary
- caller mungkin sudah punya buffer
- conversion ke string tidak perlu
- parser bisa mengembalikan view atau copy sesuai kontrak
```

### 16.3 Terima `io.Reader` Jika Data Bisa Besar/Streaming

```go
func ImportCSV(r io.Reader) error
func ParseLogStream(r io.Reader, sink Sink) error
func RenderTemplate(w io.Writer, data Data) error
```

Karena:

```text
- tidak memaksa semua data masuk memory
- cocok untuk file/network/http body
- composable dengan gzip/encryption/tee/limit reader
```

### 16.4 Return `string` or Write to `io.Writer`?

Return `string` untuk hasil kecil/stabil:

```go
func UserDisplayName(u User) string
```

Write ke `io.Writer` untuk hasil besar atau streaming:

```go
func WriteReport(w io.Writer, report Report) error
```

---

## 17. Decision Matrix

```mermaid
flowchart TD
    A[Need to process text/data] --> B{Input size bounded and small?}
    B -->|No| C[Prefer io.Reader / streaming]
    B -->|Yes| D{Is data semantic text?}
    D -->|Yes| E[string + strings]
    D -->|No or binary/raw| F[[]byte + bytes]
    E --> G{Building output incrementally?}
    G -->|String output| H[strings.Builder]
    G -->|Byte/I/O output| I[bytes.Buffer or []byte append]
    F --> J{Need store beyond input lifetime?}
    J -->|Yes| K[copy to owned []byte or string]
    J -->|No| L[view is acceptable with documented lifetime]
```

---

## 18. Anti-Patterns dan Corrections

### 18.1 Repeated String Concatenation in Loop

Buruk:

```go
out := ""
for _, x := range xs {
    out += render(x)
}
```

Baik:

```go
var b strings.Builder
for _, x := range xs {
    b.WriteString(render(x))
}
out := b.String()
```

Lebih baik lagi jika bisa avoid intermediate `render(x)`:

```go
var b strings.Builder
for _, x := range xs {
    writeRendered(&b, x)
}
out := b.String()
```

### 18.2 `Split` untuk Separator Pertama

Buruk:

```go
parts := strings.SplitN(s, ":", 2)
if len(parts) != 2 { ... }
```

Bisa diterima, tetapi lebih idiomatis:

```go
left, right, ok := strings.Cut(s, ":")
```

### 18.3 Lowercase Allocation untuk Case-Insensitive Compare

Buruk:

```go
if strings.ToLower(a) == strings.ToLower(b) {
    ...
}
```

Lebih baik:

```go
if strings.EqualFold(a, b) {
    ...
}
```

### 18.4 Storing Buffer View Accidentally

Buruk:

```go
func (c *Cache) Put(key string, value []byte) {
    c.values[key] = value
}
```

Baik:

```go
func (c *Cache) Put(key string, value []byte) {
    c.values[key] = append([]byte(nil), value...)
}
```

### 18.5 Converting Whole Payload to String Too Early

Buruk:

```go
body, _ := io.ReadAll(r)
if strings.Contains(string(body), "needle") { ... }
```

Lebih baik kalau raw bytes cukup:

```go
body, _ := io.ReadAll(r)
if bytes.Contains(body, []byte("needle")) { ... }
```

Lebih baik lagi kalau payload besar: stream/search chunked sesuai kebutuhan.

---

## 19. Boundary with JSON, HTTP, Logging, Database

### 19.1 JSON

JSON encoder/decoder sering bekerja dengan struct field `string` untuk semantic text.

```go
type Request struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}
```

Untuk raw bytes, `[]byte` dalam JSON memiliki behavior khusus: encoded sebagai base64 string oleh `encoding/json`.

Karena itu jangan sembarang memakai `[]byte` untuk textual JSON field kalau maksudnya plain text.

```go
type Bad struct {
    Name []byte `json:"name"` // JSON output bukan "abc", melainkan base64
}
```

Gunakan `string` untuk text.

### 19.2 HTTP

HTTP header di Go direpresentasikan sebagai string-level API:

```go
r.Header.Get("Authorization")
```

HTTP body adalah stream:

```go
r.Body // io.ReadCloser
```

Ini mencerminkan boundary:

```text
metadata kecil -> string
payload potensial besar -> stream
```

### 19.3 Logging

Untuk log line kecil, string cukup.

Untuk high-throughput structured logging, hindari membangun string besar sebelum tahu log level aktif. Prefer API logger yang menerima field structured.

### 19.4 Database

Database text field biasanya `string` atau nullable wrapper.

Raw binary field biasanya `[]byte`.

Boundary decision:

```text
VARCHAR/TEXT semantic -> string
BLOB/BYTEA/raw payload -> []byte
```

---

## 20. Mini Lab 1: Benchmark Concatenation vs Builder

Buat file:

```go
package textbench

import (
    "strconv"
    "strings"
    "testing"
)

var sink string

func BenchmarkConcatLoop(b *testing.B) {
    parts := make([]string, 1000)
    for i := range parts {
        parts[i] = strconv.Itoa(i)
    }

    b.ResetTimer()
    for range b.N {
        s := ""
        for _, p := range parts {
            s += p
        }
        sink = s
    }
}

func BenchmarkBuilderLoop(b *testing.B) {
    parts := make([]string, 1000)
    for i := range parts {
        parts[i] = strconv.Itoa(i)
    }

    b.ResetTimer()
    for range b.N {
        var sb strings.Builder
        for _, p := range parts {
            sb.WriteString(p)
        }
        sink = sb.String()
    }
}

func BenchmarkBuilderGrowLoop(b *testing.B) {
    parts := make([]string, 1000)
    total := 0
    for i := range parts {
        parts[i] = strconv.Itoa(i)
        total += len(parts[i])
    }

    b.ResetTimer()
    for range b.N {
        var sb strings.Builder
        sb.Grow(total)
        for _, p := range parts {
            sb.WriteString(p)
        }
        sink = sb.String()
    }
}
```

Run:

```bash
go test -bench=. -benchmem
```

Yang perlu diamati:

```text
- ns/op
- B/op
- allocs/op
- apakah Grow mengurangi allocation
- apakah concat loop memburuk drastis ketika jumlah part naik
```

---

## 21. Mini Lab 2: Ownership Bug dengan `[]byte`

```go
package main

import "fmt"

type Store struct {
    data []byte
}

func (s *Store) SetBad(b []byte) {
    s.data = b
}

func (s *Store) SetGood(b []byte) {
    s.data = append(s.data[:0], b...)
}

func main() {
    input := []byte("secret")

    var s Store
    s.SetBad(input)

    input[0] = 'X'

    fmt.Println(string(s.data)) // Xecret
}
```

Perbaiki dengan `SetGood`, lalu jelaskan:

```text
- siapa owner data?
- siapa boleh mutate?
- lifetime data sampai kapan?
```

---

## 22. Mini Lab 3: `Cut` vs `Split`

Tulis parser untuk header:

```text
Authorization: Bearer abc.def.ghi
```

Versi A pakai `Split`.
Versi B pakai `Cut`.

Checklist:

```text
- handling missing colon
- trimming whitespace
- handling empty value
- allocation difference
- readability intent
```

---

## 23. Production Checklist: Text Processing Review

Gunakan checklist ini saat review PR.

### 23.1 Correctness

```text
[ ] Apakah input text validasi encoding-nya jelas?
[ ] Apakah code membedakan byte length vs rune count?
[ ] Apakah case-insensitive comparison memakai EqualFold jika sesuai?
[ ] Apakah whitespace policy eksplisit?
[ ] Apakah normalization policy dibutuhkan?
[ ] Apakah `[]byte` yang disimpan sudah dicopy?
[ ] Apakah string kecil dari payload besar perlu Clone?
```

### 23.2 Performance

```text
[ ] Tidak ada `+=` string dalam loop besar.
[ ] Builder/Buffer/Grow digunakan jika membangun output besar.
[ ] Tidak ada `Split` besar kalau hanya butuh separator pertama.
[ ] Tidak ada conversion `string([]byte)` berulang di hot path.
[ ] Payload besar diproses streaming jika mungkin.
[ ] Benchmark memakai `-benchmem` untuk melihat allocation.
```

### 23.3 API Design

```text
[ ] Function menerima `string` untuk semantic text.
[ ] Function menerima `[]byte` untuk raw/binary/buffer data.
[ ] Function menerima `io.Reader` untuk data besar/streaming.
[ ] Function menerima `io.Writer` untuk output besar.
[ ] Ownership/lifetime `[]byte` terdokumentasi.
[ ] Unsafe zero-copy tidak dipakai tanpa bukti profile/benchmark.
```

### 23.4 Security

```text
[ ] Tidak ada canonicalization ambiguity untuk identifier/security-sensitive text.
[ ] Tidak ada confusable Unicode yang dibiarkan di permission/key jika domain tidak mengizinkan.
[ ] Tidak ada log injection lewat newline/control character.
[ ] Tidak ada unbounded ReadAll untuk input attacker-controlled.
[ ] Tidak ada string building O(n²) untuk input attacker-controlled.
```

---

## 24. Design Heuristics

### 24.1 Heuristic 1: `string` untuk Meaning, `[]byte` untuk Movement

```text
If the data means something stable, use string.
If the data is moving through I/O/parsing buffers, use []byte.
```

### 24.2 Heuristic 2: Copy at Lifetime Boundary

```text
If data outlives the input buffer, copy.
If data is only observed during call, view is acceptable.
```

### 24.3 Heuristic 3: Stream Before You Materialize

```text
For large payloads, prefer Reader/Writer before ReadAll/string/Split.
```

### 24.4 Heuristic 4: Builder for String, Buffer for I/O, Append for Control

```text
strings.Builder -> final string
bytes.Buffer    -> bytes + io.Reader/io.Writer behavior
[]byte append   -> low-level explicit buffer control
```

### 24.5 Heuristic 5: Unsafe Needs an Invariant Comment

```text
No invariant comment, no unsafe text conversion.
```

---

## 25. Common Interview/Design Questions

### 25.1 Why is `string(b)` usually a copy?

Because `string` is immutable while `[]byte` is mutable. If conversion shared mutable memory, mutating `b` could change `s`, breaking the string contract.

### 25.2 When should I use `strings.Builder`?

When building a final string incrementally, especially in a loop or when combining many parts.

### 25.3 When should I use `bytes.Buffer`?

When building byte output, mixing binary/text, or needing `io.Reader` / `io.Writer` behavior.

### 25.4 Is `[]byte` always faster than `string`?

No. `[]byte` avoids some conversions in raw I/O paths, but it introduces mutability, ownership complexity, and cannot be map key. For semantic text, `string` is usually the better data model.

### 25.5 Is unsafe zero-copy recommended?

No for ordinary application code. It is a specialized optimization for proven hot paths with strict lifetime and immutability invariants.

---

## 26. What Top-Level Engineers Notice

A strong Go engineer does not merely say:

```text
Use Builder because faster.
```

They ask:

```text
- What is the lifetime of this data?
- Is this text semantic or raw transport bytes?
- Is this input bounded?
- Are we retaining large backing memory accidentally?
- Is this function forcing materialization unnecessarily?
- Can this be streamed?
- Are we crossing ownership boundary without copy?
- Does this code preserve string immutability expectations?
- Is performance measured or guessed?
```

That is the level of reasoning expected in production code review.

---

## 27. References

Primary references:

```text
- Go Language Specification: string types, slice types, conversions, built-in functions
- Go 1.26 Release Notes
- Package strings documentation
- Package bytes documentation
- Package bufio documentation
- Package io documentation
- Package unsafe documentation
- Go Blog: Strings, bytes, runes and characters in Go
- Go Blog / release notes around unsafe.String, unsafe.Slice, unsafe.StringData, unsafe.SliceData
- Go Blog: Using go fix to modernize Go code, including string builder modernization discussion
```

---

## 28. Summary

Part ini membangun mental model berikut:

```text
string  = immutable semantic byte sequence, usually UTF-8 text
[]byte  = mutable raw/working byte buffer
strings = operations for string
bytes   = operations for []byte
Builder = efficient final string construction
Buffer  = byte buffer with I/O behavior
append  = explicit low-level buffer control
Reader  = streaming input boundary
Writer  = streaming output boundary
unsafe  = exceptional zero-copy tool, not default
```

Prinsip paling penting:

```text
Do not treat string and []byte as interchangeable syntax variants.
They encode different ownership, mutability, lifetime, and API contracts.
```

---

## 29. Status Seri

```text
Seri: learn-go-data-model
Part saat ini: 007 / 034
Status: belum selesai
Part berikutnya: learn-go-data-model-part-008.md — Array: Fixed-Size Value, Copy Semantics, Memory Layout
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-data-model-part-006.md">⬅️ Part 006 — Text Model I: `byte`, `rune`, `string`, UTF-8, dan Unicode Reality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-data-model-part-008.md">Part 008 — Array: Fixed-Size Value, Copy Semantics, Memory Layout ➡️</a>
</div>
