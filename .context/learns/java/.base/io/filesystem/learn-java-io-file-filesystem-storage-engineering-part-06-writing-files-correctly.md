# learn-java-io-file-filesystem-storage-engineering — Part 06
# Writing Files Correctly: Replace, Append, Flush, Durability

> Target Java: 8 sampai 25  
> Fokus: `Files.write`, `Files.writeString`, `newBufferedWriter`, `newOutputStream`, `StandardOpenOption`, append, replace, flush, close, durability, crash consistency, dan production-grade write workflow.  
> Posisi dalam seri: setelah memahami path, existence/type/identity, creation semantics, open options, dan reading file, bagian ini masuk ke sisi yang lebih berbahaya: **menulis data ke filesystem tanpa merusak data, tanpa menciptakan race condition, dan tanpa salah paham tentang “write success”.**

---

## 0. Ringkasan Besar

Menulis file terlihat sederhana:

```java
Files.writeString(path, "hello");
```

Tetapi di production, operasi tulis file bisa gagal atau salah secara halus karena banyak boundary tersembunyi:

```text
Java object
  -> Writer / OutputStream / Channel
  -> JVM buffer
  -> native syscall
  -> OS page cache
  -> filesystem journal / metadata layer
  -> block device cache
  -> storage controller
  -> disk / SSD / network storage
```

Ketika method Java selesai tanpa exception, artinya **operasi yang diminta ke layer di bawahnya dianggap berhasil menurut kontrak API tersebut**. Itu tidak selalu berarti:

- data sudah aman jika mesin crash,
- data sudah terlihat konsisten oleh pembaca lain,
- file lama tidak sempat hilang,
- update multi-file atomic,
- append antar writer selalu urut secara semantik aplikasi,
- metadata sudah durable,
- data sudah benar secara encoding,
- file tidak sedang dimodifikasi proses lain.

Mental model utama bagian ini:

```text
Writing file is not one operation.
Writing file is a workflow.

Workflow itu minimal terdiri dari:
1. choose target path
2. choose open options
3. encode content, jika text
4. write bytes
5. flush user/JVM buffer
6. optionally force OS buffer to storage
7. close handle
8. optionally publish atomically
9. optionally verify/read-back/hash
10. handle partial failure and recovery
```

Bagian ini belum membahas atomic replace pattern secara penuh. Itu akan menjadi **Part 07**. Namun bagian ini membangun fondasi agar Part 07 masuk akal.

---

## 1. Kenapa Writing File Lebih Sulit daripada Reading File?

Reading file biasanya memiliki karakteristik:

```text
input sudah ada
reader tidak selalu mengubah state filesystem
kegagalan sering berupa "tidak bisa baca"
```

Writing file mengubah state:

```text
file bisa dibuat
file bisa ditimpa
file bisa dipotong jadi 0 byte
file bisa bertambah
metadata bisa berubah
permission bisa berubah
mtime berubah
storage bisa penuh
file lama bisa hilang
pembaca lain bisa melihat intermediate state
```

Dalam sistem production, write file sering dipakai untuk:

- export report,
- generate invoice,
- write configuration,
- cache artifact,
- create checkpoint,
- persist offset,
- write manifest,
- store uploaded file,
- produce file untuk downstream batch,
- generate archive,
- write audit/log local,
- handoff antar service/process.

Setiap use case punya correctness requirement berbeda.

Contoh:

```text
Use case: write temporary debug dump
Requirement: best effort cukup

Use case: write payment settlement file
Requirement: tidak boleh partial, harus audit-able, harus recoverable

Use case: write local cache
Requirement: boleh corrupt asal bisa rebuild

Use case: write config file
Requirement: reader tidak boleh melihat half-written config

Use case: append audit line
Requirement: line tidak boleh interleave/corrupt, urutan penting
```

Jadi pertanyaan top 1% engineer bukan hanya:

```text
Bagaimana cara menulis file?
```

Tetapi:

```text
Correctness apa yang diminta oleh write workflow ini?
Apa konsekuensi jika crash terjadi di tengah?
Apa yang dilihat reader concurrent?
Apa yang terjadi jika disk full?
Apakah replace harus atomic?
Apakah append harus ordered?
Apakah data harus durable sebelum response sukses?
Apakah metadata juga harus durable?
Apakah path berasal dari user input?
Apakah target filesystem local, network, container volume, atau object-store-like provider?
```

---

## 2. API Surface untuk Writing File di Java

Di Java modern, file writing berada di beberapa level abstraksi.

### 2.1 Convenience API

Untuk file kecil dan operasi sederhana:

```java
Files.write(path, bytes);
Files.write(path, lines, charset);
Files.writeString(path, content);      // Java 11+
Files.writeString(path, content, charset); // Java 11+
```

Karakteristik:

- simple,
- mudah dibaca,
- cocok untuk small content,
- biasanya membuka file, menulis, lalu menutup,
- tidak cocok untuk streaming besar,
- tidak cocok jika butuh kontrol flush/force detail,
- tidak cukup untuk atomic replace production-grade.

### 2.2 Writer API untuk text

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write("hello");
    writer.newLine();
}
```

Cocok untuk:

- text file,
- line-oriented output,
- writing incremental,
- explicit charset,
- memory efficient dibanding build satu string besar.

### 2.3 OutputStream API untuk byte

```java
try (OutputStream out = Files.newOutputStream(path)) {
    out.write(bytes);
}
```

Cocok untuk:

- binary file,
- stream dari network/input lain,
- compress/encrypt pipeline,
- image/pdf/archive/payload.

Biasanya dibungkus:

```java
try (OutputStream out = new BufferedOutputStream(Files.newOutputStream(path))) {
    // write chunks
}
```

### 2.4 Channel API untuk kontrol lebih rendah

```java
try (FileChannel channel = FileChannel.open(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING)) {
    channel.write(buffer);
    channel.force(true);
}
```

Cocok untuk:

- explicit durability via `force`,
- random access,
- positional write,
- truncation,
- transfer operation,
- structured binary file,
- append/log design,
- lock integration.

### 2.5 SeekableByteChannel

```java
try (SeekableByteChannel ch = Files.newByteChannel(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {
    ch.write(buffer);
}
```

Ini abstraction yang lebih general daripada `FileChannel`, karena provider non-default bisa mengembalikan implementasi lain.

---

## 3. Default Behavior yang Sering Dilupakan

### 3.1 `Files.write(path, bytes)`

Secara konseptual, jika options tidak diberikan, method convenience write biasanya bekerja seperti:

```text
CREATE + TRUNCATE_EXISTING + WRITE
```

Artinya:

- jika file belum ada: dibuat,
- jika file sudah ada: isinya dipotong menjadi 0 lalu ditulis ulang,
- jika write gagal setelah truncate: file lama bisa hilang atau menjadi partial.

Ini salah satu jebakan paling penting.

Kode ini tampak aman:

```java
Files.writeString(configPath, newConfigJson);
```

Tetapi untuk config production, ini berbahaya karena reader lain bisa melihat:

- file kosong,
- file setengah tertulis,
- file corrupt jika crash,
- file baru dengan content invalid.

Correct pattern untuk config file biasanya bukan direct overwrite, tetapi:

```text
write temp file -> validate -> force -> atomic move over target
```

Itu dibahas penuh di Part 07.

### 3.2 `newBufferedWriter(path)`

Tanpa options eksplisit, `Files.newBufferedWriter(path, ...)` juga membuka/membuat file untuk write dengan behavior default: create jika belum ada, truncate jika sudah ada.

Contoh:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write("new content");
}
```

Ini bukan append. Ini replace-by-truncate.

Jika ingin append:

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND)) {
    writer.write("line");
    writer.newLine();
}
```

### 3.3 `newOutputStream(path)`

Tanpa options, output stream untuk path juga secara umum create/truncate/write.

Maka biasakan membaca open options seperti kontrak state transition:

```text
Before open:
  file may exist / may not exist

Open options decide:
  create?
  fail if exists?
  truncate?
  append?
  write at current position?
  sync every update?
```

---

## 4. Replace, Append, dan Update: Tiga Intent yang Berbeda

Banyak bug file terjadi karena developer menulis kode dengan API yang sama untuk intent yang berbeda.

### 4.1 Replace

Intent:

```text
Setelah operasi selesai, file target harus berisi versi baru.
```

Pertanyaan correctness:

- Bolehkah file lama hilang jika proses crash?
- Bolehkah reader melihat versi setengah jadi?
- Apakah replace harus atomic?
- Apakah metadata lama harus dipertahankan?
- Apakah permission/owner harus sama?
- Apakah replace harus hanya jika file belum berubah?

Direct replace:

```java
Files.writeString(path, content, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Cocok untuk:

- disposable file,
- test output,
- generated file yang bisa dibuat ulang,
- file yang tidak dibaca concurrent,
- kasus di mana partial state acceptable.

Tidak cocok untuk:

- config,
- checkpoint penting,
- manifest,
- handoff file,
- audit/financial output,
- file yang dibaca process lain.

### 4.2 Append

Intent:

```text
Tambahkan data ke akhir file tanpa menghapus data lama.
```

Kode:

```java
Files.writeString(path, "event\n", StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND);
```

Pertanyaan correctness:

- Apakah setiap record harus utuh?
- Apakah beberapa writer bisa append bersamaan?
- Apakah urutan append penting?
- Apakah newline/record delimiter robust?
- Apakah partial final record bisa dideteksi saat recovery?
- Apakah flush setiap record perlu?
- Apakah force setiap record perlu?

Append sering terlihat seperti solusi log sederhana, tetapi multi-writer append bisa rumit. Java `APPEND` mengatur posisi write ke end-of-file, tetapi atomicity detailnya bergantung filesystem/provider dan ukuran write. Jangan membangun audit-critical multi-process log hanya dengan asumsi “append pasti atomic untuk semua keadaan”.

### 4.3 In-place update

Intent:

```text
Ubah sebagian isi file pada offset tertentu.
```

Biasanya memakai `FileChannel` atau `SeekableByteChannel`.

Contoh konseptual:

```java
try (FileChannel ch = FileChannel.open(path,
        StandardOpenOption.WRITE)) {
    ch.position(128);
    ch.write(ByteBuffer.wrap(new byte[] {1, 2, 3, 4}));
}
```

Pertanyaan correctness:

- Apakah update bisa torn jika crash?
- Apakah checksum diperbarui?
- Apakah reader bisa melihat campuran record lama/baru?
- Apakah perlu lock?
- Apakah perlu journal/WAL?

In-place update adalah yang paling berbahaya untuk data penting. Banyak storage engine menghindarinya atau melindunginya dengan WAL/checksum/page format.

---

## 5. Charset dan Text Writing

Text bukan byte. Text harus di-encode menjadi byte.

```text
String / char sequence
  -> CharsetEncoder
  -> bytes
  -> file
```

### 5.1 Selalu eksplisitkan charset

Lebih baik:

```java
Files.writeString(path, content, StandardCharsets.UTF_8);
```

atau Java 8:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write(content);
}
```

Daripada bergantung pada default platform charset, terutama jika file akan dibaca oleh service lain, container lain, OS lain, atau downstream batch.

### 5.2 Java 8 vs Java 11+

Java 11 menambahkan `Files.writeString` dan `Files.readString`.

Java 8 compatible style:

```java
Files.write(path, content.getBytes(StandardCharsets.UTF_8));
```

atau:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write(content);
}
```

Java 11+ style:

```java
Files.writeString(path, content, StandardCharsets.UTF_8);
```

Untuk materi Java 8–25, kita akan sering memberikan dua gaya jika API berbeda.

### 5.3 Newline portability

Ada tiga pendekatan umum:

```java
writer.newLine();                 // platform line separator
writer.write(System.lineSeparator());
writer.write("\n");              // protocol-oriented LF
```

Gunakan `writer.newLine()` jika file bersifat local human-readable dan mengikuti platform.

Gunakan `\n` jika file adalah format/protocol yang mensyaratkan LF, misalnya banyak manifest, JSONL, NDJSON, CSV internal pipeline, atau log yang diproses tool Linux.

Top 1% rule:

```text
Newline bukan detail kosmetik.
Newline adalah bagian dari file format contract.
```

### 5.4 BOM

UTF-8 biasanya tidak membutuhkan BOM. Jika downstream mengharapkan BOM, itu harus menjadi keputusan eksplisit format, bukan efek samping.

Java `StandardCharsets.UTF_8` tidak otomatis menulis BOM ketika memakai `BufferedWriter` atau `Files.writeString`.

---

## 6. Binary Writing

Untuk binary payload, jangan memakai `Writer`.

Gunakan `OutputStream` atau `FileChannel`.

Contoh copy stream ke file:

```java
public static void writeBinary(Path target, InputStream source) throws IOException {
    try (OutputStream out = new BufferedOutputStream(Files.newOutputStream(
            target,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE))) {
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = source.read(buffer)) != -1) {
            out.write(buffer, 0, n);
        }
    }
}
```

Catatan:

- `CREATE_NEW` mencegah overwrite diam-diam.
- `BufferedOutputStream` mengurangi syscall untuk banyak small writes.
- Closing output stream penting untuk flush buffer.
- Untuk durability penting, output stream saja tidak cukup; gunakan channel/force atau pattern atomic write.

Untuk Java 9+, bisa lebih simple:

```java
try (InputStream in = source;
     OutputStream out = Files.newOutputStream(target,
             StandardOpenOption.CREATE_NEW,
             StandardOpenOption.WRITE)) {
    in.transferTo(out);
}
```

Tapi jangan lupa: `transferTo` bukan magic durability. Ia hanya membantu transfer bytes.

---

## 7. Flush, Close, Force: Tiga Hal yang Sering Dicampuradukkan

### 7.1 `flush()`

`flush()` biasanya berarti:

```text
Dorong data dari buffer object Java ke layer output di bawahnya.
```

Contoh:

```java
writer.write(content);
writer.flush();
```

Tetapi flush tidak selalu berarti data sudah sampai disk. Bisa saja data baru sampai:

- stream bawahnya,
- OS kernel buffer,
- page cache.

### 7.2 `close()`

`close()` biasanya:

- flush buffer,
- menutup handle/resource,
- membuat exception jika close gagal,
- memastikan descriptor tidak leak.

Namun close juga tidak selalu berarti data sudah durable terhadap power loss. Banyak OS/filesystem melakukan write-back asynchronous.

### 7.3 `FileChannel.force(boolean metaData)`

`FileChannel.force(...)` meminta update dipaksa ke storage device.

```java
try (FileChannel ch = FileChannel.open(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING)) {
    ch.write(ByteBuffer.wrap(bytes));
    ch.force(true);
}
```

Parameter:

```text
force(false) -> force file content saja sejauh memungkinkan
force(true)  -> force content + metadata sejauh memungkinkan
```

Metadata dapat mencakup informasi seperti ukuran file, modification time, allocation metadata, dan directory entry terkait, tergantung OS/filesystem.

Top 1% nuance:

```text
force(true) pada file tidak selalu sama dengan fsync parent directory.
```

Untuk atomic rename durability, sering kali data file dan directory metadata sama-sama perlu dipertimbangkan. Java standard API tidak memberi portable direct API untuk fsync directory di semua platform. Ini salah satu alasan mengapa durability penuh selalu harus ditulis dengan caveat platform/filesystem.

### 7.4 `SYNC` dan `DSYNC`

`StandardOpenOption.SYNC` dan `DSYNC` meminta setiap update ditulis synchronously.

Konsep:

```text
SYNC  -> content dan metadata update disinkronkan
DSYNC -> content update disinkronkan; metadata hanya yang diperlukan untuk retrieve content
```

Contoh:

```java
try (OutputStream out = Files.newOutputStream(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.SYNC)) {
    out.write(bytes);
}
```

Trade-off:

- lebih kuat untuk durability,
- jauh lebih mahal untuk latency/throughput,
- bisa menghancurkan performa jika dipakai per small write,
- masih bergantung provider/filesystem/device.

Biasanya lebih baik membuat batch dan `force` pada boundary yang bermakna daripada `SYNC` untuk setiap byte/line.

---

## 8. Durability, Visibility, Atomicity: Jangan Disamakan

Ini tiga konsep berbeda.

### 8.1 Visibility

Visibility berarti:

```text
Process/thread lain bisa melihat data baru.
```

Setelah write ke file, reader lain mungkin bisa membaca perubahan bahkan sebelum data durable ke disk, karena data ada di page cache.

### 8.2 Durability

Durability berarti:

```text
Jika crash/power loss terjadi, data tetap ada setelah restart.
```

Flush Java buffer belum tentu durability. Close belum tentu durability. Write syscall success belum tentu durability.

### 8.3 Atomicity

Atomicity berarti:

```text
Observer melihat state sebelum atau sesudah, bukan setengah transisi.
```

Direct overwrite biasanya tidak atomic dari perspektif content:

```text
old content -> empty/truncated -> partial new -> full new
```

Atomic rename bisa membuat publish lebih atomic:

```text
old file visible -> new file visible
```

Tetapi atomic rename tidak otomatis berarti data new file sudah durable kecuali write/force/recovery pattern-nya benar.

### 8.4 Matrix

| Property | Pertanyaan | Contoh |
|---|---|---|
| Visibility | Apakah reader lain bisa melihat perubahan? | Reader membuka file setelah write |
| Durability | Apakah data survive crash? | Mesin mati setelah write |
| Atomicity | Apakah reader melihat all-or-nothing? | Config replace via rename |
| Isolation | Apakah writer lain bisa interleave? | Multi-process append |
| Consistency | Apakah format valid? | JSON harus parseable |

Production write harus menyebut property mana yang dibutuhkan.

---

## 9. Direct Overwrite: Kapan Boleh, Kapan Tidak

### 9.1 Direct overwrite sederhana

```java
Files.writeString(path, content, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Boleh jika:

- file disposable,
- tidak ada concurrent reader penting,
- file bisa diregenerate,
- partial file bisa dideteksi dan diperbaiki,
- failure tidak menyebabkan data loss serius.

Contoh acceptable:

```text
build output sementara
unit test generated output
local cache yang bisa dihapus
non-critical debug file
```

### 9.2 Direct overwrite berbahaya

Berbahaya untuk:

```text
application.yml runtime config
checkpoint offset
financial report handoff
manifest export
file yang dipakai batch downstream
metadata index
```

Kenapa?

Jika proses mati setelah truncate tetapi sebelum full write:

```text
file lama sudah rusak
file baru belum lengkap
recovery tidak tahu mana versi valid
```

### 9.3 Minimal improvement: write and validate before publish

Jangan langsung target final. Gunakan temporary/staging path.

```text
target.txt.tmp-<random> -> write -> validate -> move to target.txt
```

Itu menuju Part 07.

---

## 10. Append Semantics dan Record Boundary

Append file umum untuk log/event.

```java
Files.writeString(path, eventLine + "\n", StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND);
```

Masalahnya: aplikasi tidak menulis “event” ke disk. Aplikasi menulis bytes.

Jika event terdiri dari beberapa write call:

```java
writer.write(timestamp);
writer.write(" ");
writer.write(message);
writer.newLine();
```

Maka record boundary tidak selalu sama dengan syscall boundary. Jika ada multi-writer, risiko interleaving meningkat.

Lebih baik bentuk satu record lengkap dulu:

```java
String record = timestamp + " " + escape(message) + "\n";
Files.writeString(path, record, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND);
```

Untuk audit-critical file, masih belum cukup. Pertimbangkan:

- single writer thread/process,
- file lock,
- queue-to-writer model,
- length-prefix record,
- checksum per record,
- fsync/force policy,
- database/event stream instead of flat file.

### 10.1 Append dengan BufferedWriter

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND)) {
    writer.write(record);
}
```

Jika writer dibuka lama dan menulis berkali-kali:

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND)) {
    for (Event event : events) {
        writer.write(format(event));
        writer.newLine();
    }
}
```

Ini efisien, tetapi jika crash di tengah batch, sebagian event mungkin sudah masuk, sebagian belum. Harus ada replay/idempotency strategy.

---

## 11. Error Handling: Exception Bukan Sekadar Log

Writing file bisa gagal di banyak titik:

- parent directory tidak ada,
- permission denied,
- target adalah directory,
- file exists padahal `CREATE_NEW`,
- storage full,
- quota exceeded,
- path terlalu panjang,
- invalid character,
- network filesystem timeout,
- provider tidak mendukung option,
- file sedang dikunci proses lain,
- disk I/O error,
- close gagal saat flush final.

Contoh buruk:

```java
try {
    Files.writeString(path, content);
} catch (IOException e) {
    log.warn("Failed to write file", e);
}
```

Masalah:

- caller tidak tahu write gagal,
- file mungkin partial,
- retry mungkin menimpa state,
- tidak ada klasifikasi failure,
- tidak ada cleanup temp file,
- tidak ada signal ke monitoring.

Contoh lebih baik:

```java
public void writeRequiredFile(Path path, String content) throws FileWriteException {
    try {
        Files.writeString(path, content, StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE);
    } catch (FileAlreadyExistsException e) {
        throw new FileWriteException("Target file already exists: " + path, e);
    } catch (AccessDeniedException e) {
        throw new FileWriteException("Access denied writing file: " + path, e);
    } catch (NoSuchFileException e) {
        throw new FileWriteException("Parent path missing while writing file: " + path, e);
    } catch (IOException e) {
        throw new FileWriteException("I/O failure writing file: " + path, e);
    }
}
```

Catatan: jangan log sensitive full path jika path mengandung tenant/user/file name sensitif. Untuk regulated system, path logging juga bagian dari data exposure model.

---

## 12. Close Failure Itu Nyata

Dalam buffered output, error bisa muncul saat close karena data terakhir baru benar-benar didorong saat close.

Contoh:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write(content);
}
```

`try-with-resources` akan memanggil `close()`. Jika close gagal, exception bisa keluar dari blok.

Jangan menulis pattern seperti ini:

```java
BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8);
writer.write(content);
writer.close(); // if this throws and ignored elsewhere, data may be incomplete
```

Lebih buruk:

```java
try {
    writer.close();
} catch (IOException ignored) {
}
```

Top 1% rule:

```text
A write workflow is not successful until close/force/publish steps required by the workflow have succeeded.
```

---

## 13. Partial Write dan Disk Full

Disk full adalah skenario yang harus masuk failure matrix.

Direct write:

```text
open target with TRUNCATE_EXISTING
write first chunk ok
write second chunk fails: disk full
close fails or write throws
result: target partial
```

Jika file lama penting, direct overwrite kehilangan data lama.

Untuk file besar:

```java
try (InputStream in = source;
     OutputStream out = Files.newOutputStream(target,
             StandardOpenOption.CREATE,
             StandardOpenOption.TRUNCATE_EXISTING,
             StandardOpenOption.WRITE)) {
    byte[] buf = new byte[1024 * 1024];
    int n;
    while ((n = in.read(buf)) != -1) {
        out.write(buf, 0, n); // may fail after writing previous chunks
    }
}
```

Recovery harus menjawab:

- apakah partial target boleh ada?
- apakah harus dihapus?
- apakah bisa dilanjutkan/resume?
- apakah ada checksum untuk mendeteksi lengkap/tidak?
- apakah downstream bisa salah memproses partial file?

Untuk handoff file, jangan expose target final sebelum lengkap. Pakai staging extension/directory lalu atomic publish.

---

## 14. Multi-Step Write: Data dan Metadata

Ketika menulis file, bukan hanya content yang berubah.

Metadata yang mungkin berubah:

- size,
- modified time,
- access time,
- creation time provider-specific,
- allocation blocks,
- directory entry,
- permissions jika create,
- owner/group default,
- ACL inherited,
- file key/inode jika replace by rename.

Contoh:

```text
Overwrite in-place:
  same directory entry
  likely same file identity/inode
  content changed
  size changed

Replace by temp + rename:
  target name points to new file identity
  old file identity gone/unlinked
  permissions/owner may differ unless copied/set intentionally
```

Ini penting untuk:

- process yang memegang file handle lama,
- watcher behavior,
- permission preservation,
- audit trails,
- hard links,
- symlink targets,
- backup/sync tools.

---

## 15. Writing dengan `CREATE_NEW`: Defensive by Default

Jika operasi bisnis seharusnya tidak overwrite file existing, gunakan `CREATE_NEW`.

```java
Files.writeString(path, content, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
```

Keuntungan:

- check-and-create atomic,
- mencegah accidental overwrite,
- aman untuk unique artifact,
- bagus untuk upload storage random name,
- bagus untuk idempotency key file.

Contoh use case:

```text
store uploaded blob by generated UUID
write export batch artifact once
create lock/claim file
create marker file if absent
```

Jika file sudah ada, Java melempar `FileAlreadyExistsException`.

Jangan lakukan:

```java
if (!Files.exists(path)) {
    Files.writeString(path, content);
}
```

Karena race:

```text
Thread A: exists false
Thread B: creates file
Thread A: writes/truncates file
```

Gunakan atomic create.

---

## 16. Writing dengan Permission Saat Create

Untuk file sensitif, permission sebaiknya diset saat create, bukan chmod setelah create.

POSIX example:

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

try (OutputStream out = Files.newOutputStream(
        path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    // newOutputStream does not accept FileAttribute directly
}
```

Untuk create dengan attribute, gunakan API yang mendukung attribute seperti `createFile`, lalu open:

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

Files.createFile(path, attr);
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8,
        StandardOpenOption.WRITE)) {
    writer.write(secretContent);
}
```

Namun ini punya window antara create dan write, meskipun file sudah permission-restricted. Untuk temp file, `createTempFile` juga menerima attributes.

Catatan:

- POSIX attribute tidak portable ke Windows default provider.
- Permission behavior dipengaruhi umask, mount options, ACL inheritance, container user, filesystem provider.
- Part 15 akan membahas permissions lebih dalam.

---

## 17. Writing ke Symlink: Target atau Link?

Jika `path` adalah symbolic link, kebanyakan operasi write akan mengikuti symlink dan menulis ke target.

Risiko:

```text
expected: write /safe/upload/file.txt
actual: attacker replaced file.txt with symlink to /etc/sensitive
```

Untuk path dari user input atau directory writable oleh pihak lain, direct write berbahaya.

Mitigasi bergantung use case:

- gunakan storage directory yang tidak writable oleh attacker,
- generate filename sendiri,
- gunakan `CREATE_NEW`,
- validate real path containment,
- hindari follow link jika API mendukung,
- gunakan secure directory permissions,
- jangan gunakan original filename sebagai path final,
- gunakan OS-level sandbox/container permission.

`NOFOLLOW_LINKS` tersedia untuk beberapa operasi, tetapi tidak semua write open operation memberikan perlindungan lengkap terhadap semua race. Security path traversal dan symlink attack akan dibahas khusus di Part 13.

---

## 18. Concurrency: Dua Writer, Satu File

Jika dua writer menulis file yang sama, hasilnya tergantung:

- open options,
- OS semantics,
- filesystem,
- buffering,
- append vs positional write,
- lock ada/tidak,
- process/thread sama atau berbeda.

### 18.1 Dua writer truncate

```text
Writer A opens TRUNCATE_EXISTING
Writer B opens TRUNCATE_EXISTING
A writes content A
B writes content B
```

Hasil akhir tidak bisa diasumsikan hanya dari urutan kode aplikasi jika berjalan concurrent.

### 18.2 Dua writer append

```text
Writer A appends record A
Writer B appends record B
```

Mungkin hasil:

```text
A\nB\n
```

atau:

```text
B\nA\n
```

Untuk multi-write record, risiko interleaving:

```text
A-part1 B-part1 A-part2 B-part2
```

Tergantung bagaimana write dipecah ke syscall/buffer.

### 18.3 Single-writer principle

Untuk file yang penting, prinsip yang sering lebih sederhana:

```text
Many producers -> queue -> one writer -> file
```

Atau:

```text
Many workers -> each writes unique file -> atomic publish -> aggregator reads
```

Jangan memaksa satu file menjadi shared mutable database jika requirement-nya sudah seperti database.

---

## 19. File as Handoff Contract

Banyak enterprise workflow memakai file sebagai boundary antar sistem.

Contoh:

```text
System A writes report.csv
System B polls directory and imports report.csv
```

Direct write ke final name berbahaya:

```text
B bisa melihat report.csv saat A masih menulis
B import partial file
B gagal atau lebih buruk: sukses dengan data kurang
```

Pattern yang lebih aman:

```text
A writes .report.csv.tmp
A closes and validates
A renames to report.csv
B only watches/imports *.csv, ignores *.tmp
```

Lebih kuat lagi:

```text
payload.tmp -> payload.dat
manifest.tmp -> manifest.json
manifest contains payload size/hash
consumer processes only manifest
```

Handoff file harus punya state machine, bukan hanya folder.

Contoh:

```text
STAGING -> PUBLISHED -> CLAIMED -> PROCESSING -> DONE / ERROR
```

Part 32 akan membahas file workflow architecture lebih dalam.

---

## 20. Practical Recipes

### 20.1 Write small text file, Java 11+

```java
public static void writeSmallText(Path path, String content) throws IOException {
    Files.writeString(path, content, StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE);
}
```

Use only when direct overwrite acceptable.

### 20.2 Write small text file, Java 8

```java
public static void writeSmallTextJava8(Path path, String content) throws IOException {
    try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE)) {
        writer.write(content);
    }
}
```

### 20.3 Create new file only

```java
public static void writeNewFileOnly(Path path, byte[] bytes) throws IOException {
    Files.write(path, bytes,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE);
}
```

Use when overwrite is a bug.

### 20.4 Append one line

```java
public static void appendLine(Path path, String line) throws IOException {
    Files.writeString(path, line + "\n", StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND);
}
```

Java 8:

```java
public static void appendLineJava8(Path path, String line) throws IOException {
    try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND)) {
        writer.write(line);
        writer.write('\n');
    }
}
```

### 20.5 Write binary stream

```java
public static long writeStream(Path target, InputStream input) throws IOException {
    long total = 0;
    try (OutputStream out = new BufferedOutputStream(Files.newOutputStream(target,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE))) {
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = input.read(buffer)) != -1) {
            out.write(buffer, 0, n);
            total += n;
        }
    }
    return total;
}
```

### 20.6 Write and force with FileChannel

```java
public static void writeDurableBestEffort(Path path, byte[] bytes) throws IOException {
    try (FileChannel ch = FileChannel.open(path,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE)) {
        ByteBuffer buf = ByteBuffer.wrap(bytes);
        while (buf.hasRemaining()) {
            ch.write(buf);
        }
        ch.force(true);
    }
}
```

Caveat: ini force file content/metadata best-effort, tetapi direct overwrite masih bisa merusak file lama jika crash di tengah sebelum full write. Untuk replace aman, tunggu Part 07.

---

## 21. Production-Grade Write Decision Tree

Gunakan pertanyaan berikut sebelum memilih API.

### 21.1 Apakah file kecil dan disposable?

Ya:

```java
Files.writeString(...)
```

Mungkin cukup.

Tidak:

```text
Gunakan streaming/channel/staging pattern.
```

### 21.2 Apakah overwrite existing file boleh?

Ya:

```text
CREATE + TRUNCATE_EXISTING + WRITE
```

Tidak:

```text
CREATE_NEW
```

### 21.3 Apakah reader boleh melihat partial content?

Ya:

```text
Direct write mungkin acceptable.
```

Tidak:

```text
Write temp/staging -> atomic publish.
```

### 21.4 Apakah data harus survive crash setelah method return?

Ya:

```text
Butuh force/SYNC/DSYNC + filesystem-specific caveat + recovery test.
```

Tidak:

```text
Close mungkin cukup.
```

### 21.5 Apakah multiple writer bisa menyentuh file yang sama?

Ya:

```text
Pertimbangkan single-writer, lock, append protocol, atau storage lain.
```

Tidak:

```text
Lebih sederhana, tetapi tetap pikirkan crash/recovery.
```

### 21.6 Apakah file adalah handoff ke sistem lain?

Ya:

```text
Jangan tulis langsung ke final filename.
Gunakan staging extension/directory dan publish marker/manifest.
```

---

## 22. Anti-Patterns

### 22.1 Check exists then write

```java
if (!Files.exists(path)) {
    Files.writeString(path, content);
}
```

Masalah: race condition.

Lebih baik:

```java
Files.writeString(path, content, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
```

### 22.2 Direct overwrite config

```java
Files.writeString(configPath, json);
```

Masalah: reader bisa melihat partial/corrupt config.

Lebih baik:

```text
write temp -> validate parse -> force -> atomic move
```

### 22.3 Swallow IOException

```java
catch (IOException ignored) {}
```

Masalah: caller mengira success.

Lebih baik: classify, propagate, cleanup, metric.

### 22.4 Default charset

```java
new FileWriter(file)
```

Masalah: default charset/platform-dependent, legacy API, less explicit error contract.

Lebih baik:

```java
Files.newBufferedWriter(path, StandardCharsets.UTF_8)
```

### 22.5 Expose final file before complete

```java
try (OutputStream out = Files.newOutputStream(finalPath)) {
    // long write
}
```

Masalah: consumer bisa membaca saat write belum selesai.

Lebih baik:

```text
write to staging name -> rename/publish when complete
```

### 22.6 Treat flush as fsync

```java
writer.flush(); // assume durable
```

Masalah: flush hanya buffer-level, bukan crash durability guarantee.

Lebih baik:

```text
Use FileChannel.force / SYNC / DSYNC where durability is required.
```

### 22.7 Append unframed complex records

```java
writer.write(part1);
writer.write(part2);
writer.write(part3);
```

Masalah: partial/interleaved records sulit recovery.

Lebih baik:

```text
Build full record -> encode -> write as one logical operation.
Use length/checksum for important logs.
```

---

## 23. Failure Matrix untuk Write Operation

| Failure point | Possible result | Design response |
|---|---|---|
| Parent missing | No file written | Create parent explicitly if expected; otherwise fail fast |
| Open denied | No file written | Permission/config/runtime identity fix |
| Existing file with `CREATE_NEW` | No overwrite | Treat as idempotency conflict or duplicate |
| Truncate succeeds, write fails | Existing file corrupted/partial | Avoid direct overwrite for important data |
| Write partial due disk full | Partial file | Use staging, cleanup, capacity guardrail |
| Flush fails | File incomplete | Propagate failure |
| Close fails | File may be incomplete | Treat workflow as failed |
| Force fails | Data not guaranteed durable | Fail if durability required |
| Process crash before close | Buffer lost/partial file | Recovery scan, temp cleanup |
| Consumer reads during write | Partial processing | Staging/publish pattern |
| Concurrent writer | Lost/interleaved data | Single writer/lock/unique file |

---

## 24. Observability untuk Write Workflow

Untuk production system, file write harus bisa di-debug.

Minimum log context:

```text
operationId / correlationId
logical file type
sanitized path or storage key
target directory
file size expected/actual
open option intent
start/end timestamp
result status
exception class
retry count
```

Metrics:

```text
file_write_attempt_total
file_write_success_total
file_write_failure_total{reason}
file_write_bytes_total
file_write_duration_seconds
file_force_duration_seconds
file_partial_cleanup_total
file_disk_free_bytes
file_staging_file_count
```

Tracing span attributes:

```text
file.operation = write|append|publish
file.logical_type = settlement_report
file.size_bytes = 123456
file.target_zone = staging|published
filesystem.provider = default|zip|custom
```

Hindari logging full sensitive path jika mengandung PII, tenant name, uploaded original filename, atau business secret.

---

## 25. Java 8–25 Compatibility Notes

| Feature/API | Java 8 | Java 11+ | Java 25 note |
|---|---:|---:|---|
| `Files.write(Path, byte[])` | Available | Available | Still available |
| `Files.write(Path, Iterable<? extends CharSequence>, Charset, OpenOption...)` | Available | Available | Still available |
| `Files.writeString` | Not available | Available since Java 11 | Available |
| `Files.newBufferedWriter` | Available | Available | Default UTF-8 overload available |
| `Path.of` | Not available | Available since Java 11 | Preferred over `Paths.get` in modern docs |
| `Paths.get` | Available | Available | Docs recommend `Path.of`; future deprecation possible |
| `StandardOpenOption` | Available | Available | Same conceptual options |
| `FileChannel.force` | Available | Available | Still important for durability |

Untuk seri ini, jika contoh memakai `Files.writeString`, Java 8 equivalent biasanya memakai `Files.write(... bytes ...)` atau `Files.newBufferedWriter`.

---

## 26. Mini Case Study: Config File Update yang Salah

### 26.1 Implementasi naif

```java
public void saveConfig(Path configPath, String json) throws IOException {
    Files.writeString(configPath, json, StandardCharsets.UTF_8);
}
```

Failure:

```text
T0 old config valid
T1 writer opens config with truncate
T2 file becomes 0 bytes
T3 process crashes
T4 service restarts
T5 config parser reads empty file
T6 application fails boot or uses default unsafe config
```

### 26.2 Masalah desain

Bukan hanya kode kurang try-catch. Masalahnya adalah workflow tidak punya invariant.

Invariant yang dibutuhkan:

```text
At any time, configPath must refer to a complete parseable config version.
```

Direct overwrite melanggar invariant itu.

### 26.3 Directional fix

```text
write config.tmp
parse config.tmp
force config.tmp
atomic move config.tmp -> config.json
```

Part 07 akan membahas detailnya.

---

## 27. Mini Case Study: Export File Handoff

### 27.1 Implementasi naif

```java
Path report = outbox.resolve("daily-report.csv");
try (BufferedWriter writer = Files.newBufferedWriter(report, StandardCharsets.UTF_8)) {
    for (Row row : rows) {
        writer.write(toCsv(row));
        writer.write('\n');
    }
}
```

Consumer polling:

```text
scan *.csv every 5 seconds
import found files
```

Failure:

```text
T0 producer starts writing daily-report.csv
T1 consumer sees daily-report.csv
T2 consumer imports first 500 rows
T3 producer later writes total 10,000 rows
T4 consumer marks report processed incorrectly
```

### 27.2 Better handoff contract

```text
producer writes daily-report.csv.part
producer closes and optionally verifies row count/hash
producer moves to daily-report.csv
consumer only imports *.csv, ignores *.part
```

Even better:

```text
producer writes payload file
producer writes manifest with hash/size/row count
consumer processes manifest, validates payload
```

---

## 28. Mental Model: File Write as State Machine

Naive mental model:

```text
write(path, data) -> done
```

Better mental model:

```text
NOT_STARTED
  -> OPENING
  -> WRITING
  -> FLUSHING
  -> FORCING(optional)
  -> CLOSING
  -> PUBLISHING(optional)
  -> VERIFYING(optional)
  -> SUCCESS
  -> FAILED
  -> RECOVERY_REQUIRED(optional)
```

Each transition can fail.

Each failure must define:

- what artifacts may exist,
- whether target is visible,
- whether retry is safe,
- whether cleanup is required,
- whether alert is required,
- whether downstream may have observed partial state.

Top engineers reason this way because file operations are state transitions under failure, not just API calls.

---

## 29. Checklist: Before Writing a File in Production

Gunakan checklist ini:

```text
[ ] Is this text or binary?
[ ] If text, is charset explicit?
[ ] Is newline format part of the contract?
[ ] Should existing file be overwritten, appended, or rejected?
[ ] If reject existing, am I using CREATE_NEW instead of exists check?
[ ] Can another process read while I write?
[ ] Can another process write the same file?
[ ] Is partial file acceptable?
[ ] Is crash durability required?
[ ] Is close/flush failure propagated?
[ ] Is disk full handled?
[ ] Is target path trusted?
[ ] Can symlink/path traversal matter?
[ ] Is permission correct at creation time?
[ ] Is file handoff using staging/publish?
[ ] Is there a recovery story for temp/partial files?
[ ] Are metrics/logs sufficient to debug failure?
```

---

## 30. Key Takeaways

1. `Files.writeString` dan `Files.write` nyaman, tetapi default overwrite/truncate bisa berbahaya.
2. Replace, append, dan in-place update adalah intent berbeda dengan failure mode berbeda.
3. `flush`, `close`, dan `force` bukan hal yang sama.
4. Write success tidak otomatis berarti durable terhadap crash.
5. Direct overwrite tidak cocok untuk file penting yang harus selalu valid.
6. Untuk file baru yang tidak boleh overwrite, gunakan `CREATE_NEW`, bukan `exists` lalu write.
7. Untuk handoff ke consumer, jangan expose final filename sebelum file lengkap.
8. Untuk multi-writer, jangan mengandalkan intuisi; gunakan single-writer, lock, record protocol, atau storage lain.
9. Untuk text, charset dan newline adalah bagian dari kontrak file.
10. Production file writing harus dipikirkan sebagai state machine dengan failure matrix.

---

## 31. Latihan

### Latihan 1 — Classify Write Intent

Untuk masing-masing file berikut, tentukan apakah cocok direct overwrite, append, `CREATE_NEW`, atau atomic publish:

1. `application-runtime-config.json`
2. `debug-dump.txt`
3. `uploaded-customer-document.pdf`
4. `daily-settlement-2026-06-18.csv`
5. `local-cache-index.bin`
6. `audit-events.log`
7. `checkpoint-offset.txt`

Jawab dengan alasan:

```text
file:
intent:
acceptable failure:
unsafe failure:
recommended pattern:
```

### Latihan 2 — Failure Matrix

Ambil kode ini:

```java
Files.writeString(path, content, StandardCharsets.UTF_8);
```

Buat failure matrix untuk:

- parent missing,
- permission denied,
- process crash after truncate,
- disk full halfway,
- concurrent reader,
- concurrent writer,
- close failure.

### Latihan 3 — Java 8 Compatibility

Ubah kode Java 11+ ini menjadi Java 8 compatible:

```java
Files.writeString(path, content, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
```

### Latihan 4 — Handoff Design

Desain directory workflow untuk producer/consumer file:

```text
/inbox
/staging
/processing
/done
/error
```

Tentukan:

- kapan file muncul di `/inbox`,
- bagaimana consumer claim file,
- bagaimana partial file dicegah,
- bagaimana retry dilakukan,
- bagaimana poison file ditangani.

---

## 32. Jembatan ke Part 07

Bagian ini menjelaskan bahwa direct write, append, flush, close, dan force memiliki batas masing-masing.

Pertanyaan berikutnya:

```text
Jika kita ingin mengganti file penting sehingga reader selalu melihat versi lama atau versi baru, tidak pernah versi setengah jadi, pattern apa yang benar?
```

Itu membawa kita ke:

```text
Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move
```

Di sana kita akan membahas:

- kenapa temp file harus di directory yang sama,
- kenapa atomic move bisa gagal,
- apa arti `ATOMIC_MOVE`,
- kenapa cross-filesystem move berbahaya,
- kapan perlu force file,
- apa masalah parent directory durability,
- failure matrix atomic replace,
- implementasi Java yang practical.

---

## 33. Referensi Utama

- Oracle Java SE 25 API — `java.nio.file.Files`
- Oracle Java SE 8 API — `java.nio.file.Files`
- Oracle Java SE 25 API — `java.nio.file.StandardOpenOption`
- Oracle Java SE 8 API — `java.nio.file.StandardOpenOption`
- Oracle Java SE API — `java.nio.channels.FileChannel`
- Oracle Java Tutorials — Reading, Writing, and Creating Files

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 05](./learn-java-io-file-filesystem-storage-engineering-part-05-reading-files-correctly.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move](./learn-java-io-file-filesystem-storage-engineering-part-07-atomic-update-pattern.md)

</div>