# Part 005 — Character I/O: Reader, Writer, Line Processing, Large Text File, dan Text Pipeline

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-005.md`  
> Status seri: **belum selesai** — ini adalah Part 005 dari rencana Part 000 sampai Part 030.

---

## 1. Tujuan Pembelajaran

Pada part sebelumnya kita sudah membahas binary I/O: primitive data, endianness, framing, dan format stabil. Sekarang kita masuk ke sisi lain yang sama pentingnya: **Character I/O**.

Tujuan part ini bukan hanya membuat kamu bisa membaca file text dengan `BufferedReader`, tetapi membangun mental model yang cukup kuat untuk menjawab pertanyaan seperti:

- kapan data harus diperlakukan sebagai **byte** dan kapan sebagai **character**;
- kenapa `Reader`/`Writer` tidak bisa menggantikan `InputStream`/`OutputStream` begitu saja;
- kenapa line processing sering terlihat sederhana tetapi penuh jebakan;
- kenapa `Files.lines(...)` bisa menyebabkan resource leak jika salah digunakan;
- bagaimana memproses file text besar tanpa `OutOfMemoryError`;
- bagaimana mendesain text pipeline yang restartable, observable, dan aman terhadap data rusak;
- kapan `Scanner`, `BufferedReader`, `Files.readString`, `Files.readAllLines`, atau streaming parser layak digunakan;
- bagaimana menangani newline, charset, malformed input, partial record, multiline record, dan output durability.

Setelah selesai, kamu harus bisa melihat file text bukan sebagai “sekumpulan baris”, tetapi sebagai **stream byte yang didecode menjadi karakter, lalu diinterpretasikan menjadi record sesuai grammar tertentu**.

---

## 2. Mental Model Utama

### 2.1 Text file bukan kumpulan `String`

Secara fisik, file di disk adalah **byte sequence**.

```text
file on disk
  ↓
bytes: 48 65 6C 6C 6F 0A ...
```

Ketika kita menyebut “file text”, maksud sebenarnya adalah:

```text
byte sequence + charset + text grammar/convention
```

Contoh:

```text
bytes:   E2 82 AC
charset: UTF-8
text:    €
```

Tetapi byte yang sama bisa menjadi arti berbeda jika charset berbeda. Karena itu, **Reader selalu berada setelah proses decoding byte menjadi character**.

```text
InputStream       = membaca byte
InputStreamReader = bridge byte → character menggunakan Charset
Reader            = membaca character
BufferedReader    = buffering character + line processing
```

Writer adalah arah sebaliknya:

```text
Writer             = menulis character
OutputStreamWriter = bridge character → byte menggunakan Charset
OutputStream       = menulis byte
```

### 2.2 `Reader`/`Writer` adalah abstraction untuk character, bukan file

`Reader` tidak berarti “file reader”. Ia bisa membaca karakter dari banyak sumber:

- file;
- memory string;
- network stream yang didecode;
- compressed stream yang sudah didecompress lalu didecode;
- HTTP body;
- pipe antar thread;
- custom source.

Begitu juga `Writer` dapat menulis karakter ke banyak sink:

- file;
- memory buffer;
- HTTP response;
- socket;
- compressed output;
- template engine;
- logging sink.

Artinya, desain yang baik sering menerima `Reader`/`Writer` sebagai dependency, bukan langsung `Path` atau `File`, bila logic-nya adalah logic text processing.

```java
public final class ConfigParser {
    public Config parse(Reader reader) throws IOException {
        // parse character stream, tidak peduli source-nya dari file, string, atau network
    }
}
```

### 2.3 Line adalah convention, bukan unit universal

Banyak developer memperlakukan line sebagai record. Itu sering benar untuk:

- log line;
- NDJSON;
- simple config;
- simple TSV;
- simple CSV tanpa quoted newline.

Tetapi line **bukan** selalu record:

- CSV boleh memiliki newline di dalam quoted field;
- JSON pretty-printed bisa span banyak line;
- stack trace Java terdiri dari banyak line untuk satu event;
- SQL dump statement bisa multiline;
- PEM certificate punya grammar multiline;
- XML/HTML tidak line-oriented secara semantic.

Jadi rule penting:

```text
Line-based processing hanya benar jika format datanya line-delimited secara eksplisit.
```

Kalau formatnya record-based tetapi record bisa multiline, maka memakai `readLine()` saja dapat merusak semantics.

---

## 3. Peta API Character I/O

### 3.1 Core hierarchy

```text
java.io.Reader
 ├─ BufferedReader
 ├─ InputStreamReader
 │   └─ FileReader
 ├─ StringReader
 ├─ CharArrayReader
 ├─ PipedReader
 └─ FilterReader

java.io.Writer
 ├─ BufferedWriter
 ├─ OutputStreamWriter
 │   └─ FileWriter
 ├─ StringWriter
 ├─ CharArrayWriter
 ├─ PipedWriter
 ├─ PrintWriter
 └─ FilterWriter
```

`Reader` adalah abstract class untuk membaca character stream. Method minimal yang harus diimplementasikan subclass adalah `read(char[], int, int)` dan `close()`. `Writer` adalah abstract class untuk menulis character stream; method minimal yang perlu diimplementasikan subclass adalah `write(char[], int, int)`, `flush()`, dan `close()`.

### 3.2 Bridge class: `InputStreamReader` dan `OutputStreamWriter`

Bridge class adalah boundary paling penting:

```text
InputStreamReader  = byte input  → character input
OutputStreamWriter = character output → byte output
```

Contoh benar:

```java
try (Reader reader = new InputStreamReader(
        new FileInputStream("data.txt"),
        StandardCharsets.UTF_8)) {
    // read characters
}
```

Contoh modern dengan NIO.2:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

`Files.newBufferedReader(Path)` membuka file untuk membaca text secara efisien dan menggunakan UTF-8 sebagai charset default pada Java modern; overload dengan `Charset` tetap direkomendasikan saat format eksternal harus eksplisit.

### 3.3 Convenience API

API praktis yang sering digunakan:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

```java
List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
```

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    lines.forEach(System.out::println);
}
```

Rule keputusan:

| API | Cocok untuk | Tidak cocok untuk |
|---|---|---|
| `Files.readString` | file kecil, config kecil, test fixture | file besar, unknown size |
| `Files.readAllLines` | file kecil/menengah yang memang perlu semua line di memory | log besar, CSV besar, stream ingestion |
| `Files.lines` | lazy line stream, pipeline sederhana | logic kompleks dengan checked exception, multiline record, lupa close |
| `BufferedReader.readLine` | kontrol eksplisit, file besar line-by-line | record bukan line-based |
| `Scanner` | input manusia, parsing sederhana | high-throughput parsing besar |
| custom parser over `Reader` | grammar non-trivial | one-off trivial task |

---

## 4. Perbedaan `InputStream`, `Reader`, dan Parser

Satu kesalahan desain yang sering terjadi: mencampur tiga layer ini.

```text
Layer 1 — Transport/storage bytes
  InputStream / OutputStream / Channel / Path

Layer 2 — Text decoding/encoding
  Reader / Writer / CharsetDecoder / CharsetEncoder

Layer 3 — Format parsing/generation
  CSV parser / JSON parser / log parser / config parser
```

Jangan membuat parser yang diam-diam membuka file dan memilih charset sendiri tanpa alasan kuat.

Kurang fleksibel:

```java
public Config parse(String fileName) throws IOException {
    try (BufferedReader reader = new BufferedReader(new FileReader(fileName))) {
        // charset default platform: berbahaya untuk data eksternal
    }
}
```

Lebih baik:

```java
public Config parse(Reader reader) throws IOException {
    // parsing logic murni terhadap character stream
}
```

Lalu boundary file-nya dibuat di luar:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    Config config = parser.parse(reader);
}
```

Manfaat desain ini:

- parser bisa dites dengan `StringReader`;
- charset diputuskan di boundary;
- source bisa diganti dari file ke network/HTTP tanpa ubah parser;
- ownership resource lebih jelas;
- logic parsing tidak tercampur dengan filesystem concern.

---

## 5. `BufferedReader` Deep Dive

### 5.1 Apa yang dilakukan `BufferedReader`

`BufferedReader` membaca text dari character-input stream dan melakukan buffering agar pembacaan character, array, dan line lebih efisien.

Tanpa buffering:

```text
read char → mungkin memicu read kecil ke underlying stream
read char → mungkin memicu read kecil lagi
read char → overhead tinggi
```

Dengan buffering:

```text
read chunk besar dari underlying reader ke char[] buffer
serve character/line dari memory buffer
read chunk berikutnya saat buffer habis
```

### 5.2 `readLine()` semantics

`BufferedReader.readLine()` membaca satu line text dan mengembalikan `String` tanpa line-termination character. Ia mengembalikan `null` jika sudah EOF.

Pola standar:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Hal penting:

```text
readLine() menghilangkan delimiter newline.
```

Jadi jika kamu membaca lalu menulis ulang, kamu harus memutuskan newline output secara eksplisit.

```java
try (BufferedReader reader = Files.newBufferedReader(input, StandardCharsets.UTF_8);
     BufferedWriter writer = Files.newBufferedWriter(output, StandardCharsets.UTF_8)) {

    String line;
    while ((line = reader.readLine()) != null) {
        writer.write(transform(line));
        writer.newLine();
    }
}
```

### 5.3 Empty line vs EOF

Penting membedakan:

```text
empty line = ""
EOF        = null
```

Bug umum:

```java
while (!(line = reader.readLine()).isEmpty()) { // BUG: NPE saat EOF, berhenti saat empty line
    process(line);
}
```

Benar:

```java
String line;
while ((line = reader.readLine()) != null) {
    if (line.isEmpty()) {
        // empty line adalah data valid, kecuali format menyatakan lain
    }
    process(line);
}
```

### 5.4 `ready()` bukan EOF check yang aman

Banyak developer mencoba:

```java
while (reader.ready()) {
    process(reader.readLine());
}
```

Ini salah secara mental model. `ready()` hanya memberi indikasi apakah stream siap dibaca tanpa blocking pada saat itu, bukan apakah stream belum EOF. Untuk file lokal mungkin terlihat bekerja pada beberapa kasus, tetapi ini bukan pola general yang benar.

Gunakan `readLine() != null`.

---

## 6. `BufferedWriter`, `PrintWriter`, dan Output Text

### 6.1 `BufferedWriter`

`BufferedWriter` melakukan buffering character sebelum diteruskan ke underlying writer.

Pola umum:

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE)) {

    writer.write("id,name,status");
    writer.newLine();
    writer.write("1,Alice,ACTIVE");
    writer.newLine();
}
```

`newLine()` menggunakan line separator platform. Untuk format eksternal yang harus konsisten lintas OS, sering lebih baik eksplisit:

```java
writer.write("\n"); // jika format menetapkan LF
```

Decision rule:

```text
Untuk file internal aplikasi: platform newline kadang acceptable.
Untuk protocol/file exchange lintas sistem: newline harus eksplisit sesuai spec.
```

### 6.2 `PrintWriter`

`PrintWriter` nyaman untuk formatting:

```java
try (PrintWriter out = new PrintWriter(
        Files.newBufferedWriter(path, StandardCharsets.UTF_8))) {
    out.printf("%d,%s%n", 1, "Alice");
}
```

Tetapi ada jebakan besar: banyak method `PrintWriter` tidak melempar `IOException` secara langsung. Error disimpan secara internal dan perlu dicek dengan `checkError()`.

Untuk output yang reliability-nya penting, prefer `BufferedWriter` atau API yang error handling-nya eksplisit.

Kurang cocok untuk durable file export penting:

```java
PrintWriter writer = new PrintWriter(...);
writer.println(data); // error bisa tidak terlihat langsung
```

Lebih defensif:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write(data);
    writer.newLine();
}
```

### 6.3 `flush()` vs `close()`

`flush()` mendorong data dari buffer Java ke underlying writer/stream. Tetapi itu belum tentu berarti data sudah durable di disk.

```text
writer.write(...)
  ↓
BufferedWriter buffer
  ↓ flush()
OutputStreamWriter encoder
  ↓
FileOutputStream / channel
  ↓
OS page cache
  ↓
physical storage later
```

Untuk file durability serius, kita akan bahas lebih lengkap di Part 014. Untuk sekarang, pegang invariant:

```text
close() memastikan writer di-flush dan resource ditutup.
flush() bukan fsync.
write() bukan persist.
```

---

## 7. `Scanner`: Nyaman, Tetapi Harus Tahu Batasnya

`Scanner` berguna untuk parsing input sederhana:

```java
try (Scanner scanner = new Scanner(path, StandardCharsets.UTF_8)) {
    while (scanner.hasNext()) {
        String token = scanner.next();
        process(token);
    }
}
```

Kelebihan:

- mudah untuk input CLI;
- bisa parsing token;
- mendukung delimiter;
- nyaman untuk demo dan tool kecil.

Kekurangan:

- lebih lambat dibanding parser manual sederhana untuk file besar;
- menggunakan regex delimiter;
- error model parsing bisa tersembunyi;
- kurang cocok untuk high-throughput ingestion;
- mudah mencampur `nextInt()`, `nextLine()`, dan menyebabkan bug newline.

Rule praktis:

```text
Scanner cocok untuk input manusia dan file kecil.
BufferedReader/custom parser lebih cocok untuk pipeline besar dan production ingestion.
```

---

## 8. `Files.lines(...)`: Lazy Stream yang Harus Ditutup

`Files.lines(path, charset)` mengembalikan `Stream<String>` yang membaca line secara lazy dari file. Ini berguna:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    long count = lines
            .filter(line -> !line.isBlank())
            .count();
}
```

Masalah umum:

```java
Stream<String> lines = Files.lines(path); // BUG: resource harus ditutup
return lines.filter(...);                // lifecycle kabur
```

Karena stream ini memegang resource file terbuka, gunakan `try-with-resources`.

### 8.1 Kapan `Files.lines` cocok

Cocok untuk:

- filtering sederhana;
- counting;
- mapping line sederhana;
- pipeline pendek;
- script/tool internal.

Kurang cocok untuk:

- parsing kompleks;
- multiline record;
- perlu error recovery per record;
- perlu checkpoint offset/line number detail;
- perlu checked exception di lambda;
- perlu explicit state machine parsing.

### 8.2 Jangan return lazy stream dari method tanpa ownership jelas

Buruk:

```java
public Stream<String> activeUsers(Path path) throws IOException {
    return Files.lines(path, StandardCharsets.UTF_8)
            .filter(line -> line.contains("ACTIVE"));
}
```

Caller harus tahu bahwa stream wajib ditutup. Ini contract yang mudah dilanggar.

Lebih baik gunakan callback/consumer:

```java
public void forEachActiveUser(Path path, Consumer<String> consumer) throws IOException {
    try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
        lines.filter(line -> line.contains("ACTIVE"))
             .forEach(consumer);
    }
}
```

Atau expose resource-owning abstraction dengan dokumentasi jelas.

---

## 9. Large Text File Processing

### 9.1 Anti-pattern: membaca semua isi file

Anti-pattern klasik:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Untuk file kecil, ini benar dan bersih. Untuk file besar atau unknown size, ini berbahaya.

Masalah:

- seluruh byte dibaca ke memory;
- seluruh text menjadi `String` besar;
- decoding membutuhkan memory tambahan;
- GC pressure meningkat;
- satu input buruk bisa menjatuhkan process;
- tidak ada backpressure.

Hal yang sama berlaku untuk:

```java
List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
```

### 9.2 Streaming line-by-line

Pola aman untuk file besar line-delimited:

```java
public long processLargeLineFile(Path path) throws IOException {
    long processed = 0;

    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        while ((line = reader.readLine()) != null) {
            processLine(line);
            processed++;
        }
    }

    return processed;
}
```

Memory usage kira-kira:

```text
O(max line length + buffer size + processing state)
```

Bukan:

```text
O(file size)
```

### 9.3 Masalah “one very long line”

Line-by-line processing tidak otomatis aman. Jika input memiliki satu line 5 GB tanpa newline, `readLine()` akan mencoba membangun `String` sangat besar.

Defensive parser harus punya batas:

```java
private static final int MAX_LINE_CHARS = 1_000_000;

static void validateLineLength(String line, long lineNumber) throws IOException {
    if (line.length() > MAX_LINE_CHARS) {
        throw new IOException("Line " + lineNumber + " exceeds max length: " + line.length());
    }
}
```

Tetapi validasi setelah `readLine()` masih terlambat untuk line ekstrem. Untuk threat model serius, perlu parser yang membaca chunk/char dan memutus jika record terlalu panjang sebelum seluruh line menjadi `String`.

Contoh bounded line reader sederhana:

```java
public static String readBoundedLine(Reader reader, int maxChars) throws IOException {
    StringBuilder sb = new StringBuilder(Math.min(maxChars, 1024));
    int ch;

    while ((ch = reader.read()) != -1) {
        if (ch == '\n') {
            break;
        }
        if (ch == '\r') {
            // Handle CRLF or CR. Untuk parser serius, state handling bisa dibuat lebih detail.
            reader.mark(1);
            int next = reader.read();
            if (next != '\n' && next != -1) {
                reader.reset();
            }
            break;
        }
        if (sb.length() >= maxChars) {
            throw new IOException("Line exceeds maximum character length: " + maxChars);
        }
        sb.append((char) ch);
    }

    if (ch == -1 && sb.isEmpty()) {
        return null;
    }

    return sb.toString();
}
```

Catatan: contoh ini membutuhkan `Reader` yang mendukung `mark/reset`, seperti `BufferedReader`. Untuk production, parser harus lebih teliti terhadap unicode, CRLF, dan buffering.

---

## 10. Line Number, Offset, dan Error Reporting

Untuk ingestion, error seperti ini buruk:

```text
Invalid record
```

Error yang bisa dioperasikan:

```text
Invalid record at line 84219: expected 5 columns but found 4
```

Contoh:

```java
public void importUsers(Path path) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        long lineNumber = 0;

        while ((line = reader.readLine()) != null) {
            lineNumber++;
            try {
                UserRecord record = parseUser(line);
                save(record);
            } catch (RuntimeException ex) {
                throw new IOException("Failed to parse line " + lineNumber + ": " + preview(line), ex);
            }
        }
    }
}
```

Untuk file besar, jangan log seluruh line jika bisa berisi PII atau sangat panjang.

```java
private static String preview(String line) {
    int max = 200;
    if (line == null) return "<null>";
    return line.length() <= max ? line : line.substring(0, max) + "...<truncated>";
}
```

### 10.1 Character offset vs byte offset

Line number cukup untuk banyak kasus, tetapi resume processing sering butuh byte offset.

Masalahnya:

```text
Reader bekerja di character level.
File resume biasanya bekerja di byte offset.
```

Dengan UTF-8, jumlah character tidak sama dengan jumlah byte.

Jika kamu perlu checkpoint/resume by byte offset, gunakan byte-level layer atau channel, lalu decoding harus dirancang hati-hati agar tidak mulai di tengah multibyte character.

Rule:

```text
Untuk observability manusia: line number cukup.
Untuk resume exact: pikirkan byte offset, frame boundary, atau record manifest.
```

---

## 11. Newline Semantics

Text file bisa memakai beberapa line terminator:

```text
LF   \n    Unix/Linux/macOS modern
CRLF \r\n  Windows/network protocols tertentu
CR   \r    legacy Mac/classic systems
```

`BufferedReader.readLine()` mengenali line terminator umum dan tidak mengembalikannya dalam hasil string.

Konsekuensi:

```text
Input newline style hilang saat memakai readLine().
```

Jika kamu perlu mempertahankan newline asli, jangan gunakan `readLine()` biasa; baca char/chunk dan simpan delimiter.

### 11.1 Output newline

`BufferedWriter.newLine()` memakai `System.lineSeparator()`.

Untuk file exchange, lebih baik mengikuti spec:

```java
private static final String CSV_NEWLINE = "\n";

writer.write(record);
writer.write(CSV_NEWLINE);
```

Decision matrix:

| Kasus | Newline strategy |
|---|---|
| Log internal Linux container | `\n` eksplisit biasanya cukup |
| File untuk Windows user | CRLF bisa dipertimbangkan |
| CSV untuk sistem eksternal | ikuti kontrak file |
| HTTP headers | CRLF sesuai protocol, jangan asal `newLine()` |
| Text report manusia | `System.lineSeparator()` acceptable |
| Round-trip editor/formatter | preserve original newline style |

---

## 12. Multiline Records

### 12.1 CSV quoted newline

CSV valid bisa seperti ini:

```csv
id,name,notes
1,Alice,"hello
world"
2,Bob,"single line"
```

Jika kamu memakai `readLine()` dan menganggap satu line = satu record, record Alice akan rusak.

Rule:

```text
Jika grammar format mengizinkan newline di dalam field, parser harus grammar-aware.
```

Untuk CSV production, jangan tulis parser sendiri kecuali kamu benar-benar mendefinisikan subset CSV yang sangat ketat.

### 12.2 Stack trace log

Log event bisa multiline:

```text
2026-06-16 10:00:00 ERROR Failed
java.lang.IllegalStateException: boom
    at app.Service.run(Service.java:42)
    at app.Main.main(Main.java:10)
```

Line-based ingestion akan menghitung ini sebagai beberapa event. Solusinya biasanya:

- define start-of-record pattern;
- continuation line masuk ke record sebelumnya;
- batasi max lines per event;
- batasi max chars per event;
- emit partial event jika EOF.

Contoh state machine sederhana:

```text
state = NO_RECORD
for each line:
  if line matches timestamp prefix:
    flush previous record if exists
    start new record
  else:
    append as continuation to current record
EOF:
  flush current record
```

### 12.3 JSON

Untuk JSON besar:

- JSON array besar sebaiknya diparse streaming dengan library JSON streaming;
- NDJSON cocok untuk line-by-line;
- pretty JSON tidak cocok untuk line-by-line.

```text
NDJSON:
{"id":1,"name":"Alice"}
{"id":2,"name":"Bob"}

Pretty JSON array:
[
  {
    "id": 1,
    "name": "Alice"
  }
]
```

---

## 13. Designing a Text Pipeline

Text pipeline production biasanya terdiri dari tahap berikut:

```text
Path/InputStream
  ↓
byte source validation
  ↓
charset decode
  ↓
character buffering
  ↓
record boundary detection
  ↓
record parsing
  ↓
schema validation
  ↓
business validation
  ↓
transformation
  ↓
sink/write/output
  ↓
checkpoint/audit/metrics
```

### 13.1 Jangan campur semua dalam satu loop

Buruk:

```java
while ((line = reader.readLine()) != null) {
    String[] cols = line.split(",");
    if (cols[2].equals("ACTIVE")) {
        database.save(new User(cols[0], cols[1]));
    }
}
```

Masalah:

- parsing CSV salah untuk quoted comma;
- error reporting buruk;
- validation bercampur dengan persistence;
- sulit dites;
- tidak ada metrics;
- tidak ada reject handling;
- tidak ada checkpoint;
- tidak ada contract untuk malformed input.

Lebih baik pisahkan:

```java
public final class UserImportPipeline {
    private final UserRecordParser parser;
    private final UserValidator validator;
    private final UserSink sink;

    public ImportResult run(Reader source) throws IOException {
        ImportStats stats = new ImportStats();

        try (BufferedReader reader = source instanceof BufferedReader br
                ? br
                : new BufferedReader(source)) {

            String line;
            long lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;
                stats.seen++;

                try {
                    UserRecord record = parser.parse(line, lineNumber);
                    validator.validate(record);
                    sink.write(record);
                    stats.accepted++;
                } catch (RejectRecordException ex) {
                    stats.rejected++;
                    handleReject(lineNumber, line, ex);
                }
            }
        }

        return stats.toResult();
    }
}
```

Tetapi hati-hati: method di atas menutup `source`. Itu berarti ownership source pindah ke pipeline. Contract ini harus jelas. Alternatifnya, caller yang menutup resource.

---

## 14. Ownership dan Lifecycle untuk Reader/Writer

Ini sering dianggap kecil tetapi sangat penting.

Ada dua style sah:

### Style A — Method menerima `Path`, method memiliki resource

```java
public ImportResult importFile(Path path) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        return importFrom(reader);
    }
}
```

Kelebihan:

- lifecycle jelas;
- method bertanggung jawab membuka dan menutup;
- cocok untuk use case file.

### Style B — Method menerima `Reader`, caller memiliki resource

```java
public ImportResult importFrom(Reader reader) throws IOException {
    BufferedReader br = reader instanceof BufferedReader existing
            ? existing
            : new BufferedReader(reader);

    String line;
    while ((line = br.readLine()) != null) {
        // process
    }
    return result;
}
```

Dalam style ini, sebaiknya method **tidak menutup** reader kecuali contract-nya eksplisit.

Kenapa?

Caller mungkin wrapping reader dari resource yang lifecycle-nya lebih luas.

Rule:

```text
Siapa yang membuka resource, biasanya dia yang menutup resource.
Jika callee mengambil ownership dan menutup, dokumentasikan jelas.
```

---

## 15. Character Encoding Error Handling

Part 001 sudah membahas charset. Di sini kita fokus impact-nya pada Reader.

`Files.newBufferedReader(path, UTF_8)` pada akhirnya memakai decoder. Jika byte input malformed, operasi baca bisa gagal dengan exception.

Untuk pipeline production, kamu harus memilih policy:

| Policy | Kapan cocok | Risiko |
|---|---|---|
| fail-fast | data kontrak ketat | satu byte rusak menghentikan file |
| replace | log/report manusia | corruption bisa tersembunyi |
| reject record | ingestion record-based | perlu boundary detection aman |
| quarantine file | regulated/external transfer | operational overhead |

Jika butuh kontrol eksplisit, gunakan `CharsetDecoder`:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);

try (Reader reader = new InputStreamReader(Files.newInputStream(path), decoder);
     BufferedReader br = new BufferedReader(reader)) {

    String line;
    while ((line = br.readLine()) != null) {
        process(line);
    }
}
```

Policy alternatif:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPLACE)
        .onUnmappableCharacter(CodingErrorAction.REPLACE)
        .replaceWith("�");
```

Tetapi hati-hati: replacement dapat membuat data tampak valid padahal sudah corrupt.

---

## 16. Character Output dan Encoding Error

Encoding juga bisa gagal saat character tidak bisa direpresentasikan dalam charset target.

Contoh: menulis character Unicode ke ISO-8859-1 atau US-ASCII.

```java
CharsetEncoder encoder = StandardCharsets.US_ASCII
        .newEncoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);

try (Writer writer = new OutputStreamWriter(Files.newOutputStream(path), encoder)) {
    writer.write("Hello €"); // € tidak representable di ASCII
}
```

Decision rule:

```text
Untuk output kontrak eksternal, encoding error harus eksplisit.
Untuk UI/report manusia, replacement mungkin acceptable jika disepakati.
```

---

## 17. String Splitting Trap dalam Text Processing

### 17.1 `String.split` memakai regex

```java
String[] cols = line.split("|"); // BUG: | adalah regex alternation
```

Benar:

```java
String[] cols = line.split("\\|");
```

Atau:

```java
String[] cols = line.split(Pattern.quote("|"));
```

### 17.2 Trailing empty fields hilang

```java
"a,b,".split(",")
```

Hasilnya sering mengejutkan karena trailing empty strings dibuang.

Gunakan limit negatif:

```java
String[] cols = line.split(",", -1);
```

### 17.3 CSV bukan split comma

```java
1,"Alice, A.",ACTIVE
```

`split(",")` akan rusak.

Rule:

```text
Delimiter sederhana boleh pakai split hanya jika format melarang escaping, quoting, dan delimiter di dalam field.
```

Untuk format exchange serius, gunakan parser yang sesuai grammar.

---

## 18. Output Generation: Jangan Hanya Concatenate String

Untuk file text kecil, concatenation mungkin cukup. Untuk output besar, gunakan writer bertahap.

Buruk untuk output besar:

```java
StringBuilder sb = new StringBuilder();
for (Record record : records) {
    sb.append(record.toLine()).append('\n');
}
Files.writeString(path, sb.toString(), StandardCharsets.UTF_8);
```

Lebih scalable:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    for (Record record : records) {
        writeRecord(writer, record);
        writer.write('\n');
    }
}
```

Untuk format seperti CSV, jangan hanya:

```java
writer.write(id + "," + name + "," + status);
```

Karena `name` bisa mengandung comma, quote, atau newline.

Gunakan escaping:

```java
static void writeCsvField(Writer writer, String value) throws IOException {
    if (value == null) {
        return;
    }

    boolean mustQuote = value.indexOf(',') >= 0
            || value.indexOf('"') >= 0
            || value.indexOf('\n') >= 0
            || value.indexOf('\r') >= 0;

    if (!mustQuote) {
        writer.write(value);
        return;
    }

    writer.write('"');
    for (int i = 0; i < value.length(); i++) {
        char c = value.charAt(i);
        if (c == '"') {
            writer.write("\"\"");
        } else {
            writer.write(c);
        }
    }
    writer.write('"');
}
```

Ini hanya contoh subset CSV; untuk compliance penuh, gunakan library CSV matang.

---

## 19. Text Transformation Pipeline

Contoh transformasi file besar:

```text
input.csv
  ↓ read line
parse record
  ↓ validate
transform
  ↓ write output.csv
write reject.csv
write stats.json
```

Implementasi sederhana:

```java
public final class TextTransformJob {
    public TransformResult run(Path input, Path output, Path reject) throws IOException {
        TransformStats stats = new TransformStats();

        try (BufferedReader reader = Files.newBufferedReader(input, StandardCharsets.UTF_8);
             BufferedWriter out = Files.newBufferedWriter(output, StandardCharsets.UTF_8);
             BufferedWriter rejected = Files.newBufferedWriter(reject, StandardCharsets.UTF_8)) {

            String line;
            long lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;
                stats.seen++;

                try {
                    String transformed = transform(line);
                    out.write(transformed);
                    out.write('\n');
                    stats.accepted++;
                } catch (Exception ex) {
                    rejected.write(lineNumber + "\t" + sanitizeForReject(line));
                    rejected.write('\n');
                    stats.rejected++;
                }
            }
        }

        return stats.toResult();
    }
}
```

Production improvements:

- output temp file + atomic move;
- checksum output;
- reject reason code;
- metrics per N records;
- bounded reject size;
- PII masking;
- checkpoint;
- job id/correlation id;
- input manifest;
- validation schema version.

---

## 20. Durability dan Atomicity untuk Text Output

Menulis output langsung ke final path berisiko:

```java
try (BufferedWriter writer = Files.newBufferedWriter(finalPath, UTF_8)) {
    // process lama
    // crash di tengah: finalPath berisi file setengah jadi
}
```

Lebih aman:

```text
write to temp file in same directory
flush/close
optionally fsync
atomic move temp → final
```

Contoh sederhana:

```java
public static void writeTextAtomically(Path target, List<String> lines) throws IOException {
    Path dir = target.toAbsolutePath().getParent();
    Path temp = Files.createTempFile(dir, target.getFileName().toString(), ".tmp");

    boolean success = false;
    try {
        try (BufferedWriter writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            for (String line : lines) {
                writer.write(line);
                writer.write('\n');
            }
        }

        Files.move(
                temp,
                target,
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING);

        success = true;
    } finally {
        if (!success) {
            Files.deleteIfExists(temp);
        }
    }
}
```

Untuk durability ekstra, perlu `FileChannel.force(...)` dan fsync directory. Ini akan dibahas lebih dalam di Part 014.

---

## 21. Exception Handling Strategy

### 21.1 Jangan swallow `IOException`

Buruk:

```java
try {
    writeReport(path);
} catch (IOException e) {
    log.warn("Failed");
}
```

Masalah:

- caller mengira sukses;
- output mungkin partial;
- retry/reconciliation tidak jalan;
- audit salah.

Lebih baik:

```java
try {
    writeReport(path);
} catch (IOException e) {
    throw new ReportGenerationException("Failed to write report to " + path, e);
}
```

### 21.2 Bedakan parse reject dan I/O failure

Tidak semua error sama.

```text
Malformed record       → data issue, bisa reject record
Disk full              → infrastructure issue, job harus gagal
Permission denied      → deployment/config issue
Charset malformed      → file-level data contract issue
Network read timeout   → transient/transport issue
```

Dalam pipeline:

```java
try {
    Record record = parser.parse(line);
    sink.write(record);
} catch (InvalidRecordException ex) {
    reject(lineNumber, line, ex); // continue jika policy allow
} catch (IOException ex) {
    throw ex; // jangan continue seolah aman
}
```

---

## 22. Testing Character I/O

### 22.1 Test parser dengan `StringReader`

```java
@Test
void parsesSimpleConfig() throws Exception {
    String input = "host=localhost\nport=8080\n";

    Config config = parser.parse(new StringReader(input));

    assertEquals("localhost", config.host());
    assertEquals(8080, config.port());
}
```

### 22.2 Test writer dengan `StringWriter`

```java
@Test
void writesRecord() throws Exception {
    StringWriter out = new StringWriter();

    writer.write(out, new User("1", "Alice"));

    assertEquals("1,Alice\n", out.toString());
}
```

### 22.3 Test file behavior dengan temp directory

```java
@TempDir
Path tempDir;

@Test
void importsFile() throws Exception {
    Path input = tempDir.resolve("users.txt");
    Files.writeString(input, "1,Alice\n2,Bob\n", StandardCharsets.UTF_8);

    ImportResult result = importer.importFile(input);

    assertEquals(2, result.accepted());
}
```

### 22.4 Edge cases yang wajib dites

- empty file;
- file tanpa newline terakhir;
- empty line;
- whitespace-only line;
- very long line;
- invalid charset byte;
- BOM;
- CRLF vs LF;
- trailing delimiter;
- quoted delimiter;
- multiline record;
- duplicate record;
- partial output failure;
- permission failure;
- disk full simulation jika memungkinkan;
- PII masking di reject/log.

---

## 23. Performance Notes

### 23.1 `BufferedReader` biasanya cukup cepat untuk text line processing

Banyak pipeline text bottleneck-nya bukan pembacaan file, melainkan:

- parsing;
- regex;
- allocation;
- database write;
- network call;
- validation;
- logging berlebihan;
- synchronization;
- downstream backpressure.

Jangan langsung menyimpulkan perlu NIO manual sebelum profiling.

### 23.2 Regex bisa mahal

```java
line.split(",")
```

memakai regex. Untuk jutaan line, ini bisa menjadi biaya signifikan.

Alternatif:

- parser manual;
- precompiled `Pattern`;
- library parser optimized;
- scanning char by char;
- avoid creating banyak substring jika tidak perlu.

### 23.3 Logging per line bisa membunuh throughput

Buruk:

```java
log.info("Processing line {}", lineNumber);
```

Untuk jutaan record, gunakan periodic metrics:

```java
if (lineNumber % 100_000 == 0) {
    log.info("Processed {} lines", lineNumber);
}
```

### 23.4 Parallelism tidak selalu membantu

File text line processing sering punya satu source sequential. Parallelism dapat membantu jika:

- parsing/processing CPU-heavy;
- record independent;
- ordering tidak penting atau bisa direkonstruksi;
- downstream mampu menerima parallel write;
- split boundary aman.

Tetapi parallelism bisa memperburuk:

- memory usage;
- ordering;
- error handling;
- database contention;
- backpressure;
- observability.

---

## 24. Security Notes

### 24.1 Treat external text as untrusted

Text file dari luar dapat menyerang aplikasi melalui:

- extremely long line;
- huge file;
- invalid charset;
- malicious formula injection di CSV;
- log injection;
- path traversal di field;
- SQL-like payload;
- control characters;
- Unicode confusables;
- hidden BOM;
- decompression bomb sebelum text layer.

### 24.2 CSV formula injection

Jika output CSV dibuka di spreadsheet, value seperti ini berbahaya:

```text
=HYPERLINK("http://evil", "click")
+cmd|'/C calc'!A0
@SUM(1+1)
```

Defensive strategy tergantung policy:

- prefix apostrophe untuk field berbahaya;
- reject field;
- escape sesuai target;
- jangan anggap CSV hanya data pasif.

### 24.3 Log injection

Jika input user ditulis ke log/text output tanpa sanitasi:

```text
normal user
2026-06-16 ERROR fake admin login failed
```

Input newline bisa membuat log palsu. Untuk audit/security log, sanitize control characters.

```java
static String sanitizeOneLine(String value) {
    return value
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\t", "\\t");
}
```

---

## 25. Production Patterns

### 25.1 Strict file contract

Setiap text file exchange sebaiknya punya kontrak:

```yaml
format: NDJSON
charset: UTF-8
newline: LF
max_file_size_bytes: 1073741824
max_record_size_chars: 1000000
header: false
compression: gzip
checksum: SHA-256
schema_version: 3
null_policy: absent field
timestamp_format: ISO-8601 UTC
error_policy: reject record up to 1000, then fail file
```

Tanpa kontrak seperti ini, ingestion menjadi kumpulan asumsi.

### 25.2 Reject file pattern

Untuk ingestion massal:

```text
input file
  ↓
accepted records → database/output
rejected records → reject file + reason
summary          → manifest/result
```

Reject record minimal berisi:

```text
line_number
reason_code
safe_preview
correlation_id/job_id
```

Jangan selalu tulis full raw record jika mengandung PII.

### 25.3 Manifest pattern

Output transfer yang matang sering punya manifest:

```json
{
  "fileName": "users-2026-06-16.ndjson",
  "charset": "UTF-8",
  "newline": "LF",
  "recordCount": 1200341,
  "sha256": "...",
  "createdAt": "2026-06-16T10:15:30Z",
  "schemaVersion": 3
}
```

Manifest membantu:

- verification;
- reconciliation;
- audit;
- retry/resume;
- support investigation.

### 25.4 Stable output format

Jangan membuat output berdasarkan `toString()` domain object.

Buruk:

```java
writer.write(user.toString());
```

Lebih baik:

```java
writer.write(user.id());
writer.write(',');
writeCsvField(writer, user.name());
writer.write(',');
writer.write(user.status().name());
writer.write('\n');
```

`toString()` untuk debugging, bukan kontrak data eksternal.

---

## 26. Decision Matrix

### 26.1 Membaca text

| Kebutuhan | Pilihan utama | Alasan |
|---|---|---|
| File kecil jadi string | `Files.readString` | simple |
| File kecil jadi list line | `Files.readAllLines` | simple |
| File besar line-delimited | `BufferedReader.readLine` | kontrol lifecycle dan error |
| Pipeline functional sederhana | `Files.lines` + try-with-resources | lazy dan ringkas |
| Grammar kompleks | streaming parser khusus/library | line bukan record |
| Input CLI | `Console`/`Scanner`/`BufferedReader` | tergantung interaksi |
| Need byte offset resume | byte stream/channel + decoder design | Reader tidak expose byte offset |

### 26.2 Menulis text

| Kebutuhan | Pilihan utama | Alasan |
|---|---|---|
| File kecil string | `Files.writeString` | simple |
| Output besar sequential | `BufferedWriter` | memory bounded |
| Formatting manusia | `PrintWriter`/`Formatter` | nyaman |
| Reliability penting | `BufferedWriter` + explicit error handling | IOException terlihat |
| Atomic publish | temp file + atomic move | hindari partial final file |
| Stable exchange format | explicit writer/generator | jangan pakai `toString()` |

---

## 27. Anti-Pattern Checklist

Hindari:

- memakai `FileReader`/`FileWriter` tanpa sadar charset default;
- memakai `readAllLines` untuk file besar;
- return `Files.lines(...)` tanpa contract close jelas;
- menganggap satu line pasti satu record;
- memakai `split(",")` untuk CSV umum;
- mengabaikan empty line vs EOF;
- memakai `ready()` sebagai loop condition;
- menulis output final langsung tanpa temp untuk job penting;
- memakai `PrintWriter` untuk output critical tanpa `checkError()`;
- log full record yang mungkin PII;
- tidak membatasi line length/record size;
- tidak menentukan newline untuk file exchange;
- mencampur parse, validation, persistence, dan reporting dalam satu loop besar;
- menganggap `flush()` sama dengan durable write;
- swallowing `IOException`;
- menggunakan `toString()` sebagai format data eksternal.

---

## 28. Practical Mini Case Study: Import File User Line-Based

### 28.1 Contract

```text
Format: pipe-delimited
Charset: UTF-8
Newline: LF or CRLF accepted
Columns: id|email|status
Rules:
  - id required
  - email required
  - status in ACTIVE,INACTIVE
  - delimiter inside field not supported
  - max line length 10_000 chars
Error policy:
  - reject invalid record
  - fail on I/O error
```

### 28.2 Implementation

```java
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class UserImportJob {
    private static final int MAX_LINE_LENGTH = 10_000;

    public ImportSummary run(Path input, Path rejectFile) throws IOException {
        long seen = 0;
        long accepted = 0;
        long rejected = 0;

        try (BufferedReader reader = Files.newBufferedReader(input, StandardCharsets.UTF_8);
             BufferedWriter rejectWriter = Files.newBufferedWriter(rejectFile, StandardCharsets.UTF_8)) {

            String line;
            while ((line = reader.readLine()) != null) {
                seen++;

                try {
                    if (line.length() > MAX_LINE_LENGTH) {
                        throw new InvalidRecordException("LINE_TOO_LONG");
                    }

                    UserRecord record = parse(line);
                    validate(record);
                    persist(record);
                    accepted++;
                } catch (InvalidRecordException ex) {
                    rejected++;
                    rejectWriter.write(seen + "\t" + ex.getMessage() + "\t" + safePreview(line));
                    rejectWriter.write('\n');
                }
            }
        }

        return new ImportSummary(seen, accepted, rejected);
    }

    private static UserRecord parse(String line) {
        String[] parts = line.split("\\|", -1);
        if (parts.length != 3) {
            throw new InvalidRecordException("INVALID_COLUMN_COUNT");
        }
        return new UserRecord(parts[0], parts[1], parts[2]);
    }

    private static void validate(UserRecord record) {
        if (record.id().isBlank()) {
            throw new InvalidRecordException("ID_REQUIRED");
        }
        if (record.email().isBlank()) {
            throw new InvalidRecordException("EMAIL_REQUIRED");
        }
        if (!record.status().equals("ACTIVE") && !record.status().equals("INACTIVE")) {
            throw new InvalidRecordException("INVALID_STATUS");
        }
    }

    private static void persist(UserRecord record) {
        // Persist to DB or downstream sink.
        // Di production, sink harus punya error semantics jelas.
    }

    private static String safePreview(String line) {
        String sanitized = line
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("\t", "\\t");
        int max = 200;
        return sanitized.length() <= max ? sanitized : sanitized.substring(0, max) + "...";
    }

    public record UserRecord(String id, String email, String status) {}
    public record ImportSummary(long seen, long accepted, long rejected) {}

    public static final class InvalidRecordException extends RuntimeException {
        public InvalidRecordException(String message) {
            super(message);
        }
    }
}
```

### 28.3 Apa yang sudah benar

- charset eksplisit;
- membaca line-by-line;
- empty field dipertahankan dengan `split(..., -1)`;
- reject record tidak menghentikan seluruh file;
- I/O error tetap membuat job gagal;
- reject output disanitasi;
- line length dibatasi setelah read;
- summary tersedia.

### 28.4 Apa yang belum cukup untuk regulated production

- line length extreme masih bisa OOM sebelum validasi;
- tidak ada atomic output untuk reject file;
- tidak ada checksum;
- tidak ada manifest;
- tidak ada checkpoint/resume;
- tidak ada metrics periodic;
- tidak ada schema version;
- tidak ada PII masking advanced;
- tidak ada transactional boundary dengan DB;
- tidak ada idempotency.

Itu akan ditutup di part reliability dan production pattern berikutnya.

---

## 29. Latihan

### Latihan 1 — Reader/Writer boundary

Buat parser config yang menerima `Reader`, bukan `Path`.

Requirement:

- format `key=value`;
- ignore blank line;
- ignore line yang dimulai `#`;
- reject duplicate key;
- error harus menyebut line number;
- test menggunakan `StringReader`.

### Latihan 2 — Safe line processor

Buat utility:

```java
void processLines(Path path, Charset charset, LineHandler handler)
```

Requirement:

- explicit charset;
- line number;
- max line length;
- periodic progress setiap 100_000 line;
- `IOException` tidak boleh ditelan;
- handler exception harus dibungkus dengan line number.

### Latihan 3 — Atomic text writer

Buat method:

```java
void writeReportAtomically(Path target, Consumer<Writer> writerLogic)
```

Requirement:

- tulis ke temp file di directory yang sama;
- close writer sebelum move;
- atomic move jika didukung;
- cleanup temp saat gagal;
- jangan meninggalkan final file partial.

### Latihan 4 — CSV danger

Berikan input:

```csv
1,"Alice, A.",ACTIVE
2,"Bob
B.",INACTIVE
3,"He said ""hello""",ACTIVE
```

Jelaskan kenapa `readLine()` + `split(",")` gagal, lalu desain pendekatan parser yang benar.

---

## 30. Ringkasan

Character I/O adalah layer untuk membaca dan menulis **character stream**, bukan byte stream. Karena semua text berasal dari byte, boundary decoding/encoding harus eksplisit dan sadar charset.

Hal paling penting dari part ini:

- file text secara fisik tetap byte sequence;
- `Reader`/`Writer` bekerja di character layer;
- `InputStreamReader` dan `OutputStreamWriter` adalah bridge byte-character;
- charset harus menjadi bagian dari kontrak data;
- `BufferedReader.readLine()` cocok hanya jika format memang line-oriented;
- line bukan selalu record;
- `Files.lines` lazy dan wajib ditutup;
- `readAllLines`/`readString` hanya aman untuk file kecil atau bounded;
- output text perlu memikirkan newline, escaping, flush, close, dan atomic publish;
- error parsing berbeda dari error I/O;
- production ingestion perlu contract, reject policy, metrics, checkpoint, dan manifest;
- jangan menggunakan `toString()` sebagai format eksternal;
- jangan menganggap flush sama dengan durable write.

Mental model final:

```text
bytes from source
  ↓ decode with explicit charset
characters
  ↓ buffer/read
lines or character chunks
  ↓ record boundary detection
records
  ↓ parse + validate
business objects
  ↓ transform
characters
  ↓ encode with explicit charset
bytes to sink
```

Jika kamu menguasai boundary ini, kamu bisa mendesain text pipeline yang tidak hanya “berjalan di happy path”, tetapi juga kuat terhadap data besar, data rusak, encoding mismatch, output partial, dan kebutuhan audit production.

---

## 31. Referensi Resmi

- Oracle Java SE 25 API — `java.io.Reader`: abstract class untuk membaca character streams; subclass minimal mengimplementasikan `read(char[], int, int)` dan `close()`.
- Oracle Java SE 25 API — `java.io.Writer`: abstract class untuk menulis character streams; subclass minimal mengimplementasikan `write(char[], int, int)`, `flush()`, dan `close()`.
- Oracle Java SE 25 API — `java.io.BufferedReader`: membaca text dari character-input stream dengan buffering agar pembacaan character, array, dan line lebih efisien.
- Oracle Java SE 25 API — `java.nio.file.Files`: menyediakan `newBufferedReader`, `newBufferedWriter`, `readString`, `readAllLines`, dan `lines` untuk operasi text file modern.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-nio-networking-data-transfer-part-004.md">⬅️ Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-io-nio-networking-data-transfer-part-006.md">Part 006 — Console I/O: `System.in/out/err`, `Console`, Password Input, dan CLI Interaction ➡️</a>
</div>
